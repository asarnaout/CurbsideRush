import type { GameCanvasPoint } from "../sessionContract";

/**
 * Pure polyline math for rail lines: arclength walking, lateral offsetting
 * for the two running rails, ballast segmentation around level crossings,
 * sleeper placement, and the corridor rectangles other systems treat as
 * keep-outs. No Babylon, no DOM — `tests/architecture.test.ts` enforces it.
 *
 * Everything here is measured in "distance along the line" metres, the same
 * 1-D coordinate `simulation/railSchedule.ts` runs trains on, so a renderer
 * consuming both can never disagree with the timetable about where a train is.
 */

/** Visual half-gauge: the two running rails sit this far off the centreline. */
export const RAIL_HALF_GAUGE_M = 0.72;
/** Ballast bed width — comfortably inside the authored corridor. */
export const RAIL_BALLAST_WIDTH_M = 3.6;
/** Sleeper spacing along ballast sections. */
export const RAIL_SLEEPER_SPACING_M = 1.15;
/** Extra clear metres past a crossing road's edge before ballast resumes. */
export const RAIL_CROSSING_APRON_M = 2.4;

export interface RailPolylinePose {
  readonly x: number;
  readonly z: number;
  /** World yaw of the line's forward direction, `atan2(dx, dz)`. */
  readonly headingRad: number;
}

export interface RailInterval {
  readonly startM: number;
  readonly endM: number;
}

export function polylineLengthM(points: readonly GameCanvasPoint[]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].z - points[index].z,
    );
  }
  return length;
}

export function polylinePoseAt(
  points: readonly GameCanvasPoint[],
  distanceM: number,
): RailPolylinePose {
  let remaining = Math.max(0, distanceM);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segment = Math.hypot(dx, dz);
    if (segment <= Number.EPSILON) continue;
    if (remaining <= segment || index === points.length - 2) {
      const amount = Math.min(1, remaining / segment);
      return {
        x: start.x + dx * amount,
        z: start.z + dz * amount,
        headingRad: Math.atan2(dx, dz),
      };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last.x, z: last.z, headingRad: 0 };
}

/** The sub-polyline between two arclength stations, endpoints interpolated. */
export function slicePolyline(
  points: readonly GameCanvasPoint[],
  fromM: number,
  toM: number,
): GameCanvasPoint[] {
  const result: GameCanvasPoint[] = [];
  const start = Math.max(0, Math.min(fromM, toM));
  const end = Math.max(fromM, toM);
  let accumulated = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (segment <= Number.EPSILON) continue;
    const segStart = accumulated;
    const segEnd = accumulated + segment;
    if (segEnd >= start && segStart <= end) {
      const t0 = Math.max(0, (start - segStart) / segment);
      const t1 = Math.min(1, (end - segStart) / segment);
      const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
      if (!result.length) result.push(p0);
      const lastPoint = result[result.length - 1];
      if (Math.hypot(p1.x - lastPoint.x, p1.z - lastPoint.z) > 0.02) {
        // Interior authored vertices land here via t1 = 1 on each segment.
        result.push(p1);
      }
    }
    accumulated = segEnd;
  }
  return result;
}

/**
 * Miter-offset a polyline laterally (positive = to the right of travel).
 * Miter length is clamped so a tight corner cannot spike the offset rail.
 */
export function offsetPolyline(
  points: readonly GameCanvasPoint[],
  lateralM: number,
): GameCanvasPoint[] {
  if (points.length < 2) return [...points];
  const result: GameCanvasPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const inDx = points[index].x - previous.x;
    const inDz = points[index].z - previous.z;
    const outDx = next.x - points[index].x;
    const outDz = next.z - points[index].z;
    const inLength = Math.hypot(inDx, inDz) || 1;
    const outLength = Math.hypot(outDx, outDz) || 1;
    // Right-hand normals of the incoming and outgoing directions.
    const inNx = inDz / inLength;
    const inNz = -inDx / inLength;
    const outNx = outDz / outLength;
    const outNz = -outDx / outLength;
    let nx = inNx + outNx;
    let nz = inNz + outNz;
    const normalLength = Math.hypot(nx, nz);
    if (normalLength < 1e-6) {
      nx = inNx;
      nz = inNz;
    } else {
      nx /= normalLength;
      nz /= normalLength;
    }
    // Miter scale so the offset holds parallel through the corner, clamped.
    const dot = nx * inNx + nz * inNz;
    const miter = Math.min(2.5, 1 / Math.max(0.4, Math.abs(dot)));
    result.push({
      x: points[index].x + nx * lateralM * miter,
      z: points[index].z + nz * lateralM * miter,
    });
  }
  return result;
}

function subtractIntervals(
  totalM: number,
  gaps: readonly RailInterval[],
): RailInterval[] {
  const sorted = [...gaps]
    .map((gap) => ({
      startM: Math.max(0, gap.startM),
      endM: Math.min(totalM, gap.endM),
    }))
    .filter((gap) => gap.endM > gap.startM)
    .sort((a, b) => a.startM - b.startM);
  const kept: RailInterval[] = [];
  let cursor = 0;
  for (const gap of sorted) {
    if (gap.startM > cursor) kept.push({ startM: cursor, endM: gap.startM });
    cursor = Math.max(cursor, gap.endM);
  }
  if (cursor < totalM) kept.push({ startM: cursor, endM: totalM });
  return kept.filter((interval) => interval.endM - interval.startM > 0.5);
}

/**
 * Where the ballast bed actually shows: the whole line minus a gap around
 * every road that crosses it (the road's own surface and shoulder carry the
 * crossing deck there) and minus any elevated span, whose structure lays its
 * own deck.
 */
export function railBallastIntervals(
  railPoints: readonly GameCanvasPoint[],
  roads: readonly {
    readonly centerline: readonly GameCanvasPoint[];
    readonly widthM: number;
    readonly sidewalkWidthM?: number;
  }[],
  elevatedSpans: readonly RailInterval[] = [],
  defaultSidewalkM = 0,
): RailInterval[] {
  const totalM = polylineLengthM(railPoints);
  const gaps: RailInterval[] = [...elevatedSpans];
  let accumulated = 0;
  for (let index = 0; index < railPoints.length - 1; index += 1) {
    const a = railPoints[index];
    const b = railPoints[index + 1];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (segment <= Number.EPSILON) continue;
    for (const road of roads) {
      for (let r = 0; r < road.centerline.length - 1; r += 1) {
        const c = road.centerline[r];
        const d = road.centerline[r + 1];
        const denom =
          (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
        if (Math.abs(denom) < 1e-9) continue;
        const t =
          ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / denom;
        const u =
          ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const along = accumulated + t * segment;
        const halfGap =
          road.widthM / 2 +
          (road.sidewalkWidthM ?? defaultSidewalkM) +
          RAIL_CROSSING_APRON_M;
        gaps.push({ startM: along - halfGap, endM: along + halfGap });
      }
    }
    accumulated += segment;
  }
  return subtractIntervals(totalM, gaps);
}

/** Sleeper poses along the given intervals of the line. */
export function railSleeperPlacements(
  railPoints: readonly GameCanvasPoint[],
  intervals: readonly RailInterval[],
  spacingM = RAIL_SLEEPER_SPACING_M,
): RailPolylinePose[] {
  const placements: RailPolylinePose[] = [];
  for (const interval of intervals) {
    const count = Math.floor((interval.endM - interval.startM) / spacingM);
    for (let index = 0; index <= count; index += 1) {
      placements.push(
        polylinePoseAt(railPoints, interval.startM + index * spacingM),
      );
    }
  }
  return placements;
}

/**
 * Per-segment axis-aligned rectangles covering the corridor, for consumers
 * that reason in `{center, size}` rects (prop scatter's landmark keep-outs).
 * A diagonal segment's AABB over-covers slightly, which errs safe.
 */
export function railCorridorExclusionRects(
  lines: readonly {
    readonly points: readonly GameCanvasPoint[];
    readonly corridorHalfWidthM: number;
  }[],
): { center: GameCanvasPoint; size: GameCanvasPoint }[] {
  const rects: { center: GameCanvasPoint; size: GameCanvasPoint }[] = [];
  for (const line of lines) {
    for (let index = 0; index < line.points.length - 1; index += 1) {
      const a = line.points[index];
      const b = line.points[index + 1];
      rects.push({
        center: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        size: {
          x: Math.abs(b.x - a.x) + line.corridorHalfWidthM * 2,
          z: Math.abs(b.z - a.z) + line.corridorHalfWidthM * 2,
        },
      });
    }
  }
  return rects;
}
