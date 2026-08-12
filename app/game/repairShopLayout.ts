/**
 * The auto repair shop's layout, as pure numbers.
 *
 * `GameCanvas` owns the Babylon meshes; this module owns where they go — the
 * same split as `cockpitLayout.ts`, and for the same reason: the shape can then
 * be checked without standing up an engine, a scene and a city first.
 *
 * Unlike every other service building, this one is **authored rather than
 * imported**. No free low-poly auto shop with a drivable bay exists (Poly
 * Pizza's only garage is a 13x15 m rural oak cart barn whose roof is a single
 * mesh spanning both wings; Kenney's industrial kit is solid blocks). Authoring
 * it buys the one thing a downloaded model could not guarantee: a bay mouth
 * provably wide enough for the widest vehicle in the game.
 *
 * That has a second payoff worth protecting. The gas station's colliders are
 * hand-measured off its glb into `GAS_STATION_SOLIDS_M`, so the wall you see
 * and the wall that stops you are two numbers that can drift. Here they are one
 * number: `REPAIR_SHOP_PARTS` draws the building, `REPAIR_SHOP_SOLIDS_M` is
 * derived from the same constants, and `tests/repairShopLayout.test.ts` pins
 * that every collider sits inside something you can actually see.
 *
 * **Frame.** The same one `propFootprints.ts` documents for the measured
 * models: a holder rotated by the service yaw offset at heading 0, so `+z` runs
 * along the facade and **the road lies on the `-x` side**. The origin is the
 * centre of the bay floor — not the centre of the building — because the bay is
 * what the gameplay measures against. `y` is metres above the road.
 *
 * Nothing here imports Babylon, and nothing here may.
 */

/** An axis-aligned box in the shop's own frame, metres. */
export interface RepairShopBox {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** What a drawn part is made of; the renderer maps these to materials. */
export type RepairShopSurface =
  | "shell"
  | "trim"
  | "floor"
  | "apron"
  | "door"
  | "glass"
  | "shutter";

export interface RepairShopPart extends RepairShopBox {
  readonly surface: RepairShopSurface;
}

// --- The one constraint the whole building is sized around --------------------
//
// The widest player capsule is the delivery van's: `playerCapsuleRadiusM: 1.05`,
// `playerCapsuleHalfLengthM: 1.45` (career.ts), i.e. a 2.1 x 5.0 m swept box.
// `tests/staticColliders.test.ts` judges a space drivable at >= 1.05 m of
// clearance from the centreline, which a 4.2 m corridor meets by exactly zero.
// So the bay is cut at 4.6 m clear, leaving 1.25 m either side of a centred van,
// and 6.4 m deep, which holds the van's 5 m with room to stop badly.

/** Clear width of the bay mouth and the bay itself. */
export const REPAIR_SHOP_BAY_CLEAR_WIDTH_M = 4.6;
/** Clear depth from the mouth to the inner face of the back wall. */
export const REPAIR_SHOP_BAY_CLEAR_DEPTH_M = 6.4;
/**
 * Headroom in the bay — the underside of the lowest thing over it, which is the
 * rolled-up shutter drum rather than the lintel or the roof. A van stands about
 * 2.4 m, so this clears one with a roof rack. Declared rather than derived so
 * the parts can be laid out against it, and pinned against the parts by
 * `tests/repairShopLayout.test.ts` so the two can never drift.
 */
export const REPAIR_SHOP_BAY_CLEAR_HEIGHT_M = 3.6;

/** Thickness of the blank flank and the back wall. */
const WALL_M = 0.35;
/** Width of the office block that flanks the bay on the `+z` side. */
const OFFICE_WIDTH_M = 2.45;
/** Underside of the lintel: the shutter drum stows between here and the head. */
const SHUTTER_TOP_Y = REPAIR_SHOP_BAY_CLEAR_HEIGHT_M + 0.35;
/** Top of the opening's head, and the springing line of the roof. */
const HEAD_Y = SHUTTER_TOP_Y + 0.35;
/** Height of the office block and of the fascia band over the bay. */
const PARAPET_Y = HEAD_Y + 1.1;

const bayHalfWidth = REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2; // 2.3
const bayHalfDepth = REPAIR_SHOP_BAY_CLEAR_DEPTH_M / 2; // 3.2

/** `x` of the bay mouth (the open face, nearest the road). */
export const REPAIR_SHOP_MOUTH_X = -bayHalfDepth;
/** `x` of the inner face of the back wall. */
export const REPAIR_SHOP_BACK_INNER_X = bayHalfDepth;
/** `x` of the outer face of the back wall — the deepest point of the building. */
export const REPAIR_SHOP_BACK_OUTER_X = bayHalfDepth + WALL_M;
/** `z` of the blank flank's outer face. */
export const REPAIR_SHOP_FLANK_Z = -(bayHalfWidth + WALL_M);
/** `z` of the office's outer face. */
export const REPAIR_SHOP_OFFICE_Z = bayHalfWidth + OFFICE_WIDTH_M;

/**
 * Where the car has to stop for the repair prompt, in the shop's frame.
 *
 * The bay floor's centre, so a car that has driven in is measured to the middle
 * of the space it is standing in. Deliberately NOT the building's centre, which
 * sits inside the office.
 */
export const REPAIR_SHOP_BAY_OFFSET_M = Object.freeze({ x: 0, z: 0 });

/**
 * How close to the bay centre the car must be for the prompt to appear.
 *
 * Sized just under the bay's own half-depth (3.2 m), so the reach can never
 * spill out of the mouth onto the apron and offer a repair from the pavement.
 * A car straddling the mouth still qualifies, which is deliberate: the scene is
 * staged entirely from the car's own pose, so it plays correctly wherever the
 * car actually stopped — including nose-out. A containment test instead would
 * leave players unable to trigger a prompt they can plainly see.
 */
export const REPAIR_BAY_REACH_M = 3.0;

/**
 * Depth of the paved apron drawn in front of the mouth, out toward the road.
 *
 * Kept short on purpose. The lot is a square (that is what the block carve and
 * the kerb measurement consume), so every metre of apron widens the lot on all
 * four sides — and the sites left in South Kensington and Setagaya are tight.
 * The setback already brings the mouth up near the pavement, so the apron only
 * has to bridge the verge rather than be a forecourt.
 */
const APRON_DEPTH_M = 1.6;

/**
 * The shop's solid shell: the blank flank, the back wall, and the office block.
 *
 * **The bay is not here, and that is the whole design.** Three boxes wall it on
 * three sides and the mouth is left open, so the car rolls in and stops on the
 * bay floor — the same trick that lets a car onto a gas-station forecourt,
 * where the lot slab is drivable and only the shop and pump islands are solid.
 *
 * `y` is carried for the drawn parts' benefit; the collider builder is 2D and
 * uses only the `x`/`z` extents.
 */
export const REPAIR_SHOP_SOLIDS_M: readonly RepairShopBox[] = Object.freeze([
  {
    id: "flank",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_OUTER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: -bayHalfWidth,
  },
  {
    id: "back",
    minX: REPAIR_SHOP_BACK_INNER_X,
    maxX: REPAIR_SHOP_BACK_OUTER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },
  // The party wall and the office are one box: nothing can drive between them,
  // so splitting them would be two colliders describing one obstacle.
  {
    id: "office",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_INNER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: bayHalfWidth,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },
]);

/**
 * Every box the renderer draws, in build order.
 *
 * The three solids appear here too — a collider with no part would be an
 * invisible wall, which `tests/repairShopLayout.test.ts` forbids. The rest is
 * dressing that stands clear of the bay: the roof and fascia are above the
 * clear height, the shutter is tucked up under the lintel, and the apron and
 * floor are flat to the ground.
 */
export const REPAIR_SHOP_PARTS: readonly RepairShopPart[] = Object.freeze([
  // Ground. The apron runs from the mouth out toward the road so the building
  // meets the pavement on paving rather than on grass.
  {
    id: "apron",
    surface: "apron",
    minX: REPAIR_SHOP_MOUTH_X - APRON_DEPTH_M,
    maxX: REPAIR_SHOP_MOUTH_X,
    minY: 0.05,
    maxY: 0.07,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },
  {
    id: "bay-floor",
    surface: "floor",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_INNER_X,
    minY: 0.05,
    maxY: 0.07,
    minZ: -bayHalfWidth,
    maxZ: bayHalfWidth,
  },

  // The shell. These three mirror REPAIR_SHOP_SOLIDS_M exactly.
  {
    id: "flank",
    surface: "shell",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_OUTER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: -bayHalfWidth,
  },
  {
    id: "back",
    surface: "shell",
    minX: REPAIR_SHOP_BACK_INNER_X,
    maxX: REPAIR_SHOP_BACK_OUTER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },
  {
    id: "office",
    surface: "shell",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_INNER_X,
    minY: 0,
    maxY: PARAPET_Y,
    minZ: bayHalfWidth,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },

  // Everything over the bay stacks upward from the clear height, so the lowest
  // thing a van can meet is the shutter drum and nothing else ever intrudes.
  //
  // The roller shutter, drawn stowed in the head of the opening — the shop is
  // open. It is the lowest of the three, which is what makes the clear height
  // the clear height.
  {
    id: "shutter",
    surface: "shutter",
    minX: REPAIR_SHOP_MOUTH_X + 0.05,
    maxX: REPAIR_SHOP_MOUTH_X + 0.28,
    minY: REPAIR_SHOP_BAY_CLEAR_HEIGHT_M,
    maxY: SHUTTER_TOP_Y,
    minZ: -bayHalfWidth,
    maxZ: bayHalfWidth,
  },
  // The lintel across the head, so the mouth reads as a doorway rather than a
  // missing wall.
  {
    id: "lintel",
    surface: "trim",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_MOUTH_X + 0.3,
    minY: SHUTTER_TOP_Y,
    maxY: HEAD_Y,
    minZ: -bayHalfWidth,
    maxZ: bayHalfWidth,
  },
  {
    id: "bay-roof",
    surface: "shell",
    minX: REPAIR_SHOP_MOUTH_X,
    maxX: REPAIR_SHOP_BACK_INNER_X,
    minY: HEAD_Y,
    maxY: HEAD_Y + 0.3,
    minZ: -bayHalfWidth,
    maxZ: bayHalfWidth,
  },
  // The fascia band over the mouth: the parapet the shop's name is lettered on.
  {
    id: "fascia",
    surface: "trim",
    minX: REPAIR_SHOP_MOUTH_X - 0.18,
    maxX: REPAIR_SHOP_MOUTH_X,
    minY: HEAD_Y,
    maxY: PARAPET_Y,
    minZ: REPAIR_SHOP_FLANK_Z,
    maxZ: REPAIR_SHOP_OFFICE_Z,
  },

  // The office front: a door and a window onto the apron.
  {
    id: "office-door",
    surface: "door",
    minX: REPAIR_SHOP_MOUTH_X - 0.08,
    maxX: REPAIR_SHOP_MOUTH_X + 0.02,
    minY: 0.07,
    maxY: 2.15,
    minZ: bayHalfWidth + 0.45,
    maxZ: bayHalfWidth + 1.4,
  },
  {
    id: "office-window",
    surface: "glass",
    minX: REPAIR_SHOP_MOUTH_X - 0.08,
    maxX: REPAIR_SHOP_MOUTH_X + 0.02,
    minY: 1.1,
    maxY: 2.5,
    minZ: bayHalfWidth + 1.65,
    maxZ: REPAIR_SHOP_OFFICE_Z - 0.3,
  },
]);

/** The building's plan bounds, apron included — what the lot has to cover. */
export function repairShopPlanBounds(): {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of REPAIR_SHOP_PARTS) {
    if (part.minX < minX) minX = part.minX;
    if (part.maxX > maxX) maxX = part.maxX;
    if (part.minZ < minZ) minZ = part.minZ;
    if (part.maxZ > maxZ) maxZ = part.maxZ;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Half-extent of the shop's lot — the square a street-wall building may never
 * stand inside (the job `GAS_STATION_SLAB_HALF_M` does for the station) and
 * the square measured against the kerb.
 *
 * **Derived from what is actually drawn, not declared.** A hand-picked figure
 * that fell short of the apron would let the shared building plan seat a
 * street-wall building inside ground the shop's own apron actually occupies —
 * a wall inside a wall, invisible until a car stopped dead on open paving.
 */
export const REPAIR_SHOP_LOT_HALF_M = (() => {
  const bounds = repairShopPlanBounds();
  return Math.max(
    Math.abs(bounds.minX),
    Math.abs(bounds.maxX),
    Math.abs(bounds.minZ),
    Math.abs(bounds.maxZ),
  );
})();
