// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "../app/game/MinimapCanvas";
import {
  MINIMAP_ROUTE_WIDTH_FRACTION,
  minimapRoadFloorPx,
  resolveMapRoadWidth,
  resolveMinimapScale,
} from "../app/game/minimap";

afterEach(cleanup);

/**
 * jsdom implements no canvas at all, so every drawing call has to land
 * somewhere. A recorder standing in for the 2D context is enough — and it is
 * the only way to see this component's output, since what it produces is
 * pixels rather than DOM. Same tactic `driveAudioScheduling.test.ts` uses on
 * the Web Audio context.
 */
interface DrawOp {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly strokeStyle: string;
  readonly fillStyle: string;
  readonly lineWidth: number;
}

let ops: DrawOp[] = [];

function createRecordingContext(): CanvasRenderingContext2D {
  const state = { strokeStyle: "", fillStyle: "", lineWidth: 0 };
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      ops.push({ op, args, ...state });
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
    clearRect: record("clearRect"),
    drawImage: record("drawImage"),
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => createRecordingContext() as never,
  );
});

const WORLD = { x: 1080, z: 3000 };
const SIZE = 150;
// A crossroads, so the raster has something to stroke.
const ROADS = [
  { centerline: [{ x: -400, z: 0 }, { x: 400, z: 0 }], widthM: 10.4 },
  // Wider than any real carriageway, purely to exercise the branch where true
  // width beats the floor — at the shipped span nothing authored does.
  { centerline: [{ x: 0, z: -400 }, { x: 0, z: 400 }], widthM: 90 },
];

function renderMap(overrides: Partial<Parameters<typeof Minimap>[0]> = {}) {
  return render(
    <Minimap
      worldSize={WORLD}
      roadSurfaces={ROADS}
      playerX={0}
      playerZ={0}
      heading={0}
      size={SIZE}
      {...overrides}
    />,
  );
}

const strokesAt = (color: string) =>
  ops.filter((entry) => entry.op === "stroke" && entry.strokeStyle === color);
const arcsAt = (color: string) =>
  ops.filter((entry) => entry.op === "arc" && entry.fillStyle === color);

describe("minimap drawing", () => {
  it("strokes roads at their own width, floored so none is a hairline", () => {
    renderMap();
    const scale = resolveMinimapScale(WORLD, SIZE);
    const roadStrokes = ops.filter(
      (entry) => entry.op === "stroke" && entry.strokeStyle.startsWith("rgba(170"),
    );
    expect(roadStrokes).toHaveLength(2);
    // Every authored street is under the floor and takes it — that is the
    // normal case, and the reason the grid is legible at all.
    expect(roadStrokes[0].lineWidth).toBeCloseTo(
      resolveMapRoadWidth(10.4, scale.pixelsPerMetre, minimapRoadFloorPx(SIZE)),
      6,
    );
    expect(roadStrokes[0].lineWidth).toBeCloseTo(SIZE * 0.058, 6);
    // The absurdly wide one clears the floor and draws to scale instead.
    expect(roadStrokes[1].lineWidth).toBeCloseTo(90 * scale.pixelsPerMetre, 6);
    expect(roadStrokes[1].lineWidth).toBeGreaterThan(roadStrokes[0].lineWidth);
  });

  it("draws no route line when there is no destination", () => {
    renderMap();
    expect(strokesAt("#f2c658")).toHaveLength(0);
  });

  it("draws the route as one path, narrower than the road it follows", () => {
    renderMap({
      route: [
        { x: 0, z: 0 },
        { x: 0, z: 120 },
        { x: 90, z: 120 },
      ],
    });
    const route = strokesAt("#f2c658");
    expect(route).toHaveLength(1);
    expect(route[0].lineWidth).toBeCloseTo(SIZE * MINIMAP_ROUTE_WIDTH_FRACTION, 6);
    const scale = resolveMinimapScale(WORLD, SIZE);
    expect(route[0].lineWidth).toBeLessThan(
      resolveMapRoadWidth(10.4, scale.pixelsPerMetre, minimapRoadFloorPx(SIZE)),
    );
    // One moveTo and a lineTo per remaining point — not a path per segment.
    const lineTos = ops.filter((entry) => entry.op === "lineTo");
    expect(lineTos.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a degenerate route rather than stroking a dot", () => {
    renderMap({ route: [{ x: 0, z: 0 }] });
    expect(strokesAt("#f2c658")).toHaveLength(0);
  });

  it("draws the destination as a ringed pin and everything else as a dot", () => {
    renderMap({
      pins: [
        { x: 40, z: 40, color: "#5bbf6a" },
        { x: -60, z: 90, color: "#e0533f", kind: "destination" },
      ],
    });
    // The gas station: a single small dot.
    const dot = arcsAt("#5bbf6a");
    expect(dot).toHaveLength(1);
    expect(dot[0].args[2]).toBe(3);
    // The destination: a coloured disc with a white eye inside it.
    const disc = arcsAt("#e0533f");
    expect(disc).toHaveLength(1);
    const radius = disc[0].args[2] as number;
    expect(radius).toBeCloseTo(Math.max(4, SIZE * 0.042), 6);
    expect(radius).toBeGreaterThan(3);
    const eye = arcsAt("rgba(255,255,255,0.92)");
    expect(eye).toHaveLength(1);
    expect(eye[0].args[2]).toBeCloseTo(radius * 0.38, 6);
    // Concentric, so it reads as one marker.
    expect(eye[0].args[0]).toBeCloseTo(disc[0].args[0] as number, 6);
    expect(eye[0].args[1]).toBeCloseTo(disc[0].args[1] as number, 6);
  });

  it("points the player arrow along the heading, scaled to the widget", () => {
    renderMap({ heading: Math.PI / 2 });
    const arrow = ops.filter((entry) => entry.op === "moveTo").at(-1);
    const centre = SIZE / 2;
    // Heading +pi/2 is due east: the nose sits right of centre, level with it.
    expect(arrow?.args[0] as number).toBeCloseTo(centre + SIZE * 0.055, 6);
    expect(arrow?.args[1] as number).toBeCloseTo(centre, 6);
    // The halo is behind it, centred on the car.
    const halo = arcsAt("rgba(242, 198, 88, 0.20)");
    expect(halo).toHaveLength(1);
    expect(halo[0].args[0]).toBeCloseTo(centre, 6);
    expect(halo[0].args[2]).toBeCloseTo(Math.max(8, SIZE * 0.075), 6);
  });

  it("keeps its proportions on the smaller touch widget", () => {
    renderMap({ size: 104, route: [{ x: 0, z: 0 }, { x: 0, z: 120 }] });
    expect(strokesAt("#f2c658")[0].lineWidth).toBeCloseTo(
      104 * MINIMAP_ROUTE_WIDTH_FRACTION,
      6,
    );
    expect(arcsAt("rgba(242, 198, 88, 0.20)")[0].args[2]).toBeCloseTo(
      Math.max(8, 104 * 0.075),
      6,
    );
  });
});
