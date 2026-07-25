/**
 * Drag steering for touch: the whole feel of the mobile wheel, with no DOM and
 * no React, so it can be tested directly (the `audioMath` / `crowdRenderMath` /
 * `minimap` pattern).
 *
 * The scheme is a floating origin. Wherever the thumb lands becomes zero, and
 * horizontal travel from there is the steering input — so there is no small
 * target to find, and the control works the same whether the phone is held high
 * or low. That is what shipped mobile drivers do; the fixed 132px pad this
 * replaced asked the thumb to locate a specific rectangle it could not see.
 *
 * `SimulationCore` steers by yaw *rate* — `heading += steer * rate * dt` — not
 * by a wheel angle, so releasing simply stops the turn. Nothing here needs to
 * model a self-centring wheel; the release ease exists only because an
 * instantaneous stop reads as a twitch.
 */

/** Thumb travel, in CSS pixels, that reaches full lock. */
export const TOUCH_STEER_FULL_LOCK_PX = 80;

/**
 * Ignored travel around the origin, in CSS pixels. Small enough not to feel
 * mushy, large enough that a thumb resting on the glass does not creep.
 */
export const TOUCH_STEER_DEAD_ZONE_PX = 5;

/** Seconds for a released input to ease back to centre. */
export const TOUCH_STEER_RELEASE_SECONDS = 0.12;

/** Blend of the linear and cubic terms in the response curve. */
const LINEAR_SHARE = 0.35;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export interface TouchSteerState {
  /** Client x the current drag is measured from. Re-anchors on reversal. */
  originX: number;
  /** Last emitted steer value, so a reversal can be detected without the DOM. */
  value: number;
}

export function beginTouchSteer(clientX: number): TouchSteerState {
  return { originX: clientX, value: 0 };
}

/**
 * Maps thumb travel to a steering value.
 *
 * The dead zone is *subtracted and rescaled* rather than used as a cutoff. A
 * cutoff makes the output jump from 0 to whatever the curve gives at the
 * threshold the instant the thumb crosses it, which is the single most common
 * way touch steering is made to feel broken. Here the output leaves zero
 * continuously.
 *
 * Travel past full lock is allowed and clamped, so a thumb that slides further
 * than it meant to keeps full lock instead of losing the input.
 */
export function steerFromTravel(travelPx: number): number {
  const magnitude = Math.abs(travelPx);
  if (magnitude <= TOUCH_STEER_DEAD_ZONE_PX) return 0;
  const span = TOUCH_STEER_FULL_LOCK_PX - TOUCH_STEER_DEAD_ZONE_PX;
  const t = clamp((magnitude - TOUCH_STEER_DEAD_ZONE_PX) / span, 0, 1);
  // Cubic-blended: fine control near centre for holding a lane, full lock still
  // reachable at the extreme. Pure linear is twitchy; pure cubic feels dead.
  const shaped = LINEAR_SHARE * t + (1 - LINEAR_SHARE) * t * t * t;
  return Math.sign(travelPx) * shaped;
}

/**
 * Advances a live drag and returns the steering value.
 *
 * Reversing direction re-anchors the origin at the turning point. Without it,
 * a long drive accumulates an offset — every unrecovered pixel of thumb drift
 * biases the origin one way, and the car develops a permanent pull that the
 * player has to fight and cannot see the cause of.
 */
export function updateTouchSteer(
  state: TouchSteerState,
  clientX: number,
): number {
  const travel = clientX - state.originX;
  const next = steerFromTravel(travel);
  if (next !== 0 && state.value !== 0 && Math.sign(next) !== Math.sign(state.value)) {
    state.originX = clientX;
    state.value = 0;
    return 0;
  }
  state.value = next;
  return next;
}

/**
 * One frame of the release ease. Reaches exactly 0 rather than approaching it,
 * so a lifted thumb never leaves a residual turn crawling the car off its lane.
 */
export function releaseTouchSteer(
  current: number,
  deltaSeconds: number,
): number {
  if (current === 0) return 0;
  const step = deltaSeconds / TOUCH_STEER_RELEASE_SECONDS;
  const magnitude = Math.abs(current) - step;
  if (magnitude <= 0) return 0;
  return Math.sign(current) * magnitude;
}
