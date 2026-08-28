import type { GameCanvasPoint } from "../sessionContract";

export interface OpenRoadCurveOptions {
  /** Signed path tangents at authored knot indices. Vectors are normalized. */
  readonly tangentOverrides?: Readonly<Record<number, Readonly<{ x: number; z: number }>>>;
  /** Fraction of the neighbouring run used by each cubic handle. */
  readonly handleRatio?: number;
  /** Longest chord used while approximating a genuinely curved span. */
  readonly maximumChordM?: number;
  /** Largest change of heading represented by one sampled chord. */
  readonly maximumHeadingStepDeg?: number;
}

export interface OpenRoadCurveGeometry {
  /** Complete sampled path, with shared authored knots included once. */
  readonly centerline: readonly GameCanvasPoint[];
  /** One sampled path per original authored point pair. */
  readonly segments: readonly (readonly GameCanvasPoint[])[];
}

interface Direction {
  readonly x: number;
  readonly z: number;
}

const EPSILON_M = 0.001;

const normalize = (direction: Direction): Direction | null => {
  const lengthM = Math.hypot(direction.x, direction.z);
  return lengthM > EPSILON_M
    ? { x: direction.x / lengthM, z: direction.z / lengthM }
    : null;
};

const directionBetween = (
  start: GameCanvasPoint,
  end: GameCanvasPoint,
): Direction | null => normalize({ x: end.x - start.x, z: end.z - start.z });

const distanceBetween = (
  start: GameCanvasPoint,
  end: GameCanvasPoint,
): number => Math.hypot(end.x - start.x, end.z - start.z);

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const signedAngleBetween = (left: Direction, right: Direction): number =>
  Math.atan2(left.x * right.z - left.z * right.x, left.x * right.x + left.z * right.z);

const pointLineDistance = (
  point: GameCanvasPoint,
  start: GameCanvasPoint,
  end: GameCanvasPoint,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON_M * EPSILON_M) return distanceBetween(point, start);
  const amount = clamp(
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
};

const cubicPoint = (
  start: GameCanvasPoint,
  control1: GameCanvasPoint,
  control2: GameCanvasPoint,
  end: GameCanvasPoint,
  amount: number,
): GameCanvasPoint => {
  const inverse = 1 - amount;
  const inverse2 = inverse * inverse;
  const amount2 = amount * amount;
  return {
    x:
      inverse2 * inverse * start.x +
      3 * inverse2 * amount * control1.x +
      3 * inverse * amount2 * control2.x +
      amount2 * amount * end.x,
    z:
      inverse2 * inverse * start.z +
      3 * inverse2 * amount * control1.z +
      3 * inverse * amount2 * control2.z +
      amount2 * amount * end.z,
    elevationM:
      (start.elevationM ?? 0) +
      ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
  };
};

const tangentAt = (
  points: readonly GameCanvasPoint[],
  index: number,
  overrides: OpenRoadCurveOptions["tangentOverrides"],
): Direction => {
  const override = overrides?.[index];
  const normalizedOverride = override ? normalize(override) : null;
  if (normalizedOverride) return normalizedOverride;

  const incoming = index > 0
    ? directionBetween(points[index - 1], points[index])
    : null;
  const outgoing = index + 1 < points.length
    ? directionBetween(points[index], points[index + 1])
    : null;
  if (!incoming) return outgoing ?? { x: 1, z: 0 };
  if (!outgoing) return incoming;

  // A unit-vector bisector is insensitive to uneven authored chord lengths.
  // It makes both cubic spans share one tangent at the knot without letting a
  // long straight pull the curve through a much shorter ramp approach.
  return normalize({
    x: incoming.x + outgoing.x,
    z: incoming.z + outgoing.z,
  }) ?? outgoing;
};

/**
 * Samples a C1-continuous cubic path through an open authored road polyline.
 * Every authored point is retained exactly, so topology/junction ownership is
 * unchanged; only the geometry between those knots becomes a driveable curve.
 */
export function sampleOpenRoadCurve(
  points: readonly GameCanvasPoint[],
  options: OpenRoadCurveOptions = {},
): OpenRoadCurveGeometry {
  if (points.length < 2) return { centerline: points, segments: [] };

  const handleRatio = clamp(options.handleRatio ?? 0.34, 0.05, 0.48);
  const maximumChordM = Math.max(2, options.maximumChordM ?? 9);
  const maximumHeadingStepRad =
    (clamp(options.maximumHeadingStepDeg ?? 7.5, 2, 20) * Math.PI) / 180;
  const tangents = points.map((_, index) =>
    tangentAt(points, index, options.tangentOverrides),
  );
  const lengths = points.slice(1).map((point, index) =>
    distanceBetween(points[index], point),
  );
  const segments: GameCanvasPoint[][] = [];
  const centerline: GameCanvasPoint[] = [];

  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const chordM = lengths[index];
    if (chordM <= EPSILON_M) continue;
    const previousM = lengths[Math.max(0, index - 1)] ?? chordM;
    const nextM = lengths[Math.min(lengths.length - 1, index + 1)] ?? chordM;
    const startHandleM =
      Math.min(chordM, index > 0 ? previousM : chordM) * handleRatio;
    const endHandleM =
      Math.min(chordM, index + 1 < lengths.length ? nextM : chordM) * handleRatio;
    const control1: GameCanvasPoint = {
      x: start.x + tangents[index].x * startHandleM,
      z: start.z + tangents[index].z * startHandleM,
      elevationM: start.elevationM,
    };
    const control2: GameCanvasPoint = {
      x: end.x - tangents[index + 1].x * endHandleM,
      z: end.z - tangents[index + 1].z * endHandleM,
      elevationM: end.elevationM,
    };
    const chordDirection = directionBetween(start, end)!;
    const startTurnRad = Math.abs(signedAngleBetween(chordDirection, tangents[index]));
    const endTurnRad = Math.abs(signedAngleBetween(chordDirection, tangents[index + 1]));
    const deviationM = Math.max(
      pointLineDistance(control1, start, end),
      pointLineDistance(control2, start, end),
    );
    const isStraight =
      deviationM < 0.015 &&
      startTurnRad < (0.5 * Math.PI) / 180 &&
      endTurnRad < (0.5 * Math.PI) / 180;
    const controlPolygonM =
      distanceBetween(start, control1) +
      distanceBetween(control1, control2) +
      distanceBetween(control2, end);
    let steps = isStraight
      ? 1
      : Math.max(
          3,
          Math.ceil(controlPolygonM / maximumChordM),
          Math.ceil(Math.max(startTurnRad, endTurnRad) / maximumHeadingStepRad),
          Math.ceil(Math.sqrt(deviationM / 0.12) * 1.8),
        );
    const sampleAtCurrentResolution = (): GameCanvasPoint[] =>
      Array.from({ length: steps + 1 }, (_, step) =>
        step === 0
          ? start
          : step === steps
            ? end
            : cubicPoint(start, control1, control2, end, step / steps),
      );
    let segment = sampleAtCurrentResolution();
    while (steps < 256) {
      const directions = segment.slice(1).map((point, pointIndex) =>
        directionBetween(segment[pointIndex], point),
      );
      const longestChordM = Math.max(
        ...segment.slice(1).map((point, pointIndex) =>
          distanceBetween(segment[pointIndex], point),
        ),
      );
      const largestHeadingStepRad = directions.slice(1).reduce(
        (largest, direction, directionIndex) =>
          direction && directions[directionIndex]
            ? Math.max(
                largest,
                Math.abs(
                  signedAngleBetween(directions[directionIndex]!, direction),
                ),
              )
            : largest,
        0,
      );
      if (
        longestChordM <= maximumChordM + EPSILON_M &&
        largestHeadingStepRad <= maximumHeadingStepRad
      ) {
        break;
      }
      steps = Math.min(256, Math.ceil(steps * 1.5));
      segment = sampleAtCurrentResolution();
    }
    const chordLengths = segment.slice(1).map((point, pointIndex) =>
      distanceBetween(segment[pointIndex], point),
    );
    const sampledLengthM = chordLengths.reduce(
      (total, lengthM) => total + lengthM,
      0,
    );
    let travelledM = 0;
    const gradedSegment = segment.map((current, pointIndex) => {
      if (pointIndex === 0) return start;
      if (pointIndex === segment.length - 1) return end;
      travelledM += chordLengths[pointIndex - 1];
      return {
        x: current.x,
        z: current.z,
        elevationM:
          (start.elevationM ?? 0) +
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) *
            (sampledLengthM > EPSILON_M ? travelledM / sampledLengthM : 0),
      };
    });
    segments.push(gradedSegment);
    if (!centerline.length) centerline.push(...gradedSegment);
    else centerline.push(...gradedSegment.slice(1));
  }

  return { centerline, segments };
}

/** Offsets a sampled travel path to the driver's right at a constant distance. */
export function offsetOpenRoadPolyline(
  centerline: readonly GameCanvasPoint[],
  offsetM: number,
): readonly GameCanvasPoint[] {
  return centerline.map((current, index) => {
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const direction = directionBetween(previous, next);
    return direction
      ? {
          x: current.x + direction.z * offsetM,
          z: current.z - direction.x * offsetM,
          elevationM: current.elevationM,
        }
      : current;
  });
}
