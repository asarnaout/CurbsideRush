#!/usr/bin/env node
/**
 * Demote spurious `alphaMode: "BLEND"` materials in a glb to OPAQUE (or MASK
 * where the texture really is a cutout).
 *
 * Why this exists: Sketchfab's exporter marks a material BLEND whenever its
 * baseColor PNG merely *has* an alpha channel, even one that is 255
 * everywhere. Babylon renders BLEND materials in the transparent queue with
 * depth-write off, so a building whose walls share one such material draws
 * its far walls over its near walls — the "transparent walls showing the
 * inside" / "hollowed out" look the owner reported on `tokyo-izakaya`,
 * `tokyo-apato-a` and the `tokyo-zakkyo-d/e/f` towers (2026-08-15). The
 * winding is fine; the queue is the whole bug.
 *
 * The decision is measured, never assumed, from the actual decoded pixels
 * (`sharp`, already a declared devDependency — see
 * `tools/style-tokyo-buildings.mjs`'s own dependency note):
 *   - every alpha >= 250            -> OPAQUE (drop alphaMode/alphaCutoff)
 *   - near-binary alpha (cutouts)   -> MASK, alphaCutoff 0.5 (depth-written,
 *     so it cannot see-through; only true partial coverage would need BLEND)
 *   - genuine mid-alpha content     -> left alone, reported loudly (real
 *     glass wants BLEND; `tokyo-house-d`'s untextured "Cristal" window
 *     materials are the known legitimate case and are factor-alpha anyway)
 * A BLEND material with no baseColor texture is judged on baseColorFactor
 * alpha alone (1.0 -> OPAQUE, else left alone).
 *
 * Only the JSON chunk changes; pixels and geometry are byte-identical.
 * Provenance appends to `asset.extras.curbsideRush.modifications`, the same
 * stamp the other asset tools bake.
 *
 * The automatic rules are deliberately strict; a borderline texture (soft
 * fringe around real cutouts, or a whisper of compression-noise mid-alpha
 * with no transparent region at all) is refused with its histogram printed
 * so a human/agent can judge. `--force-opaque` / `--force-mask <cutoff>`
 * then execute that judgment for every file on that invocation — the
 * measured histogram is baked into the provenance stamp either way, so the
 * evidence for the call travels with the asset.
 *
 * Usage:
 *   node tools/fix-glb-alpha-blend.mjs [--dry] <file.glb> [...more.glb]
 *   node tools/fix-glb-alpha-blend.mjs --force-opaque <file.glb> [...]
 *   node tools/fix-glb-alpha-blend.mjs --force-mask 0.5 <file.glb> [...]
 */
import fs from "node:fs";
import sharp from "sharp";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const forceOpaque = args.includes("--force-opaque");
const forceMaskIndex = args.indexOf("--force-mask");
const forceMaskCutoff = forceMaskIndex >= 0 ? Number(args[forceMaskIndex + 1]) : null;
if (forceMaskIndex >= 0 && !(forceMaskCutoff > 0 && forceMaskCutoff < 1)) {
  console.error("--force-mask needs a cutoff in (0, 1)");
  process.exit(1);
}
if (forceOpaque && forceMaskIndex >= 0) {
  console.error("pick one of --force-opaque / --force-mask");
  process.exit(1);
}
const files = args.filter((a, i) => !a.startsWith("--") && i !== forceMaskIndex + 1);
if (!files.length) {
  console.error("usage: node tools/fix-glb-alpha-blend.mjs [--dry] <file.glb> [...]");
  process.exit(1);
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a glb");
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
  const header = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  parts.push(header(jsonBytes.length, CHUNK_JSON), jsonBytes);
  if (bin) {
    let binBytes = bin;
    const binPad = (4 - (binBytes.length % 4)) % 4;
    if (binPad) binBytes = Buffer.concat([binBytes, Buffer.alloc(binPad, 0)]);
    parts.push(header(binBytes.length, CHUNK_BIN), binBytes);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

function imageBytes(json, bin, imageIndex) {
  const image = json.images?.[imageIndex];
  if (!image || image.bufferView === undefined || !bin) return null;
  const view = json.bufferViews[image.bufferView];
  const start = view.byteOffset ?? 0;
  return bin.subarray(start, start + view.byteLength);
}

async function alphaStats(pngBytes) {
  const { data, info } = await sharp(pngBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let min = 255;
  let below250 = 0;
  let mid = 0; // genuinely partial coverage: alpha in (5, 250)
  const total = info.width * info.height;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a < min) min = a;
    if (a < 250) {
      below250 += 1;
      if (a > 5) mid += 1;
    }
  }
  return { min, total, below250Frac: below250 / total, midFrac: mid / total };
}

for (const file of files) {
  const buffer = fs.readFileSync(file);
  const { json, bin } = parseGlb(buffer);
  const changed = [];
  for (const [index, material] of (json.materials ?? []).entries()) {
    if ((material.alphaMode ?? "OPAQUE") !== "BLEND") continue;
    const name = material.name ?? `material ${index}`;
    const pbr = material.pbrMetallicRoughness ?? {};
    const factorAlpha = (pbr.baseColorFactor ?? [1, 1, 1, 1])[3];
    const textureIndex = pbr.baseColorTexture?.index;
    if (textureIndex === undefined) {
      if (factorAlpha >= 1) {
        delete material.alphaMode;
        delete material.alphaCutoff;
        changed.push(`${name}: untextured, factor alpha 1 -> OPAQUE`);
      } else {
        console.log(`${file} "${name}": untextured with factor alpha ${factorAlpha} — real translucency, left as BLEND`);
      }
      continue;
    }
    const sourceIndex = json.textures[textureIndex].source;
    const bytes = imageBytes(json, bin, sourceIndex);
    if (!bytes) {
      console.log(`${file} "${name}": texture bytes unreachable, left as BLEND`);
      continue;
    }
    const stats = await alphaStats(bytes);
    if (factorAlpha < 1) {
      console.log(`${file} "${name}": baseColorFactor alpha ${factorAlpha} < 1 — real translucency, left as BLEND`);
      continue;
    }
    const summary = `alpha min ${stats.min}, ${(stats.below250Frac * 100).toFixed(2)}% below 250, ${(stats.midFrac * 100).toFixed(3)}% mid-range`;
    if (forceOpaque) {
      delete material.alphaMode;
      delete material.alphaCutoff;
      changed.push(`${name}: forced OPAQUE (measured: ${summary})`);
    } else if (forceMaskCutoff !== null) {
      material.alphaMode = "MASK";
      material.alphaCutoff = forceMaskCutoff;
      changed.push(`${name}: forced MASK cutoff ${forceMaskCutoff} (measured: ${summary})`);
    } else if (stats.min >= 250) {
      delete material.alphaMode;
      delete material.alphaCutoff;
      changed.push(`${name}: texture alpha fully opaque (min ${stats.min}) -> OPAQUE`);
    } else if (stats.midFrac < 0.001) {
      material.alphaMode = "MASK";
      material.alphaCutoff = 0.5;
      changed.push(
        `${name}: near-binary alpha (cutout ${(stats.below250Frac * 100).toFixed(2)}% of pixels, partial ${(stats.midFrac * 100).toFixed(3)}%) -> MASK cutoff 0.5`,
      );
    } else {
      console.log(`${file} "${name}": genuine partial alpha (${summary}) — left as BLEND, look at it by hand`);
    }
  }
  if (!changed.length) {
    console.log(`${file}: nothing to change`);
    continue;
  }
  json.asset ??= { version: "2.0" };
  json.asset.extras ??= {};
  const stamp = (json.asset.extras.curbsideRush ??= {});
  const note = `demoted spurious alphaMode BLEND (tools/fix-glb-alpha-blend.mjs; measured from the decoded baseColor alpha, pixels untouched): ${changed.join("; ")}`;
  stamp.modifications = stamp.modifications ? `${stamp.modifications}; ${note}` : note;
  console.log(`${file}:`);
  for (const line of changed) console.log(`  ${line}`);
  if (dry) {
    console.log("  (dry run: not writing)");
  } else {
    fs.writeFileSync(file, serializeGlb(json, bin));
    console.log(`  wrote ${file}`);
  }
}
