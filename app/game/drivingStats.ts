import type { CountryId, DrivingStats } from "./types";

export const STATS_COUNTRY_ORDER: readonly CountryId[] = ["us", "jp", "eg", "uk"];

const MAX_TOTAL = Number.MAX_SAFE_INTEGER;

const emptyCountryTotals = (): Record<CountryId, number> => ({
  us: 0,
  uk: 0,
  jp: 0,
  eg: 0,
});

export function createEmptyDrivingStats(): DrivingStats {
  return {
    deliveriesCompleted: 0,
    ridesharesCompleted: 0,
    trafficCitations: 0,
    distanceDrivenM: 0,
    earnedByCountry: emptyCountryTotals(),
    spentByCountry: emptyCountryTotals(),
  };
}

export function trackedDistanceDelta(
  previous: Readonly<{ x: number; z: number }>,
  current: Readonly<{ x: number; z: number }>,
): number {
  const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
  return Number.isFinite(distance) && distance > 0 && distance < 40 ? distance : 0;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseTotal = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_TOTAL, Math.max(0, Math.floor(value)));
};

const parseMoney = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const bounded = Math.min(MAX_TOTAL, Math.max(0, value));
  return Math.round(bounded * 100) / 100;
};

const parseCountryTotals = (value: unknown): Record<CountryId, number> => {
  const record = isRecord(value) ? value : {};
  return {
    us: parseMoney(record.us),
    uk: parseMoney(record.uk),
    jp: parseMoney(record.jp),
    eg: parseMoney(record.eg),
  };
};

export function parseDrivingStats(value: unknown): DrivingStats {
  const record = isRecord(value) ? value : {};
  return {
    deliveriesCompleted: parseTotal(record.deliveriesCompleted),
    ridesharesCompleted: parseTotal(record.ridesharesCompleted),
    trafficCitations: parseTotal(record.trafficCitations),
    distanceDrivenM: parseTotal(record.distanceDrivenM),
    earnedByCountry: parseCountryTotals(record.earnedByCountry),
    spentByCountry: parseCountryTotals(record.spentByCountry),
  };
}

const isTotal = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0;

const isCountryTotals = (value: unknown): boolean =>
  isRecord(value) &&
  STATS_COUNTRY_ORDER.every(
    (countryId) =>
      typeof value[countryId] === "number" &&
      parseMoney(value[countryId]) === value[countryId],
  );

export function isDrivingStats(value: unknown): value is DrivingStats {
  return (
    isRecord(value) &&
    isTotal(value.deliveriesCompleted) &&
    isTotal(value.ridesharesCompleted) &&
    isTotal(value.trafficCitations) &&
    isTotal(value.distanceDrivenM) &&
    isCountryTotals(value.earnedByCountry) &&
    isCountryTotals(value.spentByCountry)
  );
}

const safeAdd = (left: number, right: number): number =>
  Math.min(MAX_TOTAL, left + parseTotal(right));

const safeMoneyAdd = (left: number, right: number): number =>
  parseMoney(left + parseMoney(right));

const addCountryTotals = (
  current: Readonly<Record<CountryId, number>>,
  increment: Readonly<Record<CountryId, number>>,
): Record<CountryId, number> => ({
  us: safeMoneyAdd(current.us, increment.us),
  uk: safeMoneyAdd(current.uk, increment.uk),
  jp: safeMoneyAdd(current.jp, increment.jp),
  eg: safeMoneyAdd(current.eg, increment.eg),
});

export function accumulateDrivingStats(
  current: DrivingStats,
  increment: DrivingStats,
): DrivingStats {
  return {
    deliveriesCompleted: safeAdd(
      current.deliveriesCompleted,
      increment.deliveriesCompleted,
    ),
    ridesharesCompleted: safeAdd(
      current.ridesharesCompleted,
      increment.ridesharesCompleted,
    ),
    trafficCitations: safeAdd(current.trafficCitations, increment.trafficCitations),
    distanceDrivenM: safeAdd(current.distanceDrivenM, increment.distanceDrivenM),
    earnedByCountry: addCountryTotals(
      current.earnedByCountry,
      increment.earnedByCountry,
    ),
    spentByCountry: addCountryTotals(
      current.spentByCountry,
      increment.spentByCountry,
    ),
  };
}

export function drivingStatsIncrement(input: {
  readonly deliveriesCompleted?: number;
  readonly ridesharesCompleted?: number;
  readonly trafficCitations?: number;
  readonly distanceDrivenM?: number;
  readonly earned?: Readonly<{ countryId: CountryId; amount: number }>;
  readonly spent?: Readonly<{ countryId: CountryId; amount: number }>;
}): DrivingStats {
  const increment = createEmptyDrivingStats();
  return {
    ...increment,
    deliveriesCompleted: parseTotal(input.deliveriesCompleted),
    ridesharesCompleted: parseTotal(input.ridesharesCompleted),
    trafficCitations: parseTotal(input.trafficCitations),
    distanceDrivenM: parseTotal(input.distanceDrivenM),
    earnedByCountry: input.earned
      ? {
          ...increment.earnedByCountry,
          [input.earned.countryId]: parseMoney(input.earned.amount),
        }
      : increment.earnedByCountry,
    spentByCountry: input.spent
      ? {
          ...increment.spentByCountry,
          [input.spent.countryId]: parseMoney(input.spent.amount),
        }
      : increment.spentByCountry,
  };
}
