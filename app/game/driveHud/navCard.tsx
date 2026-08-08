/**
 * The nav card: top-left status card showing the current manoeuvre, the
 * active job and its gauges. Split out of `DriveHud.tsx` (#290).
 *
 * `HudManoeuvre`, `HudGauge` and `HudJob` were grouped under a "Shared
 * shapes" heading in the original file, but actual usage was never shared —
 * all three are consumed exclusively by `DriveNavCard` below (the app just
 * constructs them to pass in). They move here, not to `driveHud/tokens.tsx`,
 * because the measured coupling says so.
 */

import { cluster, HudGlyph, HUD_CORAL, HUD_CREAM, HUD_GLASS, HUD_GOLD, HUD_SAGE, HUD_SANS, HUD_SERIF } from "./tokens";
import { PARCEL_ICON, RIDER_ICON } from "../hudIcons";

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
  label: 11, nextDistance: 13, icon: 16,
  jobName: 18, pay: 17, payPad: "3px 13px",
  gaugeValue: 15, gaugeValueWidth: 46, gaugeBar: 6, gap: 16,
};

const NAV_MOBILE: NavMetrics = {
  width: 330, radius: 14, pad: "10px 11px 9px 15px",
  rail: { left: 6, inset: 11, width: 3 },
  plate: 46, plateRadius: 13, arrow: 27,
  dist: 23, unit: 10, kicker: 8, street: 19,
  bar: 2, barMargin: "7px 0 6px", rowGap: 7,
  label: 8, nextDistance: 9, icon: 10,
  jobName: 12, pay: 11, payPad: "2px 8px",
  gaugeValue: 10, gaugeValueWidth: 28, gaugeBar: 4, gap: 9,
};


export function DriveNavCard({
  scale,
  inset,
  manoeuvre,
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

        {manoeuvre && (
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
