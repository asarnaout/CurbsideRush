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
    // 2_868 -> 0 (mesh fingerprint "3a8892fd" -> "811c9dc5"): the
    // building-collision-visual-parity plan's Phase 2/3. `drawCount` now
    // measures `geometry/buildingLayout.ts`'s planner stream (recorded once,
    // at plan-build time, positioned first in the constructor — see
    // `seededUnitDraws`'s stream-order comment above), not a render-time
    // re-derivation under this suite's forced-every-model-unavailable mock.
    // NYC has zero procedural/unknown-set blocks and (per the plan's own
    // production inventory) zero deferred zero-survivor fallback blocks
    // either — every one of its 103 building-set blocks keeps at least one
    // keep-out survivor — so the planner's random stream never enters the
    // procedural path at all. The OLD count came entirely from the render
    // mock's whole-block fallback re-deriving a facade grid for all 103
    // blocks when every glb failed to load; that fallback mechanism no
    // longer exists (Section 7.7 replaces it with an exact per-solid proxy,
    // which draws no randomness). The mesh fingerprint moves because the
    // rendered meshes are now proxy boxes (named/shaped per plan entry), not
    // a re-derived procedural grid.
    drawCount: 0,
    facadeMeshFingerprint: "811c9dc5",
  },
  "london-south-kensington": {
    // 48 -> 1_032 draws: the south-west expansion took London from five
    // blocks to forty-eight. The draw count is a property of the block
    // *rectangles*, so it moves with the parcels themselves rather than with
    // anything about how they are dressed.
    // 1_032 -> 1_800 with the river: the embankments, the riverside spine and
    // Battersea Park Road brought 33 more parcels.
    // -> 2_751 with the West End, Westminster and the park's frontage, ->
    // 3_633 with the City and the north east, -> 3_606 once the
    // Knightsbridge parcel gave way to the department store standing on it.
    // -> 3_582 with the parcel-side truth pass: `roadsideParcel`'s `side` is
    // driver's-right-of-authoring-direction, but ~30 call sites read it as a
    // compass (inverted on north/west-authored roads) — seven parcels stood
    // inside parks. One parcel retired outright (Battersea Park now fronts
    // its road), one re-spanned west of the park, the rest swapped kerbs.
    // -> 3_654 with per-end parcel trimming: the shrink loop used to be
    // symmetric about the segment midpoint, so clearing a tight junction at
    // one end threw away the same length at the clear end. Ends now retreat
    // independently; three parcels that could never clear symmetrically
    // survive (148 -> 151 blocks) and every junction-adjacent parcel grew
    // back toward its clear end.
    // -> 4_104 with the void fill: fourteen new roadside parcels on the
    // audit's bare kerbs plus seven off-network fabric rects (151 -> 170
    // blocks). -> 4_512 with the Notting Hill grid's sixteen parcels and
    // three north-west fabric rects (170 -> 187). -> 4_584 with the three
    // Bayswater-band rows that close the bare strip west of the royal park
    // (187 -> 190; the play-test's "tiny patch in a sea of concrete").
    // -> 4_824 with the museum-quarter environs' ten parcels (190 -> 200).
    // -> 5_667 with the coverage sweep's fills (200 -> 235 blocks).
    // -> 5_715 with the kerb-green round: two new backing bands and six
    // existing ones re-spanned so every ribbon reaches its junctions
    // (235 -> 237 blocks). -> 6_144 with the emptiness round's west fills
    // (237 -> 253 blocks: eleven bare-kerb parcels, the quiet loop's island,
    // the museums' west pocket and four corner fabric rects). -> 6_486 with
    // the eastern half (253 -> 267 blocks). -> 6_366 with the crescent
    // island's five blocks retired for its lawn (267 -> 262). -> 6_390 with
    // the flush-stack sweep: mall-s-mid added (262 -> 263 blocks),
    // park-west-w set back behind the drive's new ribbon, notting-s-1's east
    // end retreated. -> 6_918 with the void-kill round's first half: twenty
    // fabric blocks plus the crescent's re-authored outer arm and Flood
    // Street's east band (263 -> 285 blocks). -> 7_518 with the second
    // half's twenty-five interior slabs (285 -> 310 blocks).
    // -> 7_782 with the third pass's eleven slabs (310 -> 321 blocks).
    // -> 8_214 with the fourth pass's eighteen slabs (321 -> 339 blocks).
    // -> 8_382 with the seven residual slabs (339 -> 346 blocks).
    // -> 8_406 (346 -> 347 blocks).
    // -> 8_409: the quiet island re-authored as its north band, set-less —
    // the full-island block's cells all sat inside venue keep-outs and drew
    // nothing; the band's procedural stucco boxes are the island's first
    // actual buildings.
    // 8_409 -> 972: the building-collision-visual-parity plan's Phase 2/3,
    // same cause as NYC's move to 0 above — `drawCount` now measures the
    // planner's stream (every direct-procedural/unknown-set block's cells,
    // then the deferred zero-survivor blocks', in that fixed order), not a
    // render-time re-derivation. London's asset-slot blocks (306 of them)
    // no longer draw anything at all when their glbs are unavailable — each
    // failed entry gets an exact, undecorated proxy box instead of a
    // whole-block procedural fallback that used to redraw random() for
    // every cell. What remains — 972 draws — is genuinely procedural
    // content: London's ~43 direct procedural/unknown-set blocks plus the
    // five documented zero-survivor asset-slot blocks' deferred fallback
    // cells (Section 4.1/7.4), each drawing width, then depth, then
    // (unless frontage-overlap-suppressed) height.
    drawCount: 972,
    // "c189cd29" -> "0d1c5374" (`london-queen-gate-terraces` lost 0.8 m of
    // width to clear the pavement the `paved` flip widened) -> "63ee7ce2"
    // (the 43 new roadside parcels) -> "cba25d85" (the riverside ones) ->
    // "456e4b36" (Smith Street bent to reach Sloane Circus from the south,
    // moving the parcel beside it) -> "3b66a749" (the West End) ->
    // "e2618729" (the City and the north east) -> "42a3be46" (the
    // department store's parcel) -> "2701a59f" (the 41 venue and service lots
    // carved out of the blocks behind them) -> "43cb7474" (the parcel-side
    // truth pass moved ~30 parcels to their id-named kerbs) -> "19732aee"
    // (per-end trimming re-centred nearly every junction-adjacent parcel)
    // -> "20bc11a6" (the void-fill's 19 new blocks) -> "9bd856fe" (the
    // Notting Hill grid's parcels and fabric) -> "6aae7b1a" (set zoning:
    // under this suite's unloaded-model mock the zoned blocks fall back to
    // the same facade rects, but through the building layer's deferred
    // closure, which lands them at a different point in the draw order —
    // drawCount itself is unchanged) -> "07bc0342" (the Bayswater band rows
    // and the two reworked greens) -> "691daf05" (the quarter environs) ->
    // "21059cb0" (the coverage sweep) -> "b388672d" (the tuck-and-connect
    // pass moved the boulevard parcels 2.1 m kerbward with their strips)
    // -> "5d77fb7e" (the kerb-green round: the Notting Hill and Mall
    // bands took the boulevard set-back, and the corner parcels on the
    // streets that tee into those ribbons retreated behind them) ->
    // "1a7bec1f" (the west fills, plus Royal Hospital Road's south band
    // deepened 32 -> 58 m to close the embankment bend) -> "95fb04ad" (the
    // eastern fills, and Victoria Street's west band re-authored onto a
    // single segment after the first cut chorded through its own 70-degree
    // bend) -> "d48b5787" (the crescent island's blocks retired) ->
    // "518fda0c" (the flush-stack sweep's parcel moves and the Mall's
    // mid band) -> "63fff32c" (the void-kill round's first twenty-two
    // blocks) -> "ed6657d2" (its second half's twenty-five).
    // -> "8134d2c0" (the third pass).
    // -> "b6d62194" (the fourth pass).
    // -> "ea7be17e" (the residual slabs).
    // -> "3872be7f".
    // -> "06c3d328" (fabric street edges named; spawn corner re-grammar).
    // -> "9bf224d2" (the quiet island's north band replaces the dead
    // full-island block).
    // -> "acca2147" (the Gloucester ribbons run to their junctions and the
    // corner parcels re-deal — same draw count, shifted assignment).
    // -> "3e14705f" (four kerb ribbons pinned parkStyle lawn — their trail
    // paths retired — and the bayswater T-seam terrace joins the row).
    // -> "951724c0": the building-collision-visual-parity plan's Phase 3 —
    // asset-slot fallback entries are now exact undecorated proxy boxes
    // (named/positioned per plan entry) rather than a re-derived facade
    // grid; the genuinely-procedural meshes underneath are unchanged.
    // -> "5b48e8b8": the three-city visual-gap-elimination plan's Cornmarket
    // P0 (Section 10.2) — `-w`'s civic backdrop pushed back 8.5 m
    // (extraInsetM) to make room for the new close frontage in front of it.
    // Same cell count (40 m depth unchanged, so drawCount stays 972), every
    // cell's world position shifts with the block.
    facadeMeshFingerprint: "5b48e8b8",
  },
  "tokyo-setagaya": {
    // drawCount unchanged by the building-collision-visual-parity plan:
    // Tokyo had no building-set blocks at all at the time (every block was
    // directly procedural), so its render-time draw sequence and its
    // plan-time draw sequence were already identical — moving the draws
    // from render time to plan time relocates them without changing their
    // count, order, or the meshes they produce. The one map where old and
    // new drawCount agreed exactly was exactly the proof that the planner
    // reproduces the current full-detail draw order byte-for-byte (Section
    // 7.4). This stopped being universally true the moment the Tokyo
    // authenticity plan's P2 gave Tokyo its first `buildingSet` blocks
    // (see the drawCount entries below from that point on) — the proof
    // itself is unaffected (it was about `planMapBuildings` reproducing
    // the OLD render-time order, a one-time historical check, not an
    // ongoing invariant this suite polices going forward).
    // 216 -> 7_215 (Tokyo expansion Phase 4, blocks/street wall, R18): 296
    // blocks now exist (9 hand-authored quarter + 287 generated), all
    // procedural (Tokyo still has no building-set blocks, so the "old and
    // new drawCount agree exactly" proof above still holds structurally,
    // just at the new scale) - three random() draws per surviving facade
    // cell, and planMapBuildings reports 2_401 planned procedural buildings
    // for this map post-Phase-4 (matches 7_215 / 3 = 2_405 within the small
    // reconciliation gap expected from cells that draw before their own
    // survival check fails). A real, large, deliberate increase - not
    // drift - driven entirely by the new block count.
    // 7_215 -> 6_687 (Tokyo expansion Phase 6, parks, R4): 274 blocks, down
    // from 296 — Kitazawa-kōen and Minami-kōen each own a real short-segment
    // cell outright (displacing several generated parcels apiece) and five
    // pocket greens each displace one short parcel; one parcel is restored
    // by a manual patch (`jp-blk-jp-higashi-hondori-2-p-south`, the tower
    // plaza's own partial overlap — see `TOKYO_PHASE6_PARKS`'s comment in
    // cities/tokyo.ts). Fewer blocks means fewer facade cells to draw, the
    // same direction as every other block-count-driven move on this map;
    // parks themselves contribute no facade-grid draws at all (they are not
    // `buildingSet` blocks).
    // 6_687 -> 5_451 (Tokyo expansion Phase 10, perf remediation): the
    // dense-street draw-call budget gate (plan §8.11) measured the Chuo-dori
    // x Ekimae-dori scramble at ~71% over NYC's own reference, root-caused
    // to `facadeGridCells`' `density` knob defaulting every zone to a 3x3
    // grid (`count = round(3+density*7)` = 8-9 across the old 0.66-0.85
    // range) when only its front row is ever visible from a road-facing
    // camera — rows 1-2 sit directly behind it with no lateral gap. Pulled
    // `downtown`/`ring`/`riverside` (the zones actually inside the
    // scramble's 440 m night-fog bubble) into the 0.3-0.4 band so `columns`
    // holds at 3 (same street-facing building count) while `rows` drops to
    // 2 — fewer facade cells survive to draw, hence fewer random() draws.
    // `miyanosaka`/`yamashita`/`nishi`/`higashi` (nowhere near the scramble)
    // stayed at their original density, or slightly above it where the
    // resulting shift in facadeGridCells' shared random-draw order needed a
    // touch more margin against `tests/tokyoContent.test.ts`'s per-district
    // walled-kerb floor — see `TOKYO_ZONE_STYLE`'s own comment in
    // `cities/tokyo.ts` for the full reasoning and the measured before/after
    // draw-call numbers.
    // "2dda315a" -> "01d2bc4a": mesh naming only (see comment above).
    // "01d2bc4a" -> "6875ac93": Phase 4's ~2_400 new planned buildings
    // change both which names exist and how many, so the fingerprint moves
    // with drawCount this time - not a naming-only change like the last one.
    // "6875ac93" -> "2cf0d55b": Phase 6's -528 draws above.
    // "2cf0d55b" -> "10723f14" (Tokyo expansion Phase 7, venues/addresses,
    // R6/R7/R8): drawCount is UNCHANGED at 6_687 — this phase adds 41 gig
    // venues and a second gas+repair pair but touches zero blocks, so the
    // facade grid's own candidate cells and their survival count are
    // identical. Mesh naming only, the same class of move as the
    // "2dda315a" -> "01d2bc4a" line above: the venues/service points build
    // ahead of the facade grid in the scene-plan pass and shift whatever
    // shared ordinal the mesh names embed, without changing which cells
    // draw or in what order.
    // "10723f14" -> "2b85874f": Phase 10's -1_236 draws above — fewer
    // surviving cells changes both which names exist and how many, the same
    // class of move as "01d2bc4a" -> "6875ac93".
    // 5_451 -> 5_559 (+108, "2b85874f" -> "2fa27cb2"): the SAME Phase 10 perf
    // pass's visual-gap remediation — `tokyoPhase10RingRoadKerbPatches`
    // (cities/tokyo.ts) fills 6 of the 15 candidate bare-kerb gaps its own
    // full-scope `--fan --full-matrix` audit found on the two long ring
    // roads (the other 9 candidates correctly produced nothing: 4 overlap an
    // existing pocket green's frontage, the R18 exemption; 5 lost to a
    // genuine conflicting road at a junction corner). New surviving cells,
    // same direction as every other block-count-driven move on this map.
    // 5_559 -> 4_551 (-1_008, Tokyo authenticity plan P2): `tokyo-house`/
    // `tokyo-shotengai` go live on miyanosaka/yamashita/nishi and
    // jp-nakamise-yokocho — those 46 blocks now take `planAssetSlotBlock`
    // (asset-slot, planned once in `planMapBuildings`'s own call, never
    // this render-side stream) instead of `planProceduralBlock`, so they
    // stop drawing from this stream entirely. Exact, not approximate:
    // `facadeGridCells` is deterministic on a block's own size/density
    // (no keepout awareness — every CANDIDATE cell draws its 3 random()
    // calls before the survival check, unlike Cairo's frontage-overlap
    // `continue`, which fires before the height draw), so summing it over
    // every block that does NOT carry a buildingSet gives 1_517 candidate
    // cells x 3 draws/cell = 4_551 exactly, confirmed by recomputing it
    // directly against the real map data rather than assumed from the
    // baseline delta alone. Fingerprint moves for the same reason as every
    // other cell-count-driven baseline in this file — different cells
    // exist, so different names/positions do.
    //
    // 4_551 -> 1_701 (-2_850, Tokyo authenticity plan P3b): `tokyo-zakkyo`
    // goes live on the rest of downtown (outside `jp-nakamise-yokocho`) +
    // ring, `tokyo-manshon` on riverside + higashi — every generator zone
    // now names a set, so only the ~1-in-4 street-wall holdback parcels
    // (`tokyoParcelKeepsFacadeBoxes`), any back-edge-demoted parcel
    // (`tokyoBackEdgeNearsARoad`), and the 9 hand-authored quarter blocks
    // still draw from this stream. 1_701 / 3 = 567 candidate cells, close
    // to (not identical to — this stream counts pre-survival CANDIDATES,
    // `planMapBuildings`'s own `procedural-cell` count of 526 counts
    // post-survival SURVIVORS) the real map's now much smaller procedural
    // remainder. Fingerprint moves for the same reason as every other
    // cell-count-driven baseline in this file.
    //
    // 1_701 -> 1_821 (+120, Tokyo authenticity plan P4, Region B): four new
    // roads add their own ~1-in-4 holdback parcels (`tokyoParcelKeepsFacadeBoxes`)
    // to the same stream, and resegmenting `jp-sangen-dori`/`jp-koshu-kaido`
    // (the two mid-span node insertions) shifts which of THEIR pre-existing
    // parcels draw from it too. Fingerprint moves for the same reason as
    // every other cell-count-driven baseline in this file.
    //
    // 1_821 -> 2_028 (+207, Tokyo authenticity plan P5, Region A): six new
    // roads add their own ~1-in-4 holdback parcels to the same stream, and
    // resegmenting `jp-miyanosaka-kita-dori` (the one mid-span node
    // insertion) shifts which of ITS pre-existing parcels draw from it too.
    // Fingerprint moves for the same reason as every other cell-count-driven
    // baseline in this file.
    //
    // 2_028 -> 2_448 (+420, Tokyo authenticity plan P7, Region D): four new
    // roads (`jp-minamimachi-dori`/`jp-shion-dori`/`jp-susuki-dori`/
    // `jp-nadeshiko-dori`) add their own ~1-in-4 holdback parcels to the same
    // stream, and resegmenting `jp-chuo-dori-south` (its own new south
    // extension) and `jp-minami-kaido` (a second mid-span node, past Region
    // C's own first one) shifts which of their pre-existing parcels draw
    // from it too. Fingerprint moves for the same reason as every other
    // cell-count-driven baseline in this file.
    //
    // 2_448 -> 2_538 (+90, Tokyo authenticity plan P8, Regions E+F): four new
    // roads (`jp-sazanka-dori`/`jp-hiiragi-dori`/`jp-kawasemi-dori`/
    // `jp-kawabata-dori`) add their own ~1-in-4 holdback parcels to the same
    // stream, and resegmenting `jp-nishi-kanjo-dori`/`jp-kanpachi-dori`/
    // `jp-miyanosaka-kita-dori`/`jp-chuo-dori-north`/`jp-kawate-dori` (the
    // mid-span/appended insertions) shifts which of their pre-existing
    // parcels draw from it too. Fingerprint moves for the same reason as
    // every other cell-count-driven baseline in this file.
    //
    // drawCount unchanged at 2_538, fingerprint moves (Tokyo authenticity
    // plan P10): fixing tokyo-konbini's real facing bug (modelLibrary.ts's
    // PROP_MODEL_REGISTRY yawOffset was showing every konbini venue's blind
    // side to the street; the fix rotates it 90 degrees and swaps
    // PROP_MODEL_FOOTPRINTS_M's X/Z spans to match) shifts each konbini
    // venue's own keep-out footprint by the same rotation — same total area
    // excluded from the procedural stream, but a different specific set of
    // cells near each venue, so the same cell COUNT survives while WHICH
    // cells and their world positions differ.
    //
    // 2_538 -> 3_177 (+639, post-plan void-frontage fill): 27 new
    // procedural blocks — 19 seam/arterial strip patches
    // (`tokyoVoidFrontagePatches`) plus 8 hand micro blocks — each deals
    // its own facade cells from this stream. NYC/London/Cairo rows are
    // byte-identical, the per-map gate this suite exists for.
    // 3_177 -> 3_312 (rail feature): the corridor carve's Tokyo block
    // fragments re-derive their facade grids at the new rect sizes —
    // density is a grid-RESOLUTION knob, so two fragments deal more cells
    // than their parent did. London/NYC hold: their carved parcels are all
    // building-set strips with no facade-grid cells.
    drawCount: 3_312,
    facadeMeshFingerprint: "4689c992",
  },
  "cairo-central-nile": {
    // 15_517 -> 4_288 (fingerprint "22b5588d" -> "b6f29f68"): the
    // building-collision-visual-parity plan's Phase 2/3, same cause as
    // London's move above. Cairo's 471 building-set blocks no longer
    // redraw a whole-block procedural fallback when every glb is
    // unavailable; what remains is Cairo's genuinely direct-procedural
    // content (179 non-building-set blocks) planned once, in the fixed
    // width-then-depth-then-height order per surviving cell.
    //
    // 4_288 -> 4_414 (fingerprint "b6f29f68" -> "e2b02700", +126): the six
    // `cairo-galaa-ne-land-edge-wall-{1..6}` closures (visual-gap plan
    // Section 12.5). Each is a bare procedural block with no buildingSet,
    // so it takes the same facade grid as any other -- 9 candidate cells
    // per block from its own density, of which only 3 survive
    // `cairoFrontageFootprintsOverlap` (the other 6 collapse to the same
    // position once `frontageAxis: "z"` pins every cell to its row's own
    // depth). Every cell draws width+depth (2 calls) before the overlap
    // check; only a surviving cell draws a 3rd (height). Per block: 3
    // survivors * 3 + 6 rejected * 2 = 21 draws; 6 blocks * 21 = 126.
    //
    // 4_414 -> 4_476 (fingerprint "e2b02700" -> "09026368", +62): the three
    // `cairo-dokki-sw-land-edge-wall-{1..3}` closures (Section 12.6). Same
    // mechanism, but not all three land on the usual 3-of-9 survivor split
    // -- the two 19/18.5 m pieces do (3 survivors * 3 + 6 rejected * 2 = 21
    // draws each), the short 9 m third piece only keeps 2 of its 9 cells
    // (2 * 3 + 7 * 2 = 20 draws). 21 + 21 + 20 = 62, measured before this
    // was written, not assumed from the other blocks' own count.
    //
    // 4_476 -> 4_586 (fingerprint "09026368" -> "2ebb9e83", +110): Section
    // 12.7. Two small `cairo-galaa-ne-land-edge-wall-4`/`-5` resizes (a
    // seam-tightening, no cell/survivor-count change for either -- both
    // still keep 3 of 9) plus five new
    // `cairo-west-nile-street-mid-land-edge-wall-{1..5}` closures, each
    // keeping only 2 of its 9 cells. Unlike the two baselines above, this
    // delta was NOT independently re-derived to an exact formula: a plain
    // "5 blocks * 20 draws (2 survivors * 3 + 7 rejected * 2)" guess gives
    // 100, not the measured 110, meaning at least one of these five
    // rejects some cells via `survivesReservations` (which still draws
    // height, 3 calls, before the cell is dropped) rather than the
    // frontage-overlap check the other sites' math assumed throughout
    // (2 calls, no height draw) -- the real mechanism was not traced
    // further. The measured number is trusted; the arithmetic behind it
    // is not claimed to be exact, per this suite's own honesty standard.
    // 4_586 -> 4_557 (rail feature): the Imbaba corridor carve's block
    // census change above, same mechanics as the Tokyo entry.
    drawCount: 4_557,
    facadeMeshFingerprint: "4f60c748",
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
    // 120s -> 180s for the same reason `buildingLayerCharacterization`'s did
    // — see the note there. This loop is the faster of the two (~19s alone),
    // but it timed out in the same full-suite run, so both budgets move
    // together rather than leaving one to fail next time the scene grows.
    180_000,
  );
});
