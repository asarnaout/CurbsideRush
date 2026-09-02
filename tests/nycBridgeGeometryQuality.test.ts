import {
  Mesh,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { CAREER_VEHICLES } from "../app/game/career";
import {
  NYC_FREE_DRIVE,
  NYC_MAP_PACK,
  NYC_QUEENSVIEW_ACCESS_SITES,
  NYC_QUEENSVIEW_DECK_ELEVATION_M,
  NYC_QUEENSVIEW_NETWORK_PREFIX,
} from "../app/game/cities/nyc";
import { getCountryProfile } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import {
  ELEVATED_ROAD_DECK_OVERHANG_M,
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
  ELEVATED_ROAD_PARAPET_DECK_INSET_M,
  ELEVATED_ROAD_PARAPET_DEPTH_M,
  ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
  createElevatedRoadGroundClearanceQuery,
  elevatedRoadBarrierPlacements,
  elevatedRoadEdgeRuns,
  elevatedRoadJunctionBarrierPlacements,
  elevatedRoadJunctionEnvelopes,
  elevatedRoadPierPlacements,
  elevatedRoadSegmentPlacements,
  type ElevatedRoadEdgeRunPlacement,
  type ElevatedRoadGeometrySurface,
  type ElevatedRoadSegmentPlacement,
} from "../app/game/geometry/elevatedRoadGeometry";
import { buildElevatedRoadStructures } from "../app/game/render/elevatedRoadLayer";
import { isElevatedRoadSurface } from "../app/game/roadElevation";
import { RoadNetwork } from "../app/game/simulation/roadNetwork";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "../app/game/simulation/roadLevels";
import {
  buildSimulationCoreConfig,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import type { GameCanvasMapPack } from "../app/game/sessionContract";
import type {
  StaticObstacle,
  WorldPoint,
} from "../app/game/types";
import { VEHICLE_DIMENSIONS } from "../app/game/vehicleVisuals";

/** Physical quality bars chosen for NYC's longer, faster Queensview ramps. */
const MAXIMUM_CHORD_M = 7.5;
const MAXIMUM_CHORD_HEADING_CHANGE_DEG = 5;
const MINIMUM_LOCAL_CURVE_RADIUS_M = 24;
const MAXIMUM_RAMP_GRADE = 0.08;
const MAXIMUM_GRADE_STEP = 0.0125;
const MAXIMUM_TOUCHDOWN_GRADE = 0.0125;
const MAXIMUM_ROAD_HANDOFF_DEG = 15;
const MAXIMUM_EDGE_ENDPOINT_GAP_M = 0.15;
const MAXIMUM_BARRIER_LATERAL_ERROR_M = 0.001;
const MINIMUM_BUILDING_FACADE_GUARD_M = 0.75;
const NON_DEGENERATE_CHORD_M = 0.001;
const SHARED_JUNCTION_TOLERANCE_M = 0.05;

const allSurfaces = NYC_MAP_PACK.geometry.roadSurfaces;
const surfaceById = new Map(allSurfaces.map((surface) => [surface.id, surface]));
const allElevatedSurfaces = allSurfaces.filter(isElevatedRoadSurface);
const networkSurfaces = allSurfaces.filter((surface) =>
  surface.id.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
);
const networkElevatedSurfaces = networkSurfaces.filter(isElevatedRoadSurface);
const networkSurfaceIds = new Set(networkSurfaces.map((surface) => surface.id));
const laneById = new Map(
  NYC_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
);

const elevatedJunctionEnvelopes =
  elevatedRoadJunctionEnvelopes(allElevatedSurfaces);
const junctionOwnedSegments = new Set(
  elevatedJunctionEnvelopes.flatMap((envelope) =>
    envelope.arms.flatMap((arm) =>
      arm.coverages.map(
        (coverage) => `${coverage.surfaceId}:${coverage.segmentIndex}`,
      ),
    ),
  ),
);

const junctionOwnsSegment = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
): boolean =>
  junctionOwnedSegments.has(`${surface.id}:${segment.segmentIndex}`);

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
    if (
      elevatedJunctionEnvelopes.some(
        (envelope) =>
          envelope.surfaceIds.includes(surface.id) &&
          envelope.surfaceIds.includes(other.id),
      )
    ) {
      // A physical-right branch can meet inside one shoulder of a wider
      // carrier without sharing its centreline point. Its virtual collar is
      // the structural connectivity authority; the sampled edge-to-corridor
      // check below still limits the opening to the actual overlap.
      return true;
    }
    if (other.widthM < surface.widthM - 0.05) {
      return surfaceEndpointJoins(other, surface);
    }
    if (other.widthM > surface.widthM + 0.05) {
      return surfaceEndpointJoins(surface, other);
    }

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
      ((authoredEnd.elevationM ?? 0) - (authoredStart.elevationM ?? 0)) *
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
): WorldPoint => {
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
    elevationM:
      (authoredStart.elevationM ?? 0) +
      ((authoredEnd.elevationM ?? 0) - (authoredStart.elevationM ?? 0)) *
        (0.5 + alongPlanM / planLengthM),
  };
};

const pointToSpatialSegmentDistanceM = (
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number => {
  const dx = end.x - start.x;
  const dy = (end.elevationM ?? 0) - (start.elevationM ?? 0);
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const amount =
    lengthSquared > 1e-9
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx +
              ((point.elevationM ?? 0) - (start.elevationM ?? 0)) * dy +
              (point.z - start.z) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    point.x - (start.x + dx * amount),
    (point.elevationM ?? 0) - ((start.elevationM ?? 0) + dy * amount),
    point.z - (start.z + dz * amount),
  );
};

const endpointDirection = (
  points: readonly WorldPoint[],
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

interface PlanObb {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

const planObbForSegment = (
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
): PlanObb => {
  const start = surface.centerline[segment.segmentIndex];
  const end = surface.centerline[segment.segmentIndex + 1];
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const planLengthM = Math.hypot(dx, dz);
  return {
    x: segment.center.x,
    z: segment.center.z,
    ux: dx / planLengthM,
    uz: dz / planLengthM,
    halfU: planLengthM / 2 + 0.1,
    halfV: segment.deckWidthM / 2 + MINIMUM_BUILDING_FACADE_GUARD_M,
  };
};

const planObbsOverlap = (left: PlanObb, right: PlanObb): boolean => {
  const leftV = { x: -left.uz, z: left.ux };
  const rightV = { x: -right.uz, z: right.ux };
  const offsetX = right.x - left.x;
  const offsetZ = right.z - left.z;
  return [
    { x: left.ux, z: left.uz },
    leftV,
    { x: right.ux, z: right.uz },
    rightV,
  ].every((axis) => {
    const separationM = Math.abs(offsetX * axis.x + offsetZ * axis.z);
    const leftRadiusM =
      left.halfU * Math.abs(left.ux * axis.x + left.uz * axis.z) +
      left.halfV * Math.abs(leftV.x * axis.x + leftV.z * axis.z);
    const rightRadiusM =
      right.halfU * Math.abs(right.ux * axis.x + right.uz * axis.z) +
      right.halfV * Math.abs(rightV.x * axis.x + rightV.z * axis.z);
    return separationM < leftRadiusM + rightRadiusM - 0.01;
  });
};

const obstacleBounds = (
  obstacle: StaticObstacle,
): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  if (obstacle.kind === "circle") {
    return {
      minX: obstacle.x - obstacle.radius,
      maxX: obstacle.x + obstacle.radius,
      minZ: obstacle.z - obstacle.radius,
      maxZ: obstacle.z + obstacle.radius,
    };
  }
  if (obstacle.kind === "aabb") {
    return {
      minX: obstacle.minX,
      maxX: obstacle.maxX,
      minZ: obstacle.minZ,
      maxZ: obstacle.maxZ,
    };
  }
  const points =
    obstacle.kind === "convex"
      ? obstacle.points
      : ([
          [obstacle.halfU, obstacle.halfV],
          [obstacle.halfU, -obstacle.halfV],
          [-obstacle.halfU, obstacle.halfV],
          [-obstacle.halfU, -obstacle.halfV],
        ] as const).map(([u, v]) => ({
          x: obstacle.x + obstacle.ux * u + obstacle.uz * v,
          z: obstacle.z + obstacle.uz * u - obstacle.ux * v,
        }));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
};

const buildObstacleIndex = (obstacles: readonly StaticObstacle[]) => {
  const cellSizeM = 16;
  const cellOf = (value: number) => Math.floor(value / cellSizeM);
  const cells = new Map<string, StaticObstacle[]>();
  for (const obstacle of obstacles) {
    const bounds = obstacleBounds(obstacle);
    for (let x = cellOf(bounds.minX); x <= cellOf(bounds.maxX); x += 1) {
      for (let z = cellOf(bounds.minZ); z <= cellOf(bounds.maxZ); z += 1) {
        const key = `${x}:${z}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(obstacle);
        else cells.set(key, [obstacle]);
      }
    }
  }
  return (x: number, z: number): readonly StaticObstacle[] => {
    const result: StaticObstacle[] = [];
    const seen = new Set<StaticObstacle>();
    const centreX = cellOf(x);
    const centreZ = cellOf(z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const obstacle of cells.get(`${centreX + dx}:${centreZ + dz}`) ?? []) {
          if (seen.has(obstacle)) continue;
          seen.add(obstacle);
          result.push(obstacle);
        }
      }
    }
    return result;
  };
};

const country = getCountryProfile(NYC_FREE_DRIVE.countryId);
const simulationConfig = buildSimulationCoreConfig({
  scenario: buildFreeDriveScenario(NYC_FREE_DRIVE),
  mapPack: NYC_MAP_PACK,
  trafficSide: country.trafficSide,
  speedUnit: country.speedUnit,
});
const roadNetwork = new RoadNetwork(simulationConfig.lanes ?? [], [], []);
const staticObstacles = simulationConfig.staticObstacles ?? [];
const nearbyObstacles = buildObstacleIndex(staticObstacles);

const maximumVehicleRadiusM = Math.max(
  ...CAREER_VEHICLES.map((vehicle) => vehicle.physics.playerCapsuleRadiusM),
);
const maximumVehicleHalfLengthM = Math.max(
  ...CAREER_VEHICLES.map(
    (vehicle) => vehicle.physics.playerCapsuleHalfLengthM,
  ),
);
const maximumAuthoredVehicleHeightM = Math.max(
  ...Object.values(VEHICLE_DIMENSIONS).map((dimensions) => dimensions.height),
);
const requiredHeadroomM = maximumAuthoredVehicleHeightM + 0.08;

describe("NYC Queensview bridge geometry quality", () => {
  it("keeps every curve broad, finely sampled, and below an eight-percent grade", () => {
    const violations: string[] = [];
    let curvedTripleCount = 0;

    for (const surface of networkSurfaces) {
      const directions: Array<{
        readonly x: number;
        readonly z: number;
        readonly grade: number;
        readonly segmentIndex: number;
      }> = [];
      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM <= NON_DEGENERATE_CHORD_M) continue;
        const grade =
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) / lengthM;
        if (lengthM > MAXIMUM_CHORD_M + 0.001) {
          violations.push(
            `${surface.id} chord ${index - 1}: ${lengthM.toFixed(3)}m`,
          );
        }
        if (Math.abs(grade) > MAXIMUM_RAMP_GRADE + 1e-9) {
          violations.push(
            `${surface.id} grade ${index - 1}: ${(grade * 100).toFixed(3)}%`,
          );
        }
        directions.push({
          x: dx / lengthM,
          z: dz / lengthM,
          grade,
          segmentIndex: index - 1,
        });
      }

      for (let index = 1; index < directions.length; index += 1) {
        const previous = directions[index - 1];
        const current = directions[index];
        const dot = Math.max(
          -1,
          Math.min(1, previous.x * current.x + previous.z * current.z),
        );
        const headingChangeDeg = (Math.acos(dot) * 180) / Math.PI;
        if (headingChangeDeg > MAXIMUM_CHORD_HEADING_CHANGE_DEG + 1e-9) {
          violations.push(
            `${surface.id} point ${current.segmentIndex}: ${headingChangeDeg.toFixed(3)}deg heading step`,
          );
        }
        const gradeStep = Math.abs(current.grade - previous.grade);
        if (gradeStep > MAXIMUM_GRADE_STEP + 1e-9) {
          violations.push(
            `${surface.id} point ${current.segmentIndex}: ${(gradeStep * 100).toFixed(3)} percentage-point grade step`,
          );
        }
      }

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
        if (twiceAreaM2 <= 0.0001) continue;
        curvedTripleCount += 1;
        const radiusM =
          (firstM * secondM * diagonalM) / (2 * twiceAreaM2);
        if (radiusM < MINIMUM_LOCAL_CURVE_RADIUS_M - 1e-6) {
          violations.push(
            `${surface.id} point ${index}: ${radiusM.toFixed(3)}m radius`,
          );
        }
      }

      if (surface.id.endsWith("-entry-ramp")) {
        expect(
          Math.abs(directions[0]?.grade ?? 0),
          `${surface.id} starts level at its flat slip`,
        ).toBeLessThanOrEqual(MAXIMUM_TOUCHDOWN_GRADE);
      }
      if (surface.id.endsWith("-exit-ramp")) {
        expect(
          Math.abs(directions.at(-1)?.grade ?? 0),
          `${surface.id} lands level at its flat slip`,
        ).toBeLessThanOrEqual(MAXIMUM_TOUCHDOWN_GRADE);
      }
    }

    for (const lane of NYC_MAP_PACK.laneGraph.lanes) {
      const incoming = endpointDirection(lane.centerline, true);
      if (!incoming) continue;
      for (const successorId of lane.successors) {
        const successor = laneById.get(successorId);
        if (
          !successor ||
          successor.roadId === lane.roadId ||
          (!networkSurfaceIds.has(lane.roadId) &&
            !networkSurfaceIds.has(successor.roadId))
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
            `${lane.id} -> ${successor.id}: ${handoffDeg.toFixed(3)}deg handoff`,
          );
        }

        const laneLast = lane.centerline.at(-1)!;
        const laneBefore = lane.centerline.at(-2)!;
        const successorFirst = successor.centerline[0];
        const successorAfter = successor.centerline[1];
        const incomingLengthM = Math.hypot(
          laneLast.x - laneBefore.x,
          laneLast.z - laneBefore.z,
        );
        const outgoingLengthM = Math.hypot(
          successorAfter.x - successorFirst.x,
          successorAfter.z - successorFirst.z,
        );
        const incomingGrade =
          ((laneLast.elevationM ?? 0) - (laneBefore.elevationM ?? 0)) /
          incomingLengthM;
        const outgoingGrade =
          ((successorAfter.elevationM ?? 0) -
            (successorFirst.elevationM ?? 0)) /
          outgoingLengthM;
        if (
          Math.abs(incomingGrade - outgoingGrade) >
          MAXIMUM_GRADE_STEP + 1e-9
        ) {
          violations.push(
            `${lane.id} -> ${successor.id}: ${(Math.abs(incomingGrade - outgoingGrade) * 100).toFixed(3)} percentage-point grade seam`,
          );
        }
      }
    }

    expect(curvedTripleCount).toBeGreaterThan(100);
    expect(violations.slice(0, 30)).toEqual([]);
  });

  it("seats every visible and physical barrier on the authored deck edge", () => {
    expect(ELEVATED_ROAD_PARAPET_BASE_LIFT_M).toBe(0);
    let placementCount = 0;
    for (const surface of networkElevatedSurfaces) {
      expect(surface.sidewalkWidthM, surface.id).toBe(0);
      expect(surface.parapetDepthM, surface.id).toBe(0.36);
      const segments = new Map(
        elevatedRoadSegmentPlacements(surface).map((segment) => [
          segment.segmentIndex,
          segment,
        ]),
      );
      const placements = elevatedRoadBarrierPlacements(
        surface,
        allElevatedSurfaces,
      );
      expect(placements.length, surface.id).toBeGreaterThan(0);
      placementCount += placements.length;
      for (const placement of placements) {
        const segment = segments.get(placement.segmentIndex)!;
        const start = surface.centerline[placement.segmentIndex];
        const end = surface.centerline[placement.segmentIndex + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        const normalX = -dz / lengthM;
        const normalZ = dx / lengthM;
        const lateralM =
          (placement.x - segment.center.x) * normalX +
          (placement.z - segment.center.z) * normalZ;
        const expectedLateralM =
          placement.side *
          (segment.deckWidthM / 2 - ELEVATED_ROAD_PARAPET_DECK_INSET_M);
        expect(
          Math.abs(lateralM - expectedLateralM),
          placement.id,
        ).toBeLessThanOrEqual(MAXIMUM_BARRIER_LATERAL_ERROR_M);
      }
    }
    expect(placementCount).toBeGreaterThan(500);

    const expectedBarriers = [
      ...networkElevatedSurfaces.flatMap((surface) =>
        elevatedRoadBarrierPlacements(surface, allElevatedSurfaces),
      ),
      ...elevatedRoadJunctionBarrierPlacements(allElevatedSurfaces),
    ];
    const actualById = new Map(
      staticObstacles
        .filter((obstacle) => obstacle.tag === "roadBarrier")
        .map((obstacle) => [obstacle.id, obstacle]),
    );
    expect(
      [...actualById.keys()].sort(),
      "render-derived and physical barrier inventories agree exactly",
    ).toEqual(expectedBarriers.map((barrier) => barrier.id).sort());
    for (const barrier of expectedBarriers) {
      const obstacle = actualById.get(barrier.id);
      expect(obstacle?.kind, barrier.id).toBe("obb");
      if (obstacle?.kind !== "obb") continue;
      expect(obstacle.x, barrier.id).toBeCloseTo(barrier.x, 9);
      expect(obstacle.z, barrier.id).toBeCloseTo(barrier.z, 9);
      expect(obstacle.ux, barrier.id).toBeCloseTo(barrier.ux, 9);
      expect(obstacle.uz, barrier.id).toBeCloseTo(barrier.uz, 9);
      expect(obstacle.halfU, barrier.id).toBeCloseTo(barrier.halfU, 9);
      expect(obstacle.halfV, barrier.id).toBeCloseTo(barrier.halfV, 9);
      expect(obstacle.minElevationM, barrier.id).toBeCloseTo(
        barrier.minElevationM,
        9,
      );
      expect(obstacle.maxElevationM, barrier.id).toBeCloseTo(
        barrier.maxElevationM,
        9,
      );
    }
  });

  it("keeps ordinary barrier edges continuous and opens them only at joined pavement", () => {
    const violations: string[] = [];
    let checkedSideCount = 0;

    for (const surface of networkElevatedSurfaces) {
      const segments = elevatedRoadSegmentPlacements(surface);
      const segmentByIndex = new Map(
        segments.map((segment) => [segment.segmentIndex, segment]),
      );
      for (
        let pointIndex = 1;
        pointIndex + 1 < surface.centerline.length;
        pointIndex += 1
      ) {
        if (isInsideCrossSurfaceMergeThroat(surface, pointIndex)) continue;
        const incoming = segmentByIndex.get(pointIndex - 1);
        const outgoing = segmentByIndex.get(pointIndex);
        if (!incoming || !outgoing) continue;
        if (
          junctionOwnsSegment(surface, incoming) ||
          junctionOwnsSegment(surface, outgoing)
        ) {
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
          const intentionallyOpen =
            isIntentionalConnectedMergeOpening(surface, incoming, side) ||
            isIntentionalConnectedMergeOpening(surface, outgoing, side);
          if (intentionallyOpen) {
            continue;
          }
          checkedSideCount += 1;
          const incomingRun = incomingRuns.find((run) => run.side === side);
          const outgoingRun = outgoingRuns.find((run) => run.side === side);
          if (!incomingRun || !outgoingRun) {
            violations.push(
              `${surface.id} point ${pointIndex} side ${side}: unexplained opening`,
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
            (incomingEnd.elevationM ?? 0) -
              (outgoingStart.elevationM ?? 0),
            incomingEnd.z - outgoingStart.z,
          );
          if (gapM > MAXIMUM_EDGE_ENDPOINT_GAP_M + 1e-9) {
            violations.push(
              `${surface.id} point ${pointIndex} side ${side}: ${gapM.toFixed(4)}m gap`,
            );
          }
        }
      }
    }

    const ordinaryRuns = allElevatedSurfaces.flatMap((surface) =>
      elevatedRoadSegmentPlacements(surface).flatMap((segment) =>
        elevatedRoadEdgeRuns(surface, segment, allElevatedSurfaces).map((run) => ({
          start: edgeRunEndpoint(surface, segment, run, "start"),
          end: edgeRunEndpoint(surface, segment, run, "end"),
        })),
      ),
    );
    const collarRuns = elevatedJunctionEnvelopes.flatMap((envelope) =>
      envelope.barrierGuardRuns.map((run) => ({
        belongsToNetwork: envelope.surfaceIds.some((surfaceId) =>
          surfaceId.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
        ),
        start: run.start,
        end: run.end,
      })),
    );
    for (const envelope of elevatedJunctionEnvelopes.filter((candidate) =>
      candidate.surfaceIds.some((surfaceId) =>
        surfaceId.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
      ),
    )) {
      const collarSurfaceIds = new Set(envelope.surfaceIds);
      for (const surfaceId of envelope.surfaceIds) {
        const ownsLegalMovement = NYC_MAP_PACK.laneGraph.lanes.some((lane) =>
          lane.roadId === surfaceId
            ? lane.successors.some((successorId) => {
                const successor = laneById.get(successorId);
                return (
                  successor !== undefined &&
                  successor.roadId !== surfaceId &&
                  collarSurfaceIds.has(successor.roadId)
                );
              })
            : collarSurfaceIds.has(lane.roadId) &&
              lane.successors.some(
                (successorId) =>
                  laneById.get(successorId)?.roadId === surfaceId,
              ),
        );
        if (!ownsLegalMovement) {
          violations.push(
            `${envelope.id} opens ${surfaceId} without an authored lane movement`,
          );
        }
      }
    }
    for (const run of collarRuns.filter((candidate) => candidate.belongsToNetwork)) {
      for (const endpoint of [run.start, run.end]) {
        const nearestM = Math.min(
          ...ordinaryRuns.map((candidate) =>
            pointToSpatialSegmentDistanceM(
              endpoint,
              candidate.start,
              candidate.end,
            ),
          ),
          ...collarRuns
            .filter((candidate) => candidate !== run)
            .map((candidate) =>
              pointToSpatialSegmentDistanceM(
                endpoint,
                candidate.start,
                candidate.end,
              ),
            ),
        );
        if (nearestM > MAXIMUM_EDGE_ENDPOINT_GAP_M + 1e-9) {
          violations.push(`junction collar guard leaves ${nearestM.toFixed(4)}m`);
        }
      }
    }

    expect(checkedSideCount).toBeGreaterThan(500);
    const networkCollars = elevatedJunctionEnvelopes.filter((envelope) =>
      envelope.surfaceIds.some((surfaceId) =>
        surfaceId.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
      ),
    );
    const highMouths = NYC_QUEENSVIEW_ACCESS_SITES.flatMap((site) => [
      { id: `${site.id} entry`, movement: site.entry },
      { id: `${site.id} exit`, movement: site.exit },
    ]);
    expect(highMouths).toHaveLength(8);
    for (const mouth of highMouths) {
      const ramp = surfaceById.get(mouth.movement.rampSurfaceId)!;
      const branchEndpoint = mouth.id.endsWith("entry")
        ? ramp.centerline.at(-1)!
        : ramp.centerline[0];
      const collar = networkCollars.find(
        (envelope) =>
          envelope.surfaceIds.includes(mouth.movement.rampSurfaceId) &&
          envelope.surfaceIds.length >= 2,
      );
      expect(
        collar,
        `${mouth.id} opening is owned by a structural collar`,
      ).toBeTruthy();
      expect(
        collar?.surfaceIds.some((surfaceId) => {
          if (surfaceId === mouth.movement.rampSurfaceId) return false;
          const carrier = surfaceById.get(surfaceId);
          return (
            carrier !== undefined &&
            pointInsideSurfaceCorridorAtElevation(
              branchEndpoint,
              branchEndpoint.elevationM ?? 0,
              carrier,
              carrier.widthM / 2 + SHARED_JUNCTION_TOLERANCE_M,
              SHARED_JUNCTION_TOLERANCE_M,
            )
          );
        }),
        `${mouth.id} physical branch endpoint lies in its collar carrier footprint`,
      ).toBe(true);
    }
    expect(violations.slice(0, 30)).toEqual([]);
  });

  it("keeps every crossed surface-road vehicle envelope below a clear soffit", () => {
    const crossedRoadIds = new Set(
      [
        "nyc-third",
        "nyc-vernon",
        ...NYC_QUEENSVIEW_ACCESS_SITES.flatMap((site) => [
          ...site.entry.crossedSurfaceRoadIds,
          ...site.exit.crossedSurfaceRoadIds,
        ]),
      ],
    );
    expect(crossedRoadIds.size).toBeGreaterThanOrEqual(5);

    const clearanceAt = createElevatedRoadGroundClearanceQuery(allSurfaces);
    const obstructionSamplesByRoad = new Map<string, number>();
    const failures: string[] = [];
    for (const lane of roadNetwork.lanes) {
      if (!lane.roadId || !crossedRoadIds.has(lane.roadId)) continue;
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.5) {
        const point = roadNetwork.pointOnLane(lane, distanceM);
        for (const alongM of [
          -maximumVehicleHalfLengthM,
          0,
          maximumVehicleHalfLengthM,
        ]) {
          const sample = {
            x: point.x + Math.sin(point.heading) * alongM,
            z: point.z + Math.cos(point.heading) * alongM,
          };
          const obstruction = clearanceAt(
            sample,
            point.elevationM ?? 0,
            maximumVehicleRadiusM,
            false,
            new Set([lane.roadId]),
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
          );
          if (!obstruction) continue;
          const isAuthoredGroundMerge = NYC_QUEENSVIEW_ACCESS_SITES.some(
            (site) =>
              [site.entry, site.exit].some((movement) => {
                if (
                  movement.hostRoadId !== lane.roadId ||
                  movement.rampSurfaceId !== obstruction.surfaceId
                ) {
                  return false;
                }
                const slip = surfaceById.get(movement.slipSurfaceId);
                return (
                  slip !== undefined &&
                  pointInsideSurfaceCorridorAtElevation(
                    sample,
                    point.elevationM ?? 0,
                    slip,
                    slip.widthM / 2 + 0.05,
                    0.35,
                  )
                );
              }),
          );
          // The ramp slab begins at road level inside its own flat auxiliary
          // lane. That is a legal same-level pavement union, not an underpass;
          // exempt only this exact movement and only while the sampled vehicle
          // centre remains inside the connected slip corridor.
          if (isAuthoredGroundMerge) continue;
          obstructionSamplesByRoad.set(
            lane.roadId,
            (obstructionSamplesByRoad.get(lane.roadId) ?? 0) + 1,
          );
          if (obstruction.clearanceM < requiredHeadroomM) {
            failures.push(
              `${lane.id} at ${distanceM.toFixed(1)}m: ${obstruction.surfaceId}/${obstruction.obstructionKind} leaves ${obstruction.clearanceM.toFixed(3)}m`,
            );
          }
        }
      }
    }

    for (const roadId of crossedRoadIds) {
      expect(
        obstructionSamplesByRoad.get(roadId) ?? 0,
        `${roadId} crossing must be exercised`,
      ).toBeGreaterThan(0);
    }
    expect(
      failures.slice(0, 30),
      `Every authored vehicle needs ${requiredHeadroomM.toFixed(2)}m beneath Queensview`,
    ).toEqual([]);
  });

  it(
    "keeps the complete largest-vehicle lane sweep clear of production static obstacles",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let sampleCount = 0;
      for (const lane of roadNetwork.lanes) {
        if (!lane.roadId || !networkSurfaceIds.has(lane.roadId)) continue;
        for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.75) {
          const point = roadNetwork.pointOnLane(lane, distanceM);
          for (const alongM of [
            -maximumVehicleHalfLengthM,
            0,
            maximumVehicleHalfLengthM,
          ]) {
            const x = point.x + Math.sin(point.heading) * alongM;
            const z = point.z + Math.cos(point.heading) * alongM;
            let nearestM = Number.POSITIVE_INFINITY;
            let nearest: StaticObstacle | undefined;
            for (const obstacle of nearbyObstacles(x, z)) {
              const elevationM = point.elevationM ?? 0;
              if (
                elevationM <
                  (obstacle.minElevationM ?? Number.NEGATIVE_INFINITY) ||
                elevationM >
                  (obstacle.maxElevationM ?? Number.POSITIVE_INFINITY)
              ) {
                continue;
              }
              const distanceM = distanceToStaticObstacle(obstacle, x, z);
              if (distanceM < nearestM) {
                nearestM = distanceM;
                nearest = obstacle;
              }
            }
            sampleCount += 1;
            if (nearestM + 0.01 < maximumVehicleRadiusM) {
              failures.push(
                `${lane.id} at ${distanceM.toFixed(2)}m/${alongM.toFixed(2)}m: ${nearest?.id ?? "unknown"}[${nearest?.tag ?? "unknown"}] leaves ${nearestM.toFixed(3)}m`,
              );
            }
          }
        }
      }
      expect(sampleCount).toBeGreaterThan(10_000);
      expect(failures.slice(0, 30)).toEqual([]);
    },
  );

  it("keeps complete slabs, supports, and planned façades out of one another", () => {
    const buildingLayout = planMapBuildings(
      NYC_MAP_PACK,
      NYC_FREE_DRIVE.trafficSeed,
      relaxationPolicyForMap(NYC_MAP_PACK.id),
    );
    const buildingSolids = buildingLayout.buildings.flatMap((building) =>
      building.solids.map((solid) => ({ buildingId: building.id, solid })),
    );
    const violations: string[] = [];
    let deckSolidPairs = 0;

    for (const surface of networkElevatedSurfaces) {
      for (const segment of elevatedRoadSegmentPlacements(surface)) {
        const deck = planObbForSegment(surface, segment);
        for (const { buildingId, solid } of buildingSolids) {
          deckSolidPairs += 1;
          if (
            planObbsOverlap(deck, {
              x: solid.x,
              z: solid.z,
              ux: solid.ux,
              uz: solid.uz,
              halfU: solid.halfU,
              halfV: solid.halfV,
            })
          ) {
            violations.push(
              `${surface.id} segment ${segment.segmentIndex} clips the ${MINIMUM_BUILDING_FACADE_GUARD_M}m guard at ${buildingId}`,
            );
          }
        }
      }
    }

    const expectedSupports = networkElevatedSurfaces.flatMap((surface) =>
      elevatedRoadPierPlacements(surface, allSurfaces).map((pier) => ({
        id: `elevated-road-${surface.id}-pier-${pier.index}-collider`,
        pier,
      })),
    );
    const actualSupportIds = staticObstacles
      .filter((obstacle) => obstacle.tag === "roadSupport")
      .map((obstacle) => obstacle.id)
      .sort();
    expect(actualSupportIds).toEqual(
      expectedSupports.map((support) => support.id).sort(),
    );
    for (const { id, pier } of expectedSupports) {
      for (const { buildingId, solid } of buildingSolids) {
        const lateralX = pier.position.x - solid.x;
        const lateralZ = pier.position.z - solid.z;
        const u = lateralX * solid.ux + lateralZ * solid.uz;
        const v = lateralX * -solid.uz + lateralZ * solid.ux;
        if (
          Math.abs(u) < solid.halfU + ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M &&
          Math.abs(v) < solid.halfV + ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M
        ) {
          violations.push(`${id} clips planned building ${buildingId}`);
        }
      }
    }

    expect(deckSolidPairs).toBeGreaterThan(100_000);
    expect(expectedSupports.length).toBeGreaterThan(5);
    expect(violations.slice(0, 30)).toEqual([]);
  });

  it(
    "renders the authored full-surface network identically before and after static batching",
    { timeout: 120_000 },
    () => {
      const render = (batchStaticMeshes: boolean) => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const staticSceneryFreeze: TransformNode[] = [];
        const staticMeshes: Mesh[] = [];
        const shadowMeshes: Mesh[] = [];
        buildElevatedRoadStructures(
          {
            scene,
            staticSceneryFreeze,
            registerStatic: (mesh) => {
              if (mesh instanceof Mesh) staticMeshes.push(mesh);
            },
            registerShadowCaster: (mesh) => {
              if (mesh instanceof Mesh) shadowMeshes.push(mesh);
            },
          },
          NYC_MAP_PACK as unknown as GameCanvasMapPack,
          { batchStaticMeshes },
        );
        return { engine, scene, staticMeshes, shadowMeshes };
      };
      const signature = (rendered: ReturnType<typeof render>): string[] => {
        const values: string[] = [];
        for (const mesh of rendered.scene.meshes) {
          if (!(mesh instanceof Mesh)) continue;
          const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
          if (!positions) continue;
          const world = mesh.computeWorldMatrix(true);
          const role = rendered.shadowMeshes.includes(mesh)
            ? "shadow"
            : rendered.staticMeshes.includes(mesh)
              ? "static"
              : "freeze";
          for (let offset = 0; offset < positions.length; offset += 3) {
            const point = Vector3.TransformCoordinates(
              Vector3.FromArray(positions, offset),
              world,
            );
            values.push(
              `${mesh.material?.name ?? "none"}|${role}|${point.x.toFixed(4)}|${point.y.toFixed(4)}|${point.z.toFixed(4)}`,
            );
          }
        }
        return values.sort();
      };

      const unbatched = render(false);
      const batched = render(true);
      try {
        expect(signature(batched)).toEqual(signature(unbatched));
        expect(
          batched.scene.meshes.reduce(
            (total, mesh) => total + mesh.getTotalIndices(),
            0,
          ),
        ).toBe(
          unbatched.scene.meshes.reduce(
            (total, mesh) => total + mesh.getTotalIndices(),
            0,
          ),
        );
        expect(batched.scene.meshes.length).toBeLessThan(
          unbatched.scene.meshes.length,
        );
        expect(batched.scene.transformNodes).toHaveLength(0);
        expect(
          Math.max(
            ...batched.scene.meshes.map((mesh) => mesh.getTotalVertices()),
          ),
        ).toBeLessThan(65_536);
        expect(
          Math.max(
            ...networkElevatedSurfaces.flatMap((surface) =>
              surface.centerline.map((point) => point.elevationM ?? 0),
            ),
          ),
        ).toBeCloseTo(NYC_QUEENSVIEW_DECK_ELEVATION_M, 9);
      } finally {
        unbatched.scene.dispose();
        unbatched.engine.dispose();
        batched.scene.dispose();
        batched.engine.dispose();
      }
    },
  );
});
