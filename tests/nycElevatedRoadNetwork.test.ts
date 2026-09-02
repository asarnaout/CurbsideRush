import { describe, expect, it } from "vitest";
import {
  NYC_FREE_DRIVE,
  NYC_MAP_PACK,
  NYC_QUEENSVIEW_ACCESS_SITES,
  NYC_QUEENSVIEW_DECK_ELEVATION_M,
  NYC_QUEENSVIEW_NETWORK_PREFIX,
} from "../app/game/cities/nyc";
import { getCountryProfile } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { elevatedRoadJunctionEnvelopes } from "../app/game/geometry/elevatedRoadGeometry";
import { isElevatedRoadSurface } from "../app/game/roadElevation";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
} from "../app/game/simulation";
import type { NormalizedLane } from "../app/game/simulation/roadNetwork";
import type { NpcInternal } from "../app/game/simulation/trafficSystem";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import type {
  LaneSegment,
  RoadSurface,
  WorldPoint,
} from "../app/game/types";

/**
 * Production topology contract for the Queensview Bridge. The bridge is a
 * right-hand-traffic transport network, not a decorative road drawn over the
 * East River: these tests follow the authored successor graph and measure the
 * physical side of every merge/diverge from the lane geometry itself.
 */

const MAINLINE_ID = "nyc-queensview-bridge";
const EAST_CARRIER_ID = "nyc-queensview-east-carrier";
const NON_DEGENERATE_CHORD_M = 0.001;
const RIGHT_SIDE_PROBE_DISTANCE_M = 18;
const NPC_CONNECTOR_WINDOW_M = 7;

interface NpcElevationTrafficAccess {
  readonly npcs: readonly NpcInternal[];
  readonly roadNetwork: {
    readonly lanesById: ReadonlyMap<string, NormalizedLane>;
    pointOnLane(
      lane: NormalizedLane,
      distanceM: number,
    ): { readonly elevationM?: number };
  };
}

const npcTrafficAccess = (
  simulation: SimulationCore,
): NpcElevationTrafficAccess =>
  (
    simulation as unknown as {
      readonly trafficSystem: NpcElevationTrafficAccess;
    }
  ).trafficSystem;

/**
 * Mirrors only `npcCornerPose`'s vertical contract. The rendered connector
 * spans the final seven metres of the reserved source and the first seven of
 * its successor, so its Y is intentionally not the nearest source-surface Y
 * while `laneId` still belongs to the source. The horizontal Bezier/chord
 * choice cannot affect this interpolation.
 */
const authoritativeNpcElevationM = (
  traffic: NpcElevationTrafficAccess,
  npc: NpcInternal,
): { readonly elevationM: number; readonly onConnector: boolean } => {
  const lane = traffic.roadNetwork.lanesById.get(npc.laneId);
  if (!lane) {
    return { elevationM: Number.NaN, onConnector: false };
  }
  const laneElevationM =
    traffic.roadNetwork.pointOnLane(lane, npc.distance).elevationM ?? 0;

  const connectorElevationM = (
    fromLane: NormalizedLane,
    toLane: NormalizedLane,
    progressM: number,
  ): number => {
    const fromWindowM = Math.min(
      NPC_CONNECTOR_WINDOW_M,
      fromLane.length / 2,
    );
    const toWindowM = Math.min(
      NPC_CONNECTOR_WINDOW_M,
      toLane.length / 2,
    );
    const totalWindowM = fromWindowM + toWindowM;
    const amount = Math.max(0, Math.min(1, progressM / totalWindowM));
    const startElevationM =
      traffic.roadNetwork.pointOnLane(
        fromLane,
        fromLane.length - fromWindowM,
      ).elevationM ?? 0;
    const endElevationM =
      traffic.roadNetwork.pointOnLane(toLane, toWindowM).elevationM ?? 0;
    return (
      startElevationM + (endElevationM - startElevationM) * amount
    );
  };

  const exitWindowM = Math.min(NPC_CONNECTOR_WINDOW_M, lane.length / 2);
  if (
    npc.distance >= lane.length - exitWindowM &&
    npc.successorReservationFromLaneId === lane.id &&
    npc.successorReservationLaneId
  ) {
    const successor = traffic.roadNetwork.lanesById.get(
      npc.successorReservationLaneId,
    );
    if (successor) {
      return {
        elevationM: connectorElevationM(
          lane,
          successor,
          npc.distance - (lane.length - exitWindowM),
        ),
        onConnector: true,
      };
    }
  }

  const entryWindowM = Math.min(NPC_CONNECTOR_WINDOW_M, lane.length / 2);
  if (npc.cornerFromLaneId && npc.distance < entryWindowM) {
    const predecessor = traffic.roadNetwork.lanesById.get(
      npc.cornerFromLaneId,
    );
    if (predecessor) {
      const predecessorWindowM = Math.min(
        NPC_CONNECTOR_WINDOW_M,
        predecessor.length / 2,
      );
      return {
        elevationM: connectorElevationM(
          predecessor,
          lane,
          predecessorWindowM + npc.distance,
        ),
        onConnector: true,
      };
    }
  }

  return { elevationM: laneElevationM, onConnector: false };
};

const lanes = NYC_MAP_PACK.laneGraph.lanes;
const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
const surfaceById = new Map(
  NYC_MAP_PACK.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
);
const nodeById = new Map(
  NYC_MAP_PACK.laneGraph.nodes.map((node) => [node.id, node]),
);
const networkSurfaces = NYC_MAP_PACK.geometry.roadSurfaces.filter((surface) =>
  surface.id.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
);
const networkSurfaceIds = new Set(networkSurfaces.map((surface) => surface.id));
const elevatedJunctions = elevatedRoadJunctionEnvelopes(
  NYC_MAP_PACK.geometry.roadSurfaces.filter(isElevatedRoadSurface),
);

const surfaceIdsAtSite = (siteId: string) => ({
  entrySlip: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-entry-slip`,
  entryRamp: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-entry-ramp`,
  exitRamp: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-exit-ramp`,
  exitSlip: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-exit-slip`,
});

const planLengthM = (points: readonly WorldPoint[]): number =>
  points.slice(1).reduce(
    (totalM, point, index) =>
      totalM +
      Math.hypot(point.x - points[index].x, point.z - points[index].z),
    0,
  );

const pointAtDistance = (
  points: readonly WorldPoint[],
  rawDistanceM: number,
): WorldPoint => {
  const totalM = planLengthM(points);
  const distanceM = Math.max(0, Math.min(totalM, rawDistanceM));
  let travelledM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentM = Math.hypot(end.x - start.x, end.z - start.z);
    if (travelledM + segmentM >= distanceM || index + 1 === points.length) {
      const amount =
        segmentM > NON_DEGENERATE_CHORD_M
          ? Math.max(0, Math.min(1, (distanceM - travelledM) / segmentM))
          : 0;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        elevationM:
          (start.elevationM ?? 0) +
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
      };
    }
    travelledM += segmentM;
  }
  return points.at(-1)!;
};

const directionAtDistance = (
  points: readonly WorldPoint[],
  distanceM: number,
): { readonly x: number; readonly z: number } => {
  const before = pointAtDistance(points, Math.max(0, distanceM - 0.5));
  const after = pointAtDistance(
    points,
    Math.min(planLengthM(points), distanceM + 0.5),
  );
  const dx = after.x - before.x;
  const dz = after.z - before.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM <= NON_DEGENERATE_CHORD_M) {
    throw new Error("Cannot sample direction on a degenerate lane");
  }
  return { x: dx / lengthM, z: dz / lengthM };
};

const endpointDirection = (
  lane: LaneSegment,
  end: "start" | "end",
): { readonly x: number; readonly z: number } => {
  for (let step = 1; step < lane.centerline.length; step += 1) {
    const start =
      end === "start"
        ? lane.centerline[step - 1]
        : lane.centerline[lane.centerline.length - step - 1];
    const finish =
      end === "start"
        ? lane.centerline[step]
        : lane.centerline[lane.centerline.length - step];
    const dx = finish.x - start.x;
    const dz = finish.z - start.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM > NON_DEGENERATE_CHORD_M) {
      return { x: dx / lengthM, z: dz / lengthM };
    }
  }
  throw new Error(`${lane.id} has no non-degenerate direction`);
};

const rightOffsetM = (
  origin: WorldPoint,
  travelDirection: { readonly x: number; readonly z: number },
  branchPoint: WorldPoint,
): number =>
  (branchPoint.x - origin.x) * travelDirection.z -
  (branchPoint.z - origin.z) * travelDirection.x;

interface LaneTransition {
  readonly from: LaneSegment;
  readonly to: LaneSegment;
}

const transitionsAt = (
  nodeId: string,
  fromRoadId?: string,
  toRoadId?: string,
): readonly LaneTransition[] =>
  lanes
    .filter(
      (lane) =>
        lane.to === nodeId &&
        (fromRoadId === undefined || lane.roadId === fromRoadId),
    )
    .flatMap((lane) =>
      lane.successors.flatMap((successorId) => {
        const successor = laneById.get(successorId);
        return successor?.from === nodeId &&
          (toRoadId === undefined || successor.roadId === toRoadId)
          ? [{ from: lane, to: successor }]
          : [];
      }),
    );

const nearestSurfaceProjection = (
  candidate: WorldPoint,
  surface: RoadSurface,
): { readonly distanceM: number; readonly elevationM: number } => {
  let bestDistanceM = Number.POSITIVE_INFINITY;
  let bestElevationM = 0;
  for (let index = 1; index < surface.centerline.length; index += 1) {
    const start = surface.centerline[index - 1];
    const end = surface.centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((candidate.x - start.x) * dx +
                (candidate.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const distanceM = Math.hypot(
      candidate.x - (start.x + dx * amount),
      candidate.z - (start.z + dz * amount),
    );
    if (distanceM < bestDistanceM) {
      bestDistanceM = distanceM;
      bestElevationM =
        (start.elevationM ?? 0) +
        ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
    }
  }
  return { distanceM: bestDistanceM, elevationM: bestElevationM };
};

const pointInPolygon = (
  candidate: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean => {
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crosses =
      (current.z > candidate.z) !== (previous.z > candidate.z) &&
      candidate.x <
        ((previous.x - current.x) * (candidate.z - current.z)) /
          (previous.z - current.z) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const findPath = (
  startRoadId: string,
  goalRoadIds: ReadonlySet<string>,
): readonly LaneSegment[] | null => {
  const starts = lanes.filter((lane) => lane.roadId === startRoadId);
  const queue = starts.map((lane) => [lane] as readonly LaneSegment[]);
  const visited = new Set(starts.map((lane) => lane.id));
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    if (goalRoadIds.has(current.roadId)) return path;
    for (const successorId of current.successors) {
      if (visited.has(successorId)) continue;
      const successor = laneById.get(successorId);
      if (!successor || !networkSurfaceIds.has(successor.roadId)) continue;
      visited.add(successorId);
      queue.push([...path, successor]);
    }
  }
  return null;
};

describe("NYC Queensview elevated road network", () => {
  it("authors the exact substantial four-access inventory across the East River", () => {
    expect(NYC_QUEENSVIEW_ACCESS_SITES.map((site) => site.id)).toEqual([
      "manhattan-65th",
      "manhattan-third",
      "queens-vernon",
      "queens-40th",
    ]);

    const expectedIds = [MAINLINE_ID, EAST_CARRIER_ID];
    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      expectedIds.push(...Object.values(surfaceIdsAtSite(site.id)));
    }
    expect(networkSurfaces.map((surface) => surface.id).sort()).toEqual(
      expectedIds.sort(),
    );
    const referencedNodeIds = new Set(
      NYC_MAP_PACK.laneGraph.lanes.flatMap((lane) => [lane.from, lane.to]),
    );
    for (const node of NYC_MAP_PACK.laneGraph.nodes) {
      if (!node.id.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX)) continue;
      expect(
        referencedNodeIds.has(node.id),
        `${node.id} is an orphaned bridge-network node`,
      ).toBe(true);
    }
    expect(
      networkSurfaces.reduce(
        (totalM, surface) => totalM + planLengthM(surface.centerline),
        0,
      ),
    ).toBeGreaterThan(2_000);

    const mainline = surfaceById.get(MAINLINE_ID)!;
    expect(planLengthM(mainline.centerline)).toBeGreaterThan(500);
    expect(mainline.widthM).toBeGreaterThanOrEqual(14);
    expect(
      mainline.centerline.every(
        (point) =>
          Math.abs(
            (point.elevationM ?? 0) - NYC_QUEENSVIEW_DECK_ELEVATION_M,
          ) < 1e-9,
      ),
    ).toBe(true);

    const river = NYC_MAP_PACK.geometry.waterBodies?.find(
      (water) => water.id === "nyc-east-river",
    );
    expect(river).toBeTruthy();
    const overWater = mainline.centerline.filter((point) =>
      pointInPolygon(point, river!.polygon),
    );
    expect(overWater.length).toBeGreaterThan(15);
    expect(
      overWater.every(
        (point) =>
          Math.abs(
            (point.elevationM ?? 0) - NYC_QUEENSVIEW_DECK_ELEVATION_M,
          ) < 1e-9,
      ),
    ).toBe(true);
    expect(river?.bridgePortalSurfaceIds).toEqual([
      "nyc-harborline-bridge",
    ]);
  });

  it("authors exactly eight ground movements with flat slips and separate grades", () => {
    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      const ids = surfaceIdsAtSite(site.id);
      const entrySlip = surfaceById.get(ids.entrySlip)!;
      const entryRamp = surfaceById.get(ids.entryRamp)!;
      const exitRamp = surfaceById.get(ids.exitRamp)!;
      const exitSlip = surfaceById.get(ids.exitSlip)!;

      for (const slip of [entrySlip, exitSlip]) {
        expect(slip, `${site.id} slip exists`).toBeTruthy();
        expect(slip.widthM, slip.id).toBe(5.8);
        expect(
          slip.centerline.every((point) => (point.elevationM ?? 0) === 0),
          `${slip.id} remains a flat auxiliary lane`,
        ).toBe(true);
        expect(slip.parapetDepthM, slip.id).toBeUndefined();
      }

      expect(entryRamp.centerline[0].elevationM ?? 0, site.id).toBe(0);
      expect(
        entryRamp.centerline.at(-1)!.elevationM ?? 0,
        site.id,
      ).toBe(NYC_QUEENSVIEW_DECK_ELEVATION_M);
      expect(exitRamp.centerline[0].elevationM ?? 0, site.id).toBe(
        NYC_QUEENSVIEW_DECK_ELEVATION_M,
      );
      expect(exitRamp.centerline.at(-1)!.elevationM ?? 0, site.id).toBe(0);

      const entryGround = transitionsAt(
        site.entry.mouthNodeId,
        site.hostRoadId,
        ids.entrySlip,
      );
      expect(entryGround, `${site.id} exact ground entry`).toHaveLength(1);
      // `splitHostLane` intentionally retains the original id on the
      // downstream host segment so existing controls/anchors remain stable;
      // the new upstream segment is therefore identified by road, direction,
      // node and physical geometry rather than by that downstream id.
      expect(entryGround[0].from.roadId, `${site.id} entry host road`).toBe(
        site.entry.hostRoadId,
      );
      expect(
        transitionsAt(
          entryGround[0].to.to,
          ids.entrySlip,
          ids.entryRamp,
        ),
        `${site.id} flat slip to grade`,
      ).toHaveLength(1);

      const exitGround = transitionsAt(
        site.exit.mouthNodeId,
        ids.exitSlip,
        site.hostRoadId,
      );
      expect(exitGround, `${site.id} exact ground exit`).toHaveLength(1);
      expect(exitGround[0].to.id, `${site.id} exit host lane`).toBe(
        site.exit.hostLaneId,
      );
      expect(
        transitionsAt(
          exitGround[0].from.from,
          ids.exitRamp,
          ids.exitSlip,
        ),
        `${site.id} grade to flat slip`,
      ).toHaveLength(1);

      const entryHigh = transitionsAt(
        site.entry.highNodeId,
        ids.entryRamp,
      ).filter((movement) => networkSurfaceIds.has(movement.to.roadId));
      const exitHigh = transitionsAt(
        site.exit.highNodeId,
        undefined,
        ids.exitRamp,
      ).filter((movement) => networkSurfaceIds.has(movement.from.roadId));
      expect(entryHigh.length, `${site.id} high entry merge`).toBeGreaterThan(0);
      expect(exitHigh.length, `${site.id} high exit diverge`).toBeGreaterThan(0);

      for (const [kind, nodeId, ramp, movements] of [
        ["entry", site.entry.highNodeId, entryRamp, entryHigh],
        ["exit", site.exit.highNodeId, exitRamp, exitHigh],
      ] as const) {
        const highNode = nodeById.get(nodeId)!;
        const rampMouth =
          kind === "entry"
            ? ramp.centerline.at(-1)!
            : ramp.centerline[0];
        expect(
          Math.hypot(
            rampMouth.x - highNode.position.x,
            (rampMouth.elevationM ?? 0) -
              (highNode.position.elevationM ?? 0),
            rampMouth.z - highNode.position.z,
          ),
          `${site.id} ${kind} ramp endpoint owns its high node`,
        ).toBeLessThanOrEqual(0.001);

        for (const movement of movements) {
          const fromMouth = movement.from.centerline.at(-1)!;
          const toMouth = movement.to.centerline[0];
          expect(
            Math.hypot(
              fromMouth.x - toMouth.x,
              (fromMouth.elevationM ?? 0) - (toMouth.elevationM ?? 0),
              fromMouth.z - toMouth.z,
            ),
            `${site.id} ${kind} lane endpoints meet physically`,
          ).toBeLessThanOrEqual(0.001);
        }

        const collar = elevatedJunctions.find(
          (envelope) =>
            envelope.surfaceIds.includes(ramp.id) &&
            envelope.surfaceIds.length >= 2,
        );
        expect(
          collar,
          `${site.id} ${kind} high mouth has a shared structural collar`,
        ).toBeTruthy();
        expect(collar?.surfaceIds.length, `${site.id} ${kind} collar arms`).toBeGreaterThanOrEqual(2);
        const mouthInsideConnectedCarrier = collar?.surfaceIds.some(
          (surfaceId) => {
            if (surfaceId === ramp.id) return false;
            const carrier = surfaceById.get(surfaceId);
            if (!carrier) return false;
            const projection = nearestSurfaceProjection(rampMouth, carrier);
            return (
              projection.distanceM <= carrier.widthM / 2 + 0.05 &&
              Math.abs(
                projection.elevationM - (rampMouth.elevationM ?? 0),
              ) <= 0.05
            );
          },
        );
        expect(
          Boolean(
            collar &&
              (pointInPolygon(rampMouth, collar.asphaltBoundary) ||
                mouthInsideConnectedCarrier),
          ),
          `${site.id} ${kind} physical ramp mouth lies in its shared pavement`,
        ).toBe(true);
      }
    }
  });

  it("keeps every ground and high merge or diverge on the driver's physical right", () => {
    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      const ids = surfaceIdsAtSite(site.id);
      const entryGround = transitionsAt(
        site.entry.mouthNodeId,
        site.hostRoadId,
        ids.entrySlip,
      )[0];
      const exitGround = transitionsAt(
        site.exit.mouthNodeId,
        ids.exitSlip,
        site.hostRoadId,
      )[0];
      const entryMouth = entryGround.from.centerline.at(-1)!;
      const entryProbe = pointAtDistance(
        entryGround.to.centerline,
        Math.min(
          RIGHT_SIDE_PROBE_DISTANCE_M,
          planLengthM(entryGround.to.centerline) * 0.8,
        ),
      );
      expect(
        rightOffsetM(
          entryMouth,
          endpointDirection(entryGround.from, "end"),
          entryProbe,
        ),
        `${site.id} entry slip is on the driver's right`,
      ).toBeGreaterThan(1);

      const exitMouth = exitGround.to.centerline[0];
      const exitLengthM = planLengthM(exitGround.from.centerline);
      const exitProbe = pointAtDistance(
        exitGround.from.centerline,
        Math.max(0, exitLengthM - RIGHT_SIDE_PROBE_DISTANCE_M),
      );
      // A legal merge necessarily approaches zero lateral offset at its exact
      // handoff. Prove the final convergence stays on the driver's right, then
      // separately prove the auxiliary section begins more than one complete
      // 5.8 m slip width away instead of overlapping the host lane throughout.
      expect(
        rightOffsetM(
          exitMouth,
          endpointDirection(exitGround.to, "start"),
          exitProbe,
        ),
        `${site.id} exit slip is on the driver's right`,
      ).toBeGreaterThan(0.4);
      expect(
        rightOffsetM(
          exitMouth,
          endpointDirection(exitGround.to, "start"),
          exitGround.from.centerline[0],
        ),
        `${site.id} exit approach is a distinct right-side auxiliary lane`,
      ).toBeGreaterThan(surfaceById.get(ids.exitSlip)!.widthM);

      const entryHigh = transitionsAt(
        site.entry.highNodeId,
        ids.entryRamp,
      ).filter((movement) => networkSurfaceIds.has(movement.to.roadId));
      for (const movement of entryHigh) {
        const rampLengthM = planLengthM(movement.from.centerline);
        const rampProbe = pointAtDistance(
          movement.from.centerline,
          Math.max(0, rampLengthM - RIGHT_SIDE_PROBE_DISTANCE_M),
        );
        expect(
          rightOffsetM(
            movement.to.centerline[0],
            endpointDirection(movement.to, "start"),
            rampProbe,
          ),
          `${site.id} high entry ${movement.from.id} -> ${movement.to.id}`,
        ).toBeGreaterThan(0.4);
      }

      const exitHigh = transitionsAt(
        site.exit.highNodeId,
        undefined,
        ids.exitRamp,
      ).filter((movement) => networkSurfaceIds.has(movement.from.roadId));
      for (const movement of exitHigh) {
        const rampProbe = pointAtDistance(
          movement.to.centerline,
          Math.min(
            RIGHT_SIDE_PROBE_DISTANCE_M,
            planLengthM(movement.to.centerline) * 0.8,
          ),
        );
        expect(
          rightOffsetM(
            movement.from.centerline.at(-1)!,
            endpointDirection(movement.from, "end"),
            rampProbe,
          ),
          `${site.id} high exit ${movement.from.id} -> ${movement.to.id}`,
        ).toBeGreaterThan(0.4);
      }
    }

    for (const lane of lanes.filter((lane) =>
      networkSurfaceIds.has(lane.roadId),
    )) {
      expect(lane.trafficSide, lane.id).toBe("right");
    }
  });

  it("preserves every host through movement at every ramp mouth", () => {
    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      for (const nodeId of [site.entry.mouthNodeId, site.exit.mouthNodeId]) {
        const hostArrivals = lanes.filter(
          (lane) => lane.roadId === site.hostRoadId && lane.to === nodeId,
        );
        expect(hostArrivals.length, `${site.id}:${nodeId}`).toBeGreaterThan(0);
        for (const arrival of hostArrivals) {
          expect(
            arrival.successors.some(
              (successorId) =>
                laneById.get(successorId)?.roadId === site.hostRoadId,
            ),
            `${site.id}:${arrival.id} keeps its host-road continuation`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps same-direction mainline lanes ordered and vehicle-width apart through branch knots", () => {
    const innerLanes = lanes.filter(
      (lane) => lane.roadId === MAINLINE_ID && lane.role === "passing",
    );
    expect(innerLanes).toHaveLength(10);
    let checkedSamples = 0;

    for (const inner of innerLanes) {
      expect(inner.adjacentLaneIds, inner.id).toHaveLength(1);
      const outer = laneById.get(inner.adjacentLaneIds![0])!;
      expect(outer?.roadId, inner.id).toBe(MAINLINE_ID);
      expect(outer?.role, inner.id).toBe("travel");
      const innerLengthM = planLengthM(inner.centerline);
      const outerLengthM = planLengthM(outer.centerline);
      const sharedAtStart =
        Math.hypot(
          inner.centerline[0].x - outer.centerline[0].x,
          inner.centerline[0].z - outer.centerline[0].z,
        ) < 0.05;
      const sharedAtEnd =
        Math.hypot(
          inner.centerline.at(-1)!.x - outer.centerline.at(-1)!.x,
          inner.centerline.at(-1)!.z - outer.centerline.at(-1)!.z,
        ) < 0.05;

      // Only the two terminal fan/funnel segments are permitted to become a
      // single lane, and only inside their final 15 m. Intermediate access
      // knots remain a true two-lane mainline while the auxiliary road joins
      // from the outside.
      expect(
        Number(sharedAtStart) + Number(sharedAtEnd),
        `${inner.id} has at most one terminal fan endpoint`,
      ).toBeLessThanOrEqual(1);
      for (let step = 0; step <= 40; step += 1) {
        const amount = step / 40;
        const innerDistanceM = innerLengthM * amount;
        const outerDistanceM = outerLengthM * amount;
        if (
          (sharedAtStart && innerDistanceM < 15) ||
          (sharedAtEnd && innerLengthM - innerDistanceM < 15)
        ) {
          continue;
        }
        const innerPoint = pointAtDistance(inner.centerline, innerDistanceM);
        const outerPoint = pointAtDistance(outer.centerline, outerDistanceM);
        const direction = directionAtDistance(
          inner.centerline,
          innerDistanceM,
        );
        const separationM = Math.hypot(
          innerPoint.x - outerPoint.x,
          innerPoint.z - outerPoint.z,
        );
        const requiredSeparationM =
          (inner.widthM + outer.widthM) / 2 - 0.05;
        checkedSamples += 1;
        expect(
          separationM,
          `${inner.id}/${outer.id} at ${(amount * 100).toFixed(1)}%`,
        ).toBeGreaterThanOrEqual(requiredSeparationM);
        expect(
          rightOffsetM(innerPoint, direction, outerPoint),
          `${outer.id} remains physically right of ${inner.id}`,
        ).toBeGreaterThanOrEqual(requiredSeparationM);
      }
    }
    expect(checkedSamples).toBeGreaterThan(350);
  });

  it("keeps every opposing mainline and carrier lane physically separated", () => {
    const eastboundMainline = lanes.filter(
      (lane) =>
        lane.roadId === MAINLINE_ID &&
        lane.centerline.at(-1)!.x > lane.centerline[0].x,
    );
    const westboundMainline = lanes.filter(
      (lane) =>
        lane.roadId === MAINLINE_ID &&
        lane.centerline.at(-1)!.x < lane.centerline[0].x,
    );
    const carrierEastbound = laneById.get(`${EAST_CARRIER_ID}-eb-lane`)!;
    const carrierWestbound = laneById.get(`${EAST_CARRIER_ID}-wb-lane`)!;
    expect(eastboundMainline).toHaveLength(10);
    expect(westboundMainline).toHaveLength(10);
    expect(carrierEastbound).toBeTruthy();
    expect(carrierWestbound).toBeTruthy();

    const pointAtX = (lane: LaneSegment, x: number): WorldPoint => {
      for (let index = 1; index < lane.centerline.length; index += 1) {
        const start = lane.centerline[index - 1];
        const end = lane.centerline[index];
        if (x < Math.min(start.x, end.x) - 1e-6 ||
            x > Math.max(start.x, end.x) + 1e-6) {
          continue;
        }
        const dx = end.x - start.x;
        if (Math.abs(dx) <= NON_DEGENERATE_CHORD_M) continue;
        const amount = (x - start.x) / dx;
        return {
          x,
          z: start.z + (end.z - start.z) * amount,
          elevationM:
            (start.elevationM ?? 0) +
            ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
        };
      }
      throw new Error(`${lane.id} does not cover x=${x}`);
    };
    const failures: string[] = [];
    let samples = 0;
    const inspectOpposingSeparation = (
      eastbound: LaneSegment,
      westbound: LaneSegment,
    ) => {
      const overlapStartX = Math.max(
        Math.min(eastbound.centerline[0].x, eastbound.centerline.at(-1)!.x),
        Math.min(westbound.centerline[0].x, westbound.centerline.at(-1)!.x),
      );
      const overlapEndX = Math.min(
        Math.max(eastbound.centerline[0].x, eastbound.centerline.at(-1)!.x),
        Math.max(westbound.centerline[0].x, westbound.centerline.at(-1)!.x),
      );
      if (overlapEndX < overlapStartX + 0.01) return;
      for (let step = 0; step <= 200; step += 1) {
        const x =
          overlapStartX +
          (overlapEndX - overlapStartX) * (step / 200);
        const eastboundPoint = pointAtX(eastbound, x);
        const westboundPoint = pointAtX(westbound, x);
        const separationM = Math.hypot(
          eastboundPoint.x - westboundPoint.x,
          eastboundPoint.z - westboundPoint.z,
        );
        samples += 1;
        if (separationM < 3.5 - 1e-6) {
          failures.push(
            `${eastbound.id}/${westbound.id} at x=${x.toFixed(3)}: ${separationM.toFixed(6)}m`,
          );
        }
      }
    };

    for (const eastbound of eastboundMainline) {
      for (const westbound of westboundMainline) {
        inspectOpposingSeparation(eastbound, westbound);
      }
    }
    inspectOpposingSeparation(carrierEastbound, carrierWestbound);
    expect(samples).toBeGreaterThan(4_000);
    expect(
      failures.slice(0, 20),
      `${failures.length} opposing-lane separation failures`,
    ).toEqual([]);

    const q40 = NYC_QUEENSVIEW_ACCESS_SITES.find(
      (site) => site.id === "queens-40th",
    )!;
    const entryHigh = nodeById.get(q40.entry.highNodeId)!;
    const exitHigh = nodeById.get(q40.exit.highNodeId)!;
    expect(entryHigh.id).not.toBe(exitHigh.id);
    expect(
      Math.hypot(
        entryHigh.position.x - exitHigh.position.x,
        entryHigh.position.z - exitHigh.position.z,
      ),
      "Q40 opposing high nodes",
    ).toBeCloseTo(3.5, 6);

    const carrier = surfaceById.get(EAST_CARRIER_ID)!;
    expect(carrier.markings).toEqual([
      expect.objectContaining({
        id: `${EAST_CARRIER_ID}-centre`,
        style: "centre_solid",
        color: "yellow",
      }),
    ]);
  });

  it("provides a legal full-height cross-river route from every entrance", () => {
    const manhattanExitIds = new Set(
      NYC_QUEENSVIEW_ACCESS_SITES.filter((site) =>
        site.id.startsWith("manhattan-"),
      ).map((site) => surfaceIdsAtSite(site.id).exitSlip),
    );
    const queensExitIds = new Set(
      NYC_QUEENSVIEW_ACCESS_SITES.filter((site) =>
        site.id.startsWith("queens-"),
      ).map((site) => surfaceIdsAtSite(site.id).exitSlip),
    );

    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      const startsInManhattan = site.id.startsWith("manhattan-");
      const path = findPath(
        surfaceIdsAtSite(site.id).entrySlip,
        startsInManhattan ? queensExitIds : manhattanExitIds,
      );
      expect(path, `${site.id} cross-river path`).toBeTruthy();
      expect(
        path?.some((lane) => lane.roadId === MAINLINE_ID),
        `${site.id} uses the river mainline`,
      ).toBe(true);
      expect(
        Math.max(
          ...(path ?? []).flatMap((lane) =>
            lane.centerline.map((point) => point.elevationM ?? 0),
          ),
        ),
        `${site.id} reaches the full-height deck`,
      ).toBeCloseTo(NYC_QUEENSVIEW_DECK_ELEVATION_M, 6);
      for (let index = 1; index < (path?.length ?? 0); index += 1) {
        expect(
          path![index - 1].successors,
          `${site.id} legal handoff ${path![index - 1].id} -> ${path![index].id}`,
        ).toContain(path![index].id);
      }
    }
  });

  it("lets deterministic production NPCs legally climb onto both bridge directions", () => {
    const country = getCountryProfile(NYC_FREE_DRIVE.countryId);
    const productionConfig = buildSimulationCoreConfig({
      scenario: buildFreeDriveScenario(NYC_FREE_DRIVE),
      mapPack: NYC_MAP_PACK,
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    });
    const simulationLaneById = new Map(
      (productionConfig.lanes ?? []).map((lane) => [lane.id, lane]),
    );
    const cases = [
      NYC_QUEENSVIEW_ACCESS_SITES.find(
        (site) => site.id === "manhattan-65th",
      )!,
      NYC_QUEENSVIEW_ACCESS_SITES.find(
        (site) => site.id === "queens-40th",
      )!,
    ];

    for (const site of cases) {
      const slipLaneId = `${site.entry.slipSurfaceId}-lane`;
      const simulation = new SimulationCore({
        ...productionConfig,
        seed: 0x5156_4252,
        npcCount: 1,
        spawn: { x: 650, z: -700, heading: 0 },
        trafficGates: [
          {
            id: `test-${site.id}-entry`,
            laneId: slipLaneId,
            distance: 1,
            desiredSpeedMps: 10,
          },
        ],
        runtimeTrafficPortals: [],
        trafficCapacityLaneIds: [],
        minRuntimeSpawnDistanceM: 20,
      });
      const traffic = npcTrafficAccess(simulation);
      let previous = simulation.getSnapshot().npcs[0];
      expect(previous, `${site.id} initial NPC`).toBeTruthy();
      const visitedRoadIds = new Set<string>();
      let maximumElevationM = previous?.elevationM ?? 0;
      let maximumConnectorProfileMismatchM = 0;
      let connectorSampleCount = 0;
      const violations: string[] = [];

      for (let tick = 0; tick < 12_000; tick += 1) {
        const snapshot = simulation.step(FIXED_STEP_SECONDS);
        const npc = snapshot.npcs.find(
          (candidate) => candidate.id === previous?.id,
        );
        if (!npc) {
          violations.push(`${site.id} NPC recycled before reaching the deck`);
          break;
        }
        const lane = simulationLaneById.get(npc.laneId);
        if (!lane?.roadId) {
          violations.push(`${site.id} NPC acquired unknown lane ${npc.laneId}`);
          break;
        }
        visitedRoadIds.add(lane.roadId);
        maximumElevationM = Math.max(maximumElevationM, npc.elevationM ?? 0);

        if (previous && previous.laneId !== npc.laneId) {
          const source = simulationLaneById.get(previous.laneId);
          if (
            !source?.successorLaneIds?.includes(npc.laneId) &&
            source?.adjacentLaneId !== npc.laneId
          ) {
            violations.push(
              `${site.id} illegal NPC handoff ${previous.laneId} -> ${npc.laneId}`,
            );
          }
        }

        const internalNpc = traffic.npcs.find(
          (candidate) => candidate.id === npc.id,
        );
        if (!internalNpc) {
          violations.push(`${site.id} NPC lost its production traffic state`);
          break;
        }
        if (internalNpc.state === "lane-changing") {
          violations.push(
            `${site.id} entry traversal unexpectedly became a lateral lane change`,
          );
        }

        // `npcCornerPose` begins the reserved successor connector while
        // `laneId` still owns the source, then retains the same connector just
        // after the logical hop. Assert the exact seven-metre interpolation
        // from production traffic state. Nearest-surface projection is not an
        // authority here: the connector is deliberately between both profiles.
        const expectedProfile = authoritativeNpcElevationM(
          traffic,
          internalNpc,
        );
        const connectorProfileMismatchM = Math.abs(
          expectedProfile.elevationM - (npc.elevationM ?? 0),
        );
        maximumConnectorProfileMismatchM = Math.max(
          maximumConnectorProfileMismatchM,
          connectorProfileMismatchM,
        );
        if (connectorProfileMismatchM > 1e-8) {
          violations.push(
            `${site.id} ${npc.laneId} differs from its authoritative connector profile by ${connectorProfileMismatchM.toFixed(9)}m`,
          );
        }
        if (expectedProfile.onConnector) {
          connectorSampleCount += 1;
        }
        if (
          previous &&
          Math.abs((npc.elevationM ?? 0) - (previous.elevationM ?? 0)) > 0.08
        ) {
          violations.push(`${site.id} NPC elevation jumped in one fixed tick`);
        }
        previous = npc;

        if (
          visitedRoadIds.has(site.entry.rampSurfaceId) &&
          visitedRoadIds.has(MAINLINE_ID) &&
          maximumElevationM >= NYC_QUEENSVIEW_DECK_ELEVATION_M - 0.01
        ) {
          break;
        }
      }

      expect(violations.slice(0, 10)).toEqual([]);
      expect(
        maximumConnectorProfileMismatchM,
        `${site.id} authoritative connector/profile mismatch`,
      ).toBeLessThanOrEqual(1e-8);
      expect(connectorSampleCount, `${site.id} connector samples`).toBeGreaterThan(
        20,
      );
      expect(visitedRoadIds, `${site.id} entry slip`).toContain(
        site.entry.slipSurfaceId,
      );
      expect(visitedRoadIds, `${site.id} entry ramp`).toContain(
        site.entry.rampSurfaceId,
      );
      expect(visitedRoadIds, `${site.id} main deck`).toContain(MAINLINE_ID);
      expect(maximumElevationM, `${site.id} deck elevation`).toBeGreaterThanOrEqual(
        NYC_QUEENSVIEW_DECK_ELEVATION_M - 0.01,
      );
    }
  });

  it("uses one exact elevation profile for rendered surfaces and legal lanes", () => {
    let checkedLanePointCount = 0;
    for (const surface of networkSurfaces) {
      expect(surface.laneIds.length, surface.id).toBeGreaterThan(0);
      for (const laneId of surface.laneIds) {
        const lane = laneById.get(laneId);
        expect(lane, `${surface.id}:${laneId}`).toBeTruthy();
        expect(lane?.roadId, laneId).toBe(surface.id);
        for (const point of lane!.centerline) {
          checkedLanePointCount += 1;
          const projection = nearestSurfaceProjection(point, surface);
          expect(
            projection.distanceM,
            `${laneId} point lies within ${surface.id}`,
          ).toBeLessThanOrEqual(surface.widthM / 2 + 0.05);
          expect(
            Math.abs(projection.elevationM - (point.elevationM ?? 0)),
            `${laneId} point shares ${surface.id}'s elevation`,
          ).toBeLessThanOrEqual(0.001);
        }
      }
    }
    expect(checkedLanePointCount).toBeGreaterThan(1_000);
  });

  it("keeps stacked crossings on distinct graph nodes and free of controls", () => {
    const endpointUses = new Map<
      string,
      Array<{
        readonly roadId: string;
        readonly elevationM: number;
        readonly network: boolean;
      }>
    >();
    for (const lane of lanes) {
      for (const [nodeId, point] of [
        [lane.from, lane.centerline[0]],
        [lane.to, lane.centerline.at(-1)!],
      ] as const) {
        const bucket = endpointUses.get(nodeId) ?? [];
        bucket.push({
          roadId: lane.roadId,
          elevationM: point.elevationM ?? 0,
          network: networkSurfaceIds.has(lane.roadId),
        });
        endpointUses.set(nodeId, bucket);
      }
    }

    const crossLevelSharedNodes: string[] = [];
    for (const [nodeId, uses] of endpointUses) {
      const networkUses = uses.filter((use) => use.network);
      const ordinaryUses = uses.filter((use) => !use.network);
      for (const networkUse of networkUses) {
        for (const ordinaryUse of ordinaryUses) {
          if (
            Math.abs(networkUse.elevationM - ordinaryUse.elevationM) > 0.5
          ) {
            crossLevelSharedNodes.push(
              `${nodeId}: ${networkUse.roadId}@${networkUse.elevationM.toFixed(2)} / ${ordinaryUse.roadId}@${ordinaryUse.elevationM.toFixed(2)}`,
            );
          }
        }
      }
    }
    expect(crossLevelSharedNodes).toEqual([]);

    const networkNodeIds = new Set(
      lanes
        .filter((lane) => networkSurfaceIds.has(lane.roadId))
        .flatMap((lane) => [lane.from, lane.to]),
    );
    for (const control of NYC_MAP_PACK.laneGraph.controls) {
      expect(
        control.laneIds.some((laneId) =>
          networkSurfaceIds.has(laneById.get(laneId)?.roadId ?? ""),
        ),
        `${control.id} must not govern a free-flow bridge lane`,
      ).toBe(false);
      expect(
        control.approaches.some((approach) =>
          approach.laneIds.some((laneId) =>
            networkSurfaceIds.has(laneById.get(laneId)?.roadId ?? ""),
          ),
        ),
        `${control.id} must not install a stop line on the bridge`,
      ).toBe(false);
      expect(
        [...networkNodeIds].some((nodeId) => {
          const node = nodeById.get(nodeId);
          return (
            node !== undefined &&
            Math.hypot(
              node.position.x - control.position.x,
              node.position.z - control.position.z,
            ) < 0.05
          );
        }),
        `${control.id} must not occupy a bridge merge/diverge node`,
      ).toBe(false);
    }
  });
});
