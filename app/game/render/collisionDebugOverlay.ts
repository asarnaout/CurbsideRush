/**
 * Debug-only wireframe overlay for static colliders and the player capsule,
 * off by default and toggled through `window.__sideswapCollisionOverlay` —
 * see `installDebugHooks` in `babylonGameSession.ts`. Draws the EXACT
 * pre-inflation obstacle shapes the simulation resolves against (not their
 * broad-phase reject bounds), one colour per `StaticObstacleTag`, so a QA
 * sweep can see precisely what a car will stop on. Never picked and never a
 * shadow caster — it is not registered with `registerStaticCell`/
 * `registerShadowCaster`, so it is invisible to both systems by construction.
 *
 * Per-obstacle source/ID annotation (which service furniture a box belongs
 * to, and so on) is deliberately not drawn as a 3D label here: it is already
 * exposed as data by `__sideswapCollisionDebug().nearbyObstacles`, which a
 * QA script cross-references against the visual overlay by position — a
 * second in-world label renderer would duplicate that for no gain.
 */
import { Color4, type LinesMesh, MeshBuilder, type Scene, Vector3 } from "@babylonjs/core";
import type { StaticObstacle, StaticObstacleTag } from "../types";

const OVERLAY_Y = 0.35;
const CIRCLE_SEGMENTS = 24;

const OVERLAY_COLORS: Record<StaticObstacleTag, Color4> = {
  building: new Color4(1, 0.35, 0.2, 1),
  landmark: new Color4(0.85, 0.1, 0.85, 1),
  venue: new Color4(0.15, 0.55, 1, 1),
  shoreline: new Color4(0.1, 0.85, 0.85, 1),
  parkEdge: new Color4(0.25, 0.85, 0.15, 1),
  railBridge: new Color4(0.45, 0.6, 0.95, 1),
  railShed: new Color4(0.65, 0.5, 0.9, 1),
  worldEdge: new Color4(1, 0.85, 0.1, 1),
};

const PLAYER_CAPSULE_COLOR = new Color4(1, 1, 1, 1);

function rectLoop(
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  halfU: number,
  halfV: number,
): Vector3[] {
  // V is the U axis rotated a quarter turn: (uz, -ux) — the same convention
  // `resolveStaticCollisions` uses, so an overlaid box matches the solver.
  const vx = uz;
  const vz = -ux;
  const corners: Array<readonly [number, number]> = [
    [halfU, halfV],
    [halfU, -halfV],
    [-halfU, -halfV],
    [-halfU, halfV],
  ];
  const loop = corners.map(
    ([u, v]) => new Vector3(cx + ux * u + vx * v, OVERLAY_Y, cz + uz * u + vz * v),
  );
  loop.push(loop[0]);
  return loop;
}

function circleLoop(cx: number, cz: number, radius: number): Vector3[] {
  const loop: Vector3[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    loop.push(new Vector3(cx + Math.cos(angle) * radius, OVERLAY_Y, cz + Math.sin(angle) * radius));
  }
  return loop;
}

function convexLoop(obstacle: Extract<StaticObstacle, { kind: "convex" }>): Vector3[] {
  const loop = obstacle.points.map((point) => new Vector3(point.x, OVERLAY_Y, point.z));
  loop.push(loop[0]);
  return loop;
}

function obstacleLoop(obstacle: StaticObstacle): Vector3[] {
  if (obstacle.kind === "circle") return circleLoop(obstacle.x, obstacle.z, obstacle.radius);
  if (obstacle.kind === "aabb") {
    return rectLoop(
      (obstacle.minX + obstacle.maxX) / 2,
      (obstacle.minZ + obstacle.maxZ) / 2,
      1,
      0,
      (obstacle.maxX - obstacle.minX) / 2,
      (obstacle.maxZ - obstacle.minZ) / 2,
    );
  }
  if (obstacle.kind === "obb") {
    const axisLength = Math.hypot(obstacle.ux, obstacle.uz) || 1;
    return rectLoop(
      obstacle.x,
      obstacle.z,
      obstacle.ux / axisLength,
      obstacle.uz / axisLength,
      obstacle.halfU,
      obstacle.halfV,
    );
  }
  return convexLoop(obstacle);
}

/** Builds one line-system mesh for every obstacle's exact outline, colour-coded
 * by `StaticObstacleTag`. One draw call regardless of obstacle count. Static
 * obstacles do not change mid-session, so this is built once per overlay
 * toggle-on rather than refreshed per frame. */
export function buildStaticObstacleOverlay(
  scene: Scene,
  obstacles: readonly StaticObstacle[],
): LinesMesh | null {
  if (!obstacles.length) return null;
  const lines: Vector3[][] = [];
  const colors: Color4[][] = [];
  for (const obstacle of obstacles) {
    const loop = obstacleLoop(obstacle);
    const color = OVERLAY_COLORS[obstacle.tag];
    lines.push(loop);
    colors.push(loop.map(() => color));
  }
  const mesh = MeshBuilder.CreateLineSystem(
    "collision-debug-obstacles",
    { lines, colors },
    scene,
  );
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

export interface PlayerCapsuleDebugShape {
  readonly frontX: number;
  readonly frontZ: number;
  readonly rearX: number;
  readonly rearZ: number;
  readonly radius: number;
}

/** Builds, or (given `instance`) updates in place, the two player-capsule
 * circles. Called every fixed step while the overlay is armed — `instance`
 * lets that reuse the existing vertex buffer instead of allocating a new
 * mesh 60 times a second. */
export function buildOrUpdatePlayerCapsuleOverlay(
  scene: Scene,
  capsule: PlayerCapsuleDebugShape,
  instance: LinesMesh | null,
): LinesMesh {
  const lines = [
    circleLoop(capsule.frontX, capsule.frontZ, capsule.radius),
    circleLoop(capsule.rearX, capsule.rearZ, capsule.radius),
  ];
  const colors = lines.map((loop) => loop.map(() => PLAYER_CAPSULE_COLOR));
  const mesh = MeshBuilder.CreateLineSystem(
    "collision-debug-capsule",
    instance ? { lines, colors, instance } : { lines, colors, updatable: true },
    scene,
  );
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

/** Squared distance from an obstacle's own centre (its OBB/AABB midpoint, or
 * its circle centre) to a world point — used only to rank
 * `__sideswapCollisionDebug().nearbyObstacles` by proximity. */
export function obstacleDistanceSquared(obstacle: StaticObstacle, x: number, z: number): number {
  let cx: number;
  let cz: number;
  if (obstacle.kind === "circle" || obstacle.kind === "obb") {
    cx = obstacle.x;
    cz = obstacle.z;
  } else if (obstacle.kind === "aabb") {
    cx = (obstacle.minX + obstacle.maxX) / 2;
    cz = (obstacle.minZ + obstacle.maxZ) / 2;
  } else {
    let sumX = 0;
    let sumZ = 0;
    for (const point of obstacle.points) {
      sumX += point.x;
      sumZ += point.z;
    }
    cx = sumX / obstacle.points.length;
    cz = sumZ / obstacle.points.length;
  }
  const dx = cx - x;
  const dz = cz - z;
  return dx * dx + dz * dz;
}
