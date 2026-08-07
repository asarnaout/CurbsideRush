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


import { HUD_CREAM, HudGlyph, MUSIC_DIM_COLOR } from "./driveHud/tokens";

export {
  HUD_CREAM,
  HUD_GOLD,
  HUD_CORAL,
  HUD_SAGE,
  HUD_GLASS,
  HUD_SANS,
  HUD_SERIF,
  HUD_INK,
  HUD_DESIGN_WIDTH,
  HUD_MIN_SCALE,
  resolveHudScale,
  HudGlyph,
} from "./driveHud/tokens";

export {
  DAY_TIMER_WARN_S,
  DAY_TIMER_CRITICAL_S,
  DAY_TIMER_MIN_VIEWPORT_PX,
  DAY_TIMER_METRICS,
  resolveDayTimer,
  DriveDayEdge,
} from "./driveHud/dayTimer";
export type { DayTimerTone, HudDayTimer } from "./driveHud/dayTimer";

export { SPEED_OVER_BANDS, speedOverBand, DriveSpeedCluster } from "./driveHud/speed";
export type { SpeedOverBand } from "./driveHud/speed";

export { DriveNavCard } from "./driveHud/navCard";
export type { HudManoeuvre, HudGauge, HudJob } from "./driveHud/navCard";

export { DriveMoneyCluster } from "./driveHud/money";
export type { DriveMoneyClusterButton } from "./driveHud/money";

export { DriveSurgeBanner, DriveToast } from "./driveHud/alerts";

export {
  OFFER_TOP_OFFSET_PX,
  FUSE_SMOOTHING_MS,
  DriveOfferCard,
  DriveOfferGlow,
  MOBILE_OFFER_H,
  MOBILE_OFFER_MIN_H,
  MOBILE_OFFER_DENSE_H,
  RAIL_MIN_SLOT_PX,
  resolveOfferPanelHeight,
  DriveOfferBar,
  DriveOfferPanel,
} from "./driveHud/offer";
export type { HudOffer } from "./driveHud/offer";


// ---------------------------------------------------------------------------
// Top-centre: how fast you are going, against how fast you may — and, in
// career, how long you have left to do it in
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Top-right: the money, and what you can press
// ---------------------------------------------------------------------------


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
