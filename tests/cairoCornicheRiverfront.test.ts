import { describe, expect, it } from "vitest";
import { buildingSetModelIds } from "../app/game/buildingSets";
import {
  CAIRO_CORNICHE_RIVERFRONT_ACCENTS,
  CAIRO_MAP_PACK,
  CAIRO_NILE_ISLAND_RIVERFRONT_ACCENTS,
} from "../app/game/cities/cairo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { carveBlocksForRailCorridors } from "../app/game/geometry/railCorridor";

describe("Cairo Corniche riverfront buildings", () => {
  const accentIds = new Set(
    CAIRO_CORNICHE_RIVERFRONT_ACCENTS.map((accent) => accent.id),
  );

  it("uses one existing Cairo asset per deliberately short accent parcel", () => {
    expect(CAIRO_CORNICHE_RIVERFRONT_ACCENTS).toHaveLength(9);
    for (const accent of CAIRO_CORNICHE_RIVERFRONT_ACCENTS) {
      expect(accent.buildingSet, accent.id).toBe("cairo-corniche");
      expect(accent.streetEdges, accent.id).toEqual(["-z"]);
      expect(accent.frontageAxis, accent.id).toBe("z");
      expect(accent.addressable, accent.id).toBe(false);
      expect(accent.size, accent.id).toEqual({ x: 20.5, z: 20.2 });
    }

    const plan = planMapBuildings(CAIRO_MAP_PACK, 2601);
    const buildings = plan.buildings.filter((building) =>
      accentIds.has(building.blockId),
    );
    expect(buildings).toHaveLength(CAIRO_CORNICHE_RIVERFRONT_ACCENTS.length);
    const allowedModels = new Set(buildingSetModelIds("cairo-corniche"));
    for (const building of buildings) {
      expect(building.source, building.id).toBe("asset-slot");
      if (building.source === "asset-slot") {
        expect(allowedModels.has(building.modelId), building.id).toBe(true);
      }
    }
    expect(
      new Set(
        buildings.flatMap((building) =>
          building.source === "asset-slot" ? [building.modelId] : [],
        ),
      ).size,
    ).toBeGreaterThanOrEqual(3);
  });

  it("leaves broad Nile-view corridors throughout the formerly empty north half", () => {
    const northern = CAIRO_CORNICHE_RIVERFRONT_ACCENTS.filter(
      (accent) => accent.center.z > 20,
    ).sort((left, right) => left.center.z - right.center.z);
    expect(northern).toHaveLength(8);

    const clearGaps = northern.slice(1).map((accent, index) => {
      const previous = northern[index];
      return (
        accent.center.z -
        accent.size.x / 2 -
        (previous.center.z + previous.size.x / 2)
      );
    });
    // The ordinary rhythm is ~80 m of open river view. The one larger gap is
    // intentional: the Sixth October flyover occupies it at z~=240.
    expect(Math.min(...clearGaps)).toBeGreaterThanOrEqual(79);
    expect(Math.max(...clearGaps)).toBeLessThanOrEqual(116);
    expect(
      CAIRO_CORNICHE_RIVERFRONT_ACCENTS.some(
        (accent) => accent.center.z >= 215 && accent.center.z <= 270,
      ),
    ).toBe(false);

    const frontageCoverage =
      northern.reduce((sum, accent) => sum + accent.size.x, 0) / (850 - 20);
    expect(frontageCoverage).toBeLessThan(0.21);
  });

  it("survives the railway keep-out unchanged", () => {
    const carved = carveBlocksForRailCorridors(
      CAIRO_CORNICHE_RIVERFRONT_ACCENTS,
      CAIRO_MAP_PACK.geometry.railLines ?? [],
    );
    expect(carved.removedBlockIds).toEqual([]);
    expect(carved.trimmedBlockIds).toEqual([]);
    expect(carved.blocks).toEqual(CAIRO_CORNICHE_RIVERFRONT_ACCENTS);
    expect(
      CAIRO_CORNICHE_RIVERFRONT_ACCENTS.some(
        (accent) => accent.center.z >= -751 && accent.center.z <= -615,
      ),
    ).toBe(false);
  });
});

describe("Cairo south Gezira riverfront building", () => {
  const accent = CAIRO_NILE_ISLAND_RIVERFRONT_ACCENTS[0];

  it("fills the photographed empty bay with one existing Cairo asset", () => {
    expect(CAIRO_NILE_ISLAND_RIVERFRONT_ACCENTS).toHaveLength(1);
    expect(accent.center).toEqual({ x: -99, z: -820 });
    expect(accent.size).toEqual({ x: 20.5, z: 20.2 });
    expect(accent.headingDeg).toBe(-98.84);
    expect(accent.streetEdges).toEqual(["+z"]);
    expect(accent.frontageAxis).toBe("z");
    expect(accent.buildingSet).toBe("cairo-corniche");
    expect(accent.addressable).toBe(false);

    const buildings = planMapBuildings(CAIRO_MAP_PACK, 2601).buildings.filter(
      (building) => building.blockId === accent.id,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0].source).toBe("asset-slot");
    if (buildings[0].source === "asset-slot") {
      expect(
        buildingSetModelIds("cairo-corniche").includes(buildings[0].modelId),
      ).toBe(true);
    }
  });

  it("stays south of the railway and between the two junction mouths", () => {
    expect(accent.center.x).toBeGreaterThanOrEqual(-110);
    expect(accent.center.x).toBeLessThanOrEqual(-90);
    expect(accent.center.z).toBeGreaterThan(-840);
    expect(accent.center.z).toBeLessThan(-800);

    const carved = carveBlocksForRailCorridors(
      CAIRO_NILE_ISLAND_RIVERFRONT_ACCENTS,
      CAIRO_MAP_PACK.geometry.railLines ?? [],
    );
    expect(carved.removedBlockIds).toEqual([]);
    expect(carved.trimmedBlockIds).toEqual([]);
    expect(carved.blocks).toEqual(CAIRO_NILE_ISLAND_RIVERFRONT_ACCENTS);
  });
});
