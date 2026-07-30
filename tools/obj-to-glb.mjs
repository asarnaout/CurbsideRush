/**
 * Deterministic OBJ + MTL -> self-contained GLB converter.
 *
 * Written rather than pulled from npm on purpose: `tests/cairoAssets.test.ts`
 * pins the committed SHA-256 of every Cairo glb, so the converter has to produce
 * byte-identical output for the same input forever. An external converter would
 * put that guarantee at the mercy of a transitive dependency bump.
 *
 * Scope is deliberately narrow — exactly what the Quaternius building packs use:
 * solid named materials with no texture maps, Y-up geometry, convex faces. It
 * triangulates with a fan (safe for Blender's convex export), keeps POSITION and
 * NORMAL, and drops UVs because an untextured material never reads them.
 *
 * Output is quantized via KHR_mesh_quantization (POSITION as SHORT, NORMAL as
 * normalized BYTE), which roughly halves the file for geometry this flat-shaded.
 * The dequantizing scale/translation rides on the glTF node, so Babylon's
 * `MergeMeshes` bakes it out with the rest of the world matrix and everything
 * downstream sees plain metres. SHORT positions are only legal under that
 * extension, so it is declared in extensionsRequired, not just extensionsUsed —
 * `tests/objToGlb.test.ts` loads the result under NullEngine to prove Babylon
 * dequantizes it back to the source bounds.
 *
 * Geometry is left in its native frame. Do NOT recentre or rescale here: the
 * runtime already owns that (`recentreMergedMasterXZ` in buildingWinding.ts, and
 * the per-model `scale`/`groundY` in buildingSets.ts), and baking it twice would
 * put every building underground.
 *
 * Usage: node tools/obj-to-glb.mjs <in.obj> <out.glb>
 *        (the .mtl is resolved from the OBJ's `mtllib` line)
 */
import fs from "node:fs";
import path from "node:path";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const BYTE = 5120;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
/** Signed 16-bit headroom for quantized positions. */
const SHORT_MAX = 32767;

const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

/** Kd is authored in sRGB; glTF baseColorFactor is linear. */
function parseMtl(text) {
  const materials = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) {
      current = { name: line.slice(7).trim(), baseColor: [0.8, 0.8, 0.8, 1] };
      materials.set(current.name, current);
    } else if (current && line.startsWith("Kd ")) {
      const [r, g, b] = line.slice(3).trim().split(/\s+/).map(Number);
      current.baseColor = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
    } else if (current && line.startsWith("d ")) {
      current.baseColor[3] = Number(line.slice(2).trim());
    }
  }
  return materials;
}

/** OBJ indices are 1-based and may be negative (relative to the end). */
const resolveIndex = (token, count) => {
  const value = Number.parseInt(token, 10);
  return value > 0 ? value - 1 : count + value;
};

function parseObj(text) {
  const positions = [];
  const normals = [];
  /** @type {Map<string, {v: number, n: number}[][]>} material -> faces */
  const groups = new Map();
  let material = "__default";
  let mtllib = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      positions.push([x, y, z]);
    } else if (line.startsWith("vn ")) {
      const [x, y, z] = line.slice(3).trim().split(/\s+/).map(Number);
      normals.push([x, y, z]);
    } else if (line.startsWith("usemtl ")) {
      material = line.slice(7).trim();
    } else if (line.startsWith("mtllib ")) {
      mtllib = line.slice(7).trim();
    } else if (line.startsWith("f ")) {
      const corners = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((token) => {
          const [v, , n] = token.split("/");
          return {
            v: resolveIndex(v, positions.length),
            n: n ? resolveIndex(n, normals.length) : -1,
          };
        });
      if (corners.length < 3) continue;
      let faces = groups.get(material);
      if (!faces) groups.set(material, (faces = []));
      faces.push(corners);
    }
  }
  return { positions, normals, groups, mtllib };
}

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Fallback for faces exported without a `vn` — Newell would be overkill here. */
function faceNormal(positions, corners) {
  const a = positions[corners[0].v];
  const b = positions[corners[1].v];
  const c = positions[corners[2].v];
  const u = subtract(b, a);
  const w = subtract(c, a);
  const normal = [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

export function objToGlb(objText, mtlText, { generator = "curbside-rush/obj-to-glb" } = {}) {
  const { positions, normals, groups } = parseObj(objText);
  const materials = parseMtl(mtlText ?? "");

  // One quantization frame for the whole mesh, so a single node transform
  // dequantizes every primitive. Derived from the union of all used positions.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const faces of groups.values()) {
    for (const corners of faces) {
      for (const corner of corners) {
        const position = positions[corner.v];
        for (let axis = 0; axis < 3; axis += 1) {
          if (position[axis] < bounds.min[axis]) bounds.min[axis] = position[axis];
          if (position[axis] > bounds.max[axis]) bounds.max[axis] = position[axis];
        }
      }
    }
  }
  const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  const halfExtent = Math.max(
    ...[0, 1, 2].map((axis) => (bounds.max[axis] - bounds.min[axis]) / 2),
    1e-6,
  );
  const quantum = halfExtent / SHORT_MAX;
  const quantize = (value, axis) =>
    Math.max(-SHORT_MAX, Math.min(SHORT_MAX, Math.round((value - centre[axis]) / quantum)));

  const json = {
    asset: { version: "2.0", generator },
    extensionsUsed: ["KHR_mesh_quantization"],
    extensionsRequired: ["KHR_mesh_quantization"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        mesh: 0,
        translation: centre,
        scale: [quantum, quantum, quantum],
      },
    ],
    meshes: [{ primitives: [] }],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let offset = 0;

  // byteStride is mandatory whenever an element is padded past its natural size
  // (SHORT vec3 = 6 bytes written into an 8-byte slot); without it a loader
  // reads the padding as vertex data.
  const pushView = (buffer, target, byteStride) => {
    // glTF requires 4-byte alignment for bufferView byteOffset.
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    chunks.push(buffer);
    const index = json.bufferViews.length;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: buffer.length,
      ...(byteStride ? { byteStride } : {}),
      ...(target ? { target } : {}),
    });
    offset += buffer.length;
    return index;
  };

  // Sorted so the output does not depend on Map insertion order.
  for (const name of [...groups.keys()].sort()) {
    const faces = groups.get(name);
    const seen = new Map();
    const vertexPositions = [];
    const vertexNormals = [];
    const indices = [];

    const vertexIndex = (corner, fallbackNormal) => {
      const key = `${corner.v}/${corner.n}`;
      const existing = seen.get(key);
      if (existing !== undefined) return existing;
      const index = vertexPositions.length;
      vertexPositions.push(positions[corner.v]);
      vertexNormals.push(corner.n >= 0 ? normals[corner.n] : fallbackNormal);
      seen.set(key, index);
      return index;
    };

    for (const corners of faces) {
      const fallback = corners.some((c) => c.n < 0)
        ? faceNormal(positions, corners)
        : null;
      const first = vertexIndex(corners[0], fallback);
      for (let i = 1; i + 1 < corners.length; i += 1) {
        indices.push(
          first,
          vertexIndex(corners[i], fallback),
          vertexIndex(corners[i + 1], fallback),
        );
      }
    }
    if (!indices.length) continue;

    const count = vertexPositions.length;
    // POSITION: SHORT vec3 padded to 8 bytes (glTF wants each vertex attribute
    // 4-byte aligned). NORMAL: normalized BYTE vec3 padded to 4. 12 bytes per
    // vertex against 24 unquantized.
    const positionBuffer = Buffer.alloc(count * 8);
    const normalBuffer = Buffer.alloc(count * 4);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = quantize(vertexPositions[i][axis], axis);
        positionBuffer.writeInt16LE(value, i * 8 + axis * 2);
        normalBuffer.writeInt8(
          Math.max(-127, Math.min(127, Math.round(vertexNormals[i][axis] * 127))),
          i * 4 + axis,
        );
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }

    const wide = count > 65535;
    const indexBuffer = Buffer.alloc(indices.length * (wide ? 4 : 2));
    indices.forEach((value, i) => {
      if (wide) indexBuffer.writeUInt32LE(value, i * 4);
      else indexBuffer.writeUInt16LE(value, i * 2);
    });

    const positionAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(positionBuffer, ARRAY_BUFFER, 8),
      componentType: SHORT,
      count,
      type: "VEC3",
      min,
      max,
    });
    const normalAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(normalBuffer, ARRAY_BUFFER, 4),
      componentType: BYTE,
      normalized: true,
      count,
      type: "VEC3",
    });
    const indexAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(indexBuffer, ELEMENT_ARRAY_BUFFER),
      componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT,
      count: indices.length,
      type: "SCALAR",
    });

    const material = json.materials.length;
    json.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: materials.get(name)?.baseColor ?? [0.8, 0.8, 0.8, 1],
        metallicFactor: 0,
        roughnessFactor: 0.88,
      },
    });
    json.meshes[0].primitives.push({
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
      indices: indexAccessor,
      material,
    });
  }

  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });

  const pad = (buffer, fill) => {
    const remainder = buffer.length % 4;
    return remainder === 0
      ? buffer
      : Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (length, type) => {
    const result = Buffer.alloc(8);
    result.writeUInt32LE(length, 0);
    result.writeUInt32LE(type, 4);
    return result;
  };
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, CHUNK_JSON),
    jsonChunk,
    chunkHeader(binChunk.length, CHUNK_BIN),
    binChunk,
  ]);
}

export function convertObjFile(objPath, glbPath) {
  const objText = fs.readFileSync(objPath, "utf8");
  const mtlName = parseObj(objText).mtllib;
  const mtlPath = mtlName
    ? path.join(path.dirname(objPath), mtlName)
    : objPath.replace(/\.obj$/i, ".mtl");
  const mtlText = fs.existsSync(mtlPath) ? fs.readFileSync(mtlPath, "utf8") : "";
  const glb = objToGlb(objText, mtlText);
  fs.writeFileSync(glbPath, glb);
  return glb;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [objPath, glbPath] = process.argv.slice(2);
  if (!objPath || !glbPath) {
    console.error("usage: node tools/obj-to-glb.mjs <in.obj> <out.glb>");
    process.exit(1);
  }
  const glb = convertObjFile(objPath, glbPath);
  console.log(`${glbPath}: ${glb.length} bytes`);
}
