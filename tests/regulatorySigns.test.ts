import { describe, expect, it } from "vitest";
import { getMapPack, MAP_PACKS } from "../app/game/content";
import {
  regulatorySignPlacements,
  regulatorySignYawRad,
  speedLimitSignFamily,
  speedLimitSignPlacements,
  speedLimitSignYawRad,
  LIMIT_REPEATER_SPACING_M,
  type RegulatorySignPlacement,
} from "../app/game/regulatorySigns";

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

// Mirrors regulatorySigns.ts. A mouth sign stands MOUTH_OFFSET_M along the arm
// and half a carriageway plus KERB_MARGIN_M off to each side, so a post sits
// hypot(10, width/2 + 0.9) from the node it guards.
const MOUTH_OFFSET_M = 10;
const KERB_MARGIN_M = 0.9;
const WRONG_WAY_NEAR_M = 35;
const WRONG_WAY_MIDBLOCK_MIN_M = 320;
const NODE_EPSILON_M = 0.08;
const MIN_ARM_LENGTH_M = MOUTH_OFFSET_M * 2;

type Point = { readonly x: number; readonly z: number };

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

const oneWayArms = (pack: ReturnType<typeof nycPack>): readonly OneWayArm[] => {
  const oneWay = oneWayRoadIds(pack);
  const nodes = new Map<
    string,
    { position: Point; roadIds: Set<string>; arms: Map<string, OneWayArm> }
  >();
  const visit = (node: Point, opposite: Point, roadId: string, departing: boolean) => {
    const key = nodeKey(node);
    const entry = nodes.get(key) ?? {
      position: node,
      roadIds: new Set<string>(),
      arms: new Map<string, OneWayArm>(),
    };
    entry.roadIds.add(roadId);
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
    visit(start, end, lane.roadId, true);
    visit(end, start, lane.roadId, false);
  }
  const arms: OneWayArm[] = [];
  for (const entry of nodes.values()) {
    // Mid-road nodes joining two blocks of the same road offer no turn to warn
    // about, so the module signs only junctions where roads actually meet.
    if (entry.roadIds.size < 2) continue;
    for (const arm of entry.arms.values()) {
      if (typeof arm.departing !== "boolean") continue;
      if (arm.lengthM < MIN_ARM_LENGTH_M) continue;
      arms.push(arm);
    }
  }
  return arms;
};

/** Posts within a metre of an expected station, on either kerb. */
const postsNear = (
  placements: readonly RegulatorySignPlacement[],
  kind: RegulatorySignPlacement["kind"],
  station: Point,
  lateralM: number,
) =>
  placements.filter(
    (placement) =>
      placement.kind === kind &&
      Math.abs(
        Math.hypot(placement.x - station.x, placement.z - station.z) - lateralM,
      ) < 1,
  );

/** Carriageway width for a road, as the module resolves it. */
const roadWidth = (pack: ReturnType<typeof nycPack>, roadId: string): number => {
  const surface = pack.geometry.roadSurfaces?.find(
    (candidate) => candidate.id === roadId,
  );
  return surface?.widthM ?? pack.geometry.roadWidth;
};

const stationAlong = (arm: OneWayArm, distanceM: number): Point => ({
  x: arm.node.x + arm.along.x * distanceM,
  z: arm.node.z + arm.along.z * distanceM,
});

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

describe("NYC regulatory sign inventory", () => {
  const placements = nycPlacements();

  const pack = nycPack();
  const arms = oneWayArms(pack);
  const enterable = arms.filter((arm) => arm.departing === true);
  const forbidden = arms.filter((arm) => arm.departing === false);

  it("signs the map's one-way mouths and nothing else", () => {
    // There has to be something to test; a NYC with no one-way avenue would
    // pass every assertion below vacuously.
    expect(enterable.length, "enterable one-way mouths").toBeGreaterThan(0);
    expect(forbidden.length, "forbidden one-way mouths").toBeGreaterThan(0);

    // Posts always come in kerb pairs, one per mouth per kind, plus a WRONG
    // WAY repeater mid-block on arms long enough to warrant one.
    const longForbidden = forbidden.filter(
      (arm) => arm.lengthM > WRONG_WAY_MIDBLOCK_MIN_M,
    );
    expect(byKind(placements, "one_way")).toHaveLength(enterable.length * 2);
    expect(byKind(placements, "do_not_enter")).toHaveLength(forbidden.length * 2);
    expect(byKind(placements, "wrong_way")).toHaveLength(
      (forbidden.length + longForbidden.length) * 2,
    );
  });

  it("places a ONE WAY pair at every enterable one-way mouth", () => {
    for (const arm of enterable) {
      const lateral = roadWidth(pack, arm.roadId) / 2 + KERB_MARGIN_M;
      expect(
        postsNear(placements, "one_way", stationAlong(arm, MOUTH_OFFSET_M), lateral),
        `${arm.roadId} mouth at (${arm.node.x}, ${arm.node.z})`,
      ).toHaveLength(2);
    }
  });

  it("places a DO NOT ENTER pair at every forbidden one-way mouth", () => {
    for (const arm of forbidden) {
      const lateral = roadWidth(pack, arm.roadId) / 2 + KERB_MARGIN_M;
      expect(
        postsNear(
          placements,
          "do_not_enter",
          stationAlong(arm, MOUTH_OFFSET_M),
          lateral,
        ),
        `${arm.roadId} mouth at (${arm.node.x}, ${arm.node.z})`,
      ).toHaveLength(2);
    }
  });

  it("repeats WRONG WAY pairs at 35 m and mid-block on every one-way block", () => {
    for (const arm of forbidden) {
      const lateral = roadWidth(pack, arm.roadId) / 2 + KERB_MARGIN_M;
      const label = `${arm.roadId} arm at (${arm.node.x}, ${arm.node.z})`;
      expect(
        postsNear(
          placements,
          "wrong_way",
          stationAlong(arm, WRONG_WAY_NEAR_M),
          lateral,
        ),
        `${label} near station`,
      ).toHaveLength(2);
      if (arm.lengthM > WRONG_WAY_MIDBLOCK_MIN_M) {
        expect(
          postsNear(
            placements,
            "wrong_way",
            stationAlong(arm, arm.lengthM / 2),
            lateral,
          ),
          `${label} mid-block station`,
        ).toHaveLength(2);
      }
    }
  });

  it("points every message face along the legal flow", () => {
    // The nearest one-way lane to a post is the block it guards; its own
    // heading is the legal flow, and every face must agree with it.
    const oneWay = oneWayRoadIds(pack);
    const oneWayLanes = pack.laneGraph.lanes.filter(
      (lane) => oneWay.has(lane.roadId) && lane.centerline.length >= 2,
    );
    for (const placement of placements) {
      let best: (typeof oneWayLanes)[number] | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const lane of oneWayLanes) {
        const distance = distanceToPolyline(placement, lane.centerline);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = lane;
        }
      }
      const flow = unitTo(best!.centerline[0], best!.centerline.at(-1)!)!;
      // ONE WAY blades point away from the junction along their own arm, which
      // for an enterable mouth is the direction of legal travel too.
      const expected = Math.atan2(flow.x, flow.z);
      const difference = Math.abs(
        Math.atan2(
          Math.sin(placement.flowHeadingRad - expected),
          Math.cos(placement.flowHeadingRad - expected),
        ),
      );
      expect(difference, `${placement.refId} beside ${best!.id}`).toBeLessThan(
        1e-6,
      );
    }
  });

  it("keeps every post on a one-way road", () => {
    // Two-way roads must stay unsigned: a DO NOT ENTER on a street you may
    // legally turn into is worse than no sign at all.
    const oneWay = oneWayRoadIds(pack);
    const surfaces = pack.geometry.roadSurfaces ?? [];
    for (const placement of placements) {
      let nearest = surfaces[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const surface of surfaces) {
        const distance = distanceToPolyline(placement, surface.centerline);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = surface;
        }
      }
      expect(
        oneWay.has(nearest.id),
        `${placement.refId} stands beside two-way ${nearest.id}`,
      ).toBe(true);
    }
  });

  it("faces every DO NOT ENTER at its junction", () => {
    const junctions = new Set(
      pack.laneGraph.nodes.map((node) => nodeKey(node.position)),
    );
    for (const placement of byKind(placements, "do_not_enter")) {
      // Walking MOUTH_OFFSET_M along the message-face normal from the post's
      // station lands on the mouth's centreline; stepping back off the kerb
      // from there must land on the junction node the sign guards.
      const mouthX = placement.x + Math.sin(placement.flowHeadingRad) * MOUTH_OFFSET_M;
      const mouthZ = placement.z + Math.cos(placement.flowHeadingRad) * MOUTH_OFFSET_M;
      const found = pack.laneGraph.nodes.some(
        (node) =>
          junctions.has(nodeKey(node.position)) &&
          Math.hypot(node.position.x - mouthX, node.position.z - mouthZ) <
            pack.geometry.roadWidth / 2 + KERB_MARGIN_M + 0.5,
      );
      expect(
        found,
        `${placement.refId} faces (${mouthX.toFixed(1)},${mouthZ.toFixed(1)})`,
      ).toBe(true);
    }
  });

  it("stands clear of carriageways and signal masts", () => {
    for (const placement of placements) {
      for (const surface of pack.geometry.roadSurfaces ?? []) {
        expect(
          distanceToPolyline(placement, surface.centerline),
          `${placement.refId} vs ${surface.id}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 0.5);
      }
      for (const control of pack.laneGraph.controls) {
        for (const installation of control.installations ?? []) {
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

  const drivenRoadIds = (pack: ReturnType<typeof nycPack>) =>
    new Set(
      pack.laneGraph.lanes
        .filter((lane) => lane.role !== "roundabout")
        .map((lane) => lane.roadId),
    );

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
    const nyc = signsFor(nycPack());
    expect(nyc.length).toBeLessThan(nycPlacements().length);
    expect(nyc.length).toBeLessThanOrEqual(240);
    for (const pack of MAP_PACKS) {
      const budget =
        pack.id === "tokyo-setagaya"
          ? 335
          : pack.id === "nyc-upper-west-side" ||
            pack.id === "cairo-central-nile" ||
            pack.id === "london-south-kensington"
          ? 240
          : 60;
      expect(signsFor(pack).length, pack.id).toBeLessThanOrEqual(budget);
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
    for (const sign of signsFor(nycPack())) {
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
      const signs = signsFor(pack);
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
