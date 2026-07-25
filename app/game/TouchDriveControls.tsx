"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DRIVE_LAYER } from "./driveLayers";
import {
  beginTouchSteer,
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
 * on the left with a floating origin, fronted by a visible slider so the
 * gesture is discoverable; the pedals sit side by side in the right corner; the
 * horn joins the left thumb because it is used *while* driving, and only the
 * things that are not driving (camera, pause, fullscreen) stay demoted to the
 * top corner.
 *
 * Pedals are side by side rather than stacked. Stacked they were ~194px of a
 * ~343px-tall phone, which is what forced the minimap out of the right edge
 * and beside them; abreast, the tallest is ~102px and the map gets its corner
 * back.
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
 * Palette. The drive screen was the last surface still on `system-ui` and
 * generic greys while every other view ran the dark HUD language; these are the
 * same values as the `--hud-*` custom properties in `globals.css`, repeated as
 * literals because this module is styled inline and rendered inside GameCanvas,
 * which has no stylesheet of its own.
 */
const CREAM = "#f4efde";
const GLASS = "rgba(11,15,17,.7)";
const GLASS_LINE = "rgba(255,255,255,.13)";
const SANS = '"Figtree", system-ui, sans-serif';

/** 44px is the smallest target Apple's HIG treats as reliably tappable. */
const UTILITY_PX = 44;

/** Top-right button row: one button plus its gap. */
export const TOUCH_TOP_RAIL_PX = UTILITY_PX + 8;

/**
 * Minimap edge length on touch. Shared with `SideSwapApp`, which sizes and
 * places it directly under the top button row — the one strip of the right edge
 * the pedals do not claim.
 */
export const TOUCH_MINIMAP_PX = 104;

/*
 * Pedal geometry. DRIVE is the larger of the pair and owns the outer edge: it
 * is held for most of a drive, so it gets the corner the thumb rests in, and
 * BRAKE sits inboard where a deliberate reach finds it.
 */
const DRIVE_W = 92;
const DRIVE_H = 102;
const BRAKE_W = 78;
const BRAKE_H = 86;
const PEDAL_GAP = 10;

/** Tallest pedal — what the right rail has to clear below the minimap. */
export const TOUCH_PEDAL_BLOCK_PX = DRIVE_H;

/**
 * Where the left rail (the status panel) ends and the steering region begins.
 * A fixed offset rather than a percentage: the panel is a fixed height, so a
 * percentage overlaps it on exactly the short viewports that can least afford
 * it.
 */
export const TOUCH_LEFT_RAIL_PX = 156;

/*
 * Steering slider. The drag region behind it is still the whole lower-left
 * quadrant with a floating origin — the bar is an affordance, not the target,
 * so there is nothing to aim at — but a control you can see is a control people
 * find, and the knob riding the track is the only readout of how much lock is
 * dialled in.
 */
const STEER_W = 196;
const STEER_H = 54;
const STEER_KNOB = 40;
const STEER_TRACK_INSET = 40;
const STEER_TRAVEL = (STEER_W - STEER_TRACK_INSET * 2 - STEER_KNOB) / 2;

const UTILITY_BUTTON: CSSProperties = {
  width: UTILITY_PX,
  height: UTILITY_PX,
  borderRadius: 999,
  border: `1px solid ${GLASS_LINE}`,
  background: GLASS,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)",
  backdropFilter: "blur(14px)",
  color: CREAM,
  font: `800 10px/1 ${SANS}`,
  letterSpacing: ".08em",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  display: "grid",
  placeItems: "center",
  padding: 0,
};

const PEDAL: CSSProperties = {
  border: "none",
  font: `900 15px/1 ${SANS}`,
  letterSpacing: ".05em",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  textAlign: "center",
};

function Glyph({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

type HeldControl = "drive" | "brake" | "horn";

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
  // on React, it goes straight out through onSteer. `null` means idle, which is
  // what re-centres the knob and un-suppresses its ease-back transition.
  const [steer, setSteer] = useState<number | null>(null);
  // Press feedback. One state object rather than one per control: it changes on
  // press and release only, never at frame rate.
  const [held, setHeld] = useState<Partial<Record<HeldControl, boolean>>>({});

  const setHold = useCallback((control: HeldControl, down: boolean) => {
    setHeld((current) =>
      Boolean(current[control]) === down ? current : { ...current, [control]: down },
    );
  }, []);

  const beginSteer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (steerPointerRef.current !== null) return;
      onTouchPointer(event.pointerType);
      event.currentTarget.setPointerCapture(event.pointerId);
      steerPointerRef.current = event.pointerId;
      steerRef.current = beginTouchSteer(event.clientX);
      setSteer(0);
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
      setSteer(value);
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
      setSteer(null);
      onSteerRelease();
    },
    [onSteerRelease],
  );

  const hold = useCallback(
    (apply: (value: number) => void, control?: HeldControl) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        onTouchPointer(event.pointerType);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (control) setHold(control, true);
        apply(1);
      },
      onPointerUp: () => {
        if (control) setHold(control, false);
        apply(0);
      },
      onPointerCancel: () => {
        if (control) setHold(control, false);
        apply(0);
      },
      onPointerLeave: () => {
        if (control) setHold(control, false);
        apply(0);
      },
    }),
    [onTouchPointer, setHold],
  );

  const dragging = steer !== null;
  const steerValue = steer ?? 0;

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
        aria-valuenow={steerValue}
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
          // rail so the drag can never begin on top of the status panel.
          top: TOUCH_LEFT_RAIL_PX,
          width: "46%",
          pointerEvents: "auto",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: SAFE_LEFT, bottom: SAFE_BOTTOM }}
        >
          <div
            style={{
              marginBottom: 7,
              paddingLeft: 4,
              font: `800 9px/1 ${SANS}`,
              letterSpacing: ".22em",
              color: "rgba(244,239,222,.62)",
              textShadow: "0 2px 8px rgba(0,0,0,.9)",
              opacity: dragging ? 0 : 1,
              transition: reducedMotion ? "none" : "opacity 160ms ease",
            }}
          >
            DRAG TO STEER
          </div>
          <div
            style={{
              position: "relative",
              width: STEER_W,
              height: STEER_H,
              borderRadius: STEER_H / 2,
              background: "rgba(11,15,17,.66)",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,.12)",
              boxShadow: "0 12px 26px -14px rgba(0,0,0,.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 13px",
              color: "rgba(244,239,222,.5)",
            }}
          >
            <Glyph size={16}>
              <path d="M13 7l-5 5 5 5" />
              <path d="M18 7l-5 5 5 5" />
            </Glyph>
            <span
              style={{
                position: "absolute",
                left: STEER_TRACK_INSET,
                right: STEER_TRACK_INSET,
                top: "50%",
                transform: "translateY(-50%)",
                height: 4,
                borderRadius: 999,
                background: "rgba(255,255,255,.11)",
              }}
            />
            {/*
              Cream and physical against the glass — the one control on the
              screen that represents a thing you hold rather than a thing you
              press. The transition is suppressed while dragging so the knob
              tracks the thumb exactly, and restored on release so it eases home
              over roughly the same 0.12s the input itself does.
            */}
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: STEER_KNOB,
                height: STEER_KNOB,
                marginLeft: -STEER_KNOB / 2,
                marginTop: -STEER_KNOB / 2,
                transform: `translateX(${steerValue * STEER_TRAVEL}px)`,
                transition:
                  dragging || reducedMotion ? "none" : "transform 120ms ease-out",
                borderRadius: "50%",
                background: "linear-gradient(180deg,#f8f3e4,#d9d2bd)",
                boxShadow:
                  "0 6px 14px -4px rgba(0,0,0,.7), inset 0 -2px 5px rgba(0,0,0,.16)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 2, height: 11, borderRadius: 1, background: "rgba(26,24,23,.3)" }} />
                <span style={{ width: 2, height: 15, borderRadius: 1, background: "rgba(26,24,23,.55)" }} />
                <span style={{ width: 2, height: 11, borderRadius: 1, background: "rgba(26,24,23,.3)" }} />
              </span>
            </span>
            <Glyph size={16}>
              <path d="M11 7l5 5-5 5" />
              <path d="M6 7l5 5-5 5" />
            </Glyph>
          </div>
        </div>
      </div>

      {/*
        The horn and, in the cockpit, the look controls: driving actions, so
        they live under the left thumb beside the wheel rather than up in the
        utility corner. They are siblings of the steer region and painted after
        it, which is what keeps them tappable through it.
      */}
      <div
        style={{
          position: "absolute",
          left: `calc(${SAFE_LEFT} + ${STEER_W + 14}px)`,
          bottom: SAFE_BOTTOM,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        {cameraMode === "first" && (
          <div
            data-testid="look-row"
            style={{ display: "flex", flexDirection: "row-reverse", gap: 8 }}
          >
            <button
              type="button"
              style={UTILITY_BUTTON}
              aria-label="Look right"
              {...hold(onQuickLook)}
            >
              <Glyph size={18}>
                <path d="M9 6l6 6-6 6" />
              </Glyph>
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
              <Glyph size={18}>
                <path d="M15 6l-6 6 6 6" />
              </Glyph>
            </button>
          </div>
        )}
        <button
          type="button"
          data-testid="horn-button"
          aria-label="Sound horn"
          style={{
            ...UTILITY_BUTTON,
            width: 48,
            height: 48,
            gap: 1,
            background: held.horn ? "rgba(244,200,72,.2)" : GLASS,
            borderColor: held.horn ? "rgba(244,200,72,.55)" : GLASS_LINE,
            boxShadow: "0 10px 22px -14px rgba(0,0,0,.85)",
          }}
          {...hold((value) => onHorn(value > 0), "horn")}
        >
          <Glyph size={17}>
            <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4Z" />
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M19.4 6.6a8 8 0 0 1 0 10.8" />
          </Glyph>
          <span style={{ font: `800 8px/1 ${SANS}`, letterSpacing: ".12em", opacity: 0.75 }}>
            HORN
          </span>
        </button>
      </div>

      {/*
        Pedals abreast in the corner, DRIVE outermost. The colour carries the
        meaning before the word does — sage go, coral stop — and the dark ink on
        a light face is what keeps them legible against a bright road, where
        glass panels wash out.
      */}
      <div
        style={{
          position: "absolute",
          right: SAFE_RIGHT,
          bottom: SAFE_BOTTOM,
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "flex-end",
          gap: PEDAL_GAP,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          aria-label="Accelerator"
          data-testid="pedal-drive"
          style={{
            ...PEDAL,
            width: DRIVE_W,
            height: DRIVE_H,
            borderRadius: 22,
            color: "#16210f",
            font: `900 17px/1 ${SANS}`,
            background: held.drive
              ? "linear-gradient(180deg,#b0cd91,#88ab6d)"
              : "linear-gradient(180deg,#a3c085,#7d9e63)",
            boxShadow: held.drive
              ? "0 4px 14px -8px rgba(125,158,99,.6), inset 0 2px 0 rgba(255,255,255,.32), inset 0 -3px 10px rgba(0,0,0,.22)"
              : "0 12px 26px -12px rgba(125,158,99,.6), inset 0 2px 0 rgba(255,255,255,.32), inset 0 -3px 8px rgba(0,0,0,.18)",
            transform: held.drive ? "translateY(1px)" : "none",
          }}
          {...hold(onThrottle, "drive")}
        >
          <Glyph size={22}>
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </Glyph>
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
          style={{
            ...PEDAL,
            width: BRAKE_W,
            height: BRAKE_H,
            borderRadius: 19,
            color: "#3a1109",
            background: held.brake
              ? "linear-gradient(180deg,#f39a85,#e26e58)"
              : "linear-gradient(180deg,#ef8a74,#d9614c)",
            boxShadow: held.brake
              ? "0 4px 12px -8px rgba(217,97,76,.55), inset 0 2px 0 rgba(255,255,255,.28), inset 0 -3px 10px rgba(0,0,0,.22)"
              : "0 12px 24px -12px rgba(217,97,76,.55), inset 0 2px 0 rgba(255,255,255,.28), inset 0 -3px 8px rgba(0,0,0,.18)",
            transform: held.brake ? "translateY(1px)" : "none",
          }}
          {...hold(onBrake, "brake")}
        >
          BRAKE
          <span
            style={{
              background: "rgba(58,17,9,.24)",
              borderRadius: 999,
              padding: "3px 8px",
              font: `800 9px/1 ${SANS}`,
              letterSpacing: ".1em",
              color: "rgba(58,17,9,.9)",
            }}
          >
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
          <Glyph>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z" />
            <circle cx="12" cy="13" r="3.5" />
          </Glyph>
        </button>
        <button type="button" style={UTILITY_BUTTON} aria-label="Pause" onClick={onPause}>
          <Glyph>
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </Glyph>
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
            <Glyph>
              {isFullscreen ? (
                <>
                  <path d="M10 20v-6H4" />
                  <path d="M14 4v6h6" />
                  <path d="m3 21 7-7" />
                  <path d="m21 3-7 7" />
                </>
              ) : (
                <>
                  <path d="M15 3h6v6" />
                  <path d="M9 21H3v-6" />
                  <path d="m21 3-7 7" />
                  <path d="m3 21 7-7" />
                </>
              )}
            </Glyph>
          </button>
        )}
      </div>
    </div>
  );
}
