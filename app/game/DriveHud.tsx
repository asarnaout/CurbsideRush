/**
 * The desktop drive HUD, built to the `Curbside Driving HUD Desktop` design.
 *
 * Props-pure and deliberately free of any Babylon import, so `tests/driveHud.
 * test.tsx` can render it in jsdom the way `touchDriveControls.test.tsx`
 * renders the controls. It knows nothing about gigs, dispatch or career — the
 * app hands it finished strings and numbers.
 *
 * **Every layer here takes its z-index from `DRIVE_LAYER`.** The HUD and the
 * driving controls are z-order siblings in one stacking context spread across
 * two files, and hard-coding a number in either is how the pedals ended up
 * painted under the minimap for months — invisible, still tappable, and
 * untestable. See `driveLayers.ts`.
 *
 * The comp is a fixed 1920x1080 frame and every cluster is corner-anchored, so
 * each is laid out at the comp's own pixel sizes and then scaled as a whole
 * (`scale`, from `resolveHudScale`). That keeps one set of numbers to check
 * against the design instead of a second responsive arithmetic to get wrong.
 */

import type { CSSProperties, ReactNode } from "react";

import { DRIVE_LAYER } from "./driveLayers";
import { TOUCH_CORNER_SLOT_PX } from "./TouchDriveControls";
import {
  CAMERA_ICON,
  FOOD_ICON,
  MAP_ICON,
  MUSIC_ICON,
  MUSIC_MUTED_ICON,
  PARCEL_ICON,
  PAUSE_ICON,
  RIDER_ICON,
  STOPWATCH_ICON,
  WALLET_ICON,
} from "./hudIcons";

// ---------------------------------------------------------------------------
// Palette and type. These repeat globals.css's `--hud-*` custom properties as
// literals for the same reason the rest of the drive screen does: it is styled
// inline throughout, and splitting it across a stylesheet is what caused the
// z-order bug driveLayers.ts exists to prevent.
// ---------------------------------------------------------------------------

export const HUD_CREAM = "#f4efde";
export const HUD_GOLD = "#f4c848";
export const HUD_CORAL = "#e8705a";
export const HUD_SAGE = "#8fae72";
export const HUD_GLASS = "rgba(11,15,17,.78)";
export const HUD_SANS = '"Figtree", system-ui, sans-serif';
export const HUD_SERIF = '"Playfair Display", Georgia, serif';
/** The ink and paper of the offer card, the one light surface on the screen. */
export const HUD_INK = "#201e1d";

/** Width the comp was drawn at. Everything below is in its pixels. */
export const HUD_DESIGN_WIDTH = 1920;
/** Below this the clusters would eat the road, so scaling stops. */
export const HUD_MIN_SCALE = 0.68;

/**
 * How much to shrink the HUD for a viewport narrower than the comp.
 *
 * A 486px nav card is a quarter of a 1920 screen and well over a third of a
 * 1280 one, which is the difference between a readout and an obstruction.
 */
export function resolveHudScale(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.min(1, Math.max(HUD_MIN_SCALE, viewportWidth / HUD_DESIGN_WIDTH));
}

// ---------------------------------------------------------------------------
// Icons — Lucide at stroke-width 2.75, the design system's own convention.
// ---------------------------------------------------------------------------

export function HudGlyph({
  path,
  size = 14,
  color = "rgba(244,239,222,.55)",
  strokeWidth = 2.4,
}: {
  path: readonly string[];
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {path.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * A figure that takes up the same room whatever it reads.
 *
 * Both big readouts sit in one flex row centred with `translate: -50%`, so a
 * numeral that grows a digit widens the row and slides *everything* — 0 → 37
 * walked the speed-limit plate left and the shift clock right, which is the
 * whole top of the screen moving because the driver touched the throttle.
 *
 * The slot is sized by a hidden copy of the widest string it will ever hold,
 * in the same font as the figure, and the real value is laid over it. So there
 * is no measured pixel constant to go stale: it follows the font, the weight,
 * the letter-spacing and `compact`'s smaller type on its own. Tabular figures
 * do the rest — every digit is the same advance, so nothing shifts *within* the
 * slot either.
 *
 * Right-aligned by default, which is the one alignment that keeps the units
 * digit — the one changing constantly — pinned, and keeps the figure welded to
 * the unit label beside it. Centring it instead splits the slack either side
 * and detaches the number from its "MPH".
 */
function HudNumeralSlot({
  widest,
  metrics,
  style,
  align = "right",
  testId,
  children,
}: {
  /** The widest value this slot must hold. Never seen, never announced. */
  widest: string;
  /** Font metrics, set on the box so the sizer measures exactly like the value. */
  metrics: CSSProperties;
  /** Colour and anything else only the visible figure wants. */
  style?: CSSProperties;
  align?: "right" | "center" | "left";
  testId?: string;
  children: ReactNode;
}) {
  return (
    <span style={{ ...metrics, position: "relative", display: "inline-block", textAlign: align }}>
      <span aria-hidden="true" style={{ visibility: "hidden" }}>
        {widest}
      </span>
      <span data-testid={testId} style={{ position: "absolute", left: 0, right: 0, top: 0, ...style }}>
        {children}
      </span>
    </span>
  );
}

/**
 * What the speed slot has to hold. The simulation clamps `maxForwardSpeedMps`
 * at 50, which is 112 mph and 180 km/h, so three digits is reachable in either
 * unit and the slot is sized for it in both — a slot that changed with the
 * country would move the plate on landing in Tokyo.
 */
const WIDEST_SPEED = "000";

const MUSIC_DIM_COLOR = "rgba(244,239,222,.4)";

/** One arrow per manoeuvre kind, matching `GpsManoeuvreKind`. */
const MANOEUVRE_ICON: Readonly<Record<string, readonly string[]>> = {
  left: ["M16 21V12a5 5 0 0 0-5-5H5", "M9 3 5 7l4 4"],
  right: ["M8 21V12a5 5 0 0 1 5-5h6", "M15 3l4 4-4 4"],
  straight: ["M12 21V4", "M6 10l6-6 6 6"],
  uturn: ["M7 21V10a5 5 0 0 1 10 0v5", "M13 11l4 4 4-4"],
  arrive: [
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
    "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
};

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface HudManoeuvre {
  readonly kind: "left" | "right" | "straight" | "uturn" | "arrive";
  /** The street being joined, already resolved to its display name. */
  readonly street: string;
  readonly distanceValue: string;
  readonly distanceUnit: string;
  /** True once the turn is close enough to act on — lights the plate. */
  readonly imminent: boolean;
  /**
   * How much of the journey to the stop is behind you, 0→1 — *not* proximity to
   * the next turn, which sawtoothed back to empty at every corner and told the
   * driver nothing about how far they still had to go.
   */
  readonly destinationProgress: number;
  /** What is left of it, e.g. "1.2 mi". */
  readonly destinationDistance: string;
}

export interface HudGauge {
  readonly id: string;
  readonly icon: readonly string[];
  /** Announced to screen readers; `careerFlow.test.tsx` queries on it. */
  readonly label: string;
  readonly value: string;
  readonly fill: number;
  readonly fillColor: string;
  readonly testId?: string;
  readonly fillTransition?: string;
}

export interface HudJob {
  readonly kind: "delivery" | "passenger";
  /** "PICK UP" / "DELIVER" / "DROP OFF". */
  readonly eyebrow: string;
  readonly target: string;
  readonly sub: string;
  readonly pay: string;
  /** The quoted tip, when the customer named one up front. */
  readonly tip: string | null;
  /** A one-line nudge under the job — stop the car, the tip clock. */
  readonly hint: string | null;
  readonly surged: boolean;
}

const cluster = (scale: number, origin: string, rest: CSSProperties): CSSProperties => ({
  position: "absolute",
  transform: scale === 1 ? undefined : `scale(${scale})`,
  transformOrigin: origin,
  zIndex: DRIVE_LAYER.hud,
  ...rest,
});

// ---------------------------------------------------------------------------
// Top-left: where you are going, and what you are carrying
// ---------------------------------------------------------------------------

/**
 * Two sizings for the same clusters: the desktop comp and the mobile one.
 *
 * `Curbside Driving HUD Mobile` is drawn at 1740x800 — a landscape phone's
 * ~870x400 CSS pixels at 2x — so every figure below is the comp's halved. They
 * sit side by side rather than as ternaries at each property so a value can be
 * checked against either design without reading the JSX.
 */
interface NavMetrics {
  readonly width: number;
  readonly radius: number;
  readonly pad: string;
  readonly rail: { readonly left: number; readonly inset: number; readonly width: number };
  readonly plate: number;
  readonly plateRadius: number;
  readonly arrow: number;
  readonly dist: number;
  readonly unit: number;
  readonly kicker: number;
  readonly street: number;
  readonly bar: number;
  readonly barMargin: string;
  readonly rowGap: number;
  readonly label: number;
  readonly nextStreet: number;
  readonly nextDistance: number;
  readonly icon: number;
  readonly jobName: number;
  readonly pay: number;
  readonly payPad: string;
  readonly gaugeValue: number;
  readonly gaugeValueWidth: number;
  readonly gaugeBar: number;
  readonly gap: number;
}

const NAV_DESKTOP: NavMetrics = {
  width: 486, radius: 24, pad: "16px 18px 13px 24px",
  rail: { left: 10, inset: 18, width: 5 },
  plate: 74, plateRadius: 21, arrow: 42,
  dist: 35, unit: 15, kicker: 11, street: 30,
  bar: 3, barMargin: "12px 0 11px", rowGap: 12,
  label: 11, nextStreet: 15, nextDistance: 13, icon: 16,
  jobName: 18, pay: 17, payPad: "3px 13px",
  gaugeValue: 15, gaugeValueWidth: 46, gaugeBar: 6, gap: 16,
};

const NAV_MOBILE: NavMetrics = {
  width: 330, radius: 14, pad: "10px 11px 9px 15px",
  rail: { left: 6, inset: 11, width: 3 },
  plate: 46, plateRadius: 13, arrow: 27,
  dist: 23, unit: 10, kicker: 8, street: 19,
  bar: 2, barMargin: "7px 0 6px", rowGap: 7,
  label: 8, nextStreet: 10, nextDistance: 9, icon: 10,
  jobName: 12, pay: 11, payPad: "2px 8px",
  gaugeValue: 10, gaugeValueWidth: 28, gaugeBar: 4, gap: 9,
};


export function DriveNavCard({
  scale,
  inset,
  manoeuvre,
  nextManoeuvre,
  job,
  idleLabel,
  gauges,
  queued,
  money = null,
  compact = false,
}: {
  scale: number;
  inset: { readonly top: string; readonly left: string };
  /** Sizes the card from the mobile comp instead of the desktop one. */
  compact?: boolean;
  manoeuvre: HudManoeuvre | null;
  nextManoeuvre: { readonly kind: HudManoeuvre["kind"]; readonly street: string; readonly distance: string } | null;
  job: HudJob | null;
  /** Shown in the job's place when there is nothing in hand. */
  idleLabel: string | null;
  gauges: readonly HudGauge[];
  queued: { readonly title: string; readonly pay: string } | null;
  /**
   * Balance and shift total, shown in this card's header instead of their own
   * cluster. The mobile comp puts them top-right, but that corner already
   * carries the camera/pause/fullscreen rail — and fullscreen is the only way
   * to reclaim Safari's chrome mid-drive, so it is not negotiable. Beside the
   * job is where the numbers that change together belong anyway.
   */
  money?: {
    readonly balance: string;
    readonly session: string;
    /** False on an exactly-even shift — see `DriveMoneyCluster`'s prop of the same name (#267). */
    readonly sessionVisible: boolean;
    readonly label: string;
  } | null;
}) {
  const m = compact ? NAV_MOBILE : NAV_DESKTOP;
  const railColor = job ? (job.kind === "passenger" ? HUD_SAGE : HUD_CORAL) : "rgba(244,239,222,.28)";
  return (
    <div
      style={cluster(scale, "top left", {
        top: inset.top,
        left: inset.left,
        width: m.width,
        display: "flex",
        flexDirection: "column",
        gap: compact ? 7 : 12,
        pointerEvents: "none",
      })}
    >
      <div
        data-testid="drive-status-card"
        style={{
          position: "relative",
          background: HUD_GLASS,
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,.09)",
          borderRadius: m.radius,
          padding: m.pad,
          boxShadow: "0 24px 56px -26px rgba(0,0,0,.88)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: m.rail.left,
            top: m.rail.inset,
            bottom: m.rail.inset,
            width: m.rail.width,
            borderRadius: 999,
            background: railColor,
          }}
        />

        {money && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 7,
              marginBottom: m.rowGap,
            }}
          >
            <span
              data-testid="day-cash"
              style={{
                font: `900 ${m.dist - 4}px/1 ${HUD_SANS}`,
                color: HUD_CREAM,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.5px",
              }}
            >
              {money.balance}
            </span>
            <span
              style={{
                font: `900 ${m.nextDistance}px ${HUD_SANS}`,
                color: HUD_GOLD,
                fontVariantNumeric: "tabular-nums",
                // Reserved, not removed, on an exactly-even shift — the label
                // after it (sometimes the only clock this width has, see
                // `dayTimerInRow`) must not slide left to close the gap (#267).
                visibility: money.sessionVisible ? "visible" : "hidden",
              }}
            >
              {money.session}
            </span>
            {/*
              What the figure beside it means, nothing more. The shift clock
              used to be crammed in here at 7px and 34% opacity, which is how it
              came to be invisible (#236); the phone reads it top-centre now,
              the same as the desktop.
            */}
            <span
              data-testid="session-label"
              style={{
                marginLeft: "auto",
                font: `800 ${m.label - 1}px ${HUD_SANS}`,
                letterSpacing: "1.6px",
                color: "rgba(244,239,222,.34)",
                whiteSpace: "nowrap",
              }}
            >
              {money.label}
            </span>
          </div>
        )}
        {manoeuvre ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: m.gap }}>
              <div
                data-testid="manoeuvre-plate"
                style={{
                  position: "relative",
                  width: m.plate,
                  height: m.plate,
                  flex: "none",
                  borderRadius: m.plateRadius,
                  display: "grid",
                  placeItems: "center",
                  background: manoeuvre.imminent ? HUD_GOLD : "rgba(244,200,72,.13)",
                  border: `1px solid ${manoeuvre.imminent ? HUD_GOLD : "rgba(244,200,72,.3)"}`,
                  boxShadow: manoeuvre.imminent ? "0 0 30px -4px rgba(244,200,72,.8)" : "none",
                  transition: "background .2s ease, box-shadow .2s ease",
                }}
              >
                <HudGlyph
                  path={MANOEUVRE_ICON[manoeuvre.kind] ?? MANOEUVRE_ICON.straight}
                  size={m.arrow}
                  strokeWidth={2.6}
                  color={manoeuvre.imminent ? "#241c05" : HUD_GOLD}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: compact ? 5 : 8,
                    marginBottom: 2,
                  }}
                >
                  <span
                    data-testid="manoeuvre-distance"
                    style={{
                      font: `900 ${m.dist}px/1 ${HUD_SANS}`,
                      color: HUD_CREAM,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-1.4px",
                    }}
                  >
                    {manoeuvre.distanceValue}
                  </span>
                  <span
                    style={{
                      font: `800 ${m.unit}px ${HUD_SANS}`,
                      letterSpacing: "1.6px",
                      color: "rgba(244,239,222,.48)",
                      textTransform: "uppercase",
                    }}
                  >
                    {manoeuvre.distanceUnit}
                  </span>
                  <span
                    style={{
                      font: `800 ${m.kicker}px ${HUD_SANS}`,
                      letterSpacing: "2.2px",
                      color: manoeuvre.imminent ? HUD_GOLD : "rgba(244,239,222,.5)",
                      marginLeft: 3,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {manoeuvreKicker(manoeuvre)}
                  </span>
                </div>
                <div
                  data-testid="manoeuvre-street"
                  style={{
                    font: `700 ${m.street}px/1.08 ${HUD_SERIF}`,
                    color: HUD_CREAM,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {manoeuvre.street}
                </div>
              </div>
            </div>

            {/*
              The run to the stop, not to the next turn. Labelled because the
              comp's bar meant proximity to the manoeuvre above it, and a bar
              that silently changed meaning is worse than one that never had a
              caption.
            */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: compact ? 7 : 10,
                margin: m.barMargin,
              }}
            >
              <span
                style={{
                  font: `800 ${m.label - 1}px ${HUD_SANS}`,
                  letterSpacing: "2px",
                  color: "rgba(244,239,222,.3)",
                  flex: "none",
                }}
              >
                TO GO
              </span>
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: m.bar,
                  borderRadius: 999,
                  background: "rgba(255,255,255,.09)",
                  overflow: "hidden",
                }}
              >
                <div
                  data-testid="destination-progress"
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg,rgba(244,200,72,.45),${HUD_GOLD})`,
                    width: `${Math.round(Math.min(1, Math.max(0, manoeuvre.destinationProgress)) * 100)}%`,
                    transition: "width .3s linear",
                  }}
                />
              </div>
              <span
                data-testid="destination-distance"
                style={{
                  font: `700 ${m.nextDistance}px ${HUD_SANS}`,
                  color: "rgba(244,239,222,.5)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  flex: "none",
                }}
              >
                {manoeuvre.destinationDistance}
              </span>
            </div>
          </>
        ) : null}

        {nextManoeuvre && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: m.rowGap,
            }}
          >
            <span
              style={{
                font: `800 ${m.label}px ${HUD_SANS}`,
                letterSpacing: "2.2px",
                color: "rgba(244,239,222,.3)",
              }}
            >
              NEXT
            </span>
            <HudGlyph
              path={MANOEUVRE_ICON[nextManoeuvre.kind] ?? MANOEUVRE_ICON.straight}
              size={m.icon - 1}
              strokeWidth={2.8}
              color="rgba(244,239,222,.44)"
            />
            <span
              style={{
                font: `600 ${m.nextStreet}px ${HUD_SANS}`,
                color: "rgba(244,239,222,.56)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {nextManoeuvre.street}
            </span>
            <span
              style={{
                marginLeft: "auto",
                font: `700 ${m.nextDistance}px ${HUD_SANS}`,
                color: "rgba(244,239,222,.32)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {nextManoeuvre.distance}
            </span>
          </div>
        )}

        {(manoeuvre || nextManoeuvre) && (
          <div
            aria-hidden="true"
            style={{ height: 1, background: "rgba(255,255,255,.09)", marginBottom: m.rowGap - 1 }}
          />
        )}

        {job ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: compact ? 8 : 11,
              marginBottom: m.rowGap,
            }}
          >
            <HudGlyph
              path={job.kind === "passenger" ? RIDER_ICON : PARCEL_ICON}
              size={m.icon}
              strokeWidth={2.75}
              color={HUD_GOLD}
            />
            <span
              style={{
                font: `800 ${m.label + 1}px ${HUD_SANS}`,
                letterSpacing: "2.4px",
                color: HUD_GOLD,
                whiteSpace: "nowrap",
              }}
            >
              {job.eyebrow}
            </span>
            <span
              aria-hidden="true"
              style={{ width: 1, height: compact ? 12 : 18, background: "rgba(255,255,255,.13)" }}
            />
            <span
              style={{
                font: `700 ${m.jobName}px ${HUD_SANS}`,
                color: "rgba(244,239,222,.9)",
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {job.target}
            </span>
            <span
              data-testid="job-pay"
              style={{
                flex: "none",
                background: "rgba(244,200,72,.13)",
                border: `1px solid rgba(244,200,72,.34)`,
                borderRadius: 999,
                padding: m.payPad,
                font: `900 ${m.pay}px ${HUD_SANS}`,
                color: HUD_GOLD,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {job.pay}
            </span>
          </div>
        ) : (
          <div
            data-testid="dispatch-idle"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              marginBottom: m.rowGap,
              font: `700 ${m.jobName}px ${HUD_SANS}`,
              color: "rgba(244,239,222,.5)",
            }}
          >
            {idleLabel}
          </div>
        )}

        {job?.hint && (
          <div
            data-testid="job-hint"
            style={{
              marginTop: -4,
              marginBottom: m.rowGap - 1,
              font: `700 ${m.nextDistance}px ${HUD_SANS}`,
              color: HUD_GOLD,
            }}
          >
            {job.hint}
          </div>
        )}
        {job?.tip && !job.hint && (
          <div
            data-testid="job-tip"
            style={{
              marginTop: -6,
              marginBottom: m.rowGap - 1,
              font: `700 ${m.nextDistance}px ${HUD_SANS}`,
              color: HUD_SAGE,
            }}
          >
            {job.tip}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center" }}>
          {gauges.map((gauge, index) => (
            <div
              key={gauge.id}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 11,
                paddingLeft: index > 0 ? (compact ? 10 : 18) : 0,
                paddingRight: index < gauges.length - 1 ? (compact ? 8 : 14) : 0,
                borderLeft: index > 0 ? "1px solid rgba(255,255,255,.1)" : undefined,
              }}
            >
              <HudGlyph path={gauge.icon} size={m.icon} color="rgba(244,239,222,.5)" />
              <span className="sr-only">{gauge.label}</span>
              <span
                data-testid={gauge.testId}
                style={{
                  minWidth: m.gaugeValueWidth,
                  font: `800 ${m.gaugeValue}px ${HUD_SANS}`,
                  color: "rgba(244,239,222,.74)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {gauge.value}
              </span>
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: m.gaugeBar,
                  borderRadius: 999,
                  background: "rgba(255,255,255,.13)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(Math.min(1, Math.max(0, gauge.fill)) * 100)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: gauge.fillColor,
                    transition: gauge.fillTransition,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {queued && (
        <div
          data-testid="queued-gig"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: compact ? 8 : 13,
            background: "rgba(11,15,17,.68)",
            backdropFilter: "blur(14px)",
            border: "1px solid rgba(143,174,114,.34)",
            borderRadius: compact ? 11 : 18,
            padding: compact ? "7px 10px 7px 17px" : "11px 16px 11px 30px",
            boxShadow: "0 18px 40px -24px rgba(0,0,0,.85)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: m.rail.left,
              top: compact ? 8 : 14,
              bottom: compact ? 8 : 14,
              width: m.rail.width,
              borderRadius: 999,
              background: "rgba(143,174,114,.75)",
            }}
          />
          <span
            style={{
              font: `800 ${m.label}px ${HUD_SANS}`,
              letterSpacing: "2.4px",
              color: HUD_SAGE,
              whiteSpace: "nowrap",
            }}
          >
            NEXT UP
          </span>
          <span
            aria-hidden="true"
            style={{ width: 1, height: compact ? 13 : 22, background: "rgba(255,255,255,.13)" }}
          />
          <span
            style={{
              font: `700 ${m.jobName - 1}px ${HUD_SANS}`,
              color: "rgba(244,239,222,.9)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {queued.title}
          </span>
          <span
            style={{
              font: `900 ${m.pay}px ${HUD_SANS}`,
              color: HUD_GOLD,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {queued.pay}
          </span>
        </div>
      )}
    </div>
  );
}

function manoeuvreKicker(manoeuvre: HudManoeuvre): string {
  if (manoeuvre.kind === "arrive") return manoeuvre.imminent ? "ARRIVING" : "ARRIVE AT";
  if (manoeuvre.imminent) {
    if (manoeuvre.kind === "straight") return "CONTINUE AHEAD";
    if (manoeuvre.kind === "uturn") return "U-TURN NOW";
    return `TURN ${manoeuvre.kind.toUpperCase()} NOW`;
  }
  if (manoeuvre.kind === "straight") return "CONTINUE ONTO";
  if (manoeuvre.kind === "uturn") return "U-TURN ONTO";
  return `HEAD ${manoeuvre.kind.toUpperCase()} ONTO`;
}

// ---------------------------------------------------------------------------
// Top-centre: how fast you are going, against how fast you may — and, in
// career, how long you have left to do it in
// ---------------------------------------------------------------------------

/**
 * The shift clock lives in this row rather than in a cluster of its own for one
 * reason: it and the speed are both 76px numerals, and two numbers that size
 * side by side must share a baseline or the pair reads as broken. Being in one
 * flex row is what gives them that, and it is also why the row is centred as a
 * whole — the divider between them belongs to neither.
 *
 * It used to be an 11px caption at 34% opacity tucked beside the session
 * earnings, where it read as a label for the money rather than as the hard
 * limit the whole career day runs against (#236).
 */

/** Under this many seconds the day turns amber, and under the next, red. */
export const DAY_TIMER_WARN_S = 120;
export const DAY_TIMER_CRITICAL_S = 30;

/**
 * The clock's own sizing, from the two comps. The phone's column is the desktop
 * comp's halved, the same relationship the rest of this row already has (a 92px
 * mobile numeral is drawn on a 2x frame and lands at the desktop 46px).
 *
 * `width` is fixed, and that is load-bearing rather than cosmetic: the row is
 * centred on itself, so anything that changes its width slides the speedometer
 * — and "4:12" → "59" → "9" changes it every second for the last minute of
 * every day. Each is sized to the widest its numerals get, plus slack. **A
 * career day longer than 9:59 would need five characters and both re-measured**
 * — see `DAY_LENGTH_MS`. The label above is wider still at its longest ("DAY 3
 * · SHIFT ENDING"); that is deliberately allowed to overhang, since it is out
 * of flow and costs no layout, and sizing the box to the label would leave a
 * third of it empty and visibly throw the row off centre.
 *
 * `headroom` is what the row drops by once it is carrying a clock. The
 * `DAY n · ON SHIFT` line hangs out of flow above the numerals, so it reaches
 * higher than anything else in the row and lands flush under the edge bar —
 * which draws the day in the same colour, so the two read as one smeared object
 * rather than two readouts. Both comps anchor this row lower than the inset the
 * app gives every other cluster; this is that difference, applied only when
 * there is a label needing the room.
 *
 * `edge` is the bar's height. It is **not** multiplied by `resolveHudScale`
 * like the rest — the bar spans the viewport rather than the comp's frame — so
 * unlike every other number here it is already in real screen pixels.
 */
/**
 * Narrower than this, a phone's top band cannot hold the clock beside the
 * speed, and it goes back to a line in the status card's header instead.
 *
 * The band is spoken for at both ends: the status card on the left, and on the
 * right the app's two corner buttons (`TOUCH_CORNER_RAIL_PX`) followed by the
 * session's camera/pause/fullscreen row. The readout row is centred, so with a
 * clock in it it reaches `viewportWidth / 2 + 117`, and the rail starts at
 * `viewportWidth - SAFE_RIGHT - 104 - 148`.
 *
 * **`SAFE_RIGHT` is what sets this number, not the arithmetic at 12px.** A
 * notched handset in landscape puts ~47px of inset on whichever side the notch
 * lands, and it is a coin toss which way the player rotates — so the rail
 * arrives ~35px further in half the time. At 12px the row would clear from
 * about 784px up; at 47px it does not clear until about 836, which is why this
 * sits above 812 (iPhone X/XS/11 Pro/12 mini/13 mini) rather than below it.
 *
 * The mobile comp does not have this problem: it is a 1740px frame — an ~870px
 * phone once halved — and it never had five things in that corner. Our two app
 * buttons are extra, and fullscreen is not negotiable on iOS.
 *
 * The edge bar is never gated on this. It spans the viewport at any width, and
 * it is the half of the readout that answers "how far through" — so even the
 * narrowest phone keeps the part you cannot help seeing.
 */
export const DAY_TIMER_MIN_VIEWPORT_PX = 840;

export const DAY_TIMER_METRICS = Object.freeze({
  desktop: {
    width: 176,
    headroom: 12,
    edge: 5,
    gap: 10,
    label: 12,
    labelTrack: "2.4px",
    labelGap: 9,
    labelLift: 7,
    icon: 17,
    dot: 3,
    rule: 70,
    ruleMargin: "0 10px 0 18px",
  },
  compact: {
    width: 104,
    headroom: 6,
    edge: 3,
    gap: 6,
    label: 7,
    labelTrack: "1.2px",
    labelGap: 5,
    labelLift: 7,
    icon: 10,
    dot: 2,
    rule: 42,
    ruleMargin: "0 6px 0 10px",
  },
});

/**
 * The widest each of the clock's two formats gets, sizing its numeral slot.
 * `m:ss` is already fixed by tabular figures — a day past 9:59 would want
 * `00:00` here and a wider block — but the bare seconds fall from two digits
 * to one, and that is what the slot is really for.
 */
const WIDEST_DAY_CLOCK = "0:00";
const WIDEST_DAY_SECONDS = "00";

export type DayTimerTone = "calm" | "warn" | "critical";

/** Everything the two day-timer readouts draw, resolved once. */
export interface HudDayTimer {
  readonly day: number;
  /** "4:12" while a minute or more is left, then a bare "38". */
  readonly value: string;
  /**
   * "SEC" once the number has stopped being a clock, and null before that: a
   * `m:ss` reading needs no unit, and the label above it already says what the
   * figure is counting.
   */
  readonly unit: string | null;
  /** ON SHIFT / HURRY / SHIFT ENDING / SHIFT OVER. */
  readonly phrase: string;
  readonly tone: DayTimerTone;
  readonly color: string;
  readonly labelColor: string;
  readonly unitColor: string;
  /** How much of the day is still to run, 0→1: the edge bar's fill. */
  readonly fraction: number;
  /** Read out in place of the numerals, which tick far too fast to announce. */
  readonly announcement: string;
}

const DAY_TIMER_TONES: Readonly<
  Record<DayTimerTone, Pick<HudDayTimer, "color" | "labelColor" | "unitColor">>
> = {
  calm: {
    color: HUD_CREAM,
    labelColor: "rgba(244,239,222,.42)",
    unitColor: "rgba(244,239,222,.6)",
  },
  warn: { color: HUD_GOLD, labelColor: HUD_GOLD, unitColor: "rgba(244,200,72,.72)" },
  critical: { color: HUD_CORAL, labelColor: HUD_CORAL, unitColor: "rgba(232,112,90,.72)" },
};

/**
 * The whole of the timer's behaviour, kept out of the components because it is
 * the part worth asserting: jsdom has no layout and cannot see a colour that
 * was computed inline, but it can read this.
 *
 * Under a minute the readout drops the `m:ss` and counts bare seconds. That is
 * deliberate escalation, not economy — "0:38" is still a clock face to be
 * glanced at, where "38 SEC" is a number that is nearly up.
 */
export function resolveDayTimer(
  day: number,
  remainingMs: number,
  totalMs: number,
): HudDayTimer {
  const left = Math.max(0, Math.ceil(remainingMs / 1000));
  const tone: DayTimerTone =
    left <= DAY_TIMER_CRITICAL_S ? "critical" : left <= DAY_TIMER_WARN_S ? "warn" : "calm";
  const minutes = Math.ceil(left / 60);
  return {
    day,
    value: left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : String(left),
    unit: left >= 60 ? null : "SEC",
    phrase:
      left === 0
        ? "SHIFT OVER"
        : tone === "critical"
          ? "SHIFT ENDING"
          : tone === "warn"
            ? "HURRY"
            : "ON SHIFT",
    tone,
    ...DAY_TIMER_TONES[tone],
    fraction: totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0,
    announcement:
      left === 0
        ? `Day ${day}, shift over.`
        : left < 60
          ? `Day ${day}, under a minute left of the shift.`
          : `Day ${day}, ${minutes} minute${minutes === 1 ? "" : "s"} left of the shift.`,
  };
}

/**
 * The day draining across the top edge of the screen.
 *
 * Full-bleed and therefore the one HUD element `resolveHudScale` does not
 * touch: it is anchored to the viewport's edges, not laid out in the comp's
 * 1920px frame, so scaling it would leave a gap at one end.
 *
 * The comp eases the width over .95s, which assumes a clock that ticks once a
 * second. `publishHud` runs at ~11Hz, so an easing that long would trail the
 * real figure by about a second and never once arrive at it — the bar is set
 * straight to its width instead and is smooth from the update rate alone. The
 * colour keeps its transition: that changes twice a day, not eleven times a
 * second.
 */
export function DriveDayEdge({
  timer,
  compact = false,
}: {
  timer: HudDayTimer;
  compact?: boolean;
}) {
  const m = compact ? DAY_TIMER_METRICS.compact : DAY_TIMER_METRICS.desktop;
  return (
    <div
      data-testid="day-edge"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: m.edge,
        background: "rgba(244,239,222,.08)",
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.hud,
      }}
    >
      <div
        data-testid="day-edge-fill"
        style={{
          height: "100%",
          width: `${(timer.fraction * 100).toFixed(2)}%`,
          background: timer.color,
          boxShadow: `0 0 ${compact ? 10 : 16}px ${timer.color}`,
          animation:
            timer.tone === "critical" && timer.fraction > 0
              ? "hudDayEdgeFlash 1s ease-in-out infinite"
              : undefined,
          transition: "background .4s ease",
        }}
      />
    </div>
  );
}

/**
 * Over the limit by this much reads as amber, and by the second as red —
 * stated per unit rather than as one pair applied to whatever arrives.
 *
 * The margins are the same piece of road either way; only the numbering
 * changes. A flat 6/15 calibrated in mph put Tokyo's amber at 3.7 mph over and
 * its red at 9, so a 30 km/h street alarmed at speeds nobody in New York would
 * look up from — which reads exactly like the readout being in the wrong unit,
 * even though the figure and its label were right all along.
 */
export interface SpeedOverBand {
  readonly warn: number;
  readonly alarm: number;
}

export const SPEED_OVER_BANDS: Readonly<Record<"mph" | "kmh", SpeedOverBand>> = {
  mph: { warn: 6, alarm: 15 },
  kmh: { warn: 10, alarm: 24 },
};

/** The band for a readout's unit. Anything metric takes the km/h pair. */
export function speedOverBand(speedUnit: string): SpeedOverBand {
  return speedUnit.toLowerCase().startsWith("k")
    ? SPEED_OVER_BANDS.kmh
    : SPEED_OVER_BANDS.mph;
}

export function DriveSpeedCluster({
  scale,
  inset,
  speed,
  speedUnit,
  speedLimit,
  gear,
  dayTimer = null,
  compact = false,
}: {
  scale: number;
  inset: { readonly top: string };
  compact?: boolean;
  speed: number;
  speedUnit: string;
  /** Zero until the first lane projection lands, which hides the plate. */
  speedLimit: number;
  gear: string;
  /**
   * The career shift clock, sharing this row so the two 76px numerals sit on
   * one baseline. Null in free drive, where there is no day to run out.
   */
  dayTimer?: HudDayTimer | null;
}) {
  // Mobile halves the comp's 84x106 plate and 92px numeral.
  const m = compact
    ? { plateW: 42, plateH: 53, plateRadius: 5, pad: 3, border: 1.5, cap: 7, num: 21, speed: 46, unit: 13, gap: 11, gear: 10 }
    : { plateW: 70, plateH: 88, plateRadius: 8, pad: 5, border: 2.5, cap: 11, num: 35, speed: 76, unit: 22, gap: 20, gear: 14 };
  const t = compact ? DAY_TIMER_METRICS.compact : DAY_TIMER_METRICS.desktop;
  const over = speedLimit > 0 ? speed - speedLimit : 0;
  const band = speedOverBand(speedUnit);
  const level = over >= band.alarm ? 2 : over >= band.warn ? 1 : 0;
  const speedColor = [HUD_CREAM, HUD_GOLD, HUD_CORAL][level];
  const plateGlow = [
    "0 0 0 0 rgba(0,0,0,0)",
    "0 0 0 3px rgba(244,200,72,.75), 0 0 26px -4px rgba(244,200,72,.5)",
    "0 0 0 3px rgba(232,112,90,.9), 0 0 32px -2px rgba(232,112,90,.75)",
  ][level];
  return (
    <div
      className="drive-speed"
      data-testid="drive-speed"
      aria-hidden="true"
      style={cluster(scale, "top center", {
        top: inset.top,
        left: "50%",
        marginLeft: -0.5,
        marginTop: dayTimer ? t.headroom : undefined,
        display: "flex",
        alignItems: "center",
        gap: m.gap,
        pointerEvents: "none",
        translate: "-50%",
      })}
    >
      {speedLimit > 0 && (
        <div
          data-testid="speed-limit-sign"
          style={{
            position: "relative",
            width: m.plateW,
            height: m.plateH,
            flex: "none",
            borderRadius: m.plateRadius,
            background: "#f7f3e9",
            padding: m.pad,
            boxShadow: `0 8px 22px -8px rgba(0,0,0,.8), ${plateGlow}`,
            animation: level === 2 ? "hudLimitAlarm 1s ease-in-out infinite" : undefined,
            transition: "box-shadow .3s ease",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              border: `${m.border}px solid #14120f`,
              borderRadius: m.plateRadius - 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ font: `800 ${m.cap}px/1.15 ${HUD_SANS}`, letterSpacing: ".4px", color: "#14120f" }}>
              SPEED
            </span>
            <span
              style={{
                font: `800 ${m.cap}px/1.15 ${HUD_SANS}`,
                letterSpacing: ".4px",
                color: "#14120f",
                marginBottom: compact ? 2 : 3,
              }}
            >
              LIMIT
            </span>
            <span
              style={{
                font: `900 ${m.num}px/1 ${HUD_SANS}`,
                color: "#14120f",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-1px",
              }}
            >
              {speedLimit}
            </span>
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: compact ? 6 : 10,
          textShadow: "0 3px 14px rgba(0,0,0,.85)",
        }}
      >
        <HudNumeralSlot
          widest={WIDEST_SPEED}
          testId="speed-value"
          metrics={{
            font: `900 ${m.speed}px/.82 ${HUD_SANS}`,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-2.4px",
          }}
          style={{ color: speedColor, transition: "color .3s ease" }}
        >
          {speed}
        </HudNumeralSlot>
        <span
          style={{
            font: `800 ${m.unit}px ${HUD_SANS}`,
            letterSpacing: "2px",
            color: "rgba(244,239,222,.6)",
            textTransform: "uppercase",
          }}
        >
          {speedUnit}
        </span>
        <em
          style={{
            fontStyle: "normal",
            borderRadius: 6,
            padding: compact ? "3px 6px" : "4px 9px",
            background: "rgba(11,15,17,.55)",
            font: `800 ${m.gear}px ${HUD_SANS}`,
            color: "rgba(244,239,222,.7)",
          }}
        >
          {gear}
        </em>
      </div>
      {dayTimer && (
        <>
          <span
            style={{
              width: 1,
              height: t.rule,
              flex: "none",
              background: "rgba(244,239,222,.17)",
              margin: t.ruleMargin,
            }}
          />
          {/*
            Fixed width — see `DAY_TIMER_METRICS` for why that is load-bearing
            rather than cosmetic. `transformOrigin` is the same kind of thing:
            the beat has to grow away from the divider, not from the block's own
            centre, or the pulse reads as the whole top of the screen breathing.
          */}
          <div
            data-testid="day-clock"
            style={{
              position: "relative",
              width: t.width,
              flex: "none",
              transformOrigin: "left center",
              display: "flex",
              alignItems: "baseline",
              gap: t.gap,
              textShadow: "0 3px 14px rgba(0,0,0,.85)",
              animation:
                dayTimer.tone === "critical" && dayTimer.fraction > 0
                  ? "hudTimerBeat 1s ease-in-out infinite"
                  : undefined,
            }}
          >
            {/*
              Out of flow, so the numerals keep the speed's baseline; the row's
              `align-items: center` would otherwise push them down by the
              label's height.
            */}
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                // Desktop hangs the label off the left, over its own numerals.
                // The phone anchors it right instead, so the few pixels it
                // outgrows the block by spill left into the gap beside the
                // speed rather than right at the touch rail.
                ...(compact ? { right: 0 } : { left: 0 }),
                marginBottom: t.labelLift,
                display: "flex",
                alignItems: "center",
                gap: t.labelGap,
                whiteSpace: "nowrap",
              }}
            >
              <HudGlyph path={STOPWATCH_ICON} size={t.icon} strokeWidth={2.75} color={dayTimer.labelColor} />
              {/*
                The day number is desktop-only. This label is the widest thing
                in the block and it overhangs to the right, straight at the
                touch rail — and on a notched handset in landscape that rail
                comes ~35px further in than the arithmetic in
                `DAY_TIMER_MIN_VIEWPORT_PX` assumes. Which day it is survives
                elsewhere on a phone: the title card opens every day with it and
                the ledger closes with it. How long is left does not.
              */}
              {!compact && (
                <>
                  <span
                    style={{
                      font: `800 ${t.label}px ${HUD_SANS}`,
                      letterSpacing: t.labelTrack,
                      color: "rgba(244,239,222,.42)",
                    }}
                  >
                    DAY {dayTimer.day}
                  </span>
                  <span
                    style={{ width: t.dot, height: t.dot, borderRadius: "50%", background: "rgba(244,239,222,.3)" }}
                  />
                </>
              )}
              <span
                data-testid="day-phrase"
                style={{
                  font: `800 ${t.label}px ${HUD_SANS}`,
                  letterSpacing: t.labelTrack,
                  color: dayTimer.labelColor,
                  transition: "color .4s ease",
                }}
              >
                {dayTimer.phrase}
              </span>
            </div>
            {/*
              The same slot as the speed, for the same reason one rung down:
              inside the block the seconds fall 22 → 9 in the last ten of every
              day, and without it "SEC" walks left a digit's width as they do.
              In `m:ss` the sizer is exactly the value, so it costs nothing.
            */}
            <HudNumeralSlot
              widest={dayTimer.unit ? WIDEST_DAY_SECONDS : WIDEST_DAY_CLOCK}
              testId="day-clock-value"
              align="left"
              metrics={{
                font: `900 ${m.speed}px/.82 ${HUD_SANS}`,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-2.4px",
              }}
              style={{ color: dayTimer.color, transition: "color .4s ease" }}
            >
              {dayTimer.value}
            </HudNumeralSlot>
            {dayTimer.unit && (
              <span
                data-testid="day-clock-unit"
                style={{
                  font: `800 ${m.unit}px ${HUD_SANS}`,
                  letterSpacing: "2px",
                  color: dayTimer.unitColor,
                  transition: "color .4s ease",
                }}
              >
                {dayTimer.unit}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-right: the money, and the three things you can press
// ---------------------------------------------------------------------------

export function DriveMoneyCluster({
  scale,
  inset,
  balance,
  balanceLabel,
  session,
  sessionLabel,
  sessionVisible,
  gain,
  buttons,
  compact = false,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  compact?: boolean;
  balance: string;
  balanceLabel: string;
  session: string;
  sessionLabel: string;
  /**
   * False while today's total is exactly zero. The row stays mounted at its
   * usual size — only `visibility` toggles — so the balance above it never
   * jumps down to fill the gap the instant a shift starts, then back up the
   * moment it ends in an even wash (#267).
   */
  sessionVisible: boolean;
  /** The `+$x.xx` that floats up on a payout, cleared once it has run. */
  gain: string | null;
  buttons: readonly {
    readonly id: "music" | "camera" | "map" | "pause";
    readonly label: string;
    readonly pressed?: boolean;
    readonly onPress: () => void;
  }[];
}) {
  const icon = {
    music: MUSIC_ICON,
    camera: CAMERA_ICON,
    map: MAP_ICON,
    pause: PAUSE_ICON,
  };
  const m = compact
    ? { balance: 26, wallet: 15, session: 9, label: 7, gain: 13, button: 39, glyph: 16, gap: 7 }
    : { balance: 47, wallet: 28, session: 16, label: 11, gain: 23, button: 46, glyph: 21, gap: 10 };
  return (
    <div
      style={cluster(scale, "top right", {
        top: inset.top,
        right: inset.right,
        display: "flex",
        flexDirection: compact ? "row-reverse" : "column",
        alignItems: compact ? "center" : "flex-end",
        gap: compact ? 11 : 10,
        zIndex: DRIVE_LAYER.action,
      })}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: compact ? 3 : 10,
        }}
      >
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", gap: compact ? 8 : 14 }}
      >
        <div
          aria-hidden="true"
          data-testid="money-gain"
          style={{
            position: "absolute",
            right: 2,
            top: compact ? -18 : -28,
            font: `900 ${m.gain}px ${HUD_SANS}`,
            color: HUD_GOLD,
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 2px 12px rgba(0,0,0,.9)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            opacity: gain ? 1 : 0,
            transform: gain ? "translateY(0)" : "translateY(-20px)",
            transition: gain ? "none" : "opacity .85s ease, transform .95s cubic-bezier(.2,.7,.3,1)",
          }}
        >
          {gain}
        </div>
        <HudGlyph path={WALLET_ICON} size={m.wallet} strokeWidth={2.3} color="rgba(244,239,222,.4)" />
        <span className="sr-only">{balanceLabel}</span>
        <span
          data-testid="day-cash"
          style={{
            font: `900 ${m.balance}px/.9 ${HUD_SANS}`,
            color: HUD_CREAM,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-2px",
            textShadow: "0 3px 16px rgba(0,0,0,.88)",
          }}
        >
          {balance}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          // Hidden, not unmounted: an even shift has nothing worth reporting,
          // but the row still has to hold its line so the balance above it
          // doesn't drop down to meet the buttons the moment there's nothing
          // to show (#267).
          visibility: sessionVisible ? "visible" : "hidden",
        }}
      >
        <span
          style={{
            font: `900 ${m.session}px ${HUD_SANS}`,
            color: HUD_GOLD,
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 2px 10px rgba(0,0,0,.85)",
          }}
        >
          {session}
        </span>
        {/*
          Just what the figure beside it means. The shift clock used to be
          crammed in here too, at 11px and 34% opacity beside a 47px balance,
          which is how it came to be invisible (#236); it is a top-centre
          readout now — see `resolveDayTimer`.
        */}
        <span
          data-testid="session-label"
          style={{
            font: `800 ${m.label}px ${HUD_SANS}`,
            letterSpacing: "2px",
            color: "rgba(244,239,222,.34)",
            whiteSpace: "nowrap",
          }}
        >
          {sessionLabel}
        </span>
      </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: m.gap, marginTop: compact ? 0 : 6 }}>
        {buttons.map((button) => {
          const muted = button.id === "music" && button.pressed;
          return (
            <button
              key={button.id}
              type="button"
              onClick={button.onPress}
              aria-label={button.label}
              aria-pressed={button.pressed}
              title={button.label}
              style={{
                width: m.button,
                height: m.button,
                borderRadius: "50%",
                background: "rgba(11,15,17,.6)",
                backdropFilter: "blur(14px)",
                border: "1px solid rgba(255,255,255,.1)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                opacity: 0.78,
                padding: 0,
              }}
            >
              <HudGlyph
                path={muted ? MUSIC_MUTED_ICON : icon[button.id]}
                size={m.glyph}
                strokeWidth={2.75}
                color={muted ? MUSIC_DIM_COLOR : HUD_CREAM}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surge
// ---------------------------------------------------------------------------

export function DriveSurgeBanner({
  scale,
  inset,
  multiplier,
  remaining,
}: {
  scale: number;
  inset: { readonly top: string };
  multiplier: number;
  remaining: string;
}) {
  return (
    <div
      data-testid="surge-banner"
      style={cluster(scale, "top center", {
        top: inset.top,
        left: "50%",
        translate: "-50%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 20px",
        borderRadius: 999,
        background: "rgba(244,200,72,.14)",
        border: `1.5px solid rgba(244,200,72,.5)`,
        backdropFilter: "blur(12px)",
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.toast,
      })}
    >
      <span
        style={{
          font: `900 15px ${HUD_SANS}`,
          letterSpacing: "2.4px",
          color: HUD_GOLD,
        }}
      >
        SURGE ×{multiplier}
      </span>
      <span aria-hidden="true" style={{ width: 1, height: 16, background: "rgba(244,200,72,.4)" }} />
      <span
        style={{
          font: `800 14px ${HUD_SANS}`,
          color: "rgba(244,239,222,.72)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {remaining}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts and wrappers the app still owns the content of
// ---------------------------------------------------------------------------

export function DriveToast({
  scale,
  inset,
  tone,
  children,
  testId,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  tone: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={cluster(scale, inset.right === "auto" ? "top left" : "top right", {
        top: inset.top,
        right: inset.right,
        left: inset.right === "auto" ? "0.75rem" : undefined,
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: inset.right === "auto" ? 44 : 74,
        padding: inset.right === "auto" ? "0 16px" : "0 30px",
        borderRadius: inset.right === "auto" ? 14 : 22,
        background: "rgba(11,15,17,.86)",
        backdropFilter: "blur(16px)",
        border: `1.5px solid ${tone}`,
        boxShadow: "0 26px 60px -24px rgba(0,0,0,.9)",
        font: `900 ${inset.right === "auto" ? 13 : 22}px ${HUD_SANS}`,
        letterSpacing: "2.4px",
        color: tone,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.toast,
      })}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

export interface HudOffer {
  readonly kind: "delivery" | "passenger";
  readonly pay: string;
  /** The tip a food customer already named, or the surge on a fare. */
  readonly bonus: string | null;
  readonly title: string;
  readonly sub: string;
  readonly chips: readonly string[];
  /**
   * How far off-route the pickup is, e.g. "0.4 mi" — or null when there is no
   * route to leave. The phone comp draws this as a rail rather than listing it,
   * and the desktop card carries the same figure in its first chip.
   *
   * Named rather than read out of `chips` because that array is positional and
   * its first entry is only the detour *when there is one*; the rail was
   * labelling a run distance as a detour on every offer taken while idle.
   */
  readonly detour: string | null;
  /** The load — "3 items", "2 riders". What the phone hangs off the dropoff. */
  readonly meta: string;
  readonly footnote: string;
  readonly secondsLeft: number;
  /** 0→1 of the window burnt; drives the fuse and its colour. */
  readonly elapsed: number;
  readonly surged: boolean;
}

/**
 * The card's frame, straight off `Curbside Driving HUD Desktop`. Every figure in
 * `DriveOfferCard` below is that comp's, unscaled: the comp is drawn on the same
 * 1920-wide frame `HUD_DESIGN_WIDTH` names, so a number here can be read off the
 * comp without arithmetic.
 *
 * It used to be 430x384 — a third more area — which on a laptop floored at
 * `HUD_MIN_SCALE` covered a quarter of the windscreen and left the minimap
 * roughly six pixels of clearance beneath it. The card is a thing you glance at
 * while driving; it does not need to be the biggest object on screen.
 */
const OFFER_W = 344;
const OFFER_H = 274;

/**
 * How far below the HUD's top inset the card hangs, in comp pixels.
 *
 * The comp puts its top edge at 282 on a frame inset 38, so 244 is the gap it
 * actually draws under the wallet cluster. Scaled rather than fixed because the
 * cluster above it scales too — pinning it would close that gap on a small
 * window and open it on a large one, and the minimap is directly below.
 */
export const OFFER_TOP_OFFSET_PX = 244;

/**
 * How long the fuse takes to reach a new position.
 *
 * `elapsed` arrives on the HUD snapshot, which publishes about ten times a
 * second — so the raw value steps in jumps of roughly a fifteenth of the
 * border, which reads as a stutter crawling round the card. Handing the browser
 * a transition longer than the gap between samples lets it interpolate: each
 * new target arrives partway through the last move, so the stroke never stops.
 *
 * Long enough to ride out a dropped sample (the publish interval is floored at
 * 100ms but lands on a frame boundary, so it stretches under load), short
 * enough that the constant lag it introduces — well under a percent of the
 * offer window — is invisible. The same trick the fuel gauge uses for the pump.
 */
export const FUSE_SMOOTHING_MS = 200;

/**
 * The offer card. Interactive, so it takes `DRIVE_LAYER.offer` rather than the
 * read-only HUD layer — the nav card is `pointerEvents: "none"` and an accept
 * button could never have lived inside it.
 *
 * The border is a fuse: one SVG stroke with `pathLength` normalised to 1000, so
 * the dash offset *is* the fraction burnt regardless of the card's real
 * perimeter. It reads at a glance from the corner of the eye, which a numeral
 * counting down does not.
 */
export function DriveOfferCard({
  scale,
  inset,
  offer,
  acceptKey,
  passKey,
  onAccept,
  onPass,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  offer: HudOffer;
  acceptKey: string;
  passKey: string;
  onAccept: () => void;
  onPass: () => void;
}) {
  const food = offer.kind === "delivery";
  const fuseHot = offer.elapsed > 0.72;
  return (
    <div
      data-testid="gig-offer"
      style={cluster(scale, "top right", {
        top: inset.top,
        right: inset.right,
        zIndex: DRIVE_LAYER.offer,
      })}
    >
      <div
        style={{
          position: "relative",
          width: OFFER_W,
          height: OFFER_H,
          borderRadius: 24,
          background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
          padding: "15px 17px 14px",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 28px 62px -24px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset, 0 0 38px -8px rgba(250,243,228,.22)",
        }}
      >
        <svg
          viewBox={`0 0 ${OFFER_W} ${OFFER_H}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          <rect
            x="1.75"
            y="1.75"
            width={OFFER_W - 3.5}
            height={OFFER_H - 3.5}
            rx="22.5"
            fill="none"
            stroke="rgba(32,30,29,.1)"
            strokeWidth="3.5"
          />
          <rect
            x="1.75"
            y="1.75"
            width={OFFER_W - 3.5}
            height={OFFER_H - 3.5}
            rx="22.5"
            fill="none"
            stroke={fuseHot ? "#d9614c" : HUD_INK}
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={1000}
            style={{
              strokeDashoffset: Math.min(1, Math.max(0, offer.elapsed)) * 1000,
              transition: `stroke-dashoffset ${FUSE_SMOOTHING_MS}ms linear, stroke .25s ease`,
            }}
          />
        </svg>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 9,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
              borderRadius: 999,
              padding: "4px 11px 4px 9px",
            }}
          >
            <HudGlyph
              path={food ? FOOD_ICON : RIDER_ICON}
              size={14}
              strokeWidth={2.75}
              color={food ? "#a8541f" : "#4e6236"}
            />
            <span
              style={{
                font: `800 11px ${HUD_SANS}`,
                letterSpacing: "1.7px",
                color: food ? "#a8541f" : "#4e6236",
                whiteSpace: "nowrap",
              }}
            >
              {food ? "FOOD DELIVERY" : "RIDESHARE"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              data-testid="offer-countdown"
              style={{
                font: `900 17px ${HUD_SANS}`,
                color: "rgba(32,30,29,.45)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {offer.secondsLeft}
            </span>
            <span
              style={{
                font: `800 10px ${HUD_SANS}`,
                letterSpacing: "1.4px",
                color: "rgba(32,30,29,.35)",
              }}
            >
              S
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 4 }}>
          <span
            data-testid="offer-pay"
            style={{
              font: `900 40px/.9 ${HUD_SANS}`,
              color: HUD_INK,
              letterSpacing: "-1.6px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {offer.pay}
          </span>
          {offer.bonus && (
            <span
              data-testid="offer-bonus"
              style={{
                background: offer.surged ? "rgba(168,84,31,.14)" : "rgba(32,30,29,.08)",
                borderRadius: 999,
                padding: "3px 10px",
                font: `800 12.5px ${HUD_SANS}`,
                color: offer.surged ? "#a8541f" : "rgba(32,30,29,.6)",
                whiteSpace: "nowrap",
              }}
            >
              {offer.bonus}
            </span>
          )}
        </div>

        <div
          style={{
            font: `700 24px/1.05 ${HUD_SERIF}`,
            color: HUD_INK,
            marginBottom: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.title}
        </div>
        <div
          style={{
            font: `600 13px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            marginBottom: 11,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.sub}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: "auto", flexWrap: "wrap" }}>
          {offer.chips.map((chip) => (
            <span
              key={chip}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                border: "1.5px solid rgba(32,30,29,.16)",
                borderRadius: 999,
                padding: "4px 10px",
                font: `700 11.5px ${HUD_SANS}`,
                color: "rgba(32,30,29,.7)",
                whiteSpace: "nowrap",
              }}
            >
              {chip}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 7 }}>
          <button
            type="button"
            data-testid="offer-pass"
            onClick={onPass}
            aria-label={`Pass on this job (${passKey})`}
            style={{
              width: 100,
              height: 50,
              borderRadius: 15,
              background: "rgba(32,30,29,.06)",
              border: "1.5px solid rgba(217,97,76,.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              cursor: "pointer",
            }}
          >
            <span style={{ font: `900 14px ${HUD_SANS}`, letterSpacing: "1px", color: "#b04a34" }}>
              PASS
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 19,
                height: 19,
                borderRadius: 5,
                background: "rgba(32,30,29,.12)",
                font: `900 11px ${HUD_SANS}`,
                color: "rgba(32,30,29,.6)",
              }}
            >
              {passKey}
            </span>
          </button>
          <button
            type="button"
            data-testid="offer-accept"
            onClick={onAccept}
            aria-label={`Accept this job (${acceptKey})`}
            style={{
              flex: 1,
              height: 50,
              borderRadius: 15,
              background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: "pointer",
              boxShadow:
                "0 10px 22px -12px rgba(125,158,99,.9), inset 0 2px 0 rgba(255,255,255,.34)",
            }}
          >
            <span style={{ font: `900 19px ${HUD_SANS}`, letterSpacing: "1px", color: "#16210f" }}>
              ACCEPT
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 23,
                height: 23,
                borderRadius: 6,
                background: "rgba(22,33,15,.22)",
                font: `900 13px ${HUD_SANS}`,
                color: "#16210f",
              }}
            >
              {acceptKey}
            </span>
          </button>
        </div>
        <div
          style={{
            textAlign: "center",
            font: `600 11px ${HUD_SANS}`,
            color: "rgba(32,30,29,.42)",
          }}
        >
          {offer.footnote}
        </div>
      </div>
    </div>
  );
}

/**
 * The wash down the right edge while an offer is live. Peripheral rather than
 * legible: it says *something is waiting* to a driver whose eyes are on the
 * road, which the card alone cannot.
 */
export function DriveOfferGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.scrim,
        animation: "hudEdgeGlow 1.5s ease-in-out infinite",
        background:
          "linear-gradient(270deg,rgba(250,243,228,.20),rgba(250,243,228,0) 78%)",
      }}
    />
  );
}

/**
 * The offer on a phone, from `Curbside Driving HUD Mobile`.
 *
 * It lives in the minimap's slot and the map fades out beneath it — the comp's
 * own answer to a card this size on a screen this small, and a better one than
 * shrinking it: while you are deciding, the decision is the only thing that
 * matters.
 *
 * The detour is drawn rather than listed. A rail from YOU to BACK ON ROUTE with
 * the pickup pinned partway along says "this is a small dogleg" or "this is
 * miles out of your way" at a glance, which a figure in a chip does not.
 *
 * **`slotHeight` is the hard constraint, not the comp.** The comp is drawn on
 * an 800px frame — 400 CSS pixels — but the shortest landscape phone the rail
 * budget admits is 320, and Safari showing its toolbars leaves ~343. Below
 * `RAIL_MIN_SLOT_PX` the rail is dropped rather than letting the card grow down
 * into the pedals; the distance it carried is on the sub-line either way.
 *
 * **The width is not the comp's either — it is the pedal row's.** The comp
 * draws the card exactly as wide as BRAKE+DRIVE beneath it, which is the whole
 * reason the two read as one column; so `DriveOfferBar` takes a width from
 * whoever knows the pedals (`TOUCH_PEDAL_ROW_PX`) rather than carrying a copy
 * of the comp's 212 that would drift the moment a pedal is resized.
 */
export const MOBILE_OFFER_H = 153;
/** Under this the card cannot hold its own content, whatever the slot says. */
export const MOBILE_OFFER_MIN_H = 120;
/**
 * The dense card's height — the comp with everything the map already tells you
 * taken out. See `dense` on `DriveOfferPanel`.
 *
 * 116 against the comp's 153: 17.5 of padding, the header over 4, the 21 px
 * pay, a 9 px meta line and the 31 px buttons — the pickup name, the dropoff
 * and the whole detour rail gone. The slack is what `marginBottom: "auto"`
 * spends holding the buttons on the floor.
 */
export const MOBILE_OFFER_DENSE_H = 116;
/**
 * Card height under which the detour rail is dropped to keep the card clear.
 *
 * The comp's stack with the rail in it adds up to ~139 — padding 17.5, header
 * 17, pay 20, pickup 14, sub 9, rail 30, buttons 31 — so 140 is the point below
 * which the rail is what has to give rather than the type. It has to stay under
 * `MOBILE_OFFER_H` or the rail the comp draws would never render at all.
 */
export const RAIL_MIN_SLOT_PX = 140;
/**
 * Below this width PASS gives up pixels so ACCEPT can still spell its word.
 * Out on the road the card is the pedal row (180), which keeps the comp's PASS;
 * docked in the map's legend column on a small landscape phone it is ~173, and
 * that is what this catches.
 */
const NARROW_OFFER_PX = 176;

/** Clamps a slot — a phone's rail budget, or the map's column — to the comp. */
export function resolveOfferPanelHeight(slotPx: number) {
  return Math.min(MOBILE_OFFER_H, Math.max(MOBILE_OFFER_MIN_H, slotPx));
}

export function DriveOfferBar({
  inset,
  offer,
  width,
  slotHeight,
  onAccept,
  onPass,
}: {
  inset: { readonly top: string; readonly right: string };
  offer: HudOffer;
  /** The pedal row below it, so the two share both edges — see the note above. */
  width: number;
  /** Height between the button rail and the pedals — see the note above. */
  slotHeight: number;
  onAccept: () => void;
  onPass: () => void;
}) {
  return (
    <div
      data-testid="gig-offer"
      style={{
        position: "absolute",
        top: inset.top,
        right: inset.right,
        zIndex: DRIVE_LAYER.offer,
      }}
    >
      <DriveOfferPanel
        offer={offer}
        width={width}
        height={resolveOfferPanelHeight(slotHeight)}
        onAccept={onAccept}
        onPass={onPass}
      />
    </div>
  );
}

/**
 * The card itself, with no opinion about where on the screen it sits.
 *
 * Split out because it has two homes: floating in the minimap's slot while
 * driving (`DriveOfferBar`), and docked into `ExpandedMap`'s legend column
 * whenever the map is open (#241) — where a card floating over a centred panel
 * read as two windows colliding, and how much it clipped the legend depended on
 * the city's aspect ratio. `width` and `height` come from whichever slot it
 * landed in; everything between them is fluid.
 *
 * **`dense` is not a small version of the card, it is a shorter one.** The type
 * sizes do not move — the pay is still the hero — but the pickup's name, the
 * dropoff and the detour rail come out, because docked on a phone the card is
 * standing on a map that is *already* drawing the dashed line to that pickup.
 * Nothing is lost there that is not on screen a few centimetres to the left,
 * and the alternative was a card that shrank its own text into itself.
 */
export function DriveOfferPanel({
  offer,
  width,
  height,
  dense = false,
  onAccept,
  onPass,
  testId,
}: {
  offer: HudOffer;
  width: number;
  height: number;
  /** Drop what the map beside it already says — see the note above. */
  dense?: boolean;
  onAccept: () => void;
  onPass: () => void;
  /** Set by whichever placement is the one on screen — never both at once. */
  testId?: string;
}) {
  const food = offer.kind === "delivery";
  const showRail = !dense && offer.detour !== null && height >= RAIL_MIN_SLOT_PX;
  const fuseHot = offer.elapsed > 0.72;
  const passPx = width < NARROW_OFFER_PX ? 48 : 57;
  return (
    <div
      data-testid={testId}
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 13.5,
        background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
        padding: "9px 10.5px 8.5px",
        display: "flex",
        flexDirection: "column",
        boxShadow:
          "0 14px 31px -12px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset, 0 0 19px -4px rgba(250,243,228,.22)",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx="12.5"
          fill="none"
          stroke="rgba(32,30,29,.1)"
          strokeWidth="2"
        />
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx="12.5"
          fill="none"
          stroke={fuseHot ? "#d9614c" : HUD_INK}
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1000}
          strokeDasharray={1000}
          style={{
            strokeDashoffset: Math.min(1, Math.max(0, offer.elapsed)) * 1000,
            transition: `stroke-dashoffset ${FUSE_SMOOTHING_MS}ms linear, stroke .25s ease`,
          }}
        />
      </svg>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 5,
          marginBottom: 4.5,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3.5,
            background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
            borderRadius: 999,
            padding: "2.5px 6px 2.5px 5px",
          }}
        >
          <HudGlyph
            path={food ? FOOD_ICON : RIDER_ICON}
            size={7.5}
            strokeWidth={2.75}
            color={food ? "#a8541f" : "#4e6236"}
          />
          <span
            style={{
              font: `800 6px ${HUD_SANS}`,
              letterSpacing: "0.9px",
              color: food ? "#a8541f" : "#4e6236",
              whiteSpace: "nowrap",
            }}
          >
            {food ? "FOOD DELIVERY" : "RIDESHARE"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2.5 }}>
          <span
            data-testid="offer-countdown"
            style={{
              font: `900 9.5px ${HUD_SANS}`,
              color: "rgba(32,30,29,.45)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {offer.secondsLeft}
          </span>
          <span
            style={{
              font: `800 5.5px ${HUD_SANS}`,
              letterSpacing: "0.7px",
              color: "rgba(32,30,29,.35)",
            }}
          >
            S
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span
          data-testid="offer-pay"
          style={{
            font: `900 21px/.9 ${HUD_SANS}`,
            color: HUD_INK,
            letterSpacing: "-0.85px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {offer.pay}
        </span>
        {/*
          Dense moves this to the meta line. The comp's chip does not fit beside
          the pay in the map's narrowest column: it has nothing to give and
          simply hangs off the right edge.
        */}
        {offer.bonus && !dense && (
          <span
            data-testid="offer-bonus"
            style={{
              background: offer.surged ? "rgba(168,84,31,.14)" : "rgba(32,30,29,.08)",
              borderRadius: 999,
              padding: "2px 5.5px",
              font: `800 6.5px ${HUD_SANS}`,
              color: offer.surged ? "#a8541f" : "rgba(32,30,29,.6)",
              whiteSpace: "nowrap",
            }}
          >
            {offer.bonus}
          </span>
        )}
      </div>

      {dense && (
        <div
          data-testid="offer-meta"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 3,
            marginBottom: "auto",
            font: `800 9px ${HUD_SANS}`,
            color: "#a8541f",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {offer.detour ?? offer.meta}
          </span>
          {offer.bonus && (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: "50%",
                  background: "rgba(32,30,29,.25)",
                  flex: "none",
                }}
              />
              <span
                data-testid="offer-bonus"
                style={{
                  flex: "none",
                  font: `700 7.5px ${HUD_SANS}`,
                  color: offer.surged ? "#a8541f" : "rgba(32,30,29,.55)",
                }}
              >
                {offer.bonus}
              </span>
            </>
          )}
        </div>
      )}

      {!dense && (
        <>
        <div
          style={{
            font: `700 13px/1.04 ${HUD_SERIF}`,
            color: HUD_INK,
            marginTop: 1.5,
            marginBottom: 0.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginBottom: "auto",
            font: `600 7px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{offer.sub}</span>
          {/*
            The comp hangs the load — "3 items", "2 riders" — off the dropoff
            here, and gives the detour to the rail below. They used to be the
            same figure in both places, which spent a line saying nothing.

            **When the rail is dropped the detour takes this slot back.** A
            short phone loses the drawing, not the number: it is the one figure
            on the card that decides whether the job is worth taking, and there
            is nowhere else on that screen for it to go.
          */}
          {(showRail ? offer.meta : (offer.detour ?? offer.meta)) && (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: "50%",
                  background: "rgba(32,30,29,.25)",
                  flex: "none",
                }}
              />
              <span
                style={{ flex: "none", font: `700 6.5px ${HUD_SANS}`, color: "rgba(32,30,29,.45)" }}
              >
                {showRail ? offer.meta : (offer.detour ?? offer.meta)}
              </span>
            </>
          )}
        </div>
        </>
      )}

      {showRail && (
        <div data-testid="detour-rail" style={{ margin: "5px 0 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3.5, marginBottom: 3 }}>
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: "50%", background: HUD_INK, flex: "none" }}
            />
            <span
              aria-hidden="true"
              style={{ width: 13, height: 1.75, borderRadius: 1, background: "rgba(32,30,29,.3)" }}
            />
            <span
              aria-hidden="true"
              style={{
                flex: 1,
                height: 1.75,
                borderRadius: 1,
                background:
                  "repeating-linear-gradient(90deg,rgba(168,84,31,.85) 0 5px,transparent 5px 10px)",
                backgroundSize: "15px 2px",
                animation: "hudDetourRail .8s linear infinite",
              }}
            />
            <svg width="8" height="8" viewBox="0 0 24 24" fill="#a8541f" style={{ flex: "none" }} aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z" />
            </svg>
            <span
              aria-hidden="true"
              style={{ flex: 1, height: 1.75, borderRadius: 1, background: "rgba(32,30,29,.18)" }}
            />
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: 1.5, background: "rgba(32,30,29,.35)", flex: "none" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ font: `800 5.25px ${HUD_SANS}`, letterSpacing: "0.75px", color: "rgba(32,30,29,.38)" }}>
              YOU
            </span>
            <span
              data-testid="detour-label"
              style={{
                margin: "0 auto",
                font: `900 6.5px ${HUD_SANS}`,
                color: "#a8541f",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {offer.detour}
            </span>
            <span style={{ font: `800 5.25px ${HUD_SANS}`, letterSpacing: "0.75px", color: "rgba(32,30,29,.38)" }}>
              BACK ON ROUTE
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 5, marginTop: showRail ? 0 : 5 }}>
        <button
          type="button"
          data-testid="offer-pass"
          onClick={onPass}
          aria-label="Pass on this job"
          style={{
            width: passPx,
            flex: "none",
            height: 31,
            borderRadius: 9,
            background: "rgba(32,30,29,.06)",
            border: "1.5px solid rgba(217,97,76,.35)",
            font: `900 8.5px ${HUD_SANS}`,
            letterSpacing: "1px",
            color: "#b04a34",
            cursor: "pointer",
          }}
        >
          PASS
        </button>
        <button
          type="button"
          data-testid="offer-accept"
          onClick={onAccept}
          aria-label="Accept this job"
          style={{
            flex: 1,
            height: 31,
            borderRadius: 9,
            background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
            border: "none",
            font: `900 11.5px ${HUD_SANS}`,
            letterSpacing: "1px",
            color: "#16210f",
            cursor: "pointer",
            boxShadow:
              "0 6px 13px -6px rgba(125,158,99,.9), inset 0 1px 0 rgba(255,255,255,.34)",
          }}
        >
          ACCEPT
        </button>
      </div>
    </div>
  );
}

/**
 * A round button the app owns on a phone.
 *
 * `TouchDriveControls` starts its own row clear of these — camera, pause and
 * fullscreen are the session's, music and the city map are the app's, and the
 * two sets must not stack on top of each other. `TOUCH_CORNER_RAIL_PX` is the
 * width they agree on; a third app button means widening it.
 *
 * `slot` counts leftward from the corner, so slot 0 is the corner itself.
 */
export function DriveCornerButton({
  inset,
  slot = 0,
  icon,
  activeIcon,
  label,
  pressed,
  onPress,
  testId,
}: {
  inset: { readonly top: string; readonly right: string };
  slot?: number;
  icon: readonly string[];
  /** Swapped in while `pressed`, and dimmed — the muted note's treatment. */
  activeIcon?: readonly string[];
  label: string;
  pressed?: boolean;
  onPress: () => void;
  testId?: string;
}) {
  const dimmed = Boolean(pressed && activeIcon);
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      data-testid={testId}
      style={{
        position: "absolute",
        top: inset.top,
        right: `calc(${inset.right} + ${slot * TOUCH_CORNER_SLOT_PX}px)`,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "rgba(11,15,17,.6)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,.1)",
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: "pointer",
        zIndex: DRIVE_LAYER.action,
      }}
    >
      <HudGlyph
        path={dimmed ? activeIcon! : icon}
        size={19}
        strokeWidth={2.75}
        color={dimmed ? MUSIC_DIM_COLOR : HUD_CREAM}
      />
    </button>
  );
}
