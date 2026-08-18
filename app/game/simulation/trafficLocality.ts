import type { SimulationPoint } from "../simulation";

/**
 * The gameplay traffic window is deliberately a conservative subset of the
 * night-map presentation envelope. Every shipping map currently fogs out at
 * 440 m, but a pullover/cutscene camera can remain roughly 62 m from the
 * current player pose while its 460 m far plane is active. Vehicle bounds and
 * rounding require a conservative 550 m player-centred envelope. These are
 * simulation constants rather than camera reads so traffic remains
 * deterministic and pure.
 */
export const LOCAL_TRAFFIC_FOG_RADIUS_M = 440;
export const LOCAL_TRAFFIC_INNER_RADIUS_M = 250;
/** A vehicle at or inside this player-centred radius can still be presented by
 * a production camera. Activation and retirement must happen strictly beyond
 * it, independently of the narrower fog radius. */
export const PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M = 550;
export const RUNTIME_TRAFFIC_APPROACH_SAFETY_MARGIN_M = 20;
export const RUNTIME_TRAFFIC_APPROACH_MIN_M =
  PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M +
  RUNTIME_TRAFFIC_APPROACH_SAFETY_MARGIN_M;
/** Retaining a 160 m approach band leaves the ordinary 240 m route horizon
 * just enough direct reach from its far edge to the 440 m local circle. */
export const RUNTIME_TRAFFIC_APPROACH_MAX_M = 680;
/** Cars cross this short hand-off corridor just outside the fog band. Count
 * them as in-flight replacements continuously until the visible radial bucket
 * owns them, so a 10 Hz controller does not queue a duplicate batch. */
export const RUNTIME_TRAFFIC_INBOUND_TRANSIT_MIN_M =
  LOCAL_TRAFFIC_FOG_RADIUS_M;
/** Only this final geometric hand-off and a bounded 240 m successor proof may
 * suppress a visible deficit. Farther approach cars remain useful pipeline
 * supply but cannot reserve a target for an arbitrarily long detour. */
export const RUNTIME_TRAFFIC_COMMITTED_TRANSIT_MAX_M =
  RUNTIME_TRAFFIC_APPROACH_MIN_M;
export const RUNTIME_TRAFFIC_CIRCULATION_MIN_M =
  PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M;
/** Exceptional recovery may release only after a stranded vehicle is strictly
 * beyond the same proven presentation envelope. Ordinary population recycling
 * still waits for 800 m, at least 100 m beyond the final approach portal. */
export const RUNTIME_TRAFFIC_EXCEPTION_RECYCLE_RADIUS_M =
  PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M;
export const RUNTIME_TRAFFIC_RECYCLE_RADIUS_M = 800;

/** Perceptual density is measured against the current road, not a camera cone.
 * The 60 m strip admits paired/opposite carriageways and broad intersections
 * without treating a parallel street a block away as the player's road. */
export const LOCAL_TRAFFIC_CORRIDOR_HALF_WIDTH_M = 60;
export const LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M = 90;
/** Guaranteed close streetscape presence. Cross-traffic journeys are staged
 * at a forward intersection inside the 250 m inner horizon, retain ownership
 * until they physically enter the 90 m contribution circle, and never rely on
 * a visible activation or camera-dependent geometry. */
export const LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_RADIUS_M = 120;
export const LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_RADIUS_M = 100;
export const LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_TARGET = 3;
export const LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_TARGET = 2;
export const LOCAL_TRAFFIC_DESKTOP_MOVING_NEAR_VIEW_TARGET = 2;
export const LOCAL_TRAFFIC_TOUCH_MOVING_NEAR_VIEW_TARGET = 1;
/** Stagger independent cross-traffic journeys. One per second can establish
 * several destinations without an activation wave at the 10 Hz controller. */
export const LOCAL_TRAFFIC_AHEAD_FEED_ADMISSION_CADENCE_SECONDS = 1;
/** An already-simulated civilian may accept a nearby cross-street
 * destination without any activation or pose change. Beyond fifteen seconds
 * the moving target is too likely to leave the useful window, so ordinary
 * hidden streaming remains the fallback. */
export const LOCAL_TRAFFIC_LOCAL_HANDOFF_MAX_ETA_SECONDS = 15;
/** A moving-player crossing is useful only when both vehicles reach it within
 * the same five-second rendezvous window. Player ETA uses a five-metre-per-
 * second floor so crawling does not reserve arbitrarily late journeys. */
export const LOCAL_TRAFFIC_APPROACH_INTERCEPT_GRACE_SECONDS = 5;
export const LOCAL_TRAFFIC_APPROACH_INTERCEPT_MIN_PLAYER_SPEED_MPS = 5;
/** Only an actually imminent journey may stand in for a missing close car.
 * All commitments still count against pipeline duplication independently. */
export const LOCAL_TRAFFIC_IMMINENT_APPROACH_ETA_SECONDS = 10;
export const LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS = 0.5;
/** A tangent must point within about 78 degrees of the player before it can be
 * called approaching. Route reachability is checked separately. */
export const LOCAL_TRAFFIC_APPROACHING_HEADING_DOT_MIN = 0.2;
export const LOCAL_TRAFFIC_DESKTOP_LANE_OCCUPANCY_CAP = 6;
export const LOCAL_TRAFFIC_TOUCH_LANE_OCCUPANCY_CAP = 4;
export const LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP = 14;
export const LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP = 10;
export const LOCAL_TRAFFIC_DESKTOP_PATROL_FOG_CAP = 2;
export const LOCAL_TRAFFIC_TOUCH_PATROL_FOG_CAP = 1;
export const LOCAL_TRAFFIC_PATROL_INNER_CAP = 1;
/** One vehicle per 28 m of eligible directional lane is a deliberately
 * conservative perceptual capacity. It is wider than the 20 m reset headway
 * and is shared with portal catalogue sampling, so a short connected road can
 * never be assigned a target that its legal geometry cannot hold. */
export const LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M = 28;
/** Distribution repair may temporarily exceed the radial target by one car,
 * never by an approach wave. */
export const LOCAL_TRAFFIC_PERCEPTUAL_RADIAL_OVERSHOOT_CAP = 1;

/** Dense enough for short authored road segments to contribute several
 * safely separated choices across one continuous roadId corridor. The adapter
 * distributes samples inside a conservative 25 m junction setback and still
 * rejects authored control/conflict ranges. The catalogue is static and
 * spatially indexed; every 10 Hz consumer remains capped at 24 inspections. */
export const RUNTIME_TRAFFIC_PORTAL_INTERVAL_M =
  LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M;
export const RUNTIME_TRAFFIC_PORTAL_ENDPOINT_SETBACK_M = 25;
export const RUNTIME_TRAFFIC_PORTAL_CELL_SIZE_M = 160;
/** An approach portal can be 680 m from the player, while the inner target
 * ends at 250 m. A legal city route can need a short deterministic detour
 * before entering that disc (Cairo's supplied paths peak at about 718 m), so
 * inner selection gets its own bounded 750 m horizon. This is selection-only
 * and never changes road leading's established 240 m / six-hop semantics. */
export const RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M = 750;
export const RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS = 12;
/** A hidden hard feed is useful for continuity only when the immutable goal
 * route can reach its contribution interval within this bounded ETA. The
 * estimate uses the slowest ordinary driver style (68% of each lane limit)
 * plus a fixed two-second spawn/acceleration allowance. Longer legal routes
 * remain valid circulation paths, but cannot inflate a ten-second perceptual
 * target that they are physically unable to replenish. */
export const LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS = 30;
export const LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR = 0.68;
export const LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS = 2;
/** A streamed car must have enough deterministic continuous road beyond its
 * portal to enter, cross, and leave a neighbourhood instead of becoming a
 * dominant stopped dead-end cluster. This admission-only proof is longer than
 * either leading horizon and never changes movement routing semantics. */
export const RUNTIME_TRAFFIC_MIN_CONTINUOUS_ROUTE_M = 1_000;
export const RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS = 24;

/** A one-second persistence requirement at the simulation's 10 Hz decision
 * cadence prevents radius-boundary jitter from churn-recycling a fleet. */
export const LOCAL_TRAFFIC_HYSTERESIS_DECISIONS = 10;
export const LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET = 2;
export const LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET = 2;
/** Hidden circulating supply. Combined with the radial target, this keeps well
 * over half of each 32/16 identity pool moving on sparse maps without raising
 * either production ceiling. Cars enter the local window physically; no
 * runtime activation is allowed inside the approach band. */
export const LOCAL_TRAFFIC_DESKTOP_APPROACH_RESERVE = 10;
export const LOCAL_TRAFFIC_TOUCH_APPROACH_RESERVE = 4;
/** At most one route-proven approach car is kept as proactive perceptual
 * supply; all remaining reserve identities circulate without converging. */
export const LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET = 1;
export const LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET = 24;
/** Cold-start placement runs before presentation and may inspect a wider,
 * still-constant portal window so dense catalogues can balance lanes and
 * directions. Runtime 10 Hz work retains the much smaller 24-entry cap. */
export const LOCAL_TRAFFIC_INITIAL_PORTAL_ATTEMPT_BUDGET = 512;
/** No queued identity may consume the whole decision window when its stable
 * successor choices cannot feed the requested corridor. */
export const LOCAL_TRAFFIC_PORTAL_ATTEMPTS_PER_IDENTITY = 4;
/** Exact clipped lane length is only re-evaluated after meaningful player
 * movement. The controller already requires one second of evidence before a
 * lifecycle change, so this bounded cache preserves its stable target while
 * avoiding a whole-map polyline walk on every 10 Hz idle decision. */
export const LOCAL_TRAFFIC_TARGET_RECOMPUTE_DISTANCE_M = 8;

export interface RuntimeTrafficPortal extends SimulationPoint {
  /** Stable lane/arclength identity; it is never derived from object order. */
  readonly id: string;
  readonly laneId: string;
  readonly distance: number;
  readonly heading: number;
}

export interface TrafficPopulationTargets {
  readonly withinFog: number;
  readonly withinInner: number;
}

export interface TrafficPerceptualTargets {
  readonly movingWithinInner: number;
  readonly currentRoadCorridor: number;
  readonly forwardCorridor: number;
  readonly aheadOrApproaching: number;
  readonly circulatingApproach: number;
}

export interface TopologyAwareTrafficTargets {
  readonly population: TrafficPopulationTargets;
  readonly perceptual: TrafficPerceptualTargets;
  readonly currentRoadCapacity: number;
  readonly forwardCorridorCapacity: number;
  /** The nested current/forward storage-or-fast-continuity deficit reallocated
   * to inner cross traffic. It is the larger shortfall, never the sum of two
   * overlapping buckets, and does not waive the steady corridor target. */
  readonly corridorShortfall: number;
}

interface PolylineLane {
  readonly id: string;
  readonly points: readonly SimulationPoint[];
}

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const clampInteger = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Math.round(value)));

/**
 * Local density targets are expressed in directional lane length, rather than
 * city area or total lane count. The caller gives metres, avoiding accidental
 * kilometre/unit mismatches in simulation tests.
 */
export function resolveLocalTrafficTargets(
  laneLengthWithinFogM: number,
  laneLengthWithinInnerM: number,
  touchFirst: boolean,
): TrafficPopulationTargets {
  const multiplier = touchFirst ? 1.6 : 2.5;
  const outer = touchFirst
    ? clampInteger((finiteNonNegative(laneLengthWithinFogM) / 1000) * multiplier, 10, 15)
    : clampInteger((finiteNonNegative(laneLengthWithinFogM) / 1000) * multiplier, 16, 28);
  const inner = touchFirst
    ? clampInteger((finiteNonNegative(laneLengthWithinInnerM) / 1000) * multiplier, 6, 10)
    : clampInteger((finiteNonNegative(laneLengthWithinInnerM) / 1000) * multiplier, 8, 16);
  return { withinFog: outer, withinInner: Math.min(outer, inner) };
}

/** Fixed, device-aware minimums layered on top of lane-length density. They
 * remain bounded by the 32/16 pools. Directional hard gates and independent
 * lane/corridor caps distribute this calibrated bustle instead of stacking a
 * single follower queue. */
export function resolveLocalTrafficPerceptualTargets(
  poolCount: number,
  population: TrafficPopulationTargets,
  touchFirst: boolean,
): TrafficPerceptualTargets {
  const pool = Math.max(0, Math.trunc(finiteNonNegative(poolCount)));
  const movingWithinInner = Math.min(
    pool,
    population.withinInner,
    touchFirst ? 4 : 8,
  );
  const currentRoadCorridor = Math.min(
    pool,
    population.withinFog,
    touchFirst ? 8 : 12,
  );
  const forwardCorridor = Math.min(
    pool,
    currentRoadCorridor,
    touchFirst ? 5 : 8,
  );
  const aheadOrApproaching = Math.min(
    pool,
    population.withinInner,
    touchFirst ? 6 : 8,
  );
  const reserve = touchFirst
    ? LOCAL_TRAFFIC_TOUCH_APPROACH_RESERVE
    : LOCAL_TRAFFIC_DESKTOP_APPROACH_RESERVE;
  const circulatingApproach = Math.min(
    reserve,
    Math.max(0, pool - population.withinFog),
  );
  return {
    movingWithinInner,
    currentRoadCorridor,
    forwardCorridor,
    aheadOrApproaching,
    circulatingApproach,
  };
}

/**
 * Clamp a calibrated perceptual target to the amount of continuous lane that
 * can safely hold it. A short player road is compensated with legal inner
 * cross traffic instead of either stacking followers or silently reducing the
 * requested bustle. Hidden routes that can arrive within the continuity ETA
 * add compensation, but never lower the steady corridor target: slow natural
 * circulation can still fill storage after the player holds an anchor.
 */
export function resolveTopologyAwareLocalTrafficTargets(
  poolCount: number,
  basePopulation: TrafficPopulationTargets,
  touchFirst: boolean,
  currentCorridorLaneLengthM: number,
  forwardCorridorLaneLengthM: number,
  streamableCurrentRoadCapacity = Number.POSITIVE_INFINITY,
  streamableForwardCorridorCapacity = Number.POSITIVE_INFINITY,
): TopologyAwareTrafficTargets {
  const pool = Math.max(0, Math.trunc(finiteNonNegative(poolCount)));
  const raw = resolveLocalTrafficPerceptualTargets(
    pool,
    basePopulation,
    touchFirst,
  );
  const geometricCurrentRoadCapacity = Math.floor(
    finiteNonNegative(currentCorridorLaneLengthM) /
      LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
  );
  const geometricForwardCorridorCapacity = Math.floor(
    finiteNonNegative(forwardCorridorLaneLengthM) /
      LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
  );
  const normalizedStreamableCurrentCapacity = Number.isFinite(
    streamableCurrentRoadCapacity,
  )
    ? Math.max(0, Math.trunc(streamableCurrentRoadCapacity))
    : Number.POSITIVE_INFINITY;
  const normalizedStreamableForwardCapacity = Number.isFinite(
    streamableForwardCorridorCapacity,
  )
    ? Math.max(0, Math.trunc(streamableForwardCorridorCapacity))
    : Number.POSITIVE_INFINITY;
  const currentRoadCapacity = geometricCurrentRoadCapacity;
  const forwardCorridorCapacity = geometricForwardCorridorCapacity;
  const corridorOccupancyCap = touchFirst
    ? LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP
    : LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP;
  const currentRoadCorridor = Math.min(
    raw.currentRoadCorridor,
    corridorOccupancyCap,
    currentRoadCapacity,
  );
  const forwardCorridor = Math.min(
    raw.forwardCorridor,
    currentRoadCorridor,
    forwardCorridorCapacity,
  );
  const fastCurrentRoadCorridor = Math.min(
    currentRoadCorridor,
    normalizedStreamableCurrentCapacity,
  );
  const fastForwardCorridor = Math.min(
    forwardCorridor,
    normalizedStreamableForwardCapacity,
  );
  // Raw directional demand is nested. Comparing each raw floor with its fast
  // subset and taking the maximum credits an unavailable/slow slot exactly
  // once, while the storage-backed target remains independently enforced.
  const corridorShortfall = Math.max(
    raw.currentRoadCorridor - fastCurrentRoadCorridor,
    raw.forwardCorridor - fastForwardCorridor,
  );
  const innerCap = touchFirst ? 10 : 16;
  const population: TrafficPopulationTargets = {
    withinFog: basePopulation.withinFog,
    withinInner: Math.min(
      basePopulation.withinFog,
      innerCap,
      basePopulation.withinInner + corridorShortfall,
    ),
  };
  const movingWithinInner = Math.min(
    pool,
    population.withinInner,
    touchFirst ? 4 : 8,
  );
  const aheadOrApproaching = Math.min(
    pool,
    population.withinInner,
    raw.aheadOrApproaching + corridorShortfall,
  );
  return {
    population,
    perceptual: {
      movingWithinInner,
      currentRoadCorridor,
      forwardCorridor,
      aheadOrApproaching,
      circulatingApproach: raw.circulatingApproach,
    },
    currentRoadCapacity,
    forwardCorridorCapacity,
    corridorShortfall,
  };
}

interface ClippedSegmentInterval {
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

/** Exact parametric interval of a line segment that lies in a circle. */
function segmentIntervalWithinCircle(
  start: SimulationPoint,
  end: SimulationPoint,
  centre: SimulationPoint,
  radius: number,
): ClippedSegmentInterval | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length <= Number.EPSILON || radius <= 0) return null;
  const ox = start.x - centre.x;
  const oz = start.z - centre.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return c <= 0 ? { from: 0, to: 1, length } : null;
  }
  const root = Math.sqrt(Math.max(0, discriminant));
  const from = Math.max(0, Math.min(1, (-b - root) / (2 * a)));
  const to = Math.max(0, Math.min(1, (-b + root) / (2 * a)));
  return to > from ? { from, to, length } : null;
}

/** Exact arclength of a polyline segment that lies in a circle. */
function segmentLengthWithinCircle(
  start: SimulationPoint,
  end: SimulationPoint,
  centre: SimulationPoint,
  radius: number,
): number {
  const interval = segmentIntervalWithinCircle(start, end, centre, radius);
  return interval ? (interval.to - interval.from) * interval.length : 0;
}

/**
 * Exact clipped directional lane length for diagnostics and deterministic
 * density control. Calling code may keep a narrow capacity-lane id set; this
 * helper deliberately makes no assumptions about an authored lane role.
 */
export function localTrafficLaneLengthM(
  lanes: readonly PolylineLane[],
  capacityLaneIds: ReadonlySet<string>,
  centre: SimulationPoint,
  radius: number,
): number {
  if (radius <= 0 || capacityLaneIds.size === 0) return 0;
  let total = 0;
  for (const lane of lanes) {
    if (!capacityLaneIds.has(lane.id)) continue;
    for (let index = 1; index < lane.points.length; index += 1) {
      total += segmentLengthWithinCircle(
        lane.points[index - 1],
        lane.points[index],
        centre,
        radius,
      );
    }
  }
  return total;
}

/**
 * Exact current-corridor arclength inside the fog disc and its subset in the
 * projected player-road forward half-plane. `corridorLaneIds` is normally
 * produced by the endpoint-continuous aligned-lane closure in TrafficSystem;
 * keeping clipping pure makes the capacity formula independently testable.
 */
export function localTrafficCorridorLaneLengthsM(
  lanes: readonly PolylineLane[],
  corridorLaneIds: ReadonlySet<string>,
  centre: SimulationPoint,
  radius: number,
  projectedRoadHeading: number,
): { readonly current: number; readonly forward: number } {
  if (radius <= 0 || corridorLaneIds.size === 0) {
    return { current: 0, forward: 0 };
  }
  const axisX = Math.sin(projectedRoadHeading);
  const axisZ = Math.cos(projectedRoadHeading);
  let current = 0;
  let forward = 0;
  for (const lane of lanes) {
    if (!corridorLaneIds.has(lane.id)) continue;
    for (let index = 1; index < lane.points.length; index += 1) {
      const start = lane.points[index - 1];
      const end = lane.points[index];
      const interval = segmentIntervalWithinCircle(start, end, centre, radius);
      if (!interval) continue;
      current += (interval.to - interval.from) * interval.length;

      let from = interval.from;
      let to = interval.to;
      const startLongitudinal =
        (start.x - centre.x) * axisX + (start.z - centre.z) * axisZ;
      const deltaLongitudinal =
        (end.x - start.x) * axisX + (end.z - start.z) * axisZ;
      if (Math.abs(deltaLongitudinal) <= 1e-12) {
        if (startLongitudinal < 0) continue;
      } else {
        const boundary = -startLongitudinal / deltaLongitudinal;
        if (deltaLongitudinal > 0) from = Math.max(from, boundary);
        else to = Math.min(to, boundary);
      }
      if (to > from) forward += (to - from) * interval.length;
    }
  }
  return { current, forward };
}

const cellCoordinate = (value: number): number => Math.floor(value / RUNTIME_TRAFFIC_PORTAL_CELL_SIZE_M);
const cellKey = (x: number, z: number): string => `${x},${z}`;

/**
 * Static portal catalogue index. Cell traversal merely marks candidates; the
 * public consumer must scan `portals` in numeric index order, making Map/cell
 * insertion order incapable of changing a simulation decision.
 */
export class RuntimeTrafficPortalIndex {
  readonly portals: readonly RuntimeTrafficPortal[];
  private readonly cells = new Map<string, number[]>();
  private readonly marks: Int32Array;
  /** Candidate order for the latest cell query. It is populated in fixed
   * cell-coordinate order and each cell's pre-sorted portal order, so runtime
   * activation can walk only the queried band rather than re-scan the full
   * catalogue to discover marked entries. */
  private readonly markedPortalIndices: Int32Array;
  private markedPortalCount = 0;
  private generation = 0;

  constructor(portals: readonly RuntimeTrafficPortal[]) {
    this.portals = [...portals].sort((left, right) => left.id.localeCompare(right.id));
    this.marks = new Int32Array(this.portals.length);
    this.markedPortalIndices = new Int32Array(this.portals.length);
    for (const [index, portal] of this.portals.entries()) {
      const key = cellKey(cellCoordinate(portal.x), cellCoordinate(portal.z));
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(index);
      else this.cells.set(key, [index]);
    }
  }

  reset(): void {
    this.marks.fill(0);
    this.markedPortalCount = 0;
    this.generation = 0;
  }

  /** Marks portals whose Euclidean centre lies in the inclusive radial band. */
  markAnnulus(
    centre: SimulationPoint,
    minimumRadiusM: number,
    maximumRadiusM: number,
  ): void {
    const minimum = Math.max(0, finiteNonNegative(minimumRadiusM));
    const maximum = Math.max(minimum, finiteNonNegative(maximumRadiusM));
    this.generation = this.generation === 0x7fff_ffff ? 1 : this.generation + 1;
    if (this.generation === 1) this.marks.fill(0);
    this.markedPortalCount = 0;
    const minCellX = cellCoordinate(centre.x - maximum);
    const maxCellX = cellCoordinate(centre.x + maximum);
    const minCellZ = cellCoordinate(centre.z - maximum);
    const maxCellZ = cellCoordinate(centre.z + maximum);
    const minimumSquared = minimum * minimum;
    const maximumSquared = maximum * maximum;
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let z = minCellZ; z <= maxCellZ; z += 1) {
        const bucket = this.cells.get(cellKey(x, z));
        if (!bucket) continue;
        for (const index of bucket) {
          const portal = this.portals[index];
          const dx = portal.x - centre.x;
          const dz = portal.z - centre.z;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared >= minimumSquared && distanceSquared <= maximumSquared) {
            this.marks[index] = this.generation;
            this.markedPortalIndices[this.markedPortalCount] = index;
            this.markedPortalCount += 1;
          }
        }
      }
    }
  }

  /** Whether a stable portal index belongs to the most recently marked band. */
  isMarked(index: number): boolean {
    return this.generation !== 0 && this.marks[index] === this.generation;
  }

  /** Number of portals in the latest annulus query. */
  get markedCount(): number {
    return this.generation === 0 ? 0 : this.markedPortalCount;
  }

  /** A stable candidate index from the latest annulus query. The caller may
   * apply its own deterministic cursor without walking unmarked catalogue
   * entries. */
  markedPortalIndexAt(index: number): number {
    return index >= 0 && index < this.markedCount ? this.markedPortalIndices[index] : -1;
  }

  /** Stable-order callback over the most recently marked portal band. */
  forEachMarked(visitor: (portal: RuntimeTrafficPortal, index: number) => boolean | void): void {
    // `reset()` deliberately restores generation zero. Without this guard a
    // direct debug/test iteration would mistake zero-filled marks for a live
    // query and expose the entire catalogue.
    if (this.generation === 0) return;
    for (let index = 0; index < this.portals.length; index += 1) {
      if (this.marks[index] !== this.generation) continue;
      if (visitor(this.portals[index], index) === false) return;
    }
  }
}
