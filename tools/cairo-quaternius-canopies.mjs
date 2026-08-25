/**
 * Deletes the striped Western-style window and entrance canopies from the two
 * Cairo Quaternius four-storey blocks that carry them.
 *
 * The same Quaternius source geometry is also used by Tokyo. This tool must
 * therefore only ever target Cairo's city-specific GLB copies; the Tokyo file
 * and every other map keep their authored geometry. Run this after
 * `tools/style-cairo-residences.mjs` when rebuilding the Cairo kit.
 *
 * Each canopy is split into alternating `Dark` and `White` strips inside two
 * otherwise shared material primitives, so hiding a material would also erase
 * the building's base, cornices and trim. Instead, this pass welds each
 * primitive by position, identifies only the shallow projecting strip
 * components, and removes their triangles from the index accessors. Exact
 * component/triangle counts make source drift fail loudly rather than delete
 * an unfamiliar part of the building.
 *
 * Idempotent. `--dry` audits the committed files without writing them;
 * `--from-head` rebuilds from the version currently committed at HEAD.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dry = process.argv.includes("--dry");
const fromHead = process.argv.includes("--from-head");
const PROPS = "public/models/props";
const FIXUP_ID = "cairo-canopies-v1";

const TARGETS = [
  {
    id: "cairo-block-4story",
    expectedComponents: 94,
    expectedTriangles: 424,
  },
  {
    id: "cairo-block-4story-centre",
    expectedComponents: 56,
    expectedTriangles: 256,
  },
];

const COMPONENT_BYTES = {
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
};

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC3: 3,
};

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

function accessorRef(json, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!componentBytes || !components) {
    throw new Error(
      `unsupported accessor ${accessor.componentType}/${accessor.type}`,
    );
  }
  return {
    accessor,
    view,
    componentBytes,
    start: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? componentBytes * components,
  };
}

function readShort(bin, ref, index, component) {
  return bin.readInt16LE(
    ref.start + index * ref.stride + component * ref.componentBytes,
  );
}

function readIndex(bin, ref, index) {
  return bin.readUInt16LE(ref.start + index * ref.stride);
}

function modelPosition(json, bin, ref, index) {
  if (ref.accessor.componentType !== 5122) {
    throw new Error("expected quantized SHORT positions");
  }
  const node = json.nodes.find((candidate) => candidate.mesh === 0) ?? {};
  const scale = node.scale ?? [1, 1, 1];
  const translation = node.translation ?? [0, 0, 0];
  return [0, 1, 2].map((axis) => {
    const raw = readShort(bin, ref, index, axis);
    const decoded = ref.accessor.normalized ? Math.max(raw / 32767, -1) : raw;
    return decoded * scale[axis] + translation[axis];
  });
}

function connectedComponents(json, bin, primitive) {
  const positionRef = accessorRef(json, primitive.attributes.POSITION);
  const indexRef = accessorRef(json, primitive.indices);
  if (indexRef.accessor.componentType !== 5123 || indexRef.stride !== 2) {
    throw new Error("expected tightly packed UNSIGNED_SHORT indices");
  }

  const indices = Array.from(
    { length: indexRef.accessor.count },
    (_, index) => readIndex(bin, indexRef, index),
  );
  const weldKeys = new Map();
  const weld = [];
  for (let index = 0; index < positionRef.accessor.count; index += 1) {
    const key = [0, 1, 2]
      .map((axis) => readShort(bin, positionRef, index, axis))
      .join(",");
    if (!weldKeys.has(key)) weldKeys.set(key, weldKeys.size);
    weld.push(weldKeys.get(key));
  }

  const parent = Array.from({ length: weldKeys.size }, (_, index) => index);
  const find = (input) => {
    let value = input;
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  const join = (first, second) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent[firstRoot] = secondRoot;
  };
  for (let offset = 0; offset < indices.length; offset += 3) {
    join(weld[indices[offset]], weld[indices[offset + 1]]);
    join(weld[indices[offset + 1]], weld[indices[offset + 2]]);
  }

  const components = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const root = find(weld[indices[offset]]);
    const component = components.get(root) ?? {
      triangleOffsets: [],
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    component.triangleOffsets.push(offset);
    for (let corner = 0; corner < 3; corner += 1) {
      const position = modelPosition(
        json,
        bin,
        positionRef,
        indices[offset + corner],
      );
      for (let axis = 0; axis < 3; axis += 1) {
        component.min[axis] = Math.min(component.min[axis], position[axis]);
        component.max[axis] = Math.max(component.max[axis], position[axis]);
      }
    }
    components.set(root, component);
  }
  return { components: [...components.values()], indices, indexRef };
}

/**
 * The canopy fabric is authored as separate alternating strips. In model
 * space each one is a narrow x strip, 0.157 m tall and 0.146 m deep, entirely
 * in front of the +Z facade. Cornice dentils are also narrow but span only
 * 0.089 m in z; sills span 0.059 m in y. Requiring all three dimensions plus
 * the outboard position separates the canopy pieces from both families.
 */
function isCanopyStrip(component) {
  const spanX = component.max[0] - component.min[0];
  const spanY = component.max[1] - component.min[1];
  const spanZ = component.max[2] - component.min[2];
  return (
    spanX > 0.015 &&
    spanX < 0.07 &&
    spanY > 0.15 &&
    spanY < 0.17 &&
    spanZ > 0.14 &&
    spanZ < 0.16 &&
    component.min[2] > 0.97 &&
    component.max[2] > 1.12 &&
    component.min[1] > 0.7 &&
    component.max[1] < 4.6
  );
}

for (const target of TARGETS) {
  const file = path.join(PROPS, `${target.id}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const input = fromHead
    ? execFileSync("git", ["show", `HEAD:${file.replaceAll("\\", "/")}`], {
        maxBuffer: 8 * 1024 * 1024,
      })
    : fs.readFileSync(file);
  const { json, bin } = parseGlb(input);
  const provenance = json.asset?.extras?.curbsideRush;
  const alreadyFixed = provenance?.canopy === FIXUP_ID;
  const nextBin = Buffer.from(bin);
  let removedComponents = 0;
  let removedTriangles = 0;

  for (const primitive of json.meshes[0]?.primitives ?? []) {
    const materialName = json.materials?.[primitive.material]?.name;
    if (materialName !== "Dark" && materialName !== "White") continue;
    const { components, indices, indexRef } = connectedComponents(
      json,
      bin,
      primitive,
    );
    const removedOffsets = new Set();
    for (const component of components) {
      if (!isCanopyStrip(component)) continue;
      removedComponents += 1;
      removedTriangles += component.triangleOffsets.length;
      for (const offset of component.triangleOffsets) removedOffsets.add(offset);
    }
    if (removedOffsets.size === 0) continue;

    const retained = [];
    for (let offset = 0; offset < indices.length; offset += 3) {
      if (removedOffsets.has(offset)) continue;
      retained.push(indices[offset], indices[offset + 1], indices[offset + 2]);
    }
    for (let index = 0; index < retained.length; index += 1) {
      nextBin.writeUInt16LE(retained[index], indexRef.start + index * 2);
    }
    nextBin.fill(
      0,
      indexRef.start + retained.length * 2,
      indexRef.start + indices.length * 2,
    );
    indexRef.accessor.count = retained.length;
  }

  if (removedComponents === 0) {
    if (!alreadyFixed) {
      throw new Error(`${target.id}: no canopies found and no ${FIXUP_ID} stamp`);
    }
    console.log(`${target.id}: verified no Western canopy geometry remains`);
    continue;
  }
  if (alreadyFixed) {
    throw new Error(`${target.id}: stamped ${FIXUP_ID} but canopy geometry remains`);
  }
  if (
    removedComponents !== target.expectedComponents ||
    removedTriangles !== target.expectedTriangles
  ) {
    throw new Error(
      `${target.id}: expected ${target.expectedComponents} components/` +
        `${target.expectedTriangles} triangles, found ${removedComponents}/` +
        `${removedTriangles}`,
    );
  }

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      ...(provenance ?? {}),
      canopy: FIXUP_ID,
    },
  };
  if (!dry) fs.writeFileSync(file, serializeGlb(json, nextBin));
  console.log(
    `${target.id}: ${dry ? "would remove" : "removed"} ` +
      `${removedComponents} canopy components (${removedTriangles} triangles)`,
  );
}
