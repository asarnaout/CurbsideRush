import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import type { NpcInternal, TrafficTickCtx } from "../app/game/simulation/trafficSystem";
import {
  buildSimulationCoreConfig,
  buildRuntimeTrafficPortals,
  buildTrafficLocalityConfig,
  isRuntimeTrafficPortalLane,
} from "../app/game/simulationAdapter";
import {
  LOCAL_TRAFFIC_FOG_RADIUS_M,
  LOCAL_TRAFFIC_INNER_RADIUS_M,
  LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
  LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
  LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
  PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
  RUNTIME_TRAFFIC_APPROACH_MAX_M,
  RUNTIME_TRAFFIC_APPROACH_MIN_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  RUNTIME_TRAFFIC_PORTAL_ENDPOINT_SETBACK_M,
  RuntimeTrafficPortalIndex,
  localTrafficCorridorLaneLengthsM,
  localTrafficLaneLengthM,
  resolveLocalTrafficTargets,
  resolveTopologyAwareLocalTrafficTargets,
} from "../app/game/simulation/trafficLocality";

/**
 * A deliberately sparse straight road makes the moving-window lifecycle
 * observable without map-specific traffic light or junction timing. Four
 * freshly primed cars begin near x=0; moving the player to x=1000 puts those
 * slots safely beyond the recycle radius, while the two named opposite-lane
 * portals remain in the exported inbound approach band.
 */
function movingRecycleFixture(laneSpeedMps = 2): SimulationCoreConfig {
  const outboundLaneId = "locality-lifecycle-outbound";
  const inboundLaneId = "locality-lifecycle-inbound";
  const outboundPortal = (id: string, x: number) => ({
    id,
    laneId: outboundLaneId,
    distance: x + 2_000,
    x,
    z: 0,
    heading: Math.PI / 2,
  });
  const inboundPortal = (id: string, x: number) => ({
    id,
    laneId: inboundLaneId,
    distance: 2_000 - x,
    x,
    z: 4,
    heading: -Math.PI / 2,
  });
  return {
    seed: 123,
    npcCount: 4,
    lanes: [
      {
        id: outboundLaneId,
        points: [{ x: -2_000, z: 0 }, { x: 2_000, z: 0 }],
        speedLimitMps: laneSpeedMps,
        loop: false,
      },
      {
        // The opposite carriageway supplies a car that is both forward of
        // the player's +x road projection and physically approaching it. This
        // keeps the lifecycle fixture valid under the corridor hard gates.
        id: inboundLaneId,
        points: [{ x: 2_000, z: 4 }, { x: -2_000, z: 4 }],
        speedLimitMps: laneSpeedMps,
        loop: false,
      },
    ],
    bounds: { minX: -2_100, maxX: 2_100, minZ: -20, maxZ: 20 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [],
    runtimeTrafficPortals: [
      outboundPortal("local-a", -220),
      outboundPortal("local-b", -140),
      outboundPortal("local-c", -60),
      outboundPortal("local-d", 60),
      inboundPortal("approach-a", 1_600),
      inboundPortal("approach-b", 1_650),
    ],
    trafficCapacityLaneIds: [outboundLaneId, inboundLaneId],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** One queued identity is deliberately made patrol-ineligible while a remote
 * non-patrol identity can supply the visible corridor through the sole hidden
 * portal. This pins the full-pool preflight transaction: an unusable queued
 * slot must not block a compatible retirement, and the retired identity must
 * reactivate only after its observable inactive tick. */
function compatiblePreflightFixture(): SimulationCoreConfig {
  const laneId = "preflight-opposing-road";
  return {
    seed: 321,
    npcCount: 2,
    touchFirst: true,
    lanes: [
      {
        id: "preflight-player-road",
        roadId: "preflight-road",
        points: [{ x: -1_000, z: 0 }, { x: 1_000, z: 0 }],
        speedLimitMps: 12,
        loop: false,
      },
      {
        id: laneId,
        roadId: "preflight-road",
        points: [{ x: 1_000, z: 4 }, { x: -1_000, z: 4 }],
        speedLimitMps: 12,
        loop: false,
      },
    ],
    bounds: { minX: -1_100, maxX: 1_100, minZ: -20, maxZ: 20 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [],
    runtimeTrafficPortals: [
      {
        id: "preflight-hidden-forward",
        laneId,
        distance: 400,
        x: 600,
        z: 4,
        heading: -Math.PI / 2,
      },
    ],
    trafficCapacityLaneIds: ["preflight-player-road", laneId],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** The decoy portal faces the player and has a legal branch into the fog, but
 * `npc-1` deterministically takes its alphabetically first away branch. The
 * connected portal instead takes a legal 718 m detour before entering the
 * inner circle. Keeping both in the exported approach band proves that selection
 * follows the NPC's real successor choice rather than an existential graph
 * path, while accepting Cairo-like routes beyond the old 450 m horizon. */
function routeConnectedApproachFixture(): SimulationCoreConfig {
  return {
    seed: 987,
    npcCount: 1,
    touchFirst: true,
    lanes: [
      {
        id: "initial",
        points: [{ x: -1_300, z: 0 }, { x: -700, z: 0 }],
        speedLimitMps: 2,
        loop: false,
      },
      {
        id: "decoy-in",
        points: [{ x: 650, z: 0 }, { x: 500, z: 0 }],
        speedLimitMps: 2,
        successorLaneIds: ["decoy-away", "decoy-inner"],
        loop: false,
      },
      {
        id: "decoy-away",
        points: [{ x: 500, z: 0 }, { x: 500, z: 300 }],
        speedLimitMps: 2,
        loop: false,
      },
      {
        id: "decoy-inner",
        points: [{ x: 500, z: 0 }, { x: 100, z: 0 }],
        speedLimitMps: 2,
        loop: false,
      },
      {
        id: "connected-in",
        points: [{ x: 650, z: 20 }, { x: 500, z: 20 }],
        speedLimitMps: 2,
        successorLaneIds: ["connected-detour-north"],
        loop: false,
      },
      {
        id: "connected-detour-north",
        points: [{ x: 500, z: 20 }, { x: 500, z: 270 }],
        speedLimitMps: 2,
        successorLaneIds: ["connected-detour-west"],
        loop: false,
      },
      {
        id: "connected-detour-west",
        points: [{ x: 500, z: 270 }, { x: 250, z: 270 }],
        speedLimitMps: 2,
        successorLaneIds: ["connected-inner"],
        loop: false,
      },
      {
        id: "connected-inner",
        points: [{ x: 250, z: 270 }, { x: 0, z: 20 }],
        speedLimitMps: 2,
        successorLaneIds: ["connected-exit"],
        loop: false,
      },
      {
        id: "connected-exit",
        points: [{ x: 0, z: 20 }, { x: -500, z: 20 }],
        speedLimitMps: 2,
        loop: false,
      },
    ],
    bounds: { minX: -1_400, maxX: 800, minZ: -100, maxZ: 400 },
    spawn: { x: -1_000, z: 0, heading: Math.PI / 2 },
    runtimeTrafficPortals: [
      {
        id: "initial-local",
        laneId: "initial",
        distance: 200,
        x: -1_100,
        z: 0,
        heading: Math.PI / 2,
      },
      {
        id: "a-tangent-decoy",
        laneId: "decoy-in",
        distance: 30,
        x: 620,
        z: 0,
        heading: -Math.PI / 2,
      },
      {
        id: "b-connected",
        laneId: "connected-in",
        distance: 50,
        x: 600,
        z: 20,
        heading: -Math.PI / 2,
      },
    ],
    trafficCapacityLaneIds: [
      "initial",
      "decoy-in",
      "decoy-away",
      "connected-in",
      "connected-detour-north",
      "connected-detour-west",
      "connected-inner",
      "connected-exit",
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** A tangent can face the player without supplying the local window. This
 * explicit authored car travels from the hidden approach band toward the
 * player, then its deterministic successor turns away before reaching 440 m.
 * It must not consume the controller's scarce route-connected inbound buffer.
 */
function tangentOnlyInboundTransitFixture(): SimulationCoreConfig {
  return {
    seed: 246,
    npcCount: 1,
    touchFirst: true,
    lanes: [
      {
        id: "tangent-approach",
        points: [{ x: 650, z: 0 }, { x: 500, z: 0 }],
        speedLimitMps: 2,
        successorLaneIds: ["turns-away"],
        loop: false,
      },
      {
        id: "turns-away",
        points: [{ x: 500, z: 0 }, { x: 500, z: 300 }],
        speedLimitMps: 2,
        loop: false,
      },
      {
        id: "connected-runtime-corridor",
        points: [{ x: 650, z: 20 }, { x: 0, z: 20 }],
        speedLimitMps: 2,
        loop: false,
      },
    ],
    bounds: { minX: -20, maxX: 700, minZ: -20, maxZ: 400 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [{
      id: "tangent-explicit-car",
      laneId: "tangent-approach",
      distance: 50,
      variant: "car",
      desiredSpeedMps: 2,
    }],
    runtimeTrafficPortals: [{
      id: "connected-runtime-portal",
      laneId: "connected-runtime-corridor",
      distance: 50,
      x: 600,
      z: 20,
      heading: -Math.PI / 2,
    }],
    trafficCapacityLaneIds: [
      "tangent-approach",
      "turns-away",
      "connected-runtime-corridor",
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** A stranded exceptional-recovery vehicle can remain outside presentation
 * while being physically unable to reach the ordinary 800 m recycle band.
 * This fixture fixes it one metre beyond the exported presentation envelope,
 * but below the activation minimum. */
function exceptionalRecycleFixture(): SimulationCoreConfig {
  const laneId = "exceptional-recycle-lane";
  const exceptionalX = PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M + 1;
  return {
    seed: 456,
    npcCount: 1,
    lanes: [{
      id: laneId,
      points: [{ x: -1_000, z: 0 }, { x: 1_000, z: 0 }],
      speedLimitMps: 1,
      loop: false,
    }],
    bounds: { minX: -1_100, maxX: 1_100, minZ: -20, maxZ: 20 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [{
      id: "exceptional-car",
      laneId,
      distance: 1_000 + exceptionalX,
      variant: "car",
      desiredSpeedMps: 1,
    }],
    runtimeTrafficPortals: [{
      id: "exceptional-approach",
      laneId,
      distance: 1_600,
      x: 600,
      z: 0,
      heading: Math.PI / 2,
    }],
    trafficCapacityLaneIds: [laneId],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** Generic vehicle spawns are still named authored gates. Locality must not
 * silently treat a missing variant label as permission to discard an intended
 * fresh-reset placement in favour of a runtime portal. */
function genericAuthoredInitialGateFixture(): SimulationCoreConfig {
  const laneId = "generic-authored-lane";
  return {
    seed: 654,
    npcCount: 1,
    lanes: [{
      id: laneId,
      points: [{ x: 0, z: 0 }, { x: 1_200, z: 0 }],
      speedLimitMps: 2,
      loop: false,
    }],
    bounds: { minX: -20, maxX: 1_300, minZ: -20, maxZ: 20 },
    spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    trafficGates: [{
      id: "intentional-generic-car",
      laneId,
      distance: 300,
      desiredSpeedMps: 2,
    }],
    runtimeTrafficPortals: [{
      id: "generic-authored-portal",
      laneId,
      distance: 600,
      x: 600,
      z: 0,
      heading: Math.PI / 2,
    }],
    trafficCapacityLaneIds: [laneId],
    minRuntimeSpawnDistanceM: 70,
  };
}

interface TrafficSystemTestAccess {
  readonly npcs: readonly NpcInternal[];
  portalAttemptsThisDecision: number;
  localityPlayerProjection: {
    readonly x: number;
    readonly z: number;
  } | null;
  readonly roadNetwork: {
    readonly lanesById: ReadonlyMap<string, unknown>;
  };
  projectPlayerToLocalityRoad(): {
    readonly x: number;
    readonly z: number;
  } | null;
  npcRouteCanReachLocalRadius(
    npc: NpcInternal,
    firstLane: unknown,
    firstDistance: number,
    radiusM: number,
    maximumRouteDistanceM?: number,
    maximumHops?: number,
  ): boolean;
  activateNpcAtGate(
    npc: NpcInternal,
    gate: {
      id: string;
      laneId: string;
      distance: number;
      variant?: NpcInternal["variant"];
      desiredSpeedMps?: number;
      allowInitialSpawn: boolean;
    },
    ctx: TrafficTickCtx,
    initial?: boolean,
  ): void;
  requestNpcRecycle(npc: NpcInternal, ctx: TrafficTickCtx): void;
  deactivateNpc(npc: NpcInternal): void;
  makeTrafficDecisions(ctx: TrafficTickCtx): void;
  localityPatrolWithinFogCount: number;
  activateLocalQueuedNpcs(
    ctx: TrafficTickCtx,
    maximumActivations: number,
    requiredRouteRadiusM: number,
    preference: {
      readonly preferCurrentRoadCorridor?: boolean;
      readonly preferForwardCorridor?: boolean;
      readonly requireForwardCorridor?: boolean;
      readonly requireRouteConnection?: boolean;
    },
    portalAttemptCeiling: number,
  ): number;
  preflightAndRecycleHiddenNpcSlotsForDeficit(
    ctx: TrafficTickCtx,
    maximumRetirements: number,
    requiredRouteRadiusM: number,
    preference: {
      readonly preferCurrentRoadCorridor?: boolean;
      readonly preferForwardCorridor?: boolean;
      readonly requireForwardCorridor?: boolean;
      readonly requireRouteConnection?: boolean;
    },
    portalAttemptCeiling: number,
  ): number;
}

function trafficSystemForTest(simulation: SimulationCore): TrafficSystemTestAccess {
  return (simulation as unknown as {
    readonly trafficSystem: TrafficSystemTestAccess;
  }).trafficSystem;
}

function inertTrafficCtx(elapsedSeconds = 0, tick = 0): TrafficTickCtx {
  return {
    viewHeading: Math.PI / 2,
    roadState: {
      projection: null,
      wrongWay: false,
      offRoad: false,
      inServiceArea: false,
    },
    elapsedSeconds,
    tick,
  };
}

function activateExceptionalFixtureNpc(
  trafficSystem: TrafficSystemTestAccess,
): NpcInternal {
  const npc = trafficSystem.npcs[0]!;
  trafficSystem.activateNpcAtGate(
    npc,
    {
      id: "exceptional-car",
      laneId: "exceptional-recycle-lane",
      distance:
        1_000 + PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M + 1,
      variant: "car",
      desiredSpeedMps: 1,
      allowInitialSpawn: true,
    },
    inertTrafficCtx(),
    true,
  );
  return npc;
}

interface MovingRecycleTrace {
  readonly decisionStates: readonly unknown[];
  readonly activationDistances: readonly number[];
  readonly activationEvents: readonly {
    readonly count: number;
    readonly newlyActiveCount: number;
  }[];
  readonly maximumPortalAttempts: number;
  readonly maximumActivations: number;
  readonly maximumRetirements: number;
  readonly finalActivations: number;
  readonly finalRetirements: number;
}

/** Fixed tick-indexed player poses deliberately exercise locality without any
 * wall-clock/browser input. The compact trace is also a deterministic replay
 * oracle for recycle/activation ordering. */
function runMovingRecycleTrace(config: SimulationCoreConfig): MovingRecycleTrace {
  const simulation = new SimulationCore(config);
  try {
    let previousActiveIds = new Set(simulation.getSnapshot().npcs.map((npc) => npc.id));
    let previousActivations = simulation.getTrafficDiagnostics().locality.activations;
    const decisionStates: unknown[] = [];
    const activationDistances: number[] = [];
    const activationEvents: { count: number; newlyActiveCount: number }[] = [];
    let maximumPortalAttempts = 0;
    let maximumActivations = 0;
    let maximumRetirements = 0;

    for (let tick = 0; tick < 180; tick += 1) {
      // The 10 m side step crosses the target-cache threshold, making this a
      // genuine moving-player case while keeping the two approach portals in
      // their proven hidden annulus.
      if (tick === 0 || tick === 144) {
        simulation.setPlayerPose({ x: 1_000, z: 0, heading: Math.PI / 2 });
      } else if (tick === 72) {
        simulation.setPlayerPose({ x: 990, z: 0, heading: Math.PI / 2 });
      }

      const snapshot = simulation.step(FIXED_STEP_SECONDS);
      const locality = simulation.getTrafficDiagnostics().locality;
      const activeIds = new Set(snapshot.npcs.map((npc) => npc.id));
      const activationDelta = locality.activations - previousActivations;
      if (activationDelta > 0) {
        const newlyActive = snapshot.npcs.filter((npc) => !previousActiveIds.has(npc.id));
        activationEvents.push({
          count: activationDelta,
          newlyActiveCount: newlyActive.length,
        });
        for (const npc of newlyActive) {
          activationDistances.push(
            Math.hypot(npc.x - snapshot.player.x, npc.z - snapshot.player.z),
          );
        }
      }
      previousActivations = locality.activations;
      previousActiveIds = activeIds;

      // Traffic decisions are exactly 10 Hz at the 60 Hz fixed step. Sampling
      // there avoids treating a retained last-decision counter as new work.
      if ((tick + 1) % 6 === 0) {
        maximumPortalAttempts = Math.max(
          maximumPortalAttempts,
          locality.lastDecisionPortalAttempts,
        );
        maximumActivations = Math.max(
          maximumActivations,
          locality.lastDecisionActivations,
        );
        maximumRetirements = Math.max(
          maximumRetirements,
          locality.lastDecisionRetirements,
        );
        decisionStates.push({
          tick: snapshot.tick,
          player: [snapshot.player.x, snapshot.player.z, snapshot.player.heading],
          queuedNpcCount: snapshot.queuedNpcCount,
          npcs: snapshot.npcs.map((npc) => [
            npc.id,
            npc.laneId,
            npc.variant,
            npc.x,
            npc.z,
            npc.heading,
            npc.speedMps,
            npc.state,
          ]),
          locality: {
            activeCount: locality.activeCount,
            queuedCount: locality.queuedCount,
            approachCount: locality.approachCount,
            inboundApproachCount: locality.inboundApproachCount,
            pendingRecycleCount: locality.pendingRecycleCount,
            lastDecisionPortalAttempts: locality.lastDecisionPortalAttempts,
            lastDecisionActivations: locality.lastDecisionActivations,
            lastDecisionRetirements: locality.lastDecisionRetirements,
            activations: locality.activations,
            retirements: locality.retirements,
          },
        });
      }
    }

    const finalLocality = simulation.getTrafficDiagnostics().locality;
    return {
      decisionStates,
      activationDistances,
      activationEvents,
      maximumPortalAttempts,
      maximumActivations,
      maximumRetirements,
      finalActivations: finalLocality.activations,
      finalRetirements: finalLocality.retirements,
    };
  } finally {
    simulation.dispose();
  }
}

describe("local traffic primitives", () => {
  it("resolves the committed desktop and touch density floors/caps", () => {
    expect(resolveLocalTrafficTargets(0, 0, false)).toEqual({ withinFog: 16, withinInner: 8 });
    expect(resolveLocalTrafficTargets(0, 0, true)).toEqual({ withinFog: 10, withinInner: 6 });
    expect(resolveLocalTrafficTargets(20_000, 20_000, false)).toEqual({
      withinFog: 28,
      withinInner: 16,
    });
    expect(resolveLocalTrafficTargets(20_000, 20_000, true)).toEqual({
      withinFog: 15,
      withinInner: 10,
    });
    expect(resolveLocalTrafficTargets(6_250, 3_125, false)).toEqual({
      withinFog: 16,
      withinInner: 8,
    });
  });

  it("clamps short corridors and reallocates only the nested shortfall", () => {
    const londonDesktop = resolveTopologyAwareLocalTrafficTargets(
      32,
      { withinFog: 28, withinInner: 10 },
      false,
      113.222,
      84.642,
    );
    expect(londonDesktop).toEqual({
      population: { withinFog: 28, withinInner: 16 },
      perceptual: {
        movingWithinInner: 8,
        currentRoadCorridor: 4,
        forwardCorridor: 3,
        aheadOrApproaching: 16,
        circulatingApproach: 4,
      },
      currentRoadCapacity: 4,
      forwardCorridorCapacity: 3,
      corridorShortfall: 8,
    });

    const londonTouch = resolveTopologyAwareLocalTrafficTargets(
      16,
      { withinFog: 15, withinInner: 7 },
      true,
      113.222,
      84.642,
    );
    expect(londonTouch).toEqual({
      population: { withinFog: 15, withinInner: 10 },
      perceptual: {
        movingWithinInner: 4,
        currentRoadCorridor: 4,
        forwardCorridor: 3,
        aheadOrApproaching: 10,
        circulatingApproach: 1,
      },
      currentRoadCapacity: 4,
      forwardCorridorCapacity: 3,
      corridorShortfall: 4,
    });

    const cairoDesktop = resolveTopologyAwareLocalTrafficTargets(
      32,
      { withinFog: 17, withinInner: 8 },
      false,
      1_018.555,
      888.499,
    );
    expect(cairoDesktop.population).toEqual({ withinFog: 17, withinInner: 8 });
    expect(cairoDesktop.perceptual).toMatchObject({
      currentRoadCorridor: 12,
      forwardCorridor: 8,
      aheadOrApproaching: 8,
    });
    expect(cairoDesktop.corridorShortfall).toBe(0);
  });

  it("clamps to immutable streamable slots and credits the nested miss once", () => {
    const etaLimited = resolveTopologyAwareLocalTrafficTargets(
      32,
      { withinFog: 28, withinInner: 10 },
      false,
      2_000,
      1_000,
      4,
      0,
    );
    expect(etaLimited).toEqual({
      population: { withinFog: 28, withinInner: 16 },
      perceptual: {
        movingWithinInner: 8,
        // Fast hidden capacity is a continuity signal, not permission to
        // waive storage-backed stationary road targets.
        currentRoadCorridor: 12,
        forwardCorridor: 8,
        aheadOrApproaching: 16,
        circulatingApproach: 4,
      },
      currentRoadCapacity: Math.floor(2_000 / 28),
      forwardCorridorCapacity: Math.floor(1_000 / 28),
      // max(12 - fastCurrent(4), 8 - fastForward(0)), not the
      // double-counted sum of both nested continuity misses.
      corridorShortfall: 8,
    });

    const fullyStreamable = resolveTopologyAwareLocalTrafficTargets(
      32,
      { withinFog: 20, withinInner: 8 },
      false,
      2_000,
      1_000,
      12,
      8,
    );
    expect(fullyStreamable).toMatchObject({
      population: { withinFog: 20, withinInner: 8 },
      perceptual: {
        currentRoadCorridor: 12,
        forwardCorridor: 8,
        aheadOrApproaching: 8,
      },
      currentRoadCapacity: Math.floor(2_000 / 28),
      forwardCorridorCapacity: Math.floor(1_000 / 28),
      corridorShortfall: 0,
    });
  });

  it("clips directional lane length exactly at local-radius boundaries", () => {
    const lanes = [
      {
        id: "crossing",
        points: [
          { x: -100, z: 0 },
          { x: 100, z: 0 },
        ],
      },
      {
        id: "outside",
        points: [
          { x: 20, z: 50 },
          { x: 80, z: 50 },
        ],
      },
      {
        // Geometrically aligned, but deliberately not in the capacity set:
        // connector/terminal lanes may count a passing car without inflating
        // the stable occupancy target.
        id: "excluded-aligned-connector",
        points: [
          { x: -50, z: 4 },
          { x: 50, z: 4 },
        ],
      },
    ];
    const capacity = new Set(["crossing", "outside"]);
    expect(localTrafficLaneLengthM(lanes, capacity, { x: 0, z: 0 }, 50)).toBeCloseTo(100, 8);
    expect(
      localTrafficCorridorLaneLengthsM(
        lanes,
        capacity,
        { x: 0, z: 0 },
        50,
        Math.PI / 2,
      ),
    ).toEqual({ current: 100, forward: 50 });
    expect(localTrafficLaneLengthM(lanes, capacity, { x: 0, z: 0 }, 0)).toBe(0);
    expect(
      localTrafficLaneLengthM(lanes, capacity, { x: 0, z: 0 }, LOCAL_TRAFFIC_INNER_RADIUS_M),
    ).toBeCloseTo(260, 8);
    expect(
      localTrafficLaneLengthM(lanes, capacity, { x: 0, z: 0 }, LOCAL_TRAFFIC_FOG_RADIUS_M),
    ).toBeCloseTo(260, 8);
  });

  it("queries portal bands through cells but consumes stable catalogue order", () => {
    const index = new RuntimeTrafficPortalIndex([
      { id: "b", laneId: "b", distance: 1, x: 120, z: 0, heading: 0 },
      { id: "a", laneId: "a", distance: 1, x: 80, z: 0, heading: 0 },
      { id: "c", laneId: "c", distance: 1, x: 220, z: 0, heading: 0 },
    ]);
    index.markAnnulus({ x: 0, z: 0 }, 80, 120);
    const ids: string[] = [];
    index.forEachMarked((portal) => {
      ids.push(portal.id);
    });
    expect(ids).toEqual(["a", "b"]);

    index.markAnnulus({ x: 0, z: 0 }, 121, 220);
    const outerIds: string[] = [];
    index.forEachMarked((portal) => {
      outerIds.push(portal.id);
    });
    expect(outerIds).toEqual(["c"]);

    index.reset();
    const afterReset: string[] = [];
    index.forEachMarked((portal) => {
      afterReset.push(portal.id);
    });
    expect(afterReset).toEqual([]);
  });

  it("builds stable, safely set-back runtime portals for every shipped map", () => {
    for (const freeDrive of FREE_DRIVES) {
      const mapPack = getMapPack(freeDrive.mapId);
      const portals = buildRuntimeTrafficPortals(mapPack);
      const repeated = buildRuntimeTrafficPortals(mapPack);
      expect(portals, mapPack.id).toEqual(repeated);
      expect(new Set(portals.map((portal) => portal.id)).size, mapPack.id).toBe(portals.length);
      expect(portals.length, mapPack.id).toBeGreaterThan(0);

      const byLane = new Map<string, typeof portals>();
      for (const portal of portals) {
        const bucket = byLane.get(portal.laneId);
        if (bucket) bucket.push(portal);
        else byLane.set(portal.laneId, [portal]);
      }
      const controlApproachLaneIds = new Set(
        mapPack.laneGraph.controls.flatMap((control) =>
          (control.approaches ?? []).map((approach) => approach.stopLine.laneId),
        ),
      );
      const conflictZoneLaneIds = new Set(
        mapPack.laneGraph.conflictZones.flatMap((zone) => zone.laneIds),
      );
      for (const lane of mapPack.laneGraph.lanes) {
        const lanePortals = byLane.get(lane.id) ?? [];
        const length = lane.centerline.slice(1).reduce(
          (total, point, index) =>
            total + Math.hypot(point.x - lane.centerline[index].x, point.z - lane.centerline[index].z),
          0,
        );
        const orderedDistances = lanePortals
          .map((portal) => portal.distance)
          .sort((left, right) => left - right);
        for (let index = 1; index < orderedDistances.length; index += 1) {
          expect(
            orderedDistances[index] - orderedDistances[index - 1],
            `${mapPack.id}/${lane.id} duplicate runtime portal`,
          ).toBeGreaterThan(0.01);
        }
        for (const portal of lanePortals) {
          expect(portal.distance, `${mapPack.id}/${portal.id} start setback`).toBeGreaterThanOrEqual(
            RUNTIME_TRAFFIC_PORTAL_ENDPOINT_SETBACK_M,
          );
          expect(portal.distance, `${mapPack.id}/${portal.id} end setback`).toBeLessThanOrEqual(
            length - RUNTIME_TRAFFIC_PORTAL_ENDPOINT_SETBACK_M + 1e-9,
          );
        }
        // A portal-eligible lane may be absent only when its endpoint-safe
        // span is too short or an authored control/connector explicitly owns
        // the available interval. This records every topology exception in a
        // failing assertion instead of silently treating a missed ordinary
        // road direction as acceptable coverage.
        if (isRuntimeTrafficPortalLane(lane) && lanePortals.length === 0) {
          expect(
              length <= RUNTIME_TRAFFIC_PORTAL_ENDPOINT_SETBACK_M * 2 ||
              controlApproachLaneIds.has(lane.id) ||
              conflictZoneLaneIds.has(lane.id) ||
              (lane.connectorRanges?.length ?? 0) > 0,
            `${mapPack.id}/${lane.id} lacks a runtime portal without a topology exclusion`,
          ).toBe(true);
        }
      }
      const oneWayLaneIds = new Set(
        mapPack.laneGraph.lanes
          .filter((lane) => lane.role === "one_way" && isRuntimeTrafficPortalLane(lane))
          .map((lane) => lane.id),
      );
      if (oneWayLaneIds.size > 0) {
        expect(
          portals.some((portal) => oneWayLaneIds.has(portal.laneId)),
          `${mapPack.id} has runtime one-way coverage`,
        ).toBe(true);
      }

      const locality = buildTrafficLocalityConfig(mapPack);
      expect(locality.runtimeTrafficPortals).toEqual(portals);
      expect(locality.trafficCapacityLaneIds.length, mapPack.id).toBeGreaterThan(0);
    }
  });

  it("admits a 718 m exact inner route while rejecting its tangent-only branch", () => {
    const simulation = new SimulationCore(routeConnectedApproachFixture());
    try {
      // Both approach portals point inward; only connected-in follows the
      // stable successor choices into the inner circle. Exercise the route
      // admission predicate directly so unrelated corridor/sector hard
      // preferences cannot make this topology oracle vacuous.
      simulation.setPlayerPose({ x: 0, z: 0, heading: Math.PI / 2 });
      const trafficSystem = trafficSystemForTest(simulation);
      const npc = trafficSystem.npcs[0]!;
      const connected = trafficSystem.roadNetwork.lanesById.get("connected-in");
      const tangent = trafficSystem.roadNetwork.lanesById.get("decoy-in");
      expect(connected).toBeDefined();
      expect(tangent).toBeDefined();
      expect(
        trafficSystem.npcRouteCanReachLocalRadius(
          npc,
          connected,
          50,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        ),
      ).toBe(true);
      expect(
        trafficSystem.npcRouteCanReachLocalRadius(
          npc,
          tangent,
          30,
          LOCAL_TRAFFIC_INNER_RADIUS_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
          RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
        ),
      ).toBe(false);
    } finally {
      simulation.dispose();
    }
  });

  it("preflights a compatible full-pool replacement past an unusable queued patrol", () => {
    const simulation = new SimulationCore(compatiblePreflightFixture());
    try {
      const trafficSystem = trafficSystemForTest(simulation);
      const active = trafficSystem.npcs[0]!;
      const queued = trafficSystem.npcs[1]!;
      trafficSystem.deactivateNpc(active);
      trafficSystem.deactivateNpc(queued);
      trafficSystem.activateNpcAtGate(
        active,
        {
          id: "preflight-remote-occupant",
          laneId: "preflight-opposing-road",
          distance: 400,
          allowInitialSpawn: true,
        },
        inertTrafficCtx(),
        true,
      );
      expect(active.active).toBe(true);
      expect(queued.active).toBe(false);
      active.patrol = false;
      queued.patrol = true;
      // Make the already queued patrol incompatible with any route-connected
      // local feed, exactly like a saturated shipped-city patrol cap.
      trafficSystem.localityPatrolWithinFogCount = 99;
      trafficSystem.portalAttemptsThisDecision = 0;
      const preference = {
        preferCurrentRoadCorridor: true,
        preferForwardCorridor: true,
        requireForwardCorridor: true,
        requireRouteConnection: true,
      } as const;
      expect(
        trafficSystem.activateLocalQueuedNpcs(
          inertTrafficCtx(0.1, 6),
          1,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          preference,
          LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
        ),
      ).toBe(0);

      expect(
        trafficSystem.preflightAndRecycleHiddenNpcSlotsForDeficit(
          inertTrafficCtx(0.1, 6),
          1,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          preference,
          LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
        ),
      ).toBe(1);
      expect(active).toMatchObject({
        active: false,
        preparedLocalityGateId: "preflight-hidden-forward",
      });
      expect(active.localityRoutePlanTargetLaneIndex).toBeGreaterThanOrEqual(0);
      expect(active.localityCommitmentBits).not.toBe(0);

      // Tick seven is the required observable inactive snapshot. The exact
      // preflight is consumed on the following eligible decision; the patrol
      // remains queued and cannot monopolize the hard-feed opportunity.
      trafficSystem.portalAttemptsThisDecision = 0;
      expect(
        trafficSystem.activateLocalQueuedNpcs(
          inertTrafficCtx(0.2, 7),
          1,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          preference,
          LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
        ),
      ).toBe(0);
      trafficSystem.portalAttemptsThisDecision = 0;
      expect(
        trafficSystem.activateLocalQueuedNpcs(
          inertTrafficCtx(0.3, 8),
          1,
          LOCAL_TRAFFIC_FOG_RADIUS_M,
          preference,
          LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
        ),
      ).toBe(1);
      expect(active).toMatchObject({
        active: true,
        laneId: "preflight-opposing-road",
        preparedLocalityGateId: undefined,
      });
      expect(queued.active).toBe(false);
    } finally {
      simulation.dispose();
    }
  });

  it("projects the fresh player pose exactly once per 10 Hz locality decision", () => {
    const simulation = new SimulationCore(movingRecycleFixture());
    try {
      const trafficSystem = trafficSystemForTest(simulation);
      const originalProjection =
        trafficSystem.projectPlayerToLocalityRoad.bind(trafficSystem);
      let projectionCalls = 0;
      trafficSystem.projectPlayerToLocalityRoad = () => {
        projectionCalls += 1;
        return originalProjection();
      };

      // The tick context deliberately carries no road projection. Locality
      // must project the just-updated player pose itself, then share that
      // immutable result through every recount/admission branch in the pass.
      simulation.setPlayerPose({ x: 1_000, z: 0, heading: Math.PI / 2 });
      trafficSystem.makeTrafficDecisions(inertTrafficCtx(0.1, 6));
      expect(projectionCalls).toBe(1);
      expect(trafficSystem.localityPlayerProjection).toMatchObject({
        x: 1_000,
        z: 0,
      });

      // The projection is decision-scoped, not cached across player motion.
      simulation.setPlayerPose({ x: 990, z: 0, heading: Math.PI / 2 });
      trafficSystem.makeTrafficDecisions(inertTrafficCtx(0.2, 12));
      expect(projectionCalls).toBe(2);
      expect(trafficSystem.localityPlayerProjection).toMatchObject({
        x: 990,
        z: 0,
      });
    } finally {
      simulation.dispose();
    }
  });

  it("does not let a tangent-only approach consume route-connected inbound transit", () => {
    const simulation = new SimulationCore(tangentOnlyInboundTransitFixture());
    try {
      // Remote authored coordinates no longer bypass local reset priming. Use
      // the narrow activation seam so this test isolates transit accounting,
      // rather than accidentally grading the retired legacy placement rule.
      const trafficSystem = trafficSystemForTest(simulation);
      trafficSystem.activateNpcAtGate(
        trafficSystem.npcs[0]!,
        {
          id: "tangent-explicit-car",
          laneId: "tangent-approach",
          distance: 50,
          variant: "car",
          desiredSpeedMps: 2,
          allowInitialSpawn: true,
        },
        inertTrafficCtx(),
        true,
      );
      expect(simulation.getSnapshot().npcs[0]).toMatchObject({
        laneId: "tangent-approach",
        x: 600,
        z: 0,
      });

      // The first traffic decision refreshes the approach accounting while
      // the explicit car remains in the hidden approach band.
      for (let tick = 0; tick < 6; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS);
      }
      const locality = simulation.getTrafficDiagnostics().locality;
      expect(locality.approachCount).toBe(1);
      expect(locality.inboundApproachCount).toBe(1);
      expect(locality.inboundTransitCount).toBe(0);
      expect(locality.inboundInnerTransitCount).toBe(0);
    } finally {
      simulation.dispose();
    }
  });

  it("settles an exceptional recycle once stranded traffic clears the hidden-envelope margin", () => {
    const simulation = new SimulationCore(exceptionalRecycleFixture());
    try {
      const trafficSystem = trafficSystemForTest(simulation);
      const npc = activateExceptionalFixtureNpc(trafficSystem);
      expect(Math.hypot(npc.x, npc.z)).toBeCloseTo(
        PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M + 1,
        6,
      );
      trafficSystem.requestNpcRecycle(npc, inertTrafficCtx());

      // The decision pass settles while the vehicle is strictly beyond the
      // centralized presentation envelope.
      for (let tick = 0; tick < 6; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS);
      }
      expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
      expect(simulation.getTrafficDiagnostics().locality.retirements).toBe(1);
    } finally {
      simulation.dispose();
    }
  });

  it("pins exceptional recycle to strictly beyond the presentation envelope", () => {
    const simulation = new SimulationCore(exceptionalRecycleFixture());
    try {
      const trafficSystem = trafficSystemForTest(simulation);
      const npc = activateExceptionalFixtureNpc(trafficSystem);
      npc.x = PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M;
      npc.z = 0;
      trafficSystem.requestNpcRecycle(npc, inertTrafficCtx(0.1, 6));
      trafficSystem.makeTrafficDecisions(inertTrafficCtx(0.1, 6));
      expect(npc.active).toBe(true);

      npc.x = PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M + 0.001;
      trafficSystem.makeTrafficDecisions(inertTrafficCtx(0.2, 12));
      expect(npc.active).toBe(false);
    } finally {
      simulation.dispose();
    }
  });

  it("keeps a safe generic authored gate during fresh locality priming", () => {
    const simulation = new SimulationCore(genericAuthoredInitialGateFixture());
    try {
      const snapshot = simulation.getSnapshot();
      expect(snapshot.npcs).toHaveLength(1);
      expect(snapshot.npcs[0]).toMatchObject({
        id: "npc-1",
        laneId: "generic-authored-lane",
        x: 300,
        z: 0,
      });
    } finally {
      simulation.dispose();
    }
  });

  it("routes invalid-lane traffic through the same hidden exceptional recovery", () => {
    const simulation = new SimulationCore(exceptionalRecycleFixture());
    try {
      const trafficSystem = trafficSystemForTest(simulation);
      const npc = activateExceptionalFixtureNpc(trafficSystem);
      // This models a malformed/removed lane reference at a pose that cannot
      // reach the ordinary 750 m retirement band. moveNpcs must mark it for
      // exceptional recovery rather than leave a permanently active dead slot.
      npc.laneId = "missing-lane";
      for (let tick = 0; tick < 6; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS);
      }
      expect(simulation.getSnapshot().queuedNpcCount).toBe(1);
      expect(simulation.getTrafficDiagnostics().locality.retirements).toBe(1);
    } finally {
      simulation.dispose();
    }
  });

  it("keeps lifecycle work bounded and makes a long-run full reset future-equivalent to a fresh core", () => {
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const scenario = buildFreeDriveScenario(freeDrive);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario,
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      });
      const simulation = new SimulationCore(config);
      const fresh = new SimulationCore(config);
      const spawnHeading = config.spawn?.heading ?? 0;
      const initial = simulation.getTrafficDiagnostics().locality;
      expect(initial.enabled, freeDrive.id).toBe(true);
      expect(initial.poolCount, freeDrive.id).toBe(config.npcCount);
      expect(initial.activeCount + initial.queuedCount, freeDrive.id).toBe(initial.poolCount);

      // Exercise traffic decisions, player motion, road projection caches and
      // the locality target anchor long enough that reset cannot pass merely
      // by restoring the visible tick-zero snapshot.
      for (let tick = 0; tick < 60 * 30; tick += 1) {
        const phase = tick % (60 * 8);
        simulation.step(FIXED_STEP_SECONDS, {
          throttle: phase < 60 * 5 ? 0.72 : 0,
          brake: phase >= 60 * 6 ? 0.35 : 0,
          steer: Math.sin(tick / 83) * 0.28,
          viewHeading: spawnHeading + Math.sin(tick / 137) * 0.9,
        });
        if ((tick + 1) % 6 !== 0) continue;
        const locality = simulation.getTrafficDiagnostics().locality;
        expect(
          locality.activeCount + locality.queuedCount,
          `${freeDrive.id} pool is conserved`,
        ).toBe(locality.poolCount);
        expect(
          locality.lastDecisionPortalAttempts,
          `${freeDrive.id} portal work is bounded`,
        ).toBeLessThanOrEqual(LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET);
        expect(
          locality.lastDecisionActivations,
          `${freeDrive.id} activation work is bounded`,
        ).toBeLessThanOrEqual(LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET);
        expect(
          locality.lastDecisionRetirements,
          `${freeDrive.id} retirement work is bounded`,
        ).toBeLessThanOrEqual(LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET);
      }

      expect(simulation.reset(), `${freeDrive.id} full reset`).toEqual(fresh.getSnapshot());
      expect(
        simulation.getTrafficDiagnostics().locality,
        `${freeDrive.id} reset locality state`,
      ).toEqual(fresh.getTrafficDiagnostics().locality);
      expect(
        simulation.getTrafficDiagnostics().spatialIndex,
        `${freeDrive.id} reset spatial state`,
      ).toEqual(fresh.getTrafficDiagnostics().spatialIndex);

      // Same future inputs after reset must produce the same complete public
      // state and event stream as a never-run core. This catches stale portal
      // cursors, hysteresis generations, PRNG state, queued-slot order and
      // spatial membership even when tick zero itself happens to look right.
      for (let futureTick = 0; futureTick < 60 * 12; futureTick += 1) {
        const phase = futureTick % (60 * 6);
        const input = {
          throttle: phase < 60 * 4 ? 0.64 : 0,
          brake: phase >= 60 * 5 ? 0.25 : 0,
          steer: Math.sin(futureTick / 71) * 0.22,
          viewHeading: spawnHeading + Math.sin(futureTick / 109) * 0.75,
        };
        expect(
          simulation.step(FIXED_STEP_SECONDS, input),
          `${freeDrive.id} future snapshot at tick ${futureTick + 1}`,
        ).toEqual(fresh.step(FIXED_STEP_SECONDS, input));
        expect(
          simulation.drainEvents(),
          `${freeDrive.id} future events at tick ${futureTick + 1}`,
        ).toEqual(fresh.drainEvents());
        if ((futureTick + 1) % 6 !== 0) continue;
        expect(
          simulation.getTrafficDiagnostics().locality,
          `${freeDrive.id} future locality at tick ${futureTick + 1}`,
        ).toEqual(fresh.getTrafficDiagnostics().locality);
        expect(
          simulation.getTrafficDiagnostics().spatialIndex,
          `${freeDrive.id} future spatial index at tick ${futureTick + 1}`,
        ).toEqual(fresh.getTrafficDiagnostics().spatialIndex);
      }
      simulation.dispose();
      fresh.dispose();
    }
  });

  it("resetToSpawn keeps the live fleet and locality run history instead of reseeding traffic", () => {
    // This test grades pose-only reset continuity, not the intentionally
    // single-file slow-feed scheduler used by the 2 m/s lifecycle fixture.
    // A normal urban speed lets several identities complete the approach
    // before the player is restored, leaving a non-vacuous retained subset.
    const simulation = new SimulationCore(movingRecycleFixture(20));
    const fresh = new SimulationCore(movingRecycleFixture(20));
    try {
      simulation.setPlayerPose({ x: 1_000, z: 0, heading: Math.PI / 2 });
      for (let tick = 0; tick < 60 * 45; tick += 1) {
        simulation.step(FIXED_STEP_SECONDS, { viewHeading: Math.PI / 2 });
      }
      const before = simulation.getSnapshot();
      const beforeLocality = simulation.getTrafficDiagnostics().locality;
      expect(beforeLocality.activations).toBeGreaterThan(0);
      expect(beforeLocality.retirements).toBeGreaterThan(0);

      simulation.resetToSpawn();
      const restored = simulation.getSnapshot();
      const restoredLocality = simulation.getTrafficDiagnostics().locality;

      expect(restored.player).toMatchObject({ x: 0, z: 0, heading: Math.PI / 2 });
      expect(restored.tick).toBe(before.tick);
      expect(restored.elapsedMs).toBe(before.elapsedMs);
      expect(restoredLocality.activations).toBeGreaterThanOrEqual(beforeLocality.activations);
      expect(restoredLocality.retirements).toBeGreaterThanOrEqual(beforeLocality.retirements);
      expect(restoredLocality.poolCount).toBe(beforeLocality.poolCount);
      expect(restored.npcs.length + restored.queuedNpcCount).toBe(
        before.npcs.length + before.queuedNpcCount,
      );

      // A pose-only reset may reflow a car that conflicts with the restored
      // player, but it must not rebuild identities or snap the entire fleet to
      // the seeded tick-zero gates as SimulationCore.reset() does.
      const beforeById = new Map(before.npcs.map((npc) => [npc.id, npc]));
      const continuingIds = restored.npcs
        .map((npc) => npc.id)
        .filter((id) => beforeById.has(id));
      expect(continuingIds.length).toBeGreaterThan(0);
      for (const npc of restored.npcs) {
        const prior = beforeById.get(npc.id);
        if (!prior) continue;
        expect(npc.variant, npc.id).toBe(prior.variant);
      }
      expect(restored.npcs, "pose-only reset must not equal a fresh fleet").not.toEqual(
        fresh.getSnapshot().npcs,
      );

      const next = simulation.step(FIXED_STEP_SECONDS, { viewHeading: Math.PI / 2 });
      expect(next.tick).toBe(before.tick + 1);
      expect(next.elapsedMs).toBeGreaterThan(before.elapsedMs);
    } finally {
      simulation.dispose();
      fresh.dispose();
    }
  });

  it("recycles a moved-away fleet deterministically and reactivates only through the hidden approach band", () => {
    const first = runMovingRecycleTrace(movingRecycleFixture());
    const replay = runMovingRecycleTrace(movingRecycleFixture());

    // The player movement, slot recycle order, portal cursor, and randomized
    // driver identities are all simulation state. A second fresh core must
    // reproduce the complete decision-boundary trace byte for byte.
    expect(first.decisionStates).toEqual(replay.decisionStates);
    expect(first.activationEvents).toEqual(replay.activationEvents);
    expect(first.activationDistances).toEqual(replay.activationDistances);

    // This setup intentionally forces two hidden retirements, then two
    // deferred runtime activations. Guarding the positive case makes the
    // budget and annulus assertions below non-vacuous.
    expect(first.finalRetirements).toBeGreaterThan(0);
    expect(first.finalActivations).toBeGreaterThan(0);
    expect(first.maximumPortalAttempts).toBeGreaterThan(0);
    expect(first.maximumActivations).toBeGreaterThan(0);
    expect(first.maximumRetirements).toBeGreaterThan(0);

    expect(first.maximumPortalAttempts).toBeLessThanOrEqual(
      LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
    );
    expect(first.maximumActivations).toBeLessThanOrEqual(
      LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
    );
    expect(first.maximumRetirements).toBeLessThanOrEqual(
      LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
    );

    for (const event of first.activationEvents) {
      // Runtime activations have to be new snapshot members; a slot that was
      // continuously active has not crossed a lifecycle boundary.
      expect(event.newlyActiveCount).toBe(event.count);
    }
    expect(first.activationDistances).not.toHaveLength(0);
    for (const distance of first.activationDistances) {
      // The snapshot is taken after one fixed NPC move, but these fixture
      // portals retain more than 40 m of margin from either band edge.
      expect(distance).toBeGreaterThanOrEqual(RUNTIME_TRAFFIC_APPROACH_MIN_M);
      expect(distance).toBeLessThanOrEqual(RUNTIME_TRAFFIC_APPROACH_MAX_M);
    }
  });
});
