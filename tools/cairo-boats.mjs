/**
 * Styles the two Nile boat glbs (Cairo-only files) and bakes their provenance.
 *
 * Sources are Quaternius CC0 models via Poly Pizza, committed as
 * `cairo-felucca.glb` (Sail Boat) and `cairo-skiff.glb` (Boat). Two edits:
 *
 * 1. **Felucca sail to cream.** The pack's sail is authored khaki; a felucca
 *    flies a white/cream lateen sail, and on the Nile the pale triangle *is*
 *    the read of the boat.
 * 2. **Matte pass.** Same as tools/style-cairo-residences.mjs: the pack ships
 *    metallic 0.4, which reads as plastic in this renderer's light; wood and
 *    canvas get metallic 0 / roughness 0.9.
 *
 * Provenance goes into `asset.extras.curbsideRush` in the same schema
 * tests/cairoAssets.test.ts pins. Idempotent via the style stamp. JSON-chunk
 * edits only — the binary chunk is byte-identical to the source.
 */
import fs from "node:fs";
import path from "node:path";

const PROPS = "public/models/props";
const STYLE_ID = "cairo-boat-v1";

const TARGETS = [
  {
    file: "cairo-felucca.glb",
    provenance: {
      style: STYLE_ID,
      author: "Quaternius",
      title: "Sail Boat",
      license: "CC0-1.0",
      sourceUrl: "https://poly.pizza/m/BgSZXwmm7k",
      creatorUrl: "https://quaternius.com",
      sourceSha256:
        "dd0d959f66c058e2afcfc01227f80b83347b5105d324690596a0c0eb6e65fb95",
      modifications: "Cream lateen sail and matte material pass",
    },
    tints: { Sail: [0.85, 0.82, 0.72, 1] },
  },
  {
    file: "cairo-skiff.glb",
    provenance: {
      style: STYLE_ID,
      author: "Quaternius",
      title: "Boat",
      license: "CC0-1.0",
      sourceUrl: "https://poly.pizza/m/5UEl54KsuC",
      creatorUrl: "https://quaternius.com",
      sourceSha256:
        "263e5d46f79e8b37afecd0db9056b22dc33c6456074d260589285d1891192335",
      modifications: "Matte material pass",
    },
    tints: {},
  },
];

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
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
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(
    12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0),
    8,
  );
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
  const file = path.join(PROPS, target.file);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const { json, bin } = parseGlb(fs.readFileSync(file));
  if (json.asset?.extras?.curbsideRush?.style === STYLE_ID) {
    console.log(`${target.file}: already styled`);
    continue;
  }
  let tinted = 0;
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness;
    if (!pbr) continue;
    const tint = target.tints[material.name];
    if (tint) {
      pbr.baseColorFactor = tint;
      tinted += 1;
    }
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.9;
  }
  const wantedTints = Object.keys(target.tints).length;
  if (tinted !== wantedTints) {
    throw new Error(
      `${target.file}: expected to tint ${wantedTints} material(s), found ${tinted}`,
    );
  }
  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: { ...target.provenance },
  };
  fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(
    `${target.file}: styled (${tinted} tinted, ${(json.materials ?? []).length} matted)`,
  );
}
