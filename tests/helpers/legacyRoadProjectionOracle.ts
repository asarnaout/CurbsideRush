/**
 * Frozen pre-optimization road projection/point lookup used only by the
 * equivalence corpus. Keep this deliberately independent of RoadNetwork's new
 * segment caches and scan ordering: it is the behavioral oracle that lets the
 * production implementation change its work without changing its answer.
 */
import {
  type LaneProjection,
  type NormalizedLane,
  type RoadProjectionPreference,
} from "../../app/game/simulation/roadNetwork";
import {
  angleDifference,
  clamp,
} from "../../app/game/simulation/mathUtils";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "../../app/game/simulation/roadLevels";
import type { SimulationPose } from "../../app/game/simulation";

export class LegacyRoadProjectionOracle {
  private readonly lanesById: ReadonlyMap<string, NormalizedLane>;
  private readonly predecessorLaneIdsById = new Map<string, string[]>();

  constructor(private readonly lanes: readonly NormalizedLane[]) {
    this.lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
    for (const lane of lanes) {
      for (const successorId of lane.successorLaneIds) {
        const predecessors = this.predecessorLaneIdsById.get(successorId);
        if (predecessors) predecessors.push(lane.id);
        else this.predecessorLaneIdsById.set(successorId, [lane.id]);
      }
    }
  }

  pointOnLane(lane: NormalizedLane, rawDistance: number): SimulationPose {
    let distance = rawDistance;
    if (lane.loop && (distance < 0 || distance > lane.length)) {
      distance = ((distance % lane.length) + lane.length) % lane.length;
    } else {
      distance = clamp(distance, 0, lane.length);
    }
    let accumulated = 0;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const segmentLength = lane.segmentLengths[index];
      if (
        distance <= accumulated + segmentLength ||
        index === lane.segmentLengths.length - 1
      ) {
        const amount =
          segmentLength > 0 ? (distance - accumulated) / segmentLength : 0;
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const clampedAmount = clamp(amount, 0, 1);
        const elevationM =
          (start.elevationM ?? 0) +
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * clampedAmount;
        return {
          x: start.x + (end.x - start.x) * clampedAmount,
          z: start.z + (end.z - start.z) * clampedAmount,
          ...(elevationM > 0 ? { elevationM } : {}),
          heading: Math.atan2(end.x - start.x, end.z - start.z),
        };
      }
      accumulated += segmentLength;
    }
    const final = lane.points[lane.points.length - 1];
    return {
      x: final.x,
      z: final.z,
      ...((final.elevationM ?? 0) > 0
        ? { elevationM: final.elevationM }
        : {}),
      heading: 0,
    };
  }

  projectToRoad(
    x: number,
    z: number,
    preference?: RoadProjectionPreference,
  ): LaneProjection | null {
    if (preference) {
      let minimumDistance = Number.POSITIVE_INFINITY;
      let minimumElevationCompatibleDistance = Number.POSITIVE_INFINITY;
      const preferredElevationM = Number.isFinite(preference.preferredElevationM)
        ? Math.max(0, preference.preferredElevationM ?? 0)
        : null;
      const elevationContinuityM = Math.max(
        0,
        Number.isFinite(preference.elevationContinuityM)
          ? (preference.elevationContinuityM ?? 0.55)
          : 0.55,
      );
      const elevationCaptureDistanceM = Math.max(
        0,
        Number.isFinite(preference.elevationCaptureDistanceM)
          ? (preference.elevationCaptureDistanceM ?? 12)
          : 12,
      );
      const continuityLaneIds = new Set<string>();
      const groundProfileCaptureLaneIds = new Set<string>();
      const preferredLane = preference.preferredLaneId
        ? this.lanesById.get(preference.preferredLaneId)
        : undefined;
      if (preferredLane) {
        continuityLaneIds.add(preferredLane.id);
        groundProfileCaptureLaneIds.add(preferredLane.id);
        if (preferredLane.adjacentLaneId) {
          continuityLaneIds.add(preferredLane.adjacentLaneId);
          groundProfileCaptureLaneIds.add(preferredLane.adjacentLaneId);
        }
        for (const laneId of preferredLane.successorLaneIds) {
          continuityLaneIds.add(laneId);
          groundProfileCaptureLaneIds.add(laneId);
          const successor = this.lanesById.get(laneId);
          if (successor?.adjacentLaneId) {
            continuityLaneIds.add(successor.adjacentLaneId);
            groundProfileCaptureLaneIds.add(successor.adjacentLaneId);
          }
        }
        for (const laneId of
          this.predecessorLaneIdsById.get(preferredLane.id) ?? []) {
          continuityLaneIds.add(laneId);
          const predecessor = this.lanesById.get(laneId);
          if (predecessor?.adjacentLaneId) {
            continuityLaneIds.add(predecessor.adjacentLaneId);
          }
        }
      }
      const groundHeightPreference =
        preferredElevationM !== null &&
        preferredElevationM <= ELEVATED_ROAD_STRUCTURE_THRESHOLD_M;
      let hasDirectedRisingProfile = false;
      if (groundHeightPreference) {
        for (const laneId of groundProfileCaptureLaneIds) {
          if (
            (this.lanesById.get(laneId)?.maxElevationM ?? 0) >=
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M
          ) {
            hasDirectedRisingProfile = true;
            break;
          }
        }
      }
      const allowUnconnectedElevationCapture = Boolean(
        preference.allowUnconnectedElevationCapture,
      );
      const scanAllLanesForElevation =
        preferredElevationM !== null &&
        (allowUnconnectedElevationCapture ||
          (continuityLaneIds.size === 0 && !groundHeightPreference));
      for (const lane of this.lanes) {
        const elevationCandidateLane =
          scanAllLanesForElevation ||
          (groundHeightPreference
            ? lane.maxElevationM < ELEVATED_ROAD_STRUCTURE_THRESHOLD_M ||
              groundProfileCaptureLaneIds.has(lane.id)
            : continuityLaneIds.has(lane.id));
        for (let index = 0; index < lane.points.length - 1; index += 1) {
          const start = lane.points[index];
          const end = lane.points[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount =
            lengthSquared > Number.EPSILON
              ? clamp(
                  ((x - start.x) * dx + (z - start.z) * dz) /
                    lengthSquared,
                  0,
                  1,
                )
              : 0;
          const nearestX = start.x + dx * amount;
          const nearestZ = start.z + dz * amount;
          const distance = Math.hypot(x - nearestX, z - nearestZ);
          minimumDistance = Math.min(minimumDistance, distance);
          if (
            elevationCandidateLane &&
            preferredElevationM !== null &&
            Math.abs(
              (start.elevationM ?? 0) +
                ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount -
                preferredElevationM,
            ) <= elevationContinuityM
          ) {
            minimumElevationCompatibleDistance = Math.min(
              minimumElevationCompatibleDistance,
              distance,
            );
          }
        }
      }
      if (!Number.isFinite(minimumDistance)) return null;
      if (
        groundHeightPreference &&
        !Number.isFinite(minimumElevationCompatibleDistance)
      ) {
        return null;
      }
      const lockToContinuousElevation =
        preferredElevationM !== null &&
        (groundHeightPreference ||
          minimumElevationCompatibleDistance <= elevationCaptureDistanceM);
      if (lockToContinuousElevation) {
        minimumDistance = minimumElevationCompatibleDistance;
      }
      const authoredTieEpsilon = Math.max(
        0,
        Number.isFinite(preference.distanceTieEpsilonM)
          ? (preference.distanceTieEpsilonM ?? 0.1)
          : 0.1,
      );
      const tieEpsilon = hasDirectedRisingProfile
        ? Math.max(authoredTieEpsilon, 0.75)
        : authoredTieEpsilon;
      const preferredLaneHysteresisM =
        (preferredLane?.maxElevationM ?? 0) >=
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M
          ? tieEpsilon
          : Math.min(tieEpsilon, 0.025);
      let best: LaneProjection | null = null;
      let bestHeadingDifference = Number.POSITIVE_INFINITY;
      let bestPreferred = false;
      let accumulated = 0;
      for (const lane of this.lanes) {
        const elevationCandidateLane =
          scanAllLanesForElevation ||
          (groundHeightPreference
            ? lane.maxElevationM < ELEVATED_ROAD_STRUCTURE_THRESHOLD_M ||
              groundProfileCaptureLaneIds.has(lane.id)
            : continuityLaneIds.has(lane.id));
        if (lockToContinuousElevation && !elevationCandidateLane) continue;
        accumulated = 0;
        for (let index = 0; index < lane.points.length - 1; index += 1) {
          const start = lane.points[index];
          const end = lane.points[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount =
            lengthSquared > Number.EPSILON
              ? clamp(
                  ((x - start.x) * dx + (z - start.z) * dz) /
                    lengthSquared,
                  0,
                  1,
                )
              : 0;
          const nearestX = start.x + dx * amount;
          const nearestZ = start.z + dz * amount;
          const distance = Math.hypot(x - nearestX, z - nearestZ);
          const elevationM =
            (start.elevationM ?? 0) +
            ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
          if (
            lockToContinuousElevation &&
            preferredElevationM !== null &&
            Math.abs(elevationM - preferredElevationM) > elevationContinuityM
          ) {
            accumulated += lane.segmentLengths[index];
            continue;
          }
          if (distance > minimumDistance + tieEpsilon + 1e-9) {
            accumulated += lane.segmentLengths[index];
            continue;
          }
          const heading = Math.atan2(dx, dz);
          const headingDifference = Math.abs(
            angleDifference(heading, preference.heading),
          );
          const distanceAlong =
            accumulated + lane.segmentLengths[index] * amount;
          const preferred = lane.id === preference.preferredLaneId;
          const preferredLaneDecision =
            best && preferred !== bestPreferred
              ? preferred
                ? distance <= best.distance + preferredLaneHysteresisM
                : distance < best.distance - preferredLaneHysteresisM
              : null;
          if (
            !best ||
            preferredLaneDecision === true ||
            (preferred === bestPreferred &&
              (headingDifference < bestHeadingDifference - 1e-9 ||
                (Math.abs(headingDifference - bestHeadingDifference) <= 1e-9 &&
                  (lane.id < best.lane.id ||
                    (lane.id === best.lane.id &&
                      distanceAlong < best.distanceAlong)))))
          ) {
            best = {
              lane,
              distance,
              distanceAlong,
              heading,
              x: nearestX,
              z: nearestZ,
              elevationM,
            };
            bestHeadingDifference = headingDifference;
            bestPreferred = preferred;
          }
          accumulated += lane.segmentLengths[index];
        }
      }
      return best;
    }

    let best: LaneProjection | null = null;
    for (const lane of this.lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.points.length - 1; index += 1) {
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount =
          lengthSquared > Number.EPSILON
            ? clamp(
                ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared,
                0,
                1,
              )
            : 0;
        const nearestX = start.x + dx * amount;
        const nearestZ = start.z + dz * amount;
        const offsetX = x - nearestX;
        const offsetZ = z - nearestZ;
        const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
        if (!best || distance < best.distance) {
          best = {
            lane,
            distance,
            distanceAlong: accumulated + lane.segmentLengths[index] * amount,
            heading: Math.atan2(dx, dz),
            x: nearestX,
            z: nearestZ,
            elevationM:
              (start.elevationM ?? 0) +
              ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
          };
        }
        accumulated += lane.segmentLengths[index];
      }
    }
    return best;
  }
}
