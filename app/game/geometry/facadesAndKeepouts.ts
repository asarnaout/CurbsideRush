import { REPAIR_SHOP_LOT_HALF_M } from "../repairShopLayout";
import {
  resolveServicePointLot,
  SERVICE_LOT_HALF_M,
  type AnchoredServicePoint,
} from "../servicePoints";
import { placedServiceShellSolids, placedVenueFootprint, type PlacedObb } from "./placedPropFootprints";
import { resolveVenuePlacement } from "./venuePlacement";
import type { StagedBlocker } from "../cutsceneScript";
import type { StaticObstacle, StaticObstacleTag } from "../types";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import { buildingPlacementConfig, type PlacedBuilding } from "../buildingSets";
import { buildingStructuralBoundsFor } from "../buildingStructuralBounds";
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

// ---------------------------------------------------------------------------
// Semantic building reservations (plan
// `.claude/three-city-visual-gap-elimination-plan.md` Section 8). Replaces
// the old anonymous `{x,z,radius}` circle with an identified, purpose-coded
// model: every reservation names its owner and why the ground is reserved,
// so a future closure change can tell "generous historical clearance" from
// "an actual wall stands here."
//
// Local geometry types rather than importing `geometry/visualSceneFootprints.ts`'s
// `Shape2d` on purpose: this file sits on the production building-planner
// critical path (`buildingLayout.ts` -> `simulationAdapter.ts`/
// `babylonGameSession.ts`), and that module pulls in the `polygon-clipping`
// package for its Boolean-op wrapper — a dependency the visual-gap audit (an
// offline/dev-only consumer) can afford but the shipped client bundle should
// not pay for. The two type sets are structurally compatible (same field
// names) by design, so a caller that already has a `Shape2d` can pass it
// through unchanged.
// ---------------------------------------------------------------------------

export interface ReservationCircle {
  readonly kind: "circle";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}
export interface ReservationObb {
  readonly kind: "obb";
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}
/** A simple (non-self-intersecting, no holes) polygon — sufficient for every
 * reservation shape this phase authors; a concave/multi-piece access shape
 * can use `ReservationMultiPolygon`. */
export interface ReservationPolygon {
  readonly kind: "polygon";
  readonly points: readonly GameCanvasPoint[];
}
export interface ReservationMultiPolygon {
  readonly kind: "multiPolygon";
  readonly parts: readonly (readonly GameCanvasPoint[])[];
}
export type ReservationGeometry =
  | ReservationCircle
  | ReservationObb
  | ReservationPolygon
  | ReservationMultiPolygon;

export type ReservationOwnerKind = "venue" | "gas-station" | "repair-shop";
export type ReservationPurpose =
  | "historical-buffer"
  | "solid-clearance"
  | "vehicle-access"
  | "pedestrian-access"
  | "designed-open";

export interface BuildingReservation {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerKind: ReservationOwnerKind;
  readonly purpose: ReservationPurpose;
  /** The exact protected region *before* `clearanceM` — callers apply the
   * clearance exactly once (Section 8.2: "callers may not pre-inflate and
   * then pass the same clearance again"). */
  readonly geometry: ReservationGeometry;
  readonly clearanceM: number;
}

/** A named owner relaxed from its historical buffer to its exact
 * reservations, and the specific restored candidate plan ids reviewed and
 * approved for that owner (Section 8.2: "A restored ID enters the allow-list
 * only after satisfying Rule 2"). */
export interface OwnerRelaxation {
  readonly ownerId: string;
  readonly allowedRestoredPlanIds: ReadonlySet<string>;
}
export interface RelaxationPolicy {
  readonly relaxations: readonly OwnerRelaxation[];
}
/** Every owner stays on its historical-buffer circle — byte-identical
 * planner output (Section 8.8). */
export const DEFAULT_RELAXATION_POLICY: RelaxationPolicy = Object.freeze({ relaxations: [] });

const SOLID_CLEARANCE_M = 0.75;

/** Closest point on an OBB's boundary/interior to `(x, z)`, world space. */
function nearestPointOnObb(
  obb: { readonly x: number; readonly z: number; readonly ux: number; readonly uz: number; readonly halfU: number; readonly halfV: number },
  x: number,
  z: number,
): GameCanvasPoint {
  const dx = x - obb.x;
  const dz = z - obb.z;
  const u = Math.max(-obb.halfU, Math.min(obb.halfU, dx * obb.ux + dz * obb.uz));
  const v = Math.max(-obb.halfV, Math.min(obb.halfV, dx * obb.uz - dz * obb.ux));
  return { x: obb.x + obb.ux * u + obb.uz * v, z: obb.z + obb.uz * u - obb.ux * v };
}

function obbCorners(obb: ReservationObb): readonly GameCanvasPoint[] {
  const vx = obb.uz;
  const vz = -obb.ux;
  return [
    { x: obb.x + obb.ux * obb.halfU + vx * obb.halfV, z: obb.z + obb.uz * obb.halfU + vz * obb.halfV },
    { x: obb.x - obb.ux * obb.halfU + vx * obb.halfV, z: obb.z - obb.uz * obb.halfU + vz * obb.halfV },
    { x: obb.x - obb.ux * obb.halfU - vx * obb.halfV, z: obb.z - obb.uz * obb.halfU - vz * obb.halfV },
    { x: obb.x + obb.ux * obb.halfU - vx * obb.halfV, z: obb.z + obb.uz * obb.halfU - vz * obb.halfV },
  ];
}

/** Exact SAT overlap of two axis-independent OBBs. */
function obbOverlapsObb(a: ReservationObb, b: ReservationObb): boolean {
  const axes: readonly [number, number][] = [
    [a.ux, a.uz],
    [a.uz, -a.ux],
    [b.ux, b.uz],
    [b.uz, -b.ux],
  ];
  const cornersA = obbCorners(a);
  const cornersB = obbCorners(b);
  for (const [ax, az] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const c of cornersA) {
      const p = c.x * ax + c.z * az;
      if (p < minA) minA = p;
      if (p > maxA) maxA = p;
    }
    let minB = Infinity;
    let maxB = -Infinity;
    for (const c of cornersB) {
      const p = c.x * ax + c.z * az;
      if (p < minB) minB = p;
      if (p > maxB) maxB = p;
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

function pointInSimplePolygon(x: number, z: number, points: readonly GameCanvasPoint[]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    if (zi > z !== zj > z) {
      const xCross = xj + ((z - zj) / (zi - zj)) * (xi - xj);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether an exact candidate solid (an OBB, already at its world position)
 * overlaps a reservation's geometry after `clearanceM`. Circle/OBB are
 * exact SAT-style tests; polygon/multiPolygon use a corner-containment
 * approximation (any solid corner inside the polygon, or any polygon vertex
 * inside the solid) rather than full edge-vs-edge SAT — acceptable today
 * because no builder in this file yet emits a polygon/multiPolygon
 * reservation (Section 8.4's `entranceLocal`-based pedestrian-access
 * corridor and Section 8.5's pump-maneuver polygon are both explicitly
 * deferred, see `exactVenueReservations`/`exactGasStationReservations`'s own
 * doc comments); tighten this to true SAT before either lands.
 */
export function solidOverlapsReservation(
  solid: ReservationObb,
  reservation: Pick<BuildingReservation, "geometry" | "clearanceM">,
): boolean {
  const { geometry, clearanceM } = reservation;
  switch (geometry.kind) {
    case "circle": {
      const nearest = nearestPointOnObb(solid, geometry.x, geometry.z);
      return Math.hypot(nearest.x - geometry.x, nearest.z - geometry.z) < geometry.radius + clearanceM;
    }
    case "obb": {
      const inflated: ReservationObb = { ...geometry, halfU: geometry.halfU + clearanceM, halfV: geometry.halfV + clearanceM };
      return obbOverlapsObb(solid, inflated);
    }
    case "polygon": {
      if (geometry.points.some((p) => pointInSimplePolygon(p.x, p.z, obbCorners(solid)))) return true;
      if (obbCorners(solid).some((c) => pointInSimplePolygon(c.x, c.z, geometry.points))) return true;
      if (clearanceM <= 0) return false;
      return geometry.points.some((p) => {
        const nearest = nearestPointOnObb(solid, p.x, p.z);
        return Math.hypot(nearest.x - p.x, nearest.z - p.z) < clearanceM;
      });
    }
    case "multiPolygon":
      return geometry.parts.some((part) => solidOverlapsReservation(solid, { geometry: { kind: "polygon", points: part }, clearanceM }));
  }
}

function historicalBufferReservation(
  ownerId: string,
  ownerKind: ReservationOwnerKind,
  x: number,
  z: number,
  radius: number,
): BuildingReservation {
  return {
    id: `${ownerId}-historical-buffer`,
    ownerId,
    ownerKind,
    purpose: "historical-buffer",
    geometry: { kind: "circle", x, z, radius },
    clearanceM: 0,
  };
}

function placedObbToReservationObb(obb: PlacedObb): ReservationObb {
  return { kind: "obb", x: obb.x, z: obb.z, ux: obb.ux, uz: obb.uz, halfU: obb.halfU, halfV: obb.halfV };
}

/**
 * A venue's exact reservations once its owner is relaxed (Section 8.4):
 * the opaque building volume itself (`solid-clearance`, the measured model
 * footprint plus 0.75 m). Pedestrian-access (needs a per-model
 * `entranceLocal` measurement `propFootprints.ts` does not have yet) and an
 * optional authored forecourt (`designed-open`) are deliberately not
 * produced here — no city-content phase has needed either yet; add them
 * next to a real `entranceLocal` manifest when one does; until then a
 * relaxed venue owner protects only its real solid mass, not its access
 * route, so a relaxation must be reviewed against the live scene, not
 * trusted blind.
 */
function exactVenueReservations(
  mapPack: GameCanvasMapPack,
  venue: NonNullable<GameCanvasMapPack["geometry"]["gigVenues"]>[number],
): readonly BuildingReservation[] {
  const footprint = placedVenueFootprint(mapPack, venue);
  if (!footprint || !footprint.resolved) return [];
  return footprint.solids.map((solid) => ({
    id: `${venue.id}-solid-${solid.localId}`,
    ownerId: venue.id,
    ownerKind: "venue" as const,
    purpose: "solid-clearance" as const,
    geometry: placedObbToReservationObb(solid.obb),
    clearanceM: SOLID_CLEARANCE_M,
  }));
}

/**
 * A service point's exact reservations once its owner is relaxed (Section
 * 8.5/8.6): the shop/pump-island or shell solids (`solid-clearance`, 0.75 m)
 * plus the full lot as a `designed-open` protection (its footprint is
 * already exact — `GAS_STATION_SLAB_HALF_M`/`repairShopPlanBounds()` — so it
 * needs no extra clearance). Ingress/egress/pump-maneuver and
 * road-to-bay-mouth access polygons (Section 8.5/8.6's `vehicle-access`)
 * are deliberately not produced here — deferred until a specific city-fix
 * needs to relax a service owner, matching venues above.
 */
function exactServiceReservations(
  lanes: Parameters<typeof placedServiceShellSolids>[0],
  service: AnchoredServicePoint & { readonly id: string },
  lot: { readonly x: number; readonly z: number; readonly yaw: number },
  ownerKind: ReservationOwnerKind,
): readonly BuildingReservation[] {
  const solids = placedServiceShellSolids(lanes, service);
  const reservations: BuildingReservation[] = (solids ?? []).map((solid) => ({
    id: `${service.id}-solid-${solid.localId}`,
    ownerId: service.id,
    ownerKind,
    purpose: "solid-clearance" as const,
    geometry: placedObbToReservationObb(solid.obb),
    clearanceM: SOLID_CLEARANCE_M,
  }));
  const lotHalf = SERVICE_LOT_HALF_M[service.kind];
  reservations.push({
    id: `${service.id}-lot`,
    ownerId: service.id,
    ownerKind,
    purpose: "designed-open",
    geometry: { kind: "obb", x: lot.x, z: lot.z, ux: Math.cos(lot.yaw), uz: -Math.sin(lot.yaw), halfU: lotHalf, halfV: lotHalf },
    clearanceM: 0,
  });
  return reservations;
}

/**
 * The single pure API for every reservation the building planner must clear
 * (Section 8.2). The default policy (`DEFAULT_RELAXATION_POLICY`) emits
 * exactly one historical-buffer circle per service/venue — byte-identical
 * to the old `buildingKeepOuts()` — for every owner. A relaxed owner
 * additionally gets its exact reservations appended; its historical buffer
 * stays present too (the filtering predicate below needs both: the buffer
 * to know a candidate would otherwise be excluded, the exact shapes to know
 * whether relaxation actually clears it).
 */
export function buildingReservations(
  mapPack: GameCanvasMapPack,
  relaxationPolicy: RelaxationPolicy = DEFAULT_RELAXATION_POLICY,
): readonly BuildingReservation[] {
  const relaxedOwnerIds = new Set(relaxationPolicy.relaxations.map((r) => r.ownerId));
  const reservations: BuildingReservation[] = [];
  for (const service of mapPack.geometry.servicePoints ?? []) {
    const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
    if (!lot) continue;
    const ownerKind: ReservationOwnerKind = service.kind === "repair_shop" ? "repair-shop" : "gas-station";
    reservations.push(
      historicalBufferReservation(
        service.id,
        ownerKind,
        lot.x,
        lot.z,
        service.kind === "repair_shop" ? REPAIR_SHOP_LOT_HALF_M + 3 : Math.max(service.footprint.x, service.footprint.z) + 16,
      ),
    );
    if (relaxedOwnerIds.has(service.id)) {
      reservations.push(...exactServiceReservations(mapPack.laneGraph.lanes, service, lot, ownerKind));
    }
  }
  for (const venue of mapPack.geometry.gigVenues ?? []) {
    const placement = resolveVenuePlacement(mapPack, venue);
    if (!placement) continue;
    reservations.push(
      historicalBufferReservation(venue.id, "venue", placement.x, placement.z, Math.max(venue.footprint.x, venue.footprint.z) / 2 + 12),
    );
    if (relaxedOwnerIds.has(venue.id)) {
      reservations.push(...exactVenueReservations(mapPack, venue));
    }
  }
  return reservations;
}

/**
 * Whether a candidate footprint (nominal centre + half-extents, matching
 * the legacy `isInsideKeepOut` predicate exactly) falls inside any
 * historical-buffer reservation. This is the byte-identical default path —
 * relaxed owners are handled separately by `keptStreetWallBuildings`, which
 * alone has the exact candidate solid + plan id a relaxation review needs.
 */
export function isInsideHistoricalBuffer(
  reservations: readonly BuildingReservation[],
  x: number,
  z: number,
  halfWidth = 0,
  halfDepth = 0,
): boolean {
  return reservations.some((r) => {
    if (r.purpose !== "historical-buffer" || r.geometry.kind !== "circle") return false;
    const nearestX = Math.max(x - halfWidth, Math.min(r.geometry.x, x + halfWidth));
    const nearestZ = Math.max(z - halfDepth, Math.min(r.geometry.z, z + halfDepth));
    return Math.hypot(nearestX - r.geometry.x, nearestZ - r.geometry.z) < r.geometry.radius;
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
 * The instanced street-wall buildings that survive `reservations`.
 *
 * The renderer's filter and the test's assertion have to be the same decision,
 * or the test only proves that a predicate exists — which is exactly what the
 * first version of it proved, while the renderer went on passing centres and
 * meshing a brownstone into Broadway Auto.
 *
 * Default (unrelaxed) behaviour is byte-identical to the old
 * `keptStreetWallBuildings`/`buildingKeepOuts` pair: a candidate that clears
 * every historical-buffer circle survives, full stop, via the exact same
 * nominal-footprint distance test. A candidate that fails one only survives
 * if *every* buffer it fails is individually excused — its owner relaxed,
 * its exact world solid (from the curated structural manifest, not the
 * nominal footprint) clearing that owner's exact reservations, and its own
 * plan id present in that owner's reviewed `allowedRestoredPlanIds`
 * (Section 8.2's explicit allow-list gate — an automatic geometric pass is
 * necessary but not sufficient to ship a restored building).
 */
export function keptStreetWallBuildings<
  T extends { readonly modelId: string; readonly x: number; readonly z: number; readonly yaw: number },
>(
  placements: readonly T[],
  reservations: readonly BuildingReservation[],
  relaxationPolicy: RelaxationPolicy = DEFAULT_RELAXATION_POLICY,
  planIdOf?: (placement: T) => string,
): readonly T[] {
  const failingHistoricalBuffersFor = (b: T): readonly BuildingReservation[] => {
    const half = (buildingPlacementConfig(b.modelId)?.footprintM ?? 0) / 2;
    return reservations.filter((r) => {
      if (r.purpose !== "historical-buffer" || r.geometry.kind !== "circle") return false;
      const nearestX = Math.max(b.x - half, Math.min(r.geometry.x, b.x + half));
      const nearestZ = Math.max(b.z - half, Math.min(r.geometry.z, b.z + half));
      return Math.hypot(nearestX - r.geometry.x, nearestZ - r.geometry.z) < r.geometry.radius;
    });
  };
  const exactByOwner = new Map<string, BuildingReservation[]>();
  for (const r of reservations) {
    if (r.purpose === "historical-buffer") continue;
    const list = exactByOwner.get(r.ownerId);
    if (list) list.push(r);
    else exactByOwner.set(r.ownerId, [r]);
  }
  const allowListByOwner = new Map(relaxationPolicy.relaxations.map((r) => [r.ownerId, r.allowedRestoredPlanIds] as const));

  return placements.filter((b) => {
    const failing = failingHistoricalBuffersFor(b);
    if (failing.length === 0) return true;
    const bounds = buildingStructuralBoundsFor(b.modelId);
    const planId = planIdOf?.(b);
    return failing.every((buffer) => {
      const exact = exactByOwner.get(buffer.ownerId);
      const allowList = allowListByOwner.get(buffer.ownerId);
      if (!exact || !allowList || planId === undefined || !allowList.has(planId)) return false;
      if (!bounds) return false;
      const cos = Math.cos(b.yaw);
      const sin = Math.sin(b.yaw);
      return bounds.solids.every((localSolid) => {
        const localCenterX = (localSolid.minX + localSolid.maxX) / 2;
        const localCenterZ = (localSolid.minZ + localSolid.maxZ) / 2;
        const worldSolid: ReservationObb = {
          kind: "obb",
          x: b.x + localCenterX * cos + localCenterZ * sin,
          z: b.z - localCenterX * sin + localCenterZ * cos,
          ux: cos,
          uz: -sin,
          halfU: (localSolid.maxX - localSolid.minX) / 2,
          halfV: (localSolid.maxZ - localSolid.minZ) / 2,
        };
        return !exact.some((r) => solidOverlapsReservation(worldSolid, r));
      });
    });
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
