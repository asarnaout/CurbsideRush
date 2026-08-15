import type {
  ConflictZone,
  FreeDriveDefinition,
  LaneNode,
  LaneSegment,
  MapPack,
  ProceduralBlock,
  RailLine,
  RoadSurface,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WorldPoint,
} from "../types";
import { carveBlocksForRailCorridors } from "../geometry/railCorridor";
import { CONNECTOR_BLEND_RUN_M, buildLaneTrueGeometry } from "../laneConnectors";
import { buildingSetDepthM, isBuildingSetId } from "../buildingSets";
import { hashStringToSeed, PAVED_SIDEWALK_WIDTH_M } from "../visuals";
import {
  anchoredSpawn,
  approach,
  buildRailCrossingControl,
  control,
  distanceBetweenPoints,
  freeSpawn,
  graph,
  installation,
  makeLaneTrue,
  makeOsmSource,
  makeSpeedLimitForRoad,
  node,
  point,
  roadMarking,
  roadSurface,
} from "./cityAuthoringHelpers";

/** This file's own last-reviewed date — was `content.ts`'s `CONTENT_REVIEWED_ON`
 * (still "2026-07-10" as of the move) before this content had its own file;
 * kept local rather than imported back from `content.ts` to avoid a cycle
 * (`content.ts` imports `TOKYO_MAP_PACK` from here). */
export const TOKYO_CONTENT_REVIEWED_ON = "2026-07-10";

const osmSource = makeOsmSource(TOKYO_CONTENT_REVIEWED_ON);

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
 * A road declares its limit **once**, here or, for NYC, on its `NycRoadSpec`, and
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

const speedLimitForRoad = makeSpeedLimitForRoad(ROAD_SPEED_LIMITS);
const laneTrue = makeLaneTrue(speedLimitForRoad);

/**
 * Now that the map is paved, `defaultSidewalkWidthM` would give every road
 * `PAVED_SIDEWALK_WIDTH_M` (3.4 m) unless authored per road. The old
 * quarter's streets are narrower than that in real life, so each one gets an
 * explicit narrower band: shared-space lanes ~1.4 m (pedestrians share the
 * carriageway there already), the ordinary residential streets 2.0-2.6 m,
 * and only Setagaya-dori — the one arterial — takes a fuller 3.0 m.
 */
const withSidewalk = (surface: RoadSurface, sidewalkWidthM: number): RoadSurface => ({
  ...surface,
  sidewalkWidthM,
});

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

/** Flat form of `jpNodes`, reused by the generated half below (control
 * derivation needs every quarter node's position too). */
const jpNodesList: readonly LaneNode[] = Object.values(jpNodes);

// =============================================================================
// Generated half (Tokyo expansion Phase 2): the road-spec generator + turn
// whitelist, cloned from London's left-hand pattern (`LONDON_ROAD_SPECS` /
// `LONDON_JUNCTION_CONNECTORS` in cities/london.ts). Tokyo is also left-hand
// traffic, so London's lane-offset sign is correct to crib directly.
//
// This phase covers WEST of the Sakuragawa river only. `jp-kawagishi-dori`,
// `jp-higashi-dori`, `jp-higashi-hondori`, `jp-tofu-yokocho` + its web, the
// Kōshū-kaidō east continuation, all three bridges and the whole east bank
// are Phase 3's job. `jp-setagaya-dori-east` stops at its crossing with
// Chūō-dōri (440,-168) rather than the plan's suggested (480,-168): the
// circuit-walk test (`roadRealism.test.ts` "keeps every route on a circuit")
// requires every lane to reach a cycle under ANY successor choice, so a road
// end that leads nowhere is a hard failure, not just an unfinished look — the
// unbuilt 40 m to the bridge would have been exactly that. (440,-168) is a
// real, fully-connected junction and a perfectly good west-bank terminus for
// Phase 3 to extend from.
//
// The two halves meet ONLY at nodes that already exist in the quarter —
// `jp-ss-w`, `jp-ss-e`, `jp-d` and `jp-ne2` are the ones this phase's
// geometry actually reaches. No generated lane id is ever written into a
// hand-authored `successors` literal — the append-only merge below gives the
// quarter's lanes their new turns from the same whitelist the generated lanes
// read, exactly as London's `withGeneratedSuccessors`-equivalent does.
// =============================================================================

/**
 * A generated Tokyo road: a polyline through authored nodes plus how wide it
 * is and how many legal lanes it carries — Cairo/London's pattern, not NYC's
 * grid, because Tokyo explicitly is not a grid (R2). Unlike London (a flat
 * 20 mph everywhere), Tokyo's roads post genuinely different limits, so the
 * limit lives inline on the spec (NYC's pattern) rather than a second table
 * that could drift from it.
 */
interface TokyoRoadSpec {
  readonly id: string;
  /** HUD/GPS/sign spelling. */
  readonly name: string;
  readonly nodeIds: readonly string[];
  /** Total legal lanes across the carriageway (even, unless one-way). */
  readonly laneCount: 1 | 2 | 4;
  readonly widthM: number;
  readonly speedLimitKmh: number;
  readonly oneWay?: "forward" | "reverse";
  readonly surfaceType?: "standard" | "shared_space";
  /** Authored pavement width; omitted takes the paved-map 3.4 m default,
   * which is right for the wide arterials/collectors (>= 8 m carriageway).
   * Narrower roads (locals, shared-space, the yokochō) author an explicit
   * narrower band the way the existing quarter's roads do (§4.3). */
  readonly sidewalkWidthM?: number;
}

const tokyoRoad = (
  id: string,
  name: string,
  nodeIds: readonly string[],
  laneCount: 1 | 2 | 4,
  widthM: number,
  speedLimitKmh: number,
  options: Omit<TokyoRoadSpec, "id" | "name" | "nodeIds" | "laneCount" | "widthM" | "speedLimitKmh"> = {},
): TokyoRoadSpec => ({ id, name, nodeIds, laneCount, widthM, speedLimitKmh, ...options });

interface TokyoConnectorMovement {
  readonly fromRoadId: string;
  readonly toRoadIds: readonly string[];
}

interface TokyoJunctionConnectorSpec {
  readonly id: string;
  readonly nodeId: string;
  readonly movements: readonly TokyoConnectorMovement[];
}

/**
 * Every road listed turns legally onto every other one at this node — the
 * common case for an ordinary junction. Use the movements-array form directly
 * for a junction where that is not true (a one-way mouth, a restricted turn).
 */
const tokyoJunction = (
  id: string,
  nodeId: string,
  roadIds: readonly string[],
): TokyoJunctionConnectorSpec => ({
  id,
  nodeId,
  movements: roadIds.map((fromRoadId) => ({
    fromRoadId,
    toRoadIds: roadIds.filter((toRoadId) => toRoadId !== fromRoadId),
  })),
});

// --- Skeleton nodes: the west ring, its inner spine, and the downtown grid --
//
// Every E-W arterial/collector below is constant-z and every N-S one is
// constant-x (Chūō-dōri's arc and Renraku-dōri's diagonal are the deliberate
// exceptions R2 asks for) so every crossing lands exactly on the shared
// coordinate — no interpolation, no near-miss nodes.
const jpGenNodes = {
  // The west ring: jp-nishi-kanjo-dori (outer, x=-1200) and jp-kanpachi-dori
  // (inner, x=-700, the plan's named arterial) both run the map's full
  // z-extent, closed top and bottom by jp-yamashita-minami-dori /
  // jp-miyanosaka-kita-dori so neither dead-ends at the world margin — the
  // circuit-walk test requires every lane to reach a cycle under any
  // successor choice, so an unclosed ring end is a hard failure, not a
  // cosmetic one. jp-sangen-dori is a third, inner N-S spine sharing the same
  // two closing roads and the same three E-W crossings, giving the band
  // closest to the quarter more texture.
  nkS: node("jp-nk-s", -1200, -1140),
  nkMinami: node("jp-nk-minami", -1200, -800),
  nkSetagaya: node("jp-nk-setagaya", -1200, -168),
  nkKoshu: node("jp-nk-koshu", -1200, 560),
  nkN: node("jp-nk-n", -1200, 1140),

  kpS: node("jp-kp-s", -700, -1140),
  kpMinami: node("jp-kp-minami", -700, -800),
  kpSetagaya: node("jp-kp-setagaya", -700, -168),
  kpKoshu: node("jp-kp-koshu", -700, 560),
  kpN: node("jp-kp-n", -700, 1140),

  sgS: node("jp-sg-s", -460, -1140),
  sgMinami: node("jp-sg-minami", -460, -800),
  sgSetagaya: node("jp-sg-setagaya", -460, -168),
  sgKoshu: node("jp-sg-koshu", -460, 560),
  sgN: node("jp-sg-n", -460, 1140),

  // Downtown skeleton (west bank only). chuoSetagayaX is both the
  // Chūō-dōri/Setagaya-dōri-east crossing AND Setagaya-dōri-east's west-bank
  // terminus for this phase. Kōshū-kaidō and Minami-kaidō both stop at their
  // own crossing with Chūō-dōri (400/440) rather than the plan's suggested
  // 460/600: nothing else reaches those extra metres west-of-river this
  // phase, and an unbuilt stub is a true dead end (fails the circuit-walk
  // test), not just a rougher edge — Phase 3's bridge work picks up from
  // these exact junctions instead.
  chuoSetagayaX: node("jp-chuo-x-setagaya", 440, -168),
  chuoMinamiKaidoX: node("jp-chuo-x-minami-kaido", 440, -800),
  chuoMinamiDoriX: node("jp-chuo-x-minami-dori", 440, -60),
  chuoNakamiseX: node("jp-chuo-x-nakamise", 440, 40),
  chuoEkimaeX: node("jp-chuo-x-ekimae", 440, 140),
  chuoKitaDoriX: node("jp-chuo-x-kita-dori", 440, 320),
  // Chūō-dōri's arc (R2's "a diagonal or two") bends gently from the 4-lane
  // downtown core onto the northern spine, crossing Kōshū-kaidō exactly at
  // the bend's own node so neither line needs a second interpolated point.
  // (400,560) is the Chūō-dōri/Kōshū-kaidō crossing itself — the arc's shape
  // node and the junction node are the same point, so no interpolation.
  chuoKoshuX: node("jp-chuo-x-koshu", 400, 560),
  chuoN: node("jp-chuo-n", 380, 1140),

  // Kawate-dōri spans exactly Minami-dōri to Kita-dōri (z -60..320): the
  // plan's -260/360 stub ends had nothing else to meet this phase, which is
  // a true dead end, not a rougher edge — see the Kōshū-kaidō/Minami-kaidō
  // comment above for why that is a hard fail here, not a cosmetic one.
  kawateMinamiDoriX: node("jp-kawate-x-minami-dori", 580, -60),
  kawateEkimaeX: node("jp-kawate-x-ekimae", 580, 140),
  kawateKitaDoriX: node("jp-kawate-x-kita-dori", 580, 320),

  ekimaeW: node("jp-ekimae-w", 150, 140),

  // Ichiban-dōri/Niban-dōri span Setagaya-dōri-east (their south end, an
  // interior crossing on it — see that spec below) to Kita-dōri (their
  // north end) rather than the plan's -260/360: both stubs had nothing else
  // to meet, the same dead-end reasoning as the arterial trims above.
  ichibanSetagayaX: node("jp-ichiban-x-setagaya", 180, -168),
  ichibanMinamiDoriX: node("jp-ichiban-x-minami-dori", 180, -60),
  ichibanNakamiseX: node("jp-ichiban-x-nakamise", 180, 40),
  ichibanEkimaeX: node("jp-ichiban-x-ekimae", 180, 140),
  ichibanKitaDoriX: node("jp-ichiban-x-kita-dori", 180, 320),

  nibanSetagayaX: node("jp-niban-x-setagaya", 300, -168),
  nibanMinamiDoriX: node("jp-niban-x-minami-dori", 300, -60),
  nibanNakamiseX: node("jp-niban-x-nakamise", 300, 40),
  nibanEkimaeX: node("jp-niban-x-ekimae", 300, 140),
  nibanKitaDoriX: node("jp-niban-x-kita-dori", 300, 320),

  // Minami-dōri/Eki-mae-dōri/Kita-dōri all stop at Kawate-dōri (580) rather
  // than the plan's 600: the same dead-end reasoning — nothing crosses the
  // last 20 m before the (Phase-3) shoreline yet.
  minamiDoriW: node("jp-minami-dori-w", 150, -60),
  kitaDoriW: node("jp-kita-dori-w", 150, 320),

  // Renraku-dōri's real landing point: its straight run from jp-d (112,-18)
  // toward Ichiban-dōri crosses Shōtengai Nishi-dōri's own x=150 line
  // whatever it aims at (150 sits strictly between jp-d's x=112 and
  // Ichiban-dōri's x=180) — first authored as a silent, unmodelled overlap,
  // which `pavementPaths.test.ts` caught as a rail crossing a foreign
  // carriageway. Ending Renraku-dōri here instead makes that crossing the
  // real, connected T-junction it geometrically always was.
  shotengaiNishiRenrakuX: node("jp-shotengai-nishi-x-renraku", 150, 0),
  shotengaiNishiUptownX: node("jp-shotengai-nishi-x-uptown", 150, 168),
};

// --- Miyanosaka North residential web (z 560..1140, x -1200..-460) ---------
//
// Seven E-W local rungs, each touching only TWO of the three N-S ring roads
// (alternating which pair) rather than spanning all three — every rung ends
// in a clean T against the road it doesn't touch, offset 90-100 m from its
// neighbours on the road they share (Kanpachi-dōri, the shared middle line,
// carries every rung and so gets a T roughly every 90-100 m along this
// stretch, never a repeated 4-way). One full-width collector (Suzukake-dōri)
// crosses all three, per "collector every 250-400 m." A short N-S stub
// (Suzukake Yokochō) joins two adjacent rungs for extra T density.
const jpMiyanosakaNodes = {
  r6w: node("jp-mn-r6-kp", -700, 600),
  r6e: node("jp-mn-r6-sg", -460, 600),
  r1w: node("jp-mn-r1-nk", -1200, 650),
  r1e: node("jp-mn-r1-kp", -700, 650),
  r2w: node("jp-mn-r2-kp", -700, 750),
  r2e: node("jp-mn-r2-sg", -460, 750),
  stemN: node("jp-mn-stem-n", -580, 750),
  collW: node("jp-mn-coll-nk", -1200, 850),
  collM: node("jp-mn-coll-kp", -700, 850),
  collE: node("jp-mn-coll-sg", -460, 850),
  stemS: node("jp-mn-stem-s", -580, 850),
  r4w: node("jp-mn-r4-nk", -1200, 950),
  r4e: node("jp-mn-r4-kp", -700, 950),
  r5w: node("jp-mn-r5-kp", -700, 1050),
  r5e: node("jp-mn-r5-sg", -460, 1050),
  r7w: node("jp-mn-r7-nk", -1200, 1100),
  r7e: node("jp-mn-r7-kp", -700, 1100),
};

// --- Yamashita South residential web (z -1140..-800, x -1200..-460) -------
// Same alternating-pair-rung pattern as Miyanosaka North, scaled to this
// district's smaller 340 m band: four rungs + one full-width collector.
const jpYamashitaNodes = {
  r1w: node("jp-ys-r1-nk", -1200, -1100),
  r1e: node("jp-ys-r1-kp", -700, -1100),
  r2w: node("jp-ys-r2-kp", -700, -1040),
  r2e: node("jp-ys-r2-sg", -460, -1040),
  stemN: node("jp-ys-stem-n", -580, -1040),
  collW: node("jp-ys-coll-nk", -1200, -970),
  collM: node("jp-ys-coll-kp", -700, -970),
  collE: node("jp-ys-coll-sg", -460, -970),
  stemS: node("jp-ys-stem-s", -580, -970),
  r3w: node("jp-ys-r3-nk", -1200, -900),
  r3e: node("jp-ys-r3-kp", -700, -900),
  r4w: node("jp-ys-r4-kp", -700, -840),
  r4e: node("jp-ys-r4-sg", -460, -840),
  // Two more rungs south of Minami-kaidō's own +40 m clearance, reaching up
  // toward the quarter/Nishi boundary (z -230) so the 570 m gap between the
  // arterial and Nishi's own first rung doesn't read empty.
  r5w: node("jp-ys-r5-nk", -1200, -600),
  r5e: node("jp-ys-r5-kp", -700, -600),
  r6w: node("jp-ys-r6-kp", -700, -400),
  r6e: node("jp-ys-r6-sg", -460, -400),
};

// --- Nishi residential web (z -168..560, x -1200..-460) --------------------
// Nishi straddles the quarter's own latitude (z -168..210 sits alongside it)
// and reaches up to Kōshū-kaidō at z=560. Same alternating-pair-rung pattern;
// five rungs across the taller 728 m band, plus a short spur (Hana-dori)
// reaching east from Sangen-dōri toward the quarter's own western nodes
// (jp-sw / jp-cw) so Nishi reads as connective tissue, not a walled-off cell.
const jpNishiNodes = {
  r1w: node("jp-ni-r1-nk", -1200, -100),
  r1e: node("jp-ni-r1-kp", -700, -100),
  r2w: node("jp-ni-r2-kp", -700, -20),
  r2e: node("jp-ni-r2-sg", -460, -20),
  stemN: node("jp-ni-stem-n", -580, -20),
  collW: node("jp-ni-coll-nk", -1200, 60),
  collM: node("jp-ni-coll-kp", -700, 60),
  collE: node("jp-ni-coll-sg", -460, 60),
  stemS: node("jp-ni-stem-s", -580, 60),
  r3w: node("jp-ni-r3-nk", -1200, 150),
  r3e: node("jp-ni-r3-kp", -700, 150),
  r4w: node("jp-ni-r4-kp", -700, 260),
  r4e: node("jp-ni-r4-sg", -460, 260),
  r5w: node("jp-ni-r5-nk", -1200, 420),
  r5e: node("jp-ni-r5-kp", -700, 420),
};

// --- Ekimae-nishi mixed web (Tokyo authenticity plan P4; z 168..560,
// x -460..150) --------------------------------------------------------------
// Fills Region B (plan section 6.2): the true void between the quarter's own
// north row (z=168) and Kōshū-kaidō (z=560), west of the downtown skeleton's
// Shōtengai Nishi-dōri edge (x=150). Two mid-span tees into existing roads —
// the lane-id reference check ran clean for both (`grep -rn "jp-sangen-dori-"
// app/game tests` found no lane id naming a segment at or past this
// insertion; `jp-koshu-kaido-` only ever named segment 1, well before it —
// see the PR body): one on `jp-sangen-dori` (splits its segment 9->10 so the
// shopping street's west end lands on real ground instead of the 300 m gap
// the un-split road left between z=260 and z=560), one on `jp-koshu-kaido`'s
// own LAST segment (`jp-sg-koshu`->`jp-chuo-x-koshu`) so nothing downstream
// renumbers at all — "insert past the last-referenced segment index" in its
// purest form, which is exactly why the plan hands over these two particular
// bounding nodes rather than any other pair on that road.
//
// Four roads: `jp-ekimae-nishi-dori` (the neighbourhood shopping street,
// z~400, zoned `ekimae-nishi` but building-set-overridden to
// `tokyo-shotengai` like `jp-nakamise-yokocho` — see
// `tokyoRoadsideBuildingSet`'s own doc comment), `jp-sakuramachi-dori` (the
// E-W residential local, z=260, T-ending at the collector rather than
// crossing all the way to the shopping street — one more T, one fewer
// crossing, per R2's own preference), and two N-S connectors from the
// quarter's own north row: `jp-tsukimi-dori` (the shorter rung, `jp-nw2` up
// to the shopping street only) and `jp-nakasuji-dori` (the collector,
// `jp-nm2` — already a through-node on Uptown Road, so this literally
// continues the quarter's own Narrowhill Road spine north — up through BOTH
// E-W streets to the new Kōshū-kaidō tee). Every road but the shopping
// street is axis-aligned (constant-x or constant-z, zero bend anywhere).
// `jp-ekimae-nishi-dori` is the one exception R2 allows ("a diagonal or
// two"): it needs a real jog somewhere between its z~400 west end (on
// Sangen-dōri) and its fixed z=320 east terminus (`jp-kita-dori-w`, an
// existing node, not this file's to move). A first attempt concentrated the
// whole 80 m drop into the LAST 180 m segment alone (a single ~24 deg turn
// right at the `jp-kita-dori` handover) — the raw CHORD angle qualified as a
// "continuation" (<=25 deg) by `npcTurnSmoothness.test.ts`'s own rule, but
// the ACTUAL tangent jolt at that junction (after this narrow-tier road's
// own lane-offset blend reconciles against `jp-kita-dori`'s standard-tier
// one) measured 36.9 deg — over its 30 deg budget, caught by that exact test
// (not eyeballed). Spreading the same 80 m drop evenly across the WHOLE
// 610 m run instead (a single constant ~7.5 deg bearing from the Sangen-dōri
// tee straight through to `jp-kita-dori-w`, both interior crossings landing
// exactly on that one line) drops every node's local turn to zero and the
// final handover's tangent jolt comfortably under budget — re-verified by
// the same computation, not just argued from geometry.
const jpEkimaeNishiNodes = {
  sangenX: node("jp-sangen-x-ekimae-nishi", -460, 400),
  tsukimiSakuramachiX: node("jp-tsukimi-x-sakuramachi", -112, 260),
  // z = 354.36: on the single straight line from jp-sangen-x-ekimae-nishi
  // (-460,400) to jp-kita-dori-w (150,320) — see this block's own comment.
  tsukimiEkimaeNishiX: node("jp-tsukimi-x-ekimae-nishi", -112, 354.36),
  nakasujiSakuramachiX: node("jp-nakasuji-x-sakuramachi", -30, 260),
  // z = 343.61: same line, at x=-30.
  nakasujiEkimaeNishiX: node("jp-nakasuji-x-ekimae-nishi", -30, 343.61),
  koshuX: node("jp-koshu-x-nakasuji", -30, 560),
};

// --- Hanamizu residential web (Tokyo authenticity plan P5, Region A; the
// void at x -400..340, z 620..1080, 33.6 ha — the largest single region
// shipped so far) ------------------------------------------------------------
// Bounded west by Sangen-dōri (shared with Miyanosaka North's own east
// edge), north by Miyanosaka Kita-dōri, reached from the south via
// Kōshū-kaidō. Two of Sangen-dōri's four already-existing rung nodes in this
// span become this region's own E-W tees — `jp-mn-r2-sg`/`jp-mn-r5-sg`; the
// plan's own "z~760"/"z~950" are approximate the same way Region B's plan
// coordinates needed real correction (§6.2's own general caveat), and 750/
// 1050 are the two real anchors that give the two streets even ~300 m
// spacing across the void. The other two given anchors, `jp-mn-r6-sg` (600,
// just south of the void) and `jp-mn-coll-sg` (850, Miyanosaka's own
// Suzukake-dōri collector), stay exactly as Miyanosaka left them and gain no
// new arm here — they were listed for orientation, not as mandatory tees.
//
// The north end needs one genuine mid-span insertion into Miyanosaka
// Kita-dōri (see that spec's own updated comment, below). The south end does
// NOT need a fresh insertion — Region B's own P4 phase already split
// Kōshū-kaidō for `jp-nakasuji-dori` (`jp-koshu-x-nakasuji`, x=-30), exactly
// the x this collector wants, so it simply continues Nakasuji-dōri straight
// across Kōshū-kaidō instead of minting a second nearby node: the "grep
// before trusting the plan's road-layout research is still current" lesson
// this phase's own brief called out by name (`jp-koshu-kaido-` greps clean —
// nothing references a segment index this reuse would move, because no new
// node is inserted into that road's own `nodeIds` at all).
//
// Six roads: `jp-yuri-dori`/`jp-ajisai-dori` (the two E-W residential
// streets, z=750/z=1050 — dead straight, tee onto Sangen-dōri west, end at
// their own easternmost local's junction east, no unconnected stub);
// `jp-hanamizuki-dori` (the N-S collector, x=-30, `jp-koshu-x-nakasuji` to a
// new tee on Miyanosaka Kita-dōri — the collector tier, `2, 7, 40`, one notch
// up from the residential locals, matching Suzukake/Yanagi/Hato-dōri's own
// numbers); `jp-tsutsuji-dori`/`jp-momo-dori`/`jp-kosumosu-dori` (three short
// N-S locals between the two E-W streets, T-ending at both — "T-ended, not
// crossing" per the plan). Every road here is axis-aligned (constant-x or
// constant-z), zero bend at every node — R2's "a diagonal or two" allowance
// is Region B's own `jp-ekimae-nishi-dori`, not needed again here; the
// organic read instead comes from the irregular spacing (sangen tee at -460,
// then -220/-30/140/260 — 240/190/170/120 m pitches, none repeated) rather
// than a regular grid.
//
// Node naming follows the established convention: an ordinary new crossing
// names the N-S road first (`jp-tsutsuji-x-yuri`, matching Region B's
// `jp-tsukimi-x-sakuramachi`), while `jp-hanamizuki-n` follows Miyanosaka
// Kita-dōri's OWN pre-existing sub-convention for its four nodes
// (`jp-nk-n`/`jp-kp-n`/`jp-sg-n`/`jp-chuo-n` — crossing-road abbreviation +
// "-n") rather than the generic "-x-" form, since "kita" alone would collide
// in spirit with the unrelated downtown `jp-kita-dori`.
const jpHanamizuNodes = {
  tsutsujiXYuri: node("jp-tsutsuji-x-yuri", -220, 750),
  hanamizukiXYuri: node("jp-hanamizuki-x-yuri", -30, 750),
  momoXYuri: node("jp-momo-x-yuri", 140, 750),
  kosumosuXYuri: node("jp-kosumosu-x-yuri", 260, 750),
  tsutsujiXAjisai: node("jp-tsutsuji-x-ajisai", -220, 1050),
  hanamizukiXAjisai: node("jp-hanamizuki-x-ajisai", -30, 1050),
  momoXAjisai: node("jp-momo-x-ajisai", 140, 1050),
  kosumosuXAjisai: node("jp-kosumosu-x-ajisai", 260, 1050),
  hanamizukiN: node("jp-hanamizuki-n", -30, 1140),
};

// --- Sumiregaoka residential web (Tokyo authenticity plan P6, Region C; the
// void at x -400..380, z -740..-220, 40.6 ha — the biggest interior void in
// the whole plan) --------------------------------------------------------
// Bounded west by Sangen-dōri (shared with every other web's own west edge)
// at the existing node `jp-ys-r6-sg` (-460,-400) — the plan's own "z~-380"
// rounds to this node's real z=-400 exactly, the same "correct the
// approximate coordinate to the real anchor" move Region A's own z~760/
// z~950 -> 750/1050 correction made. Bounded north by the Setagaya-dōri row
// (`jp-ss-w`/`jp-ss-m`/`jp-ichiban-x-setagaya`/`jp-niban-x-setagaya`, all
// already-existing nodes); the plan's own "x~200" third-local anchor has no
// real node at that x — `jp-ichiban-x-setagaya` (x=180) is the nearest real
// one, so that is what this web actually ties into (this phase's own
// version of the same correction). Reached in the south-east by a new
// mid-span tee into `jp-minami-kaido` (z=-800) — see `TOKYO_SUMIREGAOKA_
// SPECS`'s own comment for why only the collector reaches that far.
//
// The plan's design line reads "three N-S locals... all three tee onto
// EXISTING nodes at both ends" — grepping every node table turns up no
// pre-Region-C node anywhere south of the Setagaya-dōri row at x=-260/-30/
// 180 (the three locals' own x positions), so a literal "both ends
// pre-exist" is not achievable; the design below instead gives each local a
// real, non-dead-end junction at BOTH ends — the existing arterial to the
// north, this web's own southern E-W street (Suisen-dōri) to the south —
// which is what the plan's traps section (§8) actually requires ("no dead
// ends"), and documents the correction here rather than silently
// reinterpreting it. Seven roads: `jp-nanohana-dori`/`jp-suisen-dori` (the
// two E-W residential streets, z=-400/z=-580, BOTH reaching Sangen-dōri —
// Nanohana-dōri at the existing `jp-ys-r6-sg`, Suisen-dōri at a second new
// mid-span tee, `jp-sangen-x-suisen`); `jp-fuyo-dori`/`jp-renge-dori`/
// `jp-asagao-dori` (the three N-S locals, x=-260/-30/180, each running from
// its own Setagaya-dōri-row node down through Nanohana-dōri — a real 4-way,
// since the local continues south of it — to a T-end at Suisen-dōri);
// `jp-sumiregaoka-dori` (the N-S collector, x=300, collector tier `2,7,40`
// like Suzukake/Yanagi/Hato/Hanamizuki-dōri's own numbers, `jp-niban-x-
// setagaya` to a third new mid-span tee on `jp-minami-kaido`, crossing both
// E-W streets as real 4-ways the whole way down). Every road here is
// axis-aligned, zero bend at every node; the organic read comes from the
// irregular N-S pitches (sangen tee at -460, then -260/-30/180/300 --
// 200/230/210/120 m, none repeated) the same way every other web's own
// spacing does it.
//
// Suisen-dōri's own Sangen-dōri tee is a deliberate, verified addition, not
// the plan's own suggested shape: a first pass left Suisen-dōri starting at
// Fuyō-dōri's own T (a real, legal, non-dead-end 2-road junction — the same
// shape `jp-jct-kosumosu-x-yuri` already ships on Region A's own SE corner)
// and re-ran the plan's own void raster (`voidRaster.mjs`) straight after —
// the ORIGINAL 40.6 ha blob did fall off the >=4 ha interior list, but a
// NEW 7.9 ha residual (x[-400..240] z[-740..-460]) appeared in its place: the
// strip west of Fuyō-dōri and south of Nanohana-dōri, more than 60 m from
// every road on the map, does not close just because the two streets either
// side of it exist. Extending Suisen-dōri the extra ~200 m to Sangen-dōri —
// mirroring how BOTH of Region A's own E-W streets reach it — closes that
// strip; see this insertion's own lane-id reference check on jp-sangen-dori's
// updated spec line (TOKYO_SKELETON_SPECS above) for what it found. The
// residual west-of-collector story is not finished by this alone (see the
// void-raster before/after in the PR body), but the qualifying interior blob
// is gone.
//
// Node naming: an ordinary new crossing names the N-S road first (matching
// Region A/B's own convention, e.g. `jp-tsutsuji-x-yuri`); a mid-span
// insertion into an EXISTING road follows the same rule (the N-S road that
// tees in comes first) rather than the older `jp-chuo-x-minami-kaido`'s
// incidental order. "Sumire" (violet — the flower `Sumiregaoka`/"Violet
// Hill" is named for) is already spoken for by Miyanosaka's own
// `jp-mn-sumire-dori`, so the two new E-W streets take two other real
// Setagaya-flavoured flower names instead (nanohana = canola flower, suisen
// = narcissus) and the collector — this web's own spine — takes the
// district's own name instead, mirroring how `jp-miyanosaka-kita-dori`
// already does the same thing for its own web.
const jpSumiregaokaNodes = {
  sangenXSuisen: node("jp-sangen-x-suisen", -460, -580),
  nanohanaXFuyo: node("jp-fuyo-x-nanohana", -260, -400),
  nanohanaXRenge: node("jp-renge-x-nanohana", -30, -400),
  nanohanaXAsagao: node("jp-asagao-x-nanohana", 180, -400),
  nanohanaXSumiregaoka: node("jp-sumiregaoka-x-nanohana", 300, -400),
  suisenXFuyo: node("jp-fuyo-x-suisen", -260, -580),
  suisenXRenge: node("jp-renge-x-suisen", -30, -580),
  suisenXAsagao: node("jp-asagao-x-suisen", 180, -580),
  suisenXSumiregaoka: node("jp-sumiregaoka-x-suisen", 300, -580),
  sumiregaokaXMinamiKaido: node("jp-sumiregaoka-x-minami-kaido", 300, -800),
};

// --- Minamimachi web + services (Tokyo authenticity plan P7, Region D; the
// void at x -420..620, z -1150..-740, 1040x410 m, touching the south world
// edge) -----------------------------------------------------------------
// Bounded west by Sangen-dōri, reusing three already-existing nodes the same
// way every other web's own west edge does: `jp-ys-r4-sg` (-460,-840) is
// named as a Region D anchor in the plan but goes UNUSED below, exactly as it
// was left unused by Region C before it (grep TOKYO_SUMIREGAOKA_SPECS/
// CONNECTORS above — neither ever references it); `jp-ys-coll-sg`
// (-460,-970) and `jp-ys-r2-sg` (-460,-1040) are the two this web actually
// ties into. Four roads, every one axis-aligned with zero bend at every
// node: `jp-minamimachi-dori` (the E-W spine and this web's own collector —
// `2, 7, 40`, matching Suzukake/Yanagi/Hato/Hanamizuki/Sumiregaoka-dōri's own
// numbers — dead straight at z=-970 from `jp-ys-coll-sg` to a new south
// extension of `jp-chuo-dori-south`, the plan's own "new tee"); `jp-shion-
// dori`/`jp-susuki-dori` (the two N-S locals, x=-100/x=300 — the plan's own
// approximate "x~-100"/"x~250" the second corrected to 300, the real
// `jp-sumiregaoka-x-minami-kaido` node's own x, so `jp-susuki-dori` reads as
// that collector's own continuation south of Minami-kaidō rather than mint a
// fourth new node 50 m away from it); `jp-nadeshiko-dori` (the short E-W
// local, z=-1040 — the plan's own "z~-1060" rounds to this anchor's real
// z=-1040, dead straight from `jp-ys-r2-sg` to `jp-susuki-dori`'s own
// crossing, the same anchor-snapping correction every other region's own
// build has already made at least once).
//
// `jp-susuki-dori` reaches Minami-kaidō by reusing the existing
// `jp-sumiregaoka-x-minami-kaido` node outright — a fourth arm on an
// existing connector (edited in TOKYO_SUMIREGAOKA_CONNECTORS above), not a
// new node, so zero renumbering risk. `jp-shion-dori` does NOT reach
// Minami-kaidō this pass — it T-ends cleanly at both `jp-minamimachi-dori`
// and `jp-nadeshiko-dori` instead (no dead end either way, since a T needs
// no far-end anchor to be legal) — see the void-raster before/after in the
// PR body for whether that leaves a residual the way Region C's own first
// pass did, and this file's own history if a follow-up extended it.
//
// `jp-minamimachi-dori`'s own east end is the plan's real ask: a new tee on
// `jp-chuo-dori-south`, which currently dead-ends at `jp-chuo-x-minami-kaido`
// (z=-800) — 170 m short of z=-970. Reaching it means genuinely extending
// that arterial south by one node (`jp-chuo-x-minamimachi`, prepended to its
// own `nodeIds` below), not a between-two-existing-nodes mid-span insertion
// (its current span runs entirely north of z=-800, so there is no existing
// interior to split). `grep -rn "jp-chuo-dori-south-" app/game tests` before
// this split found no lane-id-with-distance reference to its own (only)
// segment anywhere — every hit is a node-id-keyed signal/camera slug in
// trafficControlCharacterization.test.tsx, unaffected (neither
// `jp-chuo-x-minami-kaido` nor `jp-chuo-x-setagaya` changes which roads meet
// them, so their own arm slugs hold; a new slug appears for the new node, an
// expected re-baseline). `jp-jct-chuo-minami-kaido`'s existing connector
// (`["jp-minami-kaido", "jp-chuo-dori-south"]`) needs no edit: it already
// names jp-chuo-dori-south, and same-road continuation across a node a road
// merely passes through has never needed a connector entry anywhere in this
// file (`jp-jct-sumiregaoka-x-minami-kaido` already relies on exactly this
// for Minami-kaidō's own through movement, both before and after this
// phase's own edit to it).
//
// Node naming: an ordinary new crossing names the N-S road first (matching
// every other region's own convention); the mid-span/extension insertion
// into `jp-chuo-dori-south` (itself N-S) follows the same rule ahead of the
// E-W road tee-ing into it. "Minamimachi" ("south town") is a plain
// geographic name rather than a flower, matching how `ekimae-nishi` names
// its own district while its streets (Tsukimi/Nakasuji/Hanamizuki) carry the
// flower/moon vocabulary instead — shion (aster) and susuki (pampas grass,
// an autumn Setagaya staple) and nadeshiko (fringed pink) are three
// real-Japanese flower names not yet used anywhere else on this map.
const jpMinamimachiNodes = {
  // A second new mid-span tee into Minami-kaidō (see this node's own doc
  // comment on jp-minami-kaido's spec below for the lane-id reference check):
  // the empirically-measured fix for a real 2.56 ha gap the first-pass
  // 4-road design left between Minami-kaidō's own 60 m reach (ending z=-860)
  // and jp-minamimachi-dori's own reach (starting z=-910) — the void raster
  // found it, not a guess (see the PR body for the before/after).
  shionXMinamiKaido: node("jp-shion-x-minami-kaido", -100, -800),
  shionXMinamimachi: node("jp-shion-x-minamimachi", -100, -970),
  susukiXMinamimachi: node("jp-susuki-x-minamimachi", 300, -970),
  chuoXMinamimachi: node("jp-chuo-x-minamimachi", 440, -970),
  shionXNadeshiko: node("jp-shion-x-nadeshiko", -100, -1040),
  susukiXNadeshiko: node("jp-susuki-x-nadeshiko", 300, -1040),
};

// --- Nishi Minami web (Tokyo authenticity plan P8, Region E; the void at
// x -1140..-760, z -540..-220, 12.2 ha) ---------------------------------
// Bounded by the two west rings themselves — Nishi-Kanjō-dōri (x=-1200) and
// Kanpachi-dōri (x=-700) — rather than by any web's own east/west edge the
// way every other region so far has been: this is the corridor BETWEEN the
// rings, immediately south of the existing Nishi web (z -168..560), so its
// roads read as Nishi's own southward continuation (zone stays `nishi`, no
// new zone minted — see the SETS/style comment below).
//
// The plan hands over five anchors: `jp-nk-setagaya`(-1200,-168)/
// `jp-ys-r5-nk`(-1200,-600) on Nishi-Kanjō-dōri, `jp-kp-setagaya`(-700,-168)/
// `jp-ys-r6-kp`(-700,-400)/`jp-ys-r5-kp`(-700,-600) on Kanpachi-dōri, and
// suggests "the z~-470 lane can run node-to-node, jp-ys-r5-nk -> jp-ys-r5-kp
// roughly aligns." Checked, not trusted: `jp-ys-r5-nk`/`jp-ys-r5-kp` are
// ALREADY a real, driven road — `jp-ys-hagi-dori` (TOKYO_YAMASHITA_SPECS,
// Tokyo expansion Phase 2) already connects them, at z=-600, 60 m SOUTH of
// this void's own z=-540 edge (that is exactly why the void starts there —
// hagi-dori's own 60 m reach covers up to z=-540). Building a second road
// between the same two nodes would duplicate hagi-dori, not fill the void.
// `jp-ys-r6-kp` (z=-400), the plan's OTHER Kanpachi-dōri anchor, is the real
// node-to-node opportunity instead: it sits inside the void's own z-range,
// already a live junction (Kanpachi-dōri x Kikyō-dōri, `jp-jct-ys-r6-kp`),
// and has never carried a west-facing (Nishi-Kanjō-dōri-ward) arm — reusing
// it needs only ONE new node, on Nishi-Kanjō-dōri, not two.
//
// Two E-W residential locals close the gap between the two arterials
// (z=-168, Setagaya-dōri-west) and hagi-dori (z=-600) south of it:
// `jp-sazanka-dori` (z=-400, the corrected "node-to-node" lane — a new
// Nishi-Kanjō-dōri tee, `jp-nishi-kanjo-x-sazanka`, straight across to the
// existing `jp-ys-r6-kp`) and `jp-hiiragi-dori` (z=-280, roughly the plan's
// own "z~-290" — needs the mid-span procedure on BOTH rings, new tees on
// each: `jp-nishi-kanjo-x-hiiragi`/`jp-kanpachi-x-hiiragi`). Both rings run
// perfectly straight (constant x the whole way — confirmed against every
// node in `jpGenNodes`/`jpYamashitaNodes`/`jpNishiNodes`), so every
// insertion below costs zero bend at every point, old and new alike.
//
// Coverage math, not just a placement guess: hagi-dori's own 60 m reach ends
// at z=-540; Setagaya-dōri-west's own 60 m reach starts at z=-228. The
// interior needing coverage is therefore a 312 m band (z -540..-228) — two
// E-W lines can double-cover at most 240 m of that between them (each line's
// own reach is 120 m end-to-end), so a real, honest residual of roughly
// 70-80 m stays uncovered between hagi-dori and Sazanka-dōri regardless of
// exactly where the two new lines sit — a ~2.7-3.0 ha strip, under the
// raster's own 4 ha qualifying floor either way (see the PR body for the
// measured before/after). Two lines is what the plan asks for; a third was
// not added to chase a sub-threshold residual the raster will not even flag.
//
// Node naming: an ordinary new crossing names the N-S road first (matching
// every other region's own convention) — both rings are already known
// everywhere else in this file by their short forms (`nishi-kanjo`/
// `kanpachi`, not `nk`/`kp`, which is reserved for the RUNG-node
// abbreviation the original webs use), so `jp-nishi-kanjo-x-sazanka` etc.
// follows the same full-short-name pattern as `jp-sangen-x-suisen`/
// `jp-shion-x-minami-kaido`. Sazanka (winter camellia) and hiiragi (holly
// osmanthus) are two real Setagaya-flavoured plant names not yet used
// anywhere else on this map.
const jpNishiMinamiNodes = {
  nishiKanjoXSazanka: node("jp-nishi-kanjo-x-sazanka", -1200, -400),
  nishiKanjoXHiiragi: node("jp-nishi-kanjo-x-hiiragi", -1200, -280),
  kanpachiXHiiragi: node("jp-kanpachi-x-hiiragi", -700, -280),
};

// --- Kawabata web (Tokyo authenticity plan P8, Region F; the void at
// x 420..620, z 620..1150, 9.8 ha, touches the north world edge) ---------
// The plan's three anchors: `jp-chuo-x-koshu`(400,560) on Chūō-dōri-north,
// `jp-kawate-x-koshu`(580,560) on Kawate-dōri, `jp-chuo-n`(380,1140) on
// Miyanosaka Kita-dōri. Checked, not assumed: `jp-kawate-dori`'s own spec
// (TOKYO_SKELETON_SPECS) ends at exactly `jp-kawate-x-koshu` — the plan's
// own anchor already IS the road's real north terminus, nothing past it —
// so the west riverside collector genuinely goes no further north than
// z=560, 60-580 m short of this void depending on latitude; Region F's own
// spine has to reach the void on its own, not extend that road.
//
// A second, more consequential check the plan's own anchor pair did NOT
// survive: `jp-chuo-x-koshu` and `jp-kawate-x-koshu` are BOTH already on
// the map's live z=560 through-line — Kōshū-kaidō runs it west of the
// river, `jp-tsuki-ohashi` continues the SAME line east across it
// (`TOKYO_SAME_STREET_GROUPS["jp-chuo-x-koshu"]`, "a street that continues
// must read continuous"). A first pass drew Kawasemi-dōri as one straight
// line directly between the two literal anchors — which put its own
// sidewalk rails ON TOP of Tsuki-ōhashi's own carriageway for its entire
// 180 m west-bank approach (both centrelines sit at z=560; a road's rails
// sit only a few metres either side of its own centreline). Not a cosmetic
// near-miss: `pavementPaths.test.ts`'s "keeps every kept map's rails off
// the carriageways" caught real rail points sampling *inside*
// `jp-tsuki-ohashi`'s own asphalt. The fix is geometric, not a table edit —
// two new nodes 40 m north of the bridge line (z=600, comfortably clear of
// tsuki-ohashi's own 12 m carriageway, whose edge sits at z=566), each a
// genuine new anchor on the respective road rather than the literal (but
// already-occupied) node the plan named: `jp-chuo-x-kawasemi` (mid-span on
// Chūō-dōri-north's own existing line to `jp-chuo-n` — see that road's own
// updated spec comment for why this costs zero extra bend) and
// `jp-kawate-x-kawasemi` (a 40 m extension of Kawate-dōri past its own old
// terminus — see that road's own updated spec comment). Kawasemi-dōri
// itself is now dead straight at z=600 the whole way, nowhere near the
// bridge line at all.
//
// One N-S spine, `jp-kawabata-dori` (x=510, the collector tier — this
// district's own name, matching how Minamimachi/Sumiregaoka/Hanamizuki-dōri
// each carry their own district's name), running from a new T on
// Kawasemi-dōri's own midpoint up to a new tee on Miyanosaka Kita-dōri. The
// "two E-W stubs" the plan asks for (to Chūō-dōri-north and to Kawate-dōri)
// are one straight residential local, `jp-kawasemi-dori` (kingfisher — a
// real Sakuragawa-side bird, unused elsewhere on this map), threaded
// through a mid-route T where the spine departs north —
// `jp-kawabata-x-kawasemi` — exactly the "collector-with-a-through-stem"
// shape Suzukake/Yanagi/Hato-dōri already use for their own yokochō stem,
// just with the roles swapped (here the E-W road is the through line and
// the N-S spine is what tees off its middle).
//
// The spine's north end needs a genuine extension of Miyanosaka Kita-dōri
// past its OWN old terminus, `jp-chuo-n` — not a mid-span insertion (that
// road's `nodeIds` end there; there is no interior span east of it to
// split), an append. `jp-chuo-n` is also a live TOKYO_SIGNAL_NODE_IDS entry,
// so this is not the ordinary "quiet stop-sign renumber" every prior
// region's own ring/arterial extension has been: the signal genuinely GAINS
// a third arm (Miyanosaka Kita-dōri's own reverse lane, now arriving from
// `jp-kawabata-n` instead of nowhere) AND has one existing arm rename (its
// own Chūō-dōri-north arm's immediate neighbour moves from jp-chuo-x-koshu
// to jp-chuo-x-kawasemi, the same knock-on rename that road's own insertion
// causes at jp-chuo-x-koshu too) — `deriveTokyoSignalControls` derives every
// arm generically off whatever lanes physically arrive, so this needs no
// code change, only the pinned approach/head strings in
// trafficControlCharacterization.test.tsx re-baselined (verified by running
// the test, not guessed).
//
// `jp-kawabata-dori` sits at x=510, comfortably inland of the Sakuragawa's
// own west edge across this whole span (measured against
// `TOKYO_WATER_BODIES`'s polygon, not eyeballed) — nowhere near
// river-facing, so it needs no `TOKYO_OPEN_WATERFRONT_SIDES` entry of its
// own; `jp-kawate-dori`'s own existing row already covers its new 40 m
// extension too (keyed by road id, not by segment), verified live via CDP.
const jpKawabataNodes = {
  chuoXKawasemi: node("jp-chuo-x-kawasemi", 398.62, 600),
  kawateXKawasemi: node("jp-kawate-x-kawasemi", 580, 600),
  kawabataXKawasemi: node("jp-kawabata-x-kawasemi", 510, 600),
  kawabataN: node("jp-kawabata-n", 510, 1140),
};

// --- River nodes (Phase 3): where the west/east riverside collectors ------
// (jp-kawate-dori, jp-kawagishi-dori) cross the three bridges. Every bridge
// is dead straight (constant z) so each crossing is a shared node at zero
// bend, not an interpolated near-miss — the same reasoning Chūō-dōri's own
// arc-node already established in Phase 2. jp-higashi-w/jp-khh-w are each
// bridge's own inland east landing, shared with the east-bank skeleton below.
const jpRiverNodes = {
  kawateSetagaya: node("jp-kawate-x-setagaya", 580, -168),
  kawateKawanaka: node("jp-kawate-x-kawanaka", 580, 180),
  kawateKoshu: node("jp-kawate-x-koshu", 580, 560),
  // jp-kawagishi-dori's own nodes, south to north: a real junction at every
  // bridge crossing, plus two pure shape points (w1/w2, no other road meets
  // them, so they need no connector entry — same-road continuation is always
  // legal) that keep the collector's wobble gentle (every bend <=5 deg).
  kawagishiMinami: node("jp-kawagishi-x-minami", 768, -600),
  kawagishiFuji: node("jp-kawagishi-x-fuji", 769, -380),
  kawagishiSetagaya: node("jp-kawagishi-x-setagaya", 770, -168),
  kawagishiW1: node("jp-kawagishi-w1", 765, 90),
  kawagishiKawanaka: node("jp-kawagishi-x-kawanaka", 768, 180),
  kawagishiW2: node("jp-kawagishi-w2", 758, 400),
  kawagishiKoshu: node("jp-kawagishi-x-koshu", 752, 560),
  kawagishiKita: node("jp-kawagishi-x-kita", 765, 900),
  higashiW: node("jp-higashi-w", 860, -168),
  kawanakaE: node("jp-kawanaka-e", 980, 180),
  khhW: node("jp-khh-w", 880, 560),
};

// --- East bank skeleton (Phase 3): Higashi-dōri and Kōshū-kaidō's own east
// continuations, the Higashi Hon-dōri spine, the outer ring closer, and the
// compact Tōfu Yokochō residential pocket ("compact web" per plan §8.2 —
// smaller in scope than the three west-bank districts on purpose). Higashi-
// dōri/Kōshū-kaidō-higashi are trimmed to their real crossing with the outer
// ring closer (x=1200) rather than running on to the plan's original 1240:
// past that crossing neither road meets anything else this phase, which is a
// true dead end (fails the circuit-walk test), the same reasoning behind
// every west-bank trim in Phase 2.
const jpEastNodes = {
  hdXTofu: node("jp-hd-x-tofu", 870, -168),
  hdXHondori: node("jp-hd-x-hondori", 980, -168),
  hdXSoto: node("jp-hd-x-soto", 1200, -168),
  khhXKeyaki: node("jp-khh-x-keyaki", 930, 560),
  khhXHondori: node("jp-khh-x-hondori", 980, 560),
  khhXSoto: node("jp-khh-x-soto", 1200, 560),
  hhS: node("jp-hh-s", 980, -600),
  hhXFuji: node("jp-hh-x-fuji", 980, -380),
  hhN: node("jp-hh-n", 980, 900),
  tyS: node("jp-ty-s", 870, -600),
  tyXFuji: node("jp-ty-x-fuji", 870, -380),
  hkdXKeyaki: node("jp-hkd-x-keyaki", 930, 900),
};

// --- Ring + downtown skeleton (§8.4, west-of-river subset) -----------------
const TOKYO_SKELETON_SPECS: readonly TokyoRoadSpec[] = [
  // Ascending z the whole way, every district's rung/collector crossings
  // spliced in between whichever skeleton nodes they fall between.
  // "jp-nishi-kanjo-x-sazanka"/"jp-nishi-kanjo-x-hiiragi" (Tokyo authenticity
  // plan P8, Region E) are TWO new nodes spliced between jp-ys-r5-nk and
  // jp-nk-setagaya — a 432 m gap with nothing else this file ever put
  // between them. `grep -rn "jp-nishi-kanjo-dori-" app/game tests` before
  // this split found no lane-id-with-distance reference anywhere (every hit
  // is a node-named signal arm slug in trafficControlCharacterization.
  // test.tsx, keyed off jp-ys-r5-nk as jp-nk-setagaya's own immediate
  // southbound neighbour — that neighbour becomes jp-nishi-kanjo-x-hiiragi
  // after this split, so that one pinned arm re-baselines in the same
  // commit, the same shape as every prior region's own ring-road insertion).
  tokyoRoad("jp-nishi-kanjo-dori", "Nishi Kanjō-dōri", ["jp-nk-s", "jp-ys-r1-nk", "jp-ys-coll-nk", "jp-ys-r3-nk", "jp-nk-minami", "jp-ys-r5-nk", "jp-nishi-kanjo-x-sazanka", "jp-nishi-kanjo-x-hiiragi", "jp-nk-setagaya", "jp-ni-r1-nk", "jp-ni-coll-nk", "jp-ni-r3-nk", "jp-ni-r5-nk", "jp-nk-koshu", "jp-mn-r1-nk", "jp-mn-coll-nk", "jp-mn-r4-nk", "jp-mn-r7-nk", "jp-nk-n"], 2, 8, 40),
  // "jp-kanpachi-x-hiiragi" (Tokyo authenticity plan P8, Region E) is a NEW
  // node spliced between jp-ys-r6-kp and jp-kp-setagaya (232 m, nothing else
  // between them). `grep -rn "jp-kanpachi-dori-" app/game tests` before this
  // split found exactly one lane-id-with-distance reference,
  // `jp-kanpachi-dori-1-forward-1`/`-1-reverse-1` (the jp-car-kanpachi-n/-s
  // spawns, segment 1 — jp-kp-s to jp-ys-r1-kp, 8 segments before this
  // insertion, unaffected) — plus the same node-named signal-slug pattern as
  // above, this time at jp-kp-setagaya (immediate neighbour jp-ys-r6-kp ->
  // jp-kanpachi-x-hiiragi), re-baselined in the same commit. jp-ys-r6-kp
  // itself is untouched here (still this road's own waypoint, unchanged
  // position/index) — Region E's own Sazanka-dōri reuses it directly as a
  // new THIRD arm on its existing 2-arm connector instead (below), needing
  // no insertion into this list at all.
  tokyoRoad("jp-kanpachi-dori", "Kanpachi-dōri", ["jp-kp-s", "jp-ys-r1-kp", "jp-ys-r2-kp", "jp-ys-coll-kp", "jp-ys-r3-kp", "jp-ys-r4-kp", "jp-kp-minami", "jp-ys-r5-kp", "jp-ys-r6-kp", "jp-kanpachi-x-hiiragi", "jp-kp-setagaya", "jp-ni-r1-kp", "jp-ni-r2-kp", "jp-ni-coll-kp", "jp-ni-r3-kp", "jp-ni-r4-kp", "jp-ni-r5-kp", "jp-kp-koshu", "jp-mn-r6-kp", "jp-mn-r1-kp", "jp-mn-r2-kp", "jp-mn-coll-kp", "jp-mn-r4-kp", "jp-mn-r5-kp", "jp-mn-r7-kp", "jp-kp-n"], 2, 11, 50),
  // "jp-sangen-x-ekimae-nishi" (Tokyo authenticity plan P4) is a NEW node
  // spliced between jp-ni-r4-sg and jp-sg-koshu — the 300 m gap Region B's
  // shopping street needed a real tee into. This renumbers every later
  // segment's lane ids (old segment 10 onward shift up by one); the only
  // live reference into that range was `trafficControlCharacterization.
  // test.tsx`'s pinned arm-slug for the jp-sg-koshu signal's southbound
  // sangen-dori approach (`...-jp-sangen-dori-ni-r4-sg-...`, since that arm's
  // lane now departs the new node instead), re-baselined in the same commit.
  // "jp-sangen-x-suisen" (Tokyo authenticity plan P6) is a SECOND new node,
  // spliced between jp-sg-minami and jp-ys-r6-sg (a 400 m gap with nothing
  // else this file ever put between them) — Suisen-dōri's own west end,
  // added after the plan's own void raster found a 7.9 ha residual west of
  // Fuyō-dōri once this web's other six roads were in place (see
  // `jpSumiregaokaNodes`'s own doc comment for the measured before/after).
  // Unlike the ekimae-nishi insertion above, this one lands early (old
  // segment 5->6 boundary, out of 16), so MANY later segments renumber —
  // `grep -rn "jp-sangen-dori-" app/game tests` before this split found NO
  // segment-index lane-id references anywhere on this road (every hit was
  // either a node-named signal arm slug in trafficControlCharacterization.
  // test.tsx, deferred to the bundle's final re-baseline pass, or a comment),
  // so the renumbering itself is safe despite the early insertion point.
  tokyoRoad("jp-sangen-dori", "Sangen-dōri", ["jp-sg-s", "jp-ys-r2-sg", "jp-ys-coll-sg", "jp-ys-r4-sg", "jp-sg-minami", "jp-sangen-x-suisen", "jp-ys-r6-sg", "jp-sg-setagaya", "jp-ni-r2-sg", "jp-ni-coll-sg", "jp-ni-r4-sg", "jp-sangen-x-ekimae-nishi", "jp-sg-koshu", "jp-mn-r6-sg", "jp-mn-r2-sg", "jp-mn-coll-sg", "jp-mn-r5-sg", "jp-sg-n"], 2, 8, 40),
  tokyoRoad("jp-yamashita-minami-dori", "Yamashita Minami-dōri", ["jp-nk-s", "jp-kp-s", "jp-sg-s"], 2, 7, 40),
  // Extends all the way to jp-chuo-n so Chūō-dōri-north's own far terminus
  // (its own spec's north end) closes into the ring instead of dead-ending —
  // both are at z=1140, so the extra segment costs no bend. "jp-hanamizuki-n"
  // (Tokyo authenticity plan P5) is a NEW node spliced between jp-sg-n and
  // jp-chuo-n — Hanamizu's own collector needed a real tee here (plan §6.2's
  // mid-span-node procedure) and this was this road's own LAST segment
  // before the insertion (only 3 nodes followed jp-kp-n), so nothing
  // downstream renumbers; the only live reference into this road at all
  // (`jp-miyanosaka-kita-dori-` grepped clean across app/game and tests) was
  // trafficControlCharacterization.test.tsx's pinned arm slug for the
  // jp-chuo-n signal's own approach from this direction (its immediate
  // neighbour changes from jp-sg-n to jp-hanamizuki-n), re-baselined in the
  // same commit.
  // "jp-kawabata-n" (Tokyo authenticity plan P8, Region F) extends this road
  // past its OLD terminus, jp-chuo-n — an append, not a mid-span insertion
  // (nothing follows jp-chuo-n on this road's own list to split), so no
  // existing segment renumbers at all; a brand-new final segment (5) is all
  // that is added. jp-chuo-n is a live TOKYO_SIGNAL_NODE_IDS entry, so this
  // is not the ordinary quiet-stop-sign case every prior region's own ring
  // extension has been: the signal genuinely gains a third arm (this road's
  // own reverse lane, now arriving from jp-kawabata-n instead of nowhere) —
  // `deriveTokyoSignalControls` builds every arm generically off whichever
  // lanes physically arrive, so this needs no code change, only a genuinely
  // NEW block of pinned strings in trafficControlCharacterization.test.tsx
  // (the two EXISTING arms there — from jp-hanamizuki-n, from
  // jp-chuo-x-koshu — keep their own slugs unchanged, confirmed directly:
  // neither one's own immediate neighbour moves).
  tokyoRoad("jp-miyanosaka-kita-dori", "Miyanosaka Kita-dōri", ["jp-nk-n", "jp-kp-n", "jp-sg-n", "jp-hanamizuki-n", "jp-chuo-n", "jp-kawabata-n"], 2, 7, 40),
  tokyoRoad("jp-setagaya-dori-west", "Setagaya-dōri", ["jp-nk-setagaya", "jp-kp-setagaya", "jp-ss-w"], 2, 10, 50),
  // "jp-koshu-x-nakasuji" (Tokyo authenticity plan P4) is a NEW node spliced
  // into this road's own LAST segment (jp-sg-koshu -> jp-chuo-x-koshu) — the
  // "insert past the last-referenced segment index" case, so nothing
  // downstream renumbers (confirmed by grep: the only lane-id reference to
  // this road, `jp-car-koshu`'s spawn anchor, names segment 1, well before
  // this split).
  tokyoRoad("jp-koshu-kaido", "Kōshū-kaidō", ["jp-nk-koshu", "jp-kp-koshu", "jp-sg-koshu", "jp-koshu-x-nakasuji", "jp-chuo-x-koshu"], 2, 12, 60),
  // "jp-sumiregaoka-x-minami-kaido" (Tokyo authenticity plan P6) is a NEW
  // node spliced into this road's own LAST segment (jp-sg-minami ->
  // jp-chuo-x-minami-kaido) — the same "insert past the last-referenced
  // segment index" case Kōshū-kaidō's own split above used, so nothing
  // downstream renumbers. `grep -rn "jp-minami-kaido-" app/game tests`
  // before this split found only segment-1 references (jp-repair-minami's
  // service-point anchor, jp-car-minami-kaido's spawn, both ~700-1200 m west
  // on the FIRST segment, untouched by a split of the last one) and a run of
  // trafficControlCharacterization.test.tsx arm-slug strings for the
  // jp-chuo-x-minami-kaido signal's own westbound approach (named off its
  // immediate neighbour node) — those DO shift and are deferred to the
  // bundle's final re-baseline pass, per this phase's own scope note.
  //
  // "jp-shion-x-minami-kaido" (Tokyo authenticity plan P7) is a SECOND new
  // node, spliced between `jp-sg-minami` and `jp-sumiregaoka-x-minami-kaido`
  // — now this road's own second-to-last segment, not its last (Region C's
  // own insertion above already claimed "past the last referenced index";
  // this one lands one segment earlier). Re-ran the same grep before this
  // split: still only the segment-1 references above, plus signal-slug
  // strings keyed off `jp-sg-minami`/`jp-kp-minami`/`jp-nk-minami` (neighbour-
  // node names, not segment indices — unaffected, same reasoning as above).
  // See jpMinamimachiNodes' own doc comment for why this insertion exists:
  // the void raster's own measured 2.56 ha gap, not a speculative extra road.
  tokyoRoad("jp-minami-kaido", "Minami-kaidō", ["jp-nk-minami", "jp-kp-minami", "jp-sg-minami", "jp-shion-x-minami-kaido", "jp-sumiregaoka-x-minami-kaido", "jp-chuo-x-minami-kaido"], 2, 10, 50),

  tokyoRoad("jp-setagaya-dori-east", "Setagaya-dōri", ["jp-ss-e", "jp-ichiban-x-setagaya", "jp-niban-x-setagaya", "jp-chuo-x-setagaya"], 2, 10, 50),
  // "jp-chuo-x-minamimachi" (Tokyo authenticity plan P7) extends this road
  // 170 m south of its old terminus, `jp-chuo-x-minami-kaido` — see
  // jpMinamimachiNodes above for the full lane-id-reference-check writeup.
  // Prepended (not inserted between two existing nodes: this road's old span
  // ran entirely north of z=-800), so what was segment 1 (chuo-x-minami-kaido
  // -> chuo-x-setagaya) shifts to segment 2; grep confirmed nothing named it
  // by distance.
  tokyoRoad("jp-chuo-dori-south", "Chūō-dōri", ["jp-chuo-x-minamimachi", "jp-chuo-x-minami-kaido", "jp-chuo-x-setagaya"], 2, 10, 50),
  tokyoRoad("jp-chuo-dori", "Chūō-dōri", ["jp-chuo-x-setagaya", "jp-chuo-x-minami-dori", "jp-chuo-x-nakamise", "jp-chuo-x-ekimae", "jp-chuo-x-kita-dori"], 4, 13.6, 50),
  // "jp-chuo-x-kawasemi" (Tokyo authenticity plan P8, Region F) is a NEW
  // node spliced between jp-chuo-x-koshu and jp-chuo-n — see jpKawabataNodes
  // above for why the plan's own literal anchor (jp-chuo-x-koshu itself)
  // turned out to already be occupied, on this exact bearing, by
  // jp-tsuki-ohashi's own west approach (both run the same z=560 line — the
  // pavement-rail test caught two roads' kerbs landing on the same ground,
  // not a cosmetic issue). z=600 sits comfortably clear of that bridge's own
  // 12 m carriageway (its edge is at z=566) while landing exactly on this
  // road's own existing straight line between jp-chuo-x-koshu and jp-chuo-n
  // (x interpolated on that line, not eyeballed: 400 + (380-400)*(600-560)/
  // (1140-560) = 398.62), so the insertion costs zero additional bend.
  // `grep -rn "jp-chuo-dori-north-" app/game tests` found no lane-id-with-
  // distance reference on this road at all (only node-named signal-slug
  // strings in trafficControlCharacterization.test.tsx); this split RENAMES
  // one existing arm, at jp-chuo-x-koshu (that node's own "arriving from the
  // north" arm — jp-chuo-x-koshu is chuo-dori-north's own INTERIOR point,
  // between jp-chuo-x-kita-dori and jp-chuo-n, so it already carried an arm
  // from each direction before this phase) — its immediate northward
  // neighbour changes from jp-chuo-n to jp-chuo-x-kawasemi. jp-chuo-n's own
  // southward arm renames the same way (immediate neighbour jp-chuo-x-koshu
  // -> jp-chuo-x-kawasemi) AND separately gains a genuinely new third arm
  // from this road's own extension past its old terminus (see this file's
  // own updated jp-miyanosaka-kita-dori comment) — both re-baselined in the
  // same commit, verified against the test's own diff.
  tokyoRoad("jp-chuo-dori-north", "Chūō-dōri", ["jp-chuo-x-kita-dori", "jp-chuo-x-koshu", "jp-chuo-x-kawasemi", "jp-chuo-n"], 2, 10, 50),
  // Extended both ends in Phase 3 to reach Sakura-ōhashi (south) and
  // Tsuki-ōhashi (north) — see jpRiverNodes below. jp-kawate-x-kawanaka is a
  // node newly inserted into this spec's own interior (between the existing
  // jp-kawate-x-ekimae and jp-kawate-x-kita-dori), not a hand-authored-quarter
  // polyline, so resegmenting it is ordinary generator work (plan §4.4's
  // caveat); no Phase-2 spawn/venue anchors this road by distance (verified
  // by grep before the split), so the lane-id renumbering it causes is safe.
  // "jp-kawate-x-kawasemi" (Tokyo authenticity plan P8, Region F) extends
  // this road 40 m past its OLD terminus, jp-kawate-x-koshu — an append (the
  // road's own list ends there, nothing to split), so no existing segment
  // renumbers; a new final segment (6) is all that is added. See
  // jp-chuo-x-kawasemi's own comment above for why z=600, not the plan's
  // literal jp-kawate-x-koshu itself, is this road's real usable anchor for
  // Kawasemi-dōri. jp-kawate-x-koshu is not a TOKYO_SIGNAL_NODE_IDS entry, so
  // this is the ordinary quiet case (`deriveTokyoJunctionControls`'s generic
  // interior-bonus scoring now favours jp-kawate-dori over jp-tsuki-ohashi at
  // that node — both were tied there before on raw speed limit alone, so
  // this is a real, expected priority flip, the same "extending past an old
  // terminus can flip who stops" behaviour jp-chuo-dori-south's own Region D
  // extension already established). TOKYO_OPEN_WATERFRONT_SIDES["jp-kawate-
  // dori"] is keyed by road id, so the new segment inherits the same open
  // river-side exemption automatically — no table edit needed, verified live
  // (the river sits ~22 m east of this new stretch, closer than most of this
  // road's own span, still clear).
  tokyoRoad("jp-kawate-dori", "Kawate-dōri", ["jp-kawate-x-setagaya", "jp-kawate-x-minami-dori", "jp-kawate-x-ekimae", "jp-kawate-x-kawanaka", "jp-kawate-x-kita-dori", "jp-kawate-x-koshu", "jp-kawate-x-kawasemi"], 2, 8, 40),
  tokyoRoad("jp-eki-mae-dori", "Ekimae-dōri", ["jp-ekimae-w", "jp-ichiban-x-ekimae", "jp-niban-x-ekimae", "jp-chuo-x-ekimae", "jp-kawate-x-ekimae"], 2, 9, 40),
  tokyoRoad("jp-ichiban-dori", "Ichiban-dōri", ["jp-ichiban-x-setagaya", "jp-ichiban-x-minami-dori", "jp-ichiban-x-nakamise", "jp-ichiban-x-ekimae", "jp-ichiban-x-kita-dori"], 1, 7, 40, { oneWay: "forward" }),
  tokyoRoad("jp-niban-dori", "Niban-dōri", ["jp-niban-x-setagaya", "jp-niban-x-minami-dori", "jp-niban-x-nakamise", "jp-niban-x-ekimae", "jp-niban-x-kita-dori"], 1, 7, 40, { oneWay: "reverse" }),
  tokyoRoad("jp-minami-dori", "Minami-dōri", ["jp-minami-dori-w", "jp-ichiban-x-minami-dori", "jp-niban-x-minami-dori", "jp-chuo-x-minami-dori", "jp-kawate-x-minami-dori"], 2, 8, 40),
  tokyoRoad("jp-kita-dori", "Kita-dōri", ["jp-kita-dori-w", "jp-ichiban-x-kita-dori", "jp-niban-x-kita-dori", "jp-chuo-x-kita-dori", "jp-kawate-x-kita-dori"], 2, 8, 40),
  tokyoRoad("jp-nakamise-yokocho", "Nakamise Yokochō", ["jp-ichiban-x-nakamise", "jp-niban-x-nakamise", "jp-chuo-x-nakamise"], 2, 5.8, 20, { surfaceType: "shared_space" }),
  // Renraku-dōri is gone (rail feature): the 42 m connector from jp-d to
  // Shōtengai Nishi crossed the Setagaya Line's corridor at 25° from
  // parallel — too oblique for a level crossing to be honest geometry — and
  // its whole function (jp-d fan -> shotengai grid) is served 20 m east by
  // Shōtengai Nishi-dōri's own southern leg, which now carries the corridor's
  // generated level crossing instead. Its former x-renraku node stays as a
  // plain interior vertex of Shōtengai Nishi-dōri below.
  tokyoRoad("jp-shotengai-nishi-dori", "Shōtengai Nishi-dōri", ["jp-minami-dori-w", "jp-shotengai-nishi-x-renraku", "jp-ekimae-w", "jp-shotengai-nishi-x-uptown", "jp-kita-dori-w"], 2, 7, 40),
  tokyoRoad("jp-uptown-higashi", "Uptown St", ["jp-ne2", "jp-shotengai-nishi-x-uptown"], 2, 6.4, 40),
];

// One-way rungs (Tokyo expansion Phase 5, R11): 4 per web, `laneCount: 1`
// (a one-way local does not need two full lanes of the same direction).
// The alternating-pair-rung topology (§ residential-web comment, Phase 2)
// makes the "one-way x one-way trap" structurally impossible here without
// any per-junction checking: every rung touches only TWO-WAY ring roads (or
// a two-way yokochō stem) at its own two ends, and no rung ever meets
// another rung directly — so a one-way rung can never leave a corner with
// no legal departure, whichever direction it runs. The collector
// (Suzukake/Yanagi/Hato-dōri) and the yokochō stubs stay two-way
// deliberately, matching how a real neighbourhood's one collector spine
// stays flexible while its narrow locals go one-way; Fujimi/Ayame/Ume-dōri
// (the three rungs that pass through their own yokochō's stem-n) also stay
// two-way so that mid-span T stays an ordinary, unrestricted junction.
const TOKYO_MIYANOSAKA_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-mn-asahi-dori", "Asahi-dōri", ["jp-mn-r6-kp", "jp-mn-r6-sg"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-mn-wakaba-dori", "Wakaba-dōri", ["jp-mn-r1-nk", "jp-mn-r1-kp"], 2, 6.4, 30),
  tokyoRoad("jp-mn-fujimi-dori", "Fujimi-dōri", ["jp-mn-r2-kp", "jp-mn-stem-n", "jp-mn-r2-sg"], 2, 6.4, 30),
  tokyoRoad("jp-mn-suzukake-dori", "Suzukake-dōri", ["jp-mn-coll-nk", "jp-mn-coll-kp", "jp-mn-stem-s", "jp-mn-coll-sg"], 2, 7, 40),
  tokyoRoad("jp-mn-suzukake-yokocho", "Suzukake Yokochō", ["jp-mn-stem-n", "jp-mn-stem-s"], 2, 5.8, 30),
  tokyoRoad("jp-mn-sumire-dori", "Sumire-dōri", ["jp-mn-r4-nk", "jp-mn-r4-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
  tokyoRoad("jp-mn-momiji-dori", "Momiji-dōri", ["jp-mn-r5-kp", "jp-mn-r5-sg"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-mn-kaede-dori", "Kaede-dōri", ["jp-mn-r7-nk", "jp-mn-r7-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
];

const TOKYO_YAMASHITA_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-ys-tsubaki-dori", "Tsubaki-dōri", ["jp-ys-r1-nk", "jp-ys-r1-kp"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-ys-ayame-dori", "Ayame-dōri", ["jp-ys-r2-kp", "jp-ys-stem-n", "jp-ys-r2-sg"], 2, 6.4, 30),
  tokyoRoad("jp-ys-yanagi-dori", "Yanagi-dōri", ["jp-ys-coll-nk", "jp-ys-coll-kp", "jp-ys-stem-s", "jp-ys-coll-sg"], 2, 7, 40),
  tokyoRoad("jp-ys-yanagi-yokocho", "Yanagi Yokochō", ["jp-ys-stem-n", "jp-ys-stem-s"], 2, 5.8, 30),
  tokyoRoad("jp-ys-ichou-dori", "Ichō-dōri", ["jp-ys-r3-nk", "jp-ys-r3-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
  tokyoRoad("jp-ys-botan-dori", "Botan-dōri", ["jp-ys-r4-kp", "jp-ys-r4-sg"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-ys-hagi-dori", "Hagi-dōri", ["jp-ys-r5-nk", "jp-ys-r5-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
  tokyoRoad("jp-ys-kikyo-dori", "Kikyō-dōri", ["jp-ys-r6-kp", "jp-ys-r6-sg"], 2, 6.4, 30),
];

const TOKYO_NISHI_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-ni-tsuki-dori", "Tsuki-dōri", ["jp-ni-r1-nk", "jp-ni-r1-kp"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-ni-ume-dori", "Ume-dōri", ["jp-ni-r2-kp", "jp-ni-stem-n", "jp-ni-r2-sg"], 2, 6.4, 30),
  tokyoRoad("jp-ni-hato-dori", "Hato-dōri", ["jp-ni-coll-nk", "jp-ni-coll-kp", "jp-ni-stem-s", "jp-ni-coll-sg"], 2, 7, 40),
  tokyoRoad("jp-ni-hato-yokocho", "Hato Yokochō", ["jp-ni-stem-n", "jp-ni-stem-s"], 2, 5.8, 30),
  tokyoRoad("jp-ni-kiku-dori", "Kiku-dōri", ["jp-ni-r3-nk", "jp-ni-r3-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
  tokyoRoad("jp-ni-ran-dori", "Ran-dōri", ["jp-ni-r4-kp", "jp-ni-r4-sg"], 1, 6.4, 30, { oneWay: "forward" }),
  tokyoRoad("jp-ni-hibari-dori", "Hibari-dōri", ["jp-ni-r5-nk", "jp-ni-r5-kp"], 1, 6.4, 30, { oneWay: "reverse" }),
  // Hana-dōri: Sangen-dōri (the collector's own east end) direct to the
  // quarter's jp-cw (-260,18), the west-edge node closest in z — a single
  // straight segment (dx=200, dz=-42, ~12deg off pure east), ties Nishi
  // into the existing quarter as connective tissue rather than a dead cell.
  tokyoRoad("jp-ni-hana-dori", "Hana-dōri", ["jp-ni-coll-sg", "jp-cw"], 2, 6.4, 30),
];

// --- Ekimae-nishi mixed web (Tokyo authenticity plan P4, Region B) ---------
// See `jpEkimaeNishiNodes`'s own doc comment above for the full design
// rationale. `jp-ekimae-nishi-dori` is the one shopping-street exception:
// wider/faster than the three purely-residential locals, matching the
// collector tier every other web's own spine uses (Suzukake/Yanagi/
// Hato-dōri, `2, 7, 40`) rather than the `6.4, 30` local tier, since it reads
// as `tokyo-shotengai` territory, not a house-lined lane
// (`tokyoRoadsideBuildingSet`/`TOKYO_ROAD_STYLE_OVERRIDE` below).
const TOKYO_EKIMAE_NISHI_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-ekimae-nishi-dori", "Ekimae Nishi-dōri", ["jp-sangen-x-ekimae-nishi", "jp-tsukimi-x-ekimae-nishi", "jp-nakasuji-x-ekimae-nishi", "jp-kita-dori-w"], 2, 7, 40),
  tokyoRoad("jp-sakuramachi-dori", "Sakuramachi-dōri", ["jp-ni-r4-sg", "jp-tsukimi-x-sakuramachi", "jp-nakasuji-x-sakuramachi"], 2, 6.4, 30),
  tokyoRoad("jp-tsukimi-dori", "Tsukimi-dōri", ["jp-nw2", "jp-tsukimi-x-sakuramachi", "jp-tsukimi-x-ekimae-nishi"], 2, 6.4, 30),
  tokyoRoad("jp-nakasuji-dori", "Nakasuji-dōri", ["jp-nm2", "jp-nakasuji-x-sakuramachi", "jp-nakasuji-x-ekimae-nishi", "jp-koshu-x-nakasuji"], 2, 6.4, 30),
];

// --- Hanamizu residential web (Tokyo authenticity plan P5, Region A) -------
// See `jpHanamizuNodes`'s own doc comment above for the full design
// rationale. `jp-hanamizuki-dori` carries the collector tier (matching
// Suzukake/Yanagi/Hato-dōri's `2, 7, 40`); every other road here is the
// ordinary residential-local tier (`2, 6.4, 30`), same as the majority of
// Miyanosaka/Yamashita/Nishi/Ekimae-nishi's own rungs.
const TOKYO_HANAMIZU_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-yuri-dori", "Yuri-dōri", ["jp-mn-r2-sg", "jp-tsutsuji-x-yuri", "jp-hanamizuki-x-yuri", "jp-momo-x-yuri", "jp-kosumosu-x-yuri"], 2, 6.4, 30),
  tokyoRoad("jp-ajisai-dori", "Ajisai-dōri", ["jp-mn-r5-sg", "jp-tsutsuji-x-ajisai", "jp-hanamizuki-x-ajisai", "jp-momo-x-ajisai", "jp-kosumosu-x-ajisai"], 2, 6.4, 30),
  tokyoRoad("jp-hanamizuki-dori", "Hanamizuki-dōri", ["jp-koshu-x-nakasuji", "jp-hanamizuki-x-yuri", "jp-hanamizuki-x-ajisai", "jp-hanamizuki-n"], 2, 7, 40),
  tokyoRoad("jp-tsutsuji-dori", "Tsutsuji-dōri", ["jp-tsutsuji-x-yuri", "jp-tsutsuji-x-ajisai"], 2, 6.4, 30),
  tokyoRoad("jp-momo-dori", "Momo-dōri", ["jp-momo-x-yuri", "jp-momo-x-ajisai"], 2, 6.4, 30),
  tokyoRoad("jp-kosumosu-dori", "Kosumosu-dōri", ["jp-kosumosu-x-yuri", "jp-kosumosu-x-ajisai"], 2, 6.4, 30),
];

// --- Sumiregaoka residential web (Tokyo authenticity plan P6, Region C) ----
// See `jpSumiregaokaNodes`'s own doc comment above for the full design
// rationale, the "both ends existing" correction and why Suisen-dōri reaches
// Sangen-dōri (the void-raster finding). `jp-sumiregaoka-dori` carries the
// collector tier (matching Suzukake/Yanagi/Hato/Hanamizuki-dōri's `2, 7,
// 40`); every other road here is the ordinary residential-local tier
// (`2, 6.4, 30`). Both E-W streets reach Sangen-dōri: `jp-nanohana-dori` at
// the existing `jp-ys-r6-sg`, `jp-suisen-dori` at the new mid-span tee
// `jp-sangen-x-suisen`.
const TOKYO_SUMIREGAOKA_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-nanohana-dori", "Nanohana-dōri", ["jp-ys-r6-sg", "jp-fuyo-x-nanohana", "jp-renge-x-nanohana", "jp-asagao-x-nanohana", "jp-sumiregaoka-x-nanohana"], 2, 6.4, 30),
  tokyoRoad("jp-suisen-dori", "Suisen-dōri", ["jp-sangen-x-suisen", "jp-fuyo-x-suisen", "jp-renge-x-suisen", "jp-asagao-x-suisen", "jp-sumiregaoka-x-suisen"], 2, 6.4, 30),
  tokyoRoad("jp-fuyo-dori", "Fuyō-dōri", ["jp-ss-w", "jp-fuyo-x-nanohana", "jp-fuyo-x-suisen"], 2, 6.4, 30),
  tokyoRoad("jp-renge-dori", "Renge-dōri", ["jp-ss-m", "jp-renge-x-nanohana", "jp-renge-x-suisen"], 2, 6.4, 30),
  tokyoRoad("jp-asagao-dori", "Asagao-dōri", ["jp-ichiban-x-setagaya", "jp-asagao-x-nanohana", "jp-asagao-x-suisen"], 2, 6.4, 30),
  // Reaches jp-minami-kaido (the SE anchor the plan hands over) via a new
  // mid-span tee spliced into THAT road's own spec, not this one — see
  // jp-minami-kaido's own updated line (TOKYO_SKELETON_SPECS above) for the
  // lane-id reference check and what it found.
  tokyoRoad("jp-sumiregaoka-dori", "Sumiregaoka-dōri", ["jp-niban-x-setagaya", "jp-sumiregaoka-x-nanohana", "jp-sumiregaoka-x-suisen", "jp-sumiregaoka-x-minami-kaido"], 2, 7, 40),
];

// See jpMinamimachiNodes above for the full district writeup.
const TOKYO_MINAMIMACHI_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-minamimachi-dori", "Minamimachi-dōri", ["jp-ys-coll-sg", "jp-shion-x-minamimachi", "jp-susuki-x-minamimachi", "jp-chuo-x-minamimachi"], 2, 7, 40),
  tokyoRoad("jp-shion-dori", "Shion-dōri", ["jp-shion-x-minami-kaido", "jp-shion-x-minamimachi", "jp-shion-x-nadeshiko"], 2, 6.4, 30),
  tokyoRoad("jp-susuki-dori", "Susuki-dōri", ["jp-sumiregaoka-x-minami-kaido", "jp-susuki-x-minamimachi", "jp-susuki-x-nadeshiko"], 2, 6.4, 30),
  tokyoRoad("jp-nadeshiko-dori", "Nadeshiko-dōri", ["jp-ys-r2-sg", "jp-shion-x-nadeshiko", "jp-susuki-x-nadeshiko"], 2, 6.4, 30),
];

// --- Nishi Minami web (Tokyo authenticity plan P8, Region E) ---------------
// See jpNishiMinamiNodes above for the full district writeup. Both roads are
// dead-straight residential locals (constant z, the ordinary tier — neither
// is this corridor's own "spine," since the corridor's real spine is the two
// RINGS themselves), matching Kikyō-dōri/Nanohana-dōri's own tier at the
// same z=-400 latitude one ring further east.
const TOKYO_NISHI_MINAMI_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-sazanka-dori", "Sazanka-dōri", ["jp-nishi-kanjo-x-sazanka", "jp-ys-r6-kp"], 2, 6.4, 30),
  tokyoRoad("jp-hiiragi-dori", "Hiiragi-dōri", ["jp-nishi-kanjo-x-hiiragi", "jp-kanpachi-x-hiiragi"], 2, 6.4, 30),
];

// --- Kawabata web (Tokyo authenticity plan P8, Region F) -------------------
// See jpKawabataNodes above for the full district writeup (including why
// z=600, not the plan's literal z=560 anchors, is Kawasemi-dōri's own real
// line). jp-kawabata-dori carries the collector tier (matching Minamimachi/
// Sumiregaoka/Hanamizuki-dōri's own `2, 7, 40` — this web's own spine, named
// for its own district); jp-kawasemi-dori is the ordinary residential-local
// tier, `2, 6.4, 30`, one straight three-node run (Chūō-dōri-north's own new
// tee, through the spine's own southern T, to Kawate-dōri's own new
// extension) rather than two separately-named stubs — the same
// "collector-with-a-through-stem" shape Suzukake/Yanagi/Hato-dōri's own
// yokochō stem already uses, roles swapped.
const TOKYO_KAWABATA_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-kawasemi-dori", "Kawasemi-dōri", ["jp-chuo-x-kawasemi", "jp-kawabata-x-kawasemi", "jp-kawate-x-kawasemi"], 2, 6.4, 30),
  tokyoRoad("jp-kawabata-dori", "Kawabata-dōri", ["jp-kawabata-x-kawasemi", "jp-kawabata-n"], 2, 7, 40),
];

// --- The Sakuragawa's three bridges (Phase 3, R3) ---------------------------
// Each ONE continuous spec bank-to-bank, including both approaches: never a
// separate approach + span meeting at the bank (plan §4.4 — two specs sharing
// an endpoint coordinate mint two disconnected nodes). West landings are the
// REAL Phase-2 termini of the arterials they continue (jp-chuo-x-setagaya,
// jp-chuo-x-koshu), not the plan's original suggested coordinates, which were
// stale the moment Phase 2 trimmed those roads short. Kawanaka-bashi — the
// narrower, lower-speed "central" bridge — deliberately does NOT continue a
// major inland arterial; it lands directly on the riverside collectors on
// both banks, consistent with its own minor-crossing flavour. Every span is
// dead straight (constant z), so the two intermediate junctions each bridge
// passes through (the riverside collectors) cost zero bend.
const TOKYO_RIVER_SPECS: readonly TokyoRoadSpec[] = [
  tokyoRoad("jp-sakura-ohashi", "Sakura-ōhashi", ["jp-chuo-x-setagaya", "jp-kawate-x-setagaya", "jp-kawagishi-x-setagaya", "jp-higashi-w"], 2, 12, 50),
  tokyoRoad("jp-kawanaka-bashi", "Kawanaka-bashi", ["jp-kawate-x-kawanaka", "jp-kawagishi-x-kawanaka", "jp-kawanaka-e"], 2, 9, 40),
  tokyoRoad("jp-tsuki-ohashi", "Tsuki-ōhashi", ["jp-chuo-x-koshu", "jp-kawate-x-koshu", "jp-kawagishi-x-koshu", "jp-khh-w"], 2, 12, 50),
];

// --- East bank web (Phase 3, R3): the riverside collector plus a compact
// arterial + residential pocket, same generator pattern and geometry gates as
// Phase 2's west-bank districts. -------------------------------------------
const TOKYO_EAST_SPECS: readonly TokyoRoadSpec[] = [
  // East-bank riverside collector, mirroring jp-kawate-dori's role on the
  // west bank: solver-checked clear of the shore by 30-55 m at every node
  // (never under the plan's 6 m floor).
  tokyoRoad("jp-kawagishi-dori", "Kawagishi-dōri", ["jp-kawagishi-x-minami", "jp-kawagishi-x-fuji", "jp-kawagishi-x-setagaya", "jp-kawagishi-w1", "jp-kawagishi-x-kawanaka", "jp-kawagishi-w2", "jp-kawagishi-x-koshu", "jp-kawagishi-x-kita"], 2, 8, 40),
  tokyoRoad("jp-higashi-dori", "Higashi-dōri", ["jp-higashi-w", "jp-hd-x-tofu", "jp-hd-x-hondori", "jp-hd-x-soto"], 2, 10, 50),
  tokyoRoad("jp-koshu-kaido-higashi", "Kōshū-kaidō", ["jp-khh-w", "jp-khh-x-keyaki", "jp-khh-x-hondori", "jp-khh-x-soto"], 2, 12, 50),
  tokyoRoad("jp-higashi-hondori", "Higashi Hon-dōri", ["jp-hh-s", "jp-hh-x-fuji", "jp-hd-x-hondori", "jp-kawanaka-e", "jp-khh-x-hondori", "jp-hh-n"], 2, 8, 40),
  // Closes the ring Higashi-dōri/Kōshū-kaidō-higashi would otherwise dead-end
  // into at x=1200 — the real crossing this phase reaches (plan said 1240).
  tokyoRoad("jp-higashi-soto-dori", "Higashi Soto-dōri", ["jp-hd-x-soto", "jp-khh-x-soto"], 2, 8, 40),
  tokyoRoad("jp-higashi-minami-dori", "Higashi Minami-dōri", ["jp-kawagishi-x-minami", "jp-ty-s", "jp-hh-s"], 2, 7, 40),
  tokyoRoad("jp-higashi-kita-dori", "Higashi Kita-dōri", ["jp-kawagishi-x-kita", "jp-hkd-x-keyaki", "jp-hh-n"], 2, 7, 40),
  tokyoRoad("jp-tofu-yokocho", "Tōfu Yokochō", ["jp-ty-s", "jp-ty-x-fuji", "jp-hd-x-tofu"], 2, 6.4, 30),
  tokyoRoad("jp-fuji-dori", "Fuji-dōri", ["jp-kawagishi-x-fuji", "jp-ty-x-fuji", "jp-hh-x-fuji"], 2, 6.4, 30),
  tokyoRoad("jp-keyaki-dori", "Keyaki-dōri", ["jp-khh-x-keyaki", "jp-hkd-x-keyaki"], 2, 6.4, 30),
];

/**
 * Legal turns at every skeleton junction. The quarter's own road ids
 * (`jp-setagaya-dori`, `jp-westside-south`, `jp-eastside-road`,
 * `jp-east-curve`, `jp-center-road`, `jp-uptown-road`, `jp-easthill-road`)
 * appear by name at the four seam nodes exactly the way London's whitelist
 * mixes the quarter's `RoadSurface` ids with generated ones — same key space
 * as `LaneSegment.roadId`.
 */
const TOKYO_SKELETON_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-nk-s", "jp-nk-s", ["jp-nishi-kanjo-dori", "jp-yamashita-minami-dori"]),
  tokyoJunction("jp-jct-nk-minami", "jp-nk-minami", ["jp-nishi-kanjo-dori", "jp-minami-kaido"]),
  tokyoJunction("jp-jct-nk-setagaya", "jp-nk-setagaya", ["jp-nishi-kanjo-dori", "jp-setagaya-dori-west"]),
  tokyoJunction("jp-jct-nk-koshu", "jp-nk-koshu", ["jp-nishi-kanjo-dori", "jp-koshu-kaido"]),
  tokyoJunction("jp-jct-nk-n", "jp-nk-n", ["jp-nishi-kanjo-dori", "jp-miyanosaka-kita-dori"]),
  tokyoJunction("jp-jct-kp-s", "jp-kp-s", ["jp-kanpachi-dori", "jp-yamashita-minami-dori"]),
  tokyoJunction("jp-jct-kp-minami", "jp-kp-minami", ["jp-kanpachi-dori", "jp-minami-kaido"]),
  tokyoJunction("jp-jct-kp-setagaya", "jp-kp-setagaya", ["jp-kanpachi-dori", "jp-setagaya-dori-west"]),
  tokyoJunction("jp-jct-kp-koshu", "jp-kp-koshu", ["jp-kanpachi-dori", "jp-koshu-kaido"]),
  tokyoJunction("jp-jct-kp-n", "jp-kp-n", ["jp-kanpachi-dori", "jp-miyanosaka-kita-dori"]),
  tokyoJunction("jp-jct-sg-s", "jp-sg-s", ["jp-sangen-dori", "jp-yamashita-minami-dori"]),
  tokyoJunction("jp-jct-sg-minami", "jp-sg-minami", ["jp-sangen-dori", "jp-minami-kaido"]),
  tokyoJunction("jp-jct-sg-setagaya", "jp-sg-setagaya", ["jp-sangen-dori", "jp-setagaya-dori-west"]),
  tokyoJunction("jp-jct-sg-koshu", "jp-sg-koshu", ["jp-sangen-dori", "jp-koshu-kaido"]),
  tokyoJunction("jp-jct-sg-n", "jp-sg-n", ["jp-sangen-dori", "jp-miyanosaka-kita-dori"]),
  tokyoJunction("jp-jct-chuo-n", "jp-chuo-n", ["jp-chuo-dori-north", "jp-miyanosaka-kita-dori"]),

  // Tokyo authenticity plan P6 adds jp-fuyo-dori as this node's 4th arm
  // (south) — Sumiregaoka's own westmost local dropping off Setagaya-dōri.
  tokyoJunction("jp-jct-ss-w", "jp-ss-w", ["jp-setagaya-dori-west", "jp-setagaya-dori", "jp-westside-south", "jp-fuyo-dori"]),
  tokyoJunction("jp-jct-ss-e", "jp-ss-e", ["jp-setagaya-dori-east", "jp-setagaya-dori", "jp-eastside-road"]),
  tokyoJunction("jp-jct-d", "jp-d", ["jp-east-curve", "jp-center-road"]),
  tokyoJunction("jp-jct-ne2", "jp-ne2", ["jp-uptown-higashi", "jp-uptown-road", "jp-easthill-road"]),

  // Tokyo authenticity plan P6 adds jp-asagao-dori as this node's 3rd arm
  // (south) — Sumiregaoka's middle-east local (the plan's own approximate
  // "x~200" corrected to this real node's x=180, its nearest anchor).
  tokyoJunction("jp-jct-ichiban-setagaya", "jp-ichiban-x-setagaya", ["jp-ichiban-dori", "jp-setagaya-dori-east", "jp-asagao-dori"]),
  // Tokyo authenticity plan P6 adds jp-sumiregaoka-dori as this node's 3rd
  // arm (south) — Sumiregaoka's own collector, reaching jp-minami-kaido.
  tokyoJunction("jp-jct-niban-setagaya", "jp-niban-x-setagaya", ["jp-niban-dori", "jp-setagaya-dori-east", "jp-sumiregaoka-dori"]),
  // Phase 3 adds jp-sakura-ohashi as this node's 4th arm (east); Chūō-dōri
  // still stops here (unchanged from Phase 2 — see TOKYO_SAME_STREET_GROUPS).
  tokyoJunction("jp-jct-chuo-setagaya", "jp-chuo-x-setagaya", ["jp-setagaya-dori-east", "jp-chuo-dori-south", "jp-chuo-dori", "jp-sakura-ohashi"]),
  tokyoJunction("jp-jct-chuo-minami-kaido", "jp-chuo-x-minami-kaido", ["jp-minami-kaido", "jp-chuo-dori-south"]),
  tokyoJunction("jp-jct-chuo-minami-dori", "jp-chuo-x-minami-dori", ["jp-chuo-dori", "jp-minami-dori"]),
  tokyoJunction("jp-jct-chuo-nakamise", "jp-chuo-x-nakamise", ["jp-chuo-dori", "jp-nakamise-yokocho"]),
  tokyoJunction("jp-jct-chuo-ekimae", "jp-chuo-x-ekimae", ["jp-chuo-dori", "jp-eki-mae-dori"]),
  tokyoJunction("jp-jct-chuo-kita-dori", "jp-chuo-x-kita-dori", ["jp-chuo-dori", "jp-chuo-dori-north", "jp-kita-dori"]),
  // Phase 3 adds jp-tsuki-ohashi as this node's 3rd arm (east).
  tokyoJunction("jp-jct-chuo-koshu", "jp-chuo-x-koshu", ["jp-chuo-dori-north", "jp-koshu-kaido", "jp-tsuki-ohashi"]),
  tokyoJunction("jp-jct-kawate-minami-dori", "jp-kawate-x-minami-dori", ["jp-kawate-dori", "jp-minami-dori"]),
  tokyoJunction("jp-jct-kawate-ekimae", "jp-kawate-x-ekimae", ["jp-kawate-dori", "jp-eki-mae-dori"]),
  tokyoJunction("jp-jct-kawate-kita-dori", "jp-kawate-x-kita-dori", ["jp-kawate-dori", "jp-kita-dori"]),
  tokyoJunction("jp-jct-ichiban-minami-dori", "jp-ichiban-x-minami-dori", ["jp-ichiban-dori", "jp-minami-dori"]),
  tokyoJunction("jp-jct-ichiban-nakamise", "jp-ichiban-x-nakamise", ["jp-ichiban-dori", "jp-nakamise-yokocho"]),
  tokyoJunction("jp-jct-ichiban-ekimae", "jp-ichiban-x-ekimae", ["jp-ichiban-dori", "jp-eki-mae-dori"]),
  tokyoJunction("jp-jct-ichiban-kita-dori", "jp-ichiban-x-kita-dori", ["jp-ichiban-dori", "jp-kita-dori"]),
  tokyoJunction("jp-jct-niban-minami-dori", "jp-niban-x-minami-dori", ["jp-niban-dori", "jp-minami-dori"]),
  tokyoJunction("jp-jct-niban-nakamise", "jp-niban-x-nakamise", ["jp-niban-dori", "jp-nakamise-yokocho"]),
  tokyoJunction("jp-jct-niban-ekimae", "jp-niban-x-ekimae", ["jp-niban-dori", "jp-eki-mae-dori"]),
  tokyoJunction("jp-jct-niban-kita-dori", "jp-niban-x-kita-dori", ["jp-niban-dori", "jp-kita-dori"]),
  tokyoJunction("jp-jct-minami-dori-w", "jp-minami-dori-w", ["jp-minami-dori", "jp-shotengai-nishi-dori"]),
  // Tokyo authenticity plan P4 adds jp-ekimae-nishi-dori as this node's 3rd
  // arm (west) — the shopping street's own real east terminus.
  tokyoJunction("jp-jct-kita-dori-w", "jp-kita-dori-w", ["jp-kita-dori", "jp-shotengai-nishi-dori", "jp-ekimae-nishi-dori"]),
  tokyoJunction("jp-jct-ekimae-w", "jp-ekimae-w", ["jp-eki-mae-dori", "jp-shotengai-nishi-dori"]),
  tokyoJunction("jp-jct-shotengai-uptown", "jp-shotengai-nishi-x-uptown", ["jp-shotengai-nishi-dori", "jp-uptown-higashi"]),
];

const TOKYO_MIYANOSAKA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-mn-r6-kp", "jp-mn-r6-kp", ["jp-kanpachi-dori", "jp-mn-asahi-dori"]),
  tokyoJunction("jp-jct-mn-r6-sg", "jp-mn-r6-sg", ["jp-sangen-dori", "jp-mn-asahi-dori"]),
  tokyoJunction("jp-jct-mn-r1-nk", "jp-mn-r1-nk", ["jp-nishi-kanjo-dori", "jp-mn-wakaba-dori"]),
  tokyoJunction("jp-jct-mn-r1-kp", "jp-mn-r1-kp", ["jp-kanpachi-dori", "jp-mn-wakaba-dori"]),
  tokyoJunction("jp-jct-mn-r2-kp", "jp-mn-r2-kp", ["jp-kanpachi-dori", "jp-mn-fujimi-dori"]),
  // Tokyo authenticity plan P5 adds jp-yuri-dori as this node's 3rd arm
  // (east) — Hanamizu's own western tee off Sangen-dōri.
  tokyoJunction("jp-jct-mn-r2-sg", "jp-mn-r2-sg", ["jp-sangen-dori", "jp-mn-fujimi-dori", "jp-yuri-dori"]),
  tokyoJunction("jp-jct-mn-stem-n", "jp-mn-stem-n", ["jp-mn-fujimi-dori", "jp-mn-suzukake-yokocho"]),
  tokyoJunction("jp-jct-mn-coll-nk", "jp-mn-coll-nk", ["jp-nishi-kanjo-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-coll-kp", "jp-mn-coll-kp", ["jp-kanpachi-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-stem-s", "jp-mn-stem-s", ["jp-mn-suzukake-dori", "jp-mn-suzukake-yokocho"]),
  tokyoJunction("jp-jct-mn-coll-sg", "jp-mn-coll-sg", ["jp-sangen-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-r4-nk", "jp-mn-r4-nk", ["jp-nishi-kanjo-dori", "jp-mn-sumire-dori"]),
  tokyoJunction("jp-jct-mn-r4-kp", "jp-mn-r4-kp", ["jp-kanpachi-dori", "jp-mn-sumire-dori"]),
  tokyoJunction("jp-jct-mn-r5-kp", "jp-mn-r5-kp", ["jp-kanpachi-dori", "jp-mn-momiji-dori"]),
  // Tokyo authenticity plan P5 adds jp-ajisai-dori as this node's 3rd arm
  // (east) — Hanamizu's other western tee off Sangen-dōri.
  tokyoJunction("jp-jct-mn-r5-sg", "jp-mn-r5-sg", ["jp-sangen-dori", "jp-mn-momiji-dori", "jp-ajisai-dori"]),
  tokyoJunction("jp-jct-mn-r7-nk", "jp-mn-r7-nk", ["jp-nishi-kanjo-dori", "jp-mn-kaede-dori"]),
  tokyoJunction("jp-jct-mn-r7-kp", "jp-mn-r7-kp", ["jp-kanpachi-dori", "jp-mn-kaede-dori"]),
];

const TOKYO_YAMASHITA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-ys-r1-nk", "jp-ys-r1-nk", ["jp-nishi-kanjo-dori", "jp-ys-tsubaki-dori"]),
  tokyoJunction("jp-jct-ys-r1-kp", "jp-ys-r1-kp", ["jp-kanpachi-dori", "jp-ys-tsubaki-dori"]),
  tokyoJunction("jp-jct-ys-r2-kp", "jp-ys-r2-kp", ["jp-kanpachi-dori", "jp-ys-ayame-dori"]),
  // Tokyo authenticity plan P7 adds jp-nadeshiko-dori as this node's 3rd arm
  // (east) — Minamimachi's own short local's western tee.
  tokyoJunction("jp-jct-ys-r2-sg", "jp-ys-r2-sg", ["jp-sangen-dori", "jp-ys-ayame-dori", "jp-nadeshiko-dori"]),
  tokyoJunction("jp-jct-ys-stem-n", "jp-ys-stem-n", ["jp-ys-ayame-dori", "jp-ys-yanagi-yokocho"]),
  tokyoJunction("jp-jct-ys-coll-nk", "jp-ys-coll-nk", ["jp-nishi-kanjo-dori", "jp-ys-yanagi-dori"]),
  tokyoJunction("jp-jct-ys-coll-kp", "jp-ys-coll-kp", ["jp-kanpachi-dori", "jp-ys-yanagi-dori"]),
  tokyoJunction("jp-jct-ys-stem-s", "jp-ys-stem-s", ["jp-ys-yanagi-dori", "jp-ys-yanagi-yokocho"]),
  // Tokyo authenticity plan P7 adds jp-minamimachi-dori as this node's 3rd
  // arm (east) — Minamimachi's own spine/collector's western tee.
  tokyoJunction("jp-jct-ys-coll-sg", "jp-ys-coll-sg", ["jp-sangen-dori", "jp-ys-yanagi-dori", "jp-minamimachi-dori"]),
  tokyoJunction("jp-jct-ys-r3-nk", "jp-ys-r3-nk", ["jp-nishi-kanjo-dori", "jp-ys-ichou-dori"]),
  tokyoJunction("jp-jct-ys-r3-kp", "jp-ys-r3-kp", ["jp-kanpachi-dori", "jp-ys-ichou-dori"]),
  tokyoJunction("jp-jct-ys-r4-kp", "jp-ys-r4-kp", ["jp-kanpachi-dori", "jp-ys-botan-dori"]),
  tokyoJunction("jp-jct-ys-r4-sg", "jp-ys-r4-sg", ["jp-sangen-dori", "jp-ys-botan-dori"]),
  tokyoJunction("jp-jct-ys-r5-nk", "jp-ys-r5-nk", ["jp-nishi-kanjo-dori", "jp-ys-hagi-dori"]),
  tokyoJunction("jp-jct-ys-r5-kp", "jp-ys-r5-kp", ["jp-kanpachi-dori", "jp-ys-hagi-dori"]),
  // Tokyo authenticity plan P8 (Region E) adds jp-sazanka-dori as this
  // node's 3rd arm (west) — the corrected "node-to-node" lane's own real
  // anchor (see jpNishiMinamiNodes's own doc comment for why the plan's
  // literal jp-ys-r5-nk/jp-ys-r5-kp pairing was not reused instead).
  tokyoJunction("jp-jct-ys-r6-kp", "jp-ys-r6-kp", ["jp-kanpachi-dori", "jp-ys-kikyo-dori", "jp-sazanka-dori"]),
  // Tokyo authenticity plan P6 adds jp-nanohana-dori as this node's 3rd arm
  // (east) — Sumiregaoka's own northern E-W street ties into Sangen-dōri
  // here (the plan's own approximate "z~-380" corrected to this real node's
  // z=-400, its nearest anchor).
  tokyoJunction("jp-jct-ys-r6-sg", "jp-ys-r6-sg", ["jp-sangen-dori", "jp-ys-kikyo-dori", "jp-nanohana-dori"]),
];

const TOKYO_NISHI_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-ni-r1-nk", "jp-ni-r1-nk", ["jp-nishi-kanjo-dori", "jp-ni-tsuki-dori"]),
  tokyoJunction("jp-jct-ni-r1-kp", "jp-ni-r1-kp", ["jp-kanpachi-dori", "jp-ni-tsuki-dori"]),
  tokyoJunction("jp-jct-ni-r2-kp", "jp-ni-r2-kp", ["jp-kanpachi-dori", "jp-ni-ume-dori"]),
  tokyoJunction("jp-jct-ni-r2-sg", "jp-ni-r2-sg", ["jp-sangen-dori", "jp-ni-ume-dori"]),
  tokyoJunction("jp-jct-ni-stem-n", "jp-ni-stem-n", ["jp-ni-ume-dori", "jp-ni-hato-yokocho"]),
  tokyoJunction("jp-jct-ni-coll-nk", "jp-ni-coll-nk", ["jp-nishi-kanjo-dori", "jp-ni-hato-dori"]),
  tokyoJunction("jp-jct-ni-coll-kp", "jp-ni-coll-kp", ["jp-kanpachi-dori", "jp-ni-hato-dori"]),
  tokyoJunction("jp-jct-ni-stem-s", "jp-ni-stem-s", ["jp-ni-hato-dori", "jp-ni-hato-yokocho"]),
  tokyoJunction("jp-jct-ni-coll-sg", "jp-ni-coll-sg", ["jp-sangen-dori", "jp-ni-hato-dori", "jp-ni-hana-dori"]),
  tokyoJunction("jp-jct-ni-r3-nk", "jp-ni-r3-nk", ["jp-nishi-kanjo-dori", "jp-ni-kiku-dori"]),
  tokyoJunction("jp-jct-ni-r3-kp", "jp-ni-r3-kp", ["jp-kanpachi-dori", "jp-ni-kiku-dori"]),
  tokyoJunction("jp-jct-ni-r4-kp", "jp-ni-r4-kp", ["jp-kanpachi-dori", "jp-ni-ran-dori"]),
  // Tokyo authenticity plan P4 adds jp-sakuramachi-dori as this node's 4th
  // arm (east) — the residential local's own real west terminus.
  tokyoJunction("jp-jct-ni-r4-sg", "jp-ni-r4-sg", ["jp-sangen-dori", "jp-ni-ran-dori", "jp-sakuramachi-dori"]),
  tokyoJunction("jp-jct-ni-r5-nk", "jp-ni-r5-nk", ["jp-nishi-kanjo-dori", "jp-ni-hibari-dori"]),
  tokyoJunction("jp-jct-ni-r5-kp", "jp-ni-r5-kp", ["jp-kanpachi-dori", "jp-ni-hibari-dori"]),
  // jp-cw already carries jp-westside-road (old quarter) both directions.
  tokyoJunction("jp-jct-ni-hana-cw", "jp-cw", ["jp-westside-road", "jp-ni-hana-dori"]),
];

// Tokyo authenticity plan P4 (Region B). jp-nw2/jp-nm2 gain a real connector
// entry here for the first time — no TOKYO_SKELETON_CONNECTORS entry existed
// for either (nothing generated ever reached them before this phase, so the
// quarter's own hand-authored successors were the whole story there); these
// are brand-new table rows, not edits to an existing one, unlike
// jp-jct-kita-dori-w/jp-jct-ni-r4-sg above.
const TOKYO_EKIMAE_NISHI_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-nw2", "jp-nw2", ["jp-westhill-road", "jp-uptown-road", "jp-tsukimi-dori"]),
  tokyoJunction("jp-jct-nm2", "jp-nm2", ["jp-narrowhill-road", "jp-uptown-road", "jp-nakasuji-dori"]),
  tokyoJunction("jp-jct-sangen-x-ekimae-nishi", "jp-sangen-x-ekimae-nishi", ["jp-sangen-dori", "jp-ekimae-nishi-dori"]),
  tokyoJunction("jp-jct-tsukimi-x-sakuramachi", "jp-tsukimi-x-sakuramachi", ["jp-tsukimi-dori", "jp-sakuramachi-dori"]),
  tokyoJunction("jp-jct-tsukimi-x-ekimae-nishi", "jp-tsukimi-x-ekimae-nishi", ["jp-tsukimi-dori", "jp-ekimae-nishi-dori"]),
  tokyoJunction("jp-jct-nakasuji-x-sakuramachi", "jp-nakasuji-x-sakuramachi", ["jp-nakasuji-dori", "jp-sakuramachi-dori"]),
  tokyoJunction("jp-jct-nakasuji-x-ekimae-nishi", "jp-nakasuji-x-ekimae-nishi", ["jp-nakasuji-dori", "jp-ekimae-nishi-dori"]),
  // Tokyo authenticity plan P5 adds jp-hanamizuki-dori as this node's 4th arm
  // (north) — Hanamizu's own collector continues Nakasuji-dōri straight
  // across Kōshū-kaidō (see jpHanamizuNodes's own doc comment for why this
  // reuses the node Region B already split here instead of minting a new
  // one).
  tokyoJunction("jp-jct-koshu-x-nakasuji", "jp-koshu-x-nakasuji", ["jp-koshu-kaido", "jp-nakasuji-dori", "jp-hanamizuki-dori"]),
];

// Tokyo authenticity plan P5 (Region A). Every node below is brand new (this
// phase's own nodes crossing each other), so none of these are edits to an
// existing table row, unlike jp-jct-mn-r2-sg/jp-jct-mn-r5-sg/jp-jct-koshu-x-
// nakasuji above.
const TOKYO_HANAMIZU_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-tsutsuji-x-yuri", "jp-tsutsuji-x-yuri", ["jp-yuri-dori", "jp-tsutsuji-dori"]),
  tokyoJunction("jp-jct-hanamizuki-x-yuri", "jp-hanamizuki-x-yuri", ["jp-yuri-dori", "jp-hanamizuki-dori"]),
  tokyoJunction("jp-jct-momo-x-yuri", "jp-momo-x-yuri", ["jp-yuri-dori", "jp-momo-dori"]),
  tokyoJunction("jp-jct-kosumosu-x-yuri", "jp-kosumosu-x-yuri", ["jp-yuri-dori", "jp-kosumosu-dori"]),
  tokyoJunction("jp-jct-tsutsuji-x-ajisai", "jp-tsutsuji-x-ajisai", ["jp-ajisai-dori", "jp-tsutsuji-dori"]),
  tokyoJunction("jp-jct-hanamizuki-x-ajisai", "jp-hanamizuki-x-ajisai", ["jp-ajisai-dori", "jp-hanamizuki-dori"]),
  tokyoJunction("jp-jct-momo-x-ajisai", "jp-momo-x-ajisai", ["jp-ajisai-dori", "jp-momo-dori"]),
  tokyoJunction("jp-jct-kosumosu-x-ajisai", "jp-kosumosu-x-ajisai", ["jp-ajisai-dori", "jp-kosumosu-dori"]),
  tokyoJunction("jp-jct-hanamizuki-n", "jp-hanamizuki-n", ["jp-miyanosaka-kita-dori", "jp-hanamizuki-dori"]),
];

// Tokyo authenticity plan P6 (Region C). jp-ss-m gains a real connector entry
// here for the FIRST time — no TOKYO_SKELETON_CONNECTORS entry existed for it
// (nothing generated ever reached it before this phase, so the quarter's own
// hand-authored jp-setagaya-dori/jp-shrine-road successors were the whole
// story there, the same jp-nw2/jp-nm2 situation Region B's own connectors
// hit first) — a brand-new table row, not an edit to an existing one, unlike
// jp-jct-ss-w/jp-jct-ichiban-setagaya/jp-jct-niban-setagaya/jp-jct-ys-r6-sg
// above. Every other node below is brand new (this phase's own nodes
// crossing each other), matching Region A's own P5 table.
const TOKYO_SUMIREGAOKA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-ss-m", "jp-ss-m", ["jp-setagaya-dori", "jp-shrine-road", "jp-renge-dori"]),
  // jp-sangen-x-suisen: Suisen-dōri's own west terminus, the second new
  // mid-span tee into Sangen-dōri (see that road's own updated spec line,
  // TOKYO_SKELETON_SPECS above, for why).
  tokyoJunction("jp-jct-sangen-x-suisen", "jp-sangen-x-suisen", ["jp-sangen-dori", "jp-suisen-dori"]),
  tokyoJunction("jp-jct-fuyo-x-nanohana", "jp-fuyo-x-nanohana", ["jp-fuyo-dori", "jp-nanohana-dori"]),
  tokyoJunction("jp-jct-renge-x-nanohana", "jp-renge-x-nanohana", ["jp-renge-dori", "jp-nanohana-dori"]),
  tokyoJunction("jp-jct-asagao-x-nanohana", "jp-asagao-x-nanohana", ["jp-asagao-dori", "jp-nanohana-dori"]),
  tokyoJunction("jp-jct-sumiregaoka-x-nanohana", "jp-sumiregaoka-x-nanohana", ["jp-sumiregaoka-dori", "jp-nanohana-dori"]),
  // jp-fuyo-x-suisen: Fuyō-dōri's own south terminus, an ordinary T onto
  // Suisen-dōri (which continues through in both directions here now that it
  // reaches Sangen-dōri to the west too).
  tokyoJunction("jp-jct-fuyo-x-suisen", "jp-fuyo-x-suisen", ["jp-fuyo-dori", "jp-suisen-dori"]),
  tokyoJunction("jp-jct-renge-x-suisen", "jp-renge-x-suisen", ["jp-renge-dori", "jp-suisen-dori"]),
  tokyoJunction("jp-jct-asagao-x-suisen", "jp-asagao-x-suisen", ["jp-asagao-dori", "jp-suisen-dori"]),
  tokyoJunction("jp-jct-sumiregaoka-x-suisen", "jp-sumiregaoka-x-suisen", ["jp-sumiregaoka-dori", "jp-suisen-dori"]),
  // Tokyo authenticity plan P7 adds jp-susuki-dori as this node's 4th arm
  // (south) — Sumiregaoka-dōri's own collector line continuing south of
  // Minami-kaidō into Minamimachi under that district's own name.
  tokyoJunction("jp-jct-sumiregaoka-x-minami-kaido", "jp-sumiregaoka-x-minami-kaido", ["jp-sumiregaoka-dori", "jp-minami-kaido", "jp-susuki-dori"]),
];

// Tokyo authenticity plan P7 (Region D). Every node below is brand new (this
// phase's own nodes crossing each other, or — jp-chuo-x-minamimachi — the
// new south extension of jp-chuo-dori-south), matching every other region's
// own table of this shape. The three existing-node upgrades this phase also
// makes (jp-jct-ys-coll-sg, jp-jct-ys-r2-sg, jp-jct-sumiregaoka-x-minami-kaido)
// are edits in place, above (TOKYO_YAMASHITA_CONNECTORS / this table's own
// last row) rather than duplicated here.
const TOKYO_MINAMIMACHI_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-shion-x-minami-kaido", "jp-shion-x-minami-kaido", ["jp-minami-kaido", "jp-shion-dori"]),
  tokyoJunction("jp-jct-shion-x-minamimachi", "jp-shion-x-minamimachi", ["jp-minamimachi-dori", "jp-shion-dori"]),
  tokyoJunction("jp-jct-susuki-x-minamimachi", "jp-susuki-x-minamimachi", ["jp-minamimachi-dori", "jp-susuki-dori"]),
  tokyoJunction("jp-jct-shion-x-nadeshiko", "jp-shion-x-nadeshiko", ["jp-nadeshiko-dori", "jp-shion-dori"]),
  tokyoJunction("jp-jct-susuki-x-nadeshiko", "jp-susuki-x-nadeshiko", ["jp-nadeshiko-dori", "jp-susuki-dori"]),
  tokyoJunction("jp-jct-chuo-x-minamimachi", "jp-chuo-x-minamimachi", ["jp-chuo-dori-south", "jp-minamimachi-dori"]),
];

// Tokyo authenticity plan P8 (Region E). Every node below is brand new (this
// phase's own nodes crossing a ring); the two existing-node upgrades this
// phase also makes (jp-jct-ys-r6-kp above, jp-jct-nk-setagaya/jp-jct-kp-
// setagaya's own signal re-baseline) are edits in place, not duplicated here
// — jp-nk-setagaya/jp-kp-setagaya themselves gain no new ARM (Nishi-Kanjō-
// dōri/Kanpachi-dōri simply keep passing through, now via a different
// immediate neighbour), so neither needs a TOKYO_SKELETON_CONNECTORS edit,
// only the signal's own arm-slug re-baseline (trafficControlCharacterization
// .test.tsx).
const TOKYO_NISHI_MINAMI_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-nishi-kanjo-x-sazanka", "jp-nishi-kanjo-x-sazanka", ["jp-nishi-kanjo-dori", "jp-sazanka-dori"]),
  tokyoJunction("jp-jct-nishi-kanjo-x-hiiragi", "jp-nishi-kanjo-x-hiiragi", ["jp-nishi-kanjo-dori", "jp-hiiragi-dori"]),
  tokyoJunction("jp-jct-kanpachi-x-hiiragi", "jp-kanpachi-x-hiiragi", ["jp-kanpachi-dori", "jp-hiiragi-dori"]),
];

// Tokyo authenticity plan P8 (Region F). jp-chuo-x-kawasemi, jp-kawate-x-
// kawasemi and jp-kawabata-x-kawasemi are all brand new (this phase's own
// roads crossing each other or tee-ing off a mid-span/appended point on an
// existing one — see jp-chuo-dori-north's/jp-kawate-dori's own updated spec
// comments, TOKYO_SKELETON_SPECS above, for why the plan's literal
// jp-chuo-x-koshu/jp-kawate-x-koshu anchors were not reused directly).
//
// jp-kawabata-n is the spine's own new NORTH terminus — Miyanosaka Kita-dōri
// does NOT continue through it (kawabata-n is that road's own new LAST
// node, exactly the same "elbow" shape jp-chuo-n itself used to be before
// this phase's own extension moved it one node further out), so it needs
// the same explicit 2-road connector jp-chuo-n always carried before this
// phase (that one stays a bare same-road pass-through now, needing no edit
// — see TOKYO_SKELETON_SPECS's own updated comment). A first pass omitted
// this entry on the mistaken belief that kawabata-n was a pass-through too;
// the real circuit-walk test (`roadRealism.test.ts`) caught the resulting
// stranded traffic at (510,1140) immediately — restated here as the trap it
// is, matching this plan's own "the circuit-walk test is where a dead end
// surfaces, not the successor check" warning.
const TOKYO_KAWABATA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-chuo-x-kawasemi", "jp-chuo-x-kawasemi", ["jp-chuo-dori-north", "jp-kawasemi-dori"]),
  tokyoJunction("jp-jct-kawate-x-kawasemi", "jp-kawate-x-kawasemi", ["jp-kawate-dori", "jp-kawasemi-dori"]),
  tokyoJunction("jp-jct-kawabata-x-kawasemi", "jp-kawabata-x-kawasemi", ["jp-kawasemi-dori", "jp-kawabata-dori"]),
  tokyoJunction("jp-jct-kawabata-n", "jp-kawabata-n", ["jp-miyanosaka-kita-dori", "jp-kawabata-dori"]),
];

// --- River crossings (Phase 3): kawate-dori/kawagishi-dori's own
// intersections with the three bridges, plus each bridge's own inland east
// landing (jp-higashi-w, jp-khh-w) — those ALSO need a same-street grouping
// for control derivation (TOKYO_SAME_STREET_GROUPS below), but that table
// governs stop-vs-through only; the turn whitelist here is what keeps a lane
// arriving there from ending in empty successors (#128), so both are
// required, not either/or. The pure shape points (jp-kawagishi-w1/w2) need no
// entry: same-road continuation is always legal.
const TOKYO_RIVER_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-kawate-setagaya", "jp-kawate-x-setagaya", ["jp-kawate-dori", "jp-sakura-ohashi"]),
  tokyoJunction("jp-jct-kawate-kawanaka", "jp-kawate-x-kawanaka", ["jp-kawate-dori", "jp-kawanaka-bashi"]),
  tokyoJunction("jp-jct-kawate-koshu", "jp-kawate-x-koshu", ["jp-kawate-dori", "jp-tsuki-ohashi"]),
  tokyoJunction("jp-jct-kawagishi-setagaya", "jp-kawagishi-x-setagaya", ["jp-kawagishi-dori", "jp-sakura-ohashi"]),
  tokyoJunction("jp-jct-kawagishi-kawanaka", "jp-kawagishi-x-kawanaka", ["jp-kawagishi-dori", "jp-kawanaka-bashi"]),
  tokyoJunction("jp-jct-kawagishi-koshu", "jp-kawagishi-x-koshu", ["jp-kawagishi-dori", "jp-tsuki-ohashi"]),
  tokyoJunction("jp-jct-higashi-w", "jp-higashi-w", ["jp-sakura-ohashi", "jp-higashi-dori"]),
  tokyoJunction("jp-jct-khh-w", "jp-khh-w", ["jp-tsuki-ohashi", "jp-koshu-kaido-higashi"]),
];

const TOKYO_EAST_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-kawanaka-e", "jp-kawanaka-e", ["jp-kawanaka-bashi", "jp-higashi-hondori"]),
  tokyoJunction("jp-jct-hd-x-tofu", "jp-hd-x-tofu", ["jp-higashi-dori", "jp-tofu-yokocho"]),
  tokyoJunction("jp-jct-hd-x-hondori", "jp-hd-x-hondori", ["jp-higashi-dori", "jp-higashi-hondori"]),
  tokyoJunction("jp-jct-hd-x-soto", "jp-hd-x-soto", ["jp-higashi-dori", "jp-higashi-soto-dori"]),
  tokyoJunction("jp-jct-khh-x-keyaki", "jp-khh-x-keyaki", ["jp-koshu-kaido-higashi", "jp-keyaki-dori"]),
  tokyoJunction("jp-jct-khh-x-hondori", "jp-khh-x-hondori", ["jp-koshu-kaido-higashi", "jp-higashi-hondori"]),
  tokyoJunction("jp-jct-khh-x-soto", "jp-khh-x-soto", ["jp-koshu-kaido-higashi", "jp-higashi-soto-dori"]),
  tokyoJunction("jp-jct-hh-x-fuji", "jp-hh-x-fuji", ["jp-higashi-hondori", "jp-fuji-dori"]),
  tokyoJunction("jp-jct-hh-s", "jp-hh-s", ["jp-higashi-hondori", "jp-higashi-minami-dori"]),
  tokyoJunction("jp-jct-hh-n", "jp-hh-n", ["jp-higashi-hondori", "jp-higashi-kita-dori"]),
  tokyoJunction("jp-jct-ty-s", "jp-ty-s", ["jp-tofu-yokocho", "jp-higashi-minami-dori"]),
  tokyoJunction("jp-jct-ty-x-fuji", "jp-ty-x-fuji", ["jp-tofu-yokocho", "jp-fuji-dori"]),
  tokyoJunction("jp-jct-kawagishi-x-minami", "jp-kawagishi-x-minami", ["jp-kawagishi-dori", "jp-higashi-minami-dori"]),
  tokyoJunction("jp-jct-kawagishi-x-fuji", "jp-kawagishi-x-fuji", ["jp-kawagishi-dori", "jp-fuji-dori"]),
  tokyoJunction("jp-jct-kawagishi-x-kita", "jp-kawagishi-x-kita", ["jp-kawagishi-dori", "jp-higashi-kita-dori"]),
  tokyoJunction("jp-jct-hkd-x-keyaki", "jp-hkd-x-keyaki", ["jp-higashi-kita-dori", "jp-keyaki-dori"]),
];

const jpGenNodeById = new Map<string, LaneNode>(
  [
    ...Object.values(jpGenNodes),
    ...Object.values(jpMiyanosakaNodes),
    ...Object.values(jpYamashitaNodes),
    ...Object.values(jpNishiNodes),
    ...Object.values(jpEkimaeNishiNodes),
    ...Object.values(jpHanamizuNodes),
    ...Object.values(jpSumiregaokaNodes),
    ...Object.values(jpMinamimachiNodes),
    ...Object.values(jpNishiMinamiNodes),
    ...Object.values(jpKawabataNodes),
    ...Object.values(jpRiverNodes),
    ...Object.values(jpEastNodes),
  ].map((item) => [item.id, item]),
);

// ---------------------------------------------------------------------------
// Lane-offset tiers. Tokyo's arterials/collectors (>= 8 m carriageway) crib
// London's exact numbers directly (both are left-hand traffic); the many
// narrower locals/collectors/shared-space roads this phase's residential webs
// need (5.8-7 m) use a smaller tier matching the existing quarter's own
// narrow-road convention (offset = half the lane width, i.e. the nearside
// lane's inner edge sits right on the true centreline) — the same convention
// already proven safe by the tests passing against jp-narrow-road et al.
// ---------------------------------------------------------------------------
const TOKYO_STANDARD_OFFSET_M = 1.7;
const TOKYO_STANDARD_PITCH_M = 3.2;
const TOKYO_STANDARD_LANE_WIDTH_M = 3.2;
const TOKYO_NARROW_OFFSET_M = 1.35;
const TOKYO_NARROW_PITCH_M = 2.7;
const TOKYO_NARROW_LANE_WIDTH_M = 2.7;
/** The width threshold above which a road's carriageway can carry the
 * standard-tier offset/lane-width without its envelope overflowing the
 * surface half-width (verified against `content.test.ts`'s lane-envelope
 * epsilon: standard tier needs >= 6.6 m, narrow tier fits down to 5.8 m). */
const TOKYO_STANDARD_TIER_MIN_WIDTH_M = 8;

interface TokyoLaneTier {
  readonly offsetM: number;
  readonly pitchM: number;
  readonly laneWidthM: number;
}

const tokyoTierFor = (spec: TokyoRoadSpec): TokyoLaneTier =>
  spec.widthM >= TOKYO_STANDARD_TIER_MIN_WIDTH_M
    ? { offsetM: TOKYO_STANDARD_OFFSET_M, pitchM: TOKYO_STANDARD_PITCH_M, laneWidthM: TOKYO_STANDARD_LANE_WIDTH_M }
    : { offsetM: TOKYO_NARROW_OFFSET_M, pitchM: TOKYO_NARROW_PITCH_M, laneWidthM: TOKYO_NARROW_LANE_WIDTH_M };

/**
 * The established running line between two nodes, offset from the straight
 * node-to-node line — identical in shape to London's `offsetPath`. Positive
 * offsets go to the driver's right, so every caller below negates for a
 * two-way road's nearside lane (left-hand traffic).
 */
const tokyoOffsetPath = (
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

interface TokyoRawLane extends LaneSegment {
  readonly reverseKey: string;
  readonly direction: "forward" | "reverse";
  readonly laneIndex: number;
}

/**
 * Final generated-half road tables. District infill (Miyanosaka North,
 * Yamashita South, Nishi) appends its own specs/connectors to these two
 * before anything below reads them — see the district sections further down
 * this file, each of which reassigns these two `let`s by concatenation.
 * `TOKYO_ROAD_SPECS`/`TOKYO_JUNCTION_CONNECTORS` are exported once (at their
 * final values) beside `TOKYO_MAP_PACK`.
 */
const tokyoRoadSpecs: readonly TokyoRoadSpec[] = [
  ...TOKYO_SKELETON_SPECS,
  ...TOKYO_MIYANOSAKA_SPECS,
  ...TOKYO_YAMASHITA_SPECS,
  ...TOKYO_NISHI_SPECS,
  ...TOKYO_EKIMAE_NISHI_SPECS,
  ...TOKYO_HANAMIZU_SPECS,
  ...TOKYO_SUMIREGAOKA_SPECS,
  ...TOKYO_MINAMIMACHI_SPECS,
  ...TOKYO_NISHI_MINAMI_SPECS,
  ...TOKYO_KAWABATA_SPECS,
  ...TOKYO_RIVER_SPECS,
  ...TOKYO_EAST_SPECS,
];
const tokyoJunctionConnectors: readonly TokyoJunctionConnectorSpec[] = [
  ...TOKYO_SKELETON_CONNECTORS,
  ...TOKYO_MIYANOSAKA_CONNECTORS,
  ...TOKYO_YAMASHITA_CONNECTORS,
  ...TOKYO_NISHI_CONNECTORS,
  ...TOKYO_EKIMAE_NISHI_CONNECTORS,
  ...TOKYO_HANAMIZU_CONNECTORS,
  ...TOKYO_SUMIREGAOKA_CONNECTORS,
  ...TOKYO_MINAMIMACHI_CONNECTORS,
  ...TOKYO_NISHI_MINAMI_CONNECTORS,
  ...TOKYO_KAWABATA_CONNECTORS,
  ...TOKYO_RIVER_CONNECTORS,
  ...TOKYO_EAST_CONNECTORS,
];
const tokyoGenNodeList: readonly LaneNode[] = [...jpGenNodeById.values()];

/**
 * Builds every raw (pre-successor) lane for the current `tokyoRoadSpecs`.
 * Called once, after every district's specs have been appended (see the
 * bottom of this file) — matches London's single build pass over
 * `LONDON_ROAD_SPECS`.
 */
function buildTokyoRawLanes(): TokyoRawLane[] {
  // Includes the quarter's own nodes too: a generated road's terminus at the
  // seam (jp-ss-w, jp-ss-e, jp-d, jp-ne2) names an EXISTING quarter node, per
  // the plan's "never insert a node into a shipped polyline" rule.
  const nodeById = new Map<string, LaneNode>(
    [...tokyoGenNodeList, ...jpNodesList].map((item) => [item.id, item]),
  );
  const rawLanes: TokyoRawLane[] = [];
  for (const spec of tokyoRoadSpecs) {
    const tier = tokyoTierFor(spec);
    if (!spec.oneWay && spec.laneCount % 2 !== 0) {
      throw new Error(`${spec.id} two-way laneCount must be even`);
    }
    const directions = spec.oneWay
      ? ([spec.oneWay] as const)
      : (["forward", "reverse"] as const);
    const lanesPerDirection = spec.oneWay ? spec.laneCount : spec.laneCount / 2;
    for (let segment = 0; segment + 1 < spec.nodeIds.length; segment += 1) {
      const start = nodeById.get(spec.nodeIds[segment]);
      const end = nodeById.get(spec.nodeIds[segment + 1]);
      if (!start || !end) {
        throw new Error(`${spec.id} references a missing node "${spec.nodeIds[segment]}"/"${spec.nodeIds[segment + 1]}"`);
      }
      for (const direction of directions) {
        const from = direction === "forward" ? start : end;
        const to = direction === "forward" ? end : start;
        for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
          const lateralOffset = spec.oneWay
            ? (laneIndex - (lanesPerDirection - 1) / 2) * tier.pitchM
            : -(tier.offsetM + laneIndex * tier.pitchM);
          const geometry = buildLaneTrueGeometry(
            from.position,
            to.position,
            tokyoOffsetPath(from.position, to.position, lateralOffset),
            {
              maxBlendLateralM: 5.25,
              ...(spec.laneCount === 4 ? { connectorBlendSteps: 12 } : {}),
            },
          );
          rawLanes.push({
            id: `${spec.id}-${segment + 1}-${direction}-${laneIndex + 1}`,
            reverseKey: `${spec.id}:${segment}`,
            direction,
            laneIndex,
            roadId: spec.id,
            widthM: tier.laneWidthM,
            from: from.id,
            to: to.id,
            centerline: geometry.centerline,
            role: spec.oneWay ? "one_way" : laneIndex > 0 ? "passing" : "travel",
            trafficSide: "left",
            speedLimit: spec.speedLimitKmh,
            successors: [],
          });
        }
      }
    }
  }
  return rawLanes;
}

const tokyoConnectorByNode = new Map<string, TokyoJunctionConnectorSpec>();
function rebuildTokyoConnectorIndex(): void {
  tokyoConnectorByNode.clear();
  for (const connector of tokyoJunctionConnectors) {
    tokyoConnectorByNode.set(connector.nodeId, connector);
  }
}

/** Road ids a lane on `fromRoadId` may legally turn onto at `nodeId`. */
const tokyoAllowedCrossRoadsAt = (nodeId: string, fromRoadId: string): Set<string> =>
  new Set(
    tokyoConnectorByNode
      .get(nodeId)
      ?.movements.find((movement) => movement.fromRoadId === fromRoadId)
      ?.toRoadIds ?? [],
  );

/**
 * Builds the generated half's final lanes (successors resolved) AND gives
 * the quarter's hand-authored lanes their new turns onto the generated
 * network, append-only — the same two-part shape as London's
 * `londonGeneratedLanes` + `londonLanes`. Called once, after every district's
 * specs/connectors have been appended.
 */
function buildTokyoGeneratedNetwork(): {
  readonly lanes: readonly LaneSegment[];
  readonly rawLanes: readonly TokyoRawLane[];
} {
  rebuildTokyoConnectorIndex();
  const rawLanes = buildTokyoRawLanes();

  const outboundByNode = new Map<string, LaneSegment[]>();
  for (const lane of [...jpLanes, ...rawLanes]) {
    outboundByNode.set(lane.from, [...(outboundByNode.get(lane.from) ?? []), lane]);
  }

  const generatedLanes: readonly LaneSegment[] = rawLanes.map((lane) => {
    const allowed = tokyoAllowedCrossRoadsAt(lane.to, lane.roadId);
    const successors = [
      ...new Set(
        (outboundByNode.get(lane.to) ?? [])
          .filter(
            (candidate) =>
              (candidate as TokyoRawLane).reverseKey !== lane.reverseKey,
          )
          .filter(
            (candidate) =>
              candidate.roadId === lane.roadId || allowed.has(candidate.roadId),
          )
          .map((candidate) => candidate.id)
          .sort((left, right) => left.localeCompare(right)),
      ),
    ];
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
      successors,
      ...(adjacentLaneIds.length > 0 ? { adjacentLaneIds } : {}),
    };
  });

  return { lanes: generatedLanes, rawLanes };
}

/**
 * Gives the quarter's hand-authored lanes their turns onto the generated
 * network, from the same whitelist the generated lanes read. Append-only: an
 * authored lane keeps every successor it already had, in its authored order,
 * so nothing about the quarter's own routing moves — the exact mechanism
 * London's own quarter-onto-generated merge uses.
 */
function withGeneratedSuccessors(
  authoredLanes: readonly LaneSegment[],
  rawLanes: readonly TokyoRawLane[],
): readonly LaneSegment[] {
  return authoredLanes.map((lane) => {
    const allowed = tokyoAllowedCrossRoadsAt(lane.to, lane.roadId);
    const added = rawLanes
      .filter((candidate) => candidate.from === lane.to)
      .filter((candidate) => allowed.has(candidate.roadId))
      .map((candidate) => candidate.id)
      .sort((left, right) => left.localeCompare(right));
    return added.length === 0
      ? lane
      : { ...lane, successors: [...lane.successors, ...added] };
  });
}

/**
 * Carriageway surfaces for the generated half — one per `TokyoRoadSpec`,
 * centreline through its own authored nodes, lane ids pulled back off the
 * generated lanes that ended up on that road. Markings follow the same
 * country convention as the quarter's own roads (white centre line; Japan
 * paints white for both directions and lane dividers, so a plain dashed
 * white centre line is enough — see `roadRealism.test.ts`'s per-country
 * colour check).
 */
function buildTokyoGeneratedSurfaces(
  generatedLanes: readonly LaneSegment[],
): readonly RoadSurface[] {
  const nodeById = new Map<string, LaneNode>(
    [...tokyoGenNodeList, ...jpNodesList].map((item) => [item.id, item]),
  );
  return tokyoRoadSpecs.map((spec) => {
    const centerline = spec.nodeIds.map((id) => {
      const found = nodeById.get(id);
      if (!found) throw new Error(`${spec.id} references a missing node "${id}"`);
      return found.position;
    });
    const laneIds = generatedLanes
      .filter((lane) => lane.roadId === spec.id)
      .map((lane) => lane.id);
    const markings = spec.oneWay
      ? spec.laneCount > 1
        ? [roadMarking(`${spec.id}-lane`, "lane_dashed", centerline, "white")]
        : []
      : [roadMarking(`${spec.id}-centre`, "centre_dashed", centerline, "white")];
    const surface = roadSurface(
      spec.id,
      centerline,
      spec.widthM,
      laneIds,
      spec.surfaceType ?? "standard",
      markings,
    );
    return spec.sidewalkWidthM === undefined
      ? (spec.widthM >= TOKYO_STANDARD_TIER_MIN_WIDTH_M
        ? surface
        : { ...surface, sidewalkWidthM: (spec.surfaceType ?? "standard") === "shared_space" ? 1.4 : 2.2 })
      : { ...surface, sidewalkWidthM: spec.sidewalkWidthM };
  });
}

// =============================================================================
// Junction control derivation (stop/yield only — Phase 5 adds signals).
//
// Every arriving road at a junction scores `speedLimitKmh` plus a "through"
// bonus of 1000 when it genuinely continues past the node: either the node
// is an INTERIOR point of that road's own polyline (it bends there but does
// not end), or it is individually listed in `TOKYO_THROUGH_BONUS_NODES`
// (a road phase-trimmed short of its real destination — e.g. Kōshū-kaidō
// stopping at its Chūō-dōri crossing rather than the bridge it will reach in
// Phase 3 — still reads as continuing, not as a demoted stub), or every
// member of a `TOKYO_SAME_STREET_GROUPS` group at that node counts as
// through together (a road split across specs for a lane-count/width change,
// e.g. Chūō-dōri's 4-lane core meeting its 2-lane spine, is one logical
// street and must never stop for its own other half).
//
// A unique top-scoring road stays uncontrolled (priority) and every other
// arriving lane gets a stop. Two or more roads tied at the top — unless they
// are all one same-street group — is a genuine unresolved equal-class
// crossing: every arriving lane stops (a safe, conservative choice for a
// phase with no signals yet; Phase 5 adds one at "every arterial×arterial and
// downtown junction", which is exactly this case).
// =============================================================================

const TOKYO_THROUGH_BONUS_NODES: Readonly<Record<string, readonly string[]>> = {
  "jp-chuo-x-setagaya": ["jp-setagaya-dori-east"],
  "jp-chuo-x-koshu": ["jp-koshu-kaido"],
  // Phase 3: each bridge's inland east landing is a pure two-road meeting (no
  // interior-node bonus applies to either side), so the "through" read needs
  // an explicit bonus here too, same as the west landings above.
  "jp-higashi-w": ["jp-sakura-ohashi"],
  "jp-khh-w": ["jp-tsuki-ohashi"],
};

const TOKYO_SAME_STREET_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  "jp-ss-w": [["jp-setagaya-dori", "jp-setagaya-dori-west"]],
  "jp-ss-e": [["jp-setagaya-dori", "jp-setagaya-dori-east"]],
  // Phase 3 adds Setagaya-dōri's own continuation onto Sakura-ōhashi as a
  // second group at this node — Chūō-dōri's group (unchanged) still stops.
  "jp-chuo-x-setagaya": [["jp-chuo-dori-south", "jp-chuo-dori"], ["jp-setagaya-dori-east", "jp-sakura-ohashi"]],
  "jp-chuo-x-kita-dori": [["jp-chuo-dori", "jp-chuo-dori-north"]],
  // Phase 3: Kōshū-kaidō continuing onto Tsuki-ōhashi (plan rule 11 — a
  // street that continues must read continuous across the junction).
  "jp-chuo-x-koshu": [["jp-koshu-kaido", "jp-tsuki-ohashi"]],
  "jp-higashi-w": [["jp-sakura-ohashi", "jp-higashi-dori"]],
  "jp-khh-w": [["jp-tsuki-ohashi", "jp-koshu-kaido-higashi"]],
};

const THROUGH_SCORE_BONUS = 1000;

const laneLengthOfTokyo = (lane: LaneSegment): number => {
  let total = 0;
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    total += distanceBetweenPoints(lane.centerline[index], lane.centerline[index + 1]);
  }
  return total;
};

const lanePointAtDistanceTokyo = (lane: LaneSegment, distanceAlongM: number): WorldPoint => {
  let accumulated = 0;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const a = lane.centerline[index];
    const b = lane.centerline[index + 1];
    const segmentLength = distanceBetweenPoints(a, b);
    if (accumulated + segmentLength >= distanceAlongM || index === lane.centerline.length - 2) {
      const amount = segmentLength > 1e-9
        ? Math.max(0, Math.min(1, (distanceAlongM - accumulated) / segmentLength))
        : 0;
      return point(a.x + (b.x - a.x) * amount, a.z + (b.z - a.z) * amount);
    }
    accumulated += segmentLength;
  }
  return lane.centerline[0];
};

const laneHeadingAtDistanceDegTokyo = (lane: LaneSegment, distanceAlongM: number): number => {
  let accumulated = 0;
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    const a = lane.centerline[index];
    const b = lane.centerline[index + 1];
    const segmentLength = distanceBetweenPoints(a, b);
    if (segmentLength < 1e-9) continue;
    if (accumulated + segmentLength >= distanceAlongM || index + 2 === lane.centerline.length) {
      return (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI;
    }
    accumulated += segmentLength;
  }
  const last = lane.centerline.at(-1)!;
  const secondLast = lane.centerline.at(-2) ?? last;
  return (Math.atan2(last.x - secondLast.x, last.z - secondLast.z) * 180) / Math.PI;
};

/** All road ids that count as "through" (never stopped) at `nodeId`, given
 * `roadId` is one of the roads present there — folds in same-street peers so
 * a road never has to individually list its own split-off siblings. */
function tokyoThroughRoadIdsAt(
  nodeId: string,
  isInteriorFor: (roadId: string) => boolean,
): Set<string> {
  const through = new Set<string>();
  for (const group of TOKYO_SAME_STREET_GROUPS[nodeId] ?? []) {
    if (group.some((roadId) => isInteriorFor(roadId) || (TOKYO_THROUGH_BONUS_NODES[nodeId] ?? []).includes(roadId))) {
      for (const roadId of group) through.add(roadId);
    }
  }
  for (const roadId of TOKYO_THROUGH_BONUS_NODES[nodeId] ?? []) through.add(roadId);
  return through;
}

/**
 * Builds every stop control the generated network needs: one per node with
 * >= 2 distinct arriving roads where at least one of them is not the
 * uncontested top-priority road (§9 Phase 2 "stop/yield controls at web
 * junctions and arterial mouths"). Only processes nodes touched by >= 1
 * generated lane, so the quarter's own already-shipped control state is
 * untouched. `signalNodeIds` (Tokyo expansion Phase 5) is skipped here
 * entirely — those nodes get a `deriveTokyoSignalControls` signal instead of
 * a stop, and authoring both at the same node would leave two independent
 * controls contradicting each other over the same lanes.
 */
function deriveTokyoJunctionControls(
  allLanes: readonly LaneSegment[],
  roadSurfacesById: Map<string, RoadSurface>,
  generatedNodeIds: ReadonlySet<string>,
  signalNodeIds: ReadonlySet<string>,
): { readonly controls: readonly TrafficControl[]; readonly zones: readonly ConflictZone[] } {
  const roadSpecById = new Map(tokyoRoadSpecs.map((spec) => [spec.id, spec]));
  // Interior-node membership for EVERY road present in the map (old quarter's
  // roadSurfaces included) — a node is interior to a road if it is neither
  // the first nor the last point of that road's own surface centreline.
  const interiorNodePositionsByRoad = new Map<string, WorldPoint[]>();
  for (const surface of roadSurfacesById.values()) {
    interiorNodePositionsByRoad.set(surface.id, surface.centerline.slice(1, -1));
  }
  const isInteriorFor = (roadId: string, position: WorldPoint): boolean =>
    (interiorNodePositionsByRoad.get(roadId) ?? []).some(
      (candidate) => distanceBetweenPoints(candidate, position) < 0.5,
    );

  const arrivalsByNode = new Map<string, LaneSegment[]>();
  for (const lane of allLanes) {
    arrivalsByNode.set(lane.to, [...(arrivalsByNode.get(lane.to) ?? []), lane]);
  }
  const nodePositionById = new Map<string, WorldPoint>();
  for (const node_ of tokyoGenNodeList) nodePositionById.set(node_.id, node_.position);
  for (const node_ of jpNodesList) nodePositionById.set(node_.id, node_.position);

  const controls: TrafficControl[] = [];
  const zones: ConflictZone[] = [];
  let controlIndex = 0;

  for (const nodeId of [...generatedNodeIds].sort()) {
    if (signalNodeIds.has(nodeId)) continue;
    const position = nodePositionById.get(nodeId);
    if (!position) continue;
    const arrivals = arrivalsByNode.get(nodeId) ?? [];
    const arrivingRoadIds = [...new Set(arrivals.map((lane) => lane.roadId))].sort();
    if (arrivingRoadIds.length < 2) continue;

    const throughRoadIds = tokyoThroughRoadIdsAt(nodeId, (roadId) =>
      isInteriorFor(roadId, position),
    );
    const scoreOf = (roadId: string): number => {
      const spec = roadSpecById.get(roadId);
      const limit = spec?.speedLimitKmh ?? speedLimitForRoad(roadId);
      const through =
        isInteriorFor(roadId, position) || throughRoadIds.has(roadId);
      return limit + (through ? THROUGH_SCORE_BONUS : 0);
    };
    const scored = arrivingRoadIds.map((roadId) => ({ roadId, score: scoreOf(roadId) }));
    const maxScore = Math.max(...scored.map((entry) => entry.score));
    const topRoadIds = new Set(scored.filter((entry) => entry.score === maxScore).map((entry) => entry.roadId));
    const topsAreOneMutualGroup =
      topRoadIds.size <= 1 ||
      [...topRoadIds].every((roadId) =>
        [...topRoadIds].every(
          (other) =>
            roadId === other ||
            (TOKYO_SAME_STREET_GROUPS[nodeId] ?? []).some(
              (group) => group.includes(roadId) && group.includes(other),
            ),
        ),
      );
    const stoppedRoadIds = topsAreOneMutualGroup
      ? arrivingRoadIds.filter((roadId) => !topRoadIds.has(roadId))
      : arrivingRoadIds;
    if (stoppedRoadIds.length === 0) continue;

    const stoppedArms = arrivals.filter((lane) => stoppedRoadIds.includes(lane.roadId));
    controlIndex += 1;
    const id = `jp-gen-stop-${controlIndex}`;
    const zoneId = `${id}-zone`;
    const laneIds = stoppedArms.map((lane) => lane.id);
    const approaches = [];
    const installations = [];
    // The widest carriageway meeting at this node, not just the stopped
    // arm's own road: a pole cleared past its OWN road's kerb can still land
    // inside a much wider crossing road's envelope right at the junction
    // (Chūō-dōri's 13.6 m core over Eki-mae-dōri's 9 m, e.g.) —
    // content.test.ts's lane-envelope check is over EVERY lane on the map,
    // not just the stopped road's own.
    const maxSurfaceWidthAtNodeM = Math.max(
      ...arrivingRoadIds.map((roadId) => roadSurfacesById.get(roadId)?.widthM ?? 0),
    );
    // NYC's flat 6 m setback assumes an ordinary-width crossing road; Chūō-
    // dōri's 13.6 m core (half-width 6.8 m) needs more room than that just to
    // clear its OWN envelope at the stop line, before the pole is even
    // placed — this was the real cause behind the "pole inside a lane
    // envelope" failures, not the pole offset itself.
    const setbackM = Math.max(6, maxSurfaceWidthAtNodeM / 2 + 2.5);
    for (const lane of stoppedArms) {
      const lengthM = laneLengthOfTokyo(lane);
      const stopDistanceM = Math.max(0, lengthM - setbackM);
      const headingDeg = laneHeadingAtDistanceDegTokyo(
        lane,
        Math.max(0, stopDistanceM - CONNECTOR_BLEND_RUN_M - 1),
      );
      const stopPoint = lanePointAtDistanceTokyo(lane, stopDistanceM);
      const rad = (headingDeg * Math.PI) / 180;
      // LEFT-hand normal (Tokyo is left-hand traffic, unlike the NYC formula
      // this is cloned from): negated right-hand normal, so the pole lands on
      // the kerb beside the stopped lane's own near side, matching the
      // existing quarter's own poles (e.g. jp-stop-narrow sits west of a
      // northbound lane, not east). Using the RIGHT-hand normal here first
      // landed poles across the carriageway, occasionally inside an opposing
      // lane's envelope (content.test.ts "places physical traffic-control
      // supports outside every lane envelope").
      const leftX = -Math.cos(rad);
      const leftZ = Math.sin(rad);
      const surface = roadSurfacesById.get(lane.roadId);
      const surfaceWidthM = Math.max(surface?.widthM ?? lane.widthM * 2, maxSurfaceWidthAtNodeM);
      // Clears the WHOLE road surface (every lane in both directions, by
      // construction — the lane-envelope test already holds every lane's
      // outer edge inside `surfaceWidthM / 2`), not just the tier's inner
      // lane offset: a lane-relative clearance (NYC's original formula)
      // under-shoots a multi-lane road's OUTER lane, which is exactly what
      // Chūō-dōri's 4-lane core tripped.
      const poleOffsetM = surfaceWidthM / 2 + 2.2;
      const approachId = `${id}-${lane.id}-app`;
      approaches.push(approach(approachId, lane.id, stopDistanceM, `${id}-stop`, [zoneId]));
      installations.push(
        installation(
          `${id}-${lane.id}-sign`,
          stopPoint.x + leftX * poleOffsetM,
          stopPoint.z + leftZ * poleOffsetM,
          headingDeg,
          "roadside_pole",
          "stop_sign",
          "primary",
          [approachId],
        ),
      );
    }
    const half = 7;
    controls.push(control(id, "stop", position.x, position.z, 0, laneIds, [zoneId], approaches, installations));
    zones.push({
      id: zoneId,
      laneIds,
      polygon: [
        point(position.x - half, position.z - half),
        point(position.x + half, position.z - half),
        point(position.x + half, position.z + half),
        point(position.x - half, position.z + half),
      ],
    });
  }
  return { controls, zones };
}

// =============================================================================
// Signal derivation (Tokyo expansion Phase 5, R10). Cloned in SHAPE from
// Cairo's own file-private signal generator (cities/cairo.ts, `signalNodeIds`
// + the loop building `cairoControls`) rather than an extension of
// `deriveTokyoJunctionControls` above: a signal governs every arm with its
// own phase — there is no "uncontested priority road" the way a stop
// junction has one, so the through/priority SCORING that function owns has
// nothing for a signal generator to reuse. What Tokyo's own stop generator
// above DOES already prove, and this one reuses directly, is the geometry:
// `laneLengthOfTokyo`/`lanePointAtDistanceTokyo`/`laneHeadingAtDistanceDegTokyo`,
// the `setbackM = max(6, maxSurfaceWidthAtNodeM/2 + 2.5)` formula (scales
// against the WIDEST road meeting the node, not just the stopped arm's own —
// Chūō-dōri's 13.6 m core is exactly why), and the LEFT-hand kerbside normal
// (Tokyo is left-hand traffic; NYC's original right-hand formula put poles
// across the carriageway here, per the Phase 2 memory).
//
// Node selection (`TOKYO_SIGNAL_NODE_IDS`) is hand-picked, like Cairo's own
// `signalNodeIds` — but data-driven off this file's OWN `TOKYO_ZONE_FOR_ROAD`
// table (§9 Phase 5 "every arterial×arterial and downtown junction") rather
// than eyeballed: a junction qualifies if >= 2 of its arriving roads are
// `"ring"`-zoned (arterial x arterial) or >= 1 is `"downtown"`-zoned, read
// off a scratchpad enumeration of every generated-network junction, then
// pruned by hand for the cases the raw rule over-picks (the four ring
// corners where a ring meets only the closing road at the world margin stay
// stops — genuinely low-traffic; the three Nakamise-Yokochō crossings stay
// stops too — a shared-space 20 km/h shotengai mouth reads wrong with a
// full vehicle signal cycle, and its two real ends get a `crosswalk` control
// instead, below) and extended by hand for the east bank (Phase 3's own
// zone table has no single "ring" tag over there, so the bridge landings
// and the Higashi Hon-dōri spine crossings are added by name).
// =============================================================================

const TOKYO_SIGNAL_NODE_IDS: readonly string[] = [
  // --- Downtown core (21): every Ichiban/Niban/Chūō/Kawate-dōri crossing
  // with a cross-street, minus the three Nakamise-Yokochō ones (stay stops
  // + get a dedicated crosswalk at each real end, not a vehicle signal).
  "jp-minami-dori-w",
  "jp-ekimae-w",
  "jp-shotengai-nishi-x-uptown",
  "jp-kita-dori-w",
  "jp-ichiban-x-setagaya",
  "jp-ichiban-x-minami-dori",
  "jp-ichiban-x-ekimae",
  "jp-ichiban-x-kita-dori",
  "jp-niban-x-setagaya",
  "jp-niban-x-minami-dori",
  "jp-niban-x-ekimae",
  "jp-niban-x-kita-dori",
  "jp-chuo-x-minami-kaido",
  "jp-chuo-x-setagaya",
  "jp-chuo-x-minami-dori",
  "jp-chuo-x-ekimae", // the scramble (Chūō-dōri x Ekimae-dōri) — see the extra diagonal crosswalks added to this control below.
  "jp-chuo-x-kita-dori",
  "jp-kawate-x-minami-dori",
  "jp-kawate-x-ekimae",
  "jp-kawate-x-kita-dori",
  // --- Ring x ring (13): the west ring's own major crossings, minus the
  // four corners where a ring meets only the closing road at the world
  // margin (jp-nk-s/jp-nk-n/jp-sg-s/jp-sg-n stay stops).
  "jp-kawate-x-kawanaka",
  "jp-nk-minami",
  "jp-nk-setagaya",
  "jp-nk-koshu",
  "jp-kp-s",
  "jp-kp-minami",
  "jp-kp-setagaya",
  "jp-kp-koshu",
  "jp-kp-n",
  "jp-sg-minami",
  "jp-sg-koshu",
  "jp-chuo-n",
  "jp-chuo-x-koshu",
  // --- East bank spine + bridge landings (8): the Higashi Hon-dōri spine's
  // crossings with the bridges and with the outer ring closer — the compact
  // east district's own major nodes. jp-higashi-w and jp-khh-w (Sakura-
  // ōhashi/Higashi-dōri and Tsuki-ōhashi/Kōshū-kaidō-higashi's own bridge
  // landings) are deliberately NOT here despite being in the "ring x ring"
  // net: each is a pure two-road node where BOTH roads are one mutually-
  // grouped "same street" (TOKYO_SAME_STREET_GROUPS) — the bridge simply
  // continuing under a new name, with no actual cross traffic to give a
  // phase to. A signal there would have nothing to alternate; they stay
  // uncontrolled through points, same as Phase 3 left them. (jp-higashi-w's
  // jp-higashi-dori arm is also only ~10 m from the next real junction,
  // jp-hd-x-tofu — a short-arm pole-envelope conflict `content.test.ts`
  // caught directly — but the deeper reason it does not belong on this list
  // is the missing cross traffic, not the geometry.)
  "jp-kawanaka-e",
  "jp-hd-x-hondori",
  "jp-khh-x-hondori",
  "jp-hd-x-soto",
  "jp-khh-x-soto",
  "jp-kawagishi-x-setagaya",
  "jp-kawagishi-x-kawanaka",
  "jp-kawagishi-x-koshu",
];

/** Node this scramble control's id resolves to — named once so the
 * diagonal-crosswalk post-process below can find it without restating the
 * `jp-gen-signal-` id-building convention. */
const TOKYO_SCRAMBLE_NODE_ID = "jp-chuo-x-ekimae";

const tokyoDistanceToSegment = (
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
            ((candidate.x - start.x) * dx + (candidate.z - start.z) * dz) / lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(candidate.x - (start.x + dx * amount), candidate.z - (start.z + dz * amount));
};

/** Clearance from `candidate` to the nearest carriageway edge, over every
 * lane in `lanesForClearance` — Cairo's own `laneClearanceAt`, reproduced
 * here because it is file-private there. Checked against the WHOLE map's
 * lanes (not just this junction's own), the same way Cairo's is: a signal
 * head near one junction can still stand inside a different, nearby road's
 * envelope on this dense a network. */
const tokyoLaneClearanceAt = (
  candidate: WorldPoint,
  lanesForClearance: readonly LaneSegment[],
): number =>
  Math.min(
    ...lanesForClearance.map(
      (lane) =>
        Math.min(
          ...lane.centerline
            .slice(1)
            .map((end, index) => tokyoDistanceToSegment(candidate, lane.centerline[index], end)),
        ) -
        lane.widthM / 2,
    ),
  );

/** ~1 m before the stop line, so a driver stopped at the bar still sees the
 * head ahead rather than overhead/behind. */
const TOKYO_SIGNAL_HEAD_SETBACK_M = 1;
/** ~1 m past the arm's own kerb face — the plan's literal "ideal spot". */
const TOKYO_SIGNAL_KERB_CLEARANCE_M = 1;
/** A head may never stand inside a carriageway; matches Cairo's own floor. */
const TOKYO_SIGNAL_LANE_CLEARANCE_M = 0.6;

/**
 * Where a kerbside signal head stands, beside its own arm's stop line, on
 * the near (left-hand) kerb. **Clearance is a veto on the ideal spot here,
 * never something to maximise**: the ideal candidate (1 m before the line,
 * 1 m past THIS arm's own kerb) is tried first, and the search only steps
 * further out when that exact spot would stand inside another road's
 * envelope (Chūō-dōri's wide core meeting a narrow side street, e.g.) —
 * never ranked by "how much clearance," which is how every Cairo head once
 * stood 13-24 m out on open ground (`docs/map-authoring.md`).
 */
function safeTokyoSignalPosition(
  lane: LaneSegment,
  stopDistanceM: number,
  ownSurfaceHalfWidthM: number,
  allLanes: readonly LaneSegment[],
): { readonly position: WorldPoint; readonly headingDeg: number } {
  const headingDeg = laneHeadingAtDistanceDegTokyo(
    lane,
    Math.max(0, stopDistanceM - CONNECTOR_BLEND_RUN_M - 1),
  );
  const rad = (headingDeg * Math.PI) / 180;
  // LEFT-hand normal — the same negated-right-hand convention the stop-sign
  // placement above already established for this left-hand-traffic map.
  const leftX = -Math.cos(rad);
  const leftZ = Math.sin(rad);
  const at = (backM: number, lateralM: number): WorldPoint => {
    const along = lanePointAtDistanceTokyo(lane, Math.max(0, stopDistanceM - backM));
    return point(along.x + leftX * lateralM, along.z + leftZ * lateralM);
  };
  const kerbside = ownSurfaceHalfWidthM + TOKYO_SIGNAL_KERB_CLEARANCE_M;
  for (const backExtraM of [0, 3, 6, 9, 12]) {
    for (const lateralExtraM of [0, 0.9, 1.8]) {
      const candidate = at(TOKYO_SIGNAL_HEAD_SETBACK_M + backExtraM, kerbside + lateralExtraM);
      if (tokyoLaneClearanceAt(candidate, allLanes) >= TOKYO_SIGNAL_LANE_CLEARANCE_M) {
        return { position: candidate, headingDeg };
      }
    }
  }
  return { position: at(TOKYO_SIGNAL_HEAD_SETBACK_M, kerbside), headingDeg };
}

/**
 * Builds one `type: "signal"` control per `TOKYO_SIGNAL_NODE_IDS` entry.
 * Approaches are grouped by ARM — keyed by `${roadId}|${lane.from}`, so a
 * two-way street's opposing directions (different `from`) land on separate
 * stop lines/heads while a multi-lane arm of one direction (same `from`)
 * still shares one — map-authoring.md's "one TrafficControlApproach = one
 * arm, never one road" rule, and the exact grouping key Cairo's own signal
 * generator already proved. `phaseGroup` stays keyed by road (not arm), so
 * opposing arms of the same street still run together in the cycle.
 */
function deriveTokyoSignalControls(
  allLanes: readonly LaneSegment[],
  roadSurfacesById: Map<string, RoadSurface>,
): { readonly controls: readonly TrafficControl[]; readonly zones: readonly ConflictZone[] } {
  const nodePositionById = new Map<string, WorldPoint>();
  for (const node_ of tokyoGenNodeList) nodePositionById.set(node_.id, node_.position);
  for (const node_ of jpNodesList) nodePositionById.set(node_.id, node_.position);

  const controls: TrafficControl[] = [];
  const zones: ConflictZone[] = [];

  for (const nodeId of [...TOKYO_SIGNAL_NODE_IDS].sort()) {
    const position = nodePositionById.get(nodeId);
    if (!position) {
      throw new Error(
        `deriveTokyoSignalControls: "${nodeId}" is not a known node id — check TOKYO_SIGNAL_NODE_IDS for a typo.`,
      );
    }
    const inbound = allLanes.filter((lane) => lane.to === nodeId);
    const byArm = new Map<string, LaneSegment[]>();
    for (const lane of inbound) {
      const armKey = `${lane.roadId}|${lane.from}`;
      byArm.set(armKey, [...(byArm.get(armKey) ?? []), lane]);
    }
    const arms = [...byArm.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (arms.length < 2) {
      throw new Error(
        `deriveTokyoSignalControls: "${nodeId}" has fewer than 2 arms (${arms.length}) — not a real junction, check TOKYO_SIGNAL_NODE_IDS.`,
      );
    }

    const controlId = `jp-gen-signal-${nodeId}`;
    const zoneId = `${controlId}-zone`;
    const arrivingRoadIds = [...new Set(inbound.map((lane) => lane.roadId))];
    const maxSurfaceWidthAtNodeM = Math.max(
      ...arrivingRoadIds.map((roadId) => roadSurfacesById.get(roadId)?.widthM ?? 0),
    );
    // Same formula as the stop generator above: scales against the WIDEST
    // road meeting the node, not just this arm's own, so the stop line
    // itself clears a much wider crossing road before the head is even
    // placed (Chūō-dōri's 13.6 m core over a 7-9 m side street, e.g.).
    const setbackM = Math.max(6, maxSurfaceWidthAtNodeM / 2 + 2.5);

    const approaches: TrafficControlApproach[] = [];
    const installations: TrafficControlInstallation[] = [];
    for (const [, armLanes] of arms) {
      const sortedLanes = [...armLanes].sort((a, b) => a.id.localeCompare(b.id));
      const referenceLane = sortedLanes[0];
      const roadId = referenceLane.roadId;
      const surface = roadSurfacesById.get(roadId);
      const surfaceHalfWidthM = (surface?.widthM ?? referenceLane.widthM * 2) / 2;
      const lengthM = laneLengthOfTokyo(referenceLane);
      const stopDistanceM = Math.max(0, lengthM - setbackM);
      const armSlug = `${roadId}-${referenceLane.from.replace(/^jp-/, "")}`;
      const approachId = `${controlId}-${armSlug}-approach`;

      approaches.push({
        id: approachId,
        laneIds: sortedLanes.map((lane) => lane.id),
        stopLine: { laneId: referenceLane.id, distanceAlongM: stopDistanceM },
        // Opposing arms of the SAME street still run together in the
        // cycle, so the phase group stays keyed by road even though the
        // approach itself is keyed by arm (map-authoring.md).
        phaseGroup: `${controlId}-${roadId}`,
        conflictZoneIds: [zoneId],
      });

      const { position: headPosition, headingDeg } = safeTokyoSignalPosition(
        referenceLane,
        stopDistanceM,
        surfaceHalfWidthM,
        allLanes,
      );
      installations.push({
        id: `${controlId}-${armSlug}-head`,
        position: headPosition,
        headingDeg,
        mounting: "roadside_pole",
        // "nyc_signal" is the plain generic head (dark pole, dark housing,
        // three lenses, no regional decoration) — the ONLY style whose
        // TIMING sequence (green -> amber -> all-red -> red, no red-amber
        // phase) matches Japan's real signal cycle; "uk_signal" would add a
        // red-amber phase Japan does not use, and no "japan_signal" style
        // exists in the type system to add one for (`AuthoredSignalStyle`,
        // `TrafficControlVisualStyle` in types.ts) — confirmed nothing about
        // the "nyc_signal" mesh itself reads as US-specific
        // (render/trafficControlRender.ts only branches visually on
        // "egypt_signal"'s hazard striping).
        style: "nyc_signal",
        role: "primary",
        approachIds: [approachId],
      });
    }

    const half = Math.max(7, maxSurfaceWidthAtNodeM / 2 + 3);
    controls.push(
      control(
        controlId,
        "signal",
        position.x,
        position.z,
        0,
        inbound.map((lane) => lane.id),
        [zoneId],
        approaches,
        installations,
      ),
    );
    zones.push({
      id: zoneId,
      laneIds: [
        ...new Set(
          allLanes
            .filter((lane) => lane.from === nodeId || lane.to === nodeId)
            .map((lane) => lane.id),
        ),
      ],
      polygon: [
        point(position.x - half, position.z - half),
        point(position.x + half, position.z - half),
        point(position.x + half, position.z + half),
        point(position.x - half, position.z + half),
      ],
    });
  }
  return { controls, zones };
}

/**
 * The scramble's extra paint (§9 Phase 5 item 4): four orthogonal crosswalk
 * `road_marking` installations (one per arm, at that arm's own stop line —
 * the existing quarter's `jp-crosswalk-station` precedent for where a
 * marking sits) plus two diagonal crossings rotated across the box, added
 * to the plain 4-arm signal `deriveTokyoSignalControls` already built at
 * `TOKYO_SCRAMBLE_NODE_ID`. Existing installation styles only
 * (`road_marking`/`crosswalk`) — the diagonals are paint, the signal
 * already built above is the law that governs the box; no new sim
 * behaviour, matching the plan's own explicit framing of this item.
 */
function addTokyoScrambleCrosswalks(
  controls: readonly TrafficControl[],
  allLanes: readonly LaneSegment[],
  roadSurfacesById: Map<string, RoadSurface>,
): readonly TrafficControl[] {
  const controlId = `jp-gen-signal-${TOKYO_SCRAMBLE_NODE_ID}`;
  const scramble = controls.find((item) => item.id === controlId);
  if (!scramble) {
    throw new Error(
      `addTokyoScrambleCrosswalks: "${controlId}" not found — TOKYO_SCRAMBLE_NODE_ID must name a real TOKYO_SIGNAL_NODE_IDS entry.`,
    );
  }
  const orthogonal: TrafficControlInstallation[] = scramble.approaches.map((approach) => {
    const lane = allLanes.find((item) => item.id === approach.stopLine.laneId)!;
    const surface = roadSurfacesById.get(lane.roadId);
    const pose = lanePointAtDistanceTokyo(lane, approach.stopLine.distanceAlongM);
    const headingDeg = laneHeadingAtDistanceDegTokyo(
      lane,
      Math.max(0, approach.stopLine.distanceAlongM - CONNECTOR_BLEND_RUN_M - 1),
    );
    return {
      // `approach.id` already carries the controlId + arm-slug prefix.
      id: `${approach.id}-crosswalk`,
      position: pose,
      headingDeg,
      spanM: surface?.widthM ?? lane.widthM * 2,
      mounting: "road_marking",
      style: "crosswalk",
      role: "marking",
      approachIds: [approach.id],
    };
  });
  // Diagonal stripes, corner to corner across the box: Chūō-dōri (N-S) meets
  // Ekimae-dōri (E-W) here, so the two diagonals sit at 45°/135°. Span is the
  // box's own diagonal (hypot of both roads' half-widths, doubled) so the
  // paint reaches from kerb corner to kerb corner rather than stopping
  // mid-box.
  const chuo = roadSurfacesById.get("jp-chuo-dori")!;
  const ekimae = roadSurfacesById.get("jp-eki-mae-dori")!;
  const diagonalSpanM = Math.hypot(chuo.widthM, ekimae.widthM);
  const diagonals: TrafficControlInstallation[] = [45, 135].map((headingDeg, index) => ({
    id: `${controlId}-diagonal-${index + 1}`,
    position: scramble.position,
    headingDeg,
    spanM: diagonalSpanM,
    mounting: "road_marking",
    style: "crosswalk",
    role: "marking",
  }));
  const updated: TrafficControl = {
    ...scramble,
    installations: [...scramble.installations, ...orthogonal, ...diagonals],
  };
  return controls.map((item) => (item.id === controlId ? updated : item));
}

/** The quarter's own carriageways, hoisted so the generated-half machinery
 * (junction control derivation) can look them up by id the same way it looks
 * up generated surfaces. */
const jpQuarterSurfaces: readonly RoadSurface[] = [
  withSidewalk(roadSurface("jp-south-road", [jpNodes.a.position, jpNodes.b.position, jpNodes.c.position], 6.4, ["jp-south-east-1", "jp-south-east-2", "jp-south-west-1", "jp-south-west-2"]), 2.6),
  withSidewalk(roadSurface("jp-east-curve", [jpNodes.c.position, point(102, -56), point(108, -35), jpNodes.d.position], 6.4, ["jp-curve-north", "jp-curve-south"]), 2.4),
  withSidewalk(roadSurface("jp-center-road", [jpNodes.d.position, point(82, 18), jpNodes.e.position, jpNodes.f.position, jpNodes.g.position], 6.4, ["jp-center-west-1", "jp-center-west-2", "jp-center-west-3", "jp-center-east-1", "jp-center-east-2", "jp-center-east-3"]), 2.6),
  withSidewalk(roadSurface("jp-west-road", [jpNodes.g.position, jpNodes.h.position], 6.4, ["jp-west-north", "jp-west-south"]), 2.6),
  withSidewalk(roadSurface("jp-north-road", [jpNodes.h.position, jpNodes.i.position, jpNodes.j.position], 6.4, ["jp-north-east-1", "jp-north-east-2", "jp-north-west-1", "jp-north-west-2"]), 2.6),
  withSidewalk(roadSurface("jp-junction-road", [jpNodes.e.position, point(82, 47), jpNodes.j.position], 6.4, ["jp-junction-south", "jp-junction-north"]), 2.4),
  withSidewalk(roadSurface("jp-narrow-road", [jpNodes.b.position, jpNodes.f.position, jpNodes.i.position], 5.8, ["jp-narrow-north-1", "jp-narrow-north-2", "jp-narrow-south-1", "jp-narrow-south-2"], "shared_space"), 1.4),
  withSidewalk(roadSurface("jp-westhill-road", [jpNodes.h.position, jpNodes.nw2.position], 6.4, ["jp-westhill-north", "jp-westhill-south"]), 2.0),
  withSidewalk(roadSurface("jp-narrowhill-road", [jpNodes.i.position, jpNodes.nm2.position], 5.8, ["jp-narrowhill-north", "jp-narrowhill-south"], "shared_space"), 1.4),
  withSidewalk(roadSurface("jp-easthill-road", [jpNodes.j.position, jpNodes.ne2.position], 6.4, ["jp-easthill-north", "jp-easthill-south"]), 2.0),
  withSidewalk(roadSurface("jp-uptown-road", [jpNodes.nw2.position, jpNodes.nm2.position, jpNodes.ne2.position], 6.4, ["jp-uptown-east-1", "jp-uptown-east-2", "jp-uptown-west-1", "jp-uptown-west-2"]), 2.0),
  withSidewalk(roadSurface("jp-westedge-road", [jpNodes.a.position, jpNodes.g.position], 6.4, ["jp-westedge-north", "jp-westedge-south"]), 2.0),
  withSidewalk(roadSurface("jp-southrow-west", [jpNodes.a.position, jpNodes.sw.position], 6.4, ["jp-southrow-west-w", "jp-southrow-west-e"]), 2.0),
  withSidewalk(roadSurface("jp-centerrow-west", [jpNodes.g.position, jpNodes.cw.position], 6.4, ["jp-centerrow-west-w", "jp-centerrow-west-e"]), 2.0),
  withSidewalk(roadSurface("jp-northrow-west", [jpNodes.h.position, jpNodes.nw.position], 6.4, ["jp-northrow-west-w", "jp-northrow-west-e"]), 2.0),
  withSidewalk(roadSurface("jp-westside-road", [jpNodes.sw.position, jpNodes.cw.position, jpNodes.nw.position], 6.4, ["jp-westside-north-1", "jp-westside-north-2", "jp-westside-south-1", "jp-westside-south-2"]), 2.0),
  withSidewalk(roadSurface("jp-setagaya-dori", [jpNodes.ssW.position, jpNodes.ssM.position, jpNodes.ssE.position], 6.4, ["jp-dori-east-1", "jp-dori-east-2", "jp-dori-west-1", "jp-dori-west-2"], "standard", [roadMarking("jp-dori-centre", "centre_dashed", [jpNodes.ssW.position, jpNodes.ssE.position], "white")]), 3.0),
  withSidewalk(roadSurface("jp-westside-south", [jpNodes.sw.position, jpNodes.ssW.position], 6.4, ["jp-westside-south-north", "jp-westside-south-south"]), 2.0),
  withSidewalk(roadSurface("jp-shrine-road", [jpNodes.b.position, jpNodes.ssM.position], 5.8, ["jp-shrine-north", "jp-shrine-south"], "shared_space"), 1.4),
  withSidewalk(roadSurface("jp-eastside-road", [jpNodes.c.position, jpNodes.ssE.position], 6.4, ["jp-eastside-north", "jp-eastside-south"]), 2.0),
];

/**
 * Builds the whole generated half: raw lanes -> successors -> surfaces ->
 * quarter append-only merge -> junction controls, in that order (each stage
 * depends on the previous one). Called once, at module scope, after every
 * district's specs have been appended to `tokyoRoadSpecs`/
 * `tokyoJunctionConnectors`/`tokyoGenNodeList` below.
 */
function assembleTokyoGeneratedHalf() {
  const { lanes: generatedLanes, rawLanes } = buildTokyoGeneratedNetwork();
  const generatedSurfaces = buildTokyoGeneratedSurfaces(generatedLanes);
  const roadSurfacesById = new Map(
    [...jpQuarterSurfaces, ...generatedSurfaces].map((surface) => [surface.id, surface]),
  );
  const quarterLanesWithNewTurns = withGeneratedSuccessors(jpLanes, rawLanes);
  // A node counts as "touched by a generated lane" (and so gets its junction
  // control derived) iff a raw generated lane has an endpoint there — the
  // quarter's own untouched interior nodes never appear in this set, so
  // their already-shipped control state (or lack of one) is left alone.
  const rawLaneNodeIds = new Set<string>();
  for (const lane of rawLanes) {
    rawLaneNodeIds.add(lane.from);
    rawLaneNodeIds.add(lane.to);
  }
  const allGeneratedHalfLanes = [...quarterLanesWithNewTurns, ...generatedLanes];
  const signalNodeIds = new Set(TOKYO_SIGNAL_NODE_IDS);
  const { controls: stopControls, zones: stopZones } = deriveTokyoJunctionControls(
    allGeneratedHalfLanes,
    roadSurfacesById,
    rawLaneNodeIds,
    signalNodeIds,
  );
  // Signals (Tokyo expansion Phase 5, R10): a separate generator from the
  // stop derivation above (see the comment on `deriveTokyoSignalControls`
  // for why), run over the SAME final lane set so an arm's stop-line
  // distance/head clearance account for every lane on the map, generated
  // and quarter alike. The scramble's extra diagonal paint is added as a
  // post-process once its plain 4-arm signal exists.
  const { controls: signalControls, zones: signalZones } = deriveTokyoSignalControls(
    allGeneratedHalfLanes,
    roadSurfacesById,
  );
  const generatedControls = addTokyoScrambleCrosswalks(
    [...stopControls, ...signalControls],
    allGeneratedHalfLanes,
    roadSurfacesById,
  );
  const generatedZones = [...stopZones, ...signalZones];
  const generatedRoadNames = Object.fromEntries(
    tokyoRoadSpecs.map((spec) => [spec.id, spec.name]),
  );
  return {
    generatedLanes,
    generatedSurfaces,
    quarterLanesWithNewTurns,
    generatedControls,
    generatedZones,
    generatedRoadNames,
  };
}

/** `TOKYO_ROAD_SPECS`/`TOKYO_JUNCTION_CONNECTORS` at their final, exported
 * values — every district section above has already appended to
 * `tokyoRoadSpecs`/`tokyoJunctionConnectors`/`tokyoGenNodeList` by this
 * point in the file. */
export const TOKYO_ROAD_SPECS: readonly TokyoRoadSpec[] = tokyoRoadSpecs;
export const TOKYO_JUNCTION_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = tokyoJunctionConnectors;

const tokyoGeneratedHalf = assembleTokyoGeneratedHalf();

/**
 * Which carriageway side(s) of Tokyo's riverside collectors face the open
 * Sakuragawa — mirrors `CAIRO_OPEN_WATERFRONT_SIDES`'s shape exactly (see
 * `cities/cairo.ts`), consumed by `render/roadsideProps.ts`'s per-map
 * open-sides lookup AND (Tokyo expansion Phase 4) this file's own
 * street-wall generator below, which skips authoring a roadside parcel on
 * whichever side is listed here — the single source of truth for "never
 * wall the river side," not a second hand-maintained table. Both roads run
 * their whole authored centreline northward (ascending z), so the sign is
 * derived once from `generatePromenadeDecor`'s own right-hand `side`
 * convention (outward = `(alongZ*side, -alongX*side)`), not eyeballed:
 * jp-kawate-dori sits west of the river, so its river side is +X (side 1);
 * jp-kawagishi-dori sits east of the river, so its river side is -X
 * (side -1). Decor content itself (which trees/lamps/benches place) stays
 * Cairo-only for now — the plan defers that tuning to Phase 9; Phase 4 gives
 * both roads a real land-side street wall for the first time (before this
 * phase every road here shipped no block at all, on either side).
 *
 * Moved here (was declared just above `TOKYO_FREE_DRIVE`, at the very
 * bottom of this file, in Phase 3) because the street-wall generator below
 * reads it at module-eval time while building `tokyoGeneratedBlocks`, and
 * `TOKYO_MAP_PACK` — which consumes that constant — is declared further
 * down the file than the old position. A `const` cannot be read before its
 * own declaration executes (TDZ); export bindings are not order-sensitive
 * across files, only within this one, so moving it earlier changes nothing
 * for `tokyoWaterfront.test.ts`/`render/roadsideProps.ts`'s own imports.
 */
export const TOKYO_OPEN_WATERFRONT_SIDES: Readonly<Partial<Record<string, readonly (-1 | 1)[]>>> = {
  "jp-kawate-dori": [1],
  "jp-kawagishi-dori": [-1],
};

/** The Sakuragawa (Phase 3, R3) — hoisted so the street-wall generator below
 * can check a candidate parcel against it (§4.5/R18 never wall a waterfront)
 * without duplicating the polygon. Referenced by `TOKYO_MAP_PACK.geometry.
 * waterBodies` below instead of repeating the literal there. */
const TOKYO_WATER_BODIES = [
  {
    id: "jp-sakuragawa",
    color: "#1d2a3d",
    flowHeadingDeg: 180,
    bridgePortalSurfaceIds: ["jp-sakura-ohashi", "jp-kawanaka-bashi", "jp-tsuki-ohashi"],
    polygon: [
      point(612, -1200), point(605, -980), point(618, -760), point(608, -540),
      point(596, -330), point(610, -120), point(622, 80), point(608, 290),
      point(596, 510), point(612, 730), point(626, 960), point(618, 1200),
      point(738, 1200), point(729, 990), point(716, 770), point(702, 540),
      point(716, 310), point(730, 90), point(742, -140), point(725, -360),
      point(712, -580), point(726, -800), point(738, -1010), point(731, -1200),
    ],
  },
] as const;

/** The pre-expansion quarter's three parks — hoisted for the same reason as
 * `TOKYO_WATER_BODIES` above (R18 never walls a park frontage). Phase 6 adds
 * more parks later; this generator only needs to know about the ones that
 * exist NOW, since it only ever runs once, at this module's own load time —
 * a future phase adding a park before a street-wall regeneration would need
 * to add it here too, the same way it would need to re-run any other
 * generator that pre-dates it. Referenced by `TOKYO_MAP_PACK.geometry.
 * landmarks` below instead of repeating the three literals there. */
const TOKYO_QUARTER_PARKS = [
  // The former temple garden covered the live junction. Keep it visible to
  // the east of the street instead of placing it over the asphalt.
  { id: "jp-temple-green", kind: "park", center: point(106, 48), size: point(24, 28), color: "#527b4d" },
  // Gotokuji temple grounds (the maneki-neko cat temple) fill the northern
  // block; the Shoin shrine sits in the southern district.
  { id: "jp-gotokuji-temple", kind: "park", center: point(30, 124), size: point(62, 58), color: "#5b8a52" },
  { id: "jp-shoin-shrine", kind: "park", center: point(-148, -118), size: point(48, 44), color: "#4f7b48" },
] as const;

/**
 * Tokyo expansion Phase 6 (R4): every NEW park, plus the one in-park pond.
 * Hoisted the same way `TOKYO_QUARTER_PARKS` is, and for the same reason —
 * the street-wall generator below reads this array so a candidate parcel
 * that would land on top of one of these is dropped instead of shipped
 * (R18's "never wall a park frontage" exemption), not because these parks
 * grow any generated content of their own.
 *
 * `jp-kawabe-koen` (west-bank riverside promenade, three segments): the
 * corridor between `jp-kawate-dori` (dead straight at x=580 the whole way —
 * confirmed against the live centreline, not the plan's approximate
 * "590,60") and the Sakuragawa's own wobbling west shore is only 8-35 m
 * wide (`TOKYO_WATER_BODIES[0].polygon`'s west run), narrower than
 * `PARK_WALL_MIN_SHORT_SIDE_M` (30) almost everywhere and already dressed
 * by Phase 3's derived corniche parapet along the real shoreline
 * (`shorelineParapetRuns`/`hasPromenadeDressing`, Cairo-and-Tokyo-only,
 * `render/babylonGameSession.ts`) — a `riverside_strip`/`urban_greensward`
 * park here would grow ITS OWN wall along the same water edge (the wall
 * veto only reads roads, never water) and read as a doubled fence right
 * behind the real one. So every segment is `pocket_green` (unwallable, and
 * exactly the style `docs/greenery.md` names for a single-trail-rect-plus-
 * lawn-fillers band), rotated `headingDeg: 90` — pocket_green's own "cross"
 * path always runs along local +x, and at 90° local +x maps to world -z
 * (`toWorld`'s clockwise convention: x = cx + localZ, z = cz - localX*sin +
 * localZ*cos = cz - localX at this angle), so `size.x` becomes the WORLD-Z
 * run and `size.z` the WORLD-X corridor width — the promenade trail comes
 * out running north-south along the bank instead of pocket_green's native
 * road-to-road crossing, with no shared-file path override needed. Verified
 * by direct computation before authoring (not by eyeballing a mesh dump —
 * the exact trap this file's other comments warn about) and re-verified via
 * a teleport screenshot (PR). Three segments rather than one: bridge
 * clearance at Kawanaka-bashi (z=180, a real crossing here — the water-body
 * portal list opens for it) splits the run, and the shore's own bulge near
 * z=80 (the polygon's widest point, x=622) lets segment b run a bit wider
 * than a/c while every west edge stays flush on jp-kawate-dori's own
 * carriageway edge (x=584, so the lawn tucks under the pavement band with
 * no fringe, same convention every other city's kerb-flush park uses) and
 * every east edge keeps >=4 m clear of the true shoreline (sampled every
 * 5 m along each segment, corners checked against the water polygon
 * directly — see the Phase 6 scratchpad audit referenced in the PR).
 * Segments butt-join at z=-50 and z=60 with identical headings (a true
 * zero-seam join along the shared edge) and step their outer (river) edge
 * in and out following the bank, per `docs/greenery.md`'s "curve is hugged
 * by stepping axis-aligned tiles" guidance. `pathFurniture` never emits
 * seating for `pocket_green` (no wall, no furniture pass), so the plan's
 * "benches facing the water" are hand-placed in `parkLayouts.ts`'s
 * `bespokeFeatures` (id-keyed on "kawabe", the same pattern Cairo's Opera
 * Grounds and NYC's Joan of Arc already use).
 */
const TOKYO_PHASE6_PARKS = [
  { id: "jp-kawabe-koen-a", kind: "park", center: point(594, -100), size: point(100, 20), headingDeg: 90, parkStyle: "pocket_green", color: "#4d7a5e" },
  { id: "jp-kawabe-koen-b", kind: "park", center: point(596.5, 5), size: point(110, 25), headingDeg: 90, parkStyle: "pocket_green", color: "#4d7a5e" },
  { id: "jp-kawabe-koen-c", kind: "park", center: point(596.5, 105), size: point(90, 25), headingDeg: 90, parkStyle: "pocket_green", color: "#4d7a5e" },
  // Civic plaza around where Phase 8's Hikari Tower landmark will stand
  // (plan's own (1020,140) shifted east to (1053,140) — `jp-higashi-hondori`
  // runs dead straight at x=980, and the plan's number sat the plaza's own
  // interior 25 m across that carriageway, which is a bisection the plan
  // never called for; centring on the real bridge landing keeps the road as
  // a clean west boundary instead). Explicit `civic_plaza`: the id has no
  // "plaza" substring for `resolveParkStyle` to key on, and civic_plaza is
  // also the one style whose scatter/lawn clip a crossing road automatically
  // (`style === "civic_plaza"` in `buildParkLayout`) — moot here since
  // nothing actually crosses the interior (verified directly: no road
  // centreline sample lands >2 m inside this rect), but authoring the style
  // rather than relying on the id substring keeps the "why plaza" reasoning
  // explicit for Phase 8, which builds the tower directly on this ground.
  { id: "jp-tower-park", kind: "park", parkStyle: "civic_plaza", center: point(1053, 140), size: point(126, 100), color: "#4a6b52" },
  // Kitazawa-kōen: the whole Fujimi-dōri x Suzukake-dōri x Suzukake-Yokochō x
  // Sangen-dōri cell in Miyanosaka North, the same "own the full null-zoned
  // cell" move NYC's Queensbridge Green makes — smaller than the plan's
  // suggested 150x120 (nothing crosses the quarter-mile gap east of
  // Sangen-dōri that the plan's original (-350,640) sat in; there is no
  // road within 90 m of that point, so a park there would float with no
  // frontage at all). Sized to each bounding road's own PAVEMENT edge, not
  // its centreline (roadWidthM/2 + sidewalkWidthM out from each of the four
  // — 5.1/7.4/5.4/5.7 m on the yokochō/Sangen/Fujimi/Suzukake sides
  // respectively — plus 0.5 m of margin): landing the rect ON a
  // centreline instead (this file's first draft) put every
  // `wallsFollowRoadEdges` wall inside its own road's clearance band on
  // all four sides at once, and `parkPerimeterPlan` vetoed the whole
  // perimeter down to zero runs (`tests/parkLayouts.test.ts` caught it —
  // "walls the big parks..." expected >0 and got 0). `wallsFollowRoadEdges`
  // itself is still needed: tucked this close, the blanket 1.8 m veto would
  // otherwise delete every wall regardless (the London royal-park bug
  // `docs/greenery.md` documents). Depth trimmed from the pavement-edge
  // figure (89 m) to 78 m — `npcTurnSmoothness`-style headroom, not a road
  // constraint: `urban_greensward`'s wandering spine samples a fixed 3
  // sine oscillations across the long (here, x) side, and at 106x87 the
  // curve's own steepest point landed at an 8.1 deg corner, just past
  // `tests/parkLayouts.test.ts`'s 8 deg "smooth at driving scale" limit — a
  // property of this park's specific proportions relative to that fixed
  // 3-oscillation sampling, not of anything Tokyo-specific. Shrinking the
  // short side (the pond and its lawn have no need for the extra 9-17 m,
  // and it costs the wall clearance nothing — see the pond's own
  // clearance-from-park-edge margin below) drops the worst corner under
  // 7 deg with real headroom instead of landing on the limit's other side.
  { id: "jp-kitazawa-koen", kind: "park", center: point(-521, 800), size: point(106, 78), wallsFollowRoadEdges: true, color: "#517d4c" },
  // Minami-kōen: the Ayame-dōri x Yanagi-dōri x Yanagi-Yokochō x Sangen-dōri
  // cell in Yamashita South — the same "own the whole short-segment cell"
  // reasoning as Kitazawa-kōen above (the plan's 90x70 would have left a
  // 30+ m orphan sliver of the displaced Sangen-dōri frontage block on
  // whichever side it didn't cover), and the same pavement-edge-not-
  // centreline sizing (this web's four bounding roads carry the identical
  // widths/sidewalks as Kitazawa-kōen's, so the same four pullbacks apply).
  { id: "jp-minami-koen", kind: "park", center: point(-521, -1005), size: point(106, 58), wallsFollowRoadEdges: true, color: "#4f7b48" },
  // Five pocket greens (R4's smallest scale), each sized and centred to
  // fully replace one SHORT existing street-wall parcel (<=30 m along the
  // road) rather than carving into a long one — the generator can only trim
  // a candidate parcel from its two ends, so overlapping the MIDDLE of a
  // long parcel drops the whole thing (checked directly per site; see the
  // Phase 6 scratchpad audit in the PR). Depth (24 m, the short side —
  // `resolveParkStyle` derives `pocket_green` under 30 automatically, no
  // override needed) faces its road; length matches the displaced parcel's
  // own span so nothing is orphaned. Spread across three of the four webs
  // this phase's road network actually reaches (Miyanosaka North, Yamashita
  // South x2, the Nishi-Kanjō-dōri corridor at the Nishi boundary, and
  // Nishi's own Hato-Yokochō) rather than clustering on one road.
  { id: "jp-asahi-pocket-green", kind: "park", center: point(-677.7, 625), size: point(24, 26), color: "#557f52" },
  { id: "jp-nishikanjo-yamashita-pocket-green", kind: "park", center: point(-1179.2, -935), size: point(24, 26), color: "#557f52" },
  { id: "jp-kanpachi-yamashita-pocket-green", kind: "park", center: point(-677.7, -1005), size: point(24, 26), color: "#557f52" },
  { id: "jp-nishikanjo-nishi-pocket-green", kind: "park", center: point(-1179.2, -134), size: point(24, 26), color: "#557f52" },
  { id: "jp-hato-pocket-green", kind: "park", center: point(-560.3, 20), size: point(24, 30), color: "#557f52" },
] as const;

/**
 * Kitazawa-kōen's pond (R4 "with a pond"): no `flowHeadingDeg`, which is
 * what makes this a pond rather than a river (`docs/rendering.md`,
 * `docs/greenery.md`) — shoreline colliders, the minimap and the park's own
 * planting keep-out all come free from `WaterBody` membership
 * (`parkLayoutForLandmark` maps every `geometry.waterBodies` polygon into
 * every park's `waterPolygons` context, not just the one it geometrically
 * sits inside). No `bridgePortalSurfaceIds`: nothing crosses it. The boat-
 * placement gate (`generateWaterBoatPlacements`, `render/waterLayer.ts`) is
 * `resolveMapVisualKey(mapId) === "cairo"` — an exact-string, whole-map
 * check, not per-body — so a second Tokyo water body does not need a second
 * verification; re-read directly against this file's own gate for Phase 6
 * rather than assumed unchanged from Phase 3's finding.
 */
const TOKYO_PHASE6_WATER_BODIES = [
  {
    id: "jp-kitazawa-pond",
    color: "#243a30",
    polygon: [
      point(-560, 790), point(-555, 777), point(-544, 771), point(-531, 772),
      point(-521, 780), point(-520, 790), point(-521, 800), point(-531, 808),
      point(-544, 809), point(-555, 803),
    ],
  },
] as const;

/**
 * True when a candidate parcel genuinely overlaps a park or has any corner
 * inside the river polygon — the same separating-axis and point-in-polygon
 * tests `tests/content.test.ts`'s "keeps every authored block out of every
 * park and out of the water" gate independently re-derives, reproduced here
 * so the generator can honour R18's own exemption ("never wall off... a
 * park frontage") as a filter instead of shipping a violation for a human to
 * notice later. A couple of downtown-adjacent streets (Shotengai Nishi-dori,
 * in particular, which runs along the quarter's own x=150 line) pass close
 * enough to `jp-temple-green` that a segment's raw candidate parcel lands
 * partly on top of it — dropping that one (segment, side) is the CORRECT
 * outcome per R18, not a bug to route around: the park itself is the
 * content behind that stretch of kerb, which is exactly what the bare-kerb
 * gate's own "backed by open ground" exemption expects to find there.
 */
function tokyoBlockOverlapsParkOrWater(
  block: ProceduralBlock,
  parks: readonly { readonly center: WorldPoint; readonly size: WorldPoint; readonly headingDeg?: number }[],
  waterBodies: readonly { readonly polygon: readonly WorldPoint[] }[],
): boolean {
  const yawRad = ((block.headingDeg ?? 0) * Math.PI) / 180;
  const box = {
    x: block.center.x,
    z: block.center.z,
    ux: Math.cos(yawRad),
    uz: -Math.sin(yawRad),
    halfU: block.size.x / 2,
    halfV: block.size.z / 2,
  };
  const extentOn = (b: typeof box, axis: { readonly x: number; readonly z: number }): number =>
    Math.abs(b.ux * axis.x + b.uz * axis.z) * b.halfU + Math.abs(-b.uz * axis.x + b.ux * axis.z) * b.halfV;
  for (const park of parks) {
    const parkYawRad = ((park.headingDeg ?? 0) * Math.PI) / 180;
    // Same park-local-axis convention as content.test.ts's own check: a
    // park's local +x (its `size.x`/width) runs along world (sin, cos).
    const parkBox = {
      x: park.center.x,
      z: park.center.z,
      ux: Math.sin(parkYawRad),
      uz: Math.cos(parkYawRad),
      halfU: park.size.z / 2,
      halfV: park.size.x / 2,
    };
    const axes = [
      { x: box.ux, z: box.uz },
      { x: -box.uz, z: box.ux },
      { x: parkBox.ux, z: parkBox.uz },
      { x: -parkBox.uz, z: parkBox.ux },
    ];
    const overlapM = Math.min(
      ...axes.map((axis) => {
        const centreGapM = Math.abs((parkBox.x - box.x) * axis.x + (parkBox.z - box.z) * axis.z);
        return extentOn(box, axis) + extentOn(parkBox, axis) - centreGapM;
      }),
    );
    if (overlapM > 0) return true;
  }
  const corners = [
    { u: box.halfU, v: box.halfV },
    { u: -box.halfU, v: box.halfV },
    { u: -box.halfU, v: -box.halfV },
    { u: box.halfU, v: -box.halfV },
  ].map(({ u, v }) => ({ x: box.x + box.ux * u + box.uz * v, z: box.z + box.uz * u - box.ux * v }));
  for (const water of waterBodies) {
    const inside = corners.some((corner) => {
      let contained = false;
      const poly = water.polygon;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (
          poly[i].z > corner.z !== poly[j].z > corner.z &&
          corner.x < ((poly[j].x - poly[i].x) * (corner.z - poly[i].z)) / (poly[j].z - poly[i].z) + poly[i].x
        ) {
          contained = !contained;
        }
      }
      return contained;
    });
    if (inside) return true;
  }
  return false;
}

// =============================================================================
// Street wall (Tokyo expansion Phase 4, R18; `buildingSet` wiring added by
// the Tokyo authenticity plan's P2 and P3b): a roadside parcel behind both kerbs of
// every generated road, so no generated street reads as bare asphalt with
// grey nothing behind it. Every generator zone now names a glb set
// (`tokyoRoadsideBuildingSet` below): `tokyo-house` for miyanosaka/
// yamashita/nishi, `tokyo-shotengai` for `jp-nakamise-yokocho` alone,
// `tokyo-zakkyo` for the rest of downtown plus `ring`, `tokyo-manshon` for
// `riverside`/`higashi`. What still ships plain procedural-facade
// (`{material, heightRange, density}`, no `buildingSet`/`streetEdges`) is
// only the ~1-in-4 holdback parcels (`tokyoParcelKeepsFacadeBoxes`) plus the
// 9 hand-authored quarter blocks this generator never touches.
//
// `tokyoRoadsideParcel` itself is this file's own copy of London's
// file-private `roadsideParcel` (`cities/london.ts`, search that name) —
// cloned rather than imported (it is not exported there, and Tokyo's own
// foreign-road universe differs), with the `buildingSetFor` branch dropped
// entirely since it is always a no-op INSIDE THIS FUNCTION: a placed
// candidate's `buildingSet`/`streetEdges` are attached by its caller
// (`tokyoRoadsideCandidate`, below `tokyoDepthJitterM`), never by this
// trimmer, which only ever shapes a plain procedural rect. Algorithm,
// verbatim from London: `side` is the sign of the road's RIGHT-HAND normal
// travelling `from`->`to` (+1 = driver's right), NOT a compass reading —
// get this backwards and parcels ship on the wrong kerb, the same class of
// bug as venues shipping on the wrong side (`docs/map-authoring.md`).
// Length is DERIVED, not authored: a parcel starts as long as its road
// segment (minus a 12 m inset each end) and the end nearer each violation
// retreats a metre at a time — never symmetric — until clear of every OTHER
// road's carriageway+pavement+0.7 m clearance, tested by real
// segment-to-span distance (corner-only checks miss a parcel whose long
// side straddles a crossing road with both corners clear). A parcel that
// cannot keep `TOKYO_MIN_PARCEL_HALF_LENGTH_M` (13, so a 26 m floor after
// the two 12 m end insets — an authored span under ~50 m ships NOTHING) is
// dropped rather than shipped as a slab in the road.
// =============================================================================

/**
 * Clearance between a carriageway centreline and the near edge of the parcel
 * beside it — identical formula and identical justification to London's own
 * `blockInsetFor` (`cities/london.ts`): half the road width clears the
 * carriageway itself, `+4.8` clears the whole walkable pavement band below
 * (`buildPavementGraph`'s rail at half-width+1.7, `staticColliders.test.ts`'s
 * sample at half-width+3.0 plus 0.3 m more) while staying inside
 * `generateStreetAddresses`'s 22 m frontage-probe reach above. Not
 * Tokyo-specific data — a geometry constant tuned against the shared
 * pavement-graph/address-probe formulas every city reads — and safe to
 * reuse unchanged: every Tokyo road's authored `sidewalkWidthM` (Phase 1,
 * §4.3) is narrower than or equal to London's own widest (the shared
 * `PAVED_SIDEWALK_WIDTH_M` default, 3.4 m), which is what "sits comfortably
 * inside both, on every width London authors" was already tuned against.
 */
const tokyoBlockInsetFor = (roadWidthM: number): number => roadWidthM / 2 + 4.8;

/** Distance a parcel corner must keep from any road it does not belong to —
 * same value and rationale as London's `PARCEL_FOREIGN_ROAD_CLEARANCE_M`. */
const TOKYO_PARCEL_FOREIGN_ROAD_CLEARANCE_M = 0.7;
/** Never trim a parcel to less than this, or drop it entirely — same value
 * as London's `MIN_PARCEL_HALF_LENGTH_M`. */
const TOKYO_MIN_PARCEL_HALF_LENGTH_M = 13;

const tokyoRoadsideParcel = (
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
  /** Every road surface on the map (quarter + generated; this road included
   * — filtered out below) — the foreign-road universe the trimmer clears
   * against. Passed explicitly (not closed over a module-level constant the
   * way London's own copy does) because it is only fully assembled once
   * `tokyoGeneratedHalf` exists. */
  allSurfaces: readonly RoadSurface[],
  extraInsetM = 0,
  addressable = true,
): ProceduralBlock | null => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const rightX = uz;
  const rightZ = -ux;
  const offset = tokyoBlockInsetFor(roadWidthM) + extraInsetM + depthM / 2;
  const centerX = (from.x + to.x) / 2 + rightX * side * offset;
  const centerZ = (from.z + to.z) / 2 + rightZ * side * offset;
  const foreign = allSurfaces
    .filter((surface) => surface.id !== roadId)
    .map((surface) => ({
      centerline: surface.centerline,
      reach:
        surface.widthM / 2 +
        (surface.sidewalkWidthM ?? PAVED_SIDEWALK_WIDTH_M) +
        TOKYO_PARCEL_FOREIGN_ROAD_CLEARANCE_M,
    }));
  /**
   * Distance from a road segment to the parcel span [lo, hi] x +/-depth/2,
   * all in the parcel's own frame (u along the road from the segment
   * midpoint), plus the u of the contact so the caller knows WHICH end to
   * trim — identical to London's own `segmentToSpan`.
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
      // Separating-axis test on the segment's own normal.
      const mid = (lo + hi) / 2;
      const halfLength = (hi - lo) / 2;
      const normalLength = Math.hypot(du, dv);
      if (normalLength > 1e-9) {
        const nu = dv / normalLength;
        const nv = -du / normalLength;
        const offsetAlongNormal = (first.u - mid) * nu + first.v * nv;
        const spread = Math.abs(nu) * halfLength + Math.abs(nv) * halfDepth;
        if (Math.abs(offsetAlongNormal) <= spread) {
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
  while (hi - lo >= TOKYO_MIN_PARCEL_HALF_LENGTH_M * 2 && guard++ < 2048) {
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
        ...(addressable ? {} : { addressable }),
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

/**
 * Which authored district style a generated road's parcels draw from (§8.8
 * of the plan) — the compact district table this file actually built, not
 * the plan's own pre-implementation approximation. Lifted straight off the
 * road tables already authored above (`TOKYO_MIYANOSAKA_SPECS` et al.) plus
 * a handful of explicit id lists for the skeleton/east-bank roads that mix
 * flavours within one array. A road missing from every list here throws at
 * block-build time (`tokyoStyleForRoad`) rather than silently shipping no
 * street wall — the plan's own risk-register item 4 ("an authored span
 * under ~50 m ships nothing silently") is an acceptable risk for one
 * skipped SEGMENT; it must never be a silent risk for an entire road
 * omitted from this table by mistake.
 */
export type TokyoBlockZone =
  | "miyanosaka"
  | "yamashita"
  | "nishi"
  | "ekimae-nishi"
  | "hanamizu"
  | "sumiregaoka"
  | "minamimachi"
  | "kawabata"
  | "higashi"
  | "ring"
  | "riverside"
  | "downtown";

interface TokyoZoneStyle {
  /** Two facade materials this zone alternates between (deterministically,
   * by segment/side id — see `buildTokyoGeneratedBlocks`), so a long run of
   * parcels does not read as one repeated texture. Both keys must be real
   * entries in `ProceduralFacades`' `BUILDING_PALETTE`
   * (`render/proceduralFacades.ts`) — `plaster`/`tile`/`wood-plaster`/
   * `concrete` all already are; there is no `"glass"` key in that palette
   * (checked directly — only the London-specific `london-glass-curtain`
   * exists), so downtown towers use `tile`, which already reads as a cool
   * modern cladding at night under this map's cool-blue bloom (§8.1)
   * without adding a new shared material this phase does not need. */
  readonly materials: readonly [string, string];
  readonly heightRange: readonly [number, number];
  readonly density: number;
  /** Base parcel depth in metres; `tokyoDepthJitterM` adds a small per-parcel
   * +/-2 m so a long straight run does not read as one identical slab. */
  readonly depthM: number;
}

// Phase 10 perf remediation: `density` here is `facadeGridCells`'s
// grid-resolution knob, not a fill fraction — `count = round(3+density*7)`,
// tiled `columns = ceil(sqrt(count))` across the frontage by
// `rows = ceil(count/columns)` deep into the block, one `createFacadeBox`
// mesh (own draw call, never merged/instanced) per cell. Every zone sat at a
// uniform 3x3 grid (count 8-9 across the whole 0.66-0.85 range) before this
// pass. The naive fix — cut every zone into the 0.3-0.4 band so `columns`
// holds at 3 (same street-facing building count) while `rows` drops to 2 —
// was tried first and reverted for the three purely-residential webs below:
// `tests/tokyoContent.test.ts`'s per-district walled-kerb floor dropped
// miyanosaka to 70.1% (floor 85%) and yamashita to 63.0%, because that test's
// coverage metric is NOT "what the camera sees from the road" (rows 1-2 are
// genuinely behind row 0 with no lateral gap) — it is whether ANY row's
// building covers a given frontage position at all, and rows 1-2's
// independently-jittered widths were plugging real gaps row 0's own
// 58-82%-of-cell-width jitter leaves. Reverted to original density for the
// zones nowhere near the scramble (no perf benefit from cutting them
// anyway); kept the cut only for `downtown`, `ring` and `riverside`, whose
// roads (`jp-chuo-dori-north` is `ring`, `jp-kawate-dori`/`jp-kawagishi-dori`
// are `riverside`) a live active-mesh dump at the Chuo-dori x Ekimae-dori
// scramble (`__sideswapActiveMeshNames`, Phase 10 investigation) confirmed
// were still drawing full 8-cell blocks inside the same 440 m night-fog
// bubble as the scramble itself. `ring`/`riverside` land one notch less
// aggressive than `downtown` (`count=6` not `5`) for coverage-floor margin —
// their floors (0.7/0.8) are already the map's tightest. See the PR body for
// the before/after draw-call numbers this bought back.
const TOKYO_ZONE_STYLE: Readonly<Record<TokyoBlockZone, TokyoZoneStyle>> = {
  // Low-rise residential webs (§8.8): "GAPPY IS FORBIDDEN at the kerb" —
  // wood-plaster/plaster, short, dense enough to read as a real
  // neighbourhood at 30 km/h. Original density: nowhere near the scramble's
  // fog bubble, so the Phase 10 perf cut above bought nothing here and cost
  // real coverage-floor margin (see the comment above) — reverted.
  miyanosaka: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  yamashita: { materials: ["wood-plaster", "plaster"], heightRange: [5, 13], density: 0.85, depthM: 30 },
  nishi: { materials: ["plaster", "wood-plaster"], heightRange: [5, 13], density: 0.66, depthM: 28 },
  // Ekimae-nishi (Tokyo authenticity plan P4, Region B): the residential
  // local + both N-S connectors read exactly like miyanosaka's own numbers —
  // clone-of-miyanosaka is the plan's own general rule (§6.2) for a
  // "pure-residential web," and this district is outside the scramble's fog
  // bubble the same way miyanosaka is, so there is no perf reason to cut it
  // either. The shopping street itself (`jp-ekimae-nishi-dori`) overrides
  // this below (`TOKYO_ROAD_STYLE_OVERRIDE`), mirroring how `jp-chuo-dori`
  // overrides `downtown`'s own base.
  "ekimae-nishi": { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  // Hanamizu (Tokyo authenticity plan P5, Region A): a pure-residential web
  // like miyanosaka/yamashita/ekimae-nishi, nowhere near the scramble's fog
  // bubble — clone of miyanosaka's own numbers verbatim, per the plan's own
  // general rule (§6.2) and this phase's own brief ("not the Phase-10-cut
  // lower densities since this web is nowhere near the scramble's fog
  // bubble").
  hanamizu: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  // Sumiregaoka (Tokyo authenticity plan P6, Region C): the biggest single
  // web shipped so far, still a pure-residential clone of miyanosaka's own
  // numbers verbatim, per the plan's own general rule (§6.2) — this web is
  // also nowhere near the scramble's fog bubble, so the Phase 10 cut buys
  // nothing here either.
  sumiregaoka: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  // Minamimachi (Tokyo authenticity plan P7, Region D): the plan's own first
  // Tokyo services district, still a pure-residential clone of miyanosaka's
  // own numbers verbatim, per the plan's own general rule (§6.2) — this web
  // is also nowhere near the scramble's fog bubble, so the Phase 10 cut buys
  // nothing here either.
  minamimachi: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  // Kawabata (Tokyo authenticity plan P8, Region F): low residential, still a
  // pure-residential clone of miyanosaka's own numbers verbatim, per the
  // plan's own general rule (§6.2) — this web sits 90+ m inland of the
  // Sakuragawa (measured against TOKYO_WATER_BODIES, not eyeballed) and well
  // outside the scramble's fog bubble, so the Phase 10 cut buys nothing here
  // either. (Region E reuses the existing `nishi` zone outright rather than
  // minting a new one — it is this web's own direct southward continuation,
  // between the same two rings — so it needs no entry of its own here.)
  kawabata: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.85, depthM: 30 },
  // East bank: mixed mid-rise per §8.8. Original density — also far from the
  // scramble; reverted for the same reason as the three webs above.
  higashi: { materials: ["plaster", "concrete"], heightRange: [8, 22], density: 0.75, depthM: 32 },
  // The three N-S ring roads, the two E-W closers, and the Setagaya-dori/
  // Koshu-kaido/Minami-kaido arterials: wider carriageways threading through
  // (and between) the residential webs — a notch taller/denser than a pure
  // residential local, still low-rise. `jp-chuo-dori-north` (this zone) runs
  // straight through the scramble's own fog bubble, so this one keeps the
  // Phase 10 cut (`count=6`, one notch lighter than downtown's `count=5` for
  // this zone's own tighter 70% coverage floor).
  ring: { materials: ["plaster", "tile"], heightRange: [6, 16], density: 0.4, depthM: 34 },
  // Land side only — the river side is skipped entirely via
  // TOKYO_OPEN_WATERFRONT_SIDES. A mid-rise band reading as
  // riverside-adjacent, one notch shorter than the downtown core proper.
  // `jp-kawate-dori` sits ~150-200 m east of the scramble, inside its fog
  // bubble — keeps the Phase 10 cut for the same reason `ring` does.
  riverside: { materials: ["tile", "plaster"], heightRange: [9, 21], density: 0.4, depthM: 34 },
  // Sakuragawa Downtown: the neon core, tall blocks (§8.8). jp-chuo-dori
  // itself overrides taller still (TOKYO_ROAD_STYLE_OVERRIDE below) — the
  // other downtown streets carry this base.
  //
  // Phase 10 perf remediation: `density` here is not a fill fraction, it is
  // `facadeGridCells`'s grid-resolution knob — `count = round(3 + density*7)`,
  // tiled `columns = ceil(sqrt(count))` across the frontage by
  // `rows = ceil(count/columns)` deep into the block. Every cell becomes its
  // own `createFacadeBox` mesh (`render/proceduralFacades.ts`), never merged
  // or instanced, so it is one GPU draw call per cell. At the old 0.8-0.85
  // downtown range that grid was 3x3 (rows=3): only row 0 fronts the street,
  // rows 1-2 sit directly behind it with zero lateral gap and are therefore
  // fully occluded from every road-facing camera angle on that block's own
  // frontage — pure draw-call cost with no visible benefit. 0.32-0.35 keeps
  // `count` at 5 (`columns` stays 3, so the street-facing row is UNCHANGED —
  // same building count/variety at the kerb) while dropping to `rows=2`,
  // cutting roughly 40% of downtown's procedural building count map-wide.
  // Measured at the Chuo-dori x Ekimae-dori scramble (the plan's own §8.11
  // dense-street gate pose): see the Phase 10 PR body for the exact
  // before/after draw-call numbers this bought back.
  downtown: { materials: ["tile", "plaster"], heightRange: [11, 27], density: 0.32, depthM: 36 },
};

/** Per-road deviations from its zone's base style — a handful of specific
 * streets that read better with their own numbers than their zone's shared
 * default (mirrors London's per-call-site hand-tuning, at the scale of one
 * override per interesting road instead of one per parcel). Every downtown
 * entry's `density` was pulled down alongside the zone default above in the
 * Phase 10 perf pass (same row-cutting reasoning, same `count=5`/`rows=2`
 * target) — `jp-chuo-dori` keeps a nominally higher figure than its
 * downtown neighbours to preserve the "tallest, densest street" ordering,
 * though both land in the same grid outcome. */
const TOKYO_ROAD_STYLE_OVERRIDE: Readonly<Partial<Record<string, Partial<TokyoZoneStyle>>>> = {
  // The 4-lane core: the tallest, densest street on the map, up to the
  // plan's own suggested [18,42] near the scramble.
  "jp-chuo-dori": { heightRange: [18, 42], density: 0.35, depthM: 40 },
  // The shotengai: a shared-space alley wants low, tight, densely-packed
  // shophouses, not office-block height — a deliberately different read
  // from its downtown neighbours despite sharing the zone.
  "jp-nakamise-yokocho": { materials: ["wood-plaster", "tile"], heightRange: [5, 11], density: 0.32, depthM: 18 },
  // Ekimae-nishi's own shopping street (Tokyo authenticity plan P4): the
  // SAME shophouse read as the shotengai above — mirrors its numbers almost
  // exactly (a normal carriageway, not a shared-space alley, so the depth is
  // a touch deeper) — per plan §6.2's "one road within a zone gets a
  // different set" pattern (see `tokyoRoadsideBuildingSet` below).
  "jp-ekimae-nishi-dori": { materials: ["wood-plaster", "tile"], heightRange: [5, 11], density: 0.32, depthM: 20 },
  // Quarter<->downtown connectors: transitional height between the old
  // neighbourhood's low-rise and the downtown core proper.
  "jp-shotengai-nishi-dori": { heightRange: [6, 15], density: 0.32, depthM: 28 },
  "jp-uptown-higashi": { heightRange: [6, 14], density: 0.32, depthM: 26 },
  "jp-chuo-dori-south": { heightRange: [9, 19], density: 0.32, depthM: 30 },
  "jp-eki-mae-dori": { heightRange: [10, 22], density: 0.32, depthM: 32 },
};

const TOKYO_RING_ROAD_IDS: readonly string[] = [
  "jp-nishi-kanjo-dori",
  "jp-kanpachi-dori",
  "jp-sangen-dori",
  "jp-yamashita-minami-dori",
  "jp-miyanosaka-kita-dori",
  "jp-setagaya-dori-west",
  "jp-setagaya-dori-east",
  "jp-koshu-kaido",
  "jp-minami-kaido",
  "jp-chuo-dori-north",
];
const TOKYO_DOWNTOWN_ROAD_IDS: readonly string[] = [
  "jp-chuo-dori",
  "jp-chuo-dori-south",
  "jp-eki-mae-dori",
  "jp-ichiban-dori",
  "jp-niban-dori",
  "jp-minami-dori",
  "jp-kita-dori",
  "jp-nakamise-yokocho",
  "jp-shotengai-nishi-dori",
  "jp-uptown-higashi",
];
const TOKYO_RIVERSIDE_ROAD_IDS: readonly string[] = ["jp-kawate-dori", "jp-kawagishi-dori"];
const TOKYO_HIGASHI_WEB_ROAD_IDS: readonly string[] = [
  "jp-higashi-dori",
  "jp-koshu-kaido-higashi",
  "jp-higashi-hondori",
  "jp-higashi-soto-dori",
  "jp-higashi-minami-dori",
  "jp-higashi-kita-dori",
  "jp-tofu-yokocho",
  "jp-fuji-dori",
  "jp-keyaki-dori",
];

const TOKYO_ZONE_ENTRIES: readonly (readonly [string, TokyoBlockZone])[] = [
  ...TOKYO_MIYANOSAKA_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "miyanosaka"]),
  ...TOKYO_YAMASHITA_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "yamashita"]),
  ...TOKYO_NISHI_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "nishi"]),
  ...TOKYO_EKIMAE_NISHI_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "ekimae-nishi"]),
  ...TOKYO_HANAMIZU_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "hanamizu"]),
  ...TOKYO_SUMIREGAOKA_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "sumiregaoka"]),
  ...TOKYO_MINAMIMACHI_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "minamimachi"]),
  // Region E (Tokyo authenticity plan P8) reuses the existing `nishi` zone —
  // this web is that web's own direct southward continuation between the
  // same two rings, not a new district.
  ...TOKYO_NISHI_MINAMI_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "nishi"]),
  ...TOKYO_KAWABATA_SPECS.map((spec): readonly [string, TokyoBlockZone] => [spec.id, "kawabata"]),
  ...TOKYO_HIGASHI_WEB_ROAD_IDS.map((id): readonly [string, TokyoBlockZone] => [id, "higashi"]),
  ...TOKYO_RIVERSIDE_ROAD_IDS.map((id): readonly [string, TokyoBlockZone] => [id, "riverside"]),
  ...TOKYO_DOWNTOWN_ROAD_IDS.map((id): readonly [string, TokyoBlockZone] => [id, "downtown"]),
  ...TOKYO_RING_ROAD_IDS.map((id): readonly [string, TokyoBlockZone] => [id, "ring"]),
];
/** Exported for `tests/tokyoContent.test.ts`'s per-district walled-kerb-floor
 * check — the single source of truth for "which district is this road in,"
 * so that test's districting can never quietly drift from what this file
 * actually built (the trap a hand-duplicated second table would risk). */
export const TOKYO_ZONE_FOR_ROAD: Readonly<Record<string, TokyoBlockZone>> = Object.fromEntries(TOKYO_ZONE_ENTRIES);

const tokyoStyleForRoad = (roadId: string): TokyoZoneStyle => {
  const zone = TOKYO_ZONE_FOR_ROAD[roadId];
  if (!zone) {
    throw new Error(
      `tokyoStyleForRoad: "${roadId}" is not a bridge and has no zone in TOKYO_ZONE_FOR_ROAD — ` +
        "every generated road must resolve to a zone or be listed in TOKYO_BRIDGE_ROAD_IDS explicitly, " +
        "or it silently ships no street wall.",
    );
  }
  return { ...TOKYO_ZONE_STYLE[zone], ...TOKYO_ROAD_STYLE_OVERRIDE[roadId] };
};

/** Bridges get no roadside parcels at all: a bridge span's own long axis
 * crosses the water, so offsetting a parcel laterally from its centreline
 * still lands the parcel in (or over) the Sakuragawa — the same "the
 * trimmer measures roads, not water" trap `docs/map-authoring.md` documents
 * for a parcel running ALONGSIDE a river, except here it is the road's own
 * long axis doing the crossing. The streets meeting each bridgehead
 * (downtown's own roads on the west bank, Higashi-dori/Koshu-kaido-higashi
 * on the east) already carry the bridgehead's frontage right up to their
 * own 12 m end inset — bridges are dressed separately anyway (parapets,
 * lamps, the Kawanaka-bashi arch — `render/tokyoLandmarks.ts`), never by a
 * street-wall block. */
const TOKYO_BRIDGE_ROAD_IDS: ReadonlySet<string> = new Set(TOKYO_RIVER_SPECS.map((spec) => spec.id));

/** Small deterministic +/-2 m depth jitter (never touches length, height or
 * density) so a long straight run of parcels along one road does not read as
 * one identical repeated slab depth. Pure function of the parcel's own seed
 * key — `hashStringToSeed`, not `Math.random` (content-side determinism,
 * `docs/simulation-core.md`). */
const tokyoDepthJitterM = (seedKey: string): number => (hashStringToSeed(`${seedKey}:depth`) % 5) - 2;

// -----------------------------------------------------------------------
// buildingSet derivation, holdback and back-to-road demotion (Tokyo
// authenticity plan P2, `.claude/tokyo-authenticity-plan.md` section 6.1) —
// cloned from Cairo's shipped pattern (`cairoRoadsideBuildingSet` /
// `cairoParcelKeepsFacadeBoxes` / `CAIRO_BACK_TO_ROAD_MARGIN_M` /
// `backEdgeNearsARoad` in `cities/cairo.ts`), adapted to this file's own
// per-road-zone generator rather than Cairo's per-position one.
// -----------------------------------------------------------------------

/**
 * Which glb street wall a generated roadside parcel is dressed with. Keyed
 * off the zone this file already computes per road (`TOKYO_ZONE_FOR_ROAD`)
 * rather than Cairo's raw world position, since Tokyo's districting is
 * already per-road, not per-position.
 *
 * `jp-nakamise-yokocho` gets its own shotengai dressing even though its
 * ROAD is zoned "downtown" (`TOKYO_DOWNTOWN_ROAD_IDS`) — the plan is
 * explicit that only this road converts to `tokyo-shotengai` regardless of
 * its own zone; checked first, before the zone switch below, so it wins
 * regardless of what its own zone would otherwise resolve to. Tokyo
 * authenticity plan P4 (Region B) adds a SECOND such exception,
 * `jp-ekimae-nishi-dori` — the region's own neighbourhood shopping street,
 * zoned `ekimae-nishi` (a pure-residential zone otherwise) but reading as
 * shotengai territory just like the first exception, for the same reason.
 * Tokyo authenticity plan P6 (Region C) adds a THIRD exception,
 * `jp-sumiregaoka-dori` — the region's own N-S collector, zoned
 * `sumiregaoka` (a pure-residential zone otherwise) but reading as the
 * denser `tokyo-apato` mix per the plan's own §6.2 call-out ("apāto on the
 * collector"), the same "one road within a zone gets a different set"
 * pattern as the first two exceptions.
 *
 * P3b adds the next two sets, keyed by zone per the plan's section 6.1
 * table: `downtown` (everywhere except the two roads above) and `ring` both
 * read as the same zakkyo backbone (dense mixed mid-rise/tower frontage —
 * the plan's own call, section 6.1: "ring-road frontages read as the same
 * zakkyo backbone"); `riverside` and `higashi` both read as `tokyo-manshon`
 * ("mixed mid-rise, 8-22 m" — nothing like a house zone or a shopping
 * street, exactly what the manshon mix is for). No zone is left `undefined`
 * any more except the quarter's own hand-authored roads (absent from
 * `TOKYO_ZONE_FOR_ROAD` entirely, never reach this function).
 *
 * Returns a plain `string` rather than `BuildingSetId`, matching
 * `cairoRoadsideBuildingSet`'s own signature exactly — the caller narrows
 * with `isBuildingSetId` where it actually needs the typed id (`build`,
 * below), so this function needs no import of the `BuildingSetId` type.
 */
const tokyoRoadsideBuildingSet = (
  zone: TokyoBlockZone | undefined,
  roadId: string,
): string | undefined => {
  if (roadId === "jp-nakamise-yokocho" || roadId === "jp-ekimae-nishi-dori") return "tokyo-shotengai";
  if (roadId === "jp-sumiregaoka-dori") return "tokyo-apato";
  if (zone === "miyanosaka" || zone === "yamashita" || zone === "nishi" || zone === "ekimae-nishi" || zone === "hanamizu" || zone === "sumiregaoka" || zone === "minamimachi" || zone === "kawabata") return "tokyo-house";
  if (zone === "downtown" || zone === "ring") return "tokyo-zakkyo";
  if (zone === "riverside" || zone === "higashi") return "tokyo-manshon";
  return undefined;
};

/**
 * One roadside parcel in four keeps the procedural facade grid instead of a
 * glb street wall — same rationale and shape as Cairo's
 * `cairoParcelKeepsFacadeBoxes`. TA1 (the plan's own brief) says mix, not
 * replace, and Tokyo's night-window procedural facades are genuinely good;
 * the glb majority is a decision, not a count. Deterministic on the block
 * id (never `Math.random`, which would desync loads); the Tokyo-specific
 * seed suffix keeps this draw independent of any other city's own holdback
 * roll for the same-shaped id string.
 */
const tokyoParcelKeepsFacadeBoxes = (blockId: string): boolean =>
  hashStringToSeed(`${blockId}-tokyo-street-wall`) % 4 === 0;

/**
 * The Sketchfab house/shop kit is one-sided, the same as Cairo's Quaternius
 * kit — nothing in this batch was measured with glazing or a door on more
 * than one face — so a glb parcel's far edge is a windowless back. Within
 * this margin of another road's pavement that back would be the whole view
 * from that carriageway, so the parcel demotes to the procedural facade
 * grid instead (glazes all four faces). Same value as Cairo's own
 * `CAIRO_BACK_TO_ROAD_MARGIN_M`, and the same constraint on it: must stay
 * below 1.5 + the shallower of `tokyo-house`/`tokyo-shotengai`'s own
 * `buildingSetDepthM` (11.82, tokyo-house — tokyo-shotengai's is 12.91) or
 * a parcel could trip on its own road.
 */
const TOKYO_BACK_TO_ROAD_MARGIN_M = 6;

const tokyoPointToSegmentM = (p: WorldPoint, a: WorldPoint, b: WorldPoint): number => {
  const abX = b.x - a.x;
  const abZ = b.z - a.z;
  const lengthSq = abX * abX + abZ * abZ;
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p.x - a.x) * abX + (p.z - a.z) * abZ) / lengthSq))
    : 0;
  return Math.hypot(p.x - (a.x + abX * t), p.z - (a.z + abZ * t));
};

/** Exact segment-to-segment distance — no sampling, so nothing can slip
 * between probe points on a long back edge. Clone of Cairo's own
 * file-private `segmentToSegmentM` — this file already clones rather than
 * imports Cairo's roadside-parcel machinery wholesale, see
 * `tokyoRoadsideParcel`'s own doc comment above. */
const tokyoSegmentToSegmentM = (
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
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    tokyoPointToSegmentM(a1, b1, b2),
    tokyoPointToSegmentM(a2, b1, b2),
    tokyoPointToSegmentM(b1, a1, a2),
    tokyoPointToSegmentM(b2, a1, a2),
  );
};

/**
 * Junction-proximity margin excluded from each end of the back-edge check
 * below, before testing it against foreign roads.
 *
 * Cairo's own `backEdgeNearsARoad` tests a whole piece's back edge as one
 * line safely, because Cairo's generator SPLITS every run into pieces no
 * longer than 110 m (`cairoRoadsideBuildingSet`'s call site, `runCount`).
 * Tokyo's generator never splits — one `tokyoRoadsideParcel` candidate
 * spans a whole inter-junction road segment, which can run several hundred
 * metres (measured: `jp-mn-wakaba-dori`'s is 476 m). Every one of THOSE
 * segments terminates at another road within roughly its own half-width —
 * that is what "terminates" means — so testing the full-length back edge
 * as a single segment-to-segment distance made ~every candidate's back
 * edge register as "close to a road" at the tip nearest its own far
 * junction, which is a T-junction doing exactly what a T-junction does,
 * not a second street crowding the parcel's real street-facing exposure.
 * Measured live (this phase, before this constant existed): 0 of 280
 * blocks kept a `buildingSet` — every single candidate demoted. Excluding
 * a margin from each end (mirroring `tokyoRoadsideParcel`'s own 12 m
 * end-inset, scaled up a little since this check runs on the
 * already-trimmed span) restores the check to what it is actually meant to
 * catch: a genuine second road running close and roughly parallel for a
 * real stretch of the parcel's own length, which still trips the
 * mid-span test regardless of how much of each end is excluded.
 */
const TOKYO_BACK_EDGE_END_INSET_M = 20;

/**
 * Whether a glb-depth candidate's blank back would crowd another road.
 * Derived from the block's own `center`/`headingDeg`/`size` rather than
 * closure state, unlike Cairo's version — `tokyoRoadsideParcel` doesn't
 * expose its internal along/right vectors the way Cairo's fully-inline
 * generator loop does. `side` is the one extra fact needed: local +z (the
 * block's own `size.z` axis) points toward the road when `side` is +1 and
 * away from it when -1 (`headingDeg = atan2(-uz, ux)` puts local +x along
 * (ux, uz) — the same road-forward direction `tokyoRoadsideParcel` derives
 * `from`->`to` — so local +z is (-uz, ux); the block sits offset toward
 * `side * (uz, -ux)` from the road, i.e. the road lies toward `side *`
 * local +z from the block's own centre), so the back edge is the opposite
 * face.
 */
const tokyoBackEdgeNearsARoad = (
  block: ProceduralBlock,
  side: 1 | -1,
  allSurfaces: readonly RoadSurface[],
): boolean => {
  const yawRad = ((block.headingDeg ?? 0) * Math.PI) / 180;
  const ux = Math.cos(yawRad);
  const uz = -Math.sin(yawRad);
  const halfU = block.size.x / 2;
  const halfV = block.size.z / 2;
  const backMidX = block.center.x + -uz * (-side * halfV);
  const backMidZ = block.center.z + ux * (-side * halfV);
  const testHalfU = Math.max(0, halfU - Math.min(TOKYO_BACK_EDGE_END_INSET_M, halfU * 0.4));
  const backStart = point(backMidX - ux * testHalfU, backMidZ - uz * testHalfU);
  const backEnd = point(backMidX + ux * testHalfU, backMidZ + uz * testHalfU);
  return allSurfaces.some((surface) => {
    const reach =
      surface.widthM / 2 +
      (surface.sidewalkWidthM ?? PAVED_SIDEWALK_WIDTH_M) +
      0.75 +
      TOKYO_BACK_TO_ROAD_MARGIN_M;
    for (let index = 1; index < surface.centerline.length; index += 1) {
      if (
        tokyoSegmentToSegmentM(backStart, backEnd, surface.centerline[index - 1], surface.centerline[index]) <
        reach
      ) {
        return true;
      }
    }
    return false;
  });
};

/**
 * One (segment, side) candidate of the generated street wall. The set
 * decides its own depth (`buildingSetDepthM`, not the zone's `depthM` —
 * plan section 6.1), never the reverse, so the depth is known before
 * `tokyoRoadsideParcel` places the parcel — mirrors Cairo's own
 * `pieceFor`'s `build` closure. Demotes to the procedural boxes, at the
 * SAME depth/placement math this road would have used before this phase,
 * when the glb attempt fails to produce a block at all (too short after
 * trimming) or its back would crowd another road
 * (`tokyoBackEdgeNearsARoad`) — the two-step "try the glb depth, retry at
 * the procedural depth if it doesn't clear" shape, same as Cairo's.
 */
const tokyoRoadsideCandidate = (
  id: string,
  surface: RoadSurface,
  from: WorldPoint,
  to: WorldPoint,
  side: 1 | -1,
  style: TokyoZoneStyle,
  seedKey: string,
  material: string,
  preferredSet: string | undefined,
  allSurfaces: readonly RoadSurface[],
): ProceduralBlock | null => {
  const build = (buildingSet: string | undefined): ProceduralBlock | null => {
    const depthM =
      buildingSet && isBuildingSetId(buildingSet)
        ? buildingSetDepthM(buildingSet) + 1.5
        : style.depthM + tokyoDepthJitterM(seedKey);
    const raw = tokyoRoadsideParcel(
      id,
      surface.id,
      from,
      to,
      side,
      surface.widthM,
      depthM,
      material,
      style.heightRange,
      style.density,
      allSurfaces,
    );
    if (!raw || !buildingSet) return raw;
    // One edge, and it is the near one: `headingDeg` puts local +z toward
    // the road at `side` (see `tokyoBackEdgeNearsARoad`'s own doc comment)
    // — same `side > 0 ? "+z" : "-z"` rule as Cairo's `ROADSIDE_RANKS = 0`
    // strips, rank-0 only, no second rank.
    return { ...raw, buildingSet, streetEdges: [side > 0 ? "+z" : "-z"] as const };
  };
  if (!preferredSet) return build(undefined);
  const glb = build(preferredSet);
  if (glb && !tokyoBackEdgeNearsARoad(glb, side, allSurfaces)) return glb;
  return build(undefined);
};

/**
 * The whole generated-half street wall: one `tokyoRoadsideCandidate` call
 * per (road segment, side) of every non-bridge generated road, skipping
 * whichever side `TOKYO_OPEN_WATERFRONT_SIDES` marks as open river
 * frontage. Iterating per actual centreline segment (never a merged
 * multi-segment span) matters: `tokyoRoadsideParcel` can only trim a
 * candidate span in from its TWO ends, never carve a notch out of the
 * middle, so a long merged span crossing several unrelated roads partway
 * along would retreat one whole end back to the nearest MID-span crossing
 * instead of stopping just short of it. London's own ~150 hand-authored
 * calls already follow this same per-segment discipline (its multi-segment
 * streets — King's Road, Battersea Road — are each several separate
 * `roadsideParcel` calls, one per node-to-node segment); this generator
 * reproduces that discipline programmatically instead of by hand, which is
 * what makes a 79-road network tractable at all (Kanpachi-dori alone has 24
 * segments, each a T-junction the alternating-pair-rung pattern
 * deliberately keeps square, so this loop is the only realistic way to
 * author its street wall without ~50 hand-written lines for one road).
 */
function buildTokyoGeneratedBlocks(
  generatedSurfaces: readonly RoadSurface[],
  allSurfaces: readonly RoadSurface[],
  parks: readonly { readonly center: WorldPoint; readonly size: WorldPoint; readonly headingDeg?: number }[],
  waterBodies: readonly { readonly polygon: readonly WorldPoint[] }[],
): readonly ProceduralBlock[] {
  const blocks: ProceduralBlock[] = [];
  for (const surface of generatedSurfaces) {
    if (TOKYO_BRIDGE_ROAD_IDS.has(surface.id)) continue;
    const style = tokyoStyleForRoad(surface.id);
    const zone = TOKYO_ZONE_FOR_ROAD[surface.id];
    const openSides = TOKYO_OPEN_WATERFRONT_SIDES[surface.id] ?? [];
    for (let segmentIndex = 0; segmentIndex + 1 < surface.centerline.length; segmentIndex += 1) {
      const from = surface.centerline[segmentIndex];
      const to = surface.centerline[segmentIndex + 1];
      for (const side of [1, -1] as const) {
        if (openSides.includes(side)) continue;
        const seedKey = `${surface.id}:${segmentIndex}:${side}`;
        const material = hashStringToSeed(seedKey) % 2 === 0 ? style.materials[0] : style.materials[1];
        const blockId = `jp-blk-${surface.id}-${segmentIndex}-${side === 1 ? "p" : "n"}`;
        // Decided once per parcel so a parcel and its retries agree — same
        // "decided before the final centre is known" discipline as Cairo's
        // own `preferredSet` (its own comment: the set decides the depth,
        // so it has to be known first).
        const preferredSet = tokyoParcelKeepsFacadeBoxes(blockId)
          ? undefined
          : tokyoRoadsideBuildingSet(zone, surface.id);
        const block = tokyoRoadsideCandidate(
          blockId,
          surface,
          from,
          to,
          side,
          style,
          seedKey,
          material,
          preferredSet,
          allSurfaces,
        );
        // R18's own exemption: never wall off a park frontage or the river
        // (`tokyoBlockOverlapsParkOrWater`, doc comment above) — a dropped
        // candidate here is the park/water itself standing in for the
        // street wall, not a silently lost block.
        if (block && !tokyoBlockOverlapsParkOrWater(block, parks, waterBodies)) blocks.push(block);
      }
    }
  }
  return blocks;
}

/** Every generated-half block, built once at module scope — spliced into
 * `TOKYO_MAP_PACK.geometry.blocks` below, after the 9 hand-authored quarter
 * blocks (which this generator does not touch: the quarter already has its
 * own hand-carved fabric from before this expansion began). Parks/water
 * include Phase 6's new ones (`TOKYO_PHASE6_PARKS`/`_WATER_BODIES`) as well
 * as the pre-existing three — a candidate parcel landing on Kitazawa-kōen's
 * or Minami-kōen's own cell is exactly R18's "never wall a park frontage"
 * exemption, not a lost block (see `tokyoBlockOverlapsParkOrWater`'s own
 * doc comment above). */
const tokyoGeneratedBlocks = buildTokyoGeneratedBlocks(
  tokyoGeneratedHalf.generatedSurfaces,
  [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces],
  [...TOKYO_QUARTER_PARKS, ...TOKYO_PHASE6_PARKS],
  [...TOKYO_WATER_BODIES, ...TOKYO_PHASE6_WATER_BODIES],
);

/**
 * `jp-tower-park` (130x100 at (1053,140)) partially overlaps the segment-2
 * roadside parcel `buildTokyoGeneratedBlocks` would otherwise have built
 * along Higashi Hon-dōri's east kerb (z -156..168, the whole node-to-node
 * span from the Setagaya-dōri crossing to the Kawanaka-bashi landing) — the
 * overlap check above drops that ENTIRE parcel, not just the ~78 m the park
 * actually covers, because `tokyoRoadsideParcel` can only trim a candidate
 * from its two ends, never carve a notch from the middle. Left alone that
 * would silently bare 246 m of kerb (z -156..90) south of the new park, so
 * this re-derives a fresh parcel for exactly that remainder — same road,
 * same style, same algorithm, just a `to` endpoint pulled back to the
 * park's own south edge instead of the road's real segment end. The
 * function's own 12 m end-inset naturally leaves a ~12 m gap into the park
 * (matching how every OTHER parcel-to-parcel seam in this file already
 * works), so this needs no other adjustment. Every other new park this
 * phase (see `TOKYO_PHASE6_PARKS`'s own comment) sits on a fully-owned
 * short-segment cell or a river-side no-block corridor, so this is the one
 * site that needs it.
 */
const tokyoPhase6KerbPatches: readonly ProceduralBlock[] = (() => {
  const style = tokyoStyleForRoad("jp-higashi-hondori");
  const allSurfaces = [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces];
  const patch = tokyoRoadsideParcel(
    "jp-blk-jp-higashi-hondori-2-p-south",
    "jp-higashi-hondori",
    point(980, -168),
    point(980, 90),
    1,
    8,
    style.depthM,
    style.materials[0],
    style.heightRange,
    style.density,
    allSurfaces,
  );
  return patch ? [patch] : [];
})();

/**
 * Phase 10 visual-gap remediation: the two long N-S ring roads
 * (`jp-nishi-kanjo-dori`, `jp-kanpachi-dori`) each thread through dozens of
 * side-street T-junctions (`buildTokyoGeneratedBlocks`'s own doc comment:
 * "Kanpachi-dori alone has 24 segments"), and several of those inter-
 * junction segments are short enough that the per-segment generator's
 * unconditional 12 m end-inset (`tokyoRoadsideParcel`'s `lo`/`hi` blanket
 * retreat, `docs/map-authoring.md`'s "roadside parcel's length is derived"
 * paragraph) eats the whole thing — the exact "span under ~50 m ships
 * NOTHING" trap. That is normal at every OTHER 24 m-ish junction gap on this
 * map (below the ~28 m bare-kerb qualifying threshold, present at every
 * junction on every city that uses this parcel family, not a defect) — but
 * a full-scope `--fan --full-matrix` visual-gap audit (Phase 10, the first
 * time this gate has run for Tokyo at full scope) found several SPECIFIC
 * stretches on these two roads where two or more such short segments chain
 * together into a genuinely bare 52-114 m run, well past that threshold,
 * confirmed camera-side via `__sideswapVisualGapOverlay`. Each patch below
 * re-derives one fresh parcel spanning the exact bare interval (same
 * mechanism as `tokyoPhase6KerbPatches` above): the combined span easily
 * clears `TOKYO_MIN_PARCEL_HALF_LENGTH_M` even though its ORIGINAL
 * constituent segment(s) individually did not, and the function's own
 * foreign-road clearance re-trims against any side street actually crossing
 * the middle, so this needs no manual notch-cutting. World-edge-terminus
 * gaps (both roads' own z=-1140/+1140 ends) get the same treatment — a road
 * simply dead-ending 12 m short of its own drawn terminus is exactly as
 * bare as a skipped interior segment.
 */
const tokyoPhase10RingRoadKerbPatches: readonly ProceduralBlock[] = (() => {
  const allSurfaces = [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces];
  interface RingGap {
    readonly roadId: string;
    readonly x: number;
    readonly zLo: number;
    readonly zHi: number;
    readonly side: 1 | -1;
  }
  const gaps: readonly RingGap[] = [
    // jp-nishi-kanjo-dori (x=-1200, width 8) — both world-edge termini on
    // both flanks, plus two interior chained-short-segment runs on the "p"
    // (east/inner) flank only (the "n"/outer flank's own interior segments
    // all individually cleared the floor).
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: -1140, zHi: -1088, side: -1 },
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: 1088, zHi: 1140, side: -1 },
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: -1140, zHi: -1088, side: 1 },
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: -982, zHi: -888, side: 1 },
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: -180, zHi: -88, side: 1 },
    { roadId: "jp-nishi-kanjo-dori", x: -1200, zLo: 1088, zHi: 1140, side: 1 },
    // jp-kanpachi-dori (x=-700, width 11) — same shape, both flanks this
    // time (it carries more side-street junctions per `buildTokyoGeneratedBlocks`'s
    // own "24 segments" note, so more chances for two short ones to chain).
    { roadId: "jp-kanpachi-dori", x: -700, zLo: -1140, zHi: -1088, side: -1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: -852, zHi: -788, side: -1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: 548, zHi: 612, side: -1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: 1088, zHi: 1140, side: -1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: -1140, zHi: -1088, side: 1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: -1052, zHi: -958, side: 1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: -852, zHi: -788, side: 1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: 548, zHi: 662, side: 1 },
    { roadId: "jp-kanpachi-dori", x: -700, zLo: 1088, zHi: 1140, side: 1 },
  ];
  const parks = [...TOKYO_QUARTER_PARKS, ...TOKYO_PHASE6_PARKS];
  const waterBodies = [...TOKYO_WATER_BODIES, ...TOKYO_PHASE6_WATER_BODIES];
  const patches: ProceduralBlock[] = [];
  for (const [index, gap] of gaps.entries()) {
    const style = tokyoStyleForRoad(gap.roadId);
    const roadWidthM = allSurfaces.find((s) => s.id === gap.roadId)?.widthM ?? 8;
    const patch = tokyoRoadsideParcel(
      `jp-blk-${gap.roadId}-p10patch-${index}-${gap.side === 1 ? "p" : "n"}`,
      gap.roadId,
      point(gap.x, gap.zLo),
      point(gap.x, gap.zHi),
      gap.side,
      roadWidthM,
      style.depthM,
      index % 2 === 0 ? style.materials[0] : style.materials[1],
      style.heightRange,
      style.density,
      allSurfaces,
    );
    // Same R18 exemption `buildTokyoGeneratedBlocks` applies: several of
    // these gaps are exactly where a pocket green already provides the
    // frontage instead of a building (that IS why the standard per-segment
    // generator left them bare, not a miss) — confirmed live by
    // `tests/content.test.ts`'s "keeps every authored block out of every
    // park" the first time this ran without the check.
    if (patch && tokyoBlockOverlapsParkOrWater(patch, parks, waterBodies)) continue;
    if (patch) patches.push(patch);
  }
  return patches;
})();

/**
 * Post-plan void-frontage fill (owner report, 2026-08-15: "when I'm
 * driving, I don't wanna see gaps unless it's the waterfront or a park").
 * A whole-map per-(road, side) frontage-coverage sweep (2 m stations,
 * junction aprons subtracted, blocks/parks/water/rail counted as cover)
 * found 42 bare intervals >= 26 m totalling 5.1 km; the 30 below are the
 * ones that are genuinely void to a driving camera. The excluded twelve
 * are deliberate scenery, per the owner's own rule: `jp-kawagishi-dori`'s
 * five river-side intervals ARE the waterfront, and the shotengai/ichiban
 * inward flanks face the Nakamise Yokochō shared-space corridor. Most of
 * these gaps are the SEAMS the phased build never owned: the bands between
 * the hand-authored quarter and the generated webs (north of central
 * Setagaya-dōri, north of the old quarter, the rail-side east edge), plus
 * arterial flanks whose facing web kept its rows on its own inner streets.
 *
 * Same mechanism as `tokyoPhase10RingRoadKerbPatches` above (per-interval
 * `tokyoRoadsideParcel`, style-driven, park/water self-exempting), with one
 * addition: the quarter's own roads predate `TOKYO_ZONE_FOR_ROAD` (their
 * blocks are hand-carved, so `tokyoStyleForRoad` deliberately throws for
 * them) — those entries carry a quarter-fabric style here instead, matched
 * to the adjacent hand blocks' own material/heightRange/density.
 */
const tokyoVoidFrontagePatches: readonly ProceduralBlock[] = (() => {
  const allSurfaces = [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces];
  interface VoidGap {
    readonly roadId: string;
    readonly from: WorldPoint;
    readonly to: WorldPoint;
    readonly side: 1 | -1;
  }
  // Quarter-fabric styles for zone-less quarter roads, keyed by which hand
  // blocks each seam abuts (south band = south-west/south-east's wood-
  // plaster/plaster look; north band = north/west-upper's plaster/tile;
  // rail-side east band = the low wood-plaster east rows).
  const QUARTER_SEAM_STYLE: Readonly<
    Record<string, { materials: readonly [string, string]; heightRange: readonly [number, number]; density: number; depthM: number }>
  > = {
    "jp-setagaya-dori": { materials: ["wood-plaster", "plaster"], heightRange: [5, 13], density: 0.7, depthM: 14 },
    "jp-shrine-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.68, depthM: 14 },
    "jp-south-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.68, depthM: 13 },
    "jp-westside-south": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.68, depthM: 14 },
    "jp-eastside-road": { materials: ["plaster", "wood-plaster"], heightRange: [5, 13], density: 0.7, depthM: 14 },
    "jp-northrow-west": { materials: ["plaster", "tile"], heightRange: [5, 15], density: 0.7, depthM: 14 },
    "jp-westhill-road": { materials: ["plaster", "wood-plaster"], heightRange: [5, 13], density: 0.68, depthM: 13 },
    "jp-narrowhill-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.68, depthM: 13 },
    "jp-easthill-road": { materials: ["plaster", "wood-plaster"], heightRange: [5, 13], density: 0.68, depthM: 13 },
    "jp-uptown-road": { materials: ["plaster", "tile"], heightRange: [6, 15], density: 0.7, depthM: 14 },
    "jp-north-road": { materials: ["plaster", "tile"], heightRange: [5, 14], density: 0.7, depthM: 13 },
    "jp-westside-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 13], density: 0.68, depthM: 14 },
    "jp-center-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.68, depthM: 12 },
    "jp-east-curve": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.66, depthM: 12 },
    "jp-junction-road": { materials: ["wood-plaster", "plaster"], heightRange: [5, 12], density: 0.66, depthM: 12 },
  };
  const gaps: readonly VoidGap[] = [
    { roadId: "jp-setagaya-dori-west", from: point(-1166, -168), to: point(-748, -168), side: -1 },
    { roadId: "jp-ys-yanagi-dori", from: point(-1166, -970), to: point(-748, -970), side: -1 },
    { roadId: "jp-ni-tsuki-dori", from: point(-1166, -100), to: point(-748, -100), side: 1 },
    { roadId: "jp-koshu-kaido", from: point(-686, 560), to: point(-474, 560), side: -1 },
    { roadId: "jp-setagaya-dori", from: point(-238, -168), to: point(-52, -168), side: 1 },
    { roadId: "jp-setagaya-dori-west", from: point(-432, -168), to: point(-274, -168), side: -1 },
    { roadId: "jp-mn-asahi-dori", from: point(-664, 600), to: point(-506, 600), side: -1 },
    { roadId: "jp-setagaya-dori-west", from: point(-432, -168), to: point(-282, -168), side: 1 },
    { roadId: "jp-northrow-west", from: point(-126, 76), to: point(-246, 76), side: 1 },
    { roadId: "jp-setagaya-dori", from: point(-124, -168), to: point(-44, -168), side: -1 },
    { roadId: "jp-westside-south", from: point(-260, -86), to: point(-260, -154), side: 1 },
    { roadId: "jp-shrine-road", from: point(-30, -86), to: point(-30, -154), side: 1 },
    { roadId: "jp-setagaya-dori", from: point(-8, -168), to: point(58, -168), side: 1 },
    { roadId: "jp-westhill-road", from: point(-112, 90), to: point(-112, 154), side: -1 },
    { roadId: "jp-narrowhill-road", from: point(-30, 90), to: point(-30, 154), side: 1 },
    { roadId: "jp-uptown-road", from: point(6, 168), to: point(68, 168), side: -1 },
    { roadId: "jp-ys-ayame-dori", from: point(-664, -1040), to: point(-602, -1040), side: -1 },
    { roadId: "jp-kawate-dori", from: point(580, 194), to: point(580, 250), side: 1 },
    { roadId: "jp-south-road", from: point(-98, -72), to: point(-44, -72), side: 1 },
    { roadId: "jp-eastside-road", from: point(72, -86), to: point(72, -140), side: -1 },
    { roadId: "jp-easthill-road", from: point(82, 90), to: point(82, 140), side: 1 },
    { roadId: "jp-east-curve", from: point(84, -65), to: point(109, -31), side: 1 },
    { roadId: "jp-east-curve", from: point(84, -65), to: point(109, -31), side: -1 },
    { roadId: "jp-westside-road", from: point(-260, -58), to: point(-260, -12), side: -1 },
    { roadId: "jp-center-road", from: point(100, -4), to: point(74, 18), side: 1 },
    { roadId: "jp-junction-road", from: point(67, 31), to: point(82, 62), side: -1 },
    { roadId: "jp-south-road", from: point(22, -72), to: point(58, -72), side: -1 },
    { roadId: "jp-shotengai-nishi-dori", from: point(150, -46), to: point(150, -16), side: -1 },
    { roadId: "jp-center-road", from: point(28, 18), to: point(2, 18), side: -1 },
    { roadId: "jp-north-road", from: point(42, 76), to: point(68, 76), side: 1 },
  ];
  const parks = [...TOKYO_QUARTER_PARKS, ...TOKYO_PHASE6_PARKS];
  const waterBodies = [...TOKYO_WATER_BODIES, ...TOKYO_PHASE6_WATER_BODIES];
  const patches: ProceduralBlock[] = [];
  for (const [index, gap] of gaps.entries()) {
    const seamStyle = QUARTER_SEAM_STYLE[gap.roadId];
    const zoneStyle = seamStyle ? null : tokyoStyleForRoad(gap.roadId);
    const materials = seamStyle?.materials ?? zoneStyle!.materials;
    const heightRange = seamStyle?.heightRange ?? zoneStyle!.heightRange;
    const density = seamStyle?.density ?? zoneStyle!.density;
    const depthM = seamStyle?.depthM ?? zoneStyle!.depthM;
    const roadWidthM = allSurfaces.find((s) => s.id === gap.roadId)?.widthM ?? 8;
    const patch = tokyoRoadsideParcel(
      `jp-blk-${gap.roadId}-voidfill-${index}-${gap.side === 1 ? "p" : "n"}`,
      gap.roadId,
      gap.from,
      gap.to,
      gap.side,
      roadWidthM,
      depthM,
      index % 2 === 0 ? materials[0] : materials[1],
      heightRange,
      density,
      allSurfaces,
    );
    if (patch && tokyoBlockOverlapsParkOrWater(patch, parks, waterBodies)) continue;
    if (patch) patches.push(patch);
  }
  return patches;
})();

// The names the quarter's lanes were authored under — every road here was
// already described in the comments above, this promotes them to data. Only
// Setagaya-dori is a real street; the rest are this neighbourhood's own.
// Checked against the limit table, so a quarter road cannot be named without
// being posted or posted without being named. The generated half's roads are
// named inline on their own `TokyoRoadSpec` instead (no second table to keep
// in sync — see `assembleTokyoGeneratedHalf`'s `generatedRoadNames`).
const TOKYO_QUARTER_ROAD_NAMES = {
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
} satisfies Readonly<Record<keyof typeof TOKYO_ROAD_SPEED_LIMITS, string>>;

/**
 * The Setagaya Line as an actual railway (rail feature, phase B): one
 * polyline from the Gotokuji terminus stub, south across Yamashita St
 * (jp-rail-signal — the level crossing by spawn), around the corner and
 * east along z=-10 across Ichiban-dōri (jp-rail-signal-2). The timetable
 * drives both crossings' lamps/barriers/citations and the visible tram
 * (see docs/simulation-core.md). Hoisted above the pack because the block
 * list is carved around this corridor (`carveBlocksForRailCorridors`) —
 * one polyline, one keep-out, one audit (`tests/railCorridors.test.ts`).
 * v0 ends at x=280 exactly where the retired decal landmarks ended; the
 * eastward extension to the Sakuragawa and the east bank lands with the
 * corridor surgery.
 */
const TOKYO_RAIL_POINTS: readonly WorldPoint[] = [
  point(18, -112),
  point(18, -18),
  point(20.3, -12.3),
  point(26, -10),
  point(280, -10),
];

const TOKYO_RAIL_LINES: readonly RailLine[] = [
  {
    id: "jp-setagaya-line-run",
    points: TOKYO_RAIL_POINTS,
    corridorHalfWidthM: 4.5,
    crossingControlIds: [
      "jp-rail-signal",
      "jp-rail-signal-2",
      "jp-rail-signal-miyanosaka",
      "jp-rail-signal-shotengai",
    ],
    schedule: {
      mode: "shuttle",
      speedMps: 8.5,
      trainLengthM: 25,
      dwellSeconds: 22,
      warningLeadSeconds: 8,
      clearTrailSeconds: 1.5,
    },
  },
];

// Every lane and surface on the map, hoisted from the `graph(...)`/geometry
// literals below so the rail-crossing generator can measure the real
// centrelines it stop-lines. Same arrays, one construction.
const tokyoAllLanes: readonly LaneSegment[] = [
  ...tokyoGeneratedHalf.quarterLanesWithNewTurns,
  ...tokyoGeneratedHalf.generatedLanes,
];
const tokyoAllSurfaces: readonly RoadSurface[] = [
  ...jpQuarterSurfaces,
  ...tokyoGeneratedHalf.generatedSurfaces,
];
const tokyoSurfaceById = (id: string): RoadSurface => {
  const surface = tokyoAllSurfaces.find((candidate) => candidate.id === id);
  if (!surface) throw new Error(`tokyo rail crossing: unknown surface ${id}`);
  return surface;
};

/**
 * The two centre-section crossings the audit demanded (the retired decal ran
 * over both roads unmarked): Miyanosaka St's diagonal leg crosses the line
 * obliquely — a very Japanese elongated fumikiri — and Shōtengai Nishi-dōri
 * crosses square. Both fully generated from the measured lane centrelines;
 * the two original hand-authored crossings (jp-rail-signal/-2) stay exactly
 * as shipped, their approach distances pinned by tests/content.test.ts.
 */
const tokyoRailCrossingMiyanosaka = buildRailCrossingControl({
  id: "jp-rail-signal-miyanosaka",
  railPoints: TOKYO_RAIL_POINTS,
  surface: tokyoSurfaceById("jp-center-road"),
  lanes: tokyoAllLanes,
});
const tokyoRailCrossingShotengai = buildRailCrossingControl({
  id: "jp-rail-signal-shotengai",
  railPoints: TOKYO_RAIL_POINTS,
  surface: tokyoSurfaceById("jp-shotengai-nishi-dori"),
  lanes: tokyoAllLanes,
});

export const TOKYO_MAP_PACK: MapPack = {
  id: "tokyo-setagaya",
  name: "Tokyo — Setagaya",
  areaLabel: "Gotokuji, Sakuragawa Downtown & the Hikari Tower",
  countryIds: ["jp"],
  roadNames: {
    ...TOKYO_QUARTER_ROAD_NAMES,
    ...tokyoGeneratedHalf.generatedRoadNames,
  },
  ambientTraffic: { desktop: 32, touch: 16 },
  source: osmSource(
    { south: 35.6476, west: 139.6345, north: 35.6568, east: 139.6539 },
    "https://www.openstreetmap.org/export#map=16/35.6522/139.6442",
    "manifest-v1:tokyo-setagaya-2026-07-10",
  ),
  geometry: {
    // 2600 x 2400 (bounds x in [-1300,1300], z in [-1200,1200]) — the Phase 2
    // road-network expansion (plan section 8.2). The quarter's own node
    // coordinates (x in [-260,112], z in [-168,168]) do not move; the map
    // centre stays the world origin, so the quarter sits just west of centre
    // in the new bounds, the same way London's South Kensington quarter
    // anchors its generated halves.
    worldSize: point(2600, 2400),
    roadWidth: 6.5,
    shoulderWidth: 0.8,
    roadSurfaces: tokyoAllSurfaces,
    // The Sakuragawa (Phase 3, R3): a deliberately irregular ~24-vertex shore
    // (never a straight canal — NYC's East River is the precedent), full
    // z-span so both ends exit the world at the edge margin (the world-edge
    // exemption applies there, not a fence-duplication bug). `flowHeadingDeg:
    // 180` (southward) makes this a river, not a pond — `jp-kitazawa-pond`
    // (Phase 6, inside its own park) has none. `bridgePortalSurfaceIds` is
    // what opens the shoreline for exactly the three bridges below and
    // derives their parapet spans; every other metre of shore stays solid.
    // Hoisted to `TOKYO_WATER_BODIES` above (Tokyo expansion Phase 4): the
    // street-wall generator reads the same array, so there is exactly one
    // copy of this polygon on the map. `TOKYO_PHASE6_WATER_BODIES` adds
    // Kitazawa-kōen's pond (Phase 6, R4).
    waterBodies: [...TOKYO_WATER_BODIES, ...TOKYO_PHASE6_WATER_BODIES],
    // The whole block list — hand-carved quarter, generated street wall and
    // every patch tier — passes through the rail-corridor carver last, so no
    // block (present or future) can stand on the right-of-way. The carver
    // splits a crossed block into its two flanks and drops slivers under
    // 12 m; `tests/railCorridors.test.ts` re-proves the result against the
    // planned building solids.
    blocks: carveBlocksForRailCorridors([
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
      // Post-plan void-frontage fill, micro tier (owner's "no gaps unless
      // scenic" rule — same sweep as `tokyoVoidFrontagePatches` below, but
      // these ten intervals are 24-86 m: below/near the roadside-parcel
      // machinery's own length floor after junction trims, so they are
      // authored as plain quarter-style blocks at the measured rects
      // instead. Mostly the quarter's rail-side east band (the level-
      // crossing environs), plus one riverside-zone east flank on
      // Kawate-dori. Sized/offset from each road's real half-width +
      // sidewalk; the sweep's 13 m junction aprons are already outside
      // every interval. Two measured slivers are deliberately NOT filled:
      // the concave flanks where jp-east-curve and jp-center-road's
      // diagonal wrap the level-crossing triangle — a straight rect offset
      // from a curve's chord cuts inside the bend, and the first attempt
      // put facade cells inside the audit's own driving-camera envelope
      // (camera_origin_inside_opaque, caught by the fan re-run). That
      // wedge is rail-crossing environs, the same clearance class as the
      // crossing's own aprons; a pocket green is the right dressing if it
      // ever needs one.
      { id: "jp-block-voidfill-micro-0", center: point(595.6, 237), size: point(84, 16), heightRange: [6, 16], density: 0.7, material: "tile", headingDeg: -90 },
      { id: "jp-block-voidfill-micro-2", center: point(86.35, -40.54), size: point(40, 12), heightRange: [5, 12], density: 0.66, material: "wood-plaster", headingDeg: -54 },
      { id: "jp-block-voidfill-micro-3", center: point(-272.7, -36), size: point(42, 13), heightRange: [5, 13], density: 0.68, material: "wood-plaster", headingDeg: -90 },
      { id: "jp-block-voidfill-micro-5", center: point(63.16, 51.99), size: point(32, 12), heightRange: [5, 12], density: 0.66, material: "wood-plaster", headingDeg: -64 },
      { id: "jp-block-voidfill-micro-6", center: point(40, -59.2), size: point(34, 12), heightRange: [5, 12], density: 0.68, material: "plaster" },
      { id: "jp-block-voidfill-micro-7", center: point(137.3, -31), size: point(28, 12), heightRange: [6, 15], density: 0.72, material: "tile", headingDeg: -90 },
      { id: "jp-block-voidfill-micro-8", center: point(15, 5.2), size: point(24, 12), heightRange: [5, 12], density: 0.68, material: "wood-plaster", headingDeg: -180 },
      { id: "jp-block-voidfill-micro-9", center: point(55, 62.7), size: point(24, 13), heightRange: [5, 14], density: 0.7, material: "plaster" },
      // Generated-half street wall (Tokyo expansion Phase 4, R18): the
      // whole residential-web/ring/downtown/riverside/east-bank fabric,
      // built by `buildTokyoGeneratedBlocks` above. The 9 rows above this
      // comment are the pre-expansion quarter's own hand-carved blocks and
      // stay exactly as authored.
      ...tokyoGeneratedBlocks,
      // The one Phase 6 kerb patch `jp-tower-park` needs — see
      // `tokyoPhase6KerbPatches`'s own doc comment above.
      ...tokyoPhase6KerbPatches,
      // Phase 10 visual-gap remediation — see
      // `tokyoPhase10RingRoadKerbPatches`'s own doc comment above.
      ...tokyoPhase10RingRoadKerbPatches,
      // Post-plan void-frontage fill (owner's "no gaps unless scenic" rule)
      // — see `tokyoVoidFrontagePatches`'s own doc comment above.
      ...tokyoVoidFrontagePatches,
    ], TOKYO_RAIL_LINES).blocks,
    servicePoints: [
      // The narrow south road still needs a wide set-back because the lot is
      // anchored on the near lane. Shifted 4 m east of the old anchor so the
      // west edge clears the junction apron at jp-a rather than kissing its
      // corner. Re-solved for jp-south-road's 2.6 m paved sidewalk (Phase 1
      // of the Tokyo expansion) — the old 17.3 m was measured against the
      // unpaved ~0.9 m fallback and bled into the carriageway once paved.
      { id: "jp-gas", kind: "gas_station", anchor: { laneId: "jp-south-east-1", distanceAlongM: 22 }, footprint: point(12, 8), label: "Setagaya Fuel", setbackM: 19.2 },
      // Fuel is in the south-west, so the workshop takes the north row. Like
      // the station it is anchored on the near lane and thrown across the
      // road by the driver's-right set-back, which on a left-hand-traffic map
      // is the far side — that is what puts it against the north block.
      // Re-solved alongside jp-gas for jp-north-road's paved sidewalk.
      { id: "jp-repair", kind: "repair_shop", anchor: { laneId: "jp-north-west-2", distanceAlongM: 36 }, footprint: point(10, 8), label: "Setagaya Auto", setbackM: 12.5 },
      // Second pair (Tokyo expansion Phase 7): the whole generated half had
      // no service points at all until now — a driver working the east bank
      // or the southern webs was a very long tow from the quarter's only
      // pair. Both solver-placed (a binary search over `setbackM` against
      // the exact `tests/serviceLots.test.ts` geometry — segment-to-lot
      // distance, `shoulderWidthFor`, the 0-0.6 m flush-kerb window) rather
      // than hand-picked, the same discipline every venue anchor above used.
      { id: "jp-gas-higashi", kind: "gas_station", anchor: { laneId: "jp-koshu-kaido-higashi-3-forward-1", distanceAlongM: 70 }, footprint: point(12, 8), label: "Higashi Fuel", setbackM: 22.79 },
      { id: "jp-repair-minami", kind: "repair_shop", anchor: { laneId: "jp-minami-kaido-1-forward-1", distanceAlongM: 300 }, footprint: point(10, 8), label: "Minami Auto Works", setbackM: 14.95 },
      // Minamimachi (Tokyo authenticity plan P7, Region D): this quadrant's
      // first pair, both on the spine (`jp-minamimachi-dori`'s own segment 1,
      // west of the jp-shion-x-minamimachi crossing) and both solver-placed
      // the same way as jp-gas-higashi/jp-repair-minami above — a binary
      // search over `setbackM` against the exact `tests/serviceLots.test.ts`
      // geometry, not a hand estimate. Plan section 5.5's "Trimming the gas
      // station" import (the Kit2K2 Cubicle Japanese Gas Station) was
      // evaluated and NOT taken this phase — see this file's own P7 PR body
      // for the reasoning — so this uses the same shared `gas-station.glb`
      // every other Tokyo/NYC/London station already renders (`PROP_MODEL_
      // REGISTRY.gas_station`/`GAS_STATION_SOLIDS_M`/`SERVICE_MODEL_FRAME`
      // are all singletons keyed by `ServicePointKind`, not per-model — a
      // second visually distinct station would need those to become
      // per-model, a real architecture change to shared, load-bearing
      // machinery every existing gas station on every map runs through, not
      // a same-shape addition. The plan's own §5.5 fallback anticipates
      // exactly this call: "a working refuel point beats a prettier prop
      // that took 3x as long."
      { id: "jp-gas-minamimachi", kind: "gas_station", anchor: { laneId: "jp-minamimachi-dori-1-forward-1", distanceAlongM: 80 }, footprint: point(12, 8), label: "Minamimachi Fuel", setbackM: 18.79 },
      { id: "jp-repair-minamimachi", kind: "repair_shop", anchor: { laneId: "jp-minamimachi-dori-1-reverse-1", distanceAlongM: 200 }, footprint: point(10, 8), label: "Minamimachi Auto Works", setbackM: 11.95 },
    ],
    gigVenues: [
      // West side of the narrow street (driver's right of the southbound
      // lane): the old north-1@82 corner plot overlapped both the centre
      // road's south edge and the Gotokuji station box.
      { id: "jp-v1", kind: "restaurant", anchor: { laneId: "jp-narrow-south-1", distanceAlongM: 13 }, footprint: point(12, 9), name: "Gotokuji Bento" },
      // 20 m, not 40: eastbound's right is south, and past x = -5 the temple
      // grounds start — at 40 m the market's corner stood half a metre inside
      // them.
      { id: "jp-v2", kind: "shop", anchor: { laneId: "jp-uptown-east-2", distanceAlongM: 20 }, footprint: point(12, 9), name: "Miyanosaka Market" },
      { id: "jp-v3", kind: "residence", anchor: { laneId: "jp-north-east-2", distanceAlongM: 54 }, footprint: point(12, 10), name: "Setagaya Residence" },
      { id: "jp-v4", kind: "office", anchor: { laneId: "jp-dori-east-2", distanceAlongM: 60 }, footprint: point(14, 12), name: "Setagaya-dori Office" },
      // Tokyo expansion Phase 7 (R6/R7/R8): 41 new venues across every
      // district the generated half's street wall (Phase 4) actually built,
      // per plan §8.9. Every anchor below was found by a scratchpad solver
      // that calls the REAL `resolveVenuePlacement` (never a hand estimate)
      // for both the forward and reverse lane of the target road, across
      // every one of that road's segments (a multi-segment generated road
      // has one independent lane — and `distanceAlongM` — per segment, so
      // there is no single "distance along the whole road"), and keeps only
      // the result that lands inside a real `addressable` block, clear of
      // every park/landmark/carriageway and >=22 m from every other venue
      // and service point already placed. Anchoring the FORWARD-direction
      // lane of a segment lands the venue on that segment's "+1" (driver's-
      // right-of-forward) flank; anchoring the REVERSE-direction lane lands
      // it on the "-1" flank — the same convention
      // `buildTokyoGeneratedBlocks` uses to build the two blocks per
      // segment, so every anchor below was picked to match a REAL block on
      // its own side, not just any block that happened to overlap. See the
      // PR for the solver script and its full per-venue verification table.
      //
      // Downtown (14): 3 konbini, 2 ramen, 2 izakaya, sushi, curry, a named
      // diner, a cafe, 2 offices, 1 residence.
      { id: "jp-v5", kind: "shop", anchor: { laneId: "jp-eki-mae-dori-2-forward-1", distanceAlongM: 60 }, footprint: point(12, 9), name: "Hoshi Mart Ekimae" },
      { id: "jp-v6", kind: "shop", anchor: { laneId: "jp-chuo-dori-3-forward-1", distanceAlongM: 51 }, footprint: point(12, 9), name: "Hoshi Mart Chuo" },
      { id: "jp-v7", kind: "shop", anchor: { laneId: "jp-kita-dori-3-forward-1", distanceAlongM: 69 }, footprint: point(12, 9), name: "Yotsuba Mart" },
      { id: "jp-v8", kind: "restaurant", anchor: { laneId: "jp-chuo-dori-2-reverse-1", distanceAlongM: 51 }, footprint: point(12, 9), name: "Menya Sakura" },
      // distanceAlongM 54 -> 68 (rail feature): at 54 the lot sat at z=-6,
      // square on the Setagaya Line's corridor — the rail audit's first real
      // catch. 68 puts the ramen shop just north of the crossing instead.
      { id: "jp-v9", kind: "restaurant", anchor: { laneId: "jp-ichiban-dori-2-forward-1", distanceAlongM: 68 }, footprint: point(12, 9), name: "Ichiban Ramen" },
      { id: "jp-v10", kind: "restaurant", anchor: { laneId: "jp-niban-dori-3-reverse-1", distanceAlongM: 51 }, footprint: point(12, 9), name: "Izakaya Tsukikage" },
      { id: "jp-v11", kind: "restaurant", anchor: { laneId: "jp-minami-dori-4-forward-1", distanceAlongM: 69 }, footprint: point(12, 9), name: "Torigen" },
      { id: "jp-v12", kind: "restaurant", anchor: { laneId: "jp-eki-mae-dori-3-reverse-1", distanceAlongM: 69 }, footprint: point(12, 9), name: "Sushi Kotobuki" },
      { id: "jp-v13", kind: "restaurant", anchor: { laneId: "jp-niban-dori-4-reverse-1", distanceAlongM: 90 }, footprint: point(12, 9), name: "Curry House Sakura" },
      // The owner explicitly asked for a diner called out by name.
      { id: "jp-v14", kind: "restaurant", anchor: { laneId: "jp-chuo-dori-4-forward-1", distanceAlongM: 90 }, footprint: point(12, 9), name: "Blue Moon Diner" },
      { id: "jp-v15", kind: "restaurant", anchor: { laneId: "jp-minami-dori-3-reverse-1", distanceAlongM: 69 }, footprint: point(12, 9), name: "Cafe Hikari" },
      { id: "jp-v16", kind: "office", anchor: { laneId: "jp-chuo-dori-3-reverse-1", distanceAlongM: 51 }, footprint: point(14, 12), name: "Sakuragawa Trading Co." },
      { id: "jp-v17", kind: "office", anchor: { laneId: "jp-kita-dori-4-reverse-1", distanceAlongM: 69 }, footprint: point(14, 12), name: "Chuo Business Tower" },
      { id: "jp-v18", kind: "residence", anchor: { laneId: "jp-eki-mae-dori-4-forward-1", distanceAlongM: 69 }, footprint: point(12, 10), name: "Ekimae Residence" },
      // Shotengai (6): the Nakamise Yokochō shophouse strip — bento, taiyaki
      // and tempura counters, a grocer, a konbini, one residence above.
      { id: "jp-v19", kind: "restaurant", anchor: { laneId: "jp-nakamise-yokocho-1-forward-1", distanceAlongM: 30 }, footprint: point(12, 9), name: "Nakamise Bento" },
      { id: "jp-v20", kind: "restaurant", anchor: { laneId: "jp-nakamise-yokocho-1-reverse-1", distanceAlongM: 102 }, footprint: point(12, 9), name: "Taiyaki Koban" },
      { id: "jp-v21", kind: "restaurant", anchor: { laneId: "jp-nakamise-yokocho-2-forward-1", distanceAlongM: 69 }, footprint: point(12, 9), name: "Tenpura Yokocho" },
      { id: "jp-v22", kind: "shop", anchor: { laneId: "jp-nakamise-yokocho-2-reverse-1", distanceAlongM: 57 }, footprint: point(12, 9), name: "Yokocho Grocer" },
      { id: "jp-v23", kind: "shop", anchor: { laneId: "jp-nakamise-yokocho-1-forward-1", distanceAlongM: 90 }, footprint: point(12, 9), name: "Hoshi Mart Yokocho" },
      { id: "jp-v24", kind: "residence", anchor: { laneId: "jp-nakamise-yokocho-1-reverse-1", distanceAlongM: 42 }, footprint: point(12, 10), name: "Yokocho Flats" },
      // Quarter (+1): a new konbini a short walk from Gotokuji station,
      // fronting jp-block-center — the old neighbourhood's own block, not a
      // generated one.
      { id: "jp-v25", kind: "shop", anchor: { laneId: "jp-center-west-2", distanceAlongM: 69 }, footprint: point(12, 9), name: "Hoshi Mart Gotokuji" },
      // North / Miyanosaka (6): ~60/40 pickup-capable vs not.
      { id: "jp-v26", kind: "restaurant", anchor: { laneId: "jp-mn-suzukake-dori-1-forward-1", distanceAlongM: 99 }, footprint: point(12, 9), name: "Suzukake Ramen" },
      { id: "jp-v27", kind: "shop", anchor: { laneId: "jp-mn-suzukake-dori-1-reverse-1", distanceAlongM: 150 }, footprint: point(12, 9), name: "Hoshi Mart Suzukake" },
      { id: "jp-v28", kind: "shop", anchor: { laneId: "jp-mn-fujimi-dori-1-forward-1", distanceAlongM: 60 }, footprint: point(12, 9), name: "Fujimi Grocer" },
      { id: "jp-v29", kind: "restaurant", anchor: { laneId: "jp-mn-momiji-dori-1-forward-1", distanceAlongM: 120 }, footprint: point(12, 9), name: "Momiji Bakery" },
      { id: "jp-v30", kind: "residence", anchor: { laneId: "jp-mn-wakaba-dori-1-forward-1", distanceAlongM: 201 }, footprint: point(12, 10), name: "Miyanosaka Residence" },
      // jp-mn-kaede-dori (one-way reverse) has a real block on its "+1"
      // flank but no forward lane to reach it, and none at all on "-1" — the
      // solver correctly refused it; jp-mn-sumire-dori (also one-way
      // reverse) has a real block on the reachable "-1" flank instead.
      { id: "jp-v31", kind: "office", anchor: { laneId: "jp-mn-sumire-dori-1-reverse-1", distanceAlongM: 300 }, footprint: point(14, 12), name: "Kaede Office" },
      // South / Yamashita (5).
      { id: "jp-v32", kind: "restaurant", anchor: { laneId: "jp-ys-yanagi-dori-1-forward-1", distanceAlongM: 150 }, footprint: point(12, 9), name: "Yanagi Diner" },
      { id: "jp-v33", kind: "shop", anchor: { laneId: "jp-ys-yanagi-dori-2-reverse-1", distanceAlongM: 60 }, footprint: point(12, 9), name: "Hoshi Mart Yanagi" },
      { id: "jp-v34", kind: "residence", anchor: { laneId: "jp-ys-hagi-dori-1-reverse-1", distanceAlongM: 300 }, footprint: point(12, 10), name: "Yamashita Residence" },
      { id: "jp-v35", kind: "office", anchor: { laneId: "jp-ys-botan-dori-1-forward-1", distanceAlongM: 120 }, footprint: point(14, 12), name: "Botan Office" },
      { id: "jp-v36", kind: "shop", anchor: { laneId: "jp-ys-ichou-dori-1-reverse-1", distanceAlongM: 300 }, footprint: point(12, 9), name: "Ichou Grocer" },
      // West / Nishi (3).
      { id: "jp-v37", kind: "restaurant", anchor: { laneId: "jp-ni-hato-dori-1-forward-1", distanceAlongM: 99 }, footprint: point(12, 9), name: "Hato Cafe" },
      { id: "jp-v38", kind: "shop", anchor: { laneId: "jp-ni-hato-dori-1-reverse-1", distanceAlongM: 201 }, footprint: point(12, 9), name: "Nishi Grocer" },
      { id: "jp-v39", kind: "residence", anchor: { laneId: "jp-ni-ume-dori-1-forward-1", distanceAlongM: 60 }, footprint: point(12, 10), name: "Nishi Residence" },
      // East bank (6): riverside cafe/restaurant/konbini/office/residence +
      // a depot for parcel-flavour pickups. jp-kawagishi-dori only ever
      // anchors on "p" (forward) — its "-1" side is the open river frontage
      // (`TOKYO_OPEN_WATERFRONT_SIDES`), correctly walled off from R18's
      // street-wall generator and so from venues too.
      { id: "jp-v40", kind: "restaurant", anchor: { laneId: "jp-kawagishi-dori-3-forward-1", distanceAlongM: 129 }, footprint: point(12, 9), name: "Kawagishi Riverside Cafe" },
      { id: "jp-v41", kind: "restaurant", anchor: { laneId: "jp-higashi-hondori-4-forward-1", distanceAlongM: 189 }, footprint: point(12, 9), name: "Higashi Grill" },
      { id: "jp-v42", kind: "shop", anchor: { laneId: "jp-higashi-dori-3-forward-1", distanceAlongM: 111 }, footprint: point(12, 9), name: "Hoshi Mart Higashi" },
      { id: "jp-v43", kind: "office", anchor: { laneId: "jp-higashi-hondori-2-reverse-1", distanceAlongM: 105 }, footprint: point(14, 12), name: "Higashi Trading Office" },
      { id: "jp-v44", kind: "residence", anchor: { laneId: "jp-tofu-yokocho-2-reverse-1", distanceAlongM: 105 }, footprint: point(12, 10), name: "Hondori Residence" },
      // No dedicated depot glb (Cairo's `cairo-depot` is a Cairo-specific
      // import); `modelId: "shop"` gives it a real measured footprint to
      // collide against (`PROP_MODEL_FOOTPRINTS_M` has no bare "depot" row —
      // `tests/staticColliders.test.ts` requires every venue resolve one) —
      // the generic small-commercial box, matching the plan's own "generic
      // kind models are fine" allowance rather than a Cairo-styled import.
      { id: "jp-v45", kind: "depot", modelId: "shop", anchor: { laneId: "jp-higashi-hondori-3-reverse-1", distanceAlongM: 174 }, footprint: point(14, 10), name: "Sakuragawa Depot" },
      // Ekimae-nishi (8, Tokyo authenticity plan P4, Region B): the
      // konbini/famiresu/diner cluster the owner asked for (plan §6.4) —
      // 2 Hoshi Mart branches, 3 restaurants (ramen/izakaya/family diner)
      // and 2 general shops on the shopping street, one residence on the
      // collector for gig variety. `modelId` added by P9 ("venue models'
      // final polish" — this comment originally deferred it to that phase;
      // it now IS that phase): every "Hoshi Mart" shop takes
      // `tokyo-konbini`, "Tsukimi Ramen" takes `tokyo-ramen` and "Izakaya
      // Yoimachi" takes `tokyo-izakaya` by name match, and "Hinata Diner"
      // (a generic family diner, no imported model of its own) takes
      // `tokyo-izakaya` too — still an authentic Japanese eatery silhouette,
      // and the only way a "diner" reads as Setagaya rather than generic
      // Western fast food. Re-verified (scratchpad, the real
      // `resolveVenuePlacement`) that every reassigned footprint keeps its
      // venue inside the SAME real `buildingSet` block as before (shift
      // 0.1-1.7 m, never past a block boundary) and >=22 m from every other
      // venue/service point — see PROP_MODEL_REGISTRY's own header for the
      // facing-confidence caveat on konbini. jp-v51/52 (bakery/stationery)
      // stay generic: no imported model matches either. Every anchor below
      // was found the same way Phase 7's did: a scratchpad solver calling
      // the real `resolveVenuePlacement` (never a hand estimate), keeping
      // only results that land inside a real `buildingSet` block (not a
      // holdback facade-box one) and >=22 m from every other venue/service
      // point already on the map — see the PR body for the solver script.
      { id: "jp-v46", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-ekimae-nishi-dori-1-reverse-1", distanceAlongM: 291 }, footprint: point(12, 9), name: "Hoshi Mart Ekimae-Nishi" },
      { id: "jp-v47", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-nakasuji-dori-3-forward-1", distanceAlongM: 130 }, footprint: point(12, 9), name: "Hoshi Mart Nakasuji" },
      { id: "jp-v48", kind: "restaurant", modelId: "tokyo-ramen", anchor: { laneId: "jp-ekimae-nishi-dori-1-reverse-1", distanceAlongM: 120 }, footprint: point(12, 9), name: "Tsukimi Ramen" },
      { id: "jp-v49", kind: "restaurant", modelId: "tokyo-izakaya", anchor: { laneId: "jp-ekimae-nishi-dori-2-forward-1", distanceAlongM: 40 }, footprint: point(12, 9), name: "Izakaya Yoimachi" },
      // The owner's own "famiresu" ask (plan §6.4's "Gusto-style diner") —
      // an original name, the same way jp-v14's "Blue Moon Diner" invented
      // one rather than naming a real chain.
      { id: "jp-v50", kind: "restaurant", modelId: "tokyo-izakaya", anchor: { laneId: "jp-ekimae-nishi-dori-3-forward-1", distanceAlongM: 60 }, footprint: point(12, 9), name: "Hinata Diner" },
      { id: "jp-v51", kind: "shop", anchor: { laneId: "jp-sakuramachi-dori-1-forward-1", distanceAlongM: 150 }, footprint: point(12, 9), name: "Sakuramachi Bakery" },
      { id: "jp-v52", kind: "shop", anchor: { laneId: "jp-tsukimi-dori-2-forward-1", distanceAlongM: 50 }, footprint: point(12, 9), name: "Ekimae-Nishi Stationery" },
      { id: "jp-v53", kind: "residence", anchor: { laneId: "jp-nakasuji-dori-1-reverse-1", distanceAlongM: 40 }, footprint: point(12, 10), name: "Nakasuji Flats" },
      // Hanamizu (Tokyo authenticity plan P5, Region A): the konbini +
      // restaurant pair at the collector corner (plan §6.4) — both anchors
      // solver-verified against the real resolveVenuePlacement (never a hand
      // estimate) to land inside a real buildingSet block, comfortably clear
      // of every other venue/service point already on the map (>250 m here,
      // a brand-new district) and >=22 m from each other (41.3 m). `modelId`
      // added P9, re-verified against the same block/clearance bar (see the
      // Ekimae-nishi block's own comment above for the methodology).
      { id: "jp-v54", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-hanamizuki-dori-1-forward-1", distanceAlongM: 170 }, footprint: point(12, 9), name: "Hoshi Mart Hanamizu" },
      { id: "jp-v55", kind: "restaurant", modelId: "tokyo-ramen", anchor: { laneId: "jp-yuri-dori-2-forward-1", distanceAlongM: 160 }, footprint: point(12, 9), name: "Hanamizu Shokudō" },
      // Sumiregaoka (Tokyo authenticity plan P6, Region C): a small shop +
      // restaurant pair on the collector, both anchored on its forward
      // (+1/"p"-side) lane — the reverse side's own block along this stretch
      // is a holdback facade-box parcel (`set=undefined`, the ~1-in-4 roll),
      // confirmed by the same solver, so both deliberately anchor the side
      // that actually lands on a real `tokyo-apato` block. Solver-verified
      // against the real resolveVenuePlacement (never a hand estimate):
      // both land inside a real buildingSet block, comfortably clear of
      // every other venue/service point already on the map (>190 m here, a
      // brand-new district) and >=22 m from each other (222 m). `modelId`
      // added P9, re-verified the same way.
      { id: "jp-v56", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-sumiregaoka-dori-1-forward-1", distanceAlongM: 60 }, footprint: point(12, 9), name: "Hoshi Mart Sumiregaoka" },
      { id: "jp-v57", kind: "restaurant", modelId: "tokyo-izakaya", anchor: { laneId: "jp-sumiregaoka-dori-2-forward-1", distanceAlongM: 50 }, footprint: point(12, 9), name: "Sumire Teishoku" },
      // Minamimachi (Tokyo authenticity plan P7, Region D): the konbini +
      // restaurant pair (plan §6.4), both on jp-minamimachi-dori's own
      // segment 2 (east of the jp-shion-x-minamimachi crossing, well clear
      // of the gas/repair pair on segment 1), both anchored on the reverse
      // lane — the forward side's own block along this stretch is a
      // holdback facade-box parcel (`set=undefined`, the ~1-in-4 roll),
      // confirmed by the same solver, so both deliberately anchor the side
      // that actually lands on a real `tokyo-house` block, the same
      // deliberate-side-pick Sumiregaoka's own pair above made. Solver-
      // verified against the real resolveVenuePlacement: both land inside a
      // real buildingSet block, comfortably clear of every other venue/
      // service point already on the map (>=280 m here, a brand-new
      // district) and >=22 m from each other (60 m) and from this phase's
      // own two service points (>=490 m). `modelId` added P9, re-verified
      // the same way.
      { id: "jp-v58", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-minamimachi-dori-2-reverse-1", distanceAlongM: 100 }, footprint: point(12, 9), name: "Hoshi Mart Minamimachi" },
      { id: "jp-v59", kind: "restaurant", modelId: "tokyo-ramen", anchor: { laneId: "jp-minamimachi-dori-2-reverse-1", distanceAlongM: 160 }, footprint: point(12, 9), name: "Minamimachi Shokudō" },
      // Nishi Minami (Tokyo authenticity plan P8, Region E): the plan's own
      // "1 pocket venue" (§6.2) — a single corner shop roughly centred in
      // the 380 m void (x=-950 is this region's own bbox midpoint). Solver-
      // verified against the real resolveVenuePlacement: lands inside a real
      // `tokyo-house` block, >=290 m clear of every other venue/service
      // point already on the map (a brand-new district). `modelId` added
      // P9, re-verified the same way.
      { id: "jp-v60", kind: "shop", modelId: "tokyo-konbini", anchor: { laneId: "jp-hiiragi-dori-1-forward-1", distanceAlongM: 240 }, footprint: point(12, 9), name: "Hoshi Mart Nishi Minami" },
    ],
    landmarks: [
      { id: "jp-gotokuji-station", kind: "station", center: point(-14, 6), size: point(20, 9), color: "#e85e59" },
      // The three `kind: "railway"` decal landmarks that used to sketch the
      // Setagaya Line here (a 5x72 stub + two z=-10 extension bands) are
      // retired: `geometry.railLines` below is now the single source of truth
      // for the track, and `render/railLayer.ts` builds real ballast, rails
      // and sleepers along its polyline — including the jog the decal
      // renderer could never draw. Prop scatter's corridor keep-out follows
      // the same polyline (`railCorridorExclusionRects`), so nothing scatters
      // onto the right-of-way the rects used to shield.
      // The quarter's three parks — hoisted to `TOKYO_QUARTER_PARKS` above
      // (Tokyo expansion Phase 4) so the street-wall generator can check a
      // candidate parcel against them (R18 never walls a park frontage)
      // without a second copy of these three rects.
      ...TOKYO_QUARTER_PARKS,
      // Tokyo expansion Phase 6 (R4): the new parks, hoisted to
      // `TOKYO_PHASE6_PARKS` for the same reason as the quarter's three
      // above. `jp-kitazawa-pond` lives in `waterBodies`, not here.
      ...TOKYO_PHASE6_PARKS,
      { id: "jp-carrot-tower", kind: "tower", center: point(60, 60), size: point(12, 12), color: "#b6553f" },
      // Bridge landmarks (Phase 3): id equals the bridge's own road id, which
      // is how the water body's bridgePortalSurfaceIds and the dressing
      // builder (render/tokyoLandmarks.ts) find the right road surface.
      // size = (spanLengthM, widthM) — widthM is the carriageway alone
      // (matches the road spec), not the padded footway axis the renderer
      // re-derives from cairoBridgePortalVisualAxis. headingDeg 90: every
      // span is dead straight, pointing east (NYC's own bridges use the same
      // heading for the same reason).
      { id: "jp-sakura-ohashi", kind: "bridge", center: point(650, -168), size: point(420, 12), headingDeg: 90, color: "#7d8791" },
      { id: "jp-kawanaka-bashi", kind: "bridge", center: point(780, 180), size: point(400, 9), headingDeg: 90, color: "#7d8791" },
      { id: "jp-tsuki-ohashi", kind: "bridge", center: point(640, 560), size: point(480, 12), headingDeg: 90, color: "#7d8791" },
      // Hikari Tower (Tokyo expansion Phase 8, R15): the district beacon,
      // built directly on `jp-tower-park`'s own real ground (see that
      // park's own comment above — Phase 6 centred the plaza at (1053,140),
      // 33 m east of the plan's original (1020,140), because the plan's own
      // number sat the plaza across jp-higashi-hondori's live carriageway).
      // Centred on the plaza's own centre: half-extents 63x50 against this
      // landmark's own 22x22 leave >=28 m of open plaza on every side, so
      // the tower reads as freestanding rather than crowding a road-facing
      // edge. Procedural bespoke render (four leaning lattice legs, a main
      // and upper deck, a spire and beacon) in render/tokyoLandmarks.ts;
      // ground solids (four leg OBBs + the FootTown-analog podium) in
      // geometry/landmarkGroundSolids.ts's TOKYO_RECIPES — both keyed off
      // this exact id. No headingDeg: the four-fold leg layout is already
      // rotationally symmetric, same as jp-carrot-tower above.
      { id: "jp-hikari-tower", kind: "tower", center: point(1053, 140), size: point(44, 44), color: "#c2703a" },
    ],
    // See TOKYO_RAIL_LINES above (hoisted so the block carver reads the same
    // polyline this field publishes).
    railLines: TOKYO_RAIL_LINES,
  },
  laneGraph: graph(
    [...jpNodesList, ...tokyoGenNodeList],
    tokyoAllLanes,
    [
      tokyoRailCrossingMiyanosaka.control,
      tokyoRailCrossingShotengai.control,
      control("jp-rail-signal", "railway_signal", 18, -72, 90, ["jp-south-east-2", "jp-south-west-2"], ["jp-rail-conflict"],
        [
          approach("jp-rail-eastbound-approach", "jp-south-east-2", 42, "railway", ["jp-rail-conflict"]),
          approach("jp-rail-westbound-approach", "jp-south-west-2", 48, "railway", ["jp-rail-conflict"]),
        ],
        [
          installation("jp-rail-east-crossing", 12, -77, 90, "railway_crossing", "japan_railway", "primary"),
          installation("jp-rail-west-crossing", 24, -67, 270, "railway_crossing", "japan_railway", "secondary"),
        ]),
      // Second level crossing (Tokyo expansion Phase 5, §8.6): the rail
      // extension above crosses jp-ichiban-dori at (180,-10). Cloned in
      // SHAPE from jp-rail-signal above (control + railway_signal approach +
      // two japan_railway installations + its own conflict zone), not byte-
      // for-byte: this road is one-way north (a single lane, not two), and
      // the crossing runs perpendicular to jp-rail-signal's own (rail E-W
      // here vs N-S there), so the gate positions are derived from the
      // lane's own heading/left-hand-kerb geometry rather than copied
      // numbers. jp-ichiban-dori-2-forward-1 runs dead straight (x=180) from
      // z=-60 to z=40, so distanceAlongM = z + 60 exactly; two gates (before
      // and after the crossing, both on the west/left kerb — the only side
      // this one-way road has traffic on) rather than jp-rail-signal's one-
      // per-direction pair.
      control("jp-rail-signal-2", "railway_signal", 180, -10, 90, ["jp-ichiban-dori-2-forward-1"], ["jp-rail-conflict-2"],
        [approach("jp-rail-2-approach", "jp-ichiban-dori-2-forward-1", 50, "railway", ["jp-rail-conflict-2"])],
        [
          installation("jp-rail-2-south-crossing", 175.5, -16, 0, "railway_crossing", "japan_railway", "primary"),
          installation("jp-rail-2-north-crossing", 175.5, -4, 0, "railway_crossing", "japan_railway", "secondary"),
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
      // Shotengai ends (Tokyo expansion Phase 5, §9 item 4): Nakamise
      // Yokochō's own two real ends (jp-ichiban-x-nakamise west,
      // jp-chuo-x-nakamise east) get a marked crossing of the "real" car
      // road they meet — the shotengai's MIDDLE crossing (jp-niban-dori, at
      // jp-niban-x-nakamise) stays a plain stop, not a mouth. Positioned a
      // couple of metres shy of each junction node (never exactly on it, so
      // the marking reads as its own crossing rather than junction paint).
      control("jp-crosswalk-shotengai-west", "crosswalk", 180, 38, 0, ["jp-ichiban-dori-2-forward-1"], ["jp-shotengai-west-conflict"],
        [approach("jp-shotengai-west-crosswalk", "jp-ichiban-dori-2-forward-1", 98, "crosswalk", ["jp-shotengai-west-conflict"])],
        [installation("jp-shotengai-west-crosswalk-marking", 180, 38, 0, "road_marking", "crosswalk", "marking")]),
      control("jp-crosswalk-shotengai-east", "crosswalk", 440, 38, 0, ["jp-chuo-dori-2-forward-1", "jp-chuo-dori-2-forward-2", "jp-chuo-dori-3-reverse-1", "jp-chuo-dori-3-reverse-2"], ["jp-shotengai-east-conflict"],
        [
          approach("jp-shotengai-east-crosswalk-s", "jp-chuo-dori-2-forward-1", 98, "crosswalk", ["jp-shotengai-east-conflict"]),
          approach("jp-shotengai-east-crosswalk-n", "jp-chuo-dori-3-reverse-1", 98, "crosswalk", ["jp-shotengai-east-conflict"]),
        ],
        [installation("jp-shotengai-east-crosswalk-marking", 440, 38, 0, "road_marking", "crosswalk", "marking")]),
      // Temple gate (§9 item 4): jp-temple-green's own nearest road frontage
      // — jp-junction-road, ~9 m past the block behind the park's west edge
      // (the other two quarter parks, jp-gotokuji-temple/jp-shoin-shrine,
      // sit 40+ m from any road; a crossing there would not read as "at the
      // gate" to any camera, so this phase adds only the one the geometry
      // actually supports — see the PR for the measured distances).
      control("jp-crosswalk-temple-green", "crosswalk", 82, 47.5, 90, ["jp-junction-south", "jp-junction-north"], ["jp-temple-gate-conflict"],
        [
          approach("jp-temple-gate-crosswalk-s", "jp-junction-south", 29, "crosswalk", ["jp-temple-gate-conflict"]),
          approach("jp-temple-gate-crosswalk-n", "jp-junction-north", 39, "crosswalk", ["jp-temple-gate-conflict"]),
        ],
        [installation("jp-temple-gate-crosswalk-marking", 82, 47.5, 90, "road_marking", "crosswalk", "marking")]),
      ...tokyoGeneratedHalf.generatedControls,
    ],
    [
      tokyoRailCrossingMiyanosaka.conflictZone,
      tokyoRailCrossingShotengai.conflictZone,
      { id: "jp-rail-conflict", laneIds: ["jp-south-east-2", "jp-south-west-2"], polygon: [point(12, -80), point(24, -80), point(24, -64), point(12, -64)] },
      { id: "jp-rail-conflict-2", laneIds: ["jp-ichiban-dori-2-forward-1"], polygon: [point(172, -18), point(188, -18), point(188, -2), point(172, -2)] },
      { id: "jp-station-conflict", laneIds: ["jp-center-west-2", "jp-narrow-north-1"], polygon: [point(-38, 10), point(-22, 10), point(-22, 26), point(-38, 26)] },
      { id: "jp-east-curve-junction-conflict", laneIds: ["jp-curve-north", "jp-curve-south", "jp-center-west-1", "jp-center-east-3"], polygon: [point(104, -26), point(120, -26), point(120, -10), point(104, -10)] },
      { id: "jp-east-neighbourhood-junction-conflict", laneIds: ["jp-center-west-1", "jp-center-east-3", "jp-junction-south", "jp-junction-north"], polygon: [point(46, 10), point(62, 10), point(62, 26), point(46, 26)] },
      { id: "jp-shotengai-west-conflict", laneIds: ["jp-ichiban-dori-2-forward-1", "jp-ichiban-dori-3-forward-1"], polygon: [point(172, 32), point(188, 32), point(188, 44), point(172, 44)] },
      { id: "jp-shotengai-east-conflict", laneIds: ["jp-chuo-dori-2-forward-1", "jp-chuo-dori-2-forward-2", "jp-chuo-dori-3-forward-1", "jp-chuo-dori-3-forward-2", "jp-chuo-dori-3-reverse-1", "jp-chuo-dori-3-reverse-2"], polygon: [point(432, 32), point(448, 32), point(448, 44), point(432, 44)] },
      { id: "jp-temple-gate-conflict", laneIds: ["jp-junction-south", "jp-junction-north"], polygon: [point(74, 40), point(90, 40), point(90, 55), point(74, 55)] },
      ...tokyoGeneratedHalf.generatedZones,
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
      // --- Generated-half spawns (Tokyo expansion Phase 2, R9) ---
      // Segment 1 is short (jp-kp-s to the first district rung it now picks
      // up, jp-ys-r1-kp, ~40m) now that the residential webs splice interior
      // nodes into the ring roads' own polylines — 20m stays safely inside
      // it regardless of which district lands closest to each ring end.
      anchoredSpawn("jp-car-kanpachi-n", "vehicle", "jp-kanpachi-dori-1-forward-1", 20),
      anchoredSpawn("jp-car-kanpachi-s", "vehicle", "jp-kanpachi-dori-1-reverse-1", 20),
      anchoredSpawn("jp-car-koshu", "vehicle", "jp-koshu-kaido-1-forward-1", 150),
      anchoredSpawn("jp-car-minami-kaido", "vehicle", "jp-minami-kaido-1-forward-1", 150),
      anchoredSpawn("jp-car-setagaya-w", "vehicle", "jp-setagaya-dori-west-1-forward-1", 150),
      anchoredSpawn("jp-car-chuo", "vehicle", "jp-chuo-dori-1-forward-1", 60),
      anchoredSpawn("jp-car-ekimae", "vehicle", "jp-eki-mae-dori-1-forward-1", 20),
      anchoredSpawn("jp-car-ichiban", "vehicle", "jp-ichiban-dori-1-forward-1", 90),
      anchoredSpawn("jp-car-mn-suzukake", "vehicle", "jp-mn-suzukake-dori-1-forward-1", 200),
      anchoredSpawn("jp-car-ys-yanagi", "vehicle", "jp-ys-yanagi-dori-1-reverse-1", 200),
      anchoredSpawn("jp-car-ni-hato", "vehicle", "jp-ni-hato-dori-1-forward-1", 200),
      freeSpawn("jp-ped-ekimae", "pedestrian", 300, 140, 0),
      freeSpawn("jp-cyclist-nakamise", "cyclist", 250, 40, 90, "jp-nakamise-yokocho-1-forward-1"),
      // Districts (top-up pattern, spread so a first arrival at each web
      // isn't bare — matches NYC's far-district gate pattern).
      freeSpawn("jp-ped-mn-suzukake", "pedestrian", -900, 850, 0),
      freeSpawn("jp-cyclist-mn-wakaba", "cyclist", -950, 650, 90, "jp-mn-wakaba-dori-1-forward-1"),
      freeSpawn("jp-ped-ys-yanagi", "pedestrian", -900, -970, 180),
      // jp-ys-ichou-dori is one-way "reverse" (Tokyo expansion Phase 5,
      // R11) — only the reverse-direction lane exists now.
      freeSpawn("jp-cyclist-ys-ichou", "cyclist", -950, -900, 90, "jp-ys-ichou-dori-1-reverse-1"),
      freeSpawn("jp-ped-ni-hato", "pedestrian", -900, 60, 90),
      freeSpawn("jp-cyclist-ni-tsuki", "cyclist", -950, -100, 90, "jp-ni-tsuki-dori-1-forward-1"),
      freeSpawn("jp-ped-ni-hana", "pedestrian", -350, 40, 45),
      freeSpawn("jp-ped-koshu", "pedestrian", -1080, 560, 0),
      // --- Bridges + east bank (Tokyo expansion Phase 3, R3/R9) ---
      // One vehicle anchor per bridge guarantees the acceptance sweep
      // actually drives across each one, not just past its mouth.
      anchoredSpawn("jp-car-sakura-ohashi", "vehicle", "jp-sakura-ohashi-1-forward-1", 20),
      anchoredSpawn("jp-car-kawanaka-bashi", "vehicle", "jp-kawanaka-bashi-1-forward-1", 20),
      anchoredSpawn("jp-car-tsuki-ohashi", "vehicle", "jp-tsuki-ohashi-1-forward-1", 20),
      anchoredSpawn("jp-car-higashi-hondori", "vehicle", "jp-higashi-hondori-1-forward-1", 100),
      anchoredSpawn("jp-car-kawagishi", "vehicle", "jp-kawagishi-dori-1-forward-1", 120),
      freeSpawn("jp-ped-tofu", "pedestrian", 870, -400, 0),
      freeSpawn("jp-cyclist-higashi", "cyclist", 980, 100, 0, "jp-higashi-hondori-3-forward-1"),
      // --- Street life & aesthetics (Tokyo expansion Phase 9, R13) ---
      // Phases 2/3 already covered the station front (jp-ped-ekimae) and the
      // shotengai (jp-cyclist-nakamise) per §4.16's own list; the promenade
      // was the one genuinely missing category, plus two bonus spots at the
      // districts Phases 6/8 added after that list was written.
      freeSpawn("jp-ped-kawabe", "pedestrian", 588, 0, 90),
      freeSpawn("jp-cyclist-kawabe", "cyclist", 582, 50, 0, "jp-kawate-dori-2-forward-1"),
      freeSpawn("jp-ped-tower-plaza", "pedestrian", 1053, 100, 0),
      freeSpawn("jp-ped-kitazawa", "pedestrian", -521, 760, 0),
    ],
  ),
};

export const TOKYO_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-jp",
  countryId: "jp",
  destinationId: "jp-tokyo",
  mapId: "tokyo-setagaya",
  startSpawnId: "jp-player",
  trafficSeed: 2401,
};
