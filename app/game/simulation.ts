/**
 * Deterministic, renderer-agnostic simulation for SideSwap.
 *
 * This module deliberately has no React, DOM, audio, or Babylon dependencies.
 * Consumers provide normalized inputs and render the serializable snapshots.
 */
import type {
  Gear,
  LaneRestriction,
  RestrictionWindow,
  RuleCode,
  RuleEvent,
  ScenarioClock,
  SpeedUnit,
  StaticObstacle,
  StaticObstacleTag,
  TrafficSide,
} from "./types";

export const SIMULATION_HZ = 60;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;

const TRAFFIC_DECISION_SECONDS = 0.1;
const MAX_FRAME_SECONDS = 0.25;
const PLAYER_RADIUS_METRES = 1.05;
const NPC_RADIUS_METRES = 1.0;
const NPC_MIN_BUMPER_CLEARANCE_M = 3;
// Historically PLAYER_RADIUS + NPC_RADIUS + 4 — pinned to that value: this
// gap spaces NPCs behind OTHER NPCS, so it must not stretch or shrink with
// whatever the player happens to be driving.
const NPC_FOLLOW_STANDSTILL_GAP_M = 6.05;
const NPC_LANE_CHANGE_DISTANCE_M = 12;
/**
 * How far along the route ahead `routeDistanceAhead` will look before giving
 * up and calling a car "not ahead of me".
 *
 * Every consumer of that distance is a following-gap test, and the widest is a
 * car at top speed wanting its standstill gap plus 1.8 s of headway — under
 * 62 m. The traffic-gate headway check and the player's own following-distance
 * rule are both smaller again, and `followingNpc` discards anything past 80 m
 * outright. This is set several times over the largest of them, so it prunes
 * the search without any caller being able to tell.
 */
const ROUTE_LOOKAHEAD_LIMIT_M = 240;
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
const NPC_INCIDENT_KNOCK_RAD = 0.16;
// A car the player crashes into sits knocked askew and holds position this
// long (in ticks) before pulling away again; behind it the ordinary jam
// machinery clears any pile-up exactly as for NPC-NPC knocks.
const NPC_STRUCK_TICKS = 360;
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
// The static world resolves against a two-circle capsule rather than the
// single traffic disc: the visible car is ~4.4 m long, and one centre circle
// would let the bonnet bury itself a metre deep into a facade before contact.
const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
const PLAYER_CAPSULE_RADIUS_M = 1.0;
// Below this normal approach speed a wall contact is a silent scrape (still
// resolved, never penalised); above it a collision event is emitted.
const STATIC_IMPACT_EVENT_MIN_MPS = 2;
// Near-head-on contacts (approach direction mostly into the wall) rebound
// slightly instead of sliding: an arcade "bonk" that reads as a crash without
// ping-ponging the car around on touch controls.
const STATIC_BONK_DOT = 0.72;
const STATIC_BONK_MIN_MPS = 6;
const STATIC_BONK_REBOUND_FRACTION = 0.08;
const STATIC_BONK_REBOUND_MAX_MPS = 1.2;
// Scraping a wall bleeds speed at this per-second rate scaled by how head-on
// the contact is. The push-out already cancels the into-wall displacement, so
// a shallow graze keeps most of its pace while a 45° grind slows hard —
// applied per fixed step, it must stay a rate, never a flat factor.
const STATIC_SCRAPE_FRICTION_PER_S = 3.5;
// Never recycle (vanish) a jammed car this close to the player; hold it visible
// until they have moved on, so traffic never pops out of existence beside them.
const NPC_INCIDENT_PLAYER_CLEARANCE_M = 26;
const INITIAL_PLAYER_CLEARANCE_AHEAD_M = 20;
const INITIAL_CROSS_LANE_CLEARANCE_M = 12;
const SPAWN_PREDICTION_SECONDS = 4;
export const RUNTIME_FORWARD_VISIBILITY_DISTANCE_M = 180;
export const RUNTIME_REAR_VISIBILITY_DISTANCE_M = 115;
const RUNTIME_FORWARD_HALF_ANGLE_RAD = (58 * Math.PI) / 180;
const RUNTIME_REAR_HALF_ANGLE_RAD = (42 * Math.PI) / 180;
const STOPPED_SPEED_MPS = 0.2;
const MAX_EVENT_HISTORY = 80;

export type SimulationRuleEvent = RuleEvent;
export type SimulationStatus = "running" | "paused" | "disposed";
export type TurnSignal = "off" | "left" | "right";
export type LaneRole = "travel" | "passing" | "entry" | "exit";
export type LaneKind = "road" | "roundabout" | "merge";
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
export type TrafficLightState =
  | "green"
  | "amber"
  | "all_red"
  | "red"
  | "red_amber";
export type TrafficLightSequence = "standard" | "uk";
// "police" is gate-assigned only (a named spawn gate), never rolled by
// randomVehicleVariant — the simulation treats it exactly like a car and the
// renderer dresses it as a patrol.
export type NpcVehicleVariant = "car" | "taxi" | "bus" | "van" | "police";

export interface SimulationPoint {
  readonly x: number;
  readonly z: number;
}

export interface SimulationPose extends SimulationPoint {
  /** Radians, with zero pointing toward positive Z. */
  readonly heading: number;
}

export interface SimulationLane {
  readonly id: string;
  /** Points are ordered in the legal direction of travel. */
  readonly points: readonly SimulationPoint[];
  readonly width?: number;
  readonly role?: LaneRole;
  readonly kind?: LaneKind;
  readonly speedLimitMps?: number;
  readonly adjacentLaneId?: string;
  /** Legal lanes an NPC may enter after reaching this lane's end. */
  readonly successorLaneIds?: readonly string[];
  readonly loop?: boolean;
}

export interface SimulationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface TrafficLightCycle {
  readonly greenSeconds: number;
  readonly amberSeconds: number;
  /** Clearance period after amber in which every approach is red. */
  readonly allRedSeconds: number;
  readonly redSeconds: number;
  /** UK pre-green red-and-amber period; ignored by standard sequences. */
  readonly redAmberSeconds: number;
  readonly offsetSeconds?: number;
  readonly sequence: TrafficLightSequence;
}

export interface TrafficLightDefinition extends SimulationPoint {
  readonly id: string;
  /** Lights in one approach share a phase-group identifier. */
  readonly phaseGroup?: string;
  readonly cycle?: Partial<TrafficLightCycle>;
}

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

export interface StopLineDefinition {
  readonly id: string;
  readonly laneId: string;
  /** Distance in metres from the beginning of the lane. */
  readonly distance: number;
  readonly kind: "traffic_light" | "railway" | "stop" | "yield";
  readonly trafficLightId?: string;
  readonly turnDirection?: Exclude<TurnSignal, "off">;
  readonly conflictRadius?: number;
}

/** A renderer-neutral box-junction conflict zone authored in world metres. */
export interface SimulationBoxJunctionDefinition {
  readonly id: string;
  readonly polygon: readonly SimulationPoint[];
  /** Lanes that pass through the box. */
  readonly laneIds: readonly string[];
  /** Lanes immediately beyond the box; defaults to `laneIds`. */
  readonly exitLaneIds?: readonly string[];
  /** How far beyond the polygon an occupied exit counts as blocked. */
  readonly exitClearanceM?: number;
}

export interface SimulationCoreConfig {
  readonly trafficSide?: TrafficSide;
  readonly speedUnit?: SpeedUnit;
  readonly seed?: number;
  readonly scenarioId?: string;
  readonly lanes?: readonly SimulationLane[];
  readonly bounds?: SimulationBounds;
  readonly spawn?: SimulationPose;
  readonly trafficLights?: readonly TrafficLightDefinition[];
  readonly stopLines?: readonly StopLineDefinition[];
  readonly trafficGates?: readonly SimulationTrafficGate[];
  /** Minimum player-to-gate distance for deferred runtime activation. */
  readonly minRuntimeSpawnDistanceM?: number;
  /** Fixed authored time used for signed, time-based restrictions. */
  readonly scenarioClock?: ScenarioClock;
  readonly laneRestrictions?: readonly LaneRestriction[];
  readonly boxJunctions?: readonly SimulationBoxJunctionDefinition[];
  readonly npcCount?: number;
  readonly maxForwardSpeedMps?: number;
  readonly maxReverseSpeedMps?: number;
  /**
   * Player vehicle physics. Every field is optional and defaults to the
   * long-standing literals, so omitting them (free drive, every existing
   * test) is behaviourally identical to before they existed — that identity
   * is what keeps the deterministic acceptance replay green. Career Mode
   * passes a full set per rented vehicle.
   */
  readonly forwardAccelMps2?: number;
  readonly reverseAccelMps2?: number;
  readonly brakeBaseMps2?: number;
  readonly brakeStrengthMps2?: number;
  readonly dragBaseMps2?: number;
  readonly dragPerMps?: number;
  readonly steerBaseRate?: number;
  readonly steerAuthorityRate?: number;
  readonly steerAuthoritySpeedMps?: number;
  readonly instabilityLateralMps2?: number;
  readonly playerRadiusM?: number;
  readonly playerCapsuleHalfLengthM?: number;
  readonly playerCapsuleRadiusM?: number;
  /**
   * Solid world geometry (buildings, venue lots, world edges) the player car
   * is resolved against every step. Plain data from the adapter; omitting it
   * leaves the world open for focused physics tests.
   */
  readonly staticObstacles?: readonly StaticObstacle[];
}

export interface SimulationInput {
  /** Accelerator pressure from 0 to 1. */
  readonly throttle?: number;
  /** Brake pressure from 0 to 1. The brake alone never selects reverse. */
  readonly brake?: number;
  /**
   * Reverse pedal from 0 to 1 — "I want to go backwards". While the car is
   * still rolling forwards this brakes it; from a standstill it pulls away in
   * reverse, so one key covers both without the driver selecting a gear.
   */
  readonly reverse?: number;
  /** Steering from -1 (left) to 1 (right). */
  readonly steer?: number;
  /** Current player look direction in world radians, used to hide runtime spawns. */
  readonly viewHeading?: number;
  /** Edge-triggered actions. Holding them does not repeatedly toggle. */
  readonly toggleGear?: boolean;
  readonly selectDrive?: boolean;
  readonly selectReverse?: boolean;
  readonly signalLeft?: boolean;
  readonly signalRight?: boolean;
  readonly cancelSignal?: boolean;
  readonly horn?: boolean;
  readonly pause?: boolean;
  readonly reset?: boolean;
}

export interface PlayerSimulationSnapshot extends SimulationPose {
  readonly speedMps: number;
  readonly signedSpeedMps: number;
  readonly gear: Gear;
  readonly signal: TurnSignal;
  readonly hornActive: boolean;
  readonly canChangeGear: boolean;
  readonly distanceTravelledM: number;
}

export interface NpcSimulationSnapshot extends SimulationPose {
  readonly id: string;
  readonly laneId: string;
  readonly variant: NpcVehicleVariant;
  readonly speedMps: number;
  readonly state: NpcDrivingState;
  readonly signal: TurnSignal;
  readonly honking: boolean;
}

export interface TrafficLightSnapshot extends SimulationPoint {
  readonly id: string;
  readonly phaseGroup: string;
  readonly state: TrafficLightState;
  readonly secondsUntilChange: number;
}

export interface SimulationRoadSnapshot {
  readonly laneId: string | null;
  readonly laneRole: LaneRole | null;
  readonly distanceFromLaneCentreM: number;
  readonly speedLimitMps: number;
  readonly speedLimitDisplay: number;
  readonly onCorrectSide: boolean;
  readonly wrongWay: boolean;
  readonly offRoad: boolean;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly scenarioId: string;
  readonly status: SimulationStatus;
  readonly trafficSide: TrafficSide;
  readonly speedUnit: SpeedUnit;
  readonly scenarioClock: ScenarioClock | null;
  readonly speedDisplay: number;
  readonly player: PlayerSimulationSnapshot;
  readonly road: SimulationRoadSnapshot;
  readonly npcs: readonly NpcSimulationSnapshot[];
  /** NPCs retained deterministically until an authored gate becomes safe. */
  readonly queuedNpcCount: number;
  readonly trafficLights: readonly TrafficLightSnapshot[];
  readonly honk: Readonly<{
    active: boolean;
  }>;
}

interface MutablePose {
  x: number;
  z: number;
  heading: number;
}

interface NormalizedLane {
  id: string;
  points: SimulationPoint[];
  width: number;
  role: LaneRole;
  kind: LaneKind;
  speedLimitMps: number;
  adjacentLaneId?: string;
  successorLaneIds: string[];
  loop: boolean;
  segmentLengths: number[];
  length: number;
  /** Position in SimulationCore.lanes, stamped in the constructor — lets
   * hot paths key typed arrays by lane without a map lookup. */
  index?: number;
}

interface NormalizedTrafficLight extends SimulationPoint {
  id: string;
  phaseGroup: string;
  cycle: TrafficLightCycle;
}

interface NormalizedTrafficGate {
  id: string;
  laneId: string;
  distance: number;
  variant?: NpcVehicleVariant;
  desiredSpeedMps?: number;
  allowInitialSpawn: boolean;
}

interface LaneProjection {
  lane: NormalizedLane;
  distance: number;
  distanceAlong: number;
  heading: number;
  x: number;
  z: number;
}

interface NpcInternal extends MutablePose {
  id: string;
  laneId: string;
  variant: NpcVehicleVariant;
  active: boolean;
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

interface ContinuousInput {
  throttle: number;
  brake: number;
  reverse: number;
  steer: number;
}

interface InternalConfig {
  trafficSide: TrafficSide;
  speedUnit: SpeedUnit;
  seed: number;
  scenarioId: string;
  bounds: SimulationBounds;
  spawn: SimulationPose;
  scenarioClock: ScenarioClock | null;
  npcCount: number;
  minRuntimeSpawnDistanceM: number;
  maxForwardSpeedMps: number;
  maxReverseSpeedMps: number;
  forwardAccelMps2: number;
  reverseAccelMps2: number;
  brakeBaseMps2: number;
  brakeStrengthMps2: number;
  dragBaseMps2: number;
  dragPerMps: number;
  steerBaseRate: number;
  steerAuthorityRate: number;
  steerAuthoritySpeedMps: number;
  instabilityLateralMps2: number;
  playerRadiusM: number;
  playerCapsuleHalfLengthM: number;
  playerCapsuleRadiusM: number;
}

interface RoadState {
  projection: LaneProjection | null;
  wrongWay: boolean;
  offRoad: boolean;
}

/**
 * A solid obstacle normalized for the 60 Hz narrow phase: boxes become
 * centre + explicit U/V axes (an AABB is just an axis-aligned OBB), circles
 * keep a radius, and every entry carries broad-phase reject bounds already
 * inflated by the capsule reach so the hot loop is one rectangle test.
 */
interface StaticObstacleInternal {
  readonly id: string;
  readonly tag: StaticObstacleTag;
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
  readonly radius: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const STATIC_OBSTACLE_CORRECTIONS: Readonly<Record<StaticObstacleTag, string>> = {
  building: "Brake earlier and keep to the carriageway.",
  landmark: "Brake earlier and keep to the carriageway.",
  venue: "Brake earlier and keep to the carriageway.",
  shoreline: "Follow the carriageway onto an authored bridge.",
  parkEdge: "Enter the park through one of its gates.",
  worldEdge: "Turn back toward the streets.",
};

function normalizeStaticObstacle(
  obstacle: StaticObstacle,
  inflateM: number,
): StaticObstacleInternal {
  if (obstacle.kind === "circle") {
    return {
      id: obstacle.id,
      tag: obstacle.tag,
      x: obstacle.x,
      z: obstacle.z,
      ux: 1,
      uz: 0,
      halfU: 0,
      halfV: 0,
      radius: Math.max(0, obstacle.radius),
      minX: obstacle.x - obstacle.radius - inflateM,
      maxX: obstacle.x + obstacle.radius + inflateM,
      minZ: obstacle.z - obstacle.radius - inflateM,
      maxZ: obstacle.z + obstacle.radius + inflateM,
    };
  }
  if (obstacle.kind === "aabb") {
    return {
      id: obstacle.id,
      tag: obstacle.tag,
      x: (obstacle.minX + obstacle.maxX) / 2,
      z: (obstacle.minZ + obstacle.maxZ) / 2,
      ux: 1,
      uz: 0,
      halfU: Math.max(0, (obstacle.maxX - obstacle.minX) / 2),
      halfV: Math.max(0, (obstacle.maxZ - obstacle.minZ) / 2),
      radius: 0,
      minX: obstacle.minX - inflateM,
      maxX: obstacle.maxX + inflateM,
      minZ: obstacle.minZ - inflateM,
      maxZ: obstacle.maxZ + inflateM,
    };
  }
  const axisLength = Math.hypot(obstacle.ux, obstacle.uz) || 1;
  const ux = obstacle.ux / axisLength;
  const uz = obstacle.uz / axisLength;
  const reach =
    Math.abs(ux) * obstacle.halfU + Math.abs(uz) * obstacle.halfV;
  const reachZ =
    Math.abs(uz) * obstacle.halfU + Math.abs(ux) * obstacle.halfV;
  return {
    id: obstacle.id,
    tag: obstacle.tag,
    x: obstacle.x,
    z: obstacle.z,
    ux,
    uz,
    halfU: Math.max(0, obstacle.halfU),
    halfV: Math.max(0, obstacle.halfV),
    radius: 0,
    minX: obstacle.x - reach - inflateM,
    maxX: obstacle.x + reach + inflateM,
    minZ: obstacle.z - reachZ - inflateM,
    maxZ: obstacle.z + reachZ + inflateM,
  };
}

const RULE_COOLDOWNS: Readonly<Partial<Record<RuleCode, number>>> = {
  speeding: 8,
  following_distance: 7,
  lane_misuse: 12,
  box_junction: 10,
  restricted_lane: 12,
  missing_indicator: 5,
  incomplete_stop: 5,
  unsafe_gap: 5,
  observation: 8,
  // Grinding along a wall or a knocked car re-contacts every step; one event
  // per contact burst is what the damage/fine layers upstream want to see.
  collision: 2.5,
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function moveTowards(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function angleDifference(a: number, b: number): number {
  return wrapAngle(a - b);
}

function lerpAngle(a: number, b: number, amount: number): number {
  return wrapAngle(a + angleDifference(b, a) * amount);
}

function approachAngle(current: number, target: number, maxStep: number): number {
  const difference = angleDifference(target, current);
  if (Math.abs(difference) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(difference) * maxStep);
}

function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceSquared(a: SimulationPoint, b: SimulationPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Returns whether a signed restriction window is active at the fixed scenario time. */
export function isRestrictionWindowActive(
  clock: ScenarioClock,
  window: RestrictionWindow,
): boolean {
  if (
    !Number.isFinite(clock.minutesAfterMidnight) ||
    clock.minutesAfterMidnight < 0 ||
    clock.minutesAfterMidnight >= 24 * 60 ||
    !Number.isFinite(window.startMinutes) ||
    !Number.isFinite(window.endMinutes)
  ) {
    return false;
  }
  const start = clamp(window.startMinutes, 0, 24 * 60);
  const end = clamp(window.endMinutes, 0, 24 * 60);
  const todayIsSigned = window.weekdays.includes(clock.weekday);
  if (start === end) return todayIsSigned;
  if (start < end) {
    return todayIsSigned && clock.minutesAfterMidnight >= start && clock.minutesAfterMidnight < end;
  }

  // Overnight restrictions start on the signed weekday and remain active after
  // midnight on the following day.
  const weekdayIndex = WEEKDAYS.indexOf(clock.weekday);
  const previousWeekday = WEEKDAYS[(weekdayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length];
  return (
    (todayIsSigned && clock.minutesAfterMidnight >= start) ||
    (window.weekdays.includes(previousWeekday) && clock.minutesAfterMidnight < end)
  );
}

export function isLaneRestrictionActive(
  restriction: LaneRestriction,
  clock: ScenarioClock | null | undefined,
): boolean {
  return Boolean(
    clock &&
      restriction.activeWindows.some((window) =>
        isRestrictionWindowActive(clock, window),
      ),
  );
}

/** Boundary points count as inside so entry detection is stable at 60 Hz. */
export function isPointInPolygon(
  point: SimulationPoint,
  polygon: readonly SimulationPoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (
      distanceToSegmentSquared(
        point.x,
        point.z,
        start.x,
        start.z,
        end.x,
        end.z,
      ) <= 1e-8
    ) {
      return true;
    }
    const crosses =
      (end.z > point.z) !== (start.z > point.z) &&
      point.x <
        ((start.x - end.x) * (point.z - end.z)) / (start.z - end.z) + end.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(
  point: SimulationPoint,
  polygon: readonly SimulationPoint[],
): number {
  if (isPointInPolygon(point, polygon)) return 0;
  let bestSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    bestSquared = Math.min(
      bestSquared,
      distanceToSegmentSquared(
        point.x,
        point.z,
        start.x,
        start.z,
        end.x,
        end.z,
      ),
    );
  }
  return Math.sqrt(bestSquared);
}

function distanceToSegmentSquared(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    const px = pointX - startX;
    const pz = pointZ - startZ;
    return px * px + pz * pz;
  }
  const amount = clamp(
    ((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSquared,
    0,
    1,
  );
  const nearestX = startX + dx * amount;
  const nearestZ = startZ + dz * amount;
  const px = pointX - nearestX;
  const pz = pointZ - nearestZ;
  return px * px + pz * pz;
}

function normalizeSeed(seed: number | undefined): number {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed as number) >>> 0 : 1;
  return normalized || 0x6d2b79f5;
}

function normalizeLane(lane: SimulationLane): NormalizedLane {
  const points = lane.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    .map((point) => ({ x: point.x, z: point.z }));
  if (points.length < 2) {
    throw new Error(`Simulation lane "${lane.id}" needs at least two finite points.`);
  }
  const segmentLengths: number[] = [];
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = Math.sqrt(distanceSquared(points[index], points[index + 1]));
    segmentLengths.push(segmentLength);
    length += segmentLength;
  }
  if (length <= Number.EPSILON) {
    throw new Error(`Simulation lane "${lane.id}" has no usable length.`);
  }
  return {
    id: lane.id,
    points,
    width: clamp(lane.width ?? 3.5, 2.4, 8),
    role: lane.role ?? "travel",
    kind: lane.kind ?? "road",
    speedLimitMps: clamp(lane.speedLimitMps ?? 13.4, 2, 45),
    adjacentLaneId: lane.adjacentLaneId,
    successorLaneIds: [...(lane.successorLaneIds ?? [])],
    loop: lane.loop ?? true,
    segmentLengths,
    length,
  };
}

function buildConflictApproachLaneIds(
  lanes: readonly NormalizedLane[],
): Set<string> {
  const result = new Set<string>();
  for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
    const left = lanes[leftIndex];
    const leftEnd = left.points[left.points.length - 1];
    for (let rightIndex = leftIndex + 1; rightIndex < lanes.length; rightIndex += 1) {
      const right = lanes[rightIndex];
      const rightEnd = right.points[right.points.length - 1];
      if (distanceSquared(leftEnd, rightEnd) > 0.75 * 0.75) continue;
      result.add(left.id);
      result.add(right.id);
    }
  }
  return result;
}

function normalizeTrafficLight(
  light: TrafficLightDefinition,
): NormalizedTrafficLight {
  return {
    id: light.id,
    phaseGroup: light.phaseGroup ?? light.id,
    x: light.x,
    z: light.z,
    cycle: {
      greenSeconds: clamp(light.cycle?.greenSeconds ?? 9, 1, 120),
      amberSeconds: clamp(light.cycle?.amberSeconds ?? 2, 0.5, 10),
      allRedSeconds: clamp(light.cycle?.allRedSeconds ?? 0, 0, 10),
      redSeconds: clamp(light.cycle?.redSeconds ?? 9, 1, 120),
      redAmberSeconds: clamp(light.cycle?.redAmberSeconds ?? 0, 0, 10),
      offsetSeconds: light.cycle?.offsetSeconds ?? 0,
      sequence: light.cycle?.sequence ?? "standard",
    },
  };
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

/**
 * A fixed-step arcade driving simulation. `step` may receive render-frame delta
 * times; the core internally advances at exactly 60 Hz and makes traffic
 * decisions at exactly 10 Hz.
 */
export class SimulationCore {
  readonly fixedStepSeconds = FIXED_STEP_SECONDS;

  private readonly config: InternalConfig;
  private readonly lanes: NormalizedLane[];
  private readonly lanesById: Map<string, NormalizedLane>;
  private readonly conflictApproachLaneIds: Set<string>;
  private readonly trafficLights: NormalizedTrafficLight[];
  private readonly trafficLightsById: Map<string, NormalizedTrafficLight>;
  private readonly stopLines: StopLineDefinition[];
  private readonly stopLinesByLaneId: Map<string, StopLineDefinition[]>;
  // routeDistanceAhead scratch. The search runs for every pair of cars,
  // every step (~61k/s at 32 cars) and used to allocate a queue array, a
  // visited Map and a node literal per pushed lane — over a million
  // short-lived objects a second, pure GC feed. The queue is now three
  // parallel arrays walked by a moving head (no shift() memmove); visited is
  // a generation-stamped pair keyed by lane.index, cleared by bumping the
  // generation (pre-incremented per call, so the post-reset zero can never
  // read as visited). Traversal order and float comparisons are identical
  // to the old form — the acceptance trace hash pins that.
  private readonly routeQueueLanes: NormalizedLane[] = [];
  private readonly routeQueueDistances: number[] = [];
  private readonly routeQueueDepths: number[] = [];
  private routeVisitedGeneration = new Float64Array(0);
  private routeVisitedBest = new Float64Array(0);
  private routeSearchGeneration = 0;
  /** Memo for parsedNpcDigits; NPC ids are stable within a session. */
  private readonly npcDigitCache = new Map<string, number>();
  private readonly trafficGates: NormalizedTrafficGate[];
  private readonly laneRestrictions: LaneRestriction[];
  private readonly boxJunctions: SimulationBoxJunctionDefinition[];
  private readonly staticObstacles: StaticObstacleInternal[];
  private readonly initialSeed: number;

  private random: SeededRandom;
  private player: MutablePose;
  private signedSpeedMps = 0;
  private gear: Gear = "drive";
  private signal: TurnSignal = "off";
  private signalStartHeading = 0;
  private signalAutoCancelSeconds = 0;
  private continuousInput: ContinuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
  private viewHeading = 0;
  private previousActions: Record<string, boolean> = {};
  private accumulatorSeconds = 0;
  private trafficDecisionAccumulator = 0;
  private elapsedSeconds = 0;
  private tick = 0;
  private status: SimulationStatus = "running";
  private disposed = false;
  private npcs: NpcInternal[] = [];
  private events: SimulationRuleEvent[] = [];
  private ruleCooldowns = new Map<RuleCode, number>();
  private roadState: RoadState = {
    projection: null,
    wrongWay: false,
    offRoad: false,
  };
  private distanceTravelledM = 0;
  private wrongWaySeconds = 0;
  private offRoadSeconds = 0;
  private speedingSeconds = 0;
  private followingSeconds = 0;
  private passingLaneSeconds = 0;
  private unstableControlSeconds = 0;
  private honkSeconds = 0;
  private honkSourceNpcId: string | null = null;
  private playerHornSeconds = 0;
  private stopApproachSpeeds = new Map<string, number>();
  private restrictedLaneSeconds = new Map<string, number>();

  constructor(configuration: SimulationCoreConfig = {}) {
    const trafficSide = configuration.trafficSide ?? "right";
    this.lanes = (configuration.lanes ?? []).map(normalizeLane);
    this.lanesById = new Map(this.lanes.map((lane) => [lane.id, lane]));
    for (const [index, lane] of this.lanes.entries()) lane.index = index;
    this.routeVisitedGeneration = new Float64Array(this.lanes.length);
    this.routeVisitedBest = new Float64Array(this.lanes.length);
    for (const lane of this.lanes) {
      lane.successorLaneIds = lane.successorLaneIds.filter(
        (successorId, index, values) =>
          successorId !== lane.id &&
          this.lanesById.has(successorId) &&
          values.indexOf(successorId) === index,
      );
    }
    this.conflictApproachLaneIds = buildConflictApproachLaneIds(this.lanes);

    const defaultSpawnLane =
      this.lanes.find((lane) => lane.role === "travel") ?? this.lanes[0];
    const defaultSpawn = defaultSpawnLane
      ? this.pointOnLane(defaultSpawnLane, 15)
      : { x: 0, z: 0, heading: 0 };
    const spawn: SimulationPose = configuration.spawn
      ? {
          x: configuration.spawn.x,
          z: configuration.spawn.z,
          heading: wrapAngle(configuration.spawn.heading),
        }
      : defaultSpawn;
    const defaultBounds = this.boundsForLanes(this.lanes);
    this.initialSeed = normalizeSeed(configuration.seed);
    this.config = {
      trafficSide,
      speedUnit: configuration.speedUnit ?? "mph",
      seed: this.initialSeed,
      scenarioId: configuration.scenarioId ?? "free-drive",
      bounds: configuration.bounds ?? defaultBounds,
      spawn,
      scenarioClock: configuration.scenarioClock
        ? { ...configuration.scenarioClock }
        : null,
      npcCount: Math.trunc(clamp(configuration.npcCount ?? 10, 0, 32)),
      minRuntimeSpawnDistanceM: clamp(
        configuration.minRuntimeSpawnDistanceM ?? 70,
        30,
        200,
      ),
      maxForwardSpeedMps: clamp(configuration.maxForwardSpeedMps ?? 22, 5, 50),
      maxReverseSpeedMps: clamp(configuration.maxReverseSpeedMps ?? 7, 2, 15),
      // Defaults are the exact literals movePlayer/the collision code carried
      // before these knobs existed; the clamps bound how far a vehicle tier
      // may push each one. The two drag terms are the exception — see below.
      forwardAccelMps2: clamp(configuration.forwardAccelMps2 ?? 5.6, 1, 15),
      reverseAccelMps2: clamp(configuration.reverseAccelMps2 ?? 4.1, 1, 10),
      brakeBaseMps2: clamp(configuration.brakeBaseMps2 ?? 3, 1, 10),
      brakeStrengthMps2: clamp(configuration.brakeStrengthMps2 ?? 8.5, 2, 20),
      // Coasting models a car in gear, not one in neutral: rolling resistance
      // plus engine braking, which both rise roughly with speed, hence the
      // `base + k*v` shape. Together they give 1.8 m/s^2 at 30 mph and
      // 2.8 at 60 — the band a real light car coasts at.
      //
      // These were 0.25/0.035 (0.72 m/s^2 at 30 mph, a car in neutral), which
      // made lifting off nearly free: coasting from 50 mph took 40 s and 342 m
      // to stop, further than a whole NYC block, and ten seconds after lifting
      // off the speedometer still read exactly 30. That was reported as the
      // speedometer lying (#257) when it had been telling the truth all along.
      // Keep any retune paired with `HATCH_PHYSICS` in career.ts, which is the
      // same handling model and must stay identical to these.
      dragBaseMps2: clamp(configuration.dragBaseMps2 ?? 0.8, 0, 2),
      dragPerMps: clamp(configuration.dragPerMps ?? 0.075, 0, 0.2),
      steerBaseRate: clamp(configuration.steerBaseRate ?? 0.32, 0.05, 1),
      steerAuthorityRate: clamp(configuration.steerAuthorityRate ?? 0.95, 0, 3),
      steerAuthoritySpeedMps: clamp(
        configuration.steerAuthoritySpeedMps ?? 5.5,
        1,
        20,
      ),
      instabilityLateralMps2: clamp(
        configuration.instabilityLateralMps2 ?? 11,
        3,
        30,
      ),
      playerRadiusM: clamp(
        configuration.playerRadiusM ?? PLAYER_RADIUS_METRES,
        0.3,
        2,
      ),
      playerCapsuleHalfLengthM: clamp(
        configuration.playerCapsuleHalfLengthM ?? PLAYER_CAPSULE_HALF_LENGTH_M,
        0.3,
        3,
      ),
      playerCapsuleRadiusM: clamp(
        configuration.playerCapsuleRadiusM ?? PLAYER_CAPSULE_RADIUS_M,
        0.3,
        2,
      ),
    };

    this.trafficLights = (configuration.trafficLights ?? []).map(
      normalizeTrafficLight,
    );
    this.trafficLightsById = new Map(
      this.trafficLights.map((light) => [light.id, light]),
    );

    this.stopLines = (configuration.stopLines ?? [])
      .filter((line) => this.lanesById.has(line.laneId))
      .map((line) => ({ ...line }));
    // Per-lane view of the same objects, in the same relative order, so the
    // per-NPC-per-step control checks read one bucket instead of scanning
    // every stop line in the city.
    this.stopLinesByLaneId = new Map();
    for (const line of this.stopLines) {
      let bucket = this.stopLinesByLaneId.get(line.laneId);
      if (!bucket) {
        bucket = [];
        this.stopLinesByLaneId.set(line.laneId, bucket);
      }
      bucket.push(line);
    }
    const authoredTrafficGates = (configuration.trafficGates ?? [])
      .filter((gate) => this.lanesById.has(gate.laneId))
      .map((gate) => {
        const lane = this.lanesById.get(gate.laneId)!;
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
      : this.lanes.flatMap((lane) =>
          [0.82, 0.5, 0.18].map((fraction, index) => ({
            id: `auto-${lane.id}-${index + 1}`,
            laneId: lane.id,
            distance: lane.length * fraction,
            allowInitialSpawn: true,
          })),
        );
    this.laneRestrictions = (configuration.laneRestrictions ?? [])
      .filter((restriction) => this.lanesById.has(restriction.laneId))
      .map((restriction) => ({
        ...restriction,
        activeWindows: restriction.activeWindows.map((window) => ({
          ...window,
          weekdays: [...window.weekdays],
        })),
      }));
    this.boxJunctions = (configuration.boxJunctions ?? [])
      .filter(
        (junction) =>
          junction.polygon.length >= 3 &&
          junction.laneIds.some((laneId) => this.lanesById.has(laneId)),
      )
      .map((junction) => ({
        ...junction,
        polygon: junction.polygon.map((point) => ({ ...point })),
        laneIds: junction.laneIds.filter((laneId) => this.lanesById.has(laneId)),
        exitLaneIds: (junction.exitLaneIds ?? junction.laneIds).filter((laneId) =>
          this.lanesById.has(laneId),
        ),
        exitClearanceM: clamp(junction.exitClearanceM ?? 12, 3, 40),
      }));

    // Broad-phase bounds are tested against the player centre, so inflate by
    // the capsule's full reach plus one step of travel headroom.
    const obstacleInflationM =
      this.config.playerCapsuleHalfLengthM + this.config.playerCapsuleRadiusM + 1;
    this.staticObstacles = (configuration.staticObstacles ?? []).map(
      (obstacle) => normalizeStaticObstacle(obstacle, obstacleInflationM),
    );

    this.random = new SeededRandom(this.initialSeed);
    this.player = { ...spawn };
    this.reset();
  }

  /** Advances the simulation and returns the post-step serializable snapshot. */
  step(deltaSeconds: number, input: SimulationInput = {}): SimulationSnapshot {
    if (this.disposed) return this.getSnapshot();

    this.handleDiscreteActions(input);
    if (Number.isFinite(input.viewHeading)) {
      this.viewHeading = wrapAngle(input.viewHeading!);
    }
    this.continuousInput = {
      throttle: clamp(input.throttle ?? 0, 0, 1),
      brake: clamp(input.brake ?? 0, 0, 1),
      reverse: clamp(input.reverse ?? 0, 0, 1),
      steer: clamp(input.steer ?? 0, -1, 1),
    };

    if (this.status !== "running") return this.getSnapshot();
    this.accumulatorSeconds += clamp(deltaSeconds, 0, MAX_FRAME_SECONDS);
    while (
      this.accumulatorSeconds + Number.EPSILON >= FIXED_STEP_SECONDS &&
      this.status === "running"
    ) {
      this.fixedUpdate(FIXED_STEP_SECONDS);
      this.accumulatorSeconds -= FIXED_STEP_SECONDS;
    }
    return this.getSnapshot();
  }

  /** Alias used by render loops that prefer update-style naming. */
  update(deltaSeconds: number, input: SimulationInput = {}): SimulationSnapshot {
    return this.step(deltaSeconds, input);
  }

  /** Selects the other gear, but only while the vehicle is stopped. */
  toggleGear(): boolean {
    return this.selectGear(this.gear === "drive" ? "reverse" : "drive");
  }

  selectGear(nextGear: Gear): boolean {
    if (Math.abs(this.signedSpeedMps) > STOPPED_SPEED_MPS) {
      return false;
    }
    this.gear = nextGear;
    this.signedSpeedMps = 0;
    return true;
  }

  /** Restarts the run from its initial seed, authored pose, traffic, and clock. */
  reset(): SimulationSnapshot {
    if (this.disposed) return this.getSnapshot();
    this.random = new SeededRandom(this.initialSeed);
    this.player = { ...this.config.spawn };
    this.signedSpeedMps = 0;
    this.gear = "drive";
    this.signal = "off";
    this.signalStartHeading = this.player.heading;
    this.signalAutoCancelSeconds = 0;
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.viewHeading = this.player.heading;
    this.previousActions = {};
    this.accumulatorSeconds = 0;
    this.trafficDecisionAccumulator = 0;
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.status = "running";
    // Pure scratch — stale content is unreadable behind the generation
    // pre-increment, but a reset run should start from a clean slate anyway.
    this.routeSearchGeneration = 0;
    this.routeVisitedGeneration.fill(0);
    this.npcDigitCache.clear();
    this.events = [];
    this.ruleCooldowns.clear();
    this.distanceTravelledM = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.spawnNpcs();
    this.updateRoadState();
    return this.getSnapshot();
  }

  /**
   * Places the player at an authored pose, outside the input path.
   *
   * Only the pull-over cutscene uses this: for the length of that scene the
   * choreography owns the car, and the core has to agree with what is on screen
   * or every NPC keeps avoiding a ghost in the lane the player has visibly
   * left. Nothing on an ordinary drive calls it, so replay traces are
   * unaffected. `updateRoadState` runs here rather than waiting for the next
   * step, so a caller reading the snapshot straight after sees the lane the car
   * is actually on.
   */
  setPlayerPose(pose: SimulationPose, speedMps = 0): void {
    this.player.x = pose.x;
    this.player.z = pose.z;
    this.player.heading = wrapAngle(pose.heading);
    this.signedSpeedMps = speedMps;
    this.viewHeading = this.player.heading;
    this.updateRoadState();
  }

  /** Returns to the authored player spawn without clearing traffic or events. */
  resetToSpawn(): void {
    this.restoreSpawnPose();
    if (this.status !== "disposed") this.status = "running";
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.status = paused ? "paused" : "running";
    this.clearActiveInput();
  }

  /**
   * Renderer-detected contact with an externally modelled object — a
   * pedestrian, cyclist, or street prop. The car shrugs it off physically
   * (speed scrubbed by `speedScale`) and the contact lands in the event stream
   * as a non-terminating collision for the damage/fine layers. The scrub always applies
   * while running, even when the collision cooldown swallows the event, so a
   * second hit inside the window still physically slows the car. Returns
   * false only when the sim is not running (caller skips its reaction too).
  */
  reportExternalContact(
    correction: string,
    speedScale: number,
    evidence: Readonly<Record<string, string | number | boolean>> = {},
  ): boolean {
    if (this.disposed || this.status !== "running") return false;
    this.signedSpeedMps *= clamp(speedScale, 0, 1);
    this.emitEvent({
      code: "collision",
      correction,
      evidence: { ...evidence, externalRoadUser: true },
    });
    return true;
  }

  getEvents(): readonly SimulationRuleEvent[] {
    return this.events.slice();
  }

  /** Returns and clears queued rule events. */
  drainEvents(): SimulationRuleEvent[] {
    const events = this.events.slice();
    this.events = [];
    return events;
  }

  getSnapshot(): SimulationSnapshot {
    const projection = this.roadState.projection;
    const speedLimitMps = projection?.lane.speedLimitMps ?? 0;
    return {
      tick: this.tick,
      elapsedMs: Math.round(this.elapsedSeconds * 1000),
      scenarioId: this.config.scenarioId,
      status: this.status,
      trafficSide: this.config.trafficSide,
      speedUnit: this.config.speedUnit,
      scenarioClock: this.config.scenarioClock
        ? { ...this.config.scenarioClock }
        : null,
      speedDisplay: this.toDisplaySpeed(Math.abs(this.signedSpeedMps)),
      player: {
        x: this.player.x,
        z: this.player.z,
        heading: this.player.heading,
        speedMps: Math.abs(this.signedSpeedMps),
        signedSpeedMps: this.signedSpeedMps,
        gear: this.gear,
        signal: this.signal,
        hornActive: this.playerHornSeconds > 0,
        canChangeGear: Math.abs(this.signedSpeedMps) <= STOPPED_SPEED_MPS,
        distanceTravelledM: this.distanceTravelledM,
      },
      road: {
        laneId: projection?.lane.id ?? null,
        laneRole: projection?.lane.role ?? null,
        distanceFromLaneCentreM: projection?.distance ?? Number.MAX_SAFE_INTEGER,
        speedLimitMps,
        speedLimitDisplay: this.toDisplaySpeed(speedLimitMps),
        onCorrectSide: Boolean(projection) && !this.roadState.wrongWay && !this.roadState.offRoad,
        wrongWay: this.roadState.wrongWay,
        offRoad: this.roadState.offRoad,
      },
      npcs: this.npcs
        .filter((npc) => npc.active)
        .map((npc) => ({
          id: npc.id,
          laneId: npc.laneId,
          variant: npc.variant,
          x: npc.x,
          z: npc.z,
          // Add the display-only incident lean; the model keeps npc.heading clean.
          heading: wrapAngle(npc.heading + npc.incidentLeanRad),
          speedMps: npc.speedMps,
          state: npc.state,
          signal: npc.signal,
          honking: this.honkSeconds > 0 && this.honkSourceNpcId === npc.id,
        })),
      queuedNpcCount: this.npcs.filter((npc) => !npc.active).length,
      trafficLights: this.trafficLights.map((light) => {
        const timing = this.trafficLightTiming(light);
        return {
          id: light.id,
          phaseGroup: light.phaseGroup,
          x: light.x,
          z: light.z,
          state: timing.state,
          secondsUntilChange: timing.secondsUntilChange,
        };
      }),
      honk: {
        active: this.honkSeconds > 0,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.status = "disposed";
    this.clearActiveInput();
    this.npcs = [];
    this.ruleCooldowns.clear();
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
  }

  private fixedUpdate(deltaSeconds: number): void {
    this.tick += 1;
    this.elapsedSeconds += deltaSeconds;
    this.updateTimers(deltaSeconds);

    const oldPlayer = { ...this.player };
    const previousProjection = this.projectToRoad(oldPlayer.x, oldPlayer.z);
    this.movePlayer(deltaSeconds);

    this.trafficDecisionAccumulator += deltaSeconds;
    while (this.trafficDecisionAccumulator + Number.EPSILON >= TRAFFIC_DECISION_SECONDS) {
      this.makeTrafficDecisions();
      this.trafficDecisionAccumulator -= TRAFFIC_DECISION_SECONDS;
    }
    this.moveNpcs(deltaSeconds);
    this.updateNpcIncidents(deltaSeconds);
    this.updateRoadState();

    if (this.status !== "running") return;
    this.checkBoxJunctions(oldPlayer);
    this.monitorRestrictedLanes(deltaSeconds);
    this.checkStopLines(previousProjection, this.roadState.projection);
    if (this.status !== "running") return;
    this.monitorRoadRules(deltaSeconds);
    if (this.status !== "running") return;
    this.checkCollisions(oldPlayer);
  }

  private handleDiscreteActions(input: SimulationInput): void {
    const action = (key: keyof SimulationInput): boolean => {
      const active = Boolean(input[key]);
      const edge = active && !this.previousActions[key];
      this.previousActions[key] = active;
      return edge;
    };

    if (action("reset")) this.resetToSpawn();
    if (action("pause")) {
      if (this.status === "running") this.setPaused(true);
      else if (this.status === "paused") this.setPaused(false);
    }
    if (action("selectDrive")) this.selectGear("drive");
    if (action("selectReverse")) this.selectGear("reverse");
    if (action("toggleGear")) this.toggleGear();
    if (action("signalLeft")) this.setSignal(this.signal === "left" ? "off" : "left");
    if (action("signalRight")) this.setSignal(this.signal === "right" ? "off" : "right");
    if (action("cancelSignal")) this.setSignal("off");
    if (action("horn")) this.playerHornSeconds = 0.35;
  }

  private setSignal(signal: TurnSignal): void {
    this.signal = signal;
    this.signalStartHeading = this.player.heading;
    this.signalAutoCancelSeconds = 0;
  }

  private clearActiveInput(): void {
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.accumulatorSeconds = 0;
  }

  private movePlayer(deltaSeconds: number): void {
    const forward = this.continuousInput.throttle;
    const backward = this.continuousInput.reverse;
    const speed = this.signedSpeedMps;

    // Each pedal states a direction the driver wants to travel. Pressed against
    // the way the car is already rolling it is a brake; once the car has come to
    // rest the same pedal pulls away that way. So holding the reverse pedal
    // brings the car to a stop and then backs it up, with no gear to select —
    // and the brake pedal proper still only ever slows the car down.
    const opposed =
      (speed > STOPPED_SPEED_MPS ? backward : 0) +
      (speed < -STOPPED_SPEED_MPS ? forward : 0);
    const brake = Math.max(this.continuousInput.brake, Math.min(1, opposed));
    const drive =
      speed > STOPPED_SPEED_MPS
        ? forward
        : speed < -STOPPED_SPEED_MPS
          ? -backward
          : forward - backward;

    if (brake > 0) {
      this.signedSpeedMps = moveTowards(
        this.signedSpeedMps,
        0,
        (this.config.brakeBaseMps2 + brake * this.config.brakeStrengthMps2) *
          deltaSeconds,
      );
    } else {
      const acceleration =
        drive >= 0
          ? this.config.forwardAccelMps2
          : this.config.reverseAccelMps2;
      this.signedSpeedMps += drive * acceleration * deltaSeconds;
      const drag =
        this.config.dragBaseMps2 +
        Math.abs(this.signedSpeedMps) * this.config.dragPerMps;
      this.signedSpeedMps = moveTowards(
        this.signedSpeedMps,
        0,
        drag * deltaSeconds,
      );
    }

    this.signedSpeedMps = clamp(
      this.signedSpeedMps,
      -this.config.maxReverseSpeedMps,
      this.config.maxForwardSpeedMps,
    );
    if (Math.abs(this.signedSpeedMps) < 0.015 && drive === 0) {
      this.signedSpeedMps = 0;
    }
    // The gear is now a readout of which way the car is actually travelling
    // rather than something the driver selects. It latches, so a car rolling to
    // a halt keeps reading R until it next pulls away forwards.
    if (this.signedSpeedMps > STOPPED_SPEED_MPS) this.gear = "drive";
    else if (this.signedSpeedMps < -STOPPED_SPEED_MPS) this.gear = "reverse";

    const absoluteSpeed = Math.abs(this.signedSpeedMps);
    if (absoluteSpeed > 0.04) {
      const steeringAuthority = Math.min(
        1,
        absoluteSpeed / this.config.steerAuthoritySpeedMps,
      );
      const reverseSteering = this.signedSpeedMps < 0 ? -1 : 1;
      this.player.heading = wrapAngle(
        this.player.heading +
          this.continuousInput.steer *
            reverseSteering *
            (this.config.steerBaseRate +
              steeringAuthority * this.config.steerAuthorityRate) *
            deltaSeconds,
      );
    }
    const travelled = this.signedSpeedMps * deltaSeconds;
    this.player.x += Math.sin(this.player.heading) * travelled;
    this.player.z += Math.cos(this.player.heading) * travelled;
    this.distanceTravelledM += Math.abs(travelled);
    this.resolveStaticCollisions(true);

    const lateralAcceleration =
      (Math.abs(this.continuousInput.steer) * absoluteSpeed * absoluteSpeed) / 3.1;
    if (lateralAcceleration > this.config.instabilityLateralMps2) {
      this.unstableControlSeconds += deltaSeconds;
      this.signedSpeedMps *= 1 - 0.12 * deltaSeconds;
    } else {
      this.unstableControlSeconds = Math.max(
        0,
        this.unstableControlSeconds - deltaSeconds * 2,
      );
    }
    if (this.unstableControlSeconds >= 0.7) {
      this.emitEvent({
        code: "observation",
        correction: "Ease off the accelerator before making a strong steering input.",
        evidence: { lateralAccelerationMps2: Math.round(lateralAcceleration * 10) / 10 },
      });
      this.unstableControlSeconds = 0;
    }

    if (this.signal !== "off") {
      if (Math.abs(angleDifference(this.player.heading, this.signalStartHeading)) > 0.48) {
        this.signalAutoCancelSeconds = Math.max(this.signalAutoCancelSeconds, 1.1);
      }
      if (this.signalAutoCancelSeconds > 0) {
        this.signalAutoCancelSeconds -= deltaSeconds;
        if (this.signalAutoCancelSeconds <= 0) this.setSignal("off");
      }
    }
  }

  /**
   * Keeps the player car out of the solid world: the car is a two-circle
   * capsule along its heading, each obstacle a box or circle, and a contact
   * pushes the car out along the contact normal. The velocity response is the
   * arcade wall recipe — a grazing contact slides (tangential speed kept,
   * lightly scrubbed), a near-head-on contact stops with a small rebound — so
   * scraping a facade slows the car until it steers parallel rather than
   * pin-balling it. Emits at most one collision rule event per contact burst;
   * `allowEvents` lets the NPC crash path re-resolve without double-reporting.
   * Allocation-free: everything below is scalar arithmetic on locals.
   */
  private resolveStaticCollisions(allowEvents: boolean): void {
    if (!this.staticObstacles.length) return;
    const forwardX = Math.sin(this.player.heading);
    const forwardZ = Math.cos(this.player.heading);
    let maxApproachMps = 0;
    let hitTag: StaticObstacleTag | null = null;
    let hitId = "";

    for (let iteration = 0; iteration < 3; iteration += 1) {
      let deepest = 0;
      let normalX = 0;
      let normalZ = 0;
      const px = this.player.x;
      const pz = this.player.z;
      for (const obstacle of this.staticObstacles) {
        if (
          px < obstacle.minX ||
          px > obstacle.maxX ||
          pz < obstacle.minZ ||
          pz > obstacle.maxZ
        ) {
          continue;
        }
        for (let end = -1; end <= 1; end += 2) {
          const cx = px + forwardX * this.config.playerCapsuleHalfLengthM * end;
          const cz = pz + forwardZ * this.config.playerCapsuleHalfLengthM * end;
          const dx = cx - obstacle.x;
          const dz = cz - obstacle.z;
          let penetration: number;
          let nx: number;
          let nz: number;
          if (obstacle.radius > 0) {
            const distance = Math.hypot(dx, dz);
            penetration =
              obstacle.radius + this.config.playerCapsuleRadiusM - distance;
            if (penetration <= deepest) continue;
            if (distance > 1e-6) {
              nx = dx / distance;
              nz = dz / distance;
            } else {
              nx = forwardX;
              nz = forwardZ;
            }
          } else {
            const du = dx * obstacle.ux + dz * obstacle.uz;
            // V is the U axis rotated a quarter turn: (uz, -ux).
            const dv = dx * obstacle.uz - dz * obstacle.ux;
            const insideU = obstacle.halfU - Math.abs(du);
            const insideV = obstacle.halfV - Math.abs(dv);
            if (insideU > 0 && insideV > 0) {
              // Centre inside the box: exit along the shallower face.
              if (insideU < insideV) {
                const sign = du >= 0 ? 1 : -1;
                nx = obstacle.ux * sign;
                nz = obstacle.uz * sign;
                penetration = insideU + this.config.playerCapsuleRadiusM;
              } else {
                const sign = dv >= 0 ? 1 : -1;
                nx = obstacle.uz * sign;
                nz = -obstacle.ux * sign;
                penetration = insideV + this.config.playerCapsuleRadiusM;
              }
            } else {
              const qu = Math.max(-obstacle.halfU, Math.min(obstacle.halfU, du));
              const qv = Math.max(-obstacle.halfV, Math.min(obstacle.halfV, dv));
              const gapX = dx - (obstacle.ux * qu + obstacle.uz * qv);
              const gapZ = dz - (obstacle.uz * qu - obstacle.ux * qv);
              const distance = Math.hypot(gapX, gapZ);
              penetration = this.config.playerCapsuleRadiusM - distance;
              if (penetration <= deepest) continue;
              if (distance > 1e-6) {
                nx = gapX / distance;
                nz = gapZ / distance;
              } else {
                nx = forwardX;
                nz = forwardZ;
              }
            }
          }
          if (penetration > deepest) {
            deepest = penetration;
            normalX = nx;
            normalZ = nz;
            hitTag = obstacle.tag;
            hitId = obstacle.id;
          }
        }
      }
      if (deepest <= 0) break;

      this.player.x += normalX * deepest;
      this.player.z += normalZ * deepest;
      const travelSign = this.signedSpeedMps >= 0 ? 1 : -1;
      const directionDot =
        (forwardX * normalX + forwardZ * normalZ) * travelSign;
      if (directionDot < 0) {
        const approachMps = -directionDot * Math.abs(this.signedSpeedMps);
        maxApproachMps = Math.max(maxApproachMps, approachMps);
        if (-directionDot >= STATIC_BONK_DOT) {
          this.signedSpeedMps =
            approachMps >= STATIC_BONK_MIN_MPS
              ? -travelSign *
                Math.min(
                  STATIC_BONK_REBOUND_MAX_MPS,
                  approachMps * STATIC_BONK_REBOUND_FRACTION,
                )
              : // Pressing head-on below bonk speed: the wall wins outright.
                this.signedSpeedMps * (1 + directionDot);
        } else {
          this.signedSpeedMps *= Math.max(
            0,
            1 +
              STATIC_SCRAPE_FRICTION_PER_S *
                directionDot *
                FIXED_STEP_SECONDS,
          );
        }
      }
    }

    if (
      allowEvents &&
      hitTag &&
      maxApproachMps >= STATIC_IMPACT_EVENT_MIN_MPS &&
      this.status === "running"
    ) {
      this.emitEvent({
        code: "collision",
        correction: STATIC_OBSTACLE_CORRECTIONS[hitTag],
        evidence: {
          obstacle: hitTag,
          obstacleId: hitId,
          impactSpeedMps: Math.round(maxApproachMps * 10) / 10,
        },
      });
    }
  }

  private spawnNpcs(): void {
    this.npcs = [];
    if (this.trafficGates.length === 0 || this.lanes.length === 0) return;
    for (let index = 0; index < this.config.npcCount; index += 1) {
      const preferredGate = this.trafficGates[index % this.trafficGates.length];
      const lane = this.lanesById.get(preferredGate.laneId) ?? this.lanes[0];
      const pose = this.pointOnLane(lane, preferredGate.distance);
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
      const npc: NpcInternal = {
        id: `npc-${index + 1}`,
        variant,
        active: false,
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
      this.npcs.push(npc);
      const gate = this.findSafeTrafficGate(npc, true);
      if (gate) this.activateNpcAtGate(npc, gate, true);
    }
  }

  private randomVehicleVariant(): NpcVehicleVariant {
    const value = this.random.next();
    if (value < 0.1) return "bus";
    if (value < 0.24) return "van";
    if (value < 0.42) return "taxi";
    return "car";
  }

  private candidateTrafficGates(npc: NpcInternal): NormalizedTrafficGate[] {
    const preferred = npc.preferredGateId;
    return this.trafficGates
      .filter((gate) => !gate.variant || gate.variant === npc.variant)
      .slice()
      .sort((left, right) => {
        if (left.id === preferred) return -1;
        if (right.id === preferred) return 1;
        return left.id.localeCompare(right.id);
      });
  }

  private findSafeTrafficGate(
    npc: NpcInternal,
    initial: boolean,
  ): NormalizedTrafficGate | null {
    for (const gate of this.candidateTrafficGates(npc)) {
      if (initial && !gate.allowInitialSpawn) continue;
      if (this.isTrafficGateSafe(npc, gate, initial)) return gate;
    }
    return null;
  }

  private isTrafficGateSafe(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    initial: boolean,
  ): boolean {
    const lane = this.lanesById.get(gate.laneId);
    if (!lane) return false;
    const pose = this.pointOnLane(lane, gate.distance);
    const desiredSpeedMps = gate.desiredSpeedMps ?? npc.desiredSpeedMps;
    const playerDistanceM = Math.sqrt(distanceSquared(pose, this.player));
    if (playerDistanceM < INITIAL_CROSS_LANE_CLEARANCE_M) return false;
    if (!initial && playerDistanceM < this.config.minRuntimeSpawnDistanceM) return false;
    if (!initial && this.isInsidePlayerVisibilityEnvelope(pose)) return false;

    const playerProjection = this.projectToRoad(this.player.x, this.player.z);
    if (playerProjection?.lane.id === lane.id && playerProjection.distance < lane.width) {
      const aheadOfPlayer = this.distanceAhead(
        lane,
        playerProjection.distanceAlong,
        gate.distance,
      );
      const behindPlayer = this.distanceAhead(
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

    const predictedPose = this.pointOnLane(
      lane,
      Math.min(lane.length, gate.distance + desiredSpeedMps * SPAWN_PREDICTION_SECONDS),
    );
    const predictedClearance =
      this.config.playerRadiusM + NPC_RADIUS_METRES + 1.5;
    if (
      distanceToSegmentSquared(
        this.player.x,
        this.player.z,
        pose.x,
        pose.z,
        predictedPose.x,
        predictedPose.z,
      ) < predictedClearance * predictedClearance
    ) {
      return false;
    }

    const requiredHeadway = Math.max(10, desiredSpeedMps * 1.8 + 4);
    for (const other of this.npcs) {
      if (!other.active || other.id === npc.id) continue;
      const otherLane = this.lanesById.get(other.laneId);
      if (!otherLane) continue;
      const forward = this.routeDistanceAhead(
        lane,
        gate.distance,
        otherLane,
        other.distance,
      );
      const backward = this.routeDistanceAhead(
        otherLane,
        other.distance,
        lane,
        gate.distance,
      );
      if (forward < requiredHeadway || backward < requiredHeadway) return false;
      if (other.laneId !== lane.id && distanceSquared(other, pose) < 12 * 12) {
        return false;
      }
    }
    return true;
  }

  private isInsidePlayerVisibilityEnvelope(point: SimulationPoint): boolean {
    const dx = point.x - this.player.x;
    const dz = point.z - this.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= Number.EPSILON) return true;
    const bearing = Math.atan2(dx, dz);
    const forwardAngle = Math.abs(angleDifference(bearing, this.viewHeading));
    if (
      distance <= RUNTIME_FORWARD_VISIBILITY_DISTANCE_M &&
      forwardAngle <= RUNTIME_FORWARD_HALF_ANGLE_RAD
    ) {
      return true;
    }
    const rearAngle = Math.abs(
      angleDifference(bearing, wrapAngle(this.player.heading + Math.PI)),
    );
    return (
      distance <= RUNTIME_REAR_VISIBILITY_DISTANCE_M &&
      rearAngle <= RUNTIME_REAR_HALF_ANGLE_RAD
    );
  }

  private activateNpcAtGate(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    initial = false,
  ): void {
    const lane = this.lanesById.get(gate.laneId);
    if (!lane) return;
    const pose = this.pointOnLane(lane, gate.distance);
    npc.active = true;
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
    npc.activatedAtSeconds = initial
      ? Number.NEGATIVE_INFINITY
      : this.elapsedSeconds;
  }

  private deactivateNpc(npc: NpcInternal): void {
    npc.active = false;
    npc.speedMps = 0;
    npc.targetSpeedMps = 0;
    npc.state = "recovering";
    npc.signal = "off";
    npc.targetLaneId = undefined;
    npc.cornerFromLaneId = undefined;
    npc.laneChangeProgress = 0;
    npc.jamSeconds = 0;
    npc.incidentLeanRad = 0;
    npc.struckUntilTick = 0;
  }

  private activateQueuedNpcs(): void {
    for (const npc of this.npcs) {
      if (npc.active) continue;
      const gate = this.findSafeTrafficGate(npc, false);
      if (gate) this.activateNpcAtGate(npc, gate);
    }
  }

  private makeTrafficDecisions(): void {
    this.activateQueuedNpcs();
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      // A struck car makes no decisions while it sits knocked; moveNpcs owns
      // the hold and the release.
      if (this.tick < npc.struckUntilTick) continue;
      const lane = this.lanesById.get(npc.laneId);
      if (!lane) continue;
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
        const targetLane = this.lanesById.get(npc.targetLaneId);
        npc.targetSpeedMps =
          targetLane && this.isNpcLaneChangeClear(npc, targetLane)
            ? npc.desiredSpeedMps
            : 0;
        continue;
      }

      const stoppingGap = this.redLightGapForLane(lane, npc.distance);
      const yieldGap = this.yieldGapForLane(lane, npc.distance);
      const leadGap = this.leadVehicleGap(lane, npc.distance, npc.id);
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
        ? this.lanesById.get(lane.adjacentLaneId)
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
        this.isNpcLaneChangeClear(npc, adjacent)
      ) {
        const currentPose = this.pointOnLane(lane, npc.distance);
        const adjacentDistance = (npc.distance / lane.length) * adjacent.length;
        const targetPose = this.pointOnLane(adjacent, adjacentDistance);
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
    npc.heading = approachAngle(
      npc.heading,
      targetHeading,
      yawRate * deltaSeconds,
    );
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
    const start = this.pointOnLane(fromLane, fromLane.length - fromWindow);
    const end = this.pointOnLane(toLane, toWindow);
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
   * Overlays the corner arc on a cruising car's centreline pose when it is
   * inside the hop window: the exit half while approaching its deterministic
   * successor, the entry half just after the hop (tracked by
   * `cornerFromLaneId`). Falls back to the centreline pose whenever the hop
   * is unknown, discontinuous, or geometrically degenerate.
   */
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
      this.areLaneEndpointsContinuous(lane, next)
    ) {
      return this.cornerArcPose(lane, next, distance - exitStart) ?? fallback;
    }
    return fallback;
  }

  private npcCornerPose(
    npc: NpcInternal,
    lane: NormalizedLane,
    fallback: SimulationPose,
  ): SimulationPose {
    const exitWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
    const exitStart = lane.length - exitWindow;
    if (npc.distance >= exitStart) {
      return this.npcExitArcPose(npc, lane, npc.distance, fallback);
    }
    if (npc.cornerFromLaneId) {
      const entryWindow = Math.min(NPC_CORNER_WINDOW_M, lane.length / 2);
      if (npc.distance < entryWindow) {
        const previous = this.lanesById.get(npc.cornerFromLaneId);
        if (previous) {
          const previousWindow = Math.min(
            NPC_CORNER_WINDOW_M,
            previous.length / 2,
          );
          return (
            this.cornerArcPose(
              previous,
              lane,
              previousWindow + npc.distance,
            ) ?? fallback
          );
        }
      }
      npc.cornerFromLaneId = undefined;
    }
    return fallback;
  }

  private moveNpcs(deltaSeconds: number): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      npc.previousX = npc.x;
      npc.previousZ = npc.z;
      if (this.tick < npc.struckUntilTick) {
        // Knocked by the player: hold position (and the askew lean) until the
        // struck window expires, then rejoin traffic normally.
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        continue;
      }
      if (npc.struckUntilTick !== 0) {
        npc.struckUntilTick = 0;
        npc.incidentLeanRad = 0;
      }
      const deceleration = npc.targetSpeedMps < npc.speedMps ? 4.4 : 0;
      const acceleration = deceleration || 2.2;
      npc.speedMps = moveTowards(
        npc.speedMps,
        npc.targetSpeedMps,
        acceleration * deltaSeconds,
      );
      const sourceLane = this.lanesById.get(npc.laneId);
      if (!sourceLane) continue;
      const requestedTravel = npc.speedMps * deltaSeconds;
      const leadGap = this.leadVehicleGap(sourceLane, npc.distance, npc.id);
      // Hold a full body length so a compressing queue stops bumper-to-bumper
      // rather than letting the ~3.75 m car meshes overlap at the old ~2.4 m gap.
      const minimumCentreGap = NPC_BODY_CLEARANCE_M;
      const followingSafeTravel =
        leadGap === null
          ? requestedTravel
          : Math.max(0, Math.min(requestedTravel, leadGap - minimumCentreGap));
      let safeTravel = followingSafeTravel;
      if (followingSafeTravel > 0) {
        const lookAheadTravel = Math.max(
          followingSafeTravel,
          npc.speedMps * 0.35 + 0.75,
        );
        if (!this.isNpcTravelClearOfPlayer(npc, lookAheadTravel)) {
          safeTravel = 0;
        } else {
          const spatialSafetyTick =
            this.tick % Math.round(TRAFFIC_DECISION_SECONDS / FIXED_STEP_SECONDS) === 0;
          if (
            spatialSafetyTick &&
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
      if (!this.advanceNpcAlongLegalRoute(npc, safeTravel, deltaSeconds)) {
        continue;
      }

      const activeSourceLane = this.lanesById.get(npc.laneId);
      if (!activeSourceLane) continue;
      const sourcePose = this.pointOnLane(activeSourceLane, npc.distance);
      if (npc.state === "lane-changing" && npc.targetLaneId) {
        const targetLane = this.lanesById.get(npc.targetLaneId);
        if (targetLane) {
          if (!this.isNpcLaneChangeClear(npc, targetLane)) {
            npc.targetSpeedMps = 0;
            const amount = smoothStep(npc.laneChangeProgress);
            const targetDistance =
              (npc.distance / activeSourceLane.length) * targetLane.length;
            const targetPose = this.npcExitArcPose(
              npc,
              targetLane,
              targetDistance,
              this.pointOnLane(targetLane, targetDistance),
            );
            npc.x = sourcePose.x + (targetPose.x - sourcePose.x) * amount;
            npc.z = sourcePose.z + (targetPose.z - sourcePose.z) * amount;
            this.chaseNpcHeading(
              npc,
              lerpAngle(sourcePose.heading, targetPose.heading, amount),
              deltaSeconds,
            );
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
            this.pointOnLane(targetLane, targetDistance),
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
            npc.laneChangeProgress = 0;
            npc.signal = "off";
            npc.state = targetLane.kind === "merge" ? "merging" : "cruising";
          }
          continue;
        }
      }
      const displayPose = this.npcCornerPose(npc, activeSourceLane, sourcePose);
      npc.x = displayPose.x;
      npc.z = displayPose.z;
      this.chaseNpcHeading(npc, displayPose.heading, deltaSeconds);
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
  private updateNpcIncidents(deltaSeconds: number): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      // A player-struck car already sits askew on its own timer; the jam
      // machinery must neither clear that lean nor recycle the car while the
      // player is right next to it.
      if (this.tick < npc.struckUntilTick) continue;
      const lane = this.lanesById.get(npc.laneId);
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
          this.redLightGapForLane(lane, npc.distance) !== null ||
          this.yieldGapForLane(lane, npc.distance) !== null
        ) &&
        this.npcs.some((other) => {
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
        distanceSquared(npc, this.player) >
          NPC_INCIDENT_PLAYER_CLEARANCE_M * NPC_INCIDENT_PLAYER_CLEARANCE_M
      ) {
        this.deactivateNpc(npc);
        continue;
      }
      // Lean the rendered pose askew so the contact reads as a knock. This is a
      // separate display-only field, so npc.heading stays pristine for the
      // spatial-clearance model and the knock cannot perturb determinism.
      const side = this.numericNpcId(npc.id) % 2 === 0 ? 1 : -1;
      npc.incidentLeanRad =
        npc.jamSeconds >= NPC_INCIDENT_KNOCK_SECONDS
          ? side * NPC_INCIDENT_KNOCK_RAD
          : 0;
    }
  }

  /**
   * Advances through authored successor lanes. A missing, invalid, or spatially
   * discontinuous successor queues the NPC instead of wrapping it on-screen.
   */
  private advanceNpcAlongLegalRoute(
    npc: NpcInternal,
    distanceDelta: number,
    deltaSeconds: number,
  ): boolean {
    let remaining = Math.max(0, distanceDelta);
    let transitions = 0;
    while (remaining > 0 && transitions <= this.lanes.length) {
      const lane = this.lanesById.get(npc.laneId);
      if (!lane) {
        this.deactivateNpc(npc);
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
        this.deactivateNpc(npc);
        return false;
      }

      remaining -= available;
      const nextLane = this.nextLaneForNpc(npc, lane);
      if (!nextLane || !this.areLaneEndpointsContinuous(lane, nextLane)) {
        npc.distance = lane.length;
        const endPose = this.pointOnLane(lane, lane.length);
        npc.x = endPose.x;
        npc.z = endPose.z;
        npc.heading = endPose.heading;
        this.deactivateNpc(npc);
        return false;
      }
      if (!this.isNpcLaneEntryClear(npc, nextLane)) {
        // Keep the last physically rendered position. Snapping to the lane end
        // while also reporting zero speed creates a visible micro-teleport and
        // can put a waiting vehicle inside a converging predecessor lane.
        npc.distance = Math.min(npc.distance, Math.max(0, lane.length - 0.02));
        const endPose = this.npcCornerPose(
          npc,
          lane,
          this.pointOnLane(lane, npc.distance),
        );
        npc.x = endPose.x;
        npc.z = endPose.z;
        this.chaseNpcHeading(npc, endPose.heading, deltaSeconds);
        npc.speedMps = 0;
        npc.targetSpeedMps = 0;
        npc.state = "following";
        return false;
      }
      npc.cornerFromLaneId = lane.id;
      npc.laneId = nextLane.id;
      npc.distance = 0;
      npc.transitionCount += 1;
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
    if (transitions > this.lanes.length) {
      this.deactivateNpc(npc);
      return false;
    }
    return true;
  }

  /**
   * Keeps authored traffic challenging without letting two converging lane
   * centrelines create a collision before their shared successor is reached.
   * This is a final physical safety envelope, not a replacement for signals,
   * yielding, following-distance decisions, or authored conflict controls.
   */
  private isNpcTravelSpatiallyClear(
    npc: NpcInternal,
    travel: number,
  ): boolean {
    const sourceLane = this.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const nearConflictingEndpoint =
      this.conflictApproachLaneIds.has(sourceLane.id) &&
      sourceLane.length - npc.distance <= 15 + travel;
    const changingLane =
      npc.state === "lane-changing" && Boolean(npc.targetLaneId);
    if (!nearConflictingEndpoint && !changingLane) {
      return true;
    }

    const candidate = this.predictedNpcPose(npc, travel);
    if (!candidate) return false;

    const numericNpcId = this.numericNpcId(npc.id);
    for (const other of this.npcs) {
      if (!other.active || other.id === npc.id) continue;
      const nearbyRadius = NPC_CROSSING_YIELD_CLEARANCE_M + travel + 2;
      if (distanceSquared(npc, other) > nearbyRadius * nearbyRadius) continue;

      const sameFlow =
        npc.laneId === other.laneId ||
        Math.abs(angleDifference(npc.heading, other.heading)) < Math.PI / 6;
      // A full body length keeps two converging cars from visibly overlapping;
      // the lower-priority id still yields the larger crossing gap. (Was ~2.4 m
      // same-flow / ~2.08 m physical, both shorter than the rendered car.)
      const clearance = sameFlow
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

  /** Player-to-NPC clearance for traffic decisions (was a module constant
   * derived from the fixed player disc; now tracks the configured radius). */
  private playerTrafficClearanceM(): number {
    return this.config.playerRadiusM + NPC_RADIUS_METRES + 1.25;
  }

  private isNpcTravelClearOfPlayer(
    npc: NpcInternal,
    travel: number,
  ): boolean {
    const playerCheckRadius = this.playerTrafficClearanceM() + travel + 5;
    if (
      distanceSquared(npc, this.player) >
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
          this.player,
          this.playerTrafficClearanceM(),
        ),
    );
  }

  private predictedNpcPose(
    npc: NpcInternal,
    travel: number,
  ): SimulationPose | null {
    const sourceLane = this.lanesById.get(npc.laneId);
    if (!sourceLane) return null;
    const sourceDistance = Math.min(
      sourceLane.length,
      npc.distance + Math.max(0, travel),
    );
    const sourcePose = this.pointOnLane(sourceLane, sourceDistance);
    if (npc.state !== "lane-changing" || !npc.targetLaneId) {
      return sourcePose;
    }
    const targetLane = this.lanesById.get(npc.targetLaneId);
    if (!targetLane) return sourcePose;
    const progress = Math.min(
      1,
      npc.laneChangeProgress + Math.max(0, travel) / NPC_LANE_CHANGE_DISTANCE_M,
    );
    const amount = smoothStep(progress);
    const targetDistance = (sourceDistance / sourceLane.length) * targetLane.length;
    const targetPose = this.pointOnLane(targetLane, targetDistance);
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
      distanceToSegmentSquared(
        obstacle.x,
        obstacle.z,
        npc.x,
        npc.z,
        candidate.x,
        candidate.z,
      ) >= clearanceSquared
    );
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

  private numericNpcId(id: string): number {
    return this.parsedNpcDigits(id) || 0;
  }

  private nextLaneForNpc(
    npc: NpcInternal,
    lane: NormalizedLane,
  ): NormalizedLane | null {
    if (lane.successorLaneIds.length) {
      const numericId = this.parsedNpcDigits(npc.id) || 1;
      const index = (npc.transitionCount + numericId - 1) % lane.successorLaneIds.length;
      return this.lanesById.get(lane.successorLaneIds[index]) ?? null;
    }
    return lane.loop ? lane : null;
  }

  private areLaneEndpointsContinuous(
    source: NormalizedLane,
    target: NormalizedLane,
  ): boolean {
    const sourceEnd = source.points[source.points.length - 1];
    const targetStart = target.points[0];
    return distanceSquared(sourceEnd, targetStart) <= 0.5 * 0.5;
  }

  private isNpcLaneEntryClear(
    npc: NpcInternal,
    target: NormalizedLane,
  ): boolean {
    const targetStart = this.pointOnLane(target, 0);
    const minimumEntryHeadwayM = NPC_FOLLOW_STANDSTILL_GAP_M + 4;
    for (const other of this.npcs) {
      if (!other.active || other.id === npc.id) continue;
      if (
        other.laneId === target.id &&
        other.distance < minimumEntryHeadwayM
      ) {
        return false;
      }
      if (
        other.targetLaneId === target.id &&
        distanceSquared(other, targetStart) <
          minimumEntryHeadwayM * minimumEntryHeadwayM
      ) {
        return false;
      }
      if (
        distanceSquared(other, targetStart) <
        NPC_LANE_ENTRY_CLEARANCE_M ** 2
      ) {
        return false;
      }
    }
    return (
      distanceSquared(this.player, targetStart) >=
      (this.config.playerRadiusM + NPC_RADIUS_METRES + 4) ** 2
    );
  }

  private monitorRoadRules(deltaSeconds: number): void {
    const projection = this.roadState.projection;
    const speed = Math.abs(this.signedSpeedMps);

    if (this.roadState.wrongWay && speed > 1.4) {
      this.wrongWaySeconds += deltaSeconds;
    } else {
      this.wrongWaySeconds = Math.max(0, this.wrongWaySeconds - deltaSeconds * 2);
    }
    if (this.wrongWaySeconds >= 2) {
      this.emitEvent({
        code: "wrong_way",
        correction: `Keep to the ${this.config.trafficSide} and follow the direction shown by the lane arrows.`,
        evidence: {
          sustainedSeconds: Math.round(this.wrongWaySeconds * 10) / 10,
        },
      });
    }

    if (this.roadState.offRoad) this.offRoadSeconds += deltaSeconds;
    else this.offRoadSeconds = Math.max(0, this.offRoadSeconds - deltaSeconds * 2);
    if (this.offRoadSeconds >= 0.8) {
      this.emitEvent({
        code: "out_of_bounds",
        correction:
          "Slow down, steer smoothly, and remain between the lane boundaries.",
        evidence: {
          offRoadSeconds: Math.round(this.offRoadSeconds * 10) / 10,
        },
      });
    }

    if (!projection) return;
    const speedingThreshold = Math.max(1.3, projection.lane.speedLimitMps * 0.08);
    if (speed > projection.lane.speedLimitMps + speedingThreshold) {
      this.speedingSeconds += deltaSeconds;
    } else {
      this.speedingSeconds = Math.max(0, this.speedingSeconds - deltaSeconds * 1.5);
    }
    if (this.speedingSeconds >= 2.2) {
      this.emitEvent({
        code: "speeding",
        correction: "Ease off the accelerator and return smoothly to the posted limit.",
        evidence: {
          speedMps: Math.round(speed * 10) / 10,
          limitMps: Math.round(projection.lane.speedLimitMps * 10) / 10,
        },
      });
      this.speedingSeconds = 0;
    }

    this.monitorFollowingDistance(projection, deltaSeconds);
    this.monitorPassingLane(projection, deltaSeconds);
  }

  private checkBoxJunctions(previousPlayer: SimulationPoint): void {
    const projection = this.roadState.projection;
    if (!projection || Math.abs(this.signedSpeedMps) < 0.5) return;

    for (const junction of this.boxJunctions) {
      if (!junction.laneIds.includes(projection.lane.id)) continue;
      const entered =
        !isPointInPolygon(previousPlayer, junction.polygon) &&
        isPointInPolygon(this.player, junction.polygon);
      if (!entered) continue;

      const blockingNpc = this.findBlockedBoxExit(junction, projection);
      if (!blockingNpc) continue;
      const clearance = junction.exitClearanceM ?? 12;
      this.emitEvent({
        code: "box_junction",
        correction:
          "Wait before the box until there is enough room to clear it completely.",
        evidence: {
          junctionId: junction.id,
          laneId: projection.lane.id,
          blockingVehicleId: blockingNpc.id,
          exitClearanceM: Math.round(clearance * 10) / 10,
          speedMps: Math.round(Math.abs(this.signedSpeedMps) * 10) / 10,
        },
      });
    }
  }

  private findBlockedBoxExit(
    junction: SimulationBoxJunctionDefinition,
    playerProjection: LaneProjection,
  ): NpcInternal | null {
    const exitLaneIds = junction.exitLaneIds?.length
      ? junction.exitLaneIds
      : junction.laneIds;
    const clearance = junction.exitClearanceM ?? 12;
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      if (!exitLaneIds.includes(npc.laneId)) continue;
      if (distanceToPolygon(npc, junction.polygon) > clearance) continue;
      if (npc.laneId === playerProjection.lane.id) {
        const gap = this.distanceAhead(
          playerProjection.lane,
          playerProjection.distanceAlong,
          npc.distance,
        );
        if (gap > 0.5 && gap <= clearance + 24) return npc;
        continue;
      }
      return npc;
    }
    return null;
  }

  private monitorRestrictedLanes(deltaSeconds: number): void {
    const projection = this.roadState.projection;
    const clock = this.config.scenarioClock;
    for (const restriction of this.laneRestrictions) {
      const usingRestrictedLane =
        Boolean(clock) &&
        projection?.lane.id === restriction.laneId &&
        projection.distance <= projection.lane.width / 2 + 0.75 &&
        Math.abs(this.signedSpeedMps) >= 0.8 &&
        isLaneRestrictionActive(restriction, clock);
      const sustainedSeconds = usingRestrictedLane
        ? (this.restrictedLaneSeconds.get(restriction.id) ?? 0) + deltaSeconds
        : 0;
      this.restrictedLaneSeconds.set(restriction.id, sustainedSeconds);
      if (sustainedSeconds < 2.5 || !clock) continue;

      const activeWindow = restriction.activeWindows.find((window) =>
        isRestrictionWindowActive(clock, window),
      );
      this.emitEvent({
        code: "restricted_lane",
        correction:
          "Read the signed operating times and move into a general-traffic lane when it is safe.",
        evidence: {
          restrictionId: restriction.id,
          laneId: restriction.laneId,
          weekday: clock.weekday,
          scenarioTime: clock.label,
          sourceReferenceId: restriction.sourceReferenceId,
          sustainedSeconds: 2.5,
          activeWindow: activeWindow
            ? `${activeWindow.startMinutes}-${activeWindow.endMinutes}`
            : "unknown",
        },
      });
      this.restrictedLaneSeconds.set(restriction.id, 0);
    }
  }

  private monitorFollowingDistance(
    projection: LaneProjection,
    deltaSeconds: number,
  ): void {
    const speed = Math.abs(this.signedSpeedMps);
    if (speed < 2 || projection.distance > projection.lane.width) {
      this.followingSeconds = 0;
      return;
    }
    const gap = this.leadVehicleGap(projection.lane, projection.distanceAlong);
    const safeGap = Math.max(6, speed * 1.5);
    if (gap !== null && gap < safeGap) this.followingSeconds += deltaSeconds;
    else this.followingSeconds = Math.max(0, this.followingSeconds - deltaSeconds * 2);

    if (this.followingSeconds >= 1.8 && gap !== null) {
      this.emitEvent({
        code: "following_distance",
        correction: "Brake gently and rebuild at least a two-second gap.",
        evidence: {
          gapM: Math.round(gap * 10) / 10,
          recommendedGapM: Math.round(safeGap * 10) / 10,
        },
      });
      this.followingSeconds = 0;
    }
  }

  private monitorPassingLane(
    projection: LaneProjection,
    deltaSeconds: number,
  ): void {
    const speed = Math.abs(this.signedSpeedMps);
    const lane = projection.lane;
    const follower = this.followingNpc(lane, projection.distanceAlong);
    const adjacent = lane.adjacentLaneId
      ? this.lanesById.get(lane.adjacentLaneId)
      : undefined;
    const safeOpportunity = adjacent
      ? this.isPlayerLaneChangeClear(adjacent, projection.distanceAlong / lane.length)
      : false;
    const obstructing =
      lane.role === "passing" &&
      speed > 2 &&
      speed < lane.speedLimitMps * 0.82 &&
      follower !== null &&
      follower.gap < 34 &&
      follower.npc.speedMps > speed + 0.8 &&
      safeOpportunity;

    if (obstructing) this.passingLaneSeconds += deltaSeconds;
    else this.passingLaneSeconds = Math.max(0, this.passingLaneSeconds - deltaSeconds * 2);

    if (this.passingLaneSeconds >= 4 && follower) {
      const emitted = this.emitEvent({
        code: "lane_misuse",
        correction: "When the adjacent travel lane is clear, signal and move back. Do not exceed the speed limit.",
        evidence: {
          passingSide: this.config.trafficSide === "right" ? "left" : "right",
          followerGapM: Math.round(follower.gap * 10) / 10,
          safeReturnAvailable: true,
        },
      });
      if (emitted) {
        this.honkSeconds = 1.15;
        this.honkSourceNpcId = follower.npc.id;
      }
      this.passingLaneSeconds = 0;
    }
  }

  private checkStopLines(
    previousProjection: LaneProjection | null,
    currentProjection: LaneProjection | null,
  ): void {
    if (!currentProjection) return;
    const laneStopLines = this.stopLinesByLaneId.get(
      currentProjection.lane.id,
    );
    if (!laneStopLines) return;
    const speed = Math.abs(this.signedSpeedMps);
    for (const stopLine of laneStopLines) {
      const distanceAhead = stopLine.distance - currentProjection.distanceAlong;
      if (distanceAhead >= 0 && distanceAhead <= 14) {
        const previousMinimum = this.stopApproachSpeeds.get(stopLine.id) ?? Number.POSITIVE_INFINITY;
        this.stopApproachSpeeds.set(stopLine.id, Math.min(previousMinimum, speed));
      }
      if (
        !previousProjection ||
        previousProjection.lane.id !== currentProjection.lane.id ||
        previousProjection.distanceAlong >= stopLine.distance ||
        currentProjection.distanceAlong < stopLine.distance ||
        currentProjection.distanceAlong - previousProjection.distanceAlong > 8
      ) {
        continue;
      }

      if (
        (stopLine.kind === "traffic_light" || stopLine.kind === "railway") &&
        stopLine.trafficLightId
      ) {
        const light = this.trafficLightsById.get(stopLine.trafficLightId);
        const lightState = light ? this.trafficLightTiming(light).state : "green";
        const signalRequiresStop = stopLine.kind === "railway"
          ? lightState !== "green"
          : this.isRedSignalState(lightState);
        if (stopLine.kind === "railway") {
          const minimumSpeed = this.stopApproachSpeeds.get(stopLine.id) ?? speed;
          if (signalRequiresStop || minimumSpeed > 0.35) {
            this.emitEvent({
              code: "railway_crossing",
              correction:
                "Stop before the line, check that the tracks and exit are clear, then cross without stopping on the rails.",
              evidence: {
                trafficLightId: light?.id ?? "unknown",
                warningActive: signalRequiresStop,
                minimumApproachSpeedMps: Math.round(minimumSpeed * 10) / 10,
              },
            });
          }
        } else if (signalRequiresStop && light) {
          this.emitEvent({
            code: "red_light",
            correction: "Stop before the line and wait for a green signal.",
            evidence: {
              trafficLightId: light.id,
              speedMps: Math.round(speed * 10) / 10,
            },
          });
        }
      } else if (stopLine.kind === "stop") {
        const minimumSpeed = this.stopApproachSpeeds.get(stopLine.id) ?? speed;
        if (minimumSpeed > 0.35) {
          this.emitEvent({
            code: "incomplete_stop",
            correction: "Stop fully before the line, check for conflicts, then proceed.",
            evidence: { minimumApproachSpeedMps: Math.round(minimumSpeed * 10) / 10 },
          });
        }
      } else if (stopLine.kind === "yield") {
        const conflictRadius = stopLine.conflictRadius ?? 12;
        const linePose = this.pointOnLane(currentProjection.lane, stopLine.distance);
        const conflictingNpc = this.npcs.find(
          (npc) =>
            npc.active &&
            distanceSquared(npc, linePose) < conflictRadius * conflictRadius,
        );
        if (conflictingNpc && speed > 1.5) {
          this.emitEvent({
            code: "unsafe_gap",
            correction: "Reduce speed, observe the conflict area, and wait for a larger gap.",
            evidence: { conflictingVehicleId: conflictingNpc.id, speedMps: Math.round(speed * 10) / 10 },
          });
        }
      }

      if (stopLine.turnDirection && this.signal !== stopLine.turnDirection) {
        this.emitEvent({
          code: "missing_indicator",
          correction: "Signal early enough for other road users to understand your intention.",
          evidence: { expectedSignal: stopLine.turnDirection, actualSignal: this.signal },
        });
      }
      this.stopApproachSpeeds.delete(stopLine.id);
    }
  }

  private checkCollisions(oldPlayer: SimulationPoint): void {
    const collisionRadius = this.config.playerRadiusM + NPC_RADIUS_METRES;
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const relativeOldX = oldPlayer.x - npc.previousX;
      const relativeOldZ = oldPlayer.z - npc.previousZ;
      const relativeNewX = this.player.x - npc.x;
      const relativeNewZ = this.player.z - npc.z;
      const sweptDistanceSquared = distanceToSegmentSquared(
        0,
        0,
        relativeOldX,
        relativeOldZ,
        relativeNewX,
        relativeNewZ,
      );
      if (sweptDistanceSquared < collisionRadius * collisionRadius) {
        if (this.isNpcFaultCollision(npc)) {
          this.deactivateNpc(npc);
          this.signedSpeedMps = 0;
          continue;
        }
        const evidence = {
          vehicleId: npc.id,
          laneId: npc.laneId,
          npcSpeedMps: Math.round(npc.speedMps * 10) / 10,
          impactSpeedMps: Math.round(Math.abs(this.signedSpeedMps) * 10) / 10,
        };
        {
          // A crash is physical, not terminal. Separate the cars,
          // scrub the player's speed (a hard hit bonks back a touch), and sit
          // the struck car knocked askew for a few seconds; the ordinary jam
          // machinery clears any pile-up that forms behind it.
          const dx = this.player.x - npc.x;
          const dz = this.player.z - npc.z;
          const distance = Math.hypot(dx, dz);
          const nx =
            distance > 1e-6 ? dx / distance : Math.sin(this.player.heading);
          const nz =
            distance > 1e-6 ? dz / distance : Math.cos(this.player.heading);
          const overlap = collisionRadius - distance;
          if (overlap > 0) {
            this.player.x += nx * overlap;
            this.player.z += nz * overlap;
          }
          const closingMps = Math.abs(this.signedSpeedMps) + npc.speedMps;
          const travelSign = this.signedSpeedMps >= 0 ? 1 : -1;
          this.signedSpeedMps =
            closingMps >= STATIC_BONK_MIN_MPS
              ? -travelSign *
                Math.min(
                  STATIC_BONK_REBOUND_MAX_MPS,
                  closingMps * STATIC_BONK_REBOUND_FRACTION,
                )
              : this.signedSpeedMps * 0.25;
          npc.struckUntilTick = this.tick + NPC_STRUCK_TICKS;
          npc.speedMps = 0;
          npc.targetSpeedMps = 0;
          npc.state = "recovering";
          npc.signal = "off";
          npc.incidentLeanRad =
            (this.numericNpcId(npc.id) % 2 === 0 ? 1 : -1) *
            NPC_INCIDENT_KNOCK_RAD;
          // The separation shove must not bury the player in a facade.
          this.resolveStaticCollisions(false);
          this.emitEvent({
            code: "collision",
            correction:
              "Brake earlier, keep a safe gap, and check the space around the vehicle.",
            evidence,
          });
          continue;
        }
      }
    }
  }

  private isNpcFaultCollision(npc: NpcInternal): boolean {
    if (this.elapsedSeconds - npc.activatedAtSeconds < SPAWN_PREDICTION_SECONDS) {
      return true;
    }
    if (
      Math.abs(this.signedSpeedMps) > STOPPED_SPEED_MPS ||
      this.roadState.offRoad ||
      this.roadState.wrongWay
    ) {
      return false;
    }
    // A stationary, legally positioned player cannot cause a contact merely
    // by waiting. Any NPC that reaches that invariant corridor is recovered
    // without a player penalty, regardless of its rounded snapshot speed.
    return true;
  }

  private updateRoadState(): void {
    const projection = this.projectToRoad(this.player.x, this.player.z);
    const withinBounds =
      this.player.x >= this.config.bounds.minX &&
      this.player.x <= this.config.bounds.maxX &&
      this.player.z >= this.config.bounds.minZ &&
      this.player.z <= this.config.bounds.maxZ;
    if (!projection) {
      this.roadState = { projection: null, wrongWay: false, offRoad: true };
      return;
    }
    const effectiveHeading =
      this.signedSpeedMps < -STOPPED_SPEED_MPS
        ? wrapAngle(this.player.heading + Math.PI)
        : this.player.heading;
    const wrongWay =
      Math.abs(this.signedSpeedMps) > 1.2 &&
      Math.abs(angleDifference(effectiveHeading, projection.heading)) > Math.PI / 2;
    const allowedDistance = projection.lane.width / 2 + 2.1;
    this.roadState = {
      projection,
      wrongWay,
      offRoad: !withinBounds || projection.distance > allowedDistance,
    };
  }

  private projectToRoad(x: number, z: number): LaneProjection | null {
    let best: LaneProjection | null = null;
    for (const lane of this.lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.points.length - 1; index += 1) {
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount =
          lengthSquared > Number.EPSILON
            ? clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1)
            : 0;
        const nearestX = start.x + dx * amount;
        const nearestZ = start.z + dz * amount;
        const offsetX = x - nearestX;
        const offsetZ = z - nearestZ;
        const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
        if (!best || distance < best.distance) {
          best = {
            lane,
            distance,
            distanceAlong: accumulated + lane.segmentLengths[index] * amount,
            heading: Math.atan2(dx, dz),
            x: nearestX,
            z: nearestZ,
          };
        }
        accumulated += lane.segmentLengths[index];
      }
    }
    return best;
  }

  private pointOnLane(lane: NormalizedLane, rawDistance: number): SimulationPose {
    let distance = rawDistance;
    if (lane.loop && (distance < 0 || distance > lane.length)) {
      distance = ((distance % lane.length) + lane.length) % lane.length;
    } else {
      distance = clamp(distance, 0, lane.length);
    }
    let accumulated = 0;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const segmentLength = lane.segmentLengths[index];
      if (distance <= accumulated + segmentLength || index === lane.segmentLengths.length - 1) {
        const amount = segmentLength > 0 ? (distance - accumulated) / segmentLength : 0;
        const start = lane.points[index];
        const end = lane.points[index + 1];
        return {
          x: start.x + (end.x - start.x) * clamp(amount, 0, 1),
          z: start.z + (end.z - start.z) * clamp(amount, 0, 1),
          heading: Math.atan2(end.x - start.x, end.z - start.z),
        };
      }
      accumulated += segmentLength;
    }
    const final = lane.points[lane.points.length - 1];
    return { x: final.x, z: final.z, heading: 0 };
  }

  private distanceAhead(lane: NormalizedLane, from: number, to: number): number {
    const direct = to - from;
    if (direct >= 0) return direct;
    return lane.loop && this.areLaneEndpointsContinuous(lane, lane)
      ? direct + lane.length
      : Number.POSITIVE_INFINITY;
  }

  private routeDistanceAhead(
    fromLane: NormalizedLane,
    fromDistance: number,
    targetLane: NormalizedLane,
    targetDistance: number,
  ): number {
    if (fromLane.id === targetLane.id) {
      return this.distanceAhead(fromLane, fromDistance, targetDistance);
    }
    const queueLanes = this.routeQueueLanes;
    const queueDistances = this.routeQueueDistances;
    const queueDepths = this.routeQueueDepths;
    this.routeSearchGeneration += 1;
    const generation = this.routeSearchGeneration;
    let head = 0;
    let tail = 0;
    for (const successorId of fromLane.successorLaneIds) {
      const successor = this.lanesById.get(successorId);
      if (successor) {
        queueLanes[tail] = successor;
        queueDistances[tail] = fromLane.length - fromDistance;
        queueDepths[tail] = 1;
        tail += 1;
      }
    }
    let result = Number.POSITIVE_INFINITY;
    while (head < tail) {
      const lane = queueLanes[head];
      const distanceToStart = queueDistances[head];
      const depth = queueDepths[head];
      head += 1;
      if (depth > 6) continue;
      // Nothing asks about a car this far along the route. The depth cap alone
      // bounded the search by *hops*, so on a city with more roads leading out
      // of each junction the same six hops walked several hundred lanes — and
      // this runs for every pair of cars, every step. Every caller's threshold
      // is a following gap; the largest is a car at top speed wanting its
      // 1.8 s headway, under 62 m. See the note on the constant.
      if (distanceToStart > ROUTE_LOOKAHEAD_LIMIT_M) continue;
      const laneIndex = lane.index!;
      if (
        this.routeVisitedGeneration[laneIndex] === generation &&
        this.routeVisitedBest[laneIndex] <= distanceToStart
      ) {
        continue;
      }
      this.routeVisitedGeneration[laneIndex] = generation;
      this.routeVisitedBest[laneIndex] = distanceToStart;
      if (lane.id === targetLane.id) {
        result = distanceToStart + targetDistance;
        break;
      }
      for (const successorId of lane.successorLaneIds) {
        const successor = this.lanesById.get(successorId);
        if (!successor) continue;
        queueLanes[tail] = successor;
        queueDistances[tail] = distanceToStart + lane.length;
        queueDepths[tail] = depth + 1;
        tail += 1;
      }
    }
    // Drop the lane references so a search burst cannot pin lanes between
    // calls; the number arrays just keep their capacity.
    queueLanes.length = 0;
    return result;
  }

  private leadVehicleGap(
    lane: NormalizedLane,
    distance: number,
    excludedNpcId?: string,
  ): number | null {
    let best = Number.POSITIVE_INFINITY;
    for (const npc of this.npcs) {
      if (!npc.active || npc.id === excludedNpcId) continue;
      const npcLane = this.lanesById.get(npc.laneId);
      if (!npcLane) continue;
      const gap = this.routeDistanceAhead(lane, distance, npcLane, npc.distance);
      if (gap > 0.1 && gap < best) best = gap;
    }
    const playerProjection = this.roadState.projection;
    if (
      excludedNpcId &&
      playerProjection &&
      playerProjection.distance < playerProjection.lane.width
    ) {
      const playerGap = this.routeDistanceAhead(
        lane,
        distance,
        playerProjection.lane,
        playerProjection.distanceAlong,
      );
      if (playerGap > 0.1 && playerGap < best) best = playerGap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private followingNpc(
    lane: NormalizedLane,
    playerDistance: number,
  ): { npc: NpcInternal; gap: number } | null {
    let result: { npc: NpcInternal; gap: number } | null = null;
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const npcLane = this.lanesById.get(npc.laneId);
      if (!npcLane) continue;
      const gap = this.routeDistanceAhead(npcLane, npc.distance, lane, playerDistance);
      if (gap <= 0.1 || gap > 80) continue;
      if (!result || gap < result.gap) result = { npc, gap };
    }
    return result;
  }

  private redLightGapForLane(
    lane: NormalizedLane,
    distance: number,
  ): number | null {
    const laneStopLines = this.stopLinesByLaneId.get(lane.id);
    if (!laneStopLines) return null;
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of laneStopLines) {
      if (
        (stopLine.kind !== "traffic_light" && stopLine.kind !== "railway") ||
        !stopLine.trafficLightId
      ) {
        continue;
      }
      const light = this.trafficLightsById.get(stopLine.trafficLightId);
      if (!light || this.trafficLightTiming(light).state === "green") continue;
      const gap = this.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private yieldGapForLane(
    lane: NormalizedLane,
    distance: number,
  ): number | null {
    const laneStopLines = this.stopLinesByLaneId.get(lane.id);
    if (!laneStopLines) return null;
    let best = Number.POSITIVE_INFINITY;
    for (const stopLine of laneStopLines) {
      if (stopLine.kind !== "yield") continue;
      const linePose = this.pointOnLane(lane, stopLine.distance);
      const conflictRadius = stopLine.conflictRadius ?? 12;
      const hasConflict = this.npcs.some(
        (other) =>
          other.active &&
          other.laneId !== lane.id &&
          distanceSquared(other, linePose) < conflictRadius * conflictRadius,
      );
      if (!hasConflict) continue;
      const gap = this.distanceAhead(lane, distance, stopLine.distance);
      if (gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : null;
  }

  private isNpcLaneChangeClear(npc: NpcInternal, targetLane: NormalizedLane): boolean {
    const sourceLane = this.lanesById.get(npc.laneId);
    if (!sourceLane) return false;
    const targetDistance = (npc.distance / sourceLane.length) * targetLane.length;
    const npcClear = this.npcs.every((other) => {
      if (!other.active || other.id === npc.id) return true;
      if (other.targetLaneId === targetLane.id && distanceSquared(other, npc) < 24 * 24) {
        return false;
      }
      if (other.laneId !== targetLane.id) return true;
      const forward = this.distanceAhead(targetLane, targetDistance, other.distance);
      const backward = this.distanceAhead(targetLane, other.distance, targetDistance);
      return forward > 15 && backward > 11;
    });
    if (!npcClear) return false;
    const playerProjection = this.roadState.projection;
    if (
      !playerProjection ||
      playerProjection.lane.id !== targetLane.id ||
      playerProjection.distance >= targetLane.width
    ) {
      return true;
    }
    const forward = this.distanceAhead(
      targetLane,
      targetDistance,
      playerProjection.distanceAlong,
    );
    const backward = this.distanceAhead(
      targetLane,
      playerProjection.distanceAlong,
      targetDistance,
    );
    return forward > 16 && backward > 13;
  }

  private isPlayerLaneChangeClear(
    targetLane: NormalizedLane,
    normalizedDistance: number,
  ): boolean {
    const targetDistance = normalizedDistance * targetLane.length;
    return this.npcs.every((npc) => {
      if (!npc.active) return true;
      const npcDistance = this.npcDistanceOnLane(npc, targetLane);
      if (npcDistance === null) return true;
      const forward = this.distanceAhead(targetLane, targetDistance, npcDistance);
      const backward = this.distanceAhead(targetLane, npcDistance, targetDistance);
      return forward > 16 && backward > 13;
    });
  }

  private npcDistanceOnLane(
    npc: NpcInternal,
    targetLane: NormalizedLane,
  ): number | null {
    if (npc.laneId === targetLane.id) return npc.distance;
    if (npc.targetLaneId !== targetLane.id) return null;
    const sourceLane = this.lanesById.get(npc.laneId);
    if (!sourceLane) return null;
    return clamp(npc.distance / sourceLane.length, 0, 1) * targetLane.length;
  }


  private trafficLightTiming(light: NormalizedTrafficLight): {
    state: TrafficLightState;
    secondsUntilChange: number;
  } {
    const {
      greenSeconds,
      amberSeconds,
      allRedSeconds,
      redSeconds,
      redAmberSeconds,
      offsetSeconds = 0,
      sequence,
    } = light.cycle;
    const effectiveRedAmberSeconds = sequence === "uk" ? redAmberSeconds : 0;
    const duration =
      greenSeconds +
      amberSeconds +
      allRedSeconds +
      redSeconds +
      effectiveRedAmberSeconds;
    const phase = ((this.elapsedSeconds + offsetSeconds) % duration + duration) % duration;
    if (phase < greenSeconds) {
      return { state: "green", secondsUntilChange: greenSeconds - phase };
    }
    if (phase < greenSeconds + amberSeconds) {
      return {
        state: "amber",
        secondsUntilChange: greenSeconds + amberSeconds - phase,
      };
    }
    const allRedEnd = greenSeconds + amberSeconds + allRedSeconds;
    if (phase < allRedEnd) {
      return { state: "all_red", secondsUntilChange: allRedEnd - phase };
    }
    const redEnd = allRedEnd + redSeconds;
    if (phase < redEnd || effectiveRedAmberSeconds <= 0) {
      return {
        state: "red",
        secondsUntilChange:
          effectiveRedAmberSeconds <= 0 ? duration - phase : redEnd - phase,
      };
    }
    return { state: "red_amber", secondsUntilChange: duration - phase };
  }

  private isRedSignalState(state: TrafficLightState): boolean {
    return state === "red" || state === "red_amber" || state === "all_red";
  }

  private restoreSpawnPose(): void {
    this.player = { ...this.config.spawn };
    this.signedSpeedMps = 0;
    this.gear = "drive";
    this.signal = "off";
    this.signalStartHeading = this.player.heading;
    this.signalAutoCancelSeconds = 0;
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.viewHeading = this.player.heading;
    this.accumulatorSeconds = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.updateRoadState();
    this.reflowTrafficAroundPlayer();
  }

  private reflowTrafficAroundPlayer(): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const gate: NormalizedTrafficGate = {
        id: `reflow-${npc.id}`,
        laneId: npc.laneId,
        distance: npc.distance,
        desiredSpeedMps: npc.desiredSpeedMps,
        allowInitialSpawn: true,
      };
      if (!this.isTrafficGateSafe(npc, gate, true)) this.deactivateNpc(npc);
    }
    this.makeTrafficDecisions();
  }

  private emitEvent(details: {
    code: RuleCode;
    correction: string;
    evidence: Record<string, string | number | boolean>;
  }): SimulationRuleEvent | null {
    if ((this.ruleCooldowns.get(details.code) ?? 0) > 0) {
      return null;
    }
    const event: SimulationRuleEvent = {
      code: details.code,
      correction: details.correction,
      evidence: { ...details.evidence },
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENT_HISTORY) this.events.shift();
    this.ruleCooldowns.set(details.code, RULE_COOLDOWNS[details.code] ?? 2);
    return event;
  }

  private updateTimers(deltaSeconds: number): void {
    for (const [code, remaining] of this.ruleCooldowns) {
      const next = remaining - deltaSeconds;
      if (next <= 0) this.ruleCooldowns.delete(code);
      else this.ruleCooldowns.set(code, next);
    }
    this.honkSeconds = Math.max(0, this.honkSeconds - deltaSeconds);
    if (this.honkSeconds <= 0) this.honkSourceNpcId = null;
    this.playerHornSeconds = Math.max(0, this.playerHornSeconds - deltaSeconds);
  }

  private toDisplaySpeed(speedMps: number): number {
    const multiplier = this.config.speedUnit === "mph" ? 2.236936 : 3.6;
    return Math.round(speedMps * multiplier);
  }

  private boundsForLanes(lanes: readonly NormalizedLane[]): SimulationBounds {
    if (lanes.length === 0) {
      return { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const lane of lanes) {
      for (const point of lane.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
    }
    return {
      minX: minX - 10,
      maxX: maxX + 10,
      minZ: minZ - 5,
      maxZ: maxZ + 5,
    };
  }
}
