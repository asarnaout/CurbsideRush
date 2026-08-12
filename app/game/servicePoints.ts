/**
 * Where a service point's lot, its fuel pumps and its repair bay actually land
 * in the world.
 *
 * The renderer places a service building set back from its anchored lane, so
 * its furniture is nowhere near the lane anchor itself — with the current
 * set-backs a station's pumps sit 19m or so from it. Anything that asks "is the
 * car at this service?" therefore has to resolve the same placement the
 * renderer uses, which is why that maths lives here rather than being repeated
 * per caller.
 */
import type { ServicePointKind, WorldPoint } from "./types";
import { resolveSimulationLaneAnchor } from "./laneAnchors";

// Re-exported so `GameCanvas` can name the union without importing `./types`,
// which it otherwise avoids in favour of local structural types. One union,
// reachable from both rings — a second copy would be free to drift, and this
// one is a lookup key rather than a label.
export type { ServicePointKind };
import {
  REPAIR_SHOP_BAY_OFFSET_M,
  REPAIR_SHOP_LOT_HALF_M,
} from "./repairShopLayout";
import {
  GAS_STATION_CANOPY_M,
  GAS_STATION_SLAB_HALF_M,
} from "./propFootprints";

/**
 * The only lane fields anchor resolution needs. Both the authored `LaneSegment`
 * and the renderer's lighter `GameCanvasLane` satisfy this, so the renderer and
 * the HUD can share one placement implementation instead of each keeping its
 * own copy of the set-back maths.
 */
export interface AnchoredLane {
  readonly id: string;
  readonly centerline: readonly WorldPoint[];
}

/**
 * Likewise the only service-point fields placement needs.
 *
 * `kind` is required rather than defaulted: the lot's yaw comes from the kind's
 * frame, and a wrong default would rotate a building's colliders away from the
 * building itself — visible only as a car stopping on open ground.
 */
export interface AnchoredServicePoint {
  readonly kind: ServicePointKind;
  readonly anchor: {
    readonly laneId: string;
    readonly distanceAlongM: number;
  };
  readonly setbackM?: number;
}

/** Enough of a service point to tell the two kinds apart. */
interface KindedServicePoint {
  readonly kind: ServicePointKind;
}

/**
 * The gas stations on a map, and nothing else.
 *
 * Named rather than inlined because the pump maths below is unconditional: run
 * `gasStationPumpPositions` over a repair shop and it will happily invent four
 * pumps on its forecourt, offering fuel at a garage and staging the refuel
 * cutscene at a nozzle that is not there. Every gas-specific caller goes
 * through here.
 */
export const gasStationsOf = <T extends KindedServicePoint>(
  points: readonly T[] | undefined,
): readonly T[] => (points ?? []).filter((point) => point.kind === "gas_station");

/** The repair shops on a map, and nothing else. See `gasStationsOf`. */
export const repairShopsOf = <T extends KindedServicePoint>(
  points: readonly T[] | undefined,
): readonly T[] => (points ?? []).filter((point) => point.kind === "repair_shop");

/** Fallback when a site does not tune its own set-back. */
export const DEFAULT_SERVICE_SETBACK_M = 16;

/**
 * How each kind's building sits on its lot: the scale its geometry is drawn at
 * and the yaw that turns its frontage to face the road.
 *
 * These are the numbers the *renderer* uses, restated. This module deliberately
 * does not import `modelLibrary` (which pulls in Babylon), so the gas station's
 * pair is a hand copy of `PROP_MODEL_REGISTRY.gas_station` — and a copy that
 * silently disagreed would rotate every collider on the lot while the building
 * looked fine. `tests/modelLibrary.test.ts` pins the two together.
 *
 * The repair shop has no model to disagree with: it is authored at true metres
 * in `repairShopLayout.ts`, hence scale 1. It takes the same yaw offset so both
 * kinds share one frame convention — road on the `-x` side.
 */
export const SERVICE_MODEL_FRAME: Readonly<
  Record<ServicePointKind, { readonly scale: number; readonly yawOffset: number }>
> = Object.freeze({
  gas_station: { scale: 2.8, yawOffset: Math.PI / 2 },
  repair_shop: { scale: 1, yawOffset: Math.PI / 2 },
});

/** Half-extent of each kind's lot on the ground — the clearance a street-wall
 * building may never stand inside, and a lot's own placement may not overlap
 * the road shoulder by. Authoring invariants only; nothing carves it out of a
 * collider any more (the shared building plan never places one there). */
export const SERVICE_LOT_HALF_M: Readonly<Record<ServicePointKind, number>> =
  Object.freeze({
    gas_station: GAS_STATION_SLAB_HALF_M,
    repair_shop: REPAIR_SHOP_LOT_HALF_M,
  });

const GAS_STATION_MODEL_SCALE = SERVICE_MODEL_FRAME.gas_station.scale;

/**
 * The four pump bodies, in the station model's own frame (model units, before
 * the 2.8x scale). Measured off the rendered scene rather than read off the
 * glb: the loader's handedness handling makes the model→world transform easy
 * to get subtly wrong, so these were recovered by inverting the placement for
 * three cities whose stations face three different ways (headings pi, pi/2 and
 * 0). All three yielded these same offsets to four decimal places, which is
 * what pins the transform below down. `gasStationPumpPositions` is covered by
 * tests asserting the world positions those three cities actually render.
 */
const GAS_STATION_PUMP_OFFSETS: readonly WorldPoint[] = [
  { x: 3.1946, z: 0.1875 },
  { x: 3.1946, z: 1.425 },
  { x: 0.5518, z: 1.425 },
  { x: 0.5518, z: 0.1875 },
];

/**
 * How close the car has to be to a pump for the refuel prompt to appear. The
 * pumps stand 3.46m apart across an island and 7.4m between islands, so this
 * covers a car drawn up at any one of them while still excluding the rest of
 * the forecourt — the shop is 9m from the nearest pump and the carriageway 19m.
 */
export const FUEL_PUMP_REACH_M = 5;

/** The pose a service building is placed at: lot centre plus its facing. */
export function resolveServicePointLot(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): { readonly x: number; readonly z: number; readonly yaw: number } | null {
  const pose = resolveSimulationLaneAnchor(lanes, service.anchor);
  if (!pose) return null;
  const setback = service.setbackM ?? DEFAULT_SERVICE_SETBACK_M;
  // Set back along the right-hand normal of the lane, matching the renderer.
  return {
    x: pose.x + Math.cos(pose.heading) * setback,
    z: pose.z - Math.sin(pose.heading) * setback,
    yaw: pose.heading + SERVICE_MODEL_FRAME[service.kind].yawOffset,
  };
}

/** World positions of the station's four fuel pumps. */
export function gasStationPumpPositions(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): readonly WorldPoint[] {
  const lot = resolveServicePointLot(lanes, service);
  if (!lot) return [];
  const cos = Math.cos(lot.yaw);
  const sin = Math.sin(lot.yaw);
  return GAS_STATION_PUMP_OFFSETS.map((offset) => ({
    x: lot.x + GAS_STATION_MODEL_SCALE * (offset.x * cos + offset.z * sin),
    z: lot.z + GAS_STATION_MODEL_SCALE * (-offset.x * sin + offset.z * cos),
  }));
}

/** Metres from (x, z) to the station's nearest pump; Infinity if unresolvable. */
export function distanceToNearestPump(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
  x: number,
  z: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const pump of gasStationPumpPositions(lanes, service)) {
    const distance = Math.hypot(x - pump.x, z - pump.z);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/**
 * The station's canopy in world space: an oriented box, plus the height a
 * viewpoint under it has to stay below.
 *
 * Rotated by `lot.yaw - yawOffset` (i.e. the lane heading) rather than by the
 * yaw, because `GAS_STATION_CANOPY_M` is authored in the holder frame the rest
 * of `propFootprints` uses — the same correction `buildStaticObstacles` applies
 * to `GAS_STATION_SOLIDS_M`. Rotating by the full yaw instead turns the canopy a
 * quarter-turn off the pumps it covers, which reads as "the fix works at some
 * stations and not others".
 */
export function gasStationCanopyWorld(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
  readonly undersideY: number;
} | null {
  const lot = resolveServicePointLot(lanes, service);
  if (!lot) return null;
  const cos = Math.cos(lot.yaw - SERVICE_MODEL_FRAME[service.kind].yawOffset);
  const sin = Math.sin(lot.yaw - SERVICE_MODEL_FRAME[service.kind].yawOffset);
  const centerX = (GAS_STATION_CANOPY_M.minX + GAS_STATION_CANOPY_M.maxX) / 2;
  const centerZ = (GAS_STATION_CANOPY_M.minZ + GAS_STATION_CANOPY_M.maxZ) / 2;
  return {
    x: lot.x + centerX * cos + centerZ * sin,
    z: lot.z - centerX * sin + centerZ * cos,
    ux: cos,
    uz: -sin,
    halfU: (GAS_STATION_CANOPY_M.maxX - GAS_STATION_CANOPY_M.minX) / 2,
    halfV: (GAS_STATION_CANOPY_M.maxZ - GAS_STATION_CANOPY_M.minZ) / 2,
    undersideY: GAS_STATION_CANOPY_M.undersideY,
  };
}

/**
 * World position of a repair shop's bay floor — where the car has to stop.
 *
 * The repair-shop counterpart of `gasStationPumpPositions`, and simpler for the
 * same reason the shop is authored: there is one bay, at a known offset in the
 * shop's own frame, rather than four pump bodies recovered by inverting a
 * model's placement.
 */
export function repairShopBayPosition(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
): WorldPoint | null {
  const lot = resolveServicePointLot(lanes, service);
  if (!lot) return null;
  const cos = Math.cos(lot.yaw);
  const sin = Math.sin(lot.yaw);
  const { x, z } = REPAIR_SHOP_BAY_OFFSET_M;
  return {
    x: lot.x + x * cos + z * sin,
    z: lot.z - x * sin + z * cos,
  };
}

/** Metres from (x, z) to the shop's bay; Infinity if unresolvable. */
export function distanceToRepairBay(
  lanes: readonly AnchoredLane[],
  service: AnchoredServicePoint,
  x: number,
  z: number,
): number {
  const bay = repairShopBayPosition(lanes, service);
  return bay ? Math.hypot(x - bay.x, z - bay.z) : Number.POSITIVE_INFINITY;
}
