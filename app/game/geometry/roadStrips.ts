import type { GameCanvasPoint } from "../sessionContract";

/**
 * Road-surface strip meshes and junction fills: turning an authored
 * centreline into watertight top-surface geometry, and paving the outline
 * where independently-authored surfaces share a node.
 *
 * Pure by design — no Babylon, no DOM — so the geometry math (mitering,
 * kerb rounding, junction outline tracing) can be pinned in plain node
 * tests without instantiating a scene. `tests/architecture.test.ts` enforces
 * that this stays true for every file under `geometry/`.
 */

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const ROAD_POINT_EPSILON_M = 0.08;

const MAX_ROAD_MITER_RATIO = 3.25;
// Junctions get a kerb radius: real corners curve so a turning vehicle can hold
// its line, and the pavement wraps that curve. Capped well inside the sidewalk
// band so the rounded asphalt never eats through to the buildings behind it.
const JUNCTION_KERB_MAX_RADIUS_M = 3.5;
const JUNCTION_KERB_ARC_STEPS = 4;
// Below this the corner is a gore, not a street corner, and stays a sharp point.
const JUNCTION_KERB_MIN_WEDGE_RAD = (70 * Math.PI) / 180;
/**
 * How nearly opposite two legs have to be for the road to count as running
 * straight THROUGH the node rather than turning at it — 25 degrees of slack,
 * the same tolerance the park walls use to tell alongside from crossing.
 * Bayswater Road bends 1.6 degrees into Notting Hill Gate; a genuine corner on
 * this map is never shallower than 45.
 */
const STRAIGHT_THROUGH_COS = Math.cos((25 * Math.PI) / 180);

export interface RoadSurfaceStripGeometry {
  /** Two vertices per authored centreline point: positive and negative lateral offsets. */
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly closed: boolean;
}

export interface RoadJunctionSource {
  readonly id: string;
  readonly centerline: readonly GameCanvasPoint[];
  readonly widthM: number;
}

export interface RoadJunctionFill {
  /**
   * The junction outline, walked in heading order. Deliberately not convex: a
   * crossroads is a plus, not a blob, and its corners are rounded off by a kerb
   * radius. Every vertex is visible from `pivot`, so it fan-triangulates from
   * there without needing a general polygon triangulator.
   */
  readonly polygon: readonly GameCanvasPoint[];
  /** The shared node the outline is fanned around. */
  readonly pivot: GameCanvasPoint;
  /**
   * Every surface with an arm in this fill — including adopted ones, whose
   * centreline never touches the pivot. The walkability test derives its
   * width bound from this rather than re-matching by proximity.
   */
  readonly surfaceIds: readonly string[];
}

type RoadDirection = Readonly<{ x: number; z: number }>;

function roadPointDistance(
  first: GameCanvasPoint,
  second: GameCanvasPoint,
): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function normalizeRoadDirection(
  vector: RoadDirection,
): RoadDirection | null {
  const length = Math.hypot(vector.x, vector.z);
  return length > 0.0001
    ? { x: vector.x / length, z: vector.z / length }
    : null;
}

function roadLateral(direction: RoadDirection): RoadDirection {
  return { x: direction.z, z: -direction.x };
}

function dotRoadDirections(first: RoadDirection, second: RoadDirection): number {
  return first.x * second.x + first.z * second.z;
}

/**
 * Nearest point on a polyline to a query point. Used to anchor stop bars to the
 * road's centreline rather than the offset lane centreline, so a two-way road's
 * bar can start exactly at the centre line instead of painting across it.
 */
export function nearestPointOnPolyline(
  query: GameCanvasPoint,
  polyline: readonly GameCanvasPoint[],
): GameCanvasPoint {
  let best: GameCanvasPoint = polyline[0] ?? query;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((query.x - start.x) * dx + (query.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const point = { x: start.x + dx * t, z: start.z + dz * t };
    const distance = Math.hypot(query.x - point.x, query.z - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * Heading (radians, 0 = +z north) of the polyline segment nearest the query
 * point, or null when the polyline has no usable segment.
 */
export function roadAxisHeadingNear(
  polyline: readonly GameCanvasPoint[],
  query: GameCanvasPoint,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= 0) continue;
    const t = Math.max(
      0,
      Math.min(1, ((query.x - start.x) * dx + (query.z - start.z) * dz) / lengthSquared),
    );
    const distance = Math.hypot(
      query.x - (start.x + dx * t),
      query.z - (start.z + dz * t),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = Math.atan2(dx, dz);
    }
  }
  return best;
}

/** Removes authored duplicate points while retaining the fact that a path is closed. */
function normalizeRoadCenterline(
  points: readonly GameCanvasPoint[],
): { readonly points: readonly GameCanvasPoint[]; readonly closed: boolean } {
  const compact: GameCanvasPoint[] = [];
  for (const point of points) {
    if (!compact.length || roadPointDistance(compact.at(-1)!, point) > ROAD_POINT_EPSILON_M) {
      compact.push(point);
    }
  }
  const closed =
    compact.length > 2 &&
    roadPointDistance(compact[0], compact.at(-1)!) <= ROAD_POINT_EPSILON_M;
  if (closed) compact.pop();
  return { points: compact, closed };
}

/**
 * Smooths only the visual roundabout centreline. The simulation continues to
 * use its authored lane graph, while the low-poly asphalt reads as a proper
 * continuous ring instead of an octagon made from separate boxes.
 */
export function smoothClosedRoadCenterline(
  points: readonly GameCanvasPoint[],
  subdivisions = 4,
): readonly GameCanvasPoint[] {
  const normalized = normalizeRoadCenterline(points);
  const source = normalized.points;
  if (!normalized.closed || source.length < 3 || subdivisions < 1) return source;

  const result: GameCanvasPoint[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const previous = source[(index - 1 + source.length) % source.length];
    const start = source[index];
    const end = source[(index + 1) % source.length];
    const next = source[(index + 2) % source.length];
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x:
          0.5 *
          ((2 * start.x) +
            (-previous.x + end.x) * t +
            (2 * previous.x - 5 * start.x + 4 * end.x - next.x) * t2 +
            (-previous.x + 3 * start.x - 3 * end.x + next.x) * t3),
        z:
          0.5 *
          ((2 * start.z) +
            (-previous.z + end.z) * t +
            (2 * previous.z - 5 * start.z + 4 * end.z - next.z) * t2 +
            (-previous.z + 3 * start.z - 3 * end.z + next.z) * t3),
      });
    }
  }
  return result;
}

/**
 * Builds one watertight top surface for a road polyline. Unlike a chain of
 * boxes, mitered offsets share vertices at every bend so grass cannot show
 * through chipped joins.
 */
export function buildRoadSurfaceStripGeometry(
  sourcePoints: readonly GameCanvasPoint[],
  widthM: number,
  closedOverride?: boolean,
): RoadSurfaceStripGeometry {
  const normalized = normalizeRoadCenterline(sourcePoints);
  const points = normalized.points;
  const closed = closedOverride ?? normalized.closed;
  if (points.length < 2 || widthM <= 0) {
    return { positions: [], indices: [], closed };
  }

  const directions: RoadDirection[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const direction = normalizeRoadDirection({ x: end.x - start.x, z: end.z - start.z });
    if (!direction) return { positions: [], indices: [], closed };
    directions.push(direction);
  }

  const halfWidth = widthM / 2;
  const positions: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const incoming =
      index === 0 && !closed
        ? directions[0]
        : directions[(index - 1 + directions.length) % directions.length];
    const outgoing =
      index === points.length - 1 && !closed
        ? directions.at(-1)!
        : directions[index % directions.length];
    const incomingLateral = roadLateral(incoming);
    const outgoingLateral = roadLateral(outgoing);
    const miter = normalizeRoadDirection({
      x: incomingLateral.x + outgoingLateral.x,
      z: incomingLateral.z + outgoingLateral.z,
    });
    const alignment = miter ? dotRoadDirections(miter, outgoingLateral) : 0;
    const miterLength =
      miter && alignment > 0.12
        ? Math.min(halfWidth / alignment, halfWidth * MAX_ROAD_MITER_RATIO)
        : halfWidth;
    const lateral = miter
      ? { x: miter.x * miterLength, z: miter.z * miterLength }
      : { x: outgoingLateral.x * halfWidth, z: outgoingLateral.z * halfWidth };
    const point = points[index];
    positions.push(
      point.x + lateral.x,
      0,
      point.z + lateral.z,
      point.x - lateral.x,
      0,
      point.z - lateral.z,
    );
  }

  const indices: number[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const next = (index + 1) % points.length;
    const positive = index * 2;
    const negative = positive + 1;
    const nextPositive = next * 2;
    const nextNegative = nextPositive + 1;
    indices.push(
      positive,
      nextPositive,
      negative,
      negative,
      nextPositive,
      nextNegative,
    );
  }
  return { positions, indices, closed };
}

/** One carriageway leaving a shared node, as the junction outline sees it. */
interface RoadJunctionLeg {
  readonly direction: RoadDirection;
  /** Unit normal pointing at the next leg round the node in heading order. */
  readonly lateral: RoadDirection;
  /** The leg's own centreline point. Usually the cluster pivot, but an arm
   * adopted from a surface whose authored end sits off the shared node
   * (Cromwell Road's recentred dual carriageway) keeps its own origin so the
   * kerb-corner math stays exact — the same contract as `PavementLeg.origin`
   * in `pavementPaths.ts`. */
  readonly origin: GameCanvasPoint;
  readonly half: number;
  readonly reach: number;
}

/**
 * Where leg `a`'s near-side kerb meets leg `b`'s, as a distance along each leg
 * from the node. Both distances positive is a street corner — the kerbs close
 * in front of the node. Both negative is the outside of a bend: the kerbs only
 * meet behind the node, at the miter point that squares the turn off. Null when
 * they are parallel and never meet at all.
 */
function junctionKerbCorner(
  a: RoadJunctionLeg,
  b: RoadJunctionLeg,
): { alongA: number; alongB: number } | null {
  // The origin deltas are zero whenever both legs sit on the shared node —
  // every junction except an adopted off-node arm. Mirror of `railCorner`.
  const offsetX =
    b.origin.x - a.origin.x - b.lateral.x * b.half - a.lateral.x * a.half;
  const offsetZ =
    b.origin.z - a.origin.z - b.lateral.z * b.half - a.lateral.z * a.half;
  const determinant = b.direction.x * a.direction.z - a.direction.x * b.direction.z;
  if (Math.abs(determinant) < 1e-6) return null;
  return {
    alongA: (b.direction.x * offsetZ - offsetX * b.direction.z) / determinant,
    alongB: (a.direction.x * offsetZ - offsetX * a.direction.z) / determinant,
  };
}

/**
 * The vertices that carry the outline from leg `a` round to leg `b`: a rounded
 * kerb at a street corner, a bare point at a gore too sharp to round, a miter
 * on the outside of a bend — where two surfaces meeting end-on leave a notch
 * of bare ground that a single mitered strip would never have had — and a
 * chamfer across the node when the kerbs are parallel or the corner runs away
 * to somewhere too far off to be a corner at all.
 */
function junctionCornerVertices(
  a: RoadJunctionLeg,
  b: RoadJunctionLeg,
  kerbRadiusM: number,
): GameCanvasPoint[] {
  const at = (leg: RoadJunctionLeg, lateralSign: number, along: number) => ({
    x:
      leg.origin.x +
      leg.lateral.x * leg.half * lateralSign +
      leg.direction.x * along,
    z:
      leg.origin.z +
      leg.lateral.z * leg.half * lateralSign +
      leg.direction.z * along,
  });
  const chamfer = [at(a, 1, 0), at(b, -1, 0)];
  // Two legs pointing away from each other are one road running THROUGH the
  // node, not a corner. If they are also different widths the chamfer puts
  // both kerb offsets at the node itself, so the kerb line jumps the width
  // difference over the few centimetres between them: at Bayswater Road's
  // west end (10.4 m) meeting Notting Hill Gate (9 m) at a 1.6-degree bend
  // that is a 0.7 m step in the middle of an otherwise straight pavement,
  // which play-tested as "the sidewalk suddenly breaks and is not meshing
  // nicely with the rest of it". Bridging straight from one arm's outer
  // corner to the other's spreads the same 0.7 m over the fill's whole
  // length, where it reads as the taper a real street would have.
  if (dotRoadDirections(a.direction, b.direction) <= -STRAIGHT_THROUGH_COS) {
    return [];
  }
  const meeting = junctionKerbCorner(a, b);
  if (!meeting) return chamfer;
  if (meeting.alongA < 1e-3 && meeting.alongB < 1e-3) {
    const miter = at(a, 1, meeting.alongA);
    // Same guard the strip mitering uses: past this a near-hairpin would throw
    // out a long spike instead of squaring off a turn.
    return Math.hypot(miter.x - a.origin.x, miter.z - a.origin.z) <=
      Math.min(a.half, b.half) * MAX_ROAD_MITER_RATIO
      ? [miter]
      : chamfer;
  }
  if (meeting.alongA < 1e-3 || meeting.alongB < 1e-3) return chamfer;
  // The kerbs meet beyond where this fill ends, so these two carriageways are
  // still overlapping at its edge — there is no inner corner inside the fill to
  // round off. Bridge straight between the arms' outer corners: chamfering here
  // would cut back to within `half` of the node, notching paved surface out of
  // the throat of an acute fork and doubling the outline back on itself.
  if (meeting.alongA > a.reach || meeting.alongB > b.reach) return [];
  const corner = at(a, 1, meeting.alongA);
  const wedge = Math.acos(
    clamp(dotRoadDirections(a.direction, b.direction), -1, 1),
  );
  const tangent = Math.tan(wedge / 2);
  const radius = Math.min(
    kerbRadiusM,
    Math.min(a.half, b.half) * 0.6,
    Math.min(meeting.alongA, meeting.alongB) * 0.5,
    // The arc's tangent points have to stay on the kerbs they round off.
    Math.min(a.reach - meeting.alongA, b.reach - meeting.alongB) * tangent,
  );
  if (wedge < JUNCTION_KERB_MIN_WEDGE_RAD || radius < 0.2) return [corner];
  const setback = radius / tangent;
  const start = {
    x: corner.x + a.direction.x * setback,
    z: corner.z + a.direction.z * setback,
  };
  const end = {
    x: corner.x + b.direction.x * setback,
    z: corner.z + b.direction.z * setback,
  };
  const bisector = normalizeRoadDirection({
    x: a.direction.x + b.direction.x,
    z: a.direction.z + b.direction.z,
  });
  if (!bisector) return [corner];
  const centreX = corner.x + (bisector.x * radius) / Math.sin(wedge / 2);
  const centreZ = corner.z + (bisector.z * radius) / Math.sin(wedge / 2);
  const startAngle = Math.atan2(start.z - centreZ, start.x - centreX);
  let sweep = Math.atan2(end.z - centreZ, end.x - centreX) - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc: GameCanvasPoint[] = [];
  for (let step = 0; step <= JUNCTION_KERB_ARC_STEPS; step += 1) {
    const angle = startAngle + (sweep * step) / JUNCTION_KERB_ARC_STEPS;
    arc.push({
      x: centreX + Math.cos(angle) * radius,
      z: centreZ + Math.sin(angle) * radius,
    });
  }
  return arc;
}

/**
 * Paves each junction where independently-authored road surfaces share a node
 * (a side street meeting an avenue, a roundabout approach, a spliced segment).
 *
 * The fill traces the junction's actual outline: out along one carriageway to
 * its reach, across, back down its far kerb, round the corner into the next
 * carriageway, and so on round the node. That shape matters — a crossroads is a
 * plus, and anything blobbier (a convex hull, say) swallows the four pavement
 * corners between the arms and paves the very spot the traffic-light pole and
 * the waiting pedestrians stand on.
 *
 * Each arm reaches into the crossing by the WIDEST half-width present at the
 * node, not just its own, so the fill clears every crossing kerb rather than
 * stopping short and leaving the shoulder to show through as a wedge.
 * `lateralInflationM` widens the sections to build the matching shoulder fill
 * that underlies the paved junction. That one passes `kerbRadiusM` of 0: a kerb
 * radius rounds a corner *outwards*, which is what the carriageway wants and
 * the exact opposite of what the pavement wants — rounding the shoulder fill
 * would balloon the footway out past the building line at every block corner.
 */
/** Two ring points closer than this in bearing are the same corner twice. */
const JUNCTION_RING_BEARING_EPSILON_RAD = 1e-4;

/**
 * Orders a traced junction outline into a ring the pivot can see all of.
 *
 * The fill is drawn as a triangle fan from the shared node, which is only valid
 * if the boundary is star-shaped about it. Tracing leg by leg in heading order
 * gives that for free when the legs are properly separated — but where two
 * arms fork at an acute angle they still overlap at the fill's edge, so one
 * arm's outer corner sits *behind* the next arm's in bearing and the outline
 * doubles back. Fanning that folds triangles over each other: they z-fight,
 * and the ones that come out wound backwards face down and light black.
 *
 * Sorting by bearing restores the invariant. For a well-formed junction the
 * trace is already in bearing order, so this returns it unchanged; where two
 * points share a bearing the farther one wins, which is the one that keeps the
 * carriageway paved.
 */
function starShapedRing(
  pivot: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): GameCanvasPoint[] {
  const ordered = polygon
    .map((point) => ({
      point,
      bearing: Math.atan2(point.z - pivot.z, point.x - pivot.x),
      radius: Math.hypot(point.x - pivot.x, point.z - pivot.z),
    }))
    .filter((entry) => entry.radius > 1e-6)
    // Descending, to keep the winding the leg walk already produced.
    .sort(
      (first, second) =>
        second.bearing - first.bearing || second.radius - first.radius,
    );
  const ring: typeof ordered = [];
  for (const entry of ordered) {
    const previous = ring[ring.length - 1];
    if (
      previous &&
      previous.bearing - entry.bearing <= JUNCTION_RING_BEARING_EPSILON_RAD
    ) {
      continue;
    }
    ring.push(entry);
  }
  // The seam wraps, so the last point can still double the first.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length > 2 &&
    first &&
    last &&
    first.bearing + 2 * Math.PI - last.bearing <= JUNCTION_RING_BEARING_EPSILON_RAD
  ) {
    ring.pop();
  }
  return ring.map((entry) => entry.point);
}

export function collectRoadJunctionFills(
  surfaces: readonly RoadJunctionSource[],
  lateralInflationM = 0,
  kerbRadiusM = JUNCTION_KERB_MAX_RADIUS_M,
): readonly RoadJunctionFill[] {
  const clusters: Array<{
    x: number;
    z: number;
    surfaceIds: Set<string>;
    maxHalf: number;
    arms: Array<{
      half: number;
      node: GameCanvasPoint;
      neighbours: GameCanvasPoint[];
    }>;
  }> = [];
  // Pass 1: gather every centreline point into shared-node clusters, recording
  // the widest half-width that meets there so the reach can clear it.
  for (const surface of surfaces) {
    const { points, closed } = normalizeRoadCenterline(surface.centerline);
    const half = surface.widthM / 2 + lateralInflationM;
    for (let index = 0; index < points.length; index += 1) {
      const node = points[index];
      let cluster = clusters.find(
        (candidate) =>
          Math.hypot(candidate.x - node.x, candidate.z - node.z) <=
          ROAD_POINT_EPSILON_M,
      );
      if (!cluster) {
        cluster = {
          x: node.x,
          z: node.z,
          surfaceIds: new Set(),
          maxHalf: 0,
          arms: [],
        };
        clusters.push(cluster);
      }
      cluster.surfaceIds.add(surface.id);
      cluster.maxHalf = Math.max(cluster.maxHalf, half);
      // A closed ring wraps, so its seam node has a carriageway either side of
      // it like any other — miss that and a roundabout is left with a bite out
      // of it exactly where an approach joins.
      const neighbours: GameCanvasPoint[] = [];
      if (index > 0) neighbours.push(points[index - 1]);
      else if (closed) neighbours.push(points[points.length - 1]);
      if (index < points.length - 1) neighbours.push(points[index + 1]);
      else if (closed) neighbours.push(points[0]);
      cluster.arms.push({ half, node, neighbours });
    }
  }
  // Adoption pass, mirroring `buildPavementGraph`: a road whose authored END
  // sits a little off a shared node (Cromwell Road's recentred dual
  // carriageway ends 1.7 m from the junctions it visually merges into) still
  // physically overlaps that junction. Without this the fill is traced as if
  // the wide carriageway were not there, and its kerb line steps where the
  // fill's flank crosses the wide mouth. Adoption only appends arms to
  // clusters that are already junctions, so the fill count, order, pivots and
  // mesh names never move — and the pavement parity invariant stays provable.
  for (const surface of surfaces) {
    const { points, closed } = normalizeRoadCenterline(surface.centerline);
    if (closed || points.length < 2) continue;
    const half = surface.widthM / 2 + lateralInflationM;
    for (const index of [0, points.length - 1]) {
      const tip = points[index];
      const own = clusters.find(
        (candidate) =>
          Math.hypot(candidate.x - tip.x, candidate.z - tip.z) <=
          ROAD_POINT_EPSILON_M,
      );
      if (own && own.surfaceIds.size > 1) continue;
      let adopter: (typeof clusters)[number] | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const cluster of clusters) {
        if (cluster === own || cluster.surfaceIds.size <= 1) continue;
        const distance = Math.hypot(cluster.x - tip.x, cluster.z - tip.z);
        if (distance <= cluster.maxHalf + half && distance < best) {
          adopter = cluster;
          best = distance;
        }
      }
      if (!adopter) continue;
      adopter.surfaceIds.add(surface.id);
      adopter.maxHalf = Math.max(adopter.maxHalf, half);
      const neighbours: GameCanvasPoint[] = [];
      if (index > 0) neighbours.push(points[index - 1]);
      if (index < points.length - 1) neighbours.push(points[index + 1]);
      adopter.arms.push({ half, node: tip, neighbours });
    }
  }
  // Pass 2: at every shared node, walk the legs in heading order and trace the
  // outline — out one carriageway, across its end, back down the far kerb, round
  // the corner, on to the next.
  const fills: RoadJunctionFill[] = [];
  for (const cluster of clusters) {
    if (cluster.surfaceIds.size <= 1) continue;
    const pivot = { x: cluster.x, z: cluster.z };
    const legs: RoadJunctionLeg[] = [];
    for (const arm of cluster.arms) {
      for (const neighbour of arm.neighbours) {
        const direction = normalizeRoadDirection({
          x: neighbour.x - arm.node.x,
          z: neighbour.z - arm.node.z,
        });
        if (!direction) continue;
        legs.push({
          direction,
          // `roadLateral` turns a heading clockwise, which is the direction the
          // sort below advances in, so this always faces the next leg round.
          lateral: roadLateral(direction),
          origin: arm.node,
          half: arm.half,
          reach: Math.min(
            Math.max(cluster.maxHalf * 1.7, arm.half * 1.3),
            roadPointDistance(arm.node, neighbour) * 0.9,
          ),
        });
      }
    }
    if (legs.length < 2) continue;
    legs.sort(
      (first, second) =>
        Math.atan2(first.direction.x, first.direction.z) -
        Math.atan2(second.direction.x, second.direction.z),
    );
    const polygon: GameCanvasPoint[] = [];
    for (const [index, leg] of legs.entries()) {
      const tipX = leg.origin.x + leg.direction.x * leg.reach;
      const tipZ = leg.origin.z + leg.direction.z * leg.reach;
      polygon.push({
        x: tipX - leg.lateral.x * leg.half,
        z: tipZ - leg.lateral.z * leg.half,
      });
      polygon.push({
        x: tipX + leg.lateral.x * leg.half,
        z: tipZ + leg.lateral.z * leg.half,
      });
      polygon.push(
        ...junctionCornerVertices(
          leg,
          legs[(index + 1) % legs.length],
          kerbRadiusM,
        ),
      );
    }
    const ring = starShapedRing(pivot, polygon);
    if (ring.length >= 3)
      fills.push({ polygon: ring, pivot, surfaceIds: [...cluster.surfaceIds] });
  }
  return fills;
}
