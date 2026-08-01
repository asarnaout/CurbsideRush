import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LoadAssetContainerAsync,
  type AnimationGroup,
  type Mesh,
  NullEngine,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { CHARACTER_MODELS, addDeliveryBag } from "../app/game/characterMeshes";

/**
 * Numeric contract for issue #186 (the courier carries the order). Every way
 * this can be wrong is invisible in a still frame:
 *
 * - the rig's 100x armature scale, undivided, builds the bag oversize and puts
 *   it in the air above the courier — in no frame at all;
 * - a bag parented rigidly to `Palm.R` capsizes as the arm swings, because that
 *   bone turns through roughly a right angle across the Run clip;
 * - and a bag welded to the wrong frame drifts off the hand entirely.
 *
 * So these assertions run the real attachment against the real glbs, with the
 * skeleton actually animating.
 */

const CHAR_DIR = path.join(process.cwd(), "public/models/characters");

registerBuiltInLoaders();

/** Mirrors buildActorFromConfig's hierarchy: a yaw-carrying root above the
 * model, the model scaled to a ~1.8 m person. */
async function stageActor(url: string) {
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
  root.parent = new TransformNode("actor-node", scene);
  modelRoot.parent = root;
  root.rotation.y = config.yawOffset;
  modelRoot.scaling.setAll(config.scale);

  const skeleton = instance.skeletons[0] ?? null;
  const carrier = modelRoot
    .getChildMeshes(false)
    .find((mesh) => mesh.skeleton === skeleton);
  const run = instance.animationGroups.find((group) => /_Run$/i.test(group.name));
  return { engine, scene, root, skeleton, carrier, run, config };
}

/** start + pause is what actually arms goToFrame (crowdRenderer's bake does
 * the same); goToFrame alone leaves the rig in its rest pose, which would make
 * every assertion below pass without the skeleton ever having moved. */
function poseAt(run: AnimationGroup, skeleton: NonNullable<Awaited<ReturnType<typeof stageActor>>["skeleton"]>, fraction: number) {
  run.start(true, 1, run.from, run.to, false);
  run.pause();
  run.goToFrame(run.from + (run.to - run.from) * fraction);
  skeleton.prepare(true);
}

function worldOf(mesh: Mesh) {
  mesh.computeWorldMatrix(true);
  const scale = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  mesh.getWorldMatrix().decompose(scale, rotation, position);
  return { scale, rotation, position };
}

/** Eight samples spanning a full stride, so the arm is caught at the back of
 * the swing, at the front, and passing the hip both ways. */
const SWING = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

describe("the courier's delivery bag", () => {
  for (const config of CHARACTER_MODELS) {
    const rig = path.basename(config.url);

    it(`${rig}: hangs plumb off the hand for the whole run cycle`, async () => {
      const { engine, scene, root, skeleton, carrier, run } = await stageActor(
        config.url,
      );
      expect(skeleton, rig).not.toBeNull();
      expect(carrier, rig).toBeDefined();
      expect(run, rig).toBeDefined();

      const bag = addDeliveryBag(scene, "test", skeleton, carrier, root);
      expect(bag, rig).not.toBeNull();
      bag!.setVisible!(true);

      const sack = bag!.meshes.find((mesh) => mesh.name.endsWith("-sack"))!;
      const anchor = bag!.meshes.find((mesh) => mesh.name.endsWith("-anchor"))!;
      const up = new Vector3();

      for (const fraction of SWING) {
        poseAt(run!, skeleton!, fraction);
        bag!.update!();

        anchor.computeWorldMatrix(true);
        const hand = anchor.getAbsolutePosition();
        const { scale, rotation, position } = worldOf(sack);

        // The 100x armature scale is divided back out, so the bag is a bag.
        expect(scale.x, `${rig} @${fraction} scale`).toBeCloseTo(1, 2);

        // It stays in the hand: the sack's centre sits a bag's drop below the
        // palm, never adrift of it.
        expect(
          Vector3.Distance(hand, position),
          `${rig} @${fraction} distance from hand`,
        ).toBeLessThan(0.35);
        expect(position.y, `${rig} @${fraction} hangs below the palm`).toBeLessThan(
          hand.y,
        );

        // And it never tips with the wrist, which is the whole reason the
        // holder's rotation is recomputed rather than inherited.
        Vector3.Up().rotateByQuaternionToRef(rotation, up);
        expect(up.y, `${rig} @${fraction} upright`).toBeGreaterThan(0.999);
      }

      scene.dispose();
      engine.dispose();
    });
  }

  it("is hidden until the courier is actually carrying something", async () => {
    const config = CHARACTER_MODELS[0];
    const { engine, scene, root, skeleton, carrier } = await stageActor(config.url);
    const bag = addDeliveryBag(scene, "test", skeleton, carrier, root)!;
    const sack = bag.meshes.find((mesh) => mesh.name.endsWith("-sack"))!;

    expect(sack.isEnabled()).toBe(false);
    expect(() => bag.update!()).not.toThrow(); // no-op while empty-handed
    bag.setVisible!(true);
    expect(sack.isEnabled()).toBe(true);
    bag.setVisible!(false);
    expect(sack.isEnabled()).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("reports every mesh and material it made, so the actor can dispose them", async () => {
    const config = CHARACTER_MODELS[0];
    const { engine, scene, root, skeleton, carrier } = await stageActor(config.url);
    const bag = addDeliveryBag(scene, "test", skeleton, carrier, root)!;

    // Sack, rim, two handles and the bone anchor — the anchor especially, since
    // it lives outside the actor's root and nothing else would reach it.
    expect(bag.meshes).toHaveLength(5);
    expect(bag.meshes.some((mesh) => mesh.name.endsWith("-anchor"))).toBe(true);
    expect(bag.materials).toHaveLength(2);

    scene.dispose();
    engine.dispose();
  });

  it("declines to build rather than guess when the hand bone is missing", async () => {
    const config = CHARACTER_MODELS[0];
    const { engine, scene, root, carrier } = await stageActor(config.url);
    expect(addDeliveryBag(scene, "test", null, carrier, root)).toBeNull();
    scene.dispose();
    engine.dispose();
  });
});
