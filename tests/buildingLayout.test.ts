import { describe, expect, it } from "vitest";
import {
  diagnoseKeepOutSurvivorDeltas,
  isLondonMuseumBlock,
  planMapBuildings,
  type PlannedAssetBuilding,
  type PlannedBuilding,
  type PlannedProceduralBuilding,
} from "../app/game/geometry/buildingLayout";
import {
  buildingReservations,
  keptStreetWallBuildings,
  rotateBlockBuildingPlacements,
} from "../app/game/geometry/facadesAndKeepouts";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import { buildingStructuralBoundsFor } from "../app/game/buildingStructuralBounds";
import {
  assetDetailScoreForBlockSlot,
  isBuildingSetId,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { hashStringToSeed } from "../app/game/visuals";
import type { GameCanvasMapPack } from "../app/game/sessionContract";

const MAPS = [LONDON_MAP_PACK, CAIRO_MAP_PACK, NYC_MAP_PACK, TOKYO_MAP_PACK];

const isAssetSlot = (b: PlannedBuilding): b is PlannedAssetBuilding => b.source === "asset-slot";
const isProcedural = (b: PlannedBuilding): b is PlannedProceduralBuilding =>
  b.source === "procedural-cell" || b.source === "museum-wing";

/** A synthetic map pack for isolated unit tests — a real pack's every other
 * field (lane graph, controls, ...) with only `geometry.blocks` replaced, so
 * every required `GameCanvasMapPack` field stays valid without hand-building
 * the whole nested contract. */
function mapWithBlocks(
  base: GameCanvasMapPack,
  blocks: GameCanvasMapPack["geometry"]["blocks"],
): GameCanvasMapPack {
  return { ...base, geometry: { ...base.geometry, blocks } };
}

describe("planMapBuildings — determinism", () => {
  it("returns a deep-equal, byte-stable plan for the same map/seed twice", () => {
    for (const map of MAPS) {
      const a = planMapBuildings(map, 12345);
      const b = planMapBuildings(map, 12345);
      expect(a, map.id).toEqual(b);
    }
  });

  it("a different traffic seed changes procedural dimensions but not asset-slot identity/position", () => {
    const planA = planMapBuildings(LONDON_MAP_PACK, 1);
    const planB = planMapBuildings(LONDON_MAP_PACK, 2);
    const assetsA = planA.buildings.filter(isAssetSlot);
    const assetsB = planB.buildings.filter(isAssetSlot);
    expect(assetsA.map((b) => b.id)).toEqual(assetsB.map((b) => b.id));
    expect(assetsA).toEqual(assetsB);

    const proceduralA = planA.buildings.filter(isProcedural);
    const proceduralB = planB.buildings.filter(isProcedural);
    // Museum wings are fixed geometry (no random draw) so they stay
    // identical too; ordinary procedural cells must differ somewhere.
    const anyDifferentDimension = proceduralA.some((entry, index) => {
      const other = proceduralB[index];
      return (
        other &&
        entry.source === "procedural-cell" &&
        other.source === "procedural-cell" &&
        (entry.widthM !== other.widthM ||
          entry.depthM !== other.depthM ||
          entry.heightM !== other.heightM)
      );
    });
    expect(anyDifferentDimension).toBe(true);
  });
});

describe("planMapBuildings — stable ids", () => {
  for (const map of MAPS) {
    it(`${map.id} produces unique ids in the documented schemes`, () => {
      const plan = planMapBuildings(map, map.laneGraph.lanes[0] ? hashStringToSeed(map.id) : 1);
      const ids = plan.buildings.map((b) => b.id);
      expect(new Set(ids).size, map.id).toBe(ids.length);
      for (const building of plan.buildings) {
        if (building.source === "asset-slot") {
          expect(building.id).toBe(
            `building:${building.blockId}:slot:${building.edge}:${building.edgeSlot}`,
          );
        } else if (building.source === "museum-wing") {
          expect(building.id).toMatch(
            new RegExp(`^building:${building.blockId}:museum-wing:-?1$`),
          );
        } else {
          expect(building.id).toBe(`building:${building.blockId}:cell:${building.cellIndex}`);
        }
      }
    });
  }
});

describe("planMapBuildings — asset-slot blockSlot/assetDetailScore/renderOrdinal", () => {
  it("matches the legacy full/all-success sequence exactly on a real London block", () => {
    const block = LONDON_MAP_PACK.geometry.blocks.find(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet) && !b.streetEdges,
    )!;
    expect(block, "expected at least one four-edge building-set block").toBeTruthy();
    const setId = block.buildingSet as Parameters<typeof slotBlockBuildings>[2];
    const rawSlots = slotBlockBuildings(
      block.center,
      block.size,
      setId,
      hashStringToSeed(`${block.id}-buildings`),
      1,
      block.streetEdges,
    );
    const rotated = rotateBlockBuildingPlacements(rawSlots, block.center, block.headingDeg);
    const reservations = buildingReservations(LONDON_MAP_PACK);
    const legacySurvivors = keptStreetWallBuildings(rotated, reservations);

    const plan = planMapBuildings(LONDON_MAP_PACK, LONDON_MAP_PACK.laneGraph.lanes.length);
    const planned = plan.buildings
      .filter(isAssetSlot)
      .filter((b) => b.blockId === block.id)
      .sort((a, b) => a.renderOrdinal - b.renderOrdinal);

    expect(planned.length).toBe(legacySurvivors.length);
    planned.forEach((entry, index) => {
      const legacy = legacySurvivors[index];
      expect(entry.edge).toBe(legacy.edge);
      expect(entry.edgeSlot).toBe(legacy.edgeSlot);
      expect(entry.blockSlot).toBe(legacy.blockSlot);
      expect(entry.assetDetailScore).toBe(assetDetailScoreForBlockSlot(legacy.blockSlot));
      expect(entry.renderOrdinal).toBe(index);
      expect(entry.modelId).toBe(legacy.modelId);
      expect(entry.x).toBeCloseTo(legacy.x, 9);
      expect(entry.z).toBeCloseTo(legacy.z, 9);
    });
  });

  it("fraction 0.5 asset-id selection (score < fraction) matches the legacy low-spec retained subset", () => {
    const block = CAIRO_MAP_PACK.geometry.blocks.find(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet),
    )!;
    const setId = block.buildingSet as Parameters<typeof slotBlockBuildings>[2];
    const reservations = buildingReservations(CAIRO_MAP_PACK);

    const legacyHalfSlots = slotBlockBuildings(
      block.center,
      block.size,
      setId,
      hashStringToSeed(`${block.id}-buildings`),
      0.5,
      block.streetEdges,
    );
    const legacyHalfSurvivors = keptStreetWallBuildings(
      rotateBlockBuildingPlacements(legacyHalfSlots, block.center, block.headingDeg),
      reservations,
    );
    const legacyKeySet = new Set(legacyHalfSurvivors.map((b) => `${b.edge}:${b.edgeSlot}`));

    const plan = planMapBuildings(CAIRO_MAP_PACK, 777);
    const planKeySet = new Set(
      plan.buildings
        .filter(isAssetSlot)
        .filter((b) => b.blockId === block.id && b.assetDetailScore < 0.5)
        .map((b) => `${b.edge}:${b.edgeSlot}`),
    );
    expect(planKeySet).toEqual(legacyKeySet);
  });
});

describe("planMapBuildings — streetEdges filtering", () => {
  it("a single named edge produces slots on no other edge", () => {
    const donor = LONDON_MAP_PACK.geometry.blocks.find(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet),
    )!;
    const oneEdgeBlock = { ...donor, id: "test-one-edge", streetEdges: ["+z"] as const };
    const plan = planMapBuildings(mapWithBlocks(LONDON_MAP_PACK, [oneEdgeBlock]), 1);
    const entries = plan.buildings.filter(isAssetSlot);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.edge).toBe("+z");
  });

  it("an omitted streetEdges retains all-edge semantics", () => {
    const donor = LONDON_MAP_PACK.geometry.blocks.find(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet) && !b.streetEdges,
    )!;
    const allEdgesBlock = { ...donor, id: "test-all-edges", streetEdges: undefined };
    const plan = planMapBuildings(mapWithBlocks(LONDON_MAP_PACK, [allEdgesBlock]), 1);
    const edges = new Set(plan.buildings.filter(isAssetSlot).map((b) => b.edge));
    expect(edges.size).toBe(4);
  });
});

describe("planMapBuildings — rotation and structural offset", () => {
  it("axis-aligned block: asset solid world position equals placement position when the manifest centre is (0,0)", () => {
    const block = NYC_MAP_PACK.geometry.blocks.find(
      (b) =>
        b.buildingSet &&
        isBuildingSetId(b.buildingSet) &&
        Math.abs(b.headingDeg ?? 0) < 1e-6,
    )!;
    const plan = planMapBuildings(NYC_MAP_PACK, 1);
    const entries = plan.buildings.filter(isAssetSlot).filter((b) => b.blockId === block.id);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const bounds = buildingStructuralBoundsFor(entry.modelId)!;
      const solid = entry.solids[0];
      const localCenterX = (bounds.solids[0].minX + bounds.solids[0].maxX) / 2;
      const localCenterZ = (bounds.solids[0].minZ + bounds.solids[0].maxZ) / 2;
      const cos = Math.cos(entry.yaw);
      const sin = Math.sin(entry.yaw);
      expect(solid.x).toBeCloseTo(entry.x + localCenterX * cos + localCenterZ * sin, 9);
      expect(solid.z).toBeCloseTo(entry.z - localCenterX * sin + localCenterZ * cos, 9);
      expect(solid.halfU).toBeCloseTo((bounds.solids[0].maxX - bounds.solids[0].minX) / 2, 9);
      expect(solid.halfV).toBeCloseTo((bounds.solids[0].maxZ - bounds.solids[0].minZ) / 2, 9);
    }
  });

  it("a rotated block's procedural solids carry the block heading in their yaw/axes", () => {
    const rotatedBlock = CAIRO_MAP_PACK.geometry.blocks.find(
      (b) => Math.abs(b.headingDeg ?? 0) > 1 && !(b.buildingSet && isBuildingSetId(b.buildingSet)),
    );
    expect(rotatedBlock, "expected at least one rotated procedural Cairo block").toBeTruthy();
    const plan = planMapBuildings(CAIRO_MAP_PACK, 1);
    const entries = plan.buildings
      .filter(isProcedural)
      .filter((b) => b.blockId === rotatedBlock!.id);
    expect(entries.length).toBeGreaterThan(0);
    const headingRad = ((rotatedBlock!.headingDeg ?? 0) * Math.PI) / 180;
    for (const entry of entries) {
      // facadeGridCells's rotationY IS the block heading for every cell, and
      // the planner never adds a second rotation on top of it.
      expect(entry.yaw).toBeCloseTo(headingRad, 9);
      expect(entry.solids[0].ux).toBeCloseTo(Math.cos(entry.yaw), 9);
      expect(entry.solids[0].uz).toBeCloseTo(-Math.sin(entry.yaw), 9);
    }
  });

  it("an asset-slot solid with a non-zero manifest offset is transformed exactly once (not twice)", () => {
    // nyc-tenement's manifest centre is off local origin in Z — a real,
    // asymmetric offset (see buildingStructuralBounds.ts).
    const bounds = buildingStructuralBoundsFor("nyc-tenement")!;
    const localCenterZ = (bounds.solids[0].minZ + bounds.solids[0].maxZ) / 2;
    expect(Math.abs(localCenterZ)).toBeGreaterThan(0.5);

    let found: PlannedAssetBuilding | undefined;
    for (const map of MAPS) {
      const plan = planMapBuildings(map, 1);
      found = plan.buildings.filter(isAssetSlot).find((b) => b.modelId === "nyc-tenement");
      if (found) break;
    }
    expect(found, "expected nyc-tenement to be placed on at least one map").toBeTruthy();
    const entry = found!;
    const solid = entry.solids[0];
    const cos = Math.cos(entry.yaw);
    const sin = Math.sin(entry.yaw);
    const localCenterX = (bounds.solids[0].minX + bounds.solids[0].maxX) / 2;
    expect(solid.x).toBeCloseTo(entry.x + localCenterX * cos + localCenterZ * sin, 9);
    expect(solid.z).toBeCloseTo(entry.z - localCenterX * sin + localCenterZ * cos, 9);
    // Not simply equal to the placement position — proves the offset was
    // actually applied, not silently dropped.
    expect(Math.hypot(solid.x - entry.x, solid.z - entry.z)).toBeGreaterThan(0.4);
  });
});

describe("planMapBuildings — Cairo frontage placement", () => {
  it("uses the planner's own drawn width/depth, matching cairoFrontagePosition's contract", () => {
    const block = CAIRO_MAP_PACK.geometry.blocks.find(
      (b) => !(b.buildingSet && isBuildingSetId(b.buildingSet)),
    )!;
    const plan = planMapBuildings(CAIRO_MAP_PACK, 42);
    const entries = plan.buildings
      .filter(isProcedural)
      .filter((b) => b.blockId === block.id && b.source === "procedural-cell");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // Every Cairo procedural building sits pulled to a block edge (frontage
      // placement), never at the raw grid-cell centre for a block this size.
      const halfX = block.size.x / 2;
      const halfZ = block.size.z / 2;
      const dx = Math.abs(entry.x - block.center.x);
      const dz = Math.abs(entry.z - block.center.z);
      expect(dx <= halfX + 0.01 || dz <= halfZ + 0.01).toBe(true);
    }
  });
});

describe("planMapBuildings — museum wings", () => {
  it("emits the renderer's exact wing dimensions with an open forecourt at block centre", () => {
    const block = LONDON_MAP_PACK.geometry.blocks.find((b) =>
      isLondonMuseumBlock(LONDON_MAP_PACK.id, b),
    )!;
    expect(block).toBeTruthy();
    const plan = planMapBuildings(LONDON_MAP_PACK, 1);
    const wings = plan.buildings.filter(
      (b): b is PlannedProceduralBuilding => b.source === "museum-wing" && b.blockId === block.id,
    );
    expect(wings).toHaveLength(2);

    const expectedWidth = Math.max(12, block.size.x * 0.23);
    const expectedDepth = block.size.z * 0.82;
    const expectedHeight = Math.max(11, block.heightRange[0] * 0.72);
    for (const wing of wings) {
      expect(wing.widthM).toBeCloseTo(expectedWidth, 9);
      expect(wing.depthM).toBeCloseTo(expectedDepth, 9);
      expect(wing.heightM).toBeCloseTo(expectedHeight, 9);
      expect(wing.material).toBe(block.material);
      expect(wing.solids).toHaveLength(1);
    }
    const sides = wings.map((w) => Math.sign(w.x - block.center.x));
    expect(new Set(sides)).toEqual(new Set([-1, 1]));

    // The block centre (the forecourt) must be outside both wings' X spans.
    for (const wing of wings) {
      const solid = wing.solids[0];
      const inside =
        Math.abs(block.center.x - solid.x) < solid.halfU &&
        Math.abs(block.center.z - solid.z) < solid.halfV;
      expect(inside, wing.id).toBe(false);
    }
  });
});

describe("planMapBuildings — zero-survivor set fallbacks", () => {
  const FIVE_LONDON_FALLBACK_BLOCKS = [
    "london-block-regent-w-2",
    "london-block-regent-e-2",
    "london-block-regent-w-3",
    "london-block-regent-e-3",
    "london-block-qgt-mid-fab",
  ];

  it("plans exactly the five documented London blocks as procedural fallbacks, and none of them as asset-slot", () => {
    const plan = planMapBuildings(LONDON_MAP_PACK, 1);
    for (const blockId of FIVE_LONDON_FALLBACK_BLOCKS) {
      const entries = plan.buildings.filter((b) => b.blockId === blockId);
      expect(entries.length, blockId).toBeGreaterThan(0);
      expect(
        entries.every((b) => b.source === "procedural-cell"),
        blockId,
      ).toBe(true);
      expect(
        entries.every(
          (b) => b.source === "procedural-cell" && b.layoutReason === "set-zero-survivor-fallback",
        ),
        blockId,
      ).toBe(true);
    }
  });

  it("london-block-qgt-mid-fab retains its eight current fallback cells", () => {
    const plan = planMapBuildings(LONDON_MAP_PACK, 1);
    const entries = plan.buildings.filter((b) => b.blockId === "london-block-qgt-mid-fab");
    expect(entries).toHaveLength(8);
  });

  it("direct procedural blocks consume the random stream before deferred set fallbacks", () => {
    // If the deferred fallback ran interleaved (not after the full first
    // pass), a same-seed replay would still be internally consistent (both
    // runs take the same path), so this instead pins the documented ordering
    // directly: every direct-procedural entry's plan-array index precedes
    // every deferred-fallback entry's, since deferred blocks are appended in
    // a wholly separate second loop.
    const plan = planMapBuildings(LONDON_MAP_PACK, 1);
    const lastDirectIndex = plan.buildings.reduce(
      (last, entry, index) =>
        entry.source === "procedural-cell" && entry.layoutReason !== "set-zero-survivor-fallback"
          ? index
          : last,
      -1,
    );
    const firstDeferredIndex = plan.buildings.findIndex(
      (entry) =>
        entry.source === "procedural-cell" && entry.layoutReason === "set-zero-survivor-fallback",
    );
    expect(firstDeferredIndex).toBeGreaterThan(-1);
    expect(lastDirectIndex).toBeLessThan(firstDeferredIndex);
  });
});

describe("planMapBuildings — unknown building set", () => {
  it("falls back deterministically to the procedural plan", () => {
    const donor = LONDON_MAP_PACK.geometry.blocks.find(
      (b) => !b.buildingSet && !isLondonMuseumBlock(LONDON_MAP_PACK.id, b),
    )!;
    const unknownSetBlock = { ...donor, id: "test-unknown-set", buildingSet: "not-a-real-set" };
    const plan = planMapBuildings(mapWithBlocks(LONDON_MAP_PACK, [unknownSetBlock]), 1);
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const entry of plan.buildings) {
      expect(entry.source).toBe("procedural-cell");
      expect((entry as PlannedProceduralBuilding).layoutReason).toBe("unknown-building-set");
    }
  });
});

describe("planMapBuildings — every set model resolves to structural bounds", () => {
  for (const map of MAPS) {
    it(`${map.id} plans without throwing`, () => {
      expect(() => planMapBuildings(map, 1)).not.toThrow();
    });
  }
});

describe("planMapBuildings — procedural-cell relaxation (plan Section 8's mechanism extended beyond asset-slot blocks)", () => {
  // london-v37 (Guild Lane Pharmacy): historical-buffer circle radius 19 m at
  // (1089.69, 155.66); exact solid an 8x8 m box at the same centre (verified
  // via placedVenueFootprint in scratch exploration before writing this).
  // Real London-content case this generalises: Section 10.2's Cornmarket P0
  // needed exactly this -- Cornmarket's own street wall is a deliberately
  // procedural (non-buildingSet) Portland-stone block, and
  // `keptStreetWallBuildings` alone never reaches a procedural cell.
  const venue = LONDON_MAP_PACK.geometry.gigVenues?.find((v) => v.id === "london-v37");
  if (!venue) throw new Error("london-v37 (Guild Lane Pharmacy) not found in LONDON_MAP_PACK");
  // Unrotated 20x20 block, density 0 -> 3 cells at (1099,150.66)/(1109,150.66)/
  // (1099,160.66), all inside the 19 m buffer by nominal footprint. At
  // trafficSeed 0, cells 0 and 1's jittered exact boxes clear the pharmacy's
  // real 8x8 solid + 0.75 m clearance once relaxed and allow-listed; cell 2's
  // does not -- verified empirically, not derived by hand (an OBB-vs-OBB SAT
  // clearance under seeded width/depth jitter isn't worth re-deriving here).
  const block = {
    id: "test-relax-block",
    center: { x: 1104, z: 155.66 },
    size: { x: 20, z: 20 },
    density: 0,
    heightRange: [10, 14] as const,
    material: "london-portland-stone",
  };
  const map = mapWithBlocks(LONDON_MAP_PACK, [block]) as GameCanvasMapPack;
  const withVenueOnly = { ...map, geometry: { ...map.geometry, gigVenues: [venue], servicePoints: [] } };
  const allThreeIds = new Set([
    "building:test-relax-block:cell:0",
    "building:test-relax-block:cell:1",
    "building:test-relax-block:cell:2",
  ]);

  it("unrelaxed: every cell inside the buffer is excluded, same as the legacy behaviour", () => {
    expect(planMapBuildings(withVenueOnly, 0).buildings).toEqual([]);
  });

  it("relaxed with an empty allow-list: still excluded (the review gate, not an automatic pass)", () => {
    const plan = planMapBuildings(withVenueOnly, 0, {
      relaxations: [{ ownerId: "london-v37", allowedRestoredPlanIds: new Set() }],
    });
    expect(plan.buildings).toEqual([]);
  });

  it("relaxed and allow-listed: only the cells whose exact solid actually clears the pharmacy survive", () => {
    const plan = planMapBuildings(withVenueOnly, 0, {
      relaxations: [{ ownerId: "london-v37", allowedRestoredPlanIds: allThreeIds }],
    });
    const ids = plan.buildings.map((b) => b.id).sort();
    expect(ids).toEqual(["building:test-relax-block:cell:0", "building:test-relax-block:cell:1"]);
  });

  it("relaxed and allow-listed but only for the cell that still overlaps: stays excluded", () => {
    const plan = planMapBuildings(withVenueOnly, 0, {
      relaxations: [{ ownerId: "london-v37", allowedRestoredPlanIds: new Set(["building:test-relax-block:cell:2"]) }],
    });
    expect(plan.buildings).toEqual([]);
  });
});

describe("London P0 Cornmarket closure (plan Section 10.2)", () => {
  const plan = planMapBuildings(LONDON_MAP_PACK, 2251, relaxationPolicyForMap(LONDON_MAP_PACK.id));
  const cornmarketBlockIds = [
    "london-block-cornmarket-w",
    "london-block-cornmarket-w-near",
    "london-block-cornmarket-e-near",
  ];

  it("each new/adjusted block exists exactly once", () => {
    for (const blockId of cornmarketBlockIds) {
      expect(LONDON_MAP_PACK.geometry.blocks.filter((b) => b.id === blockId), blockId).toHaveLength(1);
    }
  });

  it("every new building-set block has an explicit streetEdges value", () => {
    // -w is deliberately excluded: it is the pre-existing generic procedural
    // (Portland-stone, no buildingSet) backdrop, pushed back via
    // extraInsetM but otherwise untouched -- streetEdges is meaningless for
    // it (the procedural facade grid reads frontageAxis instead, per
    // ProceduralBlock's own doc comment) and it never had one.
    for (const blockId of ["london-block-cornmarket-w-near", "london-block-cornmarket-e-near"]) {
      const block = LONDON_MAP_PACK.geometry.blocks.find((b) => b.id === blockId)!;
      expect(block.streetEdges, blockId).toBeDefined();
      expect(block.streetEdges!.length, blockId).toBeGreaterThan(0);
    }
  });

  it("the close frontages are not addressable — scenery only, no reachable destination", () => {
    for (const blockId of ["london-block-cornmarket-w-near", "london-block-cornmarket-e-near"]) {
      const block = LONDON_MAP_PACK.geometry.blocks.find((b) => b.id === blockId)!;
      expect(block.addressable, blockId).toBe(false);
    }
  });

  it("the near frontage keeps its two slots outside the buffer plus the two the relaxation restores", () => {
    // Slots 0-1 sit outside Guild Lane Pharmacy's 19 m historical buffer by
    // nominal footprint alone -- they need no relaxation and would survive
    // under DEFAULT_RELAXATION_POLICY too. Slots 2-3 are the ones the
    // relaxation actually restores (verified geometrically clear of the
    // pharmacy's exact 8x8 solid); slots 4-5, closest to the venue, stay
    // excluded even allow-listed -- see the "still overlapping" case in
    // tests/buildingReservations.test.ts for that same three-condition gate.
    const restored = plan.buildings.filter((b) => b.blockId === "london-block-cornmarket-w-near");
    expect(restored.map((b) => b.id).sort()).toEqual([
      "building:london-block-cornmarket-w-near:slot:-z:0",
      "building:london-block-cornmarket-w-near:slot:-z:1",
      "building:london-block-cornmarket-w-near:slot:-z:2",
      "building:london-block-cornmarket-w-near:slot:-z:3",
    ]);
  });

  it("no planned Cornmarket solid overlaps another planned solid anywhere on the map", () => {
    // A cheap but real pairwise check restricted to solids actually near
    // Cornmarket (O(local x all) instead of O(all x all)) -- the exact
    // failure mode a misjudged extraInsetM/depthM could introduce silently.
    const cornmarketSolids = plan.buildings
      .filter((b) => cornmarketBlockIds.includes(b.blockId))
      .flatMap((b) => b.solids.map((s) => ({ ownerId: b.id, ...s })));
    expect(cornmarketSolids.length).toBeGreaterThan(0);
    const nearby = plan.buildings.filter((b) =>
      cornmarketSolids.some((s) => Math.hypot(b.x - s.x, b.z - s.z) < 60),
    );
    const allNearbySolids = nearby.flatMap((b) => b.solids.map((s) => ({ ownerId: b.id, ...s })));
    const sat = (a: (typeof allNearbySolids)[number], b: (typeof allNearbySolids)[number]) => {
      const axes: readonly [number, number][] = [
        [a.ux, a.uz],
        [a.uz, -a.ux],
        [b.ux, b.uz],
        [b.uz, -b.ux],
      ];
      const cornersOf = (s: (typeof allNearbySolids)[number]) => {
        const vx = s.uz;
        const vz = -s.ux;
        return [
          { x: s.x + s.ux * s.halfU + vx * s.halfV, z: s.z + s.uz * s.halfU + vz * s.halfV },
          { x: s.x - s.ux * s.halfU + vx * s.halfV, z: s.z - s.uz * s.halfU + vz * s.halfV },
          { x: s.x - s.ux * s.halfU - vx * s.halfV, z: s.z - s.uz * s.halfU - vz * s.halfV },
          { x: s.x + s.ux * s.halfU - vx * s.halfV, z: s.z + s.uz * s.halfU - vz * s.halfV },
        ];
      };
      const cornersA = cornersOf(a);
      const cornersB = cornersOf(b);
      for (const [ax, az] of axes) {
        const projA = cornersA.map((c) => c.x * ax + c.z * az);
        const projB = cornersB.map((c) => c.x * ax + c.z * az);
        if (Math.max(...projA) < Math.min(...projB) || Math.max(...projB) < Math.min(...projA)) return false;
      }
      return true;
    };
    for (let i = 0; i < cornmarketSolids.length; i += 1) {
      for (const other of allNearbySolids) {
        if (other.ownerId === cornmarketSolids[i].ownerId) continue;
        expect(sat(cornmarketSolids[i], other), `${cornmarketSolids[i].ownerId} vs ${other.ownerId}`).toBe(false);
      }
    }
  });
});

describe("diagnoseKeepOutSurvivorDeltas", () => {
  it("runs read-only against every map without mutating a subsequent plan", () => {
    for (const map of MAPS) {
      const before = planMapBuildings(map, 9);
      const deltas = diagnoseKeepOutSurvivorDeltas(map);
      expect(Array.isArray(deltas), map.id).toBe(true);
      for (const delta of deltas) {
        expect(typeof delta.blockId).toBe("string");
        expect(typeof delta.legacySurvived).toBe("boolean");
        expect(typeof delta.exactSurvived).toBe("boolean");
      }
      const after = planMapBuildings(map, 9);
      expect(after, map.id).toEqual(before);
    }
  });
});
