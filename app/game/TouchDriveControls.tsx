"use client";

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { DRIVE_LAYER } from "./driveLayers";
import {
  beginTouchSteer,
  TOUCH_STEER_FULL_LOCK_PX,
  updateTouchSteer,
  type TouchSteerState,
} from "./touchSteering";

/**
 * The on-screen driving controls.
 *
 * Deliberately free of any Babylon import so it can be rendered in jsdom and
 * tested — the layering bug that made the old controls invisible was untestable
 * precisely because they were buried inside the 11k-line GameCanvas module,
 * which no DOM test can load.
 *
 * Layout follows what shipped mobile drivers converge on: the bottom band
 * belongs to thumbs and nothing else. Steering is a large invisible drag region
 * on the left with a floating origin; the pedals are on the right; everything
 * that is not driving (camera, horn, pause) is demoted to a small cluster in
 * the top corner, out of the way of both thumbs.
 *
 * Turn indicators are deliberately absent. They only ever mattered for authored
 * maneuvers, of which free drive and career days have none, and they were
 * occupying the best real estate on the screen.
 */

export interface TouchDriveControlsProps {
  readonly cameraMode: "first" | "third";
  readonly dimmed: boolean;
  readonly reducedMotion: boolean;
  /** -1..1, already shaped. The session owns the release ease. */
  readonly onSteer: (value: number) => void;
  readonly onSteerRelease: () => void;
  readonly onThrottle: (value: number) => void;
  readonly onBrake: (value: number) => void;
  readonly onQuickLook: (value: number) => void;
  readonly onLookBehind: (on: boolean) => void;
  readonly onCamera: () => void;
  readonly onHorn: (down: boolean) => void;
  readonly onPause: () => void;
  /** Omitted where the browser has no Fullscreen API to offer. */
  readonly onToggleFullscreen?: () => void;
  readonly isFullscreen?: boolean;
  /** Lets the session mark touch as the active input family. */
  readonly onTouchPointer: (pointerType: string) => void;
}

export const SAFE_LEFT = "max(12px, env(safe-area-inset-left))";
export const SAFE_RIGHT = "max(12px, env(safe-area-inset-right))";
const SAFE_BOTTOM = "max(12px, env(safe-area-inset-bottom))";
export const SAFE_TOP = "max(12px, env(safe-area-inset-top))";

/*
 * Rail geometry, shared with `SideSwapApp` so the HUD and the controls cannot
 * disagree about who owns which strip of a phone screen.
 *
 * Landscape phones are shorter than they look — an iPhone 14 Pro is 343 CSS px
 * tall, not the ~390 the arithmetic wants to assume — and the right edge has to
 * hold a button row *and* the pedal column with the minimap somewhere. Measured
 * on a real 734x343 viewport, stacking the minimap under the button row put it
 * 31px on top of the DRIVE pedal. So the minimap sits *beside* the pedals
 * instead, and vertical stacking is avoided entirely.
 */

/** Top-right button row: one 44px button plus its gap. */
export const TOUCH_TOP_RAIL_PX = 52;

/** Pedal column width plus its gap — what sits to the right of the minimap. */
export const TOUCH_PEDAL_RAIL_PX = 96;

/**
 * Minimap edge length on touch. Shared with `SideSwapApp`, which sizes it, and
 * used here to stack the cockpit look row directly above it.
 */
export const TOUCH_MINIMAP_PX = 104;

/**
 * Where the left rail (gig card, then status card) ends and the steering region
 * begins. A fixed offset rather than a percentage: the cards are a fixed height,
 * so a percentage overlaps them on exactly the short viewports that can least
 * afford it.
 */
export const TOUCH_LEFT_RAIL_PX = 208;

/** 44px is the smallest target Apple's HIG treats as reliably tappable. */
const UTILITY_BUTTON: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(12,20,23,.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)",
  backdropFilter: "blur(10px)",
  color: "#fff9ea",
  font: "700 11px/1 system-ui, sans-serif",
  letterSpacing: ".03em",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  display: "grid",
  placeItems: "center",
};

const PEDAL: CSSProperties = {
  width: 84,
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,.16)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 6px 18px rgba(0,0,0,.34)",
  backdropFilter: "blur(10px)",
  color: "#fff9ea",
  font: "800 14px/1.15 system-ui, sans-serif",
  letterSpacing: ".05em",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
};

export function TouchDriveControls({
  cameraMode,
  dimmed,
  reducedMotion,
  onSteer,
  onSteerRelease,
  onThrottle,
  onBrake,
  onQuickLook,
  onLookBehind,
  onCamera,
  onHorn,
  onPause,
  onToggleFullscreen,
  isFullscreen = false,
  onTouchPointer,
}: TouchDriveControlsProps) {
  const steerRef = useRef<TouchSteerState | null>(null);
  const steerPointerRef = useRef<number | null>(null);
  // Purely presentational: where the knob is drawn. Steering itself never waits
  // on React, it goes straight out through onSteer.
  const [knob, setKnob] = useState<{ x: number; y: number; offset: number } | null>(
    null,
  );

  const beginSteer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (steerPointerRef.current !== null) return;
      onTouchPointer(event.pointerType);
      event.currentTarget.setPointerCapture(event.pointerId);
      steerPointerRef.current = event.pointerId;
      steerRef.current = beginTouchSteer(event.clientX);
      const bounds = event.currentTarget.getBoundingClientRect();
      setKnob({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        offset: 0,
      });
      onSteer(0);
    },
    [onSteer, onTouchPointer],
  );

  const moveSteer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = steerRef.current;
      if (state === null || event.pointerId !== steerPointerRef.current) return;
      const value = updateTouchSteer(state, event.clientX);
      onSteer(value);
      const bounds = event.currentTarget.getBoundingClientRect();
      setKnob({
        x: state.originX - bounds.left,
        y: event.clientY - bounds.top,
        offset: value * TOUCH_STEER_FULL_LOCK_PX,
      });
    },
    [onSteer],
  );

  // pointercancel matters as much as pointerup: the browser fires it when the
  // system takes the gesture (a call, an edge swipe), and a handler that only
  // listens for pointerup leaves the input latched on.
  const endSteer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== steerPointerRef.current) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      steerPointerRef.current = null;
      steerRef.current = null;
      setKnob(null);
      onSteerRelease();
    },
    [onSteerRelease],
  );

  const hold = useCallback(
    (apply: (value: number) => void) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        onTouchPointer(event.pointerType);
        event.currentTarget.setPointerCapture(event.pointerId);
        apply(1);
      },
      onPointerUp: () => apply(0),
      onPointerCancel: () => apply(0),
      onPointerLeave: () => apply(0),
    }),
    [onTouchPointer],
  );

  return (
    <div
      role="group"
      aria-label={
        dimmed
          ? "Touch driving controls, dimmed while another input is active"
          : "Touch driving controls"
      }
      data-testid="touch-drive-controls"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.touch,
        opacity: dimmed ? 0.18 : 1,
        transition: reducedMotion ? "none" : "opacity 180ms ease",
      }}
    >
      <div
        role="slider"
        aria-label="Steering"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={0}
        data-testid="steer-region"
        onPointerDown={beginSteer}
        onPointerMove={moveSteer}
        onPointerUp={endSteer}
        onPointerCancel={endSteer}
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          // Wide enough that the thumb never has to aim; starts below the left
          // rail so the knob can never be drawn over the gig or status card.
          top: TOUCH_LEFT_RAIL_PX,
          width: "46%",
          pointerEvents: "auto",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {knob === null ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: SAFE_LEFT,
              bottom: SAFE_BOTTOM,
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(12,20,23,.6)",
              backdropFilter: "blur(10px)",
              color: "rgba(255,249,234,.72)",
              font: "700 11px/1 system-ui, sans-serif",
              letterSpacing: ".07em",
            }}
          >
            ‹ DRAG TO STEER ›
          </span>
        ) : (
          <span aria-hidden="true">
            <span
              style={{
                position: "absolute",
                left: knob.x - TOUCH_STEER_FULL_LOCK_PX,
                top: knob.y - 3,
                width: TOUCH_STEER_FULL_LOCK_PX * 2,
                height: 6,
                borderRadius: 999,
                background: "rgba(255,255,255,.16)",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: knob.x + knob.offset - 24,
                top: knob.y - 24,
                width: 48,
                height: 48,
                borderRadius: 999,
                border: "3px solid rgba(255,249,234,.85)",
                background: "rgba(12,20,23,.4)",
              }}
            />
          </span>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          right: SAFE_RIGHT,
          bottom: SAFE_BOTTOM,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          aria-label="Accelerator"
          data-testid="pedal-drive"
          style={{ ...PEDAL, height: 100, background: "rgba(36,104,77,.86)" }}
          {...hold(onThrottle)}
        >
          DRIVE
        </button>
        {/*
          One control, both jobs: `SimulationInput.reverse` brakes while the car
          is rolling forward and pulls away backwards from a standstill. The
          label is the whole feature — the behaviour was always there, but with
          the button reading "BRAKE" nobody found reverse.
        */}
        <button
          type="button"
          aria-label="Brake, and reverse once stopped"
          data-testid="pedal-brake"
          style={{ ...PEDAL, height: 84, background: "rgba(126,42,36,.84)" }}
          {...hold(onBrake)}
        >
          BRAKE
          <span style={{ display: "block", fontSize: 10, opacity: 0.75, letterSpacing: ".08em" }}>
            HOLD = R
          </span>
        </button>
      </div>

      {/*
        A horizontal row along the top edge, not a column down the right one:
        the right edge below it is spoken for by the minimap and then the
        pedals. The app's own music button holds the corner, so this starts one
        button-width in from it.
      */}
      <div
        data-testid="utility-row"
        style={{
          position: "absolute",
          right: `calc(${SAFE_RIGHT} + ${TOUCH_TOP_RAIL_PX}px)`,
          top: SAFE_TOP,
          display: "flex",
          flexDirection: "row-reverse",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        <button type="button" style={UTILITY_BUTTON} aria-label="Change camera" onClick={onCamera}>
          CAM
        </button>
        <button
          type="button"
          style={UTILITY_BUTTON}
          aria-label="Sound horn"
          onPointerDown={() => onHorn(true)}
          onPointerUp={() => onHorn(false)}
          onPointerCancel={() => onHorn(false)}
          onPointerLeave={() => onHorn(false)}
        >
          HORN
        </button>
        <button type="button" style={UTILITY_BUTTON} aria-label="Pause" onClick={onPause}>
          &#x2161;
        </button>
        {/*
          A toggle rather than a button that vanishes on success: iOS drops out
          of fullscreen on a swipe with no press of ours, and the slot staying
          filled is also what stops the row shifting under the player's thumb.
        */}
        {onToggleFullscreen && (
          <button
            type="button"
            style={UTILITY_BUTTON}
            data-testid="toggle-fullscreen"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Leave fullscreen" : "Play fullscreen"}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? "\u2924" : "\u26F6"}
          </button>
        )}
      </div>

      {/*
        Cockpit look controls get their own row, stacked directly above the
        minimap. They used to extend the top row leftward, which on a 734px-wide
        phone ran the REAR button straight under the centred speed readout.
      */}
      {cameraMode === "first" && (
        <div
          data-testid="look-row"
          style={{
            position: "absolute",
            right: `calc(${SAFE_RIGHT} + ${TOUCH_PEDAL_RAIL_PX}px)`,
            bottom: `calc(${SAFE_BOTTOM} + ${TOUCH_MINIMAP_PX + 8}px)`,
            display: "flex",
            flexDirection: "row-reverse",
            gap: 8,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            style={UTILITY_BUTTON}
            aria-label="Look right"
            {...hold(onQuickLook)}
          >
            &#x25BA;
          </button>
          <button
            type="button"
            style={UTILITY_BUTTON}
            aria-label="Look behind"
            onPointerDown={(event) => {
              onTouchPointer(event.pointerType);
              event.currentTarget.setPointerCapture(event.pointerId);
              onLookBehind(true);
            }}
            onPointerUp={() => onLookBehind(false)}
            onPointerCancel={() => onLookBehind(false)}
            onPointerLeave={() => onLookBehind(false)}
          >
            REAR
          </button>
          <button
            type="button"
            style={UTILITY_BUTTON}
            aria-label="Look left"
            {...hold((value) => onQuickLook(-value))}
          >
            &#x25C4;
          </button>
        </div>
      )}
    </div>
  );
}
