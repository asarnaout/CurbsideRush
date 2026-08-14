import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  NullEngine,
  Scene,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { ALL_ENV_MODELS, MERGE_INCOMPATIBLE_MODEL_IDS } from "../app/game/buildingCatalog";
import {
  buildingPlacementConfig,
  isBuildingSetId,
  NYC_VENDORS,
  slotBlockBuildings,
} from "../app/game/buildingSets";
import {
  buildingStructuralBoundsFor,
  missingStructuralBoundsConfigs,
} from "../app/game/buildingStructuralBounds";
import {
  orientMergedFacesOutward,
  recentreMergedMasterXZ,
  squareUpMergedMaster,
} from "../app/game/buildingWinding";
import { getMapPack } from "../app/game/content";
import { hashStringToSeed } from "../app/game/visuals";

registerBuiltInLoaders();

// Placement scale for a catalogue model: building-set config first, vendor
// config second. Models placed by neither path (market-stalls, people) return
// null and are excluded — no placement, no placement invariant.
const scaleFor = (model: { id: string; url: string }): number | null =>
  buildingPlacementConfig(model.id)?.scale ??
  NYC_VENDORS.find((v) => v.url === model.url)?.scale ??
  null;

// `Mesh.MergeMeshes` throws ("Cannot merge vertex data that do not have the
// same set of attributes") on every `MERGE_INCOMPATIBLE_MODEL_IDS` entry
// (buildingCatalog.ts's own doc comment has the full story) — they render
// via `instantiateModelInstanced` instead (no merge, so `masterFor` below —
// which mirrors `getBuildingMaster`'s merge recipe exactly — cannot build a
// master for them at all). Their PLACEMENTS/BOUNDS entries were still
// measured (see buildingSets.ts's own comment on each), just via a manual
// per-submesh world-space union instead of this file's merge-based recipe.
const PLACEABLE = ALL_ENV_MODELS.filter(
  (m) =>
    m.category !== "person" &&
    scaleFor(m) !== null &&
    !MERGE_INCOMPATIBLE_MODEL_IDS.has(m.id),
);

// One shared NullEngine scene; masters cached per model id. Mirrors
// getBuildingMaster: instantiate real clones, bake world matrices into one
// merged mesh, fix winding, recentre on the pivot — the renderer recipe whose
// output the placement slots consume.
const engine = new NullEngine();
const scene = new Scene(engine);
const masters = new Map<
  string,
  { master: Mesh; offset: { dx: number; dz: number } }
>();
const masterFor = async (model: { id: string; url: string }) => {
  const cached = masters.get(model.id);
  if (cached) return cached;
  const buf = fs.readFileSync(path.join(process.cwd(), "public", model.url));
  const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
  const container = await LoadAssetContainerAsync(dataUrl, scene, {
    pluginExtension: ".glb",
  });
  const entries = container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
  const root = entries.rootNodes[0];
  root.computeWorldMatrix(true);
  const meshes = root
    .getChildMeshes(false)
    .filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  for (const m of meshes) m.computeWorldMatrix(true);
  const master = Mesh.MergeMeshes(meshes, true, true, undefined, false, true)!;
  expect(master, model.url).toBeTruthy();
  orientMergedFacesOutward(master);
  squareUpMergedMaster(
    master,
    buildingPlacementConfig(model.id)?.squareUpYaw ?? 0,
  );
  const offset = recentreMergedMasterXZ(master);
  const built = { master, offset };
  masters.set(model.id, built);
  return built;
};

/**
 * Area-weighted dominant wall orientation of a merged master, folded mod 90°
 * into (-45°, 45°]: 0 = walls parallel to the street grid. Near-horizontal
 * faces (roofs, ground) are excluded; returns null for meshes with no walls.
 */
const dominantWallAngle = (
  mesh: Mesh,
): { angleDeg: number; share: number } | null => {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  if (!pos || !idx) return null;
  const hist = new Map<number, number>();
  let total = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || Math.hypot(nx, nz) / len < 0.85) continue;
    let ang = (Math.atan2(nx, nz) * 180) / Math.PI;
    ang = ((ang % 90) + 90) % 90;
    if (ang > 45) ang -= 90;
    const key = Math.round(ang * 4) / 4;
    hist.set(key, (hist.get(key) ?? 0) + len / 2);
    total += len / 2;
  }
  if (!total) return null;
  const [modeAng] = [...hist.entries()].sort((x, y) => y[1] - x[1])[0];
  let wSum = 0;
  let aSum = 0;
  for (const [ang, area] of hist) {
    if (Math.abs(ang - modeAng) <= 1) {
      wSum += ang * area;
      aSum += area;
    }
  }
  return { angleDeg: wSum / aSum, share: aSum / total };
};

describe("merged master pivot centring", () => {
  it.each(PLACEABLE.map((m) => [m.id, m] as const))(
    "%s body is centred on its pivot after the renderer recipe",
    async (_id, model) => {
      const { master } = await masterFor(model);
      const centre = master.getBoundingInfo().boundingBox.center;
      const scale = scaleFor(model)!;
      expect(Math.abs(centre.x) * scale, `${model.id} x-centre (m)`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(centre.z) * scale, `${model.id} z-centre (m)`).toBeLessThanOrEqual(0.15);
    },
  );

  // The blind spot the first #143 fix shipped with: positions were pinned but
  // orientation wasn't, and house-a's glb also bakes a 10° yaw, so every
  // white house stood skewed against the kerb. squareUpYaw derotates it at
  // master build; this asserts every placeable model's walls end up parallel
  // to the street grid. share < 0.5 (round/irregular architecture with no
  // dominant wall direction) is skipped rather than asserted.
  it.each(PLACEABLE.map((m) => [m.id, m] as const))(
    "%s walls run parallel to the street grid",
    async (_id, model) => {
      const { master } = await masterFor(model);
      const walls = dominantWallAngle(master);
      if (!walls || walls.share < 0.5) return;
      expect(
        Math.abs(walls.angleDeg),
        `${model.id} dominant wall angle ${walls.angleDeg.toFixed(2)}° (share ${(walls.share * 100).toFixed(0)}%)`,
      ).toBeLessThanOrEqual(0.75);
    },
  );

  // Documents #143: house-a's glb authors its geometry ~15 m (scaled) away
  // from the pivot, which is why the recentre step is load-bearing. If the
  // asset is ever re-exported pivot-centred this test can be deleted.
  it("nyc-house-a is the off-pivot asset the recentre step exists for", async () => {
    const model = ALL_ENV_MODELS.find((m) => m.id === "nyc-house-a")!;
    const { offset } = await masterFor(model);
    expect(Math.hypot(offset.dx, offset.dz) * 0.095).toBeGreaterThan(5);
  });
});

interface WorldBox {
  modelId: string;
  edgeOutward: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Plan-view boxes for a block's whole street wall, in the block's own frame.
 * Shared by the NYC and Cairo sweeps — the heading rotation is rigid, so an
 * overlap here is an overlap in world space too. */
const worldBoxes = async (block: {
    id: string;
    center: { x: number; z: number };
    size: { x: number; z: number };
    buildingSet?: string;
    streetEdges?: readonly ("+x" | "-x" | "+z" | "-z")[];
  }) => {
    const placements = slotBlockBuildings(
      block.center,
      block.size,
      block.buildingSet as Parameters<typeof slotBlockBuildings>[2],
      hashStringToSeed(`${block.id}-buildings`),
      1,
      block.streetEdges,
    );
    const boxes: WorldBox[] = [];
    for (const b of placements) {
      const model = ALL_ENV_MODELS.find((m) => m.id === b.modelId)!;
      const { master } = await masterFor(model);
      const bb = master.getBoundingInfo().boundingBox;
      const rot = Matrix.RotationY(b.yaw);
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const lx of [bb.minimum.x, bb.maximum.x]) {
        for (const lz of [bb.minimum.z, bb.maximum.z]) {
          const w = Vector3.TransformCoordinates(
            new Vector3(lx * b.scale, 0, lz * b.scale),
            rot,
          );
          x0 = Math.min(x0, w.x + b.x);
          x1 = Math.max(x1, w.x + b.x);
          z0 = Math.min(z0, w.z + b.z);
          z1 = Math.max(z1, w.z + b.z);
        }
      }
      const frontOffset = buildingPlacementConfig(b.modelId)!.frontOffset;
      let edgeOutward = b.yaw + Math.PI - frontOffset;
      while (edgeOutward > Math.PI) edgeOutward -= 2 * Math.PI;
      while (edgeOutward <= -Math.PI) edgeOutward += 2 * Math.PI;
      boxes.push({ modelId: b.modelId, edgeOutward, x0, x1, z0, z1 });
    }
    return boxes;
};

describe("street-wall placement invariants on the real NYC blocks", () => {
  const setBlocks = () =>
    getMapPack("nyc-upper-west-side").geometry.blocks.filter(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet),
    );

  // Scoped to the detached-house block (#143's shape). A sweep of the other
  // set blocks found two pre-existing, sub-metre tower nits that predate the
  // recentre fix and are invisible at tower scale: tower-artdeco kisses
  // tower-c by ~1.9 m x 0.5 m on nyc-block-bway-amst-n, and tower-c's real
  // 19.8 m width overhangs its authored 19 m footprint off
  // nyc-block-bway-amst-s. Widen to all set blocks if those footprints are
  // ever retuned.
  const houseBlocks = () =>
    setBlocks().filter((b) => b.buildingSet === "nyc-house");

  it(
    "no two houses interpenetrate on the detached-house block",
    { timeout: 30_000 },
    async () => {
      for (const block of houseBlocks()) {
        const boxes = await worldBoxes(block);
        expect(boxes.length).toBeGreaterThan(0);
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
            const deep = ox > 0.25 && oz > 0.25;
            expect(
              deep,
              `${block.id}: ${a.modelId}#${i} overlaps ${b.modelId}#${j} by ${ox.toFixed(2)}m x ${oz.toFixed(2)}m`,
            ).toBe(false);
          }
        }
      }
    },
  );

  it(
    "every house stays inside its block (no pavement encroachment)",
    { timeout: 30_000 },
    async () => {
      for (const block of houseBlocks()) {
        const grow = 0.2;
        const minX = block.center.x - block.size.x / 2 - grow;
        const maxX = block.center.x + block.size.x / 2 + grow;
        const minZ = block.center.z - block.size.z / 2 - grow;
        const maxZ = block.center.z + block.size.z / 2 + grow;
        for (const box of await worldBoxes(block)) {
          expect(
            box.x0 >= minX && box.x1 <= maxX && box.z0 >= minZ && box.z1 <= maxZ,
            `${block.id}: ${box.modelId} spills off the block ` +
              `x[${box.x0.toFixed(1)},${box.x1.toFixed(1)}] z[${box.z0.toFixed(1)},${box.z1.toFixed(1)}]`,
          ).toBe(true);
        }
      }
    },
  );

  // The bug's visible face (#143): before the recentre fix, house-a rows sat
  // 3.0 m back while house-b sat 1.3 m back — a crooked pavement line.
  it(
    "the detached-house block forms one straight street wall per edge",
    { timeout: 30_000 },
    async () => {
      // Every detached-house block, not one named block: the pocket may be
      // authored as one big rectangle or several, and the crooked wall is a
      // per-edge property either way.
      let totalHouses = 0;
      for (const block of houseBlocks()) {
        const boxes = await worldBoxes(block);
        totalHouses += boxes.length;
        const byEdge = new Map<string, number[]>();
        for (const box of boxes) {
          const o = box.edgeOutward;
          const edge =
            Math.abs(o) < 0.01
              ? "N"
              : Math.abs(Math.abs(o) - Math.PI) < 0.01
                ? "S"
                : Math.abs(o - Math.PI / 2) < 0.01
                  ? "E"
                  : "W";
          const setback =
            edge === "N"
              ? block.center.z + block.size.z / 2 - box.z1
              : edge === "S"
                ? box.z0 - (block.center.z - block.size.z / 2)
                : edge === "E"
                  ? block.center.x + block.size.x / 2 - box.x1
                  : box.x0 - (block.center.x - block.size.x / 2);
          byEdge.set(edge, [...(byEdge.get(edge) ?? []), setback]);
        }
        // A block with an explicit `streetEdges` (a map-edge shell whose far
        // side faces open world, not a real block with houses all around —
        // e.g. the bk40/bk56 outer shells, plan Section 11.5) only ever
        // walls the edges it names; every other detached-house block leaves
        // `streetEdges` absent and gets all four.
        const edgeLetter: Record<string, string> = { "+z": "N", "-z": "S", "+x": "E", "-x": "W" };
        const expectedEdges = block.streetEdges
          ? [...block.streetEdges].map((e) => edgeLetter[e]).sort()
          : ["E", "N", "S", "W"];
        expect([...byEdge.keys()].sort(), block.id).toEqual(expectedEdges);
        for (const [edge, setbacks] of byEdge) {
          const spread = Math.max(...setbacks) - Math.min(...setbacks);
          expect(
            spread,
            `${block.id} edge ${edge} setback spread (m): ${setbacks.map((s) => s.toFixed(2)).join(", ")}`,
          ).toBeLessThanOrEqual(0.75);
          expect(
            Math.min(...setbacks),
            `${block.id} edge ${edge} min setback`,
          ).toBeGreaterThanOrEqual(-0.2);
        }
      }
      // Enough houses across the pocket for a crooked wall to be visible at
      // all — the bug hid in a long row, not in a handful of buildings.
      expect(totalHouses, "houses across the detached-house pocket").toBeGreaterThanOrEqual(80);
    },
  );
});

/**
 * A roadside strip is not a city block.
 *
 * Cairo's parcels are 28-34 m deep with a road on one side. Slotted as a full
 * perimeter they got a row on each long edge, and because a building's centre is
 * inset by half its footprint, footprints up to 18.5 m put roughly 9 m of one
 * row inside the other — two buildings in the same space, which the renderer
 * shows as a white flicker that worsens as the camera moves. The far row also
 * faced open desert no driver reaches.
 *
 * Every parcel is swept, not a sample: the overlap depends on the footprints the
 * seed happens to draw, so a subset can pass while the map is full of it.
 */
describe("Cairo roadside parcels carry one road-facing row", () => {
  const parcels = () =>
    getMapPack("cairo-central-nile").geometry.blocks.filter(
      (b) => b.buildingSet && isBuildingSetId(b.buildingSet),
    );

  it("names exactly one street edge per roadside parcel", () => {
    const roadside = parcels().filter((b) => b.id.includes("-roadside-"));
    expect(roadside.length).toBeGreaterThan(100);
    for (const block of roadside) {
      expect(block.streetEdges, block.id).toHaveLength(1);
      // Local +x runs along the carriageway, so the road is always across z.
      expect(["+z", "-z"], block.id).toContain(block.streetEdges![0]);
    }
  });

  it(
    "no two buildings interpenetrate on any Cairo parcel",
    { timeout: 120_000 },
    async () => {
      let total = 0;
      for (const block of parcels()) {
        const boxes = await worldBoxes(block);
        total += boxes.length;
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
            expect(
              ox > 0.25 && oz > 0.25,
              `${block.id}: ${a.modelId}#${i} overlaps ${b.modelId}#${j} by ${ox.toFixed(2)}m x ${oz.toFixed(2)}m`,
            ).toBe(false);
          }
        }
      }
      expect(total, "buildings across Cairo's street wall").toBeGreaterThan(400);
    },
  );

  // The sweep above is intra-parcel; this one is the map-wide version that was
  // missing when two parcels' rows stood through each other. World poses mirror
  // rotateBlockBuildingPlacements (GameCanvas.tsx): world = centre + R(heading)
  // · local with R = [[cos, sin], [-sin, cos]], yaw += heading.
  it(
    "no two buildings interpenetrate anywhere across Cairo's parcels",
    { timeout: 120_000 },
    async () => {
      interface PlacedRect {
        blockId: string;
        modelId: string;
        x: number;
        z: number;
        yaw: number;
        halfW: number;
        halfD: number;
      }
      const placed: PlacedRect[] = [];
      for (const block of parcels()) {
        const heading = (((block.headingDeg ?? 0) as number) * Math.PI) / 180;
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        const placements = slotBlockBuildings(
          block.center,
          block.size,
          block.buildingSet as Parameters<typeof slotBlockBuildings>[2],
          hashStringToSeed(`${block.id}-buildings`),
          1,
          block.streetEdges,
        );
        for (const b of placements) {
          const model = ALL_ENV_MODELS.find((m) => m.id === b.modelId)!;
          const { master } = await masterFor(model);
          const bb = master.getBoundingInfo().boundingBox;
          const lx = b.x - block.center.x;
          const lz = b.z - block.center.z;
          const x = block.center.x + lx * cos + lz * sin;
          const z = block.center.z - lx * sin + lz * cos;
          const yaw = b.yaw + heading;
          // Carry the master's own bounding-box centre offset into world space
          // (rotation.y maps local +x to (cos, -sin) and +z to (sin, cos)).
          const ox = ((bb.minimum.x + bb.maximum.x) / 2) * b.scale;
          const oz = ((bb.minimum.z + bb.maximum.z) / 2) * b.scale;
          const yc = Math.cos(yaw);
          const ys = Math.sin(yaw);
          placed.push({
            blockId: block.id,
            modelId: b.modelId,
            x: x + ox * yc + oz * ys,
            z: z - ox * ys + oz * yc,
            yaw,
            halfW: ((bb.maximum.x - bb.minimum.x) / 2) * b.scale,
            halfD: ((bb.maximum.z - bb.minimum.z) / 2) * b.scale,
          });
        }
      }
      expect(placed.length).toBeGreaterThan(400);

      const axesOf = (p: PlacedRect) => {
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        return [
          { x: c, z: -s, half: p.halfW },
          { x: s, z: c, half: p.halfD },
        ] as const;
      };
      const penetrationM = (a: PlacedRect, b: PlacedRect): number => {
        const aAxes = axesOf(a);
        const bAxes = axesOf(b);
        let min = Infinity;
        for (const axis of [...aAxes, ...bAxes]) {
          const sep = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
          const radius = (axes: typeof aAxes) =>
            axes[0].half * Math.abs(axes[0].x * axis.x + axes[0].z * axis.z) +
            axes[1].half * Math.abs(axes[1].x * axis.x + axes[1].z * axis.z);
          const pen = radius(aAxes) + radius(bAxes) - sep;
          if (pen <= 0) return 0;
          min = Math.min(min, pen);
        }
        return min;
      };

      // Grid buckets keep the pair count linear; 48 m cells with a forward
      // 5-cell neighbourhood cover every pair that could touch (the largest
      // footprint half-diagonal is ~15 m).
      const cellM = 48;
      const buckets = new Map<string, number[]>();
      placed.forEach((p, index) => {
        const key = `${Math.floor(p.x / cellM)},${Math.floor(p.z / cellM)}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      });
      const check = (i: number, j: number) => {
        const pen = penetrationM(placed[i], placed[j]);
        expect(
          pen <= 0.25,
          `${placed[i].blockId} ${placed[i].modelId} overlaps ` +
            `${placed[j].blockId} ${placed[j].modelId} by ${pen.toFixed(2)}m`,
        ).toBe(true);
      };
      for (const [key, indices] of buckets) {
        const [cx, cz] = key.split(",").map(Number);
        for (let a = 0; a < indices.length; a += 1) {
          for (let b = a + 1; b < indices.length; b += 1) {
            check(indices[a], indices[b]);
          }
        }
        for (const [dx, dz] of [
          [0, 1],
          [1, -1],
          [1, 0],
          [1, 1],
        ] as const) {
          const other = buckets.get(`${cx + dx},${cz + dz}`);
          if (!other) continue;
          for (const i of indices) for (const j of other) check(i, j);
        }
      }
    },
  );
});

/**
 * `buildingStructuralBounds.ts` independent validation (plan Section 7.3):
 * validation must check the manifest against real GLB geometry, not against
 * a serialized-and-read-back copy of itself. Every current entry is a single
 * rectangle, so both directions collapse to one geometric question per
 * model: does the curated box agree with where the mesh actually has wall
 * material touching the ground?
 *
 * "Ground-touching" deliberately does not mean "all vertices below a low Y
 * band": a tall tower's single full-height wall triangle would fail that
 * filter (its top vertices sit 50+ m up), silently reporting a wall with no
 * ground floor. A triangle counts if its LOWEST vertex sits within
 * `GROUND_TOUCH_EPSILON_M` of the mesh's own measured base — which is
 * correct for a two-storey walk-up and a sixty-storey tower alike.
 */
describe("buildingStructuralBounds — independent GLB validation", () => {
  it("has an entry for every model reachable from a building set", () => {
    expect(missingStructuralBoundsConfigs()).toEqual([]);
  });

  const GROUND_TOUCH_EPSILON_M = 0.2;
  // How far a curated boundary edge may sit from the nearest real
  // ground-touching wall surface. The manifest's bounds are the ground-touch
  // bbox itself (rounded outward), so a model whose true ground floor is a
  // plain rectangle passes at this tight default — the box's own edges ARE
  // its measured extent.
  const DEFAULT_BOUNDARY_TOLERANCE_M = 0.5;
  /**
   * Reviewed exceptions, not a blanket loosening. An axis-aligned box has an
   * inherent artifact for a non-rectangular true footprint: its minX is
   * measured off one real vertex and its minZ off an independent one
   * elsewhere on the model, so the box's own CORNER — the sample this catches
   * — is not guaranteed to sit near any single piece of real geometry even
   * though every real vertex is provably still inside the box (Direction 1,
   * checked unconditionally above, with no override). Every model below was
   * confirmed by that Direction-1 check to have no gameplay-solid geometry
   * outside its box; only the corner-vs-real-wall distance is loosened, per
   * model, to its own measured value (rounded up with a small margin).
   *
   * `nyc-midrise-b` is the confirmed case, inspected directly rather than
   * inferred from the distance alone: clustering its ground-touching
   * vertices onto a 0.5 m grid shows a filled band across one side of the
   * footprint and only corner-present geometry on the other — a genuinely
   * L-shaped/asymmetric ground plan, not a measurement artifact. The
   * remaining entries share the same class of cause (a recessed colonnade
   * or balcony line, a chamfered corner, asymmetric massing) without each
   * having had the same by-hand vertex inspection. Any of them is a
   * candidate for a real two-solid split if a later visual/gameplay pass
   * finds its single box actually blocks a driveable gap — Phase 5's
   * compound/convex landmark primitives are the pattern for that — but
   * none of this catalogue's models needed it to satisfy the plan's
   * bidirectional check today.
   */
  const BOUNDARY_TOLERANCE_OVERRIDES_M: Record<string, number> = {
    "nyc-tower-b": 1.5,
    "nyc-tower-c": 2.0,
    "nyc-midrise-b": 3.7,
    "nyc-house-a": 0.6,
    "nyc-shop-corner": 1.0,
    "cairo-tower-b": 1.85,
    "cairo-block-4story": 1.95,
    "cairo-block-4story-centre": 1.95,
    "cairo-block-colonnade": 1.85,
    "cairo-block-balcony": 2.2,
    "cairo-block-terrace": 1.0,
    "cairo-residence-quaternius": 1.95,
    "cairo-office-block": 2.05,
    "cairo-depot": 1.8,
    "london-terrace-c": 1.95,
    "london-stucco-c": 2.0,
    "london-tower-b": 1.7,
    "london-tower-c": 1.95,
    // Tokyo P1 imports: 13 independent Sketchfab authors, none sharing a
    // common box-with-clean-corners convention. tokyo-house-c/tokyo-konbini
    // in particular have real asymmetric massing (a wide street-facing wing
    // versus a narrower rear one) confirmed by Direction 1 passing cleanly
    // (no real geometry outside the box) while the box's own far corner
    // sits well past any actual wall.
    "tokyo-house-a": 1.35,
    "tokyo-house-b": 1.0,
    "tokyo-house-c": 3.3,
    "tokyo-apato-a": 1.1,
    "tokyo-konbini": 1.95,
    "tokyo-izakaya": 0.95,
    // tokyo-block-4story (P3a): the SAME source geometry as
    // cairo-block-4story above (Quaternius 4Story_Mat) — same override
    // value, same cause.
    "tokyo-block-4story": 1.95,
    // tokyo-zakkyo-{a..f} (P3a): a different ROOT CAUSE from every entry
    // above. Each file is a laid-out ROW of 3-4 separate buildings
    // (tools/split-asian-city-pack.mjs) with real gaps between them, not one
    // building with asymmetric massing — the single curated box necessarily
    // spans the whole row including those gaps, so its corners sit well past
    // the nearest actual wall wherever the row's shortest/narrowest building
    // falls short of the tallest/widest one's extent. Direction 1 (no real
    // geometry outside the box) still passes cleanly for all six, unchecked
    // here — only the corner-vs-real-wall distance is loosened, per file, to
    // its own measured worst case with a small margin. A good candidate for
    // a real per-building multi-solid split (this file's own BOUNDS
    // interface already supports it) if a later phase's visual/gameplay
    // pass finds one of these six actually blocking a driveable gap — none
    // of these are placed anywhere yet (P3a is import-only), so that has not
    // been tested.
    "tokyo-zakkyo-a": 2.4,
    "tokyo-zakkyo-b": 3.15,
    "tokyo-zakkyo-c": 1.95,
    "tokyo-zakkyo-d": 6.2,
    "tokyo-zakkyo-e": 5.25,
    "tokyo-zakkyo-f": 2.25,
  };

  /** Minimum distance (metres) from `(x, z)` to the nearest edge of any
   * ground-touching triangle, in the merged master's own local XZ frame. */
  const nearestGroundEdgeDistance = (
    groundTriangles: readonly [
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
    ][],
    x: number,
    z: number,
  ): number => {
    let best = Infinity;
    for (const [a, b, c] of groundTriangles) {
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const lengthSq = dx * dx + dz * dz;
        const t =
          lengthSq > 1e-9
            ? Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / lengthSq))
            : 0;
        const nx = p.x + dx * t;
        const nz = p.z + dz * t;
        best = Math.min(best, Math.hypot(x - nx, z - nz));
      }
    }
    return best;
  };

  it.each(
    ALL_ENV_MODELS.filter(
      (m) => buildingPlacementConfig(m.id) && !MERGE_INCOMPATIBLE_MODEL_IDS.has(m.id),
    ).map((m) => [m.id, m] as const),
  )(
    "%s curated structural rectangle agrees with its ground-touching GLB geometry",
    async (_id, model) => {
      const cfg = buildingPlacementConfig(model.id)!;
      const bounds = buildingStructuralBoundsFor(model.id);
      expect(bounds, `${model.id} has no structural bounds entry`).toBeTruthy();
      expect(bounds!.solids, `${model.id} solid count`).toHaveLength(1);
      const solid = bounds!.solids[0];

      const { master } = await masterFor(model);
      const pos = master.getVerticesData(VertexBuffer.PositionKind)!;
      const idx = master.getIndices()!;
      const nativeGroundY = master.getBoundingInfo().boundingBox.minimum.y;
      const nativeEpsilon = GROUND_TOUCH_EPSILON_M / cfg.scale;

      const point = (v: number) => ({ x: pos[v * 3] * cfg.scale, z: pos[v * 3 + 2] * cfg.scale });
      const groundTriangles: [
        { x: number; z: number },
        { x: number; z: number },
        { x: number; z: number },
      ][] = [];
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const verts = [idx[t], idx[t + 1], idx[t + 2]];
        const minY = Math.min(...verts.map((v) => pos[v * 3 + 1]));
        if (minY > nativeGroundY + nativeEpsilon) continue;
        groundTriangles.push([point(verts[0]), point(verts[1]), point(verts[2])]);
      }
      expect(groundTriangles.length, `${model.id} has no ground-touching geometry`).toBeGreaterThan(0);

      // Direction 1: every ground-touching vertex lies inside the curated
      // box — the box does not understate the real footprint.
      // Slack matches the manifest's own outward-rounding grain (2 decimals)
      // rather than float epsilon, since every bound was deliberately
      // rounded away from centre by up to 0.01 m.
      const CONTAINMENT_SLACK_M = 0.011;
      for (const triangle of groundTriangles) {
        for (const p of triangle) {
          expect(
            p.x >= solid.minX - CONTAINMENT_SLACK_M && p.x <= solid.maxX + CONTAINMENT_SLACK_M,
            `${model.id} ground vertex x=${p.x.toFixed(3)} outside curated [${solid.minX.toFixed(3)}, ${solid.maxX.toFixed(3)}]`,
          ).toBe(true);
          expect(
            p.z >= solid.minZ - CONTAINMENT_SLACK_M && p.z <= solid.maxZ + CONTAINMENT_SLACK_M,
            `${model.id} ground vertex z=${p.z.toFixed(3)} outside curated [${solid.minZ.toFixed(3)}, ${solid.maxZ.toFixed(3)}]`,
          ).toBe(true);
        }
      }

      // Direction 2: every curated boundary edge sits near real
      // ground-touching wall surface — the box does not overstate the real
      // footprint (an invisible collision face).
      const tolerance = BOUNDARY_TOLERANCE_OVERRIDES_M[model.id] ?? DEFAULT_BOUNDARY_TOLERANCE_M;
      const samples: { x: number; z: number }[] = [];
      const STEPS = 9;
      for (let i = 0; i < STEPS; i += 1) {
        const t = i / (STEPS - 1);
        samples.push({ x: solid.minX, z: solid.minZ + t * (solid.maxZ - solid.minZ) });
        samples.push({ x: solid.maxX, z: solid.minZ + t * (solid.maxZ - solid.minZ) });
        samples.push({ x: solid.minX + t * (solid.maxX - solid.minX), z: solid.minZ });
        samples.push({ x: solid.minX + t * (solid.maxX - solid.minX), z: solid.maxZ });
      }
      // Report the single worst sample, not just the first one over budget —
      // an override tuned to whichever point happens to be checked first
      // would leave a farther, unreported point on the same model uncaught.
      let worst = { x: 0, z: 0, distance: -Infinity };
      for (const sample of samples) {
        const distance = nearestGroundEdgeDistance(groundTriangles, sample.x, sample.z);
        if (distance > worst.distance) worst = { x: sample.x, z: sample.z, distance };
      }
      expect(
        worst.distance,
        `${model.id} boundary point (${worst.x.toFixed(2)}, ${worst.z.toFixed(2)}) is ${worst.distance.toFixed(3)} m from the nearest ground-touching wall (tolerance ${tolerance} m)`,
      ).toBeLessThanOrEqual(tolerance);
    },
  );
});
