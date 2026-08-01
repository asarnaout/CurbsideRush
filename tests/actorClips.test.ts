import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { ACTOR_CLIP_PATTERNS, CHARACTER_MODELS } from "../app/game/characterMeshes";

/**
 * A standing actor keeps their arms at their sides.
 *
 * Sounds too obvious to pin, and it is not: the rigs' Run clip opens with a
 * hand 0.64 m out at shoulder height, and an actor wearing that pose while
 * standing still at a kerb is exactly what a rideshare passenger with an arm
 * stuck out looks like. The clip matcher is the thing standing between the two
 * — `_Run$` is already anchored so it cannot swallow RunningJump — so this
 * measures what the matcher actually resolves "idle" to, against every rig.
 *
 * Numbers below are measured: hands sit ~0.23–0.25 m off the centreline
 * through all 250 frames of every rig's Idle.
 */

const CHAR_DIR = path.join(process.cwd(), "public/models/characters");
/** Comfortably above the measured 0.25 m, far below the Run clip's 0.64 m. */
const ARMS_AT_SIDES_M = 0.35;

registerBuiltInLoaders();

async function stage(url: string) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const config = CHARACTER_MODELS.find((entry) => entry.url === url)!;
  const buf = fs.readFileSync(path.join(CHAR_DIR, path.basename(url)));
  const container = await LoadAssetContainerAsync(
    "data:model/gltf-binary;base64," + buf.toString("base64"),
    scene,
    { pluginExtension: ".glb" },
  );
  const instance = container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
  const modelRoot = instance.rootNodes[0] as TransformNode;
  const root = new TransformNode("actor", scene);
  modelRoot.parent = root;
  root.rotation.y = config.yawOffset;
  modelRoot.scaling.setAll(config.scale);
  const skeleton = instance.skeletons[0]!;
  const carrier = modelRoot
    .getChildMeshes(false)
    .find((mesh) => mesh.skeleton === skeleton)!;
  return { engine, scene, skeleton, carrier, groups: instance.animationGroups };
}

describe("actor locomotion clips", () => {
  for (const config of CHARACTER_MODELS) {
    const rig = path.basename(config.url);

    it(`${rig}: the clip resolved as "idle" keeps both hands at the sides`, async () => {
      const { engine, scene, skeleton, carrier, groups } = await stage(config.url);
      const [, idlePattern] = ACTOR_CLIP_PATTERNS.find(([clip]) => clip === "idle")!;
      const idle = groups.find((group) => idlePattern.test(group.name));
      expect(idle, `${rig} has an idle clip`).toBeDefined();

      const anchors = ["Palm.R", "Palm.L"].map((name) => {
        const anchor = new Mesh(`probe-${name}`, scene);
        anchor.attachToBone(skeleton.bones.find((bone) => bone.name === name)!, carrier);
        return anchor;
      });

      // start + pause is what arms goToFrame; without it the rig never leaves
      // its rest pose and every frame below would trivially pass.
      idle!.start(true, 1, idle!.from, idle!.to, false);
      idle!.pause();
      const frames = Math.round(idle!.to - idle!.from);
      let widest = 0;
      for (let frame = 0; frame <= frames; frame += 1) {
        idle!.goToFrame(idle!.from + frame);
        skeleton.prepare(true);
        for (const anchor of anchors) {
          carrier.computeWorldMatrix(true);
          skeleton.prepare();
          anchor.computeWorldMatrix(true);
          const at = new Vector3();
          anchor.getWorldMatrix().decompose(new Vector3(), undefined, at);
          widest = Math.max(widest, Math.hypot(at.x, at.z));
        }
      }
      expect(widest, `${rig} widest hand reach across ${frames} idle frames`).toBeLessThan(
        ARMS_AT_SIDES_M,
      );

      scene.dispose();
      engine.dispose();
    });
  }

  it("resolves idle, walk and run to three different clips", async () => {
    const { engine, scene, groups } = await stage(CHARACTER_MODELS[0].url);
    const resolved = new Map<string, string>();
    for (const [clip, pattern] of ACTOR_CLIP_PATTERNS) {
      const match = groups.find((group) => pattern.test(group.name));
      expect(match, `a clip matched ${clip}`).toBeDefined();
      resolved.set(clip, match!.name);
    }
    expect(new Set(resolved.values()).size).toBe(3);
    // The anchoring that keeps Run off RunningJump.
    expect(resolved.get("run")).toMatch(/_Run$/);
    scene.dispose();
    engine.dispose();
  });
});
