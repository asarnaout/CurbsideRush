import { CAREER_VEHICLES } from "../career";
import { VEHICLE_DIMENSIONS } from "../vehicleVisuals";
import type { GameCanvasPoint } from "../sessionContract";

/**
 * Exact vehicle-height ground solids for landmarks whose bespoke renderer
 * departs from the generic kind fallback — plan
 * `.claude/building-collision-visual-parity-plan.md` Section 7.9. Two failure
 * directions, found by the same audit: over-colliders, where the generic
 * AABB/circle (sized from `ProceduralLandmark.size`) stands solid over
 * nothing visible (an ellipse drum's corners, a monument's centre reading
 * solid when the ground core is 2.6 m, not 4.8 m); and under-colliders, where
 * a real vehicle-height mass — a leaning wheel leg, a portico column, a
 * museum pavilion — projects past the generic shape with no collider at all.
 * Every non-park, non-bridge/railway landmark on every map was enumerated
 * against its actual bespoke renderer (if any) to find these; a landmark
 * absent from both `LONDON_RECIPES` and `CAIRO_RECIPES` was confirmed to
 * render exactly its generic kind's box or circle at vehicle height, not
 * merely assumed to.
 *
 * `undefined` means the generic kind recipe remains authoritative for that
 * landmark; an empty array means it is bespoke but intentionally has no
 * ground-level solid (nothing here yet needs that). This module stays pure —
 * no Babylon, no DOM — like every other `geometry/*.ts` file; city render
 * recipes (`render/londonLandmarks.ts`, `render/cairoLandmarks.ts`) and
 * `simulationAdapter.ts` both consume its output instead of keeping parallel
 * dimension literals.
 */

export type GroundSolid =
  | {
      readonly kind: "aabb";
      readonly id: string;
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    }
  | {
      readonly kind: "obb";
      readonly id: string;
      readonly x: number;
      readonly z: number;
      readonly ux: number;
      readonly uz: number;
      readonly halfU: number;
      readonly halfV: number;
    }
  | {
      readonly kind: "circle";
      readonly id: string;
      readonly x: number;
      readonly z: number;
      readonly radius: number;
    }
  | {
      readonly kind: "convex";
      readonly id: string;
      /** Wound clockwise — see `StaticObstacle`'s own "convex" variant. */
      readonly points: readonly GameCanvasPoint[];
    };

/** The minimal shape both `ProceduralLandmark` and the looser
 * `GameCanvasMapPack.geometry.landmarks[number]` (whose `kind` is `string`)
 * satisfy, so this module narrows/checks supported kinds itself rather than
 * asking a caller to cast the session-contract landmark. */
export interface LandmarkGroundSolidInput {
  readonly id: string;
  readonly kind: string;
  readonly center: GameCanvasPoint;
  readonly size: GameCanvasPoint;
  readonly headingDeg?: number;
}

/**
 * Ground-plane projection band: a visible structure crossing world `y = 0`
 * through this height gets ground collision; a roof, pod, wheel rim, awning,
 * cornice, bridge deck or tower crown purely above it does not. Derived,
 * never a permanent literal — the height of the tallest *selectable player*
 * vehicle body among `CAREER_VEHICLES`'s real (non-null) models
 * (`delivery-van`, 2.18 m, at the time of writing). Deliberately excludes
 * the taller NPC bus/double-decker: they exist in `VEHICLE_DIMENSIONS` but a
 * player never drives one, so they must not widen what counts as
 * "vehicle-height". A vehicle with `model: null` (the composed bicycle/
 * motorbike rigs) contributes 0 and can never win the max.
 */
export const VEHICLE_HEIGHT_BAND_M = Math.max(
  ...CAREER_VEHICLES.map((vehicle) =>
    vehicle.model ? VEHICLE_DIMENSIONS[vehicle.model].height : 0,
  ),
);

const REGULAR_POLYGON_SIDES = {
  roundHall: 24,
} as const;

/** A regular N-gon's vertices, clockwise, matching a Babylon
 * `CreateCylinder({ tessellation })` mesh's own real vertex phase exactly
 * (verified against the actual mesh under `NullEngine`: vertex 0 sits at
 * local `(radiusX, 0)`, and successive vertices step by `-360/sides`
 * degrees). `radiusZ` independent of `radiusX` reproduces a mesh scaled
 * along Z after creation (an ellipse), which is exactly how the round hall's
 * drum is built. */
function regularEllipsePolygon(
  center: GameCanvasPoint,
  radiusX: number,
  radiusZ: number,
  sides: number,
): readonly GameCanvasPoint[] {
  const points: GameCanvasPoint[] = [];
  for (let k = 0; k < sides; k += 1) {
    const angle = (k / sides) * Math.PI * 2;
    points.push({
      x: center.x + radiusX * Math.cos(angle),
      z: center.z - radiusZ * Math.sin(angle),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// London
// ---------------------------------------------------------------------------

/**
 * `london-round-hall`: `render/londonLandmarks.ts` draws a 24-tessellation
 * cylinder of diameter `size.x`, scaled in Z by `size.z / size.x` — an
 * ellipse of radii `size.x/2` by `size.z/2`, not the `size.x x size.z` AABB
 * the old generic collider used (which left the four corners — about 21.5%
 * of the envelope — solid over nothing visible).
 */
function londonRoundHall(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  return [
    {
      kind: "convex",
      id: `${landmark.id}:drum`,
      points: regularEllipsePolygon(
        landmark.center,
        landmark.size.x / 2,
        landmark.size.z / 2,
        REGULAR_POLYGON_SIDES.roundHall,
      ),
    },
  ];
}

/**
 * `london-eye-wheel`: the old generic collider was a centre circle — the
 * rim, hub, spokes and pods are all well above vehicle height, so the wheel
 * centre was invisibly solid while the two ground-touching support legs had
 * no collider at all. `render/londonLandmarks.ts`'s own leg constants:
 * radius 45 (`landmark.size.x / 2`), hub Y 53 (`radius + 8`), each leg
 * width/depth 1.6, height 57 (`hubY + 4`), local centre
 * `(side * 9, (hubY + 4) / 2, side * 5)`, Z-rotation `-side * 12deg`. A leg
 * leans, so its footprint at vehicle height is not its unrotated base —
 * clip its rotated (X, Y) cross-section to `[0, VEHICLE_HEIGHT_BAND_M]` and
 * take the clipped range's X extent (verified against the real leaning-box
 * mesh under `NullEngine`, corner by corner, to the numbers below); the Z
 * extent never rotates (`rotation.z` only turns the box within the X-Y
 * plane), so it stays the plain interval `centerZ + side * 5 +- 0.8`.
 */
function londonEyeWheel(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const radius = landmark.size.x / 2;
  const hubY = radius + 8;
  const legHalfWidth = 0.8;
  const legHalfHeight = (hubY + 4) / 2;
  const solids: GroundSolid[] = [];
  for (const side of [-1, 1] as const) {
    const centerX = landmark.center.x + side * 9;
    const centerY = legHalfHeight;
    const centerZ = landmark.center.z + side * 5;
    const thetaRad = (-side * 12 * Math.PI) / 180;
    const cosT = Math.cos(thetaRad);
    const sinT = Math.sin(thetaRad);
    // The four "vertical" edges of the unrotated box (u = +-legHalfWidth,
    // v = +-legHalfHeight), rotated into (worldX, worldY) about the box's
    // own centre; only Y crossing the band matters, so this only needs the
    // edges that vary in v.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const u of [-legHalfWidth, legHalfWidth]) {
      const endpoints = [-legHalfHeight, legHalfHeight].map((v) => ({
        worldX: centerX + u * cosT - v * sinT,
        worldY: centerY + u * sinT + v * cosT,
      }));
      const [a, b] = endpoints;
      for (const point of endpoints) {
        if (point.worldY >= 0 && point.worldY <= VEHICLE_HEIGHT_BAND_M) {
          minX = Math.min(minX, point.worldX);
          maxX = Math.max(maxX, point.worldX);
        }
      }
      const dy = b.worldY - a.worldY;
      if (Math.abs(dy) > 1e-9) {
        for (const bandY of [0, VEHICLE_HEIGHT_BAND_M]) {
          const t = (bandY - a.worldY) / dy;
          if (t >= 0 && t <= 1) {
            const x = a.worldX + (b.worldX - a.worldX) * t;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) continue;
    solids.push({
      kind: "aabb",
      id: `${landmark.id}:leg:${side}`,
      minX,
      maxX,
      minZ: centerZ - 0.8,
      maxZ: centerZ + 0.8,
    });
  }
  return solids;
}

/** `london-natural-history-tower`: the generic tower fallback's radius-3.2
 * circle (`max(4, size.x*0.4)/2` with `size.x=16` clamped to the 4 m floor's
 * own half) misses the visible square shaft entirely — its own body is an
 * 11 x 11 m box, not a circle. */
function londonNaturalHistoryTower(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const half = 5.5;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:shaft`,
      minX: landmark.center.x - half,
      maxX: landmark.center.x + half,
      minZ: landmark.center.z - half,
      maxZ: landmark.center.z + half,
    },
  ];
}

/** `london-clock-tower`: same generic-tower-circle mismatch as the natural
 * history tower — the visible ground shaft is a 14 x 14 m square; the belfry
 * and spire above it add nothing at vehicle height. */
function londonClockTower(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const half = 7;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:shaft`,
      minX: landmark.center.x - half,
      maxX: landmark.center.x + half,
      minZ: landmark.center.z - half,
      maxZ: landmark.center.z + half,
    },
  ];
}

/** `london-glass-gherkin`: `render/londonLandmarks.ts` draws 12 stacked
 * tapering drums; `gherkinProfile` is that renderer's own taper function,
 * re-derived here (not copied as a literal radius) so a future change to
 * the renderer's profile cannot silently drift out of sync with collision.
 * The tower widens from its base through band 0 (`bandHeight = 132/12 = 11`,
 * comfortably taller than the vehicle-height band), so the widest
 * cross-section within `[0, VEHICLE_HEIGHT_BAND_M]` is at the *top* of that
 * slice — linearly interpolate band 0's own bottom/top diameters to
 * `VEHICLE_HEIGHT_BAND_M` and emit the renderer's 16-sided footprint at
 * that radius. The old generic tower fallback (radius 6.8, from
 * `max(4, size.x*0.4)/2` with `size.x=34`) was both the wrong shape and, at
 * 6.8 m, narrower than the true ~9.01 m footprint. */
function gherkinProfile(t: number): number {
  return Math.sin(Math.PI * (0.12 + t * 0.82)) ** 0.7;
}

function londonGlassGherkin(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const bands = 12;
  const height = 132;
  const bandHeight = height / bands;
  const lowerDiameter = landmark.size.x * gherkinProfile(0 / bands);
  const upperDiameter = landmark.size.x * gherkinProfile(1 / bands);
  const bandFraction = VEHICLE_HEIGHT_BAND_M / bandHeight;
  const diameterAtBand = lowerDiameter + (upperDiameter - lowerDiameter) * bandFraction;
  return [
    {
      kind: "convex",
      id: `${landmark.id}:base`,
      points: regularEllipsePolygon(landmark.center, diameterAtBand / 2, diameterAtBand / 2, 16),
    },
  ];
}

/** `london-shard-spire`: `render/londonLandmarks.ts` draws 8 stacked
 * `tessellation: 4` (square) sections rotated `Math.PI / 4`, narrowing
 * upward — so unlike the gherkin, the widest cross-section within the
 * vehicle-height band is at Y=0 exactly, the section's own full
 * `diameterBottom` (`size.x`, un-tapered at `section=0`). A tessellation-4
 * cylinder's vertices sit ON its diameter's circle, so a diameter-38 square
 * rotated 45 degrees is an axis-aligned square whose half extent is
 * `(diameter / 2) / sqrt(2)`, not the circumscribed circle's own radius 19 —
 * using radius 19 as a circle would invent solid corners past the square's
 * real footprint, the same over-collider bug this landmark exists to fix.
 * The old generic tower fallback (radius 7.6, `max(4, size.x*0.4)/2`) was a
 * circle at neither this reduced footprint nor the full 19 m. */
function londonShardSpire(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const half = landmark.size.x / 2 / Math.SQRT2;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:base`,
      minX: landmark.center.x - half,
      maxX: landmark.center.x + half,
      minZ: landmark.center.z - half,
      maxZ: landmark.center.z + half,
    },
  ];
}

/** `london-monument-column`: the generic monument fallback's radius
 * (`max(1.2, min(size.x,size.z)/3)`, here 4) is a circle at neither the
 * shape (square) nor the size (12 x 12) of the visible plinth; the shaft
 * above is contained by the plinth's own footprint. */
function londonMonumentColumn(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const half = 6;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:plinth`,
      minX: landmark.center.x - half,
      maxX: landmark.center.x + half,
      minZ: landmark.center.z - half,
      maxZ: landmark.center.z + half,
    },
  ];
}

/** `london-palace`: the generic cultural-box fallback already matches the
 * visible 90 x 46 body exactly (kept verbatim) but misses two sets of
 * vehicle-height protrusions in front of it: 13 portico columns and, further
 * out, 17 forecourt railing posts. Both are real, driveable-through gaps
 * today — a wall bridging the whole colonnade or the whole railing run would
 * be the same over-collider bug in a new shape, so each post/column gets its
 * own small circle rather than one span. */
function londonPalace(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const { x: cx, z: cz } = landmark.center;
  const solids: GroundSolid[] = [
    {
      kind: "aabb",
      id: `${landmark.id}:body`,
      minX: cx - 45,
      maxX: cx + 45,
      minZ: cz - 23,
      maxZ: cz + 23,
    },
  ];
  for (let column = -6; column <= 6; column += 1) {
    solids.push({
      kind: "circle",
      id: `${landmark.id}:column:${column}`,
      x: cx + column * (90 / 14),
      z: cz - 46 / 2 - 1,
      radius: 0.85,
    });
  }
  for (let post = -8; post <= 8; post += 1) {
    const postHalf = 0.09; // 0.18 x 0.18 footprint
    const postX = cx + post * (90 / 17);
    const postZ = cz - 46 / 2 - 12;
    solids.push({
      kind: "aabb",
      id: `${landmark.id}:railing:${post}`,
      minX: postX - postHalf,
      maxX: postX + postHalf,
      minZ: postZ - postHalf,
      maxZ: postZ + postHalf,
    });
  }
  return solids;
}

/** `london-natural-history-museum`: the generic shops-box fallback already
 * matches the visible 72 x 30 body exactly (kept verbatim) but misses the
 * entrance projection and seven pilasters along the south face, each
 * standing 0.675-0.925 m proud of it at vehicle height — flat window panels
 * and department-store panes are decorative and deliberately excluded, so a
 * small art offset never turns into a general AABB tolerance. */
function londonNaturalHistoryMuseum(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const solids: GroundSolid[] = [
    {
      kind: "aabb",
      id: `${landmark.id}:body`,
      minX: landmark.center.x - landmark.size.x / 2,
      maxX: landmark.center.x + landmark.size.x / 2,
      minZ: landmark.center.z - landmark.size.z / 2,
      maxZ: landmark.center.z + landmark.size.z / 2,
    },
    {
      kind: "aabb",
      id: `${landmark.id}:entrance`,
      minX: -28.75,
      maxX: -21.25,
      minZ: -90.925,
      maxZ: -90.075,
    },
  ];
  const pilasterXs = [-52, -43, -34, -25, -16, -7, 2];
  for (const [index, x] of pilasterXs.entries()) {
    solids.push({
      kind: "aabb",
      id: `${landmark.id}:pilaster:${index}`,
      minX: x - 0.6,
      maxX: x + 0.6,
      minZ: -90.35 - 0.325,
      maxZ: -90.35 + 0.325,
    });
  }
  return solids;
}

// ---------------------------------------------------------------------------
// Cairo
// ---------------------------------------------------------------------------

/** `cairo-tower`: the visible ground core is a 5.2 m-diameter cylinder
 * (radius 2.6); ribs sit inside it, the elevated pod/crown add nothing at
 * ground level. The old generic collider (radius 4.8, from `size.x / 2`)
 * left a 2.2 m annulus solid over open pavement. */
function cairoTower(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  return [{ kind: "circle", id: `${landmark.id}:core`, x: landmark.center.x, z: landmark.center.z, radius: 2.6 }];
}

/** `cairo-tahrir-obelisk`: the visible plinth is a 7 x 7 m square; the old
 * generic collider (radius 4.667) was both too big on the diagonals and
 * (irrelevantly, since it was a circle) never matched a square at all. */
function cairoTahrirObelisk(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const half = 3.5;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:plinth`,
      minX: landmark.center.x - half,
      maxX: landmark.center.x + half,
      minZ: landmark.center.z - half,
      maxZ: landmark.center.z + half,
    },
  ];
}

/** `cairo-tahrir-ministries`: a central slab, two set-back wings, and a
 * portico's nine columns — the old generic collider was simply the full
 * authored 44 x 22 AABB, which stood solid over the front/rear strips
 * beside the central slab that the wings' set-back actually leaves open. */
function cairoTahrirMinistries(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const { x: cx, z: cz } = landmark.center;
  const solids: GroundSolid[] = [
    {
      kind: "aabb",
      id: `${landmark.id}:central`,
      minX: cx - 11,
      maxX: cx + 11,
      minZ: cz - 11,
      maxZ: cz + 11,
    },
  ];
  for (const side of [-1, 1] as const) {
    const wingX = cx + side * 16.5;
    const wingZ = cz + 1;
    solids.push({
      kind: "aabb",
      id: `${landmark.id}:wing:${side}`,
      minX: wingX - 5.5,
      maxX: wingX + 5.5,
      minZ: wingZ - 9,
      maxZ: wingZ + 9,
    });
  }
  for (let column = -4; column <= 4; column += 1) {
    solids.push({
      kind: "circle",
      id: `${landmark.id}:column:${column}`,
      x: cx + column * (22 / 8.8),
      z: cz - 11 - 1.1,
      radius: 0.45,
    });
  }
  return solids;
}

/** `cairo-opera-house`: a front hall and a narrower rear stage, plus a
 * garden colonnade's nine columns — the old generic collider was the full
 * authored 32 x 58 AABB, solid over the two rear-side strips the stage's
 * narrower width actually leaves open. */
function cairoOperaHouse(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const { x: cx, z: cz } = landmark.center;
  const northFaceZ = cz + 29;
  const hallCenterZ = northFaceZ - 22;
  const stageCenterZ = northFaceZ - 51;
  const solids: GroundSolid[] = [
    {
      kind: "aabb",
      id: `${landmark.id}:hall`,
      minX: cx - 16,
      maxX: cx + 16,
      minZ: hallCenterZ - 22,
      maxZ: hallCenterZ + 22,
    },
    {
      kind: "aabb",
      id: `${landmark.id}:stage`,
      minX: cx - 13,
      maxX: cx + 13,
      minZ: stageCenterZ - 7,
      maxZ: stageCenterZ + 7,
    },
  ];
  for (let column = -4; column <= 4; column += 1) {
    solids.push({
      kind: "circle",
      id: `${landmark.id}:column:${column}`,
      x: cx + column * (32 / 8.8),
      z: northFaceZ + 1.1,
      radius: 0.425,
    });
  }
  return solids;
}

/** `cairo-egyptian-museum`: the generic museum-box fallback already matches
 * the visible 50 x 64 body exactly (kept verbatim) but misses two
 * vehicle-height protrusions `render/cairoLandmarks.ts` draws past its front
 * (north, `-Z`) face: a central pavilion projecting the full building depth
 * plus 0.55 m beyond each end, and a narrower entrance block projecting
 * 0.07-0.35 m further still. Flat window bays on the same face stay
 * decorative — same "small art offset" exemption as `london-department-store`
 * — because their whole mass sits above `VEHICLE_HEIGHT_BAND_M` (Y
 * 4.3-7.3 m), unlike the pavilion (Y 0-13) and entrance (Y 0.45-5.95). */
function cairoEgyptianMuseum(landmark: LandmarkGroundSolidInput): readonly GroundSolid[] {
  const { x: cx, z: cz } = landmark.center;
  const { x: sizeX, z: sizeZ } = landmark.size;
  const pavilionHalfX = Math.max(10, sizeX * 0.27) / 2;
  const pavilionHalfZ = (sizeZ + 1.1) / 2;
  const facadeZ = cz - sizeZ / 2 - 0.11;
  const entranceCenterZ = facadeZ - 0.1;
  return [
    {
      kind: "aabb",
      id: `${landmark.id}:body`,
      minX: cx - sizeX / 2,
      maxX: cx + sizeX / 2,
      minZ: cz - sizeZ / 2,
      maxZ: cz + sizeZ / 2,
    },
    {
      kind: "aabb",
      id: `${landmark.id}:pavilion`,
      minX: cx - pavilionHalfX,
      maxX: cx + pavilionHalfX,
      minZ: cz - pavilionHalfZ,
      maxZ: cz + pavilionHalfZ,
    },
    {
      kind: "aabb",
      id: `${landmark.id}:entrance`,
      minX: cx - 2.25,
      maxX: cx + 2.25,
      minZ: entranceCenterZ - 0.14,
      maxZ: entranceCenterZ + 0.14,
    },
  ];
}

const LONDON_RECIPES: Readonly<
  Record<string, (landmark: LandmarkGroundSolidInput) => readonly GroundSolid[]>
> = {
  "london-round-hall": londonRoundHall,
  "london-eye-wheel": londonEyeWheel,
  "london-natural-history-tower": londonNaturalHistoryTower,
  "london-clock-tower": londonClockTower,
  "london-glass-gherkin": londonGlassGherkin,
  "london-shard-spire": londonShardSpire,
  "london-monument-column": londonMonumentColumn,
  "london-palace": londonPalace,
  "london-natural-history-museum": londonNaturalHistoryMuseum,
};

const CAIRO_RECIPES: Readonly<
  Record<string, (landmark: LandmarkGroundSolidInput) => readonly GroundSolid[]>
> = {
  "cairo-tower": cairoTower,
  "cairo-tahrir-obelisk": cairoTahrirObelisk,
  "cairo-tahrir-ministries": cairoTahrirMinistries,
  "cairo-opera-house": cairoOperaHouse,
  "cairo-egyptian-museum": cairoEgyptianMuseum,
};

/**
 * `undefined` means "no bespoke recipe for this landmark id" — the generic
 * kind fallback (box for station/terminal/shops/museum/cultural, circle for
 * tower/monument) remains authoritative. An empty array would mean "bespoke,
 * but intentionally no ground solid"; nothing here returns that yet.
 */
export function landmarkGroundSolids(
  mapId: string,
  landmark: LandmarkGroundSolidInput,
): readonly GroundSolid[] | undefined {
  if (mapId.includes("london")) return LONDON_RECIPES[landmark.id]?.(landmark);
  if (mapId.includes("cairo")) return CAIRO_RECIPES[landmark.id]?.(landmark);
  return undefined;
}
