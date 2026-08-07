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
  TrafficSide,
} from "./types";
import {
  boundsForLanes,
  isRedSignalState,
  RoadNetwork,
  type LaneKind,
  type LaneProjection,
  type LaneRole,
  type SimulationLane,
  type StopLineDefinition,
  type TrafficLightCycle,
  type TrafficLightDefinition,
  type TrafficLightSequence,
  type TrafficLightState,
} from "./simulation/roadNetwork";
// Re-exported so every existing importer of "./simulation" keeps resolving
// these names unchanged — see docs/architecture.md's "simulation/ seams"
// section for why they now physically live in roadNetwork.ts.
export type {
  LaneKind,
  LaneRole,
  SimulationLane,
  StopLineDefinition,
  TrafficLightCycle,
  TrafficLightDefinition,
  TrafficLightSequence,
  TrafficLightState,
};
import {
  angleDifference,
  clamp,
  distanceSquared,
  distanceToSegmentSquared,
  wrapAngle,
} from "./simulation/mathUtils";
import {
  movePlayer as movePlayerImpl,
  normalizeStaticObstacle,
  PLAYER_CAPSULE_HALF_LENGTH_M,
  PLAYER_CAPSULE_RADIUS_M,
  PLAYER_RADIUS_METRES,
  resolveStaticCollisions as resolveStaticCollisionsImpl,
  setPlayerSignal,
  STATIC_BONK_MIN_MPS,
  STATIC_BONK_REBOUND_FRACTION,
  STATIC_BONK_REBOUND_MAX_MPS,
  STOPPED_SPEED_MPS,
  type PlayerPhysicsState,
  type StaticObstacleInternal,
} from "./simulation/playerDynamics";
import {
  normalizeSeed,
  NPC_INCIDENT_KNOCK_RAD,
  NPC_RADIUS_METRES,
  NPC_STRUCK_TICKS,
  RUNTIME_FORWARD_VISIBILITY_DISTANCE_M,
  RUNTIME_REAR_VISIBILITY_DISTANCE_M,
  SPAWN_PREDICTION_SECONDS,
  TRAFFIC_DECISION_SECONDS,
  TrafficSystem,
  type NpcDrivingState,
  type NpcInternal,
  type NpcVehicleVariant,
  type SimulationTrafficGate,
  type TrafficTickCtx,
} from "./simulation/trafficSystem";
// Re-exported for the same reason as roadNetwork.ts's block above.
export type { NpcDrivingState, NpcVehicleVariant, SimulationTrafficGate };
export { RUNTIME_FORWARD_VISIBILITY_DISTANCE_M, RUNTIME_REAR_VISIBILITY_DISTANCE_M };

export const SIMULATION_HZ = 60;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;

const MAX_FRAME_SECONDS = 0.25;
// Every NPC_*/traffic-gate/corner-arc/runtime-visibility constant moved to
// simulation/trafficSystem.ts with the methods that read them. The handful
// simulation.ts's own checkCollisions/isNpcFaultCollision/fixedUpdate still
// need (NPC_RADIUS_METRES, NPC_STRUCK_TICKS, NPC_INCIDENT_KNOCK_RAD,
// SPAWN_PREDICTION_SECONDS, TRAFFIC_DECISION_SECONDS,
// RUNTIME_FORWARD_VISIBILITY_DISTANCE_M,
// RUNTIME_REAR_VISIBILITY_DISTANCE_M) are imported above instead.
const MAX_EVENT_HISTORY = 80;

export type SimulationRuleEvent = RuleEvent;
export type SimulationStatus = "running" | "paused" | "disposed";
export type TurnSignal = "off" | "left" | "right";

export interface SimulationPoint {
  readonly x: number;
  readonly z: number;
}

export interface SimulationPose extends SimulationPoint {
  /** Radians, with zero pointing toward positive Z. */
  readonly heading: number;
}

export interface SimulationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
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

// Exported (unlike simulation.ts's other internal types) only so
// simulation/playerDynamics.ts can reference the shape of the mutable pose
// it operates on via a type-only back-reference — the same sanctioned
// pattern as importing SimulationPoint/SimulationPose/TurnSignal.
export interface MutablePose {
  x: number;
  z: number;
  heading: number;
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

/**
 * A fixed-step arcade driving simulation. `step` may receive render-frame delta
 * times; the core internally advances at exactly 60 Hz and makes traffic
 * decisions at exactly 10 Hz.
 */
export class SimulationCore {
  readonly fixedStepSeconds = FIXED_STEP_SECONDS;

  private readonly config: InternalConfig;
  /** The authored lane graph, traffic lights, and stop lines, plus every
   * pure query against them — see `simulation/roadNetwork.ts`. */
  private readonly roadNetwork: RoadNetwork;
  private readonly laneRestrictions: LaneRestriction[];
  private readonly boxJunctions: SimulationBoxJunctionDefinition[];
  private readonly staticObstacles: StaticObstacleInternal[];
  private readonly initialSeed: number;

  /** Player pose, speed, gear, signal, and the two accumulators
   * `movePlayer` owns — see `simulation/playerDynamics.ts`. Assigned once
   * in the constructor and never reassigned wholesale afterward (`reset()`
   * and `restoreSpawnPose()` only reassign its `.player` sub-property), so
   * it is safe for anything holding a reference to read through at any time. */
  private readonly playerState: PlayerPhysicsState;
  /** Seeded NPC spawn, routing, movement, signals, and jam/incident
   * recovery — see `simulation/trafficSystem.ts`. */
  private readonly trafficSystem: TrafficSystem;
  private continuousInput: ContinuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
  private viewHeading = 0;
  private previousActions: Record<string, boolean> = {};
  private accumulatorSeconds = 0;
  private trafficDecisionAccumulator = 0;
  private elapsedSeconds = 0;
  private tick = 0;
  private status: SimulationStatus = "running";
  private disposed = false;
  private events: SimulationRuleEvent[] = [];
  private ruleCooldowns = new Map<RuleCode, number>();
  private roadState: RoadState = {
    projection: null,
    wrongWay: false,
    offRoad: false,
  };
  private wrongWaySeconds = 0;
  private offRoadSeconds = 0;
  private speedingSeconds = 0;
  private followingSeconds = 0;
  private passingLaneSeconds = 0;
  private honkSeconds = 0;
  private honkSourceNpcId: string | null = null;
  private playerHornSeconds = 0;
  private stopApproachSpeeds = new Map<string, number>();
  private restrictedLaneSeconds = new Map<string, number>();

  constructor(configuration: SimulationCoreConfig = {}) {
    const trafficSide = configuration.trafficSide ?? "right";
    // Traffic-light and stop-line normalization moved earlier than their
    // original position (they used to run after `this.config` was built,
    // just below): neither ever read `this.config`, so folding all three
    // into one RoadNetwork constructor call is behaviourally identical.
    this.roadNetwork = new RoadNetwork(
      configuration.lanes ?? [],
      configuration.trafficLights ?? [],
      configuration.stopLines ?? [],
    );

    const defaultSpawnLane =
      this.roadNetwork.lanes.find((lane) => lane.role === "travel") ?? this.roadNetwork.lanes[0];
    const defaultSpawn = defaultSpawnLane
      ? this.roadNetwork.pointOnLane(defaultSpawnLane, 15)
      : { x: 0, z: 0, heading: 0 };
    const spawn: SimulationPose = configuration.spawn
      ? {
          x: configuration.spawn.x,
          z: configuration.spawn.z,
          heading: wrapAngle(configuration.spawn.heading),
        }
      : defaultSpawn;
    const defaultBounds = boundsForLanes(this.roadNetwork.lanes);
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

    this.laneRestrictions = (configuration.laneRestrictions ?? [])
      .filter((restriction) => this.roadNetwork.lanesById.has(restriction.laneId))
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
          junction.laneIds.some((laneId) => this.roadNetwork.lanesById.has(laneId)),
      )
      .map((junction) => ({
        ...junction,
        polygon: junction.polygon.map((point) => ({ ...point })),
        laneIds: junction.laneIds.filter((laneId) => this.roadNetwork.lanesById.has(laneId)),
        exitLaneIds: (junction.exitLaneIds ?? junction.laneIds).filter((laneId) =>
          this.roadNetwork.lanesById.has(laneId),
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

    // Matches the pre-split field initializers exactly (signalStartHeading
    // was `= 0`, not spawn-derived) — inert either way, since reset() below
    // immediately overwrites every one of these except `player` itself.
    this.playerState = {
      player: { ...spawn },
      signedSpeedMps: 0,
      gear: "drive",
      signal: "off",
      signalStartHeading: 0,
      signalAutoCancelSeconds: 0,
      distanceTravelledM: 0,
      unstableControlSeconds: 0,
    };
    this.trafficSystem = new TrafficSystem(
      configuration.trafficGates ?? [],
      this.roadNetwork,
      this.playerState,
      this.config,
      this.initialSeed,
    );
    this.reset();
  }

  /** The volatile-per-tick inputs TrafficSystem's methods need, built fresh
   * at every call site — see TrafficTickCtx's own doc comment in
   * trafficSystem.ts for why these four specifically cannot be captured
   * once by that class instead. */
  private trafficCtx(): TrafficTickCtx {
    return {
      viewHeading: this.viewHeading,
      roadState: this.roadState,
      elapsedSeconds: this.elapsedSeconds,
      tick: this.tick,
    };
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
    return this.selectGear(this.playerState.gear === "drive" ? "reverse" : "drive");
  }

  selectGear(nextGear: Gear): boolean {
    if (Math.abs(this.playerState.signedSpeedMps) > STOPPED_SPEED_MPS) {
      return false;
    }
    this.playerState.gear = nextGear;
    this.playerState.signedSpeedMps = 0;
    return true;
  }

  /** Restarts the run from its initial seed, authored pose, traffic, and clock. */
  reset(): SimulationSnapshot {
    if (this.disposed) return this.getSnapshot();
    // resetForNewRun folds the old `this.random = new SeededRandom(...)` and
    // (below) `this.npcDigitCache.clear()` into one call — the two are
    // independent resets with nothing between their original positions
    // reading either, so combining them cannot change behaviour.
    this.trafficSystem.resetForNewRun(this.initialSeed);
    this.playerState.player = { ...this.config.spawn };
    this.playerState.signedSpeedMps = 0;
    this.playerState.gear = "drive";
    this.playerState.signal = "off";
    this.playerState.signalStartHeading = this.playerState.player.heading;
    this.playerState.signalAutoCancelSeconds = 0;
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.viewHeading = this.playerState.player.heading;
    this.previousActions = {};
    this.accumulatorSeconds = 0;
    this.trafficDecisionAccumulator = 0;
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.status = "running";
    // Pure scratch — stale content is unreadable behind the generation
    // pre-increment, but a reset run should start from a clean slate anyway.
    this.roadNetwork.resetRouteSearch();
    this.events = [];
    this.ruleCooldowns.clear();
    this.playerState.distanceTravelledM = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.playerState.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.trafficSystem.spawnNpcs(this.config.npcCount, this.trafficCtx());
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
    this.playerState.player.x = pose.x;
    this.playerState.player.z = pose.z;
    this.playerState.player.heading = wrapAngle(pose.heading);
    this.playerState.signedSpeedMps = speedMps;
    this.viewHeading = this.playerState.player.heading;
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
    this.playerState.signedSpeedMps *= clamp(speedScale, 0, 1);
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
      speedDisplay: this.toDisplaySpeed(Math.abs(this.playerState.signedSpeedMps)),
      player: {
        x: this.playerState.player.x,
        z: this.playerState.player.z,
        heading: this.playerState.player.heading,
        speedMps: Math.abs(this.playerState.signedSpeedMps),
        signedSpeedMps: this.playerState.signedSpeedMps,
        gear: this.playerState.gear,
        signal: this.playerState.signal,
        hornActive: this.playerHornSeconds > 0,
        canChangeGear: Math.abs(this.playerState.signedSpeedMps) <= STOPPED_SPEED_MPS,
        distanceTravelledM: this.playerState.distanceTravelledM,
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
      npcs: this.trafficSystem.npcs
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
      queuedNpcCount: this.trafficSystem.npcs.filter((npc) => !npc.active).length,
      trafficLights: this.roadNetwork.trafficLights.map((light) => {
        const timing = this.roadNetwork.trafficLightTiming(light, this.elapsedSeconds);
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
    this.trafficSystem.dispose();
    this.ruleCooldowns.clear();
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
  }

  private fixedUpdate(deltaSeconds: number): void {
    this.tick += 1;
    this.elapsedSeconds += deltaSeconds;
    this.updateTimers(deltaSeconds);

    const oldPlayer = { ...this.playerState.player };
    const previousProjection = this.roadNetwork.projectToRoad(oldPlayer.x, oldPlayer.z);
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
    if (action("signalLeft")) this.setSignal(this.playerState.signal === "left" ? "off" : "left");
    if (action("signalRight")) this.setSignal(this.playerState.signal === "right" ? "off" : "right");
    if (action("cancelSignal")) this.setSignal("off");
    if (action("horn")) this.playerHornSeconds = 0.35;
  }

  private setSignal(signal: TurnSignal): void {
    setPlayerSignal(this.playerState, signal);
  }

  private clearActiveInput(): void {
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.accumulatorSeconds = 0;
  }

  private movePlayer(deltaSeconds: number): void {
    movePlayerImpl(
      this.playerState,
      deltaSeconds,
      this.continuousInput,
      this.config,
      this.staticObstacles,
      this.status,
      (details) => this.emitEvent(details),
    );
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
    resolveStaticCollisionsImpl(
      this.playerState,
      this.config,
      this.staticObstacles,
      allowEvents,
      this.status,
      (details) => this.emitEvent(details),
      FIXED_STEP_SECONDS,
    );
  }

  private makeTrafficDecisions(): void {
    this.trafficSystem.makeTrafficDecisions(this.trafficCtx());
  }

  private moveNpcs(deltaSeconds: number): void {
    this.trafficSystem.moveNpcs(deltaSeconds, this.trafficCtx());
  }

  private updateNpcIncidents(deltaSeconds: number): void {
    this.trafficSystem.updateNpcIncidents(deltaSeconds, this.trafficCtx());
  }

  private monitorRoadRules(deltaSeconds: number): void {
    const projection = this.roadState.projection;
    const speed = Math.abs(this.playerState.signedSpeedMps);

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
    if (!projection || Math.abs(this.playerState.signedSpeedMps) < 0.5) return;

    for (const junction of this.boxJunctions) {
      if (!junction.laneIds.includes(projection.lane.id)) continue;
      const entered =
        !isPointInPolygon(previousPlayer, junction.polygon) &&
        isPointInPolygon(this.playerState.player, junction.polygon);
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
          speedMps: Math.round(Math.abs(this.playerState.signedSpeedMps) * 10) / 10,
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
    for (const npc of this.trafficSystem.npcs) {
      if (!npc.active) continue;
      if (!exitLaneIds.includes(npc.laneId)) continue;
      if (distanceToPolygon(npc, junction.polygon) > clearance) continue;
      if (npc.laneId === playerProjection.lane.id) {
        const gap = this.roadNetwork.distanceAhead(
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
        Math.abs(this.playerState.signedSpeedMps) >= 0.8 &&
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
    const speed = Math.abs(this.playerState.signedSpeedMps);
    if (speed < 2 || projection.distance > projection.lane.width) {
      this.followingSeconds = 0;
      return;
    }
    const gap = this.trafficSystem.leadVehicleGap(projection.lane, projection.distanceAlong, this.trafficCtx());
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
    const speed = Math.abs(this.playerState.signedSpeedMps);
    const lane = projection.lane;
    const follower = this.trafficSystem.followingNpc(lane, projection.distanceAlong);
    const adjacent = lane.adjacentLaneId
      ? this.roadNetwork.lanesById.get(lane.adjacentLaneId)
      : undefined;
    const safeOpportunity = adjacent
      ? this.trafficSystem.isPlayerLaneChangeClear(adjacent, projection.distanceAlong / lane.length)
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
    const laneStopLines = this.roadNetwork.stopLinesByLaneId.get(
      currentProjection.lane.id,
    );
    if (!laneStopLines) return;
    const speed = Math.abs(this.playerState.signedSpeedMps);
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
        const light = this.roadNetwork.trafficLightsById.get(stopLine.trafficLightId);
        const lightState = light ? this.roadNetwork.trafficLightTiming(light, this.elapsedSeconds).state : "green";
        const signalRequiresStop = stopLine.kind === "railway"
          ? lightState !== "green"
          : isRedSignalState(lightState);
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
        const linePose = this.roadNetwork.pointOnLane(currentProjection.lane, stopLine.distance);
        const conflictingNpc = this.trafficSystem.npcs.find(
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

      if (stopLine.turnDirection && this.playerState.signal !== stopLine.turnDirection) {
        this.emitEvent({
          code: "missing_indicator",
          correction: "Signal early enough for other road users to understand your intention.",
          evidence: { expectedSignal: stopLine.turnDirection, actualSignal: this.playerState.signal },
        });
      }
      this.stopApproachSpeeds.delete(stopLine.id);
    }
  }

  private checkCollisions(oldPlayer: SimulationPoint): void {
    const collisionRadius = this.config.playerRadiusM + NPC_RADIUS_METRES;
    for (const npc of this.trafficSystem.npcs) {
      if (!npc.active) continue;
      const relativeOldX = oldPlayer.x - npc.previousX;
      const relativeOldZ = oldPlayer.z - npc.previousZ;
      const relativeNewX = this.playerState.player.x - npc.x;
      const relativeNewZ = this.playerState.player.z - npc.z;
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
          this.trafficSystem.deactivateNpc(npc);
          this.playerState.signedSpeedMps = 0;
          continue;
        }
        const evidence = {
          vehicleId: npc.id,
          laneId: npc.laneId,
          npcSpeedMps: Math.round(npc.speedMps * 10) / 10,
          impactSpeedMps: Math.round(Math.abs(this.playerState.signedSpeedMps) * 10) / 10,
        };
        {
          // A crash is physical, not terminal. Separate the cars,
          // scrub the player's speed (a hard hit bonks back a touch), and sit
          // the struck car knocked askew for a few seconds; the ordinary jam
          // machinery clears any pile-up that forms behind it.
          const dx = this.playerState.player.x - npc.x;
          const dz = this.playerState.player.z - npc.z;
          const distance = Math.hypot(dx, dz);
          const nx =
            distance > 1e-6 ? dx / distance : Math.sin(this.playerState.player.heading);
          const nz =
            distance > 1e-6 ? dz / distance : Math.cos(this.playerState.player.heading);
          const overlap = collisionRadius - distance;
          if (overlap > 0) {
            this.playerState.player.x += nx * overlap;
            this.playerState.player.z += nz * overlap;
          }
          const closingMps = Math.abs(this.playerState.signedSpeedMps) + npc.speedMps;
          const travelSign = this.playerState.signedSpeedMps >= 0 ? 1 : -1;
          this.playerState.signedSpeedMps =
            closingMps >= STATIC_BONK_MIN_MPS
              ? -travelSign *
                Math.min(
                  STATIC_BONK_REBOUND_MAX_MPS,
                  closingMps * STATIC_BONK_REBOUND_FRACTION,
                )
              : this.playerState.signedSpeedMps * 0.25;
          npc.struckUntilTick = this.tick + NPC_STRUCK_TICKS;
          npc.speedMps = 0;
          npc.targetSpeedMps = 0;
          npc.state = "recovering";
          npc.signal = "off";
          npc.incidentLeanRad =
            (this.trafficSystem.numericNpcId(npc.id) % 2 === 0 ? 1 : -1) *
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
      Math.abs(this.playerState.signedSpeedMps) > STOPPED_SPEED_MPS ||
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
    const projection = this.roadNetwork.projectToRoad(this.playerState.player.x, this.playerState.player.z);
    const withinBounds =
      this.playerState.player.x >= this.config.bounds.minX &&
      this.playerState.player.x <= this.config.bounds.maxX &&
      this.playerState.player.z >= this.config.bounds.minZ &&
      this.playerState.player.z <= this.config.bounds.maxZ;
    if (!projection) {
      this.roadState = { projection: null, wrongWay: false, offRoad: true };
      return;
    }
    const effectiveHeading =
      this.playerState.signedSpeedMps < -STOPPED_SPEED_MPS
        ? wrapAngle(this.playerState.player.heading + Math.PI)
        : this.playerState.player.heading;
    const wrongWay =
      Math.abs(this.playerState.signedSpeedMps) > 1.2 &&
      Math.abs(angleDifference(effectiveHeading, projection.heading)) > Math.PI / 2;
    const allowedDistance = projection.lane.width / 2 + 2.1;
    this.roadState = {
      projection,
      wrongWay,
      offRoad: !withinBounds || projection.distance > allowedDistance,
    };
  }

  private restoreSpawnPose(): void {
    this.playerState.player = { ...this.config.spawn };
    this.playerState.signedSpeedMps = 0;
    this.playerState.gear = "drive";
    this.playerState.signal = "off";
    this.playerState.signalStartHeading = this.playerState.player.heading;
    this.playerState.signalAutoCancelSeconds = 0;
    this.continuousInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };
    this.viewHeading = this.playerState.player.heading;
    this.accumulatorSeconds = 0;
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.playerState.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
    this.updateRoadState();
    this.reflowTrafficAroundPlayer();
  }

  private reflowTrafficAroundPlayer(): void {
    this.trafficSystem.reflowTrafficAroundPlayer(this.trafficCtx());
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

}
