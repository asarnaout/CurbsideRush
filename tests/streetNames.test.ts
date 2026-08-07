import { describe, expect, it } from "vitest";
import { MAP_PACKS, getMapPack } from "../app/game/content";
import {
  addressableStreetNames,
  streetAddressesForMap,
} from "../app/game/streetAddresses";
import type { MapId } from "../app/game/types";

/**
 * Street names exist so navigation can say "turn right onto Broadway". They are
 * keyed on `RoadSurface.id`, which `content.test.ts` already proves is the same
 * key space as every lane's `roadId` — so a name table is fully checkable, and
 * this is the check.
 */

/** The cities a player is told street names in — every shipped map. Navigation
 * falls back to naming no street for a map absent from this list. */
const NAMED_MAPS: readonly MapId[] = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "cairo-central-nile",
];

describe("street names", () => {
  it.each(NAMED_MAPS)("names every road in %s", (mapId) => {
    const pack = getMapPack(mapId);
    const roadIds = [...new Set(pack.laneGraph.lanes.map((lane) => lane.roadId))];
    expect(roadIds.length).toBeGreaterThan(0);
    for (const roadId of roadIds) {
      const name = pack.roadNames?.[roadId];
      expect(name, `${mapId} has no name for ${roadId}`).toBeTruthy();
      // A name a driver could hear read aloud, not an id that leaked through.
      expect(name, roadId).not.toMatch(/^[a-z]+-/);
    }
  });

  it("names a road only once per street, even when it is several surfaces", () => {
    // Cromwell Road is modelled as three surfaces and Exhibition Road as two;
    // both read as the one street the driver is actually on.
    const london = getMapPack("london-south-kensington");
    expect(london.roadNames?.["london-cromwell-west"]).toBe("Cromwell Road");
    expect(london.roadNames?.["london-cromwell-east"]).toBe("Cromwell Road");
    expect(london.roadNames?.["london-cromwell-far-west"]).toBe("Cromwell Road");
    expect(london.roadNames?.["london-exhibition-road"]).toBe("Exhibition Road");
    expect(london.roadNames?.["london-exhibition-north"]).toBe("Exhibition Road");
  });

  it("names NYC's streets after the numerals in their own ids", () => {
    // The grid is generated from one spec per road, so the name rides the same
    // line as the coordinate. Drifting apart would be invisible otherwise.
    const nyc = getMapPack("nyc-upper-west-side");
    for (const [roadId, name] of Object.entries(nyc.roadNames ?? {})) {
      const numeral = /^nyc-west-(\d+)$/.exec(roadId)?.[1];
      if (!numeral) continue;
      expect(name, roadId).toMatch(new RegExp(`^W ${numeral}(st|nd|rd|th) St$`));
    }
    expect(nyc.roadNames?.["nyc-broadway"]).toBe("Broadway");
  });

  it("does not let naming a city make it generate addresses", () => {
    // The whole point of splitting the name table from `STREET_PROFILES`: a
    // road wants a name in far more cities than it wants house numbers. If the
    // names ever became the gate, every named city would start issuing gigs.
    for (const pack of MAP_PACKS.filter((p) => p.id !== "nyc-upper-west-side")) {
      expect(Object.keys(pack.roadNames ?? {}).length > 0, pack.id).toBe(true);
      expect(streetAddressesForMap(pack), pack.id).toEqual([]);
      expect(addressableStreetNames(pack.roadNames), pack.id).toEqual([]);
    }
  });

  it("claims addresses only on streets that produce them", () => {
    const nyc = getMapPack("nyc-upper-west-side");
    const claimed = addressableStreetNames(nyc.roadNames);
    const produced = new Set(
      streetAddressesForMap(nyc).map((address) =>
        address.name.replace(/^\d+\s/, ""),
      ),
    );
    expect(new Set(claimed)).toEqual(produced);
    // Every cross street carries addresses now, narrow one-ways included.
    expect(claimed).toContain("W 91st St");
    expect(claimed).toContain("W 106th St");
  });
});
