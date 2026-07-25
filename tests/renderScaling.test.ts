import { describe, expect, it } from "vitest";
import {
  createRenderScalingState,
  DEGRADE_MARGIN_FPS,
  desktopHardwareScalingLevel,
  IMPROVE_MARGIN_FPS,
  RENDER_SCALING_WARMUP_MS,
  RENDER_SCALING_WINDOW_MS,
  renderScalingLevel,
  stepRenderScaling,
  TOUCH_LADDER_START_INDEX,
  TOUCH_SCALING_LADDER,
  TOUCH_TARGET_FPS,
} from "../app/game/renderScaling";

const run = (fpsSeries: readonly number[]) => {
  const state = createRenderScalingState();
  const levels = fpsSeries.map((fps) => stepRenderScaling(state, fps));
  return { state, levels };
};

describe("desktop resolution", () => {
  it("keeps the laptop DPR curve exactly as it has always been", () => {
    // Desktop had no reported problem. Governing it — and raising a retina
    // Mac to ~4x the pixels — is what pushed it under target, ratcheted it to
    // the blurriest rung, and flashed black on every step.
    expect(desktopHardwareScalingLevel(1)).toBe(1);
    expect(desktopHardwareScalingLevel(2)).toBeCloseTo(1.25, 10);
    expect(desktopHardwareScalingLevel(3)).toBeCloseTo(1.4, 10);
    // Never supersamples, never past the old ceiling.
    for (const dpr of [0.5, 1, 1.5, 2, 2.625, 3, 4]) {
      expect(desktopHardwareScalingLevel(dpr)).toBeGreaterThanOrEqual(1);
      expect(desktopHardwareScalingLevel(dpr)).toBeLessThanOrEqual(1.4);
    }
  });

  it("caps big DPR-1 monitors at the render-width budget", () => {
    // A 4K monitor at DPR 1 used to render all 3840 columns with 4x MSAA —
    // the heaviest desktop case. The cap holds the buffer at 2560 wide.
    expect(desktopHardwareScalingLevel(1, 3840)).toBeCloseTo(1.5, 10);
    expect(desktopHardwareScalingLevel(1, 5120)).toBeCloseTo(2, 10);
    // Everything 1440p and below is untouched by the cap...
    expect(desktopHardwareScalingLevel(1, 2560)).toBe(1);
    expect(desktopHardwareScalingLevel(1, 1920)).toBe(1);
    // ...and a retina laptop keeps its DPR level (CSS width nowhere near it).
    expect(desktopHardwareScalingLevel(2, 1512)).toBeCloseTo(1.25, 10);
  });
});

describe("the touch ladder", () => {
  it("is short, because every distinct rung costs a shader recompile", () => {
    // A resize re-asserts DefaultRenderingPipeline's bloomKernel, which pushes
    // a new kernel into both blur post-processes and recompiles them. Babylon
    // caches by define-set, so each rung costs one compile ever — but only if
    // the set of rungs is finite. A continuous knob flashes indefinitely.
    expect(TOUCH_SCALING_LADDER.length).toBeLessThanOrEqual(4);
  });

  it("runs sharp to soft, and starts one rung down from the sharpest", () => {
    for (let i = 1; i < TOUCH_SCALING_LADDER.length; i += 1) {
      expect(TOUCH_SCALING_LADDER[i]).toBeGreaterThan(TOUCH_SCALING_LADDER[i - 1]);
    }
    expect(TOUCH_LADDER_START_INDEX).toBeGreaterThan(0);
    expect(TOUCH_LADDER_START_INDEX).toBeLessThan(TOUCH_SCALING_LADDER.length - 1);
  });

  it("renders a phone far sharper than the 1.65 it was pinned to", () => {
    // The regression this guards: a level derived from devicePixelRatio, which
    // double-counts adaptToDeviceRatio and lands every phone on 1.65 — roughly
    // a fifth of native linear resolution.
    expect(Math.max(...TOUCH_SCALING_LADDER)).toBeLessThan(1.65);
  });
});

describe("render scaling governor", () => {
  it("keeps its improve threshold reachable under 60Hz vsync", () => {
    // The defect that made this a one-way ratchet: a profile targeting 58 fps
    // could only climb above 58 + 8 = 66, which no vsynced 60Hz display can
    // ever report. It degraded to the blurriest rung and stayed there.
    expect(TOUCH_TARGET_FPS + IMPROVE_MARGIN_FPS).toBeLessThan(60);
    expect(TOUCH_TARGET_FPS - DEGRADE_MARGIN_FPS).toBeGreaterThan(0);
  });

  it("acts rarely, and not at all while the scene is warming up", () => {
    // Acting costs a resize and possibly a compile, so the window is long and
    // the first seconds after ready — model upload, shader warm-up — are not
    // evidence about the device.
    expect(RENDER_SCALING_WINDOW_MS).toBeGreaterThanOrEqual(3_000);
    expect(RENDER_SCALING_WARMUP_MS).toBeGreaterThanOrEqual(3_000);
  });

  it("drops a rung as soon as the frame rate falls short", () => {
    const { levels } = run([30]);
    expect(levels[0]).toBeGreaterThan(TOUCH_SCALING_LADDER[TOUCH_LADDER_START_INDEX]);
  });

  it("climbs only after sustained headroom", () => {
    const { levels } = run([59, 59]);
    // One good window is not enough: a single spike must not cost a compile.
    expect(levels[0]).toBe(TOUCH_SCALING_LADDER[TOUCH_LADDER_START_INDEX]);
    expect(levels[1]).toBeLessThan(TOUCH_SCALING_LADDER[TOUCH_LADDER_START_INDEX]);
  });

  it("holds still inside the band around the target", () => {
    const start = TOUCH_SCALING_LADDER[TOUCH_LADDER_START_INDEX];
    const { levels } = run([48, 48, 50, 46, 52, 45]);
    expect(new Set(levels)).toEqual(new Set([start]));
  });

  it("settles instead of oscillating on the degrade threshold", () => {
    // Alternating just-bad / just-good is the pathological case: a governor
    // that flips every window flashes every window.
    const series = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? TOUCH_TARGET_FPS - 6 : TOUCH_TARGET_FPS + 2,
    );
    const { levels } = run(series);
    const changes = levels.filter((l, i) => i > 0 && l !== levels[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(TOUCH_SCALING_LADDER.length - 1);
    expect(levels.at(-1)).toBe(TOUCH_SCALING_LADDER.at(-1));
  });

  it("never visits more levels than the ladder has rungs", () => {
    // The bound on lifetime shader compiles, whatever the frame rate does.
    const chaotic = Array.from({ length: 300 }, (_, i) => 10 + ((i * 37) % 90));
    const { levels } = run(chaotic);
    for (const level of new Set(levels)) {
      expect(TOUCH_SCALING_LADDER).toContain(level);
    }
    expect(new Set(levels).size).toBeLessThanOrEqual(TOUCH_SCALING_LADDER.length);
  });

  it("clamps at both ends of the ladder", () => {
    expect(run(Array.from({ length: 60 }, () => 10)).levels.at(-1)).toBe(
      TOUCH_SCALING_LADDER.at(-1),
    );
    expect(run(Array.from({ length: 60 }, () => 59)).levels.at(-1)).toBe(
      TOUCH_SCALING_LADDER[0],
    );
  });

  it("does nothing on an unmeasured frame rate", () => {
    // The windows right after load report 0 while the engine warms up.
    const start = TOUCH_SCALING_LADDER[TOUCH_LADDER_START_INDEX];
    expect(run([0, Number.NaN, -1]).levels).toEqual([start, start, start]);
  });

  it("recovers once a throttled device cools off", () => {
    const state = createRenderScalingState();
    for (let i = 0; i < 10; i += 1) stepRenderScaling(state, 20);
    const throttled = renderScalingLevel(state);
    expect(throttled).toBe(TOUCH_SCALING_LADDER.at(-1));

    for (let i = 0; i < 10; i += 1) stepRenderScaling(state, 59);
    expect(renderScalingLevel(state)).toBeLessThan(throttled);
  });
});
