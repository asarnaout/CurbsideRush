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

/** The four committed car glbs a parked car may use — the traffic fleet's own
 * models, so the kerbs and the carriageway read as one population. */
export type LondonParkedCarModel = "sedan" | "sports" | "suv" | "van";

/**
 * A kerbside parked car. Half-on-kerb like the reference photos: the centre
 * sits just past the kerb line, body straddling it, which is how London
 * actually parks. **Knockable, never solid**: `staticColliders.test.ts`
 * reserves the whole lane corridor plus the walkable band for solid
 * obstacles, and a shunted parked car giving way reads better than an
 * invisible wall at the kerb anyway — so these register through
 * `DESTRUCTIBLE_PROP_CONFIGS` ("parked-car"), not the adapter's
 * obstacle builder.
 */
export interface LondonParkedCar {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw; a car faces the way its kerb's traffic flows. */
  readonly headingDeg: number;
  readonly model: LondonParkedCarModel;
}

const parked = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
  model: LondonParkedCarModel,
): LondonParkedCar => ({ id, position: { x, z }, headingDeg, model });

/**
 * Solver-placed (scratchpad `parked.mjs`), never eyeballed: every position is
 * >= 2.6 m from every lane centreline (an NPC passes with real clearance),
 * >= 18 m from every junction node, clear of venue and service lots, hand
 * furniture, beacons, parks and water, and >= 13 m from the next car, thinned
 * to just over half the eligible slots so streets cluster with gaps the way
 * real kerbs do. Facing follows the kerb: left-hand traffic, so the left kerb
 * of a direction parks nose-along it.
 */
export const LONDON_PARKED_CARS: readonly LondonParkedCar[] = [
  parked("london-parked-kings-road-1", -1156.6, -384.8, 84, "sedan"),
  parked("london-parked-kings-road-2", -1132.7, -382.4, 84, "van"),
  parked("london-parked-kings-road-3", -1085.0, -377.6, 84, "sedan"),
  parked("london-parked-kings-road-4", -1061.1, -375.2, 84, "van"),
  parked("london-parked-kings-road-5", -1037.2, -372.8, 84, "van"),
  parked("london-parked-kings-road-6", -989.4, -368.0, 84, "sedan"),
  parked("london-parked-kings-road-7", -965.6, -365.6, 84, "suv"),
  parked("london-parked-kings-road-8", -940.7, -372.8, 264, "sedan"),
  parked("london-parked-kings-road-9", -916.8, -370.4, 264, "sports"),
  parked("london-parked-kings-road-10", -893.0, -368.0, 264, "sedan"),
  parked("london-parked-kings-road-11", -869.1, -365.6, 264, "sedan"),
  parked("london-parked-kings-road-12", -772.7, -346.2, 84, "van"),
  parked("london-parked-kings-road-13", -653.3, -334.4, 84, "van"),
  parked("london-parked-kings-road-14", -535.0, -321.5, 82, "van"),
  parked("london-parked-kings-road-15", -439.9, -307.8, 82, "van"),
  parked("london-parked-kings-road-16", -416.2, -304.4, 82, "van"),
  parked("london-parked-kings-road-17", -368.7, -297.5, 82, "sedan"),
  parked("london-parked-kings-road-18", -249.1, -281.6, 83, "sedan"),
  parked("london-parked-kings-road-19", -224.1, -288.2, 263, "sedan"),
  parked("london-parked-kings-road-20", -176.4, -282.3, 263, "suv"),
  parked("london-parked-kings-road-21", -152.6, -279.4, 263, "sedan"),
  parked("london-parked-kings-road-22", -59.5, -255.9, 80, "van"),
  parked("london-parked-kings-road-23", -35.9, -251.7, 80, "sedan"),
  parked("london-parked-kings-road-24", -12.2, -247.5, 80, "sedan"),
  parked("london-parked-kings-road-25", 11.4, -243.3, 80, "sedan"),
  parked("london-parked-kings-road-26", 82.3, -230.8, 80, "sedan"),
  parked("london-parked-kings-road-27", 105.9, -226.6, 80, "van"),
  parked("london-parked-kings-road-28", 153.2, -218.2, 80, "sedan"),
  parked("london-parked-old-brompton-1", -779.9, -119.8, 269, "sedan"),
  parked("london-parked-old-brompton-2", -751.9, -119.1, 269, "sedan"),
  parked("london-parked-old-brompton-3", -725.9, -118.5, 269, "sports"),
  parked("london-parked-old-brompton-4", -699.9, -117.8, 269, "sedan"),
  parked("london-parked-old-brompton-5", -538.1, -105.0, 89, "sedan"),
  parked("london-parked-old-brompton-6", -456.1, -103.2, 89, "van"),
  parked("london-parked-old-brompton-7", -430.1, -102.6, 89, "sedan"),
  parked("london-parked-old-brompton-8", -402.1, -101.9, 89, "sedan"),
  parked("london-parked-old-brompton-9", -376.2, -101.3, 89, "suv"),
  parked("london-parked-old-brompton-10", -348.2, -100.7, 89, "van"),
  parked("london-parked-old-brompton-11", -320.2, -100.0, 89, "suv"),
  parked("london-parked-earls-court-road-1", -808.1, 178.1, 179, "suv"),
  parked("london-parked-earls-court-road-2", -806.9, 106.1, 179, "suv"),
  parked("london-parked-earls-court-road-3", -806.6, 82.1, 179, "sedan"),
  parked("london-parked-earls-court-road-4", -806.2, 58.1, 179, "sedan"),
  parked("london-parked-earls-court-road-5", -805.9, 34.1, 179, "suv"),
  parked("london-parked-earls-court-road-6", -813.7, -40.1, 359, "sedan"),
  parked("london-parked-earls-court-road-7", -813.3, -62.1, 359, "sedan"),
  parked("london-parked-earls-court-road-8", -812.9, -86.1, 359, "suv"),
  parked("london-parked-earls-court-road-9", -813.0, -145.9, 1, "sedan"),
  parked("london-parked-earls-court-road-10", -814.1, -211.9, 1, "sports"),
  parked("london-parked-earls-court-road-11", -815.2, -277.9, 1, "sedan"),
  parked("london-parked-warwick-road-1", -1155.6, 201.9, 359, "sedan"),
  parked("london-parked-warwick-road-2", -1154.8, 153.9, 359, "sports"),
  parked("london-parked-warwick-road-3", -1154.4, 129.9, 359, "van"),
  parked("london-parked-warwick-road-4", -1153.9, 105.9, 359, "sedan"),
  parked("london-parked-warwick-road-5", -1148.0, -38.2, 184, "sedan"),
  parked("london-parked-warwick-road-6", -1151.6, -86.0, 184, "sedan"),
  parked("london-parked-warwick-road-7", -1153.4, -110.0, 184, "sedan"),
  parked("london-parked-warwick-road-8", -1157.1, -157.8, 184, "sports"),
  parked("london-parked-warwick-road-9", -1171.6, -229.5, 5, "sports"),
  parked("london-parked-warwick-road-10", -1173.5, -253.4, 5, "sedan"),
  parked("london-parked-warwick-road-11", -1175.4, -277.4, 5, "sedan"),
  parked("london-parked-warwick-road-12", -1177.3, -301.3, 5, "van"),
  parked("london-parked-warwick-road-13", -1179.2, -325.2, 5, "suv"),
  parked("london-parked-flood-street-1", -101.0, -302.2, 188, "sedan"),
  parked("london-parked-flood-street-2", -105.5, -333.9, 188, "sedan"),
  parked("london-parked-battersea-road-1", -1232.2, -929.3, 87, "van"),
  parked("london-parked-battersea-road-2", -1206.3, -928.1, 87, "sedan"),
  parked("london-parked-battersea-road-3", -1152.3, -925.7, 87, "suv"),
  parked("london-parked-battersea-road-4", -1098.4, -923.3, 87, "sports"),
  parked("london-parked-battersea-road-5", -1016.4, -919.6, 87, "sedan"),
  parked("london-parked-battersea-road-6", -990.5, -918.5, 87, "sedan"),
  parked("london-parked-battersea-road-7", -962.5, -917.2, 87, "sedan"),
  parked("london-parked-battersea-road-8", -936.5, -916.1, 87, "sedan"),
  parked("london-parked-battersea-road-9", -908.6, -914.8, 87, "suv"),
  parked("london-parked-battersea-road-10", -827.8, -919.2, 266, "suv"),
  parked("london-parked-battersea-road-11", -773.9, -915.9, 266, "suv"),
  parked("london-parked-battersea-road-12", -746.0, -914.2, 266, "van"),
  parked("london-parked-battersea-road-13", -638.7, -898.6, 86, "suv"),
  parked("london-parked-battersea-road-14", -612.8, -897.0, 86, "suv"),
  parked("london-parked-battersea-road-15", -558.9, -893.7, 86, "sports"),
  parked("london-parked-battersea-road-16", -450.5, -895.9, 266, "sedan"),
  parked("london-parked-battersea-road-17", -422.6, -894.1, 266, "sports"),
  parked("london-parked-battersea-road-18", -368.7, -890.8, 266, "sedan"),
  parked("london-parked-battersea-road-19", -316.0, -875.9, 82, "sedan"),
  parked("london-parked-battersea-road-20", -236.9, -864.2, 82, "suv"),
  parked("london-parked-battersea-road-21", -209.2, -860.1, 82, "van"),
  parked("london-parked-battersea-road-22", -155.7, -852.2, 82, "van"),
  parked("london-parked-battersea-road-23", -102.3, -844.3, 82, "sedan"),
  parked("london-parked-battersea-road-24", -76.6, -840.5, 82, "suv"),
  parked("london-parked-battersea-road-25", -48.9, -836.5, 82, "sedan"),
  parked("london-parked-battersea-road-26", -23.2, -832.7, 82, "sports"),
  parked("london-parked-battersea-road-27", 30.2, -824.8, 82, "sedan"),
  parked("london-parked-battersea-road-28", 165.1, -805.9, 83, "sedan"),
  parked("london-parked-battersea-road-29", 190.9, -802.7, 83, "sedan"),
  parked("london-parked-battersea-road-30", 218.7, -799.2, 83, "van"),
  parked("london-parked-battersea-road-31", 298.1, -789.3, 83, "van"),
  parked("london-parked-battersea-road-32", 325.8, -785.8, 83, "sedan"),
  parked("london-parked-battersea-road-33", 351.6, -782.6, 83, "suv"),
  parked("london-parked-battersea-road-34", 379.4, -779.1, 83, "sedan"),
  parked("london-parked-battersea-road-35", 433.0, -772.4, 83, "van"),
  parked("london-parked-battersea-road-36", 460.8, -768.9, 83, "sedan"),
  parked("london-parked-battersea-road-37", 512.4, -762.5, 83, "sedan"),
  parked("london-parked-battersea-road-38", 540.2, -759.0, 83, "van"),
  parked("london-parked-battersea-road-39", 648.2, -755.1, 264, "sedan"),
  parked("london-parked-battersea-road-40", 674.0, -752.3, 264, "suv"),
  parked("london-parked-battersea-road-41", 701.9, -749.2, 264, "sedan"),
  parked("london-parked-battersea-road-42", 727.7, -746.3, 264, "sports"),
  parked("london-parked-battersea-road-43", 781.4, -740.3, 264, "van"),
  parked("london-parked-battersea-road-44", 809.2, -737.2, 264, "sedan"),
  parked("london-parked-battersea-road-45", 862.9, -731.3, 264, "suv"),
  parked("london-parked-battersea-road-46", 888.7, -728.4, 264, "sedan"),
  parked("london-parked-battersea-road-47", 970.2, -719.3, 264, "sedan"),
  parked("london-parked-battersea-road-48", 998.0, -716.3, 264, "sports"),
  parked("london-parked-battersea-road-49", 1077.4, -698.6, 84, "suv"),
  parked("london-parked-battersea-road-50", 1156.9, -690.0, 84, "van"),
  parked("london-parked-battersea-road-51", 1184.7, -687.0, 84, "sports"),
  parked("london-parked-battersea-road-52", 1238.4, -681.2, 84, "sports"),
  parked("london-parked-battersea-road-53", 1292.1, -675.4, 84, "sedan"),
  parked("london-parked-battersea-road-54", 1318.0, -672.7, 84, "van"),
  parked("london-parked-battersea-road-55", 1345.8, -669.7, 84, "sedan"),
  parked("london-parked-notting-hill-1", -326.1, 943.9, 88, "van"),
  parked("london-parked-notting-hill-2", -350.1, 943.3, 88, "sports"),
  parked("london-parked-notting-hill-3", -376.1, 942.5, 88, "sedan"),
  parked("london-parked-notting-hill-4", -400.1, 941.9, 88, "van"),
  parked("london-parked-notting-hill-5", -425.8, 931.9, 268, "suv"),
  parked("london-parked-notting-hill-6", -450.1, 940.5, 88, "sports"),
  parked("london-parked-notting-hill-7", -499.8, 929.8, 268, "suv"),
  parked("london-parked-notting-hill-8", -525.8, 929.1, 268, "sedan"),
  parked("london-parked-notting-hill-9", -550.0, 937.7, 88, "sports"),
  parked("london-parked-notting-hill-10", -626.0, 935.6, 88, "sedan"),
  parked("london-parked-notting-hill-11", -725.9, 924.4, 269, "sedan"),
  parked("london-parked-notting-hill-12", -749.9, 924.0, 269, "sedan"),
  parked("london-parked-notting-hill-13", -775.9, 923.6, 269, "suv"),
  parked("london-parked-notting-hill-14", -825.9, 922.9, 269, "suv"),
  parked("london-parked-notting-hill-15", -850.0, 931.9, 89, "sedan"),
  parked("london-parked-notting-hill-16", -876.0, 931.5, 89, "sports"),
  parked("london-parked-notting-hill-17", -950.0, 930.4, 89, "sedan"),
  parked("london-parked-notting-hill-18", -976.0, 930.0, 89, "sedan"),
  parked("london-parked-porchester-1", -1004.5, 869.0, 0, "sports"),
  parked("london-parked-porchester-2", -1004.5, 841.0, 0, "sedan"),
  parked("london-parked-porchester-3", -1004.5, 813.0, 0, "sedan"),
  parked("london-parked-porchester-4", -1004.5, 755.0, 0, "suv"),
  parked("london-parked-porchester-5", -1004.5, 673.0, 0, "suv"),
  parked("london-parked-porchester-6", -985.8, 448.6, 176, "van"),
  parked("london-parked-porchester-7", -981.9, 392.8, 176, "suv"),
  parked("london-parked-westbourne-1", -668.9, 905.2, 10, "van"),
  parked("london-parked-westbourne-2", -682.5, 828.4, 10, "suv"),
  parked("london-parked-westbourne-3", -696.0, 751.5, 10, "sedan"),
  parked("london-parked-westbourne-4", -700.5, 725.9, 10, "sports"),
  parked("london-parked-westbourne-5", -705.0, 700.3, 10, "sedan"),
  parked("london-parked-westbourne-6", -700.8, 673.2, 190, "suv"),
  parked("london-parked-westbourne-7", -705.3, 647.6, 190, "sports"),
  parked("london-parked-westbourne-8", -709.8, 622.0, 190, "sedan"),
  parked("london-parked-westbourne-9", -748.4, 512.9, 17, "sedan"),
  parked("london-parked-westbourne-10", -755.4, 490.0, 17, "sedan"),
  parked("london-parked-westbourne-11", -768.7, 416.7, 197, "suv"),
  parked("london-parked-westbourne-12", -776.3, 391.8, 197, "sports"),
  parked("london-parked-westbourne-13", -801.5, 295.7, 190, "sedan"),
  parked("london-parked-westbourne-14", -805.6, 272.1, 190, "sedan"),
  parked("london-parked-buckingham-palace-road-1", 322.4, -189.6, 76, "sports"),
  parked("london-parked-buckingham-palace-road-2", 353.4, -181.7, 76, "suv"),
  parked("london-parked-buckingham-palace-road-3", 515.2, -109.2, 35, "suv"),
  parked("london-parked-oxford-street-1", 646.4, 694.6, 270, "sports"),
  parked("london-parked-oxford-street-2", 670.4, 694.6, 270, "suv"),
  parked("london-parked-oxford-street-3", 696.4, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-4", 746.4, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-5", 770.4, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-6", 846.0, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-7", 872.0, 705.4, 90, "sports"),
  parked("london-parked-oxford-street-8", 896.0, 705.4, 90, "van"),
  parked("london-parked-oxford-street-9", 948.0, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-10", 972.0, 694.6, 270, "sedan"),
  parked("london-parked-oxford-street-11", 1072.0, 705.4, 90, "sedan"),
  parked("london-parked-victoria-street-1", 654.0, -289.3, 279, "van"),
  parked("london-parked-victoria-street-2", 569.7, -271.9, 286, "sports"),
  parked("london-parked-victoria-street-3", 540.8, -263.7, 286, "suv"),
  parked("london-parked-victoria-street-4", 509.5, -229.8, 177, "sedan"),
  parked("london-parked-victoria-street-5", 506.8, -171.8, 177, "van"),
  parked("london-parked-great-portland-1", 807.6, 733.4, 185, "sports"),
  parked("london-parked-great-portland-2", 818.9, 865.6, 184, "sedan"),
  parked("london-parked-upper-street-1", 1160.3, 746.1, 187, "sedan"),
  parked("london-parked-upper-street-2", 1167.1, 880.4, 8, "suv"),
];

/**
 * A pedestrian guardrail run — the black railed barrier that hems a London
 * junction's corners. Purely visual (no collider, matching the bridge
 * kerbside guardrails): the lane-corridor test reserves the kerbside band,
 * and a rail the car can clip at walking pace beats an invisible wall.
 */
export interface LondonGuardrail {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw of the run's long axis. */
  readonly headingDeg: number;
  readonly lengthM: number;
}

const rail = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
  lengthM: number,
): LondonGuardrail => ({ id, position: { x, z }, headingDeg, lengthM });

/**
 * Solver-placed (scratchpad `rails.mjs`): an 8 m run on each kerb of every
 * roundabout approach, starting 7 m out from the arm node, just past the
 * kerb, validated clear of lanes, beacons, furniture and parked cars — the
 * treatment that turns the circuses' bare paved aprons into junctions.
 */
export const LONDON_GUARDRAILS: readonly LondonGuardrail[] = [
  rail("london-rail-sloane-kings-road-r", 224.5, -205.2, 260, 8),
  rail("london-rail-sloane-kings-road-l", 226.3, -215.5, 260, 8),
  rail("london-rail-sloane-smith-street-r", 241.5, -228.2, 204, 8),
  rail("london-rail-sloane-smith-street-l", 249.4, -231.8, 204, 8),
  rail("london-rail-sloane-sydney-street-r", 266.4, -186.6, 30, 8),
  rail("london-rail-sloane-sydney-street-l", 258.7, -182.2, 30, 8),
  rail("london-rail-sloane-buckingham-palace-road-r", 275.5, -212.1, 76, 8),
  rail("london-rail-sloane-buckingham-palace-road-l", 272.8, -201.7, 76, 8),
  rail("london-rail-wellington-knightsbridge-r", 587.0, 225.8, 270, 8),
  rail("london-rail-wellington-knightsbridge-l", 587.0, 214.3, 270, 8),
  rail("london-rail-wellington-park-lane-r", 628.6, 253.0, 360, 8),
  rail("london-rail-wellington-park-lane-l", 613.9, 253.0, 360, 8),
  rail("london-rail-wellington-piccadilly-r", 652.5, 228.2, 66, 8),
  rail("london-rail-wellington-piccadilly-l", 647.8, 238.7, 66, 8),
  rail("london-rail-wellington-grosvenor-r", 608.7, 188.6, 191, 8),
  rail("london-rail-wellington-grosvenor-l", 619.2, 186.6, 191, 8),
  rail("london-rail-victoria-grosvenor-r", 571.8, -35.1, 14, 8),
  rail("london-rail-victoria-grosvenor-l", 561.4, -32.5, 14, 8),
  rail("london-rail-victoria-buckingham-palace-road-r", 537.3, -76.5, 215, 8),
  rail("london-rail-victoria-buckingham-palace-road-l", 546.2, -82.6, 215, 8),
  rail("london-rail-victoria-mall-r", 587.5, -63.3, 84, 8),
  rail("london-rail-victoria-mall-l", 586.4, -51.9, 84, 8),
  rail("london-rail-bank-bishopsgate-r", 1183.8, 151.2, 357, 8),
  rail("london-rail-bank-bishopsgate-l", 1172.3, 150.6, 357, 8),
  rail("london-rail-bank-king-william-r", 1180.2, 88.3, 168, 8),
  rail("london-rail-bank-king-william-l", 1190.6, 90.6, 168, 8),
  rail("london-rail-bank-cornmarket-r", 1153.8, 133.2, 304, 8),
  rail("london-rail-bank-cornmarket-l", 1148.5, 125.2, 304, 8),
  rail("london-rail-bank-leadenhall-r", 1210.4, 112.5, 96, 8),
  rail("london-rail-bank-leadenhall-l", 1211.5, 122.2, 96, 8),
  rail("london-rail-islington-oxford-street-r", 1126.0, 705.8, 270, 8),
  rail("london-rail-islington-oxford-street-l", 1126.0, 694.3, 270, 8),
  rail("london-rail-islington-upper-street-r", 1157.9, 723.2, 7, 8),
  rail("london-rail-islington-upper-street-l", 1147.3, 724.5, 7, 8),
  rail("london-rail-islington-bishopsgate-r", 1146.7, 675.3, 171, 8),
  rail("london-rail-islington-bishopsgate-l", 1158.0, 677.0, 171, 8),
  rail("london-rail-parliament-whitehall-r", 759.5, -264.1, 23, 8),
  rail("london-rail-parliament-whitehall-l", 748.9, -259.6, 23, 8),
  rail("london-rail-parliament-bridge-street-r", 753.8, -330.8, 150, 8),
  rail("london-rail-parliament-bridge-street-l", 763.7, -325.0, 150, 8),
  rail("london-rail-parliament-victoria-street-r", 704.2, -286.2, 279, 8),
  rail("london-rail-parliament-victoria-street-l", 702.3, -297.6, 279, 8),
];
