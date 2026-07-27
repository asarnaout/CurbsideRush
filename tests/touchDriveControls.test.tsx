// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TouchDriveControls,
  TOUCH_CORNER_RAIL_PX,
  TOUCH_CORNER_SLOT_PX,
  TOUCH_LEFT_RAIL_PX,
  TOUCH_MINIMAP_PX,
  TOUCH_PEDAL_BLOCK_PX,
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
    onToggleFullscreen: vi.fn(),
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

  it("keeps the cockpit look controls out of the top row", () => {
    // They used to extend the top row leftward, which on a 734px-wide phone ran
    // REAR straight under the centred speed readout.
    renderControls({ cameraMode: "first" });
    const utilityRow = screen.getByTestId("utility-row");
    const lookRow = screen.getByTestId("look-row");
    expect(utilityRow).not.toContainElement(screen.getByLabelText("Look behind"));
    expect(lookRow).toContainElement(screen.getByLabelText("Look behind"));
    expect(lookRow).toContainElement(screen.getByLabelText("Look left"));
    expect(lookRow).toContainElement(screen.getByLabelText("Look right"));
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
    const inset = 12;

    // The right edge stacks: safe inset, button row, minimap — and below all of
    // that the pedals rise from the bottom inset. They must not meet. This is
    // the arithmetic that put the minimap 31px on top of DRIVE on a real
    // 734x343 phone when the pedals were still a stacked column.
    expect(
      inset + TOUCH_TOP_RAIL_PX + TOUCH_MINIMAP_PX + TOUCH_PEDAL_BLOCK_PX + inset,
    ).toBeLessThanOrEqual(SHORTEST_LANDSCAPE_PX);

    // Pedals abreast is what buys that room back: stacked, the column alone was
    // most of a landscape phone's height.
    expect(TOUCH_PEDAL_BLOCK_PX).toBeLessThan(TOUCH_MINIMAP_PX + 8);

    // The steering region starts below the left rail, so a drag begun at the
    // top of it still misses the status panel.
    expect(TOUCH_LEFT_RAIL_PX).toBeGreaterThan(TOUCH_TOP_RAIL_PX);
    expect(TOUCH_LEFT_RAIL_PX).toBeLessThan(SHORTEST_LANDSCAPE_PX - 100);

    // The horn, and above it the cockpit look row, share the bottom-left
    // cluster with the steering slider — that column has to clear the left rail.
    expect(inset + 48 + 8 + 44).toBeLessThan(
      SHORTEST_LANDSCAPE_PX - TOUCH_LEFT_RAIL_PX,
    );
  });

  // The other half of the same budget, and the reason the two constants split:
  // the corner row grew a button sideways, which must not push the minimap down.
  it("fits the top rail across the narrowest landscape phone", () => {
    const NARROWEST_LANDSCAPE_PX = 640;
    const inset = 12;
    // The app holds the corner (music, city map); the session's row starts
    // clear of it with camera, pause and fullscreen.
    expect(TOUCH_CORNER_RAIL_PX).toBe(TOUCH_CORNER_SLOT_PX * 2);
    const sessionRow = 3 * 44 + 2 * 8;
    const rightEdge = inset + TOUCH_CORNER_RAIL_PX + sessionRow;
    // The status panel is `min(250px, 37%)` on the left, and the speed readout
    // is centred between the two — it needs the middle to still exist.
    const statusPanel = Math.min(250, NARROWEST_LANDSCAPE_PX * 0.37);
    expect(rightEdge + statusPanel).toBeLessThan(NARROWEST_LANDSCAPE_PX);

    // A width, not a height: the corner row is one button tall however many
    // buttons it holds, so the vertical budget above is untouched by it.
    expect(TOUCH_TOP_RAIL_PX).toBe(52);
    expect(TOUCH_CORNER_RAIL_PX).toBeGreaterThan(TOUCH_TOP_RAIL_PX);
  });

  it("starts the session's row clear of the buttons the app owns", () => {
    renderControls();
    const row = screen.getByTestId("utility-row") as HTMLElement;
    expect(row.style.right).toContain(`${TOUCH_CORNER_RAIL_PX}px`);
  });

  it("offers fullscreen as a toggle, and only where the browser has the API", () => {
    // Mobile Safari ties its own toolbar hiding to scrolling, and the drive
    // screen cannot scroll — so on a phone this control is the only way to
    // reclaim the address bar's strip once the drive has started.
    const handlers = renderControls({ onToggleFullscreen: undefined });
    expect(screen.queryByTestId("toggle-fullscreen")).not.toBeInTheDocument();
    expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();

    cleanup();
    const live = renderControls();
    const toggle = screen.getByTestId("toggle-fullscreen");
    expect(toggle).toHaveAttribute("aria-label", "Play fullscreen");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(live.onToggleFullscreen).toHaveBeenCalledTimes(1);

    // Stays in place while fullscreen rather than vanishing: iOS exits on a
    // swipe with no press of ours, and a slot that empties shifts the row.
    cleanup();
    renderControls({ isFullscreen: true });
    const active = screen.getByTestId("toggle-fullscreen");
    expect(active).toHaveAttribute("aria-label", "Leave fullscreen");
    expect(active).toHaveAttribute("aria-pressed", "true");
  });

  it("dims without becoming untappable when another input takes over", () => {
    const handlers = renderControls({ dimmed: true });
    const group = screen.getByTestId("touch-drive-controls");
    expect(group.style.opacity).toBe("0.18");
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });
});
