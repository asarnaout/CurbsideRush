/**
 * Fixed-step render interpolation.
 *
 * The simulation advances in exact 1/60s steps while frames render whenever
 * the display asks (120 Hz ProMotion runs two frames per sim step). Drawing
 * entities at their latest sim pose makes them visibly hop on every step —
 * the faster the entity, the bigger the hop. The cure is standard: keep each
 * entity's previous and current sim pose and draw the blend
 * `previous + (current - previous) * alpha`, where alpha is the fixed-step
 * accumulator's leftover fraction. The rendered world runs one sim step
 * (16.7ms) behind the simulation, in exchange for every frame landing exactly
 * on the motion path.
 *
 * Pure math, no Babylon imports, so tests can run it in node. Callers own
 * alpha's range ([0, 1]; pass 1 to draw the current pose exactly).
 */

/**
 * A prev→current gap wider than this is a teleport (tow reset, cutscene
 * repose, NPC slot reuse), not motion — interpolating across it would streak
 * the entity through the map for a frame. The fastest legal mover covers
 * ~0.53m per step (70 mph), so 2.5m is unreachable by driving.
 */
export const POSE_SNAP_STEP_M = 2.5;

export function lerpValue(
  previous: number,
  current: number,
  alpha: number,
): number {
  return previous + (current - previous) * alpha;
}

/** Normalizes an angle delta to (-π, π] so blends take the shortest arc. */
export function wrapAngleRad(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped <= -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

export function lerpHeading(
  previous: number,
  current: number,
  alpha: number,
): number {
  return previous + wrapAngleRad(current - previous) * alpha;
}

export function shouldSnapPose(
  previousX: number,
  previousZ: number,
  x: number,
  z: number,
  maxStepM: number,
  previousElevationM = 0,
  elevationM = 0,
): boolean {
  const dx = x - previousX;
  const dz = z - previousZ;
  const dy = elevationM - previousElevationM;
  return dx * dx + dy * dy + dz * dz > maxStepM * maxStepM;
}
