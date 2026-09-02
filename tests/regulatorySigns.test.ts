import { describe, expect, it } from "vitest";
import { getMapPack, MAP_PACKS } from "../app/game/content";
import {
  regulatorySignPlacements,
  regulatorySignYawRad,
  speedLimitSignFamily,
  speedLimitSignPlacements,
  speedLimitSignYawRad,
  LIMIT_REPEATER_SPACING_M,
  type RegulatorySignLaneInput,
  type RegulatorySignPlacement,
} from "../app/game/regulatorySigns";
import {
  CAIRO_REMOVED_DOKKI_RAMP_SPEED_SIGN_REF_ID,
  CAIRO_REMOVED_WEST_RAMP_SPEED_SIGN_REF_ID,
  curateCairoRegulatorySigns,
  curateCairoSpeedLimitSigns,
} from "../app/game/cairoRoadSigns";
import {
  NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS,
  curateNycSpeedLimitSigns,
} from "../app/game/nycRoadSigns";
import {
  ELEVATED_ROAD_LEVEL_THRESHOLD_M,
  elevationOnPolylineAt,
  roadLevelAtElevation,
} from "../app/game/roadElevation";

/**
 * Regulatory signs are derived from the lane graph so signage can never
 * disagree with the wrong-way rules the simulation enforces. These tests
 * re-derive the expected inventory from that same lane graph rather than
 * pinning coordinates: which mouths exist, and how many posts each earns, is a
 * function of the map, and the map is meant to grow. What is pinned is the
 * contract — a mouth you may enter gets ONE WAY blades, a mouth you may not
 * gets DO NOT ENTER plus WRONG WAY repeaters, an ordinary two-way arm gets
 * nothing, and DO NOT ENTER / WRONG WAY message faces point along legal flow
 * (at would-be wrong-way drivers) so legal traffic sees only their gray backs.
 */

const nycPack = () => getMapPack("nyc-upper-west-side");

const nycPlacements = (): readonly RegulatorySignPlacement[] => {
  const pack = nycPack();
  return regulatorySignPlacements({
    lanes: pack.laneGraph.lanes,
    roadSurfaces: pack.geometry.roadSurfaces,
    defaultRoadWidthM: pack.geometry.roadWidth,
  });
};

const byKind = (
  placements: readonly RegulatorySignPlacement[],
  kind: RegulatorySignPlacement["kind"],
) => placements.filter((placement) => placement.kind === kind);

// Mirrors regulatorySigns.ts: a post sits 0.9 m beyond its own kerb.
const KERB_MARGIN_M = 0.9;
const WRONG_WAY_NEAR_M = 35;
const NODE_EPSILON_M = 0.08;
const MIN_ARM_LENGTH_M = 20;

type Point = { readonly x: number; readonly z: number };

const fixtureLane = (
  id: string,
  roadId: string,
  from: Point,
  to: Point,
  successors: readonly string[] = [],
): RegulatorySignLaneInput => ({
  id,
  roadId,
  role: "one_way",
  centerline: [from, to],
  successors,
  speedLimit: 40,
  trafficSide: "right",
});

const crossingAt = (roadId: string, z: number) =>
  [
    fixtureLane(`${roadId}-west-in`, roadId, { x: -40, z }, { x: 0, z }),
    fixtureLane(`${roadId}-west-out`, roadId, { x: 0, z }, { x: -40, z }),
    fixtureLane(`${roadId}-east-in`, roadId, { x: 40, z }, { x: 0, z }),
    fixtureLane(`${roadId}-east-out`, roadId, { x: 0, z }, { x: 40, z }),
  ] as const;

const nodeKey = (point: Point): string =>
  `${Math.round(point.x / NODE_EPSILON_M)}:${Math.round(point.z / NODE_EPSILON_M)}`;

const unitTo = (from: Point, to: Point) => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return length > 0.01 ? { x: dx / length, z: dz / length, length } : null;
};

/**
 * A road is one-way when every lane on it runs the same way — the same test
 * `buildTrafficGates` uses to decide a carriageway needs oncoming traffic.
 */
const oneWayRoadIds = (pack: ReturnType<typeof nycPack>): ReadonlySet<string> => {
  const byRoad = new Map<string, { x: number; z: number }[]>();
  for (const lane of pack.laneGraph.lanes) {
    if (lane.role === "roundabout" || lane.centerline.length < 2) continue;
    const direction = unitTo(lane.centerline[0], lane.centerline.at(-1)!);
    if (!direction) continue;
    const list = byRoad.get(lane.roadId) ?? [];
    list.push(direction);
    byRoad.set(lane.roadId, list);
  }
  const oneWay = new Set<string>();
  for (const [roadId, directions] of byRoad) {
    const reference = directions[0];
    if (
      directions.every(
        (direction) => direction.x * reference.x + direction.z * reference.z >= 0,
      )
    ) {
      oneWay.add(roadId);
    }
  }
  return oneWay;
};

/**
 * Every junction arm of a one-way road, keyed the way the module buckets them:
 * per road, per octant of the bearing from the node toward the arm's far end.
 * Two parallel lanes of the same avenue share an arm and therefore one sign
 * pair. `departing` arms are enterable mouths; `arriving` arms are forbidden.
 */
interface OneWayArm {
  readonly roadId: string;
  readonly node: Point;
  /** Unit vector from the node along the arm, toward its far end. */
  readonly along: { readonly x: number; readonly z: number };
  readonly lengthM: number;
  /** "mixed" is an ordinary two-way arm, which earns no signs. */
  readonly departing: boolean | "mixed";
}

type NycLane = ReturnType<typeof nycPack>["laneGraph"]["lanes"][number];
interface OneWayEnd {
  readonly lane: NycLane;
  readonly opposite: Point;
  readonly departing: boolean;
}

const successorContinuitySeam = (
  position: Point,
  ends: readonly OneWayEnd[],
): boolean => {
  const roadIds = new Set(ends.map((end) => end.lane.roadId));
  if (roadIds.size !== 2) return false;
  const armKeys = new Set(
    ends.map((end) => {
      const bearing = Math.atan2(
        end.opposite.x - position.x,
        end.opposite.z - position.z,
      );
      const bucket = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
      return `${end.lane.roadId}|${bucket}`;
    }),
  );
  if (armKeys.size !== 2) return false;
  const arriving = ends.filter((end) => !end.departing);
  const departing = ends.filter((end) => end.departing);
  const arrivingRoads = new Set(arriving.map((end) => end.lane.roadId));
  const departingRoads = new Set(departing.map((end) => end.lane.roadId));
  if (
    !arriving.length ||
    !departing.length ||
    arrivingRoads.size !== 1 ||
    departingRoads.size !== 1 ||
    arrivingRoads.values().next().value === departingRoads.values().next().value
  ) {
    return false;
  }
  const departingIds = new Set(departing.map((end) => end.lane.id));
  return (
    arriving.every((end) =>
      end.lane.successors.some((id) => departingIds.has(id)),
    ) &&
    departing.every((end) =>
      arriving.some((arrival) => arrival.lane.successors.includes(end.lane.id)),
    )
  );
};

const oneWayArms = (pack: ReturnType<typeof nycPack>): readonly OneWayArm[] => {
  const oneWay = oneWayRoadIds(pack);
  const nodes = new Map<
    string,
    {
      position: Point;
      roadIds: Set<string>;
      arms: Map<string, OneWayArm>;
      ends: OneWayEnd[];
    }
  >();
  const visit = (
    node: Point,
    opposite: Point,
    lane: NycLane,
    departing: boolean,
  ) => {
    const roadId = lane.roadId;
    const key = nodeKey(node);
    const entry = nodes.get(key) ?? {
      position: node,
      roadIds: new Set<string>(),
      arms: new Map<string, OneWayArm>(),
      ends: [],
    };
    entry.roadIds.add(roadId);
    entry.ends.push({ lane, opposite, departing });
    nodes.set(key, entry);
    if (!oneWay.has(roadId)) return;
    const along = unitTo(node, opposite);
    if (!along) return;
    const bearing = Math.atan2(along.x, along.z);
    const octant = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
    const armKey = `${roadId}|${octant}`;
    // An arm mixing departing and arriving lanes is an ordinary two-way arm;
    // the module signs neither. Record the mix so we can drop it below.
    const existing = entry.arms.get(armKey);
    if (existing) {
      if (existing.departing !== departing) {
        entry.arms.set(armKey, { ...existing, departing: "mixed" });
      }
      return;
    }
    entry.arms.set(armKey, {
      roadId,
      node,
      along: { x: along.x, z: along.z },
      lengthM: along.length,
      departing,
    });
  };
  for (const lane of pack.laneGraph.lanes) {
    if (lane.role === "roundabout" || lane.centerline.length < 2) continue;
    const start = lane.centerline[0];
    const end = lane.centerline.at(-1)!;
    if (nodeKey(start) === nodeKey(end)) continue;
    visit(start, end, lane, true);
    visit(end, start, lane, false);
  }
  const arms: OneWayArm[] = [];
  for (const entry of nodes.values()) {
    // Mid-road nodes joining two blocks of the same road offer no turn to warn
    // about, so the module signs only junctions where roads actually meet.
    if (entry.roadIds.size < 2) continue;
    if (successorContinuitySeam(entry.position, entry.ends)) continue;
    for (const arm of entry.arms.values()) {
      if (typeof arm.departing !== "boolean") continue;
      if (arm.lengthM < MIN_ARM_LENGTH_M) continue;
      arms.push(arm);
    }
  }
  return arms;
};

const distanceToPolyline = (
  point: Point,
  polyline: readonly Point[],
): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq),
        )
      : 0;
    best = Math.min(
      best,
      Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t)),
    );
  }
  return best;
};

describe("one-way road-id seams and short mouths", () => {
  it("suppresses only a successor-linked degree-two authoring seam", () => {
    const slip = fixtureLane(
      "slip-lane",
      "slip-road",
      { x: 0, z: -40 },
      { x: 0, z: 0 },
      ["deck-lane"],
    );
    const deck = fixtureLane(
      "deck-lane",
      "deck-road",
      { x: 0, z: 0 },
      { x: 0, z: 40 },
    );
    const roadSurfaces = [
      { widthM: 6, laneIds: [slip.id], centerline: slip.centerline },
      { widthM: 6, laneIds: [deck.id], centerline: deck.centerline },
    ];

    expect(
      regulatorySignPlacements({
        lanes: [slip, deck],
        roadSurfaces,
        defaultRoadWidthM: 6,
      }),
    ).toEqual([]);

    const unlinked = regulatorySignPlacements({
      lanes: [{ ...slip, successors: [] }, deck],
      roadSurfaces,
      defaultRoadWidthM: 6,
    });
    expect(unlinked.map((placement) => placement.refId)).toEqual([
      "deck-road@0,0:oneway:l",
      "deck-road@0,0:oneway:r",
      "slip-road@0,0:dne:l",
      "slip-road@0,0:dne:r",
      "slip-road@0,0:ww35:l",
      "slip-road@0,0:ww35:r",
    ]);
  });

  it("stations real mouth signs through short successor-linked end segments", () => {
    const south = crossingAt("south-cross", 0);
    const north = crossingAt("north-cross", 60);
    const first = fixtureLane(
      "ramp-first-lane",
      "ramp-first",
      { x: 0, z: 0 },
      { x: 0, z: 6 },
      ["ramp-body-lane"],
    );
    const body = fixtureLane(
      "ramp-body-lane",
      "ramp-body",
      { x: 0, z: 6 },
      { x: 0, z: 54 },
      ["ramp-tail-lane"],
    );
    const tail = fixtureLane(
      "ramp-tail-lane",
      "ramp-tail",
      { x: 0, z: 54 },
      { x: 0, z: 60 },
    );
    const roadSurfaces = [
      { widthM: 6, laneIds: [first.id], centerline: first.centerline },
      { widthM: 6, laneIds: [body.id], centerline: body.centerline },
      { widthM: 6, laneIds: [tail.id], centerline: tail.centerline },
      {
        widthM: 8,
        laneIds: south.map((lane) => lane.id),
        centerline: [
          { x: -40, z: 0 },
          { x: 40, z: 0 },
        ],
      },
      {
        widthM: 8,
        laneIds: north.map((lane) => lane.id),
        centerline: [
          { x: -40, z: 60 },
          { x: 40, z: 60 },
        ],
      },
    ];
    const placements = regulatorySignPlacements({
      lanes: [first, body, tail, ...south, ...north],
      roadSurfaces,
      defaultRoadWidthM: 6,
    });

    const expected = new Map<
      string,
      readonly [RegulatorySignPlacement["kind"], number, number]
    >([
      ["ramp-first@0,0:oneway:l", ["one_way", -3.9, 10]],
      ["ramp-first@0,0:oneway:r", ["one_way", 3.9, 10]],
      ["ramp-tail@0,60:dne:l", ["do_not_enter", 3.9, 50]],
      ["ramp-tail@0,60:dne:r", ["do_not_enter", -3.9, 50]],
      ["ramp-tail@0,60:ww35:l", ["wrong_way", 3.9, 25]],
      ["ramp-tail@0,60:ww35:r", ["wrong_way", -3.9, 25]],
    ]);
    expect(placements.map((placement) => placement.refId)).toEqual([
      ...expected.keys(),
    ]);
    for (const placement of placements) {
      const [kind, x, z] = expected.get(placement.refId)!;
      expect(placement.kind, placement.refId).toBe(kind);
      expect(placement.x, placement.refId).toBeCloseTo(x, 9);
      expect(placement.z, placement.refId).toBeCloseTo(z, 9);
      expect(placement.flowHeadingRad, placement.refId).toBeCloseTo(0, 9);
    }
  });

  it("slides a blocked kerb post while preserving legal-flow facing", () => {
    const cross = crossingAt("cross", 0);
    const approach = fixtureLane(
      "approach-lane",
      "approach",
      { x: 0, z: -80 },
      { x: 0, z: 0 },
    );
    const blocker = [
      fixtureLane(
        "blocker-forward",
        "blocker",
        { x: 3.9, z: -14 },
        { x: 3.9, z: -6 },
      ),
      fixtureLane(
        "blocker-reverse",
        "blocker",
        { x: 3.9, z: -6 },
        { x: 3.9, z: -14 },
      ),
    ] as const;
    const roadSurfaces = [
      { widthM: 6, laneIds: [approach.id], centerline: approach.centerline },
      {
        widthM: 8,
        laneIds: cross.map((lane) => lane.id),
        centerline: [
          { x: -40, z: 0 },
          { x: 40, z: 0 },
        ],
      },
      {
        widthM: 2,
        laneIds: blocker.map((lane) => lane.id),
        centerline: [
          { x: 3.9, z: -14 },
          { x: 3.9, z: -6 },
        ],
      },
    ];
    const placements = regulatorySignPlacements({
      lanes: [approach, ...cross, ...blocker],
      roadSurfaces,
      defaultRoadWidthM: 6,
    });

    expect(placements.map((placement) => placement.refId)).toEqual([
      "approach@0,0:dne:l",
      "approach@0,0:dne:r",
      "approach@0,0:ww35:l",
      "approach@0,0:ww35:r",
    ]);
    const left = placements.find((placement) =>
      placement.refId.endsWith("dne:l"),
    )!;
    const right = placements.find((placement) =>
      placement.refId.endsWith("dne:r"),
    )!;
    expect(right.x).toBeCloseTo(-3.9, 9);
    expect(right.z).toBeCloseTo(-10, 9);
    expect(left.x).toBeCloseTo(3.9, 9);
    expect(left.z).toBeLessThan(-14.5);

    for (const placement of placements) {
      expect(placement.flowHeadingRad, placement.refId).toBeCloseTo(0, 9);
      expect(
        regulatorySignYawRad(placement.kind, placement.flowHeadingRad),
        placement.refId,
      ).toBeCloseTo(Math.PI, 9);
      for (const surface of roadSurfaces) {
        expect(
          distanceToPolyline(placement, surface.centerline),
          `${placement.refId} vs ${surface.laneIds.join(",")}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
      }
    }
  });
});

describe("NYC regulatory sign inventory", () => {
  const placements = nycPlacements();

  const pack = nycPack();
  const arms = oneWayArms(pack);
  const enterable = arms.filter((arm) => arm.departing === true);
  const forbidden = arms.filter((arm) => arm.departing === false);
  const armRef = (arm: OneWayArm): string =>
    `${arm.roadId}@${Math.round(arm.node.x * 10) / 10},${Math.round(arm.node.z * 10) / 10}`;
  const pairAt = (
    arm: OneWayArm,
    kind: RegulatorySignPlacement["kind"],
    suffix: string,
  ) =>
    placements.filter(
      (placement) =>
        placement.kind === kind &&
        (placement.refId === `${armRef(arm)}:${suffix}:l` ||
          placement.refId === `${armRef(arm)}:${suffix}:r`),
    );

  it("signs the map's one-way mouths and nothing else", () => {
    // There has to be something to test; a NYC with no one-way avenue would
    // pass every assertion below vacuously.
    expect(enterable.length, "enterable one-way mouths").toBeGreaterThan(0);
    expect(forbidden.length, "forbidden one-way mouths").toBeGreaterThan(0);

    // Ground slips and raised ramps introduce short road-id hand-offs. Those
    // are authoring seams, not junctions; every genuine arm still gets a pair,
    // while no globally two-way host or divided carrier can acquire one-way
    // signage merely because its directions use offset nodes.
    expect(byKind(placements, "one_way")).toHaveLength(enterable.length * 2);
    expect(byKind(placements, "do_not_enter")).toHaveLength(forbidden.length * 2);
    const expectedArms = new Set([...enterable, ...forbidden].map(armRef));
    for (const placement of placements) {
      const junctionRef = placement.refId.split(":").slice(0, -2).join(":");
      expect(expectedArms, placement.refId).toContain(junctionRef);
    }
  });

  it("places a ONE WAY pair at every enterable one-way mouth", () => {
    for (const arm of enterable) {
      expect(
        pairAt(arm, "one_way", "oneway"),
        `${arm.roadId} mouth at (${arm.node.x}, ${arm.node.z})`,
      ).toHaveLength(2);
    }
  });

  it("places a DO NOT ENTER pair at every forbidden one-way mouth", () => {
    for (const arm of forbidden) {
      expect(
        pairAt(arm, "do_not_enter", "dne"),
        `${arm.roadId} mouth at (${arm.node.x}, ${arm.node.z})`,
      ).toHaveLength(2);
    }
  });

  it("repeats WRONG WAY pairs at 35 m and mid-block on every one-way block", () => {
    for (const arm of forbidden) {
      const label = `${arm.roadId} arm at (${arm.node.x}, ${arm.node.z})`;
      expect(
        pairAt(arm, "wrong_way", `ww${WRONG_WAY_NEAR_M}`),
        `${label} near station`,
      ).toHaveLength(2);
    }
    // Pin the current authored long-block inventory. Checking only the pairs
    // that happened to be emitted would let every mid-block repeater vanish
    // together and still pass. The station suffix is the rounded halfway
    // distance along the complete successor-linked regulatory path.
    const expectedMidBlockStationRefs = new Set([
      "nyc-crescent@950,-360:ww360",
      "nyc-crescent@950,120:ww240",
      "nyc-crescent@950,600:ww240",
      "nyc-lexington@300,-480:ww240",
      "nyc-lexington@300,-960:ww240",
      "nyc-lexington@300,0:ww240",
      "nyc-madison@0,-480:ww240",
      "nyc-madison@0,0:ww240",
      "nyc-madison@0,480:ww240",
      "nyc-queensview-manhattan-third-exit-slip@441.7,-540:ww169",
      "nyc-queensview-queens-vernon-entry-ramp@850,-834.7:ww188",
    ]);
    const midBlockGroups = new Map<string, RegulatorySignPlacement[]>();
    for (const placement of byKind(placements, "wrong_way")) {
      if (placement.refId.includes(`:ww${WRONG_WAY_NEAR_M}:`)) continue;
      const stationRef = placement.refId.slice(0, placement.refId.lastIndexOf(":"));
      midBlockGroups.set(stationRef, [
        ...(midBlockGroups.get(stationRef) ?? []),
        placement,
      ]);
    }
    expect(new Set(midBlockGroups.keys())).toEqual(expectedMidBlockStationRefs);
    const forbiddenRefs = new Set(forbidden.map(armRef));
    for (const [stationRef, pair] of midBlockGroups) {
      const junctionRef = stationRef.slice(0, stationRef.lastIndexOf(":"));
      expect(forbiddenRefs, stationRef).toContain(junctionRef);
      expect(pair, stationRef).toHaveLength(2);
    }
  });

  it("points every message face along the legal flow", () => {
    // Follow the local lane tangent, not the endpoint chord: curved ramps can
    // turn several degrees between their mouth and a slid post. A long slip
    // repeater may also cross onto its successor ramp, so match any nearby
    // legal one-way lane on the same elevation level.
    const oneWay = oneWayRoadIds(pack);
    const oneWayLanes = pack.laneGraph.lanes.filter(
      (lane) => oneWay.has(lane.roadId) && lane.centerline.length >= 2,
    );
    for (const placement of placements) {
      const matchingHeadings: number[] = [];
      for (const lane of oneWayLanes) {
        for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
          const from = lane.centerline[index];
          const to = lane.centerline[index + 1];
          const dx = to.x - from.x;
          const dz = to.z - from.z;
          const lengthSq = dx * dx + dz * dz;
          if (lengthSq <= 1e-9) continue;
          const amount = Math.max(
            0,
            Math.min(
              1,
              ((placement.x - from.x) * dx + (placement.z - from.z) * dz) /
                lengthSq,
            ),
          );
          const elevationM =
            (from.elevationM ?? 0) +
            ((to.elevationM ?? 0) - (from.elevationM ?? 0)) * amount;
          if (
            roadLevelAtElevation(elevationM) !==
            roadLevelAtElevation(placement.elevationM ?? 0)
          ) {
            continue;
          }
          const distance = Math.hypot(
            placement.x - (from.x + dx * amount),
            placement.z - (from.z + dz * amount),
          );
          if (distance <= 10) matchingHeadings.push(Math.atan2(dx, dz));
        }
      }
      expect(
        matchingHeadings.some((heading) => {
          const difference = Math.abs(
            Math.atan2(
              Math.sin(placement.flowHeadingRad - heading),
              Math.cos(placement.flowHeadingRad - heading),
            ),
          );
          return difference < 0.06;
        }),
        placement.refId,
      ).toBe(true);
    }
  });

  it("keeps every post owned by a globally one-way road", () => {
    // Two-way roads must stay unsigned even when a divided direction has an
    // offset branch node. Ownership, not nearest plan-view asphalt, is the
    // authority because an elevated ramp can pass above another road.
    const oneWay = oneWayRoadIds(pack);
    for (const placement of placements) {
      expect(
        oneWay.has(placement.roadId),
        `${placement.refId} belongs to two-way ${placement.roadId}`,
      ).toBe(true);
    }
  });

  it("faces every DO NOT ENTER back toward the junction it guards", () => {
    for (const placement of byKind(placements, "do_not_enter")) {
      const arm = forbidden.find((candidate) =>
        placement.refId.startsWith(`${armRef(candidate)}:dne:`),
      );
      expect(arm, placement.refId).toBeDefined();
      const toNode = {
        x: arm!.node.x - placement.x,
        z: arm!.node.z - placement.z,
      };
      expect(
        toNode.x * Math.sin(placement.flowHeadingRad) +
          toNode.z * Math.cos(placement.flowHeadingRad),
        placement.refId,
      ).toBeGreaterThan(0);
    }
  });

  it("stands clear of same-level carriageways and signal masts", () => {
    for (const placement of placements) {
      for (const surface of pack.geometry.roadSurfaces ?? []) {
        if (
          roadLevelAtElevation(placement.elevationM ?? 0) !==
          roadLevelAtElevation(
            elevationOnPolylineAt(surface.centerline, placement.x, placement.z),
          )
        ) {
          continue;
        }
        expect(
          distanceToPolyline(placement, surface.centerline),
          `${placement.refId} vs ${surface.id}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
      }
      for (const control of pack.laneGraph.controls) {
        for (const installation of control.installations ?? []) {
          if (
            roadLevelAtElevation(placement.elevationM ?? 0) !==
            roadLevelAtElevation(installation.position.elevationM ?? 0)
          ) {
            continue;
          }
          expect(
            Math.hypot(
              placement.x - installation.position.x,
              placement.z - installation.position.z,
            ),
            `${placement.refId} vs ${installation.id}`,
          ).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });
});

describe("regulatorySignYawRad", () => {
  it("hangs ONE WAY blades perpendicular to the flow", () => {
    expect(regulatorySignYawRad("one_way", 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("turns message faces to look against the flow", () => {
    // Message on the -Z face: mesh yaw = flow + pi puts the -Z normal on the
    // flow heading, so the face reads to a viewer looking against it.
    expect(Math.abs(regulatorySignYawRad("do_not_enter", Math.PI))).toBeLessThan(1e-9);
    expect(regulatorySignYawRad("wrong_way", 0)).toBeCloseTo(Math.PI, 9);
  });
});

describe("robustness across map packs", () => {
  it("derives deterministically", () => {
    expect(nycPlacements()).toEqual(nycPlacements());
  });

  it("runs on every pack and keeps clear of roundabouts", () => {
    for (const pack of MAP_PACKS) {
      const placements = regulatorySignPlacements({
        lanes: pack.laneGraph.lanes,
        roadSurfaces: pack.geometry.roadSurfaces,
        defaultRoadWidthM: pack.geometry.roadWidth,
      });
      const ringEndpoints = pack.laneGraph.lanes
        .filter((lane) => lane.role === "roundabout")
        .flatMap((lane) => [
          lane.centerline[0],
          lane.centerline[lane.centerline.length - 1],
        ]);
      for (const placement of placements) {
        for (const endpoint of ringEndpoints) {
          expect(
            Math.hypot(placement.x - endpoint.x, placement.z - endpoint.z),
            `${pack.id}/${placement.refId}`,
          ).toBeGreaterThan(15);
        }
      }
    }
  });

  it("keeps Cairo's Tahrir repeater out of the Corniche carriageway", () => {
    const pack = getMapPack("cairo-central-nile");
    const placements = regulatorySignPlacements({
      lanes: pack.laneGraph.lanes,
      roadSurfaces: pack.geometry.roadSurfaces,
      defaultRoadWidthM: pack.geometry.roadWidth,
    });

    expect(
      placements.some(
        (placement) =>
          placement.refId === "cairo-tahrir-approach@125,-292.2:ww35:l",
      ),
    ).toBe(false);
    expect(
      placements.some(
        (placement) =>
          placement.refId === "cairo-tahrir-approach@125,-292.2:ww35:r",
      ),
    ).toBe(true);

    for (const placement of placements) {
      for (const surface of pack.geometry.roadSurfaces ?? []) {
        if (
          roadLevelAtElevation(placement.elevationM ?? 0) !==
          roadLevelAtElevation(
            elevationOnPolylineAt(surface.centerline, placement.x, placement.z),
          )
        ) {
          continue;
        }
        expect(
          distanceToPolyline(placement, surface.centerline),
          `${placement.refId} vs ${surface.id}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
      }
    }
  });
});

describe("Cairo regulatory sign presentation", () => {
  const pack = getMapPack("cairo-central-nile");
  const signInput = {
    lanes: pack.laneGraph.lanes,
    roadSurfaces: pack.geometry.roadSurfaces,
    defaultRoadWidthM: pack.geometry.roadWidth,
    occupiedPositions: pack.laneGraph.controls.flatMap((control) =>
      (control.installations ?? [])
        .filter((installation) => installation.mounting !== "road_marking")
        .map((installation) => installation.position),
    ),
  };
  const raw = regulatorySignPlacements(signInput);
  const placements = curateCairoRegulatorySigns(raw);

  it("de-pairs posts and limits negative warnings to two well-spaced signs per road", () => {
    expect(placements.length).toBeLessThan(raw.length / 3);
    const warningsByRoad = new Map<string, RegulatorySignPlacement[]>();
    for (const placement of placements) {
      if (placement.kind === "one_way") continue;
      const list = warningsByRoad.get(placement.roadId) ?? [];
      list.push(placement);
      warningsByRoad.set(placement.roadId, list);
    }
    for (const [roadId, warnings] of warningsByRoad) {
      expect(warnings.length, roadId).toBeLessThanOrEqual(2);
      expect(
        warnings.filter((placement) => placement.kind === "do_not_enter").length,
        `${roadId} DO NOT ENTER count`,
      ).toBeLessThanOrEqual(1);
      expect(
        warnings.filter((placement) => placement.kind === "wrong_way").length,
        `${roadId} WRONG WAY count`,
      ).toBeLessThanOrEqual(1);
      if (warnings.length === 2) {
        expect(
          Math.hypot(
            warnings[0].x - warnings[1].x,
            warnings[0].z - warnings[1].z,
          ),
          roadId,
        ).toBeGreaterThanOrEqual(72);
      }
    }
    for (let first = 0; first < placements.length; first += 1) {
      for (let second = first + 1; second < placements.length; second += 1) {
        expect(
          Math.hypot(
            placements[first].x - placements[second].x,
            placements[first].z - placements[second].z,
          ),
          `${placements[first].refId} vs ${placements[second].refId}`,
        ).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("removes the reviewed east, Corniche, and west bridge intrusions", () => {
    const refs = new Set(placements.map((placement) => placement.refId));
    for (const removed of [
      "cairo-sixth-october-bridge-east-entry@638,180:dne:l",
      "cairo-sixth-october-bridge-east-entry@638,180:dne:r",
      "cairo-sixth-october-bridge-east-entry@638,180:ww35:l",
      "cairo-sixth-october-bridge-east-entry@638,180:ww35:r",
      "cairo-sixth-october-bridge-east-exit@638,180:oneway:l",
      "cairo-sixth-october-bridge-east-exit@638,180:oneway:r",
      "cairo-sixth-october-bridge-corniche-entry@160,231.6:dne:l",
      "cairo-sixth-october-bridge-corniche-entry@160,231.6:ww35:l",
      "cairo-sixth-october-bridge-corniche-entry@160,231.6:ww35:r",
      "cairo-sixth-october-bridge-west-entry@-720,340:dne:l",
      "cairo-sixth-october-bridge-west-exit@-720,340:oneway:r",
    ]) {
      expect(refs, removed).not.toContain(removed);
    }
    expect(refs).toContain(
      "cairo-sixth-october-bridge-corniche-entry@160,231.6:dne:r",
    );
    expect(refs).toContain(
      "cairo-sixth-october-east-exit-slip@713.8,85:dne:l",
    );
  });

  it("keeps every retained Sixth of October post on its own kerb profile", () => {
    for (const placement of placements.filter((candidate) =>
      candidate.roadId.startsWith("cairo-sixth-october"),
    )) {
      const surface = pack.geometry.roadSurfaces?.find(
        (candidate) => candidate.id === placement.roadId,
      );
      expect(surface, placement.refId).toBeDefined();
      const expectedOffsetM = surface!.widthM / 2 + KERB_MARGIN_M;
      expect(
        distanceToPolyline(placement, surface!.centerline),
        placement.refId,
      ).toBeCloseTo(expectedOffsetM, 1);
      expect(placement.elevationM ?? 0, placement.refId).toBeCloseTo(
        elevationOnPolylineAt(
          surface!.centerline,
          placement.x,
          placement.z,
        ),
        6,
      );
    }
  });

  it("derives deterministically with unique ids", () => {
    expect(placements).toEqual(
      curateCairoRegulatorySigns(regulatorySignPlacements(signInput)),
    );
    expect(new Set(placements.map((placement) => placement.refId)).size).toBe(
      placements.length,
    );
  });
});

/**
 * Speed-limit signage runs on every map, not just New York's MUTCD grid, and
 * it exists because the limit is now the one number the game charges you for
 * exceeding. These tests re-derive what should be posted from the lane graph
 * the same way the one-way suite above does.
 */
describe("speed-limit signage", () => {
  // Mirrors GameCanvas's `signInput` exactly, including the authored poles a
  // post has to slide clear of — derive it differently and this suite stops
  // testing what the game actually builds.
  const signsFor = (pack: ReturnType<typeof nycPack>) =>
    speedLimitSignPlacements({
      lanes: pack.laneGraph.lanes,
      roadSurfaces: pack.geometry.roadSurfaces,
      defaultRoadWidthM: pack.geometry.roadWidth,
      occupiedPositions: pack.laneGraph.controls.flatMap((control) =>
        (control.installations ?? [])
          .filter((installation) => installation.mounting !== "road_marking")
          .map((installation) => installation.position),
      ),
    });

  const presentedSignsFor = (pack: ReturnType<typeof nycPack>) => {
    const signs = signsFor(pack);
    return pack.id === "cairo-central-nile"
      ? curateCairoSpeedLimitSigns(signs)
      : pack.id === "nyc-upper-west-side"
        ? curateNycSpeedLimitSigns(signs)
      : signs;
  };

  const drivenRoadIds = (pack: ReturnType<typeof nycPack>) =>
    new Set(
      pack.laneGraph.lanes
        .filter((lane) => lane.role !== "roundabout")
        .map((lane) => lane.roadId),
    );

  it("follows Cairo's flyover profile from low ramps to the main deck", () => {
    const pack = getMapPack("cairo-central-nile");
    const signs = signsFor(pack).filter((sign) =>
      sign.roadId.startsWith("cairo-sixth-october"),
    );

    expect(signs.length).toBeGreaterThan(8);
    for (const sign of signs) {
      const surface = pack.geometry.roadSurfaces?.find(
        (candidate) => candidate.id === sign.roadId,
      );
      expect(surface, sign.refId).toBeDefined();
      expect(sign.elevationM ?? 0, sign.refId).toBeCloseTo(
        elevationOnPolylineAt(surface!.centerline, sign.x, sign.z),
        6,
      );
    }

    // A bridge-prefixed ramp is still a continuous grade: this repeater is
    // correctly above the street but below the broad minimap/deck threshold.
    const lowRampRepeater = signs.find(
      (sign) =>
        sign.roadId === "cairo-sixth-october-bridge-corniche-entry" &&
        sign.reason === "repeater",
    );
    expect(lowRampRepeater).toBeDefined();
    // Its exact height moves when the authored ramp profile is refined; the
    // loop above pins the real contract by deriving height from that profile.
    expect(lowRampRepeater!.elevationM ?? 0).toBeLessThan(
      ELEVATED_ROAD_LEVEL_THRESHOLD_M,
    );

    const mainDeckSigns = signs.filter(
      (sign) => sign.roadId === "cairo-sixth-october-bridge",
    );
    expect(mainDeckSigns.length).toBeGreaterThan(4);
    expect(
      mainDeckSigns.every(
        (sign) => Math.abs((sign.elevationM ?? 0) - 10.5) < 1e-6,
      ),
    ).toBe(true);
  });

  it("removes the reviewed 40 signs around the west bridge merge", () => {
    const pack = getMapPack("cairo-central-nile");
    const raw = signsFor(pack);
    const presented = presentedSignsFor(pack);
    const reviewed = [
      CAIRO_REMOVED_WEST_RAMP_SPEED_SIGN_REF_ID,
      CAIRO_REMOVED_DOKKI_RAMP_SPEED_SIGN_REF_ID,
    ];
    expect(raw.map((sign) => sign.refId)).toEqual(
      expect.arrayContaining(reviewed),
    );
    expect(presented.map((sign) => sign.refId)).toEqual(
      expect.not.arrayContaining(reviewed),
    );
    expect(presented.map((sign) => sign.refId)).toContain(
      "cairo-sixth-october-bridge-west-entry@-788,330:e:limit40:repeater",
    );
    expect(presented).toHaveLength(raw.length - reviewed.length);
  });

  it("removes redundant Queensview floor repeaters at exit branches", () => {
    const raw = signsFor(nycPack());
    const presented = presentedSignsFor(nycPack());
    expect(raw.map((sign) => sign.refId)).toEqual(
      expect.arrayContaining([...NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS]),
    );
    expect(presented.map((sign) => sign.refId)).toEqual(
      expect.not.arrayContaining([...NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS]),
    );
    expect(presented).toHaveLength(
      raw.length - NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS.length,
    );
  });

  it("posts every map, including the one that posts a single figure", () => {
    // London is 20 everywhere, so a "sign only where the limit changes" rule
    // would leave the entire city silent. It is the reason corridors carry a
    // floor sign whether or not they earned an entry one.
    for (const pack of MAP_PACKS) {
      expect(signsFor(pack).length, pack.id).toBeGreaterThan(0);
    }
    const london = signsFor(getMapPack("london-south-kensington"));
    expect(new Set(london.map((sign) => sign.limitFigure))).toEqual(new Set([20]));
    expect(london.every((sign) => sign.reason === "repeater")).toBe(true);
  });

  it("never out-numbers the signage it stands beside", () => {
    // A count regression is how this quietly becomes a forest of posts. NYC,
    // Cairo, London and now Tokyo are the full-size cities; each joined once
    // it grew past its original small-map footprint — London past the museum
    // quarter, Tokyo past the 5.5 lane-km village (Tokyo expansion Phase 2,
    // ~44 lane-km). London's signs are all 20 mph repeaters, so its count
    // tracks road length rather than any change in what it posts; Tokyo's
    // vary by road class (60/50/40/30/20), so its count tracks BOTH road
    // length and the residential web's much higher junction density. Tokyo
    // gets its own, higher budget rather than a shared one raised for every
    // city: at 289 (Phase 3's river/bridges/east-bank web — real new signed
    // road length, not a regression) it would otherwise force NYC/Cairo/
    // London's own ceiling up too and quietly weaken their checks.
    // 320 -> 335 (Tokyo authenticity plan P7, Region D): four new roads
    // (measured at 334 signs) — real new signed road length and junction
    // density, not a regression, the same class of growth every earlier
    // bump here documents.
    // 335 -> 356 (Tokyo authenticity plan P8, Regions E+F): four new roads
    // (measured at 355 signs) — Region E's two new ring-tee locals
    // (Sazanka-dōri, Hiiragi-dōri) and Region F's spine/connector
    // (Kawabata-dōri, Kawasemi-dōri), plus new junctions on five existing
    // roads — real new signed road length and junction density, not a
    // regression, the same class of growth every earlier bump documents.
    // 356 -> 380 (Sakuragawa Urban Expressway): 23 new signed surfaces across
    // roughly 4.3 km of trunk, carriers, ramps and flat auxiliary mouths
    // (measured at 376 signs). Geometry/elevation checks still keep every sign
    // beside its own carriageway and outside the driven envelope.
    const nyc = presentedSignsFor(nycPack());
    expect(nyc.length).toBeLessThan(nycPlacements().length);
    expect(nyc.length).toBeLessThanOrEqual(240);
    for (const pack of MAP_PACKS) {
      const budget =
        pack.id === "tokyo-setagaya"
          ? 380
          : pack.id === "nyc-upper-west-side" ||
            pack.id === "cairo-central-nile" ||
            pack.id === "london-south-kensington"
          ? 240
          : 60;
      expect(presentedSignsFor(pack).length, pack.id).toBeLessThanOrEqual(budget);
    }
  });

  it("posts the figure its own road is limited to", () => {
    // The invariant that makes signage unable to disagree with enforcement,
    // which is the whole reason both families derive from the lane graph.
    for (const pack of MAP_PACKS) {
      for (const sign of signsFor(pack)) {
        const lanes = pack.laneGraph.lanes.filter(
          (lane) => lane.roadId === sign.roadId,
        );
        expect(lanes.length, `${pack.id}/${sign.refId}`).toBeGreaterThan(0);
        for (const lane of lanes) {
          expect(lane.speedLimit, `${pack.id}/${sign.refId}`).toBe(
            sign.limitFigure,
          );
        }
      }
    }
  });

  it("communicates every figure the map posts", () => {
    for (const pack of MAP_PACKS) {
      const posted = new Set(
        pack.laneGraph.lanes
          .filter((lane) => lane.role !== "roundabout")
          .map((lane) => lane.speedLimit),
      );
      const signed = new Set(signsFor(pack).map((sign) => sign.limitFigure));
      expect(signed, pack.id).toEqual(posted);
    }
  });

  it("stands on its own road's kerb, following the road round a bend", () => {
    // The bug this pins: stationing off the straight chord between junctions
    // puts a post inside the carriageway on every curved road — 0.8 m into
    // Cromwell Road, 2.8 m into fr-north-west-road, 0.6 m into jp-east-curve.
    for (const pack of MAP_PACKS) {
      for (const sign of signsFor(pack)) {
        const surface = pack.geometry.roadSurfaces.find(
          (candidate) => candidate.id === sign.roadId,
        );
        if (!surface) continue;
        const offset = distanceToPolyline(sign, surface.centerline);
        expect(offset, `${pack.id}/${sign.refId}`).toBeGreaterThanOrEqual(
          surface.widthM / 2 + KERB_MARGIN_M - 0.35,
        );
        expect(offset, `${pack.id}/${sign.refId}`).toBeLessThanOrEqual(
          surface.widthM / 2 + KERB_MARGIN_M + 0.35,
        );
      }
    }
  });

  it("stands clear of every carriageway and signal mast, on every map", () => {
    // The one-way suite only ever checked this on NYC's straight grid.
    for (const pack of MAP_PACKS) {
      for (const sign of signsFor(pack)) {
        for (const surface of pack.geometry.roadSurfaces ?? []) {
          if (
            roadLevelAtElevation(sign.elevationM ?? 0) !==
            roadLevelAtElevation(
              elevationOnPolylineAt(surface.centerline, sign.x, sign.z),
            )
          ) {
            continue;
          }
          expect(
            distanceToPolyline(sign, surface.centerline),
            `${pack.id}/${sign.refId} vs ${surface.id}`,
          ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
        }
        for (const control of pack.laneGraph.controls) {
          for (const installation of control.installations ?? []) {
            expect(
              Math.hypot(
                sign.x - installation.position.x,
                sign.z - installation.position.z,
              ),
              `${pack.id}/${sign.refId} vs ${installation.id}`,
            ).toBeGreaterThanOrEqual(2.5);
          }
        }
      }
    }
  });

  it("never shares a kerb station with a one-way post", () => {
    // LIMIT_OFFSET_M sits deliberately past MOUTH_OFFSET_M for this reason.
    for (const sign of presentedSignsFor(nycPack())) {
      for (const other of nycPlacements()) {
        expect(
          Math.hypot(sign.x - other.x, sign.z - other.z),
          `${sign.refId} vs ${other.refId}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("faces the driver it is for, which is the opposite of a DO NOT ENTER", () => {
    // The contrast is the contract: a DO NOT ENTER faces the driver coming the
    // wrong way, a limit sign faces the one obeying it. Copying the wrong
    // formula is the likeliest bug here and reads plausibly on screen.
    expect(speedLimitSignYawRad(0)).toBeCloseTo(0, 9);
    expect(Math.abs(speedLimitSignYawRad(Math.PI))).toBeCloseTo(Math.PI, 9);
    for (const flow of [0, 0.7, -1.2, Math.PI / 2]) {
      const difference = Math.abs(
        speedLimitSignYawRad(flow) - regulatorySignYawRad("do_not_enter", flow),
      );
      expect(Math.min(difference, Math.PI * 2 - difference)).toBeCloseTo(
        Math.PI,
        9,
      );
    }
  });

  it("leaves no long drive without a posted limit", () => {
    // The answer to a mid-road spawn: corridors are same-limit by
    // construction, so leaving one always crosses a change, and a change is
    // always an entry sign. Measured worst case is a little over 200 m.
    const READABLE_M = 25;
    for (const pack of MAP_PACKS) {
      const signs = presentedSignsFor(pack);
      const byId = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const passesSign = (lane: (typeof pack.laneGraph.lanes)[number]) =>
        signs.some((sign) =>
          lane.centerline.some(
            (point) => Math.hypot(point.x - sign.x, point.z - sign.z) <= READABLE_M,
          ),
        );
      for (const start of pack.laneGraph.lanes) {
        if (start.role === "roundabout") continue;
        // Breadth-first along successors: how far before a sign is readable.
        let frontier = [{ id: start.id, distance: 0 }];
        const seen = new Set<string>();
        let reached = Number.POSITIVE_INFINITY;
        while (frontier.length && reached === Number.POSITIVE_INFINITY) {
          const next: typeof frontier = [];
          for (const step of frontier) {
            if (seen.has(step.id)) continue;
            seen.add(step.id);
            const lane = byId.get(step.id);
            if (!lane) continue;
            if (passesSign(lane)) {
              reached = Math.min(reached, step.distance);
              continue;
            }
            let length = 0;
            for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
              length += Math.hypot(
                lane.centerline[index + 1].x - lane.centerline[index].x,
                lane.centerline[index + 1].z - lane.centerline[index].z,
              );
            }
            for (const successor of lane.successors) {
              next.push({ id: successor, distance: step.distance + length });
            }
          }
          frontier = next;
        }
        expect(reached, `${pack.id}/${start.id}`).toBeLessThanOrEqual(
          LIMIT_REPEATER_SPACING_M,
        );
      }
    }
  });

  it("keeps posts off the rings and apart from each other", () => {
    for (const pack of MAP_PACKS) {
      const signs = signsFor(pack);
      const roads = drivenRoadIds(pack);
      for (const sign of signs) {
        expect(roads, `${pack.id}/${sign.refId}`).toContain(sign.roadId);
      }
      for (let left = 0; left < signs.length; left += 1) {
        for (let right = left + 1; right < signs.length; right += 1) {
          expect(
            Math.hypot(
              signs[left].x - signs[right].x,
              signs[left].z - signs[right].z,
            ),
            `${signs[left].refId} vs ${signs[right].refId}`,
          ).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("posts two-digit figures, which is what the sign faces are drawn for", () => {
    for (const pack of MAP_PACKS) {
      for (const sign of signsFor(pack)) {
        expect(String(sign.limitFigure), pack.id).toMatch(/^\d{2}$/);
      }
    }
  });

  it("derives deterministically, with unique ids", () => {
    for (const pack of MAP_PACKS) {
      const signs = signsFor(pack);
      expect(signs).toEqual(signsFor(pack));
      expect(new Set(signs.map((sign) => sign.refId)).size, pack.id).toBe(
        signs.length,
      );
    }
  });

  it("picks the sign design from the country, not the unit", () => {
    // Britain reads in mph and still posts a red-ringed circle, so speedUnit
    // cannot choose the face.
    expect(speedLimitSignFamily("us")).toBe("mutcd");
    for (const country of ["uk", "fr", "jp"]) {
      expect(speedLimitSignFamily(country), country).toBe("vienna");
    }
  });
});
