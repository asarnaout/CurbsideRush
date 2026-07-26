import { describe, expect, it } from "vitest";
import {
  REPAIR_BAY_REACH_M,
  REPAIR_SHOP_BACK_INNER_X,
  REPAIR_SHOP_BAY_CLEAR_DEPTH_M,
  REPAIR_SHOP_BAY_CLEAR_HEIGHT_M,
  REPAIR_SHOP_BAY_CLEAR_WIDTH_M,
  REPAIR_SHOP_BAY_OFFSET_M,
  REPAIR_SHOP_LOT_HALF_M,
  REPAIR_SHOP_MOUTH_X,
  REPAIR_SHOP_PARTS,
  REPAIR_SHOP_SOLIDS_M,
  repairShopPlanBounds,
  type RepairShopBox,
} from "../app/game/repairShopLayout";
import { CAREER_VEHICLES } from "../app/game/career";

/**
 * The repair shop is authored rather than imported, so nothing about it was
 * measured off a model — which means these numbers ARE the building, for both
 * the renderer and the collider builder. The two things worth pinning are that
 * the bay a car is invited to drive into actually admits the widest car in the
 * game, and that no collider stands anywhere the player cannot see a wall.
 */

/** Widest capsule any player vehicle uses — the van's, at the time of writing. */
const widestCapsuleRadiusM = Math.max(
  ...CAREER_VEHICLES.map((vehicle) => vehicle.physics.playerCapsuleRadiusM),
);
const longestCapsuleHalfLengthM = Math.max(
  ...CAREER_VEHICLES.map((vehicle) => vehicle.physics.playerCapsuleHalfLengthM),
);

/** 2D distance from a point to a box, 0 inside. */
const pointToBox = (x: number, z: number, box: RepairShopBox): number =>
  Math.hypot(
    Math.max(box.minX - x, 0, x - box.maxX),
    Math.max(box.minZ - z, 0, z - box.maxZ),
  );

const clearanceAt = (x: number, z: number): number =>
  Math.min(...REPAIR_SHOP_SOLIDS_M.map((solid) => pointToBox(x, z, solid)));

const encloses = (outer: RepairShopBox, inner: RepairShopBox): boolean =>
  outer.minX <= inner.minX + 1e-9 &&
  outer.maxX >= inner.maxX - 1e-9 &&
  outer.minY <= inner.minY + 1e-9 &&
  outer.maxY >= inner.maxY - 1e-9 &&
  outer.minZ <= inner.minZ + 1e-9 &&
  outer.maxZ >= inner.maxZ - 1e-9;

describe("repair shop layout", () => {
  it("never puts a collider where there is nothing to see", () => {
    // An invisible wall is the one failure this arrangement exists to prevent:
    // the gas station's solids are measured off its glb and can drift from it,
    // these are derived from the same constants the parts are.
    for (const solid of REPAIR_SHOP_SOLIDS_M) {
      const drawn = REPAIR_SHOP_PARTS.some((part) => encloses(part, solid));
      expect(drawn, `${solid.id} is solid but nothing draws it`).toBe(true);
    }
  });

  it("admits the widest vehicle in the game down the middle of the bay", () => {
    // Mirrors tests/staticColliders.test.ts's drive-in standard: a space is
    // drivable where the centreline keeps a capsule radius off every obstacle.
    //
    // The range walked is where the car's CENTRE can legitimately sit, which
    // stops short of the back wall by the nose overhang — a capsule half-length
    // plus its radius. Walking to the wall itself would only prove that a wall
    // is a wall.
    const noseOverhangM = longestCapsuleHalfLengthM + widestCapsuleRadiusM;
    const deepestCentreX = REPAIR_SHOP_BACK_INNER_X - noseOverhangM;
    for (let x = REPAIR_SHOP_MOUTH_X; x <= deepestCentreX; x += 0.1) {
      expect(
        clearanceAt(x, REPAIR_SHOP_BAY_OFFSET_M.z),
        `bay centreline blocked at x=${x.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(widestCapsuleRadiusM);
    }
    // The bay point the prompt measures to has to be somewhere a van can
    // actually park, or the widest vehicle could never trigger a repair.
    expect(REPAIR_SHOP_BAY_OFFSET_M.x).toBeLessThanOrEqual(deepestCentreX);
    // ...and the bay is long enough to hold that vehicle once it is in.
    expect(REPAIR_SHOP_BAY_CLEAR_DEPTH_M).toBeGreaterThan(noseOverhangM * 2);
    // Clear width leaves real margin either side rather than exactly touching.
    expect(REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2 - widestCapsuleRadiusM)
      .toBeGreaterThanOrEqual(1);
  });

  it("leaves the mouth open across its full width", () => {
    // The mouth is the whole point: three walls and a way in. A solid that
    // reached across it would make the shop a sealed box the prompt could
    // never fire in.
    for (
      let z = -REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2;
      z <= REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2;
      z += 0.1
    ) {
      for (const solid of REPAIR_SHOP_SOLIDS_M) {
        const spansMouth =
          solid.minX <= REPAIR_SHOP_MOUTH_X &&
          solid.maxX >= REPAIR_SHOP_MOUTH_X &&
          solid.minZ < z &&
          solid.maxZ > z;
        expect(spansMouth, `${solid.id} blocks the mouth at z=${z.toFixed(2)}`)
          .toBe(false);
      }
    }
  });

  it("keeps the prompt's reach inside the bay", () => {
    // A reach that spilled past the mouth would offer a repair to a car still
    // on the pavement, which is the mistake the fuel prompt already had to fix
    // by measuring to the pumps rather than to the lane anchor.
    expect(REPAIR_SHOP_BAY_OFFSET_M.x - REPAIR_BAY_REACH_M).toBeGreaterThan(
      REPAIR_SHOP_MOUTH_X,
    );
    expect(REPAIR_SHOP_BAY_OFFSET_M.x + REPAIR_BAY_REACH_M).toBeLessThan(
      REPAIR_SHOP_BACK_INNER_X,
    );
  });

  it("covers everything it draws with its lot", () => {
    // The lot is what gets carved out of a block rect; anything drawn outside
    // it would be a wall standing in ground the carve left solid.
    const bounds = repairShopPlanBounds();
    for (const value of [bounds.minX, bounds.minZ]) {
      expect(value).toBeGreaterThanOrEqual(-REPAIR_SHOP_LOT_HALF_M);
    }
    for (const value of [bounds.maxX, bounds.maxZ]) {
      expect(value).toBeLessThanOrEqual(REPAIR_SHOP_LOT_HALF_M);
    }
  });

  it("gives the bay the headroom it claims, measured off what is drawn", () => {
    // The declared clear height is what the parts are laid out against, so
    // nothing stops it quietly becoming a lie — a shutter drum hung 15 cm lower
    // for looks would silently take the headroom with it. So derive the real
    // figure from the parts and hold the constant to it.
    const bayHalfWidth = REPAIR_SHOP_BAY_CLEAR_WIDTH_M / 2;
    let lowestOverhead = Infinity;
    for (const part of REPAIR_SHOP_PARTS) {
      const overlapsBayPlan =
        part.minX < REPAIR_SHOP_BACK_INNER_X &&
        part.maxX > REPAIR_SHOP_MOUTH_X &&
        part.minZ < bayHalfWidth &&
        part.maxZ > -bayHalfWidth;
      // The floor is under the wheels, not over the roof.
      if (!overlapsBayPlan || part.maxY <= 0.1) continue;
      if (part.minY < lowestOverhead) lowestOverhead = part.minY;
    }
    expect(lowestOverhead).toBe(REPAIR_SHOP_BAY_CLEAR_HEIGHT_M);
    // And that height clears a van with a roof rack.
    expect(REPAIR_SHOP_BAY_CLEAR_HEIGHT_M).toBeGreaterThan(3);
  });
});
