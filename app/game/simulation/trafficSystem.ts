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
import type { LaneProjection, NormalizedLane, RoadNetwork } from "./roadNetwork";

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
}

export interface NpcInternal extends MutablePose {
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
  };
  readonly elapsedSeconds: number;
  readonly tick: number;
}

export interface TrafficSystemConfig {
  readonly playerRadiusM: number;
  readonly minRuntimeSpawnDistanceM: number;
}

export class TrafficSystem {
  private readonly roadNetwork: RoadNetwork;
  private readonly playerState: PlayerPhysicsState;
  private readonly config: TrafficSystemConfig;
  private readonly trafficGates: NormalizedTrafficGate[];
  /** Memo for parsedNpcDigits; NPC ids are stable within a session. */
  private readonly npcDigitCache = new Map<string, number>();
  private random: SeededRandom;
  private npcsList: NpcInternal[] = [];

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
    this.npcDigitCache.clear();
  }

  /** Matches the pre-split `this.npcs = []` inside `SimulationCore.dispose()`. */
  dispose(): void {
    this.npcsList = [];
  }

  deactivateNpc(npc: NpcInternal): void {
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
      this.npcsList.push(npc);
      const gate = this.findSafeTrafficGate(npc, true, ctx);
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
    ctx: TrafficTickCtx,
  ): NormalizedTrafficGate | null {
    for (const gate of this.candidateTrafficGates(npc)) {
      if (initial && !gate.allowInitialSpawn) continue;
      if (this.isTrafficGateSafe(npc, gate, initial, ctx)) return gate;
    }
    return null;
  }

  private isTrafficGateSafe(
    npc: NpcInternal,
    gate: NormalizedTrafficGate,
    initial: boolean,
    ctx: TrafficTickCtx,
  ): boolean {
    const lane = this.roadNetwork.lanesById.get(gate.laneId);
    if (!lane) return false;
    const pose = this.roadNetwork.pointOnLane(lane, gate.distance);
    const desiredSpeedMps = gate.desiredSpeedMps ?? npc.desiredSpeedMps;
    const playerDistanceM = Math.sqrt(distanceSquared(pose, this.playerState.player));
    if (playerDistanceM < INITIAL_CROSS_LANE_CLEARANCE_M) return false;
    if (!initial && playerDistanceM < this.config.minRuntimeSpawnDistanceM) return false;
    if (!initial && this.isInsidePlayerVisibilityEnvelope(pose, ctx)) return false;

    const playerProjection = this.roadNetwork.projectToRoad(
      this.playerState.player.x,
      this.playerState.player.z,
    );
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
      if (other.laneId !== lane.id && distanceSquared(other, pose) < 12 * 12) {
        return false;
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
    npc.activatedAtSeconds = initial ? Number.NEGATIVE_INFINITY : ctx.elapsedSeconds;
  }

  private activateQueuedNpcs(ctx: TrafficTickCtx): void {
    for (const npc of this.npcsList) {
      if (npc.active) continue;
      const gate = this.findSafeTrafficGate(npc, false, ctx);
      if (gate) this.activateNpcAtGate(npc, gate, ctx);
    }
  }

  makeTrafficDecisions(ctx: TrafficTickCtx): void {
    this.activateQueuedNpcs(ctx);
    for (const npc of this.npcsList) {
      if (!npc.active) continue;
      // A struck car makes no decisions while it sits knocked; moveNpcs owns
      // the hold and the release.
      if (ctx.tick < npc.struckUntilTick) continue;
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
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
    if (npc.distance >= exitStart) {
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
      if (!sourceLane) continue;
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
        } else {
          const spatialSafetyTick =
            ctx.tick % Math.round(TRAFFIC_DECISION_SECONDS / deltaSeconds) === 0;
          if (spatialSafetyTick && !this.isNpcTravelSpatiallyClear(npc, lookAheadTravel)) {
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

      const activeSourceLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!activeSourceLane) continue;
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
        this.deactivateNpc(npc);
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
  private advanceNpcAlongLegalRoute(
    npc: NpcInternal,
    distanceDelta: number,
    deltaSeconds: number,
  ): boolean {
    let remaining = Math.max(0, distanceDelta);
    let transitions = 0;
    while (remaining > 0 && transitions <= this.roadNetwork.lanes.length) {
      const lane = this.roadNetwork.lanesById.get(npc.laneId);
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
      if (!nextLane || !this.roadNetwork.areLaneEndpointsContinuous(lane, nextLane)) {
        npc.distance = lane.length;
        const endPose = this.roadNetwork.pointOnLane(lane, lane.length);
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
          this.roadNetwork.pointOnLane(lane, npc.distance),
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
    if (transitions > this.roadNetwork.lanes.length) {
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
    const sourceDistance = Math.min(sourceLane.length, npc.distance + Math.max(0, travel));
    const sourcePose = this.roadNetwork.pointOnLane(sourceLane, sourceDistance);
    if (npc.state !== "lane-changing" || !npc.targetLaneId) {
      return sourcePose;
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

  private nextLaneForNpc(npc: NpcInternal, lane: NormalizedLane): NormalizedLane | null {
    if (lane.successorLaneIds.length) {
      const numericId = this.parsedNpcDigits(npc.id) || 1;
      const index = (npc.transitionCount + numericId - 1) % lane.successorLaneIds.length;
      return this.roadNetwork.lanesById.get(lane.successorLaneIds[index]) ?? null;
    }
    return lane.loop ? lane : null;
  }

  private isNpcLaneEntryClear(npc: NpcInternal, target: NormalizedLane): boolean {
    const targetStart = this.roadNetwork.pointOnLane(target, 0);
    const minimumEntryHeadwayM = NPC_FOLLOW_STANDSTILL_GAP_M + 4;
    for (const other of this.npcsList) {
      if (!other.active || other.id === npc.id) continue;
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
        return false;
      }
    }
    return (
      distanceSquared(this.playerState.player, targetStart) >=
      (this.config.playerRadiusM + NPC_RADIUS_METRES + 4) ** 2
    );
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
    for (const npc of this.npcsList) {
      if (!npc.active || npc.id === excludedNpcId) continue;
      const npcLane = this.roadNetwork.lanesById.get(npc.laneId);
      if (!npcLane) continue;
      const gap = this.roadNetwork.routeDistanceAhead(lane, distance, npcLane, npc.distance);
      if (gap > 0.1 && gap < best) best = gap;
    }
    const playerProjection = ctx.roadState.projection;
    if (excludedNpcId && playerProjection && playerProjection.distance < playerProjection.lane.width) {
      const playerGap = this.roadNetwork.routeDistanceAhead(
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
      const gap = this.roadNetwork.routeDistanceAhead(npcLane, npc.distance, lane, playerDistance);
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
      if (!this.isTrafficGateSafe(npc, gate, true, ctx)) this.deactivateNpc(npc);
    }
    this.makeTrafficDecisions(ctx);
  }
}
