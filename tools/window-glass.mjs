/**
 * Recovers the window panes that these building glbs model but never labelled.
 *
 * Why this exists: `BuildingLayer.applyNightGlow` lights a material named as
 * glass and nothing else — deliberately, because every attempt to recover a
 * window mask from these models' *textures* failed (see that method's header).
 * But a lot of the kits do model their panes as real geometry and simply bake
 * them into the wall's material, so the panes are recoverable from the
 * *geometry*, which is unambiguous where the texture was not.
 *
 * A pane, in every kit here, is a connected island that is:
 *   - flat (its thinnest bbox axis is a small fraction of its largest),
 *   - vertical (its area-weighted |normal.y| is near zero),
 *   - somewhere up the wall rather than at the plinth or on the roof,
 *   - small against the whole model, and
 *   - REPEATED — several islands of near-identical size. This is the load-
 *     bearing one. A door, a sign or a single flat awning panel passes every
 *     other test; only windows come in matching sets.
 *
 * Nothing here is automatic in the sense of "trust the output". The tool
 * proposes, `--report` prints what it would take, and a model only reaches
 * `ACCEPTED` below once its split has been looked at in the running game.
 *
 * Usage:
 *   node tools/window-glass.mjs --report [modelId...]   # propose, change nothing
 *   node tools/window-glass.mjs --write  [modelId...]   # rewrite accepted models
 *
 * The rewrite is deliberately the smallest possible edit to the file: the
 * pane triangles keep the exact same POSITION/NORMAL/TEXCOORD accessors and
 * only move to a second primitive with its own index accessor and a new
 * material named `<original>_Glass`. Sharing the vertex buffer keeps the two
 * primitives attribute-identical, which is what `Mesh.MergeMeshes` requires —
 * a split that introduced a differently-shaped vertex buffer would land the
 * model in `MERGE_INCOMPATIBLE_MODEL_IDS` and cost far more than it gained.
 */
import fs from "node:fs";
import path from "node:path";

const PROPS = "public/models/props";
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const targets = args.filter((a) => !a.startsWith("--"));

/**
 * The models whose split has been looked at, lit, in the running game. Nothing
 * outside this list is ever rewritten — `--report` will happily propose panes
 * for a model whose repeated flat vertical plates turn out to be something
 * else entirely, and three of them did:
 *
 *   - `nyc-tenement`  — its fire escape. 75 matching balusters, every test
 *                       passed, and the split lit the ironwork while the
 *                       windows stayed dark.
 *   - `nyc-tower-artdeco`, `residence`, `shop` — never confirmed in game, and
 *                       the latter two are venue props outside every building
 *                       set, so the split bought nothing to offset the risk.
 *   - `london-terrace-b`, `london-stucco-b` — their three proposed panes made
 *                       no visible difference at the placement checked, so the
 *                       proposal is unconfirmed either way. This kit variant
 *                       ships no `Glass` material at all and its windows are
 *                       unglazed recesses; it needs its own answer.
 *
 * The lesson is the reason this list exists: "repeated flat vertical plate" is
 * a good proposal and a bad decision. Only a screenshot decides.
 */
const ACCEPTED = new Set([
  // KayKit City Builder Bits — residential and shopfront alike.
  "london-shop", "london-walkup-a", "london-walkup-b",
  "cairo-shop", "cairo-walkup-a", "cairo-walkup-b", "cairo-residence-kay",
  "nyc-brownstone-a", "nyc-brownstone-b", "nyc-brownstone-c", "nyc-brownstone-d",
  "tokyo-walkup-a", "tokyo-walkup-b",
  // Photo-textured kits whose panes are real, separate islands.
  "nyc-house-b",
  "tokyo-house-a", "tokyo-house-b", "tokyo-house-c", "tokyo-apato-a",
]);

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let offset = 12, json = null, bin = Buffer.alloc(0);
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
    return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const total = 12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (length, type) => {
    const r = Buffer.alloc(8);
    r.writeUInt32LE(length, 0);
    r.writeUInt32LE(type, 4);
    return r;
  };
  const parts = [header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk];
  if (binChunk.length) parts.push(chunkHeader(binChunk.length, 0x004e4942), binChunk);
  return Buffer.concat(parts);
}

const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(json, bin, index) {
  const a = json.accessors[index];
  const n = NUM[a.type];
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4
    : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
  const out = new Float64Array(a.count * n);
  const view = json.bufferViews[a.bufferView];
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? n * size;
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) {
    const at = base + i * stride + c * size;
    out[i * n + c] =
      a.componentType === 5126 ? bin.readFloatLE(at)
      : a.componentType === 5125 ? bin.readUInt32LE(at)
      : a.componentType === 5123 ? bin.readUInt16LE(at)
      : a.componentType === 5121 ? bin.readUInt8(at) : bin.readInt8(at);
  }
  return out;
}

/** Connected islands of one primitive's triangles, welded by position. */
function islands(pos, tris) {
  const key = (v) => `${Math.round(pos[v * 3] * 4096)},${Math.round(pos[v * 3 + 1] * 4096)},${Math.round(pos[v * 3 + 2] * 4096)}`;
  const parent = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { const x = find(add(a)), y = find(add(b)); if (x !== y) parent.set(x, y); };
  for (const [a, b, c] of tris) { union(key(a), key(b)); union(key(b), key(c)); }
  const groups = new Map();
  for (const t of tris) {
    const root = find(key(t[0]));
    let g = groups.get(root);
    if (!g) groups.set(root, g = { tris: [], area: 0, up: 0, min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] });
    g.tris.push(t);
    const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const [p0, p1, p2] = [P(t[0]), P(t[1]), P(t[2])];
    for (const p of [p0, p1, p2]) for (let i = 0; i < 3; i++) {
      if (p[i] < g.min[i]) g.min[i] = p[i];
      if (p[i] > g.max[i]) g.max[i] = p[i];
    }
    const ax = p1[0]-p0[0], ay = p1[1]-p0[1], az = p1[2]-p0[2];
    const bx = p2[0]-p0[0], by = p2[1]-p0[1], bz = p2[2]-p0[2];
    const nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) { g.area += len / 2; g.up += (len / 2) * Math.abs(ny / len); }
  }
  return [...groups.values()];
}

/** Reads every primitive of a model, grouped by material index. */
function readModel(file) {
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const prims = [];
  const box = { min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] };
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const [primIndex, prim] of (mesh.primitives ?? []).entries()) {
      if (prim.attributes?.POSITION === undefined || prim.indices === undefined) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const idx = readAccessor(json, bin, prim.indices);
      const tris = [];
      for (let t = 0; t < idx.length; t += 3) tris.push([idx[t], idx[t + 1], idx[t + 2]]);
      for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) {
        if (pos[i + c] < box.min[c]) box.min[c] = pos[i + c];
        if (pos[i + c] > box.max[c]) box.max[c] = pos[i + c];
      }
      prims.push({ meshIndex, primIndex, prim, pos, tris });
    }
  }
  return { json, bin, prims, box };
}

/** Proposes the pane islands of one primitive. */
function proposePanes(prim, box) {
  const height = Math.max(1e-9, box.max[1] - box.min[1]);
  const all = islands(prim.pos, prim.tris);
  const totalArea = all.reduce((s, g) => s + g.area, 0);
  const candidates = all.filter((g) => {
    const raw = [0, 1, 2].map((i) => g.max[i] - g.min[i]);
    const dims = [...raw].sort((a, b) => a - b);
    // A pane is a thin plate whose thin axis is HORIZONTAL — that is what
    // makes it a vertical sheet of glass rather than a roof shingle, which is
    // an equally thin, equally repeated plate lying the other way up.
    const thinAxis = raw.indexOf(dims[0]);
    const flat = dims[0] <= dims[2] * 0.25 && thinAxis !== 1;
    const vertical = g.up / Math.max(g.area, 1e-9) < 0.25;
    const h = ((g.min[1] + g.max[1]) / 2 - box.min[1]) / height;
    const upTheWall = h > 0.12 && h < 0.95;
    // A window is small against the building in both senses: it spans a
    // fraction of the model's height, and it is a fraction of its surface.
    const modest = dims[2] <= height * 0.45 && g.area <= totalArea * 0.03;
    return flat && vertical && upTheWall && modest;
  });
  // REPEATED: keep only sizes that occur more than once (rounded to 2% of the
  // model's height), which is what separates panes from a lone flat panel.
  const bucket = (g) =>
    [0, 1, 2].map((i) => Math.round((g.max[i] - g.min[i]) / (height * 0.02))).sort((a, b) => a - b).join("x");
  const counts = new Map();
  for (const g of candidates) counts.set(bucket(g), (counts.get(bucket(g)) ?? 0) + 1);
  const panes = candidates.filter((g) => (counts.get(bucket(g)) ?? 0) >= 3);
  return { all, candidates, panes, counts, height };
}

const STYLE_ID = "window-glass-v1";

/**
 * The other half of the problem, and a different fix.
 *
 * `london-terrace-{b,e}` and `london-stucco-b` are the same Quaternius kit as
 * their `a/c/d` siblings but were exported without the siblings' `Glass`
 * material, so ~1_537 London buildings had no lit window at all. They cannot
 * be split: their panes are not separate islands (`--report` proposes only
 * three or four, and they made no visible difference), because the window
 * openings are cut into the wall mesh itself.
 *
 * What they do have is a material used for the window reveals and nothing
 * else on the street face. Renaming it is enough — the runtime test is by
 * name, so `Bricks` -> `Bricks_Glass` lights exactly those reveals with no
 * geometry change whatsoever.
 *
 * **This is only safe per model, and only after looking.** `Bricks` is real
 * brickwork on `london-terrace-a`, and on these variants it also owns some
 * large islands; the entries below were kept because three different street
 * faces of two placements each showed small lit windows and no glowing panel.
 * Their Cairo and Tokyo cousins (`cairo-block-slim`, `tokyo-block-slim`) have
 * the same shape of problem and are deliberately NOT here — their candidate
 * material is `Light`, which is a wall tone, and neither has been checked.
 */
const GLASS_RENAMES = {
  "london-terrace-b": "Bricks",
  "london-terrace-e": "Bricks",
  "london-stucco-b": "Bricks",
};

/** Renames one material so the runtime's by-name glass test picks it up. */
function renameGlass(file, material) {
  const { json, bin } = parseGlb(fs.readFileSync(file));
  if (json.asset?.extras?.curbsideRush?.windowGlass === STYLE_ID) return "already renamed";
  let renamed = 0;
  for (const m of json.materials ?? []) {
    if (m.name === material) { m.name = `${material}_Glass`; renamed++; }
  }
  if (!renamed) return `no material named ${material}`;
  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: { ...(json.asset.extras?.curbsideRush ?? {}), windowGlass: STYLE_ID },
  };
  fs.writeFileSync(file, serializeGlb(json, bin));
  return `renamed ${material} -> ${material}_Glass`;
}

/**
 * Moves the proposed pane triangles of one primitive onto their own material.
 * The new primitive reuses the source's attribute accessors verbatim, so the
 * two stay attribute-identical for `Mesh.MergeMeshes`; only the index buffer
 * and the material are new.
 */
function splitPanes(model, file) {
  const { json, bin } = model;
  if (json.asset?.extras?.curbsideRush?.windowGlass === STYLE_ID) return "already split";
  let movedTris = 0;
  const appended = [];
  for (const p of model.prims) {
    const { panes } = proposePanes(p, model.box);
    if (!panes.length) continue;
    const paneTris = new Set();
    for (const g of panes) for (const t of g.tris) paneTris.add(t);
    const keep = [], move = [];
    for (const t of p.tris) (paneTris.has(t) ? move : keep).push(t);
    if (!move.length || !keep.length) continue;

    const source = json.materials[p.prim.material];
    const glass = JSON.parse(JSON.stringify(source));
    glass.name = `${source.name ?? "material"}_Glass`;
    const glassIndex = json.materials.push(glass) - 1;

    const srcAccessor = json.accessors[p.prim.indices];
    const maxIndex = Math.max(...move.flat(), ...keep.flat());
    const componentType = maxIndex > 65535 ? 5125 : 5123;
    const write = (tris) => {
      const bytes = componentType === 5125 ? 4 : 2;
      const buf = Buffer.alloc(tris.length * 3 * bytes);
      let o = 0;
      for (const t of tris) for (const v of t) {
        if (componentType === 5125) buf.writeUInt32LE(v, o); else buf.writeUInt16LE(v, o);
        o += bytes;
      }
      return buf;
    };
    appended.push({ prim: p, keep: write(keep), move: write(move), componentType,
                    keepCount: keep.length * 3, moveCount: move.length * 3,
                    srcAccessor, srcView: p.prim.indices, glassIndex });
    movedTris += move.length;
  }
  if (!appended.length) return "nothing to split";

  // The wall's own index accessor is REUSED for the kept triangles, and its
  // bufferView's bytes are replaced in place. Appending a second buffer and
  // leaving the original behind instead costs the original index buffer in
  // dead weight in every shipped file — 188 KB across the eighteen models
  // before this was caught, for a pass whose whole job is to move triangles,
  // not to duplicate them. Only the pane buffer is genuinely new.
  const replacements = new Map();
  for (const a of appended) {
    const shared = json.accessors.filter(
      (acc, i) => i !== a.srcView && acc.bufferView === a.srcAccessor.bufferView,
    ).length;
    if (shared) continue; // someone else reads these bytes; fall back to appending
    replacements.set(a.srcAccessor.bufferView, a.keep);
    a.reusedView = a.srcAccessor.bufferView;
  }

  // Repack: every existing bufferView (replaced where the kept indices took it
  // over), then the new pane index buffers.
  const chunks = [];
  let cursor = 0;
  const push = (buf) => {
    chunks.push(buf);
    const at = cursor;
    cursor += buf.length;
    const pad = (4 - (cursor % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); cursor += pad; }
    return at;
  };
  for (const [index, view] of json.bufferViews.entries()) {
    const start = view.byteOffset ?? 0;
    const source = replacements.get(index) ?? Buffer.from(bin.subarray(start, start + view.byteLength));
    view.byteOffset = push(source);
    view.byteLength = source.length;
  }
  for (const a of appended) {
    const moveView = json.bufferViews.push({
      buffer: 0, byteOffset: push(a.move), byteLength: a.move.length, target: 34963,
    }) - 1;
    // The wall keeps its original primitive AND its original accessor, now
    // counting only its own triangles.
    if (a.reusedView !== undefined) {
      a.srcAccessor.componentType = a.componentType;
      a.srcAccessor.count = a.keepCount;
      delete a.srcAccessor.byteOffset;
      delete a.srcAccessor.min;
      delete a.srcAccessor.max;
    } else {
      const keepView = json.bufferViews.push({
        buffer: 0, byteOffset: push(a.keep), byteLength: a.keep.length, target: 34963,
      }) - 1;
      a.prim.prim.indices = json.accessors.push({
        bufferView: keepView, componentType: a.componentType, count: a.keepCount, type: "SCALAR",
      }) - 1;
    }
    const glassAccessor = json.accessors.push({
      bufferView: moveView, componentType: a.componentType, count: a.moveCount, type: "SCALAR",
    }) - 1;
    json.meshes[a.prim.meshIndex].primitives.push({
      attributes: a.prim.prim.attributes,
      indices: glassAccessor,
      material: a.glassIndex,
      ...(a.prim.prim.mode !== undefined ? { mode: a.prim.prim.mode } : {}),
    });
  }
  const nextBin = Buffer.concat(chunks);
  json.buffers[0].byteLength = nextBin.length;
  json.asset ??= { version: "2.0" };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    curbsideRush: {
      ...(json.asset.extras?.curbsideRush ?? {}),
      // Marker only — what the pass does and why is in this file's header and
      // in CREDITS.md. Provenance keys are byte-pinned by the per-city asset
      // tests, so a paragraph here would be a paragraph in three test files.
      windowGlass: STYLE_ID,
    },
  };
  fs.writeFileSync(file, serializeGlb(json, nextBin));
  return `split ${movedTris} pane triangles onto ${appended.length} new material(s)`;
}

const files = (targets.length
  ? targets.map((t) => `${PROPS}/${t}.glb`)
  : fs.readdirSync(PROPS).filter((f) => f.endsWith(".glb")).map((f) => `${PROPS}/${f}`));

for (const file of files) {
  const id = path.basename(file, ".glb");
  let model;
  try { model = readModel(file); } catch (e) { console.log(`${id}: SKIP (${e.message})`); continue; }
  const { json, prims, box } = model;
  // Only models that have no glass material of their own are interesting.
  const named = (json.materials ?? []).some((m) => /window|glass|cristal/i.test(m.name ?? ""));
  if (named && !targets.length) continue;
  const lines = [];
  for (const p of prims) {
    const { panes, candidates, counts } = proposePanes(p, box);
    if (!panes.length && !targets.length) continue;
    const mat = json.materials?.[p.prim.material];
    const tris = panes.reduce((s, g) => s + g.tris.length, 0);
    const sizes = [...counts.entries()].filter(([, n]) => n >= 3)
      .map(([k, n]) => `${n}x[${k}]`).join(" ");
    lines.push(`    ${(mat?.name ?? "?").padEnd(22)} islands=${String(candidates.length).padStart(3)}  panes=${String(panes.length).padStart(3)} (${tris} tris)  ${sizes}`);
  }
  if (lines.length) {
    console.log(`\n${id}${named ? "  (already has a named glass material)" : ""}`);
    for (const l of lines) console.log(l);
    if (WRITE && !GLASS_RENAMES[id]) {
      console.log(
        `    -> ${ACCEPTED.has(id) ? splitPanes(model, file) : "not in ACCEPTED — left alone"}`,
      );
    }
  }
}

// The rename pass stands apart from the split pass: these models are reached
// by model id, not by whether the pane proposal happened to find anything.
if (WRITE) {
  for (const [id, material] of Object.entries(GLASS_RENAMES)) {
    if (targets.length && !targets.includes(id)) continue;
    console.log(`\n${id}\n    -> ${renameGlass(`${PROPS}/${id}.glb`, material)}`);
  }
}
