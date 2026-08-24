import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoadAssetContainerAsync, Mesh, NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { ALL_ENV_MODELS } from "../app/game/buildingCatalog";
import { buildingPlacementConfig } from "../app/game/buildingSets";
import { buildingStructuralBoundsFor, curatedStructuralBoundsModelIds } from "../app/game/buildingStructuralBounds";
import {
  buildingVisualOcclusionFor,
  measuredHullModelIds,
} from "../app/game/buildingVisualOcclusion";
import { orientMergedFacesOutward, recentreMergedMasterXZ, squareUpMergedMaster } from "../app/game/buildingWinding";
import { ringIsClockwise, shapeArea, type Shape2d } from "../app/game/geometry/visualSceneFootprints";

registerBuiltInLoaders();

/**
 * Every model's visual-occlusion volume must be a real polygon this
 * codebase's kernel can classify, never wider than the model's own
 * structural rectangle (the collision proxy, which is already a safe
 * conservative bound — plan Section 7.2 item 2: "the independent visual
 * manifest is the scoped solution").
 */
describe("buildingVisualOcclusion — structural consistency", () => {
  it("has a visual entry for every curated structural-bounds model", () => {
    for (const modelId of curatedStructuralBoundsModelIds()) {
      expect(buildingVisualOcclusionFor(modelId), modelId).toBeTruthy();
    }
  });

  it("every solid is a clockwise-wound polygon (never wider than its structural rectangle)", () => {
    for (const modelId of curatedStructuralBoundsModelIds()) {
      const bounds = buildingStructuralBoundsFor(modelId)!;
      const visual = buildingVisualOcclusionFor(modelId)!;
      expect(visual.heightM).toBe(bounds.proxyHeightM);
      expect(visual.solids.length).toBe(bounds.solids.length);
      for (const [index, solid] of visual.solids.entries()) {
        expect(solid.points.length, `${modelId}:${solid.localId}`).toBeGreaterThanOrEqual(3);
        expect(ringIsClockwise(solid.points), `${modelId}:${solid.localId} winding`).toBe(true);

        const rect = bounds.solids[index];
        const rectShape: Shape2d = { kind: "aabb", minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
        const visualShape: Shape2d = { kind: "polygon", outer: solid.points };
        const visualArea = shapeArea(visualShape);
        const rectArea = shapeArea(rectShape);
        expect(visualArea, `${modelId}:${solid.localId} area`).toBeLessThanOrEqual(rectArea + 1e-6);

        // Every hull vertex must lie within the structural rectangle, up to
        // the measurement tool's own outward safety padding (2 cm default,
        // up to 4 cm for the one model whose raw hull needed more margin to
        // empirically contain every real ground vertex — see
        // buildingVisualOcclusion.ts's module header). A convex polygon can
        // still have strictly smaller total area than its bounding rectangle
        // while one padded vertex poking a few cm past a single edge — the
        // two checks are independent, both real, and both required.
        const PADDING_TOLERANCE_M = 0.1;
        for (const point of solid.points) {
          expect(point.x).toBeGreaterThanOrEqual(rect.minX - PADDING_TOLERANCE_M);
          expect(point.x).toBeLessThanOrEqual(rect.maxX + PADDING_TOLERANCE_M);
          expect(point.z).toBeGreaterThanOrEqual(rect.minZ - PADDING_TOLERANCE_M);
          expect(point.z).toBeLessThanOrEqual(rect.maxZ + PADDING_TOLERANCE_M);
        }
      }
    }
  });

  it("every measured-hull model is strictly narrower than its rectangle (real tightening, not a no-op copy)", () => {
    for (const modelId of measuredHullModelIds()) {
      const bounds = buildingStructuralBoundsFor(modelId)!;
      const visual = buildingVisualOcclusionFor(modelId)!;
      const rect = bounds.solids[0];
      const rectArea = (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
      const visualArea = shapeArea({ kind: "polygon", outer: visual.solids[0].points });
      expect(visualArea, modelId).toBeLessThan(rectArea);
    }
  });
});

// One shared NullEngine scene; masters cached per model id. Mirrors
// buildingPlacement.test.ts's own harness exactly (the same production
// merge recipe this manifest's own header documents being measured from).
const engine = new NullEngine();
const scene = new Scene(engine);
const masters = new Map<string, Mesh>();
const masterFor = async (model: { id: string; url: string }) => {
  const cached = masters.get(model.id);
  if (cached) return cached;
  const buf = fs.readFileSync(
    path.join(process.cwd(), "public", model.url.split(/[?#]/, 1)[0]),
  );
  const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
  const container = await LoadAssetContainerAsync(dataUrl, scene, { pluginExtension: ".glb" });
  const entries = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
  const root = entries.rootNodes[0];
  root.computeWorldMatrix(true);
  const meshes = root
    .getChildMeshes(false)
    .filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  for (const m of meshes) m.computeWorldMatrix(true);
  const master = Mesh.MergeMeshes(meshes, true, true, undefined, false, true)!;
  orientMergedFacesOutward(master);
  squareUpMergedMaster(master, buildingPlacementConfig(model.id)?.squareUpYaw ?? 0);
  recentreMergedMasterXZ(master);
  masters.set(model.id, master);
  return master;
};

const GROUND_TOUCH_EPSILON_M = 0.2;

describe("buildingVisualOcclusion — measured hulls vs real GLB geometry", () => {
  it.each(measuredHullModelIds())(
    "%s: every real ground-touching vertex lies inside the measured hull",
    async (modelId) => {
      const model = ALL_ENV_MODELS.find((m) => m.id === modelId);
      expect(model, modelId).toBeTruthy();
      const cfg = buildingPlacementConfig(model!.id)!;
      const master = await masterFor(model!);
      const pos = master.getVerticesData(VertexBuffer.PositionKind)!;
      const idx = master.getIndices()!;
      const nativeGroundY = master.getBoundingInfo().boundingBox.minimum.y;
      const nativeEpsilon = GROUND_TOUCH_EPSILON_M / cfg.scale;
      const point = (v: number) => ({ x: pos[v * 3] * cfg.scale, z: pos[v * 3 + 2] * cfg.scale });

      const visual = buildingVisualOcclusionFor(modelId)!;
      const hullShape: Shape2d = { kind: "polygon", outer: visual.solids[0].points };
      const { pointInShape } = await import("../app/game/geometry/visualSceneFootprints");

      let checked = 0;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const verts = [idx[t], idx[t + 1], idx[t + 2]];
        const minY = Math.min(...verts.map((v) => pos[v * 3 + 1]));
        if (minY > nativeGroundY + nativeEpsilon) continue;
        for (const v of verts) {
          const p = point(v);
          expect(
            pointInShape(hullShape, p.x, p.z),
            `${modelId} ground vertex (${p.x.toFixed(3)}, ${p.z.toFixed(3)}) outside its measured hull`,
          ).toBe(true);
          checked += 1;
        }
      }
      expect(checked, `${modelId} had no ground-touching geometry to check`).toBeGreaterThan(0);
    },
  );
});
