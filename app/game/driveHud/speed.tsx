/**
 * The speed cluster — the readout of how fast you are going against how fast
 * you may — and, when the shift clock is in this row rather than
 * `DriveDayEdge` (see `driveHud/dayTimer.tsx`), how long you have left to do
 * it in. Split out of `DriveHud.tsx` (#290).
 *
 * `HudNumeralSlot` and `WIDEST_SPEED` stay private here: nothing else in
 * `driveHud/*` renders a numeral this way. `WIDEST_DAY_CLOCK`/
 * `WIDEST_DAY_SECONDS` live here rather than in `driveHud/dayTimer.tsx` for
 * the same reason, despite the name — they only size the day-clock numeral
 * slot this component draws; `driveHud/dayTimer.tsx` itself never needs them.
 */

import type { CSSProperties, ReactNode } from "react";

import { cluster, HudGlyph, HUD_CORAL, HUD_CREAM, HUD_GOLD, HUD_SANS } from "./tokens";
import { STOPWATCH_ICON } from "../hudIcons";
import { DAY_TIMER_METRICS } from "./dayTimer";
import type { HudDayTimer } from "./dayTimer";

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

/**
 * The widest each of the clock's two formats gets, sizing its numeral slot.
 * `m:ss` is already fixed by tabular figures — a day past 9:59 would want
 * `00:00` here and a wider block — but the bare seconds fall from two digits
 * to one, and that is what the slot is really for.
 */
const WIDEST_DAY_CLOCK = "0:00";
const WIDEST_DAY_SECONDS = "00";

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
