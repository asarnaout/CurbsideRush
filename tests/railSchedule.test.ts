import { describe, expect, it } from "vitest";
import {
  railCrossingSignalAt,
  railCrossingWarningWindows,
  railCyclePeriodSeconds,
  railTrainStatesAt,
  type SimulationRailLine,
} from "../app/game/simulation/railSchedule";

const THROUGH_LINE: SimulationRailLine = {
  id: "test-through",
  lengthM: 1000,
  schedule: {
    mode: "through",
    speedMps: 10,
    trainLengthM: 60,
    headwaySeconds: 300,
    warningLeadSeconds: 8,
    clearTrailSeconds: 2,
  },
};

const SHUTTLE_LINE: SimulationRailLine = {
  id: "test-shuttle",
  lengthM: 400,
  schedule: {
    mode: "shuttle",
    speedMps: 10,
    trainLengthM: 40,
    dwellSeconds: 20,
    warningLeadSeconds: 8,
    clearTrailSeconds: 2,
  },
};

describe("railSchedule through mode", () => {
  it("moves one train across the line and clips its span to the track", () => {
    // At t=30 the eastbound front is at 300; the consist occupies [240, 300].
    const trains = railTrainStatesAt(THROUGH_LINE, 30);
    expect(trains).toHaveLength(1);
    expect(trains[0].frontM).toBeCloseTo(300);
    expect(trains[0].direction).toBe(1);
    expect(trains[0].occupiedFromM).toBeCloseTo(240);
    expect(trains[0].occupiedToM).toBeCloseTo(300);

    // At t=2 the train is still mostly off-line: span clips at 0.
    const entering = railTrainStatesAt(THROUGH_LINE, 2);
    expect(entering[0].occupiedFromM).toBe(0);
    expect(entering[0].occupiedToM).toBeCloseTo(20);
  });

  it("runs the opposite direction half a headway later", () => {
    // Westbound departs at t=150 from the far end.
    const trains = railTrainStatesAt(THROUGH_LINE, 160);
    expect(trains).toHaveLength(1);
    expect(trains[0].direction).toBe(-1);
    expect(trains[0].frontM).toBeCloseTo(900);
    expect(trains[0].occupiedFromM).toBeCloseTo(900);
    expect(trains[0].occupiedToM).toBeCloseTo(960);
  });

  it("keeps two same-direction trains on a line whose traversal outlasts the headway", () => {
    const congested: SimulationRailLine = {
      ...THROUGH_LINE,
      schedule: { ...THROUGH_LINE.schedule, headwaySeconds: 60 },
    };
    // Sweep takes 106 s > 60 s headway: at t=70 the k=0 departure is at 700
    // and the k=1 departure is at 100, both eastbound.
    const eastbound = railTrainStatesAt(congested, 70).filter((t) => t.direction === 1);
    const fronts = eastbound.map((t) => t.frontM).sort((a, b) => a - b);
    expect(fronts).toHaveLength(2);
    expect(fronts[0]).toBeCloseTo(100);
    expect(fronts[1]).toBeCloseTo(700);
  });

  it("opens the crossing warning a lead before arrival and holds it a trail after the tail clears", () => {
    // Eastbound covers the 500 m crossing over t in [50, 56]; window [42, 58].
    // Westbound covers it over t in [200, 206]; window [192, 208].
    const windows = railCrossingWarningWindows(THROUGH_LINE, 500);
    expect(windows).toHaveLength(2);
    expect(windows[0].startSeconds).toBeCloseTo(42);
    expect(windows[0].endSeconds).toBeCloseTo(58);
    expect(windows[1].startSeconds).toBeCloseTo(192);
    expect(windows[1].endSeconds).toBeCloseTo(208);
  });
});

describe("railSchedule shuttle mode", () => {
  it("derives the period from travel plus dwell at both ends", () => {
    // travel = (400-40)/10 = 36 s each way, dwell 20 s each end.
    expect(railCyclePeriodSeconds(SHUTTLE_LINE)).toBeCloseTo(112);
  });

  it("parks the consist at each terminus for the dwell", () => {
    // t=40 is inside the far-end dwell [36, 56].
    const dwelling = railTrainStatesAt(SHUTTLE_LINE, 40);
    expect(dwelling).toHaveLength(1);
    expect(dwelling[0].frontM).toBeCloseTo(400);
    expect(dwelling[0].occupiedFromM).toBeCloseTo(360);

    // t=100 is inside the home-end dwell [92, 112].
    const home = railTrainStatesAt(SHUTTLE_LINE, 100);
    expect(home).toHaveLength(1);
    expect(home[0].occupiedFromM).toBeCloseTo(0);
    expect(home[0].occupiedToM).toBeCloseTo(40);
  });

  it("gives a mid-line crossing one warning window per direction", () => {
    // Outbound covers 200 m over [16, 20] -> [8, 22];
    // return covers it over [72, 76] -> [64, 78].
    const windows = railCrossingWarningWindows(SHUTTLE_LINE, 200);
    expect(windows).toHaveLength(2);
    expect(windows[0].startSeconds).toBeCloseTo(8);
    expect(windows[0].endSeconds).toBeCloseTo(22);
    expect(windows[1].startSeconds).toBeCloseTo(64);
    expect(windows[1].endSeconds).toBeCloseTo(78);
  });

  it("keeps a crossing inside a terminus footprint warned through the whole dwell", () => {
    // 10 m from the home buffer stop: covered while the train sits there
    // (dwell [92, 112]) and during both adjacent moves; the folded windows
    // must cover the wrap seam on both sides.
    const windows = railCrossingWarningWindows(SHUTTLE_LINE, 10);
    const period = railCyclePeriodSeconds(SHUTTLE_LINE);
    const activeAt = (t: number) =>
      railCrossingSignalAt(windows, period, 0, t).warningActive;
    expect(activeAt(95)).toBe(true); // parked on it
    expect(activeAt(111)).toBe(true); // still parked, end of dwell
    expect(activeAt(1)).toBe(true); // pulling away across it
    expect(activeAt(40)).toBe(false); // train dwelling at the far end
  });
});

describe("railCrossingSignalAt", () => {
  it("reports warning state and an honest countdown on both sides of a window", () => {
    const windows = railCrossingWarningWindows(THROUGH_LINE, 500);
    const period = railCyclePeriodSeconds(THROUGH_LINE);

    const clear = railCrossingSignalAt(windows, period, 0, 20);
    expect(clear.warningActive).toBe(false);
    expect(clear.secondsUntilChange).toBeCloseTo(22); // next window opens at 42

    const warning = railCrossingSignalAt(windows, period, 0, 50);
    expect(warning.warningActive).toBe(true);
    expect(warning.secondsUntilChange).toBeCloseTo(8); // window closes at 58

    const wrapped = railCrossingSignalAt(windows, period, 0, 290);
    expect(wrapped.warningActive).toBe(false);
    expect(wrapped.secondsUntilChange).toBeCloseTo(52); // 300 + 42 - 290
  });

  it("is periodic — the same phase in any cycle answers identically", () => {
    const windows = railCrossingWarningWindows(SHUTTLE_LINE, 200);
    const period = railCyclePeriodSeconds(SHUTTLE_LINE);
    for (const t of [0, 9, 21, 65, 90]) {
      const now = railCrossingSignalAt(windows, period, 0, t);
      const later = railCrossingSignalAt(windows, period, 0, t + period * 7);
      expect(later.warningActive).toBe(now.warningActive);
      expect(later.secondsUntilChange).toBeCloseTo(now.secondsUntilChange);
    }
  });
});
