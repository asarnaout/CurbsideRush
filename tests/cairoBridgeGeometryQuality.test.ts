import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import {
  ELEVATED_DECK_START_M,
  ELEVATED_ROAD_DECK_OVERHANG_M,
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
  ELEVATED_ROAD_PARAPET_DECK_INSET_M,
  ELEVATED_ROAD_PARAPET_DEPTH_M,
  createElevatedRoadDeckHeadroomQuery,
  elevatedRoadDeckRun,
  elevatedRoadEdgeRuns,
  elevatedRoadSegmentPlacements,
  type ElevatedRoadEdgeRunPlacement,
  type ElevatedRoadGeometrySurface,
  type ElevatedRoadSegmentPlacement,
} from "../app/game/geometry/elevatedRoadGeometry";
import { isElevatedRoadSurface } from "../app/game/roadElevation";

const SIXTH_OCTOBER_PREFIX = "cairo-sixth-october";
const MAXIMUM_CHORD_HEADING_CHANGE_DEG = 12;
const MINIMUM_LOCAL_CURVE_RADIUS_M = 14;
// Dense Cairo fabric needs one short 10.5% touchdown after the Corniche
// structure has cleared live traffic; every other rebuilt grade stays lower.
const MAXIMUM_RAMP_GRADE = 0.105;
const MAXIMUM_ROAD_HANDOFF_DEG = 22;
const MAXIMUM_EDGE_ENDPOINT_GAP_M = 0.15;
const NON_DEGENERATE_CHORD_M = 0.001;
const SHARED_JUNCTION_TOLERANCE_M = 0.05;
const GEZIRA_LOW_APPROACH_TOP_M = 6.2;
const MINIMUM_SEPARATE_DECK_PLAN_GAP_M = 0.4;
const MINIMUM_BUILDING_FACADE_GUARD_M = 0.75;

const EXISTING_ELEVATED_SURFACE_IDS = [
  "cairo-sixth-october-bridge",
  "cairo-sixth-october-bridge-west-entry",
  "cairo-sixth-october-bridge-west-ramp",
  "cairo-sixth-october-bridge-west-exit",
  "cairo-sixth-october-bridge-east-entry",
  "cairo-sixth-october-bridge-east-ramp",
  "cairo-sixth-october-bridge-east-exit",
  "cairo-sixth-october-bridge-dokki-entry",
  "cairo-sixth-october-bridge-dokki-ramp",
  "cairo-sixth-october-bridge-dokki-exit",
  "cairo-sixth-october-bridge-gezira-entry",
  "cairo-sixth-october-bridge-gezira-ramp",
  "cairo-sixth-october-bridge-gezira-exit",
  "cairo-sixth-october-bridge-corniche-entry",
  "cairo-sixth-october-bridge-corniche-exit",
  "cairo-sixth-october-bridge-ramses-entry",
  "cairo-sixth-october-bridge-ramses-ramp",
  "cairo-sixth-october-bridge-ramses-exit",
] as const;

const allElevatedSurfaces = CAIRO_MAP_PACK.geometry.roadSurfaces.filter(
  isElevatedRoadSurface,
);
const sixthOctoberElevatedSurfaces = allElevatedSurfaces.filter((surface) =>
  surface.id.startsWith(SIXTH_OCTOBER_PREFIX),
);

const sameElevatedJunctionPoint = (
  left: { readonly x: number; readonly z: number; readonly elevationM?: number },
  right: { readonly x: number; readonly z: number; readonly elevationM?: number },
): boolean =>
  Math.hypot(left.x - right.x, left.z - right.z) <
    SHARED_JUNCTION_TOLERANCE_M &&
  Math.abs((left.elevationM ?? 0) - (right.elevationM ?? 0)) <
    SHARED_JUNCTION_TOLERANCE_M;

const isCrossSurfaceMergeMouth = (
  surface: ElevatedRoadGeometrySurface,
  point: { readonly x: number; readonly z: number; readonly elevationM?: number },
): boolean =>
  allElevatedSurfaces.some(
    (other) =>
      other.id !== surface.id &&
      other.centerline.some((candidate) =>
        sameElevatedJunctionPoint(point, candidate),
      ),
  );

const isInsideCrossSurfaceMergeThroat = (
  surface: ElevatedRoadGeometrySurface,
  pointIndex: number,
): boolean =>
  [pointIndex - 1, pointIndex, pointIndex + 1].some((candidateIndex) => {
    const candidate = surface.centerline[candidateIndex];
    return candidate
      ? isCrossSurfaceMergeMouth(surface, candidate)
      : false;
  });

const pointInsideSurfaceCorridorAtElevation = (
  candidate: { readonly x: number; readonly z: number },
  elevationM: number,
  carrier: ElevatedRoadGeometrySurface,
  halfWidthM: number,
  elevationToleranceM = 0.35,
): boolean =>
  carrier.centerline.slice(1).some((end, index) => {
    const start = carrier.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((candidate.x - start.x) * dx +
                (candidate.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const nearestX = start.x + dx * amount;
    const nearestZ = start.z + dz * amount;
    const carrierElevationM =
      (start.elevationM ?? 0) +
      ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
    return (
      Math.hypot(candidate.x - nearestX, candidate.z - nearestZ) <=
        halfWidthM + 1e-6 &&
      Math.abs(elevationM - carrierElevationM) <=
        elevationToleranceM + 1e-6
    );
  });

const surfaceEndpointJoins = (
  surface: ElevatedRoadGeometrySurface,
  other: ElevatedRoadGeometrySurface,
): boolean => {
  const endpoints = [surface.centerline[0], surface.centerline.at(-1)!];
  return endpoints.some((endpoint) =>
    other.centerline.some((point) =>
      sameElevatedJunctionPoint(endpoint, point),
    ),
  );
};

const connectedMergeCorridors = (
  surface: ElevatedRoadGeometrySurface,
): readonly ElevatedRoadGeometrySurface[] =>
  allElevatedSurfaces.filter((other) => {
    if (other.id === surface.id) return false;

    // A narrow branch may enter a wider carrier at an internal sampled point,
    // while the branch itself meets that carrier at one of its endpoints.
    if (other.widthM < surface.widthM - 0.05) {
      return surfaceEndpointJoins(other, surface);
    }
    if (other.widthM > surface.widthM + 0.05) {
      return surfaceEndpointJoins(surface, other);
    }

    // Paired one-way branches share a terminal throat only when they also
    // feed the same wider carrier. Ordinary equal-width crossings must never
    // excuse a missing barrier.
    const sharedEndpoint = [surface.centerline[0], surface.centerline.at(-1)!]
      .find((endpoint) =>
        [other.centerline[0], other.centerline.at(-1)!].some((point) =>
          sameElevatedJunctionPoint(endpoint, point),
        ),
      );
    if (!sharedEndpoint) return false;
    return allElevatedSurfaces.some(
      (carrier) =>
        carrier.id !== surface.id &&
        carrier.id !== other.id &&
        carrier.widthM > Math.max(surface.widthM, other.widthM) + 0.05 &&
        carrier.centerline.some((point) =>
          sameElevatedJunctionPoint(sharedEndpoint, point),
        ),
    );
  });

const isIntentionalConnectedMergeOpening = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  side: -1 | 1,
): boolean => {
  const connectedCorridors = connectedMergeCorridors(surface);
  if (connectedCorridors.length === 0) return false;

  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  const dx = authoredEnd.x - authoredStart.x;
  const dz = authoredEnd.z - authoredStart.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM < NON_DEGENERATE_CHORD_M) return false;
  const positiveSideX = -dz / lengthM;
  const positiveSideZ = dx / lengthM;
  const edgeOffsetM =
    surface.widthM / 2 +
    ELEVATED_ROAD_DECK_OVERHANG_M -
    ELEVATED_ROAD_PARAPET_DECK_INSET_M;
  const parapetHalfDepthM =
    (surface.parapetDepthM ?? ELEVATED_ROAD_PARAPET_DEPTH_M) / 2;
  const riseM = Math.abs(
    (authoredEnd.elevationM ?? 0) - (authoredStart.elevationM ?? 0),
  );

  // Production samples the complete chord because a curved merge can enter
  // and leave a connected road between endpoints. Mirror that physical test
  // here so only a rail replaced by adjoining pavement is exempted.
  return Array.from({ length: 9 }, (_, index) => index / 8).some((amount) => {
    const edgePoint = {
      x:
        authoredStart.x +
        dx * amount +
        side * positiveSideX * edgeOffsetM,
      z:
        authoredStart.z +
        dz * amount +
        side * positiveSideZ * edgeOffsetM,
    };
    const elevationM =
      (authoredStart.elevationM ?? 0) +
      ((authoredEnd.elevationM ?? 0) -
        (authoredStart.elevationM ?? 0)) *
        amount;
    return connectedCorridors.some((corridor) =>
      pointInsideSurfaceCorridorAtElevation(
        edgePoint,
        elevationM,
        corridor,
        corridor.widthM / 2 + 0.05 + parapetHalfDepthM + 0.2,
        0.35 + riseM,
      ),
    );
  });
};

const edgeRunEndpoint = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  run: ElevatedRoadEdgeRunPlacement,
  endpoint: "start" | "end",
): { readonly x: number; readonly z: number } => {
  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  const dx = authoredEnd.x - authoredStart.x;
  const dz = authoredEnd.z - authoredStart.z;
  const planLengthM = Math.hypot(dx, dz);
  const ux = dx / planLengthM;
  const uz = dz / planLengthM;
  const positiveSideX = -uz;
  const positiveSideZ = ux;
  const alongStructureM =
    run.centerAlongM +
    (endpoint === "start" ? -run.lengthM / 2 : run.lengthM / 2);
  const alongPlanM = Math.cos(segment.slopeRad) * alongStructureM;
  const lateralOffsetM =
    segment.deckWidthM / 2 - ELEVATED_ROAD_PARAPET_DECK_INSET_M;

  return {
    x:
      segment.center.x +
      ux * alongPlanM +
      positiveSideX * run.side * lateralOffsetM,
    z:
      segment.center.z +
      uz * alongPlanM +
      positiveSideZ * run.side * lateralOffsetM,
  };
};

interface PlanObb {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfLengthM: number;
  readonly halfWidthM: number;
}

const planObbForSegment = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
): PlanObb => {
  const start = surface.centerline[segment.segmentIndex];
  const end = surface.centerline[segment.segmentIndex + 1];
  const planLengthM = Math.hypot(end.x - start.x, end.z - start.z);
  const ux = (end.x - start.x) / planLengthM;
  const uz = (end.z - start.z) / planLengthM;
  const run = elevatedRoadDeckRun(surface, segment, allElevatedSurfaces);
  const structureToPlan = Math.cos(segment.slopeRad);
  const centerAlongPlanM = (run?.centerAlongM ?? 0) * structureToPlan;
  return {
    x: segment.center.x + ux * centerAlongPlanM,
    z: segment.center.z + uz * centerAlongPlanM,
    ux,
    uz,
    // Use the exact production deck run, including junction laps and outside
    // miters, so the regression never substitutes a friendlier centerline
    // rectangle for the visible structure.
    halfLengthM:
      ((run?.lengthM ?? segment.lengthM) * structureToPlan) / 2,
    halfWidthM: segment.deckWidthM / 2,
  };
};

/** Positive means two complete deck OBBs are separated on at least one axis. */
const planObbSeparatingGapM = (left: PlanObb, right: PlanObb): number => {
  const deltaX = right.x - left.x;
  const deltaZ = right.z - left.z;
  const axes = [
    { x: left.ux, z: left.uz },
    { x: -left.uz, z: left.ux },
    { x: right.ux, z: right.uz },
    { x: -right.uz, z: right.ux },
  ];
  return Math.max(
    ...axes.map((axis) => {
      const leftRadiusM =
        left.halfLengthM * Math.abs(left.ux * axis.x + left.uz * axis.z) +
        left.halfWidthM * Math.abs(-left.uz * axis.x + left.ux * axis.z);
      const rightRadiusM =
        right.halfLengthM * Math.abs(right.ux * axis.x + right.uz * axis.z) +
        right.halfWidthM * Math.abs(-right.uz * axis.x + right.ux * axis.z);
      return Math.abs(deltaX * axis.x + deltaZ * axis.z) -
        leftRadiusM -
        rightRadiusM;
    }),
  );
};

describe("Cairo Sixth October Bridge geometry quality", () => {
  it("keeps the established elevated surface identities in the quality sweep", () => {
    const actualIds = new Set(
      sixthOctoberElevatedSurfaces.map((surface) => surface.id),
    );

    for (const id of EXISTING_ELEVATED_SURFACE_IDS) {
      expect(actualIds.has(id), id).toBe(true);
    }
  });

  it("seats the barrier shells directly on the structural deck", () => {
    expect(ELEVATED_ROAD_PARAPET_BASE_LIFT_M).toBe(0);
  });

  it("samples every elevated road bend at no more than twelve degrees per chord", () => {
    const violations: string[] = [];

    for (const surface of sixthOctoberElevatedSurfaces) {
      const chords: Array<{
        readonly endPointIndex: number;
        readonly ux: number;
        readonly uz: number;
      }> = [];

      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM <= NON_DEGENERATE_CHORD_M) continue;
        chords.push({
          endPointIndex: index,
          ux: dx / lengthM,
          uz: dz / lengthM,
        });
      }

      for (let index = 1; index < chords.length; index += 1) {
        const incoming = chords[index - 1];
        const outgoing = chords[index];
        const dot = Math.max(
          -1,
          Math.min(1, incoming.ux * outgoing.ux + incoming.uz * outgoing.uz),
        );
        const headingChangeDeg = (Math.acos(dot) * 180) / Math.PI;
        if (headingChangeDeg > MAXIMUM_CHORD_HEADING_CHANGE_DEG + 1e-9) {
          violations.push(
            `${surface.id} near point ${incoming.endPointIndex}: ${headingChangeDeg.toFixed(2)}deg`,
          );
        }
      }
    }

    expect(
      violations,
      `Every sampled bridge chord must change heading by at most ${MAXIMUM_CHORD_HEADING_CHANGE_DEG}deg`,
    ).toEqual([]);
  });

  it("keeps bridge curves broad, grades civil, and legal handoffs tangent", () => {
    const violations: string[] = [];

    for (const surface of sixthOctoberElevatedSurfaces) {
      for (let index = 1; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const middle = surface.centerline[index];
        const end = surface.centerline[index + 1];
        const firstM = Math.hypot(middle.x - start.x, middle.z - start.z);
        const secondM = Math.hypot(end.x - middle.x, end.z - middle.z);
        const diagonalM = Math.hypot(end.x - start.x, end.z - start.z);
        const twiceAreaM2 = Math.abs(
          (middle.x - start.x) * (end.z - start.z) -
            (middle.z - start.z) * (end.x - start.x),
        );
        if (twiceAreaM2 > 0.0001) {
          const radiusM =
            (firstM * secondM * diagonalM) / (2 * twiceAreaM2);
          if (radiusM < MINIMUM_LOCAL_CURVE_RADIUS_M - 1e-6) {
            violations.push(
              `${surface.id} point ${index}: ${radiusM.toFixed(2)}m radius`,
            );
          }
        }
      }
      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const planLengthM = Math.hypot(end.x - start.x, end.z - start.z);
        if (planLengthM <= NON_DEGENERATE_CHORD_M) continue;
        const grade =
          Math.abs((end.elevationM ?? 0) - (start.elevationM ?? 0)) /
          planLengthM;
        if (grade > MAXIMUM_RAMP_GRADE + 1e-9) {
          violations.push(
            `${surface.id} segment ${index - 1}: ${(grade * 100).toFixed(2)}% grade`,
          );
        }
      }
    }

    const laneById = new Map(
      CAIRO_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
    );
    const endpointDirection = (
      points: readonly { readonly x: number; readonly z: number }[],
      atEnd: boolean,
    ): { readonly x: number; readonly z: number } | null => {
      for (
        let index = atEnd ? points.length - 1 : 1;
        atEnd ? index > 0 : index < points.length;
        index += atEnd ? -1 : 1
      ) {
        const start = points[index - 1];
        const end = points[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM > NON_DEGENERATE_CHORD_M) {
          return { x: dx / lengthM, z: dz / lengthM };
        }
      }
      return null;
    };
    for (const lane of CAIRO_MAP_PACK.laneGraph.lanes) {
      const fromBridge = lane.roadId.startsWith(SIXTH_OCTOBER_PREFIX);
      const incoming = endpointDirection(lane.centerline, true);
      if (!incoming) continue;
      for (const successorId of lane.successors) {
        const successor = laneById.get(successorId);
        if (
          !successor ||
          successor.roadId === lane.roadId ||
          (!fromBridge &&
            !successor.roadId.startsWith(SIXTH_OCTOBER_PREFIX))
        ) {
          continue;
        }
        const outgoing = endpointDirection(successor.centerline, false);
        if (!outgoing) continue;
        const dot = Math.max(
          -1,
          Math.min(1, incoming.x * outgoing.x + incoming.z * outgoing.z),
        );
        const handoffDeg = (Math.acos(dot) * 180) / Math.PI;
        if (handoffDeg > MAXIMUM_ROAD_HANDOFF_DEG + 1e-9) {
          violations.push(
            `${lane.roadId} -> ${successor.roadId}: ${handoffDeg.toFixed(2)}deg handoff`,
          );
        }
      }
    }

    expect(
      violations,
      `Bridge geometry needs >=${MINIMUM_LOCAL_CURVE_RADIUS_M}m radii, <=${MAXIMUM_RAMP_GRADE * 100}% grades, and <=${MAXIMUM_ROAD_HANDOFF_DEG}deg legal handoffs`,
    ).toEqual([]);
  });

  it("keeps both barrier edges continuous through same-surface internal bends", () => {
    const violations: string[] = [];
    let checkedSideCount = 0;

    for (const surface of sixthOctoberElevatedSurfaces) {
      const segments = elevatedRoadSegmentPlacements(surface);
      const segmentByIndex = new Map(
        segments.map((segment) => [segment.segmentIndex, segment]),
      );

      for (
        let pointIndex = 1;
        pointIndex + 1 < surface.centerline.length;
        pointIndex += 1
      ) {
        const point = surface.centerline[pointIndex];
        if ((point.elevationM ?? 0) < ELEVATED_DECK_START_M) continue;

        // Cross-surface mouths deliberately open one or both parapets for a
        // joining carriageway. This contract covers only the ordinary bends
        // within one continuous surface, where no drive-through gap belongs.
        if (isInsideCrossSurfaceMergeThroat(surface, pointIndex)) continue;

        const incoming = segmentByIndex.get(pointIndex - 1);
        const outgoing = segmentByIndex.get(pointIndex);
        if (!incoming || !outgoing) {
          violations.push(
            `${surface.id} point ${pointIndex}: missing structural segment beside an internal elevated point`,
          );
          continue;
        }

        const incomingRuns = elevatedRoadEdgeRuns(
          surface,
          incoming,
          allElevatedSurfaces,
        );
        const outgoingRuns = elevatedRoadEdgeRuns(
          surface,
          outgoing,
          allElevatedSurfaces,
        );

        for (const side of [-1, 1] as const) {
          if (
            isIntentionalConnectedMergeOpening(surface, incoming, side) ||
            isIntentionalConnectedMergeOpening(surface, outgoing, side)
          ) {
            continue;
          }
          checkedSideCount += 1;
          const incomingRun = incomingRuns.find((run) => run.side === side);
          const outgoingRun = outgoingRuns.find((run) => run.side === side);
          if (!incomingRun || !outgoingRun) {
            violations.push(
              `${surface.id} point ${pointIndex} side ${side}: missing edge run`,
            );
            continue;
          }

          const incomingEnd = edgeRunEndpoint(
            surface,
            incoming,
            incomingRun,
            "end",
          );
          const outgoingStart = edgeRunEndpoint(
            surface,
            outgoing,
            outgoingRun,
            "start",
          );
          const gapM = Math.hypot(
            incomingEnd.x - outgoingStart.x,
            incomingEnd.z - outgoingStart.z,
          );
          if (gapM > MAXIMUM_EDGE_ENDPOINT_GAP_M + 1e-9) {
            violations.push(
              `${surface.id} point ${pointIndex} side ${side}: ${gapM.toFixed(3)}m gap`,
            );
          }
        }
      }
    }

    expect(checkedSideCount).toBeGreaterThan(0);
    expect(
      violations,
      `Ordinary same-surface parapet endpoints must meet within ${MAXIMUM_EDGE_ENDPOINT_GAP_M}m`,
    ).toEqual([]);
  });

  it("supports the complete elevated asphalt width with structural deck", () => {
    const deckAt = createElevatedRoadDeckHeadroomQuery(allElevatedSurfaces);
    const violations: string[] = [];

    for (const surface of sixthOctoberElevatedSurfaces) {
      const otherSurfaceIds = new Set(
        allElevatedSurfaces
          .filter((candidate) => candidate.id !== surface.id)
          .map((candidate) => candidate.id),
      );
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM <= NON_DEGENERATE_CHORD_M) continue;
        const normalX = -dz / lengthM;
        const normalZ = dx / lengthM;

        for (const amount of [0.2, 0.5, 0.8]) {
          const elevationM =
            (start.elevationM ?? 0) +
            ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
          if (elevationM < ELEVATED_DECK_START_M + 0.05) continue;
          for (const lateralM of [
            -surface.widthM / 2 + 0.08,
            0,
            surface.widthM / 2 - 0.08,
          ]) {
            const sample = {
              x: start.x + dx * amount + normalX * lateralM,
              z: start.z + dz * amount + normalZ * lateralM,
            };
            const ownDeck = deckAt(
              sample,
              0,
              0.03,
              false,
              otherSurfaceIds,
            );
            const deck =
              ownDeck && Math.abs(ownDeck.deckElevationM - elevationM) <= 0.4
                ? ownDeck
                : deckAt(sample, 0, 0.03, false);
            if (!deck || Math.abs(deck.deckElevationM - elevationM) > 0.4) {
              violations.push(
                `${surface.id} segment ${index} at ${(amount * 100).toFixed(0)}% lateral ${lateralM.toFixed(2)}m`,
              );
            }
          }
        }
      }
    }

    expect(
      violations,
      "Every elevated carriageway sample must have a joined structural slab immediately beneath it",
    ).toEqual([]);
  });

  it("keeps Gezira's opposing low approach slabs physically separate before the high braid", () => {
    const entry = sixthOctoberElevatedSurfaces.find(
      (surface) =>
        surface.id === "cairo-sixth-october-bridge-gezira-entry",
    )!;
    const exit = sixthOctoberElevatedSurfaces.find(
      (surface) =>
        surface.id === "cairo-sixth-october-bridge-gezira-exit",
    )!;
    const entrySegments = elevatedRoadSegmentPlacements(entry).filter(
      (segment) =>
        Math.max(segment.startElevationM, segment.endElevationM) <=
        GEZIRA_LOW_APPROACH_TOP_M + 1e-9,
    );
    const exitSegments = elevatedRoadSegmentPlacements(exit).filter(
      (segment) =>
        Math.max(segment.startElevationM, segment.endElevationM) <=
        GEZIRA_LOW_APPROACH_TOP_M + 1e-9,
    );
    const gaps = entrySegments.flatMap((entrySegment) =>
      exitSegments.map((exitSegment) => ({
        entrySegment: entrySegment.segmentIndex,
        exitSegment: exitSegment.segmentIndex,
        gapM: planObbSeparatingGapM(
          planObbForSegment(entry, entrySegment),
          planObbForSegment(exit, exitSegment),
        ),
      })),
    );
    const closest = gaps.reduce((left, right) =>
      left.gapM < right.gapM ? left : right,
    );

    expect(
      closest.gapM,
      `Gezira entry segment ${closest.entrySegment} and exit segment ${closest.exitSegment} need distinct complete slabs below the authored high braid`,
    ).toBeGreaterThanOrEqual(MINIMUM_SEPARATE_DECK_PLAN_GAP_M);
  });

  it("keeps every complete Sixth October deck clear of Cairo's façades", () => {
    const violations: string[] = [];

    for (const surface of sixthOctoberElevatedSurfaces) {
      for (const segment of elevatedRoadSegmentPlacements(surface)) {
        const deck = planObbForSegment(surface, segment);
        for (const block of CAIRO_MAP_PACK.geometry.blocks) {
          const yawRad = ((block.headingDeg ?? 0) * Math.PI) / 180;
          const guardedFacade: PlanObb = {
            x: block.center.x,
            z: block.center.z,
            ux: Math.cos(yawRad),
            uz: -Math.sin(yawRad),
            halfLengthM:
              block.size.x / 2 + MINIMUM_BUILDING_FACADE_GUARD_M,
            halfWidthM:
              block.size.z / 2 + MINIMUM_BUILDING_FACADE_GUARD_M,
          };
          const gapM = planObbSeparatingGapM(deck, guardedFacade);
          if (gapM < -1e-6) {
            violations.push(
              `${surface.id} segment ${segment.segmentIndex} clips the ${MINIMUM_BUILDING_FACADE_GUARD_M}m guard at ${block.id} by ${(-gapM).toFixed(3)}m`,
            );
          }
        }
      }
    }

    expect(
      violations.slice(0, 25),
      "Complete bridge slabs and their junction laps need a visible guard from every building parcel",
    ).toEqual([]);
  });
});
