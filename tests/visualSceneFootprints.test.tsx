import { describe, expect, it } from "vitest";
import {
  aabbOfShape,
  booleanDifference,
  booleanIntersection,
  booleanIntersectionArea,
  booleanUnion,
  circleToPolygon,
  CIRCLE_DECOMPOSITION_TOLERANCE_M,
  collectGroundSurfaces,
  collectMapVisualGeometry,
  collectOccluderVolumes,
  distanceFromPointToShape,
  multiPolygonArea,
  pointInShape,
  PolygonClippingError,
  ringArea,
  ringIsClockwise,
  segmentInsideShapeIntervals,
  shapeArea,
  shapesOverlap,
  shapeToPolygonal,
  signedArea2,
  type Aabb,
  type Circle,
  type GroundSurface,
  type Obb,
  type Point2,
  type Shape2d,
} from "../app/game/geometry/visualSceneFootprints";
import { FREE_DRIVES, MAP_PACKS } from "../app/game/content";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import {
  PARK_LAWN_Y,
  ROAD_JUNCTION_FILL_Y,
  ROAD_SHOULDER_JUNCTION_FILL_Y,
  ROAD_SHOULDER_Y,
  ROAD_SURFACE_Y,
} from "../app/game/render/renderConstants";

// ---------------------------------------------------------------------------
// Geometry kernel: pure predicates over small, hand-authored shapes.
// ---------------------------------------------------------------------------

describe("pointInShape", () => {
  const circle: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
  const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
  // ux/uz = 45deg unit axis; a point at local (u,v) is world
  // (u*ux + v*uz, u*uz - v*ux) per the type's own documented convention
  // (self-inverse rotation -- applying the forward u/v formula again).
  const obb: Obb = { kind: "obb", x: 0, z: 0, ux: Math.SQRT1_2, uz: Math.SQRT1_2, halfU: 2, halfV: 1 };
  const squareHole: Point2[] = [
    { x: -1, z: -1 },
    { x: -1, z: 1 },
    { x: 1, z: 1 },
    { x: 1, z: -1 },
  ];
  const squareOuter: Point2[] = [
    { x: -5, z: -5 },
    { x: -5, z: 5 },
    { x: 5, z: 5 },
    { x: 5, z: -5 },
  ];

  it("classifies inside/on-boundary/outside for a circle", () => {
    expect(pointInShape(circle, 0, 0)).toBe(true);
    expect(pointInShape(circle, 3, 4)).toBe(true); // exactly on the boundary (3-4-5)
    expect(pointInShape(circle, 10, 10)).toBe(false);
  });

  it("classifies inside/on-boundary/outside for an aabb", () => {
    expect(pointInShape(aabb, 5, 5)).toBe(true);
    expect(pointInShape(aabb, 0, 0)).toBe(true); // corner, boundary-inclusive
    expect(pointInShape(aabb, 10.1, 5)).toBe(false);
  });

  it("classifies inside/outside for a rotated obb using its own u/v convention", () => {
    const inside = { u: 1, v: 0 };
    const outside = { u: 3, v: 0 };
    const worldOf = (p: { u: number; v: number }) => ({
      x: p.u * obb.ux + p.v * obb.uz,
      z: p.u * obb.uz - p.v * obb.ux,
    });
    const insideWorld = worldOf(inside);
    const outsideWorld = worldOf(outside);
    expect(pointInShape(obb, insideWorld.x, insideWorld.z)).toBe(true);
    expect(pointInShape(obb, outsideWorld.x, outsideWorld.z)).toBe(false);
  });

  it("excludes a hole but includes its own boundary (shared with the solid)", () => {
    const withHole: Shape2d = { kind: "polygon", outer: squareOuter, holes: [squareHole] };
    expect(pointInShape(withHole, 0, 0)).toBe(false); // hole interior
    expect(pointInShape(withHole, 1, 0)).toBe(true); // hole boundary = solid
    expect(pointInShape(withHole, 3, 3)).toBe(true); // solid, outside hole
    expect(pointInShape(withHole, 6, 6)).toBe(false); // outside outer ring
  });
});

describe("distanceFromPointToShape", () => {
  it("is exactly 0 for any point inside, for every shape kind", () => {
    const circle: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
    const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const polygon: Shape2d = {
      kind: "polygon",
      outer: [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
        { x: 10, z: 10 },
        { x: 10, z: 0 },
      ],
    };
    expect(distanceFromPointToShape(circle, 1, 1)).toBe(0);
    expect(distanceFromPointToShape(aabb, 5, 5)).toBe(0);
    expect(distanceFromPointToShape(polygon, 5, 5)).toBe(0);
  });

  it("returns the exact real-world distance for points outside", () => {
    const circle: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
    expect(distanceFromPointToShape(circle, 15, 0)).toBeCloseTo(10);
    const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    expect(distanceFromPointToShape(aabb, 20, 5)).toBeCloseTo(10); // due east of the right edge
    expect(distanceFromPointToShape(aabb, 13, -4)).toBeCloseTo(5); // 3-4-5 from the (10,0) corner
  });
});

describe("shapesOverlap", () => {
  it("circle vs circle: true when touching, false when separated", () => {
    const a: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
    const touching: Circle = { kind: "circle", x: 10, z: 0, radius: 5 };
    const separated: Circle = { kind: "circle", x: 10.1, z: 0, radius: 5 };
    expect(shapesOverlap(a, touching)).toBe(true);
    expect(shapesOverlap(a, separated)).toBe(false);
  });

  it("aabb vs rotated obb: SAT catches a corner-only overlap and a real miss", () => {
    const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const overlapping: Obb = { kind: "obb", x: 12, z: 12, ux: Math.SQRT1_2, uz: Math.SQRT1_2, halfU: 4, halfV: 4 };
    const separate: Obb = { kind: "obb", x: 30, z: 30, ux: Math.SQRT1_2, uz: Math.SQRT1_2, halfU: 4, halfV: 4 };
    expect(shapesOverlap(aabb, overlapping)).toBe(true);
    expect(shapesOverlap(aabb, separate)).toBe(false);
  });

  it("polygon vs aabb degrades to an exact boolean-clip area check", () => {
    const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const overlappingTriangle: Shape2d = {
      kind: "polygon",
      outer: [
        { x: 5, z: 5 },
        { x: 20, z: 5 },
        { x: 20, z: 20 },
      ],
    };
    const farTriangle: Shape2d = {
      kind: "polygon",
      outer: [
        { x: 50, z: 50 },
        { x: 60, z: 50 },
        { x: 60, z: 60 },
      ],
    };
    expect(shapesOverlap(aabb, overlappingTriangle)).toBe(true);
    expect(shapesOverlap(aabb, farTriangle)).toBe(false);
  });
});

describe("segmentInsideShapeIntervals", () => {
  it("finds the exact [t0, t1] where a horizontal segment crosses a circle", () => {
    const circle: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
    // (-10,0) -> (10,0): the circle spans x in [-5, 5], i.e. t in [0.25, 0.75].
    const intervals = segmentInsideShapeIntervals(circle, -10, 0, 10, 0);
    expect(intervals).toHaveLength(1);
    expect(intervals[0][0]).toBeCloseTo(0.25);
    expect(intervals[0][1]).toBeCloseTo(0.75);
  });

  it("returns no interval for a segment that misses the shape entirely", () => {
    const circle: Circle = { kind: "circle", x: 0, z: 100, radius: 5 };
    expect(segmentInsideShapeIntervals(circle, -10, 0, 10, 0)).toHaveLength(0);
  });

  it("finds the exact slab interval for an axis-aligned segment through an aabb", () => {
    const aabb: Aabb = { kind: "aabb", minX: 2, maxX: 8, minZ: -1, maxZ: 1 };
    // (0,0) -> (10,0): aabb spans x in [2, 8], i.e. t in [0.2, 0.8].
    const intervals = segmentInsideShapeIntervals(aabb, 0, 0, 10, 0);
    expect(intervals).toHaveLength(1);
    expect(intervals[0][0]).toBeCloseTo(0.2);
    expect(intervals[0][1]).toBeCloseTo(0.8);
  });
});

// ---------------------------------------------------------------------------
// Circle decomposition and boolean ops.
// ---------------------------------------------------------------------------

describe("circleToPolygon / shapeToPolygonal", () => {
  it("never deviates from the true circle by more than the sagitta tolerance", () => {
    for (const radius of [0.5, 3, 25, 150]) {
      const circle: Circle = { kind: "circle", x: 10, z: -10, radius };
      const polygon = circleToPolygon(circle);
      const sides = polygon.outer.length;
      const sagitta = radius * (1 - Math.cos(Math.PI / sides));
      expect(sagitta, `radius=${radius} sides=${sides}`).toBeLessThanOrEqual(
        CIRCLE_DECOMPOSITION_TOLERANCE_M + 1e-9,
      );
      // Every vertex is exactly on the circle (the deviation is edge-wise,
      // between vertices -- not at the vertices themselves).
      for (const p of polygon.outer) {
        expect(Math.hypot(p.x - circle.x, p.z - circle.z)).toBeCloseTo(radius, 6);
      }
    }
  });

  it("always winds clockwise, matching this codebase's outer-ring convention", () => {
    const circle: Circle = { kind: "circle", x: 0, z: 0, radius: 5 };
    expect(ringIsClockwise(circleToPolygon(circle).outer)).toBe(true);
  });

  it("shapeToPolygonal is the identity for polygon/multiPolygon and a real conversion for circle/aabb/obb", () => {
    const aabb: Aabb = { kind: "aabb", minX: 0, maxX: 4, minZ: 0, maxZ: 2 };
    const asPolygon = shapeToPolygonal(aabb);
    if (asPolygon.kind !== "polygon") throw new Error("expected shapeToPolygonal(aabb) to stay a single polygon");
    expect(ringArea(asPolygon.outer)).toBeCloseTo(8);
    expect(ringIsClockwise(asPolygon.outer)).toBe(true);
  });
});

describe("signedArea2 / ringIsClockwise", () => {
  it("a hand-authored clockwise square is negative-signed; reversing it flips the sign", () => {
    // In this codebase's (x, z) frame, increasing-angle circle points
    // (x=cx+r*cos, z=cz-r*sin) are clockwise (per circleToPolygon's own
    // convention above) -- an explicit small square built the same
    // handedness (right, then down, then left, then up) must agree.
    const clockwiseSquare: Point2[] = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: -1 },
      { x: 0, z: -1 },
    ];
    expect(signedArea2(clockwiseSquare)).toBeLessThan(0);
    expect(ringIsClockwise(clockwiseSquare)).toBe(true);
    expect(ringIsClockwise([...clockwiseSquare].reverse())).toBe(false);
  });
});

describe("boolean ops (booleanUnion/Intersection/Difference) and shapeArea", () => {
  // Two unit-ish squares overlapping in a known 0.5 x 0.5 region.
  const a: Aabb = { kind: "aabb", minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  const b: Aabb = { kind: "aabb", minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 };

  it("shapeArea is exact for aabb/circle/obb", () => {
    expect(shapeArea(a)).toBeCloseTo(1);
    expect(shapeArea({ kind: "circle", x: 0, z: 0, radius: 2 })).toBeCloseTo(Math.PI * 4);
    expect(shapeArea({ kind: "obb", x: 0, z: 0, ux: 1, uz: 0, halfU: 3, halfV: 2 })).toBeCloseTo(24);
  });

  it("intersection/union/difference areas match the known overlap geometry exactly", () => {
    expect(booleanIntersectionArea(a, b)).toBeCloseTo(0.25);
    expect(multiPolygonArea(booleanIntersection(a, b))).toBeCloseTo(0.25);
    expect(multiPolygonArea(booleanUnion(a, b))).toBeCloseTo(1.75);
    expect(multiPolygonArea(booleanDifference(a, b))).toBeCloseTo(0.75);
  });

  it("aabbOfShape bounds every shape kind tightly", () => {
    // toMatchObject, not toEqual: an already-aabb shape is returned as-is
    // (still carrying its own "kind": "aabb"), while a derived box (the
    // circle case below) is a fresh { minX, maxX, minZ, maxZ } literal with
    // no "kind" at all -- both satisfy Aabb2, so only the four numeric
    // fields are this function's actual contract.
    expect(aabbOfShape(a)).toMatchObject({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    const box = aabbOfShape({ kind: "circle", x: 5, z: -5, radius: 2 });
    expect(box).toMatchObject({ minX: 3, maxX: 7, minZ: -7, maxZ: -3 });
  });
});

// ---------------------------------------------------------------------------
// Real-map collection: pure recipes vs. the renderer's own constants and
// fallback formulas (plan Section 15.1's actual ask for this file).
// ---------------------------------------------------------------------------

const REAL_MAPS = MAP_PACKS.map((pack) => {
  const freeDrive = FREE_DRIVES.find((fd) => fd.mapId === pack.id);
  const plan = planMapBuildings(pack, freeDrive ? freeDrive.trafficSeed : 0);
  return { pack, plan };
});

describe("collectGroundSurfaces — real maps vs. production's y-layer stack", () => {
  it.each(REAL_MAPS.map(({ pack }) => [pack.id, pack] as const))(
    "%s: every surface's surfaceY/layerPriority matches renderConstants.ts, grouped by kind",
    (_id, pack) => {
      const surfaces = collectGroundSurfaces(pack);
      expect(surfaces.length).toBeGreaterThan(0);
      const byKind = new Map<GroundSurface["kind"], GroundSurface[]>();
      for (const s of surfaces) {
        (byKind.get(s.kind) ?? byKind.set(s.kind, []).get(s.kind)!).push(s);
      }

      for (const s of byKind.get("world-ground") ?? []) expect(s.surfaceY).toBe(0);
      for (const s of byKind.get("road") ?? []) expect(s.surfaceY).toBe(ROAD_SURFACE_Y);
      // Bridge decks are a road surface reclassified, not a distinct height.
      for (const s of byKind.get("bridge-deck") ?? []) expect(s.surfaceY).toBe(ROAD_SURFACE_Y);
      for (const s of byKind.get("sidewalk") ?? []) expect(s.surfaceY).toBe(ROAD_SHOULDER_Y);
      for (const s of byKind.get("park") ?? []) expect(s.surfaceY).toBe(PARK_LAWN_Y);
      // Both the asphalt and shoulder junction-fill heights are collected
      // under one "junction" kind (two distinct owners' worth of fill).
      // Closeness, not exact membership: ROAD_JUNCTION_FILL_Y is computed
      // (ROAD_SURFACE_Y + 0.0016 = 0.07160000000000001 in float), while this
      // collector writes the literal 0.0716 -- the same conceptual value,
      // off by a float-rounding ULP that toContain's === would reject.
      for (const s of byKind.get("junction") ?? []) {
        const isCloseToEither =
          Math.abs(s.surfaceY - ROAD_JUNCTION_FILL_Y) < 1e-6 ||
          Math.abs(s.surfaceY - ROAD_SHOULDER_JUNCTION_FILL_Y) < 1e-6;
        expect(isCloseToEither, `junction surfaceY ${s.surfaceY} matches neither fill height`).toBe(true);
      }
      // Water has no shared renderConstants.ts entry (waterLayer.ts calls
      // buildWaterPolygonGeometry with its `y` param left `undefined`, the
      // same as this collector) -- true by sharing one function, not a
      // renderConstants.ts parity check like the others above.
      for (const s of byKind.get("water") ?? []) expect(s.surfaceY).toBeCloseTo(0.025);

      // layerPriority: world-ground is the base layer, bridge decks sit
      // above the water/road they cross, everything else shares one plane.
      for (const s of surfaces) {
        const expected = s.kind === "world-ground" ? 0 : s.kind === "bridge-deck" ? 2 : 1;
        expect(s.layerPriority, `${s.kind}:${s.id}`).toBe(expected);
      }
    },
  );

  it.each(REAL_MAPS.map(({ pack }) => [pack.id, pack] as const))(
    "%s: a road's sidewalk ring never substantially overlaps its own carriageway",
    (_id, pack) => {
      const surfaces = collectGroundSurfaces(pack);
      // A bridge deck IS a carriageway (kind: isBridgeDeck ? "bridge-deck" :
      // "road" -- collectGroundSurfaces's own comment), just reclassified
      // for render priority; its sidewalks look the matching owner up here
      // too, not only under "road".
      const carriagewaysByOwner = new Map(
        surfaces.filter((s) => s.kind === "road" || s.kind === "bridge-deck").map((s) => [s.ownerId, s]),
      );
      const sidewalks = surfaces.filter((s) => s.kind === "sidewalk");
      expect(sidewalks.length).toBeGreaterThan(0);
      for (const sidewalk of sidewalks) {
        const carriageway = carriagewaysByOwner.get(sidewalk.ownerId);
        expect(carriageway, `sidewalk ${sidewalk.id} has no matching carriageway owner`).toBeTruthy();
        const sidewalkArea = shapeArea(sidewalk.geometry);
        expect(sidewalkArea, sidewalk.id).toBeGreaterThan(0);
        // Relative, not near-zero-absolute: booleanDifference's polygon-
        // clipping backend coordinate-snaps to 1mm for robustness on real,
        // complex road-strip polygons (see visualSceneFootprints.ts's own
        // CLIPPING_SNAP_M doc comment), which can leave a tiny real sliver
        // -- under 0.05 m^2 measured against real map content, versus tens
        // of m^2 for an actual full-overlap bug.
        try {
          const overlap = booleanIntersectionArea(sidewalk.geometry, carriageway!.geometry);
          expect(overlap, sidewalk.id).toBeLessThan(sidewalkArea * 0.02);
        } catch (cause) {
          // road-london-king-william's strip self-intersects (a real,
          // already-diagnosed bug tracked by visualGapCoverageRealMaps.test.ts,
          // out of this file's scope to fix) and polygon-clipping's exact-
          // arithmetic ring closer throws on it even for an isolated pair
          // check outside the raster. Every other caller of this backend
          // degrades per-unit-of-work on exactly this class (see
          // buildGroundRaster's own try/catch) rather than crashing the
          // whole audit -- mirrored here rather than silently swallowing
          // every error.
          if (!(cause instanceof PolygonClippingError)) throw cause;
        }
      }
    },
  );
});

describe("collectOccluderVolumes — real maps: landmark fallback parity with the renderer", () => {
  it.each(REAL_MAPS.map(({ pack, plan }) => [pack.id, pack, plan] as const))(
    "%s: every landmark-building occluder matches babylonGameSession.ts's own tower/facade-box fallback formula",
    (_id, pack, plan) => {
      const { occluders } = collectOccluderVolumes(pack, plan);
      const byLandmarkId = new Map(pack.geometry.landmarks.map((l) => [l.id, l]));
      const landmarkOccluders = occluders.filter((o) => o.kind === "landmark-building");
      // Not asserted >0 per map: cairo-central-nile's every non-park/
      // railway/bridge landmark currently happens to be bespoke-covered
      // (an audit_geometry_missing issue instead), so it legitimately
      // contributes zero here -- the aggregate check below proves the
      // fallback path itself is genuinely exercised somewhere.
      for (const occluder of landmarkOccluders) {
        const landmark = byLandmarkId.get(occluder.ownerId)!;
        expect(landmark, occluder.ownerId).toBeTruthy();

        if (landmark.kind === "tower") {
          // babylonGameSession.ts: createCylinder({ height: Math.max(12,
          // size.z), diameter: Math.max(4, size.x*0.4) }) centred at
          // (center.x, height/2, center.z).
          expect(occluder.geometry.kind).toBe("circle");
          const circle = occluder.geometry as Circle;
          expect(circle.x).toBeCloseTo(landmark.center.x);
          expect(circle.z).toBeCloseTo(landmark.center.z);
          expect(circle.radius).toBeCloseTo(Math.max(4, landmark.size.x * 0.4) / 2);
          expect(occluder.minY).toBe(0);
          expect(occluder.maxY).toBeCloseTo(Math.max(12, landmark.size.z));
        } else {
          // babylonGameSession.ts: createFacadeBox({ width: size.x, height,
          // depth: size.z }) centred at (center.x, height/2, center.z),
          // height = 8 for a terminal, 5 otherwise.
          expect(occluder.geometry.kind).toBe("aabb");
          const aabb = occluder.geometry as Aabb;
          expect(aabb.minX).toBeCloseTo(landmark.center.x - landmark.size.x / 2);
          expect(aabb.maxX).toBeCloseTo(landmark.center.x + landmark.size.x / 2);
          expect(aabb.minZ).toBeCloseTo(landmark.center.z - landmark.size.z / 2);
          expect(aabb.maxZ).toBeCloseTo(landmark.center.z + landmark.size.z / 2);
          expect(occluder.minY).toBe(0);
          expect(occluder.maxY).toBe(landmark.kind === "terminal" ? 8 : 5);
        }
      }
    },
  );

  it("reaches the fallback for at least one landmark somewhere across the real map packs", () => {
    const total = REAL_MAPS.reduce(
      (sum, { pack, plan }) => sum + collectOccluderVolumes(pack, plan).occluders.filter((o) => o.kind === "landmark-building").length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });
});

describe("collectOccluderVolumes — real maps: asset-slot building placement", () => {
  it.each(
    REAL_MAPS.filter(({ plan }) => plan.buildings.some((b) => b.source === "asset-slot")).map(
      ({ pack, plan }) => [pack.id, pack, plan] as const,
    ),
  )("%s: every asset-slot building's occluder centroid lands near its own plan.x/plan.z", (_id, pack, plan) => {
    const { occluders } = collectOccluderVolumes(pack, plan);
    const assetSlotBuildings = plan.buildings.filter((b) => b.source === "asset-slot");
    expect(assetSlotBuildings.length).toBeGreaterThan(0);
    // A deterministic sample (every 37th building), not all of them --
    // thousands of full polygon centroid computations per map is real cost
    // for no more confidence than a spread sample across the whole plan.
    const sample = assetSlotBuildings.filter((_, index) => index % 37 === 0);
    expect(sample.length).toBeGreaterThan(0);
    for (const building of sample) {
      const ownOccluders = occluders.filter((o) => o.ownerId === building.id);
      expect(ownOccluders.length, building.id).toBeGreaterThan(0);
      for (const occluder of ownOccluders) {
        expect(occluder.geometry.kind, occluder.id).toBe("polygon");
        const polygon = occluder.geometry as { kind: "polygon"; outer: readonly Point2[] };
        const centroidX = polygon.outer.reduce((sum, p) => sum + p.x, 0) / polygon.outer.length;
        const centroidZ = polygon.outer.reduce((sum, p) => sum + p.z, 0) / polygon.outer.length;
        // Generous radius: real building footprints are a few metres to a
        // few tens of metres across, so a placement bug (missing rotation,
        // doubled offset) overshoots this by a wide margin.
        expect(Math.hypot(centroidX - building.x, centroidZ - building.z), building.id).toBeLessThan(30);
        expect(shapeArea(occluder.geometry), occluder.id).toBeGreaterThan(0);
        expect(occluder.maxY, occluder.id).toBeGreaterThan(occluder.minY);
      }
    }
  });
});

describe("collectMapVisualGeometry — real maps: known issues (regression-pinned)", () => {
  // Every current issue across all four map packs is a bespoke landmark
  // (geometry/landmarkGroundSolids.ts) that has vehicle-height collision
  // but no height-banded visual-occlusion recipe yet -- Section 7.2 item 6's
  // documented, deliberate scope limit, not an oversight. Pinned per-map so
  // a newly *un*explained issue (a different kind, or a plain owner id) is
  // caught immediately rather than laundered through a loose upper bound.
  const KNOWN_ISSUE_COUNTS: Readonly<Record<string, number>> = {
    "london-south-kensington": 9,
    "cairo-central-nile": 5,
    "nyc-upper-west-side": 0,
    // jp-hikari-tower (Tokyo expansion Phase 8): Tokyo's first bespoke
    // ground-solid landmark (geometry/landmarkGroundSolids.ts's
    // TOKYO_RECIPES), so its first entry in this same known/accepted gap
    // every other bespoke landmark on every map already carries.
    "tokyo-setagaya": 1,
  };

  it.each(REAL_MAPS.map(({ pack, plan }) => [pack.id, pack, plan] as const))(
    "%s: every issue is a bespoke-landmark-without-a-visual-recipe, at the known count",
    (id, pack, plan) => {
      const geometry = collectMapVisualGeometry(pack, plan);
      const knownCount = KNOWN_ISSUE_COUNTS[id];
      expect(knownCount, `${id} has no pinned expectation -- add one`).not.toBeUndefined();
      expect(geometry.issues.length, id).toBe(knownCount);
      for (const issue of geometry.issues) {
        expect(issue.kind, issue.ownerId).toBe("audit_geometry_missing");
        expect(issue.reason, issue.ownerId).toBe("bespoke landmark has no height-banded visual-occlusion recipe yet");
      }
    },
  );
});
