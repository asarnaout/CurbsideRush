import type { GameCanvasPoint } from "../sessionContract";
import { isElevatedRoadSurface } from "../roadElevation";

export interface ElevatedRoadGeometrySurface {
  readonly id: string;
  readonly centerline: readonly GameCanvasPoint[];
  readonly widthM: number;
  readonly parapetDepthM?: number;
  readonly sidewalkWidthM?: number;
}

export interface ElevatedRoadSegmentPlacement {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly center: GameCanvasPoint;
  readonly lengthM: number;
  readonly deckWidthM: number;
  /** Babylon yaw for a box whose long dimension is local +x. */
  readonly boxYawRad: number;
  /** Positive lifts the local +x end of the segment. */
  readonly slopeRad: number;
  readonly startElevationM: number;
  readonly endElevationM: number;
}

/** One uninterrupted side-structure run after elevated junction openings. */
export interface ElevatedRoadEdgeRunPlacement {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly side: -1 | 1;
  /** Local +x offset from the structural segment's centre. */
  readonly centerAlongM: number;
  readonly lengthM: number;
  /** Positive cuts back at a mouth; negative extends to an outside miter. */
  readonly startTrimM: number;
  /** Positive cuts back at a mouth; negative extends to an outside miter. */
  readonly endTrimM: number;
}

/** The structural slab left after a narrower branch is cut at a wider deck. */
export interface ElevatedRoadDeckRunPlacement {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  /** Local +x offset from the authored structural segment's centre. */
  readonly centerAlongM: number;
  readonly lengthM: number;
  readonly startTrimM: number;
  readonly endTrimM: number;
}

export interface ElevatedRoadPierPlacement {
  readonly surfaceId: string;
  readonly index: number;
  readonly position: GameCanvasPoint;
  readonly elevationM: number;
  readonly boxYawRad: number;
  readonly deckWidthM: number;
}

/**
 * One short, height-banded collision box for a rendered parapet edge run.
 *
 * The renderer can keep one long pitched box for an entire straight span,
 * but collision cannot: a single min/max elevation band over a long ramp
 * would make its high end block the street below (or make its low end
 * intangible). Short boxes keep the planar footprint and the active road
 * level local to the part of the ramp the player is actually beside.
 */
export interface ElevatedRoadBarrierPlacement {
  readonly id: string;
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly runIndex: number;
  readonly chunkIndex: number;
  readonly side: -1 | 1;
  readonly x: number;
  readonly z: number;
  /** Unit axis along the rendered parapet in world x/z. */
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
  readonly centerAlongM: number;
  readonly lengthM: number;
  /** Inclusive road-surface elevation band in which this barrier is solid. */
  readonly minElevationM: number;
  readonly maxElevationM: number;
}

/** Vertical clearance beneath the rendered structural slab at one x/z point. */
export interface ElevatedRoadDeckHeadroom {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  /** `pier` is a solid footprint and therefore reports zero usable headroom. */
  readonly structureKind?: "deck" | "pier";
  readonly supportIndex?: number;
  readonly deckElevationM: number;
  readonly soffitElevationM: number;
  readonly headroomM: number;
}

export type ElevatedRoadDeckHeadroomQuery = (
  point: { readonly x: number; readonly z: number },
  groundElevationM?: number,
  /** Circular x/z reach of a walker body or roadside prop. */
  footprintRadiusM?: number,
  /**
   * Whether support footings participate. Camera ceiling checks need the
   * slab alone; placement/collision callers keep the default and see both.
   */
  includeSupports?: boolean,
  /**
   * Surfaces that carry the caller at this sample. Filtering happens before
   * the lowest obstruction is selected so an ignored ramp cannot conceal a
   * genuinely separate deck above it.
   */
  excludedSurfaceIds?: ReadonlySet<string>,
  /**
   * Road tops this close to the caller's tyres are a continuous pavement
   * seam, not an overhead structure. Walkers keep the zero default; vehicle
   * physics supplies its road-level capture threshold.
   */
  minimumVerticalSeparationM?: number,
) => ElevatedRoadDeckHeadroom | null;

/**
 * The lowest usable vertical clearance above a ground-level footprint.
 *
 * `raised_surface` covers the pitched asphalt before the structural slab
 * begins. That apron is only a few centimetres to 0.65 m high, but a walker
 * left at ground Y would visibly pass through it. Once a slab exists, its
 * soffit (or a solid pier) is the tighter and therefore authoritative limit.
 */
export interface ElevatedRoadGroundClearance {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly obstructionKind: "raised_surface" | "deck" | "pier";
  readonly roadSurfaceElevationM: number;
  readonly clearanceM: number;
}

export type ElevatedRoadGroundClearanceQuery = (
  point: { readonly x: number; readonly z: number },
  groundElevationM?: number,
  /** Circular x/z reach of the ground user's body. */
  footprintRadiusM?: number,
  /**
   * Whether support footings participate. Vehicle physics leaves this false
   * because its existing static pier colliders provide the exact solid-body
   * response; walkers and placement callers keep the default.
   */
  includeSupports?: boolean,
  /** Road surfaces that form the caller's legal carrier at this sample. */
  excludedSurfaceIds?: ReadonlySet<string>,
  /** Minimum road-top separation that can count as overhead structure. */
  minimumVerticalSeparationM?: number,
) => ElevatedRoadGroundClearance | null;

/**
 * Below this height the ramp is still a ground-level carriageway widening.
 * Starting the concrete slab/parapet at the shared street node creates a wall
 * across the live lane; clipping it here leaves the authored slip-lane taper
 * open while the asphalt itself continues smoothly up the grade.
 */
export const ELEVATED_DECK_START_M = 0.65;
export const ELEVATED_ROAD_DECK_OVERHANG_M = 0.7;
export const ELEVATED_ROAD_DECK_SLAB_THICKNESS_M = 0.62;
export const ELEVATED_ROAD_PARAPET_HEIGHT_M = 0.86;
export const ELEVATED_ROAD_PARAPET_DEPTH_M = 0.28;
export const ELEVATED_ROAD_PARAPET_DECK_INSET_M = 0.2;
// Keep the concrete shell seated directly on the structural deck. Even a
// small positive offset is visible as a bright floating seam at night.
export const ELEVATED_ROAD_PARAPET_BASE_LIFT_M = 0;
export const ELEVATED_ROAD_PIER_COLUMN_TOP_DIAMETER_M = 1.35;
export const ELEVATED_ROAD_PIER_COLUMN_BOTTOM_DIAMETER_M = 2.25;
export const ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M = 2.65;
export const ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M =
  ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M / 2;
/** Visible breathing room between a footing and the nearest road/pavement. */
export const ELEVATED_ROAD_PIER_ROADSIDE_MARGIN_M = 0.1;
/** Maximum physical run length represented by one height-banded OBB. */
export const ELEVATED_ROAD_BARRIER_COLLIDER_MAX_LENGTH_M = 8;
/**
 * A player's elevation is the road surface beneath the tyres, not the car's
 * centre. This band keeps adjacent sampled ramp heights continuous while a
 * genuinely different street level remains non-interacting.
 */
export const ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M = 0.35;

/** Resolve an authored bridge-edge depth without changing another map's fallback. */
export function elevatedRoadParapetDepthM(
  surface: ElevatedRoadGeometrySurface,
): number {
  const authoredDepthM = surface.parapetDepthM;
  return typeof authoredDepthM === "number" &&
    Number.isFinite(authoredDepthM) &&
    authoredDepthM > 0
    ? authoredDepthM
    : ELEVATED_ROAD_PARAPET_DEPTH_M;
}

export function elevatedRoadSegmentPlacements(
  surface: ElevatedRoadGeometrySurface,
  deckOverhangM = ELEVATED_ROAD_DECK_OVERHANG_M,
): readonly ElevatedRoadSegmentPlacement[] {
  if (!isElevatedRoadSurface(surface)) return [];
  const placements: ElevatedRoadSegmentPlacement[] = [];
  for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
    const authoredStart = surface.centerline[index];
    const authoredEnd = surface.centerline[index + 1];
    const authoredStartElevationM = authoredStart.elevationM ?? 0;
    const authoredEndElevationM = authoredEnd.elevationM ?? 0;
    if (
      Math.max(authoredStartElevationM, authoredEndElevationM) <
      ELEVATED_DECK_START_M
    ) {
      continue;
    }
    let startAmount = 0;
    let endAmount = 1;
    const elevationDeltaM =
      authoredEndElevationM - authoredStartElevationM;
    if (
      authoredStartElevationM < ELEVATED_DECK_START_M &&
      Math.abs(elevationDeltaM) > Number.EPSILON
    ) {
      startAmount =
        (ELEVATED_DECK_START_M - authoredStartElevationM) / elevationDeltaM;
    }
    if (
      authoredEndElevationM < ELEVATED_DECK_START_M &&
      Math.abs(elevationDeltaM) > Number.EPSILON
    ) {
      endAmount =
        (ELEVATED_DECK_START_M - authoredStartElevationM) / elevationDeltaM;
    }
    const interpolate = (amount: number): GameCanvasPoint => ({
      x: authoredStart.x + (authoredEnd.x - authoredStart.x) * amount,
      z: authoredStart.z + (authoredEnd.z - authoredStart.z) * amount,
      elevationM: authoredStartElevationM + elevationDeltaM * amount,
    });
    const start = interpolate(startAmount);
    const end = interpolate(endAmount);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const planLengthM = Math.hypot(dx, dz);
    // Curved alignments can contain a short chord at a high-curvature apex.
    // Retain it: dropping that chord removes the complete slab and both edge
    // structures even though the asphalt strip remains continuous above it.
    if (planLengthM < 0.001) continue;
    const startElevationM = start.elevationM ?? 0;
    const endElevationM = end.elevationM ?? 0;
    placements.push({
      surfaceId: surface.id,
      segmentIndex: index,
      center: {
        x: (start.x + end.x) / 2,
        z: (start.z + end.z) / 2,
        elevationM: (startElevationM + endElevationM) / 2,
      },
      lengthM: Math.hypot(planLengthM, endElevationM - startElevationM),
      deckWidthM: surface.widthM + deckOverhangM * 2,
      boxYawRad: Math.atan2(dx, dz) - Math.PI / 2,
      slopeRad: Math.atan2(endElevationM - startElevationM, planLengthM),
      startElevationM,
      endElevationM,
    });
  }
  return placements;
}

const sameElevatedJunctionPoint = (
  left: GameCanvasPoint,
  right: GameCanvasPoint,
): boolean =>
  Math.hypot(left.x - right.x, left.z - right.z) < 0.05 &&
  Math.abs((left.elevationM ?? 0) - (right.elevationM ?? 0)) < 0.05;

const retainedStructuralEndpoint = (
  authored: GameCanvasPoint,
  elevationM: number,
): boolean => Math.abs(elevationM - (authored.elevationM ?? 0)) < 0.05;

const structuralMetresPerPlanMetre = (
  segment: ElevatedRoadSegmentPlacement,
): number => {
  const riseM = segment.endElevationM - segment.startElevationM;
  const planLengthM = Math.sqrt(
    Math.max(0, segment.lengthM * segment.lengthM - riseM * riseM),
  );
  return planLengthM > 0.001 ? segment.lengthM / planLengthM : 1;
};

/**
 * Whether a point on one road edge still occupies another elevated road's
 * carriageway. Keeping the height check local to the nearest polyline chord
 * avoids opening parapets where two roads merely cross at different levels.
 */
const pointInsideElevatedRoadCorridor = (
  point: { readonly x: number; readonly z: number },
  elevationM: number,
  surface: ElevatedRoadGeometrySurface,
  halfWidthM: number,
  elevationToleranceM = ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
): boolean => {
  const maximumDistanceSquared = halfWidthM * halfWidthM;
  for (let index = 1; index < surface.centerline.length; index += 1) {
    const start = surface.centerline[index - 1];
    const end = surface.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0.000001
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
    const offsetX = point.x - nearestX;
    const offsetZ = point.z - nearestZ;
    if (
      offsetX * offsetX + offsetZ * offsetZ >
      maximumDistanceSquared
    ) {
      continue;
    }
    const roadElevationM =
      (start.elevationM ?? 0) +
      ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
    if (
      Math.abs(elevationM - roadElevationM) <= elevationToleranceM
    ) {
      return true;
    }
  }
  return false;
};

const surfaceEndpointJoins = (
  surface: ElevatedRoadGeometrySurface,
  other: ElevatedRoadGeometrySurface,
): boolean => {
  const first = surface.centerline[0];
  const last = surface.centerline[surface.centerline.length - 1];
  if (!first || !last) return false;
  return [first, last].some((endpoint) =>
    other.centerline.some((point) =>
      sameElevatedJunctionPoint(endpoint, point),
    ),
  );
};

type ElevatedEndpointKey = "start" | "end";

interface ElevatedEndpointFrame {
  readonly point: GameCanvasPoint;
  readonly key: ElevatedEndpointKey;
  /** Unit direction from the junction out along this structural segment. */
  readonly outwardX: number;
  readonly outwardZ: number;
}

const retainedEndpointFrames = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
): readonly ElevatedEndpointFrame[] => {
  const start = surface.centerline[segment.segmentIndex];
  const end = surface.centerline[segment.segmentIndex + 1];
  if (!start || !end) return [];
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM < 0.001) return [];
  const frames: ElevatedEndpointFrame[] = [];
  if (retainedStructuralEndpoint(start, segment.startElevationM)) {
    frames.push({
      point: start,
      key: "start",
      outwardX: dx / lengthM,
      outwardZ: dz / lengthM,
    });
  }
  if (retainedStructuralEndpoint(end, segment.endElevationM)) {
    frames.push({
      point: end,
      key: "end",
      outwardX: -dx / lengthM,
      outwardZ: -dz / lengthM,
    });
  }
  return frames;
};

/**
 * Whether another authored elevated surface carries structure away from this
 * endpoint. Deck boxes need this even when the continuation is almost
 * collinear or no wider than the current surface: a terminal concrete cap or
 * ordinary seam overlap at a joined mouth becomes a transverse face below the
 * shared asphalt.
 */
export function elevatedRoadEndpointHasStructuralContinuation(
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  key: ElevatedEndpointKey,
): boolean {
  const endpoint = retainedEndpointFrames(surface, segment).find(
    (candidate) => candidate.key === key,
  );
  if (!endpoint) return false;
  for (const other of allSurfaces) {
    if (other.id === surface.id || !isElevatedRoadSurface(other)) continue;
    for (let pointIndex = 0; pointIndex < other.centerline.length; pointIndex += 1) {
      const otherPoint = other.centerline[pointIndex];
      if (!sameElevatedJunctionPoint(endpoint.point, otherPoint)) continue;
      for (const neighbourIndex of [pointIndex - 1, pointIndex + 1]) {
        const neighbour = other.centerline[neighbourIndex];
        if (!neighbour) continue;
        const dx = neighbour.x - otherPoint.x;
        const dz = neighbour.z - otherPoint.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM < 0.001) continue;
        // A ray pointing back through the current segment (or across it) is a
        // genuine continuation. A same-direction duplicate is not.
        const alignment =
          endpoint.outwardX * (dx / lengthM) +
          endpoint.outwardZ * (dz / lengthM);
        if (alignment < 0.9) return true;
      }
    }
  }
  return false;
}

/**
 * Structural slab beneath one elevated asphalt chord.
 *
 * The slab always covers the chord's complete paved footprint. At a
 * cross-surface merge it continues a short distance beneath the adjoining
 * carrier, keeping the joint watertight while the separately derived edge runs
 * still open the parapets and fascia around the legal driving mouth. The
 * overlap remains inside that carrier's footprint, so no transverse concrete
 * end face is exposed beside the road.
 */
export function elevatedRoadDeckRun(
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
): ElevatedRoadDeckRunPlacement | null {
  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  if (!authoredStart || !authoredEnd) return null;
  const authoredDx = authoredEnd.x - authoredStart.x;
  const authoredDz = authoredEnd.z - authoredStart.z;
  const authoredLengthM = Math.hypot(authoredDx, authoredDz);
  if (authoredLengthM < 0.001) return null;
  const startTrimM = 0;
  const endTrimM = 0;
  const coreLengthM = segment.lengthM;
  const edgeRuns = elevatedRoadEdgeRuns(surface, segment, allSurfaces);
  const startMiterExtensionM = Math.max(
    0,
    ...edgeRuns.map((run) => -run.startTrimM),
  );
  const endMiterExtensionM = Math.max(
    0,
    ...edgeRuns.map((run) => -run.endTrimM),
  );
  const startHasContinuation = elevatedRoadEndpointHasStructuralContinuation(
    surface,
    segment,
    allSurfaces,
    "start",
  );
  const endHasContinuation = elevatedRoadEndpointHasStructuralContinuation(
    surface,
    segment,
    allSurfaces,
    "end",
  );
  const junctionDeckOverlapM = 0.175;
  // Ordinary span seams reach the outside edge miter (plus a tiny overlap),
  // so the rectangular slab pieces fully support the watertight asphalt
  // strip. At a retained merge, each slab overlaps beneath the paved junction
  // while its parapet/fascia runs stop at the carrier corridor.
  const startExtensionM =
    startTrimM <= 0.001
      ? startHasContinuation
        ? junctionDeckOverlapM
        : Math.max(0.175, startMiterExtensionM + 0.04)
      : 0;
  const endExtensionM =
    endTrimM <= 0.001
      ? endHasContinuation
        ? junctionDeckOverlapM
        : Math.max(0.175, endMiterExtensionM + 0.04)
      : 0;
  return {
    surfaceId: surface.id,
    segmentIndex: segment.segmentIndex,
    centerAlongM:
      (startTrimM - endTrimM - startExtensionM + endExtensionM) / 2,
    lengthM: coreLengthM + startExtensionM + endExtensionM,
    startTrimM,
    endTrimM,
  };
}

/**
 * Side girders and parapets cannot continue through an elevated T-junction:
 * they become a transverse wall across the joining carriageway. This derives
 * the uninterrupted edge runs for one structural segment, trimming only the
 * side(s) from which another elevated surface enters. The asphalt slab stays
 * continuous beneath the opening.
 */
export function elevatedRoadEdgeRuns(
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  junctionMarginM = 0.05,
): readonly ElevatedRoadEdgeRunPlacement[] {
  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  if (!authoredStart || !authoredEnd) return [];

  const planDx = authoredEnd.x - authoredStart.x;
  const planDz = authoredEnd.z - authoredStart.z;
  const planLengthM = Math.hypot(planDx, planDz);
  if (planLengthM < 0.001) return [];
  // A box's local +z is the left side of its local +x travel direction.
  const positiveSideX = -planDz / planLengthM;
  const positiveSideZ = planDx / planLengthM;
  const trims = {
    [-1]: { start: 0, end: 0 },
    [1]: { start: 0, end: 0 },
  } as Record<-1 | 1, { start: number; end: number }>;

  const slopeScale = structuralMetresPerPlanMetre(segment);
  // The parapet is the outermost side structure. Using its actual lateral
  // offset makes the junction opening follow the physical edge rather than a
  // centreline-only approximation.
  const edgeOffsetM =
    surface.widthM / 2 +
    ELEVATED_ROAD_DECK_OVERHANG_M -
    ELEVATED_ROAD_PARAPET_DECK_INSET_M;
  const parapetHalfDepthM = elevatedRoadParapetDepthM(surface) / 2;
  // Only a physically joined, wider carrier may suppress this surface's
  // parapets. This prevents an unrelated same-height crossing elsewhere in
  // the map from silently opening a guardrail.
  const widerConnectedSurfaces = allSurfaces.filter(
    (other) =>
      other.id !== surface.id &&
      isElevatedRoadSurface(other) &&
      other.widthM > surface.widthM + 0.05 &&
      surfaceEndpointJoins(surface, other),
  );

  /**
   * Paired one-way branches can share a long, shallow throat before their
   * centrelines have separated. They are not wider than one another, so the
   * carrier-only rule above used to leave both interior parapets standing in
   * the live lanes. Recognise only siblings that share the same terminal node
   * and the same wider carrier there. The initial-throat index set prevents a
   * later, unrelated recrossing from punching a hole in either guardrail.
   */
  const siblingCorridorsBySide: Record<
    -1 | 1,
    ElevatedRoadGeometrySurface[]
  > = { [-1]: [], [1]: [] };
  const firstSurfacePoint = surface.centerline[0];
  const lastSurfacePoint = surface.centerline.at(-1);
  for (const other of allSurfaces) {
    if (
      other.id === surface.id ||
      !isElevatedRoadSurface(other) ||
      Math.abs(other.widthM - surface.widthM) > 0.05
    ) {
      continue;
    }
    const otherFirst = other.centerline[0];
    const otherLast = other.centerline.at(-1);
    if (!firstSurfacePoint || !lastSurfacePoint || !otherFirst || !otherLast) {
      continue;
    }
    const shared = [
      { point: firstSurfacePoint, surfaceIndex: 0 },
      {
        point: lastSurfacePoint,
        surfaceIndex: surface.centerline.length - 1,
      },
    ].flatMap((candidate) =>
      [
        { point: otherFirst, otherIndex: 0 },
        { point: otherLast, otherIndex: other.centerline.length - 1 },
      ]
        .filter((otherCandidate) =>
          sameElevatedJunctionPoint(candidate.point, otherCandidate.point),
        )
        .map((otherCandidate) => ({
          point: candidate.point,
          surfaceIndex: candidate.surfaceIndex,
          otherIndex: otherCandidate.otherIndex,
        })),
    )[0];
    if (!shared) continue;

    const commonWiderCarrier = allSurfaces.some(
      (carrier) =>
        carrier.id !== surface.id &&
        carrier.id !== other.id &&
        isElevatedRoadSurface(carrier) &&
        carrier.widthM > Math.max(surface.widthM, other.widthM) + 0.05 &&
        carrier.centerline.some((point) =>
          sameElevatedJunctionPoint(shared.point, point),
        ),
    );
    if (!commonWiderCarrier) continue;

    const throatSegmentIndices = new Set<number>();
    const segmentIndices = Array.from(
      { length: Math.max(0, surface.centerline.length - 1) },
      (_, index) => index,
    );
    if (shared.surfaceIndex !== 0) segmentIndices.reverse();
    const combinedCorridorHalfWidthM =
      edgeOffsetM +
      other.widthM / 2 +
      junctionMarginM +
      parapetHalfDepthM;
    for (const candidateIndex of segmentIndices) {
      throatSegmentIndices.add(candidateIndex);
      const outwardPoint =
        shared.surfaceIndex === 0
          ? surface.centerline[candidateIndex + 1]
          : surface.centerline[candidateIndex];
      if (
        !outwardPoint ||
        !pointInsideElevatedRoadCorridor(
          outwardPoint,
          outwardPoint.elevationM ?? 0,
          other,
          combinedCorridorHalfWidthM,
        )
      ) {
        break;
      }
    }
    if (throatSegmentIndices.has(segment.segmentIndex)) {
      // Curved siblings can change their global side long after the throat,
      // so a far endpoint is not a reliable facing-edge selector. Register
      // both physical edges; `insideAt` below removes only the one whose
      // parapet centre actually enters the sibling pavement corridor.
      siblingCorridorsBySide[-1].push(other);
      siblingCorridorsBySide[1].push(other);
    }
  }

  // The inverse of the narrow-branch case above matters just as much: a
  // carrier rail can run diagonally across a ramp lane for several sampled
  // chords after an internal, tangent merge. Follow the carrier out from the
  // exact joined point and expose only the physical edge that still occupies
  // the narrower branch corridor. Once the two roads have separated, later
  // crossings are deliberately ignored and both rails remain intact.
  const narrowerBranchCorridorsBySide: Record<
    -1 | 1,
    ElevatedRoadGeometrySurface[]
  > = { [-1]: [], [1]: [] };
  for (const other of allSurfaces) {
    if (
      other.id === surface.id ||
      !isElevatedRoadSurface(other) ||
      other.widthM >= surface.widthM - 0.05
    ) {
      continue;
    }
    const otherEndpoints = [other.centerline[0], other.centerline.at(-1)].filter(
      (point): point is GameCanvasPoint => point !== undefined,
    );
    const sharedIndex = surface.centerline.findIndex((point) =>
      otherEndpoints.some((endpoint) =>
        sameElevatedJunctionPoint(point, endpoint),
      ),
    );
    if (sharedIndex < 0) continue;

    const throatSegmentIndices = new Set<number>();
    const combinedCorridorHalfWidthM =
      edgeOffsetM +
      other.widthM / 2 +
      junctionMarginM +
      parapetHalfDepthM;
    const scanFromJunction = (
      firstSegmentIndex: number,
      step: -1 | 1,
    ): void => {
      for (
        let candidateIndex = firstSegmentIndex;
        candidateIndex >= 0 &&
        candidateIndex + 1 < surface.centerline.length;
        candidateIndex += step
      ) {
        throatSegmentIndices.add(candidateIndex);
        const outwardPoint =
          step > 0
            ? surface.centerline[candidateIndex + 1]
            : surface.centerline[candidateIndex];
        if (
          !outwardPoint ||
          !pointInsideElevatedRoadCorridor(
            outwardPoint,
            outwardPoint.elevationM ?? 0,
            other,
            combinedCorridorHalfWidthM,
          )
        ) {
          break;
        }
      }
    };
    if (sharedIndex > 0) scanFromJunction(sharedIndex - 1, -1);
    if (sharedIndex + 1 < surface.centerline.length) {
      scanFromJunction(sharedIndex, 1);
    }
    if (throatSegmentIndices.has(segment.segmentIndex)) {
      narrowerBranchCorridorsBySide[-1].push(other);
      narrowerBranchCorridorsBySide[1].push(other);
    }
  }

  const trimmedInsideConnectedCorridor: Record<-1 | 1, boolean> = {
    [-1]: false,
    [1]: false,
  };

  const trimSameSurfaceCorner = (
    endpoint: ElevatedEndpointFrame,
  ): void => {
    const junctionIndex =
      endpoint.key === "start"
        ? segment.segmentIndex
        : segment.segmentIndex + 1;
    const neighbourIndex =
      endpoint.key === "start" ? junctionIndex - 1 : junctionIndex + 1;
    const neighbour = surface.centerline[neighbourIndex];
    if (!neighbour) return;
    const qx = neighbour.x - endpoint.point.x;
    const qz = neighbour.z - endpoint.point.z;
    const qLengthM = Math.hypot(qx, qz);
    if (qLengthM < 0.001) return;
    const rayX = qx / qLengthM;
    const rayZ = qz / qLengthM;
    // The adjacent authored direction enters a segment-start junction and
    // leaves a segment-end junction.
    const adjacentDirectionX = endpoint.key === "start" ? -rayX : rayX;
    const adjacentDirectionZ = endpoint.key === "start" ? -rayZ : rayZ;
    const adjacentPositiveSideX = -adjacentDirectionZ;
    const adjacentPositiveSideZ = adjacentDirectionX;
    const denominator =
      endpoint.outwardX * rayZ - endpoint.outwardZ * rayX;
    if (Math.abs(denominator) < 0.001) return;

    for (const side of [-1, 1] as const) {
      const currentEdgeX = side * positiveSideX * edgeOffsetM;
      const currentEdgeZ = side * positiveSideZ * edgeOffsetM;
      const adjacentEdgeX =
        side * adjacentPositiveSideX * edgeOffsetM;
      const adjacentEdgeZ =
        side * adjacentPositiveSideZ * edgeOffsetM;
      const differenceX = adjacentEdgeX - currentEdgeX;
      const differenceZ = adjacentEdgeZ - currentEdgeZ;
      const intersectionPlanM =
        (differenceX * rayZ - differenceZ * rayX) / denominator;
      if (Math.abs(intersectionPlanM) <= 0.001) continue;
      // Meet both adjacent edge axes at their exact miter. Positive values
      // trim the inside corner; negative values extend the outside corner.
      // The former implementation turned both values into positive cutbacks
      // and added the junction margin, leaving a real hole on every bend.
      trims[side][endpoint.key] = intersectionPlanM * slopeScale;
    }
  };

  const trimAtEndpoint = (
    endpoint: ElevatedEndpointFrame,
  ): void => {
    const surfacePointIndex =
      endpoint.key === "start"
        ? segment.segmentIndex
        : segment.segmentIndex + 1;
    const currentJunctionIsInternal =
      surfacePointIndex > 0 &&
      surfacePointIndex + 1 < surface.centerline.length;
    for (const other of allSurfaces) {
      if (other.id === surface.id || !isElevatedRoadSurface(other)) continue;
      for (let pointIndex = 0; pointIndex < other.centerline.length; pointIndex += 1) {
        const otherPoint = other.centerline[pointIndex];
        if (!sameElevatedJunctionPoint(endpoint.point, otherPoint)) continue;
        for (const neighbourIndex of [pointIndex - 1, pointIndex + 1]) {
          const neighbour = other.centerline[neighbourIndex];
          if (!neighbour) continue;
          const branchDx = neighbour.x - otherPoint.x;
          const branchDz = neighbour.z - otherPoint.z;
          const branchLengthM = Math.hypot(branchDx, branchDz);
          if (branchLengthM < 0.001) continue;
          const otherDirectionX = branchDx / branchLengthM;
          const otherDirectionZ = branchDz / branchLengthM;
          const lateralAmount =
            (branchDx * positiveSideX + branchDz * positiveSideZ) /
            branchLengthM;
          // Collinear surfaces are structural continuations: their barriers
          // normally meet. A narrower continuation is different: square
          // parapet starts sit inside the wider carriageway, so open a short
          // two-sided throat on the narrow surface instead.
          if (Math.abs(lateralAmount) < 0.12) {
            const continuationAmount =
              endpoint.outwardX * otherDirectionX +
              endpoint.outwardZ * otherDirectionZ;
            if (
              continuationAmount < -0.9 &&
              other.widthM > surface.widthM + 0.05
            ) {
              const throatM =
                (other.widthM / 2 + junctionMarginM) * slopeScale;
              for (const side of [-1, 1] as const) {
                trims[side][endpoint.key] = Math.max(
                  trims[side][endpoint.key],
                  throatM,
                );
              }
            } else if (
              currentJunctionIsInternal &&
              surface.widthM > other.widthM + 0.05 &&
              (pointIndex === 0 ||
                pointIndex === other.centerline.length - 1)
            ) {
              // A ramp can be deliberately tangent to its carrier at the
              // exact merge point, then peel away over the next several
              // samples. Its first chord therefore looks like a harmless
              // continuation even though leaving this carrier rail intact
              // would put a physical wall across the ramp mouth. Use the
              // branch's eventual departure only to choose the opening side;
              // keep the opening length local to the ramp width.
              const departurePoint =
                pointIndex === 0
                  ? other.centerline[other.centerline.length - 1]
                  : other.centerline[0];
              const departureDx = departurePoint.x - otherPoint.x;
              const departureDz = departurePoint.z - otherPoint.z;
              const departureLateralM =
                departureDx * positiveSideX +
                departureDz * positiveSideZ;
              if (Math.abs(departureLateralM) > 0.05) {
                const departureSide: -1 | 1 =
                  departureLateralM > 0 ? 1 : -1;
                const throatM =
                  (other.widthM / 2 + junctionMarginM) * slopeScale;
                trims[departureSide][endpoint.key] = Math.max(
                  trims[departureSide][endpoint.key],
                  throatM,
                );
              }
            }
            continue;
          }
          const side: -1 | 1 = lateralAmount > 0 ? 1 : -1;
          const otherNormalX = -otherDirectionZ;
          const otherNormalZ = otherDirectionX;
          const edgeX = side * positiveSideX * edgeOffsetM;
          const edgeZ = side * positiveSideZ * edgeOffsetM;
          const lateralAtJunctionM =
            edgeX * otherNormalX + edgeZ * otherNormalZ;
          const lateralPerPlanM =
            endpoint.outwardX * otherNormalX +
            endpoint.outwardZ * otherNormalZ;
          if (Math.abs(lateralPerPlanM) < 0.001) continue;
          const otherHalfM = other.widthM / 2 + junctionMarginM;
          // The two roots bound the part of this physical edge that lies
          // inside the other carriageway's projected corridor. Cut through
          // the farther positive root, which remains correct even when an
          // acute join first enters and then exits that corridor.
          const exitPlanM = Math.max(
            (-otherHalfM - lateralAtJunctionM) / lateralPerPlanM,
            (otherHalfM - lateralAtJunctionM) / lateralPerPlanM,
          );
          if (exitPlanM <= 0) continue;
          trims[side][endpoint.key] = Math.max(
            trims[side][endpoint.key],
            exitPlanM * slopeScale,
          );
        }
      }
    }
  };

  /**
   * A tangent branch can remain inside its wider carrier for several sampled
   * chords after the shared node. Endpoint-only trimming removes the first
   * chord, then immediately restores a row of parapets through live lanes.
   * Clip each physical edge until its concrete footprint has actually left
   * the connected carrier corridor.
   */
  const trimInsideConnectedCorridor = (side: -1 | 1): void => {
    const connectedCorridors = [
      ...widerConnectedSurfaces,
      ...siblingCorridorsBySide[side],
      ...narrowerBranchCorridorsBySide[side],
    ];
    if (connectedCorridors.length === 0) return;
    const structuralPlanLengthM = segment.lengthM / slopeScale;
    if (structuralPlanLengthM < 0.001) return;
    const directionX = planDx / planLengthM;
    const directionZ = planDz / planLengthM;
    const startX =
      segment.center.x - directionX * structuralPlanLengthM / 2;
    const startZ =
      segment.center.z - directionZ * structuralPlanLengthM / 2;
    const edgeStartX = startX + side * positiveSideX * edgeOffsetM;
    const edgeStartZ = startZ + side * positiveSideZ * edgeOffsetM;
    const insideAt = (amount: number): boolean => {
      const elevationM =
        segment.startElevationM +
        (segment.endElevationM - segment.startElevationM) * amount;
      const point = {
        x: edgeStartX + directionX * structuralPlanLengthM * amount,
        z: edgeStartZ + directionZ * structuralPlanLengthM * amount,
      };
      return connectedCorridors.some((other) =>
        pointInsideElevatedRoadCorridor(
          point,
          elevationM,
          other,
          other.widthM / 2 + junctionMarginM + parapetHalfDepthM,
          // Barrier colliders are height-banded across this complete chord.
          // Match that conservative vertical envelope while deciding whether
          // a connected road has already replaced the physical edge.
          ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M +
            Math.abs(segment.endElevationM - segment.startElevationM),
        ),
      );
    };

    // Short road chords make this mostly an endpoint test. The intermediate
    // samples also catch a curved carrier or a long authored branch chord
    // that briefly re-enters the carriageway. Since one edge-run record
    // cannot represent two disjoint remnants, omit such a middle crossing
    // instead of putting a collision wall through the carrier.
    const sampleCount = 8;
    const samples = Array.from(
      { length: sampleCount + 1 },
      (_, index) => insideAt(index / sampleCount),
    );
    const startsInside = samples[0];
    const endsInside = samples[sampleCount];
    if (samples.some(Boolean)) trimmedInsideConnectedCorridor[side] = true;
    if (startsInside && endsInside) {
      trims[side].start = Math.max(trims[side].start, segment.lengthM);
      return;
    }
    if (!startsInside && !endsInside) {
      if (samples.some(Boolean)) {
        trims[side].start = Math.max(trims[side].start, segment.lengthM);
      }
      return;
    }

    if (startsInside) {
      const firstOutsideIndex = samples.findIndex((inside) => !inside);
      if (
        firstOutsideIndex < 1 ||
        samples.slice(firstOutsideIndex + 1).some(Boolean)
      ) {
        trims[side].start = Math.max(trims[side].start, segment.lengthM);
        return;
      }
      let insideAmount = (firstOutsideIndex - 1) / sampleCount;
      let outsideAmount = firstOutsideIndex / sampleCount;
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middleAmount = (insideAmount + outsideAmount) / 2;
        if (insideAt(middleAmount)) {
          insideAmount = middleAmount;
        } else {
          outsideAmount = middleAmount;
        }
      }
      trims[side].start = Math.max(
        trims[side].start,
        outsideAmount * segment.lengthM,
      );
      return;
    }

    let lastOutsideIndex = sampleCount - 1;
    while (lastOutsideIndex >= 0 && samples[lastOutsideIndex]) {
      lastOutsideIndex -= 1;
    }
    if (
      lastOutsideIndex < 0 ||
      samples.slice(0, lastOutsideIndex).some(Boolean)
    ) {
      trims[side].end = Math.max(trims[side].end, segment.lengthM);
      return;
    }
    let outsideAmount = lastOutsideIndex / sampleCount;
    let insideAmount = (lastOutsideIndex + 1) / sampleCount;
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const middleAmount = (outsideAmount + insideAmount) / 2;
      if (insideAt(middleAmount)) {
        insideAmount = middleAmount;
      } else {
        outsideAmount = middleAmount;
      }
    }
    trims[side].end = Math.max(
      trims[side].end,
      (1 - outsideAmount) * segment.lengthM,
    );
  };

  // A clipped grade begins away from its authored ground endpoint. It cannot
  // share an elevated junction there, so only exact retained endpoints trim.
  for (const endpoint of retainedEndpointFrames(surface, segment)) {
    trimSameSurfaceCorner(endpoint);
    trimAtEndpoint(endpoint);
  }
  for (const side of [-1, 1] as const) {
    trimInsideConnectedCorridor(side);
  }

  const runs: ElevatedRoadEdgeRunPlacement[] = [];
  for (const side of [-1, 1] as const) {
    // A corridor cutback that consumes the authored chord also consumes its
    // virtual outside-miter extension. Letting the negative trim at the other
    // end revive that extension creates the detached parapet chips seen along
    // a shallow merge.
    if (
      trims[side].start >= segment.lengthM - 0.001 ||
      trims[side].end >= segment.lengthM - 0.001
    ) {
      continue;
    }
    const startTrimM = Math.max(
      -segment.lengthM,
      Math.min(segment.lengthM, trims[side].start),
    );
    const endTrimM = Math.min(
      segment.lengthM - startTrimM,
      trims[side].end,
    );
    const lengthM = segment.lengthM - startTrimM - endTrimM;
    // Sub-decimetre remnants at a merge mouth read as detached railing chips
    // and are too short to provide useful collision containment.
    if (lengthM < (trimmedInsideConnectedCorridor[side] ? 0.2 : 0.1)) continue;
    runs.push({
      surfaceId: surface.id,
      segmentIndex: segment.segmentIndex,
      side,
      centerAlongM: (startTrimM - endTrimM) / 2,
      lengthM,
      startTrimM,
      endTrimM,
    });
  }
  return runs;
}

/**
 * Collision twins for the parapet boxes built by `elevatedRoadLayer`.
 * Positions use the same pitched parent transform as the visible boxes,
 * including the small along-slope shift caused by the parapet's local-y
 * centre. Each edge run is split only for height-band locality; adjacent
 * chunks overlap in plan by the projected parapet height, so there are no
 * collision seams on a grade.
 */
export function elevatedRoadBarrierPlacements(
  surface: ElevatedRoadGeometrySurface,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  maxColliderLengthM = ELEVATED_ROAD_BARRIER_COLLIDER_MAX_LENGTH_M,
): readonly ElevatedRoadBarrierPlacement[] {
  const placements: ElevatedRoadBarrierPlacement[] = [];
  const maximumLengthM = Math.max(0.5, maxColliderLengthM);
  const parapetDepthM = elevatedRoadParapetDepthM(surface);

  for (const segment of elevatedRoadSegmentPlacements(surface)) {
    const authoredStart = surface.centerline[segment.segmentIndex];
    const authoredEnd = surface.centerline[segment.segmentIndex + 1];
    if (!authoredStart || !authoredEnd) continue;
    const planDx = authoredEnd.x - authoredStart.x;
    const planDz = authoredEnd.z - authoredStart.z;
    const planLengthM = Math.hypot(planDx, planDz);
    if (planLengthM < 0.001) continue;
    const ux = planDx / planLengthM;
    const uz = planDz / planLengthM;
    // The render box's local +z side after its Babylon yaw.
    const positiveSideX = -uz;
    const positiveSideZ = ux;
    const sinSlope = Math.sin(segment.slopeRad);
    const cosSlope = Math.cos(segment.slopeRad);
    const parapetCenterLocalY =
      ELEVATED_ROAD_PARAPET_HEIGHT_M / 2 +
      ELEVATED_ROAD_PARAPET_BASE_LIFT_M;
    const lateralOffsetM =
      segment.deckWidthM / 2 - ELEVATED_ROAD_PARAPET_DECK_INSET_M;
    const edgeRuns = elevatedRoadEdgeRuns(surface, segment, allSurfaces);

    for (const [runIndex, run] of edgeRuns.entries()) {
      const chunkCount = Math.max(
        1,
        Math.ceil(run.lengthM / maximumLengthM),
      );
      const chunkLengthM = run.lengthM / chunkCount;
      const runStartAlongM = run.centerAlongM - run.lengthM / 2;
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const chunkStartAlongM = runStartAlongM + chunkIndex * chunkLengthM;
        const chunkEndAlongM = chunkStartAlongM + chunkLengthM;
        const centerAlongM =
          (chunkStartAlongM + chunkEndAlongM) / 2;
        // Rotation about local Z maps x' = cos*x - sin*y in plan. Mirroring
        // that term keeps the collision box centred under the visible box.
        const centerAlongPlanM =
          cosSlope * centerAlongM - sinSlope * parapetCenterLocalY;
        const x =
          segment.center.x +
          ux * centerAlongPlanM +
          positiveSideX * run.side * lateralOffsetM;
        const z =
          segment.center.z +
          uz * centerAlongPlanM +
          positiveSideZ * run.side * lateralOffsetM;
        const startRoadElevationM =
          (segment.center.elevationM ?? 0) +
          sinSlope * chunkStartAlongM;
        const endRoadElevationM =
          (segment.center.elevationM ?? 0) + sinSlope * chunkEndAlongM;

        placements.push({
          id: `elevated-road-${surface.id}-segment-${segment.segmentIndex}-parapet-${run.side}-${runIndex}-collider-${chunkIndex}`,
          surfaceId: surface.id,
          segmentIndex: segment.segmentIndex,
          runIndex,
          chunkIndex,
          side: run.side,
          x,
          z,
          ux,
          uz,
          // A pitched box's y extent projects onto its along-road x/z
          // footprint. Include that exact projection instead of leaving a
          // hairline gap between the visible parapet and its collider.
          halfU:
            (chunkLengthM * cosSlope +
              ELEVATED_ROAD_PARAPET_HEIGHT_M * Math.abs(sinSlope)) /
            2,
          halfV: parapetDepthM / 2,
          centerAlongM,
          lengthM: chunkLengthM,
          minElevationM:
            Math.min(startRoadElevationM, endRoadElevationM) -
            ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
          maxElevationM:
            Math.max(startRoadElevationM, endRoadElevationM) +
            ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
        });
      }
    }
  }

  return placements;
}

interface ElevatedRoadDeckHeadroomFrame {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly centerElevationM: number;
  readonly ux: number;
  readonly uz: number;
  readonly cosSlope: number;
  readonly tanSlope: number;
  readonly deckStartM: number;
  readonly deckEndM: number;
  readonly deckHalfWidthM: number;
}

interface ElevatedRoadSurfaceClearanceFrame {
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly startX: number;
  readonly startZ: number;
  readonly startElevationM: number;
  readonly endElevationM: number;
  readonly ux: number;
  readonly uz: number;
  readonly lengthM: number;
  readonly halfWidthM: number;
}

interface ElevatedRoadClearanceFrameBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const ELEVATED_ROAD_CLEARANCE_CELL_SIZE_M = 32;
const ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M = 1e-9;
const ELEVATED_ROAD_CLEARANCE_MAX_FRAME_CELLS = 256;
const EMPTY_ELEVATED_ROAD_CLEARANCE_INDICES: readonly number[] = [];

/**
 * Conservative immutable broadphase for the hot ground-clearance queries.
 *
 * Every exact frame is inserted into every grid cell touched by its AABB.
 * Querying the footprint's own AABB can therefore add false positives, but
 * never omit a frame whose oriented rectangle/circle reaches the footprint.
 * Candidate indices are sorted back into authored order so equal-height ties
 * keep the same deterministic winner as the former complete linear scan.
 */
function createElevatedRoadClearanceFrameIndex(
  bounds: readonly ElevatedRoadClearanceFrameBounds[],
): (
  point: { readonly x: number; readonly z: number },
  footprintRadiusM: number,
) => readonly number[] {
  const cells = new Map<string, number[]>();
  const allIndices = bounds.map((_, index) => index);
  const alwaysScanIndices: number[] = [];
  const cellCoordinate = (value: number): number =>
    Math.floor(value / ELEVATED_ROAD_CLEARANCE_CELL_SIZE_M);
  for (const [index, box] of bounds.entries()) {
    const minCellX = cellCoordinate(
      box.minX - ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const maxCellX = cellCoordinate(
      box.maxX + ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const minCellZ = cellCoordinate(
      box.minZ - ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const maxCellZ = cellCoordinate(
      box.maxZ + ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    if (
      !Number.isSafeInteger(minCellX) ||
      !Number.isSafeInteger(maxCellX) ||
      !Number.isSafeInteger(minCellZ) ||
      !Number.isSafeInteger(maxCellZ)
    ) {
      alwaysScanIndices.push(index);
      continue;
    }
    const occupiedCellCount =
      (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
    if (
      !Number.isSafeInteger(occupiedCellCount) ||
      occupiedCellCount < 1 ||
      occupiedCellCount > ELEVATED_ROAD_CLEARANCE_MAX_FRAME_CELLS
    ) {
      alwaysScanIndices.push(index);
      continue;
    }
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const key = `${cellX}:${cellZ}`;
        const existing = cells.get(key);
        if (existing) existing.push(index);
        else cells.set(key, [index]);
      }
    }
  }

  return (point, footprintRadiusM) => {
    const radiusM = Math.max(0, footprintRadiusM);
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.z) ||
      !Number.isFinite(radiusM)
    ) {
      return allIndices;
    }
    const minCellX = cellCoordinate(
      point.x - radiusM - ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const maxCellX = cellCoordinate(
      point.x + radiusM + ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const minCellZ = cellCoordinate(
      point.z - radiusM - ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    const maxCellZ = cellCoordinate(
      point.z + radiusM + ELEVATED_ROAD_CLEARANCE_CELL_PADDING_M,
    );
    if (
      !Number.isSafeInteger(minCellX) ||
      !Number.isSafeInteger(maxCellX) ||
      !Number.isSafeInteger(minCellZ) ||
      !Number.isSafeInteger(maxCellZ)
    ) {
      return allIndices;
    }
    const queriedCellCount =
      (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
    // Very large placement envelopes are cheaper as the original exact scan
    // than as a walk across thousands of empty world cells.
    if (
      !Number.isSafeInteger(queriedCellCount) ||
      queriedCellCount >= Math.max(1, bounds.length)
    ) return allIndices;

    if (
      queriedCellCount === 1 &&
      alwaysScanIndices.length === 0
    ) {
      return cells.get(`${minCellX}:${minCellZ}`) ??
        EMPTY_ELEVATED_ROAD_CLEARANCE_INDICES;
    }

    const candidateIndices = new Set<number>(alwaysScanIndices);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const bucket = cells.get(`${cellX}:${cellZ}`);
        if (!bucket) continue;
        for (const index of bucket) candidateIndices.add(index);
      }
    }
    return [...candidateIndices].sort((left, right) => left - right);
  };
}

type ElevatedRoadSurfaceClearanceQuery = (
  point: { readonly x: number; readonly z: number },
  groundElevationM?: number,
  footprintRadiusM?: number,
  excludedSurfaceIds?: ReadonlySet<string>,
  minimumVerticalSeparationM?: number,
) => ElevatedRoadGroundClearance | null;

/**
 * Full pitched-asphalt footprint, including the 0→0.65 m ramp apron that is
 * intentionally too low for a rendered concrete slab or parapet. This query
 * is separate from structural headroom so a high viaduct remains walkable
 * below while a shin-height ramp surface can never cut through a person.
 */
function createElevatedRoadSurfaceClearanceQuery(
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
): ElevatedRoadSurfaceClearanceQuery {
  const frames: ElevatedRoadSurfaceClearanceFrame[] = [];
  for (const surface of allSurfaces) {
    if (!isElevatedRoadSurface(surface)) continue;
    for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
      const start = surface.centerline[index];
      const end = surface.centerline[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthM = Math.hypot(dx, dz);
      if (lengthM < 0.001) continue;
      frames.push({
        surfaceId: surface.id,
        segmentIndex: index,
        startX: start.x,
        startZ: start.z,
        startElevationM: start.elevationM ?? 0,
        endElevationM: end.elevationM ?? 0,
        ux: dx / lengthM,
        uz: dz / lengthM,
        lengthM,
        halfWidthM: surface.widthM / 2,
      });
    }
  }
  const framesAt = createElevatedRoadClearanceFrameIndex(
    frames.map((frame) => {
      const endX = frame.startX + frame.ux * frame.lengthM;
      const endZ = frame.startZ + frame.uz * frame.lengthM;
      const lateralExtentX = Math.abs(frame.uz) * frame.halfWidthM;
      const lateralExtentZ = Math.abs(frame.ux) * frame.halfWidthM;
      return {
        minX: Math.min(frame.startX, endX) - lateralExtentX,
        maxX: Math.max(frame.startX, endX) + lateralExtentX,
        minZ: Math.min(frame.startZ, endZ) - lateralExtentZ,
        maxZ: Math.max(frame.startZ, endZ) + lateralExtentZ,
      };
    }),
  );

  return (
    point,
    groundElevationM = 0,
    footprintRadiusM = 0,
    excludedSurfaceIds,
    minimumVerticalSeparationM = 0,
  ) => {
    const radiusM = Math.max(0, footprintRadiusM);
    const minimumSeparationM = Math.max(0, minimumVerticalSeparationM);
    let lowest: ElevatedRoadGroundClearance | null = null;
    for (const frameIndex of framesAt(point, radiusM)) {
      const frame = frames[frameIndex];
      if (excludedSurfaceIds?.has(frame.surfaceId)) continue;
      const offsetX = point.x - frame.startX;
      const offsetZ = point.z - frame.startZ;
      const alongM = offsetX * frame.ux + offsetZ * frame.uz;
      const lateralM = -offsetX * frame.uz + offsetZ * frame.ux;
      const nearestAlongM = Math.max(0, Math.min(frame.lengthM, alongM));
      const nearestLateralM = Math.max(
        -frame.halfWidthM,
        Math.min(frame.halfWidthM, lateralM),
      );
      if (
        Math.hypot(
          alongM - nearestAlongM,
          lateralM - nearestLateralM,
        ) > radiusM
      ) {
        continue;
      }
      const amount = nearestAlongM / frame.lengthM;
      const roadSurfaceElevationM =
        frame.startElevationM +
        (frame.endElevationM - frame.startElevationM) * amount;
      const clearanceM = roadSurfaceElevationM - groundElevationM;
      // A shared at-grade endpoint is ordinary street, not an obstruction.
      if (clearanceM <= Math.max(0.01, minimumSeparationM)) continue;
      const sample: ElevatedRoadGroundClearance = {
        surfaceId: frame.surfaceId,
        segmentIndex: frame.segmentIndex,
        obstructionKind: "raised_surface",
        roadSurfaceElevationM,
        clearanceM,
      };
      if (!lowest || sample.clearanceM < lowest.clearanceM) lowest = sample;
    }
    return lowest;
  };
}

/**
 * Prepares the low-deck/headroom query once for hot callers such as crowd
 * walking. Segment clipping, junction deck runs, and frame transforms are
 * immutable map geometry, so recomputing them per walker per fixed step
 * would be pure waste.
 */
export function createElevatedRoadDeckHeadroomQuery(
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
): ElevatedRoadDeckHeadroomQuery {
  const frames: ElevatedRoadDeckHeadroomFrame[] = [];
  const piers = allSurfaces.flatMap((surface) =>
    elevatedRoadPierPlacements(surface, allSurfaces),
  );

  for (const surface of allSurfaces) {
    for (const segment of elevatedRoadSegmentPlacements(surface)) {
      const deckRun = elevatedRoadDeckRun(surface, segment, allSurfaces);
      if (!deckRun) continue;
      const authoredStart = surface.centerline[segment.segmentIndex];
      const authoredEnd = surface.centerline[segment.segmentIndex + 1];
      if (!authoredStart || !authoredEnd) continue;
      const dx = authoredEnd.x - authoredStart.x;
      const dz = authoredEnd.z - authoredStart.z;
      const planLengthM = Math.hypot(dx, dz);
      if (planLengthM < 0.001) continue;
      const cosSlope = Math.cos(segment.slopeRad);
      if (cosSlope < 0.001) continue;
      frames.push({
        surfaceId: surface.id,
        segmentIndex: segment.segmentIndex,
        centerX: segment.center.x,
        centerZ: segment.center.z,
        centerElevationM: segment.center.elevationM ?? 0,
        ux: dx / planLengthM,
        uz: dz / planLengthM,
        cosSlope,
        tanSlope: Math.tan(segment.slopeRad),
        deckStartM: deckRun.centerAlongM - deckRun.lengthM / 2,
        deckEndM: deckRun.centerAlongM + deckRun.lengthM / 2,
        // A retained structural deck run carries the complete slab and its
        // overhang. Parapet/edge-run openings do not punch pedestrian-sized
        // holes in the slab's headroom footprint.
        deckHalfWidthM: segment.deckWidthM / 2,
      });
    }
  }
  const framesAt = createElevatedRoadClearanceFrameIndex(
    frames.map((frame) => {
      const startAlongPlanM = frame.deckStartM * frame.cosSlope;
      const endAlongPlanM = frame.deckEndM * frame.cosSlope;
      const startX = frame.centerX + frame.ux * startAlongPlanM;
      const startZ = frame.centerZ + frame.uz * startAlongPlanM;
      const endX = frame.centerX + frame.ux * endAlongPlanM;
      const endZ = frame.centerZ + frame.uz * endAlongPlanM;
      const lateralExtentX = Math.abs(frame.uz) * frame.deckHalfWidthM;
      const lateralExtentZ = Math.abs(frame.ux) * frame.deckHalfWidthM;
      return {
        minX: Math.min(startX, endX) - lateralExtentX,
        maxX: Math.max(startX, endX) + lateralExtentX,
        minZ: Math.min(startZ, endZ) - lateralExtentZ,
        maxZ: Math.max(startZ, endZ) + lateralExtentZ,
      };
    }),
  );
  const piersAt = createElevatedRoadClearanceFrameIndex(
    piers.map((pier) => ({
      minX: pier.position.x - ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
      maxX: pier.position.x + ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
      minZ: pier.position.z - ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
      maxZ: pier.position.z + ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
    })),
  );

  return (
    point,
    groundElevationM = 0,
    footprintRadiusM = 0,
    includeSupports = true,
    excludedSurfaceIds,
    minimumVerticalSeparationM = 0,
  ) => {
    let lowest: ElevatedRoadDeckHeadroom | null = null;
    const radiusM = Math.max(0, footprintRadiusM);
    const minimumSeparationM = Math.max(0, minimumVerticalSeparationM);
    for (const frameIndex of framesAt(point, radiusM)) {
      const frame = frames[frameIndex];
      if (excludedSurfaceIds?.has(frame.surfaceId)) continue;
      const offsetX = point.x - frame.centerX;
      const offsetZ = point.z - frame.centerZ;
      const alongPlanM = offsetX * frame.ux + offsetZ * frame.uz;
      // local +z is the left-hand normal (-uz, ux).
      const lateralM = -offsetX * frame.uz + offsetZ * frame.ux;
      // The top slab plane has local y=0, hence plan = cos(slope)*localX.
      const startAlongPlanM = frame.deckStartM * frame.cosSlope;
      const endAlongPlanM = frame.deckEndM * frame.cosSlope;
      const nearestAlongPlanM = Math.max(
        startAlongPlanM,
        Math.min(endAlongPlanM, alongPlanM),
      );
      const nearestLateralM = Math.max(
        -frame.deckHalfWidthM,
        Math.min(frame.deckHalfWidthM, lateralM),
      );
      if (
        Math.hypot(
          alongPlanM - nearestAlongPlanM,
          lateralM - nearestLateralM,
        ) > radiusM
      ) continue;
      const deckElevationM =
        frame.centerElevationM + frame.tanSlope * nearestAlongPlanM;
      // A slab of local thickness T has vertical thickness T/cos(slope).
      const soffitElevationM =
        deckElevationM -
        ELEVATED_ROAD_DECK_SLAB_THICKNESS_M / frame.cosSlope;
      // Headroom is an overhead query. The slab carrying an object already on
      // an elevated road sits below its tyres and must not mask a still-higher
      // deck at a stacked interchange. For a ground caller, though, a ramp
      // slab whose soffit intersects the ground is zero clearance, not absent.
      if (
        deckElevationM <=
        groundElevationM + Math.max(0.01, minimumSeparationM)
      ) continue;
      const sample = {
        surfaceId: frame.surfaceId,
        segmentIndex: frame.segmentIndex,
        structureKind: "deck" as const,
        deckElevationM,
        soffitElevationM,
        headroomM: Math.max(0, soffitElevationM - groundElevationM),
      };
      if (!lowest || sample.soffitElevationM < lowest.soffitElevationM) {
        lowest = sample;
      }
    }
    // A support is solid from its footing to the soffit. Treating it as
    // merely "lots of headroom beneath the deck" planted street furniture
    // inside columns and let pavement walkers pass through them. Inflate the
    // exact rendered footing by the caller's own footprint so every ground
    // object answers the same overlap question.
    if (!includeSupports) return lowest;
    for (const pierIndex of piersAt(point, radiusM)) {
      const pier = piers[pierIndex];
      if (excludedSurfaceIds?.has(pier.surfaceId)) continue;
      // The support rises only as far as its own deck. From that deck (or any
      // higher level) it is below the caller, not a column through the road.
      if (
        pier.elevationM <=
        groundElevationM + ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M
      ) {
        continue;
      }
      if (
        Math.hypot(point.x - pier.position.x, point.z - pier.position.z) >
        ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M + radiusM
      ) {
        continue;
      }
      const sample: ElevatedRoadDeckHeadroom = {
        surfaceId: pier.surfaceId,
        segmentIndex: -1,
        structureKind: "pier",
        supportIndex: pier.index,
        deckElevationM: pier.elevationM,
        soffitElevationM: groundElevationM,
        headroomM: 0,
      };
      if (!lowest || sample.soffitElevationM < lowest.soffitElevationM) {
        lowest = sample;
      }
    }
    return lowest;
  };
}

/**
 * Combines the complete raised-asphalt profile with exact slab/pier geometry.
 * Ground walkers use this rather than slab-only headroom: it closes the ramp
 * apron seam but still permits a person beneath a genuinely high viaduct.
 */
export function createElevatedRoadGroundClearanceQuery(
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
): ElevatedRoadGroundClearanceQuery {
  const raisedSurfaceAt = createElevatedRoadSurfaceClearanceQuery(allSurfaces);
  const deckHeadroomAt = createElevatedRoadDeckHeadroomQuery(allSurfaces);
  return (
    point,
    groundElevationM = 0,
    footprintRadiusM = 0,
    includeSupports = true,
    excludedSurfaceIds,
    minimumVerticalSeparationM = 0,
  ) => {
    const raised = raisedSurfaceAt(
      point,
      groundElevationM,
      footprintRadiusM,
      excludedSurfaceIds,
      minimumVerticalSeparationM,
    );
    const deck = deckHeadroomAt(
      point,
      groundElevationM,
      footprintRadiusM,
      includeSupports,
      excludedSurfaceIds,
      minimumVerticalSeparationM,
    );
    const structural: ElevatedRoadGroundClearance | null = deck
      ? {
          surfaceId: deck.surfaceId,
          segmentIndex: deck.segmentIndex,
          obstructionKind: deck.structureKind === "pier" ? "pier" : "deck",
          roadSurfaceElevationM: deck.deckElevationM,
          clearanceM: deck.headroomM,
        }
      : null;
    if (!raised) return structural;
    if (!structural) return raised;
    return structural.clearanceM <= raised.clearanceM ? structural : raised;
  };
}

/**
 * Convenience form for one-off placement checks. Hot callers should retain
 * `createElevatedRoadDeckHeadroomQuery(allSurfaces)` instead.
 */
export function elevatedRoadDeckHeadroomAt(
  point: { readonly x: number; readonly z: number },
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  groundElevationM = 0,
  footprintRadiusM = 0,
): ElevatedRoadDeckHeadroom | null {
  return createElevatedRoadDeckHeadroomQuery(allSurfaces)(
    point,
    groundElevationM,
    footprintRadiusM,
  );
}

const distanceToPolylineM = (
  point: GameCanvasPoint,
  centerline: readonly GameCanvasPoint[],
): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < centerline.length; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > Number.EPSILON
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    nearest = Math.min(
      nearest,
      Math.hypot(
        point.x - (start.x + dx * amount),
        point.z - (start.z + dz * amount),
      ),
    );
  }
  return nearest;
};

const pointAtDistance = (
  points: readonly GameCanvasPoint[],
  targetM: number,
): { readonly position: GameCanvasPoint; readonly boxYawRad: number } | null => {
  let travelledM = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM < 0.001) continue;
    if (targetM <= travelledM + lengthM || index + 2 === points.length) {
      const amount = Math.max(0, Math.min(1, (targetM - travelledM) / lengthM));
      return {
        position: {
          x: start.x + dx * amount,
          z: start.z + dz * amount,
          elevationM:
            (start.elevationM ?? 0) +
            ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
        },
        boxYawRad: Math.atan2(dx, dz) - Math.PI / 2,
      };
    }
    travelledM += lengthM;
  }
  return null;
};

/**
 * Hammerhead support rhythm for an elevated surface. Candidates are omitted
 * wherever a column would occupy another road, its pavement, or a lower deck;
 * this is what lets a viaduct pass over Cairo's existing streets without
 * deleting, blocking, or visibly clipping their pedestrian realm.
 */
export function elevatedRoadPierPlacements(
  surface: ElevatedRoadGeometrySurface,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  spacingM = 38,
): readonly ElevatedRoadPierPlacement[] {
  if (!isElevatedRoadSurface(surface) || surface.centerline.length < 2) return [];
  const totalLengthM = surface.centerline.slice(1).reduce(
    (total, point, index) =>
      total + Math.hypot(point.x - surface.centerline[index].x, point.z - surface.centerline[index].z),
    0,
  );
  if (totalLengthM < spacingM * 1.5) return [];
  const count = Math.max(1, Math.floor(totalLengthM / spacingM));
  const intervalM = totalLengthM / count;
  const placements: ElevatedRoadPierPlacement[] = [];
  for (let index = 1; index < count; index += 1) {
    const sampled = pointAtDistance(surface.centerline, index * intervalM);
    if (!sampled) continue;
    const elevationM = sampled.position.elevationM ?? 0;
    if (elevationM < 6.2) continue;
    const blocksAnotherRoad = allSurfaces.some(
      (other) => {
        if (other.id === surface.id) return false;
        const roadsideEnvelopeM = isElevatedRoadSurface(other)
          ? ELEVATED_ROAD_DECK_OVERHANG_M
          : Math.max(0, other.sidewalkWidthM ?? 2.2);
        return (
          distanceToPolylineM(sampled.position, other.centerline) <
          other.widthM / 2 +
            roadsideEnvelopeM +
            ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M +
            ELEVATED_ROAD_PIER_ROADSIDE_MARGIN_M
        );
      },
    );
    // A column rises through every level below its deck, so it must clear not
    // only streets at y=0 but crossing ramps and lower flyovers as well.
    if (blocksAnotherRoad) continue;
    placements.push({
      surfaceId: surface.id,
      index,
      position: sampled.position,
      elevationM,
      boxYawRad: sampled.boxYawRad,
      deckWidthM: surface.widthM + 1.4,
    });
  }
  return placements;
}
