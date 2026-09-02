import { describe, expect, it } from "vitest";
import {
  NYC_QUEENSVIEW_ACCESS_SITES,
  NYC_QUEENSVIEW_DECK_ELEVATION_M,
} from "../app/game/cities/nycElevatedRoadNetwork";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationInput,
  type SimulationPoint,
  type SimulationSnapshot,
} from "../app/game/simulation";
import type { SimulationLane } from "../app/game/simulation/roadNetwork";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";

/**
 * Production-faithful player traversal for every Queensview access movement.
 * The topology suite proves authored successor legality and drives two NPC
 * entries; this separate acceptance keeps the production player capsule,
 * raised-road headroom query, barriers, supports, and static obstacles active.
 * A deterministic lane-centre controller supplies ordinary pedal/steer input:
 * it never teleports after the initial spawn and never mutates simulation
 * internals, so a blocked mouth, collision seam, wrong-level projection, or
 * unusable landing fails the same movement path the game uses.
 */

const NYC_FREE_DRIVE = FREE_DRIVES.find((drive) => drive.id === "free-us")!;
const LEAD_IN_M = 45;
const LANDING_RUN_M = 45;
const COMPLETION_TOLERANCE_M = 2.5;
const MAX_ROUTE_STALL_TICKS = 4 * 60;
const MAX_ELEVATION_ERROR_M = 0.2;
const MAX_FIXED_TICK_ELEVATION_CHANGE_M = 0.08;

interface RoutePoint extends SimulationPoint {
  readonly elevationM: number;
}

interface RouteProjection {
  readonly progressM: number;
  readonly distanceM: number;
  readonly elevationM: number;
}

interface DriveRoute {
  readonly label: string;
  readonly laneIds: readonly string[];
  readonly roadIds: ReadonlySet<string>;
  readonly points: readonly RoutePoint[];
  readonly lengthM: number;
  readonly rampRoadId: string;
  readonly landingRoadId: string;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const distance = (left: SimulationPoint, right: SimulationPoint): number =>
  Math.hypot(left.x - right.x, left.z - right.z);

const elevationOf = (point: SimulationPoint): number => point.elevationM ?? 0;

const headingBetween = (from: SimulationPoint, to: SimulationPoint): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

const angleDifference = (target: number, current: number): number => {
  let difference = target - current;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

function polylineLength(points: readonly SimulationPoint[]): number {
  let lengthM = 0;
  for (let index = 1; index < points.length; index += 1) {
    lengthM += distance(points[index - 1], points[index]);
  }
  return lengthM;
}

function pointAtDistance(
  points: readonly SimulationPoint[],
  requestedDistanceM: number,
): RoutePoint {
  const totalLengthM = polylineLength(points);
  let remainingM = clamp(requestedDistanceM, 0, totalLengthM);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLengthM = distance(from, to);
    if (segmentLengthM <= Number.EPSILON) continue;
    if (remainingM <= segmentLengthM || index === points.length - 1) {
      const amount = remainingM / segmentLengthM;
      return {
        x: from.x + (to.x - from.x) * amount,
        z: from.z + (to.z - from.z) * amount,
        elevationM:
          elevationOf(from) + (elevationOf(to) - elevationOf(from)) * amount,
      };
    }
    remainingM -= segmentLengthM;
  }
  const last = points.at(-1)!;
  return { x: last.x, z: last.z, elevationM: elevationOf(last) };
}

function slicePolyline(
  points: readonly SimulationPoint[],
  startDistanceM: number,
  endDistanceM: number,
): RoutePoint[] {
  const totalLengthM = polylineLength(points);
  const startM = clamp(startDistanceM, 0, totalLengthM);
  const endM = clamp(endDistanceM, startM, totalLengthM);
  const result = [pointAtDistance(points, startM)];
  let travelledM = 0;
  for (let index = 1; index < points.length; index += 1) {
    travelledM += distance(points[index - 1], points[index]);
    if (travelledM <= startM + 1e-8 || travelledM >= endM - 1e-8) continue;
    const point = points[index];
    result.push({ x: point.x, z: point.z, elevationM: elevationOf(point) });
  }
  const end = pointAtDistance(points, endM);
  if (distance(result.at(-1)!, end) > 1e-8) result.push(end);
  return result;
}

function appendPoints(target: RoutePoint[], addition: readonly RoutePoint[], label: string): void {
  if (!target.length) {
    target.push(...addition);
    return;
  }
  const previous = target.at(-1)!;
  const next = addition[0];
  const planGapM = distance(previous, next);
  const elevationGapM = Math.abs(previous.elevationM - next.elevationM);
  expect(planGapM, `${label}: connected lane-centre endpoints`).toBeLessThanOrEqual(0.02);
  expect(elevationGapM, `${label}: connected elevation endpoints`).toBeLessThanOrEqual(0.02);
  target.push(...addition.slice(1));
}

function closestProjection(
  points: readonly RoutePoint[],
  point: SimulationPoint,
  minimumProgressM = 0,
  maximumProgressM = Number.POSITIVE_INFINITY,
): RouteProjection {
  let travelledM = 0;
  let best: RouteProjection | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    const segmentLengthM = Math.sqrt(lengthSquared);
    if (segmentLengthM <= Number.EPSILON) continue;
    const minimumAmount = clamp(
      (minimumProgressM - travelledM) / segmentLengthM,
      0,
      1,
    );
    const maximumAmount = clamp(
      (maximumProgressM - travelledM) / segmentLengthM,
      0,
      1,
    );
    if (minimumAmount > maximumAmount) {
      travelledM += segmentLengthM;
      continue;
    }
    const amount = clamp(
      ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared,
      minimumAmount,
      maximumAmount,
    );
    const projected = {
      x: from.x + dx * amount,
      z: from.z + dz * amount,
    };
    const candidate: RouteProjection = {
      progressM: travelledM + segmentLengthM * amount,
      distanceM: distance(point, projected),
      elevationM:
        from.elevationM + (to.elevationM - from.elevationM) * amount,
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
    travelledM += segmentLengthM;
  }
  if (!best) throw new Error("Drive route has no non-degenerate segment");
  return best;
}

class LaneCentreController {
  private progressM = 0;

  constructor(private readonly route: DriveRoute) {}

  inputFor(snapshot: SimulationSnapshot): SimulationInput {
    const projection = closestProjection(
      this.route.points,
      snapshot.player,
      Math.max(0, this.progressM - 5),
      Math.min(this.route.lengthM, this.progressM + 30),
    );
    if (projection.progressM >= this.progressM - 2) {
      this.progressM = Math.max(this.progressM, projection.progressM);
    }
    const lookaheadM = clamp(4.5 + snapshot.player.speedMps * 0.32, 4.5, 7.5);
    const target = pointAtDistance(
      this.route.points,
      Math.min(this.route.lengthM, this.progressM + lookaheadM),
    );
    const headingError = angleDifference(
      headingBetween(snapshot.player, target),
      snapshot.player.heading,
    );
    const headingMagnitude = Math.abs(headingError);
    const overspeed = snapshot.player.speedMps > 8.5;
    return {
      throttle:
        overspeed || headingMagnitude > 0.72
          ? 0
          : headingMagnitude > 0.38
            ? 0.16
            : 0.38,
      brake: headingMagnitude > 0.82 ? 0.7 : overspeed ? 0.25 : 0,
      steer: clamp(headingError / 0.24, -0.92, 0.92),
      viewHeading: snapshot.player.heading,
    };
  }

  get routeProgressM(): number {
    return this.progressM;
  }
}

function productionConfig(): SimulationCoreConfig {
  const country = getCountryProfile(NYC_FREE_DRIVE.countryId);
  return buildSimulationCoreConfig({
    scenario: buildFreeDriveScenario(NYC_FREE_DRIVE),
    mapPack: getMapPack(NYC_FREE_DRIVE.mapId),
    trafficSide: country.trafficSide,
    speedUnit: country.speedUnit,
  });
}

function chooseOuterLane(lanes: readonly SimulationLane[]): SimulationLane {
  const lane =
    lanes.find((candidate) => candidate.role !== "passing") ?? lanes[0];
  if (!lane) throw new Error("Queensview movement has no connected outer lane");
  return lane;
}

function buildRoutes(config: SimulationCoreConfig): DriveRoute[] {
  const lanes = config.lanes ?? [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const requireLane = (id: string): SimulationLane => {
    const lane = laneById.get(id);
    if (!lane) throw new Error(`Missing production lane ${id}`);
    return lane;
  };
  const routes: DriveRoute[] = [];

  for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
    const entrySlip = requireLane(`${site.entry.slipSurfaceId}-lane`);
    const entryRamp = requireLane(site.entry.rampLaneId);
    const entryLanding = chooseOuterLane(
      (entryRamp.successorLaneIds ?? []).map(requireLane),
    );
    const entryHost = requireLane(site.entry.hostLaneId);
    routes.push(
      routeFromLanes(
        `${site.id} entry`,
        [entryHost, entrySlip, entryRamp, entryLanding],
        site.entry.rampSurfaceId,
        entryLanding.roadId!,
      ),
    );

    const exitRamp = requireLane(site.exit.rampLaneId);
    const exitApproach = chooseOuterLane(
      lanes.filter((lane) => lane.successorLaneIds?.includes(exitRamp.id)),
    );
    const exitSlip = requireLane(`${site.exit.slipSurfaceId}-lane`);
    const exitHost = requireLane(site.exit.hostLaneId);
    routes.push(
      routeFromLanes(
        `${site.id} exit`,
        [exitApproach, exitRamp, exitSlip, exitHost],
        site.exit.rampSurfaceId,
        exitHost.roadId!,
      ),
    );
  }
  return routes;
}

function routeFromLanes(
  label: string,
  lanes: readonly SimulationLane[],
  rampRoadId: string,
  landingRoadId: string,
): DriveRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index];
    const lengthM = polylineLength(lane.points);
    const startM = index === 0 ? Math.max(0, lengthM - LEAD_IN_M) : 0;
    const endM =
      index === lanes.length - 1 ? Math.min(lengthM, LANDING_RUN_M) : lengthM;
    appendPoints(points, slicePolyline(lane.points, startM, endM), `${label}/${lane.id}`);
  }
  const roadIds = new Set(
    lanes.map((lane) => {
      if (!lane.roadId) throw new Error(`${lane.id} has no road identity`);
      return lane.roadId;
    }),
  );
  return {
    label,
    laneIds: lanes.map((lane) => lane.id),
    roadIds,
    points,
    lengthM: polylineLength(points),
    rampRoadId,
    landingRoadId,
  };
}

function driveRoute(baseConfig: SimulationCoreConfig, route: DriveRoute): void {
  const start = route.points[0];
  const controller = new LaneCentreController(route);
  const simulation = new SimulationCore({
    ...baseConfig,
    npcCount: 0,
    spawn: {
      x: start.x,
      z: start.z,
      elevationM: start.elevationM,
      heading: headingBetween(start, route.points[1]),
    },
  });
  const laneById = new Map((baseConfig.lanes ?? []).map((lane) => [lane.id, lane]));
  const visitedRoadIds = new Set<string>();
  let maximumElevationM = 0;
  let previousElevationM = start.elevationM;
  let previousProgressM = 0;
  let stallTicks = 0;
  let snapshot = simulation.getSnapshot();
  const maxTicks = Math.ceil((route.lengthM / 4 + 20) * 60);

  try {
    for (let tick = 0; tick < maxTicks; tick += 1) {
      snapshot = simulation.step(
        FIXED_STEP_SECONDS,
        controller.inputFor(snapshot),
      );
      const roadId = snapshot.road.laneId
        ? laneById.get(snapshot.road.laneId)?.roadId
        : undefined;
      if (roadId) visitedRoadIds.add(roadId);

      expect(snapshot.status, `${route.label} tick ${snapshot.tick}: core status`).toBe(
        "running",
      );
      expect(snapshot.road.offRoad, `${route.label} tick ${snapshot.tick}: on road`).toBe(
        false,
      );
      expect(snapshot.road.wrongWay, `${route.label} tick ${snapshot.tick}: legal direction`).toBe(
        false,
      );
      expect(roadId, `${route.label} tick ${snapshot.tick}: projected road`).toBeTruthy();
      expect(
        route.roadIds.has(roadId ?? ""),
        `${route.label} tick ${snapshot.tick}: projection ${String(roadId)} stays on its route`,
      ).toBe(true);

      const routeProjection = closestProjection(
        route.points,
        snapshot.player,
        Math.max(0, controller.routeProgressM - 10),
        Math.min(route.lengthM, controller.routeProgressM + 10),
      );
      const elevationM = snapshot.player.elevationM ?? 0;
      expect(
        Math.abs(elevationM - routeProjection.elevationM),
        `${route.label} tick ${snapshot.tick}: player remains on the authored elevation profile`,
      ).toBeLessThanOrEqual(MAX_ELEVATION_ERROR_M);
      expect(
        Math.abs(elevationM - previousElevationM),
        `${route.label} tick ${snapshot.tick}: elevation remains continuous`,
      ).toBeLessThanOrEqual(MAX_FIXED_TICK_ELEVATION_CHANGE_M);
      previousElevationM = elevationM;
      maximumElevationM = Math.max(maximumElevationM, elevationM);

      const unsafeEvents = simulation
        .drainEvents()
        .filter((event) => event.code === "collision" || event.code === "wrong_way");
      expect(
        unsafeEvents,
        `${route.label} tick ${snapshot.tick}: no physical collision or wrong-way event`,
      ).toEqual([]);

      const progressM = controller.routeProgressM;
      if (progressM > previousProgressM + 0.02) {
        stallTicks = 0;
        previousProgressM = progressM;
      } else if (progressM < route.lengthM - COMPLETION_TOLERANCE_M) {
        stallTicks += 1;
      }
      expect(
        stallTicks,
        `${route.label} tick ${snapshot.tick}: route is not blocked`,
      ).toBeLessThanOrEqual(MAX_ROUTE_STALL_TICKS);

      if (progressM >= route.lengthM - COMPLETION_TOLERANCE_M) break;
    }

    expect(
      controller.routeProgressM,
      `${route.label}: reaches its landing after ${snapshot.player.distanceTravelledM.toFixed(1)}m driven`,
    ).toBeGreaterThanOrEqual(route.lengthM - COMPLETION_TOLERANCE_M);
    expect(visitedRoadIds, `${route.label}: traverses its ramp`).toContain(
      route.rampRoadId,
    );
    expect(visitedRoadIds, `${route.label}: reaches its landing road`).toContain(
      route.landingRoadId,
    );
    expect(maximumElevationM, `${route.label}: reaches bridge level`).toBeGreaterThanOrEqual(
      NYC_QUEENSVIEW_DECK_ELEVATION_M - 0.05,
    );
  } finally {
    simulation.dispose();
  }
}

describe("NYC Queensview production player-drive acceptance", () => {
  it(
    "physically drives every RHT entrance and exit without a collision, stall, or level drop",
    () => {
      const config = productionConfig();
      const routes = buildRoutes(config);
      expect(routes.map((route) => route.label)).toEqual(
        NYC_QUEENSVIEW_ACCESS_SITES.flatMap((site) => [
          `${site.id} entry`,
          `${site.id} exit`,
        ]),
      );
      for (const route of routes) driveRoute(config, route);
    },
    120_000,
  );
});
