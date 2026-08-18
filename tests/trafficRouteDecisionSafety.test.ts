import { describe, expect, it } from "vitest";

import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import type { NormalizedLane } from "../app/game/simulation/roadNetwork";
import type {
  NpcInternal,
  TrafficTickCtx,
} from "../app/game/simulation/trafficSystem";

interface RouteDecisionTrafficAccess {
  readonly npcs: readonly NpcInternal[];
  readonly roadNetwork: {
    readonly lanesById: ReadonlyMap<string, NormalizedLane>;
    pointOnLane(lane: NormalizedLane, distance: number): {
      x: number;
      z: number;
      heading: number;
    };
  };
  leadVehicleGap(
    lane: NormalizedLane,
    distance: number,
    ctx: TrafficTickCtx,
    excludedNpcId?: string,
  ): number | null;
  followingNpc(
    lane: NormalizedLane,
    playerDistance: number,
  ): { npc: NpcInternal; gap: number } | null;
  isNpcTravelClearOfRouteLeadingBodies(
    npc: NpcInternal,
    travel: number,
    includeRouteLeadingCandidates: boolean,
  ): boolean;
  npcOwnsSharedEndpoint(
    npc: NpcInternal,
    lane: NormalizedLane,
    other: NpcInternal,
    otherLane: NormalizedLane,
    envelopeM: number,
  ): boolean | null;
  isNpcTravelSpatiallyClear(npc: NpcInternal, travel: number): boolean;
  isNpcLaneEntryClear(npc: NpcInternal, target: NormalizedLane): boolean;
  advanceNpcAlongLegalRoute(
    npc: NpcInternal,
    distanceDelta: number,
    deltaSeconds: number,
    ctx: TrafficTickCtx,
  ): boolean;
  syncNpcSpatialIndex(npc: NpcInternal): void;
}

const tickCtx = (): TrafficTickCtx => ({
  viewHeading: 0,
  roadState: {
    projection: null,
    wrongWay: false,
    offRoad: false,
    inServiceArea: false,
  },
  elapsedSeconds: 0,
  tick: 0,
});

const access = (
  simulation: SimulationCore,
): RouteDecisionTrafficAccess =>
  (
    simulation as unknown as {
      readonly trafficSystem: RouteDecisionTrafficAccess;
    }
  ).trafficSystem;

const placeNpc = (
  traffic: RouteDecisionTrafficAccess,
  npc: NpcInternal,
  laneId: string,
  distance: number,
  speedMps = 6,
): void => {
  const lane = traffic.roadNetwork.lanesById.get(laneId)!;
  const pose = traffic.roadNetwork.pointOnLane(lane, distance);
  npc.active = true;
  npc.pendingRecycle = false;
  npc.laneId = lane.id;
  npc.distance = distance;
  npc.x = pose.x;
  npc.z = pose.z;
  npc.heading = pose.heading;
  npc.previousX = pose.x;
  npc.previousZ = pose.z;
  npc.speedMps = speedMps;
  npc.targetSpeedMps = speedMps;
  npc.desiredSpeedMps = Math.max(speedMps, 6);
  npc.state = "cruising";
  npc.targetLaneId = undefined;
  npc.struckUntilTick = 0;
  npc.activatedAtSeconds = Number.NEGATIVE_INFINITY;
  traffic.syncNpcSpatialIndex(npc);
};

function forkFixture(): SimulationCoreConfig {
  return {
    seed: 41,
    npcCount: 3,
    lanes: [
      {
        id: "fork-source",
        points: [
          { x: 0, z: 0 },
          { x: 100, z: 0 },
        ],
        speedLimitMps: 12,
        successorLaneIds: ["chosen-branch", "alternate-return"],
        loop: false,
      },
      {
        id: "chosen-branch",
        points: [
          { x: 100, z: 0 },
          { x: 300, z: 0 },
        ],
        speedLimitMps: 12,
        loop: false,
      },
      {
        id: "alternate-return",
        points: [
          { x: 100, z: 0 },
          { x: 100, z: 10 },
          { x: 0, z: 3.2 },
        ],
        speedLimitMps: 12,
        loop: false,
      },
    ],
    bounds: { minX: -20, maxX: 340, minZ: -20, maxZ: 40 },
    spawn: { x: -200, z: -200, heading: 0 },
    trafficGates: [
      { id: "source", laneId: "fork-source", distance: 20 },
      { id: "chosen", laneId: "chosen-branch", distance: 100 },
      { id: "alternate", laneId: "alternate-return", distance: 50 },
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

function sharedEndpointFixture(): SimulationCoreConfig {
  return {
    seed: 42,
    npcCount: 2,
    lanes: [
      {
        id: "lower-approach",
        roadId: "parallel-road",
        points: [
          { x: -120, z: -1.6 },
          { x: -10, z: -1.6 },
          { x: 0, z: 0 },
        ],
        speedLimitMps: 10,
        successorLaneIds: ["lower-exit"],
        loop: false,
      },
      {
        id: "upper-approach",
        roadId: "parallel-road",
        points: [
          { x: -120, z: 1.6 },
          { x: -10, z: 1.6 },
          { x: 0, z: 0 },
        ],
        speedLimitMps: 10,
        successorLaneIds: ["upper-exit"],
        loop: false,
      },
      {
        id: "lower-exit",
        roadId: "parallel-road",
        points: [
          { x: 0, z: 0 },
          { x: 10, z: -1.6 },
          { x: 120, z: -1.6 },
        ],
        speedLimitMps: 10,
        loop: false,
      },
      {
        id: "upper-exit",
        roadId: "parallel-road",
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 1.6 },
          { x: 120, z: 1.6 },
        ],
        speedLimitMps: 10,
        loop: false,
      },
    ],
    bounds: { minX: -140, maxX: 140, minZ: -30, maxZ: 30 },
    spawn: { x: 300, z: 300, heading: 0 },
    trafficGates: [
      { id: "lower", laneId: "lower-approach", distance: 20 },
      { id: "upper", laneId: "upper-approach", distance: 80 },
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

function cornerReservationFixture(): SimulationCoreConfig {
  return {
    seed: 73,
    npcCount: 2,
    lanes: [
      {
        id: "corner-source",
        points: [{ x: 0, z: -30 }, { x: 0, z: 0 }],
        speedLimitMps: 10,
        successorLaneIds: ["corner-target"],
        loop: false,
      },
      {
        id: "lower-slot-contender",
        points: [{ x: 30, z: 0 }, { x: 0, z: 0 }],
        speedLimitMps: 10,
        successorLaneIds: ["corner-target"],
        loop: false,
      },
      {
        id: "corner-target",
        points: [{ x: 0, z: 0 }, { x: -40, z: 0 }],
        speedLimitMps: 10,
        loop: false,
      },
    ],
    bounds: { minX: -60, maxX: 50, minZ: -50, maxZ: 50 },
    spawn: { x: 200, z: 200, heading: 0 },
    trafficGates: [
      { id: "contender", laneId: "lower-slot-contender", distance: 5 },
      { id: "owner", laneId: "corner-source", distance: 5 },
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

describe("NPC chosen-route and shared-endpoint safety", () => {
  it("ignores an alternate fork in following, passing obstruction, and swept-body narrow phases", () => {
    const simulation = new SimulationCore(forkFixture());
    try {
      const traffic = access(simulation);
      const [owner, trueLead, alternate] = traffic.npcs;
      const source = traffic.roadNetwork.lanesById.get("fork-source")!;
      const chosen = traffic.roadNetwork.lanesById.get("chosen-branch")!;
      const alternateLane = traffic.roadNetwork.lanesById.get(
        "alternate-return",
      )!;
      placeNpc(traffic, owner, source.id, 2);
      placeNpc(traffic, trueLead, chosen.id, 100);
      placeNpc(traffic, alternate, alternateLane.id, alternateLane.length - 2);

      expect(
        Math.hypot(owner.x - alternate.x, owner.z - alternate.z),
      ).toBeLessThan(3.8);
      expect(
        traffic.leadVehicleGap(source, owner.distance, tickCtx(), owner.id),
      ).toBeCloseTo(198, 6);
      // The preceding broad phase marked both graph branches. A real chosen
      // lead makes the route-leading body probe active, but the close car on
      // the unchosen return arm must still not recreate the 3.2 m deadlock.
      expect(
        traffic.isNpcTravelClearOfRouteLeadingBodies(owner, 2, true),
      ).toBe(true);
      // The player/passing monitor must likewise not call this identity a
      // follower merely because *some* successor reaches the queried branch.
      expect(traffic.followingNpc(alternateLane, 2)).toBeNull();
    } finally {
      simulation.dispose();
    }
  });

  it("lets both parallel approaches progress through a shared node without overlap", () => {
    const simulation = new SimulationCore(sharedEndpointFixture());
    try {
      const traffic = access(simulation);
      const [lower, upper] = traffic.npcs;
      const lowerLane = traffic.roadNetwork.lanesById.get("lower-approach")!;
      const upperLane = traffic.roadNetwork.lanesById.get("upper-approach")!;
      placeNpc(traffic, lower, lowerLane.id, lowerLane.length - 12);
      placeNpc(traffic, upper, upperLane.id, upperLane.length - 12);

      let minimumSeparationM = Number.POSITIVE_INFINITY;
      let bothCleared = false;
      for (let tick = 0; tick < 600; tick += 1) {
        const snapshot = simulation.step(FIXED_STEP_SECONDS);
        const first = snapshot.npcs.find((npc) => npc.id === lower.id)!;
        const second = snapshot.npcs.find((npc) => npc.id === upper.id)!;
        minimumSeparationM = Math.min(
          minimumSeparationM,
          Math.hypot(first.x - second.x, first.z - second.z),
        );
        if (
          lower.laneId === "lower-exit" &&
          upper.laneId === "upper-exit" &&
          lower.distance > 12 &&
          upper.distance > 12
        ) {
          bothCleared = true;
          break;
        }
      }
      expect(bothCleared).toBe(true);
      expect(minimumSeparationM).toBeGreaterThanOrEqual(2.05 - 1e-6);
    } finally {
      simulation.dispose();
    }
  });

  it("does not let a blocked low-slot follower own the node or weaken body/player-box safety", () => {
    const simulation = new SimulationCore(sharedEndpointFixture());
    try {
      const simulationAccess = simulation as unknown as {
        readonly playerState: {
          readonly player: { x: number; z: number; heading: number };
        };
      };
      const traffic = access(simulation);
      const [lower, upper] = traffic.npcs;
      const lowerLane = traffic.roadNetwork.lanesById.get("lower-approach")!;
      const upperLane = traffic.roadNetwork.lanesById.get("upper-approach")!;
      const upperExit = traffic.roadNetwork.lanesById.get("upper-exit")!;
      placeNpc(traffic, lower, lowerLane.id, lowerLane.length - 4, 0);
      placeNpc(traffic, upper, upperLane.id, upperLane.length - 4, 6);
      lower.state = "following";
      lower.targetSpeedMps = 0;

      expect(
        traffic.npcOwnsSharedEndpoint(
          upper,
          upperLane,
          lower,
          lowerLane,
          15,
        ),
      ).toBe(true);
      expect(traffic.isNpcLaneEntryClear(upper, upperExit)).toBe(true);
      // Ownership resolves topology only. At four metres from the common node
      // the bodies have not established the 2.05 m physical gap, so the
      // independent swept envelope still refuses this particular move.
      expect(traffic.isNpcTravelSpatiallyClear(upper, 0.1)).toBe(false);

      lower.state = "cruising";
      lower.targetSpeedMps = 6;
      expect(
        traffic.npcOwnsSharedEndpoint(
          upper,
          upperLane,
          lower,
          lowerLane,
          15,
        ),
      ).toBe(false);

      // With the other contender gone, a stationary player eight metres down
      // the exact successor still owns the junction box. The prior six-metre
      // Euclidean-only check admitted the NPC and left its body in the node.
      lower.active = false;
      traffic.syncNpcSpatialIndex(lower);
      const playerPose = traffic.roadNetwork.pointOnLane(upperExit, 8);
      simulationAccess.playerState.player.x = playerPose.x;
      simulationAccess.playerState.player.z = playerPose.z;
      simulationAccess.playerState.player.heading = playerPose.heading;
      expect(traffic.isNpcLaneEntryClear(upper, upperExit)).toBe(false);
    } finally {
      simulation.dispose();
    }
  });

  it("reserves a successor before the corner arc and never strands a half-turned car", () => {
    const simulation = new SimulationCore(cornerReservationFixture());
    try {
      const simulationAccess = simulation as unknown as {
        readonly playerState: {
          readonly player: { x: number; z: number; heading: number };
        };
      };
      const traffic = access(simulation);
      const [contender, owner] = traffic.npcs;
      const source = traffic.roadNetwork.lanesById.get("corner-source")!;
      const contenderLane = traffic.roadNetwork.lanesById.get(
        "lower-slot-contender",
      )!;
      const target = traffic.roadNetwork.lanesById.get("corner-target")!;
      contender.active = false;
      traffic.syncNpcSpatialIndex(contender);
      placeNpc(traffic, owner, source.id, 22.75, 6);

      // With the player occupying the first rendered-car length of the target,
      // a one-metre request advances only to the raw pre-arc boundary. The old
      // endpoint check reached 29.98 m and rendered the car half-turned.
      const blockedStart = { x: owner.x, z: owner.z };
      const playerInTarget = traffic.roadNetwork.pointOnLane(target, 8);
      simulationAccess.playerState.player.x = playerInTarget.x;
      simulationAccess.playerState.player.z = playerInTarget.z;
      simulationAccess.playerState.player.heading = playerInTarget.heading;
      expect(
        traffic.advanceNpcAlongLegalRoute(
          owner,
          1,
          FIXED_STEP_SECONDS,
          tickCtx(),
        ),
      ).toBe(false);
      expect(owner.laneId).toBe(source.id);
      expect(owner.distance).toBeCloseTo(23, 9);
      expect(owner.x).toBeCloseTo(0, 9);
      expect(owner.z).toBeCloseTo(-7, 9);
      expect(
        Math.hypot(owner.x - blockedStart.x, owner.z - blockedStart.z),
      ).toBeCloseTo(0.25, 9);
      expect(owner.successorReservationLaneId).toBeUndefined();

      // Once clear, the next fixed movement acquires ownership before the
      // rendered body leaves its source centreline.
      simulationAccess.playerState.player.x = 200;
      simulationAccess.playerState.player.z = 200;
      owner.speedMps = 6;
      owner.targetSpeedMps = 6;
      owner.state = "cruising";
      simulation.step(FIXED_STEP_SECONDS);
      expect(owner.successorReservationFromLaneId).toBe(source.id);
      expect(owner.successorReservationLaneId).toBe(target.id);

      // A lower-slot contender cannot steal the shared node even while the
      // valid owner is temporarily control-held/pending.
      placeNpc(traffic, contender, contenderLane.id, 23, 0);
      owner.state = "following";
      owner.speedMps = 0;
      owner.targetSpeedMps = 0;
      owner.pendingRecycle = true;
      expect(traffic.isNpcLaneEntryClear(contender, target)).toBe(false);
      expect(
        traffic.npcOwnsSharedEndpoint(
          contender,
          contenderLane,
          owner,
          source,
          15,
        ),
      ).toBe(false);
      contender.active = false;
      traffic.syncNpcSpatialIndex(contender);

      // A player arriving inside the conservative buffer on the source side
      // may not be hit, but the owner may keep moving away and clear the arc.
      // Per-tick pose deltas prove there is no endpoint snap or rewind.
      owner.pendingRecycle = false;
      owner.state = "cruising";
      owner.speedMps = 6;
      owner.targetSpeedMps = 6;
      simulationAccess.playerState.player.x = 3;
      simulationAccess.playerState.player.z = -7;
      simulationAccess.playerState.player.heading = Math.PI / 2;
      let prior = { x: owner.x, z: owner.z };
      let minimumPlayerSeparation = Math.hypot(
        owner.x - simulationAccess.playerState.player.x,
        owner.z - simulationAccess.playerState.player.z,
      );
      let maximumPoseDelta = 0;
      let cleared = false;
      for (let tick = 0; tick < 300; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS);
        const poseDelta = Math.hypot(owner.x - prior.x, owner.z - prior.z);
        maximumPoseDelta = Math.max(maximumPoseDelta, poseDelta);
        minimumPlayerSeparation = Math.min(
          minimumPlayerSeparation,
          Math.hypot(
            owner.x - simulationAccess.playerState.player.x,
            owner.z - simulationAccess.playerState.player.z,
          ),
        );
        prior = { x: owner.x, z: owner.z };
        if (owner.laneId === target.id && owner.distance > 7) {
          cleared = true;
          break;
        }
      }
      expect(cleared).toBe(true);
      expect(owner.successorReservationFromLaneId).toBeUndefined();
      expect(owner.successorReservationLaneId).toBeUndefined();
      expect(maximumPoseDelta).toBeLessThanOrEqual(0.2);
      expect(minimumPlayerSeparation).toBeGreaterThanOrEqual(2.05);
    } finally {
      simulation.dispose();
    }
  });
});
