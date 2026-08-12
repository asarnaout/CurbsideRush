/**
 * The spatial index, ground raster/connected-void detector, 3-D sightline
 * kernel, and semantic ray state machine — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Sections 7.3-7.8.
 *
 * Contains no map-specific hard-coded pass list (Section 7.1): every
 * function here operates only on the generic `GroundSurface`/`OccluderVolume`
 * model from `visualSceneFootprints.ts`. Pure, deterministic, Babylon-free,
 * DOM-free, clock-free, like every `geometry/*.ts` file.
 */

import {
  aabbOfShape,
  booleanDifference,
  booleanIntersection,
  booleanUnion,
  distanceFromPointToShape,
  pointInShape,
  PolygonClippingError,
  segmentInsideShapeIntervals,
  type Aabb,
  type Aabb2,
  type GroundSurface,
  type OccluderVolume,
  type ParamInterval,
  type Point2,
  type Polygon,
  type Shape2d,
} from "./visualSceneFootprints";

const EPS = 1e-9;

/** Clockwise rectangle winding, matching `visualSceneFootprints.ts`'s
 * `aabbToPolygon` exactly. */
function rectPointsCW(minX: number, maxX: number, minZ: number, maxZ: number): Point2[] {
  return [
    { x: minX, z: minZ },
    { x: minX, z: maxZ },
    { x: maxX, z: maxZ },
    { x: maxX, z: minZ },
  ];
}

// ---------------------------------------------------------------------------
// Spatial index (Section 7.4)
// ---------------------------------------------------------------------------

export const SPATIAL_INDEX_CELL_SIZE_M = 32;

/**
 * A deterministic uniform grid. Every shape is inserted into every cell its
 * AABB overlaps (never only the cell containing its centre — Section 7.4's
 * "long thin shape spanning many buckets" trap). Ray queries return every id
 * whose AABB the query segment's own bounding box overlaps: a safe, exact
 * superset (never a false negative), left for the caller to exact-test and
 * sort by true intersection distance — the raster/ray-cast code below always
 * does this, so "traverse in distance order" is satisfied by the FINAL
 * sorted hit list, not by the candidate-gathering order itself.
 */
export class SpatialIndex {
  private readonly cellSizeM: number;
  private readonly cells = new Map<string, string[]>();
  private readonly boxes = new Map<string, Aabb2>();

  constructor(cellSizeM = SPATIAL_INDEX_CELL_SIZE_M) {
    this.cellSizeM = cellSizeM;
  }

  private cellCoord(x: number, z: number): readonly [number, number] {
    return [Math.floor(x / this.cellSizeM), Math.floor(z / this.cellSizeM)];
  }

  insert(id: string, box: Aabb2): void {
    this.boxes.set(id, box);
    const [cx0, cz0] = this.cellCoord(box.minX, box.minZ);
    const [cx1, cz1] = this.cellCoord(box.maxX, box.maxZ);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const key = `${cx}:${cz}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(id);
        else this.cells.set(key, [id]);
      }
    }
  }

  boxOf(id: string): Aabb2 | undefined {
    return this.boxes.get(id);
  }

  /** Every distinct id whose cell footprint overlaps the query box, sorted
   * for determinism (content-based, never insertion order). */
  queryBox(box: Aabb2): readonly string[] {
    const [cx0, cz0] = this.cellCoord(box.minX, box.minZ);
    const [cx1, cz1] = this.cellCoord(box.maxX, box.maxZ);
    const seen = new Set<string>();
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const bucket = this.cells.get(`${cx}:${cz}`);
        if (!bucket) continue;
        for (const id of bucket) seen.add(id);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }

  /** Candidate ids for a query segment: every id whose AABB overlaps the
   * segment's own bounding box (padded by nothing — exact-testing happens
   * downstream). */
  candidatesAlongSegment(ax: number, az: number, bx: number, bz: number): readonly string[] {
    return this.queryBox({
      minX: Math.min(ax, bx),
      maxX: Math.max(ax, bx),
      minZ: Math.min(az, bz),
      maxZ: Math.max(az, bz),
    });
  }
}

export function buildOccluderIndex(occluders: readonly OccluderVolume[]): SpatialIndex {
  const index = new SpatialIndex();
  for (const occluder of occluders) index.insert(occluder.id, aabbOfShape(occluder.geometry));
  return index;
}

export function buildGroundSurfaceIndex(surfaces: readonly GroundSurface[]): SpatialIndex {
  const index = new SpatialIndex();
  for (const surface of surfaces) index.insert(surface.id, aabbOfShape(surface.geometry));
  return index;
}

// ---------------------------------------------------------------------------
// Ground classification at a point (Section 7.2: "ground and occlusion are
// deliberately separate")
// ---------------------------------------------------------------------------

/** The highest top-facing `GroundSurface` at `(x, z)`, by `surfaceY` then
 * `layerPriority` — a bridge deck over water, or a junction fill over the
 * shoulder it caps. `null` when nothing claims the point (should not happen
 * once `world-ground` is always present as the base layer). */
export function selectVisibleGroundSurface(
  surfaces: readonly GroundSurface[],
  x: number,
  z: number,
  index?: SpatialIndex,
): GroundSurface | null {
  const byId = new Map(surfaces.map((s) => [s.id, s] as const));
  const candidateIds = index ? index.queryBox({ minX: x, maxX: x, minZ: z, maxZ: z }) : [...byId.keys()];
  let best: GroundSurface | null = null;
  for (const id of candidateIds) {
    const surface = byId.get(id);
    if (!surface || !pointInShape(surface.geometry, x, z)) continue;
    if (
      !best ||
      surface.surfaceY > best.surfaceY ||
      (surface.surfaceY === best.surfaceY && surface.layerPriority > best.layerPriority)
    ) {
      best = surface;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ground raster and connected voids (Section 7.5)
// ---------------------------------------------------------------------------

export const GROUND_RASTER_CELL_SIZE_M = 4;
export const QUALIFYING_BLOB_AREA_M2 = 300;
const MIN_FRAGMENT_AREA_M2 = 1e-6;
const GROUND_CONTACT_EPS_M = 0.02;

export interface RasterFragment {
  readonly id: string;
  readonly blobId: string;
  readonly cellCx: number;
  readonly cellCz: number;
  readonly polygon: Polygon;
  readonly area: number;
  readonly aabb: Aabb2;
}

export interface VoidBlob {
  readonly id: string;
  readonly fragmentIds: readonly string[];
  readonly area: number;
  readonly aabb: Aabb2;
  readonly centroid: Point2;
  readonly qualifying: boolean;
}

export interface GroundRaster {
  readonly cellSizeM: number;
  readonly fragments: readonly RasterFragment[];
  readonly blobs: readonly VoidBlob[];
  readonly fragmentIndex: SpatialIndex;
  /** Cells `polygon-clipping` itself could not resolve even after
   * coordinate snapping (Section 5.5's `unsupported_geometry` class) —
   * conservatively excluded from every fragment/blob rather than guessed
   * at, so they can never wrongly certify a gap closed. Report and
   * investigate each one; a non-empty list here is a real audit gap, not a
   * pass. */
  readonly unsupportedCellIds: readonly string[];
}

function ringCentroidAndArea(points: readonly Point2[]): { x: number; z: number; signedArea: number } {
  let doubleArea = 0;
  let cx = 0;
  let cz = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const cross = p.x * q.z - q.x * p.z;
    doubleArea += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  const signedArea = doubleArea / 2;
  if (Math.abs(signedArea) < 1e-12) {
    const avgX = points.reduce((s, p) => s + p.x, 0) / Math.max(1, n);
    const avgZ = points.reduce((s, p) => s + p.z, 0) / Math.max(1, n);
    return { x: avgX, z: avgZ, signedArea: 0 };
  }
  return { x: cx / (6 * signedArea), z: cz / (6 * signedArea), signedArea };
}

function polygonAreaAndCentroid(polygon: Polygon): { area: number; centroid: Point2 } {
  const outer = ringCentroidAndArea(polygon.outer);
  let areaSum = Math.abs(outer.signedArea);
  let cxSum = outer.x * areaSum;
  let czSum = outer.z * areaSum;
  for (const hole of polygon.holes ?? []) {
    const h = ringCentroidAndArea(hole);
    const hArea = Math.abs(h.signedArea);
    areaSum -= hArea;
    cxSum -= h.x * hArea;
    czSum -= h.z * hArea;
  }
  if (areaSum <= 1e-9) return { area: 0, centroid: { x: outer.x, z: outer.z } };
  return { area: areaSum, centroid: { x: cxSum / areaSum, z: czSum / areaSum } };
}

function ringAabb(points: readonly Point2[]): Aabb2 {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function mergeSpans(spans: [number, number][], mergeTolM = 1e-6): [number, number][] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const [s, e] = sorted[i];
    if (s <= last[1] + mergeTolM) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** Maximal z-intervals where `polygon`'s boundary (outer or any hole) runs
 * exactly along the vertical line `x = x0` — how two raster fragments in
 * horizontally-adjacent cells prove they share a positive-length edge rather
 * than merely a corner. */
function edgeSpansOnVerticalLine(polygon: Polygon, x0: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const ring of [polygon.outer, ...(polygon.holes ?? [])]) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      if (Math.abs(p.x - x0) < 1e-6 && Math.abs(q.x - x0) < 1e-6) {
        spans.push([Math.min(p.z, q.z), Math.max(p.z, q.z)]);
      }
    }
  }
  return mergeSpans(spans);
}

function edgeSpansOnHorizontalLine(polygon: Polygon, z0: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const ring of [polygon.outer, ...(polygon.holes ?? [])]) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      if (Math.abs(p.z - z0) < 1e-6 && Math.abs(q.z - z0) < 1e-6) {
        spans.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
      }
    }
  }
  return mergeSpans(spans);
}

function spansShareLength(a: readonly [number, number][], b: readonly [number, number][], minLenM = 1e-6): boolean {
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      if (Math.min(a1, b1) - Math.max(a0, b0) > minLenM) return true;
    }
  }
  return false;
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  constructor(ids: readonly string[]) {
    for (const id of ids) this.parent.set(id, id);
  }
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cur = id;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Builds the 4 m ground raster and its flood-filled connected void blobs
 * (Section 7.5). `groundSurfaces` must include exactly the map's
 * `"world-ground"` surface(s) — everything else (road/sidewalk/junction/
 * park/water/promenade/functional-open) is treated as "covered." Only
 * ground-contact occluders (`minY <= world-ground surfaceY + 2cm`) are
 * subtracted; an elevated canopy stays in the 3-D occlusion index without
 * erasing the grey ground beneath it.
 */
export function buildGroundRaster(
  groundSurfaces: readonly GroundSurface[],
  occluders: readonly OccluderVolume[],
  cellSizeM = GROUND_RASTER_CELL_SIZE_M,
): GroundRaster {
  const worldGroundSurfaces = groundSurfaces.filter((s) => s.kind === "world-ground");
  const worldGroundSurfaceY = worldGroundSurfaces.length
    ? Math.min(...worldGroundSurfaces.map((s) => s.surfaceY))
    : 0;
  const worldGroundShapes: Shape2d[] = worldGroundSurfaces.map((s) => s.geometry);
  if (worldGroundShapes.length === 0) {
    return {
      cellSizeM,
      fragments: [],
      blobs: [],
      fragmentIndex: new SpatialIndex(cellSizeM),
      unsupportedCellIds: [],
    };
  }
  const worldGround: Shape2d =
    worldGroundShapes.length === 1 ? worldGroundShapes[0] : booleanUnion(...worldGroundShapes);

  const coveringSurfaceShapes: Shape2d[] = groundSurfaces
    .filter((s) => s.kind !== "world-ground")
    .map((s) => s.geometry);
  const groundContactOccluders = occluders.filter((o) => o.minY <= worldGroundSurfaceY + GROUND_CONTACT_EPS_M);
  const coveringShapes: Shape2d[] = [...coveringSurfaceShapes, ...groundContactOccluders.map((o) => o.geometry)];

  // Real maps carry thousands of covering shapes; a single global
  // `booleanDifference` (or one `booleanIntersection` per 4 m cell against
  // it) re-processes that entire complexity on every call and is far too
  // slow at city scale. Instead: index every covering shape once, then for
  // each cell query only the LOCALLY overlapping shapes (almost always a
  // handful) and difference just those against the cell — an empty query
  // means the whole cell is bare and needs no clipping call at all, which is
  // exactly the fast path a large real void should take.
  const coverIndex = new SpatialIndex(32);
  const coverShapeById = new Map<string, Shape2d>();
  coveringShapes.forEach((shape, index) => {
    const id = `cover-${index}`;
    coverShapeById.set(id, shape);
    coverIndex.insert(id, aabbOfShape(shape));
  });

  const bounds = aabbOfShape(worldGround);
  const cx0 = Math.floor(bounds.minX / cellSizeM);
  const cx1 = Math.floor((bounds.maxX - EPS) / cellSizeM);
  const cz0 = Math.floor(bounds.minZ / cellSizeM);
  const cz1 = Math.floor((bounds.maxZ - EPS) / cellSizeM);

  const fragments: { id: string; cellCx: number; cellCz: number; polygon: Polygon; area: number; aabb: Aabb2 }[] = [];
  const fragmentsByCell = new Map<string, typeof fragments>();

  // World-ground is always the pure rectangle `resolveWorldGroundBounds`
  // produces in every real collector and every test in this file, so a
  // boundary cell can be clipped to it with plain min/max instead of a full
  // polygon Boolean call — the fast path a world-edge row of cells needs.
  // A hypothetical non-rectangular world-ground shape still gets an exact
  // (just slower) clip via `booleanIntersection`-equivalent difference.
  const worldGroundIsRect = worldGround.kind === "aabb";
  const unsupportedCellIds: string[] = [];

  for (let cx = cx0; cx <= cx1; cx += 1) {
    for (let cz = cz0; cz <= cz1; cz += 1) {
      const rawMinX = cx * cellSizeM;
      const rawMaxX = (cx + 1) * cellSizeM;
      const rawMinZ = cz * cellSizeM;
      const rawMaxZ = (cz + 1) * cellSizeM;
      const cellId = `cell-${cx}-${cz}`;

      let cellFragments: typeof fragments = [];
      try {
        if (worldGroundIsRect) {
          const cellMinX = Math.max(rawMinX, bounds.minX);
          const cellMaxX = Math.min(rawMaxX, bounds.maxX);
          const cellMinZ = Math.max(rawMinZ, bounds.minZ);
          const cellMaxZ = Math.min(rawMaxZ, bounds.maxZ);
          if (cellMinX >= cellMaxX || cellMinZ >= cellMaxZ) continue;
          const cell: Aabb = { kind: "aabb", minX: cellMinX, maxX: cellMaxX, minZ: cellMinZ, maxZ: cellMaxZ };
          const localIds = coverIndex.queryBox(cell);
          if (localIds.length === 0) {
            const polygon: Polygon = { kind: "polygon", outer: rectPointsCW(cellMinX, cellMaxX, cellMinZ, cellMaxZ) };
            const { area } = polygonAreaAndCentroid(polygon);
            if (area >= MIN_FRAGMENT_AREA_M2) {
              cellFragments = [
                { id: `${cellId}-frag-0`, cellCx: cx, cellCz: cz, polygon, area, aabb: { minX: cellMinX, maxX: cellMaxX, minZ: cellMinZ, maxZ: cellMaxZ } },
              ];
            }
          } else {
            const localShapes = localIds.map((id) => coverShapeById.get(id)!);
            const clipped = booleanDifference(cell, ...localShapes);
            clipped.parts.forEach((part, index) => {
              const polygon: Polygon = { kind: "polygon", outer: part.outer, holes: part.holes };
              const { area } = polygonAreaAndCentroid(polygon);
              if (area < MIN_FRAGMENT_AREA_M2) return;
              cellFragments.push({ id: `${cellId}-frag-${index}`, cellCx: cx, cellCz: cz, polygon, area, aabb: ringAabb(part.outer) });
            });
          }
        } else {
          // General (non-rectangular) world-ground: clip the raw cell to it
          // first, then subtract local covering shapes from that result.
          const cell: Aabb = { kind: "aabb", minX: rawMinX, maxX: rawMaxX, minZ: rawMinZ, maxZ: rawMaxZ };
          const withinWorld = booleanIntersection(cell, worldGround);
          if (withinWorld.parts.length === 0) continue;
          const localIds = coverIndex.queryBox(cell);
          const localShapes = localIds.map((id) => coverShapeById.get(id)!);
          const clipped = localShapes.length ? booleanDifference(withinWorld, ...localShapes) : withinWorld;
          clipped.parts.forEach((part, index) => {
            const polygon: Polygon = { kind: "polygon", outer: part.outer, holes: part.holes };
            const { area } = polygonAreaAndCentroid(polygon);
            if (area < MIN_FRAGMENT_AREA_M2) return;
            cellFragments.push({ id: `${cellId}-frag-${index}`, cellCx: cx, cellCz: cz, polygon, area, aabb: ringAabb(part.outer) });
          });
        }
      } catch (cause) {
        if (!(cause instanceof PolygonClippingError)) throw cause;
        unsupportedCellIds.push(cellId);
        continue;
      }
      if (cellFragments.length) {
        fragments.push(...cellFragments);
        fragmentsByCell.set(`${cx}:${cz}`, cellFragments);
      }
    }
  }

  const uf = new UnionFind(fragments.map((f) => f.id));
  for (const frag of fragments) {
    const rightKey = `${frag.cellCx + 1}:${frag.cellCz}`;
    const rightNeighbors = fragmentsByCell.get(rightKey) ?? [];
    if (rightNeighbors.length) {
      const sharedX = (frag.cellCx + 1) * cellSizeM;
      const mySpans = edgeSpansOnVerticalLine(frag.polygon, sharedX);
      if (mySpans.length) {
        for (const other of rightNeighbors) {
          if (spansShareLength(mySpans, edgeSpansOnVerticalLine(other.polygon, sharedX))) {
            uf.union(frag.id, other.id);
          }
        }
      }
    }
    const topKey = `${frag.cellCx}:${frag.cellCz + 1}`;
    const topNeighbors = fragmentsByCell.get(topKey) ?? [];
    if (topNeighbors.length) {
      const sharedZ = (frag.cellCz + 1) * cellSizeM;
      const mySpans = edgeSpansOnHorizontalLine(frag.polygon, sharedZ);
      if (mySpans.length) {
        for (const other of topNeighbors) {
          if (spansShareLength(mySpans, edgeSpansOnHorizontalLine(other.polygon, sharedZ))) {
            uf.union(frag.id, other.id);
          }
        }
      }
    }
  }

  const groups = new Map<string, typeof fragments>();
  for (const frag of fragments) {
    const root = uf.find(frag.id);
    const group = groups.get(root);
    if (group) group.push(frag);
    else groups.set(root, [frag]);
  }

  const blobs: VoidBlob[] = [];
  const finalFragments: RasterFragment[] = [];
  const fragmentIndex = new SpatialIndex(cellSizeM);
  const sortedGroups = [...groups.values()].sort((a, b) =>
    a.reduce((m, f) => (f.id < m ? f.id : m), a[0].id).localeCompare(b.reduce((m, f) => (f.id < m ? f.id : m), b[0].id)),
  );
  for (const group of sortedGroups) {
    const sortedGroup = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const blobId = `blob-${sortedGroup[0].id}`;
    let area = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let cxSum = 0;
    let czSum = 0;
    for (const f of sortedGroup) {
      area += f.area;
      minX = Math.min(minX, f.aabb.minX);
      maxX = Math.max(maxX, f.aabb.maxX);
      minZ = Math.min(minZ, f.aabb.minZ);
      maxZ = Math.max(maxZ, f.aabb.maxZ);
      const { centroid, area: fragArea } = polygonAreaAndCentroid(f.polygon);
      cxSum += centroid.x * fragArea;
      czSum += centroid.z * fragArea;
      finalFragments.push({ ...f, blobId });
      fragmentIndex.insert(f.id, f.aabb);
    }
    blobs.push({
      id: blobId,
      fragmentIds: sortedGroup.map((f) => f.id),
      area,
      aabb: { minX, maxX, minZ, maxZ },
      centroid: area > 0 ? { x: cxSum / area, z: czSum / area } : { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
      qualifying: area >= QUALIFYING_BLOB_AREA_M2,
    });
  }

  return { cellSizeM, fragments: finalFragments, blobs, fragmentIndex, unsupportedCellIds };
}

// ---------------------------------------------------------------------------
// 3-D sightline kernel (Section 7.3)
// ---------------------------------------------------------------------------

export interface CameraPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The occluder whose `[minY,maxY]` band contains a production camera origin
 * that is also horizontally inside its footprint — the executable
 * `camera_origin_inside_opaque` failure (Section 7.6: "Production has no
 * chase-camera-through-building clamp"). */
export function eyeInsideOpaqueOccluder(
  occluders: readonly OccluderVolume[],
  eye: CameraPoint3,
): OccluderVolume | null {
  for (const occluder of occluders) {
    if (eye.y < occluder.minY - EPS || eye.y > occluder.maxY + EPS) continue;
    if (pointInShape(occluder.geometry, eye.x, eye.z)) return occluder;
  }
  return null;
}

/** Where along `[eyeY, targetY]` (t in [0,1], linear) the height sits inside
 * `[minY, maxY]` — the vertical half of Section 7.3's
 * `lineY(d) = cameraY + (targetGroundY - cameraY) * (d / D)` check (here `t`
 * IS `d / D`, since horizontal distance from the eye is exactly proportional
 * to the horizontal-plane parameter `segmentInsideShapeIntervals` already
 * uses). `null` when the segment's height never enters the band. */
function verticalBandIntervalT(
  eyeY: number,
  targetY: number,
  minY: number,
  maxY: number,
): ParamInterval | null {
  const dy = targetY - eyeY;
  if (Math.abs(dy) < 1e-9) {
    return eyeY >= minY - EPS && eyeY <= maxY + EPS ? [0, 1] : null;
  }
  let t0 = (minY - eyeY) / dy;
  let t1 = (maxY - eyeY) / dy;
  if (t0 > t1) [t0, t1] = [t1, t0];
  const lo = Math.max(0, t0);
  const hi = Math.min(1, t1);
  return lo <= hi ? [lo, hi] : null;
}

export interface OccluderHit {
  readonly occluderId: string;
  readonly ownerId: string;
  readonly kind: OccluderVolume["kind"];
  /** Parameter (t in [0,1]) along eye->target where the occluder is first
   * entered — both horizontally inside its footprint AND vertically inside
   * its height band at that exact point along the segment. */
  readonly t: number;
}

/**
 * The nearest point (by `t`) along the eye->target 3-D segment where an
 * occluder's footprint AND height band are simultaneously satisfied —
 * "checking line height only at the footprint entry is insufficient for a
 * descending segment that enters an elevated canopy band later" (Section
 * 7.2), which is exactly why this intersects the horizontal and vertical
 * parameter intervals rather than sampling the footprint-entry height alone.
 * Ties (equal `t`) resolve by stable occluder id.
 */
export function nearestOccluderHit(
  occluders: readonly OccluderVolume[],
  eye: CameraPoint3,
  target: CameraPoint3,
  index?: SpatialIndex,
): OccluderHit | null {
  const byId = new Map(occluders.map((o) => [o.id, o] as const));
  const candidateIds = index
    ? index.candidatesAlongSegment(eye.x, eye.z, target.x, target.z)
    : [...byId.keys()];
  let best: OccluderHit | null = null;
  for (const id of candidateIds) {
    const occluder = byId.get(id);
    if (!occluder) continue;
    const horizontal = segmentInsideShapeIntervals(occluder.geometry, eye.x, eye.z, target.x, target.z);
    if (horizontal.length === 0) continue;
    const vertical = verticalBandIntervalT(eye.y, target.y, occluder.minY, occluder.maxY);
    if (!vertical) continue;
    for (const [h0, h1] of horizontal) {
      const lo = Math.max(h0, vertical[0]);
      const hi = Math.min(h1, vertical[1]);
      if (lo > hi) continue;
      if (!best || lo < best.t - 1e-12 || (Math.abs(lo - best.t) <= 1e-12 && occluder.id.localeCompare(best.occluderId) < 0)) {
        best = { occluderId: occluder.id, ownerId: occluder.ownerId, kind: occluder.kind, t: lo };
      }
    }
  }
  return best;
}

export interface GroundCrossing {
  readonly surfaceId: string;
  readonly ownerId: string;
  readonly kind: GroundSurface["kind"];
  readonly t0: number;
  readonly t1: number;
}

/** Every non-`"world-ground"` ground surface's horizontal in intervals along
 * eye->target, sorted by entry `t` then id — the raw material the semantic
 * state machine (below) turns into park/water/functional-open transitions. */
export function groundSurfaceCrossings(
  surfaces: readonly GroundSurface[],
  eye: { readonly x: number; readonly z: number },
  target: { readonly x: number; readonly z: number },
  index?: SpatialIndex,
): readonly GroundCrossing[] {
  const byId = new Map(surfaces.map((s) => [s.id, s] as const));
  const candidateIds = index
    ? index.candidatesAlongSegment(eye.x, eye.z, target.x, target.z)
    : [...byId.keys()];
  const crossings: GroundCrossing[] = [];
  for (const id of candidateIds) {
    const surface = byId.get(id);
    if (!surface || surface.kind === "world-ground") continue;
    const intervals = segmentInsideShapeIntervals(surface.geometry, eye.x, eye.z, target.x, target.z);
    for (const [t0, t1] of intervals) {
      crossings.push({ surfaceId: surface.id, ownerId: surface.ownerId, kind: surface.kind, t0, t1 });
    }
  }
  return crossings.sort((a, b) => a.t0 - b.t0 || a.surfaceId.localeCompare(b.surfaceId));
}

// ---------------------------------------------------------------------------
// Semantic ray state machine (Section 7.7 / 5.5)
// ---------------------------------------------------------------------------

/** The discriminated failure-class union — every sampled ray ends in exactly
 * one of these (Section 5.5). */
export type RayFailureClass =
  | "opaque"
  | "park_continues"
  | "park_backed"
  | "park_to_water"
  | "waterfront"
  | "functional_open_backed"
  | "unresolved_land"
  | "park_to_void"
  | "undressed_water_approach"
  | "urban_world_edge"
  | "non_qualifying"
  | "protected_view_blocked"
  | "camera_origin_inside_opaque"
  | "audit_geometry_missing"
  | "unsupported_geometry";

export const ALL_RAY_FAILURE_CLASSES: readonly RayFailureClass[] = [
  "opaque",
  "park_continues",
  "park_backed",
  "park_to_water",
  "waterfront",
  "functional_open_backed",
  "unresolved_land",
  "park_to_void",
  "undressed_water_approach",
  "urban_world_edge",
  "non_qualifying",
  "protected_view_blocked",
  "camera_origin_inside_opaque",
  "audit_geometry_missing",
  "unsupported_geometry",
];

/** The four classes the final gate requires zero non-exempt instances of
 * (Section 5.5 / 13.2). */
export const CONTENT_GAP_CLASSES: ReadonlySet<RayFailureClass> = new Set([
  "unresolved_land",
  "park_to_void",
  "undressed_water_approach",
  "urban_world_edge",
]);

/** The four audit/regression-error classes: something the geometry pipeline
 * itself could not resolve, never a legitimate scene outcome. */
export const AUDIT_ERROR_CLASSES: ReadonlySet<RayFailureClass> = new Set([
  "protected_view_blocked",
  "camera_origin_inside_opaque",
  "audit_geometry_missing",
  "unsupported_geometry",
]);

/** Ground-surface kinds a ray passes through without ever terminating on —
 * road/sidewalk/junction/bridge-deck are always transparent connective
 * tissue (Section 5.2 groups them with functional-open/park/water as
 * "intentional open surfaces"); only park/water/functional-open actually
 * drive a state transition. */
const TRANSPARENT_GROUND_KINDS: ReadonlySet<GroundSurface["kind"]> = new Set([
  "road",
  "sidewalk",
  "junction",
  "bridge-deck",
  "promenade",
]);

/**
 * Where the audited segment ends, semantically — resolved by the caller
 * (which alone knows whether the far point is a raster blob cell, the world
 * boundary, or a point still over an open surface at the end of the visible
 * range) before calling `classifySightline`.
 */
export type SightlineEndTarget =
  | { readonly kind: "blob"; readonly blobId: string; readonly areaM2: number; readonly qualifying: boolean }
  | { readonly kind: "world-edge" }
  | { readonly kind: "open-surface" }
  | { readonly kind: "non-qualifying" };

export interface ClassifySightlineParams {
  /** Straight-line eye-to-endTarget distance, metres. */
  readonly totalRangeM: number;
  /** Every non-world-ground ground-surface crossing along the segment,
   * `t` in [0, 1] fractions of `totalRangeM` — from `groundSurfaceCrossings`. */
  readonly groundCrossings: readonly GroundCrossing[];
  /** The nearest opaque occluder hit, if any, from `nearestOccluderHit`. */
  readonly opaqueHit: OccluderHit | null;
  readonly endTarget: SightlineEndTarget;
  /** Whether this exact eye/target pair matches a baseline-derived
   * `ProtectedOpenView` corridor (Section 7.7) — resolved by the caller, not
   * inferred here; this function contains no map-specific corridor list. */
  readonly inProtectedCorridor: boolean;
  /** Base-ground seam tolerance before an opaque backdrop/dressed shore,
   * Section 7.7's "Allow at most 1.5 m of numerical/landscape base-ground
   * seam." */
  readonly seamToleranceM?: number;
}

export interface SightlineClassification {
  readonly failureClass: RayFailureClass;
  readonly nearestOpaqueOwnerId: string | null;
  readonly nearestOpaqueDistanceM: number | null;
  /** Every park/water/functional-open owner the ray actually crossed, in
   * encounter order (Section 7.8's "any park/water/functional owner
   * crossed"). */
  readonly crossedOwners: readonly { readonly ownerId: string; readonly kind: GroundSurface["kind"] }[];
}

const DEFAULT_SEAM_TOLERANCE_M = 1.5;

type RayState = "urban" | "park" | "water-approach" | "functional-open";

/**
 * The pure ray state machine (Section 7.7). Consumes already-resolved
 * geometric facts (crossings, the nearest opaque hit, what the far end
 * actually is) rather than raw geometry, so it can be exercised directly by
 * synthetic tests without standing up a map.
 */
export function classifySightline(params: ClassifySightlineParams): SightlineClassification {
  const seamToleranceM = params.seamToleranceM ?? DEFAULT_SEAM_TOLERANCE_M;
  const opaqueDistanceM = params.opaqueHit ? params.opaqueHit.t * params.totalRangeM : null;
  const crossedOwners: { ownerId: string; kind: GroundSurface["kind"] }[] = [];

  let state: RayState = "urban";
  let cursorM = 0;
  let lastExitM = 0;
  let sawParkBeforeWater = false;

  const relevant = params.groundCrossings.filter(
    (c) => opaqueDistanceM === null || c.t0 * params.totalRangeM < opaqueDistanceM - EPS,
  );

  for (const crossing of relevant) {
    const entryM = crossing.t0 * params.totalRangeM;
    const rawExitM = crossing.t1 * params.totalRangeM;
    const exitM = opaqueDistanceM !== null ? Math.min(rawExitM, opaqueDistanceM) : rawExitM;

    if (TRANSPARENT_GROUND_KINDS.has(crossing.kind)) {
      // Connective tissue: always walked over, never itself a state change
      // or a gap. (A promenade/road/sidewalk far from everything else still
      // only ever pulls `lastExitM` forward to its own exit — it cannot
      // retroactively excuse a genuine gap to whatever comes much later,
      // since the eventual opaque/blob check below re-measures the gap
      // against the actual nearer edge.)
      cursorM = Math.max(cursorM, exitM);
      lastExitM = Math.max(lastExitM, exitM);
      continue;
    }

    crossedOwners.push({ ownerId: crossing.ownerId, kind: crossing.kind });

    if (crossing.kind === "park") {
      if (state === "urban" || state === "functional-open") state = "park";
      cursorM = Math.max(cursorM, exitM);
      lastExitM = Math.max(lastExitM, exitM);
      continue;
    }
    if (crossing.kind === "water") {
      // Section 7.7: "More than 1.5 m of unclassified base ground between
      // promenade/park and water: undressed_water_approach." Only a
      // preceding PARK state carries this requirement — a ray that was
      // never in park state (an ordinary/oblique urban water view, Section
      // 7.9 test #10) is not held to any lead-up distance at all.
      if (state === "park") {
        const gapM = entryM - lastExitM;
        if (gapM > seamToleranceM) {
          crossedOwners.push({ ownerId: crossing.ownerId, kind: crossing.kind });
          return {
            failureClass: "undressed_water_approach",
            nearestOpaqueOwnerId: null,
            nearestOpaqueDistanceM: null,
            crossedOwners,
          };
        }
        sawParkBeforeWater = true;
      }
      state = "water-approach";
      cursorM = Math.max(cursorM, exitM);
      lastExitM = Math.max(lastExitM, exitM);
      continue;
    }
    if (crossing.kind === "functional-open") {
      if (state === "urban") state = "functional-open";
      cursorM = Math.max(cursorM, exitM);
      lastExitM = Math.max(lastExitM, exitM);
      continue;
    }
  }

  const finish = (failureClass: RayFailureClass): SightlineClassification => ({
    failureClass,
    nearestOpaqueOwnerId: params.opaqueHit?.ownerId ?? null,
    nearestOpaqueDistanceM: opaqueDistanceM,
    crossedOwners,
  });

  if (opaqueDistanceM !== null) {
    const gapM = opaqueDistanceM - lastExitM;
    if (state === "urban") {
      return finish(params.inProtectedCorridor ? "protected_view_blocked" : "opaque");
    }
    if (state === "park") {
      return finish(gapM <= seamToleranceM ? "park_backed" : "park_to_void");
    }
    if (state === "water-approach") {
      const dressed = gapM <= seamToleranceM;
      return finish(dressed ? (sawParkBeforeWater ? "park_to_water" : "waterfront") : "undressed_water_approach");
    }
    return finish("functional_open_backed");
  }

  switch (params.endTarget.kind) {
    case "world-edge":
      if (state === "urban") return finish("urban_world_edge");
      if (state === "park") return finish("park_to_void");
      if (state === "water-approach") return finish("undressed_water_approach");
      return finish("functional_open_backed");
    case "open-surface":
      if (state === "park") return finish("park_continues");
      if (state === "water-approach") return finish(sawParkBeforeWater ? "park_to_water" : "waterfront");
      return finish("non_qualifying");
    case "non-qualifying":
      return finish("non_qualifying");
    case "blob": {
      // No opaque hit intervened, so this sample lands directly on a raster
      // void-blob cell: the 1.5 m seam tolerance does not apply here (that
      // tolerance is specifically for "an opaque backdrop stands just past
      // the park/shore edge" — Section 7.7). A qualifying blob reached with
      // no backdrop in between is a genuine continuing void regardless of
      // how numerically close the sampled cell happens to sit to the park's
      // own far edge; a sub-threshold blob is `non_qualifying` exactly like
      // the plain urban case below.
      if (state === "park") {
        return finish(params.endTarget.qualifying ? "park_to_void" : "non_qualifying");
      }
      if (state === "water-approach") {
        return finish(params.endTarget.qualifying ? "undressed_water_approach" : "non_qualifying");
      }
      return finish(params.endTarget.qualifying ? "unresolved_land" : "non_qualifying");
    }
  }
}

// ---------------------------------------------------------------------------
// Bare-kerb-run metric (Section 5.4)
// ---------------------------------------------------------------------------

/** Metres outward from the pavement edge an opaque structure must begin
 * within to count as frontage. */
export const KERB_FRONTAGE_REACH_M = 16;
/** A non-exempt bare run longer than this fails; exactly this value passes. */
export const BARE_KERB_RUN_LIMIT_M = 28;
const BARE_KERB_RUN_TOLERANCE_M = 0.01;
/**
 * Coarse-scan resolution along the kerb polyline, refined by bisection at
 * every detected bare/fronted transition (below) down to
 * `KERB_BISECTION_TOLERANCE_M`. Section 5.4 asks for the exact analytic
 * intersection of the road-offset curve with opaque/semantic boundaries (an
 * offset/Minkowski-sum primitive this module does not have); coarse-scan +
 * bisection resolves the pinned 28.000 m / 1 cm convention to well under its
 * tolerance for any realistic frontage geometry, at a fraction of uniform
 * fine sampling's cost, and is the documented precision floor of this
 * metric. A transition narrower than the coarse step (two buildings closer
 * together than `KERB_COARSE_STEP_M` with a sliver of bare kerb between
 * them) can be missed — acceptable here since a sliver that narrow is itself
 * far under the 28 m failure threshold either way.
 */
const KERB_COARSE_STEP_M = 0.25;
const KERB_BISECTION_TOLERANCE_M = 0.001;

export interface KerbExemptRange {
  readonly startM: number;
  readonly endM: number;
  readonly reason: string;
}

export interface BareKerbRun {
  readonly startM: number;
  readonly endM: number;
  readonly lengthM: number;
  /** Longer than 28.000 m by more than the 1 cm tolerance. */
  readonly qualifying: boolean;
}

function samplePolylineByArcLength(polyline: readonly Point2[]): {
  readonly totalLengthM: number;
  readonly at: (sM: number) => Point2;
} {
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const len = Math.hypot(polyline[i + 1].x - polyline[i].x, polyline[i + 1].z - polyline[i].z);
    segLengths.push(len);
    total += len;
  }
  const at = (sM: number): Point2 => {
    let remaining = Math.max(0, Math.min(total, sM));
    for (let i = 0; i < segLengths.length; i += 1) {
      const len = segLengths[i];
      if (remaining <= len + 1e-9 || i === segLengths.length - 1) {
        const t = len > 1e-9 ? Math.min(1, remaining / len) : 0;
        const a = polyline[i];
        const b = polyline[i + 1];
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
      remaining -= len;
    }
    return polyline[polyline.length - 1];
  };
  return { totalLengthM: total, at };
}

function finalizeKerbRun(startM: number, endM: number, runLimitM: number): BareKerbRun {
  const lengthM = endM - startM;
  return { startM, endM, lengthM, qualifying: lengthM > runLimitM + BARE_KERB_RUN_TOLERANCE_M };
}

/**
 * Every contiguous bare-kerb run along one pavement-edge polyline (Section
 * 5.4): a continuous subset where no ground-contact opaque footprint begins
 * within `reachM` of the kerb. `exemptRanges` (junction/crossing-road
 * pavement, bridge portals, service/venue access mouths) breaks a run
 * without itself counting as bare or built — camera-space visibility still
 * audits through those spans via the ordinary sightline classifier above.
 */
export function bareKerbRuns(
  kerbPolyline: readonly Point2[],
  groundContactOccluders: readonly OccluderVolume[],
  exemptRanges: readonly KerbExemptRange[] = [],
  reachM = KERB_FRONTAGE_REACH_M,
  runLimitM = BARE_KERB_RUN_LIMIT_M,
): readonly BareKerbRun[] {
  if (kerbPolyline.length < 2) return [];
  const { totalLengthM, at } = samplePolylineByArcLength(kerbPolyline);
  if (totalLengthM < 1e-9) return [];

  const byId = new Map(groundContactOccluders.map((o) => [o.id, o] as const));
  const index = buildOccluderIndex(groundContactOccluders);
  const isExempt = (sM: number) => exemptRanges.some((r) => sM >= r.startM - 1e-9 && sM <= r.endM + 1e-9);
  const isFronted = (point: Point2) =>
    index
      .queryBox({ minX: point.x - reachM, maxX: point.x + reachM, minZ: point.z - reachM, maxZ: point.z + reachM })
      .some((id) => {
        const occluder = byId.get(id);
        return occluder ? distanceFromPointToShape(occluder.geometry, point.x, point.z) <= reachM + EPS : false;
      });
  const isBareAt = (sM: number) => !isExempt(sM) && !isFronted(at(sM));

  const refineTransition = (loS: number, hiS: number, bareAtLo: boolean): number => {
    let lo = loS;
    let hi = hiS;
    while (hi - lo > KERB_BISECTION_TOLERANCE_M) {
      const mid = (lo + hi) / 2;
      if (isBareAt(mid) === bareAtLo) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const coarseSteps = Math.max(1, Math.ceil(totalLengthM / KERB_COARSE_STEP_M));
  const coarseStepM = totalLengthM / coarseSteps;
  const samples: { readonly sM: number; readonly bare: boolean }[] = [];
  for (let i = 0; i <= coarseSteps; i += 1) {
    const sM = Math.min(totalLengthM, i * coarseStepM);
    samples.push({ sM, bare: isBareAt(sM) });
  }

  const runs: BareKerbRun[] = [];
  let runStart: number | null = samples[0].bare ? 0 : null;
  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.bare === b.bare) continue;
    const transitionS = refineTransition(a.sM, b.sM, a.bare);
    if (a.bare && !b.bare) {
      runs.push(finalizeKerbRun(runStart ?? a.sM, transitionS, runLimitM));
      runStart = null;
    } else {
      runStart = transitionS;
    }
  }
  if (runStart !== null) runs.push(finalizeKerbRun(runStart, totalLengthM, runLimitM));
  return runs;
}

// ---------------------------------------------------------------------------
// Deterministic report contract (Section 7.8)
// ---------------------------------------------------------------------------

export type RepresentationProfile = "full-detail" | "structural-proxy";

export interface VisualGapReportRecord {
  readonly failureId: string;
  readonly mapId: string;
  readonly seedId: string;
  readonly representationProfile: RepresentationProfile;
  readonly roadId: string;
  readonly segmentIndex: number;
  readonly stationDistanceM: number;
  readonly side: "side-left" | "side-right";
  readonly travelHeading: "travel-fwd" | "travel-rev";
  readonly cameraProfileId: string;
  readonly viewportId: string;
  readonly fovDeg: 72 | 100;
  readonly eye: CameraPoint3;
  readonly target: CameraPoint3;
  readonly failureClass: RayFailureClass;
  readonly blobId: string | null;
  readonly blobAreaM2: number | null;
  readonly blobAabb: Aabb2 | null;
  readonly blobCentroid: Point2 | null;
  readonly nearestOpaqueOwnerId: string | null;
  readonly nearestOpaqueDistanceM: number | null;
  readonly crossedOwners: readonly { readonly ownerId: string; readonly kind: GroundSurface["kind"] }[];
  readonly suggestedTeleport: { readonly x: number; readonly z: number; readonly heading: number };
  readonly evidenceCodes: readonly string[];
}

/**
 * The stable, descriptive failure id (Section 7.8):
 * `<mapId>/<seed-id>/<representation-profile>/<roadId>/seg-<n>/station-<rounded-cm>/<side>/<travel>/<camera-profile>/<viewport>/<fov>/<ray-or-target-id>`
 */
export function buildFailureId(params: {
  readonly mapId: string;
  readonly seedId: string;
  readonly representationProfile: RepresentationProfile;
  readonly roadId: string;
  readonly segmentIndex: number;
  readonly stationDistanceM: number;
  readonly side: "side-left" | "side-right";
  readonly travelHeading: "travel-fwd" | "travel-rev";
  readonly cameraProfileId: string;
  readonly viewportId: string;
  readonly fovDeg: number;
  readonly rayOrTargetId: string;
}): string {
  const stationRoundedCm = Math.round(params.stationDistanceM * 100);
  return [
    params.mapId,
    params.seedId,
    params.representationProfile,
    params.roadId,
    `seg-${params.segmentIndex}`,
    `station-${stationRoundedCm}`,
    params.side,
    params.travelHeading,
    params.cameraProfileId,
    params.viewportId,
    `${params.fovDeg}`,
    params.rayOrTargetId,
  ].join("/");
}

/** `az-<millidegrees>` for a supplemental fan ray. */
export function azimuthRayId(azimuthRad: number): string {
  const millidegrees = Math.round(((azimuthRad * 180) / Math.PI) * 1000);
  return `az-${millidegrees}`;
}

/** `blob-<blobId>-cell-<stableFragmentId>` for an eye-to-ground-cell target.
 * `blobId` is `VoidBlob.id`, which already carries its own `blob-` prefix
 * (Section 7.8's literal format only ever appears with one). */
export function blobTargetId(blobId: string, fragmentId: string): string {
  return `${blobId}-cell-${fragmentId}`;
}
