import { describe, expect, it } from "vitest";
import { formatDistance, getCountryProfile } from "../app/game/content";

const us = getCountryProfile("us");
const uk = getCountryProfile("uk");
const jp = getCountryProfile("jp");

describe("formatDistance", () => {
  it("signs each country in the units it actually drives in", () => {
    // Derived from `speedUnit` rather than a second field on the profile —
    // there is no country that drives in mph and signs in kilometres.
    expect(formatDistance(1609.344, us)).toBe("1.0 mi");
    expect(formatDistance(643.7, uk)).toBe("0.4 mi");
    expect(formatDistance(1500, jp)).toBe("1.5 km");
    expect(formatDistance(350, jp)).toBe("350 m");
  });

  it("switches to the short unit once a tenth of a mile stops meaning anything", () => {
    // Britain signs the last stretch in yards, America in feet.
    expect(formatDistance(90, uk)).toBe("100 yd");
    expect(formatDistance(90, us)).toBe("300 ft");
    // And a tenth of a mile is where it hands over.
    expect(formatDistance(161, uk)).toBe("0.1 mi");
  });

  it("rounds coarsely, because this readout refreshes ten times a second", () => {
    // A string that changed every snapshot would re-lay-out a text node 10x a
    // second to tell nobody that 372 m became 371 m.
    expect(formatDistance(372, jp)).toBe("370 m");
    expect(formatDistance(371, jp)).toBe("370 m");
    expect(formatDistance(368, jp)).toBe("370 m");
  });

  it("never reads as zero distance while there is still distance to go", () => {
    for (const country of [us, uk, jp]) {
      for (const metres of [1, 5, 12, 40]) {
        expect(formatDistance(metres, country)).not.toMatch(/^0(\.0)? /);
      }
    }
  });

  it("survives the numbers a live readout can actually hand it", () => {
    // `routeProgress` clamps at zero, but NaN from an empty route must not
    // reach the HUD as "NaN mi".
    expect(formatDistance(0, jp)).toBe("10 m");
    expect(formatDistance(Number.NaN, jp)).toBe("10 m");
    expect(formatDistance(-50, us)).not.toMatch(/-/);
    expect(formatDistance(Number.POSITIVE_INFINITY, uk)).toBe("10 yd");
  });
});
