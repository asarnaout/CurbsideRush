import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { hashStringToSeed } from "../app/game/visuals";
import {
  buildingSolidObstacleId,
  planMapBuildings,
  type BuildingLayoutPlan,
  type StructuralObb,
} from "../app/game/geometry/buildingLayout";
import { buildingKeepOuts } from "../app/game/geometry/facadesAndKeepouts";
import {
  buildStaticObstacles,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import type { MapPack, StaticObstacle } from "../app/game/types";

/**
 * The proof plan Section 10.2 asks for: the plan `planMapBuildings` produces
 * is not just A source collision reads from, it is the EXACT and ONLY source
 * — every planned structural solid has one "building" obstacle at its exact
 * transform, and every "building" obstacle traces back to exactly one
 * planned solid. This is what makes the render/collision drift (a wall drawn
 * where nothing blocks, or a block blocking where nothing is drawn)
 * structurally impossible rather than merely untested.
 */

const MAP_PACKS: readonly MapPack[] = [
  LONDON_MAP_PACK,
  CAIRO_MAP_PACK,
  NYC_MAP_PACK,
  TOKYO_MAP_PACK,
];

const EPSILON = 1e-9;

const boundsFor = (mapPack: MapPack) => {
  const padding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
  return {
    minX: -mapPack.geometry.worldSize.x / 2 - padding,
    maxX: mapPack.geometry.worldSize.x / 2 + padding,
    minZ: -mapPack.geometry.worldSize.z / 2 - padding,
    maxZ: mapPack.geometry.worldSize.z / 2 + padding,
  };
};

interface ExpectedSolid {
  readonly obstacleId: string;
  readonly buildingId: string;
  readonly blockId: string;
  readonly solid: StructuralObb;
}

function flattenExpectedSolids(
  plan: BuildingLayoutPlan,
): readonly ExpectedSolid[] {
  const expected: ExpectedSolid[] = [];
  for (const building of plan.buildings) {
    for (const solid of building.solids) {
      expected.push({
        obstacleId: buildingSolidObstacleId(building, solid),
        buildingId: building.id,
        blockId: building.blockId,
        solid,
      });
    }
  }
  return expected;
}

interface MapCase {
  readonly mapPack: MapPack;
  readonly plan: BuildingLayoutPlan;
  readonly obstacles: readonly StaticObstacle[];
  readonly buildingObstacles: readonly StaticObstacle[];
  readonly expectedSolids: readonly ExpectedSolid[];
}

// Any deterministic seed proves the invariant: which buildings exist and
// where is structural (seed-independent); only continuous procedural
// dimensions vary by seed, and every case here builds obstacles from the
// exact same plan instance it is compared against.
const CASES: readonly MapCase[] = MAP_PACKS.map((mapPack) => {
  const plan = planMapBuildings(mapPack, hashStringToSeed(mapPack.id));
  const obstacles = buildStaticObstacles({
    mapPack,
    bounds: boundsFor(mapPack),
    buildingLayout: plan,
  });
  return {
    mapPack,
    plan,
    obstacles,
    buildingObstacles: obstacles.filter((o) => o.tag === "building"),
    expectedSolids: flattenExpectedSolids(plan),
  };
});

/** Local (u, v) offset from a solid's own center to world space — the exact
 * inverse of `distanceToStaticObstacle`'s own world-to-local projection
 * (`du = dx·ux + dz·uz`, `dv = dx·uz − dz·ux`): since (ux, uz) is a unit
 * rotation, that 2×2 matrix is its own inverse. */
function localToWorld(
  solid: StructuralObb,
  u: number,
  v: number,
): { readonly x: number; readonly z: number } {
  return {
    x: solid.x + solid.ux * u + solid.uz * v,
    z: solid.z + solid.uz * u - solid.ux * v,
  };
}

const BOUNDARY_SAMPLE_FRACTIONS = [0.15, 0.5, 0.85] as const;
const BOUNDARY_MARGIN_M = 0.25;

/** A handful of points just inside and just outside each of a solid's own 4
 * faces. Not exhaustive edge coverage — just enough, at the plan's stated
 * 0.25 m resolution, to catch a materially wrong box: a swapped axis, a
 * stretched extent, or (the case this exists to guard against even though no
 * production building triggers it today — Phase 1's curated manifest is
 * currently single-solid everywhere) a future merged collider spanning two
 * disjoint planned solids of one compound building. */
function boundarySamples(
  solid: StructuralObb,
): readonly {
  readonly point: { readonly x: number; readonly z: number };
  readonly expectSolid: boolean;
}[] {
  const insetU = Math.min(BOUNDARY_MARGIN_M, solid.halfU * 0.4);
  const insetV = Math.min(BOUNDARY_MARGIN_M, solid.halfV * 0.4);
  const samples: {
    point: { x: number; z: number };
    expectSolid: boolean;
  }[] = [];
  for (const uSign of [-1, 1] as const) {
    for (const frac of BOUNDARY_SAMPLE_FRACTIONS) {
      const v = -solid.halfV + frac * 2 * solid.halfV;
      samples.push({
        point: localToWorld(solid, uSign * (solid.halfU - insetU), v),
        expectSolid: true,
      });
      samples.push({
        point: localToWorld(
          solid,
          uSign * (solid.halfU + BOUNDARY_MARGIN_M),
          v,
        ),
        expectSolid: false,
      });
    }
  }
  for (const vSign of [-1, 1] as const) {
    for (const frac of BOUNDARY_SAMPLE_FRACTIONS) {
      const u = -solid.halfU + frac * 2 * solid.halfU;
      samples.push({
        point: localToWorld(solid, u, vSign * (solid.halfV - insetV)),
        expectSolid: true,
      });
      samples.push({
        point: localToWorld(
          solid,
          u,
          vSign * (solid.halfV + BOUNDARY_MARGIN_M),
        ),
        expectSolid: false,
      });
    }
  }
  return samples;
}

describe("building collider agreement", () => {
  it("plans at least one building on every map", () => {
    for (const { mapPack, plan } of CASES) {
      expect(plan.buildings.length, mapPack.id).toBeGreaterThan(0);
    }
  });

  it("has exactly one 'building' obstacle per planned solid, by stable id — no plan solid without an obstacle, no obstacle not sourced from the plan", () => {
    for (const { mapPack, buildingObstacles, expectedSolids } of CASES) {
      const expectedIds = new Set(expectedSolids.map((e) => e.obstacleId));
      const actualIds = new Set(buildingObstacles.map((o) => o.id));

      const missing = [...expectedIds].filter((id) => !actualIds.has(id));
      const orphaned = [...actualIds].filter((id) => !expectedIds.has(id));

      expect(
        missing,
        `${mapPack.id}: plan solids with no matching "building" obstacle`,
      ).toEqual([]);
      expect(
        orphaned,
        `${mapPack.id}: "building" obstacles not sourced from any plan solid`,
      ).toEqual([]);
      // Belt and braces: a duplicate id on either side would cancel out in
      // the set differences above without changing set size, so check
      // count agreement too.
      expect(buildingObstacles.length, `${mapPack.id} obstacle count`).toBe(
        expectedIds.size,
      );
      expect(expectedSolids.length, `${mapPack.id} plan solid count`).toBe(
        expectedIds.size,
      );
    }
  });

  it("agrees with the plan's exact transform for every solid, at float epsilon", () => {
    const failures: string[] = [];
    for (const { mapPack, buildingObstacles, expectedSolids } of CASES) {
      const obstacleById = new Map(buildingObstacles.map((o) => [o.id, o]));
      for (const expected of expectedSolids) {
        const obstacle = obstacleById.get(expected.obstacleId);
        if (!obstacle) continue; // reported by the id-set test above
        if (obstacle.kind !== "obb") {
          failures.push(
            `${mapPack.id}/${expected.buildingId} (block ${expected.blockId}): obstacle ${obstacle.id} is kind "${obstacle.kind}", expected "obb"`,
          );
          continue;
        }
        const { solid } = expected;
        const fields: readonly [string, number, number][] = [
          ["x", obstacle.x, solid.x],
          ["z", obstacle.z, solid.z],
          ["ux", obstacle.ux, solid.ux],
          ["uz", obstacle.uz, solid.uz],
          ["halfU", obstacle.halfU, solid.halfU],
          ["halfV", obstacle.halfV, solid.halfV],
        ];
        for (const [field, actual, wanted] of fields) {
          if (Math.abs(actual - wanted) > EPSILON) {
            failures.push(
              `${mapPack.id}/${expected.buildingId} (block ${expected.blockId}, obstacle ${obstacle.id}): ${field} actual=${actual} expected=${wanted} — world-center=(${obstacle.x.toFixed(3)},${obstacle.z.toFixed(3)}) axes=(${obstacle.ux.toFixed(4)},${obstacle.uz.toFixed(4)}) extents=(${obstacle.halfU.toFixed(3)},${obstacle.halfV.toFixed(3)})`,
            );
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("agrees with distanceToStaticObstacle at fine boundary resolution — defense against a future merged collider", () => {
    const failures: string[] = [];
    for (const { mapPack, buildingObstacles, expectedSolids } of CASES) {
      const obstacleById = new Map(buildingObstacles.map((o) => [o.id, o]));
      for (const expected of expectedSolids) {
        const obstacle = obstacleById.get(expected.obstacleId);
        if (!obstacle) continue; // reported by the id-set test above
        for (const { point, expectSolid } of boundarySamples(
          expected.solid,
        )) {
          const distance = distanceToStaticObstacle(
            obstacle,
            point.x,
            point.z,
          );
          if (expectSolid !== (distance === 0)) {
            failures.push(
              `${mapPack.id}/${expected.buildingId} (block ${expected.blockId}, obstacle ${obstacle.id}): expected ${expectSolid ? "solid" : "open"} at (${point.x.toFixed(2)}, ${point.z.toFixed(2)}), got distance ${distance.toFixed(3)}`,
            );
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("exercises rotated blocks, one-edge strips, museum wings, procedural Tokyo, and venue/service keep-outs", () => {
    // This suite proves nothing about a category of block it never sees —
    // pin that every category the plan and the collision converter both
    // special-case is actually present across the map set under test.
    expect(
      LONDON_MAP_PACK.geometry.blocks.some(
        (block) => Math.abs(block.headingDeg ?? 0) > 1e-6,
      ),
      "expected at least one rotated block",
    ).toBe(true);
    expect(
      MAP_PACKS.some((pack) =>
        pack.geometry.blocks.some(
          (block) => (block.streetEdges?.length ?? 0) === 1,
        ),
      ),
      "expected at least one one-edge-strip block",
    ).toBe(true);
    const london = CASES.find((c) => c.mapPack.id === LONDON_MAP_PACK.id)!;
    expect(
      london.plan.buildings.some(
        (building) => building.source === "museum-wing",
      ),
      "expected at least one planned museum wing",
    ).toBe(true);
    const tokyo = CASES.find((c) => c.mapPack.id === TOKYO_MAP_PACK.id)!;
    expect(
      tokyo.plan.buildings.some(
        (building) => building.source === "procedural-cell",
      ),
      "expected at least one planned procedural Tokyo building",
    ).toBe(true);
    expect(
      MAP_PACKS.some((pack) => buildingKeepOuts(pack).length > 0),
      "expected at least one venue/service keep-out across the map set",
    ).toBe(true);
  });
});
