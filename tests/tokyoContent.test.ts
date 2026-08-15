import { describe, expect, it } from "vitest";
import {
  TOKYO_FREE_DRIVE,
  TOKYO_MAP_PACK,
  TOKYO_OPEN_WATERFRONT_SIDES,
  TOKYO_ZONE_FOR_ROAD,
  type TokyoBlockZone,
} from "../app/game/cities/tokyo";
import { defaultSidewalkWidthM } from "../app/game/visuals";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { collectMapVisualGeometry, distanceFromPointToShape } from "../app/game/geometry/visualSceneFootprints";
import {
  bareKerbRuns,
  buildGroundRaster,
  GROUND_CONTACT_EPS_M,
  KERB_FRONTAGE_REACH_M,
  roadStations,
} from "../app/game/geometry/visualGapCoverage";
import type { WorldPoint } from "../app/game/types";

/**
 * Tokyo expansion Phase 4's committed gate (`.claude/tokyo-city-expansion-
 * plan.md` Section 9 "Phase 4", Section 8.8): R18's "buildings on the left
 * AND right of every road" made machine-checked, the same way
 * `tests/cairoContent.test.ts`'s "leaves no qualifying bare-kerb run
 * unexplained" test does for Cairo — same geometry kernel
 * (`collectMapVisualGeometry`, the exact thing the real `--fan` audit CLI
 * and `buildGroundRaster` both measure against, not a hand-rolled rect
 * approximation), same `bareKerbRuns`/`roadStations` metric (Section 5.4's
 * 28 m standard), same exemption shape (a candidate is only a REAL failure
 * if it is not backed by open park/water ground within reach AND not
 * explained by one of the raster's own qualifying void blobs within 70 m —
 * see that test's own header comment for the full rationale, not
 * re-derived here).
 *
 * Two tests, matching the plan's own two-part ask (Section 8.8):
 *  1. "leaves no qualifying bare-kerb run unexplained" — the precise,
 *     per-instance gate (mirrors Cairo's own test almost line for line).
 *  2. "keeps a walled-kerb floor per district" — a coarser, per-zone
 *     coverage-percentage sanity net on top of (1): (1) alone would still
 *     pass if an entire district's fabric regressed to sparse coverage as
 *     long as every individual bare run stayed under 28 m or found a void
 *     blob to hide behind, so (2) catches a systemic regression (1) is not
 *     shaped to catch, per district (`TOKYO_ZONE_FOR_ROAD` — the exact
 *     table `cities/tokyo.ts`'s own generator used to build the fabric, not
 *     a second hand-maintained districting that could drift from it).
 */

const TOKYO_BRIDGE_ROAD_IDS = new Set(["jp-sakura-ohashi", "jp-kawanaka-bashi", "jp-tsuki-ohashi"]);

const sideForSign = (sign: 1 | -1): "side-left" | "side-right" => (sign === 1 ? "side-right" : "side-left");

const pointAtArcLength = (polyline: readonly WorldPoint[], sM: number): WorldPoint => {
  let remaining = sM;
  for (let index = 1; index < polyline.length; index += 1) {
    const a = polyline[index - 1];
    const b = polyline[index];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= segLen || index === polyline.length - 1) {
      const t = segLen > 1e-9 ? Math.min(1, remaining / segLen) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= segLen;
  }
  return polyline[polyline.length - 1];
};

describe("Tokyo street wall (expansion Phase 4, R18)", () => {
  // Visual-gap plan Section 12.11's shape, mirrored from
  // `tests/cairoContent.test.ts`: real ground-contact occluder volumes from
  // `collectMapVisualGeometry` (parks/venues/service lots contribute
  // whatever they actually occlude, not a hand-picked "counts as frontage"
  // rect), sampled at real pavement-edge stations via `roadStations`, gated
  // with `bareKerbRuns` at its shared 28 m non-exempt standard. Deliberately
  // NOT a live `auditMapVisualGapsForMap` camera-fan sweep — that is
  // `npm run audit:visual-gaps -- --fan` territory (minutes, not seconds,
  // final-gate-only per `docs/testing.md`), not a per-commit gate.
  it(
    "leaves no qualifying bare-kerb run unexplained by a known systemic void (Section 12.11, 28 m standard)",
    () => {
      const plan = planMapBuildings(TOKYO_MAP_PACK, TOKYO_FREE_DRIVE.trafficSeed);
      const geometry = collectMapVisualGeometry(TOKYO_MAP_PACK, plan);
      // Bespoke landmarks have vehicle-height collision but no height-banded
      // visual-occlusion recipe yet -- a known, accepted gap shared by every
      // bespoke landmark on every map (tests/visualSceneFootprints.test.tsx's
      // own KNOWN_ISSUE_COUNTS pins the identical fact for London's 9 and
      // Cairo's 5; Cairo's own version of this exact test makes no issues
      // assertion at all for the same reason). jp-hikari-tower (Phase 8) is
      // Tokyo's only bespoke ground-solid landmark -- tolerate exactly that
      // one, so a real, unexpected geometry problem still fails loudly.
      expect(geometry.issues).toEqual([
        {
          kind: "audit_geometry_missing",
          ownerId: "jp-hikari-tower",
          reason: "bespoke landmark has no height-banded visual-occlusion recipe yet",
        },
      ]);

      const worldGroundSurfaces = geometry.groundSurfaces.filter((surface) => surface.kind === "world-ground");
      const worldGroundSurfaceY = worldGroundSurfaces.length
        ? Math.min(...worldGroundSurfaces.map((surface) => surface.surfaceY))
        : 0;
      // The exact filter buildGroundRaster applies internally — bareKerbRuns
      // wants the identical ground-contact set the real audit's own raster
      // subtracts, not every occluder regardless of height.
      const groundContactOccluders = geometry.occluders.filter(
        (occluder) => occluder.minY <= worldGroundSurfaceY + GROUND_CONTACT_EPS_M,
      );
      // 79 roads / 76.9 lane-km — Tokyo's own real scale (not Cairo's
      // 27-road/44.8 lane-km floors copied verbatim). ~300 generated blocks
      // plus the 9 quarter ones give comfortably more ground-contact
      // occluders than this floor; a real regression would drop it hard.
      expect(groundContactOccluders.length).toBeGreaterThan(1_000);

      // A run backed by open park/water ground within frontage reach is not
      // a defect — R18's own exemption (never wall a park frontage or the
      // river). `bareKerbRuns` only knows about occluder volumes
      // (correctly — a park must never become a fake opaque rect), so this
      // filters its *output* against the real semantic ground surfaces
      // instead of feeding it any. "promenade" is included for parity with
      // Cairo's own filter even though nothing currently produces that
      // `GroundSurfaceKind` on any map (checked directly) — Tokyo has no
      // distinct promenade surface yet (Phase 9's decor tuning is content,
      // not geometry), so only "park"/"water" ever match today.
      const openGroundSurfaces = geometry.groundSurfaces.filter(
        (surface) => surface.kind === "park" || surface.kind === "water" || surface.kind === "promenade",
      );
      const backedByOpenGround = (x: number, z: number): boolean =>
        openGroundSurfaces.some(
          (surface) => distanceFromPointToShape(surface.geometry, x, z) <= KERB_FRONTAGE_REACH_M,
        );

      const fallbackSidewalkWidthM = defaultSidewalkWidthM(TOKYO_MAP_PACK);
      // Tokyo's bridge ids (jp-sakura-ohashi/jp-kawanaka-bashi/jp-tsuki-
      // ohashi) don't contain "-bridge" the way Cairo's do
      // (cairo-qasr-el-nil-bridge etc.), so the exclusion is an explicit id
      // set rather than a substring match. Bridges carry no roadside
      // parcels by design (`TOKYO_BRIDGE_ROAD_IDS` in cities/tokyo.ts — a
      // bridge's own long axis crosses the water, so a laterally-offset
      // parcel would land in it) and are dressed separately (parapets,
      // lamps, the Kawanaka-bashi arch), never by a street-wall block.
      const roads = TOKYO_MAP_PACK.geometry.roadSurfaces.filter((surface) => !TOKYO_BRIDGE_ROAD_IDS.has(surface.id));

      interface Candidate {
        readonly roadId: string;
        readonly side: "side-left" | "side-right";
        readonly run: { readonly startM: number; readonly endM: number; readonly lengthM: number };
        readonly midpoint: WorldPoint;
      }
      const candidates: Candidate[] = [];
      let totalKerbM = 0;
      let sidesSampled = 0;
      for (const surface of roads) {
        const stations = roadStations(surface, fallbackSidewalkWidthM);
        for (const side of ["side-left", "side-right"] as const) {
          const openSides = TOKYO_OPEN_WATERFRONT_SIDES[surface.id] ?? [];
          if (openSides.some((sign) => sideForSign(sign) === side)) continue;
          const kerbPolyline = stations
            .filter((station) => station.side === side)
            .map((station) => ({ x: station.x, z: station.z }));
          if (kerbPolyline.length < 2) continue;
          sidesSampled += 1;
          for (let index = 1; index < kerbPolyline.length; index += 1) {
            totalKerbM += Math.hypot(
              kerbPolyline[index].x - kerbPolyline[index - 1].x,
              kerbPolyline[index].z - kerbPolyline[index - 1].z,
            );
          }
          const runs = bareKerbRuns(kerbPolyline, groundContactOccluders);
          for (const run of runs) {
            if (!run.qualifying) continue;
            const midpoint = pointAtArcLength(kerbPolyline, (run.startM + run.endM) / 2);
            if (backedByOpenGround(midpoint.x, midpoint.z)) continue;
            candidates.push({ roadId: surface.id, side, run, midpoint });
          }
        }
      }

      // 79 roads x up to 2 sides: comfortably more than Cairo's own 40-side
      // floor. Tokyo's real network (Phase 2/3) samples 150 sides (2 per
      // non-bridge road, every one of which has both kerbs since only the
      // 2 riverside roads ever skip a side) over ~72 km of kerb.
      expect(sidesSampled).toBeGreaterThan(120);
      expect(totalKerbM).toBeGreaterThan(60_000);

      // A candidate is a real failure only if no already-tracked qualifying
      // void blob explains it within Section 5.3's own 70 m sightline
      // distance — see this file's own header comment for why.
      const SIGHTLINE_DISTANCE_M = 70;
      const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
      const blobById = new Map(raster.blobs.map((blob) => [blob.id, blob]));
      const fragmentById = new Map(raster.fragments.map((fragment) => [fragment.id, fragment]));
      const explainedByKnownVoid = (x: number, z: number): boolean =>
        raster.fragmentIndex
          .queryBox({
            minX: x - SIGHTLINE_DISTANCE_M,
            maxX: x + SIGHTLINE_DISTANCE_M,
            minZ: z - SIGHTLINE_DISTANCE_M,
            maxZ: z + SIGHTLINE_DISTANCE_M,
          })
          .some((fragmentId) => blobById.get(fragmentById.get(fragmentId)?.blobId ?? "")?.qualifying ?? false);

      const failures: string[] = [];
      let bareM = 0;
      for (const candidate of candidates) {
        bareM += candidate.run.lengthM;
        if (explainedByKnownVoid(candidate.midpoint.x, candidate.midpoint.z)) continue;
        failures.push(
          `${candidate.roadId} ${candidate.side}: ${candidate.run.lengthM.toFixed(1)}m bare, ` +
            `${candidate.run.startM.toFixed(0)}-${candidate.run.endM.toFixed(0)}m along kerb ` +
            `(near ${candidate.midpoint.x.toFixed(0)},${candidate.midpoint.z.toFixed(0)}) — ` +
            `not explained by any known qualifying void blob`,
        );
      }

      // Retained for trend/performance analysis only, per Section 12.11's
      // own requirement — NOT the pass/fail condition below.
      console.log(
        `Tokyo bare-kerb: ${bareM.toFixed(0)}m qualifying-bare (park/water-backed runs excluded) of ` +
          `${totalKerbM.toFixed(0)}m sampled kerb, ${candidates.length} qualifying (>28m) runs ` +
          `(${candidates.length - failures.length} explained by a known void blob, ${failures.length} unexplained)`,
      );
      expect(failures).toEqual([]);
    },
    // This test's own `buildGroundRaster` call is the dominant cost — same
    // budget as Cairo's own version of this test for the same reason
    // (`visualGapCoverageRealMaps.test.ts` already documents and budgets
    // 120s for this class of call).
    120_000,
  );

  // The plan's own Section 8.8 second half: a coarser, per-district
  // coverage-percentage floor on top of the precise per-instance gate
  // above. (1) alone would still pass if an entire district's fabric
  // regressed toward sparse coverage as long as no single run exceeded
  // 28 m unexplained; this catches that class of regression instead,
  // districted by `TOKYO_ZONE_FOR_ROAD` — the exact table the generator in
  // `cities/tokyo.ts` used to zone materials/heights, not a second
  // hand-maintained districting that could quietly drift from it.
  it("keeps a walled-kerb floor per district (Section 8.8)", () => {
    const plan = planMapBuildings(TOKYO_MAP_PACK, TOKYO_FREE_DRIVE.trafficSeed);
    const geometry = collectMapVisualGeometry(TOKYO_MAP_PACK, plan);
    const worldGroundSurfaces = geometry.groundSurfaces.filter((surface) => surface.kind === "world-ground");
    const worldGroundSurfaceY = worldGroundSurfaces.length
      ? Math.min(...worldGroundSurfaces.map((surface) => surface.surfaceY))
      : 0;
    const groundContactOccluders = geometry.occluders.filter(
      (occluder) => occluder.minY <= worldGroundSurfaceY + GROUND_CONTACT_EPS_M,
    );
    const fallbackSidewalkWidthM = defaultSidewalkWidthM(TOKYO_MAP_PACK);
    const roads = TOKYO_MAP_PACK.geometry.roadSurfaces.filter((surface) => !TOKYO_BRIDGE_ROAD_IDS.has(surface.id));

    const kerbMByZone = new Map<TokyoBlockZone | "quarter", number>();
    const bareMByZone = new Map<TokyoBlockZone | "quarter", number>();
    const addKerbM = (zone: TokyoBlockZone | "quarter", metres: number) =>
      kerbMByZone.set(zone, (kerbMByZone.get(zone) ?? 0) + metres);
    const addBareM = (zone: TokyoBlockZone | "quarter", metres: number) =>
      bareMByZone.set(zone, (bareMByZone.get(zone) ?? 0) + metres);

    for (const surface of roads) {
      // The 20 pre-expansion quarter roads (and any future road this table
      // has not classified) bucket as "quarter" — this floor test does not
      // require every one of THOSE to individually resolve to a Phase-4
      // zone, only that Phase-4's own generated districts hold their floor.
      const zone: TokyoBlockZone | "quarter" = TOKYO_ZONE_FOR_ROAD[surface.id] ?? "quarter";
      const stations = roadStations(surface, fallbackSidewalkWidthM);
      for (const side of ["side-left", "side-right"] as const) {
        const openSides = TOKYO_OPEN_WATERFRONT_SIDES[surface.id] ?? [];
        if (openSides.some((sign) => sideForSign(sign) === side)) continue;
        const kerbPolyline = stations
          .filter((station) => station.side === side)
          .map((station) => ({ x: station.x, z: station.z }));
        if (kerbPolyline.length < 2) continue;
        for (let index = 1; index < kerbPolyline.length; index += 1) {
          addKerbM(
            zone,
            Math.hypot(
              kerbPolyline[index].x - kerbPolyline[index - 1].x,
              kerbPolyline[index].z - kerbPolyline[index - 1].z,
            ),
          );
        }
        const runs = bareKerbRuns(kerbPolyline, groundContactOccluders);
        for (const run of runs) {
          if (!run.qualifying) continue;
          addBareM(zone, run.lengthM);
        }
      }
    }

    // Every Phase-4 district this generator actually built must clear a
    // real floor — tuned with 5-16 points of margin below this map's own
    // measured numbers (originally miyanosaka 94.8%, yamashita 97.0%, nishi
    // 100%, higashi 96.2%, ring 86.3% — the long arterials, so more
    // crossings and more clearance-trimmed corners than a pure residential
    // web, hence the lowest floor — riverside 100% off a small one-sided
    // sample, downtown 90.6%), not copied from Cairo's own (differently-
    // shaped) percentages. Margin this size catches a real regression (half
    // a district's blocks deleted) while not being flaky against ordinary
    // future re-tuning.
    //
    // Re-measured after the Tokyo authenticity plan's P2 (`tokyo-house`/
    // `tokyo-shotengai` go live on miyanosaka/yamashita/nishi and
    // jp-nakamise-yokocho): miyanosaka/yamashita/nishi all reach 100%
    // (a real gain — the glb parcels sit closer to the kerb than the old
    // procedural grid's depth did, closing junction-corner gaps the grid
    // left), higashi 92.3%, ring 88.9%, riverside 100%, downtown 81.3%.
    // Every zone moved, not only the four converted ones, because
    // `planMapBuildings`'s shared `seededUnit` stream is consumed by
    // procedural blocks in authored-block order and an asset-slot block no
    // longer draws from it (its own doc comment's documented mechanism,
    // plan section 6.1's "one-time re-baseline") — every STILL-procedural
    // block downstream of a newly-converted one now reads different
    // width/depth/height draws, which shifts which facade cells survive
    // without moving any of that block's own authored geometry.
    //
    // Re-measured again after P3b (`tokyo-zakkyo` goes live on the rest of
    // downtown + ring, `tokyo-manshon` on riverside + higashi — every
    // generator zone now names a set): higashi 97.4%, ring 95.5%, riverside
    // 100% (unchanged — still a small one-sided sample, same reasoning as
    // before), downtown 95.7%. The same glb-parcels-sit-closer-to-kerb gain
    // P2 measured on the residential webs repeats here, more dramatically —
    // ring and downtown in particular were the two zones this plan's own
    // draw-call hypothesis (section 10) targeted, and both jumped double
    // digits. Floors for the four P3b-converted zones raised to 5-16 points
    // below their new measured numbers, matching the other three zones'
    // existing convention; riverside's floor is untouched (its own number
    // did not move).
    //
    // `ekimae-nishi` (Tokyo authenticity plan P4, Region B) measured 100%
    // covered of 3247 m sampled kerb on first build — the same
    // glb-parcels-sit-closer-to-kerb effect, and a sample comfortably bigger
    // than riverside's. Floor set to the same 0.85 (15 points below 100%)
    // the other three 100%-measuring zones already use, not riverside's more
    // conservative 0.8 (that extra margin is riverside's own one-sided-kerb
    // reasoning, which does not apply here).
    //
    // `hanamizu` (Tokyo authenticity plan P5, Region A) measured 100%
    // covered of 5840 m sampled kerb on first build — same reasoning and
    // same 0.85 floor as the other four 100%-measuring residential zones.
    //
    // `sumiregaoka` (Tokyo authenticity plan P6, Region C) measured 100%
    // covered of 6376 m sampled kerb on first build — the biggest residential
    // sample of any web so far, same reasoning and same 0.85 floor as the
    // other five 100%-measuring residential zones.
    const FLOOR_BY_ZONE: Readonly<Record<TokyoBlockZone, number>> = {
      miyanosaka: 0.85,
      yamashita: 0.85,
      nishi: 0.85,
      "ekimae-nishi": 0.85,
      hanamizu: 0.85,
      sumiregaoka: 0.85,
      higashi: 0.85,
      ring: 0.8,
      riverside: 0.8,
      downtown: 0.85,
    };

    const report: string[] = [];
    const failures: string[] = [];
    for (const zone of Object.keys(FLOOR_BY_ZONE) as TokyoBlockZone[]) {
      const totalM = kerbMByZone.get(zone) ?? 0;
      const bareM = bareMByZone.get(zone) ?? 0;
      const coverage = totalM > 0 ? 1 - bareM / totalM : 0;
      report.push(`${zone}: ${(coverage * 100).toFixed(1)}% covered of ${totalM.toFixed(0)}m sampled`);
      // Every district must have SOME sampled kerb — a zone with zero
      // sampled metres means every one of its roads vanished from
      // TOKYO_ZONE_FOR_ROAD or the road table, a real regression, not a
      // vacuous pass.
      if (totalM < 500) {
        failures.push(`${zone}: only ${totalM.toFixed(0)}m sampled — expected a real district`);
        continue;
      }
      if (coverage < FLOOR_BY_ZONE[zone]) {
        failures.push(`${zone}: ${(coverage * 100).toFixed(1)}% covered, below the ${(FLOOR_BY_ZONE[zone] * 100).toFixed(0)}% floor`);
      }
    }
    console.log(`Tokyo walled-kerb floor by district:\n  ${report.join("\n  ")}`);
    expect(failures).toEqual([]);
  }, 120_000);
});
