"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import type {
  CutsceneRequest,
  GameCanvasLesson,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/GameCanvas";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FINE_BY_COUNTRY,
  FUEL_CONSUMPTION_L_PER_M,
  REPAIR_FEE_BY_COUNTRY,
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  GIG_FARE_BY_COUNTRY,
  PASSENGER_FARE_BY_COUNTRY,
  TANK_CAPACITY_L,
  formatMoney,
  getCountryProfile,
  getDestinationProfile,
  getFreeDrive,
  getMapPack,
  resolveSessionConfig,
  resolveSteeringSide,
} from "./game/content";
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
  careerTip,
  canBuyVehicle,
  createCareerSlice,
  ticketPrice,
  travelTo,
  DAY_LENGTH_MS,
  DEFAULT_GARAGE_VEHICLE_ID,
  emptyDayLog,
  garageDefaultVehicle,
  getCareerVehicle,
  gigParMs,
  PLATFORM_FEE_BY_COUNTRY,
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  ROADSIDE_PRICE_FACTOR,
  settleDay,
  vehicleRent,
} from "./game/career";
import type {
  CareerCityView,
  CareerSliceV2,
  CareerVehicleId,
  CareerVehicleSpec,
  DayLedgerInput,
  SettlementResult,
} from "./game/career";
import {
  CareerOverView,
  CareerSetupPanel,
  formatClock,
  travelBoard,
  travelSummary,
  TravelView,
  GarageView,
  LedgerView,
} from "./CareerViews";
import type { TravelCityFacts } from "./CareerViews";
import { ConfirmDialog } from "./ConfirmDialog";
import { FULL_CONDITION_PCT, damageForCollision } from "./game/damage";
import {
  buildCareerDayLesson,
  buildFreeDriveLesson,
} from "./game/freeDriveLesson";
import { resolveSimulationLaneAnchor } from "./game/simulationAdapter";
import {
  FUEL_PUMP_REACH_M,
  distanceToNearestPump,
  gasStationPumpPositions,
} from "./game/servicePoints";
import { Minimap, type MinimapPin } from "./game/MinimapCanvas";
import {
  findGpsRoute,
  gpsGraphForLanes,
  routeDeviationM,
  trimRouteToPlayer,
  type GpsLane,
  type GpsPoint,
} from "./game/gpsRoute";
import { DRIVE_LAYER } from "./game/driveLayers";
import { rearViewCssRect } from "./game/cockpitLayout";
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
  TOUCH_MINIMAP_PX,
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
import type { Gig, GigKind, GigVenuePosition } from "./game/gigs";
import { streetAddressesForMap } from "./game/streetAddresses";
import type {
  CameraMode,
  CountryProfile,
  DestinationId,
  GameSessionConfig,
  PlayerProgressV2,
  ScenarioId,
} from "./game/types";

type View =
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
interface CareerRun {
  readonly slice: CareerSliceV2;
  readonly city: CareerCityView;
  readonly vehicleId: CareerVehicleId;
  readonly vehicle: CareerVehicleSpec;
}

const GameCanvas = dynamic(() => import("./game/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="game-loading" role="status">
      Building roads, traffic and your cockpit…
    </div>
  ),
});

type ChoiceOption<T extends string> = {
  readonly value: T;
  readonly symbol: string;
  readonly label: string;
  readonly hint: string;
};

/**
 * Short commit ref of the running build, frozen in by `vite.config.ts` from
 * Netlify's `COMMIT_REF`. `"dev"` locally. Declared rather than imported
 * because it is a compile-time `define`, not a module.
 */
declare const __BUILD_REF__: string;
const BUILD_REF: string =
  typeof __BUILD_REF__ === "string" ? __BUILD_REF__ : "dev";

const CAMERA_CHOICES: readonly ChoiceOption<CameraMode>[] = [
  { value: "first_person", symbol: "1P", label: "Driver view", hint: "First person" },
  { value: "third_person", symbol: "3P", label: "Chase view", hint: "Third person" },
];

const toCanvasCamera = (camera: CameraMode): "first" | "third" =>
  camera === "first_person" ? "first" : "third";

const fromCanvasCamera = (camera: "first" | "third"): CameraMode =>
  camera === "first" ? "first_person" : "third_person";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function useGamepadUiNavigation(
  enabled: boolean,
  onBack: () => void,
) {
  const previousButtonsRef = useRef<boolean[]>([]);
  const previousDirectionsRef = useRef({ up: false, down: false });

  useEffect(() => {
    if (!enabled || !("getGamepads" in navigator)) return;

    const visibleFocusable = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const root = dialog ?? document.querySelector<HTMLElement>("main");
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.closest("[hidden], [aria-hidden=\"true\"]") &&
          element.getAttribute("aria-disabled") !== "true",
      );
    };
    const preferredFocusable = (items: HTMLElement[]) =>
      items.find((item) =>
        item.matches(
          ".launcher-primary:not(:disabled), .primary-button:not(:disabled)",
        ),
      ) ?? items[0];
    const moveFocus = (direction: -1 | 1) => {
      const items = visibleFocusable();
      if (!items.length) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        currentIndex < 0
          ? items.indexOf(preferredFocusable(items))
          : (currentIndex + direction + items.length) % items.length;
      items[Math.max(0, nextIndex)]?.focus();
    };
    const activateFocused = () => {
      const items = visibleFocusable();
      const active = document.activeElement as HTMLElement | null;
      const target = active && items.includes(active)
        ? active
        : preferredFocusable(items);
      target?.focus();
      target?.click();
    };
    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(gamepads).find(Boolean);
      if (!pad) {
        previousButtonsRef.current = [];
        previousDirectionsRef.current = { up: false, down: false };
        return;
      }
      const buttons = pad.buttons.map((button) => button.pressed);
      const up = Boolean(buttons[12]) || (pad.axes[1] ?? 0) <= -0.65;
      const down = Boolean(buttons[13]) || (pad.axes[1] ?? 0) >= 0.65;
      if (up && !previousDirectionsRef.current.up) moveFocus(-1);
      if (down && !previousDirectionsRef.current.down) moveFocus(1);
      if (buttons[0] && !previousButtonsRef.current[0]) activateFocused();
      if (buttons[1] && !previousButtonsRef.current[1]) onBack();
      previousButtonsRef.current = buttons;
      previousDirectionsRef.current = { up, down };
    };
    poll();
    const interval = window.setInterval(poll, 1000 / 30);
    return () => window.clearInterval(interval);
  }, [enabled, onBack]);
}

const DESTINATION_PREVIEW_IMAGES: Record<DestinationId, string> = {
  "uk-london": "/landing/london.webp",
  "us-nyc": "/landing/nyc.webp",
  "uk-milton-keynes": "/landing/milton-keynes.webp",
  "fr-calais": "/landing/calais.webp",
  "jp-tokyo": "/landing/tokyo.webp",
};

// Horizontal focus for the cover-cropped preview. Defaults to centre; Calais is
// nudged right so the lighthouse on the image's right edge stays in frame.
const DESTINATION_PREVIEW_FOCUS: Partial<Record<DestinationId, string>> = {
  "fr-calais": "64% center",
};

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

const assistanceFromProgress = (
  progress: PlayerProgressV2,
): GameSessionConfig["assistance"] => ({
  coachPrompts: true,
  subtitles: progress.accessibility.subtitles,
  wrongSideWarnings: true,
  autoResetAfterCriticalError: true,
  reducedMotion: progress.accessibility.reducedMotion,
});

function resolveGigVenues(
  map: ReturnType<typeof getMapPack>,
): GigVenuePosition[] {
  return (map.geometry.gigVenues ?? []).flatMap((venue) => {
    const pose = resolveSimulationLaneAnchor(map.laneGraph.lanes, venue.anchor);
    return pose
      ? [
          {
            id: venue.id,
            name: venue.name,
            kind: venue.kind,
            x: pose.x,
            z: pose.z,
          },
        ]
      : [];
  });
}

/** The map's generated street addresses, in gig-pool shape. */
function resolveGigAddresses(
  map: ReturnType<typeof getMapPack>,
): GigVenuePosition[] {
  return streetAddressesForMap(map).map((address) => ({
    id: address.id,
    name: address.name,
    kind: address.kind,
    x: address.x,
    z: address.z,
  }));
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

/** How close to a gig stop counts as arrived — mirrors `advanceGig`'s radius;
 * the state itself now flips when the arrival cutscene completes. */
const GIG_ARRIVAL_RADIUS_M = 14;

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

/** Human-readable reason for a fine toast, from the violation's rule code. */
function fineReason(code: string | undefined): string {
  switch (code) {
    case "wrong_way":
      return "driving on the wrong side";
    case "out_of_bounds":
      return "leaving the road";
    case "red_light":
      return "running a red light";
    case "collision":
      return "careless driving";
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
const HUD_CREAM = "#f4efde";
const HUD_GOLD = "#f4c848";
const HUD_CORAL = "#e8705a";
const HUD_SAGE = "#8fae72";
const HUD_GLASS = "rgba(11,15,17,.76)";
const HUD_SANS = '"Figtree", system-ui, sans-serif';
const HUD_SERIF = '"Playfair Display", Georgia, serif';

function HudGlyph({
  path,
  size = 14,
  color = "rgba(244,239,222,.55)",
}: {
  path: readonly string[];
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
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

const FUEL_PUMP_ICON = [
  "M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18",
  "M2 22h13",
  "M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3",
  "M6 8h4",
];
const CAR_ICON = [
  "M3 13l1.6-4.7A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.3L21 13",
  "M3 13h18v4a1 1 0 0 1-1 1h-1.6",
  "M5.6 18H4a1 1 0 0 1-1-1v-4",
  "M7.6 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
  "M16.4 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
];
const CLOCK_ICON = ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3.5 2"];
const PARCEL_ICON = [
  "m7.5 4.27 9 5.15",
  "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
  "m3.3 7 8.7 5 8.7-5",
  "M12 22V12",
];
const RIDER_ICON = [
  "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  "M4 21a8 8 0 0 1 16 0",
];

interface HudStatCell {
  readonly id: string;
  readonly icon: readonly string[];
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
  readonly valueColor?: string;
  readonly fill?: number;
  readonly fillColor?: string;
  readonly fillTransition?: string;
}

/** Lays the stat strip out two-up, the way the meters pair in the design. */
function chunkPairs(cells: readonly HudStatCell[]): HudStatCell[][] {
  const rows: HudStatCell[][] = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(cells.slice(index, index + 2));
  }
  return rows;
}

/**
 * One cell of the panel's stat strip: glyph, value, and an optional meter bar.
 *
 * The bar is what makes fuel and condition readable at a glance while the eyes
 * belong to the road — a percentage alone has to be parsed, a bar does not.
 */
function HudStat({
  icon,
  label,
  value,
  testId,
  valueColor,
  fill,
  fillColor,
  fillTransition,
  compact,
}: HudStatCell & { compact: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: compact ? 5 : 7,
      }}
    >
      <HudGlyph path={icon} size={compact ? 13 : 15} />
      <span className="sr-only">{label}</span>
      <span
        data-testid={testId}
        style={{
          font: `800 ${compact ? 11 : 13}px/1 ${HUD_SANS}`,
          color: valueColor ?? "rgba(244,239,222,.82)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      {fill !== undefined && (
        <div
          style={{
            flex: 1,
            minWidth: compact ? 22 : 30,
            height: compact ? 5 : 6,
            borderRadius: 999,
            background: "rgba(255,255,255,.14)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, Math.min(100, fill))}%`,
              borderRadius: 999,
              background: fillColor,
              transition: fillTransition,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function SideSwapApp() {
  const [progress, setProgress] = useState<PlayerProgressV2>(() =>
    createDefaultProgress(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("launcher");
  const [destinationId, setDestinationId] =
    useState<DestinationId>("uk-london");
  const [camera, setCamera] = useState<CameraMode>("third_person");
  const [activeSession, setActiveSession] = useState<GameSessionConfig | null>(
    null,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const destinationRefs = useRef(
    new Map<DestinationId, HTMLButtonElement>(),
  );
  const [paused, setPaused] = useState(false);
  // Which in-game confirmation modal is open, if any. Replaces native
  // window.confirm() so the prompt matches the dark HUD (#164). Only one is
  // ever open at a time, and each is dismissed within its own view.
  const [pendingConfirm, setPendingConfirm] = useState<
    "end-day" | "abandon-career" | "buy-ticket" | null
  >(null);
  const [hud, setHud] = useState<GameHudSnapshot | null>(null);
  const [driveFuel, setDriveFuel] = useState(TANK_CAPACITY_L);
  const lastPoseRef = useRef<{ x: number; z: number } | null>(null);
  const [gig, setGig] = useState<Gig | null>(null);
  const gigSeedRef = useRef(1);
  // The kinds served so far this drive, newest last, capped to the streak
  // window. Threaded into nextGigFor so no drive opens on a long run of one
  // kind — NYC's trafficSeed otherwise hashes to eight deliveries before the
  // first fare. Reset when a drive starts.
  const gigKindHistoryRef = useRef<GigKind[]>([]);
  const paidGigRef = useRef<string | null>(null);
  const [fineToast, setFineToast] = useState<{
    amount: number;
    reason: string;
  } | null>(null);
  const lastFineAtRef = useRef(0);
  // Per-drive car condition (100 = pristine). Collision events wear it down;
  // at zero the car is towed and repaired for a fee. Never persisted — like
  // the score, the wallet debit is the only durable consequence. The ref
  // mirrors the state so back-to-back collision events in one frame all
  // subtract from the live value.
  const [carCondition, setCarCondition] = useState(FULL_CONDITION_PCT);
  const carConditionRef = useRef(FULL_CONDITION_PCT);
  const [towing, setTowing] = useState(false);
  const towingRef = useRef(false);
  const towResetNonceRef = useRef(0);
  const [towResetNonce, setTowResetNonce] = useState(0);
  const lastPedFineAtRef = useRef(0);
  // Why the patrol pulled you over, carried from the `fine` event that staged
  // the stop to the citation step that actually charges for it.
  const pendingFineReasonRef = useRef<string | null>(null);
  // The interaction cutscene being performed (refuel, boarding, an errand).
  // While set, the canvas locks driving input; its `done` event applies the
  // durable effect (gig state flip) and clears this. The ref mirrors the
  // state so the 10 Hz HUD path and event handler read the live value.
  const [cutscene, setCutscene] = useState<CutsceneRequest | null>(null);
  const cutsceneRef = useRef<CutsceneRequest | null>(null);
  const cutsceneNonceRef = useRef(0);
  // While the pump runs, the fuel bar's CSS transition is stretched to the
  // fill window so the gauge glides while the driver holds the nozzle.
  const [fuelFillMs, setFuelFillMs] = useState(0);
  // ---- Career Mode day state. Money is day-local (dayCash/dayLog) and only
  // lands in the persisted slice at settlement — quitting mid-day redoes the
  // day from the morning. Refs mirror state so multiple money events in one
  // frame all subtract from the live value (same pattern as carConditionRef).
  const [careerRun, setCareerRun] = useState<CareerRun | null>(null);
  const careerRunRef = useRef<CareerRun | null>(null);
  const [dayCash, setDayCash] = useState(0);
  const dayCashRef = useRef(0);
  const dayLogRef = useRef<DayLedgerInput>(emptyDayLog());
  // The day clock accumulates sim time across session resets (a tow zeroes the
  // sim's elapsedMs): on decrease, fold the last-seen value into the base.
  const dayElapsedBaseRef = useRef(0);
  const lastSimElapsedRef = useRef(0);
  const [dayRemainingMs, setDayRemainingMs] = useState(DAY_LENGTH_MS);
  // Day elapsed at the moment GameCanvas lifted its loading gate, or null while
  // it is still building. The "DAY n" title waits for this and then times its
  // 2.6s from it, because the sim — and so the day clock — starts stepping as
  // soon as the session is constructed, well before the models finish
  // preloading. Timed from zero instead, the card spends its whole window
  // underneath "Preparing your drive…" and is half over, or missed entirely, by
  // the time there is a city to see it against (#178 follow-up).
  const [dayIntroFromMs, setDayIntroFromMs] = useState<number | null>(null);
  // The whistle blew mid-cutscene/tow: settle as soon as the scene resolves.
  const pendingSettleRef = useRef(false);
  // Guards double settlement from the 10 Hz HUD stream.
  const dayActiveRef = useRef(false);
  const gigRef = useRef<Gig | null>(null);
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
  } | null>(null);
  // Day-clock timestamp when the current career gig entered "carrying"; the
  // tip window (Crazy Taxi-style par time on the carrying leg) counts from it.
  const [carryingSinceMs, setCarryingSinceMs] = useState<number | null>(null);
  const carryingSinceRef = useRef<number | null>(null);
  // The garage's selection has no state of its own: it lives in `progress` so
  // that it survives a reload, and reading it from one place is what keeps the
  // stored preference and the highlighted card from ever disagreeing.
  const garageVehicleId = progress.lastCareerVehicleId;
  // The GPS line to the current gig. Mirrored into a ref because the search
  // that maintains it runs inside `handleHud`, which cannot read state.
  const [gpsRoute, setGpsRoute] = useState<readonly GpsPoint[] | null>(null);
  const gpsRouteRef = useRef<readonly GpsPoint[] | null>(null);
  const routeTargetRef = useRef<string | null>(null);
  const routeSearchedAtRef = useRef(0);
  const routeLanesRef = useRef<readonly GpsLane[]>([]);
  const [gameMode, setGameMode] = useState<"free" | "career">("free");
  const [touchFirst, setTouchFirst] = useState(false);
  const [needsHomeScreenForFullscreen, setNeedsHomeScreenForFullscreen] =
    useState(false);

  useEffect(() => {
    gigRef.current = gig;
  }, [gig]);

  const chargeCareer = useCallback(
    (amount: number, log?: (current: DayLedgerInput) => DayLedgerInput) => {
      dayCashRef.current -= amount;
      setDayCash(dayCashRef.current);
      if (log) dayLogRef.current = log(dayLogRef.current);
    },
    [],
  );

  const clearCutscene = useCallback(() => {
    cutsceneRef.current = null;
    setCutscene(null);
    setFuelFillMs(0);
  }, []);

  const beginCutscene = useCallback(
    (
      kind: CutsceneRequest["kind"],
      venueId?: string,
      actorSeedId?: string,
      missingFuelFraction?: number,
    ) => {
      if (cutsceneRef.current || towingRef.current) return;
      cutsceneNonceRef.current += 1;
      const request: CutsceneRequest = {
        nonce: cutsceneNonceRef.current,
        kind,
        venueId,
        actorSeedId,
        missingFuelFraction,
      };
      cutsceneRef.current = request;
      setCutscene(request);
    },
    [],
  );
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

  // Assigned each render so the 10 Hz HUD callback below always calls the
  // freshest closure without itself needing to be rebuilt.
  const endCareerDayRef = useRef<() => void>(() => {});

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
      return;
    }
    // Pickup and drop-off are separate destinations at the same venue id.
    const targetKey = `${target.id}:${gigRef.current?.state ?? ""}`;
    const fresh = routeTargetRef.current === targetKey;
    if (
      fresh &&
      routeDeviationM(
        gpsRouteRef.current ?? [],
        snapshot.playerX,
        snapshot.playerZ,
      ) <= ROUTE_DEVIATION_LIMIT_M
    ) {
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
      gpsGraphForLanes(routeLanesRef.current),
      { x: snapshot.playerX, z: snapshot.playerZ },
      snapshot.heading,
      target,
    );
    const route = found.length > 1 ? found : null;
    gpsRouteRef.current = route;
    setGpsRoute(route);
  }, []);

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
    updateGpsRoute(snapshot);
    if (run && dayActiveRef.current) {
      if (snapshot.simElapsedMs < lastSimElapsedRef.current) {
        dayElapsedBaseRef.current += lastSimElapsedRef.current;
      }
      lastSimElapsedRef.current = snapshot.simElapsedMs;
      const elapsed = dayElapsedBaseRef.current + snapshot.simElapsedMs;
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
  }, [updateGpsRoute]);

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

  const destination = getDestinationProfile(destinationId);
  const country = getCountryProfile(destination.countryId);
  const driveDestination = getDestinationProfile(
    activeSession?.destinationId ?? destinationId,
  );
  const driveCountry = getCountryProfile(driveDestination.countryId);
  const activeSteeringSide = resolveSteeringSide(
    activeSession?.steeringPreference ?? "auto",
    driveCountry,
  );

  // The car is a write-off: fade to the tow overlay, debit the repair bill,
  // snap the car back to its spawn repaired, and fade back in. No button, no
  // modal — the drive itself never stops being playable for long.
  const beginTow = useCallback(() => {
    if (towingRef.current) return;
    towingRef.current = true;
    setTowing(true);
    // A scene in flight is torn down by the session's reset; drop the app
    // side too so nothing waits on a `done` that will never come.
    clearCutscene();
    const fee = REPAIR_FEE_BY_COUNTRY[driveCountry.id];
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
      towResetNonceRef.current += 1;
      setTowResetNonce(towResetNonceRef.current);
      carConditionRef.current = FULL_CONDITION_PCT;
      setCarCondition(FULL_CONDITION_PCT);
    }, reduced ? 80 : 900);
    window.setTimeout(() => {
      towingRef.current = false;
      setTowing(false);
      // The whistle blew during the tow: settle now that the overlay is gone.
      if (pendingSettleRef.current && careerRunRef.current) {
        pendingSettleRef.current = false;
        endCareerDayRef.current();
      }
    }, reduced ? 500 : 2400);
  }, [progress, driveCountry, clearCutscene, chargeCareer]);

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
      if (event.type === "cutscene") {
        const active = cutsceneRef.current;
        const evidence = event.evidence ?? {};
        if (!active || evidence.nonce !== active.nonce) return;
        if (evidence.phase === "cite") {
          // The officer is at the window. Career fines are day-local like
          // every other career charge; free drive debits the country wallet.
          const fine = FINE_BY_COUNTRY[driveCountry.id];
          if (careerRunRef.current) {
            chargeCareer(fine, (log) => ({
              ...log,
              finesTotal: log.finesTotal + fine,
            }));
          } else {
            const fined = debit(progress, driveCountry.id, fine);
            setProgress(fined);
            saveProgress(fined);
          }
          setFineToast({
            amount: fine,
            reason: pendingFineReasonRef.current ?? fineReason(undefined),
          });
          return;
        }
        if (evidence.phase === "pump") {
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
            const litres = Math.max(0, run.vehicle.tankL - driveFuel);
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
            setFuelFillMs(
              typeof evidence.durationMs === "number" ? evidence.durationMs : 0,
            );
            setDriveFuel(run.vehicle.tankL);
            return;
          }
          const litres = Math.max(0, TANK_CAPACITY_L - driveFuel);
          const cost =
            Math.round(
              litres * FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] * 100,
            ) / 100;
          const refueled = setFuel(
            debit(progress, driveCountry.id, cost),
            driveCountry.id,
            TANK_CAPACITY_L,
          );
          setProgress(refueled);
          saveProgress(refueled);
          setFuelFillMs(
            typeof evidence.durationMs === "number" ? evidence.durationMs : 0,
          );
          setDriveFuel(TANK_CAPACITY_L);
          return;
        }
        if (evidence.phase === "done") {
          clearCutscene();
          if (active.kind === "board" || active.kind === "food_pickup") {
            setGig((current) =>
              current && current.state === "enroute_pickup"
                ? { ...current, state: "carrying" }
                : current,
            );
            if (careerRunRef.current) {
              const elapsed =
                dayElapsedBaseRef.current + lastSimElapsedRef.current;
              carryingSinceRef.current = elapsed;
              setCarryingSinceMs(elapsed);
            }
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
              );
              // On-time within the par window earns the commission-free tip;
              // late still pays the base net — no hard fail.
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
              const onTime = since !== null && elapsedNow - since <= parMs;
              const tip = careerTip(gross, onTime);
              carryingSinceRef.current = null;
              setCarryingSinceMs(null);
              dayCashRef.current += net + tip;
              setDayCash(dayCashRef.current);
              dayLogRef.current = {
                ...dayLogRef.current,
                grossFares: dayLogRef.current.grossFares + gross,
                netFares: dayLogRef.current.netFares + net,
                tips: dayLogRef.current.tips + tip,
                gigsCompleted: dayLogRef.current.gigsCompleted + 1,
                gigsOnTime: dayLogRef.current.gigsOnTime + (onTime ? 1 : 0),
              };
              const careerCountry = getCountryProfile(run.city.countryId);
              const careerMap = getMapPack(
                getFreeDrive(
                  getDestinationProfile(run.city.destinationId).freeDriveId,
                ).mapId,
              );
              gigSeedRef.current += 1;
              const nextGig = nextGigFor(
                careerMap,
                careerCountry,
                gigSeedRef.current,
                gigKindHistoryRef.current,
                run.vehicle.allowedGigKinds,
              );
              if (nextGig) {
                gigKindHistoryRef.current = [
                  ...gigKindHistoryRef.current,
                  nextGig.kind,
                ].slice(-MAX_SAME_KIND_STREAK);
              }
              gigRef.current = nextGig;
              setGig(nextGig);
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
          lastPedFineAtRef.current = now;
          const amount = FINE_BY_COUNTRY[driveCountry.id];
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
          setFineToast({
            amount,
            reason:
              roadUser === "cyclist"
                ? "striking a cyclist"
                : "striking a pedestrian",
          });
        }
        return;
      }
      if (event.type !== "fine") return;
      const now = Date.now();
      if (now - lastFineAtRef.current < 8000) return;
      // The stop *is* the citation: stage the pull-over and let its `cite`
      // step debit, the same way the pump scene pays for its fuel. A scene
      // already running (or a tow) means the violation goes uncited rather
      // than queueing behind it — the debounce clock only starts once a stop
      // actually begins, so the next one is not swallowed too.
      if (cutsceneRef.current || towingRef.current) return;
      lastFineAtRef.current = now;
      pendingFineReasonRef.current = fineReason(event.ruleCode);
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
    ],
  );

  // Auto-dismiss the fine toast a few seconds after it appears.
  useEffect(() => {
    if (!fineToast) return;
    const timer = window.setTimeout(() => setFineToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [fineToast]);

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
  const activeScenarioId = activeSession?.scenarioId ?? destination.freeDriveId;
  const activeFreeDrive = getFreeDrive(activeScenarioId);
  const runtimeMap = getMapPack(activeFreeDrive.mapId);
  // `handleHud` searches the lane graph but is a `[]`-deps callback, so the
  // active city reaches it the way `gig` does — through a ref kept in step.
  useEffect(() => {
    routeLanesRef.current = runtimeMap.laneGraph.lanes;
  }, [runtimeMap]);
  // A career day is the same open-world scenario under a per-day identity and
  // seed, so the remount key rolls the world over between days and a retried
  // day replays identically.
  const runtimeLesson: GameCanvasLesson = careerRun
    ? buildCareerDayLesson(
        activeFreeDrive,
        driveCountry.trafficSide,
        careerRun.city.day,
        careerDayTrafficSeed(
          careerRun.slice.careerSeed,
          careerRun.city.day,
          careerCityIndex(careerRun.city.destinationId),
        ),
      )
    : buildFreeDriveLesson(activeFreeDrive, driveCountry.trafficSide);

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

  // Pay out a completed delivery and immediately offer the next one. Guarded by
  // paidGigRef so re-renders can't double-credit the same gig. Free drive only:
  // career gigs are paid synchronously in the cutscene done handler so a
  // drop-off at the whistle lands before settlement.
  useEffect(() => {
    if (careerRunRef.current) return;
    if (!gig || gig.state !== "delivered" || paidGigRef.current === gig.id) {
      return;
    }
    paidGigRef.current = gig.id;
    const settled: PlayerProgressV2 = {
      ...credit(progress, driveCountry.id, gig.reward),
      completedGigCount: progress.completedGigCount + 1,
    };
    setProgress(settled);
    saveProgress(settled);
    gigSeedRef.current += 1;
    const nextGig = nextGigFor(
      runtimeMap,
      driveCountry,
      gigSeedRef.current,
      gigKindHistoryRef.current,
    );
    if (nextGig) {
      gigKindHistoryRef.current = [
        ...gigKindHistoryRef.current,
        nextGig.kind,
      ].slice(-MAX_SAME_KIND_STREAK);
    }
    setGig(nextGig);
  }, [gig, progress, driveCountry, runtimeMap]);

  const chooseDestination = (id: DestinationId) => {
    setDestinationId(id);
  };

  const beginDrive = (
    scenarioId: ScenarioId,
    nextDestinationId = destinationId,
  ) => {
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
    const session: GameSessionConfig = {
      countryId: nextCountryId,
      destinationId: nextDestinationId,
      scenarioId,
      // The car now always matches the local convention; the wheel side is
      // resolved from the country profile, never chosen on the landing page.
      familiarTrafficSide: getCountryProfile(nextCountryId).trafficSide,
      steeringPreference: "auto",
      camera,
      assistance: assistanceFromProgress(progress),
    };
    // Fail fast if a UI regression ever pairs a scenario with a destination
    // whose jurisdiction does not match.
    resolveSessionConfig(session);
    const committedProgress: PlayerProgressV2 = {
      ...progress,
      lastCountryId: nextCountryId,
      lastDestinationId: nextDestinationId,
      preferredCamera: camera,
      updatedAt: new Date().toISOString(),
    };
    setProgress(committedProgress);
    saveProgress(committedProgress);
    setDestinationId(nextDestinationId);
    setActiveSession(session);
    setDriveFuel(committedProgress.fuelByCountry[nextCountryId]);
    lastPoseRef.current = null;
    const nextFreeDrive = getFreeDrive(scenarioId);
    gigSeedRef.current = nextFreeDrive.trafficSeed;
    gigKindHistoryRef.current = [];
    paidGigRef.current = null;
    const firstGig = nextGigFor(
      getMapPack(nextFreeDrive.mapId),
      getCountryProfile(nextCountryId),
      gigSeedRef.current,
      gigKindHistoryRef.current,
    );
    if (firstGig) {
      gigKindHistoryRef.current = [firstGig.kind];
    }
    setGig(firstGig);
    setHud(null);
    setPaused(false);
    carConditionRef.current = FULL_CONDITION_PCT;
    setCarCondition(FULL_CONDITION_PCT);
    towingRef.current = false;
    setTowing(false);
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
    setActiveSession(null);
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
    setActiveSession(null);
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
    const session: GameSessionConfig = {
      countryId: careerCity.countryId,
      destinationId: careerCity.destinationId,
      scenarioId: destinationProfile.freeDriveId,
      familiarTrafficSide: getCountryProfile(careerCity.countryId).trafficSide,
      steeringPreference: "auto",
      camera,
      assistance: assistanceFromProgress(progress),
    };
    resolveSessionConfig(session);
    const run: CareerRun = { slice: careerSlice, city: careerCity, vehicleId, vehicle };
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
    setActiveSession(session);
    // Rentals come with a full tank, included in the rent; nothing persists.
    setDriveFuel(vehicle.tankL);
    lastPoseRef.current = null;
    gigSeedRef.current = careerGigSeedBase(
      careerSlice.careerSeed,
      careerCity.day,
      careerCityIndex(careerCity.destinationId),
    );
    gigKindHistoryRef.current = [];
    paidGigRef.current = null;
    const firstGig = nextGigFor(
      getMapPack(getFreeDrive(destinationProfile.freeDriveId).mapId),
      getCountryProfile(careerCity.countryId),
      gigSeedRef.current,
      gigKindHistoryRef.current,
      vehicle.allowedGigKinds,
    );
    if (firstGig) {
      gigKindHistoryRef.current = [firstGig.kind];
    }
    gigRef.current = firstGig;
    setGig(firstGig);
    carryingSinceRef.current = null;
    setCarryingSinceMs(null);
    setHud(null);
    setPaused(false);
    carConditionRef.current = FULL_CONDITION_PCT;
    setCarCondition(FULL_CONDITION_PCT);
    towingRef.current = false;
    setTowing(false);
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
    const nextSlice = applySettlement(run.slice, ledger, settlement);
    const nextCity = activeCity(nextSlice);
    setLastSettlement({
      result: settlement,
      slice: nextSlice,
      city: nextCity,
      morningCity: run.city,
    });
    // The one mid-career save point: day boundaries only. Tomorrow keeps
    // today's ride, unless the night's reckoning put it out of reach.
    commitGarageVehicle(
      garageDefaultVehicle(
        nextCity,
        // A wipe hands back a fresh sheet with the fleet repossessed: there is
        // no run left for a choice to belong to, so it reopens like a new
        // career rather than on whatever the lost one was driving.
        settlement.outcome === "game_over"
          ? DEFAULT_GARAGE_VEHICLE_ID
          : garageVehicleId,
      ),
      writeCareer(progress, nextSlice),
    );
    careerRunRef.current = null;
    setCareerRun(null);
    setGig(null);
    setPaused(false);
    setActiveSession(null);
    clearCutscene();
    // Music keeps playing across the ledger and garage — they are part of the
    // run, and the next day's start() will pick a fresh track.
    setView(settlement.outcome === "game_over" ? "career-over" : "career-ledger");
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
  const tankCapacityL = careerVehicle ? careerVehicle.tankL : TANK_CAPACITY_L;
  const fuelFraction = tankCapacityL > 0 ? driveFuel / tankCapacityL : 0;
  // Measured to the pumps, not to the lane anchor: the station model is set
  // back ~16-19m from its anchor, so an anchor-radius check offered fuel to a
  // car stopped on the carriageway while refusing it at the pumps themselves.
  const activeGasStation =
    view === "driving" && hud && hud.speed <= 1
      ? (runtimeMap.geometry.servicePoints ?? []).find(
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
  const refuelCost = careerRun
    ? Math.round(
        litresNeeded *
          FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] *
          (careerVehicle?.fuelPriceFactor ?? 1),
      )
    : Math.round(
        litresNeeded * FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] * 100,
      ) / 100;
  const canRefuel = careerRun
    ? litresNeeded > 0.5
    : litresNeeded > 0.5 && walletHere >= refuelCost;
  // Pressing Refuel now stages the pump cutscene; the wallet debit and the
  // fill land when the scene reports the nozzle is in (its `pump` event).
  const refuel = () => {
    if (!canRefuel || cutscene || towing) return;
    beginCutscene(
      "refuel",
      undefined,
      undefined,
      tankCapacityL > 0 ? litresNeeded / tankCapacityL : 0,
    );
  };

  // Pin the pumps rather than the lane anchor. The anchor sits on the
  // carriageway ~19m short of the forecourt, and now that fuel is only offered
  // at the pumps a pin out on the road would send the player to a dead spot.
  const gasPins =
    view === "driving" && tankCapacityL > 0
      ? (runtimeMap.geometry.servicePoints ?? []).flatMap((service) => {
          const pumps = gasStationPumpPositions(
            runtimeMap.laneGraph.lanes,
            service,
          );
          if (!pumps.length) return [];
          return [
            {
              x: pumps.reduce((total, pump) => total + pump.x, 0) / pumps.length,
              z: pumps.reduce((total, pump) => total + pump.z, 0) / pumps.length,
              color: "#5bbf6a",
            },
          ];
        })
      : [];
  const gigTargetVenue = gig ? gigTarget(gig) : null;
  // The tip window for the active career gig: previewed before pickup, counted
  // down while carrying. Derived from the same 10 Hz day-clock state that
  // drives the countdown chip, so it re-renders in step.
  const gigParForCardMs =
    careerRun && gig
      ? gigParMs(
          Math.hypot(
            gig.dropoff.x - gig.pickup.x,
            gig.dropoff.z - gig.pickup.z,
          ),
          careerRun.vehicle.paceFactor,
        )
      : null;
  const tipRemainingMs =
    gigParForCardMs !== null && carryingSinceMs !== null
      ? gigParForCardMs - (DAY_LENGTH_MS - dayRemainingMs - carryingSinceMs)
      : null;
  // How long the "DAY n" title has been up, or null while it is still withheld.
  const dayIntroElapsedMs =
    dayIntroFromMs === null
      ? null
      : DAY_LENGTH_MS - dayRemainingMs - dayIntroFromMs;
  const minimapPins: MinimapPin[] = gigTargetVenue
    ? [
        ...gasPins,
        {
          x: gigTargetVenue.x,
          z: gigTargetVenue.z,
          color: gig?.state === "carrying" ? "#f2c658" : "#e0533f",
          kind: "destination",
        },
      ]
    : gasPins;
  // Drawn from where the car actually is, so the line leads rather than trails.
  // The route itself is searched in `handleHud`; this only slices it.
  const minimapRoute =
    gpsRoute && hud
      ? trimRouteToPlayer(gpsRoute, hud.playerX, hud.playerZ)
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
  const cutsceneCaption = cutscene
    ? cutscene.kind === "refuel"
      ? "Refueling…"
      : cutscene.kind === "roadside_refuel"
        ? "Out of fuel — roadside service…"
        : cutscene.kind === "pullover"
          ? "Pulled over — licence and registration…"
        : cutscene.kind === "board"
        ? "Your rider is getting in…"
        : cutscene.kind === "exit"
          ? "Dropping off your rider…"
          : cutscene.kind === "food_pickup"
            ? "Picking up the order…"
            : "Delivering the order…"
    : null;
  // A street address is a spot outside a row of buildings that look like every
  // other row, so the stop you are heading for gets a lit kerbside beacon.
  const gigStopId = gigTargetVenue?.id ?? null;
  const gigStopCarrying = gig?.state === "carrying";
  // Bound once so the HUD panel narrows it, rather than repeating the
  // `state !== "delivered"` test at every field it reads.
  const activeGig = gig && gig.state !== "delivered" ? gig : null;
  /*
   * The HUD panel's stat strip, as data. Which cells exist varies — a bicycle
   * has no tank, free drive has no day clock — so building the list and letting
   * it flow two-up is what keeps the panel from growing holes.
   */
  const statCells: HudStatCell[] = [];
  if (careerRun) {
    statCells.push({
      id: "clock",
      icon: CLOCK_ICON,
      label: `Day ${careerRun.city.day} time remaining`,
      value: formatClock(dayRemainingMs),
      testId: "day-clock",
      valueColor: dayRemainingMs < 60_000 ? HUD_GOLD : undefined,
    });
  }
  if (tankCapacityL > 0) {
    statCells.push({
      id: "fuel",
      icon: FUEL_PUMP_ICON,
      label: "Fuel",
      value: driveFuel <= 0 ? "EMPTY" : `${Math.round(fuelFraction * 100)}%`,
      valueColor: driveFuel <= 0 ? HUD_CORAL : undefined,
      fill: fuelFraction * 100,
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
  statCells.push({
    id: "condition",
    icon: CAR_ICON,
    label:
      careerVehicle?.visualKind === "bicycle"
        ? "Bike"
        : careerVehicle?.visualKind === "motorbike"
          ? "Motorbike"
          : "Car",
    value: carCondition <= 0 ? "WRECKED" : `${Math.round(carCondition)}%`,
    valueColor: carCondition <= 0 ? HUD_CORAL : undefined,
    fill: carCondition,
    fillColor:
      carCondition <= 25 ? HUD_CORAL : carCondition <= 55 ? HUD_GOLD : HUD_SAGE,
    fillTransition: "width 0.2s ease",
  });

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
      <main className="game-page" style={themeStyle}>
        <GameCanvas
          key={`${driveDestination.id}-${runtimeLesson.id}-${activeSteeringSide}${
            careerRun ? `-${careerRun.vehicleId}` : ""
          }`}
          className="game-canvas"
          trafficSide={runtimeLesson.trafficSide}
          steeringSide={activeSteeringSide}
          lesson={runtimeLesson}
          mapPack={runtimeMap}
          cameraMode={toCanvasCamera(camera)}
          speedUnit={driveCountry.speedUnit === "kmh" ? "km/h" : "mph"}
          paused={paused}
          reducedMotion={progress.accessibility.reducedMotion}
          steeringSensitivity={progress.accessibility.steeringSensitivity}
          fieldOfView={(progress.accessibility.fieldOfView * Math.PI) / 180}
          masterVolume={progress.accessibility.masterVolume}
          effectsVolume={progress.accessibility.effectsVolume}
          cameraShake={progress.accessibility.cameraShake}
          headBob={progress.accessibility.headBob}
          outOfFuel={tankCapacityL > 0 && driveFuel <= 0}
          playerVehicle={
            careerVehicle
              ? {
                  model: careerVehicle.model,
                  visualKind: careerVehicle.visualKind,
                }
              : null
          }
          vehiclePhysics={careerVehicle ? careerVehicle.physics : null}
          carConditionPct={carCondition}
          resetNonce={towResetNonce}
          riderVenueId={riderVenueId}
          gigStopId={gigStopId}
          gigStopCarrying={gigStopCarrying}
          cutscene={cutscene}
          onHudUpdate={handleHud}
          onEvent={handleGameEvent}
          onPauseChange={setPaused}
          onCameraChange={(mode) => setCamera(fromCanvasCamera(mode))}
          onExit={exitDrive}
        />
        {/*
          Cheap contrast insurance. Every HUD element is cream-on-glass, and a
          midday sky or a white building fills the top band with exactly the
          value the text is — so the corners and the two HUD bands get darkened
          and the middle of the road, where the player is actually looking, is
          left alone.
        */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: DRIVE_LAYER.scrim,
            background:
              "linear-gradient(180deg, rgba(9,13,15,.42), transparent 22%, transparent 74%, rgba(9,13,15,.44))," +
              "radial-gradient(120% 110% at 50% 45%, transparent 52%, rgba(5,8,9,.42))",
          }}
        />
        {/*
          The rear-view mirror's housing.

          The reflection itself is not a texture on a mesh — it is a second
          camera rendered into a fixed strip of the canvas. That makes it
          screen-space, so its surround has to be screen-space too: a 3D housing
          hung in the cabin would swing away from its own reflection the moment
          the player glanced left. Both read their rectangle from
          rearViewCssRect, so the frame cannot drift off the glass.

          box-sizing keeps the border outside the reflection: the content box is
          the viewport rectangle exactly, and the housing grows outward from it.
        */}
        {hud?.rearViewVisible && (
          <div
            aria-hidden="true"
            data-testid="rear-view-housing"
            style={{
              position: "absolute",
              boxSizing: "border-box",
              left: `calc(${rearViewCssRect().leftPercent}% - 9px)`,
              top: `calc(${rearViewCssRect().topPercent}% - 8px)`,
              width: `calc(${rearViewCssRect().widthPercent}% + 18px)`,
              height: `calc(${rearViewCssRect().heightPercent}% + 16px)`,
              border: "8px solid #2b2724",
              borderBottomWidth: "10px",
              borderRadius: "14px",
              boxShadow:
                "0 10px 22px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.6)," +
                "inset 0 2px 5px rgba(0,0,0,0.75)",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.hud,
            }}
          />
        )}
        {careerRun && dayIntroElapsedMs !== null && dayIntroElapsedMs < 2600 && hud && (
          <div
            aria-hidden="true"
            data-testid="day-title"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            <div
              style={{
                textAlign: "center",
                color: "#f4f6f8",
                textShadow: "0 4px 24px rgba(0,0,0,0.55)",
                opacity: progress.accessibility.reducedMotion
                  ? 1
                  : Math.min(1, (2600 - dayIntroElapsedMs) / 600),
              }}
            >
              <div
                style={{
                  font: "800 3.2rem/1 system-ui, sans-serif",
                  letterSpacing: "0.12em",
                }}
              >
                DAY {careerRun.city.day}
              </div>
              <div
                style={{
                  font: "600 1rem/1.6 system-ui, sans-serif",
                  opacity: 0.8,
                }}
              >
                {driveDestination.destinationName}
                {hud.scenarioClock ? ` · ${hud.scenarioClock}` : ""}
              </div>
            </div>
          </div>
        )}
        {cutsceneCaption && (
          <div
            role="status"
            style={{
              position: "absolute",
              left: "50%",
              // Bottom-centre is inside the steering region on touch, and a
              // knob track can reach 80px either side of the thumb.
              ...(touchFirst
                ? { top: `calc(${hudInset.top} + 3.4rem)` }
                : { bottom: "1.4rem" }),
              transform: "translateX(-50%)",
              padding: "0.55rem 1.2rem",
              borderRadius: "999px",
              background: "rgba(15, 18, 22, 0.78)",
              backdropFilter: "blur(10px)",
              color: "#f4f6f8",
              font: "600 0.95rem/1.2 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            {cutsceneCaption}
          </div>
        )}
        {fineToast && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: "1.25rem",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              background: "rgba(150, 24, 28, 0.92)",
              color: "#fff",
              font: "700 0.95rem/1.2 system-ui, sans-serif",
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
              zIndex: DRIVE_LAYER.toast,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span aria-hidden="true">🚓</span>
            <span>
              Fined {formatMoney(fineToast.amount, driveCountry)} for{" "}
              {fineToast.reason}
            </span>
          </div>
        )}
        {/*
          One panel, top-left: the job, the money, and the two gauges that can
          end a day. It used to be two cards — the gig up top and a status card
          in the opposite corner — which put the numbers that change together at
          opposite ends of the screen, and on touch cost the whole left rail.
        */}
        <div
          data-testid="drive-status-card"
          style={{
            position: "absolute",
            left: hudInset.left,
            top: hudInset.top,
            // Capped *and* proportional: the speed readout is centred, so on a
            // 568px-wide phone a flat 250px panel runs its right edge straight
            // into the numeral. 37% keeps the two clear at every landscape
            // width without shrinking the panel on the phones that have room.
            width: touchFirst ? "min(250px, 37%)" : 316,
            maxWidth: "calc(100% - 24px)",
            padding: touchFirst ? "9px 11px 9px 17px" : "13px 15px 12px 24px",
            borderRadius: touchFirst ? 14 : 18,
            background: HUD_GLASS,
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,.09)",
            boxShadow: "0 18px 40px -24px rgba(0,0,0,.85)",
            color: HUD_CREAM,
            pointerEvents: "none",
            zIndex: DRIVE_LAYER.hud,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: touchFirst ? 6 : 9,
              top: touchFirst ? 9 : 13,
              bottom: touchFirst ? 9 : 13,
              width: touchFirst ? 3 : 4,
              borderRadius: 999,
              background: activeGig
                ? activeGig.state === "carrying"
                  ? HUD_GOLD
                  : HUD_CORAL
                : HUD_SAGE,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                font: `800 ${touchFirst ? 10 : 12}px/1 ${HUD_SANS}`,
                letterSpacing: ".2em",
                color: activeGig ? HUD_GOLD : "rgba(244,239,222,.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {activeGig && (
                <HudGlyph
                  path={activeGig.kind === "passenger" ? RIDER_ICON : PARCEL_ICON}
                  size={touchFirst ? 13 : 15}
                  color={HUD_GOLD}
                />
              )}
              {activeGig
                ? activeGig.state === "carrying"
                  ? activeGig.kind === "passenger"
                    ? "DROP OFF"
                    : "DELIVER"
                  : "PICK UP"
                : careerRun
                  ? `DAY ${careerRun.city.day}`
                  : "FREE DRIVE"}
            </span>
            <span
              data-testid={careerRun ? "day-cash" : undefined}
              style={{
                flex: "none",
                background: "rgba(244,200,72,.15)",
                border: "1px solid rgba(244,200,72,.4)",
                borderRadius: 999,
                padding: touchFirst ? "3px 9px" : "4px 12px",
                font: `900 ${touchFirst ? 13 : 16}px/1 ${HUD_SANS}`,
                color: careerRun && dayCash < 0 ? HUD_CORAL : HUD_GOLD,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatMoney(careerRun ? dayCash : walletHere, driveCountry)}
            </span>
          </div>
          {activeGig && (
            <>
              <div
                style={{
                  marginTop: touchFirst ? 5 : 7,
                  fontFamily: HUD_SERIF,
                  fontWeight: 700,
                  fontSize: touchFirst ? 18 : 25,
                  lineHeight: 1.05,
                  color: HUD_CREAM,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeGig.state === "carrying" ? activeGig.dropoff.name : activeGig.pickup.name}
              </div>
              <div
                style={{
                  marginTop: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  font: `600 ${touchFirst ? 11 : 13}px/1.25 ${HUD_SANS}`,
                  color: "rgba(244,239,222,.62)",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeGig.state === "carrying"
                    ? `from ${activeGig.pickup.name}`
                    : `then ${activeGig.dropoff.name}`}
                </span>
                {/*
                  Outline where the wallet pill above is filled, and signed —
                  two gold pills stacked otherwise read as the same number
                  twice, when one is what you have and one is what the job pays.
                */}
                <span
                  style={{
                    flex: "none",
                    border: "1px solid rgba(244,200,72,.35)",
                    borderRadius: 999,
                    padding: "2px 7px",
                    font: `800 ${touchFirst ? 10 : 11}px/1 ${HUD_SANS}`,
                    color: HUD_GOLD,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  +{formatMoney(activeGig.reward, driveCountry)}
                </span>
              </div>
              {gigParForCardMs !== null && activeGig.state === "enroute_pickup" && (
                <div
                  style={{
                    marginTop: 4,
                    font: `600 ${touchFirst ? 10 : 12}px/1.2 ${HUD_SANS}`,
                    color: "rgba(244,239,222,.6)",
                  }}
                >
                  Tip window {formatClock(gigParForCardMs)} once picked up
                </div>
              )}
              {activeGig.state === "carrying" && tipRemainingMs !== null && (
                <div
                  data-testid="tip-clock"
                  style={{
                    marginTop: 4,
                    font: `700 ${touchFirst ? 10 : 12}px/1.2 ${HUD_SANS}`,
                    color:
                      tipRemainingMs <= 0
                        ? "rgba(244,239,222,.5)"
                        : tipRemainingMs < (gigParForCardMs ?? 0) * 0.2
                          ? HUD_GOLD
                          : HUD_SAGE,
                  }}
                >
                  {tipRemainingMs > 0
                    ? `Tip ${formatClock(tipRemainingMs)}`
                    : "Tip missed — base fare only"}
                </div>
              )}
              {nearGigStop && !cutscene && hud && hud.speed > 1 && (
                <div
                  style={{
                    marginTop: 4,
                    font: `700 ${touchFirst ? 10 : 12}px/1.2 ${HUD_SANS}`,
                    color: HUD_GOLD,
                  }}
                >
                  Stop the car to{" "}
                  {activeGig.state === "carrying" ? "drop off" : "pick up"}.
                </div>
              )}
            </>
          )}
          <div
            aria-hidden="true"
            style={{
              height: 1,
              background: "rgba(255,255,255,.1)",
              margin: touchFirst ? "8px 0" : "11px 0",
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: touchFirst ? 6 : 8,
            }}
          >
            {chunkPairs(statCells).map((row) => (
              <div
                key={row[0].id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: touchFirst ? 8 : 11,
                }}
              >
                {row.map((cell, index) => [
                  index > 0 ? (
                    <span
                      key={`${cell.id}-rule`}
                      aria-hidden="true"
                      style={{
                        flex: "none",
                        width: 1,
                        height: touchFirst ? 15 : 19,
                        background: "rgba(255,255,255,.1)",
                      }}
                    />
                  ) : null,
                  <HudStat key={cell.id} {...cell} compact={touchFirst} />,
                ])}
              </div>
            ))}
          </div>
          {careerRun?.city.loan && (
            <div
              style={{
                marginTop: touchFirst ? 6 : 8,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                font: `700 ${touchFirst ? 10 : 12}px/1.2 ${HUD_SANS}`,
                color: "rgba(244,239,222,.62)",
              }}
            >
              <span>Debt</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(
                  careerRun.city.loan.principalRemaining,
                  driveCountry,
                )}{" "}
                · {careerRun.city.loan.daysRemaining}d
              </span>
            </div>
          )}
          {careerRun?.city.finalNotice && (
            <div
              style={{
                marginTop: 4,
                font: `900 ${touchFirst ? 10 : 12}px/1.2 ${HUD_SANS}`,
                letterSpacing: ".16em",
                color: HUD_CORAL,
              }}
            >
              FINAL NOTICE
            </div>
          )}
        </div>
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            background: "#0c0e11",
            color: "#f4f6f8",
            textAlign: "center",
            font: "700 1.25rem/1.35 system-ui, sans-serif",
            zIndex: DRIVE_LAYER.curtain,
            opacity: towing ? 1 : 0,
            pointerEvents: "none",
            transition: progress.accessibility.reducedMotion
              ? "none"
              : "opacity 0.4s ease",
          }}
        >
          {towing && (
            <>
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                🚧
              </span>
              <span>
                {careerVehicle && careerVehicle.visualKind !== "car"
                  ? "Your bike's wrecked."
                  : "Your car's a write-off."}
              </span>
              <span style={{ fontSize: "0.95rem", opacity: 0.75 }}>
                {careerVehicle && careerVehicle.visualKind !== "car"
                  ? "Fixed up kerbside — "
                  : "Towed & repaired — "}
                {formatMoney(REPAIR_FEE_BY_COUNTRY[driveCountry.id], driveCountry)}
              </span>
            </>
          )}
        </div>
        {activeGasStation && !cutscene && !towing && tankCapacityL > 0 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              ...(touchFirst
                ? { top: `calc(${hudInset.top} + 3.4rem)` }
                : { bottom: "1.4rem" }),
              transform: "translateX(-50%)",
              zIndex: DRIVE_LAYER.action,
            }}
          >
            <button
              type="button"
              onClick={refuel}
              disabled={!canRefuel}
              style={{
                padding: "0.65rem 1.3rem",
                borderRadius: "999px",
                border: "none",
                cursor: canRefuel ? "pointer" : "not-allowed",
                background: canRefuel ? "#f2c658" : "rgba(60,64,70,0.85)",
                color: canRefuel ? "#1a1c1f" : "#f4f6f8",
                font: "700 1rem/1 system-ui, sans-serif",
                backdropFilter: "blur(10px)",
              }}
            >
              {litresNeeded <= 0.5
                ? `${activeGasStation.label} · Tank full`
                : canRefuel
                  ? `Refuel — ${formatMoney(refuelCost, driveCountry)}`
                  : `Need ${formatMoney(refuelCost, driveCountry)} to fill up`}
            </button>
          </div>
        )}
        {/*
          Right edge, directly under the utility row. The pedals used to be a
          194px-tall stacked column, which owned that whole edge and pushed the
          map inboard beside them; abreast they are ~102px, so the strip between
          the button row and the pedals is free and the map gets the corner a
          driving game expects it in.
        */}
        {hud && (
          <Minimap
            worldSize={runtimeMap.geometry.worldSize}
            roadSurfaces={runtimeMap.geometry.roadSurfaces}
            playerX={hud.playerX}
            playerZ={hud.playerZ}
            heading={hud.heading}
            pins={minimapPins}
            route={minimapRoute}
            size={touchFirst ? TOUCH_MINIMAP_PX : 150}
            anchorStyle={
              touchFirst
                ? {
                    right: hudInset.right,
                    top: `calc(${hudInset.top} + ${TOUCH_TOP_RAIL_PX}px)`,
                    bottom: "auto",
                  }
                : undefined
            }
          />
        )}
        {/*
          The "Visual honk cue" accessibility setting. It used to render inside
          GameCanvas's built-in HUD — which the app has always passed
          `showBuiltInHud={false}`, so the toggle in Settings has never done
          anything. Lives with the HUD that is actually on screen now.
        */}
        {hud?.honking && progress.accessibility.visualHonkIndicator && (
          <div
            role="status"
            data-testid="honk-cue"
            style={{
              position: "absolute",
              left: "50%",
              top: `calc(${hudInset.top} + 3.4rem)`,
              transform: "translateX(-50%)",
              padding: "0.4rem 0.85rem",
              borderRadius: "999px",
              background: "#f2c658",
              color: "#172226",
              font: "800 0.72rem/1 system-ui, sans-serif",
              letterSpacing: "0.08em",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            HORN
          </div>
        )}
        {/*
          Set on the view itself rather than in a panel. Speed is the one number
          read continuously and never deliberately looked at, so it is sized to
          be caught in peripheral vision and given a shadow instead of a plate —
          a pill here would be a second object between the player and the road.
        */}
        {hud && (
          <div
            className="drive-speed"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: hudInset.top,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "baseline",
              gap: touchFirst ? 5 : 8,
              color: HUD_CREAM,
              textShadow: "0 3px 14px rgba(0,0,0,.85)",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.hud,
            }}
          >
            <strong
              style={{
                font: `900 ${touchFirst ? 34 : 46}px/.82 ${HUD_SANS}`,
                letterSpacing: "-0.04em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {hud.speed}
            </strong>
            <span
              style={{
                font: `800 ${touchFirst ? 11 : 14}px/1 ${HUD_SANS}`,
                letterSpacing: ".12em",
                color: "rgba(244,239,222,.62)",
                textTransform: "uppercase",
              }}
            >
              {hud.speedUnit}
            </span>
            {/* Its own chip: butted against the unit it just read as a suffix. */}
            <em
              style={{
                marginLeft: touchFirst ? 2 : 4,
                padding: touchFirst ? "3px 6px" : "4px 8px",
                borderRadius: 6,
                background: "rgba(11,15,17,.55)",
                font: `800 ${touchFirst ? 10 : 13}px/1 ${HUD_SANS}`,
                fontStyle: "normal",
                letterSpacing: ".06em",
                color: "rgba(244,239,222,.72)",
                textShadow: "none",
              }}
            >
              {hud.gear}
            </em>
          </div>
        )}
        <button
          type="button"
          onClick={toggleMusicMuted}
          aria-pressed={musicMuted}
          aria-label={musicMuted ? "Unmute music" : "Mute music"}
          title={musicMuted ? "Unmute music" : "Mute music"}
          style={{
            position: "absolute",
            // Shares the top-right rail with the drive controls' button row,
            // which starts one button-width in from this corner, so it matches
            // those buttons exactly rather than merely sitting beside them.
            top: hudInset.top,
            right: hudInset.right,
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,.13)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)",
            cursor: "pointer",
            padding: 0,
            background: "rgba(11,15,17,.7)",
            backdropFilter: "blur(14px)",
            color: musicMuted ? "rgba(244,239,222,.4)" : HUD_CREAM,
            // A tap target, not a readout — it outranks the HUD it sits beside.
            zIndex: DRIVE_LAYER.action,
          }}
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ display: "block" }}
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
            {musicMuted && <path d="M3 3l18 18" />}
          </svg>
        </button>
        {hud && (
          <div className="sr-only" aria-live="polite">
            Speed {hud.speed} {hud.speedUnit}, gear {hud.gear}.
          </div>
        )}
        {pendingConfirm === "end-day" && (
          <ConfirmDialog
            title="End the day early?"
            body="Today's progress is discarded and the day restarts from the garage."
            cancelLabel="Keep driving"
            confirmLabel="End day"
            onCancel={() => setPendingConfirm(null)}
            onConfirm={finishCareerDayExit}
          />
        )}
      </main>
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
          // The wipe's fresh sheet already chose the garage's opening ride when
          // it settled, so this is only the way back to it.
          onContinue={() => setView("career-garage")}
        />
      )}

      {effectiveView === "launcher" && (
        <section className="launcher-page">
          <div className="launcher-copy">
            <p className="eyebrow">READY TO EARN</p>
            <h1 aria-label="Rise and Grind">
              <>Rise and <em>Grind</em></>
            </h1>

            <div className="mode-toggle" role="group" aria-label="Game mode">
              {(
                [
                  ["free", "Free drive"],
                  ["career", "Career"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={gameMode === mode ? "active" : ""}
                  data-testid={`mode-${mode}`}
                  aria-pressed={gameMode === mode}
                  onClick={() => setGameMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {gameMode === "free" && (
            <>
            <p className="launcher-pick-label">Choose a city</p>
            <div
              className="launcher-destinations"
              role="group"
              aria-label="Destination"
            >
              {DESTINATION_PROFILES.map((item) => {
                const itemCountry = getCountryProfile(item.countryId);
                return (
                <button
                  key={item.id}
                  ref={(node) => {
                    if (node) destinationRefs.current.set(item.id, node);
                    else destinationRefs.current.delete(item.id);
                  }}
                  type="button"
                  className={`${destinationId === item.id ? "active" : ""} ${item.promotion}`}
                  aria-label={`${item.destinationName}. ${item.destinationSubtitle}`}
                  aria-pressed={destinationId === item.id}
                  onClick={() => chooseDestination(item.id)}
                >
                  <span>{itemCountry.flagEmoji}</span>
                  <strong>{item.destinationName}</strong>
                  <small>{item.destinationSubtitle}</small>
                </button>
                );
              })}
            </div>
            </>
            )}

            {gameMode === "free" ? (
              <div className="launcher-actions">
                <button
                  className="primary-button launcher-primary"
                  type="button"
                  aria-label={`Start driving in ${destination.destinationName}`}
                  onClick={() => beginDrive(destination.freeDriveId, destination.id)}
                >
                  Start driving
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            ) : (
              <CareerSetupPanel
                career={progress.career}
                city={careerCity}
                cityName={
                  getDestinationProfile(careerLauncherDestinationId)
                    .destinationName
                }
                country={
                  careerCountry ??
                  getCountryProfile(careerCountryOf(CAREER_START_CITY))
                }
                onStartCareer={startCareer}
                onContinue={() => {
                  // The one entry that reaches the garage across a reload, so
                  // it is where the remembered ride gets re-priced: a career
                  // resumed after a bad night may no longer afford what it was
                  // last showing.
                  if (careerCity) {
                    commitGarageVehicle(
                      garageDefaultVehicle(careerCity, garageVehicleId),
                    );
                  }
                  setView("career-garage");
                }}
                onResetCorrupt={() => resetCareer("launcher")}
              />
            )}
            {/* Before the drive, not after: on iPhone neither the rotate gate
                nor the browser chrome can be removed by code, so the only
                honest move is to say so where it can still be acted on. */}
            {touchFirst && (
              <MobilePlayTips needsHomeScreen={needsHomeScreenForFullscreen} />
            )}
          </div>

          <div
            className="launcher-road-visual"
            aria-label={`${launcherDestination.destinationName} training preview`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static preview art in /public; next/image adds no value for a fixed, non-critical hero */}
            <img
              className="launcher-photo"
              src={DESTINATION_PREVIEW_IMAGES[launcherDestination.id]}
              style={{
                objectPosition: DESTINATION_PREVIEW_FOCUS[launcherDestination.id],
              }}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div className="launcher-place">
              <span>{launcherCountry.flagEmoji} {launcherCountry.countryName}</span>
              <strong>{launcherDestination.destinationName}</strong>
              <em>{launcherDestination.destinationSubtitle}</em>
              <small>Keeps {launcherCountry.trafficSide} · earn on the clock</small>
            </div>
          </div>
          <p className="launcher-legal">
            Familiarisation only—not legal advice or driver instruction. Map data © OpenStreetMap contributors.{" "}
            {/* Which build you are actually looking at. Mobile Safari will
                happily keep serving a cached page long after a deploy, and
                without this there is no way to tell that apart from the deploy
                having failed. */}
            <span data-testid="build-ref" style={{ opacity: 0.55 }}>
              build {BUILD_REF}
            </span>
          </p>
        </section>
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

/**
 * Sets expectations before the drive rather than after it.
 *
 * Neither piece of advice can be replaced by code on an iPhone. Safari has
 * never shipped `ScreenOrientation.lock()`, so the rotate gate is unavoidable;
 * and it has no Fullscreen API for anything but `<video>`, while its own
 * toolbar hiding only responds to scrolling — which the drive screen, being
 * `position: fixed` with `touch-action: none`, structurally cannot do. Added to
 * the Home Screen there is no browser chrome in the first place, so on that
 * device this is the whole answer rather than a nicety.
 */
function MobilePlayTips({ needsHomeScreen }: { needsHomeScreen: boolean }) {
  // Styled in `globals.css` (`.launcher-tip`) rather than inline, unlike the
  // driving HUD: these are launcher chrome, and a landscape phone hides the
  // rotate line — which an inline `display` would have outranked.
  return (
    <>
      <p className="launcher-tip launcher-tip-rotate">
        <span aria-hidden="true">↻</span>
        Best played with your phone sideways.
      </p>
      {needsHomeScreen && (
        <p className="launcher-tip" data-testid="home-screen-tip">
          <span aria-hidden="true">⤴</span>
          <span>
            For a full screen with no browser bars, tap <strong>Share</strong>{" "}
            then <strong>Add to Home Screen</strong>, and open it from there.
          </span>
        </p>
      )}
    </>
  );
}

function OptionPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="choice-control">
      <legend>{label}</legend>
      <div className={`choice-control-options columns-${options.length}`}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              className="choice-control-option"
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              <span className="choice-control-symbol" aria-hidden="true">{option.symbol}</span>
              <span className="choice-control-copy">
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </button>
          );
        })}
      </div>
      {hint && <p className="choice-control-hint">{hint}</p>}
    </fieldset>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  ariaValueText,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  ariaValueText: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const progress = clamp(((value - min) / (max - min)) * 100, 0, 100);
  return (
    <label className="range-control">
      <span><strong>{label}</strong><output>{formatValue(value)}</output></span>
      <input
        aria-label={label}
        aria-valuetext={ariaValueText(value)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SettingsView({ progress, onSave, onReset, onBack }: { progress: PlayerProgressV2; onSave: (value: PlayerProgressV2) => void; onReset: () => void; onBack: () => void }) {
  const [draft, setDraft] = useState(progress);
  const updateAccessibility = (patch: Partial<PlayerProgressV2["accessibility"]>) => setDraft((current) => ({ ...current, accessibility: { ...current.accessibility, ...patch } }));
  return (
    <section className="subpage settings-page">
      <div className="subpage-heading">
        <button className="secondary-button" type="button" onClick={onBack} style={{ marginLeft: "auto" }}>Back to Homepage</button>
      </div>
      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="driving-preferences-title">
          <div className="settings-card-head">
            <h2 id="driving-preferences-title"><span className="settings-card-dot dot-yellow" aria-hidden="true" />Driving preferences</h2>
            <p className="settings-card-sub">How the car handles and frames the road.</p>
          </div>
          <OptionPicker<CameraMode>
            label="Default camera"
            value={draft.preferredCamera}
            options={CAMERA_CHOICES}
            onChange={(preferredCamera) => setDraft((current) => ({ ...current, preferredCamera }))}
          />
          <div className="settings-toggle-stack">
            <Toggle label="Camera shake" checked={draft.accessibility.cameraShake} onChange={(checked) => updateAccessibility({ cameraShake: checked })} />
            <Toggle label="First-person head bob" checked={draft.accessibility.headBob} onChange={(checked) => updateAccessibility({ headBob: checked })} />
          </div>
        </section>
        <section className="settings-card" aria-labelledby="accessibility-audio-title">
          <div className="settings-card-head">
            <h2 id="accessibility-audio-title"><span className="settings-card-dot dot-sage" aria-hidden="true" />Accessibility &amp; audio</h2>
            <p className="settings-card-sub">Readability cues and sound.</p>
          </div>
          <div className="settings-toggle-stack">
            <Toggle label="Subtitles" checked={draft.accessibility.subtitles} onChange={(checked) => updateAccessibility({ subtitles: checked })} />
            <Toggle label="Visual honk cue" checked={draft.accessibility.visualHonkIndicator} onChange={(checked) => updateAccessibility({ visualHonkIndicator: checked })} />
            <Toggle label="Reduced motion" checked={draft.accessibility.reducedMotion} onChange={(checked) => updateAccessibility({ reducedMotion: checked })} />
          </div>
          <div className="settings-range-stack">
            <RangeControl label="Steering sensitivity" value={draft.accessibility.steeringSensitivity} min={0.5} max={2} step={0.1} formatValue={(value) => `${value.toFixed(1)}×`} ariaValueText={(value) => `${value.toFixed(1)} times`} onChange={(steeringSensitivity) => updateAccessibility({ steeringSensitivity })} />
            <RangeControl label="Field of view" value={draft.accessibility.fieldOfView} min={55} max={100} step={1} formatValue={(value) => `${value}°`} ariaValueText={(value) => `${value} degrees`} onChange={(fieldOfView) => updateAccessibility({ fieldOfView })} />
            <RangeControl label="Master volume" value={draft.accessibility.masterVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(masterVolume) => updateAccessibility({ masterVolume })} />
            <RangeControl label="Effects volume" value={draft.accessibility.effectsVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(effectsVolume) => updateAccessibility({ effectsVolume })} />
            <RangeControl label="Music volume" value={draft.accessibility.musicVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(musicVolume) => updateAccessibility({ musicVolume })} />
          </div>
        </section>
      </div>
      <div className="settings-actions">
        <button type="button" className="danger-button" onClick={onReset}>Reset local progress</button>
        <button type="button" className="primary-button" onClick={() => { onSave({ ...draft, updatedAt: new Date().toISOString() }); onBack(); }}>Save settings</button>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><strong>{label}</strong><input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function CreditsView({ onBack }: { onBack: () => void }) {
  const references = Array.from(new Map(COUNTRY_PROFILES.flatMap((country) => country.officialReferences).map((reference) => [reference.id, reference])).values());
  const extracts = [
    ["New York", "nyc-upper-west.json"],
    ["London — South Kensington", "uk-london-south-kensington.json"],
    ["Milton Keynes", "uk-milton-keynes.json"],
    ["Calais / Coquelles", "fr-calais-coquelles.json"],
    ["Tokyo Setagaya", "jp-setagaya.json"],
  ] as const;
  return (
    <section className="subpage credits-page">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">SOURCES &amp; CREDITS</p>
          <h1>Rules should have receipts.</h1>
          <p>Every assessed rule is tied to an official source and review date. OpenStreetMap supplies geography only.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to Homepage</button>
      </div>
      <article className="license-card">
        <h3 className="credits-section-title"><span className="settings-card-dot dot-sage" aria-hidden="true" />Map data — frozen, credited, separate from the law</h3>
        <p>Curbside Rush includes compact snapshots for Upper West Side, South Kensington, Milton Keynes, Calais/Coquelles and Setagaya. Each extract records its bounds, freeze timestamp, source and content checksums, and importer version. The game makes no runtime map requests.</p>
        <div className="map-downloads" aria-label="Download frozen map extracts">
          {extracts.map(([label, filename]) => (
            <a key={filename} href={`/map-data/${filename}`} download>
              <span className="map-glyph" aria-hidden="true">{"{ }"}</span>
              <span className="map-copy"><strong>{label}</strong><small>JSON · importer v2</small></span>
            </a>
          ))}
        </div>
        <a className="osm-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL 1.0 ↗</a>
      </article>
      <h3 className="credits-section-title with-count">
        <span className="settings-card-dot dot-yellow" aria-hidden="true" />Rule sources
        <span className="credits-count">· {references.length} official references</span>
      </h3>
      <div className="source-groups">
        {COUNTRY_PROFILES.map((country) => (
          <section className="source-group" key={country.id}>
            <div className="source-group-head"><span className="flag">{country.flagEmoji}</span> {country.countryName}</div>
            {country.officialReferences.map((reference) => (
              <a className="source-row" key={reference.id} href={reference.url} target="_blank" rel="noreferrer">
                <span className="source-row-copy">
                  <span className="source-juris">{reference.jurisdiction}</span>
                  <strong>{reference.title}</strong>
                  <small>{reference.authority} · reviewed {reference.reviewedOn}</small>
                </span>
                <b className="source-arrow" aria-hidden="true">↗</b>
              </a>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
