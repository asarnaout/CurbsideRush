// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization test for the cutscene rig, landed ahead of Phase 3.13's
 * extraction (.claude/refactor-plan.md, gitignored — "before each extraction
 * with coupling >= 9, land a NullEngine characterization test for that
 * builder first"; this cargo's coupling is 35, the highest of any Phase 3
 * cargo). Same harness as `gameCanvasSession.test.tsx`/
 * `mirrorRigCharacterization.test.tsx` (see the first file's header for why
 * each jsdom gap is worked around the way it is).
 *
 * Drives the scene the same way the app does: a `cutscene` prop rerender
 * with a bumped nonce (`updateOptions` -> `startCutscene`), not an
 * imperative test-only hook. Only "pullover" and "repair" are exercised —
 * per GameCanvas.tsx's own `startCutscene` comments, both "need no map data
 * to stage" (pullover falls back to a heading-relative park; repair plays at
 * the car's own wing), so they are the only two kinds that can be trusted to
 * stage from an arbitrary free-drive spawn. The other five kinds all require
 * being at a specific venue/pump/door and are out of scope here.
 *
 * Assertions lean on `__sideswapCutsceneDebug()` (the field names, and the
 * `Math.round(v * 100) / 100` position rounding, are read directly off the
 * live hook in GameCanvas.tsx, not guessed) rather than on mesh name
 * strings for the officer/patrol actors: those names live inside
 * characterMeshes/vehicleMeshes and asserting them here would just be
 * re-guessing content this test isn't about.
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
// Mounted on Tokyo, the smallest map. This suite asserts cutscene behaviour,
// not city specifics, and it lived on London only because London USED to be
// the smallest — after the London visual overhaul (8k+ meshes) its build cost
// tipped this suite past its 30 s budget under full-suite contention, exactly
// the remount case the expansion plan reserved for the four small-map suites.
import { TOKYO_FREE_DRIVE, TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import type { GameRuntimeEvent } from "../app/game/sessionContract";

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

interface CutsceneActiveDebug {
  readonly kind: string;
  readonly nonce: number;
  readonly step: number;
  readonly action: string | null;
  readonly actorX: number;
  readonly actorZ: number;
  readonly actorVisible: boolean;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  readonly patrolX: number | null;
  readonly patrolZ: number | null;
  readonly patrolVisualPresent: boolean;
}

interface CutsceneDebugSnapshot {
  readonly active: CutsceneActiveDebug | null;
  readonly playerX: number;
  readonly playerZ: number;
  readonly playerHeading: number;
  readonly cameraMode: string;
  readonly activeCamera: string | null;
  readonly dip: number;
}

describe("cutscene director characterization (Phase 3.13 safety net)", () => {
  it(
    "stages a pullover: patrol rig present, actor becomes visible and moves",
    async () => {
      const scenario = buildFreeDriveScenario(TOKYO_FREE_DRIVE);

      const { rerender } = render(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={TOKYO_MAP_PACK}
          paused={false}
          onHudUpdate={() => {}}
        />,
      );

      await waitFor(
        () => expect(screen.queryByRole("status")).not.toBeInTheDocument(),
        { timeout: 20_000 },
      );

      const debugWindow = window as unknown as Record<string, unknown>;
      const cutsceneDebug = () =>
        (debugWindow.__sideswapCutsceneDebug as () => CutsceneDebugSnapshot)();

      expect(cutsceneDebug().active).toBeNull();

      rerender(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={TOKYO_MAP_PACK}
          paused={false}
          cutscene={{ nonce: 1, kind: "pullover" }}
          onHudUpdate={() => {}}
        />,
      );

      // startCutscene runs synchronously off the prop change (updateOptions
      // sees the new nonce immediately), so the scene is staged before the
      // next render loop tick even fires.
      const staged = cutsceneDebug().active;
      expect(staged?.kind).toBe("pullover");
      expect(staged?.nonce).toBe(1);
      expect(staged?.step).toBe(0);
      // The scene always stands its own patrol in for the one that clocked
      // you (buildPatrolRig is unconditional for a pullover), regardless of
      // whether any NPC was actually nearby.
      expect(staged?.patrolX).not.toBeNull();
      expect(staged?.patrolZ).not.toBeNull();
      expect(staged?.patrolVisualPresent).toBe(true);

      // beginCutsceneStep only fires from inside advanceCutscene (the render
      // loop), so the actor is not enabled until at least one real frame has
      // ticked.
      await waitFor(() => expect(cutsceneDebug().active?.actorVisible).toBe(true), {
        timeout: 5_000,
      });
      const midStep = cutsceneDebug().active;
      expect(Number.isFinite(midStep?.actorX)).toBe(true);
      expect(Number.isFinite(midStep?.actorZ)).toBe(true);
      expect(Number.isFinite(midStep?.cameraX)).toBe(true);
      expect(Number.isFinite(midStep?.cameraY)).toBe(true);
      expect(Number.isFinite(midStep?.cameraZ)).toBe(true);
    },
    30_000,
  );

  it(
    "stages and completes a repair cutscene end to end, emitting its done event and clearing the rig",
    async () => {
      const scenario = buildFreeDriveScenario(TOKYO_FREE_DRIVE);
      const events: GameRuntimeEvent[] = [];

      const { rerender } = render(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={TOKYO_MAP_PACK}
          paused={false}
          onHudUpdate={() => {}}
          onEvent={(event) => events.push(event)}
        />,
      );

      await waitFor(
        () => expect(screen.queryByRole("status")).not.toBeInTheDocument(),
        { timeout: 20_000 },
      );

      const debugWindow = window as unknown as Record<string, unknown>;
      const cutsceneDebug = () =>
        (debugWindow.__sideswapCutsceneDebug as () => CutsceneDebugSnapshot)();

      rerender(
        <GameCanvas
          trafficSide="left"
          steeringSide="right"
          scenario={scenario}
          mapPack={TOKYO_MAP_PACK}
          paused={false}
          cutscene={{ nonce: 1, kind: "repair" }}
          onHudUpdate={() => {}}
          onEvent={(event) => events.push(event)}
        />,
      );

      const staged = cutsceneDebug().active;
      expect(staged?.kind).toBe("repair");
      // Repair plays at the car's own wing, not a shop building (no map pack
      // has a repair bay under TOKYO_FREE_DRIVE's spawn), so it never has a
      // patrol rig either way.
      expect(staged?.patrolX).toBeNull();

      // Run the whole scripted show -> idle(repair) -> walk -> hide sequence
      // for real (wall-clock, no fake timers) and check it actually reaches
      // its end, not just that it started.
      await waitFor(
        () =>
          expect(
            events.some(
              (event) =>
                event.type === "cutscene" && event.phase === "done",
            ),
          ).toBe(true),
        { timeout: 20_000 },
      );

      const doneEvent = events.find(
        (event) => event.type === "cutscene" && event.phase === "done",
      );
      expect(doneEvent).toMatchObject({
        type: "cutscene",
        phase: "done",
        nonce: 1,
      });

      // finishCutscene clears the rig once the scene ends.
      expect(cutsceneDebug().active).toBeNull();
    },
    // 30_000 -> 120_000 (Tokyo expansion, Phase 8): this test mounts a full
    // BabylonGameSession against TOKYO_MAP_PACK, which has grown from a
    // 355-line village to a 2600x2400m city (79 roads, 274 blocks, 45
    // venues, 23 landmarks) over the expansion's phases. Isolated runs stay
    // well under 30s (~22s for this file's two tests together), but the
    // full suite runs this as one of many parallel workers alongside
    // `trafficSafetyAcceptance.test.ts` and the other full-mount
    // characterization suites, and under that contention it started
    // intermittently missing the 30s budget (observed 3x locally: Phase 7
    // twice, Phase 8 once — always this exact test, never an assertion
    // failure, always clean on an immediate isolated retry). Matches
    // `gameCanvasSession.test.tsx`'s own 120_000 precedent and rationale for
    // the identical class of problem (full-session-mount cost against a
    // large map, real CI/parallel contention, not a hang).
    120_000,
  );
});
