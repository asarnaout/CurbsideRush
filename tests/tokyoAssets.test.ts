import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKYO_ENV_MODELS, tokyoEnvModelUrls } from "../app/game/buildingCatalog";
import { buildingPlacementConfig } from "../app/game/buildingSets";
import { buildingStructuralBoundsFor } from "../app/game/buildingStructuralBounds";
import { parseGlb } from "../tools/pack-gltf.mjs";

const root = process.cwd();

/**
 * Every committed byte of the Tokyo street-wall kit (Tokyo authenticity plan
 * phase P1 — 13 Sketchfab imports: houses, apāto, konbini, shotengai shops,
 * an izakaya and a ramen shop).
 *
 * Pinned for the same reason London's kit is: `tools/pack-gltf.mjs` (the
 * glTF->glb packer) and `tools/style-tokyo-buildings.mjs` (the normalization
 * pass) must regenerate these files exactly from the recipes documented in
 * their own headers, so a file that differs by a byte means a tool changed
 * behaviour and the provenance recorded in CREDITS.md no longer describes
 * what ships.
 */
const COMMITTED_SHA256: Readonly<Record<string, string>> = {
  "tokyo-house-a.glb": "c88e4970840a6f19ba8752f5289a87be80b3bae452e647445d5815b4940e131f",
  "tokyo-house-b.glb": "6b8e20e0b733da3616640485e52ddc49e9b77dbb024c1d55c38a62537ea15def",
  "tokyo-house-c.glb": "0c0e4eaa7fcdbae349ef9cb2a8041cbcdf28d863162494fe440619864d9b1fee",
  "tokyo-house-d.glb": "1c1f2e79417cf8b5b2ab5779f8cbac7424cf764b981d30f1af0a58f798fb177f",
  "tokyo-apato-a.glb": "80dd62de4789d5f2798def067073e3f5f4751308ca9b2d9f6057d053c687d157",
  "tokyo-apato-b.glb": "db408a486fd98a1551d84c5fd92f6ea9881ae3d491046b16bd2b8eb52576f433",
  "tokyo-konbini.glb": "3abc6babc8f48dd605cd5f8cf0d21f04b6a64e9da101e9761626ddd24554f53e",
  "tokyo-shop-a.glb": "e8405c3f5e13850436d6e2cc09f847cc40031513f8b1d884165210917c6265cc",
  "tokyo-shop-b.glb": "6f301e6fdccf79607a645dbf9cd9b131c2708769a7f8b9a6c9a09f4f6fced172",
  "tokyo-shop-c.glb": "8090b33f73ffc9ec049bec181d0dbe25fc7acc338c748c518f77223f81cdc41b",
  "tokyo-shop-d.glb": "1607578094db7934beb28ded8e2fc7a56978fc13792f090103e5ea63c8e59528",
  "tokyo-izakaya.glb": "deb7798951e5d8004b6adf3ff121fed339189544af49e29e8137f0a83a883d10",
  "tokyo-ramen.glb": "50e13b3dd3eea88705bbf6372a768a26ddd82e2a185f0204c848fa7c3fec2cbe",
};

const fileFor = (url: string) => resolve(root, "public", url.replace(/^\//, ""));

const parseGlbJson = (glb: Buffer) => {
  expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
};

describe("Tokyo street-wall kit assets (P1 — import only)", () => {
  it("has exactly 13 catalogued models", () => {
    // Pins the plan's P1 scope: houses a-d, apato a-b, konbini, shops a-d,
    // izakaya, ramen. The zakkyo pack, gas station and Nippori hero are
    // later phases (P3/P7) and must not appear here yet.
    expect(TOKYO_ENV_MODELS.length).toBe(13);
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

  it("bakes styled provenance into every glb", async () => {
    for (const url of tokyoEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const json = parseGlbJson(await readFile(fileFor(url)));
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

  it("gives every model a required CC-BY attribution string", () => {
    for (const model of TOKYO_ENV_MODELS) {
      expect(model.license).toBe("CC-BY 4.0");
      expect(model.attribution, model.id).toBeTruthy();
    }
  });

  it("gives every model a measured PLACEMENTS and BOUNDS entry", () => {
    // No BuildingSetId references these yet (P1 is import-only), so
    // buildingSets.ts's own missingBuildingConfigs()/
    // missingStructuralBoundsConfigs() completeness helpers can't see these
    // ids at all — they only walk SETS. This is the real P1-scoped
    // completeness check: every catalogued id must already have both a
    // placement config and a structural-bounds entry, correct and ready
    // for whichever later phase first references it.
    for (const model of TOKYO_ENV_MODELS) {
      const placement = buildingPlacementConfig(model.id);
      expect(placement, `${model.id} PLACEMENTS`).toBeTruthy();
      expect(placement!.scale, model.id).toBeGreaterThan(0);
      expect(placement!.footprintM, model.id).toBeGreaterThan(0);
      expect(placement!.depthM, model.id).toBeGreaterThan(0);

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

  it("keeps the Tokyo copies distinct files from every other city's models", () => {
    // modelLibrary keys asset containers by URL — one file cannot serve two
    // cities' assets. Every Tokyo url must be its own tokyo-* file.
    for (const model of TOKYO_ENV_MODELS) {
      expect(model.url, model.id).toMatch(/\/models\/props\/tokyo-[^/]+\.glb$/);
      expect(model.id, model.id).toBe(model.url.split("/").at(-1)!.replace(/\.glb$/, ""));
    }
  });
});
