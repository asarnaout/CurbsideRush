import { describe, expect, it } from "vitest";
import {
  buildGpsGraph,
  findGpsRoute,
  gpsGraphForLanes,
  projectOntoPolyline,
  routeProgress,
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

/** The drawn line alone. Most cases below are about where the line goes; the
 * legs and manoeuvres behind it get their own describe block. */
const routePoints = (
  ...args: Parameters<typeof findGpsRoute>
): readonly GpsPoint[] => findGpsRoute(...args).points;

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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const route = routePoints(
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
    const first = routePoints(graph, { x: 50, z: 0 }, HEADING_EAST, { x: 200, z: 100 });
    const second = routePoints(graph, { x: 50, z: 0 }, HEADING_EAST, { x: 200, z: 100 });
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
    const route = { points: line, legs: [], manoeuvres: [] };
    expect(routeProgress(route, 50, 8).deviationM).toBeCloseTo(8, 6);
    expect(
      routeProgress({ points: [], legs: [], manoeuvres: [] }, 0, 0).deviationM,
    ).toBe(Number.POSITIVE_INFINITY);
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
      const route = routePoints(graph, from, heading, to);
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
      routePoints(graph, pairs[index - 1], 0, pairs[index]);
    }
    const perSearch = (performance.now() - started) / (pairs.length - 1);
    // Budget, not a benchmark: this runs once per destination change, and a
    // frame is 16 ms. Anything approaching that means the search regressed.
    expect(perSearch).toBeLessThan(4);
  });
});

/**
 * Legs and manoeuvres. These are what a turn-by-turn HUD reads, and the whole
 * job is collapsing the lane graph's per-block detail into instructions a
 * driver would actually say out loud.
 */
describe("gps route legs and manoeuvres", () => {
  /** An avenue split into per-block lanes, the way buildNycGrid emits them. */
  const blocks = (
    roadId: string,
    from: GpsPoint,
    step: GpsPoint,
    count: number,
    successors: (index: number) => readonly string[],
  ): GpsLane[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `${roadId}-${index}`,
      roadId,
      centerline: [
        { x: from.x + step.x * index, z: from.z + step.z * index },
        { x: from.x + step.x * (index + 1), z: from.z + step.z * (index + 1) },
      ],
      successors: successors(index),
    }));

  it("collapses a street's per-block lanes into one leg", () => {
    // Eight blocks up one avenue is one instruction, not eight.
    const avenue = blocks("ave", { x: 0, z: 0 }, { x: 0, z: 100 }, 8, (index) =>
      index < 7 ? [`ave-${index + 1}`] : [],
    );
    const route = findGpsRoute(
      buildGpsGraph(avenue),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: 0, z: 780 },
    );
    expect(route.points.length).toBeGreaterThan(1);
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].roadId).toBe("ave");
    // Only the arrival is announced — no "continue straight" every block.
    expect(route.manoeuvres.map((m) => m.kind)).toEqual(["arrive"]);
  });

  it("classifies a right turn onto the street being joined", () => {
    const corner: readonly GpsLane[] = [
      { id: "ave-0", roadId: "ave", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["cross-0"] },
      { id: "cross-0", roadId: "cross", centerline: [{ x: 0, z: 200 }, { x: 200, z: 200 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(corner),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: 190, z: 200 },
    );
    expect(route.legs.map((leg) => leg.roadId)).toEqual(["ave", "cross"]);
    const turn = route.manoeuvres[0];
    // Driving north then turning to run east is a right turn onto "cross".
    expect(turn.kind).toBe("right");
    expect(turn.ontoRoadId).toBe("cross");
    expect(turn.turnRad).toBeCloseTo(Math.PI / 2, 3);
    expect(turn.point.x).toBeCloseTo(0, 3);
    expect(turn.point.z).toBeCloseTo(200, 3);
    expect(route.manoeuvres.at(-1)?.kind).toBe("arrive");
  });

  it("classifies a left turn as the mirror of a right one", () => {
    const corner: readonly GpsLane[] = [
      { id: "ave-0", roadId: "ave", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["cross-0"] },
      { id: "cross-0", roadId: "cross", centerline: [{ x: 0, z: 200 }, { x: -200, z: 200 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(corner),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: -190, z: 200 },
    );
    expect(route.manoeuvres[0].kind).toBe("left");
    expect(route.manoeuvres[0].turnRad).toBeCloseTo(-Math.PI / 2, 3);
  });

  it("does not call a gentle kink a turn", () => {
    // Two lanes of one street meeting at 10 degrees is a bend, not an
    // instruction — and they share a road id anyway, so it is one leg.
    const bend: readonly GpsLane[] = [
      { id: "a", roadId: "road", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["b"] },
      { id: "b", roadId: "road", centerline: [{ x: 0, z: 200 }, { x: 35, z: 400 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(bend),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: 34, z: 395 },
    );
    expect(route.legs).toHaveLength(1);
    expect(route.manoeuvres.map((m) => m.kind)).toEqual(["arrive"]);
  });

  it("collapses a roundabout into one manoeuvre", () => {
    // Its lanes all carry one road id — as MK's uk-roundabout really does — so
    // merging by road turns four 90-degree hops into a single instruction
    // rather than "turn right" four times.
    const island: readonly GpsLane[] = [
      { id: "in", roadId: "approach", centerline: [{ x: -100, z: 0 }, { x: -20, z: 0 }], successors: ["rb-n"] },
      { id: "rb-n", roadId: "circle", centerline: [{ x: -20, z: 0 }, { x: 0, z: 20 }], successors: ["rb-e"] },
      { id: "rb-e", roadId: "circle", centerline: [{ x: 0, z: 20 }, { x: 20, z: 0 }], successors: ["rb-s"] },
      { id: "rb-s", roadId: "circle", centerline: [{ x: 20, z: 0 }, { x: 0, z: -20 }], successors: ["out"] },
      { id: "out", roadId: "exit", centerline: [{ x: 0, z: -20 }, { x: 0, z: -120 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(island),
      { x: -90, z: 0 },
      HEADING_EAST,
      { x: 0, z: -110 },
    );
    expect(route.legs.map((leg) => leg.roadId)).toEqual([
      "approach",
      "circle",
      "exit",
    ]);
    expect(route.manoeuvres).toHaveLength(3);
    expect(route.manoeuvres.at(-1)?.kind).toBe("arrive");
  });

  it("measures legs on real geometry, not the simplified line", () => {
    // simplify() drops collinear points, so legs must not be derivable from
    // the drawn points — this pins that they are measured independently.
    const avenue = blocks("ave", { x: 0, z: 0 }, { x: 0, z: 100 }, 6, (index) =>
      index < 5 ? [`ave-${index + 1}`] : [],
    );
    const route = findGpsRoute(
      buildGpsGraph(avenue),
      { x: 0, z: 0 },
      HEADING_NORTH,
      { x: 0, z: 600 },
    );
    // A 600 m straight collapses to two drawn points but still measures 600 m.
    expect(route.points).toHaveLength(2);
    expect(route.legs[0].lengthM).toBeCloseTo(600, 3);
    expect(route.legs[0].alongM).toBe(0);
  });

  it("counts down to the next manoeuvre and hands over once it is passed", () => {
    const corner: readonly GpsLane[] = [
      { id: "ave-0", roadId: "ave", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["cross-0"] },
      { id: "cross-0", roadId: "cross", centerline: [{ x: 0, z: 200 }, { x: 200, z: 200 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(corner),
      { x: 0, z: 0 },
      HEADING_NORTH,
      { x: 200, z: 200 },
    );
    // Well short of the corner: the turn is next, 150 m out.
    const early = routeProgress(route, 0, 50);
    expect(early.next?.kind).toBe("right");
    expect(early.distanceToNextM).toBeCloseTo(150, 0);
    expect(early.remainingM).toBeCloseTo(350, 0);
    expect(early.deviationM).toBeCloseTo(0, 6);
    // Round the corner and onto the new street: the arrival takes over.
    const late = routeProgress(route, 100, 200);
    expect(late.next?.kind).toBe("arrive");
    expect(late.distanceToNextM).toBeCloseTo(100, 0);
  });

  it("keeps the turn as next while the car is still swinging through it", () => {
    // Without slack the banner flips to the following instruction mid-corner.
    const corner: readonly GpsLane[] = [
      { id: "ave-0", roadId: "ave", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["cross-0"] },
      { id: "cross-0", roadId: "cross", centerline: [{ x: 0, z: 200 }, { x: 200, z: 200 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(corner),
      { x: 0, z: 0 },
      HEADING_NORTH,
      { x: 200, z: 200 },
    );
    expect(routeProgress(route, 4, 200).next?.kind).toBe("right");
  });
});

describe("gps legs merge on the street, not the surface", () => {
  // Outside NYC a street is often several road surfaces: London models Cromwell
  // Road as three. Merging on road id alone announced a turn onto the road the
  // driver was already on — "left onto Cromwell Road, straight onto Cromwell
  // Road" — so the merge key is the display name wherever there is one.
  const split: readonly GpsLane[] = [
    { id: "a", roadId: "side", centerline: [{ x: -100, z: 0 }, { x: 0, z: 0 }], successors: ["b"] },
    { id: "b", roadId: "main-west", centerline: [{ x: 0, z: 0 }, { x: 0, z: 150 }], successors: ["c"] },
    { id: "c", roadId: "main-east", centerline: [{ x: 0, z: 150 }, { x: 0, z: 320 }], successors: [] },
  ];

  it("keeps two surfaces of one street as a single leg", () => {
    const named = buildGpsGraph(split, {
      side: "Side Street",
      "main-west": "Main Road",
      "main-east": "Main Road",
    });
    const route = findGpsRoute(named, { x: -90, z: 0 }, HEADING_EAST, { x: 0, z: 310 });
    expect(route.legs).toHaveLength(2);
    // Running east then turning to head north is a left under atan2(dx, dz).
    expect(route.manoeuvres.map((m) => m.kind)).toEqual(["left", "arrive"]);
    expect(route.manoeuvres[0].ontoRoadId).toBe("main-west");
  });

  it("falls back to road ids when the city has no names", () => {
    // Milton Keynes and Calais ship unnamed, and must still produce legs.
    const unnamed = buildGpsGraph(split);
    const route = findGpsRoute(unnamed, { x: -90, z: 0 }, HEADING_EAST, { x: 0, z: 310 });
    expect(route.legs.map((leg) => leg.roadId)).toEqual([
      "side",
      "main-west",
      "main-east",
    ]);
  });
});

describe("gps leg bearings are read per end, not across the whole leg", () => {
  /** A loop road, as London's quiet loop and Gloucester loop are: its lanes
   * share one road id, so they merge into a single leg whose first and last
   * points are nearly the same place. */
  const withLoop: readonly GpsLane[] = [
    { id: "in", roadId: "street", centerline: [{ x: -200, z: 0 }, { x: 0, z: 0 }], successors: ["loop-a"] },
    { id: "loop-a", roadId: "loop", centerline: [{ x: 0, z: 0 }, { x: 60, z: 30 }], successors: ["loop-b"] },
    { id: "loop-b", roadId: "loop", centerline: [{ x: 60, z: 30 }, { x: 60, z: -30 }], successors: ["loop-c"] },
    { id: "loop-c", roadId: "loop", centerline: [{ x: 60, z: -30 }, { x: 6, z: -4 }], successors: [] },
  ];

  it("does not call joining a loop road a u-turn", () => {
    // The bug this pins: a chord across the merged loop points back the way it
    // came, so every route onto London's two loops classified as a u-turn —
    // 31% of all its routes. Bearings read near each end fix it because the
    // entry bearing describes the loop's start, not its round trip.
    const route = findGpsRoute(
      buildGpsGraph(withLoop),
      { x: -190, z: 0 },
      HEADING_EAST,
      { x: 8, z: -5 },
    );
    expect(route.legs.map((leg) => leg.roadId)).toEqual(["street", "loop"]);
    expect(route.manoeuvres[0].kind).not.toBe("uturn");
    // Entering east and leaving the loop heading west: the two ends really do
    // differ, which is exactly what one chord could not express.
    const loop = route.legs[1];
    expect(Math.abs(signedTurn(loop.entryHeadingRad, loop.exitHeadingRad)))
      .toBeGreaterThan(Math.PI / 2);
  });

  it("still calls a genuine reversal a u-turn", () => {
    // The classifier must not have been flattened into never saying it.
    const doublesBack: readonly GpsLane[] = [
      { id: "a", roadId: "a", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["b"] },
      { id: "b", roadId: "b", centerline: [{ x: 0, z: 200 }, { x: 35, z: 0 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(doublesBack),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: 34, z: 10 },
    );
    expect(route.manoeuvres[0].kind).toBe("uturn");
  });

  it("reads a hairpin through a link road as two turns, not a reversal", () => {
    const hairpin: readonly GpsLane[] = [
      { id: "in", roadId: "in", centerline: [{ x: 0, z: 0 }, { x: 0, z: 200 }], successors: ["turn"] },
      { id: "turn", roadId: "turn", centerline: [{ x: 0, z: 200 }, { x: 6, z: 206 }, { x: 12, z: 200 }], successors: ["back"] },
      { id: "back", roadId: "back", centerline: [{ x: 12, z: 200 }, { x: 12, z: 0 }], successors: [] },
    ];
    const route = findGpsRoute(
      buildGpsGraph(hairpin),
      { x: 0, z: 10 },
      HEADING_NORTH,
      { x: 12, z: 10 },
    );
    expect(route.manoeuvres.map((m) => m.kind)).toEqual([
      "right",
      "right",
      "arrive",
    ]);
  });

  it("keeps the graph cache honest about the names it was built with", () => {
    // Names decide how legs merge, so a nameless call must not hand the next
    // caller a graph that splits one street into several.
    const lanes: readonly GpsLane[] = [
      { id: "a", roadId: "main-west", centerline: [{ x: 0, z: 0 }, { x: 0, z: 100 }], successors: ["b"] },
      { id: "b", roadId: "main-east", centerline: [{ x: 0, z: 100 }, { x: 0, z: 200 }], successors: [] },
    ];
    const names = { "main-west": "Main Road", "main-east": "Main Road" };
    const bare = gpsGraphForLanes(lanes);
    const named = gpsGraphForLanes(lanes, names);
    expect(bare).not.toBe(named);
    expect(named.streetKeys).toEqual(["Main Road", "Main Road"]);
    expect(bare.streetKeys).toEqual(["main-west", "main-east"]);
    // And each is still cached in its own right.
    expect(gpsGraphForLanes(lanes, names)).toBe(named);
    expect(gpsGraphForLanes(lanes)).toBe(bare);
  });
});

/** Local mirror of the module's private helper, so the loop assertion above can
 * talk about the angle between a leg's own two ends. */
function signedTurn(from: number, to: number): number {
  let wrapped = (to - from) % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}
