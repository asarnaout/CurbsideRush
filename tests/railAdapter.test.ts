import { describe, expect, it } from "vitest";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { buildRailLines } from "../app/game/simulationAdapter";
import { SimulationCore } from "../app/game/simulation";

describe("rail line adapter plumbing (Tokyo)", () => {
  it("projects both authored crossings onto the line where their roads cross it", () => {
    const rail = buildRailLines(TOKYO_MAP_PACK);
    expect(rail.lines).toHaveLength(1);
    const line = rail.lines[0];
    expect(line.id).toBe("jp-setagaya-line-run");
    // Stub (94 m) + two corner chords (~6.1 m each) + straight to the east
    // map edge at x=1306.
    expect(line.lengthM).toBeGreaterThan(1382);
    expect(line.lengthM).toBeLessThan(1391);

    const crossing1 = rail.crossingByControlId.get("jp-rail-signal");
    const crossing2 = rail.crossingByControlId.get("jp-rail-signal-2");
    // Yamashita St crosses the stub 40 m from the terminus buffer.
    expect(crossing1?.crossingDistanceM).toBeCloseTo(40, 0);
    // Ichiban-dōri crosses the east run at x=180.
    expect(crossing2?.crossingDistanceM).toBeCloseTo(260.3, 0);
  });

  it("drives the crossing heads from the timetable instead of the legacy free-run cycle", () => {
    // A minimal core: one straight lane under the first crossing so the
    // adapter's per-approach lights resolve, fed with the real Tokyo rail
    // config. Sampling the light state at known timetable moments checks the
    // whole chain: content -> adapter projection -> normalized windows ->
    // trafficLightTiming.
    const rail = buildRailLines(TOKYO_MAP_PACK);
    const core = new SimulationCore({
      lanes: [
        {
          id: "test-lane",
          points: [
            { x: -60, z: -72 },
            { x: 60, z: -72 },
          ],
        },
      ],
      trafficLights: [
        {
          id: "crossing-head",
          x: 18,
          z: -72,
          rail: { lineId: "jp-setagaya-line-run", crossingDistanceM: 40 },
        },
      ],
      stopLines: [
        {
          id: "crossing-line",
          laneId: "test-lane",
          distance: 70,
          kind: "railway",
          trafficLightId: "crossing-head",
        },
      ],
      railLines: rail.lines,
    });

    const statesAt = (seconds: number) => {
      // The tram departs the terminus at t=0, 40 m short of the crossing:
      // the warning is already up (lead 8 s > 40 m / 8.5 m/s), clears once
      // the tail passes, and comes back for the return working — on the
      // full-length line (travel ~160 s + 22 s dwell each way) that return
      // pass covers this crossing around t=335.
      const light = core
        .getSnapshot()
        .trafficLights.find((candidate) => candidate.id === "crossing-head");
      return { seconds, state: light?.state };
    };

    const sample = (target: number) => {
      const state = core.getSnapshot();
      const remaining = target * 1000 - state.elapsedMs;
      for (let step = 0; step < Math.round(remaining / (1000 / 60)); step += 1) {
        core.step(1 / 60, {});
      }
      return statesAt(target).state;
    };

    expect(sample(1)).toBe("red"); // departing across the crossing
    expect(sample(30)).toBe("green"); // tram off east, line clear
    expect(sample(335)).toBe("red"); // return working on the crossing
    expect(sample(350)).toBe("green"); // parked back at the terminus
  });
});
