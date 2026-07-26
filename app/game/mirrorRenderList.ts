/**
 * Choosing what a mirror draws.
 *
 * A mirror in this game is a `RenderTargetTexture`, and Babylon's
 * `ObjectRenderer` — which is what actually walks an RTT's render list — does
 * **no frustum culling of its own**. There is not one `isInFrustum` call in it.
 * Whatever list it is handed is dispatched whole. And handing it nothing is
 * worse than it looks: with `renderList === null` it falls back to
 * `scene.getActiveMeshes()`, the set culled for the *main* camera, which for a
 * rearward mirror is precisely the wrong half of the world. It fails silently,
 * and a mirror showing the wrong half of the world looks plausible at a glance.
 *
 * So the caller culls. This module is the cheap, amortised first pass of that:
 * given the mirror's eye and facing, decide which cells of the scene's spatial
 * hash could possibly contain something the mirror can see. The caller then
 * frustum-tests only what those cells hold — a couple of hundred meshes rather
 * than the fifteen thousand in the scene.
 *
 * Deliberately conservative: a cell that might be visible is kept. A false
 * positive costs one frustum test; a false negative is a hole in the mirror.
 *
 * No Babylon import here, and none may be added — the point is that
 * `tests/mirrorRenderList.test.ts` can check the cull without an engine.
 */

export interface MirrorCullView {
  /** Mirror eye, in world metres. */
  readonly x: number;
  readonly z: number;
  /** Unit vector the mirror looks along, in the xz plane. */
  readonly dirX: number;
  readonly dirZ: number;
  /**
   * Half the mirror's horizontal field of view, widened by a margin. Widening
   * is not optional: a mesh whose origin sits outside the cone can still have
   * geometry inside it, and the cheapest correct answer is to be generous here
   * and let the frustum test downstream be exact.
   */
  readonly halfAngleRad: number;
  /** How far back the mirror bothers to look. */
  readonly radiusM: number;
}

/** Integer cell coordinates in the scene's spatial hash. */
export interface MirrorCell {
  readonly cellX: number;
  readonly cellZ: number;
}

/**
 * Whether a square cell could hold anything inside the mirror's cone.
 *
 * Tests the cell's four corners and its centre, plus the case where the eye is
 * inside the cell at all — which the corner test alone misses, and which is the
 * one cell guaranteed to matter.
 */
export function cellIntersectsMirrorCone(
  cellX: number,
  cellZ: number,
  cellSizeM: number,
  view: MirrorCullView,
): boolean {
  const minX = cellX * cellSizeM;
  const minZ = cellZ * cellSizeM;
  const maxX = minX + cellSizeM;
  const maxZ = minZ + cellSizeM;

  if (view.x >= minX && view.x <= maxX && view.z >= minZ && view.z <= maxZ) {
    return true;
  }

  const cosLimit = Math.cos(Math.min(Math.PI, view.halfAngleRad));
  const radiusSquared = view.radiusM * view.radiusM;
  const half = cellSizeM / 2;
  const points = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
    [minX + half, minZ + half],
  ];

  for (const [pointX, pointZ] of points) {
    const toX = pointX - view.x;
    const toZ = pointZ - view.z;
    const distanceSquared = toX * toX + toZ * toZ;
    if (distanceSquared > radiusSquared) continue;
    if (distanceSquared === 0) return true;
    const distance = Math.sqrt(distanceSquared);
    if ((toX * view.dirX + toZ * view.dirZ) / distance >= cosLimit) return true;
  }
  return false;
}

/**
 * Every cell worth gathering for this mirror.
 *
 * Walks the bounding square of the view radius and keeps the cells whose cone
 * test passes. At a 45 m cell and an 80 m radius that is at most a 5x5 sweep,
 * so this is cheap enough to run whenever the player has moved — but it is not
 * free, and it is not meant to run every frame.
 */
export function mirrorCells(
  cellSizeM: number,
  view: MirrorCullView,
): MirrorCell[] {
  const cells: MirrorCell[] = [];
  const minCellX = Math.floor((view.x - view.radiusM) / cellSizeM);
  const maxCellX = Math.floor((view.x + view.radiusM) / cellSizeM);
  const minCellZ = Math.floor((view.z - view.radiusM) / cellSizeM);
  const maxCellZ = Math.floor((view.z + view.radiusM) / cellSizeM);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      if (cellIntersectsMirrorCone(cellX, cellZ, cellSizeM, view)) {
        cells.push({ cellX, cellZ });
      }
    }
  }
  return cells;
}

/**
 * How far the player may travel before a gathered candidate set is stale.
 *
 * The list is rebuilt on movement rather than on a clock, for the same reason
 * the shadow caster ring is: standing still is the common case at a red light,
 * and re-gathering then is pure waste.
 */
export const MIRROR_REGATHER_M = 12;

/** How far back a mirror looks. Well inside the fog band, so nothing pops. */
export const MIRROR_RADIUS_M = 80;

export function mirrorCandidatesAreStale(
  gatheredAtX: number,
  gatheredAtZ: number,
  x: number,
  z: number,
  headingChangeRad: number,
): boolean {
  if (Math.hypot(x - gatheredAtX, z - gatheredAtZ) >= MIRROR_REGATHER_M) {
    return true;
  }
  // A car can turn on the spot at a junction without covering any ground, and
  // that swings the mirror's cone across a completely different set of cells.
  return Math.abs(headingChangeRad) >= 0.35;
}
