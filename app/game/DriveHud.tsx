/**
 * The desktop and mobile drive HUD, built to the `Curbside Driving HUD
 * Desktop`/`Curbside Driving HUD Mobile` designs.
 *
 * This file is a compatibility barrel (#290): every symbol it exported before
 * the split still exports from here unchanged, so no importer needs to
 * change its path (`tests/driveHud.test.tsx`, `tests/expandedMap.test.tsx`,
 * `DriveScreen.tsx`, `SideSwapApp.tsx`, `ExpandedMap.tsx` and
 * `MapPoiLayer.tsx` all still import from `./game/DriveHud` /
 * `./DriveHud`). The implementation now lives in `driveHud/`, split along
 * measured coupling — which components/helpers actually shared which local
 * constants, types and helpers — rather than along the original file's
 * section comments; see the PR description for the coupling table. Order
 * below follows the dependency graph the measurement produced:
 *
 * - `driveHud/tokens.tsx` — palette, type, `resolveHudScale`, `HudGlyph`, and
 *   the internal `cluster()`/`MUSIC_DIM_COLOR` helpers. The one module every
 *   other one below depends on; it depends on nothing else here.
 * - `driveHud/navCard.tsx` — `DriveNavCard` and the manoeuvre/job/gauge
 *   shapes it alone consumes. (These were grouped under a "Shared shapes"
 *   heading in the original file, but were never actually shared with
 *   another component in it — only with callers outside the file.)
 * - `driveHud/dayTimer.tsx` — the career shift clock's shared resolution
 *   (`resolveDayTimer`, `HudDayTimer`, `DAY_TIMER_METRICS`) and its
 *   full-bleed edge-bar home, `DriveDayEdge`.
 * - `driveHud/speed.tsx` — `DriveSpeedCluster`, the clock's other home.
 *   Imports `driveHud/dayTimer.tsx`'s `DAY_TIMER_METRICS`/`HudDayTimer`;
 *   `driveHud/dayTimer.tsx` depends on nothing from here in return.
 * - `driveHud/money.tsx` — `DriveMoneyCluster` and its button shape.
 * - `driveHud/alerts.tsx` — `DriveSurgeBanner` and the generic `DriveToast`.
 * - `driveHud/offer.tsx` — the gig offer: `HudOffer`, `DriveOfferCard`,
 *   `DriveOfferGlow`, `DriveOfferBar`, `DriveOfferPanel`.
 * - `driveHud/cornerButton.tsx` — `DriveCornerButton`, the phone's own
 *   music/map row.
 *
 * Every module above is props-pure and free of any Babylon import, same as
 * this file always was, so `tests/driveHud.test.tsx` and
 * `tests/expandedMap.test.tsx` still render them in jsdom. See
 * `docs/drive-hud.md` for the layering and positioning invariants that
 * shaped where each cluster's boundary was allowed to fall.
 *
 * **Every layer takes its z-index from `DRIVE_LAYER`.** The HUD and the
 * driving controls are z-order siblings in one stacking context spread across
 * two files, and hard-coding a number in either is how the pedals ended up
 * painted under the minimap for months — invisible, still tappable, and
 * untestable. See `driveLayers.ts`.
 */

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

export { DriveNavCard } from "./driveHud/navCard";
export type { HudManoeuvre, HudGauge, HudJob } from "./driveHud/navCard";

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

export { DriveCornerButton } from "./driveHud/cornerButton";
