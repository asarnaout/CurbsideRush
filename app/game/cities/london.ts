import type {
  ConflictZone,
  ProceduralLandmark,
  FreeDriveDefinition,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapPack,
  OfficialRuleReference,
  ProceduralBlock,
  RoadMarkingPath,
  RoadSurface,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WorldPoint,
  ScenarioClock,
} from "../types";
import { CONNECTOR_BLEND_RUN_M, buildLaneTrueGeometry } from "../laneConnectors";
import { PAVED_SIDEWALK_WIDTH_M } from "../visuals";
import {
  anchor,
  anchoredSpawn,
  approach,
  connectorConflictZones,
  control,
  distanceBetweenPoints,
  freeSpawn,
  installation,
  makeSpeedLimitForRoad,
  node,
  point,
  roadMarking,
  roadSurface,
} from "./cityAuthoringHelpers";

export const LONDON_CONTENT_REVIEWED_ON = "2026-07-11";

/**
 * Official references used by the London map. OpenStreetMap is kept
 * exclusively on the map source record below and is never used as a rule
 * authority.
 */
export const LONDON_RULE_REFERENCES: readonly OfficialRuleReference[] = [
  {
    id: "uk-london-highway-code-general",
    title:
      "The Highway Code — General rules, techniques and advice for drivers and riders (103–158)",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "following_distance",
      "lane_misuse",
      "restricted_lane",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-highway-code-road",
    title: "The Highway Code — Using the road (159–203)",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "missing_indicator",
      "unsafe_gap",
      "box_junction",
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-road-user-hierarchy",
    title: "The Highway Code — Introduction and hierarchy of road users",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/introduction",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "unsafe_gap",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-rbkc-20mph",
    title: "Borough-wide 20 mph speed limit",
    authority: "Royal Borough of Kensington and Chelsea",
    jurisdiction: "Kensington and Chelsea, London",
    url: "https://www.rbkc.gov.uk/streets-and-transport/road-safety/borough-wide-20mph-speed-limit",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: ["speeding"],
  },
  {
    id: "uk-london-tfl-20mph-order",
    title:
      "GLA Roads in Kensington and Chelsea — 20 mph Speed Limit Order 2023",
    authority: "Transport for London",
    jurisdiction: "Kensington and Chelsea, London",
    url: "https://foi.tfl.gov.uk/FOI-1947-2526/GLA_2023_0041%20-%20Order_Redacted.pdf",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: ["speeding"],
  },
  {
    id: "uk-london-tfl-driving-charges",
    title: "Pay to drive in London",
    authority: "Transport for London",
    jurisdiction: "London, United Kingdom",
    url: "https://tfl.gov.uk/modes/driving/pay-to-drive-in-london",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [],
  },
];

export const LONDON_SCENARIO_CLOCK: ScenarioClock = {
  weekday: "tue",
  minutesAfterMidnight: 8 * 60 + 30,
  label: "Tuesday · 08:30",
};

const roadIdForLane = (id: string): string => {
  if (id.startsWith("london-local") || id.startsWith("london-quiet") || id.startsWith("london-cromwell-local")) return "london-quiet-loop";
  if (id.startsWith("london-queen-gate")) return "london-queen-gate";
  if (id.startsWith("london-cromwell-east-1") || id.startsWith("london-cromwell-east-bus") || id.startsWith("london-cromwell-west-2")) return "london-cromwell-west";
  if (id.startsWith("london-cromwell-east-2") || id.startsWith("london-cromwell-west-1")) return "london-cromwell-east";
  if (id.startsWith("london-east-north")) return "london-east-road";
  if (id.startsWith("london-thurloe")) return "london-thurloe-place";
  if (id.startsWith("london-exhibition")) return "london-exhibition-road";
  return id;
};

const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "london-node-queen-gate-cromwell") {
    return "london-queen-gate-cromwell-conflict";
  }
  if (nodeId === "london-node-exhibition-cromwell") {
    return "london-cromwell-exhibition-conflict";
  }
  return `junction-${nodeId}`;
};

const londonNodes = {
  queenGateSouth: node("london-node-queen-gate-south", -108, -104),
  quietWestSouth: node("london-node-quiet-west-south", -164, -104),
  quietWestNorth: node("london-node-quiet-west-north", -164, -32),
  queenGateCromwell: node("london-node-queen-gate-cromwell", -108, -32),
  queenGateThurloe: node("london-node-queen-gate-thurloe", -108, 82),
  exhibitionCromwell: node("london-node-exhibition-cromwell", 42, -32),
  exhibitionMid: node("london-node-exhibition-mid", 42, 25),
  exhibitionThurloe: node("london-node-exhibition-thurloe", 42, 82),
  cromwellEast: node("london-node-cromwell-east", 150, -32),
  thurloeEast: node("london-node-thurloe-east", 150, 82),
  // Enlargement: Cromwell Road continues east toward Brompton, Queen's Gate
  // continues north toward Kensington Gardens.
  cromwellFarEast: node("london-node-cromwell-far-east", 330, -32),
  queenGateFarNorth: node("london-node-queen-gate-far-north", -108, 220),
  // Big enlargement: Gloucester Road (west), Kensington Road (north).
  gloucesterSouth: node("london-node-gloucester-south", -300, -104),
  gloucesterCromwell: node("london-node-gloucester-cromwell", -300, -32),
  gloucesterKensington: node("london-node-gloucester-kensington", -300, 220),
  kensingtonExhibition: node("london-node-kensington-exhibition", 42, 220),
};

/**
 * South-west expansion nodes: Chelsea, the King's Road, and the Earls-Court-ish
 * residential streets west of the museum quarter. Held apart from
 * `londonNodes` above only so it stays obvious at a glance which positions the
 * hand-authored quarter depends on — nothing above this line may move.
 *
 * Positions are deliberately irregular. London is not a grid, and a road that
 * runs 4 m off true over 300 m is what stops the map reading as one.
 */
const londonSouthWestNodes = {
  // The King's Road: a long, gently kinking spine from Fulham in the west to
  // Sloane Square in the east (the Sloane end is a frontier until Phase 5).
  kingsWest: node("london-node-kings-west", -1180, -392),
  kingsEarls: node("london-node-kings-earls", -812, -355),
  kingsBeaufort: node("london-node-kings-beaufort", -560, -330),
  kingsGloucester: node("london-node-kings-gloucester", -310, -294),
  kingsQueens: node("london-node-kings-queens", -100, -268),
  // Gloucester Road south of the quarter, and Drayton Gardens beside it.
  gloucesterMid: node("london-node-gloucester-mid", -306, -200),
  draytonMid: node("london-node-drayton-mid", -104, -186),
  // Earls Court: a north-south spine with Warwick Road out west, one crescent
  // hung off it and Old Brompton Road running back east to Gloucester Road.
  earlsNevern: node("london-node-earls-nevern", -814, 250),
  earlsNorth: node("london-node-earls-north", -812, 150),
  earlsCrescent: node("london-node-earls-crescent", -810, 10),
  earlsBrompton: node("london-node-earls-brompton", -808, -116),
  bromptonMid: node("london-node-brompton-mid", -560, -110),
  warwickNorth: node("london-node-warwick-north", -1152, 250),
  warwickMid: node("london-node-warwick-mid", -1148, 20),
  warwickSouth: node("london-node-warwick-south", -1164, -190),
  nevernMid: node("london-node-nevern-mid", -980, 258),
  crescent1: node("london-node-crescent-1", -880, 198),
  crescent2: node("london-node-crescent-2", -975, 192),
  crescent3: node("london-node-crescent-3", -1052, 140),
  crescent4: node("london-node-crescent-4", -1066, 54),
  crescent5: node("london-node-crescent-5", -990, -2),
  // Chelsea south of the King's Road: Royal Hospital Road with a mews loop
  // above it and two short links up to the high street.
  hospitalWest: node("london-node-hospital-west", -330, -420),
  hospitalMid: node("london-node-hospital-mid", -120, -405),
  hospitalEast: node("london-node-hospital-east", 120, -372),
  // The mews leaves the King's Road on the bearing that keeps it ~53 degrees
  // clear of Chelsea Manor Street's arm and rejoins Flood Street rather than
  // the King's Road: `buildPavementGraph` can only mitre a junction's rails
  // apart down to about 40 degrees (Cairo's tightest shipped corner), and
  // below that the surviving rail walks through the neighbouring carriageway.
  cheyne1: node("london-node-cheyne-1", -248, -359),
  cheyne2: node("london-node-cheyne-2", -164, -350),
  floodMid: node("london-node-flood-mid", -113, -360),
  sydneyMid: node("london-node-sydney-mid", 300, -120),
  // Sloane Circus, where the King's Road ends against Sydney Street and
  // Smith Street. The arm nodes sit on the running circle itself (radius 14
  // about the island at 250,-206) so an approach hands over to a ring arc
  // with no lateral step, and they are spread 80 degrees or more apart:
  // `buildPavementGraph` trims each rail back at a junction but never further
  // than the gap to the next one, and two arms closer than that leave the
  // ring's outer rail walking through the approach's carriageway.
  //
  // Bearings from the island: King's Road 260, Smith Street due south, Sydney
  // Street 30. Smith Street gained a node so its last run comes in straight
  // from the south rather than 42 degrees off the King's Road.
  sloaneArmKings: node("london-node-sloane-arm-kings", 236.2, -208.4),
  sloaneArmSmith: node("london-node-sloane-arm-smith", 250, -220),
  sloaneArmSydney: node("london-node-sloane-arm-sydney", 257, -193.9),
  // Smith Street leaves Royal Hospital Road 29 degrees off its bearing, not
  // 21: under 25 and `npcTurnSmoothness.test.ts` reads the pair as one road
  // continuing and holds the hand-over to a 30-degree heading step, which a
  // corner this tight cannot meet. Over 25 it is what it looks like — a turn.
  smithApproach: node("london-node-smith-approach", 212, -304),
};

/**
 * The river. Both embankments run about 48 m back from their own shore, and
 * the three bridges each span 236 m between two junctions that already exist
 * on the road either side — a bridge is only structurally real once it lands
 * somewhere.
 */
const londonRiverNodes = {
  // North bank: Chelsea Embankment, then Victoria Embankment past Westminster
  // and the Tower. The two meet head-on at `embankmentJoin`, which is a street
  // changing name rather than a junction.
  lotsMid: node("london-node-lots-mid", -1215, -490),
  chelseaEmbWest: node("london-node-chelsea-emb-west", -1240, -596),
  chelseaEmb1: node("london-node-chelsea-emb-1", -1000, -586),
  chelseaEmb2: node("london-node-chelsea-emb-2", -700, -566),
  // Oakley Street runs dead straight into Chelsea Manor Street's bearing
  // (9 degrees) rather than merely near it. `npcTurnSmoothness.test.ts`
  // treats anything under 25 degrees apart as one road continuing, and holds
  // the heading jolt across the shared node to 30 — two lanes each offset to
  // their own left cannot meet that unless the two runs are genuinely
  // parallel. Albert Bridge, and the river crossing with it, moved 33 m west
  // to put them there.
  albertNorth: node("london-node-albert-north", -347, -529),
  chelseaEmb3: node("london-node-chelsea-emb-3", -100, -484),
  embankmentJoin: node("london-node-embankment-join", 100, -455),
  victoriaEmb1: node("london-node-victoria-emb-1", 400, -412),
  westminsterNorth: node("london-node-westminster-north", 780, -364),
  victoriaEmb2: node("london-node-victoria-emb-2", 1020, -336),
  towerNorth: node("london-node-tower-north", 1260, -310),
  // South bank: the riverside spine, and a back street behind it.
  riverbankWest: node("london-node-riverbank-west", -1300, -820),
  riverbank1: node("london-node-riverbank-1", -1000, -812),
  albertSouth: node("london-node-albert-south", -347, -765),
  riverbank2: node("london-node-riverbank-2", 100, -690),
  riverbank3: node("london-node-riverbank-3", 600, -624),
  westminsterSouth: node("london-node-westminster-south", 780, -600),
  riverbank4: node("london-node-riverbank-4", 1020, -572),
  towerSouth: node("london-node-tower-south", 1260, -546),
  riverbankEast: node("london-node-riverbank-east", 1450, -528),
  batterseaWest: node("london-node-battersea-west", -1260, -935),
  battersea1: node("london-node-battersea-1", -880, -918),
  batterseaAlbert: node("london-node-battersea-albert", -347, -885),
  battersea2: node("london-node-battersea-2", 120, -816),
  batterseaNine: node("london-node-battersea-nine", 600, -756),
  battersea3: node("london-node-battersea-3", 1050, -706),
  batterseaEast: node("london-node-battersea-east", 1440, -664),
};

/**
 * Knightsbridge, Mayfair, the royal park and Westminster. Two more
 * roundabouts land here — Wellington Circus where five roads meet at the
 * park's corner, and Victoria Circus outside the palace — plus Parliament
 * Square, which is a roundabout whose arms are signalled rather than given
 * way to, because that is what the real one is.
 */
const londonCentreNodes = {
  // Knightsbridge east from the museum quarter, and Brompton Road up to it.
  knightsBrompton: node("london-node-knights-brompton", 430, 220),
  knightsSloane: node("london-node-knights-sloane", 560, 220),
  bromptonRise: node("london-node-brompton-rise", 370, 60),
  // Wellington Circus, radius 22 about (620,220). Five roads meet here in
  // life; four do on the ring, with Brompton Road joining Knightsbridge just
  // short of it.
  wellingtonArmKnights: node("london-node-wellington-arm-knights", 598, 220),
  wellingtonArmPark: node("london-node-wellington-arm-park", 621.3, 242),
  wellingtonArmPiccadilly: node("london-node-wellington-arm-piccadilly", 640.1, 229),
  wellingtonArmGrosvenor: node("london-node-wellington-arm-grosvenor", 616, 198.4),
  // Park Lane up the park's east side, Bayswater Road across its top, West
  // Carriage Drive down its west side.
  // Park Lane is dead straight from Wellington Circus to the park's north
  // east corner, and these two nodes sit exactly on that line. A bend of even
  // six degrees is enough to fail `npcTurnSmoothness` on a four-lane road:
  // the outer lane sits 4.9 m off centre and has to sweep all of it across
  // the six-metre junction blend.
  parkLaneMid: node("london-node-park-lane-mid", 620.7, 560),
  parkLaneOxford: node("london-node-park-lane-oxford", 620.4, 700),
  parkCornerNorthEast: node("london-node-park-corner-north-east", 620, 940),
  bayswaterMid: node("london-node-bayswater-mid", 200, 940),
  parkCornerNorthWest: node("london-node-park-corner-north-west", -300, 940),
  // Piccadilly east toward the West End (a frontier until the City lands).
  piccadillyMid: node("london-node-piccadilly-mid", 800, 300),
  piccadillyEast: node("london-node-piccadilly-east", 950, 380),
  // Regent Street's quadrant — the famous sweep, and the reason the West End
  // does not read as a grid. Four nodes, not two: the curve is the point.
  regent1: node("london-node-regent-1", 928, 430),
  regent2: node("london-node-regent-2", 914, 483),
  regent3: node("london-node-regent-3", 906, 538),
  regent4: node("london-node-regent-4", 907, 593),
  regent5: node("london-node-regent-5", 915, 647),
  regentOxford: node("london-node-regent-oxford", 930, 700),
  oxfordMid: node("london-node-oxford-mid", 800, 700),
  // Grosvenor Place down to Victoria Circus, radius 16 about (560,-60).
  grosvenorMid: node("london-node-grosvenor-mid", 590, 60),
  victoriaArmGrosvenor: node("london-node-victoria-arm-grosvenor", 563.9, -44.5),
  victoriaArmMall: node("london-node-victoria-arm-mall", 576, -58.7),
  victoriaArmBuckingham: node("london-node-victoria-arm-buckingham", 548, -70.5),
  // Buckingham Palace Road west to Sloane Circus's fourth arm.
  sloaneArmBuckingham: node("london-node-sloane-arm-buckingham", 263.5, -209.6),
  // Five degrees off the run either side of it, not eighteen: under 25 the
  // pair reads as one road continuing, and a 1.7 m lane offset cannot hand
  // over across a bend that sharp inside the 30-degree budget.
  buckingham1: node("london-node-buckingham-1", 400, -175),
  buckingham2: node("london-node-buckingham-2", 500, -140),
  // The Mall east, then Whitehall south to Parliament Square.
  mallMid: node("london-node-mall-mid", 700, -46),
  mallEast: node("london-node-mall-east", 800, -40),
  whitehallMid: node("london-node-whitehall-mid", 780, -200),
  // Parliament Square, radius 26 about (740,-296).
  parliamentArmWhitehall: node("london-node-parliament-arm-whitehall", 750, -272),
  parliamentArmBridge: node("london-node-parliament-arm-bridge", 753.2, -318.4),
  parliamentArmVictoria: node("london-node-parliament-arm-victoria", 714.1, -293.7),
  victoriaStreet1: node("london-node-victoria-street-1", 600, -275),
  victoriaStreet2: node("london-node-victoria-street-2", 505, -248),
};

/**
 * The City, the West End's east half and the Islington-ish north east. Bank
 * Circus is the fifth roundabout; Islington Circus the sixth. Oxford Street
 * and Euston Road close the network's northern loop, so nothing out here is
 * left as a frontier.
 */
const londonEastNodes = {
  // Oxford Street east, and the Soho/Fitzrovia link up to Euston Road.
  oxfordEast: node("london-node-oxford-east", 1040, 700),
  greatPortlandMid: node("london-node-great-portland-mid", 812, 830),
  eustonSoho: node("london-node-euston-soho", 820, 946),
  eustonMid: node("london-node-euston-mid", 900, 948),
  eustonEast: node("london-node-euston-east", 1180, 940),
  // Islington Circus, radius 13 about (1150,700).
  islingtonArmWest: node("london-node-islington-arm-west", 1137, 700),
  islingtonArmSouth: node("london-node-islington-arm-south", 1150.7, 687),
  islingtonArmNorth: node("london-node-islington-arm-north", 1151.3, 712.9),
  upperStreetMid: node("london-node-upper-street-mid", 1168, 850),
  // Bank Circus, radius 20 about (1180,120) — five roads in life, four on
  // the ring, spread 77 degrees or more apart.
  bankArmNorth: node("london-node-bank-arm-north", 1178.6, 139.9),
  bankArmEast: node("london-node-bank-arm-east", 1200, 118.6),
  bankArmSouth: node("london-node-bank-arm-south", 1183.1, 100.2),
  bankArmWest: node("london-node-bank-arm-west", 1160.3, 123.1),
  bishopsgate1: node("london-node-bishopsgate-1", 1165, 420),
  bishopsgate2: node("london-node-bishopsgate-2", 1170, 560),
  kingWilliamMid: node("london-node-king-william-mid", 1230, -120),
  londonWallMid: node("london-node-london-wall-mid", 1060, 368),
  cornmarketMid: node("london-node-cornmarket-mid", 1075, 180),
  leadenhallMid: node("london-node-leadenhall-mid", 1320, 105),
  leadenhallEast: node("london-node-leadenhall-east", 1430, 95),
  minoriesMid: node("london-node-minories-mid", 1400, -120),
  // Islington-ish brick terraces north east of the City.
  canonburyEast: node("london-node-canonbury-east", 1360, 820),
  shoreditchMid: node("london-node-shoreditch-mid", 1385, 660),
};

const londonNodeById = new Map(
  [
    ...Object.values(londonNodes),
    ...Object.values(londonSouthWestNodes),
    ...Object.values(londonRiverNodes),
    ...Object.values(londonCentreNodes),
    ...Object.values(londonEastNodes),
  ].map((item) => [item.id, item]),
);

/**
 * A generated London road: a polyline through authored nodes, plus how wide it
 * is and how many legal lanes it carries. Everything else — the lanes, their
 * lateral offsets, their successors, the carriageway surface and its
 * markings — is derived below.
 *
 * This is Cairo's `CairoRoadSpec` pattern rather than NYC's grid builder,
 * because London is not a grid and never was: its streets bend, meet at
 * whatever angle they meet at, and change name mid-run. What it is NOT is
 * hand-written lanes — at this size a lane with no legal continuation makes
 * its traffic vanish wherever the player happens to be looking (#128), and
 * nothing about the authored literal looks wrong. Derived, "every lane leads
 * somewhere legal" holds by construction.
 */
export interface LondonRoadSpec {
  readonly id: string;
  /** HUD/GPS/sign spelling. */
  readonly name: string;
  readonly nodeIds: readonly string[];
  /** Total legal lanes across the carriageway (even, unless one-way). */
  readonly laneCount: 1 | 2 | 4;
  readonly widthM: number;
  /**
   * Authored pavement width. Left off, a road takes the map's paved default —
   * which is right for a street and wrong for a bridge: the parapet collider
   * and the drawn rail both resolve the deck's footway through this field,
   * and NYC shipped a 3.4 m visual/collider mismatch by letting one side fall
   * back while the other did not.
   */
  readonly sidewalkWidthM?: number;
  /** Painted with a solid rather than dashed centre line, and signalled. */
  readonly arterial?: boolean;
  readonly oneWay?: "forward" | "reverse";
  /**
   * A circulating ring rather than a street. Its `nodeIds` are the arm nodes
   * in **clockwise** order (left-hand traffic circulates clockwise), and its
   * lanes are arcs about `center` rather than straight runs between nodes, so
   * the generic derivation below skips it and `londonRoundaboutArcs` builds
   * it instead.
   */
  readonly roundabout?: {
    readonly center: WorldPoint;
    readonly radiusM: number;
    readonly islandRadiusM: number;
    /** Arms get signals instead of give-ways — a gyratory rather than a
     * roundabout. */
    readonly signalled?: boolean;
  };
}

const road = (
  id: string,
  name: string,
  nodeIds: readonly string[],
  laneCount: 1 | 2 | 4,
  widthM: number,
  options: Omit<LondonRoadSpec, "id" | "name" | "nodeIds" | "laneCount" | "widthM"> = {},
): LondonRoadSpec => ({ id, name, nodeIds, laneCount, widthM, ...options });

/**
 * Stable authored order. Ids are never prefix-matched — `roadIdForLane` below
 * only ever sees the quarter's hand-authored lane ids, and every generated
 * lane carries its road id explicitly.
 */
export const LONDON_ROAD_SPECS: readonly LondonRoadSpec[] = [
  road("london-kings-road", "King's Road", ["london-node-kings-west", "london-node-kings-earls", "london-node-kings-beaufort", "london-node-kings-gloucester", "london-node-kings-queens", "london-node-sloane-arm-kings"], 2, 9.4, { arterial: true }),
  road("london-old-brompton", "Old Brompton Road", ["london-node-earls-brompton", "london-node-brompton-mid", "london-node-gloucester-south"], 2, 8.6, { arterial: true }),
  road("london-gloucester-south", "Gloucester Road", ["london-node-gloucester-south", "london-node-gloucester-mid", "london-node-kings-gloucester"], 2, 7.8),
  road("london-drayton-gardens", "Drayton Gardens", ["london-node-queen-gate-south", "london-node-drayton-mid", "london-node-kings-queens"], 2, 7.4),
  road("london-earls-court-road", "Earls Court Road", ["london-node-earls-nevern", "london-node-earls-north", "london-node-earls-crescent", "london-node-earls-brompton", "london-node-kings-earls"], 2, 8.6, { arterial: true }),
  road("london-warwick-road", "Warwick Road", ["london-node-warwick-north", "london-node-warwick-mid", "london-node-warwick-south", "london-node-kings-west"], 2, 8.6),
  road("london-nevern-place", "Nevern Place", ["london-node-warwick-north", "london-node-nevern-mid", "london-node-earls-nevern"], 2, 7.2),
  road("london-pembroke-crescent", "Pembroke Crescent", ["london-node-earls-north", "london-node-crescent-1", "london-node-crescent-2", "london-node-crescent-3", "london-node-crescent-4", "london-node-crescent-5", "london-node-earls-crescent"], 1, 7.4, { oneWay: "forward" }),
  road("london-royal-hospital-road", "Royal Hospital Road", ["london-node-hospital-west", "london-node-hospital-mid", "london-node-hospital-east"], 2, 8),
  road("london-cheyne-mews", "Cheyne Mews", ["london-node-kings-gloucester", "london-node-cheyne-1", "london-node-cheyne-2", "london-node-flood-mid"], 1, 6.8, { oneWay: "forward" }),
  road("london-chelsea-manor", "Chelsea Manor Street", ["london-node-kings-gloucester", "london-node-hospital-west"], 2, 7.4),
  road("london-flood-street", "Flood Street", ["london-node-kings-queens", "london-node-flood-mid", "london-node-hospital-mid"], 1, 7.2, { oneWay: "forward" }),
  // Two-way despite being a Chelsea back street: one-way northbound left the
  // westbound half of Royal Hospital Road's eastern segment with nothing
  // arriving at it, so no route could ever reach it.
  road("london-smith-street", "Smith Street", ["london-node-hospital-east", "london-node-smith-approach", "london-node-sloane-arm-smith"], 2, 7.6),
  road("london-sydney-street", "Sydney Street", ["london-node-cromwell-far-east", "london-node-sydney-mid", "london-node-sloane-arm-sydney"], 2, 7.8),

  // --- The river. -----------------------------------------------------------
  road("london-lots-road", "Lots Road", ["london-node-kings-west", "london-node-lots-mid", "london-node-chelsea-emb-west"], 2, 8),
  road("london-chelsea-embankment", "Chelsea Embankment", ["london-node-chelsea-emb-west", "london-node-chelsea-emb-1", "london-node-chelsea-emb-2", "london-node-albert-north", "london-node-chelsea-emb-3", "london-node-embankment-join"], 2, 10.4, { arterial: true }),
  road("london-victoria-embankment", "Victoria Embankment", ["london-node-embankment-join", "london-node-victoria-emb-1", "london-node-westminster-north", "london-node-victoria-emb-2", "london-node-tower-north"], 2, 11.4, { arterial: true }),
  road("london-oakley-street", "Oakley Street", ["london-node-hospital-west", "london-node-albert-north"], 2, 8),
  // Each bridge is ONE spec spanning both banks. Two specs meeting at a bank
  // mint two disconnected nodes at what looks like one junction, and the deck
  // then leads nowhere.
  road("london-albert-bridge", "Albert Bridge", ["london-node-albert-north", "london-node-albert-south"], 2, 9, { sidewalkWidthM: 2.4 }),
  road("london-westminster-bridge", "Westminster Bridge", ["london-node-westminster-north", "london-node-westminster-south"], 2, 12, { sidewalkWidthM: 3.4, arterial: true }),
  road("london-tower-bridge", "Tower Bridge", ["london-node-tower-north", "london-node-tower-south"], 2, 11, { sidewalkWidthM: 3, arterial: true }),
  road("london-riverbank", "Riverbank Road", ["london-node-riverbank-west", "london-node-riverbank-1", "london-node-albert-south", "london-node-riverbank-2", "london-node-riverbank-3", "london-node-westminster-south", "london-node-riverbank-4", "london-node-tower-south", "london-node-riverbank-east"], 2, 10.4, { arterial: true }),
  road("london-battersea-road", "Battersea Park Road", ["london-node-battersea-west", "london-node-battersea-1", "london-node-battersea-albert", "london-node-battersea-2", "london-node-battersea-nine", "london-node-battersea-3", "london-node-battersea-east"], 2, 8.6),
  road("london-lombard-lane", "Lombard Lane", ["london-node-riverbank-west", "london-node-battersea-west"], 2, 7.4),
  road("london-parkgate", "Parkgate Road", ["london-node-albert-south", "london-node-battersea-albert"], 2, 7.6),
  road("london-nine-elms", "Nine Elms Lane", ["london-node-riverbank-3", "london-node-battersea-nine"], 2, 7.6),
  road("london-tooley-street", "Tooley Street", ["london-node-battersea-east", "london-node-riverbank-east"], 2, 7.6),

  // --- Knightsbridge, Mayfair, the park and Westminster. ---------------------
  road("london-knightsbridge", "Knightsbridge", ["london-node-kensington-exhibition", "london-node-knights-brompton", "london-node-knights-sloane", "london-node-wellington-arm-knights"], 2, 10.4, { arterial: true }),
  road("london-brompton-road", "Brompton Road", ["london-node-cromwell-far-east", "london-node-brompton-rise", "london-node-knights-brompton"], 2, 10.4, { arterial: true }),
  road("london-park-lane", "Park Lane", ["london-node-wellington-arm-park", "london-node-park-lane-mid", "london-node-park-lane-oxford", "london-node-park-corner-north-east"], 4, 13.6, { arterial: true }),
  road("london-bayswater", "Bayswater Road", ["london-node-park-corner-north-west", "london-node-bayswater-mid", "london-node-park-corner-north-east"], 2, 10.4, { arterial: true }),
  road("london-park-west", "West Carriage Drive", ["london-node-gloucester-kensington", "london-node-park-corner-north-west"], 2, 9),
  road("london-piccadilly", "Piccadilly", ["london-node-wellington-arm-piccadilly", "london-node-piccadilly-mid", "london-node-piccadilly-east"], 2, 10.4, { arterial: true }),
  road("london-grosvenor", "Grosvenor Place", ["london-node-wellington-arm-grosvenor", "london-node-grosvenor-mid", "london-node-victoria-arm-grosvenor"], 2, 9.6),
  road("london-buckingham-palace-road", "Buckingham Palace Road", ["london-node-sloane-arm-buckingham", "london-node-buckingham-1", "london-node-buckingham-2", "london-node-victoria-arm-buckingham"], 2, 9.6),
  road("london-mall", "The Mall", ["london-node-victoria-arm-mall", "london-node-mall-mid", "london-node-mall-east"], 2, 10.4, { arterial: true }),
  road("london-whitehall", "Whitehall", ["london-node-mall-east", "london-node-whitehall-mid", "london-node-parliament-arm-whitehall"], 2, 10.4, { arterial: true }),
  road("london-bridge-street", "Bridge Street", ["london-node-parliament-arm-bridge", "london-node-westminster-north"], 2, 10.4),
  road("london-regent", "Regent Street", ["london-node-piccadilly-east", "london-node-regent-1", "london-node-regent-2", "london-node-regent-3", "london-node-regent-4", "london-node-regent-5", "london-node-regent-oxford"], 2, 10.4, { arterial: true }),
  road("london-oxford-street", "Oxford Street", ["london-node-park-lane-oxford", "london-node-oxford-mid", "london-node-regent-oxford", "london-node-oxford-east", "london-node-islington-arm-west"], 2, 10.4, { arterial: true }),
  road("london-victoria-street", "Victoria Street", ["london-node-parliament-arm-victoria", "london-node-victoria-street-1", "london-node-victoria-street-2", "london-node-buckingham-2"], 2, 10.4, { arterial: true }),

  // --- The City, Soho and the north east. -----------------------------------
  road("london-great-portland", "Great Portland Street", ["london-node-oxford-mid", "london-node-great-portland-mid", "london-node-euston-soho"], 2, 8.6),
  road("london-euston", "Euston Road", ["london-node-park-corner-north-east", "london-node-euston-soho", "london-node-euston-mid", "london-node-euston-east"], 2, 11.4, { arterial: true }),
  road("london-upper-street", "Upper Street", ["london-node-islington-arm-north", "london-node-upper-street-mid", "london-node-euston-east"], 2, 9.6),
  road("london-bishopsgate", "Bishopsgate", ["london-node-bank-arm-north", "london-node-bishopsgate-1", "london-node-bishopsgate-2", "london-node-islington-arm-south"], 2, 10.4, { arterial: true }),
  road("london-king-william", "King William Street", ["london-node-tower-north", "london-node-king-william-mid", "london-node-bank-arm-south"], 2, 9.6, { arterial: true }),
  road("london-london-wall", "London Wall", ["london-node-piccadilly-east", "london-node-london-wall-mid", "london-node-bishopsgate-1"], 2, 10.4, { arterial: true }),
  road("london-cornmarket", "Cornmarket Street", ["london-node-bank-arm-west", "london-node-cornmarket-mid", "london-node-london-wall-mid"], 2, 8.6),
  road("london-leadenhall", "Leadenhall Street", ["london-node-bank-arm-east", "london-node-leadenhall-mid", "london-node-leadenhall-east"], 2, 8.6),
  road("london-minories", "The Minories", ["london-node-leadenhall-east", "london-node-minories-mid", "london-node-tower-north"], 2, 8.6),
  road("london-canonbury", "Canonbury Road", ["london-node-upper-street-mid", "london-node-canonbury-east"], 2, 8),
  road("london-shoreditch", "Shoreditch Lane", ["london-node-canonbury-east", "london-node-shoreditch-mid", "london-node-bishopsgate-2"], 2, 8),

  // --- Roundabouts. ---------------------------------------------------------
  road("london-sloane-circus", "Sloane Circus", ["london-node-sloane-arm-sydney", "london-node-sloane-arm-buckingham", "london-node-sloane-arm-smith", "london-node-sloane-arm-kings"], 1, 7, {
    oneWay: "forward",
    roundabout: { center: point(250, -206), radiusM: 14, islandRadiusM: 8 },
  }),
  road("london-wellington-circus", "Wellington Circus", ["london-node-wellington-arm-park", "london-node-wellington-arm-piccadilly", "london-node-wellington-arm-grosvenor", "london-node-wellington-arm-knights"], 2, 11, {
    oneWay: "forward",
    roundabout: { center: point(620, 220), radiusM: 22, islandRadiusM: 14 },
  }),
  road("london-victoria-circus", "Victoria Circus", ["london-node-victoria-arm-grosvenor", "london-node-victoria-arm-mall", "london-node-victoria-arm-buckingham"], 1, 8, {
    oneWay: "forward",
    roundabout: { center: point(560, -60), radiusM: 16, islandRadiusM: 10 },
  }),
  road("london-bank-circus", "Bank Circus", ["london-node-bank-arm-north", "london-node-bank-arm-east", "london-node-bank-arm-south", "london-node-bank-arm-west"], 2, 10, {
    oneWay: "forward",
    roundabout: { center: point(1180, 120), radiusM: 20, islandRadiusM: 13 },
  }),
  road("london-islington-circus", "Islington Circus", ["london-node-islington-arm-north", "london-node-islington-arm-south", "london-node-islington-arm-west"], 1, 7, {
    oneWay: "forward",
    roundabout: { center: point(1150, 700), radiusM: 13, islandRadiusM: 7.5 },
  }),
  // Parliament Square is a gyratory, not a give-way roundabout: a clockwise
  // one-way ring around a green whose every arm is signalled. Authentically
  // London, and built entirely out of the same primitives — `signalled` only
  // says which control the arms get.
  road("london-parliament-square", "Parliament Square", ["london-node-parliament-arm-whitehall", "london-node-parliament-arm-bridge", "london-node-parliament-arm-victoria"], 2, 11, {
    oneWay: "forward",
    roundabout: { center: point(740, -296), radiusM: 26, islandRadiusM: 14, signalled: true },
  }),
];

interface LondonConnectorMovement {
  readonly fromRoadId: string;
  readonly toRoadIds: readonly string[];
}

interface LondonJunctionConnectorSpec {
  readonly id: string;
  readonly nodeId: string;
  readonly movements: readonly LondonConnectorMovement[];
}

const junction = (
  id: string,
  nodeId: string,
  roadIds: readonly string[],
): LondonJunctionConnectorSpec => ({
  id,
  nodeId,
  movements: roadIds.map((fromRoadId) => ({
    fromRoadId,
    toRoadIds: roadIds.filter((toRoadId) => toRoadId !== fromRoadId),
  })),
});

/**
 * Explicit legal turn whitelist. Same-road continuation is implicit; every
 * cross-road successor — in either direction, including from the quarter's
 * hand-authored lanes out onto a generated road — must appear here.
 *
 * The quarter's own roads appear by their `RoadSurface` ids, which is the same
 * key space `LaneSegment.roadId` uses, so a junction can mix the two freely.
 */
export const LONDON_JUNCTION_CONNECTORS: readonly LondonJunctionConnectorSpec[] = [
  junction("london-junction-kings-west", "london-node-kings-west", ["london-kings-road", "london-warwick-road"]),
  junction("london-junction-kings-earls", "london-node-kings-earls", ["london-kings-road", "london-earls-court-road"]),
  junction("london-junction-kings-gloucester", "london-node-kings-gloucester", ["london-kings-road", "london-gloucester-south", "london-chelsea-manor", "london-cheyne-mews"]),
  junction("london-junction-kings-queens", "london-node-kings-queens", ["london-kings-road", "london-drayton-gardens", "london-flood-street"]),
  junction("london-junction-flood-cheyne", "london-node-flood-mid", ["london-flood-street", "london-cheyne-mews"]),
  junction("london-junction-sloane-kings", "london-node-sloane-arm-kings", ["london-kings-road", "london-sloane-circus"]),
  junction("london-junction-sloane-smith", "london-node-sloane-arm-smith", ["london-smith-street", "london-sloane-circus"]),
  junction("london-junction-sloane-sydney", "london-node-sloane-arm-sydney", ["london-sydney-street", "london-sloane-circus"]),
  junction("london-junction-warwick-nevern", "london-node-warwick-north", ["london-warwick-road", "london-nevern-place"]),
  junction("london-junction-earls-nevern", "london-node-earls-nevern", ["london-earls-court-road", "london-nevern-place"]),
  junction("london-junction-earls-crescent-north", "london-node-earls-north", ["london-earls-court-road", "london-pembroke-crescent"]),
  junction("london-junction-earls-crescent-south", "london-node-earls-crescent", ["london-earls-court-road", "london-pembroke-crescent"]),
  junction("london-junction-earls-brompton", "london-node-earls-brompton", ["london-earls-court-road", "london-old-brompton"]),
  junction("london-junction-gloucester-brompton", "london-node-gloucester-south", ["london-gloucester", "london-old-brompton", "london-gloucester-south"]),
  junction("london-junction-queens-gate-drayton", "london-node-queen-gate-south", ["london-queen-gate", "london-quiet-loop", "london-drayton-gardens"]),
  junction("london-junction-brompton-sydney", "london-node-cromwell-far-east", ["london-cromwell-east", "london-sydney-street"]),
  junction("london-junction-hospital-west", "london-node-hospital-west", ["london-royal-hospital-road", "london-chelsea-manor"]),
  junction("london-junction-hospital-flood", "london-node-hospital-mid", ["london-royal-hospital-road", "london-flood-street"]),
  junction("london-junction-hospital-smith", "london-node-hospital-east", ["london-royal-hospital-road", "london-smith-street"]),
  // --- The river. -----------------------------------------------------------
  junction("london-junction-kings-lots", "london-node-kings-west", ["london-kings-road", "london-warwick-road", "london-lots-road"]),
  junction("london-junction-lots-embankment", "london-node-chelsea-emb-west", ["london-lots-road", "london-chelsea-embankment"]),
  junction("london-junction-albert-north", "london-node-albert-north", ["london-chelsea-embankment", "london-oakley-street", "london-albert-bridge"]),
  junction("london-junction-oakley-hospital", "london-node-hospital-west", ["london-royal-hospital-road", "london-chelsea-manor", "london-oakley-street"]),
  junction("london-junction-embankment-join", "london-node-embankment-join", ["london-chelsea-embankment", "london-victoria-embankment"]),
  junction("london-junction-westminster-north", "london-node-westminster-north", ["london-victoria-embankment", "london-westminster-bridge"]),
  junction("london-junction-tower-north", "london-node-tower-north", ["london-victoria-embankment", "london-tower-bridge"]),
  junction("london-junction-albert-south", "london-node-albert-south", ["london-riverbank", "london-albert-bridge", "london-parkgate"]),
  junction("london-junction-westminster-south", "london-node-westminster-south", ["london-riverbank", "london-westminster-bridge"]),
  junction("london-junction-tower-south", "london-node-tower-south", ["london-riverbank", "london-tower-bridge"]),
  junction("london-junction-riverbank-west", "london-node-riverbank-west", ["london-riverbank", "london-lombard-lane"]),
  junction("london-junction-riverbank-east", "london-node-riverbank-east", ["london-riverbank", "london-tooley-street"]),
  junction("london-junction-nine-elms-north", "london-node-riverbank-3", ["london-riverbank", "london-nine-elms"]),
  junction("london-junction-battersea-west", "london-node-battersea-west", ["london-battersea-road", "london-lombard-lane"]),
  junction("london-junction-battersea-albert", "london-node-battersea-albert", ["london-battersea-road", "london-parkgate"]),
  junction("london-junction-battersea-nine", "london-node-battersea-nine", ["london-battersea-road", "london-nine-elms"]),
  junction("london-junction-battersea-east", "london-node-battersea-east", ["london-battersea-road", "london-tooley-street"]),
  // --- Knightsbridge, Mayfair, the park and Westminster. ---------------------
  junction("london-junction-kensington-knightsbridge", "london-node-kensington-exhibition", ["london-kensington", "london-exhibition-north", "london-knightsbridge"]),
  junction("london-junction-knights-brompton", "london-node-knights-brompton", ["london-knightsbridge", "london-brompton-road"]),
  junction("london-junction-cromwell-brompton", "london-node-cromwell-far-east", ["london-cromwell-east", "london-sydney-street", "london-brompton-road"]),
  junction("london-junction-wellington-knights", "london-node-wellington-arm-knights", ["london-knightsbridge", "london-wellington-circus"]),
  junction("london-junction-wellington-park", "london-node-wellington-arm-park", ["london-park-lane", "london-wellington-circus"]),
  junction("london-junction-wellington-piccadilly", "london-node-wellington-arm-piccadilly", ["london-piccadilly", "london-wellington-circus"]),
  junction("london-junction-wellington-grosvenor", "london-node-wellington-arm-grosvenor", ["london-grosvenor", "london-wellington-circus"]),
  junction("london-junction-park-north-east", "london-node-park-corner-north-east", ["london-park-lane", "london-bayswater"]),
  junction("london-junction-park-north-west", "london-node-park-corner-north-west", ["london-bayswater", "london-park-west"]),
  junction("london-junction-park-south-west", "london-node-gloucester-kensington", ["london-gloucester", "london-kensington", "london-park-west"]),
  junction("london-junction-victoria-grosvenor", "london-node-victoria-arm-grosvenor", ["london-grosvenor", "london-victoria-circus"]),
  junction("london-junction-victoria-mall", "london-node-victoria-arm-mall", ["london-mall", "london-victoria-circus"]),
  junction("london-junction-victoria-buckingham", "london-node-victoria-arm-buckingham", ["london-buckingham-palace-road", "london-victoria-circus"]),
  junction("london-junction-sloane-buckingham", "london-node-sloane-arm-buckingham", ["london-buckingham-palace-road", "london-sloane-circus"]),
  junction("london-junction-buckingham-victoria-street", "london-node-buckingham-2", ["london-buckingham-palace-road", "london-victoria-street"]),
  junction("london-junction-mall-whitehall", "london-node-mall-east", ["london-mall", "london-whitehall"]),
  junction("london-junction-parliament-whitehall", "london-node-parliament-arm-whitehall", ["london-whitehall", "london-parliament-square"]),
  junction("london-junction-parliament-bridge", "london-node-parliament-arm-bridge", ["london-bridge-street", "london-parliament-square"]),
  junction("london-junction-parliament-victoria", "london-node-parliament-arm-victoria", ["london-victoria-street", "london-parliament-square"]),
  junction("london-junction-piccadilly-regent", "london-node-piccadilly-east", ["london-piccadilly", "london-regent"]),
  junction("london-junction-regent-oxford", "london-node-regent-oxford", ["london-regent", "london-oxford-street"]),
  junction("london-junction-park-lane-oxford", "london-node-park-lane-oxford", ["london-park-lane", "london-oxford-street"]),
  // --- The City, Soho and the north east. -----------------------------------
  junction("london-junction-oxford-portland", "london-node-oxford-mid", ["london-oxford-street", "london-great-portland"]),
  junction("london-junction-euston-portland", "london-node-euston-soho", ["london-euston", "london-great-portland"]),
  junction("london-junction-park-euston", "london-node-park-corner-north-east", ["london-park-lane", "london-bayswater", "london-euston"]),
  junction("london-junction-euston-upper", "london-node-euston-east", ["london-euston", "london-upper-street"]),
  junction("london-junction-islington-north", "london-node-islington-arm-north", ["london-upper-street", "london-islington-circus"]),
  junction("london-junction-islington-south", "london-node-islington-arm-south", ["london-bishopsgate", "london-islington-circus"]),
  junction("london-junction-islington-west", "london-node-islington-arm-west", ["london-oxford-street", "london-islington-circus"]),
  junction("london-junction-bank-north", "london-node-bank-arm-north", ["london-bishopsgate", "london-bank-circus"]),
  junction("london-junction-bank-east", "london-node-bank-arm-east", ["london-leadenhall", "london-bank-circus"]),
  junction("london-junction-bank-south", "london-node-bank-arm-south", ["london-king-william", "london-bank-circus"]),
  junction("london-junction-bank-west", "london-node-bank-arm-west", ["london-cornmarket", "london-bank-circus"]),
  junction("london-junction-bishopsgate-wall", "london-node-bishopsgate-1", ["london-bishopsgate", "london-london-wall"]),
  junction("london-junction-bishopsgate-shoreditch", "london-node-bishopsgate-2", ["london-bishopsgate", "london-shoreditch"]),
  junction("london-junction-piccadilly-wall", "london-node-piccadilly-east", ["london-piccadilly", "london-regent", "london-london-wall"]),
  junction("london-junction-wall-cornmarket", "london-node-london-wall-mid", ["london-london-wall", "london-cornmarket"]),
  junction("london-junction-leadenhall-minories", "london-node-leadenhall-east", ["london-leadenhall", "london-minories"]),
  junction("london-junction-tower-city", "london-node-tower-north", ["london-victoria-embankment", "london-tower-bridge", "london-king-william", "london-minories"]),
  junction("london-junction-upper-canonbury", "london-node-upper-street-mid", ["london-upper-street", "london-canonbury"]),
  junction("london-junction-canonbury-shoreditch", "london-node-canonbury-east", ["london-canonbury", "london-shoreditch"]),
  junction("london-junction-westminster-bridge-street", "london-node-westminster-north", ["london-victoria-embankment", "london-westminster-bridge", "london-bridge-street"]),
];

/**
 * Every road in the quarter and what it is posted at, keyed by
 * `RoadSurface.id`. Flat 20 mph, and that is the researched answer rather than
 * a placeholder: Kensington and Chelsea is 20 borough-wide, and TfL's 2023
 * order took the GLA roads through it — Cromwell Road, the A4 — down to 20 as
 * well. Both are cited in `LONDON_RULE_REFERENCES` above. Do not "fix" this into a 30.
 *
 * A road declares its limit once, here, and `laneTrue` stamps it onto every
 * lane of that road; see `cities/nyc.ts` or `cities/tokyo.ts` for the factors
 * that choose the figure.
 */
const LONDON_ROAD_SPEED_LIMITS = {
  "london-queen-gate": 20,
  "london-cromwell-west": 20,
  "london-cromwell-east": 20,
  "london-cromwell-far-west": 20,
  "london-exhibition-road": 20,
  "london-exhibition-north": 20,
  "london-thurloe-place": 20,
  "london-gloucester": 20,
  "london-kensington": 20,
  "london-quiet-loop": 20,
  "london-east-road": 20,
} as const satisfies Record<string, number>;

/**
 * Checked against the limit table, so a quarter road cannot be named without
 * being posted or posted without being named.
 */
const LONDON_QUARTER_ROAD_NAMES = {
  "london-queen-gate": "Queen's Gate",
  "london-cromwell-west": "Cromwell Road",
  "london-cromwell-east": "Cromwell Road",
  "london-cromwell-far-west": "Cromwell Road",
  "london-exhibition-road": "Exhibition Road",
  "london-exhibition-north": "Exhibition Road",
  "london-thurloe-place": "Thurloe Place",
  "london-gloucester": "Gloucester Road",
  "london-kensington": "Kensington Road",
  // No real-world counterpart: these close the loops the quarter needs.
  "london-quiet-loop": "Petersham Mews",
  "london-east-road": "Brompton Approach",
} satisfies Readonly<Record<keyof typeof LONDON_ROAD_SPEED_LIMITS, string>>;

/** Same 20, applied to every generated road by construction. */
const LONDON_SPEED_LIMIT_MPH = 20;

const speedLimitForRoad = makeSpeedLimitForRoad({
  ...LONDON_ROAD_SPEED_LIMITS,
  ...Object.fromEntries(
    LONDON_ROAD_SPECS.map((spec) => [spec.id, LONDON_SPEED_LIMIT_MPH]),
  ),
});

const laneTrue = (
  id: string,
  from: LaneNode,
  to: LaneNode,
  successors: readonly string[],
  role: LaneRole,
  establishedPath: readonly WorldPoint[],
  adjacentLaneIds?: readonly string[],
  roadId: string = roadIdForLane(id),
  widthM = id.includes("cromwell") || id.includes("queen-gate") ? 3.4 : 3.2,
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
    trafficSide: "left",
    speedLimit: speedLimitForRoad(roadId),
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

// Distances include the eased junction connector before each established
// running lane. These anchors resolve to the requested lane-true starts at
// approximately (-121.98, -105.8) and (-109.7, -92).
const LONDON_QUIET_START_DISTANCE_M = 14.29;
const LONDON_QUEEN_GATE_START_DISTANCE_M = 12.27;

const polylineLengthM = (points: readonly WorldPoint[]): number =>
  points
    .slice(1)
    .reduce(
      (total, current, index) =>
        total + distanceBetweenPoints(points[index], current),
      0,
    );

/**
 * Cromwell Road's signed bus lane is the one lane authored by hand rather than
 * through `laneTrue`: it runs parallel to the road centreline for its whole
 * length instead of radiating from the two junction nodes. It still has to
 * *end* like every other lane — on the shared node — or a bus reaching the
 * junction has nowhere legal to go and the simulation recycles it on the spot.
 * The last few metres therefore ease across the divider onto the general
 * running line, which is what a bus lane ending at a junction does anyway.
 */
const CROMWELL_BUS_LANE_MERGE = point(33, -26.9);
const cromwellBusLaneCenterline: readonly WorldPoint[] = [
  point(-108, -26.9),
  point(-66, -26.9),
  point(-14, -26.9),
  // The signalled stop line sits at 140 m, square on this straight run.
  CROMWELL_BUS_LANE_MERGE,
  // One continuous smoothstep from the bus line down onto the shared node,
  // arriving flat (heading east) so the hand-over to the general lane's
  // connector blend carries no heading jolt (#19). The old tail eased onto
  // the general running line and then elbowed 1.7 m sideways onto the node
  // in half a metre, which snapped a departing bus ~106 degrees.
  point(34.5, -27.28),
  point(36, -28.22),
  point(37.5, -29.45),
  point(39, -30.68),
  point(40.5, -31.62),
  londonNodes.exhibitionCromwell.position,
];
const cromwellBusLaneLengthM = polylineLengthM(cromwellBusLaneCenterline);
const cromwellBusLaneConnectorM = distanceBetweenPoints(
  cromwellBusLaneCenterline.at(-2)!,
  cromwellBusLaneCenterline.at(-1)!,
);

const londonAuthoredLanes: readonly LaneSegment[] = [
  // A calm local loop west of Queen's Gate.
  laneTrue(
    "london-local-west",
    londonNodes.queenGateSouth,
    londonNodes.quietWestSouth,
    ["london-quiet-north"],
    "travel",
    [point(-136, -105.8)],
  ),
  laneTrue(
    "london-quiet-north",
    londonNodes.quietWestSouth,
    londonNodes.quietWestNorth,
    ["london-cromwell-local-east"],
    "travel",
    [point(-165.8, -68)],
  ),
  laneTrue(
    "london-cromwell-local-east",
    londonNodes.quietWestNorth,
    londonNodes.queenGateCromwell,
    ["london-queen-gate-south-2"],
    "travel",
    [point(-136, -30.2)],
  ),
  laneTrue(
    "london-local-east-opposite",
    londonNodes.quietWestSouth,
    londonNodes.queenGateSouth,
    ["london-queen-gate-north-1"],
    "travel",
    [point(-136, -102.2)],
    ["london-local-west"],
  ),
  laneTrue(
    "london-quiet-south-opposite",
    londonNodes.quietWestNorth,
    londonNodes.quietWestSouth,
    ["london-local-east-opposite"],
    "travel",
    [point(-162.2, -68)],
    ["london-quiet-north"],
  ),
  laneTrue(
    "london-cromwell-local-west-opposite",
    londonNodes.queenGateCromwell,
    londonNodes.quietWestNorth,
    ["london-quiet-south-opposite"],
    "travel",
    [point(-136, -33.8)],
    ["london-cromwell-local-east"],
  ),

  // Queen's Gate is modelled in both legal directions, with the left-hand
  // running position visible in each centreline's lateral offset.
  laneTrue(
    "london-queen-gate-north-1",
    londonNodes.queenGateSouth,
    londonNodes.queenGateCromwell,
    ["london-queen-gate-north-2", "london-cromwell-east-1", "london-cromwell-local-west-opposite"],
    "travel",
    [point(-109.7, -68)],
    ["london-queen-gate-south-2"],
  ),
  laneTrue(
    "london-queen-gate-north-2",
    londonNodes.queenGateCromwell,
    londonNodes.queenGateThurloe,
    ["london-queen-gate-south-1", "london-queen-gate-north-3"],
    "travel",
    [point(-109.7, 24), point(-109.7, 58)],
    ["london-queen-gate-south-1"],
  ),
  laneTrue(
    "london-queen-gate-south-1",
    londonNodes.queenGateThurloe,
    londonNodes.queenGateCromwell,
    ["london-queen-gate-south-2", "london-cromwell-east-1"],
    "travel",
    [point(-106.3, 58), point(-106.3, 24)],
    ["london-queen-gate-north-2"],
  ),
  laneTrue(
    "london-queen-gate-south-2",
    londonNodes.queenGateCromwell,
    londonNodes.queenGateSouth,
    ["london-local-west", "london-queen-gate-north-1"],
    "travel",
    [point(-106.3, -68)],
    ["london-queen-gate-north-1"],
  ),

  // Cromwell Road's eastbound general lane sits beside a signed, timed bus
  // lane. The restriction is active at the fixed Tuesday 08:30 scenario clock.
  laneTrue(
    "london-cromwell-east-1",
    londonNodes.queenGateCromwell,
    londonNodes.exhibitionCromwell,
    ["london-cromwell-east-2", "london-exhibition-shared-1"],
    "travel",
    [point(-66, -30.3), point(-14, -30.3)],
  ),
  {
    id: "london-cromwell-east-bus",
    roadId: "london-cromwell-west",
    widthM: 3.4,
    from: londonNodes.queenGateCromwell.id,
    to: londonNodes.exhibitionCromwell.id,
    centerline: cromwellBusLaneCenterline,
    role: "travel",
    trafficSide: "left",
    speedLimit: speedLimitForRoad("london-cromwell-west"),
    // The same continuations the general lane gets: straight on past the
    // museums, or left up Exhibition Road.
    successors: ["london-cromwell-east-2", "london-exhibition-shared-1"],
    connectorRanges: [
      {
        startDistanceAlongM: cromwellBusLaneLengthM - cromwellBusLaneConnectorM,
        endDistanceAlongM: cromwellBusLaneLengthM,
        conflictZoneId: "london-cromwell-exhibition-conflict",
      },
    ],
  },
  laneTrue(
    "london-cromwell-east-2",
    londonNodes.exhibitionCromwell,
    londonNodes.cromwellEast,
    ["london-east-north", "london-cromwell-east-3"],
    "travel",
    [point(82, -30.3), point(118, -30.3)],
    ["london-cromwell-west-1"],
  ),
  laneTrue(
    "london-cromwell-west-1",
    londonNodes.cromwellEast,
    londonNodes.exhibitionCromwell,
    ["london-cromwell-west-2", "london-exhibition-shared-1"],
    "travel",
    [point(118, -33.7), point(82, -33.7)],
    ["london-cromwell-east-2"],
  ),
  laneTrue(
    "london-cromwell-west-2",
    londonNodes.exhibitionCromwell,
    londonNodes.queenGateCromwell,
    ["london-queen-gate-south-2", "london-queen-gate-north-2", "london-cromwell-fw-w"],
    "travel",
    [point(-14, -33.7), point(-66, -33.7)],
    ["london-cromwell-east-1"],
  ),

  // The eastern and northern streets close the busier museum-quarter loop.
  laneTrue(
    "london-east-north",
    londonNodes.cromwellEast,
    londonNodes.thurloeEast,
    ["london-thurloe-west-1"],
    "travel",
    [point(148.2, 18), point(148.2, 54)],
  ),
  laneTrue(
    "london-thurloe-west-1",
    londonNodes.thurloeEast,
    londonNodes.exhibitionThurloe,
    ["london-thurloe-west-2", "london-exhibition-north-n"],
    "one_way",
    [point(100, 80.2)],
  ),
  laneTrue(
    "london-thurloe-west-2",
    londonNodes.exhibitionThurloe,
    londonNodes.queenGateThurloe,
    ["london-queen-gate-south-1"],
    "one_way",
    [point(-24, 80.2), point(-68, 80.2)],
  ),

  // The northern portion of Exhibition Road is a deliberately slow, one-way
  // shared-space exercise with dense pedestrian and cyclist activity.
  laneTrue(
    "london-exhibition-shared-1",
    londonNodes.exhibitionCromwell,
    londonNodes.exhibitionMid,
    ["london-exhibition-shared-2"],
    "one_way",
    [point(40.3, -4)],
  ),
  laneTrue(
    "london-exhibition-shared-2",
    londonNodes.exhibitionMid,
    londonNodes.exhibitionThurloe,
    ["london-thurloe-west-2"],
    "one_way",
    [point(40.3, 54)],
  ),

  // Cromwell Road extended east toward Brompton (two-way).
  laneTrue(
    "london-cromwell-east-3",
    londonNodes.cromwellEast,
    londonNodes.cromwellFarEast,
    // Empty on purpose: this used to dead-end into a turning loop, and now
    // meets the generated Sydney Street. Cross-road successors at a shared
    // node are filled in by `withGeneratedSuccessors` below, off the same
    // junction whitelist the generated lanes use — writing a generated lane
    // id in here by hand would be a literal nobody could keep true.
    [],
    "travel",
    [point(240, -30.3)],
    ["london-cromwell-west-0"],
    "london-cromwell-east",
  ),
  laneTrue(
    "london-cromwell-west-0",
    londonNodes.cromwellFarEast,
    londonNodes.cromwellEast,
    ["london-cromwell-west-1"],
    "travel",
    [point(240, -33.7)],
    ["london-cromwell-east-3"],
    "london-cromwell-east",
  ),
  // Queen's Gate extended north toward Kensington Gardens (two-way).
  laneTrue(
    "london-queen-gate-north-3",
    londonNodes.queenGateThurloe,
    londonNodes.queenGateFarNorth,
    ["london-kensington-e-2", "london-kensington-w-2"],
    "travel",
    [point(-109.7, 150)],
    ["london-queen-gate-south-0"],
    "london-queen-gate",
  ),
  laneTrue(
    "london-queen-gate-south-0",
    londonNodes.queenGateFarNorth,
    londonNodes.queenGateThurloe,
    ["london-queen-gate-south-1"],
    "travel",
    [point(-106.3, 150)],
    ["london-queen-gate-north-3"],
    "london-queen-gate",
  ),

  // Cromwell Road extended west to Gloucester Road (two-way).
  laneTrue("london-cromwell-fw-e", londonNodes.gloucesterCromwell, londonNodes.queenGateCromwell, ["london-cromwell-east-1"], "travel", [point(-204, -30.3)], ["london-cromwell-fw-w"], "london-cromwell-far-west"),
  laneTrue("london-cromwell-fw-w", londonNodes.queenGateCromwell, londonNodes.gloucesterCromwell, ["london-gloucester-n-2", "london-gloucester-s-2"], "travel", [point(-204, -33.7)], ["london-cromwell-fw-e"], "london-cromwell-far-west"),
  // Gloucester Road (two-way, x=-300).
  laneTrue("london-gloucester-n-1", londonNodes.gloucesterSouth, londonNodes.gloucesterCromwell, ["london-gloucester-n-2", "london-cromwell-fw-e"], "travel", [point(-301.7, -68)], ["london-gloucester-s-2"], "london-gloucester"),
  laneTrue("london-gloucester-n-2", londonNodes.gloucesterCromwell, londonNodes.gloucesterKensington, ["london-kensington-e-1"], "travel", [point(-301.7, 94)], ["london-gloucester-s-1"], "london-gloucester"),
  laneTrue("london-gloucester-s-1", londonNodes.gloucesterKensington, londonNodes.gloucesterCromwell, ["london-gloucester-s-2", "london-cromwell-fw-e"], "travel", [point(-298.3, 94)], ["london-gloucester-n-2"], "london-gloucester"),
  // Also emptied with the turning loops — Old Brompton Road and Gloucester
  // Road's southern run take over here (see `london-cromwell-east-3`).
  laneTrue("london-gloucester-s-2", londonNodes.gloucesterCromwell, londonNodes.gloucesterSouth, [], "travel", [point(-298.3, -68)], ["london-gloucester-n-1"], "london-gloucester"),
  // Kensington Road (two-way, z=220): Gloucester <-> Queen's Gate <-> Exhibition.
  laneTrue("london-kensington-e-1", londonNodes.gloucesterKensington, londonNodes.queenGateFarNorth, ["london-kensington-e-2", "london-queen-gate-south-0"], "travel", [point(-204, 221.7)], ["london-kensington-w-2"], "london-kensington"),
  laneTrue("london-kensington-e-2", londonNodes.queenGateFarNorth, londonNodes.kensingtonExhibition, ["london-exhibition-north-s"], "travel", [point(-33, 221.7)], ["london-kensington-w-1"], "london-kensington"),
  laneTrue("london-kensington-w-1", londonNodes.kensingtonExhibition, londonNodes.queenGateFarNorth, ["london-kensington-w-2", "london-queen-gate-south-0"], "travel", [point(-33, 218.3)], ["london-kensington-e-2"], "london-kensington"),
  laneTrue("london-kensington-w-2", londonNodes.queenGateFarNorth, londonNodes.gloucesterKensington, ["london-gloucester-s-1"], "travel", [point(-204, 218.3)], ["london-kensington-e-1"], "london-kensington"),
  // Exhibition Road extended north to Kensington Road (two-way).
  laneTrue("london-exhibition-north-n", londonNodes.exhibitionThurloe, londonNodes.kensingtonExhibition, ["london-kensington-w-1"], "travel", [point(40.3, 150)], ["london-exhibition-north-s"], "london-exhibition-north"),
  laneTrue("london-exhibition-north-s", londonNodes.kensingtonExhibition, londonNodes.exhibitionThurloe, ["london-thurloe-west-2"], "travel", [point(43.7, 150)], ["london-exhibition-north-n"], "london-exhibition-north"),
];

// ---------------------------------------------------------------------------
// Generated roads: lanes, successors, surfaces and markings from the specs.
// ---------------------------------------------------------------------------

/**
 * Lateral offset of the nearside lane line from its carriageway centreline,
 * and the pitch between two lanes running the same way.
 *
 * **The sign is the whole point.** London drives on the left, so a lane sits
 * to the LEFT of the centreline in its own direction of travel — the opposite
 * of Cairo's otherwise identical derivation. The quarter's hand-authored lanes
 * are the reference: Queen's Gate's centreline is x-108 and its *northbound*
 * lane runs at x-109.7, which is west, which is that driver's left.
 */
const LONDON_LANE_OFFSET_M = 1.7;
const LONDON_LANE_PITCH_M = 3.2;
const LONDON_LANE_WIDTH_M = 3.2;

/**
 * The established running line between two nodes, offset from the straight
 * node-to-node line. Positive offsets go to the driver's right, so every
 * caller below negates for a two-way road's nearside lane.
 */
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
    point(from.x + ux * inset + rightX * offsetM, from.z + uz * inset + rightZ * offsetM),
    point(to.x - ux * inset + rightX * offsetM, to.z - uz * inset + rightZ * offsetM),
  ];
};

interface LondonRawLane extends LaneSegment {
  /** Identifies the segment, so a lane can never be its own reverse. */
  readonly reverseKey: string;
  readonly direction: "forward" | "reverse";
  readonly laneIndex: number;
}

const londonRawLanes: LondonRawLane[] = [];
/**
 * Points along a circular arc, inclusive of both endpoints. Angles in degrees,
 * 0deg = +x (east), 90deg = +z (north) — standard maths, NOT the heading
 * convention the rest of the file uses; `a1 < a0` traces the arc clockwise,
 * which is the way left-hand traffic circulates.
 */
const arcPoints = (
  center: WorldPoint,
  radius: number,
  a0Deg: number,
  a1Deg: number,
  steps: number,
): WorldPoint[] => {
  const points: WorldPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = ((a0Deg + ((a1Deg - a0Deg) * index) / steps) * Math.PI) / 180;
    points.push(
      point(center.x + radius * Math.cos(angle), center.z + radius * Math.sin(angle)),
    );
  }
  return points;
};

/** Maths angle of an arm node about its roundabout's centre, in degrees. */
const armAngleDeg = (center: WorldPoint, armNodeId: string): number => {
  const position = londonNodeById.get(armNodeId)!.position;
  return (
    (Math.atan2(position.z - center.z, position.x - center.x) * 180) / Math.PI
  );
};

/**
 * Every roundabout's circulating arcs, one per pair of consecutive arms,
 * clockwise. Computed once and used twice — for the ring's lanes and for its
 * carriageway surface — so the surface's polyline passes through exactly the
 * arm nodes the approach roads end on. Built any other way (a circle sampled
 * at regular angles, say) the arms land mid-segment on the ring's asphalt and
 * the pavement graph finds junctions the asphalt fill never paved.
 *
 * Arc sampling is deliberately coarse: segment count is the simulation's
 * dominant cost, and a mini-roundabout read from a car is a curve, not a
 * polygon.
 */
const londonRoundaboutArcs = new Map<
  string,
  readonly { readonly from: LaneNode; readonly to: LaneNode; readonly points: readonly WorldPoint[] }[]
>();
for (const spec of LONDON_ROAD_SPECS) {
  if (!spec.roundabout) continue;
  const { center, radiusM } = spec.roundabout;
  const arcs: { from: LaneNode; to: LaneNode; points: readonly WorldPoint[] }[] = [];
  for (let index = 0; index < spec.nodeIds.length; index += 1) {
    const from = londonNodeById.get(spec.nodeIds[index])!;
    const to = londonNodeById.get(spec.nodeIds[(index + 1) % spec.nodeIds.length])!;
    const startAngle = armAngleDeg(center, from.id);
    let endAngle = armAngleDeg(center, to.id);
    while (endAngle >= startAngle) endAngle -= 360;
    const sweepRad = ((startAngle - endAngle) * Math.PI) / 180;
    const steps = Math.max(2, Math.round((sweepRad * radiusM) / 9));
    arcs.push({
      from,
      to,
      points: [
        from.position,
        ...arcPoints(center, radiusM, startAngle, endAngle, steps).slice(1, -1),
        to.position,
      ],
    });
  }
  londonRoundaboutArcs.set(spec.id, arcs);
}

for (const spec of LONDON_ROAD_SPECS) {
  const arcs = londonRoundaboutArcs.get(spec.id);
  if (arcs) {
    for (const [index, arc] of arcs.entries()) {
      londonRawLanes.push({
        id: `${spec.id}-arc-${index + 1}`,
        reverseKey: `${spec.id}:arc-${index}`,
        direction: "forward",
        laneIndex: 0,
        roadId: spec.id,
        widthM: LONDON_LANE_WIDTH_M,
        from: arc.from.id,
        to: arc.to.id,
        centerline: arc.points,
        role: "roundabout",
        trafficSide: "left",
        speedLimit: speedLimitForRoad(spec.id),
        successors: [],
      });
    }
    continue;
  }
  if (!spec.oneWay && spec.laneCount % 2 !== 0) {
    throw new Error(`${spec.id} two-way laneCount must be even`);
  }
  const directions = spec.oneWay
    ? ([spec.oneWay] as const)
    : (["forward", "reverse"] as const);
  const lanesPerDirection = spec.oneWay ? spec.laneCount : spec.laneCount / 2;
  for (let segment = 0; segment + 1 < spec.nodeIds.length; segment += 1) {
    const start = londonNodeById.get(spec.nodeIds[segment]);
    const end = londonNodeById.get(spec.nodeIds[segment + 1]);
    if (!start || !end) {
      throw new Error(`${spec.id} references a missing node`);
    }
    for (const direction of directions) {
      const from = direction === "forward" ? start : end;
      const to = direction === "forward" ? end : start;
      for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
        const lateralOffset = spec.oneWay
          ? (laneIndex - (lanesPerDirection - 1) / 2) * LONDON_LANE_PITCH_M
          : -(LONDON_LANE_OFFSET_M + laneIndex * LONDON_LANE_PITCH_M);
        const geometry = buildLaneTrueGeometry(
          from.position,
          to.position,
          offsetPath(from.position, to.position, lateralOffset),
          // `maxBlendLateralM` is raised for the day a London road carries two
          // lanes each way (the outer line sits 4.9 m off centre, past the
          // 3.5 m default, and would otherwise fall back to the legacy elbow).
          // The blend step count is deliberately left at the module default of
          // 6 rather than Cairo's 12: segment count is the simulation's
          // dominant cost (`projectToRoad` is O(total lane segments)) and 6
          // already holds the per-segment heading step near 10 degrees, which
          // is the number that comment promises. Cairo needed the extra
          // sampling for its shallow radial junction angles; London's streets
          // bend, but they meet at ordinary corners.
          {
            maxBlendLateralM: 5.25,
            // Only a four-lane road needs Cairo's finer sampling, and it
            // genuinely needs it: its outer lane sits 4.9 m off centre and
            // sweeps all of that across the six-metre junction blend. At the
            // module default of 6 steps the very first segment already
            // carries most of the smoothstep's slope — a 40-degree heading
            // jolt handing over at a node. Every other London road stays at
            // 6, because segment count is the simulation's dominant cost.
            ...(spec.laneCount === 4 ? { connectorBlendSteps: 12 } : {}),
          },
        );
        londonRawLanes.push({
          id: `${spec.id}-${segment + 1}-${direction}-${laneIndex + 1}`,
          reverseKey: `${spec.id}:${segment}`,
          direction,
          laneIndex,
          roadId: spec.id,
          widthM: LONDON_LANE_WIDTH_M,
          from: from.id,
          to: to.id,
          centerline: geometry.centerline,
          role: spec.oneWay ? "one_way" : laneIndex > 0 ? "passing" : "travel",
          trafficSide: "left",
          speedLimit: speedLimitForRoad(spec.id),
          successors: [],
        });
      }
    }
  }
}

const londonConnectorByNode = new Map(
  LONDON_JUNCTION_CONNECTORS.map((connector) => [connector.nodeId, connector]),
);

/** Road ids a lane on `fromRoadId` may legally turn onto at `nodeId`. */
const allowedCrossRoadsAt = (nodeId: string, fromRoadId: string): Set<string> =>
  new Set(
    londonConnectorByNode
      .get(nodeId)
      ?.movements.find((movement) => movement.fromRoadId === fromRoadId)
      ?.toRoadIds ?? [],
  );

/**
 * Every lane leaving a node, generated or hand-authored. Both halves have to
 * be in here: a generated road has to be able to turn onto the quarter's
 * streets, and the quarter's streets on to it.
 */
const londonOutboundByNode = new Map<string, LaneSegment[]>();
for (const lane of [...londonAuthoredLanes, ...londonRawLanes]) {
  londonOutboundByNode.set(lane.from, [
    ...(londonOutboundByNode.get(lane.from) ?? []),
    lane,
  ]);
}

const londonGeneratedLanes: readonly LaneSegment[] = londonRawLanes.map((lane) => {
  const allowed = allowedCrossRoadsAt(lane.to, lane.roadId);
  const successors = [
    ...new Set(
      (londonOutboundByNode.get(lane.to) ?? [])
        .filter(
          (candidate) =>
            (candidate as LondonRawLane).reverseKey !== lane.reverseKey,
        )
        .filter(
          (candidate) =>
            candidate.roadId === lane.roadId || allowed.has(candidate.roadId),
        )
        .map((candidate) => candidate.id)
        .sort((left, right) => left.localeCompare(right)),
    ),
  ];
  const adjacentLaneIds = londonRawLanes
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
    successors,
    ...(adjacentLaneIds.length > 0 ? { adjacentLaneIds } : {}),
  };
});

/**
 * Gives the quarter's hand-authored lanes their turns onto the generated
 * network, from the same whitelist the generated lanes read. Append-only: an
 * authored lane keeps every successor it already had, in its authored order,
 * so nothing about the museum quarter's routing moves.
 */
const londonLanes: readonly LaneSegment[] = [
  ...londonAuthoredLanes.map((lane) => {
    const allowed = allowedCrossRoadsAt(lane.to, lane.roadId);
    const added = londonRawLanes
      .filter((candidate) => candidate.from === lane.to)
      .filter((candidate) => allowed.has(candidate.roadId))
      .map((candidate) => candidate.id)
      .sort((left, right) => left.localeCompare(right));
    return added.length === 0
      ? lane
      : { ...lane, successors: [...lane.successors, ...added] };
  }),
  ...londonGeneratedLanes,
];

const londonGeneratedSurfaces: readonly RoadSurface[] = LONDON_ROAD_SPECS.map(
  (spec) => {
    const arcs = londonRoundaboutArcs.get(spec.id);
    if (arcs) {
      // The same arcs the ring's lanes ride, joined into one closed polyline.
      // `surfaceType: "roundabout"` is what strips the centre line off a
      // circulating carriageway.
      const ring = arcs.flatMap((arc, index) =>
        index === 0 ? [...arc.points] : arc.points.slice(1),
      );
      return roadSurface(
        spec.id,
        ring,
        spec.widthM,
        londonGeneratedLanes
          .filter((lane) => lane.roadId === spec.id)
          .map((lane) => lane.id),
        "roundabout",
      );
    }
    const centerline = spec.nodeIds.map(
      (id) => londonNodeById.get(id)!.position,
    );
    const markings: RoadMarkingPath[] = spec.oneWay
      ? spec.laneCount > 1
        ? [roadMarking(`${spec.id}-lane-divider`, "lane_dashed", centerline, "white")]
        : []
      : [
          // The UK paints both centre lines and lane dividers white: a white
          // centre line here does not mean "one-way" the way it would in New
          // York (`CountryProfile.centreLineColor`).
          roadMarking(
            `${spec.id}-centre`,
            spec.arterial ? "centre_solid" : "centre_dashed",
            centerline,
            "white",
          ),
        ];
    const surface = roadSurface(
      spec.id,
      centerline,
      spec.widthM,
      londonGeneratedLanes
        .filter((lane) => lane.roadId === spec.id)
        .map((lane) => lane.id),
      "standard",
      markings,
    );
    return spec.sidewalkWidthM === undefined
      ? surface
      : { ...surface, sidewalkWidthM: spec.sidewalkWidthM };
  },
);

/**
 * The museum quarter's own carriageways. Hoisted out of the map pack so the
 * roadside-parcel trimming below can measure against them: a parcel beside a
 * generated street still has to clear every hand-authored one it passes.
 */
const londonQuarterSurfaces: readonly RoadSurface[] = [
    roadSurface("london-quiet-loop", [londonNodes.queenGateSouth.position, londonNodes.quietWestSouth.position, londonNodes.quietWestNorth.position, londonNodes.queenGateCromwell.position], 7.2, ["london-local-west", "london-quiet-north", "london-cromwell-local-east", "london-local-east-opposite", "london-quiet-south-opposite", "london-cromwell-local-west-opposite"], "standard", [
      roadMarking("london-quiet-centre", "centre_dashed", [londonNodes.queenGateSouth.position, londonNodes.quietWestSouth.position, londonNodes.quietWestNorth.position, londonNodes.queenGateCromwell.position], "white"),
    ]),
    roadSurface("london-queen-gate", [londonNodes.queenGateSouth.position, londonNodes.queenGateCromwell.position, londonNodes.queenGateThurloe.position, londonNodes.queenGateFarNorth.position], 7.6, ["london-queen-gate-north-1", "london-queen-gate-north-2", "london-queen-gate-north-3", "london-queen-gate-south-1", "london-queen-gate-south-2", "london-queen-gate-south-0"], "standard", [
      roadMarking("london-queen-gate-centre", "centre_dashed", [londonNodes.queenGateSouth.position, londonNodes.queenGateFarNorth.position], "white"),
    ]),
    roadSurface("london-cromwell-west", [point(-108, -30.3), point(42, -30.3)], 11.4, ["london-cromwell-east-1", "london-cromwell-east-bus", "london-cromwell-west-2"], "standard", [
      // Stops where the bus lane starts its merge, so nothing crosses a solid line.
      roadMarking("london-cromwell-bus-divider", "lane_solid", [point(-108, -28.6), point(CROMWELL_BUS_LANE_MERGE.x, -28.6)], "white"),
      roadMarking("london-cromwell-centre-west", "centre_dashed", [point(-108, -32), point(42, -32)], "white"),
      roadMarking("london-cromwell-box", "box_junction", [point(37, -36), point(47, -36), point(47, -25), point(37, -25), point(37, -36)], "yellow"),
    ]),
    roadSurface("london-cromwell-east", [londonNodes.exhibitionCromwell.position, londonNodes.cromwellEast.position, londonNodes.cromwellFarEast.position], 7.6, ["london-cromwell-east-2", "london-cromwell-west-1", "london-cromwell-east-3", "london-cromwell-west-0"], "standard", [roadMarking("london-cromwell-centre-east", "centre_dashed", [londonNodes.exhibitionCromwell.position, londonNodes.cromwellFarEast.position], "white")]),
    roadSurface("london-east-road", [londonNodes.cromwellEast.position, londonNodes.thurloeEast.position], 7.2, ["london-east-north"]),
    roadSurface("london-thurloe-place", [londonNodes.thurloeEast.position, londonNodes.exhibitionThurloe.position, londonNodes.queenGateThurloe.position], 7.2, ["london-thurloe-west-1", "london-thurloe-west-2"]),
    roadSurface("london-exhibition-road", [londonNodes.exhibitionCromwell.position, londonNodes.exhibitionMid.position, londonNodes.exhibitionThurloe.position], 7, ["london-exhibition-shared-1", "london-exhibition-shared-2"], "shared_space"),
    roadSurface("london-cromwell-far-west", [londonNodes.queenGateCromwell.position, londonNodes.gloucesterCromwell.position], 7.2, ["london-cromwell-fw-e", "london-cromwell-fw-w"], "standard", [
      roadMarking("london-cromwell-far-west-centre", "centre_dashed", [londonNodes.queenGateCromwell.position, londonNodes.gloucesterCromwell.position], "white"),
    ]),
    roadSurface("london-gloucester", [londonNodes.gloucesterSouth.position, londonNodes.gloucesterCromwell.position, londonNodes.gloucesterKensington.position], 7.2, ["london-gloucester-n-1", "london-gloucester-n-2", "london-gloucester-s-1", "london-gloucester-s-2"], "standard", [
      roadMarking("london-gloucester-centre", "centre_dashed", [londonNodes.gloucesterSouth.position, londonNodes.gloucesterKensington.position], "white"),
    ]),
    roadSurface("london-kensington", [londonNodes.gloucesterKensington.position, londonNodes.queenGateFarNorth.position, londonNodes.kensingtonExhibition.position], 7.2, ["london-kensington-e-1", "london-kensington-e-2", "london-kensington-w-1", "london-kensington-w-2"], "standard", [
      roadMarking("london-kensington-centre", "centre_dashed", [londonNodes.gloucesterKensington.position, londonNodes.kensingtonExhibition.position], "white"),
    ]),
    roadSurface("london-exhibition-north", [londonNodes.exhibitionThurloe.position, londonNodes.kensingtonExhibition.position], 7.2, ["london-exhibition-north-n", "london-exhibition-north-s"], "standard", [
      roadMarking("london-exhibition-north-centre", "centre_dashed", [londonNodes.exhibitionThurloe.position, londonNodes.kensingtonExhibition.position], "white"),
    ]),
];

// ---------------------------------------------------------------------------
// Street wall: roadside parcels along the generated streets.
// ---------------------------------------------------------------------------

/**
 * Clearance between a carriageway centreline and the near edge of the parcel
 * beside it. Two things pin this from opposite directions and the window
 * between them is narrow:
 *
 * - **Below**, a block face must clear the whole walkable pavement band, not
 *   just the kerb: `buildPavementGraph` runs its rail at half-width + 1.7 and
 *   `staticColliders.test.ts` samples out to half-width + 3.0, then demands
 *   0.3 m more.
 * - **Above**, `generateStreetAddresses` probes for frontage at 12 m from the
 *   *lane* (1.7 m in from this edge on a two-way street) and gives up at 22.
 *   A parcel further out than that generates no addresses at all, silently.
 *
 * Half-width + 4.8 sits comfortably inside both, on every width London
 * authors.
 */
const blockInsetFor = (roadWidthM: number): number => roadWidthM / 2 + 4.8;

/**
 * Distance a parcel corner must keep from any road it does not belong to:
 * that road's carriageway, its pavement, and a little more, so neither a
 * lane corridor nor a walker's rail ever runs through a building.
 */
const PARCEL_FOREIGN_ROAD_CLEARANCE_M = 0.7;
/** Never trim a parcel to less than this, or drop it entirely. */
const MIN_PARCEL_HALF_LENGTH_M = 13;

/**
 * A parcel running alongside one side of one road segment. `side` is the sign
 * of the road's right-hand normal, so +1 is the kerb on the driver's right
 * travelling `from`->`to` and -1 the other one — it is NOT a compass. On a
 * road authored northward or westward the compass reading inverts, which is
 * exactly how seven parcels once shipped standing inside parks; the
 * block-vs-park invariant in `tests/content.test.ts` now holds the line.
 *
 * **The parcel's length is derived, not authored, and each end is trimmed
 * independently.** London's streets meet at whatever angle they meet at, and
 * on the inside of a shallow corner a deep parcel's far corner swings a long
 * way past the junction — far enough, on Smith Street, to land on the other
 * side of the King's Road. The parcel starts as long as its segment and the
 * end nearer each violation retreats a metre at a time until every foreign
 * road's carriageway and pavement is clear. The first version shrank
 * symmetrically about the segment midpoint, which threw away exactly as much
 * street wall at the clear end as the tight corner demanded at the other —
 * doubling every junction's bare apron for no reason. A parcel that cannot
 * keep `MIN_PARCEL_HALF_LENGTH_M` a side is dropped rather than shipped as a
 * slab in the road; the caller filters those out.
 *
 * `headingDeg` is the block-local yaw the collider builder and the facade grid
 * both read: local +x maps to world (cos, -sin), so a block whose long axis
 * follows a road heading (ux, uz) wants `atan2(-uz, ux)`.
 */
const roadsideParcel = (
  id: string,
  roadId: string,
  from: WorldPoint,
  to: WorldPoint,
  side: 1 | -1,
  roadWidthM: number,
  depthM: number,
  material: string,
  heightRange: readonly [number, number],
  density: number,
): ProceduralBlock | null => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const rightX = uz;
  const rightZ = -ux;
  const offset = blockInsetFor(roadWidthM) + depthM / 2;
  const centerX = (from.x + to.x) / 2 + rightX * side * offset;
  const centerZ = (from.z + to.z) / 2 + rightZ * side * offset;
  const foreign = [...londonQuarterSurfaces, ...londonGeneratedSurfaces]
    .filter((surface) => surface.id !== roadId)
    .map((surface) => ({
      centerline: surface.centerline,
      reach:
        surface.widthM / 2 +
        (surface.sidewalkWidthM ?? PAVED_SIDEWALK_WIDTH_M) +
        PARCEL_FOREIGN_ROAD_CLEARANCE_M,
    }));
  /**
   * Distance from a road segment to the parcel span [lo, hi] × ±depth/2, all
   * in the parcel's own frame (u along the road from the segment midpoint),
   * plus the u of the contact so the caller knows WHICH end to trim. Testing
   * the four corners instead is not enough and was the first thing tried: a
   * parcel whose long side straddles a crossing road has both corners
   * comfortably clear of it, one on each side.
   */
  const segmentToSpan = (
    a: WorldPoint,
    b: WorldPoint,
    lo: number,
    hi: number,
  ): { readonly d: number; readonly u: number } => {
    const local = (p: WorldPoint) => ({
      u: (p.x - centerX) * ux + (p.z - centerZ) * uz,
      v: (p.x - centerX) * rightX + (p.z - centerZ) * rightZ,
    });
    const halfDepth = depthM / 2;
    const clampU = (u: number) => Math.max(lo, Math.min(hi, u));
    const first = local(a);
    const second = local(b);
    const inside = (p: { u: number; v: number }) =>
      p.u >= lo && p.u <= hi && Math.abs(p.v) <= halfDepth;
    if (inside(first)) return { d: 0, u: first.u };
    if (inside(second)) return { d: 0, u: second.u };
    const du = second.u - first.u;
    const dv = second.v - first.v;
    const overlapsU =
      Math.min(first.u, second.u) <= hi && Math.max(first.u, second.u) >= lo;
    const overlapsV =
      Math.min(first.v, second.v) <= halfDepth &&
      Math.max(first.v, second.v) >= -halfDepth;
    if (overlapsU && overlapsV) {
      // Separating-axis test on the segment's own normal: express the span as
      // its centre + half-extents so the corner-spread arithmetic still holds.
      const mid = (lo + hi) / 2;
      const halfLength = (hi - lo) / 2;
      const normalLength = Math.hypot(du, dv);
      if (normalLength > 1e-9) {
        const nu = dv / normalLength;
        const nv = -du / normalLength;
        const offset = (first.u - mid) * nu + first.v * nv;
        const spread = Math.abs(nu) * halfLength + Math.abs(nv) * halfDepth;
        if (Math.abs(offset) <= spread) {
          return { d: 0, u: clampU((first.u + second.u) / 2) };
        }
      }
    }
    const pointToSpan = (p: { u: number; v: number }) => ({
      d: Math.hypot(
        Math.max(0, Math.max(lo - p.u, p.u - hi)),
        Math.max(0, Math.abs(p.v) - halfDepth),
      ),
      u: clampU(p.u),
    });
    const cornerToSegment = (cu: number, cv: number) => {
      const lengthSquared = du * du + dv * dv;
      const t =
        lengthSquared > 1e-9
          ? Math.max(
              0,
              Math.min(1, ((cu - first.u) * du + (cv - first.v) * dv) / lengthSquared),
            )
          : 0;
      return {
        d: Math.hypot(cu - (first.u + du * t), cv - (first.v + dv * t)),
        u: cu,
      };
    };
    const candidates = [
      pointToSpan(first),
      pointToSpan(second),
      cornerToSegment(hi, halfDepth),
      cornerToSegment(hi, -halfDepth),
      cornerToSegment(lo, halfDepth),
      cornerToSegment(lo, -halfDepth),
    ];
    let best = candidates[0];
    for (const candidate of candidates) {
      if (candidate.d < best.d) best = candidate;
    }
    return best;
  };
  /** Nearest violating contact across every foreign road, or null if clear. */
  const worstViolation = (
    lo: number,
    hi: number,
  ): { readonly u: number } | null => {
    let worst: { margin: number; u: number } | null = null;
    for (const road of foreign) {
      for (let index = 1; index < road.centerline.length; index += 1) {
        const { d, u } = segmentToSpan(
          road.centerline[index - 1],
          road.centerline[index],
          lo,
          hi,
        );
        const margin = d - road.reach;
        if (margin < 0 && (!worst || margin < worst.margin)) {
          worst = { margin, u };
        }
      }
    }
    return worst;
  };
  let lo = -(length / 2 - 12);
  let hi = length / 2 - 12;
  let guard = 0;
  while (hi - lo >= MIN_PARCEL_HALF_LENGTH_M * 2 && guard++ < 2048) {
    const violation = worstViolation(lo, hi);
    if (!violation) {
      const mid = (lo + hi) / 2;
      return {
        id,
        center: point(centerX + ux * mid, centerZ + uz * mid),
        size: point(hi - lo, depthM),
        headingDeg: (Math.atan2(-uz, ux) * 180) / Math.PI,
        frontageAxis: "z",
        heightRange,
        density,
        material,
      };
    }
    // Retreat only the end the violation is nearer to — the whole point.
    if (violation.u >= (lo + hi) / 2) {
      hi -= 1;
    } else {
      lo += 1;
    }
  }
  return null;
};

const nodeAt = (id: string): WorldPoint => londonNodeById.get(id)!.position;

/**
 * London stock brick — the yellow-grey that most of the city west of the City
 * is actually built out of. `london-brick` beside it is the redder Victorian
 * brick the quarter's own terraces use; the two together are what keeps a
 * residential street from reading as one repeated material.
 */
const LONDON_STOCK_BRICK = "london-stock-brick";
const LONDON_STUCCO = "white-stucco";
const LONDON_RED_BRICK = "london-brick";
/** Whitehall's stone. Only the civic quarter is built out of it. */
const LONDON_PORTLAND_STONE = "london-portland-stone";
/** The City's glass. The only material on the map that goes above 40 m. */
const LONDON_GLASS_CURTAIN = "london-glass-curtain";

const londonSouthWestBlocks: readonly ProceduralBlock[] = [
  // --- The King's Road: a continuous shopping street wall, both kerbs. -----
  roadsideParcel("london-block-kings-n-1", "london-kings-road", nodeAt("london-node-kings-west"), nodeAt("london-node-kings-earls"), -1, 9.4, 46, LONDON_STOCK_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-kings-s-1", "london-kings-road", nodeAt("london-node-kings-west"), nodeAt("london-node-kings-earls"), 1, 9.4, 40, LONDON_RED_BRICK, [10, 17], 0.7),
  roadsideParcel("london-block-kings-n-2", "london-kings-road", nodeAt("london-node-kings-earls"), nodeAt("london-node-kings-beaufort"), -1, 9.4, 44, LONDON_STUCCO, [12, 21], 0.76),
  roadsideParcel("london-block-kings-s-2", "london-kings-road", nodeAt("london-node-kings-earls"), nodeAt("london-node-kings-beaufort"), 1, 9.4, 38, LONDON_STOCK_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-kings-n-3", "london-kings-road", nodeAt("london-node-kings-beaufort"), nodeAt("london-node-kings-gloucester"), -1, 9.4, 44, LONDON_STOCK_BRICK, [12, 22], 0.78),
  roadsideParcel("london-block-kings-n-4", "london-kings-road", nodeAt("london-node-kings-gloucester"), nodeAt("london-node-kings-queens"), -1, 9.4, 46, LONDON_STUCCO, [13, 22], 0.78),
  roadsideParcel("london-block-kings-s-4", "london-kings-road", nodeAt("london-node-kings-gloucester"), nodeAt("london-node-kings-queens"), 1, 9.4, 34, LONDON_STUCCO, [12, 20], 0.7),
  roadsideParcel("london-block-kings-n-5", "london-kings-road", nodeAt("london-node-kings-queens"), nodeAt("london-node-sloane-arm-kings"), -1, 9.4, 48, LONDON_RED_BRICK, [13, 23], 0.78),
  roadsideParcel("london-block-kings-s-5", "london-kings-road", nodeAt("london-node-kings-queens"), nodeAt("london-node-sloane-arm-kings"), 1, 9.4, 36, LONDON_STOCK_BRICK, [12, 20], 0.72),

  // --- Chelsea below the King's Road: stucco terraces round the mews. ------
  roadsideParcel("london-block-hospital-n-1", "london-royal-hospital-road", nodeAt("london-node-hospital-west"), nodeAt("london-node-hospital-mid"), -1, 8, 40, LONDON_STUCCO, [12, 20], 0.72),
  roadsideParcel("london-block-hospital-s-1", "london-royal-hospital-road", nodeAt("london-node-hospital-west"), nodeAt("london-node-hospital-mid"), 1, 8, 34, LONDON_RED_BRICK, [11, 18], 0.68),
  roadsideParcel("london-block-hospital-n-2", "london-royal-hospital-road", nodeAt("london-node-hospital-mid"), nodeAt("london-node-hospital-east"), -1, 8, 38, LONDON_STUCCO, [12, 21], 0.74),
  roadsideParcel("london-block-hospital-s-2", "london-royal-hospital-road", nodeAt("london-node-hospital-mid"), nodeAt("london-node-hospital-east"), 1, 8, 32, LONDON_STOCK_BRICK, [11, 18], 0.68),
  roadsideParcel("london-block-cheyne-s", "london-cheyne-mews", nodeAt("london-node-cheyne-1"), nodeAt("london-node-cheyne-2"), 1, 6.8, 26, LONDON_RED_BRICK, [9, 15], 0.66),

  // --- Chelsea's north-south links. ---------------------------------------
  roadsideParcel("london-block-manor-w", "london-chelsea-manor", nodeAt("london-node-kings-gloucester"), nodeAt("london-node-hospital-west"), 1, 7.4, 34, LONDON_STUCCO, [12, 20], 0.72),
  roadsideParcel("london-block-flood-e", "london-flood-street", nodeAt("london-node-kings-queens"), nodeAt("london-node-flood-mid"), -1, 7.2, 36, LONDON_STUCCO, [12, 20], 0.72),
  roadsideParcel("london-block-flood-e-2", "london-flood-street", nodeAt("london-node-flood-mid"), nodeAt("london-node-hospital-mid"), -1, 7.2, 32, LONDON_RED_BRICK, [11, 18], 0.7),
  roadsideParcel("london-block-smith-e", "london-smith-street", nodeAt("london-node-hospital-east"), nodeAt("london-node-smith-approach"), 1, 7.6, 34, LONDON_RED_BRICK, [12, 20], 0.72),

  // --- Gloucester Road / Drayton Gardens / Sydney Street. ------------------
  roadsideParcel("london-block-gloucester-s-w", "london-gloucester-south", nodeAt("london-node-gloucester-south"), nodeAt("london-node-gloucester-mid"), 1, 7.8, 40, LONDON_STUCCO, [12, 21], 0.74),
  roadsideParcel("london-block-gloucester-s-e", "london-gloucester-south", nodeAt("london-node-gloucester-mid"), nodeAt("london-node-kings-gloucester"), -1, 7.8, 44, LONDON_RED_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-drayton-w", "london-drayton-gardens", nodeAt("london-node-queen-gate-south"), nodeAt("london-node-drayton-mid"), 1, 7.4, 38, LONDON_STUCCO, [12, 21], 0.74),
  roadsideParcel("london-block-drayton-e", "london-drayton-gardens", nodeAt("london-node-drayton-mid"), nodeAt("london-node-kings-queens"), -1, 7.4, 40, LONDON_RED_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-sydney-w", "london-sydney-street", nodeAt("london-node-cromwell-far-east"), nodeAt("london-node-sydney-mid"), 1, 7.8, 36, LONDON_RED_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-sydney-e", "london-sydney-street", nodeAt("london-node-sydney-mid"), nodeAt("london-node-sloane-arm-sydney"), -1, 7.8, 34, LONDON_STOCK_BRICK, [11, 18], 0.7),

  // --- Earls Court and Warwick Road: brick terraces, tighter and lower. ----
  roadsideParcel("london-block-earls-w-1", "london-earls-court-road", nodeAt("london-node-earls-nevern"), nodeAt("london-node-earls-north"), 1, 8.6, 40, LONDON_STOCK_BRICK, [11, 18], 0.74),
  roadsideParcel("london-block-earls-e-1", "london-earls-court-road", nodeAt("london-node-earls-nevern"), nodeAt("london-node-earls-north"), -1, 8.6, 44, LONDON_RED_BRICK, [10, 17], 0.72),
  roadsideParcel("london-block-earls-w-2", "london-earls-court-road", nodeAt("london-node-earls-north"), nodeAt("london-node-earls-crescent"), 1, 8.6, 42, LONDON_RED_BRICK, [11, 18], 0.74),
  roadsideParcel("london-block-earls-e-2", "london-earls-court-road", nodeAt("london-node-earls-north"), nodeAt("london-node-earls-crescent"), -1, 8.6, 46, LONDON_STOCK_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-earls-w-3", "london-earls-court-road", nodeAt("london-node-earls-crescent"), nodeAt("london-node-earls-brompton"), 1, 8.6, 40, LONDON_STOCK_BRICK, [10, 17], 0.72),
  roadsideParcel("london-block-earls-e-3", "london-earls-court-road", nodeAt("london-node-earls-crescent"), nodeAt("london-node-earls-brompton"), -1, 8.6, 44, LONDON_STUCCO, [11, 19], 0.74),
  roadsideParcel("london-block-earls-e-4", "london-earls-court-road", nodeAt("london-node-earls-brompton"), nodeAt("london-node-kings-earls"), -1, 8.6, 46, LONDON_RED_BRICK, [10, 17], 0.72),
  roadsideParcel("london-block-warwick-e-1", "london-warwick-road", nodeAt("london-node-warwick-north"), nodeAt("london-node-warwick-mid"), -1, 8.6, 42, LONDON_STOCK_BRICK, [10, 17], 0.7),
  roadsideParcel("london-block-warwick-e-2", "london-warwick-road", nodeAt("london-node-warwick-mid"), nodeAt("london-node-warwick-south"), -1, 8.6, 40, LONDON_RED_BRICK, [10, 16], 0.68),
  roadsideParcel("london-block-warwick-w-1", "london-warwick-road", nodeAt("london-node-warwick-north"), nodeAt("london-node-warwick-mid"), 1, 8.6, 34, LONDON_RED_BRICK, [9, 15], 0.66),

  // --- Nevern Place and the crescent's outer arc. --------------------------
  roadsideParcel("london-block-nevern-n", "london-nevern-place", nodeAt("london-node-warwick-north"), nodeAt("london-node-nevern-mid"), -1, 7.2, 32, LONDON_STOCK_BRICK, [10, 16], 0.68),
  roadsideParcel("london-block-nevern-n-2", "london-nevern-place", nodeAt("london-node-nevern-mid"), nodeAt("london-node-earls-nevern"), -1, 7.2, 32, LONDON_STUCCO, [10, 17], 0.7),
  roadsideParcel("london-block-crescent-1", "london-pembroke-crescent", nodeAt("london-node-crescent-1"), nodeAt("london-node-crescent-2"), -1, 7.4, 30, LONDON_STUCCO, [11, 18], 0.74),
  roadsideParcel("london-block-crescent-2", "london-pembroke-crescent", nodeAt("london-node-crescent-2"), nodeAt("london-node-crescent-3"), -1, 7.4, 30, LONDON_STUCCO, [11, 18], 0.74),
  roadsideParcel("london-block-crescent-3", "london-pembroke-crescent", nodeAt("london-node-crescent-3"), nodeAt("london-node-crescent-4"), -1, 7.4, 30, LONDON_STUCCO, [11, 18], 0.74),
  roadsideParcel("london-block-crescent-4", "london-pembroke-crescent", nodeAt("london-node-crescent-4"), nodeAt("london-node-crescent-5"), -1, 7.4, 30, LONDON_STUCCO, [11, 18], 0.74),

  // --- Old Brompton Road back east to Gloucester Road. ---------------------
  roadsideParcel("london-block-brompton-n-1", "london-old-brompton", nodeAt("london-node-earls-brompton"), nodeAt("london-node-brompton-mid"), -1, 8.6, 44, LONDON_STOCK_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-brompton-s-1", "london-old-brompton", nodeAt("london-node-earls-brompton"), nodeAt("london-node-brompton-mid"), 1, 8.6, 40, LONDON_RED_BRICK, [10, 18], 0.72),
  roadsideParcel("london-block-brompton-n-2", "london-old-brompton", nodeAt("london-node-brompton-mid"), nodeAt("london-node-gloucester-south"), -1, 8.6, 44, LONDON_STUCCO, [12, 20], 0.76),
  roadsideParcel("london-block-brompton-s-2", "london-old-brompton", nodeAt("london-node-brompton-mid"), nodeAt("london-node-gloucester-south"), 1, 8.6, 40, LONDON_STOCK_BRICK, [11, 19], 0.74),

  // --- The embankments. Only the landward kerb carries a street wall: the
  // parcel trimmer measures against roads, not water, so a parcel on the
  // river side would be shortened by nothing and end up in the Thames. Both
  // embankments run west to east, whose right-hand normal points south, so
  // the landward side is -1 on the north bank and +1 on the south. ---------
  roadsideParcel("london-block-chelsea-emb-1", "london-chelsea-embankment", nodeAt("london-node-chelsea-emb-west"), nodeAt("london-node-chelsea-emb-1"), -1, 10.4, 44, LONDON_RED_BRICK, [12, 20], 0.72),
  roadsideParcel("london-block-chelsea-emb-2", "london-chelsea-embankment", nodeAt("london-node-chelsea-emb-1"), nodeAt("london-node-chelsea-emb-2"), -1, 10.4, 46, LONDON_STUCCO, [14, 24], 0.76),
  roadsideParcel("london-block-chelsea-emb-3", "london-chelsea-embankment", nodeAt("london-node-chelsea-emb-2"), nodeAt("london-node-albert-north"), -1, 10.4, 46, LONDON_STUCCO, [14, 24], 0.78),
  roadsideParcel("london-block-chelsea-emb-4", "london-chelsea-embankment", nodeAt("london-node-albert-north"), nodeAt("london-node-chelsea-emb-3"), -1, 10.4, 44, LONDON_RED_BRICK, [13, 22], 0.76),
  roadsideParcel("london-block-chelsea-emb-5", "london-chelsea-embankment", nodeAt("london-node-chelsea-emb-3"), nodeAt("london-node-embankment-join"), -1, 10.4, 42, LONDON_STOCK_BRICK, [12, 21], 0.74),
  roadsideParcel("london-block-victoria-emb-1", "london-victoria-embankment", nodeAt("london-node-embankment-join"), nodeAt("london-node-victoria-emb-1"), -1, 11.4, 48, LONDON_STOCK_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-victoria-emb-2", "london-victoria-embankment", nodeAt("london-node-victoria-emb-1"), nodeAt("london-node-westminster-north"), -1, 11.4, 50, LONDON_STUCCO, [15, 26], 0.78),
  roadsideParcel("london-block-victoria-emb-3", "london-victoria-embankment", nodeAt("london-node-westminster-north"), nodeAt("london-node-victoria-emb-2"), -1, 11.4, 50, LONDON_STUCCO, [15, 26], 0.78),
  roadsideParcel("london-block-victoria-emb-4", "london-victoria-embankment", nodeAt("london-node-victoria-emb-2"), nodeAt("london-node-tower-north"), -1, 11.4, 48, LONDON_RED_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-lots-w", "london-lots-road", nodeAt("london-node-kings-west"), nodeAt("london-node-lots-mid"), 1, 8, 36, LONDON_RED_BRICK, [10, 17], 0.7),
  roadsideParcel("london-block-oakley-e", "london-oakley-street", nodeAt("london-node-hospital-west"), nodeAt("london-node-albert-north"), -1, 8, 34, LONDON_STUCCO, [12, 20], 0.72),

  // --- The south bank. Riverbank's landward kerb between riverbank-1 and
  // riverbank-2 is deliberately bare: Battersea Park's strip runs in exactly
  // that band, and the first shipped parcel there stood 39 m inside the lawn.
  // The park fronting the kerb IS the streetscape for that stretch. ---------
  roadsideParcel("london-block-riverbank-1", "london-riverbank", nodeAt("london-node-riverbank-west"), nodeAt("london-node-riverbank-1"), 1, 10.4, 44, LONDON_RED_BRICK, [10, 18], 0.7),
  roadsideParcel("london-block-riverbank-2", "london-riverbank", nodeAt("london-node-albert-south"), nodeAt("london-node-riverbank-2"), 1, 10.4, 46, LONDON_STOCK_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-riverbank-3", "london-riverbank", nodeAt("london-node-riverbank-2"), nodeAt("london-node-riverbank-3"), 1, 10.4, 46, LONDON_RED_BRICK, [12, 20], 0.74),
  roadsideParcel("london-block-riverbank-4", "london-riverbank", nodeAt("london-node-riverbank-3"), nodeAt("london-node-westminster-south"), 1, 10.4, 44, LONDON_STOCK_BRICK, [12, 21], 0.74),
  roadsideParcel("london-block-riverbank-5", "london-riverbank", nodeAt("london-node-westminster-south"), nodeAt("london-node-riverbank-4"), 1, 10.4, 46, LONDON_STUCCO, [13, 22], 0.76),
  roadsideParcel("london-block-riverbank-6", "london-riverbank", nodeAt("london-node-riverbank-4"), nodeAt("london-node-tower-south"), 1, 10.4, 46, LONDON_RED_BRICK, [12, 21], 0.74),
  roadsideParcel("london-block-riverbank-7", "london-riverbank", nodeAt("london-node-tower-south"), nodeAt("london-node-riverbank-east"), 1, 10.4, 42, LONDON_STOCK_BRICK, [11, 19], 0.72),
  // Battersea Park Road's north kerb between battersea-1 and battersea-albert
  // carries no parcel on purpose — Battersea Park's strip fronts that kerb
  // directly (the shipped parcel there stood 19 m inside the park).
  roadsideParcel("london-block-battersea-s-1", "london-battersea-road", nodeAt("london-node-battersea-west"), nodeAt("london-node-battersea-1"), 1, 8.6, 38, LONDON_STOCK_BRICK, [9, 16], 0.68),
  roadsideParcel("london-block-battersea-s-2", "london-battersea-road", nodeAt("london-node-battersea-1"), nodeAt("london-node-battersea-albert"), 1, 8.6, 38, LONDON_RED_BRICK, [9, 16], 0.68),
  roadsideParcel("london-block-battersea-n-2", "london-battersea-road", nodeAt("london-node-battersea-albert"), nodeAt("london-node-battersea-2"), -1, 8.6, 36, LONDON_STOCK_BRICK, [10, 17], 0.7),
  roadsideParcel("london-block-battersea-s-3", "london-battersea-road", nodeAt("london-node-battersea-albert"), nodeAt("london-node-battersea-2"), 1, 8.6, 38, LONDON_STUCCO, [10, 17], 0.7),
  roadsideParcel("london-block-battersea-n-3", "london-battersea-road", nodeAt("london-node-battersea-2"), nodeAt("london-node-battersea-nine"), -1, 8.6, 36, LONDON_RED_BRICK, [10, 18], 0.7),
  roadsideParcel("london-block-battersea-s-4", "london-battersea-road", nodeAt("london-node-battersea-2"), nodeAt("london-node-battersea-nine"), 1, 8.6, 38, LONDON_STOCK_BRICK, [10, 18], 0.7),
  roadsideParcel("london-block-battersea-n-4", "london-battersea-road", nodeAt("london-node-battersea-nine"), nodeAt("london-node-battersea-3"), -1, 8.6, 36, LONDON_STUCCO, [11, 19], 0.72),
  roadsideParcel("london-block-battersea-s-5", "london-battersea-road", nodeAt("london-node-battersea-nine"), nodeAt("london-node-battersea-3"), 1, 8.6, 38, LONDON_RED_BRICK, [10, 18], 0.7),
  roadsideParcel("london-block-battersea-n-5", "london-battersea-road", nodeAt("london-node-battersea-3"), nodeAt("london-node-battersea-east"), -1, 8.6, 36, LONDON_STOCK_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-battersea-s-6", "london-battersea-road", nodeAt("london-node-battersea-3"), nodeAt("london-node-battersea-east"), 1, 8.6, 38, LONDON_STUCCO, [11, 19], 0.72),
  roadsideParcel("london-block-parkgate-e", "london-parkgate", nodeAt("london-node-albert-south"), nodeAt("london-node-battersea-albert"), -1, 7.6, 32, LONDON_RED_BRICK, [10, 17], 0.7),
  roadsideParcel("london-block-nine-elms-e", "london-nine-elms", nodeAt("london-node-riverbank-3"), nodeAt("london-node-battersea-nine"), -1, 7.6, 32, LONDON_STOCK_BRICK, [11, 19], 0.72),
  roadsideParcel("london-block-tooley-w", "london-tooley-street", nodeAt("london-node-battersea-east"), nodeAt("london-node-riverbank-east"), -1, 7.6, 32, LONDON_RED_BRICK, [11, 19], 0.72),

  // --- Knightsbridge and Brompton: mansion blocks and shopfronts. ----------
  roadsideParcel("london-block-knights-s-1", "london-knightsbridge", nodeAt("london-node-kensington-exhibition"), nodeAt("london-node-knights-brompton"), 1, 10.4, 48, LONDON_RED_BRICK, [16, 26], 0.8),
  roadsideParcel("london-block-knights-n-1", "london-knightsbridge", nodeAt("london-node-kensington-exhibition"), nodeAt("london-node-knights-brompton"), -1, 10.4, 44, LONDON_STUCCO, [15, 24], 0.78),
  roadsideParcel("london-block-knights-n-2", "london-knightsbridge", nodeAt("london-node-knights-brompton"), nodeAt("london-node-knights-sloane"), -1, 10.4, 42, LONDON_RED_BRICK, [15, 24], 0.78),
  roadsideParcel("london-block-brompton-rd-e", "london-brompton-road", nodeAt("london-node-cromwell-far-east"), nodeAt("london-node-brompton-rise"), 1, 10.4, 44, LONDON_RED_BRICK, [14, 23], 0.78),
  roadsideParcel("london-block-brompton-rd-w", "london-brompton-road", nodeAt("london-node-cromwell-far-east"), nodeAt("london-node-brompton-rise"), -1, 10.4, 40, LONDON_STUCCO, [14, 22], 0.76),
  roadsideParcel("london-block-brompton-rd-e2", "london-brompton-road", nodeAt("london-node-brompton-rise"), nodeAt("london-node-knights-brompton"), -1, 10.4, 42, LONDON_STOCK_BRICK, [15, 24], 0.78),

  // --- Mayfair and the West End. ------------------------------------------
  roadsideParcel("london-block-park-lane-e-1", "london-park-lane", nodeAt("london-node-wellington-arm-park"), nodeAt("london-node-park-lane-mid"), 1, 13.6, 52, LONDON_STUCCO, [18, 30], 0.8),
  roadsideParcel("london-block-park-lane-e-2", "london-park-lane", nodeAt("london-node-park-lane-mid"), nodeAt("london-node-park-lane-oxford"), 1, 13.6, 50, LONDON_RED_BRICK, [17, 28], 0.8),
  roadsideParcel("london-block-park-lane-e-3", "london-park-lane", nodeAt("london-node-park-lane-oxford"), nodeAt("london-node-park-corner-north-east"), 1, 13.6, 50, LONDON_STOCK_BRICK, [16, 27], 0.78),
  roadsideParcel("london-block-piccadilly-s-1", "london-piccadilly", nodeAt("london-node-wellington-arm-piccadilly"), nodeAt("london-node-piccadilly-mid"), 1, 10.4, 46, LONDON_STUCCO, [16, 27], 0.8),
  roadsideParcel("london-block-piccadilly-n-1", "london-piccadilly", nodeAt("london-node-wellington-arm-piccadilly"), nodeAt("london-node-piccadilly-mid"), -1, 10.4, 46, LONDON_RED_BRICK, [16, 26], 0.8),
  roadsideParcel("london-block-piccadilly-s-2", "london-piccadilly", nodeAt("london-node-piccadilly-mid"), nodeAt("london-node-piccadilly-east"), 1, 10.4, 44, LONDON_RED_BRICK, [16, 27], 0.8),
  roadsideParcel("london-block-piccadilly-n-2", "london-piccadilly", nodeAt("london-node-piccadilly-mid"), nodeAt("london-node-piccadilly-east"), -1, 10.4, 44, LONDON_STOCK_BRICK, [16, 26], 0.8),
  roadsideParcel("london-block-regent-w-1", "london-regent", nodeAt("london-node-regent-1"), nodeAt("london-node-regent-2"), -1, 10.4, 40, LONDON_STUCCO, [17, 27], 0.8),
  roadsideParcel("london-block-regent-e-1", "london-regent", nodeAt("london-node-regent-1"), nodeAt("london-node-regent-2"), 1, 10.4, 40, LONDON_STUCCO, [17, 27], 0.8),
  roadsideParcel("london-block-regent-w-2", "london-regent", nodeAt("london-node-regent-3"), nodeAt("london-node-regent-4"), -1, 10.4, 40, LONDON_RED_BRICK, [17, 27], 0.8),
  roadsideParcel("london-block-regent-e-2", "london-regent", nodeAt("london-node-regent-3"), nodeAt("london-node-regent-4"), 1, 10.4, 40, LONDON_STOCK_BRICK, [17, 27], 0.8),
  roadsideParcel("london-block-regent-w-3", "london-regent", nodeAt("london-node-regent-4"), nodeAt("london-node-regent-5"), -1, 10.4, 38, LONDON_STUCCO, [17, 27], 0.8),
  roadsideParcel("london-block-regent-e-3", "london-regent", nodeAt("london-node-regent-4"), nodeAt("london-node-regent-5"), 1, 10.4, 38, LONDON_RED_BRICK, [17, 27], 0.8),
  roadsideParcel("london-block-oxford-n-1", "london-oxford-street", nodeAt("london-node-park-lane-oxford"), nodeAt("london-node-oxford-mid"), -1, 10.4, 46, LONDON_STOCK_BRICK, [16, 26], 0.8),
  roadsideParcel("london-block-oxford-s-1", "london-oxford-street", nodeAt("london-node-park-lane-oxford"), nodeAt("london-node-oxford-mid"), 1, 10.4, 46, LONDON_RED_BRICK, [16, 26], 0.8),
  roadsideParcel("london-block-oxford-n-2", "london-oxford-street", nodeAt("london-node-oxford-mid"), nodeAt("london-node-regent-oxford"), -1, 10.4, 46, LONDON_STUCCO, [16, 27], 0.8),
  roadsideParcel("london-block-oxford-s-2", "london-oxford-street", nodeAt("london-node-oxford-mid"), nodeAt("london-node-regent-oxford"), 1, 10.4, 46, LONDON_STOCK_BRICK, [16, 27], 0.8),
  roadsideParcel("london-block-bayswater-n-1", "london-bayswater", nodeAt("london-node-park-corner-north-west"), nodeAt("london-node-bayswater-mid"), -1, 10.4, 46, LONDON_STUCCO, [14, 23], 0.76),
  roadsideParcel("london-block-bayswater-n-2", "london-bayswater", nodeAt("london-node-bayswater-mid"), nodeAt("london-node-park-corner-north-east"), -1, 10.4, 46, LONDON_RED_BRICK, [14, 23], 0.76),
  roadsideParcel("london-block-park-west-w", "london-park-west", nodeAt("london-node-gloucester-kensington"), nodeAt("london-node-park-corner-north-west"), -1, 9, 44, LONDON_STOCK_BRICK, [13, 22], 0.74),

  // --- Belgravia and Westminster: Portland-stone civic frontage. -----------
  roadsideParcel("london-block-grosvenor-w", "london-grosvenor", nodeAt("london-node-wellington-arm-grosvenor"), nodeAt("london-node-grosvenor-mid"), 1, 9.6, 44, LONDON_STUCCO, [16, 26], 0.78),
  roadsideParcel("london-block-grosvenor-e", "london-grosvenor", nodeAt("london-node-grosvenor-mid"), nodeAt("london-node-victoria-arm-grosvenor"), -1, 9.6, 40, LONDON_PORTLAND_STONE, [17, 28], 0.78),
  roadsideParcel("london-block-buckingham-s-1", "london-buckingham-palace-road", nodeAt("london-node-sloane-arm-buckingham"), nodeAt("london-node-buckingham-1"), 1, 9.6, 40, LONDON_STUCCO, [14, 23], 0.76),
  roadsideParcel("london-block-buckingham-s-2", "london-buckingham-palace-road", nodeAt("london-node-buckingham-1"), nodeAt("london-node-buckingham-2"), 1, 9.6, 40, LONDON_RED_BRICK, [14, 23], 0.76),
  roadsideParcel("london-block-buckingham-n-1", "london-buckingham-palace-road", nodeAt("london-node-buckingham-1"), nodeAt("london-node-buckingham-2"), -1, 9.6, 36, LONDON_PORTLAND_STONE, [16, 26], 0.78),
  roadsideParcel("london-block-mall-n", "london-mall", nodeAt("london-node-victoria-arm-mall"), nodeAt("london-node-mall-mid"), -1, 10.4, 42, LONDON_PORTLAND_STONE, [18, 28], 0.78),
  roadsideParcel("london-block-mall-n-2", "london-mall", nodeAt("london-node-mall-mid"), nodeAt("london-node-mall-east"), -1, 10.4, 42, LONDON_PORTLAND_STONE, [18, 28], 0.78),
  roadsideParcel("london-block-whitehall-e", "london-whitehall", nodeAt("london-node-mall-east"), nodeAt("london-node-whitehall-mid"), -1, 10.4, 44, LONDON_PORTLAND_STONE, [19, 30], 0.8),
  roadsideParcel("london-block-whitehall-w", "london-whitehall", nodeAt("london-node-mall-east"), nodeAt("london-node-whitehall-mid"), 1, 10.4, 44, LONDON_PORTLAND_STONE, [19, 30], 0.8),
  roadsideParcel("london-block-victoria-st-n", "london-victoria-street", nodeAt("london-node-victoria-street-1"), nodeAt("london-node-victoria-street-2"), 1, 10.4, 44, LONDON_PORTLAND_STONE, [18, 29], 0.8),
  roadsideParcel("london-block-victoria-st-s", "london-victoria-street", nodeAt("london-node-victoria-street-1"), nodeAt("london-node-victoria-street-2"), -1, 10.4, 44, LONDON_STOCK_BRICK, [16, 26], 0.78),

  // --- The City: the tallest thing on the map, and the tightest fabric. ----
  roadsideParcel("london-block-wall-n-1", "london-london-wall", nodeAt("london-node-piccadilly-east"), nodeAt("london-node-london-wall-mid"), -1, 10.4, 52, LONDON_GLASS_CURTAIN, [26, 48], 0.82),
  roadsideParcel("london-block-wall-s-1", "london-london-wall", nodeAt("london-node-piccadilly-east"), nodeAt("london-node-london-wall-mid"), 1, 10.4, 48, LONDON_PORTLAND_STONE, [22, 38], 0.8),
  roadsideParcel("london-block-wall-n-2", "london-london-wall", nodeAt("london-node-london-wall-mid"), nodeAt("london-node-bishopsgate-1"), -1, 10.4, 50, LONDON_GLASS_CURTAIN, [28, 52], 0.82),
  roadsideParcel("london-block-wall-s-2", "london-london-wall", nodeAt("london-node-london-wall-mid"), nodeAt("london-node-bishopsgate-1"), 1, 10.4, 46, LONDON_GLASS_CURTAIN, [26, 46], 0.82),
  roadsideParcel("london-block-bishopsgate-w-1", "london-bishopsgate", nodeAt("london-node-bank-arm-north"), nodeAt("london-node-bishopsgate-1"), -1, 10.4, 50, LONDON_GLASS_CURTAIN, [30, 58], 0.84),
  roadsideParcel("london-block-bishopsgate-e-1", "london-bishopsgate", nodeAt("london-node-bank-arm-north"), nodeAt("london-node-bishopsgate-1"), 1, 10.4, 50, LONDON_PORTLAND_STONE, [24, 42], 0.82),
  roadsideParcel("london-block-bishopsgate-w-2", "london-bishopsgate", nodeAt("london-node-bishopsgate-1"), nodeAt("london-node-bishopsgate-2"), -1, 10.4, 44, LONDON_STOCK_BRICK, [18, 30], 0.78),
  roadsideParcel("london-block-bishopsgate-e-2", "london-bishopsgate", nodeAt("london-node-bishopsgate-1"), nodeAt("london-node-bishopsgate-2"), 1, 10.4, 44, LONDON_RED_BRICK, [16, 28], 0.78),
  roadsideParcel("london-block-bishopsgate-w-3", "london-bishopsgate", nodeAt("london-node-bishopsgate-2"), nodeAt("london-node-islington-arm-south"), -1, 10.4, 44, LONDON_RED_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-bishopsgate-e-3", "london-bishopsgate", nodeAt("london-node-bishopsgate-2"), nodeAt("london-node-islington-arm-south"), 1, 10.4, 44, LONDON_STOCK_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-king-william-e", "london-king-william", nodeAt("london-node-tower-north"), nodeAt("london-node-king-william-mid"), 1, 9.6, 44, LONDON_GLASS_CURTAIN, [24, 44], 0.82),
  roadsideParcel("london-block-king-william-w", "london-king-william", nodeAt("london-node-king-william-mid"), nodeAt("london-node-bank-arm-south"), -1, 9.6, 42, LONDON_PORTLAND_STONE, [22, 38], 0.8),
  roadsideParcel("london-block-cornmarket-w", "london-cornmarket", nodeAt("london-node-bank-arm-west"), nodeAt("london-node-cornmarket-mid"), -1, 8.6, 40, LONDON_PORTLAND_STONE, [20, 34], 0.8),
  roadsideParcel("london-block-cornmarket-e", "london-cornmarket", nodeAt("london-node-cornmarket-mid"), nodeAt("london-node-london-wall-mid"), 1, 8.6, 40, LONDON_GLASS_CURTAIN, [24, 42], 0.82),
  roadsideParcel("london-block-leadenhall-n", "london-leadenhall", nodeAt("london-node-bank-arm-east"), nodeAt("london-node-leadenhall-mid"), -1, 8.6, 44, LONDON_GLASS_CURTAIN, [26, 50], 0.82),
  roadsideParcel("london-block-leadenhall-s", "london-leadenhall", nodeAt("london-node-bank-arm-east"), nodeAt("london-node-leadenhall-mid"), 1, 8.6, 42, LONDON_PORTLAND_STONE, [20, 36], 0.8),
  roadsideParcel("london-block-leadenhall-n-2", "london-leadenhall", nodeAt("london-node-leadenhall-mid"), nodeAt("london-node-leadenhall-east"), -1, 8.6, 42, LONDON_STOCK_BRICK, [18, 30], 0.78),
  roadsideParcel("london-block-minories-e", "london-minories", nodeAt("london-node-leadenhall-east"), nodeAt("london-node-minories-mid"), -1, 8.6, 42, LONDON_RED_BRICK, [16, 28], 0.78),
  roadsideParcel("london-block-minories-w", "london-minories", nodeAt("london-node-minories-mid"), nodeAt("london-node-tower-north"), 1, 8.6, 40, LONDON_STOCK_BRICK, [16, 27], 0.78),

  // --- Soho, Fitzrovia and the Euston Road. -------------------------------
  roadsideParcel("london-block-oxford-n-3", "london-oxford-street", nodeAt("london-node-regent-oxford"), nodeAt("london-node-oxford-east"), -1, 10.4, 46, LONDON_STOCK_BRICK, [16, 27], 0.8),
  roadsideParcel("london-block-oxford-s-3", "london-oxford-street", nodeAt("london-node-regent-oxford"), nodeAt("london-node-oxford-east"), 1, 10.4, 46, LONDON_RED_BRICK, [16, 27], 0.8),
  roadsideParcel("london-block-oxford-n-4", "london-oxford-street", nodeAt("london-node-oxford-east"), nodeAt("london-node-islington-arm-west"), -1, 10.4, 44, LONDON_STUCCO, [15, 25], 0.78),
  roadsideParcel("london-block-portland-w", "london-great-portland", nodeAt("london-node-oxford-mid"), nodeAt("london-node-great-portland-mid"), -1, 8.6, 42, LONDON_STOCK_BRICK, [15, 25], 0.78),
  roadsideParcel("london-block-portland-e", "london-great-portland", nodeAt("london-node-great-portland-mid"), nodeAt("london-node-euston-soho"), 1, 8.6, 42, LONDON_RED_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-euston-s-1", "london-euston", nodeAt("london-node-euston-soho"), nodeAt("london-node-euston-mid"), 1, 11.4, 46, LONDON_STOCK_BRICK, [15, 26], 0.78),
  roadsideParcel("london-block-euston-n-1", "london-euston", nodeAt("london-node-euston-soho"), nodeAt("london-node-euston-mid"), -1, 11.4, 44, LONDON_RED_BRICK, [14, 24], 0.76),
  roadsideParcel("london-block-euston-s-2", "london-euston", nodeAt("london-node-euston-mid"), nodeAt("london-node-euston-east"), 1, 11.4, 46, LONDON_PORTLAND_STONE, [16, 28], 0.78),
  roadsideParcel("london-block-euston-n-2", "london-euston", nodeAt("london-node-euston-mid"), nodeAt("london-node-euston-east"), -1, 11.4, 44, LONDON_STOCK_BRICK, [14, 24], 0.76),

  // --- Islington-ish: brick terraces and corner pubs. ---------------------
  roadsideParcel("london-block-upper-w", "london-upper-street", nodeAt("london-node-islington-arm-north"), nodeAt("london-node-upper-street-mid"), -1, 9.6, 42, LONDON_RED_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-upper-e", "london-upper-street", nodeAt("london-node-islington-arm-north"), nodeAt("london-node-upper-street-mid"), 1, 9.6, 42, LONDON_STOCK_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-upper-w-2", "london-upper-street", nodeAt("london-node-upper-street-mid"), nodeAt("london-node-euston-east"), -1, 9.6, 40, LONDON_STOCK_BRICK, [11, 18], 0.72),
  roadsideParcel("london-block-canonbury-n", "london-canonbury", nodeAt("london-node-upper-street-mid"), nodeAt("london-node-canonbury-east"), -1, 8, 40, LONDON_RED_BRICK, [10, 17], 0.72),
  roadsideParcel("london-block-canonbury-s", "london-canonbury", nodeAt("london-node-upper-street-mid"), nodeAt("london-node-canonbury-east"), 1, 8, 40, LONDON_STOCK_BRICK, [10, 17], 0.72),
  roadsideParcel("london-block-shoreditch-e", "london-shoreditch", nodeAt("london-node-canonbury-east"), nodeAt("london-node-shoreditch-mid"), -1, 8, 40, LONDON_STOCK_BRICK, [11, 19], 0.74),
  roadsideParcel("london-block-shoreditch-w", "london-shoreditch", nodeAt("london-node-shoreditch-mid"), nodeAt("london-node-bishopsgate-2"), 1, 8, 38, LONDON_RED_BRICK, [11, 19], 0.74),
].filter((block): block is ProceduralBlock => block !== null);

// ---------------------------------------------------------------------------
// Generated junction control: UK signals on the arterial crossings.
// ---------------------------------------------------------------------------

const londonSurfaceById = new Map(
  londonGeneratedSurfaces.map((surface) => [surface.id, surface]),
);

const laneLengthOf = (lane: LaneSegment): number =>
  lane.centerline
    .slice(1)
    .reduce(
      (total, current, index) =>
        total + distanceBetweenPoints(lane.centerline[index], current),
      0,
    );

const posePointAlongLane = (
  lane: LaneSegment,
  distanceAlongM: number,
): { readonly position: WorldPoint; readonly headingDeg: number } => {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = distanceBetweenPoints(start, end);
    if (remaining <= length || index === lane.centerline.length - 2) {
      const amount = length > 0 ? Math.min(1, remaining / length) : 0;
      return {
        position: point(
          start.x + (end.x - start.x) * amount,
          start.z + (end.z - start.z) * amount,
        ),
        headingDeg: (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI,
      };
    }
    remaining -= length;
  }
  return { position: lane.centerline.at(-1)!, headingDeg: 0 };
};

/** Where the stop bar sits, measured back from the junction node. */
const LONDON_SIGNAL_STOP_SETBACK_M = 6;
/** A pole base must stand this clear of every lane's envelope. */
const LONDON_POLE_LANE_CLEARANCE_M = 2.2;

const distanceToLaneEnvelope = (candidate: WorldPoint): number =>
  Math.min(
    ...londonLanes.map((lane) => {
      let best = Number.POSITIVE_INFINITY;
      for (let index = 1; index < lane.centerline.length; index += 1) {
        const start = lane.centerline[index - 1];
        const end = lane.centerline[index];
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
        best = Math.min(
          best,
          Math.hypot(
            candidate.x - (start.x + dx * amount),
            candidate.z - (start.z + dz * amount),
          ),
        );
      }
      return best - lane.widthM / 2;
    }),
  );

/**
 * Where a kerbside pole stands: beside its own bar, on the nearside kerb —
 * which is the driver's LEFT, because this is London — walking back along its
 * own approach until it clears every carriageway.
 *
 * **Clearance is a veto here, not an objective.** Ranking candidates by "far
 * from tarmac" is what put Cairo's every head 13-24 m out on open ground; the
 * first candidate that clears wins, and the least-displaced one is tried
 * first. Retreating along the approach is tried before widening onto the
 * pavement, because it keeps the head in the stopped driver's view.
 */
const londonKerbsidePole = (
  stopPose: { readonly position: WorldPoint; readonly headingDeg: number },
  headingDeg: number,
  surfaceWidthM: number,
): WorldPoint => {
  const rad = (headingDeg * Math.PI) / 180;
  const leftX = -Math.cos(rad);
  const leftZ = Math.sin(rad);
  const forwardX = Math.sin(rad);
  const forwardZ = Math.cos(rad);
  const kerbside = surfaceWidthM / 2 + 1.2 - LONDON_LANE_OFFSET_M;
  const at = (backM: number, lateralM: number): WorldPoint =>
    point(
      stopPose.position.x - forwardX * backM + leftX * lateralM,
      stopPose.position.z - forwardZ * backM + leftZ * lateralM,
    );
  for (const back of [1, 4, 7, 10, 13]) {
    for (const extra of [0, 0.9, 1.8]) {
      const candidate = at(back, kerbside + extra);
      if (distanceToLaneEnvelope(candidate) >= LONDON_POLE_LANE_CLEARANCE_M) {
        return candidate;
      }
    }
  }
  return at(1, kerbside);
};

/**
 * A signalised London junction, built from whichever generated lanes arrive at
 * the node. One `TrafficControlApproach` is one arm — one direction of travel
 * — keyed by the node the lane arrives *from*, never by road id: a two-way
 * street signalled mid-run would otherwise share one stop line on one
 * direction's lane and one head facing the other way, and the opposing driver
 * would be enforced against a signal never built for them. `phaseGroup` stays
 * keyed by road, so opposing arms of one street still run together.
 *
 * The head stands on the **nearside** — the driver's left, because this is
 * London — a metre past its own kerb and a metre before its own bar, which is
 * where a UK primary signal actually is. (The quarter's two hand-authored
 * signals were positioned by eye against the rendered scene years earlier and
 * are deliberately left exactly as they are.)
 */
const londonSignal = (
  id: string,
  nodeId: string,
): {
  readonly control: TrafficControl;
  readonly zone: ConflictZone;
} => {
  const center = londonNodeById.get(nodeId)!.position;
  const zoneId = `${id}-zone`;
  // Circulating traffic is never stopped: a signalled gyratory signals its
  // *entries* and lets the ring flow. Sampling a ring arc's heading for a
  // signal head also puts the head 20 degrees off the bar it governs, since
  // an arc has no straight axis to sample.
  const inbound = londonGeneratedLanes.filter(
    (lane) => lane.to === nodeId && lane.role !== "roundabout",
  );
  const armLanes = new Map<string, LaneSegment[]>();
  for (const lane of inbound) {
    const key = `${lane.roadId}|${lane.from}`;
    armLanes.set(key, [...(armLanes.get(key) ?? []), lane]);
  }
  const approaches: TrafficControlApproach[] = [];
  const installations: TrafficControlInstallation[] = [];
  for (const [key, lanes] of [...armLanes.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const lane = lanes[0];
    const surface = londonSurfaceById.get(lane.roadId)!;
    const stopDistance = Math.max(
      4,
      laneLengthOf(lane) - LONDON_SIGNAL_STOP_SETBACK_M,
    );
    // Sampled clear of the connector blend: the last few metres of a lane ease
    // onto the shared node, so the heading at the bar itself is a few degrees
    // off the road axis and would skew both bar and head.
    const axis = posePointAlongLane(
      lane,
      Math.max(0, stopDistance - CONNECTOR_BLEND_RUN_M - 1),
    );
    const stopPose = posePointAlongLane(lane, stopDistance);
    const pole = londonKerbsidePole(stopPose, axis.headingDeg, surface.widthM);
    const armSlug = key.replace(/\|/g, "-").replace(/london-node-/g, "");
    const approachId = `${id}-${armSlug}-app`;
    approaches.push({
      id: approachId,
      laneIds: lanes.map((item) => item.id),
      stopLine: anchor(lane.id, stopDistance),
      conflictZoneIds: [zoneId],
      phaseGroup: `${id}-${lane.roadId}`,
    });
    installations.push(
      installation(
        `${armSlug}-head`,
        pole.x,
        pole.z,
        axis.headingDeg,
        "roadside_pole",
        "uk_signal",
        "primary",
        [approachId],
      ),
    );
  }
  const half = 7;
  return {
    control: control(
      id,
      "signal",
      center.x,
      center.z,
      0,
      inbound.map((lane) => lane.id),
      [zoneId],
      approaches,
      installations,
    ),
    zone: {
      id: zoneId,
      laneIds: [
        ...new Set(
          londonGeneratedLanes
            .filter((lane) => lane.from === nodeId || lane.to === nodeId)
            .map((lane) => lane.id),
        ),
      ],
      polygon: [
        point(center.x - half, center.z - half),
        point(center.x + half, center.z - half),
        point(center.x + half, center.z + half),
        point(center.x - half, center.z + half),
      ],
    },
  };
};

/**
 * Signalled crossings in the south-west: the King's Road's two busiest
 * junctions and the Earls Court corner. Everything else out here is an
 * ordinary unmarked priority junction, which is what a Chelsea back street
 * actually is — Cairo does the same, signalling ten of its junctions and
 * leaving the rest to give way.
 */
const londonGeneratedSignals = [
  londonSignal("london-signal-kings-gloucester", "london-node-kings-gloucester"),
  londonSignal("london-signal-kings-queens", "london-node-kings-queens"),
  londonSignal("london-signal-earls-brompton", "london-node-earls-brompton"),
  // Both ends of the two big bridges. A bridgehead is where the map's traffic
  // actually collects, and an unsignalled one reads as a slip road.
  londonSignal("london-signal-westminster-north", "london-node-westminster-north"),
  londonSignal("london-signal-westminster-south", "london-node-westminster-south"),
  londonSignal("london-signal-tower-north", "london-node-tower-north"),
  londonSignal("london-signal-tower-south", "london-node-tower-south"),
  // Parliament Square's arms. A gyratory is a signalled ring, which is why
  // its spec asks for signals rather than give-ways.
  ...LONDON_ROAD_SPECS.flatMap((spec) =>
    spec.roundabout?.signalled
      ? spec.nodeIds.map((armNodeId) =>
          londonSignal(
            `london-signal-${armNodeId.replace("london-node-", "")}`,
            armNodeId,
          ),
        )
      : [],
  ),
];

/** Where a give-way bar sits, measured back from its arm node. */
const LONDON_GIVE_WAY_SETBACK_M = 6;

/**
 * A give-way control on every arm of every roundabout, plus the triangle and
 * the transverse dashes that say so.
 *
 * The control is `yield` rather than `stop`: British roundabouts give way,
 * they do not stop, and the type has been fully plumbed through the
 * simulation — stop lines, NPC holding, player enforcement, the roadside
 * triangle — since long before any city authored one. What makes these
 * *roundabout* give-ways rather than plain ones is derived rather than
 * authored: `buildStopAndYieldLines` marks a yield line whose lane leads
 * straight onto a ring, so an entry cannot be built with its give-way
 * mislabelled.
 */
const londonRoundaboutGiveWays = LONDON_ROAD_SPECS.flatMap((spec) => {
  if (!spec.roundabout || spec.roundabout.signalled) return [];
  const controls: TrafficControl[] = [];
  const markings: { readonly surfaceId: string; readonly marking: RoadMarkingPath }[] = [];
  for (const armNodeId of spec.nodeIds) {
    const entering = londonGeneratedLanes.filter(
      (lane) => lane.to === armNodeId && lane.roadId !== spec.id,
    );
    if (entering.length === 0) continue;
    const lane = entering[0];
    const stopDistance = Math.max(
      3,
      laneLengthOf(lane) - LONDON_GIVE_WAY_SETBACK_M,
    );
    const axis = posePointAlongLane(
      lane,
      Math.max(0, stopDistance - CONNECTOR_BLEND_RUN_M - 1),
    );
    const stopPose = posePointAlongLane(lane, stopDistance);
    const rad = (axis.headingDeg * Math.PI) / 180;
    const leftX = -Math.cos(rad);
    const leftZ = Math.sin(rad);
    const rightX = Math.cos(rad);
    const rightZ = -Math.sin(rad);
    const surface = londonSurfaceById.get(lane.roadId)!;
    const pole = londonKerbsidePole(stopPose, axis.headingDeg, surface.widthM);
    const slug = armNodeId.replace("london-node-", "");
    const controlId = `${spec.id}-give-way-${slug}`;
    const approachId = `${controlId}-app`;
    controls.push(
      control(
        controlId,
        "yield",
        stopPose.position.x,
        stopPose.position.z,
        axis.headingDeg,
        entering.map((item) => item.id),
        undefined,
        [
          {
            id: approachId,
            laneIds: entering.map((item) => item.id),
            stopLine: anchor(lane.id, stopDistance),
            phaseGroup: controlId,
          },
        ],
        [
          installation(
            `${controlId}-sign`,
            pole.x,
            pole.z,
            axis.headingDeg,
            "roadside_pole",
            "yield_sign",
            "primary",
            [approachId],
          ),
        ],
      ),
    );
    // The painted give-way line itself, across the whole mouth rather than
    // across one lane: `RoadMarkingStyle "give_way"` has rendered since it
    // was declared and no city had ever authored one.
    markings.push({
      surfaceId: lane.roadId,
      marking: roadMarking(
        `${controlId}-marking`,
        "give_way",
        [
          point(
            stopPose.position.x + rightX * surface.widthM * 0.5,
            stopPose.position.z + rightZ * surface.widthM * 0.5,
          ),
          point(
            stopPose.position.x + leftX * surface.widthM * 0.5,
            stopPose.position.z + leftZ * surface.widthM * 0.5,
          ),
        ],
        "white",
      ),
    });
  }
  return [{ controls, markings }];
});

const londonGiveWayControls = londonRoundaboutGiveWays.flatMap(
  (roundabout) => roundabout.controls,
);
const londonGiveWayMarkingsBySurface = new Map<string, RoadMarkingPath[]>();
for (const roundabout of londonRoundaboutGiveWays) {
  for (const { surfaceId, marking } of roundabout.markings) {
    londonGiveWayMarkingsBySurface.set(surfaceId, [
      ...(londonGiveWayMarkingsBySurface.get(surfaceId) ?? []),
      marking,
    ]);
  }
}

const londonSurfacesWithGiveWay: readonly RoadSurface[] =
  londonGeneratedSurfaces.map((surface) => {
    const extra = londonGiveWayMarkingsBySurface.get(surface.id);
    return extra
      ? { ...surface, markings: [...surface.markings, ...extra] }
      : surface;
  });

/** Painted islands at the centre of every roundabout. */
const londonRoundaboutIslands: readonly ProceduralLandmark[] =
  LONDON_ROAD_SPECS.flatMap((spec) =>
    spec.roundabout
      ? [
          {
            id: `${spec.id}-island`,
            kind: "park" as const,
            center: spec.roundabout.center,
            size: point(
              spec.roundabout.islandRadiusM * 2,
              spec.roundabout.islandRadiusM * 2,
            ),
            color: "#5f9a4e",
          },
        ]
      : [],
  );

const londonLaneGraph: LaneGraph = {
  nodes: [
    ...Object.values(londonNodes),
    ...Object.values(londonSouthWestNodes),
    ...Object.values(londonRiverNodes),
    ...Object.values(londonCentreNodes),
    ...Object.values(londonEastNodes),
  ],
  lanes: londonLanes,
  controls: [
    ...londonGeneratedSignals.map((signal) => signal.control),
    ...londonGiveWayControls,
    control(
      "london-crosswalk-quiet",
      "crosswalk",
      -164,
      -68,
      0,
      ["london-quiet-north"],
      undefined,
      [approach("london-quiet-crosswalk-approach", "london-quiet-north", 28, "crosswalk")],
      [installation("london-quiet-crosswalk-marking", -164, -68, 0, "road_marking", "crosswalk", "marking")],
    ),
    control(
      "london-signal-queen-gate-cromwell",
      "signal",
      -108,
      -32,
      90,
      [
        "london-queen-gate-north-1",
        "london-queen-gate-south-1",
        "london-cromwell-east-1",
        "london-cromwell-west-2",
      ],
      ["london-queen-gate-cromwell-conflict"],
      [
        approach("london-queen-gate-north-approach", "london-queen-gate-north-1", 62, "queen-gate", ["london-queen-gate-cromwell-conflict"]),
        approach("london-queen-gate-south-approach", "london-queen-gate-south-1", 104, "queen-gate", ["london-queen-gate-cromwell-conflict"]),
        approach("london-cromwell-west-approach", "london-cromwell-west-2", 140, "cromwell", ["london-queen-gate-cromwell-conflict"]),
      ],
      [
        installation("london-queen-gate-primary", -103.1, -43.3, 0, "roadside_pole", "uk_signal", "primary", ["london-queen-gate-north-approach"]),
        installation("london-queen-gate-secondary", -112.9, -20.7, 180, "secondary_pole", "uk_signal", "secondary", ["london-queen-gate-south-approach"]),
        installation("london-cromwell-west-primary", -96.7, -23.5, 270, "roadside_pole", "uk_signal", "primary", ["london-cromwell-west-approach"]),
        installation("london-cromwell-west-secondary", -96.7, -37.1, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-west-approach"]),
      ],
    ),
    control(
      "london-signal-cromwell-exhibition",
      "signal",
      42,
      -32,
      90,
      [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      ["london-cromwell-exhibition-conflict"],
      [
        approach("london-cromwell-east-general-approach", "london-cromwell-east-1", 140, "cromwell-east", ["london-cromwell-exhibition-conflict"]),
        approach("london-cromwell-east-bus-approach", "london-cromwell-east-bus", 140, "cromwell-east", ["london-cromwell-exhibition-conflict"]),
        approach("london-cromwell-westbound-approach", "london-cromwell-west-1", 98, "cromwell-west", ["london-cromwell-exhibition-conflict"]),
      ],
      [
        installation("london-exhibition-primary", 30.7, -37.1, 90, "roadside_pole", "uk_signal", "primary", ["london-cromwell-east-general-approach", "london-cromwell-east-bus-approach"]),
        installation("london-exhibition-secondary", 53.3, -27.1, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-westbound-approach"]),
      ],
    ),
    control(
      "london-box-cromwell-exhibition",
      "box_junction",
      42,
      -32,
      90,
      [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      ["london-cromwell-exhibition-conflict"],
      [],
      [installation("london-box-marking", 42, -32, 90, "road_marking", "box_junction", "marking")],
    ),
    control(
      "london-cromwell-bus-lane-sign",
      "restricted_lane",
      -64,
      -27,
      90,
      ["london-cromwell-east-bus"],
      undefined,
      [approach("london-bus-lane-sign-approach", "london-cromwell-east-bus", 34, "restriction")],
      [installation("london-bus-lane-roadside-sign", -64, -19, 90, "roadside_pole", "restricted_lane", "warning")],
    ),
    control(
      "london-crosswalk-museum",
      "crosswalk",
      42,
      20,
      0,
      ["london-exhibition-shared-1"],
      undefined,
      [approach("london-museum-crosswalk-approach", "london-exhibition-shared-1", 48, "crosswalk")],
      [installation("london-museum-crosswalk-marking", 42, 20, 0, "road_marking", "crosswalk", "marking")],
    ),
    // Zebra crossings on the high streets, each flanked by a pair of Belisha
    // beacons (`londonStreetFurniture.ts`). Six of them, spread from Chelsea
    // to Islington: a striped crossing with an amber globe either side is one
    // of the few things that says "Britain" from inside a car.
    control("london-crossing-kings-road", "crosswalk", -191.4, -277.6, 83, ["london-kings-road-4-forward-1", "london-kings-road-4-reverse-1"], undefined,
      [approach("london-crossing-kings-road-approach", "london-kings-road-4-forward-1", 120, "crosswalk")],
      [installation("london-crossing-kings-road-marking", -191.4, -277.6, 83, "road_marking", "crosswalk", "marking")]),
    control("london-crossing-knightsbridge", "crosswalk", 221.7, 221.7, 90, ["london-knightsbridge-1-forward-1", "london-knightsbridge-1-reverse-1"], undefined,
      [approach("london-crossing-knightsbridge-approach", "london-knightsbridge-1-forward-1", 180, "crosswalk")],
      [installation("london-crossing-knightsbridge-marking", 221.7, 221.7, 90, "road_marking", "crosswalk", "marking")]),
    control("london-crossing-oxford", "crosswalk", 889.7, 701.7, 90, ["london-oxford-street-2-forward-1", "london-oxford-street-2-reverse-1"], undefined,
      [approach("london-crossing-oxford-approach", "london-oxford-street-2-forward-1", 90, "crosswalk")],
      [installation("london-crossing-oxford-marking", 889.7, 701.7, 90, "road_marking", "crosswalk", "marking")]),
    control("london-crossing-bishopsgate", "crosswalk", 1165.8, 489.8, 2, ["london-bishopsgate-2-forward-1", "london-bishopsgate-2-reverse-1"], undefined,
      [approach("london-crossing-bishopsgate-approach", "london-bishopsgate-2-forward-1", 70, "crosswalk")],
      [installation("london-crossing-bishopsgate-marking", 1165.8, 489.8, 2, "road_marking", "crosswalk", "marking")]),
    control("london-crossing-upper-street", "crosswalk", 1164, 832, 7, ["london-upper-street-1-forward-1", "london-upper-street-1-reverse-1"], undefined,
      [approach("london-crossing-upper-street-approach", "london-upper-street-1-forward-1", 120, "crosswalk")],
      [installation("london-crossing-upper-street-marking", 1164, 832, 7, "road_marking", "crosswalk", "marking")]),
    control("london-crossing-riverbank", "crosswalk", 748.2, -602.5, 82, ["london-riverbank-5-forward-1", "london-riverbank-5-reverse-1"], undefined,
      [approach("london-crossing-riverbank-approach", "london-riverbank-5-forward-1", 150, "crosswalk")],
      [installation("london-crossing-riverbank-marking", 748.2, -602.5, 82, "road_marking", "crosswalk", "marking")]),
    control(
      "london-crosswalk-thurloe",
      "crosswalk",
      42,
      76,
      270,
      [
        "london-thurloe-west-1",
        "london-thurloe-west-2",
        "london-exhibition-shared-2",
      ],
      undefined,
      [
        approach("london-thurloe-crosswalk-approach", "london-thurloe-west-1", 99, "crosswalk"),
        approach("london-exhibition-crosswalk-approach", "london-exhibition-shared-2", 50, "crosswalk"),
      ],
      [installation("london-thurloe-crosswalk-marking", 42, 76, 270, "road_marking", "crosswalk", "marking")],
    ),
  ],
  conflictZones: connectorConflictZones(londonLanes, [
    {
      id: "london-queen-gate-cromwell-conflict",
      laneIds: [
        "london-queen-gate-north-1",
        "london-queen-gate-south-1",
        "london-cromwell-east-1",
        "london-cromwell-west-2",
      ],
      polygon: [
        point(-119, -43),
        point(-97, -43),
        point(-97, -21),
        point(-119, -21),
      ],
    },
    {
      id: "london-cromwell-exhibition-conflict",
      laneIds: [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      polygon: [
        point(37, -36),
        point(47, -36),
        point(47, -25),
        point(37, -25),
      ],
    },
    ...londonGeneratedSignals.map((signal) => signal.zone),
  ]),
  restrictions: [
    {
      id: "london-cromwell-bus-lane-weekday",
      laneId: "london-cromwell-east-bus",
      ruleCode: "restricted_lane",
      activeWindows: [
        {
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startMinutes: 7 * 60,
          endMinutes: 19 * 60,
        },
      ],
      sourceReferenceId: "uk-london-highway-code-general",
    },
  ],
  spawnPoints: [
    anchoredSpawn(
      "london-player",
      "player",
      "london-local-west",
      LONDON_QUIET_START_DISTANCE_M,
    ),
    anchoredSpawn(
      "london-player-queen-gate",
      "player",
      "london-queen-gate-north-1",
      LONDON_QUEEN_GATE_START_DISTANCE_M,
    ),
    anchoredSpawn("london-car-queen-gate", "vehicle", "london-queen-gate-north-1", 34),
    anchoredSpawn("london-black-cab", "vehicle", "london-thurloe-west-1", 38),
    anchoredSpawn("london-red-bus", "vehicle", "london-cromwell-east-bus", 68),
    anchoredSpawn("london-car-cromwell", "vehicle", "london-cromwell-east-2", 50),
    anchoredSpawn("london-car-brompton", "vehicle", "london-cromwell-east-3", 90),
    anchoredSpawn("london-cab-kensington", "vehicle", "london-queen-gate-north-3", 70),
    anchoredSpawn("london-car-gloucester", "vehicle", "london-gloucester-n-1", 40),
    anchoredSpawn("london-bus-kensington", "vehicle", "london-kensington-e-1", 90),
    freeSpawn("london-ped-gloucester", "pedestrian", -292, -68, 0),
    freeSpawn("london-ped-brompton", "pedestrian", 300, -22, 90),
    freeSpawn("london-ped-kensington", "pedestrian", -98, 150, 180),
    freeSpawn("london-ped-quiet", "pedestrian", -158, -67, 90),
    freeSpawn("london-ped-museum-1", "pedestrian", 34, 19, 90),
    freeSpawn("london-ped-museum-2", "pedestrian", 50, 77, 270),
    freeSpawn(
      "london-cyclist-exhibition",
      "cyclist",
      39,
      14,
      0,
      "london-exhibition-shared-1",
    ),
    freeSpawn(
      "london-cyclist-cromwell",
      "cyclist",
      78,
      -29,
      90,
      "london-cromwell-east-2",
    ),
    // Appended, never inserted: `spawnNpcs` hands gates out by array index,
    // so putting one of these in the middle reshuffles every NPC on the map.
    // Ids stay in fixed-width single-hyphen families, because the fallback
    // sort is `localeCompare` and hyphen/digit-width games reorder under ICU.
    //
    // The variant comes off the id itself (`inferVehicleVariant`): "bus"
    // gives London its red double-decker, "cab" its black cab, "van" a van,
    // and a named "police" gate guarantees a patrol rather than leaving one
    // to the 1-in-5 roll every ambient car makes.
    anchoredSpawn("london-bus-knightsbridge", "vehicle", "london-knightsbridge-2-forward-1", 60),
    anchoredSpawn("london-bus-oxford", "vehicle", "london-oxford-street-2-forward-1", 80),
    anchoredSpawn("london-bus-embankment", "vehicle", "london-victoria-embankment-2-forward-1", 120),
    anchoredSpawn("london-bus-euston", "vehicle", "london-euston-2-forward-1", 40),
    anchoredSpawn("london-cab-piccadilly", "vehicle", "london-piccadilly-1-forward-1", 70),
    anchoredSpawn("london-cab-kings-road", "vehicle", "london-kings-road-3-forward-1", 90),
    anchoredSpawn("london-cab-bishopsgate", "vehicle", "london-bishopsgate-2-forward-1", 60),
    anchoredSpawn("london-van-riverbank", "vehicle", "london-riverbank-4-forward-1", 80),
    anchoredSpawn("london-van-battersea", "vehicle", "london-battersea-road-3-forward-1", 70),
    anchoredSpawn("london-car-earls-court", "vehicle", "london-earls-court-road-2-forward-1", 60),
    anchoredSpawn("london-car-whitehall", "vehicle", "london-whitehall-1-forward-1", 70),
    anchoredSpawn("london-car-park-lane", "vehicle", "london-park-lane-1-forward-1", 120),
    anchoredSpawn("london-car-upper-street", "vehicle", "london-upper-street-1-forward-1", 60),
    anchoredSpawn("london-police-embankment", "vehicle", "london-chelsea-embankment-3-forward-1", 100),
    anchoredSpawn("london-police-city", "vehicle", "london-london-wall-1-forward-1", 70),
    // People. The ambient crowd bubble follows the player and covers whatever
    // street they are actually on; these are the scripted few that make a
    // named place look like somewhere worth arriving at.
    freeSpawn("london-ped-kings-road", "pedestrian", -188, -286, 270),
    freeSpawn("london-ped-chelsea", "pedestrian", -318, -412, 90),
    freeSpawn("london-ped-earls-court", "pedestrian", -822, -30, 0),
    freeSpawn("london-ped-battersea", "pedestrian", -690, -812, 90),
    freeSpawn("london-ped-southbank", "pedestrian", 838, -588, 270),
    freeSpawn("london-ped-eye-queue", "pedestrian", 900, -584, 180),
    freeSpawn("london-ped-westminster", "pedestrian", 792, -344, 0),
    freeSpawn("london-ped-whitehall", "pedestrian", 796, -170, 180),
    freeSpawn("london-ped-piccadilly", "pedestrian", 808, 284, 90),
    freeSpawn("london-ped-oxford", "pedestrian", 886, 710, 270),
    freeSpawn("london-ped-city", "pedestrian", 1160, 320, 0),
    freeSpawn("london-ped-islington", "pedestrian", 1176, 826, 180),
    freeSpawn("london-cyclist-embankment", "cyclist", 388, -404, 78, "london-victoria-embankment-1-forward-1"),
    freeSpawn("london-cyclist-kings-road", "cyclist", -160, -272, 82, "london-kings-road-4-forward-1"),
    freeSpawn("london-cyclist-regent", "cyclist", 918, 500, 350, "london-regent-2-forward-1"),
    freeSpawn("london-cyclist-bishopsgate", "cyclist", 1163, 380, 358, "london-bishopsgate-2-forward-1"),
    freeSpawn("london-cyclist-park", "cyclist", -302, 460, 0, "london-park-west-1-forward-1"),
    freeSpawn("london-cyclist-riverbank", "cyclist", 300, -690, 80, "london-riverbank-4-forward-1"),
  ],
};

export const LONDON_MAP_PACK: MapPack = {
  id: "london-south-kensington",
  // Density is authored per drive, not per city, so every map used to get the
  // same twelve cars whatever its size. Twelve over 56 lane-km is an empty
  // city — and patrols with them, since a patrol is one ambient car in five.
  // The core clamps at 32.
  ambientTraffic: { desktop: 32, touch: 16 },
  name: "London — Kensington to the City",
  areaLabel:
    "Kensington, Chelsea, Westminster, the South Bank and the City",
  countryIds: ["uk"],
  // The quarter's names, plus every generated road's own. Naming is
  // many-to-one here: Cromwell Road and Exhibition Road are each modelled as
  // several surfaces, and they all read as the one street a driver is on.
  // Keyed on `roadId` and never on lane id — the surface
  // `london-cromwell-west` carries lanes named `london-cromwell-east-*`.
  roadNames: {
    ...LONDON_QUARTER_ROAD_NAMES,
    // A generated road carries its name on the same spec that posts its
    // limit, so those two tables cannot drift apart either.
    ...Object.fromEntries(LONDON_ROAD_SPECS.map((spec) => [spec.id, spec.name])),
  },
  source: {
    boundingBox: {
      south: 51.4938,
      west: -0.1818,
      north: 51.5006,
      east: -0.1698,
    },
    capturedOn: LONDON_CONTENT_REVIEWED_ON,
    sourceUrl:
      "https://api.openstreetmap.org/api/0.6/map?bbox=-0.1818,51.4938,-0.1698,51.5006",
    checksum:
      "a155a4d96e0318822c28c7da0627bde2f88a628ff0bebe1b93209f29fedf1d64",
    importerVersion: "sideswap-osm-compact@2",
    attribution: "© OpenStreetMap contributors",
    licenseName: "Open Data Commons Open Database License 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  geometry: {
    // The whole city's footprint, not just the quarter's: NYC is 2600x3000 and
    // that is the bar. Origin-centred with no offset field, so the expansion is
    // laid out around the museum quarter rather than shifting it — the south
    // west lands first, and the river, the West End and the City fill the rest.
    worldSize: point(2950, 2000),
    roadWidth: 10,
    shoulderWidth: 1.5,
    roadSurfaces: [
      ...londonQuarterSurfaces,
      ...londonSurfacesWithGiveWay,
    ],
    // The Thames, crossing the whole map west to east. Gently irregular on
    // both shores — a perfect rectangle reads as a canal, not a river. Both
    // shores stay ~48 m off their own embankment's centreline, and the polygon
    // runs past the world edges so the river arrives from somewhere.
    //
    // `flowHeadingDeg` is what makes this a river rather than a giant still
    // pond (crest streaks, chop, drifting tiles); `bridgePortalSurfaceIds`
    // opens the otherwise-solid shoreline for exactly the three bridge road
    // surfaces and derives their parapet spans. Every other metre of shoreline
    // stays a collider for free.
    //
    // No boats: the only two models are a felucca and a skiff, and an Egyptian
    // felucca on the Thames is exactly the trap `docs/greenery.md` records.
    // `buildWaterBodies` gates them to Cairo.
    waterBodies: [
      // The Serpentine: a lake inside the royal park, so no `flowHeadingDeg`
      // (that would make it a river) and no portal ids (nothing drives over
      // it). The shoreline is a collider and a planting keep-out for free.
      {
        id: "london-serpentine",
        color: "#33555e",
        polygon: [
          point(-40, 556),
          point(60, 572),
          point(170, 566),
          point(280, 580),
          point(360, 566),
          point(372, 528),
          point(286, 512),
          point(172, 522),
          point(58, 510),
          point(-42, 522),
        ],
      },
      {
        id: "london-thames",
        color: "#3a4d52",
        flowHeadingDeg: 90,
        bridgePortalSurfaceIds: [
          "london-albert-bridge",
          "london-westminster-bridge",
          "london-tower-bridge",
        ],
        polygon: [
          point(-1500, -654),
          point(-1240, -644),
          point(-1000, -638),
          point(-700, -610),
          point(-347, -581),
          point(-100, -528),
          point(100, -507),
          point(400, -456),
          point(780, -416),
          point(1020, -380),
          point(1260, -362),
          point(1500, -334),
          point(1500, -474),
          point(1260, -502),
          point(1020, -520),
          point(780, -556),
          point(400, -596),
          point(100, -646),
          point(-100, -668),
          point(-347, -713),
          point(-700, -760),
          point(-1000, -768),
          point(-1240, -776),
          point(-1500, -786),
        ],
      },
    ],
    blocks: [
      {
        id: "london-natural-history-museum-block",
        center: point(-26, -76),
        size: point(118, 46),
        heightRange: [18, 34],
        density: 0.82,
        material: "terracotta-museum",
      },
      {
        id: "london-science-museum-block",
        center: point(-24, 30),
        size: point(116, 64),
        heightRange: [15, 29],
        density: 0.76,
        material: "pale-stone-museum",
      },
      {
        id: "london-v-and-a-block",
        center: point(98, 28),
        size: point(82, 64),
        heightRange: [17, 31],
        density: 0.8,
        material: "red-brick-museum",
      },
      {
        id: "london-queen-gate-terraces",
        center: point(-136, 28),
        // 42 -> 41.2 m wide: Queen's Gate's pavement widened to 3.4 m with the
        // `paved` flip, and its outer walking edge now runs at x-114.8 — the
        // old 42 m block put a solid terrace face 0.2 m from it. The 0.4 m
        // trimmed off each side leaves the frontage flush behind both
        // pavements (the quiet loop's inner edge is at x-157.4).
        size: point(41.2, 84),
        heightRange: [12, 24],
        density: 0.72,
        material: "white-stucco",
      },
      {
        id: "london-cromwell-terraces",
        center: point(102, -76),
        size: point(82, 46),
        heightRange: [10, 22],
        density: 0.68,
        material: "london-brick",
      },
      ...londonSouthWestBlocks,
    ],
    servicePoints: [
      // Tucked into the square corner west of the quiet loop, where Cromwell
      // Road's far-west run meets the loop's straight west leg. Both edges are
      // straight here, so unlike the mitered Queen's Gate corner a square
      // 23.3 m slab can sit flush against the pair of them.
      // Both figures grew by the 1.9 m London's pavements gained when the map
      // went `paved` (1.5 m dirt shoulder -> PAVED_SIDEWALK_WIDTH_M 3.4).
      // setbackM 20.5: the southbound lane sits at x-162.2 and the loop's west
      // pavement now ends at x-171.0, putting the slab's east edge at x≈-171.06.
      // distanceAlongM 19.1 does the same to the north, clearing Cromwell's
      // south pavement at z-39.0.
      { id: "london-gas", kind: "gas_station", anchor: { laneId: "london-quiet-south-opposite", distanceAlongM: 19.1 }, footprint: point(12, 8), label: "Cromwell Fuel", setbackM: 20.5 },
      // Behind Queen's Gate, tucked into the terraces — the one frontage on
      // this map with room for it. Everything else is museum block (whose
      // forecourt has to stay open) or a venue lot, and a shop on the open
      // ground north of the museums would read as a shed in a field.
      // The mews garage is also the truthful South Kensington answer: the
      // repair trade here is behind the terraces, not on Cromwell Road.
      // Anchored on the southbound lane so the driver's-right set-back throws
      // the lot west onto the terrace block rather than into the carriageway.
      // setbackM 13.8 = the old 11.9 plus the same 1.9 m of new pavement.
      { id: "london-repair", kind: "repair_shop", anchor: { laneId: "london-queen-gate-south-1", distanceAlongM: 52 }, footprint: point(10, 8), label: "Queen's Gate Motors", setbackM: 13.8 },
      // Placed the same way as the venues above. Four pumps and three
      // garages across 56 lane-km: enough that running dry is a detour
      // rather than a walk home.
      { id: "london-gas-embankment", kind: "gas_station", anchor: { laneId: "london-victoria-embankment-4-forward-1", distanceAlongM: 26 }, footprint: point(12, 8), label: "Embankment Petrol", setbackM: 22.55 },
      { id: "london-gas-city", kind: "gas_station", anchor: { laneId: "london-euston-3-reverse-1", distanceAlongM: 80 }, footprint: point(12, 8), label: "Euston Road Petrol", setbackM: 22.55 },
      { id: "london-gas-riverside", kind: "gas_station", anchor: { laneId: "london-battersea-road-1-reverse-1", distanceAlongM: 26 }, footprint: point(12, 8), label: "Riverside Petrol", setbackM: 21.15 },
      { id: "london-repair-bankside", kind: "repair_shop", anchor: { laneId: "london-riverbank-4-forward-1", distanceAlongM: 202 }, footprint: point(10, 8), label: "Bankside MOT Centre", setbackM: 15.2 },
      { id: "london-repair-wallside", kind: "repair_shop", anchor: { laneId: "london-canonbury-1-forward-1", distanceAlongM: 54 }, footprint: point(10, 8), label: "Wallside Motors", setbackM: 14 },
    ],
    gigVenues: [
      { id: "london-v1", kind: "restaurant", anchor: { laneId: "london-cromwell-east-1", distanceAlongM: 44 }, footprint: point(14, 10), name: "Cromwell Cafe" },
      { id: "london-v2", kind: "shop", anchor: { laneId: "london-exhibition-shared-1", distanceAlongM: 48 }, footprint: point(14, 10), name: "Exhibition Road Shops" },
      { id: "london-v3", kind: "residence", anchor: { laneId: "london-queen-gate-south-2", distanceAlongM: 50 }, footprint: point(14, 12), name: "Queen's Gate Flats" },
      { id: "london-v4", kind: "office", anchor: { laneId: "london-quiet-north", distanceAlongM: 36 }, footprint: point(14, 12), name: "South Ken Office" },
      // Every anchor lane, distance and set-back below is SOLVED, not
      // eyeballed: a venue's building lands on the driver's RIGHT of its
      // anchor lane, which on a left-hand-traffic map is the far kerb, and no
      // `distanceAlongM` can rescue an anchor pointing the wrong way. Six of
      // NYC's shipped venues stood on the wrong kerb — inside a park wall, or
      // as a shopfront among detached houses — and every one of those defects
      // was lateral. These are placed against the geometry itself: clear of
      // every lane envelope, clear of every park and of the river, and clear
      // of each other.
      { id: "london-v5", kind: "restaurant", anchor: { laneId: "london-kings-road-4-forward-1", distanceAlongM: 30 }, footprint: point(16, 12), name: "The Grapes & Anchor", setbackM: 17.5 },
      { id: "london-v6", kind: "shop", anchor: { laneId: "london-kings-road-5-forward-1", distanceAlongM: 154 }, footprint: point(14, 10), name: "Chelsea Green Grocers", setbackM: 34 },
      { id: "london-v7", kind: "residence", anchor: { laneId: "london-royal-hospital-road-1-forward-1", distanceAlongM: 184 }, footprint: point(14, 12), name: "Chelsea Mansions", setbackM: 34 },
      { id: "london-v8", kind: "restaurant", anchor: { laneId: "london-old-brompton-1-forward-1", distanceAlongM: 222 }, footprint: point(14, 14), name: "Full English Cafe", setbackM: 31.5, modelId: "restaurant-pizzeria" },
      { id: "london-v9", kind: "shop", anchor: { laneId: "london-earls-court-road-3-forward-1", distanceAlongM: 30 }, footprint: point(14, 10), name: "Corner Shop & News", setbackM: 17 },
      { id: "london-v10", kind: "office", anchor: { laneId: "london-warwick-road-2-forward-1", distanceAlongM: 80 }, footprint: point(14, 12), name: "Warwick Road Studios", setbackM: 17 },
      { id: "london-v11", kind: "restaurant", anchor: { laneId: "london-riverbank-2-forward-1", distanceAlongM: 300 }, footprint: point(14, 10), name: "Golden Fry Fish & Chips", setbackM: 18 },
      { id: "london-v12", kind: "shop", anchor: { laneId: "london-battersea-road-3-reverse-1", distanceAlongM: 220 }, footprint: point(14, 10), name: "Riverside Minimart", setbackM: 20 },
      { id: "london-v13", kind: "residence", anchor: { laneId: "london-battersea-road-5-reverse-1", distanceAlongM: 352 }, footprint: point(14, 12), name: "Battersea Rise Flats", setbackM: 17 },
      { id: "london-v14", kind: "restaurant", anchor: { laneId: "london-riverbank-5-reverse-1", distanceAlongM: 156 }, footprint: point(16, 12), name: "Borough Kitchen", setbackM: 18 },
      { id: "london-v15", kind: "restaurant", anchor: { laneId: "london-riverbank-7-reverse-1", distanceAlongM: 210 }, footprint: point(14, 10), name: "The Kings Arms", setbackM: 18 },
      { id: "london-v16", kind: "office", anchor: { laneId: "london-riverbank-6-forward-1", distanceAlongM: 120 }, footprint: point(16, 14), name: "Bankside Works", setbackM: 18 },
      { id: "london-v17", kind: "shop", anchor: { laneId: "london-chelsea-embankment-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Embankment Stores", setbackM: 18 },
      { id: "london-v18", kind: "restaurant", anchor: { laneId: "london-victoria-embankment-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Embankment Espresso", setbackM: 18.5 },
      { id: "london-v19", kind: "office", anchor: { laneId: "london-whitehall-1-reverse-1", distanceAlongM: 62 }, footprint: point(16, 14), name: "Whitehall Offices", setbackM: 18 },
      { id: "london-v20", kind: "office", anchor: { laneId: "london-victoria-street-1-reverse-1", distanceAlongM: 26 }, footprint: point(16, 14), name: "Victoria Street Chambers", setbackM: 18 },
      { id: "london-v21", kind: "residence", anchor: { laneId: "london-buckingham-palace-road-2-forward-1", distanceAlongM: 26 }, footprint: point(14, 12), name: "Palace Gardens Flats", setbackM: 17.5 },
      { id: "london-v22", kind: "shop", anchor: { laneId: "london-knightsbridge-1-forward-1", distanceAlongM: 238 }, footprint: point(14, 10), name: "Knightsbridge Provisions", setbackM: 18 },
      { id: "london-v23", kind: "restaurant", anchor: { laneId: "london-brompton-road-2-forward-1", distanceAlongM: 26 }, footprint: point(14, 14), name: "Brompton Brasserie", setbackM: 18, modelId: "restaurant-pizzeria" },
      { id: "london-v24", kind: "shop", anchor: { laneId: "london-oxford-street-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "High Street Grocers", setbackM: 18 },
      { id: "london-v25", kind: "restaurant", anchor: { laneId: "london-regent-4-forward-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Regent Corner Cafe", setbackM: 18 },
      { id: "london-v26", kind: "office", anchor: { laneId: "london-regent-5-reverse-1", distanceAlongM: 28 }, footprint: point(16, 14), name: "Regent Corner Offices", setbackM: 18 },
      { id: "london-v27", kind: "restaurant", anchor: { laneId: "london-piccadilly-1-reverse-1", distanceAlongM: 26 }, footprint: point(16, 12), name: "Piccadilly Brasserie", setbackM: 18 },
      { id: "london-v28", kind: "shop", anchor: { laneId: "london-park-lane-1-forward-2", distanceAlongM: 240 }, footprint: point(14, 10), name: "Park Lane Pantry", setbackM: 24 },
      { id: "london-v29", kind: "residence", anchor: { laneId: "london-euston-2-reverse-1", distanceAlongM: 26 }, footprint: point(14, 12), name: "Euston Terrace", setbackM: 18.5 },
      { id: "london-v30", kind: "restaurant", anchor: { laneId: "london-upper-street-1-forward-1", distanceAlongM: 88 }, footprint: point(14, 10), name: "The Boot & Bell", setbackM: 17.5 },
      { id: "london-v31", kind: "shop", anchor: { laneId: "london-upper-street-1-forward-1", distanceAlongM: 48 }, footprint: point(14, 10), name: "Islington Corner Store", setbackM: 17.5 },
      { id: "london-v32", kind: "residence", anchor: { laneId: "london-canonbury-1-forward-1", distanceAlongM: 114 }, footprint: point(14, 12), name: "Islington Terrace", setbackM: 17 },
      { id: "london-v33", kind: "restaurant", anchor: { laneId: "london-shoreditch-1-reverse-1", distanceAlongM: 60 }, footprint: point(14, 14), name: "Brick Court Balti House", setbackM: 17, modelId: "restaurant-pizzeria" },
      { id: "london-v34", kind: "office", anchor: { laneId: "london-london-wall-2-forward-1", distanceAlongM: 26 }, footprint: point(16, 14), name: "City Point Offices", setbackM: 18 },
      { id: "london-v35", kind: "restaurant", anchor: { laneId: "london-bishopsgate-1-reverse-1", distanceAlongM: 120 }, footprint: point(14, 10), name: "The Guildsman", setbackM: 18 },
      { id: "london-v36", kind: "shop", anchor: { laneId: "london-leadenhall-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Minute Market", setbackM: 17 },
      { id: "london-v37", kind: "shop", anchor: { laneId: "london-cornmarket-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Guild Lane Pharmacy", setbackM: 17 },
      { id: "london-v38", kind: "residence", anchor: { laneId: "london-minories-2-forward-1", distanceAlongM: 26 }, footprint: point(14, 12), name: "Wallside Estate", setbackM: 17 },
      { id: "london-v39", kind: "restaurant", anchor: { laneId: "london-oxford-street-3-forward-1", distanceAlongM: 70 }, footprint: point(16, 12), name: "Marble Row Grill", setbackM: 18 },
      { id: "london-v40", kind: "shop", anchor: { laneId: "london-gloucester-south-1-reverse-1", distanceAlongM: 26 }, footprint: point(14, 10), name: "Sloane Grocers", setbackM: 17 },
    ],
    landmarks: [
      {
        id: "london-natural-history-museum",
        kind: "shops",
        center: point(-25, -75),
        size: point(72, 30),
        color: "#b46b4f",
      },
      {
        id: "london-natural-history-tower",
        kind: "tower",
        center: point(-24, -61),
        size: point(16, 16),
        color: "#855443",
      },
      {
        id: "london-science-museum",
        kind: "shops",
        center: point(-24, 30),
        size: point(66, 26),
        color: "#d4d0c5",
      },
      {
        id: "london-victoria-and-albert-museum",
        kind: "shops",
        center: point(96, 28),
        size: point(54, 30),
        color: "#9d5b4a",
      },
      {
        id: "london-south-kensington-station",
        kind: "station",
        center: point(132, 96),
        size: point(18, 10),
        color: "#b9303f",
      },
      // Bridge landmarks: the id equals the bridge's own road id, and that
      // identity is how the water helpers and `render/londonLandmarks.ts`
      // find the right road surface and clip rails to the over-water span.
      // Rendered bespoke; the generic landmark fallback would draw a windowed
      // facade box across the river.
      { id: "london-albert-bridge", kind: "bridge", center: point(-347, -647), size: point(236, 9), headingDeg: 0, color: "#cbb9c6" },
      { id: "london-westminster-bridge", kind: "bridge", center: point(780, -482), size: point(236, 12), headingDeg: 0, color: "#5c7a55" },
      { id: "london-tower-bridge", kind: "bridge", center: point(1260, -428), size: point(236, 11), headingDeg: 0, color: "#c8bda4" },
      // Battersea Park, filling the strip between the riverside spine and the
      // back street behind it. Big enough to be walled, which is what the
      // south bank needs to stop reading as one long terrace.
      {
        id: "london-battersea-park",
        kind: "park",
        center: point(-690, -845),
        size: point(500, 44),
        color: "#4f7a3d",
      },
      ...londonRoundaboutIslands,
      // --- Bespoke silhouettes. Every one of these is procedural, drawn by
      // `render/londonLandmarks.ts` and dispatched by id; the generic
      // landmark fallback would put a windowed facade box where the clock
      // tower is. None needs a licence to verify, and between them they are
      // most of what makes a drive read as London rather than as a grey city.
      { id: "london-clock-tower", kind: "tower", center: point(778, -330), size: point(14, 14), color: "#c3b492" },
      { id: "london-eye-wheel", kind: "monument", center: point(870, -572), size: point(90, 8), color: "#9fb6c4" },
      { id: "london-power-station", kind: "shops", center: point(-250, -810), size: point(110, 54), color: "#8b4f3d" },
      { id: "london-round-hall", kind: "cultural", center: point(-30, 262), size: point(74, 56), color: "#a9634b" },
      { id: "london-glass-gherkin", kind: "tower", center: point(1230, 170), size: point(34, 34), color: "#4d6b78" },
      { id: "london-shard-spire", kind: "tower", center: point(1330, -580), size: point(38, 38), color: "#7d97a5" },
      { id: "london-palace", kind: "cultural", center: point(430, -70), size: point(90, 46), color: "#c9bb96" },
      { id: "london-department-store", kind: "shops", center: point(495, 187), size: point(110, 44), color: "#a05a44" },
      { id: "london-monument-column", kind: "monument", center: point(1150, -130), size: point(12, 12), color: "#cfc3a4" },
      { id: "london-knightsbridge-station", kind: "station", center: point(268, 244), size: point(18, 11), color: "#8e3b46" },
      { id: "london-city-station", kind: "station", center: point(1104, 466), size: point(18, 11), color: "#8e3b46" },
      { id: "london-islington-station", kind: "station", center: point(1198, 776), size: point(18, 11), color: "#8e3b46" },
      // The royal park, filling everything Park Lane, Bayswater Road, West
      // Carriage Drive and Kensington Road enclose. Big enough to be walled,
      // with derived gates wherever a crossing reaches it, and the map's one
      // real expanse of green now that the streets are asphalt.
      {
        id: "london-royal-park",
        kind: "park",
        center: point(160, 600),
        size: point(840, 600),
        color: "#4f7a3d",
      },
      // Chelsea's garden square: the pocket between the King's Road, Cheyne
      // Mews and Chelsea Manor Street that carries no street wall, so the
      // block list above deliberately skips the King's Road's south kerb
      // between Gloucester and Beaufort.
      {
        id: "london-chelsea-square-green",
        kind: "park",
        // Centred in the deliberately-bare Beaufort–Gloucester stretch the
        // comment above describes. It shipped 60 m further east, under the
        // kings-s-4 parcel — a facade grid stood on the lawn.
        center: point(-431, -337),
        // Under `POCKET_GREEN_MAX_SHORT_SIDE_M` on the short side on purpose:
        // a garden square is a railinged lawn with a bench, not a park with a
        // path network and a wall through the middle of a Chelsea block.
        size: point(56, 28),
        color: "#5f9a4e",
      },
      // The green inside Pembroke Crescent's arc — the reason to build a
      // crescent at all.
      {
        id: "london-pembroke-green",
        kind: "park",
        center: point(-950, 120),
        size: point(80, 28),
        color: "#5f9a4e",
      },
      {
        id: "london-exhibition-road-public-space",
        kind: "park",
        // Public-space planting belongs beside Exhibition Road; rendering it
        // over the shared carriageway made the road appear to be missing.
        center: point(50, 30),
        size: point(8, 40),
        color: "#708c66",
      },
    ],
  },
  laneGraph: londonLaneGraph,
};

export const LONDON_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-uk-london",
  countryId: "uk",
  destinationId: "uk-london",
  mapId: "london-south-kensington",
  startSpawnId: "london-player",
  trafficSeed: 2251,
  scenarioClock: LONDON_SCENARIO_CLOCK,
};
