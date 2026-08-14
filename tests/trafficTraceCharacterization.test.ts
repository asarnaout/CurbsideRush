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
      // scenario's twelve cars to its own thirty-two — then Serpentine Road
      // through the royal park (with its Serpentine bridge) and the four-road
      // Notting Hill grid, which added ~30 lanes and reshaped the successor
      // sets at six junctions — then three more double-decker gates on the
      // high streets (append-only, but three more named gates shift every
      // later NPC's gate assignment; the first cut duplicated two existing
      // gate ids and phased a 1.999 m graze into the acceptance replay, so
      // the final gates run Oxford east / Bishopsgate / King's Road plus a
      // Notting Hill cab — the fourth gate's count change re-deals the
      // recycler and is what actually dissolved the graze).
      "free-uk-london": "e57b53ee",
      // Moves on any sim-visible Tokyo content change: Phase 2 of the Tokyo
      // expansion (road-network skeleton + all three residential-web
      // districts) takes the map from 20 to 66 roads and 56 to 338 lanes,
      // adds ~93 generated stop controls across the new junctions, and sets
      // `ambientTraffic: { desktop: 32, touch: 16 }` (previously unset, so
      // ambient car count itself changes) — any one of those alone would
      // move this hash; all of them together do. Phase 3 (river, three
      // bridges, east-bank web) adds 79-66=13 more roads, more generated stop
      // controls at the new junctions, and five new vehicle spawns (three on
      // the bridges themselves, one on the east-bank spine, one on the
      // east-bank riverside collector) — every one of those shifts ambient
      // routing even in the old quarter, since the seeded spawn-anchor order
      // changed. Phase 4 (blocks/street wall) added no lanes/controls/spawns
      // and did not move this hash. Phase 5 (signals/cameras/one-ways/
      // crossings/rail) does: 42 nodes that used to derive a `type: "stop"`
      // control now derive a `type: "signal"` one instead (real red/amber/
      // green phase cycles now gate NPCs there instead of a stop-and-go
      // priority rule), 4 new crosswalk controls were authored, and a second
      // `railway_signal` level crossing joins the original one.
      // `snapshot.trafficLights` — hashed by this test — goes from 2 entries
      // (the original jp-rail-signal's own two approaches; Tokyo had zero
      // `type: "signal"` controls before Phase 5) to 136 (133 signal
      // approaches + 3 railway_signal approaches across both crossings). The
      // same phase's 12 residential one-ways (R11, 4 per web, `laneCount: 1`)
      // move it again: `snapshot.npcs` hashes each car's `laneId`, and a
      // road that used to carry two directions of ambient traffic now
      // carries only one — real routing/spawn-distribution change, not
      // noise.
      "free-jp": "49c638c6",
      "free-eg": "eb350f99",
    });
  });
});
