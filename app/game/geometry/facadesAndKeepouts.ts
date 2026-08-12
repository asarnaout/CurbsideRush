import { REPAIR_SHOP_LOT_HALF_M } from "../repairShopLayout";
import { resolveServicePointLot } from "../servicePoints";
import { resolveVenuePlacement } from "./venuePlacement";
import type { StagedBlocker } from "../cutsceneScript";
import type { StaticObstacle, StaticObstacleTag } from "../types";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import { buildingPlacementConfig, type PlacedBuilding } from "../buildingSets";
import { hashStringToSeed } from "../visuals";

/**
 * Building keep-outs, street-wall facade placement, and the deterministic
 * facade window-lighting layout every procedural building texture samples.
 *
 * Pure by design — no Babylon, no DOM — so this geometry can be pinned in
 * plain node tests without instantiating a scene. `tests/architecture.test.ts`
 * enforces that this stays true for every file under `geometry/`.
 * `FACADE_COLS`/`FACADE_ROWS` and `FACADE_LAYOUT` are also read by the
 * (Babylon-touching) facade texture factories, which import them back from
 * here rather than duplicating the seed.
 */

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** A circle the street wall must not build inside. */
export interface BuildingKeepOut {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Whether a street-wall building would stand in someone's lot.
 *
 * Takes the building's own half-extents rather than just its centre. The
 * instanced glb wall can get away with a centre test because its buildings are
 * slotted along a block edge at roughly the keep-out's own scale; the
 * procedural facade grid divides a whole block into as few as nine boxes, and
 * on NYC one of those is 48 m across — far enough that its centre clears a
 * forecourt by 30 m while its wall still covers it.
 */
export function isInsideKeepOut(
  keepOuts: readonly BuildingKeepOut[],
  x: number,
  z: number,
  halfWidth = 0,
  halfDepth = 0,
): boolean {
  return keepOuts.some((ex) => {
    // Nearest point of the building's footprint to the keep-out's centre.
    const nearestX = Math.max(x - halfWidth, Math.min(ex.x, x + halfWidth));
    const nearestZ = Math.max(z - halfDepth, Math.min(ex.z, z + halfDepth));
    return Math.hypot(nearestX - ex.x, nearestZ - ex.z) < ex.radius;
  });
}

/**
 * Where the procedural facade grid puts a building on a block.
 *
 * The cell centres are fully determined by the block; only each box's size and
 * height are jittered by the scene's PRNG. Split out so the placement can be
 * checked against the service and venue keep-outs without standing up a scene —
 * a facade box inside a lot is invisible in code and unmistakable in play.
 */
export function facadeGridCells(block: {
  readonly center: { readonly x: number; readonly z: number };
  readonly size: { readonly x: number; readonly z: number };
  readonly density: number;
  readonly headingDeg?: number;
}): readonly {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly cellWidth: number;
  readonly cellDepth: number;
  readonly rotationY: number;
}[] {
  const count = Math.max(1, Math.round(3 + block.density * 7));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = block.size.x / columns;
  const cellDepth = block.size.z / rows;
  const rotationY = degreesToRadians(block.headingDeg ?? 0);
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const localX = -block.size.x / 2 + cellWidth * (column + 0.5);
    const localZ = -block.size.z / 2 + cellDepth * (row + 0.5);
    cells.push({
      index,
      x: block.center.x + localX * cos + localZ * sin,
      z: block.center.z - localX * sin + localZ * cos,
      cellWidth,
      cellDepth,
      rotationY,
    });
  }
  return cells;
}

/** Stable low-spec culling: the same seed always keeps the same scenery. */
export function deterministicSceneryKeep(
  key: string,
  fraction: number,
): boolean {
  if (fraction >= 1) return true;
  if (fraction <= 0) return false;
  return hashStringToSeed(key) / 0xffff_ffff < fraction;
}

/**
 * Pulls Cairo's procedural filler toward the nearest block edge so avenues get
 * a continuous, dense frontage instead of a vacant apron around a centre grid.
 * The returned footprint stays inset inside the authored rotated block.
 */
export interface CairoFrontagePlacement extends GameCanvasPoint {
  readonly edgeAxis: "x" | "z";
  readonly outwardSign: -1 | 1;
  /** Local yaw whose +z axis points out through the street-facing wall. */
  readonly detailYawRad: number;
  readonly localX: number;
  readonly localZ: number;
}

export function cairoFrontagePosition(
  block: {
    readonly center: GameCanvasPoint;
    readonly size: GameCanvasPoint;
    readonly headingDeg?: number;
    readonly frontageAxis?: "x" | "z";
  },
  cell: { readonly index: number; readonly x: number; readonly z: number },
  buildingWidthM: number,
  buildingDepthM: number,
): CairoFrontagePlacement {
  const heading = degreesToRadians(block.headingDeg ?? 0);
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dx = cell.x - block.center.x;
  const dz = cell.z - block.center.z;
  let localX = dx * cos - dz * sin;
  let localZ = dx * sin + dz * cos;
  const halfX = block.size.x / 2;
  const halfZ = block.size.z / 2;
  const xScore = Math.abs(localX) / Math.max(1, halfX);
  const zScore = Math.abs(localZ) / Math.max(1, halfZ);
  const chooseX =
    block.frontageAxis !== undefined
      ? block.frontageAxis === "x"
      : Math.abs(xScore - zScore) > 0.04
        ? xScore > zScore
        : cell.index % 2 === 0;
  let outwardSign: -1 | 1;
  if (chooseX) {
    const side =
      localX === 0 ? (cell.index % 4 < 2 ? -1 : 1) : Math.sign(localX);
    outwardSign = side < 0 ? -1 : 1;
    localX =
      outwardSign * Math.max(0, halfX - buildingWidthM / 2 - 1.15);
  } else {
    const side =
      localZ === 0 ? (cell.index % 4 < 2 ? 1 : -1) : Math.sign(localZ);
    outwardSign = side < 0 ? -1 : 1;
    localZ =
      outwardSign * Math.max(0, halfZ - buildingDepthM / 2 - 1.15);
  }
  return {
    x: block.center.x + localX * cos + localZ * sin,
    z: block.center.z - localX * sin + localZ * cos,
    edgeAxis: chooseX ? "x" : "z",
    outwardSign,
    detailYawRad: chooseX
      ? outwardSign * Math.PI / 2
      : outwardSign > 0
        ? 0
        : Math.PI,
    localX,
    localZ,
  };
}

export interface CairoFrontageFootprint {
  readonly placement: CairoFrontagePlacement;
  readonly widthM: number;
  readonly depthM: number;
}

/** All Cairo filler in one block shares its yaw, so local AABB overlap is O(1). */
export function cairoFrontageFootprintsOverlap(
  first: CairoFrontageFootprint,
  second: CairoFrontageFootprint,
  gapM = 0.6,
): boolean {
  return (
    Math.abs(first.placement.localX - second.placement.localX) <
      (first.widthM + second.widthM) / 2 + gapM &&
    Math.abs(first.placement.localZ - second.placement.localZ) <
      (first.depthM + second.depthM) / 2 + gapM
  );
}

/** Rotates axis-authored street-wall slots into a block's local heading. */
export function rotateBlockBuildingPlacements(
  placements: readonly PlacedBuilding[],
  center: GameCanvasPoint,
  headingDeg = 0,
): readonly PlacedBuilding[] {
  if (Math.abs(headingDeg) < 0.0001) return placements;
  const heading = (headingDeg * Math.PI) / 180;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return placements.map((placement) => {
    const localX = placement.x - center.x;
    const localZ = placement.z - center.z;
    return {
      ...placement,
      x: center.x + localX * cos + localZ * sin,
      z: center.z - localX * sin + localZ * cos,
      yaw: placement.yaw + heading,
    };
  });
}

/**
 * Every circle the street wall must leave clear: each service point's lot and
 * each gig venue's plot.
 *
 * Exported so the placement can be checked against it without a scene. The two
 * street-wall paths consume this at very different times — the instanced glb
 * wall after preload, the procedural facade grid inline — which is exactly how
 * a terrace ended up standing through London's and Tokyo's repair shops: the
 * keep-outs used to be collected as each building was placed, which was in time
 * for one path and far too late for the other.
 */
export function buildingKeepOuts(
  mapPack: GameCanvasMapPack,
): readonly BuildingKeepOut[] {
  const keepOuts: BuildingKeepOut[] = [];
  for (const service of mapPack.geometry.servicePoints ?? []) {
    const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
    if (!lot) continue;
    keepOuts.push({
      x: lot.x,
      z: lot.z,
      // The station's glb lot is bigger than its authored footprint, so it
      // wants a generous clearance. The repair shop is a much smaller building,
      // and clearing 16 m round it would punch a hole in the street wall far
      // larger than the shop standing in it.
      radius:
        service.kind === "repair_shop"
          ? REPAIR_SHOP_LOT_HALF_M + 3
          : Math.max(service.footprint.x, service.footprint.z) + 16,
    });
  }
  for (const venue of mapPack.geometry.gigVenues ?? []) {
    const placement = resolveVenuePlacement(mapPack, venue);
    if (!placement) continue;
    keepOuts.push({
      x: placement.x,
      z: placement.z,
      radius: Math.max(venue.footprint.x, venue.footprint.z) / 2 + 12,
    });
  }
  return keepOuts;
}

/**
 * The instanced street-wall buildings that survive the keep-outs.
 *
 * The renderer's filter and the test's assertion have to be the same decision,
 * or the test only proves that a predicate exists — which is exactly what the
 * first version of it proved, while the renderer went on passing centres and
 * meshing a brownstone into Broadway Auto.
 */
export function keptStreetWallBuildings<
  T extends { readonly modelId: string; readonly x: number; readonly z: number },
>(placements: readonly T[], keepOuts: readonly BuildingKeepOut[]): readonly T[] {
  return placements.filter((b) => {
    // Measured against the building's own footprint, not just its centre. A
    // brownstone is ~11 m across, so one centred a comfortable 8 m outside a
    // repair shop's keep-out still has its flank 2.5 m inside the shop.
    const half = (buildingPlacementConfig(b.modelId)?.footprintM ?? 0) / 2;
    return !isInsideKeepOut(keepOuts, b.x, b.z, half, half);
  });
}

/**
 * The world's solids restated as things a staged camera must not look through.
 *
 * Two filters, both to keep the ranking honest rather than to save work. Only
 * `building`, `venue` and `landmark` count — a shoreline, a park's kerb or the
 * world edge stops a car and blocks nothing you can see over. And only boxes
 * and convex polygons: `circle` obstacles are a park's masonry, a monument
 * plinth or a stone lantern, none of which is tall enough to hide a scene,
 * and treating them as blockers would push the camera off good angles for
 * knee-high stone.
 *
 * What is left is the geometry that actually ruins a shot — buildings, venue
 * lots, the station boxes that carry the pump islands and canopy pillars,
 * and a bespoke landmark's own exact ground footprint
 * (`geometry/landmarkGroundSolids.ts`) where one exists.
 */
const STAGED_BLOCKER_TAGS: ReadonlySet<StaticObstacleTag> = new Set([
  "building",
  "landmark",
  "venue",
]);
export function stagedBlockersOf(
  obstacles: readonly StaticObstacle[],
): readonly StagedBlocker[] {
  const blockers: StagedBlocker[] = [];
  for (const obstacle of obstacles) {
    if (!STAGED_BLOCKER_TAGS.has(obstacle.tag)) continue;
    if (obstacle.kind === "obb") {
      blockers.push(obstacle);
    } else if (obstacle.kind === "aabb") {
      blockers.push({
        x: (obstacle.minX + obstacle.maxX) / 2,
        z: (obstacle.minZ + obstacle.maxZ) / 2,
        ux: 1,
        uz: 0,
        halfU: (obstacle.maxX - obstacle.minX) / 2,
        halfV: (obstacle.maxZ - obstacle.minZ) / 2,
      });
    } else if (obstacle.kind === "convex") {
      blockers.push({ points: obstacle.points });
    }
  }
  return blockers;
}
export const FACADE_COLS = 4;
export const FACADE_ROWS = 6;
interface FacadeCell {
  readonly row: number;
  readonly col: number;
  readonly lit: boolean;
  readonly shade: number;
}

export function buildFacadeLayout(seed: number): readonly FacadeCell[] {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const cells: FacadeCell[] = [];
  for (let row = 0; row < FACADE_ROWS; row += 1) {
    for (let col = 0; col < FACADE_COLS; col += 1) {
      cells.push({
        row,
        col,
        lit: rand() < 0.26,
        shade: 40 + Math.floor(rand() * 26),
      });
    }
  }
  return cells;
}

// Fixed so every building's window grid + lit pattern is stable and the diffuse
// and emissive tiles line up.
export const FACADE_LAYOUT = buildFacadeLayout(0x9e3779b1);
