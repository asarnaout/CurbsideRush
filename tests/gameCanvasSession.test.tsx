// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tier 1 reached (of the three the refactor plan allows — see
 * .claude/refactor-plan.md §6.2, gitignored): this mounts the REAL
 * `GameCanvas` component, over `BabylonGameSession`, over a real
 * `NullEngine`, for London's free drive — the smallest map. Nothing else in
 * the suite instantiates the session or the component; every other test that
 * touches GameCanvas.tsx imports only its pure exported geometry.
 *
 * Two jsdom gaps needed working around, neither obvious from the outside:
 *
 * 1. `NullEngine.webGLVersion` reports 1 (empirically, on the installed
 *    @babylonjs/core@9.16.1), and the session's constructor throws below 2 —
 *    so `Engine` is swapped for a thin `NullEngine` subclass that reports 2.
 *    The session constructs its own `Engine` inline and is module-private,
 *    so this is the only seam available; it needed no production change.
 * 2. jsdom implements no canvas 2D backend. Two unrelated call sites hit
 *    this: the React component's own pre-flight
 *    `document.createElement("canvas").getContext("webgl2")` gate (which
 *    runs before Babylon is ever touched), and every procedural texture
 *    Babylon's real (unmocked) `DynamicTexture` draws via
 *    `canvas.getContext("2d")` (sky, asphalt, facades — GameCanvas.tsx's
 *    band D). Both go through `HTMLCanvasElement.prototype.getContext`, so
 *    one stub on that prototype method fixes both — no need to mock
 *    `DynamicTexture` itself, and Babylon's real class keeps doing its own
 *    bookkeeping (NullEngine's `updateDynamicTexture` is already a no-op, so
 *    nothing here ever touches a GPU).
 *
 * A synchronous requestAnimationFrame stub (the pattern careerFlow.test.tsx
 * and others use) would recurse forever here: those tests mock GameCanvas
 * out at the next/dynamic layer, so Babylon's `engine.runRenderLoop` never
 * runs. This test mounts the real thing, so rAF is deferred through a real
 * `setTimeout(0)` instead — real wall-clock time in the `waitFor` calls
 * below is what actually advances the simulation's fixed-step accumulator.
 */

vi.mock("@babylonjs/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@babylonjs/core")>();
  class HeadlessEngine extends mod.NullEngine {
    // Ignores whatever (canvas, antialias, options, adaptToDeviceRatio) the
    // session passes — NullEngine's own zero-arg constructor is what makes
    // it headless.
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
import type { GameHudSnapshot } from "../app/game/sessionContract";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { LONDON_FREE_DRIVE, LONDON_MAP_PACK } from "../app/game/cities/london";

/** installDebugHooks' exact set (render/babylonGameSession.ts, `dispose()`). */
const SIDESWAP_DEBUG_HOOKS = [
  "__sideswapDriveControl",
  "__sideswapTeleport",
  "__sideswapAudioDebug",
  "__sideswapMeshes",
  "__sideswapPerfDebug",
  "__sideswapCutsceneDebug",
  "__sideswapLampDebug",
  "__sideswapEnforcementDebug",
  "__sideswapCrowdDebug",
  "__sideswapCollisionDebug",
  "__sideswapCollisionOverlay",
  "__sideswapBuildingRepresentationDebug",
  "__sideswapVisualGapReport",
  "__sideswapVisualGapOverlay",
] as const;

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

describe("BabylonGameSession smoke test", () => {
  it(
    "constructs over London's free drive, ticks, pauses, resets, and disposes cleanly",
    async () => {
      const hudSnapshots: GameHudSnapshot[] = [];
      const scenario = buildFreeDriveScenario(LONDON_FREE_DRIVE);

      const { rerender, unmount } = render(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={LONDON_MAP_PACK}
          paused={false}
          onHudUpdate={(snapshot) => hudSnapshots.push(snapshot)}
        />,
      );

      // (1) Construction end-to-end: adapter -> SimulationCore -> the full
      // buildScenarioEnvironment -> pipeline -> listeners -> debug hooks.
      // role="status" is the component's own loading overlay (separate from
      // next/dynamic's chunk-load fallback); it only clears once the session
      // has called markReady().
      await waitFor(
        () => expect(screen.queryByRole("status")).not.toBeInTheDocument(),
        { timeout: 20_000 },
      );

      const debugWindow = window as unknown as Record<string, unknown>;
      for (const hook of SIDESWAP_DEBUG_HOOKS) {
        expect(typeof debugWindow[hook], hook).toBe("function");
      }
      // Reaching "ready" only proves markReady() ran; this proves
      // buildScenarioEnvironment actually populated the scene rather than
      // silently building an empty one.
      const meshes = (debugWindow.__sideswapMeshes as () => unknown[])();
      expect(meshes.length).toBeGreaterThan(0);

      // The default (no `fan`) call is the fast raster/blob census only —
      // proves the hook reuses this session's OWN `buildingLayout` (a fresh
      // `planMapBuildings` call would still typecheck but silently audit a
      // different plan than what's on screen) end to end, without paying
      // for a real camera-fan sweep in this test.
      const report = (
        debugWindow.__sideswapVisualGapReport as (options?: {
          roadIds?: readonly string[];
          fan?: boolean;
          fullMatrix?: boolean;
        }) => {
          mapId: string;
          blobCount: number;
          qualifyingBlobCount: number;
          rayFailureCount: number;
          records: readonly unknown[];
        }
      )();
      expect(report.mapId).toBe(LONDON_MAP_PACK.id);
      expect(report.blobCount).toBeGreaterThan(0);
      expect(report.rayFailureCount).toBe(0);
      expect(report.records).toHaveLength(0);
      // No report has been fan-audited yet, so an overlay call must no-op
      // rather than throw.
      const overlayHook = debugWindow.__sideswapVisualGapOverlay as (
        id: string | null,
      ) => void;
      expect(() => overlayHook("not-a-real-failure-id")).not.toThrow();

      // A real, scoped (single, short road -> seconds not minutes) fan
      // sweep, so the overlay path is proven against an actual record's
      // geometry at least once, not just its own no-op branch.
      const fanReport = (
        debugWindow.__sideswapVisualGapReport as (options?: {
          roadIds?: readonly string[];
          fan?: boolean;
        }) => { records: readonly { failureId: string }[] }
      )({ roadIds: ["london-islington-circus"], fan: true });
      expect(fanReport.records.length).toBeGreaterThan(0);
      const meshesBeforeOverlay = meshes.length;
      expect(() => overlayHook(fanReport.records[0].failureId)).not.toThrow();
      const meshesWithOverlay = (
        debugWindow.__sideswapMeshes as () => unknown[]
      )();
      expect(meshesWithOverlay.length).toBeGreaterThan(meshesBeforeOverlay);
      expect(() => overlayHook(null)).not.toThrow();
      const meshesAfterClear = (
        debugWindow.__sideswapMeshes as () => unknown[]
      )();
      expect(meshesAfterClear.length).toBe(meshesBeforeOverlay);

      // (2) N fixed steps -> onHudUpdate snapshots with a finite pose and an
      // advancing sim clock.
      const countBeforeTicking = hudSnapshots.length;
      await waitFor(() => expect(hudSnapshots.length).toBeGreaterThan(countBeforeTicking), {
        timeout: 10_000,
      });
      const latest = hudSnapshots[hudSnapshots.length - 1];
      expect(Number.isFinite(latest.playerX)).toBe(true);
      expect(Number.isFinite(latest.playerZ)).toBe(true);
      expect(Number.isFinite(latest.heading)).toBe(true);
      expect(latest.simElapsedMs).toBeGreaterThan(0);

      // (3) A reset nonce and paused rerender both reach the session.
      rerender(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={LONDON_MAP_PACK}
          resetNonce={1}
          paused
          onHudUpdate={(snapshot) => hudSnapshots.push(snapshot)}
        />,
      );
      await waitFor(() => expect(hudSnapshots[hudSnapshots.length - 1]?.paused).toBe(true));

      // (4) dispose: every debug hook is removed. A failed glb preload (no
      // real network in this environment) must not surface as an unhandled
      // rejection — markReady runs regardless, which (1) already observed.
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const hook of SIDESWAP_DEBUG_HOOKS) {
        expect(hook in debugWindow, hook).toBe(false);
      }
    },
    // 30_000 -> 60_000: the real (single-road-scoped) `__sideswapVisualGapReport`
    // fan-sweep check added for Section 13.4's own hooks. `collectMapVisualGeometry`/
    // `buildGroundRaster` are cached on the session after their first call
    // (see `visualGapGeometryCache`), so this second call only pays for the
    // scoped fan sweep itself — back to the original ~25s baseline in
    // isolation. The bump over 30_000 is purely for parallel-suite headroom
    // (a first attempt with no caching measured 91s+ and timed out under
    // full-suite contention; this margin is deliberate, not arbitrary).
    60_000,
  );
});
