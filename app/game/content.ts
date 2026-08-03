import type {
  CountryId,
  CountryProfile,
  CountryVisualTheme,
  DestinationId,
  DestinationProfile,
  FreeDriveDefinition,
  FreeDriveId,
  GameSessionConfig,
  MapId,
  MapPack,
  OfficialRuleReference,
  ResolvedGameSessionConfig,
  RuleCode,
  ScenarioId,
  ScoringConfig,
  SteeringPreference,
  SteeringSide,
} from "./types";
import {
  LONDON_FREE_DRIVE,
  LONDON_MAP_PACK,
  LONDON_RULE_REFERENCES,
} from "./londonContent";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
  CAIRO_RULE_REFERENCES,
} from "./cairoContent";
import { NYC_FREE_DRIVE, NYC_MAP_PACK } from "./cities/nyc";
import { TOKYO_FREE_DRIVE, TOKYO_MAP_PACK } from "./cities/tokyo";
import { speedingFineMultiplier } from "./speeding";
import { FULL_CONDITION_PCT } from "./damage";
import {
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  ROADSIDE_PRICE_FACTOR,
} from "./career";

export const CONTENT_REVIEWED_ON = "2026-07-10";

const NYC_THEME: CountryVisualTheme = {
  sky: "#9ed7ef",
  ground: "#6e8a5b",
  road: "#323840",
  laneMarking: "#f5d760",
  accent: "#f36a3d",
  architecture: "warm brick apartment blocks and broad avenues",
  roadsideDetails: ["yellow taxis", "fire hydrants", "street trees"],
};

const LONDON_THEME: CountryVisualTheme = {
  sky: "#b9d3dc",
  ground: "#668a58",
  road: "#393d43",
  laneMarking: "#f3f0dd",
  accent: "#d83b3f",
  architecture: "sandstone museums, stucco terraces and broad civic avenues",
  roadsideDetails: ["red buses", "black cabs", "Belisha beacons"],
};

const TOKYO_THEME: CountryVisualTheme = {
  sky: "#acd9e9",
  ground: "#769b69",
  road: "#44494c",
  laneMarking: "#f7f3df",
  accent: "#e64f52",
  architecture: "compact homes, utility poles and small station-front shops",
  roadsideDetails: ["rail crossings", "bicycles", "vending machines"],
};

const CAIRO_THEME: CountryVisualTheme = {
  sky: "#73afd1",
  ground: "#b9a777",
  road: "#494640",
  laneMarking: "#f4f0dc",
  accent: "#2f8297",
  architecture:
    "warm Khedivial apartments, Garden City villas and Nile-side cultural landmarks",
  roadsideDetails: [
    "white taxis",
    "date palms",
    "bilingual direction signs",
    "Nile feluccas",
  ],
};

const US_RULES: readonly OfficialRuleReference[] = [
  {
    id: "us-ny-dmv-turns",
    title: "New York State Driver's Manual — Intersections and Turns",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-5-intersections-and-turns",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "missing_indicator",
      "one_way",
      "unsafe_gap",
      "observation",
    ],
  },
  {
    id: "us-ny-dmv-passing",
    title: "New York State Driver's Manual — Passing",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-6-passing",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "lane_misuse",
      "merge",
      "unsafe_gap",
      "following_distance",
      "observation",
    ],
  },
  {
    id: "us-nyc-traffic-rules",
    title: "Traffic Rules of the City of New York",
    authority: "New York City Department of Transportation",
    jurisdiction: "New York City, United States",
    url: "https://www.nyc.gov/html/dot/downloads/pdf/trafrule.pdf",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
    ],
  },
];

const UK_RULES: readonly OfficialRuleReference[] = [
  {
    id: "uk-highway-code-general",
    title:
      "The Highway Code — General rules, techniques and advice for drivers and riders",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
      "observation",
    ],
  },
  {
    id: "uk-highway-code-road",
    title: "The Highway Code — Using the road",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "roundabout_yield",
      "merge",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-highway-code-motorways",
    title: "The Highway Code — Motorways",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/motorways-253-to-273",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
      "observation",
    ],
  },
];

const JP_RULES: readonly OfficialRuleReference[] = [
  {
    id: "jp-jaf-traffic-rules",
    title: "Traffic rules in Japan",
    authority: "Japan Automobile Federation",
    jurisdiction: "Japan",
    url: "https://english.jaf.or.jp/driving-in-japan/traffic-rules",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "pedestrian_priority",
      "cyclist_clearance",
      "railway_crossing",
      "observation",
    ],
  },
];

export const COUNTRY_PROFILES: readonly CountryProfile[] = [
  {
    id: "us",
    countryCode: "US",
    countryName: "United States",
    flagEmoji: "🇺🇸",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "mph",
    currency: { code: "USD", symbol: "$", minorUnits: 2 },
    centreLineColor: "yellow",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
      turnOnRed: "permitted_after_stop_unless_signed",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Obey signals and signs; yield to pedestrians and traffic already in a junction.",
    officialReferences: US_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "uk",
    countryCode: "GB",
    countryName: "United Kingdom",
    flagEmoji: "🇬🇧",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "mph",
    currency: { code: "GBP", symbol: "£", minorUnits: 2 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Give way according to signs and markings; at roundabouts, give priority to traffic from the right unless directed otherwise.",
    officialReferences: [...UK_RULES, ...LONDON_RULE_REFERENCES],
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "jp",
    countryCode: "JP",
    countryName: "Japan",
    flagEmoji: "🇯🇵",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "kmh",
    currency: { code: "JPY", symbol: "¥", minorUnits: 0 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Follow signals, stop markings and local priority signs; slow for narrow, shared neighbourhood streets.",
    officialReferences: JP_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "eg",
    countryCode: "EG",
    countryName: "Egypt",
    flagEmoji: "🇪🇬",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "kmh",
    currency: { code: "EGP", symbol: "E£", minorUnits: 2 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Obey signals and signs, keep right, and yield to traffic already circulating at roundabouts.",
    officialReferences: CAIRO_RULE_REFERENCES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
];

export const DESTINATION_PROFILES: readonly DestinationProfile[] = [
  {
    id: "uk-london",
    countryId: "uk",
    destinationName: "London",
    destinationSubtitle: "South Kensington Museum Quarter",
    mapId: "london-south-kensington",
    freeDriveId: "free-uk-london",
    promotion: "featured",
    cityMark: "LDN",
    visualTheme: LONDON_THEME,
  },
  {
    id: "us-nyc",
    countryId: "us",
    destinationName: "New York City",
    destinationSubtitle: "Upper West Side · Broadway & West 72nd Street",
    mapId: "nyc-upper-west-side",
    freeDriveId: "free-us",
    promotion: "standard",
    cityMark: "NYC",
    visualTheme: NYC_THEME,
  },
  {
    id: "jp-tokyo",
    countryId: "jp",
    destinationName: "Tokyo",
    destinationSubtitle: "Gotokuji, Miyanosaka & narrow neighbourhood streets",
    mapId: "tokyo-setagaya",
    freeDriveId: "free-jp",
    promotion: "standard",
    cityMark: "TYO",
    visualTheme: TOKYO_THEME,
  },
  {
    id: "eg-cairo",
    countryId: "eg",
    destinationName: "Cairo",
    destinationSubtitle: "Tahrir, Garden City, Gezira & the Central Nile",
    mapId: "cairo-central-nile",
    freeDriveId: "free-eg",
    promotion: "standard",
    cityMark: "CAI",
    visualTheme: CAIRO_THEME,
  },
];

export const MAP_PACKS: readonly MapPack[] = [
  LONDON_MAP_PACK,
  CAIRO_MAP_PACK,
  NYC_MAP_PACK,
  TOKYO_MAP_PACK,
];

export const FREE_DRIVES: readonly FreeDriveDefinition[] = [
  LONDON_FREE_DRIVE,
  CAIRO_FREE_DRIVE,
  NYC_FREE_DRIVE,
  TOKYO_FREE_DRIVE,
];

/** Fuel-tank capacity in litres (same car everywhere). */
export const TANK_CAPACITY_L = 40;

/** Fuel burned per metre travelled (~2 L/km → ~20 km on a full tank). */
export const FUEL_CONSUMPTION_L_PER_M = 0.002;

/**
 * Pump price per litre, in each country's own currency. Tuned so a full refuel
 * is affordable from the starting wallet before gig income arrives.
 */
export const FUEL_PRICE_PER_LITRE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 0.4,
  uk: 0.45,
  jp: 60,
  eg: 20,
};

/**
 * Below this the pump has nothing worth selling — either the tank is already
 * near enough full or the wallet is near enough empty — and the prompt says so
 * rather than offering a fill. Half a litre is ~250 m of free-drive range, so
 * it is not worth a cutscene either way.
 */
export const MIN_REFUEL_LITRES = 0.5;

/**
 * What a free-drive wallet actually buys at the pump: litres poured and price
 * paid, at the country's flat rate per litre.
 *
 * Short money buys a short fill. The pump used to refuse the sale outright
 * unless the wallet covered the whole missing tank, which stranded a driver who
 * had *some* money and no other way to earn it back (#259); a quarter of the
 * price now pours a quarter of the fuel.
 *
 * **Career deliberately does not price through here.** Its pump is ungated and
 * its charge is allowed to push the day into the red, which is exactly what the
 * night's settlement and its loans exist to absorb — capping it at day cash
 * would leave a driver already in the red no way to buy fuel at all, while the
 * far more expensive roadside rescue stayed free. Same backwardness `repairPrice`
 * avoids by never gating the shop.
 *
 * `cost` is clamped to the wallet as well as derived from it: rounding to minor
 * units must never bill a fraction more than the player is holding.
 */
export function fuelPurchase(
  countryId: CountryId,
  litresWanted: number,
  wallet: number,
): { readonly litres: number; readonly cost: number } {
  const pricePerLitre = FUEL_PRICE_PER_LITRE_BY_COUNTRY[countryId];
  const wanted = Math.max(0, litresWanted);
  const budget = Math.max(0, wallet);
  const litres =
    pricePerLitre > 0 ? Math.min(wanted, budget / pricePerLitre) : wanted;
  return {
    litres,
    cost: Math.min(budget, Math.round(litres * pricePerLitre * 100) / 100),
  };
}

/**
 * Delivery reward per country: base fare plus a per-metre rate over the pickup →
 * drop-off distance, in the local currency.
 */
export const GIG_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 4, ratePerM: 0.012 },
  uk: { base: 4, ratePerM: 0.012 },
  jp: { base: 600, ratePerM: 2 },
  eg: { base: 200, ratePerM: 0.6 },
};

/**
 * Passenger fares carry a pickup premium over parcel deliveries: a higher base
 * plus a slightly steeper per-metre rate, so ferrying a rider pays better than
 * dropping a package the same distance.
 */
export const PASSENGER_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 7, ratePerM: 0.018 },
  uk: { base: 7, ratePerM: 0.018 },
  jp: { base: 1000, ratePerM: 3 },
  eg: { base: 350, ratePerM: 0.9 },
};

/**
 * Flat fine debited when a patrol car witnesses a road violation (wrong side,
 * off-road, running a red). Deliberately modest — a couple of fares' worth — so
 * it nudges rather than punishes; the pivot away from termination means careless
 * driving should cost money, not end the run.
 *
 * Speeding is the exception: it is the one violation the game measures by
 * degree, so it is priced by degree too. See `speedingFine`, which scales from
 * this figure rather than replacing it — every consumer that reasons about what
 * a fine is worth (`REPAIR_RATE_BY_COUNTRY`, the starting-wallet check) still
 * has one number to reason about.
 */
export const FINE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 8,
  uk: 8,
  jp: 800,
  eg: 400,
};

/**
 * A speed in metres per second, read in the unit that country's signs use.
 *
 * The simulation works in m/s and every posted figure is in the local unit, so
 * anything that puts the two side by side — what the officer writes on the
 * ticket, what the toast tells the player — has to cross over once. The pair of
 * constants is the same one `SimulationCore.toDisplaySpeed` uses; there is
 * nowhere to share them from, because `simulation.ts` imports only `./types`
 * and knows nothing of countries.
 */
export function postedSpeed(
  metresPerSecond: number,
  country: CountryProfile,
): number {
  return metresPerSecond * (country.speedUnit === "mph" ? 2.236936 : 3.6);
}

/**
 * What a speeding ticket costs, scaled by how far over the driver was.
 *
 * Every other fine is flat because every other violation is binary — you were
 * on the wrong side of the road or you were not. Speeding has a magnitude, and
 * a flat charge for it says twelve over and forty over are the same offence.
 *
 * `speedingFineMultiplier` runs 1x to 2x; a patrol only cites past its own
 * tolerance, about five over, so real tickets land between roughly 1.25x and
 * 2x — $10 to $16 in New York, one to two short fares. That keeps the
 * "deliberately modest" calibration above: the point is still to nudge, only
 * now it nudges harder the worse the driving.
 *
 * Rounded to a whole unit of the currency, or to the nearest hundred where the
 * currency has no minor units at all — a yen ticket reading Y1,347 would be the
 * only price in the game that does.
 */
export function speedingFine(
  country: CountryProfile,
  overInPostedUnits: number,
): number {
  const base = FINE_BY_COUNTRY[country.id];
  const multiplier = speedingFineMultiplier(
    overInPostedUnits,
    country.speedUnit,
  );
  const step = country.currency.minorUnits === 0 ? 100 : 1;
  return Math.round((base * multiplier) / step) * step;
}

/**
 * What a full rebuild — all 100 condition points — costs at a repair shop.
 *
 * These were the flat tow-and-repair fee before repair shops existed, kept to
 * the digit so the balance they were tuned to still holds: roughly three fines'
 * worth, enough that wrecking the car stings harder than a citation without
 * bankrupting a session. What changed is what they mean. The figure is now the
 * *most* a repair can cost rather than what every repair costs, and the tow
 * charges a premium on top of it (see `repairPrice`).
 */
export const REPAIR_RATE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 25,
  uk: 25,
  jp: 2500,
  eg: 1250,
};

/** Where the work is done — the two ways a damaged car gets fixed. */
export type RepairService = "shop" | "tow";

/**
 * What fixing the car costs, by how broken it is and who does it.
 *
 * The shop bills only the damage actually carried, so the bill scales with the
 * driving; the tow bills all 100 points whatever the car went in with, at the
 * roadside premium and with the roadside call-out on top. That is the same
 * shape — and deliberately the same two constants — as filling up at a pump
 * versus being rescued with a jerrycan: the service that comes to you costs
 * more than the one you drive to.
 *
 * The gap that produces is the point of the feature. A full rebuild is $25 at a
 * shop and $48 towed, so limping in at 40% damage costs $10 against the $48 of
 * pushing on and writing the car off. Damage stops being a binary "am I about
 * to get towed" and becomes a running cost worth managing.
 *
 * The curve is linear on purpose. Anything steeper makes an early detour
 * disproportionately cheap and muddles the one thing the player has to
 * internalise: half the damage, half the price.
 *
 * Rounded to a whole unit of the currency, or to the nearest hundred where the
 * currency has no minor units — the same readability rule `speedingFine` uses,
 * and for the same reason: a yen bill reading ¥1,347 would be the only price in
 * the game that does.
 */
export function repairPrice(
  country: CountryProfile,
  damagePct: number,
  service: RepairService,
): number {
  const billed =
    service === "tow"
      ? FULL_CONDITION_PCT
      : Math.min(FULL_CONDITION_PCT, Math.max(0, damagePct));
  const premium = service === "tow" ? ROADSIDE_PRICE_FACTOR : 1;
  const callout =
    service === "tow" ? ROADSIDE_CALLOUT_FEE_BY_COUNTRY[country.id] : 0;
  const raw =
    ((REPAIR_RATE_BY_COUNTRY[country.id] * billed) / FULL_CONDITION_PCT) *
      premium +
    callout;
  const step = country.currency.minorUnits === 0 ? 100 : 1;
  return Math.round(raw / step) * step;
}

/** Starting cash a new (or migrated) player holds in each country's currency. */
export const STARTING_WALLET_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 20,
  uk: 20,
  jp: 3000,
  eg: 1000,
};

/** Formats an amount in a country's own currency, e.g. £1,250 or ¥3,000. */
export function formatMoney(amount: number, country: CountryProfile): string {
  const { symbol, minorUnits } = country.currency;
  const value = Number.isFinite(amount) ? amount : 0;
  const fixed = Math.abs(value).toFixed(minorUnits);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return `${value < 0 ? "-" : ""}${symbol}${body}`;
}

/**
 * Formats a distance the way that country signs them, e.g. "0.4 mi" or "350 m".
 *
 * There is no `distanceUnit` on a country profile, and adding one would be a
 * second source of truth: `speedUnit` already says which system a country
 * drives in, and it is right for all of them — the mph countries sign in miles,
 * the km/h ones in metres and kilometres.
 *
 * The rounding is deliberately coarse. A guidance readout refreshes ten times a
 * second, and a string that changes every one of those re-lays-out a text node
 * for no benefit — nobody reads a drop-off as 0.37 mi. Quantising to a tenth of
 * a mile or ten metres changes it about once a second, which is also how a real
 * one reads.
 */
export function formatDistance(metres: number, country: CountryProfile): string {
  const { value, unit } = formatDistanceParts(metres, country);
  return `${value} ${unit}`;
}

/**
 * The same figure with the number and the unit kept apart, for a readout that
 * sets them at different sizes — a guidance banner puts the distance at display
 * weight and the unit small beside it. Splitting `formatDistance`'s string on a
 * space would work today and break the first time a unit has one in it.
 */
export function formatDistanceParts(
  metres: number,
  country: CountryProfile,
): { readonly value: string; readonly unit: string } {
  const value = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  if (country.speedUnit === "mph") {
    const miles = value / 1609.344;
    // Below a tenth of a mile "0.1 mi" stops distinguishing anything, and the
    // instruction is imminent, so it switches to the short unit that country
    // signs in — Britain in yards, America in feet.
    if (miles < 0.1) {
      const yards = value * 1.09361;
      if (country.id === "uk") {
        return { value: String(Math.max(10, Math.round(yards / 10) * 10)), unit: "yd" };
      }
      return {
        value: String(Math.max(50, Math.round((yards * 3) / 50) * 50)),
        unit: "ft",
      };
    }
    return { value: miles.toFixed(1), unit: "mi" };
  }
  if (value < 1000) {
    return { value: String(Math.max(10, Math.round(value / 10) * 10)), unit: "m" };
  }
  return { value: (value / 1000).toFixed(1), unit: "km" };
}

export const SCORING_CONFIG: ScoringConfig = {
  weights: {
    safety: 0.5,
    ruleUse: 0.35,
    vehicleControl: 0.15,
  },
  masteryThreshold: 80,
  masteryAllowsCriticalErrors: false,
  criticalRuleCodes: ["collision", "wrong_way", "red_light", "out_of_bounds"],
  penalties: {
    collision: 50,
    wrong_way: 35,
    red_light: 35,
    out_of_bounds: 30,
    speeding: 6,
    incomplete_stop: 8,
    missing_indicator: 4,
    unsafe_gap: 12,
    following_distance: 7,
    lane_misuse: 6,
    one_way: 20,
    roundabout_yield: 12,
    merge: 10,
    pedestrian_priority: 18,
    cyclist_clearance: 12,
    railway_crossing: 20,
    priority_to_right: 10,
    observation: 6,
    border_transition: 15,
    box_junction: 6,
    restricted_lane: 4,
  },
};

const countryById = new Map(COUNTRY_PROFILES.map((profile) => [profile.id, profile]));
const destinationById = new Map(
  DESTINATION_PROFILES.map((profile) => [profile.id, profile]),
);
const mapById = new Map(MAP_PACKS.map((mapPack) => [mapPack.id, mapPack]));
const freeDriveById = new Map(FREE_DRIVES.map((freeDrive) => [freeDrive.id, freeDrive]));

export function getCountryProfile(id: CountryId): CountryProfile {
  const profile = countryById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap country profile: ${id}`);
  }
  return profile;
}

export function getDestinationProfile(id: DestinationId): DestinationProfile {
  const profile = destinationById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap destination profile: ${id}`);
  }
  return profile;
}

export function getMapPack(id: MapId): MapPack {
  const mapPack = mapById.get(id);
  if (!mapPack) {
    throw new Error(`Unknown SideSwap map pack: ${id}`);
  }
  return mapPack;
}

export function getFreeDrive(id: FreeDriveId): FreeDriveDefinition {
  const freeDrive = freeDriveById.get(id);
  if (!freeDrive) {
    throw new Error(`Unknown SideSwap free-drive scenario: ${id}`);
  }
  return freeDrive;
}

export function getFreeDriveForDestination(
  id: DestinationId,
): FreeDriveDefinition {
  const freeDrive = FREE_DRIVES.find((scenario) => scenario.destinationId === id);
  if (!freeDrive) {
    throw new Error(`Missing SideSwap free-drive scenario for destination ${id}`);
  }
  return freeDrive;
}

/**
 * Validates the launch tuple: the chosen free drive must belong to the exact
 * destination, country and map the player selected.
 */
export function isScenarioCompatibleWithDestination(
  scenarioId: ScenarioId,
  destinationId: DestinationId,
): boolean {
  const destination = getDestinationProfile(destinationId);
  const freeDrive = getFreeDrive(scenarioId);
  return (
    freeDrive.destinationId === destinationId &&
    freeDrive.countryId === destination.countryId &&
    freeDrive.mapId === destination.mapId
  );
}

export function resolveSteeringSide(
  preference: SteeringPreference,
  profile: CountryProfile,
): SteeringSide {
  return preference === "auto" ? profile.defaultSteeringSide : preference;
}

export function resolveSessionConfig(config: GameSessionConfig): ResolvedGameSessionConfig {
  const profile = getCountryProfile(config.countryId);
  const destination = getDestinationProfile(config.destinationId);
  if (destination.countryId !== config.countryId) {
    throw new Error(
      `SideSwap destination ${config.destinationId} is not compatible with country ${config.countryId}`,
    );
  }
  if (!isScenarioCompatibleWithDestination(config.scenarioId, config.destinationId)) {
    throw new Error(
      `SideSwap scenario ${config.scenarioId} is not compatible with destination ${config.destinationId}`,
    );
  }
  return {
    ...config,
    trafficSide: profile.trafficSide,
    steeringSide: resolveSteeringSide(config.steeringPreference, profile),
    speedUnit: profile.speedUnit,
  };
}

export function getRuleReference(referenceId: string): OfficialRuleReference | undefined {
  for (const profile of COUNTRY_PROFILES) {
    const reference = profile.officialReferences.find((item) => item.id === referenceId);
    if (reference) {
      return reference;
    }
  }
  return undefined;
}

export function isFreeDriveId(value: string): value is FreeDriveId {
  return freeDriveById.has(value as FreeDriveId);
}

export function getPenaltyForRule(code: RuleCode): number {
  return SCORING_CONFIG.penalties[code] ?? 0;
}
