/**
 * Where a map's gigs can start and end.
 *
 * `gigs.ts` deliberately knows nothing about maps — it takes the places each
 * end may use and only decides which the seed lands on. This is the piece that
 * turns a map pack into those places: authored venues resolved from their lane
 * anchors, plus the generated street addresses.
 *
 * It lives in its own module because three callers have to agree exactly, and
 * for a while they didn't: `SideSwapApp` offers the gigs, and
 * `careerBalance.test.ts` prices every possible pairing to check the ladder is
 * beatable. When each carried its own copy, the tripwire could quietly go on
 * measuring a game the player was no longer playing.
 */

import { resolveSimulationLaneAnchor } from "./simulationAdapter";
import { streetAddressesForMap } from "./streetAddresses";
import type { GigVenuePosition } from "./gigs";
import type { MapPack } from "./types";

/** The map's authored venues, in gig-pool shape. Anchors that fail to resolve
 * are dropped rather than placed at the origin. */
export function resolveGigVenues(map: MapPack): GigVenuePosition[] {
  return (map.geometry.gigVenues ?? []).flatMap((venue) => {
    const pose = resolveSimulationLaneAnchor(map.laneGraph.lanes, venue.anchor);
    return pose
      ? [
          {
            id: venue.id,
            name: venue.name,
            kind: venue.kind,
            x: pose.x,
            z: pose.z,
          },
        ]
      : [];
  });
}

/**
 * The map's generated street addresses, in gig-pool shape.
 *
 * `x`/`z` is the lane-centreline point a gig arrives at, not the kerb the rider
 * stands on — the arrival check measures against the road.
 */
export function resolveGigAddresses(map: MapPack): GigVenuePosition[] {
  return streetAddressesForMap(map).map((address) => ({
    id: address.id,
    name: address.name,
    kind: address.kind,
    x: address.x,
    z: address.z,
  }));
}
