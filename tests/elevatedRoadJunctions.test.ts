import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import {
  ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
  ELEVATED_ROAD_DECK_OVERHANG_M,
  ELEVATED_ROAD_PARAPET_DECK_INSET_M,
  ELEVATED_ROAD_PARAPET_DEPTH_M,
  elevatedRoadJunctionBarrierPlacements,
  elevatedRoadJunctionEnvelopes,
  type ElevatedRoadGeometrySurface,
  type ElevatedRoadJunctionArm,
  type ElevatedRoadJunctionGuardRun,
} from "../app/game/geometry/elevatedRoadGeometry";
import type { GameCanvasPoint } from "../app/game/sessionContract";

const TEST_ELEVATION_M = 8;
const BARRIER_LATERAL_ADDITION_M =
  ELEVATED_ROAD_DECK_OVERHANG_M -
  ELEVATED_ROAD_PARAPET_DECK_INSET_M;
// Paired ramps need more than a mathematical deck split: the full protected
// gore remains part of the collar so its two rail systems can taper apart
// gradually without a bare concrete sliver between them.
const MINIMUM_PAIRED_BRANCH_GORE_CLEARANCE_M = 4.5;

const point = (
  x: number,
  z: number,
  elevationM = TEST_ELEVATION_M,
): GameCanvasPoint => ({ x, z, elevationM });

const UNEQUAL_COLLINEAR_JOIN: readonly ElevatedRoadGeometrySurface[] = [
  {
    id: "test-narrow",
    widthM: 4,
    centerline: [point(-40, 0), point(0, 0)],
  },
  {
    id: "test-wide",
    widthM: 10,
    centerline: [point(0, 0), point(40, 0)],
  },
];

const PAIRED_BRANCH_JOIN: readonly ElevatedRoadGeometrySurface[] = [
  {
    id: "test-carrier",
    widthM: 8,
    centerline: [point(-60, 0), point(0, 0)],
  },
  {
    id: "test-upper-branch",
    widthM: 4,
    centerline: [
      point(0, 0),
      point(15, 1),
      point(30, 2),
      point(45, 6),
      point(60, 12),
    ],
  },
  {
    id: "test-lower-branch",
    widthM: 4,
    centerline: [
      point(0, 0),
      point(15, -1),
      point(30, -2),
      point(45, -6),
      point(60, -12),
    ],
  },
];

const pointToSegmentDistanceM = (
  candidate: { readonly x: number; readonly z: number },
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
            ((candidate.x - start.x) * dx +
              (candidate.z - start.z) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    candidate.x - (start.x + dx * amount),
    candidate.z - (start.z + dz * amount),
  );
};

const pointToCenterlineDistanceM = (
  candidate: { readonly x: number; readonly z: number },
  surface: ElevatedRoadGeometrySurface,
): number =>
  Math.min(
    ...surface.centerline
      .slice(1)
      .map((end, index) =>
        pointToSegmentDistanceM(candidate, surface.centerline[index], end),
      ),
  );

const logicalJunctionId = (x: number, z: number): string =>
  `elevated-junction-${x.toFixed(3).replace(/[^0-9]/g, "_")}-${z
    .toFixed(3)
    .replace(/[^0-9]/g, "_")}`;

const pointInsideRing = (
  candidate: { readonly x: number; readonly z: number },
  ring: readonly { readonly x: number; readonly z: number }[],
): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (
      (start.z > candidate.z) !== (end.z > candidate.z) &&
      candidate.x <
        ((end.x - start.x) * (candidate.z - start.z)) /
          (end.z - start.z) +
          start.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const sectionNormal = (
  arm: ElevatedRoadJunctionArm,
  index: number,
): { readonly x: number; readonly z: number } => {
  const previous = arm.sections[index - 1];
  const next = arm.sections[index + 1];
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const lengthM = Math.hypot(dx, dz);
  return { x: -dz / lengthM, z: dx / lengthM };
};

const isTransverseArmMouthSegment = (
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  arm: ElevatedRoadJunctionArm,
  lateralAdditionM: number,
): boolean => {
  const mouth = arm.sections.at(-1)!;
  const previous = arm.sections.at(-2)!;
  const mouthDx = mouth.x - previous.x;
  const mouthDz = mouth.z - previous.z;
  const mouthLengthM = Math.hypot(mouthDx, mouthDz);
  const ux = mouthDx / mouthLengthM;
  const uz = mouthDz / mouthLengthM;
  const edgeDx = end.x - start.x;
  const edgeDz = end.z - start.z;
  const edgeLengthM = Math.hypot(edgeDx, edgeDz);
  if (edgeLengthM < 0.001) return false;

  const offset = (candidate: GameCanvasPoint) => ({
    along: (candidate.x - mouth.x) * ux + (candidate.z - mouth.z) * uz,
    lateral: -(candidate.x - mouth.x) * uz +
      (candidate.z - mouth.z) * ux,
  });
  const first = offset(start);
  const second = offset(end);
  return (
    Math.max(Math.abs(first.along), Math.abs(second.along)) <= 0.22 &&
    Math.max(Math.abs(first.lateral), Math.abs(second.lateral)) <=
      arm.nominalHalfWidthM + lateralAdditionM + 0.25 &&
    Math.abs((edgeDx * ux + edgeDz * uz) / edgeLengthM) <= 0.3
  );
};

const ringSegments = (
  ring: readonly GameCanvasPoint[],
): readonly ElevatedRoadJunctionGuardRun[] =>
  ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return {
      start,
      end,
      lengthM: Math.hypot(
        end.x - start.x,
        end.z - start.z,
        (end.elevationM ?? 0) - (start.elevationM ?? 0),
      ),
    };
  });

describe("shared elevated-road junction planner", () => {
  it("represents all twelve Cairo junctions in eleven physical collars", () => {
    const envelopes = elevatedRoadJunctionEnvelopes(
      CAIRO_MAP_PACK.geometry.roadSurfaces,
    );
    const expectedCollars = [
      [-720, 340, "cairo-sixth-october-bridge-west-entry,cairo-sixth-october-bridge-west-exit,cairo-sixth-october-bridge-west-ramp"],
      [-650, 316.73, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-west-ramp"],
      [-614, 400, "cairo-sixth-october-bridge-dokki-entry,cairo-sixth-october-bridge-dokki-exit,cairo-sixth-october-bridge-dokki-ramp"],
      [-610, 312.52, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-dokki-ramp"],
      [-454, 125, "cairo-sixth-october-bridge-gezira-entry,cairo-sixth-october-bridge-gezira-exit,cairo-sixth-october-bridge-gezira-ramp"],
      [-430, 293.6, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-gezira-ramp"],
      [0, 248.42, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-corniche-exit"],
      [160, 231.6043, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-corniche-entry"],
      [520, 193.77, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-ramses-ramp"],
      [567.574, 276.148, "cairo-sixth-october-bridge-ramses-entry,cairo-sixth-october-bridge-ramses-exit,cairo-sixth-october-bridge-ramses-ramp"],
      [570, 188.51, "cairo-sixth-october-bridge,cairo-sixth-october-bridge-east-ramp"],
      [638, 180, "cairo-sixth-october-bridge-east-entry,cairo-sixth-october-bridge-east-exit,cairo-sixth-october-bridge-east-ramp"],
    ] as const;

    expect(envelopes).toHaveLength(11);
    for (const [x, z, surfaceIds] of expectedCollars) {
      const collar = envelopes.find(
        (candidate) => candidate.id.includes(logicalJunctionId(x, z)),
      );
      expect(collar, `missing Cairo collar at ${x}, ${z}`).toBeDefined();
      expect(
        surfaceIds
          .split(",")
          .every((surfaceId) => collar?.surfaceIds.includes(surfaceId)),
      ).toBe(true);
      expect(collar?.deckGuardRuns.length).toBeGreaterThan(0);
      expect(collar?.barrierGuardRuns.length).toBeGreaterThan(0);
    }

    const westDokkiCompound = envelopes.find(
      ({ id }) =>
        id.includes(logicalJunctionId(-650, 316.73)) &&
        id.includes(logicalJunctionId(-610, 312.52)),
    );
    expect(westDokkiCompound?.surfaceIds).toEqual([
      "cairo-sixth-october-bridge",
      "cairo-sixth-october-bridge-dokki-ramp",
      "cairo-sixth-october-bridge-west-ramp",
    ]);
  });

  it("tapers an unequal-width collinear handoff without transverse rail caps", () => {
    const [envelope] = elevatedRoadJunctionEnvelopes(UNEQUAL_COLLINEAR_JOIN);
    expect(envelope).toBeDefined();
    expect(envelope.arms).toHaveLength(2);

    for (const arm of envelope.arms) {
      const widths = arm.sections.map(({ halfWidthM }) => halfWidthM);
      const stations = arm.sections.map(({ stationM }) => stationM);
      expect(widths.length).toBeGreaterThanOrEqual(3);
      expect(widths[0]).toBeGreaterThan(widths.at(-1)!);
      expect(widths.at(-1)).toBeCloseTo(arm.nominalHalfWidthM, 6);
      expect(
        stations.slice(1).every((station, index) => station > stations[index]),
      ).toBe(true);
      expect(
        widths.slice(1).every((width, index) => width <= widths[index] + 1e-6),
      ).toBe(true);
      expect(
        widths.slice(1, -1).some(
          (width) =>
            width < widths[0] - 0.05 &&
            width > arm.nominalHalfWidthM + 0.05,
        ),
      ).toBe(true);
      expect(
        Math.max(
          ...widths.slice(1).map((width, index) => widths[index] - width),
        ),
      ).toBeLessThan((widths[0] - widths.at(-1)!) * 0.75);
    }

    const barrierEdges = ringSegments(envelope.barrierBoundary);
    for (const arm of envelope.arms) {
      expect(
        barrierEdges.some((edge) =>
          isTransverseArmMouthSegment(
            edge.start,
            edge.end,
            arm,
            BARRIER_LATERAL_ADDITION_M,
          ),
        ),
      ).toBe(true);
      expect(
        envelope.barrierGuardRuns.some((run) =>
          isTransverseArmMouthSegment(
            run.start,
            run.end,
            arm,
            BARRIER_LATERAL_ADDITION_M,
          ),
        ),
      ).toBe(false);
      expect(
        envelope.deckGuardRuns.some((run) =>
          isTransverseArmMouthSegment(
            run.start,
            run.end,
            arm,
            ELEVATED_ROAD_DECK_OVERHANG_M,
          ),
        ),
      ).toBe(false);
    }
  });

  it("keeps paired branches inside one exterior protected envelope", () => {
    const [envelope] = elevatedRoadJunctionEnvelopes(PAIRED_BRANCH_JOIN);
    expect(envelope).toBeDefined();
    expect(envelope.surfaceIds).toEqual([
      "test-carrier",
      "test-lower-branch",
      "test-upper-branch",
    ]);

    for (const [surfaceId, outwardZ] of [
      ["test-upper-branch", 1],
      ["test-lower-branch", -1],
    ] as const) {
      const arm = envelope.arms.find(
        (candidate) => candidate.surfaceId === surfaceId,
      )!;
      const branch = PAIRED_BRANCH_JOIN.find(
        (surface) => surface.id === surfaceId,
      )!;
      const otherBranch = PAIRED_BRANCH_JOIN.find(
        (surface) =>
          surface.id !== surfaceId && surface.id.includes("branch"),
      )!;
      const separationM =
        branch.widthM / 2 +
        otherBranch.widthM / 2 +
        MINIMUM_PAIRED_BRANCH_GORE_CLEARANCE_M;
      const finalSection = arm.sections.at(-1)!;
      const priorSection = arm.sections.at(-2)!;
      expect(pointToCenterlineDistanceM(finalSection, otherBranch)).toBeGreaterThanOrEqual(
        separationM,
      );
      expect(pointToCenterlineDistanceM(priorSection, otherBranch)).toBeLessThan(
        separationM,
      );
      expect(arm.coverages.length).toBeGreaterThan(1);
      expect(
        arm.coverages.reduce(
          (coveredM, coverage) => coveredM + coverage.planLengthM,
          0,
        ),
      ).toBeCloseTo(arm.reachM, 6);
      expect(
        arm.coverages.every(
          (coverage) =>
            coverage.surfaceId === surfaceId &&
            coverage.junctionEnd === "start" &&
            coverage.planLengthM > 0,
        ),
      ).toBe(true);
      const targetStationM = arm.reachM * 0.66;
      const sectionIndex = arm.sections
        .slice(1, -1)
        .reduce(
          (best, section, index) =>
            Math.abs(section.stationM - targetStationM) <
            Math.abs(arm.sections[best].stationM - targetStationM)
              ? index + 1
              : best,
          1,
        );
      const section = arm.sections[sectionIndex];
      const normal = sectionNormal(arm, sectionIndex);
      const positiveIsExterior = normal.z * outwardZ > 0;
      const side = positiveIsExterior ? 1 : -1;
      const sideHalfWidthM = positiveIsExterior
        ? section.positiveHalfWidthM
        : section.negativeHalfWidthM;
      const protectedPoint = {
        x: section.x + side * normal.x * (sideHalfWidthM + 0.25),
        z: section.z + side * normal.z * (sideHalfWidthM + 0.25),
      };
      const barrierPoint = {
        x:
          section.x +
          side *
            normal.x *
            (sideHalfWidthM + BARRIER_LATERAL_ADDITION_M),
        z:
          section.z +
          side *
            normal.z *
            (sideHalfWidthM + BARRIER_LATERAL_ADDITION_M),
      };

      expect(pointInsideRing(protectedPoint, envelope.barrierBoundary)).toBe(
        true,
      );
      expect(
        Math.min(
          ...envelope.barrierGuardRuns.map((run) =>
            pointToSegmentDistanceM(barrierPoint, run.start, run.end),
          ),
        ),
      ).toBeLessThan(0.01);
    }
  });

  it("derives gap-free collider chunks from the same guard runs", () => {
    const [envelope] = elevatedRoadJunctionEnvelopes(PAIRED_BRANCH_JOIN);
    const maximumColliderLengthM = 1.75;
    const colliders = elevatedRoadJunctionBarrierPlacements(
      PAIRED_BRANCH_JOIN,
      maximumColliderLengthM,
    );
    const expectedColliderCount = envelope.barrierGuardRuns.reduce(
      (total, run) =>
        total + Math.max(1, Math.ceil(run.lengthM / maximumColliderLengthM)),
      0,
    );

    expect(colliders).toHaveLength(expectedColliderCount);
    expect(new Set(colliders.map(({ id }) => id)).size).toBe(colliders.length);
    for (const [runIndex, run] of envelope.barrierGuardRuns.entries()) {
      const chunks = colliders
        .filter((collider) => collider.runIndex === runIndex)
        .sort((first, second) => first.chunkIndex - second.chunkIndex);
      expect(chunks).toHaveLength(
        Math.max(1, Math.ceil(run.lengthM / maximumColliderLengthM)),
      );
      expect(chunks.map(({ chunkIndex }) => chunkIndex)).toEqual(
        chunks.map((_, index) => index),
      );
      expect(chunks.reduce((sum, chunk) => sum + chunk.lengthM, 0)).toBeCloseTo(
        run.lengthM,
        6,
      );

      const runDx = run.end.x - run.start.x;
      const runDz = run.end.z - run.start.z;
      const runPlanLengthM = Math.hypot(runDx, runDz);
      const runUx = runDx / runPlanLengthM;
      const runUz = runDz / runPlanLengthM;
      for (const chunk of chunks) {
        expect(chunk.segmentIndex).toBe(-1);
        expect(chunk.lengthM).toBeLessThanOrEqual(
          maximumColliderLengthM + 1e-9,
        );
        expect(pointToSegmentDistanceM(chunk, run.start, run.end)).toBeLessThan(
          1e-6,
        );
        expect(chunk.ux * runUx + chunk.uz * runUz).toBeCloseTo(1, 6);
        expect(chunk.halfU * 2).toBeCloseTo(chunk.lengthM, 6);
        expect(chunk.halfV).toBeCloseTo(
          ELEVATED_ROAD_PARAPET_DEPTH_M / 2,
          6,
        );
        expect(chunk.minElevationM).toBeCloseTo(
          TEST_ELEVATION_M - ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
          6,
        );
        expect(chunk.maxElevationM).toBeCloseTo(
          TEST_ELEVATION_M + ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
          6,
        );
      }
    }
  });
});
