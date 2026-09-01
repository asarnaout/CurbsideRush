import { describe, expect, it, vi } from "vitest";
import {
  JAPANESE_CANVAS_FONT_DESCRIPTOR,
  JAPANESE_CANVAS_FONT_SAMPLE,
  assertJapaneseCanvasFontDebug,
  ensureJapaneseCanvasFontLoaded,
} from "../app/game/japaneseFont";

describe("Japanese canvas font readiness", () => {
  it("waits for the bundled face and verifies it before scene construction", async () => {
    const fonts = {
      load: vi.fn(async () => [{} as FontFace]),
      ready: Promise.resolve(),
      check: vi.fn(() => true),
    } as unknown as FontFaceSet;

    await ensureJapaneseCanvasFontLoaded(fonts);

    expect(fonts.load).toHaveBeenCalledWith(
      JAPANESE_CANVAS_FONT_DESCRIPTOR,
      JAPANESE_CANVAS_FONT_SAMPLE,
    );
    expect(fonts.check).toHaveBeenCalledWith(
      JAPANESE_CANVAS_FONT_DESCRIPTOR,
      JAPANESE_CANVAS_FONT_SAMPLE,
    );
  });

  it("retries a transient stylesheet swap without baking fallback glyphs", async () => {
    let attempt = 0;
    const fonts = {
      load: vi.fn(async () => {
        attempt += 1;
        return attempt === 1 ? [] : ([{}] as FontFace[]);
      }),
      ready: Promise.resolve(),
      check: vi.fn(() => attempt > 1),
    } as unknown as FontFaceSet;

    await ensureJapaneseCanvasFontLoaded(fonts);

    expect(fonts.load).toHaveBeenCalledTimes(2);
    expect(fonts.check).toHaveBeenCalledTimes(1);
  });

  it("refuses to build permanent copy textures when the face is unavailable", async () => {
    const fonts = {
      load: vi.fn(async () => []),
      ready: Promise.resolve(),
      check: vi.fn(() => false),
    } as unknown as FontFaceSet;

    await expect(ensureJapaneseCanvasFontLoaded(fonts)).rejects.toThrow(
      "Unable to load the bundled Noto Sans JP face",
    );
    expect(fonts.load).toHaveBeenCalledTimes(3);
  });

  it("blocks scene construction when the canvas proof has no real ink", () => {
    const valid = {
      loaded: true,
      family: '800 84px "Noto Sans JP"',
      sampleWidth: 500,
      inkPixels: 1_000,
      source: "/fonts/noto-sans-jp-tokyo-ads.woff2",
    };
    expect(() => assertJapaneseCanvasFontDebug(valid)).not.toThrow();
    expect(() =>
      assertJapaneseCanvasFontDebug({ ...valid, loaded: false }),
    ).toThrow("failed canvas validation");
    expect(() =>
      assertJapaneseCanvasFontDebug({ ...valid, inkPixels: 0 }),
    ).toThrow("failed canvas validation");
  });
});
