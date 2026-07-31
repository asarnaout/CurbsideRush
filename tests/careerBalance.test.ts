import { describe, expect, it } from "vitest";
import {
  activeCity,
  buyoutPrice,
  CAREER_CITIES,
  CAREER_VEHICLES,
  careerCountryOf,
  careerFare,
  PLATFORM_FEE_BY_COUNTRY,
  vehicleRent,
  createCareerSlice,
  ticketPrice,
} from "../app/game/career";
import {
  DESTINATION_PROFILES,
  getDestinationProfile,
  GIG_FARE_BY_COUNTRY,
  PASSENGER_FARE_BY_COUNTRY,
  getCountryProfile,
  getFreeDrive,
  getMapPack,
} from "../app/game/content";
import { gigReward, MIN_GIG_DISTANCE_M, selectGigPools } from "../app/game/gigs";
import type { GigKind, GigVenuePosition } from "../app/game/gigs";
import { resolveGigAddresses, resolveGigVenues } from "../app/game/gigPools";
import type { MapId } from "../app/game/types";

// The very pools the game offers from — shared rather than mirrored, so the
// tripwire can never drift into pricing a game nobody is playing.
function poolsFor(mapId: MapId): {
  venues: GigVenuePosition[];
  addresses: GigVenuePosition[];
} {
  const map = getMapPack(mapId);
  return { venues: resolveGigVenues(map), addresses: resolveGigAddresses(map) };
}

function medianNet(
  mapId: MapId,
  countryId: (typeof DESTINATION_PROFILES)[number]["countryId"],
  kind: GigKind,
  vehicle: (typeof CAREER_VEHICLES)[number],
): number | null {
  const { venues, addresses } = poolsFor(mapId);
  const { pickups, dropoffs } = selectGigPools(venues, addresses, kind);
  const fare =
    kind === "passenger"
      ? PASSENGER_FARE_BY_COUNTRY[countryId]
      : GIG_FARE_BY_COUNTRY[countryId];
  const nets: number[] = [];
  for (const pickup of pickups) {
    for (const dropoff of dropoffs) {
      if (dropoff.id === pickup.id) continue;
      const distance = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
      if (distance < MIN_GIG_DISTANCE_M) continue;
      // Deliberately the un-surged price. A surge is upside a player chases,
      // not income the ladder may be balanced against — budget for it and the
      // tiers become unaffordable in every ordinary window.
      nets.push(careerFare(gigReward(fare, pickup, dropoff), kind, vehicle).net);
    }
  }
  if (!nets.length) return null;
  nets.sort((left, right) => left - right);
  return nets[Math.floor(nets.length / 2)];
}

// The tripwire: every tier must be beatable at a modest pace in every city the
// career can actually reach. If a future fare/rent/fee edit makes a vehicle need
// more than ~4 median gigs just to break even, the mode has silently become
// unwinnable there and this fails loudly instead.
//
// Scoped to CAREER_CITIES rather than every destination, because rent is only
// ever charged in a ladder city. Today every shipped city is on the ladder, so
// the two sets coincide — but a future free-drive-only city is out of scope
// here by design, and putting it on the ladder pulls it under this assertion
// automatically, which is the moment the answer starts to matter.
describe("career balance tripwire", () => {
  it("keeps rent + platform fee under four median gig nets for every vehicle and ladder city", () => {
    for (const destinationId of CAREER_CITIES) {
      const destination = getDestinationProfile(destinationId);
      const country = getCountryProfile(destination.countryId);
      const mapId = getFreeDrive(destination.freeDriveId).mapId;
      const city = activeCity(
        createCareerSlice({ destinationId, careerSeed: 1 }),
      );
      for (const vehicle of CAREER_VEHICLES) {
        const bestMedian = Math.max(
          ...vehicle.allowedGigKinds.map(
            (kind) => medianNet(mapId, country.id, kind, vehicle) ?? 0,
          ),
        );
        expect(
          bestMedian,
          `${destination.id} offers no priceable gigs for ${vehicle.id}`,
        ).toBeGreaterThan(0);
        const dailyFloor =
          vehicleRent(vehicle, city) + PLATFORM_FEE_BY_COUNTRY[country.id];
        expect(
          dailyFloor,
          `${vehicle.id} in ${destination.id}: floor ${dailyFloor} vs median net ${bestMedian}`,
        ).toBeLessThan(bestMedian * 4);
      }
    }
  });
});

/** A day's take-home driving `vehicle` at a modest four gigs, before tips. */
function dailyNet(
  destinationId: (typeof CAREER_CITIES)[number],
  vehicle: (typeof CAREER_VEHICLES)[number],
): number {
  const countryId = careerCountryOf(destinationId);
  const mapId = getFreeDrive(getDestinationProfile(destinationId).freeDriveId)
    .mapId;
  const best = Math.max(
    ...vehicle.allowedGigKinds.map(
      (kind) => medianNet(mapId, countryId, kind, vehicle) ?? 0,
    ),
  );
  const city = activeCity(
    createCareerSlice({ destinationId, careerSeed: 1 }),
  );
  return best * 4 - vehicleRent(vehicle, city) - PLATFORM_FEE_BY_COUNTRY[countryId];
}

// The ladder's tripwire. A ticket has to be a goal you save for — several days
// of real work — without becoming a wall that strands the player in city one.
// Both bounds are generous; today's prices land around 8-12 days.
describe("ticket reachability", () => {
  const MIN_DAYS = 3;
  const MAX_DAYS = 20;

  it("keeps every onward ticket a few days' work away, never a wall", () => {
    for (const destinationId of CAREER_CITIES) {
      const price = ticketPrice(destinationId);
      if (price === null) continue;
      // The best earner you could realistically be running by then.
      const days = Math.min(
        ...CAREER_VEHICLES.filter((vehicle) => vehicle.id !== "bicycle").map(
          (vehicle) => {
            const net = dailyNet(destinationId, vehicle);
            return net > 0 ? price / net : Number.POSITIVE_INFINITY;
          },
        ),
      );
      expect(
        days,
        `${destinationId}: ticket ${price} is ${days.toFixed(1)} days of work`,
      ).toBeLessThan(MAX_DAYS);
      expect(
        days,
        `${destinationId}: ticket ${price} is only ${days.toFixed(1)} days — too cheap to be a goal`,
      ).toBeGreaterThan(MIN_DAYS);
    }
  });

  it("prices a ticket above the cheapest vehicle it competes with", () => {
    // The ticket and the fleet compete for the same cash, so leaving must cost
    // more than the entry-level purchase — otherwise flying on is always the
    // obviously correct first buy and the garage never gets a look in.
    //
    // Deliberately NOT above the *dearest* vehicle: gating each ticket behind
    // the top of the range would make every city a ~30-day wall before the next
    // one is even visible. Completing the fleets is the long game; seeing the
    // cities is not meant to be.
    for (const destinationId of CAREER_CITIES) {
      const price = ticketPrice(destinationId);
      if (price === null) continue;
      const cheapest = Math.min(
        ...CAREER_VEHICLES.filter((vehicle) => vehicle.buyoutEligible).map(
          (vehicle) => buyoutPrice(vehicle, careerCountryOf(destinationId)),
        ),
      );
      expect(
        price,
        `${destinationId}: ticket ${price} vs entry vehicle ${cheapest}`,
      ).toBeGreaterThan(cheapest);
    }
  });
});
