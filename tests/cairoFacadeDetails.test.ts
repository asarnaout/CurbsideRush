import { describe, expect, it } from "vitest";
import { cairoFacadeDetailPlan } from "../app/game/render/proceduralFacades";

describe("Cairo procedural facade details", () => {
  it("is deterministic without restarting every block at pharmacy", () => {
    const first = cairoFacadeDetailPlan("cairo-block-a", 0, 12.4, -83.7, 10);
    expect(cairoFacadeDetailPlan("cairo-block-a", 0, 12.4, -83.7, 10)).toEqual(first);
    expect(cairoFacadeDetailPlan("cairo-block-b", 0, 12.4, -83.7, 10)).not.toEqual(first);
  });

  it("keeps storefront signs sparse and distributes all ten business types", () => {
    const signs = Array.from({ length: 1000 }, (_, index) =>
      cairoFacadeDetailPlan(
        `cairo-block-${Math.floor(index / 4)}`,
        index % 4,
        index * 7.3,
        index * -4.9,
        10,
      ),
    ).filter((plan) => plan.shopSign);

    expect(signs.length).toBeGreaterThanOrEqual(75);
    expect(signs.length).toBeLessThanOrEqual(115);
    expect(new Set(signs.map((plan) => plan.businessIndex))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    expect(signs.filter((plan) => plan.businessIndex === 0).length).toBeLessThan(
      signs.length / 5,
    );
  });
});
