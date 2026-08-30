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
 *  - `buildingInstanceCount` — placed `bldg-*` meshes. NYC, Cairo and (as of
 *    the Tokyo authenticity plan's P2/P3b) Tokyo author `buildingSet`
 *    blocks; London still doesn't and stays pinned at zero. Tokyo's own
 *    count UNDERSTATES its true placement total by design: `tokyo-house-d`
 *    is one of `MERGE_INCOMPATIBLE_MODEL_IDS` (buildingCatalog.ts), so it
 *    renders through `BuildingLayer`'s `instantiateViaSubmeshes` path
 *    instead of the ordinary merged-master `createInstance` this filter
 *    looks for — its meshes carry the glb's own submesh names, never a
 *    `bldg-*` prefix. `tokyo-apato-b` is the SAME kind of entry but never
 *    reaches this suite at all — P3b live-measured it OUT of `tokyo-manshon`
 *    on a real draw-call regression before merge (`buildingSets.ts`'s own
 *    comment on that set), so it stays unreferenced by any set.
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
          const buf = fs.readFileSync(
            path.join(process.cwd(), "public", url.split(/[?#]/, 1)[0]),
          );
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
    // -> 5_373 (visual-gap plan Section 11.2, P0): `buildNycBlocks`'s
    // west-margin loop walked globally consecutive `streets`, so E 61st (an
    // east-only street sharing 61st's z) and the bk40/Queensview-Bridge pair
    // (Queens-only, unreached by West End) silently dropped the two real
    // West End Ave rows between them instead of merging across the
    // interruption, leaving two 214 m grey gaps. Filtering to West End's own
    // reachable streets before pairing (the same fix the Steinway
    // east-margin loop already used) restores both rows: +68 buildings.
    // -> 5_417 (Section 11.3, P0): `nycZoneFor("fifth-mad", ...)` nulled the
    // whole E79-E86 cell for nyc-gallery, but the gallery's own footprint
    // (160 m deep) fills only the middle of the 454 m cell, leaving 147 m
    // bare on each side. Two ordinary midrise blocks flank it instead,
    // each stopping 8 m short of the gallery's footprint: +44 buildings.
    // -> 5_475 (Section 11.5, P0): two single-edge `nyc-house` map-edge
    // shells past bk40/bk56, the borough's south/north boundary streets,
    // where the ground used to continue unbuilt to the world edge: +58.
    // -> 5_471 (Section 11.6, P0): the Queens riverbank park pushed
    // nyc-v31 (Bridge Plaza Offices) off the southbound Vernon lane, whose
    // kerb the new park now owns, onto the northbound one instead — a real
    // vern-cres houses block, where the venue's own keep-out circle now
    // excludes 4 building slots it previously stood clear of entirely
    // (its old position had no real block under it, only park).
    // -> 5_469 (Section 11.8, P1): nyc-block-east-south-margin/-north-margin
    // trimmed 4.1 m off their east edge to meet the esplanade exactly
    // instead of overlapping it by 0.5 m: -2, one building off each block.
    // 5_469 -> 5_749 (rail feature, the borough freight corridor carve):
    // seven Queens blocks split into rail-flank fragments, and each fragment
    // walls its new corridor-facing edge — fresh nyc-house rows now flank
    // the tracks on both sides, the classic houses-beside-the-railway look.
    // tests/railCorridors.test.ts proves none stand ON the corridor.
    buildingInstanceCount: 5_749,
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
    // -> 4_386: the Regent Street P0 (Section 10.3) — Piccadilly-to-Regent-1
    // and Regent-5-to-Oxford had no frontage at all; 3 east slots at each
    // end (6 total). Both west-side blocks are deliberately absent:
    // london-block-regent-w-oxford resolves to null outright (its
    // foreign-road trim against Oxford Street's own parcel shrinks the
    // surviving span below MIN_PARCEL_HALF_LENGTH_M), and every
    // -w-piccadilly placement tried overlapped Piccadilly's own corner row
    // or shrank to nothing the same way — but the audit confirms both
    // named poses close anyway, entirely off the two surviving east
    // blocks.
    // -> 4_388: the Euston/Upper Street T-junction P0 (Section 10.4) —
    // london-block-nes-fab-a-north supplements -nes-fab-a north, closing
    // the 12 m gap to the terminus sightline at euston-east (1180,940); 2
    // new slots.
    // -> 4_393: the Shoreditch/Canonbury north-east oblique-edge P0
    // (Section 10.5) — london-block-canonbury-ne-fab-north extends the
    // existing fab block toward the London north edge (~z=1000), west-
    // facing only so it reads as a backdrop, not a duplicate row in front
    // of shoreditch-e's close wall; 5 new slots.
    // 4_393 -> 4_382 (rail feature): the Grosvenor viaduct corridor carve
    // trims the Battersea/Chelsea parcels the line threads.
    // -> 4_132 (London block-and-riverfront revamp): thirteen new streets
    // split the oversized parcels into real neighbourhood-scale frontage,
    // while 22 obsolete fill slabs and the old Chelsea park patchwork are
    // retired. The lower count is intentional: shorter, better-oriented
    // street walls replace several four-sided interior slabs.
    // -> 5_700 (whole-map urban-fabric coverage): compact courtyard infill
    // occupies safe unclaimed cells and genuinely deep one-sided parcels gain
    // a road-clipped opposite-edge mews row. Ordinary shallow terrace strips
    // stay single-row, avoiding overlapping instances and unnecessary load.
    // -> 6_221 (Kensington/oversized-block regression): both modelled sides
    // of Kensington Park Road return, clipped only at the fitted greens, and
    // every large perimeter parent receives compact internal terrace courts.
    buildingInstanceCount: 6_221,
    cairoRoofClutterInstanceCount: 0,
    storefrontSignMaterialCount: 0,
  },
  "tokyo-setagaya": {
    // 0 -> 817 (Tokyo authenticity plan P2): `tokyo-house`/`tokyo-shotengai`
    // go live on miyanosaka/yamashita/nishi and jp-nakamise-yokocho. Real
    // planned asset-slot total was 1_012 (confirmed directly via
    // `planMapBuildings`), not 817 — the gap was exactly the 195
    // `tokyo-house-d` placements this suite's own `bldg-*` filter cannot see
    // (see the header comment above).
    //
    // 817 -> 2_136 (P3b): `tokyo-zakkyo` goes live on downtown (outside
    // `jp-nakamise-yokocho`) + ring, `tokyo-manshon` on riverside + higashi.
    // Real planned asset-slot total is now 2_331 — the gap stays exactly
    // the same 195 `tokyo-house-d` placements this suite's `bldg-*` filter
    // cannot see, unchanged from P2 (`instantiateViaSubmeshes` with the
    // source glb's own submesh names, never a `bldg-*` prefix). NOT +284:
    // `tokyo-manshon` ships with only 4 of its originally-planned 5 members
    // — `tokyo-apato-b` (the other `MERGE_INCOMPATIBLE_MODEL_IDS` entry this
    // phase would have added) was live-measured OUT before merge on a real
    // perf regression (see `buildingSets.ts`'s own comment on that set),
    // never landing in any set at all, so it contributes nothing here
    // either. No Cairo roof clutter (no `roofY` on any Tokyo PLACEMENTS
    // entry) and no storefront re-branding (no Tokyo set references
    // `STOREFRONT_MODEL_ID`), so both other fields stay zero.
    //
    // 2_136 -> 2_304 (Tokyo authenticity plan P4, Region B): four new roads'
    // worth of `tokyo-house`/`tokyo-shotengai` street wall (the two mid-span
    // node insertions on `jp-sangen-dori`/`jp-koshu-kaido` also resegment
    // those roads' own existing parcels, which shifts which ones keep the
    // holdback facade grid vs. draw a glb — net +168 instances).
    //
    // 2_304 -> 2_565 (Tokyo authenticity plan P5, Region A): six new roads'
    // worth of `tokyo-house` street wall (the mid-span node insertion on
    // `jp-miyanosaka-kita-dori` also resegments that road's own existing
    // parcels — net +261 instances).
    //
    // 2_565 -> 3_074 (+509), cumulatively, for P6 (Region C, Sumiregaoka) and
    // P7 (Region D, Minamimachi): neither phase's own fast-iteration loop
    // re-ran this full-mount characterization suite (deferred to the
    // bundle's end, per the P6-P9 combined-PR process note — the same gap
    // `tests/trafficTraceCharacterization.test.ts`'s own P7 entry
    // documents), so this one entry reconciles both at once. P6 is six new
    // roads' worth of `tokyo-house`/`tokyo-apato` street wall (`jp-
    // sumiregaoka-dori` reads as `tokyo-apato` per its own per-road
    // override), plus its two mid-span insertions (`jp-sangen-dori`, a
    // second new tee on `jp-minami-kaido`) resegmenting their own existing
    // parcels. P7 is four more new roads' worth of `tokyo-house` street
    // wall, plus its own two mid-span insertions (`jp-chuo-dori-south`'s new
    // south extension, a second new tee on `jp-minami-kaido`) resegmenting
    // theirs.
    //
    // 3_074 -> 3_314 (+240) (Tokyo authenticity plan P8, Regions E+F): four
    // new roads' worth of `tokyo-house` street wall (Sazanka-dōri/
    // Hiiragi-dōri reusing the `nishi` zone, Kawabata-dōri/Kawasemi-dōri the
    // new `kawabata` zone), plus the mid-span/appended insertions on
    // `jp-nishi-kanjo-dori`/`jp-kanpachi-dori`/`jp-miyanosaka-kita-dori`/
    // `jp-chuo-dori-north`/`jp-kawate-dori` resegmenting their own existing
    // parcels.
    //
    // 3_314 -> 3_313 (-1) (Tokyo authenticity plan P9, "venue models' final
    // polish"): giving 12 gig venues a real `modelId`
    // (`tokyo-konbini`/`tokyo-izakaya`/`tokyo-ramen`) makes
    // `resolveVenuePlacement` re-derive each one's setback off the model's
    // own measured `PROP_MODEL_FOOTPRINTS_M` footprint instead of the
    // generic `shop`/`restaurant` box, shifting each venue's placed position
    // by 0.1-1.7 m (verified directly, scratchpad, against the real
    // `resolveVenuePlacement` — every venue stays inside the SAME real
    // `buildingSet` block it started in). One of those shifted keep-out
    // reservations tips one adjacent procedural-cell parcel candidate across
    // its own accept/reject boundary — this suite's own `buildingLayout`
    // re-plan is sensitive to exactly that class of boundary case, the same
    // "coverage floors" trap the plan's own risk register names. Not
    // itemised to the specific parcel (a 1-in-3300 shift, not worth a
    // dedicated repro), same as this file's own P4/P5/P6/P7 entries above
    // leave their own breakdowns unconfirmed past the measured total.
    //
    // 3_313 -> 3_730 (+417) (post-plan perf fix): tokyo-house-d left
    // MERGE_INCOMPATIBLE_MODEL_IDS (its secondary-UV strip — see
    // buildingCatalog.ts), so its 417 placements moved from
    // `instantiateViaSubmeshes` (never counted here — this counter counts
    // `createInstance` of a merged master) onto the ordinary merged-master
    // path. +417 is exactly its placement count, and the total now equals
    // the planner's own asset-slot count: every planned building is a real
    // master instance again, none render per-submesh.
    //
    // 3_730 -> 3_807 (+77) (owner-reported sideways rows): tokyo-house-a
    // and tokyo-apato-a's frontOffset quarter-turn fixes swapped their
    // footprintM/depthM (buildingSets.ts, tokyo-apato-a's comment has the
    // protocol story), so every row containing either re-deals — apato-a's
    // kerb footprint narrowed 7.39 -> 4.79 (more fit per run) while
    // house-a's widened 8.11 -> 9.21 (fewer), netting +77 across the map.
    //
    // 3_807 -> 3_813 (+6, owner-reported sideways shop rows): tokyo-shop-d's
    // frontOffset quarter-turn (buildingSets.ts — its decorated face is on
    // local +X; P2's drive-by sweep missed it between neighbours) swaps its
    // footprintM/depthM 22.41/12.91 -> 12.91/22.41, so every row containing
    // it re-deals and the narrower kerb footprint fits six more members.
    // 3_813 -> 3_808 (rail feature): the Setagaya Line corridor carve
    // trims the handful of set-dressed parcels along the east run.
    // 3_808 -> 3_743 (Sakuragawa Urban Expressway): the complete 23-surface
    // asphalt/deck/parapet envelope trims or splits only the procedural lots
    // it crosses. Sixty-five modelled building placements leave those
    // fragments; the focused corridor test proves every surviving block is
    // clear instead of relying on vertical separation from an elevated deck.
    buildingInstanceCount: 3_743,
    cairoRoofClutterInstanceCount: 0,
    storefrontSignMaterialCount: 0,
  },
  "cairo-central-nile": {
    // 1_396 -> 1_377 / clutter 464 -> 465 (rail feature): the Imbaba
    // corridor carve re-deals the four split downtown strips and drops
    // three roadside pieces; the clutter scatter re-rolls on the new rects.
    // -> 1_625 / clutter 552 (hara network): the alley strips deep enough
    // to keep a glb set add ~248 real instanced buildings, and the tanks/
    // dishes scatter lands on the new roofY-carrying models among them.
    // -> 1_112 / clutter 391 (baladi rezoning): the informal districts
    // hold back five parcels in six from the glb wall, so the imported kit
    // — and the glb-path roof clutter that rides it — retreats to the
    // polished centre. The boxes that replace them grow their own tanks
    // and dishes through the facade-grid dressing instead.
    // -> 1_000 / 351 (mosque + west-Bulaq widening): the wider baladi band
    // holds more parcels back from the glb wall.
    // -> 1_009 / 355 (sparse Corniche riverfront accents): nine short
    // one-edge blocks each add one existing Cairo asset; four of those
    // deterministic models carry roofY and therefore one clutter instance.
    // -> 1_010 / 356 (south Gezira riverfront accent): the single existing
    // Cairo four-storey asset carries one authored rooftop-clutter point.
    // -> 1_336 / 505 (owner-marked land gaps): 239 small reviewed parcels
    // plus ten safe in-place promotions use only Cairo's existing sets;
    // clutter follows the authored roof points of the deterministic models.
    // -> 1_353 / 512 (Corniche/park public-realm dressing): the final safe
    // frontage accents use the same deterministic Cairo kit and roof points.
    // -> 1_366 / 514 (Sixth October bridge-side infill): 17 planned Cairo
    // assets are added; 13 survive this fixed quality profile and two of
    // those deterministic models carry authored roof clutter.
    // -> 1_365 / 514: narrowing marked gap 7-9 removes only its intrusive
    // terrace; the rear slim building and seeded roof-clutter set stay fixed.
    buildingInstanceCount: 1_365,
    cairoRoofClutterInstanceCount: 514,
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
    // 120s -> 180s when London and Cairo went night: their scenes gained ~7_000
    // instanced streetlight meshes between them, which is ~12% on this
    // four-city loop's own runtime (measured 67.6s -> 75.6s alongside
    // facadeGridDrawOrder, both alone). Alone that is nowhere near either
    // budget — this test runs in ~38s — but `npm test` runs 119 files across
    // shared cores, and under that contention the same work stretches 3-6x.
    // At 120s this and facadeGridDrawOrder both started timing out in the full
    // suite while passing in isolation, which makes the local suite (the
    // project's actual gate, since CI does not run it) useless as a signal.
    180_000,
  );
});
