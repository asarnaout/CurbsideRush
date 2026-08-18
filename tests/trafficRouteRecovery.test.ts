import { describe, expect, it } from "vitest";

import { FIXED_STEP_SECONDS, SimulationCore } from "../app/game/simulation";

describe("traffic route recovery", () => {
  it("takes the next stable continuous successor before requesting recycle", () => {
    const simulation = new SimulationCore({
      seed: 17,
      npcCount: 1,
      bounds: { minX: -1_100, maxX: 700, minZ: -30, maxZ: 30 },
      spawn: { x: -1_000, z: 0, heading: Math.PI / 2 },
      lanes: [
        {
          id: "source",
          points: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
          speedLimitMps: 20,
          successorLaneIds: ["discontinuous", "continuous"],
          loop: false,
        },
        {
          id: "discontinuous",
          points: [{ x: 500, z: 0 }, { x: 600, z: 0 }],
          speedLimitMps: 20,
          loop: false,
        },
        {
          id: "continuous",
          points: [{ x: 100, z: 0 }, { x: 400, z: 0 }],
          speedLimitMps: 20,
          loop: false,
        },
      ],
      trafficGates: [
        {
          id: "source-car",
          laneId: "source",
          distance: 90,
          variant: "car",
          desiredSpeedMps: 20,
        },
      ],
      minRuntimeSpawnDistanceM: 70,
    });
    try {
      for (let tick = 0; tick < 90; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS);
      }
      expect(simulation.getSnapshot().npcs[0]).toMatchObject({
        laneId: "continuous",
      });
      expect(simulation.getTrafficDiagnostics().locality.pendingRecycleCount).toBe(0);
    } finally {
      simulation.dispose();
    }
  });
});
