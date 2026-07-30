/**
 * Bakes Curbside Rush's Cairo palette into every imported CC0 Cairo building GLB.
 *
 * Reproduce from clean sources:
 *   1. Copy each Poly Pizza `.glb` to its `public/models/props/cairo-*.glb` name
 *      (Kay Lousberg walk-ups, Kenney towers).
 *   2. Convert each Quaternius `*_Mat.obj` (OBJ + MTL) with
 *      `node tools/obj-to-glb.mjs <in.obj> <out.glb>`, writing to its
 *      `cairo-*.glb` name.
 *   3. Run `node tools/style-cairo-residences.mjs`.
 *
 * Two palette paths, picked per source pack:
 *   - `texturePalette: true` — the model carries one embedded gradient atlas
 *     (KayKit, Kenney). Saturated toy colours are remapped through
 *     CAIRO_HUE_BANDS while neutral windows/trim keep their shading.
 *   - `materialPalette` — the model has named solid materials (Quaternius), so
 *     each is assigned a Cairo colour directly.
 * Every model is made matte and receives embedded provenance metadata.
 *
 * ROOF RULE: nothing with a pitched roof may be added here. Cairo's building
 * stock is flat-roofed and a gable reads as European the moment it appears on
 * the street wall. Quaternius names the offenders — never import a source whose
 * filename contains `GableRoof`, `RoundRoof` or `_Roof_` — and
 * `tests/cairoRoofs.test.ts` measures the committed geometry so a mis-picked
 * source cannot land silently.
 *
 * Every source is CC0 1.0; exact source URLs and checksums are in CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "cairo-residence-v1";

/**
 * Shared across the Quaternius pack — every model in it reuses the same nine or
 * so material names, so only the wall tone needs to vary per building.
 * `Windows` and `DarkBrown` appear on the wider models only.
 */
const QUATERNIUS_BASE = {
  Black: "#292827",
  Bricks: "#ad705e",
  Dark: "#574b41",
  DarkBrown: "#4b3027",
  DarkWood: "#4b3027",
  Glass: "#71868b",
  Light: "#ddd0b4",
  Main: "#c6aa79",
  White: "#e7dece",
  Windows: "#5d7075",
  Wood: "#79503a",
};

/**
 * A single sand tone repeated down a street reads as copy-paste, which is the
 * one thing a long Corniche run cannot afford. Real Cairo renders sit in a
 * narrow band — sand, cream, ochre, pale stone, weathered concrete — so each
 * model gets its own point in that band rather than a random hue.
 */
const quaternius = (id, title, sourceSha256, wall, extra = {}) => ({
  id,
  author: "Quaternius",
  title,
  sourceUrl: "https://quaternius.com/packs/ultimatetexturedbuildings.html",
  creatorUrl: "https://quaternius.com",
  sourceSha256,
  materialPalette: { ...QUATERNIUS_BASE, Main: wall, ...extra },
});

const TARGETS = [
  {
    id: "cairo-residence-kay",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/otRsYa6pan",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "5ebaa83522c99c877e28b9c482aa8629226d574fa398dc91ba71430d4e38e290",
    texturePalette: true,
  },
  {
    id: "cairo-residence-quaternius",
    author: "Quaternius",
    title: "3Story_Balcony_Mat",
    sourceUrl:
      "https://quaternius.com/packs/ultimatetexturedbuildings.html",
    creatorUrl: "https://quaternius.com",
    sourceSha256:
      "obj:a44feafee3fc6a6f5f891cbcdb66ad68e7114d4d379cfcae3ad5ea1fad14a345;mtl:5454773af5b796b58e33b1774ce60429098ff50c0139c6a540b23a48f6fd69eb",
    materialPalette: {
      Black: "#292827",
      Bricks: "#ad705e",
      Dark: "#574b41",
      DarkWood: "#4b3027",
      Glass: "#71868b",
      Light: "#ddd0b4",
      Main: "#c6aa79",
      White: "#e7dece",
      Wood: "#79503a",
    },
  },

  // ---- Street-wall blocks (Quaternius, flat-roofed only) ----
  quaternius(
    "cairo-block-balcony",
    "2Story_Balcony_Mat",
    "obj:e00078c7618953cefcc39e16277b9a275cef0957e0daf081b72517fb0f790e5b;mtl:69fe57424d6ed1bf663e9a62bee02b98cc9110d7adfd529dce6609c95b060234",
    "#d8c9a6", // cream
  ),
  quaternius(
    "cairo-block-colonnade",
    "2Story_Columns_Mat",
    "obj:faa0b597a7f6577a447081e3dc9dc7785aa4d70000eb691c5c9f9d7dbba45799;mtl:35047f8b42ff72b66b2e815ff8092863775ba101776add759dccd0503bba675e",
    "#cfc3a8", // pale stone
  ),
  quaternius(
    "cairo-block-terrace",
    "2Story_Wide_Mat",
    "obj:3af55ffba86a236169814f39de768d5a496afaee63d0ad0a3aa2fd3a6d2900f5;mtl:6585298a9dacd61bc71768ab0267e72d7111aad2ea2b57e26f8a32a8bc4e27a8",
    "#c6aa79", // sand
  ),
  quaternius(
    "cairo-block-slim",
    "3Story_Slim_Mat",
    "obj:778673a3cd8508d7b484c2b243fde8b59ebda9b507dcbf9198daa3a02429fe3f;mtl:6f97086bad010e876d8bc35b0a51d9cabca187eca8250ce77e412a332ceb4692",
    "#b8975e", // ochre
  ),
  quaternius(
    "cairo-block-small",
    "3Story_Small_Mat",
    "obj:26377da6033df73d46eed0a1953ac149e07c93eb4b10d0587417e16cd7bd8863;mtl:cac01cb1df1d5022e574e03ed02e73b6c199f6f55350b1f411fb9906386390fa",
    "#c2b49a", // warm grey
  ),
  quaternius(
    "cairo-block-4story",
    "4Story_Mat",
    "obj:d326d20f0c29ad2499132dd7773aacab675946efadf18f56a926a5a8d004366a;mtl:df1c8f0fdff17e0fecffec423d57f240011a024d9d16b16ff092dfe8e72fb44a",
    "#c6aa79", // sand
  ),
  quaternius(
    "cairo-block-4story-centre",
    "4Story_Center_Mat",
    "obj:7b457088cfd108df84cb534cc46837595382a34b59fc148893a3eaec2c99462f;mtl:0c1dae7711350389ea8988da39022704821861862a81127f99120a398fe01e58",
    "#b3ada0", // weathered concrete
  ),

  // ---- Gig-venue replacements for the pitched-roof office.glb ----
  quaternius(
    "cairo-office-block",
    "4Story_Wide_2Doors_Mat",
    "obj:d489f21bc4c06b0315ad81670f511adf44edbfcc10084668bbed83c97261b54b;mtl:39ecc25676df1db1d9b85e9041e844f28b0cc5b2587e3ef2f25ee5707b5b6ea5",
    "#cfc3a8",
  ),
  quaternius(
    "cairo-depot",
    "2Story_Wide_2Doors_Mat",
    "obj:eb46c1b5ef9fe4c0c91a97a5d10f082d590f7cc2c3960b94e94610ec2c818bc3;mtl:fb8b60be78ed5ec844899916136c77d512f668819403fbf0898d462c747a169a",
    "#b3ada0",
  ),

  // ---- Walk-ups: the KayKit family, flat roofs with their own water tanks ----
  {
    id: "cairo-walkup-a",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/qOhhGLftam",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "a98d4fa6bf1e261da717fbdeef7937ef7578af86db3ba31a14296d814cf44e65",
    texturePalette: true,
  },
  {
    id: "cairo-walkup-b",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/T3oyvK6VEU",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "ecda4d8e3a89bb751f61e179725ca59d2a19f7f3aa88fedd4fc371eb8f0eaede",
    texturePalette: true,
  },

  // ---- Corniche slabs. Kenney's towers carry no texture, just named
  // materials, so they take the direct-assignment path.
  {
    id: "cairo-tower-a",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/XST1j6kYsL",
    creatorUrl: "https://kenney.nl",
    sourceSha256:
      "43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c",
    materialPalette: {
      _defaultMat: "#cfc3a8",
      border: "#ded3bd",
      window: "#4e6066",
      door: "#4b3f36",
    },
  },
  {
    id: "cairo-tower-b",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/jIRx0AhYOR",
    creatorUrl: "https://kenney.nl",
    sourceSha256:
      "6137b8892acea9711f305d8c7f2adafb0eec5d51ec489fd8c3cb754fac28b080",
    materialPalette: {
      _defaultMat: "#bdb3a2",
      border: "#d5cdba",
      window: "#4e6066",
      door: "#4b3f36",
      trim: "#ded3bd",
    },
  },
];

const rgbToHsl = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation =
    lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);
  const hue =
    (max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4) * 60;
  return [hue, saturation, lightness];
};

const hslToRgb = (hue, saturation, lightness) => {
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return [value, value, value];
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (value) => {
    value = (value + 360) % 360;
    if (value < 60) return p + ((q - p) * value) / 60;
    if (value < 180) return q;
    if (value < 240) return p + ((q - p) * (240 - value)) / 60;
    return p;
  };
  return [channel(hue + 120), channel(hue), channel(hue - 120)].map(
    (value) => Math.round(value * 255),
  );
};

/** Cairo stone/paint targets; each target hue remains inside its source band. */
const CAIRO_HUE_BANDS = [
  { min: 0, max: 28, hue: 13, saturation: 0.3 }, // red -> faded rose
  { min: 28, max: 75, hue: 38, saturation: 0.28 }, // yellow -> dusty ochre
  { min: 75, max: 190, hue: 43, saturation: 0.16 }, // green -> warm stone
  { min: 190, max: 265, hue: 210, saturation: 0.08 }, // blue -> pale grey
  { min: 265, max: 330, hue: 13, saturation: 0.22 }, // purple -> faded rose
  { min: 330, max: 360, hue: 13, saturation: 0.3 },
];

function cairoTone(r, g, b) {
  const [hue, saturation, lightness] = rgbToHsl(r, g, b);
  if (saturation < 0.12) return [r, g, b];
  const band =
    CAIRO_HUE_BANDS.find(({ min, max }) => hue >= min && hue < max) ??
    CAIRO_HUE_BANDS[0];
  return hslToRgb(
    band.hue,
    Math.min(saturation, band.saturation),
    lightness,
  );
}

const srgbToLinear = (value) =>
  value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);

function linearColor(hex) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return [...channels.map((channel) => srgbToLinear(channel / 255)), 1];
}

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error("not a GLB");
  }
  let offset = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    if (type === 0x004e4942) bin = Buffer.from(chunk);
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function serializeGlb(json, bin) {
  const pad = (buffer, fill) => {
    const remainder = buffer.length % 4;
    return remainder === 0
      ? buffer
      : Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const totalLength =
    12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const chunkHeader = (length, type) => {
    const result = Buffer.alloc(8);
    result.writeUInt32LE(length, 0);
    result.writeUInt32LE(type, 4);
    return result;
  };
  const parts = [
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a),
    jsonChunk,
  ];
  if (binChunk.length) {
    parts.push(chunkHeader(binChunk.length, 0x004e4942), binChunk);
  }
  return Buffer.concat(parts);
}

async function recolorTexture(png) {
  const image = sharp(png);
  const { width, height } = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const cache = new Map();
  for (let offset = 0; offset < data.length; offset += channels) {
    const key =
      (data[offset] << 16) |
      (data[offset + 1] << 8) |
      data[offset + 2];
    let next = cache.get(key);
    if (!next) {
      next = cairoTone(data[offset], data[offset + 1], data[offset + 2]);
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

for (const target of TARGETS) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file}`);
  }
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const alreadyStyled =
    json.asset?.extras?.curbsideRush?.style === STYLE_ID;
  let nextBin = bin;

  if (target.texturePalette && !alreadyStyled) {
    const replacements = new Map();
    for (const image of json.images ?? []) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      const start = view.byteOffset ?? 0;
      replacements.set(
        image.bufferView,
        await recolorTexture(bin.subarray(start, start + view.byteLength)),
      );
    }
    if (replacements.size) {
      const chunks = [];
      let cursor = 0;
      for (const [index, view] of json.bufferViews.entries()) {
        const start = view.byteOffset ?? 0;
        const source =
          replacements.get(index) ??
          bin.subarray(start, start + view.byteLength);
        chunks.push(source);
        view.byteOffset = cursor;
        view.byteLength = source.length;
        cursor += source.length;
        const padding = (4 - (cursor % 4)) % 4;
        if (padding) {
          chunks.push(Buffer.alloc(padding));
          cursor += padding;
        }
      }
      nextBin = Buffer.concat(chunks);
      json.buffers[0].byteLength = nextBin.length;
    }
  }

  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.88;
    const color = target.materialPalette?.[material.name];
    if (color) pbr.baseColorFactor = linearColor(color);
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      style: STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC0-1.0",
      sourceUrl: target.sourceUrl,
      creatorUrl: target.creatorUrl,
      sourceSha256: target.sourceSha256,
      modifications: "Cairo palette and matte material pass",
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, nextBin));
  console.log(
    `${target.id}: ${alreadyStyled ? "metadata/materials refreshed" : "styled"}`,
  );
}
