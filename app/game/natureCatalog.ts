/**
 * The imported park planting kit: what each model is, and which cities pay to
 * download it.
 *
 * Pure and Babylon-free, like `buildingCatalog.ts`, so tests and the preloader
 * can both read it. Provenance for every file is in `CREDITS.md`; the bytes are
 * pinned by `tests/natureAssets.test.ts`.
 *
 * **Scoped per map on purpose.** `propModelUrls()` is not scoped — every city
 * downloads every venue and service prop — and that is exactly the cost this
 * avoids repeating: Tokyo has no reason to fetch Cairo's palms, and Cairo none
 * to fetch a conifer. Scoping follows `buildingSetUrls`.
 */

const P = "/models/props";

/** Which planting a city's parks draw from. */
export type NatureSetId = "temperate" | "arid" | "temple" | "civic";

export interface NatureModel {
  readonly id: string;
  readonly url: string;
  readonly sets: readonly NatureSetId[];
  /**
   * Uniform scale to metres, measured rather than guessed.
   *
   * **The kit is authored at roughly a fifth of world scale** — its trees are
   * 1.1–1.9 m tall in the file, not the 4–6 m their silhouettes suggest. At a
   * scale near 1 a park plants saplings. These are set so a canopy tree lands
   * at 8–10 m, a shrub near 1 m, and a tuft at ankle height;
   * `tests/natureAssets.test.ts` pins the resulting world heights.
   */
  readonly scale: number;
  /** Measured world-space height after `scale` is applied. */
  readonly heightM: number;
  /** Measured maximum x/z half-extent after `scale` is applied. */
  readonly footprintRadiusM: number;
  /** What the park scatter asks for by kind. */
  readonly role: "tree" | "conifer" | "palm" | "shrub" | "flower" | "tuft" | "rock" | "monument";
}

export const NATURE_MODELS: readonly NatureModel[] = [
  { id: "tree-broadleaf", url: `${P}/nature-tree-broadleaf.glb`, sets: ["temperate", "civic"], scale: 5.2, heightM: 8.881, footprintRadiusM: 1.963, role: "tree" },
  { id: "tree-oak", url: `${P}/nature-tree-oak.glb`, sets: ["temperate", "civic"], scale: 7.0, heightM: 8.584, footprintRadiusM: 2.589, role: "tree" },
  { id: "tree-tall", url: `${P}/nature-tree-tall.glb`, sets: ["temperate", "temple"], scale: 5.5, heightM: 9.282, footprintRadiusM: 1.269, role: "tree" },
  { id: "tree-small", url: `${P}/nature-tree-small.glb`, sets: ["temperate", "temple"], scale: 5.0, heightM: 5.55, footprintRadiusM: 1.024, role: "tree" },
  { id: "conifer-tall", url: `${P}/nature-conifer-tall.glb`, sets: ["temperate"], scale: 5.5, heightM: 10.64, footprintRadiusM: 1.078, role: "conifer" },
  { id: "conifer-round", url: `${P}/nature-conifer-round.glb`, sets: ["temperate", "temple"], scale: 5.0, heightM: 6.264, footprintRadiusM: 1.387, role: "conifer" },
  { id: "palm-tall", url: `${P}/nature-palm-tall.glb`, sets: ["arid"], scale: 6.0, heightM: 8.134, footprintRadiusM: 3.103, role: "palm" },
  { id: "palm-short", url: `${P}/nature-palm-short.glb`, sets: ["arid"], scale: 5.0, heightM: 5.281, footprintRadiusM: 2.586, role: "palm" },
  { id: "bush", url: `${P}/nature-bush.glb`, sets: ["temperate", "arid", "temple", "civic"], scale: 4.0, heightM: 0.978, footprintRadiusM: 0.792, role: "shrub" },
  { id: "bush-large", url: `${P}/nature-bush-large.glb`, sets: ["temperate", "arid", "civic"], scale: 5.5, heightM: 1.336, footprintRadiusM: 1.029, role: "shrub" },
  // The kit's triangular bushes read as clipped topiary, which is what a
  // temple garden and a formal civic bed both want.
  { id: "bush-clipped", url: `${P}/nature-bush-clipped.glb`, sets: ["temple", "civic"], scale: 4.0, heightM: 1.182, footprintRadiusM: 0.827, role: "shrub" },
  { id: "flower-red", url: `${P}/nature-flower-red.glb`, sets: ["temperate", "civic"], scale: 2.0, heightM: 0.585, footprintRadiusM: 0.181, role: "flower" },
  { id: "flower-yellow", url: `${P}/nature-flower-yellow.glb`, sets: ["temperate", "arid", "civic"], scale: 2.0, heightM: 0.385, footprintRadiusM: 0.181, role: "flower" },
  { id: "grass-tuft", url: `${P}/nature-grass-tuft.glb`, sets: ["temperate", "temple"], scale: 2.0, heightM: 0.508, footprintRadiusM: 0.392, role: "tuft" },
  { id: "grass-tuft-large", url: `${P}/nature-grass-tuft-large.glb`, sets: ["temperate"], scale: 2.2, heightM: 0.559, footprintRadiusM: 0.45, role: "tuft" },
  { id: "rock-large", url: `${P}/nature-rock-large.glb`, sets: ["temperate", "arid", "temple"], scale: 3.0, heightM: 0.779, footprintRadiusM: 1.523, role: "rock" },
  { id: "rock-small", url: `${P}/nature-rock-small.glb`, sets: ["temperate", "arid", "temple"], scale: 2.5, heightM: 0.442, footprintRadiusM: 0.451, role: "rock" },
  { id: "obelisk", url: `${P}/nature-obelisk.glb`, sets: ["arid", "civic"], scale: 5.0, heightM: 4.377, footprintRadiusM: 0.768, role: "monument" },
];

/**
 * Which planting sets a city draws on, by `MapVisualKey`. NYC and London both
 * fall to the shared temperate/civic default rather than each getting a row —
 * kept as an explicit fallback (not a third table entry) because that is
 * genuinely what both want, not a placeholder for a row nobody wrote yet.
 */
const NATURE_SETS_BY_VISUAL_KEY: Readonly<Record<string, readonly NatureSetId[]>> = {
  cairo: ["arid", "civic"],
  tokyo: ["temple", "temperate"],
};
const DEFAULT_NATURE_SETS: readonly NatureSetId[] = ["temperate", "civic"];

export function natureSetsForMap(mapVisualKey: string): readonly NatureSetId[] {
  return NATURE_SETS_BY_VISUAL_KEY[mapVisualKey] ?? DEFAULT_NATURE_SETS;
}

/** De-duplicated glb URLs for the given sets, for a map-scoped preload. */
export function natureSetUrls(sets: readonly NatureSetId[]): string[] {
  const urls = new Set<string>();
  for (const model of NATURE_MODELS) {
    if (model.sets.some((set) => sets.includes(set))) urls.add(model.url);
  }
  return [...urls];
}

/** Every model a city will place, in catalogue order so draws stay stable. */
export function natureModelsForMap(mapVisualKey: string): readonly NatureModel[] {
  const sets = natureSetsForMap(mapVisualKey);
  return NATURE_MODELS.filter((model) =>
    model.sets.some((set) => sets.includes(set)),
  );
}

/**
 * Resolve the exact imported species used for one authored planting. Keeping
 * this selection in the Babylon-free catalogue lets placement/headroom code
 * use the same measured model envelope before the GLB has loaded.
 */
export function natureModelForPlacement(
  mapVisualKey: string,
  kind: string,
  variant: number,
): NatureModel | null {
  const catalogue = natureModelsForMap(mapVisualKey);
  const pool = catalogue.filter((model) =>
    kind === "shrub"
      ? model.role === "shrub"
      : kind === "monument"
        ? model.role === "monument"
        : kind === "palm"
          ? model.role === "palm"
          : model.role === "tree" ||
            model.role === "conifer" ||
            model.role === "palm",
  );
  return pool.length ? pool[((variant % pool.length) + pool.length) % pool.length] : null;
}

/** Every URL in the kit — for the asset guard, never for a preload. */
export function allNatureModelUrls(): string[] {
  return NATURE_MODELS.map((model) => model.url);
}
