import { describe, expect, it } from "vitest";

import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { LONDON_PARKED_CARS } from "../app/game/londonStreetFurniture";
import { parkedCarsForMap } from "../app/game/parkedCars";

const MAPS = [NYC_MAP_PACK, LONDON_MAP_PACK, TOKYO_MAP_PACK, CAIRO_MAP_PACK];

describe("parkedCarsForMap", () => {
  it("preserves London's authored kerbside population", () => {
    expect(parkedCarsForMap(LONDON_MAP_PACK)).toBe(LONDON_PARKED_CARS);
  });

  it("gives every shipped map a stable, substantial parked population", () => {
    const counts = Object.fromEntries(
      MAPS.map((mapPack) => {
        const first = parkedCarsForMap(mapPack);
        const second = parkedCarsForMap(mapPack);
        expect(second).toEqual(first);
        expect(new Set(first.map((car) => car.id)).size).toBe(first.length);
        expect(
          first.every(
            (car) =>
              car.headingDeg >= 0 &&
              car.headingDeg < 360 &&
              ["sedan", "sports", "suv", "van"].includes(car.model),
          ),
        ).toBe(true);
        return [mapPack.id, first.length];
      }),
    );

    expect(counts).toEqual({
      "nyc-upper-west-side": 467,
      "london-south-kensington": 182,
      "tokyo-setagaya": 449,
      // Cairo's occupied kerbs are deliberate street character; every other
      // map holds its established count while Cairo alone takes the denser
      // keep profile (all physical-clearance assertions below still apply).
      "cairo-central-nile": 459,
    });
  });

  it("honours late-known furniture such as derived regulatory signs", () => {
    const baseline = parkedCarsForMap(NYC_MAP_PACK);
    const occupied = baseline[0].position;
    const replanned = parkedCarsForMap(NYC_MAP_PACK, [occupied]);

    expect(
      replanned.every(
        (car) =>
          Math.hypot(
            car.position.x - occupied.x,
            car.position.z - occupied.z,
          ) >= 3.2,
      ),
    ).toBe(true);
  });

  it("keeps generated cars at least a full parking slot apart", () => {
    for (const mapPack of [NYC_MAP_PACK, TOKYO_MAP_PACK, CAIRO_MAP_PACK]) {
      const cars = parkedCarsForMap(mapPack);
      let nearest = Number.POSITIVE_INFINITY;
      for (let left = 0; left < cars.length; left += 1) {
        for (let right = left + 1; right < cars.length; right += 1) {
          nearest = Math.min(
            nearest,
            Math.hypot(
              cars[left].position.x - cars[right].position.x,
              cars[left].position.z - cars[right].position.z,
            ),
          );
        }
      }
      expect(nearest).toBeGreaterThanOrEqual(13);
    }
  });
});
