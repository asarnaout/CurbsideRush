import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { SimulationCore } from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  resolveSimulationStartPose,
} from "../app/game/simulationAdapter";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import type { GameCanvasLesson } from "../app/game/GameCanvas";
import type { FreeDriveDefinition } from "../app/game/types";

// Lessons were removed in the gig overhaul, so the adapter now only ever
// receives free drives — the same contract SideSwapApp assembles for an
// open-world session.
const freeDriveLesson = (freeDrive: FreeDriveDefinition): GameCanvasLesson =>
  buildFreeDriveLesson(
    freeDrive,
    getCountryProfile(freeDrive.countryId).trafficSide,
  );

const canvasSpeedUnit = (freeDrive: FreeDriveDefinition) =>
  getCountryProfile(freeDrive.countryId).speedUnit === "kmh" ? "km/h" : "mph";

describe("simulation runtime adapter (free-roam)", () => {
  it("spawns each city drive on its authored player lane, on-lane and legal", () => {
    for (const freeDrive of FREE_DRIVES) {
      const lesson = freeDriveLesson(freeDrive);
      const mapPack = getMapPack(freeDrive.mapId);
      const start = resolveSimulationStartPose(
        lesson,
        mapPack,
        lesson.trafficSide,
      );
      const config = buildSimulationCoreConfig({
        lesson,
        mapPack,
        trafficSide: lesson.trafficSide,
        speedUnit: canvasSpeedUnit(freeDrive),
      });

      expect(config.spawn, freeDrive.id).toEqual({
        x: start.x,
        z: start.z,
        heading: start.heading,
      });
      expect((config.lanes ?? []).length, freeDrive.id).toBeGreaterThan(0);
      // Free drives carry no route guidance and no forced finish line.
      expect(config.routeGuidance, freeDrive.id).toEqual([]);
      expect(config.finish, freeDrive.id).toBeNull();

      const snapshot = new SimulationCore(config).getSnapshot();
      expect(snapshot.road.wrongWay, freeDrive.id).toBe(false);
      expect(snapshot.road.offRoad, freeDrive.id).toBe(false);
    }
  });

  it("hands the HUD back the number on the sign, in the country's own unit", () => {
    // The round trip nothing used to assert: an authored figure is in the host
    // country's unit, the adapter converts it to m/s, and the core converts it
    // back for the readout. Those two conversions have to agree, and the only
    // thing telling either of them which unit to use is the country profile.
    //
    // `roadRealism.test.ts` cannot catch a mixup here on its own: its mph and
    // km/h posted-figure lists overlap on {20,30,40,50,60,70}, which is every
    // figure Tokyo and Cairo post — so a metric city quietly read as imperial
    // would pass it. This is the test that fails instead.
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const lesson = freeDriveLesson(freeDrive);
      const snapshot = new SimulationCore(
        buildSimulationCoreConfig({
          lesson,
          mapPack,
          trafficSide: lesson.trafficSide,
          speedUnit: canvasSpeedUnit(freeDrive),
        }),
      ).getSnapshot();

      expect(snapshot.speedUnit, freeDrive.id).toBe(country.speedUnit);
      const laneId = snapshot.road.laneId;
      expect(laneId, `${freeDrive.id} spawns off-lane`).not.toBeNull();
      const authored = mapPack.laneGraph.lanes.find((lane) => lane.id === laneId);
      expect(authored, `${freeDrive.id}/${laneId}`).toBeDefined();
      expect(
        snapshot.road.speedLimitDisplay,
        `${freeDrive.id} posts ${authored!.speedLimit} ${country.speedUnit} but reads back as ${snapshot.road.speedLimitDisplay}`,
      ).toBe(authored!.speedLimit);
    }
  });

  it("keeps a stationary player safe from authored traffic in every city", () => {
    for (const freeDrive of FREE_DRIVES) {
      const mapPack = getMapPack(freeDrive.mapId);
      const lesson = freeDriveLesson(freeDrive);
      const simulation = new SimulationCore(
        buildSimulationCoreConfig({
          lesson,
          mapPack,
          trafficSide: lesson.trafficSide,
          speedUnit: canvasSpeedUnit(freeDrive),
        }),
      );
      for (let tick = 0; tick < 60 * 15; tick += 1) {
        simulation.step(1 / 60);
      }
      const snapshot = simulation.getSnapshot();
      expect(
        snapshot.activeIncident,
        `${freeDrive.id} caused an incident while the player remained stationary`,
      ).toBeNull();
      expect(snapshot.status).toBe("running");
    }
  });

  it("carries Cromwell Road's bus lane through the Exhibition Road signal", () => {
    // The bus lane used to dead-end at the junction, so `advanceNpcAlongLegalRoute`
    // recycled the double-decker the moment the light went green and it popped
    // out of existence in front of the player (#128).
    const BUS_LANE_ID = "london-cromwell-east-bus";
    const CONTINUATION_LANE_IDS = new Set([
      "london-cromwell-east-2",
      "london-exhibition-shared-1",
    ]);
    const freeDrive = FREE_DRIVES.find(
      (candidate) => candidate.mapId === "london-south-kensington",
    );
    expect(freeDrive).toBeDefined();
    if (!freeDrive) return;
    const lesson = freeDriveLesson(freeDrive);
    const simulation = new SimulationCore(
      buildSimulationCoreConfig({
        lesson,
        mapPack: getMapPack(freeDrive.mapId),
        trafficSide: lesson.trafficSide,
        speedUnit: canvasSpeedUnit(freeDrive),
      }),
    );

    const vanished: string[] = [];
    let continuations = 0;
    let previousLaneIds = new Map<string, string>();
    for (let tick = 0; tick < 60 * 120; tick += 1) {
      simulation.step(1 / 60);
      const laneIds = new Map(
        simulation.getSnapshot().npcs.map((npc) => [npc.id, npc.laneId]),
      );
      for (const [npcId, laneId] of previousLaneIds) {
        if (laneId !== BUS_LANE_ID) continue;
        const current = laneIds.get(npcId);
        if (current === undefined) {
          vanished.push(`${npcId} vanished out of the bus lane at tick ${tick}`);
        } else if (CONTINUATION_LANE_IDS.has(current)) {
          continuations += 1;
        }
      }
      previousLaneIds = laneIds;
    }

    expect(vanished).toEqual([]);
    expect(continuations).toBeGreaterThan(0);
  });

  it("names a signal's lights after its approaches, which is how a camera knows the junction it watches", () => {
    // A red-light camera resolves the junction by id rather than by distance:
    // `checkStopLines` puts the stop line's `trafficLightId` into the event's
    // evidence, and GameCanvas looks that up in a map it built from
    // `control.approaches[].id`. Nothing else pins those two to each other, and
    // if they drift the cameras stop firing for red lights *silently* — no
    // throw, no failing render, just a rule that never charges.
    let signalControls = 0;
    for (const freeDrive of FREE_DRIVES) {
      const lesson = freeDriveLesson(freeDrive);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        lesson,
        mapPack,
        trafficSide: lesson.trafficSide,
        speedUnit: canvasSpeedUnit(freeDrive),
      });
      const lightIds = new Set((config.trafficLights ?? []).map((light) => light.id));
      for (const control of mapPack.laneGraph.controls) {
        if (control.type !== "signal") continue;
        signalControls += 1;
        const approachIds = control.approaches.map((approach) => approach.id);
        expect(approachIds.length, `${control.id} approaches`).toBeGreaterThan(0);
        for (const approachId of approachIds) {
          expect(lightIds, `${mapPack.id}/${approachId} is a light`).toContain(
            approachId,
          );
        }
        // …and every stop line under that control cites one of them.
        const lines = (config.stopLines ?? []).filter((line) =>
          approachIds.some((id) => line.id.startsWith(`${id}-`)),
        );
        expect(lines.length, `${control.id} stop lines`).toBeGreaterThan(0);
        for (const line of lines) {
          expect(approachIds, `${line.id} cites ${line.trafficLightId}`).toContain(
            line.trafficLightId,
          );
        }
      }
    }
    expect(signalControls).toBeGreaterThan(0);
  });
});
