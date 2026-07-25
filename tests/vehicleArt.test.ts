import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VEHICLE_ART } from "../app/CareerViews";
import { CAREER_VEHICLES } from "../app/game/career";

/**
 * Width/height out of a lossy WebP's VP8 frame header — enough for these tiles,
 * which `tools/build-vehicle-art.mjs` always writes as plain lossy VP8.
 */
function webpSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.toString("latin1", 0, 4), path).toBe("RIFF");
  expect(buf.toString("latin1", 8, 12), path).toBe("WEBP");
  expect(buf.toString("latin1", 12, 16), path).toBe("VP8 ");
  return {
    width: buf.readUInt16LE(26) & 0x3fff,
    height: buf.readUInt16LE(28) & 0x3fff,
  };
}

describe("career vehicle art", () => {
  it("ships a tile for every vehicle in the catalog", () => {
    // The Record's key type already forces an entry per vehicle; what typecheck
    // cannot see is a path that points at nothing, which is silent at runtime —
    // the card just renders an empty box.
    expect(Object.keys(VEHICLE_ART).sort()).toEqual(
      CAREER_VEHICLES.map((vehicle) => vehicle.id).sort(),
    );
    for (const src of Object.values(VEHICLE_ART)) {
      expect(existsSync(`public${src}`), src).toBe(true);
    }
  });

  it("frames every tile identically", () => {
    // Two couplings ride on this. The cards are laid out with
    // `aspect-ratio: 2.6` and `object-fit: contain` (`.garage-card-art` in
    // app/globals.css), so a tile at any other ratio silently letterboxes
    // instead of filling its box; and the five only read as one lineup because
    // they share a frame. FRAME_AR in tools/build-vehicle-art.mjs is the source.
    const sizes = Object.values(VEHICLE_ART).map((src) => webpSize(`public${src}`));
    for (const { width, height } of sizes) {
      expect(width / height).toBeCloseTo(2.6, 2);
    }
    expect(new Set(sizes.map(({ width, height }) => `${width}x${height}`)).size).toBe(1);
  });
});
