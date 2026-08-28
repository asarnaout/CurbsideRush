import polygonClipping, {
  type MultiPolygon as ClippingMultiPolygon,
  type Pair as ClippingPair,
  type Polygon as ClippingPolygon,
  type Ring as ClippingRing,
} from "polygon-clipping";
import type { GameCanvasPoint } from "../sessionContract";
import { isElevatedRoadSurface } from "../roadElevation";

/**
 * Profiled collars where independently authored elevated roads share a node.
 *
 * Ordinary road strips are intentionally constant-width. At a flyover merge
 * that leaves a blunt slab step, while junction-aware edge trimming removes
 * the very parapets that would otherwise reveal the step. This module plans a
 * single shared physical envelope instead: every incident arm starts at the
 * widest throat, eases to its authored width, and contributes to one exterior
 * deck/barrier outline. It is pure geometry so asphalt, structure, headroom,
 * and collision can all consume the same result.
 */

export interface ElevatedRoadJunctionSurface {
  readonly id: string;
  readonly centerline: readonly GameCanvasPoint[];
  readonly widthM: number;
  readonly parapetDepthM?: number;
  readonly sidewalkWidthM?: number;
}

export interface ElevatedRoadJunctionArmSection extends GameCanvasPoint {
  readonly stationM: number;
  /** Left side while travelling away from the junction. */
  readonly positiveHalfWidthM: number;
  /** Right side while travelling away from the junction. */
  readonly negativeHalfWidthM: number;
  /** Largest side, retained as a convenient conservative width query. */
  readonly halfWidthM: number;
}

export interface ElevatedRoadJunctionArmCoverage {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly junctionEnd: "start" | "end";
  readonly planLengthM: number;
}

export interface ElevatedRoadJunctionArm {
  readonly surfaceId: string;
  readonly nodeIndex: number;
  readonly step: -1 | 1;
  readonly reachM: number;
  readonly nominalHalfWidthM: number;
  readonly sections: readonly ElevatedRoadJunctionArmSection[];
  readonly coverages: readonly ElevatedRoadJunctionArmCoverage[];
}

export interface ElevatedRoadJunctionGuardRun {
  readonly start: GameCanvasPoint;
  readonly end: GameCanvasPoint;
  readonly lengthM: number;
}

export interface ElevatedRoadJunctionSurfaceMesh {
  readonly points: readonly GameCanvasPoint[];
  readonly indices: readonly number[];
}

export interface ElevatedRoadJunctionEnvelope {
  readonly id: string;
  readonly pivot: GameCanvasPoint;
  readonly surfaceIds: readonly string[];
  readonly arms: readonly ElevatedRoadJunctionArm[];
  /** Exterior carriageway boundary, with a sampled road elevation per point. */
  readonly asphaltBoundary: readonly GameCanvasPoint[];
  /** Exterior structural slab boundary (asphalt plus deck overhang). */
  readonly deckBoundary: readonly GameCanvasPoint[];
  /** Physical centre line of the crash barrier around the collar. */
  readonly barrierBoundary: readonly GameCanvasPoint[];
  /** Authoritative profiled slab top used by structure, rails and headroom. */
  readonly deckMesh: ElevatedRoadJunctionSurfaceMesh;
  /** Asphalt clipped directly from the slab TIN, preserving identical planes. */
  readonly asphaltMesh: ElevatedRoadJunctionSurfaceMesh;
  /** Deck edges excluding every open arm mouth. */
  readonly deckGuardRuns: readonly ElevatedRoadJunctionGuardRun[];
  /** Barrier edges excluding every open arm mouth. */
  readonly barrierGuardRuns: readonly ElevatedRoadJunctionGuardRun[];
}

export interface ElevatedRoadJunctionOptions {
  readonly minimumElevationM: number;
  readonly deckOverhangM: number;
  readonly parapetDeckInsetM: number;
  readonly taperRatio: number;
  /** Vertical clearance required before two overlapping decks are independent. */
  readonly minimumVerticalSeparationM: number;
}

const DEFAULT_OPTIONS: ElevatedRoadJunctionOptions = {
  minimumElevationM: 0.65,
  deckOverhangM: 0.7,
  parapetDeckInsetM: 0.2,
  taperRatio: 8,
  minimumVerticalSeparationM: 2.25,
};

const POINT_EPSILON_M = 0.05;
const CLIPPING_SNAP_M = 0.001;
// Keep every genuine corner.  Removing an arbitrary sub-25 cm vertex can
// chamfer a ramp mouth inward far enough that the ordinary parapet handoff is
// left outside its own slab.  Only de-duplicate polygon-clipping snap noise;
// the collinearity pass below still removes redundant straight-line samples.
const MIN_BOUNDARY_VERTEX_SPACING_M = CLIPPING_SNAP_M * 1.5;
const SURFACE_SAMPLE_SNAP_M = 0.005;
const MAX_SECTION_SPACING_M = 2.5;
const CENTRAL_DISC_STEPS = 24;
const MOUTH_HANDOFF_LEAD_M = 0.4;
const MAX_GUARD_SURFACE_DEVIATION_M = 0.008;
const MAX_GUARD_PROFILE_CHORD_M = 4;
const MAX_GUARD_PROFILE_DEPTH = 6;
// Lane connectors sweep slightly outside the constant-width carrier while
// changing branch. A modest civil flare keeps the crash barrier beyond the
// widest legal vehicle envelope, then eases it back with the same taper.
const JUNCTION_THROAT_FLARE_M = 0.9;
// A fork is not visually or structurally independent merely because its two
// asphalt edges have stopped touching.  Leave a full crash-barrier recovery
// zone between paired ramps before ending the shared collar.  Besides making
// the width change read as a deliberate, gradual gore, this provides enough
// plan run for differently graded mouths to meet without a near-vertical
// concrete/rail stitch.
const JUNCTION_CORRIDOR_SEPARATION_MARGIN_M = 4.5;
const ELEVATION_BLEND_SHOULDER_M = 2;

type ClippingGeom = ClippingPolygon | ClippingMultiPolygon;

interface JunctionOccurrence {
  readonly surface: ElevatedRoadJunctionSurface;
  readonly nodeIndex: number;
}

interface JunctionCluster {
  readonly point: GameCanvasPoint;
  readonly occurrences: JunctionOccurrence[];
}

interface ArmFarFrame {
  readonly arm: ElevatedRoadJunctionArm;
  readonly center: GameCanvasPoint;
  readonly ux: number;
  readonly uz: number;
  readonly halfWidthM: number;
}

const distanceM = (
  first: { readonly x: number; readonly z: number },
  second: { readonly x: number; readonly z: number },
): number => Math.hypot(first.x - second.x, first.z - second.z);

const samePoint = (first: GameCanvasPoint, second: GameCanvasPoint): boolean =>
  distanceM(first, second) <= POINT_EPSILON_M &&
  Math.abs((first.elevationM ?? 0) - (second.elevationM ?? 0)) <=
    POINT_EPSILON_M;

const smoothstep = (amount: number): number => {
  const t = Math.max(0, Math.min(1, amount));
  return t * t * (3 - 2 * t);
};

const signedRingArea = (
  points: readonly { readonly x: number; readonly z: number }[],
): number => {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.z - next.x * current.z;
  }
  return twiceArea / 2;
};

const snappedRing = (
  points: readonly { readonly x: number; readonly z: number }[],
): ClippingRing => {
  const ring: ClippingPair[] = [];
  for (const point of points) {
    const pair = [
      Math.round(point.x / CLIPPING_SNAP_M) * CLIPPING_SNAP_M,
      Math.round(point.z / CLIPPING_SNAP_M) * CLIPPING_SNAP_M,
    ] as ClippingPair;
    const previous = ring.at(-1);
    if (
      !previous ||
      Math.abs(previous[0] - pair[0]) > 1e-9 ||
      Math.abs(previous[1] - pair[1]) > 1e-9
    ) {
      ring.push(pair);
    }
  }
  if (ring.length) ring.push([ring[0][0], ring[0][1]]);
  return ring;
};

const simplifyRing = (
  input: readonly { readonly x: number; readonly z: number }[],
): Array<{ x: number; z: number }> => {
  const points: Array<{ x: number; z: number }> = [];
  for (const point of input) {
    const previous = points.at(-1);
    if (
      previous &&
      distanceM(point, previous) < MIN_BOUNDARY_VERTEX_SPACING_M
    ) {
      continue;
    }
    points.push(point);
  }
  if (
    points.length > 3 &&
    distanceM(points[0], points.at(-1)!) < MIN_BOUNDARY_VERTEX_SPACING_M
  ) {
    points.pop();
  }
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const ax = current.x - previous.x;
      const az = current.z - previous.z;
      const bx = next.x - current.x;
      const bz = next.z - current.z;
      const scale = Math.max(0.001, Math.hypot(ax, az) * Math.hypot(bx, bz));
      if (Math.abs(ax * bz - az * bx) / scale > 0.0025) continue;
      points.splice(index, 1);
      changed = true;
      break;
    }
  }
  return signedRingArea(points) <= 0 ? points : points.reverse();
};

const unionOuterRing = (
  polygons: readonly (readonly { readonly x: number; readonly z: number }[])[],
): Array<{ x: number; z: number }> => {
  const geometries = polygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon): ClippingGeom => [[snappedRing(polygon)]]);
  if (!geometries.length) return [];
  let result: ClippingMultiPolygon;
  try {
    result = polygonClipping.union(geometries[0], ...geometries.slice(1));
  } catch {
    return [];
  }
  const outerRings = result
    .map((polygon) => polygon[0])
    .filter((ring): ring is ClippingRing => Boolean(ring));
  const largest = outerRings.reduce<ClippingRing | null>((best, ring) => {
    const open = ring.slice(0, -1).map(([x, z]) => ({ x, z }));
    if (!best) return ring;
    const bestOpen = best.slice(0, -1).map(([x, z]) => ({ x, z }));
    return Math.abs(signedRingArea(open)) > Math.abs(signedRingArea(bestOpen))
      ? ring
      : best;
  }, null);
  if (!largest) return [];
  return simplifyRing(
    largest.slice(0, -1).map(([x, z]) => ({ x, z })),
  );
};

const collectClusters = (
  surfaces: readonly ElevatedRoadJunctionSurface[],
  minimumElevationM: number,
): JunctionCluster[] => {
  const clusters: JunctionCluster[] = [];
  for (const surface of surfaces) {
    if (!isElevatedRoadSurface(surface)) continue;
    for (let nodeIndex = 0; nodeIndex < surface.centerline.length; nodeIndex += 1) {
      const point = surface.centerline[nodeIndex];
      if ((point.elevationM ?? 0) < minimumElevationM) continue;
      let cluster = clusters.find((candidate) => samePoint(candidate.point, point));
      if (!cluster) {
        cluster = { point, occurrences: [] };
        clusters.push(cluster);
      }
      cluster.occurrences.push({ surface, nodeIndex });
    }
  }
  return clusters.filter((cluster) => {
    const surfaceIds = new Set(
      cluster.occurrences.map((occurrence) => occurrence.surface.id),
    );
    return (
      surfaceIds.size > 1 &&
      cluster.occurrences.some(
        ({ surface, nodeIndex }) =>
          nodeIndex === 0 || nodeIndex === surface.centerline.length - 1,
      )
    );
  });
};

const armAvailableLengthM = (
  surface: ElevatedRoadJunctionSurface,
  nodeIndex: number,
  step: -1 | 1,
): number => {
  let lengthM = 0;
  for (
    let index = nodeIndex;
    index + step >= 0 && index + step < surface.centerline.length;
    index += step
  ) {
    lengthM += distanceM(surface.centerline[index], surface.centerline[index + step]);
  }
  return lengthM;
};

const nearestSurfaceSample = (
  surface: ElevatedRoadJunctionSurface,
  point: GameCanvasPoint,
): { distanceM: number; elevationM: number } => {
  let bestDistanceM = Number.POSITIVE_INFINITY;
  let bestElevationM = 0;
  for (let index = 1; index < surface.centerline.length; index += 1) {
    const start = surface.centerline[index - 1];
    const end = surface.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const nearestX = start.x + dx * amount;
    const nearestZ = start.z + dz * amount;
    const candidateDistanceM = Math.hypot(
      point.x - nearestX,
      point.z - nearestZ,
    );
    if (candidateDistanceM >= bestDistanceM) continue;
    bestDistanceM = candidateDistanceM;
    bestElevationM =
      (start.elevationM ?? 0) +
      ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
  }
  return { distanceM: bestDistanceM, elevationM: bestElevationM };
};

const branchSeparationReachM = (
  occurrence: JunctionOccurrence,
  step: -1 | 1,
  carrier: ElevatedRoadJunctionSurface,
  minimumVerticalSeparationM: number,
): number => {
  let stationM = 0;
  const separationM =
    carrier.widthM / 2 +
    occurrence.surface.widthM / 2 +
    JUNCTION_CORRIDOR_SEPARATION_MARGIN_M;
  for (
    let index = occurrence.nodeIndex;
    index + step >= 0 && index + step < occurrence.surface.centerline.length;
    index += step
  ) {
    const start = occurrence.surface.centerline[index];
    const end = occurrence.surface.centerline[index + step];
    const chordM = distanceM(start, end);
    const divisions = Math.max(1, Math.ceil(chordM / MAX_SECTION_SPACING_M));
    for (let division = 1; division <= divisions; division += 1) {
      const amount = division / divisions;
      const sample = {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        elevationM:
          (start.elevationM ?? 0) +
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
      };
      const nearest = nearestSurfaceSample(carrier, sample);
      if (
        nearest.distanceM >= separationM ||
        Math.abs((sample.elevationM ?? 0) - nearest.elevationM) >=
          minimumVerticalSeparationM
      ) {
        return stationM + chordM * amount;
      }
    }
    stationM += chordM;
  }
  return stationM;
};

const buildArm = (
  occurrence: JunctionOccurrence,
  step: -1 | 1,
  positiveThroatHalfWidthM: number,
  negativeThroatHalfWidthM: number,
  taperRatio: number,
  requiredReachM: number,
  maximumReachM: number,
): ElevatedRoadJunctionArm | null => {
  const { surface, nodeIndex } = occurrence;
  if (
    nodeIndex + step < 0 ||
    nodeIndex + step >= surface.centerline.length
  ) {
    return null;
  }
  const nominalHalfWidthM = surface.widthM / 2;
  const widthDeltaM = Math.max(
    0,
    positiveThroatHalfWidthM - nominalHalfWidthM,
    negativeThroatHalfWidthM - nominalHalfWidthM,
  );
  const throatHalfWidthM = Math.max(
    positiveThroatHalfWidthM,
    negativeThroatHalfWidthM,
  );
  const desiredReachM = Math.max(
    4,
    throatHalfWidthM * 1.2,
    widthDeltaM * taperRatio,
    requiredReachM,
  );
  const availableLengthM = armAvailableLengthM(surface, nodeIndex, step);
  let reachM = Math.min(
    desiredReachM,
    availableLengthM,
    maximumReachM,
  );
  // Do not finish a collar exactly on an ordinary polyline corner. The next
  // parapet starts at that corner's outside miter while the collar frame uses
  // the incoming normal, leaving the conspicuous 20–30 cm rail gaps seen on
  // Cairo's Dokki and Gezira ramps. Carry one metre into the next chord so the
  // two systems share the same straight edge axis at their hand-off.
  let nodeStationM = 0;
  for (
    let index = nodeIndex;
    index + step >= 0 && index + step < surface.centerline.length;
    index += step
  ) {
    nodeStationM += distanceM(
      surface.centerline[index],
      surface.centerline[index + step],
    );
    const hasFollowingChord =
      index + step * 2 >= 0 &&
      index + step * 2 < surface.centerline.length;
    const distanceToNodeM = nodeStationM - reachM;
    if (
      hasFollowingChord &&
      distanceToNodeM >= -0.01 &&
      distanceToNodeM <= MOUTH_HANDOFF_LEAD_M &&
      reachM + 0.01 < availableLengthM &&
      reachM + 0.01 < maximumReachM
    ) {
      reachM = Math.min(
        nodeStationM + MOUTH_HANDOFF_LEAD_M,
        availableLengthM,
        maximumReachM,
      );
      break;
    }
    if (nodeStationM > reachM + 0.01) break;
  }
  if (reachM < 0.2) return null;

  const sideHalfAt = (startHalfWidthM: number, stationM: number): number =>
    nominalHalfWidthM +
    Math.max(0, startHalfWidthM - nominalHalfWidthM) *
      (1 - smoothstep(stationM / reachM));
  const start = surface.centerline[nodeIndex];
  const sections: ElevatedRoadJunctionArmSection[] = [
    {
      ...start,
      elevationM: start.elevationM ?? 0,
      stationM: 0,
      positiveHalfWidthM: positiveThroatHalfWidthM,
      negativeHalfWidthM: negativeThroatHalfWidthM,
      halfWidthM: throatHalfWidthM,
    },
  ];
  const coverages: ElevatedRoadJunctionArmCoverage[] = [];
  let stationM = 0;
  for (
    let currentIndex = nodeIndex;
    currentIndex + step >= 0 &&
    currentIndex + step < surface.centerline.length &&
    stationM < reachM - 1e-6;
    currentIndex += step
  ) {
    const segmentIndex = step > 0 ? currentIndex : currentIndex - 1;
    const from = surface.centerline[currentIndex];
    const to = surface.centerline[currentIndex + step];
    const chordM = distanceM(from, to);
    if (chordM < 0.001) continue;
    const usedM = Math.min(chordM, reachM - stationM);
    const divisions = Math.max(1, Math.ceil(usedM / MAX_SECTION_SPACING_M));
    for (let division = 1; division <= divisions; division += 1) {
      const distanceAlongChordM = (usedM * division) / divisions;
      const amount = distanceAlongChordM / chordM;
      const sectionStationM = stationM + distanceAlongChordM;
      const positiveHalfWidthM = sideHalfAt(
        positiveThroatHalfWidthM,
        sectionStationM,
      );
      const negativeHalfWidthM = sideHalfAt(
        negativeThroatHalfWidthM,
        sectionStationM,
      );
      sections.push({
        x: from.x + (to.x - from.x) * amount,
        z: from.z + (to.z - from.z) * amount,
        elevationM:
          (from.elevationM ?? 0) +
          ((to.elevationM ?? 0) - (from.elevationM ?? 0)) * amount,
        stationM: sectionStationM,
        positiveHalfWidthM,
        negativeHalfWidthM,
        halfWidthM: Math.max(positiveHalfWidthM, negativeHalfWidthM),
      });
    }
    coverages.push({
      surfaceId: surface.id,
      segmentIndex,
      junctionEnd: step > 0 ? "start" : "end",
      planLengthM: usedM,
    });
    stationM += usedM;
  }
  if (sections.length < 2) return null;
  return {
    surfaceId: surface.id,
    nodeIndex,
    step,
    reachM: stationM,
    nominalHalfWidthM,
    sections,
    coverages,
  };
};

const sectionNormal = (
  sections: readonly ElevatedRoadJunctionArmSection[],
  index: number,
): { x: number; z: number } => {
  const previous = sections[Math.max(0, index - 1)];
  const next = sections[Math.min(sections.length - 1, index + 1)];
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const lengthM = Math.hypot(dx, dz);
  return lengthM > 0.001
    ? { x: -dz / lengthM, z: dx / lengthM }
    : { x: 0, z: 0 };
};

const armPolygon = (
  arm: ElevatedRoadJunctionArm,
  lateralAdditionM: number,
): Array<{ x: number; z: number }> => {
  const positive: Array<{ x: number; z: number }> = [];
  const negative: Array<{ x: number; z: number }> = [];
  for (const [index, section] of arm.sections.entries()) {
    const normal = sectionNormal(arm.sections, index);
    positive.push({
      x:
        section.x +
        normal.x * (section.positiveHalfWidthM + lateralAdditionM),
      z:
        section.z +
        normal.z * (section.positiveHalfWidthM + lateralAdditionM),
    });
    negative.push({
      x:
        section.x -
        normal.x * (section.negativeHalfWidthM + lateralAdditionM),
      z:
        section.z -
        normal.z * (section.negativeHalfWidthM + lateralAdditionM),
    });
  }
  return [...positive, ...negative.reverse()];
};

const centralDisc = (
  pivot: GameCanvasPoint,
  radiusM: number,
): Array<{ x: number; z: number }> =>
  Array.from({ length: CENTRAL_DISC_STEPS }, (_, index) => {
    const angle = (index / CENTRAL_DISC_STEPS) * Math.PI * 2;
    return {
      x: pivot.x + Math.cos(angle) * radiusM,
      z: pivot.z + Math.sin(angle) * radiusM,
    };
  });

const nearestArmSample = (
  arm: ElevatedRoadJunctionArm,
  point: { readonly x: number; readonly z: number },
): {
  readonly distanceSquared: number;
  readonly elevationM: number;
  readonly halfWidthM: number;
} => {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestElevationM = arm.sections[0]?.elevationM ?? 0;
  let bestHalfWidthM = arm.sections[0]?.halfWidthM ?? arm.nominalHalfWidthM;
  for (let index = 1; index < arm.sections.length; index += 1) {
    const start = arm.sections[index - 1];
    const end = arm.sections[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const nearestX = start.x + dx * amount;
    const nearestZ = start.z + dz * amount;
    const distanceSquared =
      (point.x - nearestX) ** 2 + (point.z - nearestZ) ** 2;
    const elevationM =
      (start.elevationM ?? 0) +
      ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
    const halfWidthM =
      start.halfWidthM + (end.halfWidthM - start.halfWidthM) * amount;
    if (distanceSquared < bestDistanceSquared - 1e-9) {
      bestDistanceSquared = distanceSquared;
      bestElevationM = elevationM;
      bestHalfWidthM = halfWidthM;
    }
  }
  return {
    distanceSquared: bestDistanceSquared,
    elevationM: bestElevationM,
    halfWidthM: bestHalfWidthM,
  };
};

const blendedArmElevationM = (
  arms: readonly ElevatedRoadJunctionArm[],
  point: { readonly x: number; readonly z: number },
): number => {
  const samples = arms.map((arm) => nearestArmSample(arm, point));
  const exact = samples.filter(({ distanceSquared }) => distanceSquared <= 1e-8);
  if (exact.length) {
    return exact.reduce((sum, sample) => sum + sample.elevationM, 0) /
      exact.length;
  }

  // Compact Shepard blending gives every point in the shared throat one
  // continuous road level without allowing a separated, differently graded
  // branch to keep pulling on the opposite mouth.  That distant influence was
  // enough to bend a nominally smooth ramp by 15–20 cm at its parapet even
  // after the two carriageways had visibly split.
  let weightedElevationM = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    const influenceRadiusM =
      sample.halfWidthM + ELEVATION_BLEND_SHOULDER_M;
    const normalizedDistanceSquared =
      sample.distanceSquared / (influenceRadiusM * influenceRadiusM);
    if (normalizedDistanceSquared >= 1) continue;
    const compactWeight = (1 - normalizedDistanceSquared) ** 2;
    const weight = compactWeight / (sample.distanceSquared + 0.04);
    weightedElevationM += sample.elevationM * weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) return weightedElevationM / totalWeight;
  return samples.reduce((nearest, sample) =>
    sample.distanceSquared < nearest.distanceSquared ? sample : nearest,
  ).elevationM;
};

const profiledBoundary = (
  ring: readonly { readonly x: number; readonly z: number }[],
  arms: readonly ElevatedRoadJunctionArm[],
): GameCanvasPoint[] => {
  const points = ring.map((point) => ({
    ...point,
    elevationM: blendedArmElevationM(arms, point),
  }));
  const anchoredIndices = new Set<number>();
  for (const [index, point] of points.entries()) {
    const anchor = arms
      .flatMap((arm) => {
        const end = arm.sections.at(-1);
        const previous = arm.sections.at(-2);
        if (!end || !previous) return [];
        const dx = end.x - previous.x;
        const dz = end.z - previous.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM < 0.001) return [];
        const ux = dx / lengthM;
        const uz = dz / lengthM;
        const relativeX = point.x - end.x;
        const relativeZ = point.z - end.z;
        const alongM = relativeX * ux + relativeZ * uz;
        const lateralM = -relativeX * uz + relativeZ * ux;
        return Math.abs(alongM) <= 0.2 &&
          Math.abs(lateralM) >= arm.nominalHalfWidthM - 0.2 &&
          Math.abs(lateralM) <= arm.nominalHalfWidthM + 1
          ? [{ elevationM: end.elevationM ?? 0, distanceM: Math.abs(alongM) }]
          : [];
      })
      .sort((first, second) => first.distanceM - second.distanceM)[0];
    if (!anchor) continue;
    point.elevationM = anchor.elevationM;
    anchoredIndices.add(index);
  }
  const maximumAuthoredGrade = Math.max(
    0.03,
    ...arms.flatMap((arm) =>
      arm.sections.slice(1).map((section, index) => {
        const previous = arm.sections[index];
        return (
          Math.abs((section.elevationM ?? 0) - (previous.elevationM ?? 0)) /
          Math.max(0.001, distanceM(previous, section))
        );
      }),
    ),
  );
  const maximumCollarGrade = maximumAuthoredGrade + 0.005;
  // Polygon union can place two nearby vertices on opposite sides of the
  // smooth arm blend. Project the cyclic height chain onto the authored grade
  // bound, sharing each correction between its two endpoints. This removes
  // short visual kinks without flattening an intentional ramp profile.
  for (let pass = 0; pass < 100; pass += 1) {
    let largestCorrectionM = 0;
    for (let index = 0; index < points.length; index += 1) {
      const nextIndex = (index + 1) % points.length;
      const current = points[index];
      const next = points[nextIndex];
      const limitM = maximumCollarGrade * distanceM(current, next);
      const differenceM = (next.elevationM ?? 0) - (current.elevationM ?? 0);
      const excessM = Math.abs(differenceM) - limitM;
      if (excessM <= 1e-8) continue;
      const direction = Math.sign(differenceM);
      const currentAnchored = anchoredIndices.has(index);
      const nextAnchored = anchoredIndices.has(nextIndex);
      if (currentAnchored && nextAnchored) continue;
      const correctionM =
        currentAnchored || nextAnchored ? excessM : excessM / 2;
      if (!currentAnchored) {
        current.elevationM =
          (current.elevationM ?? 0) + direction * correctionM;
      }
      if (!nextAnchored) {
        next.elevationM = (next.elevationM ?? 0) - direction * correctionM;
      }
      largestCorrectionM = Math.max(largestCorrectionM, correctionM);
    }
    if (largestCorrectionM < 1e-7) break;
  }
  return points;
};

const farFrames = (
  arms: readonly ElevatedRoadJunctionArm[],
  lateralAdditionM: number,
): ArmFarFrame[] =>
  arms.flatMap((arm) => {
    const end = arm.sections.at(-1);
    const previous = arm.sections.at(-2);
    if (!end || !previous) return [];
    const dx = end.x - previous.x;
    const dz = end.z - previous.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM < 0.001) return [];
    return [
      {
        arm,
        center: end,
        ux: dx / lengthM,
        uz: dz / lengthM,
        // Every arm finishes at its authored, symmetric width.
        halfWidthM: arm.nominalHalfWidthM + lateralAdditionM,
      },
    ];
  });

const isArmMouthEdge = (
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  frames: readonly ArmFarFrame[],
): boolean => {
  const edgeDx = end.x - start.x;
  const edgeDz = end.z - start.z;
  const edgeLengthM = Math.hypot(edgeDx, edgeDz);
  if (edgeLengthM < 0.001) return true;
  const edgeUx = edgeDx / edgeLengthM;
  const edgeUz = edgeDz / edgeLengthM;
  return frames.some((frame) => {
    const relative = (point: GameCanvasPoint) => ({
      along:
        (point.x - frame.center.x) * frame.ux +
        (point.z - frame.center.z) * frame.uz,
      lateral:
        -(point.x - frame.center.x) * frame.uz +
        (point.z - frame.center.z) * frame.ux,
    });
    const a = relative(start);
    const b = relative(end);
    return (
      Math.max(Math.abs(a.along), Math.abs(b.along)) <= 0.22 &&
      Math.max(Math.abs(a.lateral), Math.abs(b.lateral)) <=
        frame.halfWidthM + 0.25 &&
      Math.abs(edgeUx * frame.ux + edgeUz * frame.uz) <= 0.3
    );
  });
};

const isInsideArmMouthContinuation = (
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  frames: readonly ArmFarFrame[],
): boolean => {
  const midpoint = {
    x: (start.x + end.x) / 2,
    z: (start.z + end.z) / 2,
  };
  return frames.some((frame) => {
    const along =
      (midpoint.x - frame.center.x) * frame.ux +
      (midpoint.z - frame.center.z) * frame.uz;
    const lateral =
      -(midpoint.x - frame.center.x) * frame.uz +
      (midpoint.z - frame.center.z) * frame.ux;
    // Union clipping can leave a short longitudinal sliver just beyond a
    // compound mouth when two arms finish at slightly different tangents.
    // The ordinary road edge resumes at the far frame, so every such sliver
    // inside the open continuation corridor must stay barrier-free too.
    return along >= -0.25 && Math.abs(lateral) <= frame.halfWidthM + 0.3;
  });
};

const distanceToPlanSegmentM = (
  point: { readonly x: number; readonly z: number },
  start: { readonly x: number; readonly z: number },
  end: { readonly x: number; readonly z: number },
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount =
    lengthSquared > 1e-9
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.z - start.z) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
};

const exteriorFarFrames = (
  boundary: readonly GameCanvasPoint[],
  frames: readonly ArmFarFrame[],
): readonly ArmFarFrame[] =>
  frames.filter((frame) => {
    // When neighbouring logical collars are unioned, an arm can finish inside
    // another arm of the same physical road. That cross-section is an internal
    // construction seam, not a road mouth, and suppressing guards there would
    // create a dangling exterior rail.
    const coveredBySameSurfaceArm = frames.some(
      (other) =>
        other !== frame &&
        other.arm.surfaceId === frame.arm.surfaceId &&
        nearestArmSample(other.arm, frame.center).distanceSquared <= 0.0625,
    );
    if (coveredBySameSurfaceArm) return false;
    const normalX = -frame.uz;
    const normalZ = frame.ux;
    // A diverging branch can absorb one corner of a genuine mouth into the
    // union. One surviving exterior corner is enough to prove that the road
    // continues out of this collar; both sides are still handed off below.
    return [-1, 1].some((side) => {
      const edgePoint = {
        x: frame.center.x + normalX * frame.halfWidthM * side,
        z: frame.center.z + normalZ * frame.halfWidthM * side,
      };
      return boundary.some(
        (start, index) =>
          distanceToPlanSegmentM(
            edgePoint,
            start,
            boundary[(index + 1) % boundary.length],
          ) <= 0.45,
      );
    });
  });

const guardRuns = (
  boundary: readonly GameCanvasPoint[],
  frames: readonly ArmFarFrame[],
): ElevatedRoadJunctionGuardRun[] => {
  const runs: ElevatedRoadJunctionGuardRun[] = [];
  // Every arm mouth needs two longitudinal hand-offs. A neighbouring branch
  // may absorb one far-frame corner into the union, but that does not make the
  // surviving rail end optional; the guarded side still has to reach the
  // ordinary parapet that resumes beyond the collar.
  const mouthFrames = exteriorFarFrames(boundary, frames);
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const planLengthM = distanceM(start, end);
    if (
      planLengthM < 0.001 ||
      // A branch polygon can swallow one corner of another arm's far frame,
      // so that frame is no longer wholly exterior even though the remaining
      // partial cap still crosses live pavement. Test transverse cap pieces
      // against every authored arm; reserve the stricter exterior subset for
      // connector generation. Any boundary sliver that continues through an
      // authored road mouth is equally unsafe, even when another branch has
      // swallowed one of that mouth's two exterior corners.
      isArmMouthEdge(start, end, mouthFrames) ||
      isInsideArmMouthContinuation(start, end, mouthFrames)
    ) {
      continue;
    }
    runs.push({
      start,
      end,
      lengthM: Math.hypot(
        planLengthM,
        (end.elevationM ?? 0) - (start.elevationM ?? 0),
      ),
    });
  }

  // A round central throat can remain wider than a short arm at its final
  // sampled cross-section. Polygon union then removes the transverse cap as
  // intended, but its two cap corners can sit a few metres behind the exact
  // ordinary-road rail endpoints. Bridge those OUTSIDE corners longitudinally
  // so the safety barrier is continuous without ever closing the road mouth.
  const endpoints = runs.flatMap((run) => [run.start, run.end]);
  const openEndpoints = endpoints.filter(
    (candidate) =>
      endpoints.filter((other) => distanceM(candidate, other) <= 0.08)
        .length === 1,
  );
  const usedOpenEndpoints = new Set<GameCanvasPoint>();
  for (const frame of mouthFrames) {
    const normalX = -frame.uz;
    const normalZ = frame.ux;
    for (const side of [-1, 1] as const) {
      const target: GameCanvasPoint = {
        x: frame.center.x + normalX * frame.halfWidthM * side,
        z: frame.center.z + normalZ * frame.halfWidthM * side,
        elevationM: frame.center.elevationM ?? 0,
      };
      if (
        runs.some(
          (run) =>
            distanceToPlanSegmentM(target, run.start, run.end) <= 0.1,
        )
      ) {
        continue;
      }
      const candidate = openEndpoints
        .filter((endpoint) => !usedOpenEndpoints.has(endpoint))
        .map((endpoint) => {
          const relativeX = endpoint.x - frame.center.x;
          const relativeZ = endpoint.z - frame.center.z;
          return {
            endpoint,
            along: relativeX * frame.ux + relativeZ * frame.uz,
            lateral: -relativeX * frame.uz + relativeZ * frame.ux,
            distanceM: distanceM(endpoint, target),
          };
        })
        .filter(
          ({ along, lateral, distanceM: candidateDistanceM }) =>
            along >= -8 &&
            along <= 2 &&
            lateral * side > 0 &&
            Math.abs(Math.abs(lateral) - frame.halfWidthM) <= 2.5 &&
            candidateDistanceM <= 8,
        )
        .sort((first, second) => first.distanceM - second.distanceM)[0];
      if (!candidate || candidate.distanceM <= 0.08) continue;
      usedOpenEndpoints.add(candidate.endpoint);
      runs.push({
        start: candidate.endpoint,
        end: target,
        lengthM: Math.hypot(
          candidate.distanceM,
          (target.elevationM ?? 0) -
            (candidate.endpoint.elevationM ?? 0),
        ),
      });
    }
  }

  // Compound collars can also expose one short exterior interval where an
  // internal logical mouth was swallowed by the union. Such an interval is
  // much shorter than even the narrowest carriageway mouth; stitch it along
  // the exterior instead of leaving a visible/physical rail gap.
  const mouthTargets = mouthFrames.flatMap((frame) => {
    const normalX = -frame.uz;
    const normalZ = frame.ux;
    return ([-1, 1] as const).map((side) => ({
      x: frame.center.x + normalX * frame.halfWidthM * side,
      z: frame.center.z + normalZ * frame.halfWidthM * side,
    }));
  });
  const isMouthTarget = (point: GameCanvasPoint): boolean =>
    mouthTargets.some((target) => distanceM(point, target) <= 0.08);
  const followsExteriorBoundary = (
    start: GameCanvasPoint,
    end: GameCanvasPoint,
  ): boolean =>
    [0.25, 0.5, 0.75].every((amount) => {
      const sample = {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
      };
      return boundary.some(
        (boundaryStart, index) =>
          distanceToPlanSegmentM(
            sample,
            boundaryStart,
            boundary[(index + 1) % boundary.length],
          ) <= 0.35,
      );
    });
  const stitchedEndpoints = runs.flatMap((run) => [run.start, run.end]);
  const unmatched = stitchedEndpoints.filter(
    (candidate) =>
      !isMouthTarget(candidate) &&
      stitchedEndpoints.filter(
        (other) => distanceM(candidate, other) <= 0.08,
      ).length === 1,
  );
  const matched = new Set<GameCanvasPoint>();
  for (const start of unmatched) {
    if (matched.has(start)) continue;
    const nearest = unmatched
      .filter((candidate) => candidate !== start && !matched.has(candidate))
      .map((candidate) => ({
        candidate,
        distanceM: distanceM(start, candidate),
      }))
      .filter(({ candidate, distanceM: candidateDistanceM }) =>
        candidateDistanceM > 0.08 &&
        candidateDistanceM <= 4.4 &&
        followsExteriorBoundary(start, candidate),
      )
      .sort((first, second) => first.distanceM - second.distanceM)[0];
    if (!nearest) continue;
    matched.add(start);
    matched.add(nearest.candidate);
    runs.push({
      start,
      end: nearest.candidate,
      lengthM: Math.hypot(
        nearest.distanceM,
        (nearest.candidate.elevationM ?? 0) - (start.elevationM ?? 0),
      ),
    });
  }
  return runs;
};

const profileGuardRunsToSurface = (
  runs: readonly ElevatedRoadJunctionGuardRun[],
  surface: ElevatedRoadJunctionSurfaceMesh,
): ElevatedRoadJunctionGuardRun[] => {
  const profiled: ElevatedRoadJunctionGuardRun[] = [];
  const appendProfiled = (
    startInput: GameCanvasPoint,
    endInput: GameCanvasPoint,
    depth: number,
  ): void => {
    const startElevationM =
      elevatedRoadJunctionSurfaceElevationAt(surface, startInput) ??
      startInput.elevationM ??
      0;
    const endElevationM =
      elevatedRoadJunctionSurfaceElevationAt(surface, endInput) ??
      endInput.elevationM ??
      0;
    const start = { ...startInput, elevationM: startElevationM };
    const end = { ...endInput, elevationM: endElevationM };
    const planLengthM = distanceM(start, end);
    const midpoint = {
      x: (start.x + end.x) / 2,
      z: (start.z + end.z) / 2,
      elevationM: (startElevationM + endElevationM) / 2,
    };
    const surfaceMidpointElevationM =
      elevatedRoadJunctionSurfaceElevationAt(surface, midpoint);
    const surfaceDeviationM =
      surfaceMidpointElevationM === undefined
        ? 0
        : Math.abs(surfaceMidpointElevationM - (midpoint.elevationM ?? 0));
    if (
      depth < MAX_GUARD_PROFILE_DEPTH &&
      planLengthM > 0.12 &&
      (planLengthM > MAX_GUARD_PROFILE_CHORD_M ||
        surfaceDeviationM > MAX_GUARD_SURFACE_DEVIATION_M)
    ) {
      appendProfiled(
        start,
        {
          ...midpoint,
          elevationM: surfaceMidpointElevationM ?? midpoint.elevationM,
        },
        depth + 1,
      );
      appendProfiled(
        {
          ...midpoint,
          elevationM: surfaceMidpointElevationM ?? midpoint.elevationM,
        },
        end,
        depth + 1,
      );
      return;
    }
    profiled.push({
      start,
      end,
      lengthM: Math.hypot(
        planLengthM,
        endElevationM - startElevationM,
      ),
    });
  };
  for (const run of runs) appendProfiled(run.start, run.end, 0);
  return profiled;
};

const clippingRingArea = (ring: ClippingRing): number => {
  let twiceArea = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    twiceArea +=
      ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(twiceArea / 2);
};

const ringsHaveInteriorOverlap = (
  first: readonly GameCanvasPoint[],
  second: readonly GameCanvasPoint[],
): boolean => {
  try {
    const intersection = polygonClipping.intersection(
      [[snappedRing(first)]],
      [[snappedRing(second)]],
    );
    const areaM2 = intersection.reduce(
      (total, polygon) =>
        total +
        clippingRingArea(polygon[0]) -
        polygon
          .slice(1)
          .reduce((holes, ring) => holes + clippingRingArea(ring), 0),
      0,
    );
    return areaM2 > 0.01;
  } catch {
    return false;
  }
};

const mergeOverlappingEnvelopes = (
  envelopes: readonly ElevatedRoadJunctionEnvelope[],
  options: ElevatedRoadJunctionOptions,
): readonly ElevatedRoadJunctionEnvelope[] => {
  const parent = envelopes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const unite = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
  };

  for (let first = 0; first < envelopes.length; first += 1) {
    for (let second = first + 1; second < envelopes.length; second += 1) {
      const a = envelopes[first];
      const b = envelopes[second];
      if (
        Math.abs((a.pivot.elevationM ?? 0) - (b.pivot.elevationM ?? 0)) >
          POINT_EPSILON_M ||
        !a.surfaceIds.some((surfaceId) => b.surfaceIds.includes(surfaceId)) ||
        !ringsHaveInteriorOverlap(a.barrierBoundary, b.barrierBoundary)
      ) {
        continue;
      }
      unite(first, second);
    }
  }

  const components = new Map<number, ElevatedRoadJunctionEnvelope[]>();
  for (const [index, envelope] of envelopes.entries()) {
    const root = find(index);
    const component = components.get(root) ?? [];
    component.push(envelope);
    components.set(root, component);
  }

  return [...components.values()].map((component) => {
    if (component.length === 1) return component[0];
    const arms = component.flatMap((envelope) => envelope.arms);
    const surfaceIds = [
      ...new Set(component.flatMap((envelope) => envelope.surfaceIds)),
    ].sort();
    const mergedBoundary = (
      key: "asphaltBoundary" | "deckBoundary" | "barrierBoundary",
    ): GameCanvasPoint[] =>
      profiledBoundary(
        unionOuterRing(component.map((envelope) => envelope[key])),
        arms,
      );
    const asphaltBoundary = mergedBoundary("asphaltBoundary");
    const deckBoundary = mergedBoundary("deckBoundary");
    const barrierBoundary = mergedBoundary("barrierBoundary");
    const deckMesh = buildElevatedRoadJunctionSurfaceMesh(deckBoundary);
    const asphaltMesh = clipElevatedRoadJunctionSurfaceMesh(
      deckMesh,
      asphaltBoundary,
    );
    const pivot = component[0].pivot;
    const barrierAdditionM =
      options.deckOverhangM - options.parapetDeckInsetM;
    return {
      id: `${component
        .map((envelope) => envelope.id)
        .sort()
        .join("--")}-compound`,
      pivot,
      surfaceIds,
      arms,
      asphaltBoundary,
      deckBoundary,
      barrierBoundary,
      deckMesh,
      asphaltMesh,
      deckGuardRuns: profileGuardRunsToSurface(
        guardRuns(
          deckBoundary,
          farFrames(arms, options.deckOverhangM),
        ),
        deckMesh,
      ),
      barrierGuardRuns: profileGuardRunsToSurface(
        guardRuns(
          barrierBoundary,
          farFrames(arms, barrierAdditionM),
        ),
        deckMesh,
      ),
    };
  });
};

const envelopeId = (point: GameCanvasPoint): string =>
  `elevated-junction-${point.x.toFixed(3).replace(/[^0-9]/g, "_")}-${point.z
    .toFixed(3)
    .replace(/[^0-9]/g, "_")}`;

const halfDistanceToNextJunctionM = (
  occurrence: JunctionOccurrence,
  step: -1 | 1,
  clusters: readonly JunctionCluster[],
): number => {
  const nextNodeIndices = clusters.flatMap((cluster) =>
    cluster.occurrences
      .filter(
        (candidate) =>
          candidate.surface.id === occurrence.surface.id &&
          (candidate.nodeIndex - occurrence.nodeIndex) * step > 0,
      )
      .map((candidate) => candidate.nodeIndex),
  );
  if (!nextNodeIndices.length) return Number.POSITIVE_INFINITY;
  const nextNodeIndex = nextNodeIndices.reduce((nearest, candidate) =>
    Math.abs(candidate - occurrence.nodeIndex) <
    Math.abs(nearest - occurrence.nodeIndex)
      ? candidate
      : nearest,
  );
  let lengthM = 0;
  for (
    let index = occurrence.nodeIndex;
    index !== nextNodeIndex;
    index += step
  ) {
    lengthM += distanceM(
      occurrence.surface.centerline[index],
      occurrence.surface.centerline[index + step],
    );
  }
  // Neighbouring collars meet at one shared nominal-width cross-section. If
  // either taper finishes earlier, the ordinary longitudinal rail simply
  // occupies the remaining interval between them.
  return lengthM / 2;
};

/** Build all same-level elevated collars for one immutable surface collection. */
export function buildElevatedRoadJunctionEnvelopes(
  surfaces: readonly ElevatedRoadJunctionSurface[],
  options: Partial<ElevatedRoadJunctionOptions> = {},
): readonly ElevatedRoadJunctionEnvelope[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const envelopes: ElevatedRoadJunctionEnvelope[] = [];
  const clusters = collectClusters(surfaces, resolved.minimumElevationM);
  for (const cluster of clusters) {
    const surfaceIds = [
      ...new Set(cluster.occurrences.map(({ surface }) => surface.id)),
    ].sort();
    const widestAuthoredHalfWidthM = Math.max(
      ...cluster.occurrences.map(({ surface }) => surface.widthM / 2),
    );
    const throatHalfWidthM =
      widestAuthoredHalfWidthM + JUNCTION_THROAT_FLARE_M;
    const reachOverridesM = new Map<string, number>();
    const mayCrossAdjacentJunction = new Set<string>();
    const armKey = (occurrence: JunctionOccurrence, step: -1 | 1): string =>
      `${occurrence.surface.id}:${occurrence.nodeIndex}:${step}`;
    const requireReach = (
      occurrence: JunctionOccurrence,
      step: -1 | 1,
      reachM: number,
    ): void => {
      const key = armKey(occurrence, step);
      reachOverridesM.set(key, Math.max(reachOverridesM.get(key) ?? 0, reachM));
    };
    // At an internal mainline merge only the branch's OUTER edge should fan
    // to the carrier parapet. Widening both sides would pour a second
    // mainline-width slab over live lanes. End-to-end handovers and terminal
    // braids remain symmetric because both sides genuinely change width.
    const internalCarrier = cluster.occurrences
      .filter(
        ({ surface, nodeIndex }) =>
          nodeIndex > 0 &&
          nodeIndex + 1 < surface.centerline.length &&
          surface.widthM >= widestAuthoredHalfWidthM * 2 - 0.05,
      )
      .sort((first, second) => second.surface.widthM - first.surface.widthM)[0];
    const carrierAxis = (() => {
      if (!internalCarrier) return null;
      const previous =
        internalCarrier.surface.centerline[internalCarrier.nodeIndex - 1];
      const next =
        internalCarrier.surface.centerline[internalCarrier.nodeIndex + 1];
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const lengthM = Math.hypot(dx, dz);
      return lengthM > 0.001 ? { ux: dx / lengthM, uz: dz / lengthM } : null;
    })();
    if (internalCarrier) {
      for (const occurrence of cluster.occurrences) {
        if (
          occurrence.surface.id === internalCarrier.surface.id ||
          occurrence.surface.widthM >= internalCarrier.surface.widthM - 0.05
        ) {
          continue;
        }
        for (const step of [-1, 1] as const) {
          if (
            occurrence.nodeIndex + step < 0 ||
            occurrence.nodeIndex + step >= occurrence.surface.centerline.length
          ) {
            continue;
          }
          const separationReachM = branchSeparationReachM(
            occurrence,
            step,
            internalCarrier.surface,
            resolved.minimumVerticalSeparationM,
          );
          requireReach(occurrence, step, separationReachM);

          const neighbour =
            occurrence.surface.centerline[occurrence.nodeIndex + step];
          if (!neighbour) continue;
          const branchDx = neighbour.x - cluster.point.x;
          const branchDz = neighbour.z - cluster.point.z;
          const branchLengthM = Math.hypot(branchDx, branchDz);
          if (branchLengthM < 0.001) continue;
          for (const carrierStep of [-1, 1] as const) {
            const carrierNeighbour =
              internalCarrier.surface.centerline[
                internalCarrier.nodeIndex + carrierStep
              ];
            if (!carrierNeighbour) continue;
            const carrierDx = carrierNeighbour.x - cluster.point.x;
            const carrierDz = carrierNeighbour.z - cluster.point.z;
            const carrierLengthM = Math.hypot(carrierDx, carrierDz);
            if (
              carrierLengthM > 0.001 &&
              (branchDx * carrierDx + branchDz * carrierDz) /
                (branchLengthM * carrierLengthM) >
                0.5
            ) {
              requireReach(internalCarrier, carrierStep, separationReachM);
              // A nearby junction can sit inside the same compound merge
              // throat (Cairo's west mainline/Dokki pair is the canonical
              // case). Let this aligned carrier reach the actual separation;
              // overlapping raw collars are unioned into one envelope below.
              mayCrossAdjacentJunction.add(
                armKey(internalCarrier, carrierStep),
              );
            }
          }
        }
      }
    }
    const outwardOccurrences = cluster.occurrences.flatMap((occurrence) =>
      ([-1, 1] as const).flatMap((step) => {
        const neighbour =
          occurrence.surface.centerline[occurrence.nodeIndex + step];
        if (!neighbour) return [];
        const dx = neighbour.x - cluster.point.x;
        const dz = neighbour.z - cluster.point.z;
        const lengthM = Math.hypot(dx, dz);
        return lengthM > 0.001
          ? [{ occurrence, step, ux: dx / lengthM, uz: dz / lengthM }]
          : [];
      }),
    );
    // Paired one-way ramps leave a common carrier in almost the same
    // direction. Keep their shared fan active until the two driven corridors
    // have actually separated; ending both tapers at an arbitrary station
    // creates a transverse rail across one branch and a bare gore beside it.
    for (let firstIndex = 0; firstIndex < outwardOccurrences.length; firstIndex += 1) {
      const first = outwardOccurrences[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < outwardOccurrences.length; secondIndex += 1) {
        const second = outwardOccurrences[secondIndex];
        if (
          first.occurrence.surface.id === second.occurrence.surface.id ||
          (internalCarrier &&
            (first.occurrence.surface.id === internalCarrier.surface.id ||
              second.occurrence.surface.id === internalCarrier.surface.id)) ||
          first.ux * second.ux + first.uz * second.uz < 0.5
        ) {
          continue;
        }
        const pairedReachM = Math.max(
          branchSeparationReachM(
            first.occurrence,
            first.step,
            second.occurrence.surface,
            resolved.minimumVerticalSeparationM,
          ),
          branchSeparationReachM(
            second.occurrence,
            second.step,
            first.occurrence.surface,
            resolved.minimumVerticalSeparationM,
          ),
        );
        requireReach(first.occurrence, first.step, pairedReachM);
        requireReach(second.occurrence, second.step, pairedReachM);
      }
    }
    const throatSides = (
      occurrence: JunctionOccurrence,
      step: -1 | 1,
    ): { positive: number; negative: number } => {
      const nominalHalfWidthM = occurrence.surface.widthM / 2;
      if (
        !internalCarrier ||
        !carrierAxis ||
        occurrence.surface.id === internalCarrier.surface.id ||
        occurrence.surface.widthM >= internalCarrier.surface.widthM - 0.05
      ) {
        return { positive: throatHalfWidthM, negative: throatHalfWidthM };
      }
      const neighbour = occurrence.surface.centerline[occurrence.nodeIndex + step];
      if (!neighbour) {
        return { positive: nominalHalfWidthM, negative: nominalHalfWidthM };
      }
      const branchDx = neighbour.x - cluster.point.x;
      const branchDz = neighbour.z - cluster.point.z;
      const branchLengthM = Math.hypot(branchDx, branchDz);
      if (branchLengthM < 0.001) {
        return { positive: nominalHalfWidthM, negative: nominalHalfWidthM };
      }
      const far =
        step > 0
          ? occurrence.surface.centerline.at(-1)!
          : occurrence.surface.centerline[0];
      const carrierNormalX = -carrierAxis.uz;
      const carrierNormalZ = carrierAxis.ux;
      const departureLateralM =
        (far.x - cluster.point.x) * carrierNormalX +
        (far.z - cluster.point.z) * carrierNormalZ;
      if (Math.abs(departureLateralM) < 0.05) {
        return { positive: nominalHalfWidthM, negative: nominalHalfWidthM };
      }
      const outwardX = carrierNormalX * Math.sign(departureLateralM);
      const outwardZ = carrierNormalZ * Math.sign(departureLateralM);
      const branchPositiveNormalX = -branchDz / branchLengthM;
      const branchPositiveNormalZ = branchDx / branchLengthM;
      const positiveIsOutside =
        branchPositiveNormalX * outwardX +
          branchPositiveNormalZ * outwardZ >
        0;
      return positiveIsOutside
        ? { positive: throatHalfWidthM, negative: nominalHalfWidthM }
        : { positive: nominalHalfWidthM, negative: throatHalfWidthM };
    };
    const arms: ElevatedRoadJunctionArm[] = [];
    const armKeys = new Set<string>();
    for (const occurrence of cluster.occurrences) {
      for (const step of [-1, 1] as const) {
        const key = `${occurrence.surface.id}:${occurrence.nodeIndex}:${step}`;
        if (armKeys.has(key)) continue;
        const sides = throatSides(occurrence, step);
        const arm = buildArm(
          occurrence,
          step,
          sides.positive,
          sides.negative,
          resolved.taperRatio,
          reachOverridesM.get(key) ?? 0,
          mayCrossAdjacentJunction.has(key)
            ? Number.POSITIVE_INFINITY
            : halfDistanceToNextJunctionM(occurrence, step, clusters),
        );
        if (!arm) continue;
        armKeys.add(key);
        arms.push(arm);
      }
    }
    if (arms.length < 2) continue;

    const boundaryFor = (lateralAdditionM: number): GameCanvasPoint[] => {
      const ring = unionOuterRing([
        centralDisc(cluster.point, throatHalfWidthM + lateralAdditionM),
        ...arms.map((arm) => armPolygon(arm, lateralAdditionM)),
      ]);
      return profiledBoundary(ring, arms);
    };
    const asphaltBoundary = boundaryFor(0);
    const deckBoundary = boundaryFor(resolved.deckOverhangM);
    const barrierAdditionM =
      resolved.deckOverhangM - resolved.parapetDeckInsetM;
    const barrierBoundary = boundaryFor(barrierAdditionM);
    if (
      asphaltBoundary.length < 3 ||
      deckBoundary.length < 3 ||
      barrierBoundary.length < 3
    ) {
      continue;
    }
    const deckMesh = buildElevatedRoadJunctionSurfaceMesh(deckBoundary);
    const asphaltMesh = clipElevatedRoadJunctionSurfaceMesh(
      deckMesh,
      asphaltBoundary,
    );
    envelopes.push({
      id: envelopeId(cluster.point),
      pivot: {
        ...cluster.point,
        elevationM: cluster.point.elevationM ?? 0,
      },
      surfaceIds,
      arms,
      asphaltBoundary,
      deckBoundary,
      barrierBoundary,
      deckMesh,
      asphaltMesh,
      deckGuardRuns: profileGuardRunsToSurface(
        guardRuns(
          deckBoundary,
          farFrames(arms, resolved.deckOverhangM),
        ),
        deckMesh,
      ),
      barrierGuardRuns: profileGuardRunsToSurface(
        guardRuns(
          barrierBoundary,
          farFrames(arms, barrierAdditionM),
        ),
        deckMesh,
      ),
    });
  }
  return mergeOverlappingEnvelopes(envelopes, resolved);
}

/** Elevation of the ruled collar at an arbitrary plan point. */
export function elevatedRoadJunctionElevationAt(
  envelope: ElevatedRoadJunctionEnvelope,
  point: { readonly x: number; readonly z: number },
): number {
  return (
    elevatedRoadJunctionSurfaceElevationAt(envelope.deckMesh, point) ??
    blendedArmElevationM(envelope.arms, point)
  );
}

/** Ear-clips one simple outer ring; returned indices address the input ring. */
export function triangulateElevatedRoadJunctionBoundary(
  boundary: readonly { readonly x: number; readonly z: number }[],
): readonly number[] {
  if (boundary.length < 3) return [];
  const vertices = Array.from({ length: boundary.length }, (_, index) => index);
  if (signedRingArea(boundary) < 0) vertices.reverse();
  const indices: number[] = [];
  const cross = (a: number, b: number, c: number): number => {
    const first = boundary[a];
    const middle = boundary[b];
    const last = boundary[c];
    return (
      (middle.x - first.x) * (last.z - middle.z) -
      (middle.z - first.z) * (last.x - middle.x)
    );
  };
  const pointInTriangle = (
    pointIndex: number,
    aIndex: number,
    bIndex: number,
    cIndex: number,
  ): boolean => {
    const point = boundary[pointIndex];
    const a = boundary[aIndex];
    const b = boundary[bIndex];
    const c = boundary[cIndex];
    const sign = (
      first: typeof a,
      second: typeof a,
      test: typeof a,
    ) =>
      (test.x - second.x) * (first.z - second.z) -
      (first.x - second.x) * (test.z - second.z);
    const d1 = sign(point, a, b);
    const d2 = sign(point, b, c);
    const d3 = sign(point, c, a);
    const hasNegative = d1 < -1e-8 || d2 < -1e-8 || d3 < -1e-8;
    const hasPositive = d1 > 1e-8 || d2 > 1e-8 || d3 > 1e-8;
    return !(hasNegative && hasPositive);
  };

  let guard = boundary.length * boundary.length;
  while (vertices.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let index = 0; index < vertices.length; index += 1) {
      const a = vertices[(index - 1 + vertices.length) % vertices.length];
      const b = vertices[index];
      const c = vertices[(index + 1) % vertices.length];
      if (cross(a, b, c) <= 1e-8) continue;
      if (
        vertices.some(
          (candidate) =>
            candidate !== a &&
            candidate !== b &&
            candidate !== c &&
            pointInTriangle(candidate, a, b, c),
        )
      ) {
        continue;
      }
      indices.push(a, b, c);
      vertices.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (vertices.length === 3) indices.push(vertices[0], vertices[1], vertices[2]);
  return indices;
}

const trianglePlanAreaTwice = (
  points: readonly { readonly x: number; readonly z: number }[],
  a: number,
  b: number,
  c: number,
): number =>
  (points[b].x - points[a].x) * (points[c].z - points[a].z) -
  (points[b].z - points[a].z) * (points[c].x - points[a].x);

const orientedTriangle = (
  points: readonly { readonly x: number; readonly z: number }[],
  a: number,
  b: number,
  c: number,
): [number, number, number] =>
  trianglePlanAreaTwice(points, a, b, c) >= 0
    ? [a, b, c]
    : [a, c, b];

const trianglePlanQuality = (
  points: readonly { readonly x: number; readonly z: number }[],
  a: number,
  b: number,
  c: number,
): number => {
  const lengthSquared = (first: number, second: number): number =>
    (points[first].x - points[second].x) ** 2 +
    (points[first].z - points[second].z) ** 2;
  return (
    Math.abs(trianglePlanAreaTwice(points, a, b, c)) /
    Math.max(
      1e-9,
      lengthSquared(a, b) + lengthSquared(b, c) + lengthSquared(c, a),
    )
  );
};

const trianglePlaneGrade = (
  points: readonly {
    readonly x: number;
    readonly z: number;
    readonly elevationM?: number;
  }[],
  a: number,
  b: number,
  c: number,
): number => {
  const first = points[a];
  const second = points[b];
  const third = points[c];
  const firstX = second.x - first.x;
  const firstZ = second.z - first.z;
  const firstY = (second.elevationM ?? 0) - (first.elevationM ?? 0);
  const secondX = third.x - first.x;
  const secondZ = third.z - first.z;
  const secondY = (third.elevationM ?? 0) - (first.elevationM ?? 0);
  const determinant = firstX * secondZ - firstZ * secondX;
  if (Math.abs(determinant) < 1e-10) return Number.POSITIVE_INFINITY;
  const gradeX = (firstY * secondZ - firstZ * secondY) / determinant;
  const gradeZ = (firstX * secondY - firstY * secondX) / determinant;
  return Math.hypot(gradeX, gradeZ);
};

/**
 * Lawson-style internal-edge improvement with the polygon outline held fixed.
 * Ear clipping is topologically reliable for a concave collar, but its choice
 * of diagonals can create metre-long sliver triangles and impossible crossfall.
 * Flipping only shared internal edges preserves the exact exterior and mouths
 * while maximizing the weaker adjacent triangle.
 */
const improveElevatedRoadJunctionTriangles = (
  points: readonly {
    readonly x: number;
    readonly z: number;
    readonly elevationM?: number;
  }[],
  input: readonly number[],
): number[] => {
  const triangles: Array<[number, number, number]> = [];
  for (let index = 0; index < input.length; index += 3) {
    triangles.push(
      orientedTriangle(points, input[index], input[index + 1], input[index + 2]),
    );
  }

  for (let pass = 0; pass < 100; pass += 1) {
    const edgeOwners = new Map<string, number[]>();
    for (const [triangleIndex, triangle] of triangles.entries()) {
      for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
        const first = triangle[edgeIndex];
        const second = triangle[(edgeIndex + 1) % 3];
        const key = `${Math.min(first, second)}:${Math.max(first, second)}`;
        const owners = edgeOwners.get(key) ?? [];
        owners.push(triangleIndex);
        edgeOwners.set(key, owners);
      }
    }

    let flipCount = 0;
    const changedTriangles = new Set<number>();
    for (const [key, owners] of edgeOwners) {
      if (
        owners.length !== 2 ||
        changedTriangles.has(owners[0]) ||
        changedTriangles.has(owners[1])
      ) {
        continue;
      }
      const [firstTriangleIndex, secondTriangleIndex] = owners;
      const [u, v] = key.split(":").map(Number);
      const firstTriangle = triangles[firstTriangleIndex];
      const secondTriangle = triangles[secondTriangleIndex];
      const a = firstTriangle.find((vertex) => vertex !== u && vertex !== v);
      const b = secondTriangle.find((vertex) => vertex !== u && vertex !== v);
      if (a === undefined || b === undefined) continue;

      // Both diagonals must lie inside a convex quadrilateral.
      if (
        trianglePlanAreaTwice(points, u, v, a) *
            trianglePlanAreaTwice(points, u, v, b) >=
          -1e-10 ||
        trianglePlanAreaTwice(points, a, b, u) *
            trianglePlanAreaTwice(points, a, b, v) >=
          -1e-10
      ) {
        continue;
      }
      const previousQuality = Math.min(
        trianglePlanQuality(points, u, v, a),
        trianglePlanQuality(points, u, v, b),
      );
      const flippedQuality = Math.min(
        trianglePlanQuality(points, a, b, u),
        trianglePlanQuality(points, a, b, v),
      );
      const previousGrade = Math.max(
        trianglePlaneGrade(points, u, v, a),
        trianglePlaneGrade(points, u, v, b),
      );
      const flippedGrade = Math.max(
        trianglePlaneGrade(points, a, b, u),
        trianglePlaneGrade(points, a, b, v),
      );
      const materiallyFlattens =
        flippedGrade < previousGrade * 0.98 - 1e-6 &&
        flippedQuality >= previousQuality * 0.3;
      const improvesPlanWithoutSteepening =
        flippedQuality > previousQuality + 1e-7 &&
        flippedGrade <= previousGrade * 1.02 + 0.002;
      if (!materiallyFlattens && !improvesPlanWithoutSteepening) continue;

      triangles[firstTriangleIndex] = orientedTriangle(points, a, b, u);
      triangles[secondTriangleIndex] = orientedTriangle(points, b, a, v);
      changedTriangles.add(firstTriangleIndex);
      changedTriangles.add(secondTriangleIndex);
      flipCount += 1;
    }
    if (flipCount === 0) break;
  }
  return triangles.flat();
};

/** One authoritative, grade-profiled TIN for a collar outline. */
export function buildElevatedRoadJunctionSurfaceMesh(
  boundary: readonly GameCanvasPoint[],
): ElevatedRoadJunctionSurfaceMesh {
  const points = boundary.map((point) => ({ ...point }));
  return {
    points,
    indices: improveElevatedRoadJunctionTriangles(
      points,
      triangulateElevatedRoadJunctionBoundary(points),
    ),
  };
}

const triangleBarycentricCoordinates = (
  point: { readonly x: number; readonly z: number },
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
  c: { readonly x: number; readonly z: number },
): readonly [number, number, number] | null => {
  const denominator =
    (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(denominator) < 1e-10) return null;
  const first =
    ((b.z - c.z) * (point.x - c.x) +
      (c.x - b.x) * (point.z - c.z)) /
    denominator;
  const second =
    ((c.z - a.z) * (point.x - c.x) +
      (a.x - c.x) * (point.z - c.z)) /
    denominator;
  return [first, second, 1 - first - second];
};

export function elevatedRoadJunctionSurfaceElevationAt(
  surface: ElevatedRoadJunctionSurfaceMesh,
  point: { readonly x: number; readonly z: number },
): number | undefined {
  for (let index = 0; index < surface.indices.length; index += 3) {
    const a = surface.points[surface.indices[index]];
    const b = surface.points[surface.indices[index + 1]];
    const c = surface.points[surface.indices[index + 2]];
    const barycentric = triangleBarycentricCoordinates(point, a, b, c);
    if (
      !barycentric ||
      barycentric.some((amount) => amount < -1e-5 || amount > 1.00001)
    ) {
      continue;
    }
    return (
      (a.elevationM ?? 0) * barycentric[0] +
      (b.elevationM ?? 0) * barycentric[1] +
      (c.elevationM ?? 0) * barycentric[2]
    );
  }
  // Polygon clipping works on millimetre-snapped coordinates while authored
  // mouth frames retain full precision.  A legitimate handoff can therefore
  // land a fraction of a millimetre beyond the last TIN edge.  Snap only that
  // numerical fringe; never extrapolate across an actual exterior gore.
  let nearestDistanceM = Number.POSITIVE_INFINITY;
  let nearestElevationM: number | undefined;
  for (let index = 0; index < surface.indices.length; index += 3) {
    const triangle = [
      surface.points[surface.indices[index]],
      surface.points[surface.indices[index + 1]],
      surface.points[surface.indices[index + 2]],
    ] as const;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const start = triangle[edgeIndex];
      const end = triangle[(edgeIndex + 1) % 3];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount =
        lengthSquared > 1e-10
          ? Math.max(
              0,
              Math.min(
                1,
                ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                  lengthSquared,
              ),
            )
          : 0;
      const distanceToEdgeM = Math.hypot(
        point.x - (start.x + dx * amount),
        point.z - (start.z + dz * amount),
      );
      if (distanceToEdgeM >= nearestDistanceM) continue;
      nearestDistanceM = distanceToEdgeM;
      nearestElevationM =
        (start.elevationM ?? 0) +
        ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
    }
  }
  if (nearestDistanceM <= SURFACE_SAMPLE_SNAP_M) return nearestElevationM;
  return undefined;
}

/**
 * Clip a coplanar subset from the authoritative deck TIN. Each asphalt vertex
 * is barycentrically sampled from its parent deck triangle, so the two meshes
 * cannot float apart or intersect even through a compound sloped junction.
 */
export function clipElevatedRoadJunctionSurfaceMesh(
  surface: ElevatedRoadJunctionSurfaceMesh,
  clipBoundary: readonly GameCanvasPoint[],
): ElevatedRoadJunctionSurfaceMesh {
  const points: GameCanvasPoint[] = [];
  const indices: number[] = [];
  const clipGeometry: ClippingGeom = [[snappedRing(clipBoundary)]];
  for (let triangleIndex = 0; triangleIndex < surface.indices.length; triangleIndex += 3) {
    const triangle = [
      surface.points[surface.indices[triangleIndex]],
      surface.points[surface.indices[triangleIndex + 1]],
      surface.points[surface.indices[triangleIndex + 2]],
    ] as const;
    let clipped: ClippingMultiPolygon;
    try {
      clipped = polygonClipping.intersection(
        [[snappedRing(triangle)]],
        clipGeometry,
      );
    } catch {
      continue;
    }
    for (const polygon of clipped) {
      const ring = polygon[0];
      if (!ring || ring.length < 4) continue;
      const localPoints = ring.slice(0, -1).map(([x, z]) => {
        const barycentric = triangleBarycentricCoordinates(
          { x, z },
          triangle[0],
          triangle[1],
          triangle[2],
        );
        const elevationM = barycentric
          ? (triangle[0].elevationM ?? 0) * barycentric[0] +
            (triangle[1].elevationM ?? 0) * barycentric[1] +
            (triangle[2].elevationM ?? 0) * barycentric[2]
          : triangle[0].elevationM ?? 0;
        return { x, z, elevationM };
      });
      const localIndices = triangulateElevatedRoadJunctionBoundary(localPoints);
      const offset = points.length;
      points.push(...localPoints);
      indices.push(...localIndices.map((index) => offset + index));
    }
  }
  return { points, indices };
}
