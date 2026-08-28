import { describe, expect, it } from "vitest";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
} from "../app/game/cities/cairo";
import {
  type LaneProjection,
  type NormalizedLane,
  RoadNetwork,
  type RoadProjectionPreference,
  type SimulationLane,
} from "../app/game/simulation/roadNetwork";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "../app/game/simulation/roadLevels";
import { LegacyRoadProjectionOracle } from "./helpers/legacyRoadProjectionOracle";

const cairoScenario = buildFreeDriveScenario(CAIRO_FREE_DRIVE);
const cairoConfig = buildSimulationCoreConfig({
  scenario: cairoScenario,
  mapPack: CAIRO_MAP_PACK,
  trafficSide: "right",
  speedUnit: "kmh",
  // Projection needs only the production lane graph. Avoid planning thousands
  // of unrelated building solids in this focused geometry test.
  buildingLayout: {
    mapId: CAIRO_MAP_PACK.id,
    trafficSeed: cairoScenario.trafficSeed,
    buildings: [],
  },
});
const cairoSpawn = cairoConfig.spawn!;
const cairoRoadNetwork = new RoadNetwork(cairoConfig.lanes ?? [], [], []);
const cairoOracle = new LegacyRoadProjectionOracle(cairoRoadNetwork.lanes);

function projectionDifference(
  label: string,
  expected: LaneProjection | null,
  actual: LaneProjection | null,
): string | null {
  if (!expected || !actual) {
    return expected === actual
      ? null
      : `${label}: expected ${expected?.lane.id ?? "null"}, got ${actual?.lane.id ?? "null"}`;
  }
  if (expected.lane.id !== actual.lane.id) {
    return `${label}: lane ${expected.lane.id} != ${actual.lane.id}`;
  }
  for (const key of [
    "distance",
    "distanceAlong",
    "heading",
    "x",
    "z",
    "elevationM",
  ] as const) {
    if (!Object.is(expected[key], actual[key])) {
      return `${label}: ${key} ${expected[key]} != ${actual[key]}`;
    }
  }
  return null;
}

function pointDifference(
  label: string,
  expected: ReturnType<LegacyRoadProjectionOracle["pointOnLane"]>,
  actual: ReturnType<RoadNetwork["pointOnLane"]>,
): string | null {
  for (const key of ["x", "z", "heading"] as const) {
    if (!Object.is(expected[key], actual[key])) {
      return `${label}: ${key} ${expected[key]} != ${actual[key]}`;
    }
  }
  const expectedHasElevation = "elevationM" in expected;
  const actualHasElevation = "elevationM" in actual;
  if (
    expectedHasElevation !== actualHasElevation ||
    !Object.is(expected.elevationM, actual.elevationM)
  ) {
    return `${label}: elevation ${expected.elevationM ?? "absent"} != ${actual.elevationM ?? "absent"}`;
  }
  return null;
}

function samplePoint(
  lane: NormalizedLane,
  segmentIndex: number,
  amount: number,
): { x: number; z: number; elevationM: number; heading: number } {
  const start = lane.points[segmentIndex];
  return {
    x: start.x + lane.segmentDeltaX[segmentIndex] * amount,
    z: start.z + lane.segmentDeltaZ[segmentIndex] * amount,
    elevationM:
      lane.segmentStartElevationsM[segmentIndex] +
      lane.segmentElevationDeltasM[segmentIndex] * amount,
    heading: lane.segmentHeadings[segmentIndex],
  };
}

function compareProjection(
  label: string,
  x: number,
  z: number,
  preference: RoadProjectionPreference | undefined,
  differences: string[],
): void {
  const expected = cairoOracle.projectToRoad(x, z, preference);
  const actual = cairoRoadNetwork.projectToRoad(x, z, preference);
  const difference = projectionDifference(label, expected, actual);
  if (difference && differences.length < 20) differences.push(difference);
}

function predecessorIdsByLane(
  lanes: readonly NormalizedLane[],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const lane of lanes) {
    for (const successorId of lane.successorLaneIds) {
      const bucket = result.get(successorId);
      if (bucket) bucket.push(lane.id);
      else result.set(successorId, [lane.id]);
    }
  }
  return result;
}

function continuityLaneIds(
  network: RoadNetwork,
  preferredLane: NormalizedLane,
): ReadonlySet<string> {
  const result = new Set<string>([preferredLane.id]);
  if (preferredLane.adjacentLaneId) result.add(preferredLane.adjacentLaneId);
  for (const successorId of preferredLane.successorLaneIds) {
    result.add(successorId);
    const successor = network.lanesById.get(successorId);
    if (successor?.adjacentLaneId) result.add(successor.adjacentLaneId);
  }
  for (const predecessorId of
    predecessorIdsByLane(network.lanes).get(preferredLane.id) ?? []) {
    result.add(predecessorId);
    const predecessor = network.lanesById.get(predecessorId);
    if (predecessor?.adjacentLaneId) result.add(predecessor.adjacentLaneId);
  }
  return result;
}

describe("RoadNetwork projection hot-path equivalence", () => {
  it(
    "matches the frozen linear point lookup at every Cairo segment boundary and midpoint",
    { timeout: 30_000 },
    () => {
      const differences: string[] = [];
      let comparisons = 0;
      for (const lane of cairoRoadNetwork.lanes) {
        for (let index = 0; index < lane.segmentLengths.length; index += 1) {
          const startDistance =
            index === 0 ? 0 : lane.segmentEndDistances[index - 1];
          const endDistance = lane.segmentEndDistances[index];
          const distances = [
            startDistance,
            startDistance + lane.segmentLengths[index] / 2,
            endDistance,
          ];
          if (index > 0) distances.push(Math.max(0, startDistance - 1e-7));
          if (index + 1 < lane.segmentLengths.length) {
            distances.push(Math.min(lane.length, endDistance + 1e-7));
          }
          for (const distance of distances) {
            comparisons += 1;
            const difference = pointDifference(
              `${lane.id}@${distance}`,
              cairoOracle.pointOnLane(lane, distance),
              cairoRoadNetwork.pointOnLane(lane, distance),
            );
            if (difference && differences.length < 20) differences.push(difference);
          }
        }
      }
      expect(differences).toEqual([]);
      expect(comparisons).toBe(49_592);
    },
  );

  it("preserves exact incoming-segment boundary semantics for loops and zero-length chords", () => {
    const definitions: SimulationLane[] = [
      {
        id: "loop-with-duplicate",
        loop: true,
        points: [
          { x: 0, z: 0 },
          { x: 0, z: 0 },
          { x: 0, z: 10, elevationM: 2 },
          { x: 10, z: 10, elevationM: 2 },
          { x: 0, z: 0 },
        ],
      },
    ];
    const network = new RoadNetwork(definitions, [], []);
    const oracle = new LegacyRoadProjectionOracle(network.lanes);
    const lane = network.lanes[0];
    const distances = [
      -lane.length * 2 - 0.5,
      -0.5,
      0,
      ...lane.segmentEndDistances.flatMap((distance) => [
        Math.max(0, distance - 1e-9),
        distance,
        Math.min(lane.length, distance + 1e-9),
      ]),
      lane.length + 0.5,
      lane.length * 2 + 0.5,
      Number.NaN,
    ];
    expect(
      distances
        .map((distance) =>
          pointDifference(
            `synthetic@${distance}`,
            oracle.pointOnLane(lane, distance),
            network.pointOnLane(lane, distance),
          ),
        )
        .filter((difference): difference is string => difference !== null),
    ).toEqual([]);
  });

  it(
    "matches the legacy projection on every Cairo segment, lateral tie band, ramp mouth, and stacked level",
    { timeout: 120_000 },
    () => {
      const differences: string[] = [];
      let preferredCases = 0;
      let plainCases = 0;
      let raisedCases = 0;
      let groundCases = 0;

      for (const lane of cairoRoadNetwork.lanes) {
        for (let index = 0; index < lane.segmentLengths.length; index += 1) {
          const point = samplePoint(lane, index, 0.5);
          const rightX = Math.cos(point.heading);
          const rightZ = -Math.sin(point.heading);
          compareProjection(
            `plain/${lane.id}/${index}`,
            point.x,
            point.z,
            undefined,
            differences,
          );
          plainCases += 1;
          for (const lateralM of [-0.11, 0, 0.11]) {
            compareProjection(
              `preferred/${lane.id}/${index}/${lateralM}`,
              point.x + rightX * lateralM,
              point.z + rightZ * lateralM,
              {
                heading: point.heading,
                preferredLaneId: lane.id,
                preferredElevationM: point.elevationM,
              },
              differences,
            );
            preferredCases += 1;
            if (point.elevationM > ELEVATED_ROAD_STRUCTURE_THRESHOLD_M) {
              raisedCases += 1;
            } else {
              groundCases += 1;
            }
          }
        }
      }

      // Exact graph seams exercise authored-order, preferred-lane hysteresis,
      // and incoming-vs-outgoing heading ties at every ramp mouth, not just at
      // an arbitrary sample near one.
      let directedSeams = 0;
      for (const lane of cairoRoadNetwork.lanes) {
        const end = lane.points.at(-1)!;
        for (const successorId of lane.successorLaneIds) {
          const successor = cairoRoadNetwork.lanesById.get(successorId);
          if (!successor) continue;
          for (const preferred of [lane, successor]) {
            compareProjection(
              `seam/${lane.id}/${successor.id}/${preferred.id}`,
              end.x,
              end.z,
              {
                heading:
                  preferred === lane
                    ? lane.segmentHeadings.at(-1)!
                    : successor.segmentHeadings[0],
                preferredLaneId: preferred.id,
                preferredElevationM: end.elevationM ?? 0,
              },
              differences,
            );
            preferredCases += 1;
          }
          directedSeams += 1;
        }
      }

      // Exercise the two non-live but supported preference modes: heading-only
      // callers and explicit authored 3D placement with no previous lane.
      for (let laneIndex = 0; laneIndex < cairoRoadNetwork.lanes.length; laneIndex += 1) {
        const lane = cairoRoadNetwork.lanes[laneIndex];
        const point = samplePoint(
          lane,
          Math.floor(lane.segmentLengths.length / 2),
          0.5,
        );
        compareProjection(
          `heading-only/${lane.id}`,
          point.x,
          point.z,
          { heading: point.heading, preferredLaneId: lane.id },
          differences,
        );
        preferredCases += 1;
        if (lane.maxElevationM >= ELEVATED_ROAD_STRUCTURE_THRESHOLD_M) {
          compareProjection(
            `authored-elevated/${lane.id}`,
            point.x,
            point.z,
            {
              heading: point.heading,
              preferredLaneId: "missing-prior-lane",
              preferredElevationM: point.elevationM,
              allowUnconnectedElevationCapture: true,
            },
            differences,
          );
          preferredCases += 1;
        }
      }

      expect(differences).toEqual([]);
      expect(plainCases).toBe(10_104);
      expect(preferredCases).toBe(32_493);
      expect(raisedCases).toBe(9_582);
      expect(groundCases).toBe(20_730);
      expect(directedSeams).toBe(814);
    },
  );

  it("records the compatible-first scan reduction and the exact raised fallback", () => {
    const totalSegments = cairoRoadNetwork.lanes.reduce(
      (sum, lane) => sum + lane.segmentLengths.length,
      0,
    );
    const ground = cairoRoadNetwork.projectToRoad(
      cairoSpawn.x,
      cairoSpawn.z,
    )!;
    const groundCaptureIds = new Set<string>([ground.lane.id]);
    if (ground.lane.adjacentLaneId) {
      groundCaptureIds.add(ground.lane.adjacentLaneId);
    }
    for (const successorId of ground.lane.successorLaneIds) {
      groundCaptureIds.add(successorId);
      const successor = cairoRoadNetwork.lanesById.get(successorId);
      if (successor?.adjacentLaneId) {
        groundCaptureIds.add(successor.adjacentLaneId);
      }
    }
    const groundCandidateSegments = cairoRoadNetwork.lanes
      .filter(
        (lane) =>
          lane.maxElevationM < ELEVATED_ROAD_STRUCTURE_THRESHOLD_M ||
          groundCaptureIds.has(lane.id),
      )
      .reduce((sum, lane) => sum + lane.segmentLengths.length, 0);

    cairoRoadNetwork.resetProjectionScanCounters();
    cairoRoadNetwork.projectToRoad(cairoSpawn.x, cairoSpawn.z, {
      heading: cairoSpawn.heading,
      preferredLaneId: ground.lane.id,
      preferredElevationM: 0,
    });
    const groundMetrics = cairoRoadNetwork.getProjectionScanCounters();
    const legacyGroundVisits = totalSegments + groundCandidateSegments;
    expect(groundMetrics).toMatchObject({
      calls: 1,
      preferredCalls: 1,
      compatibleSegmentVisits: groundCandidateSegments,
      globalSegmentVisits: 0,
      selectionSegmentVisits: groundCandidateSegments,
      totalSegmentVisits: groundCandidateSegments * 2,
      raisedFallbackCalls: 0,
    });
    expect(groundMetrics.totalSegmentVisits).toBeLessThan(legacyGroundVisits);

    const ramp = cairoRoadNetwork.lanesById.get(
      "cairo-sixth-october-bridge-dokki-entry-1-forward-1",
    )!;
    const rampPoint = cairoRoadNetwork.pointOnLane(ramp, ramp.length * 0.55);
    const rampCandidateIds = continuityLaneIds(cairoRoadNetwork, ramp);
    const rampCandidateSegments = cairoRoadNetwork.lanes
      .filter((lane) => rampCandidateIds.has(lane.id))
      .reduce((sum, lane) => sum + lane.segmentLengths.length, 0);

    cairoRoadNetwork.resetProjectionScanCounters();
    cairoRoadNetwork.projectToRoad(rampPoint.x, rampPoint.z, {
      heading: rampPoint.heading,
      preferredLaneId: ramp.id,
      preferredElevationM: rampPoint.elevationM ?? 0,
    });
    const lockedRampMetrics = cairoRoadNetwork.getProjectionScanCounters();
    expect(lockedRampMetrics).toMatchObject({
      compatibleSegmentVisits: rampCandidateSegments,
      globalSegmentVisits: 0,
      selectionSegmentVisits: rampCandidateSegments,
      totalSegmentVisits: rampCandidateSegments * 2,
      raisedFallbackCalls: 0,
    });
    expect(lockedRampMetrics.totalSegmentVisits).toBeLessThan(
      totalSegments + rampCandidateSegments,
    );

    cairoRoadNetwork.resetProjectionScanCounters();
    const expectedFallback = cairoOracle.projectToRoad(
      cairoSpawn.x,
      cairoSpawn.z,
      {
        heading: rampPoint.heading,
        preferredLaneId: ramp.id,
        preferredElevationM: rampPoint.elevationM ?? 0,
      },
    );
    const actualFallback = cairoRoadNetwork.projectToRoad(
      cairoSpawn.x,
      cairoSpawn.z,
      {
        heading: rampPoint.heading,
        preferredLaneId: ramp.id,
        preferredElevationM: rampPoint.elevationM ?? 0,
      },
    );
    expect(
      projectionDifference("raised-fallback", expectedFallback, actualFallback),
    ).toBeNull();
    expect(cairoRoadNetwork.getProjectionScanCounters()).toMatchObject({
      compatibleSegmentVisits: rampCandidateSegments,
      globalSegmentVisits: totalSegments,
      selectionSegmentVisits: totalSegments,
      totalSegmentVisits: rampCandidateSegments + totalSegments * 2,
      raisedFallbackCalls: 1,
    });

    cairoRoadNetwork.resetProjectionScanCounters();
    cairoRoadNetwork.projectToRoad(cairoSpawn.x, cairoSpawn.z);
    expect(cairoRoadNetwork.getProjectionScanCounters()).toMatchObject({
      calls: 1,
      plainCalls: 1,
      totalSegmentVisits: totalSegments,
    });
  });

  it("bounds point lookup by logarithmic comparisons on Cairo's longest lane", () => {
    const longest = cairoRoadNetwork.lanes.reduce((best, lane) =>
      lane.segmentLengths.length > best.segmentLengths.length ? lane : best,
    );
    cairoRoadNetwork.resetLanePointSearchCounters();
    for (const distance of [
      0,
      ...longest.segmentEndDistances,
      longest.length / 3,
      (longest.length * 2) / 3,
      longest.length,
    ]) {
      cairoRoadNetwork.pointOnLane(longest, distance);
    }
    const metrics = cairoRoadNetwork.getLanePointSearchCounters();
    expect(metrics.calls).toBe(longest.segmentLengths.length + 4);
    expect(metrics.maxComparisons).toBeLessThanOrEqual(
      Math.ceil(Math.log2(longest.segmentLengths.length)),
    );
    expect(metrics.maxComparisons).toBeLessThan(
      longest.segmentLengths.length,
    );
  });
});
