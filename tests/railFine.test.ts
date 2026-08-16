import { describe, expect, it } from "vitest";
import { getCountryProfile } from "../app/game/content";
import { FINE_BY_COUNTRY, railwayCrossingFine } from "../app/game/economyTables";

describe("railwayCrossingFine", () => {
  it("charges five times the flat fine in every country, on the currency's step", () => {
    expect(railwayCrossingFine(getCountryProfile("us"))).toBe(40);
    expect(railwayCrossingFine(getCountryProfile("uk"))).toBe(40);
    expect(railwayCrossingFine(getCountryProfile("jp"))).toBe(4000);
    expect(railwayCrossingFine(getCountryProfile("eg"))).toBe(2000);
  });

  it("stays the game's heftiest citation — above any speeding ticket", () => {
    for (const id of ["us", "uk", "jp", "eg"] as const) {
      const country = getCountryProfile(id);
      // speedingFine caps at 2x the flat fine; this is 5x by design.
      expect(railwayCrossingFine(country)).toBeGreaterThan(
        FINE_BY_COUNTRY[id] * 2,
      );
    }
  });
});
