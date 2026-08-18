import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationInput,
  type SimulationPoint,
  type SimulationSnapshot,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import {
  LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
  LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
  LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
} from "../app/game/simulation/trafficLocality";

/**
 * This is intentionally a fixed-step, core-only route harness. The first run
 * uses a deterministic lane-centre controller to record one input for every
 * simulation tick; the second run replays exactly those recorded inputs. That
 * keeps the safety oracle independent of browser frame cadence while still
 * making the player physically drive the real authored lane graph.
 */
const ROUTE_TICKS = 45 * 60;
const PLAYER_RADIUS_M = 1.05;
const NPC_RADIUS_M = 1;
const PLAYER_NPC_CLEARANCE_M = PLAYER_RADIUS_M + NPC_RADIUS_M;
const NPC_NPC_CLEARANCE_M = NPC_RADIUS_M * 2;
const POSITION_TOLERANCE_M = 1e-6;
const EMERGENCY_FRONT_HALF_WIDTH_M = 2.6;
const EMERGENCY_FRONT_BASE_LENGTH_M = 7;
const EMERGENCY_FRONT_REACTION_SECONDS = 0.85;
const EMERGENCY_SWEEP_HORIZON_SECONDS = 1.4;
const EMERGENCY_SWEEP_CLEARANCE_M = 3;
const EMERGENCY_REAR_ALLOWANCE_M = 1.5;
const OPPOSING_RECENTER_MAX_SPEED_MPS = 0.5;
const OPPOSING_RECENTER_ALIGNMENT_COS = -Math.cos(Math.PI / 6);
const OPPOSING_RECENTER_PROBE_SECONDS = 0.5;
const OPPOSING_RECENTER_PROBE_DISTANCE_M = 0.25;
const OPPOSING_RECENTER_HEADING_OFFSET_RAD = 0.25;
const OPPOSING_RECENTER_MIN_LATERAL_GAIN_M = 0.02;
const OPPOSING_RECENTER_CLEARANCE_MARGIN_M = 0.1;
const OPPOSING_RECENTER_MIN_STEER = 0.35;
const OPPOSING_RECENTER_THROTTLE = 0.2;

type Point = SimulationPoint;

interface RoutePath {
  readonly points: readonly Point[];
  readonly laneIds: readonly string[];
  readonly lengthM: number;
}

interface LaneControllerSnapshot {
  readonly player: Pick<
    SimulationSnapshot["player"],
    "x" | "z" | "heading" | "speedMps"
  >;
  readonly npcs: readonly Pick<
    SimulationSnapshot["npcs"][number],
    "id" | "x" | "z" | "heading" | "speedMps" | "laneId"
  >[];
}

interface RouteProjection {
  readonly progressM: number;
  readonly distanceM: number;
}

interface EmergencyDecision {
  readonly brake: boolean;
  /** -1 steers left, +1 right, 0 needs no recenter creep. */
  readonly recenterDirection: -1 | 0 | 1;
}

interface ReplayResult {
  readonly inputs: readonly SimulationInput[];
  readonly traceHash: number;
  readonly finalSnapshot: SimulationSnapshot;
  readonly playerRouteProgressM: number;
  readonly playerTravelledM: number;
  readonly visitedRouteLaneIds: readonly string[];
  readonly localityDecisionCount: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const distance = (left: Point, right: Point): number =>
  Math.hypot(left.x - right.x, left.z - right.z);

const headingBetween = (from: Point, to: Point): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

const angleDifference = (target: number, current: number): number => {
  let difference = target - current;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

const laneLength = (points: readonly Point[]): number => {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    result += distance(points[index - 1], points[index]);
  }
  return result;
};

const laneHeadingAtStart = (points: readonly Point[]): number =>
  headingBetween(points[0], points[1]);

const laneHeadingAtEnd = (points: readonly Point[]): number =>
  headingBetween(points[points.length - 2], points[points.length - 1]);

function closestProjectionOnPoints(
  points: readonly Point[],
  point: Point,
  minimumProgressM = 0,
  maximumProgressM = Number.POSITIVE_INFINITY,
): RouteProjection {
  let travelledM = 0;
  let best: RouteProjection | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    const segmentLength = Math.sqrt(lengthSquared);
    if (segmentLength <= Number.EPSILON) continue;
    const minimumFraction = clamp((minimumProgressM - travelledM) / segmentLength, 0, 1);
    const maximumFraction = clamp((maximumProgressM - travelledM) / segmentLength, 0, 1);
    if (minimumFraction > maximumFraction) {
      travelledM += segmentLength;
      continue;
    }
    const progress = clamp(
      ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared,
      minimumFraction,
      maximumFraction,
    );
    const projected = { x: from.x + dx * progress, z: from.z + dz * progress };
    const candidate = {
      progressM: travelledM + segmentLength * progress,
      distanceM: distance(point, projected),
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
    travelledM += segmentLength;
  }
  if (!best) throw new Error("Route has no non-degenerate segment");
  return best;
}

function pointAtRouteDistance(route: RoutePath, routeDistanceM: number): Point {
  let remainingM = clamp(routeDistanceM, 0, route.lengthM);
  for (let index = 1; index < route.points.length; index += 1) {
    const from = route.points[index - 1];
    const to = route.points[index];
    const segmentLength = distance(from, to);
    if (segmentLength <= Number.EPSILON) continue;
    if (remainingM <= segmentLength || index === route.points.length - 1) {
      const progress = remainingM / segmentLength;
      return {
        x: from.x + (to.x - from.x) * progress,
        z: from.z + (to.z - from.z) * progress,
      };
    }
    remainingM -= segmentLength;
  }
  return route.points[route.points.length - 1];
}

/** Select the lane the spawn already legally occupies, preferring matching
 * direction if two parallel directional lanes share the same road. */
function routeStartLane(config: SimulationCoreConfig) {
  const spawn = config.spawn;
  const lanes = config.lanes ?? [];
  if (!spawn || lanes.length === 0) throw new Error("Production route needs a spawn and lanes");
  return lanes
    .filter((lane) => lane.points.length >= 2)
    .map((lane) => {
      const projection = closestProjectionOnPoints(lane.points, spawn);
      return {
        lane,
        score:
          projection.distanceM +
          Math.abs(angleDifference(laneHeadingAtStart(lane.points), spawn.heading)) * 0.25,
      };
    })
    .sort((left, right) => left.score - right.score || left.lane.id.localeCompare(right.lane.id))[0]
    ?.lane;
}

/** Builds a stable, legal continuation route through the authored successor
 * graph. The straightest legal successor wins, then id is the tie-break. */
function buildRoutePath(config: SimulationCoreConfig): RoutePath {
  const lanes = config.lanes ?? [];
  const start = routeStartLane(config);
  if (!start || !config.spawn) throw new Error("Cannot resolve route start lane");
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
  const laneIds: string[] = [];
  const points: Point[] = [];
  let lane = start;
  let previousHeading = laneHeadingAtEnd(lane.points);

  for (let hop = 0; hop < 12; hop += 1) {
    laneIds.push(lane.id);
    const startOffset = hop === 0
      ? closestProjectionOnPoints(lane.points, config.spawn).progressM
      : 0;
    let travelledM = 0;
    for (let index = 1; index < lane.points.length; index += 1) {
      const from = lane.points[index - 1];
      const to = lane.points[index];
      const segmentLength = distance(from, to);
      const segmentStartM = travelledM;
      travelledM += segmentLength;
      if (travelledM <= startOffset || segmentLength <= Number.EPSILON) continue;
      const fraction =
        startOffset > segmentStartM ? (startOffset - segmentStartM) / segmentLength : 0;
      const startPoint = {
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
      };
      if (!points.length || distance(points[points.length - 1], startPoint) > 1e-6) {
        points.push(startPoint);
      }
      points.push(to);
    }
    const candidates = (lane.successorLaneIds ?? [])
      .map((id) => lanesById.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate && candidate.points.length >= 2),
      )
      .sort((left, right) => {
        const headingDelta =
          Math.abs(angleDifference(laneHeadingAtStart(left.points), previousHeading)) -
          Math.abs(angleDifference(laneHeadingAtStart(right.points), previousHeading));
        return headingDelta || left.id.localeCompare(right.id);
      });
    if (!candidates.length) break;
    lane = candidates[0];
    previousHeading = laneHeadingAtEnd(lane.points);
  }
  const lengthM = laneLength(points);
  if (points.length < 2 || lengthM < 180) {
    throw new Error(`Route from ${start.id} is too short (${lengthM.toFixed(1)}m)`);
  }
  return { points, laneIds, lengthM };
}

class LaneCentreController {
  private progressM = 0;
  private readonly routeLaneIds: ReadonlySet<string>;

  constructor(private readonly route: RoutePath) {
    this.routeLaneIds = new Set(route.laneIds);
  }

  private leadGapM(snapshot: LaneControllerSnapshot): number {
    let gap = Number.POSITIVE_INFINITY;
    for (const npc of snapshot.npcs) {
      // Geometric projection alone aliases Cairo's opposing carriageway onto
      // this route (the lane centres are only 3.3 m apart). Only a vehicle on
      // the chosen directed successor chain can be this controller's leader.
      if (!this.routeLaneIds.has(npc.laneId)) continue;
      const projection = closestProjectionOnPoints(
        this.route.points,
        npc,
        Math.max(0, this.progressM - 5),
        this.progressM + 70,
      );
      const ahead = projection.progressM - this.progressM;
      if (ahead <= 0 || projection.distanceM > 4.5) continue;
      gap = Math.min(gap, ahead);
    }
    return gap;
  }

  /**
   * Normal headway is restricted to the chosen directed route so an opposing
   * parallel lane cannot pin the replay. A route-independent emergency layer
   * still has to yield to genuine cross traffic: it brakes for any NPC already
   * in a short heading-aligned capsule, or whose relative velocity sweep is
   * predicted to enter a three-metre clearance envelope within 1.4 seconds.
   */
  private safeOpposingRecenterDirection(
    snapshot: LaneControllerSnapshot,
    npc: LaneControllerSnapshot["npcs"][number],
    lateralM: number,
    separationM: number,
  ): -1 | 0 | 1 {
    if (
      this.routeLaneIds.has(npc.laneId) ||
      snapshot.player.speedMps > OPPOSING_RECENTER_MAX_SPEED_MPS ||
      npc.speedMps > OPPOSING_RECENTER_MAX_SPEED_MPS ||
      Math.cos(angleDifference(npc.heading, snapshot.player.heading)) >
        OPPOSING_RECENTER_ALIGNMENT_COS ||
      separationM <
        PLAYER_NPC_CLEARANCE_M + OPPOSING_RECENTER_CLEARANCE_MARGIN_M
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
        PLAYER_NPC_CLEARANCE_M + OPPOSING_RECENTER_CLEARANCE_MARGIN_M ||
      Math.abs(candidateLateralM) <
        Math.abs(lateralM) + OPPOSING_RECENTER_MIN_LATERAL_GAIN_M
    ) {
      return 0;
    }
    return direction;
  }

  private emergencyDecision(snapshot: LaneControllerSnapshot): EmergencyDecision {
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
      if (
        !inFrontCapsule &&
        forwardM < -EMERGENCY_REAR_ALLOWANCE_M ||
        (!inFrontCapsule &&
          separationM >
            frontLengthM +
              npc.speedMps * EMERGENCY_SWEEP_HORIZON_SECONDS +
              EMERGENCY_SWEEP_CLEARANCE_M)
      ) {
        continue;
      }
      if (!inFrontCapsule) {
        const relativeVelocityX =
          Math.sin(npc.heading) * npc.speedMps - playerVelocityX;
        const relativeVelocityZ =
          Math.cos(npc.heading) * npc.speedMps - playerVelocityZ;
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

  inputFor(snapshot: LaneControllerSnapshot): SimulationInput {
    const nearest = closestProjectionOnPoints(
      this.route.points,
      snapshot.player,
      Math.max(0, this.progressM - 10),
      this.progressM + 35,
    );
    // Do not snap back to a parallel portion of a later loop just because it
    // happens to be geometrically close. A few metres of reverse tolerance
    // lets a legitimate braking/collision correction settle naturally.
    if (nearest.progressM >= this.progressM - 4) {
      this.progressM = Math.max(this.progressM, nearest.progressM);
    }
    // These routes include the tight South Kensington corner at the London
    // start. Keep the target only a short physical distance ahead so this is
    // a road-following drive, not a high-speed chord across a junction.
    const lookaheadM = clamp(5 + snapshot.player.speedMps * 0.4, 5, 10);
    const target = pointAtRouteDistance(this.route, this.progressM + lookaheadM);
    const desiredHeading = headingBetween(snapshot.player, target);
    const headingError = angleDifference(desiredHeading, snapshot.player.heading);
    const magnitude = Math.abs(headingError);
    const leadGapM = this.leadGapM(snapshot);
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
          : magnitude > 0.62
            ? 0.08
            : magnitude > 0.27
              ? 0.2
              : 0.42,
      brake: emergency.brake
        ? 1
        : leadBrake
          ? 0.85
          : magnitude > 0.78
            ? 0.6
            : 0,
      steer: recenterSteer,
      // This is input too: spawn visibility must see the direction a player
      // is actually looking while driving the same replay.
      viewHeading: snapshot.player.heading,
    };
  }

  get routeProgressM(): number {
    return this.progressM;
  }
}

const syntheticControllerSnapshot = (
  npc: {
    readonly x: number;
    readonly z: number;
    readonly heading: number;
    readonly speedMps: number;
    readonly laneId: string;
  },
  playerSpeedMps = 10,
): LaneControllerSnapshot => ({
    player: {
      x: 0,
      z: 0,
      heading: 0,
      speedMps: playerSpeedMps,
    },
    npcs: [{ id: "synthetic-npc", ...npc }],
  });

const mixHash = (hash: number, value: number): number =>
  Math.imul(hash ^ (value | 0), 16_777_619) >>> 0;

const mixString = (hash: number, value: string): number => {
  let result = hash;
  for (let index = 0; index < value.length; index += 1) {
    result = mixHash(result, value.charCodeAt(index));
  }
  return result;
};

function traceSnapshot(hash: number, snapshot: SimulationSnapshot): number {
  let result = mixHash(hash, snapshot.tick);
  result = mixHash(result, Math.round(snapshot.player.x * 10_000));
  result = mixHash(result, Math.round(snapshot.player.z * 10_000));
  result = mixHash(result, Math.round(snapshot.player.heading * 10_000));
  result = mixHash(result, snapshot.queuedNpcCount);
  result = mixString(result, snapshot.road.laneId ?? "off-road");
  for (const npc of snapshot.npcs) {
    result = mixString(result, npc.id);
    result = mixString(result, npc.laneId);
    result = mixHash(result, Math.round(npc.x * 1_000));
    result = mixHash(result, Math.round(npc.z * 1_000));
    result = mixHash(result, Math.round(npc.speedMps * 1_000));
  }
  return result;
}

function firstNpcOverlap(snapshot: SimulationSnapshot): string | null {
  for (let left = 0; left < snapshot.npcs.length; left += 1) {
    for (let right = left + 1; right < snapshot.npcs.length; right += 1) {
      const separation = distance(snapshot.npcs[left], snapshot.npcs[right]);
      if (separation + POSITION_TOLERANCE_M < NPC_NPC_CLEARANCE_M) {
        const describe = (npc: SimulationSnapshot["npcs"][number]) =>
          `${npc.id}{lane=${npc.laneId},x=${npc.x.toFixed(3)},z=${npc.z.toFixed(3)},heading=${npc.heading.toFixed(3)},speed=${npc.speedMps.toFixed(3)},state=${npc.state}}`;
        return `${describe(snapshot.npcs[left])}/${describe(snapshot.npcs[right])} at ${separation.toFixed(3)}m`;
      }
    }
  }
  return null;
}

function assertSnapshotSafety(
  label: string,
  snapshot: SimulationSnapshot,
  laneIds: ReadonlySet<string>,
): void {
  expect(snapshot.status, `${label}: core remains running`).toBe("running");
  expect(snapshot.road.laneId, `${label}: player stays on an authored lane`).not.toBeNull();
  expect(snapshot.road.offRoad, `${label}: player stays on the carriageway`).toBe(false);
  for (const npc of snapshot.npcs) {
    expect(laneIds.has(npc.laneId), `${label}: ${npc.id} uses an authored lane`).toBe(true);
    const separation = distance(snapshot.player, npc);
    expect(
      separation + POSITION_TOLERANCE_M,
      `${label}: ${npc.id} clears the player`,
    ).toBeGreaterThanOrEqual(PLAYER_NPC_CLEARANCE_M);
  }
  expect(firstNpcOverlap(snapshot), `${label}: NPC bodies do not overlap`).toBeNull();
}

function runRoute(
  label: string,
  config: SimulationCoreConfig,
  route: RoutePath,
  replayInputs?: readonly SimulationInput[],
): ReplayResult {
  const simulation = new SimulationCore(config);
  const controller = replayInputs ? null : new LaneCentreController(route);
  const inputs: SimulationInput[] = [];
  const laneIds = new Set((config.lanes ?? []).map((lane) => lane.id));
  const visitedRouteLaneIds = new Set<string>();
  let traceHash = 2_166_136_261;
  let localityDecisionCount = 0;
  try {
    let snapshot = simulation.getSnapshot();
    assertSnapshotSafety(`${label} tick 0`, snapshot, laneIds);
    traceHash = traceSnapshot(traceHash, snapshot);
    for (let tick = 0; tick < ROUTE_TICKS; tick += 1) {
      const input = replayInputs?.[tick] ?? controller!.inputFor(snapshot);
      inputs.push(input);
      snapshot = simulation.step(FIXED_STEP_SECONDS, input);
      traceHash = traceSnapshot(traceHash, snapshot);
      assertSnapshotSafety(`${label} tick ${snapshot.tick}`, snapshot, laneIds);
      if (snapshot.road.laneId && route.laneIds.includes(snapshot.road.laneId)) {
        visitedRouteLaneIds.add(snapshot.road.laneId);
      }
      const events = simulation.drainEvents();
      expect(
        events.filter((event) => event.code === "collision" || event.code === "wrong_way"),
        `${label} tick ${snapshot.tick}: no collision or wrong-way event`,
      ).toEqual([]);
      if ((tick + 1) % 6 !== 0) continue;
      localityDecisionCount += 1;
      const locality = simulation.getTrafficDiagnostics().locality;
      expect(
        locality.activeCount + locality.queuedCount,
        `${label} tick ${snapshot.tick}: locality conserves the pool`,
      ).toBe(locality.poolCount);
      expect(
        snapshot.npcs.length + snapshot.queuedNpcCount,
        `${label} tick ${snapshot.tick}: snapshot conserves the pool`,
      ).toBe(config.npcCount);
      expect(
        locality.lastDecisionPortalAttempts,
        `${label} tick ${snapshot.tick}: portal work is bounded`,
      ).toBeLessThanOrEqual(LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET);
      expect(
        locality.lastDecisionActivations,
        `${label} tick ${snapshot.tick}: activation work is bounded`,
      ).toBeLessThanOrEqual(LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET);
      expect(
        locality.lastDecisionRetirements,
        `${label} tick ${snapshot.tick}: retirement work is bounded`,
      ).toBeLessThanOrEqual(LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET);
    }
    return {
      inputs,
      traceHash,
      finalSnapshot: snapshot,
      playerRouteProgressM: controller?.routeProgressM ?? closestProjectionOnPoints(route.points, snapshot.player).progressM,
      playerTravelledM: snapshot.player.distanceTravelledM,
      visitedRouteLaneIds: [...visitedRouteLaneIds].sort(),
      localityDecisionCount,
    };
  } finally {
    simulation.dispose();
  }
}

describe("four-city tick-indexed moving traffic acceptance", () => {
  it("brakes for cross-lane collision paths without treating an opposing carriageway as a leader", () => {
    const route: RoutePath = {
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 100 },
      ],
      laneIds: ["route-forward"],
      lengthM: 100,
    };
    const crossingInput = new LaneCentreController(route).inputFor(
      syntheticControllerSnapshot({
        x: 8,
        z: 12,
        heading: -Math.PI / 2,
        speedMps: 8,
        laneId: "cross-lane",
      }),
    );
    expect(crossingInput.throttle, "predicted cross traffic cuts throttle").toBe(0);
    expect(crossingInput.brake, "predicted cross traffic emergency-brakes").toBe(1);

    const stoppedCrossingInput = new LaneCentreController(route).inputFor(
      syntheticControllerSnapshot({
        x: 1,
        z: 12,
        heading: -Math.PI / 2,
        speedMps: 0,
        laneId: "cross-lane",
      }),
    );
    expect(
      stoppedCrossingInput.brake,
      "a stopped cross-lane obstruction in the front capsule is respected",
    ).toBe(1);

    const opposingInput = new LaneCentreController(route).inputFor(
      syntheticControllerSnapshot({
        x: 3.3,
        z: 10,
        heading: Math.PI,
        speedMps: 8,
        laneId: "opposing-parallel",
      }),
    );
    expect(opposingInput.throttle, "a 3.3 m-offset opposing lane cannot freeze the route").toBe(
      0.42,
    );
    expect(opposingInput.brake).toBe(0);

    const driftedOpposingInput = new LaneCentreController(route).inputFor(
      syntheticControllerSnapshot({
        x: 2.2,
        z: 5,
        heading: Math.PI,
        speedMps: 0,
        laneId: "opposing-parallel",
      }, 0),
    );
    expect(
      driftedOpposingInput.throttle,
      "a low-speed opposing-lane drift uses a bounded recenter creep",
    ).toBe(OPPOSING_RECENTER_THROTTLE);
    expect(driftedOpposingInput.brake).toBe(0);
    expect(
      driftedOpposingInput.steer,
      "the recenter creep steers away from the opposing body",
    ).toBeLessThan(0);

    const sameRouteHeadOnInput = new LaneCentreController(route).inputFor(
      syntheticControllerSnapshot({
        x: 2.2,
        z: 5,
        heading: Math.PI,
        speedMps: 0,
        laneId: "route-forward",
      }),
    );
    expect(
      sameRouteHeadOnInput.brake,
      "the opposing exception never exempts a body on the chosen route",
    ).toBe(1);
  });

  it(
    "physically drives deterministic legal routes while keeping local traffic safe and bounded",
    () => {
      expect(FREE_DRIVES).toHaveLength(4);
      for (const freeDrive of FREE_DRIVES) {
        const country = getCountryProfile(freeDrive.countryId);
        const mapPack = getMapPack(freeDrive.mapId);
        const config = buildSimulationCoreConfig({
          scenario: buildFreeDriveScenario(freeDrive),
          mapPack,
          trafficSide: country.trafficSide,
          speedUnit: country.speedUnit,
        });
        const route = buildRoutePath(config);
        const first = runRoute(freeDrive.id, config, route);
        const replay = runRoute(freeDrive.id, config, route, first.inputs);

        expect(first.inputs, `${freeDrive.id}: one input is recorded for every fixed tick`).toHaveLength(
          ROUTE_TICKS,
        );
        expect(first.localityDecisionCount, `${freeDrive.id}: every 10 Hz locality pass ran`).toBe(
          ROUTE_TICKS / 6,
        );
        const nearbyFinalTraffic = first.finalSnapshot.npcs
          .filter(
            (npc) =>
              distance(npc, first.finalSnapshot.player) <= 35,
          )
          .map((npc) => ({
            id: npc.id,
            laneId: npc.laneId,
            state: npc.state,
            speedMps: Number(npc.speedMps.toFixed(2)),
            separationM: Number(
              distance(npc, first.finalSnapshot.player).toFixed(2),
            ),
          }));
        expect(
          first.playerTravelledM,
          `${freeDrive.id}: player actually drove; final lane=${String(first.finalSnapshot.road.laneId)} speed=${first.finalSnapshot.player.speedMps.toFixed(2)} nearby=${JSON.stringify(nearbyFinalTraffic)}`,
        ).toBeGreaterThan(75);
        expect(first.playerRouteProgressM, `${freeDrive.id}: route progress`).toBeGreaterThan(60);
        expect(
          first.visitedRouteLaneIds.length,
          `${freeDrive.id}: route reaches a legal successor corridor`,
        ).toBeGreaterThanOrEqual(2);
        expect(replay.traceHash, `${freeDrive.id}: fixed input replay is deterministic`).toBe(
          first.traceHash,
        );
        expect(replay.finalSnapshot).toEqual(first.finalSnapshot);
      }
    },
    120_000,
  );
});
