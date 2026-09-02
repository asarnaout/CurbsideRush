import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { SimulationCore } from "../app/game/simulation";
import {
  AMBIENT_VEHICLE_SLOT_CEILING,
  normalizeAmbientVehicleSlotCount,
} from "../app/game/simulation/ambientTraffic";
import {
  buildSimulationCoreConfig,
  buildRuntimeTrafficPortals,
  buildTrafficGates,
  resolveSimulationLaneAnchor,
  resolveAmbientVehicleCount,
  resolveSimulationStartPose,
} from "../app/game/simulationAdapter";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  NYC_QUEENSVIEW_DECK_ELEVATION_M,
  NYC_QUEENSVIEW_NETWORK_PREFIX,
} from "../app/game/cities/nycElevatedRoadNetwork";
import type {
  DriveScenario,
  GameCanvasMapPack,
} from "../app/game/sessionContract";

describe("simulation runtime adapter (free-roam)", () => {
  it("spawns each city drive on its authored player lane, on-lane and legal", () => {
    for (const freeDrive of FREE_DRIVES) {
      const scenario = buildFreeDriveScenario(freeDrive);
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const start = resolveSimulationStartPose(scenario, mapPack);
      const config = buildSimulationCoreConfig({
        scenario,
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      });

      expect(config.spawn, freeDrive.id).toEqual({
        x: start.x,
        z: start.z,
        ...(start.elevationM !== undefined
          ? { elevationM: start.elevationM }
          : {}),
        heading: start.heading,
      });
      expect((config.lanes ?? []).length, freeDrive.id).toBeGreaterThan(0);

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
      const scenario = buildFreeDriveScenario(freeDrive);
      const snapshot = new SimulationCore(
        buildSimulationCoreConfig({
          scenario,
          mapPack,
          trafficSide: country.trafficSide,
          speedUnit: country.speedUnit,
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
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const scenario = buildFreeDriveScenario(freeDrive);
      const simulation = new SimulationCore(
        buildSimulationCoreConfig({
          scenario,
          mapPack,
          trafficSide: country.trafficSide,
          speedUnit: country.speedUnit,
        }),
      );
      for (let tick = 0; tick < 60 * 15; tick += 1) {
        simulation.step(1 / 60);
      }
      const snapshot = simulation.getSnapshot();
      expect(
        simulation.getEvents().some((event) => event.code === "collision"),
        `${freeDrive.id} recorded a collision while the player remained stationary`,
      ).toBe(false);
      expect(snapshot.status).toBe("running");
    }
  });

  it("tracks every Cairo ramp profile without dropping onto an overlapping ground road", () => {
    const freeDrive = FREE_DRIVES.find(
      (candidate) => candidate.mapId === "cairo-central-nile",
    )!;
    const country = getCountryProfile(freeDrive.countryId);
    const mapPack = getMapPack(freeDrive.mapId);
    const scenario = buildFreeDriveScenario(freeDrive);
    const baseConfig = buildSimulationCoreConfig({
      scenario,
      mapPack,
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    });
    // Derive this inventory from production geometry. A hand-maintained list
    // previously claimed to cover every ramp while silently omitting both
    // terminals and several direction-specific entry/exit grades.
    const elevatedRoadIds = mapPack.geometry.roadSurfaces
      .filter(
        (surface) =>
          surface.id.startsWith("cairo-sixth-october") &&
          surface.centerline.some((point) => (point.elevationM ?? 0) >= 0.75),
      )
      .map((surface) => surface.id);

    expect(elevatedRoadIds).toHaveLength(18);

    for (const roadId of elevatedRoadIds) {
      for (const direction of ["forward", "reverse"] as const) {
        const lanes = mapPack.laneGraph.lanes
          .filter(
            (lane) =>
              lane.roadId === roadId &&
              lane.id.endsWith(`-${direction}-1`),
          )
          .sort((left, right) => {
            const segmentOf = (id: string) =>
              Number(id.slice(roadId.length + 1).split("-")[0]);
            const difference = segmentOf(left.id) - segmentOf(right.id);
            return direction === "forward" ? difference : -difference;
          });
        if (lanes.length === 0) continue;

        const authoredPath = lanes.flatMap((lane, laneIndex) =>
          lane.centerline.slice(laneIndex === 0 ? 0 : 1),
        );
        const path = [authoredPath[0]];
        for (let pointIndex = 1; pointIndex < authoredPath.length; pointIndex += 1) {
          const start = authoredPath[pointIndex - 1];
          const end = authoredPath[pointIndex];
          const horizontalM = Math.hypot(end.x - start.x, end.z - start.z);
          const verticalM = Math.abs((end.elevationM ?? 0) - (start.elevationM ?? 0));
          const steps = Math.max(1, Math.ceil(horizontalM / 2), Math.ceil(verticalM / 0.2));
          for (let step = 1; step <= steps; step += 1) {
            const amount = step / steps;
            const elevationM =
              (start.elevationM ?? 0) +
              ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
            path.push({
              x: start.x + (end.x - start.x) * amount,
              z: start.z + (end.z - start.z) * amount,
              ...(elevationM > 0 ? { elevationM } : {}),
            });
          }
        }
        const simulation = new SimulationCore({ ...baseConfig, npcCount: 0 });
        // This test deliberately teleports onto an authored 3D profile rather
        // than entering through its approach lane, so make the starting zero
        // explicit. Live driving is stricter and may acquire a rising profile
        // only through lane-graph continuity.
        let carriedElevationM = path[0].elevationM ?? 0;
        for (let index = 0; index < path.length; index += 1) {
          const point = path[index];
          const next = path[Math.min(index + 1, path.length - 1)];
          const previous = path[Math.max(0, index - 1)];
          const tangent = index + 1 < path.length
            ? { x: next.x - point.x, z: next.z - point.z }
            : { x: point.x - previous.x, z: point.z - previous.z };
          simulation.setPlayerPose(
            {
              x: point.x,
              z: point.z,
              elevationM: carriedElevationM,
              heading: Math.atan2(tangent.x, tangent.z),
            },
            5,
          );
          const snapshot = simulation.getSnapshot();
          const expectedElevationM = point.elevationM ?? 0;
          if (expectedElevationM >= 0.75) {
            expect(snapshot.road.laneId, `${roadId}/${direction}/${index}`).toContain(
              roadId,
            );
            expect(
              snapshot.player.elevationM ?? 0,
              `${roadId}/${direction}/${index}`,
            ).toBeCloseTo(expectedElevationM, 1);
          }
          carriedElevationM = snapshot.player.elevationM ?? 0;
        }
      }
    }
  });

  it("keeps the Dokki entrance clear through the shared elevated braid", () => {
    const freeDrive = FREE_DRIVES.find(
      (candidate) => candidate.mapId === "cairo-central-nile",
    )!;
    const country = getCountryProfile(freeDrive.countryId);
    const mapPack = getMapPack(freeDrive.mapId);
    const scenario = buildFreeDriveScenario(freeDrive);
    const simulation = new SimulationCore({
      ...buildSimulationCoreConfig({
        scenario,
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      }),
      npcCount: 0,
    });
    const entry = mapPack.geometry.roadSurfaces.find(
      (surface) =>
        surface.id === "cairo-sixth-october-bridge-dokki-entry",
    )!;
    const start = entry.centerline.at(-2)!;
    const merge = entry.centerline.at(-1)!;
    const heading = Math.atan2(merge.x - start.x, merge.z - start.z);

    simulation.setPlayerPose(
      {
        x: start.x,
        z: start.z,
        elevationM: start.elevationM,
        heading,
      },
      5,
    );
    // Run far enough to cross the shared mouth onto the carrier. Continuing
    // this fixed steering angle for three seconds is no longer meaningful:
    // the rebuilt carrier is a real curve, so a driver who never follows it
    // should eventually meet its correctly placed outside parapet.
    for (let tick = 0; tick < 120; tick += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }

    const deckCollision = simulation
      .getEvents()
      .find(
        (event) =>
          event.code === "collision" &&
          (event.evidence.obstacle === "roadDeck" ||
            event.evidence.obstacle === "roadBarrier"),
      );
    expect(deckCollision).toBeUndefined();
    expect(simulation.getSnapshot().road.laneId).toBe(
      "cairo-sixth-october-bridge-dokki-ramp-2-reverse-1",
    );
    expect(simulation.getSnapshot().player.z).toBeLessThan(400);
  });

  it("keeps the real Cairo underpass path on the ground beyond the old 12 m cutoff", () => {
    const freeDrive = FREE_DRIVES.find(
      (candidate) => candidate.mapId === "cairo-central-nile",
    )!;
    const country = getCountryProfile(freeDrive.countryId);
    const mapPack = getMapPack(freeDrive.mapId);
    const scenario = buildFreeDriveScenario(freeDrive);
    const simulation = new SimulationCore({
      ...buildSimulationCoreConfig({
        scenario,
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      }),
      npcCount: 0,
      staticObstacles: [],
    });
    const heading = 1.675507183;
    const beneathMainlineZ = (x: number) =>
      237.91 + ((193.77 - 237.91) * (x - 100)) / 420;

    simulation.setPlayerPose(
      { x: 317, z: beneathMainlineZ(317), elevationM: 0, heading },
      0,
    );
    for (let x = 318; x <= 416; x += 2) {
      simulation.setPlayerPose(
        { x, z: beneathMainlineZ(x), heading },
        4,
      );
      const snapshot = simulation.getSnapshot();
      expect(snapshot.player.elevationM, `x=${x}`).toBeUndefined();
      expect(snapshot.road.laneId ?? "", `x=${x}`).not.toMatch(
        /^cairo-sixth-october/,
      );
    }

    // This point sat directly below the deck but more than 12 m from the
    // nearest ground lane. It previously initialized at 10.5 m immediately.
    simulation.setPlayerPose(
      { x: 415.09, z: 203.14, elevationM: 0, heading },
      0,
    );
    const underDeck = simulation.getSnapshot();
    expect(underDeck.player.elevationM).toBeUndefined();
    expect(underDeck.road.laneId ?? "").not.toMatch(/^cairo-sixth-october/);
    expect(underDeck.road.offRoad).toBe(true);

    // Al-Galaa reproduces the exact threshold edge behind the airborne bug:
    // at z=308.25 the carried ground lane was 11.90 m away; one 25 cm move
    // made it 12.15 m away and the old code selected a deck only 2.15 m away.
    simulation.setPlayerPose(
      { x: -500, z: 309, elevationM: 0, heading: Math.PI },
      0,
    );
    for (let z = 308.75; z >= 307.25; z -= 0.25) {
      simulation.setPlayerPose({ x: -500, z, heading: Math.PI }, 4);
      const snapshot = simulation.getSnapshot();
      expect(snapshot.player.elevationM, `Al-Galaa z=${z}`).toBeUndefined();
      expect(snapshot.road.laneId ?? "", `Al-Galaa z=${z}`).not.toMatch(
        /^cairo-sixth-october/,
      );
    }

    // Follow Dokki's through street through the exact overlap where the old
    // projection walked backwards through the exit topology and then climbed
    // the ramp to more than 5 m without the car entering an on-ramp.
    const dokkiHeading = 3.0438640689482375;
    const dokkiX = (z: number) =>
      -628.105275 + (505 - z) * 0.098041;
    simulation.setPlayerPose(
      { x: dokkiX(512), z: 512, elevationM: 0, heading: dokkiHeading },
      0,
    );
    for (let z = 511; z >= 440; z -= 1) {
      simulation.setPlayerPose(
        { x: dokkiX(z), z, heading: dokkiHeading },
        4,
      );
      const snapshot = simulation.getSnapshot();
      expect(snapshot.player.elevationM, `Dokki z=${z}`).toBeUndefined();
      expect(snapshot.road.laneId ?? "", `Dokki z=${z}`).not.toContain(
        "bridge-dokki-ramp",
      );
    }

    // The rebuilt directed entrance remains functional: the auxiliary slip
    // owns its own lane beside Al Dokki Street, then hands directly to the
    // separate one-way rising structure without snapping back to the host.
    const entrySlipLane = mapPack.laneGraph.lanes.find(
      (lane) =>
        lane.id === "cairo-sixth-october-dokki-entry-slip-2-forward-1",
    )!;
    const entrySlipPointIndex = Math.floor(entrySlipLane.centerline.length * 0.65);
    const entrySlipPoint = entrySlipLane.centerline[entrySlipPointIndex];
    const entrySlipNext = entrySlipLane.centerline[entrySlipPointIndex + 1];
    const entryHeading = Math.atan2(
      entrySlipNext.x - entrySlipPoint.x,
      entrySlipNext.z - entrySlipPoint.z,
    );
    simulation.setPlayerPose(
      {
        x: entrySlipPoint.x,
        z: entrySlipPoint.z,
        elevationM: 0,
        heading: entryHeading,
      },
      0,
    );
    expect(simulation.getSnapshot().road.laneId).toBe(
      "cairo-sixth-october-dokki-entry-slip-2-forward-1",
    );
    const entryRampLane = mapPack.laneGraph.lanes.find(
      (lane) =>
        lane.id ===
        "cairo-sixth-october-bridge-dokki-entry-1-forward-1",
    )!;
    // Curved roads are adaptively sampled, so no particular array index is a
    // stable physical station. Select the first genuinely rising sample that
    // still has a successor chord instead.
    const entryRampPointIndex = entryRampLane.centerline.findIndex(
      (point, index) =>
        index + 1 < entryRampLane.centerline.length &&
        (point.elevationM ?? 0) >= 0.2,
    );
    expect(entryRampPointIndex).toBeGreaterThan(0);
    const entryRampPoint = entryRampLane.centerline[entryRampPointIndex];
    const entryRampNext = entryRampLane.centerline[entryRampPointIndex + 1];
    simulation.setPlayerPose(
      {
        x: entryRampPoint.x,
        z: entryRampPoint.z,
        heading: Math.atan2(
          entryRampNext.x - entryRampPoint.x,
          entryRampNext.z - entryRampPoint.z,
        ),
      },
      4,
    );
    const onRamp = simulation.getSnapshot();
    expect(onRamp.road.laneId).toBe(
      "cairo-sixth-october-bridge-dokki-entry-1-forward-1",
    );
    expect(onRamp.player.elevationM).toBeGreaterThan(0);
    expect(onRamp.player.elevationM).toBeLessThan(0.5);
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
    const country = getCountryProfile(freeDrive.countryId);
    const scenario = buildFreeDriveScenario(freeDrive);
    const productionConfig = buildSimulationCoreConfig({
      scenario,
      mapPack: getMapPack(freeDrive.mapId),
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    });
    // Exercise the production London lane graph directly. Local streaming is
    // intentionally disabled in this narrow route-continuity regression: a
    // changing neighbourhood population must not decide whether the one bus
    // needed by this assertion happens to visit its authored lane in 120 s.
    const simulation = new SimulationCore({
      ...productionConfig,
      npcCount: 1,
      spawn: { x: 1_000, z: 850, heading: 0 },
      trafficGates: [{
        id: "london-red-bus-route-regression",
        laneId: BUS_LANE_ID,
        distance: 68,
        variant: "bus",
      }],
      runtimeTrafficPortals: [],
      trafficCapacityLaneIds: [],
    });

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
      const country = getCountryProfile(freeDrive.countryId);
      const scenario = buildFreeDriveScenario(freeDrive);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario,
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
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

  describe("authored player start validation", () => {
    const freeDrive = FREE_DRIVES[0];
    const baseScenario = buildFreeDriveScenario(freeDrive);
    const baseMap = getMapPack(freeDrive.mapId);
    type SpawnPoint = GameCanvasMapPack["laneGraph"]["spawnPoints"][number];

    const scenarioWithStart = (startSpawnId: string): DriveScenario => ({
      ...baseScenario,
      startSpawnId,
    });
    const mapWith = (
      spawn: SpawnPoint,
      lanes = baseMap.laneGraph.lanes,
    ): GameCanvasMapPack => ({
      ...baseMap,
      laneGraph: {
        ...baseMap.laneGraph,
        lanes,
        spawnPoints: [spawn, ...baseMap.laneGraph.spawnPoints],
      },
    });

    it("requires both a scenario and map data", () => {
      expect(() =>
        resolveSimulationStartPose(
          undefined as unknown as DriveScenario,
          baseMap,
        ),
      ).toThrow(/drive scenario is required/i);
      expect(() =>
        resolveSimulationStartPose(
          baseScenario,
          undefined as unknown as GameCanvasMapPack,
        ),
      ).toThrow(/requires map data/i);
    });

    it("rejects an empty authored start id", () => {
      expect(() =>
        resolveSimulationStartPose(scenarioWithStart("  "), baseMap),
      ).toThrow(/missing an authored start spawn id/i);
    });

    it("rejects a missing start id instead of selecting a fallback", () => {
      expect(() =>
        resolveSimulationStartPose(scenarioWithStart("missing-start"), baseMap),
      ).toThrow(/missing start spawn "missing-start"/i);
    });

    it("rejects a matching non-player spawn", () => {
      const spawn: SpawnPoint = {
        id: "pedestrian-start",
        kind: "pedestrian",
        pose: { position: { x: 0, z: 0 }, headingDeg: 0 },
      };
      expect(() =>
        resolveSimulationStartPose(
          scenarioWithStart(spawn.id),
          mapWith(spawn),
        ),
      ).toThrow(/not a player spawn/i);
    });

    it("rejects an invalid authored anchor", () => {
      const spawn: SpawnPoint = {
        id: "invalid-anchor-start",
        kind: "player",
        anchor: {
          laneId: baseMap.laneGraph.lanes[0].id,
          distanceAlongM: Number.NaN,
        },
      };
      expect(() =>
        resolveSimulationStartPose(
          scenarioWithStart(spawn.id),
          mapWith(spawn),
        ),
      ).toThrow(/invalid lane anchor/i);
    });

    it("rejects an anchor whose lane does not exist", () => {
      const spawn: SpawnPoint = {
        id: "missing-lane-start",
        kind: "player",
        anchor: { laneId: "missing-lane", distanceAlongM: 0 },
      };
      expect(() =>
        resolveSimulationStartPose(
          scenarioWithStart(spawn.id),
          mapWith(spawn),
        ),
      ).toThrow(/references missing lane "missing-lane"/i);
    });

    it("rejects an invalid authored lane", () => {
      const invalidLane = {
        ...baseMap.laneGraph.lanes[0],
        id: "invalid-start-lane",
        centerline: [{ x: 0, z: 0 }],
      };
      const spawn: SpawnPoint = {
        id: "invalid-lane-start",
        kind: "player",
        anchor: { laneId: invalidLane.id, distanceAlongM: 0 },
      };
      expect(() =>
        resolveSimulationStartPose(
          scenarioWithStart(spawn.id),
          mapWith(spawn, [invalidLane, ...baseMap.laneGraph.lanes]),
        ),
      ).toThrow(/references invalid lane "invalid-start-lane"/i);
    });

    it("rejects an authored anchor that cannot be resolved", () => {
      const unresolvedLane = {
        ...baseMap.laneGraph.lanes[0],
        id: "unresolved-start-lane",
        centerline: [
          { x: 4, z: 7 },
          { x: 4, z: 7 },
        ],
      };
      const spawn: SpawnPoint = {
        id: "unresolved-anchor-start",
        kind: "player",
        anchor: { laneId: unresolvedLane.id, distanceAlongM: 0 },
      };
      expect(() =>
        resolveSimulationStartPose(
          scenarioWithStart(spawn.id),
          mapWith(spawn, [unresolvedLane, ...baseMap.laneGraph.lanes]),
        ),
      ).toThrow(/could not resolve authored start anchor/i);
    });

    it("preserves an authored elevated start through the runtime adapter", () => {
      const groundLane = baseMap.laneGraph.lanes[0];
      const elevatedLane = {
        ...groundLane,
        id: "elevated-player-start-lane",
        roadId: "elevated-player-start-road",
        centerline: groundLane.centerline.map((point) => ({
          x: point.x,
          z: point.z,
          elevationM: 6,
        })),
        successors: [],
      };
      const spawn: SpawnPoint = {
        id: "elevated-player-start",
        kind: "player",
        anchor: { laneId: elevatedLane.id, distanceAlongM: 1 },
      };
      const map = mapWith(spawn, [elevatedLane, ...baseMap.laneGraph.lanes]);
      const scenario = scenarioWithStart(spawn.id);
      const country = getCountryProfile(freeDrive.countryId);
      const start = resolveSimulationStartPose(scenario, map);
      const config = buildSimulationCoreConfig({
        scenario,
        mapPack: map,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      });

      expect(start.elevationM).toBe(6);
      expect(config.spawn?.elevationM).toBe(6);
      const snapshot = new SimulationCore({ ...config, npcCount: 0 }).getSnapshot();
      expect(snapshot.player.elevationM).toBe(6);
      expect(snapshot.road.laneId).toBe(elevatedLane.id);
      expect(snapshot.road.offRoad).toBe(false);
    });
  });
});

describe("ambient vehicle slot budget", () => {
  it("normalizes finite counts into the shared production slot range", () => {
    expect(AMBIENT_VEHICLE_SLOT_CEILING).toBe(32);
    expect(normalizeAmbientVehicleSlotCount(12.9)).toBe(12);
    expect(normalizeAmbientVehicleSlotCount(-0.9)).toBe(0);
    expect(normalizeAmbientVehicleSlotCount(AMBIENT_VEHICLE_SLOT_CEILING + 1)).toBe(
      AMBIENT_VEHICLE_SLOT_CEILING,
    );
    expect(normalizeAmbientVehicleSlotCount(Number.NaN)).toBe(0);
    expect(normalizeAmbientVehicleSlotCount(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("resolves every shipped map override for desktop and touch", () => {
    for (const freeDrive of FREE_DRIVES) {
      const mapPack = getMapPack(freeDrive.mapId);
      const scenario = buildFreeDriveScenario(freeDrive);
      expect(
        resolveAmbientVehicleCount(mapPack, scenario.trafficDensity, false),
        `${freeDrive.id} desktop`,
      ).toBe(32);
      expect(
        resolveAmbientVehicleCount(mapPack, scenario.trafficDensity, true),
        `${freeDrive.id} touch`,
      ).toBe(16);
    }
  });

  it("uses the density bands when a map has no explicit traffic budget", () => {
    const mapWithoutOverride = {};
    expect(resolveAmbientVehicleCount(mapWithoutOverride, "none", false)).toBe(0);
    expect(resolveAmbientVehicleCount(mapWithoutOverride, "light", false)).toBe(6);
    expect(resolveAmbientVehicleCount(mapWithoutOverride, "moderate", false)).toBe(12);
    expect(resolveAmbientVehicleCount(mapWithoutOverride, "busy", false)).toBe(18);
    expect(resolveAmbientVehicleCount(mapWithoutOverride, "busy", true)).toBe(12);
  });

  it("normalizes override values before either consumer can allocate slots", () => {
    const malformedOverride = {
      ambientTraffic: { desktop: 47.9, touch: -3.4 },
    };
    expect(resolveAmbientVehicleCount(malformedOverride, "none", false)).toBe(
      AMBIENT_VEHICLE_SLOT_CEILING,
    );
    expect(resolveAmbientVehicleCount(malformedOverride, "busy", true)).toBe(0);
  });

  it("applies the same defensive budget inside SimulationCore", () => {
    const gates = Array.from({ length: AMBIENT_VEHICLE_SLOT_CEILING + 1 }, (_, index) => ({
      id: `slot-gate-${index}`,
      laneId: "slot-lane",
      distance: 500 + index * 250,
    }));
    const activeNpcCount = (npcCount: number) =>
      new SimulationCore({
        npcCount,
        lanes: [
          {
            id: "slot-lane",
            points: [
              { x: 0, z: 0 },
              { x: 0, z: 12_000 },
            ],
            width: 3.5,
            speedLimitMps: 12,
            loop: false,
          },
        ],
        trafficGates: gates,
        spawn: { x: 1_000, z: -1_000, heading: 0 },
      }).getSnapshot().npcs.length;

    expect(activeNpcCount(4.8)).toBe(4);
    expect(activeNpcCount(-1)).toBe(0);
    expect(activeNpcCount(AMBIENT_VEHICLE_SLOT_CEILING + 9)).toBe(
      AMBIENT_VEHICLE_SLOT_CEILING,
    );
    expect(activeNpcCount(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("traffic gate direction classification", () => {
  it("does not invent opposing traffic gates on a one-way hairpin", () => {
    // The last leg points directly against the first in plan view. A geometric
    // direction split therefore looks two-way even though every authored lane
    // belongs to the same legal one-way movement.
    const lanes = [
      {
        id: "hairpin-1-forward-1",
        roadId: "hairpin",
        role: "one_way",
        centerline: [{ x: 0, z: 0 }, { x: 0, z: 80 }],
      },
      {
        id: "hairpin-2-forward-1",
        roadId: "hairpin",
        role: "one_way",
        centerline: [{ x: 0, z: 80 }, { x: 20, z: 80 }],
      },
      {
        id: "hairpin-3-forward-1",
        roadId: "hairpin",
        role: "one_way",
        centerline: [{ x: 20, z: 80 }, { x: 20, z: 0 }],
      },
    ] as const;
    const mapPack = {
      laneGraph: {
        lanes,
        controls: [],
        conflictZones: [],
        spawnPoints: [{
          id: "authored-hairpin-car",
          kind: "vehicle",
          anchor: { laneId: lanes[0].id, distanceAlongM: 20 },
        }],
      },
      geometry: {
        roadSurfaces: [{
          id: "hairpin",
          centerline: [
            { x: 0, z: 0 },
            { x: 0, z: 80 },
            { x: 20, z: 80 },
            { x: 20, z: 0 },
          ],
          widthM: 4,
          laneIds: lanes.map((lane) => lane.id),
        }],
      },
    } as unknown as GameCanvasMapPack;

    const gates = buildTrafficGates(mapPack);

    expect(gates.filter((gate) => gate.id.startsWith("oncoming-"))).toEqual([]);
    expect(gates.map((gate) => gate.id)).toEqual(["authored-hairpin-car"]);
  });
});

describe("runtime traffic portal safety", () => {
  it("preserves Cairo flyover height on runtime traffic portals", () => {
    const portals = buildRuntimeTrafficPortals(getMapPack("cairo-central-nile"));
    const elevated = portals.filter((portal) => (portal.elevationM ?? 0) >= 3.5);

    // Each terminal now uses one narrow, direction-specific carrier rather
    // than duplicating portals across the removed two-way low slabs. Keep a
    // strong catalogue floor without pinning the obsolete duplicate count.
    expect(elevated.length).toBeGreaterThanOrEqual(90);
    expect(Math.max(...elevated.map((portal) => portal.elevationM ?? 0))).toBe(10.5);
  });

  it("preserves Queensview deck height on safe portals in both directions", () => {
    const mapPack = getMapPack("nyc-upper-west-side");
    const lanesById = new Map(
      mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );
    const bridgePortals = buildRuntimeTrafficPortals(mapPack).filter((portal) =>
      lanesById
        .get(portal.laneId)
        ?.roadId?.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
    );
    const directions = new Set<string>();
    const failures: string[] = [];

    for (const portal of bridgePortals) {
      const lane = lanesById.get(portal.laneId);
      if (!lane) {
        failures.push(`${portal.id} references missing lane ${portal.laneId}`);
        continue;
      }
      if (lane.id.includes("-main-eb-")) directions.add("eastbound");
      if (lane.id.includes("-main-wb-")) directions.add("westbound");
      const resolved = resolveSimulationLaneAnchor([lane], {
        laneId: lane.id,
        distanceAlongM: portal.distance,
      });
      if (!resolved) {
        failures.push(`${portal.id} does not resolve on ${lane.id}`);
        continue;
      }
      if (
        lane.role !== "travel" ||
        Math.abs((portal.elevationM ?? 0) - NYC_QUEENSVIEW_DECK_ELEVATION_M) >
          1e-6 ||
        Math.abs(
          (portal.elevationM ?? 0) - (resolved.elevationM ?? 0),
        ) > 1e-6
      ) {
        failures.push(
          `${portal.id}: role ${lane.role}, portal ${(portal.elevationM ?? 0).toFixed(3)}m, lane ${(resolved.elevationM ?? 0).toFixed(3)}m`,
        );
      }
    }

    expect(bridgePortals.length).toBeGreaterThan(10);
    expect(directions).toEqual(new Set(["eastbound", "westbound"]));
    expect(failures).toEqual([]);
  });

  it("keeps portal samples clear of parallel/fallback stop lines and conflict zones", () => {
    // The adapter's simulation stop-line builders apply one approach's
    // arclength to every approach lane, and synthesize approaches for older
    // controls with no `approaches`. This narrow fixture makes all three
    // exclusions observable through the public portal catalogue.
    const mapPack = {
      laneGraph: {
        lanes: [
          {
            id: "multi-primary",
            role: "travel",
            centerline: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
          },
          {
            id: "multi-parallel",
            role: "travel",
            centerline: [{ x: 0, z: 4 }, { x: 100, z: 4 }],
          },
          {
            id: "fallback-stop",
            role: "travel",
            centerline: [{ x: 0, z: 12 }, { x: 100, z: 12 }],
          },
          {
            id: "conflict-lane",
            role: "travel",
            centerline: [{ x: 0, z: 24 }, { x: 100, z: 24 }],
          },
        ],
        controls: [
          {
            id: "parallel-signal",
            type: "signal",
            position: { x: 50, z: 0 },
            headingDeg: 0,
            laneIds: ["multi-primary", "multi-parallel"],
            approaches: [{
              id: "parallel-approach",
              laneIds: ["multi-primary", "multi-parallel"],
              stopLine: { laneId: "multi-primary", distanceAlongM: 50 },
              phaseGroup: "parallel",
            }],
            installations: [],
          },
          {
            id: "legacy-stop",
            type: "stop",
            position: { x: 50, z: 12 },
            headingDeg: 0,
            laneIds: ["fallback-stop"],
            approaches: [],
            installations: [],
          },
        ],
        conflictZones: [{
          id: "junction-conflict",
          laneIds: ["conflict-lane"],
          polygon: [
            { x: 40, z: 18 },
            { x: 60, z: 18 },
            { x: 60, z: 30 },
            { x: 40, z: 30 },
          ],
        }],
      },
    } as unknown as GameCanvasMapPack;
    const portals = buildRuntimeTrafficPortals(mapPack);
    for (const laneId of ["multi-primary", "multi-parallel", "fallback-stop"]) {
      const lanePortals = portals.filter((portal) => portal.laneId === laneId);
      expect(lanePortals, laneId).not.toHaveLength(0);
      expect(
        lanePortals.every((portal) => Math.abs(portal.distance - 50) >= 25),
        `${laneId} must retain the control's 25 m portal clearance`,
      ).toBe(true);
    }
    expect(portals.filter((portal) => portal.laneId === "conflict-lane")).toEqual([]);
  });
});
