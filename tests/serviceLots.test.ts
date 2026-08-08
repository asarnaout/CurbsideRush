import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  resolveSimulationLaneAnchor,
  resolveVenuePlacement,
} from "../app/game/simulationAdapter";
import { resolveMapVisualPalette } from "../app/game/visuals";
import {
  SERVICE_LOT_HALF_M,
  gasStationsOf,
  repairShopsOf,
} from "../app/game/servicePoints";
import type { WorldPoint } from "../app/game/types";

/**
 * Every service point is a square lot dropped beside a lane. It has to land in
 * the same place on all six maps: hard against the dirt shoulder, never on it
 * and never floating out in a field. Judging that by eye took hours per city,
 * so the rule is pinned down numerically here instead.
 *
 * Both kinds are measured by the same rule but at their own size — a gas
 * station's lot is the 23.28 m base slab its glb rides on, a repair shop's is
 * the much smaller square derived from what `repairShopLayout.ts` draws. That
 * is why the two kinds carry set-backs six metres apart on the same street.
 */
// Mirrors GameCanvas: a paved city renders a fixed concrete sidewalk in place of
// the authored dirt shoulder, so the lot must park hard against THAT wider band
// (PAVED_SIDEWALK_WIDTH), not the narrower authored one — otherwise the forecourt
// slab overshoots the sidewalk. Off paved maps, GameCanvas floors the authored
// width at 0.9 m when it builds the dirt band.
const PAVED_SIDEWALK_M = 3.4;
const shoulderWidthFor = (
  pack: (typeof MAP_PACKS)[number],
  surface: (typeof MAP_PACKS)[number]["geometry"]["roadSurfaces"][number],
): number =>
  surface.sidewalkWidthM ??
  (resolveMapVisualPalette(pack.id).paved
    ? PAVED_SIDEWALK_M
    : Math.max(0.9, pack.geometry.shoulderWidth ?? 1.2));
// Mirrors the fallback in GameCanvas's service-point loop.
const DEFAULT_SETBACK_M = 16;
// A lot further than this from its nearest road reads as an orphaned slab in a
// field rather than a forecourt on the kerb.
const MAX_KERB_GAP_M = 0.6;

type LotPoint = { readonly u: number; readonly v: number };

/** Projects a world point into the lot's own frame (u = right, v = forward). */
const toLotFrame = (
  point: WorldPoint,
  centre: WorldPoint,
  heading: number,
): LotPoint => {
  const dx = point.x - centre.x;
  const dz = point.z - centre.z;
  return {
    u: dx * Math.cos(heading) - dz * Math.sin(heading),
    v: dx * Math.sin(heading) + dz * Math.cos(heading),
  };
};

/** Liang-Barsky clip: does the segment touch the square centred on the origin? */
const segmentTouchesLot = (a: LotPoint, b: LotPoint, half: number): boolean => {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const edges: readonly (readonly [number, number])[] = [
    [-du, a.u + half],
    [du, half - a.u],
    [-dv, a.v + half],
    [dv, half - a.v],
  ];
  let enter = 0;
  let exit = 1;
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }
  return enter <= exit;
};

const pointToLotDistance = (p: LotPoint, half: number): number =>
  Math.hypot(Math.max(Math.abs(p.u) - half, 0), Math.max(Math.abs(p.v) - half, 0));

const pointToSegmentDistance = (p: LotPoint, a: LotPoint, b: LotPoint): number => {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const lengthSquared = du * du + dv * dv;
  if (lengthSquared < 1e-12) return Math.hypot(p.u - a.u, p.v - a.v);
  const t = Math.min(
    1,
    Math.max(0, ((p.u - a.u) * du + (p.v - a.v) * dv) / lengthSquared),
  );
  return Math.hypot(p.u - (a.u + du * t), p.v - (a.v + dv * t));
};

/**
 * Exact 2D distance between a segment and the lot square. Two disjoint convex
 * shapes always realise their gap at a vertex of one against the other, so the
 * endpoints and the four corners cover every case once overlap is ruled out.
 */
const segmentToLotDistance = (a: LotPoint, b: LotPoint, half: number): number => {
  if (segmentTouchesLot(a, b, half)) return 0;
  const corners: readonly LotPoint[] = [
    { u: -half, v: -half },
    { u: half, v: -half },
    { u: half, v: half },
    { u: -half, v: half },
  ];
  return Math.min(
    pointToLotDistance(a, half),
    pointToLotDistance(b, half),
    ...corners.map((corner) => pointToSegmentDistance(corner, a, b)),
  );
};

describe("service-point lots", () => {
  it("parks every lot hard against the shoulder without touching it", () => {
    const reviewed: string[] = [];

    for (const pack of MAP_PACKS) {
      for (const service of pack.geometry.servicePoints ?? []) {
        const pose = resolveSimulationLaneAnchor(pack.laneGraph.lanes, service.anchor);
        expect(pose, `${service.id} anchor does not resolve`).not.toBeNull();
        if (!pose) continue;

        // Matches GameCanvas: the lot is set back along the right-hand normal,
        // at whatever half-extent this kind of building occupies.
        const half = SERVICE_LOT_HALF_M[service.kind];
        const setback = service.setbackM ?? DEFAULT_SETBACK_M;
        const centre: WorldPoint = {
          x: pose.x + Math.cos(pose.heading) * setback,
          z: pose.z - Math.sin(pose.heading) * setback,
        };

        let nearestGap = Number.POSITIVE_INFINITY;
        let nearestSurfaceId = "";
        for (const surface of pack.geometry.roadSurfaces) {
          // The drivable strip plus its dirt shoulder, either side of centre.
          const reach =
            surface.widthM / 2 + shoulderWidthFor(pack, surface);
          for (let index = 0; index < surface.centerline.length - 1; index += 1) {
            const gap =
              segmentToLotDistance(
                toLotFrame(surface.centerline[index], centre, pose.heading),
                toLotFrame(surface.centerline[index + 1], centre, pose.heading),
                half,
              ) - reach;
            if (gap < nearestGap) {
              nearestGap = gap;
              nearestSurfaceId = surface.id;
            }
          }
        }

        expect(
          nearestGap,
          `${service.id} bleeds ${(-nearestGap).toFixed(2)}m into ${nearestSurfaceId}`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          nearestGap,
          `${service.id} floats ${nearestGap.toFixed(2)}m off ${nearestSurfaceId}`,
        ).toBeLessThanOrEqual(MAX_KERB_GAP_M);
        reviewed.push(service.id);
      }
    }

    // Every service point on every map got measured.
    expect(reviewed).toEqual(
      MAP_PACKS.flatMap((pack) =>
        (pack.geometry.servicePoints ?? []).map((service) => service.id),
      ),
    );
  });

  it("puts a pump stop on every map and a workshop in every career city", () => {
    for (const pack of MAP_PACKS) {
      // No map may be unrefuellable. A big city may want more than one pump
      // stop, so this is a floor rather than a fixed total.
      expect(
        gasStationsOf(pack.geometry.servicePoints).length,
        `${pack.id} gas stations`,
      ).toBeGreaterThan(0);
    }

    // Repairs are not spread evenly: how many workshops a city gets tracks how
    // much driving it holds, not a per-map quota.
    const shopsByMap = Object.fromEntries(
      MAP_PACKS.map((pack) => [
        pack.id,
        repairShopsOf(pack.geometry.servicePoints).length,
      ]),
    );
    expect(shopsByMap).toEqual({
      "nyc-upper-west-side": 3,
      // 1 -> 3: London is a full-size city now. One mews garage in South
      // Kensington was right for an 800 m quarter and is a very long tow
      // from Islington.
      "london-south-kensington": 3,
      "tokyo-setagaya": 1,
      "cairo-central-nile": 2,
    });
  });

  it("puts the workshops on commercial frontage, not between houses", () => {
    // Siting is not just geometry. The first uptown shop cleared the kerb, sat
    // on a block and stood 300 m from anything else — and landed in the middle
    // of the Riverside detached-house belt, with a porch either side of it.
    // NYC is the only map that zones its blocks, so it is the only one that can
    // be checked; `nycZoneFor` puts houses up the whole west column north of
    // centre, which is precisely the far corner a spread-only rule reaches for.
    const RESIDENTIAL: readonly string[] = ["nyc-house", "nyc-brownstone"];
    const pack = MAP_PACKS.find((p) => p.id === "nyc-upper-west-side")!;
    for (const shop of repairShopsOf(pack.geometry.servicePoints)) {
      const pose = resolveSimulationLaneAnchor(
        pack.laneGraph.lanes,
        shop.anchor,
      );
      if (!pose) continue;
      const setback = shop.setbackM ?? DEFAULT_SETBACK_M;
      const centre = {
        x: pose.x + Math.cos(pose.heading) * setback,
        z: pose.z - Math.sin(pose.heading) * setback,
      };
      const block = pack.geometry.blocks.find(
        (candidate) =>
          Math.abs(centre.x - candidate.center.x) <= candidate.size.x / 2 &&
          Math.abs(centre.z - candidate.center.z) <= candidate.size.z / 2,
      );
      expect(block, `${shop.id} stands on no block at all`).toBeDefined();
      expect(
        RESIDENTIAL.includes(String(block?.buildingSet)),
        `${shop.id} is in the ${block?.buildingSet} zone — a garage between homes`,
      ).toBe(false);
    }
  });

  it("keeps the shops and kitchens off the detached-house blocks", () => {
    // The workshop rule above, for gig venues — it went unwritten, and the
    // borough ended up with a pizzeria and a grocery store standing in a row
    // of detached houses, which is what a driver actually notices from the
    // road. A residence or an office venue among homes is fine; a shopfront
    // is not.
    //
    // `nyc-house` only, deliberately narrower than the workshops' list: a
    // corner bodega on a brownstone street is Manhattan — West End Bodega has
    // stood on one since long before this — while a garage between brownstones
    // is not. What does not exist anywhere is a convenience store in the
    // middle of a detached-house belt, and that is the whole of this rule.
    //
    // Uses `resolveVenuePlacement` rather than the raw `setbackM` the workshop
    // check above copies: on a paved map the authored set-back is dead, and
    // the real building parks 0.4 m behind the pavement's outer edge instead.
    const RETAIL_KINDS: readonly string[] = ["shop", "restaurant"];
    const pack = MAP_PACKS.find((p) => p.id === "nyc-upper-west-side")!;
    const venues = (pack.geometry.gigVenues ?? []).filter((venue) =>
      RETAIL_KINDS.includes(venue.kind),
    );
    expect(venues.length).toBeGreaterThan(5);
    const violations: string[] = [];
    for (const venue of venues) {
      const placement = resolveVenuePlacement(pack, venue);
      if (!placement) continue;
      const block = pack.geometry.blocks.find(
        (candidate) =>
          Math.abs(placement.x - candidate.center.x) <= candidate.size.x / 2 &&
          Math.abs(placement.z - candidate.center.z) <= candidate.size.z / 2,
      );
      // A venue whose building lands off every block — a bridge plaza, a
      // riverbank — is not standing in a housing row and has nothing to answer
      // for here.
      if (block?.buildingSet !== "nyc-house") continue;
      violations.push(
        `${venue.id} (${venue.name}) is a ${venue.kind} on house block ${block.id}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
