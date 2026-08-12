/**
 * Reviewed, height-banded full-detail visual-occlusion volumes for every
 * building-set catalogue model — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 7.2 item 2.
 *
 * Independent of the conservative structural/collision bounds in
 * `buildingStructuralBounds.ts`: those are safe collision proxies that may
 * contain real "air" for L-shaped, chamfered, asymmetric, balcony, and
 * colonnade plans (documented in that file's own header and pinned by
 * `tests/buildingPlacement.test.ts`'s `BOUNDARY_TOLERANCE_OVERRIDES_M`). An
 * audit that terminated a sightline on those envelopes could certify a real
 * gap as visually closed when the actual model has a notch or recess there.
 *
 * Every model below either:
 * - reuses its structural-bounds rectangle directly (every model with no
 *   `BOUNDARY_TOLERANCE_OVERRIDES_M` entry: already measured as
 *   ground-touching-triangle XZ extent, and confirmed by
 *   `tests/buildingPlacement.test.ts`'s own boundary check to sit within the
 *   default 0.5 m tolerance — visually exact for practical purposes), or
 * - for the 18 models with a documented override (a genuinely
 *   non-rectangular ground plan), uses a real measured convex polygon —
 *   the 2 cm-outward-rounded convex hull of every ground-touching triangle
 *   vertex, from the exact same NullEngine measurement recipe
 *   `buildingStructuralBounds.ts`'s own header documents (`getBuildingMaster`'s
 *   production merge pipeline: instantiate real clones, merge, fix winding,
 *   square up, recentre). Every hull vertex was verified to contain every
 *   real ground-touching vertex of its model (never clips real geometry).
 *
 * A convex hull cannot represent a genuine *concave* recess. Five of the
 * eighteen override models — `nyc-tower-b`, `nyc-tower-c`, `cairo-tower-b`,
 * `london-tower-b`, `london-tower-c`, all plain square towers — measured
 * byte-identical to their existing rectangle even after this pass: their
 * documented "boundary air" turned out to be exactly that, a concave notch
 * a convex shape cannot close, not a chamfer or asymmetry a hull could
 * tighten. That is a known, deliberate scope limit, not an oversight: per
 * `buildingStructuralBounds.ts`'s own stated philosophy, a model earns a
 * second/concave solid only once a real discovered gap needs it, not
 * preemptively — the pattern `geometry/landmarkGroundSolids.ts` already
 * uses for bespoke per-landmark recipes is the template if a future audit
 * ever finds one of these five towers actually certifies a closed sightline
 * that is really open.
 *
 * Renderer-independent (no Babylon import): a pure data manifest, matching
 * `buildingStructuralBounds.ts`'s own shape.
 */
import { buildingStructuralBoundsFor } from "./buildingStructuralBounds";
import type { Point2 } from "./geometry/visualSceneFootprints";

export interface VisualOcclusionSolid {
  readonly localId: string;
  /** A clockwise-wound convex polygon in the model's local ground-plan
   * frame (same frame `buildingStructuralBounds.ts`'s rectangles use). */
  readonly points: readonly Point2[];
}

export interface BuildingVisualOcclusion {
  readonly solids: readonly VisualOcclusionSolid[];
  /** Ground-to-roof band, matching `BuildingStructuralBounds.proxyHeightM`. */
  readonly heightM: number;
}

/** Clockwise rectangle winding, matching
 * `geometry/visualSceneFootprints.ts`'s `aabbToPolygon` exactly. */
function rectPoints(minX: number, maxX: number, minZ: number, maxZ: number): Point2[] {
  return [
    { x: minX, z: minZ },
    { x: minX, z: maxZ },
    { x: maxX, z: maxZ },
    { x: maxX, z: minZ },
  ];
}

/**
 * Measured convex hulls for the 13 override models a convex shape could
 * actually tighten (2.4%-8.3% smaller footprint area than their rectangle).
 * The other 5 override models (see module header) are deliberately absent —
 * their rectangle IS this table's answer too, via the fallback below.
 */
const MEASURED_HULLS: Readonly<Record<string, readonly Point2[]>> = {
  "nyc-midrise-b": [
    { x: -9.14, z: 7.14 }, { x: 3.68, z: 7.14 }, { x: 9.06, z: 5.29 }, { x: 9.06, z: -3.85 },
    { x: -0.16, z: -7.06 }, { x: -5.28, z: -7.06 }, { x: -9.14, z: -5.69 },
  ],
  "nyc-house-a": [
    { x: -4.73, z: 3.4 }, { x: -3.73, z: 3.4 }, { x: -0.91, z: 3.4 }, { x: 3.73, z: 3.4 },
    { x: 4.73, z: 3.4 }, { x: 4.73, z: -0.83 }, { x: 4.73, z: -3.21 }, { x: 1.45, z: -3.77 },
    { x: -1.12, z: -3.77 }, { x: -4.73, z: -3.21 },
  ],
  "nyc-shop-corner": [
    { x: -4.16, z: 4.12 }, { x: 2.81, z: 5.04 }, { x: 4.34, z: 5.04 }, { x: 5, z: 4.11 },
    { x: 5, z: -5.04 }, { x: -4.16, z: -5.04 },
  ],
  "cairo-block-4story": [
    { x: -5.45, z: -0.74 }, { x: -5.33, z: 3.87 }, { x: -2.25, z: 5.79 }, { x: 2.25, z: 5.79 },
    { x: 5.35, z: 3.85 }, { x: 5.44, z: 1.25 }, { x: 5.44, z: 0.15 }, { x: 5.33, z: -5.61 },
    { x: 2.72, z: -5.72 }, { x: 1.62, z: -5.72 }, { x: -4.18, z: -5.64 }, { x: -5.35, z: -5.6 },
    { x: -5.45, z: -1.84 },
  ],
  "cairo-block-4story-centre": [
    { x: -5.45, z: -0.74 }, { x: -5.33, z: 3.87 }, { x: -2.25, z: 5.79 }, { x: 2.25, z: 5.79 },
    { x: 5.35, z: 3.85 }, { x: 5.44, z: 1.25 }, { x: 5.44, z: 0.15 }, { x: 5.33, z: -5.61 },
    { x: 2.72, z: -5.72 }, { x: 1.62, z: -5.72 }, { x: -4.18, z: -5.64 }, { x: -5.35, z: -5.6 },
    { x: -5.45, z: -1.84 },
  ],
  "cairo-block-colonnade": [
    { x: -5.36, z: -5.9 }, { x: -5.35, z: 4.48 }, { x: -3.7, z: 6.03 }, { x: 3.7, z: 6.03 },
    { x: 5.36, z: 4.47 }, { x: 5.49, z: -2.37 }, { x: 5.49, z: -3.61 }, { x: 5.34, z: -6.23 },
    { x: -0.2, z: -6.36 }, { x: -4.04, z: -6.36 }, { x: -5.36, z: -6.21 },
  ],
  "cairo-block-balcony": [
    { x: -5.46, z: 1.41 }, { x: -5.36, z: 4.36 }, { x: -1.86, z: 6.54 }, { x: 1.86, z: 6.54 },
    { x: 5.35, z: 4.37 }, { x: 5.47, z: -0.84 }, { x: 5.47, z: -2.08 }, { x: 5.36, z: -6.33 },
    { x: 4.04, z: -6.38 }, { x: -1.15, z: -6.47 }, { x: -2.39, z: -6.47 }, { x: -5.35, z: -6.34 },
    { x: -5.46, z: 0.17 },
  ],
  "cairo-block-terrace": [
    { x: -9.1, z: 1.97 }, { x: -9.01, z: 4.69 }, { x: -2.02, z: 5.43 }, { x: 2.01, z: 5.43 },
    { x: 8.97, z: 4.71 }, { x: 9.08, z: -0.11 }, { x: 9.08, z: -1.25 }, { x: 8.98, z: -5.18 },
    { x: 7.77, z: -5.22 }, { x: -0.29, z: -5.31 }, { x: -1.44, z: -5.31 }, { x: -8.99, z: -5.19 },
    { x: -9.1, z: 0.82 },
  ],
  "cairo-residence-quaternius": [
    { x: -5.05, z: -0.71 }, { x: -4.94, z: 4.1 }, { x: -1.39, z: 5.99 }, { x: 1.39, z: 5.99 },
    { x: 4.95, z: 4.08 }, { x: 5.04, z: 1.36 }, { x: 5.04, z: 0.22 }, { x: 4.94, z: -5.8 },
    { x: 2.21, z: -5.91 }, { x: 1.06, z: -5.91 }, { x: -3.73, z: -5.83 }, { x: -4.95, z: -5.78 },
    { x: -5.05, z: -1.86 },
  ],
  "cairo-office-block": [
    { x: -12.17, z: 0.68 }, { x: -12.1, z: 2.73 }, { x: -4.25, z: 4.76 }, { x: 4.25, z: 4.76 },
    { x: 12.09, z: 2.74 }, { x: 12.18, z: -0.87 }, { x: 12.18, z: -1.73 }, { x: 12.11, z: -4.68 },
    { x: 11.19, z: -4.72 }, { x: 6.84, z: -4.78 }, { x: -6.42, z: -4.78 }, { x: -12.09, z: -4.69 },
    { x: -12.17, z: -0.18 },
  ],
  "cairo-depot": [
    { x: -13.54, z: 1.64 }, { x: -13.46, z: 3.93 }, { x: -4.97, z: 4.55 }, { x: 4.97, z: 4.55 },
    { x: 13.14, z: 3.97 }, { x: 13.46, z: 3.94 }, { x: 13.55, z: -0.09 }, { x: 13.55, z: -1.04 },
    { x: 13.47, z: -4.34 }, { x: 12.43, z: -4.38 }, { x: 7.6, z: -4.45 }, { x: -7.14, z: -4.45 },
    { x: -13.45, z: -4.35 }, { x: -13.54, z: 0.69 },
  ],
  "london-terrace-c": [
    { x: -11.49, z: 0.65 }, { x: -11.43, z: 2.58 }, { x: -4.01, z: 4.5 }, { x: 4.01, z: 4.5 },
    { x: 11.42, z: 2.59 }, { x: 11.51, z: -0.83 }, { x: 11.51, z: -1.64 }, { x: 11.43, z: -4.42 },
    { x: 10.57, z: -4.46 }, { x: 6.46, z: -4.52 }, { x: -6.07, z: -4.52 }, { x: -11.42, z: -4.43 },
    { x: -11.49, z: -0.17 },
  ],
  "london-stucco-c": [
    { x: -11.83, z: 0.66 }, { x: -11.76, z: 2.65 }, { x: -4.13, z: 4.63 }, { x: 4.13, z: 4.63 },
    { x: 11.76, z: 2.66 }, { x: 11.84, z: -0.85 }, { x: 11.84, z: -1.69 }, { x: 11.77, z: -4.55 },
    { x: 10.88, z: -4.59 }, { x: 6.65, z: -4.65 }, { x: -6.24, z: -4.65 }, { x: -11.75, z: -4.56 },
    { x: -11.83, z: -0.17 },
  ],
};

/** Structural bounds for a catalogue model id, expressed as its exact
 * measured visual-occlusion volume(s), or `undefined` if uncurated
 * (mirrors `buildingStructuralBoundsFor`'s own contract). */
export function buildingVisualOcclusionFor(modelId: string): BuildingVisualOcclusion | undefined {
  const bounds = buildingStructuralBoundsFor(modelId);
  if (!bounds) return undefined;
  const hull = MEASURED_HULLS[modelId];
  if (hull) {
    return { solids: [{ localId: "body", points: hull }], heightM: bounds.proxyHeightM };
  }
  return {
    solids: bounds.solids.map((solid) => ({
      localId: solid.localId,
      points: rectPoints(solid.minX, solid.maxX, solid.minZ, solid.maxZ),
    })),
    heightM: bounds.proxyHeightM,
  };
}

/** Every model id this manifest has a real measured hull for (narrower than
 * its structural rectangle) — for tooling/tests/reporting only. */
export function measuredHullModelIds(): readonly string[] {
  return Object.keys(MEASURED_HULLS);
}
