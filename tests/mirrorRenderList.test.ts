import { describe, expect, it } from "vitest";
import {
  MIRROR_RADIUS_M,
  MIRROR_REGATHER_M,
  cellIntersectsMirrorCone,
  mirrorCandidatesAreStale,
  mirrorCells,
  type MirrorCullView,
} from "../app/game/mirrorRenderList";

const CELL = 45;

/** A mirror at the origin looking due south (-z), i.e. behind a northbound car. */
function lookingBack(overrides: Partial<MirrorCullView> = {}): MirrorCullView {
  return {
    x: 0,
    z: 0,
    dirX: 0,
    dirZ: -1,
    halfAngleRad: (50 * Math.PI) / 180,
    radiusM: MIRROR_RADIUS_M,
    ...overrides,
  };
}

describe("mirror cone cull", () => {
  it("keeps the cell the eye is standing in", () => {
    // The corner test alone misses this one, and it is the cell guaranteed to
    // matter — the road directly under and behind the car lives in it.
    expect(cellIntersectsMirrorCone(0, 0, CELL, lookingBack())).toBe(true);
    expect(
      cellIntersectsMirrorCone(0, -1, CELL, lookingBack({ x: 20, z: -20 })),
    ).toBe(true);
  });

  it("keeps cells behind and drops cells ahead", () => {
    // Two cells south of the eye: squarely in view.
    expect(cellIntersectsMirrorCone(0, -2, CELL, lookingBack())).toBe(true);
    // Two cells north: behind the mirror, nothing there can be reflected.
    expect(cellIntersectsMirrorCone(0, 1, CELL, lookingBack())).toBe(false);
  });

  it("drops cells beyond the view radius", () => {
    const far = Math.ceil((MIRROR_RADIUS_M * 3) / CELL);
    expect(cellIntersectsMirrorCone(0, -far, CELL, lookingBack())).toBe(false);
  });

  it("follows the mirror round when the car turns", () => {
    const eastward = lookingBack({ dirX: -1, dirZ: 0 });
    // Now looking west, so cells to the west are in and cells to the south are
    // not. A cull that ignored direction would keep both.
    expect(cellIntersectsMirrorCone(-2, 0, CELL, eastward)).toBe(true);
    expect(cellIntersectsMirrorCone(0, -2, CELL, eastward)).toBe(false);
  });

  it("is conservative at the edge of the cone", () => {
    // A cell whose centre is outside the cone but whose near corner is inside
    // must be kept: meshes are not points, and a false negative is a hole in
    // the mirror while a false positive is one frustum test.
    const narrow = lookingBack({ halfAngleRad: (30 * Math.PI) / 180 });
    expect(cellIntersectsMirrorCone(-1, -1, CELL, narrow)).toBe(true);
  });
});

describe("mirrorCells", () => {
  it("returns a bounded, non-empty sweep", () => {
    const cells = mirrorCells(CELL, lookingBack());
    expect(cells.length).toBeGreaterThan(0);
    // The bounding square of an 80 m radius on 45 m cells is at most 5x5; a
    // rearward cone should take well under half of that.
    expect(cells.length).toBeLessThanOrEqual(25);
    expect(cells.some((cell) => cell.cellX === 0 && cell.cellZ === 0)).toBe(true);
  });

  it("never returns a cell the cone test rejects", () => {
    const view = lookingBack({ x: 137, z: -412, dirX: 0.6, dirZ: -0.8 });
    for (const cell of mirrorCells(CELL, view)) {
      expect(cellIntersectsMirrorCone(cell.cellX, cell.cellZ, CELL, view)).toBe(
        true,
      );
    }
  });

  it("handles negative world coordinates without an off-by-one", () => {
    // Math.floor on negatives is the classic way to lose a cell here, and the
    // map's origin is its centre, so half the world has negative coordinates.
    const view = lookingBack({ x: -30, z: -30 });
    const cells = mirrorCells(CELL, view);
    expect(cells.some((cell) => cell.cellX === -1 && cell.cellZ === -1)).toBe(
      true,
    );
  });
});

describe("re-gather trigger", () => {
  it("holds while the car barely moves", () => {
    expect(mirrorCandidatesAreStale(0, 0, 3, 4, 0)).toBe(false);
  });

  it("fires once the car has covered ground", () => {
    expect(
      mirrorCandidatesAreStale(0, 0, MIRROR_REGATHER_M + 1, 0, 0),
    ).toBe(true);
  });

  it("fires on a turn even with no ground covered", () => {
    // Pulling round a junction swings the cone across a different set of cells
    // without moving the car far, which distance alone would never catch.
    expect(mirrorCandidatesAreStale(0, 0, 0, 0, 0.9)).toBe(true);
    expect(mirrorCandidatesAreStale(0, 0, 0, 0, -0.9)).toBe(true);
  });
});
