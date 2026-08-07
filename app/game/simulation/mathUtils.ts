/**
 * Pure scalar, angle, and 2D-point arithmetic shared by every simulation
 * seam (`roadNetwork.ts`, `playerDynamics.ts`, `trafficSystem.ts`,
 * `roadRuleMonitor.ts`) and by `simulation.ts` itself. No imports, by
 * design: this is the leaf of the dependency graph inside `simulation/`,
 * the same "pure module, zero imports" shape as `driveLayers.ts` or
 * `renderInterpolation.ts` outside it (see docs/architecture.md's "Pure
 * modules" table). Point-like parameters are typed structurally
 * (`{ x, z }`) rather than importing `SimulationPoint`, so this file has
 * nothing to import at all.
 *
 * Moved verbatim out of `simulation.ts` (issue #284) — every function body
 * here is byte-identical to its pre-split original.
 */

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function moveTowards(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

export function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

export function angleDifference(a: number, b: number): number {
  return wrapAngle(a - b);
}

export function lerpAngle(a: number, b: number, amount: number): number {
  return wrapAngle(a + angleDifference(b, a) * amount);
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const difference = angleDifference(target, current);
  if (Math.abs(difference) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(difference) * maxStep);
}

export function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function distanceSquared(
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distanceToSegmentSquared(
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
