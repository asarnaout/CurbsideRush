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
   * Uniform scale to metres. The kit is authored around a ~1 m grid and its
   * trees stand 2–4 m, which is short for a mature street tree, so most of
   * these run above 1.
   */
  readonly scale: number;
  /** What the park scatter asks for by kind. */
  readonly role: "tree" | "conifer" | "palm" | "shrub" | "flower" | "tuft" | "rock" | "monument";
}

export const NATURE_MODELS: readonly NatureModel[] = [
  { id: "tree-broadleaf", url: `${P}/nature-tree-broadleaf.glb`, sets: ["temperate", "civic"], scale: 1.5, role: "tree" },
  { id: "tree-oak", url: `${P}/nature-tree-oak.glb`, sets: ["temperate", "civic"], scale: 1.5, role: "tree" },
  { id: "tree-tall", url: `${P}/nature-tree-tall.glb`, sets: ["temperate", "temple"], scale: 1.6, role: "tree" },
  { id: "tree-small", url: `${P}/nature-tree-small.glb`, sets: ["temperate", "temple"], scale: 1.4, role: "tree" },
  { id: "conifer-tall", url: `${P}/nature-conifer-tall.glb`, sets: ["temperate"], scale: 1.6, role: "conifer" },
  { id: "conifer-round", url: `${P}/nature-conifer-round.glb`, sets: ["temperate", "temple"], scale: 1.4, role: "conifer" },
  { id: "palm-tall", url: `${P}/nature-palm-tall.glb`, sets: ["arid"], scale: 1.7, role: "palm" },
  { id: "palm-short", url: `${P}/nature-palm-short.glb`, sets: ["arid"], scale: 1.5, role: "palm" },
  { id: "bush", url: `${P}/nature-bush.glb`, sets: ["temperate", "arid", "temple", "civic"], scale: 1.2, role: "shrub" },
  { id: "bush-large", url: `${P}/nature-bush-large.glb`, sets: ["temperate", "arid", "civic"], scale: 1.2, role: "shrub" },
  // The kit's triangular bushes read as clipped topiary, which is what a
  // temple garden and a formal civic bed both want.
  { id: "bush-clipped", url: `${P}/nature-bush-clipped.glb`, sets: ["temple", "civic"], scale: 1.2, role: "shrub" },
  { id: "flower-red", url: `${P}/nature-flower-red.glb`, sets: ["temperate", "civic"], scale: 1, role: "flower" },
  { id: "flower-yellow", url: `${P}/nature-flower-yellow.glb`, sets: ["temperate", "arid", "civic"], scale: 1, role: "flower" },
  { id: "grass-tuft", url: `${P}/nature-grass-tuft.glb`, sets: ["temperate", "temple"], scale: 1.1, role: "tuft" },
  { id: "grass-tuft-large", url: `${P}/nature-grass-tuft-large.glb`, sets: ["temperate"], scale: 1.1, role: "tuft" },
  { id: "rock-large", url: `${P}/nature-rock-large.glb`, sets: ["temperate", "arid", "temple"], scale: 1.3, role: "rock" },
  { id: "rock-small", url: `${P}/nature-rock-small.glb`, sets: ["temperate", "arid", "temple"], scale: 1.3, role: "rock" },
  { id: "obelisk", url: `${P}/nature-obelisk.glb`, sets: ["arid", "civic"], scale: 1.4, role: "monument" },
];

/** Which planting sets a city draws on, by `MapVisualKey`. */
export function natureSetsForMap(mapVisualKey: string): readonly NatureSetId[] {
  switch (mapVisualKey) {
    case "cairo":
      return ["arid", "civic"];
    case "tokyo":
      return ["temple", "temperate"];
    default:
      return ["temperate", "civic"];
  }
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

/** Every URL in the kit — for the asset guard, never for a preload. */
export function allNatureModelUrls(): string[] {
  return NATURE_MODELS.map((model) => model.url);
}
