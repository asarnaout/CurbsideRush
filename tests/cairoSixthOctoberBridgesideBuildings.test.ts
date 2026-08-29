import { describe, expect, it } from "vitest";
import {
  CAIRO_MAP_PACK,
  CAIRO_SIXTH_OCTOBER_BRIDGESIDE_ASSET_BLOCKS,
} from "../app/game/cities/cairo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";

const EXISTING_CAIRO_MODEL_IDS = new Set([
  "cairo-block-4story",
  "cairo-block-4story-centre",
  "cairo-block-balcony",
  "cairo-block-colonnade",
  "cairo-block-small",
  "cairo-block-slim",
  "cairo-block-terrace",
  "cairo-depot",
  "cairo-office-block",
  "cairo-residence-kay",
  "cairo-residence-quaternius",
  "cairo-shop",
  "cairo-walkup-a",
  "cairo-walkup-b",
]);

describe("Cairo Sixth October bridge-side infill", () => {
  const plan = planMapBuildings(CAIRO_MAP_PACK, 2601);

  it("fills all four marked land groups with the reviewed parcel counts", () => {
    expect(CAIRO_SIXTH_OCTOBER_BRIDGESIDE_ASSET_BLOCKS).toHaveLength(17);
    const ids = CAIRO_SIXTH_OCTOBER_BRIDGESIDE_ASSET_BLOCKS.map(
      (block) => block.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      Object.fromEntries(
        ["west-south", "gezira-north", "gezira-south", "east-north", "east-south"].map(
          (zone) => [zone, ids.filter((id) => id.includes(`-${zone}-`)).length],
        ),
      ),
    ).toEqual({
      "west-south": 1,
      "gezira-north": 1,
      "gezira-south": 2,
      "east-north": 5,
      "east-south": 8,
    });
  });

  it("resolves every parcel to exactly one pre-existing Cairo asset", () => {
    const mapBlockIds = new Set(
      CAIRO_MAP_PACK.geometry.blocks.map((block) => block.id),
    );
    for (const block of CAIRO_SIXTH_OCTOBER_BRIDGESIDE_ASSET_BLOCKS) {
      expect(mapBlockIds.has(block.id), block.id).toBe(true);
      expect(block.addressable, block.id).toBe(false);
      expect(block.streetEdges, block.id).toHaveLength(1);

      const buildings = plan.buildings.filter(
        (building) => building.blockId === block.id,
      );
      expect(buildings, block.id).toHaveLength(1);
      expect(buildings[0].source, block.id).toBe("asset-slot");
      if (buildings[0].source === "asset-slot") {
        expect(EXISTING_CAIRO_MODEL_IDS.has(buildings[0].modelId), block.id).toBe(
          true,
        );
        expect(buildings[0].modelId.startsWith("cairo-"), block.id).toBe(true);
      }
    }
  });
});
