import {
  NullEngine,
  Scene,
  Mesh,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAIRO_BRIDGE_PARAPET_RAIL_POST_SPACING_M,
  CAIRO_BRIDGE_PARAPET_TOTAL_HEIGHT_M,
  buildElevatedRoadStructures,
  cairoBridgeBarrierVisualPlan,
} from "../app/game/render/elevatedRoadLayer";
import type { GameCanvasMapPack } from "../app/game/sessionContract";

type RoadSurface = NonNullable<
  GameCanvasMapPack["geometry"]["roadSurfaces"]
>[number];

const MAINLINE_ID = "cairo-sixth-october-bridge";
const RAMP_ID = "cairo-sixth-october-test-entry";

const surface = (
  id: string,
  centerline: RoadSurface["centerline"],
  parapetDepthM?: number,
): RoadSurface => ({
  id,
  centerline,
  widthM: 12,
  parapetDepthM,
  laneIds: [],
  surfaceType: "standard",
  markings: [],
});

const mainline = surface(MAINLINE_ID, [
  { x: 0, z: 0, elevationM: 8 },
  { x: 24, z: 0, elevationM: 8 },
], 0.36);

const ramp = surface(RAMP_ID, [
  { x: 0, z: 30, elevationM: 0 },
  { x: 24, z: 30, elevationM: 8 },
], 0.36);

interface RenderedRoadLayer {
  readonly engine: NullEngine;
  readonly scene: Scene;
  readonly meshes: readonly Mesh[];
}

const renderedLayers: RenderedRoadLayer[] = [];

const renderRoadLayer = (
  mapId: string,
  roadSurfaces: readonly RoadSurface[],
): RenderedRoadLayer => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const staticSceneryFreeze: TransformNode[] = [];
  const mapPack = {
    id: mapId,
    geometry: { roadSurfaces },
  } as unknown as GameCanvasMapPack;
  buildElevatedRoadStructures(
    {
      scene,
      staticSceneryFreeze,
      registerStatic: () => undefined,
      registerShadowCaster: () => undefined,
    },
    mapPack,
  );
  const rendered = {
    engine,
    scene,
    meshes: scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh),
  };
  renderedLayers.push(rendered);
  return rendered;
};

const meshesFor = (
  rendered: RenderedRoadLayer,
  surfaceId: string,
  fragment: string,
): Mesh[] =>
  rendered.meshes.filter(
    (mesh) => mesh.name.includes(surfaceId) && mesh.name.includes(fragment),
  ) as Mesh[];

const absoluteReflectorDistances = (
  lengthM: number,
  startDistanceM: number,
): number[] => {
  const plan = cairoBridgeBarrierVisualPlan(lengthM, startDistanceM);
  const centerDistanceM = startDistanceM + lengthM / 2;
  return plan.reflectorOffsetsM.map((offsetM) =>
    Number((centerDistanceM + offsetM).toFixed(6)),
  );
};

const absoluteRailGridDistances = (
  lengthM: number,
  startDistanceM: number,
): number[] => {
  const centerDistanceM = startDistanceM + lengthM / 2;
  return cairoBridgeBarrierVisualPlan(lengthM, startDistanceM).railPostOffsetsM
    .map((offsetM) => centerDistanceM + offsetM)
    .filter(
      (distanceM) =>
        Math.abs(
          distanceM / CAIRO_BRIDGE_PARAPET_RAIL_POST_SPACING_M -
            Math.round(distanceM / CAIRO_BRIDGE_PARAPET_RAIL_POST_SPACING_M),
        ) < 1e-6,
    )
    .map((distanceM) => Number(distanceM.toFixed(6)));
};

afterEach(() => {
  for (const rendered of renderedLayers.splice(0)) {
    rendered.scene.dispose();
    rendered.engine.dispose();
  }
});

describe("elevated road barrier rendering", () => {
  it("keeps Cairo posts and reflectors on one deterministic global phase", () => {
    const whole = cairoBridgeBarrierVisualPlan(24, 0);
    expect(cairoBridgeBarrierVisualPlan(24, 0)).toEqual(whole);

    const splitReflectors = [
      ...absoluteReflectorDistances(12, 0),
      ...absoluteReflectorDistances(12, 12),
    ];
    expect(splitReflectors).toEqual(absoluteReflectorDistances(24, 0));
    expect(splitReflectors).toEqual([9, 18]);

    expect([
      ...absoluteRailGridDistances(12, 0),
      ...absoluteRailGridDistances(12, 12),
    ]).toEqual(absoluteRailGridDistances(24, 0));
  });

  it("renders Cairo's mainline as a profiled, dressed parapet within budget", () => {
    const rendered = renderRoadLayer("synthetic-cairo", [mainline, ramp]);
    const profiles = meshesFor(rendered, MAINLINE_ID, "-parapet-profile-");
    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      const positions = profile.getVerticesData(VertexBuffer.PositionKind);
      expect(positions, profile.name).not.toBeNull();
      expect(positions!.length / 3, profile.name).toBeGreaterThan(24);
      const crossSection = new Set<string>();
      for (let index = 0; index < positions!.length; index += 3) {
        crossSection.add(
          `${positions![index + 1].toFixed(3)}:${positions![index + 2].toFixed(3)}`,
        );
      }
      expect(crossSection.size, profile.name).toBeGreaterThan(4);
      expect(profile.material?.name).toBe("cairo-bridge-weathered-parapet");
      expect(profile.getBoundingInfo().boundingBox.extendSize.z * 2).toBeCloseTo(
        0.36,
        6,
      );
    }

    const expectedMainlineComponents = [
      ["-parapet-coping-", "cairo-bridge-sunlit-coping"],
      ["-reflector-backing-", "cairo-bridge-sunlit-coping"],
      ["-reflector-lens-", "elevated-road-amber-reflector"],
      ["-parapet-maintenance-rail-", "cairo-bridge-aged-green-steel"],
    ] as const;
    for (const [fragment, materialName] of expectedMainlineComponents) {
      const meshes = meshesFor(rendered, MAINLINE_ID, fragment);
      expect(meshes, fragment).toHaveLength(2);
      expect(
        meshes.every((mesh) => mesh.material?.name === materialName),
        fragment,
      ).toBe(true);
    }

    for (const lens of meshesFor(rendered, MAINLINE_ID, "-reflector-lens-")) {
      const sideMatch = lens.name.match(/-reflector-lens-(-?1)-/);
      expect(sideMatch, lens.name).not.toBeNull();
      const side = Number(sideMatch![1]);
      const backing = rendered.meshes.find(
        (mesh) =>
          mesh.name === lens.name.replace("reflector-lens", "reflector-backing"),
      );
      expect(backing, lens.name).toBeDefined();
      const lensZ = lens.getBoundingInfo().boundingBox.center.z;
      const backingZ = backing!.getBoundingInfo().boundingBox.center.z;
      expect(side * lensZ, lens.name).toBeLessThan(side * backingZ);
      expect(Math.sign(lensZ), lens.name).toBe(side);
      const lensMaterial = lens.material as StandardMaterial;
      expect(lensMaterial.diffuseColor.asArray()).toEqual([0.86, 0.62, 0.18]);
      expect(lensMaterial.emissiveColor.asArray()).toEqual([
        0.16,
        0.085,
        0.014,
      ]);
    }

    for (const rail of meshesFor(
      rendered,
      MAINLINE_ID,
      "-parapet-maintenance-rail-",
    )) {
      expect(rail.getBoundingInfo().boundingBox.maximum.y, rail.name).toBeCloseTo(
        CAIRO_BRIDGE_PARAPET_TOTAL_HEIGHT_M,
        6,
      );
    }

    // Two one-segment surfaces, both sides fully dressed, stay compact because
    // repeated posts and reflectors are batched into compound meshes.
    expect(rendered.meshes.length).toBeLessThanOrEqual(36);
  });

  it("keeps Cairo ramps solid beneath the maintenance rail", () => {
    const rendered = renderRoadLayer("synthetic-cairo", [ramp]);
    expect(meshesFor(rendered, RAMP_ID, "-parapet-profile-")).toHaveLength(2);
    expect(meshesFor(rendered, RAMP_ID, "-parapet-coping-")).toHaveLength(2);
    expect(meshesFor(rendered, RAMP_ID, "-parapet-maintenance-rail-")).toHaveLength(
      2,
    );
  });

  it("faces tapered collar slab tops upward and undersides downward", () => {
    const throughRoad = surface("cairo-test-collar-through", [
      { x: -36, z: 0, elevationM: 8 },
      { x: 0, z: 0, elevationM: 8 },
      { x: 36, z: 0, elevationM: 8 },
    ]);
    const branch = surface("cairo-test-collar-branch", [
      { x: 0, z: 0, elevationM: 8 },
      { x: 30, z: 24, elevationM: 6 },
    ]);
    const rendered = renderRoadLayer("synthetic-cairo", [throughRoad, branch]);
    const collar = rendered.meshes.find((mesh) =>
      mesh.name.endsWith("-collar-slab"),
    );
    expect(collar).toBeDefined();

    const indices = collar!.getIndices();
    const normals = collar!.getVerticesData(VertexBuffer.NormalKind);
    expect(indices).not.toBeNull();
    expect(normals).not.toBeNull();
    const averageTriangleNormalY = (triangleOffset: number): number =>
      [0, 1, 2].reduce(
        (sum, corner) =>
          sum + normals![indices![triangleOffset + corner] * 3 + 1],
        0,
      ) / 3;

    // Top and bottom triangles are emitted as a pair for each TIN face. This
    // guards the Babylon winding contract that previously culled the collar's
    // asphalt and slab top, exposing a broad gray underside at every taper.
    expect(averageTriangleNormalY(0)).toBeGreaterThan(0.9);
    expect(averageTriangleNormalY(3)).toBeLessThan(-0.9);
  });

  it("retains the generic simple box parapet outside Cairo", () => {
    const genericSurface = surface("generic-overpass", mainline.centerline);
    const rendered = renderRoadLayer("synthetic-london", [genericSurface]);
    const genericParapets = meshesFor(
      rendered,
      genericSurface.id,
      "-parapet-",
    ).filter((mesh) => !mesh.name.includes("-reflector-"));
    expect(genericParapets).toHaveLength(2);
    for (const parapet of genericParapets) {
      const positions = parapet.getVerticesData(VertexBuffer.PositionKind);
      expect(positions, parapet.name).not.toBeNull();
      expect(positions!.length / 3, parapet.name).toBe(24);
      expect(parapet.material?.name).toBe("elevated-road-dusty-concrete");
      expect(parapet.getBoundingInfo().boundingBox.extendSize.z * 2).toBeCloseTo(
        0.28,
        6,
      );
    }
    expect(meshesFor(rendered, genericSurface.id, "-parapet-profile-")).toHaveLength(
      0,
    );
    expect(meshesFor(rendered, genericSurface.id, "-parapet-coping-")).toHaveLength(
      0,
    );
    expect(meshesFor(rendered, genericSurface.id, "-reflector-lens-")).toHaveLength(
      0,
    );
    expect(
      meshesFor(rendered, genericSurface.id, "-parapet-maintenance-rail-"),
    ).toHaveLength(0);
    const marker = meshesFor(rendered, genericSurface.id, "-reflector-")[0];
    const markerMaterial = marker.material as StandardMaterial;
    expect(markerMaterial.diffuseColor.asArray()).toEqual([0.78, 0.52, 0.12]);
    expect(markerMaterial.emissiveColor.asArray()).toEqual([
      0.2,
      0.105,
      0.018,
    ]);
  });
});
