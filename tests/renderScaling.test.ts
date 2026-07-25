import { describe, expect, it } from "vitest";
import {
  createRenderScalingState,
  DESKTOP_RENDER_PROFILE,
  resolveRenderProfile,
  stepRenderScaling,
  TOUCH_RENDER_PROFILE,
} from "../app/game/renderScaling";

const run = (
  fpsSeries: readonly number[],
  profile = TOUCH_RENDER_PROFILE,
) => {
  const state = createRenderScalingState(profile);
  const levels: number[] = [];
  for (const fps of fpsSeries) levels.push(stepRenderScaling(state, fps, profile));
  return { state, levels };
};

describe("render scaling profiles", () => {
  it("renders a phone far sharper than the 1.65 it was pinned to", () => {
    // The regression this guards: a level derived from devicePixelRatio, which
    // double-counts adaptToDeviceRatio and lands every phone on 1.65 —
    // roughly a fifth of native linear resolution.
    expect(TOUCH_RENDER_PROFILE.start).toBeLessThan(1);
    expect(TOUCH_RENDER_PROFILE.max).toBeLessThan(1.65);
  });

  it("never asks a DPR-1 monitor to supersample", () => {
    expect(resolveRenderProfile(false, 1).start).toBe(1);
    expect(resolveRenderProfile(false, 2).start).toBe(DESKTOP_RENDER_PROFILE.start);
    expect(resolveRenderProfile(false, 3).start).toBe(DESKTOP_RENDER_PROFILE.start);
  });

  it("ignores the device ratio entirely on touch", () => {
    expect(resolveRenderProfile(true, 1)).toBe(TOUCH_RENDER_PROFILE);
    expect(resolveRenderProfile(true, 3)).toBe(TOUCH_RENDER_PROFILE);
  });
});

describe("render scaling governor", () => {
  it("gives up resolution as soon as the frame rate drops", () => {
    const { levels } = run([30]);
    expect(levels[0]).toBeGreaterThan(TOUCH_RENDER_PROFILE.start);
  });

  it("takes resolution back only after sustained headroom", () => {
    const { levels } = run([60, 60]);
    // One good window is not enough — a single spike must not cost a frame.
    expect(levels[0]).toBe(TOUCH_RENDER_PROFILE.start);
    expect(levels[1]).toBeLessThan(TOUCH_RENDER_PROFILE.start);
  });

  it("holds still inside the band around the target", () => {
    const { levels } = run([48, 48, 48, 48, 50, 46]);
    expect(new Set(levels)).toEqual(new Set([TOUCH_RENDER_PROFILE.start]));
  });

  it("does not oscillate when the frame rate sits on the degrade threshold", () => {
    // Alternating just-bad / just-good is the pathological case: a naive
    // governor flips resolution every window, which reads far worse than
    // simply sitting one step softer.
    const series = Array.from({ length: 40 }, (_, index) =>
      index % 2 === 0 ? TOUCH_RENDER_PROFILE.targetFps - 6 : TOUCH_RENDER_PROFILE.targetFps + 2,
    );
    const { levels } = run(series);
    const changes = levels.filter((level, index) => index > 0 && level !== levels[index - 1]);
    // It walks down to the floor and stays; it does not bounce back up.
    expect(changes.length).toBeLessThanOrEqual(
      Math.ceil((TOUCH_RENDER_PROFILE.max - TOUCH_RENDER_PROFILE.start) / 0.08) + 1,
    );
    expect(levels.at(-1)).toBe(TOUCH_RENDER_PROFILE.max);
  });

  it("clamps at both ends", () => {
    const starved = run(Array.from({ length: 60 }, () => 10));
    expect(starved.levels.at(-1)).toBe(TOUCH_RENDER_PROFILE.max);

    const idle = run(Array.from({ length: 60 }, () => 120));
    expect(idle.levels.at(-1)).toBe(TOUCH_RENDER_PROFILE.min);
  });

  it("does nothing on an unmeasured frame rate", () => {
    // The first windows after load report 0 while the engine is still warming
    // up. Acting on that would dump resolution exactly when the scene appears.
    const { levels } = run([0, Number.NaN, -1]);
    expect(levels).toEqual([
      TOUCH_RENDER_PROFILE.start,
      TOUCH_RENDER_PROFILE.start,
      TOUCH_RENDER_PROFILE.start,
    ]);
  });

  it("recovers resolution once a throttled device cools off", () => {
    const state = createRenderScalingState(TOUCH_RENDER_PROFILE);
    for (let i = 0; i < 10; i += 1) stepRenderScaling(state, 20, TOUCH_RENDER_PROFILE);
    const throttled = state.level;
    expect(throttled).toBe(TOUCH_RENDER_PROFILE.max);

    for (let i = 0; i < 10; i += 1) stepRenderScaling(state, 60, TOUCH_RENDER_PROFILE);
    expect(state.level).toBeLessThan(throttled);
  });
});
