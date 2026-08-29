import { describe, expect, it } from "vitest";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import type {
  NpcInternal,
  TrafficTickCtx,
} from "../app/game/simulation/trafficSystem";
import {
  RoadNetwork,
  type NormalizedLane,
  type SimulationLane,
} from "../app/game/simulation/roadNetwork";
import {
  LOCAL_TRAFFIC_INNER_RADIUS_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
} from "../app/game/simulation/trafficLocality";

const ROUTE_GOAL_NONE = 0;
const ROUTE_GOAL_FORWARD = 2;
const ROUTE_GOAL_APPROACH = 3;

function routeGoalFixture(): SimulationCoreConfig {
  const shortHopPoints = Array.from({ length: 12 }, (_, index) => ({
    x: -500 + (600 * index) / 11,
    z: 70,
  }));
  shortHopPoints.push({ x: 100, z: 0 });
  const shortHopLanes = Array.from({ length: 12 }, (_, index) => ({
    id: `too-many-hops-${index + 1}`,
    roadId: "test-many-hop-route",
    points: [shortHopPoints[index], shortHopPoints[index + 1]],
    speedLimitMps: 30,
    successorLaneIds: [
      index === 11
        ? "forward-current-road"
        : `too-many-hops-${index + 2}`,
    ],
    loop: false,
  }));
  return {
    seed: 8642,
    npcCount: 1,
    lanes: [
      {
        id: "player-road",
        roadId: "test-current-road",
        points: [{ x: -100, z: 0 }, { x: 100, z: 0 }],
        speedLimitMps: 30,
        successorLaneIds: [
          "forward-current-road",
          "forward-current-road-alt",
        ],
        loop: false,
      },
      {
        id: "straddling-parallel-road",
        roadId: "test-current-road",
        points: [{ x: -600, z: 4 }, { x: 600, z: 4 }],
        speedLimitMps: 30,
        loop: false,
      },
      {
        id: "unsafe-forward-predecessor",
        roadId: "test-current-road",
        points: [{ x: -700, z: 4 }, { x: -600, z: 4 }],
        speedLimitMps: 30,
        successorLaneIds: ["straddling-parallel-road"],
        loop: false,
      },
      {
        id: "straddling-opposing-road",
        roadId: "test-current-road",
        points: [{ x: 600, z: -4 }, { x: -600, z: -4 }],
        speedLimitMps: 30,
        loop: false,
      },
      {
        id: "hidden-feed",
        roadId: "test-feed-road",
        points: [{ x: 100, z: 650 }, { x: 100, z: 500 }],
        // Keep the committed production free-flow ETA (startup plus the
        // bounded path below) inside thirty seconds. Slower synthetic routes
        // are covered separately by the streamability-capacity regression.
        speedLimitMps: 40,
        successorLaneIds: ["ordinary-away", "goal-a", "goal-alt-a"],
        loop: false,
      },
      {
        id: "ordinary-away",
        roadId: "test-away-road",
        points: [{ x: 100, z: 500 }, { x: 1_200, z: 500 }],
        speedLimitMps: 30,
        loop: false,
      },
      {
        id: "goal-a",
        roadId: "test-connector-a",
        points: [{ x: 100, z: 500 }, { x: 100, z: 300 }],
        speedLimitMps: 40,
        successorLaneIds: ["goal-b"],
        loop: false,
      },
      {
        id: "goal-b",
        roadId: "test-connector-b",
        points: [{ x: 100, z: 300 }, { x: 100, z: 0 }],
        speedLimitMps: 40,
        successorLaneIds: ["forward-current-road"],
        loop: false,
      },
      {
        id: "goal-alt-a",
        roadId: "test-alt-connector-a",
        points: [{ x: 100, z: 500 }, { x: 200, z: 300 }],
        speedLimitMps: 30,
        successorLaneIds: ["goal-alt-b"],
        loop: false,
      },
      {
        id: "goal-alt-b",
        roadId: "test-alt-connector-b",
        points: [{ x: 200, z: 300 }, { x: 100, z: 0 }],
        speedLimitMps: 30,
        successorLaneIds: ["forward-current-road-alt"],
        loop: false,
      },
      {
        id: "forward-current-road",
        roadId: "test-current-road",
        points: [{ x: 100, z: 0 }, { x: 300, z: 0 }],
        speedLimitMps: 30,
        successorLaneIds: ["goal-exit"],
        loop: false,
      },
      {
        id: "goal-exit",
        roadId: "test-current-road",
        points: [{ x: 300, z: 0 }, { x: 1_500, z: 0 }],
        speedLimitMps: 30,
        loop: false,
      },
      {
        id: "forward-current-road-alt",
        roadId: "test-current-road",
        points: [{ x: 100, z: 0 }, { x: 400, z: 4 }],
        speedLimitMps: 30,
        successorLaneIds: ["goal-alt-exit"],
        loop: false,
      },
      {
        id: "goal-alt-exit",
        roadId: "test-current-road",
        points: [{ x: 400, z: 4 }, { x: 1_500, z: 4 }],
        speedLimitMps: 30,
        loop: false,
      },
      {
        id: "multi-label-feed",
        roadId: "test-multi-label-feed",
        points: [{ x: -600, z: 70 }, { x: -500, z: 70 }],
        speedLimitMps: 30,
        successorLaneIds: ["too-many-hops-1", "bounded-hop-detour"],
        loop: false,
      },
      ...shortHopLanes,
      {
        id: "bounded-hop-detour",
        roadId: "test-bounded-hop-route",
        points: [
          { x: -500, z: 70 },
          { x: -200, z: 220 },
          { x: 100, z: 70 },
          { x: 100, z: 0 },
        ],
        speedLimitMps: 30,
        successorLaneIds: ["forward-current-road"],
        loop: false,
      },
    ],
    bounds: { minX: -700, maxX: 1_600, minZ: -20, maxZ: 700 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [
      {
        id: "remote-authored-style",
        laneId: "ordinary-away",
        distance: 800,
        variant: "car",
        desiredSpeedMps: 25,
      },
    ],
    runtimeTrafficPortals: [
      {
        id: "hidden-goal-feed",
        laneId: "hidden-feed",
        distance: 30,
        x: 100,
        z: 620,
        heading: Math.PI,
      },
    ],
    trafficCapacityLaneIds: [
      "player-road",
      "straddling-parallel-road",
      "unsafe-forward-predecessor",
      "straddling-opposing-road",
      "hidden-feed",
      "ordinary-away",
      "goal-a",
      "goal-b",
      "goal-alt-a",
      "goal-alt-b",
      "forward-current-road",
      "goal-exit",
      "forward-current-road-alt",
      "goal-alt-exit",
      "multi-label-feed",
      ...shortHopLanes.map((lane) => lane.id),
      "bounded-hop-detour",
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** Hidden feeders deliberately converge on a small number of destination
 * intervals. Structural capacity must count those unique target slots, not
 * the number of source portals that happen to reach them. */
function streamableTargetFixture(options: {
  readonly feederCount: number;
  readonly targetCount?: number;
  readonly targetLengthM?: number;
  readonly feederSpeedLimitMps?: number;
  readonly includeTargetCapacity?: boolean;
  readonly npcCount?: number;
}): SimulationCoreConfig {
  const targetCount = options.targetCount ?? 1;
  const targetLengthM = options.targetLengthM ?? 112;
  const feederSpeedLimitMps = options.feederSpeedLimitMps ?? 50;
  const targetLanes: SimulationLane[] = Array.from(
    { length: targetCount },
    (_, index) => ({
      id: `stream-target-${index}`,
      roadId: "stream-current-road",
      // Opposing lanes start in the player's forward half-plane, so a hidden
      // predecessor may safely feed both CURRENT and FORWARD without crossing
      // through the stationary player first.
      points: [
        { x: targetLengthM, z: 4 + index * 4 },
        { x: 0, z: 4 + index * 4 },
      ],
      speedLimitMps: 30,
      successorLaneIds: [`stream-exit-${index}`],
      loop: false,
    }),
  );
  const exitLanes: SimulationLane[] = Array.from(
    { length: targetCount },
    (_, index) => ({
      id: `stream-exit-${index}`,
      roadId: "stream-current-road",
      points: [
        { x: 0, z: 4 + index * 4 },
        { x: -1_000, z: 4 + index * 4 },
      ],
      speedLimitMps: 30,
      loop: false,
    }),
  );
  const crossTargetLanes: SimulationLane[] = Array.from(
    { length: 2 },
    (_, index) => {
      const x = index === 0 ? -4 : 4;
      return {
        id: `stream-cross-target-${index}`,
        roadId: `stream-cross-road-${index}`,
        points: [{ x, z: 112 }, { x, z: -300 }],
        speedLimitMps: 30,
        successorLaneIds: [`stream-cross-exit-${index}`],
        loop: false,
      };
    },
  );
  const crossExitLanes: SimulationLane[] = crossTargetLanes.map(
    (lane, index) => ({
      id: `stream-cross-exit-${index}`,
      roadId: lane.roadId,
      points: [lane.points[1], { x: lane.points[1].x, z: -1_300 }],
      speedLimitMps: 30,
      loop: false,
    }),
  );
  const crossFeederLanes: SimulationLane[] = Array.from(
    { length: 4 },
    (_, index) => {
      const target = crossTargetLanes[index % crossTargetLanes.length];
      return {
        id: `stream-cross-feed-${index}`,
        roadId: `stream-cross-feed-road-${index}`,
        points: [
          { x: 570, z: 112 + index * 28 },
          target.points[0],
        ],
        speedLimitMps: 50,
        successorLaneIds: [target.id],
        loop: false,
      };
    },
  );
  const feederLanes: SimulationLane[] = Array.from(
    { length: options.feederCount },
    (_, index) => {
      const targetIndex = index % targetCount;
      return {
        id: `stream-feed-${index}`,
        roadId: `stream-feed-road-${index}`,
        points: [
          { x: targetLengthM + index * 28, z: 570 },
          { x: targetLengthM, z: 4 + targetIndex * 4 },
        ],
        speedLimitMps: feederSpeedLimitMps,
        successorLaneIds: [`stream-target-${targetIndex}`],
        loop: false,
      };
    },
  );
  return {
    seed: 97531,
    npcCount: options.npcCount ?? 1,
    lanes: [
      {
        id: "stream-player-road",
        roadId: "stream-current-road",
        points: [{ x: -60, z: 0 }, { x: 60, z: 0 }],
        speedLimitMps: 30,
        loop: false,
      },
      ...targetLanes,
      ...exitLanes,
      ...feederLanes,
      ...crossTargetLanes,
      ...crossExitLanes,
      ...crossFeederLanes,
    ],
    bounds: {
      minX: -1_050,
      maxX: Math.max(650, targetLengthM + options.feederCount * 28 + 50),
      minZ: -1_350,
      maxZ: 620,
    },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [],
    runtimeTrafficPortals: [...feederLanes, ...crossFeederLanes].map(
      (lane, index) => ({
        id: `stream-portal-${index}`,
        laneId: lane.id,
        distance: 0,
        x: lane.points[0].x,
        z: lane.points[0].z,
        heading: Math.atan2(
          lane.points[1].x - lane.points[0].x,
          lane.points[1].z - lane.points[0].z,
        ),
      }),
    ),
    trafficCapacityLaneIds: [
      "stream-player-road",
      ...(options.includeTargetCapacity === false
        ? []
        : targetLanes.map((lane) => lane.id)),
      ...exitLanes.map((lane) => lane.id),
      ...feederLanes.map((lane) => lane.id),
      ...crossTargetLanes.map((lane) => lane.id),
      ...crossExitLanes.map((lane) => lane.id),
      ...crossFeederLanes.map((lane) => lane.id),
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

interface RouteGoalTrafficAccess {
  readonly npcs: readonly NpcInternal[];
  readonly roadNetwork: {
    readonly lanesById: ReadonlyMap<string, NormalizedLane>;
    pointOnLane(
      lane: NormalizedLane,
      distance: number,
    ): { x: number; z: number; heading: number };
  };
  deactivateNpc(npc: NpcInternal): void;
  syncNpcSpatialIndex(npc: NpcInternal): void;
  recruitLocalNpcForApproachHandoff(ctx: TrafficTickCtx): boolean;
  makeTrafficDecisions(ctx: TrafficTickCtx): void;
  localityRouteGoalDistance(
    goal: number,
    lane: NormalizedLane | undefined,
    distance: number,
    hopBudget?: number,
  ): number;
  localityRouteGoalHops(
    goal: number,
    lane: NormalizedLane | undefined,
    hopBudget?: number,
  ): number;
  localityRouteGoalIsReachable(
    goal: number,
    lane: NormalizedLane | undefined,
    distance: number,
    maximumRouteDistanceM?: number,
    maximumHops?: number,
  ): boolean;
  nextLaneForNpcAtTransition(
    npc: NpcInternal,
    lane: NormalizedLane,
    transitionCount: number,
    goal?: number,
    remainingHops?: number,
  ): NormalizedLane | null;
  npcRouteCanReachLocalRadius(
    npc: NpcInternal,
    firstLane: NormalizedLane | undefined,
    firstDistance: number,
    radiusM: number,
    maximumRouteDistanceM?: number,
    maximumHops?: number,
  ): boolean;
  refreshLocalityPopulation(ctx: TrafficTickCtx): void;
  materializeLocalityRoutePlan(
    goal: number,
    lane: NormalizedLane | undefined,
    distance: number,
  ): {
    readonly successorLaneIndices: readonly number[];
    readonly targetLaneIndex: number;
    readonly targetEntryDistance: number;
    readonly targetExitDistance: number;
    readonly physicalDistanceM: number;
  } | null;
  assignNpcLocalityRoutePlan(
    npc: NpcInternal,
    plan: {
      readonly successorLaneIndices: readonly number[];
      readonly targetLaneIndex: number;
      readonly targetEntryDistance: number;
      readonly targetExitDistance: number;
      readonly physicalDistanceM: number;
    } | null,
  ): void;
  npcLocalityRoutePlanIsValid(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): boolean;
  npcLocalityRoutePlanRemainingDistance(
    npc: NpcInternal,
    lane: NormalizedLane | undefined,
  ): number;
  localityAdmissionRouteTable(goal: number): {
    readonly physicalDistanceByHopBudget: Float64Array;
    readonly routingCostByHopBudget: Float64Array;
    readonly usedHopsByHopBudget: Uint16Array;
    readonly nextLaneIndexByHopBudget: Int32Array;
    readonly targetLaneIndexByHopBudget: Int32Array;
  } | null;
  advanceNpcAlongLegalRoute(
    npc: NpcInternal,
    distanceDelta: number,
    deltaSeconds: number,
    ctx: TrafficTickCtx,
  ): boolean;
}

function trafficAccess(simulation: SimulationCore): RouteGoalTrafficAccess {
  return (simulation as unknown as {
    readonly trafficSystem: RouteGoalTrafficAccess;
  }).trafficSystem;
}

describe("deterministic locality route goals", () => {
  it("projects shared junctions by heading within a global 0.1 m tie band", () => {
    const cross: SimulationLane = {
      id: "z-cross",
      points: [{ x: 0, z: -20 }, { x: 0, z: 20 }],
      loop: false,
    };
    const alignedAt = (id: string, z: number): SimulationLane => ({
      id,
      points: [{ x: -20, z }, { x: 20, z }],
      loop: false,
    });
    const preferredHeading = Math.PI / 2;
    const within = new RoadNetwork(
      [cross, alignedAt("b-aligned", 0.1), alignedAt("a-aligned", 0.1)],
      [],
      [],
    );
    // Omitted preferences preserve the legacy exact-nearest/authored-order
    // road-rules projection.
    expect(within.projectToRoad(0, 0)?.lane.id).toBe("z-cross");
    expect(
      within.projectToRoad(0, 0, { heading: preferredHeading })?.lane.id,
    ).toBe("a-aligned");
    const reversed = new RoadNetwork(
      [alignedAt("a-aligned", 0.1), alignedAt("b-aligned", 0.1), cross],
      [],
      [],
    );
    expect(
      reversed.projectToRoad(0, 0, { heading: preferredHeading })?.lane.id,
    ).toBe("a-aligned");
    const outside = new RoadNetwork(
      [cross, alignedAt("aligned-outside", 0.101)],
      [],
      [],
    );
    expect(
      outside.projectToRoad(0, 0, { heading: preferredHeading })?.lane.id,
    ).toBe("z-cross");
  });

  it("keeps stacked roads on the previously occupied lane and reports its height", () => {
    const ground: SimulationLane = {
      id: "ground",
      points: [{ x: 0, z: -20 }, { x: 0, z: 20 }],
      loop: false,
    };
    const bridge: SimulationLane = {
      id: "bridge",
      points: [
        { x: 0, z: -20, elevationM: 10.5 },
        { x: 0, z: 20, elevationM: 10.5 },
      ],
      loop: false,
    };
    const network = new RoadNetwork([ground, bridge], [], []);

    expect(network.projectToRoad(0, 0)?.lane.id).toBe("ground");
    expect(
      network.projectToRoad(0, 0, {
        heading: 0,
        preferredLaneId: "bridge",
      }),
    ).toMatchObject({ lane: { id: "bridge" }, elevationM: 10.5 });
  });

  it("reacquires the nearest ground lane after a transient intersection projection", () => {
    const ground: SimulationLane = {
      id: "ground-forward",
      points: [{ x: 0, z: -20 }, { x: 0, z: 20 }],
      loop: false,
    };
    const transientCrossing: SimulationLane = {
      id: "transient-crossing",
      points: [{ x: -20, z: 0 }, { x: 20, z: 0 }],
      loop: false,
    };
    const bridge: SimulationLane = {
      id: "stacked-bridge",
      points: [
        { x: 0, z: -20, elevationM: 10.5 },
        { x: 0, z: 20, elevationM: 10.5 },
      ],
      loop: false,
    };
    const network = new RoadNetwork(
      [transientCrossing, bridge, ground],
      [],
      [],
    );

    // A ground-height continuity preference filters out the flyover, but it
    // must not restrict the search to the crossing lane selected at the exact
    // junction on the previous tick. The through lane is now 1.0 m closer.
    expect(
      network.projectToRoad(0.017, 1, {
        heading: 0,
        preferredLaneId: "transient-crossing",
        preferredElevationM: 0,
      }),
    ).toMatchObject({ lane: { id: "ground-forward" }, elevationM: 0 });
  });

  it("keeps a ground projection below a remote flyover instead of releasing its height lock", () => {
    const ground: SimulationLane = {
      id: "remote-ground",
      points: [{ x: 20, z: 0 }, { x: 20, z: 30 }],
      loop: false,
    };
    const flyover: SimulationLane = {
      id: "overhead-deck",
      points: [
        { x: 0, z: 0, elevationM: 10.5 },
        { x: 0, z: 30, elevationM: 10.5 },
      ],
      loop: false,
    };
    const network = new RoadNetwork([ground, flyover], [], []);

    // The old 12 m capture radius abandoned the explicit ground layer here
    // and returned the plan-view-nearest deck, lifting the player by 10.5 m.
    expect(
      network.projectToRoad(0, 10, {
        heading: 0,
        preferredElevationM: 0,
      }),
    ).toMatchObject({
      lane: { id: "remote-ground" },
      distance: 20,
      elevationM: 0,
    });
  });

  it("keeps directed ramp capture legal-only by default but lets the player enter an exit backward", () => {
    const ramp: SimulationLane = {
      id: "raised-ramp",
      points: [
        { x: 0.3, z: 0, elevationM: 0 },
        { x: 0.3, z: 10, elevationM: 5 },
      ],
      loop: false,
    };
    const ground = (connected: boolean): SimulationLane => ({
      id: "through-ground",
      points: [{ x: 0, z: 0 }, { x: 0, z: 10 }],
      successorLaneIds: connected ? [ramp.id] : [],
      loop: false,
    });
    const project = (connected: boolean) =>
      new RoadNetwork([ground(connected), ramp], [], []).projectToRoad(
        0.26,
        1,
        {
          heading: 0,
          preferredLaneId: "through-ground",
          preferredElevationM: 0,
        },
      );

    // In plan view the ramp is 4 cm away and the street is 26 cm away. That
    // must not matter when the two lanes are unrelated: otherwise repeated
    // projections ratchet a through-street car all the way up the ramp.
    expect(project(false)).toMatchObject({
      lane: { id: "through-ground" },
      elevationM: 0,
    });
    const exitLane: SimulationLane = {
      ...ground(false),
      id: "ground-exit",
      points: [{ x: 0, z: 0 }, { x: 0, z: -10 }],
    };
    const descendingRamp: SimulationLane = {
      ...ramp,
      id: "descending-ramp",
      points: [...ramp.points].reverse(),
      successorLaneIds: [exitLane.id],
    };
    const exitNetwork = new RoadNetwork(
      [exitLane, descendingRamp],
      [],
      [],
    );
    expect(
      exitNetwork.projectToRoad(0.26, 1, {
        heading: 0,
        preferredLaneId: exitLane.id,
        preferredElevationM: 0,
      }),
    ).toMatchObject({ lane: { id: exitLane.id }, elevationM: 0 });
    expect(
      exitNetwork.projectToRoad(0.26, 1, {
        heading: 0,
        preferredLaneId: exitLane.id,
        preferredElevationM: 0,
        allowBidirectionalProfileCapture: true,
      }),
    ).toMatchObject({ lane: { id: descendingRamp.id }, elevationM: 0.5 });
    // The same geometry is a valid ramp entry when the authored graph says it
    // is the occupied lane's immediate successor.
    expect(project(true)).toMatchObject({
      lane: { id: "raised-ramp" },
      elevationM: 0.5,
    });
  });

  it("keeps a ramp projection at its continuous height when the road below is closer in plan view", () => {
    const ground: SimulationLane = {
      id: "ground",
      points: [{ x: 0, z: 0 }, { x: 0, z: 10 }],
      loop: false,
    };
    const ramp: SimulationLane = {
      id: "ramp",
      points: [
        { x: 1, z: 0, elevationM: 5 },
        { x: 1, z: 10, elevationM: 6 },
      ],
      loop: false,
    };
    const network = new RoadNetwork([ground, ramp], [], []);

    // In x/z the car is 0.3 m from the ground lane and 0.7 m from the ramp.
    // Its previous 5 m height is the missing third dimension: the projection
    // must remain on the ramp rather than snapping through its deck.
    expect(
      network.projectToRoad(0.3, 1, {
        heading: 0,
        preferredLaneId: "ramp",
        preferredElevationM: 5,
      }),
    ).toMatchObject({ lane: { id: "ramp" }, elevationM: 5.1 });

    // A wide, oblique merge can carry the car across a gore farther than the
    // old 6.5 m capture radius from every lane centre. It is still on the
    // continuous elevated route and must not fall through to the street.
    const wideGore = new RoadNetwork(
      [ground, { ...ramp, points: ramp.points.map((point) => ({ ...point, x: 9 })) }],
      [],
      [],
    );
    expect(
      wideGore.projectToRoad(0, 1, {
        heading: 0,
        preferredLaneId: "ramp",
        preferredElevationM: 5,
      })?.lane.id,
    ).toBe("ramp");

    // A stale height cannot glue a teleported car to a remote structure.
    const remoteRamp = new RoadNetwork(
      [ground, { ...ramp, points: ramp.points.map((point) => ({ ...point, x: 20 })) }],
      [],
      [],
    );
    expect(
      remoteRamp.projectToRoad(0, 1, {
        heading: 0,
        preferredLaneId: "ramp",
        preferredElevationM: 5,
      })?.lane.id,
    ).toBe("ground");
  });

  it("counts unique ETA-reachable destination slots instead of feeder portals", () => {
    const oneFeeder = new SimulationCore(
      streamableTargetFixture({ feederCount: 1 }),
    );
    const eightFeeders = new SimulationCore(
      streamableTargetFixture({ feederCount: 8 }),
    );
    const slowFeeders = new SimulationCore(
      streamableTargetFixture({
        feederCount: 8,
        feederSpeedLimitMps: 25,
      }),
    );
    const twoFullTargets = new SimulationCore(
      streamableTargetFixture({
        feederCount: 2,
        targetCount: 2,
        targetLengthM: 336,
      }),
    );
    const excludedTarget = new SimulationCore(
      streamableTargetFixture({
        feederCount: 8,
        includeTargetCapacity: false,
      }),
    );
    try {
      // One 112 m target has exactly four 28 m storage slots. Adding seven
      // more source portals that funnel into it cannot manufacture capacity.
      expect(oneFeeder.getTrafficDiagnostics().locality).toMatchObject({
        streamableCurrentRoadCapacity: 4,
        streamableForwardCorridorCapacity: 4,
      });
      expect(eightFeeders.getTrafficDiagnostics().locality).toMatchObject({
        streamableCurrentRoadCapacity: 4,
        streamableForwardCorridorCapacity: 4,
      });

      // The same 566 m feed at 0.68 of a 30 m/s limit needs more than the
      // immutable 30 s budget once the 2 s startup allowance is included.
      expect(slowFeeders.getTrafficDiagnostics().locality).toMatchObject({
        streamableCurrentRoadCapacity: 0,
        streamableForwardCorridorCapacity: 0,
        targetCurrentRoadCorridor: 1,
        targetForwardCorridor: 1,
        targetCorridorContinuityCompensation: 1,
      });

      // Two distinct long targets each contribute their desktop per-lane cap
      // of six. This is the fully streamable case used by long Cairo/NYC-like
      // corridors; the raw 12/8 directional targets remain feasible.
      expect(twoFullTargets.getTrafficDiagnostics().locality).toMatchObject({
        streamableCurrentRoadCapacity: 12,
        streamableForwardCorridorCapacity: 12,
        targetCurrentRoadCorridor: 1,
        targetForwardCorridor: 1,
        targetCorridorContinuityCompensation: 0,
      });

      // A geometrically aligned connector can classify a passing car, but it
      // cannot provide stable slots unless the authored capacity set permits
      // traffic to occupy it.
      expect(excludedTarget.getTrafficDiagnostics().locality).toMatchObject({
        streamableCurrentRoadCapacity: 0,
        streamableForwardCorridorCapacity: 0,
      });
    } finally {
      oneFeeder.dispose();
      eightFeeders.dispose();
      slowFeeders.dispose();
      twoFullTargets.dispose();
      excludedTarget.dispose();
    }
  });

  it("staggers destination-diverse independent approaches beside one corridor feed", () => {
    const simulation = new SimulationCore(
      streamableTargetFixture({ feederCount: 4, npcCount: 4 }),
    );
    try {
      const traffic = trafficAccess(simulation);
      for (const npc of traffic.npcs) traffic.deactivateNpc(npc);
      expect(traffic.npcs.every((npc) => !npc.active)).toBe(true);

      const approachAdmissionDecisions: number[] = [];
      let previousApproachCount = 0;
      for (let decision = 1; decision <= 40; decision += 1) {
        traffic.makeTrafficDecisions({
          viewHeading: Math.PI / 2,
          roadState: {
            projection: null,
            wrongWay: false,
            offRoad: false,
            inServiceArea: false,
          },
          elapsedSeconds: decision / 10,
          tick: decision * 6,
        });
        const approachCount = traffic.npcs.filter(
          (npc) => npc.active && npc.localityRouteGoal === 3,
        ).length;
        if (approachCount > previousApproachCount) {
          approachAdmissionDecisions.push(decision);
        }
        previousApproachCount = approachCount;
      }

      const approachGoals = traffic.npcs.filter(
        (npc) => npc.active && npc.localityRouteGoal === 3,
      );
      const corridorGoals = traffic.npcs.filter(
        (npc) =>
          npc.active &&
          (npc.localityRouteGoal === 1 || npc.localityRouteGoal === 2),
      );
      expect(approachGoals).toHaveLength(3);
      for (const approach of approachGoals) {
        expect(approach.localityCommitmentBits & (1 << 4)).not.toBe(0);
        expect(approach.localityCommitmentBits & (1 << 3)).toBe(0);
      }
      expect(approachAdmissionDecisions).toHaveLength(3);
      expect(
        approachAdmissionDecisions.slice(1).every(
          (decision, index) =>
            decision - approachAdmissionDecisions[index] >= 10,
        ),
      ).toBe(true);
      const targetLoads = new Map<number, number>();
      for (const approach of approachGoals) {
        targetLoads.set(
          approach.localityRoutePlanTargetLaneIndex,
          (targetLoads.get(approach.localityRoutePlanTargetLaneIndex) ?? 0) + 1,
        );
      }
      expect(targetLoads.size).toBeGreaterThanOrEqual(2);
      expect(Math.max(...targetLoads.values())).toBeLessThanOrEqual(2);
      expect(corridorGoals).toHaveLength(1);
      expect(corridorGoals[0].localityCommitmentBits & (1 << 2)).not.toBe(0);
      expect(simulation.getTrafficDiagnostics().locality).toMatchObject({
        targetNearView: 3,
        targetMovingNearView: 2,
        targetAheadJourneyCount: 3,
        approachRouteFeedAvailable: true,
        inboundPerceptualTransitCount: 3,
      });
    } finally {
      simulation.dispose();
    }
  });

  it("hands off a moving local civilian without lifecycle churn and never chases a recentered approach", () => {
    const fixture = streamableTargetFixture({
      feederCount: 4,
      npcCount: 4,
    });
    const first = new SimulationCore({ ...fixture, touchFirst: true });
    const second = new SimulationCore({ ...fixture, touchFirst: true });
    const context = (elapsedSeconds: number, tick: number): TrafficTickCtx => ({
      viewHeading: Math.PI / 2,
      roadState: {
        projection: null,
        wrongWay: false,
        offRoad: false,
        inServiceArea: false,
      },
      elapsedSeconds,
      tick,
    });
    const prepareAndRecruit = (
      simulation: SimulationCore,
    ): {
      readonly traffic: RouteGoalTrafficAccess;
      readonly npc: NpcInternal;
      readonly physical: Readonly<Record<string, unknown>>;
      readonly activationCount: number;
      readonly retirementCount: number;
    } => {
      const traffic = trafficAccess(simulation);
      for (const npc of traffic.npcs) traffic.deactivateNpc(npc);
      const candidateLanes = [
        traffic.roadNetwork.lanesById.get("stream-cross-target-0")!,
        traffic.roadNetwork.lanesById.get("stream-cross-target-1")!,
      ];
      for (let index = 0; index < 2; index += 1) {
        const npc = traffic.npcs[index]!;
        const lane = candidateLanes[index]!;
        const pose = traffic.roadNetwork.pointOnLane(lane, 0);
        npc.active = true;
        npc.patrol = false;
        npc.pendingRecycle = false;
        npc.laneId = lane.id;
        npc.distance = 0;
        npc.x = pose.x;
        npc.z = pose.z;
        npc.heading = pose.heading;
        npc.speedMps = 10;
        npc.desiredSpeedMps = 15;
        npc.targetSpeedMps = 15;
        npc.state = "cruising";
        npc.struckUntilTick = 0;
        traffic.syncNpcSpatialIndex(npc);
      }
      traffic.refreshLocalityPopulation(context(100, 6_000));
      const before = simulation.getTrafficDiagnostics().locality;
      const physical = traffic.npcs.slice(0, 2).map((npc) => ({
        id: npc.id,
        active: npc.active,
        laneId: npc.laneId,
        distance: npc.distance,
        x: npc.x,
        z: npc.z,
        heading: npc.heading,
        speedMps: npc.speedMps,
        desiredSpeedMps: npc.desiredSpeedMps,
        targetSpeedMps: npc.targetSpeedMps,
        state: npc.state,
        transitionCount: npc.transitionCount,
      }));
      expect(
        traffic.recruitLocalNpcForApproachHandoff(context(100, 6_000)),
      ).toBe(true);
      const recruited = traffic.npcs.filter(
        (npc) => npc.localityRouteGoal === ROUTE_GOAL_APPROACH,
      );
      expect(recruited).toHaveLength(1);
      // The route/arrival selector may prefer either geometric candidate;
      // the paired-core assertion below pins the deterministic winner and
      // exact immutable destination without assuming authored array order.
      expect(
        traffic.npcs.slice(0, 2).map((npc) => ({
          id: npc.id,
          active: npc.active,
          laneId: npc.laneId,
          distance: npc.distance,
          x: npc.x,
          z: npc.z,
          heading: npc.heading,
          speedMps: npc.speedMps,
          desiredSpeedMps: npc.desiredSpeedMps,
          targetSpeedMps: npc.targetSpeedMps,
          state: npc.state,
          transitionCount: npc.transitionCount,
        })),
      ).toEqual(physical);
      const after = simulation.getTrafficDiagnostics().locality;
      expect(after.activations).toBe(before.activations);
      expect(after.retirements).toBe(before.retirements);
      expect(after.localHandoffCount).toBe(before.localHandoffCount + 1);
      return {
        traffic,
        npc: recruited[0],
        physical: physical[recruited[0].slotIndex],
        activationCount: after.activations,
        retirementCount: after.retirements,
      };
    };

    try {
      const a = prepareAndRecruit(first);
      const b = prepareAndRecruit(second);
      expect({
        id: b.npc.id,
        laneIndices: [...b.npc.localityRoutePlanLaneIndices],
        targetLaneIndex: b.npc.localityRoutePlanTargetLaneIndex,
        targetEntry: b.npc.localityRoutePlanTargetDistance,
        targetExit: b.npc.localityRoutePlanTargetExitDistance,
      }).toEqual({
        id: a.npc.id,
        laneIndices: [...a.npc.localityRoutePlanLaneIndices],
        targetLaneIndex: a.npc.localityRoutePlanTargetLaneIndex,
        targetEntry: a.npc.localityRoutePlanTargetDistance,
        targetExit: a.npc.localityRoutePlanTargetExitDistance,
      });

      const access = first as unknown as {
        readonly playerState: {
          readonly player: { x: number; z: number; heading: number };
        };
      };
      const originalPlanStorage = a.npc.localityRoutePlanLaneIndices;
      const originalTarget = {
        laneIndex: a.npc.localityRoutePlanTargetLaneIndex,
        entry: a.npc.localityRoutePlanTargetDistance,
        exit: a.npc.localityRoutePlanTargetExitDistance,
        commitmentExpiry: a.npc.localityCommitmentExpiresAtSeconds,
        routeGoalExpiry: a.npc.localityRouteGoalExpiresAtSeconds,
      };
      access.playerState.player.x = 9;
      a.traffic.refreshLocalityPopulation(context(101, 6_060));
      expect(a.npc.localityRouteGoal).toBe(ROUTE_GOAL_APPROACH);
      expect(a.npc.localityRoutePlanLaneIndices).toBe(originalPlanStorage);
      expect({
        laneIndex: a.npc.localityRoutePlanTargetLaneIndex,
        entry: a.npc.localityRoutePlanTargetDistance,
        exit: a.npc.localityRoutePlanTargetExitDistance,
        commitmentExpiry: a.npc.localityCommitmentExpiresAtSeconds,
        routeGoalExpiry: a.npc.localityRouteGoalExpiresAtSeconds,
      }).toEqual(originalTarget);

      // Once the immutable destination is outside the current usefulness
      // window, only locality ownership is released. The authoritative car
      // remains exactly where it was, moving under its ordinary route policy.
      access.playerState.player.x = 500;
      a.traffic.refreshLocalityPopulation(context(102, 6_120));
      expect(a.npc.localityRouteGoal).toBe(ROUTE_GOAL_NONE);
      expect(a.npc.localityCommitmentBits).toBe(0);
      expect(a.npc.localityRoutePlanTargetLaneIndex).toBe(-1);
      expect({
        id: a.npc.id,
        active: a.npc.active,
        laneId: a.npc.laneId,
        distance: a.npc.distance,
        x: a.npc.x,
        z: a.npc.z,
        heading: a.npc.heading,
        speedMps: a.npc.speedMps,
        desiredSpeedMps: a.npc.desiredSpeedMps,
        targetSpeedMps: a.npc.targetSpeedMps,
        state: a.npc.state,
        transitionCount: a.npc.transitionCount,
      }).toEqual(a.physical);
      const finalDiagnostics = first.getTrafficDiagnostics().locality;
      expect(finalDiagnostics.activations).toBe(a.activationCount);
      expect(finalDiagnostics.retirements).toBe(a.retirementCount);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("admits a hidden goal path, follows it, clears it exactly, and resets deterministically", () => {
    const simulation = new SimulationCore(routeGoalFixture());
    try {
      const initialSnapshot = simulation.getSnapshot();
      const traffic = trafficAccess(simulation);
      const npc = traffic.npcs[0]!;
      const feed = traffic.roadNetwork.lanesById.get("hidden-feed")!;
      const straddlingLane = traffic.roadNetwork.lanesById.get(
        "straddling-parallel-road",
      )!;
      const opposingStraddlingLane = traffic.roadNetwork.lanesById.get(
        "straddling-opposing-road",
      )!;
      const unsafeForwardPredecessor = traffic.roadNetwork.lanesById.get(
        "unsafe-forward-predecessor",
      )!;
      const multiLabelFeed = traffic.roadNetwork.lanesById.get(
        "multi-label-feed",
      )!;

      expect(initialSnapshot.npcs).toHaveLength(1);
      expect(initialSnapshot.npcs[0].laneId).toBe("hidden-feed");
      expect(npc.localityRouteGoal).toBe(ROUTE_GOAL_FORWARD);
      expect(npc.localityRouteGoalRemainingHops).toBe(3);
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          feed,
          30,
        ),
      ).toBeCloseTo(620, 6);
      expect(
        traffic.localityRouteGoalHops(ROUTE_GOAL_FORWARD, feed),
      ).toBe(3);
      expect(
        traffic.localityRouteGoalIsReachable(
          ROUTE_GOAL_FORWARD,
          feed,
          30,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        ),
      ).toBe(true);

      // The ordinary identity hash takes the first away branch. The committed
      // goal follows the table's endpoint-continuous route instead, and the
      // radius predictor uses that same stored hop state.
      expect(
        traffic.nextLaneForNpcAtTransition(
          npc,
          feed,
          npc.transitionCount,
          ROUTE_GOAL_NONE,
          0,
        )?.id,
      ).toBe("ordinary-away");
      expect(
        traffic.nextLaneForNpcAtTransition(
          npc,
          feed,
          npc.transitionCount,
          ROUTE_GOAL_FORWARD,
          npc.localityRouteGoalRemainingHops,
        )?.id,
      ).toBe("goal-a");
      const storedGoal = npc.localityRouteGoal;
      const storedHops = npc.localityRouteGoalRemainingHops;
      npc.localityRouteGoal = ROUTE_GOAL_NONE;
      npc.localityRouteGoalRemainingHops = 0;
      expect(
        traffic.npcRouteCanReachLocalRadius(
          npc,
          feed,
          30,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        ),
      ).toBe(false);
      npc.localityRouteGoal = storedGoal;
      npc.localityRouteGoalRemainingHops = storedHops;
      expect(
        traffic.npcRouteCanReachLocalRadius(
          npc,
          feed,
          30,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        ),
      ).toBe(true);

      // Same-direction route entry behind a stationary player is never a
      // forward-feed seed: reaching its later forward interval would require
      // manufacturing a follower queue through the player pose.
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          straddlingLane,
          550,
        ),
      ).toBe(Number.POSITIVE_INFINITY);
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          straddlingLane,
          700,
        ),
      ).toBe(0);
      expect(
        traffic.localityRouteGoalIsReachable(
          ROUTE_GOAL_FORWARD,
          unsafeForwardPredecessor,
          unsafeForwardPredecessor.length,
        ),
      ).toBe(false);
      expect(
        traffic.materializeLocalityRoutePlan(
          ROUTE_GOAL_FORWARD,
          straddlingLane,
          550,
        ),
      ).toBeNull();
      expect(
        traffic.materializeLocalityRoutePlan(
          ROUTE_GOAL_FORWARD,
          straddlingLane,
          700,
        ),
      ).not.toBeNull();

      // An opposing lane starts in front and remains a safe target. A portal
      // before the exact interval gets remaining arclength, one inside
      // contributes now, and one after is conservatively rejected.
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          opposingStraddlingLane,
          100,
        ),
      ).toBeCloseTo(500 - Math.sqrt(440 ** 2 - 4 ** 2), 6);
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          opposingStraddlingLane,
          300,
        ),
      ).toBe(0);
      expect(
        traffic.localityRouteGoalDistance(
          ROUTE_GOAL_FORWARD,
          opposingStraddlingLane,
          700,
        ),
      ).toBe(Number.POSITIVE_INFINITY);

      // The geometrically shorter branch needs thirteen transitions. The
      // bounded `(lane,hops)` table retains the slightly longer legal branch
      // rather than letting an unbounded shortest path make this portal look
      // unreachable under the production twelve-hop contract.
      expect(
        traffic.localityRouteGoalHops(
          ROUTE_GOAL_FORWARD,
          multiLabelFeed,
        ),
      ).toBe(2);
      const boundedDetourDistance = traffic.localityRouteGoalDistance(
        ROUTE_GOAL_FORWARD,
        multiLabelFeed,
        multiLabelFeed.length,
      );
      expect(boundedDetourDistance).toBeGreaterThan(670);
      expect(boundedDetourDistance).toBeLessThanOrEqual(
        RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
      );
      const storedPlan = {
        successorLaneIndices: [...npc.localityRoutePlanLaneIndices],
        targetLaneIndex: npc.localityRoutePlanTargetLaneIndex,
        targetEntryDistance: npc.localityRoutePlanTargetDistance,
        targetExitDistance: npc.localityRoutePlanTargetExitDistance,
        physicalDistanceM: npc.localityCommitmentLastRouteDistanceM,
      };
      traffic.assignNpcLocalityRoutePlan(npc, null);
      expect(
        traffic.nextLaneForNpcAtTransition(
          npc,
          multiLabelFeed,
          0,
          ROUTE_GOAL_FORWARD,
          2,
        )?.id,
      ).toBe("bounded-hop-detour");
      traffic.assignNpcLocalityRoutePlan(npc, storedPlan);

      let firstTransitionLaneId: string | null = null;
      let sawTargetBeforeGoalCleared = false;
      for (let tick = 0; tick < 60 * 45; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS, { viewHeading: Math.PI / 2 });
        if (!firstTransitionLaneId && npc.laneId !== "hidden-feed") {
          firstTransitionLaneId = npc.laneId;
        }
        if (
          npc.laneId === "forward-current-road" &&
          npc.localityRouteGoal === ROUTE_GOAL_FORWARD
        ) {
          sawTargetBeforeGoalCleared = true;
        }
        if (npc.localityRouteGoal === ROUTE_GOAL_NONE) break;
      }
      expect(firstTransitionLaneId).toBe("goal-a");
      expect(sawTargetBeforeGoalCleared).toBe(true);
      expect(npc.laneId).toBe("forward-current-road");
      expect(npc.localityRouteGoal).toBe(ROUTE_GOAL_NONE);
      expect(npc.localityRouteGoalRemainingHops).toBe(0);

      expect(simulation.reset()).toEqual(initialSnapshot);
      const resetNpc = traffic.npcs[0]!;
      expect(resetNpc.localityRouteGoal).toBe(ROUTE_GOAL_FORWARD);
      expect(resetNpc.localityRouteGoalRemainingHops).toBe(3);

      // Expiry is the other bounded release path and must not leave a stale
      // destination route behind after its commitment bits are cleared.
      traffic.refreshLocalityPopulation({
        viewHeading: Math.PI / 2,
        roadState: {
          projection: null,
          wrongWay: false,
          offRoad: false,
          inServiceArea: false,
        },
        elapsedSeconds: 121,
        tick: 121 * 60,
      });
      expect(resetNpc.localityCommitmentBits).toBe(0);
      expect(resetNpc.localityRouteGoal).toBe(ROUTE_GOAL_NONE);
      expect(resetNpc.localityRouteGoalRemainingHops).toBe(0);

      // Load mutation invalidates/reuses the weighted admission table. The
      // next plan chooses a different forward target instead of repeating the
      // global nearest-target funnel.
      const cachedAdmissionTable = traffic.localityAdmissionRouteTable(
        ROUTE_GOAL_FORWARD,
      )!;
      expect(
        traffic.localityAdmissionRouteTable(ROUTE_GOAL_FORWARD),
      ).toBe(cachedAdmissionTable);
      const firstPlan = traffic.materializeLocalityRoutePlan(
        ROUTE_GOAL_FORWARD,
        feed,
        30,
      );
      expect(firstPlan).not.toBeNull();
      traffic.assignNpcLocalityRoutePlan(resetNpc, firstPlan);
      resetNpc.localityRouteGoal = ROUTE_GOAL_FORWARD;
      const rebuiltAdmissionTable = traffic.localityAdmissionRouteTable(
        ROUTE_GOAL_FORWARD,
      )!;
      expect(rebuiltAdmissionTable).not.toBe(cachedAdmissionTable);
      expect(rebuiltAdmissionTable.physicalDistanceByHopBudget).toBe(
        cachedAdmissionTable.physicalDistanceByHopBudget,
      );
      expect(rebuiltAdmissionTable.routingCostByHopBudget).toBe(
        cachedAdmissionTable.routingCostByHopBudget,
      );
      expect(rebuiltAdmissionTable.usedHopsByHopBudget).toBe(
        cachedAdmissionTable.usedHopsByHopBudget,
      );
      expect(rebuiltAdmissionTable.nextLaneIndexByHopBudget).toBe(
        cachedAdmissionTable.nextLaneIndexByHopBudget,
      );
      expect(rebuiltAdmissionTable.targetLaneIndexByHopBudget).toBe(
        cachedAdmissionTable.targetLaneIndexByHopBudget,
      );
      const secondPlan = traffic.materializeLocalityRoutePlan(
        ROUTE_GOAL_FORWARD,
        feed,
        30,
      );
      expect(secondPlan).not.toBeNull();
      expect(secondPlan?.targetLaneIndex).not.toBe(firstPlan?.targetLaneIndex);
    } finally {
      simulation.dispose();
    }
  });

  it("retargets a materialized plan to the current forward interval after player recentering", () => {
    const simulation = new SimulationCore(routeGoalFixture());
    try {
      const access = simulation as unknown as {
        readonly trafficSystem: RouteGoalTrafficAccess;
        readonly playerState: {
          readonly player: { x: number; z: number; heading: number };
        };
      };
      const traffic = access.trafficSystem;
      const npc = traffic.npcs[0]!;
      const lane = traffic.roadNetwork.lanesById.get(
        "straddling-opposing-road",
      )!;
      const plan = traffic.materializeLocalityRoutePlan(
        ROUTE_GOAL_FORWARD,
        lane,
        100,
      );
      expect(plan).not.toBeNull();
      traffic.assignNpcLocalityRoutePlan(npc, plan);
      npc.localityRouteGoal = ROUTE_GOAL_FORWARD;
      npc.localityRouteGoalRemainingHops = 0;
      npc.laneId = lane.id;
      npc.distance = 100;
      npc.x = 500;
      npc.z = -4;
      npc.heading = -Math.PI / 2;
      npc.active = true;
      npc.localityCommitmentBits = 1 << 3;
      npc.localityCommitmentExpiresAtSeconds = 30;
      npc.localityRouteGoalExpiresAtSeconds = 120;

      expect(traffic.npcLocalityRoutePlanIsValid(npc, lane)).toBe(true);
      expect(
        traffic.npcLocalityRoutePlanRemainingDistance(npc, lane),
      ).toBeCloseTo(500 - Math.sqrt(440 ** 2 - 4 ** 2), 6);

      const originalCommitmentExpiry = npc.localityCommitmentExpiresAtSeconds;
      const originalPlanStorage = npc.localityRoutePlanLaneIndices;

      // More than the eight-metre route-table anchor threshold shifts the
      // contribution interval on the same target lane. The active committed
      // identity is migrated transactionally, while the original no-progress
      // deadline remains evidence-based rather than renewing from recentering.
      access.playerState.player.x = 20;
      traffic.refreshLocalityPopulation({
        viewHeading: Math.PI / 2,
        roadState: {
          projection: null,
          wrongWay: false,
          offRoad: false,
          inServiceArea: false,
        },
        elapsedSeconds: 1,
        tick: 60,
      });
      expect(traffic.npcLocalityRoutePlanIsValid(npc, lane)).toBe(true);
      expect(
        traffic.npcLocalityRoutePlanRemainingDistance(npc, lane),
      ).toBeCloseTo(480 - Math.sqrt(440 ** 2 - 4 ** 2), 6);
      expect(npc.localityCommitmentExpiresAtSeconds).toBe(
        originalCommitmentExpiry,
      );
      expect(npc.localityRoutePlanLaneIndices).toBe(originalPlanStorage);

      access.playerState.player.x = 40;
      traffic.refreshLocalityPopulation({
        viewHeading: Math.PI / 2,
        roadState: {
          projection: null,
          wrongWay: false,
          offRoad: false,
          inServiceArea: false,
        },
        elapsedSeconds: 2,
        tick: 120,
      });
      expect(traffic.npcLocalityRoutePlanIsValid(npc, lane)).toBe(true);
      expect(npc.localityCommitmentExpiresAtSeconds).toBe(
        originalCommitmentExpiry,
      );
      expect(npc.localityRoutePlanLaneIndices).toBe(originalPlanStorage);

      // Once the identity lies beyond the newly projected contribution
      // interval, migration atomically cancels the stale destination rather
      // than letting it suppress moving-player demand for 30 seconds.
      access.playerState.player.x = 520;
      traffic.refreshLocalityPopulation({
        viewHeading: Math.PI / 2,
        roadState: {
          projection: null,
          wrongWay: false,
          offRoad: false,
          inServiceArea: false,
        },
        elapsedSeconds: 3,
        tick: 180,
      });
      expect(traffic.npcLocalityRoutePlanIsValid(npc, lane)).toBe(false);
      expect(
        traffic.npcLocalityRoutePlanRemainingDistance(npc, lane),
      ).toBe(Number.POSITIVE_INFINITY);
    } finally {
      simulation.dispose();
    }
  });

  it("defers an incompatible recenter until an owned corner hop completes", () => {
    const simulation = new SimulationCore(routeGoalFixture());
    try {
      const access = simulation as unknown as {
        readonly trafficSystem: RouteGoalTrafficAccess;
        readonly playerState: {
          readonly player: { x: number; z: number; heading: number };
        };
      };
      const traffic = access.trafficSystem;
      const npc = traffic.npcs[0]!;
      const source = traffic.roadNetwork.lanesById.get("hidden-feed")!;
      const reservedTarget = traffic.roadNetwork.lanesById.get("goal-a")!;
      const originalExpiry = npc.localityCommitmentExpiresAtSeconds;
      npc.successorReservationFromLaneId = source.id;
      npc.successorReservationLaneId = reservedTarget.id;

      // This recenter removes the old forward target. It may not redirect the
      // already-rendering turn to another first hop.
      access.playerState.player.x = 520;
      traffic.refreshLocalityPopulation({
        viewHeading: Math.PI / 2,
        roadState: {
          projection: null,
          wrongWay: false,
          offRoad: false,
          inServiceArea: false,
        },
        elapsedSeconds: 1,
        tick: 60,
      });
      expect(npc.localityRouteGoal).toBe(ROUTE_GOAL_FORWARD);
      expect(npc.localityRoutePlanDeferredUntilReservationClears).toBe(true);
      expect(npc.localityCommitmentExpiresAtSeconds).toBe(originalExpiry);
      expect(
        traffic.nextLaneForNpcAtTransition(
          npc,
          source,
          npc.transitionCount,
        )?.id,
      ).toBe(reservedTarget.id);

      expect(
        traffic.advanceNpcAlongLegalRoute(npc, 121, FIXED_STEP_SECONDS, {
          viewHeading: Math.PI / 2,
          roadState: {
            projection: null,
            wrongWay: false,
            offRoad: false,
            inServiceArea: false,
          },
          elapsedSeconds: 1,
          tick: 60,
        }),
      ).toBe(true);
      expect(npc.laneId).toBe(reservedTarget.id);
      expect(npc.successorReservationLaneId).toBeUndefined();
      expect(npc.localityRoutePlanDeferredUntilReservationClears).toBe(false);
      expect(npc.localityRouteGoal).toBe(ROUTE_GOAL_NONE);
      expect(npc.localityCommitmentBits).toBe(0);
    } finally {
      simulation.dispose();
    }
  });
});
