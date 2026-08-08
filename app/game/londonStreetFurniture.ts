import type { WorldPoint } from "./types";

/**
 * London's hand-placed pillar boxes and telephone kiosks, and the one place
 * their positions are written down.
 *
 * They exist twice over in the running game — as meshes in
 * `render/londonLandmarks.ts` and as solid circles in `simulationAdapter.ts`
 * — and the two used to be independent literals: the single Queen's Gate
 * pillar box was `LONDON_POST_BOX_POSITION` in `render/propCatalog.ts` and a
 * hardcoded `(122, 87)` in the adapter's obstacle builder, with a comment on
 * each asking the next reader to move both together. That is exactly the
 * shape of drift that put NYC's bridge parapets 3.4 m off their own
 * colliders, and it does not scale to sixteen of them.
 *
 * Both are **solid, not knockable**: cast iron and a quarter-tonne of glazed
 * kiosk both beat a car, so neither is in `DESTRUCTIBLE_PROP_CONFIGS`.
 *
 * Every position is on a pavement and nowhere else: at least 2.9 m clear of
 * every lane envelope, between 0.9 m and 3.2 m past the nearest kerb, and
 * 0.8 m clear of any block. `staticColliders.test.ts` allows small circles to
 * stand on the walkable band — walkers route around them — but not on the
 * asphalt, and hand-picked coordinates put six of these in a carriageway
 * before the constraint was solved for rather than eyeballed.
 */
export interface LondonFurniturePlacement {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw; a kiosk's door faces the pavement it stands on. */
  readonly headingDeg: number;
}

/** Collider radius shared by both families — a pillar box and a K6 kiosk are
 * within a few centimetres of each other in plan. */
export const LONDON_FURNITURE_RADIUS_M = 0.62;

const at = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
): LondonFurniturePlacement => ({ id, position: { x, z }, headingDeg });

/**
 * Royal Mail pillar boxes. The Queen's Gate one keeps its original position
 * to the centimetre — it is the only piece of London street furniture that
 * has ever been a solid obstacle, and moving it would move a landmark players
 * have been driving past since the map shipped.
 */
export const LONDON_PILLAR_BOXES: readonly LondonFurniturePlacement[] = [
  at("london-post-box", 122, 87, 0),
  at("london-post-box-kings-road", -303.0, -281.0, 100),
  at("london-post-box-earls-court", -818.0, 62.0, 270),
  at("london-post-box-embankment", -338.0, -512.0, 15),
  at("london-post-box-knightsbridge", 323.3, 211.7, 190),
  at("london-post-box-oxford", 813.7, 691.6, 180),
  at("london-post-box-bishopsgate", 1162.5, 300.0, 265),
  at("london-post-box-riverbank", 447.2, -650.4, 5),
];

/**
 * K6-style telephone kiosks. Deliberately procedural rather than imported:
 * a red box with glazing bars and a crown frieze is a handful of primitives,
 * and nothing about it is worth a licence to verify.
 */
export const LONDON_PHONE_BOXES: readonly LondonFurniturePlacement[] = [
  at("london-phone-box-queens-gate", -114.5, 34.0, 90),
  at("london-phone-box-kings-road", -106.0, -278.3, 100),
  at("london-phone-box-chelsea", -321.5, -406.0, 350),
  at("london-phone-box-earls-court", -815.5, -100.0, 270),
  at("london-phone-box-piccadilly", 805.5, 293.5, 200),
  at("london-phone-box-whitehall", 790.1, -186.4, 180),
  at("london-phone-box-city", 1177.0, 344.0, 245),
  at("london-phone-box-islington", 1181.3, 840.7, 285),
];

/**
 * Belisha beacons — the amber globe on a black-and-white pole that flanks a
 * zebra crossing, and one of the few things that says "Britain" from inside a
 * car. One pair per authored crossing, standing a metre past each kerb.
 *
 * Derived from the crossings' own stop-line anchors rather than typed by
 * hand — then nudged, on two of the twelve, half a metre further past the
 * kerb: a lane is offset to its own side of the centreline, so the offside
 * beacon of a pair sits marginally closer to the opposing carriageway than
 * the nearside one. Both are written down here so the renderer and the
 * collider builder read one table; `tests/londonContent.test.ts` checks each pair still
 * straddles the crossing it belongs to, which is what stops them drifting
 * apart if a road ever moves.
 */
export const LONDON_BELISHA_BEACONS: readonly LondonFurniturePlacement[] = [
  at("london-beacon-kings-road-near", -192.2, -271.3, 83),
  at("london-beacon-kings-road-far", -190.5, -284.7, 83),
  at("london-beacon-knightsbridge-near", 221.7, 228.5, 90),
  at("london-beacon-knightsbridge-far", 221.7, 214.9, 90),
  at("london-beacon-oxford-near", 889.7, 708.5, 90),
  at("london-beacon-oxford-far", 889.7, 694.9, 90),
  at("london-beacon-bishopsgate-near", 1159, 490, 2),
  at("london-beacon-bishopsgate-far", 1172.6, 489.5, 2),
  at("london-beacon-upper-street-near", 1157.7, 832.7, 7),
  at("london-beacon-upper-street-far", 1171.2, 831.1, 7),
  at("london-beacon-riverbank-near", 747.3, -595.8, 82),
  at("london-beacon-riverbank-far", 749.1, -609.3, 82),
];

/**
 * Everything London stands on its pavements that a car cannot drive through.
 * A beacon pole is slimmer than a pillar box but no more forgiving.
 */
export const LONDON_STREET_FURNITURE: readonly LondonFurniturePlacement[] = [
  ...LONDON_PILLAR_BOXES,
  ...LONDON_PHONE_BOXES,
  ...LONDON_BELISHA_BEACONS,
];
