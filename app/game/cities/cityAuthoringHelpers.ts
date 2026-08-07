import type {
  FrozenMapSource,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapSpawnPoint,
  RoadMarkingPath,
  RoadMarkingStyle,
  RoadSurface,
  RoadSurfaceType,
  SpeedUnit,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  TrafficSide,
  WorldPoint,
} from "../types";
import { buildLaneTrueGeometry } from "../laneConnectors";

/**
 * Authoring helpers shared by `cities/nyc.ts`, `cities/tokyo.ts` and
 * `cities/london.ts` (issue #287). Until this module existed, each of the
 * three carried its own byte-identical (or near-identical) copy of every
 * function below — verified byte-identical to the original source at the
 * decomposition program's extraction time, but duplication drifts: a bugfix
 * or a new field to one city's copy has no way to reach the others.
 *
 * `cities/cairo.ts` has its own structurally different road-spec generator
 * and is not part of this cluster. London lacks `roadIdForLane`,
 * `laneWidthForLane`, `conflictZoneForNode`, `laneTrue` and `osmSource`'s
 * exact shape (different lane-width rule, hardcoded left-hand `trafficSide`,
 * no `localSpeedUnit`) — those stay NYC/Tokyo-only here; forcing London onto
 * the same shapes would change what it generates, not just where the code
 * lives. `makeSpeedLimitForRoad` is the exception: all three cities' own
 * per-road tables are structurally `Record<string, number>` regardless of
 * how narrowly each declares its literal, so all three share it.
 *
 * `laneTrue` and `osmSource` close over one per-file value each
 * (`speedLimitForRoad`, the reviewed-on date) that only NYC and Tokyo happen
 * to want in the same shape — `makeLaneTrue`/`makeOsmSource` take that value
 * once and return the exact original function, so every existing call site
 * in both files (NYC's single grid-builder call; Tokyo's 56 hand-authored
 * ones) is unchanged, unaware its implementation now lives here.
 */

export const point = (x: number, z: number): WorldPoint => ({ x, z });

export const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

export const distanceBetweenPoints = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

export const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

export const roadMarking = (
  id: string,
  style: RoadMarkingStyle,
  points: readonly WorldPoint[],
  color?: RoadMarkingPath["color"],
): RoadMarkingPath => ({ id, style, points, ...(color ? { color } : {}) });

export const roadSurface = (
  id: string,
  centerline: readonly WorldPoint[],
  widthM: number,
  laneIds: readonly string[],
  surfaceType: RoadSurfaceType = "standard",
  markings: readonly RoadMarkingPath[] = [],
): RoadSurface => ({
  id,
  centerline,
  widthM,
  laneIds,
  surfaceType,
  markings,
});

export const anchoredSpawn = (
  id: string,
  kind: "player" | "vehicle",
  laneId: string,
  distanceAlongM: number,
): MapSpawnPoint => ({
  id,
  kind,
  anchor: anchor(laneId, distanceAlongM),
});

export const freeSpawn = (
  id: string,
  kind: "pedestrian" | "cyclist",
  x: number,
  z: number,
  headingDeg: number,
  laneId?: string,
): MapSpawnPoint => ({
  id,
  kind,
  pose: { position: point(x, z), headingDeg },
  ...(laneId ? { laneId } : {}),
});

export const approach = (
  id: string,
  laneId: string,
  distanceAlongM: number,
  phaseGroup: string,
  conflictZoneIds?: readonly string[],
): TrafficControlApproach => ({
  id,
  laneIds: [laneId],
  stopLine: anchor(laneId, distanceAlongM),
  phaseGroup,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
});

export const installation = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
  mounting: TrafficControlInstallation["mounting"],
  style: TrafficControlInstallation["style"],
  role: TrafficControlInstallation["role"],
  approachIds?: readonly string[],
  armHeadingDeg?: number,
): TrafficControlInstallation => ({
  id,
  position: point(x, z),
  headingDeg,
  mounting,
  style,
  role,
  ...(approachIds ? { approachIds } : {}),
  ...(armHeadingDeg === undefined ? {} : { armHeadingDeg }),
});

export const control = (
  id: string,
  type: TrafficControl["type"],
  x: number,
  z: number,
  headingDeg: number,
  laneIds: readonly string[],
  conflictZoneIds?: readonly string[],
  approaches: readonly TrafficControlApproach[] = [],
  installations: readonly TrafficControlInstallation[] = [],
): TrafficControl => ({
  id,
  type,
  position: point(x, z),
  headingDeg,
  laneIds,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
  approaches,
  installations,
});

export const CONNECTOR_ZONE_RADIUS_M = 2.1;

/**
 * Declares a compact conflict zone around every generic graph junction used
 * by an explicit connector range. Authored signal/roundabout zones keep their
 * wider polygons, while their lane membership is augmented automatically.
 */
export const connectorConflictZones = (
  lanes: readonly LaneSegment[],
  authoredZones: LaneGraph["conflictZones"],
): LaneGraph["conflictZones"] => {
  const connectorLaneIds = new Map<string, Set<string>>();
  const generatedCenters = new Map<string, WorldPoint>();
  const authoredIds = new Set(authoredZones.map((zone) => zone.id));

  for (const lane of lanes) {
    for (const range of lane.connectorRanges ?? []) {
      const conflictZoneId = range.conflictZoneId;
      if (!conflictZoneId) continue;
      const laneIds = connectorLaneIds.get(conflictZoneId) ?? new Set<string>();
      laneIds.add(lane.id);
      connectorLaneIds.set(conflictZoneId, laneIds);
      if (!authoredIds.has(conflictZoneId)) {
        generatedCenters.set(
          conflictZoneId,
          range.startDistanceAlongM <= 1e-6
            ? lane.centerline[0]
            : lane.centerline.at(-1)!,
        );
      }
    }
  }

  const authored = authoredZones.map((zone) => ({
    ...zone,
    laneIds: [
      ...new Set([
        ...zone.laneIds,
        ...(connectorLaneIds.get(zone.id) ?? []),
      ]),
    ],
  }));
  const generated = [...generatedCenters].map(([id, center]) => ({
    id,
    laneIds: [...(connectorLaneIds.get(id) ?? [])],
    polygon: [
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
    ],
  }));
  return [...authored, ...generated];
};

// --- NYC/Tokyo-only cluster below: London's own copies genuinely differ ----

/**
 * NYC is not here: its lanes come from `buildNycGrid`, which knows each
 * lane's road and passes the id straight to `laneTrue`. A prefix table would
 * have to grow a branch per street and would quietly mis-assign any it missed.
 */
export const roadIdForLane = (id: string): string => {
  if (id.startsWith("yard-r-")) return "yard-right-loop";
  if (id.startsWith("yard-l-")) return "yard-left-loop";
  if (id.startsWith("jp-south-east")) return "jp-south-road";
  if (id.startsWith("jp-curve")) return "jp-east-curve";
  if (id.startsWith("jp-center-west")) return "jp-center-road";
  if (id.startsWith("jp-west-north")) return "jp-west-road";
  if (id.startsWith("jp-north-east")) return "jp-north-road";
  if (id.startsWith("jp-junction-south")) return "jp-junction-road";
  if (id.startsWith("jp-narrow-north")) return "jp-narrow-road";
  return id;
};

export const laneWidthForLane = (id: string): number => {
  if (id.startsWith("jp-")) return id.includes("narrow") ? 2.7 : 3.0;
  if (id.startsWith("nyc-")) return 3.4;
  return 3.2;
};

export const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "nyc-b") return "nyc-conflict-72-bway";
  if (nodeId === "nyc-h") return "nyc-conflict-79-bway";
  if (nodeId === "nyc-d") return "nyc-conflict-columbus";
  if (nodeId === "jp-f") return "jp-station-conflict";
  if (nodeId === "jp-d") return "jp-east-curve-junction-conflict";
  if (nodeId === "jp-e") return "jp-east-neighbourhood-junction-conflict";
  return `junction-${nodeId}`;
};

/**
 * Throws rather than defaulting — a road with no posted limit is an
 * authoring omission, and a silent fallback would put ambient traffic
 * through it at whatever the guess happened to be. Runs at module scope, so
 * the failure lands on import — every test at once, naming the road.
 */
export const makeSpeedLimitForRoad =
  (table: Readonly<Record<string, number>>) =>
  (roadId: string): number => {
    const limit = table[roadId];
    if (limit === undefined) {
      throw new Error(`No speed limit posted for road "${roadId}"`);
    }
    return limit;
  };

/**
 * Keeps an authored lateral lane offset all the way to a junction, easing any
 * convergence on a shared node through a sampled S-curve blend (see
 * `laneConnectors.ts`) so segment headings never jump junction-crossing NPCs
 * sideways (#19). The logical graph nodes remain shared so existing route IDs
 * and deterministic successor routing stay stable.
 *
 * Takes `speedLimitForRoad` rather than a lookup table directly so it reads
 * the same as the un-curried original at every call site: each city writes
 * `const laneTrue = makeLaneTrue(speedLimitForRoad);` once, then calls
 * `laneTrue(...)` exactly as before.
 */
export const makeLaneTrue =
  (speedLimitForRoad: (roadId: string) => number) =>
  (
    id: string,
    from: LaneNode,
    to: LaneNode,
    trafficSide: TrafficSide,
    successors: readonly string[],
    role: LaneRole,
    establishedPath: readonly WorldPoint[],
    adjacentLaneIds?: readonly string[],
    roadId: string = roadIdForLane(id),
    widthM = laneWidthForLane(id),
    localSpeedUnit?: SpeedUnit,
  ): LaneSegment => {
    const { centerline, startConnectorLengthM, endConnectorLengthM, totalLengthM } =
      buildLaneTrueGeometry(from.position, to.position, establishedPath);

    return {
      id,
      roadId,
      widthM,
      from: from.id,
      to: to.id,
      centerline,
      role,
      trafficSide,
      speedLimit: speedLimitForRoad(roadId),
      ...(localSpeedUnit ? { localSpeedUnit } : {}),
      successors,
      ...(adjacentLaneIds ? { adjacentLaneIds } : {}),
      connectorRanges: [
        {
          startDistanceAlongM: 0,
          endDistanceAlongM: startConnectorLengthM,
          ...(conflictZoneForNode(from.id)
            ? { conflictZoneId: conflictZoneForNode(from.id) }
            : {}),
        },
        {
          startDistanceAlongM: totalLengthM - endConnectorLengthM,
          endDistanceAlongM: totalLengthM,
          ...(conflictZoneForNode(to.id)
            ? { conflictZoneId: conflictZoneForNode(to.id) }
            : {}),
        },
      ],
    };
  };

export const graph = (
  nodes: readonly LaneNode[],
  lanes: readonly LaneSegment[],
  controls: LaneGraph["controls"],
  conflictZones: LaneGraph["conflictZones"],
  spawnPoints: LaneGraph["spawnPoints"],
): LaneGraph => ({
  nodes,
  lanes,
  controls,
  conflictZones: connectorConflictZones(lanes, conflictZones),
  spawnPoints,
});

/** Same curry reason as `makeLaneTrue`: each city's `capturedOn` is its own
 * `*_CONTENT_REVIEWED_ON` constant, everything else about the source record
 * is identical. */
export const makeOsmSource =
  (reviewedOn: string) =>
  (
    boundingBox: FrozenMapSource["boundingBox"],
    sourceUrl: string,
    checksum: string,
    additionalBoundingBoxes?: readonly FrozenMapSource["boundingBox"][],
  ): FrozenMapSource => ({
    boundingBox,
    ...(additionalBoundingBoxes ? { additionalBoundingBoxes } : {}),
    capturedOn: reviewedOn,
    sourceUrl,
    checksum,
    importerVersion: "sideswap-procedural-1.0.0",
    attribution: "© OpenStreetMap contributors",
    licenseName: "Open Data Commons Open Database License 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  });
