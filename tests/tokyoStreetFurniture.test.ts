// @vitest-environment jsdom

import {
  DynamicTexture,
  MultiMaterial,
  NullEngine,
  Scene,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOKYO_FREE_DRIVE, TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import { buildTokyoStreetFurniture } from "../app/game/render/tokyoLandmarks";
import {
  TOKYO_AD_CREATIVES,
  TOKYO_TENANT_CREATIVES,
  tokyoAdAtlasUv,
  tokyoAdvertisingPlan,
} from "../app/game/tokyoAdvertising";
import { TOKYO_CHOCHIN_POSTS } from "../app/game/tokyoStreetFurniture";

const CHOCHIN_POST_RADIUS_M = 0.28;
const DOWNTOWN_ADVERTISING_CENTER = { x: 440, z: 140 } as const;

interface TestPoint {
  readonly x: number;
  readonly z: number;
}

function pointAlongPolyline(
  points: readonly TestPoint[],
  distanceAlongM: number,
): TestPoint {
  let remainingM = distanceAlongM;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthM = Math.hypot(dx, dz);
    if (remainingM <= lengthM) {
      const amount = lengthM > 0 ? remainingM / lengthM : 0;
      return { x: from.x + dx * amount, z: from.z + dz * amount };
    }
    remainingM -= lengthM;
  }
  return points.at(-1) ?? { x: 0, z: 0 };
}

function tangentAlongPolyline(
  points: readonly TestPoint[],
  distanceAlongM: number,
): TestPoint {
  let remainingM = distanceAlongM;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM <= 1e-6) continue;
    if (remainingM <= lengthM) {
      return { x: dx / lengthM, z: dz / lengthM };
    }
    remainingM -= lengthM;
  }
  throw new Error("Polyline needs at least one non-zero segment.");
}

function projectOntoPolyline(
  point: TestPoint,
  points: readonly TestPoint[],
): {
  readonly point: TestPoint;
  readonly tangent: TestPoint;
  readonly stationM: number;
  readonly distanceM: number;
} {
  let stationM = 0;
  let best:
    | {
        point: TestPoint;
        tangent: TestPoint;
        stationM: number;
        distanceM: number;
      }
    | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM <= 1e-6) continue;
    const amount = Math.max(
      0,
      Math.min(
        1,
        ((point.x - from.x) * dx + (point.z - from.z) * dz) /
          (lengthM * lengthM),
      ),
    );
    const projected = {
      x: from.x + dx * amount,
      z: from.z + dz * amount,
    };
    const distanceM = Math.hypot(
      point.x - projected.x,
      point.z - projected.z,
    );
    if (!best || distanceM < best.distanceM) {
      best = {
        point: projected,
        tangent: { x: dx / lengthM, z: dz / lengthM },
        stationM: stationM + lengthM * amount,
        distanceM,
      };
    }
    stationM += lengthM;
  }
  if (!best) throw new Error("Polyline needs at least one non-zero segment.");
  return best;
}

function distanceBetween(a: TestPoint, b: TestPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function createFake2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const sized = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4),
  });
  return {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    shadowColor: "transparent",
    shadowBlur: 0,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width: number, height: number) => sized(width, height),
    getImageData: (_x: number, _y: number, width: number, height: number) =>
      sized(width, height),
    putImageData: noop,
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...args: unknown[]
  ) {
    if (type === "2d") return createFake2dContext(this);
    return originalGetContext.apply(this, [type, ...args] as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe("Tokyo street furniture", () => {
  it("keeps every chochin post outside every carriageway", () => {
    for (const post of TOKYO_CHOCHIN_POSTS) {
      for (const road of TOKYO_MAP_PACK.geometry.roadSurfaces ?? []) {
        const nearest = nearestPointOnPolyline(post.position, road.centerline);
        const clearanceM = Math.hypot(
          post.position.x - nearest.x,
          post.position.z - nearest.z,
        );
        expect(clearanceM, `${post.id} overlaps ${road.id}`).toBeGreaterThanOrEqual(
          road.widthM / 2 + CHOCHIN_POST_RADIUS_M,
        );
      }
    }
  });

  it("leaves the Niban-dori crossing in the Nakamise row open", () => {
    expect(
      TOKYO_CHOCHIN_POSTS.some(
        (post) => post.id === "jp-chochin-yokocho-5",
      ),
    ).toBe(false);
  });
});

describe("Tokyo advertising", () => {
  const buildingLayout = planMapBuildings(
    TOKYO_MAP_PACK,
    TOKYO_FREE_DRIVE.trafficSeed,
  );
  const plan = tokyoAdvertisingPlan(TOKYO_MAP_PACK, buildingLayout);
  const placements = [...plan.campaigns, ...plan.tenantSigns];
  const roads = new Map(
    (TOKYO_MAP_PACK.geometry.roadSurfaces ?? []).map((road) => [road.id, road]),
  );
  const buildings = new Map(
    buildingLayout.buildings.map((building) => [building.id, building]),
  );
  const blocks = new Map(
    TOKYO_MAP_PACK.geometry.blocks.map((block) => [block.id, block]),
  );
  const residentialBuildingIds = new Set(
    buildingLayout.buildings
      .filter(
        (building) =>
          ["tokyo-house", "tokyo-apato", "tokyo-manshon"].includes(
            blocks.get(building.blockId)?.buildingSet ?? "",
          ) ||
          (building.source === "asset-slot" &&
            /^tokyo-(?:house|apato|walkup)-/.test(building.modelId)),
      )
      .map((building) => building.id),
  );
  const playerSpawn = TOKYO_MAP_PACK.laneGraph.spawnPoints.find(
    (spawn) => spawn.id === TOKYO_FREE_DRIVE.startSpawnId,
  );
  if (!playerSpawn || playerSpawn.kind !== "player") {
    throw new Error("Tokyo free drive must resolve to an anchored player spawn.");
  }
  const playerLane = TOKYO_MAP_PACK.laneGraph.lanes.find(
    (lane) => lane.id === playerSpawn.anchor.laneId,
  );
  if (!playerLane) throw new Error("Tokyo player spawn lane is missing.");
  const playerStart = pointAlongPolyline(
    playerLane.centerline,
    playerSpawn.anchor.distanceAlongM,
  );

  it("ships fictional campaign and tenant creatives with Japanese leading the mix", () => {
    expect(TOKYO_AD_CREATIVES).toHaveLength(28);
    expect(TOKYO_AD_CREATIVES.filter((creative) => creative.language === "ja"))
      .toHaveLength(25);
    expect(
      TOKYO_AD_CREATIVES.filter((creative) => creative.language === "bilingual"),
    ).toHaveLength(3);
    expect(new Set(TOKYO_AD_CREATIVES.map((creative) => creative.id)).size).toBe(
      TOKYO_AD_CREATIVES.length,
    );
    expect(TOKYO_TENANT_CREATIVES).toHaveLength(24);
    expect(
      new Set(TOKYO_TENANT_CREATIVES.map((creative) => creative.id)).size,
    ).toBe(TOKYO_TENANT_CREATIVES.length);
    const forbidden = [
      "nike",
      "sony",
      "toyota",
      "yakult",
      "hitachi",
      "religion",
      "politic",
      "sexual",
    ];
    const copy = [
      ...TOKYO_AD_CREATIVES.map(
        (creative) => `${creative.id} ${creative.headline} ${creative.subline}`,
      ),
      ...TOKYO_TENANT_CREATIVES.map(
        (creative) => `${creative.id} ${creative.name} ${creative.detail}`,
      ),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of forbidden) expect(copy).not.toContain(word);
  });

  it("crops every mechanically-built atlas cell inside its own bounds", () => {
    for (const creative of TOKYO_AD_CREATIVES) {
      const crop = tokyoAdAtlasUv(creative.artIndex, creative.artAtlas);
      expect(crop.uOffset).toBeGreaterThanOrEqual(0);
      expect(crop.vOffset).toBeGreaterThanOrEqual(0);
      expect(crop.uOffset + crop.uScale).toBeLessThanOrEqual(1);
      expect(crop.vOffset + crop.vScale).toBeLessThanOrEqual(1);
      expect(crop.uScale).toBeGreaterThan(0);
      expect(crop.vScale).toBeGreaterThan(0);
    }
  });

  it("builds a genuinely dense, layered sign system instead of a sparse billboard pass", () => {
    expect(plan.campaigns.length).toBeGreaterThanOrEqual(100);
    expect(plan.tenantSigns.length).toBeGreaterThanOrEqual(4_000);
    // The rejected pass had 1,994 signs on 710 buildings. Both coverage
    // dimensions must at least double; stacking more pieces on the same few
    // facades does not satisfy the street-level density request.
    expect(placements.length).toBeGreaterThanOrEqual(3_988);
    const advertisedBuildingIds = new Set(
      placements.map((placement) => placement.buildingId),
    );
    expect(advertisedBuildingIds.size).toBeGreaterThanOrEqual(1_420);
    expect(placements.length / advertisedBuildingIds.size).toBeLessThanOrEqual(3);
    expect(
      new Set(plan.campaigns.map((placement) => placement.creativeIndex)),
    ).toEqual(
      new Set(TOKYO_AD_CREATIVES.map((_, index) => index)),
    );
    expect(
      new Set(plan.tenantSigns.map((placement) => placement.tenantIndex)),
    ).toEqual(new Set(TOKYO_TENANT_CREATIVES.map((_, index) => index)));
    expect(
      plan.campaigns.filter((placement) => placement.kind === "facade-poster")
        .length,
    ).toBeGreaterThanOrEqual(100);
    expect(
      plan.campaigns.filter((placement) => placement.kind === "facade-screen")
        .length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      plan.campaigns.some((placement) => placement.kind === "rooftop-screen"),
    ).toBe(true);
    expect(
      plan.tenantSigns.filter((placement) => placement.kind === "blade-kanban")
        .length,
    ).toBeGreaterThanOrEqual(3_300);
    expect(
      plan.tenantSigns.filter(
        (placement) => placement.kind === "storefront-fascia",
      ).length,
    ).toBeGreaterThanOrEqual(550);
    expect(
      plan.tenantSigns.filter(
        (placement) => placement.kind === "tenant-directory",
      ).length,
    ).toBeGreaterThanOrEqual(70);
    expect(new Set(placements.map((placement) => placement.id)).size).toBe(
      placements.length,
    );
  });

  it("keeps hero campaigns on procedural commercial boxes and residential facades vertical", () => {
    for (const placement of plan.campaigns) {
      expect(buildings.get(placement.buildingId)?.source, placement.id).toBe(
        "procedural-cell",
      );
    }

    const residentialPlacements = placements.filter((placement) =>
      residentialBuildingIds.has(placement.buildingId),
    );
    expect(
      new Set(residentialPlacements.map((placement) => placement.buildingId)).size,
    ).toBeGreaterThanOrEqual(570);
    for (const placement of residentialPlacements) {
      expect(placement.kind, placement.id).toBe("blade-kanban");
      expect(placement.heightM / placement.widthM, placement.id).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  it("puts an unmistakable sign field around the actual free-drive spawn", () => {
    const countWithin = (radiusM: number) =>
      placements.filter(
        (placement) => distanceBetween(placement.position, playerStart) <= radiusM,
      ).length;
    expect(countWithin(50)).toBeGreaterThanOrEqual(20);
    expect(countWithin(100)).toBeGreaterThanOrEqual(85);
    expect(countWithin(200)).toBeGreaterThanOrEqual(380);
    expect(countWithin(300)).toBeGreaterThanOrEqual(680);
  });

  it("starts the first visible spawn-road cluster inside the opening block", () => {
    const spawnRoadPlacements = placements
      .filter((placement) => placement.roadId === playerLane.roadId)
      .sort((a, b) => a.roadStationM - b.roadStationM);
    const openingBlock = spawnRoadPlacements.filter(
      (placement) =>
        placement.roadStationM >= playerSpawn.anchor.distanceAlongM - 2 &&
        placement.roadStationM <= playerSpawn.anchor.distanceAlongM + 80,
    );
    expect(openingBlock.length).toBeGreaterThanOrEqual(7);
    expect(
      openingBlock[0].roadStationM - playerSpawn.anchor.distanceAlongM,
    ).toBeLessThanOrEqual(12);
    expect(
      openingBlock.some((placement) => placement.kind === "facade-poster"),
    ).toBe(true);
    expect(
      new Set(openingBlock.map((placement) => placement.roadStationM.toFixed(1)))
        .size,
    ).toBeGreaterThanOrEqual(2);
  });

  it("makes downtown dense while preserving broad citywide coverage", () => {
    const downtownCount = (radiusM: number) =>
      placements.filter(
        (placement) =>
          distanceBetween(placement.position, DOWNTOWN_ADVERTISING_CENTER) <=
          radiusM,
      ).length;
    expect(downtownCount(200)).toBeGreaterThanOrEqual(210);
    expect(downtownCount(420)).toBeGreaterThanOrEqual(880);

    expect(new Set(placements.map((placement) => placement.roadId)).size).toBeGreaterThanOrEqual(
      95,
    );
    const occupiedHalfKilometreCells = new Set(
      placements.map(
        (placement) =>
          `${Math.floor(placement.position.x / 500)}:${Math.floor(placement.position.z / 500)}`,
      ),
    );
    expect(occupiedHalfKilometreCells.size).toBeGreaterThanOrEqual(28);
    expect(placements.some((placement) => placement.position.x < -900)).toBe(true);
    expect(placements.some((placement) => placement.position.x > 900)).toBe(true);
    expect(placements.some((placement) => placement.position.z < -900)).toBe(true);
    expect(placements.some((placement) => placement.position.z > 900)).toBe(true);

    expect(
      placements.filter((placement) => placement.distribution === "core").length,
    ).toBeGreaterThanOrEqual(1_600);
    expect(
      placements.filter((placement) => placement.distribution === "corridor")
        .length,
    ).toBeGreaterThanOrEqual(1_200);
    expect(
      placements.filter((placement) => placement.distribution === "satellite")
        .length,
    ).toBeGreaterThanOrEqual(1_100);
    expect(
      new Set(
        placements
          .filter((placement) => placement.distribution === "core")
          .map((placement) => placement.buildingId),
      ).size,
    ).toBeGreaterThanOrEqual(400);
    expect(
      new Set(
        placements
          .filter((placement) => placement.distribution === "corridor")
          .map((placement) => placement.buildingId),
      ).size,
    ).toBeGreaterThanOrEqual(500);
    expect(
      new Set(
        placements
          .filter((placement) => placement.distribution === "satellite")
          .map((placement) => placement.buildingId),
      ).size,
    ).toBeGreaterThanOrEqual(450);
  });

  it("orients every sign for road approaches and keeps its recorded road station honest", () => {
    for (const placement of placements) {
      const building = buildings.get(placement.buildingId);
      const road = roads.get(placement.roadId);
      expect(building, placement.id).toBeDefined();
      expect(road, placement.id).toBeDefined();
      const projection = projectOntoPolyline(
        placement.position,
        road?.centerline ?? [],
      );
      const yaw = (placement.headingDeg * Math.PI) / 180;
      const heading = { x: Math.sin(yaw), z: Math.cos(yaw) };
      const widthAxis = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      expect(
        Math.abs(projection.stationM - placement.roadStationM),
        placement.id,
      ).toBeLessThanOrEqual(15);
      expect(projection.distanceM, placement.id).toBeLessThanOrEqual(24);
      const towardRoad = {
        x: (projection.point.x - placement.position.x) / projection.distanceM,
        z: (projection.point.z - placement.position.z) / projection.distanceM,
      };
      const nearestFaceEdgeM =
        projection.distanceM -
        Math.abs(
          widthAxis.x * towardRoad.x + widthAxis.z * towardRoad.z,
        ) *
          placement.widthM / 2;
      expect(
        nearestFaceEdgeM - (road?.widthM ?? 0) / 2,
        `${placement.id} overhangs ${placement.roadId}`,
      ).toBeGreaterThanOrEqual(0.04);

      if (placement.kind === "blade-kanban") {
        const authoredTangent = tangentAlongPolyline(
          road?.centerline ?? [],
          placement.roadStationM,
        );
        const approachFacing = Math.abs(
          heading.x * authoredTangent.x + heading.z * authoredTangent.z,
        );
        expect(approachFacing, placement.id).toBeGreaterThan(0.99);
        continue;
      }

      const authoredRoadPoint = pointAlongPolyline(
        road?.centerline ?? [],
        placement.roadStationM,
      );
      const toRoad = {
        x: authoredRoadPoint.x - placement.position.x,
        z: authoredRoadPoint.z - placement.position.z,
      };
      const facing =
        (heading.x * toRoad.x + heading.z * toRoad.z) /
        Math.hypot(toRoad.x, toRoad.z);
      expect(facing, placement.id).toBeGreaterThan(0.7);
    }
  });

  it("keeps facade campaigns on their hosts and rooftop campaigns above them", () => {
    for (const placement of plan.campaigns) {
      const building = buildings.get(placement.buildingId);
      expect(building, placement.id).toBeDefined();
      const bottomM = placement.centerYM - placement.heightM / 2;
      const topM = placement.centerYM + placement.heightM / 2;
      if (placement.kind === "rooftop-screen") {
        expect(bottomM, placement.id).toBeGreaterThan(building?.heightM ?? 0);
      } else {
        expect(bottomM, placement.id).toBeGreaterThan(1.9);
        expect(topM, placement.id).toBeLessThan(building?.heightM ?? 0);
      }
      expect(placement.roadDistanceM, placement.id).toBeLessThanOrEqual(22);
    }
  });

  it("renders bright campaign and tenant masters, then instances the complete plan", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    buildTokyoStreetFurniture(
      {
        scene,
        buildingLayout,
        staticSceneryFreeze: [],
        registerShadowCaster: () => {},
        registerDestructibleProp: () => {},
      },
      TOKYO_MAP_PACK,
    );

    const campaignMasters = scene.meshes.filter((mesh) =>
      mesh.name.startsWith("prop-master-tokyo-ad-"),
    );
    const tenantMasters = scene.meshes.filter((mesh) =>
      mesh.name.startsWith("prop-master-tokyo-tenant-"),
    );
    const campaignInstances = scene.meshes.filter((mesh) =>
      /^prop-tokyo-ad-\d+-/.test(mesh.name) &&
      !mesh.name.includes("-roof-post-"),
    );
    const tenantInstances = scene.meshes.filter((mesh) =>
      /^prop-tokyo-tenant-\d+-/.test(mesh.name),
    );
    expect(campaignMasters).toHaveLength(TOKYO_AD_CREATIVES.length);
    expect(tenantMasters).toHaveLength(
      TOKYO_TENANT_CREATIVES.length * 2 + 8,
    );
    expect(campaignInstances).toHaveLength(plan.campaigns.length);
    expect(tenantInstances).toHaveLength(plan.tenantSigns.length);

    for (const [index, master] of campaignMasters.entries()) {
      expect(master.material).toBeInstanceOf(MultiMaterial);
      const materials = (master.material as MultiMaterial).subMaterials;
      expect(materials.map((material) => material?.name)).toEqual([
        "tokyo-ad-frame",
        `tokyo-ad-art-${TOKYO_AD_CREATIVES[index].id}`,
        `tokyo-ad-copy-${TOKYO_AD_CREATIVES[index].id}`,
      ]);
      expect(materials[0]).toBeInstanceOf(StandardMaterial);
      expect(materials[1]).toBeInstanceOf(StandardMaterial);
      expect(materials[2]).toBeInstanceOf(StandardMaterial);
      expect((materials[1] as StandardMaterial).emissiveTexture).toBeTruthy();
      expect((materials[2] as StandardMaterial).emissiveTexture).toBeInstanceOf(
        DynamicTexture,
      );
      expect((materials[1] as StandardMaterial).emissiveColor.r).toBeGreaterThan(
        1,
      );
      expect((materials[1] as StandardMaterial).specularPower).toBeGreaterThan(
        150,
      );
      const crop = tokyoAdAtlasUv(
        TOKYO_AD_CREATIVES[index].artIndex,
        TOKYO_AD_CREATIVES[index].artAtlas,
      );
      const artTexture = (materials[1] as StandardMaterial)
        .emissiveTexture as Texture;
      expect(artTexture.uOffset).toBeCloseTo(crop.uOffset + crop.uScale);
      expect(artTexture.uScale).toBeCloseTo(-crop.uScale);
      expect(artTexture.vOffset).toBeCloseTo(crop.vOffset + crop.vScale);
      expect(artTexture.vScale).toBeCloseTo(-crop.vScale);
      const copyTexture = (materials[2] as StandardMaterial)
        .emissiveTexture as DynamicTexture;
      expect(copyTexture.uOffset).toBe(1);
      expect(copyTexture.uScale).toBe(-1);
      expect(copyTexture.vOffset).toBe(1);
      expect(copyTexture.vScale).toBe(-1);
    }

    const tenantMaterials = scene.materials.filter((material) =>
      /^tokyo-tenant-(?:blade|fascia|directory)-/.test(material.name),
    );
    expect(tenantMaterials).toHaveLength(
      TOKYO_TENANT_CREATIVES.length * 2 + 8,
    );
    for (const material of tenantMaterials) {
      expect(material).toBeInstanceOf(StandardMaterial);
      expect((material as StandardMaterial).emissiveTexture).toBeInstanceOf(
        DynamicTexture,
      );
      expect((material as StandardMaterial).emissiveColor.r).toBeGreaterThan(1);
      const texture = (material as StandardMaterial)
        .emissiveTexture as DynamicTexture;
      expect(texture.uOffset).toBe(1);
      expect(texture.uScale).toBe(-1);
      expect(texture.vOffset).toBe(1);
      expect(texture.vScale).toBe(-1);
    }

    scene.dispose();
    engine.dispose();
  });

  it("never leaks Tokyo advertising into another map", () => {
    expect(
      tokyoAdvertisingPlan(
        { ...TOKYO_MAP_PACK, id: "nyc-upper-west-side" },
        buildingLayout,
      ),
    ).toEqual({ campaigns: [], tenantSigns: [] });
  });
});
