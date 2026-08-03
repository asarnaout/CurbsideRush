// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization test for `buildCockpit`/`mergeCockpitStatics`, landed
 * ahead of Phase 3.7's extraction (.claude/refactor-plan.md, gitignored —
 * "before each extraction with coupling >= 9, land a NullEngine
 * characterization test for that builder first"). Same harness as
 * `gameCanvasSession.test.tsx` (see that file's header for why each jsdom
 * gap is worked around the way it is) but with `cameraMode="first"`, since
 * `playerCockpit` starts disabled (`applyCameraStack` only enables it in
 * first person) and the debug hook this test reads filters to enabled
 * meshes only — the default `gameCanvasSession.test.tsx` mount exercises
 * `buildCockpit` (it runs unconditionally at construction) but never
 * observes its output.
 *
 * The exact mesh name set below is not derived from reading the source —
 * it is what a real run of this harness produced, on the pre-extraction
 * code, London free drive. In particular, `mergeCockpitStatics` only
 * inspects `playerCockpit.getChildMeshes(true)` — direct descendants only
 * — so the steering assembly and instrument cluster (parented several
 * levels deeper, under `steeringMount`/`steeringAssembly`/`clusterRoot`)
 * never enter its merge groups and stay as individually named meshes,
 * while the dash/trim/vent-shadow parts hung directly off `playerCockpit`
 * collapse into one `cockpit-merged-<material>` mesh each. A change to the
 * parenting depth of any cockpit part would silently change which bucket
 * it falls into — this test is what catches that.
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
import type { GameHudSnapshot } from "../app/game/sessionContract";
import { buildFreeDriveLesson } from "../app/game/freeDriveLesson";
import { LONDON_FREE_DRIVE, LONDON_MAP_PACK } from "../app/game/cities/london";

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

/** The exact name set a real run produces today, sorted. Order-independent
 * by construction (sorted before comparison) since build order isn't the
 * invariant under test — the merge/parenting outcome is. */
const EXPECTED_COCKPIT_MESH_NAMES = [
  "cockpit-hood",
  "cockpit-merged-cockpit-trim",
  "cockpit-merged-cockpit-vent-shadow",
  "cockpit-merged-dashboard",
  "instrument-cluster-face",
  "instrument-cluster-shell",
  "instrument-needle-0",
  "instrument-needle-1",
  "instrument-status",
  "steering-column-shroud",
  "steering-emblem",
  "steering-hub",
  "steering-wheel",
  "wheel-lower-spoke",
  "wheel-spoke--1",
  "wheel-spoke-1",
  "windscreen-band",
  "windscreen-glass",
  "windscreen-wiper--1",
  "windscreen-wiper-1",
].sort();

describe("cockpit characterization (Phase 3.7 safety net)", () => {
  it(
    "builds and merges the first-person cabin into the expected mesh set",
    async () => {
      const hudSnapshots: GameHudSnapshot[] = [];
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
          onHudUpdate={(snapshot) => hudSnapshots.push(snapshot)}
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
      const cockpitMeshes = meshes.filter((mesh) =>
        /^(cockpit|windscreen|instrument|steering|wheel-)/.test(mesh.n),
      );

      expect(cockpitMeshes.map((mesh) => mesh.n).sort()).toEqual(
        EXPECTED_COCKPIT_MESH_NAMES,
      );
      // Every merged/unmerged part carries real geometry, not a degenerate
      // (zero-extent) placeholder — the practical guard for the UV/merge
      // trap rendering.md documents (a mesh that failed to merge or
      // collapsed to nothing would still satisfy the name check above).
      for (const mesh of cockpitMeshes) {
        expect(mesh.sx, mesh.n).toBeGreaterThan(0);
        expect(mesh.sy, mesh.n).toBeGreaterThan(0);
        expect(mesh.sz, mesh.n).toBeGreaterThan(0);
      }
    },
    30_000,
  );
});
