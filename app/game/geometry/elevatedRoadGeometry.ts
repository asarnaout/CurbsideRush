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
  readonly startTrimM: number;
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
export const ELEVATED_ROAD_PARAPET_BASE_LIFT_M = 0.04;
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
    if (planLengthM < 0.5) continue;
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
 * Structural slab at an elevated merge. The wider mainline remains continuous;
 * a narrower branch ends exactly outside its edge and lets that mainline slab
 * carry the paved junction. Without this cut two rotated boxes overlap through
 * the mouth and expose their concrete side faces as long transverse fingers.
 */
export function elevatedRoadDeckRun(
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  deckOverhangM = ELEVATED_ROAD_DECK_OVERHANG_M,
): ElevatedRoadDeckRunPlacement | null {
  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  if (!authoredStart || !authoredEnd) return null;
  const authoredDx = authoredEnd.x - authoredStart.x;
  const authoredDz = authoredEnd.z - authoredStart.z;
  const authoredLengthM = Math.hypot(authoredDx, authoredDz);
  if (authoredLengthM < 0.001) return null;
  const positiveSideX = -authoredDz / authoredLengthM;
  const positiveSideZ = authoredDx / authoredLengthM;
  const currentHalfM = surface.widthM / 2 + deckOverhangM;
  const slopeScale = structuralMetresPerPlanMetre(segment);
  const trims = { start: 0, end: 0 };

  for (const endpoint of retainedEndpointFrames(surface, segment)) {
    for (const other of allSurfaces) {
      if (
        other.id === surface.id ||
        !isElevatedRoadSurface(other) ||
        other.widthM <= surface.widthM + 0.05
      ) {
        continue;
      }
      for (let pointIndex = 0; pointIndex < other.centerline.length; pointIndex += 1) {
        const otherPoint = other.centerline[pointIndex];
        if (!sameElevatedJunctionPoint(endpoint.point, otherPoint)) continue;
        for (const neighbourIndex of [pointIndex - 1, pointIndex + 1]) {
          const neighbour = other.centerline[neighbourIndex];
          if (!neighbour) continue;
          const otherDx = neighbour.x - otherPoint.x;
          const otherDz = neighbour.z - otherPoint.z;
          const otherLengthM = Math.hypot(otherDx, otherDz);
          if (otherLengthM < 0.001) continue;
          const otherNormalX = -otherDz / otherLengthM;
          const otherNormalZ = otherDx / otherLengthM;
          const crossingAmount = Math.abs(
            endpoint.outwardX * otherNormalX +
              endpoint.outwardZ * otherNormalZ,
          );
          // A collinear wider continuation should inherit the branch slab,
          // not erase it. Only an actual crossing/merge needs a cutback.
          if (crossingAmount < 0.12) continue;
          const cornerProjectionM =
            currentHalfM *
            Math.abs(
              positiveSideX * otherNormalX +
                positiveSideZ * otherNormalZ,
            );
          const otherHalfM = other.widthM / 2 + deckOverhangM;
          const trimM =
            ((otherHalfM + cornerProjectionM) / crossingAmount) * slopeScale;
          trims[endpoint.key] = Math.max(trims[endpoint.key], trimM);
        }
      }
    }
  }

  const startTrimM = Math.min(segment.lengthM, trims.start);
  const endTrimM = Math.min(segment.lengthM - startTrimM, trims.end);
  const coreLengthM = segment.lengthM - startTrimM - endTrimM;
  if (coreLengthM < 0.2) return null;
  // Ordinary span seams overlap by 17.5 cm at each end. A deliberately cut
  // junction end gets no overlap, otherwise the slab face would re-enter the
  // opening this calculation just cleared.
  const startExtensionM =
    startTrimM <= 0.001 &&
    !elevatedRoadEndpointHasStructuralContinuation(
      surface,
      segment,
      allSurfaces,
      "start",
    )
      ? 0.175
      : 0;
  const endExtensionM =
    endTrimM <= 0.001 &&
    !elevatedRoadEndpointHasStructuralContinuation(
      surface,
      segment,
      allSurfaces,
      "end",
    )
      ? 0.175
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
  junctionMarginM = 0.8,
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
      // Positive is the inside corner: stop at the true miter plus the usual
      // junction breathing room instead of letting a square parapet end
      // project into the next road segment. A negative intersection is the
      // virtual miter beyond the authored endpoint on the outside corner.
      // Extending the run to it would put structure beyond its slab; retreat
      // by the same distance instead. That non-negative relief also keeps a
      // long vehicle's leading/trailing capsule clear while it changes
      // heading across the sharp bend.
      const cornerReliefPlanM =
        intersectionPlanM > 0
          ? intersectionPlanM + junctionMarginM
          : -intersectionPlanM;
      trims[side][endpoint.key] = Math.max(
        trims[side][endpoint.key],
        cornerReliefPlanM * slopeScale,
      );
    }
  };

  const trimAtEndpoint = (
    endpoint: ElevatedEndpointFrame,
  ): void => {
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

  // A clipped grade begins away from its authored ground endpoint. It cannot
  // share an elevated junction there, so only exact retained endpoints trim.
  for (const endpoint of retainedEndpointFrames(surface, segment)) {
    trimSameSurfaceCorner(endpoint);
    trimAtEndpoint(endpoint);
  }

  const runs: ElevatedRoadEdgeRunPlacement[] = [];
  for (const side of [-1, 1] as const) {
    const startTrimM = Math.min(segment.lengthM, trims[side].start);
    const endTrimM = Math.min(
      segment.lengthM - startTrimM,
      trims[side].end,
    );
    const lengthM = segment.lengthM - startTrimM - endTrimM;
    if (lengthM < 0.35) continue;
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
    for (const frame of frames) {
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
    for (const frame of frames) {
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
    for (const pier of piers) {
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
