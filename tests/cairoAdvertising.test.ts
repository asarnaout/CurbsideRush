import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAIRO_AD_CREATIVES,
  cairoAdAtlasUv,
  cairoAdPlacements,
} from "../app/game/cairoAdvertising";
import { buildingPlacementConfig } from "../app/game/buildingSets";
import { getCareerVehicle } from "../app/game/career";
import { CAIRO_FREE_DRIVE, CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import { roadsidePropKeepOuts } from "../app/game/geometry/roadFurnitureLayout";
import { distanceToPolylineM } from "../app/game/visuals";

const ARABIC_RE = /[\u0600-\u06ff]/;
const CAIRO_BUILDING_LAYOUT = planMapBuildings(
  CAIRO_MAP_PACK,
  CAIRO_FREE_DRIVE.trafficSeed,
  relaxationPolicyForMap(CAIRO_MAP_PACK.id),
);
const cairoPlacements = () =>
  cairoAdPlacements(CAIRO_MAP_PACK, CAIRO_BUILDING_LAYOUT);

interface TestRect {
  readonly center: { readonly x: number; readonly z: number };
  readonly axisU: { readonly x: number; readonly z: number };
  readonly axisV: { readonly x: number; readonly z: number };
  readonly halfU: number;
  readonly halfV: number;
}

function testRect(
  center: { readonly x: number; readonly z: number },
  widthM: number,
  depthM: number,
  yawRad: number,
): TestRect {
  return {
    center,
    axisU: { x: Math.cos(yawRad), z: -Math.sin(yawRad) },
    axisV: { x: Math.sin(yawRad), z: Math.cos(yawRad) },
    halfU: widthM / 2,
    halfV: depthM / 2,
  };
}

function testRectsOverlap(first: TestRect, second: TestRect): boolean {
  const offset = {
    x: second.center.x - first.center.x,
    z: second.center.z - first.center.z,
  };
  const dot = (
    left: { readonly x: number; readonly z: number },
    right: { readonly x: number; readonly z: number },
  ): number => left.x * right.x + left.z * right.z;
  return [first.axisU, first.axisV, second.axisU, second.axisV].every(
    (axis) => {
      const separationM = Math.abs(dot(offset, axis));
      const firstRadiusM =
        first.halfU * Math.abs(dot(first.axisU, axis)) +
        first.halfV * Math.abs(dot(first.axisV, axis));
      const secondRadiusM =
        second.halfU * Math.abs(dot(second.axisU, axis)) +
        second.halfV * Math.abs(dot(second.axisV, axis));
      return separationM <= firstRadiusM + secondRadiusM;
    },
  );
}

function nearestRoadHeadingRad(
  point: { readonly x: number; readonly z: number },
  centerline: readonly { readonly x: number; readonly z: number }[],
): number {
  let nearestDistanceM = Number.POSITIVE_INFINITY;
  let nearestHeadingRad = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquaredM = dx * dx + dz * dz;
    if (lengthSquaredM < 1e-6) continue;
    const amount = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.x) * dx + (point.z - start.z) * dz) /
          lengthSquaredM,
      ),
    );
    const distanceM = Math.hypot(
      point.x - (start.x + dx * amount),
      point.z - (start.z + dz * amount),
    );
    if (distanceM < nearestDistanceM) {
      nearestDistanceM = distanceM;
      nearestHeadingRad = Math.atan2(dx, dz);
    }
  }
  return nearestHeadingRad;
}

function pointIsInsidePolygon(
  point: { readonly x: number; readonly z: number },
  polygon: readonly { readonly x: number; readonly z: number }[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    if (
      (left.z > point.z) !== (right.z > point.z) &&
      point.x <
        ((right.x - left.x) * (point.z - left.z)) /
          (right.z - left.z) +
          left.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function cairoPlannedVisualBuildingRects(): readonly {
  readonly id: string;
  readonly rect: TestRect;
}[] {
  return CAIRO_BUILDING_LAYOUT.buildings.flatMap((building) => {
    if (building.source === "asset-slot") {
      const config = buildingPlacementConfig(building.modelId);
      if (config) {
        return [
          {
            id: building.id,
            rect: testRect(
              { x: building.x, z: building.z },
              config.footprintM + 1,
              (config.depthM ?? config.footprintM) + 1,
              building.yaw,
            ),
          },
        ];
      }
    }
    return building.solids.map((solid) => ({
      id: building.id,
      rect: testRect(
        { x: solid.x, z: solid.z },
        solid.halfU * 2 + 1,
        solid.halfV * 2 + 1,
        Math.atan2(-solid.uz, solid.ux),
      ),
    }));
  });
}

describe("Cairo advertising", () => {
  it("keeps every campaign fictional, copy-led, and majority Arabic", () => {
    expect(CAIRO_AD_CREATIVES).toHaveLength(16);
    expect(CAIRO_AD_CREATIVES.filter((creative) => creative.language === "ar")).toHaveLength(14);
    expect(
      CAIRO_AD_CREATIVES.filter((creative) => ARABIC_RE.test(creative.headline)),
    ).toHaveLength(14);
    expect(
      CAIRO_AD_CREATIVES.filter((creative) => ARABIC_RE.test(creative.subline))
        .length,
    ).toBeGreaterThanOrEqual(15);
    expect(new Set(CAIRO_AD_CREATIVES.map((creative) => creative.id)).size).toBe(16);
    for (const atlasId of ["v1", "v2"] as const) {
      expect(
        CAIRO_AD_CREATIVES.filter((creative) => creative.artAtlas === atlasId)
          .map((creative) => creative.artIndex)
          .sort((left, right) => left - right),
      ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }

    const allCopy = CAIRO_AD_CREATIVES.flatMap((creative) => [
      creative.headline,
      creative.subline,
    ])
      .join(" ")
      .toLowerCase();
    for (const excluded of [
      "coca-cola",
      "pepsi",
      "vodafone",
      "orange",
      "lg",
      "toshiba",
      "b.tech",
      "mall of egypt",
      "rolex",
      "apple",
      "samsung",
      "emirates",
      "chanel",
    ]) {
      expect(allCopy).not.toContain(excluded);
    }
  });

  it("crops every irregular atlas cell without sampling a neighbouring campaign", () => {
    const expectedRowsByAtlas = {
      v1: [
        [2, 247],
        [251, 476],
        [480, 672],
        [676, 885],
      ],
      v2: [
        [2, 239],
        [243, 454],
        [458, 666],
        [670, 885],
      ],
    } as const;
    for (const atlasId of ["v1", "v2"] as const) {
      for (let artIndex = 0; artIndex < 8; artIndex += 1) {
        const crop = cairoAdAtlasUv(artIndex, atlasId);
        const leftPx = crop.uOffset * 1774;
        const rightPx = (crop.uOffset + crop.uScale) * 1774;
        const topPx = (1 - (crop.vOffset + crop.vScale)) * 887;
        const bottomPx = (1 - crop.vOffset) * 887;
        const [expectedTopPx, expectedBottomPx] =
          expectedRowsByAtlas[atlasId][Math.floor(artIndex / 2)];
        expect(leftPx).toBeCloseTo(artIndex % 2 === 0 ? 2 : 889);
        expect(rightPx).toBeCloseTo(artIndex % 2 === 0 ? 885 : 1772);
        expect(topPx).toBeCloseTo(expectedTopPx);
        expect(bottomPx).toBeCloseTo(expectedBottomPx);
      }
    }
  });

  it("pins both committed atlas dimensions and bytes to the measured UV crops", () => {
    const expectedHashes = {
      v1: "dc1a59cca3a8437850792d915eebe9d40387764306fb383f2b5203b4499a7edb",
      v2: "307a0aa891530a1ea425079e64fa28ae32bf76491ebec9db3e96eca3545700fc",
    } as const;
    for (const atlasId of ["v1", "v2"] as const) {
      const bytes = readFileSync(
        `public/art/cairo/fictional-ad-atlas-${atlasId}.png`,
      );
      expect(bytes.readUInt32BE(16)).toBe(1774);
      expect(bytes.readUInt32BE(20)).toBe(887);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        expectedHashes[atlasId],
      );
    }
  });

  it("fills Cairo's arterials with repeated pole campaigns and skyline-scale boards", () => {
    const placements = cairoPlacements();
    const poleBanners = placements.filter(
      (placement) => placement.kind === "pole-banner",
    );
    const skylineBoards = placements.filter(
      (placement) => placement.kind === "skyline-billboard",
    );
    const bridgeGantries = placements.filter(
      (placement) => placement.kind === "bridge-gantry",
    );
    const bridgeSideSigns = placements.filter(
      (placement) => placement.kind === "bridge-side-sign",
    );

    expect(poleBanners.length).toBeGreaterThanOrEqual(625);
    // This exact count is intentional: gap resolution adds every nominal slot
    // instead of quietly solving a collision by deleting a board.
    expect(skylineBoards).toHaveLength(69);
    expect(bridgeSideSigns.length).toBeGreaterThanOrEqual(30);
    expect(bridgeGantries.length).toBeGreaterThanOrEqual(10);
    expect(new Set(placements.map((placement) => placement.id)).size).toBe(
      placements.length,
    );
    expect(new Set(poleBanners.map((placement) => placement.sourceRoadId)).size).toBe(27);
    expect(new Set(skylineBoards.map((placement) => placement.sourceRoadId)).size).toBe(13);
    expect(
      new Set(bridgeSideSigns.map((placement) => placement.sourceRoadId)),
    ).toEqual(new Set(["cairo-sixth-october-bridge"]));
    expect(new Set(placements.map((placement) => placement.creativeIndex))).toEqual(
      new Set(Array.from({ length: 16 }, (_, index) => index)),
    );
    for (const road of CAIRO_MAP_PACK.geometry.roadSurfaces ?? []) {
      const lengthM = road.centerline.slice(1).reduce(
        (total, point, index) =>
          total +
          Math.hypot(
            point.x - road.centerline[index].x,
            point.z - road.centerline[index].z,
          ),
        0,
      );
      const roadPoleCount = poleBanners.filter(
        (placement) => placement.sourceRoadId === road.id,
      ).length;
      if (lengthM > 1_500 && !road.id.startsWith("cairo-sixth-october")) {
        expect(roadPoleCount).toBeGreaterThanOrEqual(20);
      } else if (lengthM > 600 && !road.id.startsWith("cairo-sixth-october")) {
        expect(roadPoleCount).toBeGreaterThanOrEqual(8);
      }
    }
    expect(new Set(bridgeGantries.map((placement) => placement.sourceRoadId))).toEqual(
      new Set([
        "cairo-sixth-october-bridge",
        "cairo-qasr-el-nil-bridge",
        "cairo-al-galaa-bridge",
      ]),
    );
    expect(
      bridgeGantries.filter(
        (placement) =>
          placement.sourceRoadId === "cairo-sixth-october-bridge",
      ),
    ).toHaveLength(8);
    for (const gantry of bridgeGantries) {
      const road = (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).find(
        (candidate) => candidate.id === gantry.sourceRoadId,
      )!;
      expect(gantry.widthM).toBeGreaterThan(road.widthM + 4.5);
      expect(gantry.panelCenterYM - gantry.heightM / 2).toBeGreaterThan(6.5);
      expect(gantry.supportOffsetM).toBeGreaterThan(
        road.widthM / 2 + (road.parapetDepthM ?? 0) + 0.5,
      );
    }

    const cornicheExit = (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).find(
      (road) => road.id === "cairo-sixth-october-bridge-corniche-exit",
    )!;
    const cornicheGantry = bridgeGantries.find(
      (placement) =>
        placement.id ===
        "cairo-ad-bridge-gantry-cairo-sixth-october-bridge-4",
    )!;
    expect(cornicheGantry, "The Corniche billboard must be retained").toBeDefined();
    const gantrySupportOffsetM = cornicheGantry.supportOffsetM!;
    const deliveryVan = getCareerVehicle("delivery-van");
    const supportHalfDiagonalM = Math.hypot(0.2, 0.2);
    const roadsideMarginM = 0.5;
    const requiredCenterlineClearanceM =
      cornicheExit.widthM / 2 +
      deliveryVan.physics.playerCapsuleRadiusM +
      supportHalfDiagonalM +
      roadsideMarginM;
    for (const side of [-1, 1] as const) {
      const support = {
        x:
          cornicheGantry.position.x +
          Math.cos(cornicheGantry.headingRad) * gantrySupportOffsetM * side,
        z:
          cornicheGantry.position.z -
          Math.sin(cornicheGantry.headingRad) * gantrySupportOffsetM * side,
      };
      expect(
        distanceToPolylineM(support, cornicheExit.centerline),
        `Corniche gantry support ${side} must stay behind the exit gore`,
      ).toBeGreaterThan(requiredCenterlineClearanceM);
    }

    const sixthOctoberGantries = bridgeGantries.filter(
      (placement) => placement.sourceRoadId === "cairo-sixth-october-bridge",
    );
    expect(
      Math.max(...sixthOctoberGantries.map((placement) => placement.position.x)) -
        Math.min(...sixthOctoberGantries.map((placement) => placement.position.x)),
    ).toBeGreaterThan(1_000);
    expect(
      Math.max(...bridgeSideSigns.map((placement) => placement.position.x)) -
        Math.min(...bridgeSideSigns.map((placement) => placement.position.x)),
    ).toBeGreaterThan(1_000);
    const leftSideSignCount = bridgeSideSigns.filter(
      (placement) => placement.side === -1,
    ).length;
    const rightSideSignCount = bridgeSideSigns.filter(
      (placement) => placement.side === 1,
    ).length;
    expect(Math.min(leftSideSignCount, rightSideSignCount)).toBeGreaterThanOrEqual(16);
    expect(Math.abs(leftSideSignCount - rightSideSignCount)).toBeLessThanOrEqual(2);
    const sixthOctoberRoad = (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).find(
      (road) => road.id === "cairo-sixth-october-bridge",
    )!;
    for (const sign of bridgeSideSigns) {
      const distanceFromCenterM = distanceToPolylineM(
        sign.position,
        sixthOctoberRoad.centerline,
      );
      const innerFrameEdgeM = distanceFromCenterM - (sign.widthM + 0.18) / 2;
      expect(innerFrameEdgeM).toBeGreaterThan(
        sixthOctoberRoad.widthM / 2 +
          (sixthOctoberRoad.parapetDepthM ?? 0),
      );
      expect(sign.side === -1 || sign.side === 1).toBe(true);
      expect(sign.panelCenterYM - sign.heightM / 2).toBeGreaterThan(3.3);
      for (const gantry of sixthOctoberGantries) {
        expect(
          Math.hypot(
            sign.position.x - gantry.position.x,
            sign.position.z - gantry.position.z,
          ),
        ).toBeGreaterThan(15);
      }
    }
    expect(
      skylineBoards.every(
        (placement) =>
          placement.widthM >= 14 &&
          placement.heightM >= 3.8 &&
          placement.panelCenterYM >= 12.8,
      ),
    ).toBe(true);
  });

  it("keeps every pole-banner support in its source pavement band and out of every crossing road", () => {
    const roads = new Map(
      (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).map((road) => [road.id, road]),
    );
    const poleBanners = cairoPlacements().filter(
      (placement) => placement.kind === "pole-banner",
    );
    for (const ad of poleBanners) {
      const source = roads.get(ad.sourceRoadId)!;
      const sourceDistanceM = distanceToPolylineM(
        ad.position,
        source.centerline,
      );
      const distancePastKerbM = sourceDistanceM - source.widthM / 2;
      expect(distancePastKerbM).toBeGreaterThanOrEqual(1.3);
      expect(distancePastKerbM).toBeLessThanOrEqual(
        (source.sidewalkWidthM ?? 2.6) - 0.7,
      );

      for (const road of roads.values()) {
        if (road.id === source.id) continue;
        expect(distanceToPolylineM(ad.position, road.centerline)).toBeGreaterThan(
          road.widthM / 2 + 2,
        );
      }
    }
  });

  it("puts every readable skyline installation in a real gap clear of roads and rendered buildings", () => {
    const skylineBoards = cairoPlacements().filter(
      (placement) => placement.kind === "skyline-billboard",
    );
    const roadRects = (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).flatMap(
      (road) =>
        road.centerline.slice(1).map((end, index) => {
          const start = road.centerline[index];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthM = Math.hypot(dx, dz);
          return {
            id: road.id,
            rect: {
              center: {
                x: (start.x + end.x) / 2,
                z: (start.z + end.z) / 2,
              },
              axisU: { x: dx / lengthM, z: dz / lengthM },
              axisV: { x: -dz / lengthM, z: dx / lengthM },
              // Include the same 25 cm buffer around pavement and joins that
              // the placement resolver must clear.
              halfU: lengthM / 2 + 0.25,
              halfV: road.widthM / 2 + 0.25,
            } satisfies TestRect,
          };
        }),
    );
    const buildingRects = cairoPlannedVisualBuildingRects();
    expect(buildingRects.length).toBeGreaterThan(6_000);
    const broadParcelRects = CAIRO_MAP_PACK.geometry.blocks.map((block) => ({
      id: block.id,
      rect: testRect(
        block.center,
        block.size.x,
        block.size.z,
        ((block.headingDeg ?? 0) * Math.PI) / 180,
      ),
    }));
    const keepOutRects = (() => {
      const keepOuts = roadsidePropKeepOuts(CAIRO_MAP_PACK);
      return [...keepOuts.hardRects, ...keepOuts.roadCrossedRects].map(
        (rect, index) => ({
          id: `keep-out-${index}`,
          rect: testRect(
            rect.center,
            rect.size.x + 1,
            rect.size.z + 1,
            ((rect.headingDeg ?? 0) * Math.PI) / 180,
          ),
        }),
      );
    })();
    let boardsInsideARealParcelGap = 0;

    for (const board of skylineBoards) {
      const installation = testRect(
        board.position,
        board.widthM + 0.55,
        1.08,
        board.headingRad,
      );
      expect(
        roadRects.filter((road) => testRectsOverlap(installation, road.rect)),
        `${board.id} projects into a drivable road`,
      ).toEqual([]);
      expect(
        buildingRects.filter((building) =>
          testRectsOverlap(installation, building.rect),
        ),
        `${board.id} meshes into a rendered building`,
      ).toEqual([]);
      expect(
        keepOutRects.filter((keepOut) =>
          testRectsOverlap(installation, keepOut.rect),
        ),
        `${board.id} occupies a landmark, park, rail, or POI reservation`,
      ).toEqual([]);

      const sourceRoad = (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).find(
        (road) => road.id === board.sourceRoadId,
      )!;
      const sourceHeadingRad = nearestRoadHeadingRad(
        board.position,
        sourceRoad.centerline,
      );
      const signedDeltaDeg =
        ((((board.headingRad - sourceHeadingRad) * 180) / Math.PI + 540) %
          360) -
        180;
      // Every current board finds a proper opening without falling back from
      // the original, strongly driver-facing 55-degree cant.
      expect(Math.abs(signedDeltaDeg)).toBeCloseTo(55, 5);

      const supportProbes = [
        board.position,
        ...Array.from({ length: 8 }, (_, index) => ({
          x: board.position.x + Math.cos((index * Math.PI) / 4) * 0.5,
          z: board.position.z + Math.sin((index * Math.PI) / 4) * 0.5,
        })),
      ];
      expect(
        supportProbes.some((probe) =>
          (CAIRO_MAP_PACK.geometry.waterBodies ?? []).some((water) =>
            pointIsInsidePolygon(probe, water.polygon),
          ),
        ),
        `${board.id} pedestal reaches open water`,
      ).toBe(false);

      if (
        broadParcelRects.some((block) =>
          testRectsOverlap(installation, block.rect),
        )
      ) {
        boardsInsideARealParcelGap += 1;
      }
    }

    // This proves the resolver uses individual rendered-building gaps rather
    // than merely pushing every board outside coarse whole-block rectangles.
    expect(boardsInsideARealParcelGap).toBeGreaterThan(0);

    for (let index = 0; index < skylineBoards.length; index += 1) {
      const first = skylineBoards[index];
      const firstInstallation = testRect(
        first.position,
        first.widthM + 0.55 + 1.4,
        1.08 + 1.4,
        first.headingRad,
      );
      for (let otherIndex = index + 1; otherIndex < skylineBoards.length; otherIndex += 1) {
        const second = skylineBoards[otherIndex];
        const secondInstallation = testRect(
          second.position,
          second.widthM + 0.55,
          1.08,
          second.headingRad,
        );
        expect(
          testRectsOverlap(firstInstallation, secondInstallation),
          `${first.id} overlaps ${second.id}`,
        ).toBe(false);
        if (first.sourceRoadId === second.sourceRoadId) {
          expect(
            Math.hypot(
              first.position.x - second.position.x,
              first.position.z - second.position.z,
            ),
          ).toBeGreaterThanOrEqual(50);
        }
      }
    }
  });

  it("distributes advertising across west bank, island, east bank, and the full north-south map", () => {
    const poles = cairoPlacements().filter(
      (placement) => placement.kind === "pole-banner",
    );
    expect(poles.filter((placement) => placement.position.x < -500).length).toBeGreaterThan(100);
    expect(
      poles.filter(
        (placement) => placement.position.x >= -500 && placement.position.x < 0,
      ).length,
    ).toBeGreaterThan(130);
    expect(poles.filter((placement) => placement.position.x >= 0).length).toBeGreaterThan(250);
    for (const zCenter of [-700, -350, 0, 350, 700]) {
      expect(
        poles.filter(
          (placement) => Math.abs(placement.position.z - zCenter) < 150,
        ).length,
      ).toBeGreaterThan(70);
    }
  });

  it("repeats pole creatives in campaign runs while using the expanded set", () => {
    const corniche = cairoPlacements().filter(
      (placement) =>
        placement.kind === "pole-banner" &&
        placement.sourceRoadId === "cairo-corniche-el-nil",
    );
    const transitionCount = corniche.slice(1).filter(
      (placement, index) =>
        placement.creativeIndex !== corniche[index].creativeIndex,
    ).length;
    expect(transitionCount).toBeLessThan(corniche.length / 4);
    expect(new Set(corniche.map((placement) => placement.creativeIndex)).size).toBeGreaterThanOrEqual(6);
  });

  it("never leaks Cairo advertising into another city", () => {
    expect(cairoAdPlacements(NYC_MAP_PACK)).toEqual([]);
  });
});
