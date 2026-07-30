export const BRIDGE_PARAPET_SHORE_OVERLAP_M = 1.5;
export const BRIDGE_PARAPET_HALF_DEPTH_M = 0.4;
export const BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M = 0.4;

interface BridgePortalPoint {
  readonly x: number;
  readonly z: number;
}

interface BridgePortalWaterBody {
  readonly id: string;
  readonly polygon: readonly BridgePortalPoint[];
  readonly bridgePortalSurfaceIds?: readonly string[];
}

interface BridgePortalRoadSurface {
  readonly id: string;
  readonly centerline: readonly BridgePortalPoint[];
}

export interface BridgePortalRailSpan {
  readonly waterId: string;
  readonly surfaceId: string;
  readonly segmentIndex: number;
  readonly intervalIndex: number;
  readonly center: BridgePortalPoint;
  readonly ux: number;
  readonly uz: number;
  readonly halfLengthM: number;
}

function pointInPolygon(
  point: BridgePortalPoint,
  polygon: readonly BridgePortalPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses =
      current.z > point.z !== prior.z > point.z &&
      point.x <
        ((prior.x - current.x) * (point.z - current.z)) /
          (prior.z - current.z || Number.EPSILON) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentIntersectionTravelParameter(
  segmentStart: BridgePortalPoint,
  segmentEnd: BridgePortalPoint,
  edgeStart: BridgePortalPoint,
  edgeEnd: BridgePortalPoint,
): number | null {
  const segmentX = segmentEnd.x - segmentStart.x;
  const segmentZ = segmentEnd.z - segmentStart.z;
  const edgeX = edgeEnd.x - edgeStart.x;
  const edgeZ = edgeEnd.z - edgeStart.z;
  const denominator = segmentX * edgeZ - segmentZ * edgeX;
  if (Math.abs(denominator) < 1e-8) return null;
  const offsetX = edgeStart.x - segmentStart.x;
  const offsetZ = edgeStart.z - segmentStart.z;
  const travelT = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
  const edgeT = (offsetX * segmentZ - offsetZ * segmentX) / denominator;
  return travelT >= 0 && travelT <= 1 && edgeT >= 0 && edgeT <= 1
    ? travelT
    : null;
}

/**
 * Finds each straight over-water road interval, expanded just far enough onto
 * the bank for its parapet to meet the shoreline collider without a gap.
 */
export function bridgePortalRailSpans(
  water: BridgePortalWaterBody,
  surface: BridgePortalRoadSurface,
  shoreOverlapM = BRIDGE_PARAPET_SHORE_OVERLAP_M,
): readonly BridgePortalRailSpan[] {
  if (
    water.polygon.length < 3 ||
    !water.bridgePortalSurfaceIds?.includes(surface.id)
  ) {
    return [];
  }

  const spans: BridgePortalRailSpan[] = [];
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < surface.centerline.length;
    segmentIndex += 1
  ) {
    const segmentStart = surface.centerline[segmentIndex];
    const segmentEnd = surface.centerline[segmentIndex + 1];
    const segmentX = segmentEnd.x - segmentStart.x;
    const segmentZ = segmentEnd.z - segmentStart.z;
    const segmentLength = Math.hypot(segmentX, segmentZ);
    if (segmentLength < 1) continue;

    const parameters = [0, 1];
    for (let edgeIndex = 0; edgeIndex < water.polygon.length; edgeIndex += 1) {
      const travelT = segmentIntersectionTravelParameter(
        segmentStart,
        segmentEnd,
        water.polygon[edgeIndex],
        water.polygon[(edgeIndex + 1) % water.polygon.length],
      );
      if (travelT !== null) parameters.push(travelT);
    }
    const sorted = parameters
      .sort((left, right) => left - right)
      .filter(
        (value, index, values) =>
          index === 0 || Math.abs(value - values[index - 1]) > 1e-7,
      );
    for (
      let intervalIndex = 0;
      intervalIndex + 1 < sorted.length;
      intervalIndex += 1
    ) {
      const intervalStart = sorted[intervalIndex];
      const intervalEnd = sorted[intervalIndex + 1];
      const midpointT = (intervalStart + intervalEnd) / 2;
      if (
        !pointInPolygon(
          {
            x: segmentStart.x + segmentX * midpointT,
            z: segmentStart.z + segmentZ * midpointT,
          },
          water.polygon,
        )
      ) {
        continue;
      }

      const overlapT = Math.max(0, shoreOverlapM) / segmentLength;
      const railStart = Math.max(0, intervalStart - overlapT);
      const railEnd = Math.min(1, intervalEnd + overlapT);
      const railMidpoint = (railStart + railEnd) / 2;
      spans.push({
        waterId: water.id,
        surfaceId: surface.id,
        segmentIndex,
        intervalIndex,
        center: {
          x: segmentStart.x + segmentX * railMidpoint,
          z: segmentStart.z + segmentZ * railMidpoint,
        },
        ux: segmentX / segmentLength,
        uz: segmentZ / segmentLength,
        halfLengthM: ((railEnd - railStart) * segmentLength) / 2,
      });
    }
  }
  return spans;
}
