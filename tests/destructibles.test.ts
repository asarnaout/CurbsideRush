import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";

import { Destructibles } from "../app/game/render/destructibles";

describe("Destructibles road elevation", () => {
  it("rejects cross-level overlap and strikes an elevated prop on its own deck", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const sign = new TransformNode("elevated-sign", scene);
    sign.position.set(0, 12.1, 0);
    const destructibles = new Destructibles(scene);
    destructibles.register(
      "speedlimit-sign",
      0,
      0,
      1,
      [{ node: sign, isLightPool: false }],
      10.5,
    );
    const onContact = vi.fn(() => true);
    const bursts: { x: number; y: number; z: number; count: number }[] = [];
    const emitImpactBurst = (x: number, y: number, z: number, count: number) =>
      bursts.push({ x, y, z, count });

    destructibles.checkCollisions(
      0,
      0,
      0,
      0,
      onContact,
      emitImpactBurst,
    );
    expect(onContact).not.toHaveBeenCalled();
    expect(sign.parent).toBeNull();

    destructibles.checkCollisions(
      0,
      0,
      0,
      10.5,
      onContact,
      emitImpactBurst,
    );
    expect(onContact).toHaveBeenCalledTimes(1);
    const pivot = sign.parent as TransformNode | null;
    expect(pivot?.position.y).toBeCloseTo(10.5, 6);
    expect(bursts).toEqual([{ x: 0, y: 11.2, z: 0, count: 14 }]);

    destructibles.update(1);
    expect(pivot?.position.y).toBeCloseTo(10.44, 6);
    destructibles.dispose();
    scene.dispose();
    engine.dispose();
  });
});
