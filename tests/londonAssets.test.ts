import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LONDON_ENV_MODELS, londonEnvModelUrls } from "../app/game/buildingCatalog";

const root = process.cwd();

/**
 * Every committed byte of the London street-wall kit.
 *
 * Pinned for the same reason the Cairo and nature kits are: the three
 * `tools/style-london-*.mjs` scripts must regenerate these files exactly from
 * the recipes in their headers, so a file that differs by a byte means a tool
 * changed behaviour and the provenance recorded in CREDITS.md no longer
 * describes what ships. `tools/obj-to-glb.mjs`'s byte-stability guarantee is
 * load-bearing for the nine Quaternius conversions here, exactly as it is for
 * Cairo's.
 */
const COMMITTED_SHA256: Readonly<Record<string, string>> = {
  "london-shop.glb": "9ce866a45c5eedf8c1939bfa162b5742af9f1aceb4b3774294a322348bd585dc",
  "london-stucco-a.glb": "6a1775b3d9f9373bab3387174500c71aed692cae371aac1ce361436c2f20ee56",
  "london-stucco-b.glb": "d6f08d75c4beb8e21f74aa32e611a855883f7e5abf2e714ed266a9218b0a36a6",
  "london-stucco-c.glb": "f7574c4acb2e8cc4bb34b3ee793fa0c818d6461cffe679f90171414524ccf371",
  "london-stucco-d.glb": "b1d1684c682e39044a063d8f7bfd7c6ad4ee5e88ef5265c3254ece41843da809",
  "london-terrace-a.glb": "640b69020bbf84cc28376079619fd3d82dba87d9615d816f09d63b7004deb7e5",
  "london-terrace-b.glb": "64303d1729fa6342d5847270f09414410fef7019e05adc1ab62b1c223e6f4c66",
  "london-terrace-c.glb": "12f9f5ea8fb870f61b4616a0ec7937df778902c3e8aa24af0fae428a42f16643",
  "london-terrace-d.glb": "194994bcb7a9adac6778be430e218cbc3ba14b7d6f9d7d98e409ceda3047e414",
  "london-terrace-e.glb": "8e45a3f68615256492544332dbe9650643c99a64930be501a331a796e115e81b",
  "london-tower-a.glb": "8a7de989d38632dad453f96c0d9924bbcec00acf5fda77090fde3ce2aba4c91a",
  "london-tower-b.glb": "49c6d1317007b5bf396d4ab88041509924ceccc7ce1a11d6cf51cd9543fc54a7",
  "london-tower-c.glb": "b0ad5bc830ca8c0255734e100515d7bc02bc6ca509e40a149001ce5a62cc04cc",
  "london-walkup-a.glb": "d1793e5f6f33084444d37a44e84b6e7e02387b888a1fd567be8e662c581fdd70",
  "london-walkup-b.glb": "38726c5c65067a6ae10433191e3907fde6cfd480a304b52b14b587fba97aa08c",
};

const fileFor = (url: string) => resolve(root, "public", url.replace(/^\//, ""));

const parseGlbJson = (glb: Buffer) => {
  expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
};

describe("london street-wall kit assets", () => {
  it("ships every catalogued model, byte-pinned", async () => {
    expect(Object.keys(COMMITTED_SHA256).length).toBe(LONDON_ENV_MODELS.length);
    for (const url of londonEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const bytes = await readFile(fileFor(url));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest, file).toBe(COMMITTED_SHA256[file]);
    }
  });

  it("bakes styled provenance into every glb", async () => {
    // The style tools stamp asset.extras.curbsideRush; a kit file without the
    // stamp is a raw copy that skipped its palette pass. Styles are per-family
    // (terraces+stucco share a tool), sources are CC0, and every entry names
    // the URL its licence was verified at.
    const styleFor = (file: string) =>
      file.startsWith("london-tower")
        ? "london-towers-v1"
        : file.startsWith("london-shop") || file.startsWith("london-walkup")
          ? "london-shops-v1"
          : "london-terrace-v1";
    for (const url of londonEnvModelUrls()) {
      const file = url.split("/").at(-1)!;
      const json = parseGlbJson(await readFile(fileFor(url)));
      const provenance = json.asset?.extras?.curbsideRush;
      expect(provenance?.style, file).toBe(styleFor(file));
      expect(provenance?.license, file).toBe("CC0-1.0");
      expect(provenance?.sourceUrl, file).toContain("http");
      expect(provenance?.sourceSha256, file).toMatch(/[0-9a-f]{64}/);
    }
  });

  it("keeps the London copies distinct files from their committed sources", () => {
    // modelLibrary keys asset containers by URL — one file cannot serve two
    // cities' palettes. Every London url must be its own london-* file, never
    // a reuse of the nyc-/cairo- file it derives from.
    for (const model of LONDON_ENV_MODELS) {
      expect(model.url, model.id).toMatch(/\/models\/props\/london-[^/]+\.glb$/);
      expect(model.id, model.id).toBe(
        model.url.split("/").at(-1)!.replace(/\.glb$/, ""),
      );
    }
  });
});
