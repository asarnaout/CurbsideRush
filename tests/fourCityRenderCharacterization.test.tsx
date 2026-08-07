// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:65535/"}

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { EngineStore, type Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Four-city NullEngine safety net for issue #293's retired-curriculum purge.
 *
 * Model preloading is intentionally replaced with an immediate, empty result:
 * this makes the characterization independent of a local dev server and of
 * network timing. The test still constructs the real GameCanvas,
 * BabylonGameSession, SimulationCore and complete authored environment. The
 * browser parity pass covers the corresponding loaded-GLB scene.
 *
 * `scenario-route` and `scenario-checkpoint` were the two unused lesson-only
 * materials removed by #293. Their absence is pinned separately; the
 * fingerprint of every surviving material remains byte-for-byte stable.
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

vi.mock("../app/game/arabicFont", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../app/game/arabicFont")>();
  return {
    ...mod,
    ensureArabicCanvasFontLoaded: async () => {},
    inspectArabicCanvasFont: () => ({
      loaded: true,
      family: mod.ARABIC_CANVAS_FONT_FAMILY,
      joinedLamAlefWidth: 40,
      isolatedLamAlefWidth: 80,
      contextualShapingReducedAdvance: true,
      inkPixels: 1,
      source: mod.ARABIC_CANVAS_FONT_SOURCE,
    }),
  };
});

import GameCanvas from "../app/game/GameCanvas";
import {
  CAIRO_FREE_DRIVE,
  CAIRO_MAP_PACK,
} from "../app/game/cities/cairo";
import {
  LONDON_FREE_DRIVE,
  LONDON_MAP_PACK,
} from "../app/game/cities/london";
import { NYC_FREE_DRIVE, NYC_MAP_PACK } from "../app/game/cities/nyc";
import {
  TOKYO_FREE_DRIVE,
  TOKYO_MAP_PACK,
} from "../app/game/cities/tokyo";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import type {
  FreeDriveDefinition,
  MapPack,
  SteeringSide,
  TrafficSide,
} from "../app/game/types";

interface RenderBaseline {
  readonly totalMeshes: number;
  readonly enabledMeshes: number;
  readonly activeMeshes: number;
  readonly materials: number;
  readonly drawCallsPerFrame: number;
  readonly drawCallsOverSixFrames: number;
  readonly mirrorRendersOverSixFrames: number;
  readonly mirrorCandidates: number;
  readonly mirrorDrawn: number;
  readonly mirrorMeshNames: readonly string[];
  readonly crowdInstances: number;
  readonly crowdMeshes: number;
  readonly retiredGuidanceMaterialNames: readonly string[];
  readonly survivingMaterialNamesFingerprint: string;
}

interface PerfDebug {
  readonly totalMeshes: number;
  readonly activeMeshes: number;
  readonly materials: number;
  readonly drawCallsCumulative: number | null;
  readonly mirrorRenders: number;
  readonly mirrorCandidates: number;
  readonly mirrorDrawn: number;
  readonly crowdInstances: number;
  readonly crowdMeshes: number;
  readonly drawCallsPerFrame: number;
  readonly perfWindowFrames: number;
}

interface AuthoredCity {
  readonly id: string;
  readonly trafficSide: TrafficSide;
  readonly steeringSide: SteeringSide;
  readonly freeDrive: FreeDriveDefinition;
  readonly mapPack: MapPack;
}

const CITIES: readonly AuthoredCity[] = [
  {
    id: "nyc-upper-west-side",
    trafficSide: "right",
    steeringSide: "left",
    freeDrive: NYC_FREE_DRIVE,
    mapPack: NYC_MAP_PACK,
  },
  {
    id: "london-south-kensington",
    trafficSide: "left",
    steeringSide: "right",
    freeDrive: LONDON_FREE_DRIVE,
    mapPack: LONDON_MAP_PACK,
  },
  {
    id: "tokyo-setagaya",
    trafficSide: "left",
    steeringSide: "right",
    freeDrive: TOKYO_FREE_DRIVE,
    mapPack: TOKYO_MAP_PACK,
  },
  {
    id: "cairo-central-nile",
    trafficSide: "right",
    steeringSide: "left",
    freeDrive: CAIRO_FREE_DRIVE,
    mapPack: CAIRO_MAP_PACK,
  },
];

const RETIRED_GUIDANCE_MATERIALS = new Set([
  "scenario-checkpoint",
  "scenario-route",
]);

const EXPECTED_MIRROR_MESH_NAMES = [
  "rear-view-panel",
  "wing-mirror-arm",
  "wing-mirror-bezel",
  "wing-mirror-glass",
  "wing-mirror-sail",
  "wing-mirror-shell",
];

const EXPECTED_BASELINES: Readonly<Record<string, RenderBaseline>> = {
  "nyc-upper-west-side": {
    totalMeshes: 19_030,
    enabledMeshes: 19_030,
    activeMeshes: 838,
    materials: 159,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 80,
    mirrorDrawn: 92,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    survivingMaterialNamesFingerprint: "18ebb9d8",
  },
  "london-south-kensington": {
    totalMeshes: 908,
    enabledMeshes: 908,
    activeMeshes: 137,
    materials: 115,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 77,
    mirrorDrawn: 36,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    survivingMaterialNamesFingerprint: "af80928b",
  },
  "tokyo-setagaya": {
    totalMeshes: 1_086,
    enabledMeshes: 1_086,
    activeMeshes: 293,
    materials: 96,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 166,
    mirrorDrawn: 71,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    survivingMaterialNamesFingerprint: "417377ea",
  },
  "cairo-central-nile": {
    totalMeshes: 17_660,
    enabledMeshes: 17_660,
    activeMeshes: 3_008,
    materials: 217,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 64,
    mirrorDrawn: 87,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    survivingMaterialNamesFingerprint: "a7ebaba1",
  },
};

function createFake2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const sized = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4),
  });
  return {
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
    direction: "inherit",
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
    getImageData: (_x: number, _y: number, width: number, height: number) =>
      sized(width, height),
    putImageData: noop,
  } as unknown as CanvasRenderingContext2D;
}

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

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let nextRafId = 1;
const pendingRaf = new Map<number, FrameRequestCallback>();
let nativeSetTimeout: typeof globalThis.setTimeout;

async function flushAnimationFrame(): Promise<void> {
  const callbacks = [...pendingRaf.values()];
  pendingRaf.clear();
  for (const callback of callbacks) callback(performance.now());
  await Promise.resolve();
  // Babylon queues the next render through a macrotask on some engines. Give
  // that scheduler turn a chance to publish the next controlled RAF so this
  // characterization remains deterministic when other test files are busy.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function flushUntilReady(): Promise<void> {
  for (let frame = 0; frame < 40; frame += 1) {
    await act(flushAnimationFrame);
    if (!screen.queryByRole("status")) return;
  }
  throw new Error("GameCanvas did not become ready within 40 controlled frames.");
}

function fingerprint(names: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const codeUnit of names.join("\0")) {
    hash ^= codeUnit.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  // BabylonGameSession halves its building count (`buildingKeepFraction`) below
  // 5 CPU cores, so these mesh counts are only host-independent once this is
  // pinned above that threshold. jsdom's own default already reads 8, but GitHub
  // Actions' runner reports 4 — which silently cut every EXPECTED_BASELINES
  // total by the low-spec building wall until this was pinned explicitly.
  Object.defineProperty(window.navigator, "hardwareConcurrency", {
    configurable: true,
    value: 8,
  });
  vi.stubGlobal("matchMedia", vi.fn(desktopMatchMedia));
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextRafId;
    nextRafId += 1;
    pendingRaf.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pendingRaf.delete(id);
  });
  // GameCanvas's Cairo-only perf-QA snapshot (`writePerfQaSnapshot`, a
  // one-shot `window.setTimeout(..., 2_500)`) reads the same
  // `__sideswapPerfDebug` hook this suite drains for its own 6-frame window
  // below — and unlike requestAnimationFrame, real timers are not on the
  // controlled clock above: they fire on the actual wall clock regardless of
  // how many `flushAnimationFrame`s have run. Under heavy parallel test
  // load, a slow-enough run can let that real 2.5 s timer land *during* the
  // 6-frame window and drain it early, silently undercounting
  // `perfWindowFrames` — a genuine, reproduced (locally, under synthetic
  // CPU contention matching a busy CI host) cause of a flaky `expected N to
  // be 6` failure that has nothing to do with frame scheduling. Nothing in
  // this suite's own code ever delays a real timer beyond the single 0 ms
  // tick `flushAnimationFrame` yields, so any longer real delay is
  // unambiguously not this suite's — suppress those specifically (never
  // schedule them for real) rather than faking timers wholesale, which
  // would also have to account for every timer Babylon's own engine/audio
  // code might set.
  nativeSetTimeout = globalThis.setTimeout;
  vi.stubGlobal(
    "setTimeout",
    ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      typeof timeout === "number" && timeout >= 1_000
        ? -1
        : nativeSetTimeout(handler as never, timeout, ...args)) as typeof setTimeout,
  );

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
  pendingRaf.clear();
  nextRafId = 1;
  vi.unstubAllGlobals();
});

describe("four-city render characterization (#293 safety net)", () => {
  it(
    "pins the headless scene while isolating the two retired guidance materials",
    async () => {
      const baselines: Record<string, RenderBaseline> = {};

      for (const city of CITIES) {
        const scenario = buildFreeDriveScenario(city.freeDrive);
        const view = render(
          <GameCanvas
            trafficSide={city.trafficSide}
            steeringSide={city.steeringSide}
            scenario={scenario}
            mapPack={city.mapPack}
            cameraMode="first_person"
            paused
            onHudUpdate={() => {}}
          />,
        );

        await flushUntilReady();
        const debugWindow = window as unknown as Record<string, unknown>;
        const readPerf = debugWindow.__sideswapPerfDebug as () => PerfDebug;
        const readMeshes = debugWindow.__sideswapMeshes as () => { n: string }[];
        const before = readPerf();
        for (let frame = 0; frame < 6; frame += 1) {
          await act(flushAnimationFrame);
        }
        const after = readPerf();
        expect(after.perfWindowFrames).toBe(6);

        const scene = EngineStore.LastCreatedScene;
        if (!scene) throw new Error(`No Babylon scene was created for ${city.id}.`);
        const materialNames = scene.materials.map((material) => material.name).sort();
        const retiredGuidanceMaterialNames = materialNames.filter((name) =>
          RETIRED_GUIDANCE_MATERIALS.has(name),
        );
        const survivingMaterialNames = materialNames.filter(
          (name) => !RETIRED_GUIDANCE_MATERIALS.has(name),
        );
        const mirrorMeshNames = readMeshes()
          .map((mesh) => mesh.n)
          .filter((name) => /mirror|rear-view/i.test(name))
          .sort();

        baselines[city.id] = {
          totalMeshes: after.totalMeshes,
          enabledMeshes: readMeshes().length,
          activeMeshes: after.activeMeshes,
          materials: after.materials,
          drawCallsPerFrame: after.drawCallsPerFrame,
          drawCallsOverSixFrames:
            after.drawCallsCumulative === null || before.drawCallsCumulative === null
              ? -1
              : after.drawCallsCumulative - before.drawCallsCumulative,
          mirrorRendersOverSixFrames: after.mirrorRenders - before.mirrorRenders,
          mirrorCandidates: after.mirrorCandidates,
          mirrorDrawn: after.mirrorDrawn,
          mirrorMeshNames,
          crowdInstances: after.crowdInstances,
          crowdMeshes: after.crowdMeshes,
          retiredGuidanceMaterialNames,
          survivingMaterialNamesFingerprint: fingerprint(survivingMaterialNames),
        };

        view.unmount();
        pendingRaf.clear();
      }

      expect(baselines).toEqual(EXPECTED_BASELINES);
    },
    120_000,
  );
});
