import {
  Color3,
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
import { isNightWindowMaterialName } from "../app/game/render/buildingLayer";
import { resolveMapVisualPalette } from "../app/game/visuals";

describe("Cairo night lighting", () => {
  it("recognises verified pane names without turning architectural trim into glass", () => {
    for (const name of ["window", "Windows", "Glass", "Bricks_Glass", "cristal"]) {
      expect(isNightWindowMaterialName(name), name).toBe(true);
    }
    for (const name of ["trim", "Light", "Main", "border", "wall"]) {
      expect(isNightWindowMaterialName(name), name).toBe(false);
    }
  });

  it("lights a stable half of the Tahrir ministries while leaving its walls non-emissive", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx: CairoLandmarkCtx = {
      scene,
      visualPalette: resolveMapVisualPalette(CAIRO_MAP_PACK.id),
      staticSceneryFreeze: [],
      buildFlatPolygonMesh: () => undefined,
      buildParkLawnPolygon: () => undefined,
    };
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-ministries",
    );
    expect(landmark).toBeDefined();
    if (!landmark) return;

    const wall = new StandardMaterial("tahrir-ministries-wall", scene);
    wall.diffuseColor = new Color3(0.56, 0.5, 0.43);
    expect(buildCairoLandmark(ctx, landmark, wall, CAIRO_MAP_PACK)).toBe(true);

    const facadeWindows = scene.meshes.filter((mesh) =>
      /^cairo-tahrir-ministries-(?:wing-)?window-/.test(mesh.name),
    );
    expect(facadeWindows).toHaveLength(27);
    const materialNames = facadeWindows.map((mesh) => mesh.material?.name);
    expect(materialNames.filter((name) => name?.endsWith("-window-warm"))).toHaveLength(8);
    expect(materialNames.filter((name) => name?.endsWith("-window-cool"))).toHaveLength(5);
    expect(materialNames.filter((name) => name === "cairo-tahrir-ministries-window")).toHaveLength(14);

    const entrance = scene.getMeshByName("cairo-tahrir-ministries-entrance");
    expect(entrance?.material?.name).toBe("cairo-tahrir-ministries-window-warm");

    // The fix is practical light, not a return of the rejected flat-orange
    // wall pass: the central slab and both broad wings retain the caller's
    // ordinary non-emissive material.
    for (const name of [
      "cairo-tahrir-ministries",
      "cairo-tahrir-ministries-wing--1",
      "cairo-tahrir-ministries-wing-1",
    ]) {
      const material = scene.getMeshByName(name)?.material as StandardMaterial;
      expect(material).toBe(wall);
      expect(material.emissiveColor.asArray()).toEqual([0, 0, 0]);
    }

    const cornice = scene.getMeshByName("cairo-tahrir-ministries-cornice");
    const corniceMaterial = cornice?.material as StandardMaterial;
    expect(corniceMaterial.emissiveColor.r).toBeCloseTo(0.2, 6);
    expect(corniceMaterial.emissiveColor.g).toBeCloseTo(0.13, 6);
    expect(corniceMaterial.emissiveColor.b).toBeCloseTo(0.045, 6);

    scene.dispose();
    engine.dispose();
  });
});
