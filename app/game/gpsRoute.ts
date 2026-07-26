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
}

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
export function buildGpsGraph(lanes: readonly GpsLane[]): GpsGraph {
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
      // predecessor — the break `buildConnectedNpcPath` guards against, checked
      // here once at build time instead of on every edge relaxation.
      if (successor === undefined) continue;
      if (!isContinuous(lanes[index], lanes[successor])) continue;
      edges.push(successor);
    }
  }
  successorOffsets[lanes.length] = edges.length;
  return {
    lanes,
    indexById,
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

const GRAPH_BY_LANES = new WeakMap<readonly GpsLane[], GpsGraph>();

/**
 * Cached `buildGpsGraph`, keyed on the lane array's identity. Map packs are
 * frozen module-level objects (`getMapPack`), so a drive resolves this once —
 * the same reason `streetAddressesForMap` can cache by pack id.
 */
export function gpsGraphForLanes(lanes: readonly GpsLane[]): GpsGraph {
  const cached = GRAPH_BY_LANES.get(lanes);
  if (cached) return cached;
  const graph = buildGpsGraph(lanes);
  GRAPH_BY_LANES.set(lanes, graph);
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

/** Metres from a point to a route polyline; +Infinity for an empty route. */
export function routeDeviationM(
  points: readonly GpsPoint[],
  x: number,
  z: number,
): number {
  return projectOntoPolyline(points, x, z)?.distanceM ?? Number.POSITIVE_INFINITY;
}

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
 * A drivable polyline from the player to `to`, or `[]` when there is no legal
 * route (the caller draws nothing rather than a misleading straight line).
 *
 * Runs one A* over the lane graph. Callers must cache the result and only
 * recompute when the destination changes or the player leaves the route.
 */
export function findGpsRoute(
  graph: GpsGraph,
  from: GpsPoint,
  heading: number,
  to: GpsPoint,
): readonly GpsPoint[] {
  if (!graph.lanes.length) return [];
  const startLane = pickStartLane(graph, from.x, from.z, heading);
  const goalLane = pickGoalLane(graph, to.x, to.z);
  if (startLane < 0 || goalLane < 0) return [];

  const startPoints = graph.lanes[startLane].centerline;
  const goalPoints = graph.lanes[goalLane].centerline;
  const startAt = projectOntoPolyline(startPoints, from.x, from.z);
  const goalAt = projectOntoPolyline(goalPoints, to.x, to.z);
  if (!startAt || !goalAt) return [];

  // Already on the destination's lane with the destination ahead: no search.
  if (startLane === goalLane && goalAt.alongM >= startAt.alongM) {
    const direct: GpsPoint[] = [{ x: startAt.x, z: startAt.z }];
    for (let index = startAt.index + 1; index <= goalAt.index; index += 1) {
      direct.push({ x: goalPoints[index].x, z: goalPoints[index].z });
    }
    direct.push({ x: to.x, z: to.z });
    return simplify(direct);
  }

  // Seed the frontier with the start lane's successors rather than the start
  // lane itself, so a destination sitting *behind* the player on their own lane
  // is still reachable — the search can come back around to it.
  const laneSequence = searchLaneSequence(graph, startLane, goalLane);
  if (!laneSequence) return [];

  const points: GpsPoint[] = [{ x: startAt.x, z: startAt.z }];
  for (let index = startAt.index + 1; index < startPoints.length; index += 1) {
    points.push({ x: startPoints[index].x, z: startPoints[index].z });
  }
  for (let hop = 0; hop < laneSequence.length; hop += 1) {
    const lane = graph.lanes[laneSequence[hop]];
    const isGoal = hop === laneSequence.length - 1;
    const centerline = isGoal
      ? lane.centerline.slice(0, goalAt.index + 1)
      : lane.centerline;
    appendLanePoints(points, centerline);
  }
  appendLanePoints(points, [{ x: to.x, z: to.z }]);
  return points.length < 2 ? [] : simplify(points);
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

/** Guards the same break `buildConnectedNpcPath` guards: an authored successor
 * whose geometry does not actually meet its predecessor. */
function isContinuous(lane: GpsLane, successor: GpsLane): boolean {
  const end = lane.centerline[lane.centerline.length - 1];
  const start = successor.centerline[0];
  if (!end || !start) return false;
  return Math.hypot(end.x - start.x, end.z - start.z) <= CONTINUITY_TOLERANCE_M;
}
