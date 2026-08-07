import { describe, expect, it } from "vitest";
import { MAP_PACKS, getCountryProfile } from "../app/game/content";
import type { LaneSegment, MapPack, RoadSurface } from "../app/game/types";

/**
 * Invariants for "would a real driver read this road the way we mean it?".
 *
 * These are content rules, not rendering rules — they hold on the authored
 * data, so they catch a mis-painted street the moment it lands rather than
 * three months later in a screenshot. Issue #5 was exactly that: West 72nd,
 * 79th and 86th are two-way, but a white centre line means "same direction"
 * in the US, so all three read as one-way avenues — indistinguishable from
 * Amsterdam and Columbus, which genuinely are one-way.
 */

const CENTRE_STYLES = new Set(["centre_solid", "centre_dashed"]);
/** Divider and edge paint is white in every country we ship. */
const WHITE_STYLES = new Set(["lane_solid", "lane_dashed", "edge_solid"]);

const directionsOf = (lanes: readonly LaneSegment[]): Set<string> => {
  const directions = new Set<string>();
  for (const lane of lanes) {
    const from = lane.centerline[0];
    const to = lane.centerline[lane.centerline.length - 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    directions.add(
      Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? "E" : "W") : dz >= 0 ? "N" : "S",
    );
  }
  return directions;
};

const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;

/** heading 0 = +z, increasing clockwise, so a positive delta is a right turn. */
const headingOf = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.atan2(to.x - from.x, to.z - from.z);
const signedTurn = (before: number, after: number): number => {
  let delta = after - before;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const surfacesOf = (
  pack: MapPack,
): { surface: RoadSurface; lanes: LaneSegment[]; twoWay: boolean }[] => {
  const byId = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  return (pack.geometry.roadSurfaces ?? []).map((surface) => {
    const lanes = surface.laneIds.flatMap((id) => {
      const lane = byId.get(id);
      return lane ? [lane] : [];
    });
    return { surface, lanes, twoWay: directionsOf(lanes).size > 1 };
  });
};

describe("road markings read the way a local driver expects", () => {
  it("paints every centre line in the host country's colour", () => {
    // The one that matters: North America reserves white for lanes running the
    // same way, so a white centre line there says "one-way street".
    for (const pack of MAP_PACKS) {
      const country = getCountryProfile(pack.countryIds[0]);
      for (const { surface } of surfacesOf(pack)) {
        for (const marking of surface.markings) {
          if (!CENTRE_STYLES.has(marking.style)) continue;
          expect(
            marking.color ?? "white",
            `${pack.id}/${surface.id}/${marking.id} separates opposing traffic in ${country.countryName}`,
          ).toBe(country.centreLineColor);
        }
      }
    }
  });

  it("keeps lane dividers and edge lines white everywhere", () => {
    for (const pack of MAP_PACKS) {
      for (const { surface } of surfacesOf(pack)) {
        for (const marking of surface.markings) {
          if (!WHITE_STYLES.has(marking.style)) continue;
          expect(
            marking.color ?? "white",
            `${pack.id}/${surface.id}/${marking.id}`,
          ).toBe("white");
        }
      }
    }
  });

  it("never paints a centre line down a one-way road", () => {
    // A centre line promises oncoming traffic. On a one-way street it would
    // have the driver hugging one half of a carriageway that is all theirs.
    for (const pack of MAP_PACKS) {
      for (const { surface, lanes, twoWay } of surfacesOf(pack)) {
        if (twoWay || !lanes.length) continue;
        const centre = surface.markings.filter((m) => CENTRE_STYLES.has(m.style));
        expect(
          centre.map((m) => m.id),
          `${pack.id}/${surface.id} is one-way`,
        ).toEqual([]);
      }
    }
  });

  it("gives every marked two-way road a centre line", () => {
    // An unmarked lane is fine — plenty of real streets have no paint at all.
    // What is not fine is a two-way road marked *only* with lane dividers:
    // that is the paint scheme of a one-way multi-lane road.
    for (const pack of MAP_PACKS) {
      for (const { surface, twoWay } of surfacesOf(pack)) {
        if (!twoWay || !surface.markings.length) continue;
        const hasCentre = surface.markings.some((m) => CENTRE_STYLES.has(m.style));
        expect(hasCentre, `${pack.id}/${surface.id} is two-way but has no centre line`).toBe(
          true,
        );
      }
    }
  });

  it("gives NYC a paint scheme that tells its one-ways from its two-ways", () => {
    // The regression guard for issue #5, spelled out on the map that had it.
    // Driven off the pack rather than a road-id list: the point is that every
    // NYC carriageway is painted for what it is, including ones added later.
    let twoWayChecked = 0;
    let multiLaneOneWayChecked = 0;
    for (const { surface, lanes, twoWay } of surfacesOf(nyc)) {
      if (!lanes.length) continue;
      const paint = surface.markings.map((m) => `${m.style}/${m.color}`);
      if (twoWay) {
        expect(paint, surface.id).toEqual(["centre_solid/yellow"]);
        twoWayChecked += 1;
        continue;
      }
      // A one-way carriageway wide enough for two lanes divides them in white.
      // A single-lane side street has nothing to divide and stays unpainted —
      // a centre line on one would read as two-way, which is the whole bug.
      // Counted per block, not per road: a one-way street crossing five
      // avenues carries five lanes end to end and still has one to drive in.
      const perBlock = new Map<string, number>();
      for (const lane of lanes) {
        const key = `${lane.from}->${lane.to}`;
        perBlock.set(key, (perBlock.get(key) ?? 0) + 1);
      }
      if (Math.max(...perBlock.values()) > 1) {
        expect(paint, surface.id).toEqual(["lane_dashed/white"]);
        multiLaneOneWayChecked += 1;
      } else {
        expect(paint, surface.id).toEqual([]);
      }
    }
    expect(twoWayChecked, "two-way NYC roads").toBeGreaterThanOrEqual(6);
    expect(multiLaneOneWayChecked, "multi-lane one-way NYC roads").toBeGreaterThanOrEqual(2);
  });
});

/**
 * A road posts one limit, chosen from what the road is. The number lives once
 * per road — on `NycRoadSpec` for the generated grid, in a per-city table for
 * the rest — and the lane builders stamp it onto that road's lanes, so these
 * are the invariants that catch the table and the asphalt disagreeing.
 */
describe("speed limits read the way a local driver expects", () => {
  /** What each country's signs actually say. A figure outside its own list is
   * a typo, not a design choice: no country posts 33 mph or 45 km/h. */
  const POSTED_FIGURES: Readonly<Record<string, readonly number[]>> = {
    mph: [20, 25, 30, 40, 50, 60, 70],
    kmh: [20, 30, 40, 50, 60, 70, 80],
  };

  const limitsOf = (pack: MapPack): Map<string, number> => {
    const byRoad = new Map<string, number>();
    for (const lane of pack.laneGraph.lanes) byRoad.set(lane.roadId, lane.speedLimit);
    return byRoad;
  };

  it("posts a limit on every road, including ones no lane happens to mention", () => {
    // Totality over *surfaces*. `streetNames.test.ts` walks lane roadIds, so a
    // surface carrying no lanes slips through it — this is the check that a
    // road cannot exist unposted.
    for (const pack of MAP_PACKS) {
      const posted = limitsOf(pack);
      for (const { surface } of surfacesOf(pack)) {
        const limit = posted.get(surface.id);
        expect(limit, `${pack.id}/${surface.id} has no posted limit`).toBeGreaterThan(0);
      }
    }
  });

  it("never lets a street disagree with itself", () => {
    // The reason neither `lane` nor `laneTrue` takes a limit any more: authored
    // per lane, one block of a street quietly ends up posted differently from
    // the next and nothing anywhere says so.
    for (const pack of MAP_PACKS) {
      for (const { surface, lanes } of surfacesOf(pack)) {
        const distinct = [...new Set(lanes.map((lane) => lane.speedLimit))];
        expect(distinct, `${pack.id}/${surface.id}`).toHaveLength(
          lanes.length ? 1 : 0,
        );
      }
    }
  });

  it("posts only figures the host country actually signs", () => {
    for (const pack of MAP_PACKS) {
      const country = getCountryProfile(pack.countryIds[0]);
      const allowed = POSTED_FIGURES[country.speedUnit];
      for (const [roadId, limit] of limitsOf(pack)) {
        expect(
          allowed,
          `${pack.id}/${roadId} posts ${limit} ${country.speedUnit}`,
        ).toContain(limit);
      }
    }
  });

  it("never posts a roundabout or a shared space above an ordinary road", () => {
    // Both are places you slow for — a ring with traffic joining it, or 5.8 m of
    // carriageway with pedestrians on it — so neither may out-rank any ordinary
    // road on its own map. Stated as \"not above\" rather than \"below\" because a
    // uniform map is legitimate: every road in Kensington and Chelsea is 20.
    for (const pack of MAP_PACKS) {
      const posted = limitsOf(pack);
      const ordinary = surfacesOf(pack)
        .filter(({ surface }) => surface.surfaceType === "standard")
        .flatMap(({ surface }) => posted.get(surface.id) ?? []);
      if (!ordinary.length) continue;
      const slowestOrdinary = Math.min(...ordinary);
      for (const { surface } of surfacesOf(pack)) {
        if (surface.surfaceType === "standard") continue;
        const limit = posted.get(surface.id);
        if (limit === undefined) continue;
        expect(
          limit,
          `${pack.id}/${surface.id} is a ${surface.surfaceType} posted above an ordinary road`,
        ).toBeLessThanOrEqual(slowestOrdinary);
      }
    }
  });

  it("posts NYC's unpainted side streets below the streets that carry the traffic", () => {
    // A 9 m single-lane one-way with no paint on it at all is the residential
    // back street; the avenues and the wide two-way crosstown routes are what
    // the neighbourhood drives through. The rule is stated off the paint rather
    // than a road-id list so it holds for streets added later.
    const posted = limitsOf(nyc);
    const bare: number[] = [];
    const painted: number[] = [];
    for (const { surface, lanes } of surfacesOf(nyc)) {
      if (!lanes.length) continue;
      (surface.markings.length ? painted : bare).push(posted.get(surface.id)!);
    }
    expect(bare.length).toBeGreaterThanOrEqual(6);
    expect(painted.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...bare)).toBeLessThan(Math.max(...painted));
  });
});

describe("NYC junctions connect the way the asphalt suggests", () => {
  const lanes = nyc.laneGraph.lanes;
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const predecessors = new Map<string, string[]>();
  for (const lane of lanes) {
    for (const successor of lane.successors) {
      predecessors.set(successor, [
        ...(predecessors.get(successor) ?? []),
        lane.id,
      ]);
    }
  }

  it("never leaves a driver at a junction with nowhere legal to go", () => {
    // Thirteen of forty-four lanes used to end here — the whole east side of
    // 72nd and 86th, both ends of Central Park West, and the outer lanes of
    // Amsterdam and Columbus.
    const stranded = lanes.filter((lane) => lane.successors.length === 0);
    expect(stranded.map((lane) => lane.id)).toEqual([]);
  });

  it("leaves no lane that no route can enter", () => {
    const orphans = lanes.filter((lane) => !predecessors.has(lane.id));
    expect(orphans.map((lane) => lane.id)).toEqual([]);
  });

  it("lets a driver get from any lane to any other", () => {
    // Strong connectivity is what a grid promises. It is also what the gig
    // pool assumes now that drop-offs are scattered over every street.
    const reach = (from: string, edges: Map<string, string[]>): Set<string> => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        for (const next of edges.get(queue.shift()!) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return seen;
    };
    const forward = new Map(lanes.map((lane) => [lane.id, [...lane.successors]]));
    const backward = new Map(
      lanes.map((lane) => [lane.id, predecessors.get(lane.id) ?? []]),
    );
    const root = lanes[0].id;
    expect(reach(root, forward).size, `reachable from ${root}`).toBe(lanes.length);
    expect(reach(root, backward).size, `can reach ${root}`).toBe(lanes.length);
  });

  it("turns out of a one-way avenue from the lane you would really use", () => {
    // Two lanes running the same way is only realistic if the kerbside one
    // takes the right turns and the one against the centreline takes the
    // lefts. It is also what feeds traffic into both of them.
    let pairsChecked = 0;
    for (const { surface, lanes: roadLanes, twoWay } of surfacesOf(nyc)) {
      if (twoWay || roadLanes.length < 2) continue;
      const roadId = surface.id;
      const groups = new Map<string, LaneSegment[]>();
      for (const lane of roadLanes) {
        const key = `${lane.from}->${lane.to}`;
        groups.set(key, [...(groups.get(key) ?? []), lane]);
      }
      for (const [key, pair] of groups) {
        // A single-lane block of a one-way street has no inner/kerbside choice
        // to get wrong; only paired blocks carry this contract.
        if (pair.length === 1) continue;
        expect(pair.length, `${roadId} ${key}`).toBe(2);
        pairsChecked += 1;
        const heading = headingOf(pair[0].centerline[0], pair[0].centerline.at(-1)!);
        // The kerb is off the right-hand normal (cos h, -sin h), so of the two
        // the lane further along it is the outside one. Measured at the second
        // point, which is where each lane has settled onto its own offset.
        const offset = (lane: LaneSegment) =>
          lane.centerline[1].x * Math.cos(heading) -
          lane.centerline[1].z * Math.sin(heading);
        const [inner, kerbside] = [...pair].sort((a, b) => offset(a) - offset(b));
        // End to end, not segment to segment: a lane's last half-metre is the
        // taper into the junction node and points nothing like the road does.
        const turnsOff = (lane: LaneSegment) =>
          lane.successors
            .map((id) => byId.get(id)!)
            .filter((next) => next.roadId !== lane.roadId)
            .map((next) =>
              signedTurn(
                headingOf(lane.centerline[0], lane.centerline.at(-1)!),
                headingOf(next.centerline[0], next.centerline.at(-1)!),
              ) > 0
                ? "right"
                : "left",
            );
        const available = new Set([...turnsOff(inner), ...turnsOff(kerbside)]);
        // The rule is about *choosing* between turns. Where the crossing street
        // is one-way, the junction offers only one, and both lanes take it or
        // neither does — insisting the inner lane turn left into a street that
        // only runs east would be worse driving, not better.
        if (available.size < 2) continue;
        for (const [lane, expected] of [
          [inner, "left"],
          [kerbside, "right"],
        ] as const) {
          const turns = turnsOff(lane);
          expect(turns.length, `${lane.id} turns off ${roadId}`).toBeGreaterThan(0);
          expect(
            turns[0],
            `${lane.id} should turn ${expected} out of ${roadId}`,
          ).toBe(expected);
        }
      }
    }
    expect(pairsChecked, "paired one-way blocks").toBeGreaterThanOrEqual(4);
  });
});

describe("ambient traffic circulates instead of blinking out", () => {
  // A car whose route ends is deactivated and respawned at its spawn point
  // 2.5 s later (GameCanvas `updateNpcVehicles`). Before the junctions were
  // wired up, every NYC route ended, so all the traffic did this. Cars start
  // on an authored spawn lane or, past the fifth, on an arbitrary lane — and
  // the branch offset is the car's index — so the property has to hold for
  // every lane and every offset, not just the spawn points.
  // London's bus lane was the last exception here, allowed to dead-end because
  // nothing turns into it. It still had a bus driving down it, and that bus
  // blinked out at the Exhibition Road signal every cycle (#128) — a lane with
  // traffic on it has to lead somewhere whether or not anything turns in.
  //
  // This walks `successors` directly on the authored lane graph rather than
  // through a router (the render-layer traffic system that owned this walk,
  // `npcPaths.ts`, was retired in #293 — live traffic is SimulationCore's).
  // A walk that never runs out of successors must revisit a lane within
  // `lanes.length` hops (there are only that many distinct ids to visit), so
  // "reaches a cycle" and "never hits a dead end" are the same property here.
  const BRANCH_OFFSETS = 160;

  const walkReachesCycle = (
    lanesById: Map<string, LaneSegment>,
    startLaneId: string,
    branchOffset: number,
    maxHops: number,
  ): boolean => {
    const visited = new Set<string>();
    let laneId = startLaneId;
    for (let hop = 0; hop < maxHops; hop += 1) {
      if (visited.has(laneId)) return true;
      visited.add(laneId);
      const lane = lanesById.get(laneId);
      if (!lane || lane.successors.length === 0) return false;
      laneId = lane.successors[(branchOffset + hop) % lane.successors.length];
    }
    return false;
  };

  for (const pack of MAP_PACKS) {
    it(`keeps every route in ${pack.id} on a circuit`, () => {
      const lanes = pack.laneGraph.lanes;
      const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
      const maxHops = lanes.length + 5;
      const stranded = new Set<string>();
      for (const lane of lanes) {
        for (let offset = 0; offset < BRANCH_OFFSETS; offset += 1) {
          if (!walkReachesCycle(lanesById, lane.id, offset, maxHops)) {
            stranded.add(`${lane.id}@${offset}`);
          }
        }
      }
      expect([...stranded].sort()).toEqual([]);
    });
  }
});

describe("NYC controls the junctions a driver expects to be controlled", () => {
  it("puts a signal on every crossing that has traffic on both phases", () => {
    // Manhattan signalises its avenue crossings. The rule is stated in terms of
    // *arriving* roads, which already excuses the tail end of a one-way avenue:
    // nothing arrives from the avenue there, so the node only ever sees the
    // cross street and a second phase would hold it at red for no one.
    let controlledNodes = 0;
    const inbound = new Map<string, LaneSegment[]>();
    for (const lane of nyc.laneGraph.lanes) {
      inbound.set(lane.to, [...(inbound.get(lane.to) ?? []), lane]);
    }
    const signalled = new Set(
      nyc.laneGraph.controls
        .filter((control) => control.type === "signal")
        .flatMap((control) => control.laneIds),
    );
    for (const node of nyc.laneGraph.nodes) {
      const arrivals = inbound.get(node.id) ?? [];
      const roads = new Set(arrivals.map((lane) => lane.roadId));
      if (roads.size < 2) continue;
      controlledNodes += 1;
      for (const lane of arrivals) {
        expect(
          signalled.has(lane.id),
          `${lane.id} arrives at ${node.id} unsignalled`,
        ).toBe(true);
      }
    }
    expect(controlledNodes, "NYC crossings with two arriving roads").toBeGreaterThanOrEqual(11);
  });
});
