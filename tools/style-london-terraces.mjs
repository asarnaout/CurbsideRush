/**
 * Bakes Curbside Rush's London palette into the Quaternius-derived terrace and
 * stucco building GLBs — the pitched-roof models Cairo's ROOF RULE deliberately
 * excluded (`GableRoof`, `RoundRoof`, `_Roof_`), which is exactly why London
 * imports them: a gable reads as European on sight, and London is the map that
 * wants it to.
 *
 * Reproduce from clean sources:
 *   1. Download the five pitched-roof OBJ+MTL pairs from the Ultimate Textured
 *      Buildings Pack's official Google Drive (`Models with Materials/OBJ`,
 *      folder link + `License.txt` SHA-256 in CREDITS.md).
 *   2. Convert each with `node tools/obj-to-glb.mjs <in.obj> <out.glb>` to its
 *      `london-terrace-*.glb` name; the stucco variants are second conversions
 *      of the same sources to `london-stucco-*.glb` (modelLibrary keys asset
 *      containers by URL, so one file cannot carry two palettes).
 *   3. Run `node tools/style-london-terraces.mjs`.
 *
 * The pack has named solid materials (no textures), so every model takes the
 * direct-assignment path: a shared material map with a per-model wall tone.
 * Two palette families on the same geometry:
 *   - terrace: Victorian red brick / London stock brick walls, slate roofs.
 *   - stucco: Chelsea/Belgravia white-cream render, slate roofs.
 * Every model is made matte and receives embedded provenance metadata.
 *
 * Every source is CC0 1.0; source URLs and checksums are in CREDITS.md.
 */
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry");
const PROPS = "public/models/props";
const STYLE_ID = "london-terrace-v1";

/**
 * Shared across the Quaternius pack (same nine-ish material names on every
 * model). Values here are the London defaults; each target varies `Main` (the
 * wall) and the roof materials. `RoofBricks` exists on the gable models,
 * `Windows` on the wide 4-storey; both fall through harmlessly elsewhere.
 */
const LONDON_BASE = {
  Black: "#2b2a28",
  Bricks: "#7d5648", // exposed brick quoins/chimneys — kept brick on stucco too
  Dark: "#4a4640",
  DarkBrown: "#453029",
  DarkWood: "#3d3a36",
  Glass: "#6c7f86",
  Light: "#d9d2c3",
  Main: "#96604f",
  RoofBricks: "#4d5157", // slate — London roofs are slate, not tile
  White: "#e8e3d8",
  Windows: "#5d7075",
  Wood: "#5a4a3c",
};

const SOURCES = {
  "1Story_GableRoof_Mat":
    "obj:647671a27dd10b7d9e3246fb792dfbf4c4c1b5a71197d5e7809006239d0cda5f;mtl:cf360867b3cd427b7de605b58495a5361cfff2132d7551f16af8f80032ed4bb8",
  "1Story_RoundRoof_Mat":
    "obj:7e2977c8df40757b5b4accac0477c844f1a607413b0425a447aec97ffe94ed75;mtl:1163516abcd47ddb81cbfdbf17046e006ebc64979d03530ecc0bc17669f3a424",
  "2Story_GableRoof_Mat":
    "obj:ed3a11cfdbf637d0f3512a52022122d6f7a7ef24a92e828ea6b812894234daca;mtl:452d56b002916ca9844e338b6d032d85cd1a8e9a56c213c9b4733181057ceecd",
  "2Story_RoundRoof_Mat":
    "obj:50b109ea88d34c300f0b80a5c81c6f688e3b53f69f25723e58ec547b36ec0355;mtl:2e2fe28fe6b7ed72133a4e851f4164b93e72ce1202f93724926a7c514ee0a6a9",
  "4Story_Wide_2Doors_Roof_Mat":
    "obj:03984e13c98fee5009d5345b39a2da2239eca8ddee9fe9ab6170c12cebfd7f4e;mtl:a2987b6683c57feb333af6c6bb34387722a946c9a8b463f722fa8411c447b3a9",
};

/**
 * A single brick tone down a terrace run reads as copy-paste. Real London
 * terraces sit in a narrow band — Victorian red, brown brick, yellow-grey
 * London stock — so each model gets its own point in that band. The stucco
 * family does the same in white-cream, with dark window joinery so the render
 * reads as painted masonry rather than bare primer.
 */
const model = (id, title, wall, extra = {}) => ({
  id,
  author: "Quaternius",
  title,
  sourceUrl: "https://quaternius.com/packs/ultimatetexturedbuildings.html",
  creatorUrl: "https://quaternius.com",
  sourceSha256: SOURCES[title],
  materialPalette: { ...LONDON_BASE, Main: wall, ...extra },
});

const TARGETS = [
  // ---- Brick terraces ----
  model("london-terrace-a", "2Story_GableRoof_Mat", "#96604f"), // Victorian red
  model("london-terrace-b", "2Story_RoundRoof_Mat", "#8a6a50"), // brown brick
  model("london-terrace-c", "4Story_Wide_2Doors_Roof_Mat", "#9c6b52", {
    // The mansion-block run: red brick with pale stone banding.
    Light: "#d5cbb8",
  }),
  model("london-terrace-d", "1Story_GableRoof_Mat", "#a08258"), // London stock
  model("london-terrace-e", "1Story_RoundRoof_Mat", "#8f7a5c"), // weathered stock

  // ---- White-stucco variants (Chelsea / Belgravia) ----
  model("london-stucco-a", "2Story_GableRoof_Mat", "#e6e0d2", {
    Bricks: "#d8d2c4", // stucco terraces render their quoins too
    Wood: "#3f4a44", // racing-green joinery
  }),
  model("london-stucco-b", "2Story_RoundRoof_Mat", "#eae4d6", {
    Bricks: "#dcd6c8",
    DarkBrown: "#3d4540",
  }),
  model("london-stucco-c", "4Story_Wide_2Doors_Roof_Mat", "#e3ddcf", {
    Bricks: "#d5cfc1",
    Light: "#efe9db",
  }),
  model("london-stucco-d", "1Story_GableRoof_Mat", "#ece6d8", {
    Bricks: "#ded8ca",
    Wood: "#42403a",
  }),
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
      modifications: "London palette and matte material pass",
    },
  };

  if (!dry) fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(
    `${target.id}: ${alreadyStyled ? "metadata/materials refreshed" : "styled"}`,
  );
}
