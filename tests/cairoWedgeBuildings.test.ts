import {
  NullEngine,
  Scene,
  StandardMaterial,
  VertexBuffer,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import {
  CAIRO_DOWNTOWN_WEDGE_BUILDINGS,
  CAIRO_DOWNTOWN_WEDGE_LANDMARKS,
} from "../app/game/geometry/cairoWedgeBuildings";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
} from "../app/game/cities/cairo";
import { landmarkGroundSolids } from "../app/game/geometry/landmarkGroundSolids";
import {
  booleanIntersectionArea,
  collectGroundSurfaces,
} from "../app/game/geometry/visualSceneFootprints";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import {
  buildCairoLandmark,
  type CairoLandmarkCtx,
} from "../app/game/render/cairoLandmarks";
import type { WorldPoint } from "../app/game/types";

const signedArea = (points: readonly WorldPoint[]): number =>
  points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0) / 2;

const pointSegmentDistance = (
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const amount = lengthSq
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.z - start.z) * dz) /
            lengthSq,
        ),
      )
    : 0;
  return Math.hypot(
    point.x - (start.x + amount * dx),
    point.z - (start.z + amount * dz),
  );
};

const orientation = (a: WorldPoint, b: WorldPoint, c: WorldPoint): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

const segmentsIntersect = (
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint,
): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
};

const segmentDistance = (
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint,
): number =>
  segmentsIntersect(a, b, c, d)
    ? 0
    : Math.min(
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
      );

const solidPolygon = (
  solid: ReturnType<typeof planMapBuildings>["buildings"][number]["solids"][number],
): readonly WorldPoint[] => {
  const vx = -solid.uz;
  const vz = solid.ux;
  return [
    {
      x: solid.x + solid.ux * solid.halfU + vx * solid.halfV,
      z: solid.z + solid.uz * solid.halfU + vz * solid.halfV,
    },
    {
      x: solid.x - solid.ux * solid.halfU + vx * solid.halfV,
      z: solid.z - solid.uz * solid.halfU + vz * solid.halfV,
    },
    {
      x: solid.x - solid.ux * solid.halfU - vx * solid.halfV,
      z: solid.z - solid.uz * solid.halfU - vz * solid.halfV,
    },
    {
      x: solid.x + solid.ux * solid.halfU - vx * solid.halfV,
      z: solid.z + solid.uz * solid.halfU - vz * solid.halfV,
    },
  ];
};

describe("Cairo downtown wedge buildings", () => {
  it("authors all five non-park Tahrir sectors as substantial clockwise convex buildings", () => {
    expect(CAIRO_DOWNTOWN_WEDGE_BUILDINGS).toHaveLength(5);
    expect(CAIRO_DOWNTOWN_WEDGE_LANDMARKS).toHaveLength(5);

    for (const building of CAIRO_DOWNTOWN_WEDGE_BUILDINGS) {
      expect(building.footprint).toHaveLength(4);
      expect(signedArea(building.footprint), building.id).toBeLessThan(-60);
      expect(building.heightM, building.id).toBeGreaterThanOrEqual(29);
      expect(building.heightM, building.id).toBeLessThanOrEqual(34);
      expect(building.stories, building.id).toBeGreaterThanOrEqual(7);
      expect(building.stories, building.id).toBeLessThanOrEqual(8);

      const turns = building.footprint.map((point, index) =>
        orientation(
          point,
          building.footprint[(index + 1) % building.footprint.length],
          building.footprint[(index + 2) % building.footprint.length],
        ),
      );
      expect(turns.every((turn) => turn < -1e-4), building.id).toBe(true);

      const landmark = CAIRO_DOWNTOWN_WEDGE_LANDMARKS.find(
        (candidate) => candidate.id === building.id,
      );
      expect(landmark, building.id).toBeDefined();
      expect(
        CAIRO_MAP_PACK.geometry.landmarks.some(
          (candidate) => candidate.id === building.id,
        ),
        building.id,
      ).toBe(true);
      expect(landmark?.kind).toBe("shops");
    }

    const markedNortheast = CAIRO_DOWNTOWN_WEDGE_BUILDINGS.find(
      (building) => building.id === "cairo-downtown-wedge-northeast",
    );
    expect(Math.abs(signedArea(markedNortheast?.footprint ?? []))).toBeGreaterThan(
      2_000,
    );
  });

  it("tucks every long facade 0.55 m behind its real sidewalk without touching any road", () => {
    const ground = collectGroundSurfaces(CAIRO_MAP_PACK);
    const hardRoadGround = ground.filter(
      (surface) =>
        surface.kind === "road" ||
        surface.kind === "sidewalk" ||
        surface.kind === "junction",
    );
    const tahrirLawn = ground.find(
      (surface) => surface.id === "park-cairo-tahrir-square",
    );
    expect(tahrirLawn).toBeDefined();

    for (const building of CAIRO_DOWNTOWN_WEDGE_BUILDINGS) {
      const shape = { kind: "polygon" as const, outer: building.footprint };
      for (const surface of hardRoadGround) {
        expect(
          booleanIntersectionArea(shape, surface.geometry),
          `${building.id} overlaps ${surface.id}`,
        ).toBeLessThan(1e-6);
      }
      if (tahrirLawn) {
        expect(
          booleanIntersectionArea(shape, tahrirLawn.geometry),
          `${building.id} overlaps the Tahrir lawn`,
        ).toBeLessThan(1e-6);
      }

      for (const streetEdge of building.streetEdges) {
        const road = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
          (surface) => surface.id === streetEdge.roadId,
        );
        expect(road, `${building.id}:${streetEdge.roadId}`).toBeDefined();
        if (!road) continue;
        const a = building.footprint[streetEdge.edgeIndex];
        const b =
          building.footprint[
            (streetEdge.edgeIndex + 1) % building.footprint.length
          ];
        const centerlineDistance = Math.min(
          ...road.centerline.slice(1).map((end, index) =>
            segmentDistance(a, b, road.centerline[index], end),
          ),
        );
        const sidewalkGap =
          centerlineDistance -
          road.widthM / 2 -
          (road.sidewalkWidthM ?? 2.8);
        expect(sidewalkGap, `${building.id}:${road.id}`).toBeGreaterThan(0.49);
        expect(sidewalkGap, `${building.id}:${road.id}`).toBeLessThan(0.61);
      }
    }
  });

  it("stops before every existing building and uses its exact footprint for collision", () => {
    const plan = planMapBuildings(CAIRO_MAP_PACK, CAIRO_FREE_DRIVE.trafficSeed);
    for (const wedge of CAIRO_DOWNTOWN_WEDGE_BUILDINGS) {
      const wedgeShape = { kind: "polygon" as const, outer: wedge.footprint };
      for (const building of plan.buildings) {
        if (Math.hypot(building.solids[0].x - 320, building.solids[0].z + 105) > 170) {
          continue;
        }
        for (const solid of building.solids) {
          expect(
            booleanIntersectionArea(wedgeShape, {
              kind: "polygon",
              outer: solidPolygon(solid),
            }),
            `${wedge.id} overlaps ${building.id}`,
          ).toBeLessThan(1e-6);
        }
      }

      const landmark = CAIRO_DOWNTOWN_WEDGE_LANDMARKS.find(
        (candidate) => candidate.id === wedge.id,
      );
      expect(landmark, wedge.id).toBeDefined();
      if (!landmark) continue;
      expect(landmarkGroundSolids(CAIRO_MAP_PACK.id, landmark)).toEqual([
        {
          kind: "convex",
          id: `${wedge.id}:footprint`,
          points: wedge.footprint,
        },
      ]);
    }
  });

  it("renders each wedge as a detailed stone shell with shops, balconies and a corner crown", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const frozenRoots: CairoLandmarkCtx["staticSceneryFreeze"] extends readonly (
      infer Entry
    )[]
      ? Entry[]
      : never = [];
    const ctx: CairoLandmarkCtx = {
      scene,
      visualPalette: {} as CairoLandmarkCtx["visualPalette"],
      staticSceneryFreeze: frozenRoots,
      buildFlatPolygonMesh: () => undefined,
      buildParkLawnPolygon: () => undefined,
    };

    for (const landmark of CAIRO_DOWNTOWN_WEDGE_LANDMARKS) {
      const handled = buildCairoLandmark(
        ctx,
        landmark,
        new StandardMaterial(`${landmark.id}-unused-fallback`, scene),
        CAIRO_MAP_PACK,
      );
      expect(handled, landmark.id).toBe(true);
      const shell = scene.getMeshByName(`${landmark.id}-shell`);
      expect(shell, landmark.id).toBeDefined();
      const positions = shell?.getVerticesData(VertexBuffer.PositionKind);
      const normals = shell?.getVerticesData(VertexBuffer.NormalKind);
      expect(positions?.length, landmark.id).toBe(72);
      expect(shell?.getIndices()?.slice(0, 6), landmark.id).toEqual([
        0, 2, 1, 0, 3, 2,
      ]);
      expect(shell?.getTotalIndices(), `${landmark.id} closed prism`).toBe(36);
      const first = CAIRO_DOWNTOWN_WEDGE_BUILDINGS.find(
        (building) => building.id === landmark.id,
      );
      const dx = (first?.footprint[1].x ?? 0) - (first?.footprint[0].x ?? 0);
      const dz = (first?.footprint[1].z ?? 0) - (first?.footprint[0].z ?? 0);
      const length = Math.hypot(dx, dz);
      expect(
        ((normals?.[0] ?? 0) * -dz + (normals?.[2] ?? 0) * dx) / length,
        `${landmark.id} first facade normal faces its street`,
      ).toBeGreaterThan(0.99);
      const root = scene.getTransformNodeByName(landmark.id);
      expect(root, landmark.id).toBeDefined();
      expect(root?.getChildMeshes().length, landmark.id).toBeGreaterThan(45);
      expect(scene.getMeshByName(`${landmark.id}-corner-cap`), landmark.id).toBeDefined();
      expect(
        root
          ?.getChildMeshes()
          .some((mesh) => mesh.name.includes("-shop-")),
        landmark.id,
      ).toBe(true);
      expect(
        root
          ?.getChildMeshes()
          .some((mesh) => mesh.name.includes("-balcony-")),
        landmark.id,
      ).toBe(true);
    }

    expect(frozenRoots).toHaveLength(5);
    scene.dispose();
    engine.dispose();
  });
});
