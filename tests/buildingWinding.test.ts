import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { ALL_ENV_MODELS, MERGE_INCOMPATIBLE_MODEL_IDS } from "../app/game/buildingCatalog";
import {
  orientMergedFacesOutward,
  windingAgreement,
} from "../app/game/buildingWinding";

// Every environment model placed through the renderer's merged-building path
// (getBuildingMaster) — the building sets and street vendors, in all three
// kitted cities. The merge bake that inverts faces is set-agnostic, so the
// guard covers the whole catalogue rather than one city's slice (it was
// NYC-only until London's kit landed unchecked by it). The skinned people are
// never merged, so they're excluded.
//
// `MERGE_INCOMPATIBLE_MODEL_IDS` (buildingCatalog.ts) is also excluded:
// `Mesh.MergeMeshes` throws ("Cannot merge vertex data that do not have the
// same set of attributes") on every one of those — see that constant's own
// doc comment for the full story. They render via `instantiateModelInstanced`
// instead (`render/buildingLayer.ts`), which instances each submesh's
// ORIGINAL geometry directly (no world-matrix bake into a merged vertex
// buffer), so it never hits the hollow-winding bug this file guards against
// in the first place — there is nothing for this test to check on them.
const MERGED = ALL_ENV_MODELS.filter(
  (m) => m.category !== "person" && !MERGE_INCOMPATIBLE_MODEL_IDS.has(m.id),
);

describe("merged building winding", () => {
  registerBuiltInLoaders();

  // Mirrors getBuildingMaster: load, instantiate real clones, bake world matrices
  // into one merged mesh. That bake is what can leave a model inside-out.
  const mergeLikeRenderer = async (url: string) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const buf = fs.readFileSync(
      path.join(process.cwd(), "public", url.split(/[?#]/, 1)[0]),
    );
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
    expect(master, url).toBeTruthy();
    return { master, scene, engine };
  };

  // A handful of Quaternius sources carry exactly two triangles whose authored
  // normals oppose their winding — an authoring slip in the pack, present in
  // the shipped Cairo conversions of the same sources and invisible in-game
  // (the majority-vote flip leaves a 2-tri sliver back-face culled). Pinned
  // EXACTLY per model, discovered when this suite widened from NYC-only to the
  // whole catalogue: a model absent here must be perfectly one-sided, and a
  // stray count that moves means the source or the converter changed.
  const KNOWN_STRAY_TRIS: Readonly<Record<string, number>> = {
    "cairo-block-slim": 2,
    "cairo-block-terrace": 2,
    "cairo-office-block": 2,
    "cairo-depot": 2,
    "london-terrace-a": 2,
    "london-terrace-b": 2,
    "london-terrace-d": 2,
    "london-terrace-e": 2,
    "london-stucco-a": 2,
    "london-stucco-b": 2,
    "london-stucco-d": 2,
    // Tokyo P1 imports (13 independent Sketchfab authors, not one pack) —
    // each a handful of the same kind of authoring slip, measured directly
    // rather than assumed from the Quaternius/KayKit precedent above.
    "tokyo-shop-a": 2,
    "tokyo-shop-b": 2,
    "tokyo-shop-d": 1,
    // Tokyo P3a: tokyo-block-slim shares cairo-block-slim's exact source
    // geometry (same Quaternius OBJ+MTL pair) and needs the identical count
    // for the identical reason. tokyo-zakkyo-e and tokyo-nippori-bldg are
    // each their own independent Sketchfab source with their own measured
    // slip, the same class as the P1 row above (tokyo-nippori-bldg's higher
    // count reflects a photogrammetry mesh's much larger triangle budget,
    // not a bigger problem — 4 strays out of 59,606 tris is proportionally
    // smaller than tokyo-shop-a's 2 of a few hundred).
    "tokyo-block-slim": 2,
    "tokyo-zakkyo-e": 1,
    "tokyo-nippori-bldg": 4,
    // Joined MERGED when its secondary-UV strip took it off
    // MERGE_INCOMPATIBLE_MODEL_IDS (tools/normalize-glb-attributes.mjs —
    // buildingCatalog.ts's own comment has the story); measured directly on
    // first entry to this harness: 2 strays out of 9,329 tris, the same
    // authoring-slip class as its P1 siblings above.
    "tokyo-house-d": 2,
  };

  // The guard: after the winding fix every merged building's outward faces are
  // the ones drawn, so none render inside-out ("hollow"). Several models (the
  // brownstones, the farm house, the tenement) come out inverted from the merge
  // and rely on this fix — that inversion is the bug this test locks down.
  it.each(MERGED.map((m) => [m.id, m.url] as const))(
    "orients %s so its outward faces are drawn (not hollow)",
    async (id, url) => {
      const { master, scene, engine } = await mergeLikeRenderer(url);

      // Pre-fix a model is either already correct or fully inverted, up to its
      // pinned stray triangles. More mixing than that would mean a single flip
      // can't fix it and needs a closer look.
      const strays = KNOWN_STRAY_TRIS[id] ?? 0;
      const before = windingAgreement(master);
      expect(
        Math.min(before.agree, before.disagree),
        `${url} winding is mixed (agree=${before.agree}, disagree=${before.disagree})`,
      ).toBe(strays);

      orientMergedFacesOutward(master);

      // The majority orientation must be outward; only the pinned strays may
      // remain culled, and they must be exactly the minority that went in.
      const after = windingAgreement(master);
      expect(after.agree, url).toBe(Math.max(before.agree, before.disagree));
      expect(after.disagree, url).toBe(strays);

      scene.dispose();
      engine.dispose();
    },
  );
});
