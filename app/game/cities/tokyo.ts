import type {
  ConflictZone,
  FreeDriveDefinition,
  LaneNode,
  LaneSegment,
  MapPack,
  ProceduralBlock,
  RoadSurface,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WorldPoint,
} from "../types";
import { CONNECTOR_BLEND_RUN_M, buildLaneTrueGeometry } from "../laneConnectors";
import { hashStringToSeed, PAVED_SIDEWALK_WIDTH_M } from "../visuals";
import {
  anchoredSpawn,
  approach,
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
  tokyoRoad("jp-nishi-kanjo-dori", "Nishi Kanjō-dōri", ["jp-nk-s", "jp-ys-r1-nk", "jp-ys-coll-nk", "jp-ys-r3-nk", "jp-nk-minami", "jp-ys-r5-nk", "jp-nk-setagaya", "jp-ni-r1-nk", "jp-ni-coll-nk", "jp-ni-r3-nk", "jp-ni-r5-nk", "jp-nk-koshu", "jp-mn-r1-nk", "jp-mn-coll-nk", "jp-mn-r4-nk", "jp-mn-r7-nk", "jp-nk-n"], 2, 8, 40),
  tokyoRoad("jp-kanpachi-dori", "Kanpachi-dōri", ["jp-kp-s", "jp-ys-r1-kp", "jp-ys-r2-kp", "jp-ys-coll-kp", "jp-ys-r3-kp", "jp-ys-r4-kp", "jp-kp-minami", "jp-ys-r5-kp", "jp-ys-r6-kp", "jp-kp-setagaya", "jp-ni-r1-kp", "jp-ni-r2-kp", "jp-ni-coll-kp", "jp-ni-r3-kp", "jp-ni-r4-kp", "jp-ni-r5-kp", "jp-kp-koshu", "jp-mn-r6-kp", "jp-mn-r1-kp", "jp-mn-r2-kp", "jp-mn-coll-kp", "jp-mn-r4-kp", "jp-mn-r5-kp", "jp-mn-r7-kp", "jp-kp-n"], 2, 11, 50),
  tokyoRoad("jp-sangen-dori", "Sangen-dōri", ["jp-sg-s", "jp-ys-r2-sg", "jp-ys-coll-sg", "jp-ys-r4-sg", "jp-sg-minami", "jp-ys-r6-sg", "jp-sg-setagaya", "jp-ni-r2-sg", "jp-ni-coll-sg", "jp-ni-r4-sg", "jp-sg-koshu", "jp-mn-r6-sg", "jp-mn-r2-sg", "jp-mn-coll-sg", "jp-mn-r5-sg", "jp-sg-n"], 2, 8, 40),
  tokyoRoad("jp-yamashita-minami-dori", "Yamashita Minami-dōri", ["jp-nk-s", "jp-kp-s", "jp-sg-s"], 2, 7, 40),
  // Extends all the way to jp-chuo-n so Chūō-dōri-north's own far terminus
  // (its own spec's north end) closes into the ring instead of dead-ending —
  // both are at z=1140, so the extra segment costs no bend.
  tokyoRoad("jp-miyanosaka-kita-dori", "Miyanosaka Kita-dōri", ["jp-nk-n", "jp-kp-n", "jp-sg-n", "jp-chuo-n"], 2, 7, 40),
  tokyoRoad("jp-setagaya-dori-west", "Setagaya-dōri", ["jp-nk-setagaya", "jp-kp-setagaya", "jp-ss-w"], 2, 10, 50),
  tokyoRoad("jp-koshu-kaido", "Kōshū-kaidō", ["jp-nk-koshu", "jp-kp-koshu", "jp-sg-koshu", "jp-chuo-x-koshu"], 2, 12, 60),
  tokyoRoad("jp-minami-kaido", "Minami-kaidō", ["jp-nk-minami", "jp-kp-minami", "jp-sg-minami", "jp-chuo-x-minami-kaido"], 2, 10, 50),

  tokyoRoad("jp-setagaya-dori-east", "Setagaya-dōri", ["jp-ss-e", "jp-ichiban-x-setagaya", "jp-niban-x-setagaya", "jp-chuo-x-setagaya"], 2, 10, 50),
  tokyoRoad("jp-chuo-dori-south", "Chūō-dōri", ["jp-chuo-x-minami-kaido", "jp-chuo-x-setagaya"], 2, 10, 50),
  tokyoRoad("jp-chuo-dori", "Chūō-dōri", ["jp-chuo-x-setagaya", "jp-chuo-x-minami-dori", "jp-chuo-x-nakamise", "jp-chuo-x-ekimae", "jp-chuo-x-kita-dori"], 4, 13.6, 50),
  tokyoRoad("jp-chuo-dori-north", "Chūō-dōri", ["jp-chuo-x-kita-dori", "jp-chuo-x-koshu", "jp-chuo-n"], 2, 10, 50),
  // Extended both ends in Phase 3 to reach Sakura-ōhashi (south) and
  // Tsuki-ōhashi (north) — see jpRiverNodes below. jp-kawate-x-kawanaka is a
  // node newly inserted into this spec's own interior (between the existing
  // jp-kawate-x-ekimae and jp-kawate-x-kita-dori), not a hand-authored-quarter
  // polyline, so resegmenting it is ordinary generator work (plan §4.4's
  // caveat); no Phase-2 spawn/venue anchors this road by distance (verified
  // by grep before the split), so the lane-id renumbering it causes is safe.
  tokyoRoad("jp-kawate-dori", "Kawate-dōri", ["jp-kawate-x-setagaya", "jp-kawate-x-minami-dori", "jp-kawate-x-ekimae", "jp-kawate-x-kawanaka", "jp-kawate-x-kita-dori", "jp-kawate-x-koshu"], 2, 8, 40),
  tokyoRoad("jp-eki-mae-dori", "Ekimae-dōri", ["jp-ekimae-w", "jp-ichiban-x-ekimae", "jp-niban-x-ekimae", "jp-chuo-x-ekimae", "jp-kawate-x-ekimae"], 2, 9, 40),
  tokyoRoad("jp-ichiban-dori", "Ichiban-dōri", ["jp-ichiban-x-setagaya", "jp-ichiban-x-minami-dori", "jp-ichiban-x-nakamise", "jp-ichiban-x-ekimae", "jp-ichiban-x-kita-dori"], 1, 7, 40, { oneWay: "forward" }),
  tokyoRoad("jp-niban-dori", "Niban-dōri", ["jp-niban-x-setagaya", "jp-niban-x-minami-dori", "jp-niban-x-nakamise", "jp-niban-x-ekimae", "jp-niban-x-kita-dori"], 1, 7, 40, { oneWay: "reverse" }),
  tokyoRoad("jp-minami-dori", "Minami-dōri", ["jp-minami-dori-w", "jp-ichiban-x-minami-dori", "jp-niban-x-minami-dori", "jp-chuo-x-minami-dori", "jp-kawate-x-minami-dori"], 2, 8, 40),
  tokyoRoad("jp-kita-dori", "Kita-dōri", ["jp-kita-dori-w", "jp-ichiban-x-kita-dori", "jp-niban-x-kita-dori", "jp-chuo-x-kita-dori", "jp-kawate-x-kita-dori"], 2, 8, 40),
  tokyoRoad("jp-nakamise-yokocho", "Nakamise Yokochō", ["jp-ichiban-x-nakamise", "jp-niban-x-nakamise", "jp-chuo-x-nakamise"], 2, 5.8, 20, { surfaceType: "shared_space" }),
  tokyoRoad("jp-renraku-dori", "Renraku-dōri", ["jp-d", "jp-shotengai-nishi-x-renraku"], 2, 7, 40),
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

  tokyoJunction("jp-jct-ss-w", "jp-ss-w", ["jp-setagaya-dori-west", "jp-setagaya-dori", "jp-westside-south"]),
  tokyoJunction("jp-jct-ss-e", "jp-ss-e", ["jp-setagaya-dori-east", "jp-setagaya-dori", "jp-eastside-road"]),
  tokyoJunction("jp-jct-d", "jp-d", ["jp-renraku-dori", "jp-east-curve", "jp-center-road"]),
  tokyoJunction("jp-jct-ne2", "jp-ne2", ["jp-uptown-higashi", "jp-uptown-road", "jp-easthill-road"]),

  tokyoJunction("jp-jct-ichiban-setagaya", "jp-ichiban-x-setagaya", ["jp-ichiban-dori", "jp-setagaya-dori-east"]),
  tokyoJunction("jp-jct-niban-setagaya", "jp-niban-x-setagaya", ["jp-niban-dori", "jp-setagaya-dori-east"]),
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
  tokyoJunction("jp-jct-shotengai-renraku", "jp-shotengai-nishi-x-renraku", ["jp-shotengai-nishi-dori", "jp-renraku-dori"]),
  tokyoJunction("jp-jct-kita-dori-w", "jp-kita-dori-w", ["jp-kita-dori", "jp-shotengai-nishi-dori"]),
  tokyoJunction("jp-jct-ekimae-w", "jp-ekimae-w", ["jp-eki-mae-dori", "jp-shotengai-nishi-dori"]),
  tokyoJunction("jp-jct-shotengai-uptown", "jp-shotengai-nishi-x-uptown", ["jp-shotengai-nishi-dori", "jp-uptown-higashi"]),
];

const TOKYO_MIYANOSAKA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-mn-r6-kp", "jp-mn-r6-kp", ["jp-kanpachi-dori", "jp-mn-asahi-dori"]),
  tokyoJunction("jp-jct-mn-r6-sg", "jp-mn-r6-sg", ["jp-sangen-dori", "jp-mn-asahi-dori"]),
  tokyoJunction("jp-jct-mn-r1-nk", "jp-mn-r1-nk", ["jp-nishi-kanjo-dori", "jp-mn-wakaba-dori"]),
  tokyoJunction("jp-jct-mn-r1-kp", "jp-mn-r1-kp", ["jp-kanpachi-dori", "jp-mn-wakaba-dori"]),
  tokyoJunction("jp-jct-mn-r2-kp", "jp-mn-r2-kp", ["jp-kanpachi-dori", "jp-mn-fujimi-dori"]),
  tokyoJunction("jp-jct-mn-r2-sg", "jp-mn-r2-sg", ["jp-sangen-dori", "jp-mn-fujimi-dori"]),
  tokyoJunction("jp-jct-mn-stem-n", "jp-mn-stem-n", ["jp-mn-fujimi-dori", "jp-mn-suzukake-yokocho"]),
  tokyoJunction("jp-jct-mn-coll-nk", "jp-mn-coll-nk", ["jp-nishi-kanjo-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-coll-kp", "jp-mn-coll-kp", ["jp-kanpachi-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-stem-s", "jp-mn-stem-s", ["jp-mn-suzukake-dori", "jp-mn-suzukake-yokocho"]),
  tokyoJunction("jp-jct-mn-coll-sg", "jp-mn-coll-sg", ["jp-sangen-dori", "jp-mn-suzukake-dori"]),
  tokyoJunction("jp-jct-mn-r4-nk", "jp-mn-r4-nk", ["jp-nishi-kanjo-dori", "jp-mn-sumire-dori"]),
  tokyoJunction("jp-jct-mn-r4-kp", "jp-mn-r4-kp", ["jp-kanpachi-dori", "jp-mn-sumire-dori"]),
  tokyoJunction("jp-jct-mn-r5-kp", "jp-mn-r5-kp", ["jp-kanpachi-dori", "jp-mn-momiji-dori"]),
  tokyoJunction("jp-jct-mn-r5-sg", "jp-mn-r5-sg", ["jp-sangen-dori", "jp-mn-momiji-dori"]),
  tokyoJunction("jp-jct-mn-r7-nk", "jp-mn-r7-nk", ["jp-nishi-kanjo-dori", "jp-mn-kaede-dori"]),
  tokyoJunction("jp-jct-mn-r7-kp", "jp-mn-r7-kp", ["jp-kanpachi-dori", "jp-mn-kaede-dori"]),
];

const TOKYO_YAMASHITA_CONNECTORS: readonly TokyoJunctionConnectorSpec[] = [
  tokyoJunction("jp-jct-ys-r1-nk", "jp-ys-r1-nk", ["jp-nishi-kanjo-dori", "jp-ys-tsubaki-dori"]),
  tokyoJunction("jp-jct-ys-r1-kp", "jp-ys-r1-kp", ["jp-kanpachi-dori", "jp-ys-tsubaki-dori"]),
  tokyoJunction("jp-jct-ys-r2-kp", "jp-ys-r2-kp", ["jp-kanpachi-dori", "jp-ys-ayame-dori"]),
  tokyoJunction("jp-jct-ys-r2-sg", "jp-ys-r2-sg", ["jp-sangen-dori", "jp-ys-ayame-dori"]),
  tokyoJunction("jp-jct-ys-stem-n", "jp-ys-stem-n", ["jp-ys-ayame-dori", "jp-ys-yanagi-yokocho"]),
  tokyoJunction("jp-jct-ys-coll-nk", "jp-ys-coll-nk", ["jp-nishi-kanjo-dori", "jp-ys-yanagi-dori"]),
  tokyoJunction("jp-jct-ys-coll-kp", "jp-ys-coll-kp", ["jp-kanpachi-dori", "jp-ys-yanagi-dori"]),
  tokyoJunction("jp-jct-ys-stem-s", "jp-ys-stem-s", ["jp-ys-yanagi-dori", "jp-ys-yanagi-yokocho"]),
  tokyoJunction("jp-jct-ys-coll-sg", "jp-ys-coll-sg", ["jp-sangen-dori", "jp-ys-yanagi-dori"]),
  tokyoJunction("jp-jct-ys-r3-nk", "jp-ys-r3-nk", ["jp-nishi-kanjo-dori", "jp-ys-ichou-dori"]),
  tokyoJunction("jp-jct-ys-r3-kp", "jp-ys-r3-kp", ["jp-kanpachi-dori", "jp-ys-ichou-dori"]),
  tokyoJunction("jp-jct-ys-r4-kp", "jp-ys-r4-kp", ["jp-kanpachi-dori", "jp-ys-botan-dori"]),
  tokyoJunction("jp-jct-ys-r4-sg", "jp-ys-r4-sg", ["jp-sangen-dori", "jp-ys-botan-dori"]),
  tokyoJunction("jp-jct-ys-r5-nk", "jp-ys-r5-nk", ["jp-nishi-kanjo-dori", "jp-ys-hagi-dori"]),
  tokyoJunction("jp-jct-ys-r5-kp", "jp-ys-r5-kp", ["jp-kanpachi-dori", "jp-ys-hagi-dori"]),
  tokyoJunction("jp-jct-ys-r6-kp", "jp-ys-r6-kp", ["jp-kanpachi-dori", "jp-ys-kikyo-dori"]),
  tokyoJunction("jp-jct-ys-r6-sg", "jp-ys-r6-sg", ["jp-sangen-dori", "jp-ys-kikyo-dori"]),
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
  tokyoJunction("jp-jct-ni-r4-sg", "jp-ni-r4-sg", ["jp-sangen-dori", "jp-ni-ran-dori"]),
  tokyoJunction("jp-jct-ni-r5-nk", "jp-ni-r5-nk", ["jp-nishi-kanjo-dori", "jp-ni-hibari-dori"]),
  tokyoJunction("jp-jct-ni-r5-kp", "jp-ni-r5-kp", ["jp-kanpachi-dori", "jp-ni-hibari-dori"]),
  // jp-cw already carries jp-westside-road (old quarter) both directions.
  tokyoJunction("jp-jct-ni-hana-cw", "jp-cw", ["jp-westside-road", "jp-ni-hana-dori"]),
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
  ...TOKYO_RIVER_SPECS,
  ...TOKYO_EAST_SPECS,
];
const tokyoJunctionConnectors: readonly TokyoJunctionConnectorSpec[] = [
  ...TOKYO_SKELETON_CONNECTORS,
  ...TOKYO_MIYANOSAKA_CONNECTORS,
  ...TOKYO_YAMASHITA_CONNECTORS,
  ...TOKYO_NISHI_CONNECTORS,
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
  "jp-shotengai-nishi-x-renraku",
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
// Street wall (Tokyo expansion Phase 4, R18): a roadside parcel behind both
// kerbs of every generated road, so no generated street reads as bare
// asphalt with grey nothing behind it. Tokyo stays a fully procedural-facade
// city (`buildingSets: []` in `visuals.ts`'s `MAP_VISUAL_PROFILES` — London
// already proved the procedural wall reads right, and no Japanese
// street-wall glb kit exists in this repo), so every parcel below is plain
// `{material, heightRange, density}` with no `buildingSet`/`streetEdges` —
// simpler than London's own call sites in that one respect.
//
// `tokyoRoadsideParcel` is this file's own copy of London's file-private
// `roadsideParcel` (`cities/london.ts`, search that name) — cloned rather
// than imported (it is not exported there, and Tokyo's own foreign-road
// universe differs), with the `buildingSetFor` branch dropped entirely since
// it is always a no-op here. Algorithm, verbatim from London: `side` is the
// sign of the road's RIGHT-HAND normal travelling `from`->`to` (+1 =
// driver's right), NOT a compass reading — get this backwards and parcels
// ship on the wrong kerb, the same class of bug as venues shipping on the
// wrong side (`docs/map-authoring.md`). Length is DERIVED, not authored: a
// parcel starts as long as its road segment (minus a 12 m inset each end)
// and the end nearer each violation retreats a metre at a time — never
// symmetric — until clear of every OTHER road's carriageway+pavement+0.7 m
// clearance, tested by real segment-to-span distance (corner-only checks
// miss a parcel whose long side straddles a crossing road with both corners
// clear). A parcel that cannot keep `TOKYO_MIN_PARCEL_HALF_LENGTH_M` (13, so
// a 26 m floor after the two 12 m end insets — an authored span under ~50 m
// ships NOTHING) is dropped rather than shipped as a slab in the road.
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

const TOKYO_ZONE_STYLE: Readonly<Record<TokyoBlockZone, TokyoZoneStyle>> = {
  // Low-rise residential webs (§8.8): "GAPPY IS FORBIDDEN at the kerb" —
  // wood-plaster/plaster, short, dense enough to read as a real
  // neighbourhood at 30 km/h.
  miyanosaka: { materials: ["wood-plaster", "plaster"], heightRange: [5, 14], density: 0.7, depthM: 30 },
  yamashita: { materials: ["wood-plaster", "plaster"], heightRange: [5, 13], density: 0.68, depthM: 30 },
  nishi: { materials: ["plaster", "wood-plaster"], heightRange: [5, 13], density: 0.66, depthM: 28 },
  // East bank: mixed mid-rise per §8.8.
  higashi: { materials: ["plaster", "concrete"], heightRange: [8, 22], density: 0.75, depthM: 32 },
  // The three N-S ring roads, the two E-W closers, and the Setagaya-dori/
  // Koshu-kaido/Minami-kaido arterials: wider carriageways threading through
  // (and between) the residential webs — a notch taller/denser than a pure
  // residential local, still low-rise.
  ring: { materials: ["plaster", "tile"], heightRange: [6, 16], density: 0.74, depthM: 34 },
  // Land side only — the river side is skipped entirely via
  // TOKYO_OPEN_WATERFRONT_SIDES. A mid-rise band reading as
  // riverside-adjacent, one notch shorter than the downtown core proper.
  riverside: { materials: ["tile", "plaster"], heightRange: [9, 21], density: 0.77, depthM: 34 },
  // Sakuragawa Downtown: the neon core, tall blocks (§8.8). jp-chuo-dori
  // itself overrides taller still (TOKYO_ROAD_STYLE_OVERRIDE below) — the
  // other downtown streets carry this base.
  downtown: { materials: ["tile", "plaster"], heightRange: [11, 27], density: 0.8, depthM: 36 },
};

/** Per-road deviations from its zone's base style — a handful of specific
 * streets that read better with their own numbers than their zone's shared
 * default (mirrors London's per-call-site hand-tuning, at the scale of one
 * override per interesting road instead of one per parcel). */
const TOKYO_ROAD_STYLE_OVERRIDE: Readonly<Partial<Record<string, Partial<TokyoZoneStyle>>>> = {
  // The 4-lane core: the tallest, densest street on the map, up to the
  // plan's own suggested [18,42] near the scramble.
  "jp-chuo-dori": { heightRange: [18, 42], density: 0.85, depthM: 40 },
  // The shotengai: a shared-space alley wants low, tight, densely-packed
  // shophouses, not office-block height — a deliberately different read
  // from its downtown neighbours despite sharing the zone.
  "jp-nakamise-yokocho": { materials: ["wood-plaster", "tile"], heightRange: [5, 11], density: 0.85, depthM: 18 },
  // Quarter<->downtown connectors: transitional height between the old
  // neighbourhood's low-rise and the downtown core proper.
  "jp-renraku-dori": { heightRange: [7, 16], density: 0.72, depthM: 26 },
  "jp-shotengai-nishi-dori": { heightRange: [6, 15], density: 0.72, depthM: 28 },
  "jp-uptown-higashi": { heightRange: [6, 14], density: 0.7, depthM: 26 },
  "jp-chuo-dori-south": { heightRange: [9, 19], density: 0.75, depthM: 30 },
  "jp-eki-mae-dori": { heightRange: [10, 22], density: 0.78, depthM: 32 },
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
  "jp-renraku-dori",
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

/**
 * The whole generated-half street wall: one `tokyoRoadsideParcel` call per
 * (road segment, side) of every non-bridge generated road, skipping
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
    const openSides = TOKYO_OPEN_WATERFRONT_SIDES[surface.id] ?? [];
    for (let segmentIndex = 0; segmentIndex + 1 < surface.centerline.length; segmentIndex += 1) {
      const from = surface.centerline[segmentIndex];
      const to = surface.centerline[segmentIndex + 1];
      for (const side of [1, -1] as const) {
        if (openSides.includes(side)) continue;
        const seedKey = `${surface.id}:${segmentIndex}:${side}`;
        const material = hashStringToSeed(seedKey) % 2 === 0 ? style.materials[0] : style.materials[1];
        const block = tokyoRoadsideParcel(
          `jp-blk-${surface.id}-${segmentIndex}-${side === 1 ? "p" : "n"}`,
          surface.id,
          from,
          to,
          side,
          surface.widthM,
          style.depthM + tokyoDepthJitterM(seedKey),
          material,
          style.heightRange,
          style.density,
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
 * own hand-carved fabric from before this expansion began). */
const tokyoGeneratedBlocks = buildTokyoGeneratedBlocks(
  tokyoGeneratedHalf.generatedSurfaces,
  [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces],
  TOKYO_QUARTER_PARKS,
  TOKYO_WATER_BODIES,
);

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

export const TOKYO_MAP_PACK: MapPack = {
  id: "tokyo-setagaya",
  name: "Tokyo — Setagaya",
  areaLabel: "Yamashita, Miyanosaka and Gotokuji",
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
    roadSurfaces: [...jpQuarterSurfaces, ...tokyoGeneratedHalf.generatedSurfaces],
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
    // copy of this polygon on the map.
    waterBodies: TOKYO_WATER_BODIES,
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
      // Generated-half street wall (Tokyo expansion Phase 4, R18): the
      // whole residential-web/ring/downtown/riverside/east-bank fabric,
      // built by `buildTokyoGeneratedBlocks` above. The 9 rows above this
      // comment are the pre-expansion quarter's own hand-carved blocks and
      // stay exactly as authored.
      ...tokyoGeneratedBlocks,
    ],
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
    ],
    landmarks: [
      { id: "jp-gotokuji-station", kind: "station", center: point(-14, 6), size: point(20, 9), color: "#e85e59" },
      { id: "jp-setagaya-line", kind: "railway", center: point(18, -62), size: point(5, 72), color: "#656a70" },
      // Rail extension (Tokyo expansion Phase 5, §8.6): the streetcar
      // continues east to a second level crossing on jp-ichiban-dori (see
      // jp-rail-signal-2 below). `kind: "railway"` renders as a flat double
      // line whose ONLY consumed dimension is `size.x` (world-X length,
      // fixed z) — render/babylonGameSession.ts's `landmark.kind ===
      // "railway"` branch never reads `size.z` or any heading, so every
      // segment here is a straight east-west band, same as the existing
      // one above. z=-10 (not the existing marker's z=-62): the existing
      // marker sits only 2 m off jp-ichiban-x-minami-dori's own junction
      // node, far too tight for a level crossing's own conflict zone
      // alongside a signalled road junction; z=-10 sits exactly midway
      // between jp-ichiban-x-minami-dori (z=-60) and jp-ichiban-x-nakamise
      // (z=40), 50 m clear of both. The engine cannot render a curve
      // between the two z-values, so the line takes an unmodelled jog
      // there — an accepted simplification of a kind the renderer forces on
      // every "railway" landmark, not a Tokyo-specific shortcut. Two
      // segments (not one) leave a small gap at x=180 so the decal does not
      // draw through the crossing's own gate posts, and continue the line
      // past the crossing rather than ending abruptly at it — Phase 8's
      // station landmark can extend from here once it exists.
      { id: "jp-setagaya-line-ext-1", kind: "railway", center: point(102.5, -10), size: point(145, 5), color: "#656a70" },
      { id: "jp-setagaya-line-ext-2", kind: "railway", center: point(232.5, -10), size: point(95, 5), color: "#656a70" },
      // The quarter's three parks — hoisted to `TOKYO_QUARTER_PARKS` above
      // (Tokyo expansion Phase 4) so the street-wall generator can check a
      // candidate parcel against them (R18 never walls a park frontage)
      // without a second copy of these three rects.
      ...TOKYO_QUARTER_PARKS,
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
    ],
  },
  laneGraph: graph(
    [...jpNodesList, ...tokyoGenNodeList],
    [...tokyoGeneratedHalf.quarterLanesWithNewTurns, ...tokyoGeneratedHalf.generatedLanes],
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
