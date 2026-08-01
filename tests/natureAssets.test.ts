import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LoadAssetContainerAsync, NullEngine, Scene } from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
  allNatureModelUrls,
  NATURE_MODELS,
  natureModelsForMap,
  natureSetUrls,
  natureSetsForMap,
} from "../app/game/natureCatalog";

const root = process.cwd();

/**
 * Every committed byte of the Kenney planting kit.
 *
 * Pinned for the same reason the Cairo kit is: `tools/style-nature-pack.mjs`
 * rewrites the JSON chunk and must keep the binary chunk untouched, so a
 * regenerated file that differs by a byte means the tool changed behaviour and
 * the provenance recorded in CREDITS.md no longer describes what ships.
 */
const COMMITTED_SHA256: Readonly<Record<string, string>> = {
  "nature-bush-clipped.glb": "46fa85755c1dbc7a50fb28a2a4182bc51e1c323e401b77ee403bff514709e717",
  "nature-bush-large.glb": "3561c60ad99ddd5a761434fed71dddcfa5e38857e997f66357b7174ddc6122f3",
  "nature-bush.glb": "03819b2ad61994ee3f6be746810d8a0cd82f956dc7eecc6f1d67f816c63d2f9f",
  "nature-conifer-round.glb": "7e4807a2f4a121989ab66f7ef0529c98bb1e94e9f6861adb4e397d82b3b87e1c",
  "nature-conifer-tall.glb": "4c747f4e56a0c334e0e93c2b39e15676cbfa16a1b8b12f348ff045a18edee9e1",
  "nature-flower-red.glb": "4959c6f9338df8b7dc42bf17a6f1665e8d4524c4cb6073bd9e2de7c284354d0b",
  "nature-flower-yellow.glb": "0959dfeb602181362ff46c64e38246ebea8a6f581c92c1f89d0eb5b1542daece",
  "nature-grass-tuft-large.glb": "187dab4b38c838edb51fb5309d43be521c330f9ec044c635f4b7d9bf000e3d3d",
  "nature-grass-tuft.glb": "04d5295b19ebfe3f5090c6641906f10b5825a3b43144d814fa8acc26e8a22a9a",
  "nature-obelisk.glb": "b079a8009fc84cbe1dfa5b830b58b7e3ac6963654ff5e15b2c621b61dfcc25cf",
  "nature-palm-short.glb": "81a4860ebdfcd5b8e073928dc0a5409394a16a70c497a1be974af3021a3f36b3",
  "nature-palm-tall.glb": "ef57d5391cd3f44f459582cbe37bb942a3b183b661f7d2691603417eaf3e6a8e",
  "nature-rock-large.glb": "6bc86d1dbf271a2543081d6cd25c0b2370c54299ebc97476ba156c12f5af0f85",
  "nature-rock-small.glb": "a8d48fadf386c1dbb6a3f4e088abded68f33fbe805a8fb7717eedbb57f1cc054",
  "nature-tree-broadleaf.glb": "c4024af59ca592beb255037b5b7a6f0a874911e168dc2c48c362cea1826735e7",
  "nature-tree-oak.glb": "9e268d75117bfdd8f090f8291d5c3e28e8e529b85bace7918c08f4149506b380",
  "nature-tree-small.glb": "d7ec2ac1df8d1ee3e899afa92b8c94530e2179deedfe34010a4357091169a14e",
  "nature-tree-tall.glb": "7ac27d9a16dea7b7d37933f6e68e9020b6896cdd97177f2c3b09f5012fd08a2b",
};

const fileFor = (url: string) =>
  resolve(root, "public", url.replace(/^\//, ""));

const parseGlbJson = (glb: Buffer) => {
  expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
};

describe("nature kit assets", () => {
  it("ships every catalogued model, pinned and under the size ceiling", async () => {
    expect(Object.keys(COMMITTED_SHA256).length).toBe(NATURE_MODELS.length);
    for (const url of allNatureModelUrls()) {
      const name = url.split("/").pop() ?? "";
      const bytes = await readFile(fileFor(url));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        COMMITTED_SHA256[name],
      );
      // Kept small deliberately: the whole kit is ~170 KB, and the point of
      // choosing it was that no single file comes near this.
      expect(bytes.byteLength, name).toBeLessThan(200 * 1024);
    }
  });

  it("is matte and recoloured, with no texture anywhere", async () => {
    for (const url of allNatureModelUrls()) {
      const name = url.split("/").pop() ?? "";
      const json = parseGlbJson(await readFile(fileFor(url)));
      // Solid materials are the whole reason this pack was chosen over an
      // atlas-textured one: they are what lets one file serve four palettes.
      expect(json.images ?? [], name).toHaveLength(0);
      expect(json.textures ?? [], name).toHaveLength(0);
      expect(json.asset?.extras?.curbsideRush?.style, name).toBe(
        "curbside-nature-v1",
      );
      for (const material of json.materials ?? []) {
        const pbr = material.pbrMetallicRoughness;
        // The kit ships metallic 1 / rough 1, which Babylon renders as dark
        // plastic. If this regresses, every park goes shiny.
        expect(pbr.metallicFactor, `${name}/${material.name}`).toBe(0);
        expect(pbr.roughnessFactor, `${name}/${material.name}`).toBe(0.9);
      }
    }
  });

  it("scopes downloads per city instead of shipping the kit everywhere", async () => {
    const cairo = natureSetUrls(natureSetsForMap("cairo"));
    const tokyo = natureSetUrls(natureSetsForMap("tokyo"));
    const nyc = natureSetUrls(natureSetsForMap("nyc"));
    // The specific point of scoping: no city pays for another's planting.
    expect(cairo.some((u) => u.includes("palm"))).toBe(true);
    expect(nyc.some((u) => u.includes("palm"))).toBe(false);
    expect(tokyo.some((u) => u.includes("palm"))).toBe(false);
    expect(nyc.some((u) => u.includes("conifer"))).toBe(true);
    expect(cairo.some((u) => u.includes("conifer"))).toBe(false);
    for (const set of [cairo, tokyo, nyc]) {
      expect(set.length).toBeGreaterThan(0);
      expect(set.length).toBeLessThan(allNatureModelUrls().length);
    }
  });

  it("gives every city a tree and a shrub to plant", () => {
    for (const key of ["nyc", "london", "tokyo", "cairo"]) {
      const roles = new Set(natureModelsForMap(key).map((m) => m.role));
      const hasCanopy =
        roles.has("tree") || roles.has("conifer") || roles.has("palm");
      expect(hasCanopy, `${key} has no canopy species`).toBe(true);
      expect(roles.has("shrub"), `${key} has no shrub`).toBe(true);
    }
  });

  it("parses under a headless engine and stands on the ground", async () => {
    // A committed file that Babylon cannot read would fail silently at runtime
    // — the preloader logs and skips — and every park would simply be bare.
    registerBuiltInLoaders();
    for (const model of NATURE_MODELS) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const bytes = await readFile(fileFor(model.url));
      const container = await LoadAssetContainerAsync(
        "data:model/gltf-binary;base64," + bytes.toString("base64"),
        scene,
        { pluginExtension: ".glb" },
      );
      expect(container.meshes.length, model.id).toBeGreaterThan(0);

      // The kit is authored with its base on y = 0. A model that is not would
      // plant a floating or half-buried tree, which is the `groundY` trap that
      // put Cairo's venue doors on open land.
      let lowest = Number.POSITIVE_INFINITY;
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        lowest = Math.min(lowest, mesh.getBoundingInfo().boundingBox.minimumWorld.y);
      }
      expect(lowest, `${model.id} base sits at y=${lowest.toFixed(3)}`).toBeGreaterThan(-0.2);
      expect(lowest, `${model.id} floats at y=${lowest.toFixed(3)}`).toBeLessThan(0.2);

      scene.dispose();
      engine.dispose();
    }
  }, 30_000);

  it("scales each model to a believable world size", async () => {
    // The kit is authored at roughly a fifth of world scale, so a scale near 1
    // plants saplings — which is exactly what the first pass shipped. These
    // bands are the check that a retuned scale stays in the realm of the thing
    // it depicts.
    const BANDS: Readonly<Record<string, readonly [number, number]>> = {
      tree: [5, 12],
      conifer: [5, 12],
      palm: [5, 10],
      shrub: [0.7, 1.8],
      flower: [0.3, 0.9],
      tuft: [0.3, 0.9],
      rock: [0.3, 1.2],
      monument: [2, 6],
    };
    registerBuiltInLoaders();
    for (const model of NATURE_MODELS) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const bytes = await readFile(fileFor(model.url));
      const container = await LoadAssetContainerAsync(
        "data:model/gltf-binary;base64," + bytes.toString("base64"),
        scene,
        { pluginExtension: ".glb" },
      );
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        low = Math.min(low, box.minimumWorld.y);
        high = Math.max(high, box.maximumWorld.y);
      }
      const worldHeight = (high - low) * model.scale;
      const [min, max] = BANDS[model.role];
      expect(
        worldHeight,
        `${model.id} stands ${worldHeight.toFixed(1)}m as a ${model.role}`,
      ).toBeGreaterThanOrEqual(min);
      expect(worldHeight, `${model.id} stands ${worldHeight.toFixed(1)}m`).toBeLessThanOrEqual(max);
      scene.dispose();
      engine.dispose();
    }
  }, 30_000);

  it("credits the kit with its licence and source", async () => {
    const credits = await readFile(resolve(root, "CREDITS.md"), "utf8");
    expect(credits).toContain("Nature Kit");
    expect(credits).toContain("kenney.nl");
    for (const name of Object.keys(COMMITTED_SHA256)) {
      expect(credits, `${name} is not credited`).toContain(name);
    }
  });
});
