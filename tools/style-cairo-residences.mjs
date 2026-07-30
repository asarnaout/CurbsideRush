/**
 * Bakes Curbside Rush's Cairo palette into the two imported CC0 residence GLBs.
 *
 * Reproduce from clean sources:
 *   1. Copy Kay Lousberg's `Building` GLB to
 *      public/models/props/cairo-residence-kay.glb.
 *   2. Convert Quaternius's `3Story_Balcony_Mat.obj` to GLB (OBJ + MTL), then
 *      place it at public/models/props/cairo-residence-quaternius.glb.
 *   3. Run `node tools/style-cairo-residences.mjs`.
 *
 * The KayKit model uses one embedded gradient-atlas texture, so its saturated
 * toy colours are remapped while neutral windows/trim keep their shading. The
 * Quaternius model uses named solid materials, which can be assigned directly.
 * Both models are made matte and receive embedded provenance metadata.
 *
 * Both sources are CC0 1.0; exact source URLs and checksums are in CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "cairo-residence-v1";

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
