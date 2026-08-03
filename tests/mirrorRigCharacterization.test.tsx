// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization test for the rear-view/wing-mirror render rig, landed
 * ahead of Phase 3.12's extraction (.claude/refactor-plan.md, gitignored —
 * "before each extraction with coupling >= 9, land a NullEngine
 * characterization test for that builder first"; this cargo's coupling is
 * 30, the highest of any Phase 3 cargo). Same harness as
 * `gameCanvasSession.test.tsx`/`cockpitCharacterization.test.tsx` (see the
 * first file's header for why each jsdom gap is worked around the way it
 * is), mounted with `cameraMode="first"` for the same reason
 * `cockpitCharacterization` does: the wing-mirror rig is parented to
 * `playerCockpit`, which starts disabled, and the debug hook this test
 * reads filters to enabled meshes only.
 *
 * London only: the mirror rig itself has no per-map variation (unlike
 * traffic control or parks) — it is built once, identically, regardless of
 * which map or lesson is active.
 *
 * The exact mesh name set and the `sx`/`sy`/`sz` non-degeneracy expectations
 * below are not derived from reading the source — they are what a real run
 * of this harness produced, on the pre-extraction code, for London's free
 * drive. `rear-view-panel` is deliberately excluded from the `sx > 0` check:
 * it is a camera-locked quad parented to `firstCamera`, and a real run shows
 * its world AABB has zero extent along one axis at this camera orientation
 * — genuine geometry, not a build failure (`sy`/`sz` are both real).
 *
 * This test also ticks the mounted session briefly and reads
 * `__sideswapPerfDebug`'s `mirrorRenders`/`mirrorCandidates`/`mirrorDrawn`
 * counters: the mesh-existence checks alone would not catch a broken
 * `gatherFrameState`/`getRenderList` wiring, since the render-target
 * `getCustomRenderList` closure only runs once Babylon's render loop is
 * actually ticking, not at construction. Exact counts aren't asserted
 * (real wall-clock timing, not fake timers), only that each is positive —
 * the mirror pipeline actually produced draws, not just meshes.
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

import GameCanvas, { type GameCanvasHandle } from "../app/game/GameCanvas";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import { LONDON_FREE_DRIVE, LONDON_MAP_PACK } from "../app/game/londonContent";

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

const EXPECTED_MIRROR_MESH_NAMES = [
  "rear-view-panel",
  "wing-mirror-arm",
  "wing-mirror-bezel",
  "wing-mirror-glass",
  "wing-mirror-sail",
  "wing-mirror-shell",
].sort();

describe("mirror rig characterization (Phase 3.12 safety net)", () => {
  it(
    "builds the rear-view and wing mirrors, and actually renders through them once ticking",
    async () => {
      const ref = createRef<GameCanvasHandle>();
      const lesson = buildFreeDriveLesson(LONDON_FREE_DRIVE, "left");

      render(
        <GameCanvas
          ref={ref}
          trafficSide="left"
          steeringSide="right"
          lesson={lesson}
          mapPack={LONDON_MAP_PACK}
          paused={false}
          cameraMode="first"
          onHudUpdate={() => {}}
        />,
      );

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
      const mirrorMeshes = meshes.filter((mesh) => /mirror|rear-view/i.test(mesh.n));

      expect(mirrorMeshes.map((mesh) => mesh.n).sort()).toEqual(
        EXPECTED_MIRROR_MESH_NAMES,
      );
      for (const mesh of mirrorMeshes) {
        if (mesh.n !== "rear-view-panel") {
          expect(mesh.sx, mesh.n).toBeGreaterThan(0);
        }
        expect(mesh.sy, mesh.n).toBeGreaterThan(0);
        expect(mesh.sz, mesh.n).toBeGreaterThan(0);
      }

      // Let the render-target refresh schedule (refreshRate 2 and 3) actually
      // fire a few times, then confirm the mirror pipeline produced draws —
      // not just that its meshes exist.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const perfDebug = (
        debugWindow.__sideswapPerfDebug as () => Record<string, number>
      )();
      expect(perfDebug.mirrorRenders).toBeGreaterThan(0);
      expect(perfDebug.mirrorCandidates).toBeGreaterThan(0);
      expect(perfDebug.mirrorDrawn).toBeGreaterThan(0);
    },
    30_000,
  );
});
