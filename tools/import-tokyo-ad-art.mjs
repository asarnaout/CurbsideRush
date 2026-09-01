import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const CREATIVE_SLUGS = [
  "city-in-motion",
  "hello-tomorrow",
  "noodle-rush",
  "clear-morning",
  "sound-up",
  "blue-dream",
  "run-light",
  "happy-paws",
  "sweet-color",
  "window-journey",
  "turn-the-page",
  "make-a-mark",
  "season-in-bloom",
  "catch-the-city",
  "quiet-green",
  "ride-light",
  "play-next-story",
  "new-horizon",
  "coffee-break",
  "city-color",
  "meet-in-color",
  "mascot-parade",
  "beauty-in-bloom",
  "night-train",
  "table-of-color",
  "light-in-motion",
  "room-to-play",
  "summer-sky",
];

const PORTRAIT_COUNT = 20;
const PORTRAIT_CELL = { width: 384, height: 576 };
const LANDSCAPE_CELL = { width: 768, height: 432 };

const inputs = process.argv.slice(2);
if (inputs.length !== CREATIVE_SLUGS.length) {
  throw new Error(
    `Expected ${CREATIVE_SLUGS.length} ordered source images, received ${inputs.length}.`,
  );
}

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "art-source", "tokyo", "fictional-ads");
const publicDir = resolve(root, "public", "art", "tokyo");
await Promise.all([
  mkdir(sourceDir, { recursive: true }),
  mkdir(publicDir, { recursive: true }),
]);

const normalized = [];
for (const [index, input] of inputs.entries()) {
  const cell = index < PORTRAIT_COUNT ? PORTRAIT_CELL : LANDSCAPE_CELL;
  const output = resolve(
    sourceDir,
    `${String(index + 1).padStart(2, "0")}-${CREATIVE_SLUGS[index]}.webp`,
  );
  await sharp(resolve(input))
    .resize(cell.width, cell.height, { fit: "cover", position: "centre" })
    .webp({ quality: 88, effort: 6 })
    .toFile(output);
  normalized.push(output);
}

async function makeAtlas({
  paths,
  columns,
  cell,
  outputName,
}) {
  const rows = Math.ceil(paths.length / columns);
  const background = {
    r: 3,
    g: 5,
    b: 14,
    alpha: 1,
  };
  const composites = paths.map((input, index) => ({
    input,
    left: (index % columns) * cell.width,
    top: Math.floor(index / columns) * cell.height,
  }));
  await sharp({
    create: {
      width: columns * cell.width,
      height: rows * cell.height,
      channels: 4,
      background,
    },
  })
    .composite(composites)
    .webp({ quality: 88, effort: 6 })
    .toFile(resolve(publicDir, outputName));
}

await makeAtlas({
  paths: normalized.slice(0, PORTRAIT_COUNT),
  columns: 4,
  cell: PORTRAIT_CELL,
  outputName: "fictional-ad-portrait-atlas-v2.webp",
});
await makeAtlas({
  paths: normalized.slice(PORTRAIT_COUNT),
  columns: 4,
  cell: LANDSCAPE_CELL,
  outputName: "fictional-ad-landscape-atlas-v2.webp",
});

console.log(`Imported ${normalized.length} Tokyo ad creatives.`);
