import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import type {
  GameCanvasLesson,
  SpeedUnit as CanvasSpeedUnit,
} from "../app/game/GameCanvas";
import {
  buildingKeepOuts,
  facadeGridCells,
  isInsideKeepOut,
  keptStreetWallBuildings,
} from "../app/game/GameCanvas";
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
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
  resolveServicePointLot,
  SERVICE_LOT_HALF_M,
} from "../app/game/servicePoints";
import { repairCameraPosition } from "../app/game/cutsceneScript";
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

// Mirrors the core's player capsule: circles of this radius trail/lead the
// centre. Driving centred along a lane, the car's lateral reach is exactly
// the capsule radius.
const PLAYER_CAPSULE_RADIUS_M = 1.0;
const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
const LANE_SAMPLE_SPACING_M = 2;

const toCanvasSpeedUnit = (speedUnit: "mph" | "kmh"): CanvasSpeedUnit =>
  speedUnit === "mph" ? "mph" : "km/h";

const freeDriveLesson = (freeDrive: FreeDriveDefinition): GameCanvasLesson =>
  buildFreeDriveLesson(
    freeDrive,
    getCountryProfile(freeDrive.countryId).trafficSide,
  );

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
    lesson: freeDriveLesson(freeDrive),
    mapPack: getMapPack(freeDrive.mapId),
    trafficSide: country.trafficSide,
    speedUnit: toCanvasSpeedUnit(country.speedUnit),
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

describe("static obstacle build", () => {
  it("produces a solid world for every free-drive map", () => {
    for (const world of driveWorlds) {
      expect(world.obstacles.length).toBeGreaterThan(4);
      // The four world-edge fences are always present.
      const edges = world.obstacles.filter((o) => o.tag === "worldEdge");
      expect(edges).toHaveLength(4);
      // Every authored block stands somewhere in the set (museum blocks as
      // wings, everything else as its own rect).
      const buildings = world.obstacles.filter((o) => o.tag === "building");
      const blockCount = getMapPack(world.freeDrive.mapId).geometry.blocks
        .length;
      expect(buildings.length).toBeGreaterThanOrEqual(blockCount);
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
      const again = buildStaticObstacles(mapPack, {
        minX: -mapPack.geometry.worldSize.x / 2 - padding,
        maxX: mapPack.geometry.worldSize.x / 2 + padding,
        minZ: -mapPack.geometry.worldSize.z / 2 - padding,
        maxZ: mapPack.geometry.worldSize.z / 2 + padding,
      });
      expect(again).toEqual(world.obstacles);
    }
  });
});

describe("the drivable world stays open", () => {
  it("keeps every lane corridor clear of every solid obstacle", () => {
    const failures: string[] = [];
    for (const world of driveWorlds) {
      for (const lane of world.lanes) {
        const laneWidth = lane.width ?? 3.5;
        const required = laneWidth / 2 + PLAYER_CAPSULE_RADIUS_M - 0.05;
        const points = lane.points;
        for (let index = 0; index < points.length - 1; index += 1) {
          const start = points[index];
          const end = points[index + 1];
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          const steps = Math.max(1, Math.ceil(length / LANE_SAMPLE_SPACING_M));
          for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const x = start.x + (end.x - start.x) * t;
            const z = start.z + (end.z - start.z) * t;
            const nearest = clearanceToNearestObstacle(world.obstacles, x, z);
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
          (surface) =>
            surface.sidewalkWidthM ?? defaultSidewalkWidthM,
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
      for (const edge of graph.edges) {
        const steps = Math.max(1, Math.ceil(edge.lengthM / 1.5));
        for (let step = 0; step <= steps; step += 1) {
          const pose = samplePavementEdge(edge, (edge.lengthM * step) / steps);
          const lateralX = Math.cos(pose.headingRad);
          const lateralZ = -Math.sin(pose.headingRad);
          for (const offset of lateralOffsets) {
            const x = pose.x + lateralX * offset;
            const z = pose.z + lateralZ * offset;
            for (const obstacle of solids) {
              const distance = distanceToStaticObstacle(obstacle, x, z);
              if (distance < 0.3) {
                failures.push(
                  `${world.freeDrive.mapId}: ${obstacle.id} covers the pavement at (${x.toFixed(1)}, ${z.toFixed(1)}) — ${distance.toFixed(2)}m`,
                );
              }
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
          ).toBeGreaterThanOrEqual(1.05);
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
            reachable = nearest.distance >= 1.05;
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
        // to the widest capsule in the game (the van's 1.05 m), not the
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
          ).toBeGreaterThanOrEqual(1.05);
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

  it("never stands a street-wall building inside a service lot", () => {
    // The collider builder carves a service point's lot out of the block rect
    // it sits on, so anything the street wall draws there is a building the car
    // drives straight through. The two street-wall paths read their keep-outs
    // at very different times — the instanced glb wall after preload, the
    // procedural facade grid inline — and while the keep-outs were collected
    // as buildings were placed, only the deferred one saw them. A terrace stood
    // through London's and Tokyo's repair shops; the gas stations were spared
    // only because every one of them sits on ground no block covers.
    for (const world of driveWorlds) {
      const mapPack = getMapPack(world.freeDrive.mapId);
      const keepOuts = buildingKeepOuts(mapPack);
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
              isInsideKeepOut(
                keepOuts,
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
            keepOuts,
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
