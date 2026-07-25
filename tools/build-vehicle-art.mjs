/**
 * Builds the Career garage's vehicle card art from studio renders of the five
 * career vehicles.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The garage shipped with a line-art glyph and an "Artwork soon" note in place
 * of each vehicle (issue #178). The renders that replace it are ultra-wide
 * (2172x724) studio shots with the subject floating near the middle of a large
 * vignetted backdrop, so a raw drop-in wastes most of the card on empty
 * background and every vehicle lands at a different size. This script does the
 * framing once, at asset time, so the card CSS stays a plain `object-fit`.
 *
 * WHAT IT DOES
 * ------------
 * For each render:
 *   1. Measures the vehicle's bounding box. The backdrop is a dark vignette
 *      plus film grain, so a median filter kills the grain and the subject is
 *      then whatever is either strongly saturated (SAT_FLOOR — the backdrop
 *      tops out near 0.35, bodywork sits at 0.8+) or far brighter than that
 *      row's vignette (headlights, chrome, the bicycle's spokes). A per-column
 *      and per-row hit floor discards the last of the speckle.
 *   2. Crops to one shared aspect ratio (FRAME_AR) sized so the vehicle fills
 *      FILL_H of the frame's height — or FILL_W of its width, whichever binds
 *      first. Height-normalising is what makes the five read as a lineup:
 *      every vehicle is drawn at the same scale, so the cars come out long and
 *      the two-wheelers come out small, which is also true of the real things.
 *      The crop is centred on the bounding box and nudged down by BIAS_Y so the
 *      contact shadow stays under the wheels.
 *   3. Feathers the frame's outer edge to CARD_BG — the exact background of
 *      `.garage-card-art`. The card box changes aspect ratio between the
 *      desktop grid and the mobile banner, so the art is drawn with
 *      `object-fit: contain` and letterboxes by different amounts at different
 *      widths; without the feather, the crop's cut edge (which sits mid-glow,
 *      not on black) shows as a seam against the card.
 *
 * REPRODUCE
 *   node tools/build-vehicle-art.mjs ~/Downloads        # -> public/vehicles
 *   node tools/build-vehicle-art.mjs ~/Downloads --dry  # report only
 * Expects `<key>-display.png` per SOURCES entry in the input directory. Output
 * is deterministic, so re-running against the same renders is a no-op.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

/**
 * Render basename (`<key>-display.png`) -> the `CareerVehicleId` it becomes.
 * `flop` mirrors the render horizontally: the three cars were shot nose-left and
 * the two-wheelers nose-right, and a row of cards where one vehicle faces the
 * other way reads as a mistake. The backdrop is near enough symmetric that
 * mirroring it costs nothing.
 */
const SOURCES = {
  bike: { id: "bicycle", flop: true },
  motorbike: { id: "motorbike", flop: true },
  sedan: { id: "compact-hatch", flop: false },
  van: { id: "delivery-van", flop: false },
  "sports-car": { id: "sport-sedan", flop: false },
};

const OUT_DIR = "public/vehicles";
/** Must track `.garage-card-art`'s background in app/globals.css. */
const CARD_BG = [12, 18, 20];
const FRAME_AR = 2.6;
const FILL_H = 0.84;
const FILL_W = 0.88;
const BIAS_Y = 0.02;
/** 2x the widest card the desktop grid can produce (1380px page / 5 columns). */
const OUT_W = 640;
const OUT_H = Math.round(OUT_W / FRAME_AR);
const FEATHER_X = 0.035;
const FEATHER_Y = 0.05;

const SAT_FLOOR = 0.55;
/** Below this, a saturated pixel is vignette noise rather than bodywork. */
const VALUE_FLOOR = 55;
/** Sum-of-channels headroom over the row's vignette that reads as a highlight. */
const BRIGHT_OVER_BG = 185;
const HIT_FLOOR = 6;

const inputDir = (process.argv[2] ?? "~/Downloads").replace(/^~/, os.homedir());
const dry = process.argv.includes("--dry");

/** Smoothstep-ish 0..1, so the feather has no visible banding. */
const ramp = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(t, 0), 1));

/**
 * The vehicle's bounding box in `buf` (raw RGB, grain already filtered out).
 * Sampled every other pixel — the subject is ~1000px across, so half
 * resolution costs nothing and quarters the work.
 */
function measureSubject(buf, width, height) {
  const cols = new Int32Array(width);
  const rows = new Int32Array(height);
  const edge = new Int32Array(100);
  for (let y = 0; y < height; y += 2) {
    // This row's vignette brightness, from the always-empty left edge.
    for (let x = 0; x < 100; x += 1) {
      const i = (y * width + x) * 3;
      edge[x] = buf[i] + buf[i + 1] + buf[i + 2];
    }
    const bg = edge.slice().sort((a, b) => a - b)[50];
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 3;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const mx = Math.max(r, g, b);
      const sat = mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
      if ((sat > SAT_FLOOR && mx > VALUE_FLOOR) || r + g + b > bg + BRIGHT_OVER_BG) {
        cols[x] += 1;
        rows[y] += 1;
      }
    }
  }
  const span = (counts) => {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i] >= HIT_FLOOR) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    return [lo, hi];
  };
  const [x0, x1] = span(cols);
  const [y0, y1] = span(rows);
  if (x0 < 0 || y0 < 0) throw new Error("no subject found — check the thresholds");
  return { x0, x1, y0, y1 };
}

/** The crop rect that frames `box` per FRAME_AR/FILL_*, clamped to the render. */
function frameFor(box, width, height) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const cw = Math.min(Math.max((bh / FILL_H) * FRAME_AR, bw / FILL_W), width);
  const ch = Math.min(cw / FRAME_AR, height);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2 + ch * BIAS_Y;
  return {
    left: Math.round(Math.min(Math.max(cx - cw / 2, 0), width - cw)),
    top: Math.round(Math.min(Math.max(cy - ch / 2, 0), height - ch)),
    width: Math.round(cw),
    height: Math.round(ch),
  };
}

/** Blends the outer edge of raw RGB `buf` to CARD_BG, in place. */
function featherEdges(buf) {
  const fx = FEATHER_X * OUT_W;
  const fy = FEATHER_Y * OUT_H;
  for (let y = 0; y < OUT_H; y += 1) {
    const wy = ramp(Math.min(y, OUT_H - 1 - y) / fy);
    for (let x = 0; x < OUT_W; x += 1) {
      const w = wy * ramp(Math.min(x, OUT_W - 1 - x) / fx);
      if (w >= 0.999) continue;
      const i = (y * OUT_W + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        buf[i + c] = Math.round(buf[i + c] * w + CARD_BG[c] * (1 - w));
      }
    }
  }
}

if (!dry) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [key, { id: vehicleId, flop }] of Object.entries(SOURCES)) {
  const src = path.join(inputDir, `${key}-display.png`);
  if (!fs.existsSync(src)) throw new Error(`missing render: ${src}`);

  // Mirror before measuring, so the crop rect is in the coordinates it is used in.
  const oriented = () => (flop ? sharp(src).removeAlpha().flop() : sharp(src).removeAlpha());

  const filtered = await oriented().median(5).raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = filtered.info;
  const box = measureSubject(filtered.data, width, height);
  const frame = frameFor(box, width, height);

  const framed = await oriented()
    .extract(frame)
    .resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  featherEdges(framed);

  const out = path.join(OUT_DIR, `${vehicleId}.webp`);
  const webp = await sharp(framed, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .webp({ quality: 88, effort: 6 })
    .toBuffer();
  if (!dry) fs.writeFileSync(out, webp);

  const fillW = ((box.x1 - box.x0) / frame.width) * 100;
  const fillH = ((box.y1 - box.y0) / frame.height) * 100;
  console.log(
    `${vehicleId.padEnd(14)} crop ${frame.width}x${frame.height} at ` +
      `(${frame.left},${frame.top})  fills ${fillW.toFixed(0)}%w ${fillH.toFixed(0)}%h  ` +
      `${(webp.length / 1024).toFixed(1)} KB${dry ? " (dry)" : ""}`,
  );
}
