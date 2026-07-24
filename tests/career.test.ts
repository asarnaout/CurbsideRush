import { describe, expect, it } from "vitest";
import {
  activeCity,
  applyBuyout,
  applySettlement,
  careerCountryOf,
  BUYOUT_RENT_MULTIPLIER,
  buyoutPrice,
  canBuyout,
  CAREER_STARTING_CASH_BY_COUNTRY,
  CAREER_VEHICLES,
  careerDayTrafficSeed,
  careerFare,
  careerGigSeedBase,
  careerTip,
  computeCareerChecksum,
  createCareerSlice,
  DAY_LENGTH_MS,
  emptyDayLog,
  getCareerVehicle,
  gigParMs,
  LOAN_ORIGINATION_RATE,
  LOAN_TERM_DAYS,
  nextInstallment,
  PAR_MIN_MS,
  parseCareerSlice,
  PLATFORM_FEE_BY_COUNTRY,
  settleDay,
  stableStringify,
  stampCareerChecksum,
  cityStateOf,
  createCityState,
  vehicleRent,
  withCity,
  type CareerCityState,
  type CareerLoan,
  type DayLedgerInput,
  type SettlementResult,
} from "../app/game/career";
import { DESTINATION_PROFILES } from "../app/game/content";

const log = (overrides: Partial<DayLedgerInput> = {}): DayLedgerInput => ({
  ...emptyDayLog(),
  ...overrides,
});

const settle = (input: {
  cash: number;
  ledger?: DayLedgerInput;
  loan?: CareerLoan | null;
  finalNotice?: boolean;
  platformFee?: number;
  rule?: "strict" | "grace";
}): SettlementResult =>
  settleDay({
    cash: input.cash,
    ledger: input.ledger ?? log(),
    loan: input.loan ?? null,
    finalNotice: input.finalNotice ?? false,
    platformFee: input.platformFee ?? 3,
    rule: input.rule ?? "grace",
  });

const lineKinds = (result: SettlementResult): string[] =>
  result.lines.map((line) => line.kind);

describe("settleDay", () => {
  it("stays solvent when cash covers the platform fee", () => {
    const result = settle({ cash: 40 });
    expect(result.outcome).toBe("solvent");
    expect(result.cash).toBe(37);
    expect(result.loan).toBeNull();
    expect(result.finalNotice).toBe(false);
  });

  it("converts a shortfall into a loan with the 15% origination fee, ceil-rounded", () => {
    const result = settle({ cash: -10, platformFee: 3 });
    expect(result.outcome).toBe("borrowed");
    expect(result.cash).toBe(0);
    // shortfall 13 -> ceil(13 * 1.15) = ceil(14.95) = 15
    expect(result.loan).toEqual({
      principalRemaining: 15,
      daysRemaining: LOAN_TERM_DAYS,
    });
    expect(result.finalNotice).toBe(false);
  });

  it("a fee-only shortfall on a zero-cash day still borrows", () => {
    const result = settle({ cash: 0, platformFee: 3 });
    expect(result.outcome).toBe("borrowed");
    expect(result.loan?.principalRemaining).toBe(
      Math.ceil(3 * (1 + LOAN_ORIGINATION_RATE)),
    );
  });

  it("pays a loan off in exactly its term via ceil-per-remaining-day installments", () => {
    // Principal 100 over 3 days: 34, 33, 33 — sums to exactly 100.
    let loan: CareerLoan | null = { principalRemaining: 100, daysRemaining: 3 };
    const charges: number[] = [];
    for (let day = 0; day < LOAN_TERM_DAYS; day += 1) {
      expect(loan).not.toBeNull();
      const result = settle({ cash: 200, loan });
      const installment = result.lines.find(
        (line) => line.kind === "loan_installment",
      );
      charges.push(-(installment?.amount ?? 0));
      loan = result.loan;
      expect(result.outcome).toBe("solvent");
    }
    expect(charges).toEqual([34, 33, 33]);
    expect(loan).toBeNull();
  });

  it("emits loan_cleared on the settlement that closes the loan", () => {
    const result = settle({
      cash: 50,
      loan: { principalRemaining: 20, daysRemaining: 1 },
    });
    expect(lineKinds(result)).toContain("loan_cleared");
    expect(result.loan).toBeNull();
    expect(result.cash).toBe(50 - 3 - 20);
  });

  it("final-day installment charges the remainder, never more than the principal", () => {
    expect(nextInstallment({ principalRemaining: 7, daysRemaining: 1 })).toBe(7);
    expect(nextInstallment({ principalRemaining: 7, daysRemaining: 3 })).toBe(3);
    expect(nextInstallment({ principalRemaining: 2, daysRemaining: 3 })).toBe(1);
  });

  it("grace: a shortfall while indebted consolidates on a fresh term and raises the notice", () => {
    const result = settle({
      cash: -20,
      loan: { principalRemaining: 60, daysRemaining: 2 },
      rule: "grace",
    });
    expect(result.outcome).toBe("final_notice");
    expect(result.finalNotice).toBe(true);
    expect(result.cash).toBe(0);
    // installment ceil(60/2)=30; shortfall 20+3+30=53; newDebt ceil(53*1.15)=61;
    // consolidated = remaining 30 + 61 = 91 on a reset 3-day term.
    expect(result.loan).toEqual({
      principalRemaining: 91,
      daysRemaining: LOAN_TERM_DAYS,
    });
  });

  it("grace: a shortfall while the notice stands is bankruptcy", () => {
    const result = settle({
      cash: -5,
      loan: { principalRemaining: 30, daysRemaining: 3 },
      finalNotice: true,
      rule: "grace",
    });
    expect(result.outcome).toBe("game_over");
    expect(lineKinds(result)).toContain("bankruptcy");
    expect(result.cash).toBeLessThan(0);
  });

  it("grace: clearing the loan in the same settlement does not spend the notice", () => {
    // Installment clears the debt, but the day still ends short while the
    // notice stands — the noose closes.
    const result = settle({
      cash: 5,
      loan: { principalRemaining: 10, daysRemaining: 1 },
      finalNotice: true,
      platformFee: 3,
      rule: "grace",
    });
    // 5 - 3 - 10 = -8 shortfall with finalNotice set.
    expect(result.outcome).toBe("game_over");
  });

  it("grace: the notice survives a solvent-but-indebted settlement", () => {
    const result = settle({
      cash: 100,
      loan: { principalRemaining: 60, daysRemaining: 3 },
      finalNotice: true,
      rule: "grace",
    });
    expect(result.outcome).toBe("solvent");
    expect(result.finalNotice).toBe(true);
  });

  it("grace: a fully clean settlement clears the notice", () => {
    const result = settle({
      cash: 100,
      loan: { principalRemaining: 10, daysRemaining: 1 },
      finalNotice: true,
      rule: "grace",
    });
    expect(result.outcome).toBe("solvent");
    expect(result.loan).toBeNull();
    expect(result.finalNotice).toBe(false);
  });

  it("strict: a shortfall while indebted is immediate bankruptcy", () => {
    const result = settle({
      cash: -1,
      loan: { principalRemaining: 50, daysRemaining: 3 },
      rule: "strict",
    });
    expect(result.outcome).toBe("game_over");
  });

  it("strict: never yields final_notice, and borrows fine when debt-free", () => {
    const result = settle({ cash: -10, rule: "strict" });
    expect(result.outcome).toBe("borrowed");
    expect(result.finalNotice).toBe(false);
    const sequence: SettlementResult[] = [];
    let loan: CareerLoan | null = null;
    for (let day = 0; day < 6; day += 1) {
      const step = settle({ cash: -5, loan, rule: "strict" });
      sequence.push(step);
      loan = step.loan;
      if (step.outcome === "game_over") break;
    }
    expect(sequence.some((step) => step.outcome === "final_notice")).toBe(false);
    expect(sequence[sequence.length - 1].outcome).toBe("game_over");
  });

  it("grace escalation runs borrowed -> final_notice -> game_over under repeated shortfalls", () => {
    const outcomes: string[] = [];
    let loan: CareerLoan | null = null;
    let finalNotice = false;
    for (let day = 0; day < 4 && outcomes[outcomes.length - 1] !== "game_over"; day += 1) {
      const step = settle({ cash: -10, loan, finalNotice, rule: "grace" });
      outcomes.push(step.outcome);
      loan = step.loan;
      finalNotice = step.finalNotice;
    }
    expect(outcomes).toEqual(["borrowed", "final_notice", "game_over"]);
  });

  it("non-game-over outcomes always leave cash at zero or above", () => {
    for (const cash of [-500, -37, -1, 0, 3, 250]) {
      for (const loan of [null, { principalRemaining: 40, daysRemaining: 2 }]) {
        const result = settle({ cash, loan, rule: "grace" });
        if (result.outcome !== "game_over") {
          expect(result.cash).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("keeps informational lines in recap order and closes with the balance", () => {
    const result = settle({
      cash: 100,
      ledger: log({
        grossFares: 80,
        netFares: 60,
        tips: 9,
        finesTotal: 8,
        repairsTotal: 12,
        fuelSpendTotal: 14,
        rentPaid: 12,
        gigsCompleted: 4,
        gigsOnTime: 2,
      }),
      loan: { principalRemaining: 30, daysRemaining: 3 },
    });
    expect(lineKinds(result)).toEqual([
      "earnings",
      "commission_info",
      "tips",
      "fines",
      "repairs",
      "fuel",
      "rent_info",
      "platform_fee",
      "loan_installment",
      "closing_balance",
    ]);
    expect(result.lines.find((line) => line.kind === "commission_info")?.amount).toBe(
      -20,
    );
    expect(result.lines[result.lines.length - 1].amount).toBe(result.cash);
  });

  it("handles JPY-scale integers without drift", () => {
    const result = settle({
      cash: -4200,
      platformFee: 300,
      rule: "grace",
    });
    // shortfall 4500 -> ceil(4500 * 1.15) = 5175, all integers.
    expect(result.loan?.principalRemaining).toBe(5175);
    expect(Number.isSafeInteger(result.loan?.principalRemaining ?? 0)).toBe(true);
  });
});

describe("applySettlement", () => {
  const baseSlice = createCareerSlice({
    destinationId: "us-nyc",
    careerSeed: 1234,
  });

  it("advances the day, folds stats, and stays verifiable", () => {
    const ledger = log({
      grossFares: 40,
      netFares: 30,
      tips: 6,
      finesTotal: 8,
      gigsCompleted: 3,
      gigsOnTime: 1,
    });
    const settlement = settleDay({
      cash: 25,
      ledger,
      loan: null,
      finalNotice: false,
      platformFee: PLATFORM_FEE_BY_COUNTRY.us,
      rule: "grace",
    });
    const next = applySettlement(baseSlice, ledger, settlement);
    expect(activeCity(next).day).toBe(2);
    expect(activeCity(next).cash).toBe(settlement.cash);
    expect(next.state).toBe("active");
    expect(activeCity(next).stats).toMatchObject({
      daysCompleted: 1,
      grossEarned: 40,
      tipsEarned: 6,
      finesPaid: 8,
      gigsCompleted: 3,
      gigsOnTime: 1,
      loansTaken: 0,
    });
    expect(parseCareerSlice(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it("counts loans (origination and consolidation) and tracks the largest debt", () => {
    const borrowed = settleDay({
      cash: -50,
      ledger: log(),
      loan: null,
      finalNotice: false,
      platformFee: 3,
      rule: "grace",
    });
    const afterBorrow = applySettlement(baseSlice, log(), borrowed);
    expect(activeCity(afterBorrow).stats.loansTaken).toBe(1);
    expect(activeCity(afterBorrow).stats.largestDebt).toBe(
      borrowed.loan?.principalRemaining ?? 0,
    );

    const consolidated = settleDay({
      cash: -10,
      ledger: log(),
      loan: activeCity(afterBorrow).loan,
      finalNotice: activeCity(afterBorrow).finalNotice,
      platformFee: 3,
      rule: "grace",
    });
    const afterConsolidate = applySettlement(afterBorrow, log(), consolidated);
    expect(activeCity(afterConsolidate).stats.loansTaken).toBe(2);
    expect(activeCity(afterConsolidate).finalNotice).toBe(true);
    expect(activeCity(afterConsolidate).stats.largestDebt).toBeGreaterThan(
      activeCity(afterBorrow).stats.largestDebt,
    );
  });

  it("marks the slice over on bankruptcy and preserves the negative cash", () => {
    const doomed = settleDay({
      cash: -5,
      ledger: log(),
      loan: { principalRemaining: 30, daysRemaining: 3 },
      finalNotice: true,
      platformFee: 3,
      rule: "grace",
    });
    const next = applySettlement(baseSlice, log(), doomed);
    expect(next.state).toBe("over");
    expect(activeCity(next).cash).toBeLessThan(0);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});

describe("fares, tips and par times", () => {
  it("applies vehicle fare factors and the commission split with integer rounding", () => {
    const van = getCareerVehicle("delivery-van");
    const fare = careerFare(21, "delivery", van);
    expect(fare.gross).toBe(32); // round(21 * 1.5)
    expect(fare.net).toBe(24); // round(32 * 0.75)
    const sports = getCareerVehicle("sport-sedan");
    expect(careerFare(20, "passenger", sports).gross).toBe(32); // round(20*1.6)
    const hatch = getCareerVehicle("compact-hatch");
    expect(careerFare(20, "delivery", hatch)).toEqual({ gross: 20, net: 15 });
  });

  it("tips are commission-free and only for on-time deliveries", () => {
    expect(careerTip(32, true)).toBe(10); // round(32 * 0.3)
    expect(careerTip(32, false)).toBe(0);
  });

  it("par time floors at the minimum and scales with distance and pace", () => {
    expect(gigParMs(10, 1)).toBe(PAR_MIN_MS);
    const hatchPar = gigParMs(1000, 1);
    expect(hatchPar).toBe(Math.round(((1000 / 8) * 1.9) * 1000));
    // Slower vehicle -> longer window; faster -> shorter.
    expect(gigParMs(1000, 0.45)).toBeGreaterThan(hatchPar);
    expect(gigParMs(1000, 1.25)).toBeLessThan(hatchPar);
    // Monotone in distance.
    expect(gigParMs(2000, 1)).toBeGreaterThan(hatchPar);
  });
});

describe("checksum and slice codec", () => {
  const slice = createCareerSlice({
    destinationId: "uk-london",
    careerSeed: 987654,
  });

  it("round-trips through JSON byte-identically", () => {
    const parsed = parseCareerSlice(JSON.parse(JSON.stringify(slice)));
    expect(parsed).toEqual(slice);
  });

  it("detects a single tampered field, including inside a city", () => {
    const topLevel = JSON.parse(JSON.stringify(slice)) as Record<string, unknown>;
    topLevel.careerSeed = 999999;
    expect(parseCareerSlice(topLevel)).toEqual({ state: "corrupt" });
    const nested = JSON.parse(JSON.stringify(slice)) as Record<string, never>;
    (nested.cities as Record<string, Record<string, unknown>>)[
      "uk-london"
    ].cash = 999999;
    expect(parseCareerSlice(nested)).toEqual({ state: "corrupt" });
  });

  it("is independent of key insertion order", () => {
    const reordered = JSON.parse(JSON.stringify(slice)) as Record<string, unknown>;
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(reordered).reverse()) {
      shuffled[key] = reordered[key];
    }
    expect(parseCareerSlice(shuffled)).toEqual(slice);
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("returns null for absent values and corrupt for garbage", () => {
    expect(parseCareerSlice(null)).toBeNull();
    expect(parseCareerSlice(undefined)).toBeNull();
    expect(parseCareerSlice(42)).toEqual({ state: "corrupt" });
    expect(parseCareerSlice("junk")).toEqual({ state: "corrupt" });
    expect(parseCareerSlice({ state: "corrupt" })).toEqual({ state: "corrupt" });
    // An object with no version is an obsolete save, not a damaged one.
    expect(parseCareerSlice({ state: "active" })).toBeNull();
    // But anything claiming to be the current version must hold up.
    expect(parseCareerSlice({ version: 2, state: "active" })).toEqual({
      state: "corrupt",
    });
    expect(
      parseCareerSlice({
        version: 2,
        state: "active",
        careerSeed: 1,
        currentDestinationId: "us-nyc",
        cities: {},
        victoryDay: null,
        rule: "grace",
        checksum: "x",
      }),
      "an empty cities map leaves activeCity with nothing to return",
    ).toEqual({ state: "corrupt" });
  });

  it("rejects a pointer at a city that has not been reached", () => {
    // activeCity would have nothing to return, so every consumer would read
    // undefined — the codec has to refuse it rather than hand it over.
    const stranded = stampCareerChecksum({
      ...slice,
      currentDestinationId: "jp-tokyo",
    });
    expect(parseCareerSlice(JSON.parse(JSON.stringify(stranded)))).toEqual({
      state: "corrupt",
    });
  });

  it("treats a pre-per-city save as absent rather than damaged", () => {
    // The lesson-era flat shape: recognisable, obsolete, not tampered with. The
    // player should get a clean start, not a damaged-save alarm.
    const legacy = {
      state: "active",
      countryId: "uk",
      destinationId: "uk-london",
      careerSeed: 1,
      day: 4,
      cash: 120,
      loan: null,
      finalNotice: false,
      ownedVehicleId: null,
      victoryDay: null,
      rule: "grace",
      stats: {},
      checksum: "deadbeef",
    };
    expect(parseCareerSlice(legacy)).toBeNull();
  });

  it("accepts negative cash — the codec must never clamp", () => {
    // Negative cash is legitimate in the "over" state.
    const broke = withCity(slice, "uk-london", {
      ...activeCity(slice),
      cash: -45,
    });
    const over = stampCareerChecksum({ ...broke, state: "over" });
    expect(parseCareerSlice(JSON.parse(JSON.stringify(over)))).toEqual(over);
  });

  it("re-stamping an already-stamped slice is a no-op", () => {
    expect(stampCareerChecksum(slice)).toEqual(slice);
    expect(computeCareerChecksum(slice)).toBe(slice.checksum);
  });
});

describe("cities", () => {
  it("reads every destination's country off its id prefix", () => {
    // career.ts is import-free at runtime and cannot ask content.ts, so it
    // splits the id. This pins that shortcut against the real profiles — if a
    // future destination id stops being `${countryId}-${place}`, fail here
    // rather than silently mispricing a whole city.
    for (const destination of DESTINATION_PROFILES) {
      expect(careerCountryOf(destination.id), destination.id).toBe(
        destination.countryId,
      );
    }
  });

  it("keeps each city's money, debt and fleet to itself", () => {
    const career = createCareerSlice({ destinationId: "us-nyc", careerSeed: 3 });
    const nyc = activeCity(career);
    // Reach a second city, then get rich in it.
    const twoCities = withCity(career, "jp-tokyo", createCityState("jp"));
    const richTokyo = withCity(twoCities, "jp-tokyo", {
      ...createCityState("jp"),
      cash: 500_000,
      ownedVehicleIds: ["sport-sedan"],
    });
    expect(richTokyo.cities["us-nyc"]).toEqual(cityStateOf(nyc));
    expect(richTokyo.cities["jp-tokyo"]?.cash).toBe(500_000);
    // The pointer still says New York, so that is still what the game reads.
    expect(activeCity(richTokyo).destinationId).toBe("us-nyc");
    expect(activeCity(richTokyo).cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.us);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(richTokyo)))).toEqual(
      richTokyo,
    );
  });

  it("settling a day touches only the city that was driven", () => {
    const career = withCity(
      createCareerSlice({ destinationId: "us-nyc", careerSeed: 4 }),
      "jp-tokyo",
      { ...createCityState("jp"), cash: 9_000 },
    );
    const settlement = settleDay({
      cash: 100,
      ledger: log({ grossFares: 60, netFares: 45 }),
      loan: null,
      finalNotice: false,
      platformFee: PLATFORM_FEE_BY_COUNTRY.us,
      rule: "grace",
    });
    const next = applySettlement(career, log({ grossFares: 60 }), settlement);
    expect(activeCity(next).day).toBe(2);
    expect(next.cities["jp-tokyo"]).toEqual(career.cities["jp-tokyo"]);
  });

  it("activeCity refuses a pointer with no city behind it", () => {
    const career = createCareerSlice({ destinationId: "us-nyc", careerSeed: 5 });
    expect(() =>
      activeCity({ ...career, currentDestinationId: "jp-tokyo" }),
    ).toThrow(/no state for/);
  });
});

describe("per-day seeds", () => {
  it("is deterministic, nonzero and 31-bit for days 1..500", () => {
    for (let day = 1; day <= 500; day += 1) {
      const seed = careerDayTrafficSeed(20260724, day);
      expect(seed).toBe(careerDayTrafficSeed(20260724, day));
      expect(seed).toBeGreaterThan(0);
      expect(seed).toBeLessThanOrEqual(0x7fffffff);
      const gigBase = careerGigSeedBase(20260724, day);
      expect(gigBase).toBeGreaterThan(0);
      expect(gigBase).not.toBe(seed);
    }
  });

  it("diverges across days and across careers", () => {
    const seeds = new Set<number>();
    for (let day = 1; day <= 200; day += 1) {
      seeds.add(careerDayTrafficSeed(11111, day));
    }
    expect(seeds.size).toBe(200);
    expect(careerDayTrafficSeed(1, 1)).not.toBe(careerDayTrafficSeed(2, 1));
  });
});

describe("vehicle catalog invariants", () => {
  it("lists rents strictly ascending in every country", () => {
    for (const country of ["us", "uk", "fr", "jp"] as const) {
      const rents = CAREER_VEHICLES.map((vehicle) => vehicle.rentByCountry[country]);
      for (let index = 1; index < rents.length; index += 1) {
        expect(rents[index], `${country} tier ${index}`).toBeGreaterThan(
          rents[index - 1],
        );
      }
    }
  });

  it("keeps the bicycle owned, free, fuel-less, deliveries-only and buyout-ineligible", () => {
    const bike = getCareerVehicle("bicycle");
    expect(bike.owned).toBe(true);
    expect(Object.values(bike.rentByCountry).every((rent) => rent === 0)).toBe(true);
    expect(bike.tankL).toBe(0);
    expect(bike.fuelLPerM).toBe(0);
    expect(bike.allowedGigKinds).toEqual(["delivery"]);
    expect(bike.buyoutEligible).toBe(false);
    expect(bike.visualKind).toBe("bicycle");
    expect(bike.model).toBeNull();
  });

  it("gates rideshare to the hatch and sports car only", () => {
    for (const vehicle of CAREER_VEHICLES) {
      const carriesPassengers = vehicle.allowedGigKinds.includes("passenger");
      expect(carriesPassengers, vehicle.id).toBe(
        vehicle.id === "compact-hatch" || vehicle.id === "sport-sedan",
      );
      expect(vehicle.allowedGigKinds.length).toBeGreaterThan(0);
    }
  });

  it("pins the hatch physics to the simulation's documented defaults", () => {
    expect(getCareerVehicle("compact-hatch").physics).toEqual({
      maxForwardSpeedMps: 22,
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
    });
  });

  it("keeps every physics value inside the simulation config clamps", () => {
    const bounds: Record<string, readonly [number, number]> = {
      maxForwardSpeedMps: [5, 50],
      maxReverseSpeedMps: [2, 15],
      forwardAccelMps2: [1, 15],
      reverseAccelMps2: [1, 10],
      brakeBaseMps2: [1, 10],
      brakeStrengthMps2: [2, 20],
      dragBaseMps2: [0, 2],
      dragPerMps: [0, 0.2],
      steerBaseRate: [0.05, 1],
      steerAuthorityRate: [0, 3],
      steerAuthoritySpeedMps: [1, 20],
      instabilityLateralMps2: [3, 30],
      playerRadiusM: [0.3, 2],
      playerCapsuleHalfLengthM: [0.3, 3],
      playerCapsuleRadiusM: [0.3, 2],
    };
    for (const vehicle of CAREER_VEHICLES) {
      for (const [field, [minimum, maximum]] of Object.entries(bounds)) {
        const value = vehicle.physics[field as keyof typeof vehicle.physics];
        expect(value, `${vehicle.id}.${field}`).toBeGreaterThanOrEqual(minimum);
        expect(value, `${vehicle.id}.${field}`).toBeLessThanOrEqual(maximum);
      }
    }
  });

  it("prices integer rents, fees and starting cash in every country", () => {
    for (const country of ["us", "uk", "fr", "jp"] as const) {
      expect(Number.isSafeInteger(CAREER_STARTING_CASH_BY_COUNTRY[country])).toBe(true);
      expect(Number.isSafeInteger(PLATFORM_FEE_BY_COUNTRY[country])).toBe(true);
      for (const vehicle of CAREER_VEHICLES) {
        expect(Number.isSafeInteger(vehicle.rentByCountry[country])).toBe(true);
      }
    }
  });

  it("throws on an unknown vehicle id", () => {
    expect(() => getCareerVehicle("hoverboard" as never)).toThrow(/Unknown/);
  });
});

describe("rent and buyout", () => {
  const slice = createCareerSlice({
    destinationId: "jp-tokyo",
    careerSeed: 777,
  });

  it("charges no rent for owned vehicles and full rent otherwise", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const city = activeCity(slice);
    expect(vehicleRent(getCareerVehicle("bicycle"), city)).toBe(0);
    expect(vehicleRent(hatch, city)).toBe(1200);
    expect(
      vehicleRent(hatch, { ...city, ownedVehicleIds: ["compact-hatch"] }),
    ).toBe(0);
  });

  it("keeps ownership local to the city it was bought in", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const tokyo = activeCity(slice);
    const owningTokyo = withCity(slice, "jp-tokyo", {
      ...tokyo,
      ownedVehicleIds: ["compact-hatch"],
    });
    expect(vehicleRent(hatch, activeCity(owningTokyo))).toBe(0);
    // The same hatch, in a city where it was never bought, still costs rent.
    const nyc = createCityState("us");
    expect(
      vehicleRent(hatch, { ...nyc, destinationId: "us-nyc", countryId: "us" }),
    ).toBe(12);
  });

  it("prices buyout at the rent multiplier", () => {
    const hatch = getCareerVehicle("compact-hatch");
    expect(buyoutPrice(hatch, "us")).toBe(12 * BUYOUT_RENT_MULTIPLIER);
    expect(buyoutPrice(hatch, "jp")).toBe(1200 * BUYOUT_RENT_MULTIPLIER);
  });

  it("enforces the eligibility matrix", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const price = buyoutPrice(hatch, "jp");
    const withCash = (patch: Partial<CareerCityState>) =>
      withCity(slice, "jp-tokyo", {
        ...activeCity(slice),
        cash: price,
        ...patch,
      });
    const rich = withCash({});
    expect(canBuyout(rich, hatch)).toBe(true);
    expect(canBuyout(rich, getCareerVehicle("bicycle"))).toBe(false);
    expect(canBuyout(withCash({ cash: price - 1 }), hatch)).toBe(false);
    expect(
      canBuyout(
        withCash({ loan: { principalRemaining: 1, daysRemaining: 1 } }),
        hatch,
      ),
    ).toBe(false);
    expect(canBuyout(withCash({ finalNotice: true }), hatch)).toBe(false);
    expect(
      canBuyout(withCash({ ownedVehicleIds: ["delivery-van"] }), hatch),
    ).toBe(false);
    expect(
      canBuyout(stampCareerChecksum({ ...rich, state: "over" }), hatch),
    ).toBe(false);
  });

  it("buying out records the victory once and keeps the day", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const price = buyoutPrice(hatch, "jp");
    const ready = withCity(slice, "jp-tokyo", {
      ...activeCity(slice),
      cash: price + 500,
      day: 9,
    });
    const won = applyBuyout(ready, hatch);
    expect(won.state).toBe("won");
    expect(won.victoryDay).toBe(9);
    expect(activeCity(won).ownedVehicleIds).toEqual(["compact-hatch"]);
    expect(activeCity(won).cash).toBe(500);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(won)))).toEqual(won);
    expect(() => applyBuyout(won, hatch)).toThrow();
  });
});

describe("createCareerSlice", () => {
  it("starts on day 1 with the country's seed cash and a clean sheet", () => {
    const slice = createCareerSlice({
      destinationId: "fr-calais",
      careerSeed: 5,
    });
    const city = activeCity(slice);
    expect(city.day).toBe(1);
    expect(city.cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.fr);
    expect(city.loan).toBeNull();
    expect(city.finalNotice).toBe(false);
    expect(city.ownedVehicleIds).toEqual([]);
    expect(city.countryId).toBe("fr");
    expect(slice.state).toBe("active");
    expect(slice.rule).toBe("grace");
    expect(slice.victoryDay).toBeNull();
    // Only the starting city exists: presence in `cities` is the unlock.
    expect(Object.keys(slice.cities)).toEqual(["fr-calais"]);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(slice)))).toEqual(slice);
  });

  it("keeps the day length constant sane", () => {
    expect(DAY_LENGTH_MS).toBe(360_000);
  });
});
