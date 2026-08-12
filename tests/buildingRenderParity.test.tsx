// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:65535/"}

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type AssetContainer, type Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Render/plan parity for the building-collision-visual-parity plan's Phase 3
 * (`.claude/building-collision-visual-parity-plan.md` Section 10.4): every
 * planned building is represented at full tier, at low spec, and under a
 * real or forced asset failure — never a hole, never a whole-block
 * alternate grid. Reuses `buildingLayerCharacterization.test.tsx`'s exact
 * real-glb-from-disk mock (see that file's own header comment for why the
 * four-city suite's blanket unloaded-model mock cannot exercise this path).
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
  const fs = await import("node:fs");
  const path = await import("node:path");
  const babylon = await import("@babylonjs/core");
  const { buildingSetUrls, ALL_BUILDING_SET_IDS } = await import(
    "../app/game/buildingSets"
  );
  const REAL_URLS = new Set(buildingSetUrls(ALL_BUILDING_SET_IDS));
  const containers = new WeakMap<Scene, Map<string, AssetContainer>>();
  const containersFor = (scene: Scene): Map<string, AssetContainer> => {
    let map = containers.get(scene);
    if (!map) {
      map = new Map();
      containers.set(scene, map);
    }
    return map;
  };
  let loadersRegistered = false;
  const ensureLoaders = async () => {
    if (loadersRegistered) return;
    const { registerBuiltInLoaders } = await import("@babylonjs/loaders/dynamic");
    registerBuiltInLoaders();
    loadersRegistered = true;
  };

  return {
    ...mod,
    preloadModels: async (
      scene: Scene,
      urls: readonly string[],
      onProgress?: (fraction: number) => void,
    ) => {
      await ensureLoaders();
      const map = containersFor(scene);
      for (const url of new Set(urls)) {
        if (!REAL_URLS.has(url) || map.has(url)) continue;
        try {
          const buf = fs.readFileSync(path.join(process.cwd(), "public", url));
          const dataUrl = "data:model/gltf-binary;base64," + buf.toString("base64");
          const container = await babylon.LoadAssetContainerAsync(dataUrl, scene, {
            pluginExtension: ".glb",
          });
          if (scene.isDisposed) {
            container.dispose();
            continue;
          }
          map.set(url, container);
        } catch {
          // Same soft-fail as production preloadModels.
        }
      }
      onProgress?.(1);
    },
    instantiateModel: (scene: Scene, url: string) => {
      const container = containersFor(scene).get(url);
      if (!container) return null;
      return container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
    },
    instantiateModelInstanced: (scene: Scene, url: string) => {
      const container = containersFor(scene).get(url);
      if (!container) return null;
      return container.instantiateModelsToScene(undefined, false, { doNotInstantiate: false });
    },
    modelMaterials: (scene: Scene, url: string) => containersFor(scene).get(url)?.materials ?? [],
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
import { LONDON_FREE_DRIVE, LONDON_MAP_PACK } from "../app/game/cities/london";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";

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
let hardwareConcurrency = 8;

async function flushAnimationFrame(): Promise<void> {
  const callbacks = [...pendingRaf.values()];
  pendingRaf.clear();
  for (const callback of callbacks) callback(performance.now());
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function flushUntilReady(): Promise<void> {
  for (let frame = 0; frame < 60; frame += 1) {
    await act(flushAnimationFrame);
    if (!screen.queryByRole("status")) return;
  }
  throw new Error("GameCanvas did not become ready within 60 controlled frames.");
}

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  hardwareConcurrency = 8;
  Object.defineProperty(window.navigator, "hardwareConcurrency", {
    configurable: true,
    get: () => hardwareConcurrency,
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

interface RepresentationDebug {
  readonly plannedCount: number;
  readonly representedCount: number;
  readonly missingPlanIds: readonly string[];
  readonly orphanRepresentationIds: readonly string[];
  readonly kindCounts: Readonly<Record<string, number>>;
}

async function mountLondon(
  debugBuildingAssetPolicy?: { readonly unavailableModelIds: "all" | readonly string[] },
): Promise<RepresentationDebug> {
  const scenario = buildFreeDriveScenario(LONDON_FREE_DRIVE);
  const view = render(
    <GameCanvas
      trafficSide="left"
      steeringSide="right"
      scenario={scenario}
      mapPack={LONDON_MAP_PACK}
      cameraMode="first_person"
      paused
      onHudUpdate={() => {}}
      debugBuildingAssetPolicy={debugBuildingAssetPolicy}
    />,
  );
  await flushUntilReady();
  const debugWindow = window as unknown as Record<string, unknown>;
  const read = debugWindow.__sideswapBuildingRepresentationDebug as () => RepresentationDebug;
  const result = read();
  view.unmount();
  pendingRaf.clear();
  return result;
}

const PLAN = planMapBuildings(LONDON_MAP_PACK, LONDON_FREE_DRIVE.trafficSeed);
const ASSET_SLOT_COUNT = PLAN.buildings.filter((b) => b.source === "asset-slot").length;
const PLANNED_BOX_COUNT = PLAN.buildings.length - ASSET_SLOT_COUNT;

describe("building render/plan parity (Phase 3)", () => {
  it(
    "represents every planned building at full tier with real glbs — no missing, no orphan",
    async () => {
      const debug = await mountLondon();
      expect(debug.plannedCount).toBe(PLAN.buildings.length);
      expect(debug.representedCount).toBe(PLAN.buildings.length);
      expect(debug.missingPlanIds).toEqual([]);
      expect(debug.orphanRepresentationIds).toEqual([]);
      // Every procedural-cell/museum-wing entry is always a planned-box —
      // never quality- or failure-thinned (Section 7.6).
      expect(debug.kindCounts["planned-box"] ?? 0).toBe(PLANNED_BOX_COUNT);
      // At full tier with real glbs available, every asset-slot entry gets
      // its real model — zero proxies.
      expect(debug.kindCounts.glb ?? 0).toBe(ASSET_SLOT_COUNT);
      expect(debug.kindCounts.proxy ?? 0).toBe(0);
    },
    60_000,
  );

  it(
    "falls back to an exact proxy for every asset-slot entry when every model is forced unavailable — still no missing",
    async () => {
      const debug = await mountLondon({ unavailableModelIds: "all" });
      expect(debug.plannedCount).toBe(PLAN.buildings.length);
      expect(debug.representedCount).toBe(PLAN.buildings.length);
      expect(debug.missingPlanIds).toEqual([]);
      // Procedural/museum entries are unaffected by asset availability —
      // they were never glb-backed in the first place.
      expect(debug.kindCounts["planned-box"] ?? 0).toBe(PLANNED_BOX_COUNT);
      expect(debug.kindCounts.glb ?? 0).toBe(0);
      expect(debug.kindCounts.proxy ?? 0).toBe(ASSET_SLOT_COUNT);
    },
    60_000,
  );

  it(
    "forcing one model unavailable proxies only that model's slots — every successful neighbour keeps its glb, none vanish",
    async () => {
      const assetEntries = PLAN.buildings.filter(
        (b): b is Extract<(typeof PLAN.buildings)[number], { source: "asset-slot" }> =>
          b.source === "asset-slot",
      );
      const modelCounts = new Map<string, number>();
      for (const entry of assetEntries) {
        modelCounts.set(entry.modelId, (modelCounts.get(entry.modelId) ?? 0) + 1);
      }
      // Pick a model with more than one placement, so this also proves a
      // failed slot never suppresses or renames its successful siblings.
      const [forcedModelId, forcedCount] =
        [...modelCounts.entries()].find(([, count]) => count > 1) ??
        [...modelCounts.entries()][0];
      expect(forcedModelId, "expected at least one placed asset-slot model").toBeTruthy();

      const debug = await mountLondon({ unavailableModelIds: [forcedModelId] });
      expect(debug.missingPlanIds).toEqual([]);
      expect(debug.orphanRepresentationIds).toEqual([]);
      expect(debug.kindCounts.proxy ?? 0).toBe(forcedCount);
      expect(debug.kindCounts.glb ?? 0).toBe(ASSET_SLOT_COUNT - forcedCount);
    },
    60_000,
  );

  it(
    "low spec (fraction 0.5) still represents every planned building — proxies replace glbs, never delete occupancy",
    async () => {
      hardwareConcurrency = 2; // forces lowSpec -> buildingAssetDetailFraction 0.5
      const debug = await mountLondon();
      expect(debug.plannedCount).toBe(PLAN.buildings.length);
      expect(debug.representedCount).toBe(PLAN.buildings.length);
      expect(debug.missingPlanIds).toEqual([]);
      expect(debug.kindCounts["planned-box"] ?? 0).toBe(PLANNED_BOX_COUNT);
      // The retained-glb subset is exactly the assetDetailScore < 0.5 set —
      // buildingLayout.test.ts already proves this set matches the legacy
      // low-spec selection exactly; here it only needs to be non-trivial
      // (some glbs, some proxies) and sum back to the full asset-slot count.
      const glbCount = debug.kindCounts.glb ?? 0;
      const proxyCount = debug.kindCounts.proxy ?? 0;
      expect(glbCount + proxyCount).toBe(ASSET_SLOT_COUNT);
      expect(glbCount).toBeGreaterThan(0);
      expect(proxyCount).toBeGreaterThan(0);
    },
    60_000,
  );
});
