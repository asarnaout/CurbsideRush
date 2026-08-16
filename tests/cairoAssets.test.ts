import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

interface CairoResidenceProvenance {
  readonly style: string;
  readonly author: string;
  readonly title: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly creatorUrl: string;
  readonly sourceSha256: string;
  readonly modifications: string;
  readonly shopfront?: string;
}

const parseGlbJson = (glb: Buffer): {
  readonly asset: {
    readonly extras?: {
      readonly curbsideRush?: CairoResidenceProvenance;
    };
  };
} => {
  expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.subarray(16, 20).toString("ascii")).toBe("JSON");
  return JSON.parse(
    glb.subarray(20, 20 + jsonLength).toString("utf8").trim(),
  );
};

describe("Cairo bundled assets", () => {
  it("ships the cleared landing art at its source dimensions under 200 KB", async () => {
    const path = resolve(root, "public", "landing", "cairo.webp");
    const [image, metadata] = await Promise.all([readFile(path), stat(path)]);

    expect(image.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(image.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(image.subarray(12, 16).toString("ascii")).toBe("VP8 ");
    const frameHeader = image.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    expect(frameHeader).toBeGreaterThan(0);
    const width = image.readUInt16LE(frameHeader + 3) & 0x3fff;
    const height = image.readUInt16LE(frameHeader + 5) & 0x3fff;
    expect({ width, height }).toEqual({ width: 1672, height: 941 });
    expect(metadata.size).toBeLessThan(200 * 1024);
  });

  it("bundles the Arabic font, licence, and offline Cairo sign usage", async () => {
    const [font, licence, css, gameCanvas, roadsideProps, credits] = await Promise.all([
      readFile(
        resolve(root, "public", "fonts", "noto-sans-arabic.woff2"),
      ),
      readFile(
        resolve(root, "public", "fonts", "NotoSansArabic-OFL.txt"),
        "utf8",
      ),
      readFile(resolve(root, "app", "globals.css"), "utf8"),
      readFile(resolve(root, "app", "game", "GameCanvas.tsx"), "utf8"),
      readFile(resolve(root, "app", "game", "render", "roadsideProps.ts"), "utf8"),
      readFile(resolve(root, "CREDITS.md"), "utf8"),
    ]);

    expect(font.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(font.byteLength).toBeGreaterThan(100_000);
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(css).toContain('font-family: "Noto Sans Arabic"');
    expect(css).toContain('url("/fonts/noto-sans-arabic.woff2")');
    expect(gameCanvas).toContain("await ensureArabicCanvasFontLoaded()");
    expect(roadsideProps).toContain("'Noto Sans Arabic'");
    expect(roadsideProps).toContain("وسط البلد");
    expect(roadsideProps).toContain("الزمالك");
    expect(credits).toContain(
      "https://fonts.gstatic.com/s/notosansarabic/v33/nwpCtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlj4wv4rqxzLIhjE.woff2",
    );
    expect(credits).toContain("downloaded 2026-07-28");
    expect(credits).toContain(
      "69cdf0bf005fdc9cc13fb5a8581697eb9ba8f761aeaf255fc717d14c62c38891",
    );
  });

  it("pins the CC0 Cairo KayKit models and their auditable provenance", async () => {
    const assets = [
      {
        file: "cairo-residence-kay.glb",
        finalSha256:
          "dc973a835af27aebf9d2f0f45a981b478d26b2219b97e2f6786c25c39ffa9e9e",
        provenance: {
          style: "cairo-residence-v1",
          author: "Kay Lousberg",
          title: "Building",
          license: "CC0-1.0",
          sourceUrl: "https://poly.pizza/m/otRsYa6pan",
          creatorUrl:
            "https://kaylousberg.com/game-assets/city-builder-bits",
          sourceSha256:
            "5ebaa83522c99c877e28b9c482aa8629226d574fa398dc91ba71430d4e38e290",
          modifications: "Cairo palette and matte material pass",
          shopfront: "cairo-shopfront-v2",
          windowGlass: "window-glass-v1",
        },
        creditNeedles: [
          "https://static.poly.pizza/1c40976f-9fd1-4779-ba85-8105d523f3d8.glb",
        ],
      },
      {
        // Cairo's own copy of shop.glb. The point of the separate file is that
        // NYC and London keep the original, stripes, hydrant and all.
        file: "cairo-shop.glb",
        finalSha256:
          "e0475bb03cf9a182f11ff29788bd977d4f085f1261f0a862f24c3edcb92ed06c",
        provenance: {
          style: "cairo-residence-v1",
          author: "Kay Lousberg",
          title: "Building",
          license: "CC0-1.0",
          sourceUrl: "https://poly.pizza/m/EL3ePInr1N",
          creatorUrl:
            "https://kaylousberg.com/game-assets/city-builder-bits",
          sourceSha256:
            "289278117dd1564c1ae190faa85c9dc309df94e45675431765e362b0b0ad36a5",
          modifications: "Cairo palette and matte material pass",
          shopfront: "cairo-shopfront-v2",
          windowGlass: "window-glass-v1",
        },
        creditNeedles: ["tools/cairo-shopfront.mjs"],
      },
      {
        file: "cairo-felucca.glb",
        finalSha256:
          "e7dcd4b5c2888dfd050698ca1e52966e1b55230dc80d1153b060cf96edfb2ab6",
        provenance: {
          style: "cairo-boat-v1",
          author: "Quaternius",
          title: "Sail Boat",
          license: "CC0-1.0",
          sourceUrl: "https://poly.pizza/m/BgSZXwmm7k",
          creatorUrl: "https://quaternius.com",
          sourceSha256:
            "dd0d959f66c058e2afcfc01227f80b83347b5105d324690596a0c0eb6e65fb95",
          modifications: "Cream lateen sail and matte material pass",
        },
        creditNeedles: ["tools/cairo-boats.mjs"],
      },
      {
        file: "cairo-skiff.glb",
        finalSha256:
          "f73cbe3bbe8f001e30d5ad78b258eb7ac6f417770773b0ba07806a44ac187472",
        provenance: {
          style: "cairo-boat-v1",
          author: "Quaternius",
          title: "Boat",
          license: "CC0-1.0",
          sourceUrl: "https://poly.pizza/m/5UEl54KsuC",
          creatorUrl: "https://quaternius.com",
          sourceSha256:
            "263e5d46f79e8b37afecd0db9056b22dc33c6456074d260589285d1891192335",
          modifications: "Matte material pass",
        },
        creditNeedles: [],
      },
      {
        file: "cairo-residence-quaternius.glb",
        finalSha256:
          "dd9e6487f6c5cb4480b4489c2e8152994e1b9d9a9efc3fd002f1b1046c9eee63",
        provenance: {
          style: "cairo-residence-v1",
          author: "Quaternius",
          title: "3Story_Balcony_Mat",
          license: "CC0-1.0",
          sourceUrl:
            "https://quaternius.com/packs/ultimatetexturedbuildings.html",
          creatorUrl: "https://quaternius.com",
          sourceSha256:
            "obj:a44feafee3fc6a6f5f891cbcdb66ad68e7114d4d379cfcae3ad5ea1fad14a345;mtl:5454773af5b796b58e33b1774ce60429098ff50c0139c6a540b23a48f6fd69eb",
          modifications: "Cairo palette and matte material pass",
        },
        creditNeedles: [
          "https://drive.google.com/drive/folders/1RE3qXhbE5yGS3t-xGFJ8GmOtTgCUF3LQ",
          "83d8959f9fc56353ed571fbe2dc52e4bcd64508e2399501cd45ac2ce3df0bf8c",
        ],
      },
    ] as const;
    const credits = await readFile(resolve(root, "CREDITS.md"), "utf8");

    for (const expected of assets) {
      const model = await readFile(
        resolve(root, "public", "models", "props", expected.file),
      );
      const json = parseGlbJson(model);
      expect(model.byteLength, expected.file).toBeLessThan(200 * 1024);
      expect(
        createHash("sha256").update(model).digest("hex"),
        expected.file,
      ).toBe(expected.finalSha256);
      expect(json.asset.extras?.curbsideRush, expected.file).toEqual(
        expected.provenance,
      );

      expect(credits).toContain(`**props/${expected.file}**`);
      expect(credits).toContain(expected.provenance.author);
      expect(credits).toContain(expected.provenance.sourceUrl);
      expect(credits).toContain(expected.finalSha256);
      expect(credits).toContain("Downloaded 2026-07-29");
      for (const sourceHash of expected.provenance.sourceSha256
        .replace(/^obj:/, "")
        .split(";mtl:")) {
        expect(credits).toContain(sourceHash);
      }
      for (const needle of expected.creditNeedles) {
        expect(credits).toContain(needle);
      }
    }
  });
});
