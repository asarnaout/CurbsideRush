import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import { resolveGigVenues } from "../app/game/gigPools";
import {
  collectMapPois,
  countMapPois,
  MAP_POI_FAMILY,
  MAP_POI_LEGEND,
  MINIMAP_POI_KINDS,
  mapPoisOfKinds,
  type MapPoiKind,
} from "../app/game/mapPoi";
import { MAP_ROUTE_COLOR } from "../app/game/minimapDraw";
import {
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
} from "../app/game/servicePoints";
import { trafficCameraControlIds } from "../app/game/trafficSignals";
import type { MapId } from "../app/game/types";

const CITIES: readonly MapId[] = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "cairo-central-nile",
];

const poisFor = (id: MapId) => collectMapPois(getMapPack(id));

describe("what a map marks", () => {
  it("marks a gas station at its pumps, not at the lane it is anchored to", () => {
    // The anchor is out on the carriageway ~19 m short of the forecourt. Fuel
    // is only offered at the pumps, so a marker on the anchor is a dead spot.
    const pack = getMapPack("nyc-upper-west-side");
    const [service] = gasStationsOf(pack.geometry.servicePoints);
    const pumps = gasStationPumpPositions(pack.laneGraph.lanes, service);
    const marker = poisFor("nyc-upper-west-side").find(
      (poi) => poi.id === service.id,
    );
    expect(marker?.kind).toBe("fuel");
    expect(marker?.x).toBeCloseTo(
      pumps.reduce((total, pump) => total + pump.x, 0) / pumps.length,
      9,
    );
    expect(marker?.label).toBe(service.label);
    // And nowhere near the anchor it was authored against.
    expect(Math.hypot(marker!.x - 0, marker!.z - 0)).toBeGreaterThan(0);
  });

  it("marks a repair shop at the bay the car has to stop in", () => {
    const pack = getMapPack("nyc-upper-west-side");
    for (const service of repairShopsOf(pack.geometry.servicePoints)) {
      const bay = repairShopBayPosition(pack.laneGraph.lanes, service);
      const marker = poisFor("nyc-upper-west-side").find(
        (poi) => poi.id === service.id,
      );
      expect(marker?.kind).toBe("repair");
      expect(marker?.x).toBeCloseTo(bay!.x, 9);
      expect(marker?.z).toBeCloseTo(bay!.z, 9);
    }
  });

  it("marks exactly the junctions the renderer puts a camera on", () => {
    // The draw is a hash over the signal ids, made independently here and in
    // `BabylonGameSession`. If they ever disagree the map lies about which reds
    // are watched, which is worse than not marking them at all.
    for (const id of CITIES) {
      const pack = getMapPack(id);
      const signals = pack.laneGraph.controls.filter(
        (control) => control.type === "signal",
      );
      const watched = trafficCameraControlIds(signals.map((c) => c.id));
      const marked = new Set(
        poisFor(id)
          .filter((poi) => poi.kind === "camera")
          .map((poi) => poi.id),
      );
      expect([...marked].sort(), id).toEqual([...watched].sort());
    }
  });

  it("derives a third of every signalled city's signals as cameras", () => {
    // London authors two signals, and the ranked draw floors at one.
    // 1 -> 2 (the King's Road and Earls Court signals) -> 3 (both ends of
    // Westminster Bridge and Tower Bridge) -> 4 (Parliament Square's three
    // signalled gyratory arms, twelve signals in all). A third,
    // `TRAFFIC_CAMERA_RATE`.
    expect(countMapPois(poisFor("london-south-kensington")).camera).toBe(4);
    expect(countMapPois(poisFor("nyc-upper-west-side")).camera).toBeGreaterThan(10);
    // Tokyo expansion Phase 5 (R10): 42 authored `type: "signal"` controls,
    // ranked and cut at a third (`TRAFFIC_CAMERA_RATE`) -> 14. Before Phase 5
    // Tokyo ran on stops, crosswalks and a railway signal only — no traffic
    // lights, so no cameras; the legend survived a family with nothing in it,
    // which is why this test used to assert zero here.
    expect(countMapPois(poisFor("tokyo-setagaya")).camera).toBe(14);
  });

  it("marks the places a job loads at, and leaves homes and offices alone", () => {
    // A map that pins every address pins nothing.
    for (const id of CITIES) {
      const venues = resolveGigVenues(getMapPack(id));
      const pois = poisFor(id);
      const counts = countMapPois(pois);
      expect(counts.food, id).toBe(
        venues.filter((venue) => venue.kind === "restaurant").length,
      );
      expect(counts.shop, id).toBe(
        venues.filter((venue) => venue.kind === "shop").length,
      );
      const marked = new Set(pois.map((poi) => poi.id));
      for (const venue of venues) {
        if (["residence", "office", "depot"].includes(venue.kind)) {
          expect(marked.has(venue.id), `${id}:${venue.id}`).toBe(false);
        }
      }
    }
  });

  it("carries a real name, so a marker can say what it is", () => {
    const diner = poisFor("nyc-upper-west-side").find(
      (poi) => poi.id === "nyc-v1",
    );
    expect(diner?.kind).toBe("food");
    expect(diner?.label).toBe("Amsterdam Diner");
  });

  it("gives every city something to find", () => {
    for (const id of CITIES) {
      const counts = countMapPois(poisFor(id));
      expect(counts.fuel, id).toBeGreaterThan(0);
      expect(counts.food + counts.shop, id).toBeGreaterThan(0);
    }
    // New York is the crowded one — the case the whole-city map has to hold.
    expect(poisFor("nyc-upper-west-side").length).toBeGreaterThan(30);
  });

  it("hands back the same array every time, so a map does not re-raster", () => {
    // The whole-city map keys its road raster on this. A fresh array per render
    // would redraw the city at 10 Hz.
    expect(poisFor("nyc-upper-west-side")).toBe(poisFor("nyc-upper-west-side"));
  });
});

describe("what the corner widget carries", () => {
  it("is the three worth knowing about while actually driving", () => {
    expect([...MINIMAP_POI_KINDS]).toEqual(["fuel", "repair", "camera"]);
  });

  it("leaves the food and shops to the whole-city map", () => {
    // 36 markers on a 104px square would bury the destination pin.
    const widget = mapPoisOfKinds(poisFor("nyc-upper-west-side"), MINIMAP_POI_KINDS);
    const counts = countMapPois(widget);
    expect(counts.food).toBe(0);
    expect(counts.shop).toBe(0);
    expect(counts.fuel).toBe(3);
    expect(counts.repair).toBe(3);
    expect(widget.length).toBeLessThan(poisFor("nyc-upper-west-side").length);
  });
});

describe("how a family reads", () => {
  it("gives every kind a label, a colour and a glyph", () => {
    for (const kind of MAP_POI_LEGEND) {
      const family = MAP_POI_FAMILY[kind];
      expect(family.label, kind).toMatch(/\S/);
      expect(family.color, kind).toMatch(/^#[0-9a-f]{6}$/i);
      expect(family.icon.length, kind).toBeGreaterThan(0);
    }
  });

  it("legends every kind exactly once", () => {
    const kinds = Object.keys(MAP_POI_FAMILY) as MapPoiKind[];
    expect([...MAP_POI_LEGEND].sort()).toEqual(kinds.sort());
  });

  it("keeps every family clear of the route gold", () => {
    // The gold is the line to your stop and the arrow that is you. A marker
    // wearing it reads as part of the journey rather than a place.
    for (const kind of MAP_POI_LEGEND) {
      expect(MAP_POI_FAMILY[kind].color.toLowerCase()).not.toBe(
        MAP_ROUTE_COLOR.toLowerCase(),
      );
    }
  });

  it("gives no two families the same colour or the same glyph", () => {
    const colors = MAP_POI_LEGEND.map((kind) => MAP_POI_FAMILY[kind].color);
    expect(new Set(colors).size).toBe(colors.length);
    const glyphs = MAP_POI_LEGEND.map((kind) => MAP_POI_FAMILY[kind].icon.join("|"));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("keeps today's green pump and coral wrench", () => {
    // Both were already on the corner map as bare dots; the icon is the change,
    // not the colour a player has learned.
    expect(MAP_POI_FAMILY.fuel.color).toBe("#5bbf6a");
    expect(MAP_POI_FAMILY.repair.color).toBe("#e8705a");
  });
});
