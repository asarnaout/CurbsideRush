import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationInput,
  type SimulationLane,
  type SimulationPoint,
  type SimulationSnapshot,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";

/**
 * The stationary four-anchor sweep proves steady-state capacity. This focused
 * complement proves the same traffic stays attached to a player who actually
 * drives: every case follows a deterministic authored successor chain for one
 * minute, discards the first half as moving warm-up, then grades 30 seconds at
 * 10 Hz. Counts come only from public snapshots and public lane geometry; no
 * TrafficSystem diagnostics or RoadNetwork route helpers self-grade them.
 */
const TOTAL_SECONDS = 60;
const WARMUP_SECONDS = 30;
const SAMPLE_SECONDS = TOTAL_SECONDS - WARMUP_SECONDS;
const FIXED_TICKS_PER_SECOND = Math.round(1 / FIXED_STEP_SECONDS);
const SAMPLE_HZ = 10;
const TICKS_PER_SAMPLE = Math.round(FIXED_TICKS_PER_SECOND / SAMPLE_HZ);
const TOTAL_TICKS = TOTAL_SECONDS * FIXED_TICKS_PER_SECOND;
const WARMUP_TICKS = WARMUP_SECONDS * FIXED_TICKS_PER_SECOND;

const FOG_RADIUS_M = 440;
const INNER_RADIUS_M = 250;
const APPROACH_RADIUS_M = 90;
const APPROACH_ROUTE_DISTANCE_M = 750;
const APPROACH_ROUTE_HOPS = 12;
const MOVING_SPEED_MPS = 0.5;
const CURRENT_CORRIDOR_SEED_RADIUS_M = 60;
const CURRENT_CORRIDOR_ALIGNMENT_RAD = (40 * Math.PI) / 180;
const CURRENT_CORRIDOR_SAFE_SPACING_M = 28;
// Frozen independently from locality production. A corridor slot can support
// moving-player continuity only when one of the immutable hidden portals can
// reach its exact target interval within this conservative free-flow ETA.
const STREAMABLE_FEED_ETA_SECONDS = 30;
const STREAMABLE_DRIVER_SPEED_FACTOR = 0.68;
const STREAMABLE_STARTUP_SECONDS = 2;
const STREAMABLE_APPROACH_MIN_M = 570;
const STREAMABLE_APPROACH_MAX_M = 680;
const AHEAD_HALF_ANGLE_RAD = (50 * Math.PI) / 180;
const CROSS_TANGENT_MINIMUM_RAD = (40 * Math.PI) / 180;
const MAXIMUM_BELOW_FLOOR_SECONDS = 10;
const MINIMUM_MOVING_INNER_FRACTION = 0.35;
const MINIMUM_PLAYER_TRAVEL_M = 75;
const MINIMUM_ROUTE_PROGRESS_M = 60;
// A local bubble may exchange hidden cars as the player crosses the map, but
// repeatedly cycling the whole fixed fleet is neither identity-stable nor a
// viable mobile performance strategy. Two complete fleet replacements in a
// one-minute moving run is the hard upper bound, independent of the existing
// per-decision work budgets.
const MAXIMUM_FLEET_TURNOVERS_PER_RUN = 2;
const EMERGENCY_FRONT_HALF_WIDTH_M = 2.6;
const EMERGENCY_FRONT_BASE_LENGTH_M = 7;
const EMERGENCY_FRONT_REACTION_SECONDS = 0.85;
const EMERGENCY_SWEEP_HORIZON_SECONDS = 1.4;
const EMERGENCY_SWEEP_CLEARANCE_M = 3;
const EMERGENCY_REAR_ALLOWANCE_M = 1.5;
const CONTROLLER_PLAYER_NPC_CLEARANCE_M = 2.05;
const OPPOSING_RECENTER_MAX_SPEED_MPS = 0.5;
const OPPOSING_RECENTER_ALIGNMENT_COS = -Math.cos(Math.PI / 6);
const OPPOSING_RECENTER_PROBE_SECONDS = 0.5;
const OPPOSING_RECENTER_PROBE_DISTANCE_M = 0.25;
const OPPOSING_RECENTER_HEADING_OFFSET_RAD = 0.25;
const OPPOSING_RECENTER_MIN_LATERAL_GAIN_M = 0.02;
const OPPOSING_RECENTER_CLEARANCE_MARGIN_M = 0.1;
const OPPOSING_RECENTER_MIN_STEER = 0.35;
const OPPOSING_RECENTER_THROTTLE = 0.2;

type DeviceClass = "desktop" | "touch";

const MOVING_CALIBRATION = {
  desktop: {
    poolCount: 32,
    laneCap: 6,
    corridorCap: 14,
    nearRadiusM: 120,
    targetCurrentRoad: 12,
    targetForwardRoad: 8,
    currentRoad: 9,
    forwardRoad: 6,
    movingCurrentRoad: 6,
    movingForwardRoad: 4,
    aheadOrApproaching: 6,
    nearView: 2,
  },
  touch: {
    poolCount: 16,
    laneCap: 4,
    corridorCap: 10,
    nearRadiusM: 100,
    targetCurrentRoad: 8,
    targetForwardRoad: 5,
    currentRoad: 6,
    forwardRoad: 4,
    movingCurrentRoad: 4,
    movingForwardRoad: 2,
    aheadOrApproaching: 4,
    nearView: 1,
  },
} as const;

interface OracleLane {
  readonly lane: SimulationLane;
  readonly lengthM: number;
  readonly segmentLengthsM: readonly number[];
}

type LanePredecessors = ReadonlyMap<string, readonly OracleLane[]>;

interface LaneProjection {
  readonly distanceAlongM: number;
  readonly separationM: number;
  readonly heading: number;
}

interface RoutePath {
  readonly points: readonly SimulationPoint[];
  readonly laneIds: readonly string[];
  readonly lengthM: number;
}

interface EmergencyDecision {
  readonly brake: boolean;
  readonly recenterDirection: -1 | 0 | 1;
}

interface MovingPerceptualSample {
  readonly withinInner: number;
  readonly movingWithinInner: number;
  readonly currentRoad: number;
  readonly forwardRoad: number;
  readonly movingCurrentRoad: number;
  readonly movingForwardRoad: number;
  /** Moving inner traffic outside the connected current-road mask. This is a
   * disjoint replacement set: one NPC can compensate at most one nested
   * current/forward continuity slot. */
  readonly movingOffCurrentFallback: number;
  readonly conservedCurrentPresence: number;
  readonly conservedForwardPresence: number;
  readonly aheadOrApproaching: number;
  readonly nearView: number;
}

type MovingFloorKey =
  | "currentRoad"
  | "forwardRoad"
  | "movingCurrentRoad"
  | "movingForwardRoad"
  | "movingOffCurrentFallback"
  | "conservedCurrentPresence"
  | "conservedForwardPresence"
  | "aheadOrApproaching"
  | "nearView";

type MovingPerceptualFloor = Readonly<Record<MovingFloorKey, number>>;

const MOVING_FLOOR_KEYS: readonly MovingFloorKey[] = [
  "currentRoad",
  "forwardRoad",
  "movingCurrentRoad",
  "movingForwardRoad",
  "movingOffCurrentFallback",
  "conservedCurrentPresence",
  "conservedForwardPresence",
  "aheadOrApproaching",
  "nearView",
];

interface CurrentCorridorOracle {
  readonly laneIds: ReadonlySet<string>;
  readonly heading: number;
  readonly clippedLengthM: number;
  readonly forwardClippedLengthM: number;
}

interface CurrentCorridorSafeCapacity {
  readonly currentRoad: number;
  readonly forwardRoad: number;
}

interface StreamableCorridorCapacity {
  readonly currentRoad: number;
  readonly forwardRoad: number;
}

interface IndependentGoalSeed {
  readonly laneIndex: number;
  readonly entryDistance: number;
  readonly exitDistance: number;
  readonly minimumDirectOriginDistance?: number;
  readonly allowPredecessorEntry?: boolean;
}

interface IndependentGoalTable {
  readonly laneCount: number;
  readonly distanceFromLaneStartByHopBudget: Float64Array;
  readonly usedHopsByHopBudget: Uint16Array;
  readonly nextLaneIndexByHopBudget: Int32Array;
  readonly targetLaneIndexByHopBudget: Int32Array;
  readonly targetEntryDistance: Float64Array;
  readonly targetExitDistance: Float64Array;
  readonly targetMinimumDirectOriginDistance: Float64Array;
  readonly targetAllowsPredecessorEntry: Uint8Array;
}

interface MovingPerceptualReport {
  readonly label: string;
  readonly playerTravelM: number;
  readonly routeProgressM: number;
  readonly sampleCount: number;
  readonly p50: Omit<MovingPerceptualSample, "withinInner">;
  readonly p50EffectiveFloor: MovingPerceptualFloor;
  readonly p50FloorMargin: MovingPerceptualFloor;
  readonly p50SafeCapacity: CurrentCorridorSafeCapacity;
  readonly p50StreamableCapacity: StreamableCorridorCapacity;
  readonly p50ContinuityShortfall: number;
  readonly p50DesiredApproachJourneys: number;
  readonly p50LiveApproachGoals: number;
  readonly p50CommittedApproachJourneys: number;
  readonly localHandoffAttempts: number;
  readonly localHandoffSuccesses: number;
  readonly localHandoffCadenceBlocks: number;
  readonly localHandoffNoCandidate: number;
  readonly localHandoffRoleOrIncidentBlocked: number;
  readonly localHandoffUnreachable: number;
  readonly localHandoffTargetCapacityBlocked: number;
  readonly localHandoffEtaBlocked: number;
  readonly localHandoffAcceptedEtaP50Seconds: number;
  readonly approachGoalContributions: number;
  readonly approachGoalFailures: number;
  readonly approachGoalRecenterReleases: number;
  readonly movingInnerFraction: number;
  readonly maximumBelowFloorSeconds: Readonly<Record<MovingFloorKey, number>>;
  readonly missingCurrentCorridorSamples: number;
  readonly offRoadTicks: number;
  readonly unsafeEventCount: number;
  readonly unsafeEvents: readonly string[];
  readonly poolInvariantFailures: number;
  readonly initialActiveCount: number;
  readonly finalActiveCount: number;
  readonly cumulativeActivations: number;
  readonly cumulativeRetirements: number;
  readonly lifecycleTransitionLimit: number;
  readonly lifecycleBalanceInvariantFailures: number;
  readonly duplicateNpcIdentityCount: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const distance = (
  left: { readonly x: number; readonly z: number },
  right: { readonly x: number; readonly z: number },
): number => Math.hypot(left.x - right.x, left.z - right.z);

const headingBetween = (from: SimulationPoint, to: SimulationPoint): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

const angleDifference = (target: number, current: number): number => {
  let difference = target - current;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

const laneLength = (points: readonly SimulationPoint[]): number => {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    result += distance(points[index - 1], points[index]);
  }
  return result;
};

function pointOnLane(
  lane: SimulationLane,
  requestedDistanceM: number,
): SimulationPoint & { readonly heading: number } {
  let remainingM = Math.max(0, requestedDistanceM);
  for (let index = 1; index < lane.points.length; index += 1) {
    const from = lane.points[index - 1];
    const to = lane.points[index];
    const segmentLengthM = distance(from, to);
    if (segmentLengthM <= Number.EPSILON) continue;
    if (remainingM <= segmentLengthM) {
      const fraction = remainingM / segmentLengthM;
      return {
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
        heading: headingBetween(from, to),
      };
    }
    remainingM -= segmentLengthM;
  }
  const to = lane.points[lane.points.length - 1];
  const from = lane.points[lane.points.length - 2];
  return { x: to.x, z: to.z, heading: headingBetween(from, to) };
}

function projectToLane(
  lane: SimulationLane,
  point: SimulationPoint,
): LaneProjection | null {
  let traversedM = 0;
  let best: LaneProjection | null = null;
  for (let index = 1; index < lane.points.length; index += 1) {
    const from = lane.points[index - 1];
    const to = lane.points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= Number.EPSILON) continue;
    const segmentLengthM = Math.sqrt(lengthSquared);
    const fraction = clamp(
      ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared,
      0,
      1,
    );
    const projectedX = from.x + dx * fraction;
    const projectedZ = from.z + dz * fraction;
    const candidate: LaneProjection = {
      distanceAlongM: traversedM + segmentLengthM * fraction,
      separationM: Math.hypot(point.x - projectedX, point.z - projectedZ),
      heading: Math.atan2(dx, dz),
    };
    if (
      !best ||
      candidate.separationM < best.separationM ||
      (candidate.separationM === best.separationM &&
        candidate.distanceAlongM < best.distanceAlongM)
    ) {
      best = candidate;
    }
    traversedM += segmentLengthM;
  }
  return best;
}

function buildLaneOracle(
  lanes: readonly SimulationLane[],
): ReadonlyMap<string, OracleLane> {
  return new Map(
    lanes.map((lane) => {
      const segmentLengthsM = lane.points.slice(1).map((point, index) =>
        distance(lane.points[index], point),
      );
      return [
        lane.id,
        {
          lane,
          lengthM: segmentLengthsM.reduce(
            (total, segmentLengthM) => total + segmentLengthM,
            0,
          ),
          segmentLengthsM,
        },
      ];
    }),
  );
}

function buildLanePredecessors(
  laneOracle: ReadonlyMap<string, OracleLane>,
): LanePredecessors {
  const predecessors = new Map<string, OracleLane[]>();
  for (const candidate of laneOracle.values()) {
    for (const successorId of candidate.lane.successorLaneIds ?? []) {
      const entries = predecessors.get(successorId) ?? [];
      entries.push(candidate);
      predecessors.set(successorId, entries);
    }
  }
  return predecessors;
}

function projectPlayerLane(
  laneOracle: ReadonlyMap<string, OracleLane>,
  player: SimulationSnapshot["player"],
): { readonly oracleLane: OracleLane; readonly projection: LaneProjection } {
  const result = [...laneOracle.values()]
    .flatMap((oracleLane) => {
      const projection = projectToLane(oracleLane.lane, player);
      return projection ? [{ oracleLane, projection }] : [];
    })
    .sort(
      (left, right) =>
        left.projection.separationM - right.projection.separationM ||
        Math.abs(angleDifference(left.projection.heading, player.heading)) -
          Math.abs(angleDifference(right.projection.heading, player.heading)) ||
        left.oracleLane.lane.id.localeCompare(right.oracleLane.lane.id),
    )[0];
  if (!result) throw new Error("player cannot project to an authored lane");
  return result;
}

function closestProjectionOnPoints(
  points: readonly SimulationPoint[],
  point: SimulationPoint,
  minimumProgressM = 0,
  maximumProgressM = Number.POSITIVE_INFINITY,
): LaneProjection {
  let travelledM = 0;
  let best: LaneProjection | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    const segmentLengthM = Math.sqrt(lengthSquared);
    if (segmentLengthM <= Number.EPSILON) continue;
    const minimumFraction = clamp(
      (minimumProgressM - travelledM) / segmentLengthM,
      0,
      1,
    );
    const maximumFraction = clamp(
      (maximumProgressM - travelledM) / segmentLengthM,
      0,
      1,
    );
    if (minimumFraction > maximumFraction) {
      travelledM += segmentLengthM;
      continue;
    }
    const fraction = clamp(
      ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared,
      minimumFraction,
      maximumFraction,
    );
    const projectedX = from.x + dx * fraction;
    const projectedZ = from.z + dz * fraction;
    const candidate: LaneProjection = {
      distanceAlongM: travelledM + segmentLengthM * fraction,
      separationM: Math.hypot(point.x - projectedX, point.z - projectedZ),
      heading: Math.atan2(dx, dz),
    };
    if (!best || candidate.separationM < best.separationM) best = candidate;
    travelledM += segmentLengthM;
  }
  if (!best) throw new Error("route has no non-degenerate segment");
  return best;
}

function pointAtRouteDistance(
  route: RoutePath,
  routeDistanceM: number,
): SimulationPoint {
  let remainingM = clamp(routeDistanceM, 0, route.lengthM);
  for (let index = 1; index < route.points.length; index += 1) {
    const from = route.points[index - 1];
    const to = route.points[index];
    const segmentLengthM = distance(from, to);
    if (segmentLengthM <= Number.EPSILON) continue;
    if (remainingM <= segmentLengthM || index === route.points.length - 1) {
      const fraction = remainingM / segmentLengthM;
      return {
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
      };
    }
    remainingM -= segmentLengthM;
  }
  return route.points[route.points.length - 1];
}

function buildRoutePath(config: SimulationCoreConfig): RoutePath {
  const lanes = (config.lanes ?? []).filter((lane) => lane.points.length >= 2);
  if (!config.spawn || lanes.length === 0) {
    throw new Error("moving density route needs authored lanes and a spawn");
  }
  const startLane = lanes
    .flatMap((lane) => {
      const projection = projectToLane(lane, config.spawn!);
      return projection
        ? [{
            lane,
            projection,
            score:
              projection.separationM +
              Math.abs(angleDifference(projection.heading, config.spawn!.heading)) *
                0.25,
          }]
        : [];
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.lane.id.localeCompare(right.lane.id),
    )[0];
  if (!startLane) throw new Error("moving density route has no start lane");
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
  const laneIds: string[] = [];
  const points: SimulationPoint[] = [];
  let lane = startLane.lane;
  let previousHeading = headingBetween(
    lane.points[lane.points.length - 2],
    lane.points[lane.points.length - 1],
  );
  for (let hop = 0; hop < 16; hop += 1) {
    laneIds.push(lane.id);
    const startOffsetM = hop === 0 ? startLane.projection.distanceAlongM : 0;
    let laneTravelM = 0;
    for (let index = 1; index < lane.points.length; index += 1) {
      const from = lane.points[index - 1];
      const to = lane.points[index];
      const segmentLengthM = distance(from, to);
      const segmentStartM = laneTravelM;
      laneTravelM += segmentLengthM;
      if (laneTravelM <= startOffsetM || segmentLengthM <= Number.EPSILON) {
        continue;
      }
      const fraction =
        startOffsetM > segmentStartM
          ? (startOffsetM - segmentStartM) / segmentLengthM
          : 0;
      const startPoint = {
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
      };
      if (
        points.length === 0 ||
        distance(points[points.length - 1], startPoint) > 1e-6
      ) {
        points.push(startPoint);
      }
      points.push(to);
    }
    const candidates = (lane.successorLaneIds ?? [])
      .map((id) => lanesById.get(id))
      .filter((candidate): candidate is SimulationLane =>
        Boolean(candidate && candidate.points.length >= 2),
      )
      .sort((left, right) => {
        const leftHeading = headingBetween(left.points[0], left.points[1]);
        const rightHeading = headingBetween(right.points[0], right.points[1]);
        return (
          Math.abs(angleDifference(leftHeading, previousHeading)) -
            Math.abs(angleDifference(rightHeading, previousHeading)) ||
          left.id.localeCompare(right.id)
        );
      });
    if (candidates.length === 0) break;
    lane = candidates[0];
    previousHeading = headingBetween(
      lane.points[lane.points.length - 2],
      lane.points[lane.points.length - 1],
    );
  }
  const lengthM = laneLength(points);
  if (points.length < 2 || lengthM < 300) {
    throw new Error(`moving density route is only ${lengthM.toFixed(1)}m`);
  }
  return { points, laneIds, lengthM };
}

class LaneCentreController {
  private progressM = 0;
  private readonly laneIds: ReadonlySet<string>;

  constructor(private readonly route: RoutePath) {
    this.laneIds = new Set(route.laneIds);
  }

  /**
   * The normal headway check deliberately accepts only the chosen directed
   * route, otherwise a nearby opposing carriageway can pin the replay forever.
   * A route-independent emergency layer is still needed for genuine crossing
   * hazards. It brakes for an NPC already in the short forward capsule, or for
   * two velocity sweeps predicted to enter a three-metre clearance envelope.
   */
  private safeOpposingRecenterDirection(
    snapshot: SimulationSnapshot,
    npc: SimulationSnapshot["npcs"][number],
    lateralM: number,
    separationM: number,
  ): -1 | 0 | 1 {
    if (
      this.laneIds.has(npc.laneId) ||
      snapshot.player.speedMps > OPPOSING_RECENTER_MAX_SPEED_MPS ||
      npc.speedMps > OPPOSING_RECENTER_MAX_SPEED_MPS ||
      Math.cos(angleDifference(npc.heading, snapshot.player.heading)) >
        OPPOSING_RECENTER_ALIGNMENT_COS ||
      separationM <
        CONTROLLER_PLAYER_NPC_CLEARANCE_M +
          OPPOSING_RECENTER_CLEARANCE_MARGIN_M
    ) {
      return 0;
    }

    const direction: -1 | 1 = lateralM >= 0 ? -1 : 1;
    const probeHeading =
      snapshot.player.heading +
      direction * OPPOSING_RECENTER_HEADING_OFFSET_RAD;
    const playerProbe = {
      x:
        snapshot.player.x +
        Math.sin(probeHeading) * OPPOSING_RECENTER_PROBE_DISTANCE_M,
      z:
        snapshot.player.z +
        Math.cos(probeHeading) * OPPOSING_RECENTER_PROBE_DISTANCE_M,
    };
    const npcProbe = {
      x:
        npc.x +
        Math.sin(npc.heading) *
          npc.speedMps *
          OPPOSING_RECENTER_PROBE_SECONDS,
      z:
        npc.z +
        Math.cos(npc.heading) *
          npc.speedMps *
          OPPOSING_RECENTER_PROBE_SECONDS,
    };
    const candidateDx = npcProbe.x - playerProbe.x;
    const candidateDz = npcProbe.z - playerProbe.z;
    const rightX = Math.cos(snapshot.player.heading);
    const rightZ = -Math.sin(snapshot.player.heading);
    const candidateLateralM = candidateDx * rightX + candidateDz * rightZ;
    if (
      Math.hypot(candidateDx, candidateDz) <
        CONTROLLER_PLAYER_NPC_CLEARANCE_M +
          OPPOSING_RECENTER_CLEARANCE_MARGIN_M ||
      Math.abs(candidateLateralM) <
        Math.abs(lateralM) + OPPOSING_RECENTER_MIN_LATERAL_GAIN_M
    ) {
      return 0;
    }
    return direction;
  }

  private emergencyDecision(snapshot: SimulationSnapshot): EmergencyDecision {
    const forwardX = Math.sin(snapshot.player.heading);
    const forwardZ = Math.cos(snapshot.player.heading);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const playerVelocityX = forwardX * snapshot.player.speedMps;
    const playerVelocityZ = forwardZ * snapshot.player.speedMps;
    const frontLengthM =
      EMERGENCY_FRONT_BASE_LENGTH_M +
      snapshot.player.speedMps * EMERGENCY_FRONT_REACTION_SECONDS;
    let recenterDirection: -1 | 0 | 1 = 0;
    for (const npc of snapshot.npcs) {
      const dx = npc.x - snapshot.player.x;
      const dz = npc.z - snapshot.player.z;
      const forwardM = dx * forwardX + dz * forwardZ;
      const lateralM = dx * rightX + dz * rightZ;
      const separationM = Math.hypot(dx, dz);
      const inFrontCapsule =
        forwardM >= 0 &&
        forwardM <= frontLengthM &&
        Math.abs(lateralM) <= EMERGENCY_FRONT_HALF_WIDTH_M;
      let sweepConflict = false;

      // Avoid considering traffic already safely behind, and cap the broad
      // phase before doing the relative-motion calculation. Fast cross traffic
      // gets its own horizon allowance, so it is seen before entering the cone.
      if (
        (!inFrontCapsule && forwardM < -EMERGENCY_REAR_ALLOWANCE_M) ||
        (!inFrontCapsule &&
          separationM >
            frontLengthM +
              npc.speedMps * EMERGENCY_SWEEP_HORIZON_SECONDS +
              EMERGENCY_SWEEP_CLEARANCE_M)
      ) {
        continue;
      }
      if (!inFrontCapsule) {
        const npcVelocityX = Math.sin(npc.heading) * npc.speedMps;
        const npcVelocityZ = Math.cos(npc.heading) * npc.speedMps;
        const relativeVelocityX = npcVelocityX - playerVelocityX;
        const relativeVelocityZ = npcVelocityZ - playerVelocityZ;
        const relativeSpeedSquared =
          relativeVelocityX * relativeVelocityX +
          relativeVelocityZ * relativeVelocityZ;
        if (relativeSpeedSquared <= Number.EPSILON) continue;
        const closingDot = dx * relativeVelocityX + dz * relativeVelocityZ;
        if (closingDot >= 0) continue;
        const closestSeconds = clamp(
          -closingDot / relativeSpeedSquared,
          0,
          EMERGENCY_SWEEP_HORIZON_SECONDS,
        );
        const closestDx = dx + relativeVelocityX * closestSeconds;
        const closestDz = dz + relativeVelocityZ * closestSeconds;
        const closestForwardM = closestDx * forwardX + closestDz * forwardZ;
        sweepConflict =
          closestForwardM >= -EMERGENCY_REAR_ALLOWANCE_M &&
          Math.hypot(closestDx, closestDz) <= EMERGENCY_SWEEP_CLEARANCE_M;
      }
      if (!inFrontCapsule && !sweepConflict) continue;
      const candidateDirection = this.safeOpposingRecenterDirection(
        snapshot,
        npc,
        lateralM,
        separationM,
      );
      if (
        candidateDirection === 0 ||
        (recenterDirection !== 0 && recenterDirection !== candidateDirection)
      ) {
        return { brake: true, recenterDirection: 0 };
      }
      recenterDirection = candidateDirection;
    }
    return { brake: false, recenterDirection };
  }

  inputFor(snapshot: SimulationSnapshot): SimulationInput {
    const nearest = closestProjectionOnPoints(
      this.route.points,
      snapshot.player,
      Math.max(0, this.progressM - 10),
      this.progressM + 35,
    );
    if (nearest.distanceAlongM >= this.progressM - 4) {
      this.progressM = Math.max(this.progressM, nearest.distanceAlongM);
    }
    let leadGapM = Number.POSITIVE_INFINITY;
    for (const npc of snapshot.npcs) {
      if (!this.laneIds.has(npc.laneId)) continue;
      const projection = closestProjectionOnPoints(
        this.route.points,
        npc,
        Math.max(0, this.progressM - 5),
        this.progressM + 70,
      );
      const aheadM = projection.distanceAlongM - this.progressM;
      if (aheadM > 0 && projection.separationM <= 4.5) {
        leadGapM = Math.min(leadGapM, aheadM);
      }
    }
    const lookaheadM = clamp(5 + snapshot.player.speedMps * 0.4, 5, 10);
    const target = pointAtRouteDistance(this.route, this.progressM + lookaheadM);
    const headingError = angleDifference(
      headingBetween(snapshot.player, target),
      snapshot.player.heading,
    );
    const headingMagnitude = Math.abs(headingError);
    const desiredLeadGapM = 10 + snapshot.player.speedMps * 1.8;
    const leadBrake = leadGapM < desiredLeadGapM;
    const leadCaution = leadGapM < desiredLeadGapM + 12;
    const emergency = this.emergencyDecision(snapshot);
    const routeSteer = clamp(headingError / 0.27, -0.9, 0.9);
    const recenterSteer =
      emergency.recenterDirection < 0
        ? Math.min(routeSteer, -OPPOSING_RECENTER_MIN_STEER)
        : emergency.recenterDirection > 0
          ? Math.max(routeSteer, OPPOSING_RECENTER_MIN_STEER)
          : routeSteer;
    return {
      throttle: emergency.brake || leadBrake
        ? 0
        : emergency.recenterDirection !== 0
          ? OPPOSING_RECENTER_THROTTLE
        : leadCaution
          ? 0.08
          : headingMagnitude > 0.62
            ? 0.08
            : headingMagnitude > 0.27
              ? 0.2
              : 0.42,
      brake: emergency.brake
        ? 1
        : leadBrake
          ? 0.85
          : headingMagnitude > 0.78
            ? 0.6
            : 0,
      steer: recenterSteer,
      viewHeading: snapshot.player.heading,
    };
  }

  get routeProgressM(): number {
    return this.progressM;
  }
}

function pointToSegmentDistanceSquared(
  point: SimulationPoint,
  start: SimulationPoint,
  end: SimulationPoint,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return (point.x - start.x) ** 2 + (point.z - start.z) ** 2;
  }
  const fraction = clamp(
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    0,
    1,
  );
  const closestX = start.x + dx * fraction;
  const closestZ = start.z + dz * fraction;
  return (point.x - closestX) ** 2 + (point.z - closestZ) ** 2;
}

function laneRangeReachesCircle(
  oracleLane: OracleLane,
  fromDistanceM: number,
  toDistanceM: number,
  centre: SimulationPoint,
  radiusM = APPROACH_RADIUS_M,
): boolean {
  let segmentStartM = 0;
  for (let index = 0; index < oracleLane.segmentLengthsM.length; index += 1) {
    const segmentLengthM = oracleLane.segmentLengthsM[index];
    const segmentEndM = segmentStartM + segmentLengthM;
    const overlapStartM = Math.max(fromDistanceM, segmentStartM);
    const overlapEndM = Math.min(toDistanceM, segmentEndM);
    if (overlapEndM >= overlapStartM && segmentLengthM > Number.EPSILON) {
      const start = oracleLane.lane.points[index];
      const end = oracleLane.lane.points[index + 1];
      const startFraction = (overlapStartM - segmentStartM) / segmentLengthM;
      const endFraction = (overlapEndM - segmentStartM) / segmentLengthM;
      const clippedStart = {
        x: start.x + (end.x - start.x) * startFraction,
        z: start.z + (end.z - start.z) * startFraction,
      };
      const clippedEnd = {
        x: start.x + (end.x - start.x) * endFraction,
        z: start.z + (end.z - start.z) * endFraction,
      };
      if (
        pointToSegmentDistanceSquared(centre, clippedStart, clippedEnd) <=
        radiusM ** 2
      ) {
        return true;
      }
    }
    segmentStartM = segmentEndM;
    if (segmentStartM > toDistanceM) break;
  }
  return false;
}

function segmentIntervalInsideCircle(
  start: SimulationPoint,
  end: SimulationPoint,
  centre: SimulationPoint,
  radiusM: number,
): readonly [number, number] | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON || radiusM <= 0) return null;
  const ox = start.x - centre.x;
  const oz = start.z - centre.z;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radiusM * radiusM;
  const discriminant = b * b - 4 * lengthSquared * c;
  if (discriminant < 0) return c <= 0 ? [0, 1] : null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const from = clamp((-b - root) / (2 * lengthSquared), 0, 1);
  const to = clamp((-b + root) / (2 * lengthSquared), 0, 1);
  return to > from ? [from, to] : null;
}

function clippedCorridorLengths(
  laneOracle: ReadonlyMap<string, OracleLane>,
  corridorLaneIds: ReadonlySet<string>,
  player: SimulationPoint,
  corridorHeading: number,
): { readonly totalM: number; readonly forwardM: number } {
  const forwardX = Math.sin(corridorHeading);
  const forwardZ = Math.cos(corridorHeading);
  let totalM = 0;
  let forwardM = 0;
  for (const laneId of corridorLaneIds) {
    const lane = laneOracle.get(laneId)?.lane;
    if (!lane) continue;
    for (let index = 1; index < lane.points.length; index += 1) {
      const start = lane.points[index - 1];
      const end = lane.points[index];
      const interval = segmentIntervalInsideCircle(
        start,
        end,
        player,
        FOG_RADIUS_M,
      );
      if (!interval) continue;
      const segmentLengthM = distance(start, end);
      const [circleFrom, circleTo] = interval;
      totalM += (circleTo - circleFrom) * segmentLengthM;

      const startLongitudinal =
        (start.x - player.x) * forwardX +
        (start.z - player.z) * forwardZ;
      const deltaLongitudinal =
        (end.x - start.x) * forwardX +
        (end.z - start.z) * forwardZ;
      let forwardFrom = circleFrom;
      let forwardTo = circleTo;
      if (Math.abs(deltaLongitudinal) <= Number.EPSILON) {
        if (startLongitudinal < 0) continue;
      } else {
        const zeroCrossing = -startLongitudinal / deltaLongitudinal;
        if (deltaLongitudinal > 0) {
          forwardFrom = Math.max(forwardFrom, zeroCrossing);
        } else {
          forwardTo = Math.min(forwardTo, zeroCrossing);
        }
      }
      if (forwardTo > forwardFrom) {
        forwardM += (forwardTo - forwardFrom) * segmentLengthM;
      }
    }
  }
  return { totalM, forwardM };
}

function endpointHeading(
  lane: SimulationLane,
  atStart: boolean,
): number | null {
  if (atStart) {
    for (let index = 1; index < lane.points.length; index += 1) {
      if (distance(lane.points[index - 1], lane.points[index]) <= Number.EPSILON) {
        continue;
      }
      return headingBetween(lane.points[index - 1], lane.points[index]);
    }
  } else {
    for (let index = lane.points.length - 1; index > 0; index -= 1) {
      if (distance(lane.points[index - 1], lane.points[index]) <= Number.EPSILON) {
        continue;
      }
      return headingBetween(lane.points[index - 1], lane.points[index]);
    }
  }
  return null;
}

/**
 * Rebuild the visible current-road corridor from public lane geometry only.
 * Authored roadId is intentionally ignored: many city roads are split into
 * short junction-sized IDs, while players perceive their aligned continuation
 * as one street. This mirrors the product contract without calling TrafficSystem
 * diagnostics or importing its private corridor mask.
 */
function buildIndependentCurrentCorridor(
  laneOracle: ReadonlyMap<string, OracleLane>,
  predecessors: LanePredecessors,
  playerRoad: ReturnType<typeof projectPlayerLane>,
  player: SimulationSnapshot["player"],
): CurrentCorridorOracle {
  const alignmentMinimum = Math.cos(CURRENT_CORRIDOR_ALIGNMENT_RAD);
  const corridorLaneIds = new Set<string>();
  const queue: OracleLane[] = [];
  for (const candidate of laneOracle.values()) {
    const projection = projectToLane(candidate.lane, player);
    const pairedSeed = Boolean(
      projection &&
        projection.separationM <= CURRENT_CORRIDOR_SEED_RADIUS_M &&
        Math.abs(
          Math.cos(
            angleDifference(
              projection.heading,
              playerRoad.projection.heading,
            ),
          ),
        ) >= alignmentMinimum,
    );
    if (candidate.lane.id !== playerRoad.oracleLane.lane.id && !pairedSeed) {
      continue;
    }
    corridorLaneIds.add(candidate.lane.id);
    queue.push(candidate);
  }

  const alignedContinuation = (
    predecessor: OracleLane,
    successor: OracleLane,
  ): boolean => {
    const predecessorEnd =
      predecessor.lane.points[predecessor.lane.points.length - 1];
    const predecessorHeading = endpointHeading(predecessor.lane, false);
    const successorHeading = endpointHeading(successor.lane, true);
    return (
      distance(predecessorEnd, successor.lane.points[0]) <= 0.5 &&
      predecessorHeading !== null &&
      successorHeading !== null &&
      Math.cos(angleDifference(predecessorHeading, successorHeading)) >=
        alignmentMinimum
    );
  };
  const tryAdd = (
    candidate: OracleLane,
    predecessor: OracleLane,
    successor: OracleLane,
  ): void => {
    if (
      corridorLaneIds.has(candidate.lane.id) ||
      !alignedContinuation(predecessor, successor) ||
      !laneRangeReachesCircle(
        candidate,
        0,
        candidate.lengthM,
        player,
        FOG_RADIUS_M,
      )
    ) {
      return;
    }
    corridorLaneIds.add(candidate.lane.id);
    queue.push(candidate);
  };
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const lane = queue[cursor];
    for (const successorId of lane.lane.successorLaneIds ?? []) {
      const successor = laneOracle.get(successorId);
      if (successor) tryAdd(successor, lane, successor);
    }
    for (const predecessor of predecessors.get(lane.lane.id) ?? []) {
      tryAdd(predecessor, predecessor, lane);
    }
  }
  const lengths = clippedCorridorLengths(
    laneOracle,
    corridorLaneIds,
    player,
    playerRoad.projection.heading,
  );
  return {
    laneIds: corridorLaneIds,
    heading: playerRoad.projection.heading,
    clippedLengthM: lengths.totalM,
    forwardClippedLengthM: lengths.forwardM,
  };
}

/** First contiguous arclength interval on one lane inside the local disc,
 * optionally clipped to the projected player's forward half-plane. */
function firstIndependentLaneLocalityInterval(
  oracleLane: OracleLane,
  centre: SimulationPoint,
  radiusM: number,
  roadHeading: number,
  requireForward: boolean,
): { readonly entryDistance: number; readonly exitDistance: number } | null {
  const radiusSquared = radiusM * radiusM;
  const forwardX = Math.sin(roadHeading);
  const forwardZ = Math.cos(roadHeading);
  let accumulatedM = 0;
  let firstEntryM: number | null = null;
  let latestExitM = Number.NaN;
  for (
    let index = 0;
    index < oracleLane.segmentLengthsM.length;
    index += 1
  ) {
    const start = oracleLane.lane.points[index];
    const end = oracleLane.lane.points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLengthM = oracleLane.segmentLengthsM[index];
    const lengthSquared = dx * dx + dz * dz;
    if (segmentLengthM <= Number.EPSILON || lengthSquared <= Number.EPSILON) {
      accumulatedM += segmentLengthM;
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
      const startLongitudinal =
        relativeX * forwardX + relativeZ * forwardZ;
      const endLongitudinal =
        (end.x - centre.x) * forwardX +
        (end.z - centre.z) * forwardZ;
      const longitudinalDelta = endLongitudinal - startLongitudinal;
      if (Math.abs(longitudinalDelta) <= 1e-9) {
        if (startLongitudinal < 0) {
          intervalStart = Number.POSITIVE_INFINITY;
        }
      } else {
        const boundary = -startLongitudinal / longitudinalDelta;
        if (longitudinalDelta > 0) {
          intervalStart = Math.max(intervalStart, boundary);
        } else {
          intervalEnd = Math.min(intervalEnd, boundary);
        }
      }
    }
    if (intervalStart <= intervalEnd + 1e-9) {
      intervalStart = clamp(intervalStart, 0, 1);
      intervalEnd = clamp(intervalEnd, 0, 1);
      const entryDistance = accumulatedM + intervalStart * segmentLengthM;
      const exitDistance = accumulatedM + intervalEnd * segmentLengthM;
      if (firstEntryM === null) {
        firstEntryM = entryDistance;
        latestExitM = exitDistance;
      } else if (
        intervalStart <= 1e-9 &&
        entryDistance <= latestExitM + 1e-6
      ) {
        latestExitM = Math.max(latestExitM, exitDistance);
      } else {
        return { entryDistance: firstEntryM, exitDistance: latestExitM };
      }
      if (intervalEnd < 1 - 1e-9) {
        return { entryDistance: firstEntryM, exitDistance: latestExitM };
      }
    } else if (firstEntryM !== null) {
      return { entryDistance: firstEntryM, exitDistance: latestExitM };
    }
    accumulatedM += segmentLengthM;
  }
  return firstEntryM === null
    ? null
    : { entryDistance: firstEntryM, exitDistance: latestExitM };
}

/** Independent reverse dynamic programme for immutable hidden-feed goals.
 * State is keyed by `(lane, hop budget)`, so distance and hop constraints do
 * not incorrectly dominate one another. */
function buildIndependentGoalTable(
  lanes: readonly OracleLane[],
  laneIndexById: ReadonlyMap<string, number>,
  targetSeeds: readonly IndependentGoalSeed[],
): IndependentGoalTable {
  const laneCount = lanes.length;
  const budgetCount = APPROACH_ROUTE_HOPS + 1;
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
    if (seed.laneIndex < 0 || seed.laneIndex >= laneCount) continue;
    const laneLengthM = lanes[seed.laneIndex].lengthM;
    const entryDistance = clamp(seed.entryDistance, 0, laneLengthM);
    const exitDistance = clamp(seed.exitDistance, entryDistance, laneLengthM);
    if (
      Number.isFinite(targetEntryDistance[seed.laneIndex]) &&
      targetEntryDistance[seed.laneIndex] <= entryDistance
    ) {
      continue;
    }
    targetEntryDistance[seed.laneIndex] = entryDistance;
    targetExitDistance[seed.laneIndex] = exitDistance;
    targetMinimumDirectOriginDistance[seed.laneIndex] =
      seed.minimumDirectOriginDistance ?? Number.NEGATIVE_INFINITY;
    targetAllowsPredecessorEntry[seed.laneIndex] =
      seed.allowPredecessorEntry === false ? 0 : 1;
    distanceFromLaneStartByHopBudget[seed.laneIndex] = entryDistance;
    usedHopsByHopBudget[seed.laneIndex] = 0;
    targetLaneIndexByHopBudget[seed.laneIndex] = seed.laneIndex;
  }

  const predecessorIndicesByLaneIndex = Array.from(
    { length: laneCount },
    () => [] as number[],
  );
  for (
    let predecessorIndex = 0;
    predecessorIndex < laneCount;
    predecessorIndex += 1
  ) {
    const predecessor = lanes[predecessorIndex];
    const predecessorEnd =
      predecessor.lane.points[predecessor.lane.points.length - 1];
    for (const successorId of predecessor.lane.successorLaneIds ?? []) {
      const successorIndex = laneIndexById.get(successorId);
      if (successorIndex === undefined) continue;
      const successorStart = lanes[successorIndex].lane.points[0];
      if (distance(predecessorEnd, successorStart) <= 0.5) {
        predecessorIndicesByLaneIndex[successorIndex].push(predecessorIndex);
      }
    }
  }

  for (let hopBudget = 1; hopBudget < budgetCount; hopBudget += 1) {
    const priorOffset = (hopBudget - 1) * laneCount;
    const offset = hopBudget * laneCount;
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
    for (
      let successorIndex = 0;
      successorIndex < laneCount;
      successorIndex += 1
    ) {
      const successorDistance =
        distanceFromLaneStartByHopBudget[priorOffset + successorIndex];
      const successorUsedHops =
        usedHopsByHopBudget[priorOffset + successorIndex];
      const successorTarget =
        targetLaneIndexByHopBudget[priorOffset + successorIndex];
      if (
        !Number.isFinite(successorDistance) ||
        successorUsedHops === 0xffff ||
        successorTarget < 0 ||
        (successorUsedHops === 0 &&
          targetAllowsPredecessorEntry[successorIndex] === 0)
      ) {
        continue;
      }
      for (const predecessorIndex of
        predecessorIndicesByLaneIndex[successorIndex]) {
        const candidateDistance =
          lanes[predecessorIndex].lengthM + successorDistance;
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
                (successorTarget > priorTarget ||
                  (successorTarget === priorTarget &&
                    priorNext >= 0 &&
                    successorIndex >= priorNext)))))
        ) {
          continue;
        }
        distanceFromLaneStartByHopBudget[stateIndex] = candidateDistance;
        usedHopsByHopBudget[stateIndex] = candidateUsedHops;
        nextLaneIndexByHopBudget[stateIndex] = successorIndex;
        targetLaneIndexByHopBudget[stateIndex] = successorTarget;
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

function independentGoalTravelTimeSeconds(
  lanes: readonly OracleLane[],
  table: IndependentGoalTable,
  originLaneIndex: number,
  rawOriginDistanceM: number,
  rawHopBudget: number,
): { readonly seconds: number; readonly targetLaneIndex: number } | null {
  const originLane = lanes[originLaneIndex];
  if (!originLane) return null;
  let laneIndex = originLaneIndex;
  let distanceAlongM = clamp(rawOriginDistanceM, 0, originLane.lengthM);
  let hopBudget = clamp(Math.trunc(rawHopBudget), 0, APPROACH_ROUTE_HOPS);
  const directTargetEntry = table.targetEntryDistance[laneIndex];
  const physicalDistanceM = Number.isFinite(directTargetEntry)
    ? Math.max(0, directTargetEntry - distanceAlongM)
    : Math.max(
        0,
        table.distanceFromLaneStartByHopBudget[
          hopBudget * table.laneCount + laneIndex
        ] - distanceAlongM,
      );
  const usedHops = Number.isFinite(directTargetEntry)
    ? 0
    : table.usedHopsByHopBudget[
        hopBudget * table.laneCount + laneIndex
      ];
  if (
    !Number.isFinite(physicalDistanceM) ||
    physicalDistanceM > APPROACH_ROUTE_DISTANCE_M ||
    usedHops === 0xffff ||
    usedHops > hopBudget
  ) {
    return null;
  }
  const speedOn = (lane: OracleLane): number =>
    Math.max(
      1,
      clamp(lane.lane.speedLimitMps ?? 13.4, 2, 45) *
        STREAMABLE_DRIVER_SPEED_FACTOR,
    );
  let etaSeconds = STREAMABLE_STARTUP_SECONDS;
  for (
    let transition = 0;
    transition <= APPROACH_ROUTE_HOPS;
    transition += 1
  ) {
    const lane = lanes[laneIndex];
    const targetEntry = table.targetEntryDistance[laneIndex];
    if (Number.isFinite(targetEntry)) {
      if (
        distanceAlongM <
          table.targetMinimumDirectOriginDistance[laneIndex] - 1e-9 ||
        distanceAlongM > table.targetExitDistance[laneIndex] + 1e-9
      ) {
        return null;
      }
      etaSeconds +=
        Math.max(0, targetEntry - distanceAlongM) / speedOn(lane);
      return { seconds: etaSeconds, targetLaneIndex: laneIndex };
    }
    if (hopBudget <= 0) return null;
    const stateIndex = hopBudget * table.laneCount + laneIndex;
    const nextLaneIndex = table.nextLaneIndexByHopBudget[stateIndex];
    const nextLane = lanes[nextLaneIndex];
    if (!nextLane) return null;
    const currentEnd = lane.lane.points[lane.lane.points.length - 1];
    if (
      !(lane.lane.successorLaneIds ?? []).includes(nextLane.lane.id) ||
      distance(currentEnd, nextLane.lane.points[0]) > 0.5
    ) {
      return null;
    }
    etaSeconds +=
      Math.max(0, lane.lengthM - distanceAlongM) / speedOn(lane);
    laneIndex = nextLaneIndex;
    distanceAlongM = 0;
    hopBudget -= 1;
  }
  return null;
}

/** Count unique current/forward target-interval slots reachable from hidden
 * immutable portals within thirty seconds. Source portal multiplicity never
 * inflates the result; only safely spaced destination storage is credited. */
function resolveIndependentStreamableCorridorCapacity(
  config: SimulationCoreConfig,
  laneOracle: ReadonlyMap<string, OracleLane>,
  currentCorridor: CurrentCorridorOracle,
  player: SimulationSnapshot["player"],
  device: DeviceClass,
): StreamableCorridorCapacity {
  const lanes = (config.lanes ?? []).map((lane) => {
    const oracleLane = laneOracle.get(lane.id);
    if (!oracleLane) throw new Error(`missing lane oracle for ${lane.id}`);
    return oracleLane;
  });
  const laneIndexById = new Map(
    lanes.map((lane, index) => [lane.lane.id, index]),
  );
  const currentSeeds: IndependentGoalSeed[] = [];
  const forwardSeeds: IndependentGoalSeed[] = [];
  const alignmentMinimum = Math.cos(CURRENT_CORRIDOR_ALIGNMENT_RAD);
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (!currentCorridor.laneIds.has(lane.lane.id)) continue;
    const currentInterval = firstIndependentLaneLocalityInterval(
      lane,
      player,
      FOG_RADIUS_M,
      currentCorridor.heading,
      false,
    );
    if (currentInterval) {
      currentSeeds.push({ laneIndex, ...currentInterval });
    }
    const forwardInterval = firstIndependentLaneLocalityInterval(
      lane,
      player,
      FOG_RADIUS_M,
      currentCorridor.heading,
      true,
    );
    if (!forwardInterval) continue;
    const start = lane.lane.points[0];
    const startHeading = endpointHeading(lane.lane, true);
    const sameDirection =
      startHeading !== null &&
      Math.cos(angleDifference(startHeading, currentCorridor.heading)) >=
        alignmentMinimum;
    const startLongitudinal =
      (start.x - player.x) * Math.sin(currentCorridor.heading) +
      (start.z - player.z) * Math.cos(currentCorridor.heading);
    const unsafeSameDirectionLaneStart =
      sameDirection && startLongitudinal < -1e-9;
    forwardSeeds.push({
      laneIndex,
      ...forwardInterval,
      ...(unsafeSameDirectionLaneStart
        ? {
            minimumDirectOriginDistance: forwardInterval.entryDistance,
            allowPredecessorEntry: false,
          }
        : {}),
    });
  }

  const currentTable = buildIndependentGoalTable(
    lanes,
    laneIndexById,
    currentSeeds,
  );
  const forwardTable = buildIndependentGoalTable(
    lanes,
    laneIndexById,
    forwardSeeds,
  );
  const currentTargetMarks = new Uint8Array(lanes.length);
  const forwardTargetMarks = new Uint8Array(lanes.length);
  const capacityLaneIds = new Set(config.trafficCapacityLaneIds ?? []);
  for (const portal of config.runtimeTrafficPortals ?? []) {
    const laneIndex = laneIndexById.get(portal.laneId);
    if (laneIndex === undefined || !capacityLaneIds.has(portal.laneId)) {
      continue;
    }
    const portalDistanceM = clamp(
      portal.distance,
      0,
      lanes[laneIndex].lengthM,
    );
    // Runtime normalizes every public portal back onto its lane before the
    // annulus query. Do the same instead of trusting cached portal x/z fields.
    const portalPose = pointOnLane(
      lanes[laneIndex].lane,
      portalDistanceM,
    );
    const radialM = distance(portalPose, player);
    if (
      radialM < STREAMABLE_APPROACH_MIN_M ||
      radialM > STREAMABLE_APPROACH_MAX_M
    ) {
      continue;
    }
    for (
      let hopBudget = 0;
      hopBudget <= APPROACH_ROUTE_HOPS;
      hopBudget += 1
    ) {
      const current = independentGoalTravelTimeSeconds(
        lanes,
        currentTable,
        laneIndex,
        portalDistanceM,
        hopBudget,
      );
      if (current && current.seconds <= STREAMABLE_FEED_ETA_SECONDS) {
        currentTargetMarks[current.targetLaneIndex] = 1;
      }
      const forward = independentGoalTravelTimeSeconds(
        lanes,
        forwardTable,
        laneIndex,
        portalDistanceM,
        hopBudget,
      );
      if (forward && forward.seconds <= STREAMABLE_FEED_ETA_SECONDS) {
        forwardTargetMarks[forward.targetLaneIndex] = 1;
      }
    }
  }

  const { laneCap, corridorCap } = MOVING_CALIBRATION[device];
  const countSlots = (
    marks: Uint8Array,
    table: IndependentGoalTable,
  ): number => {
    let slots = 0;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (
        marks[laneIndex] !== 1 ||
        !capacityLaneIds.has(lanes[laneIndex].lane.id)
      ) {
        continue;
      }
      slots += Math.min(
        laneCap,
        Math.floor(
          Math.max(
            0,
            table.targetExitDistance[laneIndex] -
              table.targetEntryDistance[laneIndex],
          ) / CURRENT_CORRIDOR_SAFE_SPACING_M,
        ),
      );
    }
    return Math.min(corridorCap, slots);
  };
  return {
    currentRoad: countSlots(currentTargetMarks, currentTable),
    forwardRoad: countSlots(forwardTargetMarks, forwardTable),
  };
}

/**
 * Public-graph proof for the plan's "route-connected" clause. Runtime traffic
 * may temporarily follow a goal-directed next hop which public snapshots do
 * not expose, so predicting one private successor policy would self-grade the
 * wrong route. Instead, this oracle proves that some legal endpoint-continuous
 * path reaches the corridor; the caller separately requires actual inward
 * velocity so a visibly departing car cannot satisfy the perceptual count.
 */
function routeReachesApproachCorridor(
  laneOracle: ReadonlyMap<string, OracleLane>,
  firstLane: OracleLane,
  firstDistanceM: number,
  centre: SimulationPoint,
): boolean {
  interface RouteState {
    readonly lane: OracleLane;
    readonly fromDistanceM: number;
    readonly travelledM: number;
    readonly hops: number;
  }
  const queue: RouteState[] = [
    {
      lane: firstLane,
      fromDistanceM: clamp(firstDistanceM, 0, firstLane.lengthM),
      travelledM: 0,
      hops: 0,
    },
  ];
  // Distance and hop limits are independent: reaching the same lane with less
  // distance but more hops must not suppress a slightly longer path that still
  // has enough hops left to enter the approach corridor.
  const bestTravelledByLaneAndHop = new Map<string, number>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    const remainingM = APPROACH_ROUTE_DISTANCE_M - state.travelledM;
    if (remainingM < 0) continue;
    const toDistanceM = Math.min(
      state.lane.lengthM,
      state.fromDistanceM + remainingM,
    );
    if (
      laneRangeReachesCircle(
        state.lane,
        state.fromDistanceM,
        toDistanceM,
        centre,
      )
    ) {
      return true;
    }
    const distanceToEndM = state.lane.lengthM - state.fromDistanceM;
    if (
      state.hops >= APPROACH_ROUTE_HOPS ||
      distanceToEndM > remainingM
    ) {
      continue;
    }
    const sourceEnd =
      state.lane.lane.points[state.lane.lane.points.length - 1];
    const successorIds = state.lane.lane.successorLaneIds?.length
      ? state.lane.lane.successorLaneIds
      : state.lane.lane.loop === false
        ? []
        : [state.lane.lane.id];
    const nextTravelledM = state.travelledM + distanceToEndM;
    for (const successorId of successorIds) {
      const successor = laneOracle.get(successorId);
      if (
        !successor ||
        distance(sourceEnd, successor.lane.points[0]) > 0.5
      ) {
        continue;
      }
      const successorHops = state.hops + 1;
      const stateKey = `${successorId}:${successorHops}`;
      const priorTravelledM = bestTravelledByLaneAndHop.get(stateKey);
      if (
        priorTravelledM !== undefined &&
        priorTravelledM <= nextTravelledM
      ) {
        continue;
      }
      bestTravelledByLaneAndHop.set(stateKey, nextTravelledM);
      queue.push({
        lane: successor,
        fromDistanceM: 0,
        travelledM: nextTravelledM,
        hops: successorHops,
      });
    }
  }
  return false;
}

function countMovingPerception(
  snapshot: SimulationSnapshot,
  config: SimulationCoreConfig,
  laneOracle: ReadonlyMap<string, OracleLane>,
  predecessors: LanePredecessors,
  nearRadiusM: number,
  device: DeviceClass,
): {
  readonly sample: MovingPerceptualSample;
  readonly hasCurrentCorridor: boolean;
  readonly safeCapacity: CurrentCorridorSafeCapacity;
  readonly streamableCapacity: StreamableCorridorCapacity;
  readonly duplicateNpcIdentityCount: number;
} {
  const playerRoad = projectPlayerLane(laneOracle, snapshot.player);
  const currentCorridor = buildIndependentCurrentCorridor(
    laneOracle,
    predecessors,
    playerRoad,
    snapshot.player,
  );
  let withinInner = 0;
  let movingWithinInner = 0;
  let aheadOrApproaching = 0;
  let nearView = 0;
  let duplicateNpcIdentityCount = 0;
  const seenNpcIds = new Set<string>();
  const currentRoadIds = new Set<string>();
  const forwardRoadIds = new Set<string>();
  const movingCurrentRoadIds = new Set<string>();
  const movingForwardRoadIds = new Set<string>();
  const movingOffCurrentFallbackIds = new Set<string>();
  for (const npc of snapshot.npcs) {
    if (seenNpcIds.has(npc.id)) {
      duplicateNpcIdentityCount += 1;
      continue;
    }
    seenNpcIds.add(npc.id);
    const dx = npc.x - snapshot.player.x;
    const dz = npc.z - snapshot.player.z;
    const separationM = Math.hypot(dx, dz);
    if (separationM > FOG_RADIUS_M) continue;
    const moving = npc.speedMps >= MOVING_SPEED_MPS;
    const npcLane = laneOracle.get(npc.laneId);
    const onCurrentRoad = Boolean(
      npcLane && currentCorridor.laneIds.has(npcLane.lane.id),
    );
    if (npcLane && onCurrentRoad) {
      currentRoadIds.add(npc.id);
      if (moving) movingCurrentRoadIds.add(npc.id);
      const longitudinal =
        dx * Math.sin(playerRoad.projection.heading) +
        dz * Math.cos(playerRoad.projection.heading);
      if (longitudinal >= 0) {
        forwardRoadIds.add(npc.id);
        if (moving) movingForwardRoadIds.add(npc.id);
      }
    }
    const bearing = Math.abs(
      angleDifference(Math.atan2(dx, dz), snapshot.player.heading),
    );
    if (separationM <= nearRadiusM && bearing <= AHEAD_HALF_ANGLE_RAD) {
      nearView += 1;
    }
    if (separationM > INNER_RADIUS_M) continue;
    withinInner += 1;
    if (moving) {
      movingWithinInner += 1;
      if (!onCurrentRoad) movingOffCurrentFallbackIds.add(npc.id);
    }
    if (bearing <= AHEAD_HALF_ANGLE_RAD) {
      aheadOrApproaching += 1;
      continue;
    }
    if (!moving || separationM <= Number.EPSILON || !npcLane) continue;
    const projection = projectToLane(npcLane.lane, npc);
    if (!projection) continue;
    const crossTangent =
      Math.abs(
        Math.cos(
          angleDifference(projection.heading, snapshot.player.heading),
        ),
      ) < Math.cos(CROSS_TANGENT_MINIMUM_RAD);
    const inwardCosine =
      (Math.sin(npc.heading) * -dx + Math.cos(npc.heading) * -dz) /
      separationM;
    if (
      crossTangent &&
      inwardCosine > 0 &&
      routeReachesApproachCorridor(
        laneOracle,
        npcLane,
        projection.distanceAlongM,
        snapshot.player,
      )
    ) {
      aheadOrApproaching += 1;
    }
  }
  // A malformed duplicate row cannot simultaneously represent one identity
  // on the current corridor and in its disjoint fallback set.
  for (const id of currentRoadIds) movingOffCurrentFallbackIds.delete(id);
  const currentRoad = currentRoadIds.size;
  const forwardRoad = forwardRoadIds.size;
  const movingOffCurrentFallback = movingOffCurrentFallbackIds.size;
  return {
    sample: {
      withinInner,
      movingWithinInner,
      currentRoad,
      forwardRoad,
      movingCurrentRoad: movingCurrentRoadIds.size,
      movingForwardRoad: movingForwardRoadIds.size,
      movingOffCurrentFallback,
      conservedCurrentPresence: currentRoad + movingOffCurrentFallback,
      conservedForwardPresence: forwardRoad + movingOffCurrentFallback,
      aheadOrApproaching,
      nearView,
    },
    hasCurrentCorridor: currentCorridor.laneIds.size > 0,
    safeCapacity: {
      currentRoad: Math.floor(
        currentCorridor.clippedLengthM / CURRENT_CORRIDOR_SAFE_SPACING_M,
      ),
      forwardRoad: Math.floor(
        currentCorridor.forwardClippedLengthM /
          CURRENT_CORRIDOR_SAFE_SPACING_M,
      ),
    },
    streamableCapacity: resolveIndependentStreamableCorridorCapacity(
      config,
      laneOracle,
      currentCorridor,
      snapshot.player,
      device,
    ),
    duplicateNpcIdentityCount,
  };
}

function percentile(values: readonly number[], requested: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * requested;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function maximumBelowFloorRun(
  values: readonly number[],
  floors: readonly number[],
): number {
  if (values.length !== floors.length) {
    throw new Error("moving density values/floors length mismatch");
  }
  let current = 0;
  let maximum = 0;
  for (let index = 0; index < values.length; index += 1) {
    current = values[index] < floors[index] ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function runMovingPerceptualCase(
  config: SimulationCoreConfig,
  label: string,
  device: DeviceClass,
): { readonly report: MovingPerceptualReport; readonly failures: readonly string[] } {
  const calibration = MOVING_CALIBRATION[device];
  const failures: string[] = [];
  if (config.npcCount !== calibration.poolCount) {
    failures.push(
      `configured pool ${String(config.npcCount)} != frozen ${calibration.poolCount}`,
    );
  }
  const route = buildRoutePath(config);
  const laneOracle = buildLaneOracle(config.lanes ?? []);
  const predecessors = buildLanePredecessors(laneOracle);
  const controller = new LaneCentreController(route);
  const simulation = new SimulationCore(config);
  const samples: MovingPerceptualSample[] = [];
  const sampleFloors: MovingPerceptualFloor[] = [];
  const safeCapacities: CurrentCorridorSafeCapacity[] = [];
  const streamableCapacities: StreamableCorridorCapacity[] = [];
  const continuityShortfalls: number[] = [];
  const desiredApproachJourneys: number[] = [];
  const liveApproachGoals: number[] = [];
  const committedApproachJourneys: number[] = [];
  let missingCurrentCorridorSamples = 0;
  let offRoadTicks = 0;
  const unsafeEvents: string[] = [];
  let poolInvariantFailures = 0;
  let lifecycleBalanceInvariantFailures = 0;
  let duplicateNpcIdentityCount = 0;
  let snapshot = simulation.getSnapshot();
  const initialLocality = simulation.getTrafficDiagnostics().locality;
  let finalLocality = initialLocality;
  try {
    for (let tick = 0; tick < TOTAL_TICKS; tick += 1) {
      snapshot = simulation.step(
        FIXED_STEP_SECONDS,
        controller.inputFor(snapshot),
      );
      if (snapshot.road.offRoad || snapshot.road.laneId === null) offRoadTicks += 1;
      for (const event of simulation.drainEvents()) {
        if (event.code !== "collision" && event.code !== "wrong_way") continue;
        const nearestNpc = snapshot.npcs
          .map((npc) => ({
            id: npc.id,
            laneId: npc.laneId,
            separationM: distance(snapshot.player, npc),
            speedMps: npc.speedMps,
            state: npc.state,
          }))
          .sort(
            (left, right) =>
              left.separationM - right.separationM ||
              left.id.localeCompare(right.id),
          )[0];
        unsafeEvents.push(
          JSON.stringify({
            tick: snapshot.tick,
            code: event.code,
            evidence: event.evidence,
            player: {
              x: snapshot.player.x,
              z: snapshot.player.z,
              heading: snapshot.player.heading,
              speedMps: snapshot.player.speedMps,
              laneId: snapshot.road.laneId,
              offRoad: snapshot.road.offRoad,
            },
            nearestNpc,
          }),
        );
      }
      if (
        snapshot.npcs.length + snapshot.queuedNpcCount !==
        calibration.poolCount
      ) {
        poolInvariantFailures += 1;
      }
      const locality = simulation.getTrafficDiagnostics().locality;
      finalLocality = locality;
      const cumulativeActivations =
        locality.activations - initialLocality.activations;
      const cumulativeRetirements =
        locality.retirements - initialLocality.retirements;
      const expectedActiveCount =
        initialLocality.activeCount +
        cumulativeActivations -
        cumulativeRetirements;
      if (
        expectedActiveCount !== snapshot.npcs.length ||
        locality.activeCount !== snapshot.npcs.length
      ) {
        lifecycleBalanceInvariantFailures += 1;
      }
      if (tick + 1 <= WARMUP_TICKS) continue;
      if ((tick + 1 - WARMUP_TICKS) % TICKS_PER_SAMPLE !== 0) continue;
      const result = countMovingPerception(
        snapshot,
        config,
        laneOracle,
        predecessors,
        calibration.nearRadiusM,
        device,
      );
      samples.push(result.sample);
      duplicateNpcIdentityCount += result.duplicateNpcIdentityCount;
      const storageCurrentTarget = Math.min(
        calibration.targetCurrentRoad,
        result.safeCapacity.currentRoad,
      );
      const storageForwardTarget = Math.min(
        calibration.targetForwardRoad,
        storageCurrentTarget,
        result.safeCapacity.forwardRoad,
      );
      const fastCurrentTarget = Math.min(
        storageCurrentTarget,
        result.streamableCapacity.currentRoad,
      );
      const fastForwardTarget = Math.min(
        storageForwardTarget,
        fastCurrentTarget,
        result.streamableCapacity.forwardRoad,
      );
      // Production pipeline sizing uses the larger raw fast-feed miss, never
      // the sum of nested current/forward buckets. Report that expected Q, but
      // grade fallback below against the actual storage miss at this sample.
      const continuityShortfall = Math.max(
        calibration.targetCurrentRoad - fastCurrentTarget,
        calibration.targetForwardRoad - fastForwardTarget,
      );
      // Acceptance compensation is based on what is actually missing now,
      // not on the pipeline-sizing Q above. A healthy full corridor therefore
      // needs no redundant fallback fleet. The one disjoint set pays the
      // larger nested storage miss once for both current and forward.
      const dynamicFallbackShortfall = Math.max(
        0,
        storageCurrentTarget - result.sample.currentRoad,
        storageForwardTarget - result.sample.forwardRoad,
      );
      sampleFloors.push({
        currentRoad: Math.min(
          calibration.currentRoad,
          fastCurrentTarget,
        ),
        forwardRoad: Math.min(
          calibration.forwardRoad,
          fastForwardTarget,
        ),
        movingCurrentRoad: Math.min(
          calibration.movingCurrentRoad,
          fastCurrentTarget,
        ),
        movingForwardRoad: Math.min(
          calibration.movingForwardRoad,
          fastForwardTarget,
        ),
        movingOffCurrentFallback: dynamicFallbackShortfall,
        conservedCurrentPresence: storageCurrentTarget,
        conservedForwardPresence: storageForwardTarget,
        aheadOrApproaching: calibration.aheadOrApproaching,
        nearView: calibration.nearView,
      });
      safeCapacities.push(result.safeCapacity);
      streamableCapacities.push(result.streamableCapacity);
      continuityShortfalls.push(continuityShortfall);
      desiredApproachJourneys.push(locality.targetAheadJourneyCount);
      liveApproachGoals.push(locality.liveApproachGoalCount);
      committedApproachJourneys.push(
        locality.inboundPerceptualTransitCount,
      );
      if (!result.hasCurrentCorridor) missingCurrentCorridorSamples += 1;
    }
  } finally {
    simulation.dispose();
  }

  const values = <Key extends keyof MovingPerceptualSample>(
    key: Key,
  ): number[] => samples.map((sample) => sample[key]);
  const p50 = {
    movingWithinInner: percentile(values("movingWithinInner"), 0.5),
    currentRoad: percentile(values("currentRoad"), 0.5),
    forwardRoad: percentile(values("forwardRoad"), 0.5),
    movingCurrentRoad: percentile(values("movingCurrentRoad"), 0.5),
    movingForwardRoad: percentile(values("movingForwardRoad"), 0.5),
    movingOffCurrentFallback: percentile(
      values("movingOffCurrentFallback"),
      0.5,
    ),
    conservedCurrentPresence: percentile(
      values("conservedCurrentPresence"),
      0.5,
    ),
    conservedForwardPresence: percentile(
      values("conservedForwardPresence"),
      0.5,
    ),
    aheadOrApproaching: percentile(values("aheadOrApproaching"), 0.5),
    nearView: percentile(values("nearView"), 0.5),
  };
  const floorValues = (key: MovingFloorKey): number[] =>
    sampleFloors.map((floor) => floor[key]);
  const p50EffectiveFloor = Object.fromEntries(
    MOVING_FLOOR_KEYS.map((key) => [key, percentile(floorValues(key), 0.5)]),
  ) as MovingPerceptualFloor;
  const p50FloorMargin = Object.fromEntries(
    MOVING_FLOOR_KEYS.map((key) => [
      key,
      percentile(
        samples.map((sample, index) => sample[key] - sampleFloors[index][key]),
        0.5,
      ),
    ]),
  ) as MovingPerceptualFloor;
  const p50SafeCapacity = {
    currentRoad: percentile(
      safeCapacities.map((capacity) => capacity.currentRoad),
      0.5,
    ),
    forwardRoad: percentile(
      safeCapacities.map((capacity) => capacity.forwardRoad),
      0.5,
    ),
  };
  const p50StreamableCapacity = {
    currentRoad: percentile(
      streamableCapacities.map((capacity) => capacity.currentRoad),
      0.5,
    ),
    forwardRoad: percentile(
      streamableCapacities.map((capacity) => capacity.forwardRoad),
      0.5,
    ),
  };
  const p50ContinuityShortfall = percentile(continuityShortfalls, 0.5);
  const p50DesiredApproachJourneys = percentile(
    desiredApproachJourneys,
    0.5,
  );
  const p50LiveApproachGoals = percentile(liveApproachGoals, 0.5);
  const p50CommittedApproachJourneys = percentile(
    committedApproachJourneys,
    0.5,
  );
  const maximumBelowFloorSeconds = Object.fromEntries(
    MOVING_FLOOR_KEYS.map((key) => [
      key,
      maximumBelowFloorRun(values(key), floorValues(key)) / SAMPLE_HZ,
    ]),
  ) as MovingPerceptualReport["maximumBelowFloorSeconds"];
  const movingInnerFraction =
    samples.reduce(
      (total, sample) =>
        total +
        (sample.withinInner === 0
          ? 0
          : sample.movingWithinInner / sample.withinInner),
      0,
    ) / samples.length;
  const cumulativeActivations =
    finalLocality.activations - initialLocality.activations;
  const cumulativeRetirements =
    finalLocality.retirements - initialLocality.retirements;
  const lifecycleTransitionLimit =
    calibration.poolCount * MAXIMUM_FLEET_TURNOVERS_PER_RUN;

  for (const key of MOVING_FLOOR_KEYS) {
    const observed = p50[key];
    const floor = p50EffectiveFloor[key];
    const margin = p50FloorMargin[key];
    if (margin < 0) {
      failures.push(
        `${key} capacity-aware p50 margin ${margin.toFixed(1)} < 0 (observed p50 ${observed.toFixed(1)}, effective-floor p50 ${floor.toFixed(1)})`,
      );
    }
    const gapSeconds = maximumBelowFloorSeconds[key];
    if (gapSeconds > MAXIMUM_BELOW_FLOOR_SECONDS) {
      failures.push(
        `${key} below-floor gap ${gapSeconds.toFixed(1)}s > ${MAXIMUM_BELOW_FLOOR_SECONDS}s`,
      );
    }
  }
  if (movingInnerFraction < MINIMUM_MOVING_INNER_FRACTION) {
    failures.push(
      `moving-inner fraction ${movingInnerFraction.toFixed(3)} < ${MINIMUM_MOVING_INNER_FRACTION}`,
    );
  }
  if (snapshot.player.distanceTravelledM < MINIMUM_PLAYER_TRAVEL_M) {
    failures.push(
      `player travel ${snapshot.player.distanceTravelledM.toFixed(1)}m < ${MINIMUM_PLAYER_TRAVEL_M}m`,
    );
  }
  if (controller.routeProgressM < MINIMUM_ROUTE_PROGRESS_M) {
    failures.push(
      `route progress ${controller.routeProgressM.toFixed(1)}m < ${MINIMUM_ROUTE_PROGRESS_M}m`,
    );
  }
  if (samples.length !== SAMPLE_SECONDS * SAMPLE_HZ) {
    failures.push(
      `sample count ${samples.length} != ${SAMPLE_SECONDS * SAMPLE_HZ}`,
    );
  }
  if (missingCurrentCorridorSamples > 0) {
    failures.push(
      `player lacked an independent current-road corridor in ${missingCurrentCorridorSamples} samples`,
    );
  }
  if (offRoadTicks > 0) failures.push(`player was off-road for ${offRoadTicks} ticks`);
  if (unsafeEvents.length > 0) {
    failures.push(
      `${unsafeEvents.length} collision/wrong-way events: ${unsafeEvents.join(" | ")}`,
    );
  }
  if (poolInvariantFailures > 0) {
    failures.push(`pool conservation failed on ${poolInvariantFailures} ticks`);
  }
  if (cumulativeActivations > lifecycleTransitionLimit) {
    failures.push(
      `cumulative activations ${cumulativeActivations} > ${lifecycleTransitionLimit} (${MAXIMUM_FLEET_TURNOVERS_PER_RUN}x pool)`,
    );
  }
  if (cumulativeRetirements > lifecycleTransitionLimit) {
    failures.push(
      `cumulative retirements ${cumulativeRetirements} > ${lifecycleTransitionLimit} (${MAXIMUM_FLEET_TURNOVERS_PER_RUN}x pool)`,
    );
  }
  if (lifecycleBalanceInvariantFailures > 0) {
    failures.push(
      `activation-retirement/live balance failed on ${lifecycleBalanceInvariantFailures} ticks`,
    );
  }
  if (duplicateNpcIdentityCount > 0) {
    failures.push(
      `public snapshots contained ${duplicateNpcIdentityCount} duplicate NPC identity rows`,
    );
  }

  return {
    report: {
      label,
      playerTravelM: snapshot.player.distanceTravelledM,
      routeProgressM: controller.routeProgressM,
      sampleCount: samples.length,
      p50,
      p50EffectiveFloor,
      p50FloorMargin,
      p50SafeCapacity,
      p50StreamableCapacity,
      p50ContinuityShortfall,
      p50DesiredApproachJourneys,
      p50LiveApproachGoals,
      p50CommittedApproachJourneys,
      localHandoffAttempts:
        finalLocality.localHandoffAttemptCount -
        initialLocality.localHandoffAttemptCount,
      localHandoffSuccesses:
        finalLocality.localHandoffCount - initialLocality.localHandoffCount,
      localHandoffCadenceBlocks:
        finalLocality.localHandoffCadenceBlockedCount -
        initialLocality.localHandoffCadenceBlockedCount,
      localHandoffNoCandidate:
        finalLocality.localHandoffNoCandidateCount -
        initialLocality.localHandoffNoCandidateCount,
      localHandoffRoleOrIncidentBlocked:
        finalLocality.localHandoffRoleOrIncidentBlockedCount -
        initialLocality.localHandoffRoleOrIncidentBlockedCount,
      localHandoffUnreachable:
        finalLocality.localHandoffUnreachableCount -
        initialLocality.localHandoffUnreachableCount,
      localHandoffTargetCapacityBlocked:
        finalLocality.localHandoffTargetCapacityBlockedCount -
        initialLocality.localHandoffTargetCapacityBlockedCount,
      localHandoffEtaBlocked:
        finalLocality.localHandoffEtaBlockedCount -
        initialLocality.localHandoffEtaBlockedCount,
      localHandoffAcceptedEtaP50Seconds:
        finalLocality.localHandoffAcceptedEtaP50Seconds,
      approachGoalContributions:
        finalLocality.approachGoalContributionCount -
        initialLocality.approachGoalContributionCount,
      approachGoalFailures:
        finalLocality.approachGoalFailureCount -
        initialLocality.approachGoalFailureCount,
      approachGoalRecenterReleases:
        finalLocality.approachGoalRecenterReleaseCount -
        initialLocality.approachGoalRecenterReleaseCount,
      movingInnerFraction,
      maximumBelowFloorSeconds,
      missingCurrentCorridorSamples,
      offRoadTicks,
      unsafeEventCount: unsafeEvents.length,
      unsafeEvents,
      poolInvariantFailures,
      initialActiveCount: initialLocality.activeCount,
      finalActiveCount: finalLocality.activeCount,
      cumulativeActivations,
      cumulativeRetirements,
      lifecycleTransitionLimit,
      lifecycleBalanceInvariantFailures,
      duplicateNpcIdentityCount,
    },
    failures,
  };
}

describe("four-city moving perceptual traffic density acceptance", () => {
  it(
    "keeps road-local traffic dense and moving while the player traverses each city",
    () => {
      expect(FREE_DRIVES).toHaveLength(4);
      const reports: MovingPerceptualReport[] = [];
      const failures: string[] = [];
      for (const freeDrive of FREE_DRIVES) {
        const country = getCountryProfile(freeDrive.countryId);
        const mapPack = getMapPack(freeDrive.mapId);
        const scenario = buildFreeDriveScenario(freeDrive);
        for (const device of ["desktop", "touch"] as const) {
          const config = buildSimulationCoreConfig({
            scenario,
            mapPack,
            trafficSide: country.trafficSide,
            speedUnit: country.speedUnit,
            touchFirst: device === "touch",
          });
          const label = `${mapPack.id}/${device}`;
          const result = runMovingPerceptualCase(config, label, device);
          reports.push(result.report);
          failures.push(
            ...result.failures.map((failure) => `${label}: ${failure}`),
          );
        }
      }
      for (const report of reports) {
        console.info(
          `[trafficMovingPerceptualDensityAcceptance] ${JSON.stringify(report)}`,
        );
      }
      expect(reports).toHaveLength(4 * 2);
      expect(
        failures,
        `Moving perceptual density failures:\n${failures.join("\n")}`,
      ).toEqual([]);
    },
    120_000,
  );
});
