import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  appendDashedMarkingBoxes,
  appendMarkingBox,
  appendSolidMarkingBoxes,
  createMarkingGeometry,
  type MarkingGeometry,
} from "../app/game/render/meshPrimitives";
import {
  splitMarkingAtCrossings,
  type MarkingPoint,
} from "../app/game/roadMarkings";

const p = (x: number, z: number): MarkingPoint => ({ x, z });

const lengthOf = (run: readonly MarkingPoint[]): number =>
  run
    .slice(1)
    .reduce((total, point, index) => total + Math.hypot(point.x - run[index].x, point.z - run[index].z), 0);

const nearestDistance = (
  point: MarkingPoint,
  runs: readonly (readonly MarkingPoint[])[],
): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const a = run[index];
      const b = run[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount =
        lengthSquared < 1e-9
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared),
            );
      best = Math.min(
        best,
        Math.hypot(point.x - (a.x + dx * amount), point.z - (a.z + dz * amount)),
      );
    }
  }
  return best;
};

describe("lane paint stops at a junction", () => {
  it("leaves an untouched road in one piece", () => {
    const runs = splitMarkingAtCrossings([p(0, 0), p(0, 100)], []);
    expect(runs).toEqual([[p(0, 0), p(0, 100)]]);
  });

  it("bites a gap out where a carriageway crosses", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 10 }],
    );
    expect(runs).toHaveLength(2);
    // 5 m of half-width plus the 0.8 m margin either side of z=0.
    expect(runs[0].at(-1)!.z).toBeCloseTo(-5.8, 6);
    expect(runs[1][0].z).toBeCloseTo(5.8, 6);
  });

  it("breaks where a side road merely ends on it", () => {
    // A T-junction: the stem's centreline stops dead on the through road, so
    // the two never properly cross and an endpoint touch has to count.
    const runs = splitMarkingAtCrossings(
      [p(-50, 0), p(50, 0)],
      [{ centerline: [p(0, 0), p(0, 60)], widthM: 9 }],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)!.x).toBeCloseTo(-5.3, 6);
  });

  it("merges junctions that sit on top of each other", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [
        { centerline: [p(-40, -2), p(40, -2)], widthM: 10 },
        { centerline: [p(-40, 2), p(40, 2)], widthM: 10 },
      ],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)!.z).toBeCloseTo(-7.8, 6);
    expect(runs[1][0].z).toBeCloseTo(7.8, 6);
  });

  it("drops a run too short to be worth painting", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -6), p(0, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 10 }],
    );
    // The 0.2 m stub south of the junction goes; the long run north stays.
    expect(runs).toHaveLength(1);
    expect(runs[0][0].z).toBeCloseTo(5.8, 6);
  });

  it("keeps the authored vertices of a curve inside a run", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(2, -20), p(4, 20), p(6, 50)],
      [{ centerline: [p(-40, 0), p(40, 0)], widthM: 4 }],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toContainEqual(p(2, -20));
    expect(runs[1]).toContainEqual(p(4, 20));
  });

  it("ignores a road running parallel to the marking", () => {
    const runs = splitMarkingAtCrossings(
      [p(0, -50), p(0, 50)],
      [{ centerline: [p(8, -50), p(8, 50)], widthM: 10 }],
    );
    expect(runs).toHaveLength(1);
  });

  it("clears every NYC junction box of through paint", () => {
    // The visible bug: Broadway's yellow centre line and West 79th's crossed
    // in the middle of the intersection. Nothing should be painted within a
    // carriageway half-width of any junction node.
    const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;
    const surfaces = nyc.geometry.roadSurfaces;
    const runs = surfaces.flatMap((surface) =>
      surface.markings.flatMap((marking) =>
        splitMarkingAtCrossings(
          marking.points,
          surfaces.filter((other) => other.id !== surface.id),
        ),
      ),
    );
    expect(runs.length).toBeGreaterThan(surfaces.length);
    for (const node of nyc.laneGraph.nodes) {
      expect(
        nearestDistance(node.position, runs),
        `paint through ${node.id}`,
      ).toBeGreaterThan(4.5);
    }
  });

  it("still paints the long stretches between NYC's junctions", () => {
    const nyc = MAP_PACKS.find((pack) => pack.id === "nyc-upper-west-side")!;
    const surfaces = nyc.geometry.roadSurfaces;
    for (const surface of surfaces) {
      for (const marking of surface.markings) {
        const runs = splitMarkingAtCrossings(
          marking.points,
          surfaces.filter((other) => other.id !== surface.id),
        );
        const painted = runs.reduce((total, run) => total + lengthOf(run), 0);
        const whole = lengthOf(marking.points);
        // Junction gaps cost a little; losing more than a fifth of a road's
        // paint would mean the bites are far too greedy.
        expect(painted / whole, `${surface.id}/${marking.id}`).toBeGreaterThan(0.8);
        // A road with no interior crossing yet (Vernon Blvd today: only its
        // two bridge endpoints, until the borough phase's bank streets give
        // it one) has nothing to split its paint at, so it stays one run —
        // every road with an interior crossing must still break there.
        if (surface.centerline.length > 2) {
          expect(runs.length, `${surface.id}/${marking.id}`).toBeGreaterThan(1);
        }
      }
    }
  });
});

/** Verts per box from Babylon's CreateBox: 24 positions, 36 indices. */
const BOX_VERTS = 24;
const BOX_INDICES = 36;

function boxCount(geometry: MarkingGeometry): number {
  expect(geometry.indices.length % BOX_INDICES).toBe(0);
  expect(geometry.positions.length % (BOX_VERTS * 3)).toBe(0);
  return geometry.indices.length / BOX_INDICES;
}

/** Centroid of one box's 24 corners is its centre. */
function boxCenter(geometry: MarkingGeometry, box: number) {
  let x = 0;
  let y = 0;
  let z = 0;
  const base = box * BOX_VERTS * 3;
  for (let i = 0; i < BOX_VERTS; i += 1) {
    x += geometry.positions[base + i * 3];
    y += geometry.positions[base + i * 3 + 1];
    z += geometry.positions[base + i * 3 + 2];
  }
  return { x: x / BOX_VERTS, y: y / BOX_VERTS, z: z / BOX_VERTS };
}

function boxBounds(geometry: MarkingGeometry, box: number) {
  const base = box * BOX_VERTS * 3;
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < BOX_VERTS; i += 1) {
    const x = geometry.positions[base + i * 3];
    const y = geometry.positions[base + i * 3 + 1];
    const z = geometry.positions[base + i * 3 + 2];
    lo.x = Math.min(lo.x, x);
    lo.y = Math.min(lo.y, y);
    lo.z = Math.min(lo.z, z);
    hi.x = Math.max(hi.x, x);
    hi.y = Math.max(hi.y, y);
    hi.z = Math.max(hi.z, z);
  }
  return { lo, hi };
}

describe("merged marking geometry", () => {
  it("replicates the legacy box: centre, +0.25 depth pad, height rule", () => {
    const geometry = createMarkingGeometry();
    appendMarkingBox(geometry, { x: 0, z: 0 }, { x: 0, z: 10 }, 0.11, 0.12);
    expect(boxCount(geometry)).toBe(1);
    const center = boxCenter(geometry, 0);
    expect(center.x).toBeCloseTo(0, 10);
    expect(center.y).toBeCloseTo(0.12, 10);
    expect(center.z).toBeCloseTo(5, 10);
    const { lo, hi } = boxBounds(geometry, 0);
    // Along +z: length 10 plus the 0.25 pad. Across: the 0.11 width.
    // Height: max(0.025, 0.12 * 0.45).
    expect(hi.z - lo.z).toBeCloseTo(10.25, 10);
    expect(hi.x - lo.x).toBeCloseTo(0.11, 10);
    expect(hi.y - lo.y).toBeCloseTo(0.054, 10);
  });

  it("rotates the box with the segment heading", () => {
    const geometry = createMarkingGeometry();
    appendMarkingBox(geometry, { x: 0, z: 0 }, { x: 8, z: 0 }, 0.11, 0.12);
    const { lo, hi } = boxBounds(geometry, 0);
    // Heading east: the padded length lies along x, the width along z.
    expect(hi.x - lo.x).toBeCloseTo(8.25, 10);
    expect(hi.z - lo.z).toBeCloseTo(0.11, 10);
  });

  it("skips degenerate segments", () => {
    const geometry = createMarkingGeometry();
    appendMarkingBox(geometry, { x: 3, z: 3 }, { x: 3, z: 3.005 }, 0.11, 0.12);
    expect(boxCount(geometry)).toBe(0);
  });

  it("carries the dash phase across polyline joints", () => {
    const geometry = createMarkingGeometry();
    // Two segments of 5m and 6m, dash 3 / gap 4 (period 7): segment one
    // emits [0,3] and hands over phase 5, so segment two's first window is
    // [-5,-2] (dropped) and the next [2,5] — exactly one dash each.
    appendDashedMarkingBoxes(
      geometry,
      [
        { x: 0, z: 0 },
        { x: 0, z: 5 },
        { x: 0, z: 11 },
      ],
      0.11,
      0.12,
      3,
      4,
    );
    expect(boxCount(geometry)).toBe(2);
    expect(boxCenter(geometry, 0).z).toBeCloseTo(1.5, 10);
    // Second dash spans z 7..10 in world space (2..5 within its segment).
    expect(boxCenter(geometry, 1).z).toBeCloseTo(8.5, 10);
  });

  it("drops dash slivers shorter than 0.2m", () => {
    const geometry = createMarkingGeometry();
    // A 7.15m run with dash 3 / gap 4: [0,3] paints, the second window
    // opens at 7 and closes at 7.15 — a 0.15m sliver, dropped.
    appendDashedMarkingBoxes(
      geometry,
      [
        { x: 0, z: 0 },
        { x: 0, z: 7.15 },
      ],
      0.11,
      0.12,
      3,
      4,
    );
    expect(boxCount(geometry)).toBe(1);
  });

  it("emits one box per solid polyline segment", () => {
    const geometry = createMarkingGeometry();
    appendSolidMarkingBoxes(
      geometry,
      [
        { x: 0, z: 0 },
        { x: 0, z: 4 },
        { x: 3, z: 4 },
      ],
      0.11,
      0.12,
    );
    expect(boxCount(geometry)).toBe(2);
  });
});
