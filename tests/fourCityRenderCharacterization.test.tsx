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
    // 23_000 -> 23_004 (#313: one kerbside guardrail per side on each of the
    // two drivable bridges) -> 23_007 (#315: the Steinway retail band and the
    // venue moves shift which street-wall buildings survive). Materials,
    // active meshes and the surviving-material fingerprint have not moved
    // through either.
    totalMeshes: 23_007,
    enabledMeshes: 23_007,
    activeMeshes: 846,
    materials: 188,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 81,
    mirrorDrawn: 116,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    survivingMaterialNamesFingerprint: "bbe0c887",
  },
  "london-south-kensington": {
    // 908 -> 887: London became a `paved` city, and a paved map draws a
    // concrete ground plane instead of the grass blade/patch layer — 21
    // scatter meshes the map no longer has any use for.
    //
    // 887 -> 1_988: the south-west expansion. Fourteen generated streets from
    // Chelsea out to Earls Court, 43 roadside parcels of procedural facades
    // along them, three signalled junctions, two garden squares — and two
    // turning-loop rings retired. The one new material is the London stock
    // brick those terraces are built out of, which is also what moves the
    // surviving-material fingerprint.
    //
    // 1_988 -> 3_680: the Thames. Both embankments, the riverside spine and
    // Battersea Park Road behind it, four link streets, 33 more roadside
    // parcels, Battersea Park, and three drivable bridges whose decks each
    // carry parapets, guardrails and a lamp line. The 18 new materials are
    // four per bridge (deck steel, parapet stone, lamp glow, trim) plus the
    // water and park additions.
    //
    // 3_680 -> 3_703: Sloane Circus — its ring, its island, and a give-way
    // triangle on a pole at each of its three mouths.
    //
    // 3_703 -> 5_087: the West End and Westminster. Knightsbridge, Brompton
    // Road, Park Lane, Bayswater Road, West Carriage Drive, Piccadilly,
    // Regent Street's quadrant, Oxford Street's west end, Grosvenor Place,
    // Buckingham Palace Road, The Mall, Whitehall, Bridge Street and Victoria
    // Street; Wellington and Victoria circuses and the Parliament Square
    // gyratory; the royal park and the Serpentine; 36 more parcels. The new
    // material is Whitehall's Portland stone.
    //
    // 5_087 -> 5_965: the City and the north east. Oxford Street and Euston
    // Road close the northern loop; London Wall, Bishopsgate, King William
    // Street, Cornmarket, Leadenhall and the Minories fill the City around
    // Bank Circus; Upper Street, Canonbury Road and Shoreditch Lane run out
    // past Islington Circus. 36 more parcels, and one new material — the
    // City's glass curtain wall, the only London material above 40 m.
    //
    // 5_965 -> 6_221: the bespoke silhouettes. A clock tower with four faces
    // frozen at the scenario's 08:30, a 90 m observation wheel, the power
    // station's four chimneys, the round hall, the Gherkin, the Shard, the
    // palace, the department store, the Monument, Tower Bridge's towers and
    // high walkways, three tube-station fronts, and sixteen pillar boxes and
    // telephone kiosks.
    //
    // Materials go DOWN, 165 -> 144, and that is the point: every landmark
    // used to mint its own trim/glazing/roof material with the same three
    // colours and its own id in the name — 78 of them for the parks alone.
    // They are shared now, which is a draw-call saving as much as a memory
    // one.
    //
    // 6_221 -> 6_226 and 144 -> 241 materials: 36 more gig venues and five
    // more service points. Almost all of that is materials rather than
    // meshes, and it is inherent: a venue's name board, hanging sign and
    // fascia each carry a dynamic texture with *that venue's own name*
    // painted on it, so unlike the landmark trio they cannot be shared. NYC
    // pays the same ~3 per venue for its 31.
    //
    // 6_226 -> 6_358: six zebra crossings, and the pair of Belisha beacons
    // flanking each — a banded pole and an amber globe apiece.
    //
    // Active meshes 984 -> 569 with no change to the totals: the palette
    // caps London's fog at 800 m, so the camera's far plane follows it and
    // the far half of the city stops being drawn. Measured in-browser that
    // is 412 draw calls down to 171 — the map's tree and thicket layer alone
    // is 45% of its meshes, and most of it is a kilometre away.
    //
    // 6_358 -> 6_508 (and 569 -> 567 active): the parcel-side truth pass.
    // `roadsideParcel`'s `side` is driver's-right-of-authoring-direction and
    // ~30 call sites read it as a compass, so on north/west-authored roads
    // parcels stood on the wrong kerb — seven of them inside parks. The fix
    // RAISES the mesh count with one parcel fewer: relocated single-sided
    // parcels (Park Lane's three, West Carriage Drive's, Great Portland's...)
    // landed on kerbs with fewer junction constraints and derived longer
    // street walls, which is exactly the point.
    //
    // 6_508 -> 6_416 (and 148 -> 151 blocks): per-end parcel trimming. Ends
    // retreat independently instead of symmetrically about the midpoint, so
    // junction aprons stop paying double; three parcels that could never
    // clear symmetrically now survive. Total meshes DIP slightly while the
    // street wall grows because the facade grid re-packs longer runs into
    // wider, fewer boxes.
    //
    // 6_416 -> 6_361, 243 -> 245 materials, 151 -> 170 blocks: the void
    // fill. Fourteen new roadside parcels on the audit's bare kerbs, seven
    // off-network fabric rects (Battersea triangle, the strip west of
    // Warwick Road, the Fitzrovia hole), the Kensington lawn (a walled
    // greensward closing the 70 m concrete band under the royal park) and a
    // Fitzrovia pocket green; Battersea Park deepened 44 -> 65 m to meet
    // both its roads. Meshes NET DOWN because the deepened Battersea lawn
    // swallowed a parcel band's worth of facade boxes while the new blocks
    // pack into fewer, wider ones; the two new materials are the lawn
    // pair the Kensington greensward mints.
    // 6_361 -> 6_635, 245 -> 251 materials: Serpentine Road through the
    // grown royal park (its bridge deck, parapets, guardrails and lamp line
    // are the material adds, same four-per-bridge as the Thames three), the
    // four-road Notting Hill grid with sixteen parcels, two more greens, and
    // three fabric rects. Active meshes 533 -> 570: the grown park's planting
    // and the new drive sit inside the 800 m fog cap at spawn.
    // 6_635 -> 6_634 under THIS suite's unloaded-model mock: zoning the sets
    // reroutes ~170 blocks through the building layer, whose fallback closure
    // redraws the same facade rects when the glbs are absent — the real
    // street wall's 2_561 instances are pinned in
    // buildingLayerCharacterization, which real-loads the kits. Active/mirror
    // counts wobble a few meshes from the changed build order.
    // 6_634 -> 8_195: the street-life pass. Tree scatter tightened 30 -> 20 m
    // (the reference streets keep a plane tree every few doors — most of the
    // gain is trees, each 2-3 procedural parts), 42 solver-placed guardrail
    // runs at the roundabout mouths, and 182 kerbside parked cars (one
    // merged-master instance each; the four masters are the traffic fleet's
    // own glbs). Active 574 -> 673: the spawn's streets got their trees.
    // 8_195 -> 8_207 (active 673 -> 661): the play-test de-slop pass. The
    // Chelsea green rotated to King's Road's own 8.2-degree bearing and grew
    // from a floating 56 x 28 stamp into a 170 x 28 pavement-hugging lawn
    // (the map's first rotated park); the Westbourne green grew likewise,
    // and three Bayswater-band fabric rows closed the bare strip west of
    // the royal park.
    // 8_207 -> 8_073, 251 -> 254 materials: the museum-quarter environs.
    // Ten parcels line Gloucester Road, Cromwell's far-west reach, the quiet
    // loop, Kensington Road's south side and Cromwell West's south side —
    // with three boulevard lawn strips between the west environs' kerbs and
    // their set-back terraces (the owner's requested arrangement). Meshes
    // NET DOWN because the strips' lawns displace roadside scatter while the
    // new walls pack into wide facade boxes; the material adds are the strip
    // lawns' planting variants.
    // 8_073 -> 7_774, 254 -> 255 materials: the whole-map coverage sweep.
    // Thirty-odd fill parcels close every uncovered run over ~70 m that is
    // not a river walk, a park edge or a world-edge margin (the City's east
    // flank, the palace wedge, the Thurloe band, both Cromwell East kerbs,
    // the crescent's outer arc...), with the St James's ribbon along The
    // Mall. Meshes NET DOWN again: the fills' wide facade boxes replace
    // denser roadside scatter, and the two deleted quarter parcels
    // (museum-covered kerbs) go with them.
    // 7_774 -> 7_288 (active 641 -> 629): the tuck-and-connect pass. Every
    // kerb green's near edge moves to pavement + 0.3 and the royal park's
    // three road edges come all the way in (the 10 m NYC-parity gap read as
    // a concrete moat in play-testing); the boulevard strips run junction to
    // junction and butt-join at the Gloucester x Cromwell corner; the
    // Kensington lawn stretches to its full road span. Meshes DROP because
    // the grown lawns displace hundreds of roadside scatter placements.
    // 7_288 -> 7_282 (active 629 -> 635, 255 -> 260 materials): the kerb
    // greens complete their roads. Five new ribbons — Cromwell's east half,
    // Notting Hill Gate's south side in two segment-aligned rects, The Mall's
    // split into its own two, and the Gloucester x Kensington corner pocket —
    // with backing rows behind them. Same trade as the pass above: lawn
    // displaces roadside scatter, so meshes edge DOWN while the materials
    // each new green's planting variants need go up.
    // 7_282 -> 7_144 (active 635 -> 604, 260 -> 264 materials): the emptiness
    // round's west fills. Meshes DOWN by 138 even though sixteen blocks were
    // added: a parcel's instanced street wall replaces the loose roadside
    // scatter that stood on the bare ground before it, and the museums' four
    // forecourt lawns do the same over a wider area than they cost.
    // 7_144 -> 7_166 (active 604 -> 606, 264 -> 267 materials): the eastern
    // half of the sweep. Fourteen more blocks, and three new lawns — the
    // V&A's north forecourt plus St James's and the palace garden, whose
    // greensward planting and derived walls are most of the mesh add.
    // 7_166 -> 7_116 (active 606 -> 561, 267 -> 269 materials): the crescent
    // island, the park walls and the junction fill. The island trades five
    // blocks of terraces for three lawn tiles; the royal park, the
    // Kensington lawn and Battersea Park gain the wall runs their road-
    // facing edges used to have deleted, which is where the two materials
    // and part of the mesh delta come from.
    // 7_116 -> 7_094 (270 materials): the Science Museum's north forecourt,
    // the fourth side of the quarter's planting. Lawn displacing scatter
    // again — a green costs one material and saves more meshes than it adds.
    // 7_094 -> 7_071 (active 561 -> 558, 270 -> 280 materials): the crescent
    // island retiled from three tiles to thirteen — one trail band and
    // twelve pathless lawns. Two fewer trail paths and their furniture, no
    // shrubs on the fillers (shrubs only grow beside a path), so meshes drop
    // even though ten more lawn planes exist; the ten extra materials are the
    // per-park batched-scenery sets the extra tiles carry.
    // 7_071 -> 6_981 (active 558 -> 560, 280 -> 290 materials): the
    // flush-stack sweep's ten new greens. West Carriage Drive's 700 m ribbon
    // and Battersea's verges displace far more loose roadside scatter than
    // their planting adds — lawn is the cheaper dressing — while each new
    // park carries its batched-scenery material set.
    // 6_981 -> 7_129 (active 560 -> 586, 290 -> 292 materials): the
    // void-kill round's first half — twenty-two blocks of terraces and civic
    // stone where the spawn field, the museum-south clearing, the Queen's
    // Gate hinterland and Westminster's belts were bare.
    // 7_129 -> 7_320 (active 586 -> 634): the second half's twenty-five
    // interior slabs — second-row fabric behind every district's street
    // wall. Materials unchanged: the slabs reuse the district material sets.
    // 7_320 -> 7_408 (active 634 -> 655): the void-kill third pass.
    // 7_408 -> 7_539 (active 655 -> 679): the void-kill fourth pass.
    // 7_539 -> 7_595 (active 679 -> 695): the residual slabs.
    // 7_595 -> 7_603: the Brompton pocket's south half.
    // 7_603 -> 7_607 (active 695 -> 692, 292 -> 294 materials, mirror 214 ->
    // 216): fabric street edges named (side rows retired) and the spawn
    // corner's L-verge and re-spanned terraces.
    // 7_607 -> 7_633 (active 692 -> 712, materials 294 -> 295, mirror drawn
    // 216 -> 217): the spawn quarter's building L closes its corner, the
    // quiet island's north band gains its first boxes, and Cromwell Fuel's
    // side lawn greens the keep-out band.
    // 7_633 -> 7_621 (active 712 -> 700): the Gloucester grammar run — the
    // resized ribbons re-deal their derived planting and the corner parcels
    // re-slot; net fewer thickets than the old bare-band scatter.
    // 7_621 -> 7_609 (active 700 -> 699): four kerb ribbons go parkStyle
    // lawn, retiring their elected trail paths (and the path furniture the
    // dressing hung on them); one bayswater seam terrace joins.
    totalMeshes: 7_609,
    enabledMeshes: 7_609,
    activeMeshes: 699,
    materials: 295,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    // 102 -> 104 and 160 -> 170: the Kensington lawn and the drive's south
    // approach sit within the spawn's mirror candidate radius. 104 -> 97
    // with the set zoning's build-order change; 97 -> 117 / 170 -> 172 with
    // the denser tree scatter around the spawn; 117 -> 101 / 172 -> 175 as
    // the quarter-environs walls and strips re-deal what stands nearest the
    // spawn's mirrors; 101 -> 95 / 175 -> 176 with the coverage-sweep fills;
    // 95 -> 84 / 176 -> 181 as the Cromwell ribbon's east half and the
    // Queen's Gate terraces' new south face re-deal what stands nearest the
    // spawn, which sits on the quiet loop one street away; 84 -> 35 / 181 ->
    // 186 once the quiet loop's island fills the block the spawn's mirrors
    // look straight into, which occludes most of what used to be candidates;
    // 186 -> 189 with the eastern fills, 189 -> 192 with the walls and the
    // museum quarter's fourth forecourt; 192 -> 202 as the island's thirteen
    // tiles put more lawn planes inside the mirror radius than the three
    // did; 202 -> 212 with the flush-stack sweep's greens near the spawn
    // (the forecourt growths and threads sit inside the mirror radius);
    // 35 -> 31 / 212 -> 214 as the spawn quarter's fabric fills what the
    // mirrors look into and occludes part of the old candidate ring.
    // 31 -> 46 / 216 -> 217: the corner terraces, the island's north-band
    // boxes and the station side lawn all stand inside the spawn's mirror
    // candidate radius.
    // 46 -> 45: the Cromwell far-west ribbon's retired trail path was one.
    mirrorCandidates: 45,
    mirrorDrawn: 217,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    // "4717fd7e" -> "ad7cd6ad": the Kensington lawn's greensward pair joins
    // the surviving-material set (void-fill pass). -> "92cde486": the
    // Serpentine bridge's deck/parapet/lamp materials. -> "5d87b546": the
    // boulevard strips' planting variants (quarter-environs pass). ->
    // "589935fd": the coverage sweep's fills and the St James's ribbon. ->
    // "b15509ee": the five new kerb greens' planting variants. ->
    // "49bcd9ee": the museums' four forecourt lawns. -> "7afcaa41": St
    // James's and the palace garden, the map's two new walled greenswards.
    // -> "62a24fe0": the royal park's, the Kensington lawn's and Battersea
    // Park's restored boundary walls. -> "303918a2": the Science Museum's
    // north forecourt. -> "0d476c11": the crescent island's thirteen-tile
    // retile (trail band + pathless lawns). -> "ed8e6b3a": the flush-stack
    // sweep's ten greens. -> "6dc30ed4": the void-kill round's first half.
    // -> "9b5073c7": the spawn corner re-grammar.
    // -> "edd7eddb": the quiet island's procedural north band.
    survivingMaterialNamesFingerprint: "edd7eddb",
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
