import {
  ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
  roadLevelAtElevation,
} from "./simulation/roadLevels";

export {
  ELEVATED_ROAD_LEVEL_THRESHOLD_M,
  ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
  ROAD_USER_VERTICAL_CONTACT_M,
  roadElevationsCanInteract,
  roadLevelAtElevation,
} from "./simulation/roadLevels";

/**
 * Pure elevation queries shared by the renderer and both map canvases.
 *
 * Simulation remains planar for steering and route search: x/z decide which
 * legal lane a vehicle occupies, while the lane's authored elevation profile
 * decides where that same vehicle is drawn. Keeping this interpolation here
 * prevents the world, traffic and map UI from inventing subtly different
 * definitions of when a ramp becomes a bridge.
 */

export interface ElevatedRoadPoint {
  readonly x: number;
  readonly z: number;
  readonly elevationM?: number;
}

export interface ElevatedRoadSurface {
  readonly centerline: readonly ElevatedRoadPoint[];
}

const pointElevation = (point: ElevatedRoadPoint): number =>
  Number.isFinite(point.elevationM) ? Math.max(0, point.elevationM ?? 0) : 0;

export function maxRoadElevationM(surface: ElevatedRoadSurface): number {
  return surface.centerline.reduce(
    (highest, point) => Math.max(highest, pointElevation(point)),
    0,
  );
}

export function isElevatedRoadSurface(surface: ElevatedRoadSurface): boolean {
  return maxRoadElevationM(surface) >= ELEVATED_ROAD_STRUCTURE_THRESHOLD_M;
}

/** Elevation of the closest point on a profiled polyline. */
export function elevationOnPolylineAt(
  points: readonly ElevatedRoadPoint[],
  x: number,
  z: number,
): number {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestElevationM = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > Number.EPSILON
        ? Math.max(
            0,
            Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared),
          )
        : 0;
    const nearestX = start.x + dx * amount;
    const nearestZ = start.z + dz * amount;
    const distanceSquared =
      (x - nearestX) * (x - nearestX) + (z - nearestZ) * (z - nearestZ);
    if (distanceSquared >= bestDistanceSquared) continue;
    bestDistanceSquared = distanceSquared;
    bestElevationM =
      pointElevation(start) +
      (pointElevation(end) - pointElevation(start)) * amount;
  }
  return bestElevationM;
}

export function roadSurfaceLevel(
  surface: ElevatedRoadSurface,
): "ground" | "elevated" {
  return roadLevelAtElevation(maxRoadElevationM(surface));
}
