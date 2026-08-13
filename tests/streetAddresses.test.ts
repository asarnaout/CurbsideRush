import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  generateGigFromPools,
  pickGigKind,
  selectGigPools,
} from "../app/game/gigs";
import { resolveSimulationLaneAnchor } from "../app/game/simulationAdapter";
import {
  addressableStreetNames,
  JUNCTION_CLEARANCE_M,
  MIN_OPPOSITE_KERB_M,
  MIN_SEPARATION_M,
  generateStreetAddresses,
  streetAddressesForMap,
  type StreetAddress,
  type StreetAddressInput,
} from "../app/game/streetAddresses";
import type { MapPack, WorldPoint } from "../app/game/types";

/**
 * Street addresses are the drop-off points gigs actually use, and nothing about
 * them is hand-authored — they are derived from the lane graph. That makes them
 * exactly the kind of thing that can silently rot: a block resized in content.ts
 * or a lane re-anchored could put a delivery in the middle of a junction, in
 * Central Park, or on the wrong side of the road, and no other test would
 * notice. The invariants below pin down "a drop-off is somewhere you could
 * genuinely pull over and hand a bag to someone".
 */

const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;

const poisOf = (pack: MapPack): WorldPoint[] =>
  [
    ...(pack.geometry.gigVenues ?? []),
    ...(pack.geometry.servicePoints ?? []),
  ].flatMap((poi) => {
    const pose = resolveSimulationLaneAnchor(pack.laneGraph.lanes, poi.anchor);
    return pose ? [{ x: pose.x, z: pose.z }] : [];
  });

const rawInput = (pack: MapPack): StreetAddressInput => ({
  mapId: pack.id,
  lanes: pack.laneGraph.lanes,
  blocks: pack.geometry.blocks,
  landmarks: pack.geometry.landmarks,
  roadSurfaces: pack.geometry.roadSurfaces,
  roadNames: pack.roadNames,
  occupiedPoints: poisOf(pack),
});

// Deliberately the same accessor the game uses, not a parallel construction —
// a gig refers to a stop by id, so the gig pool, the renderer (which stands
// riders and the beacon on these kerbs) and these tests must all be looking at
// byte-identical lists.
const nycAddresses = streetAddressesForMap(nyc);

const distance = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const laneLength = (points: readonly WorldPoint[]): number =>
  points
    .slice(1)
    .reduce((total, p, i) => total + distance(p, points[i]), 0);

const kerbOf = (address: StreetAddress): WorldPoint => ({
  x: address.kerbX,
  z: address.kerbZ,
});

describe("procedural street addresses", () => {
  it("covers every NYC street with a workable number of drop-offs", () => {
    // Four authored venues was the whole problem. Anything in this band spreads
    // gigs across the grid; far more would just be noise on the minimap. The
    // ceiling is stated per metre of addressable kerb rather than as a flat
    // count, so it keeps meaning the same thing as the map grows: candidates
    // are laid out every JUNCTION_CLEARANCE-trimmed 150 m, so a generator
    // producing one per 110 m has started stacking them.
    const addressableM = nyc.laneGraph.lanes
      .filter((lane) => lane.role === "travel" || lane.role === "one_way")
      .reduce((total, lane) => total + laneLength(lane.centerline), 0);
    expect(nycAddresses.length).toBeGreaterThanOrEqual(30);
    expect(nycAddresses.length).toBeLessThanOrEqual(Math.round(addressableM / 110));

    // Every street with a profile must actually produce addresses, and no
    // address may come from a street without one. A road whose `roadId` is
    // missing from STREET_PROFILES generates nothing at all, silently.
    const streets = new Set(
      nycAddresses.map((address) => address.name.replace(/^\d+\s/, "")),
    );
    expect(streets).toEqual(new Set(addressableStreetNames(nyc.roadNames)));
  });

  it("is deterministic, so a street keeps its addresses between runs", () => {
    expect(streetAddressesForMap(nyc)).toEqual(nycAddresses);
    // And a fresh derivation, bypassing the cache, agrees with it.
    expect(generateStreetAddresses(rawInput(nyc))).toEqual([...nycAddresses]);
  });

  it("`addressable: false` withdraws a block from frontage probing entirely (plan Section 9.1)", () => {
    // A gap-closure scenery block must be able to opt out of ever backing an
    // address -- otherwise an unrelated visual fix silently creates or
    // reorders a gig-pool job. Every real block flipped false is the
    // decisive proof the flag is actually consulted, not just accepted by
    // the type: if it were ignored, this would still equal nycAddresses.
    const allNonAddressable = generateStreetAddresses({
      ...rawInput(nyc),
      blocks: nyc.geometry.blocks.map((block) => ({ ...block, addressable: false })),
    });
    expect(allNonAddressable).toEqual([]);

    // Absent (the default, every real block today) behaves exactly as
    // before -- byte-identical, not merely "similar".
    const explicitlyDefault = generateStreetAddresses({
      ...rawInput(nyc),
      blocks: nyc.geometry.blocks.map((block) => ({ ...block, addressable: true })),
    });
    expect(explicitlyDefault).toEqual([...nycAddresses]);
  });

  it("gives every address a unique id and a unique display name", () => {
    expect(new Set(nycAddresses.map((a) => a.id)).size).toBe(nycAddresses.length);
    expect(new Set(nycAddresses.map((a) => a.name)).size).toBe(nycAddresses.length);
    for (const address of nycAddresses) {
      expect(address.name, address.id).toMatch(/^\d+ \S/);
    }
  });

  it("keeps drop-offs out of junctions", () => {
    for (const address of nycAddresses) {
      const lane = nyc.laneGraph.lanes.find((l) => l.id === address.laneId)!;
      const length = laneLength(lane.centerline);
      expect(address.distanceAlongM, address.name).toBeGreaterThanOrEqual(
        JUNCTION_CLEARANCE_M,
      );
      expect(length - address.distanceAlongM, address.name).toBeGreaterThanOrEqual(
        JUNCTION_CLEARANCE_M,
      );
    }
  });

  it("adds two genuine West End Ave addresses where the west-margin fix restored frontage (plan Section 11.2)", () => {
    // `nyc-block-west-margin--1080`/`--840` are ordinary, addressable
    // brownstone frontage — the same kind of content their pre-existing
    // `-1320`/`-600` siblings already are, not gap-closure scenery — so
    // Section 9.1 explicitly allows them to stay addressable after
    // reachability review. Named here so this is a recorded, intentional
    // gig-pool addition rather than an incidental one: "164 West End Ave"
    // and "248 West End Ave" are new; every other address on the street is
    // unchanged.
    const westEnd = nycAddresses.filter((a) => a.roadId === "nyc-west-end");
    expect(westEnd.map((a) => a.name)).toContain("164 West End Ave");
    expect(westEnd.map((a) => a.name)).toContain("248 West End Ave");
    for (const name of ["164 West End Ave", "248 West End Ave"]) {
      const address = westEnd.find((a) => a.name === name)!;
      expect(address.side, name).toBe(-1);
      expect(address.kind, name).toBe("residence");
      const lane = nyc.laneGraph.lanes.find((l) => l.id === address.laneId)!;
      expect(lane, name).toBeDefined();
    }
  });

  it("adds addresses on the newly-fronted 79th/86th/Fifth kerbs around the Fifth Avenue Gallery (plan Section 11.3)", () => {
    // `nyc-block-fifth-gallery-south`/`-north` are ordinary addressable
    // midrise frontage (Section 9.1) that now fronts three previously-bare
    // kerbs. These four are the ones a direct geometric check (position
    // inside/adjacent to the two new blocks) confirms are actually caused by
    // the new frontage, not the address generator's shared-RNG jitter
    // reshuffling an unrelated candidate elsewhere on the map (see
    // `generateStreetAddresses`'s own comment on that coupling) — the total
    // address count elsewhere is deliberately not pinned here for that
    // reason.
    const byName = (name: string) => nycAddresses.find((a) => a.name === name);
    for (const name of ["3 W 79th St", "50 E 86th St", "1017 Fifth Ave", "1113 Fifth Ave"]) {
      const address = byName(name);
      expect(address, name).toBeDefined();
      const lane = nyc.laneGraph.lanes.find((l) => l.id === address!.laneId)!;
      expect(lane, name).toBeDefined();
    }
  });

  it("spaces drop-offs along a kerb, and never stacks two anywhere", () => {
    for (let i = 0; i < nycAddresses.length; i += 1) {
      for (let j = i + 1; j < nycAddresses.length; j += 1) {
        const a = nycAddresses[i];
        const b = nycAddresses[j];
        const label = `${a.name} vs ${b.name}`;
        expect(distance(a, b), label).toBeGreaterThanOrEqual(MIN_OPPOSITE_KERB_M);
        if (a.roadId === b.roadId && a.side === b.side) {
          expect(distance(a, b), label).toBeGreaterThanOrEqual(MIN_SEPARATION_M);
        }
      }
    }
  });

  it("puts drop-offs mid-block rather than on the corners", () => {
    // The walk used to stride from the junction clearance, and NYC's
    // cross-street lanes are shorter than one stride — so every one of them
    // produced a single address pinned exactly on the corner.
    const onTheNose = nycAddresses.filter(
      (a) => Math.abs(a.distanceAlongM - JUNCTION_CLEARANCE_M) < 1,
    );
    expect(onTheNose.map((a) => a.name)).toEqual([]);
  });

  it("populates both kerbs of the two-way streets", () => {
    // Separation is measured at the lane point and opposing carriageways are
    // only ~3.4 m apart, so a single distance rule let whichever lane the walk
    // reached first claim the entire street.
    const twoWay = [
      "nyc-west-end",
      "nyc-broadway",
      "nyc-west-72",
      "nyc-west-79",
      "nyc-west-86",
    ];
    for (const roadId of twoWay) {
      const sides = new Set(
        nycAddresses.filter((a) => a.roadId === roadId).map((a) => a.side),
      );
      expect(sides, roadId).toEqual(new Set([-1, 1]));
    }
  });

  it("numbers houses the way Manhattan does", () => {
    for (const address of nycAddresses) {
      const number = Number(address.name.split(" ")[0]);
      // Even down the west side of an avenue and the south side of a cross
      // street — the negative side on both axes.
      const negativeSide = address.side === -1;
      expect(number % 2 === 0, `${address.name} (side ${address.side})`).toBe(
        negativeSide,
      );
    }
  });

  it("stands every kerb spot on a sidewalk, never on the carriageway", () => {
    for (const address of nycAddresses) {
      const kerb = kerbOf(address);
      for (const surface of nyc.geometry.roadSurfaces) {
        const clearance = distanceToPolyline(kerb, surface.centerline);
        expect(clearance, `${address.name} on ${surface.id}`).toBeGreaterThan(
          surface.widthM / 2,
        );
      }
    }
  });

  it("only puts addresses where a building actually fronts the street", () => {
    for (const address of nycAddresses) {
      const kerb = kerbOf(address);
      const fronts = nyc.geometry.blocks.some((block) =>
        // The kerb sits on the sidewalk just shy of the block, so allow the
        // frontage probe's reach rather than requiring a strict containment.
        Math.abs(kerb.x - block.center.x) <= block.size.x / 2 + 18 &&
        Math.abs(kerb.z - block.center.z) <= block.size.z / 2 + 18,
      );
      expect(fronts, `${address.name} fronts no block`).toBe(true);
    }
  });

  it("never drops a fare inside a park or the museum grounds", () => {
    for (const address of nycAddresses) {
      for (const landmark of nyc.geometry.landmarks) {
        const inside =
          Math.abs(address.kerbX - landmark.center.x) <= landmark.size.x / 2 &&
          Math.abs(address.kerbZ - landmark.center.z) <= landmark.size.z / 2;
        expect(inside, `${address.name} inside ${landmark.id}`).toBe(false);
      }
    }
  });

  it("leaves the Central Park side of Central Park West empty", () => {
    // CPW's northbound kerb faces east into the park. Nothing should front it.
    // Scoped to CPW's own addresses, not every address on the map: once the
    // east side exists, plenty of real addresses legitimately sit east of
    // the park (Fifth Avenue and beyond) without being anywhere near CPW.
    const park = nyc.geometry.landmarks.find((l) => l.id === "nyc-central-park")!;
    const parkWestEdge = park.center.x - park.size.x / 2;
    const cpwAddresses = nycAddresses.filter(
      (address) => address.roadId === "nyc-central-park-west",
    );
    expect(cpwAddresses.length).toBeGreaterThan(0);
    for (const address of cpwAddresses) {
      expect(address.kerbX, address.name).toBeLessThan(parkWestEdge);
    }
  });

  it("keeps clear of the authored venues and the gas station", () => {
    const pois = poisOf(nyc);
    expect(pois).toHaveLength(
      (nyc.geometry.gigVenues ?? []).length +
        (nyc.geometry.servicePoints ?? []).length,
    );
    for (const address of nycAddresses) {
      for (const poi of pois) {
        expect(distance(address, poi), address.name).toBeGreaterThan(20);
      }
    }
  });

  it("zones addresses from the block they face", () => {
    const kinds = new Set(nycAddresses.map((a) => a.kind));
    // The brownstone/house belts must yield homes and the Broadway/Amsterdam
    // core must yield workplaces, else "deliver to an office at 2am" reads odd.
    expect(kinds).toContain("residence");
    expect(kinds).toContain("office");
    const residences = nycAddresses.filter((a) => a.kind === "residence");
    expect(residences.length).toBeGreaterThan(nycAddresses.length / 3);
  });

  it("generates nothing for maps that have not opted in", () => {
    // Tokyo and Cairo are named but unprofiled, which is the whole point of
    // keeping `STREET_PROFILES` separate from `MapPack.roadNames`: naming a
    // street for turn-by-turn navigation must not start issuing gigs on it.
    // London opted in when it grew into a full city.
    const OPTED_IN = new Set(["nyc-upper-west-side", "london-south-kensington"]);
    for (const pack of MAP_PACKS.filter((p) => !OPTED_IN.has(p.id))) {
      expect(streetAddressesForMap(pack), pack.id).toEqual([]);
    }
  });

  it("gives London a spread of addresses on the kerb its traffic keeps to", () => {
    const london = MAP_PACKS.find((p) => p.id === "london-south-kensington")!;
    const addresses = streetAddressesForMap(london);
    // Enough to make a delivery land somewhere new each time, across enough
    // streets that they are not all on one arterial.
    expect(addresses.length).toBeGreaterThan(120);
    const streets = new Set(addresses.map((a) => a.name.replace(/^\d+\s/, "")));
    expect(streets.size).toBeGreaterThan(30);
    // Zoned off the facade material, since London has no building sets: the
    // City's glass yields offices and the terraces yield homes.
    const kinds = new Set(addresses.map((a) => a.kind));
    expect(kinds).toContain("residence");
    expect(kinds).toContain("office");
    expect(kinds).toContain("shop");
    // And every rider is standing on a pavement, not in the opposing
    // carriageway — the failure mode that gave London zero addresses on every
    // two-way road until the probe learned which kerb its traffic keeps to.
    // The address's own x/z is the lane point the car pulls up at; `kerbX`/
    // `kerbZ` is where the rider waits, and that is what must be off the
    // asphalt.
    for (const address of addresses) {
      const nearest = Math.min(
        ...london.geometry.roadSurfaces.map((surface) => {
          let best = Number.POSITIVE_INFINITY;
          for (let index = 1; index < surface.centerline.length; index += 1) {
            const a = surface.centerline[index - 1];
            const b = surface.centerline[index];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const lengthSquared = dx * dx + dz * dz;
            const t =
              lengthSquared > 0
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      ((address.kerbX - a.x) * dx + (address.kerbZ - a.z) * dz) /
                        lengthSquared,
                    ),
                  )
                : 0;
            best = Math.min(
              best,
              Math.hypot(
                address.kerbX - (a.x + dx * t),
                address.kerbZ - (a.z + dz * t),
              ) - surface.widthM / 2,
            );
          }
          return best;
        }),
      );
      expect(nearest, address.name).toBeGreaterThan(0);
    }
    // Both kerbs of the two-way streets get doors, which is the signal that
    // the nearside probe is genuinely reading the lane's own side rather than
    // one arbitrary normal.
    expect(new Set(addresses.map((address) => address.side))).toEqual(
      new Set([-1, 1]),
    );
  });

  /**
   * The point of all this. Four venues gave twelve possible ordered pairs on
   * the whole map, so every run felt like the same two errands. This is the
   * assertion that would fail if addresses ever stopped reaching the gig pool.
   */
  it("spreads real gigs across the map instead of the same few points", () => {
    const venues = (nyc.geometry.gigVenues ?? []).flatMap((venue) => {
      const pose = resolveSimulationLaneAnchor(nyc.laneGraph.lanes, venue.anchor);
      return pose
        ? [{ id: venue.id, name: venue.name, kind: venue.kind, x: pose.x, z: pose.z }]
        : [];
    });
    const addresses = nycAddresses.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      x: a.x,
      z: a.z,
    }));

    const dropoffs = new Set<string>();
    const pickups = new Set<string>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const kind = pickGigKind(seed);
      const pools = selectGigPools(venues, addresses, kind);
      const gig = generateGigFromPools(
        pools.pickups,
        pools.dropoffs,
        { base: 4, ratePerM: 0.012 },
        "USD",
        seed,
        kind,
      );
      if (!gig) continue;
      dropoffs.add(gig.dropoff.id);
      pickups.add(gig.pickup.id);
      // A delivery must never start at somebody's flat.
      if (kind === "delivery") {
        expect(["restaurant", "shop", "depot"], `seed ${seed}`).toContain(
          gig.pickup.kind,
        );
      }
    }
    expect(dropoffs.size).toBeGreaterThan(30);
    expect(pickups.size).toBeGreaterThan(10);
  });
});

function distanceToPolyline(
  point: WorldPoint,
  polyline: readonly WorldPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared < 1e-9
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          );
    best = Math.min(
      best,
      Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount)),
    );
  }
  return best;
}
