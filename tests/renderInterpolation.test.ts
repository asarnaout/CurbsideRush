import { describe, expect, it } from "vitest";

import {
  POSE_SNAP_STEP_M,
  lerpHeading,
  lerpValue,
  shouldSnapPose,
  wrapAngleRad,
} from "../app/game/renderInterpolation";

describe("lerpValue", () => {
  it("returns the endpoints at alpha 0 and 1", () => {
    expect(lerpValue(2, 8, 0)).toBe(2);
    expect(lerpValue(2, 8, 1)).toBe(8);
  });

  it("blends linearly between the endpoints", () => {
    expect(lerpValue(2, 8, 0.5)).toBe(5);
    expect(lerpValue(-4, 4, 0.25)).toBe(-2);
  });
});

describe("wrapAngleRad", () => {
  it("leaves angles already in (-pi, pi] alone", () => {
    expect(wrapAngleRad(0)).toBe(0);
    expect(wrapAngleRad(1.5)).toBe(1.5);
    expect(wrapAngleRad(-3)).toBe(-3);
    expect(wrapAngleRad(Math.PI)).toBe(Math.PI);
  });

  it("wraps angles past the boundary back into range", () => {
    expect(wrapAngleRad(Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 12);
    expect(wrapAngleRad(-Math.PI - 0.2)).toBeCloseTo(Math.PI - 0.2, 12);
    expect(wrapAngleRad(5 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe("lerpHeading", () => {
  it("blends within a quadrant like plain lerp", () => {
    expect(lerpHeading(0.2, 0.6, 0.5)).toBeCloseTo(0.4, 12);
  });

  it("takes the short arc across the +/-pi seam", () => {
    // 3.1 -> -3.1 is 0.083 rad through the seam, not 6.2 rad the long way.
    const blended = lerpHeading(3.1, -3.1, 0.5);
    expect(wrapAngleRad(blended)).toBeCloseTo(Math.PI, 2);
    // Heading must move *forward* past pi, not backward toward zero.
    expect(Math.abs(wrapAngleRad(blended - 3.1))).toBeLessThan(0.1);
  });

  it("returns exactly the current heading at alpha 1", () => {
    // Modulo a full turn: the seam crossing may express -3.1 as 3.18...
    expect(wrapAngleRad(lerpHeading(3.1, -3.1, 1) - -3.1)).toBeCloseTo(0, 12);
    expect(lerpHeading(0.4, 1.1, 1)).toBeCloseTo(1.1, 12);
  });
});

describe("shouldSnapPose", () => {
  it("stays quiet for any legal per-step displacement", () => {
    // Fastest vehicle: ~31.5 m/s * 1/60 s = 0.525 m per step.
    expect(shouldSnapPose(0, 0, 0.525, 0, POSE_SNAP_STEP_M)).toBe(false);
    expect(shouldSnapPose(10, -4, 10.4, -4.4, POSE_SNAP_STEP_M)).toBe(false);
  });

  it("does not trip exactly at the threshold, trips just past it", () => {
    expect(shouldSnapPose(0, 0, POSE_SNAP_STEP_M, 0, POSE_SNAP_STEP_M)).toBe(
      false,
    );
    expect(
      shouldSnapPose(0, 0, POSE_SNAP_STEP_M + 0.001, 0, POSE_SNAP_STEP_M),
    ).toBe(true);
  });

  it("measures diagonal gaps, not per-axis ones", () => {
    expect(shouldSnapPose(0, 0, 2, 2, POSE_SNAP_STEP_M)).toBe(true);
  });
});
