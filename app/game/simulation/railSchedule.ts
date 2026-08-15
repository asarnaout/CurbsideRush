/**
 * Deterministic rail timetables — pure functions of elapsed simulation time.
 *
 * A rail line is a 1-D track of `lengthM` with a periodic timetable. Nothing
 * here knows about world coordinates: the adapter projects each level
 * crossing's position onto the line once, and the renderer maps a train's
 * `frontM` back onto the authored polyline. Both directions of the same
 * timetable are derived from one closed-form motion table, so a crossing's
 * warning state, the NPC hold, the player citation and the drawn train can
 * never disagree about where the train is.
 *
 * Two timetable shapes cover every city:
 *  - `through`: trains enter from one edge, cross the whole line, and leave
 *    (Cairo, NYC). One departure per direction per `headwaySeconds`, the
 *    opposite direction offset half a headway.
 *  - `shuttle`: one consist bounces terminus-to-terminus with a dwell at each
 *    end, never leaving the line (Tokyo, London).
 *
 * All queries are pure in (line, elapsedSeconds) — the same idiom as
 * `RoadNetwork.trafficLightTiming` — which is what keeps replays and the
 * acceptance trace hash byte-stable.
 */

export interface SimulationRailSchedule {
  readonly mode: "shuttle" | "through";
  /** Cruise speed along the line. Trains do not accelerate — arcade honesty. */
  readonly speedMps: number;
  /** Full consist length, used for crossing occupancy and drawing. */
  readonly trainLengthM: number;
  /** `through` only: seconds between departures in the same direction. */
  readonly headwaySeconds?: number;
  /** `shuttle` only: seconds held at each terminus between runs. */
  readonly dwellSeconds?: number;
  /** Shifts the whole timetable, so lines on one map interleave predictably. */
  readonly offsetSeconds?: number;
  /** Crossing warning starts this long before the train reaches it. */
  readonly warningLeadSeconds: number;
  /** Warning holds this long after the tail clears the crossing. */
  readonly clearTrailSeconds: number;
}

export interface SimulationRailLine {
  readonly id: string;
  readonly lengthM: number;
  readonly schedule: SimulationRailSchedule;
}

/** One train currently on the line. `frontM` is the leading face measured
 * along the line; the consist occupies [occupiedFromM, occupiedToM]. */
export interface RailTrainState {
  readonly frontM: number;
  readonly direction: 1 | -1;
  readonly occupiedFromM: number;
  readonly occupiedToM: number;
}

/** Half-open warning interval within one timetable period, non-wrapping. */
export interface RailCrossingWindow {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** One straight-line motion of the leading face inside the timetable:
 * front(t) = front0 + velocityMps * (t - t0) for t in [t0, t0 + duration].
 * velocityMps is 0 for a terminus dwell. */
interface RailMotion {
  readonly t0: number;
  readonly durationSeconds: number;
  readonly front0: number;
  readonly velocityMps: number;
  readonly direction: 1 | -1;
}

const EPSILON = 1e-6;

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export function railCyclePeriodSeconds(line: SimulationRailLine): number {
  const schedule = line.schedule;
  if (schedule.mode === "through") {
    return Math.max(schedule.headwaySeconds ?? 120, 1);
  }
  const travelSeconds =
    Math.max(line.lengthM - schedule.trainLengthM, 1) / Math.max(schedule.speedMps, 0.1);
  return 2 * (travelSeconds + Math.max(schedule.dwellSeconds ?? 0, 0));
}

/** The timetable's motion table for one period. Pure in the line. */
function railMotions(line: SimulationRailLine): RailMotion[] {
  const schedule = line.schedule;
  const speed = Math.max(schedule.speedMps, 0.1);
  const trainLength = Math.max(schedule.trainLengthM, 1);
  if (schedule.mode === "through") {
    const period = railCyclePeriodSeconds(line);
    // The front sweeps from "about to enter" to "tail fully out the far end".
    const sweepM = line.lengthM + trainLength;
    const durationSeconds = sweepM / speed;
    return [
      { t0: 0, durationSeconds, front0: 0, velocityMps: speed, direction: 1 },
      {
        t0: period / 2,
        durationSeconds,
        front0: line.lengthM,
        velocityMps: -speed,
        direction: -1,
      },
    ];
  }
  const travelM = Math.max(line.lengthM - trainLength, 1);
  const travelSeconds = travelM / speed;
  const dwellSeconds = Math.max(schedule.dwellSeconds ?? 0, 0);
  return [
    { t0: 0, durationSeconds: travelSeconds, front0: trainLength, velocityMps: speed, direction: 1 },
    {
      t0: travelSeconds,
      durationSeconds: dwellSeconds,
      front0: line.lengthM,
      velocityMps: 0,
      direction: 1,
    },
    {
      t0: travelSeconds + dwellSeconds,
      durationSeconds: travelSeconds,
      front0: line.lengthM - trainLength,
      velocityMps: -speed,
      direction: -1,
    },
    {
      t0: 2 * travelSeconds + dwellSeconds,
      durationSeconds: dwellSeconds,
      front0: 0,
      velocityMps: 0,
      direction: -1,
    },
  ];
}

function occupiedSpan(
  frontM: number,
  direction: 1 | -1,
  trainLengthM: number,
): { fromM: number; toM: number } {
  const backM = frontM - direction * trainLengthM;
  return { fromM: Math.min(frontM, backM), toM: Math.max(frontM, backM) };
}

/**
 * Every train on the line at `elapsedSeconds`, off-line portions clipped away.
 * A `through` line whose traversal outlasts the headway yields several — the
 * enumeration below walks every departure that could still be mid-line.
 */
export function railTrainStatesAt(
  line: SimulationRailLine,
  elapsedSeconds: number,
): RailTrainState[] {
  const period = railCyclePeriodSeconds(line);
  const time = elapsedSeconds + (line.schedule.offsetSeconds ?? 0);
  const trainLength = Math.max(line.schedule.trainLengthM, 1);
  const states: RailTrainState[] = [];
  for (const motion of railMotions(line)) {
    const newestK = Math.floor((time - motion.t0) / period);
    const oldestK = Math.floor((time - motion.t0 - motion.durationSeconds) / period);
    for (let k = oldestK; k <= newestK; k += 1) {
      const local = time - motion.t0 - k * period;
      if (local < -EPSILON || local > motion.durationSeconds + EPSILON) continue;
      const frontM = motion.front0 + motion.velocityMps * local;
      const span = occupiedSpan(frontM, motion.direction, trainLength);
      if (span.toM < 0 || span.fromM > line.lengthM) continue;
      states.push({
        frontM,
        direction: motion.direction,
        occupiedFromM: Math.max(span.fromM, 0),
        occupiedToM: Math.min(span.toM, line.lengthM),
      });
    }
  }
  return states;
}

function mergeWindows(windows: RailCrossingWindow[]): RailCrossingWindow[] {
  const sorted = [...windows].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: { startSeconds: number; endSeconds: number }[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startSeconds <= last.endSeconds + EPSILON) {
      last.endSeconds = Math.max(last.endSeconds, window.endSeconds);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/**
 * The warning windows for one crossing, folded into [0, period) and merged.
 * Computed once per crossing at construction time; the per-tick query is a
 * scan over these few intervals.
 */
export function railCrossingWarningWindows(
  line: SimulationRailLine,
  crossingDistanceM: number,
): RailCrossingWindow[] {
  const period = railCyclePeriodSeconds(line);
  const schedule = line.schedule;
  const trainLength = Math.max(schedule.trainLengthM, 1);
  const raw: RailCrossingWindow[] = [];
  for (const motion of railMotions(line)) {
    // Front positions between which the consist covers the crossing.
    const coverFromFront = crossingDistanceM;
    const coverToFront = crossingDistanceM + motion.direction * trainLength;
    const frontA = Math.min(coverFromFront, coverToFront);
    const frontB = Math.max(coverFromFront, coverToFront);
    let coverStart: number;
    let coverEnd: number;
    if (motion.velocityMps === 0) {
      // Dwell: covered for the whole hold, or not at all.
      const span = occupiedSpan(motion.front0, motion.direction, trainLength);
      if (crossingDistanceM < span.fromM - EPSILON || crossingDistanceM > span.toM + EPSILON) {
        continue;
      }
      coverStart = motion.t0;
      coverEnd = motion.t0 + motion.durationSeconds;
    } else {
      const tA = motion.t0 + (frontA - motion.front0) / motion.velocityMps;
      const tB = motion.t0 + (frontB - motion.front0) / motion.velocityMps;
      coverStart = Math.max(Math.min(tA, tB), motion.t0);
      coverEnd = Math.min(Math.max(tA, tB), motion.t0 + motion.durationSeconds);
      if (coverEnd <= coverStart + EPSILON) continue;
    }
    const start = coverStart - schedule.warningLeadSeconds;
    const end = coverEnd + schedule.clearTrailSeconds;
    // Fold into [0, period), splitting a window that straddles the wrap.
    const foldedStart = positiveModulo(start, period);
    const length = Math.min(end - start, period);
    if (foldedStart + length <= period + EPSILON) {
      raw.push({ startSeconds: foldedStart, endSeconds: Math.min(foldedStart + length, period) });
    } else {
      raw.push({ startSeconds: foldedStart, endSeconds: period });
      raw.push({ startSeconds: 0, endSeconds: foldedStart + length - period });
    }
  }
  return mergeWindows(raw);
}

/**
 * Crossing signal at a moment, from precomputed windows. Mirrors the return
 * shape of `trafficLightTiming` consumers: warning maps to "red", clear to
 * "green", with an honest countdown either way.
 */
export function railCrossingSignalAt(
  windows: readonly RailCrossingWindow[],
  periodSeconds: number,
  offsetSeconds: number,
  elapsedSeconds: number,
): { warningActive: boolean; secondsUntilChange: number } {
  if (windows.length === 0) {
    return { warningActive: false, secondsUntilChange: periodSeconds };
  }
  const phase = positiveModulo(elapsedSeconds + offsetSeconds, periodSeconds);
  for (const window of windows) {
    if (phase >= window.startSeconds - EPSILON && phase < window.endSeconds) {
      return { warningActive: true, secondsUntilChange: window.endSeconds - phase };
    }
  }
  let next = Number.POSITIVE_INFINITY;
  for (const window of windows) {
    const delta =
      window.startSeconds > phase
        ? window.startSeconds - phase
        : window.startSeconds + periodSeconds - phase;
    next = Math.min(next, delta);
  }
  return { warningActive: false, secondsUntilChange: next };
}
