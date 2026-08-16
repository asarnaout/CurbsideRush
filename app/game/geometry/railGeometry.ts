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
    // An endpoint has only one real direction — its other difference vector is
    // zero, which drives `dot` to 0 — so the corner clamp must not fire there:
    // it would push the vertex out at the full 2.5x clamp and turn every
    // straight offset run (bridge girders, terminus platforms, the rails
    // themselves) into a wedge anchored at the polyline's first vertex.
    const endpoint = index === 0 || index === points.length - 1;
    const dot = nx * inNx + nz * inNz;
    const miter = endpoint ? 1 : Math.min(2.5, 1 / Math.max(0.4, Math.abs(dot)));
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
 * Depot-shed terminus (rail feature): one enclosed shed straddling the track
 * at a shuttle's dwell end, so the parked consist waits out of sight and
 * nothing terminus-shaped reaches the neighbouring street. These constants
 * are the single source for the renderer (walls, roof, portal), the
 * simulation adapter (the solid walls the player collides with) and the
 * corridor audit (which lets `railShed` solids stand inside the corridor but
 * never across the running gauge). The covered interval must be straight and
 * at grade.
 */
export const RAIL_SHED_LENGTH_M = 30;
export const RAIL_SHED_HALF_WIDTH_M = 4.2;
export const RAIL_SHED_WALL_THICKNESS_M = 0.35;
export const RAIL_SHED_EAVE_HEIGHT_M = 5.6;
/** Portal opening: half-width past the centreline and clear height under the
 * header. The tallest consist piece (the tram pantograph head) tops out at
 * ~4.7 m over a 2.55 m car — both clear these with margin. */
export const RAIL_SHED_PORTAL_HALF_OPENING_M = 2.3;
export const RAIL_SHED_PORTAL_CLEAR_HEIGHT_M = 5.0;
export const RAIL_SHED_RIDGE_HEIGHT_M = 6.7;
/** No shed solid may reach within this half-width of the centreline — the
 * corridor audit's floor for the `railShed` exemption. */
export const RAIL_SHED_GAUGE_CLEAR_M = 2.2;

/** One solid shed piece as a plan-view OBB: U is the unit long axis with
 * half-length `halfU`, V its perpendicular `(uz, -ux)` with `halfV` — the
 * exact axis convention `StaticObstacle`'s `obb` kind uses. */
export interface RailShedSolid {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
  readonly heightM: number;
}

export interface RailShedLayout {
  /** Arclength interval covered on the line. */
  readonly fromM: number;
  readonly toM: number;
  /** The buffer-stop end of the shed. */
  readonly tipX: number;
  readonly tipZ: number;
  /** Unit direction from the tip INTO the line (out through the portal). */
  readonly fx: number;
  readonly fz: number;
  readonly solids: readonly RailShedSolid[];
}

/** The depot shed's solid pieces: two side walls, the rear gable wall behind
 * the buffer, and two portal jambs. Roof and portal header are renderer
 * dressing above car height and deliberately not solids. */
export function railTerminusShedLayout(
  points: readonly GameCanvasPoint[],
  lengthM: number,
  at: "start" | "end",
): RailShedLayout {
  const fromM = at === "start" ? 0 : Math.max(0, lengthM - RAIL_SHED_LENGTH_M);
  const toM = at === "start" ? Math.min(lengthM, RAIL_SHED_LENGTH_M) : lengthM;
  const tip = polylinePoseAt(points, at === "start" ? 0 : lengthM);
  const sign = at === "start" ? 1 : -1;
  const fx = Math.sin(tip.headingRad) * sign;
  const fz = Math.cos(tip.headingRad) * sign;
  // Right-hand normal of the portal direction.
  const rx = fz;
  const rz = -fx;
  const shedLength = toM - fromM;
  const rearOverhangM = 0.6;
  const solids: RailShedSolid[] = [];
  for (const side of [-1, 1]) {
    solids.push({
      id: side > 0 ? "wall-r" : "wall-l",
      x: tip.x + fx * (shedLength - rearOverhangM) / 2 + rx * RAIL_SHED_HALF_WIDTH_M * side,
      z: tip.z + fz * (shedLength - rearOverhangM) / 2 + rz * RAIL_SHED_HALF_WIDTH_M * side,
      ux: fx,
      uz: fz,
      halfU: (shedLength + rearOverhangM) / 2,
      halfV: RAIL_SHED_WALL_THICKNESS_M / 2,
      heightM: RAIL_SHED_EAVE_HEIGHT_M,
    });
    solids.push({
      id: side > 0 ? "jamb-r" : "jamb-l",
      x:
        tip.x +
        fx * (shedLength - RAIL_SHED_WALL_THICKNESS_M / 2) +
        rx * ((RAIL_SHED_PORTAL_HALF_OPENING_M + RAIL_SHED_HALF_WIDTH_M) / 2) * side,
      z:
        tip.z +
        fz * (shedLength - RAIL_SHED_WALL_THICKNESS_M / 2) +
        rz * ((RAIL_SHED_PORTAL_HALF_OPENING_M + RAIL_SHED_HALF_WIDTH_M) / 2) * side,
      ux: rx,
      uz: rz,
      halfU: (RAIL_SHED_HALF_WIDTH_M - RAIL_SHED_PORTAL_HALF_OPENING_M) / 2,
      halfV: RAIL_SHED_WALL_THICKNESS_M / 2,
      heightM: RAIL_SHED_EAVE_HEIGHT_M,
    });
  }
  solids.push({
    id: "rear",
    x: tip.x - fx * (rearOverhangM - RAIL_SHED_WALL_THICKNESS_M / 2),
    z: tip.z - fz * (rearOverhangM - RAIL_SHED_WALL_THICKNESS_M / 2),
    ux: rx,
    uz: rz,
    halfU: RAIL_SHED_HALF_WIDTH_M + RAIL_SHED_WALL_THICKNESS_M / 2,
    halfV: RAIL_SHED_WALL_THICKNESS_M / 2,
    heightM: RAIL_SHED_EAVE_HEIGHT_M,
  });
  return { fromM, toM, tipX: tip.x, tipZ: tip.z, fx, fz, solids };
}

/**
 * Split one shoreline-parapet run into the sub-runs that stay clear of every
 * rail corridor. The old guard skipped runs whose CENTRE was near the rails —
 * but a bank run can be 100 m long with a distant centre and still cross the
 * corridor, which is exactly how a parapet wall ended up standing across the
 * tracks at every bridge abutment. This walks the run's own axis, blanks the
 * span within `clearanceM` of any rail polyline, and returns the flanks.
 */
export function splitParapetRunAroundRails(
  run: {
    readonly x: number;
    readonly z: number;
    readonly ux: number;
    readonly uz: number;
    readonly halfU: number;
  },
  railLines: readonly { readonly points: readonly GameCanvasPoint[] }[],
  clearanceM: number,
): { x: number; z: number; halfU: number }[] {
  if (!railLines.length) return [{ x: run.x, z: run.z, halfU: run.halfU }];
  const step = 1;
  const samples = Math.max(2, Math.ceil((run.halfU * 2) / step) + 1);
  const blocked: boolean[] = [];
  for (let index = 0; index < samples; index += 1) {
    const u = -run.halfU + (index * (run.halfU * 2)) / (samples - 1);
    const point = { x: run.x + run.ux * u, z: run.z + run.uz * u };
    blocked.push(
      railLines.some((line) => {
        let best = Number.POSITIVE_INFINITY;
        for (let s = 0; s < line.points.length - 1; s += 1) {
          const a = line.points[s];
          const b = line.points[s + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const lengthSq = dx * dx + dz * dz;
          const t = Math.max(
            0,
            Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (lengthSq || 1)),
          );
          best = Math.min(
            best,
            Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)),
          );
          if (best < clearanceM) return true;
        }
        return best < clearanceM;
      }),
    );
  }
  const kept: { x: number; z: number; halfU: number }[] = [];
  let start: number | null = null;
  const emit = (fromIndex: number, toIndex: number) => {
    const u0 = -run.halfU + (fromIndex * (run.halfU * 2)) / (samples - 1);
    const u1 = -run.halfU + (toIndex * (run.halfU * 2)) / (samples - 1);
    const halfU = (u1 - u0) / 2;
    if (halfU < 1.2) return;
    const centreU = (u0 + u1) / 2;
    kept.push({
      x: run.x + run.ux * centreU,
      z: run.z + run.uz * centreU,
      halfU,
    });
  };
  for (let index = 0; index < samples; index += 1) {
    if (!blocked[index]) {
      if (start === null) start = index;
    } else if (start !== null) {
      emit(start, index - 1);
      start = null;
    }
  }
  if (start !== null) emit(start, samples - 1);
  return kept;
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
