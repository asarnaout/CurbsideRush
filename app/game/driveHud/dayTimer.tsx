/**
 * The career shift clock: `resolveDayTimer` resolves the raw remaining-time
 * numbers into `HudDayTimer` once, and that single resolved value feeds both
 * of the clock's two homes — the numerals inside `DriveSpeedCluster`
 * (`driveHud/speed.tsx`) and the full-bleed `DriveDayEdge` bar below. Split
 * out of `DriveHud.tsx` (#290); `DAY_TIMER_METRICS` and `HudDayTimer` are the
 * load-bearing exports `driveHud/speed.tsx` imports back from here — the two
 * homes must never disagree about what colour the day is.
 *
 * `WIDEST_DAY_CLOCK`/`WIDEST_DAY_SECONDS` stayed in `driveHud/speed.tsx`
 * instead of moving here: despite the name, they size a numeral slot that
 * only exists inside `DriveSpeedCluster`'s render of the clock, so that is
 * where actual usage puts them.
 */

import { DRIVE_LAYER } from "../driveLayers";
import { HUD_CORAL, HUD_CREAM, HUD_GOLD } from "./tokens";

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
