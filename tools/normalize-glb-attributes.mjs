#!/usr/bin/env node
/**
 * Strip secondary UV channels (TEXCOORD_1..TEXCOORD_7) from every mesh
 * primitive of a glb, so all primitives share one vertex-attribute set.
 *
 * Why this exists: `Mesh.MergeMeshes` (the `getBuildingMaster` recipe every
 * street-wall placement rides) throws "Cannot merge vertex data that do not
 * have the same set of attributes" when a Sketchfab export mixes primitives
 * with and without extra UV channels. Models with that mix had to live on
 * `buildingCatalog.ts`'s `MERGE_INCOMPATIBLE_MODEL_IDS` and take
 * `instantiateModelInstanced`'s per-submesh path instead — which costs one
 * scene mesh PER SUBMESH PER PLACEMENT. For `tokyo-house-d` (290 primitives,
 * 417 street-wall placements) that was ~119,700 scene meshes, 87% of Tokyo's
 * whole scene, and the difference between 31 fps and 6 fps (measured
 * 2026-08-15, headless-CDP paired run against NYC).
 *
 * The strip is safe only when nothing samples those channels: this script
 * refuses to touch a file where any material's texture reference uses
 * `texCoord >= 1`, and refuses entirely when the model still ends up with
 * more than one distinct attribute set (i.e. the incompatibility was not
 * just extra UV channels). TEXCOORD_0 is deliberately kept even on
 * untextured models — uniformity is the goal, minimal delta the method.
 *
 * Only the JSON chunk is rewritten; the binary chunk is byte-identical, and
 * the orphaned accessors/bufferViews stay in place (glTF loaders only read
 * referenced accessors — leaving them avoids renumbering every index in the
 * file). Provenance: appends to `asset.extras.curbsideRush.modifications`,
 * the same stamp `tools/style-tokyo-buildings.mjs` bakes.
 *
 * Usage:
 *   node tools/normalize-glb-attributes.mjs public/models/props/tokyo-house-d.glb
 *   node tools/normalize-glb-attributes.mjs --dry <file.glb>
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node tools/normalize-glb-attributes.mjs [--dry] <file.glb>");
  process.exit(1);
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a glb");
  if (buffer.readUInt32LE(4) !== 2) throw new Error("unsupported glb version");
  const chunks = [];
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  const jsonChunk = chunks.find((c) => c.type === CHUNK_JSON);
  const binChunk = chunks.find((c) => c.type === CHUNK_BIN);
  if (!jsonChunk) throw new Error("glb has no JSON chunk");
  return { json: JSON.parse(jsonChunk.data.toString("utf8")), bin: binChunk?.data ?? null };
}

function serializeGlb(json, bin) {
  let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const parts = [];
  const chunkHeader = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  parts.push(chunkHeader(jsonBytes.length, CHUNK_JSON), jsonBytes);
  if (bin) {
    let binBytes = bin;
    const binPad = (4 - (binBytes.length % 4)) % 4;
    if (binPad) binBytes = Buffer.concat([binBytes, Buffer.alloc(binPad, 0)]);
    parts.push(chunkHeader(binBytes.length, CHUNK_BIN), binBytes);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

function attributeSetCensus(json) {
  const sets = new Map();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const key = Object.keys(primitive.attributes ?? {}).sort().join("+");
      sets.set(key, (sets.get(key) ?? 0) + 1);
    }
  }
  return sets;
}

/** Every place a glTF material can name a UV channel via `texCoord`. */
function maxReferencedTexCoord(json) {
  let max = -1;
  const visit = (ref) => {
    if (ref && typeof ref === "object" && typeof ref.index === "number") {
      max = Math.max(max, ref.texCoord ?? 0);
      // KHR_texture_transform can remap the channel too.
      const transform = ref.extensions?.KHR_texture_transform;
      if (transform && typeof transform.texCoord === "number") {
        max = Math.max(max, transform.texCoord);
      }
    }
  };
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    visit(pbr.baseColorTexture);
    visit(pbr.metallicRoughnessTexture);
    visit(material.normalTexture);
    visit(material.occlusionTexture);
    visit(material.emissiveTexture);
    for (const ext of Object.values(material.extensions ?? {})) {
      if (ext && typeof ext === "object") {
        for (const value of Object.values(ext)) visit(value);
      }
    }
  }
  return max;
}

const buffer = fs.readFileSync(file);
const { json, bin } = parseGlb(buffer);

const before = attributeSetCensus(json);
console.log("attribute sets before:");
for (const [key, count] of [...before.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x ${key}`);
}

const maxTexCoord = maxReferencedTexCoord(json);
if (maxTexCoord >= 1) {
  console.error(
    `refusing: a material references texCoord ${maxTexCoord} — stripping TEXCOORD_${maxTexCoord} would change rendering`,
  );
  process.exit(1);
}

let stripped = 0;
for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    for (const key of Object.keys(primitive.attributes ?? {})) {
      const match = /^TEXCOORD_([1-9]\d*)$/.exec(key);
      if (match) {
        delete primitive.attributes[key];
        stripped += 1;
      }
    }
    // Morph targets carry attribute sets of their own; none expected here,
    // but if present they must stay uniform with the primitive too.
    for (const target of primitive.targets ?? []) {
      for (const key of Object.keys(target)) {
        if (/^TEXCOORD_[1-9]\d*$/.test(key)) {
          delete target[key];
          stripped += 1;
        }
      }
    }
  }
}

const after = attributeSetCensus(json);
console.log(`stripped ${stripped} secondary-UV attribute reference(s)`);
console.log("attribute sets after:");
for (const [key, count] of [...after.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x ${key}`);
}
if (after.size !== 1) {
  console.error(
    "refusing to write: primitives still carry more than one attribute set — the incompatibility was not just secondary UV channels",
  );
  process.exit(1);
}

json.asset ??= { version: "2.0" };
json.asset.extras ??= {};
const stamp = (json.asset.extras.curbsideRush ??= {});
const note = `stripped ${stripped} unused secondary-UV (TEXCOORD_1+) primitive attribute references so all primitives share one vertex-attribute set and Mesh.MergeMeshes accepts the model (tools/normalize-glb-attributes.mjs; no material samples those channels, binary chunk untouched)`;
stamp.modifications = stamp.modifications ? `${stamp.modifications}; ${note}` : note;

if (dry) {
  console.log("(dry run: not writing)");
} else {
  fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(`wrote ${file} (${fs.statSync(file).size} bytes, was ${buffer.length})`);
}
