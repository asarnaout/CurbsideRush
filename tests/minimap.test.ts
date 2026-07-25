import { describe, expect, it } from "vitest";
import {
  createMinimapFollowProjector,
  createMinimapProjector,
  createMinimapSheetProjector,
  MINIMAP_FOLLOW_SPAN_M,
  projectRoadNetwork,
  resolveMinimapScale,
} from "../app/game/minimap";

describe("minimap projection", () => {
  it("maps the world origin to the canvas centre", () => {
    const projector = createMinimapProjector({ x: 640, z: 960 }, 150);
    expect(projector.project(0, 0)).toEqual({ x: 75, y: 75 });
  });

  it("fits the map inside the padded canvas and flips north to up", () => {
    const size = 150;
    const padding = 6;
    const projector = createMinimapProjector({ x: 640, z: 960 }, size, padding);
    // The larger dimension (z = 960) drives the scale; its extremes land on the
    // padded top and bottom edges, north (+z) at the top.
    expect(projector.project(0, 480).y).toBeCloseTo(padding, 5);
    expect(projector.project(0, -480).y).toBeCloseTo(size - padding, 5);
    // +x sits right of centre.
    expect(projector.project(320, 0).x).toBeGreaterThan(75);
    // Every corner stays inside the canvas.
    for (const [x, z] of [
      [320, 480],
      [-320, -480],
      [320, -480],
      [-320, 480],
    ] as const) {
      const point = projector.project(x, z);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(size);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(size);
    }
  });

  it("keeps streets the same size once a world outgrows the widget", () => {
    const size = 150;
    const padding = 6;
    const small = resolveMinimapScale({ x: 640, z: 960 }, size, padding);
    const big = resolveMinimapScale({ x: 1080, z: 2900 }, size, padding);
    // A world that fits is still drawn whole...
    expect(small.follows).toBe(false);
    expect(small.pixelsPerMetre).toBeCloseTo((size - padding * 2) / 960, 9);
    // ...and one that does not keeps the scale rather than shrinking to fit,
    // which is the whole point: a third-scale grid is unreadable.
    expect(big.follows).toBe(true);
    expect(big.pixelsPerMetre).toBeCloseTo(
      (size - padding * 2) / MINIMAP_FOLLOW_SPAN_M,
      9,
    );
    expect(big.pixelsPerMetre).toBeGreaterThan(
      (size - padding * 2) / 2900,
    );
  });

  it("centres the follow window on the player and keeps north up", () => {
    const projector = createMinimapFollowProjector(200, -50, 0.5, 150);
    expect(projector.project(200, -50)).toEqual({ x: 75, y: 75 });
    // 40 m east is +x on screen; 40 m north is up, so -y.
    expect(projector.project(240, -50)).toEqual({ x: 95, y: 75 });
    expect(projector.project(200, -10)).toEqual({ x: 75, y: 55 });
  });

  it("sizes the sheet to hold the whole world plus a window's overhang", () => {
    const margin = 75;
    const sheet = createMinimapSheetProjector({ x: 1000, z: 2000 }, 0.2, margin);
    expect(sheet.width).toBe(1000 * 0.2 + margin * 2);
    expect(sheet.height).toBe(2000 * 0.2 + margin * 2);
    // Corners land inside, so a window centred anywhere in the world blits
    // real pixels instead of running off the sheet.
    expect(sheet.project(-500, 1000)).toEqual({ x: margin, y: margin });
    expect(sheet.project(500, -1000)).toEqual({
      x: sheet.width - margin,
      y: sheet.height - margin,
    });
  });

  it("projects road centrelines to polylines", () => {
    const projector = createMinimapProjector({ x: 100, z: 100 }, 100, 0);
    const lines = projectRoadNetwork(
      [{ centerline: [{ x: -50, z: 0 }, { x: 50, z: 0 }] }],
      projector,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
  });
});
