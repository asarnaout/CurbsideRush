import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FREE_DRIVES,
  MAP_PACKS,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import {
  FINE_BY_COUNTRY,
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  GIG_FARE_BY_COUNTRY,
  MIN_REFUEL_LITRES,
  PASSENGER_FARE_BY_COUNTRY,
  STARTING_WALLET_BY_COUNTRY,
  TANK_CAPACITY_L,
  fuelPurchase,
  formatMoney,
} from "../app/game/economyTables";
import type {
  LaneAnchor,
  LaneSegment,
  WorldPoint,
} from "../app/game/types";
import { gasStationsOf } from "../app/game/servicePoints";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { parkLayoutForLandmark, resolveParkStyle } from "../app/game/parkLayouts";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { hashStringToSeed } from "../app/game/visuals";

const GEOMETRY_EPSILON = 1e-5;
const ROAD_ENVELOPE_SAMPLE_INTERVAL_M = 0.25;
const ROAD_ENVELOPE_EPSILON_M = 0.1;
const JUNCTION_TAPER_LENGTH_M = 2;
const JUNCTION_TAPER_EPSILON_M = 0.15;
const PLAYER_HALF_WIDTH_M = 1.82 / 2;
const PLAYER_LATERAL_CLEARANCE_M = 0.3;

const distanceBetween = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const laneLength = (lane: LaneSegment): number =>
  lane.centerline.slice(1).reduce(
    (total, point, index) =>
      total + distanceBetween(lane.centerline[index], point),
    0,
  );

const resolveAnchor = (
  lane: LaneSegment,
  anchor: LaneAnchor,
): {
  readonly position: WorldPoint;
  readonly headingDeg: number;
  readonly laneLengthM: number;
} => {
  if (anchor.laneId !== lane.id) {
    throw new Error(`${anchor.laneId} cannot resolve against ${lane.id}`);
  }

  const totalLength = laneLength(lane);
  if (
    anchor.distanceAlongM < -GEOMETRY_EPSILON ||
    anchor.distanceAlongM > totalLength + GEOMETRY_EPSILON
  ) {
    throw new Error(
      `${lane.id} anchor ${anchor.distanceAlongM}m exceeds ${totalLength.toFixed(2)}m`,
    );
  }

  let distanceRemaining = Math.min(anchor.distanceAlongM, totalLength);
  for (let index = 1; index < lane.centerline.length; index += 1) {
    const start = lane.centerline[index - 1];
    const end = lane.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLength = Math.hypot(dx, dz);
    if (segmentLength <= GEOMETRY_EPSILON) {
      continue;
    }
    if (
      distanceRemaining <= segmentLength + GEOMETRY_EPSILON ||
      index === lane.centerline.length - 1
    ) {
      const amount = Math.min(1, Math.max(0, distanceRemaining / segmentLength));
      return {
        position: {
          x: start.x + dx * amount,
          z: start.z + dz * amount,
        },
        headingDeg: (Math.atan2(dx, dz) * 180) / Math.PI,
        laneLengthM: totalLength,
      };
    }
    distanceRemaining -= segmentLength;
  }

  throw new Error(`${lane.id} does not contain a non-zero centreline segment`);
};

const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

interface OrientedBox {
  readonly x: number;
  readonly z: number;
  /** Unit vector along the box's own `halfU` axis. */
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

/**
 * Separating-axis overlap of two oriented rectangles, as the smallest
 * penetration depth over the four candidate axes — positive when they
 * intersect, negative (the widest gap) when they do not. Reported in metres so
 * a failure says how far in the offender actually is.
 */
const orientedBoxOverlapM = (a: OrientedBox, b: OrientedBox): number => {
  const axes = [
    { x: a.ux, z: a.uz },
    { x: -a.uz, z: a.ux },
    { x: b.ux, z: b.uz },
    { x: -b.uz, z: b.ux },
  ];
  const extentOn = (box: OrientedBox, axis: { x: number; z: number }): number =>
    Math.abs(box.ux * axis.x + box.uz * axis.z) * box.halfU +
    Math.abs(-box.uz * axis.x + box.ux * axis.z) * box.halfV;
  return Math.min(
    ...axes.map((axis) => {
      const centreGapM = Math.abs(
        (b.x - a.x) * axis.x + (b.z - a.z) * axis.z,
      );
      return extentOn(a, axis) + extentOn(b, axis) - centreGapM;
    }),
  );
};

const distanceToSegment = (
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.x - start.x) * dx + (point.z - start.z) * dz) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
};

const distanceToPolyline = (
  point: WorldPoint,
  centerline: readonly WorldPoint[],
): number =>
  Math.min(
    ...centerline
      .slice(1)
      .map((end, index) =>
        distanceToSegment(point, centerline[index], end),
      ),
  );

const distanceToLaneCenterline = (
  point: WorldPoint,
  lane: LaneSegment,
): number => distanceToPolyline(point, lane.centerline);

const samplePolyline = (
  centerline: readonly WorldPoint[],
  intervalM: number,
): readonly {
  readonly point: WorldPoint;
  readonly distanceAlongM: number;
  readonly totalLengthM: number;
}[] => {
  const segmentLengths = centerline
    .slice(1)
    .map((point, index) => distanceBetween(centerline[index], point));
  const totalLengthM = segmentLengths.reduce(
    (total, length) => total + length,
    0,
  );
  const samples: {
    point: WorldPoint;
    distanceAlongM: number;
    totalLengthM: number;
  }[] = [];
  let traversedM = 0;

  for (let segmentIndex = 1; segmentIndex < centerline.length; segmentIndex += 1) {
    const start = centerline[segmentIndex - 1];
    const end = centerline[segmentIndex];
    const segmentLengthM = segmentLengths[segmentIndex - 1];
    const sampleCount = Math.max(1, Math.ceil(segmentLengthM / intervalM));
    const firstSample = segmentIndex === 1 ? 0 : 1;
    for (let sampleIndex = firstSample; sampleIndex <= sampleCount; sampleIndex += 1) {
      const amount = sampleIndex / sampleCount;
      samples.push({
        point: {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        },
        distanceAlongM: traversedM + segmentLengthM * amount,
        totalLengthM,
      });
    }
    traversedM += segmentLengthM;
  }

  return samples;
};

const pointsMatch = (a: WorldPoint, b: WorldPoint): boolean =>
  distanceBetween(a, b) <= GEOMETRY_EPSILON;

const pointInPolygon = (
  point: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.z > point.z !== previousPoint.z > point.z &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

type SegmentIntersection =
  | { readonly kind: "point"; readonly point: WorldPoint }
  | { readonly kind: "overlap"; readonly lengthM: number };

const segmentIntersection = (
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint,
): SegmentIntersection | null => {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const fromAToC = { x: c.x - a.x, z: c.z - a.z };
  const cross = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.z - left.z * right.x;
  const dot = (left: WorldPoint, right: WorldPoint): number =>
    left.x * right.x + left.z * right.z;
  const denominator = cross(r, s);

  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    if (Math.abs(cross(fromAToC, r)) > GEOMETRY_EPSILON) {
      return null;
    }
    const lengthSquared = dot(r, r);
    if (lengthSquared <= GEOMETRY_EPSILON) {
      return pointsMatch(a, c) ? { kind: "point", point: a } : null;
    }
    const cAmount = dot(fromAToC, r) / lengthSquared;
    const dAmount =
      dot({ x: d.x - a.x, z: d.z - a.z }, r) / lengthSquared;
    const overlapStart = Math.max(0, Math.min(cAmount, dAmount));
    const overlapEnd = Math.min(1, Math.max(cAmount, dAmount));
    if (overlapEnd < overlapStart - GEOMETRY_EPSILON) {
      return null;
    }
    if (overlapEnd - overlapStart <= GEOMETRY_EPSILON) {
      return {
        kind: "point",
        point: {
          x: a.x + r.x * overlapStart,
          z: a.z + r.z * overlapStart,
        },
      };
    }
    return {
      kind: "overlap",
      lengthM: (overlapEnd - overlapStart) * Math.sqrt(lengthSquared),
    };
  }

  const aAmount = cross(fromAToC, s) / denominator;
  const cAmount = cross(fromAToC, r) / denominator;
  if (
    aAmount < -GEOMETRY_EPSILON ||
    aAmount > 1 + GEOMETRY_EPSILON ||
    cAmount < -GEOMETRY_EPSILON ||
    cAmount > 1 + GEOMETRY_EPSILON
  ) {
    return null;
  }
  return {
    kind: "point",
    point: {
      x: a.x + r.x * aAmount,
      z: a.z + r.z * aAmount,
    },
  };
};

const nearCollinearReverseOverlapM = (
  firstStart: WorldPoint,
  firstEnd: WorldPoint,
  secondStart: WorldPoint,
  secondEnd: WorldPoint,
): number => {
  const firstDx = firstEnd.x - firstStart.x;
  const firstDz = firstEnd.z - firstStart.z;
  const secondDx = secondEnd.x - secondStart.x;
  const secondDz = secondEnd.z - secondStart.z;
  const firstLength = Math.hypot(firstDx, firstDz);
  const secondLength = Math.hypot(secondDx, secondDz);
  if (firstLength <= GEOMETRY_EPSILON || secondLength <= GEOMETRY_EPSILON) {
    return 0;
  }
  const firstUnit = { x: firstDx / firstLength, z: firstDz / firstLength };
  const secondUnit = {
    x: secondDx / secondLength,
    z: secondDz / secondLength,
  };
  if (firstUnit.x * secondUnit.x + firstUnit.z * secondUnit.z > -0.98) {
    return 0;
  }
  const perpendicularDistance = (point: WorldPoint): number =>
    Math.abs(
      (point.x - firstStart.x) * firstUnit.z -
        (point.z - firstStart.z) * firstUnit.x,
    );
  if (
    perpendicularDistance(secondStart) > 0.25 ||
    perpendicularDistance(secondEnd) > 0.25
  ) {
    return 0;
  }
  const project = (point: WorldPoint): number =>
    (point.x - firstStart.x) * firstUnit.x +
    (point.z - firstStart.z) * firstUnit.z;
  const projectedStart = project(secondStart);
  const projectedEnd = project(secondEnd);
  return Math.max(
    0,
    Math.min(firstLength, Math.max(projectedStart, projectedEnd)) -
      Math.max(0, Math.min(projectedStart, projectedEnd)),
  );
};

describe("SideSwap content", () => {
  it("keeps four legal country profiles and four destination profiles", () => {
    expect(COUNTRY_PROFILES.map((country) => country.id)).toEqual([
      "us",
      "uk",
      "jp",
      "eg",
    ]);
    expect(DESTINATION_PROFILES.map((destination) => destination.id)).toEqual([
      "us-nyc",
      "jp-tokyo",
      "eg-cairo",
      "uk-london",
    ]);
    expect(DESTINATION_PROFILES[3].promotion).toBe("featured");
    expect(FREE_DRIVES).toHaveLength(4);
    expect(MAP_PACKS).toHaveLength(4);
  });

  it("zones NYC so towers cluster clear of the residential house pocket", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const blocks = nyc!.geometry.blocks;
    const VALID = new Set([
      "nyc-downtown", "nyc-midrise", "nyc-brownstone", "nyc-house", "nyc-shop",
    ]);
    for (const b of blocks) {
      if (b.buildingSet) expect(VALID.has(b.buildingSet), `${b.id}:${b.buildingSet}`).toBe(true);
    }
    const houses = blocks.filter((b) => b.buildingSet === "nyc-house");
    const towers = blocks.filter((b) => b.buildingSet === "nyc-downtown");
    expect(houses.length).toBeGreaterThan(0);
    expect(towers.length).toBeGreaterThan(0);
    // No detached-house block may abut a skyscraper block: their footprints must
    // stay a road's width apart, so "no Empire State next to a random house".
    const footprintGapM = (
      a: (typeof blocks)[number],
      b: (typeof blocks)[number],
    ) => {
      const dx = Math.abs(a.center.x - b.center.x) - (a.size.x + b.size.x) / 2;
      const dz = Math.abs(a.center.z - b.center.z) - (a.size.z + b.size.z) / 2;
      return Math.max(dx, dz);
    };
    for (const house of houses) {
      for (const tower of towers) {
        expect(footprintGapM(house, tower), `${house.id} vs ${tower.id}`).toBeGreaterThan(20);
      }
    }
  });

  it("gives West End Ave a west-margin row at every real block, including across E 61st/bank-street/bridge interruptions (plan Section 11.2)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const westMargin = nyc!.geometry.blocks
      .filter((b) => b.id.startsWith("nyc-block-west-margin-"))
      .sort((a, b) => a.center.z - b.center.z);
    // Four rows south of Riverside Drive's own reach (which starts at 72nd,
    // z=-480): the two pre-existing end rows plus the two this fix restores.
    // The old generator walked globally consecutive `streets`, so E 61st
    // (an east-only street sharing 61st's z) and the bk40/Queensview-Bridge
    // pair (Queens-only, unreached by West End) silently swallowed the two
    // real West End rows between them instead of merging across them.
    expect(westMargin.map((b) => b.id)).toEqual([
      "nyc-block-west-margin--1320",
      "nyc-block-west-margin--1080",
      "nyc-block-west-margin--840",
      "nyc-block-west-margin--600",
    ]);
    for (const block of westMargin) {
      expect(block.size).toEqual({ x: 44, z: 214 });
      expect(block.center.x).toBeCloseTo(-1055, 5);
      expect(block.buildingSet).toBe("nyc-brownstone");
    }
    expect(westMargin[1].center.z).toBe(-1080);
    expect(westMargin[2].center.z).toBe(-840);
    // North of 72nd, Riverside Drive is the real westmost avenue and owns
    // that frontage itself (Section 11.7's park/Hudson treatment) — no
    // West End margin block should appear there.
    for (const block of westMargin) {
      expect(block.center.z).toBeLessThan(-480);
    }
  });

  it("flanks the Fifth Avenue Gallery with residual urban blocks instead of leaving its null cell bare (plan Section 11.3)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const gallery = nyc!.geometry.landmarks.find((l) => l.id === "nyc-gallery")!;
    expect(gallery).toBeDefined();
    const galleryBounds = {
      xMin: gallery.center.x - gallery.size.x / 2,
      xMax: gallery.center.x + gallery.size.x / 2,
      zMin: gallery.center.z - gallery.size.z / 2,
      zMax: gallery.center.z + gallery.size.z / 2,
    };
    const south = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-fifth-gallery-south")!;
    const north = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-fifth-gallery-north")!;
    expect(south).toBeDefined();
    expect(north).toBeDefined();
    for (const block of [south, north]) {
      // Full cell width (fifth-mad, x=-127..-13), matching the museum's own
      // column so nothing pokes past Fifth or Madison's building line.
      expect(block.center.x).toBe(-70);
      expect(block.size.x).toBe(114);
      expect(block.buildingSet).toBe("nyc-midrise");
      // Never the default four-edge population for a shape this close to a
      // landmark (plan Section 9): the gallery-facing edge carries no wall.
      expect(block.streetEdges).toContain("-x");
      expect(block.streetEdges).toContain("+x");
    }
    expect(south.streetEdges).toContain("-z");
    expect(south.streetEdges).not.toContain("+z");
    expect(north.streetEdges).toContain("+z");
    expect(north.streetEdges).not.toContain("-z");
    // Both stop short of the gallery's own footprint rather than merely its
    // cell — the load-bearing invariant a lone "size" pin can't express.
    expect(south.center.z + south.size.z / 2).toBeLessThan(galleryBounds.zMin);
    expect(north.center.z - north.size.z / 2).toBeGreaterThan(galleryBounds.zMax);
  });

  it("expands Queensbridge Green to own its full null-zoned cell, pavement to pavement (plan Section 11.4)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const park = nyc!.geometry.landmarks.find((l) => l.id === "nyc-queensbridge-green")!;
    expect(park).toBeDefined();
    // Vernon (800) / Crescent (950) inset by NYC_BLOCK_INSET_M (13) each
    // side, and bk44 (-360) / bk48 (120) the same way -- the exact cell
    // `nycZoneFor("vern-cres", ...)` nulls for this park, derived the same
    // way every ordinary block's bounds are, not eyeballed.
    expect(park.center).toEqual({ x: 875, z: -120 });
    expect(park.size).toEqual({ x: 124, z: 454 });
    const bounds = {
      xMin: park.center.x - park.size.x / 2,
      xMax: park.center.x + park.size.x / 2,
      zMin: park.center.z - park.size.z / 2,
      zMax: park.center.z + park.size.z / 2,
    };
    expect(bounds).toEqual({ xMin: 813, xMax: 937, zMin: -347, zMax: 107 });
    // No house block from the surrounding houses zone may share this cell.
    const overlapping = nyc!.geometry.blocks.filter((b) => {
      const dx = Math.abs(b.center.x - park.center.x) - (b.size.x + park.size.x) / 2;
      const dz = Math.abs(b.center.z - park.center.z) - (b.size.z + park.size.z) / 2;
      return dx < 0 && dz < 0;
    });
    expect(overlapping.map((b) => b.id)).toEqual([]);
  });

  it("shells the Queens outer bank streets bk40/bk56 so the ground stops reading to the world edge (plan Section 11.5)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const south = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-bk40-outer")!;
    const north = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-bk56-outer")!;
    expect(south).toBeDefined();
    expect(north).toBeDefined();
    for (const block of [south, north]) {
      expect(block.center.x).toBe(974.2);
      expect(block.size).toEqual({ x: 365.6, z: 44 });
      expect(block.buildingSet).toBe("nyc-house");
      // A map-edge shell, not real frontage: single inward-facing edge, and
      // withdrawn from gig-pool probing entirely (plan Section 9.1).
      expect(block.addressable).toBe(false);
    }
    expect(south.center.z).toBe(-1115);
    expect(south.streetEdges).toEqual(["+z"]);
    expect(north.center.z).toBe(1115);
    expect(north.streetEdges).toEqual(["-z"]);
    // Clear of the East River's own shore (x up to 726) on the west side,
    // and its west edge meets the Queens riverbank park's own east edge
    // exactly (Section 11.6) rather than the vern-cres column's generic
    // 787 inset, which would overlap it by 4.4 m.
    const river = nyc!.geometry.waterBodies!.find((w) => w.id === "nyc-east-river")!;
    const riverMaxX = Math.max(...river.polygon.map((p) => p.x));
    const bank = nyc!.geometry.landmarks.find((l) => l.id === "nyc-queens-bank-south")!;
    for (const block of [south, north]) {
      expect(block.center.x - block.size.x / 2).toBeGreaterThan(riverMaxX);
      expect(block.center.x - block.size.x / 2).toBe(bank.center.x + bank.size.x / 2);
    }
  });

  it("dresses the Queens East River bank strip instead of leaving it grey ground (plan Section 11.6)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const south = nyc!.geometry.landmarks.find((l) => l.id === "nyc-queens-bank-south")!;
    const main = nyc!.geometry.landmarks.find((l) => l.id === "nyc-queens-bank")!;
    const north = nyc!.geometry.landmarks.find((l) => l.id === "nyc-queens-bank-north")!;
    for (const park of [south, main, north]) {
      expect(park, park?.id).toBeDefined();
      expect(park.center.x).toBe(758.7);
      expect(park.size.x).toBe(65.4);
    }
    // Split around both bridges, matching the Manhattan esplanade's own
    // z-splits exactly -- one physical bridge deck, same clearance on both
    // banks.
    expect(south.center.z).toBe(-1158);
    expect(south.size.z).toBe(604);
    expect(main.center.z).toBe(0);
    expect(main.size.z).toBe(1640);
    expect(north.center.z).toBe(1158);
    expect(north.size.z).toBe(604);
    // The east shore is flat, at exactly this strip's own west edge: no
    // water over the lawn, and no bare ground short of it either. It shipped
    // against a shore wobbling 726..744, pinned here as "the east shore's own
    // minimum reach, so this never overlaps the water" — the wrong extreme on
    // this bank, since the water reaches EAST to 744. Up to 18 m of the lawn
    // drew under the river and the strip's own park wall stood out in it
    // (issue #389); `parkLayouts.test.ts`'s "never stands a park wall in open
    // water" is the general guard.
    const river = nyc!.geometry.waterBodies!.find((w) => w.id === "nyc-east-river")!;
    const eastShoreXs = river.polygon.filter((p) => p.x > 700).map((p) => p.x);
    expect(Math.min(...eastShoreXs)).toBe(726);
    expect(Math.max(...eastShoreXs)).toBe(726);
    for (const park of [south, main, north]) {
      expect(park.center.x - park.size.x / 2).toBe(Math.max(...eastShoreXs));
    }
    // resolveParkStyle derives "riverside_strip" from these proportions
    // alone -- no hand-authored parkStyle override, matching the Manhattan
    // esplanade's own convention.
    for (const park of [south, main, north]) {
      expect(resolveParkStyle(park, "nyc")).toBe("riverside_strip");
    }
  });

  it("gives Riverside Park real Hudson water behind it instead of a bare strip to the world edge (plan Section 11.7)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const park = nyc!.geometry.landmarks.find((l) => l.id === "nyc-riverside-park")!;
    expect(park).toBeDefined();
    // East edge aligned to Riverside Drive's own pavement
    // (-1160-11/2-3.4=-1168.9); west edge unchanged at -1239.
    expect(park.center.x - park.size.x / 2).toBeCloseTo(-1239, 5);
    expect(park.center.x + park.size.x / 2).toBeCloseTo(-1168.9, 5);
    const river = nyc!.geometry.waterBodies!.find((w) => w.id === "nyc-hudson-river")!;
    expect(river).toBeDefined();
    // No vehicle portal anywhere on this shore -- nothing crosses the
    // Hudson on this map (plan's "keep the shoreline inaccessible").
    expect(river.bridgePortalSurfaceIds ?? []).toEqual([]);
    const xs = river.polygon.map((p) => p.x);
    const zs = river.polygon.map((p) => p.z);
    // Near shore meets the park's own west edge exactly for the park's whole
    // z-extent. It used to overlap the park by 4-17 m, on the reading that
    // an overlap was what kept the grass/water seam from cracking -- but
    // water draws above the lawn and the park's wall does NOT move with the
    // shore, so that overlap put the whole west wall out in the river (issue
    // #389). Sampled rather than checked vertex by vertex: the two vertices
    // that carry the bulkhead sit exactly on the park's ends, so an
    // interpolated x is the only thing that proves the span between them.
    // Beyond the park nothing at all is authored, so the shore keeps its
    // wobble there.
    const westEdge = park.center.x - park.size.x / 2;
    const minZ = park.center.z - park.size.z / 2;
    const maxZ = park.center.z + park.size.z / 2;
    const nearShoreXAtZ = (z: number): number => {
      const hits: number[] = [];
      for (let i = 0; i < river.polygon.length; i += 1) {
        const a = river.polygon[i];
        const b = river.polygon[(i + 1) % river.polygon.length];
        if (a.z === b.z || z < Math.min(a.z, b.z) || z > Math.max(a.z, b.z)) continue;
        hits.push(a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z));
      }
      // The near shore is the eastern boundary of a body that runs off the
      // west world edge.
      return Math.max(...hits);
    };
    for (let step = 0; step <= 40; step += 1) {
      const z = minZ + ((maxZ - minZ) * step) / 40;
      expect(nearShoreXAtZ(z), `Hudson shore at z=${z.toFixed(0)}`).toBeCloseTo(westEdge, 6);
    }
    // Nowhere on the map does the near shore reach the park's road-side edge.
    const nearShoreXs = xs.filter((x) => x > -1300);
    for (const x of nearShoreXs) {
      expect(x).toBeLessThan(park.center.x + park.size.x / 2);
    }
    const farShoreXs = xs.filter((x) => x <= -1300);
    for (const x of farShoreXs) {
      expect(x).toBeLessThan(-(nyc!.geometry.worldSize.x / 2));
    }
    expect(Math.min(...zs)).toBeLessThanOrEqual(-(nyc!.geometry.worldSize.z / 2));
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(nyc!.geometry.worldSize.z / 2);
  });

  it("meets the East River esplanade's edges exactly instead of leaving seams on both sides (plan Section 11.8)", () => {
    const nyc = MAP_PACKS.find((m) => m.id === "nyc-upper-west-side");
    expect(nyc).toBeDefined();
    const south = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-east-south-margin")!;
    const north = nyc!.geometry.blocks.find((b) => b.id === "nyc-block-east-north-margin")!;
    const esplanadeSouth = nyc!.geometry.landmarks.find((l) => l.id === "nyc-esplanade-south")!;
    const esplanade = nyc!.geometry.landmarks.find((l) => l.id === "nyc-esplanade")!;
    const esplanadeNorth = nyc!.geometry.landmarks.find((l) => l.id === "nyc-esplanade-north")!;
    for (const block of [south, north]) {
      // Third Ave's own pavement (440+11/2+3.4=448.9), not its generic
      // coordinate+13 inset (453) -- the mismatch that used to overlap
      // the esplanade by 0.5 m.
      expect(block.center.x + block.size.x / 2).toBeCloseTo(448.9, 5);
    }
    const river = nyc!.geometry.waterBodies!.find((w) => w.id === "nyc-east-river")!;
    const westShoreMinX = Math.min(
      ...river.polygon.filter((p) => p.x < 700).map((p) => p.x),
    );
    for (const park of [esplanadeSouth, esplanade, esplanadeNorth]) {
      // Flush against the margin blocks' own trimmed edge -- zero gap,
      // zero overlap -- and never past the shore's own closest approach.
      expect(park.center.x - park.size.x / 2).toBeCloseTo(448.9, 5);
      expect(park.center.x + park.size.x / 2).toBe(westShoreMinX);
      // The wider south/north segments' own proportions (604/107.1=5.64)
      // fall under STRIP_ASPECT alone -- pinned explicitly so the shape
      // that comes only from where the bridge splits happen to fall can
      // never silently diverge this piece's style from the untouched main
      // segment's derived "riverside_strip".
      expect(park.parkStyle).toBe("riverside_strip");
      expect(resolveParkStyle(park, "nyc")).toBe("riverside_strip");
    }
  });

  it("gives every country a currency and formats money in it", () => {
    const expected: Record<
      string,
      { code: string; symbol: string; minorUnits: number }
    > = {
      us: { code: "USD", symbol: "$", minorUnits: 2 },
      uk: { code: "GBP", symbol: "£", minorUnits: 2 },
      jp: { code: "JPY", symbol: "¥", minorUnits: 0 },
      eg: { code: "EGP", symbol: "E£", minorUnits: 2 },
    };
    for (const country of COUNTRY_PROFILES) {
      expect(country.currency, country.id).toEqual(expected[country.id]);
    }
    expect(formatMoney(1250, getCountryProfile("uk"))).toBe("£1,250.00");
    expect(formatMoney(3000, getCountryProfile("jp"))).toBe("¥3,000");
    expect(formatMoney(1000, getCountryProfile("eg"))).toBe("E£1,000.00");
    expect(formatMoney(20, getCountryProfile("us"))).toBe("$20.00");
    expect(formatMoney(1234567.5, getCountryProfile("us"))).toBe("$1,234,567.50");
  });

  describe("fuelPurchase", () => {
    it("sells the whole fill when the wallet covers it", () => {
      // 40 L x $0.40 = $16, and a fat wallet changes nothing about it.
      expect(fuelPurchase("us", TANK_CAPACITY_L, 500)).toEqual({
        litres: TANK_CAPACITY_L,
        cost: 16,
      });
      expect(fuelPurchase("us", TANK_CAPACITY_L, 16)).toEqual({
        litres: TANK_CAPACITY_L,
        cost: 16,
      });
    });

    it("sells the fraction a short wallet can pay for, at the same rate", () => {
      // The issue's own example: $16 to fill, $4 in hand -> a quarter tank.
      const short = fuelPurchase("us", TANK_CAPACITY_L, 4);
      expect(short.cost).toBe(4);
      expect(short.litres).toBe(TANK_CAPACITY_L / 4);
      // Price per litre is untouched by how much you can afford — buying in
      // dribs must never be cheaper or dearer than filling up.
      expect(short.cost / short.litres).toBeCloseTo(
        FUEL_PRICE_PER_LITRE_BY_COUNTRY.us,
        10,
      );
    });

    it("never bills more than the wallet holds, whatever the rounding", () => {
      // A wallet carrying sub-minor-unit change is the case that can round the
      // bill up past the balance; `debit` clamps at zero, so the overcharge
      // would show up only as a price the player was quoted and never paid.
      for (const wallet of [0.001, 0.014, 2.005, 7.999, 1234.567]) {
        for (const country of COUNTRY_PROFILES) {
          const { cost, litres } = fuelPurchase(
            country.id,
            TANK_CAPACITY_L,
            wallet,
          );
          expect(cost, `${country.id} @ ${wallet}`).toBeLessThanOrEqual(wallet);
          expect(litres, `${country.id} @ ${wallet}`).toBeGreaterThan(0);
        }
      }
    });

    it("sells nothing to an empty wallet or a full tank", () => {
      expect(fuelPurchase("us", TANK_CAPACITY_L, 0)).toEqual({
        litres: 0,
        cost: 0,
      });
      expect(fuelPurchase("us", 0, 500)).toEqual({ litres: 0, cost: 0 });
      // Negatives are clamped rather than trusted: fuel drain and the wallet
      // are both floats, and a hair below zero must not turn into a credit.
      expect(fuelPurchase("us", -5, -5)).toEqual({ litres: 0, cost: 0 });
    });

    it("leaves every currency a meaningful smallest useful sale", () => {
      // The prompt refuses anything at or under MIN_REFUEL_LITRES, so in each
      // country that floor has to be reachable from a plausible amount of
      // pocket change rather than being priced out of existence.
      for (const country of COUNTRY_PROFILES) {
        const floorPrice =
          MIN_REFUEL_LITRES * FUEL_PRICE_PER_LITRE_BY_COUNTRY[country.id];
        expect(
          floorPrice,
          `${country.id} prices the smallest sale above a tenth of a tank`,
        ).toBeLessThan(
          (TANK_CAPACITY_L * FUEL_PRICE_PER_LITRE_BY_COUNTRY[country.id]) / 10,
        );
        expect(
          fuelPurchase(country.id, TANK_CAPACITY_L, floorPrice).litres,
        ).toBeCloseTo(MIN_REFUEL_LITRES, 10);
      }
    });
  });

  it("anchors every gas station to a real lane within its bounds", () => {
    let count = 0;
    for (const pack of MAP_PACKS) {
      for (const service of pack.geometry.servicePoints ?? []) {
        const lane = pack.laneGraph.lanes.find(
          (candidate) => candidate.id === service.anchor.laneId,
        );
        expect(
          lane,
          `${service.id}: missing lane ${service.anchor.laneId} on ${pack.id}`,
        ).toBeDefined();
        expect(() => resolveAnchor(lane!, service.anchor)).not.toThrow();
        count += 1;
      }
    }
    // Every city has to be refuellable; a big one may want more than one pump
    // stop, so this is a floor per city rather than a fixed total. Counted by
    // kind: a repair shop is not somewhere you can fill up, so a map carrying
    // one must not read as having a station.
    for (const pack of MAP_PACKS) {
      expect(
        gasStationsOf(pack.geometry.servicePoints).length,
        `${pack.id} gas stations`,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(count).toBeGreaterThanOrEqual(MAP_PACKS.length);
  });

  it("anchors every gig venue to a real lane, with enough per city", () => {
    let count = 0;
    for (const pack of MAP_PACKS) {
      const venues = pack.geometry.gigVenues ?? [];
      for (const venue of venues) {
        const lane = pack.laneGraph.lanes.find(
          (candidate) => candidate.id === venue.anchor.laneId,
        );
        expect(
          lane,
          `${venue.id}: missing lane ${venue.anchor.laneId} on ${pack.id}`,
        ).toBeDefined();
        expect(() => resolveAnchor(lane!, venue.anchor)).not.toThrow();
        count += 1;
      }
      // A gig needs a distinct pickup + drop-off, so every city needs >= 2.
      expect(venues.length, `${pack.id} gig venues`).toBeGreaterThanOrEqual(2);
      // ...and a delivery has to load somewhere that sells something. Without
      // this, selectGigPools falls back to letting parcels start at a flat.
      expect(
        venues.filter((venue) => venue.kind === "restaurant" || venue.kind === "shop"),
        `${pack.id} pickup sources`,
      ).not.toHaveLength(0);
    }
    // Four per city plus NYC's second restaurant. Deliberately a floor rather
    // than an exact total: adding venues is the point of the map, and a magic
    // number here just makes that a chore.
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("keeps traffic side independent from steering-wheel side", () => {
    const us = getCountryProfile("us");
    const uk = getCountryProfile("uk");
    expect(us.trafficSide).toBe("right");
    expect(us.defaultSteeringSide).toBe("left");
    expect(uk.trafficSide).toBe("left");
    expect(uk.defaultSteeringSide).toBe("right");
    expect(us.trafficSide).toBe("right");
  });

  it("authors the local steering wheel and traffic side independently", () => {
    for (const country of COUNTRY_PROFILES) {
      expect(["left", "right"]).toContain(country.defaultSteeringSide);
      expect(country.trafficSide).toBe(
        country.id === "uk" || country.id === "jp" ? "left" : "right",
      );
    }
  });

  it("prices deliveries, passenger fares and fines for every country", () => {
    for (const country of COUNTRY_PROFILES) {
      const delivery = GIG_FARE_BY_COUNTRY[country.id];
      const passenger = PASSENGER_FARE_BY_COUNTRY[country.id];
      const fine = FINE_BY_COUNTRY[country.id];
      // Every table covers every country with sane, positive values.
      expect(delivery.base, country.id).toBeGreaterThan(0);
      expect(delivery.ratePerM, country.id).toBeGreaterThan(0);
      expect(passenger.base, country.id).toBeGreaterThan(0);
      expect(passenger.ratePerM, country.id).toBeGreaterThan(0);
      expect(fine, country.id).toBeGreaterThan(0);
      // A ride carries a pickup premium over the same-distance parcel.
      expect(passenger.base, country.id).toBeGreaterThan(delivery.base);
      expect(passenger.ratePerM, country.id).toBeGreaterThanOrEqual(
        delivery.ratePerM,
      );
      // The fine stings but never exceeds the starting wallet: the pivot dropped
      // harsh punishment, so careless driving costs money, not the whole run.
      expect(fine, country.id).toBeLessThan(
        STARTING_WALLET_BY_COUNTRY[country.id],
      );
    }
  });

  it("gives every lane somewhere legal to go at its far end", () => {
    // A lane whose successors are missing, empty or spatially discontinuous is
    // a trap: `advanceNpcAlongLegalRoute` recycles the vehicle the moment it
    // runs out of centreline, so it pops out of existence wherever the player
    // happens to be looking. London's bus lane dead-ended at the Exhibition
    // Road signal and every bus vanished the instant the light went green
    // (#128). The simulation's own tolerance is 0.5 m; the authored data is
    // held to the tighter 0.01 m checked below.
    const strandedLanes: string[] = [];
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      for (const lane of map.laneGraph.lanes) {
        const end = lane.centerline.at(-1)!;
        const continuations = lane.successors.filter((successorId) => {
          const successor = lanes.get(successorId);
          if (!successor) return false;
          const start = successor.centerline[0];
          return Math.hypot(end.x - start.x, end.z - start.z) < 0.5;
        });
        if (!continuations.length) {
          strandedLanes.push(
            `${map.id}/${lane.id} strands traffic at (${end.x}, ${end.z})`,
          );
        }
      }
    }
    expect(strandedLanes).toEqual([]);
  });

  it("validates lane references, legal successors, controls, and spawns", () => {
    const invalidSuccessors: string[] = [];
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const conflicts = new Set(
        map.laneGraph.conflictZones.map((zone) => zone.id),
      );
      const roadSurfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );

      for (const lane of map.laneGraph.lanes) {
        expect(lane.centerline.length, lane.id).toBeGreaterThanOrEqual(2);
        expect(lane.widthM, lane.id).toBeGreaterThanOrEqual(2.7);
        const surface = roadSurfaces.get(lane.roadId);
        expect(surface, `${lane.id} → road ${lane.roadId}`).toBeDefined();
        expect(surface?.laneIds, `${lane.id} on ${lane.roadId}`).toContain(lane.id);
        for (const successorId of lane.successors) {
          const successor = lanes.get(successorId);
          if (!successor) {
            invalidSuccessors.push(`${lane.id} → missing ${successorId}`);
            continue;
          }
          const end = lane.centerline.at(-1)!;
          const start = successor.centerline[0];
          if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.01) {
            invalidSuccessors.push(`${lane.id} ⇥ ${successorId}`);
          }
        }
      }

      for (const control of map.laneGraph.controls) {
        for (const laneId of control.laneIds) {
          expect(lanes.has(laneId), `${control.id} → ${laneId}`).toBe(true);
        }
        for (const conflictId of control.conflictZoneIds ?? []) {
          expect(
            conflicts.has(conflictId),
            `${control.id} → ${conflictId}`,
          ).toBe(true);
        }
        for (const controlApproach of control.approaches) {
          expect(controlApproach.laneIds).toContain(
            controlApproach.stopLine.laneId,
          );
          expect(
            lanes.has(controlApproach.stopLine.laneId),
            `${control.id} → ${controlApproach.stopLine.laneId}`,
          ).toBe(true);
          expect(controlApproach.stopLine.distanceAlongM).toBeGreaterThanOrEqual(0);
        }
        expect(control.installations.length, control.id).toBeGreaterThan(0);
      }

      for (const spawn of map.laneGraph.spawnPoints) {
        if (spawn.kind === "player" || spawn.kind === "vehicle") {
          expect(lanes.has(spawn.anchor.laneId), `${spawn.id} → ${spawn.anchor.laneId}`).toBe(true);
          expect(spawn.anchor.distanceAlongM).toBeGreaterThan(0);
        } else if ("pose" in spawn && spawn.laneId) {
          expect(lanes.has(spawn.laneId), `${spawn.id} → ${spawn.laneId}`).toBe(true);
        }
      }
    }
    expect(invalidSuccessors).toEqual([]);
  });

  it("contains every sampled lane envelope within its authored road surface", () => {
    const envelopeViolations: string[] = [];
    let sampledPointCount = 0;

    for (const map of MAP_PACKS) {
      const roadSurfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );
      for (const lane of map.laneGraph.lanes) {
        const surface = roadSurfaces.get(lane.roadId);
        expect(surface, `${map.id}/${lane.id} → ${lane.roadId}`).toBeDefined();
        if (!surface) {
          continue;
        }
        expect(surface.centerline.length, surface.id).toBeGreaterThanOrEqual(2);

        let worstOverflowM = Number.NEGATIVE_INFINITY;
        let worstPoint: WorldPoint | null = null;
        for (const sample of samplePolyline(
          lane.centerline,
          ROAD_ENVELOPE_SAMPLE_INTERVAL_M,
        )) {
          sampledPointCount += 1;
          const distanceFromEndpointM = Math.min(
            sample.distanceAlongM,
            sample.totalLengthM - sample.distanceAlongM,
          );
          const junctionTaper = Math.max(
            0,
            1 - distanceFromEndpointM / JUNCTION_TAPER_LENGTH_M,
          );
          const allowedEpsilonM =
            ROAD_ENVELOPE_EPSILON_M +
            junctionTaper * JUNCTION_TAPER_EPSILON_M;
          const laneEnvelopeRadiusM =
            distanceToPolyline(sample.point, surface.centerline) +
            lane.widthM / 2;
          const overflowM =
            laneEnvelopeRadiusM - surface.widthM / 2 - allowedEpsilonM;
          if (overflowM > worstOverflowM) {
            worstOverflowM = overflowM;
            worstPoint = sample.point;
          }
        }

        if (worstOverflowM > GEOMETRY_EPSILON && worstPoint) {
          envelopeViolations.push(
            `${map.id}/${lane.id} exceeds ${surface.id} by ${worstOverflowM.toFixed(2)}m at (${worstPoint.x.toFixed(2)}, ${worstPoint.z.toFixed(2)})`,
          );
        }
      }
    }

    expect(sampledPointCount).toBeGreaterThan(1_000);
    expect(envelopeViolations).toEqual([]);
  });

  it("limits authored junction connectors to two metres and keeps anchors outside them", () => {
    const unsafeAnchors: string[] = [];
    const invalidConnectors: string[] = [];

    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const conflicts = new Map(
        map.laneGraph.conflictZones.map((zone) => [zone.id, zone]),
      );
      for (const lane of map.laneGraph.lanes) {
        const lengthM = laneLength(lane);
        for (const range of lane.connectorRanges ?? []) {
          const connectorLengthM =
            range.endDistanceAlongM - range.startDistanceAlongM;
          if (
            range.startDistanceAlongM < -GEOMETRY_EPSILON ||
            connectorLengthM <= GEOMETRY_EPSILON ||
            connectorLengthM > 2 + GEOMETRY_EPSILON ||
            range.endDistanceAlongM > lengthM + GEOMETRY_EPSILON
          ) {
            invalidConnectors.push(
              `${map.id}/${lane.id} has invalid ${connectorLengthM.toFixed(2)}m connector`,
            );
          }
          if (!range.conflictZoneId) {
            invalidConnectors.push(
              `${map.id}/${lane.id} connector has no conflict zone`,
            );
            continue;
          }
          const zone = conflicts.get(range.conflictZoneId);
          if (!zone) {
            invalidConnectors.push(
              `${map.id}/${lane.id} references missing ${range.conflictZoneId}`,
            );
            continue;
          }
          if (!zone.laneIds.includes(lane.id)) {
            invalidConnectors.push(
              `${map.id}/${lane.id} is absent from ${zone.id}`,
            );
          }
          for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
            const sampleDistanceM =
              range.startDistanceAlongM + connectorLengthM * amount;
            const sample = resolveAnchor(lane, {
              laneId: lane.id,
              distanceAlongM: sampleDistanceM,
            }).position;
            if (!pointInPolygon(sample, zone.polygon)) {
              invalidConnectors.push(
                `${map.id}/${lane.id} connector sample ${sampleDistanceM.toFixed(2)}m lies outside ${zone.id}`,
              );
            }
          }
        }
      }
      const anchors = map.laneGraph.spawnPoints.flatMap((spawn) =>
        spawn.kind === "player"
          ? [{ id: spawn.id, anchor: spawn.anchor }]
          : [],
      );

      for (const item of anchors) {
        const lane = lanes.get(item.anchor.laneId);
        if (!lane) continue;
        const resolved = resolveAnchor(lane, item.anchor);
        for (const range of lane.connectorRanges ?? []) {
          if (
            item.anchor.distanceAlongM >
              range.startDistanceAlongM + GEOMETRY_EPSILON &&
            item.anchor.distanceAlongM <
              range.endDistanceAlongM - GEOMETRY_EPSILON
          ) {
            unsafeAnchors.push(
              `${map.id}/${item.id} lies in ${lane.id} connector`,
            );
          }
        }
        for (const zone of map.laneGraph.conflictZones) {
          if (pointInPolygon(resolved.position, zone.polygon)) {
            unsafeAnchors.push(`${map.id}/${item.id} lies in ${zone.id}`);
          }
        }
      }
    }

    expect(invalidConnectors).toEqual([]);
    expect(unsafeAnchors).toEqual([]);
  });

  it("resolves London starts to their established legal lane positions", () => {
    const map = getMapPack("london-south-kensington");
    const expected = [
      {
        spawnId: "london-player",
        laneId: "london-local-west",
        x: -121.98,
        z: -105.8,
      },
      {
        spawnId: "london-player-queen-gate",
        laneId: "london-queen-gate-north-1",
        x: -109.7,
        z: -92,
      },
    ] as const;

    for (const item of expected) {
      const spawn = map.laneGraph.spawnPoints.find(
        (candidate) => candidate.id === item.spawnId,
      );
      expect(spawn?.kind).toBe("player");
      if (spawn?.kind !== "player") continue;
      const lane = map.laneGraph.lanes.find(
        (candidate) => candidate.id === item.laneId,
      );
      expect(lane).toBeDefined();
      if (!lane) continue;
      const resolved = resolveAnchor(lane, spawn.anchor);
      expect(resolved.position.x).toBeCloseTo(item.x, 1);
      expect(resolved.position.z).toBeCloseTo(item.z, 1);
    }
  });

  it("keeps playable anchors lane-true with vehicle clearance from edges and dividers", () => {
    const unsafeAnchors: string[] = [];
    const requiredClearanceM =
      PLAYER_HALF_WIDTH_M + PLAYER_LATERAL_CLEARANCE_M;

    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const surfaces = new Map(
        map.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
      );
      const anchors = map.laneGraph.spawnPoints.flatMap((spawn) =>
        spawn.kind === "player"
          ? [{ id: spawn.id, anchor: spawn.anchor }]
          : [],
      );

      for (const item of anchors) {
        const lane = lanes.get(item.anchor.laneId);
        if (!lane) continue;
        const surface = surfaces.get(lane.roadId);
        if (!surface) continue;
        const position = resolveAnchor(lane, item.anchor).position;
        const roadEdgeClearanceM =
          surface.widthM / 2 - distanceToPolyline(position, surface.centerline);
        if (roadEdgeClearanceM < requiredClearanceM - GEOMETRY_EPSILON) {
          unsafeAnchors.push(
            `${map.id}/${item.id} has ${roadEdgeClearanceM.toFixed(2)}m road-edge clearance`,
          );
        }
        for (const marking of surface.markings) {
          if (
            marking.style !== "centre_dashed" &&
            marking.style !== "centre_solid" &&
            marking.style !== "lane_dashed" &&
            marking.style !== "lane_solid"
          ) {
            continue;
          }
          const dividerClearanceM = distanceToPolyline(position, marking.points);
          if (dividerClearanceM < requiredClearanceM - GEOMETRY_EPSILON) {
            unsafeAnchors.push(
              `${map.id}/${item.id} has ${dividerClearanceM.toFixed(2)}m clearance from ${marking.id}`,
            );
          }
        }
      }
    }

    expect(unsafeAnchors).toEqual([]);
  });

  it("resolves every stop line and anchored spawn within its lane", () => {
    for (const map of MAP_PACKS) {
      const lanes = new Map(map.laneGraph.lanes.map((lane) => [lane.id, lane]));

      for (const control of map.laneGraph.controls) {
        for (const controlApproach of control.approaches) {
          const lane = lanes.get(controlApproach.stopLine.laneId);
          expect(
            lane,
            `${map.id}/${control.id}/${controlApproach.id} → ${controlApproach.stopLine.laneId}`,
          ).toBeDefined();
          if (lane) {
            resolveAnchor(lane, controlApproach.stopLine);
          }
        }
      }

      for (const spawn of map.laneGraph.spawnPoints) {
        if (spawn.kind !== "player" && spawn.kind !== "vehicle") {
          continue;
        }
        const lane = lanes.get(spawn.anchor.laneId);
        expect(
          lane,
          `${map.id}/${spawn.id} → ${spawn.anchor.laneId}`,
        ).toBeDefined();
        if (lane) {
          resolveAnchor(lane, spawn.anchor);
        }
      }
    }
  });

  it("keeps opposing lane centrelines disjoint outside shared junction endpoints", () => {
    const unexpectedIntersections: string[] = [];
    let opposingPairCount = 0;

    for (const map of MAP_PACKS) {
      for (let firstIndex = 0; firstIndex < map.laneGraph.lanes.length; firstIndex += 1) {
        const first = map.laneGraph.lanes[firstIndex];
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < map.laneGraph.lanes.length;
          secondIndex += 1
        ) {
          const second = map.laneGraph.lanes[secondIndex];
          const isOpposingPair =
            first.roadId === second.roadId &&
            first.from === second.to &&
            first.to === second.from;
          if (!isOpposingPair) {
            continue;
          }
          opposingPairCount += 1;
          const firstEndpoints = [
            first.centerline[0],
            first.centerline.at(-1)!,
          ];
          const secondEndpoints = [
            second.centerline[0],
            second.centerline.at(-1)!,
          ];
          const sharedJunctionEndpoints = firstEndpoints.filter((point) =>
            secondEndpoints.some((candidate) => pointsMatch(point, candidate)),
          );

          for (let firstSegment = 1; firstSegment < first.centerline.length; firstSegment += 1) {
            for (
              let secondSegment = 1;
              secondSegment < second.centerline.length;
              secondSegment += 1
            ) {
              const intersection = segmentIntersection(
                first.centerline[firstSegment - 1],
                first.centerline[firstSegment],
                second.centerline[secondSegment - 1],
                second.centerline[secondSegment],
              );
              if (!intersection) {
                continue;
              }
              if (intersection.kind === "overlap") {
                unexpectedIntersections.push(
                  `${map.id}: ${first.id} overlaps ${second.id} by ${intersection.lengthM.toFixed(2)}m`,
                );
                continue;
              }
              if (
                !sharedJunctionEndpoints.some((endpoint) =>
                  pointsMatch(endpoint, intersection.point),
                )
              ) {
                unexpectedIntersections.push(
                  `${map.id}: ${first.id} crosses ${second.id} at (${intersection.point.x.toFixed(2)}, ${intersection.point.z.toFixed(2)})`,
                );
              }
            }
          }
        }
      }
    }

    expect(opposingPairCount).toBeGreaterThanOrEqual(20);
    expect(unexpectedIntersections).toEqual([]);
  });

  it("rejects near-collinear reverse overlaps between connected route lanes", () => {
    const overlaps: string[] = [];

    for (const map of MAP_PACKS) {
      for (let firstIndex = 0; firstIndex < map.laneGraph.lanes.length; firstIndex += 1) {
        const first = map.laneGraph.lanes[firstIndex];
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < map.laneGraph.lanes.length;
          secondIndex += 1
        ) {
          const second = map.laneGraph.lanes[secondIndex];
          const routeConnected =
            first.successors.includes(second.id) ||
            second.successors.includes(first.id);
          if (!routeConnected) continue;

          for (let firstSegment = 1; firstSegment < first.centerline.length; firstSegment += 1) {
            for (let secondSegment = 1; secondSegment < second.centerline.length; secondSegment += 1) {
              const overlapM = nearCollinearReverseOverlapM(
                first.centerline[firstSegment - 1],
                first.centerline[firstSegment],
                second.centerline[secondSegment - 1],
                second.centerline[secondSegment],
              );
              // A connector may share a graph node for at most two metres;
              // sustained reverse overlap beyond it is an invalid route.
              if (overlapM > 2 + GEOMETRY_EPSILON) {
                overlaps.push(
                  `${map.id}: ${first.id} reverses over ${second.id} for ${overlapM.toFixed(2)}m`,
                );
              }
            }
          }
        }
      }
    }

    expect(overlaps).toEqual([]);
  });

  it("places physical traffic-control supports outside every lane envelope", () => {
    const unsafeInstallations: string[] = [];
    let physicalInstallationCount = 0;

    for (const map of MAP_PACKS) {
      for (const control of map.laneGraph.controls) {
        for (const installation of control.installations) {
          // Road markings belong on the carriageway.
          if (installation.mounting === "road_marking") {
            continue;
          }
          physicalInstallationCount += 1;
          for (const lane of map.laneGraph.lanes) {
            const clearance =
              distanceToLaneCenterline(installation.position, lane) -
              lane.widthM / 2;
            if (clearance < 0.25 - GEOMETRY_EPSILON) {
              unsafeInstallations.push(
                `${map.id}/${installation.id} is ${clearance.toFixed(2)}m outside ${lane.id}`,
              );
            }
          }
        }
      }
    }

    expect(physicalInstallationCount).toBeGreaterThan(0);
    expect(unsafeInstallations).toEqual([]);
  });

  it("gives every free drive an anchored player start on its destination map", () => {
    for (const freeDrive of FREE_DRIVES) {
      const map = getMapPack(freeDrive.mapId);
      const start = map.laneGraph.spawnPoints.find(
        (spawn) => spawn.id === freeDrive.startSpawnId,
      );
      expect(start?.kind, `${freeDrive.id} → ${freeDrive.startSpawnId}`).toBe(
        "player",
      );
    }
  });

  it("keeps moved parks and street furniture clear of driveable surfaces", () => {
    const checks = [
      ["nyc-upper-west-side", "nyc-subway"],
      ["tokyo-setagaya", "jp-temple-green"],
      ["london-south-kensington", "london-exhibition-road-public-space"],
      ["cairo-central-nile", "cairo-tahrir-obelisk"],
      ["cairo-central-nile", "cairo-tahrir-ministries"],
    ] as const;

    for (const [mapId, landmarkId] of checks) {
      const map = getMapPack(mapId);
      const landmark = map.geometry.landmarks.find(
        (candidate) => candidate.id === landmarkId,
      );
      expect(landmark, `${mapId}/${landmarkId}`).toBeDefined();
      if (!landmark) continue;

      const closestSurfaceClearanceM = Math.min(
        ...map.geometry.roadSurfaces.flatMap((surface) =>
          surface.centerline.slice(1).map((end, index) => {
            const start = surface.centerline[index];
            const dx = end.x - start.x;
            const dz = end.z - start.z;
            const length = Math.hypot(dx, dz);
            const lateralHalfSpanM =
              length <= GEOMETRY_EPSILON
                ? Math.max(landmark.size.x, landmark.size.z) / 2
                :
                    (Math.abs(dz / length) * landmark.size.x) / 2 +
                    (Math.abs(dx / length) * landmark.size.z) / 2;
            return (
              distanceToSegment(landmark.center, start, end) -
              surface.widthM / 2 -
              lateralHalfSpanM
            );
          }),
        ),
      );
      expect(
        closestSurfaceClearanceM,
        `${mapId}/${landmarkId} overlaps a road surface`,
      ).toBeGreaterThanOrEqual(-GEOMETRY_EPSILON);
    }
  });

  it("keeps every rotated park's long axis on the road it follows", () => {
    // A park only ever carries a `headingDeg` because it is a kerb ribbon
    // following a road that drifts, so a rotated rect whose long axis does NOT
    // lie along a road is always a mistake — and the mistake this gate exists
    // for is a sign flip.
    //
    // `headingDeg` is a CLOCKWISE world yaw: the lawn is a Babylon mesh spun by
    // `lawn.rotation.y`, and Babylon's left-handed Y rotation turns the other
    // way from the textbook atan2(dz, dx). All five of London's rotated parks
    // shipped at the textbook sign, so every one rendered at MINUS its authored
    // yaw. The rects were aligned on paper and in every audit script anyone
    // wrote; only the lawn mesh knew. It survived three play-test rounds
    // because the error is zero at the rect's centre and grows toward the ends
    // — Notting Hill's 330 m ribbon was 9.5 m off its kerb at one end and out
    // under the carriageway at the other, and the King's Road green was 24 m
    // out. Nothing else could catch it: the AABB is identical under either
    // sign, so mesh-bounds checks pass and the map draws it right.
    //
    // Bridges and other rotated landmarks are excluded — only `kind: "park"`
    // reaches `buildParkLawn`.
    const MAX_ROAD_SKEW_DEG = 3;
    const violations: string[] = [];
    for (const pack of MAP_PACKS) {
      for (const park of pack.geometry.landmarks) {
        if (park.kind !== "park") continue;
        if (!park.headingDeg) continue;
        let nearest: { distanceM: number; bearingDeg: number } | null = null;
        for (const surface of pack.geometry.roadSurfaces) {
          for (let i = 0; i < surface.centerline.length - 1; i += 1) {
            const from = surface.centerline[i];
            const to = surface.centerline[i + 1];
            const dx = to.x - from.x;
            const dz = to.z - from.z;
            const lengthSq = dx * dx + dz * dz;
            if (lengthSq < GEOMETRY_EPSILON) continue;
            const t = Math.min(
              1,
              Math.max(
                0,
                ((park.center.x - from.x) * dx + (park.center.z - from.z) * dz) /
                  lengthSq,
              ),
            );
            const distanceM = Math.hypot(
              park.center.x - (from.x + dx * t),
              park.center.z - (from.z + dz * t),
            );
            if (nearest && distanceM >= nearest.distanceM) continue;
            // Clockwise yaw, so a run of (dx, dz) is atan2(-dz, dx).
            nearest = {
              distanceM,
              bearingDeg: (Math.atan2(-dz, dx) * 180) / Math.PI,
            };
          }
        }
        if (!nearest) continue;
        // The axis that has to lie along the road is the park's LONG one, and
        // `headingDeg` describes local +x. A rect authored deeper than it is
        // long therefore follows its road at yaw - 90, not at yaw.
        const longAxisDeg =
          park.size.z > park.size.x ? park.headingDeg - 90 : park.headingDeg;
        // A rectangle is symmetric under a half turn, so compare mod 180.
        const rawSkew = Math.abs(
          (((longAxisDeg - nearest.bearingDeg) % 360) + 540) % 360 - 180,
        );
        const skewDeg = Math.min(rawSkew, 180 - rawSkew);
        if (skewDeg <= MAX_ROAD_SKEW_DEG) continue;
        const halfLengthM = Math.max(park.size.x, park.size.z) / 2;
        const wantDeg =
          park.size.z > park.size.x
            ? nearest.bearingDeg + 90
            : nearest.bearingDeg;
        violations.push(
          `${pack.id}/${park.id} sits ${skewDeg.toFixed(2)} deg off its road ` +
            `(${(((skewDeg * Math.PI) / 180) * halfLengthM).toFixed(1)} m adrift ` +
            `at its ends); a clockwise yaw of ${wantDeg.toFixed(2)} ` +
            `would follow it`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps every venue building out of every walled park", () => {
    // Nothing geometrically stops one. A venue is thrown to the **driver's
    // right** of its anchor lane, so which side of an avenue it lands on is
    // decided entirely by whether the anchor names the northbound or the
    // southbound lane — and on a park-flanking avenue the wrong one plants the
    // building in the park, straddling the perimeter wall. `buildingKeepOuts`
    // covers the street wall against venues, `parkPerimeterPlan` vetoes the
    // wall against *roads*, and `landmarkClearings` skips parks outright, so
    // no existing gate was looking at this pair at all. Two venues had shipped
    // inside a park when this was written: the Gallery Café through Central
    // Park's east wall, and Third Avenue Towers Offices through the
    // esplanade's.
    //
    // Gated on parks that actually grow a wall, which is the derived answer to
    // "does this park have a boundary at all". A `pocket_green` or a
    // `civic_plaza` deliberately has none — London's 8 x 40 m Exhibition Road
    // planting strip is meant to run up against the shopfronts beside a
    // shared-space street, and calling that a violation would be wrong.
    //
    // The box tested is the collider the adapter already emits, not a
    // re-derivation: `buildingKeepOuts` sizes its circle from the *authored*
    // `footprint` while the collider and the visual both come from
    // `PROP_MODEL_FOOTPRINTS_M`, and it was the measured one sticking out into
    // the lawn.
    const violations: string[] = [];
    for (const pack of MAP_PACKS) {
      const walledParks = pack.geometry.landmarks.filter(
        (landmark) =>
          landmark.kind === "park" &&
          parkLayoutForLandmark(pack, landmark).wall.length > 0,
      );
      if (walledParks.length === 0) continue;
      const half = {
        x: pack.geometry.worldSize.x / 2,
        z: pack.geometry.worldSize.z / 2,
      };
      const venues = buildStaticObstacles({
        mapPack: pack,
        bounds: { minX: -half.x, maxX: half.x, minZ: -half.z, maxZ: half.z },
        buildingLayout: planMapBuildings(pack, hashStringToSeed(pack.id)),
      }).filter(
        (obstacle) => obstacle.kind === "obb" && obstacle.tag === "venue",
      );
      expect(venues.length, `${pack.id} venue colliders`).toBeGreaterThan(0);

      for (const venue of venues) {
        if (venue.kind !== "obb") continue;
        for (const park of walledParks) {
          const yawRad = degreesToRadians(park.headingDeg ?? 0);
          const overlapM = orientedBoxOverlapM(
            {
              x: venue.x,
              z: venue.z,
              ux: venue.ux,
              uz: venue.uz,
              halfU: venue.halfU,
              halfV: venue.halfV,
            },
            {
              x: park.center.x,
              z: park.center.z,
              // Park convention (parkLayouts toWorld / the lawn's
              // rotation.y): headingDeg is a CLOCKWISE yaw, so local +z maps
              // to (sin, cos). This read (-sin, cos) until the rotated kerb
              // ribbons showed the lawn mesh spinning the other way — a
              // mirrored box passes and fails the wrong parks.
              ux: Math.sin(yawRad),
              uz: Math.cos(yawRad),
              halfU: park.size.z / 2,
              halfV: park.size.x / 2,
            },
          );
          if (overlapM > 0) {
            violations.push(
              `${venue.id} stands ${overlapM.toFixed(2)} m inside ${park.id}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps every authored block out of every park and out of the water", () => {
    // The sibling gap to the venue check above, found the same way — after the
    // fact. `roadsideParcel`'s `side` is the sign of the road's right-hand
    // normal travelling from->to, but call sites read it as a compass, which
    // inverts on every road authored northward or westward: seven London
    // parcels shipped standing up to 39 m inside a park (three of them through
    // the royal park's perimeter wall), and nothing failed. Unlike the venue
    // check this is NOT gated on walled parks: a block over a pocket green
    // puts a facade grid on the lawn regardless of whether a wall exists
    // (King's Road's parcel had swallowed the Chelsea square green whole).
    //
    // The boxes tested are the plain authored block rects (center/size/
    // headingDeg exactly as written in content), not anything collision or
    // render derives from them. A museum's two collision wings and a service
    // lot's carve can only ever shrink what actually stands there, so testing
    // the full authored rect is the stricter of the two and stays correct
    // now that collision no longer carries one box per block at all.
    const violations: string[] = [];
    for (const pack of MAP_PACKS) {
      const parks = pack.geometry.landmarks.filter(
        (landmark) => landmark.kind === "park",
      );
      for (const block of pack.geometry.blocks) {
        const blockYawRad = degreesToRadians(block.headingDeg ?? 0);
        const box = {
          x: block.center.x,
          z: block.center.z,
          ux: Math.cos(blockYawRad),
          uz: -Math.sin(blockYawRad),
          halfU: block.size.x / 2,
          halfV: block.size.z / 2,
        };
        for (const park of parks) {
          const yawRad = degreesToRadians(park.headingDeg ?? 0);
          const overlapM = orientedBoxOverlapM(box, {
            x: park.center.x,
            z: park.center.z,
            // Same park-convention sign as the venue check above.
            ux: Math.sin(yawRad),
            uz: Math.cos(yawRad),
            halfU: park.size.z / 2,
            halfV: park.size.x / 2,
          });
          if (overlapM > 0) {
            violations.push(
              `${block.id} stands ${overlapM.toFixed(2)} m inside ${park.id}`,
            );
          }
        }
        // Water: a block corner in a water polygon means a facade grid in the
        // river. Corner containment is sufficient here — a polygon thin enough
        // to pass between a block's corners while crossing it does not exist
        // on these maps, and the embankment parcels this guards are authored
        // landward-only precisely because the trimmer measures roads, not
        // water.
        const corners = [
          { u: box.halfU, v: box.halfV },
          { u: -box.halfU, v: box.halfV },
          { u: -box.halfU, v: -box.halfV },
          { u: box.halfU, v: -box.halfV },
        ].map(({ u, v }) => ({
          x: box.x + box.ux * u + box.uz * v,
          z: box.z + box.uz * u - box.ux * v,
        }));
        for (const water of pack.geometry.waterBodies ?? []) {
          const inside = corners.some((corner) => {
            let contained = false;
            const poly = water.polygon;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              if (
                poly[i].z > corner.z !== poly[j].z > corner.z &&
                corner.x <
                  ((poly[j].x - poly[i].x) * (corner.z - poly[i].z)) /
                    (poly[j].z - poly[i].z) +
                    poly[i].x
              ) {
                contained = !contained;
              }
            }
            return contained;
          });
          if (inside) {
            violations.push(`${block.id} has a corner in ${water.id}`);
          }
        }
      }
    }
    // Pre-existing debt this gate discovered outside London, pinned EXACTLY:
    // a Cairo generated roadside strip reaches 2.81 m into the opera
    // grounds — an edge-nip a player has never noticed, out of scope for
    // the London work that added this gate. Pinning it verbatim means it
    // can neither grow nor multiply silently; fixing it in Cairo's own
    // content pass is welcome (Phase 5) — delete the entry here when you
    // do. The two NYC margin-strip entries this list used to carry (each
    // 0.5 m inside its own esplanade split) are gone: visual-gap plan
    // Section 11.8 trimmed nyc-block-east-south-margin/-north-margin and
    // reshaped the esplanade to meet exactly, not overlap.
    expect(violations).toEqual([
      "cairo-opera-corridor-roadside-3-3-right stands 2.81 m inside cairo-opera-grounds",
    ]);
  });

  it("aligns the visible Tokyo railway and controls both crossing directions", () => {
    const tokyo = getMapPack("tokyo-setagaya");
    const railway = tokyo.geometry.landmarks.find(
      (landmark) => landmark.id === "jp-setagaya-line",
    );
    const railControl = tokyo.laneGraph.controls.find(
      (control) => control.id === "jp-rail-signal",
    );
    const stationCrosswalk = tokyo.laneGraph.controls.find(
      (control) => control.id === "jp-crosswalk-station",
    );

    expect(railway).toMatchObject({
      center: { x: 18, z: -62 },
      size: { x: 5, z: 72 },
    });
    expect(railControl?.laneIds).toEqual([
      "jp-south-east-2",
      "jp-south-west-2",
    ]);
    expect(railControl?.approaches.map((item) => item.stopLine)).toEqual([
      { laneId: "jp-south-east-2", distanceAlongM: 42 },
      { laneId: "jp-south-west-2", distanceAlongM: 48 },
    ]);
    expect(stationCrosswalk?.approaches[1]?.stopLine).toEqual({
      laneId: "jp-narrow-north-1",
      distanceAlongM: 82,
    });
  });
});
