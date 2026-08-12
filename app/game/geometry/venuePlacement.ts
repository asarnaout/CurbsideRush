import type { GameCanvasMapPack } from "../sessionContract";
import { resolveSimulationLaneAnchor } from "../laneAnchors";
import { defaultSidewalkWidthM, resolveMapVisualPalette } from "../visuals";
import { PROP_MODEL_FOOTPRINTS_M } from "../propFootprints";

/**
 * Venue/pavement placement math, extracted to its own leaf module (plan
 * `.claude/building-collision-visual-parity-plan.md` Section 7.1) so
 * `geometry/buildingLayout.ts` can import it without a runtime cycle:
 * `geometry/facadesAndKeepouts.ts` already imported `resolveVenuePlacement`
 * from `simulationAdapter.ts`, and the planner both needs keep-outs
 * (`facadesAndKeepouts.ts`) AND is itself imported BY `simulationAdapter.ts` —
 * so the shared venue/pavement math has to live below both, not inside
 * either. `simulationAdapter.ts` and `geometry/facadesAndKeepouts.ts` both
 * import this leaf now; `tests/architecture.test.ts`'s import-cycle
 * expectations are unaffected because a `geometry/*.ts` importing another
 * `geometry/*.ts` leaf was already the shape `roadStrips.ts`/`waterGeometry.ts`
 * used.
 *
 * Pure — no Babylon, no DOM — matching every other file under `geometry/`
 * (mechanically enforced by ESLint, not just documented here).
 */

const DEFAULT_VENUE_SETBACK_M = 13;
/** Clearance kept between the pavement's outer edge and a building front. */
export const VENUE_PAVEMENT_GAP_M = 0.4;

type RoadSurfaceLike = NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>[number];
type VenueLike = NonNullable<GameCanvasMapPack["geometry"]["gigVenues"]>[number];

export function sidewalkWidthForSurface(
  mapPack: GameCanvasMapPack,
  surface: RoadSurfaceLike,
): number {
  if (surface.sidewalkWidthM !== undefined) {
    return Math.max(0, surface.sidewalkWidthM);
  }
  return defaultSidewalkWidthM(mapPack);
}

/**
 * Distance from an anchor pose to the outer edge of the walkable pavement
 * band along its road, measured along the given right normal. Null when the
 * lane belongs to no authored road surface.
 */
export function pavementOuterFromPose(
  mapPack: GameCanvasMapPack,
  laneId: string,
  pose: { x: number; z: number },
  rightX: number,
  rightZ: number,
): number | null {
  const surface = (mapPack.geometry.roadSurfaces ?? []).find((candidate) =>
    candidate.laneIds.includes(laneId),
  );
  if (!surface) return null;
  let closestX = pose.x;
  let closestZ = pose.z;
  let bestDistance = Number.POSITIVE_INFINITY;
  const line = surface.centerline;
  for (let index = 0; index < line.length - 1; index += 1) {
    const ax = line[index].x;
    const az = line[index].z;
    const dx = line[index + 1].x - ax;
    const dz = line[index + 1].z - az;
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq > 1e-9
        ? Math.max(
            0,
            Math.min(1, ((pose.x - ax) * dx + (pose.z - az) * dz) / lengthSq),
          )
        : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const distance = Math.hypot(pose.x - px, pose.z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      closestX = px;
      closestZ = pz;
    }
  }
  const laneOffsetTowardVenue =
    (pose.x - closestX) * rightX + (pose.z - closestZ) * rightZ;
  return (
    surface.widthM / 2 +
    sidewalkWidthForSurface(mapPack, surface) -
    laneOffsetTowardVenue
  );
}

export interface VenuePlacement {
  /** Where the building holder stands (what placeProp receives). */
  readonly x: number;
  readonly z: number;
  /** The anchor pose the placement was derived from. */
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly heading: number;
  /** Holder distance from the anchor along the driver-right normal. */
  readonly setbackM: number;
}

/**
 * The single source of truth for where a gig venue's building stands — used
 * by the renderer to place the model AND by the collider builder, so the two
 * can never drift apart again.
 *
 * On paved city maps, venues with a measured model footprint are pulled
 * forward so the model's front face sits just behind the walkable pavement,
 * aligning the venue with the street wall around it (the authored setback
 * only says which lot it belongs to). Everywhere else the authored setback
 * stands, and the measured footprint still shapes the collider.
 */
export function resolveVenuePlacement(
  mapPack: GameCanvasMapPack,
  venue: VenueLike,
): VenuePlacement | null {
  const pose = resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, venue.anchor);
  if (!pose) return null;
  const rightX = Math.cos(pose.heading);
  const rightZ = -Math.sin(pose.heading);
  let setback = venue.setbackM ?? DEFAULT_VENUE_SETBACK_M;
  const footprint = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
  if (footprint && resolveMapVisualPalette(mapPack.id).paved) {
    const pavementOuter = pavementOuterFromPose(
      mapPack,
      venue.anchor.laneId,
      pose,
      rightX,
      rightZ,
    );
    if (pavementOuter !== null) {
      setback = pavementOuter + VENUE_PAVEMENT_GAP_M - footprint.minX;
    }
  }
  return {
    x: pose.x + rightX * setback,
    z: pose.z + rightZ * setback,
    anchorX: pose.x,
    anchorZ: pose.z,
    heading: pose.heading,
    setbackM: setback,
  };
}
