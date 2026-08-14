import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { hashStringToSeed } from "../app/game/visuals";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import {
  buildStaticObstacles,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import {
  landmarkGroundSolids,
  VEHICLE_HEIGHT_BAND_M,
  type GroundSolid,
} from "../app/game/geometry/landmarkGroundSolids";
import { normalizeStaticObstacle } from "../app/game/simulation/playerDynamics";
import { SimulationCore, type SimulationCoreConfig } from "../app/game/simulation";
import { obstacleDistanceSquared } from "../app/game/render/collisionDebugOverlay";
import { stagedBlockersOf } from "../app/game/geometry/facadesAndKeepouts";
import { chooseStagedShot } from "../app/game/cutsceneScript";
import type { MapPack, StaticObstacle, WorldPoint } from "../app/game/types";

/**
 * Plan `.claude/building-collision-visual-parity-plan.md` Section 10.3.
 * Every probe below either derives its coordinates from the real landmark
 * descriptor (center + a fixed offset) or, where the plan gives an absolute
 * world coordinate for a landmark whose authored `center` has never moved,
 * uses that literal directly — `london-clock-tower` is the one landmark
 * Phase 5d repositioned (Section 10.5's "fix the placement, not the
 * collider"), so its probes are center-relative rather than copied from the
 * plan's now-stale absolute numbers.
 */

const MAP_PACKS: readonly MapPack[] = [
  LONDON_MAP_PACK,
  CAIRO_MAP_PACK,
  NYC_MAP_PACK,
  TOKYO_MAP_PACK,
];

function findLandmark(mapPack: MapPack, id: string) {
  const landmark = mapPack.geometry.landmarks.find((candidate) => candidate.id === id);
  if (!landmark) throw new Error(`fixture drift: ${mapPack.id} has no landmark "${id}"`);
  return landmark;
}

function solidsFor(mapPack: MapPack, id: string): readonly GroundSolid[] {
  const solids = landmarkGroundSolids(mapPack.id, findLandmark(mapPack, id));
  if (!solids) throw new Error(`expected a bespoke ground-solid recipe for "${id}"`);
  return solids;
}

/** Every point-containment check below goes through the real production
 * `distanceToStaticObstacle` (0 = inside/touching) against a real
 * `StaticObstacle`, not a second hand-rolled geometry test — Section 10.3's
 * "use the exact production descriptor... do not reconstruct with a second
 * switch statement" applies to the containment math too. */
function isSolidAt(obstacles: readonly StaticObstacle[], x: number, z: number): boolean {
  return obstacles.some((obstacle) => distanceToStaticObstacle(obstacle, x, z) === 0);
}

function toObstacles(mapPack: MapPack, solids: readonly GroundSolid[]): StaticObstacle[] {
  return solids.map((solid) =>
    solid.kind === "convex"
      ? { kind: "convex", id: solid.id, tag: "landmark", points: solid.points }
      : { ...solid, tag: "landmark" },
  ) as StaticObstacle[];
}

// ---------------------------------------------------------------------------
// Independent point-in-polygon check (ray casting / even-odd), deliberately
// a different algorithm from `distanceToStaticObstacle`'s winding-dependent
// cross-product test, so agreement between the two is a real cross-check.
// ---------------------------------------------------------------------------
function rayCastInside(points: readonly WorldPoint[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = a.z > z !== b.z > z;
    if (!crosses) continue;
    const xAtZ = ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (x < xAtZ) inside = !inside;
  }
  return inside;
}

/** Clockwise winding: for this codebase's (x right, z "up") convention the
 * shoelace sum `sum((x2-x1)*(z2+z1))` is positive for a clockwise loop —
 * verified against `regularEllipsePolygon`'s own doc comment (vertex 0 at
 * local `(r, 0)`, stepping by `-360/sides`), independently re-derived here
 * rather than imported. */
function isClockwise(points: readonly WorldPoint[]): boolean {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (b.x - a.x) * (b.z + a.z);
  }
  return sum > 0;
}

describe("landmarkGroundSolids — over-collided landmarks (Section 7.9)", () => {
  it("london-round-hall: convex 24-gon matching the ellipse drum, not the AABB corners", () => {
    const landmark = findLandmark(LONDON_MAP_PACK, "london-round-hall");
    const solids = solidsFor(LONDON_MAP_PACK, "london-round-hall");
    expect(solids).toHaveLength(1);
    const drum = solids[0];
    if (drum.kind !== "convex") throw new Error("expected convex");
    expect(drum.points).toHaveLength(24);
    expect(isClockwise(drum.points)).toBe(true);

    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    // The old AABB's empty corner: within the 74x56 box but outside the
    // radii-37x28 ellipse it was never really filled by.
    const cornerX = landmark.center.x + 36;
    const cornerZ = landmark.center.z + 27;
    expect(isSolidAt(obstacles, cornerX, cornerZ)).toBe(false);
    expect(isSolidAt(obstacles, 6, 289)).toBe(false);
    // Cardinal and diagonal points on the ellipse wall itself are solid.
    const rx = landmark.size.x / 2;
    const rz = landmark.size.z / 2;
    expect(isSolidAt(obstacles, landmark.center.x + rx - 0.05, landmark.center.z)).toBe(true);
    expect(isSolidAt(obstacles, landmark.center.x, landmark.center.z + rz - 0.05)).toBe(true);
    const diag = Math.SQRT1_2;
    expect(
      isSolidAt(
        obstacles,
        landmark.center.x + rx * diag * 0.98,
        landmark.center.z + rz * diag * 0.98,
      ),
    ).toBe(true);
  });

  it("london-eye-wheel: centre open, both leg bases solid, nothing else projected from above the band", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-eye-wheel");
    expect(solids).toHaveLength(2);
    for (const solid of solids) expect(solid.kind).toBe("aabb");
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(isSolidAt(obstacles, 870, -572)).toBe(false);
    for (const solid of solids) {
      if (solid.kind !== "aabb") continue;
      const midX = (solid.minX + solid.maxX) / 2;
      const midZ = (solid.minZ + solid.maxZ) / 2;
      expect(isSolidAt(obstacles, midX, midZ)).toBe(true);
    }
  });

  it("cairo-tower: radius exactly 2.6, not the old 4.8", () => {
    const solids = solidsFor(CAIRO_MAP_PACK, "cairo-tower");
    expect(solids).toEqual([
      { kind: "circle", id: "cairo-tower:core", x: -305, z: -18, radius: 2.6 },
    ]);
    const obstacles = toObstacles(CAIRO_MAP_PACK, solids);
    expect(isSolidAt(obstacles, -301, -18)).toBe(false);
    // 2.4 m from centre, inside the 2.6 m radius.
    expect(isSolidAt(obstacles, -305 + 2.4, -18)).toBe(true);
  });

  it("cairo-tahrir-obelisk: 7x7 plinth, not the old radius-4.667 circle", () => {
    const solids = solidsFor(CAIRO_MAP_PACK, "cairo-tahrir-obelisk");
    const obstacles = toObstacles(CAIRO_MAP_PACK, solids);
    expect(isSolidAt(obstacles, 352, -27)).toBe(false);
    // A plinth-corner inset: just inside the 3.5 half-extent on both axes.
    expect(isSolidAt(obstacles, 348 + 3.3, -27 + 3.3)).toBe(true);
  });

  it("cairo-tahrir-ministries: central slab, two wings, nine columns — not the old full envelope", () => {
    const solids = solidsFor(CAIRO_MAP_PACK, "cairo-tahrir-ministries");
    expect(solids).toHaveLength(12);
    const obstacles = toObstacles(CAIRO_MAP_PACK, solids);
    // Inside the old 44x22 AABB (centre 350,30) but outside every corrected mass.
    expect(isSolidAt(obstacles, 333, 20)).toBe(false);
    expect(isSolidAt(obstacles, 350, 30)).toBe(true); // central slab
    expect(isSolidAt(obstacles, 350 - 16.5, 31)).toBe(true); // west wing
    expect(isSolidAt(obstacles, 350 - 4 * (22 / 8.8), 30 - 11 - 1.1)).toBe(true); // a column
  });

  it("cairo-opera-house: hall, stage, nine columns — not the old full envelope", () => {
    const solids = solidsFor(CAIRO_MAP_PACK, "cairo-opera-house");
    expect(solids).toHaveLength(11);
    const obstacles = toObstacles(CAIRO_MAP_PACK, solids);
    // Inside the old 32x58 AABB but outside every corrected mass (a rear-side strip).
    expect(isSolidAt(obstacles, -290, -337)).toBe(false);
    const northFaceZ = -315 + 29;
    expect(isSolidAt(obstacles, -275, northFaceZ - 22)).toBe(true); // hall
    expect(isSolidAt(obstacles, -275, northFaceZ - 51)).toBe(true); // stage
    expect(isSolidAt(obstacles, -275 - 4 * (32 / 8.8), northFaceZ + 1.1)).toBe(true); // a column
  });
});

describe("landmarkGroundSolids — known London under-colliders (Section 4.5/7.9)", () => {
  it("london-natural-history-tower: 11x11 shaft, not the old radius-3.2 circle", () => {
    const landmark = findLandmark(LONDON_MAP_PACK, "london-natural-history-tower");
    const solids = solidsFor(LONDON_MAP_PACK, "london-natural-history-tower");
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(isSolidAt(obstacles, -24, -56)).toBe(true);
    expect(isSolidAt(obstacles, -24, -55.4)).toBe(false);
    expect(isSolidAt(obstacles, -29.6, -56)).toBe(false);
    expect(landmark.center).toEqual({ x: -24, z: -61 });
  });

  it("london-clock-tower: 14x14 ground shaft at the landmark's real (post-Phase-5d) centre", () => {
    const landmark = findLandmark(LONDON_MAP_PACK, "london-clock-tower");
    const solids = solidsFor(LONDON_MAP_PACK, "london-clock-tower");
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(solids).toEqual([
      {
        kind: "aabb",
        id: "london-clock-tower:shaft",
        minX: landmark.center.x - 7,
        maxX: landmark.center.x + 7,
        minZ: landmark.center.z - 7,
        maxZ: landmark.center.z + 7,
      },
    ]);
    expect(isSolidAt(obstacles, landmark.center.x + 6.9, landmark.center.z)).toBe(true);
    expect(isSolidAt(obstacles, landmark.center.x + 7.1, landmark.center.z)).toBe(false);
  });

  it("london-glass-gherkin: 16-gon at the exact band-height circumradius, not the old radius-6.8 circle", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-glass-gherkin");
    expect(solids).toHaveLength(1);
    const base = solids[0];
    if (base.kind !== "convex") throw new Error("expected convex");
    expect(base.points).toHaveLength(16);
    expect(isClockwise(base.points)).toBe(true);
    const circumradius = Math.hypot(base.points[0].x - 1230, base.points[0].z - 170);
    expect(circumradius).toBeCloseTo(9.0108785568, 9);
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(isSolidAt(obstacles, 1238.8, 170)).toBe(true);
    expect(isSolidAt(obstacles, 1239.2, 170)).toBe(false);
  });

  it("london-shard-spire: rotated-square base half-extent 19/sqrt(2), never the circumcircle radius 19", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-shard-spire");
    const half = 19 / Math.SQRT2;
    expect(half).toBeCloseTo(13.4350288425, 9);
    expect(solids).toEqual([
      {
        kind: "aabb",
        id: "london-shard-spire:base",
        minX: 1330 - half,
        maxX: 1330 + half,
        minZ: -580 - half,
        maxZ: -580 + half,
      },
    ]);
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(isSolidAt(obstacles, 1343, -580)).toBe(true);
    expect(isSolidAt(obstacles, 1343, -567)).toBe(true);
    expect(isSolidAt(obstacles, 1343.55, -580)).toBe(false);
  });

  it("london-monument-column: 12x12 plinth, not the old radius-4 circle", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-monument-column");
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(isSolidAt(obstacles, 1155.5, -135.5)).toBe(true);
    expect(isSolidAt(obstacles, 1156.1, -130)).toBe(false);
  });

  it("london-palace: exact body plus 13 portico columns and 17 railing posts, forecourt stays passable", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-palace");
    expect(solids).toHaveLength(1 + 13 + 17);
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    const columns = solids.filter((s) => s.id.includes(":column:"));
    const posts = solids.filter((s) => s.id.includes(":railing:"));
    expect(columns).toHaveLength(13);
    expect(posts).toHaveLength(17);

    const centersOf = (group: readonly GroundSolid[]) =>
      group
        .map((s) => (s.kind === "circle" ? s.x : s.kind === "aabb" ? (s.minX + s.maxX) / 2 : NaN))
        .sort((a, b) => a - b);
    const midpointsPassable = (xs: readonly number[], z: number) => {
      for (let i = 0; i + 1 < xs.length; i += 1) {
        const midX = (xs[i] + xs[i + 1]) / 2;
        expect(isSolidAt(obstacles, midX, z)).toBe(false);
      }
    };
    midpointsPassable(centersOf(columns), -70 - 46 / 2 - 1);
    midpointsPassable(centersOf(posts), -70 - 46 / 2 - 12);
    // The body itself is exactly the visible 90x46 facade, kept verbatim.
    expect(solids.find((s) => s.id.endsWith(":body"))).toEqual({
      kind: "aabb",
      id: "london-palace:body",
      minX: 430 - 45,
      maxX: 430 + 45,
      minZ: -70 - 23,
      maxZ: -70 + 23,
    });
  });

  it("london-natural-history-museum: exact body plus the entrance and seven pilasters", () => {
    const solids = solidsFor(LONDON_MAP_PACK, "london-natural-history-museum");
    expect(solids).toHaveLength(1 + 1 + 7);
    const obstacles = toObstacles(LONDON_MAP_PACK, solids);
    expect(solids.find((s) => s.id.endsWith(":entrance"))).toEqual({
      kind: "aabb",
      id: "london-natural-history-museum:entrance",
      minX: -28.75,
      maxX: -21.25,
      minZ: -90.925,
      maxZ: -90.075,
    });
    expect(isSolidAt(obstacles, -25, -90.5)).toBe(true); // entrance protrusion
    for (const x of [-52, -43, -34, -25, -16, -7, 2]) {
      expect(isSolidAt(obstacles, x, -90.35)).toBe(true); // each pilaster
    }
    // The body itself matches the visible 72x30 facade exactly.
    expect(solids.find((s) => s.id.endsWith(":body"))).toEqual({
      kind: "aabb",
      id: "london-natural-history-museum:body",
      minX: -25 - 36,
      maxX: -25 + 36,
      minZ: -75 - 15,
      maxZ: -75 + 15,
    });
  });
});

describe("landmarkGroundSolids — cairo-egyptian-museum (audit finding, Section 7.9 audit step)", () => {
  it("adds the pavilion and entrance protrusions the generic museum box misses", () => {
    const solids = solidsFor(CAIRO_MAP_PACK, "cairo-egyptian-museum");
    expect(solids).toHaveLength(3);
    const obstacles = toObstacles(CAIRO_MAP_PACK, solids);
    // Body face is at Z = -210 - 32 = -242; the pavilion projects 0.55 m
    // beyond it, and the entrance projects a further 0.07-0.35 m past that.
    expect(isSolidAt(obstacles, 185, -242.3)).toBe(true); // pavilion protrusion
    expect(isSolidAt(obstacles, 185, -242.2)).toBe(true); // entrance protrusion
    expect(isSolidAt(obstacles, 185, -242.6)).toBe(false); // past every mass
    // The decorative window bays (Y 4.3-7.3) stay above the vehicle band and
    // get no primitive — only three solids exist in total (checked above).
    expect(4.3).toBeGreaterThan(VEHICLE_HEIGHT_BAND_M);
    const pavilion = solids.find((s) => s.id.endsWith(":pavilion"));
    if (!pavilion || pavilion.kind !== "aabb") throw new Error("expected pavilion aabb");
    expect(pavilion.minZ).toBeCloseTo(-242.55, 9);
    expect(pavilion.maxZ).toBeCloseTo(-177.45, 9);
  });
});

describe("landmarkGroundSolids — complete audit across all four maps (Section 7.9)", () => {
  const SEMANTIC_EXCEPTION_KINDS = new Set(["park", "railway", "bridge"]);

  // Every non-bespoke, non-semantic-exception landmark, hand-verified against
  // its actual render recipe (bespoke or generic) to confirm it draws exactly
  // its generic kind's box/circle at vehicle height — see
  // `render/londonLandmarks.ts`, `render/cairoLandmarks.ts`, and
  // `render/nycLandmarks.ts`'s own doc comment. A landmark absent from here,
  // from a bespoke recipe, and from a semantic-exception kind fails the test
  // below, so a future landmark cannot silently skip this review.
  const VERIFIED_GENERIC_IDS = new Set([
    // London: bespoke render, but the drawn body/awning/name-board exactly
    // matches the generic box, and every protrusion (roofline, bay windows,
    // cornice, domes) sits above VEHICLE_HEIGHT_BAND_M.
    "london-science-museum",
    "london-victoria-and-albert-museum",
    "london-power-station",
    "london-department-store",
    "london-south-kensington-station",
    // London: no bespoke renderer at all — the shared generic station body.
    "london-knightsbridge-station",
    "london-city-station",
    "london-islington-station",
    // NYC: `render/nycLandmarks.ts`'s own doc comment confirms only bridges
    // are bespoke; these three read through the generic `landmark.kind` path.
    "nyc-subway",
    "nyc-amnh",
    "nyc-gallery",
    // Tokyo: `render/tokyoLandmarks.ts` is bespoke for bridges (Phase 3)
    // and `jp-hikari-tower` (Phase 8, its own TOKYO_RECIPES entry below)
    // only — these two still read through the generic `landmark.kind`
    // fallback (a facade box and a plain circle-topped cylinder).
    "jp-gotokuji-station",
    "jp-carrot-tower",
  ]);

  it("classifies every landmark as bespoke, semantic exception, or verified generic", () => {
    const unclassified: string[] = [];
    for (const mapPack of MAP_PACKS) {
      for (const landmark of mapPack.geometry.landmarks) {
        const bespoke = landmarkGroundSolids(mapPack.id, landmark);
        const isSemanticException = SEMANTIC_EXCEPTION_KINDS.has(landmark.kind);
        const isVerifiedGeneric = VERIFIED_GENERIC_IDS.has(landmark.id);
        if (bespoke) {
          if (isSemanticException || isVerifiedGeneric) {
            unclassified.push(`${landmark.id}: bespoke recipe AND another classification`);
          }
          continue;
        }
        if (isSemanticException && isVerifiedGeneric) {
          unclassified.push(`${landmark.id}: both semantic exception and verified generic`);
          continue;
        }
        if (!isSemanticException && !isVerifiedGeneric) {
          unclassified.push(`${landmark.id} (${mapPack.id}, kind ${landmark.kind}): unclassified`);
        }
      }
    }
    expect(unclassified).toEqual([]);
  });

  it("every verified-generic id still exists on its map (catches renames)", () => {
    const allIds = new Set(MAP_PACKS.flatMap((pack) => pack.geometry.landmarks.map((l) => l.id)));
    for (const id of VERIFIED_GENERIC_IDS) {
      expect(allIds.has(id)).toBe(true);
    }
  });
});

describe("landmarkGroundSolids — convex primitive correctness (Section 10.3)", () => {
  // A small, easy-to-hand-check clockwise pentagon standing in for a bespoke
  // landmark's exact footprint, used only for the generic-machinery checks
  // below (normalization, distance, contact, push-out) — not tied to any
  // one map.
  const PENTAGON: readonly WorldPoint[] = [
    { x: 3, z: 0 },
    { x: 0.93, z: -2.85 },
    { x: -2.43, z: -1.76 },
    { x: -2.43, z: 1.76 },
    { x: 0.93, z: 2.85 },
  ];
  const PENTAGON_OBSTACLE: StaticObstacle = {
    kind: "convex",
    id: "pentagon",
    tag: "landmark",
    points: PENTAGON,
  };

  it("winds clockwise, matching every production ground-solid polygon", () => {
    expect(isClockwise(PENTAGON)).toBe(true);
    for (const mapPack of [LONDON_MAP_PACK, CAIRO_MAP_PACK]) {
      for (const landmark of mapPack.geometry.landmarks) {
        const solids = landmarkGroundSolids(mapPack.id, landmark) ?? [];
        for (const solid of solids) {
          if (solid.kind !== "convex") continue;
          expect(isClockwise(solid.points)).toBe(true);
        }
      }
    }
  });

  it("point distance agrees with an independent nearest-point search", () => {
    const probes: ReadonlyArray<readonly [number, number]> = [
      [0, 0], // inside
      [10, 0], // outside, due east
      [0, 4], // outside, due north
      [-4, -3], // outside, southwest
    ];
    for (const [x, z] of probes) {
      const production = distanceToStaticObstacle(PENTAGON_OBSTACLE, x, z);
      // Brute-force nearest point on any edge, independent of the
      // cross-product inside/outside test `distanceToStaticObstacle` uses.
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < PENTAGON.length; i += 1) {
        const a = PENTAGON[i];
        const b = PENTAGON[(i + 1) % PENTAGON.length];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const lenSq = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / lenSq));
        const nx = a.x + ex * t;
        const nz = a.z + ez * t;
        best = Math.min(best, Math.hypot(x - nx, z - nz));
      }
      const inside = rayCastInside(PENTAGON, x, z);
      expect(production).toBeCloseTo(inside ? 0 : best, 6);
    }
  });

  it("normalization is deterministic and its broad bounds match the true point extents", () => {
    const first = normalizeStaticObstacle(PENTAGON_OBSTACLE, 0.5);
    const second = normalizeStaticObstacle(PENTAGON_OBSTACLE, 0.5);
    expect(first).toEqual(second);
    if (first.shape !== "convex") throw new Error("expected convex");
    const trueMinX = Math.min(...PENTAGON.map((p) => p.x));
    const trueMaxX = Math.max(...PENTAGON.map((p) => p.x));
    const trueMinZ = Math.min(...PENTAGON.map((p) => p.z));
    const trueMaxZ = Math.max(...PENTAGON.map((p) => p.z));
    expect(first.minX).toBeCloseTo(trueMinX - 0.5, 9);
    expect(first.maxX).toBeCloseTo(trueMaxX + 0.5, 9);
    expect(first.minZ).toBeCloseTo(trueMinZ - 0.5, 9);
    expect(first.maxZ).toBeCloseTo(trueMaxZ + 0.5, 9);
  });

  it("a uniform-grid spatial index built from the broad bounds finds the shape from a nearby query", () => {
    // The same style of generic grid index `staticColliders.test.ts` uses for
    // its own broad-phase culling, rebuilt locally: cell size 16 m, insertion
    // by the (inflated) broad-phase AABB, 3x3-neighbourhood query.
    const CELL = 16;
    const cellOf = (v: number) => Math.floor(v / CELL);
    const normalized = normalizeStaticObstacle(PENTAGON_OBSTACLE, 0);
    const grid = new Map<string, StaticObstacle[]>();
    for (let cx = cellOf(normalized.minX); cx <= cellOf(normalized.maxX); cx += 1) {
      for (let cz = cellOf(normalized.minZ); cz <= cellOf(normalized.maxZ); cz += 1) {
        const key = `${cx},${cz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(PENTAGON_OBSTACLE);
      }
    }
    const queryX = 2.9;
    const queryZ = 0.1; // just inside the pentagon's eastern vertex
    const found: StaticObstacle[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const key = `${cellOf(queryX) + dx},${cellOf(queryZ) + dz}`;
        found.push(...(grid.get(key) ?? []));
      }
    }
    expect(found).toContain(PENTAGON_OBSTACLE);
  });

  it("debug ranking (obstacleDistanceSquared) agrees with the polygon's own vertex-average centroid", () => {
    const centroidX = PENTAGON.reduce((sum, p) => sum + p.x, 0) / PENTAGON.length;
    const centroidZ = PENTAGON.reduce((sum, p) => sum + p.z, 0) / PENTAGON.length;
    const expected = (centroidX - 5) ** 2 + (centroidZ - 5) ** 2;
    expect(obstacleDistanceSquared(PENTAGON_OBSTACLE, 5, 5)).toBeCloseTo(expected, 9);
  });

  it("staged camera blocker: a point inside is a blocker, a sightline crossing it is rejected", () => {
    const blockers = stagedBlockersOf([PENTAGON_OBSTACLE]);
    expect(blockers).toHaveLength(1);
    const blocker = blockers[0];
    expect("points" in blocker).toBe(true);
    if (!("points" in blocker)) throw new Error("expected convex blocker");
    expect(blocker.points).toEqual(PENTAGON);

    // A second, small pentagon standing between the default azimuth and the
    // subject — mirrors the existing box-blocker "turns off an azimuth that
    // films through a pillar" case in cutsceneScript.test.ts (`boxAt(0, 4.5,
    // 0.35, 0.35)`), with a convex shape in the pillar's place. The big
    // PENTAGON fixture above is centred on the subject itself, so re-using it
    // here would ask the camera to avoid a blocker that already contains what
    // it is filming — impossible by construction, not a real test.
    const smallPentagon = stagedBlockersOf([
      {
        kind: "convex",
        id: "small-pentagon",
        tag: "landmark",
        points: PENTAGON.map((p) => ({ x: p.x * 0.12, z: 4.5 + p.z * 0.12 })),
      },
    ])[0];
    if (!("points" in smallPentagon)) throw new Error("expected convex blocker");

    const NORTH = { x: 0, z: 1 };
    const CAR = { x: 0, z: 0 };
    const shot = chooseStagedShot(0, 0, 9, 4.7, NORTH, [CAR], [smallPentagon], null);
    const sightlineCrossesPentagon = (from: { x: number; z: number }, to: { x: number; z: number }) => {
      for (let step = 0; step <= 400; step += 1) {
        const t = step / 400;
        const x = from.x + (to.x - from.x) * t;
        const z = from.z + (to.z - from.z) * t;
        if (rayCastInside(smallPentagon.points, x, z)) return true;
      }
      return false;
    };
    // With nothing in the way the default azimuth (candidate zero) already
    // sightlines straight through (0, 4.5) to reach the car at the origin —
    // the same fact the box-blocker "pillar" test relies on.
    expect(sightlineCrossesPentagon({ x: 0, z: 9 }, CAR)).toBe(true);
    expect(sightlineCrossesPentagon(shot, CAR)).toBe(false);
  });
});

describe("landmarkGroundSolids — collision events preserve tag and obstacleId (Section 10.3)", () => {
  const DEFAULT_SPAWN = { x: 0, z: -20, heading: 0 };
  const DEFAULT_BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const BASE_CONFIG: Omit<SimulationCoreConfig, "spawn" | "staticObstacles"> = {
    scenarioId: "landmark-primitive-probe",
    trafficSide: "right",
    npcCount: 0,
    lanes: [
      {
        id: "approach",
        points: [
          { x: 0, z: -60 },
          { x: 0, z: 60 },
        ],
        width: 20,
        speedLimitMps: 30,
        loop: false,
      },
    ],
    bounds: DEFAULT_BOUNDS,
  };

  /** Spawns well clear of the obstacle and drives straight at it (due north)
   * under full throttle; returns the first "collision" event's evidence, if
   * any. Defaults to the synthetic cases' shared (0, -20) spawn and +-100m
   * bounds; a real map obstacle sits at its own real-world coordinates, so
   * the compound-landmark case below overrides both to actually reach it. */
  function driveInto(
    obstacle: StaticObstacle,
    spawn: { readonly x: number; readonly z: number; readonly heading: number } = DEFAULT_SPAWN,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number } = DEFAULT_BOUNDS,
  ) {
    const sim = new SimulationCore({
      ...BASE_CONFIG,
      lanes: [
        {
          id: "approach",
          points: [
            { x: spawn.x, z: spawn.z - 10 },
            { x: spawn.x, z: bounds.maxZ },
          ],
          width: 20,
          speedLimitMps: 30,
          loop: false,
        },
      ],
      bounds,
      spawn,
      staticObstacles: [obstacle],
    });
    for (let tick = 0; tick < 600; tick += 1) {
      sim.step(1 / 60, { throttle: 1 });
    }
    return sim
      .getEvents()
      .filter((event) => event.code === "collision")
      .map((event) => event.evidence)[0];
  }

  const CASES: ReadonlyArray<readonly [string, StaticObstacle]> = [
    ["aabb", { kind: "aabb", id: "probe-aabb", tag: "landmark", minX: -3, maxX: 3, minZ: 8, maxZ: 14 }],
    ["obb", { kind: "obb", id: "probe-obb", tag: "landmark", x: 0, z: 11, ux: 1, uz: 0, halfU: 3, halfV: 3 }],
    ["circle", { kind: "circle", id: "probe-circle", tag: "landmark", x: 0, z: 11, radius: 3 }],
    [
      "convex",
      {
        kind: "convex",
        id: "probe-convex",
        tag: "landmark",
        points: [
          { x: 3, z: 8 },
          { x: 0, z: 14 },
          { x: -3, z: 8 },
        ],
      },
    ],
  ];

  it.each(CASES)("%s primitive: a head-on impact reports tag=landmark and the stable obstacleId", (_label, obstacle) => {
    const evidence = driveInto(obstacle);
    expect(evidence).toBeDefined();
    expect(evidence!.obstacle).toBe("landmark");
    expect(evidence!.obstacleId).toBe(obstacle.id);
  });

  it("a real compound landmark obstacle (cairo-tahrir-ministries wing) keeps its compound id through a collision", () => {
    const plan = planMapBuildings(CAIRO_MAP_PACK, hashStringToSeed(CAIRO_MAP_PACK.id));
    const bounds = {
      minX: -CAIRO_MAP_PACK.geometry.worldSize.x / 2 - 2,
      maxX: CAIRO_MAP_PACK.geometry.worldSize.x / 2 + 2,
      minZ: -CAIRO_MAP_PACK.geometry.worldSize.z / 2 - 2,
      maxZ: CAIRO_MAP_PACK.geometry.worldSize.z / 2 + 2,
    };
    const obstacles = buildStaticObstacles({ mapPack: CAIRO_MAP_PACK, bounds, buildingLayout: plan });
    const wing = obstacles.find((o) => o.id === "cairo-tahrir-ministries:wing:1");
    if (!wing || wing.kind !== "aabb") throw new Error("fixture drift: cairo-tahrir-ministries:wing:1");
    // The wing sits at its own real-world coordinates (X around 361-372, Z
    // around 22-40), nowhere near the synthetic cases' origin-centred spawn —
    // approach it from due south of its own footprint instead.
    const spawnX = (wing.minX + wing.maxX) / 2;
    const spawnZ = wing.minZ - 25;
    const evidence = driveInto(
      wing,
      { x: spawnX, z: spawnZ, heading: 0 },
      { minX: wing.minX - 50, maxX: wing.maxX + 50, minZ: spawnZ - 20, maxZ: wing.maxZ + 20 },
    );
    expect(evidence).toBeDefined();
    expect(evidence!.obstacle).toBe("landmark");
    expect(evidence!.obstacleId).toBe("cairo-tahrir-ministries:wing:1");
  });
});
