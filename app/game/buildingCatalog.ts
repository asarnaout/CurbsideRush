/**
 * Catalog of the CC0 / CC-BY low-poly environment models that dress the NYC map
 * for the "NYC Nightfall" overhaul (Phase 0). Pure data — NO Babylon imports —
 * so it stays testable under the node vitest setup and is importable by both the
 * renderer (the instanced building-set placement added in a later phase) and the
 * asset/credits tests.
 *
 * Every file lives under `public/models/` and is committed to the repo. Licences
 * and attributions are mirrored in CREDITS.md; each CC-BY entry carries its
 * required credit string in `attribution` so the renderer/credits can surface it.
 *
 * Sources: individual models downloaded from Poly Pizza (https://poly.pizza), the
 * same catalogue the project's existing venue/vehicle assets came from. The
 * low-poly Kenney (CC0) tower kit and Kay Lousberg (CC0) brownstone kit form the
 * style-consistent backbone; a few Poly-by-Google / individual-author CC-BY
 * pieces add NYC character (art-deco setback tower, fire-escape tenement, spired
 * landmark, corner bodega, street-vendor cart).
 */

/** Coarse land-use category, used later to group models into zone building-sets. */
export type EnvModelCategory =
  | "tower"
  | "midrise"
  | "brownstone"
  | "house"
  | "shop"
  | "vendor"
  | "person";

export interface EnvModelMeta {
  /** Stable internal id (also the basename of the glb). */
  readonly id: string;
  /** Public URL the loader fetches (props under /models/props, people under /models/characters). */
  readonly url: string;
  readonly category: EnvModelCategory;
  /** Original model title on Poly Pizza. */
  readonly title: string;
  readonly author: string;
  readonly license: "CC0 1.0" | "CC-BY 3.0";
  /** Poly Pizza model page. */
  readonly sourceUrl: string;
  /** Required credit string for CC-BY assets (absent for CC0). */
  readonly attribution?: string;
}

const P = "/models/props";
const C = "/models/characters";
const src = (slug: string) => `https://poly.pizza/m/${slug}`;
/** Quaternius ships this pack from its own site, not Poly Pizza — one page for
 * the whole pack, so its models share a sourceUrl and are told apart by title. */
const QUATERNIUS_PACK =
  "https://quaternius.com/packs/ultimatetexturedbuildings.html";

/**
 * The 23 environment models added for NYC. Tri counts are all low (16 KB–1.3 MB
 * glbs) so they instance cheaply; the two ~14 k-tri market clusters
 * (`market-stalls`) are meant to be placed sparingly as hero street-life spots.
 */
export const NYC_ENV_MODELS: readonly EnvModelMeta[] = [
  // ---- Downtown towers ----
  { id: "nyc-tower-a", url: `${P}/nyc-tower-a.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("XST1j6kYsL") },
  { id: "nyc-tower-b", url: `${P}/nyc-tower-b.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("JTsKOSB23Y") },
  { id: "nyc-tower-c", url: `${P}/nyc-tower-c.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("jIRx0AhYOR") },
  { id: "nyc-tower-artdeco", url: `${P}/nyc-tower-artdeco.glb`, category: "tower", title: "Skyscraper", author: "Poly by Google", license: "CC-BY 3.0", sourceUrl: src("5mOW8KZSHtU"), attribution: "Skyscraper by Poly by Google" },
  { id: "nyc-tower-spire", url: `${P}/nyc-tower-spire.glb`, category: "tower", title: "Skyscraper", author: "Jarlan Perez", license: "CC-BY 3.0", sourceUrl: src("7WF09z31G_v"), attribution: "Skyscraper by Jarlan Perez" },

  // ---- Mid-rise fill ----
  { id: "nyc-midrise-a", url: `${P}/nyc-midrise-a.glb`, category: "midrise", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("obYD8hWLTZ") },
  { id: "nyc-midrise-b", url: `${P}/nyc-midrise-b.glb`, category: "midrise", title: "Large Building", author: "Kenney", license: "CC0 1.0", sourceUrl: src("h7Jaq7bqMq") },
  { id: "nyc-midrise-low", url: `${P}/nyc-midrise-low.glb`, category: "midrise", title: "Low Building", author: "Kenney", license: "CC0 1.0", sourceUrl: src("4RoPd9BkSx") },

  // ---- Brownstone / rowhouse belt ----
  { id: "nyc-brownstone-a", url: `${P}/nyc-brownstone-a.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("otRsYa6pan") },
  { id: "nyc-brownstone-b", url: `${P}/nyc-brownstone-b.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("T3oyvK6VEU") },
  { id: "nyc-brownstone-c", url: `${P}/nyc-brownstone-c.glb`, category: "brownstone", title: "Building B", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("5XG9i3QzlT") },
  { id: "nyc-brownstone-d", url: `${P}/nyc-brownstone-d.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("g15lpKh4li") },
  { id: "nyc-tenement", url: `${P}/nyc-tenement.glb`, category: "brownstone", title: "Apartment building", author: "Poly by Google", license: "CC-BY 3.0", sourceUrl: src("01lqee-dZAr"), attribution: "Apartment building by Poly by Google" },

  // ---- Detached houses (the residential pocket) ----
  { id: "nyc-house-a", url: `${P}/nyc-house-a.glb`, category: "house", title: "House", author: "Poly by Google", license: "CC-BY 3.0", sourceUrl: src("6PGyqELX8M-"), attribution: "House by Poly by Google" },
  { id: "nyc-house-b", url: `${P}/nyc-house-b.glb`, category: "house", title: "Farm house", author: "Poly by Google", license: "CC-BY 3.0", sourceUrl: src("bHyQe5jzdiQ"), attribution: "Farm house by Poly by Google" },

  // ---- Ground-floor retail / bodega ----
  { id: "nyc-shop-corner", url: `${P}/nyc-shop-corner.glb`, category: "shop", title: "Pizza Corner", author: "J-Toastie", license: "CC-BY 3.0", sourceUrl: src("78W2Ab2Uvt"), attribution: "Pizza Corner by J-Toastie" },

  // ---- Street vendors ----
  { id: "vendor-stand", url: `${P}/vendor-stand.glb`, category: "vendor", title: "Market Stand", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("DGIM5HGISb") },
  { id: "vendor-cart", url: `${P}/vendor-cart.glb`, category: "vendor", title: "Cart", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("l7bDe7ak6j") },
  { id: "vendor-food", url: `${P}/vendor-food.glb`, category: "vendor", title: "Street Vendor Cart", author: "Alan Zimmerman", license: "CC-BY 3.0", sourceUrl: src("f_LuAcP2_Yh"), attribution: "Street Vendor Cart by Alan Zimmerman" },
  { id: "market-stalls", url: `${P}/market-stalls.glb`, category: "vendor", title: "Market Stalls Compact", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("fmHUuX9AS3") },

  // ---- Pedestrian variety (women + a punk, to balance the all-male base set) ----
  { id: "person-woman-a", url: `${C}/person-woman-a.glb`, category: "person", title: "Woman Casual", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("jpKRgGDxhk") },
  { id: "person-woman-b", url: `${C}/person-woman-b.glb`, category: "person", title: "Woman in Dress", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("zMyPlQXBzq") },
  { id: "person-punk", url: `${C}/person-punk.glb`, category: "person", title: "Punk", author: "Quaternius", license: "CC0 1.0", sourceUrl: src("BTALZymknF") },
];

/**
 * The Cairo street-wall kit. Cairo used to have no glb buildings at all — every
 * building on the map was a procedural windowed box — so these exist to give it
 * the same imported street wall NYC has.
 *
 * **Flat roofs only, and that is load-bearing.** Cairo's building stock is
 * flat-roofed; a gable or hip reads as European the moment it lands on the
 * street. Quaternius encodes roof shape in the source filename (never take a
 * `GableRoof` / `RoundRoof` / `_Roof_` variant), but that convention does not
 * extend to the other packs — two KayKit buildings that looked flat in the
 * pack's contents sheet measured as pitched. `tests/cairoRoofs.test.ts` measures
 * the committed geometry of everything listed here, which is the only check that
 * actually holds.
 *
 * Four of these re-import a source model NYC already uses (the KayKit walk-ups
 * and both Kenney towers). That duplication is deliberate: `modelLibrary` keys
 * asset containers by URL, so a single file cannot carry both the New York and
 * the Cairo palette.
 */
export const CAIRO_ENV_MODELS: readonly EnvModelMeta[] = [
  // ---- Corniche el-Nil slabs: the riverfront's 15-25 storey wall ----
  { id: "cairo-tower-a", url: `${P}/cairo-tower-a.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("XST1j6kYsL") },
  { id: "cairo-tower-b", url: `${P}/cairo-tower-b.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("jIRx0AhYOR") },

  // ---- Khedivial / Downtown blocks (Quaternius, Ultimate Textured Buildings) ----
  { id: "cairo-block-4story", url: `${P}/cairo-block-4story.glb`, category: "midrise", title: "4Story_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-4story-centre", url: `${P}/cairo-block-4story-centre.glb`, category: "midrise", title: "4Story_Center_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-slim", url: `${P}/cairo-block-slim.glb`, category: "midrise", title: "3Story_Slim_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-small", url: `${P}/cairo-block-small.glb`, category: "midrise", title: "3Story_Small_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-colonnade", url: `${P}/cairo-block-colonnade.glb`, category: "brownstone", title: "2Story_Columns_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-balcony", url: `${P}/cairo-block-balcony.glb`, category: "brownstone", title: "2Story_Balcony_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-block-terrace", url: `${P}/cairo-block-terrace.glb`, category: "brownstone", title: "2Story_Wide_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },

  // ---- Walk-ups (KayKit): flat roofs with their own water tanks, which is as
  // Cairo as the kit gets. Same family as the residence venues below.
  { id: "cairo-walkup-a", url: `${P}/cairo-walkup-a.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("qOhhGLftam") },
  { id: "cairo-walkup-b", url: `${P}/cairo-walkup-b.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("T3oyvK6VEU") },

  // ---- Already shipping as gig-venue props; also placed in the street wall so
  // the two the map already had stop being rarities.
  { id: "cairo-residence-kay", url: `${P}/cairo-residence-kay.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("otRsYa6pan") },
  { id: "cairo-residence-quaternius", url: `${P}/cairo-residence-quaternius.glb`, category: "midrise", title: "3Story_Balcony_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
];

/** Every catalogued environment model, both maps' kits. */
export const ALL_ENV_MODELS: readonly EnvModelMeta[] = [
  ...NYC_ENV_MODELS,
  ...CAIRO_ENV_MODELS,
];

/** De-duplicated Cairo street-wall URLs, for map-scoped preload/tests. */
export function cairoEnvModelUrls(): string[] {
  return [...new Set(CAIRO_ENV_MODELS.map((m) => m.url))];
}

/** De-duplicated model URLs, optionally filtered to one category, for preloading/tests. */
export function nycEnvModelUrls(category?: EnvModelCategory): string[] {
  const models = category
    ? NYC_ENV_MODELS.filter((m) => m.category === category)
    : NYC_ENV_MODELS;
  return [...new Set(models.map((m) => m.url))];
}

/** Every CC-BY credit string that must be surfaced when these models are shipped. */
export function nycEnvAttributions(): string[] {
  return NYC_ENV_MODELS.filter((m) => m.attribution).map((m) => m.attribution!);
}
