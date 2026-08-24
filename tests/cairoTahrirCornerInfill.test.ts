import { describe, expect, it } from "vitest";
import {
  CAIRO_MAP_PACK,
  CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS,
  CAIRO_TAHRIR_MARKED_LOT_PLANTING_CLEARING,
  cairoTahrirMarkedLotAllowsRoadsidePlacement,
} from "../app/game/cities/cairo";
import { buildingSetModelIds } from "../app/game/buildingSets";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { carveBlocksForRailCorridors } from "../app/game/geometry/railCorridor";

describe("Cairo Tahrir marked-lot infill", () => {
  const blockIds = new Set(
    CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS.map((block) => block.id),
  );
  const buildings = planMapBuildings(CAIRO_MAP_PACK, 2601).buildings.filter(
    (building) => blockIds.has(building.blockId),
  );

  it("places a visible building group across the reviewed paved lot", () => {
    expect(CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS).toHaveLength(7);
    for (const block of CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS) {
      expect(CAIRO_MAP_PACK.geometry.blocks).toContainEqual(block);
      expect(block.buildingSet).toBe("cairo-downtown");
      expect(block.streetEdges).toEqual(["-z"]);
      expect(block.addressable).toBe(false);
    }

    expect(buildings).toHaveLength(7);
    const allowedModels = new Set(buildingSetModelIds("cairo-downtown"));
    const westernBuilding = buildings.find(
      (building) =>
        building.blockId === "cairo-tahrir-marked-lot-infill-west",
    );
    expect(westernBuilding?.source).toBe("procedural-cell");
    for (const building of buildings.filter(
      (candidate) => candidate !== westernBuilding,
    )) {
      expect(building.source).toBe("asset-slot");
      if (building.source === "asset-slot") {
        expect(allowedModels.has(building.modelId)).toBe(true);
      }
    }
  });

  it("stays wholly outside the Imbaba rail corridor", () => {
    const carved = carveBlocksForRailCorridors(
      CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS,
      CAIRO_MAP_PACK.geometry.railLines ?? [],
    );
    expect(carved.removedBlockIds).toEqual([]);
    expect(carved.trimmedBlockIds).toEqual([]);
    expect(carved.blocks).toEqual(CAIRO_TAHRIR_MARKED_LOT_INFILL_BLOCKS);
  });

  it("removes only planting from the corner while preserving street furniture", () => {
    const { center, radiusM } = CAIRO_TAHRIR_MARKED_LOT_PLANTING_CLEARING;
    expect(center).toEqual({ x: 73.84, z: -223.18 });
    // Exact deterministic promenade point visible in the review screenshot.
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "palm",
        x: 73.8337439848,
        z: -223.1842781454,
      }),
    ).toBe(false);
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "palm",
        x: center.x,
        z: center.z,
      }),
    ).toBe(false);
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "tree",
        x: center.x + radiusM - 0.01,
        z: center.z,
      }),
    ).toBe(false);
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "streetlight",
        x: center.x,
        z: center.z,
      }),
    ).toBe(true);
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "palm",
        x: center.x + radiusM,
        z: center.z,
      }),
    ).toBe(true);
    expect(
      cairoTahrirMarkedLotAllowsRoadsidePlacement({
        kind: "palm",
        x: 76.0225,
        z: -170.0276,
      }),
    ).toBe(true);
  });
});
