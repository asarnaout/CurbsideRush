/**
 * Kenney Nature Kit -> Curbside Rush park planting.
 *
 * Two corrections, both mandatory, both applied to the JSON chunk only so the
 * binary chunk stays byte-identical to the source and the committed SHA-256 in
 * CREDITS.md means something.
 *
 * 1. **Matte.** Every material in the kit ships `metallicFactor: 1,
 *    roughnessFactor: 1`. Babylon renders that as dark plastic — the same
 *    problem `tools/style-cairo-residences.mjs` and `tools/cairo-boats.mjs`
 *    were written for.
 *
 * 2. **Colour.** The kit's palette is a toy blockset, and not in the way the
 *    swatch names suggest: `leafsGreen` is linear (0.16, 0.79, 0.67), which is
 *    a bright turquoise, and `woodBark` is orange. Left alone, a park would be
 *    planted with mint-green lollipops. Because the whole kit shares 23
 *    material names, one mapping by name recolours all of it consistently —
 *    which is the reason this pack was chosen over an atlas-textured one.
 *
 * Per-city tint is deliberately NOT baked here. It happens at runtime through
 * per-instance colour, so one file serves four palettes; baking would multiply
 * the files by four and undo the map-scoping in `natureCatalog.ts`.
 *
 * Usage: node tools/style-nature-pack.mjs <source-dir> <out-dir>
 */
import fs from "node:fs";
import path from "node:path";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

/** sRGB hex to the linear floats glTF's `baseColorFactor` actually wants. */
const linear = (hex) => {
  const value = parseInt(hex.replace("#", ""), 16);
  return [16, 8, 0].map((shift) => {
    const s = ((value >> shift) & 0xff) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
};

/**
 * Material name -> the colour it should have been. Names are shared across all
 * 329 models in the kit, so this table is the whole recolour.
 */
const PALETTE = {
  leafsGreen: "#4c7a3f",
  leafsDark: "#37603a",
  leafsFall: "#b4682c",
  woodBark: "#5b4432",
  woodBarkDark: "#463527",
  woodBirch: "#b9b3a4",
  woodInner: "#8a6b4a",
  wood: "#7a5c3f",
  woodDark: "#5a4430",
  // `grass` dresses the bushes and the rock bases, not the ground plane.
  grass: "#4f7d43",
  stone: "#8d8a83",
  stoneDark: "#6d6a64",
  dirt: "#6b5a41",
  dirtDark: "#54452f",
  colorRed: "#b8443c",
  colorYellow: "#d8b64a",
  colorPurple: "#8e6aa8",
  colorWhite: "#ddd8cc",
  colorTan: "#c2a878",
  _defaultMat: "#8a8478",
};

const STYLE_ID = "curbside-nature-v1";

function styleGlb(sourcePath, outPath) {
  const buffer = fs.readFileSync(sourcePath);
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${sourcePath}: not a GLB`);
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== CHUNK_JSON) {
    throw new Error(`${sourcePath}: first chunk is not JSON`);
  }
  const json = JSON.parse(buffer.slice(20, 20 + jsonLength).toString("utf8"));
  const rest = buffer.slice(20 + jsonLength);

  let recoloured = 0;
  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.9;
    const hex = PALETTE[material.name];
    if (!hex) {
      throw new Error(
        `${sourcePath}: no palette entry for material "${material.name}" — ` +
          "add one rather than shipping the kit's own colour",
      );
    }
    const alpha = pbr.baseColorFactor?.[3] ?? 1;
    pbr.baseColorFactor = [...linear(hex), alpha];
    recoloured += 1;
  }

  json.asset = { ...json.asset, extras: { ...(json.asset?.extras ?? {}) } };
  json.asset.extras.curbsideRush = {
    style: STYLE_ID,
    source: "Kenney Nature Kit 2.1 (CC0)",
    note: "matte + natural palette; geometry untouched",
  };

  // Re-encode. Pad the JSON chunk to 4 bytes with spaces, as the spec requires
  // and as every reader assumes.
  let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + rest.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  fs.writeFileSync(
    outPath,
    Buffer.concat([header, jsonHeader, jsonBytes, rest]),
  );
  return recoloured;
}

/** Source file -> the name it ships under. Prefixed so the kit is greppable. */
const MODELS = {
  "tree_default.glb": "nature-tree-broadleaf.glb",
  "tree_oak.glb": "nature-tree-oak.glb",
  "tree_tall.glb": "nature-tree-tall.glb",
  "tree_small.glb": "nature-tree-small.glb",
  "tree_pineTallB.glb": "nature-conifer-tall.glb",
  "tree_pineRoundC.glb": "nature-conifer-round.glb",
  "tree_palmTall.glb": "nature-palm-tall.glb",
  "tree_palmShort.glb": "nature-palm-short.glb",
  "plant_bush.glb": "nature-bush.glb",
  "plant_bushLarge.glb": "nature-bush-large.glb",
  "plant_bushTriangle.glb": "nature-bush-clipped.glb",
  "flower_redA.glb": "nature-flower-red.glb",
  "flower_yellowA.glb": "nature-flower-yellow.glb",
  "grass.glb": "nature-grass-tuft.glb",
  "grass_large.glb": "nature-grass-tuft-large.glb",
  "rock_largeA.glb": "nature-rock-large.glb",
  "rock_smallB.glb": "nature-rock-small.glb",
  "statue_obelisk.glb": "nature-obelisk.glb",
};

const [sourceDir, outDir] = process.argv.slice(2);
if (!sourceDir || !outDir) {
  console.error("usage: node tools/style-nature-pack.mjs <source-dir> <out-dir>");
  process.exit(1);
}
for (const [source, target] of Object.entries(MODELS)) {
  const from = path.join(sourceDir, source);
  const to = path.join(outDir, target);
  const count = styleGlb(from, to);
  console.log(
    `${target.padEnd(34)} ${String(fs.statSync(to).size).padStart(7)}B  ${count} materials`,
  );
}
