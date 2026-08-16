import type { TransformNode } from "@babylonjs/core";
import { NYC_VENDORS } from "../buildingSets";
import {
  LONDON_PARKED_CARS,
  LONDON_STREET_FURNITURE,
} from "../londonStreetFurniture";
import { TOKYO_STREET_FURNITURE_POINTS } from "../tokyoStreetFurniture";
import type { GameCanvasPoint } from "../sessionContract";
import { resolveMapVisualKey, type PropKindConfig } from "../visuals";

/**
 * Hand-placed London street furniture, the destructible-prop catalogue (what
 * breaks, how, and the broad-phase grid it breaks in), the ambient/scenario
 * crowd config and clothing palettes, and each city's roadside dressing kinds.
 *
 * Pure data — no Babylon. `roadsidePropKindsForMap` and
 * `crowdClothingPaletteForMap` are the only functions; everything else is a
 * catalogue entry or lookup table read by the render/session code that places
 * these props and crowd members.
 */

export const LONDON_LAMP_POSITIONS: readonly (readonly [number, number])[] = [
  [-83, -52],
  [-50, -52],
  [-2, -52],
  [25, -52],
  [28, 2],
  [56, 18],
  [28, 60],
  [56, 72],
];

export const LONDON_BOLLARD_POSITIONS: readonly (readonly [number, number])[] = [
  -2, 22, 46, 70,
].flatMap((z) => [
  [32, z] as const,
  [52, z] as const,
]);

export const LONDON_PLANTER_POSITIONS: readonly (readonly [number, number])[] = [
  [57, -8],
  [57, 36],
  [57, 68],
];

/** Hand-placed London furniture that scattered props must avoid. Pillar
 * boxes and telephone kiosks live in `londonStreetFurniture.ts`, which the
 * simulation adapter reads too — they are solid obstacles, not scenery. */
export const LONDON_FURNITURE_POINTS: readonly GameCanvasPoint[] = [
  ...[
    ...LONDON_LAMP_POSITIONS,
    ...LONDON_BOLLARD_POSITIONS,
    ...LONDON_PLANTER_POSITIONS,
  ].map(([x, z]) => ({ x, z })),
  ...LONDON_STREET_FURNITURE.map((item) => item.position),
  // Parked cars join the keep-out so the roadside scatter never grows a tree
  // through a bonnet. They are knockable scenery, not solid obstacles.
  ...LONDON_PARKED_CARS.map((car) => car.position),
];

/** Tokyo's own version of `LONDON_FURNITURE_POINTS` (Tokyo expansion Phase
 * 9): every hand-placed chochin post, neon sign, scramble billboard and
 * parked bicycle, so the generic roadside scatter (vending machines, utility
 * poles, trees) never lands on top of one. */
export const TOKYO_FURNITURE_POINTS: readonly GameCanvasPoint[] = TOKYO_STREET_FURNITURE_POINTS;

/**
 * Street furniture the car can knock over. Every scattered prop, vendor cart
 * and piece of hand-placed London furniture registers here; a hit scrubs the
 * player's speed via the sim's external-contact path (which is also what the
 * damage/fine layers listen to), topples or squashes the prop in place, and
 * leaves the wreckage lying for the rest of the drive. `damage: "none"` props
 * (grass tufts) are a purely visual crunch — no event, no speed change. The
 * London post box is deliberately absent: cast iron wins, it is a solid
 * obstacle in the core instead.
 */
interface DestructiblePropConfig {
  readonly radiusM: number;
  readonly speedScale: number;
  readonly damage: "none" | "light" | "medium";
  readonly noun: string;
  readonly fall: "topple" | "squash";
}

export const DESTRUCTIBLE_PROP_CONFIGS: Readonly<Record<string, DestructiblePropConfig>> = {
  tree: { radiusM: 0.5, speedScale: 0.7, damage: "medium", noun: "a street tree", fall: "topple" },
  // Absent from this table, palms were silently indestructible — an un-hittable
  // tree on a promenade full of hittable ones reads as a bug.
  palm: { radiusM: 0.5, speedScale: 0.72, damage: "medium", noun: "a palm tree", fall: "topple" },
  streetlight: { radiusM: 0.32, speedScale: 0.74, damage: "medium", noun: "a streetlight", fall: "topple" },
  "utility-pole": { radiusM: 0.35, speedScale: 0.72, damage: "medium", noun: "a utility pole", fall: "topple" },
  sign: { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a signpost", fall: "topple" },
  "oneway-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a ONE WAY sign", fall: "topple" },
  "dne-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a DO NOT ENTER sign", fall: "topple" },
  "wrongway-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a WRONG WAY sign", fall: "topple" },
  "speedlimit-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a speed limit sign", fall: "topple" },
  // Park planting and furniture. A shrub squashes rather than topples — a bush
  // hinging over on one edge looks like a felled tree, which it is not.
  shrub: { radiusM: 0.55, speedScale: 0.94, damage: "none", noun: "a shrub", fall: "squash" },
  bench: { radiusM: 0.85, speedScale: 0.86, damage: "light", noun: "a park bench", fall: "topple" },
  lamp: { radiusM: 0.3, speedScale: 0.76, damage: "medium", noun: "a park lamp", fall: "topple" },
  hydrant: { radiusM: 0.35, speedScale: 0.9, damage: "light", noun: "a fire hydrant", fall: "topple" },
  bollard: { radiusM: 0.25, speedScale: 0.92, damage: "light", noun: "a bollard", fall: "topple" },
  vending: { radiusM: 0.6, speedScale: 0.88, damage: "light", noun: "a vending machine", fall: "topple" },
  vendor: { radiusM: 1.15, speedScale: 0.85, damage: "light", noun: "a vendor cart", fall: "topple" },
  "london-lamp": { radiusM: 0.32, speedScale: 0.74, damage: "medium", noun: "a lamp post", fall: "topple" },
  "london-bollard": { radiusM: 0.25, speedScale: 0.92, damage: "light", noun: "a bollard", fall: "topple" },
  "london-planter": { radiusM: 0.58, speedScale: 0.85, damage: "light", noun: "a planter", fall: "topple" },
  // Kerbside parked cars are knockable, never solid — the lane-corridor and
  // walkable-band collider tests reserve both, and a shunted car reads better
  // than an invisible wall. Heavy to hit: half the player's speed survives.
  "london-parked-car": { radiusM: 1.2, speedScale: 0.5, damage: "medium", noun: "a parked car", fall: "topple" },
  // Tokyo expansion Phase 9 (R14). Absent from this table, a chochin post
  // would be silently indestructible — the same "palm comment" trap as
  // above. A paper lantern on a slim pole gives way easily.
  "chochin-post": { radiusM: 0.28, speedScale: 0.9, damage: "light", noun: "a lantern post", fall: "topple" },
  // The promenade's cherry tree (swaps in for Cairo's palm on Tokyo's own
  // riverside decor, `generatePromenadeDecor`'s `treeKind`) — same knockable
  // trunk-topples treatment as every other street tree.
  sakura: { radiusM: 0.5, speedScale: 0.72, damage: "medium", noun: "a cherry tree", fall: "topple" },
  // Parked bicycles: much lighter than a parked car (radius, mass and speed
  // cost all scale down accordingly) but the same knockable-never-solid rule
  // — staticColliders.test.ts reserves the kerbside for the walkable band,
  // not a rack of bikes.
  "tokyo-parked-bicycle": { radiusM: 0.45, speedScale: 0.82, damage: "light", noun: "a parked bicycle", fall: "topple" },
};

export interface DestructiblePropPart {
  readonly node: TransformNode;
  /** The streetlight's ground light pool: sinks away instead of rotating. */
  readonly isLightPool: boolean;
}

export interface DestructibleProp {
  readonly kind: string;
  readonly config: DestructiblePropConfig;
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly parts: readonly DestructiblePropPart[];
  state: "standing" | "falling" | "down";
}

export interface ActivePropFall {
  readonly prop: DestructibleProp;
  readonly pivot: TransformNode;
  readonly poolParts: readonly TransformNode[];
  progress: number;
}

/** Grid cell for the prop broad phase; must exceed the largest prop radius
 * plus the car capsule reach so a 3x3 neighbourhood always suffices. */
export const DESTRUCTIBLE_GRID_CELL_M = 8;
export const PROP_TOPPLE_SECONDS = 0.5;
export const PROP_TOPPLE_MAX_ANGLE_RAD = 1.46;
export const PROP_MIN_STRIKE_SPEED_MPS = 0.8;
/** Above this many simultaneous falls, further strikes settle instantly. */
export const PROP_MAX_ACTIVE_TOPPLES = 8;

export const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
export const PLAYER_CAPSULE_RADIUS_M = 1.0;

const PROP_TREE: PropKindConfig = {
  kind: "tree",
  spacingM: 26,
  jitterM: 8,
  lateralMarginM: 2.2,
  bothSides: true,
  variants: 3,
  minScale: 0.85,
  maxScale: 1.3,
};

const PROP_STREETLIGHT: PropKindConfig = {
  kind: "streetlight",
  spacingM: 38,
  jitterM: 6,
  lateralMarginM: 1,
  bothSides: false,
  alternateSides: true,
  variants: 1,
  faceRoad: true,
};

const PROP_SIGN: PropKindConfig = {
  kind: "sign",
  spacingM: 66,
  jitterM: 18,
  lateralMarginM: 1.2,
  bothSides: false,
  variants: 2,
  faceRoad: true,
};

// The ambient sidewalk crowd: walkers simulated on the pavement rail graph
// (crowdWalkers) inside a bubble around the player, drawn as GPU-animated thin
// instances (crowdRenderer). Counts are per map — the whole crowd costs a few
// meshes regardless, so these are set by how busy each city should feel, not
// by a draw-call budget. Radii track each map's fog: recycling happens beyond
// what the player can see. Maps absent here have no ambient crowd.
export const AMBIENT_CROWD_CONFIG: Readonly<
  Record<
    string,
    {
      count: number;
      innerRadiusM: number;
      outerRadiusM: number;
      recycleRadiusM: number;
    }
  >
> = {
  "nyc-upper-west-side": { count: 96, innerRadiusM: 25, outerRadiusM: 130, recycleRadiusM: 170 },
  // 56 -> 112 (Tokyo expansion Phase 9, R13): the village-era figure for a
  // 600x420 m quarter, unchanged through Phases 1-8 even as the map grew to
  // NYC class (2600x2400 m) — the street-life pass is what actually retunes
  // it. Radii widen to match (18/100/140 -> 22/130/170, the same figures
  // London's own crowd bump landed on for a comparable-scale map).
  //
  // 112 -> 136 (Tokyo authenticity plan P9): six new residential/mixed webs
  // (Regions A-F) landed since 112 was set, each with its own real pavement
  // network the ambient pool now has to cover too — measured lane-km grew
  // 71.9 -> 96.2 (+34%) and blocks 280 -> 421 (+50%) over the same span.
  // +24 (2-4 walkers x 6 regions, plan section 6.3's own figure) rather than
  // a fully proportional +34-50% bump: the new webs are quiet residential
  // capillaries, not downtown, so they should read as lightly populated —
  // "not dead" — not as busy as the original mixed quarter per km. World
  // size is unchanged (regions A-F filled voids inside the existing
  // 2600x2400 m bounds), so the radii stay as they are.
  "tokyo-setagaya": { count: 136, innerRadiusM: 22, outerRadiusM: 130, recycleRadiusM: 170 },
  // 64 -> 104: sixty-four walkers were right for an 800 m museum quarter and
  // read as a quiet Sunday once the map ran from Earls Court to Islington.
  // The crowd is 3-5 meshes total whatever the count — this is CPU stepping,
  // not draw calls.
  "london-south-kensington": { count: 104, innerRadiusM: 22, outerRadiusM: 130, recycleRadiusM: 170 },
  "cairo-central-nile": { count: 88, innerRadiusM: 22, outerRadiusM: 125, recycleRadiusM: 165 },
};

/** Bubble radii for scenario road users on maps with no crowd config. */
export const DEFAULT_ROAD_USER_RADII = {
  innerRadiusM: 18,
  outerRadiusM: 110,
  recycleRadiusM: 150,
};

/** Clothing tints shared by the ambient and scripted pedestrians. */
const CROWD_CLOTHING_COLORS = [
  { r: 0.82, g: 0.21, b: 0.15 },
  { r: 0.2, g: 0.35, b: 0.6 },
  { r: 0.3, g: 0.5, b: 0.35 },
  { r: 0.7, g: 0.66, b: 0.5 },
  { r: 0.55, g: 0.3, b: 0.5 },
];

const CAIRO_CROWD_CLOTHING_COLORS = [
  { r: 0.12, g: 0.16, b: 0.2 },
  { r: 0.12, g: 0.34, b: 0.37 },
  { r: 0.32, g: 0.34, b: 0.19 },
  { r: 0.76, g: 0.68, b: 0.51 },
  { r: 0.56, g: 0.25, b: 0.21 },
  { r: 0.48, g: 0.31, b: 0.43 },
] as const;

/** Contemporary warm-neutrals and deep colours for Cairo's street crowd. */
export function crowdClothingPaletteForMap(
  mapId: string,
): readonly { readonly r: number; readonly g: number; readonly b: number }[] {
  return resolveMapVisualKey(mapId) === "cairo"
    ? CAIRO_CROWD_CLOTHING_COLORS
    : CROWD_CLOTHING_COLORS;
}

/** Per-map roadside dressing: shared basics plus locally recognisable extras. */
export function roadsidePropKindsForMap(
  key: ReturnType<typeof resolveMapVisualKey>,
): readonly PropKindConfig[] {
  switch (key) {
    case "nyc":
      return [
        PROP_STREETLIGHT,
        { ...PROP_TREE, spacingM: 30 },
        {
          kind: "hydrant",
          spacingM: 58,
          jitterM: 14,
          lateralMarginM: 0.9,
          bothSides: false,
          variants: 1,
          faceRoad: true,
        },
        PROP_SIGN,
        // Street vendor carts, curbside and alternating sides. The placement is
        // computed here but the carts are glb instances (routed out of the
        // procedural-prop loop into pendingVendors), not master boxes.
        {
          // Sparser than one-per-frontage: a dumpster/cart every ~130 m curbside,
          // not outside every building (which read as unrealistic clutter).
          kind: "vendor",
          spacingM: 130,
          jitterM: 24,
          lateralMarginM: 1.4,
          bothSides: false,
          alternateSides: true,
          variants: Math.max(1, NYC_VENDORS.length),
          faceRoad: true,
        },
      ];
    case "london":
      // Street lamps are hand-placed for South Kensington; scattered props
      // stay clear of them via LONDON_FURNITURE_POINTS. 30 -> 20 m spacing
      // with the street-life pass: the reference streets keep a plane tree
      // every few doors, and the fog cap means the extra canopy is only ever
      // drawn near the car.
      return [{ ...PROP_TREE, spacingM: 20 }, PROP_SIGN];
    case "tokyo":
      return [
        // R17's light posts: NYC's config plus `curbOffsetM` — Tokyo is the
        // night map, and the owner reported whole streets pitch dark (61 of
        // 101 roads measured with a >120 m lampless interval; the downtown
        // core had ZERO lamps). Root cause: the default lateral band places
        // a lamp 1 m BEYOND the sidewalk, and this map's street wall hugs
        // the pavement edge on most roads, so `blocks.some(isInside...)`
        // rejected nearly every candidate — 3x fewer lamps than NYC from
        // the identical spacing. `curbOffsetM` seats the pole ON the
        // pavement by the kerb instead (its documented purpose), where a
        // real Japanese streetlight stands and where no street wall can
        // swallow it. 0.7 m keeps the pole (0.32 m radius) clear of both
        // the carriageway and the walker rail.
        //
        // 38 -> 24 m spacing (owner: "not enough street lights", then "I'd
        // prefer an alternating pattern"): the density bump must live in
        // THIS pass, not a second appended streetlight pass — two
        // independent passes each carry their own side toggle and phase, so
        // their union produced same-side pairs and face-to-face pairs
        // instead of the strict left-gap-right-gap rhythm one alternating
        // walk gives (a rejected candidate still flips the toggle, so
        // rejections leave gaps, never same-side pairs). Retuning spacing
        // here re-dealt every kind below once (the P9 trap, accepted
        // deliberately in that change); keep any FUTURE additions appended
        // after the last kind so the stream stays aligned.
        { ...PROP_STREETLIGHT, curbOffsetM: 0.7, spacingM: 24, jitterM: 5 },
        {
          kind: "utility-pole",
          spacingM: 32,
          jitterM: 5,
          lateralMarginM: 0.9,
          bothSides: false,
          alternateSides: true,
          variants: 1,
          faceRoad: true,
        },
        {
          // 74 -> 48 m (Tokyo expansion Phase 9): konbini country wants a
          // machine every couple of storefronts, not one every third block.
          // Re-measured against the now-much-more-occupied roadside ground
          // (Phase 4's blocks + Phase 7's venues both reject scatter
          // candidates that land inside them) rather than trusted blind —
          // see the PR for the real placement count this produced.
          kind: "vending",
          spacingM: 48,
          jitterM: 14,
          lateralMarginM: 1,
          bothSides: false,
          variants: 2,
          faceRoad: true,
        },
        // 34 -> 36 m (Tokyo expansion Phase 9): a small retune alongside the
        // vending/crowd bump, not a density change of its own.
        { ...PROP_TREE, spacingM: 36, minScale: 0.7, maxScale: 1 },
        PROP_SIGN,
      ];
    case "cairo":
      return [
        { ...PROP_STREETLIGHT, spacingM: 36, jitterM: 7 },
        { ...PROP_TREE, spacingM: 54, minScale: 0.8, maxScale: 1.15 },
        {
          kind: "palm",
          spacingM: 68,
          jitterM: 16,
          lateralMarginM: 1.2,
          bothSides: false,
          alternateSides: true,
          variants: 2,
          minScale: 0.85,
          maxScale: 1.2,
          faceRoad: true,
        },
        {
          kind: "bollard",
          spacingM: 42,
          jitterM: 9,
          lateralMarginM: 0.8,
          bothSides: false,
          variants: 1,
        },
        // Nothing parks at the Cairo kerb: the parked cars, microbuses, vendor
        // carts and scooters that used to are all gone. They were scattered on
        // road geometry alone, so they landed wherever the band allowed rather
        // than where a vehicle would plausibly stand — clutter dumped on the
        // pavement, not a parked street. The box-built ones were also badly
        // modelled (the scooter's handlebar floated free of its frame). Any
        // future kerb parking wants real placement, not scatter.
        { ...PROP_SIGN, spacingM: 78, variants: 2 },
      ];
  }
}
