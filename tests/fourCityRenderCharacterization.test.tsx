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
    // 23_007 -> 27_394 (active 846 -> 961): the building-collision-visual-
    // parity plan's Phase 3. Under this suite's forced-every-model-unavailable
    // mock, every asset-slot entry used to fall through to `BuildingLayer`'s
    // whole-block `placed === 0` callback, which re-derived a COARSE
    // `facadeGridCells` grid (3-10 boxes) for the entire block regardless of
    // how many real buildings `slotBlockBuildings` had actually planned for
    // it — NYC's dense high-rise blocks (`slotBlockBuildings` packs dozens of
    // buildings per block) were drastically under-represented by that grid.
    // Every planned asset-slot entry now gets its own exact per-solid proxy box
    // instead (Section 7.7), so the mesh count now correctly tracks the real
    // 5_305 planned building count rather than a coarse block-level
    // approximation. Materials and the surviving-material fingerprint are
    // unchanged: proxies reuse the same per-block-material palette
    // `ProceduralFacades.materialFor` already caches.
    // 27_394 -> 27_447 (visual-gap plan Section 11.2, P0): the same West End
    // Ave west-margin fix as `buildingLayerCharacterization.test.tsx`, which
    // independently confirms +68 real planned buildings (5_305 -> 5_373, all
    // single-solid `asset-slot` entries, verified directly against the plan).
    // This suite's own count only moved +53. Re-run and reproducible, not
    // measurement noise, but the exact sub-population accounting for the
    // 15-mesh gap between "buildings added" and "proxy meshes added" under
    // this forced-unavailable mock was not traced further — the render-scene
    // detail this metric exists to guard did not regress (materials,
    // draw calls, the surviving-material fingerprint and mirror counts are
    // all unchanged), and the content-correctness these two new blocks exist
    // to prove is independently verified by content.test.ts's block-geometry
    // test and a real camera-fan audit re-run, not by this mesh count.
    // 27_447 -> 27_468 (Section 11.3, P0): the Fifth Avenue Gallery
    // residual-cell fix, +44 planned buildings (5_373 -> 5_417) against +21
    // meshes here — the same sub-1:1 pattern as 11.2 above, same reasoning
    // for not chasing it further.
    // 27_468 -> 27_481 (Section 11.4, P0): Queensbridge Green grown from
    // 110x200 to its full 124x454 null-cell, +13 meshes — the generic
    // `resolveParkStyle`/path/scatter/wall system scaling its own output to
    // the larger footprint (still `urban_greensward`, unchanged style), not
    // a building-count change (`buildingLayerCharacterization.test.tsx`
    // does not move here, correctly: no block was touched, only a park).
    // 27_481 -> 27_539 (Section 11.5, P0): the bk40/bk56 outer shells, +58
    // meshes — a clean 1:1 match against the +58 planned buildings this
    // time (single-solid proxies, same as every other asset-slot entry).
    // 27_539 -> 27_495 (Section 11.6, P0): the Queens riverbank park (three
    // new "riverside_strip" landmarks, south/main/north) plus relocating
    // nyc-v31 off the park's own kerb — net -44 meshes (the -4 planned
    // buildings that venue's keep-out now excludes dominate over whatever
    // the three new park segments themselves add). Materials 188 -> 191
    // and mirrorDrawn 116 -> 119: the new segments' own path/wall/furniture
    // materials and their mirror reflections, the first park content this
    // plan has added to NYC since the west-margin/gallery/Queensbridge
    // sites were all plain grass-only or building-only. Not traced further
    // per the same reasoning as 11.2/11.3 above; the fingerprint moves
    // because the material set genuinely changed, and the content
    // correctness this exists to guard is independently verified by
    // content.test.ts and a real camera-fan audit re-run, not this metric.
    // 27_495 -> 27_197 (Section 11.7, P1): Riverside Park widened to meet
    // Riverside Drive's pavement, plus the new Hudson water body — deliberately
    // overlapping the park's existing interior by 4-17 m along its full
    // 1934 m length to close the grass/water seam (Section 11.7's own
    // instruction). `parkLayoutForLandmark` treats a water polygon as a
    // planting keep-out (docs/greenery.md), so that overlap band's existing
    // trees/shrubs/furniture are correctly no longer planted there — a real,
    // intended reduction, not a regression, and large enough (up to
    // ~17m x 1934m of park interior) to explain a net mesh drop even after
    // the wider east edge and the Hudson's own new water mesh are added
    // back in. activeMeshes/materials/mirrorDrawn each move by 1: the new
    // water surface entering the free-drive camera's initial frame and its
    // own material/reflection.
    // 27_197 -> 26_932 (Section 11.8, P1): reshaping the East River
    // esplanade to meet Third Ave's pavement and the water edge exactly.
    // Checked, not assumed: the esplanade's own placement/wall counts
    // (`parkLayoutForLandmark`, queried directly) move from 225/615/214
    // placements and 8/14/8 wall spans (south/main/north) to 226/644/226
    // and 7/9/7 — net +42 placements, -7 walls, i.e. the park's own content
    // grew, the opposite direction of this net mesh drop. The
    // margin-block trim only removes 2 buildings (see
    // buildingLayerCharacterization.test.tsx above). Neither accounts for
    // the size of this delta; no further plausible mechanism (a block
    // newly excluded by the wider west edge, a water-overlap keep-out
    // matching Section 11.7's) survived checking, so the remainder is
    // unattributed. The content correctness this fix exists to prove is
    // independently verified by content.test.ts's exact-edge/overlap tests
    // and a real camera-fan audit re-run on Third Ave, not this metric.
    // 26_932 -> 26_926 (issue #389): both rivers' park-facing shores ruled
    // straight onto their parks' own rect edges, so neither draws over a lawn
    // and neither park's wall stands in the water any more. Fully attributed
    // for once, by diffing the mesh-name census either side of the change:
    // -8 bridge lamps (each bridge's lamp line is clipped to its OVER-WATER
    // span, and the East River's east shore moved 5-18 m west, so both decks
    // drop their outermost pole+head on the Queens side: 2 bridges x 2 sides
    // x (pole + head)) and +2 park lamps on the strip of Riverside Park that
    // stopped being underwater. The park scatter's own +103 placements
    // (`parkLayoutForLandmark`, queried directly: riverside-park 488 -> 530,
    // queens-bank 386 -> 434, queens-bank-south 139 -> 152) contribute
    // nothing HERE, because planting is glb-backed and this suite forces
    // every model unavailable — they are real meshes in the browser.
    // Materials, active meshes, draw calls, mirrors and the fingerprint all
    // hold: no material was added or lost, only water polygon vertices.
    // -> 29_847/29_797 (+2_921 total; rail feature, the borough freight
    // lead): ~2_500 instanced sleepers over the full 3 km Queens run, 7
    // generated crossings x 12 gate meshes, the rails and segmented ballast
    // strips, and the corridor carve's re-deal of the strip blocks (the
    // bk40/bk56 shells split into rail-flank fragments). The 50-mesh
    // total/enabled gap is the disabled two-train freight consist. materials
    // 192 -> 202: the four track/bridge paints plus the train's six.
    // activeMeshes/mirrors hold — the line sits a map-width east of this
    // suite's fixed west-side pose.
    // materials 202 -> 204: rail-brick/rail-platform are minted for every
    // rail city once the London viaduct/terminus recipes exist, used or not.
    // materials 204 -> 205: rail-deck, minted per rail city (no bridge
    // meshes here — the Queens line never crosses water).
    // activeMeshes 962 -> 963 (Tokyo street-lighting pass): the shared lamp
    // light-pool decal grew 7 -> 10 m, so one more streetlight's pool box
    // crosses the fixed pose's frustum edge. Totals hold — NYC's lamp count
    // and per-lamp part list are untouched by the Tokyo-only retune.
    totalMeshes: 29_847,
    enabledMeshes: 29_797,
    activeMeshes: 963,
    materials: 205,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 81,
    mirrorDrawn: 120,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    // "91c8963c" -> "2d9d1a4b": the ten rail materials above.
    // -> "757ab7bb": +rail-brick/+rail-platform (see the materials note).
    // -> "1cadf565": +rail-deck (bridge-fix pass).
    survivingMaterialNamesFingerprint: "1cadf565",
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
    // 7_609 -> 7_611 (active 699 -> 701, materials 295 -> 302): the Chelsea
    // superblock's seven greens, all pathless lawn, and the King's Road ribbon
    // deepened to lap under its pavement. Nearly a wash on mesh count because
    // the big square shipped for one round as a derived greensward (7_652 —
    // walks, benches, lamps and 8 wall runs) and lost all of it when the
    // railing was rejected; `lawn` scatters more trees but no furniture. No
    // block moved, so the facade pins below and in the building-layer
    // characterization must NOT move with it.
    // 7_611 -> 9_600 (active 701 -> 878): the building-collision-visual-parity
    // plan's Phase 3, same cause as NYC's and Cairo's moves above — under
    // this suite's forced-every-model-unavailable mock, the OLD whole-block
    // procedural fallback (a coarse `facadeGridCells` re-derivation,
    // independent of how many buildings were actually planned for the block)
    // is replaced by an exact, undecorated per-solid proxy box per planned
    // asset-slot entry (Section 7.7). No map content moved.
    // 9_600 -> 9_597: the three-city visual-gap-elimination plan's Cornmarket
    // P0 (Section 10.2) — a new close frontage flanking Guild Lane Pharmacy
    // (its coarse keep-out relaxed to its exact solid) plus a new right-side
    // frontage add planned buildings, while `-w`'s civic backdrop (pushed
    // back 8.5 m to make room) plans fewer procedural cells at its shifted
    // depth/position; net -3 boxes under this suite's forced-unavailable
    // mock. No block outside Cornmarket moved.
    // 9_597 -> 9_579: the Regent Street P0 (Section 10.3) — Piccadilly-to-
    // Regent-1 and Regent-5-to-Oxford frontage, two surviving roadsideParcel
    // blocks (the west side at each end was tried and dropped — see the
    // content comment at london-block-regent-e-piccadilly). Planned
    // building count over the whole map went *up* net +6 (4_686 -> 4_692,
    // confirmed directly against planMapBuildings, and matching
    // buildingLayerCharacterization's own -1-from-4_387 delta for the same
    // final drop) — this file's mesh count moving the opposite direction is
    // a measured fact, not fully attributed to a specific cause; it is not
    // itself a planned-building regression, and the full suite (collision,
    // pavement, content) is green. Worth a closer look if a future change
    // needs to reason precisely about this file's number, not just pin it.
    // -> 9_590: the Euston/Upper Street T-junction P0 (Section 10.4) —
    // london-block-nes-fab-a-north's 2 new slots, +2 meshes this time
    // (matching buildingLayerCharacterization's own +2 exactly).
    // -> 9_595: the Shoreditch/Canonbury north-east oblique-edge P0
    // (Section 10.5) — london-block-canonbury-ne-fab-north's 5 new slots,
    // +5 meshes (matching buildingLayerCharacterization's own +5 exactly).
    // -> 10_242/10_206 (+647 total; rail feature, the Grosvenor viaduct):
    // ~560 instanced sleepers along the fully elevated 648 m line, the brick
    // viaduct's parapet segments and road-dodging piers, the Thames girder
    // span's deck/girders/stretched piers, the Chelsea Riverside terminus
    // platforms + buffer, and the corridor carve's block re-deal. The
    // 36-mesh total/enabled gap is the disabled three-car EMU. materials
    // 302 -> 314: the six rail track/structure paints plus the train's six.
    // activeMeshes holds — the line is across the map from the fixed pose.
    // -> 10_249/10_213 (+7; bridge-fix pass): Thames-span girder flanges
    // + flange master. materials +1: rail-deck.
    // -> 14_588/14_552 (+4_339): London goes NIGHT, and with it gets the
    // street lighting it never had. 1_076 scattered streetlights at 26 m
    // kerb-seated and alternating, each four meshes (column, arm, emissive
    // head, and the ground light pool a night palette turns on) = +4_304;
    // the rest is the one-time re-deal of the tree and sign lines that
    // inserting a kind ahead of them causes (trees 637 -> 658, signs 72 ->
    // 62). materials +1 and a new fingerprint: `lamp-pool`, built only under
    // a night palette. (Three of those lamps existed briefly on an
    // intermediate tree and were rail-corridor/forecourt intrusions — see
    // `roadCrossedRects`.)
    //
    // activeMeshes 878 -> 500 — DOWN, and the whole point of the number:
    // night clamps the fog band to 440 m where London's own `fogEndCapM`
    // capped it at 800, so a thousand new lamps still leave far fewer meshes
    // in frustum than before. The map got brighter and cheaper at once.
    // -> 14_345/14_309 (facade-chunk merging, the Cairo reimagining's
    // cross-city render change): London's own modest procedural-box
    // population merges the same way.
    // -> 14_342/14_306: Gloucester's two long ribbons and Park West become
    // pathless lawns, retiring the three cross-path meshes that would end in
    // the new raised curb/building grass bands. The bands stay inside each
    // lawn's existing mesh and therefore add no draw or mesh of their own.
    // -> 16_707/16_671, 571 active, 332 materials (London neighbourhood
    // and Thames revamp): thirteen connected streets and their fine-grain
    // frontage add the missing urban fabric; seventeen promenade runs add
    // broadleaf trees, short black lamps, benches and parapets; three
    // reauthored parks replace the disconnected Chelsea lawn stamps.
    // -> 18_265/18_229, 606 active (whole-map urban-fabric coverage): 69
    // safe courtyard cells and 61 genuinely deep parcels add modelled London
    // fabric; shallow strips remain one-row and do not duplicate meshes.
    // -> 18_498/18_462, 649 active: Kensington Park Road's two fitted
    // frontage walls and the internal courts of oversized perimeter blocks
    // close the marked west-London concrete fields.
    totalMeshes: 18_498,
    enabledMeshes: 18_462,
    activeMeshes: 649,
    materials: 332,
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
    // 217 -> 224: the Chelsea greens add lawn planes within the spawn's
    // mirror radius; the candidate count is unchanged.
    // (Unmoved when the square's railing went: walls are not mirror surfaces.)
    // 45 -> 87 / 224 -> 226 with the night streetlight line: a lamp's column,
    // arm and head each file into the static-cell hash the mirror ring reads
    // (its ground pool does not — `castShadow: false` skips registration
    // entirely), so the quiet loop's own lamps roughly double the candidate
    // ring around the spawn.
    mirrorCandidates: 81,
    mirrorDrawn: 268,
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
    // -> "e265e06c": the Chelsea garden square's greensward materials (walk,
    // railing, bench and lamp) and its six lawns' planting variants.
    // -> "0b06ec67": the twelve rail materials above.
    // -> "41d18af1": +rail-deck (bridge-fix pass).
    // -> "0414a968": +lamp-pool, the streetlights' additive ground-spill
    // material, which only a night palette builds.
    // -> "829f69cb": London promenade and formal-garden materials.
    survivingMaterialNamesFingerprint: "829f69cb",
  },
  "tokyo-setagaya": {
    // Phase 1 of the Tokyo expansion (night + paved): +88 meshes from the
    // new PROP_STREETLIGHT scatter (column + arm + emissive head + night
    // ground-light-pool quad per lamp) now placed along every road; +1
    // material for the streetlight's emissive head; mirror candidate/drawn
    // counts shift because the new lamps and the widened paved sidewalks
    // move what falls inside the fixed test pose's mirror cull ring.
    // -> Phase 2 (road-network skeleton + all three residential-web
    // districts): worldSize 600x420 -> 2600x2400 and 5.5 -> ~62 lane-km (66
    // roads, 338 lanes: the west-of-river ring/downtown skeleton plus
    // Miyanosaka North, Yamashita South and Nishi) pushes every length-scaled
    // draw (asphalt strips, kerb/junction fills, pavement rails) and the ~93
    // generated stop-sign installations up by roughly the same order the
    // lane-km grew; materials barely move because they are shared/instanced
    // (one asphalt material, one stop-sign material, ...), not per-mesh —
    // the same pattern Phase 1's own +88-mesh/+1-material line shows.
    // activeMeshes/mirrorCandidates/mirrorDrawn shift because the fixed test
    // pose's mirror cull ring now includes far more of the new network.
    // -> Phase 3 (river + three bridges + east-bank web): +13 roads (66->79)
    // and the jp-sakuragawa water sheet/shoreline push every length-scaled
    // draw further; the three bridges' bespoke dressing (parapet/guardrail/
    // lamp materials per bridge, +1 vermilion for Kawanaka-bashi) and the
    // corniche-parapet promenade pass (new for Tokyo this phase) are real,
    // deliberate new meshes/materials, not drift — confirmed by dumping
    // `survivingMaterialNames` for tokyo-setagaya under a temporary
    // console.log and reading every new entry: corniche-parapet (the
    // promenade generalisation), jp-<bridge>-lamp/parapet/steel x3,
    // jp-kawanaka-bashi-vermilion (the arch rib), landmark-jp-<bridge> x3
    // (every landmark gets one whether or not the bespoke dispatcher uses
    // it — same as every existing landmark already did), water-jp-sakuragawa.
    // -> Phase 4 (blocks, street wall, R18): 296 blocks (9 hand-authored
    // quarter + 287 generated, buildTokyoGeneratedBlocks in cities/tokyo.ts)
    // walling both kerbs of every non-bridge generated road. 16_906 -> 8_804
    // total/enabled meshes is a DECREASE despite ~2400 new planned buildings
    // ("building"-prefixed mesh count 68 -> 2401, +2333, confirmed by
    // bucketing __sideswapMeshes() by name prefix under a temporary
    // console.log) because roadside SCATTER PROPS (streetlights, utility
    // poles, vending machines, trees, signs - generateRoadsidePropPlacements,
    // which explicitly rejects a candidate position that falls inside a
    // block) lost far more than buildings gained: "prop"-prefixed mesh
    // count 15_598 -> 5_163 (-10_435), net -8_102, matching the observed
    // delta exactly. Before this phase Tokyo's ~77 lane-km of road had
    // essentially no street-wall blocks, so nearly every prop candidate
    // found clear ground; now that most kerbs are walled (R18's actual
    // goal), a large share of those same candidate positions land inside a
    // block footprint and get rejected instead. This is a real, expected
    // side effect of buildings now occupying space that used to be open,
    // not drift - Phase 9 (street life/aesthetics) already plans denser
    // prop scatter and can re-tune density against the now-walled kerbs.
    // activeMeshes drops less steeply (1_059 -> 933) because the fixed test
    // pose's mirror-cull frustum only ever held a small, roughly stable
    // slice of the map regardless. materials 114 -> 115: the new
    // "concrete" facade key (the higashi/east-bank zone's second
    // material) rendered in Tokyo's own scene for the first time -
    // confirmed by dumping survivingMaterialNames and diffing; every
    // other new-this-phase block reuses an already-registered key
    // (plaster/tile/wood-plaster).
    // -> Phase 5 (signals/cameras/one-ways/crossings/rail, R10/R11): 42
    // authored `type: "signal"` controls (133 approaches/heads total), 14
    // derived enforcement cameras, 3 new `type: "crosswalk"` controls
    // (shotengai's two real ends + the temple-green gate) plus the
    // scramble's own 6 extra crosswalk/diagonal markings, and a second
    // `railway_signal` level crossing (jp-rail-signal-2, two gate
    // installations) — every one of these reuses ALREADY-SHARED materials
    // (signal-lens-material, scenario-signal-red/amber/green, scenario-stop,
    // scenario-marking, the dark pole/housing and camera masters every other
    // signalled city already registers), confirmed by dumping
    // `survivingMaterialNames` for tokyo-setagaya before/after under a
    // temporary console.log and diffing: the ONLY two new entries are
    // "landmark-jp-setagaya-line-ext-1"/"-ext-2", the rail extension's own
    // two new landmark rects (every landmark gets one material whether or
    // not the bespoke dispatcher uses it, same as every existing landmark
    // already did). enabledMeshes/totalMeshes 8_804 -> 9_549 (+745):
    // installed roadside poles/heads/lenses/housings, camera bodies+lenses,
    // rail-crossing barrier/crossbuck/warning/pole sets (x2 gates x2
    // crossings), crosswalk stripe instances and the 4 new rail-line boxes
    // (2 rails x 2 new landmark segments). -> 9_449 (-100): the same phase's
    // 12 residential one-ways (R11, 4 per web) each drop from 2 lanes to 1
    // (`laneCount: 1`), and a one-way road's own surface carries no
    // centre-dashed marking (nothing to separate two directions of the same
    // carriageway) — 12 roads' worth of dash-segment meshes disappear.
    // activeMeshes 933 -> 1_039: the fixed test pose's mirror-cull frustum
    // now includes some of the new downtown-core signal heads/cameras
    // (unaffected by the one-way pass — none of the converted residential
    // rungs sit in this pose's frustum). mirrorCandidates/mirrorDrawn
    // unchanged (198/172) — the new content sits outside the mirror's own
    // reflection distance, only the frustum-active set moved.
    // Tokyo expansion Phase 7 (venues/addresses, R6/R7/R8): 41 new gig
    // venues (jp-v5..jp-v45) and a second gas+repair pair
    // (jp-gas-higashi/jp-repair-minami) — zero block/road/park changes.
    // Under THIS suite's forced-empty preload (this file's own top
    // comment), `placeProp` never finds a ready model for anything, so
    // every venue (old and new alike) renders via its procedural
    // fallback box, and each fallback's two materials are named
    // `${venue.id}-body`/`${venue.id}-roof` — never shared, never
    // deduplicated by colour. materials 129 -> 222 (+93): 41 x 2 = 82
    // from the new venues alone, plus jp-repair-minami's own several
    // (`repairShopLayout.ts`'s shop is "authored rather than imported" —
    // always procedural regardless of preload — `${id}-shell`/`-apron`/
    // `-door`/`-shutter` and more, confirmed by reading `buildRepairShop`
    // directly), closing the gap to +93. enabledMeshes/totalMeshes
    // 9_828 -> 9_772 (-56) despite +82 raw venue meshes (2 boxes each):
    // the SAME direction as Phase 4's "adding buildings can shrink the
    // total" finding, at venue scale instead of block scale —
    // `facadesAndKeepouts.ts`'s per-venue historical-buffer reservation
    // (`Math.max(footprint.x, footprint.z)/2 + 12`) and the roadside
    // scatter generator's own block/POI rejection both shrink around 41
    // new keep-out circles on an already-dense scatter grid, outweighing
    // the meshes the venues themselves add. activeMeshes 1_037 -> 1_003:
    // the fixed test pose's mirror-cull frustum loses a few of the
    // now-excluded scatter props inside it; mirrorCandidates/mirrorDrawn
    // unchanged (172/210) — no new content sits in the mirror's own
    // reflection distance.
    // Tokyo expansion Phase 8 (Hikari Tower, R15): jp-hikari-tower's
    // procedural render (render/tokyoLandmarks.ts's buildHikariTower) is 51
    // meshes -- four legs x four tapered segments (16), seven cross-brace
    // rings x four sides (28), main deck, mast, upper deck, spire, spire
    // band, beacon and the FootTown-analog podium (7) -- confirmed by
    // bucketing readMeshes() names for an "hikari" substring under a
    // temporary console.log. materials 222 -> 227 (+5): four of the
    // tower's own (orange/white/deck-glow/beacon) plus
    // "landmark-jp-hikari-tower", the always-allocated pre-dispatch
    // material every landmark gets whether or not its bespoke renderer
    // uses it (same as every existing landmark). enabledMeshes/totalMeshes
    // 9_772 -> 9_821 is +49, not the raw +51: bucketing non-tower mesh
    // names the same way shows 9_772 -> 9_770, a -2 from the new
    // landmark's own scatter-prop keep-out (landmarkClearings plus the
    // roadside generator's own reservation) rejecting two previously-clear
    // candidate positions near the tower plaza -- the same
    // adding-content-can-shrink-the-total direction Phase 4's blocks and
    // Phase 7's venues both already showed, at landmark scale. activeMeshes
    // stays 1_003 -- the fixed test pose's mirror-cull frustum is nowhere
    // near the tower plaza (x=1053, z=140), so this content is outside it
    // either way. mirrorCandidates/mirrorDrawn unchanged for the same
    // reason.
    // Tokyo expansion Phase 9 (street life & aesthetics, R13/R14):
    // `roadsidePropKindsForMap("tokyo")` retunes vending 74->48m and tree
    // 34->36m; three new prop kinds (`chochin-post`, `sakura`,
    // `tokyo-parked-bicycle`); `buildTokyoStreetFurniture` (chochin rows,
    // neon boards, scramble billboards) wired into the registry's
    // `streetFurniture` slot; `generatePromenadeDecor` swaps Cairo's
    // hardcoded "palm"/"streetlight" for a per-map `treeKind`/`lampKind`
    // (Tokyo: "sakura"/"chochin-post"); crowd 56->112. materials 227 -> 242
    // (+15): confirmed by TWO independent measurements agreeing exactly (this
    // jsdom run and a live CDP dev-server census, 836 -> 851) — 6 from
    // roadsideProps.ts's Tokyo-gated `tokyoNightProps` (chochin pole/
    // lantern/cap, sakura trunk + 2 blossom variants — gated on `key ===
    // "tokyo"`, confirmed NYC/London/Cairo's own material counts are
    // UNCHANGED, unlike a first-pass version of this diff that built them
    // unconditionally and moved all four cities' counts by the same +6),
    // 3 from buildTokyoStreetFurniture's own chochin master set, 4 from its
    // neon board colour variants, 2 from its scramble billboard screen/
    // frame. enabledMeshes/totalMeshes 9_821 -> 9_822 (+1), nearly flat
    // despite substantial new content, confirmed live for two reasons: (1)
    // `generateRoadsidePropPlacements` walks one seeded random stream across
    // its `kinds` array in order (streetlight, utility-pole, vending, tree,
    // sign) — retuning vending's spacing shifts how many random() calls its
    // own inner loop makes, which shifts every LATER kind's draws too, not
    // just vending's; live prop-vending 328 -> 458 (+130, spacing-driven) but
    // prop-tree and prop-sign also move by more than their own (tree) or any
    // (sign, spacing unchanged) config change alone would predict — the
    // shared-stream-order effect this file's own Phase-by-phase history
    // never happened to trigger before. (2) The new hand-placed keep-out
    // (`TOKYO_FURNITURE_POINTS`, 55 points: chochin posts, neon boards,
    // billboards, parked bicycles) rejects a few previously-clear scatter
    // candidates near those positions — live prop-streetlight/prop-utility-
    // pole both drop slightly despite unchanged spacing, the same
    // adding-content-can-shrink-the-total direction Phases 4/7/8 above
    // already showed. These roughly net against the new content itself
    // (live: prop-chochin-post 216 combined instances — both the
    // promenade's automatic placements and the hand-placed shotengai/
    // ekimae rows share this name prefix — prop-sakura 200, prop-tokyo-neon
    // 12, the 2 billboards' 4 meshes); the 25 parked bicycles contribute
    // ZERO here specifically because this suite mocks model preload to
    // return empty (this file's own header comment), so
    // `instantiateModelInstanced` returns null and the whole placement loop
    // no-ops — confirmed live the glb DOES render (7 unique submesh
    // draw-call groups shared across all 25 instances). activeMeshes
    // 1_003 -> 1_060 (+57), mirrorCandidates 172 -> 166 (-6): the fixed test
    // pose's mirror-cull frustum reacting to nearby content moving, the same
    // class of drift Phases 6/7's own paragraphs above already document.
    // enabledMeshes/totalMeshes 9_822 -> 9_436 (-386), activeMeshes
    // 1_060 -> 986 (-74): Phase 10's perf remediation (see
    // `facadeGridDrawOrderCharacterization.test.tsx`'s own Tokyo comment for
    // the root cause and `TOKYO_ZONE_STYLE`'s comment in cities/tokyo.ts for
    // the full reasoning) — fewer procedural buildings survive
    // `facadeGridCells` map-wide, and this pose's fixed mirror-cull frustum
    // loses some of them too. `survivingMaterialNamesFingerprint` is
    // UNCHANGED below: no material was added or removed, only how many
    // meshes use the existing ones.
    // enabledMeshes/totalMeshes 9_436 -> 9_444 (+8): the same Phase 10 pass's
    // visual-gap remediation (`tokyoPhase10RingRoadKerbPatches`,
    // cities/tokyo.ts) adds 6 real buildings on the two ring roads' worst
    // confirmed bare-kerb gaps; none sit in this fixed test pose's own
    // mirror-cull frustum, so activeMeshes is unchanged.
    // enabledMeshes/totalMeshes 9_444 -> 9_971 (+527, Tokyo authenticity
    // plan P2): `tokyo-house`/`tokyo-shotengai` go live on
    // miyanosaka/yamashita/nishi and jp-nakamise-yokocho. Under THIS
    // suite's forced-empty preload every asset-slot entry falls to its
    // exact per-solid proxy box (`BuildingLayer.buildProxy`), named
    // `building:<blockId>:slot:<edge>:<n>:solid:body#proxy` — the SAME
    // "building"-prefix bucket procedural cells already used
    // (`building:<blockId>:cell:<n>`), confirmed by bucketing
    // `__sideswapMeshes()` by name prefix under a temporary console.log.
    // That bucket alone moved 1_780 -> 2_451 (+671): re-running
    // `planMapBuildings` on a copy of the map with every block's
    // `buildingSet` stripped (an exact reconstruction of the pre-P2 plan —
    // every converted block already had none, so this reproduces the old
    // seeded-stream consumption order precisely, not an estimate)
    // confirms 1_780 is the true pre-P2 building-mesh count. The remaining
    // -144 is everywhere else in the scene, not a second building effect:
    // the glb sets' real depth (`buildingSetDepthM`, ~13-14 m) sits
    // buildings noticeably closer to the kerb than the procedural grid's
    // 28-40 m depth did, so the roadside scatter generator
    // (`generateRoadsidePropPlacements`) now rejects more candidate
    // positions as occupied — the identical "adding buildings can shrink
    // the total" direction Phases 4, 7 and 8's own paragraphs above
    // already document, at street-wall-conversion scale instead of new-
    // block/venue/landmark scale. materials/survivingMaterialNamesFingerprint
    // are BOTH unchanged: a proxy box reuses `ProceduralFacades.materialFor`'s
    // existing per-materialKey cache (`entry.material` is still
    // wood-plaster/plaster/tile, unchanged), so P2 mints no new material.
    // activeMeshes/mirrorCandidates/mirrorDrawn are also unchanged — none
    // of the converted zones (out on the residential webs and the
    // shotengai) sit anywhere near this fixed test pose's own mirror-cull
    // frustum or NYC-analogue camera position.
    //
    // enabledMeshes/totalMeshes 9_971 -> 10_208 (+237, Tokyo authenticity
    // plan P3b): `tokyo-zakkyo` goes live on the rest of downtown (outside
    // `jp-nakamise-yokocho`) + ring, `tokyo-manshon` on riverside + higashi
    // — every generator zone now names a set (`tokyo-manshon` ships with
    // only 4 of its originally-planned 5 members: `tokyo-apato-b` was
    // live-measured OUT on a real perf regression, see `buildingSets.ts`'s
    // own comment on that set — this suite's numbers already reflect that
    // final 4-member set, not the intermediate 5-member one). Bucketed the
    // same way as P2's own paragraph above (temporary console.log,
    // before/after under `git checkout HEAD~1 -- <content files>` on this
    // same suite): "building"-prefixed mesh count 2_451 -> 2_857 (+406,
    // exactly `buildingLayout.buildings.length`'s own delta — every
    // catalogued model still has one solid, so one proxy box each under
    // this suite's forced-empty preload), "prop"-prefixed count
    // 5_454 -> 5_285 (-169, the identical closer-glb-depth-shrinks-
    // scatter-candidates mechanism P2's paragraph already documents, at
    // four-zone instead of three-web scale — unchanged whether or not
    // `tokyo-apato-b` is in the mix, confirmed by measuring both). Net +237
    // is the OPPOSITE direction from P2's own -144: P2 converted 3
    // residential webs + 1 shotengai road (a smaller building-count gain,
    // +671, outweighed by its own prop loss); P3b converts 4 full zones,
    // and the larger building gain (+406) this time outweighs the smaller
    // prop loss (-169) instead — same mechanism, different net sign,
    // because the converted area is larger this phase. materials/
    // survivingMaterialNamesFingerprint are BOTH unchanged (242,
    // "70de85d2"): every zakkyo/manshon parcel's proxy box reuses
    // `ProceduralFacades.materialFor`'s existing tile/plaster/concrete
    // cache (`TOKYO_ZONE_STYLE`'s own materials, all pre-existing keys),
    // so P3b mints no new material either, the same as P2. activeMeshes
    // 986 -> 947 (-39): the fixed test pose's own viewport frustum reacting
    // to the same building-closer/prop-thinner content shift as the rest of
    // the map; mirrorCandidates/mirrorDrawn unchanged (166/210) — neither
    // the mirror-cull ring's candidate set nor what it draws moved. NOTE:
    // this suite's forced-empty-preload proxy-box world cannot reproduce
    // the live drawCallsPerFrame regression `tokyo-apato-b` caused (a real
    // glb-instancing cost, invisible to a proxy-box characterization) — see
    // the P3b PR body for the live paired measurement that actually caught it.
    //
    // enabledMeshes/totalMeshes 10_208 -> 10_808 (+600, Tokyo authenticity
    // plan P4, Region B): four new roads' worth of street wall/kerb/pavement/
    // scatter (`jp-ekimae-nishi-dori`/`jp-sakuramachi-dori`/`jp-tsukimi-dori`/
    // `jp-nakasuji-dori`) plus 8 new venues, the same class of growth Phase 4's
    // own 296-block street-wall pass and Phase 7's 41 venues already produced
    // at map-build scale (this suite's forced-empty preload turns every new
    // `buildingSet` parcel into a per-solid proxy box, same as P2/P3b's own
    // paragraphs above). activeMeshes 947 -> 965 (+18), mirrorCandidates
    // 166 -> 162 (-4), mirrorDrawn 210 -> 218 (+8): the fixed test pose's own
    // mirror-cull frustum reacting to the new content near
    // `jp-sangen-x-ekimae-nishi`/`jp-koshu-x-nakasuji` (the two mid-span
    // node insertions sit close to this pose), the same class of drift every
    // earlier phase's paragraph above documents. materials 242 -> 258 (+16):
    // NOT root-caused to the same depth as the paragraphs above (would need
    // a live before/after `survivingMaterialNames` dump under this exact
    // suite, not done for this phase) — but bounded, not guessed: this
    // region's `buildingSet` parcels reuse `tokyo-house`/`tokyo-shotengai`'s
    // already-shared materials (same reasoning as P2/P3b's own paragraphs:
    // a proxy box reuses `ProceduralFacades.materialFor`'s existing
    // per-materialKey cache, so that alone mints nothing new here either),
    // Region B posts only 30/40 km/h (both already used elsewhere on the
    // map, so no new speed-limit plate), and 8 new venues is the right
    // order of magnitude for +16 if each contributes a small, fixed number
    // of its own materials the way Phase 6's park landmarks did
    // (`landmark-jp-<id>`, one per new landmark regardless of style) — the
    // real, measured total below is not in doubt; only the itemised
    // breakdown is left for a future pass to confirm.
    //
    // -> Tokyo authenticity plan P9 (street life): totalMeshes/enabledMeshes
    // 14_029 -> 16_374 (+2_345). This suite's forced-empty preload never
    // instantiates a real glb (every venue/prop renders through its
    // procedural fallback here — this file's own header), so the jump is
    // NOT from the 12 re-modelled venues (inert in this suite); it is
    // overwhelmingly the scattered `utility-pole` kind's own population.
    // `generateRoadsidePropPlacements` (headless, scratchpad, the exact
    // seeded call `render/roadsideProps.ts` makes) puts 563 utility poles on
    // the real Tokyo road network — each pole's `partsFor` case grew from 3
    // parts (pole + 2 crossarms) to 7 (+ a transformer can + 3 insulator
    // studs), so +4 mesh INSTANCES per already-scattered pole is +2_252
    // alone (the marginal draw-call cost stays ~0 either way — instancing —
    // this suite counts mesh objects, not draw batches). The rest is the
    // wired hero runs (25 hand-placed poles x 3 parts + 1 merged cable mesh
    // = 76), the Ekimae-nishi chochin extension (11 posts x 4 parts = 44)
    // and the 4 new bicycle pairs; not separately itemised past that bound,
    // same as this file's own P4/P7/P8 entries above. materials 283 -> 287
    // (+4), confirmed by dumping `survivingMaterialNames` and diffing: three
    // new wire-run materials (`tokyo-wire-pole`/`-arm`/`-cable`, Tokyo-only,
    // `render/tokyoLandmarks.ts`) plus one new insulator material
    // (`utility-insulator`, gated `key === "tokyo"` in
    // `render/roadsideProps.ts` exactly like the chochin/sakura bag beside
    // it) — no new unconditional material, so NYC/London/Cairo's own rows
    // stay byte-identical (confirmed: this diff touches no other city's
    // block). activeMeshes 1_054 -> 1_202, mirrorCandidates 174 -> 207,
    // mirrorDrawn 256 -> 262: the fixed test pose's own mirror-cull frustum
    // reacting to the new content near it (the pose sits close to Region
    // B's own shopping street), the same class of drift every earlier
    // phase's paragraph in this file documents.
    //
    // -> Tokyo authenticity plan P10 (final QA): totalMeshes/enabledMeshes
    // 16_374 -> 16_375 (+1). Fixing tokyo-konbini's real facing bug (a 90
    // degree yawOffset correction, PROP_MODEL_FOOTPRINTS_M's X/Z spans
    // swapped to match) shifts each konbini venue's keep-out footprint by
    // the same rotation, which shifts which specific procedural facade
    // cells survive nearby — this suite's fixed pose happens to sit where
    // one additional cell now clears the keep-out that didn't before.
    // Every other figure in this baseline (activeMeshes, materials,
    // drawCallsPerFrame, mirror counts) is unchanged, confirming the delta
    // is exactly this one cell, not a broader shift.
    //
    // -> Owner-reported sideways rows (post-plan): tokyo-house-a and
    // tokyo-apato-a's frontOffset quarter-turn fixes swap their
    // footprintM/depthM, re-dealing every row containing either model.
    // 16_375 -> 16_452 = +77 planned buildings, the same +77 the
    // building-layer characterization pins (this empty-preload suite
    // renders one proxy box per planned building, so the two suites must
    // move in lockstep); activeMeshes 1_202 -> 1_201 is one re-dealt
    // building leaving the fixed pose's frustum. Materials unchanged.
    //
    // 16_452 -> 16_159 (active 1_201 -> 1_224, post-plan void-frontage
    // fill): 27 new procedural blocks ADD facade meshes (+639 facade
    // cells, the facade-grid suite's own move) yet the TOTAL goes DOWN —
    // the new blocks' keep-outs reject roadside prop scatter around them,
    // the same "more blocks, fewer meshes via prop-scatter rejection (not
    // a bug)" effect Phase 4's own baseline paragraph documents. Active
    // rises because the spawn pose now faces new nearby frontage, and
    // mirrorCandidates 207 -> 178 for the same scatter-displacement reason
    // (the mirror ring's cell-hash gathers fewer roadside props nearby).
    //
    // 16_159 -> 19_409 (active 1_224 -> 1_342, mirrorCandidates 178 -> 198,
    // owner-reported dark streets): Tokyo's streetlight kind gained
    // `curbOffsetM` (propCatalog.ts's own comment has the story — the
    // default beyond-sidewalk lamp band was swallowed by this map's tight
    // street wall, leaving 61 of 101 roads with a >120 m dark interval and
    // the downtown core at zero lamps). Kerbside placement survives the
    // rejection: lamp meshes 1_616 -> 4_648 live (~4 meshes per lamp),
    // matching NYC's own 4_768 for the identical spacing config. Only the
    // Tokyo row moves — the other three cities keep the default band.
    //
    // 19_409 -> 19_415 (active 1_342 -> 1_344, owner-reported sideways shop
    // rows): tokyo-shop-d's quarter-turn footprint swap re-deals its rows,
    // +6 planned buildings — the same +6 the building-layer suite pins
    // (lockstep, one proxy per planned building).
    //
    // 19_415 -> 19_658 (+243, active 1_344 -> 1_585; rail feature): the
    // three `kind: "railway"` decal landmarks (6 fixed boxes) retire and
    // `render/railLayer.ts` builds real track along `jp-setagaya-line-run`'s
    // ~360 m polyline instead: ~230 instanced sleepers over the ballast
    // intervals, ~14 rail-segment instances, 5 segmented ballast strips —
    // net +243. materials stays 287 exactly: the three retired
    // `landmark-jp-setagaya-line*` materials are replaced one-for-one by
    // `rail-ballast`/`rail-steel`/`rail-sleeper` (fingerprint moves for the
    // same swap). activeMeshes jumps more than total because the line runs
    // right through the fixed test pose's frustum at spawn.
    //
    // 19_658 -> 19_615 (-43, active 1_585 -> 1_607, mirrorCandidates 198 ->
    // 196; rail centre-section surgery): Renraku-dōri's removal takes its
    // asphalt/shoulder strips, centre-line dashes, roadside parcels and the
    // x-renraku generated signal's 15 head meshes out; the two generated
    // crossings (miyanosaka/shotengai) add 24 gate meshes (2 gates x 6 x 2)
    // plus their approaches' stop-line markings. activeMeshes rises anyway:
    // both new crossings sit inside the fixed test pose's frustum, the
    // removed road was mostly outside it.
    //
    // 19_615 -> 19_640 total (+25) while enabled STAYS 19_615: the procedural
    // two-car tram (trainRender.ts — 11 boxes per car, 3 pantograph parts on
    // the lead car) is built disabled and only enables when a simulation
    // snapshot places it, which this suite's unstepped scene never does.
    // materials 287 -> 293: the tram's six (body/accent/glass/under/roof/
    // lamp), fingerprint moves for the same additions.
    //
    // -> 20_587/20_562 (+947 total, +947 enabled; active 1_607 -> 1_688):
    // the Setagaya Line's east extension (x=280 -> 1306). ~820 instanced
    // sleepers over the new ballast runs plus the girder bridge's open deck,
    // 6 generated crossings x 12 gate meshes (72), the bridge itself (deck
    // strip, 2 side-girder instances, 4 piers, 2 abutments), a handful of
    // new ballast strips, and the kawabe-koen-b/jp-v8 re-deals. materials
    // 293 -> 294: `rail-girder`, the one new bridge paint.
    // -> 20_591/20_566 (+4, active 1_688 -> 1_691): the Gotokuji terminus
    // (two platform slab instances + buffer stop + hidden platform master)
    // lands beside spawn, inside the fixed pose's frustum. materials 294 ->
    // 296: rail-brick/rail-platform, minted for every rail city.
    // -> 20_596/20_571 (+5; bridge-fix pass): Sakuragawa girder flanges +
    // flange master, abutment pads moved under-deck, parapet runs split
    // around the corridor. materials +1: rail-deck.
    // -> 20_598/20_573 (+2, active 1_691 -> 1_698; owner-reported terminus):
    // the Gotokuji terminus becomes a depot shed (`terminus.style:
    // "depot_shed"`) — the two 42 m platform slabs, which ran straight
    // across the Yamashita St level crossing, retire with their hidden
    // master (-3) for the shed's 9 pieces (2 side walls, 2 portal jambs,
    // rear gable, portal header, 3 stepped roof slabs; the buffer stop
    // survives under a new name), and the promenade's new rail keep-out
    // removes the one chochin post standing in the corridor at the east
    // bridge abutment (-4 part meshes). 9 - 3 - 4 = +2; active +7 because
    // the shed stands beside spawn, inside the fixed pose's frustum, while
    // the removed chochin was far outside it. materials and the fingerprint
    // are unchanged: the shed reuses rail-platform/rail-girder/rail-sleeper.
    // -> 20_600/20_575 (+2, active 1_698 -> 1_700, materials 297 -> 298;
    // owner-requested depot lamp + drivable bridges): the shed's gable lamp
    // is 2 meshes (shade + glow) in the spawn frustum, and its warm
    // material (`rail-shed-jp-setagaya-line-run-lamp`, minted only where a
    // depot shed exists) is the +1 — the fingerprint moves for it. The
    // drivable-bridge pass moves NO counts anywhere: the shoreline collider
    // runs now arrive pre-split around at-grade bridge mouths, so the
    // corniche parapet builds the same number of pieces from shorter runs
    // (Cairo's row is untouched), the girder guards are invisible sim
    // obstacles, and the pier-cap sink is position-only.
    // -> 23_465/23_440 (+2_865, active 1_700 -> 1_758; owner-requested
    // street lighting): the single alternating streetlight walk retunes
    // 38 -> 24 m (1_168 -> 1_889 lamps x 4 instanced parts each incl. the
    // light pool), every chochin post gains a pool part, and kerb-seated
    // lamps are no longer rejected over water / inside the illustrative
    // bridge landmarks — all three Sakuragawa bridges light up. The spacing
    // retune re-deals the one shared seeded stream for the kinds after
    // streetlight (signs 156 -> 142, trees 281 -> 277, vending 300 -> 292,
    // utility poles 549 -> 551), which is the small negative correction on
    // the raw +2_884 lamp-part delta. mirrorCandidates 196 -> 244 /
    // mirrorDrawn 262 -> 263: the mirror cull ring around spawn now holds
    // the denser lamp line's parts.
    // -> 23_473/23_448 (+8, active unchanged): the London/Cairo night pass
    // extended the kerb-seated exemption from "skip the open-water test" to
    // "skip `roadCrossedRects` too" (the same argument: a kerb exists wherever
    // its road does). Tokyo's park drives run through park landmark rects
    // exactly as London's Serpentine Road does, so +20 lamps survive there —
    // and 18 previously-accepted ones do NOT, because rail-corridor and
    // service-lot rects moved onto the hard list at the same time (they had
    // been sharing the `landmarks` array, and skipping them wholesale put five
    // Tokyo lamps between the rails). Net +2 lamps x 4 parts. No re-deal:
    // rejection tests consume no seeded draws, so every other kind is
    // byte-identical, as materials and the fingerprint holding at
    // 298/"7d957807" confirm.
    // -> 22_706/22_681 (active 1_758 -> 1_658; facade-chunk merging): the
    // ~1-in-4 holdback parcels' boxes merge; the glb street wall and its
    // proxies are untouched.
    // -> 22_512/22_487 (active 1_658 -> 1_642; issue #421): 448 planned
    // parked cars reserve their real kerb slots before roadside scatter. This
    // suite deliberately forces every glb unavailable, so those cars add no
    // meshes here while 194 conflicting lamp/furniture meshes disappear; the
    // browser replaces them with one merged-master instance per car.
    // 22_512/22_487 -> 22_508/22_483 (active 1_642 -> 1_638): remove
    // jp-chochin-yokocho-5 from the middle of the Niban-dori carriageway.
    // One hand-authored lantern is four instanced parts, all in this pose's
    // frustum; its shared masters/materials and every mirror count remain.
    totalMeshes: 22_508,
    enabledMeshes: 22_483,
    activeMeshes: 1_638,
    materials: 298,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    mirrorCandidates: 224,
    mirrorDrawn: 263,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    // "0d482197" -> "2337712a": +1 material, "speedsign-60" — Kōshū-kaidō is
    // Tokyo's first-ever 60 km/h road (the quarter topped out at 50).
    // "2337712a" -> "a9a0d68a": +1 material, "speedsign-30" — the
    // residential-web locals are Tokyo's first-ever 30 km/h roads. Each step
    // is a speed-limit sign numeral plate that is a material name Tokyo's
    // own scene never carried before (confirmed both times by dumping
    // `survivingMaterialNames` for tokyo-setagaya and diffing against the
    // previous list — the only new entry each time).
    // "a9a0d68a" -> "855d45f5": Phase 3's +15 materials above.
    // "855d45f5" -> "59b69703": Phase 4's +1 material ("concrete") above.
    // "59b69703" -> "1c13acfe": Phase 5's +2 materials above (the rail
    // extension's own two landmark rects; every signal/camera/crosswalk/
    // second-crossing material was already shared).
    // -> Phase 6 (parks, R4): 274 blocks (was 296 — Kitazawa-kōen and
    // Minami-kōen each replace several short generated parcels, and one
    // manual patch, `jp-blk-jp-higashi-hondori-2-p-south`, restores the
    // Higashi Hon-dōri frontage the tower plaza only partly overlapped —
    // see `TOKYO_PHASE6_PARKS`'s own comment in cities/tokyo.ts) against 11
    // new park landmarks (three riverside `pocket_green` segments, the
    // tower civic plaza, two walled neighbourhood parks and five pocket
    // greens) plus one new `WaterBody` (Kitazawa-kōen's pond). materials
    // 117 -> 129 (+12): confirmed by dumping `survivingMaterialNames`
    // before/after under a temporary console.log and diffing — every new
    // entry is a `landmark-jp-<id>` material, one per new park (every
    // landmark gets one whether or not the bespoke dispatcher uses it, same
    // as bridges/rail above; `color` is otherwise a no-op on `kind: "park"`)
    // plus `water-jp-kitazawa-pond`; no new park lawn/wall/scatter material
    // — those are the single shared per-map materials the three existing
    // temple parks already registered. enabledMeshes/totalMeshes
    // 9_449 -> 9_828 (+379): lawn/path/wall/court + tree/shrub/bench scatter
    // for two walled neighbourhood parks and five pocket greens, the
    // promenade's benches and cherry-set trees, the pond's water sheet and
    // shoreline colliders, net against the meshes the 22 displaced
    // generated blocks (23 dropped, 1 patched back) no longer contribute.
    // activeMeshes 1_039 -> 1_037 barely moves — none of the new parks sit
    // in the fixed test pose's mirror-cull frustum, so this is the same
    // small residual drift the block removal alone causes. mirrorDrawn
    // 198 -> 210 (+12), mirrorCandidates unchanged (172): the same frustum
    // shift, not new mirror-registered content (parks register no mirror
    // surfaces).
    // "1c13acfe" -> "0edc496a": Phase 6's +12 materials above.
    // "0edc496a" -> "a19c1cd9": Phase 7's +93 materials above.
    // "a19c1cd9" -> "48512f9d": Phase 8's +5 materials above.
    // "48512f9d" -> "70de85d2": Phase 9's +15 materials above.
    // "70de85d2" -> "a630aab2": Tokyo authenticity plan P4's +16 materials
    // above (Region B).
    // -> Tokyo authenticity plan P5 (Region A): totalMeshes/enabledMeshes
    // 10_808 -> 11_722 (+914) is six new roads' worth of asphalt/kerb/
    // junction-fill/pavement-rail geometry, one mid-span node insertion's
    // resegmented parcels on `jp-miyanosaka-kita-dori`, the new `hanamizu`
    // zone's own street-wall parcels (`tokyo-house`, the same set
    // miyanosaka/yamashita/nishi/ekimae-nishi already use — no new building
    // material), and 2 new venues. materials 258 -> 262 (+4): confirmed by
    // dumping `survivingMaterialNames` and diffing — the two venues'
    // own signage materials plus the collector's stop-controlled junctions
    // reusing already-shared stop-sign/pole materials contribute the small,
    // fixed handful the file's own P4 paragraph above already established
    // as the right order of magnitude per venue; no new speed-limit plate
    // (30/40 km/h both already used elsewhere on the map). activeMeshes
    // 965 -> 931 and mirrorCandidates/mirrorDrawn 162/218 -> 168/222 all
    // shift because the fixed test pose's mirror-cull frustum now includes
    // a different slice of the larger network, the same class of drift
    // every prior phase's own paragraph describes — the real, measured
    // totals below are not in doubt; only the itemised breakdown is left
    // for a future pass to confirm, same caveat as Region B's own entry.
    //
    // -> Tokyo authenticity plan P7 (Region D): totalMeshes/enabledMeshes
    // 11_722 -> 13_386 (+1_664) is four new roads' worth of asphalt/kerb/
    // junction-fill/pavement-rail geometry across the new `minamimachi`
    // zone's own street-wall parcels (`tokyo-house`, an already-shared set),
    // two mid-span node insertions' resegmented parcels (`jp-chuo-dori-south`
    // /`jp-minami-kaido`), 2 new venues and this quadrant's first two service
    // points. materials 262 -> 281 (+19): NOT root-caused to the same depth
    // as the paragraphs above — but bounded, not guessed. This suite's
    // forced-empty preload turns every venue AND service point into a
    // per-id-materialed fallback box (Tokyo expansion Phase 7's own
    // established fact, restated in cities/tokyo.ts's jp-v45 comment), so
    // the 2 new venues plus `jp-gas-minamimachi`/`jp-repair-minamimachi`
    // alone account for 4 of the 19; the new collector/local speed limits
    // (30/40 km/h) are both already-shared plates (no new speedsign
    // material), and the 5 new junctions' stop/signal furniture reuses
    // already-shared pole/sign materials — the real, measured totals below
    // are not in doubt; only the remaining ~15 materials' exact identity is
    // left for a future pass to confirm, same caveat as every phase above.
    // activeMeshes 931 -> 1_018, mirrorCandidates/mirrorDrawn 168/222 ->
    // 174/242: the fixed test pose's own mirror-cull frustum reacting to the
    // new content, the same class of drift every earlier phase's paragraph
    // documents.
    //
    // -> Tokyo authenticity plan P8 (Regions E+F): totalMeshes/enabledMeshes
    // 13_386 -> 14_029 (+643) is four new roads' worth of asphalt/kerb/
    // junction-fill/pavement-rail geometry (`jp-sazanka-dori`/
    // `jp-hiiragi-dori` reusing the `nishi` zone's already-shared
    // `tokyo-house` set, `jp-kawasemi-dori`/`jp-kawabata-dori` the new
    // `kawabata` zone, same set) plus the mid-span/appended insertions on
    // `jp-nishi-kanjo-dori`/`jp-kanpachi-dori`/`jp-miyanosaka-kita-dori`/
    // `jp-chuo-dori-north`/`jp-kawate-dori` resegmenting their own existing
    // parcels, and the region's one new venue. materials 281 -> 283 (+2):
    // NOT root-caused to the same depth as the paragraphs above — but
    // bounded, not guessed, same caveat as P4/P7's own entries: the one new
    // venue is a per-id-materialed fallback box in this suite's forced-empty
    // preload (the same established fact those entries cite), accounting
    // for at least one; both new zones' local/collector speed limits
    // (30/40 km/h) are already-shared plates, and every new junction's
    // stop furniture reuses already-shared pole/sign materials. activeMeshes
    // 1_018 -> 1_054, mirrorCandidates/mirrorDrawn 174/242 -> 174/256: the
    // fixed test pose's own mirror-cull frustum reacting to the new content,
    // the same class of drift every earlier phase's paragraph documents.
    // "305fa935" -> "cfd13ba7": Tokyo authenticity plan P9's +4 materials
    // above (`tokyo-wire-pole`/`-arm`/`-cable`, `utility-insulator`).
    // "cfd13ba7" -> "209b241d": the rail feature's one-for-one material swap
    // documented in the mesh paragraph above (three `landmark-jp-setagaya-
    // line*` out, `rail-ballast`/`rail-steel`/`rail-sleeper` in).
    // "209b241d" -> "08173393": the tram's six train-* materials above.
    // "08173393" -> "6b9c2401": +1 `rail-girder` (the bridge paint).
    // -> "257fcb5f": +rail-brick/+rail-platform (terminus platforms note).
    // -> "473e5725": +rail-deck (bridge-fix pass).
    // -> "7d957807": +rail-shed-jp-setagaya-line-run-lamp (the depot shed's
    // gable lamp, minted only where a depot shed exists).
    survivingMaterialNamesFingerprint: "7d957807",
  },
  "cairo-central-nile": {
    // 17_660 -> 10_736 (active 3_008 -> 1_747): the building-collision-
    // visual-parity plan's Phase 3. Under this suite's forced-every-model-
    // unavailable mock, a Cairo asset-slot block used to fall through to the
    // OLD whole-block procedural fallback, which rendered the SAME rich
    // decorative detail (cornices, balconies, AC units, awnings, rooftop
    // tanks/dishes) real Cairo procedural blocks get — across all 471
    // building-set blocks at once. An exact per-solid proxy box (Section 7.7)
    // is deliberately undecorated (Section 7.6: a proxy is one opaque box,
    // never the decorated procedural recipe), so the count drops even though
    // occupancy is unchanged and exact (1_396 planned asset-slot entries,
    // matching the plan's own inventory). Materials/mirror/fingerprint are
    // unchanged: no new palette entries, same instanced/shared masters.
    //
    // 10_736 -> 10_778 (materials 217 -> 218): the six
    // `cairo-galaa-ne-land-edge-wall-{1..6}` closures (visual-gap plan
    // Section 12.5, Al-Galaa NE corner) place 18 real procedural buildings
    // (3 surviving cells per block — see the drawCount baseline above for
    // why only 3 of 9 candidates survive). activeMeshes is unchanged: none
    // of the 18 sit in this suite's fixed camera frustum, so the delta is
    // enabled-but-inactive mesh count only, not a live draw-call cost.
    // Not independently re-derived mesh-for-mesh (the 18 buildings' own
    // decorative sub-mesh count wasn't hand-counted); the one new material
    // is plausibly a single shared "sandstone" variant instanced across all
    // 18, not verified further.
    //
    // 10_778 -> 10_797 (materials unchanged): the three
    // `cairo-dokki-sw-land-edge-wall-{1..3}` closures (Section 12.6, Dokki
    // South) place 8 more real procedural buildings (3+3+2 surviving
    // cells — see the drawCount baseline above). Same "sandstone" material
    // already registered by 12.5, so no new palette entry. activeMeshes
    // unchanged for the same reason as 12.5: none sit in this suite's
    // fixed camera frustum.
    //
    // 10_797 -> 10_822 (materials unchanged): Section 12.7. The five
    // `cairo-west-nile-street-mid-land-edge-wall-{1..5}` closures place
    // 10 more real procedural buildings (2 surviving cells each — see the
    // drawCount baseline above); the two Al-Galaa wall-4/-5 resizes keep
    // the same 3-of-9 survivor count each, so they add no new buildings,
    // only shift existing ones' positions. Same "cairo-west-bank-concrete"
    // material this stretch of the map already uses (matches the real
    // `cairo-west-nile-street-roadside-*-left` neighbours' own style), so
    // no new palette entry. activeMeshes unchanged for the same reason as
    // every other closure so far: none sit in this suite's fixed frustum.
    // -> 12_583/12_539 (+1_761/+1_717; active 1_747 -> 1_840; rail feature,
    // the Imbaba corridor): ~1_630 instanced sleepers over 1.5 km of ballast
    // plus BOTH bridges' open decks, 11 generated crossings x 12 gate meshes
    // (132), two girder bridges (deck strips, side girders, piers,
    // abutments), the segmented ballast strips, and the corridor carve's
    // block re-deal. The 44-mesh total/enabled gap is the disabled
    // diesel+wagon consist (2 trains x 5 cars for a through line), which
    // this suite's unstepped scene never enables. materials 218 -> 228: the
    // four rail track/bridge paints plus the train's six.
    // mirrorCandidates/mirrorDrawn move because the carve near the fixed
    // pose's frustum re-deals what the mirror cull ring holds.
    // materials 228 -> 230: rail-brick/rail-platform, minted for every
    // rail city once the London recipes exist, unused here.
    // -> 12_589/12_545 (+6, active -1; owner-reported bridge fixes):
    // per span, girder top-flange instances + a flange master land while
    // the on-track abutment pads go under-deck; spans tightened to the
    // waterline re-deal approach sleepers; parapet runs now SPLIT around
    // the corridor instead of vanishing whole. materials +1: rail-deck.
    // -> 12_577/12_533 (-12; owner-reported palm-in-the-railway): the
    // promenade decor now honours the rail corridor
    // (`generatePromenadeDecor`'s `railLines` keep-out) — a headless
    // before/after diff of the exact production call shows exactly 4
    // placements removed (2 palms, 2 streetlights, all at Imbaba-corridor
    // bridge abutments where the line pierces the corniche), and each of
    // those prop kinds is 3 mesh instances, 4 x 3 = -12. Nothing else
    // moves: active/materials/mirror/fingerprint all unchanged.
    // -> 12_604/12_560 (+27, active 1_839 -> 1_851; Tokyo street-lighting
    // pass, shared-rule side effect): bridge landmarks no longer feed the
    // roadside-scatter exclusion list anywhere — they are illustrative
    // rects ON a carriageway, and the carriageway test already rejects
    // scatter, so as exclusions they only shadowed the kerb bands of the
    // Nile bridges' LAND approaches. A handful of palms/trees/bollards
    // return to those approaches (+27 part meshes), several inside the
    // fixed pose's frustum (+12 active). Materials/mirrors/fingerprint
    // hold.
    // -> 10_648/10_604 (-1_956, active 1_851 -> 1_621; owner-reported
    // "no Christmas trees, many more palms"). Three parts, and the first is
    // why the drop is so large:
    //
    //  - Palms are now imported glbs (`nature-palm-tall/short`, queued on
    //    `pendingPlantedProps`) instead of three procedural cones each, and
    //    THIS SUITE MOCKS THE PRELOAD EMPTY — so `getBuildingMaster` returns
    //    null and all 693 of them render as nothing here, where in the real
    //    game they are 693 single-mesh instances. -1_335, and it is a
    //    measurement artifact of the fixture, not content that left the map.
    //    Live headless count at the Cairo spawn confirms the palms present:
    //    `park-plant-*` 691, `prop-palm-*` 0.
    //  - Cairo's two tree passes folded into one 34 m per-road line
    //    (`roadSpecies`), so 303 procedural trees become 114 — the rest of
    //    the map's street planting IS the palms above. ~-728 part meshes.
    //  - The fold re-deals the kinds authored after it, and bollards gain
    //    ~51 placements on the freed kerb. ~+100.
    //
    // materials hold at 231: the procedural palm shared the tree kit's trunk
    // and leaf paints, so retiring it mints and retires nothing.
    // mirrorCandidates/mirrorDrawn move because the re-deal changes what
    // stands inside the mirror cull ring.
    // -> 13_428/13_384 (+2_780, active 1_621 -> 1_310): Cairo goes NIGHT.
    // Its streetlight line already existed but was 36 m on the default
    // beyond-the-pavement band, which Wust el-Balad's street wall rejected
    // two candidates in five of — 426 lamps for 25 km of road, and a 656 m
    // unlit run on Qasr el-Ainy. Kerb-seated at 26 m it is 1_005 lamps with
    // no unlit run over 83 m, and each is now four meshes rather than three
    // (the night palette adds the ground pool): 426x3 -> 1_005x4 = +2_742,
    // the balance being the one-time re-deal of the palm/tree, bollard and
    // sign lines behind it. materials +1 and a new fingerprint: `lamp-pool`.
    //
    // activeMeshes DOWN for the same reason London's is: night clamps the fog
    // band to 440 m against this palette's own 650 m dust cap, so the fixed
    // pose has markedly less in frustum than before despite the extra lamps.
    // -> 16_997/16_953 (+3_569, active 1_310 -> 1_246; hara network): 23
    // one-way alleys add ~7 km of kerb the slot/gap passes line with 294
    // net new roadside parcels, most demoted to all-faces-glazed facade
    // boxes by `backEdgeNearsARoad` in the tight interiors (this suite's
    // empty preload renders every asset-slot survivor as a proxy box, so
    // the delta is all boxes and dressing). activeMeshes falls again by
    // the familiar mechanism: new blocks near the spawn reject scatter
    // props that used to stand in the fixed pose's frustum. Materials and
    // the fingerprint hold — no new palette entries.
    // -> 21_744/21_700 (+4_747, active 1_246 -> 1_684; interior cores):
    // 294 validator-gated facade-grid cores fill the block interiors
    // behind the strips (~7 cells each plus Cairo dressing under this
    // suite's all-proxy preload). activeMeshes rises because the cores
    // ringing the spawn's own block sit inside the fixed frustum.
    // -> 23_239/23_195 (materials 232 -> 235, new fingerprint; baladi
    // rezoning): ~215 informal-district strips flip from one instanced glb
    // to several facade boxes each with their AC/awning dressing, and the
    // three baladi materials (cairo-brick, cairo-brick-worn,
    // cairo-render-grey) mint their skeleton-and-infill texture pairs.
    // -> 23_820/23_776 (materials 235 -> 243, new fingerprint; the mosque
    // + west-Bulaq widening): the bespoke Abou El-Ela mosque adds its
    // sixteen meshes and eight named materials (stone/dome/neon/portal
    // etc.), the wider baladi band re-tiles its strips, and the core list
    // regenerates around the landmark's exclusion.
    // -> 24_706/24_662 (materials 243 -> 246, new fingerprint; Cairo joins
    // the regulatory-sign family): ~886 one-way/do-not-enter post meshes at
    // the hara and one-way street mouths, three sign materials, and the
    // crowd bump changes nothing here (walkers are thin instances).
    // -> 13_688/13_644 (active 1_755 -> 897; facade-chunk merging): every
    // procedural box and dressing piece now merges per material and 96 m
    // cell (ProceduralFacades.finalize) — ~11k individually-drawn meshes
    // collapse into a few hundred chunks with identical pixels. The live
    // paired measurement that motivated it: the reimagined map had halved
    // the frame rate; with the merge it runs at (and in draw calls below)
    // the pre-reimagining baseline. Materials unchanged: merging reuses
    // the shared per-key materials.
    // -> 13_697/13_653 (active 897 -> 898; sparse Corniche riverfront
    // accents): nine existing-set instances, one close enough to the fixed
    // test pose to enter the active set. Promenade furniture that conflicts
    // with a block is relocated, not removed, so the delta is exactly +9.
    // -> 13_698/13_654 (south Gezira riverfront accent): one more existing-set
    // building; the photographed bay is outside the fixed active-mesh pose.
    // -> 13_597/13_553 (issue #421): Cairo's 262 planned parked cars reserve
    // their kerb slots before scatter. As with Tokyo, this all-glbs-unavailable
    // characterization sees only the 101 conflicting prop meshes removed;
    // the real preload adds one merged-master car instance for every plan row.
    // -> 13_874/13_830 (active 915; owner-marked land gaps): 326 exact
    // proxy buildings land in the 239 new parcels and ten promotions while
    // their occupancy displaces 37 scatter meshes. The shoreline-clearance
    // guard drops four three-mesh promenade props that could not relocate
    // clear of the parapet. Seventeen proxies enter the fixed camera frustum.
    // -> 14_008/13_964 (active 931, materials 250; Cairo street-weathering):
    // sparse shop signs/shutters add four Cairo-only materials and facade
    // chunks; two extra streetlight variants add eight shared prop parts;
    // denser legal parking reserves more kerb slots and re-deals nearby
    // scatter. Other city baselines remain unchanged.
    // -> 13_862/13_818 (active 918, materials 257; Cairo storefront/apartment
    // correction): reducing signs from every third local cell to a world-hashed
    // one-in-eleven frontage removes more facade chunks than the new balconies
    // and AC units add. Seven additional sign materials expand the old three-
    // business palette to ten. NYC/London/Tokyo remain byte-for-byte fixed.
    // 13_862/13_818 -> 14_622/14_578: the reviewed Khedivial wedge set and
    // Tahrir marked-lot infill are now part of the committed Cairo scene.
    // The bespoke wedge façades account for the material/fingerprint move;
    // the fixed pose sees slightly fewer meshes after the surrounding re-tile.
    // -> 14_864/14_820 (active 1_760): the drivable Sixth of October
    // network adds profiled deck slabs, underside girders, parapets,
    // reflectors and hammerhead supports. The former decorative bridge mesh
    // is retired, so the material set contracts to the shared elevated-road
    // kit even as the connected structure adds 242 scene meshes.
    // -> 14_843/14_799 (active 1_782): all four bridge access streets now
    // retain their through carriageway while paired, direction-qualified slip
    // lanes taper beside it. Merge-aware pavement routing removes the obsolete
    // inner-kerb fragments and the re-authored Corniche/Ramses mouths re-deal
    // a small number of derived road/support meshes near the fixed camera.
    // -> 14_828/14_784: the promenade offset audit now sees the elevated
    // deck footprint separately from its at-grade station gaps, removing the
    // one palm whose multi-part render instance pierced the Sixth October
    // carriageway without thinning London or Tokyo's promenade rhythm.
    // -> 14_827/14_783 (active 1_781): elevated T-junction edge runs now
    // stop before each joining ramp. One short, fully consumed parapet/girder
    // run disappears at the fixed Cairo pose; slabs and material inventory are
    // unchanged while the former transverse wall becomes a drivable opening.
    // -> 14_842/14_798 (active 1_785): four full-height deck-edge nodes give
    // every oblique ramp a level merge throat before it enters the mainline
    // footprint. Their short profiled segments add the net 15 structural and
    // road meshes after obsolete flat elevated-junction caps are omitted.
    // Materials and the surviving-material fingerprint remain unchanged.
    // -> 14_870/14_826 (active 1_791): the Ramses rebuild replaces the
    // centred two-way grade with separate kerb-side entry/exit structures;
    // the Corniche exit gains a full-height merge throat and stepped descent.
    // Five slabs, twelve edge girders, twelve parapets and nine reflectors are
    // added while merge-aware road/junction generation retires ten obsolete
    // flat pieces, net +28. Six enter the fixed frustum and two additional
    // pieces enter mirror draws; materials/fingerprint remain unchanged.
    // -> 14_917/14_873 (active 1_831, materials 319; Cairo bridge barrier
    // character pass): all 58 trimmed edge runs replace the generic box with
    // the same-count profiled concrete shell and batch a pale coping, a
    // close-spaced three-rail fence and traffic-facing marker plates. Those
    // run batches replace 179 separate generic reflector boxes for a measured
    // net +47 meshes; 40 enter the fixed pose's frustum. Marker plates are
    // outward quads rather than buried six-face boxes. The three Cairo-only
    // materials are weathered parapet concrete, sunlit coping and aged green
    // steel. Other cities keep their original depth and marker palette.
    // -> 15_072/15_028 (active 1_829): Dokki's former low two-way mouth is
    // replaced by independent one-way entry and exit grades plus a high shared
    // stem. The longer profiled network adds 155 net structural/road meshes;
    // all frontage blocks remain, with the constrained row set back six metres
    // and the obstructed promenade palm relocated along its original row.
    // Two meshes leave this fixed camera's frustum and two extra meshes enter
    // mirror draws; materials/fingerprint remain unchanged.
    // -> 16_116/16_072 (active 1_990, materials 346): Cairo's commercial-
    // advertising layer adds 114 repeated pole panels and 27 skyline boards.
    // The raw +1,044 enabled meshes are almost entirely instances of shared
    // pole/frame/face/support/lamp masters; the 27 new materials are the eight
    // atlas crops, eight transparent text overlays, eight portrait campaign
    // faces, and three shared polished-frame/support/lamp materials. Moving
    // the panels into real arterial sightlines puts 161 inside the fixed spawn
    // frustum; no other city's registry entry changes.
    // -> 17_883/17_839 (active 2_105): the corrected city-wide pass replaces
    // the spawn-biased eight-road layout with 534 pavement-seated pole cards
    // across all 27 boulevards/collectors, 51 skyline boards across 13 axes,
    // and ten bridge gantries (eight on Sixth October). Foreign-road/rail
    // envelope rejection removes junction intrusions, approach-facing cards
    // replace edge-on ones, and reserving the ad support points re-deals the
    // ordinary roadside scatter. -> 17_880/17_836: centring all 51 skyline
    // pedestals in their sidewalks and turning their complete frames almost
    // parallel to the kerb clears roads/buildings; those shifted reservation
    // points re-deal three ordinary roadside props. The shared 27-material
    // inventory, active set and mirror ring remain unchanged.
    // -> 18_076/18_032: exact rendered-building gap search restores the
    // readable 55-degree cant and fills all 69 nominal skyline slots. The 18
    // added boards contribute 180 instances; relocating all support
    // reservations into real gaps re-deals 16 ordinary roadside props. The
    // fixed spawn's active set, materials and mirror ring remain unchanged.
    // -> 18_683/18_639 (active 2_236, materials 370): the second eight-cell
    // atlas doubles the audited campaign set to 16, adding 24 shared art/copy/
    // portrait masters and materials. Ninety-three denser pavement banners
    // add 372 instances and the 34 Sixth October parapet signs add 272; their
    // changed support reservations re-deal 61 ordinary roadside meshes, for a
    // measured net +607. Other cities remain byte-for-byte characterized.
    // -> 20_669/20_625 (active 2_883): regression-safe static batching keeps
    // the current detailed bridge's 665_906 vertices/976_068 indices but bakes
    // its 13_566 authored pieces into 5_349 batches. The 5_007 shadow batches
    // retain each source's exact registration point instead of averaging a
    // 45 m cell, so the 90 m radial cutoff selects identical source geometry.
    // Advertising keeps all 3_622 part transforms but replaces 3_674 meshes
    // plus 748 roots with 966 meshes (52 hidden masters and 914 frustum-
    // cullable thin-instance chunks). The material inventory/fingerprint and
    // mirror draw set remain unchanged.
    // -> 20_686/20_642 (active 2_896): the four reviewed dry-land flanks of
    // Sixth October gain 17 existing Cairo asset instances. Thirteen enter
    // the fixed spawn frustum; materials, mirrors and advertising are stable.
    // -> 19_937/19_893 (active 2_851): Cairo presents a sparse, kerb-safe
    // subset of its regulatory signs and suppresses the single Sixth October
    // pastry billboard that intersected the bridge. Materials stay stable.
    totalMeshes: 19_937,
    enabledMeshes: 19_893,
    activeMeshes: 2_851,
    materials: 370,
    drawCallsPerFrame: 0,
    drawCallsOverSixFrames: 0,
    mirrorRendersOverSixFrames: 3,
    // 49 -> 71 / 85 -> 93: the denser lamp line puts more poles inside the
    // spawn's mirror cull ring (the pools themselves never register — see
    // London's note).
    // 71 -> 93 / 93 -> 141 (hara network): the Qasr El-Ainy spawn now has
    // the Lazoghly hara's street wall inside its cull ring. 93 -> 119
    // candidates (interior cores in the ring); drawn holds at 141.
    // 119 -> 216 / 141 -> 147 (baladi rezoning): each strip that flipped
    // from one instanced glb to several boxes multiplies what the ring
    // holds near the spawn.
    // 220 -> 97 / 149 -> 147 (facade-chunk merging): the ring holds a few
    // chunks where it held hundreds of boxes.
    // -> 93 / 142: the same new occupancy re-deals the fixed mirror ring.
    // -> 102 / 145: Cairo-only storefront dressing and parking reservations
    // re-deal the street furniture held inside that ring.
    // -> 93 / 144: sparse signs and rebalanced facade dressing reduce the
    // nearby chunk set without changing the mirror rig itself.
    // The nearby Qasr El-Ainy pole run adds mirror-visible instances while one
    // previous candidate drops out of the fixed distance/cull ordering.
    // 29 -> 26 / 168 -> 165: denser advertising reservations re-deal three
    // ordinary props from the fixed spawn mirror ring.
    mirrorCandidates: 23,
    mirrorDrawn: 165,
    mirrorMeshNames: EXPECTED_MIRROR_MESH_NAMES,
    crowdInstances: 0,
    crowdMeshes: 0,
    retiredGuidanceMaterialNames: [],
    // "e2316bb7" -> "5469c8ba": the ten rail materials above.
    // -> "e5294a40": +rail-brick/+rail-platform (see the materials note).
    // -> "ae339a82": +rail-deck (bridge-fix pass).
    // -> "1b18079f": +lamp-pool, once the palette went night.
    // -> "96f3eb90": +facade-cairo-brick/-brick-worn/-render-grey (the
    // baladi skeleton-and-infill materials).
    // -> "52079508": the mosque's eight named materials.
    // -> "df94522e": the three regulatory-sign materials.
    // -> "48a1630c": the three Cairo shop signs plus storefront shutter.
    // -> "2e92838d": seven more Cairo business-sign materials.
    // -> "807eeb5f": the three Cairo-only barrier materials above.
    // -> "edd55ddc": 24 ad-face/copy campaign materials plus polished frame,
    // support steel and billboard lamp.
    // -> "26724b2c": eight more atlas/copy/portrait campaign materials each.
    survivingMaterialNamesFingerprint: "26724b2c",
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
