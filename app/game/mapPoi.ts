/**
 * The places a map marks, and what each one looks like.
 *
 * One derivation feeding three surfaces — the corner widget, the whole-city map
 * and its legend — because the alternative is three answers to "where is the
 * nearest pump". Pure: no DOM, no Babylon, no React, so it is node-testable and
 * the icons are path data rather than components.
 *
 * Nothing here *places* anything. Every position comes from the resolver that
 * already owns it (`servicePoints.ts`, `gigPools.ts`, `trafficSignals.ts`), so
 * a marker cannot land somewhere the thing it marks is not.
 */
import {
  FOOD_ICON,
  FUEL_PUMP_ICON,
  SHOPPING_BAG_ICON,
  TRAFFIC_CAMERA_ICON,
  WRENCH_ICON,
} from "./hudIcons";
import { resolveGigVenues } from "./gigPools";
import {
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
} from "./servicePoints";
import { trafficCameraControlIds } from "./trafficSignals";
import type { GigVenueKind, MapPack } from "./types";

export type MapPoiKind = "fuel" | "repair" | "food" | "shop" | "camera";

export interface MapPoi {
  readonly id: string;
  readonly kind: MapPoiKind;
  readonly x: number;
  readonly z: number;
  /** The authored name where there is one — "Amsterdam Diner", "Broadway Fuel". */
  readonly label: string;
}

export interface MapPoiFamily {
  /** Legend copy. The family, not the building: "Repairs", not "auto store". */
  readonly label: string;
  readonly color: string;
  readonly icon: readonly string[];
}

/**
 * Colour and glyph per family.
 *
 * Fuel and repairs keep the exact greens and corals the corner map has always
 * pinned them in, so nothing a player already recognises moves. The three new
 * hues stay well clear of `#f2c658` — that gold is the route line and the
 * player arrow, and a marker wearing it reads as part of the journey.
 */
export const MAP_POI_FAMILY: Readonly<Record<MapPoiKind, MapPoiFamily>> =
  Object.freeze({
    fuel: { label: "Fuel", color: "#5bbf6a", icon: FUEL_PUMP_ICON },
    repair: { label: "Repairs", color: "#e8705a", icon: WRENCH_ICON },
    food: { label: "Food", color: "#e2894a", icon: FOOD_ICON },
    shop: { label: "Shops", color: "#b58fd0", icon: SHOPPING_BAG_ICON },
    camera: { label: "Cameras", color: "#7fa8d8", icon: TRAFFIC_CAMERA_ICON },
  });

/** Legend order: the two you drive *to*, then the two you load at, then the watchers. */
export const MAP_POI_LEGEND: readonly MapPoiKind[] = Object.freeze([
  "fuel",
  "repair",
  "food",
  "shop",
  "camera",
] as const);

/**
 * What the corner widget carries.
 *
 * Not the whole set: a 104 px square already holding a route line and a
 * destination pin cannot also hold New York's thirty-six places without burying
 * the one the player is driving to. These three are the ones worth knowing
 * about *while* driving — somewhere to fill up, somewhere to get put right, and
 * a junction that will ticket you. Food and shops are trip planning, which is
 * what the whole-city map is for.
 */
export const MINIMAP_POI_KINDS: readonly MapPoiKind[] = Object.freeze([
  "fuel",
  "repair",
  "camera",
] as const);

/**
 * Which venues earn a marker.
 *
 * A table rather than `kind === "restaurant"` scattered about, for the reason
 * `gasStationsOf` exists: a new venue kind should have to say what it is on the
 * map, not silently inherit whatever the last `if` happened to test. Homes,
 * offices and depots are deliberately unmarked — a map that pins every address
 * pins nothing.
 */
const POI_KIND_BY_VENUE_KIND: Readonly<Record<GigVenueKind, MapPoiKind | null>> =
  Object.freeze({
    restaurant: "food",
    shop: "shop",
    residence: null,
    office: null,
    depot: null,
  });

/**
 * Cached per pack, the way `streetAddressesForMap` is, and for a stronger
 * reason than cost: the whole-city map rasterises its road sheet in an effect
 * keyed on this array, so a fresh array every render would re-raster the city
 * at 10 Hz. Packs are frozen, so the usual caveat — mutating one after the
 * first call has no effect — cannot bite.
 */
const poiCache = new Map<string, readonly MapPoi[]>();

/** Every marked place on a map: services, venues worth loading at, and cameras. */
export function collectMapPois(map: MapPack): readonly MapPoi[] {
  const cached = poiCache.get(map.id);
  if (cached) return cached;

  const lanes = map.laneGraph.lanes;
  const pois: MapPoi[] = [];

  // The pumps, not the lane anchor. The anchor sits on the carriageway ~19 m
  // short of the forecourt, and fuel is only offered at the pumps — a marker
  // out on the road would send the player to a dead spot.
  for (const service of gasStationsOf(map.geometry.servicePoints)) {
    const pumps = gasStationPumpPositions(lanes, service);
    if (!pumps.length) continue;
    pois.push({
      id: service.id,
      kind: "fuel",
      x: pumps.reduce((total, pump) => total + pump.x, 0) / pumps.length,
      z: pumps.reduce((total, pump) => total + pump.z, 0) / pumps.length,
      label: service.label,
    });
  }

  // The bay, for the same reason: that is where the car has to stop.
  for (const service of repairShopsOf(map.geometry.servicePoints)) {
    const bay = repairShopBayPosition(lanes, service);
    if (!bay) continue;
    pois.push({
      id: service.id,
      kind: "repair",
      x: bay.x,
      z: bay.z,
      label: service.label,
    });
  }

  // Positions come from the gig resolver so a marker and the job that loads
  // there can never disagree; the kind comes off the authored venue, because
  // `GigVenuePosition.kind` is a bare `string` — `gigs.ts` is deliberately
  // map-agnostic — and indexing the table with that would lose the
  // exhaustiveness the table exists for.
  const placed = new Map(resolveGigVenues(map).map((venue) => [venue.id, venue]));
  for (const venue of map.geometry.gigVenues ?? []) {
    const kind = POI_KIND_BY_VENUE_KIND[venue.kind];
    const at = placed.get(venue.id);
    if (!kind || !at) continue;
    pois.push({ id: venue.id, kind, x: at.x, z: at.z, label: venue.name });
  }

  // Cameras are never authored — the same hash draw the renderer makes, off the
  // same signal ids, so the marked junctions are exactly the watched ones.
  const signals = map.laneGraph.controls.filter(
    (control) => control.type === "signal",
  );
  const watched = trafficCameraControlIds(signals.map((control) => control.id));
  for (const control of signals) {
    if (!watched.has(control.id)) continue;
    pois.push({
      id: control.id,
      kind: "camera",
      x: control.position.x,
      z: control.position.z,
      label: "Traffic camera",
    });
  }

  const frozen = Object.freeze(pois);
  poiCache.set(map.id, frozen);
  return frozen;
}

/** The subset of `pois` in `kinds`, preserving order. */
export function mapPoisOfKinds(
  pois: readonly MapPoi[],
  kinds: readonly MapPoiKind[],
): readonly MapPoi[] {
  return pois.filter((poi) => kinds.includes(poi.kind));
}

/** How many of each family a map carries — what the legend counts. */
export function countMapPois(
  pois: readonly MapPoi[],
): Readonly<Record<MapPoiKind, number>> {
  const counts: Record<MapPoiKind, number> = {
    fuel: 0,
    repair: 0,
    food: 0,
    shop: 0,
    camera: 0,
  };
  for (const poi of pois) counts[poi.kind] += 1;
  return counts;
}
