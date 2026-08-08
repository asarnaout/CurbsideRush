// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:65535/"}

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterizes the render-side `seededUnit` draw order inside
 * `buildScenarioEnvironment`. Every baseline below was recorded against the
 * pre-extraction session, while the procedural facade grid was still a
 * closure (`placeFacadeGrid`) living in that method, and reproduced
 * unchanged after issue #304 moved it to `ProceduralFacades.placeBlock`
 * (`render/proceduralFacades.ts`). That extraction moved *where* the three
 * `random()` calls per surviving facade cell live; this suite exists to keep
 * anything from changing *when* they fire relative to one another — the
 * render side's seeded-random consumption order is load-bearing for every
 * downstream draw, for every city, silently, if it drifts (see
 * docs/rendering.md).
 *
 * A sibling to `fourCityRenderCharacterization.test.tsx`, not an extension
 * of it — this codebase's convention for these suites is to duplicate the
 * jsdom/NullEngine/`<GameCanvas>` harness boilerplate per file rather than
 * share it (`buildingLayerCharacterization.test.tsx` already does this).
 * Deliberately reuses that file's *unloaded*-model `preloadModels` mock, not
 * `buildingLayerCharacterization.test.tsx`'s real-glb one: every
 * building-set block must fail to place so it falls through to
 * `BuildingLayer`'s deferred fallback (`ProceduralFacades.placeBlock` again,
 * called from `BuildingLayer.instantiate()` well after the block loop's own
 * direct calls have run), exercising *both* of that method's call sites for
 * all four cities in one pass.
 *
 * Two independent signals, pinned together:
 *
 * - `drawCount` — `seededUnit` is wrapped, not stubbed (the real LCG math
 *   runs unchanged), to count every draw its returned closure produces,
 *   grouped by the `seed` argument and then by *which* call with that seed
 *   (there are two: `buildScenarioEnvironment`'s facade-grid `random`, and
 *   the unrelated `buildScenarioTraffic`'s ambient-vehicle `random` — both
 *   keyed off the same scenario `trafficSeed`, called in that fixed order
 *   from the session constructor's `buildEnvironment(); buildPlayerCar();
 *   buildTraffic();` sequence). Reading only the *first* group isolates
 *   `buildScenarioEnvironment`'s count from `buildScenarioTraffic`'s, so
 *   this suite cannot go red for a reason outside its stated scope. Catches
 *   a changed cell-survival count or a `random` stream that stops being the
 *   single shared instance the class doc comment on `ProceduralFacades`
 *   requires.
 * - `facadeMeshFingerprint` — an FNV-1a hash over every placed facade mesh's
 *   `{name, worldPosition, worldSize}` (via the existing `__sideswapMeshes`
 *   debug hook), sorted by name so the fingerprint is independent of mesh
 *   *creation* order and sensitive only to what got assigned to which named
 *   mesh. This is the signal that actually matters, and *not* `drawCount`:
 *   an LCG's raw output sequence (v1, v2, v3, ...) is completely determined
 *   by the seed and how many draws have happened so far — it does not
 *   depend on *which call site* asked for the next value. Proven locally
 *   (see this file's introducing commit): reversing the block loop's order
 *   changes which building gets which width/depth/height (a real,
 *   observable regression — every facade box after the first reordered
 *   block would silently get somebody else's dimensions) while leaving the
 *   *raw* `random()` output sequence, and therefore `drawCount` and a
 *   fingerprint over raw values, completely unchanged. Only a fingerprint
 *   over the *downstream, per-mesh* values — where each draw actually
 *   landed — is sensitive to that class of bug, which is exactly the class
 *   `buildScenarioEnvironment`'s "frozen call order" warning is about.
 *
 * Non-vacuousness was proven locally (not committed — see this file's
 * introducing commit): temporarily reversing the block loop's order turned
 * `facadeMeshFingerprint` red for every city with more than one relevant
 * block, with `drawCount` unchanged — proving this suite is sensitive to
 * *draw-to-mesh assignment*, not just draw count, before trusting it as a
 * gate. (An earlier attempt — swapping the width/depth call sites inside
 * one cell — proved *insufficient*: it left even `facadeMeshFingerprint`
 * unchanged, because both calls are unconditional and adjacent, so swapping
 * which named local receives which of two back-to-back draws does not
 * change which mesh ends up with which pair of values. The block-loop
 * reversal is the swap that actually demonstrates order-sensitivity.)
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

const { seededUnitDraws } = vi.hoisted(() => ({
  // seed -> one array per `seededUnit(seed)` call, in call order (not a flat
  // per-seed array) — see the header comment for why two unrelated session
  // methods can share the same seed argument, and why isolating the first
  // call's draws matters.
  seededUnitDraws: new Map<number, number[][]>(),
}));

vi.mock("../app/game/visuals", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../app/game/visuals")>();
  return {
    ...mod,
    seededUnit: (seed: number) => {
      const draw = mod.seededUnit(seed); // real LCG, unmodified
      const instanceDraws: number[] = [];
      const instances = seededUnitDraws.get(seed);
      if (instances) instances.push(instanceDraws);
      else seededUnitDraws.set(seed, [instanceDraws]);
      return () => {
        const value = draw();
        instanceDraws.push(value);
        return value;
      };
    },
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

interface DrawOrderBaseline {
  readonly drawCount: number;
  readonly facadeMeshFingerprint: string;
}

interface DebugMesh {
  readonly n: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
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

// Recorded against the pre-extraction BabylonGameSession (issue #304, while
// the grid was still `placeFacadeGrid` inside `buildScenarioEnvironment`) and
// reproduced byte-for-byte by `ProceduralFacades`. A change here without an
// explained reason means something changed which draw landed on which mesh,
// not merely where the call sites live.
const EXPECTED_BASELINES: Readonly<Record<string, DrawOrderBaseline>> = {
  "nyc-upper-west-side": {
    // `drawCount` deliberately does NOT move through either of these:
    // relocating a venue (#314) moves the facade grid's keep-outs, and
    // rezoning a block (#315) changes which set it draws from, but the number
    // of `random()` draws is a property of the block *rectangles*, which
    // neither touches. "95d9fc4f" -> "2b2a3d27" -> "3a8892fd" on the meshes
    // themselves. A drawCount change here would mean something else entirely.
    drawCount: 2_868,
    facadeMeshFingerprint: "3a8892fd",
  },
  "london-south-kensington": {
    drawCount: 48,
    // "c189cd29" -> "0d1c5374": `london-queen-gate-terraces` lost 0.8 m of
    // width so its frontage clears the pavement London gained when the map
    // went `paved`. Same block count and the same rectangles-driven draw
    // count; the facade meshes on that one block moved 0.4 m each way.
    facadeMeshFingerprint: "0d1c5374",
  },
  "tokyo-setagaya": {
    drawCount: 216,
    facadeMeshFingerprint: "2dda315a",
  },
  "cairo-central-nile": {
    drawCount: 15_517,
    facadeMeshFingerprint: "22b5588d",
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
  // characterization remains deterministic when other test files are busy —
  // see fourCityRenderCharacterization.test.tsx's identical workaround.
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
  // BabylonGameSession halves its building count (`buildingKeepFraction`)
  // below 5 CPU cores, which changes how many facade cells survive
  // `deterministicSceneryKeep` and therefore how many random() draws this
  // suite records — not just a mesh-count concern here, so this pin matters
  // just as much as it does for fourCityRenderCharacterization.test.tsx.
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
  // one-shot `window.setTimeout(..., 2_500)`) runs on the real wall clock,
  // not the controlled RAF clock above. This suite's own assertions don't
  // depend on frame counts, but there is no reason to leave a real 2.5 s
  // timer free to fire mid-test — see fourCityRenderCharacterization.test.tsx
  // and the `real-timer-races-controlled-raf-clock` finding for the full
  // mechanism this suppresses.
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
  seededUnitDraws.clear();
  vi.unstubAllGlobals();
});

// Matches every mesh `ProceduralFacades.placeBlock` (or its
// London-museum-wing sibling branch, which shares the same block loop)
// produces: the facade box itself (`building-<blockId>-<cellIndex>`), its
// Cairo street-detail children (`-cornice`, `-balcony`, `-balcony-rail`,
// `-ac`, `-awning`, `-roof-tank`/`-roof-dish`), the museum wings
// (`-wing-<side>`) — all `building-`-prefixed — and the Garden City compound
// walls/gates, the one family `placeBlock` names off the bare block id
// instead (`<blockId>-compound-side/front/gate-...`).
const FACADE_MESH_NAME_RE = /^building-|-compound-/;

function facadeMeshFingerprint(meshes: readonly DebugMesh[]): string {
  const rows = meshes
    .filter((mesh) => FACADE_MESH_NAME_RE.test(mesh.n))
    .map(
      (mesh) =>
        `${mesh.n}|${mesh.x.toFixed(2)}|${mesh.y.toFixed(2)}|${mesh.z.toFixed(2)}|${mesh.sx.toFixed(2)}|${mesh.sy.toFixed(2)}|${mesh.sz.toFixed(2)}`,
    )
    // Sorted by name so the fingerprint reflects what each named mesh got,
    // independent of the order meshes happened to be created in.
    .sort();
  return fingerprint(rows);
}

describe("facade-grid draw-order characterization (#304 safety net)", () => {
  it(
    "pins the facade-grid random() draw count and per-mesh assignment for each city",
    async () => {
      const baselines: Record<string, DrawOrderBaseline> = {};

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

        // `[0]` below is positional, so assert the shape it assumes before
        // reading it: exactly two streams share this seed
        // (`buildScenarioEnvironment`'s, then `buildScenarioTraffic`'s). If a
        // third consumer appears — or something starts drawing from this seed
        // ahead of the environment build — this fails saying so, instead of
        // silently pinning the wrong stream and reporting a baffling baseline
        // mismatch.
        const streams = seededUnitDraws.get(city.freeDrive.trafficSeed) ?? [];
        expect(streams, `${city.id}: seededUnit streams for this seed`).toHaveLength(2);
        const draws = streams[0];
        const debugWindow = window as unknown as Record<string, unknown>;
        const readMeshes = debugWindow.__sideswapMeshes as () => DebugMesh[];
        baselines[city.id] = {
          drawCount: draws.length,
          facadeMeshFingerprint: facadeMeshFingerprint(readMeshes()),
        };
        seededUnitDraws.clear();

        view.unmount();
        pendingRaf.clear();
      }

      expect(baselines).toEqual(EXPECTED_BASELINES);
    },
    120_000,
  );
});
