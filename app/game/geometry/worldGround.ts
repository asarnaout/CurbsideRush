/**
 * The rendered paved-ground plane's world bounds — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 7.2 item 10.
 *
 * `WORLD_GROUND_MARGIN_M` was previously inlined into
 * `render/babylonGameSession.ts`'s scenario-ground sizing as the literal `36`
 * (18 m applied to each side of both axes). Moved here so the renderer and
 * the visual-gap audit consume the exact same constant/formula instead of
 * two copies that could drift — this module owns the constant; the renderer
 * imports it, it does not import the renderer (this file is under
 * `geometry/`, mechanically forbidden from importing Babylon/DOM).
 *
 * The ground mesh is centred on the world origin with no offset (matching
 * `docs/architecture.md`'s "origin = map centre"), so its bounds are simply
 * the world size inflated by the margin on every side.
 */

export const WORLD_GROUND_MARGIN_M = 18;

/** Babylon's `CreateGround` floor for a tiny world — matches the renderer's
 * own `Math.max(90, ...)` clamp so a Tokyo-sized map's ground never reports
 * narrower than what is actually drawn. */
const MIN_GROUND_DIMENSION_M = 90;

export interface WorldGroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The exact rendered ground-plane rectangle for a map of the given size.
 * `worldSize` is `mapPack.geometry.worldSize` (x = east-west extent, z =
 * north-south extent); reproduces
 * `groundWidth = max(90, worldSize.x + 2*WORLD_GROUND_MARGIN_M)` /
 * `groundHeight = max(90, worldSize.z + 2*WORLD_GROUND_MARGIN_M)`.
 */
export function resolveWorldGroundBounds(worldSize: {
  readonly x: number;
  readonly z: number;
}): WorldGroundBounds {
  const width = Math.max(MIN_GROUND_DIMENSION_M, worldSize.x + 2 * WORLD_GROUND_MARGIN_M);
  const height = Math.max(MIN_GROUND_DIMENSION_M, worldSize.z + 2 * WORLD_GROUND_MARGIN_M);
  return { minX: -width / 2, maxX: width / 2, minZ: -height / 2, maxZ: height / 2 };
}
