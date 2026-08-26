import type { Gear, RuleCode, StaticObstacle, StaticObstacleTag, WorldPoint } from "../types";
import type { MutablePose, SimulationStatus, TurnSignal } from "../simulation";
import { angleDifference, clamp, moveTowards, wrapAngle } from "./mathUtils";

/**
 * Player physical driving state and its two movement systems: pedal/steer
 * integration (`movePlayer`) and static-world collision resolution
 * (`resolveStaticCollisions`, also called from `simulation.ts`'s own
 * `checkCollisions` after a player/NPC impact — see that call site's
 * comment for why `checkCollisions` itself stayed in the facade).
 *
 * Unlike `roadNetwork.ts` and (once split) `trafficSystem.ts`, this seam is
 * not a class owning private state: `PlayerPhysicsState` is a plain,
 * long-lived object `SimulationCore` holds as one field and passes by
 * reference into these functions, which mutate it in place — the same
 * shape `NpcInternal` and `RoadState` already use elsewhere in this
 * codebase. A class would not buy anything here, because the player's pose
 * and speed are read directly by more than a dozen call sites elsewhere in
 * `simulation.ts` (getSnapshot, checkCollisions, monitorRoadRules,
 * updateRoadState, ...) that have nothing to do with "moving the player" —
 * wrapping every one of those reads in a method would only add ceremony.
 *
 * Moved verbatim out of `simulation.ts` (issue #284) — every function body
 * is byte-identical to its pre-split original, `this.` renamed to operate
 * on the `state`/`config` parameters instead.
 */

// The static world resolves against a two-circle capsule rather than the
// single traffic disc: the visible car is ~4.4 m long, and one centre circle
// would let the bonnet bury itself a metre deep into a facade before contact.
export const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
export const PLAYER_CAPSULE_RADIUS_M = 1.0;
// Below this normal approach speed a wall contact is a silent scrape (still
// resolved, never penalised); above it a collision event is emitted.
const STATIC_IMPACT_EVENT_MIN_MPS = 2;
// Near-head-on contacts (approach direction mostly into the wall) rebound
// slightly instead of sliding: an arcade "bonk" that reads as a crash without
// ping-ponging the car around on touch controls. The three exported here are
// also reused verbatim by simulation.ts's own checkCollisions, for the same
// bonk recipe applied to a player/NPC impact instead of a static wall.
const STATIC_BONK_DOT = 0.72;
export const STATIC_BONK_MIN_MPS = 6;
export const STATIC_BONK_REBOUND_FRACTION = 0.08;
export const STATIC_BONK_REBOUND_MAX_MPS = 1.2;
// Scraping a wall bleeds speed at this per-second rate scaled by how head-on
// the contact is. The push-out already cancels the into-wall displacement, so
// a shallow graze keeps most of its pace while a 45° grind slows hard —
// applied per fixed step, it must stay a rate, never a flat factor.
const STATIC_SCRAPE_FRICTION_PER_S = 3.5;
export const PLAYER_RADIUS_METRES = 1.05;
/** Below this absolute speed the player is considered stopped — gear
 * switching, `canChangeGear`, and the opposed-pedal brake/reverse logic all
 * key off it. */
export const STOPPED_SPEED_MPS = 0.2;

/**
 * Behavior-neutral per-fixed-step instrumentation for the static-world
 * narrow phase (see docs/simulation-core.md). `SimulationCore` owns one
 * instance per session and zeroes it at the top of every `fixedUpdate`; both
 * `movePlayer` (the ordinary drive path) and the post-NPC-impact
 * `resolveStaticCollisions` re-entry accumulate into the same object, since
 * either — or both — can run within one fixed step. Counting never changes a
 * result, only observes it, and never allocates: every field is a plain
 * mutable number on an object the caller already owns.
 */
export interface StaticCollisionStepCounters {
  candidates: number;
  narrowTests: number;
  iterations: number;
}

interface StaticObstacleInternalBounds {
  readonly id: string;
  readonly tag: StaticObstacleTag;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  /** Broad-phase reject bounds, already inflated by the capsule reach so the
   * hot loop's first test is one rectangle compare. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** An AABB is just an axis-aligned OBB, so both normalize to this one shape:
 * centre plus explicit U/V axes. */
export interface StaticObstacleInternalBox extends StaticObstacleInternalBounds {
  readonly shape: "box";
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

export interface StaticObstacleInternalCircle extends StaticObstacleInternalBounds {
  readonly shape: "circle";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Closed convex polygon, vertices wound clockwise — see `StaticObstacle`'s
 * own "convex" variant. Normalized once here; the hot loop never re-checks
 * winding. */
export interface StaticObstacleInternalConvex extends StaticObstacleInternalBounds {
  readonly shape: "convex";
  readonly points: readonly WorldPoint[];
}

/**
 * A solid obstacle normalized for the 60 Hz narrow phase. A discriminated
 * union on `shape`, not a `radius > 0` sentinel (that stopped being an
 * adequate third-shape discriminator once a polygon needed representing
 * too): box, circle, and convex each carry only the fields their own narrow
 * phase needs.
 */
export type StaticObstacleInternal =
  | StaticObstacleInternalBox
  | StaticObstacleInternalCircle
  | StaticObstacleInternalConvex;

const STATIC_OBSTACLE_CORRECTIONS: Readonly<Record<StaticObstacleTag, string>> = {
  building: "Brake earlier and keep to the carriageway.",
  landmark: "Brake earlier and keep to the carriageway.",
  venue: "Brake earlier and keep to the carriageway.",
  shoreline: "Follow the carriageway onto an authored bridge.",
  parkEdge: "Enter the park through one of its gates.",
  roadBarrier: "Stay between the elevated-road barriers.",
  roadSupport: "Keep clear of the elevated-road supports.",
  railBridge: "Stay between the girders to cross.",
  railShed: "Keep off the railway depot.",
  worldEdge: "Turn back toward the streets.",
};

export function normalizeStaticObstacle(
  obstacle: StaticObstacle,
  inflateM: number,
): StaticObstacleInternal {
  const minElevationM = Number.isFinite(obstacle.minElevationM)
    ? (obstacle.minElevationM ?? Number.NEGATIVE_INFINITY)
    : Number.NEGATIVE_INFINITY;
  const requestedMaxElevationM = Number.isFinite(obstacle.maxElevationM)
    ? Math.max(0, obstacle.maxElevationM ?? 0)
    : Number.POSITIVE_INFINITY;
  const maxElevationM = Math.max(minElevationM, requestedMaxElevationM);
  if (obstacle.kind === "circle") {
    return {
      shape: "circle",
      id: obstacle.id,
      tag: obstacle.tag,
      minElevationM,
      maxElevationM,
      x: obstacle.x,
      z: obstacle.z,
      radius: Math.max(0, obstacle.radius),
      minX: obstacle.x - obstacle.radius - inflateM,
      maxX: obstacle.x + obstacle.radius + inflateM,
      minZ: obstacle.z - obstacle.radius - inflateM,
      maxZ: obstacle.z + obstacle.radius + inflateM,
    };
  }
  if (obstacle.kind === "aabb") {
    return {
      shape: "box",
      id: obstacle.id,
      tag: obstacle.tag,
      minElevationM,
      maxElevationM,
      x: (obstacle.minX + obstacle.maxX) / 2,
      z: (obstacle.minZ + obstacle.maxZ) / 2,
      ux: 1,
      uz: 0,
      halfU: Math.max(0, (obstacle.maxX - obstacle.minX) / 2),
      halfV: Math.max(0, (obstacle.maxZ - obstacle.minZ) / 2),
      minX: obstacle.minX - inflateM,
      maxX: obstacle.maxX + inflateM,
      minZ: obstacle.minZ - inflateM,
      maxZ: obstacle.maxZ + inflateM,
    };
  }
  if (obstacle.kind === "obb") {
    const axisLength = Math.hypot(obstacle.ux, obstacle.uz) || 1;
    const ux = obstacle.ux / axisLength;
    const uz = obstacle.uz / axisLength;
    const reach = Math.abs(ux) * obstacle.halfU + Math.abs(uz) * obstacle.halfV;
    const reachZ = Math.abs(uz) * obstacle.halfU + Math.abs(ux) * obstacle.halfV;
    return {
      shape: "box",
      id: obstacle.id,
      tag: obstacle.tag,
      minElevationM,
      maxElevationM,
      x: obstacle.x,
      z: obstacle.z,
      ux,
      uz,
      halfU: Math.max(0, obstacle.halfU),
      halfV: Math.max(0, obstacle.halfV),
      minX: obstacle.x - reach - inflateM,
      maxX: obstacle.x + reach + inflateM,
      minZ: obstacle.z - reachZ - inflateM,
      maxZ: obstacle.z + reachZ + inflateM,
    };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of obstacle.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return {
    shape: "convex",
    id: obstacle.id,
    tag: obstacle.tag,
    minElevationM,
    maxElevationM,
    points: obstacle.points,
    minX: minX - inflateM,
    maxX: maxX + inflateM,
    minZ: minZ - inflateM,
    maxZ: maxZ + inflateM,
  };
}

/**
 * Circle-endpoint versus convex-polygon penetration, for one capsule end
 * circle against one already-normalized (clockwise-wound) polygon.
 *
 * Outside: nearest point on the boundary; normal points from there to the
 * query point (the same "push away from the nearest surface point"
 * convention the box's own outside case uses).
 *
 * Inside: for a clockwise polygon in this codebase's (x right, z "up") world
 * convention, the interior lies to the right of every directed edge, so a
 * point is outside edge a->b iff the 2D cross product
 * `ex*(qz-az) - ez*(qx-ax)` is positive (verified against a concrete
 * clockwise square: centre (0,0) against edge (1,0)->(0,-1) gives a negative
 * cross, confirming negative = interior). When every edge's cross is
 * negative or zero, the query point is inside; the exit is the shallowest
 * edge (least distance to that edge's own line) and its outward normal
 * `(-ez, ex)/|e|` — the polygon generalization of the box's "exit along the
 * shallower face". Penetration equals that shallow distance plus the
 * capsule radius, exactly mirroring the box inside case's
 * `insideU + playerCapsuleRadiusM`.
 */
function convexEndpointPenetration(
  points: readonly WorldPoint[],
  cx: number,
  cz: number,
  radius: number,
  fallbackNx: number,
  fallbackNz: number,
): { readonly penetration: number; readonly nx: number; readonly nz: number } {
  let inside = true;
  let shallowestDepth = Number.POSITIVE_INFINITY;
  let shallowestNx = 0;
  let shallowestNz = 0;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  let nearestX = 0;
  let nearestZ = 0;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const edgeLength = Math.hypot(ex, ez) || 1;
    const cross = ex * (cz - a.z) - ez * (cx - a.x);
    if (cross > 0) {
      inside = false;
    } else {
      const depth = -cross / edgeLength;
      if (depth < shallowestDepth) {
        shallowestDepth = depth;
        shallowestNx = -ez / edgeLength;
        shallowestNz = ex / edgeLength;
      }
    }
    const edgeLengthSq = ex * ex + ez * ez;
    const t =
      edgeLengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((cx - a.x) * ex + (cz - a.z) * ez) / edgeLengthSq))
        : 0;
    const nearX = a.x + ex * t;
    const nearZ = a.z + ez * t;
    const dx = cx - nearX;
    const dz = cz - nearZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestX = nearX;
      nearestZ = nearZ;
    }
  }
  if (inside) {
    return { penetration: shallowestDepth + radius, nx: shallowestNx, nz: shallowestNz };
  }
  const distance = Math.sqrt(nearestDistSq);
  if (distance > 1e-6) {
    return {
      penetration: radius - distance,
      nx: (cx - nearestX) / distance,
      nz: (cz - nearestZ) / distance,
    };
  }
  return { penetration: radius, nx: fallbackNx, nz: fallbackNz };
}

/** The player's physical driving state: pose, speed, gear, signal, and the
 * two accumulators (signal auto-cancel, instability) `movePlayer` owns.
 * `SimulationCore` holds one of these as a field and never reassigns it —
 * only its properties change — so it is also safe for any future reader to
 * capture a reference to at construction time. */
export interface PlayerPhysicsState {
  player: MutablePose;
  signedSpeedMps: number;
  gear: Gear;
  signal: TurnSignal;
  signalStartHeading: number;
  signalAutoCancelSeconds: number;
  distanceTravelledM: number;
  unstableControlSeconds: number;
}

/** Exactly the `InternalConfig` fields player-dynamics math reads. Passing
 * `SimulationCore`'s full config where this is asked for is fine —
 * TypeScript's structural typing accepts the wider object. */
export interface PlayerDynamicsConfig {
  readonly brakeBaseMps2: number;
  readonly brakeStrengthMps2: number;
  readonly forwardAccelMps2: number;
  readonly reverseAccelMps2: number;
  readonly dragBaseMps2: number;
  readonly dragPerMps: number;
  readonly maxReverseSpeedMps: number;
  readonly maxForwardSpeedMps: number;
  readonly steerAuthoritySpeedMps: number;
  readonly steerBaseRate: number;
  readonly steerAuthorityRate: number;
  readonly instabilityLateralMps2: number;
  readonly playerCapsuleHalfLengthM: number;
  readonly playerCapsuleRadiusM: number;
}

// Return type is `unknown`, not `void`: this seam's two call sites (movePlayer,
// resolveStaticCollisions) never look at the result, but roadRuleMonitor.ts's
// monitorPassingLane needs to know whether the event actually fired (emitEvent
// returns null when a cooldown swallows it) before honking — `unknown` (unlike
// `void`) still supports a truthiness check, and the real SimulationCore.emitEvent
// (returning SimulationRuleEvent | null) satisfies either.
export type EmitEventFn = (details: {
  code: RuleCode;
  correction: string;
  evidence: Record<string, string | number | boolean>;
}) => unknown;

/** Same three-line body as `SimulationCore.setSignal` used to be — shared
 * so the discrete-input path (turn-signal lever) and `movePlayer`'s own
 * auto-cancel-to-"off" path can never drift apart. */
export function setPlayerSignal(state: PlayerPhysicsState, signal: TurnSignal): void {
  state.signal = signal;
  state.signalStartHeading = state.player.heading;
  state.signalAutoCancelSeconds = 0;
}

export function movePlayer(
  state: PlayerPhysicsState,
  deltaSeconds: number,
  input: { readonly throttle: number; readonly brake: number; readonly reverse: number; readonly steer: number },
  config: PlayerDynamicsConfig,
  staticObstacles: readonly StaticObstacleInternal[],
  status: SimulationStatus,
  emitEvent: EmitEventFn,
  counters: StaticCollisionStepCounters,
): void {
  const forward = input.throttle;
  const backward = input.reverse;
  const speed = state.signedSpeedMps;

  // Each pedal states a direction the driver wants to travel. Pressed against
  // the way the car is already rolling it is a brake; once the car has come to
  // rest the same pedal pulls away that way. So holding the reverse pedal
  // brings the car to a stop and then backs it up, with no gear to select —
  // and the brake pedal proper still only ever slows the car down.
  const opposed =
    (speed > STOPPED_SPEED_MPS ? backward : 0) + (speed < -STOPPED_SPEED_MPS ? forward : 0);
  const brake = Math.max(input.brake, Math.min(1, opposed));
  const drive =
    speed > STOPPED_SPEED_MPS
      ? forward
      : speed < -STOPPED_SPEED_MPS
        ? -backward
        : forward - backward;

  if (brake > 0) {
    state.signedSpeedMps = moveTowards(
      state.signedSpeedMps,
      0,
      (config.brakeBaseMps2 + brake * config.brakeStrengthMps2) * deltaSeconds,
    );
  } else {
    const acceleration = drive >= 0 ? config.forwardAccelMps2 : config.reverseAccelMps2;
    state.signedSpeedMps += drive * acceleration * deltaSeconds;
    const drag = config.dragBaseMps2 + Math.abs(state.signedSpeedMps) * config.dragPerMps;
    state.signedSpeedMps = moveTowards(state.signedSpeedMps, 0, drag * deltaSeconds);
  }

  state.signedSpeedMps = clamp(state.signedSpeedMps, -config.maxReverseSpeedMps, config.maxForwardSpeedMps);
  if (Math.abs(state.signedSpeedMps) < 0.015 && drive === 0) {
    state.signedSpeedMps = 0;
  }
  // The gear is now a readout of which way the car is actually travelling
  // rather than something the driver selects. It latches, so a car rolling to
  // a halt keeps reading R until it next pulls away forwards.
  if (state.signedSpeedMps > STOPPED_SPEED_MPS) state.gear = "drive";
  else if (state.signedSpeedMps < -STOPPED_SPEED_MPS) state.gear = "reverse";

  const absoluteSpeed = Math.abs(state.signedSpeedMps);
  if (absoluteSpeed > 0.04) {
    const steeringAuthority = Math.min(1, absoluteSpeed / config.steerAuthoritySpeedMps);
    const reverseSteering = state.signedSpeedMps < 0 ? -1 : 1;
    state.player.heading = wrapAngle(
      state.player.heading +
        input.steer *
          reverseSteering *
          (config.steerBaseRate + steeringAuthority * config.steerAuthorityRate) *
          deltaSeconds,
    );
  }
  const travelled = state.signedSpeedMps * deltaSeconds;
  state.player.x += Math.sin(state.player.heading) * travelled;
  state.player.z += Math.cos(state.player.heading) * travelled;
  state.distanceTravelledM += Math.abs(travelled);
  resolveStaticCollisions(state, config, staticObstacles, true, status, emitEvent, deltaSeconds, counters);

  const lateralAcceleration = (Math.abs(input.steer) * absoluteSpeed * absoluteSpeed) / 3.1;
  if (lateralAcceleration > config.instabilityLateralMps2) {
    state.unstableControlSeconds += deltaSeconds;
    state.signedSpeedMps *= 1 - 0.12 * deltaSeconds;
  } else {
    state.unstableControlSeconds = Math.max(0, state.unstableControlSeconds - deltaSeconds * 2);
  }
  if (state.unstableControlSeconds >= 0.7) {
    emitEvent({
      code: "observation",
      correction: "Ease off the accelerator before making a strong steering input.",
      evidence: { lateralAccelerationMps2: Math.round(lateralAcceleration * 10) / 10 },
    });
    state.unstableControlSeconds = 0;
  }

  if (state.signal !== "off") {
    if (Math.abs(angleDifference(state.player.heading, state.signalStartHeading)) > 0.48) {
      state.signalAutoCancelSeconds = Math.max(state.signalAutoCancelSeconds, 1.1);
    }
    if (state.signalAutoCancelSeconds > 0) {
      state.signalAutoCancelSeconds -= deltaSeconds;
      if (state.signalAutoCancelSeconds <= 0) setPlayerSignal(state, "off");
    }
  }
}

/**
 * Keeps the player car out of the solid world: the car is a two-circle
 * capsule along its heading, each obstacle a box, circle, or convex polygon
 * (a bespoke landmark's exact ground footprint), and a contact pushes the
 * car out along the contact normal. The velocity response is the
 * arcade wall recipe — a grazing contact slides (tangential speed kept,
 * lightly scrubbed), a near-head-on contact stops with a small rebound — so
 * scraping a facade slows the car until it steers parallel rather than
 * pin-balling it. Emits at most one collision rule event per contact burst;
 * `allowEvents` lets the NPC crash path re-resolve without double-reporting.
 * Allocation-free: everything below is scalar arithmetic on locals.
 *
 * `fixedStepSeconds` is threaded in rather than read off a module constant:
 * `simulation.ts`'s own `checkCollisions` also calls this (after a
 * player/NPC impact, so the shove cannot bury the player in a facade) with
 * no `deltaSeconds` of its own in scope, and always passes the facade's
 * `FIXED_STEP_SECONDS` — identical in every real call path to `movePlayer`
 * passing its own `deltaSeconds` through, since `movePlayer` is itself only
 * ever invoked with the fixed step.
 */
export function resolveStaticCollisions(
  state: PlayerPhysicsState,
  config: PlayerDynamicsConfig,
  staticObstacles: readonly StaticObstacleInternal[],
  allowEvents: boolean,
  status: SimulationStatus,
  emitEvent: EmitEventFn,
  fixedStepSeconds: number,
  counters: StaticCollisionStepCounters,
): void {
  if (!staticObstacles.length) return;
  const forwardX = Math.sin(state.player.heading);
  const forwardZ = Math.cos(state.player.heading);
  let maxApproachMps = 0;
  let hitTag: StaticObstacleTag | null = null;
  let hitId = "";

  for (let iteration = 0; iteration < 3; iteration += 1) {
    counters.iterations += 1;
    let deepest = 0;
    let normalX = 0;
    let normalZ = 0;
    const px = state.player.x;
    const pz = state.player.z;
    const playerElevationM = state.player.elevationM ?? 0;
    for (const obstacle of staticObstacles) {
      if (
        playerElevationM < obstacle.minElevationM ||
        playerElevationM > obstacle.maxElevationM
      ) {
        continue;
      }
      if (px < obstacle.minX || px > obstacle.maxX || pz < obstacle.minZ || pz > obstacle.maxZ) {
        continue;
      }
      counters.candidates += 1;
      for (let end = -1; end <= 1; end += 2) {
        counters.narrowTests += 1;
        const cx = px + forwardX * config.playerCapsuleHalfLengthM * end;
        const cz = pz + forwardZ * config.playerCapsuleHalfLengthM * end;
        let penetration: number;
        let nx: number;
        let nz: number;
        if (obstacle.shape === "circle") {
          const dx = cx - obstacle.x;
          const dz = cz - obstacle.z;
          const distance = Math.hypot(dx, dz);
          penetration = obstacle.radius + config.playerCapsuleRadiusM - distance;
          if (penetration <= deepest) continue;
          if (distance > 1e-6) {
            nx = dx / distance;
            nz = dz / distance;
          } else {
            nx = forwardX;
            nz = forwardZ;
          }
        } else if (obstacle.shape === "box") {
          const dx = cx - obstacle.x;
          const dz = cz - obstacle.z;
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
              penetration = insideU + config.playerCapsuleRadiusM;
            } else {
              const sign = dv >= 0 ? 1 : -1;
              nx = obstacle.uz * sign;
              nz = -obstacle.ux * sign;
              penetration = insideV + config.playerCapsuleRadiusM;
            }
          } else {
            const qu = Math.max(-obstacle.halfU, Math.min(obstacle.halfU, du));
            const qv = Math.max(-obstacle.halfV, Math.min(obstacle.halfV, dv));
            const gapX = dx - (obstacle.ux * qu + obstacle.uz * qv);
            const gapZ = dz - (obstacle.uz * qu - obstacle.ux * qv);
            const distance = Math.hypot(gapX, gapZ);
            penetration = config.playerCapsuleRadiusM - distance;
            if (penetration <= deepest) continue;
            if (distance > 1e-6) {
              nx = gapX / distance;
              nz = gapZ / distance;
            } else {
              nx = forwardX;
              nz = forwardZ;
            }
          }
        } else {
          const result = convexEndpointPenetration(
            obstacle.points,
            cx,
            cz,
            config.playerCapsuleRadiusM,
            forwardX,
            forwardZ,
          );
          if (result.penetration <= deepest) continue;
          penetration = result.penetration;
          nx = result.nx;
          nz = result.nz;
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

    state.player.x += normalX * deepest;
    state.player.z += normalZ * deepest;
    const travelSign = state.signedSpeedMps >= 0 ? 1 : -1;
    const directionDot = (forwardX * normalX + forwardZ * normalZ) * travelSign;
    if (directionDot < 0) {
      const approachMps = -directionDot * Math.abs(state.signedSpeedMps);
      maxApproachMps = Math.max(maxApproachMps, approachMps);
      if (-directionDot >= STATIC_BONK_DOT) {
        state.signedSpeedMps =
          approachMps >= STATIC_BONK_MIN_MPS
            ? -travelSign *
              Math.min(STATIC_BONK_REBOUND_MAX_MPS, approachMps * STATIC_BONK_REBOUND_FRACTION)
            : // Pressing head-on below bonk speed: the wall wins outright.
              state.signedSpeedMps * (1 + directionDot);
      } else {
        state.signedSpeedMps *= Math.max(
          0,
          1 + STATIC_SCRAPE_FRICTION_PER_S * directionDot * fixedStepSeconds,
        );
      }
    }
  }

  if (allowEvents && hitTag && maxApproachMps >= STATIC_IMPACT_EVENT_MIN_MPS && status === "running") {
    emitEvent({
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
