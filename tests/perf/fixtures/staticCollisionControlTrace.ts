/**
 * Reproducible fixed-step input trace for `staticCollision.bench.ts` — see
 * plan `.claude/building-collision-visual-parity-plan.md` Section 12.1. This
 * is a committed **input** trace, not a claim about a realistic lap: it
 * exists so a baseline and a candidate implementation execute byte-identical
 * pedal/steer input over the same 3,600 fixed 1/60 s steps (60 s of sim
 * time), so any timing or trajectory difference is attributable to the
 * implementation, never to a different route.
 */

export interface ControlTraceSegment {
  /** Inclusive first fixed-step tick (0-based) this segment covers. */
  readonly fromTick: number;
  /** Exclusive last tick — the segment covers `[fromTick, toTick)`. */
  readonly toTick: number;
  readonly throttle: number;
  readonly brake: number;
  readonly reverse: number;
  readonly steer: number;
}

export const STATIC_COLLISION_CONTROL_TRACE: readonly ControlTraceSegment[] = [
  { fromTick: 0, toTick: 900, throttle: 0.8, brake: 0, reverse: 0, steer: 0 },
  { fromTick: 900, toTick: 1500, throttle: 0.65, brake: 0, reverse: 0, steer: 0.22 },
  { fromTick: 1500, toTick: 2100, throttle: 0.7, brake: 0, reverse: 0, steer: -0.18 },
  { fromTick: 2100, toTick: 2400, throttle: 0, brake: 0.7, reverse: 0, steer: 0 },
  { fromTick: 2400, toTick: 3000, throttle: 0, brake: 0, reverse: 0.55, steer: 0.12 },
  { fromTick: 3000, toTick: 3600, throttle: 0.75, brake: 0, reverse: 0, steer: 0 },
];

export const STATIC_COLLISION_CONTROL_TRACE_TICKS = 3600;

export interface ControlTraceInput {
  readonly throttle: number;
  readonly brake: number;
  readonly reverse: number;
  readonly steer: number;
}

const ZERO_INPUT: ControlTraceInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };

/** The pedal/steer input active at a given fixed-step tick. Zero outside the
 * trace's own [0, STATIC_COLLISION_CONTROL_TRACE_TICKS) range. */
export function controlTraceInputAtTick(tick: number): ControlTraceInput {
  for (const segment of STATIC_COLLISION_CONTROL_TRACE) {
    if (tick >= segment.fromTick && tick < segment.toTick) {
      return {
        throttle: segment.throttle,
        brake: segment.brake,
        reverse: segment.reverse,
        steer: segment.steer,
      };
    }
  }
  return ZERO_INPUT;
}
