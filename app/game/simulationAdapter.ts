import type {
  NpcVehicleVariant,
  SimulationBoxJunctionDefinition,
  SimulationCoreConfig,
  SimulationLane,
  SimulationPoint,
  SimulationRailLine,
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
  resolveSimulationLaneAnchor,
  type ResolvedSimulationAnchor,
} from "./laneAnchors";
import {
  resolveServicePointLot,
  SERVICE_MODEL_FRAME,
  type ServicePointKind,
} from "./servicePoints";
import { parkLayoutForLandmark } from "./parkLayouts";
import {
  LONDON_FURNITURE_RADIUS_M,
  LONDON_STREET_FURNITURE,
} from "./londonStreetFurniture";
import { COUNTRY_PROFILES } from "./content";
import { GAS_STATION_SOLIDS_M, PROP_MODEL_FOOTPRINTS_M } from "./propFootprints";
import { REPAIR_SHOP_SOLIDS_M } from "./repairShopLayout";
import {
  BRIDGE_PARAPET_HALF_DEPTH_M,
  BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M,
  bridgePortalRailSpans,
} from "./bridgePortalGeometry";
import {
  pavementOuterFromPose,
  resolveVenuePlacement,
  sidewalkWidthForSurface,
  VENUE_PAVEMENT_GAP_M,
  type VenuePlacement,
} from "./geometry/venuePlacement";
import {
  buildingSolidObstacleId,
  planMapBuildings,
  type BuildingLayoutPlan,
} from "./geometry/buildingLayout";
import { relaxationPolicyForMap } from "./geometry/cityRelaxationPolicies";
import { landmarkGroundSolids, type GroundSolid } from "./geometry/landmarkGroundSolids";
// Re-exported: this adapter is where render/babylonGameSession.ts and several
// tests have always imported venue placement from, and geometry/venuePlacement.ts
// (its new home, extracted to break the adapter/keep-out import cycle — see
// that file's own doc comment) is not a churn every existing caller needs to
// follow.
export { resolveVenuePlacement, type VenuePlacement };

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
  /**
   * The building structural plan collision (and, upstream, the renderer)
   * consumes. Omit only when there is no reason for the two rings to share
   * one plan instance (a direct test, a one-off tool) — `BabylonGameSession`
   * always computes one exactly once, before this call, and passes it here
   * explicitly (plan Section 7.5), so its render pass and this collision
   * pass can never independently re-derive (and silently disagree about)
   * building occupancy. Supplying one whose `mapId`/`trafficSeed` do not
   * match `mapPack`/`scenario` is a caller bug (a stale plan from another
   * drive) and throws in development/tests.
   */
  readonly buildingLayout?: BuildingLayoutPlan;
}

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

function projectDistanceAlongPolyline(
  points: readonly SimulationPoint[],
  point: SimulationPoint,
): number | null {
  if (points.length < 2) return null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDistanceAlong = 0;
  let accumulated = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
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

function polylineLengthM(points: readonly SimulationPoint[]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].z - points[index].z,
    );
  }
  return length;
}

/**
 * Authored rail lines → the simulation's timetable view, plus each listed
 * crossing control projected onto its line. A `railway_signal` control the
 * map ties to a line stops free-running and follows the timetable; one no
 * line claims keeps the legacy fixed cycle (several tests author bare
 * railway controls that way on purpose).
 */
export function buildRailLines(mapPack: GameCanvasMapPack): {
  readonly lines: SimulationRailLine[];
  readonly crossingByControlId: ReadonlyMap<
    string,
    { readonly lineId: string; readonly crossingDistanceM: number }
  >;
} {
  const lines: SimulationRailLine[] = [];
  const crossingByControlId = new Map<
    string,
    { lineId: string; crossingDistanceM: number }
  >();
  const controlsById = new Map(
    mapPack.laneGraph.controls.map((control) => [control.id, control]),
  );
  for (const rail of mapPack.geometry.railLines ?? []) {
    const lengthM = polylineLengthM(rail.points);
    if (lengthM <= 1) continue;
    lines.push({ id: rail.id, lengthM, schedule: rail.schedule });
    for (const controlId of rail.crossingControlIds) {
      const control = controlsById.get(controlId);
      if (!control || control.type !== "railway_signal") continue;
      const crossingDistanceM = projectDistanceAlongPolyline(
        rail.points,
        control.position,
      );
      if (crossingDistanceM === null) continue;
      crossingByControlId.set(controlId, { lineId: rail.id, crossingDistanceM });
    }
  }
  return { lines, crossingByControlId };
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
  railCrossingByControlId: ReadonlyMap<
    string,
    { readonly lineId: string; readonly crossingDistanceM: number }
  > = new Map(),
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
      const railCrossing = isRailway
        ? railCrossingByControlId.get(control.id)
        : undefined;
      lights.push({
        id: approach.id,
        phaseGroup: approach.phaseGroup,
        x: stopPose.x,
        z: stopPose.z,
        // With `rail` set the cycle below is dead weight the timing branch
        // never reads; it stays authored so an unmapped crossing (no rail
        // line claims the control) degrades to the legacy free-run loop.
        ...(railCrossing ? { rail: railCrossing } : {}),
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

/**
 * Which side a give-way line's circulating traffic comes from, for this map's
 * country — and the one thing that reads `CountryProfile.roundaboutPolicy`,
 * which was authored for all four countries and consulted by nothing.
 *
 * Null when the map names no country the profiles know, which leaves every
 * yield line the plain omnidirectional give-way it has always been.
 */
function roundaboutYieldSideFor(
  mapPack: GameCanvasMapPack,
): "left" | "right" | null {
  for (const countryId of mapPack.countryIds ?? []) {
    const profile = COUNTRY_PROFILES.find(
      (candidate) => candidate.id === countryId,
    );
    if (profile) return profile.roundaboutPolicy.yieldToTrafficFrom;
  }
  return null;
}

function buildStopAndYieldLines(
  mapPack: GameCanvasMapPack,
): StopLineDefinition[] {
  const lanesById = new Map(
    mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]),
  );
  const yieldSide = roundaboutYieldSideFor(mapPack);
  /**
   * A give-way line becomes a *roundabout* give-way when its own lane leads
   * straight onto a ring. Derived from the lane graph rather than authored on
   * the control, so a roundabout cannot be built with its entries mislabelled.
   */
  const entersRoundabout = (laneId: string): boolean =>
    (lanesById.get(laneId)?.successors ?? []).some(
      (successorId) => lanesById.get(successorId)?.role === "roundabout",
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
          ...(kind === "yield" && yieldSide && entersRoundabout(laneId)
            ? { roundaboutYieldFrom: yieldSide }
            : {}),
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

/** World-edge fences stand this far beyond the sim bounds, so the
 * out-of-bounds warning still fires on the grass before the car stops. */
const WORLD_EDGE_STANDOFF_M = 8;
const WORLD_EDGE_THICKNESS_M = 6;

/** `GroundSolid` and `StaticObstacle` are structurally the same four shapes;
 * this only ever adds the `tag: "landmark"` every bespoke ground solid
 * carries. */
function groundSolidToStaticObstacle(solid: GroundSolid): StaticObstacle {
  if (solid.kind === "aabb") {
    return {
      kind: "aabb",
      id: solid.id,
      tag: "landmark",
      minX: solid.minX,
      maxX: solid.maxX,
      minZ: solid.minZ,
      maxZ: solid.maxZ,
    };
  }
  if (solid.kind === "obb") {
    return {
      kind: "obb",
      id: solid.id,
      tag: "landmark",
      x: solid.x,
      z: solid.z,
      ux: solid.ux,
      uz: solid.uz,
      halfU: solid.halfU,
      halfV: solid.halfV,
    };
  }
  if (solid.kind === "circle") {
    return { kind: "circle", id: solid.id, tag: "landmark", x: solid.x, z: solid.z, radius: solid.radius };
  }
  return { kind: "convex", id: solid.id, tag: "landmark", points: solid.points };
}

/**
 * The solid, movement-blocking world the core resolves the player car against.
 * Sources are exactly the authored map-pack fields the renderer builds visuals
 * from, so a wall stands wherever something is drawn:
 *
 * - buildings -> exactly `buildingLayout`'s planned structural solids
 *   (`geometry/buildingLayout.ts`), one "building" obstacle per solid —
 *   asset-slot buildings, procedural-cell boxes, and the two London museum
 *   wings alike. This is the same plan the renderer paints (Phase 3), so a
 *   parcel interior, an unselected street edge, a keep-out-cleared venue
 *   circle, or a museum forecourt has no obstacle here unless something is
 *   actually visible there. Service-point lots need no carving any more:
 *   the plan already omits any building that would stand inside one.
 * - landmarks -> `geometry/landmarkGroundSolids.ts`'s exact ground solids
 *   where a city renderer draws something bespoke (an ellipse drum, leaning
 *   wheel legs, a compound government slab or opera hall); every other
 *   landmark falls back to its generic kind's drawn box/circle
 *   (station/terminal/shops/museum/cultural as a box, tower/monument as a
 *   cylinder) — parks keep only their centre feature tree; railway rails and
 *   roundabout-island pads stay drivable.
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
export function buildStaticObstacles({
  mapPack,
  bounds,
  buildingLayout,
}: {
  readonly mapPack: GameCanvasMapPack;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly buildingLayout: BuildingLayoutPlan;
}): StaticObstacle[] {
  const obstacles: StaticObstacle[] = [];
  const london = mapPack.id.includes("london");

  // Every planned building solid becomes one exact "building" obstacle —
  // see this function's own doc comment. Replaces the old ordinary
  // full-block AABB/OBB loop and its service-lot carving outright.
  for (const building of buildingLayout.buildings) {
    for (const solid of building.solids) {
      obstacles.push({
        kind: "obb",
        id: buildingSolidObstacleId(building, solid),
        tag: "building",
        x: solid.x,
        z: solid.z,
        ux: solid.ux,
        uz: solid.uz,
        halfU: solid.halfU,
        halfV: solid.halfV,
      });
    }
  }

  // Resolved here so the service-point furniture below (the shop/pump-island
  // solids) has a pose to place from. Buildings no longer carve around a lot
  // at all: the plan already omits any building that would stand inside one.
  const serviceLots: {
    kind: ServicePointKind;
    lot: { x: number; z: number; yaw: number };
  }[] = [];
  for (const service of mapPack.geometry.servicePoints ?? []) {
    const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
    if (!lot) continue;
    serviceLots.push({ kind: service.kind, lot });
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
    // A bespoke ground-solid recipe (Section 7.9) is authoritative when one
    // exists — a city renderer that draws something other than the generic
    // kind's own box/circle (an ellipse drum, leaning wheel legs, a compound
    // slab) must not also collide as that generic shape.
    const bespoke = landmarkGroundSolids(mapPack.id, landmark);
    if (bespoke) {
      for (const solid of bespoke) {
        obstacles.push(groundSolidToStaticObstacle(solid));
      }
      continue;
    }
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
    // Pillar boxes and telephone kiosks. Cast iron and a quarter-tonne of
    // glazed kiosk both beat a car, so unlike every other piece of street
    // furniture these are solids here rather than knockable renderer-side.
    // Positions come from the one module the renderer reads too — they used
    // to be a literal on each side with a comment asking the next reader to
    // move both together.
    for (const item of LONDON_STREET_FURNITURE) {
      obstacles.push({
        kind: "circle",
        id: item.id,
        tag: "landmark",
        x: item.position.x,
        z: item.position.z,
        radius: LONDON_FURNITURE_RADIUS_M,
      });
    }
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
  if (obstacle.kind === "obb") {
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
  // convex: same clockwise-winding inside/outside test and nearest-edge-point
  // search as the core's own convexEndpointPenetration (playerDynamics.ts),
  // re-derived here rather than shared — this file cannot import from
  // app/game/simulation/*.ts, whose dependency arrows only point inward.
  const points = obstacle.points;
  let inside = true;
  let minDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const cross = ex * (z - a.z) - ez * (x - a.x);
    if (cross > 0) inside = false;
    const edgeLengthSq = ex * ex + ez * ez;
    const t =
      edgeLengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / edgeLengthSq))
        : 0;
    const nearX = a.x + ex * t;
    const nearZ = a.z + ez * t;
    const dx = x - nearX;
    const dz = z - nearZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDistSq) minDistSq = distSq;
  }
  return inside ? 0 : Math.sqrt(minDistSq);
}

export function buildSimulationCoreConfig({
  scenario,
  mapPack,
  trafficSide,
  speedUnit,
  touchFirst = false,
  buildingLayout,
}: SimulationAdapterOptions): SimulationCoreConfig {
  // Compute once here iff the caller has no reason to share an instance
  // across rings; BabylonGameSession always supplies its own (Section 7.5).
  // A supplied plan for the wrong map/seed is a caller bug — a stale plan
  // left over from a previous drive — never a case to silently tolerate,
  // since collision would then resolve against buildings that are not what
  // the player is actually looking at.
  const resolvedBuildingLayout =
    buildingLayout ?? planMapBuildings(mapPack, scenario.trafficSeed, relaxationPolicyForMap(mapPack.id));
  if (
    resolvedBuildingLayout.mapId !== mapPack.id ||
    resolvedBuildingLayout.trafficSeed !== scenario.trafficSeed
  ) {
    throw new Error(
      `buildSimulationCoreConfig: supplied buildingLayout is for map "${resolvedBuildingLayout.mapId}" seed ${resolvedBuildingLayout.trafficSeed}, but this scenario is "${mapPack.id}" seed ${scenario.trafficSeed} — a stale plan from another drive.`,
    );
  }
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
  const rail = buildRailLines(mapPack);
  const traffic = buildTrafficLights(mapPack, rail.crossingByControlId);
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
    staticObstacles: buildStaticObstacles({ mapPack, bounds, buildingLayout: resolvedBuildingLayout }),
    spawn: { x: start.x, z: start.z, heading: start.heading },
    trafficLights: traffic.lights,
    stopLines,
    railLines: rail.lines,
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
