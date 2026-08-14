#!/usr/bin/env node
/**
 * Splits 99.Miles' "Asian Themed Low Poly Night City Buildings" Sketchfab pack
 * (Tokyo authenticity plan section 5.2/5.5, uid
 * 9f0343aff4814b758dc6e905aba5b5e0) into several self-contained
 * `tokyo-zakkyo-*.glb` files — the downtown/zakkyo backbone's night-window
 * read.
 *
 * Precedent: `tools/split-bicycle-pedals.mjs` (geometry surgery in a
 * hand-written tool, measured facts hard-checked, never guessed).
 *
 * ## What the source scene actually is (measured, not assumed)
 *
 * One root ("Sketchfab_model" -> "BACKGROUND_CITY_SKYLINE.fbx" -> "RootNode")
 * with 26 mesh-bearing children: 19 are real buildings (materials
 * `BACKGROUND_BUILDINGS_1` / `BACKGROUND_BUILDING_2`, two shared 2k texture
 * sets each with baseColor/metallicRoughness/emissive/`KHR_materials_clearcoat`
 * clearcoat maps, all on TEXCOORD_0 — the "two shared 2k textures with an
 * emissive-map variant" the plan describes), 7 are `RED_FLARE`/`Flare`
 * lens-flare glow cards (materials `RED_FLARE`/`Flare`, `alphaMode: BLEND`,
 * `KHR_materials_specular`) — a matte-painting-style VFX trick baked into
 * the source scene's own hero render, unrelated to any building's
 * architecture. Same category `tools/style-tokyo-buildings.mjs`'s
 * `STRIP_NODES` already established for P1 (diorama/street-furniture,
 * unlinked from the building) — stripped entirely here, never carried into
 * any split file: this game reads "glowing night windows" through real
 * emissive materials + engine bloom (see the emissive-strength step in
 * `style-tokyo-buildings.mjs`), not sprite flares, and a stray
 * alpha-blended flare card floating disconnected in Babylon with no
 * camera-facing billboard behaviour would read as a bug, not a light.
 *
 * **Every one of the 19 buildings' own container node ("BACKGROUND_
 * BUILDINGS_1.001" etc.) carries a substantial, non-identity `matrix`** —
 * NOT the identity transform a first pass through this tool assumed from
 * only checking for `translation`/`rotation`/`scale` fields (glTF nodes use
 * EITHER `matrix` OR TRS, never both — every one of these 19 containers
 * uses `matrix`, none use TRS, confirmed: zero nodes in the source carry
 * both). Each one's matrix is its own arbitrary scale (~100x, evidently a
 * corrective factor from the artist's own Blender/FBX pipeline) times a
 * rotation times a large translation (tens of thousands of units) — the
 * REAL reason all 19 appear to overlap at a glance (their raw POSITION
 * accessor min/max, which is pre-this-matrix, clusters everything near a
 * shared local origin) is this per-building corrective matrix scattering
 * them across a much larger space than the accessor data alone suggests.
 * **A first version of this tool added a `translation` field onto these
 * already-`matrix`-bearing nodes** — glTF-invalid (both present), and
 * Babylon's loader silently keeps the pre-existing `matrix` and ignores the
 * added `translation` entirely, which would have shipped every building at
 * its ORIGINAL scattered/overlapping position, not the intended laid-out
 * row. Caught by re-measuring the written output under NullEngine (the
 * exact `getBuildingMaster` recipe) and finding the reported row width
 * didn't match a hand-computation from the intended per-building offsets —
 * "never trust a manifest against itself" applies just as much to a
 * geometry-surgery tool's own output as to a curated bounds table.
 *
 * ## The fix: bake world transforms via Babylon, not hand-rolled matrix math
 *
 * Given nested, non-trivial matrices (ancestor unit-conversion nodes AND a
 * per-building corrective matrix), hand-composing a "new translation delta"
 * on top would need correctly inverting/re-deriving several chained
 * rotation+scale matrices — exactly the class of arithmetic this codebase's
 * OWN `getBuildingMaster` recipe already solves, battle-tested, for every
 * other building in the catalogue. So this tool loads the pack under a real
 * Babylon `NullEngine` (see `tests/buildingPlacement.test.ts`'s identical
 * pattern), instantiates real mesh clones, and for each KEPT building calls
 * `Mesh.MergeMeshes` on that one mesh alone (a "solo merge" — bakes its full
 * world matrix, ancestors included, into fresh vertex data at identity
 * transform) plus `orientMergedFacesOutward` (fixes winding if the loader's
 * mirror flipped it) — the same two calls `getBuildingMaster` makes, just
 * skipping the multi-mesh merge since each building is kept as its own
 * separate mesh/node in the output (`squareUpMergedMaster`/
 * `recentreMergedMasterXZ` are NOT called here — those centre/square a
 * *combined* master for placement; this tool wants each building's own
 * baked-but-unmoved world position so the row layout below can position it
 * deliberately). The result is real, world-space, correctly-wound
 * POSITION/NORMAL data this tool reads directly and re-emits — no manual
 * matrix inversion anywhere.
 *
 * ## Grouping
 *
 * First split by MATERIAL FAMILY (measured: 10 `BACKGROUND_BUILDINGS_1`
 * buildings, 9 `BACKGROUND_BUILDING_2`) — a first cut tried grouping across
 * both families by height alone and every one of the 6 resulting files ended
 * up needing BOTH materials (both families span the whole height range), so
 * the material pruning bought nothing: every file still embedded all 8
 * texture maps (~22 MB each, pre-downscale). Partitioning by family first
 * means most files carry only 4 of the 8 maps — roughly half the texture
 * payload — and still reads as real variety, just at the level of "this is a
 * BACKGROUND_BUILDINGS_1-skinned cluster" vs "this is a BACKGROUND_BUILDING_2
 * one" rather than mixing skins inside one placed cluster (arguably more
 * architecturally coherent: a single placed "building" prop reading as one
 * consistent facade family, the way `cairo-office-block`/`cairo-depot`'s
 * shared-source runs do). Within each family, buildings are sorted by
 * measured WORLD-SPACE height (Y-extent, post-bake) descending and dealt
 * round-robin into that family's own sub-group count — a tall/short mix per
 * file so every split still reads as a believable little skyline segment
 * rather than a monotone one, the same "variety" principle `buildingSets.ts`'s
 * own SETS comments apply to Cairo/London (a run needs >=4 models or it
 * reads as copy-paste). Deterministic; no `Math.random`.
 * `FAMILY_SUBGROUP_COUNTS` below is the concrete split: 10 BUILDINGS_1 -> 3
 * files ([4,3,3]), 9 BUILDING_2 -> 3 files ([3,3,3]) — 6 files total, every
 * one inside the plan's "2-4 buildings' variety each" range.
 *
 * ## Layout ("re-origin each at its own base-centre")
 *
 * Within a group, buildings are placed left-to-right along world-space X in
 * dealt order, snug with a fixed gap, each shifted so its own base sits at
 * Y=0 and its own Z-centre sits at Z=0 (a single street-facing row — no
 * depth stagger), then the whole row is re-centred so its own X-span
 * midpoint lands on X=0. Unlike the first (buggy) version, the reposition
 * here is applied by adding a plain (dx, dy, dz) offset directly to each
 * building's already WORLD-SPACE-BAKED position array — no node transform
 * involved at all, so there is no matrix-conflict class of bug to hit.
 *
 * ## Materials/textures/images are pruned; geometry is freshly built
 *
 * `materials`/`textures`/`images` are pruned to exactly what a file's kept
 * buildings reference (indices remapped) — real savings, since a group
 * built entirely from `BACKGROUND_BUILDINGS_1`-textured buildings has no
 * reason to also carry `BACKGROUND_BUILDING_2`'s images. Unlike the first
 * version, geometry is NOT copied verbatim from the shared source buffer:
 * each kept building's baked POSITION/NORMAL/TEXCOORD_0/indices are written
 * into fresh, per-building accessors/bufferViews (plain float32/uint16, no
 * quantization) sized to exactly what that file needs — a smaller and
 * simpler result than re-embedding the whole 598 KB shared source buffer in
 * every file, and it sidesteps the original design's now-moot "is slicing
 * the shared interleaved buffer worth the risk" question entirely.
 *
 * ## Usage
 *
 *   node tools/split-asian-city-pack.mjs <source-dir> [--dry]
 *
 * `<source-dir>` is the extracted Sketchfab glTF export directory (containing
 * `scene.gltf` + `scene.bin` + `textures/`) — re-download from the model's
 * own page (CREDITS.md has the source URL + original archive SHA-256) and
 * unzip; nothing here reads from a session-specific path. Writes
 * `public/models/props/tokyo-zakkyo-{a..f}.glb`, un-normalized (no texture
 * downscale, no emissive-strength boost, no provenance stamp yet) — run
 * `node tools/style-tokyo-buildings.mjs` next.
 */
import fs from "node:fs";
import path from "node:path";
import {
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
  VertexBuffer,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { packGltf, serializeGlb, parseGlb } from "./pack-gltf.mjs";

/**
 * Inlined from `app/game/buildingWinding.ts` (verbatim logic) rather than
 * imported: every other `tools/*.mjs` script in this repo is a plain Node
 * script with no TS-import step, and this is the one place that needs this
 * particular production helper — see `getBuildingMaster`
 * (`app/game/render/babylonGameSession.ts`) for the production call site
 * this mirrors.
 */
function windingAgreement(mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  let agree = 0;
  let disagree = 0;
  if (!positions || !normals || !indices) return { agree, disagree };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const gx = e1y * e2z - e1z * e2y;
    const gy = e1z * e2x - e1x * e2z;
    const gz = e1x * e2y - e1y * e2x;
    const nx = normals[a] + normals[b] + normals[c];
    const ny = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nz = normals[a + 2] + normals[b + 2] + normals[c + 2];
    const dot = gx * nx + gy * ny + gz * nz;
    if (dot > 1e-9) agree += 1;
    else if (dot < -1e-9) disagree += 1;
  }
  return { agree, disagree };
}
function orientMergedFacesOutward(mesh) {
  const { agree, disagree } = windingAgreement(mesh);
  if (disagree > agree) {
    mesh.flipFaces(false);
    return true;
  }
  return false;
}

registerBuiltInLoaders();

const dry = process.argv.includes("--dry");
const sourceDir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!sourceDir) {
  console.error("usage: node tools/split-asian-city-pack.mjs <source-dir> [--dry]");
  process.exit(1);
}
const PROPS = "public/models/props";
const GAP_M = 8; // gap between adjacent buildings in a laid-out row (native/world units)
const GROUP_LETTERS = ["a", "b", "c", "d", "e", "f"];
const EXPECTED_BUILDING_COUNT = 19;
const EXPECTED_FLARE_COUNT = 7;
/** Measured 10/9 family split (see the header's "Grouping" section) — a
 * drift guard asserts these counts still hold before dealing. */
const FAMILY_SUBGROUP_COUNTS = {
  BACKGROUND_BUILDINGS_1: 3,
  BACKGROUND_BUILDING_2: 3,
};
const FLARE_MATERIALS = new Set(["RED_FLARE", "Flare"]);

// ---------------------------------------------------------------------------
// 1. Pack the WHOLE raw source (all 26 meshes, unpruned) into one in-memory
//    self-contained glb — packGltf's existing, tested embed logic — so it
//    can be loaded by Babylon (which needs one resolvable resource, not a
//    directory of loose files) without writing anything to disk yet.
// ---------------------------------------------------------------------------

const sourceGltf = JSON.parse(fs.readFileSync(path.join(sourceDir, "scene.gltf"), "utf8"));
const loadResource = (uri) => fs.readFileSync(path.join(sourceDir, uri));
const { json: packedJson, bin: packedBin } = packGltf(sourceGltf, loadResource);
const wholePackGlb = serializeGlb(packedJson, packedBin);

// ---------------------------------------------------------------------------
// 2. Load under NullEngine, real-clone-instantiate, bake each building's own
//    world transform via a solo Mesh.MergeMeshes (getBuildingMaster's own
//    two-call recipe) — see the header's "The fix" section.
// ---------------------------------------------------------------------------

const engine = new NullEngine();
const scene = new Scene(engine);
const dataUrl = "data:model/gltf-binary;base64," + wholePackGlb.toString("base64");
const container = await LoadAssetContainerAsync(dataUrl, scene, { pluginExtension: ".glb" });
const entries = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
const root = entries.rootNodes[0];
root.computeWorldMatrix(true);
const rawMeshes = root
  .getChildMeshes(false)
  .filter((m) => m instanceof Mesh && m.getTotalVertices() > 0);
for (const m of rawMeshes) m.computeWorldMatrix(true);

if (rawMeshes.length !== EXPECTED_BUILDING_COUNT + EXPECTED_FLARE_COUNT) {
  throw new Error(
    `expected ${EXPECTED_BUILDING_COUNT + EXPECTED_FLARE_COUNT} meshes, found ${rawMeshes.length} — source pack drifted`,
  );
}

/** Bakes one mesh's world transform into fresh, standalone, correctly-wound
 * vertex data (getBuildingMaster's own recipe, applied to a single mesh). */
function bakeWorldMesh(mesh) {
  const baked = Mesh.MergeMeshes([mesh], true, true, undefined, false, true);
  if (!baked) throw new Error(`solo bake failed for ${mesh.name}`);
  orientMergedFacesOutward(baked);
  const positions = Float32Array.from(baked.getVerticesData(VertexBuffer.PositionKind));
  const normals = Float32Array.from(baked.getVerticesData(VertexBuffer.NormalKind));
  const uvs = Float32Array.from(baked.getVerticesData(VertexBuffer.UVKind));
  const indices = Uint32Array.from(baked.getIndices());
  const bb = baked.getBoundingInfo().boundingBox;
  baked.dispose();
  return {
    positions, normals, uvs, indices,
    min: [bb.minimum.x, bb.minimum.y, bb.minimum.z],
    max: [bb.maximum.x, bb.maximum.y, bb.maximum.z],
  };
}

const building = [];
for (const mesh of rawMeshes) {
  const materialName = mesh.material?.name;
  if (FLARE_MATERIALS.has(materialName)) continue; // stripped — see header
  building.push({ name: mesh.name, material: materialName, ...bakeWorldMesh(mesh) });
}
if (building.length !== EXPECTED_BUILDING_COUNT) {
  throw new Error(`expected ${EXPECTED_BUILDING_COUNT} buildings, found ${building.length}`);
}
scene.dispose();
engine.dispose();

// ---------------------------------------------------------------------------
// 3. Deal into groups: partition by material family, then within each
//    family deal by WORLD-SPACE height (descending, round robin).
// ---------------------------------------------------------------------------

const heightOf = (b) => b.max[1] - b.min[1];
const groups = [];
for (const [family, subgroupCount] of Object.entries(FAMILY_SUBGROUP_COUNTS)) {
  const inFamily = building.filter((b) => b.material === family);
  if (inFamily.length === 0) {
    throw new Error(`no buildings found for material family "${family}" — source pack drifted`);
  }
  const dealt = [...inFamily].sort((a, b) => heightOf(b) - heightOf(a));
  const subgroups = Array.from({ length: subgroupCount }, () => []);
  dealt.forEach((b, i) => subgroups[i % subgroupCount].push(b));
  groups.push(...subgroups);
}
for (const group of groups) {
  if (group.length < 2 || group.length > 4) {
    throw new Error(`group sizing drifted outside [2,4]: ${group.map((b) => b.name)}`);
  }
}
if (groups.length !== GROUP_LETTERS.length) {
  throw new Error(`expected ${GROUP_LETTERS.length} groups, got ${groups.length}`);
}

/** Lays a group's baked buildings left-to-right along world X, each
 * grounded at Y=0 and centred on Z=0, the whole row re-centred on X=0 — see
 * the file header's "Layout" section. Returns building -> [dx,dy,dz]. */
function layoutGroup(group) {
  let cursor = 0;
  const placed = group.map((b) => {
    const width = b.max[0] - b.min[0];
    const centerX = (b.min[0] + b.max[0]) / 2;
    const centerZ = (b.min[2] + b.max[2]) / 2;
    const baseY = b.min[1];
    const slotCenterX = cursor + width / 2;
    cursor += width + GAP_M;
    return { b, offset: [slotCenterX - centerX, -baseY, -centerZ] };
  });
  const rowWidth = cursor - GAP_M;
  const rowCenterX = rowWidth / 2;
  for (const p of placed) p.offset[0] -= rowCenterX;
  return placed;
}

// ---------------------------------------------------------------------------
// 4. Per group: prune materials/textures/images from the packed source,
//    build fresh accessors/bufferViews for the offset baked geometry.
// ---------------------------------------------------------------------------

function textureRefSlots(material) {
  const slots = [];
  const pbr = material.pbrMetallicRoughness;
  if (pbr?.baseColorTexture) slots.push(pbr.baseColorTexture);
  if (pbr?.metallicRoughnessTexture) slots.push(pbr.metallicRoughnessTexture);
  if (material.emissiveTexture) slots.push(material.emissiveTexture);
  const clearcoat = material.extensions?.KHR_materials_clearcoat;
  if (clearcoat?.clearcoatTexture) slots.push(clearcoat.clearcoatTexture);
  return slots;
}

/** One bufferView per accessor, 4-byte aligned — same shape
 * tools/obj-to-glb.mjs uses, minus quantization (plain float32/uint32 here;
 * these files are already reasonably sized post-downscale and precision
 * loss is not worth the added complexity for a one-off geometry rebuild). */
function buildBinary(accessorSpecs) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = accessorSpecs.map((spec) => {
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    const bufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: spec.bytes.length,
      target: spec.isIndex ? 34963 : 34962,
    });
    chunks.push(spec.bytes);
    offset += spec.bytes.length;
    return {
      bufferView: bufferViewIndex,
      componentType: spec.componentType,
      count: spec.count,
      type: spec.type,
      ...(spec.min ? { min: spec.min } : {}),
      ...(spec.max ? { max: spec.max } : {}),
    };
  });
  return { bin: Buffer.concat(chunks, offset), bufferViews, accessors };
}

function vec3MinMax(floatArray) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < floatArray.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = floatArray[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

function buildSplit(group, letter) {
  const placed = layoutGroup(group);

  // ---- Fresh geometry: one mesh + node per building, offset baked positions.
  const accessorSpecs = [];
  const meshes = [];
  const nodes = [{ name: `tokyo-zakkyo-${letter}`, children: [] }];
  const usedMaterialNames = [];
  for (const { b, offset } of placed) {
    const offsetPositions = new Float32Array(b.positions.length);
    for (let i = 0; i < b.positions.length; i += 3) {
      offsetPositions[i] = b.positions[i] + offset[0];
      offsetPositions[i + 1] = b.positions[i + 1] + offset[1];
      offsetPositions[i + 2] = b.positions[i + 2] + offset[2];
    }
    const { min, max } = vec3MinMax(offsetPositions);
    const posAccIdx = accessorSpecs.length;
    accessorSpecs.push({
      bytes: Buffer.from(offsetPositions.buffer, offsetPositions.byteOffset, offsetPositions.byteLength),
      componentType: 5126, count: offsetPositions.length / 3, type: "VEC3", min, max,
    });
    const normAccIdx = accessorSpecs.length;
    accessorSpecs.push({
      bytes: Buffer.from(b.normals.buffer, b.normals.byteOffset, b.normals.byteLength),
      componentType: 5126, count: b.normals.length / 3, type: "VEC3",
    });
    const uvAccIdx = accessorSpecs.length;
    accessorSpecs.push({
      bytes: Buffer.from(b.uvs.buffer, b.uvs.byteOffset, b.uvs.byteLength),
      componentType: 5126, count: b.uvs.length / 2, type: "VEC2",
    });
    const idxAccIdx = accessorSpecs.length;
    accessorSpecs.push({
      bytes: Buffer.from(b.indices.buffer, b.indices.byteOffset, b.indices.byteLength),
      componentType: 5125, count: b.indices.length, type: "SCALAR", isIndex: true,
    });

    if (!usedMaterialNames.includes(b.material)) usedMaterialNames.push(b.material);
    const meshIdx = meshes.length;
    meshes.push({
      name: `${b.name}_mesh`,
      primitives: [
        {
          attributes: { POSITION: posAccIdx, NORMAL: normAccIdx, TEXCOORD_0: uvAccIdx },
          indices: idxAccIdx,
          material: usedMaterialNames.indexOf(b.material),
        },
      ],
    });
    const nodeIdx = nodes.length;
    nodes.push({ name: b.name, mesh: meshIdx });
    nodes[0].children.push(nodeIdx);
  }

  // ---- Materials/textures/images: pruned from the PACKED source (which
  // already has every image embedded as a bufferView, per packGltf).
  const sourceMaterials = usedMaterialNames.map((name) =>
    packedJson.materials.find((m) => m.name === name),
  );
  const usedTextureIdx = [];
  for (const material of sourceMaterials) {
    for (const slot of textureRefSlots(material)) {
      if (!usedTextureIdx.includes(slot.index)) usedTextureIdx.push(slot.index);
    }
  }
  const textureRemap = new Map(usedTextureIdx.map((old, i) => [old, i]));
  const newTextures = usedTextureIdx.map((old) => structuredClone(packedJson.textures[old]));
  const usedImageIdx = [];
  for (const old of usedTextureIdx) {
    const source = packedJson.textures[old].source;
    if (!usedImageIdx.includes(source)) usedImageIdx.push(source);
  }
  const imageRemap = new Map(usedImageIdx.map((old, i) => [old, i]));
  const newImages = usedImageIdx.map((old) => structuredClone(packedJson.images[old]));
  const newMaterials = sourceMaterials.map((material) => {
    const copy = structuredClone(material);
    for (const slot of textureRefSlots(copy)) slot.index = textureRemap.get(slot.index);
    return copy;
  });
  for (const texture of newTextures) texture.source = imageRemap.get(texture.source);

  const usedExtensions = new Set();
  for (const material of newMaterials) {
    for (const name of Object.keys(material.extensions ?? {})) usedExtensions.add(name);
  }

  // ---- Assemble geometry binary, then splice the (already-embedded, from
  // the packed source) image bytes on afterward at their own bufferViews.
  const { bin: geomBin, bufferViews: geomViews, accessors } = buildBinary(accessorSpecs);
  const imageBytesFor = (imgIdx) => {
    const view = packedJson.bufferViews[packedJson.images[imgIdx].bufferView];
    return packedBin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  };
  const chunks = [geomBin];
  let offset = geomBin.length;
  const bufferViews = [...geomViews];
  for (const [i, image] of newImages.entries()) {
    const bytes = imageBytesFor(usedImageIdx[i]);
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    image.bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    delete image.uri;
  }
  const bin = Buffer.concat(chunks, offset);

  const json = {
    asset: { version: "2.0", generator: "curbside-rush/split-asian-city-pack" },
    extensionsUsed: [...usedExtensions],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: newMaterials,
    textures: newTextures,
    images: newImages,
    samplers: packedJson.samplers ? structuredClone(packedJson.samplers) : undefined,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  if (!json.samplers) delete json.samplers;

  const glb = serializeGlb(json, bin);

  // Round-trip sanity check: every buffer/image must be self-contained.
  const reparsed = parseGlb(glb);
  for (const buffer of reparsed.json.buffers ?? []) {
    if (buffer.uri) throw new Error(`tokyo-zakkyo-${letter}: buffer still has a uri`);
  }
  for (const image of reparsed.json.images ?? []) {
    if (image.uri || typeof image.bufferView !== "number") {
      throw new Error(`tokyo-zakkyo-${letter}: image not embedded`);
    }
  }

  const file = path.join(PROPS, `tokyo-zakkyo-${letter}.glb`);
  if (!dry) fs.writeFileSync(file, glb);
  console.log(
    `${file}: ${group.length} buildings [${group.map((b) => b.name).join(", ")}], ` +
      `materials [${usedMaterialNames.join(", ")}], ${glb.length} bytes` +
      (dry ? " (dry run, not written)" : ""),
  );
  return { letter, buildings: group, materials: usedMaterialNames };
}

const report = groups.map((group, i) => buildSplit(group, GROUP_LETTERS[i]));

console.log();
console.log(
  `Split ${building.length} buildings into ${groups.length} files (stripped ${EXPECTED_FLARE_COUNT} flare/glow cards).`,
);
console.log("Per-file material composition:", report.map((r) => `${r.letter}:[${r.materials.join(",")}]`).join(" "));
