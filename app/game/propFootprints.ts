/**
 * Measured world-space footprints of the venue/service glb models, in the
 * frame the game places them in: a holder rotated by the model's yawOffset
 * (heading 0), model scale applied, strip-pattern meshes removed — so +z runs
 * along the facade and the road lies on the -x side. Measured once under
 * NullEngine from the real glbs (the same technique tests/vehicleMeshes.test.ts
 * uses); re-measure and update if a model, its scale, or its yawOffset in
 * PROP_MODEL_REGISTRY changes — tests/staticColliders.test.ts pins the collider
 * consequences.
 *
 * These are what make a venue's collision exactly the building you can see,
 * instead of its (much larger) authored fallback footprint — which is what
 * used to stop the car an entire pavement short of a facade.
 */

export interface PropModelFootprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const PROP_MODEL_FOOTPRINTS_M: Readonly<
  Record<string, PropModelFootprint>
> = {
  restaurant: { minX: -5.23, maxX: 8.46, minZ: -5.82, maxZ: 10.04 },
  "restaurant-pizzeria": { minX: -5.85, maxX: 4.87, minZ: -5.79, maxZ: 4.84 },
  shop: { minX: -4.0, maxX: 4.0, minZ: -4.0, maxZ: 4.0 },
  // Same model and scale as `shop`; its base slab is square, so the corrected
  // yawOffset and the deleted hydrant leave the placed footprint unchanged.
  "cairo-shop": { minX: -4.0, maxX: 4.0, minZ: -4.0, maxZ: 4.0 },
  residence: { minX: -5.45, maxX: 4.61, minZ: -3.32, maxZ: 3.33 },
  "cairo-residence-kay": {
    minX: -5.5,
    maxX: 5.5,
    minZ: -5.519,
    maxZ: 5.519,
  },
  // The Cairo entries were once turned to -π/2 on an as-loaded NullEngine
  // measurement ("entrance on local +Z") — but instantiateProp wipes the
  // loader root's (1,1,-1) scaling, so the placed frame keeps only the 180°
  // Y-rotation and that turn stood every one of these venues with its back to
  // the road. They are back at the π/2 every other prop takes, and the three
  // x-asymmetric footprints here are rotated 180° to match (kay and shop are
  // symmetric in both axes, so theirs are unchanged).
  "cairo-residence-quaternius": {
    minX: -4.792,
    maxX: 3.609,
    minZ: -3.616,
    maxZ: 3.616,
  },
  // Cairo's flat-roofed replacements for `office`. Wide, shallow street-front
  // terraces, so z (the facade run) is much the larger extent.
  "cairo-office-block": {
    minX: -3.886,
    maxX: 2.586,
    minZ: -8.193,
    maxZ: 8.193,
  },
  "cairo-depot": {
    minX: -2.827,
    maxX: 2.585,
    minZ: -8.193,
    maxZ: 8.193,
  },
  office: { minX: -6.15, maxX: 6.15, minZ: -6.59, maxZ: 6.59 },
};

/** Half-extent of the gas station's square base slab (its drivable lot). */
export const GAS_STATION_SLAB_HALF_M = 11.64;

/**
 * The station's solid furniture, same measured frame as above: the shop
 * (convenience store, with the road sign on its roof) and the two pump
 * islands — each island box spans its two pump stands, their kerb and the
 * canopy pillars at the ends, so one box per island is the whole obstacle.
 * The canopy roof itself is far above the car and stays open under.
 */
export const GAS_STATION_SOLIDS_M: readonly ({
  readonly id: string;
} & PropModelFootprint)[] = [
  { id: "shop", minX: 6.69, maxX: 10.97, minZ: -0.7, maxZ: 4.78 },
  { id: "pumps-a", minX: -1.14, maxX: 5.33, minZ: -1.93, maxZ: -0.98 },
  { id: "pumps-b", minX: -1.14, maxX: 5.33, minZ: -9.33, maxZ: -8.37 },
];

/**
 * The canopy roof over the pumps: the one piece of the station that is solid to
 * a *camera* and open to a car, which is why it is its own export instead of a
 * fourth entry in `GAS_STATION_SOLIDS_M`. Put it in that list and the forecourt
 * stops being drivable.
 *
 * Same measured frame as everything above, plus the two heights, because the
 * only question anyone asks of this rect is a vertical one: a viewpoint inside
 * the footprint has to sit under `undersideY` or it is looking at the slab. The
 * staged cutscene camera used to be lifted to 4.2m+ unconditionally, which put
 * every refuel shot at or above 4.36 — see `chooseStagedAzimuth`.
 *
 * Recovered from `gas-station.glb` directly (accessor bounds -> world via the
 * registry's 2.8 scale and -1.63 groundY) rather than under NullEngine like the
 * footprints above, because a canopy has nothing at ground level for a footprint
 * sweep to find. `tests/staticColliders.test.ts` pins it against the pillars in
 * `pumps-a`/`pumps-b`, which the same slab sits on.
 */
export const GAS_STATION_CANOPY_M: PropModelFootprint & {
  readonly undersideY: number;
  readonly topY: number;
} = {
  minX: -2.65,
  maxX: 4.58,
  minZ: -11.68,
  maxZ: 1.25,
  undersideY: 4.36,
  topY: 5.03,
};
