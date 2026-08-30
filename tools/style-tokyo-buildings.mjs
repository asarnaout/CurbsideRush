/**
 * Normalizes the 13 Sketchfab Japanese building imports (Tokyo authenticity
 * plan section 5.2/5.3, P1) after `tools/pack-gltf.mjs` has packed each one
 * into a self-contained `public/models/props/tokyo-*.glb`. Unlike the London
 * terrace kit, these ship their own authored textures/materials rather than
 * untextured Quaternius solids — so "restyle" here is lighter-touch
 * normalization, not a palette replacement:
 *
 *   1. Strip a small, explicitly-named list of diorama/street-furniture nodes
 *      that a few of these Sketchfab exports bundle alongside the building
 *      itself (a flat ground/street slab, a generic streetlamp duplicating
 *      what this map already scatters procedurally) — see `STRIP_NODES`,
 *      one entry per affected model, each with the reasoning that justified
 *      it. This is a scene-graph *unlink* (the node is dropped from its
 *      parent's `children`/`scenes[].nodes`), not a full mesh/accessor/
 *      material/image garbage-collection pass: every stripped node here is
 *      geometrically tiny and shares its material/texture with the rest of
 *      the model, so a full GC would reclaim only a few dozen dead triangles
 *      of JSON for a lot of added index-remapping risk. The texture
 *      downscale below (step 3) is where the real byte savings are.
 *   2. Fix a real default-metal bug: a material with no `metallicFactor` and
 *      no `metallicRoughnessTexture` renders chrome-mirror per the glTF
 *      core-spec default (metallicFactor=1), which a few of house-d's small
 *      hardware materials hit. Textured PBR materials (baseColorTexture +
 *      metallicRoughnessTexture) are left untouched — the artist's authored
 *      texture already drives the look correctly, and forcing a flat
 *      roughness/metalness there would fight it for no reason.
 *   3. Downscale every embedded image whose longer side exceeds 1024 px
 *      (izakaya ships a 4096² atlas; several others ship 2048²) via `sharp`
 *      — see the file-level dependency note below.
 *   4. Raise emissive materials that would not actually bloom under this
 *      map's real night pipeline (`bloomThreshold: 0.68`, post-`exposure`
 *      `1.55`× — babylonGameSession.ts) via `KHR_materials_emissive_strength`
 *      rather than by eye: `extractHighlights.fragment` computes
 *      `luma = dot((0.2126,0.7152,0.0722), color * exposure)` and blooms iff
 *      `luma >= threshold`, i.e. raw linear luma must clear `0.68/1.55 ≈
 *      0.4387`. Measured (not guessed) against the actual shipped pixels —
 *      see `EMISSIVE_BOOSTS`'s own comments for the per-model numbers.
 *   5. Bake provenance into `asset.extras.curbsideRush`, the same shape
 *      `tools/style-london-terraces.mjs` uses.
 *
 * Dependency note: downscaling needs a real PNG/JPEG decode+resize+encode,
 * which `tools/obj-to-glb.mjs`'s "no npm converter" rule was never meant to
 * cover (that rule protects the hand-rolled, byte-pinned *geometry*
 * conversion in `pack-gltf.mjs` from moving under a dependency bump — it
 * says nothing about raster images). This script uses `sharp`
 * (https://sharp.pixelplumbing.com), which was already resolving into
 * `node_modules` as a transitive dependency (`miniflare`, itself a `wrangler`
 * dependency this repo already has for `npm run dev`, depends on it
 * directly; `next` also optionally depends on it) — declaring it as an
 * explicit devDependency in `package.json` makes that existing resolution
 * reproducible via `npm ci` rather than incidental, and does not add any new
 * binary to what a fresh checkout already installs today.
 *
 * Reproduce from clean sources: re-download each row's Sketchfab glTF export
 * (CREDITS.md has the source URL + original archive SHA-256 per model),
 * `node tools/pack-gltf.mjs <dir>/scene.gltf public/models/props/<id>.glb`,
 * then `node tools/style-tokyo-buildings.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseGlb, serializeGlb, rebuildBufferViews } from "./pack-gltf.mjs";

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "tokyo-sketchfab-v1";
const MAX_TEXTURE_DIM = 1024;
/**
 * `--ids=a,b,c` restricts BOTH loops below to the named target/backbone ids.
 * Load-bearing for reproducibility, not a convenience flag: every step in
 * `styleOne` (the Sketchfab-textured path) assumes it is running against a
 * FRESH, never-styled input — `unlinkNamedNode` throws if a node it expects
 * to unlink has already been unlinked (P1's own files already went through
 * this once), and re-deriving `modifications`' text from "what happened this
 * run" would silently change already-committed, byte-pinned files' provenance
 * even when the underlying geometry/texture bytes end up identical. A full
 * "no --ids" run is only correct starting from clean, unstyled
 * `pack-gltf.mjs`/`obj-to-glb.mjs` output (see each TARGETS entry's own
 * reproduction note) — exactly the documented regenerate-from-scratch path,
 * never an incremental re-run over already-committed glbs. This session
 * extends the P1 batch, so every invocation below filters to only the newly
 * added ids and never touches the 13 already-committed P1 files.
 */
const onlyIds = (() => {
  const arg = process.argv.find((a) => a.startsWith("--ids="));
  return arg ? new Set(arg.slice("--ids=".length).split(",")) : null;
})();
const wanted = (id) => onlyIds === null || onlyIds.has(id);

/**
 * Nodes to unlink per model, each with the geometric reasoning that
 * justified it (measured via a world-space AABB walk of the raw glTF node
 * tree, not eyeballed) — see the tool header for why this is an unlink, not
 * a full GC.
 */
const STRIP_NODES = {
  "tokyo-house-d": [
    // A paved street slab baked under the house: 4504x0x2266 (native units)
    // vs. the house itself (Casa_1) at 833x745x840 — a flat (zero Y-extent),
    // wildly oversized diorama base that would both wreck the measured
    // footprint and double/z-fight against this game's own road surface.
    "Carretera",
    // Two flat (zero Y-extent) dirt-ground patches, 692x0x1147 and
    // 175x0x87, both clearly ground dressing rather than architecture — the
    // property's own low wall/fence (kept; see the plan's "tiny setbacks
    // behind low block walls") is a separate, non-flat set of nodes.
    "Tierra_G",
    "Tierra_P",
  ],
  "tokyo-shop-b": [
    // Two nodes forming one generic "street lamp" (StreetPoste2_3 = pole,
    // StreetFarol2_2 = lamp head, same XZ position, standing just off the
    // shop's own footprint) — named "Street*", unlike the two
    // "farolJapanese*" lantern nodes flanking the shop's own frontage (kept
    // as shop decor). This map already scatters its own streetlights
    // procedurally; a second, baked-in one would duplicate that on every
    // placement of this model.
    "StreetFarol2_2",
    "StreetPoste2_3",
  ],
  "tokyo-izakaya": [
    // A flat (zero Y-extent) 1272x0x1272 ground plate under the whole
    // scene — far larger than "Base Building" (789x990x613) — the same
    // diorama-base pattern as house-d's "Carretera".
    "Floor",
  ],
};

/**
 * `KHR_materials_emissive_strength` boosts, one entry per material that
 * measurably fails to bloom as shipped. Each `strength` is sized off the
 * material's *worst* (dimmest, most important-to-read) sampled linear
 * luma so that `luma * strength * 1.55 (night exposure)` clears the 0.68
 * night bloomThreshold with real margin (~1.5-2x), not just past the raw
 * breakeven — matching the working precedent already shipped in
 * `render/tokyoLandmarks.ts` (the Hikari Tower's deck-glow material).
 */
const EMISSIVE_BOOSTS = {
  "tokyo-izakaya": {
    // "Scene_-_Root"'s emissive texture is a black atlas with a saturated-
    // red sign patch and softer magenta/purple window-glow patches.
    // Measured via sharp on the actual shipped pixels (sRGB, gamma-decoded
    // to linear before the luma dot product): the sign's red mass decodes
    // to ~(1.0, 0.006, 0.006) linear, luma ≈ 0.217 — raw, that clears only
    // 0.217*1.55 = 0.336 of the 0.68 threshold, i.e. it would render as
    // flat unlit red with no bloom. A pure-red source is luma-capped at
    // 0.2126 no matter how saturated (red is 21% of the luma weight), so
    // the fix is strength, not hue. strength 3.2 lands the sign's raw luma
    // at ~0.69 (post-exposure ~1.08), comfortably over threshold, while the
    // dimmer window-glow patches stay a softer, unclipped glow — a
    // realistic gradient between "the sign blazes" and "the windows glow".
    materials: ["Scene_-_Root"],
    strength: 3.2,
  },
  "tokyo-shop-b": {
    // Two of shop-b's four emissive materials are near-pure red
    // (emissiveFactor [1, 0.031, 0.032] and [1, 0.049, 0.069] — presumably
    // a kanji sign accent) and, being glTF core-spec factors (already
    // linear, no gamma decode needed), compute raw luma ≈ 0.237/0.252 —
    // under the 0.4387 raw floor, so as-shipped they would not bloom.
    // "EmissionWhite" (luma 1.0) and "EmissionYellow" (luma 0.942) already
    // clear the threshold by a wide margin and are left untouched.
    // strength 2.2 lands both red materials' luma at ~0.52-0.56 raw
    // (post-exposure ~0.81-0.87), clearing with the same margin as above,
    // via a strength multiplier rather than diluting the red with green
    // (which would shift the intended hue toward orange).
    materials: ["Material", "Emission"],
    strength: 2.2,
  },

  // ---- Tokyo authenticity plan P3a: the zakkyo pack split (six
  // tokyo-zakkyo-{a..f}.glb, tools/split-asian-city-pack.mjs). Each file's
  // one surviving material ships the source's own baked-in
  // `KHR_materials_emissive_strength: 2` (99.Miles' own night-window tuning,
  // for whatever generic pipeline the source scene was authored against) —
  // measured (not eyeballed) against THIS map's real bloomThreshold(0.68)/
  // exposure(1.55) via `sharp` over the actual shipped emissive PNGs
  // (2048x2048, pre-downscale): decoding every pixel to linear and averaging
  // luma over the "is this even a glow pixel" population (raw luma > 0.05,
  // ~7% of each texture; the other ~93% is near-zero non-emissive wall/roof)
  // gives a representative "typical readable window" luma of ~0.23
  // (BACKGROUND_BUILDINGS_1) / ~0.27 (BACKGROUND_BUILDING_2) — real signage/
  // window content, not the rare maxed-out (luma 1.0) hotspots or the
  // near-zero background. At the source's own strength=2: 0.23*2*1.55=0.71
  // and 0.27*2*1.55=0.84 — the dimmer family now clears 0.68 by only ~5%,
  // the brighter one by ~23%. Boosted to land both at a real ~1.75x margin
  // over threshold (0.68*1.75=1.19): strength = 1.19/(luma*1.55), giving
  // 3.34 (BUILDINGS_1, rounded up to 3.5) and 2.84 (rounded up to 3.0)
  // (BUILDING_2, already round). Applied via the SAME
  // `KHR_materials_emissive_strength` mechanism as the pre-existing entries
  // above — replaces the source's baked 2, does not stack with it.
  "tokyo-zakkyo-a": { materials: ["BACKGROUND_BUILDINGS_1"], strength: 3.5 },
  "tokyo-zakkyo-b": { materials: ["BACKGROUND_BUILDINGS_1"], strength: 3.5 },
  "tokyo-zakkyo-c": { materials: ["BACKGROUND_BUILDINGS_1"], strength: 3.5 },
  "tokyo-zakkyo-d": { materials: ["BACKGROUND_BUILDING_2"], strength: 3.0 },
  "tokyo-zakkyo-e": { materials: ["BACKGROUND_BUILDING_2"], strength: 3.0 },
  "tokyo-zakkyo-f": { materials: ["BACKGROUND_BUILDING_2"], strength: 3.0 },
  // tokyo-nippori-bldg carries no entry here on purpose: its one material is
  // KHR_materials_unlit with a baseColorTexture and no emissiveTexture at
  // all — a photogrammetry bake with its own lighting already baked into the
  // pixels, nothing for KHR_materials_emissive_strength to act on.
};

const TARGETS = [
  {
    id: "tokyo-house-a",
    title: "Japanese Residential Home 01",
    author: "Morrissey Alexander (https://sketchfab.com/reckzilla)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-residential-home-01-d690f83d8e8d48e6a532bebe84901595",
    sourceSha256:
      "8788dc786017a99a931307f8adfd8c2c4961423b5470324dd80b2ff6837131f5",
  },
  {
    id: "tokyo-house-b",
    title: "Japanese Residential Home 02",
    author: "Morrissey Alexander (https://sketchfab.com/reckzilla)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-residential-home-02-c31697f09152453cb3ed215482e7a810",
    sourceSha256:
      "825aed04802350d83503e84d39a4012f8c34395da7a28d4ead74ace200edc9a9",
  },
  {
    id: "tokyo-house-c",
    title: "Japanese Residential Home 03",
    author: "Morrissey Alexander (https://sketchfab.com/reckzilla)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-residential-home-03-1c53f4f37fc44c32a8874464025aea48",
    sourceSha256:
      "911b4a5d52872135e73136ffccaef7c4d30daabbbbfca3acfe128e547903404e",
  },
  {
    id: "tokyo-house-d",
    title: "Tokyo Japanese House / Casa Japonesa [Low Poly]",
    author: "SitoNyaa (https://sketchfab.com/SitoNyaa)",
    sourceUrl:
      "https://sketchfab.com/3d-models/tokyo-japanese-house-casa-japonesa-low-poly-05e04ee0c3d04ff9a2fe4c348b3c1bcd",
    sourceSha256:
      "cfe54e8c25daf66cb2c43a4519c6506ee86708b44744bf4709fcc7a3a8e8d2c0",
  },
  {
    id: "tokyo-apato-a",
    title: "PSX Japanese Apartment",
    // Sketchfab's own embedded asset.extras.author (freshest, authoritative
    // — baked server-side into the export) says "DeadFrame Studio", not the
    // "Shazly" the plan's research manifest recorded; the uid/URL agree on
    // the model, so this is a corrected author, not a different model.
    author: "DeadFrame Studio (https://sketchfab.com/DeadFrame)",
    sourceUrl:
      "https://sketchfab.com/3d-models/psx-japanese-apartment-0a12452df55c4e3687759732c81a8437",
    sourceSha256:
      "c4cae7d69a95f07b190fa236c01eb308c2b9ede31d7c51985e09a5e6f377578e",
  },
  {
    id: "tokyo-apato-b",
    // Verbatim source title, including its own "Japanease" typo.
    title: "Grey Japanease Apartment",
    author: "Kasuga𓅂 (https://sketchfab.com/kasuga)",
    sourceUrl:
      "https://sketchfab.com/3d-models/grey-japanease-apartment-8589efeb25284d709934497e02a25421",
    sourceSha256:
      "8969bd766b81998af72cb91d116fcb0c8f24250dbef3bd350b2afa5821c79295",
  },
  {
    id: "tokyo-konbini",
    title: "Konbini",
    author: "Arthur Sauvaget (https://sketchfab.com/hapsky)",
    sourceUrl:
      "https://sketchfab.com/3d-models/konbini-6f66ee45303e4b90b1bcd13fad484269",
    sourceSha256:
      "cd48ed4f594929f5ded7a85ee406b961f1f0ea3897288ba2daff1af3649c1763",
  },
  {
    id: "tokyo-shop-a",
    title: "Japanese Store",
    author: "Nick.Stark (https://sketchfab.com/Nick.Stark)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-store-78396a70304b412d9bc8e3955891f6cd",
    sourceSha256:
      "342dda42209437ad61404d2ef6f8e5e714ad330362b9a669abc1a10fe48fcff3",
  },
  {
    id: "tokyo-shop-b",
    title: "Japanese low poly building store",
    author: "KingKusak (https://sketchfab.com/KingKusak)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-low-poly-building-store-565dc84823834d4884bef69944e0d4be",
    sourceSha256:
      "f60efe983d8270a78b8f63f7a303c9ac3e11c885d22946a6ebf437c468408409",
  },
  {
    id: "tokyo-shop-c",
    title: "Old Japanese Store",
    author: "Frid.blend (https://sketchfab.com/Fridqeir)",
    sourceUrl:
      "https://sketchfab.com/3d-models/old-japanese-store-d3442a89f7ff43ed9867d305b8951be0",
    sourceSha256:
      "f3fb1f62142511d7787f50acad4ea07429915f83f02f1d3422808d371cbc0946",
  },
  {
    id: "tokyo-shop-d",
    title: "Japanese Shop 3",
    author: "Christian Camelo (https://sketchfab.com/christiances)",
    sourceUrl:
      "https://sketchfab.com/3d-models/japanese-shop-3-b8c9864f973a491fbfdc6dc0c96ed58e",
    sourceSha256:
      "16558727c8ef82c9d8b578e026af27240aa48b6a171db898a88e853c70f78eb8",
  },
  {
    id: "tokyo-izakaya",
    title: "Izakaya - Low Poly Building",
    author: "BenMaher (https://sketchfab.com/BenMaher)",
    sourceUrl:
      "https://sketchfab.com/3d-models/izakaya-low-poly-building-3f43e5429171408e9bd19553ea813364",
    sourceSha256:
      "5336a59fd4a2c412b2650c97350585fa4cadb7c688c3075f1f5384d88d4343d8",
  },
  {
    id: "tokyo-ramen",
    title: "Ramen Shop",
    author: "Naitogosuto (https://sketchfab.com/ddar1342)",
    sourceUrl:
      "https://sketchfab.com/3d-models/ramen-shop-4d189bf2710f422ea287718f968cea68",
    sourceSha256:
      "2dd4df0a181e3d6aa6c5558ee2dcc481a22f410914a291e0719d27e85bce1b3a",
  },

  // ---- Tokyo authenticity plan P3a: the zakkyo pack split. All six derived
  // files share ONE source archive (99.Miles' 19-building pack) — recorded
  // under the one source entry in CREDITS.md per the plan's instruction, so
  // `sourceUrl`/`sourceSha256` are identical across all six; `title`
  // distinguishes which of the 19 original buildings each file carries
  // (tools/split-asian-city-pack.mjs's own console report is the source of
  // this list — re-run it to reproduce/verify). Every file already ships
  // self-contained (packGltf ran inside the split tool itself), so this pass
  // only downscales its one 2048x2048 texture set and raises emissive
  // strength (EMISSIVE_BOOSTS above) — no STRIP_NODES entry needed (the
  // split tool already dropped every flare/glow card before packing) and
  // fixDefaultMetalMaterials is a real no-op (both source materials already
  // declare metallicFactor: 0 explicitly).
  {
    id: "tokyo-zakkyo-a",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDINGS_1.009, .001, .002, .005)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },
  {
    id: "tokyo-zakkyo-b",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDINGS_1.008, .007, .004)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },
  {
    id: "tokyo-zakkyo-c",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDINGS_1 base, .006, .003)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },
  {
    id: "tokyo-zakkyo-d",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDING_2 base, .001, .002)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },
  {
    id: "tokyo-zakkyo-e",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDING_2.007, .005, .004)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },
  {
    id: "tokyo-zakkyo-f",
    title:
      "Asian Themed Low Poly Night City Buildings (split: BACKGROUND_BUILDING_2.008, .003, .006)",
    author: "99.Miles (https://sketchfab.com/99.Miles)",
    sourceUrl:
      "https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0",
    sourceSha256:
      "2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9",
  },

  // ---- Tokyo authenticity plan P3a: the optional Nippori hero. Single
  // KHR_materials_unlit material (a photogrammetry bake — its own lighting
  // is already in the pixels), so only the downscale step in `styleOne`
  // actually does anything for this one (8192x8192 -> <=1024px).
  {
    id: "tokyo-nippori-bldg",
    title: "Nice building in Nippori：日暮里のいいビル",
    author: "kazugoru (https://sketchfab.com/kazugoru)",
    sourceUrl:
      "https://sketchfab.com/3d-models/nice-building-in-nippori-8e82ddace3af4b0681764f2cbcb77ff7",
    sourceSha256:
      "eec70c5993f89fd9ea6cffe5b10d4505a5e13aaac0d7a87a9f4c5d963dbe01fb",
  },
];

/** Unlinks a named node from wherever the scene graph references it (a
 * top-level `scenes[].nodes` entry or some node's `children`). Throws if the
 * name doesn't resolve or isn't linked anywhere — a silent no-op here would
 * ship the diorama clutter this exists to remove. */
function unlinkNamedNode(json, name) {
  const nodeIndex = json.nodes.findIndex((n) => n.name === name);
  if (nodeIndex < 0) throw new Error(`node not found: ${name}`);
  let unlinked = false;
  for (const scene of json.scenes ?? []) {
    const i = scene.nodes?.indexOf(nodeIndex) ?? -1;
    if (i >= 0) {
      scene.nodes.splice(i, 1);
      unlinked = true;
    }
  }
  for (const node of json.nodes ?? []) {
    const i = node.children?.indexOf(nodeIndex) ?? -1;
    if (i >= 0) {
      node.children.splice(i, 1);
      unlinked = true;
    }
  }
  if (!unlinked)
    throw new Error(
      `node ${name} (index ${nodeIndex}) was not linked anywhere`,
    );
  return nodeIndex;
}

/** glTF core-spec default when `metallicFactor` is omitted is 1 (fully
 * metal); a material with no metallic/roughness texture to drive that
 * per-texel then renders chrome-mirror, which is never the intent for a
 * building's plaster/wood/tile/handle materials. Only fires where nothing
 * already drives metalness. */
function fixDefaultMetalMaterials(json) {
  const fixed = [];
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness;
    if (!pbr) continue;
    if (pbr.metallicRoughnessTexture) continue; // texture-driven — trust it
    if (pbr.metallicFactor !== undefined) continue; // already explicit
    pbr.metallicFactor = 0;
    fixed.push(material.name ?? "(unnamed)");
  }
  return fixed;
}

function applyEmissiveStrength(json, boost) {
  const applied = [];
  for (const material of json.materials ?? []) {
    if (!boost.materials.includes(material.name)) continue;
    material.extensions = {
      ...(material.extensions ?? {}),
      KHR_materials_emissive_strength: { emissiveStrength: boost.strength },
    };
    applied.push(material.name);
  }
  json.extensionsUsed = [
    ...new Set([
      ...(json.extensionsUsed ?? []),
      "KHR_materials_emissive_strength",
    ]),
  ];
  return applied;
}

/** Downscales every embedded image whose longer side exceeds `MAX_TEXTURE_DIM`,
 * re-encoding in its original format. Returns the bufferView-index ->
 * new-bytes replacements for `rebuildBufferViews`, plus a report. */
async function downscaleOversizedImages(json, bin) {
  const replacements = new Map();
  const report = [];
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) continue;
    const view = json.bufferViews[image.bufferView];
    const bytes = bin.subarray(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    );
    const pipeline = sharp(bytes);
    const meta = await pipeline.metadata();
    const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longSide <= MAX_TEXTURE_DIM) continue;
    const resized = pipeline.resize({
      width: MAX_TEXTURE_DIM,
      height: MAX_TEXTURE_DIM,
      fit: "inside",
      withoutEnlargement: true,
    });
    const out =
      image.mimeType === "image/jpeg"
        ? await resized.jpeg({ quality: 90 }).toBuffer()
        : await resized.png({ compressionLevel: 9 }).toBuffer();
    replacements.set(image.bufferView, out);
    report.push({
      name: image.name ?? `image[${image.bufferView}]`,
      from: `${meta.width}x${meta.height}`,
      to: `<=${MAX_TEXTURE_DIM}`,
      fromBytes: bytes.length,
      toBytes: out.length,
    });
  }
  return { replacements, report };
}

async function styleOne(target) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  let { json, bin } = parseGlb(fs.readFileSync(file));

  const strippedNames = STRIP_NODES[target.id] ?? [];
  for (const name of strippedNames) unlinkNamedNode(json, name);

  const metalFixed = fixDefaultMetalMaterials(json);

  const emissiveBoost = EMISSIVE_BOOSTS[target.id];
  const emissiveApplied = emissiveBoost
    ? applyEmissiveStrength(json, emissiveBoost)
    : [];
  if (
    emissiveBoost &&
    emissiveApplied.length !== emissiveBoost.materials.length
  ) {
    throw new Error(
      `${target.id}: expected emissive-strength materials [${emissiveBoost.materials}], found [${emissiveApplied}]`,
    );
  }

  const { replacements, report: textureReport } =
    await downscaleOversizedImages(json, bin);
  if (replacements.size) {
    bin = rebuildBufferViews(json, bin, replacements);
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      style: STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC-BY 4.0",
      sourceUrl: target.sourceUrl,
      sourceSha256: target.sourceSha256,
      modifications: [
        "Packed from a Sketchfab glTF (.gltf+.bin+images) export into a self-contained glb (tools/pack-gltf.mjs)",
        strippedNames.length
          ? `stripped diorama/street-furniture nodes: ${strippedNames.join(", ")}`
          : null,
        metalFixed.length
          ? `set metallicFactor=0 on default-metal materials with no metallic/roughness texture: ${metalFixed.join(", ")}`
          : null,
        emissiveApplied.length
          ? `raised night-bloom emissive via KHR_materials_emissive_strength on ${emissiveApplied.join(", ")} (measured against the real bloomThreshold/exposure, not eyeballed)`
          : null,
        textureReport.length
          ? `downscaled ${textureReport.length} texture(s) to <=${MAX_TEXTURE_DIM}px`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, bin));

  const before = fs.statSync(file).size;
  console.log(`${target.id}:`);
  if (strippedNames.length)
    console.log(`  stripped: ${strippedNames.join(", ")}`);
  if (metalFixed.length)
    console.log(`  metallicFactor=0 fixed: ${metalFixed.join(", ")}`);
  if (emissiveApplied.length) {
    console.log(
      `  emissive strength ${emissiveBoost.strength}x: ${emissiveApplied.join(", ")}`,
    );
  }
  for (const t of textureReport) {
    console.log(
      `  texture ${t.name}: ${t.from} -> ${t.to} (${t.fromBytes}B -> ${t.toBytes}B)`,
    );
  }
  console.log(
    `  file size: ${before} bytes${dry ? " (dry run, not written)" : ""}`,
  );
}

for (const target of TARGETS) {
  if (!wanted(target.id)) continue;
  await styleOne(target);
}

/**
 * ---------------------------------------------------------------------------
 * Flat-palette path — the restyle-backbone models (Tokyo authenticity plan
 * section 5.3/P3a). Unlike the Sketchfab batch above, these are re-imports of
 * already-committed CC0 sources: untextured Quaternius solids (named
 * materials, direct colour assignment — `tools/style-london-terraces.mjs`'s
 * shape) or a KayKit swatch-atlas texture (`tools/style-cairo-residences.mjs`'s
 * `texturePalette` shape, but a Tokyo-appropriate tone function — see
 * `tokyoManshonGreyTone` below). Two sub-paths, one per source shape:
 *
 *   - `materialPalette`: solid named materials -> direct hex assignment
 *     (tokyo-tower-a, copied from nyc-tower-a.glb; tokyo-block-{slim,small,
 *     4story}, freshly converted from the Quaternius Ultimate Textured
 *     Buildings Pack via tools/obj-to-glb.mjs, same OBJ+MTL sources
 *     cairo-block-{slim,small,4story}.glb already used — re-verified
 *     byte-identical to those files' own recorded source hashes).
 *   - `texturePalette`: one embedded swatch-atlas image, recoloured pixel by
 *     pixel (tokyo-walkup-{a,b}, copied from cairo-walkup-{a,b}.glb).
 * ---------------------------------------------------------------------------
 */
const TOKYO_BLOCK_STYLE_ID = "tokyo-block-v1";

const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

function linearColor(hex) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return [...channels.map((channel) => srgbToLinear(channel / 255)), 1];
}

/**
 * Shared across the three Quaternius conversions (same material-name
 * convention as Cairo/London's own copies of this pack). Each model varies
 * `Main` (the wall) and, for the cool-grey 4story variant, its own `Light`/
 * `White` too — not every model uses every key (tokyo-block-slim has no
 * `Glass`, tokyo-block-small has no `Black`, tokyo-block-4story has no
 * `Light`/`DarkWood`/`Wood` — `styleMaterialPaletteOne` only applies a key
 * that matches a material name actually present in that file, so the unused
 * ones are harmless).
 */
const TOKYO_BLOCK_BASE = {
  Black: "#1c1c1e",
  Bricks: "#4a3f3a", // muted dark tile-brown, not exposed brick-red
  Dark: "#3a3a3d",
  DarkWood: "#2b2622",
  Glass: "#485760",
  Light: "#d8d4c8", // the "light fascia band" the plan asks for
  White: "#e0ddd2",
  Windows: "#425260",
  Wood: "#3a2f28",
};

const MATERIAL_PALETTE_TARGETS = [
  {
    id: "tokyo-tower-a",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/XST1j6kYsL",
    sourceSha256:
      "43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c",
    modifications:
      "Copied from the committed nyc-tower-a.glb (same source model as cairo-tower-a.glb/london-tower-a.glb — modelLibrary keys asset containers by URL, so each city needs its own file); steel-blue-dark palette and matte material pass for the scramble backdrop.",
    materialPalette: {
      border: "#20262e",
      window: "#26404f",
      _defaultMat: "#2b3038",
      door: "#0d1014",
    },
  },
  {
    id: "tokyo-block-slim",
    author: "Quaternius",
    title: "3Story_Slim_Mat",
    sourceUrl: "https://quaternius.com/packs/ultimatetexturedbuildings.html",
    sourceSha256:
      "obj:778673a3cd8508d7b484c2b243fde8b59ebda9b507dcbf9198daa3a02429fe3f;mtl:6f97086bad010e876d8bc35b0a51d9cabca187eca8250ce77e412a332ceb4692",
    modifications:
      "Converted from OBJ+MTL by tools/obj-to-glb.mjs (source hashes re-verified byte-identical to cairo-block-slim.glb's own recorded source — same pack, same download); charcoal/tile palette with a light fascia band and matte material pass for the narrow-frontage zakkyo mid-rise.",
    materialPalette: { ...TOKYO_BLOCK_BASE, Main: "#3d3a38" },
  },
  {
    id: "tokyo-block-small",
    author: "Quaternius",
    title: "3Story_Small_Mat",
    sourceUrl: "https://quaternius.com/packs/ultimatetexturedbuildings.html",
    sourceSha256:
      "obj:26377da6033df73d46eed0a1953ac149e07c93eb4b10d0587417e16cd7bd8863;mtl:cac01cb1df1d5022e574e03ed02e73b6c199f6f55350b1f411fb9906386390fa",
    modifications:
      "Converted from OBJ+MTL by tools/obj-to-glb.mjs (source hashes re-verified byte-identical to cairo-block-small.glb's own recorded source); charcoal/tile palette with a light fascia band and matte material pass for the narrow-frontage zakkyo mid-rise.",
    materialPalette: { ...TOKYO_BLOCK_BASE, Main: "#4a4644" },
  },
  {
    id: "tokyo-block-4story",
    author: "Quaternius",
    title: "4Story_Mat",
    sourceUrl: "https://quaternius.com/packs/ultimatetexturedbuildings.html",
    sourceSha256:
      "obj:d326d20f0c29ad2499132dd7773aacab675946efadf18f56a926a5a8d004366a;mtl:df1c8f0fdff17e0fecffec423d57f240011a024d9d16b16ff092dfe8e72fb44a",
    modifications:
      "Converted from OBJ+MTL by tools/obj-to-glb.mjs (source hashes re-verified byte-identical to cairo-block-4story.glb's own recorded source); cool-grey palette and matte material pass for the ekimae mixed-use block.",
    materialPalette: {
      ...TOKYO_BLOCK_BASE,
      Main: "#767b82",
      Light: "#c9cdd2",
      White: "#d8dbe0",
    },
  },
];

const TEXTURE_PALETTE_TARGETS = [
  {
    id: "tokyo-walkup-a",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/qOhhGLftam",
    sourceSha256:
      "a98d4fa6bf1e261da717fbdeef7937ef7578af86db3ba31a14296d814cf44e65",
    modifications:
      "Copied from the committed cairo-walkup-a.glb (KayKit City Builder Bits; modelLibrary keys asset containers by URL, so Tokyo needs its own file even though the source model is identical); the shared swatch-atlas texture recoloured to a near-neutral white/grey render (per-pixel lightness preserved, saturation forced near zero, a slight cool tint — see tokyoManshonGreyTone) rather than Cairo's warm hue-band remap, and a matte material pass. Flat-roofed manshon; rooftop water tank is geometry, untouched by this texture-only pass.",
  },
  {
    id: "tokyo-walkup-b",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/T3oyvK6VEU",
    sourceSha256:
      "ecda4d8e3a89bb751f61e179725ca59d2a19f7f3aa88fedd4fc371eb8f0eaede",
    modifications:
      "Copied from the committed cairo-walkup-b.glb; the shared swatch-atlas texture recoloured to a near-neutral white/grey render and a matte material pass. Flat-roofed manshon; rooftop water tank untouched.",
  },
];

async function styleMaterialPaletteOne(target) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const { json, bin } = parseGlb(fs.readFileSync(file));

  const applied = [];
  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.88;
    const color = target.materialPalette?.[material.name];
    if (color) {
      pbr.baseColorFactor = linearColor(color);
      applied.push(material.name);
    }
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      style: TOKYO_BLOCK_STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC0-1.0",
      sourceUrl: target.sourceUrl,
      sourceSha256: target.sourceSha256,
      modifications: target.modifications,
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(`${target.id}: palette applied to [${applied.join(", ")}]`);
}

/**
 * Desaturates toward a cool near-neutral grey while PRESERVING the source
 * swatch atlas's existing light/dark structure — window-frame swatches,
 * already darker than wall swatches in the atlas, stay dark; wall swatches
 * stay light. Ignores input hue entirely (unlike Cairo's `cairoTone`
 * hue-band remap): the plan's own words for this restyle are "white/grey
 * render, dark window frames", i.e. near-zero saturation is the actual goal,
 * not a different target hue, so re-deriving a fixed cool-grey tint purely
 * from each pixel's own lightness is the more direct tool for the job.
 */
function tokyoManshonGreyTone(r, g, b) {
  const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  return [lightness * 0.95, lightness * 0.98, lightness * 1.04].map((value) =>
    Math.max(0, Math.min(255, Math.round(value))),
  );
}

async function recolorSwatchTexture(pngBytes, toneFn) {
  const image = sharp(pngBytes);
  const { width, height } = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const cache = new Map();
  for (let offset = 0; offset < data.length; offset += channels) {
    const key =
      (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let next = cache.get(key);
    if (!next) {
      next = toneFn(data[offset], data[offset + 1], data[offset + 2]);
      cache.set(key, next);
    }
    data[offset] = next[0];
    data[offset + 1] = next[1];
    data[offset + 2] = next[2];
  }
  return sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function styleTexturePaletteOne(target) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const { json, bin } = parseGlb(fs.readFileSync(file));

  const replacements = new Map();
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) continue;
    const view = json.bufferViews[image.bufferView];
    const bytes = bin.subarray(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    );
    replacements.set(
      image.bufferView,
      await recolorSwatchTexture(bytes, tokyoManshonGreyTone),
    );
  }
  const nextBin = replacements.size
    ? rebuildBufferViews(json, bin, replacements)
    : bin;

  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.88;
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      style: TOKYO_BLOCK_STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC0-1.0",
      sourceUrl: target.sourceUrl,
      sourceSha256: target.sourceSha256,
      modifications: target.modifications,
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, nextBin));
  console.log(
    `${target.id}: texture recoloured (${replacements.size} image(s))`,
  );
}

for (const target of MATERIAL_PALETTE_TARGETS) {
  if (!wanted(target.id)) continue;
  await styleMaterialPaletteOne(target);
}
for (const target of TEXTURE_PALETTE_TARGETS) {
  if (!wanted(target.id)) continue;
  await styleTexturePaletteOne(target);
}
