import { describe, expect, it } from "vitest";
import {
  FULL_CONDITION_PCT,
  SMOKE_HEAVY_CONDITION_PCT,
  SMOKE_LIGHT_CONDITION_PCT,
  damageForCollision,
} from "../app/game/damage";
import {
  FINE_BY_COUNTRY,
  getCountryProfile,
  repairPrice,
} from "../app/game/content";

describe("damageForCollision", () => {
  it("charges pedestrians and cyclists a small flat rate — the citation is the cost", () => {
    expect(
      damageForCollision({ roadUserType: "pedestrian", impactSpeedMps: 14 }),
    ).toBe(6);
    expect(
      damageForCollision({ roadUserType: "cyclist", impactSpeedMps: 3 }),
    ).toBe(6);
  });

  it("charges props by heft, not speed", () => {
    expect(
      damageForCollision({ obstacle: "prop", propKind: "hydrant", impactSpeedMps: 20 }),
    ).toBe(2);
    expect(
      damageForCollision({ obstacle: "prop", propKind: "streetlight", impactSpeedMps: 3 }),
    ).toBe(6);
    expect(
      damageForCollision({ obstacle: "prop", propKind: "tree", impactSpeedMps: 9 }),
    ).toBe(6);
  });

  it("scales wall damage with impact speed, with a free low-speed scrape", () => {
    expect(damageForCollision({ obstacle: "building", impactSpeedMps: 2 })).toBe(0);
    const moderate = damageForCollision({ obstacle: "building", impactSpeedMps: 8 });
    const hard = damageForCollision({ obstacle: "building", impactSpeedMps: 15 });
    expect(moderate).toBeGreaterThan(10);
    expect(hard).toBeGreaterThan(moderate);
    expect(hard).toBeLessThanOrEqual(40);
    expect(
      damageForCollision({ obstacle: "worldEdge", impactSpeedMps: 60 }),
    ).toBe(40);
  });

  it("scales vehicle damage with impact speed inside its clamps", () => {
    expect(damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 0 })).toBe(2);
    const crash = damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 12 });
    expect(crash).toBeGreaterThan(30);
    expect(
      damageForCollision({ vehicleId: "npc-3", impactSpeedMps: 100 }),
    ).toBe(45);
  });

  it("ignores evidence it does not recognise", () => {
    expect(damageForCollision({})).toBe(0);
    expect(damageForCollision({ somethingElse: true })).toBe(0);
  });

  it("keeps a full car several honest crashes away from a write-off", () => {
    const headOn = damageForCollision({ obstacle: "building", impactSpeedMps: 12 });
    expect(FULL_CONDITION_PCT / headOn).toBeGreaterThan(2);
    expect(SMOKE_HEAVY_CONDITION_PCT).toBeLessThan(SMOKE_LIGHT_CONDITION_PCT);
  });
});

describe("repairPrice", () => {
  const countries = (["us", "uk", "fr", "jp", "eg"] as const).map(
    getCountryProfile,
  );

  it("prices a full rebuild noticeably above a fine in every country", () => {
    // The band the old flat tow fee was tuned to, now applied to the honest
    // full repair: worse than a ticket, never enough to bankrupt a session.
    for (const country of countries) {
      const full = repairPrice(country, FULL_CONDITION_PCT, "shop");
      expect(full, country.id).toBeGreaterThanOrEqual(
        FINE_BY_COUNTRY[country.id] * 2,
      );
      expect(full, country.id).toBeLessThanOrEqual(
        FINE_BY_COUNTRY[country.id] * 5,
      );
    }
  });

  it("always makes a tow dearer than driving in — at every damage level", () => {
    // This is what issue #213 is actually about, and what stops a later tuner
    // quietly making the write-off the cheaper way out of a bad night.
    for (const country of countries) {
      const towed = repairPrice(country, FULL_CONDITION_PCT, "tow");
      expect(
        towed,
        `${country.id} tow vs full shop repair`,
      ).toBeGreaterThan(repairPrice(country, FULL_CONDITION_PCT, "shop") * 1.5);
      for (let damage = 0; damage <= FULL_CONDITION_PCT; damage += 5) {
        expect(
          repairPrice(country, damage, "shop"),
          `${country.id} shop at ${damage}% vs tow`,
        ).toBeLessThan(towed);
      }
    }
  });

  it("charges for the damage carried, not a flat fee", () => {
    for (const country of countries) {
      const full = repairPrice(country, FULL_CONDITION_PCT, "shop");
      expect(repairPrice(country, 0, "shop"), country.id).toBe(0);
      // Pro rata, within one rounding step of half the full price.
      const step = country.currency.minorUnits === 0 ? 100 : 1;
      expect(
        Math.abs(repairPrice(country, 50, "shop") - full / 2),
        country.id,
      ).toBeLessThanOrEqual(step);
      // Monotonic: more damage never costs less.
      let previous = -1;
      for (let damage = 0; damage <= FULL_CONDITION_PCT; damage += 1) {
        const price = repairPrice(country, damage, "shop");
        expect(price, `${country.id} at ${damage}%`).toBeGreaterThanOrEqual(
          previous,
        );
        previous = price;
      }
      // Damage cannot exceed a full car, however it is asked for.
      expect(repairPrice(country, 500, "shop"), country.id).toBe(full);
      expect(repairPrice(country, -20, "shop"), country.id).toBe(0);
    }
  });

  it("quotes a price the currency can actually be written in", () => {
    // Yen has no minor units, so a bill of ¥1,347 would be the only price in
    // the game that reads like a rounding artefact.
    for (const country of countries) {
      const step = country.currency.minorUnits === 0 ? 100 : 1;
      for (const damage of [7, 23, 41, 68, 99]) {
        for (const service of ["shop", "tow"] as const) {
          expect(
            repairPrice(country, damage, service) % step,
            `${country.id} ${service} at ${damage}%`,
          ).toBe(0);
        }
      }
    }
  });

  it("leaves a shop repair worth the detour at the damage that prompts one", () => {
    // The feature only works if limping in beats pressing on. A car at the
    // smoke threshold should cost a fraction of writing itself off.
    for (const country of countries) {
      const smoking = repairPrice(country, FULL_CONDITION_PCT - 30, "shop");
      const towed = repairPrice(country, FULL_CONDITION_PCT, "tow");
      expect(smoking * 2, country.id).toBeLessThan(towed);
    }
  });
});
