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

export const FUEL_PUMP_ICON = [
  "M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18",
  "M2 22h13",
  "M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3",
  "M6 8h4",
];
export const CAR_ICON = [
  "M3 13l1.6-4.7A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.3L21 13",
  "M3 13h18v4a1 1 0 0 1-1 1h-1.6",
  "M5.6 18H4a1 1 0 0 1-1-1v-4",
  "M7.6 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
  "M16.4 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
];
export const CLOCK_ICON = ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3.5 2"];
export const PARCEL_ICON = [
  "m7.5 4.27 9 5.15",
  "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
  "m3.3 7 8.7 5 8.7-5",
  "M12 22V12",
];
export const RIDER_ICON = ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4 21a8 8 0 0 1 16 0"];
const WALLET_ICON = [
  "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5",
  "M17 13h.01",
];
const MUSIC_ICON = ["M9 18V5l12-2v13", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6"];
const CAMERA_ICON = [
  "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z",
  "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
];
const PAUSE_ICON = ["M7 4h2v16H7z", "M15 4h2v16h-2z"];

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
  money?: { readonly balance: string; readonly session: string; readonly label: string } | null;
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
              }}
            >
              {money.session}
            </span>
            <span
              data-testid="day-clock"
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
// Top-centre: how fast you are going, against how fast you may
// ---------------------------------------------------------------------------

/** Over the limit by this much reads as amber, and by the second as red. */
export const SPEED_WARN_OVER = 6;
export const SPEED_ALARM_OVER = 15;

export function DriveSpeedCluster({
  scale,
  inset,
  speed,
  speedUnit,
  speedLimit,
  gear,
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
}) {
  // Mobile halves the comp's 84x106 plate and 92px numeral.
  const m = compact
    ? { plateW: 42, plateH: 53, plateRadius: 5, pad: 3, border: 1.5, cap: 7, num: 21, speed: 46, unit: 13, gap: 11, gear: 10 }
    : { plateW: 70, plateH: 88, plateRadius: 8, pad: 5, border: 2.5, cap: 11, num: 35, speed: 76, unit: 22, gap: 20, gear: 14 };
  const over = speedLimit > 0 ? speed - speedLimit : 0;
  const level = over >= SPEED_ALARM_OVER ? 2 : over >= SPEED_WARN_OVER ? 1 : 0;
  const speedColor = [HUD_CREAM, HUD_GOLD, HUD_CORAL][level];
  const plateGlow = [
    "0 0 0 0 rgba(0,0,0,0)",
    "0 0 0 3px rgba(244,200,72,.75), 0 0 26px -4px rgba(244,200,72,.5)",
    "0 0 0 3px rgba(232,112,90,.9), 0 0 32px -2px rgba(232,112,90,.75)",
  ][level];
  return (
    <div
      className="drive-speed"
      aria-hidden="true"
      style={cluster(scale, "top center", {
        top: inset.top,
        left: "50%",
        marginLeft: -0.5,
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
        <strong
          data-testid="speed-value"
          style={{
            font: `900 ${m.speed}px/.82 ${HUD_SANS}`,
            color: speedColor,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-2.4px",
            transition: "color .3s ease",
          }}
        >
          {speed}
        </strong>
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
  /** The `+$x.xx` that floats up on a payout, cleared once it has run. */
  gain: string | null;
  buttons: readonly {
    readonly id: "music" | "camera" | "pause";
    readonly label: string;
    readonly pressed?: boolean;
    readonly onPress: () => void;
  }[];
}) {
  const icon = { music: MUSIC_ICON, camera: CAMERA_ICON, pause: PAUSE_ICON };
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        <span
          data-testid="day-clock"
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
        {buttons.map((button) => (
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
            <HudGlyph path={icon[button.id]} size={m.glyph} strokeWidth={2.75} color={HUD_CREAM} />
          </button>
        ))}
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
  readonly footnote: string;
  readonly secondsLeft: number;
  /** 0→1 of the window burnt; drives the fuse and its colour. */
  readonly elapsed: number;
  readonly surged: boolean;
}

const OFFER_W = 430;
const OFFER_H = 384;

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
const FOOD_ICON = [
  "M15 11h.01",
  "M11 15h.01",
  "M16 16h.01",
  "m2 16 20 6-6-20A20 20 0 0 0 2 16",
  "M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4",
];

/**
 * The offer card. Interactive, so it takes `DRIVE_LAYER.action` rather than the
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
        zIndex: DRIVE_LAYER.action,
      })}
    >
      <div
        style={{
          position: "relative",
          width: OFFER_W,
          height: OFFER_H,
          borderRadius: 28,
          background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
          padding: "24px 26px 22px",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 34px 76px -26px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset, 0 0 46px -8px rgba(250,243,228,.22)",
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
            x="2"
            y="2"
            width={OFFER_W - 4}
            height={OFFER_H - 4}
            rx="26"
            fill="none"
            stroke="rgba(32,30,29,.1)"
            strokeWidth="4"
          />
          <rect
            x="2"
            y="2"
            width={OFFER_W - 4}
            height={OFFER_H - 4}
            rx="26"
            fill="none"
            stroke={fuseHot ? "#d9614c" : HUD_INK}
            strokeWidth="4"
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
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
              borderRadius: 999,
              padding: "6px 14px 6px 11px",
            }}
          >
            <HudGlyph
              path={food ? FOOD_ICON : RIDER_ICON}
              size={17}
              strokeWidth={2.75}
              color={food ? "#a8541f" : "#4e6236"}
            />
            <span
              style={{
                font: `800 13px ${HUD_SANS}`,
                letterSpacing: "2.2px",
                color: food ? "#a8541f" : "#4e6236",
                whiteSpace: "nowrap",
              }}
            >
              {food ? "FOOD DELIVERY" : "RIDESHARE"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              data-testid="offer-countdown"
              style={{
                font: `900 20px ${HUD_SANS}`,
                color: "rgba(32,30,29,.45)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {offer.secondsLeft}
            </span>
            <span
              style={{
                font: `800 12px ${HUD_SANS}`,
                letterSpacing: "1.6px",
                color: "rgba(32,30,29,.35)",
              }}
            >
              S
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 11, marginBottom: 6 }}>
          <span
            data-testid="offer-pay"
            style={{
              font: `900 52px/.9 ${HUD_SANS}`,
              color: HUD_INK,
              letterSpacing: "-2px",
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
                padding: "4px 12px",
                font: `800 15px ${HUD_SANS}`,
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
            font: `700 32px/1.05 ${HUD_SERIF}`,
            color: HUD_INK,
            marginBottom: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.title}
        </div>
        <div
          style={{
            font: `600 16px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            marginBottom: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {offer.sub}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: "auto", flexWrap: "wrap" }}>
          {offer.chips.map((chip) => (
            <span
              key={chip}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: "1.5px solid rgba(32,30,29,.16)",
                borderRadius: 999,
                padding: "6px 13px",
                font: `700 14px ${HUD_SANS}`,
                color: "rgba(32,30,29,.7)",
                whiteSpace: "nowrap",
              }}
            >
              {chip}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 9 }}>
          <button
            type="button"
            data-testid="offer-pass"
            onClick={onPass}
            aria-label={`Pass on this job (${passKey})`}
            style={{
              width: 132,
              height: 64,
              borderRadius: 18,
              background: "rgba(32,30,29,.06)",
              border: "1.5px solid rgba(217,97,76,.35)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              cursor: "pointer",
            }}
          >
            <span style={{ font: `900 17px ${HUD_SANS}`, letterSpacing: "1.2px", color: "#b04a34" }}>
              PASS
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 22,
                height: 22,
                borderRadius: 6,
                background: "rgba(32,30,29,.12)",
                font: `900 12px ${HUD_SANS}`,
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
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              cursor: "pointer",
              boxShadow:
                "0 12px 26px -12px rgba(125,158,99,.9), inset 0 2px 0 rgba(255,255,255,.34)",
            }}
          >
            <span style={{ font: `900 24px ${HUD_SANS}`, letterSpacing: "1.2px", color: "#16210f" }}>
              ACCEPT
            </span>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                minWidth: 28,
                height: 28,
                borderRadius: 7,
                background: "rgba(22,33,15,.22)",
                font: `900 15px ${HUD_SANS}`,
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
            font: `600 13px ${HUD_SANS}`,
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
 */
export const MOBILE_OFFER_W = 260;
export const MOBILE_OFFER_H = 184;
/** Slot height under which the detour rail is dropped to keep the card clear. */
export const RAIL_MIN_SLOT_PX = 172;

export function DriveOfferBar({
  inset,
  offer,
  slotHeight,
  onAccept,
  onPass,
}: {
  inset: { readonly top: string; readonly right: string };
  offer: HudOffer;
  /** Height between the button rail and the pedals — see the note above. */
  slotHeight: number;
  onAccept: () => void;
  onPass: () => void;
}) {
  const food = offer.kind === "delivery";
  const showRail = slotHeight >= RAIL_MIN_SLOT_PX;
  const height = Math.min(MOBILE_OFFER_H, Math.max(120, slotHeight));
  const fuseHot = offer.elapsed > 0.72;
  return (
    <div
      data-testid="gig-offer"
      style={{
        position: "absolute",
        top: inset.top,
        right: inset.right,
        zIndex: DRIVE_LAYER.action,
      }}
    >
      <div
        style={{
          position: "relative",
          width: MOBILE_OFFER_W,
          height,
          borderRadius: 16,
          background: "linear-gradient(168deg,#faf4e6,#efe1c8)",
          padding: "11px 13px 10px",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 24px 54px -20px rgba(0,0,0,.86), 0 0 0 1px rgba(255,255,255,.35) inset",
        }}
      >
        <svg
          viewBox={`0 0 ${MOBILE_OFFER_W} ${height}`}
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
            x="1.5"
            y="1.5"
            width={MOBILE_OFFER_W - 3}
            height={height - 3}
            rx="15"
            fill="none"
            stroke="rgba(32,30,29,.1)"
            strokeWidth="3"
          />
          <rect
            x="1.5"
            y="1.5"
            width={MOBILE_OFFER_W - 3}
            height={height - 3}
            rx="15"
            fill="none"
            stroke={fuseHot ? "#d9614c" : HUD_INK}
            strokeWidth="3"
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
            gap: 8,
            marginBottom: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: food ? "rgba(198,113,57,.15)" : "rgba(90,110,68,.16)",
              borderRadius: 999,
              padding: "3px 8px 3px 6px",
            }}
          >
            <HudGlyph
              path={food ? FOOD_ICON : RIDER_ICON}
              size={10}
              strokeWidth={2.75}
              color={food ? "#a8541f" : "#4e6236"}
            />
            <span
              style={{
                font: `800 8px ${HUD_SANS}`,
                letterSpacing: "1.6px",
                color: food ? "#a8541f" : "#4e6236",
                whiteSpace: "nowrap",
              }}
            >
              {food ? "FOOD DELIVERY" : "RIDESHARE"}
            </span>
          </div>
          <span
            data-testid="offer-countdown"
            style={{
              font: `900 13px ${HUD_SANS}`,
              color: "rgba(32,30,29,.45)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {offer.secondsLeft}s
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span
            data-testid="offer-pay"
            style={{
              font: `900 29px/.9 ${HUD_SANS}`,
              color: HUD_INK,
              letterSpacing: "-1.1px",
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
                padding: "2px 7px",
                font: `800 9px ${HUD_SANS}`,
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
            font: `700 18px/1.05 ${HUD_SERIF}`,
            color: HUD_INK,
            marginTop: 2,
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
            gap: 6,
            marginBottom: "auto",
            font: `600 9px ${HUD_SANS}`,
            color: "rgba(32,30,29,.55)",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{offer.sub}</span>
          {offer.chips[0] && (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "rgba(32,30,29,.25)",
                  flex: "none",
                }}
              />
              <span style={{ flex: "none", color: "rgba(32,30,29,.45)" }}>
                {offer.chips[0]}
              </span>
            </>
          )}
        </div>

        {showRail && (
          <div data-testid="detour-rail" style={{ margin: "7px 0 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <span
                aria-hidden="true"
                style={{ width: 7, height: 7, borderRadius: "50%", background: HUD_INK, flex: "none" }}
              />
              <span
                aria-hidden="true"
                style={{ width: 17, height: 2, borderRadius: 1, background: "rgba(32,30,29,.3)" }}
              />
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  borderRadius: 1,
                  background:
                    "repeating-linear-gradient(90deg,rgba(168,84,31,.85) 0 5px,transparent 5px 10px)",
                  backgroundSize: "15px 2px",
                  animation: "hudDetourRail .8s linear infinite",
                }}
              />
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#a8541f" style={{ flex: "none" }} aria-hidden="true">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z" />
              </svg>
              <span
                aria-hidden="true"
                style={{ flex: 1, height: 2, borderRadius: 1, background: "rgba(32,30,29,.18)" }}
              />
              <span
                aria-hidden="true"
                style={{ width: 7, height: 7, borderRadius: 2, background: "rgba(32,30,29,.35)", flex: "none" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ font: `800 7px ${HUD_SANS}`, letterSpacing: "1.2px", color: "rgba(32,30,29,.38)" }}>
                YOU
              </span>
              <span
                data-testid="detour-label"
                style={{
                  margin: "0 auto",
                  font: `900 9px ${HUD_SANS}`,
                  color: "#a8541f",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {offer.chips[0] ?? ""}
              </span>
              <span style={{ font: `800 7px ${HUD_SANS}`, letterSpacing: "1.2px", color: "rgba(32,30,29,.38)" }}>
                BACK ON ROUTE
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 7, marginTop: showRail ? 0 : 7 }}>
          <button
            type="button"
            data-testid="offer-pass"
            onClick={onPass}
            aria-label="Pass on this job"
            style={{
              width: 74,
              height: 42,
              borderRadius: 12,
              background: "rgba(32,30,29,.06)",
              border: "1.5px solid rgba(217,97,76,.35)",
              font: `900 11px ${HUD_SANS}`,
              letterSpacing: "1.2px",
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
              height: 42,
              borderRadius: 12,
              background: "linear-gradient(180deg,#9dbb7f,#7d9e63)",
              border: "none",
              font: `900 15px ${HUD_SANS}`,
              letterSpacing: "1.2px",
              color: "#16210f",
              cursor: "pointer",
              boxShadow:
                "0 10px 22px -10px rgba(125,158,99,.9), inset 0 2px 0 rgba(255,255,255,.34)",
            }}
          >
            ACCEPT
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The one round button the app owns on a phone.
 *
 * `TouchDriveControls` starts its own row a button-width in from the corner
 * precisely to leave this slot — camera, pause and fullscreen are the session's,
 * music is the app's, and the two must not stack on top of each other.
 */
export function DriveCornerButton({
  inset,
  label,
  pressed,
  onPress,
}: {
  inset: { readonly top: string; readonly right: string };
  label: string;
  pressed?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      style={{
        position: "absolute",
        top: inset.top,
        right: inset.right,
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
      <HudGlyph path={MUSIC_ICON} size={19} strokeWidth={2.75} color={HUD_CREAM} />
    </button>
  );
}
