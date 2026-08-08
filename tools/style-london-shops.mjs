/**
 * Bakes the London high-street palette into the Kay Lousberg shopfront GLBs.
 *
 * Reproduce from clean sources:
 *   1. Copy the committed `cairo-shop.glb` -> `london-shop.glb` and
 *      `cairo-walkup-{a,b}.glb` -> `london-walkup-{a,b}.glb`. Starting from the
 *      COMMITTED Cairo copies is deliberate: they already carry
 *      `tools/cairo-shopfront.mjs`'s geometry corrections (the two-tone
 *      scalloped awning flattened, the bundled American fire hydrant deleted) —
 *      neither belongs on a London street any more than a Cairo one, and
 *      re-doing UV surgery on fresh downloads would just duplicate that script.
 *      Separate files because modelLibrary keys asset containers by URL.
 *   2. Run `node tools/style-london-shops.mjs`.
 *
 * These models carry one embedded gradient atlas each, so styling is the
 * texture-remap path. The input hues are the Cairo pass's known outputs
 * (CAIRO_HUE_BANDS lands walls on ~13°/38°/43°/210°), and LONDON_HUE_BANDS
 * moves each of those onto the London high-street palette: Victorian brick
 * red, London stock brown, cream fascia, slate grey. Near-neutral pixels
 * (windows, ironwork, kerbs) pass through untouched, exactly as in the Cairo
 * tool. Saturation is ASSIGNED rather than capped — brick wants to be a shade
 * richer than Cairo's sun-bleached render, and the inputs arrive pre-muted.
 *
 * Every source is CC0 1.0. Original download URLs + hashes, and the committed
 * Cairo intermediates' hashes, are all recorded in CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "london-shops-v1";

const TARGETS = [
  {
    id: "london-shop",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/EL3ePInr1N",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "289278117dd1564c1ae190faa85c9dc309df94e45675431765e362b0b0ad36a5",
  },
  {
    id: "london-walkup-a",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/qOhhGLftam",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "a98d4fa6bf1e261da717fbdeef7937ef7578af86db3ba31a14296d814cf44e65",
  },
  {
    id: "london-walkup-b",
    author: "Kay Lousberg",
    title: "Building",
    sourceUrl: "https://poly.pizza/m/T3oyvK6VEU",
    creatorUrl: "https://kaylousberg.com/game-assets/city-builder-bits",
    sourceSha256:
      "ecda4d8e3a89bb751f61e179725ca59d2a19f7f3aa88fedd4fc371eb8f0eaede",
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
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
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
  return [channel(hue + 120), channel(hue), channel(hue - 120)].map((value) =>
    Math.round(value * 255),
  );
};

/**
 * London brick/paint targets, designed against the Cairo pass's output hues
 * (13/38/43/210). Saturation is assigned, not min-capped: the inputs are
 * already muted and London brick should read a touch richer, not paler.
 */
const LONDON_HUE_BANDS = [
  { min: 0, max: 28, hue: 10, saturation: 0.36 }, // faded rose -> Victorian brick
  { min: 28, max: 75, hue: 33, saturation: 0.22 }, // dusty ochre -> London stock
  { min: 75, max: 190, hue: 40, saturation: 0.13 }, // warm stone -> cream fascia
  { min: 190, max: 265, hue: 214, saturation: 0.1 }, // pale grey -> slate
  { min: 265, max: 330, hue: 10, saturation: 0.28 }, // purple -> brick
  { min: 330, max: 360, hue: 10, saturation: 0.36 },
];

function londonTone(r, g, b) {
  const [hue, saturation, lightness] = rgbToHsl(r, g, b);
  if (saturation < 0.12) return [r, g, b];
  const band =
    LONDON_HUE_BANDS.find(({ min, max }) => hue >= min && hue < max) ??
    LONDON_HUE_BANDS[0];
  return hslToRgb(band.hue, band.saturation, lightness);
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
  const parts = [header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk];
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
      (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let next = cache.get(key);
    if (!next) {
      next = londonTone(data[offset], data[offset + 1], data[offset + 2]);
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
  const alreadyStyled = json.asset?.extras?.curbsideRush?.style === STYLE_ID;
  let nextBin = bin;

  if (!alreadyStyled) {
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
          replacements.get(index) ?? bin.subarray(start, start + view.byteLength);
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
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      // Keep provenance keys this script does not own — notably the `shopfront`
      // marker inherited from the committed Cairo copy, which records that the
      // awning/hydrant surgery has already been done to these bytes.
      ...(json.asset.extras?.curbsideRush ?? {}),
      style: STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC0-1.0",
      sourceUrl: target.sourceUrl,
      creatorUrl: target.creatorUrl,
      sourceSha256: target.sourceSha256,
      modifications:
        "London high-street palette and matte material pass, over the committed Cairo copy's shopfront corrections",
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, nextBin));
  console.log(
    `${target.id}: ${alreadyStyled ? "metadata/materials refreshed" : "styled"}`,
  );
}
