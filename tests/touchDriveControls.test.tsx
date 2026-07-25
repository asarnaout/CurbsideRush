// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TouchDriveControls,
  TOUCH_LEFT_RAIL_PX,
  TOUCH_PEDAL_RAIL_PX,
  TOUCH_TOP_RAIL_PX,
} from "../app/game/TouchDriveControls";
import { DRIVE_LAYER } from "../app/game/driveLayers";
import { TOUCH_STEER_FULL_LOCK_PX } from "../app/game/touchSteering";

afterEach(cleanup);

// jsdom implements neither pointer capture nor layout, so the component's calls
// have to land somewhere. Real geometry is not needed: steering is measured from
// clientX deltas, and the knob position is presentation only.
function stubPointerPlumbing() {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
}

function renderControls(overrides: Partial<Parameters<typeof TouchDriveControls>[0]> = {}) {
  const handlers = {
    onSteer: vi.fn(),
    onSteerRelease: vi.fn(),
    onThrottle: vi.fn(),
    onBrake: vi.fn(),
    onQuickLook: vi.fn(),
    onLookBehind: vi.fn(),
    onCamera: vi.fn(),
    onHorn: vi.fn(),
    onPause: vi.fn(),
    onTouchPointer: vi.fn(),
  };
  stubPointerPlumbing();
  render(
    <TouchDriveControls
      cameraMode="third"
      dimmed={false}
      reducedMotion={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

const pointer = (clientX: number, clientY = 200) => ({
  pointerId: 1,
  pointerType: "touch",
  clientX,
  clientY,
});

describe("touch driving controls", () => {
  it("steers analog from wherever the thumb lands", () => {
    const handlers = renderControls();
    const region = screen.getByTestId("steer-region");

    fireEvent.pointerDown(region, pointer(300));
    expect(handlers.onSteer).toHaveBeenLastCalledWith(0);

    fireEvent.pointerMove(region, pointer(300 + TOUCH_STEER_FULL_LOCK_PX));
    expect(handlers.onSteer).toHaveBeenLastCalledWith(1);

    fireEvent.pointerMove(region, pointer(300 - TOUCH_STEER_FULL_LOCK_PX));
    // Crossing the origin re-anchors rather than snapping to full opposite lock.
    expect(handlers.onSteer).toHaveBeenLastCalledWith(0);
  });

  it("hands the wheel back on pointerup and on pointercancel alike", () => {
    const handlers = renderControls();
    const region = screen.getByTestId("steer-region");

    fireEvent.pointerDown(region, pointer(300));
    fireEvent.pointerUp(region, pointer(340));
    expect(handlers.onSteerRelease).toHaveBeenCalledTimes(1);

    // pointercancel is what the browser sends when the system steals the
    // gesture. Handling only pointerup leaves the car turning by itself.
    fireEvent.pointerDown(region, pointer(300));
    fireEvent.pointerCancel(region, pointer(340));
    expect(handlers.onSteerRelease).toHaveBeenCalledTimes(2);
  });

  it("releases the pedals on pointercancel, not just pointerup", () => {
    const handlers = renderControls();
    const drive = screen.getByTestId("pedal-drive");

    fireEvent.pointerDown(drive, pointer(0));
    expect(handlers.onThrottle).toHaveBeenLastCalledWith(1);
    fireEvent.pointerCancel(drive, pointer(0));
    expect(handlers.onThrottle).toHaveBeenLastCalledWith(0);

    const brake = screen.getByTestId("pedal-brake");
    fireEvent.pointerDown(brake, pointer(0));
    expect(handlers.onBrake).toHaveBeenLastCalledWith(1);
    fireEvent.pointerUp(brake, pointer(0));
    expect(handlers.onBrake).toHaveBeenLastCalledWith(0);
  });

  it("names reverse on the brake, because the behaviour was always there", () => {
    renderControls();
    expect(screen.getByLabelText("Brake, and reverse once stopped")).toBeInTheDocument();
  });

  it("sits above the HUD layer", () => {
    renderControls();
    const group = screen.getByTestId("touch-drive-controls");
    expect(Number(group.style.zIndex)).toBe(DRIVE_LAYER.touch);
    expect(DRIVE_LAYER.touch).toBeGreaterThan(DRIVE_LAYER.hud);
  });

  it("shows look controls only in the cockpit, and keeps indicators off the screen", () => {
    renderControls();
    expect(screen.queryByLabelText("Look left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Left indicator")).not.toBeInTheDocument();

    cleanup();
    renderControls({ cameraMode: "first" });
    expect(screen.getByLabelText("Look left")).toBeInTheDocument();
    expect(screen.getByLabelText("Look right")).toBeInTheDocument();
    expect(screen.queryByLabelText("Left indicator")).not.toBeInTheDocument();
  });

  it("looks left as negative and right as positive", () => {
    const handlers = renderControls({ cameraMode: "first" });
    fireEvent.pointerDown(screen.getByLabelText("Look left"), pointer(0));
    expect(handlers.onQuickLook).toHaveBeenLastCalledWith(-1);
    fireEvent.pointerDown(screen.getByLabelText("Look right"), pointer(0));
    expect(handlers.onQuickLook).toHaveBeenLastCalledWith(1);
  });

  it("routes look-behind away from the clamped axis", () => {
    // quickLook is an angle selector, not an axis: only magnitudes above 1.5
    // mean "over your shoulder". Sending REAR through the -1..1 setter is how
    // the old button ended up behaving as a second "look right".
    const handlers = renderControls({ cameraMode: "first" });
    fireEvent.pointerDown(screen.getByLabelText("Look behind"), pointer(0));
    expect(handlers.onLookBehind).toHaveBeenLastCalledWith(true);
    expect(handlers.onQuickLook).not.toHaveBeenCalled();
    fireEvent.pointerCancel(screen.getByLabelText("Look behind"), pointer(0));
    expect(handlers.onLookBehind).toHaveBeenLastCalledWith(false);
  });

  // jsdom has no layout, so the boxes cannot be measured here — but the rail
  // budget is pure arithmetic, and getting it wrong is exactly how the minimap
  // ended up 31px on top of the DRIVE pedal on a real 734x343 phone.
  it("fits the right rail on the shortest landscape phone", () => {
    const SHORTEST_LANDSCAPE_PX = 320;
    const pedalStack = 100 + 10 + 84; // DRIVE, gap, BRAKE
    const inset = 12;

    // Buttons across the top, pedals up the right edge, and they must not meet.
    expect(TOUCH_TOP_RAIL_PX + pedalStack + inset).toBeLessThanOrEqual(
      SHORTEST_LANDSCAPE_PX,
    );

    // The minimap sits beside the pedals, not above them, so its column has to
    // be at least as wide as the map itself.
    expect(TOUCH_PEDAL_RAIL_PX).toBeGreaterThanOrEqual(84 + 8);

    // The steering region starts below the left rail, so a knob drawn at the
    // top of it still clears the status card.
    expect(TOUCH_LEFT_RAIL_PX).toBeGreaterThan(TOUCH_TOP_RAIL_PX);
    expect(TOUCH_LEFT_RAIL_PX).toBeLessThan(SHORTEST_LANDSCAPE_PX - 100);
  });

  it("dims without becoming untappable when another input takes over", () => {
    const handlers = renderControls({ dimmed: true });
    const group = screen.getByTestId("touch-drive-controls");
    expect(group.style.opacity).toBe("0.18");
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });
});
