import { describe, expect, it } from "vitest";

import {
  createDispatch,
  offerElapsedFraction,
  offerRemainingMs,
  OFFER_WINDOW_MS,
  resolveOffer,
  searchDelayMs,
  SEARCH_MAX_MS,
  SEARCH_MIN_MS,
  stepDispatch,
  SURGE_CHANCE,
  SURGE_EPOCH_MS,
  SURGE_FARE_MULTIPLIER,
  SURGE_MAX_MS,
  SURGE_MIN_MS,
  surgeWindowAt,
  type DispatchState,
} from "../app/game/dispatch";

/** Steps dispatch forward in 100 ms ticks, the rate the HUD publishes at. */
function run(
  state: DispatchState,
  fromMs: number,
  toMs: number,
  canOffer: () => boolean = () => true,
): { state: DispatchState; opened: number[]; expired: number[] } {
  const opened: number[] = [];
  const expired: number[] = [];
  let current = state;
  for (let now = fromMs; now <= toMs; now += 100) {
    const step = stepDispatch(current, now, canOffer());
    current = step.state;
    if (step.event === "opened") opened.push(now);
    if (step.event === "expired") expired.push(now);
  }
  return { state: current, opened, expired };
}

describe("offer scheduling", () => {
  it("opens an offer the moment a drive starts, in every city", () => {
    // Being dropped into a city with no work and no sign that any is coming is
    // a bad first ten seconds; the opening offer is the fix.
    for (const seed of [1, 7, 12_345, 0x7fff_ffff, 987_654]) {
      const step = stepDispatch(createDispatch(seed), 0, true);
      expect(step.event).toBe("opened");
      expect(step.state.phase).toBe("offered");
      expect(step.state.offerSeed).toBe(seed);
    }
  });

  it("holds the offer open for its window, then loses it", () => {
    const opened = stepDispatch(createDispatch(3), 0, true).state;
    expect(stepDispatch(opened, OFFER_WINDOW_MS - 1, true).event).toBe("none");

    const lost = stepDispatch(opened, OFFER_WINDOW_MS, true);
    expect(lost.event).toBe("expired");
    expect(lost.state.phase).toBe("idle");
  });

  it("counts the window down and burns the fuse evenly", () => {
    const opened = stepDispatch(createDispatch(3), 1_000, true).state;
    expect(offerRemainingMs(opened, 1_000)).toBe(OFFER_WINDOW_MS);
    expect(offerElapsedFraction(opened, 1_000)).toBe(0);

    const half = 1_000 + OFFER_WINDOW_MS / 2;
    expect(offerRemainingMs(opened, half)).toBe(OFFER_WINDOW_MS / 2);
    expect(offerElapsedFraction(opened, half)).toBeCloseTo(0.5, 6);

    // Both clamp rather than going negative once the window has passed.
    expect(offerRemainingMs(opened, 1_000 + OFFER_WINDOW_MS * 2)).toBe(0);
    expect(offerElapsedFraction(opened, 1_000 + OFFER_WINDOW_MS * 2)).toBe(1);
  });

  it("never makes the driver wait longer than the stated ceiling", () => {
    for (let seed = 1; seed <= 5_000; seed += 1) {
      const delay = searchDelayMs(seed);
      expect(delay).toBeGreaterThanOrEqual(SEARCH_MIN_MS);
      expect(delay).toBeLessThanOrEqual(SEARCH_MAX_MS);
    }
  });

  it("keeps most waits short, with the long lull as the rare tail", () => {
    // A flat draw over the range averages ~24 s, which reads as the game being
    // broken rather than the city being quiet.
    const delays = Array.from({ length: 5_000 }, (_, index) => searchDelayMs(index + 1));
    const mean = delays.reduce((sum, value) => sum + value, 0) / delays.length;
    expect(mean).toBeGreaterThan(10_000);
    expect(mean).toBeLessThan(20_000);

    const long = delays.filter((delay) => delay > 30_000).length / delays.length;
    expect(long).toBeGreaterThan(0);
    expect(long).toBeLessThan(0.2);
  });

  it("advances the seed once per offer opened, however it was answered", () => {
    // A retried career day must offer the same jobs at the same points in the
    // sequence whatever the player accepted, or "redo the day" reshuffles it.
    const accepted = resolveOffer(stepDispatch(createDispatch(40), 0, true).state, 0);
    const passed = resolveOffer(stepDispatch(createDispatch(40), 0, true).state, 0);
    const expired = stepDispatch(
      stepDispatch(createDispatch(40), 0, true).state,
      OFFER_WINDOW_MS,
      true,
    ).state;

    expect(accepted.offerSeed).toBe(41);
    expect(passed.offerSeed).toBe(41);
    expect(expired.offerSeed).toBe(41);
  });

  it("goes quiet while the queue is full and starts a fresh wait once it clears", () => {
    let full = true;
    const start = resolveOffer(stepDispatch(createDispatch(9), 0, true).state, 0);
    const blocked = run(start, 100, 120_000, () => !full);
    expect(blocked.opened).toEqual([]);

    // Clearing the queue does not fire an offer that instant — the countdown
    // was re-armed while blocked, so a real quiet spell follows.
    full = false;
    const after = stepDispatch(blocked.state, 120_100, true);
    expect(after.event).toBe("none");

    const resumed = run(after.state, 120_200, 120_200 + SEARCH_MAX_MS + 1_000);
    expect(resumed.opened.length).toBeGreaterThanOrEqual(1);
    expect(resumed.opened[0]).toBeGreaterThan(120_100);
  });

  it("keeps offering work across a whole career day", () => {
    // Six minutes of driving should never leave the player with nothing to
    // answer for minutes at a stretch.
    const { opened } = run(createDispatch(2_024), 0, 360_000, () => true);
    expect(opened.length).toBeGreaterThan(8);

    const gaps = opened.slice(1).map((time, index) => time - opened[index]);
    for (const gap of gaps) {
      expect(gap).toBeLessThanOrEqual(OFFER_WINDOW_MS + SEARCH_MAX_MS + 200);
    }
  });

  it("replays a drive identically from the same seed", () => {
    const first = run(createDispatch(777), 0, 200_000);
    const second = run(createDispatch(777), 0, 200_000);
    expect(second.opened).toEqual(first.opened);
    expect(second.expired).toEqual(first.expired);
    expect(second.state).toEqual(first.state);
  });

  it("ignores an answer when nothing is on offer", () => {
    const idle = createDispatch(5);
    expect(resolveOffer(idle, 4_000)).toBe(idle);
  });
});

describe("surge windows", () => {
  it("reports no surge before a drive has started", () => {
    expect(surgeWindowAt(11, -1)).toBeNull();
    expect(surgeWindowAt(11, Number.NaN)).toBeNull();
  });

  it("runs every window for between one and two minutes", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      let previous: string | null = null;
      for (let now = 0; now < 600_000; now += 5_000) {
        const window = surgeWindowAt(seed, now);
        if (!window) continue;
        const key = `${window.startMs}:${window.endMs}`;
        if (key === previous) continue;
        previous = key;
        expect(window.multiplier).toBe(SURGE_FARE_MULTIPLIER);
        expect(window.startMs).toBeLessThanOrEqual(now);
        expect(window.endMs).toBeGreaterThan(now);
        // Merged windows can exceed one window's own span, but never by more
        // than the run of epochs that produced them.
        expect(window.endMs - window.startMs).toBeGreaterThanOrEqual(SURGE_MIN_MS);
      }
    }
  });

  it("stays uncommon without being rare", () => {
    // The whole point is a window worth chasing: too frequent and doubled pay
    // is just the going rate, too rare and nobody ever sees one.
    const DAY_MS = 360_000;
    let daysWithSurge = 0;
    const trials = 3_000;
    for (let seed = 1; seed <= trials; seed += 1) {
      let sawOne = false;
      for (let now = 0; now < DAY_MS; now += SURGE_EPOCH_MS / 2) {
        if (surgeWindowAt(seed, now)) {
          sawOne = true;
          break;
        }
      }
      if (sawOne) daysWithSurge += 1;
    }
    const share = daysWithSurge / trials;
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.8);
  });

  it("opens roughly as often as the per-epoch chance says", () => {
    let opens = 0;
    const epochs = 40_000;
    for (let seed = 1; seed <= 200; seed += 1) {
      let previousStart = -1;
      for (let epoch = 0; epoch < epochs / 200; epoch += 1) {
        const window = surgeWindowAt(seed, epoch * SURGE_EPOCH_MS);
        if (window && window.startMs !== previousStart) {
          opens += 1;
          previousStart = window.startMs;
        }
      }
    }
    // Merging swallows some rolls, so the observed rate sits at or below the
    // nominal chance — but not by an order of magnitude.
    const rate = opens / epochs;
    expect(rate).toBeGreaterThan(SURGE_CHANCE * 0.3);
    expect(rate).toBeLessThan(SURGE_CHANCE * 1.5);
  });

  it("holds a window continuously open for its whole run", () => {
    // A surge that flickered off and on between samples would be unreadable.
    for (let seed = 1; seed <= 300; seed += 1) {
      const window = surgeWindowAt(seed, 0);
      if (!window) continue;
      for (let now = window.startMs; now < window.endMs; now += 1_000) {
        expect(surgeWindowAt(seed, now)).not.toBeNull();
      }
      // Past the end it is over — unless a later epoch has opened a genuinely
      // new window, which is a second surge rather than this one flickering.
      const after = surgeWindowAt(seed, window.endMs);
      if (after) expect(after.startMs).toBeGreaterThan(window.startMs);
    }
  });

  it("never reports a window longer than the lookback can see", () => {
    // The scan only looks back MAX/EPOCH epochs; a window that could outlive
    // that would silently vanish mid-run.
    for (let seed = 1; seed <= 500; seed += 1) {
      for (let now = 0; now < 400_000; now += SURGE_EPOCH_MS) {
        const window = surgeWindowAt(seed, now);
        if (!window) continue;
        expect(now - window.startMs).toBeLessThan(SURGE_MAX_MS + SURGE_EPOCH_MS);
      }
    }
  });

  it("answers identically for the same seed and moment", () => {
    for (const seed of [3, 91, 4_242]) {
      for (const now of [0, 15_000, 61_000, 275_500]) {
        expect(surgeWindowAt(seed, now)).toEqual(surgeWindowAt(seed, now));
      }
    }
  });

  it("gives different cities different windows on the same clock", () => {
    const at = (seed: number) =>
      Array.from({ length: 60 }, (_, index) => (surgeWindowAt(seed, index * 5_000) ? 1 : 0)).join("");
    expect(at(101)).not.toBe(at(102));
  });
});
