import { buildLaneTrueGeometry, CONNECTOR_BLEND_RUN_M } from "./laneConnectors";
import { buildingSetDepthM, isBuildingSetId } from "./buildingSets";
import { ROAD_DIVIDED_PARK_IDS } from "./parkLayouts";
import { hashStringToSeed } from "./visuals";
import type {
  FreeDriveDefinition,
  GigVenue,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneSegment,
  MapCheckpoint,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ProceduralBlock,
  ProceduralLandmark,
  RoadMarkingPath,
  RoadSurface,
  ServicePoint,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WaterBody,
  WorldPoint,
} from "./types";

/**
 * Cairo is authored from a compact, deterministic network instead of loading
 * OSM at runtime. The frozen extract beside this file is geographic reference
 * material only; these reviewed rules come from Egypt's Ministry of Interior.
 */
export const CAIRO_CONTENT_REVIEWED_ON = "2026-07-28";

export const CAIRO_RULE_REFERENCES: readonly OfficialRuleReference[] = [
  {
    id: "eg-moi-road-rules",
    title: "Traffic rules, etiquette and signs",
    authority: "Egyptian Ministry of Interior — General Traffic Department",
    jurisdiction: "Egypt",
    url: "https://traffic.moi.gov.eg/Arabic/OurServices/InfoServices/InteriorMinisterDecision/Pages/Traffic-rules-etiquette-signs.aspx",
    reviewedOn: CAIRO_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "missing_indicator",
      "following_distance",
      "unsafe_gap",
      "lane_misuse",
      "one_way",
      "roundabout_yield",
      "pedestrian_priority",
      "observation",
    ],
  },
  {
    id: "eg-moi-traffic-law",
    title: "Traffic Law — traffic control on public roads",
    authority: "Egyptian Ministry of Interior — General Traffic Department",
    jurisdiction: "Egypt",
    url: "https://traffic.moi.gov.eg/English/OurServices/InfoServices/TrafficLaw/Pages/default.aspx",
    reviewedOn: CAIRO_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "collision",
      "unsafe_gap",
      "pedestrian_priority",
      "observation",
    ],
  },
  {
    id: "eg-moi-license-plates",
    title: "License plates, taxes and traffic fees",
    authority: "Egyptian Ministry of Interior — General Traffic Department",
    jurisdiction: "Egypt",
    url: "https://traffic.moi.gov.eg/English/OurServices/InfoServices/InteriorMinisterDecision/Pages/license-plates-taxes-traffic-fees.aspx",
    reviewedOn: CAIRO_CONTENT_REVIEWED_ON,
    appliesTo: [],
  },
];

export const CAIRO_SCENARIO_CLOCK = {
  weekday: "wed",
  minutesAfterMidnight: 10 * 60 + 30,
  label: "Wednesday · 10:30",
} as const;

const point = (x: number, z: number): WorldPoint => ({ x, z });
const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

/**
 * Hand-authored central-Nile junctions. These are deliberately named places,
 * not rows and columns: Garden City's river roads wander, Tahrir's approaches
 * converge radially, and the island and west-bank routes bend independently.
 */
const cairoNodes: readonly LaneNode[] = [
  // East-bank Corniche.
  node("cairo-ec-0", 105, -855),
  node("cairo-ec-1", 95, -660),
  node("cairo-ec-2", 90, -485),
  node("cairo-ec-3", 85, -285),
  node("cairo-ec-4", 92, -115),
  node("cairo-ec-5", 95, 105),
  node("cairo-ec-6", 100, 330),
  node("cairo-ec-7", 105, 585),
  node("cairo-ec-8", 110, 850),
  // Qasr El-Ainy's sinuous Garden City/Tahrir spine.
  node("cairo-eq-0", 240, -860),
  node("cairo-eq-1", 230, -675),
  node("cairo-eq-2", 240, -505),
  node("cairo-eq-3", 280, -320),
  node("cairo-tahrir-hub", 320, -105),
  node("cairo-eq-4", 315, 130),
  node("cairo-eq-5", 325, 360),
  node("cairo-eq-6", 350, 610),
  node("cairo-eq-7", 395, 855),
  // Khedivial east-bank route.
  node("cairo-ed-0", 430, -850),
  node("cairo-ed-1", 390, -690),
  node("cairo-ed-2", 420, -525),
  node("cairo-ed-3", 430, -350),
  node("cairo-tahrir-radial-cross", 445, -265),
  node("cairo-ed-4", 600, 180),
  node("cairo-ed-5", 478, 330),
  node("cairo-ed-6", 505, 580),
  node("cairo-ed-7", 550, 835),
  // Ramsis radial.
  node("cairo-er-0", 610, -850),
  node("cairo-er-1", 570, -650),
  node("cairo-er-2", 520, -470),
  node("cairo-er-3", 520, -370),
  node("cairo-er-4", 433, 30),
  node("cairo-er-5", 520, 185),
  node("cairo-er-6", 610, 365),
  node("cairo-er-7", 690, 575),
  node("cairo-er-8", 785, 825),
  // Al-Galaa outer arc.
  node("cairo-eg-0", 760, -840),
  node("cairo-eg-1", 700, -665),
  node("cairo-eg-2", 720, -480),
  node("cairo-eg-3", 700, -265),
  node("cairo-eg-4", 720, -55),
  node("cairo-eg-5", 710, 170),
  node("cairo-eg-6", 730, 395),
  node("cairo-eg-7", 760, 620),
  node("cairo-eg-8", 855, 850),
  node("cairo-qasr-east", 470, -95),
  node("cairo-qasr-tharwat", 600, -70),
  // Gezira/Zamalek, west shoreline to east shoreline.
  node("cairo-iw-0", -435, -850),
  node("cairo-iw-1", -400, -630),
  node("cairo-iw-2", -442, -410),
  node("cairo-iw-3", -405, -170),
  node("cairo-iw-4", -448, 75),
  node("cairo-iw-5", -428, 325),
  node("cairo-iw-6", -445, 580),
  node("cairo-iw-7", -410, 845),
  node("cairo-ia-0", -350, -840),
  node("cairo-ia-1", -390, -615),
  node("cairo-ia-2", -340, -395),
  node("cairo-ia-3", -385, -175),
  node("cairo-ia-4", -335, 70),
  node("cairo-ia-5", -380, 310),
  node("cairo-ia-6", -330, 565),
  node("cairo-ia-7", -370, 830),
  node("cairo-ib-0", -225, -850),
  node("cairo-ib-1", -270, -625),
  node("cairo-ib-2", -220, -405),
  node("cairo-ib-3", -265, -155),
  node("cairo-ib-4", -215, 90),
  node("cairo-ib-5", -260, 335),
  node("cairo-ib-6", -210, 590),
  node("cairo-ib-7", -250, 850),
  node("cairo-ie-0", -115, -845),
  node("cairo-ie-1", -150, -620),
  node("cairo-ie-2", -105, -400),
  node("cairo-ie-3", -110, -160),
  node("cairo-ie-4", -105, 95),
  node("cairo-ie-5", -145, 340),
  node("cairo-ie-6", -100, 600),
  node("cairo-ie-7", -135, 850),
  // Thin Dokki/Giza-bank edge.
  node("cairo-wo-0", -840, -850),
  node("cairo-wo-1", -820, -620),
  node("cairo-wo-2", -845, -390),
  node("cairo-wo-3", -810, -150),
  node("cairo-wo-4", -835, 95),
  node("cairo-wo-5", -805, 325),
  node("cairo-wo-6", -830, 580),
  node("cairo-wo-7", -800, 850),
  node("cairo-wi-0", -620, -850),
  node("cairo-wi-1", -605, -620),
  node("cairo-wi-2", -630, -390),
  node("cairo-wi-3", -600, -150),
  node("cairo-wi-4", -625, 90),
  node("cairo-wi-5", -610, 325),
  node("cairo-wi-6", -635, 580),
  node("cairo-wi-7", -610, 850),
];

const cairoNodeById = new Map(cairoNodes.map((item) => [item.id, item]));

/**
 * Frozen OSM labels retained as authoring provenance where the public-facing
 * spelling is normalized. HUD/GPS copy consistently uses the familiar
 * "Qasr El-…" / "Al-Galaa" spellings; these exact raw aliases remain
 * verifiable in the committed extract instead of silently rewriting source
 * history.
 */
export const CAIRO_OSM_NAME_REFERENCES: Readonly<Record<string, string>> = {
  "cairo-corniche-el-nil": "Kornish Al Nil Street",
  "cairo-qasr-el-ainy": "Al Qasr Al Eini Street",
  "cairo-galaa-street": "Al Gala' Street",
  "cairo-qasr-el-nil-street": "Kasr El Nil Street",
  "cairo-qasr-el-nil-bridge": "Qasr Al Nil Bridge",
  "cairo-al-galaa-bridge": "Al Gala' Bridge",
  "cairo-nile-island-drive": "Al Nil Street",
};

export interface CairoRoadSpec {
  readonly id: string;
  /** Normalized English HUD/GPS/sign spelling. */
  readonly name: string;
  /** Exact source spelling selected from the committed OSM extract. */
  readonly osmSourceName: string;
  readonly nodeIds: readonly string[];
  readonly speedLimitKmh: 40 | 60;
  /** Total legal lanes across the carriageway. */
  readonly laneCount: 1 | 2 | 4;
  readonly widthM: number;
  readonly sidewalkWidthM: number;
  readonly arterial?: boolean;
  readonly oneWay?: "forward" | "reverse";
}

const road = (
  id: string,
  name: string,
  nodeIds: readonly string[],
  speedLimitKmh: 40 | 60,
  laneCount: 1 | 2 | 4,
  widthM: number,
  sidewalkWidthM: number,
  options: {
    readonly arterial?: boolean;
    readonly oneWay?: "forward" | "reverse";
  } = {},
): CairoRoadSpec => ({
  id,
  name,
  osmSourceName: CAIRO_OSM_NAME_REFERENCES[id] ?? name,
  nodeIds,
  speedLimitKmh,
  laneCount,
  widthM,
  sidewalkWidthM,
  ...options,
});

/**
 * Stable authored order: 12 east-bank corridors, eight island routes, two
 * drivable bridges, then five west-bank streets. Major roads use two or four
 * legal lanes; the narrower one-way fabric keeps the map in Cairo's real
 * lane-kilometre density band rather than imposing Manhattan's uniform grid.
 */
export const CAIRO_ROAD_SPECS: readonly CairoRoadSpec[] = [
  road("cairo-corniche-el-nil", "Corniche El-Nil", ["cairo-ec-0", "cairo-ec-1", "cairo-ec-2", "cairo-ec-3", "cairo-ec-4", "cairo-ec-5", "cairo-ec-6", "cairo-ec-7", "cairo-ec-8"], 60, 2, 10.6, 3.4, { arterial: true }),
  road("cairo-qasr-el-ainy", "Qasr El-Ainy Street", ["cairo-eq-0", "cairo-eq-1", "cairo-eq-2", "cairo-eq-3", "cairo-tahrir-hub", "cairo-eq-4", "cairo-eq-5", "cairo-eq-6", "cairo-eq-7"], 60, 2, 10.6, 3.4, { arterial: true }),
  road("cairo-simon-bolivar", "Al Tahrir Street", ["cairo-ec-2", "cairo-eq-2", "cairo-ed-2", "cairo-er-2", "cairo-eg-2"], 40, 1, 7.4, 2.6, { oneWay: "forward" }),
  road("cairo-talaat-harb", "Abd Al Khaleq Tharwat Street", ["cairo-ed-0", "cairo-ed-1", "cairo-ed-2", "cairo-ed-3", "cairo-tahrir-radial-cross", "cairo-qasr-tharwat"], 40, 1, 8.4, 2.6, { oneWay: "forward" }),
  road("cairo-ramses", "Ramsis Street", ["cairo-er-0", "cairo-er-1", "cairo-er-2", "cairo-er-3", "cairo-tahrir-radial-cross", "cairo-tahrir-hub", "cairo-er-4", "cairo-er-5", "cairo-er-6", "cairo-er-7", "cairo-er-8"], 60, 2, 10.6, 3.4, { arterial: true }),
  road("cairo-galaa-street", "Al-Galaa Street", ["cairo-eg-0", "cairo-eg-1", "cairo-eg-2", "cairo-eg-3", "cairo-eg-4", "cairo-eg-5", "cairo-eg-6", "cairo-eg-7", "cairo-eg-8"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-garden-city-south", "Al Sheikh Rihan Street", ["cairo-ec-0", "cairo-eq-0", "cairo-ed-0", "cairo-er-0", "cairo-eg-0"], 40, 2, 9, 2.2),
  road("cairo-abdel-qader-hamza", "Abd Al Qader Hamza Street", ["cairo-ec-1", "cairo-eq-1", "cairo-ed-1", "cairo-er-1", "cairo-eg-1"], 40, 1, 7.4, 2.4, { oneWay: "reverse" }),
  road("cairo-tahrir-approach", "Magmaa Al Tahrir Street", ["cairo-ec-3", "cairo-eq-3", "cairo-ed-3", "cairo-er-3", "cairo-eg-3"], 60, 2, 9.6, 3.4, { arterial: true, oneWay: "forward" }),
  road("cairo-qasr-el-nil-street", "Qasr El-Nil Street", ["cairo-ec-4", "cairo-tahrir-hub", "cairo-qasr-east", "cairo-qasr-tharwat", "cairo-eg-4"], 60, 4, 16, 3.4, { arterial: true }),
  road("cairo-champollion", "Champollion Street", ["cairo-ec-6", "cairo-eq-5", "cairo-ed-5", "cairo-er-6", "cairo-eg-6"], 40, 1, 7.4, 2.4, { oneWay: "reverse" }),
  road("cairo-ramses-approach", "Abd Al Moneim Riyad Street", ["cairo-ec-8", "cairo-eq-7", "cairo-ed-7", "cairo-er-8", "cairo-eg-8"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-saray-el-gezira", "Al Saraya Street", ["cairo-iw-0", "cairo-iw-1", "cairo-iw-2", "cairo-iw-3", "cairo-iw-4", "cairo-iw-5", "cairo-iw-6", "cairo-iw-7"], 40, 2, 9, 2.4),
  road("cairo-el-gabalaya", "El Gabalaya Street", ["cairo-ia-0", "cairo-ia-1", "cairo-ia-2", "cairo-ia-3", "cairo-ia-4", "cairo-ia-5", "cairo-ia-6", "cairo-ia-7"], 40, 1, 7.4, 2.2, { oneWay: "forward" }),
  road("cairo-opera-corridor", "Montazah Al Gezira Street", ["cairo-ib-0", "cairo-ib-1", "cairo-ib-2", "cairo-ib-3", "cairo-ib-4", "cairo-ib-5", "cairo-ib-6", "cairo-ib-7"], 40, 1, 7.4, 2.6, { oneWay: "reverse" }),
  road("cairo-nile-island-drive", "El-Nil Street", ["cairo-ie-0", "cairo-ie-1", "cairo-ie-2", "cairo-ie-3", "cairo-ie-4", "cairo-ie-5", "cairo-ie-6", "cairo-ie-7"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-south-gezira-road", "Al Malek Abd Al Aziz Aal Seoud Street", ["cairo-iw-0", "cairo-ia-0", "cairo-ib-0", "cairo-ie-0"], 40, 2, 9, 2.4),
  road("cairo-zamalek-south", "Hassan Sabry Street", ["cairo-iw-2", "cairo-ia-2", "cairo-ib-2", "cairo-ie-2"], 40, 1, 7.4, 2.2, { oneWay: "forward" }),
  road("cairo-opera-square", "Al Gezira Street", ["cairo-iw-4", "cairo-ia-4", "cairo-ib-4", "cairo-ie-4"], 40, 1, 7.4, 2.6, { oneWay: "reverse" }),
  road("cairo-zamalek-north", "26th July Street", ["cairo-iw-7", "cairo-ia-7", "cairo-ib-7", "cairo-ie-7"], 40, 2, 9, 2.4),
  road("cairo-qasr-el-nil-bridge", "Qasr El-Nil Bridge", ["cairo-ie-3", "cairo-ec-4"], 60, 2, 11.2, 3.4, { arterial: true }),
  road("cairo-al-galaa-bridge", "Al-Galaa Bridge", ["cairo-wi-5", "cairo-iw-5"], 60, 4, 15, 3.4, { arterial: true }),
  road("cairo-west-nile-street", "Charles De Gaulle Street", ["cairo-wo-0", "cairo-wo-1", "cairo-wo-2", "cairo-wo-3", "cairo-wo-4", "cairo-wo-5", "cairo-wo-6", "cairo-wo-7"], 60, 2, 10.4, 3.4, { arterial: true }),
  road("cairo-dokki-nile-drive", "Al Dokki Street", ["cairo-wi-0", "cairo-wi-1", "cairo-wi-2", "cairo-wi-3", "cairo-wi-4", "cairo-wi-5", "cairo-wi-6", "cairo-wi-7"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-dokki-south", "Al Mesaha Street", ["cairo-wo-0", "cairo-wi-0"], 40, 2, 9, 2.4),
  road("cairo-dokki-midtown", "Gaber Ibn Hayan Street", ["cairo-wo-3", "cairo-wi-3"], 40, 1, 7.4, 2.4, { oneWay: "forward" }),
  road("cairo-agouza-approach", "26th July Street", ["cairo-wo-7", "cairo-wi-7"], 40, 2, 9, 2.4),
];

export interface CairoConnectorMovement {
  readonly fromRoadId: string;
  readonly toRoadIds: readonly string[];
}

export interface CairoJunctionConnectorSpec {
  readonly id: string;
  readonly nodeId: string;
  readonly movements: readonly CairoConnectorMovement[];
}

const junction = (
  id: string,
  nodeId: string,
  roadIds: readonly string[],
): CairoJunctionConnectorSpec => ({
  id,
  nodeId,
  movements: roadIds.map((fromRoadId) => ({
    fromRoadId,
    toRoadIds: roadIds.filter((toRoadId) => toRoadId !== fromRoadId),
  })),
});

/**
 * Explicit legal turn whitelist. Same-road continuation is implicit; every
 * cross-road successor must appear at one of these authored junctions.
 */
export const CAIRO_JUNCTION_CONNECTORS: readonly CairoJunctionConnectorSpec[] = [
  junction("cairo-junction-garden-river", "cairo-ec-0", ["cairo-corniche-el-nil", "cairo-garden-city-south"]),
  junction("cairo-junction-garden-qasr", "cairo-eq-0", ["cairo-qasr-el-ainy", "cairo-garden-city-south"]),
  junction("cairo-junction-garden-tharwat", "cairo-ed-0", ["cairo-talaat-harb", "cairo-garden-city-south"]),
  junction("cairo-junction-garden-ramsis", "cairo-er-0", ["cairo-ramses", "cairo-garden-city-south"]),
  junction("cairo-junction-garden-galaa", "cairo-eg-0", ["cairo-galaa-street", "cairo-garden-city-south"]),
  junction("cairo-junction-hamza-river", "cairo-ec-1", ["cairo-corniche-el-nil", "cairo-abdel-qader-hamza"]),
  junction("cairo-junction-hamza-qasr", "cairo-eq-1", ["cairo-qasr-el-ainy", "cairo-abdel-qader-hamza"]),
  junction("cairo-junction-hamza-tharwat", "cairo-ed-1", ["cairo-talaat-harb", "cairo-abdel-qader-hamza"]),
  junction("cairo-junction-hamza-ramsis", "cairo-er-1", ["cairo-ramses", "cairo-abdel-qader-hamza"]),
  junction("cairo-junction-hamza-galaa", "cairo-eg-1", ["cairo-galaa-street", "cairo-abdel-qader-hamza"]),
  junction("cairo-junction-tahrir-south-river", "cairo-ec-2", ["cairo-corniche-el-nil", "cairo-simon-bolivar"]),
  junction("cairo-junction-tahrir-south-qasr", "cairo-eq-2", ["cairo-qasr-el-ainy", "cairo-simon-bolivar"]),
  junction("cairo-junction-tahrir-south-tharwat", "cairo-ed-2", ["cairo-talaat-harb", "cairo-simon-bolivar"]),
  junction("cairo-junction-tahrir-south-ramsis", "cairo-er-2", ["cairo-ramses", "cairo-simon-bolivar"]),
  junction("cairo-junction-tahrir-south-galaa", "cairo-eg-2", ["cairo-galaa-street", "cairo-simon-bolivar"]),
  junction("cairo-junction-tahrir-approach-river", "cairo-ec-3", ["cairo-corniche-el-nil", "cairo-tahrir-approach"]),
  junction("cairo-junction-tahrir-approach-qasr", "cairo-eq-3", ["cairo-qasr-el-ainy", "cairo-tahrir-approach"]),
  junction("cairo-junction-tahrir-approach-tharwat", "cairo-ed-3", ["cairo-talaat-harb", "cairo-tahrir-approach"]),
  junction("cairo-junction-tahrir-approach-ramsis", "cairo-er-3", ["cairo-ramses", "cairo-tahrir-approach"]),
  junction("cairo-junction-tahrir-approach-galaa", "cairo-eg-3", ["cairo-galaa-street", "cairo-tahrir-approach"]),
  junction("cairo-junction-tahrir-radials", "cairo-tahrir-radial-cross", ["cairo-talaat-harb", "cairo-ramses"]),
  junction("cairo-junction-qasr-bridge-east", "cairo-ec-4", ["cairo-corniche-el-nil", "cairo-qasr-el-nil-street", "cairo-qasr-el-nil-bridge"]),
  junction("cairo-junction-tahrir-hub", "cairo-tahrir-hub", ["cairo-qasr-el-ainy", "cairo-ramses", "cairo-qasr-el-nil-street"]),
  junction("cairo-junction-qasr-tharwat", "cairo-qasr-tharwat", ["cairo-talaat-harb", "cairo-qasr-el-nil-street"]),
  junction("cairo-junction-qasr-galaa", "cairo-eg-4", ["cairo-galaa-street", "cairo-qasr-el-nil-street"]),
  junction("cairo-junction-champollion-river", "cairo-ec-6", ["cairo-corniche-el-nil", "cairo-champollion"]),
  junction("cairo-junction-champollion-qasr", "cairo-eq-5", ["cairo-qasr-el-ainy", "cairo-champollion"]),
  junction("cairo-junction-champollion-ramsis", "cairo-er-6", ["cairo-ramses", "cairo-champollion"]),
  junction("cairo-junction-champollion-galaa", "cairo-eg-6", ["cairo-galaa-street", "cairo-champollion"]),
  junction("cairo-junction-riyad-river", "cairo-ec-8", ["cairo-corniche-el-nil", "cairo-ramses-approach"]),
  junction("cairo-junction-riyad-qasr", "cairo-eq-7", ["cairo-qasr-el-ainy", "cairo-ramses-approach"]),
  junction("cairo-junction-riyad-ramsis", "cairo-er-8", ["cairo-ramses", "cairo-ramses-approach"]),
  junction("cairo-junction-riyad-galaa", "cairo-eg-8", ["cairo-galaa-street", "cairo-ramses-approach"]),
  junction("cairo-junction-gezira-south-west", "cairo-iw-0", ["cairo-saray-el-gezira", "cairo-south-gezira-road"]),
  junction("cairo-junction-gezira-south-gabalaya", "cairo-ia-0", ["cairo-el-gabalaya", "cairo-south-gezira-road"]),
  junction("cairo-junction-gezira-south-opera", "cairo-ib-0", ["cairo-opera-corridor", "cairo-south-gezira-road"]),
  junction("cairo-junction-gezira-south-east", "cairo-ie-0", ["cairo-nile-island-drive", "cairo-south-gezira-road"]),
  junction("cairo-junction-zamalek-south-west", "cairo-iw-2", ["cairo-saray-el-gezira", "cairo-zamalek-south"]),
  junction("cairo-junction-zamalek-south-gabalaya", "cairo-ia-2", ["cairo-el-gabalaya", "cairo-zamalek-south"]),
  junction("cairo-junction-zamalek-south-opera", "cairo-ib-2", ["cairo-opera-corridor", "cairo-zamalek-south"]),
  junction("cairo-junction-zamalek-south-east", "cairo-ie-2", ["cairo-nile-island-drive", "cairo-zamalek-south"]),
  junction("cairo-junction-opera-west", "cairo-iw-4", ["cairo-saray-el-gezira", "cairo-opera-square"]),
  junction("cairo-junction-opera-gabalaya", "cairo-ia-4", ["cairo-el-gabalaya", "cairo-opera-square"]),
  junction("cairo-junction-opera-corridor", "cairo-ib-4", ["cairo-opera-corridor", "cairo-opera-square"]),
  junction("cairo-junction-opera-east", "cairo-ie-4", ["cairo-nile-island-drive", "cairo-opera-square"]),
  junction("cairo-junction-zamalek-north-west", "cairo-iw-7", ["cairo-saray-el-gezira", "cairo-zamalek-north"]),
  junction("cairo-junction-zamalek-north-gabalaya", "cairo-ia-7", ["cairo-el-gabalaya", "cairo-zamalek-north"]),
  junction("cairo-junction-zamalek-north-opera", "cairo-ib-7", ["cairo-opera-corridor", "cairo-zamalek-north"]),
  junction("cairo-junction-zamalek-north-east", "cairo-ie-7", ["cairo-nile-island-drive", "cairo-zamalek-north"]),
  junction("cairo-junction-qasr-bridge-island", "cairo-ie-3", ["cairo-nile-island-drive", "cairo-qasr-el-nil-bridge"]),
  junction("cairo-junction-galaa-bridge-island", "cairo-iw-5", ["cairo-saray-el-gezira", "cairo-al-galaa-bridge"]),
  junction("cairo-junction-galaa-bridge-west", "cairo-wi-5", ["cairo-dokki-nile-drive", "cairo-al-galaa-bridge"]),
  junction("cairo-junction-dokki-south-outer", "cairo-wo-0", ["cairo-west-nile-street", "cairo-dokki-south"]),
  junction("cairo-junction-dokki-south-inner", "cairo-wi-0", ["cairo-dokki-nile-drive", "cairo-dokki-south"]),
  junction("cairo-junction-dokki-mid-outer", "cairo-wo-3", ["cairo-west-nile-street", "cairo-dokki-midtown"]),
  junction("cairo-junction-dokki-mid-inner", "cairo-wi-3", ["cairo-dokki-nile-drive", "cairo-dokki-midtown"]),
  junction("cairo-junction-agouza-outer", "cairo-wo-7", ["cairo-west-nile-street", "cairo-agouza-approach"]),
  junction("cairo-junction-agouza-inner", "cairo-wi-7", ["cairo-dokki-nile-drive", "cairo-agouza-approach"]),
];

interface RawLane extends LaneSegment {
  readonly reverseKey: string;
  readonly direction: "forward" | "reverse";
  readonly laneIndex: number;
}

const distanceBetween = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(b.x - a.x, b.z - a.z);

const laneLength = (lane: Pick<LaneSegment, "centerline">): number =>
  lane.centerline.slice(1).reduce(
    (total, current, index) =>
      total + distanceBetween(lane.centerline[index], current),
    0,
  );

const offsetPath = (
  from: WorldPoint,
  to: WorldPoint,
  offsetM: number,
): readonly WorldPoint[] => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const rightX = uz;
  const rightZ = -ux;
  const inset = Math.min(12, length * 0.2);
  return [
    point(
      from.x + ux * inset + rightX * offsetM,
      from.z + uz * inset + rightZ * offsetM,
    ),
    point(
      to.x - ux * inset + rightX * offsetM,
      to.z - uz * inset + rightZ * offsetM,
    ),
  ];
};

const laneId = (
  roadId: string,
  segmentIndex: number,
  direction: "forward" | "reverse",
  laneIndex: number,
): string =>
  `${roadId}-${segmentIndex + 1}-${direction}-${laneIndex + 1}`;

const rawLanes: RawLane[] = [];
for (const spec of CAIRO_ROAD_SPECS) {
  if (!spec.oneWay && spec.laneCount % 2 !== 0) {
    throw new Error(`${spec.id} two-way laneCount must be even`);
  }
  const directions = spec.oneWay
    ? ([spec.oneWay] as const)
    : (["forward", "reverse"] as const);
  const lanesPerDirection = spec.oneWay
    ? spec.laneCount
    : spec.laneCount / 2;
  for (let segment = 0; segment + 1 < spec.nodeIds.length; segment += 1) {
    const start = cairoNodeById.get(spec.nodeIds[segment]);
    const end = cairoNodeById.get(spec.nodeIds[segment + 1]);
    if (!start || !end) {
      throw new Error(`${spec.id} references a missing node`);
    }
    for (const direction of directions) {
      const from = direction === "forward" ? start : end;
      const to = direction === "forward" ? end : start;
      for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
        const lateralOffset = spec.oneWay
          ? (laneIndex - (lanesPerDirection - 1) / 2) * 3.2
          : 1.65 + laneIndex * 3.2;
        const geometry = buildLaneTrueGeometry(
          from.position,
          to.position,
          offsetPath(from.position, to.position, lateralOffset),
          { maxBlendLateralM: 5.25, connectorBlendSteps: 12 },
        );
        rawLanes.push({
          id: laneId(spec.id, segment, direction, laneIndex),
          reverseKey: `${spec.id}:${segment}`,
          direction,
          laneIndex,
          roadId: spec.id,
          widthM: 3.2,
          from: from.id,
          to: to.id,
          centerline: geometry.centerline,
          role: spec.oneWay
            ? "one_way"
            : laneIndex > 0
              ? "passing"
              : "travel",
          trafficSide: "right",
          speedLimit: spec.speedLimitKmh,
          localSpeedUnit: "kmh",
          successors: [],
        });
      }
    }
  }
}

const outboundByNode = new Map<string, RawLane[]>();
for (const lane of rawLanes) {
  outboundByNode.set(lane.from, [
    ...(outboundByNode.get(lane.from) ?? []),
    lane,
  ]);
}

const connectorByNode = new Map(
  CAIRO_JUNCTION_CONNECTORS.map((connector) => [
    connector.nodeId,
    connector,
  ]),
);

const cairoLanes: readonly LaneSegment[] = rawLanes.map((lane) => {
  const connector = connectorByNode.get(lane.to);
  const allowedCrossRoads = new Set(
    connector?.movements.find(
      (movement) => movement.fromRoadId === lane.roadId,
    )?.toRoadIds ?? [],
  );
  const outbound = (outboundByNode.get(lane.to) ?? [])
    .filter((candidate) => candidate.reverseKey !== lane.reverseKey)
    .filter(
      (candidate) =>
        candidate.roadId === lane.roadId ||
        allowedCrossRoads.has(candidate.roadId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const successors = [...new Set(outbound.map((candidate) => candidate.id))];
  const adjacentLaneIds = rawLanes
    .filter(
      (candidate) =>
        candidate.reverseKey === lane.reverseKey &&
        candidate.direction === lane.direction &&
        candidate.id !== lane.id,
    )
    .map((candidate) => candidate.id)
    .sort();
  return {
    id: lane.id,
    roadId: lane.roadId,
    widthM: lane.widthM,
    from: lane.from,
    to: lane.to,
    centerline: lane.centerline,
    role: lane.role,
    trafficSide: lane.trafficSide,
    speedLimit: lane.speedLimit,
    localSpeedUnit: lane.localSpeedUnit,
    successors,
    ...(adjacentLaneIds.length > 0 ? { adjacentLaneIds } : {}),
  };
});

const cairoLaneById = new Map(cairoLanes.map((lane) => [lane.id, lane]));

const offsetPolyline = (
  centerline: readonly WorldPoint[],
  offsetM: number,
): readonly WorldPoint[] =>
  centerline.map((current, index) => {
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz);
    return length < 0.01
      ? current
      : point(
          current.x + (dz / length) * offsetM,
          current.z - (dx / length) * offsetM,
        );
  });

const roadMarkings = (
  spec: CairoRoadSpec,
  centerline: readonly WorldPoint[],
): readonly RoadMarkingPath[] => {
  if (spec.oneWay) {
    return spec.laneCount > 1
      ? [{
          id: `${spec.id}-lane-divider`,
          style: "lane_dashed",
          points: centerline,
          color: "white",
        }]
      : [];
  }
  const markings: RoadMarkingPath[] = [{
    id: `${spec.id}-centre`,
    style: spec.arterial ? "centre_solid" : "centre_dashed",
    points: centerline,
    color: "white",
  }];
  if (spec.laneCount === 4) {
    markings.push(
      {
        id: `${spec.id}-forward-divider`,
        style: "lane_dashed",
        points: offsetPolyline(centerline, 3.2),
        color: "white",
      },
      {
        id: `${spec.id}-reverse-divider`,
        style: "lane_dashed",
        points: offsetPolyline(centerline, -3.2),
        color: "white",
      },
    );
  }
  return markings;
};

const cairoRoadSurfaces: readonly RoadSurface[] = CAIRO_ROAD_SPECS.map(
  (spec) => {
    const centerline = spec.nodeIds.map((id) => cairoNodeById.get(id)!.position);
    return {
      id: spec.id,
      centerline,
      widthM: spec.widthM,
      sidewalkWidthM: spec.sidewalkWidthM,
      laneIds: cairoLanes
        .filter((lane) => lane.roadId === spec.id)
        .map((lane) => lane.id),
      surfaceType: "standard",
      markings: roadMarkings(spec, centerline),
    };
  },
);

const roadNames = Object.fromEntries(
  CAIRO_ROAD_SPECS.map((spec) => [spec.id, spec.name]),
) satisfies Readonly<Record<string, string>>;

const pointAlongLane = (
  lane: LaneSegment,
  distanceAlongM: number,
): { readonly position: WorldPoint; readonly headingDeg: number } => {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = distanceBetween(start, end);
    if (remaining <= length || index === lane.centerline.length - 2) {
      const amount = length > 0 ? Math.min(1, remaining / length) : 0;
      return {
        position: point(
          start.x + (end.x - start.x) * amount,
          start.z + (end.z - start.z) * amount,
        ),
        headingDeg:
          (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI,
      };
    }
    remaining -= length;
  }
  return { position: lane.centerline.at(-1)!, headingDeg: 0 };
};

const distanceToSegment = (
  candidate: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount =
    lengthSquared > 0
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

const laneClearanceAt = (candidate: WorldPoint): number =>
  Math.min(
    ...cairoLanes.map(
      (lane) =>
        Math.min(
          ...lane.centerline
            .slice(1)
            .map((end, index) =>
              distanceToSegment(candidate, lane.centerline[index], end),
            ),
        ) -
        lane.widthM / 2,
    ),
  );

const nearestPointOnPolyline = (
  candidate: WorldPoint,
  polyline: readonly WorldPoint[],
): WorldPoint => {
  let best = polyline[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((candidate.x - start.x) * dx + (candidate.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const projected = point(start.x + dx * amount, start.z + dz * amount);
    const distance = distanceBetween(candidate, projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = projected;
    }
  }
  return best;
};

/** Just before the bar, so a car stopped at the line still has it in view. */
const CAIRO_SIGNAL_STOP_LINE_SETBACK_M = 1;
/** Past the kerb face, standing on the pavement rather than in the gutter. */
const CAIRO_SIGNAL_KERB_CLEARANCE_M = 1.1;
/** A head may never stand in a carriageway; Cairo's radial arms overlap. */
const CAIRO_SIGNAL_LANE_CLEARANCE_M = 0.6;

/**
 * Where a kerbside primary head stands, relative to the bar it governs: beside
 * the stop line, on the near kerb, on the driver's own side of the road. The
 * numbers match London's hand-placed heads, which are the only ones in the
 * project positioned by eye against the rendered scene.
 *
 * **Clearance is a veto here, not an objective.** The search this replaces
 * scored candidates by `laneClearanceAt` and charged only 0.01 m per metre
 * strayed, so the widest, furthest-back corner of its own grid always won: every
 * head stood 13-24 m out on open ground and 17 of 21 were across the
 * carriageway from the driver they faced. Anything that ranks "far from tarmac"
 * above "beside the stop line" reproduces that.
 */
const safeSignalPosition = (
  stopLine: WorldPoint,
  headingDeg: number,
  surface: RoadSurface,
): WorldPoint => {
  const headingRad = (headingDeg * Math.PI) / 180;
  const forwardX = Math.sin(headingRad);
  const forwardZ = Math.cos(headingRad);
  // Egypt drives on the right, so the near kerb is always the driver's right.
  // Picking the emptier side instead puts the head across the carriageway.
  const rightX = Math.cos(headingRad);
  const rightZ = -Math.sin(headingRad);
  // Lateral offsets are measured from the road surface centreline, not from the
  // approach lane: a two-way lane already sits 1.65 m off centre, and offsetting
  // from it would push the head that much further past the kerb.
  const origin = nearestPointOnPolyline(stopLine, surface.centerline);
  const kerbside = surface.widthM / 2 + CAIRO_SIGNAL_KERB_CLEARANCE_M;
  const at = (backM: number, lateralM: number): WorldPoint =>
    point(
      origin.x - forwardX * backM + rightX * lateralM,
      origin.z - forwardZ * backM + rightZ * lateralM,
    );
  // Least displacement that clears every carriageway. Walking back along the
  // approach retreats from the crossing road while keeping the head in the
  // stopped driver's view, so it is tried before widening onto the pavement.
  for (const backExtra of [0, 3, 6, 9, 12]) {
    for (const lateralExtra of [0, 0.9, 1.8]) {
      const candidate = at(
        CAIRO_SIGNAL_STOP_LINE_SETBACK_M + backExtra,
        kerbside + lateralExtra,
      );
      if (laneClearanceAt(candidate) >= CAIRO_SIGNAL_LANE_CLEARANCE_M) {
        return candidate;
      }
    }
  }
  return at(CAIRO_SIGNAL_STOP_LINE_SETBACK_M, kerbside);
};

const signalNodeIds = [
  "cairo-ec-1",
  "cairo-eq-2",
  "cairo-eq-3",
  "cairo-tahrir-hub",
  "cairo-eg-4",
  "cairo-ec-6",
  "cairo-ia-2",
  "cairo-ib-4",
  "cairo-iw-5",
  "cairo-wi-3",
] as const;

const cairoControls: TrafficControl[] = [];
const cairoConflictZones: LaneGraph["conflictZones"][number][] = [];

for (const [signalIndex, nodeId] of signalNodeIds.entries()) {
  const center = cairoNodeById.get(nodeId)!.position;
  const inbound = cairoLanes.filter((lane) => lane.to === nodeId);
  // Keyed by the node each lane arrives *from*, so one entry is one physical
  // arm of the junction. Grouping by road instead merges the two directions of
  // a two-way street wherever the signal sits mid-road: the pair then shared a
  // single stop line anchored on one direction's lane and a single head facing
  // the other way, so the opposing driver was enforced against a signal that
  // was never built for them. Parallel lanes of one direction still group
  // together — they share a `from`.
  const inboundByArm = new Map<string, LaneSegment[]>();
  for (const lane of inbound) {
    const armKey = `${lane.roadId}|${lane.from}`;
    inboundByArm.set(armKey, [...(inboundByArm.get(armKey) ?? []), lane]);
  }
  const zoneId = `cairo-signal-${signalIndex + 1}-zone`;
  const approaches: TrafficControlApproach[] = [];
  const installations: TrafficControlInstallation[] = [];

  /**
   * Crossing setbacks are geometry, not a constant. At a grid junction the old
   * rule — own half-width + 3.5 m from the node — worked; at Cairo's radials
   * several arms meet at shallow angles, and a crossing set back by its OWN
   * width still lay inside a wider or obliquer neighbour's carriageway (Qasr
   * El Nil St is 16 m wide), so the stripes ploughed through each other. Each
   * arm now sets back until its whole stripe envelope clears every other
   * arm's carriageway; the stop bar retreats behind the stripes; a crossing
   * that cannot clear within reason is dropped — an unmarked arm reads far
   * better than two crossings through each other.
   *
   * The envelope mirrors crosswalkStripeLayout (7 stripes, 1.05 m pitch,
   * 0.62 m deep, 0.82 span factor); tests/cairoContent.test.ts cross-checks
   * these numbers against the real layout so they cannot drift apart.
   */
  const CROSSING_ENVELOPE_HALF_M = 3 * 1.05 + 0.62 / 2;
  const CROSSING_SPAN_FACTOR = 0.82;
  const CROSSING_CLEAR_M = 0.6;
  const arms = [...inboundByArm.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, lanes]) => {
      const lane = lanes[0];
      const surface = cairoRoadSurfaces.find(
        (item) => item.id === lane.roadId,
      )!;
      // De-blended road axis, sampled clear of the node elbow — used both to
      // orient the signal head and to measure angles between arms.
      const axisPose = pointAlongLane(
        lane,
        Math.max(0, Math.max(8, laneLength(lane) - 12) - CONNECTOR_BLEND_RUN_M - 1),
      );
      return { lanes, lane, surface, axisPose };
    });
  const armCrossings = arms.map((arm) => {
    const ownHalfM = arm.surface.widthM / 2;
    let requiredM = ownHalfM + 3.5;
    const outward = ((arm.axisPose.headingDeg + 180) * Math.PI) / 180;
    for (const other of arms) {
      if (other === arm || other.surface.id === arm.surface.id) continue;
      const otherOutward = ((other.axisPose.headingDeg + 180) * Math.PI) / 180;
      let delta = Math.abs(outward - otherOutward) % (2 * Math.PI);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      const sinDelta = Math.sin(delta);
      // Near-collinear arms are the same corridor continuing under another
      // road id; the crossing legitimately spans them like it spans its own
      // opposing lanes.
      if (sinDelta < 0.342) continue;
      requiredM = Math.max(
        requiredM,
        (other.surface.widthM / 2 +
          CROSSING_CLEAR_M +
          CROSSING_ENVELOPE_HALF_M * sinDelta +
          (CROSSING_SPAN_FACTOR / 2) *
            arm.surface.widthM *
            Math.abs(Math.cos(delta))) /
          sinDelta,
      );
    }
    // Beyond ~28 m the "crossing" is halfway down the block; and it must fit
    // on the lane at all.
    const fits = requiredM <= 28 && laneLength(arm.lane) - requiredM >= 3;
    const pose = pointAlongLane(
      arm.lane,
      Math.max(3, laneLength(arm.lane) - requiredM),
    );
    return { requiredM, fits, pose };
  });
  // Belt and braces: two surviving crossings may still meet in the wedge
  // between acute arms. Drop the later (stable sorted order) of any pair
  // whose stripe envelopes intersect.
  for (let a = 0; a < arms.length; a += 1) {
    if (!armCrossings[a].fits) continue;
    for (let b = a + 1; b < arms.length; b += 1) {
      if (!armCrossings[b].fits) continue;
      const rect = (index: number) => {
        const crossing = armCrossings[index];
        const heading = (crossing.pose.headingDeg * Math.PI) / 180;
        return {
          x: crossing.pose.position.x,
          z: crossing.pose.position.z,
          // Lane/pose heading: 0 = +z, so the travel axis is (sin h, cos h)
          // and the across-traffic axis is the right-hand normal.
          axes: [
            {
              x: Math.sin(heading),
              z: Math.cos(heading),
              half: CROSSING_ENVELOPE_HALF_M,
            },
            {
              x: Math.cos(heading),
              z: -Math.sin(heading),
              half: (CROSSING_SPAN_FACTOR / 2) * arms[index].surface.widthM,
            },
          ],
        };
      };
      const first = rect(a);
      const second = rect(b);
      const separated = [...first.axes, ...second.axes].some((axis) => {
        const spread = (r: typeof first) =>
          r.axes[0].half * Math.abs(r.axes[0].x * axis.x + r.axes[0].z * axis.z) +
          r.axes[1].half * Math.abs(r.axes[1].x * axis.x + r.axes[1].z * axis.z);
        return (
          Math.abs(
            (second.x - first.x) * axis.x + (second.z - first.z) * axis.z,
          ) >
          spread(first) + spread(second)
        );
      });
      if (!separated) armCrossings[b] = { ...armCrossings[b], fits: false };
    }
  }

  for (const [index, arm] of arms.entries()) {
    const { lanes, lane, surface, axisPose } = arm;
    const roadId = lane.roadId;
    const armSlug = `${roadId}-${lane.from.replace(/^cairo-/, "")}`;
    const crossing = armCrossings[index];
    // The bar stays behind the stripes (real junctions do exactly this), and
    // never nearer the node than the old 12 m where the crossing needs room.
    const stopFromNodeM = crossing.fits
      ? Math.max(12, crossing.requiredM + CROSSING_ENVELOPE_HALF_M + 0.9)
      : 12;
    const stopDistance = Math.max(8, laneLength(lane) - stopFromNodeM);
    const stopPose = pointAlongLane(lane, stopDistance);
    const approachId = `cairo-signal-${signalIndex + 1}-${armSlug}-approach`;
    approaches.push({
      id: approachId,
      laneIds: lanes.map((item) => item.id),
      stopLine: anchor(lane.id, stopDistance),
      conflictZoneIds: [zoneId],
      // Opposing arms of one street still run together, so the phase group
      // stays keyed by road: splitting the approaches must not split the cycle.
      phaseGroup: `cairo-signal-${signalIndex + 1}-${roadId}`,
    });
    installations.push({
      id: `cairo-signal-${signalIndex + 1}-${armSlug}-head`,
      // Positioned from the stop line, oriented by the de-blended road axis:
      // the last few metres of a lane elbow onto the shared node, so sampling
      // the heading at the bar itself skews the head a few degrees.
      position: safeSignalPosition(
        stopPose.position,
        axisPose.headingDeg,
        surface,
      ),
      headingDeg: axisPose.headingDeg,
      mounting: "roadside_pole",
      style: "egypt_signal",
      role: "primary",
      approachIds: [approachId],
    });
    if (!crossing.fits) continue;
    installations.push({
      id: `cairo-signal-${signalIndex + 1}-${armSlug}-crosswalk`,
      position: crossing.pose.position,
      headingDeg: crossing.pose.headingDeg,
      spanM: surface.widthM,
      mounting: "road_marking",
      style: "crosswalk",
      role: "marking",
      approachIds: [approachId],
    });
  }

  cairoControls.push({
    id: `cairo-signal-${signalIndex + 1}`,
    type: "signal",
    position: center,
    headingDeg: 0,
    laneIds: inbound.map((lane) => lane.id),
    conflictZoneIds: [zoneId],
    approaches,
    installations,
  });
  cairoConflictZones.push({
    id: zoneId,
    laneIds: [
      ...new Set(
        cairoLanes
          .filter((lane) => lane.from === nodeId || lane.to === nodeId)
          .map((lane) => lane.id),
      ),
    ],
    polygon: [
      point(center.x - 8, center.z - 8),
      point(center.x + 8, center.z - 8),
      point(center.x + 8, center.z + 8),
      point(center.x - 8, center.z + 8),
    ],
  });
}

const block = (
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  headingDeg: number,
  material: string,
  heightRange: readonly [number, number],
  density: number,
): ProceduralBlock => ({
  id,
  center: point(x, z),
  size: point(width, depth),
  headingDeg,
  material,
  heightRange,
  density,
});

const CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE = {
  center: point(-15, 250),
  lengthM: 1500,
  widthM: 14,
  headingDeg: 96,
} as const;
const CAIRO_WORLD_SIZE = point(1770, 1830);
const CAIRO_NILE_WEST_POLYGON: readonly WorldPoint[] = [
  point(-592, -915),
  point(-479, -915),
  point(-463, -610),
  point(-475, -300),
  point(-457, 20),
  point(-473, 330),
  point(-455, 620),
  point(-471, 915),
  point(-584, 915),
  point(-570, 610),
  point(-588, 300),
  point(-572, -20),
  point(-590, -330),
  point(-574, -620),
];
const CAIRO_NILE_EAST_POLYGON: readonly WorldPoint[] = [
  point(-92, -915),
  point(38, -915),
  point(48, -610),
  point(36, -300),
  point(50, 20),
  point(38, 330),
  point(52, 620),
  point(40, 915),
  point(-88, 915),
  point(-72, 610),
  point(-90, 300),
  point(-74, -20),
  point(-94, -330),
  point(-76, -620),
];
const SCENIC_BRIDGE_BLOCK_MARGIN_M = 1;

interface OrientedParcel {
  readonly center: WorldPoint;
  readonly axisU: WorldPoint;
  readonly axisV: WorldPoint;
  readonly halfU: number;
  readonly halfV: number;
}

const orientedParcel = (
  center: WorldPoint,
  size: WorldPoint,
  yawDeg: number,
): OrientedParcel => {
  const yaw = (yawDeg * Math.PI) / 180;
  return {
    center,
    axisU: point(Math.cos(yaw), -Math.sin(yaw)),
    axisV: point(Math.sin(yaw), Math.cos(yaw)),
    halfU: size.x / 2,
    halfV: size.z / 2,
  };
};

const orientedParcelsOverlap = (
  first: OrientedParcel,
  second: OrientedParcel,
): boolean => {
  const offset = point(
    second.center.x - first.center.x,
    second.center.z - first.center.z,
  );
  const dot = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.x + left.z * right.z;
  return [first.axisU, first.axisV, second.axisU, second.axisV].every(
    (axis) => {
      const separation = Math.abs(dot(offset, axis));
      const firstRadius =
        first.halfU * Math.abs(dot(first.axisU, axis)) +
        first.halfV * Math.abs(dot(first.axisV, axis));
      const secondRadius =
        second.halfU * Math.abs(dot(second.axisU, axis)) +
        second.halfV * Math.abs(dot(second.axisV, axis));
      return separation <= firstRadius + secondRadius;
    },
  );
};

/**
 * Closest point of an oriented parcel to `target`, by clamping in the parcel's
 * own frame. Used to decide which side of a road an exclusion's body lies on —
 * centres are useless for that once the shape is long (the scenic deck's
 * centre sits 200+ m from most of the roads it crosses).
 */
const nearestPointOnOrientedParcel = (
  parcel: OrientedParcel,
  target: WorldPoint,
): WorldPoint => {
  const dx = target.x - parcel.center.x;
  const dz = target.z - parcel.center.z;
  const u = Math.max(
    -parcel.halfU,
    Math.min(parcel.halfU, dx * parcel.axisU.x + dz * parcel.axisU.z),
  );
  const v = Math.max(
    -parcel.halfV,
    Math.min(parcel.halfV, dx * parcel.axisV.x + dz * parcel.axisV.z),
  );
  return point(
    parcel.center.x + parcel.axisU.x * u + parcel.axisV.x * v,
    parcel.center.z + parcel.axisU.z * u + parcel.axisV.z * v,
  );
};

/** Sutherland–Hodgman clip of a convex polygon to an oriented parcel's four
 * halfplanes. Returns [] when nothing survives. */
const clipToOrientedParcel = (
  corners: readonly WorldPoint[],
  parcel: OrientedParcel,
): WorldPoint[] => {
  let output: WorldPoint[] = [...corners];
  for (const plane of [
    { x: parcel.axisU.x, z: parcel.axisU.z, limit: parcel.halfU },
    { x: -parcel.axisU.x, z: -parcel.axisU.z, limit: parcel.halfU },
    { x: parcel.axisV.x, z: parcel.axisV.z, limit: parcel.halfV },
    { x: -parcel.axisV.x, z: -parcel.axisV.z, limit: parcel.halfV },
  ]) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentDepth =
        (current.x - parcel.center.x) * plane.x +
        (current.z - parcel.center.z) * plane.z -
        plane.limit;
      const previousDepth =
        (previous.x - parcel.center.x) * plane.x +
        (previous.z - parcel.center.z) * plane.z -
        plane.limit;
      const currentInside = currentDepth <= 0;
      if (currentInside !== previousDepth <= 0) {
        const t = previousDepth / (previousDepth - currentDepth);
        output.push(
          point(
            previous.x + (current.x - previous.x) * t,
            previous.z + (current.z - previous.z) * t,
          ),
        );
      }
      if (currentInside) output.push(current);
    }
    if (output.length === 0) return output;
  }
  return output;
};

const sixthOctoberCorridor = orientedParcel(
  CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.center,
  point(
    CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.lengthM,
    CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.widthM +
      SCENIC_BRIDGE_BLOCK_MARGIN_M * 2,
  ),
  // The landmark heading is a compass bearing along its long axis; block
  // headings are Babylon yaw for local +x.
  CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.headingDeg - 90,
);

const cairoBlocks: ProceduralBlock[] = [];

/**
 * Reject a procedural parcel when its rotated footprint reaches any authored
 * road or pavement envelope. This makes rotated-block clearance a deterministic
 * consequence of the same road specification that creates lanes and surfaces,
 * instead of relying on a fragile list of hand-tuned parcel exceptions.
 */
const addRoadClearBlock = (candidate: ProceduralBlock): boolean => {
  const yaw = ((candidate.headingDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const halfX = candidate.size.x / 2;
  const halfZ = candidate.size.z / 2;
  const overlapsRoadEnvelope = cairoRoadSurfaces.some((surface) => {
    const clearance =
      surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + 0.75;
    for (let index = 1; index < surface.centerline.length; index += 1) {
      const start = surface.centerline[index - 1];
      const end = surface.centerline[index];
      const segmentLength = Math.hypot(end.x - start.x, end.z - start.z);
      const steps = Math.max(1, Math.ceil(segmentLength / 2));
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const dx = start.x + (end.x - start.x) * amount - candidate.center.x;
        const dz = start.z + (end.z - start.z) * amount - candidate.center.z;
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        if (
          Math.abs(localX) <= halfX + clearance &&
          Math.abs(localZ) <= halfZ + clearance
        ) {
          return true;
        }
      }
    }
    return false;
  });
  const overlapsSixthOctober = orientedParcelsOverlap(
    orientedParcel(
      candidate.center,
      candidate.size,
      candidate.headingDeg ?? 0,
    ),
    sixthOctoberCorridor,
  );
  if (!overlapsRoadEnvelope && !overlapsSixthOctober) {
    cairoBlocks.push(candidate);
    return true;
  }
  return false;
};
const eastParcelBands = [
  { z: -770, depth: 110, heading: -8 },
  { z: -590, depth: 105, heading: 6 },
  { z: -410, depth: 105, heading: -7 },
  { z: -210, depth: 100, heading: 11 },
  { z: 35, depth: 100, heading: -12 },
  { z: 235, depth: 105, heading: 8 },
  { z: 470, depth: 120, heading: -6 },
  { z: 720, depth: 125, heading: 9 },
] as const;
const eastParcelColumns = [
  { x: 160, width: 50 },
  { x: 350, width: 58 },
  { x: 500, width: 40 },
  { x: 650, width: 44 },
] as const;
for (const [bandIndex, band] of eastParcelBands.entries()) {
  for (const [columnIndex, column] of eastParcelColumns.entries()) {
    // Preserve Tahrir's broad radial clearing instead of filling its centre
    // with a procedural block.
    if (
      (bandIndex === 3 || bandIndex === 4) &&
      (columnIndex === 0 || columnIndex === 1)
    ) {
      continue;
    }
    // The two easternmost corridors carry the oblique Ramsis/Galaa fabric;
    // parcels there are hand-placed landmarks and venues rather than generic
    // blocks so their rotated OBBs can never intrude on those diagonals.
    if (columnIndex >= 2) continue;
    if (bandIndex === 5 && columnIndex === 1) continue;
    if ((bandIndex === 6 || bandIndex === 7) && columnIndex === 1) continue;
    addRoadClearBlock(
      block(
        `cairo-east-block-${bandIndex + 1}-${columnIndex + 1}`,
        column.x + (bandIndex % 2 === 0 ? -5 : 7),
        band.z,
        column.width,
        band.depth,
        band.heading + columnIndex * 1.5,
        bandIndex <= 2
          ? "cairo-garden-stucco"
          : "cairo-khedivial-stone",
        bandIndex <= 2 ? [10, 25] : [18, 42],
        bandIndex <= 2 ? 0.66 : 0.82,
      ),
    );
  }
}

const islandParcelBands = [
  { z: -735, depth: 125, heading: -6 },
  { z: -510, depth: 125, heading: 8 },
  { z: -285, depth: 120, heading: -9 },
  { z: -45, depth: 125, heading: 7 },
  { z: 205, depth: 130, heading: -8 },
  { z: 455, depth: 130, heading: 9 },
  { z: 710, depth: 135, heading: -7 },
] as const;
const islandParcelColumns = [
  { x: -387, width: 34 },
  { x: -280, width: 48 },
  { x: -160, width: 48 },
] as const;
for (const [bandIndex, band] of islandParcelBands.entries()) {
  for (const [columnIndex, column] of islandParcelColumns.entries()) {
    addRoadClearBlock(
      block(
        `cairo-island-block-${bandIndex + 1}-${columnIndex + 1}`,
        column.x + (bandIndex % 3 - 1) * 4,
        band.z,
        column.width,
        band.depth,
        band.heading + columnIndex * 2,
        "cairo-gezira-cream",
        [12, 32],
        0.65,
      ),
    );
  }
}

for (const [index, parcel] of [
  { z: -735, depth: 130, heading: 6 },
  { z: -505, depth: 130, heading: -7 },
  { z: -275, depth: 125, heading: 9 },
  { z: -30, depth: 125, heading: -8 },
  { z: 205, depth: 125, heading: 7 },
  { z: 450, depth: 130, heading: -6 },
  { z: 710, depth: 135, heading: 8 },
].entries()) {
  addRoadClearBlock(
    block(
      `cairo-west-block-${index + 1}`,
      -720 + (index % 2 === 0 ? -4 : 5),
      parcel.z,
      108,
      parcel.depth,
      parcel.heading,
      "cairo-west-bank-concrete",
      [16, 38],
      0.78,
    ),
  );
}

// One deliberate parcel where the roadside generator cannot go: Tahrir's 18 m
// exclusion blanks Ramses' north-west frontage beside the park, which is
// exactly the frontage that closes the square's north-east corner — without
// it the ministries slab ends and the horizon leaks back in over the gap.
// Khedivial street wall facing the park (south), depth 14.5 = the
// cairo-downtown set's 13 m plus the roadside convention's 1.5; its east end
// keeps ~0.9 m past Ramses' block envelope, which the horizon test pins.
addRoadClearBlock({
  id: "cairo-tahrir-frontage-block",
  center: point(391, 28),
  size: point(32, 14.5),
  headingDeg: 0,
  frontageAxis: "z",
  streetEdges: ["-z"],
  material: "cairo-khedivial-stone",
  heightRange: [20, 46],
  density: 0.82,
  buildingSet: "cairo-downtown",
});

const cairoWaterBodies: readonly WaterBody[] = [
  {
    id: "cairo-nile-west-channel",
    polygon: CAIRO_NILE_WEST_POLYGON,
    color: "#2f7f91",
    flowHeadingDeg: 180,
    bridgePortalSurfaceIds: ["cairo-al-galaa-bridge"],
  },
  {
    id: "cairo-nile-east-channel",
    polygon: CAIRO_NILE_EAST_POLYGON,
    color: "#2d8295",
    flowHeadingDeg: 180,
    bridgePortalSurfaceIds: ["cairo-qasr-el-nil-bridge"],
  },
];

const cairoLandmarks: readonly ProceduralLandmark[] = [
  {
    id: "cairo-tower",
    kind: "tower",
    center: point(-305, -18),
    size: point(24, 24),
    color: "#d8c9ad",
  },
  {
    id: "cairo-egyptian-museum",
    kind: "museum",
    center: point(185, -210),
    size: point(50, 64),
    color: "#c88777",
  },
  {
    id: "cairo-tahrir-obelisk",
    kind: "monument",
    // This point doubles as the centre of Tahrir's paved plaza: the renderer
    // rings its disc, benches and olives around the obelisk landmark, so
    // moving it moves the whole ensemble. It sits where the full olive ring
    // clears the pavement bands of both Ramses and Qasr El-Ainy —
    // `tests/cairoVisuals.test.ts` pins those clearances.
    center: point(348, -27),
    size: point(14, 14),
    color: "#c9a96f",
  },
  {
    id: "cairo-tahrir-ministries",
    kind: "cultural",
    // Closes the horizon due north of the obelisk. The east-bank district
    // grid deliberately skips the wedge between Qasr El-Ainy and Ramses, so
    // the view past the park ran 215 m to the scenic Sixth October deck and
    // stopped at sky. A Mogamma-like government slab on the obelisk's axis:
    // wide enough to occlude the whole empty sector from ground level, its
    // west edge clear of Qasr El-Ainy's block envelope and its east corner
    // clear of Ramses'. Rendered bespoke in `buildCairoLandmark`.
    center: point(350, 30),
    size: point(44, 22),
    color: "#c9b18f",
  },
  {
    id: "cairo-opera-house",
    kind: "cultural",
    center: point(-275, -315),
    size: point(32, 58),
    color: "#e4dbc7",
  },
  {
    id: "cairo-qasr-el-nil-bridge",
    kind: "bridge",
    center: point(-9, -137.5),
    size: point(Math.hypot(202, 45), 15),
    headingDeg: (Math.atan2(202, 45) * 180) / Math.PI,
    color: "#c4aa77",
  },
  {
    id: "cairo-al-galaa-bridge",
    kind: "bridge",
    center: point(-519, 325),
    size: point(182, 15),
    headingDeg: 90,
    color: "#bba36f",
  },
  {
    id: "cairo-sixth-october-bridge",
    kind: "bridge",
    center: CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.center,
    size: point(
      CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.lengthM,
      CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.widthM,
    ),
    headingDeg: CAIRO_SIXTH_OCTOBER_SCENIC_BRIDGE.headingDeg,
    color: "#aaa392",
  },
  {
    id: "cairo-sixth-october-west-ramp-stub",
    kind: "bridge",
    center: point(-835, 337),
    size: point(150, 12),
    headingDeg: 96,
    color: "#aaa392",
  },
  {
    id: "cairo-sixth-october-east-ramp-stub",
    kind: "bridge",
    center: point(805, 163),
    size: point(150, 12),
    headingDeg: 96,
    color: "#aaa392",
  },
  {
    id: "cairo-tahrir-square",
    kind: "park",
    // The rect is the park's LOGICAL envelope — scatter, exclusions and prop
    // keep-outs all read it. The lawn the player sees is bigger and smaller
    // at once: `cairoTahrirLawnPolygon` tucks its west and south edges out
    // under the flanking pavement bands (Cairo's base ground is paved grey,
    // so a gap between lawn and band reads as a bare strip) and cuts it back
    // to the near side of Ramses, which is authored straight through here.
    // Growing the rect itself instead would drag the 18 m roadside exclusion
    // across Qasr El-Ainy and demolish the street wall facing the park.
    center: point(360, -35),
    size: point(62, 82),
    color: "#6e8a54",
  },
  {
    id: "cairo-opera-grounds",
    kind: "park",
    center: point(-270, -250),
    size: point(50, 96),
    color: "#678258",
  },
];

const lanesForAnchors = cairoLanes.filter(
  (lane) => lane.id.includes("-forward-") && laneLength(lane) > 80,
);
const safeDistance = (lane: LaneSegment, ratio = 0.5): number =>
  Math.max(14, Math.min(laneLength(lane) - 14, laneLength(lane) * ratio));

const cairoServicePoints: readonly ServicePoint[] = [
  {
    id: "cairo-gas-garden-city",
    kind: "gas_station",
    anchor: anchor(
      "cairo-qasr-el-ainy-1-forward-1",
      safeDistance(cairoLaneById.get("cairo-qasr-el-ainy-1-forward-1")!, 0.52),
    ),
    footprint: point(12, 8),
    label: "Garden City Fuel",
    setbackM: 18.8,
  },
  {
    id: "cairo-gas-west-bank",
    kind: "gas_station",
    anchor: anchor(
      "cairo-west-nile-street-4-forward-1",
      safeDistance(cairoLaneById.get("cairo-west-nile-street-4-forward-1")!, 0.48),
    ),
    footprint: point(12, 8),
    label: "Nile Bank Fuel",
    setbackM: 18.8,
  },
  {
    id: "cairo-repair-downtown",
    kind: "repair_shop",
    anchor: anchor(
      "cairo-galaa-street-2-forward-1",
      safeDistance(cairoLaneById.get("cairo-galaa-street-2-forward-1")!, 0.55),
    ),
    footprint: point(10, 8),
    label: "Downtown Motors",
    setbackM: 11.4,
  },
  {
    id: "cairo-repair-dokki",
    kind: "repair_shop",
    anchor: anchor(
      "cairo-dokki-nile-drive-2-forward-1",
      safeDistance(cairoLaneById.get("cairo-dokki-nile-drive-2-forward-1")!, 0.45),
    ),
    footprint: point(10, 8),
    label: "Dokki Auto Works",
    setbackM: 11.35,
  },
];

const venueKinds = [
  "restaurant",
  "shop",
  "residence",
  "office",
  "depot",
] as const;
const CAIRO_RESIDENCE_MODEL_IDS = [
  "cairo-residence-kay",
  "cairo-residence-quaternius",
] as const;
const venueNames = [
  "Garden City Kitchen",
  "Nile Books",
  "Tahrir Residences",
  "Downtown Exchange",
  "Gezira Dispatch",
  "Opera Terrace",
  "Zamalek Grocers",
  "Corniche Apartments",
  "Dokki Business Centre",
  "Ramses Depot",
  "Lotus Cafe",
  "Champollion Market",
  "Museum View Flats",
  "Bolivar Offices",
  "Nile Courier Hub",
  "Saray Bistro",
  "Gabalaya Corner Shop",
  "Opera Gardens Homes",
  "Agouza Workspace",
  "West Bank Depot",
  "Tahrir Bakery",
  "Garden City Supplies",
  "Gezira Court",
  "Qasr El-Nil Offices",
  "Cairo Dispatch Yard",
  "Nile Terrace Cafe",
  "Dokki Mini Market",
  "Zamalek Residences",
  "Corniche Trade House",
  "Central Cairo Depot",
] as const;

const venueLaneOverrides: Readonly<Partial<Record<number, string>>> = {
  // Keep the Dokki office parcel on the west bank, away from Tahrir's fan.
  8: "cairo-west-nile-street-6-forward-1",
  // Keep this residence away from the Garden City fuel forecourt.
  17: "cairo-el-gabalaya-6-forward-1",
  // Keep the depot clear of the converging Tahrir/Qasr El-Nil approaches.
  24: "cairo-west-nile-street-2-forward-1",
};

const cairoGigVenues: readonly GigVenue[] = venueNames.map((name, index) => {
  const lane =
    cairoLaneById.get(venueLaneOverrides[index] ?? "") ??
    lanesForAnchors[(index * 7 + 3) % lanesForAnchors.length];
  const kind = venueKinds[index % venueKinds.length];
  // Offices and depots used to share `office.glb` — Quaternius's "Big Building",
  // whose hipped roof is a European shape Cairo does not have, placed 12 times
  // across the map. Both now get their own flat-roofed block. `office.glb`
  // itself still serves NYC and London.
  const modelId =
    kind === "residence"
      ? CAIRO_RESIDENCE_MODEL_IDS[
          Math.floor(index / venueKinds.length) %
            CAIRO_RESIDENCE_MODEL_IDS.length
        ]
      : kind === "depot"
        ? "cairo-depot"
        : kind === "office"
          ? "cairo-office-block"
          : kind === "shop"
            ? "cairo-shop"
            : undefined;
  return {
    id: `cairo-venue-${String(index + 1).padStart(2, "0")}`,
    kind,
    anchor: anchor(lane.id, safeDistance(lane, 0.3 + (index % 5) * 0.1)),
    footprint: point(index % 2 === 0 ? 14 : 12, index % 3 === 0 ? 12 : 10),
    name,
    setbackM: 15,
    ...(modelId ? { modelId } : {}),
  };
});

/**
 * Thin street-wall parcels fill only the land a driver can see from the
 * authored roads. Cairo's earlier district blocks establish broad massing, but
 * they cover too little of the large map to read as central-city fabric from a
 * car. These strips follow each non-bridge road segment, on both sides where
 * space exists, and are rejected against every road, river, landmark, POI and
 * previously accepted parcel.
 */
const parcelSamplePoints = (parcel: OrientedParcel): readonly WorldPoint[] => {
  const at = (u: number, v: number): WorldPoint =>
    point(
      parcel.center.x +
        parcel.axisU.x * parcel.halfU * u +
        parcel.axisV.x * parcel.halfV * v,
      parcel.center.z +
        parcel.axisU.z * parcel.halfU * u +
        parcel.axisV.z * parcel.halfV * v,
    );
  return [
    parcel.center,
    at(-1, -1),
    at(-1, 0),
    at(-1, 1),
    at(0, -1),
    at(0, 1),
    at(1, -1),
    at(1, 0),
    at(1, 1),
  ];
};

const pointInPolygon = (
  candidate: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    const crosses =
      left.z > candidate.z !== right.z > candidate.z &&
      candidate.x <
        ((right.x - left.x) * (candidate.z - left.z)) /
          (right.z - left.z) +
          left.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const parcelCorners = (parcel: OrientedParcel): readonly WorldPoint[] => {
  const at = (u: -1 | 1, v: -1 | 1): WorldPoint =>
    point(
      parcel.center.x +
        parcel.axisU.x * parcel.halfU * u +
        parcel.axisV.x * parcel.halfV * v,
      parcel.center.z +
        parcel.axisU.z * parcel.halfU * u +
        parcel.axisV.z * parcel.halfV * v,
    );
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
};

const pointInParcel = (
  candidate: WorldPoint,
  parcel: OrientedParcel,
): boolean => {
  const dx = candidate.x - parcel.center.x;
  const dz = candidate.z - parcel.center.z;
  const localU = dx * parcel.axisU.x + dz * parcel.axisU.z;
  const localV = dx * parcel.axisV.x + dz * parcel.axisV.z;
  return (
    Math.abs(localU) <= parcel.halfU + 1e-7 &&
    Math.abs(localV) <= parcel.halfV + 1e-7
  );
};

const segmentsIntersect = (
  firstStart: WorldPoint,
  firstEnd: WorldPoint,
  secondStart: WorldPoint,
  secondEnd: WorldPoint,
): boolean => {
  const cross = (
    start: WorldPoint,
    end: WorldPoint,
    candidate: WorldPoint,
  ): number =>
    (end.x - start.x) * (candidate.z - start.z) -
    (end.z - start.z) * (candidate.x - start.x);
  const onSegment = (
    start: WorldPoint,
    end: WorldPoint,
    candidate: WorldPoint,
  ): boolean =>
    candidate.x >= Math.min(start.x, end.x) - 1e-7 &&
    candidate.x <= Math.max(start.x, end.x) + 1e-7 &&
    candidate.z >= Math.min(start.z, end.z) - 1e-7 &&
    candidate.z <= Math.max(start.z, end.z) + 1e-7;
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  if (
    ((firstA > 1e-7 && firstB < -1e-7) ||
      (firstA < -1e-7 && firstB > 1e-7)) &&
    ((secondA > 1e-7 && secondB < -1e-7) ||
      (secondA < -1e-7 && secondB > 1e-7))
  ) {
    return true;
  }
  return (
    (Math.abs(firstA) <= 1e-7 &&
      onSegment(firstStart, firstEnd, secondStart)) ||
    (Math.abs(firstB) <= 1e-7 &&
      onSegment(firstStart, firstEnd, secondEnd)) ||
    (Math.abs(secondA) <= 1e-7 &&
      onSegment(secondStart, secondEnd, firstStart)) ||
    (Math.abs(secondB) <= 1e-7 &&
      onSegment(secondStart, secondEnd, firstEnd))
  );
};

const parcelIntersectsPolygon = (
  parcel: OrientedParcel,
  polygon: readonly WorldPoint[],
): boolean => {
  const corners = parcelCorners(parcel);
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((vertex) => pointInParcel(vertex, parcel))) return true;
  for (let edge = 0; edge < corners.length; edge += 1) {
    const rectangleStart = corners[edge];
    const rectangleEnd = corners[(edge + 1) % corners.length];
    for (let polygonEdge = 0; polygonEdge < polygon.length; polygonEdge += 1) {
      if (
        segmentsIntersect(
          rectangleStart,
          rectangleEnd,
          polygon[polygonEdge],
          polygon[(polygonEdge + 1) % polygon.length],
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const roadsideExclusionParcel = (
  center: WorldPoint,
  size: WorldPoint,
  headingDeg = 0,
  marginM = 0,
): OrientedParcel =>
  orientedParcel(
    center,
    point(size.x + marginM * 2, size.z + marginM * 2),
    headingDeg,
  );

/**
 * A roadside parcel keeps clear of authored content — but only content that
 * shares its side of the street. The inflated margins below are breathing room
 * for a frontage approaching a landmark, not a moat around it: when the
 * exclusion's body sits across the carriageway, the road itself is the
 * separation and the margin vetoes nothing. Before the side rule, the opera
 * park's 18 m envelope reached over Montazah Al Gezira Street and erased the
 * OPPOSITE kerb for ~175 m, and every venue blanked ~40 m of the far side of
 * its own street — the driver faced bare ground exactly where a wall of
 * buildings should have faced the park. `raw` is the physical footprint
 * (landmark rect, service forecourt, venue lot); touching it refuses the
 * parcel regardless of side.
 */
interface RoadsideExclusion {
  readonly raw: OrientedParcel;
  readonly inflated: OrientedParcel;
}

/**
 * A road-divided park's rect straddles its street, but everything the park
 * renders — lawn, walls, planting — is clipped to the side its centre is on
 * (`roadSideParkLawnPolygon`). The rect strip on the far side is bare
 * carved-off ground, and across the street from a park is exactly where a city
 * builds, so the exclusion must not claim it. Shrink the rect at each crossing
 * segment to the centre's side; the same-side inflated margin still guards the
 * approximation's lost wedge.
 */
const dividedParkExclusionRect = (
  landmark: ProceduralLandmark,
): { readonly center: WorldPoint; readonly size: WorldPoint } => {
  let minX = landmark.center.x - landmark.size.x / 2;
  let maxX = landmark.center.x + landmark.size.x / 2;
  let minZ = landmark.center.z - landmark.size.z / 2;
  let maxZ = landmark.center.z + landmark.size.z / 2;
  for (const surface of cairoRoadSurfaces) {
    for (let index = 1; index < surface.centerline.length; index += 1) {
      const from = surface.centerline[index - 1];
      const to = surface.centerline[index];
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      if (length < 1e-6) continue;
      const inside: WorldPoint[] = [];
      const steps = Math.max(2, Math.ceil(length / 4));
      for (let step = 0; step <= steps; step += 1) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const z = from.z + ((to.z - from.z) * step) / steps;
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
          inside.push(point(x, z));
        }
      }
      if (inside.length < 2) continue;
      const xs = inside.map((sample) => sample.x);
      const zs = inside.map((sample) => sample.z);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanZ = Math.max(...zs) - Math.min(...zs);
      if (spanZ >= spanX) {
        if (landmark.center.x <= Math.min(...xs)) {
          maxX = Math.min(maxX, Math.min(...xs));
        } else if (landmark.center.x >= Math.max(...xs)) {
          minX = Math.max(minX, Math.max(...xs));
        }
      } else if (landmark.center.z <= Math.min(...zs)) {
        maxZ = Math.min(maxZ, Math.min(...zs));
      } else if (landmark.center.z >= Math.max(...zs)) {
        minZ = Math.max(minZ, Math.max(...zs));
      }
    }
  }
  return {
    center: point((minX + maxX) / 2, (minZ + maxZ) / 2),
    size: point(Math.max(0, maxX - minX), Math.max(0, maxZ - minZ)),
  };
};

const cairoRoadsideExclusions: readonly RoadsideExclusion[] = [
  ...cairoLandmarks.map((landmark) => {
    const heading =
      landmark.headingDeg === undefined ? 0 : landmark.headingDeg - 90;
    const rect =
      landmark.kind === "park" && ROAD_DIVIDED_PARK_IDS.has(landmark.id)
        ? dividedParkExclusionRect(landmark)
        : { center: landmark.center, size: landmark.size };
    return {
      raw: roadsideExclusionParcel(rect.center, rect.size, heading, 0),
      inflated: roadsideExclusionParcel(
        rect.center,
        rect.size,
        heading,
        // Bridges get no margin: their decks are elevated, the scenic deck has
        // its own ground guard (sixthOctoberCorridor, checked with every other
        // road envelope in addRoadClearBlock), and drivable bridges are also
        // RoadSurfaces whose envelopes addRoadClearBlock enforces. The old
        // 4 m margin on the 1500 m scenic deck blanked a band across every
        // road it crossed — real Cairo builds hard against its flyovers.
        landmark.kind === "park" ? 18 : landmark.kind === "bridge" ? 0 : 12,
      ),
    };
  }),
  ...cairoServicePoints.flatMap((service) => {
    const lane = cairoLaneById.get(service.anchor.laneId);
    if (!lane) return [];
    const pose = pointAlongLane(lane, service.anchor.distanceAlongM);
    const heading = (pose.headingDeg * Math.PI) / 180;
    const setback = service.setbackM ?? 16;
    const center = point(
      pose.position.x + Math.cos(heading) * setback,
      pose.position.z - Math.sin(heading) * setback,
    );
    const lotSpan = Math.max(service.footprint.x, service.footprint.z) + 8;
    const span =
      Math.max(service.footprint.x, service.footprint.z) +
      (service.kind === "gas_station" ? 42 : 28);
    return [
      {
        raw: roadsideExclusionParcel(center, point(lotSpan, lotSpan)),
        inflated: roadsideExclusionParcel(center, point(span, span)),
      },
    ];
  }),
  ...cairoGigVenues.flatMap((venue) => {
    const lane = cairoLaneById.get(venue.anchor.laneId);
    if (!lane) return [];
    const pose = pointAlongLane(lane, venue.anchor.distanceAlongM);
    const heading = (pose.headingDeg * Math.PI) / 180;
    const setback = venue.setbackM ?? 13;
    const center = point(
      pose.position.x + Math.cos(heading) * setback,
      pose.position.z - Math.sin(heading) * setback,
    );
    const lotSpan = Math.max(venue.footprint.x, venue.footprint.z) + 4;
    const span = Math.max(venue.footprint.x, venue.footprint.z) + 30;
    return [
      {
        raw: roadsideExclusionParcel(center, point(lotSpan, lotSpan)),
        inflated: roadsideExclusionParcel(center, point(span, span)),
      },
    ];
  }),
];

/** Which side of its road a candidate parcel fronts: a point on the road's
 * centreline at the parcel's own station, and the unit normal toward the
 * parcel. Lets the exclusion check ignore margins whose body is across the
 * carriageway. */
interface RoadsideSideContext {
  readonly origin: WorldPoint;
  readonly outX: number;
  readonly outZ: number;
}

const addCairoRoadsideBlock = (
  candidate: ProceduralBlock,
  sideContext?: RoadsideSideContext,
): boolean => {
  const parcel = orientedParcel(
    candidate.center,
    candidate.size,
    candidate.headingDeg ?? 0,
  );
  const samples = parcelSamplePoints(parcel);
  const halfWorldX = CAIRO_WORLD_SIZE.x / 2 - 4;
  const halfWorldZ = CAIRO_WORLD_SIZE.z / 2 - 4;
  if (
    samples.some(
      (sample) =>
        Math.abs(sample.x) > halfWorldX || Math.abs(sample.z) > halfWorldZ,
    )
  ) {
    return false;
  }
  if (
    parcelIntersectsPolygon(parcel, CAIRO_NILE_WEST_POLYGON) ||
    parcelIntersectsPolygon(parcel, CAIRO_NILE_EAST_POLYGON)
  ) {
    return false;
  }
  if (
    cairoRoadsideExclusions.some((exclusion) => {
      if (!orientedParcelsOverlap(parcel, exclusion.inflated)) return false;
      if (orientedParcelsOverlap(parcel, exclusion.raw)) return true;
      if (!sideContext) return true;
      // Margin-only contact: honour it only when the exclusion's body reaches
      // meaningfully past the centreline toward this parcel. A body across the
      // road — or grazing the carriageway itself — is separated by the road;
      // the raw-overlap check above still refuses genuine contact.
      const nearest = nearestPointOnOrientedParcel(
        exclusion.raw,
        candidate.center,
      );
      return (
        (nearest.x - sideContext.origin.x) * sideContext.outX +
          (nearest.z - sideContext.origin.z) * sideContext.outZ >
        1.5
      );
    })
  ) {
    return false;
  }
  const parcelWithGap = orientedParcel(
    candidate.center,
    point(candidate.size.x + 2, candidate.size.z + 2),
    candidate.headingDeg ?? 0,
  );
  if (
    cairoBlocks.some((existing) =>
      orientedParcelsOverlap(
        parcelWithGap,
        orientedParcel(
          existing.center,
          existing.size,
          existing.headingDeg ?? 0,
        ),
      ),
    )
  ) {
    return false;
  }
  return addRoadClearBlock(candidate);
};

/** Depth of a parcel dressed with the procedural facade grid, which has no
 * model bound of its own to derive one from. */
const CAIRO_FACADE_PARCEL_DEPTH_M = 15;

const cairoRoadsideStyle = (
  position: WorldPoint,
): {
  readonly material: string;
  readonly heightRange: readonly [number, number];
  readonly depthM: number;
} => {
  if (position.x < -590) {
    return {
      material: "cairo-west-bank-concrete",
      heightRange: [18, 40],
      depthM: 14,
    };
  }
  if (position.x < 55) {
    return {
      material: "cairo-gezira-cream",
      heightRange: [14, 34],
      depthM: 14,
    };
  }
  if (position.z < -350) {
    return {
      material: "cairo-garden-stucco",
      heightRange: [12, 28],
      depthM: 14,
    };
  }
  return {
    material: "cairo-khedivial-stone",
    heightRange: [20, 46],
    depthM: 14,
  };
};

// These carriageway sides face directly onto a Nile channel. Preserve their
// promenade, trees and open water view; density belongs on the inland side.
const CAIRO_OPEN_WATERFRONT_SIDES: Readonly<
  Partial<Record<string, readonly (-1 | 1)[]>>
> = {
  "cairo-corniche-el-nil": [-1],
  "cairo-saray-el-gezira": [-1],
  "cairo-nile-island-drive": [1],
  "cairo-dokki-nile-drive": [1],
};

/**
 * Which glb street wall a roadside parcel is dressed with. Zoning is derived
 * from where the parcel landed rather than listed per road, so a new road picks
 * up its district's fabric for free.
 *
 * The riverfront roads take the tall set on whichever side is not open water:
 * the real Corniche el-Nil is a wall of 15-25 storey hotel and apartment slabs,
 * and it is the one place on the map that should have a skyline.
 */
const cairoDistrictBuildingSet = (position: WorldPoint): string => {
  if (position.x < -590) return "cairo-westbank";
  if (position.x < 55) return "cairo-zamalek";
  // Garden City: elegant low-rise blocks rather than Downtown's Khedivial bulk.
  if (position.z < -350) return "cairo-zamalek";
  return "cairo-downtown";
};

const cairoRoadsideBuildingSet = (
  surfaceId: string,
  position: WorldPoint,
): string =>
  CAIRO_OPEN_WATERFRONT_SIDES[surfaceId]
    ? "cairo-corniche"
    : cairoDistrictBuildingSet(position);

/**
 * One roadside parcel in six keeps the procedural windowed boxes instead of a
 * glb street wall.
 *
 * The boxes are what Cairo used to be built from entirely, and they are worth
 * keeping in the mix — plain beige stucco blocks are a real part of the city,
 * and a map where every single building is one of fifteen models reads as
 * repetitive in a way the boxes' size and height jitter does not. They just
 * cannot be the majority any more. Deterministic on the block id so the same
 * parcels stay boxes across loads; `Math.random` here would desync the map.
 */
const cairoParcelKeepsFacadeBoxes = (blockId: string): boolean =>
  hashStringToSeed(`${blockId}-street-wall`) % 6 === 0;

/**
 * The glb street wall is one-sided: the Quaternius kit puts every door and
 * window on local +z, so a parcel's far edge is a windowless service back.
 * Within this margin of another road's pavement that back would be the whole
 * view from the carriageway, so the parcel is dressed with the procedural
 * windowed boxes instead — those glaze all four faces, and the far road sees
 * windows rather than blank brick. Must stay below 1.5 + the shallowest set
 * depth (15) or a parcel would trip on its own road.
 */
export const CAIRO_BACK_TO_ROAD_MARGIN_M = 6;

const pointToSegmentM = (
  p: WorldPoint,
  a: WorldPoint,
  b: WorldPoint,
): number => {
  const abX = b.x - a.x;
  const abZ = b.z - a.z;
  const lengthSq = abX * abX + abZ * abZ;
  const t = lengthSq
    ? Math.max(
        0,
        Math.min(1, ((p.x - a.x) * abX + (p.z - a.z) * abZ) / lengthSq),
      )
    : 0;
  return Math.hypot(p.x - (a.x + abX * t), p.z - (a.z + abZ * t));
};

/** Exact segment-to-segment distance — no sampling, so nothing can slip
 * between probe points on a long edge. */
const segmentToSegmentM = (
  a1: WorldPoint,
  a2: WorldPoint,
  b1: WorldPoint,
  b2: WorldPoint,
): number => {
  const cross = (o: WorldPoint, p: WorldPoint, q: WorldPoint): number =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return 0;
  }
  return Math.min(
    pointToSegmentM(a1, b1, b2),
    pointToSegmentM(a2, b1, b2),
    pointToSegmentM(b1, a1, a2),
    pointToSegmentM(b2, a1, a2),
  );
};

const backEdgeNearsARoad = (
  backStart: WorldPoint,
  backEnd: WorldPoint,
): boolean =>
  cairoRoadSurfaces.some((surface) => {
    const reach =
      surface.widthM / 2 +
      (surface.sidewalkWidthM ?? 2.8) +
      0.75 +
      CAIRO_BACK_TO_ROAD_MARGIN_M;
    for (let index = 1; index < surface.centerline.length; index += 1) {
      if (
        segmentToSegmentM(
          backStart,
          backEnd,
          surface.centerline[index - 1],
          surface.centerline[index],
        ) < reach
      ) {
        return true;
      }
    }
    return false;
  });

for (const surface of cairoRoadSurfaces) {
  if (surface.id.includes("-bridge")) continue;
  for (let segmentIndex = 0; segmentIndex + 1 < surface.centerline.length; segmentIndex += 1) {
    const start = surface.centerline[segmentIndex];
    const end = surface.centerline[segmentIndex + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLength = Math.hypot(dx, dz);
    if (segmentLength < 32) continue;
    const alongX = dx / segmentLength;
    const alongZ = dz / segmentLength;
    const normalX = alongZ;
    const normalZ = -alongX;
    // min(6, 10%): at min(14, 14%) every polyline joint stood 28 m bare — the
    // single biggest systematic kerb gap on the map.
    const endpointClearanceM = Math.min(6, segmentLength * 0.1);
    const usableLengthM = segmentLength - endpointClearanceM * 2;
    if (usableLengthM < 24) continue;
    // One long parcel reads as a coherent apartment frontage and costs far
    // fewer meshes than several tiny strips. These thresholds were loosened
    // when the wall became instanced glbs rather than individually-drawn boxes:
    // shorter segments now earn frontage, parcels reach closer to the junctions,
    // and long runs split more often — Cairo is a dense city and the gaps
    // between parcels were reading as vacant lots.
    const runCount = Math.max(1, Math.ceil(usableLengthM / 110));
    const slotLengthM = usableLengthM / runCount;
    const frontageLengthM = Math.max(26, Math.min(110, slotLengthM - 6));
    const headingDeg =
      (Math.atan2(dx, dz) * 180) / Math.PI - 90;

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const distanceAlongM =
        endpointClearanceM + slotLengthM * (runIndex + 0.5);
      const roadPosition = point(
        start.x + alongX * distanceAlongM,
        start.z + alongZ * distanceAlongM,
      );
      for (const side of [-1, 1] as const) {
        if (CAIRO_OPEN_WATERFRONT_SIDES[surface.id]?.includes(side)) {
          continue;
        }
        const provisional = point(
          roadPosition.x + normalX * side * 30,
          roadPosition.z + normalZ * side * 30,
        );
        const blockId = `${surface.id}-roadside-${segmentIndex + 1}-${runIndex + 1}`;
        const sideSlug = side < 0 ? "left" : "right";
        const sideId = `${blockId}-${sideSlug}`;
        // Zoned off the provisional point rather than the final centre: the
        // parcel's depth decides its offset from the road, and its set decides
        // its depth, so the set has to be known first. The zoning bands are
        // hundreds of metres wide and the two points are ~10 m apart, so this
        // only ever differs where a parcel already straddles a district edge.
        // Decided once per parcel so a parcel and its retries agree.
        const preferredSet = cairoParcelKeepsFacadeBoxes(sideId)
          ? undefined
          : cairoRoadsideBuildingSet(surface.id, provisional);
        const roadEnvelopeM =
          surface.widthM / 2 +
          (surface.sidewalkWidthM ?? 2.8) +
          0.75;
        // Deep enough for the set that dresses it, and no deeper. Depth is what
        // gets a parcel refused -- a 30 m strip needs 30 m of clear land, and
        // wherever a junction or forecourt came nearer than that the whole
        // frontage was lost. Derived, so retuning a model cannot silently leave
        // it overhanging its own block.
        //
        // Each piece (the whole frontage, or a split half) decides its own
        // dressing: a glb piece whose windowless back would crowd another road
        // is demoted to the all-faces-glazed boxes, but only that piece — the
        // other half of a split keeps the street wall its back allows.
        const pieceFor = (
          pieceId: string,
          alongOffsetM: number,
          lengthM: number,
        ): ProceduralBlock => {
          const build = (
            buildingSet: string | undefined,
          ): { readonly block: ProceduralBlock; readonly depthM: number } => {
            const depthM =
              buildingSet && isBuildingSetId(buildingSet)
                ? buildingSetDepthM(buildingSet) + 1.5
                : CAIRO_FACADE_PARCEL_DEPTH_M;
            const offsetM = roadEnvelopeM + depthM / 2 + 1.5;
            const center = point(
              roadPosition.x +
                normalX * side * offsetM +
                alongX * alongOffsetM,
              roadPosition.z +
                normalZ * side * offsetM +
                alongZ * alongOffsetM,
            );
            const style = cairoRoadsideStyle(center);
            return {
              depthM,
              block: {
                id: pieceId,
                center,
                size: point(lengthM, depthM),
                headingDeg,
                frontageAxis: "z",
                // `headingDeg` puts local +x along the carriageway and local
                // +z across it, and the parcel sits at `road + normal * side`,
                // so the road lies exactly `side` along local +z. One edge,
                // and it is the near one: a strip is not a city block and has
                // no far street to face.
                streetEdges: [side > 0 ? "+z" : "-z"],
                material: style.material,
                heightRange: style.heightRange,
                density: 0.82,
                ...(buildingSet ? { buildingSet } : {}),
              },
            };
          };
          const backCorners = (
            blockCenter: WorldPoint,
            depthM: number,
          ): readonly [WorldPoint, WorldPoint] => {
            const midX = blockCenter.x + normalX * side * (depthM / 2);
            const midZ = blockCenter.z + normalZ * side * (depthM / 2);
            const halfM = lengthM / 2;
            return [
              point(midX - alongX * halfM, midZ - alongZ * halfM),
              point(midX + alongX * halfM, midZ + alongZ * halfM),
            ];
          };
          let chosen = build(preferredSet);
          if (
            preferredSet &&
            backEdgeNearsARoad(
              ...backCorners(chosen.block.center, chosen.depthM),
            )
          ) {
            chosen = build(undefined);
          }
          return chosen.block;
        };
        // One rank only, on the road's own heading. There used to be a second
        // rank stepping back behind this one; for a one-sided building kit it
        // was always a mistake — its facades stared at the first rank's blank
        // back across a 4 m gap, its own back landed on whatever road ran
        // behind (Cairo's parallel corridors are often 30-60 m apart), and,
        // being accepted early, it consumed land that a later road's kerbside
        // parcel needed. The land behind the wall stays open instead.
        //
        // A crossing, venue, landmark or an earlier road's parcel may block
        // only part of a run, so a rejected piece keeps halving until
        // something fits in the gaps — down to 12 m, one small building's
        // frontage (cairo-block-small packs at 9.6 m). Without the ladder,
        // roads whose band greedy acceptance had already consumed
        // (opera-square, zamalek-south) ended up with no frontage of their
        // own at all. The floor was 16 m with 6 m split gaps; that quantised
        // every ~22 m obstruction into a 30-50 m hole, which is how a city
        // reads as vacant lots.
        const splitGapM = 4;
        const tryPiece = (
          pieceId: string,
          alongOffsetM: number,
          lengthM: number,
        ): boolean => {
          const sideContext: RoadsideSideContext = {
            origin: point(
              roadPosition.x + alongX * alongOffsetM,
              roadPosition.z + alongZ * alongOffsetM,
            ),
            outX: normalX * side,
            outZ: normalZ * side,
          };
          if (
            addCairoRoadsideBlock(
              pieceFor(pieceId, alongOffsetM, lengthM),
              sideContext,
            )
          ) {
            return true;
          }
          const halfLengthM = (lengthM - splitGapM) / 2;
          if (halfLengthM < 12) return false;
          const stepM = (halfLengthM + splitGapM) / 2;
          const left = tryPiece(`${pieceId}-s1`, alongOffsetM - stepM, halfLengthM);
          const right = tryPiece(`${pieceId}-s2`, alongOffsetM + stepM, halfLengthM);
          return left || right;
        };
        tryPiece(sideId, 0, frontageLengthM);
      }
    }
  }
}

/**
 * Gap-fill pass. The slot pass above lays frontage on a fixed per-segment
 * grid and its halving ladder splits refusals at midpoints — halves cannot
 * slide sideways into an offset gap, and a road visited late in spec order
 * inherits a band already eaten by earlier roads' parcels (opera-square lost
 * most of its kerb this way). This pass measures the bare intervals that
 * actually remain along every buildable kerb and tiles pieces into them
 * directly. It also visits segments the slot pass skips as too short, down
 * to 18 m, which previously stayed bare end to end. Ids carry -g<n> where
 * the slot pass carries a run index, so everything filtering on
 * `-roadside-` and the side slug treats both passes alike.
 */
for (const surface of cairoRoadSurfaces) {
  if (surface.id.includes("-bridge")) continue;
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < surface.centerline.length;
    segmentIndex += 1
  ) {
    const start = surface.centerline[segmentIndex];
    const end = surface.centerline[segmentIndex + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLength = Math.hypot(dx, dz);
    if (segmentLength < 18) continue;
    const alongX = dx / segmentLength;
    const alongZ = dz / segmentLength;
    const normalX = alongZ;
    const normalZ = -alongX;
    const endpointClearanceM = Math.min(6, segmentLength * 0.1);
    const headingDeg = (Math.atan2(dx, dz) * 180) / Math.PI - 90;
    const roadEnvelopeM =
      surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + 0.75;
    for (const side of [-1, 1] as const) {
      if (CAIRO_OPEN_WATERFRONT_SIDES[surface.id]?.includes(side)) {
        continue;
      }
      const sideSlug = side < 0 ? "left" : "right";
      // Occupied intervals: every accepted block whose rect reaches this
      // side's frontage band, projected onto the segment axis. Blocks, not
      // exclusions — a piece dropped over a venue or landmark margin simply
      // fails tryGapPiece and splits around it. The band is exactly as deep
      // as the deepest parcel this road can host (district glb set or the
      // facade-box depth) plus the 2 m sibling gap on each face — and no
      // deeper: a wider band reads the NEXT street's parcel backs as
      // occupying this kerb (el-gabalaya's backs sit ~26 m from Saray's kerb
      // and a 25 m band blanked 180 m of it).
      const midpointSet = cairoRoadsideBuildingSet(
        surface.id,
        point(
          (start.x + end.x) / 2 + normalX * side * 30,
          (start.z + end.z) / 2 + normalZ * side * 30,
        ),
      );
      const deepestParcelM = Math.max(
        CAIRO_FACADE_PARCEL_DEPTH_M,
        isBuildingSetId(midpointSet) ? buildingSetDepthM(midpointSet) + 1.5 : 0,
      );
      const bandInnerM = roadEnvelopeM + 1.5 - 2;
      const bandDepthM = deepestParcelM + 4;
      const band = orientedParcel(
        point(
          (start.x + end.x) / 2 +
            normalX * side * (bandInnerM + bandDepthM / 2),
          (start.z + end.z) / 2 +
            normalZ * side * (bandInnerM + bandDepthM / 2),
        ),
        point(segmentLength, bandDepthM),
        headingDeg,
      );
      const occupied: { from: number; to: number }[] = [];
      // Project only the part of a shape inside the band: a long parcel on a
      // parallel road grazing the band's outer edge by a metre must cast a
      // metre's shadow, not its whole hundred-metre length. The band lies
      // strictly on this side of the road, so clipping to it doubles as the
      // side test for exclusions — a cross-road envelope never reaches it.
      const pushClippedInterval = (parcel: OrientedParcel): void => {
        if (!orientedParcelsOverlap(band, parcel)) return;
        const corners: WorldPoint[] = [];
        for (const [signU, signV] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          corners.push(
            point(
              parcel.center.x +
                parcel.axisU.x * parcel.halfU * signU +
                parcel.axisV.x * parcel.halfV * signV,
              parcel.center.z +
                parcel.axisU.z * parcel.halfU * signU +
                parcel.axisV.z * parcel.halfV * signV,
            ),
          );
        }
        const clipped = clipToOrientedParcel(corners, band);
        if (clipped.length < 3) return;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const vertex of clipped) {
          const along =
            (vertex.x - start.x) * alongX + (vertex.z - start.z) * alongZ;
          min = Math.min(min, along);
          max = Math.max(max, along);
        }
        occupied.push({ from: min, to: max });
      };
      for (const existing of cairoBlocks) {
        pushClippedInterval(
          orientedParcel(
            existing.center,
            existing.size,
            existing.headingDeg ?? 0,
          ),
        );
      }
      // Tile around venue aprons, service forecourts and landmark margins
      // rather than dropping pieces onto them only to have every attempt
      // refused mid-lot.
      for (const exclusion of cairoRoadsideExclusions) {
        pushClippedInterval(exclusion.inflated);
      }
      occupied.sort((first, second) => first.from - second.from);
      const merged: { from: number; to: number }[] = [];
      for (const interval of occupied) {
        const last = merged.at(-1);
        if (last && interval.from <= last.to + 0.5) {
          last.to = Math.max(last.to, interval.to);
        } else {
          merged.push({ ...interval });
        }
      }
      const usableFrom = endpointClearanceM;
      const usableTo = segmentLength - endpointClearanceM;
      const gaps: { from: number; to: number }[] = [];
      let cursor = usableFrom;
      for (const interval of merged) {
        if (interval.to <= cursor) continue;
        if (interval.from >= usableTo) break;
        if (interval.from > cursor) {
          gaps.push({ from: cursor, to: Math.min(interval.from, usableTo) });
        }
        cursor = Math.max(cursor, interval.to);
        if (cursor >= usableTo) break;
      }
      if (cursor < usableTo) gaps.push({ from: cursor, to: usableTo });

      let gapPieceIndex = 0;
      for (const gap of gaps) {
        // Two metres off each neighbour that bounds the gap; the slot pass
        // spaces siblings by 4-6 m, so fill reads as the same street wall.
        const fillFrom = gap.from + 2;
        const fillTo = gap.to - 2;
        const fillLength = fillTo - fillFrom;
        if (fillLength < 12) continue;
        const pieceCount = Math.max(1, Math.ceil(fillLength / 114));
        const slotLengthM =
          (fillLength - (pieceCount - 1) * 4) / pieceCount;
        for (let slot = 0; slot < pieceCount; slot += 1) {
          gapPieceIndex += 1;
          const pieceBaseId = `${surface.id}-roadside-${segmentIndex + 1}-g${gapPieceIndex}-${sideSlug}`;
          const centerAlongM =
            fillFrom + slot * (slotLengthM + 4) + slotLengthM / 2;
          const provisional = point(
            start.x + alongX * centerAlongM + normalX * side * 30,
            start.z + alongZ * centerAlongM + normalZ * side * 30,
          );
          const preferredSet = cairoParcelKeepsFacadeBoxes(pieceBaseId)
            ? undefined
            : cairoRoadsideBuildingSet(surface.id, provisional);
          // The corniche set is 21.7 m deep and the island's parallel roads
          // often leave a strip a metre too shallow for it — where the tall
          // riverfront slab cannot fit, the district's ordinary fabric can.
          const districtSet = cairoDistrictBuildingSet(provisional);
          const fallbackSet =
            preferredSet && districtSet !== preferredSet
              ? districtSet
              : undefined;
          const pieceFor = (
            pieceId: string,
            alongM: number,
            lengthM: number,
            dressing: string | undefined,
            boxDepthM?: number,
          ): ProceduralBlock => {
            const build = (
              buildingSet: string | undefined,
            ): {
              readonly block: ProceduralBlock;
              readonly depthM: number;
            } => {
              const depthM =
                buildingSet && isBuildingSetId(buildingSet)
                  ? buildingSetDepthM(buildingSet) + 1.5
                  : (boxDepthM ?? CAIRO_FACADE_PARCEL_DEPTH_M);
              const offsetM = roadEnvelopeM + depthM / 2 + 1.5;
              const center = point(
                start.x + alongX * alongM + normalX * side * offsetM,
                start.z + alongZ * alongM + normalZ * side * offsetM,
              );
              const style = cairoRoadsideStyle(center);
              return {
                depthM,
                block: {
                  id: pieceId,
                  center,
                  size: point(lengthM, depthM),
                  headingDeg,
                  frontageAxis: "z",
                  streetEdges: [side > 0 ? "+z" : "-z"],
                  material: style.material,
                  heightRange: style.heightRange,
                  density: 0.82,
                  ...(buildingSet ? { buildingSet } : {}),
                },
              };
            };
            let chosen = build(dressing);
            if (dressing) {
              const backMidX =
                chosen.block.center.x + normalX * side * (chosen.depthM / 2);
              const backMidZ =
                chosen.block.center.z + normalZ * side * (chosen.depthM / 2);
              const halfM = lengthM / 2;
              if (
                backEdgeNearsARoad(
                  point(backMidX - alongX * halfM, backMidZ - alongZ * halfM),
                  point(backMidX + alongX * halfM, backMidZ + alongZ * halfM),
                )
              ) {
                chosen = build(undefined);
              }
            }
            return chosen.block;
          };
          // Dressing ladder, deepest first. The island's parallel streets sit
          // ~30 m apart in places, which misses the room for a full-depth
          // parcel by well under a metre — Cairo's own answer is the sliver
          // building, so shallow all-glazed box parcels close what no glb
          // set can.
          const attempts: readonly {
            readonly set?: string;
            readonly boxDepthM?: number;
          }[] = [
            preferredSet ? { set: preferredSet } : {},
            ...(fallbackSet ? [{ set: fallbackSet }] : []),
            { boxDepthM: 12 },
            { boxDepthM: 9 },
          ];
          const tryGapPiece = (
            pieceId: string,
            alongM: number,
            lengthM: number,
          ): boolean => {
            const sideContext: RoadsideSideContext = {
              origin: point(
                start.x + alongX * alongM,
                start.z + alongZ * alongM,
              ),
              outX: normalX * side,
              outZ: normalZ * side,
            };
            for (const attempt of attempts) {
              if (
                addCairoRoadsideBlock(
                  pieceFor(
                    pieceId,
                    alongM,
                    lengthM,
                    attempt.set,
                    attempt.boxDepthM,
                  ),
                  sideContext,
                )
              ) {
                return true;
              }
            }
            const halfLengthM = (lengthM - 4) / 2;
            if (halfLengthM < 12) return false;
            const stepM = (halfLengthM + 4) / 2;
            const left = tryGapPiece(
              `${pieceId}-s1`,
              alongM - stepM,
              halfLengthM,
            );
            const right = tryGapPiece(
              `${pieceId}-s2`,
              alongM + stepM,
              halfLengthM,
            );
            return left || right;
          };
          tryGapPiece(pieceBaseId, centerAlongM, Math.min(110, slotLengthM));
        }
      }
    }
  }
}

const playerLaneIds = [
  "cairo-qasr-el-ainy-1-forward-1",
  "cairo-nile-island-drive-2-forward-1",
  "cairo-dokki-nile-drive-3-forward-1",
] as const;
const vehicleLanes = lanesForAnchors
  .filter((lane) => !playerLaneIds.includes(lane.id as (typeof playerLaneIds)[number]))
  .filter((_, index) => index % 3 === 0)
  .slice(0, 30);

const cairoSpawnPoints: readonly MapSpawnPoint[] = [
  ...playerLaneIds.map((laneId, index) => {
    const lane = cairoLaneById.get(laneId)!;
    return {
      id: `cairo-player-${index + 1}`,
      kind: "player" as const,
      anchor: anchor(laneId, safeDistance(lane, 0.35 + index * 0.12)),
    };
  }),
  ...vehicleLanes.map((lane, index) => ({
    // Three dedicated patrol gates (indices 3, 14, 25). Without them Cairo's
    // police presence hung on the ambient one-in-five patrol roll landing on
    // a car-capable gate, which this seed rarely granted — whole sessions
    // passed without a single patrol while NYC showed four or five.
    id:
      index % 11 === 3
        ? `cairo-police-${index + 1}`
        : index % 9 === 0
          ? `cairo-bus-${index + 1}`
          : index % 5 === 0
            ? `cairo-taxi-${index + 1}`
            : index % 7 === 0
              ? `cairo-van-${index + 1}`
              : `cairo-car-${index + 1}`,
    kind: "vehicle" as const,
    anchor: anchor(lane.id, safeDistance(lane, 0.28 + (index % 5) * 0.1)),
  })),
];

const checkpointRoads = [
  "cairo-corniche-el-nil",
  "cairo-qasr-el-ainy",
  "cairo-tahrir-approach",
  "cairo-qasr-el-nil-street",
  "cairo-saray-el-gezira",
  "cairo-opera-corridor",
  "cairo-qasr-el-nil-bridge",
  "cairo-al-galaa-bridge",
  "cairo-west-nile-street",
  "cairo-dokki-nile-drive",
] as const;
const checkpointLabels = [
  "Corniche riverside traffic",
  "Garden City arterial",
  "Tahrir radial approach",
  "Downtown crossing",
  "South Zamalek streets",
  "Opera grounds",
  "Qasr El-Nil Bridge",
  "Al-Galaa Bridge",
  "West-bank river road",
  "Dokki return",
] as const;

const cairoCheckpoints: readonly MapCheckpoint[] = checkpointRoads.map(
  (roadId, index) => {
    const lane = cairoLanes.find(
      (candidate) =>
        candidate.roadId === roadId &&
        (candidate.id.includes("-forward-") ||
          !cairoLanes.some(
            (item) =>
              item.roadId === roadId && item.id.includes("-forward-"),
          )),
    )!;
    return {
      id: `cairo-checkpoint-${index + 1}`,
      label: checkpointLabels[index],
      anchor: anchor(lane.id, safeDistance(lane, 0.55)),
    };
  },
);

const cairoLaneGraph: LaneGraph = {
  nodes: cairoNodes,
  lanes: cairoLanes,
  controls: cairoControls,
  conflictZones: cairoConflictZones,
  spawnPoints: cairoSpawnPoints,
  checkpoints: cairoCheckpoints,
};

export const CAIRO_MAP_PACK: MapPack = {
  id: "cairo-central-nile",
  name: "Cairo — Central Nile Loop",
  areaLabel: "Tahrir, Garden City, Gezira, Zamalek and the central Nile",
  countryIds: ["eg"],
  roadNames,
  ambientTraffic: { desktop: 32, touch: 16 },
  source: {
    boundingBox: {
      south: 30.0305,
      west: 31.2105,
      north: 30.0565,
      east: 31.2395,
    },
    capturedOn: CAIRO_CONTENT_REVIEWED_ON,
    sourceUrl:
      "https://api.openstreetmap.org/api/0.6/map?bbox=31.2105,30.0305,31.2395,30.0565",
    checksum:
      "06b06ce5ad375d54678b0ede43f82b48f834e2a36da67ccce75758aa1f0a4d32",
    importerVersion: "sideswap-osm-compact@2",
    attribution: "© OpenStreetMap contributors",
    licenseName: "Open Data Commons Open Database License 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  geometry: {
    worldSize: CAIRO_WORLD_SIZE,
    roadWidth: 9.2,
    shoulderWidth: 1.2,
    roadSurfaces: cairoRoadSurfaces,
    waterBodies: cairoWaterBodies,
    blocks: cairoBlocks,
    landmarks: cairoLandmarks,
    servicePoints: cairoServicePoints,
    gigVenues: cairoGigVenues,
  },
  laneGraph: cairoLaneGraph,
};

export const CAIRO_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-eg",
  countryId: "eg",
  destinationId: "eg-cairo",
  mapId: "cairo-central-nile",
  title: "Free Drive — Cairo",
  description:
    "Explore Tahrir, Garden City, Gezira and the central Nile on right-hand roads with metric signs.",
  startSpawnId: "cairo-player-1",
  trafficSeed: 2601,
  scenarioClock: CAIRO_SCENARIO_CLOCK,
};
