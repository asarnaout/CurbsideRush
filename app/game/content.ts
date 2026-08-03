import type {
  CountryId,
  CountryProfile,
  CountryVisualTheme,
  DestinationId,
  DestinationProfile,
  FreeDriveDefinition,
  FreeDriveId,
  FrozenMapSource,
  GameSessionConfig,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapCheckpoint,
  MapId,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ResolvedGameSessionConfig,
  RuleCode,
  RoadMarkingPath,
  RoadMarkingStyle,
  RoadSurface,
  RoadSurfaceType,
  ScenarioId,
  ScoringConfig,
  SpeedUnit,
  SteeringPreference,
  SteeringSide,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  TrafficSide,
  WorldPoint,
} from "./types";
import {
  LONDON_FREE_DRIVE,
  LONDON_MAP_PACK,
  LONDON_RULE_REFERENCES,
} from "./londonContent";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
  CAIRO_RULE_REFERENCES,
} from "./cairoContent";
import { NYC_FREE_DRIVE, NYC_MAP_PACK } from "./cities/nyc";
import { buildLaneTrueGeometry } from "./laneConnectors";
import { speedingFineMultiplier } from "./speeding";
import { FULL_CONDITION_PCT } from "./damage";
import {
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  ROADSIDE_PRICE_FACTOR,
} from "./career";

export const CONTENT_REVIEWED_ON = "2026-07-10";

const NYC_THEME: CountryVisualTheme = {
  sky: "#9ed7ef",
  ground: "#6e8a5b",
  road: "#323840",
  laneMarking: "#f5d760",
  accent: "#f36a3d",
  architecture: "warm brick apartment blocks and broad avenues",
  roadsideDetails: ["yellow taxis", "fire hydrants", "street trees"],
};

const LONDON_THEME: CountryVisualTheme = {
  sky: "#b9d3dc",
  ground: "#668a58",
  road: "#393d43",
  laneMarking: "#f3f0dd",
  accent: "#d83b3f",
  architecture: "sandstone museums, stucco terraces and broad civic avenues",
  roadsideDetails: ["red buses", "black cabs", "Belisha beacons"],
};

const TOKYO_THEME: CountryVisualTheme = {
  sky: "#acd9e9",
  ground: "#769b69",
  road: "#44494c",
  laneMarking: "#f7f3df",
  accent: "#e64f52",
  architecture: "compact homes, utility poles and small station-front shops",
  roadsideDetails: ["rail crossings", "bicycles", "vending machines"],
};

const CAIRO_THEME: CountryVisualTheme = {
  sky: "#73afd1",
  ground: "#b9a777",
  road: "#494640",
  laneMarking: "#f4f0dc",
  accent: "#2f8297",
  architecture:
    "warm Khedivial apartments, Garden City villas and Nile-side cultural landmarks",
  roadsideDetails: [
    "white taxis",
    "date palms",
    "bilingual direction signs",
    "Nile feluccas",
  ],
};

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
  capturedOn: CONTENT_REVIEWED_ON,
  sourceUrl,
  checksum,
  importerVersion: "sideswap-procedural-1.0.0",
  attribution: "© OpenStreetMap contributors",
  licenseName: "Open Data Commons Open Database License 1.0",
  licenseUrl: "https://www.openstreetmap.org/copyright",
});

const US_RULES: readonly OfficialRuleReference[] = [
  {
    id: "us-ny-dmv-turns",
    title: "New York State Driver's Manual — Intersections and Turns",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-5-intersections-and-turns",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "missing_indicator",
      "one_way",
      "unsafe_gap",
      "observation",
    ],
  },
  {
    id: "us-ny-dmv-passing",
    title: "New York State Driver's Manual — Passing",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-6-passing",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "lane_misuse",
      "merge",
      "unsafe_gap",
      "following_distance",
      "observation",
    ],
  },
  {
    id: "us-nyc-traffic-rules",
    title: "Traffic Rules of the City of New York",
    authority: "New York City Department of Transportation",
    jurisdiction: "New York City, United States",
    url: "https://www.nyc.gov/html/dot/downloads/pdf/trafrule.pdf",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
    ],
  },
];

const UK_RULES: readonly OfficialRuleReference[] = [
  {
    id: "uk-highway-code-general",
    title:
      "The Highway Code — General rules, techniques and advice for drivers and riders",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
      "observation",
    ],
  },
  {
    id: "uk-highway-code-road",
    title: "The Highway Code — Using the road",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "roundabout_yield",
      "merge",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-highway-code-motorways",
    title: "The Highway Code — Motorways",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/motorways-253-to-273",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
      "observation",
    ],
  },
];

const JP_RULES: readonly OfficialRuleReference[] = [
  {
    id: "jp-jaf-traffic-rules",
    title: "Traffic rules in Japan",
    authority: "Japan Automobile Federation",
    jurisdiction: "Japan",
    url: "https://english.jaf.or.jp/driving-in-japan/traffic-rules",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "pedestrian_priority",
      "cyclist_clearance",
      "railway_crossing",
      "observation",
    ],
  },
];

export const COUNTRY_PROFILES: readonly CountryProfile[] = [
  {
    id: "us",
    countryCode: "US",
    countryName: "United States",
    flagEmoji: "🇺🇸",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "mph",
    currency: { code: "USD", symbol: "$", minorUnits: 2 },
    centreLineColor: "yellow",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
      turnOnRed: "permitted_after_stop_unless_signed",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Obey signals and signs; yield to pedestrians and traffic already in a junction.",
    officialReferences: US_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "uk",
    countryCode: "GB",
    countryName: "United Kingdom",
    flagEmoji: "🇬🇧",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "mph",
    currency: { code: "GBP", symbol: "£", minorUnits: 2 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Give way according to signs and markings; at roundabouts, give priority to traffic from the right unless directed otherwise.",
    officialReferences: [...UK_RULES, ...LONDON_RULE_REFERENCES],
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "jp",
    countryCode: "JP",
    countryName: "Japan",
    flagEmoji: "🇯🇵",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "kmh",
    currency: { code: "JPY", symbol: "¥", minorUnits: 0 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Follow signals, stop markings and local priority signs; slow for narrow, shared neighbourhood streets.",
    officialReferences: JP_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "eg",
    countryCode: "EG",
    countryName: "Egypt",
    flagEmoji: "🇪🇬",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "kmh",
    currency: { code: "EGP", symbol: "E£", minorUnits: 2 },
    centreLineColor: "white",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Obey signals and signs, keep right, and yield to traffic already circulating at roundabouts.",
    officialReferences: CAIRO_RULE_REFERENCES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
];

export const DESTINATION_PROFILES: readonly DestinationProfile[] = [
  {
    id: "uk-london",
    countryId: "uk",
    destinationName: "London",
    destinationSubtitle: "South Kensington Museum Quarter",
    mapId: "london-south-kensington",
    freeDriveId: "free-uk-london",
    promotion: "featured",
    cityMark: "LDN",
    visualTheme: LONDON_THEME,
  },
  {
    id: "us-nyc",
    countryId: "us",
    destinationName: "New York City",
    destinationSubtitle: "Upper West Side · Broadway & West 72nd Street",
    mapId: "nyc-upper-west-side",
    freeDriveId: "free-us",
    promotion: "standard",
    cityMark: "NYC",
    visualTheme: NYC_THEME,
  },
  {
    id: "jp-tokyo",
    countryId: "jp",
    destinationName: "Tokyo",
    destinationSubtitle: "Gotokuji, Miyanosaka & narrow neighbourhood streets",
    mapId: "tokyo-setagaya",
    freeDriveId: "free-jp",
    promotion: "standard",
    cityMark: "TYO",
    visualTheme: TOKYO_THEME,
  },
  {
    id: "eg-cairo",
    countryId: "eg",
    destinationName: "Cairo",
    destinationSubtitle: "Tahrir, Garden City, Gezira & the Central Nile",
    mapId: "cairo-central-nile",
    freeDriveId: "free-eg",
    promotion: "standard",
    cityMark: "CAI",
    visualTheme: CAIRO_THEME,
  },
];

/**
 * Setagaya-dori is the only arterial here and is posted as one; the rest of
 * the ward reads at Japan's ordinary urban figure. The three `shared_space`
 * lanes are too narrow for even that — 5.8 m of carriageway with pedestrians
 * on it — so they keep the Zone 20 the whole neighbourhood used to carry.
 */
const TOKYO_ROAD_SPEED_LIMITS = {
  "jp-setagaya-dori": 50,
  "jp-south-road": 40,
  "jp-east-curve": 40,
  "jp-center-road": 40,
  "jp-west-road": 40,
  "jp-north-road": 40,
  "jp-junction-road": 40,
  "jp-westhill-road": 40,
  "jp-easthill-road": 40,
  "jp-uptown-road": 40,
  "jp-westedge-road": 40,
  "jp-southrow-west": 40,
  "jp-centerrow-west": 40,
  "jp-northrow-west": 40,
  "jp-westside-road": 40,
  "jp-westside-south": 40,
  "jp-eastside-road": 40,
  "jp-narrow-road": 20,
  "jp-narrowhill-road": 20,
  "jp-shrine-road": 20,
} as const satisfies Record<string, number>;

/**
 * Every road in this file and what it is posted at, keyed by `RoadSurface.id`
 * — the same key space as `LaneSegment.roadId`.
 *
 * A road declares its limit **once**, here or on its `NycRoadSpec`, and
 * `lane`/`laneTrue` stamp it onto every lane of that road. Authoring it per
 * lane is how the two drift apart, which is why neither builder takes one.
 *
 * Choose the figure from what the road *is*, in this order: frontage (housing,
 * park, school, shared space lower it), then class (arterial > through street >
 * local > mews/service/roundabout), then geometry (width, lane count,
 * curvature, junction density). Never post a number the host country does not
 * use — `roadRealism.test.ts` holds you to a per-country list.
 */
const ROAD_SPEED_LIMITS: Readonly<Record<string, number>> = {
  ...TOKYO_ROAD_SPEED_LIMITS,
};

/**
 * Throws rather than defaulting: a road with no posted limit is an authoring
 * omission, and a silent fallback would put ambient traffic through it at
 * whatever the guess happened to be. This runs at module scope, so the failure
 * lands on import — every test at once, naming the road.
 */
const speedLimitForRoad = (roadId: string): number => {
  const limit = ROAD_SPEED_LIMITS[roadId];
  if (limit === undefined) {
    throw new Error(`No speed limit posted for road "${roadId}"`);
  }
  return limit;
};


const jpNodes = {
  a: node("jp-a", -112, -72),
  b: node("jp-b", -30, -72),
  c: node("jp-c", 72, -72),
  d: node("jp-d", 112, -18),
  e: node("jp-e", 54, 18),
  f: node("jp-f", -30, 18),
  g: node("jp-g", -112, 18),
  h: node("jp-h", -112, 76),
  i: node("jp-i", -30, 76),
  j: node("jp-j", 82, 76),
  // Northern district (Miyanosaka side, north of the existing loop).
  nw2: node("jp-nw2", -112, 168),
  nm2: node("jp-nm2", -30, 168),
  ne2: node("jp-ne2", 82, 168),
  // Western corridor (Yamashita side, west of the existing loop).
  sw: node("jp-sw", -260, -72),
  cw: node("jp-cw", -260, 18),
  nw: node("jp-nw", -260, 76),
  // Southern district: Setagaya-dori arterial and its approaches.
  ssW: node("jp-ss-w", -260, -168),
  ssM: node("jp-ss-m", -30, -168),
  ssE: node("jp-ss-e", 72, -168),
};

const jpLanes: readonly LaneSegment[] = [
  laneTrue("jp-south-east-1", jpNodes.a, jpNodes.b, "left", ["jp-south-east-2", "jp-narrow-north-1", "jp-shrine-south"], "travel", [point(-71, -70.5)], ["jp-south-west-1"]),
  laneTrue("jp-south-east-2", jpNodes.b, jpNodes.c, "left", ["jp-curve-north", "jp-eastside-south"], "rail_crossing", [point(21, -70.5)], ["jp-south-west-2"]),
  laneTrue("jp-south-west-1", jpNodes.b, jpNodes.a, "left", ["jp-westedge-north", "jp-southrow-west-w"], "travel", [point(-71, -73.5)], ["jp-south-east-1"], "jp-south-road", 3),
  laneTrue("jp-south-west-2", jpNodes.c, jpNodes.b, "left", ["jp-south-west-1"], "rail_crossing", [point(21, -73.5)], ["jp-south-east-2"], "jp-south-road", 3),
  laneTrue("jp-curve-north", jpNodes.c, jpNodes.d, "left", ["jp-center-west-1"], "travel", [point(71.64, -70.27), point(100.78, -54.81), point(106.36, -34.57), point(110.23, -18.1)], ["jp-curve-south"]),
  laneTrue("jp-curve-south", jpNodes.d, jpNodes.c, "left", ["jp-south-west-2"], "travel", [point(113.54, -18.88), point(109.64, -35.43), point(103.22, -57.19), point(73.24, -73.26)], ["jp-curve-north"], "jp-east-curve", 3),
  laneTrue("jp-center-west-1", jpNodes.d, jpNodes.e, "left", ["jp-center-west-2"], "travel", [point(110.37, -18.7), point(81.1, 16.56), point(54.5, 16.3)], ["jp-center-east-3"]),
  laneTrue("jp-center-west-2", jpNodes.e, jpNodes.f, "left", ["jp-center-west-3", "jp-narrow-north-2"], "travel", [point(12, 16.5)], ["jp-center-east-2"]),
  laneTrue("jp-center-west-3", jpNodes.f, jpNodes.g, "left", ["jp-west-north", "jp-centerrow-west-w"], "travel", [point(-71, 16.5)], ["jp-center-east-1"]),
  laneTrue("jp-center-east-1", jpNodes.g, jpNodes.f, "left", ["jp-center-east-2", "jp-narrow-south-1"], "travel", [point(-71, 19.5)], ["jp-center-west-3"], "jp-center-road", 3),
  laneTrue("jp-center-east-2", jpNodes.f, jpNodes.e, "left", ["jp-center-east-3"], "travel", [point(12, 19.5)], ["jp-center-west-2"], "jp-center-road", 3),
  laneTrue("jp-center-east-3", jpNodes.e, jpNodes.d, "left", ["jp-curve-south"], "travel", [point(54.5, 19.7), point(82.9, 19.45), point(112.99, -16.53)], ["jp-center-west-1"], "jp-center-road", 3),
  laneTrue("jp-west-north", jpNodes.g, jpNodes.h, "left", ["jp-north-east-1", "jp-westhill-north"], "travel", [point(-113.5, 47)], ["jp-west-south"]),
  laneTrue("jp-west-south", jpNodes.h, jpNodes.g, "left", ["jp-center-east-1", "jp-westedge-south"], "travel", [point(-110.5, 47)], ["jp-west-north"], "jp-west-road", 3),
  laneTrue("jp-north-east-1", jpNodes.h, jpNodes.i, "left", ["jp-north-east-2"], "travel", [point(-71, 77.5)], ["jp-north-west-2"]),
  laneTrue("jp-north-east-2", jpNodes.i, jpNodes.j, "left", ["jp-junction-south", "jp-easthill-north"], "travel", [point(26, 77.5)], ["jp-north-west-1"]),
  laneTrue("jp-north-west-1", jpNodes.j, jpNodes.i, "left", ["jp-north-west-2", "jp-narrow-south-2"], "travel", [point(26, 74.5)], ["jp-north-east-2"], "jp-north-road", 3),
  laneTrue("jp-north-west-2", jpNodes.i, jpNodes.h, "left", ["jp-west-south", "jp-northrow-west-w"], "travel", [point(-71, 74.5)], ["jp-north-east-1"], "jp-north-road", 3),
  laneTrue("jp-junction-south", jpNodes.j, jpNodes.e, "left", ["jp-center-west-2"], "travel", [point(83.3, 75.1), point(83.5, 47), point(55.3, 17.1)], ["jp-junction-north"]),
  laneTrue("jp-junction-north", jpNodes.e, jpNodes.j, "left", ["jp-north-west-1", "jp-easthill-north"], "travel", [point(52.7, 18.9), point(80.5, 47), point(80.7, 76.9)], ["jp-junction-south"], "jp-junction-road", 3),
  laneTrue("jp-narrow-north-1", jpNodes.b, jpNodes.f, "left", ["jp-narrow-north-2"], "travel", [point(-31.35, -27)], ["jp-narrow-south-1"]),
  laneTrue("jp-narrow-north-2", jpNodes.f, jpNodes.i, "left", ["jp-north-east-2", "jp-narrowhill-north"], "travel", [point(-31.35, 47)], ["jp-narrow-south-2"]),
  laneTrue("jp-narrow-south-1", jpNodes.f, jpNodes.b, "left", ["jp-south-west-1", "jp-shrine-south"], "travel", [point(-28.65, -27)], ["jp-narrow-north-1"], "jp-narrow-road", 2.7),
  laneTrue("jp-narrow-south-2", jpNodes.i, jpNodes.f, "left", ["jp-narrow-south-1"], "travel", [point(-28.65, 47)], ["jp-narrow-north-2"], "jp-narrow-road", 2.7),
  // --- Northern district: a second loop north of the existing streets ---
  // Westhill Road (N-S, x=-112): extends the west edge north up to Uptown.
  laneTrue("jp-westhill-north", jpNodes.h, jpNodes.nw2, "left", ["jp-uptown-east-1"], "travel", [point(-113.5, 122)], ["jp-westhill-south"], "jp-westhill-road", 3),
  laneTrue("jp-westhill-south", jpNodes.nw2, jpNodes.h, "left", ["jp-west-south"], "travel", [point(-110.5, 122)], ["jp-westhill-north"], "jp-westhill-road", 3),
  // Narrowhill Road (narrow N-S, x=-30): extends the central spine north.
  laneTrue("jp-narrowhill-north", jpNodes.i, jpNodes.nm2, "left", ["jp-uptown-east-2", "jp-uptown-west-2"], "travel", [point(-31.35, 122)], ["jp-narrowhill-south"], "jp-narrowhill-road", 2.7),
  laneTrue("jp-narrowhill-south", jpNodes.nm2, jpNodes.i, "left", ["jp-narrow-south-2"], "travel", [point(-28.65, 122)], ["jp-narrowhill-north"], "jp-narrowhill-road", 2.7),
  // Easthill Road (N-S, x=82): extends the junction line north.
  laneTrue("jp-easthill-north", jpNodes.j, jpNodes.ne2, "left", ["jp-uptown-west-1"], "travel", [point(80.5, 122)], ["jp-easthill-south"], "jp-easthill-road", 3),
  laneTrue("jp-easthill-south", jpNodes.ne2, jpNodes.j, "left", ["jp-junction-south", "jp-north-west-1"], "travel", [point(83.5, 122)], ["jp-easthill-north"], "jp-easthill-road", 3),
  // Uptown Road (E-W, z=168): the northern through-street closing the loop.
  laneTrue("jp-uptown-east-1", jpNodes.nw2, jpNodes.nm2, "left", ["jp-uptown-east-2", "jp-narrowhill-south"], "travel", [point(-71, 169.5)], ["jp-uptown-west-2"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-east-2", jpNodes.nm2, jpNodes.ne2, "left", ["jp-easthill-south"], "travel", [point(26, 169.5)], ["jp-uptown-west-1"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-west-1", jpNodes.ne2, jpNodes.nm2, "left", ["jp-uptown-west-2", "jp-narrowhill-south"], "travel", [point(26, 166.5)], ["jp-uptown-east-2"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-west-2", jpNodes.nm2, jpNodes.nw2, "left", ["jp-westhill-south"], "travel", [point(-71, 166.5)], ["jp-uptown-east-1"], "jp-uptown-road", 3),
  // --- Western corridor: closes the west side and reaches out to Westside Road ---
  // Westedge Road (N-S, x=-112): joins the south stub up to the centre street.
  laneTrue("jp-westedge-north", jpNodes.a, jpNodes.g, "left", ["jp-west-north", "jp-centerrow-west-w"], "travel", [point(-113.5, -27)], ["jp-westedge-south"], "jp-westedge-road", 3),
  laneTrue("jp-westedge-south", jpNodes.g, jpNodes.a, "left", ["jp-south-east-1", "jp-southrow-west-w"], "travel", [point(-110.5, -27)], ["jp-westedge-north"], "jp-westedge-road", 3),
  // Southrow West (E-W, z=-72): extends the south road out to Westside Road.
  laneTrue("jp-southrow-west-w", jpNodes.a, jpNodes.sw, "left", ["jp-westside-north-1", "jp-westside-south-south"], "travel", [point(-186, -73.5)], ["jp-southrow-west-e"], "jp-southrow-west", 3),
  laneTrue("jp-southrow-west-e", jpNodes.sw, jpNodes.a, "left", ["jp-south-east-1", "jp-westedge-north"], "travel", [point(-186, -70.5)], ["jp-southrow-west-w"], "jp-southrow-west", 3),
  // Centerrow West (E-W, z=18): extends the centre street out to Westside Road.
  laneTrue("jp-centerrow-west-w", jpNodes.g, jpNodes.cw, "left", ["jp-westside-north-2", "jp-westside-south-1"], "travel", [point(-186, 16.5)], ["jp-centerrow-west-e"], "jp-centerrow-west", 3),
  laneTrue("jp-centerrow-west-e", jpNodes.cw, jpNodes.g, "left", ["jp-center-east-1", "jp-westedge-south"], "travel", [point(-186, 19.5)], ["jp-centerrow-west-w"], "jp-centerrow-west", 3),
  // Northrow West (E-W, z=76): extends the north road out to Westside Road.
  laneTrue("jp-northrow-west-w", jpNodes.h, jpNodes.nw, "left", ["jp-westside-south-2"], "travel", [point(-186, 74.5)], ["jp-northrow-west-e"], "jp-northrow-west", 3),
  laneTrue("jp-northrow-west-e", jpNodes.nw, jpNodes.h, "left", ["jp-north-east-1", "jp-west-south"], "travel", [point(-186, 77.5)], ["jp-northrow-west-w"], "jp-northrow-west", 3),
  // Westside Road (N-S, x=-260): the far-west street closing the western loop.
  laneTrue("jp-westside-north-1", jpNodes.sw, jpNodes.cw, "left", ["jp-westside-north-2", "jp-centerrow-west-e"], "travel", [point(-261.5, -27)], ["jp-westside-south-1"], "jp-westside-road", 3),
  laneTrue("jp-westside-north-2", jpNodes.cw, jpNodes.nw, "left", ["jp-northrow-west-e"], "travel", [point(-261.5, 47)], ["jp-westside-south-2"], "jp-westside-road", 3),
  laneTrue("jp-westside-south-2", jpNodes.nw, jpNodes.cw, "left", ["jp-westside-south-1", "jp-centerrow-west-e"], "travel", [point(-258.5, 47)], ["jp-westside-north-2"], "jp-westside-road", 3),
  laneTrue("jp-westside-south-1", jpNodes.cw, jpNodes.sw, "left", ["jp-southrow-west-e", "jp-westside-south-south"], "travel", [point(-258.5, -27)], ["jp-westside-north-1"], "jp-westside-road", 3),
  // --- Southern district: Setagaya-dori arterial and its approaches ---
  // Setagaya-dori (E-W arterial, z=-168): the wider, faster hero through-road.
  laneTrue("jp-dori-east-1", jpNodes.ssW, jpNodes.ssM, "left", ["jp-dori-east-2", "jp-shrine-north"], "travel", [point(-145, -166.5)], ["jp-dori-west-2"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-east-2", jpNodes.ssM, jpNodes.ssE, "left", ["jp-eastside-north"], "travel", [point(21, -166.5)], ["jp-dori-west-1"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-west-1", jpNodes.ssE, jpNodes.ssM, "left", ["jp-dori-west-2", "jp-shrine-north"], "travel", [point(21, -169.5)], ["jp-dori-east-2"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-west-2", jpNodes.ssM, jpNodes.ssW, "left", ["jp-westside-south-north"], "travel", [point(-145, -169.5)], ["jp-dori-east-1"], "jp-setagaya-dori", 3),
  // Westside South (N-S, x=-260): joins Westside Road down to the arterial.
  laneTrue("jp-westside-south-north", jpNodes.ssW, jpNodes.sw, "left", ["jp-westside-north-1", "jp-southrow-west-e"], "travel", [point(-261.5, -120)], ["jp-westside-south-south"], "jp-westside-south", 3),
  laneTrue("jp-westside-south-south", jpNodes.sw, jpNodes.ssW, "left", ["jp-dori-east-1"], "travel", [point(-258.5, -120)], ["jp-westside-south-north"], "jp-westside-south", 3),
  // Shrine Road (narrow N-S, x=-30): extends the central spine south to the arterial.
  laneTrue("jp-shrine-north", jpNodes.ssM, jpNodes.b, "left", ["jp-narrow-north-1", "jp-south-east-2"], "travel", [point(-31.35, -120)], ["jp-shrine-south"], "jp-shrine-road", 2.7),
  laneTrue("jp-shrine-south", jpNodes.b, jpNodes.ssM, "left", ["jp-dori-west-2", "jp-dori-east-2"], "travel", [point(-28.65, -120)], ["jp-shrine-north"], "jp-shrine-road", 2.7),
  // Eastside Road (N-S, x=72): joins the south road down to the arterial.
  laneTrue("jp-eastside-north", jpNodes.ssE, jpNodes.c, "left", ["jp-south-west-2", "jp-curve-north"], "travel", [point(70.5, -120)], ["jp-eastside-south"], "jp-eastside-road", 3),
  laneTrue("jp-eastside-south", jpNodes.c, jpNodes.ssE, "left", ["jp-dori-west-1"], "travel", [point(73.5, -120)], ["jp-eastside-north"], "jp-eastside-road", 3),
];

export const MAP_PACKS: readonly MapPack[] = [
  LONDON_MAP_PACK,
  CAIRO_MAP_PACK,
  NYC_MAP_PACK,
  {
    id: "tokyo-setagaya",
    name: "Tokyo — Setagaya",
    areaLabel: "Yamashita, Miyanosaka and Gotokuji",
    countryIds: ["jp"],
    // The names the lanes were authored under — every road here was already
    // described in the comments above, this promotes them to data. Only
    // Setagaya-dori is a real street; the rest are this neighbourhood's own.
    roadNames: {
      "jp-setagaya-dori": "Setagaya-dori",
      "jp-south-road": "Yamashita St",
      "jp-center-road": "Miyanosaka St",
      "jp-north-road": "Gotokuji St",
      "jp-west-road": "West St",
      "jp-east-curve": "East Curve",
      "jp-junction-road": "Junction St",
      "jp-narrow-road": "Narrow Lane",
      "jp-westhill-road": "Westhill St",
      "jp-narrowhill-road": "Narrowhill Lane",
      "jp-easthill-road": "Easthill St",
      "jp-uptown-road": "Uptown St",
      "jp-westedge-road": "Westedge St",
      "jp-southrow-west": "South Row",
      "jp-centerrow-west": "Center Row",
      "jp-northrow-west": "North Row",
      "jp-westside-road": "Westside St",
      "jp-westside-south": "Westside South",
      "jp-shrine-road": "Shrine Lane",
      "jp-eastside-road": "Eastside St",
      // Checked against the limit table, so a road cannot be named without
      // being posted or posted without being named.
    } satisfies Readonly<Record<keyof typeof TOKYO_ROAD_SPEED_LIMITS, string>>,
    source: osmSource(
      { south: 35.6476, west: 139.6345, north: 35.6568, east: 139.6539 },
      "https://www.openstreetmap.org/export#map=16/35.6522/139.6442",
      "manifest-v1:tokyo-setagaya-2026-07-10",
    ),
    geometry: {
      worldSize: point(600, 420),
      roadWidth: 6.5,
      shoulderWidth: 0.8,
      roadSurfaces: [
        roadSurface("jp-south-road", [jpNodes.a.position, jpNodes.b.position, jpNodes.c.position], 6.4, ["jp-south-east-1", "jp-south-east-2", "jp-south-west-1", "jp-south-west-2"]),
        roadSurface("jp-east-curve", [jpNodes.c.position, point(102, -56), point(108, -35), jpNodes.d.position], 6.4, ["jp-curve-north", "jp-curve-south"]),
        roadSurface("jp-center-road", [jpNodes.d.position, point(82, 18), jpNodes.e.position, jpNodes.f.position, jpNodes.g.position], 6.4, ["jp-center-west-1", "jp-center-west-2", "jp-center-west-3", "jp-center-east-1", "jp-center-east-2", "jp-center-east-3"]),
        roadSurface("jp-west-road", [jpNodes.g.position, jpNodes.h.position], 6.4, ["jp-west-north", "jp-west-south"]),
        roadSurface("jp-north-road", [jpNodes.h.position, jpNodes.i.position, jpNodes.j.position], 6.4, ["jp-north-east-1", "jp-north-east-2", "jp-north-west-1", "jp-north-west-2"]),
        roadSurface("jp-junction-road", [jpNodes.e.position, point(82, 47), jpNodes.j.position], 6.4, ["jp-junction-south", "jp-junction-north"]),
        roadSurface("jp-narrow-road", [jpNodes.b.position, jpNodes.f.position, jpNodes.i.position], 5.8, ["jp-narrow-north-1", "jp-narrow-north-2", "jp-narrow-south-1", "jp-narrow-south-2"], "shared_space"),
        roadSurface("jp-westhill-road", [jpNodes.h.position, jpNodes.nw2.position], 6.4, ["jp-westhill-north", "jp-westhill-south"]),
        roadSurface("jp-narrowhill-road", [jpNodes.i.position, jpNodes.nm2.position], 5.8, ["jp-narrowhill-north", "jp-narrowhill-south"], "shared_space"),
        roadSurface("jp-easthill-road", [jpNodes.j.position, jpNodes.ne2.position], 6.4, ["jp-easthill-north", "jp-easthill-south"]),
        roadSurface("jp-uptown-road", [jpNodes.nw2.position, jpNodes.nm2.position, jpNodes.ne2.position], 6.4, ["jp-uptown-east-1", "jp-uptown-east-2", "jp-uptown-west-1", "jp-uptown-west-2"]),
        roadSurface("jp-westedge-road", [jpNodes.a.position, jpNodes.g.position], 6.4, ["jp-westedge-north", "jp-westedge-south"]),
        roadSurface("jp-southrow-west", [jpNodes.a.position, jpNodes.sw.position], 6.4, ["jp-southrow-west-w", "jp-southrow-west-e"]),
        roadSurface("jp-centerrow-west", [jpNodes.g.position, jpNodes.cw.position], 6.4, ["jp-centerrow-west-w", "jp-centerrow-west-e"]),
        roadSurface("jp-northrow-west", [jpNodes.h.position, jpNodes.nw.position], 6.4, ["jp-northrow-west-w", "jp-northrow-west-e"]),
        roadSurface("jp-westside-road", [jpNodes.sw.position, jpNodes.cw.position, jpNodes.nw.position], 6.4, ["jp-westside-north-1", "jp-westside-north-2", "jp-westside-south-1", "jp-westside-south-2"]),
        roadSurface("jp-setagaya-dori", [jpNodes.ssW.position, jpNodes.ssM.position, jpNodes.ssE.position], 6.4, ["jp-dori-east-1", "jp-dori-east-2", "jp-dori-west-1", "jp-dori-west-2"], "standard", [roadMarking("jp-dori-centre", "centre_dashed", [jpNodes.ssW.position, jpNodes.ssE.position], "white")]),
        roadSurface("jp-westside-south", [jpNodes.sw.position, jpNodes.ssW.position], 6.4, ["jp-westside-south-north", "jp-westside-south-south"]),
        roadSurface("jp-shrine-road", [jpNodes.b.position, jpNodes.ssM.position], 5.8, ["jp-shrine-north", "jp-shrine-south"], "shared_space"),
        roadSurface("jp-eastside-road", [jpNodes.c.position, jpNodes.ssE.position], 6.4, ["jp-eastside-north", "jp-eastside-south"]),
      ],
      blocks: [
        { id: "jp-block-west", center: point(-70, 46), size: point(64, 40), heightRange: [5, 14], density: 0.72, material: "plaster" },
        { id: "jp-block-center", center: point(10, 46), size: point(64, 40), heightRange: [6, 18], density: 0.78, material: "tile" },
        // Split either side of the narrow shrine street: the old single
        // 100 m rect spanned x[-98,2] and so ran straight across the
        // jp-narrow lanes at x≈-30. The halves stop 3 m clear of each kerb.
        { id: "jp-block-south-w", center: point(-66.25, -30), size: point(63.5, 50), heightRange: [5, 13], density: 0.7, material: "wood-plaster" },
        { id: "jp-block-south-e", center: point(-11.75, -30), size: point(27.5, 50), heightRange: [5, 13], density: 0.7, material: "wood-plaster" },
        { id: "jp-block-north", center: point(-71, 116), size: point(72, 64), heightRange: [5, 15], density: 0.7, material: "plaster" },
        { id: "jp-block-west-lower", center: point(-186, -27), size: point(136, 72), heightRange: [5, 13], density: 0.68, material: "wood-plaster" },
        { id: "jp-block-west-upper", center: point(-186, 47), size: point(136, 44), heightRange: [6, 16], density: 0.72, material: "tile" },
        { id: "jp-block-south-west", center: point(-215, -120), size: point(70, 74), heightRange: [5, 12], density: 0.66, material: "wood-plaster" },
        { id: "jp-block-south-east", center: point(21, -120), size: point(92, 74), heightRange: [6, 14], density: 0.72, material: "plaster" },
      ],
      servicePoints: [
        // The narrow south road still needs a 17.3 m set-back because the lot
        // is anchored on the near lane. Shifted 4 m east of the old anchor so
        // the west edge clears the junction apron at jp-a rather than kissing
        // its corner.
        { id: "jp-gas", kind: "gas_station", anchor: { laneId: "jp-south-east-1", distanceAlongM: 22 }, footprint: point(12, 8), label: "Setagaya Fuel", setbackM: 17.3 },
        // Fuel is in the south-west, so the workshop takes the north row. Like
        // the station it is anchored on the near lane and thrown across the
        // road by the driver's-right set-back, which on a left-hand-traffic map
        // is the far side — that is what puts it against the north block.
        { id: "jp-repair", kind: "repair_shop", anchor: { laneId: "jp-north-west-2", distanceAlongM: 36 }, footprint: point(10, 8), label: "Setagaya Auto", setbackM: 10.5 },
      ],
      gigVenues: [
        // West side of the narrow street (driver's right of the southbound
        // lane): the old north-1@82 corner plot overlapped both the centre
        // road's south edge and the Gotokuji station box.
        { id: "jp-v1", kind: "restaurant", anchor: { laneId: "jp-narrow-south-1", distanceAlongM: 13 }, footprint: point(12, 9), name: "Gotokuji Bento" },
        { id: "jp-v2", kind: "shop", anchor: { laneId: "jp-uptown-east-2", distanceAlongM: 40 }, footprint: point(12, 9), name: "Miyanosaka Market" },
        { id: "jp-v3", kind: "residence", anchor: { laneId: "jp-north-east-2", distanceAlongM: 54 }, footprint: point(12, 10), name: "Setagaya Residence" },
        { id: "jp-v4", kind: "office", anchor: { laneId: "jp-dori-east-2", distanceAlongM: 60 }, footprint: point(14, 12), name: "Setagaya-dori Office" },
      ],
      landmarks: [
        { id: "jp-gotokuji-station", kind: "station", center: point(-14, 6), size: point(20, 9), color: "#e85e59" },
        { id: "jp-setagaya-line", kind: "railway", center: point(18, -62), size: point(5, 72), color: "#656a70" },
        // The former temple garden covered the live junction. Keep it visible
        // to the east of the street instead of placing it over the asphalt.
        { id: "jp-temple-green", kind: "park", center: point(106, 48), size: point(24, 28), color: "#527b4d" },
        // Gotokuji temple grounds (the maneki-neko cat temple) fill the
        // northern block; the Shoin shrine sits in the southern district.
        { id: "jp-gotokuji-temple", kind: "park", center: point(30, 124), size: point(62, 58), color: "#5b8a52" },
        { id: "jp-shoin-shrine", kind: "park", center: point(-148, -118), size: point(48, 44), color: "#4f7b48" },
        { id: "jp-carrot-tower", kind: "tower", center: point(60, 60), size: point(12, 12), color: "#b6553f" },
      ],
    },
    laneGraph: graph(
      Object.values(jpNodes),
      jpLanes,
      [
        control("jp-rail-signal", "railway_signal", 18, -72, 90, ["jp-south-east-2", "jp-south-west-2"], ["jp-rail-conflict"],
          [
            approach("jp-rail-eastbound-approach", "jp-south-east-2", 42, "railway", ["jp-rail-conflict"]),
            approach("jp-rail-westbound-approach", "jp-south-west-2", 48, "railway", ["jp-rail-conflict"]),
          ],
          [
            installation("jp-rail-east-crossing", 12, -77, 90, "railway_crossing", "japan_railway", "primary"),
            installation("jp-rail-west-crossing", 24, -67, 270, "railway_crossing", "japan_railway", "secondary"),
          ]),
        control("jp-stop-narrow", "stop", -30, 12, 0, ["jp-narrow-north-1"], undefined,
          [approach("jp-stop-narrow-approach", "jp-narrow-north-1", 82, "stop")],
          [installation("jp-stop-narrow-sign", -36, 10, 0, "roadside_pole", "stop_sign", "primary")]),
        control("jp-crosswalk-station", "crosswalk", -30, 18, 90, ["jp-center-west-2", "jp-narrow-north-1"], ["jp-station-conflict"],
          [
            approach("jp-station-westbound-crosswalk", "jp-center-west-2", 76, "crosswalk", ["jp-station-conflict"]),
            approach("jp-station-northbound-crosswalk", "jp-narrow-north-1", 82, "crosswalk", ["jp-station-conflict"]),
          ],
          [installation("jp-station-crosswalk-marking", -30, 18, 90, "road_marking", "crosswalk", "marking")]),
      ],
      [
        { id: "jp-rail-conflict", laneIds: ["jp-south-east-2", "jp-south-west-2"], polygon: [point(12, -80), point(24, -80), point(24, -64), point(12, -64)] },
        { id: "jp-station-conflict", laneIds: ["jp-center-west-2", "jp-narrow-north-1"], polygon: [point(-38, 10), point(-22, 10), point(-22, 26), point(-38, 26)] },
        { id: "jp-east-curve-junction-conflict", laneIds: ["jp-curve-north", "jp-curve-south", "jp-center-west-1", "jp-center-east-3"], polygon: [point(104, -26), point(120, -26), point(120, -10), point(104, -10)] },
        { id: "jp-east-neighbourhood-junction-conflict", laneIds: ["jp-center-west-1", "jp-center-east-3", "jp-junction-south", "jp-junction-north"], polygon: [point(46, 10), point(62, 10), point(62, 26), point(46, 26)] },
      ],
      [
        anchoredSpawn("jp-player", "player", "jp-south-east-1", 18),
        anchoredSpawn("jp-car-1", "vehicle", "jp-curve-north", 12),
        // Oncoming/cross traffic seeded across the enlarged network; the
        // adapter's two-way gate supplement keeps the other lanes populated.
        anchoredSpawn("jp-car-dori-e", "vehicle", "jp-dori-east-1", 60),
        anchoredSpawn("jp-car-dori-w", "vehicle", "jp-dori-west-1", 50),
        anchoredSpawn("jp-car-uptown", "vehicle", "jp-uptown-east-1", 45),
        anchoredSpawn("jp-car-uptown-w", "vehicle", "jp-uptown-west-1", 60),
        anchoredSpawn("jp-car-westside", "vehicle", "jp-westside-north-1", 40),
        anchoredSpawn("jp-car-westhill", "vehicle", "jp-westhill-south", 45),
        anchoredSpawn("jp-car-eastside", "vehicle", "jp-eastside-north", 45),
        anchoredSpawn("jp-car-southrow", "vehicle", "jp-southrow-west-e", 70),
        freeSpawn("jp-ped-1", "pedestrian", -35, 10, 0),
        freeSpawn("jp-cyclist-1", "cyclist", -30, 48, 0, "jp-narrow-north-2"),
        freeSpawn("jp-ped-uptown", "pedestrian", -71, 164, 0),
        freeSpawn("jp-ped-dori", "pedestrian", -140, -164, 90),
        freeSpawn("jp-ped-westside", "pedestrian", -256, -20, 0),
        freeSpawn("jp-ped-shrine", "pedestrian", -34, -110, 0),
        freeSpawn("jp-cyclist-uptown", "cyclist", -31.35, 120, 0, "jp-narrowhill-north"),
        freeSpawn("jp-cyclist-dori", "cyclist", -145, -166.5, 90, "jp-dori-east-1"),
      ],
      [
        checkpoint("jp-start", "Setagaya start", "jp-south-east-1", 18),
        checkpoint("jp-rail", "Setagaya Line crossing", "jp-south-east-2", 38),
        checkpoint("jp-rail-clear", "Clear of the Setagaya Line", "jp-south-east-2", 60),
        checkpoint("jp-stop", "Narrow-street stop line", "jp-narrow-north-1", 82),
        checkpoint("jp-uptown", "Uptown Miyanosaka turn", "jp-uptown-east-2", 40),
        checkpoint("jp-station", "Gotokuji station crossing", "jp-center-west-2", 76),
        checkpoint("jp-finish", "Neighbourhood finish", "jp-north-east-2", 54),
        checkpoint("jp-local-finish", "Neighbourhood street finish", "jp-center-west-3", 54),
        checkpoint("jp-west-finish", "Yamashita west-side finish", "jp-northrow-west-e", 70),
        checkpoint("jp-dori", "Setagaya-dori arterial", "jp-dori-east-2", 60),
        checkpoint("jp-hill-finish", "Miyanosaka hill finish", "jp-westhill-south", 45),
        checkpoint("jp-vru-finish", "Patient-space exercise finish", "jp-southrow-west-e", 70),
      ],
    ),
  },
];

export const FREE_DRIVES: readonly FreeDriveDefinition[] = [
  LONDON_FREE_DRIVE,
  CAIRO_FREE_DRIVE,
  NYC_FREE_DRIVE,
  {
    id: "free-jp",
    countryId: "jp",
    destinationId: "jp-tokyo",
    mapId: "tokyo-setagaya",
    title: "Free Drive — Tokyo Setagaya",
    description: "Navigate narrow left-side neighbourhood streets with patient local traffic.",
    startSpawnId: "jp-player",
    trafficSeed: 2401,
  },
];

/** Fuel-tank capacity in litres (same car everywhere). */
export const TANK_CAPACITY_L = 40;

/** Fuel burned per metre travelled (~2 L/km → ~20 km on a full tank). */
export const FUEL_CONSUMPTION_L_PER_M = 0.002;

/**
 * Pump price per litre, in each country's own currency. Tuned so a full refuel
 * is affordable from the starting wallet before gig income arrives.
 */
export const FUEL_PRICE_PER_LITRE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 0.4,
  uk: 0.45,
  jp: 60,
  eg: 20,
};

/**
 * Below this the pump has nothing worth selling — either the tank is already
 * near enough full or the wallet is near enough empty — and the prompt says so
 * rather than offering a fill. Half a litre is ~250 m of free-drive range, so
 * it is not worth a cutscene either way.
 */
export const MIN_REFUEL_LITRES = 0.5;

/**
 * What a free-drive wallet actually buys at the pump: litres poured and price
 * paid, at the country's flat rate per litre.
 *
 * Short money buys a short fill. The pump used to refuse the sale outright
 * unless the wallet covered the whole missing tank, which stranded a driver who
 * had *some* money and no other way to earn it back (#259); a quarter of the
 * price now pours a quarter of the fuel.
 *
 * **Career deliberately does not price through here.** Its pump is ungated and
 * its charge is allowed to push the day into the red, which is exactly what the
 * night's settlement and its loans exist to absorb — capping it at day cash
 * would leave a driver already in the red no way to buy fuel at all, while the
 * far more expensive roadside rescue stayed free. Same backwardness `repairPrice`
 * avoids by never gating the shop.
 *
 * `cost` is clamped to the wallet as well as derived from it: rounding to minor
 * units must never bill a fraction more than the player is holding.
 */
export function fuelPurchase(
  countryId: CountryId,
  litresWanted: number,
  wallet: number,
): { readonly litres: number; readonly cost: number } {
  const pricePerLitre = FUEL_PRICE_PER_LITRE_BY_COUNTRY[countryId];
  const wanted = Math.max(0, litresWanted);
  const budget = Math.max(0, wallet);
  const litres =
    pricePerLitre > 0 ? Math.min(wanted, budget / pricePerLitre) : wanted;
  return {
    litres,
    cost: Math.min(budget, Math.round(litres * pricePerLitre * 100) / 100),
  };
}

/**
 * Delivery reward per country: base fare plus a per-metre rate over the pickup →
 * drop-off distance, in the local currency.
 */
export const GIG_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 4, ratePerM: 0.012 },
  uk: { base: 4, ratePerM: 0.012 },
  jp: { base: 600, ratePerM: 2 },
  eg: { base: 200, ratePerM: 0.6 },
};

/**
 * Passenger fares carry a pickup premium over parcel deliveries: a higher base
 * plus a slightly steeper per-metre rate, so ferrying a rider pays better than
 * dropping a package the same distance.
 */
export const PASSENGER_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 7, ratePerM: 0.018 },
  uk: { base: 7, ratePerM: 0.018 },
  jp: { base: 1000, ratePerM: 3 },
  eg: { base: 350, ratePerM: 0.9 },
};

/**
 * Flat fine debited when a patrol car witnesses a road violation (wrong side,
 * off-road, running a red). Deliberately modest — a couple of fares' worth — so
 * it nudges rather than punishes; the pivot away from termination means careless
 * driving should cost money, not end the run.
 *
 * Speeding is the exception: it is the one violation the game measures by
 * degree, so it is priced by degree too. See `speedingFine`, which scales from
 * this figure rather than replacing it — every consumer that reasons about what
 * a fine is worth (`REPAIR_RATE_BY_COUNTRY`, the starting-wallet check) still
 * has one number to reason about.
 */
export const FINE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 8,
  uk: 8,
  jp: 800,
  eg: 400,
};

/**
 * A speed in metres per second, read in the unit that country's signs use.
 *
 * The simulation works in m/s and every posted figure is in the local unit, so
 * anything that puts the two side by side — what the officer writes on the
 * ticket, what the toast tells the player — has to cross over once. The pair of
 * constants is the same one `SimulationCore.toDisplaySpeed` uses; there is
 * nowhere to share them from, because `simulation.ts` imports only `./types`
 * and knows nothing of countries.
 */
export function postedSpeed(
  metresPerSecond: number,
  country: CountryProfile,
): number {
  return metresPerSecond * (country.speedUnit === "mph" ? 2.236936 : 3.6);
}

/**
 * What a speeding ticket costs, scaled by how far over the driver was.
 *
 * Every other fine is flat because every other violation is binary — you were
 * on the wrong side of the road or you were not. Speeding has a magnitude, and
 * a flat charge for it says twelve over and forty over are the same offence.
 *
 * `speedingFineMultiplier` runs 1x to 2x; a patrol only cites past its own
 * tolerance, about five over, so real tickets land between roughly 1.25x and
 * 2x — $10 to $16 in New York, one to two short fares. That keeps the
 * "deliberately modest" calibration above: the point is still to nudge, only
 * now it nudges harder the worse the driving.
 *
 * Rounded to a whole unit of the currency, or to the nearest hundred where the
 * currency has no minor units at all — a yen ticket reading Y1,347 would be the
 * only price in the game that does.
 */
export function speedingFine(
  country: CountryProfile,
  overInPostedUnits: number,
): number {
  const base = FINE_BY_COUNTRY[country.id];
  const multiplier = speedingFineMultiplier(
    overInPostedUnits,
    country.speedUnit,
  );
  const step = country.currency.minorUnits === 0 ? 100 : 1;
  return Math.round((base * multiplier) / step) * step;
}

/**
 * What a full rebuild — all 100 condition points — costs at a repair shop.
 *
 * These were the flat tow-and-repair fee before repair shops existed, kept to
 * the digit so the balance they were tuned to still holds: roughly three fines'
 * worth, enough that wrecking the car stings harder than a citation without
 * bankrupting a session. What changed is what they mean. The figure is now the
 * *most* a repair can cost rather than what every repair costs, and the tow
 * charges a premium on top of it (see `repairPrice`).
 */
export const REPAIR_RATE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 25,
  uk: 25,
  jp: 2500,
  eg: 1250,
};

/** Where the work is done — the two ways a damaged car gets fixed. */
export type RepairService = "shop" | "tow";

/**
 * What fixing the car costs, by how broken it is and who does it.
 *
 * The shop bills only the damage actually carried, so the bill scales with the
 * driving; the tow bills all 100 points whatever the car went in with, at the
 * roadside premium and with the roadside call-out on top. That is the same
 * shape — and deliberately the same two constants — as filling up at a pump
 * versus being rescued with a jerrycan: the service that comes to you costs
 * more than the one you drive to.
 *
 * The gap that produces is the point of the feature. A full rebuild is $25 at a
 * shop and $48 towed, so limping in at 40% damage costs $10 against the $48 of
 * pushing on and writing the car off. Damage stops being a binary "am I about
 * to get towed" and becomes a running cost worth managing.
 *
 * The curve is linear on purpose. Anything steeper makes an early detour
 * disproportionately cheap and muddles the one thing the player has to
 * internalise: half the damage, half the price.
 *
 * Rounded to a whole unit of the currency, or to the nearest hundred where the
 * currency has no minor units — the same readability rule `speedingFine` uses,
 * and for the same reason: a yen bill reading ¥1,347 would be the only price in
 * the game that does.
 */
export function repairPrice(
  country: CountryProfile,
  damagePct: number,
  service: RepairService,
): number {
  const billed =
    service === "tow"
      ? FULL_CONDITION_PCT
      : Math.min(FULL_CONDITION_PCT, Math.max(0, damagePct));
  const premium = service === "tow" ? ROADSIDE_PRICE_FACTOR : 1;
  const callout =
    service === "tow" ? ROADSIDE_CALLOUT_FEE_BY_COUNTRY[country.id] : 0;
  const raw =
    ((REPAIR_RATE_BY_COUNTRY[country.id] * billed) / FULL_CONDITION_PCT) *
      premium +
    callout;
  const step = country.currency.minorUnits === 0 ? 100 : 1;
  return Math.round(raw / step) * step;
}

/** Starting cash a new (or migrated) player holds in each country's currency. */
export const STARTING_WALLET_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 20,
  uk: 20,
  jp: 3000,
  eg: 1000,
};

/** Formats an amount in a country's own currency, e.g. £1,250 or ¥3,000. */
export function formatMoney(amount: number, country: CountryProfile): string {
  const { symbol, minorUnits } = country.currency;
  const value = Number.isFinite(amount) ? amount : 0;
  const fixed = Math.abs(value).toFixed(minorUnits);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return `${value < 0 ? "-" : ""}${symbol}${body}`;
}

/**
 * Formats a distance the way that country signs them, e.g. "0.4 mi" or "350 m".
 *
 * There is no `distanceUnit` on a country profile, and adding one would be a
 * second source of truth: `speedUnit` already says which system a country
 * drives in, and it is right for all of them — the mph countries sign in miles,
 * the km/h ones in metres and kilometres.
 *
 * The rounding is deliberately coarse. A guidance readout refreshes ten times a
 * second, and a string that changes every one of those re-lays-out a text node
 * for no benefit — nobody reads a drop-off as 0.37 mi. Quantising to a tenth of
 * a mile or ten metres changes it about once a second, which is also how a real
 * one reads.
 */
export function formatDistance(metres: number, country: CountryProfile): string {
  const { value, unit } = formatDistanceParts(metres, country);
  return `${value} ${unit}`;
}

/**
 * The same figure with the number and the unit kept apart, for a readout that
 * sets them at different sizes — a guidance banner puts the distance at display
 * weight and the unit small beside it. Splitting `formatDistance`'s string on a
 * space would work today and break the first time a unit has one in it.
 */
export function formatDistanceParts(
  metres: number,
  country: CountryProfile,
): { readonly value: string; readonly unit: string } {
  const value = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  if (country.speedUnit === "mph") {
    const miles = value / 1609.344;
    // Below a tenth of a mile "0.1 mi" stops distinguishing anything, and the
    // instruction is imminent, so it switches to the short unit that country
    // signs in — Britain in yards, America in feet.
    if (miles < 0.1) {
      const yards = value * 1.09361;
      if (country.id === "uk") {
        return { value: String(Math.max(10, Math.round(yards / 10) * 10)), unit: "yd" };
      }
      return {
        value: String(Math.max(50, Math.round((yards * 3) / 50) * 50)),
        unit: "ft",
      };
    }
    return { value: miles.toFixed(1), unit: "mi" };
  }
  if (value < 1000) {
    return { value: String(Math.max(10, Math.round(value / 10) * 10)), unit: "m" };
  }
  return { value: (value / 1000).toFixed(1), unit: "km" };
}

export const SCORING_CONFIG: ScoringConfig = {
  weights: {
    safety: 0.5,
    ruleUse: 0.35,
    vehicleControl: 0.15,
  },
  masteryThreshold: 80,
  masteryAllowsCriticalErrors: false,
  criticalRuleCodes: ["collision", "wrong_way", "red_light", "out_of_bounds"],
  penalties: {
    collision: 50,
    wrong_way: 35,
    red_light: 35,
    out_of_bounds: 30,
    speeding: 6,
    incomplete_stop: 8,
    missing_indicator: 4,
    unsafe_gap: 12,
    following_distance: 7,
    lane_misuse: 6,
    one_way: 20,
    roundabout_yield: 12,
    merge: 10,
    pedestrian_priority: 18,
    cyclist_clearance: 12,
    railway_crossing: 20,
    priority_to_right: 10,
    observation: 6,
    border_transition: 15,
    box_junction: 6,
    restricted_lane: 4,
  },
};

const countryById = new Map(COUNTRY_PROFILES.map((profile) => [profile.id, profile]));
const destinationById = new Map(
  DESTINATION_PROFILES.map((profile) => [profile.id, profile]),
);
const mapById = new Map(MAP_PACKS.map((mapPack) => [mapPack.id, mapPack]));
const freeDriveById = new Map(FREE_DRIVES.map((freeDrive) => [freeDrive.id, freeDrive]));

export function getCountryProfile(id: CountryId): CountryProfile {
  const profile = countryById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap country profile: ${id}`);
  }
  return profile;
}

export function getDestinationProfile(id: DestinationId): DestinationProfile {
  const profile = destinationById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap destination profile: ${id}`);
  }
  return profile;
}

export function getMapPack(id: MapId): MapPack {
  const mapPack = mapById.get(id);
  if (!mapPack) {
    throw new Error(`Unknown SideSwap map pack: ${id}`);
  }
  return mapPack;
}

export function getFreeDrive(id: FreeDriveId): FreeDriveDefinition {
  const freeDrive = freeDriveById.get(id);
  if (!freeDrive) {
    throw new Error(`Unknown SideSwap free-drive scenario: ${id}`);
  }
  return freeDrive;
}

export function getFreeDriveForDestination(
  id: DestinationId,
): FreeDriveDefinition {
  const freeDrive = FREE_DRIVES.find((scenario) => scenario.destinationId === id);
  if (!freeDrive) {
    throw new Error(`Missing SideSwap free-drive scenario for destination ${id}`);
  }
  return freeDrive;
}

/**
 * Validates the launch tuple: the chosen free drive must belong to the exact
 * destination, country and map the player selected.
 */
export function isScenarioCompatibleWithDestination(
  scenarioId: ScenarioId,
  destinationId: DestinationId,
): boolean {
  const destination = getDestinationProfile(destinationId);
  const freeDrive = getFreeDrive(scenarioId);
  return (
    freeDrive.destinationId === destinationId &&
    freeDrive.countryId === destination.countryId &&
    freeDrive.mapId === destination.mapId
  );
}

export function resolveSteeringSide(
  preference: SteeringPreference,
  profile: CountryProfile,
): SteeringSide {
  return preference === "auto" ? profile.defaultSteeringSide : preference;
}

export function resolveSessionConfig(config: GameSessionConfig): ResolvedGameSessionConfig {
  const profile = getCountryProfile(config.countryId);
  const destination = getDestinationProfile(config.destinationId);
  if (destination.countryId !== config.countryId) {
    throw new Error(
      `SideSwap destination ${config.destinationId} is not compatible with country ${config.countryId}`,
    );
  }
  if (!isScenarioCompatibleWithDestination(config.scenarioId, config.destinationId)) {
    throw new Error(
      `SideSwap scenario ${config.scenarioId} is not compatible with destination ${config.destinationId}`,
    );
  }
  return {
    ...config,
    trafficSide: profile.trafficSide,
    steeringSide: resolveSteeringSide(config.steeringPreference, profile),
    speedUnit: profile.speedUnit,
  };
}

export function getRuleReference(referenceId: string): OfficialRuleReference | undefined {
  for (const profile of COUNTRY_PROFILES) {
    const reference = profile.officialReferences.find((item) => item.id === referenceId);
    if (reference) {
      return reference;
    }
  }
  return undefined;
}

export function isFreeDriveId(value: string): value is FreeDriveId {
  return freeDriveById.has(value as FreeDriveId);
}

export function getPenaltyForRule(code: RuleCode): number {
  return SCORING_CONFIG.penalties[code] ?? 0;
}
