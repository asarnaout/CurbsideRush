/**
 * The exact production world transforms for venue, gas-station, and
 * repair-shop solids — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 8.3/7.2 item 4.
 *
 * Ported verbatim from `simulationAdapter.ts`'s `buildStaticObstacles` (the
 * venue-solid and service-solid loops), which is the production collider
 * builder these transforms were previously only inlined into. This module
 * is the single source of truth going forward, consumed by the visual audit
 * now and by the semantic-reservation model (Phase 2) and simulation later
 * — a placement transform can never again drift between what a car collides
 * with and what a camera sees.
 *
 * Deliberately does **not** expose the authored `venue.footprint`/`GigVenue`
 * envelope as a visual occluder: that envelope is `buildStaticObstacles`'s
 * own collision-only fallback for a venue with no measured model footprint,
 * and Section 7.2 item 4 is explicit that treating it as filled visual mass
 * would let an empty rectangle certify a real gap closed. A venue with no
 * `PROP_MODEL_FOOTPRINTS_M` entry resolves to `{ resolved: false }` here so
 * the caller can report `audit_geometry_missing` instead.
 *
 * Pure — no Babylon, no DOM — like every other `geometry/*.ts` file.
 */
import { PROP_MODEL_FOOTPRINTS_M, GAS_STATION_SOLIDS_M } from "../propFootprints";
import { REPAIR_SHOP_SOLIDS_M } from "../repairShopLayout";
import {
  SERVICE_MODEL_FRAME,
  resolveServicePointLot,
  type AnchoredLane,
  type AnchoredServicePoint,
} from "../servicePoints";
import type { GameCanvasMapPack } from "../sessionContract";
import { resolveVenuePlacement } from "./venuePlacement";

export interface PlacedObb {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

export interface PlacedSolid {
  readonly localId: string;
  readonly obb: PlacedObb;
}

type VenueLike = NonNullable<GameCanvasMapPack["geometry"]["gigVenues"]>[number];

export type PlacedVenueFootprint =
  | { readonly resolved: true; readonly solids: readonly PlacedSolid[] }
  | { readonly resolved: false };

/**
 * A venue's exact world-space visual solid(s), from its measured
 * `PROP_MODEL_FOOTPRINTS_M` entry only. `null` when the venue's lane anchor
 * itself cannot resolve (a content bug elsewhere); `{ resolved: false }`
 * when the anchor resolves but no model footprint has been measured yet.
 *
 * Verbatim port of `buildStaticObstacles`'s measured-footprint branch: the
 * footprint's local X axis (its "depth", perpendicular to the facade) maps
 * to the placement's driver-right normal, and its local Z axis (along the
 * facade) maps to the placement's forward direction — the frame
 * `propFootprints.ts` documents each entry as already measured in.
 */
export function placedVenueFootprint(
  mapPack: GameCanvasMapPack,
  venue: VenueLike,
): PlacedVenueFootprint | null {
  const placement = resolveVenuePlacement(mapPack, venue);
  if (!placement) return null;
  const footprint = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
  if (!footprint) return { resolved: false };
  const rightX = Math.cos(placement.heading);
  const rightZ = -Math.sin(placement.heading);
  const alongX = Math.sin(placement.heading);
  const alongZ = Math.cos(placement.heading);
  const depthCenter = (footprint.minX + footprint.maxX) / 2;
  const alongCenter = (footprint.minZ + footprint.maxZ) / 2;
  return {
    resolved: true,
    solids: [
      {
        localId: "body",
        obb: {
          x: placement.x + rightX * depthCenter + alongX * alongCenter,
          z: placement.z + rightZ * depthCenter + alongZ * alongCenter,
          ux: alongX,
          uz: alongZ,
          halfU: (footprint.maxZ - footprint.minZ) / 2,
          halfV: (footprint.maxX - footprint.minX) / 2,
        },
      },
    ],
  };
}

/**
 * A gas station's or repair shop's exact world-space shell solids (the shop
 * and two pump islands; the flank/back/office walls), from
 * `GAS_STATION_SOLIDS_M`/`REPAIR_SHOP_SOLIDS_M`. `null` when the service
 * point's lane anchor cannot resolve. Rotated by `lot.yaw -
 * SERVICE_MODEL_FRAME[kind].yawOffset` (the lane heading, not the holder
 * yaw) — verbatim port of `buildStaticObstacles`'s service-solid loop and
 * `servicePoints.ts`'s own `gasStationCanopyWorld`, which applies the exact
 * same correction for the one solid this function excludes on purpose: the
 * canopy stays open to drive under, so it is not "shell."
 */
export function placedServiceShellSolids(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): readonly PlacedSolid[] | null {
  const lot = resolveServicePointLot(lanes, service);
  if (!lot) return null;
  const cos = Math.cos(lot.yaw - SERVICE_MODEL_FRAME[service.kind].yawOffset);
  const sin = Math.sin(lot.yaw - SERVICE_MODEL_FRAME[service.kind].yawOffset);
  const solids = service.kind === "gas_station" ? GAS_STATION_SOLIDS_M : REPAIR_SHOP_SOLIDS_M;
  return solids.map((solid) => {
    const centerX = (solid.minX + solid.maxX) / 2;
    const centerZ = (solid.minZ + solid.maxZ) / 2;
    return {
      localId: solid.id,
      obb: {
        x: lot.x + centerX * cos + centerZ * sin,
        z: lot.z - centerX * sin + centerZ * cos,
        ux: cos,
        uz: -sin,
        halfU: (solid.maxX - solid.minX) / 2,
        halfV: (solid.maxZ - solid.minZ) / 2,
      },
    };
  });
}
