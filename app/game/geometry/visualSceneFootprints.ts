/**
 * The layered visual-scene geometry model — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 7.2.
 *
 * Pure, deterministic, Babylon-free, DOM-free, clock-free (mechanically
 * enforced by the same ESLint rule every `geometry/*.ts` file obeys): this
 * module and its sibling `visualGapCoverage.ts` never import
 * `simulationAdapter.ts` or any `render/*.ts` module.
 *
 * `GroundSurface` is what the ground CLASSIFIES as at a point (road, park,
 * water, ...); `OccluderVolume` is what BLOCKS a sightline. They are
 * deliberately independent — an elevated gas canopy occludes without erasing
 * the grey ground beneath it (Section 7.2's "ground and occlusion are
 * deliberately separate", elaborated in `visualGapCoverage.ts`'s ground
 * raster).
 *
 * Every shape lives in this one small `Shape2d` union so the rest of the
 * audit (the spatial index, the ray-vs-shape kernel, the ground raster) can
 * stay shape-agnostic. `Polygon`/`MultiPolygon` follow one fixed winding
 * convention — outer rings clockwise, holes counter-clockwise, in this
 * codebase's (x, z) frame — matching `geometry/landmarkGroundSolids.ts`'s
 * `regularEllipsePolygon` (verified against Babylon's own cylinder mesh
 * vertex order) and the wider `headingDeg`-is-clockwise convention documented
 * in `docs/map-authoring.md`.
 */

import polygonClipping, {
  type MultiPolygon as ClippingMultiPolygon,
  type Pair as ClippingPair,
  type Polygon as ClippingPolygon,
  type Ring as ClippingRing,
} from "polygon-clipping";
import { buildingVisualOcclusionFor } from "../buildingVisualOcclusion";
import { ROAD_DIVIDED_PARK_IDS } from "../parkLayouts";
import { GAS_STATION_CANOPY_M } from "../propFootprints";
import type { GameCanvasMapPack } from "../sessionContract";
import { gasStationCanopyWorld } from "../servicePoints";
import { defaultSidewalkWidthM } from "../visuals";
import type { BuildingLayoutPlan, PlannedBuilding } from "./buildingLayout";
import { cairoTahrirLawnPolygon, roadSideParkLawnPolygon } from "./cairoParkland";
import { landmarkGroundSolids } from "./landmarkGroundSolids";
import { placedServiceShellSolids, placedVenueFootprint } from "./placedPropFootprints";
import { buildRoadSurfaceStripGeometry, collectRoadJunctionFills } from "./roadStrips";
import { buildWaterPolygonGeometry } from "./waterGeometry";
import { resolveWorldGroundBounds } from "./worldGround";

// `polygon-clipping`'s own `Geom` union (`Polygon | MultiPolygon`) is not
// exported from the package, so it is restated here.
type ClippingGeom = ClippingPolygon | ClippingMultiPolygon;

// ---------------------------------------------------------------------------
// Shape model (Section 7.2)
// ---------------------------------------------------------------------------

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export interface Circle {
  readonly kind: "circle";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface Aabb {
  readonly kind: "aabb";
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** `ux`/`uz` is the unit U (half-`halfU`) axis; V is its perpendicular
 * `(uz, -ux)` — the same convention `StructuralObb`/`StaticObstacle` use. */
export interface Obb {
  readonly kind: "obb";
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

/** One polygon, possibly with holes. Rings are implicitly closed (no
 * repeated last point). Outer clockwise, holes counter-clockwise. */
export interface Polygon {
  readonly kind: "polygon";
  readonly outer: readonly Point2[];
  readonly holes?: readonly (readonly Point2[])[];
}

/** Disjoint polygon pieces sharing one semantic owner id. */
export interface MultiPolygon {
  readonly kind: "multiPolygon";
  readonly parts: readonly {
    readonly outer: readonly Point2[];
    readonly holes?: readonly (readonly Point2[])[];
  }[];
}

export type Shape2d = Circle | Aabb | Obb | Polygon | MultiPolygon;

// ---------------------------------------------------------------------------
// Ground surfaces and occluder volumes (Section 7.2)
// ---------------------------------------------------------------------------

export type GroundSurfaceKind =
  | "world-ground"
  | "road"
  | "sidewalk"
  | "junction"
  | "bridge-deck"
  | "park"
  | "water"
  | "promenade"
  | "functional-open";

export interface GroundSurface {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: GroundSurfaceKind;
  readonly geometry: Shape2d;
  readonly surfaceY: number;
  readonly layerPriority: number;
  readonly provenance: string;
}

export type OccluderVolumeKind =
  | "building"
  | "venue-building"
  | "service-building"
  | "landmark-building";

export interface OccluderVolume {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: OccluderVolumeKind;
  readonly geometry: Shape2d;
  readonly minY: number;
  readonly maxY: number;
  readonly provenance: string;
}

// ---------------------------------------------------------------------------
// Geometry kernel: bounds, containment, exact segment/ray intersection
// ---------------------------------------------------------------------------

/** Numerical slack for boundary-inclusive tests, matching the outward
 * rounding grain the rest of the geometry catalogue already rounds to. */
const EPS = 1e-9;

export interface Aabb2 {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function ringAabb(points: readonly Point2[]): Aabb2 {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** The shape's axis-aligned bounding box — for spatial-index insertion only,
 * never a substitute for the exact shape in a containment/intersection test. */
export function aabbOfShape(shape: Shape2d): Aabb2 {
  switch (shape.kind) {
    case "circle":
      return {
        minX: shape.x - shape.radius,
        maxX: shape.x + shape.radius,
        minZ: shape.z - shape.radius,
        maxZ: shape.z + shape.radius,
      };
    case "aabb":
      return shape;
    case "obb": {
      const vx = shape.uz;
      const vz = -shape.ux;
      const ex = Math.abs(shape.ux) * shape.halfU + Math.abs(vx) * shape.halfV;
      const ez = Math.abs(shape.uz) * shape.halfU + Math.abs(vz) * shape.halfV;
      return { minX: shape.x - ex, maxX: shape.x + ex, minZ: shape.z - ez, maxZ: shape.z + ez };
    }
    case "polygon":
      return ringAabb(shape.outer);
    case "multiPolygon": {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const part of shape.parts) {
        const box = ringAabb(part.outer);
        minX = Math.min(minX, box.minX);
        maxX = Math.max(maxX, box.maxX);
        minZ = Math.min(minZ, box.minZ);
        maxZ = Math.max(maxZ, box.maxZ);
      }
      return { minX, maxX, minZ, maxZ };
    }
  }
}

/** Signed double-area of a ring in this codebase's (x, z) frame. Negative
 * means clockwise — verified against `landmarkGroundSolids.ts`'s
 * `regularEllipsePolygon`, whose `(cx + r·cosθ, cz − r·sinθ)` parametrization
 * (increasing θ) is clockwise and integrates to exactly this sign. */
export function signedArea2(points: readonly Point2[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum;
}

export function ringIsClockwise(points: readonly Point2[]): boolean {
  return signedArea2(points) < 0;
}

function ensureWinding(points: readonly Point2[], clockwise: boolean): readonly Point2[] {
  const isCw = ringIsClockwise(points);
  return isCw === clockwise ? points : [...points].reverse();
}

/** A ring's polygon area (always positive), shoelace formula. */
export function ringArea(points: readonly Point2[]): number {
  return Math.abs(signedArea2(points)) / 2;
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > EPS ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq)) : 0;
  const nx = ax + dx * t;
  const nz = az + dz * t;
  return Math.hypot(px - nx, pz - nz);
}

function pointOnRingBoundary(x: number, z: number, points: readonly Point2[], tol: number): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (distanceToSegment(x, z, a.x, a.z, b.x, b.z) <= tol) return true;
  }
  return false;
}

/** Even-odd ray-casting containment test for one ring, boundary-inclusive. */
function pointInRing(x: number, z: number, points: readonly Point2[], tol = 1e-7): boolean {
  if (pointOnRingBoundary(x, z, points, tol)) return true;
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    const crosses = zi > z !== zj > z;
    if (crosses) {
      const xCross = xj + ((x_intersect_helper(z, zi, zj)) * (xi - xj));
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

// Fraction of the way from j to i (in z) that the scanline sits at, used only
// by `pointInRing`'s crossing-number test. Split out so the formula above
// reads as the standard PNPOLY test rather than a wall of arithmetic.
function x_intersect_helper(z: number, zi: number, zj: number): number {
  return (z - zj) / (zi - zj);
}

/** Point-in-polygon with holes: inside the outer ring and outside every hole. */
export function pointInPolygonWithHoles(
  x: number,
  z: number,
  outer: readonly Point2[],
  holes?: readonly (readonly Point2[])[],
): boolean {
  if (!pointInRing(x, z, outer)) return false;
  if (!holes) return true;
  for (const hole of holes) {
    // A point ON a hole's boundary counts as inside the solid region (the
    // boundary is shared with the solid), so only strict-interior-of-hole
    // excludes.
    if (pointOnRingBoundary(x, z, hole, 1e-7)) continue;
    if (pointInRing(x, z, hole, 0)) return false;
  }
  return true;
}

export function pointInShape(shape: Shape2d, x: number, z: number): boolean {
  switch (shape.kind) {
    case "circle":
      return Math.hypot(x - shape.x, z - shape.z) <= shape.radius + EPS;
    case "aabb":
      return x >= shape.minX - EPS && x <= shape.maxX + EPS && z >= shape.minZ - EPS && z <= shape.maxZ + EPS;
    case "obb": {
      const dx = x - shape.x;
      const dz = z - shape.z;
      const u = dx * shape.ux + dz * shape.uz;
      const v = dx * shape.uz - dz * shape.ux;
      return Math.abs(u) <= shape.halfU + EPS && Math.abs(v) <= shape.halfV + EPS;
    }
    case "polygon":
      return pointInPolygonWithHoles(x, z, shape.outer, shape.holes);
    case "multiPolygon":
      return shape.parts.some((part) => pointInPolygonWithHoles(x, z, part.outer, part.holes));
  }
}

function distanceToRing(x: number, z: number, points: readonly Point2[]): number {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    best = Math.min(best, distanceToSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/** Distance from `(x, z)` to `shape`'s boundary/interior — 0 when the point
 * is inside. Used by the bare-kerb-run metric (Section 5.4), which needs
 * "how far to the nearest opaque footprint," not a boolean containment test. */
export function distanceFromPointToShape(shape: Shape2d, x: number, z: number): number {
  switch (shape.kind) {
    case "circle":
      return Math.max(0, Math.hypot(x - shape.x, z - shape.z) - shape.radius);
    case "aabb":
    case "obb": {
      if (pointInShape(shape, x, z)) return 0;
      const nearest = nearestPointOnConvex(shape, x, z);
      return Math.hypot(x - nearest.x, z - nearest.z);
    }
    case "polygon": {
      if (pointInPolygonWithHoles(x, z, shape.outer, shape.holes)) return 0;
      let best = distanceToRing(x, z, shape.outer);
      for (const hole of shape.holes ?? []) best = Math.min(best, distanceToRing(x, z, hole));
      return best;
    }
    case "multiPolygon": {
      let best = Infinity;
      for (const part of shape.parts) {
        if (pointInPolygonWithHoles(x, z, part.outer, part.holes)) return 0;
        best = Math.min(best, distanceToRing(x, z, part.outer));
        for (const hole of part.holes ?? []) best = Math.min(best, distanceToRing(x, z, hole));
      }
      return best;
    }
  }
}

/** A closed [t0, t1] parameter interval along a segment, t in [0, 1]. */
export type ParamInterval = readonly [number, number];

function mergeIntervals(intervals: ParamInterval[]): ParamInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const [start, end] = sorted[i];
    if (start <= last[1] + 1e-9) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** [t0, t1] where a segment (ax,az)-(bx,bz) is inside a circle, or []. */
function segmentInsideCircle(ax: number, az: number, bx: number, bz: number, circle: Circle): ParamInterval[] {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - circle.x;
  const fz = az - circle.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - circle.radius * circle.radius;
  if (a < EPS) {
    return c <= 0 ? [[0, 1]] : [];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sqrtDisc = Math.sqrt(disc);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);
  const start = Math.max(0, t0);
  const end = Math.min(1, t1);
  return start <= end ? [[start, end]] : [];
}

/** Slab method: [t0, t1] where a segment is inside an axis interval pair. */
function segmentInsideSlabs(
  ax: number,
  bx: number,
  minX: number,
  maxX: number,
  az: number,
  bz: number,
  minZ: number,
  maxZ: number,
): ParamInterval[] {
  let tMin = 0;
  let tMax = 1;
  const dx = bx - ax;
  if (Math.abs(dx) < EPS) {
    if (ax < minX || ax > maxX) return [];
  } else {
    let t0 = (minX - ax) / dx;
    let t1 = (maxX - ax) / dx;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
  }
  const dz = bz - az;
  if (Math.abs(dz) < EPS) {
    if (az < minZ || az > maxZ) return [];
  } else {
    let t0 = (minZ - az) / dz;
    let t1 = (maxZ - az) / dz;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
  }
  return tMin <= tMax ? [[tMin, tMax]] : [];
}

/** All [t0, t1] sub-intervals of a segment lying inside a (possibly concave,
 * possibly multi-part, possibly holed) ring set, found by collecting every
 * ring-edge crossing t, then testing each resulting sub-interval's midpoint. */
function segmentInsideRingSet(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  parts: readonly { readonly outer: readonly Point2[]; readonly holes?: readonly (readonly Point2[])[] }[],
): ParamInterval[] {
  const dx = bx - ax;
  const dz = bz - az;
  const ts = new Set<number>([0, 1]);
  const collectCrossings = (ring: readonly Point2[]) => {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = ((p.x - ax) * ez - (p.z - az) * ex) / denom;
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      const u = ((p.x - ax) * dz - (p.z - az) * dx) / -denom;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      ts.add(Math.max(0, Math.min(1, t)));
    }
  };
  for (const part of parts) {
    collectCrossings(part.outer);
    for (const hole of part.holes ?? []) collectCrossings(hole);
  }
  const sorted = [...ts].sort((a, b) => a - b);
  const inside: ParamInterval[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    const mx = ax + dx * mid;
    const mz = az + dz * mid;
    const isInside = parts.some((part) => pointInPolygonWithHoles(mx, mz, part.outer, part.holes));
    if (isInside) inside.push([t0, t1]);
  }
  return mergeIntervals(inside);
}

/**
 * Every [t0, t1] sub-interval (t in [0, 1]) of segment (ax,az)-(bx,bz) whose
 * points lie inside `shape`'s horizontal footprint. Used by the vertical
 * occlusion check (Section 7.3): the caller intersects this against the
 * segment's `[minY, maxY]`-crossing interval and only a shared overlap
 * counts as a hit.
 */
export function segmentInsideShapeIntervals(
  shape: Shape2d,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): ParamInterval[] {
  switch (shape.kind) {
    case "circle":
      return segmentInsideCircle(ax, az, bx, bz, shape);
    case "aabb":
      return segmentInsideSlabs(ax, bx, shape.minX, shape.maxX, az, bz, shape.minZ, shape.maxZ);
    case "obb": {
      // Rotate the segment endpoints into the OBB's own (u, v) frame, where
      // it is an axis-aligned slab test.
      const toLocal = (x: number, z: number) => {
        const dx = x - shape.x;
        const dz = z - shape.z;
        return { u: dx * shape.ux + dz * shape.uz, v: dx * shape.uz - dz * shape.ux };
      };
      const a = toLocal(ax, az);
      const b = toLocal(bx, bz);
      return segmentInsideSlabs(a.u, b.u, -shape.halfU, shape.halfU, a.v, b.v, -shape.halfV, shape.halfV);
    }
    case "polygon":
      return segmentInsideRingSet(ax, az, bx, bz, [{ outer: shape.outer, holes: shape.holes }]);
    case "multiPolygon":
      return segmentInsideRingSet(ax, az, bx, bz, shape.parts);
  }
}

/** Whether two shapes' footprints overlap at all (used by reservation/keep-out
 * style predicates, not by the ray kernel). Convex-vs-convex uses SAT-style
 * closest features; anything touching a polygon degrades to a clipped-area
 * check via `booleanIntersection`, which is exact for concave/holed shapes. */
export function shapesOverlap(a: Shape2d, b: Shape2d): boolean {
  if (a.kind === "polygon" || a.kind === "multiPolygon" || b.kind === "polygon" || b.kind === "multiPolygon") {
    return booleanIntersectionArea(a, b) > 1e-6;
  }
  // Both are circle/aabb/obb: closest-point/SAT style exact tests.
  if (a.kind === "circle" && b.kind === "circle") {
    return Math.hypot(a.x - b.x, a.z - b.z) <= a.radius + b.radius + EPS;
  }
  if (a.kind === "circle" || b.kind === "circle") {
    const circle = a.kind === "circle" ? a : (b as Circle);
    const other = (a.kind === "circle" ? b : a) as Aabb | Obb;
    const nearest = nearestPointOnConvex(other, circle.x, circle.z);
    return Math.hypot(nearest.x - circle.x, nearest.z - circle.z) <= circle.radius + EPS;
  }
  // aabb/obb vs aabb/obb: SAT over each shape's own two axes.
  const boxA = toObb(a as Aabb | Obb);
  const boxB = toObb(b as Aabb | Obb);
  return obbOverlapsObb(boxA, boxB);
}

function toObb(shape: Aabb | Obb): Obb {
  if (shape.kind === "obb") return shape;
  return {
    kind: "obb",
    x: (shape.minX + shape.maxX) / 2,
    z: (shape.minZ + shape.maxZ) / 2,
    ux: 1,
    uz: 0,
    halfU: (shape.maxX - shape.minX) / 2,
    halfV: (shape.maxZ - shape.minZ) / 2,
  };
}

function obbOverlapsObb(a: Obb, b: Obb): boolean {
  const axes: readonly [number, number][] = [
    [a.ux, a.uz],
    [a.uz, -a.ux],
    [b.ux, b.uz],
    [b.uz, -b.ux],
  ];
  const cornersOf = (obb: Obb): Point2[] => {
    const vx = obb.uz;
    const vz = -obb.ux;
    return [
      { x: obb.x + obb.ux * obb.halfU + vx * obb.halfV, z: obb.z + obb.uz * obb.halfU + vz * obb.halfV },
      { x: obb.x - obb.ux * obb.halfU + vx * obb.halfV, z: obb.z - obb.uz * obb.halfU + vz * obb.halfV },
      { x: obb.x - obb.ux * obb.halfU - vx * obb.halfV, z: obb.z - obb.uz * obb.halfU - vz * obb.halfV },
      { x: obb.x + obb.ux * obb.halfU - vx * obb.halfV, z: obb.z + obb.uz * obb.halfU - vz * obb.halfV },
    ];
  };
  const cornersA = cornersOf(a);
  const cornersB = cornersOf(b);
  for (const [ax, az] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const c of cornersA) {
      const p = c.x * ax + c.z * az;
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    let minB = Infinity;
    let maxB = -Infinity;
    for (const c of cornersB) {
      const p = c.x * ax + c.z * az;
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }
    if (maxA < minB - EPS || maxB < minA - EPS) return false;
  }
  return true;
}

function nearestPointOnConvex(shape: Aabb | Obb, x: number, z: number): Point2 {
  const obb = toObb(shape);
  const dx = x - obb.x;
  const dz = z - obb.z;
  const u = Math.max(-obb.halfU, Math.min(obb.halfU, dx * obb.ux + dz * obb.uz));
  const v = Math.max(-obb.halfV, Math.min(obb.halfV, dx * obb.uz - dz * obb.ux));
  return { x: obb.x + obb.ux * u + obb.uz * v, z: obb.z + obb.uz * u - obb.ux * v };
}

// ---------------------------------------------------------------------------
// Circle decomposition (Section 7.2: "no larger than 2 cm" sagitta tolerance)
// ---------------------------------------------------------------------------

export const CIRCLE_DECOMPOSITION_TOLERANCE_M = 0.02;

/** A clockwise-wound regular polygon approximating `circle`, whose maximum
 * radial deviation (sagitta) never exceeds `toleranceM`. Matches
 * `landmarkGroundSolids.ts`'s `regularEllipsePolygon` parametrization
 * (`x = cx + r·cosθ`, `z = cz − r·sinθ`, increasing θ), which is clockwise
 * and verified against Babylon's own cylinder mesh vertex order. */
export function circleToPolygon(circle: Circle, toleranceM = CIRCLE_DECOMPOSITION_TOLERANCE_M): Polygon {
  const r = Math.max(circle.radius, 1e-6);
  const ratio = Math.max(-1, Math.min(1, 1 - toleranceM / r));
  const minSides = Math.PI / Math.acos(ratio);
  const sides = Math.max(12, Math.ceil(minSides));
  const points: Point2[] = [];
  for (let k = 0; k < sides; k += 1) {
    const angle = (k / sides) * Math.PI * 2;
    points.push({ x: circle.x + r * Math.cos(angle), z: circle.z - r * Math.sin(angle) });
  }
  return { kind: "polygon", outer: points };
}

function obbToPolygon(obb: Obb): Polygon {
  const vx = obb.uz;
  const vz = -obb.ux;
  // (+U,+V) -> (+U,-V) -> (-U,-V) -> (-U,+V): clockwise when (ux,uz),(vx,vz)
  // is itself a clockwise-handed local frame, which it is by construction
  // (V is U rotated -90 degrees in this (x,z) convention, matching every
  // other OBB consumer in this codebase).
  return {
    kind: "polygon",
    outer: [
      { x: obb.x + obb.ux * obb.halfU + vx * obb.halfV, z: obb.z + obb.uz * obb.halfU + vz * obb.halfV },
      { x: obb.x - obb.ux * obb.halfU + vx * obb.halfV, z: obb.z - obb.uz * obb.halfU + vz * obb.halfV },
      { x: obb.x - obb.ux * obb.halfU - vx * obb.halfV, z: obb.z - obb.uz * obb.halfU - vz * obb.halfV },
      { x: obb.x + obb.ux * obb.halfU - vx * obb.halfV, z: obb.z + obb.uz * obb.halfU - vz * obb.halfV },
    ],
  };
}

function aabbToPolygon(box: Aabb): Polygon {
  return {
    kind: "polygon",
    outer: [
      { x: box.minX, z: box.minZ },
      { x: box.minX, z: box.maxZ },
      { x: box.maxX, z: box.maxZ },
      { x: box.maxX, z: box.minZ },
    ],
  };
}

/** Any shape, reduced to its exact clockwise-wound polygon/multiPolygon
 * representation (circles decomposed at the 2 cm sagitta tolerance). */
export function shapeToPolygonal(shape: Shape2d): Polygon | MultiPolygon {
  switch (shape.kind) {
    case "circle":
      return circleToPolygon(shape);
    case "aabb":
      return aabbToPolygon(shape);
    case "obb":
      return obbToPolygon(shape);
    case "polygon":
    case "multiPolygon":
      return shape;
  }
}

// ---------------------------------------------------------------------------
// polygon-clipping wrapper (Section 7.2: Boolean union/difference/intersection
// and cell clipping, with canonicalized output)
// ---------------------------------------------------------------------------

/** Coordinate-snap precision fed to `polygon-clipping`. Real map geometry
 * (road-strip offsetting, repeated rotate/translate transforms) can produce
 * vertices that are "meant" to coincide but differ by float noise far below
 * this — which the library's exact-arithmetic ring-closing algorithm is not
 * robust to (`RingOut.factory`'s "Unable to complete output ring" throw,
 * hit on real London/NYC/Cairo geometry during Phase 1 development).
 * Snapping every coordinate to this grid first, then dropping the
 * consecutive-duplicate/near-zero-length edges snapping can create, is the
 * standard robustness fix for this class of library. 1 mm is far finer than
 * anything this audit's thresholds (1 cm/1.5 m/16 m/28 m) care about. */
const CLIPPING_SNAP_M = 0.001;

function snapCoord(value: number): number {
  return Math.round(value / CLIPPING_SNAP_M) * CLIPPING_SNAP_M;
}

function ringToClipping(points: readonly Point2[], clockwise: boolean): ClippingRing {
  const wound = ensureWinding(points, clockwise);
  const snapped: Point2[] = [];
  for (const p of wound) {
    const sx = snapCoord(p.x);
    const sz = snapCoord(p.z);
    const last = snapped[snapped.length - 1];
    if (!last || Math.abs(last.x - sx) > 1e-9 || Math.abs(last.z - sz) > 1e-9) {
      snapped.push({ x: sx, z: sz });
    }
  }
  // A closed ring's first/last snapped points can coincide too.
  while (
    snapped.length > 1 &&
    Math.abs(snapped[0].x - snapped[snapped.length - 1].x) < 1e-9 &&
    Math.abs(snapped[0].z - snapped[snapped.length - 1].z) < 1e-9
  ) {
    snapped.pop();
  }
  const ring: ClippingPair[] = snapped.map((p) => [p.x, p.z] as ClippingPair);
  if (snapped.length > 0) ring.push([snapped[0].x, snapped[0].z]);
  return ring;
}

/** `polygon-clipping`'s own input geometry is winding-agnostic, but this
 * project's shapes are always authored/produced clockwise-outer, so every
 * ring is normalized on the way in for defence in depth. */
function shapeToClippingGeom(shape: Shape2d): ClippingGeom {
  const polygonal = shapeToPolygonal(shape);
  if (polygonal.kind === "polygon") {
    return [
      [ringToClipping(polygonal.outer, true), ...(polygonal.holes ?? []).map((h) => ringToClipping(h, false))],
    ];
  }
  return polygonal.parts.map((part) => [
    ringToClipping(part.outer, true),
    ...(part.holes ?? []).map((h) => ringToClipping(h, false)),
  ]);
}

function clippingRingToPoints(ring: ClippingRing): Point2[] {
  // polygon-clipping closes rings by repeating the first point; drop it.
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  return open.map(([x, z]) => ({ x, z }));
}

/** Canonical ordering key for a ring: its lexicographically-smallest vertex,
 * so repeated runs of the same geometry always emit rings/components in the
 * same order regardless of the clipping library's internal traversal. */
function canonicalStart<T extends Point2>(points: readonly T[]): readonly T[] {
  if (points.length === 0) return points;
  let bestIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i];
    const b = points[bestIndex];
    if (a.x < b.x - 1e-9 || (Math.abs(a.x - b.x) <= 1e-9 && a.z < b.z - 1e-9)) bestIndex = i;
  }
  return [...points.slice(bestIndex), ...points.slice(0, bestIndex)];
}

function ringSortKey(points: readonly Point2[]): string {
  const start = canonicalStart(points)[0] ?? { x: 0, z: 0 };
  return `${start.x.toFixed(6)}:${start.z.toFixed(6)}`;
}

/** Normalizes a raw `polygon-clipping` result into this module's
 * `MultiPolygon`: outer rings clockwise, holes counter-clockwise, each ring
 * rotated to start at its lexicographically-smallest point, and parts sorted
 * by that same key — so two calls over the same (possibly reordered) input
 * are byte-identical. */
function fromClippingResult(result: ClippingMultiPolygon): MultiPolygon {
  const parts = result
    .map((polygon) => {
      const [outerRing, ...holeRings] = polygon;
      const outer = ensureWinding(canonicalStart(clippingRingToPoints(outerRing)), true);
      const holes = holeRings
        .map((hole) => ensureWinding(canonicalStart(clippingRingToPoints(hole)), false))
        .filter((hole) => ringArea(hole) > 1e-9)
        .sort((a, b) => ringSortKey(a).localeCompare(ringSortKey(b)));
      return { outer, holes: holes.length ? holes : undefined };
    })
    .filter((part) => ringArea(part.outer) > 1e-9)
    .sort((a, b) => ringSortKey(a.outer).localeCompare(ringSortKey(b.outer)));
  return { kind: "multiPolygon", parts };
}

/** Thrown when `polygon-clipping` itself cannot resolve an operation (its
 * exact-arithmetic ring-closing algorithm occasionally rejects even
 * snap-cleaned real-world geometry). Callers that walk many shapes — the
 * ground raster above all — must catch this per-unit-of-work rather than
 * let one bad cell/shape abort an entire map's audit; Section 5.5's
 * `unsupported_geometry` class exists for exactly this. */
export class PolygonClippingError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`polygon-clipping ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PolygonClippingError";
  }
}

export function booleanUnion(...shapes: readonly Shape2d[]): MultiPolygon {
  if (shapes.length === 0) return { kind: "multiPolygon", parts: [] };
  const geoms = shapes.map(shapeToClippingGeom);
  try {
    return fromClippingResult(polygonClipping.union(geoms[0], ...geoms.slice(1)));
  } catch (cause) {
    throw new PolygonClippingError("union", cause);
  }
}

export function booleanIntersection(a: Shape2d, b: Shape2d): MultiPolygon {
  try {
    return fromClippingResult(polygonClipping.intersection(shapeToClippingGeom(a), shapeToClippingGeom(b)));
  } catch (cause) {
    throw new PolygonClippingError("intersection", cause);
  }
}

export function booleanDifference(subject: Shape2d, ...clips: readonly Shape2d[]): MultiPolygon {
  try {
    return fromClippingResult(polygonClipping.difference(shapeToClippingGeom(subject), ...clips.map(shapeToClippingGeom)));
  } catch (cause) {
    throw new PolygonClippingError("difference", cause);
  }
}

function multiPolygonArea(mp: MultiPolygon): number {
  return mp.parts.reduce(
    (sum, part) => sum + ringArea(part.outer) - (part.holes ?? []).reduce((h, hole) => h + ringArea(hole), 0),
    0,
  );
}

export function booleanIntersectionArea(a: Shape2d, b: Shape2d): number {
  return multiPolygonArea(booleanIntersection(a, b));
}

/** The shape's own footprint area (polygon/circle exact; aabb/obb exact). */
export function shapeArea(shape: Shape2d): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius * shape.radius;
    case "aabb":
      return Math.max(0, shape.maxX - shape.minX) * Math.max(0, shape.maxZ - shape.minZ);
    case "obb":
      return 4 * shape.halfU * shape.halfV;
    case "polygon":
      return ringArea(shape.outer) - (shape.holes ?? []).reduce((h, hole) => h + ringArea(hole), 0);
    case "multiPolygon":
      return multiPolygonArea(shape);
  }
}

export { multiPolygonArea };

// ---------------------------------------------------------------------------
// Real-map collection (Section 7.2 "Collection rules")
// ---------------------------------------------------------------------------

export interface CollectedIssue {
  readonly kind: "audit_geometry_missing" | "unsupported_geometry";
  readonly ownerId: string;
  readonly reason: string;
}

export interface CollectedGeometry {
  readonly groundSurfaces: readonly GroundSurface[];
  readonly occluders: readonly OccluderVolume[];
  readonly issues: readonly CollectedIssue[];
}

/**
 * Heights this collector does not yet have a measured source for (venue and
 * service-building rooflines — `PROP_MODEL_FOOTPRINTS_M`/`GAS_STATION_SOLIDS_M`/
 * `REPAIR_SHOP_SOLIDS_M` are XZ-only; this codebase's collision is 2-D and
 * carries no roofline data at all). Conservative single/low-rise placeholder
 * heights, clearly isolated here rather than scattered as magic numbers, so
 * a future NullEngine measurement pass (mirroring
 * `buildingVisualOcclusion.ts`'s own approach) has one place to replace.
 * Under-estimating is the safer direction for a gap-finding audit: it can
 * only ever make a ray see PAST a real roofline it shouldn't, at the
 * near-horizontal camera angles this whole audit samples at — never falsely
 * certify a gap closed.
 */
const VENUE_OCCLUSION_HEIGHT_M = 6;
const GAS_SHOP_OCCLUSION_HEIGHT_M = 4.5;
const REPAIR_SHOP_OCCLUSION_HEIGHT_M = 5.4;

function rectLandmarkWorldPoints(landmark: {
  readonly center: Point2;
  readonly size: Point2;
  readonly headingDeg?: number;
}): Point2[] {
  const heading = ((landmark.headingDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const corners: readonly [number, number][] = [
    [-0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
    [0.5, -0.5],
  ];
  return corners.map(([u, v]) => {
    const localX = u * landmark.size.x;
    const localZ = v * landmark.size.z;
    return {
      x: landmark.center.x + localX * cos + localZ * sin,
      z: landmark.center.z - localX * sin + localZ * cos,
    };
  });
}

/** Rotates+translates a local-frame point by a world placement — the exact
 * convention `geometry/buildingLayout.ts`'s `worldSolidFromLocalBounds` and
 * every other placement transform in this codebase already uses. */
function placeLocalPoint(p: Point2, px: number, pz: number, yaw: number): Point2 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: px + p.x * cos + p.z * sin, z: pz - p.x * sin + p.z * cos };
}

function stripGeometryToPolygon(strip: {
  readonly positions: readonly number[];
  readonly closed: boolean;
}): Polygon {
  const n = strip.positions.length / 6;
  const pos: Point2[] = [];
  const neg: Point2[] = [];
  for (let i = 0; i < n; i += 1) {
    pos.push({ x: strip.positions[6 * i], z: strip.positions[6 * i + 2] });
    neg.push({ x: strip.positions[6 * i + 3], z: strip.positions[6 * i + 5] });
  }
  if (!strip.closed) {
    return { kind: "polygon", outer: [...pos, ...[...neg].reverse()] };
  }
  // A closed (roundabout) strip is two independent ring loops (outer/inner
  // offsets of the closed centerline) forming an annulus, not one combined
  // outline — use the larger-area ring as the outer boundary, the smaller
  // as the hole, since the strip builder does not itself label which is
  // which for a closed centerline.
  const [outer, hole] = ringArea(pos) >= ringArea(neg) ? [pos, neg] : [neg, pos];
  return { kind: "polygon", outer, holes: [hole] };
}

/**
 * Every `GroundSurface` derived from a map's authored roads/sidewalks/
 * junctions/parks/water, using the exact same pure builders the renderer
 * calls (`roadStrips.ts`, `cairoParkland.ts`, `waterGeometry.ts`) — Section
 * 7.2 collection rules 7-9.
 */
export function collectGroundSurfaces(mapPack: GameCanvasMapPack): readonly GroundSurface[] {
  const surfaces: GroundSurface[] = [];
  const worldBounds = resolveWorldGroundBounds(mapPack.geometry.worldSize);
  surfaces.push({
    id: "world-ground",
    ownerId: "world",
    kind: "world-ground",
    geometry: { kind: "aabb", ...worldBounds },
    surfaceY: 0,
    layerPriority: 0,
    provenance: "geometry/worldGround.ts:resolveWorldGroundBounds",
  });

  const roadSurfaces = mapPack.geometry.roadSurfaces ?? [];
  const bridgeDeckIds = new Set(
    (mapPack.geometry.waterBodies ?? []).flatMap((water) => water.bridgePortalSurfaceIds ?? []),
  );
  const sidewalkWidthOf = (surface: (typeof roadSurfaces)[number]) =>
    Math.max(0, surface.sidewalkWidthM ?? defaultSidewalkWidthM(mapPack));

  for (const surface of roadSurfaces) {
    const smoothClosed = surface.surfaceType === "roundabout" ? true : undefined;
    const carriageway = stripGeometryToPolygon(
      buildRoadSurfaceStripGeometry(surface.centerline, surface.widthM, smoothClosed),
    );
    const sidewalkWidth = sidewalkWidthOf(surface);
    const outerBand = stripGeometryToPolygon(
      buildRoadSurfaceStripGeometry(surface.centerline, surface.widthM + sidewalkWidth * 2, smoothClosed),
    );
    const isBridgeDeck = bridgeDeckIds.has(surface.id);
    surfaces.push({
      id: `road-${surface.id}`,
      ownerId: surface.id,
      kind: isBridgeDeck ? "bridge-deck" : "road",
      geometry: carriageway,
      surfaceY: 0.07,
      layerPriority: isBridgeDeck ? 2 : 1,
      provenance: "geometry/roadStrips.ts:buildRoadSurfaceStripGeometry",
    });
    if (sidewalkWidth > 0) {
      const sidewalkRing = booleanDifference(outerBand, carriageway);
      if (multiPolygonArea(sidewalkRing) > 1e-6) {
        surfaces.push({
          id: `sidewalk-${surface.id}`,
          ownerId: surface.id,
          kind: "sidewalk",
          geometry: sidewalkRing,
          surfaceY: 0.045,
          layerPriority: 1,
          provenance: "geometry/roadStrips.ts:buildRoadSurfaceStripGeometry",
        });
      }
    }
  }

  const junctionSources = roadSurfaces.map((s) => ({ id: s.id, centerline: s.centerline, widthM: s.widthM }));
  for (const [index, fill] of collectRoadJunctionFills(junctionSources).entries()) {
    surfaces.push({
      id: `junction-${index}`,
      ownerId: fill.surfaceIds.join("+"),
      kind: "junction",
      geometry: { kind: "polygon", outer: fill.polygon },
      surfaceY: 0.0716,
      layerPriority: 1,
      provenance: "geometry/roadStrips.ts:collectRoadJunctionFills",
    });
  }
  const shoulderJunctionSources = roadSurfaces.map((s) => ({
    id: s.id,
    centerline: s.centerline,
    widthM: s.widthM + sidewalkWidthOf(s) * 2,
  }));
  for (const [index, fill] of collectRoadJunctionFills(shoulderJunctionSources, 0, 0).entries()) {
    surfaces.push({
      id: `junction-shoulder-${index}`,
      ownerId: fill.surfaceIds.join("+"),
      kind: "junction",
      geometry: { kind: "polygon", outer: fill.polygon },
      surfaceY: 0.0435,
      layerPriority: 1,
      provenance: "geometry/roadStrips.ts:collectRoadJunctionFills",
    });
  }

  for (const landmark of mapPack.geometry.landmarks) {
    if (landmark.kind !== "park") continue;
    let outer: readonly Point2[];
    if (ROAD_DIVIDED_PARK_IDS.has(landmark.id)) {
      outer = roadSideParkLawnPolygon(landmark, roadSurfaces);
    } else if (landmark.id === "cairo-tahrir-square") {
      outer = cairoTahrirLawnPolygon(landmark, roadSurfaces);
    } else {
      outer = rectLandmarkWorldPoints(landmark);
    }
    if (outer.length < 3) continue;
    surfaces.push({
      id: `park-${landmark.id}`,
      ownerId: landmark.id,
      kind: "park",
      geometry: { kind: "polygon", outer },
      surfaceY: 0.02,
      layerPriority: 1,
      provenance: "geometry/cairoParkland.ts / rectLandmarkWorldPoints",
    });
  }

  for (const water of mapPack.geometry.waterBodies ?? []) {
    const geometry = buildWaterPolygonGeometry(water.polygon);
    if (geometry.polygon.length < 3) continue;
    surfaces.push({
      id: `water-${water.id}`,
      ownerId: water.id,
      kind: "water",
      geometry: { kind: "polygon", outer: geometry.polygon },
      surfaceY: 0.025,
      layerPriority: 1,
      provenance: "geometry/waterGeometry.ts:buildWaterPolygonGeometry",
    });
  }

  return surfaces;
}

/** Stable per-solid id, mirroring `geometry/buildingLayout.ts`'s
 * `buildingSolidObstacleId` exactly (that function only reads `.localId` off
 * its second argument, so it is safe to reproduce here without importing a
 * `StructuralObb`-shaped value this collector does not have for the visual
 * hull case). */
function planSolidId(plan: PlannedBuilding, localId: string): string {
  return plan.solids.length === 1 ? plan.id : `${plan.id}:solid:${localId}`;
}

/**
 * Every `OccluderVolume` derived from the map's planned buildings, resolved
 * venues/services, and generic (non-bespoke) landmarks — Section 7.2
 * collection rules 1-6. Bespoke landmarks (an entry in
 * `geometry/landmarkGroundSolids.ts`) and venues/services whose model has no
 * measured footprint are reported through `issues` as `audit_geometry_missing`
 * rather than silently skipped or approximated from a collision envelope.
 */
export function collectOccluderVolumes(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): { readonly occluders: readonly OccluderVolume[]; readonly issues: readonly CollectedIssue[] } {
  const occluders: OccluderVolume[] = [];
  const issues: CollectedIssue[] = [];

  for (const plan of buildingLayout.buildings) {
    if (plan.source === "asset-slot") {
      const visual = buildingVisualOcclusionFor(plan.modelId);
      if (!visual) {
        issues.push({
          kind: "audit_geometry_missing",
          ownerId: plan.id,
          reason: `no visual-occlusion entry for model "${plan.modelId}"`,
        });
        continue;
      }
      for (const solid of visual.solids) {
        occluders.push({
          id: planSolidId(plan, solid.localId),
          ownerId: plan.id,
          kind: "building",
          geometry: { kind: "polygon", outer: solid.points.map((p) => placeLocalPoint(p, plan.x, plan.z, plan.yaw)) },
          minY: 0,
          maxY: visual.heightM,
          provenance: "buildingVisualOcclusion.ts:buildingVisualOcclusionFor",
        });
      }
    } else {
      for (const solid of plan.solids) {
        occluders.push({
          id: planSolidId(plan, solid.localId),
          ownerId: plan.id,
          kind: "building",
          geometry: {
            kind: "obb",
            x: solid.x,
            z: solid.z,
            ux: solid.ux,
            uz: solid.uz,
            halfU: solid.halfU,
            halfV: solid.halfV,
          },
          minY: 0,
          maxY: plan.heightM,
          provenance: "geometry/buildingLayout.ts:planMapBuildings (procedural/museum exact box)",
        });
      }
    }
  }

  for (const venue of mapPack.geometry.gigVenues ?? []) {
    const footprint = placedVenueFootprint(mapPack, venue);
    if (!footprint) {
      issues.push({ kind: "unsupported_geometry", ownerId: venue.id, reason: "venue lane anchor did not resolve" });
      continue;
    }
    if (!footprint.resolved) {
      issues.push({
        kind: "audit_geometry_missing",
        ownerId: venue.id,
        reason: `no measured PROP_MODEL_FOOTPRINTS_M entry for "${venue.modelId ?? venue.kind}"`,
      });
      continue;
    }
    for (const solid of footprint.solids) {
      occluders.push({
        id: `venue-${venue.id}-${solid.localId}`,
        ownerId: venue.id,
        kind: "venue-building",
        geometry: { kind: "obb", ...solid.obb },
        minY: 0,
        maxY: VENUE_OCCLUSION_HEIGHT_M,
        provenance: "geometry/placedPropFootprints.ts:placedVenueFootprint",
      });
    }
  }

  for (const service of mapPack.geometry.servicePoints ?? []) {
    const solids = placedServiceShellSolids(mapPack.laneGraph.lanes, service);
    if (!solids) {
      issues.push({ kind: "unsupported_geometry", ownerId: service.id, reason: "service lane anchor did not resolve" });
      continue;
    }
    const heightM = service.kind === "gas_station" ? GAS_SHOP_OCCLUSION_HEIGHT_M : REPAIR_SHOP_OCCLUSION_HEIGHT_M;
    for (const solid of solids) {
      occluders.push({
        id: `service-${service.id}-${solid.localId}`,
        ownerId: service.id,
        kind: "service-building",
        geometry: { kind: "obb", ...solid.obb },
        minY: 0,
        maxY: heightM,
        provenance: "geometry/placedPropFootprints.ts:placedServiceShellSolids",
      });
    }
    if (service.kind === "gas_station") {
      const canopy = gasStationCanopyWorld(mapPack.laneGraph.lanes, service);
      if (canopy) {
        occluders.push({
          id: `service-${service.id}-canopy`,
          ownerId: service.id,
          kind: "service-building",
          geometry: {
            kind: "obb",
            x: canopy.x,
            z: canopy.z,
            ux: canopy.ux,
            uz: canopy.uz,
            halfU: canopy.halfU,
            halfV: canopy.halfV,
          },
          minY: canopy.undersideY,
          maxY: GAS_STATION_CANOPY_M.topY,
          provenance: "servicePoints.ts:gasStationCanopyWorld",
        });
      }
    }
  }

  for (const landmark of mapPack.geometry.landmarks) {
    if (landmark.kind === "park" || landmark.kind === "railway" || landmark.kind === "bridge") continue;
    const bespoke = landmarkGroundSolids(mapPack.id, landmark);
    if (bespoke !== undefined) {
      // A bespoke recipe exists for VEHICLE-HEIGHT collision only (Section
      // 7.2 item 6 forbids extruding it to full height); until a real
      // height-banded visual recipe exists for this landmark, it cannot
      // certify closure.
      issues.push({
        kind: "audit_geometry_missing",
        ownerId: landmark.id,
        reason: "bespoke landmark has no height-banded visual-occlusion recipe yet",
      });
      continue;
    }
    if (landmark.kind === "tower") {
      occluders.push({
        id: `landmark-${landmark.id}`,
        ownerId: landmark.id,
        kind: "landmark-building",
        geometry: {
          kind: "circle",
          x: landmark.center.x,
          z: landmark.center.z,
          radius: Math.max(4, landmark.size.x * 0.4) / 2,
        },
        minY: 0,
        maxY: Math.max(12, landmark.size.z),
        provenance: "render/babylonGameSession.ts generic tower fallback",
      });
      continue;
    }
    // Generic station/terminal/shops/museum/cultural/monument fallback:
    // matches the exact generic facade-box the renderer draws when no
    // bespoke/city-registry recipe claims this landmark id.
    occluders.push({
      id: `landmark-${landmark.id}`,
      ownerId: landmark.id,
      kind: "landmark-building",
      geometry: {
        kind: "aabb",
        minX: landmark.center.x - landmark.size.x / 2,
        maxX: landmark.center.x + landmark.size.x / 2,
        minZ: landmark.center.z - landmark.size.z / 2,
        maxZ: landmark.center.z + landmark.size.z / 2,
      },
      minY: 0,
      maxY: landmark.kind === "terminal" ? 8 : 5,
      provenance: "render/babylonGameSession.ts generic landmark facade-box fallback",
    });
  }

  return { occluders, issues };
}

/** The whole map's visual-audit geometry in one call. */
export function collectMapVisualGeometry(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): CollectedGeometry {
  const groundSurfaces = collectGroundSurfaces(mapPack);
  const { occluders, issues } = collectOccluderVolumes(mapPack, buildingLayout);
  return { groundSurfaces, occluders, issues };
}
