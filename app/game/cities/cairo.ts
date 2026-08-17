import { buildLaneTrueGeometry, CONNECTOR_BLEND_RUN_M } from "../laneConnectors";
import { buildRailCrossingControl } from "./cityAuthoringHelpers";
import { carveBlocksForRailCorridors } from "../geometry/railCorridor";
import { buildingSetDepthM, isBuildingSetId } from "../buildingSets";
import { ROAD_DIVIDED_PARK_IDS } from "../parkLayouts";
import { hashStringToSeed } from "../visuals";
import type {
  FreeDriveDefinition,
  GigVenue,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneSegment,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ProceduralBlock,
  ProceduralLandmark,
  RailLine,
  RoadMarkingPath,
  RoadSurface,
  ServicePoint,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WaterBody,
  WorldPoint,
} from "../types";

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

/**
 * Moved 10:30 -> 21:00 when the map went night, for the same reason London's
 * moved: the label prints on the drive screen, and a morning clock over a dark
 * sky is the first thing that reads as broken. Unlike London's, this map
 * authors no timed lane restriction, so the hour is free — and 21:00 is when
 * central Cairo is at its busiest anyway.
 */
export const CAIRO_SCENARIO_CLOCK = {
  weekday: "wed",
  minutesAfterMidnight: 21 * 60,
  label: "Wednesday · 21:00",
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
  // Hara network nodes (Cairo reimagining). Two kinds: `*-x-*` nodes are
  // INSERTED into a host road's polyline (collinear on the host segment, so
  // the host's geometry is unchanged — only its segment count and therefore
  // its later lane ids move), and `cairo-h-*` nodes are interior alley
  // crossings no main road touches. Every coordinate was solved against the
  // host segment line, never eyeballed.
  node("cairo-qn-x-merit", 137, -113.026),
  node("cairo-qn-x-bustan", 212, -109.737),
  node("cairo-qn-x-turgoman", 650, -63.75),
  node("cairo-ch-x-bustan", 200, 343.333),
  node("cairo-ch-x-abouela", 250, 350),
  node("cairo-ta-x-merit", 125, -292.18),
  node("cairo-qa-x-maamari", 336.5, 475),
  node("cairo-qa-x-taha", 366.531, 700),
  node("cairo-rm-x-farnsawi", 475.098, 105.001),
  node("cairo-rm-x-turgoman", 565.574, 276.148),
  node("cairo-rm-x-maamari", 650, 470),
  node("cairo-rm-x-taha", 737.5, 700),
  node("cairo-gl-x-farnsawi", 712.889, 105),
  node("cairo-sb-x-youssef", 470, -497.5),
  node("cairo-sb-x-diwan", 640, -476),
  node("cairo-hz-x-youssef", 475, -671.111),
  node("cairo-hz-x-diwan", 640, -658.077),
  node("cairo-ra-x-abouela", 250, 852.456),
  node("cairo-qa-x-lazoghly", 235.676, -780),
  node("cairo-th-x-lazoghly", 412.5, -780),
  node("cairo-rm-x-lazoghly", 596, -780),
  node("cairo-gl-x-lazoghly", 739.429, -780),
  node("cairo-iw-x-marsafi", -431.6, 280),
  node("cairo-iw-x-selim", -424.659, -785),
  node("cairo-ia-x-selim", -359.778, -785),
  node("cairo-ib-x-selim", -238, -785),
  node("cairo-ie-x-selim", -124.333, -785.001),
  node("cairo-wo-x-sad", -834.348, -785),
  node("cairo-wi-x-sad", -615.761, -785),
  node("cairo-h-bustan-maarouf", 207, 121),
  node("cairo-h-sahafa-maamari", 493.37, 472.54),
  node("cairo-h-sahafa-taha", 526.18, 700),
  node("cairo-h-abouela-khadrawy", 250, 599.8),
  node("cairo-h-turgoman-farnsawi", 615.38, 105),
  node("cairo-h-turgoman-bend", 598, 260),
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
  road("cairo-qasr-el-ainy", "Qasr El-Ainy Street", ["cairo-eq-0", "cairo-qa-x-lazoghly", "cairo-eq-1", "cairo-eq-2", "cairo-eq-3", "cairo-tahrir-hub", "cairo-eq-4", "cairo-eq-5", "cairo-qa-x-maamari", "cairo-eq-6", "cairo-qa-x-taha", "cairo-eq-7"], 60, 2, 10.6, 3.4, { arterial: true }),
  road("cairo-simon-bolivar", "Al Tahrir Street", ["cairo-ec-2", "cairo-eq-2", "cairo-ed-2", "cairo-sb-x-youssef", "cairo-er-2", "cairo-sb-x-diwan", "cairo-eg-2"], 40, 1, 7.4, 2.6, { oneWay: "forward" }),
  road("cairo-talaat-harb", "Abd Al Khaleq Tharwat Street", ["cairo-ed-0", "cairo-th-x-lazoghly", "cairo-ed-1", "cairo-ed-2", "cairo-ed-3", "cairo-tahrir-radial-cross", "cairo-qasr-tharwat"], 40, 1, 8.4, 2.6, { oneWay: "forward" }),
  road("cairo-ramses", "Ramsis Street", ["cairo-er-0", "cairo-rm-x-lazoghly", "cairo-er-1", "cairo-er-2", "cairo-er-3", "cairo-tahrir-radial-cross", "cairo-tahrir-hub", "cairo-er-4", "cairo-rm-x-farnsawi", "cairo-er-5", "cairo-rm-x-turgoman", "cairo-er-6", "cairo-rm-x-maamari", "cairo-er-7", "cairo-rm-x-taha", "cairo-er-8"], 60, 2, 10.6, 3.4, { arterial: true }),
  road("cairo-galaa-street", "Al-Galaa Street", ["cairo-eg-0", "cairo-gl-x-lazoghly", "cairo-eg-1", "cairo-eg-2", "cairo-eg-3", "cairo-eg-4", "cairo-gl-x-farnsawi", "cairo-eg-5", "cairo-eg-6", "cairo-eg-7", "cairo-eg-8"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-garden-city-south", "Al Sheikh Rihan Street", ["cairo-ec-0", "cairo-eq-0", "cairo-ed-0", "cairo-er-0", "cairo-eg-0"], 40, 2, 9, 2.2),
  road("cairo-abdel-qader-hamza", "Abd Al Qader Hamza Street", ["cairo-ec-1", "cairo-eq-1", "cairo-ed-1", "cairo-hz-x-youssef", "cairo-er-1", "cairo-hz-x-diwan", "cairo-eg-1"], 40, 1, 7.4, 2.4, { oneWay: "reverse" }),
  road("cairo-tahrir-approach", "Magmaa Al Tahrir Street", ["cairo-ec-3", "cairo-ta-x-merit", "cairo-eq-3", "cairo-ed-3", "cairo-er-3", "cairo-eg-3"], 60, 2, 9.6, 3.4, { arterial: true, oneWay: "forward" }),
  road("cairo-qasr-el-nil-street", "Qasr El-Nil Street", ["cairo-ec-4", "cairo-qn-x-merit", "cairo-qn-x-bustan", "cairo-tahrir-hub", "cairo-qasr-east", "cairo-qasr-tharwat", "cairo-qn-x-turgoman", "cairo-eg-4"], 60, 4, 16, 3.4, { arterial: true }),
  road("cairo-champollion", "Champollion Street", ["cairo-ec-6", "cairo-ch-x-bustan", "cairo-ch-x-abouela", "cairo-eq-5", "cairo-ed-5", "cairo-er-6", "cairo-eg-6"], 40, 1, 7.4, 2.4, { oneWay: "reverse" }),
  road("cairo-ramses-approach", "Abd Al Moneim Riyad Street", ["cairo-ec-8", "cairo-ra-x-abouela", "cairo-eq-7", "cairo-ed-7", "cairo-er-8", "cairo-eg-8"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-saray-el-gezira", "Al Saraya Street", ["cairo-iw-0", "cairo-iw-x-selim", "cairo-iw-1", "cairo-iw-2", "cairo-iw-3", "cairo-iw-4", "cairo-iw-x-marsafi", "cairo-iw-5", "cairo-iw-6", "cairo-iw-7"], 40, 2, 9, 2.4),
  road("cairo-el-gabalaya", "El Gabalaya Street", ["cairo-ia-0", "cairo-ia-x-selim", "cairo-ia-1", "cairo-ia-2", "cairo-ia-3", "cairo-ia-4", "cairo-ia-5", "cairo-ia-6", "cairo-ia-7"], 40, 1, 7.4, 2.2, { oneWay: "forward" }),
  road("cairo-opera-corridor", "Montazah Al Gezira Street", ["cairo-ib-0", "cairo-ib-x-selim", "cairo-ib-1", "cairo-ib-2", "cairo-ib-3", "cairo-ib-4", "cairo-ib-5", "cairo-ib-6", "cairo-ib-7"], 40, 1, 7.4, 2.6, { oneWay: "reverse" }),
  road("cairo-nile-island-drive", "El-Nil Street", ["cairo-ie-0", "cairo-ie-x-selim", "cairo-ie-1", "cairo-ie-2", "cairo-ie-3", "cairo-ie-4", "cairo-ie-5", "cairo-ie-6", "cairo-ie-7"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-south-gezira-road", "Al Malek Abd Al Aziz Aal Seoud Street", ["cairo-iw-0", "cairo-ia-0", "cairo-ib-0", "cairo-ie-0"], 40, 2, 9, 2.4),
  road("cairo-zamalek-south", "Hassan Sabry Street", ["cairo-iw-2", "cairo-ia-2", "cairo-ib-2", "cairo-ie-2"], 40, 1, 7.4, 2.2, { oneWay: "forward" }),
  road("cairo-opera-square", "Al Gezira Street", ["cairo-iw-4", "cairo-ia-4", "cairo-ib-4", "cairo-ie-4"], 40, 1, 7.4, 2.6, { oneWay: "reverse" }),
  road("cairo-zamalek-north", "26th July Street", ["cairo-iw-7", "cairo-ia-7", "cairo-ib-7", "cairo-ie-7"], 40, 2, 9, 2.4),
  road("cairo-qasr-el-nil-bridge", "Qasr El-Nil Bridge", ["cairo-ie-3", "cairo-ec-4"], 60, 2, 11.2, 3.4, { arterial: true }),
  road("cairo-al-galaa-bridge", "Al-Galaa Bridge", ["cairo-wi-5", "cairo-iw-5"], 60, 4, 15, 3.4, { arterial: true }),
  road("cairo-west-nile-street", "Charles De Gaulle Street", ["cairo-wo-0", "cairo-wo-x-sad", "cairo-wo-1", "cairo-wo-2", "cairo-wo-3", "cairo-wo-4", "cairo-wo-5", "cairo-wo-6", "cairo-wo-7"], 60, 2, 10.4, 3.4, { arterial: true }),
  road("cairo-dokki-nile-drive", "Al Dokki Street", ["cairo-wi-0", "cairo-wi-x-sad", "cairo-wi-1", "cairo-wi-2", "cairo-wi-3", "cairo-wi-4", "cairo-wi-5", "cairo-wi-6", "cairo-wi-7"], 60, 2, 9.6, 3.4, { arterial: true }),
  road("cairo-dokki-south", "Al Mesaha Street", ["cairo-wo-0", "cairo-wi-0"], 40, 2, 9, 2.4),
  road("cairo-dokki-midtown", "Gaber Ibn Hayan Street", ["cairo-wo-3", "cairo-wi-3"], 40, 1, 7.4, 2.4, { oneWay: "forward" }),
  road("cairo-agouza-approach", "26th July Street", ["cairo-wo-7", "cairo-wi-7"], 40, 2, 9, 2.4),

  // ---- The hara network (Cairo reimagining, 2026-08-16). ----
  // Twenty-four one-way, single-lane lanes ("harat"/"sikak" — the streets that
  // could at most allow one car through, per the owner's brief) threading the
  // interiors the corridor roads leave empty. Every name is a real street from
  // the frozen OSM extract (the provenance test requires it) picked for the
  // district it serves: Bulaq gets Wabour Al Turgoman and Abou Al Ela, the
  // museum gets Merit Pasha, Zamalek gets Marsafi/Ozoris/Al Borg, the Gezira
  // club south gets Saleh Selim, Dokki gets Suliman Gawhar. One-way is not a
  // style choice: a two-way road needs an even laneCount and a 4.8 m
  // carriageway cannot carry two opposing NPC lanes, so alternating one-way
  // directions provide the circulation instead. Endpoints are existing nodes
  // or `*-x-*` inserts; interior `cairo-h-*` nodes are alley-to-alley
  // crossings. Nothing here crosses the rail corridor or a Nile channel.
  road("cairo-haret-sahafa", "El Sahafa Street", ["cairo-ed-5", "cairo-h-sahafa-maamari", "cairo-ed-6", "cairo-h-sahafa-taha", "cairo-ed-7"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-khadrawy", "Al Khadrawy Street", ["cairo-ec-7", "cairo-h-abouela-khadrawy", "cairo-eq-6", "cairo-ed-6", "cairo-er-7"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-maamari", "Hussain Pasha Al Maamari Street", ["cairo-qa-x-maamari", "cairo-h-sahafa-maamari", "cairo-rm-x-maamari"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-taha", "Sayed Taha Street", ["cairo-qa-x-taha", "cairo-h-sahafa-taha", "cairo-rm-x-taha"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-abouela", "Al Sultan Abou Al Ela Street", ["cairo-ch-x-abouela", "cairo-h-abouela-khadrawy", "cairo-ra-x-abouela"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-turgoman", "Wabour Al Turgoman Street", ["cairo-qn-x-turgoman", "cairo-h-turgoman-farnsawi", "cairo-ed-4", "cairo-h-turgoman-bend", "cairo-rm-x-turgoman"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-farnsawi", "Wabour Al Farnsawi Street", ["cairo-rm-x-farnsawi", "cairo-h-turgoman-farnsawi", "cairo-gl-x-farnsawi"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-bustan", "Al Bostan Al Saedi Street", ["cairo-qn-x-bustan", "cairo-h-bustan-maarouf", "cairo-ch-x-bustan"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-maarouf", "Al Sheikh Maarouf Street", ["cairo-ec-5", "cairo-h-bustan-maarouf", "cairo-eq-4"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-merit", "Merit Pasha Street", ["cairo-qn-x-merit", "cairo-ta-x-merit"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-youssef", "Al Sheikh Ali Youssef Street", ["cairo-sb-x-youssef", "cairo-hz-x-youssef"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-diwan", "Al Diwan Street", ["cairo-sb-x-diwan", "cairo-hz-x-diwan"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-lazoghly", "Lazoghly Street", ["cairo-qa-x-lazoghly", "cairo-th-x-lazoghly", "cairo-rm-x-lazoghly", "cairo-gl-x-lazoghly"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-marsafi", "Al Sheikh Al Marsafi Street", ["cairo-iw-x-marsafi", "cairo-ia-5", "cairo-ib-5", "cairo-ie-5"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-borg", "Al Borg Street", ["cairo-ia-3", "cairo-ib-3", "cairo-ie-3"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-ozoris", "Ozoris Street", ["cairo-iw-6", "cairo-ia-6", "cairo-ib-6", "cairo-ie-6"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-mokhtar", "Mahmoud Mokhtar Street", ["cairo-ia-1", "cairo-ib-1", "cairo-ie-1"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-selim", "Saleh Selim Street", ["cairo-iw-x-selim", "cairo-ia-x-selim", "cairo-ib-x-selim", "cairo-ie-x-selim"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-sad", "Al Sad Al Aali Street", ["cairo-wo-x-sad", "cairo-wi-x-sad"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-gohar", "Suliman Gawhar Street", ["cairo-wo-1", "cairo-wi-1"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-wasef", "Hussein Wasef Pasha Street", ["cairo-wo-2", "cairo-wi-2"], 40, 1, 4.8, 1.4, { oneWay: "reverse" }),
  road("cairo-haret-refaei", "Amin Al Refaei Street", ["cairo-wo-4", "cairo-wi-4"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
  road("cairo-haret-amer", "Amer Street", ["cairo-wo-6", "cairo-wi-6"], 40, 1, 4.8, 1.4, { oneWay: "forward" }),
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
  junction("cairo-junction-qasr-bridge-island", "cairo-ie-3", ["cairo-nile-island-drive", "cairo-qasr-el-nil-bridge", "cairo-haret-borg"]),
  junction("cairo-junction-galaa-bridge-island", "cairo-iw-5", ["cairo-saray-el-gezira", "cairo-al-galaa-bridge"]),
  junction("cairo-junction-galaa-bridge-west", "cairo-wi-5", ["cairo-dokki-nile-drive", "cairo-al-galaa-bridge"]),
  junction("cairo-junction-dokki-south-outer", "cairo-wo-0", ["cairo-west-nile-street", "cairo-dokki-south"]),
  junction("cairo-junction-dokki-south-inner", "cairo-wi-0", ["cairo-dokki-nile-drive", "cairo-dokki-south"]),
  junction("cairo-junction-dokki-mid-outer", "cairo-wo-3", ["cairo-west-nile-street", "cairo-dokki-midtown"]),
  junction("cairo-junction-dokki-mid-inner", "cairo-wi-3", ["cairo-dokki-nile-drive", "cairo-dokki-midtown"]),
  junction("cairo-junction-agouza-outer", "cairo-wo-7", ["cairo-west-nile-street", "cairo-agouza-approach"]),
  junction("cairo-junction-agouza-inner", "cairo-wi-7", ["cairo-dokki-nile-drive", "cairo-agouza-approach"]),
  // Hara-network turn grants. Same-road continuation stays implicit; each
  // entry is one alley mouth or alley-to-alley crossing. The two bridge
  // landings above additionally admit the haras that end on them.
  junction("cairo-junction-hara-lazoghly-qasr", "cairo-qa-x-lazoghly", ["cairo-qasr-el-ainy", "cairo-haret-lazoghly"]),
  junction("cairo-junction-hara-lazoghly-tharwat", "cairo-th-x-lazoghly", ["cairo-talaat-harb", "cairo-haret-lazoghly"]),
  junction("cairo-junction-hara-lazoghly-ramsis", "cairo-rm-x-lazoghly", ["cairo-ramses", "cairo-haret-lazoghly"]),
  junction("cairo-junction-hara-lazoghly-galaa", "cairo-gl-x-lazoghly", ["cairo-galaa-street", "cairo-haret-lazoghly"]),
  junction("cairo-junction-hara-youssef-bolivar", "cairo-sb-x-youssef", ["cairo-simon-bolivar", "cairo-haret-youssef"]),
  junction("cairo-junction-hara-youssef-hamza", "cairo-hz-x-youssef", ["cairo-abdel-qader-hamza", "cairo-haret-youssef"]),
  junction("cairo-junction-hara-diwan-bolivar", "cairo-sb-x-diwan", ["cairo-simon-bolivar", "cairo-haret-diwan"]),
  junction("cairo-junction-hara-diwan-hamza", "cairo-hz-x-diwan", ["cairo-abdel-qader-hamza", "cairo-haret-diwan"]),
  junction("cairo-junction-hara-merit-qasr-nil", "cairo-qn-x-merit", ["cairo-qasr-el-nil-street", "cairo-haret-merit"]),
  junction("cairo-junction-hara-merit-tahrir", "cairo-ta-x-merit", ["cairo-tahrir-approach", "cairo-haret-merit"]),
  junction("cairo-junction-hara-bustan-qasr-nil", "cairo-qn-x-bustan", ["cairo-qasr-el-nil-street", "cairo-haret-bustan"]),
  junction("cairo-junction-hara-bustan-champollion", "cairo-ch-x-bustan", ["cairo-champollion", "cairo-haret-bustan"]),
  junction("cairo-junction-hara-bustan-maarouf", "cairo-h-bustan-maarouf", ["cairo-haret-bustan", "cairo-haret-maarouf"]),
  junction("cairo-junction-hara-maarouf-corniche", "cairo-ec-5", ["cairo-corniche-el-nil", "cairo-haret-maarouf"]),
  junction("cairo-junction-hara-maarouf-qasr", "cairo-eq-4", ["cairo-qasr-el-ainy", "cairo-haret-maarouf"]),
  junction("cairo-junction-hara-turgoman-qasr-nil", "cairo-qn-x-turgoman", ["cairo-qasr-el-nil-street", "cairo-haret-turgoman"]),
  junction("cairo-junction-hara-turgoman-farnsawi", "cairo-h-turgoman-farnsawi", ["cairo-haret-turgoman", "cairo-haret-farnsawi"]),
  junction("cairo-junction-hara-turgoman-ramsis", "cairo-rm-x-turgoman", ["cairo-ramses", "cairo-haret-turgoman"]),
  junction("cairo-junction-hara-farnsawi-ramsis", "cairo-rm-x-farnsawi", ["cairo-ramses", "cairo-haret-farnsawi"]),
  junction("cairo-junction-hara-farnsawi-galaa", "cairo-gl-x-farnsawi", ["cairo-galaa-street", "cairo-haret-farnsawi"]),
  junction("cairo-junction-hara-abouela-champollion", "cairo-ch-x-abouela", ["cairo-champollion", "cairo-haret-abouela"]),
  junction("cairo-junction-hara-abouela-khadrawy", "cairo-h-abouela-khadrawy", ["cairo-haret-abouela", "cairo-haret-khadrawy"]),
  junction("cairo-junction-hara-abouela-riyad", "cairo-ra-x-abouela", ["cairo-ramses-approach", "cairo-haret-abouela"]),
  junction("cairo-junction-hara-khadrawy-corniche", "cairo-ec-7", ["cairo-corniche-el-nil", "cairo-haret-khadrawy"]),
  junction("cairo-junction-hara-khadrawy-qasr", "cairo-eq-6", ["cairo-qasr-el-ainy", "cairo-haret-khadrawy"]),
  junction("cairo-junction-hara-khadrawy-sahafa", "cairo-ed-6", ["cairo-haret-khadrawy", "cairo-haret-sahafa"]),
  junction("cairo-junction-hara-khadrawy-ramsis", "cairo-er-7", ["cairo-ramses", "cairo-haret-khadrawy"]),
  junction("cairo-junction-hara-sahafa-champollion", "cairo-ed-5", ["cairo-champollion", "cairo-haret-sahafa"]),
  junction("cairo-junction-hara-sahafa-maamari", "cairo-h-sahafa-maamari", ["cairo-haret-sahafa", "cairo-haret-maamari"]),
  junction("cairo-junction-hara-sahafa-taha", "cairo-h-sahafa-taha", ["cairo-haret-sahafa", "cairo-haret-taha"]),
  junction("cairo-junction-hara-sahafa-riyad", "cairo-ed-7", ["cairo-ramses-approach", "cairo-haret-sahafa"]),
  junction("cairo-junction-hara-maamari-qasr", "cairo-qa-x-maamari", ["cairo-qasr-el-ainy", "cairo-haret-maamari"]),
  junction("cairo-junction-hara-maamari-ramsis", "cairo-rm-x-maamari", ["cairo-ramses", "cairo-haret-maamari"]),
  junction("cairo-junction-hara-taha-qasr", "cairo-qa-x-taha", ["cairo-qasr-el-ainy", "cairo-haret-taha"]),
  junction("cairo-junction-hara-taha-ramsis", "cairo-rm-x-taha", ["cairo-ramses", "cairo-haret-taha"]),
  junction("cairo-junction-hara-borg-gabalaya", "cairo-ia-3", ["cairo-el-gabalaya", "cairo-haret-borg"]),
  junction("cairo-junction-hara-borg-opera", "cairo-ib-3", ["cairo-opera-corridor", "cairo-haret-borg"]),
  junction("cairo-junction-hara-marsafi-saray", "cairo-iw-x-marsafi", ["cairo-saray-el-gezira", "cairo-haret-marsafi"]),
  junction("cairo-junction-hara-marsafi-gabalaya", "cairo-ia-5", ["cairo-el-gabalaya", "cairo-haret-marsafi"]),
  junction("cairo-junction-hara-marsafi-opera", "cairo-ib-5", ["cairo-opera-corridor", "cairo-haret-marsafi"]),
  junction("cairo-junction-hara-marsafi-island", "cairo-ie-5", ["cairo-nile-island-drive", "cairo-haret-marsafi"]),
  junction("cairo-junction-hara-ozoris-saray", "cairo-iw-6", ["cairo-saray-el-gezira", "cairo-haret-ozoris"]),
  junction("cairo-junction-hara-ozoris-gabalaya", "cairo-ia-6", ["cairo-el-gabalaya", "cairo-haret-ozoris"]),
  junction("cairo-junction-hara-ozoris-opera", "cairo-ib-6", ["cairo-opera-corridor", "cairo-haret-ozoris"]),
  junction("cairo-junction-hara-ozoris-island", "cairo-ie-6", ["cairo-nile-island-drive", "cairo-haret-ozoris"]),
  junction("cairo-junction-hara-mokhtar-gabalaya", "cairo-ia-1", ["cairo-el-gabalaya", "cairo-haret-mokhtar"]),
  junction("cairo-junction-hara-mokhtar-opera", "cairo-ib-1", ["cairo-opera-corridor", "cairo-haret-mokhtar"]),
  junction("cairo-junction-hara-mokhtar-island", "cairo-ie-1", ["cairo-nile-island-drive", "cairo-haret-mokhtar"]),
  junction("cairo-junction-hara-selim-saray", "cairo-iw-x-selim", ["cairo-saray-el-gezira", "cairo-haret-selim"]),
  junction("cairo-junction-hara-selim-gabalaya", "cairo-ia-x-selim", ["cairo-el-gabalaya", "cairo-haret-selim"]),
  junction("cairo-junction-hara-selim-opera", "cairo-ib-x-selim", ["cairo-opera-corridor", "cairo-haret-selim"]),
  junction("cairo-junction-hara-selim-island", "cairo-ie-x-selim", ["cairo-nile-island-drive", "cairo-haret-selim"]),
  junction("cairo-junction-hara-sad-west", "cairo-wo-x-sad", ["cairo-west-nile-street", "cairo-haret-sad"]),
  junction("cairo-junction-hara-sad-dokki", "cairo-wi-x-sad", ["cairo-dokki-nile-drive", "cairo-haret-sad"]),
  junction("cairo-junction-hara-gohar-west", "cairo-wo-1", ["cairo-west-nile-street", "cairo-haret-gohar"]),
  junction("cairo-junction-hara-gohar-dokki", "cairo-wi-1", ["cairo-dokki-nile-drive", "cairo-haret-gohar"]),
  junction("cairo-junction-hara-wasef-west", "cairo-wo-2", ["cairo-west-nile-street", "cairo-haret-wasef"]),
  junction("cairo-junction-hara-wasef-dokki", "cairo-wi-2", ["cairo-dokki-nile-drive", "cairo-haret-wasef"]),
  junction("cairo-junction-hara-refaei-west", "cairo-wo-4", ["cairo-west-nile-street", "cairo-haret-refaei"]),
  junction("cairo-junction-hara-refaei-dokki", "cairo-wi-4", ["cairo-dokki-nile-drive", "cairo-haret-refaei"]),
  junction("cairo-junction-hara-amer-west", "cairo-wo-6", ["cairo-west-nile-street", "cairo-haret-amer"]),
  junction("cairo-junction-hara-amer-dokki", "cairo-wi-6", ["cairo-dokki-nile-drive", "cairo-haret-amer"]),
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

export interface OrientedParcel {
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
 * True when a candidate's rotated footprint reaches any authored road or
 * pavement envelope, or the Sixth October scenic corridor. Pure — no push,
 * no read of `cairoBlocks` — so both `addRoadClearBlock` below and the
 * reviewed-closure validator (Section 12.3) can share one deterministic
 * road-clearance rule instead of two that could drift apart.
 */
const overlapsRoadOrScenicCorridor = (candidate: ProceduralBlock): boolean => {
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
  if (overlapsRoadEnvelope) return true;
  return orientedParcelsOverlap(
    orientedParcel(
      candidate.center,
      candidate.size,
      candidate.headingDeg ?? 0,
    ),
    sixthOctoberCorridor,
  );
};

/**
 * Reject a procedural parcel when its rotated footprint reaches any authored
 * road or pavement envelope. This makes rotated-block clearance a deterministic
 * consequence of the same road specification that creates lanes and surfaces,
 * instead of relying on a fragile list of hand-tuned parcel exceptions.
 */
const addRoadClearBlock = (candidate: ProceduralBlock): boolean => {
  if (overlapsRoadOrScenicCorridor(candidate)) return false;
  cairoBlocks.push(candidate);
  return true;
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

/**
 * Both Nile channels, in a night tone.
 *
 * The colours were `#2f7f91`/`#2d8295` — a bright daylight teal, authored when
 * this map ran in sun. They do not survive the switch to night, and not
 * because night is darker: `waterLayer`'s tile gain goes UP after dark
 * (`RIVER_TILE_GAIN_NIGHT` 0.85 against the day's 0.52, because the night sun
 * runs at half the intensity), so a colour tuned for the day rig comes back
 * off this map's brighter-than-NYC night rig as a glowing turquoise band —
 * the one thing in the city that did not look lit but *emitting*.
 *
 * Retuned to sit alongside the other night rivers rather than by taste: NYC's
 * `#24404d`/`#2f4a55` and Tokyo's `#1d2a3d` are what a river reads as at
 * night, which is mostly reflected sky. The green cast stays — the Nile is not
 * the Hudson — but the value drops to theirs. `color` is also what the minimap
 * and the expanded map paint the river in, and this is still comfortably
 * legible against their near-black sheet, exactly as NYC's is.
 */
const cairoWaterBodies: readonly WaterBody[] = [
  {
    id: "cairo-nile-west-channel",
    polygon: CAIRO_NILE_WEST_POLYGON,
    color: "#1e3f42",
    flowHeadingDeg: 180,
    bridgePortalSurfaceIds: ["cairo-al-galaa-bridge"],
  },
  {
    id: "cairo-nile-east-channel",
    polygon: CAIRO_NILE_EAST_POLYGON,
    color: "#1d4146",
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

/**
 * Venue, service and spawn anchors are FROZEN literals, not computed deals.
 *
 * They used to be dealt from a filtered, ordered lane list
 * (`lanesForAnchors[(index * 7 + 3) % length]` with a handful of named
 * overrides), which made every venue's position a function of the whole
 * lane census: adding one road — or one node to an existing road, which
 * renumbers that road's segment-indexed lane ids — silently re-dealt every
 * venue and vehicle gate on the map. The alley network needs exactly those
 * edits, so the deal as of 2026-08-16 (27 roads / 224 lanes) is pinned
 * here verbatim: same lane ids, same distances, byte-identical resolved
 * pack. A road edit that renumbers lanes must update these literals in the
 * same change — re-anchor each entry by its world position onto the same
 * road, never by guessing at segment arithmetic.
 */
const cairoServicePoints: readonly ServicePoint[] = [
  {
    id: "cairo-gas-garden-city",
    kind: "gas_station",
    anchor: anchor("cairo-qasr-el-ainy-2-forward-1", 16.496682233955028),
    footprint: point(12, 8),
    label: "Garden City Fuel",
    setbackM: 18.8,
  },
  {
    id: "cairo-gas-west-bank",
    kind: "gas_station",
    anchor: anchor("cairo-west-nile-street-5-forward-1", 118.46267802853994),
    footprint: point(12, 8),
    label: "Nile Bank Fuel",
    setbackM: 18.8,
  },
  {
    id: "cairo-repair-downtown",
    kind: "repair_shop",
    anchor: anchor("cairo-galaa-street-3-forward-1", 102.6316386873693),
    footprint: point(10, 8),
    label: "Downtown Motors",
    setbackM: 11.4,
  },
  {
    id: "cairo-repair-dokki",
    kind: "repair_shop",
    anchor: anchor("cairo-dokki-nile-drive-3-forward-1", 104.34588515886699),
    footprint: point(10, 8),
    label: "Dokki Auto Works",
    setbackM: 11.35,
  },
];

/**
 * Thirty venues across all five venue kinds. Residences alternate the two
 * residence models; offices and depots keep their flat-roofed Cairo blocks
 * (`office.glb`'s hipped roof is a European shape Cairo does not have —
 * NYC and London still use it, Cairo never).
 */
const cairoGigVenues: readonly GigVenue[] = [
  {
    id: "cairo-venue-01",
    kind: "restaurant",
    anchor: anchor("cairo-corniche-el-nil-4-forward-1", 51.20335254039153),
    footprint: point(14, 12),
    name: "Garden City Kitchen",
    setbackM: 15,
  },
  {
    id: "cairo-venue-02",
    kind: "shop",
    anchor: anchor("cairo-qasr-el-ainy-4-forward-1", 75.91965911100725),
    footprint: point(12, 10),
    name: "Nile Books",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-03",
    kind: "residence",
    anchor: anchor("cairo-simon-bolivar-2-forward-1", 90.55385138137416),
    footprint: point(14, 10),
    name: "Tahrir Residences",
    setbackM: 15,
    modelId: "cairo-residence-kay",
  },
  {
    id: "cairo-venue-04",
    kind: "office",
    anchor: anchor("cairo-talaat-harb-6-forward-1", 149.45902448497378),
    footprint: point(12, 12),
    name: "Downtown Exchange",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-05",
    kind: "depot",
    anchor: anchor("cairo-ramses-9-forward-1", 38.778762774923905),
    footprint: point(14, 10),
    name: "Gezira Dispatch",
    setbackM: 15,
    modelId: "cairo-depot",
  },
  {
    id: "cairo-venue-06",
    kind: "restaurant",
    anchor: anchor("cairo-galaa-street-5-forward-1", 63.44329871344446),
    footprint: point(12, 10),
    name: "Opera Terrace",
    setbackM: 15,
  },
  {
    id: "cairo-venue-07",
    kind: "shop",
    anchor: anchor("cairo-garden-city-south-3-forward-1", 72.2125193861483),
    footprint: point(14, 12),
    name: "Zamalek Grocers",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-08",
    kind: "residence",
    anchor: anchor("cairo-tahrir-approach-4-forward-2", 46.34174907145398),
    footprint: point(12, 10),
    name: "Corniche Apartments",
    setbackM: 15,
    modelId: "cairo-residence-quaternius",
  },
  {
    id: "cairo-venue-09",
    kind: "office",
    anchor: anchor("cairo-west-nile-street-7-forward-1", 154.04503594483953),
    footprint: point(14, 10),
    name: "Dokki Business Centre",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-10",
    kind: "depot",
    anchor: anchor("cairo-saray-el-gezira-2-forward-1", 90.48298465993933),
    footprint: point(12, 12),
    name: "Ramses Depot",
    setbackM: 15,
    modelId: "cairo-depot",
  },
  {
    id: "cairo-venue-11",
    kind: "restaurant",
    anchor: anchor("cairo-el-gabalaya-2-forward-1", 12.695955417333149),
    footprint: point(14, 10),
    name: "Lotus Cafe",
    setbackM: 15,
  },
  {
    id: "cairo-venue-12",
    kind: "shop",
    anchor: anchor("cairo-nile-island-drive-2-forward-1", 30.569894236154997),
    footprint: point(12, 10),
    name: "Champollion Market",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-13",
    kind: "residence",
    anchor: anchor("cairo-south-gezira-road-1-forward-1", 43.05270527651837),
    footprint: point(14, 12),
    name: "Museum View Flats",
    setbackM: 15,
    modelId: "cairo-residence-kay",
  },
  {
    id: "cairo-venue-14",
    kind: "office",
    anchor: anchor("cairo-zamalek-north-3-forward-1", 69.31251938614831),
    footprint: point(12, 10),
    name: "Bolivar Offices",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-15",
    kind: "depot",
    anchor: anchor("cairo-west-nile-street-5-forward-1", 172.7562022775164),
    footprint: point(14, 10),
    name: "Nile Courier Hub",
    setbackM: 15,
    modelId: "cairo-depot",
  },
  {
    id: "cairo-venue-16",
    kind: "restaurant",
    anchor: anchor("cairo-dokki-nile-drive-5-forward-1", 72.55076370782447),
    footprint: point(12, 12),
    name: "Saray Bistro",
    setbackM: 15,
  },
  {
    id: "cairo-venue-17",
    kind: "shop",
    anchor: anchor("cairo-corniche-el-nil-1-forward-1", 78.3104724343634),
    footprint: point(14, 10),
    name: "Gabalaya Corner Shop",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-18",
    kind: "residence",
    anchor: anchor("cairo-el-gabalaya-7-forward-1", 129.92786460186284),
    footprint: point(12, 10),
    name: "Opera Gardens Homes",
    setbackM: 15,
    modelId: "cairo-residence-quaternius",
  },
  {
    id: "cairo-venue-19",
    kind: "office",
    anchor: anchor("cairo-qasr-el-ainy-9-forward-1", 35.491811105532946),
    footprint: point(14, 12),
    name: "Agouza Workspace",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-20",
    kind: "depot",
    anchor: anchor("cairo-talaat-harb-3-forward-1", 117.39356881873897),
    footprint: point(12, 10),
    name: "West Bank Depot",
    setbackM: 15,
    modelId: "cairo-depot",
  },
  {
    id: "cairo-venue-21",
    kind: "restaurant",
    anchor: anchor("cairo-ramses-5-forward-1", 38.86719773658328),
    footprint: point(14, 10),
    name: "Tahrir Bakery",
    setbackM: 15,
  },
  {
    id: "cairo-venue-22",
    kind: "shop",
    anchor: anchor("cairo-galaa-street-2-forward-1", 10.785162522109303),
    footprint: point(12, 12),
    name: "Garden City Supplies",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-23",
    kind: "residence",
    anchor: anchor("cairo-galaa-street-10-forward-1", 124.6879991050149),
    footprint: point(14, 10),
    name: "Gezira Court",
    setbackM: 15,
    modelId: "cairo-residence-kay",
  },
  {
    id: "cairo-venue-24",
    kind: "office",
    anchor: anchor("cairo-tahrir-approach-3-forward-1", 92.07669985896014),
    footprint: point(12, 10),
    name: "Qasr El-Nil Offices",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-25",
    kind: "depot",
    anchor: anchor("cairo-west-nile-street-3-forward-1", 162.31303758878505),
    footprint: point(14, 12),
    name: "Cairo Dispatch Yard",
    setbackM: 15,
    modelId: "cairo-depot",
  },
  {
    id: "cairo-venue-26",
    kind: "restaurant",
    anchor: anchor("cairo-ramses-approach-1-forward-1", 85.66674731450837),
    footprint: point(12, 10),
    name: "Nile Terrace Cafe",
    setbackM: 15,
  },
  {
    id: "cairo-venue-27",
    kind: "shop",
    anchor: anchor("cairo-saray-el-gezira-6-forward-1", 100.53336443243137),
    footprint: point(14, 10),
    name: "Dokki Mini Market",
    setbackM: 15,
    modelId: "cairo-shop",
  },
  {
    id: "cairo-venue-28",
    kind: "residence",
    anchor: anchor("cairo-el-gabalaya-6-forward-1", 122.09115447074781),
    footprint: point(12, 12),
    name: "Zamalek Residences",
    setbackM: 15,
    modelId: "cairo-residence-quaternius",
  },
  {
    id: "cairo-venue-29",
    kind: "office",
    anchor: anchor("cairo-nile-island-drive-6-forward-1", 149.26360327945196),
    footprint: point(14, 10),
    name: "Corniche Trade House",
    setbackM: 15,
    modelId: "cairo-office-block",
  },
  {
    id: "cairo-venue-30",
    kind: "depot",
    anchor: anchor("cairo-zamalek-south-2-forward-1", 84.29116205154608),
    footprint: point(12, 10),
    name: "Central Cairo Depot",
    setbackM: 15,
    modelId: "cairo-depot",
  },
];

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
/** What kind of authored content an exclusion's `ownerId` names — the
 * three sources `cairoRoadsideExclusions` is built from below. */
export type RoadsideExclusionOwnerKind = "landmark" | "service" | "venue";

export interface RoadsideExclusion {
  /** Stable, unique per exclusion — `${ownerKind}:${ownerId}`. */
  readonly id: string;
  /** The landmark/service/venue id this exclusion protects. */
  readonly ownerId: string;
  readonly ownerKind: RoadsideExclusionOwnerKind;
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

/** Exported read-only for `tests/cairoVisualClosures.test.ts` — the
 * negative tests Section 12.3 item 6 requires need a real exclusion's
 * exact `raw`/`inflated` shapes to construct a candidate that provably
 * overlaps one but not the other, not hand-copied coordinates that could
 * silently drift from the content that derives them. */
export const cairoRoadsideExclusions: readonly RoadsideExclusion[] = [
  ...cairoLandmarks.map((landmark) => {
    const heading =
      landmark.headingDeg === undefined ? 0 : landmark.headingDeg - 90;
    const rect =
      landmark.kind === "park" && ROAD_DIVIDED_PARK_IDS.has(landmark.id)
        ? dividedParkExclusionRect(landmark)
        : { center: landmark.center, size: landmark.size };
    return {
      id: `landmark:${landmark.id}`,
      ownerId: landmark.id,
      ownerKind: "landmark" as const,
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
        id: `service:${service.id}`,
        ownerId: service.id,
        ownerKind: "service" as const,
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
        id: `venue:${venue.id}`,
        ownerId: venue.id,
        ownerKind: "venue" as const,
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
export interface RoadsideSideContext {
  readonly origin: WorldPoint;
  readonly outX: number;
  readonly outZ: number;
}

export interface CairoClosureValidation {
  readonly valid: boolean;
  /** Set only when `valid` is false — which check refused the candidate. */
  readonly reason?: string;
}

/**
 * The one pure validator every Cairo procedural block clears before it can
 * stand (visual-gap plan Section 12.3): world bounds, both Nile polygons,
 * every road/pavement envelope and the Sixth October scenic corridor
 * (`overlapsRoadOrScenicCorridor`), every `cairoRoadsideExclusions` raw
 * shape (landmark volume, exact service/venue lot — never bypassable), and
 * the sibling gap against every block already planned. `raw` overlap always
 * refuses regardless of `allowInflatedOverlapOwnerIds`; only a genuinely
 * same-side `inflated`-only conflict for a *listed* owner is forgiven — the
 * roadside passes below call this with no allow-list at all, so their
 * behaviour is unchanged (empty allow-list is the default, Section 12.3
 * item 5).
 *
 * No `inProtectedCorridor`/Nile-view check here on purpose: Section 12.2
 * warns against encoding specific coordinate ranges as permanent
 * exemptions, and this validator already refuses to build inside the exact
 * Nile polygons or a park/landmark's exact footprint — the water/park VIEW
 * itself is protected by never authoring a closure whose real camera fan
 * still shows water or lawn as the first hit, verified per site by a real
 * audit re-run (Section 9's own workflow), not by a static geometric rule
 * here that could silently drift from the actual shoreline.
 */
export const validateCairoClosureCandidate = (
  candidate: ProceduralBlock,
  options?: {
    readonly sideContext?: RoadsideSideContext;
    readonly allowInflatedOverlapOwnerIds?: ReadonlySet<string>;
  },
): CairoClosureValidation => {
  const sideContext = options?.sideContext;
  const allowInflatedOverlapOwnerIds = options?.allowInflatedOverlapOwnerIds;
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
    return { valid: false, reason: "world-bound" };
  }
  if (
    parcelIntersectsPolygon(parcel, CAIRO_NILE_WEST_POLYGON) ||
    parcelIntersectsPolygon(parcel, CAIRO_NILE_EAST_POLYGON)
  ) {
    return { valid: false, reason: "water" };
  }
  const blockedExclusion = cairoRoadsideExclusions.find((exclusion) => {
    if (!orientedParcelsOverlap(parcel, exclusion.inflated)) return false;
    if (orientedParcelsOverlap(parcel, exclusion.raw)) return true;
    // Margin-only contact: honour it only when the exclusion's body reaches
    // meaningfully past the centreline toward this parcel. A body across the
    // road — or grazing the carriageway itself — is separated by the road;
    // the raw-overlap check above still refuses genuine contact.
    const wouldReject =
      !sideContext ||
      (() => {
        const nearest = nearestPointOnOrientedParcel(
          exclusion.raw,
          candidate.center,
        );
        return (
          (nearest.x - sideContext.origin.x) * sideContext.outX +
            (nearest.z - sideContext.origin.z) * sideContext.outZ >
          1.5
        );
      })();
    if (!wouldReject) return false;
    // Inflated-only, same-side conflict: forgivable only for a listed owner.
    return !allowInflatedOverlapOwnerIds?.has(exclusion.ownerId);
  });
  if (blockedExclusion) {
    return { valid: false, reason: `exclusion:${blockedExclusion.id}` };
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
    return { valid: false, reason: "sibling-block" };
  }
  if (overlapsRoadOrScenicCorridor(candidate)) {
    return { valid: false, reason: "road-or-corridor" };
  }
  return { valid: true };
};

const addCairoRoadsideBlock = (
  candidate: ProceduralBlock,
  sideContext?: RoadsideSideContext,
): boolean => {
  if (!validateCairoClosureCandidate(candidate, { sideContext }).valid) {
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
// Exported for the renderer's promenade decor (generatePromenadeDecor), which
// dresses exactly these sides; the kerb tests keep their own literal copy so
// a change here is a two-place decision.
export const CAIRO_OPEN_WATERFRONT_SIDES: Readonly<
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

/**
 * True when `ownerId` names a real `cairoRoadsideExclusions` entry — the
 * check `addReviewedCairoClosure` uses for Section 12.3 item 5's "a closure
 * listing an unknown owner is a hard error." Exported and pure so a test
 * can prove the check itself is correct without triggering the throw
 * through the shared, mutating `cairoBlocks` pipeline.
 */
export const cairoClosureOwnerIsKnown = (ownerId: string): boolean =>
  cairoRoadsideExclusions.some((exclusion) => exclusion.ownerId === ownerId);

/**
 * A reviewed, hand-authored closure the audit-driven review process
 * (Section 12.3) found necessary — never a general second rank over every
 * kerb. Every field is explicit and testable rather than inferred, so a
 * closure documents exactly what problem it solves and why it was allowed
 * past an exclusion, if it was. `treatment` names the Section 12.10
 * treatment-ladder rung this closure landed on; `baselineFailureIds`
 * records the real audit failure/blob ids it closes, so a later re-audit
 * can confirm the fix still matches what it was built for.
 */
export interface CairoVisualClosureSpec {
  readonly id: string;
  readonly sourceRoadId: string;
  readonly side: -1 | 1;
  readonly causeCode: string;
  readonly treatment:
    | "immediate-wall"
    | "sliver"
    | "deep-backdrop"
    | "land-edge-wall"
    | "park-backdrop";
  readonly block: ProceduralBlock;
  readonly baselineFailureIds: readonly string[];
  readonly allowInflatedOverlapOwnerIds?: ReadonlySet<string>;
  readonly sideContext?: RoadsideSideContext;
}

/**
 * Validates then inserts one reviewed closure, in that order — a closure
 * that cannot actually be placed documents nothing, so this throws rather
 * than silently dropping it (Section 12.3 item 5's hard-error requirement,
 * extended the same way to a closure that fails the ordinary validator: a
 * `CAIRO_VISUAL_CLOSURES` entry is reviewed content, not a best-effort
 * generator retry, and a silently-skipped one would read as covered when
 * it is not).
 */
const addReviewedCairoClosure = (spec: CairoVisualClosureSpec): void => {
  for (const ownerId of spec.allowInflatedOverlapOwnerIds ?? []) {
    if (!cairoClosureOwnerIsKnown(ownerId)) {
      throw new Error(
        `cairo.ts: reviewed closure "${spec.id}" allow-lists unknown owner "${ownerId}" — no cairoRoadsideExclusions entry has that ownerId`,
      );
    }
  }
  const result = validateCairoClosureCandidate(spec.block, {
    sideContext: spec.sideContext,
    allowInflatedOverlapOwnerIds: spec.allowInflatedOverlapOwnerIds,
  });
  if (!result.valid) {
    throw new Error(
      `cairo.ts: reviewed closure "${spec.id}" failed validation (${result.reason}) — fix its geometry or drop it rather than let it silently not build`,
    );
  }
  addRoadClearBlock(spec.block);
};

/**
 * The reviewed closure layer (visual-gap plan Section 12.3), applied after
 * both the slot and gap-fill passes above finish populating `cairoBlocks` —
 * a finite, reviewed third rank, never a global second pass over every
 * hidden parcel interior. Empty today; populated per P0/P1 site (plan
 * Sections 12.4-12.9) as each is investigated and closed against a real
 * camera-fan audit re-run, the same workflow proven across London/NYC.
 */
export const CAIRO_VISUAL_CLOSURES: readonly CairoVisualClosureSpec[] = [
  // East land perimeter, Al-Galaa north/east corner (visual-gap plan
  // Section 12.5, P0). Al-Galaa's own final segment runs (760,620) to
  // (855,850) — a short diagonal run into the map's NE corner, where the
  // world edge (x=885) closes in from the east. The slot pass's own
  // `cairo-galaa-street-roadside-8-3-right` (a real cairo-downtown tower,
  // same road heading, AABB x=833..875 z=765..838) covers most of the
  // road's east side, but its own reach stops ~10 m short of the usable
  // world bound (881) the whole way along, and stops entirely past
  // z=838 while the road itself continues to z=850. A real camera-fan
  // re-audit found `urban_world_edge` failures (seeing straight through
  // to x=903, past the world edge) all along that residual sliver, eye z
  // 785-853 — not the systemic ~70 m distant-void pattern every other
  // failure near this road shows. Section 12.5 names this site as
  // "affected by cairo-venue-23", whose real exclusion (center ~823,729)
  // sits 120+ m away and does not actually conflict here — verified
  // directly, not assumed from the plan's own prose.
  //
  // Four short land-edge-wall pieces, not one long block: `facadeGridCells`
  // caps every `ProceduralBlock` at ~9 cells regardless of its length (the
  // count comes from `density` alone), so a single 76 m block collapsed to
  // just 2-3 real buildings with 20-37 m open gaps between them — the
  // first attempt at one long block only cut failures 268 (down from a
  // corner-cap's own 494->268) before this was diagnosed. Every standard
  // roadside block in this file keeps its long dimension in `size.x` and
  // rotates it into place with `headingDeg` (see the slot pass's own
  // `pieceFor` above: "`headingDeg` puts local +x along the carriageway");
  // these four pieces follow the same convention with `headingDeg: -90` so
  // local +x runs along world +z, each short enough (~18 m) that its own
  // ~3-column spread tiles with only ~1 m gaps.
  {
    id: "cairo-galaa-ne-land-edge-wall-1",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-1",
      center: point(878, 789),
      size: point(18, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  {
    id: "cairo-galaa-ne-land-edge-wall-2",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-2",
      center: point(878, 808.33),
      size: point(18, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  {
    id: "cairo-galaa-ne-land-edge-wall-3",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-3",
      center: point(878, 827.67),
      size: point(18, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  {
    id: "cairo-galaa-ne-land-edge-wall-4",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-4",
      center: point(878, 846.85),
      size: point(18.3, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  // The four pieces above (span z=780-856) still left oblique wide-FOV rays
  // curling around the wall's own north tip toward the map's NE corner —
  // a live re-audit found their eye z stayed within 780-856 but their
  // target reached z up to 902, i.e. the ray crosses x=878 north of where
  // the wall stopped. Two more pieces continuing the same wall to z=897
  // (validateCairoClosureCandidate's own road/corridor check already
  // covers the Sixth October scenic corridor, so a candidate that got
  // this far passed it for real, not by assumption) close that. This piece
  // starts at 857.2, 1.2 m past piece 4's own end (856) rather than the
  // usual 2 m gap the other seams use: a first attempt at 858 left a 2 m
  // seam one oblique ray threaded at z~857.05, caught only by a re-audit,
  // not the geometry math alone.
  {
    id: "cairo-galaa-ne-land-edge-wall-5",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-5",
      center: point(878, 866.625),
      size: point(19.15, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  {
    id: "cairo-galaa-ne-land-edge-wall-6",
    sourceRoadId: "cairo-galaa-street",
    side: 1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-galaa-ne-land-edge-wall-6",
      center: point(878, 888),
      size: point(18, 4),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-galaa-street/seg-7"],
  },
  // South land perimeter, Dokki South's own west end (visual-gap plan
  // Section 12.6, P0). Of the section's four named ranges, three (both
  // Garden City South spans and South Gezira Road) are systemic-only,
  // confirmed by a real audit: every failure there sits at the ~70 m
  // distant-void distance every other systemic gap in this city shows, not
  // a real local miss — no code needed, same conclusion as Section 12.4's
  // Tahrir Square. Dokki South's own west end was real: 162
  // `urban_world_edge` failures (eye z -857..-822, target x=-903 past the
  // world edge) where `cairo-dokki-south` and `cairo-west-nile-street`
  // both terminate at their shared junction (-840,-850), and the nearest
  // real content — the asset-slot `cairo-west-nile-street-roadside-1-1-
  // left` building-set block — doesn't reach south of roughly z=-842.
  // Three land-edge-wall pieces close most of it (162->14, verified by a
  // real re-audit, not the geometry alone): `addRoadClearBlock`'s road/
  // corridor check treats a road's own endpoint generously (candidate
  // half-extent plus the road's clearance, in the candidate's own rotated
  // frame — see `overlapsRoadOrScenicCorridor` above), which pushed every
  // piece here out to x=-870 rather than the x=-852 a naive read of the
  // gap would suggest.
  //
  // The remaining 14 (all one eye station at the road's own junction,
  // only ~30 m from this wall, dist 63.8-64.4 m) were investigated and
  // deliberately accepted rather than chased further: every one crosses
  // x=-870 inside an existing piece's own ~1-2 m inter-building gap (the
  // same `facadeGridCells` per-cell jitter every roadside block in this
  // file has), not a seam or an open span. A same-bucket density bump
  // (0.82->0.9) changes nothing (`facadeGridCells`'s cell/column count is
  // a function of `Math.round(3 + density*7)`, constant across that whole
  // range); density=1 was tried and tried a *worse* tiling (2 buildings
  // instead of 3 — a higher cell count does not mean a denser result once
  // `frontageAxis`'s row-collapse dedup is in play). Closing every one of
  // these would mean hand-placing individual filler buildings pinned to
  // this seed's own random output, the same fragility the procedural
  // generator exists to avoid. Same call as the Cornmarket P0 precedent:
  // real, substantial, honestly-measured progress (494 city-wide, 162 on
  // this site, down to 14), not a silently accepted zero.
  {
    id: "cairo-dokki-sw-land-edge-wall",
    sourceRoadId: "cairo-dokki-south",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-dokki-sw-land-edge-wall",
      center: point(-870, -843),
      size: point(19, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-dokki-south/junction-sw"],
  },
  {
    id: "cairo-dokki-sw-land-edge-wall-2",
    sourceRoadId: "cairo-dokki-south",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-dokki-sw-land-edge-wall-2",
      center: point(-870, -862.95),
      size: point(18.5, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-dokki-south/junction-sw"],
  },
  {
    id: "cairo-dokki-sw-land-edge-wall-3",
    sourceRoadId: "cairo-dokki-south",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-dokki-sw-land-edge-wall-3",
      center: point(-870, -827.5),
      size: point(9, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "sandstone",
      heightRange: [10, 16],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-dokki-south/junction-sw"],
  },
  // West/north land perimeter (visual-gap plan Section 12.7, P0). Of the
  // section's four named ranges, two (West Nile Street near (-816,310) and
  // Agouza Approach near (-800,857), both at the WEST end of their own
  // roads) are systemic-only, confirmed by a near-field check. A third
  // apparent lead -- a cluster of `urban_world_edge` failures right at
  // Agouza Approach's own EAST end (-610,850), matching the general shape
  // of a real gap (positioned at a road's own endpoint, same as every
  // other real site this phase found) -- turned out to be the systemic
  // pattern in disguise: every one of its 70 records sits 324-520 m away
  // (checked directly, not assumed), nowhere near this plan's established
  // ~70 m systemic-distance signature but just as clearly not a local
  // miss. A first attempt built a small closure there before checking
  // this and was reverted once the real distances were checked -- a
  // reminder to run the near-field distance check BEFORE building
  // anything, not just when a fix doesn't seem to help.
  //
  // West Nile Street's own named range (roughly (-848,-446) to (-850,-423))
  // was real, and broader than named: 133 `urban_world_edge` failures
  // spanning eye z -470..-330, target x=-903 past the world's west edge.
  // The standard generator's own `cairo-west-nile-street-roadside-2-2-left`
  // and `-3-1-left` asset-slot blocks flank this stretch, but their real
  // buildings stop well short of each other (z=-410.9 and z=-369.6, a real
  // 41 m gap) *and* short of their own nominal block AABBs (whose gap is
  // only ~20 m) -- `validateCairoClosureCandidate`'s sibling check honours
  // the wider, nominal AABB (correctly: it cannot know an asset-slot
  // block's real building sparseness), so a new closure can only be
  // placed OUTSIDE both existing AABBs, not in the exact centre of the
  // real gap. Five `cairo-west-nile-street-mid-land-edge-wall-{1..5}`
  // pieces at x=-874 (validated clear of both neighbours' true footprints)
  // close 105 of the 133 (133->28). The residual 28 are the same class of
  // per-cell tiling noise as 12.6's own accepted residual: each piece here
  // keeps only 2 of its 9 candidate cells (not the usual 3), for reasons
  // not traced further -- accepted on the same Cornmarket-precedent basis
  // rather than chased past a second reasonable attempt.
  //
  // Ramses Approach's own named range ("sides near z~843..863") turned out
  // to be a SEAM in Section 12.5's own Al-Galaa closures, visible from a
  // different road's approach angle than the one those seams were tuned
  // against: `cairo-galaa-ne-land-edge-wall-4`/`-5` widened slightly
  // (837.7->838, 857.2->857.05 start) to close two ~1.2-1.3 m gaps,
  // 71->68. The residual 68 are, like Dokki South, per-building tiling
  // gaps inside the existing pieces themselves, not seams -- the same
  // deliberate-accept call, not chased further.
  {
    id: "cairo-west-nile-street-mid-land-edge-wall-1",
    sourceRoadId: "cairo-west-nile-street",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-west-nile-street-mid-land-edge-wall-1",
      center: point(-874, -462.5),
      size: point(19, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "cairo-west-bank-concrete",
      heightRange: [18, 40],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-west-nile-street/mid-gap"],
  },
  {
    id: "cairo-west-nile-street-mid-land-edge-wall-2",
    sourceRoadId: "cairo-west-nile-street",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-west-nile-street-mid-land-edge-wall-2",
      center: point(-874, -441.5),
      size: point(19, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "cairo-west-bank-concrete",
      heightRange: [18, 40],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-west-nile-street/mid-gap"],
  },
  {
    id: "cairo-west-nile-street-mid-land-edge-wall-3",
    sourceRoadId: "cairo-west-nile-street",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-west-nile-street-mid-land-edge-wall-3",
      center: point(-874, -420.5),
      size: point(19, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "cairo-west-bank-concrete",
      heightRange: [18, 40],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-west-nile-street/mid-gap"],
  },
  // Piece 4 of this run (center (-874, -399.5)) was RETIRED when the hara
  // network landed: splitting West Nile Street's segments re-tiled its
  // roadside strips and `cairo-west-nile-street-roadside-3-2-left` grew to
  // ~104 m, its southern corner now standing in (and occluding) exactly the
  // interval wall-4 closed — the validator's sibling check refuses the
  // overlap, correctly. The P7 visual-gap re-audit re-checks this seam.
  {
    id: "cairo-west-nile-street-mid-land-edge-wall-5",
    sourceRoadId: "cairo-west-nile-street",
    side: -1,
    causeCode: "boundary-rejection",
    treatment: "land-edge-wall",
    block: {
      id: "cairo-west-nile-street-mid-land-edge-wall-5",
      center: point(-874, -378.5),
      size: point(19, 8),
      headingDeg: -90,
      frontageAxis: "z",
      streetEdges: ["+z"],
      material: "cairo-west-bank-concrete",
      heightRange: [18, 40],
      density: 0.82,
    },
    baselineFailureIds: ["urban_world_edge:cairo-west-nile-street/mid-gap"],
  },
];

for (const closure of CAIRO_VISUAL_CLOSURES) {
  addReviewedCairoClosure(closure);
}

/**
 * Interior core blocks (Cairo reimagining): the building mass INSIDE the
 * hara-and-strip fabric. The roadside passes line kerbs and never fill a
 * block's middle, so every pocket deeper than a parcel used to stay bare —
 * the owner's "no empty blocks" brief is about exactly that ground.
 *
 * The entries were machine-generated offline (grid probe at 14 m pitch,
 * sizes 46x28 down to 28x18, aligned to the nearest road with a hashed
 * +/-3 deg jitter) and each was accepted only if it cleared
 * `validateCairoClosureCandidate` plus a rail-corridor check and a local
 * sibling check — then reviewed and pasted here as plain authored data.
 * Two zones are deliberately left open (the generator's own KEEP_OPEN):
 * Tahrir's ceremonial clearing and the museum forecourt, the polished
 * set-pieces that need air. The import-time loop below re-validates every
 * core and throws on the first failure, so surrounding content cannot
 * silently drift into one (the closure discipline, applied to interiors).
 *
 * Every core keeps the procedural facade grid (no `buildingSet`): interior
 * mass reads through gaps and over rooftops, and the boxes glaze all four
 * faces where a one-sided glb kit would show service backs down every
 * alley.
 */
interface CairoInteriorCore {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly headingDeg: number;
  readonly material: string;
  readonly heightRange: readonly [number, number];
}

const core = (
  x: number,
  z: number,
  w: number,
  d: number,
  headingDeg: number,
  material: string,
  heightRange: readonly [number, number],
): CairoInteriorCore => ({ x, z, w, d, headingDeg, material, heightRange });

const CAIRO_INTERIOR_CORES: readonly CairoInteriorCore[] = [
  core(-788, -816, 28, 18, 3, "cairo-west-bank-concrete", [16, 38]),
  core(-788, -690, 28, 18, -88, "cairo-west-bank-concrete", [16, 38]),
  core(-788, -508, 46, 28, -94.2, "cairo-west-bank-concrete", [16, 38]),
  core(-746, -816, 28, 18, -2, "cairo-west-bank-concrete", [16, 38]),
  core(-746, -424, 36, 24, 1, "cairo-west-bank-concrete", [16, 38]),
  core(-746, -354, 46, 28, 1, "cairo-west-bank-concrete", [16, 38]),
  core(-746, 528, 36, 24, -3, "cairo-west-bank-concrete", [16, 38]),
  core(-746, 612, 28, 18, 0, "cairo-west-bank-concrete", [16, 38]),
  core(-732, -886, 28, 18, 2, "cairo-west-bank-concrete", [16, 38]),
  core(-732, -746, 46, 28, -2, "cairo-west-bank-concrete", [16, 38]),
  core(-732, 52, 46, 28, 3.4, "cairo-west-bank-concrete", [16, 38]),
  core(-732, 808, 46, 28, 0, "cairo-west-bank-concrete", [16, 38]),
  core(-718, -662, 46, 28, 2, "cairo-west-bank-concrete", [16, 38]),
  core(-718, -186, 36, 24, -2, "cairo-west-bank-concrete", [16, 38]),
  core(-718, -116, 28, 18, 2, "cairo-west-bank-concrete", [16, 38]),
  core(-718, 892, 46, 28, 3, "cairo-west-bank-concrete", [16, 38]),
  core(-690, 808, 28, 18, 1, "cairo-west-bank-concrete", [16, 38]),
  core(-662, -690, 36, 24, -84.3, "cairo-west-bank-concrete", [16, 38]),
  core(-452, -522, 28, 18, -101.8, "cairo-gezira-cream", [13, 32]),
  core(-438, -690, 36, 24, -82, "cairo-gezira-cream", [13, 32]),
  core(-396, -466, 28, 18, -102.8, "cairo-gezira-cream", [13, 32]),
  core(-396, 10, 28, 18, -102, "cairo-gezira-cream", [13, 32]),
  core(-396, 108, 28, 18, 5.5, "cairo-gezira-cream", [13, 32]),
  core(-396, 136, 28, 18, -85.4, "cairo-gezira-cream", [13, 32]),
  core(-396, 612, 36, 24, 6.4, "cairo-gezira-cream", [13, 32]),
  core(-382, 38, 28, 18, 5.5, "cairo-gezira-cream", [13, 32]),
  core(-382, 654, 36, 24, -96.6, "cairo-gezira-cream", [13, 32]),
  core(-354, 878, 46, 28, -12.5, "cairo-gezira-cream", [13, 32]),
  core(-340, -690, 28, 18, -97.1, "cairo-gezira-cream", [13, 32]),
  core(-340, -578, 28, 18, -74.2, "cairo-gezira-cream", [13, 32]),
  core(-340, -214, 36, 24, -101.6, "cairo-gezira-cream", [13, 32]),
  core(-326, -886, 46, 28, 5.6, "cairo-gezira-cream", [13, 32]),
  core(-326, -662, 28, 18, 2.8, "cairo-gezira-cream", [13, 32]),
  core(-326, -536, 36, 24, -74.2, "cairo-gezira-cream", [13, 32]),
  core(-326, -494, 28, 18, -77.2, "cairo-gezira-cream", [13, 32]),
  core(-326, -284, 28, 18, -104.6, "cairo-gezira-cream", [13, 32]),
  core(-326, -130, 28, 18, -7.5, "cairo-gezira-cream", [13, 32]),
  core(-326, -88, 28, 18, -80.5, "cairo-gezira-cream", [13, 32]),
  core(-326, 234, 28, 18, -103.6, "cairo-gezira-cream", [13, 32]),
  core(-326, 360, 28, 18, -11.8, "cairo-gezira-cream", [13, 32]),
  core(-326, 766, 28, 18, -101.6, "cairo-gezira-cream", [13, 32]),
  core(-312, -690, 28, 18, -100.3, "cairo-gezira-cream", [13, 32]),
  core(-312, -466, 28, 18, -75.2, "cairo-gezira-cream", [13, 32]),
  core(-312, 136, 28, 18, -101.6, "cairo-gezira-cream", [13, 32]),
  core(-312, 472, 28, 18, -79.9, "cairo-gezira-cream", [13, 32]),
  core(-312, 794, 28, 18, -6.5, "cairo-gezira-cream", [13, 32]),
  core(-312, 878, 28, 18, -8.5, "cairo-gezira-cream", [13, 32]),
  core(-298, -746, 46, 28, -1, "cairo-gezira-cream", [13, 32]),
  core(-298, 38, 28, 18, -7.5, "cairo-gezira-cream", [13, 32]),
  core(-298, 248, 36, 24, -99.4, "cairo-gezira-cream", [13, 32]),
  core(-298, 374, 28, 18, -77.9, "cairo-gezira-cream", [13, 32]),
  core(-298, 528, 28, 18, -77.9, "cairo-gezira-cream", [13, 32]),
  core(-298, 612, 28, 18, -101.6, "cairo-gezira-cream", [13, 32]),
  core(-284, 164, 46, 28, -99.4, "cairo-gezira-cream", [13, 32]),
  core(-284, 206, 28, 18, -97.4, "cairo-gezira-cream", [13, 32]),
  core(-284, 794, 28, 18, -100.7, "cairo-gezira-cream", [13, 32]),
  core(-270, 122, 46, 28, -10.5, "cairo-gezira-cream", [13, 32]),
  core(-270, 612, 28, 18, -10.8, "cairo-gezira-cream", [13, 32]),
  core(-214, -690, 36, 24, -103.3, "cairo-gezira-cream", [13, 32]),
  core(-214, -578, 36, 24, -76.2, "cairo-gezira-cream", [13, 32]),
  core(-214, -536, 28, 18, -75.2, "cairo-gezira-cream", [13, 32]),
  core(-214, -242, 28, 18, -100.2, "cairo-gezira-cream", [13, 32]),
  core(-214, -200, 36, 24, -103.2, "cairo-gezira-cream", [13, 32]),
  core(-214, -116, 28, 18, 1.8, "cairo-gezira-cream", [13, 32]),
  core(-214, -88, 28, 18, -78.5, "cairo-gezira-cream", [13, 32]),
  core(-214, 304, 28, 18, -2.5, "cairo-gezira-cream", [13, 32]),
  core(-214, 388, 28, 18, -76.9, "cairo-gezira-cream", [13, 32]),
  core(-200, -746, 36, 24, 0, "cairo-gezira-cream", [13, 32]),
  core(-200, -508, 28, 18, -74.2, "cairo-gezira-cream", [13, 32]),
  core(-200, -326, 28, 18, -100.2, "cairo-gezira-cream", [13, 32]),
  core(-200, -284, 46, 28, -98.2, "cairo-gezira-cream", [13, 32]),
  core(-200, -46, 28, 18, -77.5, "cairo-gezira-cream", [13, 32]),
  core(-200, -4, 28, 18, -78.5, "cairo-gezira-cream", [13, 32]),
  core(-200, 206, 28, 18, -97.4, "cairo-gezira-cream", [13, 32]),
  core(-200, 416, 28, 18, -77.9, "cairo-gezira-cream", [13, 32]),
  core(-200, 458, 28, 18, -81.9, "cairo-gezira-cream", [13, 32]),
  core(-200, 794, 28, 18, -97.7, "cairo-gezira-cream", [13, 32]),
  core(-186, -690, 36, 24, -99.8, "cairo-gezira-cream", [13, 32]),
  core(-186, -564, 28, 18, -79.4, "cairo-gezira-cream", [13, 32]),
  core(-186, -466, 46, 28, -79.2, "cairo-gezira-cream", [13, 32]),
  core(-186, 24, 28, 18, -78.5, "cairo-gezira-cream", [13, 32]),
  core(-186, 136, 28, 18, -101.4, "cairo-gezira-cream", [13, 32]),
  core(-186, 500, 46, 28, -79.9, "cairo-gezira-cream", [13, 32]),
  core(-172, -536, 28, 18, -77.4, "cairo-gezira-cream", [13, 32]),
  core(-172, -368, 28, 18, -2.5, "cairo-gezira-cream", [13, 32]),
  core(-172, -200, 46, 28, 3.8, "cairo-gezira-cream", [13, 32]),
  core(-172, 52, 28, 18, -1.6, "cairo-gezira-cream", [13, 32]),
  core(-172, 178, 36, 24, -100.3, "cairo-gezira-cream", [13, 32]),
  core(-172, 220, 36, 24, -101.3, "cairo-gezira-cream", [13, 32]),
  core(-172, 430, 28, 18, -82.2, "cairo-gezira-cream", [13, 32]),
  core(-172, 542, 36, 24, -80.9, "cairo-gezira-cream", [13, 32]),
  core(-172, 626, 28, 18, -8.2, "cairo-gezira-cream", [13, 32]),
  core(-172, 794, 28, 18, -100, "cairo-gezira-cream", [13, 32]),
  core(-116, -690, 36, 24, -96.8, "cairo-gezira-cream", [13, 32]),
  core(52, -396, 28, 18, -90.4, "cairo-gezira-cream", [13, 32]),
  core(52, -242, 36, 24, -87.6, "cairo-gezira-cream", [13, 32]),
  core(52, -200, 28, 18, -84.6, "cairo-gezira-cream", [13, 32]),
  core(66, -774, 46, 28, -89.9, "cairo-garden-stucco", [12, 26]),
  core(66, -592, 46, 28, -90.6, "cairo-garden-stucco", [12, 26]),
  core(66, -550, 28, 18, -92.6, "cairo-garden-stucco", [12, 26]),
  core(66, -4, 46, 28, -86.2, "cairo-khedivial-stone", [18, 42]),
  core(122, 430, 28, 18, -90.9, "cairo-khedivial-stone", [18, 42]),
  core(136, -60, 28, 18, -87.2, "cairo-khedivial-stone", [18, 42]),
  core(136, -18, 28, 18, -87.2, "cairo-khedivial-stone", [18, 42]),
  core(136, 24, 28, 18, -87.2, "cairo-khedivial-stone", [18, 42]),
  core(150, 66, 36, 24, -11.1, "cairo-khedivial-stone", [18, 42]),
  core(150, 150, 36, 24, -6.1, "cairo-khedivial-stone", [18, 42]),
  core(150, 192, 46, 28, -87.7, "cairo-khedivial-stone", [18, 42]),
  core(150, 262, 36, 24, -87.7, "cairo-khedivial-stone", [18, 42]),
  core(150, 374, 28, 18, -8.6, "cairo-khedivial-stone", [18, 42]),
  core(150, 626, 28, 18, -4.8, "cairo-khedivial-stone", [18, 42]),
  core(150, 808, 28, 18, -91.9, "cairo-khedivial-stone", [18, 42]),
  core(164, -340, 28, 18, 12.2, "cairo-khedivial-stone", [18, 42]),
  core(164, -60, 36, 24, -89.2, "cairo-khedivial-stone", [18, 42]),
  core(164, -18, 36, 24, -92.2, "cairo-khedivial-stone", [18, 42]),
  core(164, 24, 36, 24, -90.2, "cairo-khedivial-stone", [18, 42]),
  core(164, 304, 28, 18, -7.6, "cairo-khedivial-stone", [18, 42]),
  core(164, 542, 28, 18, -4.8, "cairo-khedivial-stone", [18, 42]),
  core(192, -760, 28, 18, -91.1, "cairo-garden-stucco", [12, 26]),
  core(192, 388, 46, 28, -10.6, "cairo-khedivial-stone", [18, 42]),
  core(192, 626, 28, 18, -2.8, "cairo-khedivial-stone", [18, 42]),
  core(206, -466, 28, 18, 9.6, "cairo-garden-stucco", [12, 26]),
  core(206, -438, 28, 18, -79.8, "cairo-garden-stucco", [12, 26]),
  core(206, -354, 46, 28, 13.2, "cairo-garden-stucco", [12, 26]),
  core(206, 430, 36, 24, -93, "cairo-khedivial-stone", [18, 42]),
  core(206, 472, 36, 24, -91, "cairo-khedivial-stone", [18, 42]),
  core(206, 514, 36, 24, -92, "cairo-khedivial-stone", [18, 42]),
  core(206, 556, 36, 24, -6.8, "cairo-khedivial-stone", [18, 42]),
  core(206, 654, 28, 18, -92, "cairo-khedivial-stone", [18, 42]),
  core(206, 696, 36, 24, -91, "cairo-khedivial-stone", [18, 42]),
  core(206, 794, 28, 18, -90, "cairo-khedivial-stone", [18, 42]),
  core(220, -396, 36, 24, -75.8, "cairo-garden-stucco", [12, 26]),
  core(234, 276, 28, 18, -94.8, "cairo-khedivial-stone", [18, 42]),
  core(248, -242, 46, 28, -80.5, "cairo-khedivial-stone", [18, 42]),
  core(248, -200, 28, 18, -77.5, "cairo-khedivial-stone", [18, 42]),
  core(248, -158, 46, 28, -2.5, "cairo-khedivial-stone", [18, 42]),
  core(248, -60, 28, 18, -88.2, "cairo-khedivial-stone", [18, 42]),
  core(248, -18, 46, 28, -88.2, "cairo-khedivial-stone", [18, 42]),
  core(248, 24, 28, 18, -91.2, "cairo-khedivial-stone", [18, 42]),
  core(248, 66, 46, 28, -89.2, "cairo-khedivial-stone", [18, 42]),
  core(248, 164, 36, 24, -1.8, "cairo-khedivial-stone", [18, 42]),
  core(248, 304, 28, 18, -8.6, "cairo-khedivial-stone", [18, 42]),
  core(276, -620, 46, 28, -84.6, "cairo-garden-stucco", [12, 26]),
  core(276, -578, 28, 18, -89.6, "cairo-garden-stucco", [12, 26]),
  core(276, -60, 28, 18, -92.2, "cairo-khedivial-stone", [18, 42]),
  core(276, -18, 28, 18, -93.2, "cairo-khedivial-stone", [18, 42]),
  core(276, 24, 28, 18, -89.2, "cairo-khedivial-stone", [18, 42]),
  core(276, 66, 28, 18, -88.2, "cairo-khedivial-stone", [18, 42]),
  core(276, 192, 28, 18, -84.5, "cairo-khedivial-stone", [18, 42]),
  core(276, 248, 36, 24, -88.5, "cairo-khedivial-stone", [18, 42]),
  core(276, 290, 28, 18, -86.5, "cairo-khedivial-stone", [18, 42]),
  core(290, -816, 36, 24, -2, "cairo-garden-stucco", [12, 26]),
  core(290, 402, 36, 24, -85.3, "cairo-khedivial-stone", [18, 42]),
  core(290, 444, 36, 24, -92, "cairo-khedivial-stone", [18, 42]),
  core(290, 486, 36, 24, -91, "cairo-khedivial-stone", [18, 42]),
  core(290, 528, 36, 24, -91, "cairo-khedivial-stone", [18, 42]),
  core(290, 570, 28, 18, -5.8, "cairo-khedivial-stone", [18, 42]),
  core(290, 640, 28, 18, -5.8, "cairo-khedivial-stone", [18, 42]),
  core(290, 668, 28, 18, -89, "cairo-khedivial-stone", [18, 42]),
  core(290, 710, 46, 28, -91, "cairo-khedivial-stone", [18, 42]),
  core(290, 752, 28, 18, -87, "cairo-khedivial-stone", [18, 42]),
  core(290, 794, 46, 28, -93, "cairo-khedivial-stone", [18, 42]),
  core(304, -746, 28, 18, 3, "cairo-garden-stucco", [12, 26]),
  core(304, -564, 28, 18, 3.3, "cairo-garden-stucco", [12, 26]),
  core(304, -452, 28, 18, -76.8, "cairo-garden-stucco", [12, 26]),
  core(318, -648, 28, 18, 7.4, "cairo-garden-stucco", [12, 26]),
  core(318, 654, 28, 18, -80.6, "cairo-khedivial-stone", [18, 42]),
  core(318, 696, 28, 18, -82.6, "cairo-khedivial-stone", [18, 42]),
  core(318, 738, 28, 18, -76.6, "cairo-khedivial-stone", [18, 42]),
  core(332, -816, 36, 24, -3, "cairo-garden-stucco", [12, 26]),
  core(332, -480, 28, 18, 4.3, "cairo-garden-stucco", [12, 26]),
  core(332, -284, 36, 24, -77.5, "cairo-khedivial-stone", [18, 42]),
  core(332, -242, 28, 18, -77.5, "cairo-khedivial-stone", [18, 42]),
  core(332, 766, 28, 18, -78.6, "cairo-khedivial-stone", [18, 42]),
  core(332, 808, 46, 28, -3, "cairo-khedivial-stone", [18, 42]),
  core(346, -746, 28, 18, -2, "cairo-garden-stucco", [12, 26]),
  core(346, -214, 28, 18, -78.5, "cairo-khedivial-stone", [18, 42]),
  core(360, -298, 28, 18, 12.3, "cairo-khedivial-stone", [18, 42]),
  core(360, 94, 46, 28, -91.2, "cairo-khedivial-stone", [18, 42]),
  core(360, 136, 28, 18, -87.5, "cairo-khedivial-stone", [18, 42]),
  core(360, 234, 28, 18, -88.5, "cairo-khedivial-stone", [18, 42]),
  core(374, -816, 28, 18, 0, "cairo-garden-stucco", [12, 26]),
  core(374, -256, 46, 28, -129, "cairo-khedivial-stone", [18, 42]),
  core(374, 276, 46, 28, -86.5, "cairo-khedivial-stone", [18, 42]),
  core(374, 388, 28, 18, 11.1, "cairo-khedivial-stone", [18, 42]),
  core(374, 416, 28, 18, -82.3, "cairo-khedivial-stone", [18, 42]),
  core(388, -424, 28, 18, -89.7, "cairo-garden-stucco", [12, 26]),
  core(388, 556, 36, 24, -83.3, "cairo-khedivial-stone", [18, 42]),
  core(402, -298, 28, 18, -83, "cairo-khedivial-stone", [18, 42]),
  core(402, 430, 28, 18, 2.9, "cairo-khedivial-stone", [18, 42]),
  core(402, 514, 46, 28, -0.1, "cairo-khedivial-stone", [18, 42]),
  core(402, 640, 36, 24, 10, "cairo-khedivial-stone", [18, 42]),
  core(416, -158, 46, 28, -127, "cairo-khedivial-stone", [18, 42]),
  core(416, 94, 46, 28, -62.7, "cairo-khedivial-stone", [18, 42]),
  core(416, 290, 46, 28, 12.1, "cairo-khedivial-stone", [18, 42]),
  core(416, 388, 46, 28, 9.1, "cairo-khedivial-stone", [18, 42]),
  core(416, 542, 28, 18, 8, "cairo-khedivial-stone", [18, 42]),
  core(416, 668, 28, 18, -1, "cairo-khedivial-stone", [18, 42]),
  core(416, 738, 28, 18, 3, "cairo-khedivial-stone", [18, 42]),
  core(416, 766, 28, 18, -82.6, "cairo-khedivial-stone", [18, 42]),
  core(430, 136, 28, 18, -58.7, "cairo-khedivial-stone", [18, 42]),
  core(430, 808, 28, 18, 7.4, "cairo-khedivial-stone", [18, 42]),
  core(444, -200, 28, 18, -130, "cairo-khedivial-stone", [18, 42]),
  core(444, -46, 46, 28, -6.8, "cairo-khedivial-stone", [18, 42]),
  core(444, 416, 28, 18, -85.8, "cairo-khedivial-stone", [18, 42]),
  core(444, 514, 28, 18, 2.9, "cairo-khedivial-stone", [18, 42]),
  core(444, 626, 28, 18, 14, "cairo-khedivial-stone", [18, 42]),
  core(458, -746, 28, 18, -1, "cairo-garden-stucco", [12, 26]),
  core(458, -452, 28, 18, -86.7, "cairo-garden-stucco", [12, 26]),
  core(458, -172, 28, 18, -50.5, "cairo-khedivial-stone", [18, 42]),
  core(458, -144, 28, 18, -4.8, "cairo-khedivial-stone", [18, 42]),
  core(458, -4, 36, 24, -49.1, "cairo-khedivial-stone", [18, 42]),
  core(458, 542, 28, 18, -83.8, "cairo-khedivial-stone", [18, 42]),
  core(458, 654, 36, 24, -1, "cairo-khedivial-stone", [18, 42]),
  core(458, 738, 46, 28, 2, "cairo-khedivial-stone", [18, 42]),
  core(472, 276, 46, 28, 12.1, "cairo-khedivial-stone", [18, 42]),
  core(472, 794, 46, 28, 5.4, "cairo-khedivial-stone", [18, 42]),
  core(486, -816, 28, 18, -1, "cairo-garden-stucco", [12, 26]),
  core(486, -46, 28, 18, -13.9, "cairo-khedivial-stone", [18, 42]),
  core(486, 24, 28, 18, -61.7, "cairo-khedivial-stone", [18, 42]),
  core(486, 234, 36, 24, -63.4, "cairo-khedivial-stone", [18, 42]),
  core(500, -746, 28, 18, -2, "cairo-garden-stucco", [12, 26]),
  core(500, -270, 36, 24, -128.5, "cairo-khedivial-stone", [18, 42]),
  core(500, 738, 28, 18, -80, "cairo-khedivial-stone", [18, 42]),
  core(514, -620, 28, 18, 89.4, "cairo-garden-stucco", [12, 26]),
  core(514, -32, 28, 18, -10.9, "cairo-khedivial-stone", [18, 42]),
  core(514, 52, 36, 24, 1, "cairo-khedivial-stone", [18, 42]),
  core(514, 262, 28, 18, -63.4, "cairo-khedivial-stone", [18, 42]),
  core(514, 304, 28, 18, -16.9, "cairo-khedivial-stone", [18, 42]),
  core(528, -816, 28, 18, 1, "cairo-garden-stucco", [12, 26]),
  core(528, -242, 36, 24, -53.5, "cairo-khedivial-stone", [18, 42]),
  core(528, 388, 36, 24, -12.9, "cairo-khedivial-stone", [18, 42]),
  core(528, 430, 36, 24, -84.8, "cairo-khedivial-stone", [18, 42]),
  core(542, -886, 28, 18, -2, "cairo-garden-stucco", [12, 26]),
  core(542, -746, 28, 18, -1, "cairo-garden-stucco", [12, 26]),
  core(542, 514, 36, 24, -0.1, "cairo-khedivial-stone", [18, 42]),
  core(542, 542, 36, 24, 3.5, "cairo-khedivial-stone", [18, 42]),
  core(556, -424, 28, 18, -90, "cairo-garden-stucco", [12, 26]),
  core(556, -298, 46, 28, -27.3, "cairo-khedivial-stone", [18, 42]),
  core(556, -32, 46, 28, -12.9, "cairo-khedivial-stone", [18, 42]),
  core(556, 52, 36, 24, 3, "cairo-khedivial-stone", [18, 42]),
  core(556, 150, 36, 24, -3, "cairo-khedivial-stone", [18, 42]),
  core(556, 612, 28, 18, 2.5, "cairo-khedivial-stone", [18, 42]),
  core(556, 640, 28, 18, -80, "cairo-khedivial-stone", [18, 42]),
  core(570, 402, 36, 24, -15.9, "cairo-khedivial-stone", [18, 42]),
  core(570, 430, 28, 18, 0.9, "cairo-khedivial-stone", [18, 42]),
  core(570, 668, 28, 18, -1, "cairo-khedivial-stone", [18, 42]),
  core(570, 738, 28, 18, -83, "cairo-khedivial-stone", [18, 42]),
  core(584, -564, 28, 18, -107.5, "cairo-garden-stucco", [12, 26]),
  core(584, -522, 36, 24, -104.5, "cairo-garden-stucco", [12, 26]),
  core(584, -438, 28, 18, 2.9, "cairo-garden-stucco", [12, 26]),
  core(584, -396, 36, 24, -29.3, "cairo-garden-stucco", [12, 26]),
  core(584, 10, 36, 24, -102.6, "cairo-khedivial-stone", [18, 42]),
  core(584, 514, 36, 24, 3.9, "cairo-khedivial-stone", [18, 42]),
  core(584, 542, 36, 24, 2.5, "cairo-khedivial-stone", [18, 42]),
  core(584, 780, 46, 28, -79, "cairo-khedivial-stone", [18, 42]),
  core(598, -606, 28, 18, -103.5, "cairo-garden-stucco", [12, 26]),
  core(598, -158, 46, 28, -48.5, "cairo-khedivial-stone", [18, 42]),
  core(598, 612, 36, 24, 1.5, "cairo-khedivial-stone", [18, 42]),
  core(598, 738, 28, 18, 3, "cairo-khedivial-stone", [18, 42]),
  core(612, -368, 28, 18, -28.3, "cairo-garden-stucco", [12, 26]),
  core(612, -116, 28, 18, -50.5, "cairo-khedivial-stone", [18, 42]),
  core(612, 654, 46, 28, 1, "cairo-khedivial-stone", [18, 42]),
  core(626, -438, 36, 24, -0.1, "cairo-garden-stucco", [12, 26]),
  core(626, 276, 46, 28, -89.4, "cairo-khedivial-stone", [18, 42]),
  core(626, 514, 28, 18, -66.1, "cairo-khedivial-stone", [18, 42]),
  core(626, 542, 28, 18, 1.5, "cairo-khedivial-stone", [18, 42]),
  core(626, 780, 46, 28, 3.4, "cairo-khedivial-stone", [18, 42]),
  core(640, -746, 28, 18, 2, "cairo-garden-stucco", [12, 26]),
  core(640, 150, 28, 18, -99.6, "cairo-khedivial-stone", [18, 42]),
  core(640, 206, 28, 18, -90.4, "cairo-khedivial-stone", [18, 42]),
  core(640, 318, 28, 18, -63.4, "cairo-khedivial-stone", [18, 42]),
  core(640, 612, 36, 24, 1.5, "cairo-khedivial-stone", [18, 42]),
  core(640, 738, 46, 28, 3, "cairo-khedivial-stone", [18, 42]),
  core(654, -186, 46, 28, -86.6, "cairo-khedivial-stone", [18, 42]),
  core(654, -116, 36, 24, -7.1, "cairo-khedivial-stone", [18, 42]),
  core(654, 654, 28, 18, 1, "cairo-khedivial-stone", [18, 42]),
  core(668, -438, 36, 24, 4.9, "cairo-garden-stucco", [12, 26]),
  core(668, -396, 46, 28, -93.3, "cairo-garden-stucco", [12, 26]),
  core(668, 10, 28, 18, -100.6, "cairo-khedivial-stone", [18, 42]),
  core(668, 52, 46, 28, -104.6, "cairo-khedivial-stone", [18, 42]),
  core(668, 150, 36, 24, -91.5, "cairo-khedivial-stone", [18, 42]),
  core(668, 206, 36, 24, -84.9, "cairo-khedivial-stone", [18, 42]),
  core(668, 248, 36, 24, -85.9, "cairo-khedivial-stone", [18, 42]),
  core(668, 290, 36, 24, -82.9, "cairo-khedivial-stone", [18, 42]),
  core(668, 780, 28, 18, 2.4, "cairo-khedivial-stone", [18, 42]),
  core(682, -746, 28, 18, -1, "cairo-garden-stucco", [12, 26]),
  core(682, 332, 36, 24, -84.9, "cairo-khedivial-stone", [18, 42]),
  core(682, 430, 28, 18, -67.1, "cairo-khedivial-stone", [18, 42]),
  core(682, 738, 28, 18, -2, "cairo-khedivial-stone", [18, 42]),
  core(696, 472, 36, 24, -71.1, "cairo-khedivial-stone", [18, 42]),
  core(710, 766, 36, 24, -71.2, "cairo-khedivial-stone", [18, 42]),
  core(752, -368, 46, 28, -94.3, "cairo-garden-stucco", [12, 26]),
  core(752, -158, 46, 28, -87.6, "cairo-khedivial-stone", [18, 42]),
];

for (const [index, entry] of CAIRO_INTERIOR_CORES.entries()) {
  const candidate: ProceduralBlock = {
    id: `cairo-core-${index + 1}`,
    center: point(entry.x, entry.z),
    size: point(entry.w, entry.d),
    headingDeg: entry.headingDeg,
    material: entry.material,
    heightRange: entry.heightRange,
    density: 0.5,
  };
  const result = validateCairoClosureCandidate(candidate);
  if (!result.valid) {
    throw new Error(
      `cairo.ts: interior core ${candidate.id} failed validation (${result.reason}) — regenerate the core list against the content that moved`,
    );
  }
  addRoadClearBlock(candidate);
}

/**
 * Spawn gates: the same freeze as the venue/service anchors above (see that
 * comment for why). The vehicle roles keep the old index arithmetic's
 * result — three dedicated patrol gates (7, 34, 58) so Cairo's police
 * presence never hangs on the ambient one-in-five patrol roll, plus buses,
 * taxis and vans at their dealt gates.
 */
const cairoSpawnPoints: readonly MapSpawnPoint[] = [
  { id: "cairo-player-1", kind: "player", anchor: anchor("cairo-qasr-el-ainy-1-forward-1", 65.02797789256041) },
  { id: "cairo-player-2", kind: "player", anchor: anchor("cairo-nile-island-drive-3-forward-1", 105.78316149261117) },
  { id: "cairo-player-3", kind: "player", anchor: anchor("cairo-dokki-nile-drive-4-forward-1", 143.00913403548475) },
  { id: "cairo-bus-1", kind: "vehicle", anchor: anchor("cairo-corniche-el-nil-1-forward-1", 54.81980214683493) },
  { id: "cairo-car-2", kind: "vehicle", anchor: anchor("cairo-corniche-el-nil-4-forward-1", 64.85525461836113) },
  { id: "cairo-car-3", kind: "vehicle", anchor: anchor("cairo-corniche-el-nil-7-forward-1", 122.67840094754963) },
  { id: "cairo-police-4", kind: "vehicle", anchor: anchor("cairo-qasr-el-ainy-4-forward-1", 110.08134085709322) },
  { id: "cairo-car-5", kind: "vehicle", anchor: anchor("cairo-qasr-el-ainy-7-forward-1", 156.90192822118155) },
  { id: "cairo-taxi-6", kind: "vehicle", anchor: anchor("cairo-simon-bolivar-1-forward-1", 42.37168866118036) },
  { id: "cairo-car-7", kind: "vehicle", anchor: anchor("cairo-simon-bolivar-5-forward-1", 76.09494069910296) },
  { id: "cairo-van-8", kind: "vehicle", anchor: anchor("cairo-talaat-harb-4-forward-1", 84.13703108619892) },
  { id: "cairo-car-9", kind: "vehicle", anchor: anchor("cairo-ramses-2-forward-1", 47.21076097687822) },
  { id: "cairo-bus-10", kind: "vehicle", anchor: anchor("cairo-ramses-5-forward-1", 88.10272265014046) },
  { id: "cairo-taxi-11", kind: "vehicle", anchor: anchor("cairo-ramses-8-forward-1", 49.913604450481486) },
  { id: "cairo-car-12", kind: "vehicle", anchor: anchor("cairo-ramses-14-forward-1", 101.82264236931786) },
  { id: "cairo-car-13", kind: "vehicle", anchor: anchor("cairo-galaa-street-4-forward-1", 103.89556506345087) },
  { id: "cairo-car-14", kind: "vehicle", anchor: anchor("cairo-galaa-street-8-forward-1", 131.3235439537349) },
  { id: "cairo-police-15", kind: "vehicle", anchor: anchor("cairo-garden-city-south-1-forward-1", 92.21650945652542) },
  { id: "cairo-taxi-16", kind: "vehicle", anchor: anchor("cairo-garden-city-south-4-forward-1", 42.23601502664967) },
  { id: "cairo-car-17", kind: "vehicle", anchor: anchor("cairo-tahrir-approach-3-forward-1", 58.32119067897588) },
  { id: "cairo-car-18", kind: "vehicle", anchor: anchor("cairo-tahrir-approach-4-forward-2", 44.48807830939357) },
  { id: "cairo-bus-19", kind: "vehicle", anchor: anchor("cairo-qasr-el-nil-street-3-forward-1", 12.551886525146315) },
  { id: "cairo-car-20", kind: "vehicle", anchor: anchor("cairo-qasr-el-nil-street-4-forward-2", 104.83163820760134) },
  { id: "cairo-taxi-21", kind: "vehicle", anchor: anchor("cairo-qasr-el-nil-street-6-forward-1", 34.0086496258343) },
  { id: "cairo-van-22", kind: "vehicle", anchor: anchor("cairo-ramses-approach-3-forward-1", 59.59163115322792) },
  { id: "cairo-car-23", kind: "vehicle", anchor: anchor("cairo-saray-el-gezira-3-forward-1", 107.76055324240026) },
  { id: "cairo-car-24", kind: "vehicle", anchor: anchor("cairo-saray-el-gezira-6-forward-1", 145.76764559406647) },
  { id: "cairo-car-25", kind: "vehicle", anchor: anchor("cairo-el-gabalaya-2-forward-1", 99.53655652066436) },
  { id: "cairo-police-26", kind: "vehicle", anchor: anchor("cairo-el-gabalaya-5-forward-1", 70.0139986002799) },
  { id: "cairo-car-27", kind: "vehicle", anchor: anchor("cairo-el-gabalaya-8-forward-1", 101.84070895275626) },
  { id: "cairo-bus-28", kind: "vehicle", anchor: anchor("cairo-nile-island-drive-5-forward-1", 122.67840094754963) },
  { id: "cairo-van-29", kind: "vehicle", anchor: anchor("cairo-nile-island-drive-8-forward-1", 146.7180201829856) },
  { id: "cairo-car-30", kind: "vehicle", anchor: anchor("cairo-south-gezira-road-3-forward-1", 75.23510832893129) },
];

/**
 * The Imbaba corridor (rail feature): an ENR mainline straight across the
 * map's north band at z=-720 — right past spawn — from the west bank
 * ("to Upper Egypt") over BOTH Nile channels on Imbaba-style spans, through
 * downtown's north edge toward Ramses station off-map east. Level crossings
 * (mazla'an) guard all eleven streets it crosses, Ramsis Street included —
 * every one generated from the measured lane centrelines. In reality the
 * Imbaba bridge sits ~5 km north of Tahrir; pulling it into frame is the
 * same compression this map already applies to Tahrir/Garden City/Gezira.
 * Stations along the line are x + 1005 (straight run from x=-1005).
 */
const CAIRO_RAIL_POINTS: readonly WorldPoint[] = [
  point(-1005, -720),
  point(1010, -720),
];

const CAIRO_RAIL_LINES: readonly RailLine[] = [
  {
    id: "eg-imbaba-corridor-run",
    points: CAIRO_RAIL_POINTS,
    corridorHalfWidthM: 4.5,
    crossingControlIds: [
      "eg-rail-x-west-nile",
      "eg-rail-x-dokki",
      "eg-rail-x-saray",
      "eg-rail-x-gabalaya",
      "eg-rail-x-opera",
      "eg-rail-x-nile-island",
      "eg-rail-x-corniche",
      "eg-rail-x-qasr-el-ainy",
      "eg-rail-x-talaat-harb",
      "eg-rail-x-ramses",
      "eg-rail-x-galaa",
    ],
    schedule: {
      mode: "through",
      speedMps: 14,
      trainLengthM: 65,
      // A through timetable alternates directions every half-headway on ONE
      // track, so the half-headway must exceed a full traversal —
      // (2015 + 65) / 14 ≈ 148.6 s — or the opposing trains meet head-on
      // mid-line (owner-reported at 210). 320/2 = 160 s leaves ~11 s of
      // clear track between an exit and the next opposing entry;
      // tests/railCorridors.test.ts now samples the whole cycle to prove
      // no two consists ever co-occupy the line.
      headwaySeconds: 320,
      warningLeadSeconds: 10,
      clearTrailSeconds: 2,
    },
    // Nile banks at z=-720: west channel x in [-580, -469] (stations
    // 425-536), east channel [-81, 44] (stations 924-1049). Spans hug the
    // waterline with ~7 m of bank each side — the first cut's 24 m
    // approaches marched girders across dry land and read as a wedge on the
    // bank (owner-reported).
    elevatedSpans: [
      { startM: 418, endM: 543, kind: "bridge" },
      { startM: 917, endM: 1056, kind: "bridge" },
    ],
    // ENR diesel in the fleet's deep blue with the yellow nose band, hauling
    // four box wagons — the classic mazla'an scene.
    consist: { kind: "diesel_freight", cars: 5, liveryHex: "#24518f", accentHex: "#e0b23c" },
  },
];

const cairoSurfaceById = (id: string): RoadSurface => {
  const surface = cairoRoadSurfaces.find((candidate) => candidate.id === id);
  if (!surface) throw new Error(`cairo rail crossing: unknown surface ${id}`);
  return surface;
};

const cairoRailCrossings = [
  ["eg-rail-x-west-nile", "cairo-west-nile-street"],
  ["eg-rail-x-dokki", "cairo-dokki-nile-drive"],
  ["eg-rail-x-saray", "cairo-saray-el-gezira"],
  ["eg-rail-x-gabalaya", "cairo-el-gabalaya"],
  ["eg-rail-x-opera", "cairo-opera-corridor"],
  ["eg-rail-x-nile-island", "cairo-nile-island-drive"],
  ["eg-rail-x-corniche", "cairo-corniche-el-nil"],
  ["eg-rail-x-qasr-el-ainy", "cairo-qasr-el-ainy"],
  ["eg-rail-x-talaat-harb", "cairo-talaat-harb"],
  ["eg-rail-x-ramses", "cairo-ramses"],
  ["eg-rail-x-galaa", "cairo-galaa-street"],
].map(([id, surfaceId]) =>
  buildRailCrossingControl({
    id,
    railPoints: CAIRO_RAIL_POINTS,
    surface: cairoSurfaceById(surfaceId),
    lanes: cairoLanes,
  }),
);
cairoControls.push(...cairoRailCrossings.map((crossing) => crossing.control));
cairoConflictZones.push(
  ...cairoRailCrossings.map((crossing) => crossing.conflictZone),
);

const cairoLaneGraph: LaneGraph = {
  nodes: cairoNodes,
  lanes: cairoLanes,
  controls: cairoControls,
  conflictZones: cairoConflictZones,
  spawnPoints: cairoSpawnPoints,
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
    // Carved around the Imbaba corridor last, same as Tokyo — no block can
    // stand on the right-of-way (tests/railCorridors.test.ts re-proves it).
    blocks: carveBlocksForRailCorridors(cairoBlocks, CAIRO_RAIL_LINES).blocks,
    railLines: CAIRO_RAIL_LINES,
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
  startSpawnId: "cairo-player-1",
  trafficSeed: 2601,
  scenarioClock: CAIRO_SCENARIO_CLOCK,
};
