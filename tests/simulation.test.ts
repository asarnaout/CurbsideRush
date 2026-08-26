import { describe, expect, it } from "vitest";
import {
  SimulationCore,
  isRestrictionWindowActive,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import { PLAYER_CAPSULE_RADIUS_M } from "../app/game/simulation/playerDynamics";
import { CAREER_VEHICLES } from "../app/game/career";
import type { StaticObstacle } from "../app/game/types";

describe("deterministic simulation", () => {
  /**
   * A roundabout give-way, from both sides of the glass.
   *
   * The geometry is the smallest thing that is really a roundabout: a
   * north-bound entry arm ending on a ring node, and a circulating ring lane
   * (`role: "roundabout"`, which the adapter maps to `kind: "roundabout"`)
   * sweeping past that node from the entry driver's right — the side a
   * left-hand-traffic country gives way to. `roundaboutYieldFrom` is what
   * separates this from a plain give-way, and `buildStopAndYieldLines`
   * derives it from the lane graph rather than taking it on trust.
   */
  const roundaboutFixture = (options: { readonly ringNpc: boolean }) => ({
    seed: 11,
    lanes: [
      {
        id: "entry-arm",
        points: [
          { x: 0, z: -60 },
          { x: 0, z: -14 },
        ],
        width: 3.2,
        speedLimitMps: 12,
        successorLaneIds: ["ring-arc"],
        loop: false,
      },
      {
        id: "ring-arc",
        points: [
          { x: 0, z: -14 },
          { x: 10, z: -4 },
          { x: 0, z: 6 },
        ],
        width: 3.2,
        speedLimitMps: 8,
        kind: "roundabout" as const,
        successorLaneIds: ["ring-arc"],
        loop: false,
      },
      {
        // Creeps past the mouth from the entry driver's right, slowly enough
        // to still be beside the give-way line when the player reaches it.
        id: "ring-feed",
        points: [
          { x: 6, z: -34 },
          { x: 6, z: -16 },
          { x: 10, z: -4 },
        ],
        width: 3.2,
        speedLimitMps: 3,
        kind: "roundabout" as const,
        successorLaneIds: ["ring-arc"],
        loop: false,
      },
    ],
    bounds: { minX: -40, maxX: 60, minZ: -80, maxZ: 40 },
    stopLines: [
      {
        id: "entry-give-way",
        laneId: "entry-arm",
        distance: 40,
        kind: "yield" as const,
        conflictRadius: 14,
        roundaboutYieldFrom: "right" as const,
      },
    ],
    ...(options.ringNpc
      ? {
          npcCount: 1,
          trafficGates: [
            { id: "ring-gate", laneId: "ring-feed", distance: 1, desiredSpeedMps: 2.5 },
          ],
        }
      : { npcCount: 0 }),
  });

  it("holds an entering NPC for circulating traffic, and lets it go when the ring is clear", () => {
    // Two NPCs: one already circulating, one arriving on the arm. The
    // arriving car must slow at the give-way line rather than drive on
    // through, and — the trap this whole mechanism exists for — must still be
    // on the map when it does. An entering lane is an ordinary road lane, so
    // unlike a ring lane it is NOT exempt from the jam recycler: two cars
    // mutually blocking is exactly how an entering car teleports away instead
    // of giving way.
    const busy = new SimulationCore({
      ...roundaboutFixture({ ringNpc: true }),
      npcCount: 2,
      trafficGates: [
        { id: "ring-gate", laneId: "ring-feed", distance: 1, desiredSpeedMps: 2.5 },
        { id: "entry-gate", laneId: "entry-arm", distance: 6, desiredSpeedMps: 9 },
      ],
      spawn: { x: -30, z: -70, heading: 0 },
    });
    let held = false;
    for (let tick = 0; tick < 10 * 60; tick += 1) {
      busy.step(1 / 60);
      const entering = busy
        .getSnapshot()
        .npcs.find((npc) => npc.id.includes("2"));
      if (entering && entering.z > -34 && entering.z < -14 && entering.speedMps < 2) {
        held = true;
      }
    }
    expect(held, "entering NPC gave way to the circulating stream").toBe(true);
    expect(busy.getSnapshot().npcs).toHaveLength(2);

    // With nothing on the ring the same arm runs free: a give-way line that
    // held regardless would just be a stop sign.
    const clear = new SimulationCore({
      ...roundaboutFixture({ ringNpc: false }),
      npcCount: 1,
      trafficGates: [
        { id: "entry-gate", laneId: "entry-arm", distance: 6, desiredSpeedMps: 9 },
      ],
      spawn: { x: -30, z: -70, heading: 0 },
    });
    let heldOnAnEmptyRing = false;
    for (let tick = 0; tick < 10 * 60; tick += 1) {
      clear.step(1 / 60);
      const npc = clear.getSnapshot().npcs[0];
      if (npc && npc.z > -34 && npc.z < -14 && npc.speedMps < 2) {
        heldOnAnEmptyRing = true;
      }
    }
    expect(heldOnAnEmptyRing, "nothing to give way to").toBe(false);
  });

  it("coaches the player for crossing a live give-way line onto a roundabout", () => {
    const simulation = new SimulationCore({
      ...roundaboutFixture({ ringNpc: true }),
      spawn: { x: 0, z: -58, heading: 0 },
    });
    for (let tick = 0; tick < 8 * 60; tick += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const events = simulation.getEvents();
    const yieldEvent = events.find((event) => event.code === "roundabout_yield");
    expect(yieldEvent?.correction).toContain("Give way to traffic already on the roundabout");
    // The generic give-way code stays for give-way lines that are not
    // roundabout entries; a roundabout entry must not emit both.
    expect(events.some((event) => event.code === "unsafe_gap")).toBe(false);
  });

  it("does not synthesize retired fallback roads, signals, or traffic", () => {
    const simulation = new SimulationCore({ seed: 42, npcCount: 10 });
    const snapshot = simulation.getSnapshot();

    expect(snapshot.road.laneId).toBeNull();
    expect(snapshot.trafficLights).toEqual([]);
    expect(snapshot.npcs).toEqual([]);
  });

  it("produces the same snapshots for the same seed and inputs", () => {
    const left = new SimulationCore({ seed: 42, npcCount: 6 });
    const right = new SimulationCore({ seed: 42, npcCount: 6 });
    for (let index = 0; index < 180; index += 1) {
      const input = { throttle: 0.72, steer: index > 80 ? 0.08 : 0 };
      left.step(1 / 60, input);
      right.step(1 / 60, input);
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
  });

  // The per-vehicle physics knobs default to the exact literals the sim always
  // carried; this pins that omitting them and spelling out those defaults are
  // the same simulation — the guarantee the acceptance replay leans on.
  it("drives identically with no physics config and with the defaults spelled out", () => {
    const implicit = new SimulationCore({ seed: 7, npcCount: 6 });
    const explicit = new SimulationCore({
      seed: 7,
      npcCount: 6,
      maxForwardSpeedMps: 22,
      maxReverseSpeedMps: 7,
      forwardAccelMps2: 5.6,
      reverseAccelMps2: 4.1,
      brakeBaseMps2: 3,
      brakeStrengthMps2: 8.5,
      dragBaseMps2: 0.8,
      dragPerMps: 0.075,
      steerBaseRate: 0.32,
      steerAuthorityRate: 0.95,
      steerAuthoritySpeedMps: 5.5,
      instabilityLateralMps2: 11,
      playerRadiusM: 1.05,
      playerCapsuleHalfLengthM: 1.15,
      playerCapsuleRadiusM: 1.0,
    });
    for (let index = 0; index < 600; index += 1) {
      const input = {
        throttle: index < 400 ? 0.8 : 0,
        brake: index >= 400 ? 0.6 : 0,
        steer: index > 120 && index < 240 ? 0.35 : 0,
      };
      implicit.step(1 / 60, input);
      explicit.step(1 / 60, input);
    }
    expect(implicit.getSnapshot()).toEqual(explicit.getSnapshot());
  });

  it("responds to each physics knob in the right direction", () => {
    const runFor = (
      config: ConstructorParameters<typeof SimulationCore>[0],
      ticks: number,
      input: { throttle?: number; steer?: number },
    ) => {
      const simulation = new SimulationCore({ npcCount: 0, ...config });
      for (let index = 0; index < ticks; index += 1) {
        simulation.step(1 / 60, input);
      }
      return simulation.getSnapshot().player;
    };
    // Stronger acceleration reaches a higher speed in the same time.
    const brisk = runFor({ forwardAccelMps2: 9 }, 90, { throttle: 1 });
    const sluggish = runFor({ forwardAccelMps2: 2 }, 90, { throttle: 1 });
    expect(brisk.signedSpeedMps).toBeGreaterThan(sluggish.signedSpeedMps + 1);
    // A lower top speed clamps the same pedal input.
    const bikeCap = runFor({ maxForwardSpeedMps: 7.5 }, 600, { throttle: 1 });
    expect(bikeCap.signedSpeedMps).toBeLessThanOrEqual(7.5 + 1e-9);
    // A lower instability threshold scrubs speed under a sustained fast turn
    // where a planted setup keeps its grip.
    const twitchy = runFor(
      { instabilityLateralMps2: 3 },
      150,
      { throttle: 1, steer: 0.2 },
    );
    const planted = runFor(
      { instabilityLateralMps2: 30 },
      150,
      { throttle: 1, steer: 0.2 },
    );
    expect(twitchy.signedSpeedMps).toBeLessThan(planted.signedSpeedMps - 0.5);
  });

  // #257 was filed as "the recorded speed doesn't seem realistic": lift off at
  // 50 mph, coast ten seconds, and the speedometer still read exactly 30. The
  // readout was correct to the last bit — the car really was doing 30, because
  // coasting shed only 0.72 m/s^2. This pins the retuned coast-down by its
  // behaviour rather than its literals, so a future tweak has to stay inside
  // what a real car does instead of merely differing from the old numbers.
  //
  // Wide bounds keep this a pure physics run, isolated from road-rule events.
  it("coasts to rest like a car in gear, not one in neutral", () => {
    const MPH = 2.236936;
    const coastFrom = (mph: number) => {
      const simulation = new SimulationCore({
        npcCount: 0,
        lanes: [],
        bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
      });
      simulation.setPlayerPose({ x: 0, z: 0, heading: 0 }, mph / MPH);
      let ticks = 0;
      let readoutAtTenSeconds = -1;
      while (ticks < 120 * 60) {
        simulation.step(1 / 60, {});
        ticks += 1;
        if (ticks === 10 * 60) {
          readoutAtTenSeconds = simulation.getSnapshot().speedDisplay;
        }
        if (simulation.getSnapshot().player.speedMps <= 0.02) break;
      }
      const player = simulation.getSnapshot().player;
      return {
        seconds: ticks / 60,
        metres: Math.hypot(player.x, player.z),
        readoutAtTenSeconds,
      };
    };

    // A real light car coasting in gear sheds 1.5-2.5 m/s^2, so 30 mph is gone
    // in roughly 6-12 s and well inside a 240 m city block.
    const thirty = coastFrom(30);
    expect(thirty.seconds).toBeGreaterThan(5);
    expect(thirty.seconds).toBeLessThan(14);
    expect(thirty.metres).toBeLessThan(120);

    // The reported symptom, stated directly: ten seconds after lifting off at
    // 50 the car must be nowhere near still doing 30.
    const fifty = coastFrom(50);
    expect(fifty.readoutAtTenSeconds).toBeLessThan(20);
    expect(fifty.metres).toBeLessThan(240);
  });

  // Braking was never the problem and must not drift while drag is retuned:
  // 30 mph in ~7.7 m is already a shade stronger than a real car's 9-10 m.
  it("still stops from 30 mph in a real braking distance", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [],
      bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    });
    simulation.setPlayerPose({ x: 0, z: 0, heading: 0 }, 30 / 2.236936);
    let ticks = 0;
    while (ticks < 60 * 60) {
      simulation.step(1 / 60, { brake: 1 });
      ticks += 1;
      if (simulation.getSnapshot().player.speedMps <= 0.02) break;
    }
    const player = simulation.getSnapshot().player;
    expect(ticks / 60).toBeLessThan(2);
    expect(Math.hypot(player.x, player.z)).toBeGreaterThan(5);
    expect(Math.hypot(player.x, player.z)).toBeLessThan(11);
  });

  it("never reverses off the brake pedal, however long it is held", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 60; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    expect(simulation.getSnapshot().player.signedSpeedMps).toBeGreaterThan(1);
    for (let index = 0; index < 300; index += 1) {
      simulation.step(1 / 60, { brake: 1 });
      expect(simulation.getSnapshot().player.signedSpeedMps).toBeGreaterThanOrEqual(0);
    }
    expect(simulation.getSnapshot().player.signedSpeedMps).toBe(0);
    expect(simulation.getSnapshot().player.gear).toBe("drive");
  });

  it("brakes to a stop on the reverse pedal, then pulls away backwards", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 60; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const cruising = simulation.getSnapshot().player.signedSpeedMps;
    expect(cruising).toBeGreaterThan(1);

    // Held from cruising speed the same pedal has to slow the car all the way
    // down before it ever moves backwards — no lurch through zero.
    let previous = cruising;
    let stoppedAt = -1;
    for (let index = 0; index < 90; index += 1) {
      simulation.step(1 / 60, { reverse: 1 });
      const speed = simulation.getSnapshot().player.signedSpeedMps;
      if (stoppedAt < 0) {
        expect(speed, `tick ${index}`).toBeLessThanOrEqual(previous + 1e-9);
        if (speed <= 0) stoppedAt = index;
      }
      previous = speed;
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(stoppedAt).toBeGreaterThan(0);
    expect(snapshot.player.signedSpeedMps).toBeLessThan(-1);
    expect(snapshot.player.gear).toBe("reverse");
  });

  it("brakes a reversing car back to a stop on the accelerator", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 60; index += 1) {
      simulation.step(1 / 60, { reverse: 1 });
    }
    expect(simulation.getSnapshot().player.signedSpeedMps).toBeLessThan(-1);
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.player.signedSpeedMps).toBeGreaterThan(1);
    expect(snapshot.player.gear).toBe("drive");
  });

  it("holds still when both pedals are pressed together", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 60; index += 1) {
      simulation.step(1 / 60, { throttle: 1, reverse: 1 });
    }
    expect(Math.abs(simulation.getSnapshot().player.signedSpeedMps)).toBeLessThan(0.05);
  });

  it("keeps snapshots serializable and preserves scenario metadata", () => {
    const simulation = new SimulationCore({
      scenarioId: "tokyo-free-drive",
      trafficSide: "left",
      speedUnit: "kmh",
      seed: 7,
    });
    const snapshot = simulation.step(1 / 30, { throttle: 0.4 });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.scenarioId).toBe("tokyo-free-drive");
    expect(snapshot.trafficSide).toBe("left");
    expect(snapshot.speedUnit).toBe("kmh");
  });

  it("maps the passing lane to the jurisdiction-appropriate side", () => {
    const rightTraffic = new SimulationCore({
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "right-passing",
          points: [
            { x: 1.75, z: -90 },
            { x: 1.75, z: 90 },
          ],
          role: "passing",
        },
      ],
      spawn: { x: 1.75, z: -75, heading: 0 },
    });
    const leftTraffic = new SimulationCore({
      trafficSide: "left",
      npcCount: 0,
      lanes: [
        {
          id: "left-passing",
          points: [
            { x: -1.75, z: -90 },
            { x: -1.75, z: 90 },
          ],
          role: "passing",
        },
      ],
      spawn: { x: -1.75, z: -75, heading: 0 },
    });
    expect(rightTraffic.getSnapshot().road.laneRole).toBe("passing");
    expect(leftTraffic.getSnapshot().road.laneRole).toBe("passing");
    expect(rightTraffic.getSnapshot().player.x).toBeGreaterThan(0);
    expect(leftTraffic.getSnapshot().player.x).toBeLessThan(0);
  });

  it("keeps driving after a wrong-way violation and emits a rule event", () => {
    // Open-world drives never freeze or snap the car back. The violation is
    // still recorded for traffic-law fines. Heading π drives toward -z,
    // against this lane's +z legal direction.
    const simulation = new SimulationCore({
      scenarioId: "wrong-way-open-world",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "wide-lane",
          points: [
            { x: 0, z: -100 },
            { x: 0, z: 100 },
          ],
          width: 20,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: Math.PI },
      bounds: { minX: -30, maxX: 30, minZ: -120, maxZ: 120 },
    });

    for (let index = 0; index < 240; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.player.speedMps).toBeGreaterThan(0);
    expect(snapshot.player.z).toBeLessThan(-5);
    const wrongWayEvents = simulation
      .drainEvents()
      .filter((event) => event.code === "wrong_way");
    expect(wrongWayEvents.length).toBeGreaterThan(0);
    expect(wrongWayEvents[0]?.correction).toContain("Keep to the right");
  });

  it("returns to the authored spawn without restarting the world clock", () => {
    const simulation = new SimulationCore({
      scenarioId: "authored-spawn-reset",
      npcCount: 0,
      spawn: { x: 5.25, z: -20, heading: 0.4 },
    });
    for (let index = 0; index < 90; index += 1) {
      simulation.step(1 / 60, { throttle: 0.7 });
    }
    const before = simulation.getSnapshot();
    simulation.resetToSpawn();
    const restored = simulation.getSnapshot();
    expect(restored.scenarioId).toBe("authored-spawn-reset");
    expect(restored.player.x).toBe(5.25);
    expect(restored.player.z).toBe(-20);
    expect(restored.player.heading).toBeCloseTo(0.4);
    expect(restored.player.speedMps).toBe(0);
    expect(restored.tick).toBe(before.tick);
    expect(restored.elapsedMs).toBe(before.elapsedMs);
  });

  it("assesses a blocked box-junction exit once the player enters the conflict zone", () => {
    const simulation = new SimulationCore({
      scenarioId: "london-box-test",
      seed: 12,
      npcCount: 1,
      lanes: [
        {
          id: "cromwell-east",
          points: [
            { x: 0, z: -20 },
            { x: 0, z: 20 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -12, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -24, maxZ: 24 },
      trafficGates: [
        {
          id: "slow-blocker",
          laneId: "cromwell-east",
          distance: 28,
          desiredSpeedMps: 1,
        },
      ],
      boxJunctions: [
        {
          id: "cromwell-yellow-box",
          laneIds: ["cromwell-east"],
          polygon: [
            { x: -3, z: -8 },
            { x: 3, z: -8 },
            { x: 3, z: -2 },
            { x: -3, z: -2 },
          ],
          exitClearanceM: 24,
        },
      ],
    });

    for (let index = 0; index < 180; index += 1) {
      simulation.step(1 / 60, { throttle: 0.8 });
    }

    const event = simulation
      .getEvents()
      .find((candidate) => candidate.code === "box_junction");
    expect(event?.correction).toContain("enough room to clear it completely");
    expect(event?.evidence).toMatchObject({
      junctionId: "cromwell-yellow-box",
      laneId: "cromwell-east",
      blockingVehicleId: "npc-1",
    });
  });

  it("does not emit a box-junction event when its exit is clear", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "clear-exit",
          points: [
            { x: 0, z: -20 },
            { x: 0, z: 20 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -12, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -24, maxZ: 24 },
      boxJunctions: [
        {
          id: "clear-box",
          laneIds: ["clear-exit"],
          polygon: [
            { x: -3, z: -8 },
            { x: 3, z: -8 },
            { x: 3, z: -2 },
            { x: -3, z: -2 },
          ],
        },
      ],
    });
    for (let index = 0; index < 180; index += 1) {
      simulation.step(1 / 60, { throttle: 0.8 });
    }
    expect(simulation.getEvents().some((event) => event.code === "box_junction")).toBe(false);
  });

  it("uses the fixed scenario clock for sustained restricted-lane assessment and cooldown", () => {
    const simulation = new SimulationCore({
      scenarioId: "london-restricted-lane-test",
      npcCount: 0,
      lanes: [
        {
          id: "signed-bus-lane",
          points: [
            { x: 0, z: -500 },
            { x: 0, z: 500 },
          ],
          width: 6,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -400, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -510, maxZ: 510 },
      scenarioClock: {
        weekday: "mon",
        minutesAfterMidnight: 8 * 60 + 30,
        label: "Monday 08:30",
      },
      laneRestrictions: [
        {
          id: "museum-bus-lane-hours",
          laneId: "signed-bus-lane",
          ruleCode: "restricted_lane",
          activeWindows: [
            {
              weekdays: ["mon", "tue", "wed", "thu", "fri"],
              startMinutes: 7 * 60,
              endMinutes: 19 * 60,
            },
          ],
          sourceReferenceId: "uk-highway-code-140",
        },
      ],
    });

    for (let index = 0; index < 360; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    const firstEvents = simulation
      .getEvents()
      .filter((event) => event.code === "restricted_lane");
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0].evidence).toMatchObject({
      restrictionId: "museum-bus-lane-hours",
      laneId: "signed-bus-lane",
      scenarioTime: "Monday 08:30",
      sourceReferenceId: "uk-highway-code-140",
      sustainedSeconds: 2.5,
    });
    expect(simulation.getSnapshot().scenarioClock?.label).toBe("Monday 08:30");

    for (let index = 0; index < 300; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    expect(
      simulation.getEvents().filter((event) => event.code === "restricted_lane"),
    ).toHaveLength(1);

    for (let index = 0; index < 420; index += 1) {
      simulation.step(1 / 60, { throttle: 0.55 });
    }
    expect(
      simulation.getEvents().filter((event) => event.code === "restricted_lane"),
    ).toHaveLength(2);
  });

  it("handles inactive and overnight signed restriction windows deterministically", () => {
    expect(
      isRestrictionWindowActive(
        { weekday: "sat", minutesAfterMidnight: 9 * 60, label: "Saturday 09:00" },
        {
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startMinutes: 7 * 60,
          endMinutes: 19 * 60,
        },
      ),
    ).toBe(false);
    expect(
      isRestrictionWindowActive(
        { weekday: "tue", minutesAfterMidnight: 60, label: "Tuesday 01:00" },
        {
          weekdays: ["mon"],
          startMinutes: 23 * 60,
          endMinutes: 2 * 60,
        },
      ),
    ).toBe(true);
    expect(
      isRestrictionWindowActive(
        { weekday: "tue", minutesAfterMidnight: 3 * 60, label: "Tuesday 03:00" },
        {
          weekdays: ["mon"],
          startMinutes: 23 * 60,
          endMinutes: 2 * 60,
        },
      ),
    ).toBe(false);
  });

  it("moves NPCs continuously through authored successor lanes", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      lanes: [
        {
          id: "player-lane",
          points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
          loop: false,
        },
        {
          id: "approach",
          points: [{ x: 0, z: 0 }, { x: 0, z: 20 }],
          successorLaneIds: ["exit"],
          loop: false,
        },
        {
          id: "exit",
          points: [{ x: 0, z: 20 }, { x: 20, z: 20 }],
          loop: false,
        },
      ],
      spawn: { x: 50, z: 10, heading: 0 },
      bounds: { minX: -10, maxX: 60, minZ: -10, maxZ: 110 },
      trafficGates: [
        { id: "approach-edge", laneId: "approach", distance: 18, desiredSpeedMps: 6 },
      ],
    });

    let previous = simulation.getSnapshot().npcs[0];
    expect(previous.x).toBeGreaterThan(0.5);
    expect(previous.z).toBeLessThan(17.5);
    let enteredSuccessor = false;
    for (let index = 0; index < 180; index += 1) {
      const current = simulation.step(1 / 60).npcs[0];
      if (!current) continue;
      const displacement = Math.hypot(current.x - previous.x, current.z - previous.z);
      expect(displacement).toBeLessThanOrEqual(current.speedMps / 60 + 0.05);
      enteredSuccessor ||= current.laneId === "exit";
      previous = current;
    }
    expect(enteredSuccessor).toBe(true);
    expect(simulation.getSnapshot().status).toBe("running");
  });

  it("queues an NPC at a dead end instead of wrapping it to the lane start", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 200,
      lanes: [
        {
          id: "player-lane",
          points: [{ x: 100, z: 0 }, { x: 100, z: 100 }],
          loop: false,
        },
        {
          id: "dead-end",
          points: [{ x: 0, z: 0 }, { x: 0, z: 10 }],
          loop: false,
        },
      ],
      spawn: { x: 100, z: 10, heading: 0 },
      bounds: { minX: -10, maxX: 110, minZ: -10, maxZ: 110 },
      trafficGates: [
        { id: "dead-end-edge", laneId: "dead-end", distance: 8, desiredSpeedMps: 6 },
      ],
    });
    for (let index = 0; index < 180; index += 1) simulation.step(1 / 60);
    expect(simulation.getSnapshot().npcs).toHaveLength(0);
    expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
  });

  it("keeps a runtime gate 150 metres directly ahead queued inside camera range", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "visible-forward-gate",
          laneId: "visibility-lane",
          distance: 150,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      npcs: [],
      queuedNpcCount: 1,
    });
  });

  it("activates an otherwise safe runtime gate about 200 metres ahead", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "clear-forward-gate",
          laneId: "visibility-lane",
          distance: 200,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 12; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      queuedNpcCount: 0,
      npcs: [{ laneId: "visibility-lane" }],
    });
  });

  it("keeps a runtime gate within the rear mirror envelope queued", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 70,
      lanes: [
        {
          id: "visibility-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
          width: 3.5,
          speedLimitMps: 20,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 200, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 510 },
      trafficGates: [
        {
          id: "visible-rear-gate",
          laneId: "visibility-lane",
          distance: 100,
          desiredSpeedMps: 10,
          allowInitialSpawn: false,
        },
      ],
    });

    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(1 / 60, { viewHeading: 0 });
    }
    expect(simulation.getSnapshot()).toMatchObject({
      npcs: [],
      queuedNpcCount: 1,
    });
  });

  it("keeps a safe gap behind a stationary legal player for sixty seconds", () => {
    const simulation = new SimulationCore({
      seed: 1251,
      npcCount: 1,
      lanes: [
        {
          id: "london-left-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 300 }],
          speedLimitMps: 13,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 100, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 310 },
      trafficGates: [
        { id: "london-rear-gate", laneId: "london-left-lane", distance: 40, desiredSpeedMps: 12 },
      ],
    });
    for (let index = 0; index < 60 * 60; index += 1) simulation.step(1 / 60);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.npcs[0].z).toBeLessThanOrEqual(95);
  });

  it("requeues traffic that conflicts with the restored authored spawn", () => {
    const simulation = new SimulationCore({
      npcCount: 1,
      minRuntimeSpawnDistanceM: 200,
      lanes: [
        {
          id: "recovery-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 300 }],
          loop: false,
        },
      ],
      spawn: { x: 0, z: 22, heading: 0 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 310 },
      trafficGates: [
        { id: "recovery-gate", laneId: "recovery-lane", distance: 20, desiredSpeedMps: 4 },
      ],
    });
    // Initially queued because its gate overlaps the authored player spawn.
    expect(simulation.getSnapshot().npcs).toHaveLength(0);
    expect(simulation.getSnapshot().queuedNpcCount).toBe(1);

    // With the player safely away, the runtime gate may activate.
    simulation.setPlayerPose({ x: 0, z: 260, heading: 0 });
    for (let tick = 0; tick < 12; tick += 1) simulation.step(1 / 60);
    expect(simulation.getSnapshot().npcs).toHaveLength(1);

    simulation.resetToSpawn();
    expect(simulation.getSnapshot().npcs).toHaveLength(0);
    expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
    expect(simulation.getSnapshot().player).toMatchObject({ x: 0, z: 22 });
  });

  it("supports UK red-amber and all-red clearance phases per approach", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        { id: "signal-lane", points: [{ x: 0, z: 0 }, { x: 0, z: 100 }], loop: false },
      ],
      spawn: { x: 0, z: 10, heading: 0 },
      trafficLights: [
        {
          id: "uk-primary",
          phaseGroup: "north-south",
          x: 0,
          z: 50,
          cycle: {
            sequence: "uk",
            greenSeconds: 1,
            amberSeconds: 1,
            allRedSeconds: 1,
            redSeconds: 1,
            redAmberSeconds: 1,
          },
        },
      ],
    });
    const state = () => simulation.getSnapshot().trafficLights[0];
    const advance = (seconds: number) => {
      for (let index = 0; index < Math.ceil(seconds * 60); index += 1) {
        simulation.step(1 / 60);
      }
    };
    expect(state()).toMatchObject({ state: "green", phaseGroup: "north-south" });
    advance(1.05);
    expect(state().state).toBe("amber");
    advance(1);
    expect(state().state).toBe("all_red");
    advance(1);
    expect(state().state).toBe("red");
    advance(1);
    expect(state().state).toBe("red_amber");
  });

  it("stops NPC traffic at an active railway warning and assesses a player crossing", () => {
    const sharedConfig = {
      lanes: [
        {
          id: "rail-approach",
          points: [{ x: 0, z: 0 }, { x: 0, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
        {
          id: "player-safe-lane",
          points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
      ],
      bounds: { minX: -10, maxX: 60, minZ: -10, maxZ: 110 },
      trafficLights: [
        {
          id: "rail-warning",
          phaseGroup: "railway",
          x: 0,
          z: 20,
          cycle: {
            sequence: "standard" as const,
            greenSeconds: 1,
            amberSeconds: 0.5,
            allRedSeconds: 0.5,
            redSeconds: 20,
            redAmberSeconds: 0,
            offsetSeconds: 2.1,
          },
        },
      ],
      stopLines: [
        {
          id: "rail-stop-line",
          laneId: "rail-approach",
          distance: 20,
          kind: "railway" as const,
          trafficLightId: "rail-warning",
        },
      ],
    };

    const traffic = new SimulationCore({
      ...sharedConfig,
      spawn: { x: 50, z: 10, heading: 0 },
      npcCount: 1,
      trafficGates: [
        {
          id: "rail-traffic-gate",
          laneId: "rail-approach",
          distance: 2,
          desiredSpeedMps: 8,
        },
      ],
    });
    for (let tick = 0; tick < 6 * 60; tick += 1) traffic.step(1 / 60);
    const railNpc = traffic.getSnapshot().npcs[0];
    expect(railNpc?.z).toBeLessThan(20);
    expect(railNpc?.speedMps).toBeLessThan(0.4);

    const player = new SimulationCore({
      ...sharedConfig,
      spawn: { x: 0, z: 10, heading: 0 },
      npcCount: 0,
    });
    for (let tick = 0; tick < 5 * 60; tick += 1) {
      player.step(1 / 60, { throttle: 1 });
    }
    const railwayEvent = player
      .getEvents()
      .find((event) => event.code === "railway_crossing");
    expect(railwayEvent?.correction).toContain("Stop before the line");
    expect(railwayEvent?.evidence).toMatchObject({ warningActive: true });
  });

  it("holds each lane's traffic to its own signal, not a neighbour's", () => {
    // Two parallel lanes, each with its own light and stop line: one lane
    // red, the other green. Pins the per-lane stop-line association — a
    // cross-lane leak in the lookup would either stop the green lane's car
    // or wave the red lane's car through.
    const core = new SimulationCore({
      lanes: [
        {
          id: "red-lane",
          points: [{ x: 0, z: 0 }, { x: 0, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
        {
          id: "green-lane",
          points: [{ x: 50, z: 0 }, { x: 50, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
        {
          id: "player-parking-lane",
          points: [{ x: -50, z: 0 }, { x: -50, z: 100 }],
          width: 3.2,
          speedLimitMps: 12,
          loop: false,
        },
      ],
      bounds: { minX: -60, maxX: 60, minZ: -10, maxZ: 110 },
      spawn: { x: -50, z: 10, heading: 0 },
      npcCount: 2,
      trafficLights: [
        {
          id: "red-signal",
          phaseGroup: "red-group",
          x: 0,
          z: 20,
          cycle: {
            sequence: "standard" as const,
            greenSeconds: 1,
            amberSeconds: 0.5,
            allRedSeconds: 0.5,
            redSeconds: 20,
            redAmberSeconds: 0,
            offsetSeconds: 2.1,
          },
        },
        {
          id: "green-signal",
          phaseGroup: "green-group",
          x: 50,
          z: 20,
          cycle: {
            sequence: "standard" as const,
            greenSeconds: 30,
            amberSeconds: 0.5,
            allRedSeconds: 0.5,
            redSeconds: 1,
            redAmberSeconds: 0,
            offsetSeconds: 0,
          },
        },
      ],
      stopLines: [
        {
          id: "red-stop-line",
          laneId: "red-lane",
          distance: 20,
          kind: "traffic_light" as const,
          trafficLightId: "red-signal",
        },
        {
          id: "green-stop-line",
          laneId: "green-lane",
          distance: 20,
          kind: "traffic_light" as const,
          trafficLightId: "green-signal",
        },
      ],
      trafficGates: [
        {
          id: "red-gate",
          laneId: "red-lane",
          distance: 2,
          desiredSpeedMps: 8,
        },
        {
          id: "green-gate",
          laneId: "green-lane",
          distance: 2,
          desiredSpeedMps: 8,
        },
      ],
    });
    for (let tick = 0; tick < 8 * 60; tick += 1) core.step(1 / 60);
    const npcs = core.getSnapshot().npcs;
    const redNpc = npcs.find((npc) => npc.laneId === "red-lane");
    const greenNpc = npcs.find((npc) => npc.laneId === "green-lane");
    expect(redNpc?.z).toBeLessThan(20);
    expect(redNpc?.speedMps).toBeLessThan(0.4);
    expect(greenNpc?.z).toBeGreaterThan(22);
  });
});

describe("static world collision", () => {
  const NORTH_LANE = {
    id: "main-street",
    points: [
      { x: 0, z: -100 },
      { x: 0, z: 100 },
    ],
    width: 20,
    speedLimitMps: 30,
    loop: false,
  };

  const wallAhead = (maxForwardSpeedMps = 22) =>
    new SimulationCore({
      scenarioId: "wall-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [NORTH_LANE],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
      maxForwardSpeedMps,
      staticObstacles: [
        {
          kind: "aabb",
          id: "front-wall",
          tag: "building",
          minX: -30,
          maxX: 30,
          minZ: 40,
          maxZ: 60,
        },
      ],
    });

  it("stops the car at a wall without ending the drive", () => {
    const simulation = wallAhead();
    for (let index = 0; index < 480; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    // Capsule front circle (centre + 1.15 + radius 1.0) rests on the face.
    expect(snapshot.player.z).toBeLessThanOrEqual(40 - 2.15 + 0.01);
    expect(snapshot.player.z).toBeGreaterThan(35);
    const collision = simulation
      .getEvents()
      .find((event) => event.code === "collision");
    expect(collision?.correction).toContain("keep to the carriageway");
    expect(collision?.evidence).toMatchObject({ obstacle: "building" });
    expect(
      typeof collision?.evidence.impactSpeedMps === "number" &&
        (collision.evidence.impactSpeedMps as number) > 2,
    ).toBe(true);
  });

  it("drives an elevated lane above a ground-height obstacle", () => {
    const simulation = new SimulationCore({
      scenarioId: "flyover-height-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          ...NORTH_LANE,
          points: [
            { x: 0, z: -100, elevationM: 8 },
            { x: 0, z: 100, elevationM: 8 },
          ],
        },
      ],
      spawn: { x: 0, z: 0, elevationM: 8, heading: 0 },
      bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
      staticObstacles: [
        {
          kind: "aabb",
          id: "ground-wall",
          tag: "shoreline",
          minX: -30,
          maxX: 30,
          minZ: 40,
          maxZ: 60,
          maxElevationM: 3.5,
        },
      ],
    });
    for (let index = 0; index < 480; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    expect(simulation.getSnapshot().player.z).toBeGreaterThan(60);
    expect(simulation.getEvents().some((event) => event.code === "collision")).toBe(false);
  });

  it("collides with an elevated parapet only on its authored road level", () => {
    const barrier: StaticObstacle = {
      kind: "obb",
      id: "height-banded-parapet",
      tag: "roadBarrier",
      x: 0,
      z: 50,
      ux: 1,
      uz: 0,
      halfU: 30,
      halfV: 0.14,
      minElevationM: 6.25,
      maxElevationM: 9.75,
    };
    const driveAtElevation = (elevationM: number) => {
      const simulation = new SimulationCore({
        scenarioId: `parapet-height-${elevationM}`,
        trafficSide: "right",
        npcCount: 0,
        lanes: [
          {
            ...NORTH_LANE,
            points: [
              { x: 0, z: -100, elevationM },
              { x: 0, z: 100, elevationM },
            ],
          },
        ],
        spawn: { x: 0, z: 0, elevationM, heading: 0 },
        bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
        staticObstacles: [barrier],
      });
      for (let index = 0; index < 480; index += 1) {
        simulation.step(1 / 60, { throttle: 1 });
      }
      return simulation;
    };

    const ground = driveAtElevation(0);
    expect(ground.getSnapshot().player.z).toBeGreaterThan(60);
    expect(ground.getEvents().some((event) => event.code === "collision")).toBe(
      false,
    );

    const elevated = driveAtElevation(8);
    expect(elevated.getSnapshot().player.z).toBeLessThan(50);
    const collision = elevated
      .getEvents()
      .find((event) => event.code === "collision");
    expect(collision?.evidence).toMatchObject({
      obstacle: "roadBarrier",
      obstacleId: "height-banded-parapet",
    });
    expect(collision?.correction).toContain("elevated-road barriers");
  });

  it("does not oscillate from an ascending ramp to the closer road below", () => {
    const simulation = new SimulationCore({
      scenarioId: "ramp-height-continuity-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "ground",
          points: [{ x: 0, z: 0 }, { x: 0, z: 20 }],
          width: 3.2,
          loop: false,
        },
        {
          id: "ramp",
          points: [
            { x: 1, z: 0, elevationM: 5 },
            { x: 1, z: 20, elevationM: 7 },
          ],
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: 1, z: 0, elevationM: 5, heading: 0 },
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 40 },
    });

    for (const [x, z] of [[0.3, 1], [0.25, 2], [0.35, 3]] as const) {
      simulation.setPlayerPose(
        {
          x,
          z,
          elevationM: simulation.getSnapshot().player.elevationM,
          heading: 0,
        },
        5,
      );
      const snapshot = simulation.getSnapshot();
      expect(snapshot.road.laneId).toBe("ramp");
      expect(snapshot.player.elevationM).toBeGreaterThan(5);
    }
  });

  it("keeps the ground lane beneath a closer elevated centreline", () => {
    const simulation = new SimulationCore({
      scenarioId: "ground-under-flyover-continuity-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "ground",
          points: [{ x: 0, z: 0 }, { x: 0, z: 30 }],
          width: 3.2,
          loop: false,
        },
        {
          id: "flyover",
          points: [
            { x: 0.3, z: 0, elevationM: 10.5 },
            { x: 0.3, z: 30, elevationM: 10.5 },
          ],
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 2, heading: 0 },
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 50 },
    });

    for (const [x, z] of [[0.2, 4], [0.22, 8], [0.18, 12]] as const) {
      simulation.setPlayerPose({ x, z, heading: 0 }, 5);
      const snapshot = simulation.getSnapshot();
      expect(snapshot.road.laneId).toBe("ground");
      expect(snapshot.player.elevationM).toBeUndefined();
    }
  });

  it("treats an explicit zero-height pose as authoritative at a stacked road", () => {
    const simulation = new SimulationCore({
      scenarioId: "explicit-ground-teleport-under-flyover-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "ground",
          points: [{ x: 0, z: 0 }, { x: 0, z: 30 }],
          width: 3.2,
          loop: false,
        },
        {
          id: "flyover",
          points: [
            { x: 0, z: 0, elevationM: 10.5 },
            { x: 0, z: 30, elevationM: 10.5 },
          ],
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 5, elevationM: 10.5, heading: 0 },
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 50 },
    });

    expect(simulation.getSnapshot().road.laneId).toBe("flyover");
    simulation.setPlayerPose(
      { x: 0, z: 10, elevationM: 0, heading: 0 },
      0,
    );

    const snapshot = simulation.getSnapshot();
    expect(snapshot.road.laneId).toBe("ground");
    expect(snapshot.player.elevationM).toBeUndefined();
  });

  it("does not lift an off-road ground car onto the nearest overhead deck", () => {
    const simulation = new SimulationCore({
      scenarioId: "ground-under-remote-flyover-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [
        {
          id: "ground",
          points: [{ x: 20, z: 0 }, { x: 20, z: 30 }],
          width: 3.2,
          loop: false,
        },
        {
          id: "flyover",
          points: [
            { x: 0, z: 0, elevationM: 10.5 },
            { x: 0, z: 30, elevationM: 10.5 },
          ],
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: 20, z: 5, heading: 0 },
      bounds: { minX: -30, maxX: 30, minZ: -10, maxZ: 40 },
    });

    simulation.setPlayerPose(
      { x: 0, z: 10, elevationM: 0, heading: 0 },
      0,
    );

    const snapshot = simulation.getSnapshot();
    expect(snapshot.player.elevationM).toBeUndefined();
    expect(snapshot.road.laneId).toBe("ground");
    expect(snapshot.road.distanceFromLaneCentreM).toBe(20);
    expect(snapshot.road.offRoad).toBe(true);
  });

  it("keeps stacked traffic on its own elevation and suppresses cross-level contact", () => {
    const simulation = new SimulationCore({
      scenarioId: "stacked-traffic-contact-test",
      trafficSide: "right",
      npcCount: 1,
      lanes: [
        {
          id: "ground",
          points: [{ x: 0, z: -50 }, { x: 0, z: 50 }],
          width: 3.2,
          speedLimitMps: 10,
          loop: false,
        },
        {
          id: "flyover",
          points: [
            { x: 0, z: -50, elevationM: 10.5 },
            { x: 0, z: 50, elevationM: 10.5 },
          ],
          width: 3.2,
          speedLimitMps: 10,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, elevationM: 10.5, heading: 0 },
      trafficGates: [
        {
          id: "ground-car",
          laneId: "ground",
          distance: 50,
          desiredSpeedMps: 6,
        },
      ],
      bounds: { minX: -20, maxX: 20, minZ: -60, maxZ: 60 },
    });

    const initialNpc = simulation.getSnapshot().npcs[0];
    expect(initialNpc).toMatchObject({ laneId: "ground", x: 0, z: 0 });
    expect(initialNpc.elevationM).toBeUndefined();

    simulation.setPlayerPose(
      { x: initialNpc.x, z: initialNpc.z, elevationM: 10.5, heading: 0 },
      5,
    );
    for (let index = 0; index < 30; index += 1) {
      simulation.step(1 / 60);
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.npcs).toHaveLength(1);
    expect(snapshot.npcs[0].z).toBeGreaterThan(initialNpc.z);
    expect(snapshot.player.elevationM).toBeCloseTo(10.5);
    expect(simulation.getEvents().some((event) => event.code === "collision")).toBe(false);
  });

  it("publishes continuously changing NPC elevation on a ramp", () => {
    const simulation = new SimulationCore({
      scenarioId: "npc-ramp-height-test",
      trafficSide: "right",
      npcCount: 1,
      lanes: [
        {
          id: "player-road",
          points: [{ x: 40, z: -60 }, { x: 40, z: 60 }],
          width: 3.2,
          loop: false,
        },
        {
          id: "ramp",
          points: [
            { x: 0, z: -50 },
            { x: 0, z: 50, elevationM: 10 },
          ],
          width: 3.2,
          speedLimitMps: 10,
          loop: false,
        },
      ],
      spawn: { x: 40, z: 0, heading: 0 },
      trafficGates: [
        {
          id: "ramp-car",
          laneId: "ramp",
          distance: 50,
          desiredSpeedMps: 6,
        },
      ],
      bounds: { minX: -20, maxX: 60, minZ: -60, maxZ: 60 },
    });

    const initial = simulation.getSnapshot().npcs[0];
    expect(initial.elevationM).toBeCloseTo(5);
    let previousElevationM = initial.elevationM ?? 0;
    for (let index = 0; index < 60; index += 1) {
      const npc = simulation.step(1 / 60).npcs[0];
      expect(npc).toBeDefined();
      const elevationM = npc.elevationM ?? 0;
      expect(elevationM).toBeGreaterThanOrEqual(previousElevationM);
      expect(elevationM - previousElevationM).toBeLessThan(0.02);
      previousElevationM = elevationM;
    }
    expect(previousElevationM).toBeGreaterThan(5.2);
  });

  it("never tunnels through a wall even at the physics ceiling", () => {
    const simulation = wallAhead(50);
    for (let index = 0; index < 900; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
      expect(simulation.getSnapshot().player.z).toBeLessThan(40 - 1.0);
    }
  });

  it("bonks back off a hard head-on hit", () => {
    const simulation = wallAhead();
    let sawRebound = false;
    for (let index = 0; index < 480; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
      if (simulation.getSnapshot().player.signedSpeedMps < -0.1) {
        sawRebound = true;
        break;
      }
    }
    expect(sawRebound).toBe(true);
  });

  it("lets the car reverse away after a head-on stop", () => {
    const simulation = wallAhead();
    for (let index = 0; index < 360; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const stopped = simulation.getSnapshot().player.z;
    for (let index = 0; index < 240; index += 1) {
      simulation.step(1 / 60, { reverse: 1 });
    }
    expect(simulation.getSnapshot().player.z).toBeLessThan(stopped - 4);
    expect(simulation.getSnapshot().status).toBe("running");
  });

  it("slides along a wall met at a shallow angle instead of sticking", () => {
    const simulation = new SimulationCore({
      scenarioId: "slide-test",
      trafficSide: "right",
      npcCount: 0,
      lanes: [NORTH_LANE],
      // Slight angle toward the wall on the right.
      spawn: { x: 0, z: -80, heading: 0.18 },
      bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
      staticObstacles: [
        {
          kind: "aabb",
          id: "side-wall",
          tag: "building",
          minX: 4,
          maxX: 12,
          minZ: -100,
          maxZ: 100,
        },
      ],
    });
    for (let index = 0; index < 600; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    // Pinned laterally by the wall, but well down the road: sliding, not stuck.
    expect(snapshot.player.x).toBeLessThanOrEqual(4 - 1.0 + 0.01);
    expect(snapshot.player.z).toBeGreaterThan(-30);
  });

  it("emits at most one collision event per contact burst", () => {
    const simulation = wallAhead();
    let firstEventAt: number | null = null;
    for (let index = 0; index < 600; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
      if (
        firstEventAt === null &&
        simulation.getEvents().some((event) => event.code === "collision")
      ) {
        firstEventAt = index;
      }
    }
    expect(firstEventAt).not.toBeNull();
    // Held full throttle against the wall for seconds after the first hit:
    // the stopped car never re-approaches fast enough to crunch again.
    const collisions = simulation
      .getEvents()
      .filter((event) => event.code === "collision");
    expect(collisions).toHaveLength(1);
  });

  it("is deterministic with obstacles present", () => {
    const left = wallAhead();
    const right = wallAhead();
    for (let index = 0; index < 600; index += 1) {
      const input = { throttle: 1, steer: index > 300 ? -0.4 : 0 };
      left.step(1 / 60, input);
      right.step(1 / 60, input);
    }
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
  });
});

/**
 * Synthetic, map-independent solver-corridor probes — plan
 * `.claude/building-collision-visual-parity-plan.md` Section 10.6. These
 * exist to prove `resolveStaticCollisions` itself, not any particular map's
 * geometry: every obstacle here is authored inline. Gap thresholds use
 * explicit clearance rather than equality at a floating boundary, matching
 * the plan's own worked example (van radius 1.05 m: ~2.3 m clearly passes,
 * ~1.9 m clearly does not).
 */
describe("static world collision — corridor and body probes", () => {
  const CORRIDOR_LANE = {
    id: "corridor",
    points: [
      { x: 0, z: -160 },
      { x: 0, z: 220 },
    ],
    width: 40,
    speedLimitMps: 30,
    loop: false,
  };

  /**
   * Two long panels facing the oncoming car (a fence with a gate), either
   * axis-aligned (`thetaRad = 0`) or the whole scene — panels and spawn
   * heading alike — rotated rigidly by `thetaRad`. Rotating everything
   * together is physically identical to the unrotated case (nothing about
   * the corridor changes in its own frame) while genuinely exercising the
   * OBB axis math, since `resolveStaticCollisions` now sees a nonzero
   * `ux`/`uz` — the same world-yaw convention every rotated obstacle in this
   * codebase uses (`worldX = localX*cos + localZ*sin`,
   * `worldZ = -localX*sin + localZ*cos`).
   */
  const gateWorld = (
    gapM: number,
    thetaRad: number,
    spawnOffsetLocalX: number,
    spawnLocalZ: number,
  ): {
    readonly obstacles: StaticObstacle[];
    readonly spawn: { x: number; z: number; heading: number };
  } => {
    const halfGap = gapM / 2;
    const panelHalfWidthM = 20;
    const panelHalfThicknessM = 3;
    const cos = Math.cos(thetaRad);
    const sin = Math.sin(thetaRad);
    const toWorld = (localX: number, localZ: number) => ({
      x: localX * cos + localZ * sin,
      z: -localX * sin + localZ * cos,
    });
    const obstacles: StaticObstacle[] = ([-1, 1] as const).map((side) => {
      const center = toWorld(side * (halfGap + panelHalfWidthM), 0);
      return {
        kind: "obb",
        id: `gate-panel-${side < 0 ? "left" : "right"}`,
        tag: "building",
        x: center.x,
        z: center.z,
        ux: cos,
        uz: -sin,
        halfU: panelHalfWidthM,
        halfV: panelHalfThicknessM,
      };
    });
    const spawnLocal = toWorld(spawnOffsetLocalX, spawnLocalZ);
    return {
      obstacles,
      spawn: { x: spawnLocal.x, z: spawnLocal.z, heading: thetaRad },
    };
  };

  /** Perpendicular distance travelled along the corridor's own (rotated)
   * forward axis — the inverse of `gateWorld`'s local-to-world rotation. */
  const toLocalZ = (worldX: number, worldZ: number, thetaRad: number): number =>
    worldX * Math.sin(thetaRad) + worldZ * Math.cos(thetaRad);

  const GATE_TICKS = 1800;
  const GATE_THROUGH_LOCAL_Z = 20;
  const GATE_BLOCKED_CEILING_LOCAL_Z = 30;

  /** A dead-centre approach exploits a real, narrow limitation of the
   * current position-only iterative solver: two parallel panels each
   * clipped by the capsule's corner (never their broad face) push it
   * sideways with zero along-corridor component, so a sustained-throttle,
   * perfectly-centred car can inch through a gap narrower than its own
   * diameter via that non-decelerating jitter — see the "known corner-slide
   * limitation" test below, which characterizes this deliberately. A
   * realistic approach is never perfectly centred, so every "blocked" case
   * here starts off-axis enough to hit a panel's broad face instead (a real
   * face-on contact, which does decelerate) — verified robust across every
   * body and both approach-speed extremes in this file's own development.
   */
  const BLOCKED_SPAWN_OFFSET_FRACTION = 0.5;

  const runGate = (
    gapM: number,
    thetaRad: number,
    spawnOffsetLocalX: number,
    physics: Partial<SimulationCoreConfig>,
  ) => {
    const { obstacles, spawn } = gateWorld(gapM, thetaRad, spawnOffsetLocalX, -30);
    const sim = new SimulationCore({
      scenarioId: "gate-corridor",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn,
      bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
      staticObstacles: obstacles,
      ...physics,
    });
    for (let index = 0; index < GATE_TICKS; index += 1) {
      sim.step(1 / 60, { throttle: 1 });
    }
    const player = sim.getSnapshot().player;
    return {
      localZ: toLocalZ(player.x, player.z, thetaRad),
      collisions: sim.getEvents().filter((event) => event.code === "collision"),
      status: sim.getSnapshot().status,
    };
  };

  const ROTATIONS = [
    { label: "axis-aligned", thetaDeg: 0 },
    { label: "rotated 25°", thetaDeg: 25 },
  ] as const;

  it.each(ROTATIONS.map((r) => [r.label, r] as const))(
    "%s: a gap of 2x radius + 0.2m passes straight through with no collision event",
    (_label, { thetaDeg }) => {
      const radius = PLAYER_CAPSULE_RADIUS_M;
      const result = runGate(2 * radius + 0.2, (thetaDeg * Math.PI) / 180, 0, {});
      expect(result.collisions).toHaveLength(0);
      expect(result.status).toBe("running");
      expect(result.localZ).toBeGreaterThan(GATE_THROUGH_LOCAL_Z);
    },
  );

  it.each(ROTATIONS.map((r) => [r.label, r] as const))(
    "%s: the same gap narrowed to 2x radius - 0.2m blocks passage",
    (_label, { thetaDeg }) => {
      const radius = PLAYER_CAPSULE_RADIUS_M;
      const result = runGate(
        2 * radius - 0.2,
        (thetaDeg * Math.PI) / 180,
        BLOCKED_SPAWN_OFFSET_FRACTION * radius,
        {},
      );
      expect(result.localZ).toBeLessThan(GATE_BLOCKED_CEILING_LOCAL_Z);
      expect(result.status).toBe("running");
    },
  );

  const BODIES = [
    { label: "default free-drive body", physics: {} },
    {
      label: "bicycle",
      physics: CAREER_VEHICLES.find((vehicle) => vehicle.id === "bicycle")!.physics,
    },
    {
      label: "motorbike",
      physics: CAREER_VEHICLES.find((vehicle) => vehicle.id === "motorbike")!.physics,
    },
    {
      label: "compact car",
      physics: CAREER_VEHICLES.find((vehicle) => vehicle.id === "compact-hatch")!.physics,
    },
    {
      label: "widest van",
      physics: CAREER_VEHICLES.find((vehicle) => vehicle.id === "delivery-van")!.physics,
    },
  ] as const;

  it.each(BODIES.map((b) => [b.label, b] as const))(
    "%s passes a straight gap of 2x its own radius + 0.2m",
    (_label, { physics }) => {
      const radius = "playerCapsuleRadiusM" in physics
        ? (physics.playerCapsuleRadiusM as number)
        : PLAYER_CAPSULE_RADIUS_M;
      const result = runGate(2 * radius + 0.2, 0, 0, physics);
      expect(result.collisions).toHaveLength(0);
      expect(result.localZ).toBeGreaterThan(GATE_THROUGH_LOCAL_Z);
    },
  );

  it.each(BODIES.map((b) => [b.label, b] as const))(
    "%s is blocked by a gap of 2x its own radius - 0.2m",
    (_label, { physics }) => {
      const radius = "playerCapsuleRadiusM" in physics
        ? (physics.playerCapsuleRadiusM as number)
        : PLAYER_CAPSULE_RADIUS_M;
      const result = runGate(
        2 * radius - 0.2,
        0,
        BLOCKED_SPAWN_OFFSET_FRACTION * radius,
        physics,
      );
      expect(result.localZ).toBeLessThan(GATE_BLOCKED_CEILING_LOCAL_Z);
    },
  );

  it("passes a legal opening cleanly even at the physics ceiling", () => {
    const radius = PLAYER_CAPSULE_RADIUS_M;
    const result = runGate(2 * radius + 0.2, 0, 0, { maxForwardSpeedMps: 50 });
    expect(result.collisions).toHaveLength(0);
    expect(result.localZ).toBeGreaterThan(GATE_THROUGH_LOCAL_Z);
  });

  it("never tunnels through a thin OBB wall even at the physics ceiling", () => {
    const sim = new SimulationCore({
      scenarioId: "thin-wall-max-speed",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -80, maxX: 80, minZ: -120, maxZ: 120 },
      maxForwardSpeedMps: 50,
      staticObstacles: [
        {
          kind: "obb",
          id: "thin-wall",
          tag: "building",
          x: 0,
          z: 50,
          ux: 1,
          uz: 0,
          halfU: 30,
          halfV: 0.15,
        },
      ],
    });
    for (let index = 0; index < 400; index += 1) {
      sim.step(1 / 60, { throttle: 1 });
      expect(sim.getSnapshot().player.z).toBeLessThan(50 - 0.15);
    }
  });

  it("decelerates and stops a 45 degree approach without tunneling", () => {
    const sim = new SimulationCore({
      scenarioId: "heading-45",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn: { x: -30, z: 0, heading: Math.PI / 4 },
      bounds: { minX: -80, maxX: 80, minZ: -120, maxZ: 120 },
      staticObstacles: [
        { kind: "aabb", id: "angled-wall", tag: "building", minX: -40, maxX: 40, minZ: 40, maxZ: 60 },
      ],
    });
    let maxZ = -Infinity;
    for (let index = 0; index < 600; index += 1) {
      sim.step(1 / 60, { throttle: 1 });
      maxZ = Math.max(maxZ, sim.getSnapshot().player.z);
    }
    expect(maxZ).toBeLessThan(40);
    expect(sim.getSnapshot().status).toBe("running");
    const collision = sim
      .getEvents()
      .find((event) => event.code === "collision");
    expect(collision?.evidence.obstacleId).toBe("angled-wall");
  });

  it("stops without tunneling when steered into a side wall mid-drive", () => {
    const sim = new SimulationCore({
      scenarioId: "turn-in",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -80, maxX: 80, minZ: -120, maxZ: 220 },
      staticObstacles: [
        { kind: "aabb", id: "turn-in-wall", tag: "building", minX: 8, maxX: 30, minZ: -20, maxZ: 200 },
      ],
    });
    let maxX = -Infinity;
    for (let index = 0; index < 600; index += 1) {
      sim.step(1 / 60, { throttle: 1, steer: index > 40 ? 0.5 : 0 });
      maxX = Math.max(maxX, sim.getSnapshot().player.x);
    }
    expect(maxX).toBeLessThan(8);
    expect(sim.getSnapshot().status).toBe("running");
  });

  it("stops without tunneling when reversing into a wall behind the car", () => {
    const sim = new SimulationCore({
      scenarioId: "reverse-into-wall",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -80, maxX: 80, minZ: -120, maxZ: 120 },
      staticObstacles: [
        { kind: "aabb", id: "rear-wall", tag: "building", minX: -30, maxX: 30, minZ: -60, maxZ: -40 },
      ],
    });
    let minZ = Infinity;
    for (let index = 0; index < 480; index += 1) {
      sim.step(1 / 60, { reverse: 1 });
      minZ = Math.min(minZ, sim.getSnapshot().player.z);
    }
    expect(minZ).toBeGreaterThan(-40);
    const collision = sim
      .getEvents()
      .find((event) => event.code === "collision");
    expect(collision?.evidence.obstacleId).toBe("rear-wall");
  });

  it("blocks a long vehicle that fits a pocket by width but not by length", () => {
    // Pocket depth sits between the default body's own total length
    // (2 x (halfLength + radius) = 4.3 m) and the van's (5.0 m) — width is
    // generous for either. The default body should fully clear the mouth;
    // the van's rear should still be sticking out of it.
    const widthM = 3.5;
    const depthM = 4.6;
    const halfW = widthM / 2;
    const pocket: StaticObstacle[] = [
      { kind: "aabb", id: "pocket-back", tag: "building", minX: -halfW, maxX: halfW, minZ: depthM, maxZ: depthM + 2 },
      { kind: "aabb", id: "pocket-side-left", tag: "building", minX: -halfW - 2, maxX: -halfW, minZ: 0, maxZ: depthM + 2 },
      { kind: "aabb", id: "pocket-side-right", tag: "building", minX: halfW, maxX: halfW + 2, minZ: 0, maxZ: depthM + 2 },
    ];
    const runPocket = (physics: Partial<SimulationCoreConfig>) => {
      const sim = new SimulationCore({
        scenarioId: "pocket",
        trafficSide: "right",
        npcCount: 0,
        lanes: [CORRIDOR_LANE],
        spawn: { x: 0, z: -20, heading: 0 },
        bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
        staticObstacles: pocket,
        ...physics,
      });
      for (let index = 0; index < 600; index += 1) sim.step(1 / 60, { throttle: 0.5 });
      const halfLength =
        "playerCapsuleHalfLengthM" in physics
          ? (physics.playerCapsuleHalfLengthM as number)
          : 1.15;
      const radius =
        "playerCapsuleRadiusM" in physics
          ? (physics.playerCapsuleRadiusM as number)
          : PLAYER_CAPSULE_RADIUS_M;
      return sim.getSnapshot().player.z - halfLength - radius;
    };
    expect(runPocket({})).toBeGreaterThanOrEqual(0);
    expect(
      runPocket(CAREER_VEHICLES.find((vehicle) => vehicle.id === "delivery-van")!.physics),
    ).toBeLessThan(0);
  });

  it("resolves a concave corner hit from two walls at once without tunneling through either", () => {
    const DIAGONAL_LANE = {
      id: "diagonal",
      points: [
        { x: -60, z: -60 },
        { x: 60, z: 60 },
      ],
      width: 30,
      speedLimitMps: 30,
      loop: false,
    };
    const sim = new SimulationCore({
      scenarioId: "concave-corner",
      trafficSide: "right",
      npcCount: 0,
      lanes: [DIAGONAL_LANE],
      // Heading 45°: forward = (sin45, cos45), driving toward +x and +z at once.
      spawn: { x: -15, z: -15, heading: Math.PI / 4 },
      bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
      staticObstacles: [
        { kind: "aabb", id: "corner-wall-a", tag: "building", minX: 5, maxX: 25, minZ: -20, maxZ: 40 },
        { kind: "aabb", id: "corner-wall-b", tag: "building", minX: -40, maxX: 5, minZ: 5, maxZ: 25 },
      ],
    });
    for (let index = 0; index < 600; index += 1) {
      sim.step(1 / 60, { throttle: 1 });
      const player = sim.getSnapshot().player;
      expect(player.x, `tick ${index}`).toBeLessThan(5);
      expect(player.z, `tick ${index}`).toBeLessThan(5);
    }
    expect(sim.getSnapshot().status).toBe("running");
  });

  it("keeps resolving a second, distinct-in-time wall contact while the event cooldown suppresses its duplicate", () => {
    // Section 10.6: "During the global event cooldown, physical resolution
    // still occurs but duplicate damage evidence does not." Approach, bonk
    // to a stop (one event, starting the "collision" rule's cooldown),
    // reverse away, then floor it again into the SAME wall while still
    // inside that cooldown window (2.5 s = 150 fixed steps) — the second
    // approach reaches a clearly event-worthy speed (verified > 2 m/s, the
    // event threshold) before stopping again, but produces no second event.
    const APPROACH_END = 142;
    const REVERSE_END = 202;
    const TOTAL_TICKS = 320;
    const sim = new SimulationCore({
      scenarioId: "cooldown-reapproach",
      trafficSide: "right",
      npcCount: 0,
      lanes: [CORRIDOR_LANE],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -60, maxX: 60, minZ: -80, maxZ: 220 },
      staticObstacles: [
        { kind: "aabb", id: "reapproached-wall", tag: "building", minX: -30, maxX: 30, minZ: 15, maxZ: 35 },
      ],
    });
    let maxZ = -Infinity;
    let secondApproachSpeed: number | null = null;
    for (let index = 0; index < TOTAL_TICKS; index += 1) {
      const input =
        index < APPROACH_END
          ? { throttle: 1 }
          : index < REVERSE_END
            ? { reverse: 1 }
            : { throttle: 1 };
      sim.step(1 / 60, input);
      const player = sim.getSnapshot().player;
      maxZ = Math.max(maxZ, player.z);
      if (index > REVERSE_END && player.z > 12.5 && player.signedSpeedMps > 1) {
        secondApproachSpeed ??= player.signedSpeedMps;
      }
    }
    // Never penetrated the wall face (z=15) on either approach.
    expect(maxZ).toBeLessThan(15 - PLAYER_CAPSULE_RADIUS_M);
    const collisions = sim.getEvents().filter((event) => event.code === "collision");
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.evidence.obstacleId).toBe("reapproached-wall");
    // The second approach really was fast enough to be event-worthy on its
    // own — this isn't just "it happened to coast in slowly the second time".
    expect(secondApproachSpeed).not.toBeNull();
    expect(secondApproachSpeed as number).toBeGreaterThan(2);
  });

  describe("known central-notch limitation (plan Section 7.11)", () => {
    // "The current capsule is only two endpoint circles, not a connecting
    // segment. It can miss a thin object at the vehicle's middle." This is a
    // known, accepted limitation as of this migration, not something Phase 4
    // fixes — characterized here so a future Phase 7 decision has a baseline.
    // Capsule half-length 1.15 m + radius 1.0 m = 1.15 m reach from the
    // player's own centre to either endpoint circle's own edge; an obstacle
    // whose own radius keeps the summed reach at or under that leaves a
    // genuine gap neither circle detects.
    const buildNotch = (radius: number) =>
      new SimulationCore({
        scenarioId: "central-notch",
        trafficSide: "right",
        npcCount: 0,
        lanes: [CORRIDOR_LANE],
        spawn: { x: 0, z: 0, heading: 0 },
        bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
        staticObstacles: [
          { kind: "circle", id: "central-notch", tag: "building", x: 0, z: 0, radius },
        ],
      });

    it("misses a thin obstacle exactly between the capsule's two endpoint circles", () => {
      const sim = buildNotch(0.05);
      for (let index = 0; index < 30; index += 1) sim.step(1 / 60, {});
      expect(sim.getSnapshot().player).toMatchObject({ x: 0, z: 0 });
      expect(sim.getEvents()).toHaveLength(0);
    });

    it("catches the same spot once the obstacle reaches an endpoint circle", () => {
      const sim = buildNotch(0.35);
      for (let index = 0; index < 30; index += 1) sim.step(1 / 60, {});
      const player = sim.getSnapshot().player;
      expect(Math.hypot(player.x, player.z)).toBeGreaterThan(0.1);
    });
  });
});

describe("open-world crash response with traffic", () => {
  const crashConfig = () =>
    new SimulationCore({
      scenarioId: "npc-crash-test",
      trafficSide: "right",
      seed: 7,
      npcCount: 1,
      lanes: [
        {
          id: "crash-lane",
          points: [
            { x: 0, z: -40 },
            { x: 0, z: 400 },
          ],
          width: 8,
          speedLimitMps: 30,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -30, heading: 0 },
      bounds: { minX: -40, maxX: 40, minZ: -60, maxZ: 420 },
      // One crawling car ahead in the same lane; the player runs into it.
      trafficGates: [
        {
          id: "crawler-gate",
          laneId: "crash-lane",
          distance: 100,
          desiredSpeedMps: 1,
          allowInitialSpawn: true,
        },
      ],
    });

  it("knocks the struck car askew, holds it, then releases it", () => {
    const simulation = crashConfig();
    let crashTick: number | null = null;
    for (let index = 0; index < 1200; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
      const collision = simulation
        .getEvents()
        .find((event) => event.code === "collision");
      if (collision) {
        crashTick = index;
        break;
      }
    }
    expect(crashTick).not.toBeNull();
    const atCrash = simulation.getSnapshot();
    expect(atCrash.status).toBe("running");
    const struck = atCrash.npcs[0];
    expect(struck).toBeDefined();
    // Knocked visibly askew relative to the lane heading (0 = due north).
    expect(Math.abs(struck.heading)).toBeGreaterThan(0.1);
    // Holds position for the struck window (~6 s), no drive-through.
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60, {});
    }
    const held = simulation.getSnapshot().npcs[0];
    expect(held.speedMps).toBe(0);
    expect(Math.hypot(held.x - struck.x, held.z - struck.z)).toBeLessThan(0.2);
    // After the hold expires the car straightens out and pulls away.
    for (let index = 0; index < 600; index += 1) {
      simulation.step(1 / 60, {});
    }
    const released = simulation.getSnapshot().npcs[0];
    expect(released.speedMps).toBeGreaterThan(0.2);
    expect(Math.abs(released.heading)).toBeLessThan(0.05);
  });

  it("scrubs the player's speed on impact instead of resetting the drive", () => {
    const simulation = crashConfig();
    let preImpactSpeed = 0;
    let postImpactSpeed = Number.POSITIVE_INFINITY;
    for (let index = 0; index < 1200; index += 1) {
      const before = simulation.getSnapshot().player.signedSpeedMps;
      simulation.step(1 / 60, { throttle: 1 });
      const collision = simulation
        .getEvents()
        .find((event) => event.code === "collision");
      if (collision) {
        preImpactSpeed = before;
        postImpactSpeed = simulation.getSnapshot().player.signedSpeedMps;
        break;
      }
    }
    expect(preImpactSpeed).toBeGreaterThan(5);
    // Hard hit: the car rebounds slightly (negative) or crawls (<25%).
    expect(postImpactSpeed).toBeLessThan(preImpactSpeed * 0.3);
  });

  it("still recovers NPC-fault contacts without emitting a player collision", () => {
    // Mirrors the stationary-player invariant the acceptance suite relies on:
    // a legally stopped player rear-ended by traffic must never be penalised.
    const simulation = crashConfig();
    for (let index = 0; index < 600; index += 1) {
      simulation.step(1 / 60, {});
    }
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(
      simulation.getEvents().filter((event) => event.code === "collision"),
    ).toHaveLength(0);
  });
});

describe("ambient traffic reads the limit of the road it is on", () => {
  /**
   * A closed rectangle split into two L-shaped lanes, one posted four times
   * faster than the other. Ambient drivers draw a fraction of the posted limit
   * at spawn and used to keep the resulting *speed* for life, so a car that
   * started on the fast lane carried that speed round the slow one — invisible
   * while every road on a map shared one limit, and wrong the moment they
   * stopped doing so.
   */
  const loopConfig = () =>
    new SimulationCore({
      seed: 11,
      npcCount: 1,
      lanes: [
        {
          id: "fast",
          points: [
            { x: -100, z: -100 },
            { x: 100, z: -100 },
            { x: 100, z: 100 },
          ],
          width: 8,
          speedLimitMps: 24,
          successorLaneIds: ["slow"],
        },
        {
          id: "slow",
          points: [
            { x: 100, z: 100 },
            { x: -100, z: 100 },
            { x: -100, z: -100 },
          ],
          width: 8,
          speedLimitMps: 6,
          successorLaneIds: ["fast"],
        },
      ],
      // Spawn at the top of the fast lane so the car has its whole length to
      // get up to speed before the corner into the slow one.
      trafficGates: [{ id: "gate", laneId: "fast", distance: 5 }],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -160, maxX: 160, minZ: -160, maxZ: 160 },
    });

  const settledSpeedOn = (laneId: string): number => {
    const simulation = loopConfig();
    let recorded = 0;
    let secondsOnLane = 0;
    for (let index = 0; index < 6000; index += 1) {
      simulation.step(1 / 60, {});
      const npc = simulation.getSnapshot().npcs[0];
      if (!npc || npc.laneId !== laneId) {
        secondsOnLane = 0;
        continue;
      }
      secondsOnLane += 1 / 60;
      // Sample once it has had time to settle onto the new road rather than
      // mid-deceleration into it.
      if (secondsOnLane > 6) recorded = Math.max(recorded, npc.speedMps);
    }
    return recorded;
  };

  it("cruises near the posted limit on a fast road", () => {
    // The spawn draw is 68-92% of the limit, so 24 m/s lands in 16.3-22.1.
    const fast = settledSpeedOn("fast");
    expect(fast).toBeGreaterThan(24 * 0.6);
    expect(fast).toBeLessThanOrEqual(24 * 1.05);
  });

  it("slows to the new limit after turning onto a slower road", () => {
    // The regression: this used to sit up at the fast lane's figure.
    const slow = settledSpeedOn("slow");
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThanOrEqual(6 * 1.05);
  });
});

describe("reportExternalContact", () => {
  it("scrubs speed and records a collision event", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    const before = simulation.getSnapshot().player.signedSpeedMps;
    expect(before).toBeGreaterThan(3);
    const reported = simulation.reportExternalContact(
      "Keep the car off the kerb and clear of people on foot.",
      0.75,
      { roadUserType: "pedestrian", impactSpeedMps: Math.round(before) },
    );
    expect(reported).toBe(true);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.player.signedSpeedMps).toBeCloseTo(before * 0.75, 5);
    const collision = simulation
      .getEvents()
      .find((event) => event.code === "collision");
    expect(collision?.correction).toBe(
      "Keep the car off the kerb and clear of people on foot.",
    );
    expect(collision?.evidence).toMatchObject({ externalRoadUser: true });
  });

  it("still applies the physical scrub when the event cooldown swallows a repeat", () => {
    const simulation = new SimulationCore({ npcCount: 0 });
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }
    simulation.reportExternalContact("Slow down.", 0.75);
    const between = simulation.getSnapshot().player.signedSpeedMps;
    const again = simulation.reportExternalContact(
      "Slow down.",
      0.5,
    );
    expect(again).toBe(true);
    expect(simulation.getSnapshot().player.signedSpeedMps).toBeCloseTo(
      between * 0.5,
      5,
    );
    expect(
      simulation.getEvents().filter((event) => event.code === "collision"),
    ).toHaveLength(1);
  });
});
