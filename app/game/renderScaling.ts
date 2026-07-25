/**
 * Adaptive render resolution, for touch devices only.
 *
 * Babylon's `hardwareScalingLevel` is **CSS pixels per rendered pixel**, so it
 * runs backwards from intuition: 1 renders at the canvas's CSS size, 0.5 renders
 * at twice it (sharp, expensive), 2 renders at half it (soft, cheap). Every
 * number here is in that unit, and "up the ladder" always means blurrier.
 *
 * Two things about the engine that are easy to walk back into:
 *
 * 1. `setHardwareScalingLevel` *overwrites* whatever `adaptToDeviceRatio: true`
 *    computed — it does not compose with it. A level derived from
 *    `devicePixelRatio` therefore double-counts the ratio. The original touch
 *    branch (`min(1.65, dpr / 1.2)`) pinned every modern phone to 1.65, i.e. a
 *    516x238 buffer on a DPR-3 landscape iPhone: ~20% of native linear.
 * 2. `Engine.resize()` does not reset the level. In `@babylonjs/core` 9.16.1 it
 *    multiplies by `_lastDevicePixelRatio / devicePixelRatio`, which is 1 unless
 *    the ratio itself changes — so a level set once persists, and a browser zoom
 *    correctly rescales it.
 *
 * ## Why the ladder is short, and fixed
 *
 * Changing the level is not free, and the cost is not the buffer. Every
 * `engine.resize()` fires `Engine.onResizeObservable`, which
 * `DefaultRenderingPipeline` uses to re-assert `bloomKernel` — and that
 * propagates to both blur post-processes as `kernel`, whose setter calls
 * `_updateParameters()` and **recompiles their shaders** whenever the value
 * lands on a new kernel size. A recompiling effect has nothing to draw, so the
 * frame comes out blank: a visible black flash mid-drive.
 *
 * Babylon caches effects by define-set, so each *distinct* level costs one
 * compile and is free forever after. A continuous knob therefore flashes
 * indefinitely; a short ladder flashes at most `LADDER.length - 1` times in a
 * session and then never again. That is the whole reason this is a ladder of
 * four rungs rather than an arithmetic step.
 */

/** Sharp to soft. Four rungs, so at most four blur kernels are ever compiled. */
export const TOUCH_SCALING_LADDER: readonly number[] = Object.freeze([
  0.65, 0.8, 1.0, 1.25,
]);

/**
 * Opens one rung down from the sharpest. Starting at the sharpest guarantees a
 * degrade (and its compile) on any phone that cannot hold it; starting soft
 * makes a good phone look bad until it earns its way up.
 */
export const TOUCH_LADDER_START_INDEX = 1;

/**
 * Frames per second the governor holds. Deliberately below 60: aiming at the
 * refresh ceiling makes the governor chase a target no vsynced device can
 * exceed, so it can only ever degrade. That exact mistake — a desktop profile
 * targeting 58 with an improve threshold of 66 — turned this into a one-way
 * ratchet to the blurriest rung.
 */
export const TOUCH_TARGET_FPS = 48;

/** Below target by this much for one window before dropping a rung. */
export const DEGRADE_MARGIN_FPS = 4;
/** Above target by this much before climbing. Must stay reachable under vsync. */
export const IMPROVE_MARGIN_FPS = 8;
/** Consecutive good windows required before spending on resolution again. */
export const IMPROVE_WINDOWS = 2;

/** How often the governor may act. Long, because acting can cost a compile. */
export const RENDER_SCALING_WINDOW_MS = 3_000;

/**
 * Quiet period after the scene reports ready. The first seconds carry model
 * upload and shader warm-up, and a frame rate measured through that says
 * nothing about how the device will actually run.
 */
export const RENDER_SCALING_WARMUP_MS = 5_000;

/**
 * Widest buffer desktop will render. A DPR-1 4K/5K monitor reports CSS
 * pixels equal to physical ones, so the DPR curve alone rendered every
 * pixel of a 3840-wide screen — with 4x MSAA on top, by far the heaviest
 * desktop case. 2560 keeps 1440p-and-below untouched.
 */
export const DESKTOP_MAX_RENDER_WIDTH_PX = 2560;

/**
 * Desktop's static level. The DPR curve is what desktop has always rendered
 * at on laptop panels, preserved exactly; the width cap only engages when
 * CSS width / level would exceed DESKTOP_MAX_RENDER_WIDTH_PX (big DPR-1
 * monitors). Applied once at session construction — desktop is **not**
 * governed. It had no reported problem, and raising its resolution the way
 * touch needed cost a retina Mac ~4x the pixels, which is what pushed it
 * under target and started the ratchet in the first place.
 */
export function desktopHardwareScalingLevel(
  devicePixelRatio: number,
  cssWidthPx?: number,
): number {
  const base = Math.max(1, Math.min(1.4, devicePixelRatio / 1.6));
  if (!cssWidthPx || cssWidthPx <= 0) return base;
  return Math.max(base, cssWidthPx / DESKTOP_MAX_RENDER_WIDTH_PX);
}

export interface RenderScalingState {
  /** Index into `TOUCH_SCALING_LADDER`. */
  index: number;
  /** Consecutive windows with headroom to spare. */
  goodWindows: number;
}

export function createRenderScalingState(): RenderScalingState {
  return { index: TOUCH_LADDER_START_INDEX, goodWindows: 0 };
}

export const renderScalingLevel = (state: RenderScalingState): number =>
  TOUCH_SCALING_LADDER[state.index];

/**
 * One governor window. Returns the level to apply — equal to the current one
 * when nothing should change, so the caller can skip `setHardwareScalingLevel`
 * (and the resize, and the possible recompile) entirely.
 *
 * Degrade on one bad window, improve only after two good ones: a scene sitting
 * exactly on the threshold then walks one way and settles, instead of
 * alternating between two rungs and flashing on every change.
 */
export function stepRenderScaling(
  state: RenderScalingState,
  fps: number,
): number {
  // A stalled or not-yet-measured frame rate says nothing, and acting on it
  // would dump resolution during the first frames after load.
  if (!Number.isFinite(fps) || fps <= 0) return renderScalingLevel(state);

  if (fps < TOUCH_TARGET_FPS - DEGRADE_MARGIN_FPS) {
    state.goodWindows = 0;
    state.index = Math.min(TOUCH_SCALING_LADDER.length - 1, state.index + 1);
    return renderScalingLevel(state);
  }

  if (fps > TOUCH_TARGET_FPS + IMPROVE_MARGIN_FPS) {
    state.goodWindows += 1;
    if (state.goodWindows >= IMPROVE_WINDOWS) {
      state.goodWindows = 0;
      state.index = Math.max(0, state.index - 1);
    }
    return renderScalingLevel(state);
  }

  // Inside the band: on target, leave it alone.
  state.goodWindows = 0;
  return renderScalingLevel(state);
}
