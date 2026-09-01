import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "art-source", "tokyo", "fictional-ads");

const ATLASES = [
  {
    file: "fictional-ad-portrait-atlas-v2.webp",
    width: 1_536,
    height: 2_880,
    sha256: "46617caa2634553390fb4dbfdbbc35396bc48b2db809b9a158c674c225d14174",
  },
  {
    file: "fictional-ad-landscape-atlas-v2.webp",
    width: 3_072,
    height: 864,
    sha256: "4bf5e7d58ae479b4e880cf86d77f4f7903bc547a51db1643a76f2d2d16d158df",
  },
] as const;

describe("Tokyo advertising image assets", () => {
  it("keeps all 28 editable source creatives at the authored cell sizes", async () => {
    const files = (await readdir(SOURCE_DIR))
      .filter((file) => file.endsWith(".webp"))
      .sort();
    expect(files).toHaveLength(28);
    const hashes = new Set<string>();
    for (const [index, file] of files.entries()) {
      const bytes = await readFile(path.join(SOURCE_DIR, file));
      const metadata = await sharp(bytes).metadata();
      expect(
        [metadata.width, metadata.height],
        file,
      ).toEqual(index < 20 ? [384, 576] : [768, 432]);
      hashes.add(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(hashes.size).toBe(28);
  });

  it("pins the mechanically-built runtime atlases", async () => {
    for (const expected of ATLASES) {
      const bytes = await readFile(
        path.join(ROOT, "public", "art", "tokyo", expected.file),
      );
      const metadata = await sharp(bytes).metadata();
      expect([metadata.width, metadata.height], expected.file).toEqual([
        expected.width,
        expected.height,
      ]);
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        expected.file,
      ).toBe(expected.sha256);
    }
  });

  it("pins the self-hosted Japanese copy font", async () => {
    const bytes = await readFile(
      path.join(ROOT, "public", "fonts", "noto-sans-jp-tokyo-ads.woff2"),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "7bb82e2a2d3d83f34dafe10f0a34a192caedb3684d52d9144876dc2edb5b084e",
    );
  });
});
