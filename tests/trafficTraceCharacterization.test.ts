import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationSnapshot,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";

const TRACE_SECONDS = 30;
const TRACE_TICKS = TRACE_SECONDS * 60;
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const FLOAT_PRECISION = 10_000;

const mixInteger = (hash: number, value: number): number =>
  Math.imul(hash ^ (value | 0), FNV_PRIME) >>> 0;

const mixString = (hash: number, value: string): number => {
  let result = mixInteger(hash, value.length);
  for (let index = 0; index < value.length; index += 1) {
    result = mixInteger(result, value.charCodeAt(index));
  }
  return result;
};

const mixFloat = (hash: number, value: number): number =>
  mixInteger(hash, Math.round(value * FLOAT_PRECISION));

/**
 * Deliberately hashes only the live traffic model. Curriculum progress, route
 * guidance, scoring, checkpoints, coaching, and completion state are omitted
 * so their removal cannot legitimize an ambient-traffic behavior change.
 */
const mixTrafficSnapshot = (
  hash: number,
  snapshot: SimulationSnapshot,
): number => {
  let result = mixInteger(hash, snapshot.npcs.length);
  result = mixInteger(result, snapshot.queuedNpcCount);
  for (const npc of snapshot.npcs) {
    result = mixString(result, npc.id);
    result = mixString(result, npc.laneId);
    result = mixString(result, npc.variant);
    result = mixFloat(result, npc.x);
    result = mixFloat(result, npc.z);
    result = mixFloat(result, npc.heading);
    result = mixFloat(result, npc.speedMps);
    result = mixString(result, npc.state);
    result = mixString(result, npc.signal);
    result = mixInteger(result, npc.honking ? 1 : 0);
  }

  result = mixInteger(result, snapshot.trafficLights.length);
  for (const light of snapshot.trafficLights) {
    result = mixString(result, light.id);
    result = mixString(result, light.state);
    result = mixFloat(result, light.secondsUntilChange);
  }
  return result;
};

const trafficTraceHash = (freeDrive: (typeof FREE_DRIVES)[number]): string => {
  const country = getCountryProfile(freeDrive.countryId);
  const scenario = buildFreeDriveScenario(freeDrive);
  const simulation = new SimulationCore(
    buildSimulationCoreConfig({
      scenario,
      mapPack: getMapPack(freeDrive.mapId),
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    }),
  );
  let hash = mixTrafficSnapshot(FNV_OFFSET_BASIS, simulation.getSnapshot());
  for (let tick = 0; tick < TRACE_TICKS; tick += 1) {
    hash = mixTrafficSnapshot(hash, simulation.step(FIXED_STEP_SECONDS));
  }
  simulation.dispose();
  return hash.toString(16).padStart(8, "0");
};

describe("ambient traffic trace characterization", () => {
  it("preserves the authored 30-second traffic trace in all four cities", () => {
    expect(
      Object.fromEntries(
        FREE_DRIVES.map((freeDrive) => [
          freeDrive.id,
          trafficTraceHash(freeDrive),
        ]),
      ),
    ).toEqual({
      "free-us": "ea720991",
      // Moves on any sim-visible London content change: the south-west
      // expansion (fourteen streets, three signals, both turning loops gone),
      // then the river (both embankments, the south bank, three bridges and
      // four more signals), then Sloane Circus and its three give-ways, then
      // the West End with two more roundabouts and a signalled gyratory, then
      // the City — which also took London's ambient traffic from the
      // scenario's twelve cars to its own thirty-two.
      "free-uk-london": "69618e84",
      "free-jp": "997675a9",
      "free-eg": "eb350f99",
    });
  });
});
