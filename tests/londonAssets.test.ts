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
  "london-shop.glb": "288b41013b87a6a5668c49f746b754dc3d1721fbd8a6a7ad52df246844dc294a",
  "london-stucco-a.glb": "6a1775b3d9f9373bab3387174500c71aed692cae371aac1ce361436c2f20ee56",
  "london-stucco-b.glb": "1574c95fbcfc5070778e8c69271d33c1feee2adce32e55151b03ab8e4cc294fd",
  "london-stucco-c.glb": "f7574c4acb2e8cc4bb34b3ee793fa0c818d6461cffe679f90171414524ccf371",
  "london-stucco-d.glb": "b1d1684c682e39044a063d8f7bfd7c6ad4ee5e88ef5265c3254ece41843da809",
  "london-terrace-a.glb": "640b69020bbf84cc28376079619fd3d82dba87d9615d816f09d63b7004deb7e5",
  "london-terrace-b.glb": "91116d70319cf1f02523ee55724e00af57d73e2e13fe0705d6e0cab495171e9b",
  "london-terrace-c.glb": "12f9f5ea8fb870f61b4616a0ec7937df778902c3e8aa24af0fae428a42f16643",
  "london-terrace-d.glb": "194994bcb7a9adac6778be430e218cbc3ba14b7d6f9d7d98e409ceda3047e414",
  "london-terrace-e.glb": "20ab00901e2ab83c0c646a6a0274f0be7d7222fdbaa9b68457f08f1315710566",
  "london-tower-a.glb": "8a7de989d38632dad453f96c0d9924bbcec00acf5fda77090fde3ce2aba4c91a",
  "london-tower-b.glb": "49c6d1317007b5bf396d4ab88041509924ceccc7ce1a11d6cf51cd9543fc54a7",
  "london-tower-c.glb": "b0ad5bc830ca8c0255734e100515d7bc02bc6ca509e40a149001ce5a62cc04cc",
  "london-walkup-a.glb": "a60938c4385d10f151ed2e54c8ef9baaf36892e99a4789d08f58efaaad8b8a44",
  "london-walkup-b.glb": "e975fa11b8e15eaa5a1e55936991cc3d1aeca4b10256d6d16442d77228ed54f1",
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
