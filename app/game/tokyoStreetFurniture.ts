import type { WorldPoint } from "./types";

/**
 * Tokyo's hand-placed street furniture (Tokyo expansion Phase 9, R14): the
 * shotengai/station chochin (paper-lantern) posts, the downtown neon sign
 * boards and scramble billboards, and the parked-bicycle table — the same
 * shape as `londonStreetFurniture.ts`'s pillar boxes / phone boxes / parked
 * cars, for the same reason: a table both the renderer
 * (`render/tokyoLandmarks.ts`'s `buildTokyoStreetFurniture`,
 * `render/babylonGameSession.ts`'s bicycle instancing) and the roadside-
 * scatter keep-out (`render/propCatalog.ts`'s `TOKYO_FURNITURE_POINTS`) read
 * once, so the two can never drift apart.
 *
 * Every position here was solver-checked against the real built map
 * (`TOKYO_MAP_PACK`'s blocks/landmarks/water/lane graph) with a scratchpad
 * script, never eyeballed — chochin posts and neon boards against block/
 * landmark/water containment and every intersecting carriageway;
 * parked bicycles by the full `LONDON_PARKED_CARS` methodology at bicycle
 * scale (see that table's own header): clear of every lane centreline by a
 * bicycle's own envelope (much less than a car's 2.6 m), >= 18 m from every
 * junction node, clear of blocks/landmarks/water/chochin posts, thinned to
 * roughly half of the eligible slots, and clustered (bikes rack close
 * together in real life, unlike kerb-parked cars) rather than spread at
 * car-parking rhythm.
 */

const at = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
): { readonly id: string; readonly position: WorldPoint; readonly headingDeg: number } => ({
  id,
  position: { x, z },
  headingDeg,
});

/**
 * A chochin (paper lantern) post: pole + warm emissive lantern, procedural
 * (`render/tokyoLandmarks.ts` and, for the promenade's own automatic
 * placements, `render/roadsideProps.ts`'s `partsFor` build the same
 * dimensions independently — see either file's own comment on why that
 * duplication is this repo's normal house style, not an oversight).
 * Knockable (`DESTRUCTIBLE_PROP_CONFIGS["chochin-post"]`), never solid.
 */
export interface TokyoChochinPost {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw; unused by the geometry (the post/lantern are
   * rotationally symmetric) but carried for consistency with every other
   * placement table and in case a future non-symmetric fixture wants it. */
  readonly headingDeg: number;
}

/**
 * Nine posts along Nakamise Yokochō (the shotengai), alternating sides every
 * ~24 m, standing just past the shared-space pavement's outer edge (half the
 * road's 5.8 m width + its 1.4 m pavement + 0.5 m clearance = 4.8 m off the
 * centreline) — verified clear of every flanking block and cross street. The
 * row deliberately breaks at Niban-dōri instead of putting a lantern in that
 * road's turning envelope. Six more along
 * Ekimae-dōri's western stretch (the station-front approach), north side
 * only (checked clear of Hoshi Mart Ekimae's own block; the south side sits
 * tighter there).
 */
export const TOKYO_CHOCHIN_POSTS: readonly TokyoChochinPost[] = [
  at("jp-chochin-yokocho-1", 205, 44.8, 180),
  at("jp-chochin-yokocho-2", 229, 35.2, 0),
  at("jp-chochin-yokocho-3", 253, 44.8, 180),
  at("jp-chochin-yokocho-4", 277, 35.2, 0),
  // Sequence position 5 would be (301, 44.8), only 1 m from Niban-dōri's
  // centreline at its Nakamise crossing. Leave the intersection open.
  at("jp-chochin-yokocho-6", 325, 35.2, 0),
  at("jp-chochin-yokocho-7", 349, 44.8, 180),
  at("jp-chochin-yokocho-8", 373, 35.2, 0),
  at("jp-chochin-yokocho-9", 397, 44.8, 180),
  at("jp-chochin-yokocho-10", 421, 35.2, 0),
  at("jp-chochin-ekimae-1", 165, 147.1, 270),
  at("jp-chochin-ekimae-2", 187, 147.1, 270),
  at("jp-chochin-ekimae-3", 209, 147.1, 270),
  at("jp-chochin-ekimae-4", 231, 147.1, 270),
  at("jp-chochin-ekimae-5", 253, 147.1, 270),
  at("jp-chochin-ekimae-6", 275, 147.1, 270),
  // Street life pass (P9): the shotengai vocabulary's one extension into the
  // new districts — Region B's own shopping street (`jp-ekimae-nishi-dori`,
  // `tokyo-shotengai`-zoned, plan section 6.3's "extend into the new
  // districts"), north kerb only (the wired hero run below already dresses
  // the south kerb — see TOKYO_WIRE_RUNS's own comment on why both read as
  // one streetscape rather than doubled-up clutter). Solver-checked
  // (scratchpad, the same `TOKYO_MAP_PACK` block-clearance methodology this
  // table's own header describes): 35 m spacing along the road's real
  // centreline, 6.2 m off it (half the 7 m carriageway + the 2.2 m pavement
  // + 0.5 m clearance, this road's own analogue of Nakamise's "4.8 m off a
  // 5.8 m road" figure), every point >= 1.5 m clear of the nearest block
  // edge and >= 10 m from every venue on this street (jp-v46/48/49/50).
  at("jp-chochin-ekimae-nishi-1", -409.6, 399.6, 180),
  at("jp-chochin-ekimae-nishi-2", -374.9, 395.1, 0),
  at("jp-chochin-ekimae-nishi-3", -340.2, 390.5, 180),
  at("jp-chochin-ekimae-nishi-4", -305.5, 386.0, 0),
  at("jp-chochin-ekimae-nishi-5", -270.8, 381.4, 180),
  at("jp-chochin-ekimae-nishi-6", -236.1, 376.9, 0),
  at("jp-chochin-ekimae-nishi-7", -201.4, 372.3, 180),
  at("jp-chochin-ekimae-nishi-8", -166.7, 367.8, 0),
  at("jp-chochin-ekimae-nishi-9", -132.0, 363.2, 180),
  at("jp-chochin-ekimae-nishi-10", -97.3, 358.7, 0),
  at("jp-chochin-ekimae-nishi-11", -62.6, 354.1, 180),
];

/**
 * A vertical neon sign board: a thin emissive box mounted a little proud of
 * a downtown facade, at a bracket-mounted "kanban" height rather than street
 * level — never destructible (it hangs above the reachable band, the same
 * reasoning `render/proceduralTextures.ts`'s facade window glow and this
 * file's own billboards are never destructible). `variant` selects one of a
 * handful of shared emissive colours built once in
 * `render/tokyoLandmarks.ts`, never a per-instance material.
 */
export interface TokyoNeonSign {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw the panel's face points — away from the block it hangs
   * on, toward the carriageway. */
  readonly headingDeg: number;
  readonly variant: number;
  /** Mount height to the panel's own centre. */
  readonly heightM: number;
}

/**
 * Shared geometry for Chūō-dōri's facade-mounted kanban. The authored sign
 * centres sit 9.8 m off the road centreline while the real block faces vary
 * from roughly 11.5–12.6 m, so the arms deliberately reach 3 m back into the
 * facade. A dark housing keeps the narrow edge from blooming like a floating
 * light rod; only the road-facing inset panel is emissive.
 */
export const TOKYO_NEON_SIGN_GEOMETRY = Object.freeze({
  panelWidthM: 1.3,
  panelHeightM: 3,
  panelDepthM: 0.02,
  housingWidthM: 1.5,
  housingHeightM: 3.2,
  housingDepthM: 0.14,
  facadeArmReachM: 3,
  facadeArmThicknessM: 0.08,
  facadeArmYOffsetsM: Object.freeze([-1.1, 1.1] as const),
  // Wide enough to bridge the narrow frontage seam behind jp-neon-chuo-3;
  // the arms meet this vertical plate instead of requiring their 8 cm axes
  // to land on one exact facade model.
  facadePlateWidthM: 0.8,
  facadePlateHeightM: 2.5,
  facadePlateDepthM: 0.08,
});

/**
 * Chūō-dōri's downtown stretch (the tallest, densest zone,
 * `TOKYO_ROAD_STYLE_OVERRIDE["jp-chuo-dori"]`), both flanks, six along-road
 * stations each — checked clear of every flanking block at 9.8 m off the
 * centreline (the 4-lane road's own half-width 6.8 m + 3 m, inside the
 * pavement gap ahead of the real block face at ~11.5-12.6 m). The renderer's
 * 3 m facade arms bridge that whole variable gap. Heights alternate low/high
 * so the corridor reads as layered signage, not one shelf.
 */
export const TOKYO_NEON_SIGNS: readonly TokyoNeonSign[] = [
  { id: "jp-neon-chuo-1", position: { x: 449.8, z: -130 }, headingDeg: 270, variant: 0, heightM: 4.5 },
  { id: "jp-neon-chuo-2", position: { x: 430.2, z: -130 }, headingDeg: 90, variant: 1, heightM: 7.2 },
  { id: "jp-neon-chuo-3", position: { x: 449.8, z: -80 }, headingDeg: 270, variant: 2, heightM: 6.0 },
  { id: "jp-neon-chuo-4", position: { x: 430.2, z: -80 }, headingDeg: 90, variant: 3, heightM: 4.8 },
  { id: "jp-neon-chuo-5", position: { x: 449.8, z: -20 }, headingDeg: 270, variant: 1, heightM: 5.4 },
  { id: "jp-neon-chuo-6", position: { x: 430.2, z: -20 }, headingDeg: 90, variant: 0, heightM: 7.6 },
  { id: "jp-neon-chuo-7", position: { x: 449.8, z: 70 }, headingDeg: 270, variant: 3, heightM: 4.6 },
  { id: "jp-neon-chuo-8", position: { x: 430.2, z: 70 }, headingDeg: 90, variant: 2, heightM: 6.8 },
  { id: "jp-neon-chuo-9", position: { x: 449.8, z: 190 }, headingDeg: 270, variant: 0, heightM: 5.8 },
  { id: "jp-neon-chuo-10", position: { x: 430.2, z: 190 }, headingDeg: 90, variant: 1, heightM: 4.4 },
  { id: "jp-neon-chuo-11", position: { x: 449.8, z: 260 }, headingDeg: 270, variant: 2, heightM: 7.0 },
  { id: "jp-neon-chuo-12", position: { x: 430.2, z: 260 }, headingDeg: 90, variant: 3, heightM: 5.2 },
];

/**
 * A large billboard panel facing the scramble (Chūō-dōri x Ekimae-dōri,
 * `TOKYO_SCRAMBLE_NODE_ID` in `cities/tokyo.ts`) — the Shibuya-crossing
 * read. Two, on diagonally opposite corners so a driver approaching from
 * any of the four arms sees one face-on. Mounted well above the reachable
 * band; never destructible, never a collider (the corner blocks it hangs
 * off already provide the real collision).
 */
export interface TokyoScrambleBillboard {
  readonly id: string;
  readonly position: WorldPoint;
  readonly headingDeg: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly mountHeightM: number;
}

export const TOKYO_SCRAMBLE_BILLBOARDS: readonly TokyoScrambleBillboard[] = [
  { id: "jp-billboard-scramble-ne", position: { x: 451, z: 155 }, headingDeg: 225, widthM: 9, heightM: 5, mountHeightM: 13 },
  { id: "jp-billboard-scramble-sw", position: { x: 429, z: 125 }, headingDeg: 45, widthM: 9, heightM: 5, mountHeightM: 13 },
];

/** The four bicycle-scale glbs a parked bike may use — today there is only
 * one bicycle model in the repo (`characterMeshes.ts`'s `BICYCLE_MODEL`), so
 * this is a single-entry union kept for symmetry with
 * `LondonParkedCarModel` and to make a future second bike model a type-safe
 * addition rather than a magic string. */
export type TokyoParkedBicycleModel = "bicycle";

/**
 * A kerbside parked bicycle — the `LONDON_PARKED_CARS` recipe at bicycle
 * scale. **Knockable, never solid**: same reasoning as every other kerb
 * decoration in this repo (`DESTRUCTIBLE_PROP_CONFIGS["tokyo-parked-
 * bicycle"]`), registered by `render/babylonGameSession.ts`'s Tokyo build
 * branch, never the adapter's static-obstacle builder.
 */
export interface TokyoParkedBicycle {
  readonly id: string;
  readonly position: WorldPoint;
  /** Clockwise yaw; a bike stands broadside to its kerb, front along the
   * street the way a real bicycle rack row does. */
  readonly headingDeg: number;
  readonly model: TokyoParkedBicycleModel;
}

const parked = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
): TokyoParkedBicycle => ({ id, position: { x, z }, headingDeg, model: "bicycle" });

/**
 * Solver-placed (scratchpad `p9-final.mjs`), never eyeballed: every position
 * clears every lane centreline by >= 1.4 m beyond the carriageway edge (a
 * bicycle's own envelope, well under a car's 2.6 m), stands >= 18 m from
 * every junction node, is clear of every block/landmark/water polygon and
 * every `TOKYO_CHOCHIN_POST` (>= 3 m), keeps >= 1.8 m from its neighbours,
 * and is thinned to roughly half the eligible slots per cluster. Four
 * clusters rather than one continuous kerb line — real bicycle parking racks
 * up in short dense rows outside a specific frontage, unlike a car's
 * spread-out kerbside rhythm: two flanking Ekimae-dōri's station-front
 * stretch, two more along the shotengai.
 */
export const TOKYO_PARKED_BICYCLES: readonly TokyoParkedBicycle[] = [
  // Station front (Ekimae-dōri, north kerb near x 241-270).
  parked("jp-bike-1", 241.2, 146.1, 270),
  parked("jp-bike-2", 244.8, 146.1, 270),
  parked("jp-bike-3", 248.4, 146.1, 270),
  parked("jp-bike-4", 259.2, 146.1, 270),
  parked("jp-bike-5", 262.8, 146.1, 270),
  parked("jp-bike-6", 266.4, 146.1, 270),
  parked("jp-bike-7", 270.0, 146.1, 270),
  // Shotengai cluster A (south kerb, x 243-272).
  parked("jp-bike-8", 243.0, 35.5, 90),
  parked("jp-bike-9", 246.6, 35.5, 90),
  parked("jp-bike-10", 250.2, 35.5, 90),
  parked("jp-bike-11", 253.8, 35.5, 90),
  parked("jp-bike-12", 257.4, 35.5, 90),
  parked("jp-bike-13", 261.0, 35.5, 90),
  parked("jp-bike-14", 264.6, 35.5, 90),
  parked("jp-bike-15", 268.2, 35.5, 90),
  parked("jp-bike-16", 271.8, 35.5, 90),
  // Shotengai cluster B (north kerb, x 322-343, outside Yokocho Grocer/Hoshi
  // Mart Yokocho's own POI clearance).
  parked("jp-bike-17", 321.6, 44.5, 270),
  parked("jp-bike-18", 325.2, 44.5, 270),
  parked("jp-bike-19", 328.8, 44.5, 270),
  parked("jp-bike-20", 332.4, 44.5, 270),
  parked("jp-bike-21", 336.0, 44.5, 270),
  parked("jp-bike-22", 339.6, 44.5, 270),
  parked("jp-bike-23", 343.2, 44.5, 270),
  // Shotengai cluster C (south kerb, near the Chūō-dōri end).
  parked("jp-bike-24", 413.4, 35.5, 90),
  parked("jp-bike-25", 417.0, 35.5, 90),
  // Street life pass (P9): a small two-bike pair outside one Hoshi Mart
  // branch in each of the four newest residential districts (Hanamizu,
  // Sumiregaoka, Minamimachi, Nishi Minami — plan section 6.3's "extend...
  // into the new districts"; Ekimae-nishi already got its own treatment
  // above and Kawabata has no venue at all, plan section 6.2). Solver-placed
  // (scratchpad, the real `resolveVenuePlacement` for each venue's own
  // curbside position, never hand-estimated): each pair sits ~1.8 m either
  // side of the shop's own doorway at half its setback depth (on the
  // pavement, between the kerb and the building line), >= 1.4 m clear of
  // every lane centreline, >= 18 m from every junction node and clear of
  // every block/landmark — the same TOKYO_PARKED_BICYCLES methodology this
  // table's own header describes, just re-run for four new anchors.
  parked("jp-bike-26", -25.7, 728.0, 0), // Hoshi Mart Hanamizu (jp-v54)
  parked("jp-bike-27", -25.7, 731.6, 0),
  parked("jp-bike-28", 295.7, -226.0, 180), // Hoshi Mart Sumiregaoka (jp-v56)
  parked("jp-bike-29", 295.7, -229.6, 180),
  parked("jp-bike-30", 202.0, -965.7, 270), // Hoshi Mart Minamimachi (jp-v58)
  parked("jp-bike-31", 198.4, -965.7, 270),
  parked("jp-bike-32", -962.0, -284.2, 90), // Hoshi Mart Nishi Minami (jp-v60)
  parked("jp-bike-33", -958.4, -284.2, 90),
];

/**
 * A wired hero run: a chain of hand-placed utility poles carrying a
 * catenary-sagged cable strung between every consecutive pair — the plan's
 * "wired hero runs" (section 6.3), deliberately confined to 2 named streets
 * only (global wiring is out of scope). Each pole reuses the roadside
 * scatter's own knockable `"utility-pole"` silhouette and destructible
 * config (`DESTRUCTIBLE_PROP_CONFIGS["utility-pole"]`) — same fixture, just
 * hand-placed here instead of scattered — so the procedural scatter's own
 * poles elsewhere on the map and these read as one continuous species, not
 * two different kinds of pole. Rendered by
 * `render/tokyoLandmarks.ts`'s `buildWireRuns`.
 */
export interface TokyoWireSupport {
  readonly position: WorldPoint;
}

export interface TokyoWireRun {
  readonly id: string;
  /** Mount height (m) both the pole's own crossarm and the cable sit at —
   * matches the scattered utility-pole's own lower-arm height (6.25 m,
   * `render/roadsideProps.ts`), so a run reads as strung from the same kind
   * of fixture the rest of the street already has. */
  readonly supportHeightM: number;
  /** Cable droop (m) at each span's own midpoint. */
  readonly sagM: number;
  readonly supports: readonly TokyoWireSupport[];
}

const wireSupport = (x: number, z: number): TokyoWireSupport => ({ position: { x, z } });

/**
 * Two runs, per plan section 6.3: Region B's own shopping street
 * (`jp-ekimae-nishi-dori`) and one Hanamizu lane (`jp-yuri-dori`, Region A).
 * Every support solver-checked against the real `TOKYO_MAP_PACK` (scratchpad,
 * the same methodology `TOKYO_CHOCHIN_POSTS`'s own header describes): 33-35 m
 * spacing along each road's real centreline (matching the scattered
 * utility-pole's own ~32 m rhythm), one consistent kerb per run (south for
 * Ekimae Nishi-dōri — the wire run and the chochin row above deliberately
 * take opposite kerbs of the same street, not the same one twice), lateral
 * offset = half the carriageway + the pavement + 0.9 m (the scattered
 * utility-pole's own `lateralMarginM`, so a hand-placed pole stands exactly
 * where a scattered one would), every support >= 1.5 m clear of the nearest
 * block edge. Each run covers its street's own busiest core stretch (where
 * the venues actually are), not the full road — a hero accent, not blanket
 * coverage, the same scale `TOKYO_CHOCHIN_POSTS`'s own Nakamise/Ekimae rows
 * already set.
 */
export const TOKYO_WIRE_RUNS: readonly TokyoWireRun[] = [
  {
    id: "jp-wire-ekimae-nishi",
    supportHeightM: 6.25,
    sagM: 0.7,
    supports: [
      wireSupport(-411.8, 387.0),
      wireSupport(-379.1, 382.7),
      wireSupport(-346.3, 378.4),
      wireSupport(-313.6, 374.1),
      wireSupport(-280.9, 369.9),
      wireSupport(-248.2, 365.6),
      wireSupport(-215.5, 361.3),
      wireSupport(-182.7, 357.0),
      wireSupport(-150.0, 352.7),
      wireSupport(-117.3, 348.4),
      wireSupport(-84.6, 344.1),
      wireSupport(-51.9, 339.8),
      wireSupport(-19.1, 335.5),
    ],
  },
  {
    id: "jp-wire-yuri",
    supportHeightM: 6.25,
    sagM: 0.6,
    supports: [
      wireSupport(-197.5, 743.7),
      wireSupport(-162.5, 743.7),
      wireSupport(-127.5, 743.7),
      wireSupport(-92.5, 743.7),
      wireSupport(-57.5, 743.7),
      wireSupport(-22.5, 743.7),
      wireSupport(12.5, 743.7),
      wireSupport(47.5, 743.7),
      wireSupport(82.5, 743.7),
      wireSupport(117.5, 743.7),
      wireSupport(152.5, 743.7),
      wireSupport(187.5, 743.7),
    ],
  },
];

/**
 * Every hand-placed Phase 9 furniture point, for the roadside scatter's
 * keep-out (`render/propCatalog.ts`'s `TOKYO_FURNITURE_POINTS`) — mirrors
 * `LONDON_FURNITURE_POINTS`'s own shape exactly. Neon boards/billboards are
 * elevated well above the scatter's own placements, but are included anyway
 * (cheap insurance, same as London including its post boxes) since nothing
 * about the generic scatter knows about height. Wire-run supports are
 * included so the scatter's own random utility poles never double one of
 * these hand-placed ones a few metres away.
 */
export const TOKYO_STREET_FURNITURE_POINTS: readonly WorldPoint[] = [
  ...TOKYO_CHOCHIN_POSTS.map((p) => p.position),
  ...TOKYO_NEON_SIGNS.map((p) => p.position),
  ...TOKYO_SCRAMBLE_BILLBOARDS.map((p) => p.position),
  ...TOKYO_PARKED_BICYCLES.map((p) => p.position),
  ...TOKYO_WIRE_RUNS.flatMap((run) => run.supports.map((s) => s.position)),
];
