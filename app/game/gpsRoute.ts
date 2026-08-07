// A cheap driving route across the authored lane graph, for the minimap's GPS
// line. Pure: no imports, no DOM, no Math.random — the lane subset it needs is
// structural, so authored `LaneSegment`s and the renderer's lanes both satisfy
// it without this module knowing either type.
//
// This is deliberately not an optimiser. It is A* over lanes with a
// straight-line heuristic, which on the largest map in the game (NYC, 227
// lanes, 3-5 centreline points each) settles in well under a millisecond. The
// point is that the graph is tiny: `LaneSegment.successors` already IS the
// directed graph, so there is nothing to build but an index, and a linear scan
// of the open set beats a heap at this size.
//
// The cost model that matters is *when* this runs, not what it costs: callers
// must search once per destination change and once per off-route deviation,
// never per frame and never per simulation step. `routeDistanceAhead` in
// simulation.ts is the hot lane search — it runs for every pair of cars every
// step — and this module deliberately shares none of its state.

export interface GpsPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * The slice of a lane a route needs. `LaneSegment` and `GameCanvasLane` both
 * satisfy it structurally, the way `NpcPathLane` and `AddressLane` do.
 */
export interface GpsLane {
  readonly id: string;
  readonly centerline: readonly GpsPoint[];
  readonly successors?: readonly string[];
  /**
   * The street this lane belongs to. Optional so the type stays structural, but
   * without it a route has no legs: every lane reads as its own street, and a
   * run down one avenue turns into a manoeuvre per block.
   */
  readonly roadId?: string;
}

export type GpsManoeuvreKind =
  | "straight"
  | "left"
  | "right"
  | "uturn"
  | "arrive";

/** A run of the route along one street, after consecutive lanes are merged. */
export interface GpsLeg {
  readonly roadId: string;
  /** Distance from the route's start to where this leg begins, in metres. */
  readonly alongM: number;
  readonly lengthM: number;
  /** Bearing the leg is driven on as it is joined — see `bearingNear`. */
  readonly entryHeadingRad: number;
  /** Bearing it is being driven on as it is left. Differs from the entry
   * bearing on anything curved, and on a loop road the two are opposite. */
  readonly exitHeadingRad: number;
}

/** What the driver has to do where two legs meet. */
export interface GpsManoeuvre {
  readonly kind: GpsManoeuvreKind;
  /** The street being joined. Empty for `arrive`. */
  readonly ontoRoadId: string;
  readonly alongM: number;
  readonly point: GpsPoint;
  /** Signed turn in radians, positive to the right. Zero for `arrive`. */
  readonly turnRad: number;
}

/**
 * A found route: the line to draw, plus the structure behind it.
 *
 * `legs` and `manoeuvres` depend only on the route, so they are derived once
 * here rather than per snapshot. Note they are NOT recoverable from `points`
 * afterwards — `simplify` drops collinear points and keeps the rounded
 * connector samples, so the point list has no correspondence to lanes left.
 */
export interface GpsRoute {
  readonly points: readonly GpsPoint[];
  readonly legs: readonly GpsLeg[];
  readonly manoeuvres: readonly GpsManoeuvre[];
}

/** An empty result, so callers never branch on null. */
const NO_ROUTE: GpsRoute = Object.freeze({
  points: Object.freeze([]) as readonly GpsPoint[],
  legs: Object.freeze([]) as readonly GpsLeg[],
  manoeuvres: Object.freeze([]) as readonly GpsManoeuvre[],
});

/** Below this a junction is a kink in the road, not a turn worth announcing. */
const STRAIGHT_LIMIT_RAD = (30 * Math.PI) / 180;
/** Past this the road has doubled back rather than turned. */
const UTURN_LIMIT_RAD = (150 * Math.PI) / 180;

/**
 * How far past the goal the search may expand before giving up. Nothing in the
 * game comes close — NYC is 227 lanes — so this is purely a backstop against a
 * future map with a pathological graph stalling a render.
 */
export const MAX_GPS_EXPANSIONS = 4000;

/** Collinear points closer than this to the line through their neighbours are dropped. */
const SIMPLIFY_TOLERANCE_M = 0.35;

/** A successor starting further than this from its predecessor's end breaks the chain. */
const CONTINUITY_TOLERANCE_M = 2.5;

/** Where a point falls on a polyline. */
export interface GpsProjection {
  /** Index of the segment the projection landed on. */
  readonly index: number;
  /** How far along that segment, 0..1. */
  readonly t: number;
  /** Perpendicular distance from the queried point, in metres. */
  readonly distanceM: number;
  readonly x: number;
  readonly z: number;
  /** Distance from the polyline's start to the projection, in metres. */
  readonly alongM: number;
}

export interface GpsGraph {
  readonly lanes: readonly GpsLane[];
  readonly indexById: ReadonlyMap<string, number>;
  /** Per lane, the street it belongs to for leg-merging purposes. */
  readonly streetKeys: readonly string[];
  /** Flattened successor adjacency: lane i's edges are [offsets[i], offsets[i+1]). */
  readonly successorOffsets: Int32Array;
  readonly successorIndices: Int32Array;
  readonly lengths: Float64Array;
  /** Scratch reused across searches, stamped by generation so it never needs clearing. */
  readonly scratch: GpsScratch;
}

interface GpsScratch {
  generation: number;
  readonly stamp: Int32Array;
  readonly gScore: Float64Array;
  readonly fScore: Float64Array;
  readonly cameFrom: Int32Array;
  readonly closed: Uint8Array;
  readonly open: Int32Array;
  openCount: number;
}

function polylineLength(points: readonly GpsPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].z - points[index - 1].z,
    );
  }
  return total;
}

/**
 * Indexes a lane list for searching. Successor order is preserved rather than
 * sorted: the NYC generator emits the straight-on continuation first and right
 * turns before left, so a tie between equal-cost routes resolves toward going
 * straight, which is the one a driver would pick anyway.
 */
export function buildGpsGraph(
  lanes: readonly GpsLane[],
  roadNames?: Readonly<Record<string, string>>,
): GpsGraph {
  const indexById = new Map<string, number>();
  for (let index = 0; index < lanes.length; index += 1) {
    indexById.set(lanes[index].id, index);
  }
  const successorOffsets = new Int32Array(lanes.length + 1);
  const edges: number[] = [];
  const lengths = new Float64Array(lanes.length);
  for (let index = 0; index < lanes.length; index += 1) {
    successorOffsets[index] = edges.length;
    lengths[index] = polylineLength(lanes[index].centerline);
    for (const successorId of lanes[index].successors ?? []) {
      const successor = indexById.get(successorId);
      // An unresolvable successor is authored data that degrades quietly
      // elsewhere too; drop the edge rather than throwing on a live map. The
      // same goes for one whose geometry does not actually meet its
      // predecessor. Check it here once at build time instead of on every edge
      // relaxation.
      if (successor === undefined) continue;
      if (!isContinuous(lanes[index], lanes[successor])) continue;
      edges.push(successor);
    }
  }
  successorOffsets[lanes.length] = edges.length;
  // What counts as "the same street" when merging legs. The display name wins
  // over the road id wherever there is one, because a street is often several
  // surfaces: London models Cromwell Road as three, and merging on ids alone
  // told the driver to turn onto the road they were already driving down.
  const streetKeys = lanes.map((lane) => {
    const roadId = lane.roadId ?? lane.id;
    return roadNames?.[roadId] ?? roadId;
  });
  return {
    lanes,
    indexById,
    streetKeys,
    successorOffsets,
    successorIndices: Int32Array.from(edges),
    lengths,
    scratch: {
      generation: 0,
      stamp: new Int32Array(lanes.length),
      gScore: new Float64Array(lanes.length),
      fScore: new Float64Array(lanes.length),
      cameFrom: new Int32Array(lanes.length),
      closed: new Uint8Array(lanes.length),
      open: new Int32Array(lanes.length),
      openCount: 0,
    },
  };
}

const GRAPH_BY_LANES = new WeakMap<
  readonly GpsLane[],
  { names: Readonly<Record<string, string>> | undefined; graph: GpsGraph }[]
>();

/**
 * Cached `buildGpsGraph`, keyed on the lane array's identity. Map packs are
 * frozen module-level objects (`getMapPack`), so a drive resolves this once —
 * the same reason `streetAddressesForMap` can cache by pack id.
 */
export function gpsGraphForLanes(
  lanes: readonly GpsLane[],
  roadNames?: Readonly<Record<string, string>>,
): GpsGraph {
  // Keyed on the names as well as the lanes, and this is not paranoia: the
  // names decide how legs merge, so a caller that asked for the same lanes
  // without them would otherwise poison the cache and hand the next caller a
  // graph that splits one street into several — silently, since the route
  // still draws correctly and only the instructions are wrong.
  const entries = GRAPH_BY_LANES.get(lanes) ?? [];
  const cached = entries.find((entry) => entry.names === roadNames);
  if (cached) return cached.graph;
  const graph = buildGpsGraph(lanes, roadNames);
  entries.push({ names: roadNames, graph });
  GRAPH_BY_LANES.set(lanes, entries);
  return graph;
}

/**
 * Nearest point on a polyline. `distanceToPolylineM` in visuals.ts answers the
 * distance alone; routing needs the segment and the offset along it as well, to
 * cut the line at the player and at the destination.
 */
export function projectOntoPolyline(
  points: readonly GpsPoint[],
  x: number,
  z: number,
): GpsProjection | null {
  if (!points.length) return null;
  if (points.length === 1) {
    return {
      index: 0,
      t: 0,
      distanceM: Math.hypot(x - points[0].x, z - points[0].z),
      x: points[0].x,
      z: points[0].z,
      alongM: 0,
    };
  }
  let best: GpsProjection | null = null;
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-9
        ? 0
        : Math.min(
            1,
            Math.max(0, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared),
          );
    const px = start.x + dx * t;
    const pz = start.z + dz * t;
    const distanceM = Math.hypot(x - px, z - pz);
    if (!best || distanceM < best.distanceM) {
      const segmentLength = Math.sqrt(lengthSquared);
      best = { index, t, distanceM, x: px, z: pz, alongM: travelled + segmentLength * t };
    }
    travelled += Math.sqrt(lengthSquared);
  }
  return best;
}

/**
 * How far the route runs, measured on the real centrelines rather than on the
 * simplified drawn line — the same scale `GpsProgress.remainingM` is in, so the
 * two divide into a fraction of the journey done.
 */
export function routeLengthM(route: GpsRoute): number {
  const legs = route.legs;
  if (legs.length) {
    const last = legs[legs.length - 1];
    return last.alongM + last.lengthM;
  }
  return polylineLength(route.points);
}

/** Where the driver is on a route, and what they have to do next. */
export interface GpsProgress {
  /** Metres off the line; +Infinity for an empty route. */
  readonly deviationM: number;
  readonly next: GpsManoeuvre | null;
  readonly distanceToNextM: number;
  readonly remainingM: number;
}

const NO_PROGRESS: GpsProgress = Object.freeze({
  deviationM: Number.POSITIVE_INFINITY,
  next: null,
  distanceToNextM: 0,
  remainingM: 0,
});

/**
 * Everything position-dependent about a route, from **one** projection.
 *
 * Callers run this on every HUD snapshot, so it deliberately answers the
 * off-route question and the next-manoeuvre question together: measuring the
 * deviation already finds where on the line the driver is, and the distance to
 * the next turn is the same number read against the manoeuvre list. Asking
 * separately would project the polyline twice for one answer.
 *
 * Note the distances are measured against the **untrimmed** route. Trimming for
 * drawing moves the line's origin, so a trimmed route's `alongM` would jump
 * every time the car moved.
 */
export function routeProgress(
  route: GpsRoute,
  x: number,
  z: number,
): GpsProgress {
  const at = projectOntoPolyline(route.points, x, z);
  if (!at) return NO_PROGRESS;
  // `alongM` runs along the simplified line while manoeuvres are measured on
  // the real centrelines, so scale between them rather than comparing raw.
  const drawnLength = polylineLength(route.points);
  const trueLength = routeLengthM(route);
  const travelled = drawnLength > 0 ? (at.alongM / drawnLength) * trueLength : 0;
  let next: GpsManoeuvre | null = null;
  for (const manoeuvre of route.manoeuvres) {
    if (manoeuvre.alongM >= travelled - MANOEUVRE_PASSED_SLACK_M) {
      next = manoeuvre;
      break;
    }
  }
  return {
    deviationM: at.distanceM,
    next,
    distanceToNextM: next ? Math.max(0, next.alongM - travelled) : 0,
    remainingM: Math.max(0, trueLength - travelled),
  };
}

/**
 * How far past a manoeuvre it stops being the next one. A turn is not done at
 * the exact metre its leg starts — the car is still swinging through it — and
 * without the slack the banner would flip to the following instruction while
 * the driver is mid-corner.
 */
const MANOEUVRE_PASSED_SLACK_M = 8;

/**
 * The route from where the player actually is, so the line starts at the car
 * rather than trailing behind it. Bounded by the polyline's own length, which
 * simplification keeps at a few dozen points.
 */
export function trimRouteToPlayer(
  points: readonly GpsPoint[],
  x: number,
  z: number,
): readonly GpsPoint[] {
  if (points.length < 2) return points;
  const at = projectOntoPolyline(points, x, z);
  if (!at) return points;
  const rest = points.slice(at.index + 1);
  return [{ x: at.x, z: at.z }, ...rest];
}

/**
 * The lane the player is driving on.
 *
 * Nearest-lane alone is not enough: two-way streets carry their opposing lane
 * 3.4 m away (NYC offsets each 1.7 m off the road centreline), so the nearest
 * lane is a coin flip that half the time routes the player back the way they
 * came. Candidates must first agree with the heading — world direction
 * (sin h, cos h) under the `atan2(dx, dz)` convention — and only if none does
 * do we fall back to the nearest lane of any direction.
 */
function pickStartLane(
  graph: GpsGraph,
  x: number,
  z: number,
  heading: number,
): number {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  let agreeing = -1;
  let agreeingDistance = Number.POSITIVE_INFINITY;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < graph.lanes.length; index += 1) {
    const centerline = graph.lanes[index].centerline;
    const at = projectOntoPolyline(centerline, x, z);
    if (!at) continue;
    if (at.distanceM < nearestDistance) {
      nearestDistance = at.distanceM;
      nearest = index;
    }
    if (at.distanceM >= agreeingDistance) continue;
    const start = centerline[at.index];
    const end = centerline[Math.min(at.index + 1, centerline.length - 1)];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    if (forwardX * dx + forwardZ * dz <= 0) continue;
    agreeingDistance = at.distanceM;
    agreeing = index;
  }
  return agreeing >= 0 ? agreeing : nearest;
}

/** The lane a destination sits on. Gig targets are resolved from lane anchors,
 * so this normally lands exactly on the right lane at ~0 m. */
function pickGoalLane(graph: GpsGraph, x: number, z: number): number {
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < graph.lanes.length; index += 1) {
    const at = projectOntoPolyline(graph.lanes[index].centerline, x, z);
    if (!at || at.distanceM >= nearestDistance) continue;
    nearestDistance = at.distanceM;
    nearest = index;
  }
  return nearest;
}

/** Drops points that add nothing but keeps real corners — including the
 * connector S-curve samples that give junctions their rounded turns. */
function simplify(points: readonly GpsPoint[]): GpsPoint[] {
  if (points.length < 3) return [...points];
  const kept: GpsPoint[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = kept[kept.length - 1];
    const point = points[index];
    const next = points[index + 1];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 1e-9) continue;
    const cross =
      Math.abs((point.x - previous.x) * dz - (point.z - previous.z) * dx) /
      Math.sqrt(lengthSquared);
    if (cross >= SIMPLIFY_TOLERANCE_M) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/**
 * Signed turn from one bearing to another, positive to the right.
 *
 * Deliberately NOT called `angleDifference`: a live one of that name sits in
 * `simulation.ts`, and a duplicate across layers is a documented trap here —
 * the last pair cost real time because neither could be deleted by name alone.
 */
function signedTurnRad(from: number, to: number): number {
  let wrapped = (to - from) % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/** Skipped at each end when reading a bearing: the connector S-curve
 * `buildLaneTrueGeometry` lays down is already bending into the next lane, so a
 * bearing taken across it understates the turn that follows. */
const BEARING_BLEND_SKIP_M = 6;
/** Read the bearing over this much road. Long enough to average out the
 * sampling of a curve, short enough to describe one end of a leg rather than
 * the whole thing. */
const BEARING_RUN_M = 20;

/** The point `distance` metres along a polyline, clamped to its ends. */
function pointAtDistance(points: readonly GpsPoint[], distance: number): GpsPoint {
  if (distance <= 0) return points[0];
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const span = Math.hypot(point.x - previous.x, point.z - previous.z);
    if (travelled + span >= distance) {
      const t = span < 1e-9 ? 0 : (distance - travelled) / span;
      return {
        x: previous.x + (point.x - previous.x) * t,
        z: previous.z + (point.z - previous.z) * t,
      };
    }
    travelled += span;
  }
  return points[points.length - 1];
}

/**
 * The bearing a leg is being driven on near one of its ends.
 *
 * A single chord across the whole leg was wrong on anything that curves, and
 * catastrophically wrong on a loop: London's quiet loop and Gloucester loop
 * merge into one leg whose first and last points are nearly the same place, so
 * the chord pointed back the way it came and *every* route onto them was
 * classified as a u-turn — 31% of all London routes. A leg therefore has two
 * bearings, each read over a short run near its own end, which is immune both
 * to the connector blend and to whatever the middle of the leg does.
 */
function bearingNear(points: readonly GpsPoint[], atEnd: boolean): number {
  const total = polylineLength(points);
  const skip = Math.min(BEARING_BLEND_SKIP_M, total * 0.25);
  const run = Math.min(BEARING_RUN_M, Math.max(total - skip * 2, total * 0.5));
  const [fromM, toM] = atEnd
    ? [total - skip - run, total - skip]
    : [skip, skip + run];
  const from = pointAtDistance(points, fromM);
  const to = pointAtDistance(points, toM);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // A degenerate run (a leg shorter than the blend it is trying to skip) falls
  // back to the chord, which is the best available answer at that size.
  if (Math.hypot(dx, dz) < 0.01) {
    const first = points[0];
    const last = points[points.length - 1];
    return Math.atan2(last.x - first.x, last.z - first.z);
  }
  return Math.atan2(dx, dz);
}

function classifyTurn(turnRad: number): GpsManoeuvreKind {
  const magnitude = Math.abs(turnRad);
  if (magnitude < STRAIGHT_LIMIT_RAD) return "straight";
  if (magnitude > UTURN_LIMIT_RAD) return "uturn";
  return turnRad > 0 ? "right" : "left";
}

/**
 * Collapses the lane sequence into legs, then reads the manoeuvres off the
 * boundaries between them.
 *
 * Merging by `roadId` is the one rule that does all the work: NYC splits every
 * street into a lane per block, Amsterdam carries two lanes each way, and a
 * roundabout's lanes all share one road id — so a straight run, a lane change
 * and a whole roundabout each collapse to a single leg without special cases.
 */
function buildLegs(
  laneRuns: readonly { readonly roadId: string; readonly points: readonly GpsPoint[] }[],
  destination: GpsPoint,
): { legs: GpsLeg[]; manoeuvres: GpsManoeuvre[] } {
  const legs: GpsLeg[] = [];
  const manoeuvres: GpsManoeuvre[] = [];
  let alongM = 0;
  for (const run of laneRuns) {
    if (run.points.length < 2) continue;
    const lengthM = polylineLength(run.points);
    const entryHeadingRad = bearingNear(run.points, false);
    const exitHeadingRad = bearingNear(run.points, true);
    const previous = legs[legs.length - 1];
    if (previous) {
      // Leaving the last leg's exit bearing for this one's entry bearing: what
      // the driver actually does at the junction between them.
      const turnRad = signedTurnRad(previous.exitHeadingRad, entryHeadingRad);
      manoeuvres.push({
        kind: classifyTurn(turnRad),
        ontoRoadId: run.roadId,
        alongM,
        point: { x: run.points[0].x, z: run.points[0].z },
        turnRad,
      });
    }
    legs.push({
      roadId: run.roadId,
      alongM,
      lengthM,
      entryHeadingRad,
      exitHeadingRad,
    });
    alongM += lengthM;
  }
  if (legs.length) {
    manoeuvres.push({
      kind: "arrive",
      ontoRoadId: "",
      alongM,
      point: { x: destination.x, z: destination.z },
      turnRad: 0,
    });
  }
  return { legs, manoeuvres };
}

/** Groups a lane sequence into runs sharing a road id, carrying each run's
 * points so leg geometry is measured on the real centrelines. */
function groupByRoad(
  lanes: readonly DrivenLane[],
): { roadId: string; points: GpsPoint[] }[] {
  const runs: { roadId: string; streetKey: string; points: GpsPoint[] }[] = [];
  for (const lane of lanes) {
    const current = runs[runs.length - 1];
    if (current && current.streetKey === lane.streetKey) {
      appendLanePoints(current.points, lane.points);
      continue;
    }
    const points: GpsPoint[] = [];
    appendLanePoints(points, lane.points);
    runs.push({ roadId: lane.roadId, streetKey: lane.streetKey, points });
  }
  return runs;
}

/** One lane's contribution to a route: the stretch driven, the road it reports
 * as, and the street it merges under. */
interface DrivenLane {
  readonly roadId: string;
  readonly streetKey: string;
  readonly points: readonly GpsPoint[];
}

/** Appends a lane's points, skipping the joint already contributed by its
 * predecessor. Successor continuity is guaranteed to 0.01 m by content.test.ts. */
function appendLanePoints(into: GpsPoint[], points: readonly GpsPoint[]): void {
  for (const point of points) {
    const last = into[into.length - 1];
    if (last && Math.hypot(point.x - last.x, point.z - last.z) < 0.05) continue;
    into.push({ x: point.x, z: point.z });
  }
}

/**
 * A drivable route from the player to `to`, or an empty one when there is no
 * legal path (the caller draws nothing rather than a misleading straight line).
 *
 * Runs one A* over the lane graph and derives the legs and manoeuvres in the
 * same pass, since all of it depends only on the route. Callers must cache the
 * result and only recompute when the destination changes or the player leaves
 * the route.
 */
export function findGpsRoute(
  graph: GpsGraph,
  from: GpsPoint,
  heading: number,
  to: GpsPoint,
): GpsRoute {
  if (!graph.lanes.length) return NO_ROUTE;
  const startLane = pickStartLane(graph, from.x, from.z, heading);
  const goalLane = pickGoalLane(graph, to.x, to.z);
  if (startLane < 0 || goalLane < 0) return NO_ROUTE;

  const startPoints = graph.lanes[startLane].centerline;
  const goalPoints = graph.lanes[goalLane].centerline;
  const startAt = projectOntoPolyline(startPoints, from.x, from.z);
  const goalAt = projectOntoPolyline(goalPoints, to.x, to.z);
  if (!startAt || !goalAt) return NO_ROUTE;

  // Each lane the route uses, with only the stretch actually driven. Legs are
  // built from these rather than from the finished line, because `simplify`
  // leaves the points with no correspondence to lanes.
  const driven: { roadId: string; streetKey: string; points: GpsPoint[] }[] = [];
  const roadIdOf = (lane: number): string => graph.lanes[lane].roadId ?? graph.lanes[lane].id;
  const streetKeyOf = (lane: number): string => graph.streetKeys[lane];

  // Already on the destination's lane with the destination ahead: no search.
  if (startLane === goalLane && goalAt.alongM >= startAt.alongM) {
    const direct: GpsPoint[] = [{ x: startAt.x, z: startAt.z }];
    for (let index = startAt.index + 1; index <= goalAt.index; index += 1) {
      direct.push({ x: goalPoints[index].x, z: goalPoints[index].z });
    }
    direct.push({ x: to.x, z: to.z });
    driven.push({
      roadId: roadIdOf(startLane),
      streetKey: streetKeyOf(startLane),
      points: direct,
    });
    return assembleRoute(driven, to);
  }

  // Seed the frontier with the start lane's successors rather than the start
  // lane itself, so a destination sitting *behind* the player on their own lane
  // is still reachable — the search can come back around to it.
  const laneSequence = searchLaneSequence(graph, startLane, goalLane);
  if (!laneSequence) return NO_ROUTE;

  const startRun: GpsPoint[] = [{ x: startAt.x, z: startAt.z }];
  for (let index = startAt.index + 1; index < startPoints.length; index += 1) {
    startRun.push({ x: startPoints[index].x, z: startPoints[index].z });
  }
  driven.push({
    roadId: roadIdOf(startLane),
    streetKey: streetKeyOf(startLane),
    points: startRun,
  });
  for (let hop = 0; hop < laneSequence.length; hop += 1) {
    const lane = laneSequence[hop];
    const isGoal = hop === laneSequence.length - 1;
    const centerline = isGoal
      ? graph.lanes[lane].centerline.slice(0, goalAt.index + 1)
      : graph.lanes[lane].centerline;
    const points: GpsPoint[] = [];
    appendLanePoints(points, centerline);
    if (isGoal) appendLanePoints(points, [{ x: to.x, z: to.z }]);
    driven.push({ roadId: roadIdOf(lane), streetKey: streetKeyOf(lane), points });
  }
  return assembleRoute(driven, to);
}

/**
 * Turns the driven lane stretches into the line to draw plus the structure
 * behind it. The two channels are built from the same source and then diverge:
 * the points get simplified for drawing, the legs keep the real geometry.
 */
function assembleRoute(
  driven: readonly DrivenLane[],
  destination: GpsPoint,
): GpsRoute {
  const points: GpsPoint[] = [];
  for (const run of driven) appendLanePoints(points, run.points);
  if (points.length < 2) return NO_ROUTE;
  // Legs are measured on the merged runs, so a leg's own first and last points
  // are real centreline positions rather than survivors of simplification.
  const runs = groupByRoad(driven);
  const { legs, manoeuvres } = buildLegs(runs, destination);
  return { points: simplify(points), legs, manoeuvres };
}

/**
 * A* from the start lane's successors to the goal lane, returning the lane
 * indices after the start lane. Scratch is generation-stamped rather than
 * cleared, the same discipline `routeDistanceAhead` uses — though deliberately
 * not the same buffers, since that one runs inside the simulation step.
 */
function searchLaneSequence(
  graph: GpsGraph,
  startLane: number,
  goalLane: number,
): number[] | null {
  const { scratch, lengths, successorOffsets, successorIndices, lanes } = graph;
  scratch.generation += 1;
  const generation = scratch.generation;
  scratch.openCount = 0;

  const goalPoints = lanes[goalLane].centerline;
  const goalPoint = goalPoints[goalPoints.length - 1];
  const heuristic = (lane: number): number => {
    const centerline = lanes[lane].centerline;
    const end = centerline[centerline.length - 1];
    return Math.hypot(goalPoint.x - end.x, goalPoint.z - end.z);
  };

  const push = (lane: number, gScore: number, cameFrom: number): void => {
    if (scratch.stamp[lane] === generation) {
      if (gScore >= scratch.gScore[lane]) return;
      scratch.gScore[lane] = gScore;
      scratch.fScore[lane] = gScore + heuristic(lane);
      scratch.cameFrom[lane] = cameFrom;
      if (scratch.closed[lane]) {
        scratch.closed[lane] = 0;
        scratch.open[scratch.openCount] = lane;
        scratch.openCount += 1;
      }
      return;
    }
    scratch.stamp[lane] = generation;
    scratch.gScore[lane] = gScore;
    scratch.fScore[lane] = gScore + heuristic(lane);
    scratch.cameFrom[lane] = cameFrom;
    scratch.closed[lane] = 0;
    scratch.open[scratch.openCount] = lane;
    scratch.openCount += 1;
  };

  for (
    let edge = successorOffsets[startLane];
    edge < successorOffsets[startLane + 1];
    edge += 1
  ) {
    push(successorIndices[edge], lengths[successorIndices[edge]], -1);
  }

  for (let expansion = 0; expansion < MAX_GPS_EXPANSIONS; expansion += 1) {
    if (scratch.openCount === 0) return null;
    // Linear scan: at 227 lanes a heap costs more than it saves, and the first
    // minimum wins, so ties resolve to whichever was pushed first — the
    // straight-on successor, which the NYC generator emits ahead of the turns.
    let bestSlot = 0;
    for (let slot = 1; slot < scratch.openCount; slot += 1) {
      if (scratch.fScore[scratch.open[slot]] < scratch.fScore[scratch.open[bestSlot]]) {
        bestSlot = slot;
      }
    }
    const lane = scratch.open[bestSlot];
    scratch.openCount -= 1;
    scratch.open[bestSlot] = scratch.open[scratch.openCount];

    if (lane === goalLane) {
      const sequence: number[] = [];
      for (let step = lane; step >= 0; step = scratch.cameFrom[step]) {
        sequence.push(step);
      }
      sequence.reverse();
      return sequence;
    }

    scratch.closed[lane] = 1;
    const gScore = scratch.gScore[lane];
    for (
      let edge = successorOffsets[lane];
      edge < successorOffsets[lane + 1];
      edge += 1
    ) {
      const successor = successorIndices[edge];
      push(successor, gScore + lengths[successor], lane);
    }
  }
  return null;
}

/** Rejects an authored successor whose geometry misses its predecessor. */
function isContinuous(lane: GpsLane, successor: GpsLane): boolean {
  const end = lane.centerline[lane.centerline.length - 1];
  const start = successor.centerline[0];
  if (!end || !start) return false;
  return Math.hypot(end.x - start.x, end.z - start.z) <= CONTINUITY_TOLERANCE_M;
}
