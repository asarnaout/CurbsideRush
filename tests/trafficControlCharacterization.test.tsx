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
 * railway-crossing furniture, give-way triangles, crosswalk stripes and
 * box-junction markings — everything this cargo builds. Excludes the inline
 * stop-line meshes (see file header) even though several share a name prefix
 * with these.
 *
 * Give-way road markings themselves are not here and cannot be: they merge
 * into the one `road-markings-white` mesh with every other line on the map. */
const TRAFFIC_CONTROL_MESH_PATTERN =
  /signal|camera-|crossbuck|rail-pole|barrier|stripe|box-edge|box-hatch|portal|give-way/i;
const isTrafficControlMesh = (name: string) =>
  TRAFFIC_CONTROL_MESH_PATTERN.test(name) && !name.endsWith("-stop-line");

/**
 * 76 -> 127 meshes: London grew three signalled junctions in the south west
 * (the King's Road at Gloucester Road and at Queen's Gate, and Earls Court
 * Road at Old Brompton Road), each arm contributing a pole and its four head
 * parts, plus one more derived enforcement camera — a third of five signals
 * rather than a third of two.
 *
 * 127 -> 186 meshes: both ends of Westminster Bridge and Tower Bridge are
 * signalled too, and a third of nine signals is three cameras.
 *
 * 186 -> 192 meshes: Sloane Circus. Three give-way controls, each a roadside
 * triangle on a pole — the first `yield_sign` any city has authored. The
 * pattern above gained `give-way` with them, so they are pinned rather than
 * silently skipped; their painted transverse dashes cannot be, having merged
 * into the map-wide white-marking mesh.
 *
 * 192 -> 228 meshes: the West End. Parliament Square's three signalled
 * gyratory arms (a fourth derived camera with them), and give-way triangles
 * on the seven mouths of Wellington, Victoria and Sloane circuses.
 *
 * 228 -> 252 meshes: Bank Circus and Islington Circus bring seven more
 * give-way mouths between them.
 *
 * 252 -> 294 meshes: six zebra crossings on the high streets, seven striped
 * bars each.
 */
const EXPECTED_LONDON_TRAFFIC_CONTROL_MESH_NAMES = [
  "crosswalk-stripe-master",
  "london-bank-circus-give-way-bank-arm-east-london-bank-circus-give-way-bank-arm-east-sign-pole",
  "london-bank-circus-give-way-bank-arm-east-london-bank-circus-give-way-bank-arm-east-sign-sign",
  "london-bank-circus-give-way-bank-arm-north-london-bank-circus-give-way-bank-arm-north-sign-pole",
  "london-bank-circus-give-way-bank-arm-north-london-bank-circus-give-way-bank-arm-north-sign-sign",
  "london-bank-circus-give-way-bank-arm-south-london-bank-circus-give-way-bank-arm-south-sign-pole",
  "london-bank-circus-give-way-bank-arm-south-london-bank-circus-give-way-bank-arm-south-sign-sign",
  "london-bank-circus-give-way-bank-arm-west-london-bank-circus-give-way-bank-arm-west-sign-pole",
  "london-bank-circus-give-way-bank-arm-west-london-bank-circus-give-way-bank-arm-west-sign-sign",
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
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-0",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-1",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-2",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-3",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-4",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-5",
  "london-crossing-bishopsgate-london-crossing-bishopsgate-marking-stripe-6",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-0",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-1",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-2",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-3",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-4",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-5",
  "london-crossing-kings-road-london-crossing-kings-road-marking-stripe-6",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-0",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-1",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-2",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-3",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-4",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-5",
  "london-crossing-knightsbridge-london-crossing-knightsbridge-marking-stripe-6",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-0",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-1",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-2",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-3",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-4",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-5",
  "london-crossing-oxford-london-crossing-oxford-marking-stripe-6",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-0",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-1",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-2",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-3",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-4",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-5",
  "london-crossing-riverbank-london-crossing-riverbank-marking-stripe-6",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-0",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-1",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-2",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-3",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-4",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-5",
  "london-crossing-upper-street-london-crossing-upper-street-marking-stripe-6",
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
  "london-islington-circus-give-way-islington-arm-north-london-islington-circus-give-way-islington-arm-north-sign-pole",
  "london-islington-circus-give-way-islington-arm-north-london-islington-circus-give-way-islington-arm-north-sign-sign",
  "london-islington-circus-give-way-islington-arm-south-london-islington-circus-give-way-islington-arm-south-sign-pole",
  "london-islington-circus-give-way-islington-arm-south-london-islington-circus-give-way-islington-arm-south-sign-sign",
  "london-islington-circus-give-way-islington-arm-west-london-islington-circus-give-way-islington-arm-west-sign-pole",
  "london-islington-circus-give-way-islington-arm-west-london-islington-circus-give-way-islington-arm-west-sign-sign",
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
  "london-signal-earls-brompton-london-earls-court-road-earls-crescent-head-amber",
  "london-signal-earls-brompton-london-earls-court-road-earls-crescent-head-green",
  "london-signal-earls-brompton-london-earls-court-road-earls-crescent-head-housing",
  "london-signal-earls-brompton-london-earls-court-road-earls-crescent-head-pole",
  "london-signal-earls-brompton-london-earls-court-road-earls-crescent-head-red",
  "london-signal-earls-brompton-london-earls-court-road-kings-earls-head-amber",
  "london-signal-earls-brompton-london-earls-court-road-kings-earls-head-green",
  "london-signal-earls-brompton-london-earls-court-road-kings-earls-head-housing",
  "london-signal-earls-brompton-london-earls-court-road-kings-earls-head-pole",
  "london-signal-earls-brompton-london-earls-court-road-kings-earls-head-red",
  "london-signal-earls-brompton-london-old-brompton-brompton-mid-head-amber",
  "london-signal-earls-brompton-london-old-brompton-brompton-mid-head-green",
  "london-signal-earls-brompton-london-old-brompton-brompton-mid-head-housing",
  "london-signal-earls-brompton-london-old-brompton-brompton-mid-head-pole",
  "london-signal-earls-brompton-london-old-brompton-brompton-mid-head-red",
  "london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-amber",
  "london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-green",
  "london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-housing",
  "london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-pole",
  "london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-red",
  "london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-amber",
  "london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-green",
  "london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-housing",
  "london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-pole",
  "london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-red",
  "london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-amber",
  "london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-green",
  "london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-housing",
  "london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-pole",
  "london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-red",
  "london-signal-kings-gloucester-london-kings-road-kings-queens-head-amber",
  "london-signal-kings-gloucester-london-kings-road-kings-queens-head-green",
  "london-signal-kings-gloucester-london-kings-road-kings-queens-head-housing",
  "london-signal-kings-gloucester-london-kings-road-kings-queens-head-pole",
  "london-signal-kings-gloucester-london-kings-road-kings-queens-head-red",
  "london-signal-kings-queens-london-drayton-gardens-drayton-mid-head-amber",
  "london-signal-kings-queens-london-drayton-gardens-drayton-mid-head-green",
  "london-signal-kings-queens-london-drayton-gardens-drayton-mid-head-housing",
  "london-signal-kings-queens-london-drayton-gardens-drayton-mid-head-pole",
  "london-signal-kings-queens-london-drayton-gardens-drayton-mid-head-red",
  "london-signal-kings-queens-london-kings-road-kings-gloucester-head-amber",
  "london-signal-kings-queens-london-kings-road-kings-gloucester-head-green",
  "london-signal-kings-queens-london-kings-road-kings-gloucester-head-housing",
  "london-signal-kings-queens-london-kings-road-kings-gloucester-head-pole",
  "london-signal-kings-queens-london-kings-road-kings-gloucester-head-red",
  "london-signal-kings-queens-london-kings-road-sloane-arm-kings-head-amber",
  "london-signal-kings-queens-london-kings-road-sloane-arm-kings-head-green",
  "london-signal-kings-queens-london-kings-road-sloane-arm-kings-head-housing",
  "london-signal-kings-queens-london-kings-road-sloane-arm-kings-head-pole",
  "london-signal-kings-queens-london-kings-road-sloane-arm-kings-head-red",
  "london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-amber",
  "london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-green",
  "london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-housing",
  "london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-pole",
  "london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-red",
  "london-signal-parliament-arm-victoria-london-victoria-street-victoria-street-1-head-amber",
  "london-signal-parliament-arm-victoria-london-victoria-street-victoria-street-1-head-green",
  "london-signal-parliament-arm-victoria-london-victoria-street-victoria-street-1-head-housing",
  "london-signal-parliament-arm-victoria-london-victoria-street-victoria-street-1-head-pole",
  "london-signal-parliament-arm-victoria-london-victoria-street-victoria-street-1-head-red",
  "london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-amber",
  "london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-green",
  "london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-housing",
  "london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-pole",
  "london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-red",
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
  "london-signal-tower-north-london-king-william-king-william-mid-head-amber",
  "london-signal-tower-north-london-king-william-king-william-mid-head-green",
  "london-signal-tower-north-london-king-william-king-william-mid-head-housing",
  "london-signal-tower-north-london-king-william-king-william-mid-head-pole",
  "london-signal-tower-north-london-king-william-king-william-mid-head-red",
  "london-signal-tower-north-london-minories-minories-mid-head-amber",
  "london-signal-tower-north-london-minories-minories-mid-head-green",
  "london-signal-tower-north-london-minories-minories-mid-head-housing",
  "london-signal-tower-north-london-minories-minories-mid-head-pole",
  "london-signal-tower-north-london-minories-minories-mid-head-red",
  "london-signal-tower-north-london-tower-bridge-tower-south-head-amber",
  "london-signal-tower-north-london-tower-bridge-tower-south-head-green",
  "london-signal-tower-north-london-tower-bridge-tower-south-head-housing",
  "london-signal-tower-north-london-tower-bridge-tower-south-head-pole",
  "london-signal-tower-north-london-tower-bridge-tower-south-head-red",
  "london-signal-tower-north-london-victoria-embankment-victoria-emb-2-head-amber",
  "london-signal-tower-north-london-victoria-embankment-victoria-emb-2-head-green",
  "london-signal-tower-north-london-victoria-embankment-victoria-emb-2-head-housing",
  "london-signal-tower-north-london-victoria-embankment-victoria-emb-2-head-pole",
  "london-signal-tower-north-london-victoria-embankment-victoria-emb-2-head-red",
  "london-signal-tower-south-london-riverbank-riverbank-4-head-amber",
  "london-signal-tower-south-london-riverbank-riverbank-4-head-green",
  "london-signal-tower-south-london-riverbank-riverbank-4-head-housing",
  "london-signal-tower-south-london-riverbank-riverbank-4-head-pole",
  "london-signal-tower-south-london-riverbank-riverbank-4-head-red",
  "london-signal-tower-south-london-riverbank-riverbank-east-head-amber",
  "london-signal-tower-south-london-riverbank-riverbank-east-head-green",
  "london-signal-tower-south-london-riverbank-riverbank-east-head-housing",
  "london-signal-tower-south-london-riverbank-riverbank-east-head-pole",
  "london-signal-tower-south-london-riverbank-riverbank-east-head-red",
  "london-signal-tower-south-london-tower-bridge-tower-north-head-amber",
  "london-signal-tower-south-london-tower-bridge-tower-north-head-green",
  "london-signal-tower-south-london-tower-bridge-tower-north-head-housing",
  "london-signal-tower-south-london-tower-bridge-tower-north-head-pole",
  "london-signal-tower-south-london-tower-bridge-tower-north-head-red",
  "london-signal-westminster-north-london-bridge-street-parliament-arm-bridge-head-amber",
  "london-signal-westminster-north-london-bridge-street-parliament-arm-bridge-head-green",
  "london-signal-westminster-north-london-bridge-street-parliament-arm-bridge-head-housing",
  "london-signal-westminster-north-london-bridge-street-parliament-arm-bridge-head-pole",
  "london-signal-westminster-north-london-bridge-street-parliament-arm-bridge-head-red",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-1-head-amber",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-1-head-green",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-1-head-housing",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-1-head-pole",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-1-head-red",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-2-head-amber",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-2-head-green",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-2-head-housing",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-2-head-pole",
  "london-signal-westminster-north-london-victoria-embankment-victoria-emb-2-head-red",
  "london-signal-westminster-north-london-westminster-bridge-westminster-south-head-amber",
  "london-signal-westminster-north-london-westminster-bridge-westminster-south-head-green",
  "london-signal-westminster-north-london-westminster-bridge-westminster-south-head-housing",
  "london-signal-westminster-north-london-westminster-bridge-westminster-south-head-pole",
  "london-signal-westminster-north-london-westminster-bridge-westminster-south-head-red",
  "london-signal-westminster-south-london-riverbank-riverbank-3-head-amber",
  "london-signal-westminster-south-london-riverbank-riverbank-3-head-green",
  "london-signal-westminster-south-london-riverbank-riverbank-3-head-housing",
  "london-signal-westminster-south-london-riverbank-riverbank-3-head-pole",
  "london-signal-westminster-south-london-riverbank-riverbank-3-head-red",
  "london-signal-westminster-south-london-riverbank-riverbank-4-head-amber",
  "london-signal-westminster-south-london-riverbank-riverbank-4-head-green",
  "london-signal-westminster-south-london-riverbank-riverbank-4-head-housing",
  "london-signal-westminster-south-london-riverbank-riverbank-4-head-pole",
  "london-signal-westminster-south-london-riverbank-riverbank-4-head-red",
  "london-signal-westminster-south-london-westminster-bridge-westminster-north-head-amber",
  "london-signal-westminster-south-london-westminster-bridge-westminster-north-head-green",
  "london-signal-westminster-south-london-westminster-bridge-westminster-north-head-housing",
  "london-signal-westminster-south-london-westminster-bridge-westminster-north-head-pole",
  "london-signal-westminster-south-london-westminster-bridge-westminster-north-head-red",
  "london-sloane-circus-give-way-sloane-arm-buckingham-london-sloane-circus-give-way-sloane-arm-buckingham-sign-pole",
  "london-sloane-circus-give-way-sloane-arm-buckingham-london-sloane-circus-give-way-sloane-arm-buckingham-sign-sign",
  "london-sloane-circus-give-way-sloane-arm-kings-london-sloane-circus-give-way-sloane-arm-kings-sign-pole",
  "london-sloane-circus-give-way-sloane-arm-kings-london-sloane-circus-give-way-sloane-arm-kings-sign-sign",
  "london-sloane-circus-give-way-sloane-arm-smith-london-sloane-circus-give-way-sloane-arm-smith-sign-pole",
  "london-sloane-circus-give-way-sloane-arm-smith-london-sloane-circus-give-way-sloane-arm-smith-sign-sign",
  "london-sloane-circus-give-way-sloane-arm-sydney-london-sloane-circus-give-way-sloane-arm-sydney-sign-pole",
  "london-sloane-circus-give-way-sloane-arm-sydney-london-sloane-circus-give-way-sloane-arm-sydney-sign-sign",
  "london-victoria-circus-give-way-victoria-arm-buckingham-london-victoria-circus-give-way-victoria-arm-buckingham-sign-pole",
  "london-victoria-circus-give-way-victoria-arm-buckingham-london-victoria-circus-give-way-victoria-arm-buckingham-sign-sign",
  "london-victoria-circus-give-way-victoria-arm-grosvenor-london-victoria-circus-give-way-victoria-arm-grosvenor-sign-pole",
  "london-victoria-circus-give-way-victoria-arm-grosvenor-london-victoria-circus-give-way-victoria-arm-grosvenor-sign-sign",
  "london-victoria-circus-give-way-victoria-arm-mall-london-victoria-circus-give-way-victoria-arm-mall-sign-pole",
  "london-victoria-circus-give-way-victoria-arm-mall-london-victoria-circus-give-way-victoria-arm-mall-sign-sign",
  "london-wellington-circus-give-way-wellington-arm-grosvenor-london-wellington-circus-give-way-wellington-arm-grosvenor-sign-pole",
  "london-wellington-circus-give-way-wellington-arm-grosvenor-london-wellington-circus-give-way-wellington-arm-grosvenor-sign-sign",
  "london-wellington-circus-give-way-wellington-arm-knights-london-wellington-circus-give-way-wellington-arm-knights-sign-pole",
  "london-wellington-circus-give-way-wellington-arm-knights-london-wellington-circus-give-way-wellington-arm-knights-sign-sign",
  "london-wellington-circus-give-way-wellington-arm-park-london-wellington-circus-give-way-wellington-arm-park-sign-pole",
  "london-wellington-circus-give-way-wellington-arm-park-london-wellington-circus-give-way-wellington-arm-park-sign-sign",
  "london-wellington-circus-give-way-wellington-arm-piccadilly-london-wellington-circus-give-way-wellington-arm-piccadilly-sign-pole",
  "london-wellington-circus-give-way-wellington-arm-piccadilly-london-wellington-circus-give-way-wellington-arm-piccadilly-sign-sign",
  "prop-traffic-camera-london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head",
  "prop-traffic-camera-london-signal-kings-gloucester-london-chelsea-manor-hospital-west-head-lens",
  "prop-traffic-camera-london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head",
  "prop-traffic-camera-london-signal-kings-gloucester-london-gloucester-south-gloucester-mid-head-lens",
  "prop-traffic-camera-london-signal-kings-gloucester-london-kings-road-kings-beaufort-head",
  "prop-traffic-camera-london-signal-kings-gloucester-london-kings-road-kings-beaufort-head-lens",
  "prop-traffic-camera-london-signal-kings-gloucester-london-kings-road-kings-queens-head",
  "prop-traffic-camera-london-signal-kings-gloucester-london-kings-road-kings-queens-head-lens",
  "prop-traffic-camera-london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head",
  "prop-traffic-camera-london-signal-parliament-arm-bridge-london-bridge-street-westminster-north-head-lens",
  "prop-traffic-camera-london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head",
  "prop-traffic-camera-london-signal-parliament-arm-whitehall-london-whitehall-whitehall-mid-head-lens",
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
