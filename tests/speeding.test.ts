import { describe, expect, it } from "vitest";
import {
  CITATION_TOLERANCE_FRACTION,
  CITATION_TOLERANCE_MPS,
  SPEEDING_FINE_FULL_SCALE_OVER,
  SPEEDING_STOP_GRACE_MS,
  speedingExcessMps,
  speedingFineMultiplier,
  speedingWarrantsCitation,
} from "../app/game/speeding";
import { COUNTRY_PROFILES, getCountryProfile } from "../app/game/content";
import {
  FINE_BY_COUNTRY,
  postedSpeed,
  speedingFine,
} from "../app/game/economyTables";

describe("what a patrol writes a ticket for", () => {
  // 30 mph in m/s — the figure the raised NYC avenues now post.
  const LIMIT_MPS = 13.4;
  const at = (overMps: number) => ({
    speedMps: LIMIT_MPS + overMps,
    limitMps: LIMIT_MPS,
  });

  it("leaves the coaching band alone", () => {
    // The monitor already spoke up at max(1.3, limit * 0.08) over — about
    // 3 mph here. Charging money at that line would stop a driver for drift.
    expect(speedingWarrantsCitation(at(1.4))).toBe(false);
    expect(speedingWarrantsCitation(at(CITATION_TOLERANCE_MPS - 0.01))).toBe(false);
  });

  it("cites once the driver is clearly over", () => {
    expect(speedingWarrantsCitation(at(CITATION_TOLERANCE_MPS + 0.01))).toBe(true);
    expect(speedingWarrantsCitation(at(8))).toBe(true);
  });

  it("scales its tolerance with the limit on a fast road", () => {
    // The flat 2.2 m/s floor only binds up to ~14.7 m/s of limit; above that
    // the fraction takes over, so a 60 mph road is not ticketed at 5 mph over.
    const fast = 26.8; // 60 mph
    const fraction = fast * CITATION_TOLERANCE_FRACTION;
    expect(fraction).toBeGreaterThan(CITATION_TOLERANCE_MPS);
    expect(
      speedingWarrantsCitation({ speedMps: fast + fraction - 0.1, limitMps: fast }),
    ).toBe(false);
    expect(
      speedingWarrantsCitation({ speedMps: fast + fraction + 0.1, limitMps: fast }),
    ).toBe(true);
  });

  it("refuses to cite an event it cannot measure", () => {
    // The amount is derived from the excess, so an unmeasurable violation must
    // not be a chargeable one. The monitor always emits both figures.
    expect(speedingExcessMps(undefined)).toBeNull();
    expect(speedingExcessMps({ speedMps: 20 })).toBeNull();
    expect(speedingExcessMps({ speedMps: 20, limitMps: 0 })).toBeNull();
    expect(speedingWarrantsCitation({ unrelated: "value" })).toBe(false);
  });

  it("reports the excess the fine is priced from", () => {
    expect(speedingExcessMps(at(6))).toBeCloseTo(6, 9);
  });
});

describe("what the ticket costs", () => {
  const us = getCountryProfile("us");
  const jp = getCountryProfile("jp");

  it("charges the flat fine at the limit and twice it at the top", () => {
    expect(speedingFine(us, 0)).toBe(FINE_BY_COUNTRY.us);
    expect(speedingFine(us, SPEEDING_FINE_FULL_SCALE_OVER.mph)).toBe(
      FINE_BY_COUNTRY.us * 2,
    );
  });

  it("never charges more than twice the flat fine, however reckless", () => {
    for (const country of COUNTRY_PROFILES) {
      const base = FINE_BY_COUNTRY[country.id];
      expect(speedingFine(country, 500)).toBeLessThanOrEqual(base * 2);
      expect(speedingFine(country, 500)).toBeGreaterThanOrEqual(base);
    }
  });

  it("rises with the excess and never falls", () => {
    let previous = 0;
    for (let over = 0; over <= 40; over += 1) {
      const fine = speedingFine(us, over);
      expect(fine).toBeGreaterThanOrEqual(previous);
      previous = fine;
    }
  });

  it("prices a real stop between one and two fares", () => {
    // A patrol only cites past its own tolerance, so no ticket is ever issued
    // at the very bottom of the range. In New York that is $10 to $16.
    const citedAt = postedSpeed(CITATION_TOLERANCE_MPS, us);
    expect(speedingFine(us, citedAt)).toBe(10);
    expect(speedingFine(us, 20)).toBe(16);
  });

  it("keeps a yen ticket a round number", () => {
    // Every other price in the game is whole yen; a fine reading Y1,347 would
    // be the only one that is not.
    for (let over = 0; over <= 40; over += 1) {
      expect(speedingFine(jp, over) % 100).toBe(0);
    }
    expect(speedingFine(jp, 0)).toBe(FINE_BY_COUNTRY.jp);
    expect(speedingFine(jp, 32)).toBe(FINE_BY_COUNTRY.jp * 2);
  });

  it("scales the same way in either unit", () => {
    // 20 mph over and 32 km/h over are the same piece of driving, so both
    // must land on the cap. A single set of figures applied to both units
    // would have made a metric ticket max out at 20 km/h — 12 mph.
    expect(speedingFineMultiplier(20, "mph")).toBe(2);
    expect(speedingFineMultiplier(32, "kmh")).toBe(2);
    expect(speedingFineMultiplier(20, "kmh")).toBeLessThan(2);
  });

  it("treats a nonsense excess as no excess rather than a free ride", () => {
    expect(speedingFine(us, Number.NaN)).toBe(FINE_BY_COUNTRY.us);
    expect(speedingFine(us, -50)).toBe(FINE_BY_COUNTRY.us);
  });

  it("leaves long enough between stops to be recognisable as policing", () => {
    // The rule re-arms after 8s in the core and the app debounce is another 8.
    expect(SPEEDING_STOP_GRACE_MS).toBeGreaterThan(8_000 * 2);
  });
});
