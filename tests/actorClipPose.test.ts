import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  type AnimationGroup,
  FreeCamera,
  LoadAssetContainerAsync,
  NullEngine,
  Scene,
  type Skeleton,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
  ACTOR_CLIP_PATTERNS,
  CHARACTER_MODELS,
  holdUnkeyedBonesAtRest,
} from "../app/game/characterMeshes";

/**
 * Numeric contract for issue #254 (the driver's stretched shoe at the pump).
 *
 * The Quaternius rigs key `Foot.L`/`Foot.R` — IK targets parented to the
 * armature root, not to the leg chain — in every clip *except* Idle, which
 * leaves them at rest. So walk→idle strands both feet wherever the stride
 * happened to stop while the legs snap to the idle pose, and the shoes skin
 * into long spikes across the gap. It is invisible to any test that only ever
 * plays one clip, which is why this one always plays a second.
 */

const CHAR_DIR = path.join(process.cwd(), "public/models/characters");

registerBuiltInLoaders();

interface Staged {
  readonly engine: NullEngine;
  readonly scene: Scene;
  readonly skeleton: Skeleton;
  readonly clips: Map<string, AnimationGroup>;
}

/** Mirrors buildActorFromConfig: instantiate, keep the three locomotion clips,
 * hold the bones they leave unkeyed at rest. */
async function stageActor(url: string, withFix: boolean): Promise<Staged> {
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

  const clips = new Map<string, AnimationGroup>();
  for (const group of instance.animationGroups) {
    const match = ACTOR_CLIP_PATTERNS.find(
      ([clip, pattern]) => !clips.has(clip) && pattern.test(group.name),
    );
    if (match) clips.set(match[0], group);
    else group.dispose();
  }
  if (withFix) holdUnkeyedBonesAtRest(clips.values());
  return { engine, scene, skeleton: instance.skeletons[0]!, clips };
}

/** What `setClip` does, minus the blending: stop the outgoing clip, start the
 * incoming one, park it on a frame and evaluate the skeleton. `start`+`pause`
 * is what actually arms `goToFrame` (see courierBag.test.ts). */
function play(staged: Staged, clip: string, fraction: number): void {
  for (const group of staged.clips.values()) group.stop();
  const group = staged.clips.get(clip)!;
  group.start(true, 1, group.from, group.to, false);
  group.pause();
  group.goToFrame(group.from + (group.to - group.from) * fraction);
  staged.skeleton.prepare(true);
}

/** Every bone's world position, which is what the shoes are skinned to. */
function pose(staged: Staged): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  for (const bone of staged.skeleton.bones) {
    const node = bone.getTransformNode();
    if (!node) continue;
    node.computeWorldMatrix(true);
    out.set(bone.name, node.getAbsolutePosition().clone());
  }
  return out;
}

/** The bone that drifts furthest between two poses, and by how far (metres). */
function worstDrift(a: Map<string, Vector3>, b: Map<string, Vector3>) {
  let bone = "";
  let metres = 0;
  for (const [name, position] of a) {
    const other = b.get(name);
    if (!other) continue;
    const drift = Vector3.Distance(position, other);
    if (drift > metres) {
      metres = drift;
      bone = name;
    }
  }
  return { bone, metres };
}

/** A stride's worth of samples, so the feet are caught at the extremes of the
 * swing and not only where the cycle happens to cross the rest pose. */
const STRIDE = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

describe("an actor's pose after a clip change", () => {
  for (const config of CHARACTER_MODELS) {
    const rig = path.basename(config.url);

    it(`${rig}: idles identically whether or not it walked first`, async () => {
      // The invariant, and the whole bug in one line: a clip's pose is a
      // property of that clip, never of what played before it.
      const staged = await stageActor(config.url, true);

      play(staged, "idle", 0);
      const clean = pose(staged);

      for (const fraction of STRIDE) {
        for (const previous of ["walk", "run"] as const) {
          play(staged, previous, fraction);
          play(staged, "idle", 0);
          const drift = worstDrift(clean, pose(staged));
          expect(
            drift.metres,
            `${rig}: ${previous}@${fraction} → idle left ${drift.bone} adrift`,
          ).toBeLessThan(0.001);
        }
      }

      staged.scene.dispose();
      staged.engine.dispose();
    });

    it(`${rig}: still swings the feet through a full stride`, async () => {
      // The opposite failure, which the assertion above cannot see: pad a
      // channel the clip *does* key — one target-identity slip is enough — and
      // every bone pins to rest. Idle would still equal idle, and the actor
      // would slide around frozen. Measured strides are 0.81 m walking and
      // 1.04 m running, so half of each is a floor no working rig can miss and
      // no pinned one can reach.
      const staged = await stageActor(config.url, true);

      for (const [clip, stride] of [
        ["walk", 0.805],
        ["run", 1.039],
      ] as const) {
        let lowest = Infinity;
        let highest = -Infinity;
        for (const fraction of STRIDE) {
          play(staged, clip, fraction);
          const foot = pose(staged).get("Foot.L")!;
          lowest = Math.min(lowest, foot.z);
          highest = Math.max(highest, foot.z);
        }
        expect(highest - lowest, `${rig}: ${clip} stride`).toBeGreaterThan(stride / 2);
      }

      staged.scene.dispose();
      staged.engine.dispose();
    });
  }

  it("brings the feet home across the cross-fade, not only at its end", async () => {
    // The padding rides `setClip`'s blend, and a blended constant is exactly
    // where this could half-work: land the foot 90% of the way home and the
    // spike is shorter but just as permanent. So this drives the real thing —
    // enableBlending, blendingSpeed, play(true) — and renders until the
    // cross-fade has run its course.
    const config = CHARACTER_MODELS[0];
    const staged = await stageActor(config.url, true);
    new FreeCamera("camera", Vector3.Zero(), staged.scene);

    const idle = staged.clips.get("idle")!;
    const walk = staged.clips.get("walk")!;

    play(staged, "idle", 0);
    const clean = pose(staged);

    idle.stop();
    walk.play(true);
    for (let frame = 0; frame < 30; frame++) staged.scene.render();
    staged.skeleton.prepare(true);
    const midStride = pose(staged);
    // Without this the rest of the test is vacuous: if rendering never advanced
    // the clip, the rig would still be sitting in the pose it is asked to
    // return to, and the convergence check below would pass having proved
    // nothing at all.
    expect(
      worstDrift(clean, midStride).metres,
      "the walk clip actually posed the rig before the switch",
    ).toBeGreaterThan(0.05);

    walk.stop();
    idle.enableBlending = true;
    idle.blendingSpeed = 0.09;
    idle.play(true);
    // 0.09 per evaluation reaches full weight in ~12; 120 is a decisive margin.
    for (let frame = 0; frame < 120; frame++) staged.scene.render();
    staged.skeleton.prepare(true);

    const drift = worstDrift(clean, pose(staged));
    expect(
      drift.metres,
      `the cross-fade left ${drift.bone} short of its idle pose`,
    ).toBeLessThan(0.01);

    staged.scene.dispose();
    staged.engine.dispose();
  });

  it("is the clip padding that holds the pose, not the rig", async () => {
    // Guards the fix itself: without holdUnkeyedBonesAtRest the same rig fails
    // both assertions above, so neither can quietly stop testing anything.
    const config = CHARACTER_MODELS[0];
    const staged = await stageActor(config.url, false);

    play(staged, "idle", 0);
    const clean = pose(staged);
    play(staged, "walk", 0.25);
    play(staged, "idle", 0);
    const drift = worstDrift(clean, pose(staged));

    expect(drift.bone).toMatch(/^Foot\.[LR]$/);
    expect(drift.metres).toBeGreaterThan(0.05);

    staged.scene.dispose();
    staged.engine.dispose();
  });
});
