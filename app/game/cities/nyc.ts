import type {
  FreeDriveDefinition,
  FrozenMapSource,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapCheckpoint,
  MapPack,
  MapSpawnPoint,
  ProceduralBlock,
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
import { buildLaneTrueGeometry, CONNECTOR_BLEND_RUN_M } from "../laneConnectors";

/** This file's own last-reviewed date — was `content.ts`'s `CONTENT_REVIEWED_ON`
 * (still "2026-07-10" as of the move) before this content had its own file;
 * kept local rather than imported back from `content.ts` to avoid a cycle
 * (`content.ts` imports `NYC_MAP_PACK` from here). */
export const NYC_CONTENT_REVIEWED_ON = "2026-07-10";

const point = (x: number, z: number): WorldPoint => ({ x, z });

const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

const roadIdForLane = (id: string): string => {
  if (id.startsWith("yard-r-")) return "yard-right-loop";
  if (id.startsWith("yard-l-")) return "yard-left-loop";
  // NYC is not here: its lanes come from buildNycGrid, which knows each lane's
  // road and passes the id straight to `laneTrue`. A prefix table would have to
  // grow a branch per street and would quietly mis-assign any it missed.
  if (id.startsWith("jp-south-east")) return "jp-south-road";
  if (id.startsWith("jp-curve")) return "jp-east-curve";
  if (id.startsWith("jp-center-west")) return "jp-center-road";
  if (id.startsWith("jp-west-north")) return "jp-west-road";
  if (id.startsWith("jp-north-east")) return "jp-north-road";
  if (id.startsWith("jp-junction-south")) return "jp-junction-road";
  if (id.startsWith("jp-narrow-north")) return "jp-narrow-road";
  return id;
};

const laneWidthForLane = (id: string): number => {
  if (id.startsWith("jp-")) return id.includes("narrow") ? 2.7 : 3.0;
  if (id.startsWith("nyc-")) return 3.4;
  return 3.2;
};

const distanceBetweenPoints = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "nyc-b") return "nyc-conflict-72-bway";
  if (nodeId === "nyc-h") return "nyc-conflict-79-bway";
  if (nodeId === "nyc-d") return "nyc-conflict-columbus";
  if (nodeId === "jp-f") return "jp-station-conflict";
  if (nodeId === "jp-d") return "jp-east-curve-junction-conflict";
  if (nodeId === "jp-e") return "jp-east-neighbourhood-junction-conflict";
  return `junction-${nodeId}`;
};

/**
 * Keeps an authored lateral lane offset all the way to a junction, easing any
 * convergence on a shared node through a sampled S-curve blend (see
 * `laneConnectors.ts`) so segment headings never jump junction-crossing NPCs
 * sideways (#19). The logical graph nodes remain shared so existing route IDs
 * and deterministic successor routing stay stable.
 */
const laneTrue = (
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

const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

const roadMarking = (
  id: string,
  style: RoadMarkingStyle,
  points: readonly WorldPoint[],
  color?: RoadMarkingPath["color"],
): RoadMarkingPath => ({ id, style, points, ...(color ? { color } : {}) });

const roadSurface = (
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

const checkpoint = (
  id: string,
  label: string,
  laneId: string,
  distanceAlongM: number,
): MapCheckpoint => ({
  id,
  label,
  anchor: anchor(laneId, distanceAlongM),
});

const anchoredSpawn = (
  id: string,
  kind: "player" | "vehicle",
  laneId: string,
  distanceAlongM: number,
): MapSpawnPoint => ({
  id,
  kind,
  anchor: anchor(laneId, distanceAlongM),
});

const freeSpawn = (
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

const approach = (
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

const installation = (
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

const control = (
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

const laneLengthOf = (lane: LaneSegment): number =>
  lane.centerline.slice(1).reduce(
    (total, current, index) =>
      total + distanceBetweenPoints(lane.centerline[index], current),
    0,
  );

/** Heading (deg, 0 = +z) of the lane's travel direction at a given arclength. */
const laneHeadingAtDistanceDeg = (lane: LaneSegment, distanceAlongM: number): number => {
  let accumulated = 0;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const a = lane.centerline[index];
    const b = lane.centerline[index + 1];
    const segmentLength = distanceBetweenPoints(a, b);
    if (accumulated + segmentLength >= distanceAlongM || index === lane.centerline.length - 2) {
      return (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI;
    }
    accumulated += segmentLength;
  }
  return 0;
};

/**
 * Builds a signalised junction from the lanes that arrive at it. Each arriving
 * lane gets a stop-line approach 6 m short of the node; each approach
 * *direction* gets one mast across the junction at the far corner — the way
 * NYC hangs its signals — so the driver waiting at the stop line can see
 * their own light, with parallel lanes sharing the mast (#149). North/south
 * lanes and east/west lanes sit on alternating phase groups. This is
 * correct-by-construction, so head headings and stop distances can't drift
 * from the geometry the way hand-authored signals do.
 */
const intersectionSignal = (
  id: string,
  center: WorldPoint,
  arms: readonly { readonly laneId: string; readonly phase: "ns" | "ew" }[],
  lanes: readonly LaneSegment[],
): { readonly control: TrafficControl; readonly zone: LaneGraph["conflictZones"][number] } => {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const zoneId = `${id}-zone`;
  const laneIds = arms.map((arm) => arm.laneId);
  const approaches: TrafficControlApproach[] = [];
  const installations: TrafficControlInstallation[] = [];
  const masts = new Map<
    number,
    { approachIds: string[]; firstLaneId: string; headingDeg: number }
  >();
  for (const arm of arms) {
    const lane = laneById.get(arm.laneId);
    if (!lane) continue;
    const stopDistance = Math.max(0, laneLengthOf(lane) - 6);
    // Sample the heading clear of the junction connector blend: a laneTrue
    // centreline eases onto the shared node over its last ~6 m, so the local
    // heading right at the stop line sits a few degrees off the road axis
    // (#149 — slanted stop bars and skewed mast corners).
    const headingDeg = laneHeadingAtDistanceDeg(
      lane,
      Math.max(0, stopDistance - CONNECTOR_BLEND_RUN_M - 1),
    );
    const approachId = `${id}-${arm.laneId}-app`;
    approaches.push(approach(approachId, arm.laneId, stopDistance, `${id}-${arm.phase}`, [zoneId]));
    const mast = masts.get(Math.round(headingDeg));
    if (mast) {
      mast.approachIds.push(approachId);
    } else {
      masts.set(Math.round(headingDeg), {
        approachIds: [approachId],
        firstLaneId: arm.laneId,
        headingDeg,
      });
    }
  }
  for (const mast of masts.values()) {
    const rad = (mast.headingDeg * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirZ = Math.cos(rad);
    // Mount at the corner diagonally forward-right of the approach — across
    // the junction, well clear of both carriageways (±8 m from a node whose
    // lanes span only ~±3.4 m).
    const headX = center.x + dirZ * 8 + dirX * 8;
    const headZ = center.z - dirX * 8 + dirZ * 8;
    // The pole stands past the junction, offset to the right of the
    // approach. Its mast arm has to reach back the other way — in over the
    // carriageway — so the head hangs above the lanes it governs instead of
    // out over the grass. The renderer extends the arm along `armHeadingDeg`,
    // whose zero direction points the same way the pole is offset, so aim it
    // opposite: headingDeg + 180.
    const armHeadingDeg = mast.headingDeg + 180;
    installations.push(installation(`${id}-${mast.firstLaneId}-head`, headX, headZ, mast.headingDeg, "mast_arm", "nyc_signal", "primary", mast.approachIds, armHeadingDeg));
  }
  const half = 7;
  return {
    control: control(id, "signal", center.x, center.z, 0, laneIds, [zoneId], approaches, installations),
    zone: {
      id: zoneId,
      laneIds,
      polygon: [
        point(center.x - half, center.z - half),
        point(center.x + half, center.z - half),
        point(center.x + half, center.z + half),
        point(center.x - half, center.z + half),
      ],
    },
  };
};

const CONNECTOR_ZONE_RADIUS_M = 2.1;

/**
 * Declares a compact conflict zone around every generic graph junction used
 * by an explicit connector range. Authored signal/roundabout zones keep their
 * wider polygons, while their lane membership is augmented automatically.
 */
const connectorConflictZones = (
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

const graph = (
  nodes: readonly LaneNode[],
  lanes: readonly LaneSegment[],
  controls: LaneGraph["controls"],
  conflictZones: LaneGraph["conflictZones"],
  spawnPoints: LaneGraph["spawnPoints"],
  checkpoints: LaneGraph["checkpoints"],
): LaneGraph => ({
  nodes,
  lanes,
  controls,
  conflictZones: connectorConflictZones(lanes, conflictZones),
  spawnPoints,
  checkpoints,
});

const osmSource = (
  boundingBox: FrozenMapSource["boundingBox"],
  sourceUrl: string,
  checksum: string,
  additionalBoundingBoxes?: readonly FrozenMapSource["boundingBox"][],
): FrozenMapSource => ({
  boundingBox,
  ...(additionalBoundingBoxes ? { additionalBoundingBoxes } : {}),
  capturedOn: NYC_CONTENT_REVIEWED_ON,
  sourceUrl,
  checksum,
  importerVersion: "sideswap-procedural-1.0.0",
  attribution: "© OpenStreetMap contributors",
  licenseName: "Open Data Commons Open Database License 1.0",
  licenseUrl: "https://www.openstreetmap.org/copyright",
});

// Upper West Side grid. x = east, z = north. Three two-way avenues — West End
// (x=-320), Broadway (x=-120), Central Park West (x=320) — cross three two-way
// streets — West 72nd (z=-480), 79th (z=0), 86th (z=480). ~640 m x 960 m.
// ---------------------------------------------------------------------------
// NYC is declared as a grid, not written out lane by lane.
//
// The Upper West Side is rectangular, so the map states its avenues and cross
// streets once and derives the ~200 lanes, their lateral offsets, their
// successors, the carriageway surfaces and the signals from that. Hand-writing
// successors at this size goes wrong silently: a lane with no legal
// continuation makes its traffic vanish wherever the player happens to be
// looking (#128), and nothing about the authored literal looks wrong. Derived,
// "every lane leads somewhere legal" holds by construction.
//
// Geography follows the frozen OSM extract in public/map-data/nyc-upper-west
// .json and the real grid: avenues west to east are Riverside Drive, West End,
// Broadway, Amsterdam, Columbus and Central Park West; Amsterdam runs one-way
// uptown and Columbus one-way downtown; the major crosstown streets are
// two-way; the side streets alternate, even eastbound and odd westbound.
// ---------------------------------------------------------------------------

/** Lateral offset of a lane line from its carriageway centreline. */
const NYC_LANE_OFFSET_M = 1.7;
/** Beyond this a successor is a U-turn, not a turn. */
const NYC_MAX_TURN_RAD = (120 * Math.PI) / 180;

type NycAxis = "avenue" | "street";

interface NycRoadSpec {
  /** Lane-id fragment: "we" gives nyc-we-n-1. */
  readonly key: string;
  /** Node-id fragment. Broadway's nodes are `bw` while its lanes are `bway`. */
  readonly nodeKey: string;
  readonly roadId: string;
  /** What a driver would call this street. Kept on the spec so adding a road
   * stays one line, name included. */
  readonly name: string;
  /**
   * Posted limit in mph. Required, and on the spec for the same reason the name
   * is: a new street declares everything about itself on the one line that
   * declares it, and the compiler will not let that line omit this.
   */
  readonly speedLimit: number;
  /** x for an avenue, z for a cross street. */
  readonly coordinate: number;
  readonly widthM: number;
  /**
   * null when two-way. "forward" is north for an avenue and east for a cross
   * street; "backward" is the other way.
   */
  readonly oneWay: "forward" | "backward" | null;
  /** Lanes carried in each legal direction. */
  readonly lanesPerDirection: number;
  /**
   * Which lane number sits against the kerb on a multi-lane one-way, and so
   * takes the right turns. Defaults to the outermost. Amsterdam and Columbus
   * were authored numbering from opposite sides and their ids are referred to
   * by venues, spawns and checkpoints, so the numbering is recorded rather
   * than normalised.
   */
  readonly kerbsideLaneNo?: number;
  /**
   * Crossing roads this one reaches, by key. Omitted means all of them —
   * Riverside Drive is the short one, starting at 72nd as it really does.
   */
  readonly crossings?: readonly string[];
}

/** West to east. */
const NYC_AVENUES: readonly NycRoadSpec[] = [
  // Riverside Drive begins at 72nd, as it really does, so it skips the southern
  // rows and the grid's west edge steps in below them.
  { key: "riv", nodeKey: "riv", roadId: "nyc-riverside", name: "Riverside Dr", speedLimit: 25, coordinate: -460, widthM: 11, oneWay: null, lanesPerDirection: 1, crossings: ["72", "75", "79", "82", "86", "91", "96", "100", "106"] },
  { key: "we", nodeKey: "we", roadId: "nyc-west-end", name: "West End Ave", speedLimit: 25, coordinate: -320, widthM: 11, oneWay: null, lanesPerDirection: 1 },
  { key: "bway", nodeKey: "bw", roadId: "nyc-broadway", name: "Broadway", speedLimit: 30, coordinate: -120, widthM: 11, oneWay: null, lanesPerDirection: 1 },
  { key: "amst", nodeKey: "amst", roadId: "nyc-amsterdam", name: "Amsterdam Ave", speedLimit: 30, coordinate: 40, widthM: 9, oneWay: "forward", lanesPerDirection: 2 },
  { key: "col", nodeKey: "col", roadId: "nyc-columbus", name: "Columbus Ave", speedLimit: 30, coordinate: 180, widthM: 9, oneWay: "backward", lanesPerDirection: 2, kerbsideLaneNo: 1 },
  { key: "cpw", nodeKey: "cpw", roadId: "nyc-central-park-west", name: "Central Park West", speedLimit: 25, coordinate: 320, widthM: 11, oneWay: null, lanesPerDirection: 1 },
];

/**
 * South to north. The wide two-way ones are the crosstown streets that really
 * are two-way; between each pair runs a narrow side street, one-way, and
 * alternating the way Manhattan's do — even numbers eastbound, odd westbound.
 * They exist so there is somewhere to turn: without them the avenues run 480 m
 * (six real blocks) between junctions.
 */
const NYC_STREETS: readonly NycRoadSpec[] = [
  { key: "59", nodeKey: "59", roadId: "nyc-west-59", name: "W 59th St", speedLimit: 30, coordinate: -1440, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "61", nodeKey: "61", roadId: "nyc-west-61", name: "W 61st St", speedLimit: 25, coordinate: -1200, widthM: 9, oneWay: "backward", lanesPerDirection: 1 },
  { key: "65", nodeKey: "65", roadId: "nyc-west-65", name: "W 65th St", speedLimit: 30, coordinate: -960, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "68", nodeKey: "68", roadId: "nyc-west-68", name: "W 68th St", speedLimit: 25, coordinate: -720, widthM: 9, oneWay: "forward", lanesPerDirection: 1 },
  { key: "72", nodeKey: "72", roadId: "nyc-west-72", name: "W 72nd St", speedLimit: 30, coordinate: -480, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "75", nodeKey: "75", roadId: "nyc-west-75", name: "W 75th St", speedLimit: 25, coordinate: -240, widthM: 9, oneWay: "backward", lanesPerDirection: 1 },
  { key: "79", nodeKey: "79", roadId: "nyc-west-79", name: "W 79th St", speedLimit: 30, coordinate: 0, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  // W 82nd stops at Columbus: the museum and its grounds fill the block through
  // to Central Park West, exactly as they interrupt the real street grid there.
  { key: "82", nodeKey: "82", roadId: "nyc-west-82", name: "W 82nd St", speedLimit: 25, coordinate: 240, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: ["riv", "we", "bway", "amst", "col"] },
  { key: "86", nodeKey: "86", roadId: "nyc-west-86", name: "W 86th St", speedLimit: 30, coordinate: 480, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "91", nodeKey: "91", roadId: "nyc-west-91", name: "W 91st St", speedLimit: 25, coordinate: 720, widthM: 9, oneWay: "backward", lanesPerDirection: 1 },
  { key: "96", nodeKey: "96", roadId: "nyc-west-96", name: "W 96th St", speedLimit: 30, coordinate: 960, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "100", nodeKey: "100", roadId: "nyc-west-100", name: "W 100th St", speedLimit: 25, coordinate: 1200, widthM: 9, oneWay: "forward", lanesPerDirection: 1 },
  { key: "106", nodeKey: "106", roadId: "nyc-west-106", name: "W 106th St", speedLimit: 30, coordinate: 1440, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
];

/**
 * Every NYC road and what it is posted at, keyed by `RoadSurface.id` — the
 * same key space as `LaneSegment.roadId`. Declared once, on each road's
 * `NycRoadSpec`, and `laneTrue` stamps it onto every lane of that road.
 *
 * Choose the figure from what the road *is*, in this order: frontage
 * (housing, park, school, shared space lower it), then class (arterial >
 * through street > local > mews/service/roundabout), then geometry (width,
 * lane count, curvature, junction density). Never post a number the host
 * country does not use — `roadRealism.test.ts` holds you to a per-country
 * list.
 */
const ROAD_SPEED_LIMITS: Readonly<Record<string, number>> = Object.fromEntries(
  [...NYC_AVENUES, ...NYC_STREETS].map((road) => [road.roadId, road.speedLimit]),
);

/** Throws rather than defaulting — a road with no posted limit is an
 * authoring omission, and a silent fallback would put ambient traffic
 * through it at whatever the guess happened to be. Runs at module scope, so
 * the failure lands on import — every test at once, naming the road. Same
 * shape as `tokyo.ts`'s and `londonContent.ts`'s own copies. */
const speedLimitForRoad = (roadId: string): number => {
  const limit = ROAD_SPEED_LIMITS[roadId];
  if (limit === undefined) {
    throw new Error(`No speed limit posted for road "${roadId}"`);
  }
  return limit;
};

interface NycGridLane {
  readonly id: string;
  readonly road: NycRoadSpec;
  readonly axis: NycAxis;
  /** North on an avenue, east on a cross street. */
  readonly forward: boolean;
  readonly laneNo: number;
  readonly fromNode: LaneNode;
  readonly toNode: LaneNode;
  readonly via: WorldPoint;
  readonly headingRad: number;
}

const nycSignedTurn = (from: number, to: number): number => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

/** Which lane of a multi-lane one-way sits against the kerb. */
const nycKerbsideLaneNo = (road: NycRoadSpec): number =>
  road.kerbsideLaneNo ?? road.lanesPerDirection;

/**
 * Lays the whole grid: a node per crossing the two roads both reach, a lane per
 * span per legal direction per lane, successors covering every turn a driver
 * may legally make there, one carriageway surface per road, and a signal at
 * every crossing fed by more than one road.
 */
function buildNycGrid(
  avenues: readonly NycRoadSpec[],
  streets: readonly NycRoadSpec[],
): {
  readonly nodes: readonly LaneNode[];
  readonly lanes: readonly LaneSegment[];
  readonly roadSurfaces: readonly RoadSurface[];
  readonly signals: readonly ReturnType<typeof intersectionSignal>[];
  readonly roadNames: Readonly<Record<string, string>>;
} {
  const reaches = (avenue: NycRoadSpec, street: NycRoadSpec): boolean =>
    (avenue.crossings ?? streets.map((s) => s.key)).includes(street.key) &&
    (street.crossings ?? avenues.map((a) => a.key)).includes(avenue.key);

  const nodeId = (avenue: NycRoadSpec, street: NycRoadSpec) =>
    `nyc-${avenue.nodeKey}-${street.key}`;
  const nodesById = new Map<string, LaneNode>();
  const nodeOrder: LaneNode[] = [];
  for (const street of streets) {
    for (const avenue of avenues) {
      if (!reaches(avenue, street)) continue;
      const built = node(
        nodeId(avenue, street),
        avenue.coordinate,
        street.coordinate,
      );
      nodesById.set(built.id, built);
      nodeOrder.push(built);
    }
  }

  /** The crossings a road actually meets, in ascending coordinate order. */
  const crossingsOf = (road: NycRoadSpec, axis: NycAxis): NycRoadSpec[] =>
    (axis === "avenue" ? streets : avenues).filter((cross) =>
      axis === "avenue" ? reaches(road, cross) : reaches(cross, road),
    );

  const gridLanes: NycGridLane[] = [];
  const build = (road: NycRoadSpec, axis: NycAxis) => {
    const crossings = crossingsOf(road, axis);
    const letters = axis === "avenue" ? (["n", "s"] as const) : (["e", "w"] as const);
    const kerbside = nycKerbsideLaneNo(road);
    for (const forward of [true, false] as const) {
      if (road.oneWay === "forward" && !forward) continue;
      if (road.oneWay === "backward" && forward) continue;
      const ordered = forward ? crossings : [...crossings].reverse();
      for (let span = 0; span + 1 < ordered.length; span += 1) {
        const startCross = ordered[span];
        const endCross = ordered[span + 1];
        const fromNode = nodesById.get(
          axis === "avenue" ? nodeId(road, startCross) : nodeId(startCross, road),
        )!;
        const toNode = nodesById.get(
          axis === "avenue" ? nodeId(road, endCross) : nodeId(endCross, road),
        )!;
        const headingRad = Math.atan2(
          toNode.position.x - fromNode.position.x,
          toNode.position.z - fromNode.position.z,
        );
        // Right-hand normal of the direction of travel — the driver's right.
        const rightX = Math.cos(headingRad);
        const rightZ = -Math.sin(headingRad);
        for (let laneNo = 1; laneNo <= road.lanesPerDirection; laneNo += 1) {
          // Named for the crossing the block starts at, in travel order, so an
          // id says where it is and stays put when a new street splits the
          // block next to it. Numbering the spans instead meant every lane on
          // an avenue was renamed by inserting one street across it.
          const id =
            road.lanesPerDirection > 1
              ? `nyc-${road.key}-${letters[forward ? 0 : 1]}-${laneNo}-${startCross.key}`
              : `nyc-${road.key}-${letters[forward ? 0 : 1]}-${startCross.key}`;
          // A two-way road puts each direction on its own right; a multi-lane
          // one-way splits its lanes either side of the carriageway centre; a
          // single-lane one-way simply is the centreline.
          const offset =
            road.oneWay === null
              ? NYC_LANE_OFFSET_M
              : road.lanesPerDirection === 1
                ? 0
                : laneNo === kerbside
                  ? NYC_LANE_OFFSET_M
                  : -NYC_LANE_OFFSET_M;
          gridLanes.push({
            id,
            road,
            axis,
            forward,
            laneNo,
            fromNode,
            toNode,
            headingRad,
            via: point(
              (fromNode.position.x + toNode.position.x) / 2 + rightX * offset,
              (fromNode.position.z + toNode.position.z) / 2 + rightZ * offset,
            ),
          });
        }
      }
    }
  };
  for (const avenue of avenues) build(avenue, "avenue");
  for (const street of streets) build(street, "street");

  const departuresByNode = new Map<string, NycGridLane[]>();
  const arrivalsByNode = new Map<string, NycGridLane[]>();
  for (const lane of gridLanes) {
    departuresByNode.set(lane.fromNode.id, [
      ...(departuresByNode.get(lane.fromNode.id) ?? []),
      lane,
    ]);
    arrivalsByNode.set(lane.toNode.id, [
      ...(arrivalsByNode.get(lane.toNode.id) ?? []),
      lane,
    ]);
  }

  const successorsFor = (lane: NycGridLane): string[] => {
    const departures = departuresByNode.get(lane.toNode.id) ?? [];
    const straight = departures.find(
      (next) =>
        next.road.key === lane.road.key &&
        next.forward === lane.forward &&
        next.laneNo === lane.laneNo,
    );
    // One entry per crossing road and direction: turning onto a multi-lane
    // one-way you take its inner lane going left and its kerbside lane going
    // right, which is also what feeds traffic into both of them.
    const turns: { id: string; turn: number }[] = [];
    const seen = new Set<string>();
    for (const next of departures) {
      if (next.road.key === lane.road.key) continue;
      const turn = nycSignedTurn(lane.headingRad, next.headingRad);
      if (Math.abs(turn) > NYC_MAX_TURN_RAD) continue; // a U-turn, not a turn
      const armKey = `${next.road.key}|${next.forward}`;
      if (seen.has(armKey)) continue;
      const kerbside = nycKerbsideLaneNo(next.road);
      const wanted =
        next.road.lanesPerDirection > 1
          ? turn > 0
            ? kerbside
            : next.road.lanesPerDirection === kerbside
              ? 1
              : 2
          : next.laneNo;
      const entry = departures.find(
        (candidate) =>
          candidate.road.key === next.road.key &&
          candidate.forward === next.forward &&
          candidate.laneNo === wanted,
      );
      if (!entry) continue;
      seen.add(armKey);
      turns.push({ id: entry.id, turn });
    }
    // Right turns before left, so the order is stable and a lane's own turn
    // comes first where it has one.
    turns.sort((a, b) => b.turn - a.turn);
    if (lane.road.lanesPerDirection > 1) {
      const prefersRight = lane.laneNo === nycKerbsideLaneNo(lane.road);
      const preferred = turns.filter((t) => (prefersRight ? t.turn > 0 : t.turn < 0));
      const rest = turns.filter((t) => !preferred.includes(t));
      // With somewhere to go straight on, the avenue keeps each lane to the
      // turn it would really be made from. At the end of the road there is no
      // straight, so it takes whatever the junction offers rather than
      // stranding its traffic.
      const chosen = straight ? preferred : [...preferred, ...rest];
      return [...(straight ? [straight.id] : []), ...chosen.map((t) => t.id)];
    }
    return [...(straight ? [straight.id] : []), ...turns.map((t) => t.id)];
  };

  const adjacentFor = (lane: NycGridLane): string[] => {
    const siblings = gridLanes.filter(
      (other) =>
        other.id !== lane.id &&
        other.road.key === lane.road.key &&
        other.fromNode.position.x + other.toNode.position.x ===
          lane.fromNode.position.x + lane.toNode.position.x &&
        other.fromNode.position.z + other.toNode.position.z ===
          lane.fromNode.position.z + lane.toNode.position.z,
    );
    return siblings.map((other) => other.id);
  };

  const lanes = gridLanes.map((lane) =>
    laneTrue(
      lane.id,
      lane.fromNode,
      lane.toNode,
      "right",
      successorsFor(lane),
      lane.road.oneWay === null ? "travel" : "one_way",
      [lane.via],
      adjacentFor(lane),
      lane.road.roadId,
    ),
  );

  const roadSurfaces = [...avenues, ...streets].map((road) => {
    const axis: NycAxis = avenues.includes(road) ? "avenue" : "street";
    const crossings = crossingsOf(road, axis);
    const centerline = crossings.map((cross) =>
      axis === "avenue"
        ? point(road.coordinate, cross.coordinate)
        : point(cross.coordinate, road.coordinate),
    );
    const roadLanes = gridLanes.filter((lane) => lane.road.key === road.key);
    // US paint: yellow between opposing streams, white between lanes running
    // the same way. A single-lane one-way street divides nothing and stays
    // bare — a centre line on one would read as two-way (issue #5).
    const markings =
      road.oneWay === null
        ? [
            roadMarking(
              `${road.roadId}-centre`,
              "centre_solid",
              [centerline[0], centerline[centerline.length - 1]],
              "yellow",
            ),
          ]
        : road.lanesPerDirection > 1
          ? [
              roadMarking(
                `${road.roadId}-lane`,
                "lane_dashed",
                [centerline[0], centerline[centerline.length - 1]],
                "white",
              ),
            ]
          : [];
    return roadSurface(
      road.roadId,
      centerline,
      road.widthM,
      roadLanes.map((lane) => lane.id),
      "standard",
      markings,
    );
  });

  // Manhattan signalises every crossing where two carriageways meet. A node
  // fed by only one road — the tail of a one-way avenue, where nothing arrives
  // from the avenue at all — would just hold the cross street at red for a
  // phase nobody is using.
  const signals = nodeOrder.flatMap((junction) => {
    const arrivals = arrivalsByNode.get(junction.id) ?? [];
    if (new Set(arrivals.map((lane) => lane.road.key)).size < 2) return [];
    return [
      intersectionSignal(
        `nyc-sig-${junction.id.replace(/^nyc-/, "")}`,
        junction.position,
        arrivals.map((lane) => ({
          laneId: lane.id,
          phase: lane.axis === "avenue" ? ("ns" as const) : ("ew" as const),
        })),
        lanes,
      ),
    ];
  });

  const roadNames: Record<string, string> = {};
  for (const road of [...avenues, ...streets]) roadNames[road.roadId] = road.name;
  return { nodes: nodeOrder, lanes, roadSurfaces, signals, roadNames };
}

/** How a grid cell is built up. `buildingSet` picks the instanced glb wall. */
interface NycZone {
  readonly buildingSet: string;
  readonly heightRange: readonly [number, number];
  readonly density: number;
  readonly material: string;
}

const NYC_ZONES = {
  towers: { buildingSet: "nyc-downtown", heightRange: [40, 60], density: 0.95, material: "stone" },
  midrise: { buildingSet: "nyc-midrise", heightRange: [18, 30], density: 0.92, material: "sandstone" },
  brownstone: { buildingSet: "nyc-brownstone", heightRange: [12, 22], density: 0.9, material: "brick" },
  houses: { buildingSet: "nyc-house", heightRange: [8, 14], density: 0.88, material: "brick" },
  retail: { buildingSet: "nyc-shop", heightRange: [10, 18], density: 0.93, material: "brick" },
} as const satisfies Record<string, NycZone>;

/**
 * Zoning by column and latitude rather than by cell, so that adding a street
 * splits a cell without changing what stands on either half.
 *
 * It follows the real neighbourhood: the tower core sits on Broadway and
 * Amsterdam and thins going uptown, the low-rise residential belt runs down the
 * river side, and Broadway and Amsterdam above 86th are the retail strip. The
 * detached-house pocket has to stay clear of the towers — `content.test.ts`
 * requires 20 m and the river columns keep hundreds.
 */
const nycZoneFor = (columnKey: string, centreZ: number): NycZone | null => {
  switch (columnKey) {
    case "riv-we":
      // Joan of Arc Park owns the W 91st–96th block: a street wall there would
      // stand inside the park you are meant to be able to drive around.
      if (centreZ > 720 && centreZ < 960) return null;
      return centreZ < 0 ? NYC_ZONES.brownstone : NYC_ZONES.houses;
    case "we-bway":
      return centreZ < 0 ? NYC_ZONES.brownstone : NYC_ZONES.houses;
    case "bway-amst":
      return centreZ < 480 ? NYC_ZONES.towers : NYC_ZONES.retail;
    case "amst-col":
      return centreZ < 0
        ? NYC_ZONES.towers
        : centreZ < 480
          ? NYC_ZONES.midrise
          : NYC_ZONES.retail;
    case "col-cpw":
      // The museum and its grounds own the 79th–86th cell; a street wall there
      // would stand inside the authored landmark.
      if (centreZ > 0 && centreZ < 480) return null;
      return centreZ < 480 ? NYC_ZONES.midrise : NYC_ZONES.brownstone;
    default:
      return NYC_ZONES.midrise;
  }
};

/** Metres from a road centreline to the block frontage: carriageway + pavement. */
const NYC_BLOCK_INSET_M = 13;
/** Depth of the fill strip beyond the outermost avenue. */
const NYC_MARGIN_DEPTH_M = 44;

/**
 * Blocks derived from the same grid the roads are: one per cell, plus a fill
 * strip beyond the westernmost avenue of each row so the outer kerb has
 * frontage too. Deriving them is what lets a new street be one line — it splits
 * every cell it crosses and both halves keep their zoning — rather than forty
 * hand-edited rectangles.
 */
function buildNycBlocks(
  avenues: readonly NycRoadSpec[],
  streets: readonly NycRoadSpec[],
): ProceduralBlock[] {
  const reaches = (avenue: NycRoadSpec, street: NycRoadSpec): boolean =>
    (avenue.crossings ?? streets.map((s) => s.key)).includes(street.key) &&
    (street.crossings ?? avenues.map((a) => a.key)).includes(avenue.key);

  const blocks: ProceduralBlock[] = [];
  for (let row = 0; row + 1 < streets.length; row += 1) {
    const south = streets[row];
    const north = streets[row + 1];
    const centreZ = (south.coordinate + north.coordinate) / 2;
    const depthZ = north.coordinate - south.coordinate - NYC_BLOCK_INSET_M * 2;
    if (depthZ <= 0) continue;
    const present = avenues.filter(
      (avenue) => reaches(avenue, south) && reaches(avenue, north),
    );
    for (let column = 0; column + 1 < present.length; column += 1) {
      const west = present[column];
      const east = present[column + 1];
      const columnKey = `${west.key}-${east.key}`;
      const zone = nycZoneFor(columnKey, centreZ);
      if (!zone) continue;
      const widthX = east.coordinate - west.coordinate - NYC_BLOCK_INSET_M * 2;
      if (widthX <= 0) continue;
      blocks.push({
        id: `nyc-block-${columnKey}-${Math.round(centreZ)}`,
        center: point((west.coordinate + east.coordinate) / 2, centreZ),
        size: point(widthX, depthZ),
        heightRange: zone.heightRange,
        density: zone.density,
        material: zone.material,
        buildingSet: zone.buildingSet,
      });
    }
    const westmost = present[0];
    if (!westmost) continue;
    // Riverside Drive's far side is Riverside Park, not frontage.
    if (westmost.key === "riv") continue;
    blocks.push({
      id: `nyc-block-west-margin-${Math.round(centreZ)}`,
      center: point(
        westmost.coordinate - NYC_BLOCK_INSET_M - NYC_MARGIN_DEPTH_M / 2,
        centreZ,
      ),
      size: point(NYC_MARGIN_DEPTH_M, depthZ),
      heightRange: NYC_ZONES.brownstone.heightRange,
      density: NYC_ZONES.brownstone.density,
      material: NYC_ZONES.brownstone.material,
      buildingSet: NYC_ZONES.brownstone.buildingSet,
    });
  }
  return blocks;
}

const nycGrid = buildNycGrid(NYC_AVENUES, NYC_STREETS);
const nycLanes = nycGrid.lanes;
const nycSignals = nycGrid.signals;
const nycBlocks = buildNycBlocks(NYC_AVENUES, NYC_STREETS);

export const NYC_MAP_PACK: MapPack = {
  id: "nyc-upper-west-side",
  name: "NYC Upper West Side",
  areaLabel: "Broadway, West 72nd Street & nearby avenues",
  countryIds: ["us"],
  // Derived from the road specs rather than listed again, so a new street
  // still carries its name on the one line that declares it.
  roadNames: nycGrid.roadNames,
  // Twelve cars is what every map got, and it is what this one had when it
  // was a fifth the size. Spread over 47 km of lane they left the streets
  // empty, and patrols with them — a patrol is one in five of the *car*
  // variant only (isPatrolVehicle), which after the bus/taxi/van gate and
  // roll shares is roughly one vehicle in eight, so twelve vehicles is one
  // police car in the whole city if the seed is kind. 32 is the simulation
  // core's own clamp; a phone keeps a lower count because each car costs it
  // much more, and the O(n^2) car-following work is paid per decision.
  ambientTraffic: { desktop: 32, touch: 16 },
  source: osmSource(
    { south: 40.7738, west: -73.9919, north: 40.7836, east: -73.9738 },
    "https://www.openstreetmap.org/export#map=16/40.7787/-73.9829",
    "manifest-v1:nyc-uws-2026-07-10",
  ),
  geometry: {
    // Grid runs W 65th to W 96th across six avenues; bounds have to cover it
    // with room for the margin blocks, or everything outside reads as
    // out_of_bounds the moment the player drives onto it.
    worldSize: point(1080, 3000),
    roadWidth: 11,
    shoulderWidth: 1.5,
    roadSurfaces: nycGrid.roadSurfaces,
    blocks: nycBlocks.concat([
      // The two strips beyond the outermost cross streets, which no row
      // generates because they have grid on one side only. The north one is
      // wider: Riverside Drive reaches W 96th, so there is more frontage up
      // there than below W 65th.
      { id: "nyc-block-south-margin", center: point(0, -1475), size: point(614, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
      { id: "nyc-block-north-margin", center: point(-70, 1475), size: point(754, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
    ]),
    servicePoints: [
      // West 72nd is a wide two-way, and NYC is a paved city, so the lot must
      // clear the carriageway plus the full 3.4 m concrete sidewalk (not the
      // 1.5 m authored shoulder) before its 11.64 m half-width starts — else the
      // forecourt slab bleeds onto the sidewalk.
      { id: "nyc-gas", kind: "gas_station", anchor: { laneId: "nyc-72-e-we", distanceAlongM: 29 }, footprint: point(14, 9), label: "Broadway Fuel", setbackM: 18.7 },
      // The second station sits at the far corner from the first: that one is
      // W 72nd and West End, in the south-west, so this is W 96th up by
      // Columbus. On a map 2.9 km end to end, one pump stop meant a run the
      // length of the city to reach it whichever way you were driving.
      { id: "nyc-gas-uptown", kind: "gas_station", anchor: { laneId: "nyc-96-e-col", distanceAlongM: 70 }, footprint: point(14, 9), label: "West 96th Fuel", setbackM: 18.7 },
      // The two repair shops sit away from the pumps — fuel is at W 72nd/West
      // End and W 96th/Columbus — but **zoning outranks spread**. A workshop
      // wants commercial frontage, and `nycZoneFor` puts detached houses up
      // the whole Riverside–West End column north of centre, so the obvious
      // far corner from the uptown station is exactly where one must not go:
      // sited there, the shop stood between two clapboard homes with porches.
      // Broadway is the Upper West Side's commercial spine and its blocks
      // above W 79th are zoned retail, which is where the uptown one lives
      // now. The downtown one is on Columbus in the midrise belt — avenue
      // frontage, mixed use, and the right neighbours for a garage.
      //
      // The shop is a much smaller building than the station, so its lot is
      // 4.8 m to the station's 11.64 — hence a set-back in the twelves rather
      // than the eighteens for the same kerb gap on the same street.
      { id: "nyc-repair-downtown", kind: "repair_shop", anchor: { laneId: "nyc-65-e-col", distanceAlongM: 36 }, footprint: point(10, 8), label: "West 65th Auto", setbackM: 11.8 },
      { id: "nyc-repair-uptown", kind: "repair_shop", anchor: { laneId: "nyc-bway-n-91", distanceAlongM: 60 }, footprint: point(10, 8), label: "Broadway Auto", setbackM: 12.1 },
    ],
    gigVenues: [
      { id: "nyc-v1", kind: "restaurant", anchor: { laneId: "nyc-amst-n-1-75", distanceAlongM: 22 }, footprint: point(28, 20), name: "Amsterdam Diner", setbackM: 18 },
      { id: "nyc-v2", kind: "shop", anchor: { laneId: "nyc-86-e-amst", distanceAlongM: 70 }, footprint: point(16, 12), name: "West 86th Grocers" },
      { id: "nyc-v3", kind: "residence", anchor: { laneId: "nyc-col-s-1-75", distanceAlongM: 205 }, footprint: point(14, 12), name: "Columbus Apartments" },
      { id: "nyc-v4", kind: "office", anchor: { laneId: "nyc-we-n-79", distanceAlongM: 200 }, footprint: point(16, 14), name: "West End Offices" },
      // A second kitchen, on the far side of the map from the diner, so
      // deliveries do not all start on Amsterdam. `modelId` gives it its own
      // building — two restaurants that look identical read as one place.
      { id: "nyc-v5", kind: "restaurant", anchor: { laneId: "nyc-bway-n-75", distanceAlongM: 90 }, footprint: point(14, 14), name: "Broadway Pizzeria", modelId: "restaurant-pizzeria" },
      // The rest of the city needs somewhere to eat and shop too: five venues
      // clustered in the middle third left the new ends with nothing but
      // generated addresses. Kinds and models are cycled so no two
      // neighbouring venues are the same building — the catalogue has five
      // distinct ones, and every anchor here is a couple of blocks from the
      // nearest venue using the same.
      //
      // Lincoln Square and the south end
      { id: "nyc-v6", kind: "restaurant", anchor: { laneId: "nyc-bway-n-61", distanceAlongM: 120 }, footprint: point(28, 20), name: "Lincoln Square Diner", setbackM: 18 },
      { id: "nyc-v7", kind: "shop", anchor: { laneId: "nyc-we-n-59", distanceAlongM: 120 }, footprint: point(16, 12), name: "West End Bodega" },
      { id: "nyc-v8", kind: "office", anchor: { laneId: "nyc-59-e-amst", distanceAlongM: 70 }, footprint: point(16, 14), name: "Columbus Circle Offices" },
      { id: "nyc-v9", kind: "residence", anchor: { laneId: "nyc-amst-n-1-59", distanceAlongM: 120 }, footprint: point(14, 12), name: "Amsterdam Residences" },
      { id: "nyc-v10", kind: "restaurant", anchor: { laneId: "nyc-65-e-bway", distanceAlongM: 80 }, footprint: point(14, 14), name: "West 65th Taqueria", modelId: "restaurant-pizzeria" },
      // Uptown, above the museum
      { id: "nyc-v11", kind: "shop", anchor: { laneId: "nyc-riv-n-79", distanceAlongM: 120 }, footprint: point(16, 12), name: "Riverside Market" },
      { id: "nyc-v12", kind: "restaurant", anchor: { laneId: "nyc-bway-s-100", distanceAlongM: 120 }, footprint: point(28, 20), name: "Straus Park Bagels", setbackM: 18 },
      { id: "nyc-v13", kind: "residence", anchor: { laneId: "nyc-we-s-96", distanceAlongM: 120 }, footprint: point(14, 12), name: "West 96th Apartments" },
      { id: "nyc-v14", kind: "office", anchor: { laneId: "nyc-col-s-1-100", distanceAlongM: 120 }, footprint: point(16, 14), name: "Columbus Uptown Offices" },
      { id: "nyc-v15", kind: "restaurant", anchor: { laneId: "nyc-amst-n-2-86", distanceAlongM: 120 }, footprint: point(14, 14), name: "Amsterdam Noodle Bar", modelId: "restaurant-pizzeria" },
      { id: "nyc-v16", kind: "shop", anchor: { laneId: "nyc-106-w-amst", distanceAlongM: 80 }, footprint: point(16, 12), name: "West 106th Grocers" },
      { id: "nyc-v17", kind: "residence", anchor: { laneId: "nyc-cpw-s-96", distanceAlongM: 120 }, footprint: point(14, 12), name: "Central Park West Residences" },
    ],
    // Central Park's lake, on the eastern half so it never fouls the
    // promenade, and between two of the derived crossings so it never
    // swallows a gate. A `WaterBody` rather than decoration: the adapter
    // already emits a shoreline obstacle per polygon edge, so it is solid for
    // free, and `parkLayouts` takes the same polygon as a planting keep-out.
    // No `bridgePortalSurfaceIds`, so the shoreline has no vehicle opening.
    waterBodies: [
      {
        id: "nyc-central-park-lake",
        color: "#2f4a55",
        polygon: [
          point(490, -530),
          point(462, -514),
          point(450, -479),
          point(453, -434),
          point(459, -390),
          point(479, -353),
          point(505, -345),
          point(524, -372),
          point(530, -420),
          point(525, -470),
          point(512, -507),
        ],
      },
    ],
    landmarks: [
      // Kept clear of the carriageways (a content test enforces this).
      { id: "nyc-subway", kind: "station", center: point(-92, -455), size: point(8, 5), color: "#2d2f33" },
      // Central Park runs the whole east edge now the grid does, and is no
      // longer a 38 m token: at 200 m it reads as the park the avenue is
      // named after rather than a verge. Its west edge stays clear of
      // Central Park West's kerb, which is what keeps addresses off it.
      { id: "nyc-central-park", kind: "park", center: point(440, 0), size: point(200, 2900), color: "#4f7a3d" },
      { id: "nyc-amnh", kind: "shops", center: point(250, 240), size: point(100, 420), color: "#caa76f" },
      // Riverside Park fills the far side of Riverside Drive, where the land
      // really does fall away to the Hudson — so the west edge of the map is
      // green rather than another row of brownstones.
      { id: "nyc-riverside-park", kind: "park", center: point(-506, 480), size: point(66, 1934), color: "#4f7a3d" },
      // Joan of Arc Park: a real triangle off Riverside Drive at W 93rd,
      // here given the whole block between W 91st and W 96th so it has road
      // on all four sides and can be driven round — about a 760 m lap.
      { id: "nyc-joan-of-arc-park", kind: "park", center: point(-390, 840), size: point(104, 204), color: "#5c8c4b" },
    ],
  },
  laneGraph: graph(
    nycGrid.nodes,
    nycLanes,
    nycSignals.map((signal) => signal.control),
    nycSignals.map((signal) => signal.zone),
    [
      anchoredSpawn("nyc-player-1way", "player", "nyc-72-e-we", 30),
      anchoredSpawn("nyc-player-signals", "player", "nyc-bway-n-72", 30),
      anchoredSpawn("nyc-player-lane", "player", "nyc-we-n-72", 30),
      anchoredSpawn("nyc-car-1", "vehicle", "nyc-bway-s-86", 130),
      anchoredSpawn("nyc-car-2", "vehicle", "nyc-79-e-we", 60),
      anchoredSpawn("nyc-car-3", "vehicle", "nyc-we-n-72", 130),
      anchoredSpawn("nyc-cab-4", "vehicle", "nyc-amst-n-1-72", 120),
      anchoredSpawn("nyc-car-5", "vehicle", "nyc-col-s-1-86", 120),
      // Cars are handed out round-robin over the traffic gates, and a vehicle
      // spawn is what makes a gate. Five of them all inside the old middle
      // third meant the ends of the city started empty and only filled as
      // cars recycled; these put gates on every corner of the grid instead.
      anchoredSpawn("nyc-car-6", "vehicle", "nyc-bway-n-61", 120),
      anchoredSpawn("nyc-cab-7", "vehicle", "nyc-we-s-65", 120),
      anchoredSpawn("nyc-car-8", "vehicle", "nyc-cpw-n-59", 120),
      anchoredSpawn("nyc-car-9", "vehicle", "nyc-59-e-we", 70),
      anchoredSpawn("nyc-van-10", "vehicle", "nyc-amst-n-2-65", 120),
      anchoredSpawn("nyc-car-11", "vehicle", "nyc-riv-n-79", 120),
      anchoredSpawn("nyc-cab-12", "vehicle", "nyc-bway-s-100", 120),
      anchoredSpawn("nyc-car-13", "vehicle", "nyc-96-w-cpw", 70),
      anchoredSpawn("nyc-car-14", "vehicle", "nyc-col-s-1-100", 120),
      anchoredSpawn("nyc-bus-15", "vehicle", "nyc-106-e-we", 80),
      anchoredSpawn("nyc-car-16", "vehicle", "nyc-cpw-s-96", 120),
      anchoredSpawn("nyc-car-17", "vehicle", "nyc-riv-s-91", 120),
      freeSpawn("nyc-ped-1", "pedestrian", -100, 12, 0),
      freeSpawn("nyc-ped-2", "pedestrian", -132, -10, 180),
      freeSpawn("nyc-ped-3", "pedestrian", 28, 12, 0),
      freeSpawn("nyc-ped-4", "pedestrian", 168, -12, 180),
      freeSpawn("nyc-ped-5", "pedestrian", -308, 10, 0),
      // The ambient crowd is a bubble that follows the car, so it covers the
      // new streets for free. These are the scenario road users, which are
      // placed: a few uptown and downtown so the ends are not bare on arrival.
      freeSpawn("nyc-ped-6", "pedestrian", -100, -1092, 0),
      freeSpawn("nyc-ped-7", "pedestrian", 168, 1088, 180),
      freeSpawn("nyc-ped-8", "pedestrian", -448, 600, 0),
      freeSpawn("nyc-cyclist-1", "cyclist", -318, -200, 0, "nyc-we-n-72"),
      freeSpawn("nyc-cyclist-2", "cyclist", 38.3, -200, 0, "nyc-amst-n-1-72"),
      freeSpawn("nyc-cyclist-3", "cyclist", -458, 600, 0, "nyc-riv-n-86"),
    ],
    [
      checkpoint("nyc-r1-start", "West 72nd & West End", "nyc-72-e-we", 30),
      checkpoint("nyc-r1-amst", "Amsterdam Avenue northbound", "nyc-amst-n-1-75", 120),
      checkpoint("nyc-r1-86", "West 86th Street", "nyc-86-e-amst", 70),
      checkpoint("nyc-r1-finish", "Columbus & 72nd", "nyc-col-s-1-75", 205),
      checkpoint("nyc-r2-start", "Broadway & 72nd", "nyc-bway-n-72", 30),
      checkpoint("nyc-r2-signal", "Broadway & 79th signal", "nyc-bway-n-75", 205),
      checkpoint("nyc-r2-finish", "West 86th & Broadway", "nyc-86-w-bway", 180),
      checkpoint("nyc-r3-start", "West End & 72nd", "nyc-we-n-72", 30),
      checkpoint("nyc-r3-mid", "West End & 79th", "nyc-we-n-79", 200),
      checkpoint("nyc-r3-finish", "West 86th & Central Park West", "nyc-86-e-bway", 145),
    ],
  ),
};

export const NYC_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-us",
  countryId: "us",
  destinationId: "us-nyc",
  mapId: "nyc-upper-west-side",
  title: "Free Drive — New York City",
  description: "Explore the Upper West Side miniature with coaching available but no fixed route.",
  startSpawnId: "nyc-player-1way",
  trafficSeed: 2101,
};
