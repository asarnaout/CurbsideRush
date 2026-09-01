/**
 * Tokyo advertising copy is rasterised once into Babylon DynamicTextures.
 * Await the self-hosted subset before scene construction so Japanese glyphs
 * never become permanent tofu boxes or platform-dependent fallback shapes.
 */
export const JAPANESE_CANVAS_FONT_FAMILY = "Noto Sans JP";
export const JAPANESE_CANVAS_FONT_SAMPLE = "今日をはじけよう 街の光 音楽 夜";
export const JAPANESE_CANVAS_FONT_DESCRIPTOR =
  `800 84px "${JAPANESE_CANVAS_FONT_FAMILY}"`;
export const JAPANESE_CANVAS_FONT_SOURCE =
  "/fonts/noto-sans-jp-tokyo-ads.woff2";

export interface JapaneseCanvasFontDebug {
  readonly loaded: boolean;
  readonly family: string;
  readonly sampleWidth: number;
  readonly inkPixels: number;
  readonly source: string;
}

export function assertJapaneseCanvasFontDebug(
  debug: JapaneseCanvasFontDebug,
): void {
  if (!debug.loaded || debug.sampleWidth <= 0 || debug.inkPixels <= 0) {
    throw new Error(
      `Bundled ${JAPANESE_CANVAS_FONT_FAMILY} failed canvas validation.`,
    );
  }
}

export async function ensureJapaneseCanvasFontLoaded(
  fonts: FontFaceSet | undefined =
    typeof document === "undefined" ? undefined : document.fonts,
): Promise<void> {
  if (!fonts) throw new Error("The browser Font Loading API is unavailable.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loadedFaces = await fonts.load(
      JAPANESE_CANVAS_FONT_DESCRIPTOR,
      JAPANESE_CANVAS_FONT_SAMPLE,
    );
    await fonts.ready;
    if (
      loadedFaces.length > 0 &&
      fonts.check(JAPANESE_CANVAS_FONT_DESCRIPTOR, JAPANESE_CANVAS_FONT_SAMPLE)
    ) {
      return;
    }
    if (attempt < 2) {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    }
  }
  throw new Error(
    `Unable to load the bundled ${JAPANESE_CANVAS_FONT_FAMILY} face.`,
  );
}

export function inspectJapaneseCanvasFont(
  doc: Document = document,
): JapaneseCanvasFontDebug {
  const canvas = doc.createElement("canvas");
  canvas.width = 900;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a 2D canvas for Japanese font validation.");
  }
  context.font = JAPANESE_CANVAS_FONT_DESCRIPTOR;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const sampleWidth = context.measureText(JAPANESE_CANVAS_FONT_SAMPLE).width;
  context.fillStyle = "#fff";
  context.fillText(JAPANESE_CANVAS_FONT_SAMPLE, 20, 115);
  const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let inkPixels = 0;
  for (let index = 3; index < alpha.length; index += 4) {
    if (alpha[index] > 0) inkPixels += 1;
  }
  return {
    loaded: doc.fonts.check(
      JAPANESE_CANVAS_FONT_DESCRIPTOR,
      JAPANESE_CANVAS_FONT_SAMPLE,
    ),
    family: context.font,
    sampleWidth,
    inkPixels,
    source: JAPANESE_CANVAS_FONT_SOURCE,
  };
}
