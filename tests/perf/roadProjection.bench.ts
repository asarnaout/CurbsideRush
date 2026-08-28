/**
 * Paired road-projection microbenchmark. The legacy implementation is the same
 * frozen oracle used by the exhaustive equivalence test, so both algorithms
 * run against one normalized Cairo graph in one process.
 *
 * Run:
 *   npx vitest bench tests/perf/roadProjection.bench.ts --pool=forks --maxWorkers=1
 *
 * Wall-clock output is diagnostic only. Non-flaky scan-count gates live in
 * roadNetworkProjectionEquivalence.test.ts.
 */
import { bench, describe } from "vitest";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
} from "../../app/game/cities/cairo";
import {
  RoadNetwork,
  type RoadProjectionPreference,
} from "../../app/game/simulation/roadNetwork";
import { buildFreeDriveScenario } from "../../app/game/driveScenario";
import { buildSimulationCoreConfig } from "../../app/game/simulationAdapter";
import { LegacyRoadProjectionOracle } from "../helpers/legacyRoadProjectionOracle";

const scenario = buildFreeDriveScenario(CAIRO_FREE_DRIVE);
const config = buildSimulationCoreConfig({
  scenario,
  mapPack: CAIRO_MAP_PACK,
  trafficSide: "right",
  speedUnit: "kmh",
  buildingLayout: {
    mapId: CAIRO_MAP_PACK.id,
    trafficSeed: scenario.trafficSeed,
    buildings: [],
  },
});
const spawn = config.spawn!;
const roadNetwork = new RoadNetwork(config.lanes ?? [], [], []);
const legacy = new LegacyRoadProjectionOracle(roadNetwork.lanes);
const ground = roadNetwork.projectToRoad(spawn.x, spawn.z)!;
const ramp = roadNetwork.lanesById.get(
  "cairo-sixth-october-bridge-dokki-entry-1-forward-1",
)!;
const rampPoint = roadNetwork.pointOnLane(ramp, ramp.length * 0.55);
const longestLane = roadNetwork.lanes.reduce((best, lane) =>
  lane.segmentLengths.length > best.segmentLengths.length ? lane : best,
);

const cases: readonly {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly preference?: RoadProjectionPreference;
}[] = [
  {
    name: "plain-ground",
    x: spawn.x,
    z: spawn.z,
  },
  {
    name: "preferred-ground",
    x: spawn.x,
    z: spawn.z,
    preference: {
      heading: spawn.heading,
      preferredLaneId: ground.lane.id,
      preferredElevationM: 0,
    },
  },
  {
    name: "preferred-raised-ramp",
    x: rampPoint.x,
    z: rampPoint.z,
    preference: {
      heading: rampPoint.heading,
      preferredLaneId: ramp.id,
      preferredElevationM: rampPoint.elevationM ?? 0,
    },
  },
  {
    name: "detached-raised-fallback",
    x: spawn.x,
    z: spawn.z,
    preference: {
      heading: rampPoint.heading,
      preferredLaneId: ramp.id,
      preferredElevationM: rampPoint.elevationM ?? 0,
    },
  },
];

describe("Cairo road projection — paired legacy/current", () => {
  for (const sample of cases) {
    bench(`legacy/${sample.name}`, () => {
      legacy.projectToRoad(
        sample.x,
        sample.z,
        sample.preference,
      );
    });
    bench(`current/${sample.name}`, () => {
      roadNetwork.projectToRoad(
        sample.x,
        sample.z,
        sample.preference,
      );
    });
  }

  bench("legacy/point-on-longest-lane-end", () => {
    void legacy.pointOnLane(longestLane, longestLane.length);
  });
  bench("current/point-on-longest-lane-end", () => {
    void roadNetwork.pointOnLane(longestLane, longestLane.length);
  });
  bench("legacy/point-on-every-lane-75pct", () => {
    for (const lane of roadNetwork.lanes) {
      void legacy.pointOnLane(lane, lane.length * 0.75);
    }
  });
  bench("current/point-on-every-lane-75pct", () => {
    for (const lane of roadNetwork.lanes) {
      void roadNetwork.pointOnLane(lane, lane.length * 0.75);
    }
  });
});
