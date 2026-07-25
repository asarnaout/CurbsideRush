import { describe, expect, it } from "vitest";
import {
  beginTouchSteer,
  releaseTouchSteer,
  steerFromTravel,
  TOUCH_STEER_DEAD_ZONE_PX,
  TOUCH_STEER_FULL_LOCK_PX,
  TOUCH_STEER_RELEASE_SECONDS,
  updateTouchSteer,
} from "../app/game/touchSteering";

describe("drag steering response", () => {
  it("holds zero inside the dead zone and leaves it continuously", () => {
    expect(steerFromTravel(0)).toBe(0);
    expect(steerFromTravel(TOUCH_STEER_DEAD_ZONE_PX)).toBe(0);
    expect(steerFromTravel(-TOUCH_STEER_DEAD_ZONE_PX)).toBe(0);

    // The failure this guards against is a dead zone used as a cutoff, which
    // makes the car snap into a turn the instant the thumb crosses it.
    const justOutside = steerFromTravel(TOUCH_STEER_DEAD_ZONE_PX + 0.01);
    expect(justOutside).toBeGreaterThan(0);
    expect(justOutside).toBeLessThan(0.001);
  });

  it("reaches exactly full lock at the full-lock travel, and clamps past it", () => {
    expect(steerFromTravel(TOUCH_STEER_FULL_LOCK_PX)).toBeCloseTo(1, 10);
    expect(steerFromTravel(-TOUCH_STEER_FULL_LOCK_PX)).toBeCloseTo(-1, 10);
    // Rubber-band: a thumb that slides further keeps lock rather than losing it.
    expect(steerFromTravel(TOUCH_STEER_FULL_LOCK_PX * 4)).toBeCloseTo(1, 10);
    expect(steerFromTravel(-9999)).toBeCloseTo(-1, 10);
  });

  it("is monotonic, odd, and gentler than linear near centre", () => {
    let previous = -Infinity;
    for (let travel = 0; travel <= TOUCH_STEER_FULL_LOCK_PX; travel += 2) {
      const value = steerFromTravel(travel);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(steerFromTravel(-travel)).toBeCloseTo(-value, 12);
      previous = value;
    }
    // Half travel gives well under half lock: that headroom is the fine control
    // you steer a lane with.
    expect(steerFromTravel(TOUCH_STEER_FULL_LOCK_PX / 2)).toBeLessThan(0.35);
  });
});

describe("drag steering origin", () => {
  it("measures travel from wherever the thumb landed, not from a fixed pad", () => {
    const low = beginTouchSteer(40);
    const high = beginTouchSteer(600);
    expect(updateTouchSteer(low, 40 + TOUCH_STEER_FULL_LOCK_PX)).toBeCloseTo(1, 10);
    expect(updateTouchSteer(high, 600 + TOUCH_STEER_FULL_LOCK_PX)).toBeCloseTo(1, 10);
  });

  it("re-anchors on a direction reversal so drift cannot bias the origin", () => {
    const state = beginTouchSteer(200);
    expect(updateTouchSteer(state, 280)).toBeCloseTo(1, 10);

    // Swinging back through the origin and out the other side re-anchors at the
    // turning point rather than reading a full-lock left from the old origin.
    expect(updateTouchSteer(state, 100)).toBe(0);
    expect(state.originX).toBe(100);

    // ...and steering now measures from there.
    expect(updateTouchSteer(state, 100 - TOUCH_STEER_FULL_LOCK_PX)).toBeCloseTo(-1, 10);
  });

  it("does not re-anchor while the thumb stays on one side", () => {
    const state = beginTouchSteer(0);
    updateTouchSteer(state, 60);
    updateTouchSteer(state, 20);
    expect(state.originX).toBe(0);
    expect(updateTouchSteer(state, 80)).toBeCloseTo(1, 10);
  });
});

describe("drag steering release", () => {
  it("eases to exactly zero, never a residual turn", () => {
    let value = 1;
    let frames = 0;
    while (value !== 0) {
      value = releaseTouchSteer(value, 1 / 60);
      frames += 1;
      expect(frames).toBeLessThan(600);
    }
    expect(value).toBe(0);
    // ~120ms at 60Hz, landing on the frame that crosses zero.
    expect(frames).toBe(Math.ceil(TOUCH_STEER_RELEASE_SECONDS * 60));
  });

  it("keeps the sign while easing, and is a no-op at rest", () => {
    expect(releaseTouchSteer(-1, 1 / 60)).toBeLessThan(0);
    expect(releaseTouchSteer(-1, 1 / 60)).toBeGreaterThan(-1);
    expect(releaseTouchSteer(0, 1 / 60)).toBe(0);
    expect(releaseTouchSteer(0.2, 10)).toBe(0);
  });
});
