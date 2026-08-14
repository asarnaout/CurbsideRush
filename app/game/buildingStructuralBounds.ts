/**
 * Curated ground-level structural bounds for every building-set catalogue
 * model — the collision/proxy source of truth `geometry/buildingLayout.ts`
 * consumes, independent of the packing frontage in `buildingSets.ts`.
 *
 * Renderer-independent (no Babylon import): a pure data manifest, safe for
 * `geometry/buildingLayout.ts` to import alongside its other pure geometry.
 *
 * Each entry was measured under Babylon `NullEngine` by running the exact
 * production merge recipe (`getBuildingMaster`'s recipe: instantiate real
 * clones, `Mesh.MergeMeshes`, `orientMergedFacesOutward`,
 * `squareUpMergedMaster`, `recentreMergedMasterXZ`) at the model's configured
 * `scale`, then reading the XZ extent of only the merged master's
 * ground-touching triangles — any triangle with a vertex within 0.2 m of the
 * mesh's own measured base, never a fixed low height band (a tall tower's
 * single full-height wall triangle spans from the ground to its roof, so
 * filtering by "every vertex below a low band" would wrongly exclude it and
 * report the tower as having no ground floor). Several models — mostly
 * towers and the balcony/colonnade Cairo fronts — are measurably WIDER at
 * some upper floor than at their own base (a setback, a balcony lip, a
 * colonnade overhang), so the full merged-master bounding box the earliest
 * pass of this manifest used overstated real ground contact by up to 2 m at
 * an edge midpoint — caught by, and fixed from, the independent geometric
 * validation in `tests/buildingPlacement.test.ts` (never trust a manifest
 * against itself). Every bound below is rounded OUTWARD (away from the
 * rectangle's own centre) to 2 decimals, so rounding can only widen a solid,
 * never clip it inside real geometry.
 *
 * Every entry below keeps ONE rectangular solid, including the handful (see
 * `tests/buildingPlacement.test.ts`'s named `BOUNDARY_TOLERANCE_OVERRIDES_M`)
 * confirmed to have a genuinely asymmetric or L-shaped ground plan — a box
 * around an L-shape is a conservative, not a wrong, collider (it can only
 * ever be MORE solid than the visible building, never less), and none of
 * this catalogue's models needed a second solid to pass the plan's
 * bidirectional GLB check. A future model whose overapproximation actually
 * blocks a driveable gap should get a second `solids` entry instead of a
 * wider single box; that is why the array stays.
 *
 * `proxyHeightM` is each model's measured full mesh height (already includes
 * `groundY`, rounded up) — enough to read as an opaque streetscape silhouette
 * if the real glb never loads. Elevated/wider-than-base upper floors are
 * deliberately still part of the visual proxy height even though they are
 * excluded from the ground-level collider — a proxy box's whole point is a
 * plausible silhouette, and only the collider needs to track true ground
 * contact.
 */
import { ALL_BUILDING_SET_IDS, buildingSetModelIds } from "./buildingSets";

export interface BuildingStructuralSolid {
  readonly localId: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface BuildingStructuralBounds {
  readonly solids: readonly BuildingStructuralSolid[];
  readonly proxyHeightM: number;
}

/** Every current catalogue model has exactly one solid. */
function rect(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  proxyHeightM: number,
): BuildingStructuralBounds {
  return { solids: [{ localId: "body", minX, maxX, minZ, maxZ }], proxyHeightM };
}

const BOUNDS: Record<string, BuildingStructuralBounds> = {
  // ---- NYC ----
  "nyc-tower-a": rect(-7.81, 7.81, -7.81, 7.81, 53.04),
  "nyc-tower-b": rect(-7.21, 7.21, -7.21, 7.21, 53.77),
  "nyc-tower-c": rect(-9.61, 9.61, -9.61, 9.61, 46.09),
  "nyc-tower-artdeco": rect(-10.14, 10.14, -10.16, 10.16, 50.94),
  "nyc-tower-spire": rect(-5.53, 5.53, -5.53, 5.53, 52.28),
  "nyc-midrise-a": rect(-4.21, 4.21, -4.21, 4.21, 22.06),
  "nyc-midrise-b": rect(-9.12, 9.05, -7.05, 7.12, 19.85),
  "nyc-midrise-low": rect(-1.81, 1.81, -1.81, 1.81, 17.78),
  "nyc-brownstone-a": rect(-5.5, 5.5, -5.5, 5.5, 16.78),
  "nyc-brownstone-b": rect(-5.5, 5.5, -5.5, 5.5, 12.93),
  "nyc-brownstone-c": rect(-5.5, 5.5, -5.5, 5.5, 9.08),
  "nyc-brownstone-d": rect(-5.5, 5.5, -5.5, 5.5, 16.38),
  "nyc-tenement": rect(-5.68, 5.68, -3.19, 1.69, 19.91),
  "nyc-house-a": rect(-4.72, 4.72, -3.75, 3.39, 9.26),
  "nyc-house-b": rect(-5.47, 5.23, -4.1, 3.86, 8.11),
  "nyc-shop-corner": rect(-4.15, 4.99, -5.03, 5.03, 25.98),

  // ---- Cairo ----
  "cairo-tower-a": rect(-9.01, 9.01, -9.01, 9.01, 61.2),
  "cairo-tower-b": rect(-9.01, 9.01, -9.01, 9.01, 43.21),
  "cairo-block-4story": rect(-5.43, 5.42, -5.71, 5.77, 23.41),
  "cairo-block-4story-centre": rect(-5.43, 5.42, -5.71, 5.77, 23.41),
  "cairo-block-slim": rect(-2.56, 2.69, -5.27, 5.24, 19.89),
  "cairo-block-small": rect(-4.51, 4.51, -4.7, 4.41, 19.18),
  "cairo-block-colonnade": rect(-5.35, 5.47, -6.35, 6.02, 14.34),
  "cairo-block-balcony": rect(-5.44, 5.46, -6.45, 6.52, 15.3),
  "cairo-block-terrace": rect(-9.08, 9.07, -5.29, 5.42, 13.12),
  "cairo-walkup-a": rect(-6, 6, -6, 6, 14.1),
  "cairo-walkup-b": rect(-6, 6, -6, 6, 14.1),
  "cairo-residence-kay": rect(-6, 6, -6, 6, 18.3),
  "cairo-residence-quaternius": rect(-5.04, 5.02, -5.9, 5.98, 20.21),
  "cairo-office-block": rect(-12.15, 12.17, -4.76, 4.75, 18.55),
  "cairo-depot": rect(-13.5, 13.52, -4.41, 4.52, 11),
  "cairo-shop": rect(-4, 4, -4, 4, 6.6),

  // ---- London ----
  "london-terrace-a": rect(-4.11, 4.21, -4.22, 4.23, 12.54),
  "london-terrace-b": rect(-4.32, 4.32, -4.35, 4.34, 12.18),
  "london-terrace-c": rect(-11.48, 11.49, -4.5, 4.48, 19.33),
  "london-terrace-d": rect(-3.5, 3.58, -3.58, 3.6, 6.89),
  "london-terrace-e": rect(-3.63, 3.57, -3.62, 3.62, 8.34),
  "london-stucco-a": rect(-4.53, 4.63, -4.64, 4.65, 13.79),
  "london-stucco-b": rect(-4.53, 4.53, -4.55, 4.55, 12.77),
  "london-stucco-c": rect(-11.81, 11.83, -4.63, 4.61, 19.9),
  "london-stucco-d": rect(-3.7, 3.79, -3.79, 3.81, 7.29),
  "london-tower-a": rect(-9.01, 9.01, -9.01, 9.01, 61.2),
  "london-tower-b": rect(-8.41, 8.41, -8.41, 8.41, 62.73),
  "london-tower-c": rect(-9.61, 9.61, -9.61, 9.61, 46.09),
  "london-shop": rect(-4, 4, -4, 4, 6.6),
  "london-walkup-a": rect(-6, 6, -6, 6, 14.1),
  "london-walkup-b": rect(-6, 6, -6, 6, 14.1),

  // ---- Tokyo (P1 — imported here; wired live into `tokyo-house`/
  // `tokyo-shotengai` (P2) and `tokyo-manshon` (P3b) — `tokyo-izakaya`/
  // `tokyo-ramen` alone remain unreferenced venue models; see
  // TOKYO_ENV_MODELS's header in buildingCatalog.ts). Measured independently
  // of buildingSets.ts's own footprintM/depthM (which come from the FULL
  // merged-master bound): ground-touching triangles collected within 0.2 m
  // of each model's own ground reference (not always the absolute geometric
  // minimum — see the matching comment in buildingSets.ts for
  // tokyo-house-d/tokyo-ramen, whose lowest vertices belong to a sunken
  // stair tread and a few stool-leg tips respectively, not the real ground
  // plane), cross-checked against `tests/buildingPlacement.test.ts`'s own
  // independent containment/boundary-tolerance gate. Several of these are
  // measurably narrower at ground contact than their full silhouette —
  // tokyo-konbini's fascia/sign band and tokyo-shop-d's upper massing both
  // oversail their own walls, the same asymmetric-upper-floor pattern this
  // file's header already documents for Cairo's towers/colonnades.
  "tokyo-house-a": rect(-4.61, 4.61, -4.06, 4.06, 8.16),
  "tokyo-house-b": rect(-4.09, 3.34, -3.01, 3.01, 7.03),
  "tokyo-house-c": rect(-5.87, 4.83, -5.61, 5.64, 7.08),
  "tokyo-house-d": rect(-6.85, 6.85, -5.88, 5.91, 7.22),
  "tokyo-apato-a": rect(-3.35, 3.63, -2.4, 2.12, 10.66),
  "tokyo-apato-b": rect(-4.48, 4.48, -8.26, 8.26, 17.56),
  "tokyo-konbini": rect(-4.36, 4.43, -6.58, 1.24, 8.58),
  "tokyo-shop-a": rect(-0.92, 1.22, -1.91, 1.44, 3.95),
  "tokyo-shop-b": rect(-1.9, 2.31, -3.1, 3.11, 5.5),
  "tokyo-shop-c": rect(-4.05, 4.04, -4.05, 4.0, 6.16),
  "tokyo-shop-d": rect(-5.9, 11.21, -6.14, 5.41, 23.13),
  "tokyo-izakaya": rect(-3.77, 3.78, -3.25, 3.44, 10.05),
  "tokyo-ramen": rect(-6.84, 6.6, -8.68, 8.28, 9.64),

  // ---- Tokyo (P3a — imported here; wired live into `tokyo-zakkyo` (P3b)
  // below; see TOKYO_ENV_MODELS's header in buildingCatalog.ts). Same
  // measurement recipe as the P1 block above; none of these six hit the
  // heterogeneous-submesh MergeMeshes crash, so every bound here comes from
  // a real merged master, not a per-submesh union.
  //
  // tokyo-zakkyo-{a..f}: each rect is the ROW's own ground-touching extent
  // (a 3-4 building cluster, tools/split-asian-city-pack.mjs), not one
  // building's. proxyHeightM is the row's tallest building.
  "tokyo-zakkyo-a": rect(-17.92, 17.92, -4.48, 4.48, 54.1),
  "tokyo-zakkyo-b": rect(-16.07, 16.07, -4.0, 4.0, 46.84),
  "tokyo-zakkyo-c": rect(-17.01, 16.44, -3.43, 3.43, 32.83),
  "tokyo-zakkyo-d": rect(-18.36, 18.36, -8.34, 8.34, 42.42),
  "tokyo-zakkyo-e": rect(-16.62, 16.62, -7.03, 7.03, 34.66),
  "tokyo-zakkyo-f": rect(-11.1, 11.1, -4.04, 4.04, 32.5),

  // tokyo-nippori-bldg: off-centre on Z (both bounds positive) — the scan's
  // own origin sits behind the building's real footprint on that axis, the
  // same class of asymmetric reference several P1 entries already show.
  "tokyo-nippori-bldg": rect(-5.39, -4.5, 4.04, 4.57, 25.0),

  // Restyle backbone: same source geometry as an already-curated entry
  // elsewhere in this file (cairo-walkup-a/b, nyc-tower-a — see this file's
  // own header on why a shared source still gets fresh per-copy numbers).
  // tokyo-block-{slim,small,4story} are likewise the same Quaternius source
  // geometry as cairo-block-{slim,small,4story}, re-measured fresh.
  "tokyo-walkup-a": rect(-6, 6, -6, 6, 14.1),
  "tokyo-walkup-b": rect(-6, 6, -6, 6, 14.1),
  "tokyo-tower-a": rect(-9, 9, -9, 9, 61.2),
  "tokyo-block-slim": rect(-2.56, 2.69, -5.27, 5.24, 19.96),
  "tokyo-block-small": rect(-4.51, 4.51, -4.7, 4.41, 19.25),
  "tokyo-block-4story": rect(-5.43, 5.42, -5.71, 5.77, 23.43),
};

/** Structural bounds for a catalogue model id, or `undefined` if uncurated. */
export function buildingStructuralBoundsFor(
  modelId: string,
): BuildingStructuralBounds | undefined {
  return BOUNDS[modelId];
}

/** Every model id this manifest currently curates (tooling/tests). */
export function curatedStructuralBoundsModelIds(): readonly string[] {
  return Object.keys(BOUNDS);
}

/**
 * Set-referenced model ids with no structural entry — a typo/omission guard
 * mirroring `buildingSets.ts`'s `missingBuildingConfigs`: any non-empty result
 * means a plan built from that set would silently have no collider/proxy for
 * that model.
 */
export function missingStructuralBoundsConfigs(): string[] {
  const missing = new Set<string>();
  for (const setId of ALL_BUILDING_SET_IDS) {
    for (const id of buildingSetModelIds(setId)) {
      if (!BOUNDS[id]) missing.add(id);
    }
  }
  return [...missing];
}
