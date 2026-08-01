import { describe, expect, it } from "vitest";

import { garageRatingModel } from "../app/CareerViews";
import {
  EMPTY_RATING,
  RATING_END_THRESHOLD,
  RATING_MIN_RATED,
  type CityRating,
} from "../app/game/career";

/** A window that averages exactly `stars`, long enough to have an average. */
const rated = (stars: number, patch: Partial<CityRating> = {}): CityRating => ({
  recent: Array.from({ length: RATING_MIN_RATED }, () => stars),
  ratedTotal: 40,
  notice: false,
  previousAverage: null,
  ...patch,
});

describe("the garage's rating card", () => {
  it("says nothing at all until the city has seen enough of the driver", () => {
    const model = garageRatingModel({ ...EMPTY_RATING, recent: [5, 4, 5], ratedTotal: 3 });
    expect(model.tone).toBe("unrated");
    expect(model.average).toBeNull();
    expect(model.averageText).toBe("—");
    expect(model.fill).toBe(0);
    expect(model.countLabel).toBe(`3 OF ${RATING_MIN_RATED}`);
    expect(model.floorLabel).toBe(`RATED AFTER ${RATING_MIN_RATED} JOBS`);
    // Unrated is not a bad rating: no warning, no alarm.
    expect(model.atRisk).toBe(false);
    expect(model.noticed).toBe(false);
    expect(model.announcement).toMatch(/4 more rated jobs/);
  });

  it("starts reading the moment there are enough", () => {
    expect(garageRatingModel(rated(4)).tone).not.toBe("unrated");
    expect(
      garageRatingModel({ ...EMPTY_RATING, recent: Array(RATING_MIN_RATED - 1).fill(4) }).tone,
    ).toBe("unrated");
  });

  it("bands the average the way the card is coloured", () => {
    expect(garageRatingModel(rated(5)).tone).toBe("excellent");
    expect(garageRatingModel(rated(4.5)).tone).toBe("excellent");
    expect(garageRatingModel(rated(4)).tone).toBe("good");
    expect(garageRatingModel(rated(3)).tone).toBe("slipping");
    expect(garageRatingModel(rated(2)).tone).toBe("shaky");
    expect(garageRatingModel(rated(1)).tone).toBe("critical");
    expect(garageRatingModel(rated(5)).gradeLabel).toBe("EXCELLENT");
    expect(garageRatingModel(rated(1)).gradeLabel).toBe("CRITICAL");
  });

  it("quotes the real termination figure rather than a number of its own", () => {
    // The card naming a threshold the settlement does not use would be worse
    // than it naming none, so the copy is worded off the constant.
    expect(garageRatingModel(rated(4)).floorLabel).toBe(
      `OUT AT ${RATING_END_THRESHOLD.toFixed(2)}`,
    );
    expect(garageRatingModel(rated(2)).floorLabel).toBe(
      `${(2 - RATING_END_THRESHOLD).toFixed(2)} ABOVE TERMINATION`,
    );
    // And the bar's tick marks that same figure on the 1-to-5 scale.
    expect(garageRatingModel(rated(4)).floorMark).toBeCloseTo(
      (RATING_END_THRESHOLD - 1) / 4,
      6,
    );
  });

  it("gives the warning the whole line by dropping the count", () => {
    const safe = garageRatingModel(rated(3));
    expect(safe.atRisk).toBe(false);
    expect(safe.countLabel).toBe("40 RATINGS");

    const sinking = garageRatingModel(rated(2));
    expect(sinking.atRisk).toBe(true);
    expect(sinking.countLabel).toBeNull();
  });

  it("counts one rating without pluralising it", () => {
    expect(garageRatingModel(rated(4, { ratedTotal: 1 })).countLabel).toBe("1 RATING");
  });

  it("lets a standing warning speak over the arithmetic", () => {
    // `notice` is the settlement's own verdict, so it is the honest thing to
    // say — the margin above the line is no longer the point.
    const model = garageRatingModel(rated(1.5, { notice: true }));
    expect(model.noticed).toBe(true);
    expect(model.floorLabel).toBe("ONE BAD NIGHT FROM OUT");
  });

  it("reads the trend off last night's average", () => {
    expect(garageRatingModel(rated(4, { previousAverage: 3.5 })).trend).toBe("up");
    expect(garageRatingModel(rated(4, { previousAverage: 4.5 })).trend).toBe("down");
    // Nothing to compare a first settlement to.
    expect(garageRatingModel(rated(4, { previousAverage: null })).trend).toBe("level");
    // And a move too small to change the second decimal is not a move.
    expect(garageRatingModel(rated(4, { previousAverage: 3.999 })).trend).toBe("level");
  });

  it("spans the bar across the whole scale, never past either end", () => {
    expect(garageRatingModel(rated(1)).fill).toBe(0);
    expect(garageRatingModel(rated(3)).fill).toBeCloseTo(0.5, 6);
    expect(garageRatingModel(rated(5)).fill).toBe(1);
  });

  it("rounds to two places everywhere it shows a number", () => {
    // A star rating that moves in tenths reads as a guess.
    const model = garageRatingModel({
      ...EMPTY_RATING,
      recent: [5, 4, 5, 4, 5, 4, 5],
      ratedTotal: 7,
    });
    expect(model.averageText).toBe("4.57");
  });
});
