/**
 * Packs a Sketchfab-style glTF export (a `.gltf` JSON + one external `.bin`
 * buffer + external image files, referenced by `uri`) into one self-contained
 * `.glb`: every `buffers[]`/`images[]` URI becomes an embedded `bufferView`
 * into a single combined binary blob, matching how every other committed
 * model in this repo works (docs/rendering.md, "Asset provenance").
 *
 * Hand-written rather than pulled from npm, extending `tools/obj-to-glb.mjs`'s
 * approach: `tests/tokyoAssets.test.ts` pins committed SHA-256s, so packing
 * has to stay byte-stable forever, not at the mercy of a transitive dependency
 * bump. `parseGlb`/`serializeGlb` here are the same 12-byte-header/JSON-
 * chunk/BIN-chunk read+write `obj-to-glb.mjs` and `style-london-terraces.mjs`
 * already hand-roll.
 *
 * Scope is deliberately narrow — exactly what the Tokyo Sketchfab exports use
 * (see `tokyo-authenticity-plan.md` section 5.2/5.4): one buffer, N images
 * each with a plain `uri` (no data-URIs, no KTX2/Draco/sparse accessors).
 * Geometry accessors and their bufferViews are left byte-for-byte untouched —
 * only the buffer's `uri` is dropped and images are appended after it — so
 * packing can never perturb a single vertex. `rebuildBufferViews` is the
 * separate, more invasive primitive `style-tokyo-buildings.mjs` uses when it
 * actually needs to replace specific bufferViews' bytes (texture downscaling).
 *
 * Usage: node tools/pack-gltf.mjs <in.gltf> <out.glb>
 *        (buffers/images are resolved relative to the .gltf file's directory)
 */
import fs from "node:fs";
import path from "node:path";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("not a GLB (bad magic)");
  }
  let offset = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(chunk.toString("utf8"));
    else if (type === CHUNK_BIN) bin = Buffer.from(chunk);
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

export function serializeGlb(json, bin) {
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
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);
  const chunkHeader = (length, type) => {
    const result = Buffer.alloc(8);
    result.writeUInt32LE(length, 0);
    result.writeUInt32LE(type, 4);
    return result;
  };
  const parts = [header, chunkHeader(jsonChunk.length, CHUNK_JSON), jsonChunk];
  if (binChunk.length) {
    parts.push(chunkHeader(binChunk.length, CHUNK_BIN), binChunk);
  }
  return Buffer.concat(parts);
}

/** `images[].uri`/`buffers[].uri` extension -> glTF mimeType. */
export function mimeTypeForUri(uri) {
  if (/\.png$/i.test(uri)) return "image/png";
  if (/\.jpe?g$/i.test(uri)) return "image/jpeg";
  throw new Error(`unknown image mime type for uri: ${uri}`);
}

/**
 * A small 4-byte-aligned binary blob builder — every embedded resource
 * (the original .bin, each image) starts on a 4-byte boundary, matching how
 * every accessor bufferView in this codebase's other GLBs is laid out.
 */
function createBlobBuilder() {
  const chunks = [];
  let offset = 0;
  const append = (buffer) => {
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    const byteOffset = offset;
    chunks.push(buffer);
    offset += buffer.length;
    return byteOffset;
  };
  const finish = () => Buffer.concat(chunks, offset);
  return { append, finish, get length() { return offset; } };
}

/**
 * Packs a parsed Sketchfab glTF JSON (external `.bin` + external images) into
 * a glb-shaped `{json, bin}` pair — pass the result to `serializeGlb`.
 *
 * `loadResource(uri)` resolves a `buffers[].uri`/`images[].uri` to its bytes
 * (relative to the source `.gltf`'s own directory).
 *
 * Deliberately narrow: throws rather than guessing on anything this repo's
 * Tokyo sources don't use (see MANIFEST.md) — multiple buffers, a data-URI
 * image, or an image that is already `bufferView`-embedded (nothing to do,
 * so it is left alone rather than silently double-packed).
 */
export function packGltf(gltfJson, loadResource) {
  const json = structuredClone(gltfJson);
  const blob = createBlobBuilder();

  if (!Array.isArray(json.buffers) || json.buffers.length !== 1) {
    throw new Error(
      `packGltf only supports exactly one buffer, got ${json.buffers?.length ?? 0}`,
    );
  }
  const [buffer] = json.buffers;
  if (!buffer.uri) throw new Error("buffers[0] has no uri to pack");
  if (buffer.uri.startsWith("data:")) {
    throw new Error("packGltf does not support a data-URI buffer");
  }
  const originalBin = loadResource(buffer.uri);
  const bufferByteOffset = blob.append(originalBin);
  if (bufferByteOffset !== 0) {
    // Nothing should ever be appended before the original accessor data —
    // every existing bufferView's byteOffset is relative to it landing at 0.
    throw new Error("internal: original buffer did not land at offset 0");
  }
  delete buffer.uri;

  for (const image of json.images ?? []) {
    if (!image.uri) continue; // already bufferView-embedded — nothing to do
    if (image.uri.startsWith("data:")) {
      throw new Error(`packGltf does not support a data-URI image: ${image.uri}`);
    }
    const bytes = loadResource(image.uri);
    const byteOffset = blob.append(bytes);
    const bufferViewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    image.bufferView = bufferViewIndex;
    image.mimeType = mimeTypeForUri(image.uri);
    delete image.uri;
  }

  const bin = blob.finish();
  buffer.byteLength = bin.length;
  return { json, bin };
}

/**
 * Rebuilds every bufferView (and the single `buffers[0]` blob they share)
 * from scratch, in existing bufferView order, substituting new bytes for any
 * index present in `replacements`. Every bufferView must reference buffer 0
 * (true of every model this repo commits — glTF binary allows exactly one
 * BIN chunk) — used by `style-tokyo-buildings.mjs` to shrink specific
 * embedded images without hand-shifting every later bufferView's offset.
 *
 * @param {object} json
 * @param {Buffer} bin
 * @param {Map<number, Buffer>} replacements bufferView index -> new bytes
 * @returns {Buffer} the rebuilt bin blob (json.bufferViews/buffers are mutated in place)
 */
export function rebuildBufferViews(json, bin, replacements) {
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1) {
    throw new Error(
      `rebuildBufferViews only supports exactly one buffer, got ${json.buffers?.length ?? 0}`,
    );
  }
  const blob = createBlobBuilder();
  json.bufferViews = (json.bufferViews ?? []).map((view, index) => {
    if ((view.buffer ?? 0) !== 0) {
      throw new Error(`bufferView ${index} references buffer ${view.buffer}, expected 0`);
    }
    const bytes =
      replacements.get(index) ??
      bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const byteOffset = blob.append(bytes);
    const rebuilt = { ...view, byteOffset, byteLength: bytes.length };
    if (!view.byteStride) delete rebuilt.byteStride;
    return rebuilt;
  });
  const rebuiltBin = blob.finish();
  json.buffers[0].byteLength = rebuiltBin.length;
  return rebuiltBin;
}

/** Reads a `.gltf` + its external buffer/images from disk and packs them. */
export function packGltfFile(gltfPath) {
  const dir = path.dirname(gltfPath);
  const gltfJson = JSON.parse(fs.readFileSync(gltfPath, "utf8"));
  return packGltf(gltfJson, (uri) => fs.readFileSync(path.join(dir, uri)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [gltfPath, glbPath] = process.argv.slice(2);
  if (!gltfPath || !glbPath) {
    console.error("usage: node tools/pack-gltf.mjs <in.gltf> <out.glb>");
    process.exit(1);
  }
  const { json, bin } = packGltfFile(gltfPath);
  const glb = serializeGlb(json, bin);
  fs.writeFileSync(glbPath, glb);
  console.log(`${glbPath}: ${glb.length} bytes`);
}
