import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAIRO_CONTENT_REVIEWED_ON,
  CAIRO_FREE_DRIVE,
  CAIRO_JUNCTION_CONNECTORS,
  CAIRO_MAP_PACK,
  CAIRO_ROAD_SPECS,
  CAIRO_RULE_REFERENCES,
} from "../app/game/cairoContent";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationSnapshot,
} from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  buildStaticObstacles,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import type {
  LaneSegment,
  MapPack,
  ProceduralBlock,
  RoadSurface,
  WorldPoint,
} from "../app/game/types";

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

    const openObstacles = buildStaticObstacles(
      CAIRO_MAP_PACK,
      boundsFor(CAIRO_MAP_PACK),
    );
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
    const closedObstacles = buildStaticObstacles(
      closedMap,
      boundsFor(closedMap),
    );

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
    expect(graph.checkpoints).toHaveLength(10);
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
      expect(crosswalks, signal.id).toHaveLength(signal.approaches.length);
      for (const approach of signal.approaches) {
        const crosswalk = crosswalks.filter((installation) =>
          installation.approachIds?.includes(approach.id),
        );
        expect(crosswalk, approach.id).toHaveLength(1);
        expect(crosswalk[0].approachIds, approach.id).toEqual([approach.id]);
        const lane = graph.lanes.find(
          (candidate) => candidate.id === approach.laneIds[0],
        )!;
        const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
          (candidate) => candidate.id === lane.roadId,
        )!;
        expect(crosswalk[0].spanM, approach.id).toBe(surface.widthM);
        expect(
          headingDifferenceDeg(
            crosswalk[0].headingDeg,
            nearestSegmentHeadingDeg(
              lane.centerline,
              crosswalk[0].position,
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

  it("fills every drivable district with stable, two-sided roadside frontage", () => {
    const blocks = CAIRO_MAP_PACK.geometry.blocks;
    const roadside = blocks.filter((block) =>
      block.id.includes("-roadside-"),
    );
    expect(blocks).toHaveLength(258);
    expect(roadside).toHaveLength(235);
    expect(roadside[0].id).toBe(
      "cairo-corniche-el-nil-roadside-2-1-right",
    );
    expect(roadside.at(-1)?.id).toBe(
      "cairo-agouza-approach-roadside-1-1-split-1-right",
    );
    expect(
      roadside.filter((block) => block.id.endsWith("-left")),
    ).toHaveLength(114);
    expect(
      roadside.filter((block) => block.id.endsWith("-right")),
    ).toHaveLength(121);
    expect(
      blocks.reduce(
        (total, block) =>
          total + Math.max(1, Math.round(3 + block.density * 7)),
        0,
      ),
    ).toBe(2_301);

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
            block.id.endsWith(`-${openSide}`),
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
      expect(distance, block.id).toBeGreaterThan(20);
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

  it("keeps dense frontage in view along the full driveable network", () => {
    const sampleStepM = 20;
    const openWaterfrontSide: Readonly<Record<string, -1 | 1>> = {
      "cairo-corniche-el-nil": -1,
      "cairo-saray-el-gezira": -1,
      "cairo-nile-island-drive": 1,
      "cairo-dokki-nile-drive": 1,
    };
    const dot = (left: WorldPoint, right: WorldPoint): number =>
      left.x * right.x + left.z * right.z;
    const covers = (
      sample: WorldPoint,
      tangent: WorldPoint,
      side: -1 | 1,
      candidate: ProceduralBlock,
    ): boolean => {
      const normal = point(tangent.z * side, -tangent.x * side);
      const yaw = ((candidate.headingDeg ?? 0) * Math.PI) / 180;
      const axisU = point(Math.cos(yaw), -Math.sin(yaw));
      const axisV = point(Math.sin(yaw), Math.cos(yaw));
      const offset = point(
        candidate.center.x - sample.x,
        candidate.center.z - sample.z,
      );
      const lateral = dot(offset, normal);
      const halfAlong =
        (candidate.size.x / 2) * Math.abs(dot(axisU, tangent)) +
        (candidate.size.z / 2) * Math.abs(dot(axisV, tangent));
      const halfLateral =
        (candidate.size.x / 2) * Math.abs(dot(axisU, normal)) +
        (candidate.size.z / 2) * Math.abs(dot(axisV, normal));
      return (
        lateral + halfLateral > 8 &&
        lateral - halfLateral <= 45 &&
        Math.abs(dot(offset, tangent)) - halfAlong <= 12
      );
    };

    interface Coverage {
      samples: number;
      hits: number;
    }
    let allSamples = 0;
    let allHits = 0;
    let eligibleSamples = 0;
    let eligibleHits = 0;
    const perRoad = new Map<string, Coverage>();
    const perSide = new Map<string, Coverage>();
    const blocks = CAIRO_MAP_PACK.geometry.blocks;
    const roads = CAIRO_MAP_PACK.geometry.roadSurfaces.filter(
      (surface) => !surface.id.includes("-bridge"),
    );

    for (const surface of roads) {
      const road = { samples: 0, hits: 0 };
      for (
        let segment = 1;
        segment < surface.centerline.length;
        segment += 1
      ) {
        const start = surface.centerline[segment - 1];
        const end = surface.centerline[segment];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-8) continue;
        const tangent = point(dx / length, dz / length);
        const sampleCount = Math.ceil(length / sampleStepM);
        for (let index = 0; index < sampleCount; index += 1) {
          const amount = (index + 0.5) / sampleCount;
          const sample = point(
            start.x + dx * amount,
            start.z + dz * amount,
          );
          for (const side of [-1, 1] as const) {
            const hit = blocks.some((candidate) =>
              covers(sample, tangent, side, candidate),
            );
            allSamples += 1;
            road.samples += 1;
            if (hit) {
              allHits += 1;
              road.hits += 1;
            }
            const sideKey = `${surface.id}:${side}`;
            const sideCoverage = perSide.get(sideKey) ?? {
              samples: 0,
              hits: 0,
            };
            sideCoverage.samples += 1;
            if (hit) sideCoverage.hits += 1;
            perSide.set(sideKey, sideCoverage);

            if (openWaterfrontSide[surface.id] === side) continue;
            eligibleSamples += 1;
            if (hit) eligibleHits += 1;
          }
        }
      }
      perRoad.set(surface.id, road);
    }

    expect(allHits / allSamples).toBeGreaterThanOrEqual(0.52);
    expect(eligibleHits / eligibleSamples).toBeGreaterThanOrEqual(0.6);
    for (const [roadId, coverage] of perRoad) {
      expect(coverage.hits / coverage.samples, roadId).toBeGreaterThanOrEqual(
        0.35,
      );
    }
    for (const surface of roads) {
      for (const side of [-1, 1] as const) {
        if (openWaterfrontSide[surface.id] === side) continue;
        const coverage = perSide.get(`${surface.id}:${side}`)!;
        expect(
          coverage.hits / coverage.samples,
          `${surface.id} ${side < 0 ? "left" : "right"} frontage`,
        ).toBeGreaterThanOrEqual(0.4);
      }
    }
    for (const [roadId, waterSide] of Object.entries(openWaterfrontSide)) {
      const inlandSide = -waterSide as -1 | 1;
      const coverage = perSide.get(`${roadId}:${inlandSide}`)!;
      expect(
        coverage.hits / coverage.samples,
        `${roadId} inland frontage`,
      ).toBeGreaterThanOrEqual(0.7);
    }
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
    const lesson = buildFreeDriveLesson(CAIRO_FREE_DRIVE, "right");
    const configuration = buildSimulationCoreConfig({
      lesson,
      mapPack: CAIRO_MAP_PACK,
      trafficSide: "right",
      speedUnit: "km/h",
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
    expect(first.hash).toBe("587e7fef");
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
