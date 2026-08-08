import type {
  FreeDriveDefinition,
  LaneGraph,
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
import { CONNECTOR_BLEND_RUN_M } from "../laneConnectors";
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
 * (`content.ts` imports `NYC_MAP_PACK` from here). */
export const NYC_CONTENT_REVIEWED_ON = "2026-07-10";

const osmSource = makeOsmSource(NYC_CONTENT_REVIEWED_ON);

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

/** World point on the lane's centreline at a given arclength. */
const lanePointAtDistance = (lane: LaneSegment, distanceAlongM: number): WorldPoint => {
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

/**
 * Builds a stop-controlled junction from whichever arms the caller says are
 * stop-class — every arm for an all-way stop, or only the minor road's for a
 * two-way/one-way stop, leaving a signal-class through road uncontrolled and
 * in priority. Each arm gets a stop line 6 m short of the node (matching
 * `intersectionSignal`) and a roadside pole just past its own kerb, beside
 * its own stop line — a plain sign needs no arm reaching back over the road
 * the way a mast head does, so it stands at the near corner rather than the
 * far one. Shares the signal builder's ±7 m conflict zone.
 */
const intersectionStop = (
  id: string,
  center: WorldPoint,
  arms: readonly { readonly laneId: string; readonly widthM: number }[],
  lanes: readonly LaneSegment[],
): { readonly control: TrafficControl; readonly zone: LaneGraph["conflictZones"][number] } => {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const zoneId = `${id}-zone`;
  const laneIds = arms.map((arm) => arm.laneId);
  const approaches: TrafficControlApproach[] = [];
  const installations: TrafficControlInstallation[] = [];
  for (const arm of arms) {
    const lane = laneById.get(arm.laneId);
    if (!lane) continue;
    const stopDistance = Math.max(0, laneLengthOf(lane) - 6);
    const headingDeg = laneHeadingAtDistanceDeg(
      lane,
      Math.max(0, stopDistance - CONNECTOR_BLEND_RUN_M - 1),
    );
    const stopPoint = lanePointAtDistance(lane, stopDistance);
    const rad = (headingDeg * Math.PI) / 180;
    // Right-hand normal of the direction of travel — the driver's right,
    // same convention `buildNycGrid` uses for lane offsets.
    const rightX = Math.cos(rad);
    const rightZ = -Math.sin(rad);
    // stopPoint already sits NYC_LANE_OFFSET_M off the road centreline (it's
    // a point on the lane, not the road), so only the remainder to the kerb
    // plus a small stand-off is needed here — adding the full half-width on
    // top double-counted that offset and, on a wide two-way stop-class road,
    // pushed the pole 2-3 m further out than a real one ever stands. Only
    // mattered once a one-way stop-class street's DO NOT ENTER sign could
    // land in that overshoot (regulatorySigns.test.ts, the borough's bank
    // streets) — every prior stop-class road was too narrow, or had nothing
    // else authored nearby, to expose it.
    const poleOffset = arm.widthM / 2 - NYC_LANE_OFFSET_M + 2.2;
    const approachId = `${id}-${arm.laneId}-app`;
    approaches.push(approach(approachId, arm.laneId, stopDistance, `${id}-stop`, [zoneId]));
    installations.push(
      installation(
        `${id}-${arm.laneId}-sign`,
        stopPoint.x + rightX * poleOffset,
        stopPoint.z + rightZ * poleOffset,
        headingDeg,
        "roadside_pole",
        "stop_sign",
        "primary",
        [approachId],
      ),
    );
  }
  const half = 7;
  return {
    control: control(id, "stop", center.x, center.z, 0, laneIds, [zoneId], approaches, installations),
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

// Manhattan's Upper West Side, real streets from a frozen OSM extract, grown
// east past Central Park into invented geography: five more avenues (Fifth
// through Third), the park's own transverses, the East River and two
// bridges, and a residential borough on the far bank. x = east, z = north.
// Avenues span Riverside Drive (x=-1160) to Steinway Ave (x=1100); streets
// span W 59th (z=-1440) to 56th Ave (z=1440). ~2600 m x 3000 m.
// ---------------------------------------------------------------------------
// NYC is declared as a grid, not written out lane by lane.
//
// Both halves are rectangular, so the map states its avenues and cross
// streets once and derives the ~415 lanes, their lateral offsets, their
// successors, the carriageway surfaces and the signals or stop controls from
// that. Hand-writing successors at this size goes wrong silently: a lane
// with no legal continuation makes its traffic vanish wherever the player
// happens to be looking (#128), and nothing about the authored literal looks
// wrong. Derived, "every lane leads somewhere legal" holds by construction.
//
// The west half's geography follows the frozen OSM extract in
// public/map-data/nyc-upper-west.json and the real grid: avenues west to
// east are Riverside Drive, West End, Broadway, Amsterdam, Columbus and
// Central Park West; Amsterdam runs one-way uptown and Columbus one-way
// downtown; the major crosstown streets are two-way; the side streets
// alternate, even eastbound and odd westbound. East of the park is invented
// — no second extract was frozen for it — seeded by Upper East Side and
// Long Island City flavour rather than a real survey: Fifth through Third
// mirror the west side's one-way-pair pattern, the borough's bank streets
// are stop-controlled rather than signalled so it reads as residential
// rather than a Manhattan copy, and Vernon/Crescent/Steinway borrow real LIC
// street names without claiming their real-world alignment.
// ---------------------------------------------------------------------------

/** Lateral offset of a lane line from its carriageway centreline. */
const NYC_LANE_OFFSET_M = 1.7;
/** Beyond this a successor is a U-turn, not a turn. */
const NYC_MAX_TURN_RAD = (120 * Math.PI) / 180;

type NycAxis = "avenue" | "street";

export interface NycRoadSpec {
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
   * by venues and spawns, so the numbering is recorded rather
   * than normalised.
   */
  readonly kerbsideLaneNo?: number;
  /**
   * Crossing roads this one reaches, by key. Omitted means all of them —
   * Riverside Drive is the short one, starting at 72nd as it really does.
   */
  readonly crossings?: readonly string[];
  /**
   * Which control class this road contributes at its crossings. A crossing
   * signalises when at least two of its arriving roads are "signal"
   * (the default); otherwise it gets a stop instead — on every arm when all
   * of them are "stop" (an all-way stop), or only on the "stop" arms when a
   * "signal" road also arrives there, which then keeps priority and runs
   * through uncontrolled, same as a real neighbourhood signs a minor street
   * meeting a boulevard. Purely a furniture/enforcement choice: it never
   * changes which lanes exist or where they may legally go.
   */
  readonly junctionControl?: "signal" | "stop";
}

/** West to east. */
export const NYC_AVENUES: readonly NycRoadSpec[] = [
  // Riverside Drive begins at 72nd, as it really does, so it skips the southern
  // rows and the grid's west edge steps in below them.
  //
  // Coordinates are shifted -700 from the original west-only grid so the map
  // can grow east of Central Park with the world bounds still origin-centred
  // (there is no world-offset field) — see the NYC east expansion plan,
  // .claude/nyc-east-expansion-plan.md section 3.1.
  { key: "riv", nodeKey: "riv", roadId: "nyc-riverside", name: "Riverside Dr", speedLimit: 25, coordinate: -1160, widthM: 11, oneWay: null, lanesPerDirection: 1, crossings: ["72", "75", "79", "82", "86", "91", "96", "100", "106"] },
  { key: "we", nodeKey: "we", roadId: "nyc-west-end", name: "West End Ave", speedLimit: 25, coordinate: -1020, widthM: 11, oneWay: null, lanesPerDirection: 1 },
  { key: "bway", nodeKey: "bw", roadId: "nyc-broadway", name: "Broadway", speedLimit: 30, coordinate: -820, widthM: 11, oneWay: null, lanesPerDirection: 1 },
  { key: "amst", nodeKey: "amst", roadId: "nyc-amsterdam", name: "Amsterdam Ave", speedLimit: 30, coordinate: -660, widthM: 9, oneWay: "forward", lanesPerDirection: 2 },
  { key: "col", nodeKey: "col", roadId: "nyc-columbus", name: "Columbus Ave", speedLimit: 30, coordinate: -520, widthM: 9, oneWay: "backward", lanesPerDirection: 2, kerbsideLaneNo: 1 },
  { key: "cpw", nodeKey: "cpw", roadId: "nyc-central-park-west", name: "Central Park West", speedLimit: 25, coordinate: -380, widthM: 11, oneWay: null, lanesPerDirection: 1 },
  // East of the park (issue: NYC east expansion, .claude/nyc-east-expansion-plan.md
  // section 3.2). All five share one crossings list — the three park
  // transverses plus the five east-only streets — so none of them
  // accidentally reach a west-side street the way an omitted `crossings`
  // would. Third additionally gains the two bridge keys once Phase 4 adds
  // them.
  //
  // Fifth and Third are the outer edge of this sub-grid the way Riverside
  // and Central Park West are the west grid's, and for the same
  // graph-correctness reason both of those are two-way (docs' "dead corner"
  // rule, section 9 pitfall 15): a one-way avenue's arrival end, sat at a
  // map edge, offers nothing for the boundary street's traffic to turn
  // onto there, and the generator never offers a same-road reversal.
  // Content.test.ts's "every lane has somewhere legal to go" caught it at
  // both true corners (fifth x e61, third x e100) the moment E 61st/E 100th
  // existed to arrive there — one-way Fifth/Third read as more authentic
  // Manhattan, but the plan is explicit that flavour, not real-world
  // fidelity, is the goal, and two-way is what the west grid's own
  // precedent already resolves this with. Madison/Lexington keep the
  // one-way pair.
  { key: "fifth", nodeKey: "fifth", roadId: "nyc-fifth", name: "Fifth Ave", speedLimit: 25, coordinate: -140, widthM: 11, oneWay: null, lanesPerDirection: 1, crossings: ["e61", "65", "e72", "79", "e86", "e91", "96", "e100"] },
  { key: "mad", nodeKey: "mad", roadId: "nyc-madison", name: "Madison Ave", speedLimit: 25, coordinate: 0, widthM: 9, oneWay: "forward", lanesPerDirection: 2, crossings: ["e61", "65", "e72", "79", "e86", "e91", "96", "e100"] },
  { key: "pk", nodeKey: "pk", roadId: "nyc-park-ave", name: "Park Ave", speedLimit: 30, coordinate: 160, widthM: 12, oneWay: null, lanesPerDirection: 1, crossings: ["e61", "65", "e72", "79", "e86", "e91", "96", "e100"] },
  // 25, not Park/Third's 30: with Third, E 100th and Lexington all at one
  // limit, a same-limit run near their shared corner outran
  // LIMIT_REPEATER_SPACING_M (regulatorySigns.test.ts, "leaves no long drive
  // without a posted limit") — corridors are same-limit by construction, so
  // a driver only gets an entry sign where a *change* happens, and this
  // three-avenue cluster shared none nearby.
  { key: "lex", nodeKey: "lex", roadId: "nyc-lexington", name: "Lexington Ave", speedLimit: 25, coordinate: 300, widthM: 9, oneWay: "backward", lanesPerDirection: 2, crossings: ["e61", "65", "e72", "79", "e86", "e91", "96", "e100"] },
  // Third additionally reaches the two bridges — it is the road they
  // continue from, over the river (NYC east expansion section 3.3).
  { key: "third", nodeKey: "third", roadId: "nyc-third", name: "Third Ave", speedLimit: 30, coordinate: 440, widthM: 11, oneWay: null, lanesPerDirection: 1, crossings: ["e61", "65", "e72", "79", "e86", "e91", "96", "e100", "qvb", "hlb"] },
  // The borough's three avenues (NYC east expansion section 3.2/5), added
  // here rather than in the borough phase: a bridge with only one real
  // crossing (Third) has fewer than the two it needs to form even one lane
  // span, which leaves its road surface empty and trips roadRealism.test.ts,
  // pavementPaths.test.ts and guidanceCoverage.test.ts alike — a bridge
  // is only structurally real once it lands somewhere. The bank streets
  // (crossing these three), houses zoning, green and gas station stay in
  // the borough phase; today these reach only the two bridges, which is
  // enough for one real span each (`buildNycBlocks` derives one giant block
  // per column until the bank streets split it into rows — the per-column
  // generator upgrade is exactly what makes that safe).
  { key: "vern", nodeKey: "vern", roadId: "nyc-vernon", name: "Vernon Blvd", speedLimit: 25, coordinate: 800, widthM: 10.4, oneWay: null, lanesPerDirection: 1 },
  { key: "cres", nodeKey: "cres", roadId: "nyc-crescent", name: "Crescent St", speedLimit: 25, coordinate: 950, widthM: 9, oneWay: "forward", lanesPerDirection: 1, junctionControl: "stop" },
  { key: "stein", nodeKey: "stein", roadId: "nyc-steinway", name: "Steinway Ave", speedLimit: 25, coordinate: 1100, widthM: 10.4, oneWay: null, lanesPerDirection: 1, junctionControl: "stop" },
];

/**
 * South to north. The wide two-way ones are the crosstown streets that really
 * are two-way; between each pair runs a narrow side street, one-way, and
 * alternating the way Manhattan's do — even numbers eastbound, odd westbound.
 * They exist so there is somewhere to turn: without them the avenues run 480 m
 * (six real blocks) between junctions.
 */
// East-only streets (crossings: the five east avenue keys only) share this
// list so a typo in one doesn't drift from the rest.
const NYC_EAST_STREET_CROSSINGS = ["fifth", "mad", "pk", "lex", "third"] as const;
/**
 * Every west avenue plus (from Phase 3 on) every east avenue — a transverse's
 * full reach. Streets that stop at the park (everything else here) instead
 * get the west-only list explicitly: an omitted `crossings` means "every
 * avenue that reaches this street", which after the five east avenues exist
 * would silently drive every side street straight through the park.
 */
const NYC_WEST_STREET_CROSSINGS = ["riv", "we", "bway", "amst", "col", "cpw"] as const;
const NYC_TRANSVERSE_CROSSINGS = [...NYC_WEST_STREET_CROSSINGS, ...NYC_EAST_STREET_CROSSINGS];
/**
 * A bridge is one continuous road spanning Third Ave, the river, and the
 * borough — not a separate "approach" road meeting a river-only span at the
 * bank. Two street specs sharing both a latitude AND a crossing avenue would
 * mint two disconnected lane-graph nodes at that physical corner (node ids
 * are per road-pair), so the bridge and its approach would never actually
 * connect. One spec crossing all four of `third`/`vern`/`cres`/`stein` is
 * what makes the bridge itself the only "approach road" on either bank.
 */
const NYC_BRIDGE_CROSSINGS = ["third", "vern", "cres", "stein"] as const;
/**
 * The borough's own cross streets stop at Steinway — they never reach Third
 * Ave, so they get their own list rather than NYC_EAST_STREET_CROSSINGS.
 */
const NYC_BOROUGH_STREET_CROSSINGS = ["vern", "cres", "stein"] as const;

export const NYC_STREETS: readonly NycRoadSpec[] = [
  { key: "59", nodeKey: "59", roadId: "nyc-west-59", name: "W 59th St", speedLimit: 30, coordinate: -1440, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "61", nodeKey: "61", roadId: "nyc-west-61", name: "W 61st St", speedLimit: 25, coordinate: -1200, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  // E 61st bounds the east grid on its south edge and MUST be two-way: a
  // one-way boundary street leaves the grid's south-east and south-west
  // corners with arrivals but no legal departure once the one-way avenues
  // are added, and traffic vanishes there (#128's failure mode) — see
  // .claude/nyc-east-expansion-plan.md section 3.2 and pitfall 15.
  { key: "e61", nodeKey: "e61", roadId: "nyc-east-61", name: "E 61st St", speedLimit: 30, coordinate: -1200, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_EAST_STREET_CROSSINGS },
  // Bank streets bk40/bk44/bk48/bk52/bk56 are the borough's own cross
  // streets — stop-class, so the neighbourhood reads residential rather than
  // a Manhattan copy (nycZoneFor's "vern-cres"/"cres-stein" comment). bk40
  // and bk56 bound the borough at its south and north edges and MUST be
  // two-way, the same dead-corner trap E 61st/E 100th guard against: staying
  // one-way eastbound only saves Vernon's corner (its arrival can still turn
  // onto the one-way flow heading into the grid) — Steinway is the last
  // avenue, so its own through-traffic arriving at either bank street has
  // nowhere to turn onto once nothing lies further east to receive it. Walked
  // all four corners by hand after this change; content.test.ts caught it
  // first when it was one-way.
  { key: "bk40", nodeKey: "bk40", roadId: "nyc-bank-40", name: "40th Ave", speedLimit: 25, coordinate: -1080, widthM: 9, oneWay: null, lanesPerDirection: 1, crossings: NYC_BOROUGH_STREET_CROSSINGS, junctionControl: "stop" },
  // W/E 65th, 79th and 96th are the park transverses: real crossings, so
  // they run the park's full width rather than stopping at its edge.
  { key: "65", nodeKey: "65", roadId: "nyc-west-65", name: "W 65th St", speedLimit: 30, coordinate: -960, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_TRANSVERSE_CROSSINGS },
  // Queensview Bridge: two-way, the grander of the two river crossings (NYC
  // east expansion section 3.3) — wider than Harborline, but still one lane
  // each way, not the plan's two. Two lanes on the same side of a two-way
  // carriageway sit at different offsets from the centreline (1.7 m and
  // 3.4 m), so their junction connector curves ease out over different arc
  // lengths and their stop lines land ~1.5 m out of line — intersectionVisuals
  // .test.ts's "parallel lanes' bars merge into one line" catches it,
  // correctly: a one-way multi-lane road's two lanes are symmetric
  // (-1.7 m/+1.7 m) with equal, mirrored arc lengths, so that case never hits
  // this. Fixing it generally means changing the shared junction-connector
  // curve math everything else relies on, for one bridge's flavour — the
  // plan is explicit that flavour, not fidelity, is the goal, so the width
  // difference alone carries "grander" instead.
  { key: "qvb", nodeKey: "qvb", roadId: "nyc-queensview-bridge", name: "Queensview Bridge", speedLimit: 40, coordinate: -840, widthM: 14, oneWay: null, lanesPerDirection: 1, crossings: NYC_BRIDGE_CROSSINGS },
  { key: "68", nodeKey: "68", roadId: "nyc-west-68", name: "W 68th St", speedLimit: 25, coordinate: -720, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "72", nodeKey: "72", roadId: "nyc-west-72", name: "W 72nd St", speedLimit: 30, coordinate: -480, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "e72", nodeKey: "e72", roadId: "nyc-east-72", name: "E 72nd St", speedLimit: 25, coordinate: -480, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: NYC_EAST_STREET_CROSSINGS },
  { key: "bk44", nodeKey: "bk44", roadId: "nyc-bank-44", name: "44th Ave", speedLimit: 25, coordinate: -360, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_BOROUGH_STREET_CROSSINGS, junctionControl: "stop" },
  { key: "75", nodeKey: "75", roadId: "nyc-west-75", name: "W 75th St", speedLimit: 25, coordinate: -240, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "79", nodeKey: "79", roadId: "nyc-west-79", name: "W 79th St", speedLimit: 30, coordinate: 0, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_TRANSVERSE_CROSSINGS },
  { key: "bk48", nodeKey: "bk48", roadId: "nyc-bank-48", name: "48th Ave", speedLimit: 25, coordinate: 120, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: NYC_BOROUGH_STREET_CROSSINGS, junctionControl: "stop" },
  // W 82nd stops at Columbus: the museum and its grounds fill the block through
  // to Central Park West, exactly as they interrupt the real street grid there.
  { key: "82", nodeKey: "82", roadId: "nyc-west-82", name: "W 82nd St", speedLimit: 25, coordinate: 240, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: ["riv", "we", "bway", "amst", "col"] },
  { key: "86", nodeKey: "86", roadId: "nyc-west-86", name: "W 86th St", speedLimit: 30, coordinate: 480, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "e86", nodeKey: "e86", roadId: "nyc-east-86", name: "E 86th St", speedLimit: 25, coordinate: 480, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: NYC_EAST_STREET_CROSSINGS },
  { key: "bk52", nodeKey: "bk52", roadId: "nyc-bank-52", name: "52nd Ave", speedLimit: 25, coordinate: 600, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_BOROUGH_STREET_CROSSINGS, junctionControl: "stop" },
  { key: "91", nodeKey: "91", roadId: "nyc-west-91", name: "W 91st St", speedLimit: 25, coordinate: 720, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  { key: "e91", nodeKey: "e91", roadId: "nyc-east-91", name: "E 91st St", speedLimit: 25, coordinate: 720, widthM: 9, oneWay: "backward", lanesPerDirection: 1, crossings: NYC_EAST_STREET_CROSSINGS },
  // Harborline Bridge: two-way, one lane each way — the quieter crossing.
  { key: "hlb", nodeKey: "hlb", roadId: "nyc-harborline-bridge", name: "Harborline Bridge", speedLimit: 40, coordinate: 840, widthM: 12, oneWay: null, lanesPerDirection: 1, crossings: NYC_BRIDGE_CROSSINGS },
  { key: "96", nodeKey: "96", roadId: "nyc-west-96", name: "W 96th St", speedLimit: 30, coordinate: 960, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_TRANSVERSE_CROSSINGS },
  { key: "bk56", nodeKey: "bk56", roadId: "nyc-bank-56", name: "56th Ave", speedLimit: 25, coordinate: 1080, widthM: 9, oneWay: null, lanesPerDirection: 1, crossings: NYC_BOROUGH_STREET_CROSSINGS, junctionControl: "stop" },
  { key: "100", nodeKey: "100", roadId: "nyc-west-100", name: "W 100th St", speedLimit: 25, coordinate: 1200, widthM: 9, oneWay: "forward", lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
  // E 100th bounds the east grid on its north edge — two-way for the same
  // reason E 61st is on the south.
  { key: "e100", nodeKey: "e100", roadId: "nyc-east-100", name: "E 100th St", speedLimit: 30, coordinate: 1200, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_EAST_STREET_CROSSINGS },
  { key: "106", nodeKey: "106", roadId: "nyc-west-106", name: "W 106th St", speedLimit: 30, coordinate: 1440, widthM: 10.4, oneWay: null, lanesPerDirection: 1, crossings: NYC_WEST_STREET_CROSSINGS },
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

const speedLimitForRoad = makeSpeedLimitForRoad(ROAD_SPEED_LIMITS);
const laneTrue = makeLaneTrue(speedLimitForRoad);

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
export function buildNycGrid(
  avenues: readonly NycRoadSpec[],
  streets: readonly NycRoadSpec[],
): {
  readonly nodes: readonly LaneNode[];
  readonly lanes: readonly LaneSegment[];
  readonly roadSurfaces: readonly RoadSurface[];
  readonly controls: readonly ReturnType<typeof intersectionSignal>[];
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

  // Manhattan controls every crossing where two carriageways meet: a signal
  // when at least two of the arriving roads are signal-class, else a stop —
  // all-way when every arm is stop-class, two-way/one-way (with the
  // signal-class road running through uncontrolled, in priority) when only
  // some are. A node fed by only one road — the tail of a one-way avenue,
  // where nothing arrives from the avenue at all — gets neither: it would
  // just hold the cross street for a phase or a stop nobody needs.
  const controls = nodeOrder.flatMap((junction) => {
    const arrivals = arrivalsByNode.get(junction.id) ?? [];
    const arrivingRoads = new Map(arrivals.map((lane) => [lane.road.key, lane.road]));
    if (arrivingRoads.size < 2) return [];
    const signalClassRoads = [...arrivingRoads.values()].filter(
      (road) => (road.junctionControl ?? "signal") === "signal",
    );
    if (signalClassRoads.length >= 2) {
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
    }
    // Whatever's left after the signal check is stop-class by construction
    // (arrivingRoads.size >= 2 and fewer than 2 are signal-class), so this
    // is every arm when every road is stop-class (all-way) and only the
    // minor road's arms when one signal-class road also arrives (two-way).
    const stopArms = arrivals.filter(
      (lane) => (lane.road.junctionControl ?? "signal") === "stop",
    );
    return [
      intersectionStop(
        `nyc-stop-${junction.id.replace(/^nyc-/, "")}`,
        junction.position,
        stopArms.map((lane) => ({ laneId: lane.id, widthM: lane.road.widthM })),
        lanes,
      ),
    ];
  });

  const roadNames: Record<string, string> = {};
  for (const road of [...avenues, ...streets]) roadNames[road.roadId] = road.name;
  return { nodes: nodeOrder, lanes, roadSurfaces, controls, roadNames };
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
  // The borough's own shopping street. Same set as Manhattan's retail spines
  // but capped lower and thinned, because a six-storey wall of shops two
  // streets from a row of detached houses is the thing this zone exists to
  // avoid: the point is a low-rise neighbourhood main street, not a second
  // E 86th.
  boroughRetail: { buildingSet: "nyc-shop", heightRange: [9, 14], density: 0.9, material: "brick" },
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
    // East of the park (NYC east expansion, section 3.7).
    case "cpw-fifth":
      // This "column" is Central Park itself — a missed null here would
      // generate a block floating on the lawn, the same trap "third-vern"
      // (added in a later phase) guards against over the river.
      return null;
    case "fifth-mad":
      // A midtown-ish rise at the park's SE corner; the Fifth Avenue Gallery
      // (section 3.6) owns the 79th–86th cell the same way the AMNH does on
      // the west side.
      if (centreZ > 0 && centreZ < 480) return null;
      return centreZ < -960 ? NYC_ZONES.towers : NYC_ZONES.midrise;
    case "mad-pk":
      // Carnegie Hill reads brownstone above the museum mile; midtown
      // office/apartment mix below it.
      return centreZ < 0 ? NYC_ZONES.midrise : NYC_ZONES.brownstone;
    case "pk-lex":
      return centreZ < 0
        ? NYC_ZONES.brownstone
        : centreZ < 960
          ? NYC_ZONES.retail // the E 86th shopping spine
          : NYC_ZONES.midrise;
    case "lex-third":
      if (centreZ < -960) return NYC_ZONES.towers;
      if (centreZ < 480) return NYC_ZONES.midrise;
      if (centreZ < 960) return NYC_ZONES.retail;
      return NYC_ZONES.brownstone;
    case "third-vern":
      // This "column" is the river. A missed null here generates a midrise
      // block floating on the water — exactly the trap the "cpw-fifth"
      // comment above points back to.
      return null;
    case "vern-cres":
      // Queensbridge Green (nyc-queensbridge-green) owns the 44th–48th Ave
      // row, same museum-cell pattern as "col-cpw" and "fifth-mad" above.
      if (centreZ > -360 && centreZ < 120) return null;
      return NYC_ZONES.houses;
    case "cres-stein":
    case "stein-margin":
      // The borough: houses, no tall buildings, per the owner's explicit
      // requirement (NYC east expansion section 3.7) — except for one
      // shopping street at the top of Steinway, 52nd to 56th Ave.
      //
      // Both cases together are what makes it a street rather than a row:
      // "stein-margin" is the fill strip beyond Steinway, i.e. Steinway's far
      // kerb, so it has to answer this question the same way the column on
      // its near kerb does or the shops face houses across the road. The
      // Harborline Bridge crosses at z = 840 and splits the 52nd-56th row in
      // two, so this band covers two cells (centres 720 and 960), not one.
      //
      // Vernon and Crescent stay houses end to end. That is the whole point:
      // the borough's shops used to stand among its homes, and moving them
      // out needed somewhere to move them *to*.
      if (centreZ > 600 && centreZ < 1080) return NYC_ZONES.boroughRetail;
      return NYC_ZONES.houses;
    default:
      // Every real column is listed above by name on purpose: a forgotten
      // one used to fall through to midrise silently (a block floating on
      // the river, once the river column existed), and this way it throws
      // at import time instead.
      throw new Error(`nycZoneFor: unhandled column "${columnKey}"`);
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

  // Every block is collected with a (streetIndex, avenueIndex) sort key
  // rather than pushed straight into the result, so the final order can
  // match the old globally-consecutive-row algorithm's exact
  // south-to-north-then-west-to-east reading order regardless of which pass
  // below found it — the render side walks `geometry.blocks` in array order
  // to feed a fallback facade box's seeded-random draw
  // (docs/rendering.md's frozen-order rule), so a generator refactor that
  // only changes iteration order still reshuffles that draw. A row's west
  // margin sorts after that row's real columns, matching where the old
  // single loop appended it — `avenues.length` is past every real column
  // index (0..avenues.length-2).
  const tagged: {
    readonly block: ProceduralBlock;
    readonly streetIndex: number;
    readonly avenueIndex: number;
  }[] = [];

  // One column (adjacent avenue pair) at a time: its rows are the streets
  // BOTH of that column's avenues reach, in z order — not globally
  // consecutive streets. A street only part of the grid reaches (an
  // east-only cross street, say) then splits only the columns it actually
  // touches, instead of erasing every row it appears in for every other
  // column too (it simply merges that column's two neighbouring rows into
  // one taller block, same as W 82nd already does against Central Park West
  // today, where the museum block owns the merged cell).
  for (let column = 0; column + 1 < avenues.length; column += 1) {
    const west = avenues[column];
    const east = avenues[column + 1];
    const shared = streets.filter(
      (street) => reaches(west, street) && reaches(east, street),
    );
    for (let row = 0; row + 1 < shared.length; row += 1) {
      const south = shared[row];
      const north = shared[row + 1];
      const centreZ = (south.coordinate + north.coordinate) / 2;
      const depthZ = north.coordinate - south.coordinate - NYC_BLOCK_INSET_M * 2;
      if (depthZ <= 0) continue;
      const columnKey = `${west.key}-${east.key}`;
      const zone = nycZoneFor(columnKey, centreZ);
      if (!zone) continue;
      const widthX = east.coordinate - west.coordinate - NYC_BLOCK_INSET_M * 2;
      if (widthX <= 0) continue;
      tagged.push({
        block: {
          id: `nyc-block-${columnKey}-${Math.round(centreZ)}`,
          center: point((west.coordinate + east.coordinate) / 2, centreZ),
          size: point(widthX, depthZ),
          heightRange: zone.heightRange,
          density: zone.density,
          material: zone.material,
          buildingSet: zone.buildingSet,
        },
        streetIndex: streets.indexOf(south),
        avenueIndex: column,
      });
    }
  }

  // West-margin strips are a grid-edge concept, not a per-column one: still
  // walks globally consecutive streets to find each row's westmost reaching
  // avenue, same as the whole function did before the column split above.
  const westAvenueKeys: readonly string[] = NYC_WEST_STREET_CROSSINGS;
  for (let row = 0; row + 1 < streets.length; row += 1) {
    const south = streets[row];
    const north = streets[row + 1];
    const centreZ = (south.coordinate + north.coordinate) / 2;
    const depthZ = north.coordinate - south.coordinate - NYC_BLOCK_INSET_M * 2;
    if (depthZ <= 0) continue;
    const present = avenues.filter(
      (avenue) => reaches(avenue, south) && reaches(avenue, north),
    );
    const westmost = present[0];
    // A row only an east avenue reaches (the bridge-flanking rows, where
    // only Third's crossings list stretches that far south/north of the
    // bridgehead) has no real west-grid frontage missing — "westmost" here
    // is an artifact of a crossings-list gap, not the map edge, and a margin
    // beyond it would land inside Central Park (west of Fifth) or double up
    // on the lex-third column's own block (west of Third). Riverside Drive's
    // far side is Riverside Park, not frontage, so it is excluded too.
    if (!westmost || !westAvenueKeys.includes(westmost.key) || westmost.key === "riv") continue;
    tagged.push({
      block: {
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
      },
      streetIndex: row,
      avenueIndex: avenues.length,
    });
  }

  // East-margin strips: the mirror case, but only past Steinway — the
  // borough's own east edge. Manhattan's east avenues never need this
  // (Third Ave's far side is the river, itself null-zoned in nycZoneFor).
  // Walking globally-consecutive streets (like the west loop above) doesn't
  // work here: the bank streets each sit at a z the Manhattan grid doesn't
  // use, so an ordinary street always falls between one bank street and the
  // next in `streets`, and consecutive-pair present-filtering never finds
  // two Steinway-reaching streets next to each other. Filter to Steinway's
  // own reach first — same fix the per-column loop above needed to walk a
  // column's rows instead of the whole grid's.
  const stein = avenues.find((avenue) => avenue.key === "stein");
  if (stein) {
    const steinStreets = streets.filter((street) => reaches(stein, street));
    for (let row = 0; row + 1 < steinStreets.length; row += 1) {
      const south = steinStreets[row];
      const north = steinStreets[row + 1];
      const centreZ = (south.coordinate + north.coordinate) / 2;
      const depthZ = north.coordinate - south.coordinate - NYC_BLOCK_INSET_M * 2;
      if (depthZ <= 0) continue;
      // Zoned through `nycZoneFor` under its own column name rather than
      // hardcoded, so Steinway's two kerbs cannot drift apart: this strip is
      // the far kerb of the same street `cres-stein` fronts, and a rezoning
      // that reached one and not the other would put shops opposite houses.
      const zone = nycZoneFor("stein-margin", centreZ);
      if (!zone) continue;
      tagged.push({
        block: {
          id: `nyc-block-east-margin-${Math.round(centreZ)}`,
          center: point(
            stein.coordinate + NYC_BLOCK_INSET_M + NYC_MARGIN_DEPTH_M / 2,
            centreZ,
          ),
          size: point(NYC_MARGIN_DEPTH_M, depthZ),
          heightRange: zone.heightRange,
          density: zone.density,
          material: zone.material,
          buildingSet: zone.buildingSet,
        },
        streetIndex: streets.indexOf(south),
        avenueIndex: avenues.length + 1,
      });
    }
  }

  tagged.sort((a, b) => a.streetIndex - b.streetIndex || a.avenueIndex - b.avenueIndex);
  return tagged.map((entry) => entry.block);
}

const nycGrid = buildNycGrid(NYC_AVENUES, NYC_STREETS);
const nycLanes = nycGrid.lanes;
const nycControls = nycGrid.controls;
const nycBlocks = buildNycBlocks(NYC_AVENUES, NYC_STREETS);

export const NYC_MAP_PACK: MapPack = {
  id: "nyc-upper-west-side",
  name: "NYC — Park to River",
  areaLabel: "Broadway, Central Park & the East River",
  countryIds: ["us"],
  // Derived from the road specs rather than listed again, so a new street
  // still carries its name on the one line that declares it.
  roadNames: nycGrid.roadNames,
  // Twelve cars is what every map got, and it is what this one had when it
  // was a fifth the size (47 km of lane, the west grid alone). Spread that
  // thin they left the streets empty, and patrols with them — a patrol is
  // one in five of the *car* variant only (isPatrolVehicle), which after the
  // bus/taxi/van gate and roll shares is roughly one vehicle in eight, so
  // twelve vehicles is one police car in the whole city if the seed is kind.
  // 32 is the simulation core's own clamp; a phone keeps a lower count
  // because each car costs it much more, and the O(n^2) car-following work
  // is paid per decision. The east expansion doubled the lane total again
  // (96 km) without raising the clamp: the same fleet spreads thinner still,
  // topped up near the vehicle gates (nyc-car-18 on) so arrival scenes east
  // of the park and in the borough are not bare.
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
    worldSize: point(2600, 3000),
    roadWidth: 11,
    shoulderWidth: 1.5,
    roadSurfaces: nycGrid.roadSurfaces,
    blocks: nycBlocks.concat([
      // The two strips beyond the outermost cross streets, which no row
      // generates because they have grid on one side only. The north one is
      // wider: Riverside Drive reaches W 96th, so there is more frontage up
      // there than below W 65th.
      { id: "nyc-block-south-margin", center: point(-700, -1475), size: point(614, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
      { id: "nyc-block-north-margin", center: point(-770, 1475), size: point(754, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
      // Same pattern, east side: strips beyond E 61st and E 100th, the two
      // bounding streets of the east grid, inset 13 m off their coordinate
      // and spanning Fifth's to Third's kerb (-140-13=-153 to 440+13=453).
      { id: "nyc-block-east-south-margin", center: point(150, -1235), size: point(606, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
      { id: "nyc-block-east-north-margin", center: point(150, 1235), size: point(606, 44), heightRange: [16, 28], density: 0.9, material: "sandstone", buildingSet: "nyc-midrise" },
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
      // Third Ave's E 86th-91st block sits in the lex-third retail band —
      // commercial frontage, not between houses (serviceLots.test.ts). The
      // southbound lane, deliberately: the setback normal is always the
      // driver's right, and northbound's right is east — off the edge of
      // the developed grid, this phase, with no block to land on at all.
      { id: "nyc-repair-east", kind: "repair_shop", anchor: { laneId: "nyc-third-s-e91", distanceAlongM: 140 }, footprint: point(10, 8), label: "East Side Auto", setbackM: 12.1 },
      // The borough's own station, on Vernon's southbound lane so the
      // setback (always the driver's right) throws the lot west onto the
      // open riverbank rather than east into the houses — same southbound
      // trick as nyc-repair-east above, for the same reason.
      { id: "nyc-gas-bank", kind: "gas_station", anchor: { laneId: "nyc-vern-s-bk52", distanceAlongM: 240 }, footprint: point(14, 9), label: "Queensview Fuel", setbackM: 18.7 },
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
      // Below 79th, because `riv-we` is the detached-house belt above it and
      // Riverside's other kerb is the park — so unlike most of these, no
      // change of lane direction could fix it, only a change of latitude.
      { id: "nyc-v11", kind: "shop", anchor: { laneId: "nyc-riv-n-75", distanceAlongM: 120 }, footprint: point(16, 12), name: "Riverside Market" },
      // Broadway's east kerb: uptown of 86th that is the retail spine, while
      // the west kerb is the `we-bway` house belt. Same latitude, other side.
      { id: "nyc-v12", kind: "restaurant", anchor: { laneId: "nyc-bway-n-96", distanceAlongM: 120 }, footprint: point(28, 20), name: "Straus Park Bagels", setbackM: 18 },
      // Northbound, not southbound: West End's west kerb here is Joan of Arc
      // Park's east edge, and the driver's-right setback put the block's flank
      // 1.4 m through the park wall. Same latitude, other kerb.
      { id: "nyc-v13", kind: "residence", anchor: { laneId: "nyc-we-n-91", distanceAlongM: 120 }, footprint: point(14, 12), name: "West 96th Apartments" },
      { id: "nyc-v14", kind: "office", anchor: { laneId: "nyc-col-s-1-100", distanceAlongM: 120 }, footprint: point(16, 14), name: "Columbus Uptown Offices" },
      { id: "nyc-v15", kind: "restaurant", anchor: { laneId: "nyc-amst-n-2-86", distanceAlongM: 120 }, footprint: point(14, 14), name: "Amsterdam Noodle Bar", modelId: "restaurant-pizzeria" },
      { id: "nyc-v16", kind: "shop", anchor: { laneId: "nyc-106-w-amst", distanceAlongM: 80 }, footprint: point(16, 12), name: "West 106th Grocers" },
      { id: "nyc-v17", kind: "residence", anchor: { laneId: "nyc-cpw-s-96", distanceAlongM: 120 }, footprint: point(14, 12), name: "Central Park West Residences" },
      // East of the park (NYC east expansion, section 3.8) — kinds and
      // models cycled so no two neighbouring venues match, same discipline
      // as the west side.
      { id: "nyc-v18", kind: "restaurant", anchor: { laneId: "nyc-lex-s-1-e86", distanceAlongM: 200 }, footprint: point(28, 20), name: "Lexington Diner", setbackM: 18 },
      { id: "nyc-v19", kind: "restaurant", anchor: { laneId: "nyc-e86-e-lex", distanceAlongM: 70 }, footprint: point(14, 14), name: "E 86th Pizzeria", modelId: "restaurant-pizzeria" },
      // Fifth Avenue Gallery's café — right by the museum's own block, which
      // is what the northbound lane buys: a venue goes to the driver's right,
      // so the southbound anchor this shipped with threw the café across
      // Fifth and 3 m into Central Park, straddling the perimeter wall. The
      // whole west kerb of Fifth is the park, so no distance along a
      // southbound lane could have been right.
      { id: "nyc-v20", kind: "restaurant", anchor: { laneId: "nyc-fifth-n-79", distanceAlongM: 240 }, footprint: point(14, 14), name: "Gallery Café" },
      { id: "nyc-v21", kind: "shop", anchor: { laneId: "nyc-mad-n-1-79", distanceAlongM: 150 }, footprint: point(16, 12), name: "Madison Bodega" },
      { id: "nyc-v22", kind: "shop", anchor: { laneId: "nyc-third-s-e86", distanceAlongM: 200 }, footprint: point(16, 12), name: "Third Avenue Grocers" },
      { id: "nyc-v23", kind: "office", anchor: { laneId: "nyc-pk-n-e72", distanceAlongM: 200 }, footprint: point(16, 14), name: "Park Avenue Offices" },
      // Down by the SE tower cluster (lex-third/fifth-mad, z < -960).
      // Southbound, so the setback lands it on the lex-third tower cell it is
      // named for. Northbound's right is east, which here is the East River
      // Esplanade — the same hazard `nyc-repair-east` records below, and it
      // had put this block 9 m inside the esplanade's west wall.
      { id: "nyc-v24", kind: "office", anchor: { laneId: "nyc-third-s-65", distanceAlongM: 140 }, footprint: point(16, 14), name: "Third Avenue Towers Offices" },
      { id: "nyc-v25", kind: "residence", anchor: { laneId: "nyc-pk-n-e91", distanceAlongM: 20 }, footprint: point(14, 12), name: "Park Avenue at 91st" },
      // The borough (NYC east expansion, section 3.8) — kept off the
      // bk44-bk48 row Queensbridge Green owns, same discipline as everywhere
      // else a landmark claims a cell.
      //
      // Every shop and kitchen here sits on the Steinway band (52nd to 56th),
      // both kerbs, and nothing commercial stands on Vernon or Crescent. The
      // diner and the grocer used to; a restaurant among detached houses is
      // what the borough looked wrong for. `content.test.ts` holds the line.
      { id: "nyc-v26", kind: "restaurant", anchor: { laneId: "nyc-stein-n-hlb", distanceAlongM: 120 }, footprint: point(28, 20), name: "Steinway Diner", setbackM: 18 },
      { id: "nyc-v27", kind: "shop", anchor: { laneId: "nyc-stein-s-hlb", distanceAlongM: 80 }, footprint: point(16, 12), name: "Bridgeview Grocers" },
      { id: "nyc-v28", kind: "residence", anchor: { laneId: "nyc-cres-n-bk48", distanceAlongM: 300 }, footprint: point(14, 12), name: "Crescent Street Residences" },
      { id: "nyc-v29", kind: "residence", anchor: { laneId: "nyc-bk48-e-cres", distanceAlongM: 15 }, footprint: point(14, 12), name: "48th Avenue Houses" },
      { id: "nyc-v30", kind: "restaurant", anchor: { laneId: "nyc-stein-n-bk52", distanceAlongM: 100 }, footprint: point(14, 14), name: "Steinway Pizzeria", modelId: "restaurant-pizzeria" },
      // Queensview Bridge's own plaza, the grander of the two crossings.
      { id: "nyc-v31", kind: "office", anchor: { laneId: "nyc-vern-s-qvb", distanceAlongM: 100 }, footprint: point(16, 14), name: "Bridge Plaza Offices" },
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
          point(-210, -530),
          point(-238, -514),
          point(-250, -479),
          point(-247, -434),
          point(-241, -390),
          point(-221, -353),
          point(-195, -345),
          point(-176, -372),
          point(-170, -420),
          point(-175, -470),
          point(-188, -507),
        ],
      },
      // The East River. Gently irregular, not a rectangle — a perfect
      // rectangle reads as a canal. Both shores stay clear of Third Ave's
      // and (from Phase 5) Vernon Blvd's carriageways and sidewalks (Third
      // centreline 440, Vernon 800). `flowHeadingDeg: 0` is what makes this
      // a river rather than a static pond (crest streaks, chop, drifting
      // tiles) — omitting it would make a giant still pond instead.
      // `bridgePortalSurfaceIds` is what opens the shoreline for exactly
      // Queensview and Harborline, and derives their parapet spans — every
      // other metre of shoreline stays a solid collider for free.
      {
        id: "nyc-east-river",
        color: "#24404d",
        flowHeadingDeg: 0,
        bridgePortalSurfaceIds: [
          "nyc-queensview-bridge",
          "nyc-harborline-bridge",
        ],
        polygon: [
          point(560, -1500),
          point(566, -1100),
          point(557, -700),
          point(569, -300),
          point(556, 100),
          point(573, 600),
          point(559, 1100),
          point(565, 1500),
          point(735, 1500),
          point(728, 1100),
          point(743, 600),
          point(729, 100),
          point(744, -300),
          point(726, -700),
          point(741, -1100),
          point(731, -1500),
        ],
      },
    ],
    landmarks: [
      // Kept clear of the carriageways (a content test enforces this).
      { id: "nyc-subway", kind: "station", center: point(-792, -455), size: point(8, 5), color: "#2d2f33" },
      // Central Park runs the whole east edge now the grid does, and is no
      // longer a 38 m token: at 200 m it reads as the park the avenue is
      // named after rather than a verge. Its west edge stays clear of
      // Central Park West's kerb, which is what keeps addresses off it.
      //
      // Split into four segments rather than one road-divided rectangle:
      // `ROAD_DIVIDED_PARK_IDS`'s side-aware clipping composes badly with
      // three transverse crossings, so each 14 m gap between segments (28 m
      // total either side of a transverse) clears that carriageway plus its
      // shoulders instead, and the transverses just run through open ground
      // between two landmarks rather than across one. The legacy id stays on
      // the Great Lawn's own segment (14..946) so parkLayouts.ts's bespoke
      // Central Park feature — and the lake, which sits inside `-lakeside`,
      // matched geometrically either way — keep attaching by id.
      { id: "nyc-central-park-south", kind: "park", center: point(-260, -1212), size: point(200, 476), color: "#4f7a3d" },
      { id: "nyc-central-park-lakeside", kind: "park", center: point(-260, -480), size: point(200, 932), color: "#4f7a3d" },
      { id: "nyc-central-park", kind: "park", center: point(-260, 480), size: point(200, 932), color: "#4f7a3d" },
      { id: "nyc-central-park-north", kind: "park", center: point(-260, 1212), size: point(200, 476), color: "#4f7a3d" },
      { id: "nyc-amnh", kind: "shops", center: point(-450, 240), size: point(100, 420), color: "#caa76f" },
      // Fifth Avenue Gallery: the Met's slot, fronting Fifth between E 72nd
      // and E 86th — the same "landmark owns the cell, zoning nulls it"
      // pattern the AMNH uses on the west side.
      { id: "nyc-gallery", kind: "museum", center: point(-60, 240), size: point(90, 160), color: "#caa76f" },
      // Bridge landmarks: id equals the bridge's own road id — that
      // identity is how the waterGeometry helpers and render/nycLandmarks.ts
      // find the right road surface and clip rails/pylons to the over-water
      // span. Rendered bespoke (render/nycLandmarks.ts via
      // cityRenderRegistry.ts); the generic landmark fallback would draw a
      // windowed facade box, which is wrong for a bridge.
      { id: "nyc-queensview-bridge", kind: "bridge", center: point(650, -840), size: point(240, 14), headingDeg: 90, color: "#c9b48a" },
      { id: "nyc-harborline-bridge", kind: "bridge", center: point(650, 840), size: point(240, 12), headingDeg: 90, color: "#b8ac95" },
      // East River Esplanade: the Manhattan bank between Third Ave's
      // frontage and the west shore (452.5..547.5), split around the two
      // bridges so no park segment tries to grow over a bridge deck.
      { id: "nyc-esplanade-south", kind: "park", center: point(500, -1158), size: point(95, 604), color: "#4f7a3d" },
      { id: "nyc-esplanade", kind: "park", center: point(500, 0), size: point(95, 1640), color: "#4f7a3d" },
      { id: "nyc-esplanade-north", kind: "park", center: point(500, 1158), size: point(95, 604), color: "#4f7a3d" },
      // Queensbridge Green: the borough's own park, wholly inside the
      // vern-cres column (x 820..930 sits within the 813..937 interior) and
      // clear of 44th/48th Aves by 140 m either side of its z-span. The
      // vern-cres cell under it is null-zoned in nycZoneFor (the museum-cell
      // pattern) so no house block shares its ground.
      { id: "nyc-queensbridge-green", kind: "park", center: point(875, -120), size: point(110, 200), color: "#5c8c4b" },
      // Riverside Park fills the far side of Riverside Drive, where the land
      // really does fall away to the Hudson — so the west edge of the map is
      // green rather than another row of brownstones.
      { id: "nyc-riverside-park", kind: "park", center: point(-1206, 480), size: point(66, 1934), color: "#4f7a3d" },
      // Joan of Arc Park: a real triangle off Riverside Drive at W 93rd,
      // here given the whole block between W 91st and W 96th so it has road
      // on all four sides and can be driven round — about a 760 m lap.
      { id: "nyc-joan-of-arc-park", kind: "park", center: point(-1090, 840), size: point(104, 204), color: "#5c8c4b" },
    ],
  },
  laneGraph: graph(
    nycGrid.nodes,
    nycLanes,
    nycControls.map((entry) => entry.control),
    nycControls.map((entry) => entry.zone),
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
      // East of the park (NYC east expansion, section 3.9) — the same
      // fleet spread thinner over a bigger city, denser near gates.
      anchoredSpawn("nyc-car-18", "vehicle", "nyc-fifth-n-79", 200),
      anchoredSpawn("nyc-car-19", "vehicle", "nyc-mad-n-1-e72", 200),
      anchoredSpawn("nyc-car-20", "vehicle", "nyc-pk-s-79", 150),
      anchoredSpawn("nyc-car-21", "vehicle", "nyc-pk-n-e86", 100),
      anchoredSpawn("nyc-cab-22", "vehicle", "nyc-lex-s-1-79", 200),
      anchoredSpawn("nyc-car-23", "vehicle", "nyc-third-n-79", 200),
      anchoredSpawn("nyc-van-24", "vehicle", "nyc-third-s-e86", 150),
      // The borough (NYC east expansion, section 3.9) — one gate per bridge
      // deck so a crossing car is a common sight, not a coincidence, plus
      // Vernon and Steinway so the residential streets are not silent.
      anchoredSpawn("nyc-car-25", "vehicle", "nyc-qvb-e-third", 180),
      anchoredSpawn("nyc-cab-26", "vehicle", "nyc-hlb-w-vern", 180),
      anchoredSpawn("nyc-van-27", "vehicle", "nyc-vern-n-bk44", 200),
      anchoredSpawn("nyc-car-28", "vehicle", "nyc-vern-s-bk52", 100),
      anchoredSpawn("nyc-car-29", "vehicle", "nyc-stein-n-bk48", 200),
      freeSpawn("nyc-ped-1", "pedestrian", -800, 12, 0),
      freeSpawn("nyc-ped-2", "pedestrian", -832, -10, 180),
      freeSpawn("nyc-ped-3", "pedestrian", -672, 12, 0),
      freeSpawn("nyc-ped-4", "pedestrian", -532, -12, 180),
      freeSpawn("nyc-ped-5", "pedestrian", -1008, 10, 0),
      // The ambient crowd is a bubble that follows the car, so it covers the
      // new streets for free. These are the scenario road users, which are
      // placed: a few uptown and downtown so the ends are not bare on arrival.
      freeSpawn("nyc-ped-6", "pedestrian", -800, -1092, 0),
      freeSpawn("nyc-ped-7", "pedestrian", -532, 1088, 180),
      freeSpawn("nyc-ped-8", "pedestrian", -1148, 600, 0),
      // Museum steps outside the gallery, and the E 86th retail spine.
      freeSpawn("nyc-ped-9", "pedestrian", -155, 240, 90),
      freeSpawn("nyc-ped-10", "pedestrian", 220, 480, 90),
      // The esplanade's own paths, and the borough (NYC east expansion,
      // section 3.9) — the last two "~6" pedestrians the plan calls for.
      freeSpawn("nyc-ped-11", "pedestrian", 500, -400, 0),
      freeSpawn("nyc-ped-12", "pedestrian", 500, 400, 180),
      freeSpawn("nyc-ped-13", "pedestrian", 850, -100, 90),
      freeSpawn("nyc-ped-14", "pedestrian", 1080, 680, 270),
      freeSpawn("nyc-cyclist-1", "cyclist", -1018, -200, 0, "nyc-we-n-72"),
      freeSpawn("nyc-cyclist-2", "cyclist", -661.7, -200, 0, "nyc-amst-n-1-72"),
      freeSpawn("nyc-cyclist-3", "cyclist", -1158, 600, 0, "nyc-riv-n-86"),
      freeSpawn("nyc-cyclist-4", "cyclist", 440, 100, 0, "nyc-third-n-79"),
      freeSpawn("nyc-cyclist-5", "cyclist", 230, 0, 90, "nyc-79-e-pk"),
      // The borough (NYC east expansion, section 3.9): Vernon Blvd and
      // Crescent St, the last two of the "3-4" cyclists the plan calls for
      // (Third and a transverse are already covered above).
      freeSpawn("nyc-cyclist-6", "cyclist", 800, 700, 0, "nyc-vern-n-bk52"),
      freeSpawn("nyc-cyclist-7", "cyclist", 950, 300, 0, "nyc-cres-n-bk48"),
    ],
  ),
};

export const NYC_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-us",
  countryId: "us",
  destinationId: "us-nyc",
  mapId: "nyc-upper-west-side",
  startSpawnId: "nyc-player-1way",
  trafficSeed: 2101,
};
