"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  CutsceneRequest,
  DriveScenario,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/sessionContract";
import {
  getCountryProfile,
  getDestinationProfile,
  getFreeDrive,
  getMapPack,
} from "./game/content";
import {
  FINE_BY_COUNTRY,
  FUEL_CONSUMPTION_L_PER_M,
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  GIG_FARE_BY_COUNTRY,
  MIN_REFUEL_LITRES,
  PASSENGER_FARE_BY_COUNTRY,
  TANK_CAPACITY_L,
  formatDistance,
  formatDistanceParts,
  formatMoney,
  fuelPurchase,
  postedSpeed,
  repairPrice,
  speedingFine,
} from "./game/economyTables";
import {
  SPEEDING_STOP_GRACE_MS,
  speedingExcessMps,
} from "./game/speeding";
import {
  clearCareer,
  createDefaultProgress,
  credit,
  debit,
  loadProgress,
  resetProgress,
  saveProgress,
  setFuel,
  writeCareer,
} from "./game/progress";
import {
  activeCity,
  applySettlement,
  applyTicket,
  applyVehiclePurchase,
  canBuyTicket,
  CAREER_START_CITY,
  careerCountryOf,
  nextCareerCity,
  careerDayTrafficSeed,
  careerFare,
  careerGigSeedBase,
  careerCityIndex,
  canBuyVehicle,
  cityRating,
  createCareerSlice,
  ticketPrice,
  travelTo,
  DAY_LENGTH_MS,
  DEFAULT_GARAGE_VEHICLE_ID,
  emptyDayLog,
  garageDefaultVehicle,
  getCareerVehicle,
  PLATFORM_FEE_BY_COUNTRY,
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  ROADSIDE_PRICE_FACTOR,
  averageRating,
  ratingFareFactor,
  ratingSearchStretch,
  ratingStanding,
  ratingTipFactor,
  settleDay,
  settleRating,
  vehicleRent,
} from "./game/career";
import type {
  CareerCityView,
  CareerSliceV2,
  CareerVehicleId,
  CareerVehicleSpec,
  RatingSettlement,
  SettlementResult,
} from "./game/career";
import {
  CareerOverView,
  formatClock,
  travelBoard,
  travelSummary,
  TravelView,
  GarageView,
  LedgerView,
} from "./CareerViews";
import type { TravelCityFacts } from "./CareerViews";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsView } from "./SettingsView";
import { CreditsView } from "./CreditsView";
import { LauncherView, DESTINATION_PREVIEW_IMAGES } from "./LauncherView";
import { useGamepadUiNavigation } from "./useGamepadUiNavigation";
import { DriveScreen } from "./DriveScreen";
import { useDriveStatusPort } from "./drivePort";
import { useCareerPort } from "./careerPort";
import { useGigDispatchPort } from "./gigDispatchPort";
import {
  FULL_CONDITION_PCT,
  MIN_REPAIRABLE_DAMAGE_PCT,
  damageForCollision,
} from "./game/damage";
import { REPAIR_BAY_REACH_M } from "./game/repairShopLayout";
import {
  buildCareerDayScenario,
  buildFreeDriveScenario,
} from "./game/driveScenario";
import {
  FUEL_PUMP_REACH_M,
  distanceToNearestPump,
  distanceToRepairBay,
  gasStationsOf,
  repairShopsOf,
} from "./game/servicePoints";
import type { MapDestination } from "./game/minimapDraw";
import {
  collectMapPois,
  mapPoisOfKinds,
  MINIMAP_POI_KINDS,
  type MapPoi,
} from "./game/mapPoi";
import {
  findGpsRoute,
  gpsGraphForLanes,
  routeLengthM,
  routeProgress,
  trimRouteToPlayer,
  type GpsLane,
  type GpsProgress,
  type GpsRoute,
} from "./game/gpsRoute";
import { readInputCapabilities } from "./game/pointerCapabilities";
import {
  applyViewportFitCover,
  canFullscreen,
  isStandaloneDisplay,
  requestImmersiveLandscape,
} from "./game/viewportSetup";
import {
  SAFE_LEFT,
  SAFE_RIGHT,
  SAFE_TOP,
  TOUCH_INSET_PX,
  TOUCH_OFFER_GAP_PX,
  TOUCH_PEDAL_BLOCK_PX,
  TOUCH_TOP_RAIL_PX,
} from "./game/TouchDriveControls";
import { primeAudioContext, suspendAudioContext } from "./game/audio/audioContext";
import { useDriveMusic } from "./game/audio/musicPlayer";
import {
  generateGigFromPools,
  gigTarget,
  MAX_SAME_KIND_STREAK,
  pickGigKindAvoidingStreak,
  selectGigPools,
} from "./game/gigs";
import type { Gig, GigKind } from "./game/gigs";
import { resolveGigAddresses, resolveGigVenues } from "./game/gigPools";
import {
  createDispatch,
  foodSpeedBonus,
  gigParMs,
  gigRating,
  OFFER_WINDOW_MS,
  quotedTip,
  SURGE_FARE_MULTIPLIER,
  resolveOffer,
  ridePromptness,
  rideTip,
  stepDispatch,
  surgeWindowAt,
} from "./game/dispatch";
import type { DispatchState, SurgeWindow } from "./game/dispatch";
import {
  DAY_TIMER_MIN_VIEWPORT_PX,
  HUD_DESIGN_WIDTH,
  resolveDayTimer,
  resolveHudScale,
} from "./game/DriveHud";
import type {
  DriveMoneyClusterButton,
  HudGauge,
  HudJob,
  HudManoeuvre,
  HudOffer,
} from "./game/DriveHud";
import { CAR_ICON, FUEL_PUMP_ICON } from "./game/hudIcons";
import type {
  CameraMode,
  CountryProfile,
  DestinationId,
  PlayerProgressV2,
} from "./game/types";

export type View =
  | "launcher"
  | "driving"
  | "settings"
  | "credits"
  | "career-garage"
  | "career-ledger"
  | "career-over"
  | "career-travel";

/**
 * The in-flight career day: the morning slice, the city being driven (resolved
 * once so the day's money and identity can't drift if the pointer moves), and
 * the vehicle taken out.
 */
export interface CareerRun {
  readonly slice: CareerSliceV2;
  readonly city: CareerCityView;
  readonly vehicleId: CareerVehicleId;
  readonly vehicle: CareerVehicleSpec;
  /**
   * The morning's standing, 0→1, resolved once and held all day.
   *
   * Read at the garage rather than live off the slice for three reasons, each
   * on its own sufficient. It cannot leak feedback: work arriving faster
   * mid-shift would tell the driver a customer had just rated them, which is
   * exactly what the drive screen is supposed to withhold. It keeps the day
   * replayable, since a retried day resolves the same number. And it is one
   * read instead of three that could disagree.
   */
  readonly ratingStanding: number;
}

/**
 * Everything the travel board shows about a city, pulled from the profiles that
 * already describe it. The area line takes the first clause of the destination
 * subtitle — the rest is scene-setting that would wrap the card.
 */
function describeTravelCity(destinationId: DestinationId): TravelCityFacts {
  const destination = getDestinationProfile(destinationId);
  return {
    name: destination.destinationName,
    area: destination.destinationSubtitle.split("·")[0].trim(),
    country: getCountryProfile(destination.countryId),
    imageSrc: DESTINATION_PREVIEW_IMAGES[destinationId],
  };
}

/**
 * Builds the next gig for a drive. The kind (delivery vs. passenger) is a
 * deterministic hash of the seed, capped against long single-kind runs by
 * `pickGigKindAvoidingStreak`: a drive draws consecutive seeds, and some
 * cities' `trafficSeed` hashes to a long opening run of one kind — NYC's first
 * eight seeds are all deliveries — so without the cap a player could finish half
 * a dozen gigs before ever being offered a fare. `recentKinds` is the tail of
 * kinds already served this drive. Draws from the matching fare table so rides
 * pay their premium. Returns null only when the map has too few places for
 * either kind; a forced kind that cannot generate on this map falls back to the
 * other, so the streak cap never strands the player without a gig.
 */
function nextGigFor(
  map: ReturnType<typeof getMapPack>,
  country: CountryProfile,
  seed: number,
  recentKinds: readonly GigKind[],
  // Career vehicles gate what may be OFFERED: a bicycle courier is never shown
  // a rideshare request rather than being allowed to decline one.
  allowedKinds: readonly GigKind[] = ["delivery", "passenger"],
  surgeMultiplier = 1,
): Gig | null {
  const venues = resolveGigVenues(map);
  const addresses = resolveGigAddresses(map);
  const buildGig = (kind: GigKind): Gig | null => {
    const fare =
      kind === "passenger"
        ? PASSENGER_FARE_BY_COUNTRY[country.id]
        : GIG_FARE_BY_COUNTRY[country.id];
    const { pickups, dropoffs } = selectGigPools(venues, addresses, kind);
    return generateGigFromPools(
      pickups,
      dropoffs,
      fare,
      country.currency.code,
      seed,
      kind,
      surgeMultiplier,
    );
  };
  const drawn = pickGigKindAvoidingStreak(seed, recentKinds);
  const preferred = allowedKinds.includes(drawn) ? drawn : allowedKinds[0];
  if (preferred === undefined) return null;
  const fallback: GigKind = preferred === "passenger" ? "delivery" : "passenger";
  return (
    buildGig(preferred) ??
    (allowedKinds.includes(fallback) ? buildGig(fallback) : null)
  );
}

/**
 * What a finished job tips, on top of whatever the fare paid.
 *
 * The two kinds settle differently, which is the whole point of the rewrite: a
 * food order was tipped when it was placed and may add a little for a quick
 * run, while a rider decides on the way — against how long the trip took and
 * how many rules were broken with them in the car.
 *
 * `ratingFactor` is the career driver's standing and defaults to 1, which is
 * what free drive passes. It is applied here rather than inside `dispatch.ts`
 * because that module is shared with free drive and knows nothing of careers.
 */
function gigTipFor(
  gig: Gig,
  gross: number,
  carriedMs: number,
  parMs: number,
  onTime: boolean,
  violations: number,
  ratingFactor = 1,
): number {
  const base =
    gig.kind === "passenger"
      ? rideTip(gross, gig.seed, {
          promptness: ridePromptness(carriedMs, parMs),
          violations,
          surged: gig.surged,
        })
      : quotedTip(gross, gig.seed, gig.surged) +
        foodSpeedBonus(gross, gig.seed, onTime, gig.surged);
  return Math.round(base * ratingFactor);
}

/**
 * What the card says about the tip while a job is in the car.
 *
 * The two kinds are timed differently and the wording has to match, or the HUD
 * promises something the payout will not honour: a food order's quoted tip is
 * already banked and only the *bonus* is on the clock, while a rider's whole
 * tip slides with how long the trip takes.
 */
function tipHint(kind: GigKind, remainingMs: number): string | null {
  if (kind === "passenger") {
    return remainingMs > 0
      ? `Rider is timing you — ${formatClock(remainingMs)}`
      : "Taking a while — the tip is slipping";
  }
  return remainingMs > 0
    ? `Quick-delivery bonus — ${formatClock(remainingMs)}`
    : null;
}

/** How close to a gig stop counts as arrived — mirrors `advanceGig`'s radius;
 * the state itself now flips when the arrival cutscene completes. */
const GIG_ARRIVAL_RADIUS_M = 14;

/**
 * Distance at which the next manoeuvre stops being something to know about and
 * becomes something to do — the plate lights and the wording switches from
 * "HEAD LEFT ONTO" to "TURN LEFT NOW". About two car lengths past the point a
 * driver has to be in the right lane.
 */
const MANOEUVRE_IMMINENT_M = 45;


/**
 * How far off the GPS line counts as having left it. Wide enough to sit out a
 * lane change, an overtake or a kerbside stop without the route flickering;
 * narrow enough that a wrong turn re-routes within a block. Roads are ~10 m and
 * NYC's junctions are 240 m apart.
 */
const ROUTE_DEVIATION_LIMIT_M = 30;

/**
 * The floor on re-searching while the destination is unchanged. Only reached
 * when the player is genuinely off-route — driving away from a destination
 * would otherwise search on every one of the 10 HUD snapshots a second.
 */
const ROUTE_RESEARCH_INTERVAL_MS = 1500;

/**
 * Human-readable reason for a fine toast, from the violation's rule code.
 *
 * Speeding is the only one that cites figures, because it is the only one
 * whose fine moves: a driver told they were charged "for speeding" cannot see
 * that the amount tracked the offence, and would read two different tickets as
 * a bug. "Doing 42 in a 30" makes the scaling legible without a second line of
 * UI. Both figures come out of the event's own evidence, so what the officer
 * says and what the wallet loses are computed from one measurement.
 */
/**
 * The shortest gap between two fines from *any* source.
 *
 * Short on purpose. It is here to stop one incident being charged twice — a
 * swerve that leaves the road and hits someone trips two rules in the same
 * breath, and two different mechanisms answer them — not to re-pace a driver
 * who reoffends a few seconds later, which each mechanism's own clock already
 * governs.
 */
const FINE_MIN_SPACING_MS = 3000;

function fineReason(
  code: string | undefined,
  evidence: Readonly<Record<string, string | number | boolean>> | undefined,
  country: CountryProfile,
): string {
  switch (code) {
    case "wrong_way":
      return "driving on the wrong side";
    case "out_of_bounds":
      return "leaving the road";
    case "red_light":
      return "running a red light";
    case "collision":
      return "careless driving";
    case "speeding": {
      const speed = evidence?.speedMps;
      const limit = evidence?.limitMps;
      if (typeof speed !== "number" || typeof limit !== "number") {
        return "speeding";
      }
      return `doing ${Math.round(postedSpeed(speed, country))} in a ${Math.round(
        postedSpeed(limit, country),
      )}`;
    }
    default:
      return "a road violation";
  }
}

/*
 * ── Drive HUD ───────────────────────────────────────────────────────────────
 *
 * The one screen that never got the dark HUD language the rest of the app runs
 * on. These are the `--hud-*` custom properties from `globals.css` repeated as
 * literals, because the drive screen is styled inline throughout (it shares a
 * stacking context with GameCanvas's own inline-styled controls, and splitting
 * the two across a stylesheet is how the z-order bug in `driveLayers.ts`
 * happened in the first place).
 */
const HUD_GOLD = "#f4c848";
const HUD_CORAL = "#e8705a";

/** A stable empty set, so nothing off the drive screen re-renders on identity. */
const EMPTY_MAP_POIS: readonly MapPoi[] = Object.freeze([]);
const HUD_SAGE = "#8fae72";

/**
 * What the caption over an interaction scene reads, per kind.
 *
 * A full `Record` rather than the ternary chain this was, so adding a scene is
 * a compile error here instead of silently inheriting the last branch — which,
 * for anything unlisted, said "Delivering the order…".
 */
const CUTSCENE_CAPTION: Record<CutsceneRequest["kind"], string> = {
  refuel: "Refueling…",
  roadside_refuel: "Out of fuel — roadside service…",
  repair: "In the shop…",
  pullover: "Pulled over — licence and registration…",
  board: "Your rider is getting in…",
  exit: "Dropping off your rider…",
  food_pickup: "Picking up the order…",
  food_dropoff: "Delivering the order…",
};

/**
 * One way to act on the service prompt at a pump or a repair bay.
 *
 * A list rather than a single action because career's pump offers two ways to
 * pay when the day's cash falls short of a tank, and which one the driver picks
 * is a real decision — the borrowed part settles into a loan tonight.
 * `tone: "credit"` is what marks the offer that puts money on the slate.
 *
 * Presentation only, deliberately: the callbacks live beside the list as plain
 * values (`promptEnterAct` / `promptBorrowAct`). They close over `cutsceneRef`
 * through `beginCutscene`, and the React Compiler treats *any* property read on
 * an array holding such a function — `.length` included — as a ref access
 * during render, which costs the whole component its memoization.
 */
export interface ServicePromptAction {
  readonly testId: string;
  readonly label: string;
  /** Trailing qualifier, set apart from the price it qualifies. */
  readonly note?: string;
  /** The key that takes it, shown as a chip. Only ever "ENTER" or "B". */
  readonly hint: "ENTER" | "B";
  readonly tone: "primary" | "credit";
  readonly enabled: boolean;
}



/** Lays the stat strip out two-up, the way the meters pair in the design. */

/**
 * One cell of the panel's stat strip: glyph, value, and an optional meter bar.
 *
 * The bar is what makes fuel and condition readable at a glance while the eyes
 * belong to the road — a percentage alone has to be parsed, a bar does not.
 */

export default function SideSwapApp() {
  const [progress, setProgress] = useState<PlayerProgressV2>(() =>
    createDefaultProgress(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("launcher");
  const [destinationId, setDestinationId] =
    useState<DestinationId>("uk-london");
  const [camera, setCamera] = useState<CameraMode>("third_person");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const destinationRefs = useRef(
    new Map<DestinationId, HTMLButtonElement>(),
  );
  const [paused, setPaused] = useState(false);
  // The whole-city map (M, or the HUD button). Deliberately not a pause: the
  // car keeps rolling while it is up, and `ExpandedMap` is built around that.
  const [mapOpen, setMapOpen] = useState(false);
  // Which in-game confirmation modal is open, if any. Replaces native
  // window.confirm() so the prompt matches the dark HUD (#164). Only one is
  // ever open at a time, and each is dismissed within its own view.
  const [pendingConfirm, setPendingConfirm] = useState<
    "end-day" | "abandon-career" | "buy-ticket" | null
  >(null);
  const [hud, setHud] = useState<GameHudSnapshot | null>(null);
  const [driveFuel, setDriveFuel] = useState(TANK_CAPACITY_L);
  // The one drive session's own status: vehicle condition, tow, the staged
  // interaction cutscene, and citation dedupe bookkeeping. See
  // `app/drivePort.ts`'s header for why this is a separate port from career
  // money and the active gig.
  const {
    carCondition,
    carConditionRef,
    setCarCondition,
    towing,
    towingRef,
    towFee,
    towResetNonce,
    startTow,
    pulseTowReset,
    endTow,
    cutscene,
    cutsceneRef,
    beginCutscene,
    clearCutscene,
    fuelFillMs,
    setFuelFillMs,
    fineToast,
    setFineToast,
    lastAnyFineAtRef,
    lastFineAtRef,
    lastPedFineAtRef,
    lastSpeedingFineAtRef,
    pendingFineReasonRef,
    pendingFineAmountRef,
  } = useDriveStatusPort();
  // Hoisted up from beside `chargeFine` (its original spot) so `driveCountry`
  // is available for `useGigDispatchPort` below — both are pure functions of
  // `destinationId`, so where they run within the render makes no difference.
  const destination = getDestinationProfile(destinationId);
  const country = getCountryProfile(destination.countryId);
  const driveDestination = getDestinationProfile(destinationId);
  const driveCountry = getCountryProfile(driveDestination.countryId);
  // The job currently being carried out, whatever is queued behind it, and
  // how a completed one gets announced. See `app/gigDispatchPort.ts`'s
  // header for why this is a separate port from drive status and career
  // money, and deliberately narrower than "the dispatch subsystem."
  const {
    gig,
    gigRef,
    setGig,
    queuedGig,
    queuedGigRef,
    setQueuedGig,
    promoteQueuedGig,
    carryingSinceMs,
    carryingSinceRef,
    carryViolationsRef,
    startCarrying,
    endCarryingLeg,
    paidGigRef,
    sessionEarnings,
    setSessionEarnings,
    payoutGain,
    setPayoutGain,
    dispatchToast,
    setDispatchToast,
    announcePayout,
  } = useGigDispatchPort(driveCountry);
  const lastPoseRef = useRef<{ x: number; z: number } | null>(null);
  const lastHeadingRef = useRef(0);
  // The kinds offered so far this drive, newest last, capped to the streak
  // window. Threaded into nextGigFor so no drive opens on a long run of one
  // kind — NYC's trafficSeed otherwise hashes to eight deliveries before the
  // first fare. Counted per *offer* rather than per gig served: a player who
  // passes on four deliveries has still been shown four deliveries.
  const gigKindHistoryRef = useRef<GigKind[]>([]);
  // ── Dispatch ─────────────────────────────────────────────────────────────
  // The schedule lives in a ref, not state: while the queue is full it re-arms
  // on every snapshot, which as state would be a set-per-tick for nothing. What
  // renders is state — the live offer with the moment it opened, the queued job
  // and the drive clock the countdown is measured against.
  const dispatchRef = useRef<DispatchState>(createDispatch(1));
  /**
   * How much longer this driver waits between offers. A ref beside the schedule
   * because dispatch is stepped from `handleHud`, which cannot see React state;
   * set once when a career day opens and back to 1 when it closes, so free
   * drive and a well-rated driver are both unaffected.
   */
  const dispatchStretchRef = useRef(1);
  const [offer, setOffer] = useState<{ gig: Gig; offeredAtMs: number } | null>(
    null,
  );
  const offerRef = useRef<Gig | null>(null);
  const [driveElapsedMs, setDriveElapsedMs] = useState(0);
  // Everything building an offer needs, parked where the `[]`-deps HUD
  // callback can reach it — same reason `careerRunRef` exists.
  const driveContextRef = useRef<{
    map: ReturnType<typeof getMapPack>;
    country: CountryProfile;
    allowedKinds: readonly GigKind[];
    surgeSeed: number;
  } | null>(null);
  /** Sim-clock ms since the drive began, folded across tow resets. */
  const driveElapsedRef = useRef(0);
  const [surge, setSurge] = useState<SurgeWindow | null>(null);
  /**
   * The dashed line to a live offer's pickup — how far out of the way it is,
   * answered on the map rather than in a number nobody can picture. Searched
   * once when the offer opens, never per frame.
   */
  const [previewRoute, setPreviewRoute] = useState<GpsRoute | null>(null);
  // The comp is a fixed 1920 frame and its clusters are scaled to fit, so the
  // HUD has to know how wide the window is. Only on resize — never per frame.
  const [viewportWidth, setViewportWidth] = useState(HUD_DESIGN_WIDTH);
  const [viewportHeight, setViewportHeight] = useState(1080);
  // The in-flight career day: which run is live, its day-local cash/ledger,
  // the day clock, and the flags that coordinate settlement with whatever
  // else is on screen when the whistle blows. See `app/careerPort.ts`'s
  // header for why this is a separate port from drive status and the gig.
  const {
    careerRun,
    careerRunRef,
    setCareerRun,
    dayCash,
    dayCashRef,
    setDayCash,
    chargeCareer,
    dayLogRef,
    dayElapsedBaseRef,
    lastSimElapsedRef,
    dayRemainingMs,
    setDayRemainingMs,
    dayIntroFromMs,
    setDayIntroFromMs,
    pendingSettleRef,
    dayActiveRef,
    endCareerDayRef,
  } = useCareerPort();
  const [lastSettlement, setLastSettlement] = useState<{
    readonly result: SettlementResult;
    readonly slice: CareerSliceV2;
    readonly city: CareerCityView;
    /**
     * The city as it stood that morning. A bankrupt settlement wipes the city,
     * so the wipe report has to read the run it lost, not the fresh sheet that
     * replaced it.
     */
    readonly morningCity: CareerCityView;
    /** Tonight's standing: what the wipe report and the career page read. */
    readonly rating: RatingSettlement;
  } | null>(null);
  // The garage's selection has no state of its own: it lives in `progress` so
  // that it survives a reload, and reading it from one place is what keeps the
  // stored preference and the highlighted card from ever disagreeing.
  const garageVehicleId = progress.lastCareerVehicleId;
  // The GPS line to the current gig. Mirrored into a ref because the search
  // that maintains it runs inside `handleHud`, which cannot read state.
  const [gpsRoute, setGpsRoute] = useState<GpsRoute | null>(null);
  const gpsRouteRef = useRef<GpsRoute | null>(null);
  // Next manoeuvre and distance to it, refreshed by the same projection that
  // measures deviation. Mirrored into state for the navigation banner; the ref is
  // what `handleHud` writes, since that callback cannot read state.
  const gpsProgressRef = useRef<GpsProgress | null>(null);
  const [gpsProgress, setGpsProgress] = useState<GpsProgress | null>(null);
  /**
   * How long the run to the current stop was when it started — the denominator
   * the "to go" bar fills against.
   *
   * It cannot be the live route's own length: a route is re-searched whenever
   * the driver strays 30 m off it, and the new one runs from where they now
   * stand, so its length *is* the distance remaining. Dividing by that puts the
   * bar back to zero at every re-search. Pinning it per leg makes the bar mean
   * "how much of this run is behind me", and it only resets when the stop
   * itself changes — pickup to drop-off.
   */
  const [legRouteTotalM, setLegRouteTotalM] = useState(0);
  const routeTargetRef = useRef<string | null>(null);
  const routeSearchedAtRef = useRef(0);
  const routeLanesRef = useRef<readonly GpsLane[]>([]);
  // Street names travel with the lanes so legs merge on the street a driver
  // perceives, not the surface id — several surfaces can be one road.
  const routeRoadNamesRef = useRef<Readonly<Record<string, string>> | undefined>(
    undefined,
  );
  const [gameMode, setGameMode] = useState<"free" | "career">("free");
  const [touchFirst, setTouchFirst] = useState(false);
  const [needsHomeScreenForFullscreen, setNeedsHomeScreenForFullscreen] =
    useState(false);

  // Lives out here rather than inside GameCanvas, which remounts mid-session
  // whenever the destination or steering side changes — music placed in there
  // would restart at apparently random moments.
  const musicMuted = progress.accessibility.musicMuted;
  const music = useDriveMusic(
    musicMuted
      ? 0
      : progress.accessibility.masterVolume * progress.accessibility.musicVolume,
  );
  // Mute is its own switch rather than a volume of zero, so the slider keeps the
  // level to come back to.
  const toggleMusicMuted = useCallback(() => {
    setProgress((current) => {
      const next: PlayerProgressV2 = {
        ...current,
        accessibility: {
          ...current.accessibility,
          musicMuted: !current.accessibility.musicMuted,
        },
      };
      saveProgress(next);
      return next;
    });
  }, []);

  // Drain fuel by the distance the car actually moved between HUD samples, then
  // mirror the pose for the next delta. Fuel lives in the drive session and is
  // written back to the country's tank on refuel and on exit (free drive) or
  // discarded with the rental at day end (career). In career the same stream
  // drives the day clock off the sim's deterministic elapsed time.
  /**
   * Keeps the minimap's GPS line pointed at the current gig.
   *
   * The search is cheap — 0.13 ms across NYC's 227 lanes — but this runs on
   * every one of the ten snapshots a second, so what keeps it cheap is how
   * rarely it searches: once when the destination changes, and again only once
   * the player has actually left the route, which is a wrong turn. Holding the
   * route rather than re-deriving it also keeps the drawn line still; a grid
   * offers many equal-cost staircases between two points, and re-searching as
   * you drive would flip between them.
   *
   * Everything the 10 Hz path does is the deviation check, bounded by the
   * route's own few dozen points.
   */
  const updateGpsRoute = useCallback((snapshot: GameHudSnapshot) => {
    const target = gigRef.current ? gigTarget(gigRef.current) : null;
    if (!target) {
      if (routeTargetRef.current === null) return;
      routeTargetRef.current = null;
      gpsRouteRef.current = null;
      setGpsRoute(null);
      setGpsProgress(null);
      setLegRouteTotalM(0);
      return;
    }
    // Pickup and drop-off are separate destinations at the same venue id.
    const targetKey = `${target.id}:${gigRef.current?.state ?? ""}`;
    const fresh = routeTargetRef.current === targetKey;
    // One projection answers both questions the snapshot has: whether the
    // player has left the route, and what the next manoeuvre is.
    const progress = gpsRouteRef.current
      ? routeProgress(gpsRouteRef.current, snapshot.playerX, snapshot.playerZ)
      : null;
    gpsProgressRef.current = fresh ? progress : null;
    setGpsProgress(gpsProgressRef.current);
    if (fresh && progress && progress.deviationM <= ROUTE_DEVIATION_LIMIT_M) {
      return;
    }
    // Off-route and staying off it — a player driving away from a destination
    // would otherwise re-search ten times a second.
    const now = performance.now();
    if (fresh && now - routeSearchedAtRef.current < ROUTE_RESEARCH_INTERVAL_MS) {
      return;
    }
    routeSearchedAtRef.current = now;
    routeTargetRef.current = targetKey;
    const found = findGpsRoute(
      gpsGraphForLanes(routeLanesRef.current, routeRoadNamesRef.current),
      { x: snapshot.playerX, z: snapshot.playerZ },
      snapshot.heading,
      target,
    );
    const route = found.points.length > 1 ? found : null;
    // A fresh stop restarts the bar; a re-search for the same stop keeps its
    // denominator, growing it only if the detour left more to drive than the
    // whole run did to begin with.
    const length = route ? routeLengthM(route) : 0;
    setLegRouteTotalM((current) => (fresh ? Math.max(current, length) : length));
    gpsRouteRef.current = route;
    gpsProgressRef.current = route
      ? routeProgress(route, snapshot.playerX, snapshot.playerZ)
      : null;
    setGpsProgress(gpsProgressRef.current);
    setGpsRoute(route);
  }, [gigRef]);

  /**
   * One route from where the car stands to anywhere, over the same cached lane
   * graph the live GPS line uses. Held in a ref so `stepDispatchNow` can reach
   * it without taking the last pose as a dependency.
   */
  const routeToRef = useRef<(to: { x: number; z: number }) => GpsRoute | null>(
    () => null,
  );
  useEffect(() => {
    routeToRef.current = (to) => {
      const pose = lastPoseRef.current;
      if (!pose || !routeLanesRef.current.length) return null;
      const found = findGpsRoute(
        gpsGraphForLanes(routeLanesRef.current, routeRoadNamesRef.current),
        pose,
        lastHeadingRef.current,
        to,
      );
      return found.points.length > 1 ? found : null;
    };
  });

  /**
   * Builds the gig an offer seed names, priced for whatever surge is running
   * at the moment it is offered. The kind is recorded here rather than on
   * acceptance: a player who passes four deliveries has still been shown four
   * deliveries, and the anti-streak rule is about what they were shown.
   */
  const buildOffer = useCallback((seed: number, nowMs: number): Gig | null => {
    const context = driveContextRef.current;
    if (!context) return null;
    const surge = surgeWindowAt(context.surgeSeed, nowMs);
    const built = nextGigFor(
      context.map,
      context.country,
      seed,
      gigKindHistoryRef.current,
      context.allowedKinds,
      surge ? surge.multiplier : 1,
    );
    if (built) {
      gigKindHistoryRef.current = [
        ...gigKindHistoryRef.current,
        built.kind,
      ].slice(-MAX_SAME_KIND_STREAK);
    }
    return built;
  }, []);

  const stepDispatchNow = useCallback(
    (nowMs: number) => {
      if (!driveContextRef.current) return;
      // Dispatch goes quiet only when both hands are full: a job in progress
      // *and* one already queued behind it.
      const busy = gigRef.current !== null && queuedGigRef.current !== null;
      // A poor standing is felt first as an empty afternoon: the dispatcher
      // routes work to drivers people want. Free drive, and any career driver
      // the city has no complaint about, stretch by 1.
      const stretch = dispatchStretchRef.current;
      const step = stepDispatch(dispatchRef.current, nowMs, !busy, stretch);
      dispatchRef.current = step.state;
      setSurge(surgeWindowAt(driveContextRef.current.surgeSeed, nowMs));
      if (step.event === "opened") {
        const built = buildOffer(step.state.offerSeed, nowMs);
        if (built) {
          offerRef.current = built;
          setOffer({ gig: built, offeredAtMs: nowMs });
          setPreviewRoute(routeToRef.current(built.pickup));
        } else {
          // This map cannot produce a gig under the current constraints —
          // close the offer at once rather than showing an empty card.
          dispatchRef.current = resolveOffer(step.state, nowMs, stretch);
        }
      } else if (step.event === "expired") {
        offerRef.current = null;
        setOffer(null);
        setPreviewRoute(null);
        setDispatchToast({ text: "OFFER LOST", tone: "lost" });
      }
    },
    [buildOffer, gigRef, queuedGigRef, setDispatchToast],
  );

  const handleHud = useCallback((snapshot: GameHudSnapshot) => {
    setHud(snapshot);
    const run = careerRunRef.current;
    const last = lastPoseRef.current;
    if (last) {
      const moved = Math.hypot(
        snapshot.playerX - last.x,
        snapshot.playerZ - last.z,
      );
      if (moved > 0 && moved < 40) {
        const rate = run ? run.vehicle.fuelLPerM : FUEL_CONSUMPTION_L_PER_M;
        if (rate > 0) {
          setDriveFuel((fuel) => Math.max(0, fuel - moved * rate));
        }
      }
    }
    lastPoseRef.current = { x: snapshot.playerX, z: snapshot.playerZ };
    lastHeadingRef.current = snapshot.heading;
    updateGpsRoute(snapshot);
    // A tow restarts the session's clock, so fold the old total in rather than
    // letting elapsed time jump backwards. Hoisted out of the career branch:
    // dispatch runs in free drive too, and both read the same clock.
    if (snapshot.simElapsedMs < lastSimElapsedRef.current) {
      dayElapsedBaseRef.current += lastSimElapsedRef.current;
    }
    lastSimElapsedRef.current = snapshot.simElapsedMs;
    const elapsed = dayElapsedBaseRef.current + snapshot.simElapsedMs;
    driveElapsedRef.current = elapsed;
    setDriveElapsedMs(elapsed);
    stepDispatchNow(elapsed);
    if (run && dayActiveRef.current) {
      const remaining = Math.max(0, DAY_LENGTH_MS - elapsed);
      setDayRemainingMs(remaining);
      if (remaining <= 0) {
        // Let an in-flight scene (or the tow overlay) resolve first — a
        // drop-off completing at the whistle still pays.
        if (cutsceneRef.current || towingRef.current) {
          pendingSettleRef.current = true;
        } else {
          endCareerDayRef.current();
        }
      }
    }
  }, [
    updateGpsRoute,
    stepDispatchNow,
    cutsceneRef,
    towingRef,
    careerRunRef,
    dayActiveRef,
    dayElapsedBaseRef,
    lastSimElapsedRef,
    pendingSettleRef,
    endCareerDayRef,
    setDayRemainingMs,
  ]);

  /**
   * Answers the live offer. Accepting takes the job now, or parks it behind the
   * one in hand; passing costs nothing but the wait for the next one, which is
   * deliberate — a hidden acceptance rate would punish the driver for the very
   * choice the game just asked them to make.
   */
  const answerOffer = useCallback((accepted: boolean) => {
    const current = offerRef.current;
    if (!current) return;
    dispatchRef.current = resolveOffer(
      dispatchRef.current,
      driveElapsedRef.current,
      dispatchStretchRef.current,
    );
    offerRef.current = null;
    setOffer(null);
    setPreviewRoute(null);
    if (!accepted) {
      setDispatchToast({ text: "PASSED", tone: "pass" });
      return;
    }
    if (gigRef.current) {
      queuedGigRef.current = current;
      setQueuedGig(current);
      setDispatchToast({ text: "ADDED TO QUEUE", tone: "accept" });
    } else {
      gigRef.current = current;
      setGig(current);
      setDispatchToast({ text: "JOB ACCEPTED", tone: "accept" });
    }
  }, [gigRef, queuedGigRef, setDispatchToast, setGig, setQueuedGig]);

  /**
   * Clears every trace of the last drive's dispatch and arms the next.
   *
   * `stretch` defaults to 1, so a free drive always clears whatever standing
   * the last career day set — there is no reputation out here.
   */
  const resetDispatch = (baseSeed: number, stretch = 1) => {
    dispatchRef.current = createDispatch(baseSeed);
    dispatchStretchRef.current = stretch;
    driveElapsedRef.current = 0;
    dayElapsedBaseRef.current = 0;
    lastSimElapsedRef.current = 0;
    setDriveElapsedMs(0);
    setSurge(null);
    setPreviewRoute(null);
    setSessionEarnings(0);
    setPayoutGain(null);
    offerRef.current = null;
    setOffer(null);
    queuedGigRef.current = null;
    setQueuedGig(null);
    setDispatchToast(null);
  };

  // F takes the job, G passes on it. Q and E stay the turn indicators: an offer
  // arrives while you are driving, which is exactly when you want to signal.
  useEffect(() => {
    if (view !== "driving") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !offerRef.current) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.code === "KeyF") {
        event.preventDefault();
        answerOffer(true);
      } else if (event.code === "KeyG") {
        event.preventDefault();
        answerOffer(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, answerOffer]);

  /*
   * M opens the whole city, and closes it again.
   *
   * It lives here rather than in `BabylonGameSession`'s key switch because the
   * map is app state — the session knows nothing about routes or places — and
   * because that switch has no test coverage at all.
   *
   * A *bubble* listener, like F and G. `ConfirmDialog` installs a capture-phase
   * handler that swallows every key, and capture listeners on `window` run in
   * registration order — so a capture-phase M would fire first and open the map
   * behind an open dialog. Bubbling, it never runs while one is up.
   */
  useEffect(() => {
    if (view !== "driving") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== "KeyM") return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      // The pause card is its own screen, at the same layer and painted under
      // this one. Nothing good happens with both up.
      if (paused) return;
      event.preventDefault();
      setMapOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, paused]);

  /*
   * One thing outranks the map, and it yields for as long as that lasts —
   * which is why this is derived rather than a close.
   *
   * `paused`: GameCanvas renders the pause dialog at `DRIVE_LAYER.action` and
   * so does this, but the app's subtree paints after the session's — so a map
   * left showing would float on top of the pause screen. Covers a hidden tab
   * too, which pauses. Resuming brings the map straight back, because the
   * player never asked to close it. Leaving the drive is the only thing that
   * actually clears the flag — see `beginDrive`.
   *
   * An offer no longer counts. It used to (#241): both sat at `action` and the
   * offer renders first, so a map over it buried ACCEPT for the whole fifteen
   * seconds on touch — but yielding meant a job offer could snatch away a map
   * the player had just opened, and M did nothing at all while one was up.
   * Neither has to happen: the map stays, and the offer moves *into* it rather
   * than over it, which is where it is best read anyway — `previewRoute` draws
   * the dashed line out to its pickup on the map it is now docked in.
   */
  const mapVisible = mapOpen && !paused;

  useEffect(() => {
    const sync = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (!payoutGain) return;
    const timer = window.setTimeout(() => setPayoutGain(null), 1_250);
    return () => window.clearTimeout(timer);
  }, [payoutGain, setPayoutGain]);

  useEffect(() => {
    if (!dispatchToast) return;
    const timer = window.setTimeout(() => setDispatchToast(null), 1700);
    return () => window.clearTimeout(timer);
  }, [dispatchToast, setDispatchToast]);

  // Arriving at a gig stop now means actually stopping there: inside the
  // arrival radius at walking pace. That starts the matching interaction
  // cutscene (rider boards, driver runs the errand); the gig state flips when
  // its `done` event lands — no more drive-by pickups.
  useEffect(() => {
    if (view !== "driving" || !hud || !gig || gig.state === "delivered") return;
    if (cutscene || towing || hud.speed > 1) return;
    const target = gigTarget(gig);
    if (!target) return;
    const distance = Math.hypot(
      hud.playerX - target.x,
      hud.playerZ - target.z,
    );
    if (distance > GIG_ARRIVAL_RADIUS_M) return;
    if (gig.state === "enroute_pickup") {
      beginCutscene(
        gig.kind === "passenger" ? "board" : "food_pickup",
        target.id,
        gig.pickup.id,
      );
    } else {
      beginCutscene(
        gig.kind === "passenger" ? "exit" : "food_dropoff",
        target.id,
        gig.pickup.id,
      );
    }
  }, [view, hud, gig, cutscene, towing, beginCutscene]);

  /**
   * Presses one of the drive session's own keys.
   *
   * Camera and pause belong to `BabylonGameSession`, which listens on the
   * window; `GameCanvas` comes through `next/dynamic` so there is no handle to
   * call a method on. Synthesising the keystroke is the route this file already
   * takes to close a dialog.
   */
  const pressDriveKey = useCallback((code: string) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  }, []);

  const handleUiGamepadBack = useCallback(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return;
    }
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
      return;
    }
    if (view !== "launcher") setView("launcher");
  }, [mobileMenuOpen, view]);

  useGamepadUiNavigation(view !== "driving", handleUiGamepadBack);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadProgress();
      setProgress(loaded);
      setDestinationId(loaded.lastDestinationId);
      setCamera(loaded.preferredCamera);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  /**
   * The one place money is taken for a violation, whoever wrote it — the
   * officer at the window, the camera over the junction, or the app's own
   * citation for striking someone.
   *
   * Career fines are day-local like every other career charge and may push the
   * day negative; free drive debits the country wallet and persists. Those two
   * branches were copied at all three sites, which is exactly where they would
   * have drifted apart. Stamping the shared clock here means it marks money
   * actually moving rather than an intention to charge.
   */
  const chargeFine = useCallback(
    (amount: number, reason: string, issuedBy: "patrol" | "camera") => {
      lastAnyFineAtRef.current = Date.now();
      if (careerRunRef.current) {
        chargeCareer(amount, (log) => ({
          ...log,
          finesTotal: log.finesTotal + amount,
        }));
      } else {
        const fined = debit(progress, driveCountry.id, amount);
        setProgress(fined);
        saveProgress(fined);
      }
      setFineToast({ amount, reason, issuedBy });
    },
    [
      progress,
      driveCountry,
      chargeCareer,
      lastAnyFineAtRef,
      setFineToast,
      careerRunRef,
    ],
  );

  const activeSteeringSide = driveCountry.defaultSteeringSide;

  // The car is a write-off: fade to the tow overlay, debit the repair bill,
  // snap the car back to its spawn repaired, and fade back in. No button, no
  // modal — the drive itself never stops being playable for long.
  const beginTow = useCallback(() => {
    if (towingRef.current) return;
    // A scene in flight is torn down by the session's reset; drop the app
    // side too so nothing waits on a `done` that will never come.
    clearCutscene();
    // A write-off is billed for all 100 points at the roadside premium, so it
    // always costs strictly more than driving into a shop would have. Stashed
    // in state rather than re-derived by the overlay below: the two used to
    // read the same flat constant independently, which was harmless only for
    // as long as the price was constant.
    const fee = repairPrice(driveCountry, FULL_CONDITION_PCT, "tow");
    startTow(fee);
    if (careerRunRef.current) {
      // Day-local money: the repair bill can push the day negative.
      chargeCareer(fee, (log) => ({
        ...log,
        repairsTotal: log.repairsTotal + fee,
      }));
    } else {
      const paid = debit(progress, driveCountry.id, fee);
      setProgress(paid);
      saveProgress(paid);
    }
    const reduced = progress.accessibility.reducedMotion;
    window.setTimeout(() => {
      pulseTowReset();
    }, reduced ? 80 : 900);
    window.setTimeout(() => {
      endTow();
      // The whistle blew during the tow: settle now that the overlay is gone.
      if (pendingSettleRef.current && careerRunRef.current) {
        pendingSettleRef.current = false;
        endCareerDayRef.current();
      }
    }, reduced ? 500 : 2400);
  }, [
    progress,
    driveCountry,
    clearCutscene,
    chargeCareer,
    startTow,
    pulseTowReset,
    endTow,
    towingRef,
    careerRunRef,
    pendingSettleRef,
    endCareerDayRef,
  ]);

  // Collision events wear the car down (and striking a person is cited on the
  // spot); a fine event reaches us only when a patrol witnessed the violation.
  // Both debit the local wallet and flash the toast, mirroring the refuel path.
  const handleGameEvent = useCallback(
    (event: GameRuntimeEvent) => {
      if (event.type === "ready") {
        // The scene is built and GameCanvas's overlay has cleared, so the title
        // now has somewhere to land. Anchored to the day clock rather than to
        // wall time so it fades on the same clock it is measured against.
        setDayIntroFromMs(dayElapsedBaseRef.current + lastSimElapsedRef.current);
        return;
      }
      // A rider in the back sees everything, witnessed or not, so the tip reads
      // the rule stream rather than the fine stream. Every violation surfaces
      // exactly once as coaching/collision; the `fine` that may follow
      // is the same offence again, which is why it is excluded here.
      if (
        (event.type === "coaching" || event.type === "collision") &&
        gigRef.current?.state === "carrying"
      ) {
        carryViolationsRef.current += 1;
      }
      if (event.type === "cutscene") {
        const active = cutsceneRef.current;
        if (!active || event.nonce !== active.nonce) return;
        if (event.phase === "cite") {
          // The officer is at the window. The amount was settled when the stop
          // was staged — a speeding ticket is priced off the excess, everything
          // else is the flat fine.
          chargeFine(
            pendingFineAmountRef.current ?? FINE_BY_COUNTRY[driveCountry.id],
            pendingFineReasonRef.current ??
              fineReason(undefined, undefined, driveCountry),
            "patrol",
          );
          return;
        }
        if (event.phase === "repair") {
          // The bonnet is up: pay and mend atomically, the same contract the
          // pump step keeps. An aborted scene after this point was still a
          // completed repair; before it, nothing happened.
          //
          // Damage comes off the ref, not the `carCondition` state: the ref is
          // what the collision handler decrements, and the state can be a
          // render behind a shunt taken on the way in.
          const damage = Math.max(
            0,
            FULL_CONDITION_PCT - carConditionRef.current,
          );
          const price = repairPrice(driveCountry, damage, "shop");
          if (careerRunRef.current) {
            chargeCareer(price, (log) => ({
              ...log,
              repairsTotal: log.repairsTotal + price,
            }));
          } else {
            const paid = debit(progress, driveCountry.id, price);
            setProgress(paid);
            saveProgress(paid);
          }
          // No session reset, unlike the tow — the car is mended where it
          // stands, in the bay it drove into.
          carConditionRef.current = FULL_CONDITION_PCT;
          setCarCondition(FULL_CONDITION_PCT);
          return;
        }
        if (event.phase === "pump") {
          // The nozzle is in: pay and fill atomically, and stretch the fuel
          // bar's transition across the fill window so the gauge pours while
          // the driver pumps. An aborted scene after this point was still a
          // completed purchase; before it, nothing happened.
          const run = careerRunRef.current;
          if (run) {
            // Career fuel is integer, priced per vehicle, and never gated on
            // being able to afford it — the charge may push the day negative.
            // A roadside rescue fills the whole tank at a premium plus the
            // call-out fee: the price of not planning around the gauge.
            const roadside = active.kind === "roadside_refuel";
            const missing = Math.max(0, run.vehicle.tankL - driveFuel);
            // How much was bought is the fraction the scene was staged with —
            // which is the whole missing tank for a full fill or a rescue, and
            // less than that for a cash-only top-up. Carrying it on the request
            // is what saves a second channel telling the two offers apart, and
            // it survives the scene being restaged.
            const litres = roadside
              ? missing
              : Math.min(missing, (active.fuelFillFraction ?? 1) * run.vehicle.tankL);
            const cost =
              Math.round(
                litres *
                  FUEL_PRICE_PER_LITRE_BY_COUNTRY[run.city.countryId] *
                  run.vehicle.fuelPriceFactor *
                  (roadside ? ROADSIDE_PRICE_FACTOR : 1),
              ) +
              (roadside ? ROADSIDE_CALLOUT_FEE_BY_COUNTRY[run.city.countryId] : 0);
            chargeCareer(cost, (log) => ({
              ...log,
              fuelSpendTotal: log.fuelSpendTotal + cost,
            }));
            setFuelFillMs(event.durationMs ?? 0);
            setDriveFuel(Math.min(run.vehicle.tankL, driveFuel + litres));
            return;
          }
          // Free drive pours only what the wallet covers, so an empty-enough
          // wallet buys a part tank instead of nothing at all. Re-priced here
          // against the wallet as it stands rather than trusting the figure the
          // prompt quoted: a citation can still land mid-scene (a pedestrian
          // walking into a parked car is not gated on the cutscene), and this
          // way that re-prices the fill instead of overdrawing the wallet.
          const purchased = fuelPurchase(
            driveCountry.id,
            Math.max(0, TANK_CAPACITY_L - driveFuel),
            progress.walletByCountry[driveCountry.id],
          );
          const filled = driveFuel + purchased.litres;
          const refueled = setFuel(
            debit(progress, driveCountry.id, purchased.cost),
            driveCountry.id,
            filled,
          );
          setProgress(refueled);
          saveProgress(refueled);
          setFuelFillMs(event.durationMs ?? 0);
          setDriveFuel(filled);
          return;
        }
        if (event.phase === "done") {
          clearCutscene();
          if (active.kind === "board" || active.kind === "food_pickup") {
            setGig((current) =>
              current && current.state === "enroute_pickup"
                ? { ...current, state: "carrying" }
                : current,
            );
            // The carrying leg starts here in both modes: free drive tips too
            // now, and both the par clock and the rider's patience run from
            // the moment the job is actually in the car.
            const elapsed =
              dayElapsedBaseRef.current + lastSimElapsedRef.current;
            startCarrying(elapsed);
          } else if (active.kind === "exit" || active.kind === "food_dropoff") {
            const run = careerRunRef.current;
            const current = gigRef.current;
            if (
              run &&
              current &&
              current.state === "carrying" &&
              paidGigRef.current !== current.id
            ) {
              // Career pays synchronously in the scene's done event (not via
              // the free-drive payout effect) so a drop-off finishing right at
              // the whistle is credited before the settlement below runs.
              paidGigRef.current = current.id;
              const { gross, net } = careerFare(
                current.reward,
                current.kind,
                run.vehicle,
                ratingFareFactor(run.ratingStanding),
              );
              // Tips are commission-free either way, but the two kinds settle
              // differently: a food order tipped when it was placed, and may
              // add something if it arrived hot; a rider decides on the way and
              // pays for how the trip went. Late still pays the fare — no hard
              // fail.
              const parMs = gigParMs(
                Math.hypot(
                  current.dropoff.x - current.pickup.x,
                  current.dropoff.z - current.pickup.z,
                ),
                run.vehicle.paceFactor,
              );
              const elapsedNow =
                dayElapsedBaseRef.current + lastSimElapsedRef.current;
              const since = carryingSinceRef.current;
              const carriedMs = since === null ? parMs : elapsedNow - since;
              const onTime = since !== null && carriedMs <= parMs;
              const tip = gigTipFor(
                current,
                gross,
                carriedMs,
                parMs,
                onTime,
                carryViolationsRef.current,
                ratingTipFactor(run.ratingStanding),
              );
              // The same trip, judged a second way. Deliberately silent: the
              // stars never reach the HUD, the toast or the payout call-out —
              // a driver reads their standing on the career page after the day
              // is over, or not at all.
              const stars = gigRating(current.kind, current.seed, {
                promptness: ridePromptness(carriedMs, parMs),
                violations: carryViolationsRef.current,
              });
              endCarryingLeg();
              dayCashRef.current += net + tip;
              setDayCash(dayCashRef.current);
              announcePayout(net, tip);
              dayLogRef.current = {
                ...dayLogRef.current,
                grossFares: dayLogRef.current.grossFares + gross,
                netFares: dayLogRef.current.netFares + net,
                tips: dayLogRef.current.tips + tip,
                gigsCompleted: dayLogRef.current.gigsCompleted + 1,
                gigsOnTime: dayLogRef.current.gigsOnTime + (onTime ? 1 : 0),
                ratings:
                  stars === null
                    ? dayLogRef.current.ratings
                    : [...dayLogRef.current.ratings, stars],
              };
              // The next job is whatever was accepted while this one ran —
              // nothing is conjured on completion any more. With an empty queue
              // the driver goes idle until dispatch offers again.
              promoteQueuedGig();
            } else if (!run) {
              setGig((existing) =>
                existing && existing.state === "carrying"
                  ? { ...existing, state: "delivered" }
                  : existing,
              );
            }
          }
          // The day ended while this scene played out: settle now that its
          // durable effects (including the payout above) have landed.
          if (pendingSettleRef.current && careerRunRef.current && !towingRef.current) {
            pendingSettleRef.current = false;
            endCareerDayRef.current();
          }
        }
        return;
      }
      if (event.type === "collision") {
        const evidence = event.evidence ?? {};
        const damage = damageForCollision(evidence);
        if (damage > 0 && !towingRef.current) {
          const next = Math.max(0, carConditionRef.current - damage);
          carConditionRef.current = next;
          setCarCondition(next);
          if (next <= 0) beginTow();
        }
        const roadUser = evidence.roadUserType;
        if (roadUser === "pedestrian" || roadUser === "cyclist") {
          const now = Date.now();
          if (now - lastPedFineAtRef.current < 4000) return;
          if (now - lastAnyFineAtRef.current < FINE_MIN_SPACING_MS) return;
          lastPedFineAtRef.current = now;
          chargeFine(
            FINE_BY_COUNTRY[driveCountry.id],
            roadUser === "cyclist"
              ? "striking a cyclist"
              : "striking a pedestrian",
            "patrol",
          );
        }
        return;
      }
      if (event.type !== "fine") return;
      const now = Date.now();
      if (now - lastAnyFineAtRef.current < FINE_MIN_SPACING_MS) return;
      if (now - lastFineAtRef.current < 8000) return;
      const speeding = event.ruleCode === "speeding";
      if (speeding && now - lastSpeedingFineAtRef.current < SPEEDING_STOP_GRACE_MS) {
        return;
      }
      // A scene already running (or a tow) means the violation goes uncited
      // rather than queueing behind it — every clock below is stamped only once
      // the citation is really under way, so the next one is not swallowed too.
      if (cutsceneRef.current || towingRef.current) return;
      lastFineAtRef.current = now;
      if (speeding) lastSpeedingFineAtRef.current = now;
      // Price it here, not at `cite`: this is where the measurement is. A
      // speeding ticket scales with the excess; every other violation is
      // binary and pays the flat fine.
      const excessMps = speeding ? speedingExcessMps(event.evidence) : null;
      const amount =
        excessMps === null
          ? null
          : speedingFine(driveCountry, postedSpeed(excessMps, driveCountry));
      const reason = fineReason(event.ruleCode, event.evidence, driveCountry);
      if (event.issuedBy === "camera") {
        // Nobody to pull you over, so there is no scene and no `cite` step to
        // carry the amount to: the camera posts the ticket where the driver
        // stands, the way striking someone is charged. The pull-over is the
        // better moment when there is an officer to stage it, which is why
        // GameCanvas only reaches for a camera when there is not.
        chargeFine(amount ?? FINE_BY_COUNTRY[driveCountry.id], reason, "camera");
        return;
      }
      // The stop *is* the citation: stage the pull-over and let its `cite`
      // step debit, the same way the pump scene pays for its fuel.
      lastAnyFineAtRef.current = now;
      pendingFineAmountRef.current = amount;
      pendingFineReasonRef.current = reason;
      beginCutscene("pullover");
    },
    [
      progress,
      driveCountry,
      driveFuel,
      beginTow,
      beginCutscene,
      clearCutscene,
      chargeCareer,
      chargeFine,
      promoteQueuedGig,
      announcePayout,
      carConditionRef,
      cutsceneRef,
      towingRef,
      lastAnyFineAtRef,
      lastFineAtRef,
      lastPedFineAtRef,
      lastSpeedingFineAtRef,
      pendingFineAmountRef,
      pendingFineReasonRef,
      setCarCondition,
      setFuelFillMs,
      careerRunRef,
      dayCashRef,
      dayElapsedBaseRef,
      dayLogRef,
      endCareerDayRef,
      lastSimElapsedRef,
      pendingSettleRef,
      setDayCash,
      setDayIntroFromMs,
      carryViolationsRef,
      carryingSinceRef,
      endCarryingLeg,
      gigRef,
      paidGigRef,
      setGig,
      startCarrying,
    ],
  );

  // Auto-dismiss the fine toast a few seconds after it appears.
  useEffect(() => {
    if (!fineToast) return;
    const timer = window.setTimeout(() => setFineToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [fineToast, setFineToast]);

  // On a phone the bottom of the screen belongs to thumbs. The HUD has to know,
  // because it used to lay the wallet card straight over the steering control
  // and the minimap straight over the pedals — and since both panels are
  // `pointerEvents: "none"`, nothing failed: the controls stayed tappable and
  // simply could not be seen.
  useEffect(() => {
    applyViewportFitCover();
    // iPhone Safari has no Fullscreen API for anything but <video>, so the
    // in-drive fullscreen control correctly hides itself there — and Safari
    // only hides its own toolbars in response to scrolling, which the drive
    // screen cannot do. Adding the game to the Home Screen is genuinely the
    // only way to get the browser chrome off the screen on that device, so it
    // has to be something the player is told about rather than guesses.
    const sync = () => {
      setTouchFirst(readInputCapabilities().touchFirst);
      setNeedsHomeScreenForFullscreen(!canFullscreen() && !isStandaloneDisplay());
    };
    sync();
    const query = window.matchMedia("(pointer: coarse)");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Career only: a tank run dry summons roadside service instead of leaving a
  // dead throttle — the scene immobilizes the car and its pump event charges
  // the premium (which may push the day into the red). Free drive keeps the
  // classic coast-to-a-stop + wallet-gated station refuel.
  useEffect(() => {
    if (!careerRun || careerRun.vehicle.tankL <= 0) return;
    if (view !== "driving" || driveFuel > 0 || cutscene || towing) return;
    beginCutscene("roadside_refuel", undefined, undefined, 1);
  }, [careerRun, view, driveFuel, cutscene, towing, beginCutscene]);
  const activeFreeDrive = getFreeDrive(destination.freeDriveId);
  const runtimeMap = getMapPack(activeFreeDrive.mapId);
  // `handleHud` searches the lane graph but is a `[]`-deps callback, so the
  // active city reaches it the way `gig` does — through a ref kept in step.
  useEffect(() => {
    routeLanesRef.current = runtimeMap.laneGraph.lanes;
    routeRoadNamesRef.current = runtimeMap.roadNames;
  }, [runtimeMap]);
  // A career day is the same open-world scenario under a per-day identity and
  // seed, so the remount key rolls the world over between days and a retried
  // day replays identically.
  const runtimeScenario: DriveScenario = careerRun
    ? buildCareerDayScenario(
        activeFreeDrive,
        careerRun.city.day,
        careerDayTrafficSeed(
          careerRun.slice.careerSeed,
          careerRun.city.day,
          careerCityIndex(careerRun.city.destinationId),
        ),
      )
    : buildFreeDriveScenario(activeFreeDrive);

  const themeDestination = view === "driving" ? driveDestination : destination;
  const themeStyle = {
    "--destination-accent": themeDestination.visualTheme.accent,
    "--destination-sky": themeDestination.visualTheme.sky,
    "--destination-ground": themeDestination.visualTheme.ground,
    "--destination-road": themeDestination.visualTheme.road,
    "--destination-lane": themeDestination.visualTheme.laneMarking,
  } as CSSProperties;

  useEffect(() => {
    if (!hydrated || window.innerWidth > 780) return;
    const selected = destinationRefs.current.get(destinationId);
    if (typeof selected?.scrollIntoView === "function") {
      selected.scrollIntoView({
        behavior: progress.accessibility.reducedMotion ? "auto" : "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [destinationId, hydrated, progress.accessibility.reducedMotion]);

  // Pay out a completed delivery and hand over whatever was queued behind it.
  // Guarded by paidGigRef so re-renders can't double-credit the same gig. Free
  // drive only: career gigs are paid synchronously in the cutscene done handler
  // so a drop-off at the whistle lands before settlement.
  useEffect(() => {
    if (careerRunRef.current) return;
    if (!gig || gig.state !== "delivered" || paidGigRef.current === gig.id) {
      return;
    }
    paidGigRef.current = gig.id;
    // Free drive takes the fare whole — no vehicle factor, no commission — and
    // the reference car's pace, so par is measured at a factor of one.
    const parMs = gigParMs(
      Math.hypot(gig.dropoff.x - gig.pickup.x, gig.dropoff.z - gig.pickup.z),
      1,
    );
    const since = carryingSinceRef.current;
    const carriedMs = since === null ? parMs : driveElapsedRef.current - since;
    const onTime = since !== null && carriedMs <= parMs;
    const tip = gigTipFor(
      gig,
      gig.reward,
      carriedMs,
      parMs,
      onTime,
      carryViolationsRef.current,
    );
    endCarryingLeg();
    const settled = credit(progress, driveCountry.id, gig.reward + tip);
    setProgress(settled);
    saveProgress(settled);
    announcePayout(gig.reward, tip);
    promoteQueuedGig();
  }, [
    gig,
    progress,
    driveCountry,
    promoteQueuedGig,
    announcePayout,
    careerRunRef,
    carryViolationsRef,
    carryingSinceRef,
    endCarryingLeg,
    paidGigRef,
  ]);

  const chooseDestination = (id: DestinationId) => {
    setDestinationId(id);
  };

  const beginDrive = (nextDestinationId: DestinationId) => {
    // All three synchronously, inside the click that got us here: Safari only
    // honours an audio resume and a play() in the same task as the gesture that
    // triggered them, and the fullscreen/orientation request has the identical
    // transient-activation rule. None of them can move into an effect or behind
    // an await.
    primeAudioContext();
    music.start(nextDestinationId);
    if (touchFirst) requestImmersiveLandscape(document.documentElement);
    const nextDestination = getDestinationProfile(nextDestinationId);
    const nextCountryId = nextDestination.countryId;
    const committedProgress: PlayerProgressV2 = {
      ...progress,
      lastDestinationId: nextDestinationId,
      preferredCamera: camera,
    };
    setProgress(committedProgress);
    saveProgress(committedProgress);
    setDestinationId(nextDestinationId);
    setDriveFuel(committedProgress.fuelByCountry[nextCountryId]);
    lastPoseRef.current = null;
    const nextFreeDrive = getFreeDrive(nextDestination.freeDriveId);
    gigKindHistoryRef.current = [];
    paidGigRef.current = null;
    // A drive opens with an offer waiting rather than a job assigned — the
    // first HUD snapshot lands at t=0, which is when dispatch fires.
    driveContextRef.current = {
      map: getMapPack(nextFreeDrive.mapId),
      country: getCountryProfile(nextCountryId),
      allowedKinds: ["delivery", "passenger"],
      surgeSeed: nextFreeDrive.trafficSeed,
    };
    resetDispatch(nextFreeDrive.trafficSeed);
    gigRef.current = null;
    setGig(null);
    setHud(null);
    setPaused(false);
    setMapOpen(false);
    setCarCondition(FULL_CONDITION_PCT);
    endTow();
    clearCutscene();
    setView("driving");
  };

  // The actual career-day teardown, run once the player confirms the exit.
  // Boundary saves only: nothing was written since the morning, so quitting
  // simply redoes the day (same seeds, same garage cash).
  const finishCareerDayExit = () => {
    setPendingConfirm(null);
    dayActiveRef.current = false;
    pendingSettleRef.current = false;
    careerRunRef.current = null;
    setCareerRun(null);
    setGig(null);
    setPaused(false);
    setMapOpen(false);
    clearCutscene();
    music.stop();
    suspendAudioContext();
    setView("career-garage");
  };

  const exitDrive = () => {
    if (careerRunRef.current) {
      // Ending a career day mid-run discards it — confirm first, via the
      // in-game dialog rather than a native prompt.
      setPendingConfirm("end-day");
      return;
    }
    // Persist the current tank level back to the country's saved fuel.
    const persisted = setFuel(progress, driveCountry.id, driveFuel);
    setProgress(persisted);
    saveProgress(persisted);
    setGig(null);
    setPaused(false);
    setMapOpen(false);
    clearCutscene();
    music.stop();
    // Parked, not closed — the player will almost certainly start another drive,
    // and a closed context can never be reopened.
    suspendAudioContext();
    setView("launcher");
  };

  // ---- Career Mode flow --------------------------------------------------
  // The playable slice, when one exists and decoded cleanly.
  const careerSlice =
    progress.career !== null && progress.career.state !== "corrupt"
      ? progress.career
      : null;
  // Everything the UI shows — cash, rent, debt, the currency it is all priced
  // in — belongs to the city the driver is standing in, not to the career.
  const careerCity = careerSlice ? activeCity(careerSlice) : null;
  const careerCountry = careerCity
    ? getCountryProfile(careerCity.countryId)
    : null;
  // Every tier is live; the owned bicycle (rent 0) is the floor that makes a
  // broke garage impossible to soft-lock.
  const lockedCareerVehicles: Partial<Record<CareerVehicleId, string>> = {};

  /**
   * Persists the garage's selection. Every path that moves it comes through
   * here — the driver tapping a card, and the automatic walk-down alike — so
   * what storage holds is always the ride the garage is showing.
   *
   * `base` is for the callers that are already rewriting progress this tick (a
   * career write, a purchase): passing their result folds both changes into a
   * single save instead of racing two.
   */
  const commitGarageVehicle = (
    vehicleId: CareerVehicleId,
    base: PlayerProgressV2 = progress,
  ) => {
    const next =
      base.lastCareerVehicleId === vehicleId
        ? base
        : { ...base, lastCareerVehicleId: vehicleId };
    setProgress(next);
    saveProgress(next);
  };

  const startCareer = () => {
    // App-layer randomness is fine (the sim's no-RNG rule protects replays,
    // which key off the seed we mint here, not off how we minted it).
    const careerSeed =
      (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    // The ladder decides where a career opens, not whatever city the launcher
    // happens to be showing.
    const slice = createCareerSlice({
      destinationId: CAREER_START_CITY,
      careerSeed,
    });
    // A career with no history has no choice to keep, so day 1 gets the opening
    // the catalog nominates rather than whatever the last career ended on.
    commitGarageVehicle(
      garageDefaultVehicle(activeCity(slice), DEFAULT_GARAGE_VEHICLE_ID),
      writeCareer(progress, slice),
    );
    setView("career-garage");
  };

  const resetCareer = (nextView: View = "launcher") => {
    const cleared = clearCareer(progress);
    setProgress(cleared);
    saveProgress(cleared);
    setLastSettlement(null);
    setView(nextView);
  };

  const beginCareerDay = (vehicleId: CareerVehicleId) => {
    if (!careerSlice || !careerCity) return;
    const vehicle = getCareerVehicle(vehicleId);
    const rent = vehicleRent(vehicle, careerCity);
    if (careerCity.cash < rent) return;
    // Synchronously, inside the click: Safari only honours audio in the
    // gesture's own task, and fullscreen/orientation the same (as beginDrive).
    primeAudioContext();
    music.start(careerCity.destinationId);
    if (touchFirst) requestImmersiveLandscape(document.documentElement);
    const destinationProfile = getDestinationProfile(careerCity.destinationId);
    const run: CareerRun = {
      slice: careerSlice,
      city: careerCity,
      vehicleId,
      vehicle,
      ratingStanding: ratingStanding(averageRating(cityRating(careerCity))),
    };
    careerRunRef.current = run;
    setCareerRun(run);
    // Rent is prepaid into the day-local cash; the slice itself is untouched
    // until settlement (mid-day quits revert to the morning).
    dayCashRef.current = careerCity.cash - rent;
    setDayCash(dayCashRef.current);
    dayLogRef.current = { ...emptyDayLog(), rentPaid: rent };
    dayElapsedBaseRef.current = 0;
    lastSimElapsedRef.current = 0;
    setDayRemainingMs(DAY_LENGTH_MS);
    // Withheld until the new day's session reports ready. A tow does not clear
    // it, so the title cannot come back mid-day: `reset()` reuses the session
    // and `ready` fires once per mount.
    setDayIntroFromMs(null);
    pendingSettleRef.current = false;
    dayActiveRef.current = true;
    setDestinationId(careerCity.destinationId);
    // Rentals come with a full tank, included in the rent; nothing persists.
    setDriveFuel(vehicle.tankL);
    lastPoseRef.current = null;
    const dayGigSeed = careerGigSeedBase(
      careerSlice.careerSeed,
      careerCity.day,
      careerCityIndex(careerCity.destinationId),
    );
    gigKindHistoryRef.current = [];
    paidGigRef.current = null;
    driveContextRef.current = {
      map: getMapPack(getFreeDrive(destinationProfile.freeDriveId).mapId),
      country: getCountryProfile(careerCity.countryId),
      // Career vehicles gate what may be OFFERED: a bicycle courier is never
      // shown a rideshare request rather than being left to decline one.
      allowedKinds: vehicle.allowedGigKinds,
      surgeSeed: dayGigSeed,
    };
    resetDispatch(dayGigSeed, ratingSearchStretch(run.ratingStanding));
    gigRef.current = null;
    setGig(null);
    // `endCarryingLeg` also zeroes carryViolationsRef, which beginCareerDay
    // never touched directly before this port existed — harmless, since
    // nothing reads it before the day's first `startCarrying` overwrites it
    // anyway (a quit day leaves both stale in exactly the same way).
    endCarryingLeg();
    setHud(null);
    setPaused(false);
    setMapOpen(false);
    setCarCondition(FULL_CONDITION_PCT);
    endTow();
    clearCutscene();
    setLastSettlement(null);
    setView("driving");
  };

  const endCareerDay = () => {
    const run = careerRunRef.current;
    if (!run || !dayActiveRef.current) return;
    dayActiveRef.current = false;
    pendingSettleRef.current = false;
    const ledger = dayLogRef.current;
    const settlement = settleDay({
      cash: dayCashRef.current,
      ledger,
      loan: run.city.loan,
      finalNotice: run.city.finalNotice,
      platformFee: PLATFORM_FEE_BY_COUNTRY[run.city.countryId],
      rule: run.slice.rule,
    });
    // Standing is settled beside the money, not inside it: the two endings are
    // independent, and either one on its own wipes the city.
    const rating = settleRating(cityRating(run.city), ledger.ratings);
    const wiped = settlement.outcome === "game_over" || rating.verdict === "ended";
    const nextSlice = applySettlement(run.slice, ledger, settlement, rating);
    const nextCity = activeCity(nextSlice);
    setLastSettlement({
      result: settlement,
      slice: nextSlice,
      city: nextCity,
      morningCity: run.city,
      rating,
    });
    // The one mid-career save point: day boundaries only. Tomorrow keeps
    // today's ride, unless the night's reckoning put it out of reach.
    commitGarageVehicle(
      garageDefaultVehicle(
        nextCity,
        // A wipe hands back a fresh sheet with the fleet repossessed: there is
        // no run left for a choice to belong to, so it reopens like a new
        // career rather than on whatever the lost one was driving.
        wiped ? DEFAULT_GARAGE_VEHICLE_ID : garageVehicleId,
      ),
      writeCareer(progress, nextSlice),
    );
    careerRunRef.current = null;
    setCareerRun(null);
    setGig(null);
    setPaused(false);
    setMapOpen(false);
    clearCutscene();
    // Music keeps playing across the ledger and garage — they are part of the
    // run, and the next day's start() will pick a fresh track.
    setView(wiped ? "career-over" : "career-ledger");
  };
  useEffect(() => {
    endCareerDayRef.current = endCareerDay;
  });

  // Buying a vehicle outright. A garage-boundary save, like settlement. The
  // bought vehicle joins THIS city's fleet and rents free here forever after —
  // it does not follow you to the next city.
  const buyVehicle = (vehicleId: CareerVehicleId) => {
    if (!careerSlice) return;
    const vehicle = getCareerVehicle(vehicleId);
    if (!canBuyVehicle(careerSlice, vehicle)) return;
    const bought = applyVehiclePurchase(careerSlice, vehicle);
    // The purchase is the one thing that spends cash without leaving the
    // garage, so it is also the one place a standing selection can go out of
    // reach while the driver is looking at it. Re-walk rather than leave a card
    // highlighted that Start Day would refuse.
    commitGarageVehicle(
      garageDefaultVehicle(activeCity(bought), garageVehicleId),
      writeCareer(progress, bought),
    );
  };

  // Flying to a city already reached: free, instant, and reversible. A garage
  // boundary like every other career write.
  const travelToCity = (destinationId: DestinationId) => {
    if (!careerSlice) return;
    const moved = travelTo(careerSlice, destinationId);
    setDestinationId(destinationId);
    setLastSettlement(null);
    // A city you have already run resumes exactly as you left it, so your
    // choice comes with you — priced against that city's cash, not the one you
    // flew out of.
    commitGarageVehicle(
      garageDefaultVehicle(activeCity(moved), garageVehicleId),
      writeCareer(progress, moved),
    );
    setView("career-garage");
  };

  // The onward ticket. Debits the city you are leaving and opens the next one
  // on a fresh sheet — nothing crosses, which is the whole point of the ladder.
  const buyTicket = () => {
    if (!careerSlice || !canBuyTicket(careerSlice)) return;
    setPendingConfirm(null);
    const flown = applyTicket(careerSlice);
    setDestinationId(flown.currentDestinationId);
    setLastSettlement(null);
    // Landing somewhere new is starting from nothing again — a fresh sheet with
    // its own float and no fleet, so it opens the way a new career does rather
    // than carrying a choice that was earned somewhere else.
    commitGarageVehicle(
      garageDefaultVehicle(activeCity(flown), DEFAULT_GARAGE_VEHICLE_ID),
      writeCareer(progress, flown),
    );
    setView("career-garage");
  };

  // Career interstitials need their backing state; a stale view (an abandoned
  // or missing career) falls back to something renderable instead of a blank
  // shell. Derived, not redirected — the underlying `view` self-corrects on
  // the next explicit navigation.
  const effectiveView: View =
    view === "career-garage" && !careerSlice
      ? "launcher"
      : view === "career-ledger" && !lastSettlement
        ? careerSlice
          ? "career-garage"
          : "launcher"
        : view === "career-over" && !careerSlice
          ? "launcher"
          : view === "career-travel" && !careerSlice
            ? "launcher"
            : view;

  // The launcher hero mirrors what the primary action will actually play: a
  // running career's locked city, otherwise the free-drive pick.
  const launcherInCareer = gameMode === "career";
  // In career mode the hero mirrors the run's city — the one you are in, or the
  // ladder's opener before a career exists — never the free-drive selection.
  const careerLauncherDestinationId =
    careerCity?.destinationId ?? CAREER_START_CITY;
  const launcherDestination = launcherInCareer
    ? getDestinationProfile(careerLauncherDestinationId)
    : destination;
  const launcherCountry = launcherInCareer
    ? (careerCountry ??
      getCountryProfile(careerCountryOf(careerLauncherDestinationId)))
    : country;

  const saveSettings = (next: PlayerProgressV2) => {
    setProgress(next);
    setDestinationId(next.lastDestinationId);
    setCamera(next.preferredCamera);
    saveProgress(next);
  };

  // Economy state for the active drive: wallet, fuel gauge, and whether the car
  // is stopped at a gas station (so the refuel prompt can appear). In career
  // the tank belongs to the rented vehicle and refuelling is never gated on
  // affording it — the charge just pushes the day-cash negative.
  const walletHere = progress.walletByCountry[driveCountry.id];
  const careerVehicle = careerRun?.vehicle ?? null;
  // Two-wheelers have no cockpit — see `toggleCamera` in GameCanvas — so the
  // button that would switch into one is withheld rather than left dead.
  const cameraSwitchable =
    !careerVehicle || careerVehicle.visualKind === "car";
  const moneyClusterButtons: DriveMoneyClusterButton[] = [
    {
      id: "music",
      label: musicMuted ? "Unmute music" : "Mute music",
      pressed: musicMuted,
      onPress: toggleMusicMuted,
    },
    // Omitted outright for a vehicle with no cockpit to switch into, rather
    // than kept as a no-op — see `toggleCamera` in GameCanvas.
    ...(cameraSwitchable
      ? [{ id: "camera", label: "Switch camera", onPress: () => pressDriveKey("KeyC") } as const]
      : []),
    // App state, so it toggles directly. `pressDriveKey` exists only for the
    // session's own controls, which the app cannot call.
    {
      id: "map",
      label: mapOpen ? "Close the city map (M)" : "Open the city map (M)",
      pressed: mapOpen,
      onPress: () => setMapOpen((open) => !open),
    },
    {
      id: "pause",
      label: "Pause",
      onPress: () => pressDriveKey("KeyP"),
    },
  ];
  const tankCapacityL = careerVehicle ? careerVehicle.tankL : TANK_CAPACITY_L;
  const fuelFraction = tankCapacityL > 0 ? driveFuel / tankCapacityL : 0;
  // Measured to the pumps, not to the lane anchor: the station model is set
  // back ~16-19m from its anchor, so an anchor-radius check offered fuel to a
  // car stopped on the carriageway while refusing it at the pumps themselves.
  const activeGasStation =
    view === "driving" && hud && hud.speed <= 1
      ? gasStationsOf(runtimeMap.geometry.servicePoints).find(
          (service) =>
            distanceToNearestPump(
              runtimeMap.laneGraph.lanes,
              service,
              hud.playerX,
              hud.playerZ,
            ) <= FUEL_PUMP_REACH_M,
        ) ?? null
      : null;
  const litresNeeded = Math.max(0, tankCapacityL - driveFuel);
  // Free drive sells what the wallet covers rather than refusing the sale, so a
  // driver who cannot afford a whole tank still gets the fraction they paid for
  // (#259). Career keeps billing the whole tank on credit — see `fuelPurchase`
  // for why the two modes part company here.
  const { litres: affordableLitres, cost: affordableCost } = fuelPurchase(
    driveCountry.id,
    litresNeeded,
    walletHere,
  );
  // Career money is integer and priced per vehicle. The day's cash is what the
  // driver can pay without borrowing; anything past it settles into a loan at
  // `LOAN_ORIGINATION_RATE` tonight, which is the whole reason it is worth
  // showing separately rather than folding into one silent charge.
  const careerPricePerLitre =
    FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] *
    (careerVehicle?.fuelPriceFactor ?? 1);
  const careerFillCost = Math.round(litresNeeded * careerPricePerLitre);
  const careerCashSpend = Math.max(0, Math.min(dayCash, careerFillCost));
  const refuelLitres = careerRun ? litresNeeded : affordableLitres;
  const refuelCost = careerRun ? careerFillCost : affordableCost;
  // What the fill would put on the slate. Free drive has no credit — the wallet
  // is the ceiling there, and `affordableCost` already respects it.
  const refuelCredit = careerRun ? careerFillCost - careerCashSpend : 0;
  // One rule covers both modes: there has to be something worth pouring. In
  // career `refuelLitres` *is* `litresNeeded`, so this stays the tank-full
  // check it has always been; in free drive it also catches an empty wallet.
  const canRefuel = refuelLitres > MIN_REFUEL_LITRES;
  const refuelFillFraction =
    tankCapacityL > 0 ? refuelLitres / tankCapacityL : 0;
  // The second offer, career-only and only while the day's cash falls short:
  // take the fuel that cash buys and borrow nothing. Withheld when it would
  // pour less than the pump bothers selling, so there is never a choice
  // between a loan and a thimbleful.
  const careerTopUpLitres =
    careerPricePerLitre > 0
      ? Math.min(litresNeeded, careerCashSpend / careerPricePerLitre)
      : litresNeeded;
  const cashTopUp =
    careerRun && canRefuel && refuelCredit > 0 && careerTopUpLitres > MIN_REFUEL_LITRES
      ? { litres: careerTopUpLitres, cost: careerCashSpend }
      : null;
  const cashTopUpFraction =
    cashTopUp && tankCapacityL > 0 ? cashTopUp.litres / tankCapacityL : 0;
  // Pressing Refuel now stages the pump cutscene; the wallet debit and the
  // fill land when the scene reports the nozzle is in (its `pump` event) — and
  // the fraction staged here is what that step pours and bills for, so the two
  // offers need no second channel to tell them apart.
  // useCallback (rather than a plain closure) so the Enter-key effect below
  // isn't forced to resubscribe on every fuel-gauge tick.
  const refuel = useCallback(() => {
    if (!canRefuel || cutscene || towing) return;
    beginCutscene("refuel", undefined, undefined, refuelFillFraction);
  }, [canRefuel, cutscene, towing, beginCutscene, refuelFillFraction]);
  const topUpWithCash = useCallback(() => {
    if (!cashTopUpFraction || cutscene || towing) return;
    beginCutscene("refuel", undefined, undefined, cashTopUpFraction);
  }, [cashTopUpFraction, cutscene, towing, beginCutscene]);

  // Measured to the bay the car has to be standing in, for the same reason the
  // fuel prompt measures to the pumps: the lane anchor is out on the road.
  const activeRepairShop =
    view === "driving" && hud && hud.speed <= 1
      ? repairShopsOf(runtimeMap.geometry.servicePoints).find(
          (service) =>
            distanceToRepairBay(
              runtimeMap.laneGraph.lanes,
              service,
              hud.playerX,
              hud.playerZ,
            ) <= REPAIR_BAY_REACH_M,
        ) ?? null
      : null;
  const damagePct = Math.max(0, FULL_CONDITION_PCT - carCondition);
  const repairCost = repairPrice(driveCountry, damagePct, "shop");
  // Deliberately NOT gated on affording it, which is where this parts company
  // with `canRefuel` a few lines up. `debit` clamps at zero, so gating the shop
  // would leave a broke player no choice but to keep driving until the car hit
  // zero and the tow fired — and the tow's debit clamps too. The expensive
  // option would be free and the cheap one forbidden, which is backwards from
  // what pricing repairs by damage is for. Only the tow should ever bite.
  const canRepair = damagePct >= MIN_REPAIRABLE_DAMAGE_PCT;
  const repair = useCallback(() => {
    if (!canRepair || cutscene || towing) return;
    beginCutscene("repair");
  }, [canRepair, cutscene, towing, beginCutscene]);

  // The two service prompts share one slot, one Enter handler and one card.
  // They can never both be live — a car cannot be at a pump and in a bay at
  // once — but built as two blocks they would sit at the same `left: 50%` and
  // register two `Enter` listeners, and nothing would say so until they did.
  const promptKind = activeGasStation
    ? ("refuel" as const)
    : activeRepairShop
      ? ("repair" as const)
      : null;
  // "Top up" rather than "Refuel" whenever the money on hand stops short of a
  // full tank, so a gauge that comes back up short is what the button promised
  // rather than a surprise. The price shown is always what is about to be
  // charged — which, on a short wallet, is the whole wallet.
  const refuelLabel =
    litresNeeded <= MIN_REFUEL_LITRES
      ? `${activeGasStation?.label} · Tank full`
      : !canRefuel
        ? `${activeGasStation?.label} · No money for fuel`
        : refuelCredit > 0
          ? `Fill up — ${formatMoney(refuelCost, driveCountry)}`
          : refuelLitres < litresNeeded
            ? `Top up — ${formatMoney(refuelCost, driveCountry)}`
            : `Refuel — ${formatMoney(refuelCost, driveCountry)}`;
  /*
   * The prompt is a list because career's pump can offer two ways to pay, and
   * the choice between them is the point: borrowing is not free, it settles
   * into a loan tonight. Everything else — free drive's pump, both repair
   * cases — is a one-entry list and renders exactly as it did as one button.
   *
   * Enter always takes the FIRST entry, and the cash-only top-up is put first
   * on purpose: a player who mashes Enter at a pump must not find they have
   * quietly taken out a loan. Mashing it twice spends the cash and then borrows
   * the rest, which is the same place the old single button landed — just
   * arrived at deliberately.
   */
  const splitPrompt = promptKind === "refuel" && cashTopUp !== null;
  const promptActions: readonly ServicePromptAction[] =
    promptKind !== "refuel"
      ? [
          {
            testId: "repair-button",
            label: canRepair
              ? `Repair — ${formatMoney(repairCost, driveCountry)}`
              : `${activeRepairShop?.label} · Nothing to fix`,
            hint: "ENTER",
            tone: "primary",
            enabled: canRepair,
          },
        ]
      : cashTopUp
        ? [
            {
              testId: "refuel-button",
              label: `Top up — ${formatMoney(cashTopUp.cost, driveCountry)}`,
              hint: "ENTER",
              tone: "primary",
              enabled: true,
            },
            {
              // No "on credit" note: sat beside the gold cash offer, the coral
              // and the word "Fill" carry it, and the borrowed part is the gap
              // between the two prices on screen.
              testId: "refuel-credit-button",
              label: `Fill up — ${formatMoney(refuelCost, driveCountry)}`,
              hint: "B",
              tone: "credit",
              enabled: true,
            },
          ]
        : [
            {
              testId: "refuel-button",
              label: refuelLabel,
              // Alone on screen the coral has nothing to be read against — the
              // gold offer that teaches what it means is not there — so this is
              // the one place the borrowing is still spelled out.
              note: canRefuel && refuelCredit > 0 ? "on credit" : undefined,
              hint: "ENTER",
              tone: refuelCredit > 0 ? "credit" : "primary",
              enabled: canRefuel,
            },
          ];

  // Enter mirrors whichever service prompt is showing, same as F/G mirror the
  // offer card — only live while the prompt itself is up, so it never fires a
  // cutscene the player is stood too far away to see staged. B is career's
  // borrow key, live only while there is something to borrow. Every action
  // already no-ops when there is nothing to do.
  const promptEnterAct =
    promptKind !== "refuel" ? repair : cashTopUp ? topUpWithCash : refuel;
  const promptBorrowAct = splitPrompt ? refuel : null;
  useEffect(() => {
    if (view !== "driving" || !promptKind) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        promptEnterAct();
      } else if (promptBorrowAct && event.code === "KeyB") {
        event.preventDefault();
        promptBorrowAct();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, promptKind, promptEnterAct, promptBorrowAct]);

  const gigTargetVenue = gig ? gigTarget(gig) : null;
  // Every marked place on this map — pumps, bays, diners, grocers, cameras —
  // resolved once per pack by `collectMapPois` and shared with the whole-city
  // map, so the two can never disagree about where the nearest one is.
  //
  // Minus the one you are driving to. Place markers are DOM above the canvas
  // and the destination pin is drawn *on* it, so a diner's own icon sits right
  // on top of the pin for that diner — burying the single thing the map exists
  // to point at. The pin is the better marker of the two, and both saying the
  // same thing twice was never the intent. Ids line up because a food or shop
  // marker is keyed on the venue the gig targets.
  const allMapPois = view === "driving" ? collectMapPois(runtimeMap) : EMPTY_MAP_POIS;
  const mapPois = gigTargetVenue
    ? allMapPois.filter((poi) => poi.id !== gigTargetVenue.id)
    : allMapPois;
  // What the corner widget carries is narrower, and narrower again on a bike:
  // a vehicle with no tank has nothing to do at a pump. Repair shops stay
  // marked whatever the car's condition — a service you can only see once you
  // already need it is one you cannot plan a detour around.
  const minimapPois = mapPoisOfKinds(mapPois, MINIMAP_POI_KINDS).filter(
    (poi) => poi.kind !== "fuel" || tankCapacityL > 0,
  );
  // The tip window for the active career gig: previewed before pickup, counted
  // down while carrying. Derived from the same 10 Hz day-clock state that
  // drives the countdown chip, so it re-renders in step.
  const gigParForCardMs = gig
    ? gigParMs(
        Math.hypot(gig.dropoff.x - gig.pickup.x, gig.dropoff.z - gig.pickup.z),
        careerRun ? careerRun.vehicle.paceFactor : 1,
      )
    : null;
  const tipRemainingMs =
    gigParForCardMs !== null && carryingSinceMs !== null
      ? gigParForCardMs - (driveElapsedMs - carryingSinceMs)
      : null;
  // How long the "DAY n" title has been up, or null while it is still withheld.
  const dayIntroElapsedMs =
    dayIntroFromMs === null
      ? null
      : DAY_LENGTH_MS - dayRemainingMs - dayIntroFromMs;
  // The shift clock, resolved once for the top-centre readout and the edge bar
  // so the two can never disagree about which colour the day is. Both form
  // factors read the same numbers; only the comp's sizing differs, and that
  // lives in `DAY_TIMER_METRICS`.
  const dayTimer = careerRun
    ? resolveDayTimer(careerRun.city.day, dayRemainingMs, DAY_LENGTH_MS)
    : null;
  // Whether the clock gets the top-centre readout or stays a line in the status
  // card's header. On a phone that is a question of width — see
  // `DAY_TIMER_MIN_VIEWPORT_PX` for the arithmetic the cut comes from. The edge
  // bar is drawn either way; only the numerals need somewhere to stand.
  const dayTimerInRow = Boolean(
    dayTimer && (!touchFirst || viewportWidth >= DAY_TIMER_MIN_VIEWPORT_PX),
  );
  const mapDestination: MapDestination | null = gigTargetVenue
    ? {
        x: gigTargetVenue.x,
        z: gigTargetVenue.z,
        color: gig?.state === "carrying" ? "#f2c658" : "#e0533f",
      }
    : null;
  // Drawn from where the car actually is, so the line leads rather than trails.
  // The route itself is searched in `handleHud`; this only slices it.
  const minimapRoute =
    gpsRoute && hud
      ? trimRouteToPlayer(gpsRoute.points, hud.playerX, hud.playerZ)
      : undefined;
  // The driving HUD's one layout switch. On touch every readout lives in the
  // top band, because the bottom band is the steering region and the pedals;
  // on a desktop the corners are free and the HUD keeps its roomier placement.
  // `env(safe-area-inset-*)` only resolves to anything once the viewport meta
  // carries `viewport-fit=cover` — see `applyViewportFitCover`.
  const hudInset = touchFirst
    ? { top: SAFE_TOP, left: SAFE_LEFT, right: SAFE_RIGHT }
    : { top: "1rem", left: "1rem", right: "1rem" };
  // A waiting rider mesh only makes sense while heading to a passenger pickup.
  const riderVenueId =
    gig && gig.kind === "passenger" && gig.state === "enroute_pickup"
      ? gig.pickup.id
      : null;
  // Within arrival range but still rolling: nudge the player to stop, since
  // stopping is what starts the pickup/drop-off scene now.
  const nearGigStop = Boolean(
    hud &&
      gig &&
      gig.state !== "delivered" &&
      gigTargetVenue &&
      Math.hypot(
        hud.playerX - gigTargetVenue.x,
        hud.playerZ - gigTargetVenue.z,
      ) <= GIG_ARRIVAL_RADIUS_M,
  );
  const cutsceneCaption = cutscene ? CUTSCENE_CAPTION[cutscene.kind] : null;
  // A street address is a spot outside a row of buildings that look like every
  // other row, so the stop you are heading for gets a lit kerbside beacon.
  const gigStopId = gigTargetVenue?.id ?? null;
  const gigStopCarrying = gig?.state === "carrying";
  // Bound once so the HUD panel narrows it, rather than repeating the
  // `state !== "delivered"` test at every field it reads.
  const activeGig = gig && gig.state !== "delivered" ? gig : null;
  /*
   * The nav card's gauges, as data. Which exist varies — a bicycle has no tank
   * — so the list is built rather than laid out, which is what keeps the row
   * from growing a hole. The day clock is not here: it rides the money cluster
   * beside the cash it governs.
   */
  const navGauges: HudGauge[] = [];
  if (tankCapacityL > 0) {
    navGauges.push({
      id: "fuel",
      icon: FUEL_PUMP_ICON,
      label: "Fuel",
      testId: "fuel-gauge",
      value: driveFuel <= 0 ? "EMPTY" : `${Math.round(fuelFraction * 100)}%`,
      fill: fuelFraction,
      fillColor:
        fuelFraction <= 0.15
          ? HUD_CORAL
          : fuelFraction <= 0.35
            ? HUD_GOLD
            : HUD_SAGE,
      // While the pump scene runs, the bar pours across the whole fill window
      // instead of snapping full.
      fillTransition:
        fuelFillMs > 0 ? `width ${fuelFillMs}ms linear` : "width 0.2s ease",
    });
  }
  navGauges.push({
    id: "condition",
    icon: CAR_ICON,
    label:
      careerVehicle?.visualKind === "bicycle"
        ? "Bike"
        : careerVehicle?.visualKind === "motorbike"
          ? "Motorbike"
          : "Car",
    value: carCondition <= 0 ? "WRECKED" : `${Math.round(carCondition)}%`,
    fill: carCondition / 100,
    fillColor:
      carCondition <= 25 ? HUD_CORAL : carCondition <= 55 ? HUD_GOLD : HUD_SAGE,
    fillTransition: "width 0.2s ease",
  });

  // ── Desktop HUD ───────────────────────────────────────────────────────────
  // Everything the designed clusters render, worked out here so DriveHud stays
  // props-pure: it is handed finished strings and knows nothing about gigs,
  // dispatch or career.
  const hudScale = resolveHudScale(viewportWidth);
  // What the right edge has spare between the top button row and the pedals.
  // The mobile comp is drawn on a 400px-tall frame; the shortest landscape
  // phone the rail budget admits is 320, and Safari with its toolbars showing
  // leaves about 343 — so the card is sized from this, not from the comp.
  const touchOfferSlotPx =
    viewportHeight -
    TOUCH_INSET_PX * 2 -
    TOUCH_TOP_RAIL_PX -
    TOUCH_PEDAL_BLOCK_PX -
    TOUCH_OFFER_GAP_PX;
  const roadNames = runtimeMap.roadNames ?? {};
  const streetOf = (roadId: string) => roadNames[roadId] ?? roadId;

  const navManoeuvre: HudManoeuvre | null =
    gpsProgress?.next
      ? (() => {
          const parts = formatDistanceParts(
            gpsProgress.distanceToNextM,
            driveCountry,
          );
          return {
            kind: gpsProgress.next.kind,
            street:
              gpsProgress.next.kind === "arrive"
                ? (activeGig ? gigTarget(activeGig)?.name ?? "your stop" : "your stop")
                : streetOf(gpsProgress.next.ontoRoadId),
            distanceValue: parts.value,
            distanceUnit: parts.unit,
            imminent: gpsProgress.distanceToNextM <= MANOEUVRE_IMMINENT_M,
            // Against the whole run to the stop, so it fills once across a job
            // instead of sawtoothing back to empty at every corner.
            destinationProgress:
              legRouteTotalM > 0
                ? 1 -
                  Math.min(1, Math.max(0, gpsProgress.remainingM / legRouteTotalM))
                : 0,
            destinationDistance: formatDistance(
              gpsProgress.remainingM,
              driveCountry,
            ),
          };
        })()
      : null;

  const followingManoeuvre = (() => {
    const next = gpsProgress?.next;
    if (!next || !gpsRoute) return null;
    const index = gpsRoute.manoeuvres.indexOf(next);
    const following = index >= 0 ? gpsRoute.manoeuvres[index + 1] : undefined;
    if (!following) return null;
    return {
      kind: following.kind,
      street:
        following.kind === "arrive"
          ? (activeGig ? gigTarget(activeGig)?.name ?? "your stop" : "your stop")
          : streetOf(following.ontoRoadId),
      distance: formatDistance(
        Math.max(0, following.alongM - next.alongM),
        driveCountry,
      ),
    };
  })();

  const navJob: HudJob | null = activeGig
    ? {
        kind: activeGig.kind,
        eyebrow:
          activeGig.state === "carrying"
            ? activeGig.kind === "passenger"
              ? "DROP OFF"
              : "DELIVER"
            : "PICK UP",
        target:
          activeGig.state === "carrying"
            ? activeGig.dropoff.name
            : activeGig.pickup.name,
        sub:
          activeGig.state === "carrying"
            ? `from ${activeGig.pickup.name}`
            : `then ${activeGig.dropoff.name}`,
        pay: `+${formatMoney(activeGig.reward, driveCountry)}`,
        // Stopping is what starts the scene now, so a driver rolling through
        // the arrival radius needs telling. It outranks the tip clock: it is
        // the difference between the job progressing and not.
        hint: nearGigStop
          ? `Stop the car to ${activeGig.state === "carrying" ? "drop off" : "pick up"}.`
          : activeGig.state === "carrying" && tipRemainingMs !== null
            ? tipHint(activeGig.kind, tipRemainingMs)
            : null,
        // Only a food order's tip is known in advance; a rider's is the point
        // of the drop-off, so the card stays silent about it.
        tip:
          activeGig.kind === "delivery"
            ? `Tip ${formatMoney(quotedTip(activeGig.reward, activeGig.seed, activeGig.surged), driveCountry)} already added`
            : null,
        surged: activeGig.surged,
      }
    : null;


  const detourLabel =
    offer && previewRoute
      ? formatDistance(
          routeProgress(previewRoute, hud?.playerX ?? 0, hud?.playerZ ?? 0)
            .remainingM,
          driveCountry,
        )
      : null;

  const hudOffer: HudOffer | null = offer
    ? {
        kind: offer.gig.kind,
        pay: `+${formatMoney(offer.gig.reward, driveCountry)}`,
        bonus: offer.gig.surged
          ? `surge ×${SURGE_FARE_MULTIPLIER}`
          : offer.gig.kind === "delivery"
            ? `+${formatMoney(quotedTip(offer.gig.reward, offer.gig.seed, offer.gig.surged), driveCountry)} tip`
            : null,
        title: offer.gig.pickup.name,
        sub:
          offer.gig.kind === "passenger"
            ? `then ${offer.gig.dropoff.name}`
            : `then ${offer.gig.dropoff.name}`,
        chips: [
          ...(detourLabel ? [`${detourLabel} away`] : []),
          `${formatDistance(
            Math.hypot(
              offer.gig.dropoff.x - offer.gig.pickup.x,
              offer.gig.dropoff.z - offer.gig.pickup.z,
            ),
            driveCountry,
          )} run`,
          offer.gig.kind === "passenger" ? "1 rider" : "1 order",
        ],
        detour: detourLabel ?? null,
        meta: offer.gig.kind === "passenger" ? "1 rider" : "1 order",
        footnote: activeGig
          ? `Stacks after ${gigTarget(activeGig)?.name ?? "your current job"}`
          : "Nothing else in hand",
        secondsLeft: Math.ceil(
          Math.max(0, OFFER_WINDOW_MS - (driveElapsedMs - offer.offeredAtMs)) / 1000,
        ),
        elapsed: Math.min(
          1,
          Math.max(0, (driveElapsedMs - offer.offeredAtMs) / OFFER_WINDOW_MS),
        ),
        surged: offer.gig.surged,
      }
    : null;

  if (!hydrated) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-road" aria-hidden="true" />
        <p>Preparing Curbside Rush…</p>
      </main>
    );
  }

  if (view === "driving") {
    return (
      <DriveScreen
        camera={camera}
        carCondition={carCondition}
        careerRun={careerRun}
        cutscene={cutscene}
        dayCash={dayCash}
        dayRemainingMs={dayRemainingMs}
        dispatchToast={dispatchToast}
        driveElapsedMs={driveElapsedMs}
        driveFuel={driveFuel}
        fineToast={fineToast}
        gpsRoute={gpsRoute}
        hud={hud}
        mapOpen={mapOpen}
        offer={offer}
        paused={paused}
        payoutGain={payoutGain}
        pendingConfirm={pendingConfirm}
        previewRoute={previewRoute}
        progress={progress}
        queuedGig={queuedGig}
        sessionEarnings={sessionEarnings}
        surge={surge}
        touchFirst={touchFirst}
        towFee={towFee}
        towing={towing}
        towResetNonce={towResetNonce}
        viewportHeight={viewportHeight}
        viewportWidth={viewportWidth}
        setCamera={setCamera}
        setMapOpen={setMapOpen}
        setPaused={setPaused}
        setPendingConfirm={setPendingConfirm}
        activeSteeringSide={activeSteeringSide}
        answerOffer={answerOffer}
        careerVehicle={careerVehicle}
        cutsceneCaption={cutsceneCaption}
        dayIntroElapsedMs={dayIntroElapsedMs}
        dayTimer={dayTimer}
        dayTimerInRow={dayTimerInRow}
        detourLabel={detourLabel}
        driveCountry={driveCountry}
        driveDestination={driveDestination}
        exitDrive={exitDrive}
        finishCareerDayExit={finishCareerDayExit}
        followingManoeuvre={followingManoeuvre}
        gigStopCarrying={gigStopCarrying}
        gigStopId={gigStopId}
        handleGameEvent={handleGameEvent}
        handleHud={handleHud}
        hudInset={hudInset}
        hudOffer={hudOffer}
        hudScale={hudScale}
        mapDestination={mapDestination}
        mapPois={mapPois}
        mapVisible={mapVisible}
        minimapPois={minimapPois}
        minimapRoute={minimapRoute}
        moneyClusterButtons={moneyClusterButtons}
        musicMuted={musicMuted}
        navGauges={navGauges}
        navJob={navJob}
        navManoeuvre={navManoeuvre}
        promptActions={promptActions}
        promptEnterAct={promptEnterAct}
        promptKind={promptKind}
        refuel={refuel}
        riderVenueId={riderVenueId}
        runtimeScenario={runtimeScenario}
        runtimeMap={runtimeMap}
        splitPrompt={splitPrompt}
        tankCapacityL={tankCapacityL}
        themeStyle={themeStyle}
        toggleMusicMuted={toggleMusicMuted}
        touchOfferSlotPx={touchOfferSlotPx}
        walletHere={walletHere}
      />
    );
  }

  return (
    <main
      className={`app-shell ${effectiveView === "launcher" ? "launcher-shell" : ""} ${
        effectiveView === "career-garage" || effectiveView === "career-travel"
          ? "career-shell"
          : ""
      }`}
      style={themeStyle}
    >
      <header className="app-header">
        <button
          className="brand-button"
          type="button"
          onClick={() => setView("launcher")}
          aria-label="Curbside Rush home"
        >
          <span className="brand-mark">C</span>
          <span className="brand-copy">
            <strong>CURBSIDE</strong>
            <small>RUSH</small>
          </span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button
            className={effectiveView === "settings" ? "active" : ""}
            type="button"
            onClick={() => setView("settings")}
          >
            Settings
          </button>
          <button
            className={effectiveView === "credits" ? "active" : ""}
            type="button"
            onClick={() => setView("credits")}
          >
            Sources
          </button>
        </nav>
        <div className="mobile-menu">
          <button
            className="mobile-menu-trigger"
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-panel"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            Menu
          </button>
          {mobileMenuOpen && (
            <nav id="mobile-menu-panel" aria-label="Mobile navigation">
              <button type="button" onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>Settings & accessibility</button>
              <button type="button" onClick={() => { setView("credits"); setMobileMenuOpen(false); }}>Sources & credits</button>
            </nav>
          )}
        </div>
      </header>

      {effectiveView === "settings" && (
        <SettingsView
          progress={progress}
          onSave={saveSettings}
          onReset={() => {
            const reset = resetProgress();
            setProgress(reset);
            setDestinationId(reset.lastDestinationId);
            setCamera(reset.preferredCamera);
            setView("launcher");
          }}
          onBack={() => setView("launcher")}
        />
      )}
      {effectiveView === "credits" && (
        <CreditsView onBack={() => setView("launcher")} />
      )}

      {effectiveView === "career-garage" &&
        careerSlice &&
        careerCity &&
        careerCountry && (
          <GarageView
            slice={careerSlice}
            city={careerCity}
            country={careerCountry}
            selectedVehicleId={garageVehicleId}
            lockedVehicles={lockedCareerVehicles}
            onSelect={(vehicleId) => commitGarageVehicle(vehicleId)}
            onStartDay={beginCareerDay}
            onBuy={buyVehicle}
            onTravel={() => setView("career-travel")}
            cityName={
              getDestinationProfile(careerCity.destinationId).destinationName
            }
            onAbandon={() => setPendingConfirm("abandon-career")}
          />
        )}
      {effectiveView === "career-travel" && careerSlice && careerCity && (
        <TravelView
          stops={travelBoard(careerSlice, describeTravelCity)}
          summary={travelSummary(
            careerSlice,
            getCountryProfile(careerCity.countryId),
            getDestinationProfile(careerCity.destinationId).destinationName,
          )}
          onGoTo={travelToCity}
          onBuyTicket={() => setPendingConfirm("buy-ticket")}
          onBack={() => setView("career-garage")}
        />
      )}
      {effectiveView === "career-ledger" && lastSettlement && careerCountry && (
        <LedgerView
          result={lastSettlement.result}
          slice={lastSettlement.slice}
          city={lastSettlement.city}
          country={careerCountry}
          reducedMotion={progress.accessibility.reducedMotion}
          onContinue={() => setView("career-garage")}
        />
      )}
      {effectiveView === "career-over" && lastSettlement && careerCountry && (
        <CareerOverView
          city={lastSettlement.morningCity}
          cityName={
            getDestinationProfile(lastSettlement.morningCity.destinationId)
              .destinationName
          }
          country={careerCountry}
          reason={
            lastSettlement.rating.verdict === "ended" ? "rating" : "bankruptcy"
          }
          // The wipe's fresh sheet already chose the garage's opening ride when
          // it settled, so this is only the way back to it.
          onContinue={() => setView("career-garage")}
        />
      )}

      {effectiveView === "launcher" && (
        <LauncherView
          destinationId={destinationId}
          gameMode={gameMode}
          needsHomeScreenForFullscreen={needsHomeScreenForFullscreen}
          progress={progress}
          touchFirst={touchFirst}
          setGameMode={setGameMode}
          setView={setView}
          destinationRefs={destinationRefs}
          beginDrive={beginDrive}
          careerCity={careerCity}
          careerCountry={careerCountry}
          careerLauncherDestinationId={careerLauncherDestinationId}
          chooseDestination={chooseDestination}
          commitGarageVehicle={commitGarageVehicle}
          destination={destination}
          garageVehicleId={garageVehicleId}
          launcherCountry={launcherCountry}
          launcherDestination={launcherDestination}
          resetCareer={resetCareer}
          startCareer={startCareer}
        />
      )}

      {effectiveView !== "launcher" && (
        <footer className="app-footer">
          <span>Curbside Rush is familiarisation, not legal advice or driver instruction.</span>
          <span>Map data © OpenStreetMap contributors · ODbL</span>
        </footer>
      )}
      {pendingConfirm === "buy-ticket" && careerSlice && careerCity && (
        <ConfirmDialog
          title={`Fly to ${
            getDestinationProfile(
              nextCareerCity(careerCity.destinationId) ?? CAREER_START_CITY,
            ).destinationName
          }?`}
          body={`The ticket costs ${formatMoney(
            ticketPrice(careerCity.destinationId) ?? 0,
            careerCountry ?? country,
          )}. You'll arrive with a fresh starting balance and none of the vehicles you own here — they stay in ${
            getDestinationProfile(careerCity.destinationId).destinationName
          }, waiting for you to fly back.`}
          confirmLabel="Buy the ticket"
          onCancel={() => setPendingConfirm(null)}
          onConfirm={buyTicket}
        />
      )}
      {pendingConfirm === "abandon-career" && (
        <ConfirmDialog
          title="Abandon this career?"
          body="Your career save is deleted for good. This can't be undone."
          confirmLabel="Abandon career"
          tone="danger"
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            setPendingConfirm(null);
            resetCareer("launcher");
          }}
        />
      )}
    </main>
  );
}
