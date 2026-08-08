import type {
  NpcVehicleVariant,
  SimulationBoxJunctionDefinition,
  SimulationCoreConfig,
  SimulationLane,
  SimulationPoint,
  SimulationTrafficGate,
  StopLineDefinition,
  TrafficLightDefinition,
  TrafficLightSequence,
} from "./simulation";
import type { StaticObstacle, StaticObstacleTag } from "./types";

// Re-exported for the same reason `servicePoints` re-exports `ServicePointKind`:
// `GameCanvas` reads the obstacles this module builds, and otherwise keeps clear
// of `./types` in favour of local structural types. One definition, reachable
// from both rings — a hand copy over there would be free to drift from the
// obstacles it is meant to describe.
export type { StaticObstacle, StaticObstacleTag };
import type {
  DriveScenario,
  GameCanvasLane,
  GameCanvasMapPack,
  SpeedUnit,
  TrafficSide,
} from "./sessionContract";
import {
  defaultSidewalkWidthM,
  resolveMapVisualPalette,
} from "./visuals";
import {
  resolveSimulationLaneAnchor,
  type ResolvedSimulationAnchor,
} from "./laneAnchors";
import {
  resolveServicePointLot,
  SERVICE_LOT_HALF_M,
  SERVICE_MODEL_FRAME,
  type ServicePointKind,
} from "./servicePoints";
import { parkLayoutForLandmark } from "./parkLayouts";
import { GAS_STATION_SOLIDS_M, PROP_MODEL_FOOTPRINTS_M } from "./propFootprints";
import { REPAIR_SHOP_SOLIDS_M } from "./repairShopLayout";
import {
  BRIDGE_PARAPET_HALF_DEPTH_M,
  BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M,
  bridgePortalRailSpans,
} from "./bridgePortalGeometry";

const DEFAULT_LANE_WIDTH_M = 3.5;
// The car's top speed models a real vehicle, not a governor pinned to the
// posted limit. It tops out at a clean round number in each country's own unit
// — 70 mph where speeds read in mph, 113 km/h (its equivalent) where they read
// in km/h — leaving generous headroom above every urban route so a driver can
// physically exceed the limit. Going over is reported as speeding, never
// silently prevented.
const MAX_FORWARD_SPEED_MPS_MPH = 70 / 2.236936; // 70 mph ≈ 31.29 m/s
const MAX_FORWARD_SPEED_MPS_KMH = 113 / 3.6; // 113 km/h ≈ 31.39 m/s (~70 mph)
const DEFAULT_MAX_REVERSE_SPEED_MPS = 6;

export interface SimulationAdapterOptions {
  readonly scenario: DriveScenario;
  readonly mapPack: GameCanvasMapPack;
  readonly trafficSide: TrafficSide;
  readonly speedUnit: SpeedUnit;
  readonly touchFirst?: boolean;
}

const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

const speedToMetresPerSecond = (
  speed: number,
  speedUnit: SpeedUnit,
): number => (speedUnit === "mph" ? speed / 2.236936 : speed / 3.6);

const laneLength = (lane: GameCanvasLane): number =>
  lane.centerline.slice(1).reduce(
    (total, point, index) =>
      total +
      Math.hypot(
        point.x - lane.centerline[index].x,
        point.z - lane.centerline[index].z,
      ),
    0,
  );

// Moved to its own leaf module so servicePoints (and anything else placement
// math depends on) can share it without importing this adapter; re-exported
// here so existing importers keep working.
export {
  resolveSimulationLaneAnchor,
  type ResolvedSimulationAnchor,
} from "./laneAnchors";

export function resolveSimulationStartPose(
  scenario: DriveScenario,
  mapPack: GameCanvasMapPack,
): ResolvedSimulationAnchor {
  if (!scenario) {
    throw new Error("A drive scenario is required to resolve the authored start.");
  }
  if (!mapPack) {
    throw new Error(
      `Drive scenario "${scenario.id}" requires map data to resolve its authored start.`,
    );
  }
  const startSpawnId = scenario.startSpawnId?.trim();
  if (!startSpawnId) {
    throw new Error(
      `Drive scenario "${scenario.id}" is missing an authored start spawn id.`,
    );
  }
  const spawn = mapPack.laneGraph.spawnPoints.find(
    (candidate) => candidate.id === startSpawnId,
  );
  if (!spawn) {
    throw new Error(
      `Drive scenario "${scenario.id}" references missing start spawn "${startSpawnId}" in map "${mapPack.id}".`,
    );
  }
  if (spawn.kind !== "player") {
    throw new Error(
      `Drive scenario "${scenario.id}" start spawn "${startSpawnId}" in map "${mapPack.id}" is not a player spawn.`,
    );
  }
  const anchor = "anchor" in spawn ? spawn.anchor : undefined;
  if (!anchor) {
    throw new Error(
      `Player start spawn "${startSpawnId}" in map "${mapPack.id}" does not define a lane anchor.`,
    );
  }
  if (!anchor.laneId?.trim() || !Number.isFinite(anchor.distanceAlongM)) {
    throw new Error(
      `Player start spawn "${startSpawnId}" in map "${mapPack.id}" has an invalid lane anchor.`,
    );
  }
  const lane = mapPack.laneGraph.lanes.find(
    (candidate) => candidate.id === anchor.laneId,
  );
  if (!lane) {
    throw new Error(
      `Player start spawn "${startSpawnId}" in map "${mapPack.id}" references missing lane "${anchor.laneId}".`,
    );
  }
  if (
    lane.centerline.length < 2 ||
    lane.centerline.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.z),
    )
  ) {
    throw new Error(
      `Player start spawn "${startSpawnId}" in map "${mapPack.id}" references invalid lane "${lane.id}".`,
    );
  }
  const distanceAlongM = anchor.distanceAlongM;
  const authoredLaneLength = laneLength(lane);
  if (distanceAlongM < 0 || distanceAlongM > authoredLaneLength) {
    throw new Error(
      `Player start spawn "${startSpawnId}" in map "${mapPack.id}" has invalid anchor distance ${distanceAlongM} on lane "${lane.id}".`,
    );
  }
  const resolved = resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, anchor);
  if (!resolved) {
    throw new Error(
      `Could not resolve authored start anchor for player spawn "${startSpawnId}" on lane "${lane.id}" in map "${mapPack.id}".`,
    );
  }
  return resolved;
}

function coreLaneRole(role: string | undefined): SimulationLane["role"] {
  if (role === "passing" || role === "entry" || role === "exit") return role;
  return "travel";
}

function coreLaneKind(role: string | undefined, laneId: string): SimulationLane["kind"] {
  if (role === "roundabout") return "roundabout";
  if (role === "entry" || laneId.toLowerCase().includes("merge")) return "merge";
  return "road";
}

const wrappedAngleDifference = (left: number, right: number): number => {
  let difference = (left - right) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

function adjacentLaneIdForSimulation(
  lane: GameCanvasLane,
  lanesById: ReadonlyMap<string, GameCanvasLane>,
): string | undefined {
  const sourceMidpoint = resolveSimulationLaneAnchor(
    [lane],
    { laneId: lane.id, distanceAlongM: laneLength(lane) / 2 },
  );
  if (!sourceMidpoint) return undefined;
  return (lane.adjacentLaneIds ?? [])
    .flatMap((candidateId) => {
      const candidate = lanesById.get(candidateId);
      if (!candidate) return [];
      if (lane.roadId && candidate.roadId && lane.roadId !== candidate.roadId) {
        return [];
      }
      if (
        lane.trafficSide &&
        candidate.trafficSide &&
        lane.trafficSide !== candidate.trafficSide
      ) {
        return [];
      }
      const candidateMidpoint = resolveSimulationLaneAnchor(
        [candidate],
        { laneId: candidate.id, distanceAlongM: laneLength(candidate) / 2 },
      );
      if (!candidateMidpoint) return [];
      const headingDifference = Math.abs(
        wrappedAngleDifference(sourceMidpoint.heading, candidateMidpoint.heading),
      );
      const separation = Math.hypot(
        sourceMidpoint.x - candidateMidpoint.x,
        sourceMidpoint.z - candidateMidpoint.z,
      );
      if (headingDifference > Math.PI / 4 || separation < 1.5 || separation > 9) {
        return [];
      }
      return [{ id: candidate.id, separation }];
    })
    .sort((left, right) => left.separation - right.separation)[0]?.id;
}

function projectDistanceAlongLane(
  lane: GameCanvasLane,
  point: SimulationPoint,
): number | null {
  if (lane.centerline.length < 2) return null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDistanceAlong = 0;
  let accumulated = 0;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const amount = Math.min(
      1,
      Math.max(0, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length)),
    );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDistanceAlong = accumulated + length * amount;
    }
    accumulated += length;
  }
  return Number.isFinite(bestDistance) ? bestDistanceAlong : null;
}

function inferVehicleVariant(spawnId: string): NpcVehicleVariant | undefined {
  const value = spawnId.toLowerCase();
  if (value.includes("police") || value.includes("patrol")) return "police";
  if (value.includes("bus")) return "bus";
  if (value.includes("taxi") || value.includes("cab")) return "taxi";
  if (value.includes("van") || value.includes("shuttle")) return "van";
  return undefined;
}

function buildTrafficLights(
  mapPack: GameCanvasMapPack,
): {
  readonly lights: TrafficLightDefinition[];
  readonly stopLines: StopLineDefinition[];
} {
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const lights: TrafficLightDefinition[] = [];
  const stopLines: StopLineDefinition[] = [];
  for (const control of mapPack.laneGraph.controls) {
    if (control.type !== "signal" && control.type !== "railway_signal") continue;
    const isRailway = control.type === "railway_signal";
    const approaches = control.approaches?.length
      ? control.approaches
      : control.laneIds.flatMap((laneId, index) => {
          const lane = lanesById.get(laneId);
          const distance = lane
            ? projectDistanceAlongLane(lane, control.position)
            : null;
          return distance === null
            ? []
            : [{
                id: `${control.id}-approach-${index + 1}`,
                laneIds: [laneId],
                stopLine: { laneId, distanceAlongM: distance },
                phaseGroup: `${control.id}-${index + 1}`,
              }];
        });
    const phaseGroups = Array.from(
      new Set(approaches.map((approach) => approach.phaseGroup)),
    ).sort();
    const usesUkSequence = !isRailway && (control.installations ?? []).some(
      (installation) => installation.style === "uk_signal",
    );
    const sequence: TrafficLightSequence = usesUkSequence ? "uk" : "standard";
    const greenSeconds = isRailway ? 8 : 7;
    const amberSeconds = isRailway ? 0.8 : usesUkSequence ? 3 : 2;
    const allRedSeconds = isRailway ? 0.2 : 1;
    const redAmberSeconds = usesUkSequence ? 1.5 : 0;
    const slotSeconds = greenSeconds + amberSeconds + allRedSeconds;
    const slotCount = isRailway ? 2 : Math.max(2, phaseGroups.length);
    const durationSeconds = slotSeconds * slotCount;
    const redSeconds =
      (slotCount - 1) * slotSeconds - redAmberSeconds;
    const groupOffset = new Map(
      phaseGroups.map((group, index) => [
        group,
        (durationSeconds - index * slotSeconds) % durationSeconds,
      ]),
    );
    for (const approach of approaches) {
      const stopPose = resolveSimulationLaneAnchor(
        mapPack.laneGraph.lanes,
        approach.stopLine,
      );
      if (!stopPose) continue;
      lights.push({
        id: approach.id,
        phaseGroup: approach.phaseGroup,
        x: stopPose.x,
        z: stopPose.z,
        cycle: {
          greenSeconds,
          amberSeconds,
          allRedSeconds,
          redSeconds,
          redAmberSeconds,
          sequence,
          offsetSeconds: groupOffset.get(approach.phaseGroup) ?? 0,
        },
      });
      for (const laneId of approach.laneIds) {
        if (!lanesById.has(laneId)) continue;
        stopLines.push({
          id: `${approach.id}-${laneId}-line`,
          laneId,
          distance: approach.stopLine.distanceAlongM,
          kind: isRailway ? "railway" : "traffic_light",
          trafficLightId: approach.id,
        });
      }
    }
  }
  return { lights, stopLines };
}

function buildStopAndYieldLines(
  mapPack: GameCanvasMapPack,
): StopLineDefinition[] {
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const result: StopLineDefinition[] = [];
  for (const control of mapPack.laneGraph.controls) {
    if (control.type !== "stop" && control.type !== "yield") continue;
    const kind = control.type;
    const approaches = control.approaches?.length
      ? control.approaches
      : control.laneIds.flatMap((laneId, index) => {
          const lane = lanesById.get(laneId);
          const distance = lane
            ? projectDistanceAlongLane(lane, control.position)
            : null;
          return distance === null
            ? []
            : [{
                id: `${control.id}-approach-${index + 1}`,
                laneIds: [laneId],
                stopLine: { laneId, distanceAlongM: distance },
              }];
        });
    for (const approach of approaches) {
      for (const laneId of approach.laneIds) {
        if (!lanesById.has(laneId)) continue;
        result.push({
          id: `${approach.id}-${laneId}-line`,
          laneId,
          distance: approach.stopLine.distanceAlongM,
          kind,
          conflictRadius: kind === "yield" ? 14 : undefined,
        });
      }
    }
  }
  return result;
}

function buildBoxJunctions(
  mapPack: GameCanvasMapPack,
): SimulationBoxJunctionDefinition[] {
  const zonesById = new Map(
    mapPack.laneGraph.conflictZones.map((zone) => [zone.id, zone]),
  );
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  return mapPack.laneGraph.controls.flatMap((control) => {
    if (control.type !== "box_junction") return [];
    return (control.conflictZoneIds ?? []).flatMap((zoneId) => {
      const zone = zonesById.get(zoneId);
      if (!zone) return [];
      const laneIds = Array.from(new Set([...control.laneIds, ...zone.laneIds]));
      const exitLaneIds = Array.from(
        new Set(
          laneIds.flatMap((laneId) => lanesById.get(laneId)?.successors ?? []),
        ),
      );
      return [{
        id: `${control.id}-${zone.id}`,
        polygon: zone.polygon,
        laneIds,
        exitLaneIds: exitLaneIds.length ? exitLaneIds : laneIds,
        exitClearanceM: 12,
      }];
    });
  });
}

/** End-to-end unit direction of a lane, used to split a carriageway's lanes
 * into their two opposing travel directions. */
function laneForwardDirection(
  lane: GameCanvasLane,
): { readonly x: number; readonly z: number } | null {
  const start = lane.centerline[0];
  const end = lane.centerline.at(-1);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  return length > 0.01 ? { x: dx / length, z: dz / length } : null;
}

const DENSITY_COUNTS = { none: 0, light: 6, moderate: 12, busy: 18 } as const;
/** A phone pays much more per car, so the bands are capped there. */
const TOUCH_DENSITY_CAP = 12;

/**
 * How many ambient cars a drive runs.
 *
 * The simulation and the renderer each allocate against this — sim NPCs and
 * render slots have to agree or cars drive around with nothing drawn on them —
 * and the table used to be written out in both files. One copy, and a map may
 * override the band outright when its size makes the band wrong.
 */
export function resolveAmbientVehicleCount(
  mapPack: {
    readonly ambientTraffic?: { readonly desktop: number; readonly touch: number };
  },
  density: keyof typeof DENSITY_COUNTS,
  touchFirst: boolean,
): number {
  const override = mapPack.ambientTraffic;
  if (override) return touchFirst ? override.touch : override.desktop;
  const configured = DENSITY_COUNTS[density];
  return touchFirst ? Math.min(TOUCH_DENSITY_CAP, configured) : configured;
}

/** Arclength fractions for the supplemental oncoming gates on a two-way road. */
const ONCOMING_GATE_FRACTIONS = [0.72, 0.28] as const;

function buildTrafficGates(
  mapPack: GameCanvasMapPack,
): SimulationTrafficGate[] {
  const lanes = mapPack.laneGraph.lanes;
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const laneIds = new Set(lanes.map((lane) => lane.id));

  const authoredGates: SimulationTrafficGate[] = mapPack.laneGraph.spawnPoints.flatMap((spawn) => {
    if (spawn.kind !== "vehicle") return [];
    const { anchor } = spawn;
    if (!laneIds.has(anchor.laneId)) return [];
    return [{
      id: spawn.id,
      laneId: anchor.laneId,
      distance: anchor.distanceAlongM,
      variant: inferVehicleVariant(spawn.id),
    }];
  });

  // Give every TWO-WAY road oncoming traffic. Authored vehicle spawns only ever
  // sit on same-direction lanes, so without this the player never meets a car
  // coming the other way — the whole point of the game. For each carriageway
  // whose lanes split into two opposing directions, make sure each direction
  // carries a gate; these supplemental gates defer their first spawn
  // (allowInitialSpawn:false), so a parked player is never boxed in and only
  // meets oncoming cars once under way. Fully deterministic (fixed lane order +
  // fractions) so the traffic-safety replay stays reproducible.
  const gatedLaneIds = new Set(authoredGates.map((gate) => gate.laneId));
  const supplementalGates: SimulationTrafficGate[] = [];
  for (const surface of mapPack.geometry.roadSurfaces ?? []) {
    const surfaceLanes = surface.laneIds
      .map((id) => laneById.get(id))
      .filter((lane): lane is GameCanvasLane => Boolean(lane));
    const reference = surfaceLanes.map(laneForwardDirection).find(Boolean);
    if (!reference) continue;
    const forward: GameCanvasLane[] = [];
    const backward: GameCanvasLane[] = [];
    for (const lane of surfaceLanes) {
      const direction = laneForwardDirection(lane);
      if (!direction) continue;
      const aligned = direction.x * reference.x + direction.z * reference.z >= 0;
      (aligned ? forward : backward).push(lane);
    }
    if (!forward.length || !backward.length) continue; // one-way carriageway
    for (const group of [forward, backward]) {
      if (group.some((lane) => gatedLaneIds.has(lane.id))) continue;
      const target = group.reduce((longest, lane) =>
        laneLength(lane) > laneLength(longest) ? lane : longest,
      );
      const length = laneLength(target);
      for (const fraction of ONCOMING_GATE_FRACTIONS) {
        supplementalGates.push({
          id: `oncoming-${target.id}-${Math.round(fraction * 100)}`,
          laneId: target.id,
          distance: length * fraction,
          allowInitialSpawn: false,
        });
      }
      gatedLaneIds.add(target.id);
    }
  }
  return [...authoredGates, ...supplementalGates];
}

/** Venue buildings sit this far off their anchor lane unless tuned per site. */
const DEFAULT_VENUE_SETBACK_M = 13;
/** World-edge fences stand this far beyond the sim bounds, so the
 * out-of-bounds warning still fires on the grass before the car stops. */
const WORLD_EDGE_STANDOFF_M = 8;
const WORLD_EDGE_THICKNESS_M = 6;

interface AxisRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** base minus cut, as up to four axis-aligned remainders; slivers under half
 * a metre are dropped (nothing drivable fits in them anyway). */
function subtractRect(base: AxisRect, cut: AxisRect): AxisRect[] {
  const overlapMinX = Math.max(base.minX, cut.minX);
  const overlapMaxX = Math.min(base.maxX, cut.maxX);
  const overlapMinZ = Math.max(base.minZ, cut.minZ);
  const overlapMaxZ = Math.min(base.maxZ, cut.maxZ);
  if (overlapMinX >= overlapMaxX || overlapMinZ >= overlapMaxZ) return [base];
  const pieces: AxisRect[] = [
    { minX: base.minX, maxX: base.maxX, minZ: overlapMaxZ, maxZ: base.maxZ },
    { minX: base.minX, maxX: base.maxX, minZ: base.minZ, maxZ: overlapMinZ },
    { minX: base.minX, maxX: overlapMinX, minZ: overlapMinZ, maxZ: overlapMaxZ },
    { minX: overlapMaxX, maxX: base.maxX, minZ: overlapMinZ, maxZ: overlapMaxZ },
  ];
  return pieces.filter(
    (piece) => piece.maxX - piece.minX > 0.5 && piece.maxZ - piece.minZ > 0.5,
  );
}

function sidewalkWidthForSurface(
  mapPack: GameCanvasMapPack,
  surface: NonNullable<
    GameCanvasMapPack["geometry"]["roadSurfaces"]
  >[number],
): number {
  if (surface.sidewalkWidthM !== undefined) {
    return Math.max(0, surface.sidewalkWidthM);
  }
  return defaultSidewalkWidthM(mapPack);
}

type VenueLike = NonNullable<
  GameCanvasMapPack["geometry"]["gigVenues"]
>[number];

/**
 * Distance from an anchor pose to the outer edge of the walkable pavement
 * band along its road, measured along the given right normal. Null when the
 * lane belongs to no authored road surface.
 */
function pavementOuterFromPose(
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

/** Clearance kept between the pavement's outer edge and a building front. */
const VENUE_PAVEMENT_GAP_M = 0.4;

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

/**
 * The solid, movement-blocking world the core resolves the player car against.
 * Sources are exactly the authored map-pack fields the renderer builds visuals
 * from, so a wall stands wherever something is drawn:
 *
 * - blocks -> their full rect (the street wall / facade grid hugs the edges;
 *   interiors and the 1.6 m building gaps are narrower than the car anyway).
 *   London museum blocks mirror the renderer's two-wing layout instead, and
 *   service-point lots (both kinds) are carved out of any block rect they
 *   overlap so the forecourt or bay entrance is open ground.
 * - building-like landmarks (station/terminal/shops as drawn boxes, tower as
 *   its cylinder) -> solid; parks keep only their centre feature tree; railway
 *   rails and roundabout-island pads stay drivable.
 * - gig venues -> the measured footprint of the actual placed model (falling
 *   back to the authored footprint box, clamped off the pavement, for kinds
 *   without a measured model) at the shared resolveVenuePlacement position.
 * - gas stations -> the lot slab stays drivable, but the shop building and
 *   the two pump islands (pumps + kerb + canopy pillars) are solid.
 * - repair shops -> the bay floor and its apron stay drivable; the flank, the
 *   back wall and the office block are solid. Leaving the mouth open is what
 *   makes the bay a bay rather than a sealed box.
 * - world edges -> fences just outside the bounds.
 */
export function buildStaticObstacles(
  mapPack: GameCanvasMapPack,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): StaticObstacle[] {
  const obstacles: StaticObstacle[] = [];
  const london = mapPack.id.includes("london");

  // Gas-station lots (the full base slab plus a margin) are carved out of any
  // block rect they overlap: the visual street wall is already excluded from
  // the lot, and leaving the block collider there walled off the forecourt.
  // Both kinds carve — a repair shop walled off by its own block rect would be
  // a garage you cannot drive into — but each carves its own size.
  const serviceLots: {
    kind: ServicePointKind;
    lot: { x: number; z: number; yaw: number };
    carve: AxisRect;
  }[] = [];
  for (const service of mapPack.geometry.servicePoints ?? []) {
    const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
    if (!lot) continue;
    const spanM =
      SERVICE_LOT_HALF_M[service.kind] *
      (Math.abs(Math.cos(lot.yaw)) + Math.abs(Math.sin(lot.yaw)));
    serviceLots.push({
      kind: service.kind,
      lot,
      carve: {
        minX: lot.x - spanM - 1,
        maxX: lot.x + spanM + 1,
        minZ: lot.z - spanM - 1,
        maxZ: lot.z + spanM + 1,
      },
    });
  }
  const pushBlockRect = (id: string, rect: AxisRect) => {
    let pieces = [rect];
    for (const { carve } of serviceLots) {
      pieces = pieces.flatMap((piece) => subtractRect(piece, carve));
    }
    for (const [index, piece] of pieces.entries()) {
      obstacles.push({
        kind: "aabb",
        id: pieces.length === 1 ? id : `${id}-part-${index}`,
        tag: "building",
        ...piece,
      });
    }
  };
  const pushRotatedBlock = (
    id: string,
    block: GameCanvasMapPack["geometry"]["blocks"][number],
  ) => {
    const yaw = degreesToRadians(block.headingDeg ?? 0);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let pieces: AxisRect[] = [
      {
        minX: -block.size.x / 2,
        maxX: block.size.x / 2,
        minZ: -block.size.z / 2,
        maxZ: block.size.z / 2,
      },
    ];
    // Service lots are axis-aligned broad-phase boxes. Project their corners
    // into block-local space and carve the conservative local AABB; the visual
    // renderer uses the same lot keep-outs, so this errs toward open forecourt.
    for (const { carve } of serviceLots) {
      const corners = [
        [carve.minX, carve.minZ],
        [carve.minX, carve.maxZ],
        [carve.maxX, carve.minZ],
        [carve.maxX, carve.maxZ],
      ] as const;
      const local = corners.map(([x, z]) => {
        const dx = x - block.center.x;
        const dz = z - block.center.z;
        return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
      });
      const cut: AxisRect = {
        minX: Math.min(...local.map((point) => point.x)),
        maxX: Math.max(...local.map((point) => point.x)),
        minZ: Math.min(...local.map((point) => point.z)),
        maxZ: Math.max(...local.map((point) => point.z)),
      };
      pieces = pieces.flatMap((piece) => subtractRect(piece, cut));
    }
    for (const [index, piece] of pieces.entries()) {
      const localX = (piece.minX + piece.maxX) / 2;
      const localZ = (piece.minZ + piece.maxZ) / 2;
      obstacles.push({
        kind: "obb",
        id: pieces.length === 1 ? id : `${id}-part-${index}`,
        tag: "building",
        x: block.center.x + localX * cos + localZ * sin,
        z: block.center.z - localX * sin + localZ * cos,
        ux: cos,
        uz: -sin,
        halfU: (piece.maxX - piece.minX) / 2,
        halfV: (piece.maxZ - piece.minZ) / 2,
      });
    }
  };

  for (const block of mapPack.geometry.blocks) {
    if (london && block.material.endsWith("-museum")) {
      // Mirrors the renderer's two-wing museum layout (GameCanvas
      // buildEnvironment): the central forecourt between the wings is open
      // ground the car can legitimately roll onto.
      const wingWidth = Math.max(12, block.size.x * 0.23);
      const wingDepth = block.size.z * 0.82;
      for (const side of [-1, 1]) {
        const wingX = block.center.x + side * block.size.x * 0.37;
        pushBlockRect(`${block.id}-wing-${side}`, {
          minX: wingX - wingWidth / 2,
          maxX: wingX + wingWidth / 2,
          minZ: block.center.z - wingDepth / 2,
          maxZ: block.center.z + wingDepth / 2,
        });
      }
      continue;
    }
    if (Math.abs(block.headingDeg ?? 0) > 1e-6) {
      pushRotatedBlock(block.id, block);
      continue;
    }
    pushBlockRect(block.id, {
      minX: block.center.x - block.size.x / 2,
      maxX: block.center.x + block.size.x / 2,
      minZ: block.center.z - block.size.z / 2,
      maxZ: block.center.z + block.size.z / 2,
    });
  }

  const portalIntervalOnShoreEdge = (
    edgeFrom: { readonly x: number; readonly z: number },
    edgeTo: { readonly x: number; readonly z: number },
    roadFrom: { readonly x: number; readonly z: number },
    roadTo: { readonly x: number; readonly z: number },
    halfWidthM: number,
  ): { start: number; end: number } | null => {
    const roadX = roadTo.x - roadFrom.x;
    const roadZ = roadTo.z - roadFrom.z;
    const roadLength = Math.hypot(roadX, roadZ);
    if (roadLength < 1e-8) return null;
    const ux = roadX / roadLength;
    const uz = roadZ / roadLength;
    const vx = uz;
    const vz = -ux;
    const local = (point: { readonly x: number; readonly z: number }) => {
      const dx = point.x - roadFrom.x;
      const dz = point.z - roadFrom.z;
      return { u: dx * ux + dz * uz, v: dx * vx + dz * vz };
    };
    const startLocal = local(edgeFrom);
    const endLocal = local(edgeTo);
    let low = 0;
    let high = 1;
    const clipAxis = (
      start: number,
      end: number,
      minimum: number,
      maximum: number,
    ): boolean => {
      const delta = end - start;
      if (Math.abs(delta) < 1e-9) {
        return start >= minimum && start <= maximum;
      }
      const first = (minimum - start) / delta;
      const second = (maximum - start) / delta;
      low = Math.max(low, Math.min(first, second));
      high = Math.min(high, Math.max(first, second));
      return low <= high;
    };
    if (!clipAxis(startLocal.u, endLocal.u, 0, roadLength)) return null;
    if (
      !clipAxis(
        startLocal.v,
        endLocal.v,
        -halfWidthM,
        halfWidthM,
      )
    ) {
      return null;
    }
    return { start: Math.max(0, low), end: Math.min(1, high) };
  };

  // River polygons are visual ground, not physics. Their shorelines become
  // thin OBB embankments. Only surfaces explicitly whitelisted by each body
  // may cut an opening: an unrelated or accidentally overlapping road can
  // never silently become a bridge. Whitelisted over-water spans receive
  // paired parapet OBBs, closing the former route off the side of a bridge and
  // onto the flat water material while leaving its travel corridor open.
  for (const water of mapPack.geometry.waterBodies ?? []) {
    if (water.polygon.length < 3) continue;
    const portalSurfaceIds = new Set(
      (
        water as typeof water & {
          readonly bridgePortalSurfaceIds?: readonly string[];
        }
      ).bridgePortalSurfaceIds ?? [],
    );
    const portalSurfaces = (mapPack.geometry.roadSurfaces ?? []).filter(
      (surface) => portalSurfaceIds.has(surface.id),
    );
    for (let edgeIndex = 0; edgeIndex < water.polygon.length; edgeIndex += 1) {
      const from = water.polygon[edgeIndex];
      const to = water.polygon[(edgeIndex + 1) % water.polygon.length];
      const edgeX = to.x - from.x;
      const edgeZ = to.z - from.z;
      const edgeLength = Math.hypot(edgeX, edgeZ);
      if (edgeLength < 1) continue;
      const openings: { start: number; end: number }[] = [];
      for (const surface of portalSurfaces) {
        for (let index = 0; index < surface.centerline.length - 1; index += 1) {
          const roadFrom = surface.centerline[index];
          const roadTo = surface.centerline[index + 1];
          const opening = portalIntervalOnShoreEdge(
            from,
            to,
            roadFrom,
            roadTo,
            surface.widthM / 2 +
              sidewalkWidthForSurface(mapPack, surface) +
              0.5,
          );
          if (opening === null) continue;
          // Account for the 0.75 m physical depth of the shoreline OBB itself,
          // so a cut remains open when the portal meets a polygon vertex.
          const edgePaddingT = 1.25 / edgeLength;
          openings.push({
            start: Math.max(0, opening.start - edgePaddingT),
            end: Math.min(1, opening.end + edgePaddingT),
          });
        }
      }
      openings.sort((left, right) => left.start - right.start);
      const merged: { start: number; end: number }[] = [];
      for (const opening of openings) {
        const previous = merged[merged.length - 1];
        if (previous && opening.start <= previous.end) {
          previous.end = Math.max(previous.end, opening.end);
        } else {
          merged.push({ ...opening });
        }
      }
      let cursor = 0;
      const solidRanges: { start: number; end: number }[] = [];
      for (const opening of merged) {
        if (opening.start - cursor > 2 / edgeLength) {
          solidRanges.push({ start: cursor, end: opening.start });
        }
        cursor = Math.max(cursor, opening.end);
      }
      if (1 - cursor > 2 / edgeLength) {
        solidRanges.push({ start: cursor, end: 1 });
      }
      const ux = edgeX / edgeLength;
      const uz = edgeZ / edgeLength;
      for (const [rangeIndex, range] of solidRanges.entries()) {
        const midpoint = (range.start + range.end) / 2;
        obstacles.push({
          kind: "obb",
          id: `${water.id}-shore-${edgeIndex}-${rangeIndex}`,
          tag: "shoreline",
          x: from.x + edgeX * midpoint,
          z: from.z + edgeZ * midpoint,
          ux,
          uz,
          halfU: (range.end - range.start) * edgeLength / 2,
          halfV: 0.75,
        });
      }
    }

    for (const surface of portalSurfaces) {
      for (const span of bridgePortalRailSpans(water, surface)) {
        const rightX = span.uz;
        const rightZ = -span.ux;
        const lateralOffset =
          surface.widthM / 2 +
          sidewalkWidthForSurface(mapPack, surface) +
          BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M;
        for (const side of [-1, 1] as const) {
          obstacles.push({
            kind: "obb",
            id: `${water.id}-portal-${surface.id}-${span.segmentIndex}-${span.intervalIndex}-${side < 0 ? "left" : "right"}`,
            tag: "shoreline",
            x: span.center.x + rightX * lateralOffset * side,
            z: span.center.z + rightZ * lateralOffset * side,
            ux: span.ux,
            uz: span.uz,
            halfU: span.halfLengthM,
            halfV: BRIDGE_PARAPET_HALF_DEPTH_M,
          });
        }
      }
    }
  }

  // Each service point's own solid furniture, placed with the exact transform
  // the renderer uses. A gas station's is its shop and two pump islands,
  // measured from the glb; a repair shop's is the three walls around its bay,
  // taken from the same constants that draw them. Both leave the ground the car
  // drives on (forecourt, bay floor) open — that is what makes them enterable.
  for (const [serviceIndex, { kind, lot }] of serviceLots.entries()) {
    const cos = Math.cos(lot.yaw - SERVICE_MODEL_FRAME[kind].yawOffset);
    const sin = Math.sin(lot.yaw - SERVICE_MODEL_FRAME[kind].yawOffset);
    const solids =
      kind === "gas_station" ? GAS_STATION_SOLIDS_M : REPAIR_SHOP_SOLIDS_M;
    const prefix = kind === "gas_station" ? "station" : "repair";
    for (const solid of solids) {
      const centerX = (solid.minX + solid.maxX) / 2;
      const centerZ = (solid.minZ + solid.maxZ) / 2;
      obstacles.push({
        kind: "obb",
        id: `${prefix}-${serviceIndex}-${solid.id}`,
        tag: "landmark",
        x: lot.x + centerX * cos + centerZ * sin,
        z: lot.z - centerX * sin + centerZ * cos,
        ux: cos,
        uz: -sin,
        halfU: (solid.maxX - solid.minX) / 2,
        halfV: (solid.maxZ - solid.minZ) / 2,
      });
    }
  }

  for (const landmark of mapPack.geometry.landmarks) {
    switch (landmark.kind) {
      case "park": {
        // The lawn stays drivable — it is the boundary that stops you, not the
        // grass. Openings are derived (see `parkPerimeterPlan`), so a park that
        // is too small, or whose edge a road runs along, simply gets no wall.
        //
        // The layout must be built with exactly the arguments the renderer
        // uses, or the wall you crash into and the wall you can see are two
        // different walls.
        const parkLayout = parkLayoutForLandmark(mapPack, landmark);
        for (const run of parkLayout.wall) {
          obstacles.push({
            kind: "obb",
            id: run.id,
            tag: "parkEdge",
            x: run.x,
            z: run.z,
            ux: run.ux,
            uz: run.uz,
            halfU: run.halfU,
            halfV: run.halfV,
          });
        }
        // Masonry a park carries: a torii's columns, a stone lantern, a
        // monument plinth. Circles rather than boxes, so they are exempt from
        // the walkable-pavement sweep the way every other small piece of street
        // furniture is — and so a torii stays drivable *through*, which is the
        // whole point of a gate.
        for (const feature of parkLayout.features) {
          if (!feature.solid) continue;
          if (feature.kind === "torii") {
            const half = feature.sizeX / 2;
            for (const side of [-1, 1] as const) {
              obstacles.push({
                kind: "circle",
                id: `${feature.id}-column-${side > 0 ? "r" : "l"}`,
                tag: "landmark",
                x: feature.x + Math.cos(feature.rotationY) * half * side,
                z: feature.z - Math.sin(feature.rotationY) * half * side,
                radius: 0.32,
              });
            }
            continue;
          }
          obstacles.push({
            kind: "circle",
            id: feature.id,
            tag: "landmark",
            x: feature.x,
            z: feature.z,
            radius: Math.max(feature.sizeX, feature.sizeZ) / 2,
          });
        }
        break;
      }
      case "tower":
        // Rendered as a cylinder of diameter max(4, size.x * 0.4).
        obstacles.push({
          kind: "circle",
          id: landmark.id,
          tag: "landmark",
          x: landmark.center.x,
          z: landmark.center.z,
          radius: Math.max(4, landmark.size.x * 0.4) / 2,
        });
        break;
      case "station":
      case "terminal":
      case "shops":
      case "museum":
      case "cultural":
        obstacles.push({
          kind: "aabb",
          id: landmark.id,
          tag: "landmark",
          minX: landmark.center.x - landmark.size.x / 2,
          maxX: landmark.center.x + landmark.size.x / 2,
          minZ: landmark.center.z - landmark.size.z / 2,
          maxZ: landmark.center.z + landmark.size.z / 2,
        });
        break;
      case "monument":
        obstacles.push({
          kind: "circle",
          id: landmark.id,
          tag: "landmark",
          x: landmark.center.x,
          z: landmark.center.z,
          radius: Math.max(1.2, Math.min(landmark.size.x, landmark.size.z) / 3),
        });
        break;
      default:
        // Railway tracks and scenic elevated bridges stay open at road level.
        break;
    }
  }

  for (const venue of mapPack.geometry.gigVenues ?? []) {
    const placement = resolveVenuePlacement(mapPack, venue);
    if (!placement) continue;
    const rightX = Math.cos(placement.heading);
    const rightZ = -Math.sin(placement.heading);
    const alongX = Math.sin(placement.heading);
    const alongZ = Math.cos(placement.heading);
    const footprint = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
    if (footprint) {
      // The collider is exactly the measured model box at the shared
      // placement: what stops the car is what the player can see.
      const depthCenter = (footprint.minX + footprint.maxX) / 2;
      const alongCenter = (footprint.minZ + footprint.maxZ) / 2;
      obstacles.push({
        kind: "obb",
        id: venue.id,
        tag: "venue",
        x: placement.x + rightX * depthCenter + alongX * alongCenter,
        z: placement.z + rightZ * depthCenter + alongZ * alongCenter,
        ux: alongX,
        uz: alongZ,
        halfU: (footprint.maxZ - footprint.minZ) / 2,
        halfV: (footprint.maxX - footprint.minX) / 2,
      });
      continue;
    }
    // No measured model (procedural fallback box): the authored footprint is
    // the visual, clamped so its road-side face never covers the pavement.
    let nearFace = placement.setbackM - venue.footprint.z / 2;
    const farFace = placement.setbackM + venue.footprint.z / 2;
    const pavementOuter = pavementOuterFromPose(
      mapPack,
      venue.anchor.laneId,
      { x: placement.anchorX, z: placement.anchorZ },
      rightX,
      rightZ,
    );
    if (pavementOuter !== null) {
      const minNearFace = pavementOuter + VENUE_PAVEMENT_GAP_M;
      if (nearFace < minNearFace) {
        // Never thin the lot below 3 m so the visible box stays solid.
        nearFace = Math.min(minNearFace, farFace - 3);
      }
    }
    obstacles.push({
      kind: "obb",
      id: venue.id,
      tag: "venue",
      x: placement.anchorX + rightX * ((nearFace + farFace) / 2),
      z: placement.anchorZ + rightZ * ((nearFace + farFace) / 2),
      ux: alongX,
      uz: alongZ,
      halfU: venue.footprint.x / 2,
      halfV: (farFace - nearFace) / 2,
    });
  }

  if (london) {
    // The cast-iron pillar box on Queen's Gate (GameCanvas
    // LONDON_POST_BOX_POSITION). Every other piece of street furniture is
    // knockable renderer-side; Royal Mail wins, so it is a solid here and the
    // renderer deliberately leaves it out of the destructible registry.
    obstacles.push({
      kind: "circle",
      id: "london-post-box",
      tag: "landmark",
      x: 122,
      z: 87,
      radius: 0.45,
    });
  }

  const fenceMinX = bounds.minX - WORLD_EDGE_STANDOFF_M;
  const fenceMaxX = bounds.maxX + WORLD_EDGE_STANDOFF_M;
  const fenceMinZ = bounds.minZ - WORLD_EDGE_STANDOFF_M;
  const fenceMaxZ = bounds.maxZ + WORLD_EDGE_STANDOFF_M;
  const edges: readonly (readonly [string, number, number, number, number])[] = [
    ["north", fenceMinX - WORLD_EDGE_THICKNESS_M, fenceMaxX + WORLD_EDGE_THICKNESS_M, fenceMaxZ, fenceMaxZ + WORLD_EDGE_THICKNESS_M],
    ["south", fenceMinX - WORLD_EDGE_THICKNESS_M, fenceMaxX + WORLD_EDGE_THICKNESS_M, fenceMinZ - WORLD_EDGE_THICKNESS_M, fenceMinZ],
    ["east", fenceMaxX, fenceMaxX + WORLD_EDGE_THICKNESS_M, fenceMinZ, fenceMaxZ],
    ["west", fenceMinX - WORLD_EDGE_THICKNESS_M, fenceMinX, fenceMinZ, fenceMaxZ],
  ];
  for (const [name, minX, maxX, minZ, maxZ] of edges) {
    obstacles.push({
      kind: "aabb",
      id: `world-edge-${name}`,
      tag: "worldEdge",
      minX,
      maxX,
      minZ,
      maxZ,
    });
  }

  return obstacles;
}

/**
 * Distance from a point to a solid obstacle's surface (0 when inside). Test
 * and tooling helper — the core keeps its own inlined version of this math in
 * its 60 Hz loop.
 */
export function distanceToStaticObstacle(
  obstacle: StaticObstacle,
  x: number,
  z: number,
): number {
  if (obstacle.kind === "circle") {
    return Math.max(
      0,
      Math.hypot(x - obstacle.x, z - obstacle.z) - obstacle.radius,
    );
  }
  if (obstacle.kind === "aabb") {
    const dx = Math.max(obstacle.minX - x, 0, x - obstacle.maxX);
    const dz = Math.max(obstacle.minZ - z, 0, z - obstacle.maxZ);
    return Math.hypot(dx, dz);
  }
  const axisLength = Math.hypot(obstacle.ux, obstacle.uz) || 1;
  const ux = obstacle.ux / axisLength;
  const uz = obstacle.uz / axisLength;
  const dx = x - obstacle.x;
  const dz = z - obstacle.z;
  const du = dx * ux + dz * uz;
  const dv = dx * uz - dz * ux;
  const su = Math.max(0, Math.abs(du) - obstacle.halfU);
  const sv = Math.max(0, Math.abs(dv) - obstacle.halfV);
  return Math.hypot(su, sv);
}

export function buildSimulationCoreConfig({
  scenario,
  mapPack,
  trafficSide,
  speedUnit,
  touchFirst = false,
}: SimulationAdapterOptions): SimulationCoreConfig {
  const normalizedSpeedUnit = speedUnit === "mph" ? "mph" : "kmh";
  const baseMaxForwardSpeedMps =
    normalizedSpeedUnit === "mph"
      ? MAX_FORWARD_SPEED_MPS_MPH
      : MAX_FORWARD_SPEED_MPS_KMH;

  const start = resolveSimulationStartPose(scenario, mapPack);
  const sourceLanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const lanes: SimulationLane[] = mapPack.laneGraph.lanes
    .filter((lane) => lane.centerline.length >= 2)
    .map((lane) => ({
      id: lane.id,
      points: lane.centerline,
      width: lane.widthM ?? DEFAULT_LANE_WIDTH_M,
      role: coreLaneRole(lane.role),
      kind: coreLaneKind(lane.role, lane.id),
      speedLimitMps: speedToMetresPerSecond(
        lane.speedLimit ??
          ((lane.localSpeedUnit ?? speedUnit) === "mph" ? 30 : 50),
        lane.localSpeedUnit ?? speedUnit,
      ),
      adjacentLaneId: adjacentLaneIdForSimulation(lane, sourceLanesById),
      successorLaneIds: lane.successors ?? [],
      loop: false,
    }));
  const traffic = buildTrafficLights(mapPack);
  const stopLines = [
    ...traffic.stopLines,
    ...buildStopAndYieldLines(mapPack),
  ];
  const npcCount = resolveAmbientVehicleCount(
    mapPack,
    scenario.trafficDensity,
    touchFirst,
  );
  const restrictions = mapPack.laneGraph.restrictions ?? [];
  const boundsPadding = Math.max(2, mapPack.geometry.shoulderWidth ?? 0);
  const bounds = {
    minX: -mapPack.geometry.worldSize.x / 2 - boundsPadding,
    maxX: mapPack.geometry.worldSize.x / 2 + boundsPadding,
    minZ: -mapPack.geometry.worldSize.z / 2 - boundsPadding,
    maxZ: mapPack.geometry.worldSize.z / 2 + boundsPadding,
  };
  return {
    trafficSide,
    speedUnit: normalizedSpeedUnit,
    seed: scenario.trafficSeed,
    scenarioId: scenario.id,
    lanes,
    bounds,
    staticObstacles: buildStaticObstacles(mapPack, bounds),
    spawn: { x: start.x, z: start.z, heading: start.heading },
    trafficLights: traffic.lights,
    stopLines,
    trafficGates: buildTrafficGates(mapPack),
    minRuntimeSpawnDistanceM: 70,
    scenarioClock: scenario.scenarioClock,
    laneRestrictions: restrictions,
    boxJunctions: buildBoxJunctions(mapPack),
    npcCount,
    maxForwardSpeedMps: baseMaxForwardSpeedMps,
    maxReverseSpeedMps: DEFAULT_MAX_REVERSE_SPEED_MPS,
  };
}
