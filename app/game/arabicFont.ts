/**
 * Canvas and Babylon DynamicTexture text is rasterised immediately. Unlike DOM
 * text it cannot repaint itself when a webfont finishes loading, so Cairo must
 * wait for the self-hosted Arabic face before it constructs the scene.
 */
export const ARABIC_CANVAS_FONT_FAMILY = "Noto Sans Arabic";
export const ARABIC_CANVAS_FONT_SAMPLE = "وسط البلد الزمالك مصر شرطة";
export const ARABIC_CANVAS_FONT_DESCRIPTOR =
  `700 84px "${ARABIC_CANVAS_FONT_FAMILY}"`;
export const ARABIC_CANVAS_FONT_SOURCE = "/fonts/noto-sans-arabic.woff2";

export interface ArabicCanvasFontDebug {
  readonly loaded: boolean;
  readonly family: string;
  readonly joinedLamAlefWidth: number;
  readonly isolatedLamAlefWidth: number;
  readonly contextualShapingReducedAdvance: boolean;
  readonly inkPixels: number;
  readonly source: string;
}

export function assertArabicCanvasFontDebug(
  debug: ArabicCanvasFontDebug,
): void {
  if (
    !debug.loaded ||
    !debug.contextualShapingReducedAdvance ||
    debug.inkPixels <= 0
  ) {
    throw new Error(
      `Bundled ${ARABIC_CANVAS_FONT_FAMILY} failed canvas shaping validation.`,
    );
  }
}

export async function ensureArabicCanvasFontLoaded(
  fonts: FontFaceSet | undefined =
    typeof document === "undefined" ? undefined : document.fonts,
): Promise<void> {
  if (!fonts) {
    throw new Error("The browser Font Loading API is unavailable.");
  }

  // Vite swaps the stylesheet node during a CSS hot update. A Cairo session
  // rebuilt in that tiny interval can briefly observe no declared face even
  // though the bundled file is present. A bounded retry also makes the launch
  // gate resilient to a late stylesheet parse without ever falling through to
  // a system font and permanently rasterising the wrong glyphs.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loadedFaces = await fonts.load(
      ARABIC_CANVAS_FONT_DESCRIPTOR,
      ARABIC_CANVAS_FONT_SAMPLE,
    );
    await fonts.ready;
    if (
      loadedFaces.length > 0 &&
      fonts.check(ARABIC_CANVAS_FONT_DESCRIPTOR, ARABIC_CANVAS_FONT_SAMPLE)
    ) {
      return;
    }
    if (attempt < 2) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40);
      });
    }
  }

  throw new Error(
    `Unable to load the bundled ${ARABIC_CANVAS_FONT_FAMILY} face.`,
  );
}

/** Browser-only proof that the loaded face rasterises and shapes Arabic. */
export function inspectArabicCanvasFont(
  doc: Document = document,
): ArabicCanvasFontDebug {
  const canvas = doc.createElement("canvas");
  canvas.width = 800;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a 2D canvas for Arabic font validation.");
  }
  context.direction = "rtl";
  context.textAlign = "right";
  context.font = ARABIC_CANVAS_FONT_DESCRIPTOR;
  const joinedLamAlefWidth = context.measureText("لا").width;
  const isolatedLamAlefWidth =
    context.measureText("ل").width + context.measureText("ا").width;
  context.fillStyle = "#fff";
  context.fillText("وسط البلد", 760, 110);
  const alpha = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  let inkPixels = 0;
  for (let index = 3; index < alpha.length; index += 4) {
    if (alpha[index] > 0) inkPixels += 1;
  }
  return {
    loaded: doc.fonts.check(
      ARABIC_CANVAS_FONT_DESCRIPTOR,
      ARABIC_CANVAS_FONT_SAMPLE,
    ),
    family: context.font,
    joinedLamAlefWidth,
    isolatedLamAlefWidth,
    contextualShapingReducedAdvance:
      joinedLamAlefWidth < isolatedLamAlefWidth - 0.1,
    inkPixels,
    source: ARABIC_CANVAS_FONT_SOURCE,
  };
}
