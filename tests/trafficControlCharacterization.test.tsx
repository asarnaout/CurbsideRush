// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization test for the signal/camera/railway-crossing/road-marking
 * installation builders, landed ahead of Phase 3.9's extraction
 * (.claude/refactor-plan.md, gitignored — "before each extraction with
 * coupling >= 9, land a NullEngine characterization test for that builder
 * first"; this cargo's coupling is 14). Same harness as
 * `gameCanvasSession.test.tsx`/`cockpitCharacterization.test.tsx` (see the
 * first file's header for why each jsdom gap is worked around the way it
 * is).
 *
 * Two cities, not one: no single shipped map exercises every installation
 * style. London (uk_signal, both road-marking submodes — crosswalk AND
 * box_junction, the only city with the latter) and Tokyo (japan_railway,
 * the only style London has none of) together cover signal heads, cameras,
 * railway crossings and both road-marking kinds. Not covered by any shipped
 * map: nyc_signal and egypt_signal (style-only variants of the same signal
 * builder London already exercises — NYC's own grid is large enough that
 * mounting it would make this test slow for redundant coverage).
 *
 * The exact mesh name sets below are not derived from reading the source —
 * they are what a real run of this harness produced, on the pre-extraction
 * code, for each city's free drive. Names ending in `-stop-line` are
 * deliberately excluded from the filter below: those come from a separate,
 * inline per-approach loop in `buildScenarioEnvironment` that is not part
 * of this cargo and stays behind, even though it happens to share a name
 * prefix with these installations (both key off the same control id).
 */

vi.mock("@babylonjs/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@babylonjs/core")>();
  class HeadlessEngine extends mod.NullEngine {
    constructor() {
      super();
    }
    get webGLVersion() {
      return 2;
    }
  }
  return { ...mod, Engine: HeadlessEngine };
});

import GameCanvas from "../app/game/GameCanvas";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { LONDON_FREE_DRIVE, LONDON_MAP_PACK } from "../app/game/cities/london";
import { FREE_DRIVES, MAP_PACKS } from "../app/game/content";

function createFake2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const sized = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4),
  });
  const context = {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    textAlign: "start",
    textBaseline: "alphabetic",
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width: number, height: number) => sized(width, height),
    getImageData: (_x: number, _y: number, width: number, height: number) => sized(width, height),
    putImageData: noop,
  };
  return context as unknown as CanvasRenderingContext2D;
}

const installLocalStorage = () => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
};

const desktopMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }) as unknown as MediaQueryList;

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
const pendingRaf = new Set<ReturnType<typeof setTimeout>>();

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(desktopMatchMedia));
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = setTimeout(() => {
      pendingRaf.delete(handle);
      callback(performance.now());
    }, 0);
    pendingRaf.add(handle);
    return handle as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    pendingRaf.delete(handle as unknown as ReturnType<typeof setTimeout>);
  });

  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...args: unknown[]
  ) {
    if (type === "webgl2") return {} as unknown as WebGL2RenderingContext;
    if (type === "2d") return createFake2dContext(this);
    return originalGetContext.apply(this, [type, ...args] as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  for (const handle of pendingRaf) clearTimeout(handle);
  pendingRaf.clear();
  vi.unstubAllGlobals();
});

/** Signal heads (pole/housing/lens triplet), enforcement cameras,
 * railway-crossing furniture, crosswalk stripes and box-junction markings —
 * everything this cargo builds. Excludes the inline stop-line meshes (see
 * file header) even though several share a name prefix with these. */
const TRAFFIC_CONTROL_MESH_PATTERN =
  /signal|camera-|crossbuck|rail-pole|barrier|stripe|box-edge|box-hatch|portal/i;
const isTrafficControlMesh = (name: string) =>
  TRAFFIC_CONTROL_MESH_PATTERN.test(name) && !name.endsWith("-stop-line");

const EXPECTED_LONDON_TRAFFIC_CONTROL_MESH_NAMES = [
  "crosswalk-stripe-master",
  "london-box-cromwell-exhibition-london-box-marking-box-edge-0",
  "london-box-cromwell-exhibition-london-box-marking-box-edge-1",
  "london-box-cromwell-exhibition-london-box-marking-box-edge-2",
  "london-box-cromwell-exhibition-london-box-marking-box-edge-3",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch--2",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch--5",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch--8",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch-1",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch-4",
  "london-box-cromwell-exhibition-london-box-marking-box-hatch-7",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-0",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-1",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-2",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-3",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-4",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-5",
  "london-crosswalk-museum-london-museum-crosswalk-marking-stripe-6",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-0",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-1",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-2",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-3",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-4",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-5",
  "london-crosswalk-quiet-london-quiet-crosswalk-marking-stripe-6",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-0",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-1",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-2",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-3",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-4",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-5",
  "london-crosswalk-thurloe-london-thurloe-crosswalk-marking-stripe-6",
  "london-signal-cromwell-exhibition-london-exhibition-primary-amber",
  "london-signal-cromwell-exhibition-london-exhibition-primary-green",
  "london-signal-cromwell-exhibition-london-exhibition-primary-housing",
  "london-signal-cromwell-exhibition-london-exhibition-primary-pole",
  "london-signal-cromwell-exhibition-london-exhibition-primary-red",
  "london-signal-cromwell-exhibition-london-exhibition-secondary-amber",
  "london-signal-cromwell-exhibition-london-exhibition-secondary-green",
  "london-signal-cromwell-exhibition-london-exhibition-secondary-housing",
  "london-signal-cromwell-exhibition-london-exhibition-secondary-pole",
  "london-signal-cromwell-exhibition-london-exhibition-secondary-red",
  "london-signal-queen-gate-cromwell-london-cromwell-west-primary-amber",
  "london-signal-queen-gate-cromwell-london-cromwell-west-primary-green",
  "london-signal-queen-gate-cromwell-london-cromwell-west-primary-housing",
  "london-signal-queen-gate-cromwell-london-cromwell-west-primary-pole",
  "london-signal-queen-gate-cromwell-london-cromwell-west-primary-red",
  "london-signal-queen-gate-cromwell-london-cromwell-west-secondary-amber",
  "london-signal-queen-gate-cromwell-london-cromwell-west-secondary-green",
  "london-signal-queen-gate-cromwell-london-cromwell-west-secondary-housing",
  "london-signal-queen-gate-cromwell-london-cromwell-west-secondary-pole",
  "london-signal-queen-gate-cromwell-london-cromwell-west-secondary-red",
  "london-signal-queen-gate-cromwell-london-queen-gate-primary-amber",
  "london-signal-queen-gate-cromwell-london-queen-gate-primary-green",
  "london-signal-queen-gate-cromwell-london-queen-gate-primary-housing",
  "london-signal-queen-gate-cromwell-london-queen-gate-primary-pole",
  "london-signal-queen-gate-cromwell-london-queen-gate-primary-red",
  "london-signal-queen-gate-cromwell-london-queen-gate-secondary-amber",
  "london-signal-queen-gate-cromwell-london-queen-gate-secondary-green",
  "london-signal-queen-gate-cromwell-london-queen-gate-secondary-housing",
  "london-signal-queen-gate-cromwell-london-queen-gate-secondary-pole",
  "london-signal-queen-gate-cromwell-london-queen-gate-secondary-red",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-cromwell-west-primary",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-cromwell-west-primary-lens",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-queen-gate-primary",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-queen-gate-primary-lens",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-queen-gate-secondary",
  "prop-traffic-camera-london-signal-queen-gate-cromwell-london-queen-gate-secondary-lens",
  "signal-lens-master",
].sort();

const EXPECTED_TOKYO_TRAFFIC_CONTROL_MESH_NAMES = [
  "crosswalk-stripe-master",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-0",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-1",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-2",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-3",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-4",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-5",
  "jp-crosswalk-station-jp-station-crosswalk-marking-stripe-6",
  "jp-rail-signal-jp-rail-east-crossing-barrier",
  "jp-rail-signal-jp-rail-east-crossing-crossbuck--0.63",
  "jp-rail-signal-jp-rail-east-crossing-crossbuck-0.63",
  "jp-rail-signal-jp-rail-east-crossing-rail-pole",
  "jp-rail-signal-jp-rail-east-crossing-warning--1",
  "jp-rail-signal-jp-rail-east-crossing-warning-1",
  "jp-rail-signal-jp-rail-west-crossing-barrier",
  "jp-rail-signal-jp-rail-west-crossing-crossbuck--0.63",
  "jp-rail-signal-jp-rail-west-crossing-crossbuck-0.63",
  "jp-rail-signal-jp-rail-west-crossing-rail-pole",
  "jp-rail-signal-jp-rail-west-crossing-warning--1",
  "jp-rail-signal-jp-rail-west-crossing-warning-1",
  "signal-lens-master",
].sort();

async function mountAndCollectTrafficControlMeshes(
  element: React.ReactElement,
): Promise<{ n: string; sx: number; sy: number; sz: number }[]> {
  render(element);
  await waitFor(
    () => expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    { timeout: 20_000 },
  );
  const debugWindow = window as unknown as Record<string, unknown>;
  const meshes = (debugWindow.__sideswapMeshes as () => {
    n: string;
    sx: number;
    sy: number;
    sz: number;
  }[])();
  return meshes.filter((mesh) => isTrafficControlMesh(mesh.n));
}

describe("traffic control characterization (Phase 3.9 safety net)", () => {
  it(
    "London: signal heads, cameras, crosswalk stripes, box-junction markings",
    async () => {
      const scenario = buildFreeDriveScenario(LONDON_FREE_DRIVE);
      const meshes = await mountAndCollectTrafficControlMeshes(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={LONDON_MAP_PACK}
          paused={false}
          onHudUpdate={() => {}}
        />,
      );

      expect(meshes.map((mesh) => mesh.n).sort()).toEqual(
        EXPECTED_LONDON_TRAFFIC_CONTROL_MESH_NAMES,
      );
      for (const mesh of meshes) {
        expect(mesh.sx, mesh.n).toBeGreaterThan(0);
        expect(mesh.sy, mesh.n).toBeGreaterThan(0);
        expect(mesh.sz, mesh.n).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  it(
    "Tokyo: railway crossings, crosswalk stripes",
    async () => {
      const tokyoFreeDrive = FREE_DRIVES.find((freeDrive) => freeDrive.id === "free-jp");
      const tokyoMapPack = MAP_PACKS.find((pack) => pack.id === "tokyo-setagaya");
      if (!tokyoFreeDrive || !tokyoMapPack) {
        throw new Error("Tokyo free-drive/map pack not found in content.ts");
      }
      const scenario = buildFreeDriveScenario(tokyoFreeDrive);
      const meshes = await mountAndCollectTrafficControlMeshes(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={tokyoMapPack}
          paused={false}
          onHudUpdate={() => {}}
        />,
      );

      expect(meshes.map((mesh) => mesh.n).sort()).toEqual(
        EXPECTED_TOKYO_TRAFFIC_CONTROL_MESH_NAMES,
      );
      for (const mesh of meshes) {
        expect(mesh.sx, mesh.n).toBeGreaterThan(0);
        expect(mesh.sy, mesh.n).toBeGreaterThan(0);
        expect(mesh.sz, mesh.n).toBeGreaterThan(0);
      }
    },
    30_000,
  );
});
