import type { BlockStreetEdge } from "../types";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import {
  assetDetailScoreForBlockSlot,
  isBuildingSetId,
  slotBlockBuildings,
  type BuildingSetId,
  type PlacedBuilding,
} from "../buildingSets";
import {
  buildingStructuralBoundsFor,
  type BuildingStructuralBounds,
  type BuildingStructuralSolid,
} from "../buildingStructuralBounds";
import {
  buildingReservations,
  cairoFrontageFootprintsOverlap,
  cairoFrontagePosition,
  DEFAULT_RELAXATION_POLICY,
  facadeGridCells,
  isInsideHistoricalBuffer,
  keptStreetWallBuildings,
  rotateBlockBuildingPlacements,
  type BuildingReservation,
  type CairoFrontageFootprint,
  type RelaxationPolicy,
} from "./facadesAndKeepouts";
import { hashStringToSeed, seededUnit } from "../visuals";

/**
 * The single pure, deterministic, Babylon-free building structural plan —
 * plan `.claude/building-collision-visual-parity-plan.md` Section 7. One
 * `planMapBuildings` call replaces the two independent things that used to
 * separately decide "where is a building": the instanced glb street wall
 * (`slotBlockBuildings` + `BuildingLayer`) and a full-block collider loop
 * `simulationAdapter.ts` no longer has. Both the renderer and collision
 * consume this plan's output instead of recomputing their own occupancy —
 * see Section 6.1's "one logical structural plan" invariant.
 *
 * `planMapBuildings` reproduces the full-detail, fully-loaded structural
 * layout the pre-plan renderer and collider used to compute independently,
 * byte-for-byte (this file's own tests pin that). It must stay pure: no
 * Babylon, no DOM, no wall-clock, no unseeded randomness — mechanically
 * enforced by the same ESLint rule every other `geometry/*.ts` file obeys.
 */

type MapBlock = GameCanvasMapPack["geometry"]["blocks"][number];

// ---------------------------------------------------------------------------
// Plan data model (Section 7.2)
// ---------------------------------------------------------------------------

/** One exact structural solid, already in world space (not a local offset —
 * "local" in the sense that it is one piece of a possibly-compound plan
 * entry). U is the box's own extent axis; V is its perpendicular
 * `(uz, -ux)` — the same convention `StaticObstacleInternal`/`buildStaticObstacles`
 * already use, so a later Phase-4 conversion is a direct field copy. */
export interface StructuralObb {
  readonly localId: string;
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

interface PlannedBuildingBase {
  readonly id: string;
  readonly blockId: string;
  readonly source: "asset-slot" | "procedural-cell" | "museum-wing";
  readonly material: string;
  readonly heightM: number;
  readonly solids: readonly StructuralObb[];
}

export interface PlannedAssetBuilding extends PlannedBuildingBase {
  readonly source: "asset-slot";
  readonly edge: BlockStreetEdge;
  readonly edgeSlot: number;
  /** Raw slot order within this block, before keep-out removal. */
  readonly blockSlot: number;
  /** Stable low-spec selection score derived from blockSlot. */
  readonly assetDetailScore: number;
  /** Surviving full-detail order within this block, after keep-outs. */
  readonly renderOrdinal: number;
  readonly modelId: string;
  readonly url: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly groundY: number;
}

export type ProceduralLayoutReason =
  | "authored-procedural"
  | "unknown-building-set"
  | "set-zero-survivor-fallback";

export interface PlannedProceduralBuilding extends PlannedBuildingBase {
  readonly source: "procedural-cell" | "museum-wing";
  readonly layoutReason?: ProceduralLayoutReason;
  readonly cellIndex?: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly widthM: number;
  readonly depthM: number;
}

export type PlannedBuilding = PlannedAssetBuilding | PlannedProceduralBuilding;

export interface BuildingLayoutPlan {
  readonly mapId: string;
  readonly trafficSeed: number;
  readonly buildings: readonly PlannedBuilding[];
}

// ---------------------------------------------------------------------------
// Shared local-to-world solid transform (Section 7.4 step 5)
// ---------------------------------------------------------------------------

/**
 * Places one curated manifest solid (a local rectangle, already in post-scale
 * metres, centred wherever the manifest measured it — NOT necessarily at
 * local origin) at a holder's world position/yaw. `frontOffset` is already
 * folded into `yaw` by the caller (it comes back out of `slotBlockBuildings`
 * baked into `PlacedBuilding.yaw`); `squareUpYaw` is baked into the merged
 * master the manifest itself measured, so applying `yaw` here is the ONLY
 * rotation this solid ever receives — matches
 * `rotateBlockBuildingPlacements`'s own `x + localX·cos + localZ·sin` /
 * `z − localX·sin + localZ·cos` convention exactly (that function performs
 * the identical operation — rotating a local offset by a holder's own yaw —
 * and is already proven correct by the existing Cairo rotated-parcel test
 * sweeps). The `ux`/`uz` returned here are not independently re-derived for
 * collision: `simulationAdapter.ts`'s `buildStaticObstacles` reads this
 * exact `StructuralObb` and passes `ux`/`uz` straight through into the
 * `kind: "obb"` obstacle, so a render/collision rotation mismatch is
 * structurally impossible rather than merely untested.
 */
function worldSolidFromLocalBounds(
  localId: string,
  px: number,
  pz: number,
  yaw: number,
  bounds: BuildingStructuralSolid,
): StructuralObb {
  const localCenterX = (bounds.minX + bounds.maxX) / 2;
  const localCenterZ = (bounds.minZ + bounds.maxZ) / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    localId,
    x: px + localCenterX * cos + localCenterZ * sin,
    z: pz - localCenterX * sin + localCenterZ * cos,
    ux: cos,
    uz: -sin,
    halfU: (bounds.maxX - bounds.minX) / 2,
    halfV: (bounds.maxZ - bounds.minZ) / 2,
  };
}

function structuralSolidsFor(
  modelId: string,
  px: number,
  pz: number,
  yaw: number,
): { readonly solids: readonly StructuralObb[]; readonly bounds: BuildingStructuralBounds } {
  const bounds = buildingStructuralBoundsFor(modelId);
  if (!bounds) {
    // Caught immediately by buildingStructuralBounds.ts's own completeness
    // test/helper (missingStructuralBoundsConfigs) for every set model
    // reachable at all — reaching this at runtime means a set references a
    // model the manifest was never updated for, which is exactly the parity
    // defect this whole plan exists to eliminate, so this must not
    // silently degrade to an invisible collider.
    throw new Error(
      `geometry/buildingLayout.ts: no curated structural bounds for model "${modelId}" — add an entry to buildingStructuralBounds.ts`,
    );
  }
  return {
    bounds,
    solids: bounds.solids.map((solid) =>
      worldSolidFromLocalBounds(solid.localId, px, pz, yaw, solid),
    ),
  };
}

// ---------------------------------------------------------------------------
// London museum blocks
// ---------------------------------------------------------------------------

// Exactly the renderer's (`buildScenarioEnvironment`'s block loop) and the
// adapter's (`buildStaticObstacles`) two independent museum-wing
// calculations, which agree on every figure but `wingHeight` (a render-only
// concern, absent from collision) — ported verbatim per Section 7.4 rather
// than redesigned, and the two call sites are meant to be deleted once they
// consume this plan instead (Phases 3 and 4).
const MUSEUM_WING_MIN_WIDTH_M = 12;
const MUSEUM_WING_WIDTH_FRACTION = 0.23;
const MUSEUM_WING_DEPTH_FRACTION = 0.82;
const MUSEUM_WING_OFFSET_FRACTION = 0.37;
const MUSEUM_WING_MIN_HEIGHT_M = 11;
const MUSEUM_WING_HEIGHT_FRACTION = 0.72;

export function isLondonMuseumBlock(mapId: string, block: MapBlock): boolean {
  return mapId.includes("london") && block.material.endsWith("-museum");
}

function planMuseumWings(block: MapBlock): PlannedProceduralBuilding[] {
  const wingWidth = Math.max(MUSEUM_WING_MIN_WIDTH_M, block.size.x * MUSEUM_WING_WIDTH_FRACTION);
  const wingDepth = block.size.z * MUSEUM_WING_DEPTH_FRACTION;
  const wingHeight = Math.max(
    MUSEUM_WING_MIN_HEIGHT_M,
    block.heightRange[0] * MUSEUM_WING_HEIGHT_FRACTION,
  );
  return ([-1, 1] as const).map((side) => {
    const wingX = block.center.x + side * block.size.x * MUSEUM_WING_OFFSET_FRACTION;
    return {
      id: `building:${block.id}:museum-wing:${side}`,
      blockId: block.id,
      source: "museum-wing",
      material: block.material,
      heightM: wingHeight,
      x: wingX,
      z: block.center.z,
      yaw: 0,
      widthM: wingWidth,
      depthM: wingDepth,
      solids: [
        {
          localId: "wing",
          x: wingX,
          z: block.center.z,
          ux: 1,
          uz: 0,
          halfU: wingWidth / 2,
          halfV: wingDepth / 2,
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Building-set (asset-slot) blocks
// ---------------------------------------------------------------------------

/**
 * Plans one building-set block's street wall at structural fraction 1
 * (never quality-thinned — see Section 7.6). Returns an empty array when
 * every raw slot is excluded by a keep-out (or the block produced no raw
 * slots at all), which the caller must treat as a deferred procedural
 * layout fallback, never as "this block has no buildings" (Section 7.4).
 */
function planAssetSlotBlock(
  block: MapBlock,
  setId: BuildingSetId,
  reservations: readonly BuildingReservation[],
  relaxationPolicy: RelaxationPolicy,
): readonly PlannedAssetBuilding[] {
  const rawSlots: readonly PlacedBuilding[] = slotBlockBuildings(
    block.center,
    block.size,
    setId,
    hashStringToSeed(`${block.id}-buildings`),
    1,
    block.streetEdges,
  );
  const rotated = rotateBlockBuildingPlacements(rawSlots, block.center, block.headingDeg);
  const survivors = keptStreetWallBuildings(
    rotated,
    reservations,
    relaxationPolicy,
    (placement) => `building:${block.id}:slot:${placement.edge}:${placement.edgeSlot}`,
  );
  return survivors.map((placedSurvivor, renderOrdinal) => {
    const { solids, bounds } = structuralSolidsFor(
      placedSurvivor.modelId,
      placedSurvivor.x,
      placedSurvivor.z,
      placedSurvivor.yaw,
    );
    return {
      id: `building:${block.id}:slot:${placedSurvivor.edge}:${placedSurvivor.edgeSlot}`,
      blockId: block.id,
      source: "asset-slot",
      material: block.material,
      heightM: bounds.proxyHeightM,
      edge: placedSurvivor.edge,
      edgeSlot: placedSurvivor.edgeSlot,
      blockSlot: placedSurvivor.blockSlot,
      assetDetailScore: assetDetailScoreForBlockSlot(placedSurvivor.blockSlot),
      renderOrdinal,
      modelId: placedSurvivor.modelId,
      url: placedSurvivor.url,
      x: placedSurvivor.x,
      z: placedSurvivor.z,
      yaw: placedSurvivor.yaw,
      scale: placedSurvivor.scale,
      groundY: placedSurvivor.groundY,
      solids,
    };
  });
}

// ---------------------------------------------------------------------------
// Procedural (or unknown-set, or zero-survivor-fallback) blocks
// ---------------------------------------------------------------------------

// Preserved exactly from `render/proceduralFacades.ts`'s `placeBlock` — see
// that file's own doc comment for why this specific draw order (width, then
// depth, then conditionally height) is load-bearing for seeded-render
// determinism. `deterministicSceneryKeep`'s low-spec gate is deliberately
// NOT reproduced here: it always returns true (no draw, no skip) at fraction
// 1, which is the only fraction this planner ever runs at (Section 7.6:
// procedural structural boxes are never quality-deleted).
function planProceduralBlock(
  mapPack: GameCanvasMapPack,
  block: MapBlock,
  random: () => number,
  reservations: readonly BuildingReservation[],
  layoutReason: ProceduralLayoutReason,
): PlannedProceduralBuilding[] {
  const isWestBank = block.material === "cairo-west-bank-concrete";
  const cells = facadeGridCells(
    isWestBank ? { ...block, density: Math.min(1, block.density + 0.17) } : block,
  );
  const isCairo = mapPack.id.includes("cairo");
  const placedFrontages: CairoFrontageFootprint[] = [];
  const entries: PlannedProceduralBuilding[] = [];

  for (const cell of cells) {
    const width = Math.max(5, cell.cellWidth * (0.58 + random() * 0.24));
    const depth = Math.max(5, cell.cellDepth * (0.58 + random() * 0.24));
    const frontagePlacement = isCairo
      ? cairoFrontagePosition(block, cell, width, depth)
      : undefined;
    const buildingPosition: GameCanvasPoint = frontagePlacement ?? cell;
    const frontageFootprint: CairoFrontageFootprint | undefined = frontagePlacement
      ? { placement: frontagePlacement, widthM: width, depthM: depth }
      : undefined;
    if (
      frontageFootprint &&
      placedFrontages.some((placed) => cairoFrontageFootprintsOverlap(placed, frontageFootprint))
    ) {
      continue;
    }
    const height = block.heightRange[0] + random() * (block.heightRange[1] - block.heightRange[0]);
    const halfWidth =
      Math.abs(Math.cos(cell.rotationY)) * (width / 2) +
      Math.abs(Math.sin(cell.rotationY)) * (depth / 2);
    const halfDepth =
      Math.abs(Math.sin(cell.rotationY)) * (width / 2) +
      Math.abs(Math.cos(cell.rotationY)) * (depth / 2);
    if (isInsideHistoricalBuffer(reservations, buildingPosition.x, buildingPosition.z, halfWidth, halfDepth)) {
      continue;
    }
    if (frontageFootprint) placedFrontages.push(frontageFootprint);
    const cos = Math.cos(cell.rotationY);
    const sin = Math.sin(cell.rotationY);
    entries.push({
      id: `building:${block.id}:cell:${cell.index}`,
      blockId: block.id,
      source: "procedural-cell",
      material: block.material,
      heightM: height,
      layoutReason,
      cellIndex: cell.index,
      x: buildingPosition.x,
      z: buildingPosition.z,
      yaw: cell.rotationY,
      widthM: width,
      depthM: depth,
      solids: [
        {
          localId: "body",
          x: buildingPosition.x,
          z: buildingPosition.z,
          ux: cos,
          uz: -sin,
          halfU: width / 2,
          halfV: depth / 2,
        },
      ],
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Orchestrator (Section 7.4)
// ---------------------------------------------------------------------------

/**
 * The one pure, deterministic building structural plan for a map/scenario.
 * Reproduces the current full-detail, fully-loaded layout: the same
 * `hashStringToSeed(blockId + "-buildings")` per-block asset seed, the same
 * `seededUnit(trafficSeed)` stream in the same authored-block-then-deferred
 * order for procedural dimensions, and the same keep-out survivor predicate.
 *
 * Direct procedural/unknown-set blocks consume the random stream inline, in
 * authored block order; building-set blocks whose every slot is excluded by
 * a keep-out are queued and only planned procedurally AFTER that first pass
 * completes (matching `BuildingLayer`'s own deferred `placed === 0` fallback
 * timing — it only calls its fallback after the initial block pass and asset
 * preload), so a runtime asset load failure can never perturb this stream:
 * the fallback decision here is made from the KEEP-OUT survivor count alone,
 * never from whether a glb actually loaded.
 */
export function planMapBuildings(
  mapPack: GameCanvasMapPack,
  trafficSeed: number,
  relaxationPolicy: RelaxationPolicy = DEFAULT_RELAXATION_POLICY,
): BuildingLayoutPlan {
  const buildings: PlannedBuilding[] = [];
  const deferredSetBlocks: MapBlock[] = [];
  const random = seededUnit(trafficSeed);
  const reservations = buildingReservations(mapPack, relaxationPolicy);

  for (const block of mapPack.geometry.blocks) {
    if (isLondonMuseumBlock(mapPack.id, block)) {
      buildings.push(...planMuseumWings(block));
      continue;
    }
    if (block.buildingSet && isBuildingSetId(block.buildingSet)) {
      const planned = planAssetSlotBlock(block, block.buildingSet, reservations, relaxationPolicy);
      if (planned.length) {
        buildings.push(...planned);
      } else {
        deferredSetBlocks.push(block);
      }
      continue;
    }
    buildings.push(
      ...planProceduralBlock(
        mapPack,
        block,
        random,
        reservations,
        block.buildingSet ? "unknown-building-set" : "authored-procedural",
      ),
    );
  }

  for (const block of deferredSetBlocks) {
    buildings.push(
      ...planProceduralBlock(mapPack, block, random, reservations, "set-zero-survivor-fallback"),
    );
  }

  return { mapId: mapPack.id, trafficSeed, buildings };
}

// ---------------------------------------------------------------------------
// Collision conversion (Section 7.8)
// ---------------------------------------------------------------------------

/**
 * The stable `StaticObstacle.id` for one of a plan entry's solids (Section
 * 6.4). A single-solid entry (every current entry) collapses to its own
 * plan id directly; a future compound entry gets one id per solid. Shared
 * so collision conversion and any diagnostic/debug code that needs to
 * cross-reference an obstacle id back to its plan solid use the exact same
 * rule.
 */
export function buildingSolidObstacleId(
  plan: PlannedBuilding,
  solid: StructuralObb,
): string {
  return plan.solids.length === 1 ? plan.id : `${plan.id}:solid:${solid.localId}`;
}

// ---------------------------------------------------------------------------
// Diagnostics (Section 7.4): legacy-vs-exact keep-out survivor delta report
// ---------------------------------------------------------------------------

/** One block/slot where the legacy nominal-footprint keep-out predicate and
 * an exact circle-vs-structural-OBB intersection test disagree. Read-only —
 * `planMapBuildings` always uses the legacy predicate (Section 7.4); this
 * exists so a reviewer can see, without guessing, which slots a future exact
 * selection change would add or remove. */
export interface KeepOutSurvivorDelta {
  readonly blockId: string;
  readonly edge: BlockStreetEdge;
  readonly edgeSlot: number;
  readonly modelId: string;
  readonly legacySurvived: boolean;
  readonly exactSurvived: boolean;
}

/** Closest point on an OBB's boundary/interior to `(x, z)`, in world space —
 * used only by the diagnostic below, never by the production predicate. */
function nearestPointOnObb(solid: StructuralObb, x: number, z: number): { x: number; z: number } {
  const dx = x - solid.x;
  const dz = z - solid.z;
  const u = Math.max(-solid.halfU, Math.min(solid.halfU, dx * solid.ux + dz * solid.uz));
  const v = Math.max(-solid.halfV, Math.min(solid.halfV, dx * solid.uz - dz * solid.ux));
  return { x: solid.x + solid.ux * u + solid.uz * v, z: solid.z + solid.uz * u - solid.ux * v };
}

function circleIntersectsAnySolid(
  solids: readonly StructuralObb[],
  circle: { readonly x: number; readonly z: number; readonly radius: number },
): boolean {
  return solids.some((solid) => {
    const nearest = nearestPointOnObb(solid, circle.x, circle.z);
    return Math.hypot(nearest.x - circle.x, nearest.z - circle.z) < circle.radius;
  });
}

/**
 * For every building-set block, compares the legacy nominal-footprint
 * historical-buffer survivor predicate (what `planAssetSlotBlock` actually
 * uses by default) against an exact circle-versus-structural-OBB
 * intersection test on the curated manifest solids. Never mutates or
 * informs the plan itself — this is the same comparison
 * `solidOverlapsReservation` makes for a *relaxed* owner's exact
 * reservations, applied here to every owner's historical-buffer circle
 * instead, purely for review.
 */
export function diagnoseKeepOutSurvivorDeltas(
  mapPack: GameCanvasMapPack,
): readonly KeepOutSurvivorDelta[] {
  const reservations = buildingReservations(mapPack);
  const historicalBuffers = reservations.filter(
    (r): r is BuildingReservation & { readonly geometry: { readonly kind: "circle"; readonly x: number; readonly z: number; readonly radius: number } } =>
      r.purpose === "historical-buffer" && r.geometry.kind === "circle",
  );
  const deltas: KeepOutSurvivorDelta[] = [];
  for (const block of mapPack.geometry.blocks) {
    if (!block.buildingSet || !isBuildingSetId(block.buildingSet) || !historicalBuffers.length) continue;
    const rawSlots = slotBlockBuildings(
      block.center,
      block.size,
      block.buildingSet,
      hashStringToSeed(`${block.id}-buildings`),
      1,
      block.streetEdges,
    );
    const rotated = rotateBlockBuildingPlacements(rawSlots, block.center, block.headingDeg);
    const legacySurvivorIds = new Set(
      keptStreetWallBuildings(rotated, reservations).map((b) => `${b.edge}:${b.edgeSlot}`),
    );
    for (const placement of rotated) {
      const legacySurvived = legacySurvivorIds.has(`${placement.edge}:${placement.edgeSlot}`);
      const { solids } = structuralSolidsFor(placement.modelId, placement.x, placement.z, placement.yaw);
      const exactSurvived = !historicalBuffers.some((buffer) => circleIntersectsAnySolid(solids, buffer.geometry));
      if (legacySurvived !== exactSurvived) {
        deltas.push({
          blockId: block.id,
          edge: placement.edge,
          edgeSlot: placement.edgeSlot,
          modelId: placement.modelId,
          legacySurvived,
          exactSurvived,
        });
      }
    }
  }
  return deltas;
}
