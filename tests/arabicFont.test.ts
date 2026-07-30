import { describe, expect, it, vi } from "vitest";
import {
  ARABIC_CANVAS_FONT_DESCRIPTOR,
  ARABIC_CANVAS_FONT_SAMPLE,
  assertArabicCanvasFontDebug,
  ensureArabicCanvasFontLoaded,
} from "../app/game/arabicFont";

describe("Arabic canvas font readiness", () => {
  it("waits for the bundled face and verifies it before scene construction", async () => {
    const events: string[] = [];
    const fonts = {
      load: vi.fn(async (descriptor: string, sample: string) => {
        events.push(`load:${descriptor}:${sample}`);
        return [{} as FontFace];
      }),
      ready: Promise.resolve().then(() => {
        events.push("ready");
        return undefined;
      }),
      check: vi.fn((descriptor: string, sample: string) => {
        events.push(`check:${descriptor}:${sample}`);
        return true;
      }),
    } as unknown as FontFaceSet;

    await ensureArabicCanvasFontLoaded(fonts);

    expect(fonts.load).toHaveBeenCalledWith(
      ARABIC_CANVAS_FONT_DESCRIPTOR,
      ARABIC_CANVAS_FONT_SAMPLE,
    );
    expect(fonts.check).toHaveBeenCalledWith(
      ARABIC_CANVAS_FONT_DESCRIPTOR,
      ARABIC_CANVAS_FONT_SAMPLE,
    );
    expect(events[0]).toContain("load:");
    expect(events.at(-1)).toContain("check:");
  });

  it("refuses to build permanent canvas textures when the face is unavailable", async () => {
    const fonts = {
      load: vi.fn(async () => []),
      ready: Promise.resolve(),
      check: vi.fn(() => false),
    } as unknown as FontFaceSet;

    await expect(ensureArabicCanvasFontLoaded(fonts)).rejects.toThrow(
      "Unable to load the bundled Noto Sans Arabic face",
    );
    expect(fonts.load).toHaveBeenCalledTimes(3);
  });

  it("survives a transient stylesheet hot-swap without using fallback glyphs", async () => {
    let attempt = 0;
    const fonts = {
      load: vi.fn(async () => {
        attempt += 1;
        return attempt === 1 ? [] : ([{}] as FontFace[]);
      }),
      ready: Promise.resolve(),
      check: vi.fn(() => attempt > 1),
    } as unknown as FontFaceSet;

    await ensureArabicCanvasFontLoaded(fonts);

    expect(fonts.load).toHaveBeenCalledTimes(2);
    expect(fonts.check).toHaveBeenCalledTimes(1);
  });

  it("blocks scene construction when real canvas shaping proof fails", () => {
    const valid = {
      loaded: true,
      family: 'bold 84px "Noto Sans Arabic"',
      joinedLamAlefWidth: 50,
      isolatedLamAlefWidth: 80,
      contextualShapingReducedAdvance: true,
      inkPixels: 100,
      source: "/fonts/noto-sans-arabic.woff2",
    };
    expect(() => assertArabicCanvasFontDebug(valid)).not.toThrow();
    expect(() =>
      assertArabicCanvasFontDebug({
        ...valid,
        contextualShapingReducedAdvance: false,
      }),
    ).toThrow("failed canvas shaping validation");
    expect(() =>
      assertArabicCanvasFontDebug({ ...valid, inkPixels: 0 }),
    ).toThrow("failed canvas shaping validation");
  });
});
