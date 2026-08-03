import { BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M, bridgePortalRailSpans } from "../bridgePortalGeometry";
import { nearestPointOnPolyline } from "./roadStrips";
import { isPointInPolygon } from "../simulation";
import type { GameCanvasMapPack, GameCanvasPoint, GameCanvasWaterBody } from "../sessionContract";
import { hashStringToSeed, seededUnit } from "../visuals";

/**
 * Water-sheet geometry: ear-clipping an authored `WaterBody` outline into a
 * triangulated, shore-banded mesh, and the boat family that decorates it
 * (placement, obstacle avoidance, pose-at-time).
 *
 * Also the Cairo bridge visual-axis and elevated-pier placement functions,
 * despite the "Cairo" naming looking like it belongs with the rest of the
 * Cairo/park geometry in `cairoParkland.ts` (commit 2.5 in the decomposition
 * plan): they moved here instead because `cairoWaterBoatObstacles` below
 * needs them to keep boats clear of bridge piers, and geometry/ modules
 * cannot import from each other's future selves out of dependency order.
 *
 * Pure by design — no Babylon, no DOM — so this geometry can be pinned in
 * plain node tests without instantiating a scene. `tests/architecture.test.ts`
 * enforces that this stays true for every file under `geometry/`.
 */

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface WaterPolygonGeometry {
  /** The deduplicated outline, in the order it was authored. */
  readonly polygon: readonly GameCanvasPoint[];
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly uvs: readonly number[];
  /**
   * Per vertex: 1 hard against the bank, 0 out in open water. Empty when the
   * caller asked for no shore band, or when the outline was too tight to inset
   * one into. The renderer turns it into vertex colours; keeping it a bare
   * number here is what stops the geometry layer from having to know a colour.
   */
  readonly shoreFactors: readonly number[];
}

function polygonSignedArea(polygon: readonly GameCanvasPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += point.x * next.z - next.x * point.z;
  }
  return twiceArea / 2;
}

function pointInTriangle(
  point: GameCanvasPoint,
  first: GameCanvasPoint,
  second: GameCanvasPoint,
  third: GameCanvasPoint,
): boolean {
  const cross = (a: GameCanvasPoint, b: GameCanvasPoint, p: GameCanvasPoint) =>
    (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const one = cross(first, second, point);
  const two = cross(second, third, point);
  const three = cross(third, first, point);
  return one >= -1e-7 && two >= -1e-7 && three >= -1e-7;
}

/** UV units per metre baked into the water tile's world-planar UVs. */
export const WATER_UV_PER_M = 0.025;

/**
 * Ear-clips one closed outline into upward-facing triangles, as indices into
 * `vertices` shifted by `offset`. Concave outlines are the whole reason this is
 * not a centre fan — a fan across a river bend bridges straight over the bank.
 *
 * **The triangle winding is what lights the water.** It is one flat sheet with
 * no relief for the eye to correct against, so its vertex normals come entirely
 * from the winding — get it backwards and `ComputeNormals` hands every vertex a
 * downward normal, the sun and the sky half of the hemispheric light both drop
 * out, and the Nile renders as the near-black slick that shipped for months.
 * Nothing culls it, so there is no missing-face symptom to notice; it just goes
 * dark. `tests/cairoVisuals.test.ts` pins the normals themselves.
 */
export function earClipPolygonIndices(
  polygon: readonly GameCanvasPoint[],
  offset = 0,
): number[] {
  const remaining = polygon.map((_, index) => index);
  if (polygonSignedArea(polygon) < 0) remaining.reverse();
  const indices: number[] = [];
  let guard = polygon.length * polygon.length;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      const a = polygon[previous];
      const b = polygon[current];
      const c = polygon[next];
      const turn =
        (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      if (turn <= 1e-7) continue;
      const containsVertex = remaining.some(
        (candidate) =>
          candidate !== previous &&
          candidate !== current &&
          candidate !== next &&
          pointInTriangle(polygon[candidate], a, b, c),
      );
      if (containsVertex) continue;
      // Emit the ear in the order the clipper walked it. Babylon's face normal
      // is `(p1 - p2) × (p3 - p2)`, whose y term is the *negation* of the x/z
      // cross product, so it is this counter-clockwise winding that faces up
      // and the reversed one — which is what shipped — that faces the riverbed.
      indices.push(previous, current, next);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    indices.push(remaining[0], remaining[1], remaining[2]);
  }
  if (indices.length !== (polygon.length - 2) * 3) {
    indices.length = 0;
    const counterClockwise =
      polygonSignedArea(polygon) > 0
        ? polygon.map((_, index) => index)
        : polygon.map((_, index) => index).reverse();
    for (let index = 1; index < counterClockwise.length - 1; index += 1) {
      indices.push(
        counterClockwise[0],
        counterClockwise[index],
        counterClockwise[index + 1],
      );
    }
  }
  return offset ? indices.map((index) => index + offset) : indices;
}

/** A corner sharper than this would spike its inset vertex out into open water. */
const WATER_INSET_MITER_LIMIT = 3;

/**
 * Walks a closed outline inward by `insetM`, mitered at the corners, or gives
 * up and returns undefined.
 *
 * Giving up is the point: a mitered inset is only well behaved while the offset
 * stays small against the local feature size, and there is no cheap general
 * answer for the cases where it isn't (a spit narrower than the band, a hairpin
 * corner) — it folds the outline inside out and the ring self-intersects. The
 * checks below are all cheap consequences of that folding, and a caller that
 * gets `undefined` simply goes without a shore band rather than rendering a
 * knot in the river.
 */
function insetWaterPolygon(
  polygon: readonly GameCanvasPoint[],
  insetM: number,
): GameCanvasPoint[] | undefined {
  const area = polygonSignedArea(polygon);
  if (!Number.isFinite(area) || area === 0) return undefined;
  // Edge normals point into the water, whichever way the outline was authored.
  const inward = area > 0 ? 1 : -1;
  const normals = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(next.x - point.x, next.z - point.z);
    if (length <= 1e-6) return undefined;
    return {
      x: (-(next.z - point.z) / length) * inward,
      z: ((next.x - point.x) / length) * inward,
    };
  });
  if (normals.some((normal) => !normal)) return undefined;

  const inset: GameCanvasPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const before = normals[(index - 1 + polygon.length) % polygon.length]!;
    const after = normals[index]!;
    const miterX = before.x + after.x;
    const miterZ = before.z + after.z;
    const miterLength = Math.hypot(miterX, miterZ);
    if (miterLength <= 1e-6) return undefined;
    const unitX = miterX / miterLength;
    const unitZ = miterZ / miterLength;
    // 1 / cos(half the corner angle): how much further the corner has to move
    // for both of its edges to end up `insetM` in.
    const stretch = 1 / (unitX * after.x + unitZ * after.z);
    if (!Number.isFinite(stretch) || stretch > WATER_INSET_MITER_LIMIT) {
      return undefined;
    }
    inset.push({
      x: polygon[index].x + unitX * insetM * stretch,
      z: polygon[index].z + unitZ * insetM * stretch,
    });
  }

  const insetArea = polygonSignedArea(inset);
  // Same handedness, genuinely smaller, and not eaten alive by its own band.
  if (Math.sign(insetArea) !== Math.sign(area)) return undefined;
  const ratio = Math.abs(insetArea) / Math.abs(area);
  if (ratio > 0.995 || ratio < 0.25) return undefined;
  // Every edge must still run the way it used to. A reversed one is a fold,
  // which the area test alone can miss when two folds cancel out.
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const originalX = polygon[next].x - polygon[index].x;
    const originalZ = polygon[next].z - polygon[index].z;
    const insetX = inset[next].x - inset[index].x;
    const insetZ = inset[next].z - inset[index].z;
    if (originalX * insetX + originalZ * insetZ <= 0) return undefined;
  }
  return inset;
}

/**
 * Builds the flat mesh for one authored water outline, optionally with a shore
 * band: a `shoreBandM`-wide ring of extra triangles just inside the bank, whose
 * vertices come back marked in `shoreFactors`.
 *
 * The ring exists because **every vertex of the bare outline is a bank vertex**,
 * so there is nowhere to hang an edge-darkening gradient — the interior has no
 * vertices at all. Inset one ring and the water gains an inner edge to fade to.
 */
export function buildWaterPolygonGeometry(
  source: readonly GameCanvasPoint[],
  y = 0.025,
  shoreBandM = 0,
): WaterPolygonGeometry {
  const polygon: GameCanvasPoint[] = [];
  for (const point of source) {
    const previous = polygon.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
      polygon.push({ x: point.x, z: point.z });
    }
  }
  if (
    polygon.length > 2 &&
    Math.hypot(
      polygon[0].x - polygon.at(-1)!.x,
      polygon[0].z - polygon.at(-1)!.z,
    ) <= 1e-6
  ) {
    polygon.pop();
  }
  if (polygon.length < 3) {
    return { polygon, positions: [], indices: [], uvs: [], shoreFactors: [] };
  }

  const inset =
    shoreBandM > 0 ? insetWaterPolygon(polygon, shoreBandM) : undefined;
  const vertices = inset ? [...polygon, ...inset] : polygon;
  const indices: number[] = [];
  if (inset) {
    // The ring, one quad per bank edge. Walking the outline in its own
    // direction and closing back along the inset keeps each quad wound like
    // the outline itself, so an anticlockwise outline needs no fix-up and a
    // clockwise one takes the mirrored triangle pair.
    const clockwise = polygonSignedArea(polygon) < 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const next = (index + 1) % polygon.length;
      const outerA = index;
      const outerB = next;
      const innerA = polygon.length + index;
      const innerB = polygon.length + next;
      if (clockwise) {
        indices.push(outerA, innerB, outerB, outerA, innerA, innerB);
      } else {
        indices.push(outerA, outerB, innerB, outerA, innerB, innerA);
      }
    }
  }
  indices.push(
    ...earClipPolygonIndices(inset ?? polygon, inset ? polygon.length : 0),
  );

  const positions = vertices.flatMap((point) => [point.x, y, point.z]);
  const uvs = vertices.flatMap((point) => [
    point.x * WATER_UV_PER_M,
    point.z * WATER_UV_PER_M,
  ]);
  const shoreFactors = inset
    ? vertices.map((_, index) => (index < polygon.length ? 1 : 0))
    : [];
  return { polygon, positions, indices, uvs, shoreFactors };
}

export interface WaterBoatPlacement {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly variant: 0 | 1 | 2;
  /** Safe travel interval along heading, inset from the authored shoreline. */
  readonly trackStartM: number;
  readonly trackLengthM: number;
  /** Stable visual phase/speed; these never consume simulation randomness. */
  readonly phase: number;
  readonly speedMps: number;
}

export interface WaterBoatPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly roll: number;
}

function distanceToPolygonEdges(
  point: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSq = dx * dx + dz * dz;
    const along =
      lengthSq > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSq,
            ),
          )
        : 0;
    nearest = Math.min(
      nearest,
      Math.hypot(
        point.x - (start.x + dx * along),
        point.z - (start.z + dz * along),
      ),
    );
  }
  return nearest;
}

function rayDistanceToPolygonEdge(
  origin: GameCanvasPoint,
  direction: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edgeX = end.x - start.x;
    const edgeZ = end.z - start.z;
    const denominator = direction.x * edgeZ - direction.z * edgeX;
    if (Math.abs(denominator) < 1e-8) continue;
    const offsetX = start.x - origin.x;
    const offsetZ = start.z - origin.z;
    const rayDistance = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
    const edgeAmount =
      (offsetX * direction.z - offsetZ * direction.x) / denominator;
    if (
      rayDistance >= 0 &&
      edgeAmount >= -1e-8 &&
      edgeAmount <= 1 + 1e-8
    ) {
      nearest = Math.min(nearest, rayDistance);
    }
  }
  return nearest;
}

/**
 * What a boat track must never cross. The two drivable Nile bridges have no
 * underside at all — their road surface IS the deck, at water level — so no
 * craft passes them at any mast height; their over-water spans are hard
 * walls. The elevated expressway is the opposite: its soffit clears every
 * mast, and only its pier columns need avoiding.
 */
export interface WaterBoatObstacles {
  readonly spans: readonly {
    readonly x: number;
    readonly z: number;
    readonly ux: number;
    readonly uz: number;
    readonly halfLengthM: number;
    readonly halfWidthM: number;
  }[];
  readonly piers: readonly {
    readonly x: number;
    readonly z: number;
    readonly radiusM: number;
  }[];
}

/** Hull lengths per variant: motor skiff, felucca, tour boat. */
export const WATER_BOAT_LENGTHS_M = [4.6, 6.5, 6.2] as const;
/** Highest point above the waterline per variant — the felucca's masthead at
 * its 6.5 m hull is 5.7 m, under the elevated deck soffit
 * (CAIRO_ELEVATED_DECK_Y − thickness/2 = 6.84). */
export const WATER_BOAT_AIR_DRAFTS_M = [1.1, 5.7, 1.5] as const;
/** Track clearance around obstacles: the widest half-beam plus water room. */
export const WATER_BOAT_CLEARANCE_M = 3.6;
/** Per-variant craft glbs: motor skiff, felucca, tour boat (the skiff again
 * at a longer hull). Cairo-only files; CREDITS.md logs their provenance. */
export const WATER_BOAT_MODEL_URLS = [
  "/models/props/cairo-skiff.glb",
  "/models/props/cairo-felucca.glb",
  "/models/props/cairo-skiff.glb",
] as const;
/** How deep each hull sits below the waterline pose. */
export const WATER_BOAT_DRAUGHT_M = 0.3;
export const CAIRO_ELEVATED_DECK_Y = 7.2;
export const CAIRO_ELEVATED_DECK_THICKNESS_M = 0.72;
export const CAIRO_ELEVATED_PIER_RADIUS_M = 0.825;

export interface CairoBridgeVisualAxis {
  readonly center: GameCanvasPoint;
  readonly lengthM: number;
  readonly widthM: number;
  /** Compass direction along the long axis, clockwise from +z. */
  readonly headingRad: number;
  /** Babylon yaw when the mesh's long dimension is local +x. */
  readonly boxYawRad: number;
}

/**
 * Keeps scenic parapets on the same axis as the road portal. A same-id road
 * surface is authoritative; authored heading covers visual-only structures
 * such as the elevated expressway, which deliberately has no road.
 */
export function cairoBridgeVisualAxis(
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): CairoBridgeVisualAxis {
  const surface = roadSurfaces.find((candidate) => candidate.id === landmark.id);
  const surfaceStart = surface?.centerline[0];
  const surfaceEnd = surface?.centerline.at(-1);
  const surfaceHeading =
    surfaceStart && surfaceEnd
      ? Math.atan2(
          surfaceEnd.x - surfaceStart.x,
          surfaceEnd.z - surfaceStart.z,
        )
      : undefined;
  const longX = landmark.size.x >= landmark.size.z;
  const headingRad =
    surfaceHeading ??
    (landmark.headingDeg !== undefined
      ? degreesToRadians(landmark.headingDeg)
      : longX
        ? Math.PI / 2
        : 0);
  return {
    center: landmark.center,
    lengthM: Math.max(landmark.size.x, landmark.size.z),
    widthM: Math.min(landmark.size.x, landmark.size.z),
    headingRad,
    boxYawRad: headingRad - Math.PI / 2,
  };
}

/**
 * Restricts a drivable bridge's decorative rails to its over-water deck.
 * Bridge road surfaces continue to the neighbouring junction nodes, but rails
 * must stop at the shore instead of crossing the shoreline carriageways.
 */
export function cairoBridgePortalVisualAxis(
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
  waterBodies: NonNullable<GameCanvasMapPack["geometry"]["waterBodies"]>,
): CairoBridgeVisualAxis {
  const fallback = cairoBridgeVisualAxis(landmark, roadSurfaces);
  const surface = roadSurfaces.find((candidate) => candidate.id === landmark.id);
  const water = waterBodies.find((candidate) =>
    candidate.bridgePortalSurfaceIds?.includes(landmark.id),
  );
  const segmentStart = surface?.centerline[0];
  const segmentEnd = surface?.centerline.at(-1);
  if (!surface || !water || !segmentStart || !segmentEnd) return fallback;

  const longest = bridgePortalRailSpans(water, surface).reduce<
    ReturnType<typeof bridgePortalRailSpans>[number] | undefined
  >(
    (current, candidate) =>
      !current || candidate.halfLengthM > current.halfLengthM
        ? candidate
        : current,
    undefined,
  );
  if (!longest || longest.halfLengthM < 0.5) return fallback;

  const headingRad = Math.atan2(longest.ux, longest.uz);
  const sidewalkWidthM = Math.max(0, surface.sidewalkWidthM ?? 0);
  return {
    center: longest.center,
    lengthM: longest.halfLengthM * 2,
    widthM:
      surface.widthM +
      2 * (sidewalkWidthM + BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M),
    headingRad,
    boxYawRad: headingRad - Math.PI / 2,
  };
}

export interface CairoElevatedPierPlacement {
  readonly index: number;
  readonly alongM: number;
  readonly position: GameCanvasPoint;
}

/**
 * Uniform elevated-bridge supports with deterministic omissions wherever a
 * column would stand in an authored carriageway.
 */
export function cairoElevatedBridgePierPlacements(
  axis: CairoBridgeVisualAxis,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): readonly CairoElevatedPierPlacement[] {
  const pierCount = Math.max(5, Math.floor(axis.lengthM / 46));
  const directionX = Math.sin(axis.headingRad);
  const directionZ = Math.cos(axis.headingRad);
  const columnClearanceM = 1.15;
  const placements: CairoElevatedPierPlacement[] = [];
  for (let index = 0; index <= pierCount; index += 1) {
    const alongM = -axis.lengthM / 2 + (index / pierCount) * axis.lengthM;
    const position = {
      x: axis.center.x + directionX * alongM,
      z: axis.center.z + directionZ * alongM,
    };
    const blocksRoad = roadSurfaces.some((surface) => {
      const nearest = nearestPointOnPolyline(position, surface.centerline);
      return (
        Math.hypot(position.x - nearest.x, position.z - nearest.z) <
        surface.widthM / 2 + columnClearanceM
      );
    });
    if (!blocksRoad) placements.push({ index, alongM, position });
  }
  return placements;
}


/** The obstacle set for one water body, shared verbatim by the renderer and
 * the tests so neither can drift from what the boats actually avoid. */
export function cairoWaterBoatObstacles(
  geometry: {
    readonly roadSurfaces?: GameCanvasMapPack["geometry"]["roadSurfaces"];
    readonly landmarks?: GameCanvasMapPack["geometry"]["landmarks"];
  },
  body: GameCanvasWaterBody,
): WaterBoatObstacles {
  const spans: WaterBoatObstacles["spans"][number][] = [];
  for (const surfaceId of body.bridgePortalSurfaceIds ?? []) {
    const surface = geometry.roadSurfaces?.find(
      (candidate) => candidate.id === surfaceId,
    );
    if (!surface) continue;
    for (const span of bridgePortalRailSpans(body, surface)) {
      spans.push({
        x: span.center.x,
        z: span.center.z,
        ux: span.ux,
        uz: span.uz,
        halfLengthM: span.halfLengthM,
        halfWidthM: surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8),
      });
    }
  }
  const piers: WaterBoatObstacles["piers"][number][] = [];
  const scenic = geometry.landmarks?.find(
    (landmark) => landmark.id === "cairo-sixth-october-bridge",
  );
  if (scenic) {
    const axis = cairoBridgeVisualAxis(scenic, geometry.roadSurfaces ?? []);
    for (const pier of cairoElevatedBridgePierPlacements(
      axis,
      geometry.roadSurfaces ?? [],
    )) {
      piers.push({
        x: pier.position.x,
        z: pier.position.z,
        radiusM: CAIRO_ELEVATED_PIER_RADIUS_M,
      });
    }
  }
  return { spans, piers };
}

function rayObstacleDistance(
  origin: GameCanvasPoint,
  direction: GameCanvasPoint,
  obstacles: WaterBoatObstacles | undefined,
): number {
  if (!obstacles) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const span of obstacles.spans) {
    // Slab test in the span's own frame, inflated by the boat clearance.
    const vx = -span.uz;
    const vz = span.ux;
    const halfU = span.halfLengthM + WATER_BOAT_CLEARANCE_M;
    const halfV = span.halfWidthM + WATER_BOAT_CLEARANCE_M;
    const ou = (origin.x - span.x) * span.ux + (origin.z - span.z) * span.uz;
    const ov = (origin.x - span.x) * vx + (origin.z - span.z) * vz;
    const du = direction.x * span.ux + direction.z * span.uz;
    const dv = direction.x * vx + direction.z * vz;
    let enter = -Infinity;
    let exit = Infinity;
    let miss = false;
    for (const [offset, delta, half] of [
      [ou, du, halfU],
      [ov, dv, halfV],
    ] as const) {
      if (Math.abs(delta) < 1e-9) {
        if (Math.abs(offset) > half) miss = true;
        continue;
      }
      const t0 = (-half - offset) / delta;
      const t1 = (half - offset) / delta;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    if (!miss && enter <= exit && exit > 0) {
      nearest = Math.min(nearest, Math.max(0, enter));
    }
  }
  for (const pier of obstacles.piers) {
    const radius = pier.radiusM + WATER_BOAT_CLEARANCE_M;
    const ox = origin.x - pier.x;
    const oz = origin.z - pier.z;
    const b = ox * direction.x + oz * direction.z;
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const tNear = -b - root;
    const tFar = -b + root;
    if (tFar > 0) nearest = Math.min(nearest, Math.max(0, tNear));
  }
  return nearest;
}

/** Stable visual-only Nile traffic; never consumes the simulation PRNG. */
export function generateWaterBoatPlacements(
  mapId: string,
  body: GameCanvasWaterBody,
  obstacles?: WaterBoatObstacles,
): readonly WaterBoatPlacement[] {
  const polygon = buildWaterPolygonGeometry(body.polygon).polygon;
  if (polygon.length < 3) return [];
  const xs = polygon.map((point) => point.x);
  const zs = polygon.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const area = Math.abs(polygonSignedArea(polygon));
  const wanted = Math.max(1, Math.min(5, Math.round(area / 28_000)));
  const random = seededUnit(hashStringToSeed(`${mapId}-${body.id}-boats`));
  const defaultHeadingDeg =
    maxZ - minZ >= maxX - minX ? 0 : 90;
  const placements: WaterBoatPlacement[] = [];
  for (let attempt = 0; attempt < wanted * 32 && placements.length < wanted; attempt += 1) {
    const candidate = {
      x: minX + random() * (maxX - minX),
      z: minZ + random() * (maxZ - minZ),
    };
    if (
      !isPointInPolygon(candidate, polygon) ||
      distanceToPolygonEdges(candidate, polygon) < 7 ||
      placements.some(
        (placement) =>
          Math.hypot(placement.x - candidate.x, placement.z - candidate.z) < 28,
      )
    ) {
      continue;
    }
    const heading =
      ((body.flowHeadingDeg ?? defaultHeadingDeg) * Math.PI) / 180 +
      (random() - 0.5) * 0.22;
    const direction = { x: Math.sin(heading), z: Math.cos(heading) };
    // A candidate already inside an obstacle's clearance can never sail out.
    if (rayObstacleDistance(candidate, direction, obstacles) === 0) continue;
    const forward = Math.min(
      rayDistanceToPolygonEdge(candidate, direction, polygon),
      rayObstacleDistance(candidate, direction, obstacles),
    );
    const reverse = { x: -direction.x, z: -direction.z };
    const backward = Math.min(
      rayDistanceToPolygonEdge(candidate, reverse, polygon),
      rayObstacleDistance(candidate, reverse, obstacles),
    );
    const trackStartM = -(backward - 7);
    const trackLengthM = forward + backward - 14;
    if (
      !Number.isFinite(trackLengthM) ||
      trackLengthM < 24
    ) {
      continue;
    }
    const variant = Math.floor(random() * 3) as 0 | 1 | 2;
    placements.push({
      ...candidate,
      heading,
      variant,
      trackStartM,
      trackLengthM,
      phase: random(),
      // Motor launch, felucca, tour boat: restrained and intentionally
      // different speeds, with only a small stable per-craft variation.
      speedMps: [1.45, 0.72, 1.05][variant] * (0.9 + random() * 0.2),
    });
  }
  return placements;
}

/** Ping-pong pose keeps craft inside their authored channel without teleporting. */
export function waterBoatPoseAt(
  placement: WaterBoatPlacement,
  visualTimeSeconds: number,
): WaterBoatPose {
  const cycleLength = placement.trackLengthM * 2;
  const cycleDistance =
    ((placement.phase * cycleLength +
      Math.max(0, visualTimeSeconds) * placement.speedMps) %
      cycleLength +
      cycleLength) %
    cycleLength;
  const returning = cycleDistance > placement.trackLengthM;
  const trackDistance = returning
    ? cycleLength - cycleDistance
    : cycleDistance;
  const along = placement.trackStartM + trackDistance;
  const directionX = Math.sin(placement.heading);
  const directionZ = Math.cos(placement.heading);
  const wavePhase =
    visualTimeSeconds * (placement.variant === 1 ? 0.74 : 1.12) +
    placement.phase * Math.PI * 2;
  return {
    x: placement.x + directionX * along,
    y: 0.04 + Math.sin(wavePhase) * 0.035,
    z: placement.z + directionZ * along,
    heading: placement.heading + (returning ? Math.PI : 0),
    roll: Math.sin(wavePhase * 0.73 + 0.8) * 0.018,
  };
}
