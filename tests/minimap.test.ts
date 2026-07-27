import { describe, expect, it } from "vitest";
import {
  createMinimapFitProjector,
  createMinimapFollowProjector,
  createMinimapProjector,
  createMinimapSheetProjector,
  MAP_ROAD_WIDTH_FLOOR_PX,
  MINIMAP_FOLLOW_SPAN_M,
  MINIMAP_ROUTE_WIDTH_FRACTION,
  minimapRoadFloorPx,
  projectRoadNetwork,
  resolveMapRoadWidth,
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
    // The corner widget scrolls on all of them. The whole-city map fits every
    // one of them instead, but it reaches `createMinimapFitProjector` directly
    // — asking `resolveMinimapScale` at that size buys a ~70 MB sheet.
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
    expect(resolveMapRoadWidth(10.4, pixelsPerMetre, minimapRoadFloorPx(150))).toBeCloseTo(8.7, 6);
    // The touch widget is smaller, so its floor is smaller too — the roads keep
    // the same share of the map rather than swallowing it.
    expect(resolveMapRoadWidth(10.4, pixelsPerMetre, minimapRoadFloorPx(104))).toBeCloseTo(6.032, 6);
  });

  it("lets a genuinely wide road draw wider than the floor", () => {
    // A 40 m boulevard at a close scale beats the floor and stays fatter than
    // the side street beside it.
    expect(resolveMapRoadWidth(40, 0.5, minimapRoadFloorPx(150))).toBe(20);
    expect(resolveMapRoadWidth(0, 0.5, minimapRoadFloorPx(150))).toBeCloseTo(8.7, 6);
  });

  it("keeps the route line inside the road it follows", () => {
    // The pair is the point: a GPS line as wide as the street reads as a bar
    // laid over the city rather than the way through it.
    for (const size of [150, 104]) {
      const route = size * MINIMAP_ROUTE_WIDTH_FRACTION;
      const road = resolveMapRoadWidth(10.4, 0.276, minimapRoadFloorPx(size));
      expect(route).toBeLessThan(road);
      expect(route / road).toBeCloseTo(0.55, 2);
    }
  });

  it("the widget's floor is the flat one with its share worked out", () => {
    // One implementation, two ways of naming the floor — so the widget cannot
    // drift from the whole-city map by rounding differently.
    expect(resolveMapRoadWidth(10.4, 0.276, minimapRoadFloorPx(150))).toBe(
      resolveMapRoadWidth(10.4, 0.276, 150 * 0.058),
    );
  });

  it("a flat floor is what keeps a whole-city map off one grey slab", () => {
    // Fitted NYC: 3000 m of city down ~860 px of screen. A share-of-the-canvas
    // floor would be 50 px a street here; the flat floor leaves true width in
    // charge, which is the opposite balance to the widget.
    const fitted = 860 / 3000;
    expect(resolveMapRoadWidth(10.4, fitted, MAP_ROAD_WIDTH_FLOOR_PX)).toBeCloseTo(
      10.4 * fitted,
      6,
    );
    expect(10.4 * fitted).toBeGreaterThan(MAP_ROAD_WIDTH_FLOOR_PX);
    // It still catches an alley that would otherwise vanish under a pixel.
    expect(resolveMapRoadWidth(4, fitted, MAP_ROAD_WIDTH_FLOOR_PX)).toBe(
      MAP_ROAD_WIDTH_FLOOR_PX,
    );
  });
});

describe("whole-city fit projection", () => {
  // The cities are nothing like square, and nothing like each other.
  const NYC = { x: 1080, z: 3000 };
  const MILTON_KEYNES = { x: 1500, z: 300 };

  it("fills a canvas cut to the world's own aspect", () => {
    // 1080x3000 into a panel of exactly that shape and no padding: both axes
    // land on the edges, so none of the canvas is spent on nothing. This is how
    // the whole-city map asks for it — it sizes its own canvas to the world and
    // keeps its breathing room in the layout around it.
    const height = 860;
    const width = (height * NYC.x) / NYC.z;
    const fit = createMinimapFitProjector(NYC, width, height, 0);
    expect(fit.project(0, NYC.z / 2).y).toBeCloseTo(0, 5);
    expect(fit.project(0, -NYC.z / 2).y).toBeCloseTo(height, 5);
    expect(fit.project(-NYC.x / 2, 0).x).toBeCloseTo(0, 5);
    expect(fit.project(NYC.x / 2, 0).x).toBeCloseTo(width, 5);
  });

  it("padding bites the narrow axis first on an aspect-matched canvas", () => {
    // Worth knowing before reaching for a padded fit: uniform padding is a
    // bigger share of the short side, so on a canvas already cut to the world's
    // aspect it is the *narrow* axis that ends up limiting, and the long one
    // keeps a sliver of slack. Nothing is clipped either way.
    const padding = 8;
    const height = 860;
    const width = Math.round((height * NYC.x) / NYC.z);
    const fit = createMinimapFitProjector(NYC, width, height, padding);
    expect(fit.pixelsPerMetre).toBeCloseTo((width - padding * 2) / NYC.x, 6);
    expect(fit.project(-NYC.x / 2, 0).x).toBeCloseTo(padding, 5);
    expect(fit.project(0, NYC.z / 2).y).toBeGreaterThan(padding);
  });

  it("letterboxes rather than distorts when the canvas is the wrong shape", () => {
    // Milton Keynes is 5:1 wide. Dropped into a square it keeps its aspect and
    // leaves the slack above and below — a stretched city is not a map.
    const fit = createMinimapFitProjector(MILTON_KEYNES, 600, 600, 6);
    expect(fit.pixelsPerMetre).toBeCloseTo((600 - 12) / 1500, 6);
    const north = fit.project(0, MILTON_KEYNES.z / 2);
    expect(north.y).toBeGreaterThan(6);
    expect(north.y).toBeLessThan(300);
    // Aspect preserved: a square of world is a square on screen.
    const acrossM = fit.project(100, 0).x - fit.project(0, 0).x;
    const downM = fit.project(0, 0).y - fit.project(0, 100).y;
    expect(acrossM).toBeCloseTo(downM, 6);
  });

  it("carries the scale it landed on, so roads can draw at true width", () => {
    const fit = createMinimapFitProjector(NYC, 320, 860, 8);
    expect(fit.width).toBe(320);
    expect(fit.height).toBe(860);
    expect(fit.pixelsPerMetre).toBeCloseTo((860 - 16) / 3000, 6);
    expect(fit.size).toBe(860);
  });

  it("is what the square corner projector is built from", () => {
    // `createMinimapProjector` is the square case, so the widget's geometry is
    // pinned to the same implementation the whole-city map uses.
    const square = createMinimapProjector(NYC, 150, 6);
    const fit = createMinimapFitProjector(NYC, 150, 150, 6);
    for (const [x, z] of [[0, 0], [400, -900], [-540, 1500]] as const) {
      expect(square.project(x, z)).toEqual(fit.project(x, z));
    }
    expect(square.size).toBe(fit.size);
  });
});
