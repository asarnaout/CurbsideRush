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
  | "apartment"
  | "shop"
  | "restaurant"
  | "vendor"
  | "person";

export interface EnvModelMeta {
  /** Stable internal id (also the basename of the glb). */
  readonly id: string;
  /** Public URL the loader fetches (props under /models/props, people under /models/characters). */
  readonly url: string;
  readonly category: EnvModelCategory;
  /** Original model title on Poly Pizza (or Sketchfab, for the Tokyo kit). */
  readonly title: string;
  readonly author: string;
  /** Tokyo's Sketchfab imports are all CC-BY 4.0 — a different point release
   * from the Poly Pizza CC-BY 3.0 kits, but the same attribution obligation. */
  readonly license: "CC0 1.0" | "CC-BY 3.0" | "CC-BY 4.0";
  /** Poly Pizza (or Sketchfab) model page. */
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
  { id: "cairo-office-block", url: `${P}/cairo-office-block.glb`, category: "midrise", title: "4Story_Wide_2Doors_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-depot", url: `${P}/cairo-depot.glb`, category: "brownstone", title: "2Story_Wide_2Doors_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "cairo-shop", url: `${P}/cairo-shop.glb`, category: "shop", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("EL3ePInr1N") },
];

/**
 * The London street-wall kit. London shipped its expansion on the procedural
 * facade grid alone; these exist to replace the coloured boxes with modelled
 * terraces, stucco squares, shopfronts and City towers.
 *
 * **Pitched roofs on purpose — the inverse of Cairo's rule.** The five
 * Quaternius sources here are exactly the `GableRoof` / `RoundRoof` / `_Roof_`
 * models Cairo's ROOF RULE bans, because a gable reads as European on sight
 * and London is the map that wants it to. Do not widen `tests/cairoRoofs.test.ts`
 * to cover these.
 *
 * The stucco family re-converts the same OBJ sources into separate files, and
 * the towers/shopfronts copy committed NYC/Cairo files: `modelLibrary` keys
 * asset containers by URL, so one file cannot carry two cities' palettes.
 * Every file is regenerable via `tools/style-london-{terraces,towers,shops}.mjs`
 * (recipes in each header; hashes in CREDITS.md).
 */
export const LONDON_ENV_MODELS: readonly EnvModelMeta[] = [
  // ---- Brick terraces (Quaternius, Ultimate Textured Buildings — pitched) ----
  { id: "london-terrace-a", url: `${P}/london-terrace-a.glb`, category: "brownstone", title: "2Story_GableRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-terrace-b", url: `${P}/london-terrace-b.glb`, category: "brownstone", title: "2Story_RoundRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-terrace-c", url: `${P}/london-terrace-c.glb`, category: "midrise", title: "4Story_Wide_2Doors_Roof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-terrace-d", url: `${P}/london-terrace-d.glb`, category: "brownstone", title: "1Story_GableRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-terrace-e", url: `${P}/london-terrace-e.glb`, category: "brownstone", title: "1Story_RoundRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },

  // ---- White-stucco variants of the same sources (Chelsea / Belgravia) ----
  { id: "london-stucco-a", url: `${P}/london-stucco-a.glb`, category: "brownstone", title: "2Story_GableRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-stucco-b", url: `${P}/london-stucco-b.glb`, category: "brownstone", title: "2Story_RoundRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-stucco-c", url: `${P}/london-stucco-c.glb`, category: "midrise", title: "4Story_Wide_2Doors_Roof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },
  { id: "london-stucco-d", url: `${P}/london-stucco-d.glb`, category: "brownstone", title: "1Story_GableRoof_Mat", author: "Quaternius", license: "CC0 1.0", sourceUrl: QUATERNIUS_PACK },

  // ---- City towers (Kenney; copies of the committed nyc-tower files) ----
  { id: "london-tower-a", url: `${P}/london-tower-a.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("XST1j6kYsL") },
  { id: "london-tower-b", url: `${P}/london-tower-b.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("JTsKOSB23Y") },
  { id: "london-tower-c", url: `${P}/london-tower-c.glb`, category: "tower", title: "Skyscraper", author: "Kenney", license: "CC0 1.0", sourceUrl: src("jIRx0AhYOR") },

  // ---- High-street shopfronts (Kay Lousberg; copies of the committed Cairo
  // files, so tools/cairo-shopfront.mjs's awning/hydrant surgery carries over)
  { id: "london-shop", url: `${P}/london-shop.glb`, category: "shop", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("EL3ePInr1N") },
  { id: "london-walkup-a", url: `${P}/london-walkup-a.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("qOhhGLftam") },
  { id: "london-walkup-b", url: `${P}/london-walkup-b.glb`, category: "brownstone", title: "Building", author: "Kay Lousberg", license: "CC0 1.0", sourceUrl: src("T3oyvK6VEU") },
];

/**
 * The Tokyo street-wall kit. Tokyo shipped its ten-phase expansion with
 * `buildingSets: []`: every building on the map was a procedural facade box.
 *
 * **P1** (13 models — houses, apāto walk-ups, a konbini, shotengai
 * shopfronts, an izakaya and a ramen shop) was the first real building
 * models for Tokyo. **P2 wired ten of these thirteen** into two new sets
 * (`tokyo-house`, `tokyo-shotengai` — `buildingSets.ts`), live on
 * miyanosaka/yamashita/nishi and `jp-nakamise-yokocho`
 * (`tokyoRoadsideBuildingSet` in `cities/tokyo.ts`); `tokyo-izakaya` and
 * `tokyo-ramen` stay unwired (venue models, a later phase's job per the
 * plan's section 6.4), and `tokyo-apato-b` stays unwired too (no set built
 * that phase names it).
 *
 * **P3a** added the downtown/zakkyo backbone (13 more models): six
 * `tokyo-zakkyo-*` files split from one 19-building Sketchfab night-city pack
 * (`tools/split-asian-city-pack.mjs`), the optional `tokyo-nippori-bldg`
 * hero, and six "restyle backbone" models — re-imports of already-committed
 * CC0 sources restyled for Tokyo (`tools/style-tokyo-buildings.mjs`'s
 * flat-palette path, `TOKYO_ZAKKYO_MODEL_IDS` below lists just the six
 * splits). **P3a was import-only, exactly like P1**: measured
 * `buildingSets.ts` PLACEMENTS/`buildingStructuralBounds.ts` BOUNDS entries,
 * referenced by no `BuildingSetId`/block yet.
 *
 * **P3b** wires the six zakkyo splits plus `tokyo-block-slim/small/4story`
 * into a new `tokyo-zakkyo` set (`downtown` + `ring`), and
 * `tokyo-walkup-a/b`/`tokyo-block-4story`/`tokyo-tower-a` into a new
 * `tokyo-manshon` set (`riverside` + `higashi`) — see
 * `tokyoRoadsideBuildingSet` in `cities/tokyo.ts`. `tokyo-nippori-bldg`
 * stays deliberately out of both sets' regular membership (a street-wall set
 * repeats along every qualifying run, wrong for a one-of-a-kind hero) — see
 * the P3b PR body for whether/where it got a hand-placed instance instead.
 * `tokyo-apato-b` stays unwired too, live-measured out of `tokyo-manshon`
 * this same phase (see that set's own comment in `buildingSets.ts`): its
 * glb's ~99 distinct architectural-BIM-style submeshes each cost a real
 * draw call the moment even one instance is on screen, nearly doubling the
 * Tokyo scramble's drawCallsPerFrame in a live paired measurement.
 * `tokyo-izakaya`/`tokyo-ramen` (P1, venue models) remain unwired, still
 * waiting on the plan's section 6.4 venue-wiring phase. See `CREDITS.md` for
 * full import provenance.
 *
 * The P1/P3a Sketchfab exports were downloaded as the autoconverted glTF
 * (separate `.gltf`+`.bin`+images), packed into a self-contained glb by
 * `tools/pack-gltf.mjs` (this repo's hand-written glTF->glb packer, the
 * sibling of `tools/obj-to-glb.mjs`) and normalized by
 * `tools/style-tokyo-buildings.mjs`; they are **CC-BY 4.0** — a plain
 * attribution licence, same obligation as the CC-BY 3.0 Poly Pizza pieces
 * elsewhere in this catalogue, different point release. The restyle-backbone
 * models are **CC0 1.0**, like every other re-styled copy in this catalogue.
 */
const SKETCHFAB_MODEL = (uid: string) => `https://sketchfab.com/3d-models/${uid}`;

export const TOKYO_ENV_MODELS: readonly EnvModelMeta[] = [
  // ---- Detached houses (series 1-3 share one author/scale; house-d is a
  // separate, untextured-flat-colour model that already matches the game's
  // native art style) ----
  {
    id: "tokyo-house-a",
    url: `${P}/tokyo-house-a.glb`,
    category: "house",
    title: "Japanese Residential Home 01",
    author: "Morrissey Alexander",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("japanese-residential-home-01-d690f83d8e8d48e6a532bebe84901595"),
    attribution: "Japanese Residential Home 01 by Morrissey Alexander",
  },
  {
    id: "tokyo-house-b",
    url: `${P}/tokyo-house-b.glb`,
    category: "house",
    title: "Japanese Residential Home 02",
    author: "Morrissey Alexander",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("japanese-residential-home-02-c31697f09152453cb3ed215482e7a810"),
    attribution: "Japanese Residential Home 02 by Morrissey Alexander",
  },
  {
    id: "tokyo-house-c",
    url: `${P}/tokyo-house-c.glb`,
    category: "house",
    title: "Japanese Residential Home 03",
    author: "Morrissey Alexander",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("japanese-residential-home-03-1c53f4f37fc44c32a8874464025aea48"),
    attribution: "Japanese Residential Home 03 by Morrissey Alexander",
  },
  {
    id: "tokyo-house-d",
    url: `${P}/tokyo-house-d.glb`,
    category: "house",
    title: "Tokyo Japanese House / Casa Japonesa [Low Poly]",
    author: "SitoNyaa",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "tokyo-japanese-house-casa-japonesa-low-poly-05e04ee0c3d04ff9a2fe4c348b3c1bcd",
    ),
    attribution: "Tokyo Japanese House / Casa Japonesa [Low Poly] by SitoNyaa",
  },

  // ---- Apāto walk-ups ----
  {
    id: "tokyo-apato-a",
    url: `${P}/tokyo-apato-a.glb`,
    category: "apartment",
    title: "PSX Japanese Apartment",
    // Sketchfab's own embedded asset.extras.author on the downloaded export
    // (freshest, authoritative) says "DeadFrame Studio", not the research
    // manifest's "Shazly" — same uid/model, corrected author.
    author: "DeadFrame Studio",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("psx-japanese-apartment-0a12452df55c4e3687759732c81a8437"),
    attribution: "PSX Japanese Apartment by DeadFrame Studio",
  },
  {
    id: "tokyo-apato-b",
    url: `${P}/tokyo-apato-b.glb`,
    category: "apartment",
    // Verbatim source title, including its own "Japanease" typo.
    title: "Grey Japanease Apartment",
    author: "Kasuga",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("grey-japanease-apartment-8589efeb25284d709934497e02a25421"),
    attribution: "Grey Japanease Apartment by Kasuga",
  },

  // ---- Convenience store ----
  {
    id: "tokyo-konbini",
    url: `${P}/tokyo-konbini.glb`,
    category: "shop",
    title: "Konbini",
    author: "Arthur Sauvaget",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("konbini-6f66ee45303e4b90b1bcd13fad484269"),
    attribution: "Konbini by Arthur Sauvaget",
  },

  // ---- Shotengai shopfronts ----
  {
    id: "tokyo-shop-a",
    url: `${P}/tokyo-shop-a.glb`,
    category: "shop",
    title: "Japanese Store",
    author: "Nick.Stark",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("japanese-store-78396a70304b412d9bc8e3955891f6cd"),
    attribution: "Japanese Store by Nick.Stark",
  },
  {
    id: "tokyo-shop-b",
    url: `${P}/tokyo-shop-b.glb`,
    category: "shop",
    title: "Japanese low poly building store",
    author: "KingKusak",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "japanese-low-poly-building-store-565dc84823834d4884bef69944e0d4be",
    ),
    attribution: "Japanese low poly building store by KingKusak",
  },
  {
    id: "tokyo-shop-c",
    url: `${P}/tokyo-shop-c.glb`,
    category: "shop",
    title: "Old Japanese Store",
    author: "Frid.blend",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("old-japanese-store-d3442a89f7ff43ed9867d305b8951be0"),
    attribution: "Old Japanese Store by Frid.blend",
  },
  {
    id: "tokyo-shop-d",
    url: `${P}/tokyo-shop-d.glb`,
    category: "shop",
    title: "Japanese Shop 3",
    author: "Christian Camelo",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("japanese-shop-3-b8c9864f973a491fbfdc6dc0c96ed58e"),
    attribution: "Japanese Shop 3 by Christian Camelo",
  },

  // ---- Restaurant venue models (izakaya/ramen — modelId wiring for gig
  // venues is a later phase; catalogued here so the geometry/licence exist) ----
  {
    id: "tokyo-izakaya",
    url: `${P}/tokyo-izakaya.glb`,
    category: "restaurant",
    title: "Izakaya - Low Poly Building",
    author: "BenMaher",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("izakaya-low-poly-building-3f43e5429171408e9bd19553ea813364"),
    attribution: "Izakaya - Low Poly Building by BenMaher",
  },
  {
    id: "tokyo-ramen",
    url: `${P}/tokyo-ramen.glb`,
    category: "restaurant",
    title: "Ramen Shop",
    author: "Naitogosuto",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("ramen-shop-4d189bf2710f422ea287718f968cea68"),
    attribution: "Ramen Shop by Naitogosuto",
  },

  // ---- Tokyo authenticity plan, phase P3a (import-only — see the header
  // note on TOKYO_ZAKKYO_MODEL_IDS below; wiring into a BuildingSetId is
  // P3b's job). The downtown/zakkyo backbone: a split 19-building Sketchfab
  // night-city pack (props/tokyo-zakkyo-*.glb, tools/split-asian-city-pack.mjs)
  // + an optional real-Tokyo photogrammetry hero + the restyle-backbone
  // models (re-imports of already-committed CC0 sources, restyled for
  // Tokyo — tools/style-tokyo-buildings.mjs's new flat-palette path).
  {
    id: "tokyo-zakkyo-a",
    url: `${P}/tokyo-zakkyo-a.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },
  {
    id: "tokyo-zakkyo-b",
    url: `${P}/tokyo-zakkyo-b.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },
  {
    id: "tokyo-zakkyo-c",
    url: `${P}/tokyo-zakkyo-c.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },
  {
    id: "tokyo-zakkyo-d",
    url: `${P}/tokyo-zakkyo-d.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },
  {
    id: "tokyo-zakkyo-e",
    url: `${P}/tokyo-zakkyo-e.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },
  {
    id: "tokyo-zakkyo-f",
    url: `${P}/tokyo-zakkyo-f.glb`,
    category: "tower",
    title: "Asian Themed Low Poly Night City Buildings",
    author: "99.Miles",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL(
      "asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    ),
    attribution: "Asian Themed Low Poly Night City Buildings by 99.Miles",
  },

  // ---- Optional hero (heavy — 59.6k tris; a P3b/perf decision whether it
  // ever gets placed, see the plan's "market-stalls hero spot" precedent) ----
  {
    id: "tokyo-nippori-bldg",
    url: `${P}/tokyo-nippori-bldg.glb`,
    category: "midrise",
    title: "Nice building in Nippori：日暮里のいいビル",
    author: "kazugoru",
    license: "CC-BY 4.0",
    sourceUrl: SKETCHFAB_MODEL("nice-building-in-nippori-8e82ddace3af4b0681764f2cbcb77ff7"),
    attribution: "Nice building in Nippori：日暮里のいいビル by kazugoru",
  },

  // ---- Restyle backbone: re-imports of already-committed CC0 sources,
  // restyled for Tokyo (tools/style-tokyo-buildings.mjs's flat-palette
  // path) — the same "per-city restyle of a CC0 source" pattern London used
  // on Cairo's own files, one point further removed (Tokyo restyles Cairo's
  // AND NYC's committed copies, not the original Poly Pizza/Quaternius
  // downloads). No `attribution` field: CC0 permits use without credit,
  // matching every other CC0 entry in this catalogue.
  {
    id: "tokyo-walkup-a",
    url: `${P}/tokyo-walkup-a.glb`,
    category: "brownstone",
    title: "Building",
    author: "Kay Lousberg",
    license: "CC0 1.0",
    sourceUrl: src("qOhhGLftam"),
  },
  {
    id: "tokyo-walkup-b",
    url: `${P}/tokyo-walkup-b.glb`,
    category: "brownstone",
    title: "Building",
    author: "Kay Lousberg",
    license: "CC0 1.0",
    sourceUrl: src("T3oyvK6VEU"),
  },
  {
    id: "tokyo-tower-a",
    url: `${P}/tokyo-tower-a.glb`,
    category: "tower",
    title: "Skyscraper",
    author: "Kenney",
    license: "CC0 1.0",
    sourceUrl: src("XST1j6kYsL"),
  },
  {
    id: "tokyo-block-slim",
    url: `${P}/tokyo-block-slim.glb`,
    category: "midrise",
    title: "3Story_Slim_Mat",
    author: "Quaternius",
    license: "CC0 1.0",
    sourceUrl: QUATERNIUS_PACK,
  },
  {
    id: "tokyo-block-small",
    url: `${P}/tokyo-block-small.glb`,
    category: "midrise",
    title: "3Story_Small_Mat",
    author: "Quaternius",
    license: "CC0 1.0",
    sourceUrl: QUATERNIUS_PACK,
  },
  {
    id: "tokyo-block-4story",
    url: `${P}/tokyo-block-4story.glb`,
    category: "midrise",
    title: "4Story_Mat",
    author: "Quaternius",
    license: "CC0 1.0",
    sourceUrl: QUATERNIUS_PACK,
  },
];

/** The zakkyo pack's six split files — every one of the 19 original
 * buildings landed in exactly one of these (tools/split-asian-city-pack.mjs);
 * useful for tooling/tests that want "just the split, not the hero/backbone". */
export const TOKYO_ZAKKYO_MODEL_IDS: readonly string[] = [
  "tokyo-zakkyo-a",
  "tokyo-zakkyo-b",
  "tokyo-zakkyo-c",
  "tokyo-zakkyo-d",
  "tokyo-zakkyo-e",
  "tokyo-zakkyo-f",
];

/**
 * Model ids whose Sketchfab-exported submeshes carry different
 * vertex-attribute sets (some with TANGENT/extra UV channels, some
 * without) — `Mesh.MergeMeshes` (`getBuildingMaster`'s recipe, and
 * `buildingWinding.test.ts`'s own merge-and-check harness) throws "Cannot
 * merge vertex data that do not have the same set of attributes" on any of
 * these. Measured directly (P1); confirmed by a real crash the first time
 * `tokyo-house-d` actually got placed in `render/buildingLayer.ts`, P2's
 * own trap, the same class `tokyoStreetFurniture.ts`'s parked bicycles hit
 * first (docs/rendering.md's "Tokyo's own parked bicycles" section). Every
 * render path that might instantiate one of these — `BuildingLayer`, any
 * future venue/prop placement — must route it through
 * `instantiateModelInstanced` (`modelLibrary.ts`, per-submesh instancing,
 * no merge) instead of `getBuildingMaster`. The single source of truth so
 * production code and its tests (`buildingWinding.test.ts`,
 * `buildingPlacement.test.ts`) can't quietly drift apart on this list.
 *
 * Membership is a PERFORMANCE CLIFF, not a formality: the per-submesh path
 * costs one scene mesh per submesh per placement, so a listed model with
 * many primitives and many street-wall placements multiplies into the tens
 * of thousands of meshes (`tokyo-house-d`, 290 primitives x 417 placements,
 * was 87% of Tokyo's scene and the difference between 31 fps and 6 fps).
 * Before listing a model here, first try
 * `tools/normalize-glb-attributes.mjs` — when the mismatch is only unused
 * secondary UV channels (it usually is), stripping them merges the model
 * fine and keeps it off this list. `tokyo-house-d` left the list exactly
 * that way. The two remaining members genuinely mix TANGENT-bearing and
 * TANGENT-less primitives (the tool's own census, which refuses them —
 * stripping TANGENT would break their normal mapping, unlike dead UVs),
 * and both are placement-count-safe: apato-b is in no building set, ramen
 * is a lone venue prop.
 */
export const MERGE_INCOMPATIBLE_MODEL_IDS: ReadonlySet<string> = new Set([
  "tokyo-apato-b",
  "tokyo-ramen",
]);

/** Every catalogued environment model, all four kitted maps. */
export const ALL_ENV_MODELS: readonly EnvModelMeta[] = [
  ...NYC_ENV_MODELS,
  ...CAIRO_ENV_MODELS,
  ...LONDON_ENV_MODELS,
  ...TOKYO_ENV_MODELS,
];

/** De-duplicated London street-wall URLs, for map-scoped preload/tests. */
export function londonEnvModelUrls(): string[] {
  return [...new Set(LONDON_ENV_MODELS.map((m) => m.url))];
}

/** De-duplicated Cairo street-wall URLs, for map-scoped preload/tests. */
export function cairoEnvModelUrls(): string[] {
  return [...new Set(CAIRO_ENV_MODELS.map((m) => m.url))];
}

/** De-duplicated Tokyo street-wall kit URLs, for map-scoped preload/tests.
 * As of P3b, ten of P1's 13 are live in a `BuildingSetId` (P2's
 * `tokyo-house`/`tokyo-shotengai`) — `tokyo-izakaya`/`tokyo-ramen` (venue
 * models, still waiting on the plan's section 6.4 venue-wiring phase) and
 * `tokyo-apato-b` (live-measured OUT of P3b's own `tokyo-manshon` this same
 * phase — see that set's comment in `buildingSets.ts` — a real perf
 * regression, not an oversight) stay unreferenced. Twelve of P3a's 13 are
 * live too (`tokyo-zakkyo`/`tokyo-manshon`) — the optional
 * `tokyo-nippori-bldg` hero remains catalogued but unplaced (see the P3b PR
 * body for why). See `TOKYO_ENV_MODELS`'s header. */
export function tokyoEnvModelUrls(): string[] {
  return [...new Set(TOKYO_ENV_MODELS.map((m) => m.url))];
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
