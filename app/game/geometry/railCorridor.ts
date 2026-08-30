import type { GameCanvasPoint } from "../sessionContract";
import type { ProceduralBlock, RailLine } from "../types";

/**
 * The rail right-of-way as a *build keep-out*: blocks are carved around it at
 * authoring time, and `tests/railCorridors.test.ts` then proves — against the
 * actual planned building solids and static colliders — that nothing solid
 * stands on the corridor. This pair (carver + audit) is the structural answer
 * to "tracks must never run through a building": generators don't need to
 * know about rails individually, and any future map edit that reintroduces an
 * overlap fails the suite instead of shipping.
 *
 * Pure geometry — no Babylon, no DOM (`tests/architecture.test.ts`).
 */

export interface RailCorridorCarveResult {
  readonly blocks: ProceduralBlock[];
  /** Blocks dropped whole: the corridor ran along them, no useful remainder. */
  readonly removedBlockIds: readonly string[];
  /** Blocks shortened or split; ids of every produced fragment map to source. */
  readonly trimmedBlockIds: readonly string[];
}

/** A linear construction keep-out shared by rail rights-of-way and authored
 * road structures whose complete horizontal envelope must stay building-free. */
export interface LinearBuildCorridor {
  readonly points: readonly GameCanvasPoint[];
  readonly corridorHalfWidthM: number;
}

interface Interval {
  start: number;
  end: number;
}

const CLEARANCE_M = 1.2;
/** A fragment shorter than this along the block's long axis is not worth a
 * street wall and gets dropped — same spirit as the parcel generators' own
 * minimum half-lengths. */
const MIN_FRAGMENT_LENGTH_M = 12;

function toLocal(
  block: ProceduralBlock,
  point: GameCanvasPoint,
): { u: number; v: number } {
  const heading = ((block.headingDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const dx = point.x - block.center.x;
  const dz = point.z - block.center.z;
  // Inverse of the clockwise-yaw block frame (local +x -> (cos, -sin)).
  return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
}

/**
 * The block-local x-interval shadowed by one corridor segment, or null when
 * the segment's swept band misses the block rect entirely.
 */
function corridorShadowOnBlock(
  block: ProceduralBlock,
  a: GameCanvasPoint,
  b: GameCanvasPoint,
  halfWidth: number,
): Interval | null {
  const halfU = block.size.x / 2;
  const halfV = block.size.z / 2;
  const la = toLocal(block, a);
  const lb = toLocal(block, b);
  // Conservative capsule-vs-rect in block space: clip the segment against the
  // v-slab the corridor can touch, then take its u-extent inflated by the
  // corridor width. Exact for corridors crossing or running along the block;
  // conservative (never under-reports) for oblique clips.
  const vMin = -halfV - halfWidth;
  const vMax = halfV + halfWidth;
  let t0 = 0;
  let t1 = 1;
  const dv = lb.v - la.v;
  if (Math.abs(dv) < 1e-9) {
    if (la.v < vMin || la.v > vMax) return null;
  } else {
    const tA = (vMin - la.v) / dv;
    const tB = (vMax - la.v) / dv;
    t0 = Math.max(t0, Math.min(tA, tB));
    t1 = Math.min(t1, Math.max(tA, tB));
    if (t0 > t1) return null;
  }
  const u0 = la.u + (lb.u - la.u) * t0;
  const u1 = la.u + (lb.u - la.u) * t1;
  const start = Math.min(u0, u1) - halfWidth;
  const end = Math.max(u0, u1) + halfWidth;
  if (end < -halfU || start > halfU) return null;
  return { start: Math.max(start, -halfU), end: Math.min(end, halfU) };
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Carve every block so nothing overlaps any rail corridor. A block the
 * corridor crosses is split into the fragments either side of it (along the
 * block's local x axis); a block the corridor swallows is removed. Fragment
 * ids append a caller-selected fragment prefix (`rw` by default) plus their
 * position so ids stay stable and unique.
 */
export function carveBlocksForLinearCorridors(
  blocks: readonly ProceduralBlock[],
  corridors: readonly LinearBuildCorridor[],
  options: {
    readonly minFragmentLengthM?: number;
    readonly fragmentIdPrefix?: string;
  } = {},
): RailCorridorCarveResult {
  const minFragment = options.minFragmentLengthM ?? MIN_FRAGMENT_LENGTH_M;
  const fragmentIdPrefix = options.fragmentIdPrefix ?? "rw";
  if (!corridors.length) {
    return { blocks: [...blocks], removedBlockIds: [], trimmedBlockIds: [] };
  }
  const result: ProceduralBlock[] = [];
  const removedBlockIds: string[] = [];
  const trimmedBlockIds: string[] = [];
  for (const block of blocks) {
    const halfU = block.size.x / 2;
    const shadows: Interval[] = [];
    for (const line of corridors) {
      const halfWidth = line.corridorHalfWidthM + CLEARANCE_M;
      for (let index = 0; index < line.points.length - 1; index += 1) {
        const shadow = corridorShadowOnBlock(
          block,
          line.points[index],
          line.points[index + 1],
          halfWidth,
        );
        if (shadow) shadows.push(shadow);
      }
    }
    if (!shadows.length) {
      result.push(block);
      continue;
    }
    // Complement of the merged shadows inside [-halfU, halfU].
    const kept: Interval[] = [];
    let cursor = -halfU;
    for (const gap of mergeIntervals(shadows)) {
      if (gap.start > cursor) kept.push({ start: cursor, end: gap.start });
      cursor = Math.max(cursor, gap.end);
    }
    if (cursor < halfU) kept.push({ start: cursor, end: halfU });
    const fragments = kept.filter(
      (interval) => interval.end - interval.start >= minFragment,
    );
    if (!fragments.length) {
      removedBlockIds.push(block.id);
      continue;
    }
    const heading = ((block.headingDeg ?? 0) * Math.PI) / 180;
    const axisX = Math.cos(heading);
    const axisZ = -Math.sin(heading);
    const untouched =
      fragments.length === 1 &&
      Math.abs(fragments[0].start + halfU) < 1e-6 &&
      Math.abs(fragments[0].end - halfU) < 1e-6;
    if (untouched) {
      result.push(block);
      continue;
    }
    trimmedBlockIds.push(block.id);
    for (const [index, fragment] of fragments.entries()) {
      const centerU = (fragment.start + fragment.end) / 2;
      result.push({
        ...block,
        id: fragments.length === 1
          ? block.id
          : `${block.id}-${fragmentIdPrefix}${index}`,
        center: {
          x: block.center.x + axisX * centerU,
          z: block.center.z + axisZ * centerU,
        },
        size: { x: fragment.end - fragment.start, z: block.size.z },
      });
    }
  }
  return { blocks: result, removedBlockIds, trimmedBlockIds };
}

/** Rail-specific compatibility wrapper; output remains byte-for-byte stable. */
export function carveBlocksForRailCorridors(
  blocks: readonly ProceduralBlock[],
  railLines: readonly RailLine[],
  options: { readonly minFragmentLengthM?: number } = {},
): RailCorridorCarveResult {
  return carveBlocksForLinearCorridors(blocks, railLines, options);
}
