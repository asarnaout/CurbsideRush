/**
 * Adaptive render resolution.
 *
 * Babylon's `hardwareScalingLevel` is **CSS pixels per rendered pixel**, so it
 * runs backwards from intuition: 1 renders at the canvas's CSS size, 0.5 renders
 * at twice it (sharp, expensive), 2 renders at half it (soft, cheap). Every
 * number here is in that unit, and "raising the level" always means blurrier.
 *
 * Two things the constructor used to get wrong, recorded because both are easy
 * to walk back into:
 *
 * 1. `setHardwareScalingLevel` *overwrites* whatever `adaptToDeviceRatio: true`
 *    computed — it does not compose with it. A level derived from
 *    `devicePixelRatio` therefore double-counts the ratio. The old touch branch
 *    (`min(1.65, dpr / 1.2)`) pinned every modern phone to 1.65, i.e. a 516x238
 *    buffer on a DPR-3 landscape iPhone: about 20% of native linear resolution.
 * 2. `Engine.resize()` does not reset the level. In `@babylonjs/core` 9.16.1 it
 *    multiplies by `_lastDevicePixelRatio / devicePixelRatio`, which is 1 unless
 *    the ratio itself changes — so a level set once persists, and a browser zoom
 *    correctly rescales it.
 *
 * A phone cannot simply be pinned to a good level either: mobile GPUs throttle
 * hard, and a career day runs about six minutes. A device comfortably at 60 fps
 * in the first minute can be at 20 by the fifth. So the level moves.
 */

export interface RenderScalingProfile {
  /** Level to open on. Mid-range: sharpening looks like polish, stuttering looks broken. */
  readonly start: number;
  /** Sharpest allowed (smallest level). */
  readonly min: number;
  /** Softest allowed (largest level). */
  readonly max: number;
  /** Frames per second the governor aims to hold. */
  readonly targetFps: number;
}

/**
 * Deliberately below 60 on touch. Aiming at 60 on a phone makes the governor
 * chase a target the device cannot hold and settle at its blurriest level; 48 is
 * smooth to look at and leaves room to spend on resolution.
 */
export const TOUCH_RENDER_PROFILE: RenderScalingProfile = Object.freeze({
  start: 0.8,
  min: 0.55,
  max: 1.3,
  targetFps: 48,
});

export const DESKTOP_RENDER_PROFILE: RenderScalingProfile = Object.freeze({
  start: 0.6,
  min: 0.5,
  max: 1.2,
  targetFps: 58,
});

/** How often the governor is allowed to act. */
export const RENDER_SCALING_WINDOW_MS = 1_500;

/** Give up resolution quickly; take it back slowly. */
const DEGRADE_STEP = 0.08;
const IMPROVE_STEP = 0.05;
/** Below target by this much before degrading. */
const DEGRADE_MARGIN = 4;
/** Above target by this much before improving. */
const IMPROVE_MARGIN = 8;
/** Consecutive good windows required before spending on resolution again. */
const IMPROVE_WINDOWS = 2;

export function resolveRenderProfile(
  touchFirst: boolean,
  devicePixelRatio: number,
): RenderScalingProfile {
  if (touchFirst) return TOUCH_RENDER_PROFILE;
  // A DPR-1 monitor is already at its own native resolution at level 1; asking
  // for 0.6 there is pure supersampling for no visible gain.
  const start = Math.max(DESKTOP_RENDER_PROFILE.start, 1 / Math.max(devicePixelRatio, 1));
  return { ...DESKTOP_RENDER_PROFILE, start: Math.min(start, DESKTOP_RENDER_PROFILE.max) };
}

export interface RenderScalingState {
  level: number;
  /** Consecutive windows with headroom to spare. */
  goodWindows: number;
}

export function createRenderScalingState(
  profile: RenderScalingProfile,
): RenderScalingState {
  return { level: clampLevel(profile.start, profile), goodWindows: 0 };
}

const clampLevel = (level: number, profile: RenderScalingProfile) =>
  Math.min(profile.max, Math.max(profile.min, level));

/**
 * One governor window. Returns the level to apply; equal to the current level
 * when nothing should change, so the caller can skip the `setHardwareScalingLevel`
 * (and the `resize()` inside it) entirely.
 *
 * The asymmetry — degrade on one bad window, improve only after two good ones —
 * is what keeps a scene sitting exactly on the threshold from oscillating
 * between two resolutions, which is far more noticeable than either one.
 */
export function stepRenderScaling(
  state: RenderScalingState,
  fps: number,
  profile: RenderScalingProfile,
): number {
  // A stalled or not-yet-measured frame rate says nothing; acting on it would
  // dump resolution during the first frames after load.
  if (!Number.isFinite(fps) || fps <= 0) return state.level;

  if (fps < profile.targetFps - DEGRADE_MARGIN) {
    state.goodWindows = 0;
    state.level = clampLevel(state.level + DEGRADE_STEP, profile);
    return state.level;
  }

  if (fps > profile.targetFps + IMPROVE_MARGIN) {
    state.goodWindows += 1;
    if (state.goodWindows >= IMPROVE_WINDOWS) {
      state.goodWindows = 0;
      state.level = clampLevel(state.level - IMPROVE_STEP, profile);
    }
    return state.level;
  }

  // Inside the band: on target, leave it alone.
  state.goodWindows = 0;
  return state.level;
}
