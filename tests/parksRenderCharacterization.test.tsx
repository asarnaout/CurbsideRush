// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization test for the park lawn/path/wall/bespoke-feature
 * builders, landed ahead of Phase 3.11's extraction (.claude/refactor-plan.md,
 * gitignored — "before each extraction with coupling >= 9, land a NullEngine
 * characterization test for that builder first"; this cargo's coupling is
 * 20). Same harness as `gameCanvasSession.test.tsx`/`cockpitCharacterization.
 * test.tsx` (see the first file's header for why each jsdom gap is worked
 * around the way it is).
 *
 * Tokyo only, not the two-city split `trafficControlCharacterization.test.tsx`
 * used: Tokyo's three temple/shrine parks (`temple_grounds` park style)
 * exercise the lawn, footpaths, the boundary wall, `court` and `torii` and
 * `lantern` bespoke features — 6 of the 9 code paths this cargo has (lawn,
 * `buildFlatPolygonMesh`-via-path... no, paths use `createRoadSurfaceMesh`;
 * the ear-clipped-polygon path is `parterre`). `parterre` and `plaza` only
 * appear on Cairo's Opera Grounds (`id.includes("opera")` in parkLayouts.ts)
 * and `plinth` only on NYC's Joan of Arc park (`id.includes("joan-of-arc")`).
 * Cairo could not be mounted here: `assertArabicCanvasFontDebug` needs the
 * canvas 2D context to actually rasterise and shape Arabic text to measure
 * ink pixels and contextual-shaping advance width, which this suite's fake
 * 2D context (no real font rendering — jsdom has none) cannot provide short
 * of building a real glyph rasterizer into the test harness. NYC was skipped
 * as disproportionate for one extra feature kind (Upper West Side is the
 * largest authored map). `parterre`/`plaza`/`plinth` are therefore
 * uncharacterized by this test — a real, acknowledged gap, not a silent one.
 *
 * The exact mesh name set below is not derived from reading the source — it
 * is what a real run of this harness produced, on the pre-extraction code,
 * for Tokyo's free drive.
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

vi.mock("../app/game/japaneseFont", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../app/game/japaneseFont")>();
  return {
    ...mod,
    ensureJapaneseCanvasFontLoaded: async () => {},
    inspectJapaneseCanvasFont: () => ({
      loaded: true,
      family: mod.JAPANESE_CANVAS_FONT_FAMILY,
      sampleWidth: 100,
      inkPixels: 1,
      source: mod.JAPANESE_CANVAS_FONT_SOURCE,
    }),
  };
});

vi.mock("../app/game/modelLibrary", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../app/game/modelLibrary")>();
  return {
    ...mod,
    preloadModels: async (
      _scene: Scene,
      _urls: readonly string[],
      onProgress?: (fraction: number) => void,
    ) => {
      onProgress?.(1);
    },
  };
});

// Park geometry is the subject here; Tokyo advertising has its own planner,
// asset, and complete-scene characterization coverage.
vi.mock("../app/game/render/tokyoAdvertising", () => ({
  buildTokyoAdvertising: () => {},
}));

import GameCanvas from "../app/game/GameCanvas";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
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

/** Every mesh belonging to Tokyo's three temple/shrine parks: the lawn
 * itself (named for the landmark id, no suffix), its footpath, boundary
 * wall runs, and the court/torii/lantern bespoke features. */
const TOKYO_PARK_LANDMARK_IDS = ["jp-temple-green", "jp-gotokuji-temple", "jp-shoin-shrine"];
const isTokyoParkMesh = (name: string) =>
  TOKYO_PARK_LANDMARK_IDS.some((id) => name === id || name.startsWith(`${id}-`));

const EXPECTED_TOKYO_PARK_MESH_NAMES = [
  "jp-gotokuji-temple",
  "jp-gotokuji-temple-court",
  "jp-gotokuji-temple-lantern-0-l-0",
  "jp-gotokuji-temple-lantern-0-l-1",
  "jp-gotokuji-temple-lantern-0-l-2",
  "jp-gotokuji-temple-lantern-0-l-3",
  "jp-gotokuji-temple-lantern-0-r-0",
  "jp-gotokuji-temple-lantern-0-r-1",
  "jp-gotokuji-temple-lantern-0-r-2",
  "jp-gotokuji-temple-lantern-0-r-3",
  "jp-gotokuji-temple-lantern-1-l-0",
  "jp-gotokuji-temple-lantern-1-l-1",
  "jp-gotokuji-temple-lantern-1-l-2",
  "jp-gotokuji-temple-lantern-1-l-3",
  "jp-gotokuji-temple-lantern-1-r-0",
  "jp-gotokuji-temple-lantern-1-r-1",
  "jp-gotokuji-temple-lantern-1-r-2",
  "jp-gotokuji-temple-lantern-1-r-3",
  "jp-gotokuji-temple-lantern-2-l-0",
  "jp-gotokuji-temple-lantern-2-l-1",
  "jp-gotokuji-temple-lantern-2-l-2",
  "jp-gotokuji-temple-lantern-2-l-3",
  "jp-gotokuji-temple-lantern-2-r-0",
  "jp-gotokuji-temple-lantern-2-r-1",
  "jp-gotokuji-temple-lantern-2-r-2",
  "jp-gotokuji-temple-lantern-2-r-3",
  "jp-gotokuji-temple-path-approach",
  "jp-gotokuji-temple-torii-beam-0",
  "jp-gotokuji-temple-torii-beam-1",
  "jp-gotokuji-temple-torii-column-l",
  "jp-gotokuji-temple-torii-column-r",
  "jp-gotokuji-temple-wall-0-0",
  "jp-gotokuji-temple-wall-1-1",
  "jp-gotokuji-temple-wall-1-2",
  "jp-gotokuji-temple-wall-2-3",
  "jp-gotokuji-temple-wall-3-4",
  "jp-shoin-shrine",
  "jp-shoin-shrine-court",
  "jp-shoin-shrine-lantern-0-l-0",
  "jp-shoin-shrine-lantern-0-l-1",
  "jp-shoin-shrine-lantern-0-l-2",
  "jp-shoin-shrine-lantern-0-l-3",
  "jp-shoin-shrine-lantern-0-r-0",
  "jp-shoin-shrine-lantern-0-r-1",
  "jp-shoin-shrine-lantern-0-r-2",
  "jp-shoin-shrine-lantern-0-r-3",
  "jp-shoin-shrine-lantern-1-l-0",
  "jp-shoin-shrine-lantern-1-l-1",
  "jp-shoin-shrine-lantern-1-l-2",
  "jp-shoin-shrine-lantern-1-l-3",
  "jp-shoin-shrine-lantern-1-r-0",
  "jp-shoin-shrine-lantern-1-r-1",
  "jp-shoin-shrine-lantern-1-r-2",
  "jp-shoin-shrine-lantern-1-r-3",
  "jp-shoin-shrine-lantern-2-l-0",
  "jp-shoin-shrine-lantern-2-l-1",
  "jp-shoin-shrine-lantern-2-l-2",
  "jp-shoin-shrine-lantern-2-l-3",
  "jp-shoin-shrine-lantern-2-r-0",
  "jp-shoin-shrine-lantern-2-r-1",
  "jp-shoin-shrine-lantern-2-r-2",
  "jp-shoin-shrine-lantern-2-r-3",
  "jp-shoin-shrine-path-approach",
  "jp-shoin-shrine-torii-beam-0",
  "jp-shoin-shrine-torii-beam-1",
  "jp-shoin-shrine-torii-column-l",
  "jp-shoin-shrine-torii-column-r",
  "jp-shoin-shrine-wall-0-0",
  "jp-shoin-shrine-wall-1-1",
  "jp-shoin-shrine-wall-1-2",
  "jp-shoin-shrine-wall-2-3",
  "jp-shoin-shrine-wall-3-4",
  "jp-temple-green",
  "jp-temple-green-court",
  "jp-temple-green-lantern-0-l-0",
  "jp-temple-green-lantern-0-l-1",
  "jp-temple-green-lantern-0-l-2",
  "jp-temple-green-lantern-0-l-3",
  "jp-temple-green-lantern-0-r-0",
  "jp-temple-green-lantern-0-r-1",
  "jp-temple-green-lantern-0-r-2",
  "jp-temple-green-lantern-0-r-3",
  "jp-temple-green-lantern-1-l-0",
  "jp-temple-green-lantern-1-l-1",
  "jp-temple-green-lantern-1-l-2",
  "jp-temple-green-lantern-1-l-3",
  "jp-temple-green-lantern-1-r-0",
  "jp-temple-green-lantern-1-r-1",
  "jp-temple-green-lantern-1-r-2",
  "jp-temple-green-lantern-1-r-3",
  "jp-temple-green-lantern-2-l-0",
  "jp-temple-green-lantern-2-l-1",
  "jp-temple-green-lantern-2-l-2",
  "jp-temple-green-lantern-2-l-3",
  "jp-temple-green-lantern-2-r-0",
  "jp-temple-green-lantern-2-r-1",
  "jp-temple-green-lantern-2-r-2",
  "jp-temple-green-lantern-2-r-3",
  "jp-temple-green-path-approach",
  "jp-temple-green-torii-beam-0",
  "jp-temple-green-torii-beam-1",
  "jp-temple-green-torii-column-l",
  "jp-temple-green-torii-column-r",
].sort();

describe("parks render characterization (Phase 3.11 safety net)", () => {
  it(
    "Tokyo: park lawn, footpath, wall and temple-grounds bespoke features",
    async () => {
      const tokyoFreeDrive = FREE_DRIVES.find((freeDrive) => freeDrive.id === "free-jp");
      const tokyoMapPack = MAP_PACKS.find((pack) => pack.id === "tokyo-setagaya");
      if (!tokyoFreeDrive || !tokyoMapPack) {
        throw new Error("Tokyo free-drive/map pack not found in content.ts");
      }
      const scenario = buildFreeDriveScenario(tokyoFreeDrive);

      render(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={tokyoMapPack}
          paused={false}
          onHudUpdate={() => {}}
        />,
      );

      await waitFor(
        () => expect(screen.queryByRole("status")).not.toBeInTheDocument(),
        { timeout: 45_000 },
      );

      const debugWindow = window as unknown as Record<string, unknown>;
      const meshes = (debugWindow.__sideswapMeshes as () => {
        n: string;
        sx: number;
        sy: number;
        sz: number;
      }[])();
      const parkMeshes = meshes.filter((mesh) => isTokyoParkMesh(mesh.n));

      expect(parkMeshes.map((mesh) => mesh.n).sort()).toEqual(
        EXPECTED_TOKYO_PARK_MESH_NAMES,
      );
      // Horizontal footprint must be real for every mesh; height may
      // legitimately be zero for the lawn/path/court ground patches (they
      // are flat by design, not a failed build), so only x/z are checked
      // uniformly here.
      for (const mesh of parkMeshes) {
        expect(mesh.sx, mesh.n).toBeGreaterThan(0);
        expect(mesh.sz, mesh.n).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});
