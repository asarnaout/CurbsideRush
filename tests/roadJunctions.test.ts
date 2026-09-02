import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  collectRoadJunctionFills,
  type RoadJunctionSource,
} from "../app/game/geometry/roadStrips";

type Pt = { x: number; z: number };

// Even-odd ray cast; true when p is strictly inside the polygon.
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = a.z > p.z !== b.z > p.z;
    if (straddles && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// A perpendicular 4-way: an E-W avenue and a N-S street sharing node (0,0).
const EW_HALF = 3.2;
const NS_HALF = 2.9;
const CROSSROADS: RoadJunctionSource[] = [
  { id: "ew", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }, { x: 40, z: 0 }], widthM: EW_HALF * 2 },
  { id: "ns", centerline: [{ x: 0, z: -40 }, { x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
];

describe("collectRoadJunctionFills", () => {
  it("emits exactly one fill where two roads share a crossing node", () => {
    const fills = collectRoadJunctionFills(CROSSROADS);
    expect(fills).toHaveLength(1);
    expect(fills[0].polygon.length).toBeGreaterThanOrEqual(4);
  });

  it("covers all four corner throats so no shoulder shows through as a wedge", () => {
    // The throats are where the carriageway edges cross: (±NS_HALF, ±EW_HALF).
    // These being *inside* the fill is precisely the bug fix — a short-reach hull
    // chamfered them off and left the tan shoulder exposed.
    const [fill] = collectRoadJunctionFills(CROSSROADS);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const throat = { x: sx * (NS_HALF - 0.1), z: sz * (EW_HALF - 0.1) };
        expect(pointInPolygon(throat, fill.polygon)).toBe(true);
      }
    }
  });

  it("does not pave a lone road that crosses nothing", () => {
    expect(collectRoadJunctionFills([CROSSROADS[0]])).toHaveLength(0);
  });

  it("does not merge a flyover with the street crossing below it", () => {
    const stacked: RoadJunctionSource[] = [
      CROSSROADS[0],
      {
        id: "flyover",
        centerline: [
          { x: 0, z: -40, elevationM: 10.5 },
          { x: 0, z: 0, elevationM: 10.5 },
          { x: 0, z: 40, elevationM: 10.5 },
        ],
        widthM: NS_HALF * 2,
      },
    ];
    expect(collectRoadJunctionFills(stacked)).toHaveLength(0);
  });

  it("does not roof a sloped elevated ramp with a flat junction fill", () => {
    const elevatedTee: RoadJunctionSource[] = [
      {
        id: "level-mainline",
        centerline: [
          { x: -40, z: 0, elevationM: 10.5 },
          { x: 0, z: 0, elevationM: 10.5 },
          { x: 40, z: 0, elevationM: 10.5 },
        ],
        widthM: 14,
      },
      {
        id: "descending-ramp",
        centerline: [
          { x: 0, z: 0, elevationM: 10.5 },
          { x: 0, z: 50, elevationM: 5.2 },
        ],
        widthM: 7.6,
      },
    ];
    expect(collectRoadJunctionFills(elevatedTee)).toHaveLength(0);

    const levelBranch = {
      ...elevatedTee[1],
      centerline: elevatedTee[1].centerline.map((point) => ({
        ...point,
        elevationM: 10.5,
      })),
    };
    expect(collectRoadJunctionFills([elevatedTee[0], levelBranch])).toHaveLength(1);
  });

  it("covers the throat of a T-junction where a side road ends on an avenue", () => {
    const tee: RoadJunctionSource[] = [
      CROSSROADS[0], // E-W avenue passing through (0,0)
      { id: "branch", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: NS_HALF * 2 },
    ];
    const fills = collectRoadJunctionFills(tee);
    expect(fills).toHaveLength(1);
    // The two throats on the branch side must be paved.
    for (const sx of [-1, 1]) {
      expect(
        pointInPolygon({ x: sx * (NS_HALF - 0.1), z: EW_HALF - 0.1 }, fills[0].polygon),
      ).toBe(true);
    }
  });

  it("grows the fill when the sections are inflated for the dirt-shoulder apron", () => {
    const [asphalt] = collectRoadJunctionFills(CROSSROADS, 0);
    const [shoulder] = collectRoadJunctionFills(CROSSROADS, 1.2);
    const spanX = (poly: readonly Pt[]) =>
      Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
    // The inflated apron must extend beyond the bare carriageway fill so it can
    // ring the paved junction with a tan edge.
    expect(spanX(shoulder.polygon)).toBeGreaterThan(spanX(asphalt.polygon));
  });

  it("leaves the pavement corner between the arms unpaved", () => {
    // The reported bug. A convex hull spans the four arms and so swallows the
    // corners between them — the exact ground the traffic-light pole, the
    // streetlight and the waiting pedestrians stand on. A crossroads is a plus.
    const [fill] = collectRoadJunctionFills(CROSSROADS);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = { x: sx * (NS_HALF + 1.5), z: sz * (EW_HALF + 1.5) };
        expect(pointInPolygon(corner, fill.polygon)).toBe(false);
      }
    }
  });

  it("rounds each corner off with a kerb radius", () => {
    const [rounded] = collectRoadJunctionFills(CROSSROADS);
    const [square] = collectRoadJunctionFills(CROSSROADS, 0, 0);
    // Just diagonally outside the sharp corner: asphalt once the kerb curves,
    // pavement when it does not.
    const justOutside = { x: NS_HALF + 0.3, z: EW_HALF + 0.3 };
    expect(pointInPolygon(justOutside, rounded.polygon)).toBe(true);
    expect(pointInPolygon(justOutside, square.polygon)).toBe(false);
  });

  it("closes the notch on the outside of a bend between two surfaces", () => {
    // Two roads meeting end-to-end at a right angle cover the inside of the
    // turn twice over and the outside not at all; the fill has to chamfer it.
    const bend: RoadJunctionSource[] = [
      { id: "west", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }], widthM: EW_HALF * 2 },
      { id: "north", centerline: [{ x: 0, z: 0 }, { x: 0, z: 40 }], widthM: EW_HALF * 2 },
    ];
    const [fill] = collectRoadJunctionFills(bend);
    expect(pointInPolygon({ x: EW_HALF - 0.3, z: -EW_HALF + 0.3 }, fill.polygon)).toBe(true);
  });

  it("paves both sides of a ring at the node an approach joins", () => {
    // A roundabout centreline is a closed loop, so its first point has a
    // carriageway either side of it. Treating it as a dead end bites a wedge
    // out of the ring at the one node that always has an approach on it.
    const ring: RoadJunctionSource[] = [
      {
        id: "ring",
        centerline: [
          { x: 0, z: 20 }, { x: 20, z: 0 }, { x: 0, z: -20 }, { x: -20, z: 0 },
          { x: 0, z: 20 },
        ],
        widthM: 7.2,
      },
      { id: "approach", centerline: [{ x: 0, z: 20 }, { x: 0, z: 60 }], widthM: 7.2 },
    ];
    const [fill] = collectRoadJunctionFills(ring);
    // A step along the ring either way from the seam has to be inside the fill.
    for (const sx of [-1, 1]) {
      expect(
        pointInPolygon({ x: sx * 3, z: 20 - 3 }, fill.polygon),
        `ring side ${sx}`,
      ).toBe(true);
    }
  });

  it("adopts a wide carriageway whose authored end sits just off the crossing node", () => {
    // Cromwell Road's shape in miniature: the dual carriageway is centred on
    // its lane stack, so its authored end (0, 1.7) misses the node (0, 0) by
    // far more than the clustering epsilon while its 5.7 m half-width
    // physically overlaps the junction. Without adoption the fill is traced
    // as if the wide road were not there, and its kerb line steps at the
    // mouth instead of meeting the wide road's kerbs.
    const cromwell: RoadJunctionSource[] = [
      { id: "ns", centerline: [{ x: 0, z: -40 }, { x: 0, z: 0 }, { x: 0, z: 40 }], widthM: 7.6 },
      { id: "west", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }], widthM: 7.2 },
      { id: "wide-east", centerline: [{ x: 0, z: 1.7 }, { x: 40, z: 1.7 }], widthM: 11.4 },
    ];
    const fills = collectRoadJunctionFills(cromwell);
    expect(fills).toHaveLength(1);
    expect(fills[0].surfaceIds).toContain("wide-east");
    // The mouth must be paved out to the wide road's true kerbs (z 1.7 ± 5.7),
    // past the narrow crossing's kerb at z 3.8 where the un-adopted fill's
    // flank used to cut across.
    expect(pointInPolygon({ x: 4.5, z: 5.5 }, fills[0].polygon)).toBe(true);
    expect(pointInPolygon({ x: 4.5, z: -3.4 }, fills[0].polygon)).toBe(true);
  });

  it("adopts exactly the intentional off-node arms across every shipped map", () => {
    // Cromwell's recentred dual carriageway needs adoption on both passes.
    // Queensview's Vernon exit and 40th Avenue entry mouths deliberately sit
    // just clear of their neighbouring grid intersections: their asphalt does
    // not reach those junctions, while the inflated shoulder apron does. Pin
    // that distinction so another off-node road end cannot silently join a
    // junction on either pass.
    for (const inflation of [0, 3.4]) {
      const adopted: string[] = [];
      for (const pack of MAP_PACKS) {
        const surfaces = pack.geometry.roadSurfaces ?? [];
        if (!surfaces.length) continue;
        const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
        for (const fill of collectRoadJunctionFills(surfaces, inflation)) {
          for (const id of fill.surfaceIds) {
            const surface = byId.get(id);
            const touchesPivot = surface?.centerline.some(
              (point) =>
                Math.hypot(point.x - fill.pivot.x, point.z - fill.pivot.z) <= 0.08,
            );
            if (!touchesPivot) adopted.push(`${pack.id}:${id}`);
          }
        }
      }
      expect(adopted, `inflation ${inflation}`).toEqual([
        "london-south-kensington:london-cromwell-west",
        "london-south-kensington:london-cromwell-west",
        ...(inflation === 3.4
          ? [
              "nyc-upper-west-side:nyc-queensview-queens-vernon-exit-slip",
              "nyc-upper-west-side:nyc-queensview-queens-40th-entry-slip",
            ]
          : []),
      ]);
    }
  });

  it("holds the wider kerb to the node where unequal widths run straight through", () => {
    // A width handover (Kensington Road 7.2 m becoming Knightsbridge 10.4 m)
    // is a straight-through pair, so there is no corner — but a plain bridge
    // between the two tips splits the width step across both reaches and the
    // wide strip's square end pokes above it at the node. The boundary must
    // instead run along the wide kerb to the node and taper one-sidedly
    // across the narrow leg's reach.
    const handover: RoadJunctionSource[] = [
      { id: "wide", centerline: [{ x: -40, z: 0 }, { x: 0, z: 0 }], widthM: 10.4 },
      { id: "narrow", centerline: [{ x: 0, z: 0 }, { x: 40, z: 0 }], widthM: 9 },
    ];
    const [fill] = collectRoadJunctionFills(handover);
    // Just inside the wide kerb at the node: paved now, above the old bridge.
    expect(pointInPolygon({ x: -2, z: 5.0 }, fill.polygon)).toBe(true);
    expect(pointInPolygon({ x: -2, z: -5.0 }, fill.polygon)).toBe(true);
    // The taper still tapers — the wide width is not carried across the node.
    expect(pointInPolygon({ x: 2, z: 5.1 }, fill.polygon)).toBe(false);
  });

  it("keeps every authored junction's corners walkable", () => {
    for (const pack of MAP_PACKS) {
      const surfaces = pack.geometry.roadSurfaces ?? [];
      if (!surfaces.length) continue;
      for (const fill of collectRoadJunctionFills(surfaces)) {
        // No junction may pave a disc wider than the widest carriageway that
        // meets it, plus its kerb radius — anything more is eating pavement.
        // Membership comes from the fill itself: an adopted arm (Cromwell
        // Road's off-node dual carriageway) never has a centreline point at
        // the pivot, so re-matching by proximity would miss exactly the wide
        // road whose width sets the bound.
        const members = new Set(fill.surfaceIds);
        const widest = Math.max(
          ...surfaces
            .filter((surface) => members.has(surface.id))
            .map((surface) => surface.widthM / 2),
        );
        for (const point of fill.polygon) {
          const lateral = Math.min(
            Math.abs(point.x - fill.pivot.x),
            Math.abs(point.z - fill.pivot.z),
          );
          expect(
            lateral,
            `${pack.id} junction at ${fill.pivot.x},${fill.pivot.z}`,
          ).toBeLessThanOrEqual(widest + 3.6);
        }
      }
    }
  });

  it("keeps every fill star-shaped about its pivot", () => {
    // The fill is drawn as a triangle fan from the pivot, so the pivot has to
    // see the whole boundary. An outline that doubles back fans triangles over
    // each other: they z-fight, and any wound backwards face down and light
    // black. Tokyo's 46-degree fork at (54,18) did exactly that — the two arms
    // still overlap where the fill ends, so one arm's outer corner sat behind
    // the next arm's in bearing.
    const cross = (
      a: { x: number; z: number },
      b: { x: number; z: number },
      c: { x: number; z: number },
    ) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    for (const pack of MAP_PACKS) {
      const surfaces = pack.geometry.roadSurfaces;
      if (!surfaces?.length) continue;
      for (const fill of collectRoadJunctionFills(surfaces)) {
        const { polygon, pivot } = fill;
        const where = `${pack.id} junction at ${pivot.x},${pivot.z}`;
        const areas = polygon.map((_, index) =>
          cross(pivot, polygon[index], polygon[(index + 1) % polygon.length]),
        );
        // One consistent winding, and no zero-area slivers from a doubled point.
        expect(areas.every((area) => area < 0), `${where} winding`).toBe(true);
        // Bearings must advance monotonically the whole way round the ring.
        const bearings = polygon.map((point) =>
          Math.atan2(point.z - pivot.z, point.x - pivot.x),
        );
        let wraps = 0;
        for (let index = 0; index < bearings.length; index += 1) {
          const next = bearings[(index + 1) % bearings.length];
          if (next >= bearings[index]) wraps += 1;
        }
        expect(wraps, `${where} bearing order`).toBe(1);
      }
    }
  });
});
