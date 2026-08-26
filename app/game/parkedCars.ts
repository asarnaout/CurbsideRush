import { roadsidePropKeepOuts } from "./geometry/roadFurnitureLayout";
import { createElevatedRoadDeckHeadroomQuery } from "./geometry/elevatedRoadGeometry";
import { LONDON_PARKED_CARS } from "./londonStreetFurniture";
import type {
  GameCanvasLane,
  GameCanvasMapPack,
  GameCanvasPoint,
} from "./sessionContract";
import { TOKYO_STREET_FURNITURE_POINTS } from "./tokyoStreetFurniture";
import { isElevatedRoadSurface } from "./roadElevation";
import {
  distanceToPolylineM,
  hashStringToSeed,
  seededUnit,
  type PropScatterRect,
} from "./visuals";

/** The four committed traffic-fleet glbs used for kerbside parking. */
export type ParkedCarModel = "sedan" | "sports" | "suv" | "van";

export interface ParkedCarPlacement {
  readonly id: string;
  readonly position: GameCanvasPoint;
  /** Clockwise yaw; the car follows the adjacent legal lane. */
  readonly headingDeg: number;
  readonly model: ParkedCarModel;
}

const SLOT_SPACING_M = 26;
const SLOT_JITTER_M = 5;
const SLOT_KEEP_RATE = 0.16;
const CAR_CENTER_PAST_KERB_M = 0.45;
const JUNCTION_CLEARANCE_M = 18;
const CONTROL_CLEARANCE_M = 12;
const CAR_SPACING_M = 13;
const OCCUPIED_CLEARANCE_M = 3.2;
const RECT_CLEARANCE_M = 1.8;
const FOREIGN_ROAD_CLEARANCE_M = 1.5;
const WORLD_EDGE_MARGIN_M = 4;
/** Circular reach of the longest parked model, including a placement margin. */
const PARKED_CAR_DECK_FOOTPRINT_RADIUS_M = 2.7;

/** Model roof plus visual/authoring clearance beneath a sloped concrete slab. */
export const PARKED_CAR_REQUIRED_HEADROOM_M: Readonly<
  Record<ParkedCarModel, number>
> = {
  sedan: 1.95,
  sports: 1.75,
  suv: 2.2,
  van: 2.55,
};

interface GeneratedParkingProfile {
  readonly keepRate: number;
}

const generatedParkingProfile = (mapId: string): GeneratedParkingProfile =>
  mapId === "cairo-central-nile"
    ? {
        // Cairo's occupied kerbs are part of the street wall. The shared 16%
        // deal left long pristine pavement runs even on commercial avenues;
        // the existing full-slot/junction/control checks below still decide
        // whether every individual car is physically legal.
        keepRate: 0.28,
      }
    : { keepRate: SLOT_KEEP_RATE };

const MODEL_POOL: readonly ParkedCarModel[] = [
  "sedan",
  "sedan",
  "sedan",
  "sports",
  "suv",
  "van",
];

const distance = (a: GameCanvasPoint, b: GameCanvasPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const pointInPolygon = (
  point: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    if (
      left.z > point.z !== right.z > point.z &&
      point.x <
        ((right.x - left.x) * (point.z - left.z)) /
          (right.z - left.z) +
          left.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const inflatedRectContains = (
  point: GameCanvasPoint,
  rect: PropScatterRect,
  inflateM: number,
): boolean => {
  const heading = ((rect.headingDeg ?? 0) * Math.PI) / 180;
  const dx = point.x - rect.center.x;
  const dz = point.z - rect.center.z;
  const localX = dx * Math.cos(heading) - dz * Math.sin(heading);
  const localZ = dx * Math.sin(heading) + dz * Math.cos(heading);
  return (
    Math.abs(localX) <= rect.size.x / 2 + inflateM &&
    Math.abs(localZ) <= rect.size.z / 2 + inflateM
  );
};

interface NearestLanePose {
  readonly distanceM: number;
  readonly headingDeg: number;
}

const nearestLanePose = (
  point: GameCanvasPoint,
  lanes: readonly GameCanvasLane[],
): NearestLanePose | null => {
  let nearest: NearestLanePose | null = null;
  for (const lane of lanes) {
    for (let index = 0; index < lane.centerline.length - 1; index += 1) {
      const start = lane.centerline[index];
      const end = lane.centerline[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-9) continue;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.z - start.z) * dz) /
            lengthSquared,
        ),
      );
      const projected = { x: start.x + dx * t, z: start.z + dz * t };
      const distanceM = distance(point, projected);
      if (nearest && distanceM >= nearest.distanceM) continue;
      nearest = {
        distanceM,
        headingDeg: (Math.atan2(dx, dz) * 180) / Math.PI,
      };
    }
  }
  return nearest;
};

/**
 * Deterministic kerb parking for maps that do not carry an authored table.
 *
 * Candidates walk the real road centrelines, face the nearest legal lane and
 * are rejected at junctions, controls, other carriageways, water, buildings,
 * parks, rail corridors, POI lots and hand-placed furniture. This is a vehicle
 * placement pass rather than ordinary roadside scatter: its heading and full
 * 13 m slot clearance are part of whether a car plausibly fits.
 *
 * London's established hand-authored placements remain authoritative and are
 * returned unchanged. Additional occupied points are normally the derived
 * regulatory signs, which are only known inside the render setup.
 */
export function parkedCarsForMap(
  mapPack: GameCanvasMapPack,
  additionalOccupiedPoints: readonly GameCanvasPoint[] = [],
): readonly ParkedCarPlacement[] {
  if (mapPack.id === "london-south-kensington") {
    return LONDON_PARKED_CARS;
  }
  const parkingProfile = generatedParkingProfile(mapPack.id);
  const elevatedRoadHeadroomAt = createElevatedRoadDeckHeadroomQuery(
    mapPack.geometry.roadSurfaces ?? [],
  );

  const surfaces = (mapPack.geometry.roadSurfaces ?? []).filter(
    (surface) =>
      surface.surfaceType === "standard" &&
      surface.centerline.length > 1 &&
      !isElevatedRoadSurface(surface),
  );
  if (!surfaces.length) return [];

  const random = seededUnit(hashStringToSeed(`${mapPack.id}-parked-cars`));
  const keepOuts = roadsidePropKeepOuts(mapPack);
  const forbiddenRects: PropScatterRect[] = [
    ...mapPack.geometry.blocks.map((block) => ({
      center: block.center,
      size: block.size,
      headingDeg: block.headingDeg,
    })),
    ...mapPack.geometry.landmarks
      .filter((landmark) => landmark.kind !== "bridge")
      .map((landmark) => ({
        center: landmark.center,
        size: landmark.size,
        headingDeg: landmark.headingDeg,
      })),
    ...keepOuts.hardRects,
    ...keepOuts.roadCrossedRects,
  ];
  const laneEndpoints = mapPack.laneGraph.lanes.flatMap((lane) => {
    const first = lane.centerline[0];
    const last = lane.centerline[lane.centerline.length - 1];
    return first && last ? [first, last] : [];
  });
  const controlPoints = mapPack.laneGraph.controls.flatMap((control) => [
    control.position,
    ...(control.installations ?? []).map((installation) => installation.position),
  ]);
  const occupiedPoints = [
    ...(mapPack.id === "tokyo-setagaya" ? TOKYO_STREET_FURNITURE_POINTS : []),
    ...additionalOccupiedPoints,
  ];
  const waterPolygons = (mapPack.geometry.waterBodies ?? []).map(
    (body) => body.polygon,
  );
  const halfWorldX = mapPack.geometry.worldSize.x / 2 - WORLD_EDGE_MARGIN_M;
  const halfWorldZ = mapPack.geometry.worldSize.z / 2 - WORLD_EDGE_MARGIN_M;
  const placements: ParkedCarPlacement[] = [];

  for (const surface of surfaces) {
    const lanes = mapPack.laneGraph.lanes.filter(
      (lane) =>
        surface.laneIds.includes(lane.id) ||
        (lane.roadId !== undefined && lane.roadId === surface.id),
    );
    if (!lanes.length) continue;

    let travelled = 0;
    let nextAt = JUNCTION_CLEARANCE_M + random() * SLOT_SPACING_M;
    let serial = 0;
    for (
      let segmentIndex = 0;
      segmentIndex < surface.centerline.length - 1;
      segmentIndex += 1
    ) {
      const start = surface.centerline[segmentIndex];
      const end = surface.centerline[segmentIndex + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const segmentLength = Math.hypot(dx, dz);
      if (segmentLength < 1e-6) continue;
      const tangentX = dx / segmentLength;
      const tangentZ = dz / segmentLength;

      while (nextAt <= travelled + segmentLength) {
        const along = nextAt - travelled;
        const base = {
          x: start.x + tangentX * along,
          z: start.z + tangentZ * along,
        };
        for (const side of [1, -1] as const) {
          const shouldKeep = random() < parkingProfile.keepRate;
          const model = MODEL_POOL[Math.floor(random() * MODEL_POOL.length)];
          if (!shouldKeep) continue;
          const lateral = surface.widthM / 2 + CAR_CENTER_PAST_KERB_M;
          const candidate = {
            x: base.x + tangentZ * side * lateral,
            z: base.z - tangentX * side * lateral,
          };
          const lanePose = nearestLanePose(candidate, lanes);
          if (!lanePose) continue;
          const deck = elevatedRoadHeadroomAt(
            candidate,
            0,
            PARKED_CAR_DECK_FOOTPRINT_RADIUS_M,
          );
          const clear =
            (!deck ||
              deck.headroomM >= PARKED_CAR_REQUIRED_HEADROOM_M[model]) &&
            Math.abs(candidate.x) <= halfWorldX &&
            Math.abs(candidate.z) <= halfWorldZ &&
            laneEndpoints.every(
              (endpoint) => distance(candidate, endpoint) >= JUNCTION_CLEARANCE_M,
            ) &&
            controlPoints.every(
              (control) => distance(candidate, control) >= CONTROL_CLEARANCE_M,
            ) &&
            occupiedPoints.every(
              (occupied) => distance(candidate, occupied) >= OCCUPIED_CLEARANCE_M,
            ) &&
            placements.every(
              (placement) =>
                distance(candidate, placement.position) >= CAR_SPACING_M,
            ) &&
            forbiddenRects.every(
              (rect) => !inflatedRectContains(candidate, rect, RECT_CLEARANCE_M),
            ) &&
            waterPolygons.every(
              (polygon) => !pointInPolygon(candidate, polygon),
            ) &&
            surfaces.every(
              (other) =>
                other.id === surface.id ||
                distanceToPolylineM(candidate, other.centerline) >=
                  other.widthM / 2 + FOREIGN_ROAD_CLEARANCE_M,
            );
          if (!clear) continue;
          serial += 1;
          placements.push({
            id: `${mapPack.id}-parked-${surface.id}-${serial}`,
            position: candidate,
            headingDeg: (lanePose.headingDeg + 360) % 360,
            model,
          });
        }
        nextAt += Math.max(
          16,
          SLOT_SPACING_M + (random() - 0.5) * 2 * SLOT_JITTER_M,
        );
      }
      travelled += segmentLength;
    }
  }
  return placements;
}
