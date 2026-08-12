// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:65535/"}

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { EngineStore, type AssetContainer, type Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Building-specific NullEngine safety net for issue #288's `BuildingLayer`
 * extraction. A sibling to `fourCityRenderCharacterization.test.tsx`, not an
 * extension of it, because it needs a materially different model-loading
 * setup: that suite deliberately keeps every model unloaded (see its own
 * header comment), which means every building there takes the procedural
 * facade-grid fallback and never exercises the *instanced* glb path
 * (`getBuildingMaster` / `getStorefrontMaster` / `addCairoRoofClutter`) at
 * all — exactly the code this issue moves.
 *
 * This suite instead real-loads, from `public/` on disk (no network, no dev
 * server — the same data-URI recipe `tests/buildingPlacement.test.ts` and
 * `tests/cairoRoofs.test.ts` already use), every glb any shipped building set
 * references, so the instanced path actually runs. Everything else (vehicles,
 * characters, generic props, nature, river craft, vendor carts) stays
 * unloaded exactly as in the four-city suite, so this stays scoped and fast —
 * loading the ~30 distinct building-set glbs this way costs ~1-2s total (see
 * `buildingPlacement.test.ts`, which loads a similar set).
 *
 * Pins three per-city facts specific enough to catch a wrong building set or
 * a missing roof-clutter pass, not just an aggregate total:
 *  - `buildingInstanceCount` — placed `bldg-*` meshes. Only NYC and Cairo
 *    author any `buildingSet` block; London and Tokyo are pinned at zero.
 *  - `cairoRoofClutterInstanceCount` — placed `cairo-roof-<n>-<roll>` meshes.
 *    Nonzero only for Cairo (the only map with roof-clutter masters).
 *  - `storefrontSignMaterialCount` — distinct `storefront-sign-*` materials,
 *    i.e. how many different re-branded variants actually got picked.
 *    Nonzero only for NYC (the only map whose building sets reference
 *    `STOREFRONT_MODEL_ID`); Cairo's own sets never place it.
 *
 * Landed before the extraction, per issue #288's explicit instruction; must
 * stay byte-for-byte identical afterward.
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
  // The only urls this suite actually loads from disk — every glb any
  // shipped building set references. Everything else (vehicles, characters,
  // props, nature, river craft) is left unmapped, exactly like the four-city
  // suite's blanket empty preload.
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
          // Same soft-fail as production preloadModels: leave this url
          // unmapped, its callers fall back to whatever they do without it.
        }
      }
      onProgress?.(1);
    },
    instantiateModel: (scene: Scene, url: string) => {
      const container = containersFor(scene).get(url);
      if (!container) return null;
      return container.instantiateModelsToScene(undefined, false, {
        doNotInstantiate: true,
      });
    },
    instantiateModelInstanced: (scene: Scene, url: string) => {
      const container = containersFor(scene).get(url);
      if (!container) return null;
      return container.instantiateModelsToScene(undefined, false, {
        doNotInstantiate: false,
      });
    },
    modelMaterials: (scene: Scene, url: string) =>
      containersFor(scene).get(url)?.materials ?? [],
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

interface BuildingBaseline {
  readonly buildingInstanceCount: number;
  readonly cairoRoofClutterInstanceCount: number;
  readonly storefrontSignMaterialCount: number;
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

// Recorded against the pre-extraction BabylonGameSession (issue #288). Must
// stay byte-for-byte identical once the building-placement code moves into
// BuildingLayer — a change here without an explained reason means the
// extraction altered behaviour, not just address.
const EXPECTED_BASELINES: Readonly<Record<string, BuildingBaseline>> = {
  "nyc-upper-west-side": {
    // 5_314 -> 5_307 (#314: three venues moved to the other kerb of their own
    // avenue, out of a park) -> 5_305 (#315: four borough blocks rezoned
    // house -> shop for the Steinway band, and four more venues moved). A
    // venue carries a `buildingKeepOuts` circle, so relocating one re-decides
    // which street-wall buildings survive on the block it left and the one it
    // joined; a rezoned block draws from a different set entirely.
    buildingInstanceCount: 5_305,
    cairoRoofClutterInstanceCount: 0,
    storefrontSignMaterialCount: 12,
  },
  "london-south-kensington": {
    // 0 -> 2_561: the London visual overhaul zoned the street wall onto the
    // four imported sets (terrace/stucco/highstreet/city). Roadside parcels
    // are one-sided strips, so each walls only its road-facing edge — which
    // is why London's count sits at half NYC's despite having more blocks.
    // Whitehall's Portland-stone parcels and the museum quarter stay on the
    // procedural grid deliberately. Sign materials stay 0: the storefront
    // re-branding pipeline derives its fascia rects from nyc-shop-corner's
    // baked lettering, which the Kay london-shop model does not have.
    // 2_561 -> 2_698: the Bayswater-band fabric rows wall all four edges.
    // -> 2_791: the museum-quarter environs' ten zoned parcels. -> 2_971:
    // the coverage sweep's fills (235 blocks all told). -> 2_979: the kerb
    // greens' backing rows — one new terrace band behind the Cromwell
    // ribbon's west half, one new Mall band, and the ends of five existing
    // bands moved so the ribbons could reach their junctions. -> 3_091: the
    // emptiness round's west fills — eleven bare-kerb parcels, the quiet
    // loop's island, and four corner fabric rects at the map's west and
    // river edges. -> 3_181: the eastern half — ten more bare-kerb parcels
    // from Knightsbridge to Euston Road, and four corner fabric rects.
    // -> 3_153: Pembroke Crescent's island gave up its four inner terrace
    // bands and Earls Court Road's west band along it, to become one lawn.
    // -> 3_152: the flush-stack sweep — notting-s-1's east end retreated to
    // x-326 (West Carriage Drive's new ribbon owns that corner) costing one
    // terrace box; the new mall-s-mid band and the re-dealt park-west-w row
    // net out.
    // -> 3_452: the void-kill round's first half — twenty fabric blocks fill
    // the spawn quarter's field, the museum-south clearing, the Queen's Gate
    // hinterland and Westminster's four belts, and the crescent's outer arm
    // plus Flood Street's east band re-authored with legal spans after both
    // silently dropped under the 26 m post-inset floor.
    // -> 4_391: the second half — twenty-five interior slabs stand up the
    // deep fields behind every district's street wall (west-central,
    // King's Road north, Chelsea's hinterland, the Westminster-to-City east
    // belt, the City's east margin, Mayfair/Soho, the Euston band, the south
    // bank and the west margins), so the sightlines that leaked between
    // kerb parcels now end at a second row instead of open ground.
    // -> 4_855: the third pass — eleven more slabs on the embankment's
    // land band, the Warwick/Nevern west belts, the south bank between the
    // river roads, and the City/Islington remainders.
    // -> 5_363: the fourth pass — eighteen slabs close every remaining
    // void blob with a sightline from a kerb inside 30 m (three flank the
    // Royal Hospital venue circle rather than cross it).
    // -> 5_515: seven middle-tier residuals from the fourth pass's
    // re-audit (the Thames shore pockets stay open — riverfront).
    // -> 5_540: the Brompton pocket's south half (its north is fenced by a
    // venue circle).
    // -> 4_364: every fabric block now names its street edges — the play
    // test caught gable rows standing side-on to the spawn road, because an
    // unset streetEdges walls all FOUR edges. Road-facing blocks keep only
    // their road edges, interior slabs their long-edge pair, so the side
    // rows (and their z-fighting pairs on shallow blocks) are gone.
    // -> 4_366: the spawn verge's building L — quiet-w runs through the
    // corner to quiet-s's front line and quiet-s reaches quiet-w's, so the
    // terrace rows turn the same right angle the verge does.
    // -> 4_368: Gloucester Road's west grammar run to the Old Brompton
    // corner — gloucester-w-2 gains its southern terraces behind the
    // extended ribbon, brompton-n-2 cedes its slot on the corner ground.
    // -> 4_369: bayswater-n-1 overshoots the park-corner node so its row
    // meets notting-n-1's across the T-mouth's unbroken north kerb.
    // -> 4_380: the three-city visual-gap-elimination plan's Cornmarket P0
    // (Section 10.2) — two new building-set frontages flanking segment 0,
    // 4 slots (`-w-near`, Guild Lane Pharmacy's relaxed keep-out) + 7 slots
    // (`-e-near`, the previously-empty right side); verified against the
    // real resolved plan, not assumed from the baseline delta alone.
    buildingInstanceCount: 4_380,
    cairoRoofClutterInstanceCount: 0,
    storefrontSignMaterialCount: 0,
  },
  "tokyo-setagaya": {
    buildingInstanceCount: 0,
    cairoRoofClutterInstanceCount: 0,
    storefrontSignMaterialCount: 0,
  },
  "cairo-central-nile": {
    buildingInstanceCount: 1_396,
    cairoRoofClutterInstanceCount: 464,
    storefrontSignMaterialCount: 0,
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
  // Babylon queues the next render through a macrotask on some engines; give
  // that scheduler turn a chance to publish the next controlled RAF — see
  // fourCityRenderCharacterization.test.tsx's identical workaround.
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
  // BabylonGameSession halves its building count (`buildingKeepFraction`)
  // below 5 CPU cores — see the `hardware-concurrency-lowspec-building`
  // finding from #295/#293. Pinned above that threshold for a host-
  // independent count, exactly like fourCityRenderCharacterization.test.tsx.
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
  // This mounts Cairo too, so it can in principle race the same real
  // (non-RAF) `window.setTimeout(..., 2_500)` perf-QA snapshot timer
  // `fourCityRenderCharacterization.test.tsx` diagnosed and suppresses —
  // see that file's identical comment for the full mechanism. This suite's
  // own assertions don't depend on an exact frame count, but there is no
  // reason to leave a real 2.5 s timer free to fire mid-test here either.
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

describe("building-layer characterization (#288 safety net)", () => {
  it(
    "places real-loaded instanced buildings, Cairo roof clutter, and NYC storefront variants identically per city",
    async () => {
      const baselines: Record<string, BuildingBaseline> = {};

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
        const readMeshes = debugWindow.__sideswapMeshes as () => { n: string }[];
        const meshNames = readMeshes().map((mesh) => mesh.n);
        const scene = EngineStore.LastCreatedScene;
        if (!scene) throw new Error(`No Babylon scene was created for ${city.id}.`);
        const materialNames = scene.materials.map((material) => material.name);

        baselines[city.id] = {
          buildingInstanceCount: meshNames.filter((name) => name.startsWith("bldg-"))
            .length,
          cairoRoofClutterInstanceCount: meshNames.filter((name) =>
            /^cairo-roof-\d+-\d+$/.test(name),
          ).length,
          storefrontSignMaterialCount: new Set(
            materialNames.filter((name) => name.startsWith("storefront-sign-")),
          ).size,
        };

        view.unmount();
        pendingRaf.clear();
      }

      expect(baselines).toEqual(EXPECTED_BASELINES);
    },
    120_000,
  );
});
