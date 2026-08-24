/**
 * Two Cairo-only corrections to the KayKit shopfronts.
 *
 * 1. **Deletes the awning.** The pack gives its ground-floor canopy a
 *    scalloped two-tone stripe, which reads American-diner / European-seaside.
 *    Cairo's shopfront vocabulary here is a flat signboard fascia and roller
 *    shutter. Recolouring the canopy in v2 removed the stripes but left the
 *    large Western-style silhouette visible, so v3 removes it outright.
 *
 * 2. **Deletes the imported fire hydrant.** The Poly Pizza exports carry the
 *    pack's diorama base, and an American pillar hydrant came with it. Cairo's
 *    roadside prop list has no hydrant (only NYC's does), so this one arrived
 *    inside the model rather than from the map. `stripMeshPattern` in
 *    PROP_MODEL_REGISTRY is the usual tool for bundled clutter, but it filters
 *    whole meshes and this glb is a single merged primitive — hence geometry
 *    surgery here instead.
 *
 * Neither change may touch NYC or London. The walk-ups are already Cairo-only
 * files; `shop.glb` is shared, so Cairo gets its own `cairo-shop.glb` copy and
 * the original is left exactly as it is. Same reason `cairo-walkup-b` exists
 * next to `nyc-brownstone-b`: `modelLibrary` keys containers by URL, so one file
 * cannot hold two cities' worth of decisions.
 *
 * v2: cairo-residence-kay's door canopy is a 29-triangle component — one
 * triangle under v1's >=30 filter — and its stripes alternate two *lower-half*
 * swatches (terracotta u≈0.97, white u≈0.18), so the v-0.5 remap could never
 * have fixed it anyway. It gets deleted outright. Each target now declares
 * what the filter must find ("darken" exactly one, "delete" exactly one,
 * "none" zero) and the run throws on any mismatch, so the stamp means
 * "verified", not merely "visited" — v1 stamped walkup-b and residence-kay
 * without changing a byte, which is how the striped canopy shipped twice.
 *
 * v3: the two v2 "darken" targets are now deleted as well. This also forces a
 * fresh connected-component scan instead of trusting the old v2 stamp, so a
 * surviving hydrant cannot hide behind "already fixed".
 *
 * Run after tools/style-cairo-residences.mjs. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const dry = process.argv.includes("--dry");
const verbose = process.argv.includes("--verbose");
const fromHead = process.argv.includes("--from-head");
const PROPS = "public/models/props";
const FIXUP_ID = "cairo-shopfront-v3";

/**
 * Cairo-only files. Never add a shared one here. `awning` is what the filter
 * must find: "delete" requires exactly one canopy component and "none" zero.
 */
const TARGETS = [
  { id: "cairo-shop", awning: "delete", hydrants: 1 },
  { id: "cairo-walkup-a", awning: "delete", hydrants: 1 },
  { id: "cairo-walkup-b", awning: "none", hydrants: 0 },
  { id: "cairo-residence-kay", awning: "none", hydrants: 0 },
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
  header.writeUInt32LE(12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0), 8);
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

const viewOf = (json, accessorIndex) => {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  if (view.byteStride) throw new Error("interleaved accessor not supported");
  return { accessor, view, start: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) };
};

for (const { id, awning: awningPolicy, hydrants: expectedHydrants } of TARGETS) {
  const file = path.join(PROPS, `${id}.glb`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const input = fromHead
    ? execFileSync("git", ["show", `HEAD:${file.replaceAll("\\", "/")}`], {
        maxBuffer: 8 * 1024 * 1024,
      })
    : fs.readFileSync(file);
  const { json, bin } = parseGlb(input);
  const alreadyFixed = json.asset?.extras?.curbsideRush?.shopfront === FIXUP_ID;
  const prim = json.meshes[0].primitives[0];
  if (json.meshes.length !== 1 || !prim) {
    throw new Error(`${id}: expected one merged mesh with an opaque primitive`);
  }
  const image = json.images?.[0];
  if (image?.bufferView === undefined) throw new Error(`${id}: expected an embedded atlas`);
  const imageView = json.bufferViews[image.bufferView];
  const { data: atlasData, info: atlasInfo } = await sharp(
    bin.subarray(imageView.byteOffset ?? 0, (imageView.byteOffset ?? 0) + imageView.byteLength),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const atlas = { data: atlasData, ...atlasInfo };

  const posRef = viewOf(json, prim.attributes.POSITION);
  const uvRef = viewOf(json, prim.attributes.TEXCOORD_0);
  const idxRef = viewOf(json, prim.indices);
  if (posRef.accessor.componentType !== 5126 || uvRef.accessor.componentType !== 5126) {
    throw new Error(`${id}: expected float POSITION/TEXCOORD_0`);
  }
  if (idxRef.accessor.componentType !== 5123) {
    throw new Error(`${id}: expected uint16 indices`);
  }

  const vertexCount = posRef.accessor.count;
  const position = (i) => [
    bin.readFloatLE(posRef.start + i * 12),
    bin.readFloatLE(posRef.start + i * 12 + 4),
    bin.readFloatLE(posRef.start + i * 12 + 8),
  ];
  const uvAt = (i) => [
    bin.readFloatLE(uvRef.start + i * 8),
    bin.readFloatLE(uvRef.start + i * 8 + 4),
  ];
  const indices = [];
  for (let i = 0; i < idxRef.accessor.count; i += 1) {
    indices.push(bin.readUInt16LE(idxRef.start + i * 2));
  }

  const bounds = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (let i = 0; i < vertexCount; i += 1) {
    const p = position(i);
    for (const [k, axis] of [[0, "x"], [1, "y"], [2, "z"]]) {
      bounds[axis][0] = Math.min(bounds[axis][0], p[k]);
      bounds[axis][1] = Math.max(bounds[axis][1], p[k]);
    }
  }
  const norm = (value, axis) =>
    (value - bounds[axis][0]) / (bounds[axis][1] - bounds[axis][0] || 1);

  // Weld by position so a "part" is a connected lump of geometry.
  const weldKey = new Map();
  const weld = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const p = position(i);
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
    if (!weldKey.has(key)) weldKey.set(key, weldKey.size);
    weld.push(weldKey.get(key));
  }
  const parent = Array.from({ length: weldKey.size }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < indices.length; t += 3) {
    join(weld[indices[t]], weld[indices[t + 1]]);
    join(weld[indices[t + 1]], weld[indices[t + 2]]);
  }

  const parts = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(weld[indices[t]]);
    const part = parts.get(root) ?? {
      tris: [],
      verts: new Set(),
      x: [1, 0],
      y: [1, 0],
      z: [1, 0],
    };
    part.tris.push(t);
    for (const k of [0, 1, 2]) {
      const vi = indices[t + k];
      part.verts.add(vi);
      const p = position(vi);
      part.x[0] = Math.min(part.x[0], norm(p[0], "x"));
      part.x[1] = Math.max(part.x[1], norm(p[0], "x"));
      part.y[0] = Math.min(part.y[0], norm(p[1], "y"));
      part.y[1] = Math.max(part.y[1], norm(p[1], "y"));
      part.z[0] = Math.min(part.z[0], norm(p[2], "z"));
      part.z[1] = Math.max(part.z[1], norm(p[2], "z"));
    }
    parts.set(root, part);
  }
  const partList = [...parts.values()];

  // ---- 1. The awning: a wide, shallow canopy hanging off a facade, well below
  // the roofline, and big enough to be the striped canopy rather than a sill.
  // >=25 triangles: the residence-kay door canopy has 29, and v1's >=30 let it
  // ship striped.
  const awnings = partList.filter((p) => {
    const spanX = p.x[1] - p.x[0];
    const spanZ = p.z[1] - p.z[0];
    const outboard = p.z[1] > 0.84 || p.z[0] < 0.16 || p.x[1] > 0.84 || p.x[0] < 0.16;
    return (
      outboard &&
      Math.max(spanX, spanZ) > 0.35 &&
      Math.min(spanX, spanZ) > 0.05 &&
      Math.min(spanX, spanZ) < 0.3 &&
      p.y[0] > 0.1 &&
      p.y[1] < 0.8 &&
      p.tris.length >= 25
    );
  });
  const expectedAwnings = alreadyFixed || awningPolicy === "none" ? 0 : 1;
  if (awnings.length !== expectedAwnings) {
    throw new Error(
      `${id}: awning policy "${awningPolicy}" expects ${expectedAwnings} ` +
        `canopy component(s), filter found ${awnings.length} — refusing to stamp`,
    );
  }

  const uvEdits = [];

  // A vertex shared with anything outside the awning would drag that face's
  // colour along with it. glTF splits vertices per uv so this should never fire.
  for (const awning of awnings) {
    for (const part of partList) {
      if (part === awning) continue;
      for (const vi of part.verts) {
        if (awning.verts.has(vi)) throw new Error(`${id}: awning vertex ${vi} shared`);
      }
    }
  }

  // ---- 2. The fire hydrant: a small lump standing on the base slab, clear of
  // the building's own footprint — and *red*.
  //
  // Shape alone is not enough. These models repeat small posts and planters
  // along the frontage at even spacing, and a shape-only rule happily deleted
  // four of them. Red dominance is what actually separates the hydrant from its
  // neighbours, in both the raw pack colours and the Cairo-toned ones.
  const meanColour = (part) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const vi of part.verts) {
      const [u, v] = uvAt(vi);
      const x = Math.min(atlas.width - 1, Math.max(0, Math.round(u * atlas.width)));
      const y = Math.min(atlas.height - 1, Math.max(0, Math.round((1 - v) * atlas.height)));
      const o = (y * atlas.width + x) * atlas.channels;
      r += atlas.data[o];
      g += atlas.data[o + 1];
      b += atlas.data[o + 2];
      n += 1;
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };

  if (dry && verbose) {
    for (const p of partList) {
      const spanX = p.x[1] - p.x[0];
      const spanZ = p.z[1] - p.z[0];
      const spanY = p.y[1] - p.y[0];
      if (p.y[0] >= 0.2 || spanY <= 0.005 || Math.max(spanX, spanZ) >= 0.25) continue;
      const [r, g, b] = meanColour(p);
      console.log(
        `    compact tris=${p.tris.length} rgb(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})` +
          ` x[${p.x[0].toFixed(2)},${p.x[1].toFixed(2)}] y[${p.y[0].toFixed(2)},${p.y[1].toFixed(2)}] z[${p.z[0].toFixed(2)},${p.z[1].toFixed(2)}]`,
      );
    }
  }

  // The actual hydrant is a three-component cluster: its 120-triangle body,
  // 40-triangle collar and 12-triangle cap. v2 mistook a separate 18-triangle
  // cardboard box for the hydrant, which is why the screenshot still showed
  // the hydrant and lost the box. Anchor on the distinctive body, then remove
  // only the three co-located component signatures; never colour-match it.
  const hydrantCores = partList.filter((p) => {
    const spanX = p.x[1] - p.x[0];
    const spanZ = p.z[1] - p.z[0];
    const spanY = p.y[1] - p.y[0];
    return (
      p.tris.length === 120 &&
      p.y[0] < 0.15 &&
      p.y[1] < 0.25 &&
      spanY > 0.05 &&
      Math.max(spanX, spanZ) < 0.1
    );
  });
  const expectedHydrantCount = alreadyFixed ? 0 : expectedHydrants;
  if (hydrantCores.length !== expectedHydrantCount) {
    throw new Error(
      `${id}: expected ${expectedHydrantCount} hydrant body component(s), found ${hydrantCores.length} — refusing to stamp`,
    );
  }

  const componentCentre = (p, axis) => (p[axis][0] + p[axis][1]) / 2;
  const clutter = partList.filter((p) =>
    hydrantCores.some((core) => {
      const dx = Math.abs(componentCentre(p, "x") - componentCentre(core, "x"));
      const dz = Math.abs(componentCentre(p, "z") - componentCentre(core, "z"));
      return (
        (p.tris.length === 120 || p.tris.length === 40 || p.tris.length === 12) &&
        p.y[0] < 0.2 &&
        p.y[1] < 0.25 &&
        dx < 0.04 &&
        dz < 0.04
      );
    }),
  );
  if (clutter.length !== hydrantCores.length * 3) {
    throw new Error(
      `${id}: each hydrant body must resolve to exactly three geometry components; found ${clutter.length}`,
    );
  }

  if (alreadyFixed) {
    console.log(`${id}: verified no canopy or hydrant geometry remains`);
    continue;
  }

  const dropped = new Set(clutter.flatMap((p) => p.tris));
  if (awningPolicy === "delete") {
    for (const awning of awnings) for (const t of awning.tris) dropped.add(t);
  }
  const keptIndices = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (dropped.has(t)) continue;
    keptIndices.push(indices[t], indices[t + 1], indices[t + 2]);
  }

  console.log(
    `${id}: awning=${awningPolicy}×${awnings.length} (${uvEdits.length} uv verts remapped), ` +
      `parts removed=${clutter.length + (awningPolicy === "delete" ? awnings.length : 0)} ` +
      `(${(indices.length - keptIndices.length) / 3} tris)`,
  );
  for (const p of clutter) {
    console.log(
      `    dropped tris=${p.tris.length} x[${p.x[0].toFixed(2)},${p.x[1].toFixed(2)}]` +
        ` y[${p.y[0].toFixed(2)},${p.y[1].toFixed(2)}] z[${p.z[0].toFixed(2)},${p.z[1].toFixed(2)}]`,
    );
  }
  if (dry) continue;

  // Apply the uv remap in place — same buffer view, same length.
  const nextBin = Buffer.from(bin);
  for (const [vi, u, v] of uvEdits) {
    nextBin.writeFloatLE(u, uvRef.start + vi * 8);
    nextBin.writeFloatLE(v, uvRef.start + vi * 8 + 4);
  }

  // Rebuild the bin so the shortened index view keeps every other view intact.
  const newIndexData = Buffer.alloc(keptIndices.length * 2);
  keptIndices.forEach((value, i) => newIndexData.writeUInt16LE(value, i * 2));
  const replacement = new Map([[json.accessors[prim.indices].bufferView, newIndexData]]);
  const chunks = [];
  let cursor = 0;
  for (const [index, view] of json.bufferViews.entries()) {
    const start = view.byteOffset ?? 0;
    const source =
      replacement.get(index) ?? nextBin.subarray(start, start + view.byteLength);
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
  json.accessors[prim.indices].count = keptIndices.length;
  const outBin = Buffer.concat(chunks);
  json.buffers[0].byteLength = outBin.length;

  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      ...(json.asset.extras?.curbsideRush ?? {}),
      shopfront: FIXUP_ID,
    },
  };
  fs.writeFileSync(file, serializeGlb(json, outBin));
}
