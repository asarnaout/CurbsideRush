import { Color3, NullEngine, Scene, StandardMaterial } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import {
  buildLondonLandmark,
  type LondonLandmarksCtx,
} from "../app/game/render/londonLandmarks";
import { buildTokyoLandmark } from "../app/game/render/tokyoLandmarks";

const emissive = (scene: Scene, name: string): readonly number[] => {
  const material = scene.getMaterialByName(name) as StandardMaterial | null;
  expect(material, name).not.toBeNull();
  return material?.emissiveColor.asArray() ?? [];
};

describe("other-city night lighting", () => {
  it("lights London glazing and skyline landmarks without making their stone walls emissive", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx: LondonLandmarksCtx = {
      scene,
      staticSceneryFreeze: [],
      registerShadowCaster: () => undefined,
      registerDestructibleProp: () => undefined,
    };
    const wall = new StandardMaterial("london-test-wall", scene);
    wall.diffuseColor = new Color3(0.6, 0.52, 0.44);

    for (const id of [
      "london-natural-history-museum",
      "london-eye-wheel",
      "london-glass-gherkin",
      "london-shard-spire",
    ]) {
      const landmark = LONDON_MAP_PACK.geometry.landmarks.find(
        (candidate) => candidate.id === id,
      );
      expect(landmark, id).toBeDefined();
      if (landmark) {
        expect(
          buildLondonLandmark(ctx, landmark, wall, LONDON_MAP_PACK),
          id,
        ).toBe(true);
      }
    }

    expect(emissive(scene, "london-landmark-windows")).toEqual([
      0.34, 0.25, 0.13,
    ]);
    expect(emissive(scene, "london-eye-wheel-steel")).toEqual([
      0.42, 0.5, 0.62,
    ]);
    expect(emissive(scene, "london-glass-gherkin-glass")).toEqual([
      0.14, 0.22, 0.28,
    ]);
    expect(emissive(scene, "london-shard-spire-glass")).toEqual([
      0.18, 0.25, 0.32,
    ]);
    expect(wall.emissiveColor.asArray()).toEqual([0, 0, 0]);

    scene.dispose();
    engine.dispose();
  });

  it("makes Tokyo's tiny aircraft beacon bloom while keeping the tower lattice crisp", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const landmark = TOKYO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "jp-hikari-tower",
    );
    expect(landmark).toBeDefined();
    if (landmark) {
      expect(
        buildTokyoLandmark(
          { scene, staticSceneryFreeze: [] },
          landmark,
          new StandardMaterial("tokyo-test-wall", scene),
          TOKYO_MAP_PACK,
        ),
      ).toBe(true);
    }

    expect(emissive(scene, "jp-hikari-tower-beacon")).toEqual([
      1.7, 0.24, 0.12,
    ]);
    expect(emissive(scene, "jp-hikari-tower-orange")).toEqual([
      0.62, 0.21, 0.05,
    ]);

    scene.dispose();
    engine.dispose();
  });
});
