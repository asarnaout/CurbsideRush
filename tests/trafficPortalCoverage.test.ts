import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getMapPack } from "../app/game/content";
import {
  buildRuntimeTrafficPortals,
  isRuntimeTrafficPortalLane,
} from "../app/game/simulationAdapter";
import {
  RUNTIME_TRAFFIC_APPROACH_MAX_M,
  RUNTIME_TRAFFIC_APPROACH_MIN_M,
} from "../app/game/simulation/trafficLocality";

interface Point {
  readonly x: number;
  readonly z: number;
}

const polylineLength = (points: readonly Point[]): number => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].z - points[index - 1].z,
    );
  }
  return length;
};

const pointOnPolyline = (points: readonly Point[], distance: number): Point => {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.z - start.z);
    if (remaining <= segmentLength || index === points.length - 1) {
      const progress = segmentLength <= Number.EPSILON ? 0 : remaining / segmentLength;
      return {
        x: start.x + (end.x - start.x) * Math.min(1, progress),
        z: start.z + (end.z - start.z) * Math.min(1, progress),
      };
    }
    remaining -= segmentLength;
  }
  return points[points.length - 1];
};

/** The fixed 100 m audit deliberately includes the final partial segment, so
 * a short terminal section cannot hide a local portal desert. */
function* laneSamplesEvery100m(points: readonly Point[]): Generator<[number, Point]> {
  const length = polylineLength(points);
  let distance = 0;
  while (distance < length) {
    yield [distance, pointOnPolyline(points, distance)];
    distance += 100;
  }
  yield [length, pointOnPolyline(points, length)];
}

describe("runtime traffic portal coverage", () => {
  it("finds a hidden approach portal from every 100 m sample of every eligible shipped lane", () => {
    for (const freeDrive of FREE_DRIVES) {
      const mapPack = getMapPack(freeDrive.mapId);
      const portals = buildRuntimeTrafficPortals(mapPack);
      const misses: string[] = [];

      for (const lane of mapPack.laneGraph.lanes) {
        if (!isRuntimeTrafficPortalLane(lane)) continue;
        for (const [distance, sample] of laneSamplesEvery100m(lane.centerline)) {
          const hasApproachPortal = portals.some((portal) => {
            const portalDistance = Math.hypot(portal.x - sample.x, portal.z - sample.z);
            return (
              portalDistance >= RUNTIME_TRAFFIC_APPROACH_MIN_M &&
              portalDistance <= RUNTIME_TRAFFIC_APPROACH_MAX_M
            );
          });
          if (!hasApproachPortal) {
            misses.push(`${lane.id}@${Math.round(distance)}m`);
          }
        }
      }

      // The plan allows explicit topology exceptions, but the current four
      // shipped maps need none. Keep failures concrete so any newly introduced
      // portal desert is reviewed as authored topology rather than ignored.
      expect(
        misses,
        `${mapPack.id} eligible-lane samples without a ${RUNTIME_TRAFFIC_APPROACH_MIN_M}–${RUNTIME_TRAFFIC_APPROACH_MAX_M} m approach portal`,
      ).toEqual([]);
    }
  });
});
