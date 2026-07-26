import { describe, expect, it } from "vitest";
import {
  createMinimapFollowProjector,
  createMinimapProjector,
  createMinimapSheetProjector,
  MINIMAP_FOLLOW_SPAN_M,
  MINIMAP_ROUTE_WIDTH_FRACTION,
  projectRoadNetwork,
  resolveMinimapRoadWidth,
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
    const small = resolveMinimapScale({ x: 300, z: 420 }, size, padding);
    const big = resolveMinimapScale({ x: 1080, z: 2900 }, size, padding);
    // A world that fits is still drawn whole...
    expect(small.follows).toBe(false);
    expect(small.pixelsPerMetre).toBeCloseTo((size - padding * 2) / 420, 9);
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

  it("projects road centrelines to polylines, carrying the width along", () => {
    const projector = createMinimapProjector({ x: 100, z: 100 }, 100, 0);
    const lines = projectRoadNetwork(
      [{ centerline: [{ x: -50, z: 0 }, { x: 50, z: 0 }], widthM: 10.4 }],
      projector,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].points).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(lines[0].widthM).toBe(10.4);
  });

  it("every shipped city is past the follow span", () => {
    // The widget scrolls on all of them, so the fitted branch is a fallback
    // rather than a path any drive takes. If a map ever lands under the span
    // again this is the reminder that both branches are live.
    for (const [name, worldSize] of [
      ["nyc", { x: 1080, z: 3000 }],
      ["milton keynes", { x: 1500, z: 300 }],
      ["london", { x: 800, z: 540 }],
      ["calais", { x: 680, z: 300 }],
      ["tokyo", { x: 600, z: 420 }],
    ] as const) {
      expect(resolveMinimapScale(worldSize, 150).follows, name).toBe(true);
    }
  });
});

describe("minimap road width", () => {
  it("floors thin streets so the grid reads as roads, not hairlines", () => {
    // NYC's follow scale on a 150 px widget: a 10.4 m street is ~2.9 px true,
    // under the floor, so it draws at the floor instead.
    const pixelsPerMetre = (150 - 12) / MINIMAP_FOLLOW_SPAN_M;
    expect(10.4 * pixelsPerMetre).toBeLessThan(150 * 0.058);
    expect(resolveMinimapRoadWidth(10.4, pixelsPerMetre, 150)).toBeCloseTo(8.7, 6);
    // The touch widget is smaller, so its floor is smaller too — the roads keep
    // the same share of the map rather than swallowing it.
    expect(resolveMinimapRoadWidth(10.4, pixelsPerMetre, 104)).toBeCloseTo(6.032, 6);
  });

  it("lets a genuinely wide road draw wider than the floor", () => {
    // A 40 m boulevard at a close scale beats the floor and stays fatter than
    // the side street beside it.
    expect(resolveMinimapRoadWidth(40, 0.5, 150)).toBe(20);
    expect(resolveMinimapRoadWidth(0, 0.5, 150)).toBeCloseTo(8.7, 6);
  });

  it("keeps the route line inside the road it follows", () => {
    // The pair is the point: a GPS line as wide as the street reads as a bar
    // laid over the city rather than the way through it.
    for (const size of [150, 104]) {
      const route = size * MINIMAP_ROUTE_WIDTH_FRACTION;
      const road = resolveMinimapRoadWidth(10.4, 0.276, size);
      expect(route).toBeLessThan(road);
      expect(route / road).toBeCloseTo(0.55, 2);
    }
  });
});
