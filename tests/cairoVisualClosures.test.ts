import { describe, expect, it } from "vitest";
import {
  CAIRO_MAP_PACK,
  CAIRO_VISUAL_CLOSURES,
  cairoClosureOwnerIsKnown,
  cairoRoadsideExclusions,
  validateCairoClosureCandidate,
} from "../app/game/cities/cairo";
import type { ProceduralBlock } from "../app/game/types";

/**
 * Negative tests for the reviewed closure layer (visual-gap plan Section
 * 12.3 item 6): an unlisted owner's `inflated` margin and any `raw`
 * overlap must never be bypassable, allow-list or not. Built against a
 * real `cairoRoadsideExclusions` entry's own exact shape rather than
 * hand-copied coordinates, so these stay correct if the content that
 * derives them ever changes.
 */

const axisAlignedExclusion = () => {
  // Every venue/service exclusion is built through `roadsideExclusionParcel`
  // with no heading argument (defaults to 0), so it is always axis-aligned —
  // the simplest shape to construct an unambiguous overlapping candidate
  // against without needing to rotate into the exclusion's own frame.
  const found = cairoRoadsideExclusions.find(
    (exclusion) =>
      exclusion.ownerKind === "venue" &&
      Math.abs(exclusion.raw.axisU.z) < 1e-9 &&
      Math.abs(exclusion.raw.axisU.x - 1) < 1e-9,
  );
  if (!found) {
    throw new Error(
      "test setup: expected at least one axis-aligned venue exclusion in cairoRoadsideExclusions",
    );
  }
  return found;
};

let idCounter = 0;
const tinyBlock = (x: number, z: number): ProceduralBlock => {
  idCounter += 1;
  return {
    id: `test-closure-candidate-${idCounter}`,
    center: { x, z },
    size: { x: 4, z: 4 },
    heightRange: [8, 12],
    density: 0.8,
    material: "sandstone",
  };
};

/** `tinyBlock`'s own half-width along its local +x — the candidate's FULL
 * footprint, not just its centre, must clear an exclusion's raw edge for a
 * case to genuinely be inflated-only. Missing this by a metre once already
 * produced a false "raw overlap" result from a centre that looked clear. */
const TINY_BLOCK_HALF_U = 2;

/** A candidate whose whole footprint clears `exclusion`'s raw shape but
 * still sits inside its inflated margin — self-verified, not assumed. */
const inflatedOnlyCandidate = (
  exclusion: (typeof cairoRoadsideExclusions)[number],
): ProceduralBlock => {
  const x =
    exclusion.raw.center.x + exclusion.raw.halfU + TINY_BLOCK_HALF_U + 1;
  const z = exclusion.raw.center.z;
  expect(x - TINY_BLOCK_HALF_U).toBeGreaterThan(
    exclusion.raw.center.x + exclusion.raw.halfU,
  );
  expect(x + TINY_BLOCK_HALF_U).toBeLessThan(
    exclusion.inflated.center.x + exclusion.inflated.halfU,
  );
  return tinyBlock(x, z);
};

describe("Cairo reviewed closure layer (plan Section 12.3)", () => {
  it("cairoClosureOwnerIsKnown recognises a real owner and rejects a fabricated one", () => {
    expect(cairoRoadsideExclusions.length).toBeGreaterThan(0);
    expect(cairoClosureOwnerIsKnown(cairoRoadsideExclusions[0].ownerId)).toBe(
      true,
    );
    expect(cairoClosureOwnerIsKnown("not-a-real-owner-id")).toBe(false);
  });

  it("always rejects a raw overlap, allow-list or not", () => {
    const exclusion = axisAlignedExclusion();
    const candidate = tinyBlock(
      exclusion.raw.center.x,
      exclusion.raw.center.z,
    );
    const unlisted = validateCairoClosureCandidate(candidate);
    expect(unlisted.valid).toBe(false);
    expect(unlisted.reason).toBe(`exclusion:${exclusion.id}`);
    const listed = validateCairoClosureCandidate(candidate, {
      allowInflatedOverlapOwnerIds: new Set([exclusion.ownerId]),
    });
    expect(listed.valid).toBe(false);
    expect(listed.reason).toBe(`exclusion:${exclusion.id}`);
  });

  it("rejects an inflated-only overlap when the owner is not on the allow-list", () => {
    const exclusion = axisAlignedExclusion();
    const candidate = inflatedOnlyCandidate(exclusion);
    const noAllowList = validateCairoClosureCandidate(candidate);
    expect(noAllowList.valid).toBe(false);
    expect(noAllowList.reason).toBe(`exclusion:${exclusion.id}`);
    const otherOwnerListed = validateCairoClosureCandidate(candidate, {
      allowInflatedOverlapOwnerIds: new Set(["not-this-owner"]),
    });
    expect(otherOwnerListed.valid).toBe(false);
    expect(otherOwnerListed.reason).toBe(`exclusion:${exclusion.id}`);
  });

  it("forgives an inflated-only overlap only for the exact listed owner", () => {
    const exclusion = axisAlignedExclusion();
    const candidate = inflatedOnlyCandidate(exclusion);
    const forgiven = validateCairoClosureCandidate(candidate, {
      allowInflatedOverlapOwnerIds: new Set([exclusion.ownerId]),
    });
    // The allow-list only removes THIS exclusion as a blocker -- the
    // candidate may still fail some other unrelated check (a road, a
    // sibling, another exclusion it happens to also reach). Proving the
    // reason is no longer this exclusion is the actual claim.
    if (!forgiven.valid) {
      expect(forgiven.reason).not.toBe(`exclusion:${exclusion.id}`);
    }
  });

  it("rejects a candidate outside the world bounds", () => {
    expect(validateCairoClosureCandidate(tinyBlock(5000, 5000))).toEqual({
      valid: false,
      reason: "world-bound",
    });
  });

  it("rejects a candidate inside the Nile", () => {
    // Verified interior point (not just plausible): well clear of the east
    // channel polygon's own edges, not near any vertex.
    const result = validateCairoClosureCandidate(tinyBlock(-20, 0));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("water");
  });

  it("rejects a candidate overlapping an already-planned sibling block", () => {
    // Reuse a real block the slot/gap-fill passes already placed, dead
    // centre, rather than guessing a position -- stays correct if those
    // passes' own output ever shifts.
    expect(CAIRO_MAP_PACK.geometry.blocks.length).toBeGreaterThan(0);
    const sibling = CAIRO_MAP_PACK.geometry.blocks[0];
    const result = validateCairoClosureCandidate({
      ...tinyBlock(sibling.center.x, sibling.center.z),
      headingDeg: sibling.headingDeg,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("sibling-block");
  });

  it("every CAIRO_VISUAL_CLOSURES entry has a unique id matching its own block, and actually landed", () => {
    // Real content lands here per site (Sections 12.4-12.9); this only pins
    // the shape every entry must keep, not a count or exact list -- that
    // would just be re-deriving CAIRO_MAP_PACK.geometry.blocks by hand.
    // Re-running validateCairoClosureCandidate here would not prove
    // anything real: by now every closure is already in cairoBlocks, so it
    // would just find itself as a "sibling" -- addReviewedCairoClosure
    // already throws at import time if a closure fails to validate or
    // place (see its own doc comment), so CAIRO_MAP_PACK existing at all is
    // the proof every listed closure passed.
    const ids = CAIRO_VISUAL_CLOSURES.map((closure) => closure.id);
    expect(new Set(ids).size).toBe(ids.length);
    const blockIds = new Set(CAIRO_MAP_PACK.geometry.blocks.map((block) => block.id));
    for (const closure of CAIRO_VISUAL_CLOSURES) {
      expect(closure.block.id, closure.id).toBe(closure.id);
      expect(blockIds.has(closure.id), closure.id).toBe(true);
    }
  });
});
