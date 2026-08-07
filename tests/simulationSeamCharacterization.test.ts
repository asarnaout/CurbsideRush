import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, SimulationCore } from "../app/game/simulation";

/**
 * Issue #284: `app/game/simulation.ts` is being split into
 * `app/game/simulation/{roadNetwork,playerDynamics,trafficSystem,roadRuleMonitor}.ts`.
 * These tests exist to catch a subtly-wrong extraction with a fast, local
 * failure instead of only a 2-minute-in acceptance-sweep trace-hash mismatch.
 *
 * Every test here goes through `SimulationCore`'s public API only
 * (constructor config, `step`/`setPlayerPose`, `getSnapshot`/`getEvents`) —
 * never an internal method — so the same assertions keep working unchanged
 * whichever module ends up owning the code underneath. Exact numeric values
 * were captured by running each scenario once against the pre-#284,
 * unmodified `simulation.ts` and reading back the real output (the same
 * technique `trafficTraceCharacterization.test.ts` uses for its hash
 * literals) — they are recorded current behaviour, not independently
 * re-derived physics, so a passing run here is proof the test is a real
 * characterization and not a tautology. `toBeCloseTo(..., 9)` throughout:
 * tight enough that no real behaviour change could slip through unnoticed,
 * loose enough to survive a 1-ULP cross-platform difference in a
 * Math.sin/cos/atan2 chain between this machine and CI's.
 */

describe("seam: player dynamics — straight-line accel and drag", () => {
  it("reaches an exact pose and speed after 5 ticks of full throttle from rest", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [],
      bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    });
    for (let index = 0; index < 5; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
    }
    const player = simulation.getSnapshot().player;
    expect(player.signedSpeedMps).toBeCloseTo(0.3984193723971676, 9);
    expect(player.x).toBeCloseTo(0, 9);
    expect(player.z).toBeCloseTo(0.01993757979993923, 9);
    expect(player.heading).toBe(0);
    expect(player.distanceTravelledM).toBeCloseTo(0.01993757979993923, 9);
    expect(player.gear).toBe("drive");
  });

  it("steers to an exact heading and position over 10 ticks at speed", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [],
      bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    });
    for (let index = 0; index < 30; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
    }
    for (let index = 0; index < 10; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1, steer: 0.5 });
    }
    const player = simulation.getSnapshot().player;
    expect(player.heading).toBeCloseTo(0.06661215959256413, 9);
    expect(player.x).toBeCloseTo(0.017224436108507032, 9);
    expect(player.z).toBeCloseTo(1.0738001801388628, 9);
  });

  it("emits exactly one observation event at the exact tick instability crosses threshold", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [],
      bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
      instabilityLateralMps2: 3,
    });
    let observedAtTick = -1;
    for (let index = 0; index < 200; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1, steer: 0.9 });
      if (observedAtTick < 0 && simulation.getEvents().some((event) => event.code === "observation")) {
        observedAtTick = index;
      }
    }
    expect(observedAtTick).toBe(82);
    const event = simulation.getEvents().find((candidate) => candidate.code === "observation");
    expect(event?.evidence.lateralAccelerationMps2).toBeCloseTo(10.2, 9);
  });
});

describe("seam: player dynamics — static collision response", () => {
  const wallConfig = () => ({
    npcCount: 0,
    lanes: [
      {
        id: "main-street",
        points: [{ x: 0, z: -100 }, { x: 0, z: 100 }],
        width: 20,
        speedLimitMps: 30,
        loop: false,
      },
    ],
    spawn: { x: 0, z: 0, heading: 0 },
    bounds: { minX: -60, maxX: 60, minZ: -120, maxZ: 120 },
    staticObstacles: [
      {
        kind: "aabb" as const,
        id: "front-wall",
        tag: "building" as const,
        minX: -30,
        maxX: 30,
        minZ: 40,
        maxZ: 60,
      },
    ],
  });

  it("hits the wall at an exact tick with an exact rebound speed", () => {
    const simulation = new SimulationCore(wallConfig());
    let impactTick = -1;
    let reboundSpeedMps = Number.NaN;
    for (let index = 0; index < 480; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
      if (impactTick < 0 && simulation.getEvents().some((event) => event.code === "collision")) {
        impactTick = index;
        reboundSpeedMps = simulation.getSnapshot().player.signedSpeedMps;
      }
    }
    expect(impactTick).toBe(250);
    // -1.2 is exactly STATIC_BONK_REBOUND_MAX_MPS: the closing speed here is
    // fast enough that the rebound formula saturates at its cap.
    expect(reboundSpeedMps).toBeCloseTo(-1.2, 9);
    const collision = simulation.getEvents().find((event) => event.code === "collision");
    expect(collision?.evidence.impactSpeedMps).toBeCloseTo(17.2, 9);
  });

  it("settles at an exact resting position against the wall", () => {
    const simulation = new SimulationCore(wallConfig());
    for (let index = 0; index < 480; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
    }
    const player = simulation.getSnapshot().player;
    expect(player.z).toBeCloseTo(37.85, 9);
    expect(player.x).toBeCloseTo(0, 9);
  });
});

describe("seam: road network — lane projection and traffic-light timing", () => {
  it("projects an off-centre spawn to an exact lane-centre distance", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "offset-lane",
          points: [{ x: 0, z: -50 }, { x: 0, z: 50 }],
          width: 6,
          loop: false,
        },
      ],
      spawn: { x: 1.3, z: 0, heading: 0 },
      bounds: { minX: -30, maxX: 30, minZ: -60, maxZ: 60 },
    });
    const road = simulation.getSnapshot().road;
    expect(road.laneId).toBe("offset-lane");
    expect(road.distanceFromLaneCentreM).toBeCloseTo(1.3, 12);
  });

  it("times a signal phase to an exact seconds-until-change value", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [{ id: "signal-lane", points: [{ x: 0, z: 0 }, { x: 0, z: 100 }], loop: false }],
      spawn: { x: 0, z: 10, heading: 0 },
      trafficLights: [
        {
          id: "timed-light",
          phaseGroup: "test",
          x: 0,
          z: 50,
          cycle: {
            greenSeconds: 9,
            amberSeconds: 2,
            allRedSeconds: 1,
            redSeconds: 9,
            redAmberSeconds: 0,
          },
        },
      ],
    });
    for (let index = 0; index < 47; index += 1) simulation.step(FIXED_STEP_SECONDS);
    const light = simulation.getSnapshot().trafficLights[0];
    expect(light.state).toBe("green");
    expect(light.secondsUntilChange).toBeCloseTo(8.216666666666665, 9);
  });
});

describe("seam: traffic system — deterministic NPC spawn and first decision", () => {
  const trafficConfig = () => ({
    seed: 909,
    npcCount: 1,
    lanes: [
      {
        id: "spawn-lane",
        points: [{ x: 0, z: 0 }, { x: 0, z: 300 }],
        width: 6,
        speedLimitMps: 15,
        loop: false,
      },
    ],
    spawn: { x: 30, z: 0, heading: 0 },
    bounds: { minX: -30, maxX: 60, minZ: -10, maxZ: 310 },
    trafficGates: [{ id: "draw-gate", laneId: "spawn-lane", distance: 50 }],
  });

  it("spawns the NPC at an exact pose and speed for a fixed seed, before any step", () => {
    const simulation = new SimulationCore(trafficConfig());
    const npc = simulation.getSnapshot().npcs[0];
    expect(npc).toMatchObject({ id: "npc-1", laneId: "spawn-lane", variant: "van" });
    expect(npc.x).toBeCloseTo(0, 9);
    expect(npc.z).toBeCloseTo(50, 9);
    expect(npc.heading).toBeCloseTo(0, 9);
    expect(npc.speedMps).toBeCloseTo(5.720391053105705, 9);
    expect(npc.state).toBe("cruising");
  });

  it("reaches an exact pose after 6 ticks, crossing one traffic-decision boundary", () => {
    const simulation = new SimulationCore(trafficConfig());
    for (let index = 0; index < 6; index += 1) simulation.step(FIXED_STEP_SECONDS);
    const npc = simulation.getSnapshot().npcs[0];
    expect(npc.z).toBeCloseTo(50.584872438643906, 9);
    expect(npc.speedMps).toBeCloseTo(5.940391053105707, 9);
    expect(npc.state).toBe("cruising");
  });
});

describe("seam: road rule monitor — speeding accumulation timing", () => {
  it("emits a speeding event at an exact tick with exact evidence", () => {
    const simulation = new SimulationCore({
      npcCount: 0,
      lanes: [
        {
          id: "fast-lane",
          points: [{ x: 0, z: -50 }, { x: 0, z: 500 }],
          width: 6,
          speedLimitMps: 13.4,
          loop: false,
        },
      ],
      spawn: { x: 0, z: 0, heading: 0 },
      bounds: { minX: -30, maxX: 30, minZ: -60, maxZ: 560 },
    });
    simulation.setPlayerPose({ x: 0, z: 0, heading: 0 }, 20);
    let eventTick = -1;
    for (let index = 0; index < 300; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
      if (eventTick < 0 && simulation.getEvents().some((event) => event.code === "speeding")) {
        eventTick = index;
      }
    }
    expect(eventTick).toBe(132);
    const event = simulation.getEvents().find((candidate) => candidate.code === "speeding");
    expect(event?.evidence.limitMps).toBeCloseTo(13.4, 9);
    // The car keeps accelerating under full throttle while the violation
    // accumulates, so by the time it fires it has reached the physics
    // ceiling (maxForwardSpeedMps), not the 20 m/s it was set to initially.
    expect(event?.evidence.speedMps).toBeCloseTo(22, 9);
  });
});

describe("seam: checkCollisions — player/NPC impact stays in the facade", () => {
  it("strikes the NPC at an exact tick, holds it for exactly NPC_STRUCK_TICKS, then releases", () => {
    const simulation = new SimulationCore({
      scenarioId: "npc-crash-seam-test",
      trafficSide: "right",
      seed: 7,
      npcCount: 1,
      lanes: [
        {
          id: "crash-lane",
          points: [{ x: 0, z: -40 }, { x: 0, z: 400 }],
          width: 8,
          speedLimitMps: 30,
          loop: false,
        },
      ],
      spawn: { x: 0, z: -30, heading: 0 },
      bounds: { minX: -40, maxX: 40, minZ: -60, maxZ: 420 },
      trafficGates: [
        { id: "crawler-gate", laneId: "crash-lane", distance: 100, desiredSpeedMps: 1, allowInitialSpawn: true },
      ],
    });
    let crashTick = -1;
    for (let index = 0; index < 1200; index += 1) {
      simulation.step(FIXED_STEP_SECONDS, { throttle: 1 });
      if (crashTick < 0 && simulation.getEvents().some((event) => event.code === "collision")) {
        crashTick = simulation.getSnapshot().tick;
        break;
      }
    }
    expect(crashTick).toBe(415);
    const atImpact = simulation.getSnapshot().player.signedSpeedMps;
    expect(atImpact).toBeCloseTo(-1.2, 9);

    // NPC_STRUCK_TICKS is 360: still held the tick before release, moving
    // again the tick it elapses. This pins `struckUntilTick = tick + 360`
    // exactly, wherever that arithmetic ends up living.
    for (let index = 0; index < 359; index += 1) simulation.step(FIXED_STEP_SECONDS, {});
    expect(simulation.getSnapshot().npcs[0].speedMps).toBe(0);
    simulation.step(FIXED_STEP_SECONDS, {});
    expect(simulation.getSnapshot().tick).toBe(crashTick + 360);
  });
});
