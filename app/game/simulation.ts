/**
 * Deterministic, renderer-agnostic simulation for SideSwap.
 *
 * This module deliberately has no React, DOM, audio, or Babylon dependencies.
 * Consumers provide normalized inputs and render the serializable snapshots.
 */
import type {
  Gear,
  LaneRestriction,
  RuleCode,
  RuleEvent,
  ScenarioClock,
  ServiceArea,
  SpeedUnit,
  StaticObstacle,
  TrafficSide,
} from "./types";
import {
  boundsForLanes,
  RoadNetwork,
  type LaneKind,
  type LaneProjection,
  type LaneRole,
  type RouteSearchCounterSnapshot,
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
  RouteSearchCounterSnapshot,
  SimulationLane,
  StopLineDefinition,
  TrafficLightCycle,
  TrafficLightDefinition,
  TrafficLightSequence,
  TrafficLightState,
};
import type {
  SimulationRailLine,
  SimulationRailSchedule,
} from "./simulation/railSchedule";
// Re-exported for the same reason: the adapter and renderer name rail types
// through the facade; the math itself stays in railSchedule.ts.
export type { SimulationRailLine, SimulationRailSchedule };
import {
  angleDifference,
  clamp,
  distanceToPolygon,
  distanceToSegmentSquared,
  isPointInPolygon,
  wrapAngle,
} from "./simulation/mathUtils";
import { normalizeAmbientVehicleSlotCount } from "./simulation/ambientTraffic";
import {
  ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
  roadElevationSweepsCanInteract,
} from "./simulation/roadLevels";
import type { RuntimeTrafficPortal } from "./simulation/trafficLocality";
// Re-exported: isPointInPolygon is a genuine external (non-test) dependency
// — app/game/geometry/waterGeometry.ts imports it from "./simulation" at
// runtime — so both names must keep resolving from this path unchanged.
export { distanceToPolygon, isPointInPolygon };
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
  type StaticCollisionStepCounters,
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
  type TrafficLocalityDiagnostics,
  type TrafficSpatialIndexDiagnostics,
  type TrafficTickCtx,
} from "./simulation/trafficSystem";
// Re-exported for the same reason as roadNetwork.ts's block above.
export type {
  NpcDrivingState,
  NpcVehicleVariant,
  SimulationTrafficGate,
  TrafficLocalityDiagnostics,
  TrafficSpatialIndexDiagnostics,
};
export type { RuntimeTrafficPortal };
import {
  isLaneRestrictionActive,
  isRestrictionWindowActive,
  RoadRuleMonitor,
  type SimulationBoxJunctionDefinition,
} from "./simulation/roadRuleMonitor";
// Re-exported for the same reason as roadNetwork.ts's block above —
// isRestrictionWindowActive is also a genuine external (test) dependency:
// tests/simulation.test.ts imports it from "../app/game/simulation" directly.
export { isLaneRestrictionActive, isRestrictionWindowActive };
export type { SimulationBoxJunctionDefinition };
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
/** Small visual/physics tolerance above the model's authored roof height. */
const PLAYER_ROOF_CLEARANCE_MARGIN_M = 0.08;
const OVERHEAD_COLLISION_EVENT_MIN_MPS = 2;
const OVERHEAD_BOUNDARY_SEARCH_STEPS = 12;

export type SimulationRuleEvent = RuleEvent;
export type SimulationStatus = "running" | "paused" | "disposed";
export type TurnSignal = "off" | "left" | "right";

export interface SimulationPoint {
  readonly x: number;
  readonly z: number;
  /** Authored road height used for flyover presentation; omitted is at grade. */
  readonly elevationM?: number;
}

export interface SimulationPose extends SimulationPoint {
  /** Radians, with zero pointing toward positive Z. */
  readonly heading: number;
}

/**
 * The lowest raised-road obstruction above one vehicle-footprint sample.
 * This deliberately mirrors only the plain-data portion of
 * `ElevatedRoadGroundClearance`; the simulation does not depend on render
 * geometry, and the adapter supplies the prepared authored query.
 */
export interface SimulationElevatedRoadGroundClearance {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly obstructionKind: "raised_surface" | "deck" | "pier";
  readonly roadSurfaceElevationM: number;
  readonly clearanceM: number;
}

export type SimulationElevatedRoadGroundClearanceQuery = (
  point: { readonly x: number; readonly z: number },
  groundElevationM?: number,
  footprintRadiusM?: number,
  excludedSurfaceIds?: ReadonlySet<string>,
  minimumVerticalSeparationM?: number,
) => SimulationElevatedRoadGroundClearance | null;

export interface SimulationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
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
  /** Rail timetables driving `rail`-tied crossing heads; see railSchedule.ts. */
  readonly railLines?: readonly SimulationRailLine[];
  readonly trafficGates?: readonly SimulationTrafficGate[];
  /**
   * Dense runtime-only portals used to keep the fixed fleet around the player.
   * Authored traffic gates remain separate so authored identities/placements
   * keep their existing semantics.
   */
  readonly runtimeTrafficPortals?: readonly RuntimeTrafficPortal[];
  /** Directional lanes that contribute to local traffic-capacity targets. */
  readonly trafficCapacityLaneIds?: readonly string[];
  /** The same device class used to resolve the shared ambient slot budget. */
  readonly touchFirst?: boolean;
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
  /** Highest physical point above the tyres, used for bridge soffit checks. */
  readonly playerClearanceHeightM?: number;
  /**
   * Prepared authored raised-road query. The adapter excludes supports here
   * because their existing static colliders remain the authoritative response.
   */
  readonly elevatedRoadGroundClearanceAt?: SimulationElevatedRoadGroundClearanceQuery;
  /**
   * Solid world geometry (buildings, venue lots, world edges) the player car
   * is resolved against every step. Plain data from the adapter; omitting it
   * leaves the world open for focused physics tests.
   */
  readonly staticObstacles?: readonly StaticObstacle[];
  /**
   * Forecourts and repair-shop aprons: ground the driver is *meant* to leave
   * the carriageway for, where the lane-relative rules stop applying. See
   * `ServiceArea` and `updateRoadState`. Omitting it (focused tests, a map
   * with no service points) simply means no amnesty anywhere.
   */
  readonly serviceAreas?: readonly ServiceArea[];
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
  elevationM?: number;
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
  runtimeTrafficPortals: readonly RuntimeTrafficPortal[];
  trafficCapacityLaneIds: readonly string[];
  touchFirst: boolean;
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
  playerClearanceHeightM: number;
}

interface RoadState {
  projection: LaneProjection | null;
  wrongWay: boolean;
  offRoad: boolean;
  /**
   * The car is off the carriageway *and* on a service point's forecourt or
   * apron — legally off the road rather than illegally off it. `projection`,
   * `wrongWay` and `offRoad` stay factual about the nearest lane while this is
   * set; it is `roadRuleMonitor` that stops judging the car against it.
   */
  inServiceArea: boolean;
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
  roundabout_yield: 5,
  observation: 8,
  // One crossing incursion is one ticket: the line-crossing detector can
  // retrigger on the paired opposite-direction stop line seconds later, and
  // the fine behind it is the game's heftiest.
  railway_crossing: 15,
  // Grinding along a wall or a knocked car re-contacts every step; one event
  // per contact burst is what the damage/fine layers upstream want to see.
  collision: 2.5,
};

/** One immutable read of `SimulationCore`'s static-collision instrumentation
 * — see `getStaticCollisionCounters`. Behavior-neutral: nothing here changes
 * a collision result, it only counts the work done producing one. */
export interface StaticCollisionCounterSnapshot {
  readonly lastStep: StaticCollisionStepCounters;
  readonly cumulative: {
    readonly steps: number;
    readonly candidates: number;
    readonly narrowTests: number;
    readonly iterations: number;
    readonly maxCandidates: number;
    readonly maxNarrowTests: number;
  };
}

/** External-only traffic instrumentation. The simulation never reads these
 * counters, so browser/benchmark polling cannot influence a replay. */
export interface TrafficDiagnosticsSnapshot {
  readonly routeSearch: RouteSearchCounterSnapshot;
  readonly spatialIndex: TrafficSpatialIndexDiagnostics;
  readonly locality: TrafficLocalityDiagnostics;
  readonly activeNpcCount: number;
  readonly queuedNpcCount: number;
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
  private readonly hasElevatedRoads: boolean;
  private readonly elevatedRoadGroundClearanceAt:
    | SimulationElevatedRoadGroundClearanceQuery
    | null;
  /** Reused carrier-road filter for the three vehicle roof samples. */
  private readonly elevatedRoadCarrierSurfaceIds = new Set<string>();
  private readonly staticObstacles: StaticObstacleInternal[];
  /** Forecourts and repair-shop aprons — see `isInsideServiceArea`. */
  private readonly serviceAreas: readonly ServiceArea[];
  private readonly initialSeed: number;
  /**
   * Static-collision instrumentation (see docs/simulation-core.md). Zeroed at
   * the top of every `fixedUpdate` and folded into `staticCollisionCumulative`
   * in that same call's `finally`, regardless of which of `fixedUpdate`'s
   * several early `return`s fires. Deliberately NOT reset by `reset()`: these
   * are session-long diagnostic counters with their own lifecycle
   * (`resetStaticCollisionCounters`), the same pattern
   * `render/babylonGameSession.ts`'s `perfSumMs`/`perfMaxMs` already use —
   * they survive a drive reset and are drained by polling instead. Never fed
   * back into a collision result, so this exclusion cannot desync a replay.
   */
  private readonly staticCollisionLastStep: StaticCollisionStepCounters = {
    candidates: 0,
    narrowTests: 0,
    iterations: 0,
  };
  private staticCollisionCumulative = {
    steps: 0,
    candidates: 0,
    narrowTests: 0,
    iterations: 0,
    maxCandidates: 0,
    maxNarrowTests: 0,
  };

  /** Player pose, speed, gear, signal, and the two accumulators
   * `movePlayer` owns — see `simulation/playerDynamics.ts`. Assigned once
   * in the constructor and never reassigned wholesale afterward (`reset()`
   * and `restoreSpawnPose()` only reassign its `.player` sub-property), so
   * it is safe for anything holding a reference to read through at any time. */
  private readonly playerState: PlayerPhysicsState;
  /** Seeded NPC spawn, routing, movement, signals, and jam/incident
   * recovery — see `simulation/trafficSystem.ts`. */
  private readonly trafficSystem: TrafficSystem;
  /** Open-world rule detection (speeding, wrong-way, box junctions,
   * restricted lanes, every stop-line kind) — see
   * `simulation/roadRuleMonitor.ts`. */
  private readonly roadRuleMonitor: RoadRuleMonitor;
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
    inServiceArea: false,
  };
  // Honk playback state is set by roadRuleMonitor.monitorPassingLane (via the
  // onHonk callback) but stays facade-owned: getSnapshot (output) and
  // updateTimers (decay) both need it, and neither is a rule-monitor concern.
  private honkSeconds = 0;
  private honkSourceNpcId: string | null = null;
  private playerHornSeconds = 0;

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
      configuration.railLines ?? [],
    );
    this.hasElevatedRoads = this.roadNetwork.lanes.some((lane) =>
      lane.points.some(
        (point) =>
          (point.elevationM ?? 0) >= ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
      ),
    );
    this.elevatedRoadGroundClearanceAt =
      configuration.elevatedRoadGroundClearanceAt ?? null;

    const defaultSpawnLane =
      this.roadNetwork.lanes.find((lane) => lane.role === "travel") ?? this.roadNetwork.lanes[0];
    const defaultSpawn = defaultSpawnLane
      ? this.roadNetwork.pointOnLane(defaultSpawnLane, 15)
      : { x: 0, z: 0, heading: 0 };
    const spawn: SimulationPose = configuration.spawn
      ? {
          x: configuration.spawn.x,
          z: configuration.spawn.z,
          ...(Number.isFinite(configuration.spawn.elevationM) &&
          (configuration.spawn.elevationM ?? 0) > 0
            ? { elevationM: configuration.spawn.elevationM }
            : {}),
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
      npcCount: normalizeAmbientVehicleSlotCount(configuration.npcCount ?? 10),
      runtimeTrafficPortals: configuration.runtimeTrafficPortals
        ? [...configuration.runtimeTrafficPortals]
        : [],
      trafficCapacityLaneIds: configuration.trafficCapacityLaneIds
        ? [...configuration.trafficCapacityLaneIds]
        : [],
      touchFirst: Boolean(configuration.touchFirst),
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
      playerClearanceHeightM: clamp(
        configuration.playerClearanceHeightM ?? 1.5,
        0.5,
        4,
      ),
    };

    // Broad-phase bounds are tested against the player centre, so inflate by
    // the capsule's full reach plus one step of travel headroom.
    const obstacleInflationM =
      this.config.playerCapsuleHalfLengthM + this.config.playerCapsuleRadiusM + 1;
    this.staticObstacles = (configuration.staticObstacles ?? []).map(
      (obstacle) => normalizeStaticObstacle(obstacle, obstacleInflationM),
    );
    this.serviceAreas = configuration.serviceAreas ?? [];

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
    this.roadRuleMonitor = new RoadRuleMonitor(
      configuration.laneRestrictions ?? [],
      configuration.boxJunctions ?? [],
      this.roadNetwork,
      this.trafficSystem,
      this.playerState,
      this.config,
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
    this.roadRuleMonitor.reset();
    this.playerState.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
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
    const hasExplicitElevation = Number.isFinite(pose.elevationM);
    if (hasExplicitElevation) {
      const elevationM = Math.max(0, pose.elevationM ?? 0);
      if (elevationM > 0) this.playerState.player.elevationM = elevationM;
      else delete this.playerState.player.elevationM;
      // An explicit 3D pose is authoritative. Do not let the lane occupied
      // before a teleport/cutscene constrain the height search; at a stacked
      // road it would discard the supplied elevation and choose the old level
      // solely because that was the preferred lane. Zero is just as explicit
      // as a bridge height here: it means the street beneath the flyover.
      this.roadState.projection = null;
    } else {
      delete this.playerState.player.elevationM;
    }
    this.playerState.signedSpeedMps = speedMps;
    this.viewHeading = this.playerState.player.heading;
    this.updateRoadState(hasExplicitElevation);
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

  /** Debug/benchmark read of the static-collision narrow-phase instrumentation
   * accumulated so far. Allocates (spreads into fresh objects); collision
   * stepping itself never does. */
  getStaticCollisionCounters(): StaticCollisionCounterSnapshot {
    return {
      lastStep: { ...this.staticCollisionLastStep },
      cumulative: { ...this.staticCollisionCumulative },
    };
  }

  /** Zeroes both the last-step and cumulative static-collision counters —
   * the sanctioned way to start a clean measurement window (a perf harness
   * replay, a QA session). Never called by gameplay code. */
  resetStaticCollisionCounters(): void {
    this.staticCollisionLastStep.candidates = 0;
    this.staticCollisionLastStep.narrowTests = 0;
    this.staticCollisionLastStep.iterations = 0;
    this.staticCollisionCumulative = {
      steps: 0,
      candidates: 0,
      narrowTests: 0,
      iterations: 0,
      maxCandidates: 0,
      maxNarrowTests: 0,
    };
  }

  /** A point-in-time traffic cost/debug snapshot for the browser perf hook and
   * deterministic benchmark harness. It allocates only when an external
   * caller asks for it, never in the fixed-step path. */
  getTrafficDiagnostics(): TrafficDiagnosticsSnapshot {
    let activeNpcCount = 0;
    for (const npc of this.trafficSystem.npcs) {
      if (npc.active) activeNpcCount += 1;
    }
    return {
      routeSearch: this.roadNetwork.getRouteSearchCounters(),
      spatialIndex: this.trafficSystem.getSpatialIndexDiagnostics(),
      locality: this.trafficSystem.getLocalityDiagnostics(),
      activeNpcCount,
      queuedNpcCount: this.trafficSystem.npcs.length - activeNpcCount,
    };
  }

  /** Starts a clean route-search measurement window. Spatial counters are
   * deliberately run-lifetime and reset with a full traffic reset, so paired
   * benchmarks construct a fresh core for each sample. */
  resetRouteSearchCounters(): void {
    this.roadNetwork.resetRouteSearchCounters();
  }

  /** Debug-only: the two capsule circle centres (front/rear along heading)
   * and radius the static narrow phase is currently testing, in world space
   * — feeds `__sideswapCollisionDebug` (render/babylonGameSession.ts). */
  getPlayerCapsuleDebug(): {
    readonly frontX: number;
    readonly frontZ: number;
    readonly rearX: number;
    readonly rearZ: number;
    readonly radiusM: number;
  } {
    const { x, z, heading } = this.playerState.player;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const half = this.config.playerCapsuleHalfLengthM;
    return {
      frontX: x + forwardX * half,
      frontZ: z + forwardZ * half,
      rearX: x - forwardX * half,
      rearZ: z - forwardZ * half,
      radiusM: this.config.playerCapsuleRadiusM,
    };
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
        ...(this.playerState.player.elevationM
          ? { elevationM: this.playerState.player.elevationM }
          : {}),
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
          ...(npc.elevationM > 0 ? { elevationM: npc.elevationM } : {}),
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
    this.roadRuleMonitor.dispose();
    this.ruleCooldowns.clear();
  }

  private fixedUpdate(deltaSeconds: number): void {
    this.tick += 1;
    this.elapsedSeconds += deltaSeconds;
    this.updateTimers(deltaSeconds);
    this.staticCollisionLastStep.candidates = 0;
    this.staticCollisionLastStep.narrowTests = 0;
    this.staticCollisionLastStep.iterations = 0;
    // finally, not a call after the block: fixedUpdate returns early from
    // several points below (paused/ended mid-step), and every one of them
    // still needs this step's counters folded in exactly once.
    try {
      const oldPlayer = { ...this.playerState.player };
      const previousProjection = this.hasElevatedRoads
        ? this.roadNetwork.projectToRoad(oldPlayer.x, oldPlayer.z, {
            heading: oldPlayer.heading,
            preferredLaneId: this.roadState.projection?.lane.id,
            preferredElevationM: oldPlayer.elevationM ?? 0,
            allowBidirectionalProfileCapture: true,
          })
        : this.roadNetwork.projectToRoad(oldPlayer.x, oldPlayer.z);
      this.movePlayer(deltaSeconds);
      this.resolveElevatedRoadRoofCollision(oldPlayer);

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
    } finally {
      this.accumulateStaticCollisionCounters();
    }
  }

  /** Folds this step's static-collision instrumentation into the running
   * cumulative totals/maxima. Called exactly once per `fixedUpdate`, however
   * much of that step actually ran. */
  private accumulateStaticCollisionCounters(): void {
    const step = this.staticCollisionLastStep;
    const cumulative = this.staticCollisionCumulative;
    cumulative.steps += 1;
    cumulative.candidates += step.candidates;
    cumulative.narrowTests += step.narrowTests;
    cumulative.iterations += step.iterations;
    if (step.candidates > cumulative.maxCandidates) cumulative.maxCandidates = step.candidates;
    if (step.narrowTests > cumulative.maxNarrowTests) cumulative.maxNarrowTests = step.narrowTests;
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
      this.staticCollisionLastStep,
    );
  }

  /**
   * Keeps the player's roof out of a low flyover/ramp without turning every
   * elevated deck into a planar wall. The adapter's prepared query reports
   * actual clearance above each capsule sample. A prospective lane projection
   * supplies that sample's tyre height: when the player climbs a connected
   * ramp in either direction, its own asphalt/deck is therefore at or below
   * the tyres and the geometry query ignores it; a ground lane beneath the
   * same x/z remains at zero and sees the ramp as an obstruction.
   */
  private elevatedRoadRoofObstructionAt(
    x: number,
    z: number,
    heading: number,
  ): SimulationElevatedRoadGroundClearance | null {
    const clearanceAt = this.elevatedRoadGroundClearanceAt;
    if (!clearanceAt || !this.hasElevatedRoads) return null;

    const carriedElevationM = this.playerState.player.elevationM ?? 0;
    const currentLaneId = this.roadState.projection?.lane.id;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const halfLengthM = this.config.playerCapsuleHalfLengthM;
    const requiredClearanceM =
      this.config.playerClearanceHeightM + PLAYER_ROOF_CLEARANCE_MARGIN_M;
    let lowest: SimulationElevatedRoadGroundClearance | null = null;
    let centreProjection: LaneProjection | null | undefined;

    // End discs match the planar car capsule. The centre disc closes the gap
    // for long vans/two-wheelers so the roof envelope is continuous even when
    // their two static-collision end circles do not overlap.
    for (const alongM of [-halfLengthM, 0, halfLengthM]) {
      const sampleX = x + forwardX * alongM;
      const sampleZ = z + forwardZ * alongM;
      const carriedObstruction = clearanceAt(
        { x: sampleX, z: sampleZ },
        carriedElevationM,
        this.config.playerCapsuleRadiusM,
        undefined,
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
      );
      if (
        !carriedObstruction ||
        carriedObstruction.clearanceM + 1e-6 >= requiredClearanceM
      ) {
        continue;
      }
      // Most ticks are nowhere near a low structure, and high viaducts pass
      // the cheap clearance comparison above. Only a potential roof contact
      // pays for topology-aware projection to distinguish a connected ramp
      // climb from the unrelated ground road below it.
      if (centreProjection === undefined) {
        centreProjection = this.roadNetwork.projectToRoad(x, z, {
          heading,
          preferredLaneId: currentLaneId,
          preferredElevationM: carriedElevationM,
          allowBidirectionalProfileCapture: true,
        });
      }
      const centreElevationM = centreProjection?.elevationM ?? carriedElevationM;
      const prospectiveLaneId = centreProjection?.lane.id ?? currentLaneId;
      const sampleProjection = this.roadNetwork.projectToRoad(
        sampleX,
        sampleZ,
        {
          heading,
          preferredLaneId: prospectiveLaneId,
          preferredElevationM: centreElevationM,
          allowBidirectionalProfileCapture: true,
        },
      );
      const sampleElevationM = sampleProjection?.elevationM ?? centreElevationM;
      const carrierSurfaceIds = this.elevatedRoadCarrierSurfaceIds;
      carrierSurfaceIds.clear();
      const connectionPoint = { x: sampleX, z: sampleZ };
      const connectionCaptureDistanceM =
        halfLengthM + this.config.playerCapsuleRadiusM + 0.75;
      const connectionOptionsFor = (laneHeading: number | undefined) => {
        // Express the capsule sample in the lane's stored direction. A player
        // pointing against that direction swaps predecessor and successor, so
        // a wrong-way exit climb receives exactly the same seam clearance as
        // a legal entry. Gear does not enter this calculation: changing gear
        // cannot change which pavement lies beneath a fixed roof disc. Only
        // the centre disc retains both sides, and the endpoint gate keeps each
        // exemption inside the physical handoff envelope.
        const bodyMatchesLaneSign =
          laneHeading !== undefined &&
          Math.abs(angleDifference(heading, laneHeading)) > Math.PI / 2
            ? -1
            : 1;
        const relativeLaneM = alongM * bodyMatchesLaneSign;
        return {
          includePredecessors: relativeLaneM <= 1e-6,
          includeSuccessors: relativeLaneM >= -1e-6,
          connectionPoint,
          connectionCaptureDistanceM,
        };
      };
      this.roadNetwork.addLaneRoadSurfaceIds(
        currentLaneId,
        carrierSurfaceIds,
        connectionOptionsFor(this.roadState.projection?.heading),
      );
      this.roadNetwork.addLaneRoadSurfaceIds(
        prospectiveLaneId,
        carrierSurfaceIds,
        connectionOptionsFor(centreProjection?.heading),
      );
      this.roadNetwork.addLaneRoadSurfaceIds(
        sampleProjection?.lane.id,
        carrierSurfaceIds,
        connectionOptionsFor(sampleProjection?.heading),
      );
      const obstruction = clearanceAt(
        { x: sampleX, z: sampleZ },
        sampleElevationM,
        this.config.playerCapsuleRadiusM,
        carrierSurfaceIds,
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
      );
      // Near the point where a ramp's concrete slab begins, the capsule's
      // footprint reaches slightly farther uphill than its tyre sample. The
      // slab soffit is then geometrically below the car, not a wall in front
      // of it. Lane/surface identity is the decisive continuity signal here:
      // only an unrelated road above the projected lane is an obstruction.
      if (
        obstruction &&
        sampleProjection?.lane.roadId === obstruction.surfaceId
      ) {
        continue;
      }
      if (
        !obstruction ||
        obstruction.clearanceM + 1e-6 >= requiredClearanceM
      ) {
        continue;
      }
      if (!lowest || obstruction.clearanceM < lowest.clearanceM) {
        lowest = obstruction;
      }
    }
    return lowest;
  }

  /**
   * Clips a clear-to-blocked fixed-step move at the exact roof-clearance
   * boundary. An authored/teleported pose already inside a low structure is
   * allowed to move out instead of being trapped; normal driving always ends
   * the first entering step on the clear side, so subsequent pressure cannot
   * tunnel through it.
   */
  private resolveElevatedRoadRoofCollision(oldPlayer: MutablePose): void {
    const blocked = this.elevatedRoadRoofObstructionAt(
      this.playerState.player.x,
      this.playerState.player.z,
      this.playerState.player.heading,
    );
    if (!blocked) return;
    if (
      this.elevatedRoadRoofObstructionAt(
        oldPlayer.x,
        oldPlayer.z,
        oldPlayer.heading,
      )
    ) {
      return;
    }

    const targetX = this.playerState.player.x;
    const targetZ = this.playerState.player.z;
    let clearAmount = 0;
    let blockedAmount = 1;
    for (let iteration = 0; iteration < OVERHEAD_BOUNDARY_SEARCH_STEPS; iteration += 1) {
      const amount = (clearAmount + blockedAmount) / 2;
      const candidateX = oldPlayer.x + (targetX - oldPlayer.x) * amount;
      const candidateZ = oldPlayer.z + (targetZ - oldPlayer.z) * amount;
      if (
        this.elevatedRoadRoofObstructionAt(
          candidateX,
          candidateZ,
          this.playerState.player.heading,
        )
      ) {
        blockedAmount = amount;
      } else {
        clearAmount = amount;
      }
    }
    const travelM = Math.hypot(targetX - oldPlayer.x, targetZ - oldPlayer.z);
    const setbackAmount =
      travelM > 1e-6 ? Math.min(clearAmount, 0.002 / travelM) : 0;
    const resolvedAmount = Math.max(0, clearAmount - setbackAmount);
    this.playerState.player.x =
      oldPlayer.x + (targetX - oldPlayer.x) * resolvedAmount;
    this.playerState.player.z =
      oldPlayer.z + (targetZ - oldPlayer.z) * resolvedAmount;
    const impactSpeedMps = Math.abs(this.playerState.signedSpeedMps);
    this.playerState.signedSpeedMps = 0;
    if (impactSpeedMps >= OVERHEAD_COLLISION_EVENT_MIN_MPS) {
      this.emitEvent({
        code: "collision",
        correction: "Use the ramp or a route with enough overhead clearance.",
        evidence: {
          obstacle: "roadDeck",
          obstacleId: `elevated-road-${blocked.surfaceId}-segment-${blocked.segmentIndex}-${blocked.obstructionKind}`,
          clearanceM: Math.round(blocked.clearanceM * 100) / 100,
          requiredClearanceM:
            Math.round(
              (this.config.playerClearanceHeightM +
                PLAYER_ROOF_CLEARANCE_MARGIN_M) *
                100,
            ) / 100,
          impactSpeedMps: Math.round(impactSpeedMps * 10) / 10,
        },
      });
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
    resolveStaticCollisionsImpl(
      this.playerState,
      this.config,
      this.staticObstacles,
      allowEvents,
      this.status,
      (details) => this.emitEvent(details),
      FIXED_STEP_SECONDS,
      this.staticCollisionLastStep,
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
    this.roadRuleMonitor.monitorRoadRules(
      deltaSeconds,
      this.trafficCtx(),
      (details) => this.emitEvent(details),
      (npcId) => {
        this.honkSeconds = 1.15;
        this.honkSourceNpcId = npcId;
      },
    );
  }

  private checkBoxJunctions(previousPlayer: SimulationPoint): void {
    this.roadRuleMonitor.checkBoxJunctions(previousPlayer, this.trafficCtx(), (details) =>
      this.emitEvent(details),
    );
  }

  private monitorRestrictedLanes(deltaSeconds: number): void {
    this.roadRuleMonitor.monitorRestrictedLanes(deltaSeconds, this.trafficCtx(), (details) =>
      this.emitEvent(details),
    );
  }

  private checkStopLines(
    previousProjection: LaneProjection | null,
    currentProjection: LaneProjection | null,
  ): void {
    this.roadRuleMonitor.checkStopLines(previousProjection, currentProjection, this.trafficCtx(), (details) =>
      this.emitEvent(details),
    );
  }

  private checkCollisions(oldPlayer: SimulationPoint): void {
    const collisionRadius = this.config.playerRadiusM + NPC_RADIUS_METRES;
    for (const npc of this.trafficSystem.npcs) {
      if (!npc.active) continue;
      if (
        !roadElevationSweepsCanInteract(
          oldPlayer.elevationM ?? 0,
          this.playerState.player.elevationM ?? 0,
          npc.previousElevationM,
          npc.elevationM,
        )
      ) {
        continue;
      }
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
          this.trafficSystem.requestNpcRecycle(npc, this.trafficCtx());
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

  private updateRoadState(allowUnconnectedElevationCapture = false): void {
    const projection = this.hasElevatedRoads
      ? this.roadNetwork.projectToRoad(
          this.playerState.player.x,
          this.playerState.player.z,
          {
            heading: this.playerState.player.heading,
            preferredLaneId: this.roadState.projection?.lane.id,
            preferredElevationM: this.playerState.player.elevationM ?? 0,
            allowUnconnectedElevationCapture,
            allowBidirectionalProfileCapture: true,
          },
        )
      : this.roadNetwork.projectToRoad(
          this.playerState.player.x,
          this.playerState.player.z,
        );
    const withinBounds =
      this.playerState.player.x >= this.config.bounds.minX &&
      this.playerState.player.x <= this.config.bounds.maxX &&
      this.playerState.player.z >= this.config.bounds.minZ &&
      this.playerState.player.z <= this.config.bounds.maxZ;
    if (!projection) {
      delete this.playerState.player.elevationM;
      this.roadState = {
        projection: null,
        wrongWay: false,
        offRoad: true,
        inServiceArea: this.isInsideServiceArea(),
      };
      return;
    }
    if (projection.elevationM > 0) {
      this.playerState.player.elevationM = projection.elevationM;
    } else {
      delete this.playerState.player.elevationM;
    }
    const effectiveHeading =
      this.playerState.signedSpeedMps < -STOPPED_SPEED_MPS
        ? wrapAngle(this.playerState.player.heading + Math.PI)
        : this.playerState.player.heading;
    const wrongWay =
      Math.abs(this.playerState.signedSpeedMps) > 1.2 &&
      Math.abs(angleDifference(effectiveHeading, projection.heading)) > Math.PI / 2;
    const allowedDistance = projection.lane.width / 2 + 2.1;
    const offRoad = !withinBounds || projection.distance > allowedDistance;
    this.roadState = {
      projection,
      wrongWay,
      offRoad,
      // Conjoined with `offRoad` deliberately: a service area reaches back to
      // its lane's centreline so the pavement crossing is inside it (issue
      // #86), which means its road-side half lies on the carriageway. Requiring
      // the car to be off the carriageway first is what stops a station beside
      // a junction from becoming a licence to run that junction's red light.
      inServiceArea: offRoad && this.isInsideServiceArea(),
    };
  }

  /**
   * Is the car standing on a forecourt or a repair-shop apron?
   *
   * Point-in-OBB against each authored `ServiceArea`, the car treated as a
   * point rather than a capsule: a wheel overhanging the amnesty is still on
   * the forecourt as far as a traffic officer is concerned, and the boxes carry
   * a turn-in margin precisely so the edges do not have to be exact. Linear in
   * the service-point count, which is single digits per map.
   */
  private isInsideServiceArea(): boolean {
    const { x, z } = this.playerState.player;
    for (const area of this.serviceAreas) {
      const dx = x - area.x;
      const dz = z - area.z;
      if (Math.abs(dx * area.ux + dz * area.uz) > area.halfU) continue;
      if (Math.abs(dx * area.uz - dz * area.ux) > area.halfV) continue;
      return true;
    }
    return false;
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
    this.roadRuleMonitor.reset();
    this.playerState.unstableControlSeconds = 0;
    this.honkSeconds = 0;
    this.honkSourceNpcId = null;
    this.playerHornSeconds = 0;
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
