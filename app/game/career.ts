// Pure Career Mode economy core: the vehicle catalog, the end-of-day
// settlement (loans, final notice, bankruptcy), fare/tip/par maths, per-day
// seed derivation and the persisted-slice codec. Kept free of app, renderer
// and simulation dependencies (type-only imports), in the style of gigs.ts:
// the app supplies numbers in, gets decisions out, and every rule here is
// unit-testable without a browser.
//
// Money is integer-only in the career country's own currency (JPY has no minor
// units, and integer ledgers avoid float drift across hundreds of days).

import type { GigKind } from "./gigs";
import type { CountryId, DestinationId } from "./types";
import type { VehicleModel } from "./vehicleVisuals";

// ---------------------------------------------------------------------------
// Tunables. Balance rationale lives beside each table; adjust here, not at
// call sites.
// ---------------------------------------------------------------------------

/** Real-time length of one career day, driven by the sim clock (pauses pause it). */
export const DAY_LENGTH_MS = 360_000;

/** The platform's cut of every gross fare. Tips are commission-free. */
export const COMMISSION_RATE = 0.25;

/** Fee folded into a loan at origination (and into each consolidation). */
export const LOAN_ORIGINATION_RATE = 0.15;

/** Settlements a loan spans; installments are ceil(principal / days left). */
export const LOAN_TERM_DAYS = 3;

/** Buying a vehicle outright costs this many days of its rent. */
export const BUYOUT_RENT_MULTIPLIER = 15;

/**
 * Roadside rescue refills the whole tank at this premium over pump price.
 *
 * Also what a tow charges over the same repair done at a shop (`repairPrice`),
 * deliberately: a tow *is* a roadside call-out, and pricing the two rescues off
 * one number is what keeps "the service that comes to you costs more" a rule
 * rather than a coincidence. Retuning it moves both.
 */
export const ROADSIDE_PRICE_FACTOR = 1.5;

/**
 * The career route, in order — **this array is the whole route**. Reorder it,
 * add a city, drop one, and the start city, the unlock order, which ticket goes
 * where and what the travel page lists all follow from it. Nothing else encodes
 * the sequence.
 *
 * Every shipped city is on it. That is not a rule — a city may ship as free
 * drive only — it just happens that the two that were (Milton Keynes and
 * Calais) have since been retired.
 */
export const CAREER_CITIES: readonly DestinationId[] = [
  "us-nyc",
  "jp-tokyo",
  "eg-cairo",
  "uk-london",
];

/** Where every career begins. */
export const CAREER_START_CITY: DestinationId = CAREER_CITIES[0];

/** Position on the ladder, or -1 for a city the career never visits. */
export function careerCityIndex(destinationId: DestinationId): number {
  return CAREER_CITIES.indexOf(destinationId);
}

export function isCareerCity(destinationId: DestinationId): boolean {
  return careerCityIndex(destinationId) >= 0;
}

/** The city a ticket from here would fly to, or null at the end of the ladder. */
export function nextCareerCity(
  destinationId: DestinationId,
): DestinationId | null {
  const index = careerCityIndex(destinationId);
  if (index < 0) return null;
  return CAREER_CITIES[index + 1] ?? null;
}

/**
 * What the onward plane ticket costs, priced in the **departure** city's own
 * currency — you buy it where you are standing. The last city on the ladder has
 * no onward flight and so no entry.
 *
 * Sized at roughly a week of solid driving — more than the entry-level vehicle
 * so it competes with the garage for your cash, but deliberately *less* than
 * the top of the range, because gating each city behind its dearest vehicle
 * would put a ~30-day wall in front of ever seeing the next one. Completing the
 * fleets is the long game; seeing the cities is not.
 * `tests/careerBalance.test.ts` fails if a fare edit puts one out of reach.
 */
export const TICKET_PRICE_BY_DESTINATION: Readonly<
  Partial<Record<DestinationId, number>>
> = {
  "us-nyc": 400,
  "jp-tokyo": 40_000,
  "eg-cairo": 20_000,
};

/**
 * Seed cash: about one sedan rent plus change. It must stay above the motorbike
 * rent — that is what the fresh-career garage preselects, falling back to the
 * free bicycle only if this float ever drops below it.
 */
export const CAREER_STARTING_CASH_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 20,
  uk: 20,
  jp: 3000,
  eg: 1000,
};

/** Flat daily platform subscription, so even a bike day has a floor to beat. */
export const PLATFORM_FEE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 3,
  uk: 3,
  jp: 300,
  eg: 150,
};

/**
 * Flat call-out charge on top of the premium fuel when rescued roadside — and,
 * for the same reason, on top of a tow's repair bill. See `ROADSIDE_PRICE_FACTOR`.
 */
export const ROADSIDE_CALLOUT_FEE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 10,
  uk: 10,
  jp: 1000,
  eg: 500,
};

// ---------------------------------------------------------------------------
// Vehicle catalog
// ---------------------------------------------------------------------------

export type CareerVehicleId =
  | "bicycle"
  | "motorbike"
  | "compact-hatch"
  | "delivery-van"
  | "sport-sedan";

/**
 * Mirrors the optional player-physics fields on SimulationCoreConfig. The
 * compact sedan stays equal to the simulation's defaults in every field but
 * top speed — it is the reference vehicle, and holding the rest of the handling
 * model identical is what keeps the deterministic acceptance replay untouched
 * by career work. Only `maxForwardSpeedMps` departs, by the same +10 mph every
 * motorised career vehicle carries; the simulation's own default is still 22,
 * so free drive is unmoved.
 */
export interface CareerVehiclePhysics {
  readonly maxForwardSpeedMps: number;
  readonly maxReverseSpeedMps: number;
  readonly forwardAccelMps2: number;
  readonly reverseAccelMps2: number;
  readonly brakeBaseMps2: number;
  readonly brakeStrengthMps2: number;
  readonly dragBaseMps2: number;
  readonly dragPerMps: number;
  readonly steerBaseRate: number;
  readonly steerAuthorityRate: number;
  readonly steerAuthoritySpeedMps: number;
  readonly instabilityLateralMps2: number;
  readonly playerRadiusM: number;
  readonly playerCapsuleHalfLengthM: number;
  readonly playerCapsuleRadiusM: number;
}

export interface CareerVehicleSpec {
  readonly id: CareerVehicleId;
  readonly name: string;
  /** Registry key for the rendered mesh; null for the composed bicycle rig. */
  readonly model: VehicleModel | null;
  readonly visualKind: "car" | "bicycle" | "motorbike";
  /** Owned outright (the starter bicycle): always available, never rented. */
  readonly owned: boolean;
  readonly rentByCountry: Readonly<Record<CountryId, number>>;
  readonly buyoutEligible: boolean;
  /** Litres; 0 means the vehicle has no fuel system at all. */
  readonly tankL: number;
  readonly fuelLPerM: number;
  /** Multiplier on the country pump price (premium fuel for premium metal). */
  readonly fuelPriceFactor: number;
  /** Gig kinds this vehicle may be OFFERED — filtering happens at generation. */
  readonly allowedGigKinds: readonly GigKind[];
  readonly fareFactors: Readonly<{ delivery: number; passenger: number }>;
  /** Par-time divisor: faster vehicles get tighter tip windows. */
  readonly paceFactor: number;
  readonly physics: CareerVehiclePhysics;
}

/**
 * The simulation's current player-physics literals, verbatim but for the top
 * speed: 22 m/s plus the catalog-wide 10 mph (4.4704 m/s) uplift.
 */
const HATCH_PHYSICS: CareerVehiclePhysics = {
  maxForwardSpeedMps: 26.4704,
  maxReverseSpeedMps: 7,
  forwardAccelMps2: 5.6,
  reverseAccelMps2: 4.1,
  brakeBaseMps2: 3,
  brakeStrengthMps2: 8.5,
  dragBaseMps2: 0.25,
  dragPerMps: 0.035,
  steerBaseRate: 0.32,
  steerAuthorityRate: 0.95,
  steerAuthoritySpeedMps: 5.5,
  instabilityLateralMps2: 11,
  playerRadiusM: 1.05,
  playerCapsuleHalfLengthM: 1.15,
  playerCapsuleRadiusM: 1.0,
};

/**
 * Rent ascending = risk ascending: pricier vehicles must out-earn their rent,
 * so the garage choice is the difficulty select. Balance intent, measured in
 * median gigs needed to clear rent + the platform fee: the two-wheelers and the
 * sedan land under 2.5 across the ladder, the sports car near 2 (passenger
 * fares carry it), and the delivery van is the tightest tier at ~3.6 in London
 * — deliveries only, on a rent the sports car's fares would shrug off.
 * `careerBalance.test.ts` holds the ceiling at 4 and fails loudly past it.
 */
export const CAREER_VEHICLES: readonly CareerVehicleSpec[] = [
  {
    id: "bicycle",
    name: "Your bicycle",
    model: null,
    visualKind: "bicycle",
    owned: true,
    rentByCountry: { us: 0, uk: 0, jp: 0, eg: 0 },
    buyoutEligible: false,
    tankL: 0,
    fuelLPerM: 0,
    fuelPriceFactor: 0,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1, passenger: 1 },
    paceFactor: 0.45,
    physics: {
      maxForwardSpeedMps: 7.5,
      maxReverseSpeedMps: 2,
      forwardAccelMps2: 2.8,
      reverseAccelMps2: 1.2,
      brakeBaseMps2: 2.5,
      brakeStrengthMps2: 5,
      dragBaseMps2: 0.35,
      dragPerMps: 0.06,
      steerBaseRate: 0.6,
      steerAuthorityRate: 0.7,
      steerAuthoritySpeedMps: 3,
      instabilityLateralMps2: 5.5,
      playerRadiusM: 0.6,
      playerCapsuleHalfLengthM: 0.9,
      playerCapsuleRadiusM: 0.55,
    },
  },
  {
    id: "motorbike",
    name: "Motorbike",
    model: null,
    visualKind: "motorbike",
    owned: false,
    rentByCountry: { us: 10, uk: 10, jp: 1000, eg: 500 },
    buyoutEligible: true,
    tankL: 12,
    fuelLPerM: 0.00135,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1.1, passenger: 1 },
    paceFactor: 1.15,
    physics: {
      maxForwardSpeedMps: 28.4704,
      maxReverseSpeedMps: 3,
      forwardAccelMps2: 6.8,
      reverseAccelMps2: 2.5,
      brakeBaseMps2: 3.2,
      brakeStrengthMps2: 9,
      dragBaseMps2: 0.28,
      dragPerMps: 0.03,
      steerBaseRate: 0.5,
      steerAuthorityRate: 1,
      steerAuthoritySpeedMps: 4.5,
      instabilityLateralMps2: 9,
      playerRadiusM: 0.62,
      playerCapsuleHalfLengthM: 0.95,
      playerCapsuleRadiusM: 0.55,
    },
  },
  {
    // The id says hatch and the car is a sedan: `compact-hatch` is persisted
    // inside the checksummed career slice, so renaming it would invalidate
    // every existing save. Only the label was wrong, so only the label moved.
    id: "compact-hatch",
    name: "Compact sedan",
    model: "compact-hatch",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 16, uk: 16, jp: 1600, eg: 800 },
    buyoutEligible: true,
    tankL: 40,
    fuelLPerM: 0.003,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery", "passenger"],
    fareFactors: { delivery: 1, passenger: 1 },
    paceFactor: 1,
    physics: HATCH_PHYSICS,
  },
  {
    id: "delivery-van",
    name: "Delivery van",
    model: "delivery-van",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 26, uk: 26, jp: 2600, eg: 1300 },
    buyoutEligible: true,
    tankL: 70,
    fuelLPerM: 0.0048,
    fuelPriceFactor: 1,
    allowedGigKinds: ["delivery"],
    fareFactors: { delivery: 1.5, passenger: 1 },
    paceFactor: 0.92,
    physics: {
      maxForwardSpeedMps: 23.4704,
      maxReverseSpeedMps: 6,
      forwardAccelMps2: 4.6,
      reverseAccelMps2: 3.4,
      brakeBaseMps2: 3,
      brakeStrengthMps2: 7,
      dragBaseMps2: 0.3,
      dragPerMps: 0.045,
      steerBaseRate: 0.28,
      steerAuthorityRate: 0.8,
      steerAuthoritySpeedMps: 6,
      instabilityLateralMps2: 8.5,
      playerRadiusM: 1.15,
      playerCapsuleHalfLengthM: 1.45,
      playerCapsuleRadiusM: 1.05,
    },
  },
  {
    id: "sport-sedan",
    name: "Sports car",
    model: "sport-sedan",
    visualKind: "car",
    owned: false,
    rentByCountry: { us: 38, uk: 38, jp: 3800, eg: 1900 },
    buyoutEligible: true,
    tankL: 45,
    fuelLPerM: 0.00525,
    fuelPriceFactor: 1.4,
    allowedGigKinds: ["delivery", "passenger"],
    fareFactors: { delivery: 1, passenger: 1.6 },
    paceFactor: 1.25,
    physics: {
      maxForwardSpeedMps: 31.4704,
      maxReverseSpeedMps: 8,
      forwardAccelMps2: 7.4,
      reverseAccelMps2: 5,
      brakeBaseMps2: 3.5,
      brakeStrengthMps2: 10,
      dragBaseMps2: 0.22,
      dragPerMps: 0.03,
      steerBaseRate: 0.36,
      steerAuthorityRate: 1.1,
      steerAuthoritySpeedMps: 5,
      instabilityLateralMps2: 14,
      playerRadiusM: 1.02,
      playerCapsuleHalfLengthM: 1.12,
      playerCapsuleRadiusM: 0.98,
    },
  },
];

export function getCareerVehicle(id: CareerVehicleId): CareerVehicleSpec {
  const spec = CAREER_VEHICLES.find((vehicle) => vehicle.id === id);
  if (!spec) {
    throw new Error(`Unknown career vehicle: ${id}`);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Career slice (the persisted state) and its codec
// ---------------------------------------------------------------------------

export type BankruptcyRule = "strict" | "grace";

export interface CareerLoan {
  readonly principalRemaining: number;
  readonly daysRemaining: number;
}

export interface CareerStats {
  readonly daysCompleted: number;
  readonly grossEarned: number;
  readonly tipsEarned: number;
  readonly finesPaid: number;
  readonly gigsCompleted: number;
  readonly gigsOnTime: number;
  readonly loansTaken: number;
  readonly largestDebt: number;
}

/**
 * One city's run. Money, debt, day counter, fleet and stats are all local to
 * the city they were earned in: flying somewhere new starts a fresh sheet, and
 * flying back resumes the old one exactly as it was left.
 */
export interface CareerCityState {
  /** 1-based: the next day to play in this city. */
  readonly day: number;
  /**
   * Integer cash at the last boundary. Non-negative while playable (settlement
   * converts shortfalls to loans). Never negative once stored: a bankrupt
   * settlement resets the city rather than banking the deficit.
   */
  readonly cash: number;
  readonly loan: CareerLoan | null;
  /** One strike left: set by re-borrowing while indebted (grace rule). */
  readonly finalNotice: boolean;
  /** Vehicles bought outright here. Rent-free in this city, nowhere else. */
  readonly ownedVehicleIds: readonly CareerVehicleId[];
  readonly stats: CareerStats;
}

export interface CareerSliceV2 {
  /** Bumped whenever the persisted shape changes; older saves decode to null. */
  readonly version: 2;
  /**
   * "won" is sticky: the victory happened, endless play continues. There is no
   * terminal failure state — going bankrupt wipes the city you did it in and
   * leaves the rest of the career standing.
   */
  readonly state: "active" | "won";
  /** Fixed at creation; every per-day seed derives from it. */
  readonly careerSeed: number;
  /** Where the driver is right now. Always a key of `cities`. */
  readonly currentDestinationId: DestinationId;
  /**
   * One entry per city reached. **Presence is the unlock**: a city is playable
   * iff it has a state here, so there is no second list to keep in sync.
   */
  readonly cities: Readonly<Partial<Record<DestinationId, CareerCityState>>>;
  readonly victoryDay: number | null;
  /** Frozen per career so mid-run rule changes can't strand a save. */
  readonly rule: BankruptcyRule;
  /** Storage integrity stamp — see stampCareerChecksum. */
  readonly checksum: string;
}

/** A city's state plus the identity the caller would otherwise have to thread. */
export interface CareerCityView extends CareerCityState {
  readonly destinationId: DestinationId;
  readonly countryId: CountryId;
}

/**
 * A structurally-broken or checksum-mismatched slice is itself persisted
 * state: migrate-on-save would otherwise quietly rebuild a tampered career
 * before the UI ever got to offer the reset.
 */
export interface CareerCorrupt {
  readonly state: "corrupt";
}

export type CareerPersisted = CareerSliceV2 | CareerCorrupt | null;

// Mirrors the id set progress.ts hardcodes; content.test.ts pins the real list
// against DESTINATION_PROFILES, so drift here fails loudly rather than silently.
const DESTINATION_IDS: readonly DestinationId[] = [
  "us-nyc",
  "uk-london",
  "jp-tokyo",
  "eg-cairo",
];

/**
 * The country a destination belongs to, read off its id prefix. This module is
 * deliberately import-free at runtime (see the header), so it cannot ask
 * content.ts — but every destination id is `${countryId}-${place}` and
 * career.test.ts pins that against the real DESTINATION_PROFILES, so the shortcut
 * cannot drift silently.
 */
export function careerCountryOf(destinationId: DestinationId): CountryId {
  return destinationId.slice(0, destinationId.indexOf("-")) as CountryId;
}

const VEHICLE_IDS: readonly CareerVehicleId[] = CAREER_VEHICLES.map(
  (vehicle) => vehicle.id,
);

export function isCareerVehicleId(value: unknown): value is CareerVehicleId {
  return VEHICLE_IDS.includes(value as CareerVehicleId);
}

/**
 * Deterrence, not security: the salt ships in the bundle and anyone who reads
 * it can forge a save. It exists to stop casual localStorage edits only.
 */
const CAREER_CHECKSUM_SALT = "curbside-career-v1/0x5eedc0de";

/**
 * JSON with recursively sorted object keys, so the checksum is independent of
 * property insertion order across serialize/parse round-trips.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${body.join(",")}}`;
}

const fnv1aHex = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export function computeCareerChecksum(
  slice: Omit<CareerSliceV2, "checksum">,
): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slice)) {
    if (key !== "checksum") rest[key] = value;
  }
  return fnv1aHex(CAREER_CHECKSUM_SALT + stableStringify(rest));
}

export function stampCareerChecksum(
  slice: Omit<CareerSliceV2, "checksum">,
): CareerSliceV2 {
  return { ...(slice as CareerSliceV2), checksum: computeCareerChecksum(slice) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isLoan = (value: unknown): value is CareerLoan =>
  isRecord(value) &&
  isInteger(value.principalRemaining) &&
  (value.principalRemaining as number) > 0 &&
  isInteger(value.daysRemaining) &&
  (value.daysRemaining as number) >= 1;

const isStats = (value: unknown): value is CareerStats => {
  if (!isRecord(value)) return false;
  const fields = [
    "daysCompleted",
    "grossEarned",
    "tipsEarned",
    "finesPaid",
    "gigsCompleted",
    "gigsOnTime",
    "loansTaken",
    "largestDebt",
  ];
  return fields.every((field) => isInteger(value[field]) && (value[field] as number) >= 0);
};

const isCityState = (value: unknown): value is CareerCityState => {
  if (!isRecord(value)) return false;
  return (
    isInteger(value.day) &&
    (value.day as number) >= 1 &&
    isInteger(value.cash) &&
    (value.loan === null || isLoan(value.loan)) &&
    typeof value.finalNotice === "boolean" &&
    Array.isArray(value.ownedVehicleIds) &&
    value.ownedVehicleIds.every(isCareerVehicleId) &&
    isStats(value.stats)
  );
};

/**
 * Decodes a persisted career value. Returns null when absent, the verified
 * slice when sound, and the corrupt marker when the structure or checksum is
 * wrong. NEVER clamps — progress.ts's country-map parser is deliberately not
 * reused here: clamping would quietly repair a tampered save.
 *
 * A blob from before the per-city rewrite has no `version` and decodes to
 * **null**, not corrupt: its shape is obsolete rather than tampered with, so the
 * player gets a clean "start a career" instead of a damaged-save alarm. Anything
 * claiming to be the current version and failing still reports corrupt, which is
 * what keeps tamper detection honest.
 *
 * Invariant this relies on: the app only ever replaces the career field
 * through writeCareer/clearCareer (which stamp), so a slice passing through
 * migrate-on-save always re-verifies byte-identically.
 */
export function parseCareerSlice(value: unknown): CareerPersisted {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return { state: "corrupt" };
  }
  if (value.state === "corrupt") {
    return { state: "corrupt" };
  }
  if (value.version !== 2) {
    return null;
  }
  if (
    (value.state !== "active" && value.state !== "won") ||
    !isInteger(value.careerSeed) ||
    !DESTINATION_IDS.includes(value.currentDestinationId as DestinationId) ||
    !isRecord(value.cities) ||
    (value.victoryDay !== null && !isInteger(value.victoryDay)) ||
    (value.rule !== "strict" && value.rule !== "grace") ||
    typeof value.checksum !== "string"
  ) {
    return { state: "corrupt" };
  }
  const cityIds = Object.keys(value.cities);
  if (
    cityIds.length === 0 ||
    !cityIds.every((id) => DESTINATION_IDS.includes(id as DestinationId)) ||
    !cityIds.every((id) => isCityState((value.cities as UnknownCities)[id])) ||
    // The pointer must land on a city that exists, or activeCity has nothing
    // to return and every consumer would be reading undefined.
    !cityIds.includes(value.currentDestinationId as string)
  ) {
    return { state: "corrupt" };
  }
  const slice = value as unknown as CareerSliceV2;
  if (computeCareerChecksum(slice) !== slice.checksum) {
    return { state: "corrupt" };
  }
  // Cairo was inserted before London without changing the persisted shape.
  // A verified pre-Cairo winner legitimately has no Cairo city; reopen it so
  // the new fleet is required for completion while preserving London, every
  // existing city ledger and the current location. This must remain after the
  // checksum comparison: migration is never a repair path for tampered data.
  if (slice.state === "won" && slice.cities["eg-cairo"] === undefined) {
    return stampCareerChecksum({
      ...slice,
      state: "active",
      victoryDay: null,
    });
  }
  return slice;
}

type UnknownCities = Record<string, unknown>;

/** A fresh sheet for a city just arrived in: seed cash, day 1, no fleet. */
export function createCityState(countryId: CountryId): CareerCityState {
  return {
    day: 1,
    cash: CAREER_STARTING_CASH_BY_COUNTRY[countryId],
    loan: null,
    finalNotice: false,
    ownedVehicleIds: [],
    stats: {
      daysCompleted: 0,
      grossEarned: 0,
      tipsEarned: 0,
      finesPaid: 0,
      gigsCompleted: 0,
      gigsOnTime: 0,
      loansTaken: 0,
      largestDebt: 0,
    },
  };
}

/** The city the driver is currently in. The codec guarantees it exists. */
export function activeCity(slice: CareerSliceV2): CareerCityView {
  const state = slice.cities[slice.currentDestinationId];
  if (!state) {
    throw new Error(`Career has no state for ${slice.currentDestinationId}`);
  }
  return {
    ...state,
    destinationId: slice.currentDestinationId,
    countryId: careerCountryOf(slice.currentDestinationId),
  };
}

/**
 * Drops the identity fields `activeCity` adds back on, so a view can be edited
 * and stored without leaking `destinationId`/`countryId` into the saved city —
 * duplicated truth that would then have to be kept in sync with the map key.
 */
export function cityStateOf(view: CareerCityView | CareerCityState): CareerCityState {
  return {
    day: view.day,
    cash: view.cash,
    loan: view.loan,
    finalNotice: view.finalNotice,
    ownedVehicleIds: view.ownedVehicleIds,
    stats: view.stats,
  };
}

/** Replaces one city's state and re-stamps. The only way to mutate a city. */
export function withCity(
  slice: CareerSliceV2,
  destinationId: DestinationId,
  next: CareerCityView | CareerCityState,
): CareerSliceV2 {
  return stampCareerChecksum({
    ...slice,
    cities: { ...slice.cities, [destinationId]: cityStateOf(next) },
  });
}

export function createCareerSlice(input: {
  readonly destinationId: DestinationId;
  readonly careerSeed: number;
  readonly rule?: BankruptcyRule;
}): CareerSliceV2 {
  return stampCareerChecksum({
    version: 2,
    state: "active",
    careerSeed: input.careerSeed >>> 0,
    currentDestinationId: input.destinationId,
    cities: {
      [input.destinationId]: createCityState(careerCountryOf(input.destinationId)),
    },
    victoryDay: null,
    rule: input.rule ?? "grace",
  });
}

// ---------------------------------------------------------------------------
// Per-day seeds
// ---------------------------------------------------------------------------

const avalanche = (value: number): number => {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

/**
 * Deterministic per-day traffic seed. Forced into nonzero 31-bit range because
 * the simulation's xorshift32 stream would stick at a zero seed. Same career
 * seed + day always replays identically — that is what makes a mid-day quit
 * "redo the day", not "reroll the day".
 */
export function careerDayTrafficSeed(
  careerSeed: number,
  day: number,
  // Folded in so day 3 in Tokyo is not day 3 in New York. Defaults to the
  // ladder's first city, which keeps every pre-ladder seed exactly as it was.
  cityIndex = 0,
): number {
  const mixed =
    avalanche(
      (careerSeed >>> 0) ^
        Math.imul(day, 0x9e3779b1) ^
        Math.imul(cityIndex, 0x7feb352d),
    ) & 0x7fffffff;
  return mixed === 0 ? 1 : mixed;
}

/** Base for the day's gig draws; gig i uses base + i, as free drive does. */
export function careerGigSeedBase(
  careerSeed: number,
  day: number,
  cityIndex = 0,
): number {
  const mixed =
    avalanche(
      (careerSeed >>> 0) ^
        0x5eed_ca7 ^
        Math.imul(day, 0x27d4eb2f) ^
        Math.imul(cityIndex, 0x846ca68b),
    ) & 0x7fffffff;
  return mixed === 0 ? 1 : mixed;
}

// ---------------------------------------------------------------------------
// Fares and rent
//
// Tips are not here. They apply in free drive too, so the whole model — the
// quoted food tip, its speed bonus, the rider's hidden percentage and the par
// clock all three read against — lives in `dispatch.ts`. What stays is the part
// that is genuinely Career's: the vehicle's fare factor and the platform's cut.
// ---------------------------------------------------------------------------

export function careerFare(
  baseReward: number,
  kind: GigKind,
  vehicle: CareerVehicleSpec,
): { readonly gross: number; readonly net: number } {
  const factor =
    kind === "delivery" ? vehicle.fareFactors.delivery : vehicle.fareFactors.passenger;
  const gross = Math.round(baseReward * factor);
  const net = Math.round(gross * (1 - COMMISSION_RATE));
  return { gross, net };
}

/**
 * Owned vehicles (the bicycle, or one bought outright) cost nothing to take
 * out. Ownership is per city: the van you bought in New York is still rented in
 * Tokyo, because you left it in New York.
 */
export function vehicleRent(
  vehicle: CareerVehicleSpec,
  city: CareerCityView,
): number {
  if (vehicle.owned || city.ownedVehicleIds.includes(vehicle.id)) {
    return 0;
  }
  return vehicle.rentByCountry[city.countryId];
}

/** True when this city's fleet includes the vehicle (or it is always yours). */
export function ownsVehicle(
  city: CareerCityState,
  vehicle: CareerVehicleSpec,
): boolean {
  return vehicle.owned || city.ownedVehicleIds.includes(vehicle.id);
}

/**
 * What a garage with no history opens on: a new career's day 1, and every
 * fresh sheet that follows one (flying in on a ticket, or a bankruptcy wipe).
 * The bicycle is free but slow enough that clicking past it was every driver's
 * first move; the motorbike is the cheapest ride that actually earns, and
 * `CAREER_STARTING_CASH_BY_COUNTRY` is held above its rent so this stands.
 */
export const DEFAULT_GARAGE_VEHICLE_ID: CareerVehicleId = "motorbike";

/**
 * The ride a garage should open on, given what the driver last chose.
 *
 * Their pick stands whenever the day can start on it — the same `cash >= rent`
 * test the Start Day button uses — so the garage never demotes a selection they
 * could have made by hand. Only a pick that is out of reach makes this walk
 * *down* the catalog, to the dearest vehicle still within the day's means. It
 * can lower a selection but never raise one, which is the whole point: an
 * automatic upgrade would silently put a driver in a car they never chose, on
 * the morning their balance is highest and the rent hurts most.
 *
 * The walk budgets against everything tonight will charge — rent, the platform
 * fee, any loan installment — not rent alone. Defaulting someone onto a vehicle
 * whose rent by itself clears their balance hands them a day that is already
 * short at the whistle, and under `grace` with the final notice standing that
 * shortfall costs them the city. The owned bicycle rents at 0 and is the floor:
 * when not even it covers the obligations it is still the answer, because there
 * is nothing cheaper to fall to.
 *
 * Walking by catalog position rather than by price is deliberate. The order is
 * ascending rent *and* ascending capability, and the two only part company for
 * a vehicle bought outright — which rents at 0 yet is still the better ride, so
 * an owned van must beat the bicycle it now ties with on price.
 */
export function garageDefaultVehicle(
  city: CareerCityView,
  preferred: CareerVehicleId,
): CareerVehicleId {
  if (city.cash >= vehicleRent(getCareerVehicle(preferred), city)) {
    return preferred;
  }
  const obligations =
    PLATFORM_FEE_BY_COUNTRY[city.countryId] +
    (city.loan === null ? 0 : nextInstallment(city.loan));
  const ceiling = CAREER_VEHICLES.findIndex(
    (vehicle) => vehicle.id === preferred,
  );
  for (let index = ceiling - 1; index >= 0; index -= 1) {
    const vehicle = CAREER_VEHICLES[index];
    if (city.cash - vehicleRent(vehicle, city) >= obligations) {
      return vehicle.id;
    }
  }
  return "bicycle";
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** Accumulated live during a day: display + stats rollup, no arithmetic re-applied. */
export interface DayLedgerInput {
  readonly grossFares: number;
  readonly netFares: number;
  readonly tips: number;
  readonly finesTotal: number;
  readonly repairsTotal: number;
  readonly fuelSpendTotal: number;
  readonly rentPaid: number;
  readonly gigsCompleted: number;
  readonly gigsOnTime: number;
}

export function emptyDayLog(): DayLedgerInput {
  return {
    grossFares: 0,
    netFares: 0,
    tips: 0,
    finesTotal: 0,
    repairsTotal: 0,
    fuelSpendTotal: 0,
    rentPaid: 0,
    gigsCompleted: 0,
    gigsOnTime: 0,
  };
}

export type LedgerLineKind =
  | "earnings"
  | "commission_info"
  | "tips"
  | "fines"
  | "repairs"
  | "fuel"
  | "rent_info"
  | "platform_fee"
  | "loan_installment"
  | "loan_cleared"
  | "shortfall"
  | "loan_origination"
  | "final_notice"
  | "bankruptcy"
  | "closing_balance";

export interface LedgerLine {
  readonly kind: LedgerLineKind;
  readonly amount: number;
}

export type SettlementOutcome =
  | "solvent"
  | "borrowed"
  | "final_notice"
  | "game_over";

export interface SettlementResult {
  readonly cash: number;
  readonly loan: CareerLoan | null;
  readonly finalNotice: boolean;
  readonly outcome: SettlementOutcome;
  readonly lines: readonly LedgerLine[];
}

export function nextInstallment(loan: CareerLoan): number {
  const days = Math.max(1, loan.daysRemaining);
  return Math.min(Math.ceil(loan.principalRemaining / days), loan.principalRemaining);
}

/**
 * The end-of-day reckoning, in this exact order:
 *
 *   1. informational recap (earnings landed in cash live during the day)
 *   2. platform fee
 *   3. loan installment — ceil(principal / days remaining) closes the loan
 *      exactly at term and self-corrects after a consolidation
 *   4. shortfall → loan conversion, gated by the bankruptcy rule
 *   5. a fully clean settlement (cash ≥ 0, no loan) clears the final notice
 *
 * Under "grace", re-borrowing while indebted consolidates (principal folded,
 * term reset) and raises the final notice; failing again while the notice
 * stands — even if the old loan was cleared this very settlement — is the end.
 */
export function settleDay(input: {
  readonly cash: number;
  readonly ledger: DayLedgerInput;
  readonly loan: CareerLoan | null;
  readonly finalNotice: boolean;
  readonly platformFee: number;
  readonly rule: BankruptcyRule;
}): SettlementResult {
  const lines: LedgerLine[] = [];
  const { ledger } = input;

  lines.push({ kind: "earnings", amount: ledger.grossFares });
  const commission = ledger.grossFares - ledger.netFares;
  if (commission > 0) lines.push({ kind: "commission_info", amount: -commission });
  if (ledger.tips > 0) lines.push({ kind: "tips", amount: ledger.tips });
  if (ledger.finesTotal > 0) lines.push({ kind: "fines", amount: -ledger.finesTotal });
  if (ledger.repairsTotal > 0) {
    lines.push({ kind: "repairs", amount: -ledger.repairsTotal });
  }
  if (ledger.fuelSpendTotal > 0) {
    lines.push({ kind: "fuel", amount: -ledger.fuelSpendTotal });
  }
  if (ledger.rentPaid > 0) lines.push({ kind: "rent_info", amount: -ledger.rentPaid });

  let cash = input.cash - input.platformFee;
  lines.push({ kind: "platform_fee", amount: -input.platformFee });

  let loan = input.loan;
  if (loan) {
    const installment = nextInstallment(loan);
    cash -= installment;
    lines.push({ kind: "loan_installment", amount: -installment });
    const principal = loan.principalRemaining - installment;
    if (principal > 0) {
      loan = { principalRemaining: principal, daysRemaining: loan.daysRemaining - 1 };
    } else {
      loan = null;
      lines.push({ kind: "loan_cleared", amount: 0 });
    }
  }

  let finalNotice = input.finalNotice;
  let outcome: SettlementOutcome = "solvent";

  if (cash < 0) {
    const shortfall = -cash;
    lines.push({ kind: "shortfall", amount: -shortfall });
    const newDebt = Math.ceil(shortfall * (1 + LOAN_ORIGINATION_RATE));
    const indebted = loan !== null;

    if (input.rule === "grace" && input.finalNotice) {
      // The notice stands until a fully clean settlement; clearing the old
      // loan in step 3 does not buy a fresh strike.
      lines.push({ kind: "bankruptcy", amount: cash });
      return { cash, loan, finalNotice, outcome: "game_over", lines };
    }
    if (input.rule === "strict" && indebted) {
      lines.push({ kind: "bankruptcy", amount: cash });
      return { cash, loan, finalNotice, outcome: "game_over", lines };
    }

    if (indebted) {
      // grace: consolidate into one loan on a fresh term, and raise the notice.
      loan = {
        principalRemaining: (loan as CareerLoan).principalRemaining + newDebt,
        daysRemaining: LOAN_TERM_DAYS,
      };
      finalNotice = true;
      outcome = "final_notice";
      lines.push({ kind: "loan_origination", amount: newDebt });
      lines.push({ kind: "final_notice", amount: 0 });
    } else {
      loan = { principalRemaining: newDebt, daysRemaining: LOAN_TERM_DAYS };
      outcome = "borrowed";
      lines.push({ kind: "loan_origination", amount: newDebt });
    }
    cash = 0;
  } else if (loan === null) {
    finalNotice = false;
  }

  lines.push({ kind: "closing_balance", amount: cash });
  return { cash, loan, finalNotice, outcome, lines };
}

/**
 * Folds a finished day into the current city: day counter, cash/loan/notice
 * from the settlement, stats rollup, and the terminal state on bankruptcy.
 * Only the city that was driven is touched — every other city's sheet is left
 * exactly as it was. Returns a freshly stamped slice ready to persist.
 */
export function applySettlement(
  slice: CareerSliceV2,
  ledger: DayLedgerInput,
  settlement: SettlementResult,
): CareerSliceV2 {
  const city = activeCity(slice);
  const borrowed =
    settlement.outcome === "borrowed" || settlement.outcome === "final_notice";
  const stats: CareerStats = {
    daysCompleted: city.stats.daysCompleted + 1,
    grossEarned: city.stats.grossEarned + ledger.grossFares,
    tipsEarned: city.stats.tipsEarned + ledger.tips,
    finesPaid: city.stats.finesPaid + ledger.finesTotal,
    gigsCompleted: city.stats.gigsCompleted + ledger.gigsCompleted,
    gigsOnTime: city.stats.gigsOnTime + ledger.gigsOnTime,
    loansTaken: city.stats.loansTaken + (borrowed ? 1 : 0),
    largestDebt: Math.max(
      city.stats.largestDebt,
      settlement.loan?.principalRemaining ?? 0,
    ),
  };
  if (settlement.outcome === "game_over") {
    // Bankruptcy is local. The city is wiped back to the day you arrived —
    // starting float, day 1, debts gone, and the fleet repossessed, which is
    // what stops going bust from being a free bailout out of a bad loan. Every
    // other city on the ladder is untouched and still there to fly back to.
    return withCity(
      slice,
      city.destinationId,
      createCityState(city.countryId),
    );
  }
  return withCity(slice, city.destinationId, {
    day: city.day + 1,
    cash: settlement.cash,
    loan: settlement.loan,
    finalNotice: settlement.finalNotice,
    ownedVehicleIds: city.ownedVehicleIds,
    stats,
  });
}

// ---------------------------------------------------------------------------
// Buyout (the win condition)
// ---------------------------------------------------------------------------

export function buyoutPrice(
  vehicle: CareerVehicleSpec,
  countryId: CountryId,
): number {
  return vehicle.rentByCountry[countryId] * BUYOUT_RENT_MULTIPLIER;
}

/**
 * Cash on hand is the only condition. Deliberately: debt does not block a
 * purchase, there is no cap on how many you own, and every eligible vehicle is
 * offered rather than only whichever one the garage has selected. Spending
 * yourself back into a shortfall is a decision the player is allowed to make —
 * settlement will price it tonight.
 */
export function canBuyVehicle(
  slice: CareerSliceV2,
  vehicle: CareerVehicleSpec,
): boolean {
  const city = activeCity(slice);
  return (
    vehicle.buyoutEligible &&
    !city.ownedVehicleIds.includes(vehicle.id) &&
    city.cash >= buyoutPrice(vehicle, city.countryId)
  );
}

/** Adds the vehicle to *this city's* fleet. It stays behind if you fly on. */
export function applyVehiclePurchase(
  slice: CareerSliceV2,
  vehicle: CareerVehicleSpec,
): CareerSliceV2 {
  if (!canBuyVehicle(slice, vehicle)) {
    throw new Error(`Cannot buy ${vehicle.id} here`);
  }
  const city = activeCity(slice);
  return withVictoryIfEarned(
    withCity(slice, city.destinationId, {
      ...city,
      cash: city.cash - buyoutPrice(vehicle, city.countryId),
      ownedVehicleIds: [...city.ownedVehicleIds, vehicle.id],
    }),
  );
}

// ---------------------------------------------------------------------------
// Travel: the ladder, the ticket, and moving between cities already reached
// ---------------------------------------------------------------------------

/** Cities reached so far, in ladder order. Presence in `cities` is the unlock. */
export function unlockedCities(slice: CareerSliceV2): readonly DestinationId[] {
  return CAREER_CITIES.filter((city) => slice.cities[city] !== undefined);
}

/** Price of the flight out of here, or null at the end of the ladder. */
export function ticketPrice(from: DestinationId): number | null {
  if (nextCareerCity(from) === null) return null;
  return TICKET_PRICE_BY_DESTINATION[from] ?? null;
}

/**
 * Buying the ticket is optional and is the only way to reach a new city — you
 * can grind a city as long as you like first. Cash on hand is the only gate,
 * matching vehicle purchases.
 */
export function canBuyTicket(slice: CareerSliceV2): boolean {
  const city = activeCity(slice);
  const next = nextCareerCity(city.destinationId);
  const price = ticketPrice(city.destinationId);
  if (next === null || price === null) return false;
  // Already flown this leg before and come back — the onward city is unlocked,
  // so travel there is free rather than another ticket.
  if (slice.cities[next] !== undefined) return false;
  return city.cash >= price;
}

/**
 * Flies on: debits the ticket from the city you are leaving, opens the next
 * city on a fresh sheet (its own country's starting float, day 1, no fleet),
 * and moves the pointer. Nothing crosses — the money and vehicles you leave
 * behind stay exactly where they are, waiting for you to fly back.
 */
export function applyTicket(slice: CareerSliceV2): CareerSliceV2 {
  if (!canBuyTicket(slice)) {
    throw new Error("No onward ticket available from here");
  }
  const city = activeCity(slice);
  const next = nextCareerCity(city.destinationId) as DestinationId;
  const price = ticketPrice(city.destinationId) as number;
  const paid = withCity(slice, city.destinationId, {
    ...city,
    cash: city.cash - price,
  });
  return withVictoryIfEarned(
    stampCareerChecksum({
      ...paid,
      currentDestinationId: next,
      cities: { ...paid.cities, [next]: createCityState(careerCountryOf(next)) },
    }),
  );
}

/** Moves to a city already reached. Free, instant, and always reversible. */
export function travelTo(
  slice: CareerSliceV2,
  destinationId: DestinationId,
): CareerSliceV2 {
  if (slice.cities[destinationId] === undefined) {
    throw new Error(`${destinationId} has not been reached yet`);
  }
  return stampCareerChecksum({ ...slice, currentDestinationId: destinationId });
}

/** Every vehicle that can be bought at all, cheapest first. */
export function buyableVehicles(): readonly CareerVehicleSpec[] {
  return CAREER_VEHICLES.filter((vehicle) => vehicle.buyoutEligible);
}

/**
 * Beating the game: reach the last city on the ladder and buy every buyable
 * vehicle in *every* city. Reaching London completes the route; owning all four
 * local fleets is the end of it.
 */
export function careerWon(slice: CareerSliceV2): boolean {
  const finalCity = CAREER_CITIES[CAREER_CITIES.length - 1];
  if (slice.cities[finalCity] === undefined) return false;
  return CAREER_CITIES.every((destinationId) => {
    const city = slice.cities[destinationId];
    return city !== undefined && ownsFullFleet(city);
  });
}

/**
 * Stamps the victory the first time it is earned. Applied after every purchase
 * and every flight — the only two moves that can complete the condition.
 */
export function withVictoryIfEarned(slice: CareerSliceV2): CareerSliceV2 {
  if (slice.state === "won" || !careerWon(slice)) return slice;
  return stampCareerChecksum({
    ...slice,
    state: "won",
    victoryDay: activeCity(slice).day,
  });
}

/** True once this city's fleet holds every buyable vehicle. */
export function ownsFullFleet(city: CareerCityState): boolean {
  return buyableVehicles().every((vehicle) =>
    city.ownedVehicleIds.includes(vehicle.id),
  );
}
