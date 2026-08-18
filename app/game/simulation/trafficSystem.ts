import type { MutablePose, SimulationPoint, SimulationPose, TurnSignal } from "../simulation";
import {
  angleDifference,
  approachAngle,
  clamp,
  distanceSquared,
  distanceToSegmentSquared,
  lerpAngle,
  moveTowards,
  smoothStep,
  wrapAngle,
} from "./mathUtils";
import { PLAYER_RADIUS_METRES, type PlayerPhysicsState } from "./playerDynamics";
import {
  ROUTE_LOOKAHEAD_LIMIT_M,
  ROUTE_LOOKAHEAD_MAX_HOPS,
} from "./roadNetwork";
import type { LaneProjection, NormalizedLane, RoadNetwork } from "./roadNetwork";
import { TrafficSpatialIndex } from "./trafficSpatialIndex";
import { isTrafficNpcPatrol } from "./trafficIdentity";
import {
  LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
  LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
  LOCAL_TRAFFIC_APPROACHING_HEADING_DOT_MIN,
  LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M,
  LOCAL_TRAFFIC_APPROACH_INTERCEPT_GRACE_SECONDS,
  LOCAL_TRAFFIC_APPROACH_INTERCEPT_MIN_PLAYER_SPEED_MPS,
  LOCAL_TRAFFIC_AHEAD_FEED_ADMISSION_CADENCE_SECONDS,
  LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
  LOCAL_TRAFFIC_CORRIDOR_HALF_WIDTH_M,
  LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP,
  LOCAL_TRAFFIC_DESKTOP_LANE_OCCUPANCY_CAP,
  LOCAL_TRAFFIC_DESKTOP_MOVING_NEAR_VIEW_TARGET,
  LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_RADIUS_M,
  LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_TARGET,
  LOCAL_TRAFFIC_DESKTOP_APPROACH_RESERVE,
  LOCAL_TRAFFIC_DESKTOP_PATROL_FOG_CAP,
  LOCAL_TRAFFIC_FOG_RADIUS_M,
  LOCAL_TRAFFIC_HYSTERESIS_DECISIONS,
  LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET,
  LOCAL_TRAFFIC_IMMINENT_APPROACH_ETA_SECONDS,
  LOCAL_TRAFFIC_INNER_RADIUS_M,
  LOCAL_TRAFFIC_INITIAL_PORTAL_ATTEMPT_BUDGET,
  LOCAL_TRAFFIC_LOCAL_HANDOFF_MAX_ETA_SECONDS,
  LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS,
  LOCAL_TRAFFIC_PORTAL_ATTEMPTS_PER_IDENTITY,
  LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
  LOCAL_TRAFFIC_PATROL_INNER_CAP,
  LOCAL_TRAFFIC_PERCEPTUAL_RADIAL_OVERSHOOT_CAP,
  LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR,
  LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS,
  LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS,
  LOCAL_TRAFFIC_TARGET_RECOMPUTE_DISTANCE_M,
  LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP,
  LOCAL_TRAFFIC_TOUCH_LANE_OCCUPANCY_CAP,
  LOCAL_TRAFFIC_TOUCH_MOVING_NEAR_VIEW_TARGET,
  LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_RADIUS_M,
  LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_TARGET,
  LOCAL_TRAFFIC_TOUCH_APPROACH_RESERVE,
  LOCAL_TRAFFIC_TOUCH_PATROL_FOG_CAP,
  RUNTIME_TRAFFIC_APPROACH_MAX_M,
  RUNTIME_TRAFFIC_APPROACH_MIN_M,
  RUNTIME_TRAFFIC_CIRCULATION_MIN_M,
  RUNTIME_TRAFFIC_EXCEPTION_RECYCLE_RADIUS_M,
  RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS,
  RUNTIME_TRAFFIC_MIN_CONTINUOUS_ROUTE_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  RUNTIME_TRAFFIC_RECYCLE_RADIUS_M,
  RuntimeTrafficPortalIndex,
  localTrafficCorridorLaneLengthsM,
  localTrafficLaneLengthM,
  resolveLocalTrafficTargets,
  resolveTopologyAwareLocalTrafficTargets,
  type RuntimeTrafficPortal,
  type TrafficPerceptualTargets,
  type TrafficPopulationTargets,
} from "./trafficLocality";

/**
 * Seeded NPC spawn, routing, movement, signals, and jam/incident recovery —
 * ambient traffic end to end. Unlike `playerDynamics.ts`, this seam *is* a
 * class: `npcs`, `random`, `trafficGates`, and the NPC-id digit-parse cache
 * are state genuinely private to traffic, the same shape `RoadNetwork` uses
 * for its own scratch state.
 *
 * `roadNetwork`, `playerState`, and `config` are captured once in the
 * constructor rather than threaded through every call: `roadNetwork` is
 * `readonly` on `SimulationCore` and never reassigned; `playerState` is the
 * same stable, never-reassigned container `playerDynamics.ts` mutates in
 * place (only its `.player` sub-property changes); `config` is fully
 * immutable for the instance's lifetime. None of that holds for
 * `roadState` (wholesale-reassigned every `updateRoadState()`),
 * `viewHeading`/`elapsedSeconds`/`tick` (bare primitive fields) — those are
 * threaded through as an explicit `TrafficTickCtx`, built fresh by
 * `simulation.ts` at each call site, on every method that needs any of
 * them, even where a given method only reads one field of it: one shared
 * shape threaded uniformly through the whole call graph is far less
 * error-prone than a bespoke narrow parameter list per method, and the
 * cost is a few unread destructured fields — free at this call rate (a
 * handful of calls per fixed step, not per NPC).
 *
 * `SeededRandom` moved here too: the determinism contract
 * (docs/simulation-core.md) is "one PRNG, consumed in exactly two places:
 * initial NPC spawn, and the 10 Hz decision pass" — both fully owned by
 * this class already, so the random-consumption order carries over
 * unchanged with nothing else able to observe or perturb it.
 *
 * Moved verbatim out of `simulation.ts` (issue #284) — every method body is
 * byte-identical to its pre-split original, `this.` renamed to operate on
 * this class's own fields (or the captured `roadNetwork`/`playerState`/
 * `config`, or the passed-in `ctx`) instead.
 */

// "police" is gate-assigned only (a named spawn gate), never rolled by
// randomVehicleVariant — the simulation treats it exactly like a car and the
// renderer dresses it as a patrol.
export type NpcVehicleVariant = "car" | "taxi" | "bus" | "van" | "police";
const NPC_VEHICLE_VARIANTS: readonly NpcVehicleVariant[] = [
  "car",
  "taxi",
  "bus",
  "van",
  "police",
];
export type NpcDrivingState =
  | "cruising"
  | "following"
  | "stopping"
  | "yielding"
  | "signaling"
  | "roundabout"
  | "merging"
  | "lane-changing"
  | "recovering";

const LOCALITY_COMMIT_FOG = 1 << 0;
const LOCALITY_COMMIT_INNER = 1 << 1;
const LOCALITY_COMMIT_CURRENT = 1 << 2;
const LOCALITY_COMMIT_FORWARD = 1 << 3;
const LOCALITY_COMMIT_AHEAD = 1 << 4;
const LOCALITY_COMMIT_PIPELINE = 1 << 5;
const LOCALITY_COMMIT_TARGET_MASK =
  LOCALITY_COMMIT_FOG |
  LOCALITY_COMMIT_INNER |
  LOCALITY_COMMIT_CURRENT |
  LOCALITY_COMMIT_FORWARD |
  LOCALITY_COMMIT_AHEAD;
/** A moving projected arrival renews its ownership of a target. Thirty
 * seconds without route-distance progress is a deterministic failure, not a
 * reason to duplicate a healthy but long urban feed. */
const LOCALITY_COMMITMENT_NO_PROGRESS_SECONDS = 30;
/** A progressing 750 m urban feed may legitimately need longer than 30 s.
 * This is only an absolute backstop: reservation and guidance are cleared
 * atomically on contribution, invalidity, or the no-progress deadline. */
const LOCALITY_ROUTE_GOAL_TIMEOUT_SECONDS = 120;
type LocalityRouteGoal = 0 | 1 | 2 | 3;
const LOCALITY_ROUTE_GOAL_NONE: LocalityRouteGoal = 0;
const LOCALITY_ROUTE_GOAL_CURRENT: LocalityRouteGoal = 1;
const LOCALITY_ROUTE_GOAL_FORWARD: LocalityRouteGoal = 2;
const LOCALITY_ROUTE_GOAL_APPROACH: LocalityRouteGoal = 3;

interface LocalityRouteGoalTable {
  readonly laneCount: number;
  /** One label per `(remaining-hop budget, lane)`. */
  readonly distanceFromLaneStartByHopBudget: Float64Array;
  /** Actual transitions used by that selected label; `0xffff` is unreachable. */
  readonly usedHopsByHopBudget: Uint16Array;
  readonly nextLaneIndexByHopBudget: Int32Array;
  /** Stable target selected by each bounded label. Capacity collects unique
   * reachable target intervals rather than counting source portals that may
   * all funnel into the same short lane. */
  readonly targetLaneIndexByHopBudget: Int32Array;
  /** First contiguous contribution interval on a target lane. These prevent a
   * portal after that interval from being credited by subtracting arclength. */
  readonly targetEntryDistance: Float64Array;
  readonly targetExitDistance: Float64Array;
  /** A target interval can accept a car already on its lane without being a
   * safe reverse-graph entry from that lane's start. Long same-direction
   * lanes that straddle the player use this to expose their forward half only
   * to direct origins already at/after that half. */
  readonly targetMinimumDirectOriginDistance: Float64Array;
  readonly targetAllowsPredecessorEntry: Uint8Array;
}

interface LocalityRouteGoalSeed {
  readonly laneIndex: number;
  readonly entryDistance: number;
  readonly exitDistance: number;
  readonly minimumDirectOriginDistance?: number;
  readonly allowPredecessorEntry?: boolean;
}

interface LocalityRoutePlan {
  /** Successor lane indices, excluding the lane that owns the portal/current
   * pose. The sequence is materialized once so later load-table rebuilds
   * cannot redirect an existing identity into a new funnel. */
  readonly successorLaneIndices: readonly number[];
  readonly targetLaneIndex: number;
  readonly targetEntryDistance: number;
  readonly targetExitDistance: number;
  readonly physicalDistanceM: number;
}

interface LocalityAdmissionRouteTable {
  readonly laneCount: number;
  readonly physicalDistanceByHopBudget: Float64Array;
  readonly routingCostByHopBudget: Float64Array;
  readonly usedHopsByHopBudget: Uint16Array;
  readonly nextLaneIndexByHopBudget: Int32Array;
  readonly targetLaneIndexByHopBudget: Int32Array;
}

/** Target load dominates path length; path load then distributes common
 * trunks before physical distance breaks ties. Physical admission remains
 * independently bounded to 750 m / 12 hops. */
const LOCALITY_ROUTE_TARGET_LOAD_COST_M = 100_000;
const LOCALITY_ROUTE_PATH_LOAD_COST_M = 1_000;

const stableRouteLaneSalt = (laneId: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < laneId.length; index += 1) {
    hash ^= laneId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * A deterministic, authored portal through which an NPC may enter traffic.
 * Runtime gates should be placed at a map edge or behind authored occlusion;
 * the simulation additionally enforces distance, headway, and prediction rules.
 */
export interface SimulationTrafficGate {
  readonly id: string;
  readonly laneId: string;
  /** Distance in metres from the beginning of the lane. */
  readonly distance: number;
  readonly variant?: NpcVehicleVariant;
  readonly desiredSpeedMps?: number;
  /** Set false for portals that must never be populated at scenario start. */
  readonly allowInitialSpawn?: boolean;
}

interface NormalizedTrafficGate {
  id: string;
  laneId: string;
  distance: number;
  variant?: NpcVehicleVariant;
  desiredSpeedMps?: number;
  allowInitialSpawn: boolean;
  /** Runtime catalogue entries obey the stricter hidden approach band. */
  runtime?: boolean;
}

export interface NpcInternal extends MutablePose {
  id: string;
  /** Stable `npcsList` position, used as the deterministic spatial-index key. */
  slotIndex: number;
  laneId: string;
  variant: NpcVehicleVariant;
  /** Stable identity role shared with presentation; never recomputed on a hot
   * population pass and never changes when this slot recycles. */
  patrol: boolean;
  active: boolean;
  /** A recycle has been requested, but this visual remains authoritative until
   * it has travelled safely beyond the presentation envelope. */
  pendingRecycle: boolean;
  /** The current recycle request's conservative release radius. Ordinary
   * population shedding remains at 800 m; exceptional route/jam/collision
   * recovery can release only beyond the proven 500 m presentation envelope. */
  pendingRecycleMinimumDistanceM: number;
  /**
   * A runtime recycle must be observable as an inactive slot before that
   * stable id is reused at another portal. This prevents a snapshot consumer
   * from interpreting a safe despawn/spawn as an impossible lane jump.
   */
  runtimeActivationEligibleTick: number;
  /** Target-specific hard-feed promises made when a hidden portal is chosen.
   * They survive geometric band changes until that exact bucket is reached. */
  localityCommitmentBits: number;
  localityCommitmentExpiresAtSeconds: number;
  localityCommitmentLastRouteDistanceM: number;
  /** A temporary deterministic destination route for a hard locality feed.
   * Zero resumes the ordinary shared route policy. */
  localityRouteGoal: LocalityRouteGoal;
  /** Remaining transition budget in the selected `(lane,hops)` goal label. */
  localityRouteGoalRemainingHops: number;
  localityRouteGoalExpiresAtSeconds: number;
  localityRoutePlanLaneIndices: number[];
  localityRoutePlanCursor: number;
  localityRoutePlanTargetLaneIndex: number;
  localityRoutePlanTargetDistance: number;
  localityRoutePlanTargetExitDistance: number;
  localityRoutePlanGeneration: number;
  localityRoutePlanDeferredUntilReservationClears: boolean;
  /** A hidden portal and its materialized goal plan proved before this active
   * slot was retired. The id survives the required inactive snapshot so the
   * next locality decision activates the exact admission it made room for. */
  preparedLocalityGateId?: string;
  preferredGateId?: string;
  activatedAtSeconds: number;
  transitionCount: number;
  distance: number;
  speedMps: number;
  desiredSpeedMps: number;
  /**
   * How briskly this driver takes a posted limit, as a fraction of it, drawn
   * once at spawn. Kept so `desiredSpeedMps` can be re-derived against each new
   * road instead of latching the spawn road's figure for life — without it a
   * car that starts on an arterial carries that speed into a 20 km/h lane.
   *
   * Left undefined when a traffic gate authored an absolute speed: that number
   * is a scripted setpiece, not a driving style, so it must not be rescaled.
   */
  speedFactor?: number;
  targetSpeedMps: number;
  state: NpcDrivingState;
  signal: TurnSignal;
  targetLaneId?: string;
  laneChangeProgress: number;
  /**
   * The lane this car just hopped off, kept while it is still inside the
   * entry half of the corner-arc window so the arc pose can keep bridging
   * both lanes (#19). Cleared once the car is past the window, and on any
   * spawn or despawn.
   */
  cornerFromLaneId?: string;
  /** Exclusive successor ownership acquired before the rendered corner arc.
   * It pins routing and keeps a car from stopping half-turned in a junction. */
  successorReservationFromLaneId?: string;
  successorReservationLaneId?: string;
  signalSeconds: number;
  stoppedSeconds: number;
  /** Seconds spent jammed against other traffic (no signal/yield reason). */
  jamSeconds: number;
  /** Display-only lean applied to the rendered pose during an incident. */
  incidentLeanRad: number;
  /** Tick until which this car holds position after the player struck it. */
  struckUntilTick: number;
  decisionCooldown: number;
  previousX: number;
  previousZ: number;
}

// Exported: simulation.ts's own fixedUpdate uses this for the traffic-decision
// accumulator's while-loop threshold, the same value this class ticks its own
// per-NPC decisions against.
export const TRAFFIC_DECISION_SECONDS = 0.1;
// Exported: simulation.ts's own checkCollisions and isNpcFaultCollision (the
// player/NPC impact resolver, which stayed in the facade — see
// playerDynamics.ts's doc comment for why) need the NPC collision radius too.
export const NPC_RADIUS_METRES = 1.0;
const NPC_MIN_BUMPER_CLEARANCE_M = 3;
// Historically PLAYER_RADIUS + NPC_RADIUS + 4 — pinned to that value: this
// gap spaces NPCs behind OTHER NPCS, so it must not stretch or shrink with
// whatever the player happens to be driving.
const NPC_FOLLOW_STANDSTILL_GAP_M = 6.05;
const NPC_LANE_CHANGE_DISTANCE_M = 12;
const NPC_LANE_CHANGE_SIGNAL_SECONDS = 1.2;
const NPC_LANE_CHANGE_END_MARGIN_M = 2;
// NPC-to-NPC clearance at a lane entry, pinned for the same reason as the
// follow gap above (was PLAYER_RADIUS + NPC_RADIUS + 3).
const NPC_LANE_ENTRY_CLEARANCE_M = 5.05;
const NPC_CROSSING_YIELD_CLEARANCE_M = NPC_RADIUS_METRES * 2 + 3;
// A rendered vehicle is ~3.75 m long, but the physics model treats every car as
// a ~1 m-radius disc. Holding at least a body length of centre-to-centre spacing
// where cars physically hem each other in keeps a compressing or converging
// queue bumper-to-bumper instead of letting the low-poly meshes interpenetrate.
const NPC_BODY_CLEARANCE_M = 3.8;
// When a car makes no progress for this long while obeying no signal or yield —
// i.e. it is genuinely jammed against other traffic after a converging bump —
// it is recycled through the deterministic traffic-gate queue, so the incident
// clears like a real fender-bender being towed instead of blocking the lane
// forever. Shortly before that it is nudged askew so the contact reads as a
// knock rather than two cars politely halted in line.
const NPC_INCIDENT_KNOCK_SECONDS = 2.5;
const NPC_INCIDENT_STUCK_SECONDS = 6;
/**
 * How far *behind* the give-way bar a circulating vehicle may already be and
 * still hold an entering one. Zero would let a driver enter alongside a car
 * that is level with the mouth and about to sweep across it.
 */
const ROUNDABOUT_YIELD_SIDE_ALLOWANCE_M = 2.5;
// Exported: simulation.ts's own checkCollisions applies the same askew-knock
// lean to a player-struck car.
export const NPC_INCIDENT_KNOCK_RAD = 0.16;
// A car the player crashes into sits knocked askew and holds position this
// long (in ticks) before pulling away again; behind it the ordinary jam
// machinery clears any pile-up exactly as for NPC-NPC knocks. Also read by
// simulation.ts's own checkCollisions, which sets struckUntilTick on impact.
export const NPC_STRUCK_TICKS = 360;
// NPC heading is chased toward the lane pose rather than assigned, so a car
// sweeps through a junction turn the way a steered vehicle would instead of
// snapping to each new centreline segment (#19). The rate scales like a car
// holding a tight urban corner (omega = v / r), floored so a crawling car
// still completes its turn and capped so fast traffic cannot wag.
const NPC_MIN_TURN_RADIUS_M = 4.6;
const NPC_YAW_RATE_MIN_RAD_S = 0.9;
const NPC_YAW_RATE_MAX_RAD_S = 2.6;
// A pose-heading jump beyond this is an authored reversal (a turning-loop
// apex, a U-turn successor), not a corner: snap instantly as before rather
// than sweeping — a car should never visibly rotate ~180 degrees in place.
const NPC_HEADING_SNAP_RAD = 2.4;
// Within this arc distance of a lane hop the NPC's rendered pose rides a
// corner arc between the two lane lines instead of the authored centreline,
// which converges on the shared junction node (#19). The window covers the
// ~6.3 m connector blends with margin, so the node convergence is never
// visible: turns hug the true corner, straights stay straight.
const NPC_CORNER_WINDOW_M = 7;
// Hops bending less than this ride the straight chord between the window
// ends; sharper hops get a quadratic arc around the lane-line intersection.
const NPC_CORNER_MIN_TURN_RAD = 0.35;
// An arc apex further than this from either window end means the lane lines
// barely converge (near-parallel rays); the chord is the sane path.
const NPC_CORNER_MAX_APEX_M = 40;
// Samples for the arc-length table that maps window progress onto the corner
// Bezier at uniform speed — raw Bezier parameterization runs up to ~1.4x
// faster near a skewed apex, which would teleport the pose past the car's
// physical travel for the tick.
const NPC_CORNER_ARC_SAMPLES = 10;
// An arc more than 10% longer than the lane window it replaces would force
// the pose to sweep faster than the car drives; ride the chord instead (the
// chord is never longer than the window, by the triangle inequality through
// the node).
const NPC_CORNER_MAX_ARC_STRETCH = 1.1;
// Never recycle (vanish) a jammed car this close to the player; hold it visible
// until they have moved on, so traffic never pops out of existence beside them.
const NPC_INCIDENT_PLAYER_CLEARANCE_M = 26;
const INITIAL_PLAYER_CLEARANCE_AHEAD_M = 20;
const INITIAL_CROSS_LANE_CLEARANCE_M = 12;
// Exported: simulation.ts's own isNpcFaultCollision (checkCollisions's
// fault-attribution helper, which stayed in the facade) uses the same grace
// window to decide whether a just-spawned NPC gets the benefit of the doubt.
export const SPAWN_PREDICTION_SECONDS = 4;
export const RUNTIME_FORWARD_VISIBILITY_DISTANCE_M = 180;
export const RUNTIME_REAR_VISIBILITY_DISTANCE_M = 115;
const RUNTIME_FORWARD_HALF_ANGLE_RAD = (58 * Math.PI) / 180;
const RUNTIME_REAR_HALF_ANGLE_RAD = (42 * Math.PI) / 180;

// Exported: simulation.ts's own constructor normalizes the authored seed the
// same way, once, to populate InternalConfig.seed (write-only, kept as-is —
// out of scope for issue #284) and to pass to this class's constructor. The
// two normalizations compose to the identity (this function is idempotent
// on an already-normalized value), matching the pre-split double call.
export function normalizeSeed(seed: number | undefined): number {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed as number) >>> 0 : 1;
  return normalized || 0x6d2b79f5;
}

/** Small deterministic PRNG whose state advances only on traffic decision ticks. */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

/** The volatile-per-tick inputs traffic decisions need: everything else
 * (`roadNetwork`, `playerState`, `config`) is captured once at construction —
 * see the class doc comment for why these four specifically cannot be. */
export interface TrafficTickCtx {
  readonly viewHeading: number;
  // Widened to the facade's full RoadState shape (not just `projection`) so
  // simulation/roadRuleMonitor.ts can reuse this exact ctx type and the same
  // per-tick ctx object simulation.ts already builds — TrafficSystem's own
  // methods still only ever read `.projection` off it.
  readonly roadState: {
    readonly projection: LaneProjection | null;
    readonly wrongWay: boolean;
    readonly offRoad: boolean;
    readonly inServiceArea: boolean;
  };
  readonly elapsedSeconds: number;
  readonly tick: number;
}

export interface TrafficSystemConfig {
  readonly playerRadiusM: number;
  readonly minRuntimeSpawnDistanceM: number;
  /** Optional so direct legacy TrafficSystem construction remains valid; the
   * adapter/core always provide all three locality fields together. */
  readonly runtimeTrafficPortals?: readonly RuntimeTrafficPortal[];
  readonly trafficCapacityLaneIds?: readonly string[];
  readonly touchFirst?: boolean;
}

export interface TrafficSpatialIndexDiagnostics {
  /** Cumulative broad-phase candidates consumed by leadVehicleGap this run. */
  readonly leadCandidateCount: number;
  /** Cumulative exact routeDistanceAhead calls surviving that broad phase. */
  readonly leadExactRouteCheckCount: number;
}

export interface TrafficLocalityDiagnostics {
  readonly enabled: boolean;
  readonly poolCount: number;
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly withinFogCount: number;
  readonly withinInnerCount: number;
  /** Inner-window vehicles with non-trivial physical motion. */
  readonly movingWithinInnerCount: number;
  /** Vehicles on the projected player road or an aligned paired carriageway. */
  readonly currentRoadCorridorCount: number;
  /** Current-road vehicles ahead along the player's road heading. */
  readonly forwardCorridorCount: number;
  /** Stable-route vehicles whose tangent and successor path approach the
   * player's current-road area. */
  readonly approachingCorridorCount: number;
  /** Union of forward current-road traffic and route-proven approaching cross
   * traffic. */
  readonly aheadOrApproachingCount: number;
  /** Player-centred close-presence buckets, independent of camera heading. */
  readonly nearViewCount: number;
  readonly movingNearViewCount: number;
  /** Four deterministic 90-degree local buckets, anchored to the player road
   * rather than the movable camera. Boundary ties go forward/rear first. */
  readonly sectorForwardCount: number;
  readonly sectorRightCount: number;
  readonly sectorRearCount: number;
  readonly sectorLeftCount: number;
  readonly patrolWithinFogCount: number;
  readonly patrolWithinInnerCount: number;
  readonly patrolFogCap: number;
  readonly patrolInnerCap: number;
  /** True only while the visible local window has no traffic ahead and no
   * route-proven approaching traffic. */
  readonly ghostGap: boolean;
  readonly ghostGapDecisionCount: number;
  readonly approachCount: number;
  /** Active vehicles in the full 500–680 m circulation/handoff band. */
  readonly circulatingCount: number;
  /** Approach-band vehicles whose current tangent points toward the player.
   * Outbound cars are retained for diagnostics but do not consume an incoming
   * replacement slot. */
  readonly inboundApproachCount: number;
  /** Inbound cars in the final 500–520 m hand-off corridor and outer approach
   * band. This includes the short pre-fog interval, so the
   * controller does not queue a second batch while a first batch is already
   * about to enter the local window. */
  readonly inboundTransitCount: number;
  /** Inbound transit whose current deterministic successor path is proven to
   * reach the inner target. */
  readonly inboundInnerTransitCount: number;
  /** Inbound transit whose stable route reaches the 90 m current-road area. */
  readonly inboundPerceptualTransitCount: number;
  /** Subset with an actual current-target ETA of ten seconds or less. Only
   * this subset may suppress a close-presence deficit. */
  readonly inboundImminentPerceptualTransitCount: number;
  readonly inboundCurrentRoadTransitCount: number;
  readonly inboundForwardTransitCount: number;
  readonly pendingRecycleCount: number;
  readonly targetWithinFog: number;
  readonly targetWithinInner: number;
  readonly targetMovingWithinInner: number;
  readonly targetCurrentRoadCorridor: number;
  readonly targetForwardCorridor: number;
  readonly targetAheadOrApproaching: number;
  readonly targetNearView: number;
  readonly targetMovingNearView: number;
  /** Current bounded number of independently staged cross-traffic journeys. */
  readonly targetAheadJourneyCount: number;
  readonly approachRouteFeedAvailable: boolean;
  /** Cumulative active-fleet route handoffs; these change no lifecycle or
   * presentation state and are separated from activations/retirements. */
  readonly localHandoffCount: number;
  /** Active immutable cross-approach destinations, including hidden and local
   * handoffs. The remaining counters make a failed moving-density probe
   * attributable without logging per-NPC state on the hot path. */
  readonly liveApproachGoalCount: number;
  readonly localHandoffAttemptCount: number;
  readonly localHandoffCadenceBlockedCount: number;
  readonly localHandoffNoCandidateCount: number;
  readonly localHandoffRoleOrIncidentBlockedCount: number;
  readonly localHandoffUnreachableCount: number;
  readonly localHandoffTargetCapacityBlockedCount: number;
  readonly localHandoffEtaBlockedCount: number;
  readonly localHandoffAcceptedEtaP50Seconds: number;
  readonly approachGoalContributionCount: number;
  readonly approachGoalFailureCount: number;
  readonly approachGoalRecenterReleaseCount: number;
  readonly targetCirculatingApproach: number;
  /** Nested fast-feed miss reallocated into inner/ahead continuity supply;
   * storage-backed current/forward targets remain independently enforced. */
  readonly targetCorridorContinuityCompensation: number;
  /** Cached hidden target-interval slots with a structural <=30 s feed. */
  readonly streamableCurrentRoadCapacity: number;
  readonly streamableForwardCorridorCapacity: number;
  readonly portalAttempts: number;
  /** Work consumed by the most recent 10 Hz locality decision. These are
   * bounded independently of catalogue size and are useful for perf probes. */
  readonly lastDecisionPortalAttempts: number;
  readonly lastDecisionActivations: number;
  readonly lastDecisionRetirements: number;
  readonly activations: number;
  readonly retirements: number;
}

type LocalTrafficSector = 0 | 1 | 2 | 3;

interface LocalTrafficPortalPreference {
  readonly preferCurrentRoadCorridor?: boolean;
  readonly preferForwardCorridor?: boolean;
  readonly preferAheadOrApproaching?: boolean;
  readonly requireCurrentRoadCorridor?: boolean;
  readonly requireForwardCorridor?: boolean;
  readonly requireAheadOrApproaching?: boolean;
  /** An outer-density admission must remain outside the 250 m inner target on
   * its stable lookahead, so filling fog cannot become a delayed centre wave. */
  readonly outerLocalOnly?: boolean;
  readonly preferredSector?: LocalTrafficSector;
  /** Density replacement must prove a route into its target. Pure circulation
   * deliberately stays in the hidden outer/recycle band instead. */
  readonly requireRouteConnection?: boolean;
  /** Defaults true. Outer circulation sets false so the reserve does not form
   * a delayed wave converging on the player's junction. */
  readonly preferInbound?: boolean;
  /** Require the stable path to cross the 800 m recycle boundary before it can
   * touch the 440 m local circle, or remain outside it for at least 1 km of
   * continuous travel. Used by the non-inbound reserve. */
  readonly outerCirculationOnly?: boolean;
  /** The single proactive hard feeder is distinguished from the outer reserve
   * so reset/runtime control cannot admit a synchronized inbound wave. */
  readonly proactivePipeline?: boolean;
}

export class TrafficSystem {
  private readonly roadNetwork: RoadNetwork;
  private readonly playerState: PlayerPhysicsState;
  private readonly config: TrafficSystemConfig;
  private readonly trafficGates: NormalizedTrafficGate[];
  /** Explicit variant gates are authored identity placements. Keep their
   * lookup separate from the streaming catalogue so fresh-core locality
   * priming cannot accidentally turn a named bus/taxi/patrol into a generic
   * runtime car. */
  private readonly trafficGatesById: ReadonlyMap<string, NormalizedTrafficGate>;
  /** Compatibility and stable id order are precomputed once. Deferred legacy
   * gate activation must not filter/copy/sort the whole gate catalogue for
   * every queued NPC. */
  private readonly compatibleTrafficGatesByVariant: Readonly<
    Record<NpcVehicleVariant, readonly NormalizedTrafficGate[]>
  >;
  private readonly runtimeTrafficGates: readonly NormalizedTrafficGate[];
  private readonly runtimeTrafficGatesById: ReadonlyMap<
    string,
    NormalizedTrafficGate
  >;
  private readonly runtimePortalIndex: RuntimeTrafficPortalIndex;
  private readonly trafficCapacityLaneIds: ReadonlySet<string>;
  /** One precomputed salt per normalized lane keeps stable branch diversity
   * out of string-hash work in movement and portal-route probes. */
  private readonly routeLaneSalts: Uint32Array;
  private readonly predecessorLaneIndicesByLaneIndex: readonly (readonly number[])[];
  private readonly localityEnabled: boolean;
  private readonly trafficSpatialIndex: TrafficSpatialIndex;
  /** Memo for parsedNpcDigits; NPC ids are stable within a session. */
  private readonly npcDigitCache = new Map<string, number>();
  private random: SeededRandom;
  private trafficIdentitySeed: number;
  private npcsList: NpcInternal[] = [];
  private leadCandidateCount = 0;
  private leadExactRouteCheckCount = 0;
  private portalCursor = 0;
  private densityDeficitDecisions = 0;
  private densitySurplusDecisions = 0;
  private localityTarget: TrafficPopulationTargets = { withinFog: 0, withinInner: 0 };
  private localityPerceptualTarget: TrafficPerceptualTargets = {
    movingWithinInner: 0,
    currentRoadCorridor: 0,
    forwardCorridor: 0,
    aheadOrApproaching: 0,
    circulatingApproach: 0,
  };
  private localityTargetAnchorX = Number.NaN;
  private localityTargetAnchorZ = Number.NaN;
  private localityTargetLaneId = "";
  private localityPlayerProjection: LaneProjection | null = null;
  private localityCurrentRouteGoalTable: LocalityRouteGoalTable | null = null;
  private localityForwardRouteGoalTable: LocalityRouteGoalTable | null = null;
  private localityApproachRouteGoalTable: LocalityRouteGoalTable | null = null;
  /** Per-admission weighted tables. They are invalidated whenever occupancy
   * or a target mask changes; a failed portal identity reuses the same bounded
   * arrays instead of rebuilding them for each four-candidate window. */
  private localityCurrentAdmissionRouteTable: LocalityAdmissionRouteTable | null = null;
  private localityForwardAdmissionRouteTable: LocalityAdmissionRouteTable | null = null;
  private localityApproachAdmissionRouteTable: LocalityAdmissionRouteTable | null = null;
  private localityCurrentAdmissionRouteTableDirty = true;
  private localityForwardAdmissionRouteTableDirty = true;
  private localityApproachAdmissionRouteTableDirty = true;
  private localityProjectedRouteLaneLoadScratch = new Uint16Array(0);
  private localityRouteGoalAnchorX = Number.NaN;
  private localityRouteGoalAnchorZ = Number.NaN;
  private localityRouteGoalRoadId = "";
  private localityRouteGoalLaneId = "";
  private localityRouteGoalGeneration = 0;
  /** Endpoint-continuous, heading-aligned player corridor rebuilt with the
   * route-goal anchor. One byte per immutable lane keeps hot classification
   * and portal scoring O(1). */
  private localityCurrentCorridorLaneMask: Uint8Array = new Uint8Array(0);
  private localityStreamableCurrentRoadCapacity = 0;
  private localityStreamableForwardCorridorCapacity = 0;
  private localityCorridorContinuityCompensation = 0;
  /** Unique target-interval masks reused by the eight-metre target refresh;
   * no route-capacity allocation occurs on the 10 Hz steady-state path. */
  private localityStreamableCurrentTargetScratch = new Uint8Array(0);
  private localityStreamableForwardTargetScratch = new Uint8Array(0);
  private localityWithinFogCount = 0;
  private localityWithinInnerCount = 0;
  private localityMovingWithinInnerCount = 0;
  private localityCurrentRoadCorridorCount = 0;
  private localityForwardCorridorCount = 0;
  private localityApproachingCorridorCount = 0;
  private localityAheadOrApproachingCount = 0;
  private localityNearViewCount = 0;
  private localityMovingNearViewCount = 0;
  private localitySectorForwardCount = 0;
  private localitySectorRightCount = 0;
  private localitySectorRearCount = 0;
  private localitySectorLeftCount = 0;
  private localityPatrolWithinFogCount = 0;
  private localityPatrolWithinInnerCount = 0;
  private localityBalanceSectorForwardCount = 0;
  private localityBalanceSectorRightCount = 0;
  private localityBalanceSectorRearCount = 0;
  private localityBalanceSectorLeftCount = 0;
  private localityBalanceCurrentRoadCorridorCount = 0;
  private localityGhostGapDecisionCount = 0;
  private localityApproachCount = 0;
  private localityCirculatingCount = 0;
  private localityInboundApproachCount = 0;
  private localityInboundPipelineCount = 0;
  private localityInboundTransitCount = 0;
  private localityInboundInnerTransitCount = 0;
  private localityInboundPerceptualTransitCount = 0;
  private localityInboundImminentPerceptualTransitCount = 0;
  private localityInboundCurrentRoadTransitCount = 0;
  private localityInboundForwardTransitCount = 0;
  private localityTargetAheadJourneyCount = 0;
  private localityApproachTargetAvailable = false;
  private localityApproachRouteFeedAvailable = false;
  private localityNextAheadFeedAdmissionSeconds = Number.NEGATIVE_INFINITY;
  private localityNextLocalHandoffAttemptSeconds = Number.NEGATIVE_INFINITY;
  private localityLocalHandoffs = 0;
  private localityLocalHandoffAttempts = 0;
  private localityLocalHandoffCadenceBlocks = 0;
  private localityLocalHandoffNoCandidates = 0;
  private localityLocalHandoffRoleOrIncidentBlocks = 0;
  private localityLocalHandoffUnreachable = 0;
  private localityLocalHandoffTargetCapacityBlocks = 0;
  private localityLocalHandoffEtaBlocks = 0;
  private localityLocalHandoffEtaHistogram = new Uint32Array(
    Math.ceil(LOCAL_TRAFFIC_LOCAL_HANDOFF_MAX_ETA_SECONDS) + 1,
  );
  private localityApproachGoalContributions = 0;
  private localityApproachGoalFailures = 0;
  private localityApproachGoalRecenterReleases = 0;
  private localityPendingRecycleCount = 0;
  private localityPortalAttempts = 0;
  private portalAttemptsThisDecision = 0;
  private localityDecisionActivations = 0;
  private localityDecisionRetirements = 0;
  private localityActivations = 0;
  private localityRetirements = 0;

  constructor(
    trafficGatesConfig: readonly SimulationTrafficGate[],
    roadNetwork: RoadNetwork,
    playerState: PlayerPhysicsState,
    config: TrafficSystemConfig,
    seed: number,
  ) {
    this.roadNetwork = roadNetwork;
    this.playerState = playerState;
    this.config = config;
    this.routeLaneSalts = Uint32Array.from(this.roadNetwork.lanes, (lane) =>
      stableRouteLaneSalt(lane.id),
    );
    const predecessorLaneIndices = Array.from(
      { length: this.roadNetwork.lanes.length },
      () => [] as number[],
    );
    for (const lane of this.roadNetwork.lanes) {
      if (lane.index === undefined) continue;
      for (const successorId of lane.successorLaneIds) {
        const successor = this.roadNetwork.lanesById.get(successorId);
        if (
          successor?.index === undefined ||
          !this.roadNetwork.areLaneEndpointsContinuous(lane, successor)
        ) {
          continue;
        }
        predecessorLaneIndices[successor.index].push(lane.index);
      }
    }
    this.predecessorLaneIndicesByLaneIndex = predecessorLaneIndices;
    this.trafficSpatialIndex = new TrafficSpatialIndex(this.roadNetwork);
    const normalizedRuntimePortals = (config.runtimeTrafficPortals ?? [])
      .flatMap((portal) => {
        if (!portal.id || !Number.isFinite(portal.distance)) return [];
        const lane = this.roadNetwork.lanesById.get(portal.laneId);
        if (!lane) return [];
        const distance = clamp(portal.distance, 0, lane.length);
        const pose = this.roadNetwork.pointOnLane(lane, distance);
        return [{
          id: portal.id,
          laneId: lane.id,
          distance,
          x: pose.x,
          z: pose.z,
          heading: pose.heading,
        }];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    this.runtimePortalIndex = new RuntimeTrafficPortalIndex(normalizedRuntimePortals);
    this.runtimeTrafficGates = this.runtimePortalIndex.portals.map((portal) => ({
      id: portal.id,
      laneId: portal.laneId,
      distance: portal.distance,
      allowInitialSpawn: true,
      runtime: true,
    }));
    this.runtimeTrafficGatesById = new Map(
      this.runtimeTrafficGates.map((gate) => [gate.id, gate]),
    );
    this.trafficCapacityLaneIds = new Set(
      (config.trafficCapacityLaneIds ?? []).filter((laneId) =>
        this.roadNetwork.lanesById.has(laneId),
      ),
    );
    this.localityEnabled =
      this.runtimeTrafficGates.length > 0 && this.trafficCapacityLaneIds.size > 0;
    const authoredTrafficGates = trafficGatesConfig
      .filter((gate) => this.roadNetwork.lanesById.has(gate.laneId))
      .map((gate) => {
        const lane = this.roadNetwork.lanesById.get(gate.laneId)!;
        return {
          id: gate.id,
          laneId: gate.laneId,
          distance: clamp(gate.distance, 0, lane.length),
          variant: gate.variant,
          desiredSpeedMps: Number.isFinite(gate.desiredSpeedMps)
            ? clamp(gate.desiredSpeedMps!, 1, lane.speedLimitMps * 1.05)
            : undefined,
          allowInitialSpawn: gate.allowInitialSpawn ?? true,
        };
      });
    this.trafficGates = authoredTrafficGates.length
      ? authoredTrafficGates
      : this.roadNetwork.lanes.flatMap((lane) =>
          [0.82, 0.5, 0.18].map((fraction, index) => ({
            id: `auto-${lane.id}-${index + 1}`,
            laneId: lane.id,
            distance: lane.length * fraction,
            allowInitialSpawn: true,
          })),
        );
    this.trafficGatesById = new Map(
      this.trafficGates.map((gate) => [gate.id, gate]),
    );
    const compatibleTrafficGatesByVariant: Record<
      NpcVehicleVariant,
      NormalizedTrafficGate[]
    > = {
      car: [],
      taxi: [],
      bus: [],
      van: [],
      police: [],
    };
    for (const gate of this.trafficGates) {
      for (const variant of NPC_VEHICLE_VARIANTS) {
        if (!gate.variant || gate.variant === variant) {
          compatibleTrafficGatesByVariant[variant].push(gate);
        }
      }
    }
    for (const variant of NPC_VEHICLE_VARIANTS) {
      compatibleTrafficGatesByVariant[variant].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    }
    this.compatibleTrafficGatesByVariant = compatibleTrafficGatesByVariant;
    this.trafficIdentitySeed = seed;
    this.random = new SeededRandom(seed);
  }

  /** Live reference, not a copy: `SimulationCore` (getSnapshot, checkCollisions)
   * reads and, for an individual NPC's own fields, mutates through this. Array
   * membership (add/remove) stays controlled only by this class's own methods. */
  get npcs(): readonly NpcInternal[] {
    return this.npcsList;
  }

  /** Re-seeds the PRNG and clears the id-digit memo — called by
   * `SimulationCore.reset()` before `spawnNpcs`. */
  resetForNewRun(seed: number): void {
    this.random = new SeededRandom(seed);
    this.trafficIdentitySeed = seed;
    this.npcDigitCache.clear();
    this.trafficSpatialIndex.reset(0);
    this.runtimePortalIndex.reset();
    this.leadCandidateCount = 0;
    this.leadExactRouteCheckCount = 0;
    this.portalCursor = 0;
    this.densityDeficitDecisions = 0;
    this.densitySurplusDecisions = 0;
    this.localityTarget = { withinFog: 0, withinInner: 0 };
    this.localityPerceptualTarget = {
      movingWithinInner: 0,
      currentRoadCorridor: 0,
      forwardCorridor: 0,
      aheadOrApproaching: 0,
      circulatingApproach: 0,
    };
    this.localityTargetAnchorX = Number.NaN;
    this.localityTargetAnchorZ = Number.NaN;
    this.localityTargetLaneId = "";
    this.localityPlayerProjection = null;
    this.localityCurrentRouteGoalTable = null;
    this.localityForwardRouteGoalTable = null;
    this.localityApproachRouteGoalTable = null;
    this.localityCurrentAdmissionRouteTable = null;
    this.localityForwardAdmissionRouteTable = null;
    this.localityApproachAdmissionRouteTable = null;
    this.localityCurrentAdmissionRouteTableDirty = true;
    this.localityForwardAdmissionRouteTableDirty = true;
    this.localityApproachAdmissionRouteTableDirty = true;
    this.localityProjectedRouteLaneLoadScratch = new Uint16Array(0);
    this.localityRouteGoalAnchorX = Number.NaN;
    this.localityRouteGoalAnchorZ = Number.NaN;
    this.localityRouteGoalRoadId = "";
    this.localityRouteGoalLaneId = "";
    this.localityRouteGoalGeneration = 0;
    this.localityCurrentCorridorLaneMask = new Uint8Array(0);
    this.localityStreamableCurrentRoadCapacity = 0;
    this.localityStreamableForwardCorridorCapacity = 0;
    this.localityCorridorContinuityCompensation = 0;
    this.localityStreamableCurrentTargetScratch = new Uint8Array(0);
    this.localityStreamableForwardTargetScratch = new Uint8Array(0);
    this.localityWithinFogCount = 0;
    this.localityWithinInnerCount = 0;
    this.localityMovingWithinInnerCount = 0;
    this.localityCurrentRoadCorridorCount = 0;
    this.localityForwardCorridorCount = 0;
    this.localityApproachingCorridorCount = 0;
    this.localityAheadOrApproachingCount = 0;
    this.localityNearViewCount = 0;
    this.localityMovingNearViewCount = 0;
    this.localitySectorForwardCount = 0;
    this.localitySectorRightCount = 0;
    this.localitySectorRearCount = 0;
    this.localitySectorLeftCount = 0;
    this.localityPatrolWithinFogCount = 0;
    this.localityPatrolWithinInnerCount = 0;
    this.localityBalanceSectorForwardCount = 0;
    this.localityBalanceSectorRightCount = 0;
    this.localityBalanceSectorRearCount = 0;
    this.localityBalanceSectorLeftCount = 0;
    this.localityBalanceCurrentRoadCorridorCount = 0;
    this.localityGhostGapDecisionCount = 0;
    this.localityApproachCount = 0;
    this.localityCirculatingCount = 0;
    this.localityInboundApproachCount = 0;
    this.localityInboundPipelineCount = 0;
    this.localityInboundTransitCount = 0;
    this.localityInboundInnerTransitCount = 0;
    this.localityInboundPerceptualTransitCount = 0;
    this.localityInboundImminentPerceptualTransitCount = 0;
    this.localityInboundCurrentRoadTransitCount = 0;
    this.localityInboundForwardTransitCount = 0;
    this.localityTargetAheadJourneyCount = 0;
    this.localityApproachTargetAvailable = false;
    this.localityApproachRouteFeedAvailable = false;
    this.localityNextAheadFeedAdmissionSeconds = Number.NEGATIVE_INFINITY;
    this.localityNextLocalHandoffAttemptSeconds = Number.NEGATIVE_INFINITY;
    this.localityLocalHandoffs = 0;
    this.localityLocalHandoffAttempts = 0;
    this.localityLocalHandoffCadenceBlocks = 0;
    this.localityLocalHandoffNoCandidates = 0;
    this.localityLocalHandoffRoleOrIncidentBlocks = 0;
    this.localityLocalHandoffUnreachable = 0;
    this.localityLocalHandoffTargetCapacityBlocks = 0;
    this.localityLocalHandoffEtaBlocks = 0;
    this.localityLocalHandoffEtaHistogram.fill(0);
    this.localityApproachGoalContributions = 0;
    this.localityApproachGoalFailures = 0;
    this.localityApproachGoalRecenterReleases = 0;
    this.localityPendingRecycleCount = 0;
    this.localityPortalAttempts = 0;
    this.portalAttemptsThisDecision = 0;
    this.localityDecisionActivations = 0;
    this.localityDecisionRetirements = 0;
    this.localityActivations = 0;
    this.localityRetirements = 0;
  }

  /** Matches the pre-split `this.npcs = []` inside `SimulationCore.dispose()`. */
  dispose(): void {
    this.npcsList = [];
    this.trafficSpatialIndex.reset(0);
    this.runtimePortalIndex.reset();
  }

  deactivateNpc(npc: NpcInternal): void {
    this.invalidateLocalityAdmissionRouteTables();
    this.trafficSpatialIndex.remove(npc.slotIndex);
    npc.active = false;
    npc.pendingRecycle = false;
    npc.pendingRecycleMinimumDistanceM = RUNTIME_TRAFFIC_RECYCLE_RADIUS_M;
    npc.localityCommitmentBits = 0;
    npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
    npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
    npc.localityRouteGoalRemainingHops = 0;
    npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    npc.localityRoutePlanLaneIndices.length = 0;
    npc.localityRoutePlanCursor = 0;
    npc.localityRoutePlanTargetLaneIndex = -1;
    npc.localityRoutePlanTargetDistance = Number.NaN;
    npc.localityRoutePlanTargetExitDistance = Number.NaN;
    npc.localityRoutePlanGeneration = 0;
    npc.localityRoutePlanDeferredUntilReservationClears = false;
    npc.preparedLocalityGateId = undefined;
    npc.speedMps = 0;
    npc.targetSpeedMps = 0;
    npc.state = "recovering";
    npc.signal = "off";
    npc.targetLaneId = undefined;
    npc.cornerFromLaneId = undefined;
    npc.successorReservationFromLaneId = undefined;
    npc.successorReservationLaneId = undefined;
    npc.laneChangeProgress = 0;
    npc.jamSeconds = 0;
    npc.incidentLeanRad = 0;
    npc.struckUntilTick = 0;
  }

  /**
   * The digits parsed out of an NPC id, possibly NaN — callers apply their
   * own fallback (numericNpcId's `|| 0` vs nextLaneForNpc's `|| 1`; the two
   * differ on purpose and must stay distinct). Memoised because the
   * regex + parse ran per NPC per step, and ids never change within a
   * session.
   */
  private parsedNpcDigits(id: string): number {
    const cached = this.npcDigitCache.get(id);
    if (cached !== undefined) return cached;
    const parsed = Number.parseInt(id.replace(/\D+/g, ""), 10);
    this.npcDigitCache.set(id, parsed);
    return parsed;
  }

  /** Public: simulation.ts's own checkCollisions uses this for the struck
   * car's display-only incident lean, the same as a traffic-jam knock. */
  numericNpcId(id: string): number {
    return this.parsedNpcDigits(id) || 0;
  }

  spawnNpcs(npcCount: number, ctx: TrafficTickCtx): void {
    this.npcsList = [];
    this.trafficSpatialIndex.reset(Math.max(0, Math.ceil(npcCount)));
    if (this.trafficGates.length === 0 || this.roadNetwork.lanes.length === 0) return;
    for (let index = 0; index < npcCount; index += 1) {
      const preferredGate = this.trafficGates[index % this.trafficGates.length];
      const lane = this.roadNetwork.lanesById.get(preferredGate.laneId) ?? this.roadNetwork.lanes[0];
      const pose = this.roadNetwork.pointOnLane(lane, preferredGate.distance);
      // The draw stays inside the branch that always made it, so the PRNG is
      // consumed the same number of times in the same order as before drivers
      // started carrying their style between roads.
      const speedFactor =
        preferredGate.desiredSpeedMps === undefined
          ? 0.68 + this.random.next() * 0.24
          : undefined;
      const desiredSpeedMps =
        preferredGate.desiredSpeedMps ?? lane.speedLimitMps * speedFactor!;
      const variant = preferredGate.variant ?? this.randomVehicleVariant();
      const id = `npc-${index + 1}`;
      const npc: NpcInternal = {
        id,
        slotIndex: index,
        variant,
        patrol: isTrafficNpcPatrol({
          vehicleId: id,
          trafficSeed: this.trafficIdentitySeed,
          variant,
        }),
        active: false,
        pendingRecycle: false,
        pendingRecycleMinimumDistanceM: RUNTIME_TRAFFIC_RECYCLE_RADIUS_M,
        runtimeActivationEligibleTick: 0,
        localityCommitmentBits: 0,
        localityCommitmentExpiresAtSeconds: Number.NEGATIVE_INFINITY,
        localityCommitmentLastRouteDistanceM: Number.POSITIVE_INFINITY,
        localityRouteGoal: LOCALITY_ROUTE_GOAL_NONE,
        localityRouteGoalRemainingHops: 0,
        localityRouteGoalExpiresAtSeconds: Number.NEGATIVE_INFINITY,
        localityRoutePlanLaneIndices: [],
        localityRoutePlanCursor: 0,
        localityRoutePlanTargetLaneIndex: -1,
        localityRoutePlanTargetDistance: Number.NaN,
        localityRoutePlanTargetExitDistance: Number.NaN,
        localityRoutePlanGeneration: 0,
        localityRoutePlanDeferredUntilReservationClears: false,
        preparedLocalityGateId: undefined,
        preferredGateId: preferredGate.id,
        activatedAtSeconds: Number.NEGATIVE_INFINITY,
        transitionCount: 0,
        laneId: lane.id,
        distance: preferredGate.distance,
        speedMps: 0,
        desiredSpeedMps,
        speedFactor,
        targetSpeedMps: desiredSpeedMps,
        state: lane.kind === "roundabout" ? "roundabout" : "cruising",
        signal: "off",
        targetLaneId: undefined,
        successorReservationFromLaneId: undefined,
        successorReservationLaneId: undefined,
        laneChangeProgress: 0,
        signalSeconds: 0,
        stoppedSeconds: 0,
        jamSeconds: 0,
        incidentLeanRad: 0,
        struckUntilTick: 0,
        decisionCooldown: 4 + this.random.next() * 8,
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        previousX: pose.x,
        previousZ: pose.z,
      };
      this.npcsList.push(npc);
    }

    // Reserve authored identity placements first. Generic locality priming can
    // then see their real contribution instead of filling a radial target and
    // having later explicit taxis/buses/patrols overshoot it. NPC construction
    // and PRNG consumption above remain in stable slot order.
    if (this.localityEnabled) {
      for (const npc of this.npcsList) {
        const preferredGate = npc.preferredGateId
          ? this.trafficGatesById.get(npc.preferredGateId)
          : undefined;
        if (preferredGate?.variant === undefined) continue;
        this.portalAttemptsThisDecision = 0;
        const gate = this.findSafeInitialTrafficGate(npc, ctx);
        if (gate) this.activateNpcAtGate(npc, gate, ctx, true);
      }
    }
    for (const npc of this.npcsList) {
      if (npc.active) continue;
      // Fresh-core priming is allowed to fill the local window synchronously;
      // the per-decision runtime portal budget starts only once play begins.
      this.portalAttemptsThisDecision = 0;
      const gate = this.localityEnabled
        ? this.findSafeInitialTrafficGate(npc, ctx)
        : this.findSafeTrafficGate(npc, true, ctx);
      if (gate) this.activateNpcAtGate(npc, gate, ctx, true);
    }
  }

  private randomVehicleVariant(): NpcVehicleVariant {
    const value = this.random.next();
    if (value < 0.1) return "bus";
    if (value < 0.24) return "van";
    if (value < 0.42) return "taxi";
    return "car";
  }

  private findSafeTrafficGate(
    npc: NpcInternal,
    initial: boolean,
    ctx: TrafficTickCtx,
  ): NormalizedTrafficGate | null {
    const preferredGate = npc.preferredGateId
      ? this.trafficGatesById.get(npc.preferredGateId)
      : undefined;
    if (
      preferredGate &&
      (!preferredGate.variant || preferredGate.variant === npc.variant) &&
      (!initial || preferredGate.allowInitialSpawn) &&
      this.isTrafficGateSafe(npc, preferredGate, initial, ctx)
    ) {
      return preferredGate;
    }
    for (const gate of this.compatibleTrafficGatesByVariant[npc.variant]) {
      if (gate === preferredGate) continue;
      if (initial && !gate.allowInitialSpawn) continue;
      if (this.isTrafficGateSafe(npc, gate, initial, ctx)) return gate;
    }
    return null;
  }

  /** Whether the portion of one directed lane visited by a bounded route walk
   * intersects the local fog circle. This operates directly on normalized
   * polyline segments so a curved lane that passes through the circle is not
   * mistaken for an outward endpoint. */
  private laneSegmentReachesLocalRadius(
    lane: NormalizedLane,
    fromDistance: number,
    toDistance: number,
    radiusM: number,
  ): boolean {
    if (toDistance < fromDistance) return false;
    const centre = this.playerState.player;
    const radiusSquared = radiusM * radiusM;
    let segmentStartDistance = 0;
    for (let segmentIndex = 0; segmentIndex < lane.segmentLengths.length; segmentIndex += 1) {
      const segmentLength = lane.segmentLengths[segmentIndex];
      const segmentEndDistance = segmentStartDistance + segmentLength;
      const overlapStart = Math.max(fromDistance, segmentStartDistance);
      const overlapEnd = Math.min(toDistance, segmentEndDistance);
      if (overlapEnd >= overlapStart && segmentLength > Number.EPSILON) {
        const start = lane.points[segmentIndex];
        const end = lane.points[segmentIndex + 1];
        const fromFraction = (overlapStart - segmentStartDistance) / segmentLength;
        const toFraction = (overlapEnd - segmentStartDistance) / segmentLength;
        const fromX = start.x + (end.x - start.x) * fromFraction;
        const fromZ = start.z + (end.z - start.z) * fromFraction;
        const toX = start.x + (end.x - start.x) * toFraction;
        const toZ = start.z + (end.z - start.z) * toFraction;
        if (
          distanceToSegmentSquared(
            centre.x,
            centre.z,
            fromX,
            fromZ,
            toX,
            toZ,
          ) <= radiusSquared
        ) {
          return true;
        }
      }
      segmentStartDistance = segmentEndDistance;
      if (segmentStartDistance > toDistance) break;
    }
    return false;
  }

  /** First contiguous arclength interval inside a player-centred disc, with
   * an optional forward-half-plane constraint. Reverse route goals terminate
   * at this exact interval instead of treating a whole straddling lane as if
   * its start already contributed. */
  private firstLaneLocalityInterval(
    lane: NormalizedLane,
    radiusM: number,
    playerProjection: LaneProjection,
    requireForward: boolean,
  ): { entryDistance: number; exitDistance: number } | null {
    const centre = this.playerState.player;
    const radiusSquared = radiusM * radiusM;
    let accumulated = 0;
    let firstEntry: number | null = null;
    let latestExit = Number.NaN;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const start = lane.points[index];
      const end = lane.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const segmentLength = lane.segmentLengths[index];
      const lengthSquared = dx * dx + dz * dz;
      if (segmentLength <= Number.EPSILON || lengthSquared <= Number.EPSILON) {
        accumulated += segmentLength;
        continue;
      }
      const relativeX = start.x - centre.x;
      const relativeZ = start.z - centre.z;
      const quadraticB = 2 * (relativeX * dx + relativeZ * dz);
      const quadraticC =
        relativeX * relativeX + relativeZ * relativeZ - radiusSquared;
      const discriminant =
        quadraticB * quadraticB - 4 * lengthSquared * quadraticC;
      let intervalStart = Number.POSITIVE_INFINITY;
      let intervalEnd = Number.NEGATIVE_INFINITY;
      if (discriminant >= -1e-9) {
        const root = Math.sqrt(Math.max(0, discriminant));
        intervalStart = Math.max(
          0,
          (-quadraticB - root) / (2 * lengthSquared),
        );
        intervalEnd = Math.min(
          1,
          (-quadraticB + root) / (2 * lengthSquared),
        );
      }
      if (requireForward && intervalStart <= intervalEnd) {
        const startLongitudinal = this.localityLongitudinal(
          start,
          playerProjection,
        );
        const endLongitudinal = this.localityLongitudinal(
          end,
          playerProjection,
        );
        const deltaLongitudinal = endLongitudinal - startLongitudinal;
        if (Math.abs(deltaLongitudinal) <= 1e-9) {
          if (startLongitudinal < 0) {
            intervalStart = Number.POSITIVE_INFINITY;
          }
        } else {
          const boundary = -startLongitudinal / deltaLongitudinal;
          if (deltaLongitudinal > 0) {
            intervalStart = Math.max(intervalStart, boundary);
          } else {
            intervalEnd = Math.min(intervalEnd, boundary);
          }
        }
      }
      if (intervalStart <= intervalEnd + 1e-9) {
        intervalStart = clamp(intervalStart, 0, 1);
        intervalEnd = clamp(intervalEnd, 0, 1);
        const entryDistance = accumulated + intervalStart * segmentLength;
        const exitDistance = accumulated + intervalEnd * segmentLength;
        if (firstEntry === null) {
          firstEntry = entryDistance;
          latestExit = exitDistance;
        } else if (
          intervalStart <= 1e-9 &&
          entryDistance <= latestExit + 1e-6
        ) {
          latestExit = Math.max(latestExit, exitDistance);
        } else {
          return { entryDistance: firstEntry, exitDistance: latestExit };
        }
        if (intervalEnd < 1 - 1e-9) {
          return { entryDistance: firstEntry, exitDistance: latestExit };
        }
      } else if (firstEntry !== null) {
        return { entryDistance: firstEntry, exitDistance: latestExit };
      }
      accumulated += segmentLength;
    }
    return firstEntry === null
      ? null
      : { entryDistance: firstEntry, exitDistance: latestExit };
  }

  /** Bounded reverse dynamic programme over the immutable lane graph. One
   * label per `(remaining hops, lane)` preserves a feasible route even when a
   * slightly shorter path needs more than the committed twelve transitions.
   * This work runs only when the player changes road or moves eight metres,
   * never per portal candidate. */
  private buildLocalityRouteGoalTable(
    targetSeeds: readonly LocalityRouteGoalSeed[],
  ): LocalityRouteGoalTable {
    const laneCount = this.roadNetwork.lanes.length;
    const budgetCount = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS + 1;
    const stateCount = laneCount * budgetCount;
    const distanceFromLaneStartByHopBudget = new Float64Array(stateCount);
    distanceFromLaneStartByHopBudget.fill(Number.POSITIVE_INFINITY);
    const usedHopsByHopBudget = new Uint16Array(stateCount);
    usedHopsByHopBudget.fill(0xffff);
    const nextLaneIndexByHopBudget = new Int32Array(stateCount);
    nextLaneIndexByHopBudget.fill(-1);
    const targetLaneIndexByHopBudget = new Int32Array(stateCount);
    targetLaneIndexByHopBudget.fill(-1);
    const targetEntryDistance = new Float64Array(laneCount);
    targetEntryDistance.fill(Number.NaN);
    const targetExitDistance = new Float64Array(laneCount);
    targetExitDistance.fill(Number.NaN);
    const targetMinimumDirectOriginDistance = new Float64Array(laneCount);
    targetMinimumDirectOriginDistance.fill(Number.NEGATIVE_INFINITY);
    const targetAllowsPredecessorEntry = new Uint8Array(laneCount);
    targetAllowsPredecessorEntry.fill(1);
    for (const seed of targetSeeds) {
      const laneIndex = seed.laneIndex;
      if (laneIndex < 0 || laneIndex >= laneCount) continue;
      const entryDistance = clamp(
        seed.entryDistance,
        0,
        this.roadNetwork.lanes[laneIndex].length,
      );
      const exitDistance = clamp(
        seed.exitDistance,
        entryDistance,
        this.roadNetwork.lanes[laneIndex].length,
      );
      if (
        Number.isFinite(targetEntryDistance[laneIndex]) &&
        targetEntryDistance[laneIndex] <= entryDistance
      ) {
        continue;
      }
      targetEntryDistance[laneIndex] = entryDistance;
      targetExitDistance[laneIndex] = exitDistance;
      targetMinimumDirectOriginDistance[laneIndex] =
        seed.minimumDirectOriginDistance ?? Number.NEGATIVE_INFINITY;
      targetAllowsPredecessorEntry[laneIndex] =
        seed.allowPredecessorEntry === false ? 0 : 1;
      distanceFromLaneStartByHopBudget[laneIndex] = entryDistance;
      usedHopsByHopBudget[laneIndex] = 0;
      targetLaneIndexByHopBudget[laneIndex] = laneIndex;
    }

    for (let hopBudget = 1; hopBudget < budgetCount; hopBudget += 1) {
      const priorOffset = (hopBudget - 1) * laneCount;
      const offset = hopBudget * laneCount;
      // A route that used fewer transitions remains valid under every larger
      // budget. Copy first, then relax one predecessor edge.
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        distanceFromLaneStartByHopBudget[offset + laneIndex] =
          distanceFromLaneStartByHopBudget[priorOffset + laneIndex];
        usedHopsByHopBudget[offset + laneIndex] =
          usedHopsByHopBudget[priorOffset + laneIndex];
        nextLaneIndexByHopBudget[offset + laneIndex] =
          nextLaneIndexByHopBudget[priorOffset + laneIndex];
        targetLaneIndexByHopBudget[offset + laneIndex] =
          targetLaneIndexByHopBudget[priorOffset + laneIndex];
      }
      for (let successorIndex = 0; successorIndex < laneCount; successorIndex += 1) {
        const successorDistance =
          distanceFromLaneStartByHopBudget[priorOffset + successorIndex];
        const successorUsedHops =
          usedHopsByHopBudget[priorOffset + successorIndex];
        const successorTargetLaneIndex =
          targetLaneIndexByHopBudget[priorOffset + successorIndex];
        if (
          !Number.isFinite(successorDistance) ||
          successorUsedHops === 0xffff ||
          successorTargetLaneIndex < 0
        ) {
          continue;
        }
        if (
          successorUsedHops === 0 &&
          targetAllowsPredecessorEntry[successorIndex] === 0
        ) {
          continue;
        }
        for (const predecessorIndex of
          this.predecessorLaneIndicesByLaneIndex[successorIndex]) {
          const candidateDistance =
            this.roadNetwork.lanes[predecessorIndex].length +
            successorDistance;
          const candidateUsedHops = successorUsedHops + 1;
          const stateIndex = offset + predecessorIndex;
          const priorDistance =
            distanceFromLaneStartByHopBudget[stateIndex];
          const priorUsedHops = usedHopsByHopBudget[stateIndex];
          const priorNext = nextLaneIndexByHopBudget[stateIndex];
          const priorTarget = targetLaneIndexByHopBudget[stateIndex];
          if (
            candidateDistance > priorDistance + 1e-9 ||
            (Math.abs(candidateDistance - priorDistance) <= 1e-9 &&
              (candidateUsedHops > priorUsedHops ||
                (candidateUsedHops === priorUsedHops &&
                  (successorTargetLaneIndex > priorTarget ||
                    (successorTargetLaneIndex === priorTarget &&
                      priorNext >= 0 &&
                      successorIndex >= priorNext)))))
          ) {
            continue;
          }
          distanceFromLaneStartByHopBudget[stateIndex] = candidateDistance;
          usedHopsByHopBudget[stateIndex] = candidateUsedHops;
          nextLaneIndexByHopBudget[stateIndex] = successorIndex;
          targetLaneIndexByHopBudget[stateIndex] =
            successorTargetLaneIndex;
        }
      }
    }
    return {
      laneCount,
      distanceFromLaneStartByHopBudget,
      usedHopsByHopBudget,
      nextLaneIndexByHopBudget,
      targetLaneIndexByHopBudget,
      targetEntryDistance,
      targetExitDistance,
      targetMinimumDirectOriginDistance,
      targetAllowsPredecessorEntry,
    };
  }

  private closestLanePoseToPlayer(
    lane: NormalizedLane,
    minimumDistance = 0,
    maximumDistance = lane.length,
  ): {
    distanceSquared: number;
    heading: number;
    distanceAlong: number;
    x: number;
    z: number;
  } {
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    let bestHeading = this.playerState.player.heading;
    let bestDistanceAlong = clamp(minimumDistance, 0, lane.length);
    let bestPose = this.roadNetwork.pointOnLane(lane, bestDistanceAlong);
    let accumulated = 0;
    const boundedMinimum = clamp(minimumDistance, 0, lane.length);
    const boundedMaximum = clamp(
      maximumDistance,
      boundedMinimum,
      lane.length,
    );
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const start = lane.points[index];
      const end = lane.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const segmentLength = lane.segmentLengths[index];
      const overlapStart = Math.max(boundedMinimum, accumulated);
      const overlapEnd = Math.min(
        boundedMaximum,
        accumulated + segmentLength,
      );
      if (
        lengthSquared <= Number.EPSILON ||
        segmentLength <= Number.EPSILON ||
        overlapStart > overlapEnd + 1e-9
      ) {
        accumulated += segmentLength;
        continue;
      }
      const minimumFraction = (overlapStart - accumulated) / segmentLength;
      const maximumFraction = (overlapEnd - accumulated) / segmentLength;
      const fraction = clamp(
        ((this.playerState.player.x - start.x) * dx +
          (this.playerState.player.z - start.z) * dz) /
          lengthSquared,
        minimumFraction,
        maximumFraction,
      );
      const x = start.x + dx * fraction;
      const z = start.z + dz * fraction;
      const candidateDistanceSquared =
        (x - this.playerState.player.x) ** 2 +
        (z - this.playerState.player.z) ** 2;
      if (candidateDistanceSquared < bestDistanceSquared) {
        bestDistanceSquared = candidateDistanceSquared;
        bestHeading = Math.atan2(dx, dz);
        bestDistanceAlong = accumulated + segmentLength * fraction;
        bestPose = { x, z, heading: bestHeading };
      }
      accumulated += segmentLength;
    }
    return {
      distanceSquared: bestDistanceSquared,
      heading: bestHeading,
      distanceAlong: bestDistanceAlong,
      x: bestPose.x,
      z: bestPose.z,
    };
  }

  /** Locality owns a heading-stable road projection. At a shared junction
   * node several authored lanes can be exactly equidistant; the generic road
   * projection intentionally preserves authored scan order for legacy road
   * rules, but a moving traffic target must not flicker between a crossing
   * street and the player's actual heading. */
  private projectPlayerToLocalityRoad(): LaneProjection | null {
    const player = this.playerState.player;
    return this.roadNetwork.projectToRoad(player.x, player.z, {
      heading: player.heading,
    });
  }

  private lanesFormAlignedContinuation(
    predecessor: NormalizedLane,
    successor: NormalizedLane,
  ): boolean {
    if (!this.roadNetwork.areLaneEndpointsContinuous(predecessor, successor)) {
      return false;
    }
    const predecessorEnd = this.roadNetwork.pointOnLane(
      predecessor,
      predecessor.length,
    );
    const successorStart = this.roadNetwork.pointOnLane(successor, 0);
    return (
      Math.cos(angleDifference(predecessorEnd.heading, successorStart.heading)) >=
      Math.cos((40 * Math.PI) / 180)
    );
  }

  /** Build the visually continuous road through authored junction-sized lane
   * pieces. Paired/opposing lanes are geometric seeds; graph expansion then
   * follows only directed straight continuations, never turns. */
  private buildLocalityCurrentCorridorMask(
    playerProjection: LaneProjection,
  ): Uint8Array {
    const laneCount = this.roadNetwork.lanes.length;
    const mask = new Uint8Array(laneCount);
    const queue: number[] = [];
    const seedRadiusSquared = LOCAL_TRAFFIC_CORRIDOR_HALF_WIDTH_M ** 2;
    const alignmentMinimum = Math.cos((40 * Math.PI) / 180);
    for (const lane of this.roadNetwork.lanes) {
      if (lane.index === undefined) continue;
      const closest = this.closestLanePoseToPlayer(lane);
      const pairedSeed =
        closest.distanceSquared <= seedRadiusSquared &&
        Math.abs(
          Math.cos(
            angleDifference(closest.heading, playerProjection.heading),
          ),
        ) >= alignmentMinimum;
      if (lane.id !== playerProjection.lane.id && !pairedSeed) continue;
      mask[lane.index] = 1;
      queue.push(lane.index);
    }
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const laneIndex = queue[cursor];
      const lane = this.roadNetwork.lanes[laneIndex];
      const tryAdd = (candidate: NormalizedLane, forward: boolean): void => {
        if (
          candidate.index === undefined ||
          mask[candidate.index] !== 0 ||
          !this.laneSegmentReachesLocalRadius(
            candidate,
            0,
            candidate.length,
            LOCAL_TRAFFIC_FOG_RADIUS_M,
          ) ||
          !(forward
            ? this.lanesFormAlignedContinuation(lane, candidate)
            : this.lanesFormAlignedContinuation(candidate, lane))
        ) {
          return;
        }
        mask[candidate.index] = 1;
        queue.push(candidate.index);
      };
      for (const successorId of lane.successorLaneIds) {
        const successor = this.roadNetwork.lanesById.get(successorId);
        if (successor) tryAdd(successor, true);
      }
      for (const predecessorIndex of
        this.predecessorLaneIndicesByLaneIndex[laneIndex]) {
        tryAdd(this.roadNetwork.lanes[predecessorIndex], false);
      }
    }
    return mask;
  }

  private refreshLocalityRouteGoalTables(): void {
    const playerProjection = this.localityPlayerProjection;
    const centre = this.playerState.player;
    const roadId = playerProjection?.lane.roadId ?? "";
    const laneId = playerProjection?.lane.id ?? "";
    const anchorDistanceSquared =
      (centre.x - this.localityRouteGoalAnchorX) ** 2 +
      (centre.z - this.localityRouteGoalAnchorZ) ** 2;
    if (
      playerProjection &&
      roadId === this.localityRouteGoalRoadId &&
      laneId === this.localityRouteGoalLaneId &&
      Number.isFinite(anchorDistanceSquared) &&
      anchorDistanceSquared < LOCAL_TRAFFIC_TARGET_RECOMPUTE_DISTANCE_M ** 2
    ) {
      return;
    }
    this.localityRouteGoalAnchorX = centre.x;
    this.localityRouteGoalAnchorZ = centre.z;
    this.localityRouteGoalRoadId = roadId;
    this.localityRouteGoalLaneId = laneId;
    if (!playerProjection) {
      this.localityCurrentCorridorLaneMask = new Uint8Array(0);
      this.localityCurrentRouteGoalTable = null;
      this.localityForwardRouteGoalTable = null;
      this.localityApproachRouteGoalTable = null;
      this.localityStreamableCurrentRoadCapacity = 0;
      this.localityStreamableForwardCorridorCapacity = 0;
      this.localityApproachTargetAvailable = false;
      this.localityApproachRouteFeedAvailable = false;
      this.invalidateLocalityAdmissionRouteTables();
      this.localityRouteGoalGeneration += 1;
      this.migrateNpcLocalityRoutePlansAfterTargetRefresh();
      return;
    }
    this.localityCurrentCorridorLaneMask =
      this.buildLocalityCurrentCorridorMask(playerProjection);
    this.invalidateLocalityAdmissionRouteTables();
    const currentTargets: LocalityRouteGoalSeed[] = [];
    const forwardTargets: LocalityRouteGoalSeed[] = [];
    const approachTargets: LocalityRouteGoalSeed[] = [];
    for (const lane of this.roadNetwork.lanes) {
      if (lane.index === undefined) continue;
      const matchesCurrentRoad =
        this.localityCurrentCorridorLaneMask[lane.index] === 1;
      if (matchesCurrentRoad) {
        const startPose = this.roadNetwork.pointOnLane(lane, 0);
        const sameDirection =
          Math.cos(
            angleDifference(startPose.heading, playerProjection.heading),
          ) >= Math.cos((40 * Math.PI) / 180);
        const routeEntryLongitudinal = this.localityLongitudinal(
          startPose,
          playerProjection,
        );
        // Same-direction hard feeds may enter only in front of the player. A
        // rear target would manufacture a stopped follower queue; opposing
        // carriageways can enter on either side because they do not follow the
        // player as their lead vehicle.
        const currentInterval = this.firstLaneLocalityInterval(
          lane,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          playerProjection,
          false,
        );
        if (currentInterval) {
          currentTargets.push({ laneIndex: lane.index, ...currentInterval });
        }
        const forwardInterval = this.firstLaneLocalityInterval(
          lane,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          playerProjection,
          true,
        );
        if (forwardInterval) {
          const unsafeSameDirectionLaneStart =
            sameDirection && routeEntryLongitudinal < -1e-9;
          forwardTargets.push({
            laneIndex: lane.index,
            ...forwardInterval,
            ...(unsafeSameDirectionLaneStart
              ? {
                  minimumDirectOriginDistance:
                    forwardInterval.entryDistance,
                  allowPredecessorEntry: false,
                }
              : {}),
          });
        }
      }
      const approachInterval = this.firstLaneLocalityInterval(
        lane,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
        playerProjection,
        false,
      );
      const approachPose = approachInterval
        ? this.closestLanePoseToPlayer(
            lane,
            approachInterval.entryDistance,
            approachInterval.exitDistance,
          )
        : null;
      const approachEntryPose = approachInterval
        ? this.roadNetwork.pointOnLane(lane, approachInterval.entryDistance)
        : null;
      const isIndependentCrossApproach =
        lane.index !== undefined &&
        this.localityCurrentCorridorLaneMask[lane.index] === 0 &&
        approachPose !== null &&
        Math.abs(
          Math.cos(
            angleDifference(approachPose.heading, playerProjection.heading),
          ),
        ) < Math.cos((40 * Math.PI) / 180) &&
        approachEntryPose !== null &&
        this.headingApproachesPlayer(approachEntryPose, approachEntryPose.heading) &&
        this.localityLongitudinal(approachPose, playerProjection) >= -1e-9 &&
        this.localityLongitudinal(approachPose, playerProjection) <=
          LOCAL_TRAFFIC_INNER_RADIUS_M + 1e-9 &&
        approachInterval !== null &&
        this.laneSegmentReachesLocalRadius(
          lane,
          approachInterval.entryDistance,
          approachInterval.exitDistance,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
        );
      if (approachInterval && isIndependentCrossApproach) {
        // Route ownership aims at the actual forward crossing, not the outer
        // edge of the 250 m staging disc. The short post-crossing interval
        // gives direct origins a deterministic passed-target test while the
        // commitment itself remains live until an actual <=90 m contribution.
        approachTargets.push({
          laneIndex: lane.index,
          entryDistance: approachPose.distanceAlong,
          exitDistance: Math.min(
            approachInterval.exitDistance,
            approachPose.distanceAlong +
              LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
          ),
        });
      }
    }
    this.localityCurrentRouteGoalTable =
      this.buildLocalityRouteGoalTable(currentTargets);
    this.localityForwardRouteGoalTable =
      this.buildLocalityRouteGoalTable(forwardTargets);
    this.localityApproachRouteGoalTable =
      this.buildLocalityRouteGoalTable(approachTargets);
    this.localityApproachTargetAvailable = approachTargets.length > 0;
    this.refreshLocalityStreamableCorridorCapacities();
    this.localityRouteGoalGeneration += 1;
    this.migrateNpcLocalityRoutePlansAfterTargetRefresh();
  }

  /** A moving player rebuilds the target mask every eight metres or lane
   * change. Existing destination cars must be migrated transactionally to
   * that fresh target instead of silently losing their reservation and being
   * reclaimed at the next hidden-population pass. Plans whose target interval
   * remains valid are retained; only invalid plans are re-materialized, in
   * stable slot order, against the current projected lane loads. */
  private npcApproachDestinationRemainsUseful(npc: NpcInternal): boolean {
    const playerProjection = this.localityPlayerProjection;
    const targetLane =
      this.roadNetwork.lanes[npc.localityRoutePlanTargetLaneIndex];
    if (
      !playerProjection ||
      !targetLane ||
      !Number.isFinite(npc.localityRoutePlanTargetDistance) ||
      !Number.isFinite(npc.localityRoutePlanTargetExitDistance) ||
      !this.laneSegmentReachesLocalRadius(
        targetLane,
        npc.localityRoutePlanTargetDistance,
        npc.localityRoutePlanTargetExitDistance,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
      )
    ) {
      return false;
    }
    const targetClosestPose = this.closestLanePoseToPlayer(
      targetLane,
      npc.localityRoutePlanTargetDistance,
      npc.localityRoutePlanTargetExitDistance,
    );
    // Keep an owned rendezvous stable across projection ties at junctions.
    // Use the player's actual travel heading here; switching the closest
    // authored lane must not make an unchanged physical destination jump
    // from "ahead" to "behind".
    const dx = targetClosestPose.x - this.playerState.player.x;
    const dz = targetClosestPose.z - this.playerState.player.z;
    const longitudinal =
      dx * Math.sin(this.playerState.player.heading) +
      dz * Math.cos(this.playerState.player.heading);
    return (
      // Keep a crossing that is still inside the actual 90 m contribution
      // window; release it once the player has genuinely passed that window.
      longitudinal >= -LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M - 1e-9 &&
      longitudinal <= LOCAL_TRAFFIC_INNER_RADIUS_M + 1e-9
    );
  }

  private releaseNpcLocalityOwnership(npc: NpcInternal): void {
    npc.localityCommitmentBits = 0;
    npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
    npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
    npc.localityRouteGoalRemainingHops = 0;
    npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    this.assignNpcLocalityRoutePlan(npc, null);
  }

  private migrateNpcLocalityRoutePlansAfterTargetRefresh(): void {
    const replans: {
      readonly npc: NpcInternal;
      readonly previousCommitmentExpirySeconds: number;
    }[] = [];
    for (const npc of this.npcsList) {
      if (!npc.active || npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE) {
        continue;
      }
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH) {
        // A cross-traffic handoff owns one immutable destination. Recentring
        // may rebuild admission tables for later cars, but must never turn a
        // progressing journey into an endless chase of the player's newest
        // 90 m circle. Once the stored destination is behind/outside the fog
        // window, release only locality guidance; identity, pose, speed and
        // ordinary route motion remain untouched.
        if (
          this.npcLocalityRoutePlanIsStructurallyValid(npc, lane) &&
          this.npcApproachDestinationRemainsUseful(npc)
        ) {
          npc.localityRoutePlanGeneration = this.localityRouteGoalGeneration;
          npc.localityRoutePlanDeferredUntilReservationClears = false;
        } else {
          this.localityApproachGoalRecenterReleases += 1;
          this.releaseNpcLocalityOwnership(npc);
        }
        continue;
      }
      const freshTable = this.localityRouteGoalTable(npc.localityRouteGoal);
      const targetLaneIndex = npc.localityRoutePlanTargetLaneIndex;
      const freshEntry =
        targetLaneIndex >= 0
          ? freshTable?.targetEntryDistance[targetLaneIndex]
          : Number.NaN;
      const freshExit =
        targetLaneIndex >= 0
          ? freshTable?.targetExitDistance[targetLaneIndex]
          : Number.NaN;
      const freshMinimumDirectOrigin =
        targetLaneIndex >= 0
          ? freshTable?.targetMinimumDirectOriginDistance[targetLaneIndex]
          : Number.NaN;
      const freshAllowsPredecessor =
        targetLaneIndex >= 0
          ? freshTable?.targetAllowsPredecessorEntry[targetLaneIndex]
          : 0;
      const canRetain =
        this.npcLocalityRoutePlanIsStructurallyValid(npc, lane) &&
        Number.isFinite(freshEntry) &&
        Number.isFinite(freshExit) &&
        (lane?.index === targetLaneIndex
          ? npc.distance >= (freshMinimumDirectOrigin ?? Number.NEGATIVE_INFINITY) - 1e-9 &&
            npc.distance <= (freshExit ?? Number.NEGATIVE_INFINITY) + 1e-9
          : freshAllowsPredecessor === 1);
      if (canRetain) {
        npc.localityRoutePlanTargetDistance = freshEntry!;
        npc.localityRoutePlanTargetExitDistance = freshExit!;
        npc.localityRoutePlanGeneration = this.localityRouteGoalGeneration;
        npc.localityRoutePlanDeferredUntilReservationClears = false;
        // Target motion is not vehicle progress. Preserve the deadline while
        // moving the comparison watermark to the migrated destination.
        npc.localityCommitmentLastRouteDistanceM =
          this.npcLocalityRoutePlanRemainingDistance(npc, lane);
        continue;
      }
      const ownsCornerReservation =
        lane !== undefined &&
        npc.successorReservationFromLaneId === lane.id &&
        Boolean(npc.successorReservationLaneId);
      if (
        ownsCornerReservation &&
        this.npcLocalityRoutePlanIsStructurallyValid(npc, lane)
      ) {
        // Route ownership cannot change after the rendered turn has begun.
        // Keep the old structural plan only through this reserved hop, then
        // release its stale target atomically on transition.
        npc.localityRoutePlanGeneration = this.localityRouteGoalGeneration;
        npc.localityRoutePlanDeferredUntilReservationClears = true;
        npc.localityCommitmentLastRouteDistanceM =
          this.npcLocalityRoutePlanRemainingDistance(npc, lane);
        continue;
      }
      replans.push({
        npc,
        previousCommitmentExpirySeconds:
          npc.localityCommitmentExpiresAtSeconds,
      });
      this.assignNpcLocalityRoutePlan(npc, null);
    }

    for (const replan of replans) {
      const { npc } = replan;
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      // An existing vehicle must not consume one unit of its own source-lane
      // capacity while selecting a replacement route. The synchronous toggle
      // affects only the load scratch; spatial membership and lifecycle stay
      // untouched, and the identity is restored before any caller can observe
      // the transaction.
      npc.active = false;
      this.invalidateLocalityAdmissionRouteTables();
      const plan = this.materializeLocalityRoutePlan(
        npc.localityRouteGoal,
        lane,
        npc.distance,
      );
      npc.active = true;
      if (!plan) {
        npc.localityCommitmentBits = 0;
        npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
        npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
        npc.localityRouteGoalRemainingHops = 0;
        npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        continue;
      }
      this.assignNpcLocalityRoutePlan(npc, plan);
      npc.localityRouteGoalRemainingHops = plan.successorLaneIndices.length;
      // Recentring is not vehicle progress. Reset the comparison watermark to
      // the fresh route distance, but retain the original deadline; only a
      // later physical >=0.25 m decrease may renew target ownership.
      npc.localityCommitmentLastRouteDistanceM = plan.physicalDistanceM;
      npc.localityCommitmentExpiresAtSeconds =
        replan.previousCommitmentExpirySeconds;
    }
  }

  private localityRouteGoalTable(
    goal: LocalityRouteGoal,
  ): LocalityRouteGoalTable | null {
    switch (goal) {
      case LOCALITY_ROUTE_GOAL_CURRENT:
        return this.localityCurrentRouteGoalTable;
      case LOCALITY_ROUTE_GOAL_FORWARD:
        return this.localityForwardRouteGoalTable;
      case LOCALITY_ROUTE_GOAL_APPROACH:
        return this.localityApproachRouteGoalTable;
      default:
        return null;
    }
  }

  private invalidateLocalityAdmissionRouteTables(): void {
    this.localityCurrentAdmissionRouteTableDirty = true;
    this.localityForwardAdmissionRouteTableDirty = true;
    this.localityApproachAdmissionRouteTableDirty = true;
  }

  private localityLaneOccupancyCap(): number {
    return this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_LANE_OCCUPANCY_CAP
      : LOCAL_TRAFFIC_DESKTOP_LANE_OCCUPANCY_CAP;
  }

  /** Current occupancy plus each materialized plan's still-unvisited lanes.
   * The fixed 32/16 pool makes this bounded walk cheaper than maintaining a
   * second mutable graph index, and it runs only for a real admission table. */
  private localityProjectedRouteLaneLoads(): Uint16Array {
    if (
      this.localityProjectedRouteLaneLoadScratch.length !==
      this.roadNetwork.lanes.length
    ) {
      this.localityProjectedRouteLaneLoadScratch = new Uint16Array(
        this.roadNetwork.lanes.length,
      );
    } else {
      this.localityProjectedRouteLaneLoadScratch.fill(0);
    }
    const loads = this.localityProjectedRouteLaneLoadScratch;
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (lane?.index !== undefined) loads[lane.index] += 1;
      if (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE) continue;
      for (
        let cursor = npc.localityRoutePlanCursor;
        cursor < npc.localityRoutePlanLaneIndices.length;
        cursor += 1
      ) {
        const laneIndex = npc.localityRoutePlanLaneIndices[cursor];
        if (laneIndex !== lane?.index) loads[laneIndex] += 1;
      }
    }
    return loads;
  }

  /** Build a load-weighted reverse table for the next admission only. The
   * immutable reachability table still proves the exact 750 m / 12-hop
   * contract; this second bounded DP chooses among those legal target seeds
   * without redirecting cars that already own a materialized plan. */
  private buildLocalityAdmissionRouteTable(
    goal: LocalityRouteGoal,
    reusable: LocalityAdmissionRouteTable | null,
  ): LocalityAdmissionRouteTable | null {
    const base = this.localityRouteGoalTable(goal);
    if (!base) return null;
    const laneCount = base.laneCount;
    const budgetCount = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS + 1;
    const stateCount = laneCount * budgetCount;
    const physicalDistanceByHopBudget =
      reusable?.laneCount === laneCount
        ? reusable.physicalDistanceByHopBudget
        : new Float64Array(stateCount);
    physicalDistanceByHopBudget.fill(Number.POSITIVE_INFINITY);
    const routingCostByHopBudget =
      reusable?.laneCount === laneCount
        ? reusable.routingCostByHopBudget
        : new Float64Array(stateCount);
    routingCostByHopBudget.fill(Number.POSITIVE_INFINITY);
    const usedHopsByHopBudget =
      reusable?.laneCount === laneCount
        ? reusable.usedHopsByHopBudget
        : new Uint16Array(stateCount);
    usedHopsByHopBudget.fill(0xffff);
    const nextLaneIndexByHopBudget =
      reusable?.laneCount === laneCount
        ? reusable.nextLaneIndexByHopBudget
        : new Int32Array(stateCount);
    nextLaneIndexByHopBudget.fill(-1);
    const targetLaneIndexByHopBudget =
      reusable?.laneCount === laneCount
        ? reusable.targetLaneIndexByHopBudget
        : new Int32Array(stateCount);
    targetLaneIndexByHopBudget.fill(-1);
    const projectedLoads = this.localityProjectedRouteLaneLoads();
    const laneCap = this.localityLaneOccupancyCap();
    const targetLaneCap =
      goal === LOCALITY_ROUTE_GOAL_APPROACH ? Math.min(2, laneCap) : laneCap;

    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const entryDistance = base.targetEntryDistance[laneIndex];
      if (
        !Number.isFinite(entryDistance) ||
        projectedLoads[laneIndex] >= targetLaneCap
      ) {
        continue;
      }
      physicalDistanceByHopBudget[laneIndex] = entryDistance;
      routingCostByHopBudget[laneIndex] =
        entryDistance +
        projectedLoads[laneIndex] * LOCALITY_ROUTE_TARGET_LOAD_COST_M;
      usedHopsByHopBudget[laneIndex] = 0;
      targetLaneIndexByHopBudget[laneIndex] = laneIndex;
    }

    for (let hopBudget = 1; hopBudget < budgetCount; hopBudget += 1) {
      const priorOffset = (hopBudget - 1) * laneCount;
      const offset = hopBudget * laneCount;
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        physicalDistanceByHopBudget[offset + laneIndex] =
          physicalDistanceByHopBudget[priorOffset + laneIndex];
        routingCostByHopBudget[offset + laneIndex] =
          routingCostByHopBudget[priorOffset + laneIndex];
        usedHopsByHopBudget[offset + laneIndex] =
          usedHopsByHopBudget[priorOffset + laneIndex];
        nextLaneIndexByHopBudget[offset + laneIndex] =
          nextLaneIndexByHopBudget[priorOffset + laneIndex];
        targetLaneIndexByHopBudget[offset + laneIndex] =
          targetLaneIndexByHopBudget[priorOffset + laneIndex];
      }
      for (let successorIndex = 0; successorIndex < laneCount; successorIndex += 1) {
        const successorPhysical =
          physicalDistanceByHopBudget[priorOffset + successorIndex];
        const successorCost =
          routingCostByHopBudget[priorOffset + successorIndex];
        const successorHops = usedHopsByHopBudget[priorOffset + successorIndex];
        const targetLaneIndex =
          targetLaneIndexByHopBudget[priorOffset + successorIndex];
        if (
          !Number.isFinite(successorPhysical) ||
          !Number.isFinite(successorCost) ||
          successorHops === 0xffff ||
          targetLaneIndex < 0
        ) {
          continue;
        }
        if (
          successorHops === 0 &&
          base.targetAllowsPredecessorEntry[successorIndex] === 0
        ) {
          continue;
        }
        for (const predecessorIndex of
          this.predecessorLaneIndicesByLaneIndex[successorIndex]) {
          if (projectedLoads[predecessorIndex] >= laneCap) continue;
          const predecessorLength =
            this.roadNetwork.lanes[predecessorIndex].length;
          const candidatePhysical = predecessorLength + successorPhysical;
          const candidateCost =
            predecessorLength +
            successorCost +
            projectedLoads[predecessorIndex] *
              LOCALITY_ROUTE_PATH_LOAD_COST_M;
          const candidateHops = successorHops + 1;
          const stateIndex = offset + predecessorIndex;
          const priorCost = routingCostByHopBudget[stateIndex];
          const priorPhysical = physicalDistanceByHopBudget[stateIndex];
          const priorHops = usedHopsByHopBudget[stateIndex];
          const priorTarget = targetLaneIndexByHopBudget[stateIndex];
          const priorNext = nextLaneIndexByHopBudget[stateIndex];
          if (
            candidateCost > priorCost + 1e-9 ||
            (Math.abs(candidateCost - priorCost) <= 1e-9 &&
              (candidatePhysical > priorPhysical + 1e-9 ||
                (Math.abs(candidatePhysical - priorPhysical) <= 1e-9 &&
                  (candidateHops > priorHops ||
                    (candidateHops === priorHops &&
                      (targetLaneIndex > priorTarget ||
                        (targetLaneIndex === priorTarget &&
                          priorNext >= 0 &&
                          successorIndex >= priorNext)))))))
          ) {
            continue;
          }
          physicalDistanceByHopBudget[stateIndex] = candidatePhysical;
          routingCostByHopBudget[stateIndex] = candidateCost;
          usedHopsByHopBudget[stateIndex] = candidateHops;
          nextLaneIndexByHopBudget[stateIndex] = successorIndex;
          targetLaneIndexByHopBudget[stateIndex] = targetLaneIndex;
        }
      }
    }
    return {
      laneCount,
      physicalDistanceByHopBudget,
      routingCostByHopBudget,
      usedHopsByHopBudget,
      nextLaneIndexByHopBudget,
      targetLaneIndexByHopBudget,
    };
  }

  private localityAdmissionRouteTable(
    goal: LocalityRouteGoal,
  ): LocalityAdmissionRouteTable | null {
    switch (goal) {
      case LOCALITY_ROUTE_GOAL_CURRENT:
        if (this.localityCurrentAdmissionRouteTableDirty) {
          this.localityCurrentAdmissionRouteTable =
            this.buildLocalityAdmissionRouteTable(
              goal,
              this.localityCurrentAdmissionRouteTable,
            );
          this.localityCurrentAdmissionRouteTableDirty = false;
        }
        return this.localityCurrentAdmissionRouteTable;
      case LOCALITY_ROUTE_GOAL_FORWARD:
        if (this.localityForwardAdmissionRouteTableDirty) {
          this.localityForwardAdmissionRouteTable =
            this.buildLocalityAdmissionRouteTable(
              goal,
              this.localityForwardAdmissionRouteTable,
            );
          this.localityForwardAdmissionRouteTableDirty = false;
        }
        return this.localityForwardAdmissionRouteTable;
      case LOCALITY_ROUTE_GOAL_APPROACH:
        if (this.localityApproachAdmissionRouteTableDirty) {
          this.localityApproachAdmissionRouteTable =
            this.buildLocalityAdmissionRouteTable(
              goal,
              this.localityApproachAdmissionRouteTable,
            );
          this.localityApproachAdmissionRouteTableDirty = false;
        }
        return this.localityApproachAdmissionRouteTable;
      default:
        return null;
    }
  }

  private materializeLocalityRoutePlan(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    distance: number,
  ): LocalityRoutePlan | null {
    if (!lane || lane.index === undefined) return null;
    const base = this.localityRouteGoalTable(goal);
    const table = this.localityAdmissionRouteTable(goal);
    if (!base || !table) return null;
    const clampedDistance = clamp(distance, 0, lane.length);
    const minimumDirectOriginDistance =
      base.targetMinimumDirectOriginDistance[lane.index];
    if (
      Number.isFinite(base.targetEntryDistance[lane.index]) &&
      (clampedDistance < minimumDirectOriginDistance - 1e-9 ||
        clampedDistance > base.targetExitDistance[lane.index] + 1e-9)
    ) {
      return null;
    }
    let selectedBudget = -1;
    let selectedCost = Number.POSITIVE_INFINITY;
    let selectedPhysical = Number.POSITIVE_INFINITY;
    let selectedHops = Number.POSITIVE_INFINITY;
    let selectedTarget = -1;
    for (
      let hopBudget = 0;
      hopBudget <= RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS;
      hopBudget += 1
    ) {
      const stateIndex = hopBudget * table.laneCount + lane.index;
      const fromLaneStart = table.physicalDistanceByHopBudget[stateIndex];
      const routingCost = table.routingCostByHopBudget[stateIndex];
      const hops = table.usedHopsByHopBudget[stateIndex];
      const targetLaneIndex = table.targetLaneIndexByHopBudget[stateIndex];
      const physicalDistance = Math.max(0, fromLaneStart - clampedDistance);
      if (
        !Number.isFinite(routingCost) ||
        hops === 0xffff ||
        targetLaneIndex < 0 ||
        physicalDistance > RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M
      ) {
        continue;
      }
      const adjustedCost = routingCost - clampedDistance;
      if (
        adjustedCost > selectedCost + 1e-9 ||
        (Math.abs(adjustedCost - selectedCost) <= 1e-9 &&
          (physicalDistance > selectedPhysical + 1e-9 ||
            (Math.abs(physicalDistance - selectedPhysical) <= 1e-9 &&
              (hops > selectedHops ||
                (hops === selectedHops && targetLaneIndex >= selectedTarget)))))
      ) {
        continue;
      }
      selectedBudget = hopBudget;
      selectedCost = adjustedCost;
      selectedPhysical = physicalDistance;
      selectedHops = hops;
      selectedTarget = targetLaneIndex;
    }
    if (selectedBudget < 0 || selectedTarget < 0) return null;

    const successorLaneIndices: number[] = [];
    let laneIndex = lane.index;
    let hopBudget = selectedBudget;
    for (let guard = 0; guard <= selectedHops; guard += 1) {
      if (laneIndex === selectedTarget) break;
      const stateIndex = hopBudget * table.laneCount + laneIndex;
      const nextLaneIndex = table.nextLaneIndexByHopBudget[stateIndex];
      if (nextLaneIndex < 0 || hopBudget <= 0) return null;
      successorLaneIndices.push(nextLaneIndex);
      laneIndex = nextLaneIndex;
      hopBudget -= 1;
    }
    if (laneIndex !== selectedTarget) return null;
    return {
      successorLaneIndices,
      targetLaneIndex: selectedTarget,
      targetEntryDistance: base.targetEntryDistance[selectedTarget],
      targetExitDistance: base.targetExitDistance[selectedTarget],
      physicalDistanceM: selectedPhysical,
    };
  }

  private assignNpcLocalityRoutePlan(
    npc: NpcInternal,
    plan: LocalityRoutePlan | null,
  ): void {
    npc.localityRoutePlanLaneIndices = plan
      ? [...plan.successorLaneIndices]
      : [];
    npc.localityRoutePlanCursor = 0;
    npc.localityRoutePlanTargetLaneIndex = plan?.targetLaneIndex ?? -1;
    npc.localityRoutePlanTargetDistance =
      plan?.targetEntryDistance ?? Number.NaN;
    npc.localityRoutePlanTargetExitDistance =
      plan?.targetExitDistance ?? Number.NaN;
    npc.localityRoutePlanGeneration = plan
      ? this.localityRouteGoalGeneration
      : 0;
    npc.localityRoutePlanDeferredUntilReservationClears = false;
    npc.localityCommitmentLastRouteDistanceM =
      plan?.physicalDistanceM ?? Number.POSITIVE_INFINITY;
    this.invalidateLocalityAdmissionRouteTables();
  }

  private snapshotNpcLocalityRoutePlan(
    npc: NpcInternal,
  ): LocalityRoutePlan | null {
    if (
      npc.localityRoutePlanTargetLaneIndex < 0 ||
      !Number.isFinite(npc.localityRoutePlanTargetDistance) ||
      !Number.isFinite(npc.localityRoutePlanTargetExitDistance) ||
      !Number.isFinite(npc.localityCommitmentLastRouteDistanceM)
    ) {
      return null;
    }
    return {
      successorLaneIndices: npc.localityRoutePlanLaneIndices.slice(
        npc.localityRoutePlanCursor,
      ),
      targetLaneIndex: npc.localityRoutePlanTargetLaneIndex,
      targetEntryDistance: npc.localityRoutePlanTargetDistance,
      targetExitDistance: npc.localityRoutePlanTargetExitDistance,
      physicalDistanceM: npc.localityCommitmentLastRouteDistanceM,
    };
  }

  private npcLocalityRoutePlanIsValid(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): boolean {
    return (
      npc.localityRoutePlanGeneration === this.localityRouteGoalGeneration &&
      this.npcLocalityRoutePlanIsStructurallyValid(npc, lane)
    );
  }

  private npcLocalityRoutePlanIsStructurallyValid(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): boolean {
    if (
      !lane ||
      lane.index === undefined ||
      npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE ||
      npc.localityRoutePlanTargetLaneIndex < 0 ||
      !Number.isFinite(npc.localityRoutePlanTargetDistance) ||
      !Number.isFinite(npc.localityRoutePlanTargetExitDistance) ||
      npc.localityRoutePlanCursor < 0 ||
      npc.localityRoutePlanCursor > npc.localityRoutePlanLaneIndices.length
    ) {
      return false;
    }
    if (
      lane.index === npc.localityRoutePlanTargetLaneIndex &&
      npc.distance > npc.localityRoutePlanTargetExitDistance + 1e-9
    ) {
      return false;
    }
    let currentLane = lane;
    for (
      let cursor = npc.localityRoutePlanCursor;
      cursor < npc.localityRoutePlanLaneIndices.length;
      cursor += 1
    ) {
      const nextLane =
        this.roadNetwork.lanes[npc.localityRoutePlanLaneIndices[cursor]];
      if (
        !nextLane ||
        !currentLane.successorLaneIds.includes(nextLane.id) ||
        !this.roadNetwork.areLaneEndpointsContinuous(currentLane, nextLane)
      ) {
        return false;
      }
      currentLane = nextLane;
    }
    return currentLane.index === npc.localityRoutePlanTargetLaneIndex;
  }

  private npcLocalityRoutePlanRemainingDistance(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): number {
    if (!this.npcLocalityRoutePlanIsValid(npc, lane) || !lane) {
      return Number.POSITIVE_INFINITY;
    }
    const currentTargetEntryDistance = npc.localityRoutePlanTargetDistance;
    if (
      npc.localityRoutePlanCursor >= npc.localityRoutePlanLaneIndices.length
    ) {
      return lane.index === npc.localityRoutePlanTargetLaneIndex
        ? Math.max(0, currentTargetEntryDistance - npc.distance)
        : Number.POSITIVE_INFINITY;
    }
    let remaining = Math.max(0, lane.length - npc.distance);
    for (
      let cursor = npc.localityRoutePlanCursor;
      cursor < npc.localityRoutePlanLaneIndices.length;
      cursor += 1
    ) {
      const routeLane =
        this.roadNetwork.lanes[npc.localityRoutePlanLaneIndices[cursor]];
      if (!routeLane) return Number.POSITIVE_INFINITY;
      const final =
        cursor === npc.localityRoutePlanLaneIndices.length - 1;
      remaining += final
        ? currentTargetEntryDistance
        : routeLane.length;
    }
    return remaining;
  }

  private localityRouteGoalDistance(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    distance: number,
    hopBudget = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  ): number {
    if (!lane || lane.index === undefined) return Number.POSITIVE_INFINITY;
    const table = this.localityRouteGoalTable(goal);
    if (!table) return Number.POSITIVE_INFINITY;
    const clampedDistance = clamp(distance, 0, lane.length);
    const targetEntry = table.targetEntryDistance[lane.index];
    if (Number.isFinite(targetEntry)) {
      const targetExit = table.targetExitDistance[lane.index];
      const minimumDirectOriginDistance =
        table.targetMinimumDirectOriginDistance[lane.index];
      // Once a same-lane portal has passed the first contributing interval,
      // subtracting arclength would turn a missed target into distance zero.
      // Conservatively reject it; a later successor loop may be considered
      // from a different portal without falsifying this one.
      if (
        clampedDistance < minimumDirectOriginDistance - 1e-9 ||
        clampedDistance > targetExit + 1e-9
      ) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.max(0, targetEntry - clampedDistance);
    }
    const boundedHopBudget = clamp(
      Math.trunc(hopBudget),
      0,
      RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
    );
    const stateIndex = boundedHopBudget * table.laneCount + lane.index;
    const fromLaneStart =
      table.distanceFromLaneStartByHopBudget[stateIndex];
    if (!Number.isFinite(fromLaneStart)) return Number.POSITIVE_INFINITY;
    return Math.max(0, fromLaneStart - clampedDistance);
  }

  private localityRouteGoalHops(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    hopBudget = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  ): number {
    if (!lane || lane.index === undefined) return Number.POSITIVE_INFINITY;
    const table = this.localityRouteGoalTable(goal);
    if (!table) return Number.POSITIVE_INFINITY;
    if (Number.isFinite(table.targetEntryDistance[lane.index])) return 0;
    const boundedHopBudget = clamp(
      Math.trunc(hopBudget),
      0,
      RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
    );
    const stateIndex = boundedHopBudget * table.laneCount + lane.index;
    const hops = table.usedHopsByHopBudget[stateIndex];
    return hops === 0xffff ? Number.POSITIVE_INFINITY : hops;
  }

  private localityRouteGoalIsReachable(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    distance: number,
    maximumRouteDistanceM = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
    maximumHops = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  ): boolean {
    return (
      goal !== LOCALITY_ROUTE_GOAL_NONE &&
      this.localityRouteGoalDistance(
        goal,
        lane,
        distance,
        maximumHops,
      ) <=
        maximumRouteDistanceM &&
      this.localityRouteGoalHops(goal, lane, maximumHops) <= maximumHops
    );
  }

  /** Deterministic free-flow ETA for the immutable bounded goal label. It is
   * deliberately independent of current occupancy, portal cursor and NPC
   * identity: capacity must not oscillate because a temporary queue changes
   * which weighted admission plan happens to win this decision. Actual
   * activation still applies exact continuation, lane-load and safety gates. */
  private localityRouteGoalTravelTimeSeconds(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    distance: number,
    hopBudget = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  ): number {
    if (
      !lane ||
      lane.index === undefined ||
      !this.localityRouteGoalIsReachable(
        goal,
        lane,
        distance,
        RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
        hopBudget,
      )
    ) {
      return Number.POSITIVE_INFINITY;
    }
    const table = this.localityRouteGoalTable(goal);
    if (!table) return Number.POSITIVE_INFINITY;
    const speedOn = (routeLane: NormalizedLane): number =>
      Math.max(
        1,
        routeLane.speedLimitMps *
          LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR,
      );
    let currentLane = lane;
    let currentDistance = clamp(distance, 0, lane.length);
    let remainingHopBudget = clamp(
      Math.trunc(hopBudget),
      0,
      RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
    );
    let etaSeconds = LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS;
    for (
      let transition = 0;
      transition <= RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS;
      transition += 1
    ) {
      const laneIndex = currentLane.index;
      if (laneIndex === undefined) return Number.POSITIVE_INFINITY;
      const targetEntry = table.targetEntryDistance[laneIndex];
      if (Number.isFinite(targetEntry)) {
        const minimumDirectOrigin =
          table.targetMinimumDirectOriginDistance[laneIndex];
        const targetExit = table.targetExitDistance[laneIndex];
        if (
          currentDistance < minimumDirectOrigin - 1e-9 ||
          currentDistance > targetExit + 1e-9
        ) {
          return Number.POSITIVE_INFINITY;
        }
        etaSeconds +=
          Math.max(0, targetEntry - currentDistance) /
          speedOn(currentLane);
        return etaSeconds;
      }
      if (remainingHopBudget <= 0) return Number.POSITIVE_INFINITY;
      const stateIndex =
        remainingHopBudget * table.laneCount + laneIndex;
      const nextLaneIndex = table.nextLaneIndexByHopBudget[stateIndex];
      const nextLane = this.roadNetwork.lanes[nextLaneIndex];
      if (
        !nextLane ||
        !currentLane.successorLaneIds.includes(nextLane.id) ||
        !this.roadNetwork.areLaneEndpointsContinuous(currentLane, nextLane)
      ) {
        return Number.POSITIVE_INFINITY;
      }
      etaSeconds +=
        Math.max(0, currentLane.length - currentDistance) /
        speedOn(currentLane);
      currentLane = nextLane;
      currentDistance = 0;
      remainingHopBudget -= 1;
    }
    return Number.POSITIVE_INFINITY;
  }

  /** Free-flow ETA for one already-materialized route. Active handoffs have
   * no spawn/acceleration allowance; they keep their exact pose and speed and
   * only acquire future successor choices. */
  private localityRoutePlanTravelTimeSeconds(
    lane: NormalizedLane | undefined,
    distance: number,
    plan: LocalityRoutePlan,
  ): number {
    if (!lane || lane.index === undefined) return Number.POSITIVE_INFINITY;
    const speedOn = (routeLane: NormalizedLane): number =>
      Math.max(
        1,
        routeLane.speedLimitMps *
          LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR,
      );
    let etaSeconds = 0;
    let currentLane = lane;
    let currentDistance = clamp(distance, 0, currentLane.length);
    for (const nextLaneIndex of plan.successorLaneIndices) {
      const nextLane = this.roadNetwork.lanes[nextLaneIndex];
      if (
        !nextLane ||
        !currentLane.successorLaneIds.includes(nextLane.id) ||
        !this.roadNetwork.areLaneEndpointsContinuous(currentLane, nextLane)
      ) {
        return Number.POSITIVE_INFINITY;
      }
      etaSeconds +=
        Math.max(0, currentLane.length - currentDistance) /
        speedOn(currentLane);
      currentLane = nextLane;
      currentDistance = 0;
    }
    if (currentLane.index !== plan.targetLaneIndex) {
      return Number.POSITIVE_INFINITY;
    }
    if (currentDistance > plan.targetExitDistance + 1e-9) {
      return Number.POSITIVE_INFINITY;
    }
    etaSeconds +=
      Math.max(0, plan.targetEntryDistance - currentDistance) /
      speedOn(currentLane);
    return etaSeconds;
  }

  private localityApproachTargetForwardLongitudinal(
    targetLaneIndex: number,
    targetEntryDistance: number,
    targetExitDistance: number,
  ): number {
    const playerProjection = this.localityPlayerProjection;
    const targetLane = this.roadNetwork.lanes[targetLaneIndex];
    if (!playerProjection || !targetLane) return Number.NEGATIVE_INFINITY;
    const targetPose = this.closestLanePoseToPlayer(
      targetLane,
      targetEntryDistance,
      targetExitDistance,
    );
    return this.localityLongitudinal(targetPose, playerProjection);
  }

  /** A fixed destination is admitted only when its car can meet the moving
   * player at that forward crossing. This is checked once at assignment;
   * immutable journeys are never retargeted merely to renew the estimate. */
  private localityApproachTargetMeetsPlayerTiming(
    targetLaneIndex: number,
    targetEntryDistance: number,
    targetExitDistance: number,
    npcEtaSeconds: number,
    maximumNpcEtaSeconds: number,
  ): boolean {
    if (
      !Number.isFinite(npcEtaSeconds) ||
      npcEtaSeconds > maximumNpcEtaSeconds + 1e-9
    ) {
      return false;
    }
    const forwardLongitudinal =
      this.localityApproachTargetForwardLongitudinal(
        targetLaneIndex,
        targetEntryDistance,
        targetExitDistance,
      );
    if (
      forwardLongitudinal < -1e-9 ||
      forwardLongitudinal > LOCAL_TRAFFIC_INNER_RADIUS_M + 1e-9
    ) {
      return false;
    }
    const playerSpeedMps = Math.abs(this.playerState.signedSpeedMps);
    if (playerSpeedMps < 1) return true;
    const playerEtaSeconds =
      forwardLongitudinal /
      Math.max(
        LOCAL_TRAFFIC_APPROACH_INTERCEPT_MIN_PLAYER_SPEED_MPS,
        playerSpeedMps,
      );
    return (
      npcEtaSeconds <=
      playerEtaSeconds + LOCAL_TRAFFIC_APPROACH_INTERCEPT_GRACE_SECONDS + 1e-9
    );
  }

  private localityApproachPlanMeetsPlayerTiming(
    plan: LocalityRoutePlan,
    npcEtaSeconds: number,
    maximumNpcEtaSeconds: number,
  ): boolean {
    return this.localityApproachTargetMeetsPlayerTiming(
      plan.targetLaneIndex,
      plan.targetEntryDistance,
      plan.targetExitDistance,
      npcEtaSeconds,
      maximumNpcEtaSeconds,
    );
  }

  /** Remaining free-flow time until this immutable cross journey can enter
   * the current 90 m contribution circle. Infinity deliberately means it may
   * still own a pipeline slot but cannot suppress an actual near deficit. */
  private npcApproachContributionEtaSeconds(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): number {
    const playerProjection = this.localityPlayerProjection;
    const plan = this.snapshotNpcLocalityRoutePlan(npc);
    const targetLane = plan
      ? this.roadNetwork.lanes[plan.targetLaneIndex]
      : undefined;
    if (!playerProjection || !plan || !targetLane) {
      return Number.POSITIVE_INFINITY;
    }
    const contributionInterval = this.firstLaneLocalityInterval(
      targetLane,
      LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M,
      playerProjection,
      false,
    );
    if (!contributionInterval) return Number.POSITIVE_INFINITY;
    return this.localityRoutePlanTravelTimeSeconds(lane, npc.distance, {
      ...plan,
      targetEntryDistance: contributionInterval.entryDistance,
      targetExitDistance: contributionInterval.exitDistance,
    });
  }

  private localityRouteGoalTargetLaneIndex(
    goal: LocalityRouteGoal,
    lane: NormalizedLane | undefined,
    distance: number,
    hopBudget: number,
  ): number {
    if (lane?.index === undefined) return -1;
    const table = this.localityRouteGoalTable(goal);
    if (!table) return -1;
    const clampedDistance = clamp(distance, 0, lane.length);
    if (Number.isFinite(table.targetEntryDistance[lane.index])) {
      return clampedDistance >=
        table.targetMinimumDirectOriginDistance[lane.index] - 1e-9 &&
        clampedDistance <= table.targetExitDistance[lane.index] + 1e-9
        ? lane.index
        : -1;
    }
    const boundedHopBudget = clamp(
      Math.trunc(hopBudget),
      0,
      RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
    );
    return table.targetLaneIndexByHopBudget[
      boundedHopBudget * table.laneCount + lane.index
    ];
  }

  private markLocalityStreamableTarget(
    goal: LocalityRouteGoal,
    lane: NormalizedLane,
    distance: number,
    hopBudget: number,
    targets: Uint8Array,
  ): void {
    if (
      this.localityRouteGoalTravelTimeSeconds(
        goal,
        lane,
        distance,
        hopBudget,
      ) > LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS
    ) {
      return;
    }
    const targetLaneIndex = this.localityRouteGoalTargetLaneIndex(
      goal,
      lane,
      distance,
      hopBudget,
    );
    if (targetLaneIndex >= 0) targets[targetLaneIndex] = 1;
  }

  /** Collect unique target intervals that an immutable hidden label can reach
   * inside the bounded ETA. Counting destination storage (rather than source
   * portals) prevents many feeder lanes from inflating one short funnel. Every
   * hop budget is considered, exposing distinct legal targets without reading
   * the load-weighted admission table or mutable portal cursor. */
  private refreshLocalityStreamableCorridorCapacities(): void {
    const laneCount = this.roadNetwork.lanes.length;
    if (this.localityStreamableCurrentTargetScratch.length !== laneCount) {
      this.localityStreamableCurrentTargetScratch = new Uint8Array(laneCount);
      this.localityStreamableForwardTargetScratch = new Uint8Array(laneCount);
    } else {
      this.localityStreamableCurrentTargetScratch.fill(0);
      this.localityStreamableForwardTargetScratch.fill(0);
    }
    this.localityApproachRouteFeedAvailable = false;
    this.runtimePortalIndex.markAnnulus(
      this.playerState.player,
      RUNTIME_TRAFFIC_APPROACH_MIN_M,
      RUNTIME_TRAFFIC_APPROACH_MAX_M,
    );
    this.runtimePortalIndex.forEachMarked((portal) => {
      const lane = this.roadNetwork.lanesById.get(portal.laneId);
      if (
        lane?.index === undefined ||
        !this.trafficCapacityLaneIds.has(lane.id)
      ) {
        return;
      }
      for (
        let hopBudget = 0;
        hopBudget <= RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS;
        hopBudget += 1
      ) {
        if (!this.localityApproachRouteFeedAvailable) {
          const approachTargetLaneIndex =
            this.localityRouteGoalTargetLaneIndex(
              LOCALITY_ROUTE_GOAL_APPROACH,
              lane,
              portal.distance,
              hopBudget,
            );
          const approachTable = this.localityApproachRouteGoalTable;
          const approachEtaSeconds =
            LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS +
            this.localityRouteGoalTravelTimeSeconds(
              LOCALITY_ROUTE_GOAL_APPROACH,
              lane,
              portal.distance,
              hopBudget,
            );
          if (
            approachTargetLaneIndex >= 0 &&
            approachTable &&
            this.localityApproachTargetMeetsPlayerTiming(
              approachTargetLaneIndex,
              approachTable.targetEntryDistance[approachTargetLaneIndex],
              approachTable.targetExitDistance[approachTargetLaneIndex],
              approachEtaSeconds,
              LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS,
            )
          ) {
            this.localityApproachRouteFeedAvailable = true;
          }
        }
        this.markLocalityStreamableTarget(
          LOCALITY_ROUTE_GOAL_CURRENT,
          lane,
          portal.distance,
          hopBudget,
          this.localityStreamableCurrentTargetScratch,
        );
        this.markLocalityStreamableTarget(
          LOCALITY_ROUTE_GOAL_FORWARD,
          lane,
          portal.distance,
          hopBudget,
          this.localityStreamableForwardTargetScratch,
        );
      }
    });
    const laneCap = this.localityLaneOccupancyCap();
    const currentTable = this.localityCurrentRouteGoalTable;
    const forwardTable = this.localityForwardRouteGoalTable;
    let currentSlots = 0;
    let forwardSlots = 0;
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const targetLane = this.roadNetwork.lanes[laneIndex];
      // Classification may count a car passing through an aligned connector,
      // but stable storage capacity uses the same authored eligibility set as
      // radial density. Terminal/control-only geometry cannot inflate a hard
      // target that production portals are not allowed to occupy.
      if (
        !targetLane ||
        !this.trafficCapacityLaneIds.has(targetLane.id)
      ) {
        continue;
      }
      if (this.localityStreamableCurrentTargetScratch[laneIndex] === 1) {
        currentSlots += Math.min(
          laneCap,
          Math.floor(
            Math.max(
              0,
              (currentTable?.targetExitDistance[laneIndex] ?? 0) -
                (currentTable?.targetEntryDistance[laneIndex] ?? 0),
            ) / LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
          ),
        );
      }
      if (this.localityStreamableForwardTargetScratch[laneIndex] === 1) {
        forwardSlots += Math.min(
          laneCap,
          Math.floor(
            Math.max(
              0,
              (forwardTable?.targetExitDistance[laneIndex] ?? 0) -
                (forwardTable?.targetEntryDistance[laneIndex] ?? 0),
            ) / LOCAL_TRAFFIC_CORRIDOR_CAPACITY_SPACING_M,
          ),
        );
      }
    }
    const corridorCap = this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP
      : LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP;
    this.localityStreamableCurrentRoadCapacity = Math.min(
      corridorCap,
      currentSlots,
    );
    this.localityStreamableForwardCorridorCapacity = Math.min(
      corridorCap,
      forwardSlots,
    );
  }

  private routeGoalForPreference(
    preference: LocalTrafficPortalPreference | undefined,
  ): LocalityRouteGoal {
    if (preference?.requireForwardCorridor) return LOCALITY_ROUTE_GOAL_FORWARD;
    if (preference?.requireCurrentRoadCorridor) return LOCALITY_ROUTE_GOAL_CURRENT;
    if (
      preference?.requireAheadOrApproaching ||
      preference?.proactivePipeline
    ) {
      return LOCALITY_ROUTE_GOAL_APPROACH;
    }
    return LOCALITY_ROUTE_GOAL_NONE;
  }

  /** A tangent alone is not enough on a one-way grid: a lane can point at the
   * player just before the NPC's deterministic successor choice carries it
   * back out. Follow that exact choice (not an existential graph branch). The
   * fog check shares road-leading's six-hop / 240 m envelope; inner-target
   * replenishment gets a separately bounded 750 m / 12-hop horizon because a
   * legal 520–680 m portal cannot reach the 250 m circle inside the shorter
   * route-leading envelope. */
  private npcRouteCanReachLocalRadius(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
    radiusM: number,
    maximumRouteDistanceM?: number,
    maximumHops?: number,
  ): boolean {
    if (!firstLane) return false;
    const innerTarget = radiusM <= LOCAL_TRAFFIC_INNER_RADIUS_M;
    const routeLookaheadM =
      maximumRouteDistanceM ??
      (innerTarget
        ? RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M
        : ROUTE_LOOKAHEAD_LIMIT_M);
    const routeMaxHops =
      maximumHops ??
      (innerTarget
        ? RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS
        : ROUTE_LOOKAHEAD_MAX_HOPS);
    let lane = firstLane;
    let distance = clamp(firstDistance, 0, lane.length);
    let distanceTravelled = 0;
    let transitionCount = npc.transitionCount;
    const routeGoal = npc.localityRouteGoal;
    let routeGoalRemainingHops = npc.localityRouteGoalRemainingHops;
    let routePlanCursor = npc.localityRoutePlanCursor;
    for (let depth = 0; depth <= routeMaxHops; depth += 1) {
      const remainingLookaheadM = routeLookaheadM - distanceTravelled;
      if (remainingLookaheadM < 0) return false;
      const toDistance = Math.min(
        lane.length,
        distance + remainingLookaheadM,
      );
      if (this.laneSegmentReachesLocalRadius(lane, distance, toDistance, radiusM)) {
        return true;
      }
      const distanceToEndM = lane.length - distance;
      if (depth >= routeMaxHops || distanceToEndM > remainingLookaheadM) return false;
      const nextLane = this.nextLaneForNpcAtTransition(
        npc,
        lane,
        transitionCount,
        routeGoal,
        routeGoalRemainingHops,
        routePlanCursor,
      );
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        return false;
      }
      distanceTravelled += distanceToEndM;
      transitionCount += 1;
      if (
        routeGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        routeGoalRemainingHops > 0
      ) {
        routeGoalRemainingHops -= 1;
      }
      if (routePlanCursor < npc.localityRoutePlanLaneIndices.length) {
        routePlanCursor += 1;
      }
      lane = nextLane;
      distance = 0;
    }
    return false;
  }

  /** Admission-only dead-end proof. Follow the same stable successor choices
   * movement will take and require enough continuous road to cross and leave a
   * neighbourhood. It consumes no PRNG state and changes no route decision. */
  private npcRouteCanContinue(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
    routeGoal: LocalityRouteGoal = npc.localityRouteGoal,
    routePlan: LocalityRoutePlan | null = null,
  ): boolean {
    if (!firstLane) return false;
    let lane = firstLane;
    let distance = clamp(firstDistance, 0, lane.length);
    let travelled = 0;
    let transitionCount = npc.transitionCount;
    let routePlanCursor = 0;
    let activeRouteGoal = routeGoal;
    let routeGoalRemainingHops =
      routeGoal === LOCALITY_ROUTE_GOAL_NONE
        ? 0
        : routePlan?.successorLaneIndices.length ??
          this.localityRouteGoalHops(routeGoal, firstLane);
    if (!Number.isFinite(routeGoalRemainingHops)) return false;
    for (let depth = 0; depth <= RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS; depth += 1) {
      travelled += Math.max(0, lane.length - distance);
      if (travelled >= RUNTIME_TRAFFIC_MIN_CONTINUOUS_ROUTE_M) return true;
      if (depth >= RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS) return false;
      const plannedNextLaneIndex =
        routePlanCursor < (routePlan?.successorLaneIndices.length ?? 0)
          ? routePlan?.successorLaneIndices[routePlanCursor]
          : undefined;
      const nextLane =
        plannedNextLaneIndex !== undefined
          ? this.roadNetwork.lanes[plannedNextLaneIndex]
          : this.nextLaneForNpcAtTransition(
              npc,
              lane,
              transitionCount,
              activeRouteGoal,
              routeGoalRemainingHops,
            );
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        return false;
      }
      transitionCount += 1;
      if (plannedNextLaneIndex !== undefined) routePlanCursor += 1;
      if (activeRouteGoal !== LOCALITY_ROUTE_GOAL_NONE && routeGoalRemainingHops > 0) {
        routeGoalRemainingHops -= 1;
      }
      if (
        routePlan &&
        routePlanCursor >= routePlan.successorLaneIndices.length
      ) {
        activeRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
        routeGoalRemainingHops = 0;
      }
      lane = nextLane;
      distance = 0;
    }
    return false;
  }

  private npcRouteStaysOutsideRadiusUntilRecycle(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
    excludedRadiusM: number,
  ): boolean {
    if (!firstLane) return false;
    let lane = firstLane;
    let distance = clamp(firstDistance, 0, lane.length);
    let travelled = 0;
    let transitionCount = npc.transitionCount;
    for (let depth = 0; depth <= RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS; depth += 1) {
      let segmentStartDistance = 0;
      for (let index = 0; index < lane.segmentLengths.length; index += 1) {
        const segmentLength = lane.segmentLengths[index];
        const segmentEndDistance = segmentStartDistance + segmentLength;
        if (segmentEndDistance < distance || segmentLength <= Number.EPSILON) {
          segmentStartDistance = segmentEndDistance;
          continue;
        }
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const startFraction = clamp(
          (Math.max(distance, segmentStartDistance) - segmentStartDistance) /
            segmentLength,
          0,
          1,
        );
        const fromX = start.x + (end.x - start.x) * startFraction;
        const fromZ = start.z + (end.z - start.z) * startFraction;
        if (
          distanceToSegmentSquared(
            this.playerState.player.x,
            this.playerState.player.z,
            fromX,
            fromZ,
            end.x,
            end.z,
          ) <= excludedRadiusM ** 2
        ) {
          return false;
        }
        travelled += Math.hypot(end.x - fromX, end.z - fromZ);
        if (
          distanceSquared(end, this.playerState.player) >=
          RUNTIME_TRAFFIC_RECYCLE_RADIUS_M ** 2
        ) {
          return true;
        }
        if (travelled >= RUNTIME_TRAFFIC_MIN_CONTINUOUS_ROUTE_M) return true;
        segmentStartDistance = segmentEndDistance;
      }
      if (depth >= RUNTIME_TRAFFIC_CONTINUATION_MAX_HOPS) return false;
      const nextLane = this.nextLaneForNpcAtTransition(npc, lane, transitionCount);
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        return false;
      }
      transitionCount += 1;
      lane = nextLane;
      distance = 0;
    }
    return false;
  }

  private npcRouteStaysOuterForCirculation(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
  ): boolean {
    return this.npcRouteStaysOutsideRadiusUntilRecycle(
      npc,
      firstLane,
      firstDistance,
      LOCAL_TRAFFIC_FOG_RADIUS_M,
    );
  }

  /** The camera may orbit independently, so every perceptual bucket is fixed
   * to the projected road heading. This keeps the controller from shuffling
   * traffic merely because the player used quick-look. */
  private localityRoadHeading(playerProjection: LaneProjection | null): number {
    return playerProjection?.heading ?? this.playerState.player.heading;
  }

  private localityLongitudinal(
    point: SimulationPoint,
    playerProjection: LaneProjection | null,
  ): number {
    const heading = this.localityRoadHeading(playerProjection);
    const dx = point.x - this.playerState.player.x;
    const dz = point.z - this.playerState.player.z;
    return dx * Math.sin(heading) + dz * Math.cos(heading);
  }

  private localityLateral(
    point: SimulationPoint,
    playerProjection: LaneProjection | null,
  ): number {
    const heading = this.localityRoadHeading(playerProjection);
    const dx = point.x - this.playerState.player.x;
    const dz = point.z - this.playerState.player.z;
    return dx * Math.cos(heading) - dz * Math.sin(heading);
  }

  /** Stable four-way bucket: exact diagonals belong to forward/rear so float
   * ties cannot oscillate between lateral buckets. */
  private localitySector(
    point: SimulationPoint,
    playerProjection: LaneProjection | null,
  ): LocalTrafficSector {
    const longitudinal = this.localityLongitudinal(point, playerProjection);
    const lateral = this.localityLateral(point, playerProjection);
    if (Math.abs(longitudinal) >= Math.abs(lateral)) {
      return longitudinal >= 0 ? 0 : 2;
    }
    return lateral >= 0 ? 1 : 3;
  }

  private isAheadOfPlayer(point: SimulationPoint): boolean {
    const dx = point.x - this.playerState.player.x;
    const dz = point.z - this.playerState.player.z;
    const separation = Math.hypot(dx, dz);
    if (separation <= Number.EPSILON) return true;
    const bearing = Math.atan2(dx, dz);
    return (
      Math.abs(angleDifference(bearing, this.playerState.player.heading)) <=
      (50 * Math.PI) / 180
    );
  }

  private isApproachingCrossTraffic(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): boolean {
    if (!lane || npc.speedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS) return false;
    const dx = npc.x - this.playerState.player.x;
    const dz = npc.z - this.playerState.player.z;
    const separation = Math.hypot(dx, dz);
    if (separation <= Number.EPSILON || this.isAheadOfPlayer(npc)) return false;
    const laneHeading = this.roadNetwork.pointOnLane(lane, npc.distance).heading;
    const crossTangent =
      Math.abs(
        Math.cos(
          angleDifference(laneHeading, this.playerState.player.heading),
        ),
      ) < Math.cos((40 * Math.PI) / 180);
    const inward =
      Math.sin(laneHeading) * -dx + Math.cos(laneHeading) * -dz > 0;
    return (
      crossTangent &&
      inward &&
      this.routeApproachesPlayerRoad(npc, lane, npc.distance)
    );
  }

  private pointDistanceToLaneSquared(
    point: SimulationPoint,
    lane: NormalizedLane,
  ): number {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < lane.points.length; index += 1) {
      best = Math.min(
        best,
        distanceToSegmentSquared(
          point.x,
          point.z,
          lane.points[index - 1].x,
          lane.points[index - 1].z,
          lane.points[index].x,
          lane.points[index].z,
        ),
      );
    }
    return best;
  }

  /** Geometry-only current-road proof used while forecasting a deterministic
   * route. It intentionally does not invoke routeDistanceAhead recursively. */
  private isOnCurrentRoadGeometry(
    lane: NormalizedLane | undefined,
    point: SimulationPoint,
    heading: number,
    playerProjection: LaneProjection | null,
  ): boolean {
    if (!lane || !playerProjection) return false;
    const currentLane = playerProjection.lane;
    // The cached connected-corridor mask spans junction-sized lane pieces and
    // paired/opposing carriageways without accepting turning successors.
    if (
      lane.index !== undefined &&
      this.localityCurrentCorridorLaneMask.length ===
        this.roadNetwork.lanes.length
    ) {
      return this.localityCurrentCorridorLaneMask[lane.index] === 1;
    }
    // Pre-refresh/direct synthetic compatibility fallback.
    if (
      lane.id === currentLane.id ||
      lane.id === currentLane.adjacentLaneId ||
      lane.adjacentLaneId === currentLane.id
    ) {
      return true;
    }
    const parallelAlignment = Math.abs(
      Math.cos(angleDifference(heading, playerProjection.heading)),
    );
    if (parallelAlignment < Math.cos((40 * Math.PI) / 180)) return false;
    if (
      this.pointDistanceToLaneSquared(point, currentLane) <=
      LOCAL_TRAFFIC_CORRIDOR_HALF_WIDTH_M ** 2
    ) {
      return true;
    }
    return false;
  }

  /** A current-road vehicle must relate to the actual projected road identity.
   * The fallback remains geometry-only for synthetic lanes without roadId;
   * route reachability must never turn an arbitrary turning successor into the
   * player's street. */
  private isOnCurrentRoadCorridor(
    lane: NormalizedLane | undefined,
    laneDistance: number,
    point: SimulationPoint,
    heading: number,
    playerProjection: LaneProjection | null,
  ): boolean {
    void laneDistance;
    return this.isOnCurrentRoadGeometry(
      lane,
      point,
      heading,
      playerProjection,
    );
  }

  /** Bit 1: this stable route enters the current-road corridor inside fog.
   * Bit 2: it does so in the forward half-plane. The walk follows exactly the
   * successor choices movement will take, so cross-street portals cannot claim
   * a corridor merely because some other graph branch could reach it. */
  private npcRouteCurrentRoadFeedBits(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
    playerProjection: LaneProjection | null,
    maximumRouteDistanceM = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
    maximumHops = RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  ): number {
    if (!firstLane || !playerProjection) return 0;
    let lane = firstLane;
    let distance = clamp(firstDistance, 0, lane.length);
    let distanceTravelled = 0;
    let transitionCount = npc.transitionCount;
    let result = 0;
    let currentRoadEntrySeen = false;
    let enteredCurrentRoadAsRearFollower = false;
    for (
      let depth = 0;
      depth <= maximumHops;
      depth += 1
    ) {
      const remainingLookahead = maximumRouteDistanceM - distanceTravelled;
      if (remainingLookahead < 0) return result;
      const visitEndDistance = Math.min(
        lane.length,
        distance + remainingLookahead,
      );
      let segmentStartDistance = 0;
      for (let index = 0; index < lane.segmentLengths.length; index += 1) {
        const segmentLength = lane.segmentLengths[index];
        const segmentEndDistance = segmentStartDistance + segmentLength;
        if (
          segmentEndDistance < distance ||
          segmentLength <= Number.EPSILON
        ) {
          segmentStartDistance = segmentEndDistance;
          continue;
        }
        if (segmentStartDistance > visitEndDistance) break;
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const startFraction = clamp(
          (Math.max(distance, segmentStartDistance) - segmentStartDistance) /
            segmentLength,
          0,
          1,
        );
        const endFraction = clamp(
          (Math.min(visitEndDistance, segmentEndDistance) -
            segmentStartDistance) /
            segmentLength,
          0,
          1,
        );
        const startX = start.x + (end.x - start.x) * startFraction;
        const startZ = start.z + (end.z - start.z) * startFraction;
        const endX = start.x + (end.x - start.x) * endFraction;
        const endZ = start.z + (end.z - start.z) * endFraction;
        const dx = endX - startX;
        const dz = endZ - startZ;
        const remainingSegmentSquared = dx * dx + dz * dz;
        const toPlayerX = this.playerState.player.x - startX;
        const toPlayerZ = this.playerState.player.z - startZ;
        const closestFraction = remainingSegmentSquared > Number.EPSILON
          ? clamp(
              (toPlayerX * dx + toPlayerZ * dz) / remainingSegmentSquared,
              0,
              1,
            )
          : 0;
        const sample = {
          x: startX + dx * closestFraction,
          z: startZ + dz * closestFraction,
        };
        const heading = Math.atan2(end.x - start.x, end.z - start.z);
        const sameDirection =
          Math.cos(angleDifference(heading, playerProjection.heading)) >=
          Math.cos((40 * Math.PI) / 180);
        const insideFog =
          distanceSquared(sample, this.playerState.player) <=
          LOCAL_TRAFFIC_FOG_RADIUS_M ** 2;
        const onCurrentRoadGeometry =
          insideFog &&
          this.isOnCurrentRoadGeometry(
            lane,
            sample,
            heading,
            playerProjection,
          );
        if (onCurrentRoadGeometry && !currentRoadEntrySeen) {
          currentRoadEntrySeen = true;
          enteredCurrentRoadAsRearFollower =
            sameDirection &&
            this.localityLongitudinal(
              { x: startX, z: startZ },
              playerProjection,
            ) < 0;
          if (enteredCurrentRoadAsRearFollower) result |= 8;
        }
        if (onCurrentRoadGeometry && !enteredCurrentRoadAsRearFollower) {
          result |= 1;
          if (this.localityLongitudinal(sample, playerProjection) >= 0) {
            result |= 2;
            return result;
          }
        }
        segmentStartDistance = segmentEndDistance;
      }
      const distanceToEnd = lane.length - distance;
      if (
        depth >= maximumHops ||
        distanceToEnd > remainingLookahead
      ) {
        return result;
      }
      const nextLane = this.nextLaneForNpcAtTransition(npc, lane, transitionCount);
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        return result;
      }
      distanceTravelled += distanceToEnd;
      transitionCount += 1;
      lane = nextLane;
      distance = 0;
    }
    return result;
  }

  private headingApproachesPlayer(point: SimulationPoint, heading: number): boolean {
    const towardPlayerX = this.playerState.player.x - point.x;
    const towardPlayerZ = this.playerState.player.z - point.z;
    const distance = Math.hypot(towardPlayerX, towardPlayerZ);
    if (distance <= Number.EPSILON) return false;
    return (
      (Math.sin(heading) * towardPlayerX +
        Math.cos(heading) * towardPlayerZ) /
        distance >=
      LOCAL_TRAFFIC_APPROACHING_HEADING_DOT_MIN
    );
  }

  private routeApproachesPlayerRoad(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
    distance: number,
  ): boolean {
    return this.npcRouteCanReachLocalRadius(
      npc,
      lane,
      distance,
      LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M,
    );
  }

  private activeCountOnLane(laneId: string): number {
    let count = 0;
    for (const npc of this.npcsList) {
      if (npc.active && npc.laneId === laneId) count += 1;
    }
    return count;
  }

  private isNpcPatrol(npc: NpcInternal): boolean {
    return npc.patrol;
  }

  private patrolFogCap(): number {
    return this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_PATROL_FOG_CAP
      : LOCAL_TRAFFIC_DESKTOP_PATROL_FOG_CAP;
  }

  private localityNearViewRadiusM(): number {
    return this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_RADIUS_M
      : LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_RADIUS_M;
  }

  private localityNearViewTarget(): number {
    return Math.min(
      this.npcsList.length,
      this.config.touchFirst
        ? LOCAL_TRAFFIC_TOUCH_NEAR_VIEW_TARGET
        : LOCAL_TRAFFIC_DESKTOP_NEAR_VIEW_TARGET,
    );
  }

  private localityMovingNearViewTarget(): number {
    return Math.min(
      this.localityNearViewTarget(),
      this.config.touchFirst
        ? LOCAL_TRAFFIC_TOUCH_MOVING_NEAR_VIEW_TARGET
        : LOCAL_TRAFFIC_DESKTOP_MOVING_NEAR_VIEW_TARGET,
    );
  }

  /** Fresh-reset staging must reserve the same bounded cross-traffic supply
   * that runtime would otherwise have to reclaim from a full local pool. The
   * immutable fast-feed miss is nested, so one journey covers both current
   * and forward continuity compensation; close-presence keeps a small floor
   * even on a topology-rich corridor. */
  private localityInitialAheadJourneyTarget(): number {
    if (!this.localityApproachRouteFeedAvailable) return 0;
    const approachReserve = this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_APPROACH_RESERVE
      : LOCAL_TRAFFIC_DESKTOP_APPROACH_RESERVE;
    return Math.min(
      // Current/forward traffic is the primary nested street target. Tiny
      // pools and focused fixtures must not spend their only identity on a
      // cross-approach reserve before that target has a slot.
      Math.max(
        0,
        this.npcsList.length -
          this.localityPerceptualTarget.currentRoadCorridor,
      ),
      approachReserve,
      Math.max(
        this.localityNearViewTarget(),
        Math.ceil(this.localityCorridorContinuityCompensation / 2),
      ),
    );
  }

  private gateFitsLocalOccupancyCaps(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    playerProjection: LaneProjection | null,
  ): boolean {
    const lane = this.roadNetwork.lanesById.get(gate.laneId);
    if (!lane) return false;
    const laneCap = this.config.touchFirst
      ? LOCAL_TRAFFIC_TOUCH_LANE_OCCUPANCY_CAP
      : LOCAL_TRAFFIC_DESKTOP_LANE_OCCUPANCY_CAP;
    if (this.activeCountOnLane(lane.id) >= laneCap) return false;
    const pose = this.roadNetwork.pointOnLane(lane, gate.distance);
    if (this.isNpcPatrol(npc)) {
      const playerDistanceSquared = distanceSquared(
        pose,
        this.playerState.player,
      );
      if (
        playerDistanceSquared <= LOCAL_TRAFFIC_INNER_RADIUS_M ** 2 &&
        this.localityPatrolWithinInnerCount >= LOCAL_TRAFFIC_PATROL_INNER_CAP
      ) {
        return false;
      }
      if (
        playerDistanceSquared <= LOCAL_TRAFFIC_FOG_RADIUS_M ** 2 &&
        this.localityPatrolWithinFogCount >= this.patrolFogCap()
      ) {
        return false;
      }
    }
    if (
      this.isOnCurrentRoadCorridor(
        lane,
        gate.distance,
        pose,
        pose.heading,
        playerProjection,
      )
    ) {
      const corridorCap = this.config.touchFirst
        ? LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP
        : LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP;
      if (this.localityBalanceCurrentRoadCorridorCount >= corridorCap) return false;
    }
    return true;
  }

  private leastPopulatedLocalitySector(): LocalTrafficSector {
    let sector: LocalTrafficSector = 0;
    let count = this.localityBalanceSectorForwardCount;
    if (this.localityBalanceSectorRightCount < count) {
      sector = 1;
      count = this.localityBalanceSectorRightCount;
    }
    if (this.localityBalanceSectorRearCount < count) {
      sector = 2;
      count = this.localityBalanceSectorRearCount;
    }
    if (this.localityBalanceSectorLeftCount < count) sector = 3;
    return sector;
  }

  private portalPerceptualBits(
    npc: NpcInternal,
    portal: RuntimeTrafficPortal,
    lane: NormalizedLane,
    playerProjection: LaneProjection | null,
    preference: LocalTrafficPortalPreference | undefined,
  ): number {
    const portalDistance = Math.hypot(
      portal.x - this.playerState.player.x,
      portal.z - this.playerState.player.z,
    );
    // Fresh-reset portals inside the visible bubble must contribute now. A
    // future route promise is valid only for a runtime portal hidden beyond
    // the conservative presentation envelope.
    const hiddenRouteFeed = portalDistance >= RUNTIME_TRAFFIC_APPROACH_MIN_M;
    let currentRoad = this.isOnCurrentRoadCorridor(
      lane,
      portal.distance,
      portal,
      portal.heading,
      playerProjection,
    );
    let forward =
      currentRoad && this.localityLongitudinal(portal, playerProjection) >= 0;
    currentRoad =
      currentRoad ||
      (hiddenRouteFeed &&
        (this.localityRouteGoalIsReachable(
          LOCALITY_ROUTE_GOAL_CURRENT,
          lane,
          portal.distance,
        ) ||
          this.localityRouteGoalIsReachable(
            LOCALITY_ROUTE_GOAL_FORWARD,
            lane,
            portal.distance,
          )));
    forward =
      forward ||
      (hiddenRouteFeed &&
        this.localityRouteGoalIsReachable(
          LOCALITY_ROUTE_GOAL_FORWARD,
          lane,
          portal.distance,
        ));
    const needsAheadFeed = Boolean(
      preference?.preferAheadOrApproaching ||
        preference?.requireAheadOrApproaching,
    );
    const directAhead =
      portalDistance <= LOCAL_TRAFFIC_INNER_RADIUS_M &&
      this.isAheadOfPlayer(portal);
    // A deterministic route that reaches the 90 m approach corridor will
    // necessarily enter the 250 m union either in the player's ahead cone or
    // as inward-moving cross traffic. Unlike tangent scoring, this proves the
    // exact successor choices of this identity.
    const aheadOrApproaching =
      needsAheadFeed &&
      (directAhead ||
        (hiddenRouteFeed &&
          this.localityRouteGoalIsReachable(
            LOCALITY_ROUTE_GOAL_APPROACH,
            lane,
            portal.distance,
          )));
    return (
      (currentRoad ? 1 : 0) |
      (forward ? 2 : 0) |
      (aheadOrApproaching ? 4 : 0)
    );
  }

  private portalMeetsHardPreference(
    npc: NpcInternal,
    portal: RuntimeTrafficPortal,
    lane: NormalizedLane,
    preference: LocalTrafficPortalPreference | undefined,
    perceptualBits: number,
  ): boolean {
    if ((perceptualBits & 8) !== 0) return false;
    const playerProjection = this.localityPlayerProjection;
    const sameDirectionRearCorridor =
      playerProjection !== null &&
      this.isOnCurrentRoadGeometry(
        lane,
        portal,
        portal.heading,
        playerProjection,
      ) &&
      this.localityLongitudinal(portal, playerProjection) < 0 &&
      Math.cos(angleDifference(portal.heading, playerProjection.heading)) >=
        Math.cos((40 * Math.PI) / 180);
    if (sameDirectionRearCorridor) {
      // A stationary player is the lead vehicle on this exact lane. One rear
      // follower is a plausible street scene; a streamed queue is not.
      for (const other of this.npcsList) {
        if (
          other.active &&
          this.localityLongitudinal(other, playerProjection) < 0 &&
          Math.cos(angleDifference(other.heading, playerProjection.heading)) >=
            Math.cos((40 * Math.PI) / 180) &&
          this.isOnCurrentRoadGeometry(
            this.roadNetwork.lanesById.get(other.laneId),
            other,
            other.heading,
            playerProjection,
          )
        ) {
          return false;
        }
      }
    }
    if (preference?.requireCurrentRoadCorridor && (perceptualBits & 1) === 0) {
      return false;
    }
    if (preference?.requireForwardCorridor && (perceptualBits & 2) === 0) {
      return false;
    }
    if (
      preference?.requireAheadOrApproaching &&
      (perceptualBits & 4) === 0
    ) {
      return false;
    }
    if (
      preference?.outerLocalOnly &&
      !this.npcRouteStaysOutsideRadiusUntilRecycle(
        npc,
        lane,
        portal.distance,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
      )
    ) {
      return false;
    }
    return true;
  }

  private portalPreferenceScore(
    portal: RuntimeTrafficPortal,
    lane: NormalizedLane,
    playerProjection: LaneProjection | null,
    preference: LocalTrafficPortalPreference | undefined,
    perceptualBits: number,
    routePlan: LocalityRoutePlan | null,
  ): number {
    const currentRoad = (perceptualBits & 1) !== 0;
    const forward = (perceptualBits & 2) !== 0;
    const approaching = (perceptualBits & 4) !== 0;
    const inbound = this.headingApproachesPlayer(portal, portal.heading);
    // A hard destination promise should arrive, not merely be reachable. The
    // bounded materialized plan already owns exact legal distance, so use it
    // to rank the small inspected portal window. This keeps hidden journeys
    // from selecting a 600–750 m detour while a 100–300 m route to a distinct
    // target is available, without another graph walk or mutable ETA cache.
    let score =
      this.activeCountOnLane(lane.id) * 4 +
      (routePlan?.physicalDistanceM ?? 0);
    if (preference?.preferCurrentRoadCorridor && !currentRoad) score += 800;
    if (preference?.preferForwardCorridor && !forward) score += 600;
    if (preference?.preferAheadOrApproaching && !forward && !approaching) {
      score += 400;
    }
    if (
      preference?.preferredSector !== undefined &&
      this.localitySector(portal, playerProjection) !== preference.preferredSector
    ) {
      score += 80;
    }
    const preferInbound = preference?.preferInbound !== false;
    // For a materialized destination route the portal's first tangent is not
    // an arrival oracle; the exact plan may turn inward on its next segment.
    // Retain the legacy tangent preference only for unguided circulation.
    if (
      routePlan === null &&
      ((preferInbound && !inbound) || (!preferInbound && inbound))
    ) {
      score += 200;
    }
    return score;
  }

  /**
   * Queries a spatially-indexed radial portal band. Cell membership only
   * identifies candidates; the deterministic cursor walks stable portal
   * indices and `isTrafficGateSafe` remains the authority for lane/headway
   * safety. Runtime calls are always in the hidden approach annulus.
   */
  private findSafeRuntimeTrafficGate(
    npc: NpcInternal,
    minimumRadiusM: number,
    maximumRadiusM: number,
    initial: boolean,
    ctx: TrafficTickCtx,
    requiredRouteRadiusM = LOCAL_TRAFFIC_FOG_RADIUS_M,
    /** A 10 Hz activation batch projects the current player pose once, then
     * shares that snapshot across all of its bounded candidate checks. */
    playerProjection?: LaneProjection | null,
    /** `activateLocalQueuedNpcs` has already marked this exact annulus. */
    annulusAlreadyMarked = false,
    preference?: LocalTrafficPortalPreference,
    maximumInspections = initial
      ? LOCAL_TRAFFIC_INITIAL_PORTAL_ATTEMPT_BUDGET
      : LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
  ): NormalizedTrafficGate | null {
    const totalInspectionBudget = initial
      ? LOCAL_TRAFFIC_INITIAL_PORTAL_ATTEMPT_BUDGET
      : LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET;
    // Do this before the radial-index query: after this decision's small
    // inspection budget is spent, later queued slots must not repeat an
    // annulus walk merely to discover that no work remains.
    if (
      this.runtimeTrafficGates.length === 0 ||
      this.portalAttemptsThisDecision >= totalInspectionBudget
    ) {
      return null;
    }
    if (!annulusAlreadyMarked) {
      this.runtimePortalIndex.markAnnulus(
        this.playerState.player,
        minimumRadiusM,
        maximumRadiusM,
      );
    }
    const candidateCount = this.runtimePortalIndex.markedCount;
    if (candidateCount === 0) return null;
    // `ctx.roadState.projection` belongs to the last fixed player update, so
    // do not reuse it here. Project once at the current player pose and share
    // that exact value across every bounded portal safety attempt in this
    // activation query.
    const currentPlayerProjection =
      playerProjection === undefined
        ? this.projectPlayerToLocalityRoad()
        : playerProjection;
    const requestedRouteGoal = this.routeGoalForPreference(preference);
    const candidateRouteGoal =
      requestedRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
      minimumRadiusM >= RUNTIME_TRAFFIC_APPROACH_MIN_M
        ? requestedRouteGoal
        : LOCALITY_ROUTE_GOAL_NONE;
    const start = this.portalCursor % candidateCount;
    const inspectionBudget = Math.max(
      0,
      Math.min(
        maximumInspections,
        totalInspectionBudget - this.portalAttemptsThisDecision,
      ),
    );
    let inspected = 0;
    let bestIndex = -1;
    let bestCandidateOffset = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestRoutePlan: LocalityRoutePlan | null = null;
    // Every examined entry consumes the fixed budget. We rank only this small
    // rotating window, then pick its lowest deterministic score; catalogue or
    // map size can never expand a 10 Hz decision's work.
    while (inspected < candidateCount && inspected < inspectionBudget) {
      const candidateOffset = (start + inspected) % candidateCount;
      const index = this.runtimePortalIndex.markedPortalIndexAt(candidateOffset);
      inspected += 1;
      this.portalAttemptsThisDecision += 1;
      this.localityPortalAttempts += 1;
      if (index < 0) continue;
      const portal = this.runtimePortalIndex.portals[index];
      const lane = this.roadNetwork.lanesById.get(portal.laneId);
      const requireRouteConnection =
        preference?.requireRouteConnection ??
        minimumRadiusM >= RUNTIME_TRAFFIC_APPROACH_MIN_M;
      const routeConnected =
        !requireRouteConnection ||
        (candidateRouteGoal !== LOCALITY_ROUTE_GOAL_NONE
          ? this.localityRouteGoalIsReachable(
              candidateRouteGoal,
              lane,
              portal.distance,
            )
          : this.npcRouteCanReachLocalRadius(
              npc,
              lane,
              portal.distance,
              requiredRouteRadiusM,
            ));
      if (!lane || !routeConnected) continue;
      const candidateRoutePlan =
        candidateRouteGoal === LOCALITY_ROUTE_GOAL_NONE
          ? null
          : this.materializeLocalityRoutePlan(
              candidateRouteGoal,
              lane,
              portal.distance,
            );
      if (
        candidateRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        candidateRoutePlan === null
      ) {
        continue;
      }
      if (
        candidateRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH &&
        candidateRoutePlan !== null &&
        !this.localityApproachPlanMeetsPlayerTiming(
          candidateRoutePlan,
          LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS +
            this.localityRoutePlanTravelTimeSeconds(
              lane,
              portal.distance,
              candidateRoutePlan,
            ),
          LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS,
        )
      ) {
        continue;
      }
      if (
        !this.npcRouteCanContinue(
          npc,
          lane,
          portal.distance,
          candidateRouteGoal,
          candidateRoutePlan,
        )
      ) {
        continue;
      }
      if (
        preference?.outerCirculationOnly &&
        !this.npcRouteStaysOuterForCirculation(npc, lane, portal.distance)
      ) {
        continue;
      }
      const perceptualBits = this.portalPerceptualBits(
        npc,
        portal,
        lane,
        currentPlayerProjection,
        preference,
      );
      if (
        !this.portalMeetsHardPreference(
          npc,
          portal,
          lane,
          preference,
          perceptualBits,
        )
      ) {
        continue;
      }
      const gate = this.runtimeTrafficGates[index];
      if (!this.gateFitsLocalOccupancyCaps(npc, gate, currentPlayerProjection)) continue;
      if (!this.isTrafficGateSafe(npc, gate, initial, ctx, currentPlayerProjection)) continue;
      const score = this.portalPreferenceScore(
        portal,
        lane,
        currentPlayerProjection,
        preference,
        perceptualBits,
        candidateRoutePlan,
      );
      if (score >= bestScore) continue;
      bestIndex = index;
      bestCandidateOffset = candidateOffset;
      bestScore = score;
      bestRoutePlan = candidateRoutePlan;
    }
    if (bestIndex >= 0) {
      this.portalCursor = (bestCandidateOffset + 1) % candidateCount;
      this.assignNpcLocalityRoutePlan(npc, bestRoutePlan);
      return this.runtimeTrafficGates[bestIndex];
    }
    this.portalCursor = (start + inspected) % candidateCount;
    return null;
  }

  private refreshLocalityPopulation(ctx: TrafficTickCtx): void {
    const centre = this.playerState.player;
    // Road identity/direction can change across a junction without the player
    // travelling the 8 m used to amortize lane-length target recomputation.
    // Perceptual classification therefore owns a fresh 10 Hz projection.
    this.localityPlayerProjection = this.projectPlayerToLocalityRoad();
    this.refreshLocalityRouteGoalTables();
    const targetAnchorDistanceSquared =
      (centre.x - this.localityTargetAnchorX) ** 2 +
      (centre.z - this.localityTargetAnchorZ) ** 2;
    const targetLaneId = this.localityPlayerProjection?.lane.id ?? "";
    if (
      !Number.isFinite(targetAnchorDistanceSquared) ||
      targetAnchorDistanceSquared >=
        LOCAL_TRAFFIC_TARGET_RECOMPUTE_DISTANCE_M ** 2 ||
      targetLaneId !== this.localityTargetLaneId
    ) {
      const laneLengthWithinFogM = localTrafficLaneLengthM(
        this.roadNetwork.lanes,
        this.trafficCapacityLaneIds,
        centre,
        LOCAL_TRAFFIC_FOG_RADIUS_M,
      );
      const laneLengthWithinInnerM = localTrafficLaneLengthM(
        this.roadNetwork.lanes,
        this.trafficCapacityLaneIds,
        centre,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
      );
      const basePopulation = resolveLocalTrafficTargets(
        laneLengthWithinFogM,
        laneLengthWithinInnerM,
        Boolean(this.config.touchFirst),
      );
      const currentCorridorLaneIds = new Set<string>();
      for (const lane of this.roadNetwork.lanes) {
        if (
          lane.index !== undefined &&
          this.localityCurrentCorridorLaneMask[lane.index] === 1 &&
          this.trafficCapacityLaneIds.has(lane.id)
        ) {
          currentCorridorLaneIds.add(lane.id);
        }
      }
      const corridorLengths = localTrafficCorridorLaneLengthsM(
        this.roadNetwork.lanes,
        currentCorridorLaneIds,
        centre,
        LOCAL_TRAFFIC_FOG_RADIUS_M,
        this.localityPlayerProjection?.heading ?? centre.heading,
      );
      const topologyAwareTargets = resolveTopologyAwareLocalTrafficTargets(
        this.npcsList.length,
        basePopulation,
        Boolean(this.config.touchFirst),
        corridorLengths.current,
        corridorLengths.forward,
        this.localityStreamableCurrentRoadCapacity,
        this.localityStreamableForwardCorridorCapacity,
      );
      this.localityTarget = topologyAwareTargets.population;
      this.localityPerceptualTarget = topologyAwareTargets.perceptual;
      this.localityCorridorContinuityCompensation =
        topologyAwareTargets.corridorShortfall;
      this.localityTargetAnchorX = centre.x;
      this.localityTargetAnchorZ = centre.z;
      this.localityTargetLaneId = targetLaneId;
    }
    let withinFogCount = 0;
    let withinInnerCount = 0;
    let movingWithinInnerCount = 0;
    let currentRoadCorridorCount = 0;
    let forwardCorridorCount = 0;
    let approachingCorridorCount = 0;
    let aheadOrApproachingCount = 0;
    let nearViewCount = 0;
    let movingNearViewCount = 0;
    let sectorForwardCount = 0;
    let sectorRightCount = 0;
    let sectorRearCount = 0;
    let sectorLeftCount = 0;
    let patrolWithinFogCount = 0;
    let patrolWithinInnerCount = 0;
    let balanceSectorForwardCount = 0;
    let balanceSectorRightCount = 0;
    let balanceSectorRearCount = 0;
    let balanceSectorLeftCount = 0;
    let balanceCurrentRoadCorridorCount = 0;
    let approachCount = 0;
    let circulatingCount = 0;
    let inboundApproachCount = 0;
    let inboundPipelineCount = 0;
    let inboundTransitCount = 0;
    let inboundInnerTransitCount = 0;
    let inboundPerceptualTransitCount = 0;
    let inboundImminentPerceptualTransitCount = 0;
    let inboundCurrentRoadTransitCount = 0;
    let inboundForwardTransitCount = 0;
    let pendingRecycleCount = 0;
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      const distance = Math.hypot(npc.x - centre.x, npc.z - centre.z);
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      const onCurrentRoadGeometry = this.isOnCurrentRoadCorridor(
        lane,
        npc.distance,
        npc,
        npc.heading,
        this.localityPlayerProjection,
      );
      const stalledRearCurrentRoadFollower =
        onCurrentRoadGeometry &&
        this.localityLongitudinal(npc, this.localityPlayerProjection) < 0 &&
        this.localityPlayerProjection !== null &&
        Math.cos(
          angleDifference(
            npc.heading,
            this.localityPlayerProjection.heading,
          ),
        ) >= Math.cos((40 * Math.PI) / 180) &&
        npc.speedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS;
      const onCurrentRoad =
        onCurrentRoadGeometry && !stalledRearCurrentRoadFollower;
      const forward =
        onCurrentRoad &&
        this.localityLongitudinal(npc, this.localityPlayerProjection) >= 0;
      const ahead =
        distance <= LOCAL_TRAFFIC_INNER_RADIUS_M && this.isAheadOfPlayer(npc);
      const approaching =
        distance <= LOCAL_TRAFFIC_INNER_RADIUS_M &&
        this.isApproachingCrossTraffic(npc, lane);
      if (distance <= RUNTIME_TRAFFIC_APPROACH_MAX_M) {
        switch (this.localitySector(npc, this.localityPlayerProjection)) {
          case 0:
            balanceSectorForwardCount += 1;
            break;
          case 1:
            balanceSectorRightCount += 1;
            break;
          case 2:
            balanceSectorRearCount += 1;
            break;
          case 3:
            balanceSectorLeftCount += 1;
            break;
        }
        if (onCurrentRoadGeometry) balanceCurrentRoadCorridorCount += 1;
      }
      if (distance <= LOCAL_TRAFFIC_FOG_RADIUS_M) {
        withinFogCount += 1;
        if (npc.patrol) patrolWithinFogCount += 1;
        switch (this.localitySector(npc, this.localityPlayerProjection)) {
          case 0:
            sectorForwardCount += 1;
            break;
          case 1:
            sectorRightCount += 1;
            break;
          case 2:
            sectorRearCount += 1;
            break;
          case 3:
            sectorLeftCount += 1;
            break;
        }
        if (onCurrentRoad) currentRoadCorridorCount += 1;
        if (forward) forwardCorridorCount += 1;
      }
      if (distance <= LOCAL_TRAFFIC_INNER_RADIUS_M) {
        withinInnerCount += 1;
        if (npc.patrol) patrolWithinInnerCount += 1;
        if (npc.speedMps >= LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS) {
          movingWithinInnerCount += 1;
        }
        if (approaching) approachingCorridorCount += 1;
        if (ahead || approaching) aheadOrApproachingCount += 1;
      }
      if (distance <= this.localityNearViewRadiusM()) {
        nearViewCount += 1;
        if (npc.speedMps >= LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS) {
          movingNearViewCount += 1;
        }
      }
      if (
        distance >= RUNTIME_TRAFFIC_CIRCULATION_MIN_M &&
        distance <= RUNTIME_TRAFFIC_APPROACH_MAX_M
      ) {
        circulatingCount += 1;
      }
      if (
        distance >= RUNTIME_TRAFFIC_APPROACH_MIN_M &&
        distance <= RUNTIME_TRAFFIC_APPROACH_MAX_M
      ) {
        const towardPlayerX = centre.x - npc.x;
        const towardPlayerZ = centre.z - npc.z;
        const inbound =
          Math.sin(npc.heading) * towardPlayerX +
            Math.cos(npc.heading) * towardPlayerZ >
          0;
        approachCount += 1;
        if (inbound) inboundApproachCount += 1;
      }

      let commitmentBits = npc.localityCommitmentBits;
      const routePlanValid =
        npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE
          ? true
          : this.npcLocalityRoutePlanIsValid(npc, lane);
      const remainingRouteDistance = routePlanValid
        ? npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE
          ? Math.max(
              0,
              distance -
                ((commitmentBits & LOCALITY_COMMIT_INNER) !== 0
                  ? LOCAL_TRAFFIC_INNER_RADIUS_M
                  : LOCAL_TRAFFIC_FOG_RADIUS_M),
            )
          : this.npcLocalityRoutePlanRemainingDistance(npc, lane)
        : Number.POSITIVE_INFINITY;
      if (
        commitmentBits !== 0 &&
        Number.isFinite(remainingRouteDistance) &&
        remainingRouteDistance <
          npc.localityCommitmentLastRouteDistanceM - 0.25
      ) {
        npc.localityCommitmentLastRouteDistanceM = remainingRouteDistance;
        npc.localityCommitmentExpiresAtSeconds =
          ctx.elapsedSeconds + LOCALITY_COMMITMENT_NO_PROGRESS_SECONDS;
      }
      const commitmentFailed =
        commitmentBits !== 0 &&
        (!routePlanValid ||
          ctx.elapsedSeconds >= npc.localityCommitmentExpiresAtSeconds);
      if (!commitmentFailed) {
        if (distance <= LOCAL_TRAFFIC_FOG_RADIUS_M) {
          commitmentBits &= ~LOCALITY_COMMIT_FOG;
          if (onCurrentRoad) commitmentBits &= ~LOCALITY_COMMIT_CURRENT;
          if (forward) commitmentBits &= ~LOCALITY_COMMIT_FORWARD;
        }
        if (distance <= LOCAL_TRAFFIC_INNER_RADIUS_M) {
          commitmentBits &= ~LOCALITY_COMMIT_INNER;
          if (
            distance <= LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M &&
            (ahead || approaching)
          ) {
            commitmentBits &= ~LOCALITY_COMMIT_AHEAD;
          }
        }
        if ((commitmentBits & LOCALITY_COMMIT_TARGET_MASK) === 0) {
          commitmentBits &= ~LOCALITY_COMMIT_PIPELINE;
        }
        if (commitmentBits === 0) {
          npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
          npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
        }
      }
      const routeGoalSatisfied =
        (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_CURRENT &&
          distance <= LOCAL_TRAFFIC_FOG_RADIUS_M &&
          onCurrentRoad) ||
        (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_FORWARD &&
          distance <= LOCAL_TRAFFIC_FOG_RADIUS_M &&
          forward) ||
        (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH &&
          distance <= LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M &&
          (ahead || approaching));
      const routeGoalExpired =
        npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        ctx.elapsedSeconds >= npc.localityRouteGoalExpiresAtSeconds;
      const routeGoalReachable = routePlanValid;
      if (routeGoalReachable) {
        npc.localityRouteGoalRemainingHops =
          npc.localityRoutePlanLaneIndices.length -
          npc.localityRoutePlanCursor;
      }
      if (
        routeGoalSatisfied ||
        routeGoalExpired ||
        !routeGoalReachable ||
        commitmentFailed ||
        (npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
          commitmentBits === 0)
      ) {
        if (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH) {
          if (routeGoalSatisfied) {
            this.localityApproachGoalContributions += 1;
          } else {
            this.localityApproachGoalFailures += 1;
          }
        }
        npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
        npc.localityRouteGoalRemainingHops = 0;
        npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        commitmentBits = 0;
        npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
        this.assignNpcLocalityRoutePlan(npc, null);
      }
      npc.localityCommitmentBits = commitmentBits;
      if ((commitmentBits & LOCALITY_COMMIT_FOG) !== 0) inboundTransitCount += 1;
      if ((commitmentBits & LOCALITY_COMMIT_INNER) !== 0) {
        inboundInnerTransitCount += 1;
      }
      if ((commitmentBits & LOCALITY_COMMIT_AHEAD) !== 0) {
        inboundPerceptualTransitCount += 1;
        if (
          npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH &&
          this.npcApproachContributionEtaSeconds(npc, lane) <=
            LOCAL_TRAFFIC_IMMINENT_APPROACH_ETA_SECONDS + 1e-9
        ) {
          inboundImminentPerceptualTransitCount += 1;
        }
      }
      if ((commitmentBits & LOCALITY_COMMIT_CURRENT) !== 0) {
        inboundCurrentRoadTransitCount += 1;
      }
      if ((commitmentBits & LOCALITY_COMMIT_FORWARD) !== 0) {
        inboundForwardTransitCount += 1;
      }
      if ((commitmentBits & LOCALITY_COMMIT_PIPELINE) !== 0) {
        inboundPipelineCount += 1;
      }
      if (npc.pendingRecycle) pendingRecycleCount += 1;
    }
    this.localityWithinFogCount = withinFogCount;
    this.localityWithinInnerCount = withinInnerCount;
    this.localityMovingWithinInnerCount = movingWithinInnerCount;
    this.localityCurrentRoadCorridorCount = currentRoadCorridorCount;
    this.localityForwardCorridorCount = forwardCorridorCount;
    this.localityApproachingCorridorCount = approachingCorridorCount;
    this.localityAheadOrApproachingCount = aheadOrApproachingCount;
    this.localityNearViewCount = nearViewCount;
    this.localityMovingNearViewCount = movingNearViewCount;
    this.localitySectorForwardCount = sectorForwardCount;
    this.localitySectorRightCount = sectorRightCount;
    this.localitySectorRearCount = sectorRearCount;
    this.localitySectorLeftCount = sectorLeftCount;
    this.localityPatrolWithinFogCount = patrolWithinFogCount;
    this.localityPatrolWithinInnerCount = patrolWithinInnerCount;
    this.localityBalanceSectorForwardCount = balanceSectorForwardCount;
    this.localityBalanceSectorRightCount = balanceSectorRightCount;
    this.localityBalanceSectorRearCount = balanceSectorRearCount;
    this.localityBalanceSectorLeftCount = balanceSectorLeftCount;
    this.localityBalanceCurrentRoadCorridorCount =
      balanceCurrentRoadCorridorCount;
    this.localityApproachCount = approachCount;
    this.localityCirculatingCount = circulatingCount;
    this.localityInboundApproachCount = inboundApproachCount;
    this.localityInboundPipelineCount = inboundPipelineCount;
    this.localityInboundTransitCount = inboundTransitCount;
    this.localityInboundInnerTransitCount = inboundInnerTransitCount;
    this.localityInboundPerceptualTransitCount =
      inboundPerceptualTransitCount;
    this.localityInboundImminentPerceptualTransitCount =
      inboundImminentPerceptualTransitCount;
    this.localityInboundCurrentRoadTransitCount =
      inboundCurrentRoadTransitCount;
    this.localityInboundForwardTransitCount = inboundForwardTransitCount;
    this.localityPendingRecycleCount = pendingRecycleCount;
    // `ctx` is intentionally accepted to keep every population decision on
    // the same explicit deterministic tick context as its traffic callers.
    void ctx;
  }

  /** Full-reset priming happens before presentation and may use local portals.
   * All later activations use only the hidden 520–680 m approach annulus. */
  private findSafeInitialTrafficGate(
    npc: NpcInternal,
    ctx: TrafficTickCtx,
  ): NormalizedTrafficGate | null {
    // Recount before every admission during fresh priming: named authored
    // starts participate in the same 250/440 m target budget as portals, so
    // a legacy map-wide gate list cannot overfill one inner junction before
    // the locality controller has a chance to act.
    this.refreshLocalityPopulation(ctx);
    const initialAheadJourneyTarget =
      this.localityInitialAheadJourneyTarget();
    // Reserve identities for hidden cross-traffic behind loading. Without
    // this cap a fresh 28/15-car visible fill leaves only patrol-incompatible
    // or no slots for an unpredictable player turn, and a no-pop 570 m
    // activation cannot repair the street within the first minute.
    const initialVisibleFogTarget = Math.max(
      this.localityTarget.withinInner,
      Math.min(
        this.localityTarget.withinFog,
        this.npcsList.length - initialAheadJourneyTarget,
      ),
    );
    // A variant-authored gate represents an intentional initial placement.
    // It retains coordinate, identity, variant, and therefore patrol semantics.
    // Generic slots keep identity/variant while target-aware locality may pick
    // a nearby runtime portal over a remote authored coordinate.
    const preferredAuthoredGate = npc.preferredGateId
      ? this.trafficGatesById.get(npc.preferredGateId)
      : undefined;
    const preferredLane = preferredAuthoredGate
      ? this.roadNetwork.lanesById.get(preferredAuthoredGate.laneId)
      : undefined;
    const preferredGatePose =
      preferredAuthoredGate && preferredLane
        ? this.roadNetwork.pointOnLane(preferredLane, preferredAuthoredGate.distance)
        : undefined;
    const preferredGateIsLocal = preferredGatePose
      ? distanceSquared(preferredGatePose, this.playerState.player) <=
        LOCAL_TRAFFIC_FOG_RADIUS_M * LOCAL_TRAFFIC_FOG_RADIUS_M
      : false;
    const preferredGateIsInner = preferredGatePose
      ? distanceSquared(preferredGatePose, this.playerState.player) <=
        LOCAL_TRAFFIC_INNER_RADIUS_M * LOCAL_TRAFFIC_INNER_RADIUS_M
      : false;
    const preferredGateFitsLocalTarget =
      preferredGateIsLocal &&
      this.localityWithinFogCount < initialVisibleFogTarget &&
      (!preferredGateIsInner ||
        this.localityWithinInnerCount < this.localityTarget.withinInner);
    const needsMovingInner =
      this.localityMovingWithinInnerCount <
      this.localityPerceptualTarget.movingWithinInner;
    const needsCurrentRoad =
      this.localityCurrentRoadCorridorCount <
      this.localityPerceptualTarget.currentRoadCorridor;
    const needsForward =
      this.localityForwardCorridorCount <
      this.localityPerceptualTarget.forwardCorridor;
    const needsAheadOrApproaching =
      this.localityAheadOrApproachingCount <
      this.localityPerceptualTarget.aheadOrApproaching;
    const preferredOnCurrentRoad =
      preferredLane !== undefined &&
      preferredGatePose !== undefined &&
      this.isOnCurrentRoadGeometry(
        preferredLane,
        preferredGatePose,
        preferredGatePose.heading,
        this.localityPlayerProjection,
      );
    const preferredSameDirectionRear =
      preferredOnCurrentRoad &&
      preferredGatePose !== undefined &&
      this.localityPlayerProjection !== null &&
      Math.cos(
        angleDifference(
          preferredGatePose.heading,
          this.localityPlayerProjection.heading,
        ),
      ) >= Math.cos((40 * Math.PI) / 180) &&
      this.localityLongitudinal(
        preferredGatePose,
        this.localityPlayerProjection,
      ) < 0;
    const preferredForward =
      preferredOnCurrentRoad &&
      !preferredSameDirectionRear &&
      preferredGatePose !== undefined &&
      this.localityLongitudinal(
        preferredGatePose,
        this.localityPlayerProjection,
      ) >= 0;
    const preferredAhead =
      preferredGateIsInner &&
      preferredGatePose !== undefined &&
      this.isAheadOfPlayer(preferredGatePose);
    const preferredFitsDistribution = needsForward
      ? preferredForward
      : needsCurrentRoad
        ? preferredOnCurrentRoad && !preferredSameDirectionRear
        : needsAheadOrApproaching
          ? preferredAhead
          : true;
    if (
      preferredAuthoredGate &&
      preferredAuthoredGate.variant !== undefined &&
      preferredAuthoredGate.allowInitialSpawn &&
      preferredGateFitsLocalTarget &&
      preferredFitsDistribution &&
      this.gateFitsLocalOccupancyCaps(
        npc,
        preferredAuthoredGate,
        this.localityPlayerProjection,
      ) &&
      this.isTrafficGateSafe(npc, preferredAuthoredGate, true, ctx)
    ) {
      return preferredAuthoredGate;
    }
    const hasInnerPrimingHeadroom =
      this.localityWithinInnerCount + this.localityInboundInnerTransitCount <
      this.localityTarget.withinInner;
    const mayPrimeAheadOrApproaching =
      needsAheadOrApproaching && hasInnerPrimingHeadroom;
    const mayPrimePerceptualDistribution =
      (needsCurrentRoad || needsForward || mayPrimeAheadOrApproaching) &&
      this.localityWithinFogCount <
        initialVisibleFogTarget +
          LOCAL_TRAFFIC_PERCEPTUAL_RADIAL_OVERSHOOT_CAP;
    const mayPrimeMovingInner =
      needsMovingInner &&
      this.localityWithinFogCount <
        initialVisibleFogTarget +
          LOCAL_TRAFFIC_PERCEPTUAL_RADIAL_OVERSHOOT_CAP &&
      this.localityWithinInnerCount + this.localityInboundInnerTransitCount <
        this.localityTarget.withinInner;
    const requireForwardPrime =
      mayPrimePerceptualDistribution && needsForward;
    const requireCurrentPrime =
      mayPrimePerceptualDistribution &&
      !requireForwardPrime &&
      needsCurrentRoad;
    const requireAheadPrime =
      mayPrimePerceptualDistribution &&
      !requireForwardPrime &&
      !requireCurrentPrime &&
      mayPrimeAheadOrApproaching;
    const keepPerceptualPrimeOutsideInner =
      !hasInnerPrimingHeadroom && !mayPrimeMovingInner;
    const preference: LocalTrafficPortalPreference = {
      preferCurrentRoadCorridor: needsCurrentRoad || needsForward,
      preferForwardCorridor: needsForward,
      preferAheadOrApproaching: needsAheadOrApproaching,
      requireCurrentRoadCorridor: requireCurrentPrime,
      requireForwardCorridor: requireForwardPrime,
      requireAheadOrApproaching: requireAheadPrime,
      preferredSector: this.leastPopulatedLocalitySector(),
      outerLocalOnly: keepPerceptualPrimeOutsideInner,
    };

    // Satisfy the visible road before spending generic identities on arbitrary
    // local authored coordinates. A moving-inner shortfall narrows the query;
    // otherwise the full fog circle may contribute a current-road vehicle.
    if (mayPrimePerceptualDistribution || mayPrimeMovingInner) {
      const perceptual = this.findSafeRuntimeTrafficGate(
        npc,
        keepPerceptualPrimeOutsideInner
          ? LOCAL_TRAFFIC_INNER_RADIUS_M
          : 0,
        mayPrimeMovingInner || mayPrimeAheadOrApproaching
          ? LOCAL_TRAFFIC_INNER_RADIUS_M
          : LOCAL_TRAFFIC_FOG_RADIUS_M,
        true,
        ctx,
        LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M,
        this.localityPlayerProjection,
        false,
        preference,
        Math.floor(LOCAL_TRAFFIC_INITIAL_PORTAL_ATTEMPT_BUDGET / 2),
      );
      if (perceptual) return perceptual;
    }

    if (
      preferredAuthoredGate &&
      preferredAuthoredGate.variant === undefined &&
      preferredAuthoredGate.allowInitialSpawn &&
      preferredGateFitsLocalTarget &&
      (!preferredGateIsInner ||
        (preferredGatePose !== undefined &&
          this.isAheadOfPlayer(preferredGatePose))) &&
      (!preferredGateIsLocal ||
        preferredGateIsInner ||
        this.localityWithinInnerCount < this.localityTarget.withinInner ||
        !this.npcRouteCanReachLocalRadius(
          npc,
          preferredLane,
          preferredAuthoredGate.distance,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
        )) &&
      this.gateFitsLocalOccupancyCaps(
        npc,
        preferredAuthoredGate,
        this.localityPlayerProjection,
      ) &&
      this.isTrafficGateSafe(npc, preferredAuthoredGate, true, ctx)
    ) {
      return preferredAuthoredGate;
    }

    if (this.localityWithinInnerCount < this.localityTarget.withinInner) {
      const inner = this.findSafeRuntimeTrafficGate(
        npc,
        0,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
        true,
        ctx,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
        this.localityPlayerProjection,
        false,
        {
          preferAheadOrApproaching: true,
          requireAheadOrApproaching: true,
          preferredSector: this.leastPopulatedLocalitySector(),
        },
      );
      if (inner) return inner;
    }
    if (this.localityWithinFogCount < initialVisibleFogTarget) {
      const local = this.findSafeRuntimeTrafficGate(
        npc,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
        LOCAL_TRAFFIC_FOG_RADIUS_M,
        true,
        ctx,
        LOCAL_TRAFFIC_FOG_RADIUS_M,
        this.localityPlayerProjection,
        false,
        {
          preferredSector: this.leastPopulatedLocalitySector(),
          outerLocalOnly: true,
        },
      );
      if (local) return local;
    }

    // Keep a meaningful share of the fixed pool moving in a hidden approach
    // ring. Unlike a blind map-wide count increase, this costs no extra slot or
    // rendered identity and continuously feeds the player's neighbourhood.
    const neededInboundApproach = Math.max(
      0,
      initialVisibleFogTarget - this.localityWithinFogCount,
      this.localityTarget.withinInner - this.localityWithinInnerCount,
      this.localityPerceptualTarget.circulatingApproach -
        this.localityApproachCount,
      initialAheadJourneyTarget -
        this.localityInboundPerceptualTransitCount,
    );
    if (neededInboundApproach <= 0) return null;
    const patrolMayFeedLocal =
      !npc.patrol ||
      (this.localityPatrolWithinFogCount < this.patrolFogCap() &&
        this.localityPatrolWithinInnerCount < LOCAL_TRAFFIC_PATROL_INNER_CAP);
    const needsProactivePipeline =
      patrolMayFeedLocal &&
      (this.localityInboundPerceptualTransitCount <
        initialAheadJourneyTarget ||
        (this.localityInboundPipelineCount <
          LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET &&
          this.localityWithinFogCount + this.localityInboundTransitCount <
            initialVisibleFogTarget +
              LOCAL_TRAFFIC_PERCEPTUAL_RADIAL_OVERSHOOT_CAP));
    const needsLocalSupply =
      patrolMayFeedLocal &&
      (this.localityWithinFogCount + this.localityInboundTransitCount <
        initialVisibleFogTarget ||
        this.localityWithinInnerCount + this.localityInboundInnerTransitCount <
          this.localityTarget.withinInner ||
        mayPrimePerceptualDistribution ||
        needsProactivePipeline);
    const needsInnerSupply =
      this.localityWithinInnerCount + this.localityInboundInnerTransitCount <
        this.localityTarget.withinInner;
    const needsOuterOnlySupply =
      needsLocalSupply && !needsInnerSupply && !mayPrimePerceptualDistribution;
    const initialAheadPipelineMissing =
      this.localityInboundPerceptualTransitCount <
      initialAheadJourneyTarget;
    const requireForwardApproach =
      needsLocalSupply &&
      !initialAheadPipelineMissing &&
      mayPrimePerceptualDistribution &&
      needsForward;
    const requireCurrentApproach =
      needsLocalSupply &&
      !initialAheadPipelineMissing &&
      mayPrimePerceptualDistribution &&
      !requireForwardApproach &&
      needsCurrentRoad;
    const requireAheadApproach =
      needsLocalSupply &&
      !requireForwardApproach &&
      !requireCurrentApproach &&
      ((mayPrimePerceptualDistribution && needsAheadOrApproaching) ||
        initialAheadPipelineMissing ||
        needsProactivePipeline);
    const approachPreference: LocalTrafficPortalPreference = {
      preferCurrentRoadCorridor:
        needsLocalSupply && (needsCurrentRoad || needsForward),
      preferForwardCorridor: needsLocalSupply && needsForward,
      preferAheadOrApproaching:
        needsLocalSupply && needsAheadOrApproaching,
      requireCurrentRoadCorridor: requireCurrentApproach,
      requireForwardCorridor: requireForwardApproach,
      requireAheadOrApproaching: requireAheadApproach,
      preferredSector: this.leastPopulatedLocalitySector(),
      requireRouteConnection: needsLocalSupply,
      preferInbound: needsLocalSupply,
      outerCirculationOnly: !needsLocalSupply,
      outerLocalOnly: needsOuterOnlySupply,
      proactivePipeline: needsProactivePipeline,
    };
    // Locality deliberately leaves an unavailable slot queued instead of
    // falling back to a random authored gate kilometres away. The local and
    // hidden approach bands are the complete fresh-core population window;
    // named authored variants were handled above.
    const requiredRouteRadiusM =
      needsAheadOrApproaching ||
      needsProactivePipeline ||
      this.localityWithinInnerCount < this.localityTarget.withinInner
        ? LOCAL_TRAFFIC_INNER_RADIUS_M
        : LOCAL_TRAFFIC_FOG_RADIUS_M;
    const approachGate = this.findSafeRuntimeTrafficGate(
      npc,
      RUNTIME_TRAFFIC_APPROACH_MIN_M,
      RUNTIME_TRAFFIC_APPROACH_MAX_M,
      true,
      ctx,
      requiredRouteRadiusM,
      this.localityPlayerProjection,
      false,
      approachPreference,
    );
    if (approachGate) {
      const committed = this.commitNpcLocalityFeed(
        npc,
        ctx,
        requiredRouteRadiusM,
        approachPreference,
        approachGate,
      );
      if (!committed) return null;
    }
    return approachGate;
  }

  private isTrafficGateSafe(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    initial: boolean,
    ctx: TrafficTickCtx,
    playerProjection = this.projectPlayerToLocalityRoad(),
  ): boolean {
    const lane = this.roadNetwork.lanesById.get(gate.laneId);
    if (!lane) return false;
    const pose = this.roadNetwork.pointOnLane(lane, gate.distance);
    const desiredSpeedMps = gate.desiredSpeedMps ?? npc.desiredSpeedMps;
    const playerDistanceM = Math.sqrt(distanceSquared(pose, this.playerState.player));
    if (playerDistanceM < INITIAL_CROSS_LANE_CLEARANCE_M) return false;
    if (!initial && playerDistanceM < this.config.minRuntimeSpawnDistanceM) return false;
    if (!initial && this.isInsidePlayerVisibilityEnvelope(pose, ctx)) return false;

    if (playerProjection?.lane.id === lane.id && playerProjection.distance < lane.width) {
      const aheadOfPlayer = this.roadNetwork.distanceAhead(
        lane,
        playerProjection.distanceAlong,
        gate.distance,
      );
      const behindPlayer = this.roadNetwork.distanceAhead(
        lane,
        gate.distance,
        playerProjection.distanceAlong,
      );
      const requiredBehind = Math.max(30, desiredSpeedMps * 3 + 6);
      if (
        aheadOfPlayer < INITIAL_PLAYER_CLEARANCE_AHEAD_M ||
        behindPlayer < requiredBehind
      ) {
        return false;
      }
    }

    const predictedPose = this.roadNetwork.pointOnLane(
      lane,
      Math.min(lane.length, gate.distance + desiredSpeedMps * SPAWN_PREDICTION_SECONDS),
    );
    const predictedClearance =
      this.config.playerRadiusM + NPC_RADIUS_METRES + 1.5;
    if (
      distanceToSegmentSquared(
        this.playerState.player.x,
        this.playerState.player.z,
        pose.x,
        pose.z,
        predictedPose.x,
        predictedPose.z,
      ) < predictedClearance * predictedClearance
    ) {
      return false;
    }

    const requiredHeadway = Math.max(10, desiredSpeedMps * 1.8 + 4);
    for (const other of this.npcsList) {
      if (!other.active || other.id === npc.id) continue;
      const otherLane = this.roadNetwork.lanesById.get(other.laneId);
      if (!otherLane) continue;
      const forward = this.roadNetwork.routeDistanceAhead(
        lane,
        gate.distance,
        otherLane,
        other.distance,
      );
      const backward = this.roadNetwork.routeDistanceAhead(
        otherLane,
        other.distance,
        lane,
        gate.distance,
      );
      if (forward < requiredHeadway || backward < requiredHeadway) return false;
      if (other.laneId !== lane.id) {
        const parallelSameRoad =
          lane.roadId !== undefined &&
          lane.roadId === otherLane.roadId &&
          Math.abs(Math.cos(angleDifference(pose.heading, other.heading))) >=
            Math.cos((40 * Math.PI) / 180);
        // Twelve metres is a conservative conflict-junction spawn envelope,
        // but applying it across legal parallel/opposing carriageways removes
        // one entire direction at every portal station. Same-road aligned
        // lanes need only non-overlapping simulation discs. Their centreline
        // spacing is authored to carry side-by-side traffic; treating the
        // rendered longitudinal body length as lateral width wrongly removes
        // the entire opposing direction on London/Tokyo streets.
        const crossLaneClearance = parallelSameRoad
          ? NPC_RADIUS_METRES * 2
          : 12;
        if (
          distanceSquared(other, pose) <
          crossLaneClearance * crossLaneClearance
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private isInsidePlayerVisibilityEnvelope(point: SimulationPoint, ctx: TrafficTickCtx): boolean {
    const dx = point.x - this.playerState.player.x;
    const dz = point.z - this.playerState.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= Number.EPSILON) return true;
    const bearing = Math.atan2(dx, dz);
    const forwardAngle = Math.abs(angleDifference(bearing, ctx.viewHeading));
    if (
      distance <= RUNTIME_FORWARD_VISIBILITY_DISTANCE_M &&
      forwardAngle <= RUNTIME_FORWARD_HALF_ANGLE_RAD
    ) {
      return true;
    }
    const rearAngle = Math.abs(
      angleDifference(bearing, wrapAngle(this.playerState.player.heading + Math.PI)),
    );
    return (
      distance <= RUNTIME_REAR_VISIBILITY_DISTANCE_M &&
      rearAngle <= RUNTIME_REAR_HALF_ANGLE_RAD
    );
  }

  private activateNpcAtGate(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    ctx: TrafficTickCtx,
    initial = false,
  ): void {
    const lane = this.roadNetwork.lanesById.get(gate.laneId);
    if (!lane) return;
    const pose = this.roadNetwork.pointOnLane(lane, gate.distance);
    this.invalidateLocalityAdmissionRouteTables();
    npc.active = true;
    npc.pendingRecycle = false;
    npc.pendingRecycleMinimumDistanceM = RUNTIME_TRAFFIC_RECYCLE_RADIUS_M;
    npc.preferredGateId = gate.id;
    npc.laneId = lane.id;
    npc.distance = gate.distance;
    // Same rule as a lane change: a driver with a style reads the new road's
    // limit through it. Only a car whose speed was never a style — a scripted
    // gate speed — falls back to carrying its old figure under a clamp.
    npc.desiredSpeedMps =
      gate.desiredSpeedMps ??
      (npc.speedFactor !== undefined
        ? lane.speedLimitMps * npc.speedFactor
        : clamp(npc.desiredSpeedMps, 1, lane.speedLimitMps * 1.05));
    npc.speedMps = npc.desiredSpeedMps * 0.55;
    npc.targetSpeedMps = npc.desiredSpeedMps;
    npc.state = lane.kind === "roundabout" ? "roundabout" : "cruising";
    npc.signal = "off";
    npc.targetLaneId = undefined;
    npc.cornerFromLaneId = undefined;
    npc.successorReservationFromLaneId = undefined;
    npc.successorReservationLaneId = undefined;
    npc.laneChangeProgress = 0;
    npc.signalSeconds = 0;
    npc.stoppedSeconds = 0;
    npc.jamSeconds = 0;
    npc.incidentLeanRad = 0;
    // A gate can sit inside the corner-arc window of its lane's end; posing
    // the spawn through the same overlay keeps the first moved tick from
    // reading as a sideways teleport onto the arc.
    const displayPose = this.npcCornerPose(npc, lane, pose);
    npc.x = displayPose.x;
    npc.z = displayPose.z;
    npc.heading = displayPose.heading;
    npc.previousX = displayPose.x;
    npc.previousZ = displayPose.z;
    npc.activatedAtSeconds = initial ? Number.NEGATIVE_INFINITY : ctx.elapsedSeconds;
    npc.runtimeActivationEligibleTick = 0;
    if (gate.runtime && !initial) {
      this.localityActivations += 1;
      this.localityDecisionActivations += 1;
    }
    if (npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE) {
      npc.localityRouteGoalRemainingHops =
        npc.localityRoutePlanLaneIndices.length -
        npc.localityRoutePlanCursor;
      if (!this.npcLocalityRoutePlanIsValid(npc, lane)) {
        npc.localityCommitmentBits = 0;
        npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
        npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
        npc.localityRouteGoalRemainingHops = 0;
        npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        this.assignNpcLocalityRoutePlan(npc, null);
      }
    }
    this.syncNpcSpatialIndex(npc);
  }

  /** The index stores positions only by stable slot. Keeping this beside the
   * lifecycle owner makes activation, recovery, and sequential movement all
   * update the same representation without exposing it outside traffic. */
  private syncNpcSpatialIndex(npc: NpcInternal): void {
    if (!npc.active) {
      this.trafficSpatialIndex.remove(npc.slotIndex);
      return;
    }
    const lane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!lane || lane.index === undefined) {
      this.trafficSpatialIndex.remove(npc.slotIndex);
      return;
    }
    this.trafficSpatialIndex.upsert(npc.slotIndex, lane.index, npc.x, npc.z);
  }

  /** Read-only cumulative counters for the outer simulation/debug seam. The
   * hot path only increments scalars; this snapshot allocates only when read. */
  getSpatialIndexDiagnostics(): TrafficSpatialIndexDiagnostics {
    return {
      leadCandidateCount: this.leadCandidateCount,
      leadExactRouteCheckCount: this.leadExactRouteCheckCount,
    };
  }

  /** Population-window diagnostics for external profiling. The counters are
   * scalar writes in decision passes; this object is made only for a debug
   * caller. */
  getLocalityDiagnostics(): TrafficLocalityDiagnostics {
    let activeCount = 0;
    let liveApproachGoalCount = 0;
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      activeCount += 1;
      if (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH) {
        liveApproachGoalCount += 1;
      }
    }
    let acceptedEtaCount = 0;
    for (const count of this.localityLocalHandoffEtaHistogram) {
      acceptedEtaCount += count;
    }
    let localHandoffAcceptedEtaP50Seconds = 0;
    if (acceptedEtaCount > 0) {
      const medianRank = Math.ceil(acceptedEtaCount / 2);
      let cumulative = 0;
      for (
        let seconds = 0;
        seconds < this.localityLocalHandoffEtaHistogram.length;
        seconds += 1
      ) {
        cumulative += this.localityLocalHandoffEtaHistogram[seconds];
        if (cumulative < medianRank) continue;
        localHandoffAcceptedEtaP50Seconds = seconds;
        break;
      }
    }
    return {
      enabled: this.localityEnabled,
      poolCount: this.npcsList.length,
      activeCount,
      queuedCount: this.npcsList.length - activeCount,
      withinFogCount: this.localityWithinFogCount,
      withinInnerCount: this.localityWithinInnerCount,
      movingWithinInnerCount: this.localityMovingWithinInnerCount,
      currentRoadCorridorCount: this.localityCurrentRoadCorridorCount,
      forwardCorridorCount: this.localityForwardCorridorCount,
      approachingCorridorCount: this.localityApproachingCorridorCount,
      aheadOrApproachingCount: this.localityAheadOrApproachingCount,
      nearViewCount: this.localityNearViewCount,
      movingNearViewCount: this.localityMovingNearViewCount,
      sectorForwardCount: this.localitySectorForwardCount,
      sectorRightCount: this.localitySectorRightCount,
      sectorRearCount: this.localitySectorRearCount,
      sectorLeftCount: this.localitySectorLeftCount,
      patrolWithinFogCount: this.localityPatrolWithinFogCount,
      patrolWithinInnerCount: this.localityPatrolWithinInnerCount,
      patrolFogCap: this.patrolFogCap(),
      patrolInnerCap: LOCAL_TRAFFIC_PATROL_INNER_CAP,
      ghostGap: this.localityAheadOrApproachingCount === 0,
      ghostGapDecisionCount: this.localityGhostGapDecisionCount,
      approachCount: this.localityApproachCount,
      circulatingCount: this.localityCirculatingCount,
      inboundApproachCount: this.localityInboundApproachCount,
      inboundTransitCount: this.localityInboundTransitCount,
      inboundInnerTransitCount: this.localityInboundInnerTransitCount,
      inboundPerceptualTransitCount:
        this.localityInboundPerceptualTransitCount,
      inboundImminentPerceptualTransitCount:
        this.localityInboundImminentPerceptualTransitCount,
      inboundCurrentRoadTransitCount:
        this.localityInboundCurrentRoadTransitCount,
      inboundForwardTransitCount: this.localityInboundForwardTransitCount,
      pendingRecycleCount: this.localityPendingRecycleCount,
      targetWithinFog: this.localityTarget.withinFog,
      targetWithinInner: this.localityTarget.withinInner,
      targetMovingWithinInner: this.localityPerceptualTarget.movingWithinInner,
      targetCurrentRoadCorridor:
        this.localityPerceptualTarget.currentRoadCorridor,
      targetForwardCorridor: this.localityPerceptualTarget.forwardCorridor,
      targetAheadOrApproaching:
        this.localityPerceptualTarget.aheadOrApproaching,
      targetNearView: this.localityNearViewTarget(),
      targetMovingNearView: this.localityMovingNearViewTarget(),
      targetAheadJourneyCount: this.localityTargetAheadJourneyCount,
      approachRouteFeedAvailable: this.localityApproachRouteFeedAvailable,
      localHandoffCount: this.localityLocalHandoffs,
      liveApproachGoalCount,
      localHandoffAttemptCount: this.localityLocalHandoffAttempts,
      localHandoffCadenceBlockedCount:
        this.localityLocalHandoffCadenceBlocks,
      localHandoffNoCandidateCount: this.localityLocalHandoffNoCandidates,
      localHandoffRoleOrIncidentBlockedCount:
        this.localityLocalHandoffRoleOrIncidentBlocks,
      localHandoffUnreachableCount: this.localityLocalHandoffUnreachable,
      localHandoffTargetCapacityBlockedCount:
        this.localityLocalHandoffTargetCapacityBlocks,
      localHandoffEtaBlockedCount: this.localityLocalHandoffEtaBlocks,
      localHandoffAcceptedEtaP50Seconds,
      approachGoalContributionCount:
        this.localityApproachGoalContributions,
      approachGoalFailureCount: this.localityApproachGoalFailures,
      approachGoalRecenterReleaseCount:
        this.localityApproachGoalRecenterReleases,
      targetCirculatingApproach:
        this.localityPerceptualTarget.circulatingApproach,
      targetCorridorContinuityCompensation:
        this.localityCorridorContinuityCompensation,
      streamableCurrentRoadCapacity:
        this.localityStreamableCurrentRoadCapacity,
      streamableForwardCorridorCapacity:
        this.localityStreamableForwardCorridorCapacity,
      portalAttempts: this.localityPortalAttempts,
      lastDecisionPortalAttempts: this.portalAttemptsThisDecision,
      lastDecisionActivations: this.localityDecisionActivations,
      lastDecisionRetirements: this.localityDecisionRetirements,
      activations: this.localityActivations,
      retirements: this.localityRetirements,
    };
  }

  private activateQueuedNpcs(ctx: TrafficTickCtx): void {
    for (const npc of this.npcsList) {
      if (npc.active) continue;
      const gate = this.findSafeTrafficGate(npc, false, ctx);
      if (gate) this.activateNpcAtGate(npc, gate, ctx);
    }
  }

  /**
   * A recycle is a lifecycle request, not an immediate visual deletion. The
   * slot keeps its id, appearance, patrol role, and full simulation behaviour
   * until it is outside the conservative hidden envelope. Ordinary population
   * shedding still waits for its farther recycle radius; the non-local legacy
   * path retains its established immediate gate queue behaviour.
   */
  requestNpcRecycle(npc: NpcInternal, ctx: TrafficTickCtx): void {
    if (!npc.active) return;
    if (!this.localityEnabled) {
      this.deactivateNpc(npc);
      return;
    }
    // Exceptional recovery may ask at 60 Hz, but it never deletes a visible
    // vehicle immediately. The bounded 10 Hz population pass owns every
    // actual retirement so a burst of route failures cannot create a frame
    // spike or a visible sequence of disappearing cars.
    npc.localityCommitmentBits = 0;
    npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
    npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
    npc.localityRouteGoalRemainingHops = 0;
    npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    this.assignNpcLocalityRoutePlan(npc, null);
    npc.pendingRecycle = true;
    npc.pendingRecycleMinimumDistanceM = RUNTIME_TRAFFIC_EXCEPTION_RECYCLE_RADIUS_M;
    void ctx;
  }

  /** Retires at most the remaining decision budget of already-pending cars. */
  private settlePendingRecycles(ctx: TrafficTickCtx): number {
    let retirements = 0;
    for (const npc of this.npcsList) {
      if (retirements >= LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET) break;
      if (!npc.active || !npc.pendingRecycle) continue;
      const dx = npc.x - this.playerState.player.x;
      const dz = npc.z - this.playerState.player.z;
      if (
        dx * dx + dz * dz <=
          npc.pendingRecycleMinimumDistanceM * npc.pendingRecycleMinimumDistanceM ||
        this.isInsidePlayerVisibilityEnvelope(npc, ctx)
      ) {
        continue;
      }
      this.deactivateNpcForLocality(npc, ctx);
      this.localityRetirements += 1;
      this.localityDecisionRetirements += 1;
      retirements += 1;
    }
    void ctx;
    return retirements;
  }

  private commitNpcLocalityFeed(
    npc: NpcInternal,
    ctx: TrafficTickCtx,
    requiredRouteRadiusM: number,
    preference: LocalTrafficPortalPreference | undefined,
    /** Initial hidden priming selects and materializes before activation. Use
     * that selected origin rather than the slot's stale pre-reset lane. */
    originGate?: Pick<NormalizedTrafficGate, "laneId" | "distance">,
  ): boolean {
    if (preference?.outerCirculationOnly) return true;
    let bits = LOCALITY_COMMIT_FOG;
    if (requiredRouteRadiusM <= LOCAL_TRAFFIC_INNER_RADIUS_M) {
      bits |= LOCALITY_COMMIT_INNER;
    }
    if (preference?.requireCurrentRoadCorridor) {
      bits |= LOCALITY_COMMIT_CURRENT;
    }
    if (preference?.requireForwardCorridor) {
      bits |= LOCALITY_COMMIT_CURRENT | LOCALITY_COMMIT_FORWARD;
    }
    if (preference?.requireAheadOrApproaching) {
      bits |= LOCALITY_COMMIT_INNER | LOCALITY_COMMIT_AHEAD;
    }
    if (preference?.proactivePipeline) bits |= LOCALITY_COMMIT_PIPELINE;
    npc.localityCommitmentBits = bits;
    npc.localityRouteGoal = this.routeGoalForPreference(preference);
    const lane = this.roadNetwork.lanesById.get(
      originGate?.laneId ?? npc.laneId,
    );
    const originDistance = originGate?.distance ?? npc.distance;
    if (
      npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
      npc.localityRoutePlanTargetLaneIndex < 0
    ) {
      this.assignNpcLocalityRoutePlan(
        npc,
        this.materializeLocalityRoutePlan(
          npc.localityRouteGoal,
          lane,
          originDistance,
        ),
      );
    }
    if (
      npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
      npc.localityRoutePlanTargetLaneIndex < 0
    ) {
      npc.localityCommitmentBits = 0;
      npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
      npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
      npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
      npc.localityRouteGoalRemainingHops = 0;
      npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
      this.assignNpcLocalityRoutePlan(npc, null);
      return false;
    }
    npc.localityRouteGoalRemainingHops =
      npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE
        ? 0
        : npc.localityRoutePlanLaneIndices.length -
          npc.localityRoutePlanCursor;
    if (!Number.isFinite(npc.localityRouteGoalRemainingHops)) {
      npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
      npc.localityRouteGoalRemainingHops = 0;
    }
    npc.localityRouteGoalExpiresAtSeconds =
      npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE
        ? Number.NEGATIVE_INFINITY
        : ctx.elapsedSeconds + LOCALITY_ROUTE_GOAL_TIMEOUT_SECONDS;
    const remainingRouteDistance = originGate
      ? npc.localityCommitmentLastRouteDistanceM
      : this.npcLocalityRoutePlanRemainingDistance(npc, lane);
    npc.localityCommitmentLastRouteDistanceM = remainingRouteDistance;
    npc.localityCommitmentExpiresAtSeconds =
      ctx.elapsedSeconds + LOCALITY_COMMITMENT_NO_PROGRESS_SECONDS;
    if (npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_APPROACH) {
      this.localityNextAheadFeedAdmissionSeconds =
        ctx.elapsedSeconds +
        LOCAL_TRAFFIC_AHEAD_FEED_ADMISSION_CADENCE_SECONDS;
    }
    return true;
  }

  private discardPreparedLocalityActivation(npc: NpcInternal): void {
    npc.preparedLocalityGateId = undefined;
    npc.localityCommitmentBits = 0;
    npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
    npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
    npc.localityRouteGoalRemainingHops = 0;
    npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
    this.assignNpcLocalityRoutePlan(npc, null);
  }

  /** Consume a gate/plan proved before a full-pool retirement. The one-tick
   * inactive lifecycle is already complete; a changed target generation or
   * newly occupied portal invalidates the preparation instead of spawning an
   * uncredited car or retaining a stale queued reservation. */
  private activatePreparedLocalityNpc(
    npc: NpcInternal,
    ctx: TrafficTickCtx,
    playerProjection: LaneProjection | null,
  ): boolean {
    const gate = npc.preparedLocalityGateId
      ? this.runtimeTrafficGatesById.get(npc.preparedLocalityGateId)
      : undefined;
    if (!gate) {
      if (npc.preparedLocalityGateId) {
        this.discardPreparedLocalityActivation(npc);
      }
      return false;
    }
    const patrolCapReached =
      npc.patrol &&
      (this.localityPatrolWithinFogCount >= this.patrolFogCap() ||
        ((npc.localityCommitmentBits & LOCALITY_COMMIT_INNER) !== 0 &&
          this.localityPatrolWithinInnerCount >=
            LOCAL_TRAFFIC_PATROL_INNER_CAP));
    const routePlanReady =
      npc.localityRouteGoal === LOCALITY_ROUTE_GOAL_NONE ||
      (npc.localityRoutePlanGeneration === this.localityRouteGoalGeneration &&
        npc.localityRoutePlanTargetLaneIndex >= 0);
    if (
      patrolCapReached ||
      !routePlanReady ||
      !this.gateFitsLocalOccupancyCaps(npc, gate, playerProjection) ||
      !this.isTrafficGateSafe(npc, gate, false, ctx, playerProjection)
    ) {
      this.discardPreparedLocalityActivation(npc);
      return false;
    }
    npc.preparedLocalityGateId = undefined;
    this.activateNpcAtGate(npc, gate, ctx);
    return npc.active;
  }

  private activateLocalQueuedNpcs(
    ctx: TrafficTickCtx,
    maximumActivations = LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
    requiredRouteRadiusM = LOCAL_TRAFFIC_FOG_RADIUS_M,
    preference?: LocalTrafficPortalPreference,
    portalAttemptCeiling = LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
  ): number {
    // The player pose is unchanged throughout one 10 Hz decision. Mark the
    // fixed hidden annulus and project it once, so a blocked pool cannot turn
    // a two-car activation budget into one expensive spatial query per slot.
    if (this.portalAttemptsThisDecision >= portalAttemptCeiling) return 0;
    this.runtimePortalIndex.markAnnulus(
      this.playerState.player,
      RUNTIME_TRAFFIC_APPROACH_MIN_M,
      RUNTIME_TRAFFIC_APPROACH_MAX_M,
    );
    if (this.runtimePortalIndex.markedCount === 0) return 0;
    const playerProjection = this.projectPlayerToLocalityRoad();
    let activations = 0;
    for (const npc of this.npcsList) {
      if (activations >= maximumActivations) break;
      if (this.portalAttemptsThisDecision >= portalAttemptCeiling) break;
      if (npc.active) continue;
      if (npc.runtimeActivationEligibleTick >= ctx.tick) continue;
      if (
        npc.preparedLocalityGateId &&
        this.activatePreparedLocalityNpc(npc, ctx, playerProjection)
      ) {
        activations += 1;
        this.refreshLocalityPopulation(ctx);
        continue;
      }
      if (
        preference?.requireRouteConnection !== false &&
        npc.patrol &&
        (this.localityPatrolWithinFogCount >= this.patrolFogCap() ||
          (requiredRouteRadiusM <= LOCAL_TRAFFIC_INNER_RADIUS_M &&
            this.localityPatrolWithinInnerCount >=
              LOCAL_TRAFFIC_PATROL_INNER_CAP))
      ) {
        continue;
      }
      const remainingInspections = Math.max(
        1,
        portalAttemptCeiling - this.portalAttemptsThisDecision,
      );
      const gate = this.findSafeRuntimeTrafficGate(
        npc,
        RUNTIME_TRAFFIC_APPROACH_MIN_M,
        RUNTIME_TRAFFIC_APPROACH_MAX_M,
        false,
        ctx,
        requiredRouteRadiusM,
        playerProjection,
        true,
        preference,
        Math.min(
          remainingInspections,
          LOCAL_TRAFFIC_PORTAL_ATTEMPTS_PER_IDENTITY,
        ),
      );
      if (!gate) continue;
      // Admission is atomic: the exact gate-origin plan and commitment must
      // exist before the hidden slot becomes active. A weighted-plan miss can
      // never create an uncredited car that the next decision immediately
      // retires again.
      if (
        !this.commitNpcLocalityFeed(
          npc,
          ctx,
          requiredRouteRadiusM,
          preference,
          gate,
        )
      ) {
        continue;
      }
      this.activateNpcAtGate(npc, gate, ctx);
      activations += 1;
      // Fold the first activation into the second candidate's lane/corridor
      // and sector score without maintaining a second mutable population view.
      this.refreshLocalityPopulation(ctx);
    }
    return activations;
  }

  /** Releases up to the fixed per-decision number of slots only after their
   * current occupants are safely beyond the recycle band. The same operation
   * serves a local surplus and a persistent local deficit: in the latter case
   * it is how a full, map-wide pool makes room for hidden approach arrivals. */
  private recycleFarNpcSlots(
    ctx: TrafficTickCtx,
    maximumRetirements = LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
  ): void {
    let retirements = 0;
    for (const npc of this.npcsList) {
      if (retirements >= maximumRetirements) break;
      if (!npc.active || npc.pendingRecycle) continue;
      const dx = npc.x - this.playerState.player.x;
      const dz = npc.z - this.playerState.player.z;
      if (dx * dx + dz * dz < RUNTIME_TRAFFIC_RECYCLE_RADIUS_M ** 2) continue;
      this.requestNpcRecycle(npc, ctx);
      // This caller has already proved the current pose is beyond the
      // conservative radius and itself obeys the controller's remaining
      // retirement budget. The slot becomes eligible for an approach spawn
      // on a later decision, after one observable inactive simulation tick.
      this.deactivateNpcForLocality(npc, ctx);
      this.localityRetirements += 1;
      this.localityDecisionRetirements += 1;
      retirements += 1;
    }
  }

  /** A full fixed pool must not strand a visible deficit behind remote outer
   * circulation. Prove a concrete hidden portal and materialized target plan
   * before reclaiming its compatible identity; the exact admission then waits
   * through the required inactive snapshot. An unusable queued patrol or a
   * weighted-plan miss can therefore neither block replacement nor manufacture
   * retirement/activation churn. Healthy traffic still uses the ordinary
   * 800 m recycle. */
  private preflightAndRecycleHiddenNpcSlotsForDeficit(
    ctx: TrafficTickCtx,
    maximumRetirements: number,
    requiredRouteRadiusM: number,
    preference: LocalTrafficPortalPreference,
    portalAttemptCeiling: number,
  ): number {
    if (
      maximumRetirements <= 0 ||
      this.portalAttemptsThisDecision >= portalAttemptCeiling
    ) {
      return 0;
    }
    this.runtimePortalIndex.markAnnulus(
      this.playerState.player,
      RUNTIME_TRAFFIC_APPROACH_MIN_M,
      RUNTIME_TRAFFIC_APPROACH_MAX_M,
    );
    if (this.runtimePortalIndex.markedCount === 0) return 0;
    const playerProjection = this.projectPlayerToLocalityRoad();
    let retirements = 0;
    for (const npc of this.npcsList) {
      if (retirements >= maximumRetirements) break;
      if (this.portalAttemptsThisDecision >= portalAttemptCeiling) break;
      if (
        !npc.active ||
        npc.pendingRecycle ||
        (npc.localityCommitmentBits & LOCALITY_COMMIT_TARGET_MASK) !== 0
      ) {
        continue;
      }
      const dx = npc.x - this.playerState.player.x;
      const dz = npc.z - this.playerState.player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < RUNTIME_TRAFFIC_APPROACH_MIN_M) continue;
      if (this.isInsidePlayerVisibilityEnvelope(npc, ctx)) continue;
      if (
        preference.requireRouteConnection !== false &&
        npc.patrol &&
        (this.localityPatrolWithinFogCount >= this.patrolFogCap() ||
          (requiredRouteRadiusM <= LOCAL_TRAFFIC_INNER_RADIUS_M &&
            this.localityPatrolWithinInnerCount >=
              LOCAL_TRAFFIC_PATROL_INNER_CAP))
      ) {
        continue;
      }

      // Exclude the identity's current remote route from admission load while
      // proving the slot that would replace it. This synchronous probe is not
      // externally observable and the spatial narrow phase already ignores
      // the candidate by stable id.
      npc.active = false;
      this.invalidateLocalityAdmissionRouteTables();
      const remainingInspections = Math.max(
        1,
        portalAttemptCeiling - this.portalAttemptsThisDecision,
      );
      const gate = this.findSafeRuntimeTrafficGate(
        npc,
        RUNTIME_TRAFFIC_APPROACH_MIN_M,
        RUNTIME_TRAFFIC_APPROACH_MAX_M,
        false,
        ctx,
        requiredRouteRadiusM,
        playerProjection,
        true,
        preference,
        Math.min(
          remainingInspections,
          LOCAL_TRAFFIC_PORTAL_ATTEMPTS_PER_IDENTITY,
        ),
      );
      const routePlan = gate
        ? this.snapshotNpcLocalityRoutePlan(npc)
        : null;
      npc.active = true;
      this.invalidateLocalityAdmissionRouteTables();
      if (!gate) continue;
      const requestedGoal = this.routeGoalForPreference(preference);
      if (requestedGoal !== LOCALITY_ROUTE_GOAL_NONE && !routePlan) continue;

      this.deactivateNpcForLocality(npc, ctx);
      this.assignNpcLocalityRoutePlan(npc, routePlan);
      if (
        !this.commitNpcLocalityFeed(
          npc,
          ctx,
          requiredRouteRadiusM,
          preference,
          gate,
        )
      ) {
        // `findSafeRuntimeTrafficGate` already materialized this exact plan,
        // so this is a defensive invariant path. Keep the slot queued rather
        // than activating an uncredited fallback.
        this.discardPreparedLocalityActivation(npc);
        continue;
      }
      npc.preparedLocalityGateId = gate.id;
      this.localityRetirements += 1;
      this.localityDecisionRetirements += 1;
      retirements += 1;
    }
    return retirements;
  }

  /**
   * Keep the slot absent through the current fixed-update snapshot before a
   * later decision can reuse its identity at a runtime portal. The inactive
   * interval is intentionally only one tick: it preserves the fixed pool
   * while making the lifecycle explicit to renderers and safety auditors.
   */
  private deactivateNpcForLocality(npc: NpcInternal, ctx: TrafficTickCtx): void {
    npc.runtimeActivationEligibleTick = ctx.tick + 1;
    this.deactivateNpc(npc);
  }

  /** Recruit one nearby member of the same authoritative fleet before asking
   * the no-pop streamer for a car 570 m away. The winner keeps identity,
   * pose, velocity and visual role; only its future endpoint-continuous route
   * receives an immutable cross-street destination. */
  private recruitLocalNpcForApproachHandoff(ctx: TrafficTickCtx): boolean {
    if (!this.localityApproachTargetAvailable) return false;
    if (
      ctx.elapsedSeconds + 1e-9 <
      this.localityNextAheadFeedAdmissionSeconds
    ) {
      this.localityLocalHandoffCadenceBlocks += 1;
      return false;
    }
    this.localityLocalHandoffAttempts += 1;
    let bestNpc: NpcInternal | null = null;
    let bestPlan: LocalityRoutePlan | null = null;
    let bestEtaSeconds = Number.POSITIVE_INFINITY;
    let sawGeometricCandidate = false;
    let sawRoleOrIncidentBlockedCandidate = false;
    let sawEligibleCandidate = false;
    let sawStructurallyReachableCandidate = false;
    let sawMaterializedCandidate = false;
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      const radialDistance = Math.hypot(
        npc.x - this.playerState.player.x,
        npc.z - this.playerState.player.z,
      );
      if (radialDistance > LOCAL_TRAFFIC_FOG_RADIUS_M) {
        continue;
      }
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (
        !lane ||
        !this.trafficCapacityLaneIds.has(lane.id) ||
        this.isOnCurrentRoadCorridor(
          lane,
          npc.distance,
          npc,
          npc.heading,
          this.localityPlayerProjection,
        )
      ) {
        continue;
      }
      // A close car that already supplies the requested visual bucket should
      // not be relabelled as a second promise. Side/rear traffic that is not
      // ahead and not moving inward remains eligible for a route-only handoff.
      if (
        radialDistance <= this.localityNearViewRadiusM() &&
        (this.isAheadOfPlayer(npc) ||
          this.isApproachingCrossTraffic(npc, lane))
      ) {
        continue;
      }
      sawGeometricCandidate = true;
      if (
        npc.localityCommitmentBits !== 0 ||
        npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE
      ) {
        continue;
      }
      if (
        npc.patrol ||
        npc.pendingRecycle ||
        npc.targetLaneId !== undefined ||
        npc.successorReservationLaneId !== undefined ||
        ctx.tick < npc.struckUntilTick ||
        npc.state === "recovering" ||
        npc.state === "stopping" ||
        npc.state === "yielding" ||
        npc.speedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS ||
        npc.targetSpeedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS
      ) {
        sawRoleOrIncidentBlockedCandidate = true;
        continue;
      }
      sawEligibleCandidate = true;
      if (
        !this.localityRouteGoalIsReachable(
          LOCALITY_ROUTE_GOAL_APPROACH,
          lane,
          npc.distance,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        )
      ) {
        continue;
      }
      sawStructurallyReachableCandidate = true;
      const plan = this.materializeLocalityRoutePlan(
        LOCALITY_ROUTE_GOAL_APPROACH,
        lane,
        npc.distance,
      );
      if (!plan) continue;
      sawMaterializedCandidate = true;
      const etaSeconds = this.localityRoutePlanTravelTimeSeconds(
        lane,
        npc.distance,
        plan,
      );
      const improvesEta = etaSeconds < bestEtaSeconds - 1e-9;
      const winsStableIdentityTie =
        Math.abs(etaSeconds - bestEtaSeconds) <= 1e-9 &&
        (bestNpc === null || npc.slotIndex < bestNpc.slotIndex);
      if (
        !this.localityApproachPlanMeetsPlayerTiming(
          plan,
          etaSeconds,
          LOCAL_TRAFFIC_LOCAL_HANDOFF_MAX_ETA_SECONDS,
        ) ||
        (!improvesEta && !winsStableIdentityTie)
      ) {
        continue;
      }
      bestNpc = npc;
      bestPlan = plan;
      bestEtaSeconds = etaSeconds;
    }
    if (!bestNpc || !bestPlan) {
      if (!sawGeometricCandidate) {
        this.localityLocalHandoffNoCandidates += 1;
      } else if (!sawEligibleCandidate && sawRoleOrIncidentBlockedCandidate) {
        this.localityLocalHandoffRoleOrIncidentBlocks += 1;
      } else if (!sawStructurallyReachableCandidate) {
        this.localityLocalHandoffUnreachable += 1;
      } else if (!sawMaterializedCandidate) {
        this.localityLocalHandoffTargetCapacityBlocks += 1;
      } else {
        this.localityLocalHandoffEtaBlocks += 1;
      }
      return false;
    }
    const previousX = bestNpc.x;
    const previousZ = bestNpc.z;
    const previousSpeedMps = bestNpc.speedMps;
    this.assignNpcLocalityRoutePlan(bestNpc, bestPlan);
    if (
      !this.commitNpcLocalityFeed(
        bestNpc,
        ctx,
        LOCAL_TRAFFIC_INNER_RADIUS_M,
        {
          requireAheadOrApproaching: true,
          proactivePipeline: true,
        },
      )
    ) {
      return false;
    }
    // Assignment is route-only. Keep this defensive assertion branch pure in
    // production builds while making accidental pose mutation obvious in a
    // focused test/debugger.
    if (
      bestNpc.x !== previousX ||
      bestNpc.z !== previousZ ||
      bestNpc.speedMps !== previousSpeedMps
    ) {
      this.releaseNpcLocalityOwnership(bestNpc);
      return false;
    }
    this.localityLocalHandoffs += 1;
    this.localityLocalHandoffEtaHistogram[
      clamp(
        Math.ceil(bestEtaSeconds),
        0,
        this.localityLocalHandoffEtaHistogram.length - 1,
      )
    ] += 1;
    return true;
  }

  /** Decides population only at the 10 Hz traffic cadence. Local target
   * hysteresis avoids churn at the 250/440 m circle boundaries; approach
   * activation is separately bounded so sparse maps cannot create a spike. */
  private maintainLocalTrafficPopulation(ctx: TrafficTickCtx): void {
    this.portalAttemptsThisDecision = 0;
    this.localityDecisionActivations = 0;
    this.localityDecisionRetirements = 0;
    this.settlePendingRecycles(ctx);
    // Retirement is a lifecycle property, not a reaction to a density score.
    // A car that has completed its local pass must release its slot at the
    // hidden 800 m boundary even while the radial target is currently healthy;
    // otherwise the fixed pool gradually strands itself on remote map roads.
    this.recycleFarNpcSlots(
      ctx,
      Math.max(
        0,
        LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET -
          this.localityDecisionRetirements,
      ),
    );
    this.refreshLocalityPopulation(ctx);
    const hasSurplus =
      this.localityWithinFogCount > this.localityTarget.withinFog + 1 ||
      this.localityWithinInnerCount > this.localityTarget.withinInner + 1;
    // Count only committed arrivals through the 440–520 m hand-off. Approach
    // reserve cars farther out are circulation, not a promise that may suppress
    // a visible deficit for tens of seconds.
    const projectedWithinFog =
      this.localityWithinFogCount + this.localityInboundTransitCount;
    const projectedWithinInner =
      this.localityWithinInnerCount + this.localityInboundInnerTransitCount;
    const outerDeficit =
      projectedWithinFog < this.localityTarget.withinFog - 1;
    const innerDeficit =
      projectedWithinInner < this.localityTarget.withinInner - 1;
    // Destination pipelines replace the old undifferentiated reserve: one
    // forward/current-road feed plus a staggered, destination-capped set of
    // independent cross approaches. Radial projection remains separately
    // bounded, so these journeys do not recreate the old centre-bound wave.
    const pipelineRadialHeadroom = Math.max(
      0,
      this.localityTarget.withinFog + 2 - projectedWithinFog,
    );
    // Distribution repair is replacement demand, not additive radial demand.
    // A full fog bubble of cars on the street just left must not suppress the
    // current/forward target after a turn; the fixed pool and one-feed budget
    // still bound total work while a hidden off-corridor slot is exchanged.
    const currentRoadMissing = Math.max(
      0,
      this.localityPerceptualTarget.currentRoadCorridor -
        this.localityCurrentRoadCorridorCount -
        this.localityInboundCurrentRoadTransitCount,
    );
    const forwardMissing = Math.max(
      0,
      this.localityPerceptualTarget.forwardCorridor -
        this.localityForwardCorridorCount -
        this.localityInboundForwardTransitCount,
    );
    const aheadOrApproachingMissing = Math.max(
      0,
      this.localityPerceptualTarget.aheadOrApproaching -
        this.localityAheadOrApproachingCount -
        this.localityInboundPerceptualTransitCount,
    );
    const visibleAheadOrApproachingMissing = Math.max(
      0,
      this.localityPerceptualTarget.aheadOrApproaching -
        this.localityAheadOrApproachingCount,
    );
    const nearViewMissing = Math.max(
      0,
      this.localityNearViewTarget() -
        this.localityNearViewCount -
        this.localityInboundImminentPerceptualTransitCount,
    );
    const movingNearViewMissing = Math.max(
      0,
      this.localityMovingNearViewTarget() -
        this.localityMovingNearViewCount -
        this.localityInboundImminentPerceptualTransitCount,
    );
    const visibleNearViewMissing = Math.max(
      0,
      this.localityNearViewTarget() - this.localityNearViewCount,
      this.localityMovingNearViewTarget() - this.localityMovingNearViewCount,
    );
    const aheadJourneyReserve = Math.min(
      this.npcsList.length,
      this.config.touchFirst
        ? LOCAL_TRAFFIC_TOUCH_APPROACH_RESERVE
        : LOCAL_TRAFFIC_DESKTOP_APPROACH_RESERVE,
    );
    let desiredAheadJourneyCount = this.localityApproachTargetAvailable
      ? Math.min(
          aheadJourneyReserve,
          Math.max(
            visibleNearViewMissing,
            Math.ceil(this.localityCorridorContinuityCompensation / 2),
            Math.ceil(visibleAheadOrApproachingMissing / 2),
          ),
        )
      : 0;
    this.localityTargetAheadJourneyCount = desiredAheadJourneyCount;
    if (
      desiredAheadJourneyCount >
        this.localityInboundPerceptualTransitCount &&
      this.recruitLocalNpcForApproachHandoff(ctx)
    ) {
      // A handoff is the one bounded population action for this decision. It
      // changes no lifecycle count or pose; refresh only the scalar buckets so
      // the next 10 Hz pass sees the exact new commitment.
      this.refreshLocalityPopulation(ctx);
      this.localityGhostGapDecisionCount =
        this.localityAheadOrApproachingCount === 0
          ? this.localityGhostGapDecisionCount + 1
          : 0;
      return;
    }
    if (!this.localityApproachRouteFeedAvailable) {
      // No local candidate and no hidden route: do not let an impossible
      // journey suppress unrelated radial/corridor work this decision.
      desiredAheadJourneyCount = Math.min(
        desiredAheadJourneyCount,
        this.localityInboundPerceptualTransitCount,
      );
      this.localityTargetAheadJourneyCount = desiredAheadJourneyCount;
    }
    const aheadPipelineMissing = Math.max(
      0,
      desiredAheadJourneyCount - this.localityInboundPerceptualTransitCount,
    );
    const perceptualMissing = Math.max(
      currentRoadMissing,
      forwardMissing,
      aheadOrApproachingMissing,
      nearViewMissing,
      movingNearViewMissing,
      aheadPipelineMissing,
    );
    const movingInnerMissing = Math.max(
      0,
      this.localityPerceptualTarget.movingWithinInner -
        this.localityMovingWithinInnerCount -
        this.localityInboundInnerTransitCount,
    );
    // The slow corridor goal owns one staging slot. Cross approaches may own
    // more, but are target-lane capped and admitted no faster than one per
    // deterministic cadence interval.
    const corridorFeedSlotOpen =
      this.localityInboundCurrentRoadTransitCount <
      LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET;
    const aheadFeedSlotOpen =
      aheadPipelineMissing > 0 &&
      ctx.elapsedSeconds + 1e-9 >=
        this.localityNextAheadFeedAdmissionSeconds;
    const corridorAdmissionMissing = corridorFeedSlotOpen
      ? Math.max(currentRoadMissing, forwardMissing)
      : 0;
    const aheadAdmissionMissing = aheadFeedSlotOpen
      ? Math.max(
          aheadOrApproachingMissing,
          nearViewMissing,
          movingNearViewMissing,
          aheadPipelineMissing,
        )
      : 0;
    const movingInnerAdmissionMissing = aheadFeedSlotOpen
      ? movingInnerMissing
      : 0;
    const perceptualAdmissionMissing = Math.max(
      corridorAdmissionMissing,
      aheadAdmissionMissing,
    );
    const proactiveForwardPipelineMissing =
      !hasSurplus &&
      pipelineRadialHeadroom > 0 &&
      this.localityInboundForwardTransitCount <
        LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET
        ? LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET -
          this.localityInboundForwardTransitCount
        : 0;
    const proactiveAheadPipelineMissing =
      !hasSurplus &&
      pipelineRadialHeadroom > proactiveForwardPipelineMissing &&
      this.localityInboundPerceptualTransitCount <
        LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET
        ? LOCAL_TRAFFIC_INBOUND_PIPELINE_TARGET -
          this.localityInboundPerceptualTransitCount
        : 0;
    const proactivePipelineMissing = Math.max(
      proactiveForwardPipelineMissing,
      proactiveAheadPipelineMissing,
    );
    const neededIncoming = Math.max(
      0,
      outerDeficit
        ? this.localityTarget.withinFog - projectedWithinFog
        : 0,
      innerDeficit
        ? this.localityTarget.withinInner - projectedWithinInner
        : 0,
    );
    const radialMissing = neededIncoming;
    const circulatingMissing = Math.max(
      0,
      this.localityPerceptualTarget.circulatingApproach -
        this.localityCirculatingCount,
    );
    // Keep enough queued identities for the staggered cross-traffic promises.
    // Generic radial/circulation fills between cadence ticks would otherwise
    // consume the whole fixed pool before the next distinct destination can
    // be admitted.
    const radialAdmissionMissing =
      aheadPipelineMissing > 0 ? 0 : radialMissing;
    const circulationAdmissionMissing =
      aheadPipelineMissing > 0 ? 0 : circulatingMissing;
    const availableApproachSlots = Math.max(
      perceptualAdmissionMissing,
      movingInnerAdmissionMissing,
      radialAdmissionMissing,
      proactivePipelineMissing,
      hasSurplus ? 0 : circulationAdmissionMissing,
    );
    const inboundDemand = Math.max(
      perceptualAdmissionMissing,
      movingInnerAdmissionMissing,
      radialAdmissionMissing,
      proactivePipelineMissing,
    );
    const circulationOnly =
      inboundDemand === 0 && circulationAdmissionMissing > 0;
    const hasDeficit =
      perceptualMissing > 0 ||
      movingInnerMissing > 0 ||
      proactivePipelineMissing > 0 ||
      (!hasSurplus &&
        (outerDeficit ||
          innerDeficit ||
          circulatingMissing > 0));
    this.densityDeficitDecisions = hasDeficit
      ? this.densityDeficitDecisions + 1
      : 0;
    this.densitySurplusDecisions = hasSurplus && perceptualMissing === 0
      ? this.densitySurplusDecisions + 1
      : 0;
    // Perceptual repair is deliberately one committed arrival at a time. The
    // next 10 Hz snapshot recomputes the hard missing feed before another slot
    // can be spent, avoiding two-car waves that both satisfy the same bit.
    const replacementBudget = Math.min(
      LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
      availableApproachSlots,
      perceptualAdmissionMissing > 0 || proactivePipelineMissing > 0
        ? 1
        : LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
    );
    const persistentDeficit =
      this.densityDeficitDecisions >= LOCAL_TRAFFIC_HYSTERESIS_DECISIONS &&
      replacementBudget > 0;
    const persistentSurplus =
      this.densitySurplusDecisions >= LOCAL_TRAFFIC_HYSTERESIS_DECISIONS;

    // Hard requirements are ordered. A forward feed also contributes to the
    // current-road target, so repair it first; current-only and the independent
    // ahead/cross-traffic union follow on later 10 Hz snapshots.
    const radialFallback =
      radialMissing > 0 &&
      perceptualMissing === 0 &&
      movingInnerMissing === 0 &&
      proactivePipelineMissing === 0 &&
      this.densityDeficitDecisions >=
        LOCAL_TRAFFIC_HYSTERESIS_DECISIONS * 2;
    const requireIndependentAheadFeed =
      !radialFallback &&
      aheadAdmissionMissing > 0;
    const requireForward =
      !radialFallback &&
      !requireIndependentAheadFeed &&
      corridorFeedSlotOpen &&
      (forwardMissing > 0 ||
        (currentRoadMissing === 0 &&
          aheadOrApproachingMissing === 0 &&
          proactiveForwardPipelineMissing > 0));
    const requireCurrent =
      !radialFallback &&
      !requireIndependentAheadFeed &&
      !requireForward &&
      corridorFeedSlotOpen &&
      currentRoadMissing > 0;
    const requireAhead =
      !radialFallback &&
      aheadFeedSlotOpen &&
      (requireIndependentAheadFeed ||
        (!requireForward &&
          !requireCurrent &&
          (aheadOrApproachingMissing > 0 ||
            proactiveAheadPipelineMissing > 0 ||
            innerDeficit ||
            movingInnerAdmissionMissing > 0)));
    const outerLocalOnly =
      !innerDeficit &&
      movingInnerMissing === 0 &&
      perceptualMissing === 0 &&
      proactivePipelineMissing === 0 &&
      radialMissing > 0;
    const preference: LocalTrafficPortalPreference = {
      preferCurrentRoadCorridor: currentRoadMissing > 0 || forwardMissing > 0,
      preferForwardCorridor: forwardMissing > 0,
      preferAheadOrApproaching: aheadOrApproachingMissing > 0,
      requireCurrentRoadCorridor: requireCurrent,
      requireForwardCorridor: requireForward,
      requireAheadOrApproaching: requireAhead,
      preferredSector: this.leastPopulatedLocalitySector(),
      requireRouteConnection: !circulationOnly,
      preferInbound: !circulationOnly,
      outerCirculationOnly: circulationOnly,
      outerLocalOnly,
      proactivePipeline:
        (proactiveForwardPipelineMissing > 0 ||
          proactiveAheadPipelineMissing > 0) &&
        !radialFallback,
    };
    const requiredRouteRadiusM =
      requireAhead || innerDeficit || movingInnerMissing > 0
        ? LOCAL_TRAFFIC_INNER_RADIUS_M
        : LOCAL_TRAFFIC_FOG_RADIUS_M;
    const portalAttemptCeiling =
      radialMissing > 0 && perceptualMissing > 0
        ? Math.floor(LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET / 2)
        : LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET;

    // A deficit makes room only for the bounded number of incoming approach
    // vehicles after a concrete queued admission attempt. A full-pool repair
    // preflights the exact compatible gate/plan before retirement, then leaves
    // that identity absent for one snapshot. A surplus may release hidden
    // slots but deliberately leaves them queued until the next real deficit.
    const retirementsBeforePopulationAction = this.localityDecisionRetirements;
    let activations = 0;
    let radialFallbackActivations = 0;
    if (persistentDeficit) {
      activations = this.activateLocalQueuedNpcs(
        ctx,
        replacementBudget,
        requiredRouteRadiusM,
        preference,
        portalAttemptCeiling,
      );
      if (activations === 0 && inboundDemand > 0) {
        this.preflightAndRecycleHiddenNpcSlotsForDeficit(
          ctx,
          Math.min(
            replacementBudget,
            Math.max(
              0,
              LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET -
                this.localityDecisionRetirements,
            ),
          ),
          requiredRouteRadiusM,
          preference,
          portalAttemptCeiling,
        );
      }
      radialFallbackActivations =
        activations === 0 && radialFallback
          ? this.activateLocalQueuedNpcs(
              ctx,
              1,
              innerDeficit
                ? LOCAL_TRAFFIC_INNER_RADIUS_M
                : LOCAL_TRAFFIC_FOG_RADIUS_M,
              {
                preferredSector: this.leastPopulatedLocalitySector(),
                requireRouteConnection: true,
                preferInbound: true,
                outerLocalOnly: !innerDeficit,
              },
              LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
            )
          : 0;
    } else if (persistentSurplus) {
      this.recycleFarNpcSlots(
        ctx,
        Math.max(
          0,
          LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET -
            this.localityDecisionRetirements,
        ),
      );
    }

    if (persistentDeficit) {
      // After a second full evidence window, a simultaneously missing radial
      // target may use a route-connected radial fallback. It deliberately gets
      // no perceptual commitment, so the unsatisfied hard feed remains visible
      // to the next decision instead of being falsely projected as repaired.
      if (activations + radialFallbackActivations > 0) {
        // Keep the proven threshold while demand remains. In-flight counters
        // prevent overshoot, while another bounded batch may flow next pass.
        this.densityDeficitDecisions = LOCAL_TRAFFIC_HYSTERESIS_DECISIONS;
      }
      // A failed activation deliberately leaves the threshold intact. The
      // portal cursor and an observed one-tick inactive slot may make the very
      // next 10 Hz pass viable; restarting a full second made ghost gaps last.
    } else if (persistentSurplus) {
      if (this.localityDecisionRetirements > retirementsBeforePopulationAction) {
        // Cars already in the local window continue to drive normally; only a
        // completed far-hidden retirement earns a fresh hysteresis interval.
        this.densitySurplusDecisions = 0;
      }
    }
    this.refreshLocalityPopulation(ctx);
    this.localityGhostGapDecisionCount =
      this.localityAheadOrApproachingCount === 0
        ? this.localityGhostGapDecisionCount + 1
        : 0;
  }

  makeTrafficDecisions(ctx: TrafficTickCtx): void {
    if (this.localityEnabled) this.maintainLocalTrafficPopulation(ctx);
    else this.activateQueuedNpcs(ctx);
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      // A struck car makes no decisions while it sits knocked; moveNpcs owns
      // the hold and the release.
      if (ctx.tick < npc.struckUntilTick) continue;
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!lane) {
        this.requestNpcRecycle(npc, ctx);
        continue;
      }
      npc.decisionCooldown = Math.max(0, npc.decisionCooldown - TRAFFIC_DECISION_SECONDS);

      if (npc.state === "signaling") {
        npc.signalSeconds -= TRAFFIC_DECISION_SECONDS;
        if (npc.signalSeconds <= 0 && npc.targetLaneId) {
          npc.state = "lane-changing";
          npc.laneChangeProgress = 0;
        }
        continue;
      }
      if (npc.state === "lane-changing" && npc.targetLaneId) {
        const targetLane = this.roadNetwork.lanesById.get(npc.targetLaneId);
        npc.targetSpeedMps =
          targetLane && this.isNpcLaneChangeClear(npc, targetLane, ctx)
            ? npc.desiredSpeedMps
            : 0;
        continue;
      }

      const stoppingGap = this.redLightGapForLane(lane, npc.distance, ctx);
      const yieldGap = this.yieldGapForLane(lane, npc.distance);
      const leadGap = this.leadVehicleGap(lane, npc.distance, ctx, npc.id);
      const desiredGap = NPC_FOLLOW_STANDSTILL_GAP_M + npc.speedMps * 1.8;
      if (stoppingGap !== null && stoppingGap < Math.max(10, npc.speedMps * 2.2)) {
        npc.state = "stopping";
        npc.targetSpeedMps = stoppingGap < 3 ? 0 : Math.min(npc.desiredSpeedMps, stoppingGap * 0.45);
      } else if (yieldGap !== null && yieldGap < Math.max(9, npc.speedMps * 1.8)) {
        npc.state = "yielding";
        npc.targetSpeedMps = yieldGap < 2.5 ? 0 : Math.min(4, yieldGap * 0.4);
      } else if (leadGap !== null && leadGap < desiredGap) {
        npc.state = "following";
        const minimumCentreGap =
          PLAYER_RADIUS_METRES + NPC_RADIUS_METRES + NPC_MIN_BUMPER_CLEARANCE_M;
        npc.targetSpeedMps =
          leadGap <= minimumCentreGap
            ? 0
            : Math.min(
                npc.desiredSpeedMps,
                Math.max(0, (leadGap - minimumCentreGap) / 1.8),
              );
      } else if (lane.kind === "roundabout") {
        npc.state = "roundabout";
        npc.targetSpeedMps = Math.min(npc.desiredSpeedMps, 8);
      } else if (lane.kind === "merge") {
        npc.state = "merging";
        npc.targetSpeedMps = npc.desiredSpeedMps * 0.9;
      } else if (npc.state === "recovering") {
        npc.targetSpeedMps = Math.min(4, npc.desiredSpeedMps);
      } else {
        npc.state = "cruising";
        npc.targetSpeedMps = npc.desiredSpeedMps;
      }

      if (npc.speedMps < 0.1 && npc.targetSpeedMps > 0.5) {
        npc.stoppedSeconds += TRAFFIC_DECISION_SECONDS;
      } else {
        npc.stoppedSeconds = 0;
      }
      if (npc.stoppedSeconds > 7 && stoppingGap === null) {
        npc.state = "recovering";
        npc.targetSpeedMps = 3;
        npc.stoppedSeconds = 0;
      }

      const adjacent = lane.adjacentLaneId
        ? this.roadNetwork.lanesById.get(lane.adjacentLaneId)
        : undefined;
      const laneChangeDistanceRequired =
        Math.max(npc.speedMps, npc.desiredSpeedMps) *
          NPC_LANE_CHANGE_SIGNAL_SECONDS +
        NPC_LANE_CHANGE_DISTANCE_M +
        NPC_LANE_CHANGE_END_MARGIN_M;
      if (
        adjacent &&
        lane.length - npc.distance > laneChangeDistanceRequired &&
        npc.decisionCooldown <= 0 &&
        npc.state === "cruising" &&
        this.random.next() < 0.025 &&
        this.isNpcLaneChangeClear(npc, adjacent, ctx)
      ) {
        const currentPose = this.roadNetwork.pointOnLane(lane, npc.distance);
        const adjacentDistance = (npc.distance / lane.length) * adjacent.length;
        const targetPose = this.roadNetwork.pointOnLane(adjacent, adjacentDistance);
        const localRightX = Math.cos(currentPose.heading);
        const localRightZ = -Math.sin(currentPose.heading);
        const side =
          (targetPose.x - currentPose.x) * localRightX +
            (targetPose.z - currentPose.z) * localRightZ >
          0
            ? "right"
            : "left";
        npc.targetLaneId = adjacent.id;
        npc.signal = side;
        npc.signalSeconds = NPC_LANE_CHANGE_SIGNAL_SECONDS;
        npc.state = "signaling";
        npc.decisionCooldown = 9 + this.random.next() * 7;
      }
    }
  }

  /**
   * Turns the pose heading into a steering target instead of an assignment:
   * the car yaws toward it at a speed-scaled rate, so junction turns sweep
   * like a steered vehicle (#19). Authored reversals (turning-loop apexes)
   * jump the target by more than NPC_HEADING_SNAP_RAD in one tick and keep
   * the old snap. Spawn and respawn paths still assign the pose heading
   * directly, so the chase never sweeps across a teleport.
   */
  private chaseNpcHeading(
    npc: NpcInternal,
    targetHeading: number,
    deltaSeconds: number,
  ): void {
    if (Math.abs(angleDifference(targetHeading, npc.heading)) >= NPC_HEADING_SNAP_RAD) {
      npc.heading = wrapAngle(targetHeading);
      return;
    }
    const yawRate = clamp(
      npc.speedMps / NPC_MIN_TURN_RADIUS_M,
      NPC_YAW_RATE_MIN_RAD_S,
      NPC_YAW_RATE_MAX_RAD_S,
    );
    npc.heading = approachAngle(npc.heading, targetHeading, yawRate * deltaSeconds);
  }

  /**
   * The rendered pose for a car crossing a lane hop: a corner arc spliced
   * between the two lane lines, replacing the centreline's convergence onto
   * the shared junction node (#19). `progressM` is arc distance from the
   * window start on the departing lane. Near-straight hops ride the chord —
   * which also irons out the node convergence for straight-throughs — while
   * real turns follow a quadratic Bezier around the point where the two lane
   * lines would meet, so position and tangent heading sweep together like a
   * steered car. Returns null when the geometry degenerates; the caller keeps
   * the centreline pose.
   */
  private cornerArcPose(
    fromLane: NormalizedLane,
    toLane: NormalizedLane,
    progressM: number,
  ): SimulationPose | null {
    const fromWindow = Math.min(NPC_CORNER_WINDOW_M, fromLane.length / 2);
    const toWindow = Math.min(NPC_CORNER_WINDOW_M, toLane.length / 2);
    const total = fromWindow + toWindow;
    if (total < 1) return null;
    const t = clamp(progressM / total, 0, 1);
    const start = this.roadNetwork.pointOnLane(fromLane, fromLane.length - fromWindow);
    const end = this.roadNetwork.pointOnLane(toLane, toWindow);
    const turn = angleDifference(end.heading, start.heading);
    const chordX = end.x - start.x;
    const chordZ = end.z - start.z;
    if (Math.abs(turn) >= NPC_CORNER_MIN_TURN_RAD) {
      // Apex: where the departing lane line, extended, meets the target lane
      // line extended backwards — the true corner of the driving path.
      const startDirX = Math.sin(start.heading);
      const startDirZ = Math.cos(start.heading);
      const endDirX = Math.sin(end.heading);
      const endDirZ = Math.cos(end.heading);
      const det = startDirX * endDirZ - startDirZ * endDirX;
      if (Math.abs(det) > 1e-6) {
        const toStart = (chordX * endDirZ - chordZ * endDirX) / det;
        const toEnd = (startDirX * chordZ - startDirZ * chordX) / det;
        if (
          toStart > 0 &&
          toEnd > 0 &&
          toStart <= NPC_CORNER_MAX_APEX_M &&
          toEnd <= NPC_CORNER_MAX_APEX_M
        ) {
          const apexX = start.x + startDirX * toStart;
          const apexZ = start.z + startDirZ * toStart;
          const bezierAt = (parameter: number) => {
            const inverse = 1 - parameter;
            return {
              x:
                inverse * inverse * start.x +
                2 * inverse * parameter * apexX +
                parameter * parameter * end.x,
              z:
                inverse * inverse * start.z +
                2 * inverse * parameter * apexZ +
                parameter * parameter * end.z,
            };
          };
          // Cumulative-length table: progress maps onto the curve at uniform
          // speed, so the pose advances exactly with the car's travel.
          const arcLengths = [0];
          let previous = bezierAt(0);
          for (let sample = 1; sample <= NPC_CORNER_ARC_SAMPLES; sample += 1) {
            const current = bezierAt(sample / NPC_CORNER_ARC_SAMPLES);
            arcLengths.push(
              arcLengths[sample - 1] +
                Math.hypot(current.x - previous.x, current.z - previous.z),
            );
            previous = current;
          }
          const arcLength = arcLengths[NPC_CORNER_ARC_SAMPLES];
          if (arcLength > 1e-6 && arcLength <= total * NPC_CORNER_MAX_ARC_STRETCH) {
            const targetArc = t * arcLength;
            let segment = 1;
            while (
              segment < NPC_CORNER_ARC_SAMPLES &&
              arcLengths[segment] < targetArc
            ) {
              segment += 1;
            }
            const segmentSpan = arcLengths[segment] - arcLengths[segment - 1];
            const within =
              segmentSpan > 1e-9
                ? (targetArc - arcLengths[segment - 1]) / segmentSpan
                : 0;
            const parameter =
              (segment - 1 + clamp(within, 0, 1)) / NPC_CORNER_ARC_SAMPLES;
            const inverse = 1 - parameter;
            const tangentX =
              inverse * (apexX - start.x) + parameter * (end.x - apexX);
            const tangentZ =
              inverse * (apexZ - start.z) + parameter * (end.z - apexZ);
            const position = bezierAt(parameter);
            return {
              x: position.x,
              z: position.z,
              heading:
                Math.abs(tangentX) + Math.abs(tangentZ) > 1e-9
                  ? Math.atan2(tangentX, tangentZ)
                  : start.heading,
            };
          }
        }
      }
    }
    const chordLength = Math.hypot(chordX, chordZ);
    if (chordLength < 1e-6) return null;
    return {
      x: start.x + chordX * t,
      z: start.z + chordZ * t,
      heading: Math.atan2(chordX, chordZ),
    };
  }

  /**
   * Where a car sits over the last stretch of a lane that hands on to another:
   * on the sweep between the two rather than on its own end blend, which eases
   * sideways toward the shared junction node.
   *
   * Split out and taking its distance as an argument — rather than reading
   * `npc.distance` — so a lane change can aim at the pose its car will actually
   * settle on. Aiming at the raw centreline instead left the car short of the
   * lane line at the moment the change completed, and it covered the last
   * half-metre sideways in a single tick.
   */
  private npcExitArcPose(
    npc: NpcInternal,
    lane: NormalizedLane,
    distance: number,
    fallback: SimulationPose,
  ): SimulationPose {
    const exitWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
    const exitStart = lane.length - exitWindow;
    if (distance < exitStart) return fallback;
    const next = this.nextLaneForNpc(npc, lane);
    if (
      next &&
      next.id !== lane.id &&
      this.roadNetwork.areLaneEndpointsContinuous(lane, next)
    ) {
      return this.cornerArcPose(lane, next, distance - exitStart) ?? fallback;
    }
    return fallback;
  }

  /**
   * Overlays the corner arc on a cruising car's centreline pose when it is
   * inside the hop window: the exit half while approaching its deterministic
   * successor, the entry half just after the hop (tracked by
   * `cornerFromLaneId`). Falls back to the centreline pose whenever the hop
   * is unknown, discontinuous, or geometrically degenerate.
   */
  private npcCornerPose(
    npc: NpcInternal,
    lane: NormalizedLane,
    fallback: SimulationPose,
  ): SimulationPose {
    const exitWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
    const exitStart = lane.length - exitWindow;
    if (
      npc.distance >= exitStart &&
      npc.successorReservationFromLaneId === lane.id &&
      Boolean(npc.successorReservationLaneId)
    ) {
      return this.npcExitArcPose(npc, lane, npc.distance, fallback);
    }
    if (npc.cornerFromLaneId) {
      const entryWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
      if (npc.distance < entryWindow) {
        const previous = this.roadNetwork.lanesById.get(npc.cornerFromLaneId);
        if (previous) {
          const previousWindow = Math.min(NPC_CORNER_WINDOW_M, previous.length / 2);
          return (
            this.cornerArcPose(previous, lane, previousWindow + npc.distance) ?? fallback
          );
        }
      }
      npc.cornerFromLaneId = undefined;
    }
    return fallback;
  }

  /** `deltaSeconds` doubles as the fixed-step constant for the spatial-safety
   * sub-sampling below: `moveNpcs` is only ever invoked with the fixed step
   * (same reasoning as `resolveStaticCollisions`'s `fixedStepSeconds` param
   * in playerDynamics.ts), so reading it off the parameter instead of a
   * separately-imported FIXED_STEP_SECONDS constant is behaviourally
   * identical and avoids a value import back into this module. */
  moveNpcs(deltaSeconds: number, ctx: TrafficTickCtx): void {
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      npc.previousX = npc.x;
      npc.previousZ = npc.z;
      if (ctx.tick < npc.struckUntilTick) {
        // Knocked by the player: hold position (and the askew lean) until the
        // struck window expires, then rejoin traffic normally.
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        this.syncNpcSpatialIndex(npc);
        continue;
      }
      if (npc.struckUntilTick !== 0) {
        npc.struckUntilTick = 0;
        npc.incidentLeanRad = 0;
      }
      const deceleration = npc.targetSpeedMps < npc.speedMps ? 4.4 : 0;
      const acceleration = deceleration || 2.2;
      npc.speedMps = moveTowards(npc.speedMps, npc.targetSpeedMps, acceleration * deltaSeconds);
      const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!sourceLane) {
        // Corrupt/removed lane membership is an exceptional lifecycle path,
        // not a permanently inert slot. The car remains authoritative until
        // the bounded hidden-envelope recovery pass may retire it.
        this.requestNpcRecycle(npc, ctx);
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "recovering";
        this.syncNpcSpatialIndex(npc);
        continue;
      }
      const requestedTravel = npc.speedMps * deltaSeconds;
      const leadGap = this.leadVehicleGap(sourceLane, npc.distance, ctx, npc.id);
      // Hold a full body length so a compressing queue stops bumper-to-bumper
      // rather than letting the ~3.75 m car meshes overlap at the old ~2.4 m gap.
      const minimumCentreGap = NPC_BODY_CLEARANCE_M;
      const followingSafeTravel =
        leadGap === null
          ? requestedTravel
          : Math.max(0, Math.min(requestedTravel, leadGap - minimumCentreGap));
      let safeTravel = followingSafeTravel;
      if (followingSafeTravel > 0) {
        const lookAheadTravel = Math.max(followingSafeTravel, npc.speedMps * 0.35 + 0.75);
        if (!this.isNpcTravelClearOfPlayer(npc, lookAheadTravel)) {
          safeTravel = 0;
        } else if (
          // Route distance is authoritative for ordinary following, but a
          // curved/U-shaped lane can fold two far-apart arclengths physically
          // together near its endpoint. When there is no route-leading gap,
          // retain the source-lane-only probe: the car farther along the fold
          // sees its nearby counterpart as "behind" and otherwise could
          // drive back into it. Alternate successor branches stay excluded
          // from that extra path to avoid turning unrelated geometry into a
          // false blocker.
          !this.isNpcTravelClearOfRouteLeadingBodies(
            npc,
            lookAheadTravel,
            leadGap !== null,
          )
        ) {
          safeTravel = 0;
        } else {
          const spatialSafetyTick =
            ctx.tick % Math.round(TRAFFIC_DECISION_SECONDS / deltaSeconds) === 0;
          // The ordinary crossing probe intentionally runs at the 10 Hz
          // decision cadence. Once an approach is inside the endpoint
          // envelope, though, two unrelated incoming lanes can converge in
          // the five fixed steps before that next decision. Keep that narrow
          // physical safety check continuous so a pair cannot enter the
          // rendered-body radius between decision ticks.
          if (
            (spatialSafetyTick ||
              this.requiresContinuousNpcSpatialSafetyCheck(npc, lookAheadTravel)) &&
            !this.isNpcTravelSpatiallyClear(npc, lookAheadTravel)
          ) {
            safeTravel = 0;
          }
        }
      }
      if (safeTravel + 1e-6 < requestedTravel) {
        npc.speedMps = Math.min(npc.speedMps, safeTravel / deltaSeconds);
        npc.targetSpeedMps = 0;
        npc.state = "following";
      }
      if (!this.advanceNpcAlongLegalRoute(npc, safeTravel, deltaSeconds, ctx)) {
        this.syncNpcSpatialIndex(npc);
        continue;
      }

      const activeSourceLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!activeSourceLane) {
        this.requestNpcRecycle(npc, ctx);
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "recovering";
        this.syncNpcSpatialIndex(npc);
        continue;
      }
      const sourcePose = this.roadNetwork.pointOnLane(activeSourceLane, npc.distance);
      if (npc.state === "lane-changing" && npc.targetLaneId) {
        const targetLane = this.roadNetwork.lanesById.get(npc.targetLaneId);
        if (targetLane) {
          if (!this.isNpcLaneChangeClear(npc, targetLane, ctx)) {
            npc.targetSpeedMps = 0;
            const amount = smoothStep(npc.laneChangeProgress);
            const targetDistance =
              (npc.distance / activeSourceLane.length) * targetLane.length;
            const targetPose = this.npcExitArcPose(
              npc,
              targetLane,
              targetDistance,
              this.roadNetwork.pointOnLane(targetLane, targetDistance),
            );
            npc.x = sourcePose.x + (targetPose.x - sourcePose.x) * amount;
            npc.z = sourcePose.z + (targetPose.z - sourcePose.z) * amount;
            this.chaseNpcHeading(
              npc,
              lerpAngle(sourcePose.heading, targetPose.heading, amount),
              deltaSeconds,
            );
            this.syncNpcSpatialIndex(npc);
            continue;
          }
          npc.laneChangeProgress = Math.min(
            1,
            npc.laneChangeProgress + safeTravel / NPC_LANE_CHANGE_DISTANCE_M,
          );
          const amount = smoothStep(npc.laneChangeProgress);
          const targetDistance =
            (npc.distance / activeSourceLane.length) * targetLane.length;
          const targetPose = this.npcExitArcPose(
            npc,
            targetLane,
            targetDistance,
            this.roadNetwork.pointOnLane(targetLane, targetDistance),
          );
          npc.x = sourcePose.x + (targetPose.x - sourcePose.x) * amount;
          npc.z = sourcePose.z + (targetPose.z - sourcePose.z) * amount;
          this.chaseNpcHeading(
            npc,
            lerpAngle(sourcePose.heading, targetPose.heading, amount),
            deltaSeconds,
          );
          if (npc.laneChangeProgress >= 1) {
            npc.laneId = targetLane.id;
            npc.distance = targetDistance;
            npc.targetLaneId = undefined;
            npc.successorReservationFromLaneId = undefined;
            npc.successorReservationLaneId = undefined;
            npc.laneChangeProgress = 0;
            npc.signal = "off";
            npc.state = targetLane.kind === "merge" ? "merging" : "cruising";
          }
          this.syncNpcSpatialIndex(npc);
          continue;
        }
      }
      const displayPose = this.npcCornerPose(npc, activeSourceLane, sourcePose);
      npc.x = displayPose.x;
      npc.z = displayPose.z;
      this.chaseNpcHeading(npc, displayPose.heading, deltaSeconds);
      this.syncNpcSpatialIndex(npc);
    }
  }

  /**
   * Turns a permanent NPC jam into a self-clearing incident. Raised body
   * clearances already stop a converging collision bumper-to-bumper instead of
   * meshing; this then sits the pinned car askew so the contact reads as a
   * knock, and once it has been unable to move for a few seconds while it is
   * pinned bumper-to-bumper against another vehicle (and obeying no signal or
   * yield), recycles it through the deterministic traffic-gate queue so the lane
   * flows again — as if the incident were cleared. A jammed car within
   * NPC_INCIDENT_PLAYER_CLEARANCE_M of the player is held visible instead of
   * vanishing beside them. The askew lean is a separate display-only field, so
   * the model's heading stays clean and the knock cannot perturb determinism.
   */
  updateNpcIncidents(deltaSeconds: number, ctx: TrafficTickCtx): void {
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      // A player-struck car already sits askew on its own timer; the jam
      // machinery must neither clear that lean nor recycle the car while the
      // player is right next to it.
      if (ctx.tick < npc.struckUntilTick) continue;
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!lane) continue;
      const barelyMoved =
        Math.hypot(npc.x - npc.previousX, npc.z - npc.previousZ) < 0.04;
      // Ordered cheapest-first so the short-circuit does the real work: a
      // moving car (nearly all of them, nearly all the time) never pays for
      // the stop-line scans or the pairwise pin check. All three predicates
      // are pure reads, so skipping them cannot perturb determinism.
      // A car pressed within a body length of another is the signature of a
      // collision jam: an orderly stopped queue settles at the ~5 m decision gap
      // (see makeTrafficDecisions), so only a deadlock compresses down to the
      // NPC_BODY_CLEARANCE_M hard floor. This catches both a same-heading
      // pile-up and a converging bump while leaving normal queues untouched.
      const jammed =
        npc.speedMps < 0.25 &&
        barelyMoved &&
        !(
          lane.kind === "roundabout" ||
          this.redLightGapForLane(lane, npc.distance, ctx) !== null ||
          this.yieldGapForLane(lane, npc.distance) !== null
        ) &&
        this.npcsList.some((other) => {
          if (!other.active || other.id === npc.id) return false;
          const reach = NPC_BODY_CLEARANCE_M + 0.5;
          return distanceSquared(npc, other) <= reach * reach;
        });
      if (!jammed) {
        npc.jamSeconds = 0;
        npc.incidentLeanRad = 0;
        continue;
      }
      npc.jamSeconds += deltaSeconds;
      if (
        npc.jamSeconds >= NPC_INCIDENT_STUCK_SECONDS &&
        distanceSquared(npc, this.playerState.player) >
          NPC_INCIDENT_PLAYER_CLEARANCE_M * NPC_INCIDENT_PLAYER_CLEARANCE_M
      ) {
        this.requestNpcRecycle(npc, ctx);
        continue;
      }
      // Lean the rendered pose askew so the contact reads as a knock. This is a
      // separate display-only field, so npc.heading stays pristine for the
      // spatial-clearance model and the knock cannot perturb determinism.
      const side = this.numericNpcId(npc.id) % 2 === 0 ? 1 : -1;
      npc.incidentLeanRad =
        npc.jamSeconds >= NPC_INCIDENT_KNOCK_SECONDS ? side * NPC_INCIDENT_KNOCK_RAD : 0;
    }
  }

  /**
   * Advances through authored successor lanes. A missing, invalid, or spatially
   * discontinuous successor queues the NPC instead of wrapping it on-screen.
   */
  private continuousSuccessorForNpc(
    npc: NpcInternal,
    lane: NormalizedLane,
  ): NormalizedLane | null {
    const preferred = this.nextLaneForNpc(npc, lane);
    return preferred &&
      this.roadNetwork.areLaneEndpointsContinuous(lane, preferred)
      ? preferred
      : this.deterministicRecoverySuccessor(npc, lane, preferred);
  }

  /** Acquire exclusive junction ownership before `npcCornerPose` starts
   * bending the rendered body away from its source lane. A blocked car stops
   * on the raw centreline boundary; a successful owner pins its successor
   * until the logical hop, so a player arriving later cannot strand it
   * half-turned by an endpoint recheck. */
  private reserveNpcSuccessorBeforeCornerArc(
    npc: NpcInternal,
    lane: NormalizedLane,
    proposedDistance: number,
    deltaSeconds: number,
  ): boolean {
    if (npc.state === "lane-changing" && npc.targetLaneId) return true;
    const exitWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
    const arcStartDistance = lane.length - exitWindow;
    if (proposedDistance < arcStartDistance - 1e-9) return true;
    const existingReservation =
      npc.successorReservationFromLaneId === lane.id &&
      npc.successorReservationLaneId
        ? this.roadNetwork.lanesById.get(npc.successorReservationLaneId)
        : undefined;
    if (
      existingReservation &&
      lane.successorLaneIds.includes(existingReservation.id) &&
      this.roadNetwork.areLaneEndpointsContinuous(lane, existingReservation)
    ) {
      return true;
    }
    npc.successorReservationFromLaneId = undefined;
    npc.successorReservationLaneId = undefined;
    const nextLane = this.continuousSuccessorForNpc(npc, lane);
    if (!nextLane || nextLane.id === lane.id) return true;
    if (this.isNpcLaneEntryClear(npc, nextLane)) {
      npc.successorReservationFromLaneId = lane.id;
      npc.successorReservationLaneId = nextLane.id;
      return true;
    }

    // Normal traffic reaches this branch from before the arc, so advancing to
    // its exact start is monotonic and visually continuous. An authored legacy
    // gate may already lie inside the window; hold its current rendered pose
    // rather than snapping it backwards.
    if (npc.distance < arcStartDistance) {
      npc.distance = arcStartDistance;
      const stopPose = this.roadNetwork.pointOnLane(lane, arcStartDistance);
      npc.x = stopPose.x;
      npc.z = stopPose.z;
      this.chaseNpcHeading(npc, stopPose.heading, deltaSeconds);
    }
    npc.speedMps = 0;
    npc.targetSpeedMps = 0;
    npc.state = "following";
    return false;
  }

  private advanceNpcAlongLegalRoute(
    npc: NpcInternal,
    distanceDelta: number,
    deltaSeconds: number,
    ctx: TrafficTickCtx,
  ): boolean {
    let remaining = Math.max(0, distanceDelta);
    let transitions = 0;
    while (remaining > 0 && transitions <= this.roadNetwork.lanes.length) {
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!lane) {
        this.requestNpcRecycle(npc, ctx);
        return false;
      }
      if (
        !this.reserveNpcSuccessorBeforeCornerArc(
          npc,
          lane,
          npc.distance + remaining,
          deltaSeconds,
        )
      ) {
        return false;
      }
      const available = Math.max(0, lane.length - npc.distance);
      if (remaining <= available) {
        npc.distance += remaining;
        return true;
      }

      if (npc.state === "lane-changing" && npc.targetLaneId) {
        // A lane change should always complete before the source endpoint. If
        // topology or a prolonged obstruction still carries one to the end,
        // requeue it from its last rendered pose instead of snapping a partial
        // lateral interpolation onto the successor centreline.
        this.requestNpcRecycle(npc, ctx);
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "recovering";
        return false;
      }

      remaining -= available;
      const nextLane = this.continuousSuccessorForNpc(npc, lane);
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        npc.distance = lane.length;
        const endPose = this.roadNetwork.pointOnLane(lane, lane.length);
        npc.x = endPose.x;
        npc.z = endPose.z;
        npc.heading = endPose.heading;
        this.requestNpcRecycle(npc, ctx);
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "recovering";
        return false;
      }
      const ownsReservedSuccessor =
        npc.successorReservationFromLaneId === lane.id &&
        npc.successorReservationLaneId === nextLane.id;
      if (!ownsReservedSuccessor && !this.isNpcLaneEntryClear(npc, nextLane)) {
        // Legacy/authored states already inside the window are held in place;
        // ordinary traffic was stopped at the pre-arc boundary above.
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "following";
        return false;
      }
      npc.cornerFromLaneId = lane.id;
      npc.laneId = nextLane.id;
      npc.distance = 0;
      npc.successorReservationFromLaneId = undefined;
      npc.successorReservationLaneId = undefined;
      npc.transitionCount += 1;
      this.invalidateLocalityAdmissionRouteTables();
      if (
        npc.localityRouteGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        npc.localityRoutePlanCursor <
          npc.localityRoutePlanLaneIndices.length &&
        npc.localityRoutePlanLaneIndices[npc.localityRoutePlanCursor] ===
          nextLane.index
      ) {
        npc.localityRoutePlanCursor += 1;
        npc.localityRouteGoalRemainingHops =
          npc.localityRoutePlanLaneIndices.length -
          npc.localityRoutePlanCursor;
      }
      if (npc.localityRoutePlanDeferredUntilReservationClears) {
        npc.localityCommitmentBits = 0;
        npc.localityCommitmentExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        npc.localityCommitmentLastRouteDistanceM = Number.POSITIVE_INFINITY;
        npc.localityRouteGoal = LOCALITY_ROUTE_GOAL_NONE;
        npc.localityRouteGoalRemainingHops = 0;
        npc.localityRouteGoalExpiresAtSeconds = Number.NEGATIVE_INFINITY;
        this.assignNpcLocalityRoutePlan(npc, null);
      }
      npc.targetLaneId = undefined;
      npc.laneChangeProgress = 0;
      npc.signal = "off";
      // A driver reads the limit of the road they are now on. Re-derived from
      // the style drawn at spawn, so an assertive driver stays assertive and a
      // cautious one cautious — they just do it against the new number.
      if (npc.speedFactor !== undefined) {
        npc.desiredSpeedMps = nextLane.speedLimitMps * npc.speedFactor;
      }
      transitions += 1;
    }
    if (transitions > this.roadNetwork.lanes.length) {
      this.requestNpcRecycle(npc, ctx);
      return false;
    }
    return true;
  }

  /** Adjacent authored lanes can enter a junction side-by-side. They are not
   * a crossing conflict when both stable routes continue into distinct,
   * parallel, physically separated successors; treating their 3.2–3.5 m
   * centreline spacing as a 3.8 m rear-end gap deadlocks both lanes. */
  private npcsHaveParallelNonConvergingContinuations(
    npc: NpcInternal,
    lane: NormalizedLane,
    other: NpcInternal,
    otherLane: NormalizedLane,
  ): boolean {
    const authoredPair =
      lane.adjacentLaneId === otherLane.id ||
      otherLane.adjacentLaneId === lane.id ||
      (lane.roadId !== undefined && lane.roadId === otherLane.roadId);
    if (
      !authoredPair ||
      Math.cos(angleDifference(npc.heading, other.heading)) <
        Math.cos(Math.PI / 6)
    ) {
      return false;
    }
    const nextLane = this.nextLaneForNpc(npc, lane);
    const otherNextLane = this.nextLaneForNpc(other, otherLane);
    if (
      !nextLane ||
      !otherNextLane ||
      nextLane.id === otherNextLane.id ||
      !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane) ||
      !this.roadNetwork.areLaneEndpointsContinuous(otherLane, otherNextLane)
    ) {
      return false;
    }
    const nextStart = this.roadNetwork.pointOnLane(nextLane, 0);
    const otherNextStart = this.roadNetwork.pointOnLane(otherNextLane, 0);
    return (
      distanceSquared(nextStart, otherNextStart) >=
        (NPC_RADIUS_METRES * 2 + 0.5) ** 2 &&
      Math.cos(angleDifference(nextStart.heading, otherNextStart.heading)) >=
        Math.cos(Math.PI / 6)
    );
  }

  /** Two predecessor centrelines that end at the same authored node need one
   * stable owner before either reaches the physical convergence. Lower slot
   * wins; sequential movement therefore advances the owner first and holds
   * every contender until the winner is established on its successor. */
  private npcOwnsSharedEndpoint(
    npc: NpcInternal,
    lane: NormalizedLane,
    other: NpcInternal,
    otherLane: NormalizedLane,
    envelopeM: number,
  ): boolean | null {
    if (
      lane.length - npc.distance > envelopeM ||
      otherLane.length - other.distance > envelopeM
    ) {
      return null;
    }
    const laneEnd = this.roadNetwork.pointOnLane(lane, lane.length);
    const otherLaneEnd = this.roadNetwork.pointOnLane(
      otherLane,
      otherLane.length,
    );
    if (distanceSquared(laneEnd, otherLaneEnd) > 0.75 ** 2) return null;
    const nextLane = this.nextLaneForNpc(npc, lane);
    const otherNextLane = this.nextLaneForNpc(other, otherLane);
    if (!nextLane || !otherNextLane) return null;
    const nextStart = this.roadNetwork.pointOnLane(nextLane, 0);
    const otherNextStart = this.roadNetwork.pointOnLane(otherNextLane, 0);
    if (distanceSquared(nextStart, otherNextStart) > 0.75 ** 2) return null;
    const npcHasReservation =
      npc.successorReservationFromLaneId === lane.id &&
      npc.successorReservationLaneId === nextLane.id;
    const otherHasReservation =
      other.successorReservationFromLaneId === otherLane.id &&
      other.successorReservationLaneId === otherNextLane.id;
    if (npcHasReservation !== otherHasReservation) return npcHasReservation;
    const npcControlHeld =
      npc.pendingRecycle ||
      npc.state === "stopping" ||
      npc.state === "yielding" ||
      (npc.state === "following" &&
        npc.speedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS &&
        npc.targetSpeedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS) ||
      npc.struckUntilTick > 0;
    const otherControlHeld =
      other.pendingRecycle ||
      other.state === "stopping" ||
      other.state === "yielding" ||
      (other.state === "following" &&
        other.speedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS &&
        other.targetSpeedMps < LOCAL_TRAFFIC_MOVING_MIN_SPEED_MPS) ||
      other.struckUntilTick > 0;
    if (npcControlHeld !== otherControlHeld) return !npcControlHeld;
    return npc.slotIndex < other.slotIndex;
  }

  /**
   * Keeps authored traffic challenging without letting two converging lane
   * centrelines create a collision before their shared successor is reached.
   * This is a final physical safety envelope, not a replacement for signals,
   * yielding, following-distance decisions, or authored conflict controls.
   */
  private isNpcTravelSpatiallyClear(npc: NpcInternal, travel: number): boolean {
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const nearConflictingEndpoint =
      this.roadNetwork.conflictApproachLaneIds.has(sourceLane.id) &&
      sourceLane.length - npc.distance <= 15 + travel;
    const changingLane = npc.state === "lane-changing" && Boolean(npc.targetLaneId);
    if (!nearConflictingEndpoint && !changingLane) {
      return true;
    }

    const candidate = this.predictedNpcPose(npc, travel);
    if (!candidate) return false;

    const numericNpcId = this.numericNpcId(npc.id);
    for (const other of this.npcsList) {
      if (!other.active || other.id === npc.id) continue;
      const nearbyRadius = NPC_CROSSING_YIELD_CLEARANCE_M + travel + 2;
      if (distanceSquared(npc, other) > nearbyRadius * nearbyRadius) continue;

      const sameFlow =
        npc.laneId === other.laneId ||
        Math.abs(angleDifference(npc.heading, other.heading)) < Math.PI / 6;
      const otherLane = this.roadNetwork.lanesById.get(other.laneId);
      const ownsSharedEndpoint = otherLane
        ? this.npcOwnsSharedEndpoint(
            npc,
            sourceLane,
            other,
            otherLane,
            15 + travel,
          )
        : null;
      if (ownsSharedEndpoint === false) return false;
      if (
        otherLane &&
        this.npcsHaveParallelNonConvergingContinuations(
          npc,
          sourceLane,
          other,
          otherLane,
        )
      ) {
        continue;
      }
      // A full body length keeps two converging cars from visibly overlapping;
      // the lower-priority id still yields the larger crossing gap. (Was ~2.4 m
      // same-flow / ~2.08 m physical, both shorter than the rendered car.)
      const clearance =
        ownsSharedEndpoint === true && sameFlow
          ? NPC_RADIUS_METRES * 2 + 0.05
          : sameFlow
            ? NPC_BODY_CLEARANCE_M
            : numericNpcId > this.numericNpcId(other.id)
              ? NPC_CROSSING_YIELD_CLEARANCE_M
              : NPC_BODY_CLEARANCE_M;
      if (!this.isSweptNpcClearOfPoint(npc, candidate, other, clearance)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The normal crossing probe is amortized at the 10 Hz traffic-decision
   * cadence. Near a controlled/conflicting lane endpoint, however, five
   * fixed steps is enough for two independently routed approaches to cross
   * the physical body envelope before that next probe. This predicate keeps
   * the expensive candidate scan limited to exactly that endpoint envelope
   * (and an in-progress lateral lane change), while making its result
   * authoritative on every fixed movement step.
   */
  private requiresContinuousNpcSpatialSafetyCheck(
    npc: NpcInternal,
    travel: number,
  ): boolean {
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return true;
    return (
      (this.roadNetwork.conflictApproachLaneIds.has(sourceLane.id) &&
        sourceLane.length - npc.distance <= 15 + travel) ||
      (npc.state === "lane-changing" && Boolean(npc.targetLaneId))
    );
  }

  /** Swept body check for the marks left by this NPC's immediately preceding
   * `leadVehicleGap` call. It protects folded/looping lane geometry where
   * along-lane headway can be generous while rendered bodies are close, but
   * does not turn adjacent/oncoming world-cell neighbours into false traffic
   * blockers. A route-leading gap permits its full conservative topology set;
   * without one, only same-lane bodies are relevant to a folded return path.
   * Consumers stay in stable slot order. */
  private isNpcTravelClearOfRouteLeadingBodies(
    npc: NpcInternal,
    travel: number,
    includeRouteLeadingCandidates: boolean,
  ): boolean {
    const candidate = this.predictedNpcPose(npc, travel);
    if (!candidate) return false;
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const clearance = NPC_BODY_CLEARANCE_M;
    for (let slotIndex = 0; slotIndex < this.npcsList.length; slotIndex += 1) {
      if (!this.trafficSpatialIndex.isMarked(slotIndex)) continue;
      const other = this.npcsList[slotIndex];
      if (!other.active || other.id === npc.id) continue;
      if (other.laneId !== npc.laneId) {
        if (!includeRouteLeadingCandidates) continue;
        const otherLane = this.roadNetwork.lanesById.get(other.laneId);
        if (
          !otherLane ||
          !Number.isFinite(
            this.npcRouteDistanceAhead(
              npc,
              sourceLane,
              npc.distance,
              otherLane,
              other.distance,
            ),
          )
        ) {
          continue;
        }
      }
      if (!this.isSweptNpcClearOfPoint(npc, candidate, other, clearance)) {
        return false;
      }
    }
    return true;
  }

  /** Player-to-NPC clearance for traffic decisions (was a module constant
   * derived from the fixed player disc; now tracks the configured radius). */
  private playerTrafficClearanceM(): number {
    return this.config.playerRadiusM + NPC_RADIUS_METRES + 1.25;
  }

  private isNpcTravelClearOfPlayer(npc: NpcInternal, travel: number): boolean {
    const playerCheckRadius = this.playerTrafficClearanceM() + travel + 5;
    if (
      distanceSquared(npc, this.playerState.player) >
      playerCheckRadius * playerCheckRadius
    ) {
      return true;
    }
    const candidate = this.predictedNpcPose(npc, travel);
    return Boolean(
      candidate &&
        this.isSweptNpcClearOfPoint(
          npc,
          candidate,
          this.playerState.player,
          this.playerTrafficClearanceM(),
        ),
    );
  }

  private predictedNpcPose(npc: NpcInternal, travel: number): SimulationPose | null {
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return null;
    const nonNegativeTravel = Math.max(0, travel);
    const sourceDistance = Math.min(
      sourceLane.length,
      npc.distance + nonNegativeTravel,
    );
    const sourcePose = this.roadNetwork.pointOnLane(sourceLane, sourceDistance);
    if (npc.state !== "lane-changing" || !npc.targetLaneId) {
      const exitWindow = Math.min(
        NPC_CORNER_WINDOW_M,
        sourceLane.length / 2,
      );
      const ownsReservation =
        npc.successorReservationFromLaneId === sourceLane.id &&
        Boolean(npc.successorReservationLaneId);
      if (
        !ownsReservation &&
        npc.distance >= sourceLane.length - exitWindow - 1e-9
      ) {
        // A hand-authored/legacy pose already inside the overlay without the
        // pre-arc transaction must not have safety prediction jump sideways.
        return sourcePose;
      }
      const distancePastSource = Math.max(
        0,
        npc.distance + nonNegativeTravel - sourceLane.length,
      );
      if (distancePastSource > 0) {
        const nextLane = this.nextLaneForNpc(npc, sourceLane);
        if (
          nextLane &&
          this.roadNetwork.areLaneEndpointsContinuous(sourceLane, nextLane)
        ) {
          const targetDistance = Math.min(nextLane.length, distancePastSource);
          const targetPose = this.roadNetwork.pointOnLane(
            nextLane,
            targetDistance,
          );
          return (
            this.cornerArcPose(
              sourceLane,
              nextLane,
              exitWindow + targetDistance,
            ) ?? targetPose
          );
        }
      }
      return this.npcExitArcPose(npc, sourceLane, sourceDistance, sourcePose);
    }
    const targetLane = this.roadNetwork.lanesById.get(npc.targetLaneId);
    if (!targetLane) return sourcePose;
    const progress = Math.min(
      1,
      npc.laneChangeProgress + Math.max(0, travel) / NPC_LANE_CHANGE_DISTANCE_M,
    );
    const amount = smoothStep(progress);
    const targetDistance = (sourceDistance / sourceLane.length) * targetLane.length;
    const targetPose = this.roadNetwork.pointOnLane(targetLane, targetDistance);
    return {
      x: sourcePose.x + (targetPose.x - sourcePose.x) * amount,
      z: sourcePose.z + (targetPose.z - sourcePose.z) * amount,
      heading: lerpAngle(sourcePose.heading, targetPose.heading, amount),
    };
  }

  private isSweptNpcClearOfPoint(
    npc: NpcInternal,
    candidate: SimulationPoint,
    obstacle: SimulationPoint,
    clearance: number,
  ): boolean {
    const clearanceSquared = clearance * clearance;
    const initialSquared = distanceSquared(npc, obstacle);
    const candidateSquared = distanceSquared(candidate, obstacle);
    if (initialSquared < clearanceSquared) {
      // Never trap a vehicle that is already inside the conservative buffer;
      // it may move only if doing so does not reduce the existing clearance.
      return candidateSquared + 1e-8 >= initialSquared;
    }
    return (
      distanceToSegmentSquared(obstacle.x, obstacle.z, npc.x, npc.z, candidate.x, candidate.z) >=
      clearanceSquared
    );
  }

  /** One deterministic successor choice shared by actual movement and the
   * bounded locality route predictor. On shipping lanes, continuing along the
   * same authored road is the ordinary driver choice; hash among those stable,
   * endpoint-continuous candidates first, then retain the legacy all-successor
   * hash when the road genuinely ends. Keeping `transitionCount` explicit lets
   * the predictor follow future choices without mutating the NPC. */
  private nextLaneForNpcAtTransition(
    npc: NpcInternal,
    lane: NormalizedLane,
    transitionCount: number,
    routeGoal: LocalityRouteGoal = npc.localityRouteGoal,
    routeGoalRemainingHops = npc.localityRouteGoalRemainingHops,
    routePlanCursor = npc.localityRoutePlanCursor,
  ): NormalizedLane | null {
    if (
      transitionCount === npc.transitionCount &&
      npc.successorReservationFromLaneId === lane.id &&
      npc.successorReservationLaneId
    ) {
      const reserved = this.roadNetwork.lanesById.get(
        npc.successorReservationLaneId,
      );
      if (
        reserved &&
        lane.successorLaneIds.includes(reserved.id) &&
        this.roadNetwork.areLaneEndpointsContinuous(lane, reserved)
      ) {
        return reserved;
      }
    }
    if (lane.successorLaneIds.length) {
      const numericId = this.parsedNpcDigits(npc.id) || 1;
      if (
        routeGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        routeGoal === npc.localityRouteGoal &&
        routePlanCursor >= 0 &&
        routePlanCursor < npc.localityRoutePlanLaneIndices.length
      ) {
        const plannedLaneIndex =
          npc.localityRoutePlanLaneIndices[routePlanCursor];
        const plannedLane = this.roadNetwork.lanes[plannedLaneIndex];
        if (
          plannedLane &&
          lane.successorLaneIds.includes(plannedLane.id) &&
          this.roadNetwork.areLaneEndpointsContinuous(lane, plannedLane)
        ) {
          return plannedLane;
        }
        return null;
      }
      if (
        routeGoal !== LOCALITY_ROUTE_GOAL_NONE &&
        routeGoalRemainingHops > 0 &&
        lane.index !== undefined
      ) {
        const table = this.localityRouteGoalTable(routeGoal);
        const boundedHopBudget = clamp(
          Math.trunc(routeGoalRemainingHops),
          0,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        );
        const goalNextLaneIndex = table
          ? table.nextLaneIndexByHopBudget[
              boundedHopBudget * table.laneCount + lane.index
            ]
          : -1;
        if (goalNextLaneIndex >= 0) {
          const goalNextLane = this.roadNetwork.lanes[goalNextLaneIndex];
          if (
            lane.successorLaneIds.includes(goalNextLane.id) &&
            this.roadNetwork.areLaneEndpointsContinuous(lane, goalNextLane)
          ) {
            return goalNextLane;
          }
        }
      }
      const laneSalt =
        lane.index === undefined
          ? stableRouteLaneSalt(lane.id)
          : this.routeLaneSalts[lane.index];
      let routeHash =
        laneSalt ^
        Math.imul(numericId, 0x9e3779b1) ^
        Math.imul(transitionCount + 1, 0x85ebca6b);
      routeHash ^= routeHash >>> 16;
      routeHash = Math.imul(routeHash, 0x7feb352d);
      routeHash ^= routeHash >>> 15;
      routeHash >>>= 0;
      let sameRoadSuccessorCount = 0;
      if (lane.roadId) {
        for (const successorId of lane.successorLaneIds) {
          const successor = this.roadNetwork.lanesById.get(successorId);
          if (
            successor?.roadId === lane.roadId &&
            this.roadNetwork.areLaneEndpointsContinuous(lane, successor)
          ) {
            sameRoadSuccessorCount += 1;
          }
        }
      }
      // Most drivers continue along the named street, while one stable quarter
      // retains the original all-successor hash. That minority supplies legal
      // turns into short residential/current-road corridors; an absolute
      // straight preference would make those roads impossible to stream from
      // a hidden upstream portal.
      const prefersSameRoad = routeHash % 4 !== 0;
      if (sameRoadSuccessorCount > 0 && prefersSameRoad) {
        let remainingIndex =
          Math.floor(routeHash / 4) % sameRoadSuccessorCount;
        for (const successorId of lane.successorLaneIds) {
          const successor = this.roadNetwork.lanesById.get(successorId);
          if (
            !successor ||
            successor.roadId !== lane.roadId ||
            !this.roadNetwork.areLaneEndpointsContinuous(lane, successor)
          ) {
            continue;
          }
          if (remainingIndex === 0) return successor;
          remainingIndex -= 1;
        }
      }
      const index =
        (transitionCount + numericId - 1) % lane.successorLaneIds.length;
      return this.roadNetwork.lanesById.get(lane.successorLaneIds[index]) ?? null;
    }
    return lane.loop ? lane : null;
  }

  private nextLaneForNpc(npc: NpcInternal, lane: NormalizedLane): NormalizedLane | null {
    return this.nextLaneForNpcAtTransition(npc, lane, npc.transitionCount);
  }

  /** Exceptional in-place route recovery. Authored successor order is stable;
   * start immediately after this identity's preferred choice and take the
   * first existing endpoint-continuous alternative. No PRNG state or identity
   * changes, and the car remains on the shared endpoint throughout. */
  private deterministicRecoverySuccessor(
    npc: NpcInternal,
    lane: NormalizedLane,
    rejected: NormalizedLane | null,
  ): NormalizedLane | null {
    const successorCount = lane.successorLaneIds.length;
    if (successorCount <= 1) return null;
    const numericId = this.parsedNpcDigits(npc.id) || 1;
    const preferredIndex =
      (npc.transitionCount + numericId - 1) % successorCount;
    for (let offset = 1; offset < successorCount; offset += 1) {
      const successorId =
        lane.successorLaneIds[(preferredIndex + offset) % successorCount];
      const candidate = this.roadNetwork.lanesById.get(successorId);
      if (
        candidate &&
        candidate !== rejected &&
        this.roadNetwork.areLaneEndpointsContinuous(lane, candidate)
      ) {
        return candidate;
      }
    }
    return null;
  }

  /** Closest arclength on one known lane, without the all-lane allocation and
   * scan of `projectToRoad`. Lane-entry safety uses it only at a transition,
   * so a player already occupying the first rendered-car length of the exact
   * successor cannot invite an NPC into the shared junction box. */
  private nearbyPointDistanceAlongLane(
    point: SimulationPoint,
    lane: NormalizedLane,
    maximumLateralDistanceM: number,
  ): number | null {
    let bestDistanceSquared = maximumLateralDistanceM ** 2;
    let bestDistanceAlong = Number.NaN;
    let accumulated = 0;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const start = lane.points[index];
      const end = lane.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount =
        lengthSquared > Number.EPSILON
          ? clamp(
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
              0,
              1,
            )
          : 0;
      const nearestX = start.x + dx * amount;
      const nearestZ = start.z + dz * amount;
      const candidateDistanceSquared =
        (point.x - nearestX) ** 2 + (point.z - nearestZ) ** 2;
      if (candidateDistanceSquared <= bestDistanceSquared) {
        bestDistanceSquared = candidateDistanceSquared;
        bestDistanceAlong = accumulated + lane.segmentLengths[index] * amount;
      }
      accumulated += lane.segmentLengths[index];
    }
    return Number.isFinite(bestDistanceAlong) ? bestDistanceAlong : null;
  }

  private isNpcLaneEntryClear(npc: NpcInternal, target: NormalizedLane): boolean {
    const targetStart = this.roadNetwork.pointOnLane(target, 0);
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    const minimumEntryHeadwayM = NPC_FOLLOW_STANDSTILL_GAP_M + 4;
    for (const other of this.npcsList) {
      if (!other.active || other.id === npc.id) continue;
      if (
        other.successorReservationFromLaneId === other.laneId &&
        other.successorReservationLaneId
      ) {
        const reservedTarget = this.roadNetwork.lanesById.get(
          other.successorReservationLaneId,
        );
        if (reservedTarget) {
          const reservedStart = this.roadNetwork.pointOnLane(reservedTarget, 0);
          if (distanceSquared(reservedStart, targetStart) <= 0.75 ** 2) {
            return false;
          }
        }
      }
      if (other.laneId === target.id && other.distance < minimumEntryHeadwayM) {
        return false;
      }
      if (
        other.targetLaneId === target.id &&
        distanceSquared(other, targetStart) < minimumEntryHeadwayM * minimumEntryHeadwayM
      ) {
        return false;
      }
      if (distanceSquared(other, targetStart) < NPC_LANE_ENTRY_CLEARANCE_M ** 2) {
        const otherLane = this.roadNetwork.lanesById.get(other.laneId);
        if (
          sourceLane &&
          otherLane &&
          this.npcsHaveParallelNonConvergingContinuations(
            npc,
            sourceLane,
            other,
            otherLane,
          )
        ) {
          continue;
        }
        const otherNextLane = otherLane
          ? this.nextLaneForNpc(other, otherLane)
          : null;
        const otherNextStart = otherNextLane
          ? this.roadNetwork.pointOnLane(otherNextLane, 0)
          : null;
        const otherIsEntryContender =
          otherLane !== undefined &&
          otherNextStart !== null &&
          distanceSquared(otherNextStart, targetStart) <= 0.75 ** 2 &&
          otherLane.length - other.distance <=
            NPC_LANE_ENTRY_CLEARANCE_M + 0.5;
        if (!otherIsEntryContender || !sourceLane) return false;
        const ownsSharedEndpoint = this.npcOwnsSharedEndpoint(
          npc,
          sourceLane,
          other,
          otherLane,
          NPC_LANE_ENTRY_CLEARANCE_M + 0.5,
        );
        if (ownsSharedEndpoint !== true) return false;
        // This stable identity owns the shared endpoint. The continuous
        // swept-body check still owns physical clearance; once it enters
        // `target`, the ordinary target-lane headway blocks the loser.
        continue;
      }
    }
    const playerDistanceAlongTarget = this.nearbyPointDistanceAlongLane(
      this.playerState.player,
      target,
      target.width * 0.5 + this.config.playerRadiusM,
    );
    if (
      playerDistanceAlongTarget !== null &&
      playerDistanceAlongTarget < minimumEntryHeadwayM
    ) {
      return false;
    }
    return (
      distanceSquared(this.playerState.player, targetStart) >=
      (this.config.playerRadiusM + NPC_RADIUS_METRES + 4) ** 2
    );
  }

  /** Exact deterministic narrow phase for NPC following. The spatial index
   * deliberately marks every topologically reachable branch, but a driver
   * must brake only for the branch its identity/temporary destination will
   * actually take. Player road-rule queries retain RoadNetwork's existential
   * graph search because they have no NPC route identity. */
  private npcRouteDistanceAhead(
    routeOwner: NpcInternal,
    fromLane: NormalizedLane,
    fromDistance: number,
    targetLane: NormalizedLane,
    targetDistance: number,
  ): number {
    const direct =
      fromLane.id === targetLane.id
        ? this.roadNetwork.distanceAhead(fromLane, fromDistance, targetDistance)
        : Number.POSITIVE_INFINITY;
    if (Number.isFinite(direct)) return direct;

    let lane = fromLane;
    let distance = clamp(fromDistance, 0, lane.length);
    let travelled = 0;
    let transitionCount = routeOwner.transitionCount;
    let routeGoalRemainingHops = routeOwner.localityRouteGoalRemainingHops;
    let routePlanCursor = routeOwner.localityRoutePlanCursor;
    for (let depth = 0; depth < ROUTE_LOOKAHEAD_MAX_HOPS; depth += 1) {
      travelled += Math.max(0, lane.length - distance);
      if (travelled > ROUTE_LOOKAHEAD_LIMIT_M) return Number.POSITIVE_INFINITY;
      const nextLane = this.nextLaneForNpcAtTransition(
        routeOwner,
        lane,
        transitionCount,
        routeOwner.localityRouteGoal,
        routeGoalRemainingHops,
        routePlanCursor,
      );
      if (
        !nextLane ||
        !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)
      ) {
        return Number.POSITIVE_INFINITY;
      }
      if (nextLane.id === targetLane.id) {
        const result = travelled + Math.max(0, targetDistance);
        return result <= ROUTE_LOOKAHEAD_LIMIT_M
          ? result
          : Number.POSITIVE_INFINITY;
      }
      transitionCount += 1;
      if (routeGoalRemainingHops > 0) routeGoalRemainingHops -= 1;
      if (routePlanCursor < routeOwner.localityRoutePlanLaneIndices.length) {
        routePlanCursor += 1;
      }
      lane = nextLane;
      distance = 0;
    }
    return Number.POSITIVE_INFINITY;
  }

  /** Public: simulation.ts's roadRuleMonitor calls this for the player's own
   * following-distance check (with no `excludedNpcId`, so the player's own
   * gate through `ctx.roadState.projection` is never folded in). */
  leadVehicleGap(
    lane: NormalizedLane,
    distance: number,
    ctx: TrafficTickCtx,
    excludedNpcId?: string,
  ): number | null {
    let best = Number.POSITIVE_INFINITY;
    const routeOwnerSlot = excludedNpcId
      ? this.numericNpcId(excludedNpcId) - 1
      : -1;
    const routeOwner =
      routeOwnerSlot >= 0 &&
      this.npcsList[routeOwnerSlot]?.id === excludedNpcId
        ? this.npcsList[routeOwnerSlot]
        : undefined;
    // The lane-topology index deliberately marks a conservative superset, then
    // this unchanged exact check preserves the route, loop, and target-lane
    // semantics the old global scan had. Consume marks in slot order rather
    // than linked-list or Map order so the deterministic tie break is intact.
    this.trafficSpatialIndex.collectRouteLeadingCandidates(lane, distance);
    for (let slotIndex = 0; slotIndex < this.npcsList.length; slotIndex += 1) {
      if (!this.trafficSpatialIndex.isMarked(slotIndex)) continue;
      const npc = this.npcsList[slotIndex];
      if (!npc.active || npc.id === excludedNpcId) continue;
      const npcLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!npcLane) continue;
      this.leadCandidateCount += 1;
      const gap = routeOwner
        ? this.npcRouteDistanceAhead(
            routeOwner,
            lane,
            distance,
            npcLane,
            npc.distance,
          )
        : this.roadNetwork.routeDistanceAhead(
            lane,
            distance,
            npcLane,
            npc.distance,
          );
      this.leadExactRouteCheckCount += 1;
      if (gap > 0.1 && gap < best) best = gap;
    }
    const playerProjection = ctx.roadState.projection;
    if (excludedNpcId && playerProjection && playerProjection.distance < playerProjection.lane.width) {
      this.leadExactRouteCheckCount += 1;
      const playerGap = routeOwner
        ? this.npcRouteDistanceAhead(
            routeOwner,
            lane,
            distance,
            playerProjection.lane,
            playerProjection.distanceAlong,
          )
        : this.roadNetwork.routeDistanceAhead(
            lane,
            distance,
            playerProjection.lane,
            playerProjection.distanceAlong,
          );
      if (playerGap > 0.1 && playerGap < best) best = playerGap;
    }
    return Number.isFinite(best) ? best : null;
  }

  /** Public: simulation.ts's roadRuleMonitor uses this to find who the
   * player is obstructing in a passing lane. */
  followingNpc(lane: NormalizedLane, playerDistance: number): { npc: NpcInternal; gap: number } | null {
    let result: { npc: NpcInternal; gap: number } | null = null;
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      const npcLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!npcLane) continue;
      // The player has no route identity, but every NPC does. Only a vehicle
      // whose own deterministic/materialized route actually reaches the
      // player's lane is a follower; an existential branch match made cars on
      // a different fork look like passing-lane obstructions.
      const gap = this.npcRouteDistanceAhead(
        npc,
        npcLane,
        npc.distance,
        lane,
        playerDistance,
      );
      if (gap <= 0.1 || gap > 80) continue;
      if (!result || gap < result.gap) result = { npc, gap };
    }
    return result;
  }

  private redLightGapForLane(lane: NormalizedLane, distance: number, ctx: TrafficTickCtx): number | null {
    const laneStopLines = this.roadNetwork.stopLinesByLaneId.get(lane.id);
    if (!laneStopLines) return null;
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of laneStopLines) {
      if (
        (stopLine.kind !== "traffic_light" && stopLine.kind !== "railway") ||
        !stopLine.trafficLightId
      ) {
        continue;
      }
      const light = this.roadNetwork.trafficLightsById.get(stopLine.trafficLightId);
      if (!light || this.roadNetwork.trafficLightTiming(light, ctx.elapsedSeconds).state === "green") continue;
      const gap = this.roadNetwork.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private yieldGapForLane(lane: NormalizedLane, distance: number): number | null {
    const laneStopLines = this.roadNetwork.stopLinesByLaneId.get(lane.id);
    if (!laneStopLines) return null;
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of laneStopLines) {
      if (stopLine.kind !== "yield") continue;
      const linePose = this.roadNetwork.pointOnLane(lane, stopLine.distance);
      const conflictRadius = stopLine.conflictRadius ?? 12;
      // The driver's right-hand normal at the bar, for the roundabout case
      // below. Same convention as everywhere else: heading 0 is +z.
      const rightX = Math.cos(linePose.heading);
      const rightZ = -Math.sin(linePose.heading);
      const hasConflict = this.npcsList.some((other) => {
        if (!other.active || other.laneId === lane.id) return false;
        if (distanceSquared(other, linePose) >= conflictRadius * conflictRadius) {
          return false;
        }
        if (!stopLine.roundaboutYieldFrom) return true;
        // A roundabout entry gives way to the *circulating* stream only.
        // Traffic queueing on the arm opposite, or crossing somewhere else
        // inside the radius, is not what holds a driver at a give-way line.
        const otherLane = this.roadNetwork.lanesById.get(other.laneId);
        if (otherLane?.kind !== "roundabout") return false;
        // ...and only from the side the country's roundabouts circulate
        // from. The small negative allowance keeps a car level with the mouth
        // — already committed across it — in the hold rather than letting an
        // entering driver cut in beside it.
        const side =
          (other.x - linePose.x) * rightX + (other.z - linePose.z) * rightZ;
        return stopLine.roundaboutYieldFrom === "right"
          ? side > -ROUNDABOUT_YIELD_SIDE_ALLOWANCE_M
          : side < ROUNDABOUT_YIELD_SIDE_ALLOWANCE_M;
      });
      if (!hasConflict) continue;
      const gap = this.roadNetwork.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private isNpcLaneChangeClear(npc: NpcInternal, targetLane: NormalizedLane, ctx: TrafficTickCtx): boolean {
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const targetDistance = (npc.distance / sourceLane.length) * targetLane.length;
    const npcClear = this.npcsList.every((other) => {
      if (!other.active || other.id === npc.id) return true;
      if (other.targetLaneId === targetLane.id && distanceSquared(other, npc) < 24 * 24) {
        return false;
      }
      if (other.laneId !== targetLane.id) return true;
      const forward = this.roadNetwork.distanceAhead(targetLane, targetDistance, other.distance);
      const backward = this.roadNetwork.distanceAhead(targetLane, other.distance, targetDistance);
      return forward > 15 && backward > 11;
    });
    if (!npcClear) return false;
    const playerProjection = ctx.roadState.projection;
    if (
      !playerProjection ||
      playerProjection.lane.id !== targetLane.id ||
      playerProjection.distance >= targetLane.width
    ) {
      return true;
    }
    const forward = this.roadNetwork.distanceAhead(
      targetLane,
      targetDistance,
      playerProjection.distanceAlong,
    );
    const backward = this.roadNetwork.distanceAhead(
      targetLane,
      playerProjection.distanceAlong,
      targetDistance,
    );
    return forward > 16 && backward > 13;
  }

  /** Public: simulation.ts's roadRuleMonitor uses this to check the player
   * has a safe gap to pull back into the travel lane. */
  isPlayerLaneChangeClear(targetLane: NormalizedLane, normalizedDistance: number): boolean {
    const targetDistance = normalizedDistance * targetLane.length;
    return this.npcsList.every((npc) => {
      if (!npc.active) return true;
      const npcDistance = this.npcDistanceOnLane(npc, targetLane);
      if (npcDistance === null) return true;
      const forward = this.roadNetwork.distanceAhead(targetLane, targetDistance, npcDistance);
      const backward = this.roadNetwork.distanceAhead(targetLane, npcDistance, targetDistance);
      return forward > 16 && backward > 13;
    });
  }

  private npcDistanceOnLane(npc: NpcInternal, targetLane: NormalizedLane): number | null {
    if (npc.laneId === targetLane.id) return npc.distance;
    if (npc.targetLaneId !== targetLane.id) return null;
    const sourceLane = this.roadNetwork.lanesById.get(npc.laneId);
    if (!sourceLane) return null;
    return clamp(npc.distance / sourceLane.length, 0, 1) * targetLane.length;
  }

  reflowTrafficAroundPlayer(ctx: TrafficTickCtx): void {
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      const gate: NormalizedTrafficGate = {
        id: `reflow-${npc.id}`,
        laneId: npc.laneId,
        distance: npc.distance,
        desiredSpeedMps: npc.desiredSpeedMps,
        allowInitialSpawn: true,
      };
      if (!this.isTrafficGateSafe(npc, gate, true, ctx)) this.requestNpcRecycle(npc, ctx);
    }
    this.makeTrafficDecisions(ctx);
  }
}
