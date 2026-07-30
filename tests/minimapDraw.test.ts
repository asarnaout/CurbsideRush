import { beforeEach, describe, expect, it } from "vitest";
import {
  createMinimapFitProjector,
  MAP_ROAD_WIDTH_FLOOR_PX,
  MINIMAP_ROUTE_WIDTH_FRACTION,
  minimapRoadFloorPx,
} from "../app/game/minimap";
import {
  drawMapOverlay,
  drawMapWaterBodies,
  drawPlayerMarker,
  drawRoadNetwork,
  minimapSymbolSizes,
  type MapSymbolSizes,
} from "../app/game/minimapDraw";

/**
 * The same recorder `minimapCanvas.test.tsx` uses, minus the React. What this
 * module produces is pixels, so the calls are the only observable output — and
 * unlike the component's fake this one carries `save`/`restore`/`setLineDash`,
 * which the detour-preview path needs and no test had ever reached.
 */
interface DrawOp {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly strokeStyle: string;
  readonly fillStyle: string;
  readonly lineWidth: number;
  readonly dash: readonly number[];
}

let ops: DrawOp[] = [];

function recordingContext(): CanvasRenderingContext2D {
  const state = { strokeStyle: "", fillStyle: "", lineWidth: 0, dash: [] as number[] };
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      ops.push({ op, args, ...state, dash: [...state.dash] });
    };
  return {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    lineJoin: "round",
    lineCap: "round",
    setLineDash: (dash: number[]) => {
      state.dash = [...dash];
      ops.push({ op: "setLineDash", args: [dash], ...state, dash: [...dash] });
    },
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    closePath: record("closePath"),
    fill: record("fill"),
    stroke: record("stroke"),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  ops = [];
});

const WORLD = { x: 1000, z: 1000 };
const strokesAt = (color: string) =>
  ops.filter((entry) => entry.op === "stroke" && entry.strokeStyle === color);
const arcsAt = (color: string) =>
  ops.filter((entry) => entry.op === "arc" && entry.fillStyle === color);

/** A square fit at a known scale, so every expected pixel is hand-computable. */
const projector = () => createMinimapFitProjector(WORLD, 200, 200, 0);

function overlay(overrides: Partial<Parameters<typeof drawMapOverlay>[1]> = {}) {
  drawMapOverlay(recordingContext(), {
    projector: projector(),
    symbols: minimapSymbolSizes(150),
    ...overrides,
  });
}

function player(overrides: Partial<Parameters<typeof drawPlayerMarker>[1]> = {}) {
  drawPlayerMarker(recordingContext(), {
    projector: projector(),
    symbols: minimapSymbolSizes(150),
    playerX: 0,
    playerZ: 0,
    heading: 0,
    ...overrides,
  });
}

describe("the widget's symbol sizes", () => {
  it("are the fractions of its own edge the minimap has always drawn", () => {
    const at150 = minimapSymbolSizes(150);
    expect(at150.routeWidthPx).toBeCloseTo(150 * MINIMAP_ROUTE_WIDTH_FRACTION, 9);
    expect(at150.destinationRadiusPx).toBeCloseTo(150 * 0.042, 9);
    expect(at150.playerHaloRadiusPx).toBeCloseTo(150 * 0.075, 9);
    expect(at150.playerNosePx).toBeCloseTo(150 * 0.055, 9);
  });

  it("shrink with the widget, but never below the floors that keep them visible", () => {
    const tiny = minimapSymbolSizes(20);
    expect(tiny.routeWidthPx).toBe(2);
    expect(tiny.playerHaloRadiusPx).toBe(8);
    expect(tiny.playerNosePx).toBe(5);
  });

  it("are an input, not a rule — which is the whole reason they are named", () => {
    // Scaling the widget's fractions to a full screen gives a 27px route line
    // laid across the city. A whole-city map hands in its own numbers instead.
    expect(minimapSymbolSizes(860).routeWidthPx).toBeGreaterThan(25);
    const own: MapSymbolSizes = { ...minimapSymbolSizes(150), routeWidthPx: 3.5 };
    overlay({ symbols: own, route: [{ x: 0, z: 0 }, { x: 0, z: 200 }] });
    expect(strokesAt("#f2c658")[0].lineWidth).toBe(3.5);
  });
});

describe("the road network pass", () => {
  const ROADS = [
    { centerline: [{ x: -400, z: 0 }, { x: 400, z: 0 }], widthM: 10.4 },
    { centerline: [{ x: 0, z: 0 }], widthM: 10.4 },
  ];

  it("strokes each road once and skips a degenerate one", () => {
    drawRoadNetwork(recordingContext(), ROADS, projector(), 0.2, MAP_ROAD_WIDTH_FLOOR_PX);
    const strokes = ops.filter((entry) => entry.op === "stroke");
    expect(strokes).toHaveLength(1);
    // 10.4 m at 0.2 px/m is 2.08 px — over the flat floor, so true width wins.
    expect(strokes[0].lineWidth).toBeCloseTo(2.08, 6);
  });

  it("takes the floor it is handed, which is what the two surfaces differ on", () => {
    drawRoadNetwork(recordingContext(), ROADS, projector(), 0.2, minimapRoadFloorPx(150));
    expect(ops.filter((entry) => entry.op === "stroke")[0].lineWidth).toBeCloseTo(8.7, 6);
  });
});

describe("the water pass", () => {
  it("fills each Nile polygon at projected coordinates and skips degenerates", () => {
    drawMapWaterBodies(
      recordingContext(),
      [
        {
          color: "#24738c",
          polygon: [
            { x: -100, z: -200 },
            { x: 100, z: -200 },
            { x: 100, z: 200 },
            { x: -100, z: 200 },
          ],
        },
        { color: "#000000", polygon: [{ x: 0, z: 0 }] },
      ],
      projector(),
    );
    const fill = ops.filter((entry) => entry.op === "fill");
    expect(fill).toHaveLength(1);
    expect(fill[0].fillStyle).toBe("#24738c");
    expect(ops.filter((entry) => entry.op === "lineTo")).toHaveLength(3);
    expect(ops.filter((entry) => entry.op === "closePath")).toHaveLength(1);
  });
});

describe("the overlay pass", () => {
  it("draws no route line when there is no destination", () => {
    overlay();
    expect(strokesAt("#f2c658")).toHaveLength(0);
  });

  it("ignores a degenerate route rather than stroking a dot", () => {
    overlay({ route: [{ x: 0, z: 0 }] });
    expect(strokesAt("#f2c658")).toHaveLength(0);
  });

  it("dashes the detour preview and caps it with a hollow ring", () => {
    // Never covered before the drawing moved out of the component: the widget's
    // recorder had no `save`/`setLineDash`, so any test touching this threw.
    overlay({ previewRoute: [{ x: 0, z: 0 }, { x: 0, z: 200 }, { x: 200, z: 200 }] });
    const preview = strokesAt("rgba(250,243,228,0.85)");
    // One dashed polyline, then the ring — both in the preview's own colour.
    expect(preview).toHaveLength(2);
    expect(preview[0].dash).toEqual([...minimapSymbolSizes(150).previewDashPx]);
    // The ring is solid, so it reads as a place rather than more dashes.
    expect(preview[1].dash).toEqual([]);
    expect(ops.filter((entry) => entry.op === "save")).toHaveLength(1);
    expect(ops.filter((entry) => entry.op === "restore")).toHaveLength(1);
  });

  it("puts the preview under the committed route, not over it", () => {
    overlay({
      previewRoute: [{ x: 0, z: 0 }, { x: 0, z: 200 }],
      route: [{ x: 0, z: 0 }, { x: 200, z: 0 }],
    });
    const firstPreview = ops.findIndex(
      (entry) => entry.op === "stroke" && entry.strokeStyle === "rgba(250,243,228,0.85)",
    );
    const firstRoute = ops.findIndex(
      (entry) => entry.op === "stroke" && entry.strokeStyle === "#f2c658",
    );
    expect(firstPreview).toBeGreaterThanOrEqual(0);
    expect(firstPreview).toBeLessThan(firstRoute);
  });

  it("draws the destination as a ringed pin, the only marker on the canvas", () => {
    // Everything else a map marks is a DOM icon above the canvas, which is what
    // keeps the one place the player is going the only round thing on it.
    overlay({ destination: { x: -200, z: 300, color: "#e0533f" } });
    const disc = arcsAt("#e0533f");
    expect(disc).toHaveLength(1);
    const radius = disc[0].args[2] as number;
    const eye = arcsAt("rgba(255,255,255,0.92)");
    expect(eye[0].args[2]).toBeCloseTo(radius * 0.38, 9);
    expect(eye[0].args[0]).toBeCloseTo(disc[0].args[0] as number, 9);
  });

  it("points the player arrow along the heading", () => {
    // Heading +pi/2 is due east: the nose sits right of the car, level with it.
    player({ heading: Math.PI / 2 });
    const nose = ops.filter((entry) => entry.op === "moveTo").at(-1);
    expect(nose?.args[0] as number).toBeCloseTo(100 + minimapSymbolSizes(150).playerNosePx, 9);
    expect(nose?.args[1] as number).toBeCloseTo(100, 9);
  });

  it("leaves the car out entirely, so the icons above cannot bury it", () => {
    // The place icons are DOM over this canvas, so anything drawn here is
    // behind them. The car goes on a canvas of its own, stacked above the
    // icons — an enforcement camera sits at a third of New York's junctions,
    // and on the corner widget the car is always dead centre.
    overlay({
      route: [{ x: 0, z: 0 }, { x: 0, z: 200 }],
      destination: { x: 0, z: 200, color: "#e0533f" },
    });
    expect(arcsAt("rgba(242, 198, 88, 0.20)")).toHaveLength(0);
    expect(arcsAt("#e0533f")).toHaveLength(1);
  });

  it("draws the car and nothing else on its own pass", () => {
    player();
    expect(arcsAt("rgba(242, 198, 88, 0.20)")).toHaveLength(1);
    // One filled triangle: three points, closed.
    expect(ops.filter((entry) => entry.op === "closePath")).toHaveLength(1);
    expect(ops.filter((entry) => entry.op === "stroke")).toHaveLength(0);
  });
});
