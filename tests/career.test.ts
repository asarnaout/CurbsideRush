import { describe, expect, it } from "vitest";
import {
  activeCity,
  applyTicket,
  applyVehiclePurchase,
  canBuyTicket,
  careerWon,
  applySettlement,
  CAREER_CITIES,
  CAREER_START_CITY,
  careerCityIndex,
  careerCountryOf,
  isCareerCity,
  nextCareerCity,
  ticketPrice,
  travelTo,
  TICKET_PRICE_BY_DESTINATION,
  unlockedCities,
  BUYOUT_RENT_MULTIPLIER,
  buyoutPrice,
  canBuyVehicle,
  ownsFullFleet,
  CAREER_STARTING_CASH_BY_COUNTRY,
  CAREER_VEHICLES,
  careerDayTrafficSeed,
  careerFare,
  careerGigSeedBase,
  computeCareerChecksum,
  createCareerSlice,
  DAY_LENGTH_MS,
  DEFAULT_GARAGE_VEHICLE_ID,
  emptyDayLog,
  garageDefaultVehicle,
  getCareerVehicle,
  LOAN_ORIGINATION_RATE,
  LOAN_TERM_DAYS,
  nextInstallment,
  parseCareerSlice,
  PLATFORM_FEE_BY_COUNTRY,
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  settleDay,
  stableStringify,
  stampCareerChecksum,
  cityStateOf,
  createCityState,
  vehicleRent,
  withCity,
  type CareerCityState,
  type CareerSliceV2,
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

  it("wipes the city on bankruptcy and leaves the rest of the career standing", () => {
    // A career two cities deep, rich and well-equipped in New York.
    const career = withCity(
      withCity(baseSlice, "us-nyc", {
        ...activeCity(baseSlice),
        cash: 900,
        day: 14,
        ownedVehicleIds: ["compact-hatch", "delivery-van"],
        finalNotice: true,
        loan: { principalRemaining: 30, daysRemaining: 3 },
      }),
      "jp-tokyo",
      { ...createCityState("jp"), cash: 77_000, ownedVehicleIds: ["sport-sedan"] },
    );
    const doomed = settleDay({
      cash: -5,
      ledger: log(),
      loan: { principalRemaining: 30, daysRemaining: 3 },
      finalNotice: true,
      platformFee: 3,
      rule: "grace",
    });
    const next = applySettlement(career, log(), doomed);

    // New York is back to the day you arrived — and the fleet is repossessed,
    // which is what stops bankruptcy being a free way out of a bad loan.
    const wiped = activeCity(next);
    expect(wiped.cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.us);
    expect(wiped.day).toBe(1);
    expect(wiped.loan).toBeNull();
    expect(wiped.finalNotice).toBe(false);
    expect(wiped.ownedVehicleIds).toEqual([]);
    expect(wiped.stats.daysCompleted).toBe(0);

    // Tokyo never noticed.
    expect(next.cities["jp-tokyo"]?.cash).toBe(77_000);
    expect(next.cities["jp-tokyo"]?.ownedVehicleIds).toEqual(["sport-sedan"]);
    // And the career itself is still running.
    expect(next.state).toBe("active");
    expect(parseCareerSlice(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});

// Tips and par times moved to dispatch.ts when free drive started paying them
// too; they are covered in tests/dispatch.test.ts.
describe("fares", () => {
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

  it("reopens a verified pre-Cairo winner without erasing London or its ledgers", () => {
    const fullFleet = CAREER_VEHICLES.filter((vehicle) => vehicle.buyoutEligible).map(
      (vehicle) => vehicle.id,
    );
    const legacyWinner = stampCareerChecksum({
      ...createCareerSlice({ destinationId: "us-nyc", careerSeed: 2026 }),
      state: "won",
      currentDestinationId: "uk-london",
      cities: {
        "us-nyc": {
          ...createCityState("us"),
          cash: 321,
          ownedVehicleIds: fullFleet,
        },
        "jp-tokyo": {
          ...createCityState("jp"),
          cash: 54_321,
          ownedVehicleIds: fullFleet,
        },
        "uk-london": {
          ...createCityState("uk"),
          day: 42,
          cash: 987,
          ownedVehicleIds: fullFleet,
        },
      },
      victoryDay: 42,
    });

    const parsed = parseCareerSlice(JSON.parse(JSON.stringify(legacyWinner)));
    if (parsed === null || parsed.state === "corrupt") {
      throw new Error("verified legacy winner did not migrate");
    }
    expect(parsed.state).toBe("active");
    expect(parsed.victoryDay).toBeNull();
    expect(parsed.currentDestinationId).toBe("uk-london");
    expect(parsed.cities["eg-cairo"]).toBeUndefined();
    expect(parsed.cities["uk-london"]).toEqual(legacyWinner.cities["uk-london"]);
    expect(parsed.cities["us-nyc"]?.cash).toBe(321);
    expect(computeCareerChecksum(parsed)).toBe(parsed.checksum);

    const tampered = JSON.parse(JSON.stringify(legacyWinner)) as {
      cities: Record<string, { cash: number }>;
    };
    tampered.cities["uk-london"].cash += 1;
    expect(parseCareerSlice(tampered)).toEqual({ state: "corrupt" });
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
    // Settlement no longer banks a deficit, but the codec's job is to verify
    // what it is handed, not to quietly repair it.
    const broke = stampCareerChecksum(
      withCity(slice, "uk-london", { ...activeCity(slice), cash: -45 }),
    );
    expect(parseCareerSlice(JSON.parse(JSON.stringify(broke)))).toEqual(broke);
  });

  it("re-stamping an already-stamped slice is a no-op", () => {
    expect(stampCareerChecksum(slice)).toEqual(slice);
    expect(computeCareerChecksum(slice)).toBe(slice.checksum);
  });
});

describe("the city ladder", () => {
  it("is a route of real, distinct destinations", () => {
    const ids = DESTINATION_PROFILES.map((profile) => profile.id);
    for (const city of CAREER_CITIES) {
      expect(ids, `${city} is not a real destination`).toContain(city);
    }
    expect(new Set(CAREER_CITIES).size).toBe(CAREER_CITIES.length);
    expect(CAREER_CITIES.length).toBeGreaterThan(1);
  });

  it("opens in New York and runs NYC -> Tokyo -> Cairo -> London", () => {
    // Pins the intended route. Reordering CAREER_CITIES is a deliberate design
    // change and should update this line with it.
    expect(CAREER_CITIES).toEqual([
      "us-nyc",
      "jp-tokyo",
      "eg-cairo",
      "uk-london",
    ]);
    expect(CAREER_START_CITY).toBe("us-nyc");
  });

  it("leaves Milton Keynes and Calais to free drive", () => {
    expect(isCareerCity("uk-milton-keynes")).toBe(false);
    expect(isCareerCity("fr-calais")).toBe(false);
    expect(nextCareerCity("fr-calais")).toBeNull();
  });

  it("walks forward and stops at the end", () => {
    expect(nextCareerCity("us-nyc")).toBe("jp-tokyo");
    expect(nextCareerCity("jp-tokyo")).toBe("eg-cairo");
    expect(nextCareerCity("eg-cairo")).toBe("uk-london");
    expect(nextCareerCity(CAREER_CITIES[CAREER_CITIES.length - 1])).toBeNull();
    expect(careerCityIndex("us-nyc")).toBe(0);
    expect(careerCityIndex("uk-milton-keynes")).toBe(-1);
  });

  it("gives every ladder city a starting float and a full vehicle catalog", () => {
    for (const city of CAREER_CITIES) {
      const countryId = careerCountryOf(city);
      expect(CAREER_STARTING_CASH_BY_COUNTRY[countryId]).toBeGreaterThan(0);
      expect(PLATFORM_FEE_BY_COUNTRY[countryId]).toBeGreaterThan(0);
      for (const vehicle of CAREER_VEHICLES) {
        expect(vehicle.rentByCountry[countryId]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("pins Cairo's EGP career economy", () => {
    expect(CAREER_STARTING_CASH_BY_COUNTRY.eg).toBe(1000);
    expect(PLATFORM_FEE_BY_COUNTRY.eg).toBe(150);
    expect(ROADSIDE_CALLOUT_FEE_BY_COUNTRY.eg).toBe(500);
    expect(CAREER_VEHICLES.map((vehicle) => vehicle.rentByCountry.eg)).toEqual([
      0,
      500,
      800,
      1300,
      1900,
    ]);
    expect(ticketPrice("jp-tokyo")).toBe(40_000);
    expect(ticketPrice("eg-cairo")).toBe(20_000);
  });
});

describe("tickets and travel", () => {
  const nyc = () => createCareerSlice({ destinationId: "us-nyc", careerSeed: 9 });

  it("prices a ticket out of every city but the last", () => {
    for (const city of CAREER_CITIES) {
      const price = ticketPrice(city);
      if (nextCareerCity(city) === null) {
        expect(price, `${city} is the last stop`).toBeNull();
      } else {
        expect(price, `${city} needs a ticket price`).toBeGreaterThan(0);
        expect(Number.isSafeInteger(price)).toBe(true);
      }
    }
    // No stray prices for cities that are not on the ladder.
    for (const id of Object.keys(TICKET_PRICE_BY_DESTINATION)) {
      expect(isCareerCity(id as never)).toBe(true);
    }
  });

  it("gates the ticket on cash and nothing else", () => {
    const price = ticketPrice("us-nyc") as number;
    const broke = nyc();
    expect(canBuyTicket(broke)).toBe(false);
    const ready = withCity(broke, "us-nyc", {
      ...activeCity(broke),
      cash: price,
      // Debt is no gate here either, matching vehicle purchases.
      loan: { principalRemaining: 99, daysRemaining: 2 },
      finalNotice: true,
    });
    expect(canBuyTicket(ready)).toBe(true);
    expect(
      canBuyTicket(
        withCity(ready, "us-nyc", { ...activeCity(ready), cash: price - 1 }),
      ),
    ).toBe(false);
  });

  it("flying on debits here, opens there fresh, and leaves this city intact", () => {
    const price = ticketPrice("us-nyc") as number;
    const ready = withCity(nyc(), "us-nyc", {
      ...activeCity(nyc()),
      cash: price + 250,
      day: 12,
      ownedVehicleIds: ["compact-hatch", "delivery-van"],
    });
    const flown = applyTicket(ready);

    expect(flown.currentDestinationId).toBe("jp-tokyo");
    const tokyo = activeCity(flown);
    expect(tokyo.countryId).toBe("jp");
    expect(tokyo.cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.jp);
    expect(tokyo.day).toBe(1);
    expect(tokyo.ownedVehicleIds).toEqual([]);

    // New York keeps its change, its day counter and its fleet.
    const left = flown.cities["us-nyc"];
    expect(left?.cash).toBe(250);
    expect(left?.day).toBe(12);
    expect(left?.ownedVehicleIds).toEqual(["compact-hatch", "delivery-van"]);
    expect(unlockedCities(flown)).toEqual(["us-nyc", "jp-tokyo"]);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(flown)))).toEqual(flown);
  });

  it("never sells a second ticket for a leg already flown", () => {
    const price = ticketPrice("us-nyc") as number;
    const flown = applyTicket(
      withCity(nyc(), "us-nyc", { ...activeCity(nyc()), cash: price }),
    );
    // Fly back with plenty of cash: Tokyo is unlocked, so travel is free now.
    const backRich = withCity(travelTo(flown, "us-nyc"), "us-nyc", {
      ...(flown.cities["us-nyc"] as CareerCityState),
      cash: 999_999,
    });
    expect(canBuyTicket(backRich)).toBe(false);
    expect(() => applyTicket(backRich)).toThrow(/No onward ticket/);
  });

  it("keeps legacy London unlocked but makes a returning Tokyo driver buy Cairo", () => {
    const legacy = stampCareerChecksum({
      ...createCareerSlice({ destinationId: "us-nyc", careerSeed: 10 }),
      currentDestinationId: "jp-tokyo",
      cities: {
        "us-nyc": createCityState("us"),
        "jp-tokyo": {
          ...createCityState("jp"),
          cash: 40_000,
        },
        "uk-london": {
          ...createCityState("uk"),
          day: 8,
          cash: 222,
        },
      },
    });

    expect(unlockedCities(legacy)).toEqual([
      "us-nyc",
      "jp-tokyo",
      "uk-london",
    ]);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    expect(canBuyTicket(legacy)).toBe(true);
    const inCairo = applyTicket(legacy);
    expect(inCairo.currentDestinationId).toBe("eg-cairo");
    expect(activeCity(inCairo).cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.eg);
    expect(inCairo.cities["jp-tokyo"]?.cash).toBe(0);
    expect(inCairo.cities["uk-london"]?.cash).toBe(222);
    expect(travelTo(inCairo, "uk-london").currentDestinationId).toBe(
      "uk-london",
    );
  });

  it("travels freely between cities already reached, and refuses the rest", () => {
    const price = ticketPrice("us-nyc") as number;
    const flown = applyTicket(
      withCity(nyc(), "us-nyc", { ...activeCity(nyc()), cash: price }),
    );
    const back = travelTo(flown, "us-nyc");
    expect(back.currentDestinationId).toBe("us-nyc");
    // Free: flying back costs nothing.
    expect(activeCity(back).cash).toBe(0);
    expect(activeCity(travelTo(back, "jp-tokyo")).countryId).toBe("jp");
    expect(() => travelTo(back, "uk-london")).toThrow(/not been reached/);
  });

  it("gives each city its own traffic and gig streams on the same day number", () => {
    expect(careerDayTrafficSeed(42, 3, 0)).not.toBe(careerDayTrafficSeed(42, 3, 1));
    expect(careerGigSeedBase(42, 3, 0)).not.toBe(careerGigSeedBase(42, 3, 1));
    // Omitting the index reproduces the ladder's first city exactly.
    expect(careerDayTrafficSeed(42, 3)).toBe(careerDayTrafficSeed(42, 3, 0));
    expect(careerGigSeedBase(42, 3)).toBe(careerGigSeedBase(42, 3, 0));
  });
});

describe("the win condition", () => {
  const fullFleet = CAREER_VEHICLES.filter((v) => v.buyoutEligible).map(
    (v) => v.id,
  );
  const cityWithFleet = (countryId: "us" | "jp" | "eg" | "uk") => ({
    ...createCityState(countryId),
    ownedVehicleIds: fullFleet,
  });

  const everything = (): CareerSliceV2 => {
    let career = createCareerSlice({ destinationId: "us-nyc", careerSeed: 1 });
    for (const city of CAREER_CITIES) {
      career = withCity(career, city, cityWithFleet(careerCountryOf(city) as never));
    }
    return stampCareerChecksum({
      ...career,
      currentDestinationId: CAREER_CITIES[CAREER_CITIES.length - 1],
    });
  };

  it("needs the final city AND every fleet, not one or the other", () => {
    const complete = everything();
    expect(careerWon(complete)).toBe(true);

    // Reached London, but one van short in Tokyo.
    const shortOne = withCity(complete, "jp-tokyo", {
      ...cityWithFleet("jp"),
      ownedVehicleIds: fullFleet.slice(1),
    });
    expect(careerWon(shortOne)).toBe(false);

    // Every fleet owned, but never flew the last leg.
    const neverArrived = stampCareerChecksum({
      ...complete,
      currentDestinationId: "us-nyc",
      cities: { ...complete.cities, "uk-london": undefined },
    });
    expect(careerWon(neverArrived)).toBe(false);
  });

  it("stamps the victory on the purchase that completes it, once", () => {
    const last = CAREER_CITIES[CAREER_CITIES.length - 1];
    const sports = getCareerVehicle("sport-sedan");
    let career = createCareerSlice({ destinationId: "us-nyc", careerSeed: 2 });
    for (const city of CAREER_CITIES) {
      career = withCity(career, city, cityWithFleet(careerCountryOf(city) as never));
    }
    // One vehicle missing in the final city, and the cash to close it out.
    career = stampCareerChecksum({
      ...career,
      currentDestinationId: last,
    });
    career = withCity(career, last, {
      ...cityWithFleet(careerCountryOf(last) as never),
      day: 30,
      cash: buyoutPrice(sports, careerCountryOf(last)),
      ownedVehicleIds: fullFleet.filter((id) => id !== "sport-sedan"),
    });
    expect(career.state).toBe("active");

    const won = applyVehiclePurchase(career, sports);
    expect(won.state).toBe("won");
    expect(won.victoryDay).toBe(30);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(won)))).toEqual(won);

    // Sticky: the day is recorded once and play continues.
    const later = applySettlement(
      won,
      emptyDayLog(),
      settleDay({
        cash: 500,
        ledger: emptyDayLog(),
        loan: null,
        finalNotice: false,
        platformFee: PLATFORM_FEE_BY_COUNTRY[careerCountryOf(last)],
        rule: "grace",
      }),
    );
    expect(later.state).toBe("won");
    expect(later.victoryDay).toBe(30);
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
    for (const country of ["us", "uk", "fr", "jp", "eg"] as const) {
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

  it("pins the hatch physics to the simulation's defaults, bar the speed uplift", () => {
    expect(getCareerVehicle("compact-hatch").physics).toEqual({
      // 22 (the core's default) + 10 mph, the uplift every motorised career
      // vehicle carries. The handling model below is still the reference.
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
    for (const country of ["us", "uk", "fr", "jp", "eg"] as const) {
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
    expect(vehicleRent(hatch, city)).toBe(1600);
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
    ).toBe(16);
  });

  it("prices buyout at the rent multiplier", () => {
    const hatch = getCareerVehicle("compact-hatch");
    expect(buyoutPrice(hatch, "us")).toBe(16 * BUYOUT_RENT_MULTIPLIER);
    expect(buyoutPrice(hatch, "jp")).toBe(1600 * BUYOUT_RENT_MULTIPLIER);
  });

  it("gates a purchase on cash and nothing else", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const price = buyoutPrice(hatch, "jp");
    const withCash = (patch: Partial<CareerCityState>) =>
      withCity(slice, "jp-tokyo", {
        ...activeCity(slice),
        cash: price,
        ...patch,
      });
    expect(canBuyVehicle(withCash({}), hatch)).toBe(true);
    expect(canBuyVehicle(withCash({ cash: price - 1 }), hatch)).toBe(false);
    // The bicycle is yours already and is not for sale.
    expect(canBuyVehicle(withCash({}), getCareerVehicle("bicycle"))).toBe(false);
    // Already in this city's fleet.
    expect(
      canBuyVehicle(withCash({ ownedVehicleIds: ["compact-hatch"] }), hatch),
    ).toBe(false);
  });

  it("lets you buy while indebted and under final notice", () => {
    // Deliberate: spending yourself back into a shortfall is the player's call,
    // and settlement prices it tonight.
    const hatch = getCareerVehicle("compact-hatch");
    const price = buyoutPrice(hatch, "jp");
    const struggling = withCity(slice, "jp-tokyo", {
      ...activeCity(slice),
      cash: price,
      loan: { principalRemaining: 5000, daysRemaining: 2 },
      finalNotice: true,
    });
    expect(canBuyVehicle(struggling, hatch)).toBe(true);
    const bought = applyVehiclePurchase(struggling, hatch);
    expect(activeCity(bought).ownedVehicleIds).toEqual(["compact-hatch"]);
    // The debt is untouched by the purchase — it just cost the cash.
    expect(activeCity(bought).loan).toEqual({
      principalRemaining: 5000,
      daysRemaining: 2,
    });
  });

  it("collects a whole fleet, one purchase at a time", () => {
    const buyable = CAREER_VEHICLES.filter((vehicle) => vehicle.buyoutEligible);
    let career = withCity(slice, "jp-tokyo", {
      ...activeCity(slice),
      cash: 10_000_000,
    });
    expect(ownsFullFleet(activeCity(career))).toBe(false);
    for (const vehicle of buyable) {
      expect(canBuyVehicle(career, vehicle), vehicle.id).toBe(true);
      career = applyVehiclePurchase(career, vehicle);
      // Bought vehicles stop costing rent immediately.
      expect(vehicleRent(vehicle, activeCity(career))).toBe(0);
    }
    expect(activeCity(career).ownedVehicleIds).toHaveLength(buyable.length);
    expect(ownsFullFleet(activeCity(career))).toBe(true);
    // No double-buying, and the slice still verifies.
    expect(canBuyVehicle(career, buyable[0])).toBe(false);
    expect(() => applyVehiclePurchase(career, buyable[0])).toThrow(/Cannot buy/);
    expect(parseCareerSlice(JSON.parse(JSON.stringify(career)))).toEqual(career);
  });

  it("charges the price and leaves other cities' fleets alone", () => {
    const hatch = getCareerVehicle("compact-hatch");
    const twoCities = withCity(
      withCity(slice, "jp-tokyo", {
        ...activeCity(slice),
        cash: buyoutPrice(hatch, "jp") + 7,
      }),
      "us-nyc",
      createCityState("us"),
    );
    const bought = applyVehiclePurchase(twoCities, hatch);
    expect(activeCity(bought).cash).toBe(7);
    expect(bought.cities["us-nyc"]?.ownedVehicleIds).toEqual([]);
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

describe("garageDefaultVehicle", () => {
  // Every case is priced in a US city: fee 3, rents 0/10/16/26/38.
  const base = createCareerSlice({ destinationId: "us-nyc", careerSeed: 1 });
  const nyc = (patch: Partial<CareerCityState> = {}) =>
    activeCity(withCity(base, "us-nyc", { ...activeCity(base), ...patch }));

  it("keeps a pick the day can start on, rich or poor", () => {
    expect(garageDefaultVehicle(nyc({ cash: 400 }), "sport-sedan")).toBe(
      "sport-sedan",
    );
    // Exactly the rent is startable, and the Start Day button agrees, so the
    // garage must not second-guess it even with the fee still to come.
    expect(garageDefaultVehicle(nyc({ cash: 38 }), "sport-sedan")).toBe(
      "sport-sedan",
    );
  });

  it("walks down to the dearest ride still within the day's means", () => {
    // 31 misses the sports car; the van at 26 leaves 5 against a 3 fee.
    expect(garageDefaultVehicle(nyc({ cash: 31 }), "sport-sedan")).toBe(
      "delivery-van",
    );
    expect(garageDefaultVehicle(nyc({ cash: 20 }), "sport-sedan")).toBe(
      "compact-hatch",
    );
    expect(garageDefaultVehicle(nyc({ cash: 15 }), "sport-sedan")).toBe(
      "motorbike",
    );
    expect(garageDefaultVehicle(nyc({ cash: 12 }), "sport-sedan")).toBe(
      "bicycle",
    );
  });

  it("never walks up: the fallback is capped at what was asked for", () => {
    expect(garageDefaultVehicle(nyc({ cash: 400 }), "motorbike")).toBe(
      "motorbike",
    );
    // Flush, but the bike is what was chosen and the bike is what it keeps.
    expect(garageDefaultVehicle(nyc({ cash: 400 }), "bicycle")).toBe("bicycle");
  });

  it("budgets the fallback against the fee and tonight's installment", () => {
    const indebted = nyc({
      cash: 31,
      loan: { principalRemaining: 30, daysRemaining: 3 },
    });
    // Installment is ceil(30/3) = 10, so 13 is due before any rent: the van at
    // 26 would leave 5 and end the day short. Rent alone would have taken it.
    expect(nextInstallment(indebted.loan as CareerLoan)).toBe(10);
    expect(garageDefaultVehicle(indebted, "sport-sedan")).toBe("compact-hatch");
  });

  it("falls to the bicycle when nothing clears the obligations", () => {
    expect(garageDefaultVehicle(nyc({ cash: 0 }), "sport-sedan")).toBe(
      "bicycle",
    );
    // Not even the free bike covers the fee here — it is still the answer,
    // because there is nothing cheaper to fall to.
    expect(
      garageDefaultVehicle(
        nyc({ cash: 2, loan: { principalRemaining: 90, daysRemaining: 3 } }),
        "delivery-van",
      ),
    ).toBe("bicycle");
  });

  it("prefers a vehicle owned outright over the bicycle it ties with on rent", () => {
    const owned = nyc({ cash: 4, ownedVehicleIds: ["delivery-van"] });
    // Both rent at 0 and both clear the 3 fee; the van is the better ride.
    expect(vehicleRent(getCareerVehicle("delivery-van"), owned)).toBe(0);
    expect(garageDefaultVehicle(owned, "sport-sedan")).toBe("delivery-van");
  });

  it("nominates a ride a new career's float can actually take", () => {
    for (const destinationId of CAREER_CITIES) {
      const city = activeCity(
        createCareerSlice({ destinationId, careerSeed: 1 }),
      );
      const opening = garageDefaultVehicle(city, DEFAULT_GARAGE_VEHICLE_ID);
      expect(opening, `${destinationId} cannot open on its default`).toBe(
        DEFAULT_GARAGE_VEHICLE_ID,
      );
      expect(city.cash).toBeGreaterThanOrEqual(
        vehicleRent(getCareerVehicle(opening), city) +
          PLATFORM_FEE_BY_COUNTRY[city.countryId],
      );
    }
  });
});
