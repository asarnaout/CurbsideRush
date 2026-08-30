import {
  Color3,
  InstancedMesh,
  NullEngine,
  Scene,
  StandardMaterial,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import {
  buildCairoLandmark,
  type CairoLandmarkCtx,
} from "../app/game/render/cairoLandmarks";
import { resolveMapVisualPalette } from "../app/game/visuals";

describe("Qasr El-Nil lions", () => {
  it("places one detailed, outward-facing pair at both bridge approaches", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const frozen: CairoLandmarkCtx["staticSceneryFreeze"] extends readonly (
      infer Entry
    )[]
      ? Entry[]
      : never = [];
    const ctx: CairoLandmarkCtx = {
      scene,
      visualPalette: resolveMapVisualPalette(CAIRO_MAP_PACK.id),
      staticSceneryFreeze: frozen,
      buildFlatPolygonMesh: () => undefined,
      buildParkLawnPolygon: () => undefined,
    };
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-qasr-el-nil-bridge",
    );
    expect(landmark).toBeDefined();
    if (!landmark) return;

    const fallback = new StandardMaterial("qasr-bridge-fallback", scene);
    fallback.diffuseColor = new Color3(0.4, 0.3, 0.2);
    expect(buildCairoLandmark(ctx, landmark, fallback, CAIRO_MAP_PACK)).toBe(true);

    const lionMaster = scene.getMeshByName(
      "cairo-qasr-el-nil-bridge-lion-master",
    );
    expect(lionMaster?.isVisible).toBe(false);
    expect(lionMaster?.getTotalVertices()).toBeGreaterThan(300);
    const lionBounds = lionMaster?.getBoundingInfo().boundingBox;
    expect((lionBounds?.maximum.x ?? 0) - (lionBounds?.minimum.x ?? 0)).toBeGreaterThan(3);
    expect((lionBounds?.maximum.y ?? 0) - (lionBounds?.minimum.y ?? 0)).toBeGreaterThan(2);
    expect((lionBounds?.maximum.z ?? 0) - (lionBounds?.minimum.z ?? 0)).toBeGreaterThan(1.2);

    const lions = scene.meshes.filter(
      (mesh): mesh is InstancedMesh =>
        mesh instanceof InstancedMesh &&
        /^cairo-qasr-el-nil-bridge-lion--?1--?1$/.test(mesh.name),
    );
    const plinths = scene.meshes.filter(
      (mesh): mesh is InstancedMesh =>
        mesh instanceof InstancedMesh &&
        /^cairo-qasr-el-nil-bridge-lion-plinth--?1--?1$/.test(mesh.name),
    );
    expect(lions).toHaveLength(4);
    expect(plinths).toHaveLength(4);
    expect(frozen.filter((node) => lions.includes(node as InstancedMesh))).toHaveLength(4);
    expect(frozen.filter((node) => plinths.includes(node as InstancedMesh))).toHaveLength(4);

    for (const end of [-1, 1]) {
      const pair = lions.filter((lion) => Math.sign(lion.position.x) === end);
      expect(pair, `bridge end ${end}`).toHaveLength(2);
      expect(pair.map((lion) => Math.sign(lion.position.z)).sort()).toEqual([-1, 1]);
      for (const lion of pair) {
        expect(lion.rotation.y).toBe(end < 0 ? Math.PI : 0);
      }
    }

    scene.dispose();
    engine.dispose();
  });
});
