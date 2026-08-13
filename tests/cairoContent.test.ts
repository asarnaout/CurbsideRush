import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAIRO_BACK_TO_ROAD_MARGIN_M,
  CAIRO_CONTENT_REVIEWED_ON,
  CAIRO_FREE_DRIVE,
  CAIRO_JUNCTION_CONNECTORS,
  CAIRO_MAP_PACK,
  CAIRO_ROAD_SPECS,
  CAIRO_RULE_REFERENCES,
} from "../app/game/cities/cairo";
import {
  buildingPlacementConfig,
  isBuildingSetId,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import { hashStringToSeed } from "../app/game/visuals";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationSnapshot,
} from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  buildStaticObstacles,
  distanceToStaticObstacle,
  resolveVenuePlacement,
} from "../app/game/simulationAdapter";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import type {
  LaneSegment,
  MapPack,
  RoadSurface,
  WorldPoint,
} from "../app/game/types";

/**
 * Cairo's roadside frontage, pinned so a change to the generator is a decision
 * rather than an accident. These moved when the street wall became instanced
 * glbs: shorter road segments now earn a parcel and long runs split more often,
 * because the wall no longer costs one draw call per building.
 *
 * STREET_WALL_BLOCKS + the boxes behind FACADE_BOX_CELLS are the whole split.
 * Boxes come from two sources: the deterministic one-in-six that
 * cairoParcelKeepsFacadeBoxes holds back, and parcels the back-to-road guard
 * demoted because their windowless glb back would crowd another road's
 * pavement (CAIRO_BACK_TO_ROAD_MARGIN_M). The glb wall must stay the clear
 * majority of roadside parcels — if a guard change flips that balance, that is
 * a decision for a person, not a constant to re-pin in passing.
 */
// 650 -> 656 (visual-gap plan Section 12.5, P0, Al-Galaa NE corner): six
// `cairo-galaa-ne-land-edge-wall-{1..6}` CAIRO_VISUAL_CLOSURES entries,
// closing the pocket the slot pass's own frontage fell ~10 m short of the
// whole way up Al-Galaa's east side, and stopped covering entirely past
// its diagonal segment's own end. A single 76 m block was tried first and
// rejected: `facadeGridCells` caps every block at ~9 cells regardless of
// length, so one long block left 20-37 m gaps between its few buildings.
// Six short (~18-19 m) pieces instead, each getting its own ~9-cell
// spread, tile with only ~1 m seams. None of the six have "-roadside-" in
// their id (reviewed closures, not generator output), so ROADSIDE_COUNT
// is unaffected.
// 656 -> 659 (Section 12.6, P0, Dokki South's west end): three more
// `cairo-dokki-sw-land-edge-wall-{1..3}` closures, same land-edge-wall
// treatment mirrored to the map's SW corner. The section's other three
// named ranges (both Garden City South spans, South Gezira Road) are
// systemic-only -- no blocks added for them, same as 12.4's Tahrir
// Square conclusion. Dokki's own residual (162 -> 14 `urban_world_edge`
// failures, all one close eye station's sub-2m inter-building gaps) was
// deliberately accepted rather than chased to zero -- see the closure
// array's own comment for why.
// 659 -> 664 (Section 12.7, P0, west/north land perimeter): five
// `cairo-west-nile-street-mid-land-edge-wall-{1..5}` closures fill the
// real 41 m gap between two standard-generator asset-slot blocks whose
// own real buildings stop short of each other. Ramses Approach's own
// named range needed no new blocks, only a small widen of two existing
// Al-Galaa closures' start edges (Section 12.5) -- BLOCK_COUNT unaffected
// by that. Two of the section's four named ranges are systemic-only, and
// a third apparent lead (Agouza Approach's own east end) was built then
// reverted once its failures' real distances (324-520 m) proved it was
// systemic too -- see the closure array's own comment.
const BLOCK_COUNT = 664;
const ROADSIDE_COUNT = 626;
const ROADSIDE_LEFT = 313;
/** The second rank is gone — a one-sided kit means a back row can only stare
 * at the front row's service wall or plant its own on the next street over.
 * Zero, pinned, so it cannot quietly come back. */
const ROADSIDE_RANKS = 0;
const STREET_WALL_BLOCKS = 471;
// 1590 -> 1644 (Section 12.5) -> 1671 (Section 12.6) -> 1716 (Section
// 12.7): the five cairo-west-nile-street-mid-land-edge-wall-* closures
// have no buildingSet either, same formula, 5 blocks * 9 = 45 more.
const FACADE_BOX_CELLS = 1716;

const lengthOf = (points: readonly WorldPoint[]): number =>
  points.slice(1).reduce(
    (total, current, index) =>
      total + Math.hypot(
        current.x - points[index].x,
        current.z - points[index].z,
      ),
    0,
  );

const pointInPolygon = (
  candidate: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    const crosses =
      left.z > candidate.z !== right.z > candidate.z &&
      candidate.x <
        ((right.x - left.x) * (candidate.z - left.z)) /
          (right.z - left.z) +
          left.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const reachableFrom = (
  start: LaneSegment,
  lanes: readonly LaneSegment[],
): Set<string> => {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const reached = new Set([start.id]);
  const queue = [start.id];
  while (queue.length > 0) {
    const lane = byId.get(queue.shift()!);
    if (!lane) continue;
    for (const successorId of lane.successors) {
      if (reached.has(successorId)) continue;
      reached.add(successorId);
      queue.push(successorId);
    }
  }
  return reached;
};

const pointAtFraction = (
  points: readonly WorldPoint[],
  fraction: number,
): WorldPoint => {
  const target = lengthOf(points) * fraction;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.hypot(end.x - start.x, end.z - start.z);
    if (travelled + segment >= target) {
      const amount = segment > 0 ? (target - travelled) / segment : 0;
      return point(
        start.x + (end.x - start.x) * amount,
        start.z + (end.z - start.z) * amount,
      );
    }
    travelled += segment;
  }
  return points.at(-1)!;
};

const segmentIntersection = (
  firstStart: WorldPoint,
  firstEnd: WorldPoint,
  secondStart: WorldPoint,
  secondEnd: WorldPoint,
): WorldPoint | null => {
  const firstX = firstEnd.x - firstStart.x;
  const firstZ = firstEnd.z - firstStart.z;
  const secondX = secondEnd.x - secondStart.x;
  const secondZ = secondEnd.z - secondStart.z;
  const denominator = firstX * secondZ - firstZ * secondX;
  if (Math.abs(denominator) < 1e-8) return null;
  const offsetX = secondStart.x - firstStart.x;
  const offsetZ = secondStart.z - firstStart.z;
  const firstT =
    (offsetX * secondZ - offsetZ * secondX) / denominator;
  const secondT = (offsetX * firstZ - offsetZ * firstX) / denominator;
  if (firstT < 0 || firstT > 1 || secondT < 0 || secondT > 1) {
    return null;
  }
  return point(
    firstStart.x + firstX * firstT,
    firstStart.z + firstZ * firstT,
  );
};

const boundsFor = (mapPack: MapPack) => {
  const padding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
  return {
    minX: -mapPack.geometry.worldSize.x / 2 - padding,
    maxX: mapPack.geometry.worldSize.x / 2 + padding,
    minZ: -mapPack.geometry.worldSize.z / 2 - padding,
    maxZ: mapPack.geometry.worldSize.z / 2 + padding,
  };
};

const nearestShorelineDistance = (
  obstacles: ReturnType<typeof buildStaticObstacles>,
  candidate: WorldPoint,
): number =>
  Math.min(
    ...obstacles
      .filter((obstacle) => obstacle.tag === "shoreline")
      .map((obstacle) =>
        distanceToStaticObstacle(obstacle, candidate.x, candidate.z),
      ),
  );

const mixHash = (hash: number, value: number): number =>
  Math.imul(hash ^ (value | 0), 16_777_619) >>> 0;

const mixString = (hash: number, value: string): number => {
  let result = hash;
  for (let index = 0; index < value.length; index += 1) {
    result = mixHash(result, value.charCodeAt(index));
  }
  return result;
};

const traceSnapshot = (
  startingHash: number,
  snapshot: SimulationSnapshot,
): number => {
  let hash = mixHash(startingHash, snapshot.tick);
  hash = mixHash(hash, snapshot.queuedNpcCount);
  hash = mixString(hash, snapshot.status);
  for (const npc of snapshot.npcs) {
    hash = mixString(hash, npc.id);
    hash = mixString(hash, npc.laneId);
    hash = mixHash(hash, Math.round(npc.x * 10_000));
    hash = mixHash(hash, Math.round(npc.z * 10_000));
    hash = mixHash(hash, Math.round(npc.speedMps * 10_000));
  }
  return hash;
};

const nearestSegmentHeadingDeg = (
  points: readonly WorldPoint[],
  candidate: WorldPoint,
): number => {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestHeading = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((candidate.x - start.x) * dx +
                (candidate.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    const distance = Math.hypot(candidate.x - x, candidate.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHeading = (Math.atan2(dx, dz) * 180) / Math.PI;
    }
  }
  return bestHeading;
};

const headingDifferenceDeg = (left: number, right: number): number =>
  Math.abs((((left - right + 180) % 360) + 360) % 360 - 180);

const nearestPointOnPath = (
  points: readonly WorldPoint[],
  candidate: WorldPoint,
): WorldPoint => {
  let best = points[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((candidate.x - start.x) * dx +
                (candidate.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const projected = point(start.x + dx * amount, start.z + dz * amount);
    const distance = Math.hypot(
      candidate.x - projected.x,
      candidate.z - projected.z,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = projected;
    }
  }
  return best;
};

const pointAtDistance = (
  points: readonly WorldPoint[],
  distanceAlongM: number,
): WorldPoint =>
  pointAtFraction(
    points,
    Math.max(0, Math.min(1, distanceAlongM / lengthOf(points))),
  );

interface TestOrientedRect {
  readonly center: WorldPoint;
  readonly axisU: WorldPoint;
  readonly axisV: WorldPoint;
  readonly halfU: number;
  readonly halfV: number;
}

const testOrientedRect = (
  center: WorldPoint,
  size: WorldPoint,
  yawDeg: number,
): TestOrientedRect => {
  const yaw = (yawDeg * Math.PI) / 180;
  return {
    center,
    axisU: point(Math.cos(yaw), -Math.sin(yaw)),
    axisV: point(Math.sin(yaw), Math.cos(yaw)),
    halfU: size.x / 2,
    halfV: size.z / 2,
  };
};

const testOrientedRectCorners = (
  rectangle: TestOrientedRect,
): readonly WorldPoint[] => {
  const at = (u: -1 | 1, v: -1 | 1): WorldPoint =>
    point(
      rectangle.center.x +
        rectangle.axisU.x * rectangle.halfU * u +
        rectangle.axisV.x * rectangle.halfV * v,
      rectangle.center.z +
        rectangle.axisU.z * rectangle.halfU * u +
        rectangle.axisV.z * rectangle.halfV * v,
    );
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
};

const testPointInOrientedRect = (
  candidate: WorldPoint,
  rectangle: TestOrientedRect,
): boolean => {
  const dx = candidate.x - rectangle.center.x;
  const dz = candidate.z - rectangle.center.z;
  return (
    Math.abs(dx * rectangle.axisU.x + dz * rectangle.axisU.z) <=
      rectangle.halfU + 1e-7 &&
    Math.abs(dx * rectangle.axisV.x + dz * rectangle.axisV.z) <=
      rectangle.halfV + 1e-7
  );
};

const testSegmentsIntersect = (
  firstStart: WorldPoint,
  firstEnd: WorldPoint,
  secondStart: WorldPoint,
  secondEnd: WorldPoint,
): boolean => {
  const cross = (
    start: WorldPoint,
    end: WorldPoint,
    candidate: WorldPoint,
  ): number =>
    (end.x - start.x) * (candidate.z - start.z) -
    (end.z - start.z) * (candidate.x - start.x);
  const onSegment = (
    start: WorldPoint,
    end: WorldPoint,
    candidate: WorldPoint,
  ): boolean =>
    candidate.x >= Math.min(start.x, end.x) - 1e-7 &&
    candidate.x <= Math.max(start.x, end.x) + 1e-7 &&
    candidate.z >= Math.min(start.z, end.z) - 1e-7 &&
    candidate.z <= Math.max(start.z, end.z) + 1e-7;
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  if (
    ((firstA > 1e-7 && firstB < -1e-7) ||
      (firstA < -1e-7 && firstB > 1e-7)) &&
    ((secondA > 1e-7 && secondB < -1e-7) ||
      (secondA < -1e-7 && secondB > 1e-7))
  ) {
    return true;
  }
  return (
    (Math.abs(firstA) <= 1e-7 &&
      onSegment(firstStart, firstEnd, secondStart)) ||
    (Math.abs(firstB) <= 1e-7 &&
      onSegment(firstStart, firstEnd, secondEnd)) ||
    (Math.abs(secondA) <= 1e-7 &&
      onSegment(secondStart, secondEnd, firstStart)) ||
    (Math.abs(secondB) <= 1e-7 &&
      onSegment(secondStart, secondEnd, firstEnd))
  );
};

const testOrientedRectIntersectsPolygon = (
  rectangle: TestOrientedRect,
  polygon: readonly WorldPoint[],
): boolean => {
  const corners = testOrientedRectCorners(rectangle);
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((vertex) => testPointInOrientedRect(vertex, rectangle))) {
    return true;
  }
  for (let edge = 0; edge < corners.length; edge += 1) {
    for (let polygonEdge = 0; polygonEdge < polygon.length; polygonEdge += 1) {
      if (
        testSegmentsIntersect(
          corners[edge],
          corners[(edge + 1) % corners.length],
          polygon[polygonEdge],
          polygon[(polygonEdge + 1) % polygon.length],
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const testOrientedRectsOverlap = (
  first: TestOrientedRect,
  second: TestOrientedRect,
): boolean => {
  const dot = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.x + left.z * right.z;
  const offset = point(
    second.center.x - first.center.x,
    second.center.z - first.center.z,
  );
  return [first.axisU, first.axisV, second.axisU, second.axisV].every(
    (axis) => {
      const separation = Math.abs(dot(offset, axis));
      const firstRadius =
        first.halfU * Math.abs(dot(first.axisU, axis)) +
        first.halfV * Math.abs(dot(first.axisV, axis));
      const secondRadius =
        second.halfU * Math.abs(dot(second.axisU, axis)) +
        second.halfV * Math.abs(dot(second.axisV, axis));
      return separation <= firstRadius + secondRadius;
    },
  );
};

describe("Cairo Central Nile content", () => {
  it("uses official Egyptian rule sources and OSM only for geography", () => {
    expect(CAIRO_CONTENT_REVIEWED_ON).toBe("2026-07-28");
    expect(CAIRO_RULE_REFERENCES.length).toBeGreaterThanOrEqual(3);
    for (const reference of CAIRO_RULE_REFERENCES) {
      expect(new URL(reference.url).hostname).toBe("traffic.moi.gov.eg");
      expect(reference.reviewedOn).toBe(CAIRO_CONTENT_REVIEWED_ON);
    }
    expect(new URL(CAIRO_MAP_PACK.source.sourceUrl).hostname).toBe(
      "api.openstreetmap.org",
    );
    expect(CAIRO_MAP_PACK.source.boundingBox).toEqual({
      south: 30.0305,
      west: 31.2105,
      north: 30.0565,
      east: 31.2395,
    });
  });

  it("matches NYC-scale scope without turning Cairo into a cardinal grid", () => {
    expect(CAIRO_MAP_PACK.geometry.worldSize).toEqual({ x: 1770, z: 1830 });
    expect(CAIRO_ROAD_SPECS.length).toBeGreaterThanOrEqual(22);
    expect(CAIRO_ROAD_SPECS.length).toBeLessThanOrEqual(28);
    expect(CAIRO_MAP_PACK.geometry.roadSurfaces).toHaveLength(
      CAIRO_ROAD_SPECS.length,
    );

    const roadKm =
      CAIRO_MAP_PACK.geometry.roadSurfaces.reduce(
        (total, surface) => total + lengthOf(surface.centerline),
        0,
      ) / 1000;
    const laneKm =
      CAIRO_MAP_PACK.laneGraph.lanes.reduce(
        (total, lane) => total + lengthOf(lane.centerline),
        0,
      ) / 1000;
    expect(roadKm).toBeGreaterThanOrEqual(23);
    expect(roadKm).toBeLessThanOrEqual(28);
    expect(CAIRO_MAP_PACK.laneGraph.lanes.length).toBeGreaterThanOrEqual(180);
    expect(CAIRO_MAP_PACK.laneGraph.lanes.length).toBeLessThanOrEqual(230);
    expect(laneKm).toBeGreaterThanOrEqual(42);
    expect(laneKm).toBeLessThanOrEqual(50);

    const segmentAngles = CAIRO_MAP_PACK.geometry.roadSurfaces.flatMap(
      (surface) =>
        surface.centerline.slice(1).map((current, index) => {
          const previous = surface.centerline[index];
          const angle =
            Math.abs(
              (Math.atan2(
                current.z - previous.z,
                current.x - previous.x,
              ) *
                180) /
                Math.PI,
            ) % 90;
          return Math.min(angle, 90 - angle);
        }),
    );
    expect(
      segmentAngles.filter((angle) => angle > 10).length /
        segmentAngles.length,
    ).toBeGreaterThanOrEqual(0.3);
  });

  it("pins the authored road order, lane counts and synchronized surfaces", () => {
    expect(CAIRO_ROAD_SPECS.map((road) => road.id)).toEqual([
      "cairo-corniche-el-nil",
      "cairo-qasr-el-ainy",
      "cairo-simon-bolivar",
      "cairo-talaat-harb",
      "cairo-ramses",
      "cairo-galaa-street",
      "cairo-garden-city-south",
      "cairo-abdel-qader-hamza",
      "cairo-tahrir-approach",
      "cairo-qasr-el-nil-street",
      "cairo-champollion",
      "cairo-ramses-approach",
      "cairo-saray-el-gezira",
      "cairo-el-gabalaya",
      "cairo-opera-corridor",
      "cairo-nile-island-drive",
      "cairo-south-gezira-road",
      "cairo-zamalek-south",
      "cairo-opera-square",
      "cairo-zamalek-north",
      "cairo-qasr-el-nil-bridge",
      "cairo-al-galaa-bridge",
      "cairo-west-nile-street",
      "cairo-dokki-nile-drive",
      "cairo-dokki-south",
      "cairo-dokki-midtown",
      "cairo-agouza-approach",
    ]);

    for (const road of CAIRO_ROAD_SPECS) {
      const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
        (candidate) => candidate.id === road.id,
      );
      const lanes = CAIRO_MAP_PACK.laneGraph.lanes.filter(
        (lane) => lane.roadId === road.id,
      );
      expect(surface, road.id).toBeDefined();
      expect(surface!.centerline, road.id).toEqual(
        road.nodeIds.map(
          (nodeId) =>
            CAIRO_MAP_PACK.laneGraph.nodes.find((node) => node.id === nodeId)!
              .position,
        ),
      );
      expect(lanes, road.id).toHaveLength(
        (road.nodeIds.length - 1) * road.laneCount,
      );
      expect(surface!.laneIds, road.id).toEqual(lanes.map((lane) => lane.id));
      expect(surface!.widthM, road.id).toBe(road.widthM);
      expect(surface!.sidewalkWidthM, road.id).toBe(road.sidewalkWidthM);
    }
  });

  it("derives a strongly connected right-hand lane graph from the roads", () => {
    const graph = CAIRO_MAP_PACK.laneGraph;
    const lanes = new Map(graph.lanes.map((lane) => [lane.id, lane]));
    const surfaces = new Map(
      CAIRO_MAP_PACK.geometry.roadSurfaces.map((surface) => [
        surface.id,
        surface,
      ]),
    );

    for (const start of graph.lanes) {
      expect(
        reachableFrom(start, graph.lanes).size,
        `${start.id} cannot reach the complete directed graph`,
      ).toBe(graph.lanes.length);
    }
    const predecessors = new Set(graph.lanes.flatMap((lane) => lane.successors));
    for (const lane of graph.lanes) {
      expect(lane.trafficSide, lane.id).toBe("right");
      expect([40, 60], lane.id).toContain(lane.speedLimit);
      expect(lane.localSpeedUnit, lane.id).toBe("kmh");
      expect(predecessors.has(lane.id), `${lane.id} has no predecessor`).toBe(
        true,
      );
      expect(surfaces.get(lane.roadId)?.laneIds, lane.id).toContain(lane.id);
      for (const successorId of lane.successors) {
        const successor = lanes.get(successorId);
        expect(successor, `${lane.id} → ${successorId}`).toBeDefined();
        expect(
          Math.hypot(
            lane.centerline.at(-1)!.x - successor!.centerline[0].x,
            lane.centerline.at(-1)!.z - successor!.centerline[0].z,
          ),
          `${lane.id} → ${successorId}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it("allows cross-road turns only through the explicit connector table", () => {
    const roadById = new Map(CAIRO_ROAD_SPECS.map((road) => [road.id, road]));
    const laneById = new Map(
      CAIRO_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );
    const connectorIds = new Set<string>();
    const connectorByNodeAndRoad = new Map<
      string,
      ReadonlySet<string>
    >();

    for (const connector of CAIRO_JUNCTION_CONNECTORS) {
      expect(connectorIds.has(connector.id), connector.id).toBe(false);
      connectorIds.add(connector.id);
      expect(
        CAIRO_MAP_PACK.laneGraph.nodes.some(
          (node) => node.id === connector.nodeId,
        ),
        connector.id,
      ).toBe(true);
      for (const movement of connector.movements) {
        expect(roadById.has(movement.fromRoadId), connector.id).toBe(true);
        expect(
          roadById.get(movement.fromRoadId)!.nodeIds,
          connector.id,
        ).toContain(connector.nodeId);
        expect(new Set(movement.toRoadIds).size, connector.id).toBe(
          movement.toRoadIds.length,
        );
        connectorByNodeAndRoad.set(
          `${connector.nodeId}:${movement.fromRoadId}`,
          new Set(movement.toRoadIds),
        );
      }
    }

    for (const lane of CAIRO_MAP_PACK.laneGraph.lanes) {
      expect(new Set(lane.successors).size, lane.id).toBe(
        lane.successors.length,
      );
      for (const successorId of lane.successors) {
        const successor = laneById.get(successorId)!;
        expect(
          !(
            successor.roadId === lane.roadId &&
            successor.from === lane.to &&
            successor.to === lane.from
          ),
          `${lane.id} makes an implicit U-turn to ${successorId}`,
        ).toBe(true);
        if (successor.roadId === lane.roadId) continue;
        expect(
          connectorByNodeAndRoad
            .get(`${lane.to}:${lane.roadId}`)
            ?.has(successor.roadId),
          `${lane.id} → ${successorId} lacks an explicit movement`,
        ).toBe(true);
      }
    }
  });

  it("places every two-way lane on its right-hand side of the road", () => {
    const nodeById = new Map(
      CAIRO_MAP_PACK.laneGraph.nodes.map((node) => [node.id, node]),
    );
    const laneById = new Map(
      CAIRO_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );

    for (const road of CAIRO_ROAD_SPECS) {
      if (road.oneWay) continue;
      const lanesPerDirection = road.laneCount / 2;
      for (
        let segmentIndex = 0;
        segmentIndex + 1 < road.nodeIds.length;
        segmentIndex += 1
      ) {
        const start = nodeById.get(road.nodeIds[segmentIndex])!.position;
        const end = nodeById.get(road.nodeIds[segmentIndex + 1])!.position;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const segmentLength = Math.hypot(dx, dz);
        const right = { x: dz / segmentLength, z: -dx / segmentLength };
        const roadMidpoint = point(
          (start.x + end.x) / 2,
          (start.z + end.z) / 2,
        );
        const forwardOffsets: number[] = [];
        const reverseOffsets: number[] = [];

        for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
          const suffix = `${segmentIndex + 1}-forward-${laneIndex + 1}`;
          const reverseSuffix = `${segmentIndex + 1}-reverse-${laneIndex + 1}`;
          const forward = laneById.get(`${road.id}-${suffix}`)!;
          const reverse = laneById.get(`${road.id}-${reverseSuffix}`)!;
          const forwardMidpoint = pointAtFraction(forward.centerline, 0.5);
          const reverseMidpoint = pointAtFraction(reverse.centerline, 0.5);
          forwardOffsets.push(
            (forwardMidpoint.x - roadMidpoint.x) * right.x +
              (forwardMidpoint.z - roadMidpoint.z) * right.z,
          );
          reverseOffsets.push(
            (reverseMidpoint.x - roadMidpoint.x) * right.x +
              (reverseMidpoint.z - roadMidpoint.z) * right.z,
          );
        }

        expect(forwardOffsets[0], `${road.id}:${segmentIndex}:forward`).toBeGreaterThan(
          0.5,
        );
        expect(reverseOffsets[0], `${road.id}:${segmentIndex}:reverse`).toBeLessThan(
          -0.5,
        );
        for (let laneIndex = 1; laneIndex < lanesPerDirection; laneIndex += 1) {
          expect(forwardOffsets[laneIndex], road.id).toBeGreaterThan(
            forwardOffsets[laneIndex - 1],
          );
          expect(reverseOffsets[laneIndex], road.id).toBeLessThan(
            reverseOffsets[laneIndex - 1],
          );
        }
      }
    }
  });

  it("keeps ordinary streets off the Nile and makes both bridge routes drivable", () => {
    const water = CAIRO_MAP_PACK.geometry.waterBodies ?? [];
    expect(water.map((body) => body.id)).toEqual([
      "cairo-nile-west-channel",
      "cairo-nile-east-channel",
    ]);
    for (const body of water) {
      expect(body.polygon.length).toBeGreaterThanOrEqual(12);
    }

    const bridgeRoads = new Set([
      "cairo-qasr-el-nil-bridge",
      "cairo-al-galaa-bridge",
    ]);
    const expectedChannelByBridge = new Map([
      ["cairo-qasr-el-nil-bridge", "cairo-nile-east-channel"],
      ["cairo-al-galaa-bridge", "cairo-nile-west-channel"],
    ]);
    for (const bridgeId of bridgeRoads) {
      const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
        (candidate) => candidate.id === bridgeId,
      );
      expect(surface, bridgeId).toBeDefined();
      expect(surface!.laneIds.length, bridgeId).toBeGreaterThan(0);
      const crossedChannels = new Set(
        surface!.centerline.slice(1).flatMap((candidate, index) => {
          const previous = surface!.centerline[index];
          const midpoint = point(
            (previous.x + candidate.x) / 2,
            (previous.z + candidate.z) / 2,
          );
          return water
            .filter((body) => pointInPolygon(midpoint, body.polygon))
            .map((body) => body.id);
        }),
      );
      expect([...crossedChannels], bridgeId).toEqual([
        expectedChannelByBridge.get(bridgeId),
      ]);
    }

    for (const surface of CAIRO_MAP_PACK.geometry.roadSurfaces) {
      if (bridgeRoads.has(surface.id)) continue;
      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const midpoint = point(
          (start.x + end.x) / 2,
          (start.z + end.z) / 2,
        );
        expect(
          water.some((body) => pointInPolygon(midpoint, body.polygon)),
          `${surface.id} crosses water`,
        ).toBe(false);
      }
    }
  });

  it("cuts shoreline only through whitelisted portals and seals bridge sides", () => {
    const waterBodies = CAIRO_MAP_PACK.geometry.waterBodies ?? [];
    expect(
      waterBodies.map((water) => [
        water.id,
        water.bridgePortalSurfaceIds,
      ]),
    ).toEqual([
      ["cairo-nile-west-channel", ["cairo-al-galaa-bridge"]],
      ["cairo-nile-east-channel", ["cairo-qasr-el-nil-bridge"]],
    ]);
    expect(
      waterBodies.flatMap((water) => water.bridgePortalSurfaceIds ?? []),
    ).not.toContain("cairo-sixth-october-bridge");

    // Water bodies are the only thing this test varies; the building plan
    // reads none of them, so both variants share one plan instance.
    const buildingLayout = planMapBuildings(
      CAIRO_MAP_PACK,
      hashStringToSeed(CAIRO_MAP_PACK.id),
    );
    const openObstacles = buildStaticObstacles({
      mapPack: CAIRO_MAP_PACK,
      bounds: boundsFor(CAIRO_MAP_PACK),
      buildingLayout,
    });
    const closedMap: MapPack = {
      ...CAIRO_MAP_PACK,
      geometry: {
        ...CAIRO_MAP_PACK.geometry,
        waterBodies: waterBodies.map((water) => ({
          ...water,
          bridgePortalSurfaceIds: [],
        })),
      },
    };
    const closedObstacles = buildStaticObstacles({
      mapPack: closedMap,
      bounds: boundsFor(closedMap),
      buildingLayout,
    });

    for (const water of waterBodies) {
      const bridgeId = water.bridgePortalSurfaceIds![0];
      const bridge: RoadSurface =
        CAIRO_MAP_PACK.geometry.roadSurfaces.find(
          (surface) => surface.id === bridgeId,
        )!;
      const crossings: WorldPoint[] = [];
      for (let edgeIndex = 0; edgeIndex < water.polygon.length; edgeIndex += 1) {
        for (
          let roadIndex = 1;
          roadIndex < bridge.centerline.length;
          roadIndex += 1
        ) {
          const crossing = segmentIntersection(
            water.polygon[edgeIndex],
            water.polygon[(edgeIndex + 1) % water.polygon.length],
            bridge.centerline[roadIndex - 1],
            bridge.centerline[roadIndex],
          );
          if (crossing) crossings.push(crossing);
        }
      }
      expect(crossings, bridgeId).toHaveLength(2);
      for (const crossing of crossings) {
        expect(
          nearestShorelineDistance(openObstacles, crossing),
          `${bridgeId} portal remained blocked`,
        ).toBeGreaterThan(bridge.widthM / 2);
        expect(
          nearestShorelineDistance(closedObstacles, crossing),
          `${bridgeId} opened without its whitelist`,
        ).toBe(0);
      }

      const parapets = openObstacles.filter((obstacle) =>
        obstacle.id.startsWith(`${water.id}-portal-${bridgeId}-`),
      );
      expect(parapets, bridgeId).toHaveLength(2);
      const start = bridge.centerline[0];
      const end = bridge.centerline[1];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const ux = (end.x - start.x) / length;
      const uz = (end.z - start.z) / length;
      const right = { x: uz, z: -ux };
      const expectedLateral =
        bridge.widthM / 2 + bridge.sidewalkWidthM! + 0.4;
      for (const parapet of parapets) {
        expect(parapet.kind, parapet.id).toBe("obb");
        if (parapet.kind !== "obb") continue;
        expect(
          Math.abs(parapet.ux * ux + parapet.uz * uz),
          parapet.id,
        ).toBeGreaterThan(0.9999);
        const lateral =
          (parapet.x - start.x) * right.x +
          (parapet.z - start.z) * right.z;
        expect(Math.abs(lateral), parapet.id).toBeCloseTo(
          expectedLateral,
          6,
        );
        expect(
          distanceToStaticObstacle(parapet, parapet.x, parapet.z),
          parapet.id,
        ).toBe(0);
      }
    }

    // Regression: Al-Galaa's outer reverse lane reaches the polygon corner at
    // z≈330 even though the centreline intersects the preceding edge. The full
    // road + pavement portal envelope must cut both adjacent shoreline edges.
    expect(
      nearestShorelineDistance(openObstacles, point(-474, 329.9)),
    ).toBeGreaterThan(2.55);
  });

  it("ships the complete gameplay distribution and Cairo signal style", () => {
    const graph = CAIRO_MAP_PACK.laneGraph;
    expect(
      graph.spawnPoints.filter((spawn) => spawn.kind === "player"),
    ).toHaveLength(3);
    expect(
      graph.spawnPoints.filter((spawn) => spawn.kind === "vehicle").length,
    ).toBeGreaterThanOrEqual(28);
    expect(
      graph.spawnPoints.filter((spawn) => spawn.kind === "vehicle").length,
    ).toBeLessThanOrEqual(32);
    // Three dedicated patrol gates: Cairo's visible police presence must not
    // hang on the ambient patrol roll landing on a car-capable gate.
    expect(
      graph.spawnPoints.filter((spawn) => spawn.id.includes("cairo-police-")),
    ).toHaveLength(3);
    expect(CAIRO_MAP_PACK.geometry.gigVenues).toHaveLength(30);
    expect(
      CAIRO_MAP_PACK.geometry.servicePoints?.filter(
        (service) => service.kind === "gas_station",
      ),
    ).toHaveLength(2);
    expect(
      CAIRO_MAP_PACK.geometry.servicePoints?.filter(
        (service) => service.kind === "repair_shop",
      ),
    ).toHaveLength(2);
    expect(CAIRO_MAP_PACK.ambientTraffic).toEqual({
      desktop: 32,
      touch: 16,
    });

    const signals = graph.controls.filter((control) => control.type === "signal");
    expect(signals.length).toBeGreaterThanOrEqual(8);
    for (const signal of signals) {
      expect(signal.approaches.length).toBeGreaterThanOrEqual(2);
      expect(
        signal.installations.filter(
          (installation) => installation.style === "egypt_signal",
        ).length,
      ).toBeGreaterThanOrEqual(2);
      const crosswalks = signal.installations.filter(
        (installation) => installation.style === "crosswalk",
      );
      // An arm whose crossing cannot clear the junction's other carriageways
      // is deliberately unmarked, so crossings may number fewer than
      // approaches — but never more, never doubled up, and most arms keep one.
      expect(crosswalks.length, signal.id).toBeLessThanOrEqual(
        signal.approaches.length,
      );
      expect(crosswalks.length, signal.id).toBeGreaterThanOrEqual(
        signal.approaches.length - 1,
      );
      for (const crosswalk of crosswalks) {
        expect(crosswalk.approachIds, crosswalk.id).toHaveLength(1);
        const approach = signal.approaches.find(
          (candidate) => candidate.id === crosswalk.approachIds![0],
        )!;
        expect(approach, crosswalk.id).toBeDefined();
        expect(
          crosswalks.filter((other) =>
            other.approachIds?.includes(approach.id),
          ),
          approach.id,
        ).toHaveLength(1);
        const lane = graph.lanes.find(
          (candidate) => candidate.id === approach.laneIds[0],
        )!;
        const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
          (candidate) => candidate.id === lane.roadId,
        )!;
        expect(crosswalk.spanM, approach.id).toBe(surface.widthM);
        expect(
          headingDifferenceDeg(
            crosswalk.headingDeg,
            nearestSegmentHeadingDeg(
              lane.centerline,
              crosswalk.position,
            ),
          ),
          approach.id,
        ).toBeLessThan(2);
      }
    }
  });

  it("stands every signal head on its own approach's kerb, beside the bar", () => {
    const graph = CAIRO_MAP_PACK.laneGraph;
    const laneById = new Map(graph.lanes.map((lane) => [lane.id, lane]));
    const signals = graph.controls.filter(
      (control) => control.type === "signal",
    );
    expect(signals.length).toBeGreaterThanOrEqual(8);

    for (const signal of signals) {
      const heads = signal.installations.filter(
        (installation) => installation.role === "primary",
      );
      // One head and one bar per arm. Merging the two directions of a two-way
      // street leaves the opposing driver enforced against a signal that was
      // never built facing them.
      expect(heads, signal.id).toHaveLength(signal.approaches.length);
      expect(
        [...signal.approaches.flatMap((approach) => approach.laneIds)].sort(),
        signal.id,
      ).toEqual([...signal.laneIds].sort());

      for (const approach of signal.approaches) {
        const head = heads.filter((installation) =>
          installation.approachIds?.includes(approach.id),
        );
        expect(head, approach.id).toHaveLength(1);

        const lane = laneById.get(approach.stopLine.laneId)!;
        expect(approach.laneIds, approach.id).toContain(lane.id);
        // An arm is one direction of travel: every lane sharing a bar has to
        // arrive from the same node, or the bar sits on the wrong carriageway.
        for (const laneId of approach.laneIds) {
          expect(laneById.get(laneId)!.from, approach.id).toBe(lane.from);
        }

        const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
          (candidate) => candidate.id === lane.roadId,
        )!;
        const bar = pointAtDistance(
          lane.centerline,
          approach.stopLine.distanceAlongM,
        );
        const headingRad = (head[0].headingDeg * Math.PI) / 180;
        const origin = nearestPointOnPath(
          surface.centerline,
          head[0].position,
        );
        const lateral =
          (head[0].position.x - origin.x) * Math.cos(headingRad) +
          (head[0].position.z - origin.z) * -Math.sin(headingRad);
        const along =
          (head[0].position.x - bar.x) * Math.sin(headingRad) +
          (head[0].position.z - bar.z) * Math.cos(headingRad);

        // Right-hand traffic: on the driver's own kerb, just past the kerb
        // face. A positive-and-small offset is the whole invariant — scoring
        // candidates by open space instead put these 13-24 m out in the plaza,
        // most of them across the carriageway.
        expect(lateral - surface.widthM / 2, head[0].id).toBeCloseTo(1.1, 5);
        // Beside or just behind the bar, never past it, and never so far back
        // that a car stopped at the line has it over its shoulder.
        expect(along, head[0].id).toBeLessThanOrEqual(0);
        expect(along, head[0].id).toBeGreaterThan(-13);
        // And never standing in a carriageway.
        const clearance = Math.min(
          ...graph.lanes.map((candidate) => {
            const nearest = nearestPointOnPath(
              candidate.centerline,
              head[0].position,
            );
            return (
              Math.hypot(
                head[0].position.x - nearest.x,
                head[0].position.z - nearest.z,
              ) -
              candidate.widthM / 2
            );
          }),
        );
        expect(clearance, head[0].id).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("alternates the two Cairo-only residence models at stable venues", () => {
    expect(
      (CAIRO_MAP_PACK.geometry.gigVenues ?? [])
        .filter((venue) => venue.kind === "residence")
        .map((venue) => [venue.id, venue.modelId]),
    ).toEqual([
      ["cairo-venue-03", "cairo-residence-kay"],
      ["cairo-venue-08", "cairo-residence-quaternius"],
      ["cairo-venue-13", "cairo-residence-kay"],
      ["cairo-venue-18", "cairo-residence-quaternius"],
      ["cairo-venue-23", "cairo-residence-kay"],
      ["cairo-venue-28", "cairo-residence-quaternius"],
    ]);
  });

  it("keeps all starts, venues and services on mutually reachable lanes", () => {
    const lanes = CAIRO_MAP_PACK.laneGraph.lanes;
    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    const playerStarts = CAIRO_MAP_PACK.laneGraph.spawnPoints.filter(
      (spawn) => spawn.kind === "player",
    );
    const destinationLaneIds = [
      ...(CAIRO_MAP_PACK.geometry.gigVenues ?? []).map(
        (venue) => venue.anchor.laneId,
      ),
      ...(CAIRO_MAP_PACK.geometry.servicePoints ?? []).map(
        (service) => service.anchor.laneId,
      ),
    ];
    expect(playerStarts).toHaveLength(3);
    expect(destinationLaneIds).toHaveLength(34);

    for (const laneId of destinationLaneIds) {
      expect(laneById.has(laneId), laneId).toBe(true);
    }
    for (const start of playerStarts) {
      expect("anchor" in start, start.id).toBe(true);
      if (!("anchor" in start)) continue;
      const startLane = laneById.get(start.anchor.laneId)!;
      const reachable = reachableFrom(startLane, lanes);
      for (const laneId of destinationLaneIds) {
        expect(
          reachable.has(laneId),
          `${start.id} cannot reach ${laneId}`,
        ).toBe(true);
      }
    }
  });

  it("uses variable sidewalks, rotated blocks and stable Cairo landmarks", () => {
    const sidewalks = new Set(
      CAIRO_MAP_PACK.geometry.roadSurfaces.map(
        (surface) => surface.sidewalkWidthM,
      ),
    );
    expect(sidewalks.has(3.4)).toBe(true);
    expect([...sidewalks].some((width) => width !== undefined && width < 3)).toBe(
      true,
    );
    expect(
      CAIRO_MAP_PACK.geometry.blocks.filter(
        (block) => Math.abs(block.headingDeg ?? 0) > 2,
      ).length,
    ).toBeGreaterThan(20);
    expect(
      new Set(CAIRO_MAP_PACK.geometry.landmarks.map((landmark) => landmark.id)),
    ).toEqual(
      new Set([
        "cairo-tower",
        "cairo-egyptian-museum",
        "cairo-tahrir-obelisk",
        "cairo-tahrir-ministries",
        "cairo-opera-house",
        "cairo-qasr-el-nil-bridge",
        "cairo-al-galaa-bridge",
        "cairo-sixth-october-bridge",
        "cairo-sixth-october-west-ramp-stub",
        "cairo-sixth-october-east-ramp-stub",
        "cairo-tahrir-square",
        "cairo-opera-grounds",
      ]),
    );
    const sixthOctober = CAIRO_MAP_PACK.geometry.landmarks.filter((landmark) =>
      landmark.id.startsWith("cairo-sixth-october-"),
    );
    expect(sixthOctober).toMatchObject([
      {
        id: "cairo-sixth-october-bridge",
        kind: "bridge",
        size: { x: 1500, z: 14 },
        headingDeg: 96,
      },
      {
        id: "cairo-sixth-october-west-ramp-stub",
        kind: "bridge",
        size: { x: 150, z: 12 },
        headingDeg: 96,
      },
      {
        id: "cairo-sixth-october-east-ramp-stub",
        kind: "bridge",
        size: { x: 150, z: 12 },
        headingDeg: 96,
      },
    ]);
  });

  // The glb kit fronts one face only, so a parcel's far edge is a windowless
  // service back. This is the assertion that was missing when those backs
  // shipped standing on neighbouring roads' kerbs: every glb parcel's back
  // edge keeps CAIRO_BACK_TO_ROAD_MARGIN_M beyond every road's pavement
  // envelope. Derived from the map data alone (own axes, nearest own road), so
  // it verifies the generator rather than repeating it.
  it("keeps every glb parcel's windowless back clear of other roads", () => {
    const blocks = CAIRO_MAP_PACK.geometry.blocks;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces;
    const glbRoadside = blocks.filter(
      (block) => block.buildingSet && block.id.includes("-roadside-"),
    );
    expect(glbRoadside.length).toBeGreaterThan(150);

    const pointToSegment = (
      p: WorldPoint,
      a: WorldPoint,
      b: WorldPoint,
    ): number => {
      const abX = b.x - a.x;
      const abZ = b.z - a.z;
      const lengthSq = abX * abX + abZ * abZ;
      const t = lengthSq
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * abX + (p.z - a.z) * abZ) / lengthSq),
          )
        : 0;
      return Math.hypot(p.x - (a.x + abX * t), p.z - (a.z + abZ * t));
    };
    const segmentToSegment = (
      a1: WorldPoint,
      a2: WorldPoint,
      b1: WorldPoint,
      b2: WorldPoint,
    ): number => {
      const cross = (o: WorldPoint, p: WorldPoint, q: WorldPoint): number =>
        (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
      const d1 = cross(b1, b2, a1);
      const d2 = cross(b1, b2, a2);
      const d3 = cross(a1, a2, b1);
      const d4 = cross(a1, a2, b2);
      if (
        ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
      ) {
        return 0;
      }
      return Math.min(
        pointToSegment(a1, b1, b2),
        pointToSegment(a2, b1, b2),
        pointToSegment(b1, a1, a2),
        pointToSegment(b2, a1, a2),
      );
    };
    const distanceToRoad = (p: WorldPoint, surface: RoadSurface): number =>
      Math.min(
        ...surface.centerline
          .slice(1)
          .map((end, index) =>
            pointToSegment(p, surface.centerline[index], end),
          ),
      );

    for (const block of glbRoadside) {
      const sourceRoad = surfaces.find((surface) =>
        block.id.startsWith(`${surface.id}-roadside-`),
      );
      expect(sourceRoad, block.id).toBeDefined();
      if (!sourceRoad) continue;
      const rect = testOrientedRect(
        block.center,
        block.size,
        block.headingDeg ?? 0,
      );
      const edgeMid = (sign: 1 | -1): WorldPoint =>
        point(
          block.center.x + rect.axisV.x * rect.halfV * sign,
          block.center.z + rect.axisV.z * rect.halfV * sign,
        );
      const backSign =
        distanceToRoad(edgeMid(1), sourceRoad) >
        distanceToRoad(edgeMid(-1), sourceRoad)
          ? 1
          : -1;
      const backMid = edgeMid(backSign);
      const backStart = point(
        backMid.x - rect.axisU.x * rect.halfU,
        backMid.z - rect.axisU.z * rect.halfU,
      );
      const backEnd = point(
        backMid.x + rect.axisU.x * rect.halfU,
        backMid.z + rect.axisU.z * rect.halfU,
      );
      for (const surface of surfaces) {
        const envelope =
          surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + 0.75;
        const clearance =
          Math.min(
            ...surface.centerline
              .slice(1)
              .map((end, index) =>
                segmentToSegment(
                  backStart,
                  backEnd,
                  surface.centerline[index],
                  end,
                ),
              ),
          ) - envelope;
        expect(
          clearance,
          `${block.id} back sits ${clearance.toFixed(1)}m off ${surface.id}'s pavement`,
        ).toBeGreaterThanOrEqual(CAIRO_BACK_TO_ROAD_MARGIN_M - 1e-6);
      }
    }
  });

  it("fills every drivable district with stable, two-sided roadside frontage", () => {
    const blocks = CAIRO_MAP_PACK.geometry.blocks;
    const roadside = blocks.filter((block) =>
      block.id.includes("-roadside-"),
    );
    expect(blocks).toHaveLength(BLOCK_COUNT);
    expect(roadside).toHaveLength(ROADSIDE_COUNT);
    expect(roadside[0].id).toBe(
      "cairo-corniche-el-nil-roadside-1-1-right-s1",
    );
    expect(roadside.at(-1)?.id).toBe(
      "cairo-west-nile-street-roadside-2-g1-right",
    );
    // `includes`, not `endsWith`: the halving ladder appends -s1/-s2 after the
    // side slug, and every piece of a left frontage still counts as left.
    expect(
      roadside.filter((block) => block.id.includes("-left")),
    ).toHaveLength(ROADSIDE_LEFT);
    expect(
      roadside.filter((block) => block.id.includes("-rank-")),
    ).toHaveLength(ROADSIDE_RANKS);

    // Most roadside frontage is now dressed with instanced glb buildings; the
    // procedural facade grid survives on the inland district parcels and the
    // deterministic one-in-six of roadside parcels cairoParcelKeepsFacadeBoxes
    // holds back. This is the count for that remainder, not for the whole map.
    expect(
      blocks
        .filter((block) => !block.buildingSet)
        .reduce(
          (total, block) =>
            total + Math.max(1, Math.round(3 + block.density * 7)),
          0,
        ),
    ).toBe(FACADE_BOX_CELLS);
    expect(blocks.filter((block) => block.buildingSet)).toHaveLength(
      STREET_WALL_BLOCKS,
    );

    const nonBridgeRoads = CAIRO_MAP_PACK.geometry.roadSurfaces.filter(
      (surface) => !surface.id.includes("-bridge"),
    );
    expect(nonBridgeRoads).toHaveLength(25);
    for (const surface of nonBridgeRoads) {
      expect(
        roadside.some((block) =>
          block.id.startsWith(`${surface.id}-roadside-`),
        ),
        surface.id,
      ).toBe(true);
    }
    for (const [surfaceId, openSide] of [
      ["cairo-corniche-el-nil", "left"],
      ["cairo-saray-el-gezira", "left"],
      ["cairo-nile-island-drive", "right"],
      ["cairo-dokki-nile-drive", "right"],
    ] as const) {
      expect(
        roadside.some(
          (block) =>
            block.id.startsWith(`${surfaceId}-roadside-`) &&
            // `includes`, not `endsWith`: if a future id gains a suffix after
            // the side slug, the waterfront must stay protected regardless.
            block.id.includes(`-${openSide}`),
        ),
        `${surfaceId} ${openSide} side should retain its Nile view`,
      ).toBe(false);
    }

    for (const block of roadside) {
      expect(block.frontageAxis, block.id).toBe("z");
      const sourceRoad = nonBridgeRoads.find((surface) =>
        block.id.startsWith(`${surface.id}-roadside-`),
      );
      expect(sourceRoad, block.id).toBeDefined();
      if (!sourceRoad) continue;
      const distance = Math.min(
        ...sourceRoad.centerline.slice(1).map((end, index) => {
          const start = sourceRoad.centerline[index];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount =
            lengthSquared > 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((block.center.x - start.x) * dx +
                      (block.center.z - start.z) * dz) /
                      lengthSquared,
                  ),
                )
              : 0;
          return Math.hypot(
            block.center.x - (start.x + dx * amount),
            block.center.z - (start.z + dz * amount),
          );
        }),
      );
      // Every roadside parcel stands just past the pavement — the band is
      // tight enough to catch one drifting out into open ground.
      expect(distance, block.id).toBeGreaterThan(11);
      expect(distance, block.id).toBeLessThan(31);

      const parcel = testOrientedRect(
        block.center,
        block.size,
        block.headingDeg ?? 0,
      );
      const samples = [
        parcel.center,
        ...([-1, 0, 1] as const).flatMap((u) =>
          ([-1, 0, 1] as const)
            .filter((v) => u !== 0 || v !== 0)
            .map((v) =>
              point(
                parcel.center.x +
                  parcel.axisU.x * parcel.halfU * u +
                  parcel.axisV.x * parcel.halfV * v,
                parcel.center.z +
                  parcel.axisU.z * parcel.halfU * u +
                  parcel.axisV.z * parcel.halfV * v,
              ),
            ),
        ),
      ];
      for (const water of CAIRO_MAP_PACK.geometry.waterBodies ?? []) {
        expect(
          testOrientedRectIntersectsPolygon(parcel, water.polygon),
          `${block.id} intersects ${water.id}`,
        ).toBe(false);
      }
      for (const sample of samples) {
        expect(Math.abs(sample.x), block.id).toBeLessThan(885);
        expect(Math.abs(sample.z), block.id).toBeLessThan(915);
      }
    }

    // A city parcel is a solid static obstacle, so overlapping blocks would
    // create invisible collision seams and duplicate façades.
    for (let first = 0; first < blocks.length; first += 1) {
      for (let second = first + 1; second < blocks.length; second += 1) {
        expect(
          testOrientedRectsOverlap(
            testOrientedRect(
              blocks[first].center,
              blocks[first].size,
              blocks[first].headingDeg ?? 0,
            ),
            testOrientedRect(
              blocks[second].center,
              blocks[second].size,
              blocks[second].headingDeg ?? 0,
            ),
          ),
          `${blocks[first].id} overlaps ${blocks[second].id}`,
        ).toBe(false);
      }
    }
  });

  it("closes Tahrir's northern horizon without touching a road envelope", () => {
    const ministries = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-tahrir-ministries",
    );
    const frontage = CAIRO_MAP_PACK.geometry.blocks.find(
      (block) => block.id === "cairo-tahrir-frontage-block",
    );
    expect(ministries).toBeDefined();
    expect(frontage).toBeDefined();
    if (!ministries || !frontage) return;

    // Both footprints obey the sampled envelope rule addRoadClearBlock holds
    // generated parcels to — the landmark never passes through it, so this
    // test is what holds the slab's clearance.
    const footprints = [
      { id: ministries.id, center: ministries.center, size: ministries.size },
      { id: frontage.id, center: frontage.center, size: frontage.size },
    ];
    for (const surface of CAIRO_MAP_PACK.geometry.roadSurfaces) {
      if (surface.id.includes("-bridge")) continue;
      const clearance =
        surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + 0.75;
      for (const footprint of footprints) {
        for (let index = 1; index < surface.centerline.length; index += 1) {
          const start = surface.centerline[index - 1];
          const end = surface.centerline[index];
          const steps = Math.max(
            1,
            Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 2),
          );
          for (let step = 0; step <= steps; step += 1) {
            const amount = step / steps;
            const x = start.x + (end.x - start.x) * amount;
            const z = start.z + (end.z - start.z) * amount;
            expect(
              Math.abs(x - footprint.center.x) <=
                footprint.size.x / 2 + clearance &&
                Math.abs(z - footprint.center.z) <=
                  footprint.size.z / 2 + clearance,
              `${footprint.id} reaches ${surface.id}'s envelope at (${x.toFixed(1)}, ${z.toFixed(1)})`,
            ).toBe(false);
          }
        }
      }
    }

    // No gig venue's lot stands inside either footprint. The wedge was empty
    // of blocks and landmarks when the backdrop was authored, but venues are
    // neither — this is the check that keeps a lane-anchored model from ever
    // standing inside the slab. Escape hatch if a venue moves here:
    // `venueLaneOverrides`.
    for (const venue of CAIRO_MAP_PACK.geometry.gigVenues ?? []) {
      const placement = resolveVenuePlacement(CAIRO_MAP_PACK, venue);
      expect(placement, venue.id).not.toBeNull();
      if (!placement) continue;
      const lotHalf = Math.max(venue.footprint.x, venue.footprint.z) / 2 + 2;
      for (const footprint of footprints) {
        expect(
          Math.abs(placement.x - footprint.center.x) >=
            footprint.size.x / 2 + lotHalf ||
            Math.abs(placement.z - footprint.center.z) >=
              footprint.size.z / 2 + lotHalf,
          `${venue.id}'s lot overlaps ${footprint.id}`,
        ).toBe(true);
      }
    }

    // And it does close the sector: from the obelisk, the slab's south face
    // plus the frontage block span past both ends of the bearing range that
    // used to run empty to the scenic Sixth October deck (~355°–35°).
    const obelisk = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-tahrir-obelisk",
    );
    expect(obelisk).toBeDefined();
    if (!obelisk) return;
    const bearing = (x: number, z: number) =>
      (Math.atan2(x - obelisk.center.x, z - obelisk.center.z) * 180) / Math.PI;
    expect(
      bearing(
        ministries.center.x - ministries.size.x / 2,
        ministries.center.z - ministries.size.z / 2,
      ),
    ).toBeLessThanOrEqual(-15);
    expect(
      bearing(
        ministries.center.x + ministries.size.x / 2,
        ministries.center.z - ministries.size.z / 2,
      ),
    ).toBeGreaterThanOrEqual(15);
    expect(
      bearing(
        frontage.center.x + frontage.size.x / 2,
        frontage.center.z - frontage.size.z / 2,
      ),
    ).toBeGreaterThanOrEqual(40);
  });

  interface KerbRect {
    x: number;
    z: number;
    yaw: number;
    halfW: number;
    halfD: number;
  }

  const OPEN_WATERFRONT_SIDE: Readonly<Record<string, -1 | 1>> = {
    "cairo-corniche-el-nil": -1,
    "cairo-saray-el-gezira": -1,
    "cairo-nile-island-drive": 1,
    "cairo-dokki-nile-drive": 1,
  };

  /** Every building face on the map as an oriented rect: glb parcels via
   * their slotted placements at authored footprints, facade parcels as the
   * parcel rect (cairoFrontagePosition packs their boxes to the street
   * edge). */
  const collectStreetWallRects = (): KerbRect[] => {
    const rects: KerbRect[] = [];
    for (const block of CAIRO_MAP_PACK.geometry.blocks) {
      const heading = ((block.headingDeg ?? 0) * Math.PI) / 180;
      if (block.buildingSet && isBuildingSetId(block.buildingSet)) {
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        for (const b of slotBlockBuildings(
          block.center,
          block.size,
          block.buildingSet,
          hashStringToSeed(`${block.id}-buildings`),
          1,
          block.streetEdges,
        )) {
          const cfg = buildingPlacementConfig(b.modelId)!;
          const lx = b.x - block.center.x;
          const lz = b.z - block.center.z;
          rects.push({
            x: block.center.x + lx * cos + lz * sin,
            z: block.center.z - lx * sin + lz * cos,
            yaw: b.yaw + heading,
            halfW: cfg.footprintM / 2,
            halfD: (cfg.depthM ?? cfg.footprintM) / 2,
          });
        }
      } else {
        rects.push({
          x: block.center.x,
          z: block.center.z,
          yaw: heading,
          halfW: block.size.x / 2,
          halfD: block.size.z / 2,
        });
      }
    }
    return rects;
  };

  /** Authored content that fills the view from a kerb without being a street
   * wall: landmark rects (parks, museums, the tower — not the elevated
   * bridges) and venue / service lots at their resolved lane poses. */
  const collectVisualExtraRects = (): KerbRect[] => {
    const rects: KerbRect[] = [];
    for (const landmark of CAIRO_MAP_PACK.geometry.landmarks) {
      if (landmark.kind === "bridge" || landmark.kind === "railway") continue;
      rects.push({
        x: landmark.center.x,
        z: landmark.center.z,
        yaw: 0,
        halfW: landmark.size.x / 2,
        halfD: landmark.size.z / 2,
      });
    }
    const laneById = new Map(
      CAIRO_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );
    const lotAt = (
      laneId: string,
      distanceAlongM: number,
      setbackM: number,
      halfM: number,
    ): KerbRect | null => {
      const lane = laneById.get(laneId);
      if (!lane) return null;
      let remaining = distanceAlongM;
      const line = lane.centerline;
      for (let index = 1; index < line.length; index += 1) {
        const from = line[index - 1];
        const to = line[index];
        const segment = Math.hypot(to.x - from.x, to.z - from.z);
        if (remaining <= segment || index === line.length - 1) {
          const t = segment > 0 ? Math.min(1, remaining / segment) : 0;
          const hx = (to.x - from.x) / (segment || 1);
          const hz = (to.z - from.z) / (segment || 1);
          // Driver's-right normal, the side resolveVenuePlacement uses.
          return {
            x: from.x + (to.x - from.x) * t + hz * setbackM,
            z: from.z + (to.z - from.z) * t - hx * setbackM,
            yaw: 0,
            halfW: halfM,
            halfD: halfM,
          };
        }
        remaining -= segment;
      }
      return null;
    };
    for (const service of CAIRO_MAP_PACK.geometry.servicePoints ?? []) {
      const rect = lotAt(
        service.anchor.laneId,
        service.anchor.distanceAlongM,
        service.setbackM ?? 16,
        (Math.max(service.footprint.x, service.footprint.z) + 8) / 2,
      );
      if (rect) rects.push(rect);
    }
    for (const venue of CAIRO_MAP_PACK.geometry.gigVenues ?? []) {
      const rect = lotAt(
        venue.anchor.laneId,
        venue.anchor.distanceAlongM,
        venue.setbackM ?? 13,
        (Math.max(venue.footprint.x, venue.footprint.z) + 4) / 2,
      );
      if (rect) rects.push(rect);
    }
    return rects;
  };

  /** 40 m spatial hash checked over a 3x3 window: sound while no rect's half
   * extent exceeds 80 m (the longest today is a 60 m district-block half). */
  const KERB_CELL_M = 40;
  const bucketKerbRects = (
    rects: readonly KerbRect[],
  ): Map<string, KerbRect[]> => {
    const buckets = new Map<string, KerbRect[]>();
    for (const rect of rects) {
      const key = `${Math.floor(rect.x / KERB_CELL_M)},${Math.floor(rect.z / KERB_CELL_M)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(rect);
      else buckets.set(key, [rect]);
    }
    return buckets;
  };

  /** Does any rect span this kerb sample along the road while reaching within
   * setbackM of the kerb line (and not sitting behind it)? */
  const kerbSampleCovered = (
    buckets: ReadonlyMap<string, readonly KerbRect[]>,
    kx: number,
    kz: number,
    tx: number,
    tz: number,
    inx: number,
    inz: number,
    setbackM: number,
  ): boolean => {
    const bx = Math.floor(kx / KERB_CELL_M);
    const bz = Math.floor(kz / KERB_CELL_M);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (const rect of buckets.get(`${bx + ox},${bz + oz}`) ?? []) {
          const cos = Math.cos(rect.yaw);
          const sin = Math.sin(rect.yaw);
          const ux = cos;
          const uz = -sin;
          const vx = sin;
          const vz = cos;
          const offX = rect.x - kx;
          const offZ = rect.z - kz;
          const alongRadius =
            rect.halfW * Math.abs(ux * tx + uz * tz) +
            rect.halfD * Math.abs(vx * tx + vz * tz);
          if (Math.abs(offX * tx + offZ * tz) > alongRadius) continue;
          const depthIn = offX * inx + offZ * inz;
          const inRadius =
            rect.halfW * Math.abs(ux * inx + uz * inz) +
            rect.halfD * Math.abs(vx * inx + vz * inz);
          if (depthIn - inRadius <= setbackM && depthIn + inRadius >= 0) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // The old version of this test asked "is there a parcel within 45 m", which
  // sat at 100% while drivers saw bare kerbs — proximity is not frontage. This
  // one measures what the driver sees: the share of buildable kerb with an
  // actual building face on it (within KERB_SETBACK_MAX_M of the pavement,
  // spanning the sample along the road). Buildings, not parcels: glb parcels
  // contribute their slotted placements at authored footprints (masters are
  // recentred, so slot centre = building centre); facade parcels contribute
  // their parcel rect, because cairoFrontagePosition packs their boxes to the
  // parcel edge.
  it("walls the buildable kerb with buildings, measured at the kerb", () => {
    const KERB_SETBACK_MAX_M = 8;
    const rects = collectStreetWallRects();
    expect(rects.length).toBeGreaterThan(300);
    const buckets = bucketKerbRects(rects);

    interface Coverage {
      samples: number;
      walled: number;
    }
    let total = 0;
    let walled = 0;
    const perRoad = new Map<string, Coverage>();
    const roads = CAIRO_MAP_PACK.geometry.roadSurfaces.filter(
      (surface) => !surface.id.includes("-bridge"),
    );
    for (const surface of roads) {
      const road: Coverage = { samples: 0, walled: 0 };
      perRoad.set(surface.id, road);
      const kerbOffset =
        surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8);
      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-8) continue;
        const tx = dx / length;
        const tz = dz / length;
        const steps = Math.max(1, Math.floor(length / 4));
        for (let step = 0; step <= steps; step += 1) {
          const px = start.x + dx * (step / steps);
          const pz = start.z + dz * (step / steps);
          for (const side of [-1, 1] as const) {
            if (OPEN_WATERFRONT_SIDE[surface.id] === side) continue;
            const inx = tz * side;
            const inz = -tx * side;
            const kx = px + inx * kerbOffset;
            const kz = pz + inz * kerbOffset;
            total += 1;
            road.samples += 1;
            if (
              kerbSampleCovered(
                buckets,
                kx,
                kz,
                tx,
                tz,
                inx,
                inz,
                KERB_SETBACK_MAX_M,
              )
            ) {
              walled += 1;
              road.walled += 1;
            }
          }
        }
      }
    }

    expect(total).toBeGreaterThan(10_000);
    // Achieved: 59.6% (53.5% before the side-aware exclusions, gap-fill pass
    // and sliver ladder; 44.8% before the clearance/split-ladder/pack tuning;
    // ~28% before parcels were depth-derived). Floor sits a couple of points
    // under so an unrelated generator nudge doesn't trip it; a return to the
    // bare-kerb era smashes straight through it.
    expect(walled / total).toBeGreaterThanOrEqual(0.575);
    // Worst road today is opera-square at 39.8% — its frontage band is largely
    // consumed by earlier roads' parcels under greedy acceptance, and the
    // gap-fill pass recovers what physically fits between them. No road may
    // fall below 37% walled, and the stragglers must not multiply.
    let below42 = 0;
    for (const [roadId, coverage] of perRoad) {
      const share = coverage.walled / coverage.samples;
      expect(share, roadId).toBeGreaterThanOrEqual(0.37);
      if (share < 0.42) below42 += 1;
    }
    expect(below42, "roads under 42% kerb coverage").toBeLessThanOrEqual(2);
  });

  // The user-facing complaint this guards: driving Cairo past long swaths of
  // bare grey ground. Coverage here is VISUAL, not just buildings — a park,
  // museum, venue lot or fuel forecourt fills the view from the kerb exactly
  // as a facade does — and the setback is looser (16 m) because a building
  // standing 14 m back still closes the street wall to the eye. What it
  // refuses to tolerate is a long contiguous run with nothing at all: the
  // pre-2026 map had 379 m of it beside the opera corridor alone. The 125 m
  // ceiling leaves room for the one authored exception — the pinched strip
  // between Saray and El Gabalaya (the island's club edge, ~120 m) — while
  // any re-opened void of the old kind fails with named coordinates.
  it("leaves no long bare run on any built-up kerb", () => {
    const VISUAL_SETBACK_M = 16;
    const MAX_BARE_RUN_M = 125;
    // Floor-setter: cairo-opera-square right at 38.6% — a 345 m connector
    // whose four junction corners belong to the crossing streets, and whose
    // handful of parcels make the share swing a few points on any facade
    // re-roll. Everything else sits above 42%.
    const MIN_SIDE_SHARE = 0.37;
    const rects = [...collectStreetWallRects(), ...collectVisualExtraRects()];
    const buckets = bucketKerbRects(rects);
    const failures: string[] = [];
    for (const surface of CAIRO_MAP_PACK.geometry.roadSurfaces) {
      if (surface.id.includes("-bridge")) continue;
      const kerbOffset =
        surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8);
      for (const side of [-1, 1] as const) {
        if (OPEN_WATERFRONT_SIDE[surface.id] === side) continue;
        let samples = 0;
        let covered = 0;
        let run = 0;
        let runStart: readonly [number, number] | null = null;
        const worst: {
          run: number;
          start: readonly [number, number] | null;
        } = { run: 0, start: null };
        const endRun = () => {
          if (run > worst.run) {
            worst.run = run;
            worst.start = runStart;
          }
          run = 0;
          runStart = null;
        };
        for (let index = 1; index < surface.centerline.length; index += 1) {
          const start = surface.centerline[index - 1];
          const end = surface.centerline[index];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const length = Math.hypot(dx, dz);
          if (length < 1e-8) continue;
          const tx = dx / length;
          const tz = dz / length;
          const steps = Math.max(1, Math.floor(length / 4));
          for (let step = 0; step <= steps; step += 1) {
            const px = start.x + dx * (step / steps);
            const pz = start.z + dz * (step / steps);
            const inx = tz * side;
            const inz = -tx * side;
            const kx = px + inx * kerbOffset;
            const kz = pz + inz * kerbOffset;
            samples += 1;
            if (
              kerbSampleCovered(buckets, kx, kz, tx, tz, inx, inz, VISUAL_SETBACK_M)
            ) {
              covered += 1;
              endRun();
            } else {
              if (run === 0) runStart = [kx, kz];
              run += 4;
            }
          }
        }
        endRun();
        const sideName = side < 0 ? "left" : "right";
        if (worst.run > MAX_BARE_RUN_M && worst.start) {
          failures.push(
            `${surface.id} ${sideName}: ${worst.run}m bare from (${worst.start[0].toFixed(0)}, ${worst.start[1].toFixed(0)})`,
          );
        }
        if (samples > 0 && covered / samples < MIN_SIDE_SHARE) {
          failures.push(
            `${surface.id} ${sideName}: only ${((covered / samples) * 100).toFixed(1)}% visually fronted`,
          );
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("keeps the elevated Sixth October deck and piers clear of every block OBB", () => {
    const bridge = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-sixth-october-bridge",
    )!;
    // The extra metre on either side pins the façade/collider guard used by
    // parcel authoring, while every pier remains inside the narrower deck.
    const guardedCorridor = testOrientedRect(
      bridge.center,
      point(bridge.size.x, bridge.size.z + 2),
      bridge.headingDeg! - 90,
    );
    expect(CAIRO_MAP_PACK.geometry.blocks.length).toBeGreaterThanOrEqual(20);
    expect(
      CAIRO_MAP_PACK.geometry.blocks.map((block) => block.id),
    ).not.toEqual(
      expect.arrayContaining([
        "cairo-east-block-6-1",
        "cairo-island-block-5-2",
      ]),
    );
    for (const block of CAIRO_MAP_PACK.geometry.blocks) {
      expect(
        testOrientedRectsOverlap(
          guardedCorridor,
          testOrientedRect(
            block.center,
            block.size,
            block.headingDeg ?? 0,
          ),
        ),
        block.id,
      ).toBe(false);
    }
  });

  it("anchors the free drive at the first Cairo player start", () => {
    expect(CAIRO_FREE_DRIVE).toMatchObject({
      id: "free-eg",
      countryId: "eg",
      destinationId: "eg-cairo",
      mapId: "cairo-central-nile",
      startSpawnId: "cairo-player-1",
      trafficSeed: 2601,
    });
    const start = CAIRO_MAP_PACK.laneGraph.spawnPoints.find(
      (spawn) => spawn.id === CAIRO_FREE_DRIVE.startSpawnId,
    );
    expect(start?.kind).toBe("player");
  });

  it("pins the authored Cairo traffic replay", () => {
    const scenario = buildFreeDriveScenario(CAIRO_FREE_DRIVE);
    const configuration = buildSimulationCoreConfig({
      scenario,
      mapPack: CAIRO_MAP_PACK,
      trafficSide: "right",
      speedUnit: "kmh",
    });
    const run = (): {
      readonly hash: string;
      readonly snapshot: SimulationSnapshot;
    } => {
      const simulation = new SimulationCore(configuration);
      let hash = traceSnapshot(2_166_136_261, simulation.getSnapshot());
      for (let tick = 0; tick < 1_800; tick += 1) {
        hash = traceSnapshot(
          hash,
          simulation.step(FIXED_STEP_SECONDS),
        );
      }
      return {
        hash: hash.toString(16).padStart(8, "0"),
        snapshot: simulation.getSnapshot(),
      };
    };

    const first = run();
    const replay = run();
    expect(replay).toEqual(first);
    expect(first.hash).toBe("cf5ab089");
    expect(first.snapshot).toMatchObject({
      tick: 1_800,
      status: "running",
      queuedNpcCount: 0,
    });
    expect(first.snapshot.npcs).toHaveLength(32);
  });

  it("matches the committed frozen OSM provenance and content checksum", async () => {
    const raw = await readFile(
      resolve(
        process.cwd(),
        "public",
        "map-data",
        "eg-cairo-central-nile.json",
      ),
      "utf8",
    );
    const extract = JSON.parse(raw) as {
      schemaVersion: number;
      id: string;
      source: {
        provider: string;
        license: string;
        attributionUrl: string;
        sourceUrl: string;
        sourceSha256: string;
        contentSha256: string;
        importerVersion: string;
        bbox: number[];
        frozenAt: string;
      };
      roads: { tags?: Record<string, string> }[];
      buildings: unknown[];
    };
    expect(extract.schemaVersion).toBe(1);
    expect(extract.id).toBe("eg-cairo-central-nile");
    expect(extract.source.provider).toBe("OpenStreetMap contributors");
    expect(extract.source.license).toBe("ODbL-1.0");
    expect(extract.source.attributionUrl).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    expect(extract.source.bbox).toEqual([
      30.0305, 31.2105, 30.0565, 31.2395,
    ]);
    expect(extract.source.importerVersion).toBe("sideswap-osm-compact@2");
    expect(extract.roads.length).toBeGreaterThan(1_000);
    expect(extract.buildings.length).toBeGreaterThan(1_000);
    const frozenNames = new Set(
      extract.roads.flatMap((road) =>
        [road.tags?.["name:en"], road.tags?.name].filter(
          (name): name is string => Boolean(name),
        ),
      ),
    );
    for (const road of CAIRO_ROAD_SPECS) {
      expect(
        frozenNames.has(road.osmSourceName),
        `${road.id}: ${road.osmSourceName}`,
      ).toBe(true);
    }
    expect(CAIRO_MAP_PACK.roadNames).toMatchObject({
      "cairo-corniche-el-nil": "Corniche El-Nil",
      "cairo-qasr-el-ainy": "Qasr El-Ainy Street",
      "cairo-galaa-street": "Al-Galaa Street",
      "cairo-qasr-el-nil-street": "Qasr El-Nil Street",
      "cairo-qasr-el-nil-bridge": "Qasr El-Nil Bridge",
      "cairo-al-galaa-bridge": "Al-Galaa Bridge",
      "cairo-nile-island-drive": "El-Nil Street",
    });
    const contentSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          roads: extract.roads,
          buildings: extract.buildings,
        }),
      )
      .digest("hex");
    expect(contentSha256).toBe(extract.source.contentSha256);
    expect(CAIRO_MAP_PACK.source.checksum).toBe(contentSha256);
  });
});

function point(x: number, z: number): WorldPoint {
  return { x, z };
}
