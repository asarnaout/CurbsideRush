import { describe, expect, it } from "vitest";
import {
  activeCity,
  applySettlement,
  applyTicket,
  applyVehiclePurchase,
  buyoutPrice,
  careerStatusStats,
  createCareerSlice,
  emptyDayLog,
  getCareerVehicle,
  nextInstallment,
  parseCareerSlice,
  settleDay,
  stampCareerChecksum,
  ticketPrice,
  withCity,
} from "../app/game/career";
import {
  accumulateDrivingStats,
  createEmptyDrivingStats,
  drivingStatsIncrement,
  parseDrivingStats,
  trackedDistanceDelta,
} from "../app/game/drivingStats";
import {
  chargeFreeDrive,
  clearCareer,
  createDefaultProgress,
  recordFreeDriveDistance,
  resetProgress,
  settleFreeDriveGig,
  writeCareer,
} from "../app/game/progress";

describe("driving statistics model", () => {
  it("defaults missing values to zero and repairs invalid persisted totals", () => {
    expect(parseDrivingStats(undefined)).toEqual(createEmptyDrivingStats());
    expect(
      parseDrivingStats({
        deliveriesCompleted: 3.9,
        ridesharesCompleted: -7,
        trafficCitations: Number.NaN,
        distanceDrivenM: Number.POSITIVE_INFINITY,
        earnedByCountry: { us: 120.8, jp: -1, eg: "broken" },
        spentByCountry: { uk: 8.6 },
      }),
    ).toEqual({
      deliveriesCompleted: 3,
      ridesharesCompleted: 0,
      trafficCitations: 0,
      distanceDrivenM: 0,
      earnedByCountry: { us: 120.8, uk: 0, jp: 0, eg: 0 },
      spentByCountry: { us: 0, uk: 8.6, jp: 0, eg: 0 },
    });
  });

  it("accumulates immutably and never mixes country currencies", () => {
    const original = drivingStatsIncrement({
      earned: { countryId: "us", amount: 25 },
      spent: { countryId: "jp", amount: 400 },
    });
    const next = accumulateDrivingStats(
      original,
      drivingStatsIncrement({
        deliveriesCompleted: 1,
        distanceDrivenM: 123.9,
        earned: { countryId: "eg", amount: 75 },
        spent: { countryId: "uk", amount: 9 },
      }),
    );

    expect(next).not.toBe(original);
    expect(original.earnedByCountry).toEqual({ us: 25, uk: 0, jp: 0, eg: 0 });
    expect(next.earnedByCountry).toEqual({ us: 25, uk: 0, jp: 0, eg: 75 });
    expect(next.spentByCountry).toEqual({ us: 0, uk: 9, jp: 400, eg: 0 });
    expect(next.distanceDrivenM).toBe(123);
  });

  it("accepts only the same under-40-metre movement used by fuel", () => {
    expect(trackedDistanceDelta({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(trackedDistanceDelta({ x: 4, z: 4 }, { x: 4, z: 4 })).toBe(0);
    expect(trackedDistanceDelta({ x: 0, z: 0 }, { x: 40, z: 0 })).toBe(0);
    expect(trackedDistanceDelta({ x: 0, z: 0 }, { x: 400, z: 0 })).toBe(0);
    expect(trackedDistanceDelta({ x: 0, z: 0 }, { x: Number.NaN, z: 0 })).toBe(0);
  });
});

describe("Free Drive lifetime accounting", () => {
  it("records fares, tips, expenses, citations, and integer distance", () => {
    const starting = createDefaultProgress();
    const paid = settleFreeDriveGig(starting, "us", "passenger", 37);
    const travelled = recordFreeDriveDistance(paid, 281.7);
    const fined = chargeFreeDrive(travelled, "us", 20, true);

    expect(fined.walletByCountry.us).toBe(starting.walletByCountry.us + 17);
    expect(fined.freeDriveStats).toMatchObject({
      deliveriesCompleted: 0,
      ridesharesCompleted: 1,
      trafficCitations: 1,
      distanceDrivenM: 281,
      earnedByCountry: { us: 37 },
      spentByCountry: { us: 20 },
    });
  });

  it("counts a citation but only records money actually removed", () => {
    const starting = createDefaultProgress();
    const nearlyEmpty = {
      ...starting,
      walletByCountry: { ...starting.walletByCountry, eg: 3 },
    };
    const fined = chargeFreeDrive(nearlyEmpty, "eg", 500, true);

    expect(fined.walletByCountry.eg).toBe(0);
    expect(fined.freeDriveStats.trafficCitations).toBe(1);
    expect(fined.freeDriveStats.spentByCountry.eg).toBe(3);
  });

  it("preserves minor currency units instead of rounding spending down", () => {
    const charged = chargeFreeDrive(createDefaultProgress(), "us", 0.4);
    expect(charged.freeDriveStats.spentByCountry.us).toBe(0.4);
  });

  it("resetting all local progress clears both modes", () => {
    const reset = resetProgress(undefined);
    expect(reset.freeDriveStats).toEqual(createEmptyDrivingStats());
    expect(reset.career).toBeNull();
  });
});

describe("Career lifetime accounting", () => {
  it("commits the complete day ledger only at settlement", () => {
    const morning = createCareerSlice({ destinationId: "us-nyc", careerSeed: 22 });
    const loan = { principalRemaining: 90, daysRemaining: 3 };
    const ledger = {
      ...emptyDayLog(),
      grossFares: 1_000,
      netFares: 800,
      tips: 50,
      finesTotal: 25,
      repairsTotal: 30,
      fuelSpendTotal: 20,
      rentPaid: 100,
      gigsCompleted: 3,
      deliveriesCompleted: 2,
      ridesharesCompleted: 1,
      trafficCitations: 2,
      distanceDrivenM: 321.9,
    };

    // A live ledger is not part of the persisted slice; abandoning here keeps zeroes.
    expect(careerStatusStats(morning)).toEqual(createEmptyDrivingStats());

    const settlement = settleDay({
      cash: 10_000,
      ledger,
      loan,
      finalNotice: false,
      platformFee: 10,
      rule: "grace",
    });
    const committed = applySettlement(morning, ledger, settlement);
    const stats = careerStatusStats(committed);

    expect(stats).toMatchObject({
      deliveriesCompleted: 2,
      ridesharesCompleted: 1,
      trafficCitations: 2,
      distanceDrivenM: 321,
      earnedByCountry: { us: 850 },
      spentByCountry: {
        us: 100 + 25 + 30 + 20 + 10 + nextInstallment(loan),
      },
    });
  });

  it("records vehicle and flight purchases immediately at their save boundaries", () => {
    const vehicle = getCareerVehicle("compact-hatch");
    const initial = createCareerSlice({ destinationId: "us-nyc", careerSeed: 7 });
    const vehiclePrice = buyoutPrice(vehicle, "us");
    const flightPrice = ticketPrice("us-nyc") as number;
    const funded = withCity(initial, "us-nyc", {
      ...activeCity(initial),
      cash: vehiclePrice + flightPrice + 10,
    });
    const bought = applyVehiclePurchase(funded, vehicle);
    const flown = applyTicket(bought);

    expect(careerStatusStats(bought).spentByCountry.us).toBe(vehiclePrice);
    expect(careerStatusStats(flown).spentByCountry.us).toBe(
      vehiclePrice + flightPrice,
    );
    expect(careerStatusStats(flown).spentByCountry.jp).toBe(0);
  });

  it("preserves lifetime totals through a bankruptcy city wipe", () => {
    const morning = createCareerSlice({ destinationId: "us-nyc", careerSeed: 2 });
    const firstLedger = { ...emptyDayLog(), deliveriesCompleted: 1, netFares: 20 };
    const first = applySettlement(
      morning,
      firstLedger,
      settleDay({
        cash: 100,
        ledger: firstLedger,
        loan: null,
        finalNotice: false,
        platformFee: 3,
        rule: "strict",
      }),
    );
    const failedLedger = { ...emptyDayLog(), trafficCitations: 1, finesTotal: 7 };
    const failedSettlement = settleDay({
      cash: -100,
      ledger: failedLedger,
      loan: { principalRemaining: 30, daysRemaining: 2 },
      finalNotice: false,
      platformFee: 3,
      rule: "strict",
    });
    expect(failedSettlement.outcome).toBe("game_over");

    const wiped = applySettlement(first, failedLedger, failedSettlement);
    expect(activeCity(wiped).day).toBe(1);
    expect(careerStatusStats(wiped).deliveriesCompleted).toBe(1);
    expect(careerStatusStats(wiped).trafficCitations).toBe(1);
    expect(careerStatusStats(wiped).earnedByCountry.us).toBe(20);
  });

  it("adds zero statistics to a verified pre-feature career", () => {
    const current = createCareerSlice({ destinationId: "eg-cairo", careerSeed: 91 });
    const legacyFields = { ...current, statusStats: undefined };
    const parsed = parseCareerSlice(stampCareerChecksum(legacyFields));

    expect(parsed).not.toBeNull();
    expect(parsed?.state).not.toBe("corrupt");
    if (parsed && parsed.state !== "corrupt") {
      expect(careerStatusStats(parsed)).toEqual(createEmptyDrivingStats());
    }
  });

  it("career-only reset preserves Free Drive statistics", () => {
    const free = settleFreeDriveGig(createDefaultProgress(), "uk", "delivery", 14);
    const career = createCareerSlice({ destinationId: "us-nyc", careerSeed: 3 });
    const cleared = clearCareer(writeCareer(free, career));

    expect(cleared.career).toBeNull();
    expect(cleared.freeDriveStats).toEqual(free.freeDriveStats);
  });
});
