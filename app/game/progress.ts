import {
  DEFAULT_GARAGE_VEHICLE_ID,
  isCareerVehicleId,
  parseCareerSlice,
  stampCareerChecksum,
} from "./career";
import type { CareerPersisted, CareerVehicleId } from "./career";
import { STARTING_WALLET_BY_COUNTRY, TANK_CAPACITY_L } from "./economyTables";
import type {
  AccessibilityPreferences,
  CameraMode,
  CountryId,
  DestinationId,
  PlayerProgressV2,
} from "./types";

export const PROGRESS_STORAGE_KEY = "sideswap:v2";

const WALLET_MAX = Number.MAX_SAFE_INTEGER;

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const COUNTRY_IDS = new Set<CountryId>(["us", "uk", "jp", "eg"]);
const DESTINATION_IDS = new Set<DestinationId>([
  "us-nyc",
  "uk-london",
  "jp-tokyo",
  "eg-cairo",
]);

const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  visualHonkIndicator: true,
  reducedMotion: false,
  cameraShake: false,
  headBob: false,
  steeringSensitivity: 1,
  fieldOfView: 72,
  masterVolume: 0.8,
  effectsVolume: 0.8,
  // Under the effects bus by default: music is a bed, not the main event.
  musicVolume: 0.55,
  musicMuted: false,
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const getDefaultStorage = (): ProgressStorage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const parseDestinationId = (value: unknown): DestinationId | undefined =>
  typeof value === "string" && DESTINATION_IDS.has(value as DestinationId)
    ? (value as DestinationId)
    : undefined;

const parseCareerVehicleId = (value: unknown): CareerVehicleId =>
  isCareerVehicleId(value) ? value : DEFAULT_GARAGE_VEHICLE_ID;

const parseCamera = (value: unknown): CameraMode =>
  value === "first_person" ? "first_person" : "third_person";

const parseAccessibility = (value: unknown): AccessibilityPreferences => {
  const record = isRecord(value) ? value : {};
  return {
    visualHonkIndicator: asBoolean(
      record.visualHonkIndicator,
      DEFAULT_ACCESSIBILITY.visualHonkIndicator,
    ),
    reducedMotion: asBoolean(record.reducedMotion, DEFAULT_ACCESSIBILITY.reducedMotion),
    cameraShake: asBoolean(record.cameraShake, DEFAULT_ACCESSIBILITY.cameraShake),
    headBob: asBoolean(record.headBob, DEFAULT_ACCESSIBILITY.headBob),
    steeringSensitivity: clamp(
      record.steeringSensitivity,
      0.5,
      2,
      DEFAULT_ACCESSIBILITY.steeringSensitivity,
    ),
    fieldOfView: clamp(record.fieldOfView, 55, 100, DEFAULT_ACCESSIBILITY.fieldOfView),
    masterVolume: clamp(record.masterVolume, 0, 1, DEFAULT_ACCESSIBILITY.masterVolume),
    effectsVolume: clamp(record.effectsVolume, 0, 1, DEFAULT_ACCESSIBILITY.effectsVolume),
    musicVolume: clamp(record.musicVolume, 0, 1, DEFAULT_ACCESSIBILITY.musicVolume),
    musicMuted: asBoolean(record.musicMuted, DEFAULT_ACCESSIBILITY.musicMuted),
  };
};

const eachCountry = (value: number): Record<CountryId, number> => ({
  us: value,
  uk: value,
  jp: value,
  eg: value,
});

// Reads a persisted per-country number map, clamping each entry to [0, max] and
// falling back to `defaults` for any missing or invalid country. NOT for the
// career slice: career cash may legitimately be negative (the "over" state),
// so that field goes through career.ts's parseCareerSlice instead.
const parseCountryNumberMap = (
  value: unknown,
  defaults: Readonly<Record<CountryId, number>>,
  max: number,
): Record<CountryId, number> => {
  const record = isRecord(value) ? value : {};
  const result = {} as Record<CountryId, number>;
  for (const id of COUNTRY_IDS) {
    result[id] = clamp(record[id], 0, max, defaults[id]);
  }
  return result;
};

const isCountryNumberMap = (
  value: unknown,
): value is Record<CountryId, number> => {
  if (!isRecord(value)) {
    return false;
  }
  for (const id of COUNTRY_IDS) {
    if (typeof value[id] !== "number" || !Number.isFinite(value[id] as number)) {
      return false;
    }
  }
  return true;
};

export function createDefaultProgress(): PlayerProgressV2 {
  return {
    version: 2,
    walletByCountry: { ...STARTING_WALLET_BY_COUNTRY },
    fuelByCountry: eachCountry(TANK_CAPACITY_L),
    lastDestinationId: "uk-london",
    preferredCamera: "third_person",
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    career: null,
    lastCareerVehicleId: DEFAULT_GARAGE_VEHICLE_ID,
  };
}

/** Parses only the current save schema, repairing malformed fields to defaults. */
const parseProgress = (value: unknown): PlayerProgressV2 => {
  const fallback = createDefaultProgress();
  if (!isRecord(value) || value.version !== 2) {
    return fallback;
  }

  return {
    version: 2,
    walletByCountry: parseCountryNumberMap(
      value.walletByCountry,
      STARTING_WALLET_BY_COUNTRY,
      WALLET_MAX,
    ),
    fuelByCountry: parseCountryNumberMap(
      value.fuelByCountry,
      eachCountry(TANK_CAPACITY_L),
      TANK_CAPACITY_L,
    ),
    lastDestinationId:
      parseDestinationId(value.lastDestinationId) ?? fallback.lastDestinationId,
    preferredCamera: parseCamera(value.preferredCamera),
    accessibility: parseAccessibility(value.accessibility),
    career: parseCareerSlice(value.career),
    lastCareerVehicleId: parseCareerVehicleId(value.lastCareerVehicleId),
  };
};

const isNumberInRange = (value: unknown, minimum: number, maximum: number): boolean =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum;

const isAccessibilityPreferences = (
  value: unknown,
): value is AccessibilityPreferences =>
  isRecord(value) &&
  typeof value.visualHonkIndicator === "boolean" &&
  typeof value.reducedMotion === "boolean" &&
  typeof value.cameraShake === "boolean" &&
  typeof value.headBob === "boolean" &&
  isNumberInRange(value.steeringSensitivity, 0.5, 2) &&
  isNumberInRange(value.fieldOfView, 55, 100) &&
  isNumberInRange(value.masterVolume, 0, 1) &&
  isNumberInRange(value.effectsVolume, 0, 1) &&
  isNumberInRange(value.musicVolume, 0, 1) &&
  typeof value.musicMuted === "boolean";

export function isPlayerProgressV2(value: unknown): value is PlayerProgressV2 {
  if (!isRecord(value) || value.version !== 2) {
    return false;
  }
  if (
    !isCountryNumberMap(value.walletByCountry) ||
    !isCountryNumberMap(value.fuelByCountry)
  ) {
    return false;
  }
  for (const id of COUNTRY_IDS) {
    if (!isNumberInRange(value.walletByCountry[id], 0, WALLET_MAX)) return false;
    if (!isNumberInRange(value.fuelByCountry[id], 0, TANK_CAPACITY_L)) return false;
  }
  if (
    typeof value.lastDestinationId !== "string" ||
    !DESTINATION_IDS.has(value.lastDestinationId as DestinationId)
  ) {
    return false;
  }
  if (value.preferredCamera !== "first_person" && value.preferredCamera !== "third_person") {
    return false;
  }
  if (value.career !== null && !isRecord(value.career)) {
    return false;
  }
  return (
    isAccessibilityPreferences(value.accessibility) &&
    isCareerVehicleId(value.lastCareerVehicleId)
  );
}

export function loadProgress(
  storage: ProgressStorage | undefined = getDefaultStorage(),
): PlayerProgressV2 {
  const fallback = createDefaultProgress();
  if (!storage) {
    return fallback;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return fallback;
  }

  if (raw === null) {
    return fallback;
  }

  try {
    const progress = parseProgress(JSON.parse(raw));
    const serializedProgress = JSON.stringify(progress);
    if (raw !== serializedProgress) {
      try {
        storage.setItem(PROGRESS_STORAGE_KEY, serializedProgress);
      } catch {
        // Reading remains useful when storage is full or write access is denied.
      }
    }
    return progress;
  } catch {
    try {
      storage.removeItem?.(PROGRESS_STORAGE_KEY);
    } catch {
      // A broken storage implementation should never prevent the game from loading.
    }
    return fallback;
  }
}

export function saveProgress(
  progress: PlayerProgressV2,
  storage: ProgressStorage | undefined = getDefaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    const normalized = parseProgress(progress);
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function resetProgress(
  storage: ProgressStorage | undefined = getDefaultStorage(),
): PlayerProgressV2 {
  const progress = createDefaultProgress();
  if (storage) {
    try {
      storage.removeItem?.(PROGRESS_STORAGE_KEY);
    } catch {
      // Reset still succeeds in memory when browser storage is unavailable.
    }
  }
  return progress;
}

const withCountryValue = (
  map: Readonly<Record<CountryId, number>>,
  countryId: CountryId,
  next: number,
): Record<CountryId, number> => ({ ...map, [countryId]: next });

/** Adds gig income to a country's wallet. Immutable. */
export function credit(
  progress: PlayerProgressV2,
  countryId: CountryId,
  amount: number,
): PlayerProgressV2 {
  const gain = Math.max(0, amount);
  return {
    ...progress,
    walletByCountry: withCountryValue(
      progress.walletByCountry,
      countryId,
      progress.walletByCountry[countryId] + gain,
    ),
  };
}

/** Spends from a country's wallet, clamped at zero. Immutable. */
export function debit(
  progress: PlayerProgressV2,
  countryId: CountryId,
  amount: number,
): PlayerProgressV2 {
  const spend = Math.max(0, amount);
  return {
    ...progress,
    walletByCountry: withCountryValue(
      progress.walletByCountry,
      countryId,
      Math.max(0, progress.walletByCountry[countryId] - spend),
    ),
  };
}

/** Burns fuel in a country's tank, clamped at zero. Immutable. */
export function consumeFuel(
  progress: PlayerProgressV2,
  countryId: CountryId,
  litres: number,
): PlayerProgressV2 {
  const used = Math.max(0, litres);
  return {
    ...progress,
    fuelByCountry: withCountryValue(
      progress.fuelByCountry,
      countryId,
      Math.max(0, progress.fuelByCountry[countryId] - used),
    ),
  };
}

/**
 * Replaces the career slice, re-stamping its checksum. The ONLY sanctioned
 * write path for the field: saveProgress re-verifies the checksum through
 * the current-schema parser, so a slice mutated any other way would come back as
 * corrupt on the next load.
 */
export function writeCareer(
  progress: PlayerProgressV2,
  career: CareerPersisted,
): PlayerProgressV2 {
  const stamped =
    career !== null && career.state !== "corrupt"
      ? stampCareerChecksum(career)
      : career;
  return { ...progress, career: stamped };
}

/** Abandons the career (bankruptcy restart or manual reset). Immutable. */
export function clearCareer(progress: PlayerProgressV2): PlayerProgressV2 {
  return { ...progress, career: null };
}

/** Sets a country's fuel level, clamped to [0, tank capacity]. Immutable. */
export function setFuel(
  progress: PlayerProgressV2,
  countryId: CountryId,
  litres: number,
): PlayerProgressV2 {
  return {
    ...progress,
    fuelByCountry: withCountryValue(
      progress.fuelByCountry,
      countryId,
      Math.min(TANK_CAPACITY_L, Math.max(0, litres)),
    ),
  };
}
