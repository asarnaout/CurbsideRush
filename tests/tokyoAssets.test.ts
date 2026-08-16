import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MERGE_INCOMPATIBLE_MODEL_IDS,
  TOKYO_ENV_MODELS,
  TOKYO_ZAKKYO_MODEL_IDS,
  tokyoEnvModelUrls,
} from "../app/game/buildingCatalog";
import { buildingPlacementConfig } from "../app/game/buildingSets";
import { buildingStructuralBoundsFor } from "../app/game/buildingStructuralBounds";
import { parseGlb } from "../tools/pack-gltf.mjs";

const root = process.cwd();

/**
 * Every committed byte of the Tokyo street-wall kit: phase P1 (13 Sketchfab
 * imports — houses, apāto, konbini, shotengai shops, an izakaya and a ramen
 * shop) plus phase P3a (13 more — six `tokyo-zakkyo-*` splits of one
 * 19-building Sketchfab pack, the optional `tokyo-nippori-bldg` hero, and
 * six CC0 restyle-backbone models).
 *
 * Pinned for the same reason London's kit is: `tools/pack-gltf.mjs`/
 * `tools/split-asian-city-pack.mjs` (the glTF->glb packers) and
 * `tools/style-tokyo-buildings.mjs` (the normalization pass, both its
 * Sketchfab-textured path and its P3a flat-palette path) must regenerate
 * these files exactly from the recipes documented in their own headers, so
 * a file that differs by a byte means a tool changed behaviour and the
 * provenance recorded in CREDITS.md no longer describes what ships.
 */
const COMMITTED_SHA256: Readonly<Record<string, string>> = {
  "tokyo-house-a.glb": "5b68873e987dd09d84ac82064759a78b896aa3e4c4af0ca48b6b96b53fefb281",
  "tokyo-house-b.glb": "d95b346c7c72f76f34661a1c6efe406c222e311dd3b432985ad95ae6821319bc",
  "tokyo-house-c.glb": "45a32d1fbd9dc3efad50101cbc213247f9cf3758e783caec713b8bc1699743bb",
  "tokyo-house-d.glb": "82b249fe1d8d43463bf5828b470e2270c2fefd9f29b8c72914ce2ec9ec1650a4",
  "tokyo-apato-a.glb": "575b54ab2ffe6473a856c08bc0105cde6a68b3a78abcb7cb59f5d6f9dcb3de89",
  "tokyo-apato-b.glb": "db408a486fd98a1551d84c5fd92f6ea9881ae3d491046b16bd2b8eb52576f433",
  "tokyo-konbini.glb": "3abc6babc8f48dd605cd5f8cf0d21f04b6a64e9da101e9761626ddd24554f53e",
  "tokyo-shop-a.glb": "e8405c3f5e13850436d6e2cc09f847cc40031513f8b1d884165210917c6265cc",
  "tokyo-shop-b.glb": "6f301e6fdccf79607a645dbf9cd9b131c2708769a7f8b9a6c9a09f4f6fced172",
  "tokyo-shop-c.glb": "8090b33f73ffc9ec049bec181d0dbe25fc7acc338c748c518f77223f81cdc41b",
  "tokyo-shop-d.glb": "1607578094db7934beb28ded8e2fc7a56978fc13792f090103e5ea63c8e59528",
  "tokyo-izakaya.glb": "3a9dcac0c78840848d3691a9d1fdf4d759fe1908fd9a00eb10e17a1971d51176",
  "tokyo-ramen.glb": "50e13b3dd3eea88705bbf6372a768a26ddd82e2a185f0204c848fa7c3fec2cbe",
  "tokyo-zakkyo-a.glb": "723514e4d286cfcd5c7e1d089554aca2d0e1ac2d422089f38d5776e6c2789c0a",
  "tokyo-zakkyo-b.glb": "3a5fdc7d896451c348f5e3289c0d060210c49c66003830fffc29c77b62afbffc",
  "tokyo-zakkyo-c.glb": "583edc1b9a78697f47332656f74dd14f11bcf55c3ca8b385d0cdccb01cd978b9",
  "tokyo-zakkyo-d.glb": "95112c18a69428d1cc8484d8b4d01840706448f864f70e66959520d285624717",
  "tokyo-zakkyo-e.glb": "d1fad097b42d646b9ecca85eb8a37f3d635cf53fadb2947ed8f4f21dadbedb13",
  "tokyo-zakkyo-f.glb": "fec33d9f808d6e31aabef855bc95651abd4e001022fc126eb73681e87f308f7d",
  "tokyo-nippori-bldg.glb": "3ef267714635cba4b15945715b06b13a6908fb51142857f8c910ef38aa511125",
  "tokyo-walkup-a.glb": "fe7b2c4770d8d5901c1243044f046e08a52ab6cbed08938f10b0f97829b927bb",
  "tokyo-walkup-b.glb": "79af3e7d98da87b1b72ab4a4b9afd2165bf7d4b565e1d501c107866b00ecd48b",
  "tokyo-tower-a.glb": "21bb529bb66b64e174ee2e110c81fb1426b77239400ab246c007ffa3d29d7917",
  "tokyo-block-slim.glb": "03e01c862605a6dbe99ee405f72ac06f77770c832d370b39e31226bbe5dee577",
  "tokyo-block-small.glb": "7c24defc0bd2b2da1be718394a0101b19c556fa7b0f5d96182832e7c87ff8068",
  "tokyo-block-4story.glb": "b998bb3ce5141037d3a2d53f440ce3ed4a7abfb6b0fd340e4cf73f8da5809f1e",
};

/** The 20 CC-BY 4.0 Sketchfab imports (P1's 13 + P3a's 7) — normalized by
 * `tools/style-tokyo-buildings.mjs`'s Sketchfab-textured path,
 * `style: "tokyo-sketchfab-v1"`. */
const SKETCHFAB_MODEL_IDS = new Set(
  TOKYO_ENV_MODELS.filter((m) => m.license === "CC-BY 4.0").map((m) => m.id),
);
/** P3a's 6 CC0 restyle-backbone models — normalized by
 * `tools/style-tokyo-buildings.mjs`'s flat-palette path,
 * `style: "tokyo-block-v1"`. */
const BLOCK_PALETTE_MODEL_IDS = new Set(
  TOKYO_ENV_MODELS.filter((m) => m.license === "CC0 1.0").map((m) => m.id),
);

const fileFor = (url: string) => resolve(root, "public", url.replace(/^\//, ""));

const parseGlbJson = (glb: Buffer) => {
  expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
};

describe("Tokyo street-wall kit assets (P1 + P3a — import only)", () => {
  it("has exactly 26 catalogued models", () => {
    // Pins P1's scope (13: houses a-d, apato a-b, konbini, shops a-d,
    // izakaya, ramen) plus P3a's (13: zakkyo splits a-f, the nippori hero,
    // walkup a-b, tower-a, block-slim/small/4story). The gas station is a
    // later phase (P7) and must not appear here yet.
    expect(TOKYO_ENV_MODELS.length).toBe(26);
  });

  it("ships every catalogued model, byte-pinned", async () => {
    expect(Object.keys(COMMITTED_SHA256).length).toBe(TOKYO_ENV_MODELS.length);
    for (const url of tokyoEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const bytes = await readFile(fileFor(url));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest, file).toBe(COMMITTED_SHA256[file]);
    }
  });

  it("bakes Sketchfab-batch provenance into every CC-BY glb", async () => {
    expect(SKETCHFAB_MODEL_IDS.size).toBe(20);
    for (const model of TOKYO_ENV_MODELS) {
      if (!SKETCHFAB_MODEL_IDS.has(model.id)) continue;
      const file = model.url.split("/").at(-1)!;
      const json = parseGlbJson(await readFile(fileFor(model.url)));
      const provenance = json.asset?.extras?.curbsideRush;
      expect(provenance?.style, file).toBe("tokyo-sketchfab-v1");
      expect(provenance?.license, file).toBe("CC-BY 4.0");
      expect(provenance?.author, file).toBeTruthy();
      expect(provenance?.title, file).toBeTruthy();
      expect(provenance?.sourceUrl, file).toContain("sketchfab.com");
      expect(provenance?.sourceSha256, file).toMatch(/^[0-9a-f]{64}$/);
      expect(provenance?.modifications, file).toBeTruthy();
    }
  });

  it("bakes restyle-backbone provenance into every CC0 glb (P3a)", async () => {
    expect(BLOCK_PALETTE_MODEL_IDS.size).toBe(6);
    for (const model of TOKYO_ENV_MODELS) {
      if (!BLOCK_PALETTE_MODEL_IDS.has(model.id)) continue;
      const file = model.url.split("/").at(-1)!;
      const json = parseGlbJson(await readFile(fileFor(model.url)));
      const provenance = json.asset?.extras?.curbsideRush;
      expect(provenance?.style, file).toBe("tokyo-block-v1");
      expect(provenance?.license, file).toBe("CC0-1.0");
      expect(provenance?.author, file).toBeTruthy();
      expect(provenance?.title, file).toBeTruthy();
      expect(provenance?.sourceUrl, file).toBeTruthy();
      expect(provenance?.sourceSha256, file).toBeTruthy();
      expect(provenance?.modifications, file).toBeTruthy();
    }
  });

  it("keeps every model self-contained (no external buffer/image URIs)", async () => {
    // The whole point of tools/pack-gltf.mjs: every buffers[]/images[] entry
    // must be bufferView-embedded, never a uri reference to a file that
    // isn't shipped inside the glb itself.
    for (const url of tokyoEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const json = parseGlbJson(await readFile(fileFor(url)));
      for (const buffer of json.buffers ?? []) {
        expect(buffer.uri, file).toBeUndefined();
      }
      for (const image of json.images ?? []) {
        expect(image.uri, file).toBeUndefined();
        expect(image.bufferView, file).toBeTypeOf("number");
      }
    }
  });

  it("keeps every embedded texture at or under 1024px", async () => {
    const sharp = (await import("sharp")).default;
    for (const url of tokyoEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const { json, bin } = parseGlb(await readFile(fileFor(url)));
      for (const image of json.images ?? []) {
        const view = json.bufferViews[image.bufferView];
        const bytes = bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
        const meta = await sharp(bytes).metadata();
        expect(meta.width, `${file} ${image.name}`).toBeLessThanOrEqual(1024);
        expect(meta.height, `${file} ${image.name}`).toBeLessThanOrEqual(1024);
      }
    }
  });

  it("gives every CC-BY model a required attribution string", () => {
    for (const model of TOKYO_ENV_MODELS) {
      if (model.license !== "CC-BY 4.0") continue;
      expect(model.attribution, model.id).toBeTruthy();
    }
  });

  it("gives every CC0 restyle-backbone model the right licence, no attribution required", () => {
    // The counterpart to the CC-BY check above: P3a's six restyle-backbone
    // models are CC0 (the same licence class every other re-styled copy in
    // this catalogue uses — Cairo's Kenney/Quaternius/KayKit sources,
    // London's reskins of them), so `attribution` may legitimately be
    // absent — only assert the licence field itself is correct.
    for (const model of TOKYO_ENV_MODELS) {
      if (model.license !== "CC0 1.0") continue;
      expect(BLOCK_PALETTE_MODEL_IDS.has(model.id), model.id).toBe(true);
    }
  });

  it("has every model licensed as either CC-BY 4.0 or CC0 1.0", () => {
    // No third license class has entered this catalogue's Tokyo rows.
    for (const model of TOKYO_ENV_MODELS) {
      expect(["CC-BY 4.0", "CC0 1.0"], model.id).toContain(model.license);
    }
  });

  it("gives every model a measured PLACEMENTS and BOUNDS entry", () => {
    // No BuildingSetId references these yet (P1/P3a are both import-only),
    // so buildingSets.ts's own missingBuildingConfigs()/
    // missingStructuralBoundsConfigs() completeness helpers can't see these
    // ids at all — they only walk SETS. This is the real import-phase
    // completeness check: every catalogued id must already have both a
    // placement config and a structural-bounds entry, correct and ready
    // for whichever later phase first references it.
    for (const model of TOKYO_ENV_MODELS) {
      const placement = buildingPlacementConfig(model.id);
      expect(placement, `${model.id} PLACEMENTS`).toBeTruthy();
      expect(placement!.scale, model.id).toBeGreaterThan(0);
      expect(placement!.footprintM, model.id).toBeGreaterThan(0);
      // depthM defaults to footprintM when omitted (several entries in this
      // catalogue — nyc-tower-a, cairo-walkup-a/b and now tokyo-walkup-a/b/
      // tokyo-tower-a — omit it deliberately for a near-square footprint),
      // so only check it when present.
      if (placement!.depthM !== undefined) {
        expect(placement!.depthM, model.id).toBeGreaterThan(0);
      }

      const bounds = buildingStructuralBoundsFor(model.id);
      expect(bounds, `${model.id} BOUNDS`).toBeTruthy();
      expect(bounds!.solids.length, model.id).toBeGreaterThan(0);
      expect(bounds!.proxyHeightM, model.id).toBeGreaterThan(0);
      for (const solid of bounds!.solids) {
        expect(solid.maxX, model.id).toBeGreaterThan(solid.minX);
        expect(solid.maxZ, model.id).toBeGreaterThan(solid.minZ);
      }
    }
  });

  it("keeps the zakkyo split ids consistent with the catalogue", () => {
    expect(TOKYO_ZAKKYO_MODEL_IDS.length).toBe(6);
    const catalogued = new Set(TOKYO_ENV_MODELS.map((m) => m.id));
    for (const id of TOKYO_ZAKKYO_MODEL_IDS) {
      expect(catalogued.has(id), id).toBe(true);
      expect(id).toMatch(/^tokyo-zakkyo-[a-f]$/);
    }
  });

  it("needs no MERGE_INCOMPATIBLE_MODEL_IDS entry for the P3a batch", () => {
    // Measured directly (NullEngine + getBuildingMaster's own merge recipe):
    // unlike three of P1's batch, none of these six hit the
    // heterogeneous-submesh-attribute Mesh.MergeMeshes crash.
    for (const id of [
      "tokyo-zakkyo-a", "tokyo-zakkyo-b", "tokyo-zakkyo-c",
      "tokyo-zakkyo-d", "tokyo-zakkyo-e", "tokyo-zakkyo-f",
      "tokyo-nippori-bldg", "tokyo-walkup-a", "tokyo-walkup-b",
      "tokyo-tower-a", "tokyo-block-slim", "tokyo-block-small",
      "tokyo-block-4story",
    ]) {
      expect(MERGE_INCOMPATIBLE_MODEL_IDS.has(id), id).toBe(false);
    }
  });

  it("keeps the Tokyo copies distinct files from every other city's models", () => {
    // modelLibrary keys asset containers by URL — one file cannot serve two
    // cities' assets. Every Tokyo url must be its own tokyo-* file.
    for (const model of TOKYO_ENV_MODELS) {
      expect(model.url, model.id).toMatch(/\/models\/props\/tokyo-[^/]+\.glb$/);
      expect(model.id, model.id).toBe(model.url.split("/").at(-1)!.replace(/\.glb$/, ""));
    }
  });
});
