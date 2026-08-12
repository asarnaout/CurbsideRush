import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  buildingReservations,
  facadeGridCells,
  isInsideHistoricalBuffer,
  keptStreetWallBuildings,
  stagedBlockersOf,
} from "../app/game/geometry/facadesAndKeepouts";
import {
  buildingPlacementConfig,
  isBuildingSetId,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import { hashStringToSeed } from "../app/game/visuals";
import {
  buildSimulationCoreConfig,
  buildStaticObstacles,
  distanceToStaticObstacle,
  resolveSimulationLaneAnchor,
} from "../app/game/simulationAdapter";
import {
  buildPavementGraph,
  samplePavementEdge,
} from "../app/game/pavementPaths";
import {
  gasStationCanopyWorld,
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
  resolveServicePointLot,
  SERVICE_LOT_HALF_M,
} from "../app/game/servicePoints";
import {
  chooseStagedShot,
  repairCameraPosition,
  type StagedBlocker,
} from "../app/game/cutsceneScript";
import {
  REPAIR_SHOP_BAY_CLEAR_HEIGHT_M,
  REPAIR_SHOP_BACK_INNER_X,
  REPAIR_SHOP_BACK_OUTER_X,
  REPAIR_SHOP_BAY_CLEAR_WIDTH_M,
  REPAIR_SHOP_FLANK_Z,
  REPAIR_SHOP_MOUTH_X,
  REPAIR_SHOP_OFFICE_Z,
} from "../app/game/repairShopLayout";
import { PROP_MODEL_FOOTPRINTS_M } from "../app/game/propFootprints";
import {
  PAVED_SIDEWALK_WIDTH_M,
  resolveMapVisualPalette,
} from "../app/game/visuals";
import type {
  FreeDriveDefinition,
  StaticObstacle,
} from "../app/game/types";
import { CAREER_VEHICLES } from "../app/game/career";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";

// Mirrors the core's player capsule: circles of this radius trail/lead the
// centre. Driving centred along a lane, the car's lateral reach is exactly
// the capsule radius. Held to the widest/longest capsule any vehicle in the
// game uses (the van's, at the time of writing), not the default hatchback's
// — a test that only promised the hatchback access would pass while the van
// strands.
const PLAYER_CAPSULE_RADIUS_M = Math.max(
  ...CAREER_VEHICLES.map((vehicle) => vehicle.physics.playerCapsuleRadiusM),
);
const PLAYER_CAPSULE_HALF_LENGTH_M = Math.max(
  ...CAREER_VEHICLES.map(
    (vehicle) => vehicle.physics.playerCapsuleHalfLengthM,
  ),
);
const LANE_SAMPLE_SPACING_M = 2;

interface DriveWorld {
  readonly freeDrive: FreeDriveDefinition;
  readonly obstacles: readonly StaticObstacle[];
  readonly lanes: NonNullable<
    ReturnType<typeof buildSimulationCoreConfig>["lanes"]
  >;
  readonly spawn: NonNullable<
    ReturnType<typeof buildSimulationCoreConfig>["spawn"]
  >;
}

const driveWorlds: DriveWorld[] = FREE_DRIVES.map((freeDrive) => {
  const country = getCountryProfile(freeDrive.countryId);
  const config = buildSimulationCoreConfig({
    scenario: buildFreeDriveScenario(freeDrive),
    mapPack: getMapPack(freeDrive.mapId),
    trafficSide: country.trafficSide,
    speedUnit: country.speedUnit,
  });
  if (!config.staticObstacles || !config.lanes || !config.spawn) {
    throw new Error(`free drive ${freeDrive.id} produced an incomplete config`);
  }
  return {
    freeDrive,
    obstacles: config.staticObstacles,
    lanes: config.lanes,
    spawn: config.spawn,
  };
});

const clearanceToNearestObstacle = (
  obstacles: readonly StaticObstacle[],
  x: number,
  z: number,
): { distance: number; id: string } => {
  let best = Number.POSITIVE_INFINITY;
  let bestId = "";
  for (const obstacle of obstacles) {
    const distance = distanceToStaticObstacle(obstacle, x, z);
    if (distance < best) {
      best = distance;
      bestId = obstacle.id;
    }
  }
  return { distance: best, id: bestId };
};

/**
 * Uniform-grid index over a fixed, arbitrary item set — built once per world
 * so the heaviest sweeps below (thousands of sample points/segments, each
 * tested against every obstacle or staged blocker in the map) don't each
 * brute-force-scan the whole array. Test-only — never how the real 60 Hz
 * solver queries (that stays a flat per-tick scan of a few thousand
 * obstacles, ~0.35 ms/tick measured; see `tests/perf/staticCollision.bench.ts`);
 * this mirrors the bucketing technique plan Section 7.10 describes for the
 * production solver, but only ever backs assertions here. Generic over the
 * item type so the same proven index backs both a `StaticObstacle[]` (the
 * clearance sweeps) and a `StagedBlocker[]` (the staged-shot sweep) — two
 * structurally different box/circle unions with no common supertype, hence
 * the caller-supplied `boundsOf`.
 *
 * Correct up to `SPATIAL_INDEX_CELL_SIZE_M`: a query inspects only the 3x3
 * neighbourhood of cells around the query point's own cell, which is exact
 * for any true nearest distance up to one cell width. Proof sketch: every
 * item is inserted into every cell its own *exact* axis-aligned bounds
 * overlap (a full AABB, not a circumscribed circle, so a long thin obstacle
 * like a world-edge fence or a shoreline run costs cells proportional to its
 * own footprint, not its diagonal reach). If some item is within distance
 * `d` of query point P, then P is also within `d` of that item's AABB (the
 * AABB contains the item, so its boundary is never farther from an outside
 * point than the item's own boundary is) — so for `d <= SPATIAL_INDEX_CELL_SIZE_M`,
 * the AABB necessarily overlaps a cell within one cell-width of P's own
 * cell, i.e. the 3x3 neighbourhood. Every call site below only ever needs a
 * fixed distance/reach far under that: the staged-shot sweep's own `wanted`/
 * `subjects` are fixed offsets (radius 9, +-1.5) from its own query centre,
 * and a segment between two points each within R of a centre never leaves
 * that centre's own R-disk (the disk is convex), so a query at the centre
 * is exact for the whole segment at exactly 9 m; the clearance sweeps need
 * at most 2.7 m — both comfortably inside the proven-exact range.
 */
const SPATIAL_INDEX_CELL_SIZE_M = 16;

interface SpatialIndex<T> {
  readonly query: (x: number, z: number) => readonly T[];
}

const buildSpatialIndex = <T>(
  items: readonly T[],
  boundsOf: (item: T) => { minX: number; maxX: number; minZ: number; maxZ: number },
): SpatialIndex<T> => {
  const cellOf = (v: number) => Math.floor(v / SPATIAL_INDEX_CELL_SIZE_M);
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const bounds = boundsOf(item);
    const minCx = cellOf(bounds.minX);
    const maxCx = cellOf(bounds.maxX);
    const minCz = cellOf(bounds.minZ);
    const maxCz = cellOf(bounds.maxZ);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cz = minCz; cz <= maxCz; cz += 1) {
        const key = `${cx}:${cz}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(item);
        else cells.set(key, [item]);
      }
    }
  }
  return {
    query: (x, z) => {
      const cx = cellOf(x);
      const cz = cellOf(z);
      const seen = new Set<T>();
      const result: T[] = [];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = cells.get(`${cx + dx}:${cz + dz}`);
          if (!bucket) continue;
          for (const item of bucket) {
            if (seen.has(item)) continue;
            seen.add(item);
            result.push(item);
          }
        }
      }
      return result;
    },
  };
};

/** Corners of an OBB-shaped `{x,z,ux,uz,halfU,halfV}` box, world space. */
const boxCornersM = (box: {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}): readonly { x: number; z: number }[] =>
  (
    [
      [box.halfU, box.halfV],
      [box.halfU, -box.halfV],
      [-box.halfU, box.halfV],
      [-box.halfU, -box.halfV],
    ] as const
  ).map(([u, v]) => ({
    x: box.x + box.ux * u + box.uz * v,
    z: box.z + box.uz * u - box.ux * v,
  }));

const obstacleBoundsM = (
  obstacle: StaticObstacle,
): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  if (obstacle.kind === "circle") {
    return {
      minX: obstacle.x - obstacle.radius,
      maxX: obstacle.x + obstacle.radius,
      minZ: obstacle.z - obstacle.radius,
      maxZ: obstacle.z + obstacle.radius,
    };
  }
  if (obstacle.kind === "aabb") {
    return {
      minX: obstacle.minX,
      maxX: obstacle.maxX,
      minZ: obstacle.minZ,
      maxZ: obstacle.maxZ,
    };
  }
  if (obstacle.kind === "obb") {
    const corners = boxCornersM(obstacle);
    return {
      minX: Math.min(...corners.map((corner) => corner.x)),
      maxX: Math.max(...corners.map((corner) => corner.x)),
      minZ: Math.min(...corners.map((corner) => corner.z)),
      maxZ: Math.max(...corners.map((corner) => corner.z)),
    };
  }
  return {
    minX: Math.min(...obstacle.points.map((point) => point.x)),
    maxX: Math.max(...obstacle.points.map((point) => point.x)),
    minZ: Math.min(...obstacle.points.map((point) => point.z)),
    maxZ: Math.max(...obstacle.points.map((point) => point.z)),
  };
};

const buildObstacleIndex = (
  obstacles: readonly StaticObstacle[],
): SpatialIndex<StaticObstacle> => buildSpatialIndex(obstacles, obstacleBoundsM);

const clearanceToNearestIndexedObstacle = (
  index: SpatialIndex<StaticObstacle>,
  x: number,
  z: number,
): { distance: number; id: string } =>
  clearanceToNearestObstacle(index.query(x, z), x, z);

const blockerBoundsM = (
  box: StagedBlocker,
): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  if ("points" in box) {
    return {
      minX: Math.min(...box.points.map((point) => point.x)),
      maxX: Math.max(...box.points.map((point) => point.x)),
      minZ: Math.min(...box.points.map((point) => point.z)),
      maxZ: Math.max(...box.points.map((point) => point.z)),
    };
  }
  const corners = boxCornersM(box);
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minZ: Math.min(...corners.map((corner) => corner.z)),
    maxZ: Math.max(...corners.map((corner) => corner.z)),
  };
};

const buildBlockerIndex = (
  blockers: readonly StagedBlocker[],
): SpatialIndex<StagedBlocker> => buildSpatialIndex(blockers, blockerBoundsM);

/** Point-in-polygon by ray casting (even-odd rule) — genuinely independent
 * of the winding-dependent cross-product test `cutsceneScript.ts`'s own
 * `pointInConvexBlocker` uses, so this test double cannot share a bug with
 * the routine it verifies. */
const pointInPolygonRayCast = (
  px: number,
  pz: number,
  points: readonly { readonly x: number; readonly z: number }[],
): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    if (
      pi.z > pz !== pj.z > pz &&
      px < ((pj.x - pi.x) * (pz - pi.z)) / (pj.z - pi.z) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/** Segment-vs-blocker by sampling: slow, but obviously right, which is the
 * point of a test double for the routine under test. */
const segmentCrossesBox = (
  from: { x: number; z: number },
  to: { x: number; z: number },
  box: StagedBlocker,
): boolean => {
  for (let step = 0; step <= 200; step += 1) {
    const t = step / 200;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if ("points" in box) {
      if (pointInPolygonRayCast(x, z, box.points)) return true;
      continue;
    }
    const dx = x - box.x;
    const dz = z - box.z;
    if (
      Math.abs(dx * box.ux + dz * box.uz) <= box.halfU &&
      Math.abs(dx * box.uz - dz * box.ux) <= box.halfV
    ) {
      return true;
    }
  }
  return false;
};

describe("static obstacle build", () => {
  it("produces a solid world for every free-drive map", () => {
    for (const world of driveWorlds) {
      expect(world.obstacles.length).toBeGreaterThan(4);
      // The four world-edge fences are always present.
      const edges = world.obstacles.filter((o) => o.tag === "worldEdge");
      expect(edges).toHaveLength(4);
      // Building obstacles now come one-per-planned-solid rather than
      // one-per-authored-block (`buildingColliderAgreement.test.ts` owns the
      // exact plan-to-obstacle parity); this is only the cheap sanity check
      // that the source produced something at all.
      const buildings = world.obstacles.filter((o) => o.tag === "building");
      expect(buildings.length).toBeGreaterThan(0);
      const ids = new Set(world.obstacles.map((o) => o.id));
      expect(ids.size).toBe(world.obstacles.length);
      for (const obstacle of world.obstacles) {
        for (const value of Object.values(obstacle)) {
          if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  // Kind-agnostic on purpose: neither a forecourt nor a bay floor may be solid,
  // and both kinds' own furniture is emitted under a prefixed id, never the
  // service point's own.
  it("never turns a service lot solid — the car has to drive onto it", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const serviceIds = new Set(
        (mapPack.geometry.servicePoints ?? []).map((service) => service.id),
      );
      for (const obstacle of world.obstacles) {
        expect(serviceIds.has(obstacle.id)).toBe(false);
      }
    }
  });

  it("is deterministic — two builds are identical", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      // Mirrors the adapter's bounds formula (worldSize/2 + shoulder padding).
      const padding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
      const again = buildStaticObstacles({
        mapPack,
        bounds: {
          minX: -mapPack.geometry.worldSize.x / 2 - padding,
          maxX: mapPack.geometry.worldSize.x / 2 + padding,
          minZ: -mapPack.geometry.worldSize.z / 2 - padding,
          maxZ: mapPack.geometry.worldSize.z / 2 + padding,
        },
        buildingLayout: planMapBuildings(
          mapPack,
          buildFreeDriveScenario(world.freeDrive).trafficSeed,
          relaxationPolicyForMap(mapPack.id),
        ),
      });
      expect(again).toEqual(world.obstacles);
    }
  });
});

describe("the drivable world stays open", () => {
  // The next two tests sample thousands of points against every obstacle in
  // every free-drive map — the heaviest sweeps in this file, so each builds
  // a `buildObstacleIndex` once per world rather than brute-forcing every
  // sample against the whole array (see that index's own doc comment for why
  // the result is identical either way, up to a 2.7 m proven-exact margin
  // over anything either sweep actually tests). Never how the real 60 Hz
  // solver queries — that stays a flat per-tick scan of a few thousand
  // obstacles, ~0.35 ms/tick measured; see `tests/perf/staticCollision.bench.ts`.
  // "leaves a staged shot alone" further down uses the same index technique
  // over staged blockers instead, for the same reason.
  it("keeps every lane corridor clear of every solid obstacle", () => {
    const failures: string[] = [];
    for (const world of driveWorlds) {
      const index = buildObstacleIndex(world.obstacles);
      for (const lane of world.lanes) {
        const laneWidth = lane.width ?? 3.5;
        const required = laneWidth / 2 + PLAYER_CAPSULE_RADIUS_M - 0.05;
        const points = lane.points;
        for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
          const start = points[pointIndex];
          const end = points[pointIndex + 1];
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          const steps = Math.max(1, Math.ceil(length / LANE_SAMPLE_SPACING_M));
          for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const x = start.x + (end.x - start.x) * t;
            const z = start.z + (end.z - start.z) * t;
            const nearest = clearanceToNearestIndexedObstacle(index, x, z);
            if (nearest.distance < required) {
              failures.push(
                `${world.freeDrive.mapId} lane ${lane.id} @ (${x.toFixed(1)}, ${z.toFixed(1)}): ${nearest.id} within ${nearest.distance.toFixed(2)}m (< ${required.toFixed(2)}m)`,
              );
            }
          }
        }
      }
    }
    expect(failures.slice(0, 25)).toEqual([]);
  });

  it("keeps every free-drive spawn pose clear of the solid world", () => {
    for (const world of driveWorlds) {
      const nearest = clearanceToNearestObstacle(
        world.obstacles,
        world.spawn.x,
        world.spawn.z,
      );
      expect(
        nearest.distance,
        `${world.freeDrive.id} spawns ${nearest.distance.toFixed(2)}m from ${nearest.id}`,
      ).toBeGreaterThanOrEqual(
        PLAYER_CAPSULE_RADIUS_M + PLAYER_CAPSULE_HALF_LENGTH_M,
      );
    }
  });

  it("never walls off the walkable pavement — anywhere across the band", () => {
    // Where a walker can stroll, the car must never hit an invisible face:
    // an oversized venue footprint once stopped the car a whole pavement
    // short of the visible storefront (and its successor bug hid in the band
    // edges the rail centreline missed). Box solids must stay clear of the
    // FULL walkable band — rail centre plus both edges; buildings standing
    // flush against the band's back edge are fine. Small street-furniture
    // circles (the London pillar box, park feature trees) legitimately stand
    // on the pavement and walkers route around them.
    const failures: string[] = [];
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const palette = resolveMapVisualPalette(mapPack.id);
      const defaultSidewalkWidthM = palette.paved
        ? PAVED_SIDEWALK_WIDTH_M
        : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2);
      const sidewalkWidthM = Math.min(
        defaultSidewalkWidthM,
        ...mapPack.geometry.roadSurfaces.map(
          (surface) => surface.sidewalkWidthM ?? defaultSidewalkWidthM,
        ),
      );
      const graph = buildPavementGraph(mapPack.geometry.roadSurfaces, {
        sidewalkWidthM: defaultSidewalkWidthM,
      });
      const lateralOffsets = [
        -(sidewalkWidthM / 2 - 0.4),
        0,
        sidewalkWidthM / 2 - 0.4,
      ];
      const solids = world.obstacles.filter(
        (obstacle) =>
          obstacle.tag !== "worldEdge" &&
          !(obstacle.kind === "circle" && obstacle.radius <= 2.5),
      );
      const index = buildObstacleIndex(solids);
      for (const edge of graph.edges) {
        const steps = Math.max(1, Math.ceil(edge.lengthM / 1.5));
        for (let step = 0; step <= steps; step += 1) {
          const pose = samplePavementEdge(edge, (edge.lengthM * step) / steps);
          const lateralX = Math.cos(pose.headingRad);
          const lateralZ = -Math.sin(pose.headingRad);
          for (const offset of lateralOffsets) {
            const x = pose.x + lateralX * offset;
            const z = pose.z + lateralZ * offset;
            const nearest = clearanceToNearestIndexedObstacle(index, x, z);
            if (nearest.distance < 0.3) {
              failures.push(
                `${world.freeDrive.mapId}: ${nearest.id} covers the pavement at (${x.toFixed(1)}, ${z.toFixed(1)}) — ${nearest.distance.toFixed(2)}m`,
              );
            }
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("keeps every gas station enterable, with a clear stop beside each pump", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      // Gas only: the aisle point and the pump ring below are station geometry,
      // and a repair shop run through them would pass vacuously.
      for (const service of gasStationsOf(mapPack.geometry.servicePoints)) {
        const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
        expect(lot, `${service.id} lot`).not.toBeNull();
        if (!lot) continue;
        const pose = resolveSimulationLaneAnchor(
          mapPack.laneGraph.lanes,
          service.anchor,
        );
        expect(pose, `${service.id} anchor`).not.toBeNull();
        if (!pose) continue;
        // The drive-in line: from the anchor on the road to the aisle between
        // the two pump islands (holder-frame point (2, -5.15)).
        const heading = lot.yaw - Math.PI / 2;
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const aisle = {
          x: lot.x + 2 * cos + -5.15 * sin,
          z: lot.z - 2 * sin + -5.15 * cos,
        };
        const approachLength = Math.hypot(aisle.x - pose.x, aisle.z - pose.z);
        const approachSteps = Math.ceil(approachLength);
        for (let step = 0; step <= approachSteps; step += 1) {
          const t = step / approachSteps;
          const x = pose.x + (aisle.x - pose.x) * t;
          const z = pose.z + (aisle.z - pose.z) * t;
          const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
          expect(
            nearest.distance,
            `${service.id} approach blocked by ${nearest.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(PLAYER_CAPSULE_RADIUS_M);
        }
        // Each pump must offer at least one capsule-clear stop within the
        // refuel prompt's reach.
        for (const pump of gasStationPumpPositions(
          mapPack.laneGraph.lanes,
          service,
        )) {
          let reachable = false;
          for (let angle = 0; angle < 16 && !reachable; angle += 1) {
            const theta = (angle / 16) * Math.PI * 2;
            const x = pump.x + Math.cos(theta) * 2.2;
            const z = pump.z + Math.sin(theta) * 2.2;
            if (Math.hypot(x - lot.x, z - lot.z) > 13) continue;
            const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
            reachable = nearest.distance >= PLAYER_CAPSULE_RADIUS_M;
          }
          expect(
            reachable,
            `${service.id} pump at (${pump.x.toFixed(1)}, ${pump.z.toFixed(1)}) has no clear stop`,
          ).toBe(true);
        }
        // And the station's own furniture is solid: pump islands + shop.
        const stationSolids = world.obstacles.filter((obstacle) =>
          obstacle.id.includes("-pumps-") || obstacle.id.includes("-shop"),
        );
        expect(stationSolids.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps every repair bay drivable, and walls it on exactly three sides", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const service of repairShopsOf(mapPack.geometry.servicePoints)) {
        const pose = resolveSimulationLaneAnchor(
          mapPack.laneGraph.lanes,
          service.anchor,
        );
        const bay = repairShopBayPosition(mapPack.laneGraph.lanes, service);
        expect(pose, `${service.id} anchor`).not.toBeNull();
        expect(bay, `${service.id} bay`).not.toBeNull();
        if (!pose || !bay) continue;

        // The drive-in line: from the kerb anchor straight into the bay. Held
        // to the widest capsule in the game (the van's), not the
        // flagship's — a bay only the small cars fit is a bay that strands the
        // one vehicle most likely to be carrying damage.
        const approach = Math.hypot(bay.x - pose.x, bay.z - pose.z);
        const steps = Math.ceil(approach);
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const x = pose.x + (bay.x - pose.x) * t;
          const z = pose.z + (bay.z - pose.z) * t;
          const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
          expect(
            nearest.distance,
            `${service.id} approach blocked by ${nearest.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(PLAYER_CAPSULE_RADIUS_M);
        }

        // The three walls exist as obstacles...
        for (const part of ["flank", "back", "office"]) {
          expect(
            world.obstacles.some((o) => o.id.endsWith(`-${part}`)),
            `${service.id} has no ${part} collider`,
          ).toBe(true);
        }
        // ...and they are actually where the bay is walled. Without probing
        // outward, a typo in the solids table could leave the shop a
        // drive-through and every other assertion here would still pass.
        const cos = Math.cos(pose.heading);
        const sin = Math.sin(pose.heading);
        // Shop-frame -> world, matching the collider builder's transform.
        const at = (fx: number, fz: number) => ({
          x: bay.x + fx * cos + fz * sin,
          z: bay.z - fx * sin + fz * cos,
        });
        // Probed at each wall's own mid-thickness, not just beyond it: a point
        // outside the building can be solid for an unrelated reason (a block
        // rect the carve did not reach), which would let a missing wall pass.
        const bayHalfWidth = REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2;
        const walled: [string, number, number][] = [
          [
            "back wall",
            (REPAIR_SHOP_BACK_INNER_X + REPAIR_SHOP_BACK_OUTER_X) / 2,
            0,
          ],
          ["flank", 0, (REPAIR_SHOP_FLANK_Z - bayHalfWidth) / 2],
          ["office side", 0, (bayHalfWidth + REPAIR_SHOP_OFFICE_Z) / 2],
        ];
        for (const [what, fx, fz] of walled) {
          const probe = at(fx, fz);
          expect(
            clearanceToNearestObstacle(world.obstacles, probe.x, probe.z)
              .distance,
            `${service.id} is open where its ${what} should be`,
          ).toBe(0);
        }
        // ...while the mouth is not.
        const mouth = at(REPAIR_SHOP_MOUTH_X - 0.6, 0);
        expect(
          clearanceToNearestObstacle(world.obstacles, mouth.x, mouth.z).distance,
          `${service.id} is walled across its mouth`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("watches the repair scene from outside the shop, not from inside a wall", () => {
    // The generic cutscene stager offsets nine metres perpendicular to the
    // car and lifts the camera above four — fine on a forecourt, and inside
    // the office wall and the bay roof for a car parked in a 4.6 m bay. It
    // shipped that way for exactly one screenshot. Checked per shop rather
    // than by eye because "inside a wall" and "in a dark garage" look alike.
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const service of repairShopsOf(mapPack.geometry.servicePoints)) {
        const pose = resolveSimulationLaneAnchor(
          mapPack.laneGraph.lanes,
          service.anchor,
        );
        const bay = repairShopBayPosition(mapPack.laneGraph.lanes, service);
        if (!pose || !bay) continue;
        // The mouth faces back against the driver-right set-back that put the
        // shop off the road, which is the rule the session uses.
        const mouth = {
          x: -Math.cos(pose.heading),
          z: Math.sin(pose.heading),
        };
        // Worst case for the sideways offset: the driver works on whichever
        // flank, so check both.
        for (const side of [
          { x: -mouth.z, z: mouth.x },
          { x: mouth.z, z: -mouth.x },
        ]) {
        const shot = repairCameraPosition(bay.x, bay.z, mouth, side);

        const nearest = clearanceToNearestObstacle(
          world.obstacles,
          shot.x,
          shot.z,
        );
        expect(
          nearest.distance,
          `${service.id} is filmed from inside ${nearest.id}`,
        ).toBeGreaterThan(0);
        // It also has to be on the road side of the mouth, or it is outside a
        // wall rather than outside the building — still a wall on screen.
        const towardRoad =
          (shot.x - bay.x) * mouth.x + (shot.z - bay.z) * mouth.z;
        expect(towardRoad, `${service.id} camera is behind the bay`).toBeGreaterThan(
          -REPAIR_SHOP_MOUTH_X,
        );
        // Under the lintel, so the sightline goes through the opening.
        expect(shot.y).toBeLessThan(REPAIR_SHOP_BAY_CLEAR_HEIGHT_M);
        // And square enough on to see through it. Outside the opening's own
        // width the camera looks along the outside of the flank at the next
        // building — not inside a wall, and just as useless.
        const aside = Math.abs(
          (shot.x - bay.x) * -mouth.z + (shot.z - bay.z) * mouth.x,
        );
        expect(
          aside,
          `${service.id} is filmed from beside the opening, not through it`,
        ).toBeLessThan(REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2 - 0.5);
        }
      }
    }
  });

  it("stands the canopy over the pumps it is supposed to cover", () => {
    // GAS_STATION_CANOPY_M is measured in the holder frame, so it has to be
    // turned by the lane heading and not by the lot yaw — the two differ by the
    // kind's yawOffset, and a quarter-turn of a 7x13 m slab still covers *some*
    // of the forecourt. That is the failure that would ship as "the camera fix
    // works at some stations and not others", so pin it per station: every pump
    // the refuel scene can stage at must be under the roof the camera ducks.
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const service of gasStationsOf(mapPack.geometry.servicePoints)) {
        const canopy = gasStationCanopyWorld(mapPack.laneGraph.lanes, service);
        expect(canopy, `${service.id} has no canopy`).not.toBeNull();
        if (!canopy) continue;
        for (const pump of gasStationPumpPositions(
          mapPack.laneGraph.lanes,
          service,
        )) {
          const dx = pump.x - canopy.x;
          const dz = pump.z - canopy.z;
          const u = Math.abs(dx * canopy.ux + dz * canopy.uz);
          const v = Math.abs(dx * canopy.uz - dz * canopy.ux);
          expect(u, `${service.id} pump is off the end of its canopy`).toBeLessThan(
            canopy.halfU,
          );
          expect(v, `${service.id} pump is out from under its canopy`).toBeLessThan(
            canopy.halfV,
          );
        }
        // The slab stands on the pillars folded into the island boxes, so it
        // cannot be shorter than they are tall.
        expect(canopy.undersideY).toBeGreaterThan(3);
      }
    }
  });

  it("leaves a staged shot alone unless something is actually in the way", () => {
    // `chooseStagedShot` now runs for every scene that takes the generic
    // framing, not just the ones on a forecourt — so the thing worth pinning is
    // that it is inert. Walk real kerbside poses on every map, stage a
    // car-and-actor pair at each, and require the solve to return the azimuth
    // the stager asked for whenever that azimuth's own sightlines are clear.
    // Anything else and this would be quietly re-framing scenes nobody
    // reported a problem with.
    let clear = 0;
    let moved = 0;
    for (const world of driveWorlds) {
      const blockers = stagedBlockersOf(world.obstacles);
      // The test's own double-check below samples every blocker at 200 steps
      // per (wanted, subject) segment with no broad-phase of its own; a
      // per-world index keeps that check's cost proportional to what is
      // actually near each sample, not to every blocker on the map. This
      // never touches the `chooseStagedShot` call itself, which must keep
      // seeing the exact same full `blockers` array production code passes.
      const blockerIndex = buildBlockerIndex(blockers);
      for (const lane of world.lanes) {
        for (const point of lane.points.slice(0, 6)) {
          // The actor stands off the car's side, as every generic scene has it.
          const focus = { x: point.x + 3, z: point.z };
          const midX = (point.x + focus.x) / 2;
          const midZ = (point.z + focus.z) / 2;
          const span = 3;
          const radius = Math.max(9, span * 0.85);
          const preferred = { x: 0, z: 1 };
          const wanted = {
            x: midX + preferred.x * radius,
            z: midZ + preferred.z * radius,
          };
          const subjects = [{ x: point.x, z: point.z }, focus];
          const nearbyBlockers = blockerIndex.query(midX, midZ);
          const blocked = nearbyBlockers.some((box) =>
            subjects.some((subject) =>
              segmentCrossesBox(wanted, subject, box),
            ),
          );
          const shot = chooseStagedShot(
            midX,
            midZ,
            radius,
            4.95,
            preferred,
            subjects,
            blockers,
            null,
          );
          if (blocked) {
            moved += 1;
            continue;
          }
          clear += 1;
          expect(shot.x).toBeCloseTo(wanted.x, 6);
          expect(shot.z).toBeCloseTo(wanted.z, 6);
          expect(shot.y).toBe(4.95);
        }
      }
    }
    // Both arms have to be exercised or the assertion above proves nothing.
    expect(clear).toBeGreaterThan(50);
    expect(moved).toBeGreaterThan(0);
  });

  it("never stands a street-wall building inside a service lot", () => {
    // The shared building plan is what both the street wall and the collider
    // read (`geometry/buildingLayout.ts`), so a building the render-side
    // keep-out predicate wrongly lets through is not just a paint problem —
    // it becomes a real, drivable-through building collider standing in the
    // lot. Historically the two street-wall paths read their keep-outs at
    // very different times — the instanced glb wall after preload, the
    // procedural facade grid inline — and while the keep-outs were collected
    // as buildings were placed, only the deferred one saw them. A terrace stood
    // through London's and Tokyo's repair shops; the gas stations were spared
    // only because every one of them sits on ground no block covers.
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const reservations = buildingReservations(mapPack);
      for (const service of mapPack.geometry.servicePoints ?? []) {
        const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
        if (!lot) continue;
        const halfLot = SERVICE_LOT_HALF_M[service.kind];
        for (const block of mapPack.geometry.blocks) {
          // Museum blocks render as two wings, not a grid.
          if (block.material.endsWith("-museum")) continue;
          for (const cell of facadeGridCells(block)) {
            // Widest the size jitter can make the box.
            const reachX = halfLot + (cell.cellWidth * 0.82) / 2;
            const reachZ = halfLot + (cell.cellDepth * 0.82) / 2;
            const overlaps =
              Math.abs(cell.x - lot.x) < reachX &&
              Math.abs(cell.z - lot.z) < reachZ;
            if (!overlaps) continue;
            expect(
              isInsideHistoricalBuffer(
                reservations,
                cell.x,
                cell.z,
                (cell.cellWidth * 0.82) / 2,
                (cell.cellDepth * 0.82) / 2,
              ),
              `${block.id}#${cell.index} would stand in ${service.id}'s lot`,
            ).toBe(true);
          }

          // ...and the instanced glb street wall, which is what NYC actually
          // renders. Its buildings are slotted along the block edge, so this is
          // where a neighbour's flank reaches into a shop even though its centre
          // is comfortably outside the keep-out.
          //
          // Run through `keptStreetWallBuildings` — the same call the renderer
          // makes — rather than re-deciding here. An earlier version of this
          // recomputed the predicate itself, which meant it passed no matter
          // what the renderer did, and it did indeed pass while a brownstone
          // was meshed into Broadway Auto.
          if (!block.buildingSet || !isBuildingSetId(block.buildingSet)) continue;
          const kept = keptStreetWallBuildings(
            slotBlockBuildings(
              block.center,
              block.size,
              block.buildingSet,
              hashStringToSeed(`${block.id}-buildings`),
            ),
            reservations,
          );
          for (const placed of kept) {
            const half =
              (buildingPlacementConfig(placed.modelId)?.footprintM ?? 0) / 2;
            const nearestX = Math.max(
              placed.x - half,
              Math.min(lot.x, placed.x + half),
            );
            const nearestZ = Math.max(
              placed.z - half,
              Math.min(lot.z, placed.z + half),
            );
            expect(
              Math.abs(nearestX - lot.x) < halfLot &&
                Math.abs(nearestZ - lot.z) < halfLot,
              `${placed.modelId} on ${block.id} reaches into ${service.id}'s lot`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it("aligns venue colliders with their measured models, off the pavement", () => {
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      for (const venue of mapPack.geometry.gigVenues ?? []) {
        const footprint = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
        expect(
          footprint,
          `${mapPack.id}/${venue.id} has no measured model footprint`,
        ).toBeDefined();
        if (!footprint) continue;
        const obstacle = world.obstacles.find((o) => o.id === venue.id);
        expect(obstacle?.kind, venue.id).toBe("obb");
        if (obstacle?.kind !== "obb") continue;
        // Collider footprint must match the measured model exactly.
        expect(obstacle.halfU).toBeCloseTo(
          (footprint.maxZ - footprint.minZ) / 2,
          6,
        );
        expect(obstacle.halfV).toBeCloseTo(
          (footprint.maxX - footprint.minX) / 2,
          6,
        );
      }
    }
  });
});

describe("plan-based collision fixes the reported render/collider gaps", () => {
  // Each probe below is a concrete point a full-block collider used to wall
  // off even though nothing was ever drawn there — the exact class of bug
  // `.claude/building-collision-visual-parity-plan.md` exists to fix.
  // Literal map/block ids and coordinates (checked directly against
  // `planMapBuildings`'s own output), not a re-derivation of the layout
  // rules: a regression here means this SPECIFIC reported gap reopened, not
  // just "some predicate somewhere disagrees with another".

  const worldFor = (mapId: string) => {
    const world = driveWorlds.find((w) => w.freeDrive.mapId === mapId);
    if (!world) throw new Error(`no free-drive world for map "${mapId}"`);
    return world;
  };

  const buildingClearanceAt = (
    obstacles: readonly StaticObstacle[],
    x: number,
    z: number,
  ): { distance: number; id: string } =>
    clearanceToNearestObstacle(
      obstacles.filter((o) => o.tag === "building"),
      x,
      z,
    );

  it("leaves every service/venue keep-out free of an orphan building collider", () => {
    // Before the plan, a keep-out only ever stopped a NEW building from being
    // slotted there; the block's own full rect still stood behind it. Sample
    // each keep-out's centre and four half-radius points — comfortably
    // inside the circle, clear of its own venue/service furniture, which is
    // tagged "venue"/"landmark", never "building", so it can never mask an
    // orphan building collider standing at the same spot. Museum wings are
    // excluded on purpose: `planMuseumWings` never consults keep-outs at all
    // (neither did the old per-block museum branch it replaced), so a
    // venue's generous keep-out circle legitimately grazing a fixed museum
    // wing is expected, pre-existing geometry — not the class of orphan this
    // test exists to catch.
    const failures: string[] = [];
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const nonMuseumObstacles = world.obstacles.filter(
        (o) => !o.id.includes(":museum-wing:"),
      );
      const historicalBufferCircles = buildingReservations(mapPack)
        .map((r) => r.geometry)
        .filter((g): g is Extract<typeof g, { readonly kind: "circle" }> => g.kind === "circle");
      for (const keepOut of historicalBufferCircles) {
        const samplePoints = [
          { x: keepOut.x, z: keepOut.z },
          ...[0, 90, 180, 270].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return {
              x: keepOut.x + Math.cos(rad) * keepOut.radius * 0.7,
              z: keepOut.z + Math.sin(rad) * keepOut.radius * 0.7,
            };
          }),
        ];
        for (const point of samplePoints) {
          const nearest = buildingClearanceAt(
            nonMuseumObstacles,
            point.x,
            point.z,
          );
          if (nearest.distance === 0) {
            failures.push(
              `${world.freeDrive.mapId}: keep-out @ (${keepOut.x.toFixed(1)},${keepOut.z.toFixed(1)}) r=${keepOut.radius.toFixed(1)} has orphan collider ${nearest.id} at (${point.x.toFixed(1)},${point.z.toFixed(1)})`,
            );
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("leaves the rear of a one-sided London strip open", () => {
    // london-block-kensington-s-w: centre (-167,191.6) size (94,40),
    // streetEdges ["+z"] — every planned building sits at z in
    // [201.75,211.5] (the +z frontage). The rear of the block, z=180, is 20+
    // m below that and was still inside the old full-block rect
    // [171.6,211.6] x [-14,20] ... i.e. x in [-214,-120], z in [171.6,211.6].
    const world = worldFor("london-south-kensington");
    const nearest = buildingClearanceAt(world.obstacles, -167, 180);
    expect(nearest.distance, `blocked by ${nearest.id}`).toBeGreaterThan(0);
  });

  it("leaves the rear of a one-sided Cairo strip open", () => {
    // cairo-tahrir-frontage-block: centre (391,28) size (32,14.5),
    // streetEdges ["-z"] — both planned buildings sit at z in [23.25,28.8].
    // z=33 is past that, but still inside the old full-block rect
    // [20.75,35.25].
    const world = worldFor("cairo-central-nile");
    const nearest = buildingClearanceAt(world.obstacles, 391, 33);
    expect(nearest.distance, `blocked by ${nearest.id}`).toBeGreaterThan(0);
  });

  it("leaves the London museum forecourt open", () => {
    // london-natural-history-museum-block's own centre, (-26,-76): the two
    // wings sit either side of it (x < -56.09 and x > 4.09), so the centre
    // itself is the forecourt gap between them — solid under the old single
    // full-block rect, open now that the wings are the only planned solids.
    const world = worldFor("london-south-kensington");
    const nearest = buildingClearanceAt(world.obstacles, -26, -76);
    expect(nearest.distance, `blocked by ${nearest.id}`).toBeGreaterThan(0);
  });

  it("leaves a Tokyo procedural inter-cell gap open", () => {
    // jp-block-west's cell 0 (x=-91.33) and cell 1 (x=-70), both z=32.67,
    // leave a gap between their halves ([-99.52,-83.14] and
    // [-77.69,-62.31]); the midpoint x=-80.665 was still inside the old
    // block rect [-102,-38] x [26,66].
    const world = worldFor("tokyo-setagaya");
    const nearest = buildingClearanceAt(world.obstacles, -80.665, 32.67);
    expect(nearest.distance, `blocked by ${nearest.id}`).toBeGreaterThan(0);
  });
});
