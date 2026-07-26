import { describe, expect, it } from "vitest";
import {
  buildGpsGraph,
  findGpsRoute,
  gpsGraphForLanes,
  projectOntoPolyline,
  routeDeviationM,
  trimRouteToPlayer,
  type GpsLane,
  type GpsPoint,
} from "../app/game/gpsRoute";
import { getMapPack } from "../app/game/content";
import { streetAddressesForMap } from "../app/game/streetAddresses";

/**
 * A 3x3 block of one-way streets, all running the same way, so "shortest" and
 * "legal" differ: you cannot simply drive back down the street you came up.
 *
 *   n0 --a--> n1 --b--> n2      (eastbound rows, south to north)
 *   |         |         |
 *   v         v         v       (northbound columns)
 */
const HEADING_NORTH = 0;
const HEADING_EAST = Math.PI / 2;

function lane(
  id: string,
  from: GpsPoint,
  to: GpsPoint,
  successors: readonly string[],
): GpsLane {
  return { id, centerline: [from, to], successors };
}

/** Two-way street: a pair of lanes 3.4 m apart running opposite ways, the
 * spacing NYC really uses (1.7 m either side of the road centreline). */
function twoWay(id: string, from: GpsPoint, to: GpsPoint): readonly GpsLane[] {
  return [
    lane(`${id}-fwd`, { x: from.x + 1.7, z: from.z }, { x: to.x + 1.7, z: to.z }, []),
    lane(`${id}-back`, { x: to.x - 1.7, z: to.z }, { x: from.x - 1.7, z: from.z }, []),
  ];
}

describe("gps route search", () => {
  const grid: readonly GpsLane[] = [
    // Eastbound rows.
    lane("row0-a", { x: 0, z: 0 }, { x: 100, z: 0 }, ["row0-b", "colA-0"]),
    lane("row0-b", { x: 100, z: 0 }, { x: 200, z: 0 }, ["colB-0"]),
    lane("row1-a", { x: 0, z: 100 }, { x: 100, z: 100 }, ["row1-b"]),
    lane("row1-b", { x: 100, z: 100 }, { x: 200, z: 100 }, []),
    // Northbound columns.
    lane("colA-0", { x: 100, z: 0 }, { x: 100, z: 100 }, ["row1-b"]),
    lane("colB-0", { x: 200, z: 0 }, { x: 200, z: 100 }, []),
  ];

  it("routes across the graph and starts at the player, not the lane end", () => {
    const graph = buildGpsGraph(grid);
    // Half way along row0-a, heading east, destination at the end of row1-b.
    const route = findGpsRoute(
      graph,
      { x: 50, z: 0 },
      HEADING_EAST,
      { x: 200, z: 100 },
    );
    expect(route.length).toBeGreaterThan(1);
    expect(route[0]).toEqual({ x: 50, z: 0 });
    const last = route[route.length - 1];
    expect(last.x).toBeCloseTo(200, 6);
    expect(last.z).toBeCloseTo(100, 6);
    // It turned north at x=100 rather than cutting the corner.
    expect(route.some((point) => point.x === 100 && point.z === 0)).toBe(true);
  });

  it("follows the one-way graph even when a shorter illegal line exists", () => {
    const graph = buildGpsGraph(grid);
    // Standing on row1-a, which only feeds row1-b. row0-a is 100 m south and
    // would be the straight-line choice; there is no legal way back to it.
    const route = findGpsRoute(
      graph,
      { x: 0, z: 100 },
      HEADING_EAST,
      { x: 200, z: 0 },
    );
    // colB-0 runs south-to-north and row0-b is unreachable from row1-a.
    expect(route).toEqual([]);
  });

  it("returns nothing when the destination lane has no inbound route", () => {
    const stranded: readonly GpsLane[] = [
      lane("a", { x: 0, z: 0 }, { x: 50, z: 0 }, []),
      lane("island", { x: 500, z: 500 }, { x: 550, z: 500 }, []),
    ];
    const route = findGpsRoute(
      buildGpsGraph(stranded),
      { x: 10, z: 0 },
      HEADING_EAST,
      { x: 540, z: 500 },
    );
    expect(route).toEqual([]);
  });

  it("drops a successor whose geometry does not meet its predecessor", () => {
    // buildConnectedNpcPath tolerates 2.5 m; beyond that the chain is broken
    // authored data and traffic despawns rather than teleporting. Same here.
    const broken: readonly GpsLane[] = [
      lane("a", { x: 0, z: 0 }, { x: 50, z: 0 }, ["b"]),
      lane("b", { x: 50, z: 40 }, { x: 100, z: 40 }, []),
    ];
    const route = findGpsRoute(
      buildGpsGraph(broken),
      { x: 10, z: 0 },
      HEADING_EAST,
      { x: 90, z: 40 },
    );
    expect(route).toEqual([]);
  });

  it("takes the lane that agrees with the heading, not the nearest one", () => {
    const street = twoWay("main", { x: 0, z: 0 }, { x: 200, z: 0 });
    // Sit 0.6 m to the west of the road centreline — nearer the backward lane —
    // but heading east. The route must run east regardless.
    const graph = buildGpsGraph(street);
    const route = findGpsRoute(
      graph,
      { x: 100, z: -0.6 },
      HEADING_EAST,
      { x: 190, z: 0 },
    );
    expect(route.length).toBeGreaterThan(1);
    expect(route[route.length - 1].x).toBeGreaterThan(route[0].x);
  });

  it("falls back to the nearest lane when nothing agrees with the heading", () => {
    const street = twoWay("main", { x: 0, z: 0 }, { x: 200, z: 0 });
    // Heading due north on an east-west street: neither lane agrees, so the
    // search still has to start somewhere rather than give up.
    const route = findGpsRoute(
      buildGpsGraph(street),
      { x: 100, z: 1.7 },
      HEADING_NORTH,
      { x: 190, z: 1.7 },
    );
    expect(route.length).toBeGreaterThan(1);
  });

  it("stops the line at the destination instead of the lane end", () => {
    const single: readonly GpsLane[] = [
      lane("a", { x: 0, z: 0 }, { x: 200, z: 0 }, []),
    ];
    const route = findGpsRoute(
      buildGpsGraph(single),
      { x: 20, z: 0 },
      HEADING_EAST,
      { x: 120, z: 0 },
    );
    expect(route[0]).toEqual({ x: 20, z: 0 });
    expect(route[route.length - 1]).toEqual({ x: 120, z: 0 });
  });

  it("routes around when the destination is behind the player on their lane", () => {
    // A loop: driving past a drop-off must send you round the block, not
    // backwards up the lane you are on.
    const loop: readonly GpsLane[] = [
      lane("n", { x: 0, z: 0 }, { x: 100, z: 0 }, ["e"]),
      lane("e", { x: 100, z: 0 }, { x: 100, z: 100 }, ["s"]),
      lane("s", { x: 100, z: 100 }, { x: 0, z: 100 }, ["w"]),
      lane("w", { x: 0, z: 100 }, { x: 0, z: 0 }, ["n"]),
    ];
    const route = findGpsRoute(
      buildGpsGraph(loop),
      { x: 80, z: 0 },
      HEADING_EAST,
      { x: 20, z: 0 },
    );
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual({ x: 80, z: 0 });
    const last = route[route.length - 1];
    expect(last.x).toBeCloseTo(20, 6);
    expect(last.z).toBeCloseTo(0, 6);
    // It went the long way round rather than reversing along its own lane.
    expect(route.some((point) => point.z >= 99)).toBe(true);
  });

  it("caches a graph per lane array identity", () => {
    expect(gpsGraphForLanes(grid)).toBe(gpsGraphForLanes(grid));
    expect(gpsGraphForLanes(grid)).not.toBe(gpsGraphForLanes([...grid]));
  });

  it("reuses its scratch across searches without leaking state", () => {
    const graph = buildGpsGraph(grid);
    const first = findGpsRoute(graph, { x: 50, z: 0 }, HEADING_EAST, { x: 200, z: 100 });
    const second = findGpsRoute(graph, { x: 50, z: 0 }, HEADING_EAST, { x: 200, z: 100 });
    expect(second).toEqual(first);
  });
});

describe("gps polyline maths", () => {
  const line: readonly GpsPoint[] = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
  ];

  it("projects onto the nearest segment and measures distance along", () => {
    const at = projectOntoPolyline(line, 40, 12);
    expect(at).not.toBeNull();
    expect(at?.index).toBe(0);
    expect(at?.x).toBeCloseTo(40, 6);
    expect(at?.z).toBeCloseTo(0, 6);
    expect(at?.distanceM).toBeCloseTo(12, 6);
    expect(at?.alongM).toBeCloseTo(40, 6);
    // Past the corner it lands on the second segment, 100 m in.
    expect(projectOntoPolyline(line, 108, 30)?.index).toBe(1);
    expect(projectOntoPolyline(line, 108, 30)?.alongM).toBeCloseTo(130, 6);
  });

  it("clamps to the ends rather than running off the line", () => {
    expect(projectOntoPolyline(line, -50, 0)?.alongM).toBeCloseTo(0, 6);
    expect(projectOntoPolyline(line, 100, 400)?.alongM).toBeCloseTo(200, 6);
  });

  it("reports deviation, and infinity for an empty route", () => {
    expect(routeDeviationM(line, 50, 8)).toBeCloseTo(8, 6);
    expect(routeDeviationM([], 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("trims the travelled part so the line starts at the car", () => {
    const trimmed = trimRouteToPlayer(line, 60, 3);
    expect(trimmed[0]).toEqual({ x: 60, z: 0 });
    expect(trimmed).toHaveLength(3);
    expect(trimmed[trimmed.length - 1]).toEqual({ x: 100, z: 100 });
    // Past the corner the first leg is gone entirely.
    expect(trimRouteToPlayer(line, 100, 50)).toHaveLength(2);
  });

  it("leaves a degenerate route alone", () => {
    expect(trimRouteToPlayer([], 0, 0)).toEqual([]);
    expect(trimRouteToPlayer([{ x: 5, z: 5 }], 0, 0)).toEqual([{ x: 5, z: 5 }]);
  });
});

/**
 * The synthetic graphs above cannot catch an authored-data regression — a lane
 * losing its successors, a street being renumbered — so one case runs against
 * the real city the game actually ships.
 */
describe("gps route on the shipped NYC map", () => {
  const pack = getMapPack("nyc-upper-west-side");
  const lanes = pack.laneGraph.lanes;
  const laneById = new Map(lanes.map((each) => [each.id, each]));

  const distanceToNearestLane = (point: GpsPoint): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const lane of lanes) {
      const at = projectOntoPolyline(lane.centerline, point.x, point.z);
      if (at && at.distanceM < best) best = at.distanceM;
    }
    return best;
  };

  it("routes between real gig addresses, legally and continuously", () => {
    const addresses = streetAddressesForMap(pack);
    expect(addresses.length).toBeGreaterThan(10);
    const graph = gpsGraphForLanes(lanes);

    // A spread of real drop-offs, each routed to from the one before it.
    const sampled = addresses.filter((_, index) => index % 7 === 0).slice(0, 12);
    expect(sampled.length).toBeGreaterThan(8);
    for (let index = 1; index < sampled.length; index += 1) {
      const from = sampled[index - 1];
      const to = sampled[index];
      const lane = laneById.get(from.laneId);
      expect(lane).toBeDefined();
      // Head the way the lane the address sits on actually runs.
      const points = lane!.centerline;
      const heading = Math.atan2(
        points[1].x - points[0].x,
        points[1].z - points[0].z,
      );
      const route = findGpsRoute(graph, from, heading, to);
      expect(
        route.length,
        `no route from ${from.laneId} to ${to.laneId}`,
      ).toBeGreaterThan(1);
      // The line ends on the destination.
      const last = route[route.length - 1];
      expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(0.01);
      // ...and stays on the road the whole way. Segment midpoints are checked
      // as well as the points themselves: a route that teleported between two
      // legitimate on-road points would pass a points-only check, and the
      // simplifier's 0.35 m tolerance is what makes the midpoint meaningful.
      for (let step = 1; step < route.length; step += 1) {
        const previous = route[step - 1];
        const point = route[step];
        for (const probe of [
          point,
          { x: (previous.x + point.x) / 2, z: (previous.z + point.z) / 2 },
        ]) {
          const offRoad = distanceToNearestLane(probe);
          expect(
            offRoad,
            `route left the road by ${offRoad.toFixed(1)}m near ${probe.x.toFixed(0)},${probe.z.toFixed(0)}`,
          ).toBeLessThan(3.5);
        }
      }
    }
  });

  it("searches the whole 227-lane city well inside a frame", () => {
    const graph = gpsGraphForLanes(lanes);
    const addresses = streetAddressesForMap(pack);
    const pairs = addresses.filter((_, index) => index % 2 === 0).slice(0, 40);
    const started = performance.now();
    for (let index = 1; index < pairs.length; index += 1) {
      findGpsRoute(graph, pairs[index - 1], 0, pairs[index]);
    }
    const perSearch = (performance.now() - started) / (pairs.length - 1);
    // Budget, not a benchmark: this runs once per destination change, and a
    // frame is 16 ms. Anything approaching that means the search regressed.
    expect(perSearch).toBeLessThan(4);
  });
});
