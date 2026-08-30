import { describe, expect, it } from "vitest";
import { buildingSetModelIds, isBuildingSetId } from "../app/game/buildingSets";
import {
  CAIRO_MAP_PACK,
  CAIRO_MARKED_GAP_ASSET_BLOCKS,
  CAIRO_MARKED_GAP_ASSET_PROMOTIONS,
  CAIRO_MARKED_GAP_EXISTING_COVERAGE,
} from "../app/game/cities/cairo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { carveBlocksForRailCorridors } from "../app/game/geometry/railCorridor";

describe("Cairo owner-marked gap buildings", () => {
  const plan = planMapBuildings(CAIRO_MAP_PACK, 2601);
  const blocksById = new Map(
    CAIRO_MAP_PACK.geometry.blocks.map((block) => [block.id, block]),
  );

  it("lands every new reviewed block as one or more existing Cairo assets", () => {
    expect(CAIRO_MARKED_GAP_ASSET_BLOCKS).toHaveLength(239);
    const ids = CAIRO_MARKED_GAP_ASSET_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const block of CAIRO_MARKED_GAP_ASSET_BLOCKS) {
      expect(block.buildingSet, block.id).toBeDefined();
      expect(isBuildingSetId(block.buildingSet ?? ""), block.id).toBe(true);
      expect(block.addressable, block.id).toBe(false);
      expect(blocksById.has(block.id), block.id).toBe(true);

      if (!block.buildingSet || !isBuildingSetId(block.buildingSet)) {
        throw new Error(`${block.id} does not name a real building set`);
      }
      const buildings = plan.buildings.filter(
        (building) => building.blockId === block.id,
      );
      expect(buildings.length, block.id).toBeGreaterThan(0);
      const allowedModels = new Set(
        buildingSetModelIds(block.buildingSet),
      );
      for (const building of buildings) {
        expect(building.source, building.id).toBe("asset-slot");
        if (building.source === "asset-slot") {
          expect(allowedModels.has(building.modelId), building.id).toBe(true);
          expect(building.modelId.startsWith("cairo-"), building.id).toBe(true);
        }
      }
    }
  });

  it("keeps every new block wholly outside the Imbaba rail corridor", () => {
    const carved = carveBlocksForRailCorridors(
      CAIRO_MARKED_GAP_ASSET_BLOCKS,
      CAIRO_MAP_PACK.geometry.railLines ?? [],
    );
    expect(carved.removedBlockIds).toEqual([]);
    expect(carved.trimmedBlockIds).toEqual([]);
    expect(carved.blocks).toEqual(CAIRO_MARKED_GAP_ASSET_BLOCKS);
  });

  it("keeps the reviewed west-exit terrace out of the bridge approach", () => {
    const blockId = "cairo-marked-gap-7-9";
    const block = blocksById.get(blockId);
    expect(block?.center.x).toBeCloseTo(-735.805829, 5);
    expect(block?.center.z).toBeCloseTo(369.052274, 5);
    expect(block?.size.x).toBe(7.4);

    const buildings = plan.buildings.filter(
      (building) => building.blockId === blockId,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0]).toMatchObject({
      source: "asset-slot",
      modelId: "cairo-block-slim",
      material: "cairo-render-grey",
    });
    expect(buildings[0].x).toBeCloseTo(-737.066441, 5);
    expect(buildings[0].z).toBeCloseTo(368.074594, 5);
  });

  it("promotes marked procedural footprints without stacking new geometry", () => {
    for (const [blockId, promotion] of Object.entries(
      CAIRO_MARKED_GAP_ASSET_PROMOTIONS,
    )) {
      const block = blocksById.get(blockId);
      expect(block, blockId).toBeDefined();
      expect(block?.buildingSet, blockId).toBe(promotion.buildingSet);
      expect(block?.addressable, blockId).toBe(false);
      if (promotion.streetEdges) {
        expect(block?.streetEdges, blockId).toEqual(promotion.streetEdges);
      }
      const buildings = plan.buildings.filter(
        (building) => building.blockId === blockId,
      );
      expect(buildings.length, blockId).toBeGreaterThan(0);
      expect(
        buildings.every((building) => building.source === "asset-slot"),
        blockId,
      ).toBe(true);
    }
  });

  it("accounts for all 31 red marks, including already-filled and protected slivers", () => {
    const covered = new Set<number>();
    for (const block of CAIRO_MARKED_GAP_ASSET_BLOCKS) {
      const match = /^cairo-marked-gap-(\d+)-/.exec(block.id);
      expect(match, block.id).not.toBeNull();
      if (match) covered.add(Number(match[1]));
    }
    for (const promotion of Object.values(
      CAIRO_MARKED_GAP_ASSET_PROMOTIONS,
    )) {
      promotion.marks.forEach((mark) => covered.add(mark));
    }
    for (const [mark, coverage] of Object.entries(
      CAIRO_MARKED_GAP_EXISTING_COVERAGE,
    )) {
      covered.add(Number(mark));
      for (const blockId of coverage.blockIds) {
        const block = blocksById.get(blockId);
        expect(block, `${mark}:${blockId}`).toBeDefined();
        const buildings = plan.buildings.filter(
          (building) => building.blockId === blockId,
        );
        expect(buildings.length, `${mark}:${blockId}`).toBeGreaterThan(0);
        if (coverage.reason === "existing-assets") {
          expect(
            buildings.every((building) => building.source === "asset-slot"),
            `${mark}:${blockId}`,
          ).toBe(true);
        }
      }
    }
    expect([...covered].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 31 }, (_, index) => index + 1),
    );
  });
});
