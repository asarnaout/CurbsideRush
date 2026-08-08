/**
 * Bakes the City of London's steel-blue glass palette into the three
 * `london-tower-*.glb` copies of the Kenney skyscrapers.
 *
 * Reproduce from clean sources:
 *   1. Copy the committed `nyc-tower-{a,b,c}.glb` to `london-tower-{a,b,c}.glb`.
 *      Those committed files are byte-identical to the original Poly Pizza
 *      downloads (verified by SHA-256 against the source hashes recorded in
 *      CREDITS.md), so the copies start pristine. Separate files because
 *      modelLibrary keys asset containers by URL — one file cannot serve two
 *      cities' palettes (the same reason `cairo-tower-*.glb` exist).
 *   2. Run `node tools/style-london-towers.mjs`.
 *
 * Kenney's towers carry no texture, just named solid materials, so each takes
 * the direct-assignment path. Three related but distinct steel-blue families so
 * a City street doesn't read as one tower copy-pasted; windows sit LIGHTER than
 * the body so the curtain wall reads as sky-reflecting glass in the day light,
 * where Cairo's stone slabs wanted dark punched windows.
 *
 * Every source is CC0 1.0; source URLs are in `app/game/buildingCatalog.ts`
 * and CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "london-towers-v1";

const TARGETS = [
  {
    id: "london-tower-a",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/XST1j6kYsL",
    creatorUrl: "https://kenney.nl",
    sourceSha256:
      "43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c",
    materialPalette: {
      _defaultMat: "#54687a",
      border: "#77879a",
      window: "#a3bccb",
      door: "#2e3a44",
    },
  },
  {
    id: "london-tower-b",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/JTsKOSB23Y",
    creatorUrl: "https://kenney.nl",
    sourceSha256:
      "9e4587c640afbb45b3def91b3a9fd40c7b705391c9668e304f245886d1cb1cdd",
    materialPalette: {
      _defaultMat: "#4a5d6d",
      border: "#6d7f8f",
      trim: "#8b9aa8",
      window: "#9db4c4",
      door: "#2c3841",
    },
  },
  {
    id: "london-tower-c",
    author: "Kenney",
    title: "Skyscraper",
    sourceUrl: "https://poly.pizza/m/jIRx0AhYOR",
    creatorUrl: "https://kenney.nl",
    sourceSha256:
      "6137b8892acea9711f305d8c7f2adafb0eec5d51ec489fd8c3cb754fac28b080",
    materialPalette: {
      _defaultMat: "#5d6e7a",
      border: "#7e8d99",
      trim: "#93a1ad",
      window: "#aec4d2",
      door: "#313d46",
    },
  },
];

const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

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
  const parts = [header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk];
  if (binChunk.length) {
    parts.push(chunkHeader(binChunk.length, 0x004e4942), binChunk);
  }
  return Buffer.concat(parts);
}

for (const target of TARGETS) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file}`);
  }
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const alreadyStyled = json.asset?.extras?.curbsideRush?.style === STYLE_ID;

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
      ...(json.asset.extras?.curbsideRush ?? {}),
      style: STYLE_ID,
      author: target.author,
      title: target.title,
      license: "CC0-1.0",
      sourceUrl: target.sourceUrl,
      creatorUrl: target.creatorUrl,
      sourceSha256: target.sourceSha256,
      modifications: "London steel-blue glass palette and matte material pass",
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(
    `${target.id}: ${alreadyStyled ? "metadata/materials refreshed" : "styled"}`,
  );
}
