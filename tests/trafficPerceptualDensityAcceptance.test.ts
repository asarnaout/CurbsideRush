import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationLane,
  type SimulationPoint,
  type SimulationSnapshot,
} from "../app/game/simulation";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import {
  LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET,
  LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET,
  LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M,
  LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP,
  LOCAL_TRAFFIC_FOG_RADIUS_M,
  LOCAL_TRAFFIC_INNER_RADIUS_M,
  LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET,
  LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR,
  LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS,
  LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS,
  LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP,
  RUNTIME_TRAFFIC_APPROACH_MAX_M,
  RUNTIME_TRAFFIC_APPROACH_MIN_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M,
  RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS,
  resolveLocalTrafficTargets,
  resolveTopologyAwareLocalTrafficTargets,
} from "../app/game/simulation/trafficLocality";
import { isTrafficNpcPatrol } from "../app/game/simulation/trafficIdentity";
import type { MapPack } from "../app/game/types";

/**
 * The hidden approach band starts beyond the 550 m presentation envelope and
 * can follow a bounded route detour before entering the 250 m disc. One minute
 * gives several 10 Hz
 * hysteresis/activation cycles and ordinary city traffic enough time to cross
 * that hand-off before the measured two-minute window begins.
 */
const WARMUP_SECONDS = 60;
// Maintainer-only short probe: CI/default acceptance always keeps the full
// four-anchor, 120-second measured matrix. The opt-in form lets controller
// work inspect all eight authored device cases without weakening the suite.
const AUTHORED_SHORT_PROBE =
  process.env.TRAFFIC_ACCEPTANCE_AUTHORED_SHORT_PROBE === "1";
const SAMPLE_SECONDS = AUTHORED_SHORT_PROBE ? 60 : 120;
const TICKS_PER_SECOND = Math.round(1 / FIXED_STEP_SECONDS);
const ORACLE_SAMPLES_PER_SECOND = 10;
const TICKS_PER_ORACLE_SAMPLE = Math.round(
  TICKS_PER_SECOND / ORACLE_SAMPLES_PER_SECOND,
);
const WARMUP_TICKS = WARMUP_SECONDS * TICKS_PER_SECOND;
const SAMPLE_TICKS = SAMPLE_SECONDS * TICKS_PER_SECOND;

// Product-independent acceptance constants. The production exports are
// asserted against these values before they are used by target/diagnostic
// helpers, so changing an implementation constant cannot silently relax the
// experience oracle.
const ACCEPTANCE_FOG_RADIUS_M = 440;
const ACCEPTANCE_INNER_RADIUS_M = 250;
const ACCEPTANCE_APPROACH_CORRIDOR_RADIUS_M = 90;
const ACCEPTANCE_ROUTE_LOOKAHEAD_M = 750;
const ACCEPTANCE_ROUTE_MAX_HOPS = 12;
const ACCEPTANCE_CURRENT_ROAD_HALF_WIDTH_M = 60;
const ACCEPTANCE_CURRENT_ROAD_ALIGNMENT_RAD = (40 * Math.PI) / 180;
// A decimetre covers the repository's 8 cm authored-node tolerance while
// remaining far below any legal lane width. Only locality's optional
// heading-aware projection should use this; legacy RoadNetwork callers retain
// their exact nearest/first-authored behavior when no preference is supplied.
const ACCEPTANCE_PROJECTION_DISTANCE_TIE_EPSILON_M = 0.1;
// Frozen conservative arclength per safely circulating corridor vehicle. This
// is intentionally duplicated rather than imported from density control so a
// production constant change cannot silently make a short road's gate easier.
const ACCEPTANCE_CORRIDOR_SAFE_SPACING_M = 28;
// Fast-feed capacity is a continuity/scheduler constraint, never permission
// to lower the stationary corridor-storage floor. These values are duplicated
// so a production tuning change must be consciously reviewed by acceptance.
const ACCEPTANCE_STREAMABLE_FEED_ETA_SECONDS = 30;
const ACCEPTANCE_STREAMABLE_DRIVER_SPEED_FACTOR = 0.68;
const ACCEPTANCE_STREAMABLE_STARTUP_SECONDS = 2;
const ACCEPTANCE_APPROACH_MIN_M = 570;
const ACCEPTANCE_APPROACH_MAX_M = 680;

const ANCHOR_SAMPLE_INTERVAL_M = 100;
const ANCHOR_ENDPOINT_INSET_M = 50;
const MOVING_SPEED_MPS = 0.5;
// The 50-degree bearing is the plan's independent player-heading acceptance
// boundary. TrafficSystem's road-relative diagnostics are sampled separately
// below and never self-grade the primary presence metric.
const AHEAD_HALF_ANGLE_RAD = (50 * Math.PI) / 180;
// "Cross traffic" excludes tangents within 40 degrees of either direction of
// the player's road. The controller may evolve its own corridor classifier;
// this acceptance oracle stays a direct geometric predicate.
const CROSS_TRAFFIC_TANGENT_MINIMUM_ANGLE_RAD = (40 * Math.PI) / 180;

const MAX_AHEAD_OR_APPROACHING_GHOST_SECONDS = 10;
const MAX_PRIMARY_BELOW_FLOOR_SECONDS = 10;
const MIN_CURRENT_CORRIDOR_OCCUPIED_FRACTION = 0.95;
const MAX_CURRENT_CORRIDOR_GHOST_SECONDS = 10;
const MIN_MOVING_INNER_FRACTION = 0.35;
// After the 60-second convergence warm-up, a stationary neighbourhood must
// not manufacture density by cycling the whole identity pool repeatedly.
// One complete pool turn over the graded window is already a conservative
// allowance; normal steady-state circulation should be materially lower.
const MAX_GRADED_LIFECYCLE_TURNS_PER_POOL = 1;
const MAX_PENDING_RECYCLES =
  LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET * 2;

const BUSTLING_CALIBRATION = {
  desktop: {
    poolCount: 32,
    carsPerLaneKm: 2.5,
    fog: { minimum: 16, maximum: 28 },
    inner: { minimum: 8, maximum: 16 },
    movingInner: 8,
    currentRoad: 12,
    forwardRoad: 8,
    movingCurrentRoad: 8,
    movingForwardRoad: 5,
    aheadOrApproaching: 8,
    corridorCap: 14,
    laneCap: 6,
    nearViewRadiusM: 120,
    nearView: 3,
  },
  touch: {
    poolCount: 16,
    carsPerLaneKm: 1.6,
    fog: { minimum: 10, maximum: 15 },
    inner: { minimum: 6, maximum: 10 },
    movingInner: 4,
    currentRoad: 8,
    forwardRoad: 5,
    movingCurrentRoad: 5,
    movingForwardRoad: 3,
    aheadOrApproaching: 6,
    corridorCap: 10,
    laneCap: 4,
    nearViewRadiusM: 100,
    nearView: 2,
  },
} as const;

interface AuthoredCleanMainBaseline {
  readonly fogMean: number;
  readonly innerMean: number;
  readonly movingMean: number;
  readonly currentRoadMean: number;
  readonly forwardRoadMean: number;
  readonly aheadOrApproachingMean: number;
  readonly forwardZeroFraction: number;
  readonly aheadZeroFraction: number;
}

const CLEAN_MAIN_COMPARISON_METRICS = [
  "fog",
  "inner",
  "movingInner",
  "currentRoad",
  "forwardRoad",
  "aheadOrApproaching",
] as const;

type CleanMainComparisonMetric =
  (typeof CLEAN_MAIN_COMPARISON_METRICS)[number];

type CleanMainMetricValues = Readonly<
  Record<CleanMainComparisonMetric, number>
>;

interface CleanMainFivefoldMetricAssessment {
  readonly baselineMean: number;
  readonly requiredMean: number | null;
  readonly maximumSafeMean: number;
  readonly eligibility:
    | "eligible"
    | "capacity-impossible"
    | "zero-baseline";
}

type CleanMainFivefoldAssessment = Readonly<
  Record<CleanMainComparisonMetric, CleanMainFivefoldMetricAssessment>
>;

/**
 * Clean main `6dc1bc6`, measured with this file's independent connected-road
 * closure and geometry over
 * the same 60 s warm-up and 120-second 10 Hz authored-start window. The
 * ahead/approach values use actual pose velocity plus bounded existential
 * public-graph reachability, so they remain compatible with hidden route goals.
 * These are saved evidence, not production counters. These are selected-metric ratios against
 * clean main, not a literal measurement of the owner's observed interim build
 * (no deterministic trace of that browser session exists). Absolute bustle
 * gates remain primary; ratios show where the fixed 32/16 pools can deliver a
 * fivefold metric improvement and make dense Tokyo's exception explicit.
 */
const AUTHORED_CLEAN_MAIN_BASELINE: Readonly<
  Record<string, Readonly<Record<DeviceClass, AuthoredCleanMainBaseline>>>
> = {
  "london-south-kensington": {
    desktop: {
      fogMean: 10.510_833_333_333_334,
      innerMean: 5.716_666_666_666_667,
      movingMean: 1.181_666_666_666_666_6,
      currentRoadMean: 1,
      forwardRoadMean: 0,
      aheadOrApproachingMean: 0.789_166_666_666_666_7,
      forwardZeroFraction: 1,
      aheadZeroFraction: 0.416_666_666_666_666_7,
    },
    touch: {
      fogMean: 5.198_333_333_333_333,
      innerMean: 2.012_5,
      movingMean: 1.734_166_666_666_666_6,
      currentRoadMean: 0,
      forwardRoadMean: 0,
      aheadOrApproachingMean: 0.635_833_333_333_333_4,
      forwardZeroFraction: 1,
      aheadZeroFraction: 0.416_666_666_666_666_7,
    },
  },
  "cairo-central-nile": {
    desktop: {
      fogMean: 3.825,
      innerMean: 1.237_5,
      movingMean: 1.237_5,
      currentRoadMean: 0.123_333_333_333_333_34,
      forwardRoadMean: 0.123_333_333_333_333_34,
      aheadOrApproachingMean: 0.575_833_333_333_333_3,
      forwardZeroFraction: 0.876_666_666_666_666_7,
      aheadZeroFraction: 0.469_166_666_666_666_7,
    },
    touch: {
      fogMean: 2.965,
      innerMean: 1.233_333_333_333_333_4,
      movingMean: 1.233_333_333_333_333_4,
      currentRoadMean: 0.123_333_333_333_333_34,
      forwardRoadMean: 0.123_333_333_333_333_34,
      aheadOrApproachingMean: 0.576_666_666_666_666_7,
      forwardZeroFraction: 0.876_666_666_666_666_7,
      aheadZeroFraction: 0.469_166_666_666_666_7,
    },
  },
  "nyc-upper-west-side": {
    desktop: {
      fogMean: 2.800_833_333_333_333_3,
      innerMean: 0.772_5,
      movingMean: 0.772_5,
      currentRoadMean: 0,
      forwardRoadMean: 0,
      aheadOrApproachingMean: 0.647_5,
      forwardZeroFraction: 1,
      aheadZeroFraction: 0.415_833_333_333_333_33,
    },
    touch: {
      fogMean: 2.878_333_333_333_333_4,
      innerMean: 1.112_5,
      movingMean: 1.045,
      currentRoadMean: 0.185_833_333_333_333_32,
      forwardRoadMean: 0,
      aheadOrApproachingMean: 0.801_666_666_666_666_6,
      forwardZeroFraction: 1,
      aheadZeroFraction: 0.261_666_666_666_666_66,
    },
  },
  "tokyo-setagaya": {
    desktop: {
      fogMean: 14.71,
      innerMean: 9.841_666_666_666_667,
      movingMean: 4.91,
      currentRoadMean: 5.419_166_666_666_667,
      forwardRoadMean: 3.118_333_333_333_333,
      aheadOrApproachingMean: 3.762_5,
      forwardZeroFraction: 0,
      aheadZeroFraction: 0,
    },
    touch: {
      fogMean: 9.214_166_666_666_667,
      innerMean: 6.841_666_666_667,
      movingMean: 4.731_666_666_666_666_5,
      currentRoadMean: 2.474_166_666_666_666_5,
      forwardRoadMean: 0.173_333_333_333_333_34,
      aheadOrApproachingMean: 1.669_166_666_666_666_7,
      forwardZeroFraction: 0.826_666_666_666_666_7,
      aheadZeroFraction: 0.085,
    },
  },
};

/**
 * Frozen audit of the capacity-based fivefold rule. These lists are deliberately
 * not derived from the chosen density floor: an achievable fivefold mean stays
 * required even when production is currently calibrated below it.
 */
const AUTHORED_FIVEFOLD_ELIGIBILITY_EVIDENCE: Readonly<
  Record<string, Readonly<Record<DeviceClass, readonly CleanMainComparisonMetric[]>>>
> = {
  "london-south-kensington": {
    desktop: ["movingInner", "aheadOrApproaching"],
    touch: ["movingInner", "aheadOrApproaching"],
  },
  "cairo-central-nile": {
    desktop: [...CLEAN_MAIN_COMPARISON_METRICS],
    touch: [...CLEAN_MAIN_COMPARISON_METRICS],
  },
  "nyc-upper-west-side": {
    desktop: ["fog", "inner", "movingInner", "aheadOrApproaching"],
    touch: [
      "fog",
      "inner",
      "movingInner",
      "currentRoad",
      "aheadOrApproaching",
    ],
  },
  "tokyo-setagaya": {
    desktop: [],
    touch: ["forwardRoad", "aheadOrApproaching"],
  },
};

type DeviceClass = "desktop" | "touch";
type AnchorKind = "authored" | "sparse" | "median" | "dense";

interface CommittedAnchorDefinition {
  readonly laneId: string;
  readonly distanceAlongM: number;
  readonly expectedFogLaneKm: number;
  readonly expectedInnerLaneKm: number;
}

/**
 * Committed p10/p50/p90 anchors from the shipping lane graph. Recomputing the
 * chosen streets from whatever topology happens to be present would let a map
 * regression silently move acceptance somewhere easier. Exact lane-km is
 * still recomputed below and audited against these evidence values.
 */
const COMMITTED_REPRESENTATIVE_ANCHORS: Readonly<
  Record<
    string,
    Readonly<
      Record<Exclude<AnchorKind, "authored">, CommittedAnchorDefinition>
    >
  >
> = {
  "london-south-kensington": {
    sparse: {
      // Re-anchored after London's thirteen-road density pass expanded the
      // sampled lane population from 527 to 587 positions.
      laneId: "london-riverbank-8-reverse-1",
      distanceAlongM: 50,
      expectedFogLaneKm: 4.299_806_912,
      expectedInnerLaneKm: 1.786_322_329,
    },
    median: {
      laneId: "london-riverbank-2-reverse-1",
      distanceAlongM: 550,
      expectedFogLaneKm: 7.469_092_196,
      expectedInnerLaneKm: 2.665_941_339,
    },
    dense: {
      laneId: "london-cheyne-walk-3-reverse-1",
      distanceAlongM: 250,
      expectedFogLaneKm: 10.706_194_513,
      expectedInnerLaneKm: 3.608_837_335,
    },
  },
  "cairo-central-nile": {
    sparse: {
      laneId: "cairo-south-gezira-road-3-reverse-1",
      distanceAlongM: 50,
      expectedFogLaneKm: 5.332_637_383,
      expectedInnerLaneKm: 1.894_673_590,
    },
    median: {
      laneId: "cairo-nile-island-drive-4-forward-1",
      distanceAlongM: 150,
      expectedFogLaneKm: 10.870_521_262,
      expectedInnerLaneKm: 3.188_147_892,
    },
    dense: {
      laneId: "cairo-corniche-el-nil-5-forward-1",
      distanceAlongM: 150,
      expectedFogLaneKm: 14.422_792_133,
      expectedInnerLaneKm: 5.311_058_669,
    },
  },
  "nyc-upper-west-side": {
    sparse: {
      laneId: "nyc-cres-n-hlb",
      distanceAlongM: 50,
      expectedFogLaneKm: 5.129_242_464_424_957,
      expectedInnerLaneKm: 3.398_047_727_601_238_4,
    },
    median: {
      laneId: "nyc-96-w-bway",
      distanceAlongM: 150,
      expectedFogLaneKm: 8.635_962_648_997_902,
      expectedInnerLaneKm: 3.596_347_496_358_948,
    },
    dense: {
      laneId: "nyc-bway-s-75",
      distanceAlongM: 150,
      expectedFogLaneKm: 10.614_048_398_569_059,
      expectedInnerLaneKm: 3.715_129_481_914_209_6,
    },
  },
  "tokyo-setagaya": {
    sparse: {
      laneId: "jp-nadeshiko-dori-2-forward-1",
      distanceAlongM: 350,
      expectedFogLaneKm: 5.373_075_096_502_778,
      expectedInnerLaneKm: 2.442_976_779_621_326,
    },
    median: {
      laneId: "jp-minami-kaido-3-reverse-1",
      distanceAlongM: 50,
      expectedFogLaneKm: 9.789_610_760_118_434,
      expectedInnerLaneKm: 2.993_021_943_186_970_5,
    },
    dense: {
      laneId: "jp-northrow-west-w",
      distanceAlongM: 50,
      expectedFogLaneKm: 14.897_147_130_054_202,
      expectedInnerLaneKm: 5.843_524_937_167_05,
    },
  },
};

/** Independent authored-start audit for storage plus fast continuity.
 * London is the only geometric storage exception. Every city's immutable
 * 30-second destination capacity is frozen separately; its nested shortfall
 * raises inner/ahead supply without lowering the stationary C/F floor. */
const AUTHORED_CORRIDOR_CAPACITY_EVIDENCE = {
  "london-south-kensington": {
    currentM: 113.22,
    forwardM: 84.64,
    desktop: {
      current: 4, forward: 3, streamCurrent: 0, streamForward: 0,
      inner: 16, ahead: 16,
    },
    touch: {
      current: 4, forward: 3, streamCurrent: 0, streamForward: 0,
      inner: 10, ahead: 10,
    },
  },
  "cairo-central-nile": {
    currentM: 4_245.36,
    forwardM: 3_172.28,
    desktop: {
      current: 12, forward: 8, streamCurrent: 9, streamForward: 10,
      inner: 16, ahead: 11,
    },
    touch: {
      current: 8, forward: 5, streamCurrent: 8, streamForward: 8,
      inner: 9, ahead: 6,
    },
  },
  "nyc-upper-west-side": {
    currentM: 1_223.27,
    forwardM: 882.18,
    desktop: {
      current: 12, forward: 8, streamCurrent: 3, streamForward: 3,
      inner: 16, ahead: 16,
    },
    touch: {
      current: 8, forward: 5, streamCurrent: 3, streamForward: 3,
      inner: 10, ahead: 10,
    },
  },
  "tokyo-setagaya": {
    currentM: 1_133.95,
    forwardM: 634.66,
    desktop: {
      current: 12, forward: 8, streamCurrent: 0, streamForward: 0,
      inner: 16, ahead: 16,
    },
    touch: {
      current: 8, forward: 5, streamCurrent: 0, streamForward: 0,
      inner: 10, ahead: 10,
    },
  },
} as const;

interface TrafficAnchor extends SimulationPoint {
  readonly kind: AnchorKind;
  readonly laneId: string;
  readonly distanceAlongM: number;
  readonly heading: number;
  readonly laneLengthWithinFogM: number;
  readonly laneLengthWithinInnerM: number;
}

interface LaneProjection {
  readonly laneId: string;
  readonly distanceAlongM: number;
  readonly separationM: number;
  readonly heading: number;
  readonly x: number;
  readonly z: number;
}

interface OracleLane {
  readonly lane: SimulationLane;
  readonly lengthM: number;
  readonly segmentLengthsM: readonly number[];
}

interface IndependentCurrentRoadOracle {
  readonly heading: number;
  readonly corridorLaneIds: ReadonlySet<string>;
  readonly laneLengthWithinFogM: number;
  readonly forwardLaneLengthWithinFogM: number;
}

interface IndependentStreamableCorridorCapacity {
  readonly currentRoad: number;
  readonly forwardRoad: number;
}

interface PerceptualSample {
  readonly withinFog: number;
  readonly withinInner: number;
  readonly movingWithinInner: number;
  readonly diagnosticMovingWithinInner: number;
  readonly currentRoad: number;
  readonly forwardRoad: number;
  readonly movingCurrentRoad: number;
  readonly movingForwardRoad: number;
  readonly movingOffCurrentFallback: number;
  readonly conservedCurrentPresence: number;
  readonly conservedForwardPresence: number;
  readonly lowSpeedCurrentRoad: number;
  readonly nearView: number;
  readonly independentSectorForward: number;
  readonly independentSectorRight: number;
  readonly independentSectorRear: number;
  readonly independentSectorLeft: number;
  readonly maximumLaneOccupancy: number;
  readonly maximumStoppedLaneQueue: number;
  readonly aheadOrApproaching: number;
  readonly diagnosticAheadOrApproaching: number;
  readonly forwardCorridor: number;
  readonly approachingCorridor: number;
  readonly currentCorridor: number;
  readonly sectorForward: number;
  readonly sectorRight: number;
  readonly sectorRear: number;
  readonly sectorLeft: number;
  readonly patrolWithinFog: number;
  readonly patrolWithinInner: number;
  readonly active: number;
  readonly queued: number;
  readonly pendingRecycle: number;
  readonly approach: number;
  readonly inboundTransit: number;
  readonly duplicateNpcIdentityCount: number;
}

interface PerceptualReport {
  readonly label: string;
  readonly device: DeviceClass;
  readonly mapId: string;
  readonly anchor: AnchorKind;
  readonly laneId: string;
  readonly position: readonly [number, number];
  readonly laneKm: {
    readonly fog: number;
    readonly inner: number;
    readonly currentRoad: number;
    readonly forwardRoad: number;
  };
  readonly target: {
    readonly fog: number;
    readonly inner: number;
    readonly movingInner: number;
    readonly currentCorridor: number;
    readonly forwardCorridor: number;
    readonly movingCurrentRoad: number;
    readonly movingForwardRoad: number;
    readonly nearView: number;
    readonly aheadOrApproaching: number;
    readonly circulatingApproach: number;
    readonly patrolFogCap: number;
    readonly patrolInnerCap: number;
    readonly currentRoadCapacity: number;
    readonly forwardRoadCapacity: number;
    readonly streamableCurrentRoadCapacity: number;
    readonly streamableForwardRoadCapacity: number;
    readonly corridorShortfall: number;
  };
  readonly fog: DistributionSummary;
  readonly inner: DistributionSummary;
  readonly movingInner: DistributionSummary;
  readonly diagnosticMovingInner: DistributionSummary;
  readonly currentRoad: DistributionSummary;
  readonly forwardRoad: DistributionSummary;
  readonly movingCurrentRoad: DistributionSummary;
  readonly movingForwardRoad: DistributionSummary;
  readonly movingOffCurrentFallback: DistributionSummary;
  readonly conservedCurrentPresence: DistributionSummary;
  readonly conservedForwardPresence: DistributionSummary;
  readonly lowSpeedCurrentRoad: DistributionSummary;
  readonly nearView: DistributionSummary;
  readonly forwardCorridor: DistributionSummary;
  readonly approachingCorridor: DistributionSummary;
  readonly aheadOrApproaching: DistributionSummary;
  readonly diagnosticAheadOrApproaching: DistributionSummary;
  readonly currentCorridor: DistributionSummary;
  readonly patrolWithinFog: DistributionSummary;
  readonly patrolWithinInner: DistributionSummary;
  readonly movingInnerFraction: number;
  readonly currentRoadZeroFraction: number;
  readonly forwardRoadZeroFraction: number;
  readonly aheadOrApproachingZeroFraction: number;
  readonly maximumAheadOrApproachingGhostSeconds: number;
  readonly maximumDiagnosticGhostSeconds: number;
  readonly currentCorridorOccupiedFraction: number;
  readonly maximumCurrentCorridorGhostSeconds: number;
  readonly conservationViolationSamples: number;
  readonly maximumPrimaryBelowFloorSeconds: Readonly<
    Record<
      | "fog"
      | "inner"
      | "movingInner"
      | "currentRoad"
      | "forwardRoad"
      | "conservedCurrent"
      | "conservedForward"
      | "ahead"
      | "nearView",
      number
    >
  >;
  readonly minimumIndependentOccupiedSectors: number;
  readonly maximumIndependentSectorShare: number;
  readonly maximumLaneOccupancy: number;
  readonly maximumStoppedLaneQueue: number;
  readonly active: DistributionSummary;
  readonly queued: DistributionSummary;
  readonly maximumQueued: number;
  readonly maximumPendingRecycle: number;
  readonly maximumApproach: number;
  readonly maximumInboundTransit: number;
  readonly maximumRadialDiagnosticDelta: number;
  readonly maximumPatrolDiagnosticDelta: number;
  readonly maximumSectorDiagnosticDelta: number;
  readonly gradedLifecycle: {
    readonly activationDelta: number;
    readonly retirementDelta: number;
    readonly activeDelta: number;
    readonly queuedDelta: number;
    readonly maximumEach: number;
  };
  readonly elapsedWallMs: number;
  readonly cleanMainRatios: {
    readonly fog: number | null;
    readonly inner: number | null;
    readonly movingInner: number | null;
    readonly currentRoad: number | null;
    readonly forwardRoad: number | null;
    readonly aheadOrApproaching: number | null;
  } | null;
  readonly cleanMainFivefoldAssessment: CleanMainFivefoldAssessment | null;
}

interface DistributionSummary {
  readonly p10: number;
  readonly p50: number;
  readonly mean: number;
  readonly p90: number;
  readonly minimum: number;
  readonly maximum: number;
}

interface BustlingAcceptanceTargets {
  readonly withinFog: number;
  readonly withinInner: number;
  readonly movingWithinInner: number;
  readonly currentRoad: number;
  readonly forwardRoad: number;
  readonly movingCurrentRoad: number;
  readonly movingForwardRoad: number;
  readonly nearView: number;
  readonly aheadOrApproaching: number;
  readonly currentRoadCapacity: number;
  readonly forwardRoadCapacity: number;
  readonly streamableCurrentRoadCapacity: number;
  readonly streamableForwardRoadCapacity: number;
  readonly corridorShortfall: number;
}

const clampRounded = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Math.round(value)));

function cleanMainBaselineMetricValues(
  baseline: AuthoredCleanMainBaseline,
): CleanMainMetricValues {
  return {
    fog: baseline.fogMean,
    inner: baseline.innerMean,
    movingInner: baseline.movingMean,
    currentRoad: baseline.currentRoadMean,
    forwardRoad: baseline.forwardRoadMean,
    aheadOrApproaching: baseline.aheadOrApproachingMean,
  };
}

function cleanMainFivefoldCapacityCeilings(
  device: DeviceClass,
  poolCount: number,
  currentRoadCapacity: number,
  forwardRoadCapacity: number,
): CleanMainMetricValues {
  // A 30-second feed is a moving continuity constraint, not a mathematical
  // storage/safety ceiling. Fivefold eligibility therefore stays tied to the
  // fixed pool, radial caps and independently clipped corridor arclength; a
  // slow feed cannot grant a city an easier baseline-ratio exemption.
  const calibration = BUSTLING_CALIBRATION[device];
  const pool = Math.max(0, Math.trunc(poolCount));
  const maximumFog = Math.min(pool, calibration.fog.maximum);
  const maximumInner = Math.min(pool, calibration.inner.maximum);
  const maximumCurrentRoad = Math.min(
    pool,
    maximumFog,
    calibration.corridorCap,
    Math.max(0, Math.trunc(currentRoadCapacity)),
  );
  const maximumForwardRoad = Math.min(
    maximumCurrentRoad,
    Math.max(0, Math.trunc(forwardRoadCapacity)),
  );
  return {
    fog: maximumFog,
    inner: maximumInner,
    movingInner: maximumInner,
    currentRoad: maximumCurrentRoad,
    forwardRoad: maximumForwardRoad,
    aheadOrApproaching: maximumInner,
  };
}

function assessCleanMainFivefoldCapacity(
  baseline: AuthoredCleanMainBaseline,
  maximumSafeMeans: CleanMainMetricValues,
): CleanMainFivefoldAssessment {
  const baselineMeans = cleanMainBaselineMetricValues(baseline);
  return Object.fromEntries(
    CLEAN_MAIN_COMPARISON_METRICS.map((metric) => {
      const baselineMean = baselineMeans[metric];
      const maximumSafeMean = maximumSafeMeans[metric];
      const requiredMean = baselineMean > 0 ? baselineMean * 5 : null;
      return [
        metric,
        {
          baselineMean,
          requiredMean,
          maximumSafeMean,
          eligibility:
            requiredMean === null
              ? "zero-baseline"
              : requiredMean <= maximumSafeMean + 1e-9
                ? "eligible"
                : "capacity-impossible",
        },
      ];
    }),
  ) as unknown as CleanMainFivefoldAssessment;
}

function resolveBustlingAcceptanceTargets(
  laneLengthWithinFogM: number,
  laneLengthWithinInnerM: number,
  currentRoadLaneLengthWithinFogM: number,
  forwardRoadLaneLengthWithinFogM: number,
  poolCount: number,
  device: DeviceClass,
  streamableCurrentRoadCapacity = Number.POSITIVE_INFINITY,
  streamableForwardRoadCapacity = Number.POSITIVE_INFINITY,
): BustlingAcceptanceTargets {
  const calibration = BUSTLING_CALIBRATION[device];
  const pool = Math.max(0, Math.trunc(poolCount));
  const withinFog = Math.min(
    pool,
    clampRounded(
      (Math.max(0, laneLengthWithinFogM) / 1_000) *
        calibration.carsPerLaneKm,
      calibration.fog.minimum,
      calibration.fog.maximum,
    ),
  );
  const baseWithinInner = Math.min(
    withinFog,
    clampRounded(
      (Math.max(0, laneLengthWithinInnerM) / 1_000) *
        calibration.carsPerLaneKm,
      calibration.inner.minimum,
      calibration.inner.maximum,
    ),
  );
  const currentRoadCapacity = Math.floor(
    Math.max(0, currentRoadLaneLengthWithinFogM) /
      ACCEPTANCE_CORRIDOR_SAFE_SPACING_M,
  );
  const forwardRoadCapacity = Math.floor(
    Math.max(0, forwardRoadLaneLengthWithinFogM) /
      ACCEPTANCE_CORRIDOR_SAFE_SPACING_M,
  );
  const currentRoad = Math.min(
    pool,
    withinFog,
    calibration.corridorCap,
    calibration.currentRoad,
    currentRoadCapacity,
  );
  const forwardRoad = Math.min(
    pool,
    currentRoad,
    calibration.forwardRoad,
    forwardRoadCapacity,
  );
  const normalizedStreamableCurrentRoadCapacity = Number.isFinite(
    streamableCurrentRoadCapacity,
  )
    ? Math.max(0, Math.trunc(streamableCurrentRoadCapacity))
    : Number.POSITIVE_INFINITY;
  const normalizedStreamableForwardRoadCapacity = Number.isFinite(
    streamableForwardRoadCapacity,
  )
    ? Math.max(0, Math.trunc(streamableForwardRoadCapacity))
    : Number.POSITIVE_INFINITY;
  const fastCurrentRoad = Math.min(
    currentRoad,
    normalizedStreamableCurrentRoadCapacity,
  );
  const fastForwardRoad = Math.min(
    forwardRoad,
    normalizedStreamableForwardRoadCapacity,
  );
  const corridorShortfall = Math.max(
    calibration.currentRoad - fastCurrentRoad,
    calibration.forwardRoad - fastForwardRoad,
  );
  const withinInner = Math.min(
    withinFog,
    calibration.inner.maximum,
    baseWithinInner + corridorShortfall,
  );
  return {
    withinFog,
    withinInner,
    movingWithinInner: Math.min(
      pool,
      withinInner,
      calibration.movingInner,
    ),
    currentRoad,
    forwardRoad,
    movingCurrentRoad: Math.min(
      pool,
      currentRoad,
      calibration.movingCurrentRoad,
    ),
    movingForwardRoad: Math.min(
      pool,
      forwardRoad,
      calibration.movingForwardRoad,
    ),
    aheadOrApproaching: Math.min(
      pool,
      withinInner,
      calibration.aheadOrApproaching + corridorShortfall,
    ),
    nearView: Math.min(pool, withinInner, calibration.nearView),
    currentRoadCapacity,
    forwardRoadCapacity,
    streamableCurrentRoadCapacity: normalizedStreamableCurrentRoadCapacity,
    streamableForwardRoadCapacity: normalizedStreamableForwardRoadCapacity,
    corridorShortfall,
  };
}

const distance = (
  left: { readonly x: number; readonly z: number },
  right: { readonly x: number; readonly z: number },
): number => Math.hypot(left.x - right.x, left.z - right.z);

const angleDifference = (left: number, right: number): number => {
  let difference = left - right;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
};

const laneLength = (lane: SimulationLane): number => {
  let result = 0;
  for (let index = 1; index < lane.points.length; index += 1) {
    result += distance(lane.points[index - 1], lane.points[index]);
  }
  return result;
};

function pointOnLane(
  lane: SimulationLane,
  requestedDistanceM: number,
): SimulationPoint & { readonly heading: number } {
  let remainingM = Math.max(0, requestedDistanceM);
  for (let index = 1; index < lane.points.length; index += 1) {
    const from = lane.points[index - 1];
    const to = lane.points[index];
    const segmentLengthM = distance(from, to);
    if (segmentLengthM <= Number.EPSILON) continue;
    if (remainingM <= segmentLengthM) {
      const fraction = remainingM / segmentLengthM;
      return {
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
        heading: Math.atan2(to.x - from.x, to.z - from.z),
      };
    }
    remainingM -= segmentLengthM;
  }
  const to = lane.points[lane.points.length - 1];
  const from = lane.points[lane.points.length - 2];
  return {
    x: to.x,
    z: to.z,
    heading: Math.atan2(to.x - from.x, to.z - from.z),
  };
}

function projectToLane(
  lane: SimulationLane,
  point: SimulationPoint,
): LaneProjection | null {
  let traversedM = 0;
  let best: LaneProjection | null = null;
  for (let index = 1; index < lane.points.length; index += 1) {
    const from = lane.points[index - 1];
    const to = lane.points[index];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= Number.EPSILON) continue;
    const segmentLengthM = Math.sqrt(lengthSquared);
    const fraction = Math.min(
      1,
      Math.max(
        0,
        ((point.x - from.x) * dx + (point.z - from.z) * dz) /
          lengthSquared,
      ),
    );
    const x = from.x + dx * fraction;
    const z = from.z + dz * fraction;
    const candidate: LaneProjection = {
      laneId: lane.id,
      distanceAlongM: traversedM + segmentLengthM * fraction,
      separationM: Math.hypot(point.x - x, point.z - z),
      heading: Math.atan2(dx, dz),
      x,
      z,
    };
    if (
      !best ||
      candidate.separationM < best.separationM ||
      (candidate.separationM === best.separationM &&
        candidate.distanceAlongM < best.distanceAlongM)
    ) {
      best = candidate;
    }
    traversedM += segmentLengthM;
  }
  return best;
}

/** Independent statement of the proposed optional RoadNetwork tie contract:
 * find the true geometric minimum first, admit only candidates within the
 * fixed distance epsilon, then prefer heading and stable lane id. Filtering by
 * the global minimum avoids a non-transitive pairwise epsilon comparator. */
function projectToRoadWithHeadingTie(
  lanes: readonly SimulationLane[],
  point: SimulationPoint,
  preferredHeading: number,
  distanceTieEpsilonM = ACCEPTANCE_PROJECTION_DISTANCE_TIE_EPSILON_M,
): LaneProjection | null {
  const candidates: LaneProjection[] = [];
  for (const lane of lanes) {
    let traversedM = 0;
    for (let index = 1; index < lane.points.length; index += 1) {
      const from = lane.points[index - 1];
      const to = lane.points[index];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared <= Number.EPSILON) continue;
      const segmentLengthM = Math.sqrt(lengthSquared);
      const fraction = Math.min(
        1,
        Math.max(
          0,
          ((point.x - from.x) * dx + (point.z - from.z) * dz) /
            lengthSquared,
        ),
      );
      const x = from.x + dx * fraction;
      const z = from.z + dz * fraction;
      candidates.push({
        laneId: lane.id,
        distanceAlongM: traversedM + segmentLengthM * fraction,
        separationM: Math.hypot(point.x - x, point.z - z),
        heading: Math.atan2(dx, dz),
        x,
        z,
      });
      traversedM += segmentLengthM;
    }
  }
  if (candidates.length === 0) return null;
  const minimumDistance = Math.min(
    ...candidates.map((candidate) => candidate.separationM),
  );
  let best: LaneProjection | null = null;
  let bestHeadingDifference = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.separationM >
      minimumDistance + distanceTieEpsilonM + 1e-9
    ) {
      continue;
    }
    const headingDifference = Math.abs(
      angleDifference(candidate.heading, preferredHeading),
    );
    if (
      !best ||
      headingDifference < bestHeadingDifference - 1e-9 ||
      (Math.abs(headingDifference - bestHeadingDifference) <= 1e-9 &&
        (candidate.laneId < best.laneId ||
          (candidate.laneId === best.laneId &&
            candidate.distanceAlongM < best.distanceAlongM)))
    ) {
      best = candidate;
      bestHeadingDifference = headingDifference;
    }
  }
  return best;
}

function buildLaneOracle(
  lanes: readonly SimulationLane[],
): ReadonlyMap<string, OracleLane> {
  return new Map(
    lanes.map((lane) => {
      const segmentLengthsM = lane.points.slice(1).map((point, index) =>
        distance(lane.points[index], point),
      );
      return [
        lane.id,
        {
          lane,
          lengthM: segmentLengthsM.reduce(
            (total, segmentLengthM) => total + segmentLengthM,
            0,
          ),
          segmentLengthsM,
        },
      ];
    }),
  );
}

function endpointHeading(
  lane: SimulationLane,
  atStart: boolean,
): number | null {
  if (atStart) {
    for (let index = 1; index < lane.points.length; index += 1) {
      const start = lane.points[index - 1];
      const end = lane.points[index];
      if (distance(start, end) > Number.EPSILON) {
        return Math.atan2(end.x - start.x, end.z - start.z);
      }
    }
  } else {
    for (let index = lane.points.length - 1; index > 0; index -= 1) {
      const start = lane.points[index - 1];
      const end = lane.points[index];
      if (distance(start, end) > Number.EPSILON) {
        return Math.atan2(end.x - start.x, end.z - start.z);
      }
    }
  }
  return null;
}

function buildIndependentCurrentRoadOracle(
  laneOracle: ReadonlyMap<string, OracleLane>,
  player: SimulationPoint & { readonly heading: number },
  capacityLaneIds: ReadonlySet<string> = new Set(laneOracle.keys()),
): IndependentCurrentRoadOracle {
  const projectedLanes = [...laneOracle.values()].flatMap((oracleLane) => {
    const projection = projectToLane(oracleLane.lane, player);
    return projection ? [{ oracleLane, projection }] : [];
  });
  const playerProjection = projectToRoadWithHeadingTie(
    [...laneOracle.values()].map(({ lane }) => lane),
    player,
    player.heading,
  );
  const primaryLane = playerProjection
    ? laneOracle.get(playerProjection.laneId)
    : undefined;
  if (!playerProjection || !primaryLane) {
    throw new Error("player cannot project to a simulation lane");
  }
  const heading = playerProjection.heading;
  const projectionByLaneId = new Map(
    projectedLanes.map(({ oracleLane, projection }) => [
      oracleLane.lane.id,
      projection,
    ]),
  );
  const alignmentMinimum = Math.cos(ACCEPTANCE_CURRENT_ROAD_ALIGNMENT_RAD);
  const endpointsContinue = (
    predecessor: OracleLane,
    successor: OracleLane,
  ): boolean => {
    const predecessorEnd =
      predecessor.lane.points[predecessor.lane.points.length - 1];
    const successorStart = successor.lane.points[0];
    const predecessorHeading = endpointHeading(predecessor.lane, false);
    const successorHeading = endpointHeading(successor.lane, true);
    return (
      distance(predecessorEnd, successorStart) <= 0.5 &&
      predecessorHeading !== null &&
      successorHeading !== null &&
      Math.cos(angleDifference(predecessorHeading, successorHeading)) >=
        alignmentMinimum
    );
  };

  // A named roadId can cover only one short authored block. The perceptual
  // corridor instead starts with every parallel/opposing carriageway crossing
  // the player's 60 m road strip, then follows only endpoint-continuous,
  // directed straight graph edges. Restricting every added lane to geometry
  // that intersects the 440 m disc keeps the closure local without confusing
  // a nearby turning street for the road visible through the junction.
  const predecessors = new Map<string, OracleLane[]>();
  for (const candidate of laneOracle.values()) {
    for (const successorId of candidate.lane.successorLaneIds ?? []) {
      const entries = predecessors.get(successorId) ?? [];
      entries.push(candidate);
      predecessors.set(successorId, entries);
    }
  }
  const corridorIds = new Set<string>();
  const queue: OracleLane[] = [];
  for (const { oracleLane, projection } of projectedLanes) {
    const pairedSeed =
      projection.separationM <= ACCEPTANCE_CURRENT_ROAD_HALF_WIDTH_M &&
      Math.abs(Math.cos(angleDifference(projection.heading, heading))) >=
        alignmentMinimum;
    if (oracleLane.lane.id !== primaryLane.lane.id && !pairedSeed) continue;
    corridorIds.add(oracleLane.lane.id);
    queue.push(oracleLane);
  }
  const tryAdd = (
    candidate: OracleLane | undefined,
    predecessor: OracleLane,
    successor: OracleLane,
  ): void => {
    if (
      !candidate ||
      corridorIds.has(candidate.lane.id) ||
      (projectionByLaneId.get(candidate.lane.id)?.separationM ?? Infinity) >
        ACCEPTANCE_FOG_RADIUS_M ||
      !endpointsContinue(predecessor, successor)
    ) {
      return;
    }
    corridorIds.add(candidate.lane.id);
    queue.push(candidate);
  };
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const lane = queue[cursor];
    for (const successorId of lane.lane.successorLaneIds ?? []) {
      const successor = laneOracle.get(successorId);
      if (successor) tryAdd(successor, lane, successor);
    }
    for (const predecessor of predecessors.get(lane.lane.id) ?? []) {
      tryAdd(predecessor, predecessor, lane);
    }
  }
  let laneLengthWithinFogM = 0;
  let forwardLaneLengthWithinFogM = 0;
  for (const laneId of corridorIds) {
    if (!capacityLaneIds.has(laneId)) continue;
    const lane = laneOracle.get(laneId)?.lane;
    if (!lane) continue;
    for (let index = 1; index < lane.points.length; index += 1) {
      laneLengthWithinFogM += segmentLengthInsideCircle(
        lane.points[index - 1],
        lane.points[index],
        player,
        ACCEPTANCE_FOG_RADIUS_M,
      );
      forwardLaneLengthWithinFogM +=
        segmentLengthInsideCircleAndForwardHalfPlane(
          lane.points[index - 1],
          lane.points[index],
          player,
          ACCEPTANCE_FOG_RADIUS_M,
          heading,
        );
    }
  }
  return {
    heading,
    corridorLaneIds: corridorIds,
    laneLengthWithinFogM,
    forwardLaneLengthWithinFogM,
  };
}

interface IndependentGoalSeed {
  readonly laneIndex: number;
  readonly entryDistance: number;
  readonly exitDistance: number;
  readonly minimumDirectOriginDistance?: number;
  readonly allowPredecessorEntry?: boolean;
}

interface IndependentGoalTable {
  readonly laneCount: number;
  readonly distanceFromLaneStartByHopBudget: Float64Array;
  readonly usedHopsByHopBudget: Uint16Array;
  readonly nextLaneIndexByHopBudget: Int32Array;
  readonly targetLaneIndexByHopBudget: Int32Array;
  readonly targetEntryDistance: Float64Array;
  readonly targetExitDistance: Float64Array;
  readonly targetMinimumDirectOriginDistance: Float64Array;
  readonly targetAllowsPredecessorEntry: Uint8Array;
}

function firstIndependentLaneLocalityInterval(
  oracleLane: OracleLane,
  centre: SimulationPoint,
  radiusM: number,
  roadHeading: number,
  requireForward: boolean,
): { readonly entryDistance: number; readonly exitDistance: number } | null {
  const radiusSquared = radiusM * radiusM;
  const forwardX = Math.sin(roadHeading);
  const forwardZ = Math.cos(roadHeading);
  let accumulatedM = 0;
  let firstEntryM: number | null = null;
  let latestExitM = Number.NaN;
  for (
    let index = 0;
    index < oracleLane.segmentLengthsM.length;
    index += 1
  ) {
    const start = oracleLane.lane.points[index];
    const end = oracleLane.lane.points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const segmentLengthM = oracleLane.segmentLengthsM[index];
    const lengthSquared = dx * dx + dz * dz;
    if (segmentLengthM <= Number.EPSILON || lengthSquared <= Number.EPSILON) {
      accumulatedM += segmentLengthM;
      continue;
    }
    const relativeX = start.x - centre.x;
    const relativeZ = start.z - centre.z;
    const quadraticB = 2 * (relativeX * dx + relativeZ * dz);
    const quadraticC =
      relativeX * relativeX + relativeZ * relativeZ - radiusSquared;
    const discriminant =
      quadraticB * quadraticB - 4 * lengthSquared * quadraticC;
    let intervalStart = Number.POSITIVE_INFINITY;
    let intervalEnd = Number.NEGATIVE_INFINITY;
    if (discriminant >= -1e-9) {
      const root = Math.sqrt(Math.max(0, discriminant));
      intervalStart = Math.max(
        0,
        (-quadraticB - root) / (2 * lengthSquared),
      );
      intervalEnd = Math.min(
        1,
        (-quadraticB + root) / (2 * lengthSquared),
      );
    }
    if (requireForward && intervalStart <= intervalEnd) {
      const startLongitudinal =
        relativeX * forwardX + relativeZ * forwardZ;
      const endLongitudinal =
        (end.x - centre.x) * forwardX +
        (end.z - centre.z) * forwardZ;
      const longitudinalDelta = endLongitudinal - startLongitudinal;
      if (Math.abs(longitudinalDelta) <= 1e-9) {
        if (startLongitudinal < 0) {
          intervalStart = Number.POSITIVE_INFINITY;
        }
      } else {
        const boundary = -startLongitudinal / longitudinalDelta;
        if (longitudinalDelta > 0) {
          intervalStart = Math.max(intervalStart, boundary);
        } else {
          intervalEnd = Math.min(intervalEnd, boundary);
        }
      }
    }
    if (intervalStart <= intervalEnd + 1e-9) {
      intervalStart = Math.min(1, Math.max(0, intervalStart));
      intervalEnd = Math.min(1, Math.max(0, intervalEnd));
      const entryDistance = accumulatedM + intervalStart * segmentLengthM;
      const exitDistance = accumulatedM + intervalEnd * segmentLengthM;
      if (firstEntryM === null) {
        firstEntryM = entryDistance;
        latestExitM = exitDistance;
      } else if (
        intervalStart <= 1e-9 &&
        entryDistance <= latestExitM + 1e-6
      ) {
        latestExitM = Math.max(latestExitM, exitDistance);
      } else {
        return { entryDistance: firstEntryM, exitDistance: latestExitM };
      }
      if (intervalEnd < 1 - 1e-9) {
        return { entryDistance: firstEntryM, exitDistance: latestExitM };
      }
    } else if (firstEntryM !== null) {
      return { entryDistance: firstEntryM, exitDistance: latestExitM };
    }
    accumulatedM += segmentLengthM;
  }
  return firstEntryM === null
    ? null
    : { entryDistance: firstEntryM, exitDistance: latestExitM };
}

function buildIndependentGoalTable(
  lanes: readonly OracleLane[],
  laneIndexById: ReadonlyMap<string, number>,
  targetSeeds: readonly IndependentGoalSeed[],
): IndependentGoalTable {
  const laneCount = lanes.length;
  const budgetCount = ACCEPTANCE_ROUTE_MAX_HOPS + 1;
  const stateCount = laneCount * budgetCount;
  const distanceFromLaneStartByHopBudget = new Float64Array(stateCount);
  distanceFromLaneStartByHopBudget.fill(Number.POSITIVE_INFINITY);
  const usedHopsByHopBudget = new Uint16Array(stateCount);
  usedHopsByHopBudget.fill(0xffff);
  const nextLaneIndexByHopBudget = new Int32Array(stateCount);
  nextLaneIndexByHopBudget.fill(-1);
  const targetLaneIndexByHopBudget = new Int32Array(stateCount);
  targetLaneIndexByHopBudget.fill(-1);
  const targetEntryDistance = new Float64Array(laneCount);
  targetEntryDistance.fill(Number.NaN);
  const targetExitDistance = new Float64Array(laneCount);
  targetExitDistance.fill(Number.NaN);
  const targetMinimumDirectOriginDistance = new Float64Array(laneCount);
  targetMinimumDirectOriginDistance.fill(Number.NEGATIVE_INFINITY);
  const targetAllowsPredecessorEntry = new Uint8Array(laneCount);
  targetAllowsPredecessorEntry.fill(1);

  for (const seed of targetSeeds) {
    if (seed.laneIndex < 0 || seed.laneIndex >= laneCount) continue;
    const laneLengthM = lanes[seed.laneIndex].lengthM;
    const entryDistance = Math.min(
      laneLengthM,
      Math.max(0, seed.entryDistance),
    );
    const exitDistance = Math.min(
      laneLengthM,
      Math.max(entryDistance, seed.exitDistance),
    );
    if (
      Number.isFinite(targetEntryDistance[seed.laneIndex]) &&
      targetEntryDistance[seed.laneIndex] <= entryDistance
    ) {
      continue;
    }
    targetEntryDistance[seed.laneIndex] = entryDistance;
    targetExitDistance[seed.laneIndex] = exitDistance;
    targetMinimumDirectOriginDistance[seed.laneIndex] =
      seed.minimumDirectOriginDistance ?? Number.NEGATIVE_INFINITY;
    targetAllowsPredecessorEntry[seed.laneIndex] =
      seed.allowPredecessorEntry === false ? 0 : 1;
    distanceFromLaneStartByHopBudget[seed.laneIndex] = entryDistance;
    usedHopsByHopBudget[seed.laneIndex] = 0;
    targetLaneIndexByHopBudget[seed.laneIndex] = seed.laneIndex;
  }

  const predecessorIndicesByLaneIndex = Array.from(
    { length: laneCount },
    () => [] as number[],
  );
  for (let predecessorIndex = 0; predecessorIndex < laneCount; predecessorIndex += 1) {
    const predecessor = lanes[predecessorIndex];
    const predecessorEnd =
      predecessor.lane.points[predecessor.lane.points.length - 1];
    for (const successorId of predecessor.lane.successorLaneIds ?? []) {
      const successorIndex = laneIndexById.get(successorId);
      if (successorIndex === undefined) continue;
      const successorStart = lanes[successorIndex].lane.points[0];
      if (distance(predecessorEnd, successorStart) <= 0.5) {
        predecessorIndicesByLaneIndex[successorIndex].push(predecessorIndex);
      }
    }
  }

  for (let hopBudget = 1; hopBudget < budgetCount; hopBudget += 1) {
    const priorOffset = (hopBudget - 1) * laneCount;
    const offset = hopBudget * laneCount;
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      distanceFromLaneStartByHopBudget[offset + laneIndex] =
        distanceFromLaneStartByHopBudget[priorOffset + laneIndex];
      usedHopsByHopBudget[offset + laneIndex] =
        usedHopsByHopBudget[priorOffset + laneIndex];
      nextLaneIndexByHopBudget[offset + laneIndex] =
        nextLaneIndexByHopBudget[priorOffset + laneIndex];
      targetLaneIndexByHopBudget[offset + laneIndex] =
        targetLaneIndexByHopBudget[priorOffset + laneIndex];
    }
    for (let successorIndex = 0; successorIndex < laneCount; successorIndex += 1) {
      const successorDistance =
        distanceFromLaneStartByHopBudget[priorOffset + successorIndex];
      const successorUsedHops =
        usedHopsByHopBudget[priorOffset + successorIndex];
      const successorTarget =
        targetLaneIndexByHopBudget[priorOffset + successorIndex];
      if (
        !Number.isFinite(successorDistance) ||
        successorUsedHops === 0xffff ||
        successorTarget < 0 ||
        (successorUsedHops === 0 &&
          targetAllowsPredecessorEntry[successorIndex] === 0)
      ) {
        continue;
      }
      for (const predecessorIndex of
        predecessorIndicesByLaneIndex[successorIndex]) {
        const candidateDistance =
          lanes[predecessorIndex].lengthM + successorDistance;
        const candidateUsedHops = successorUsedHops + 1;
        const stateIndex = offset + predecessorIndex;
        const priorDistance = distanceFromLaneStartByHopBudget[stateIndex];
        const priorUsedHops = usedHopsByHopBudget[stateIndex];
        const priorNext = nextLaneIndexByHopBudget[stateIndex];
        const priorTarget = targetLaneIndexByHopBudget[stateIndex];
        if (
          candidateDistance > priorDistance + 1e-9 ||
          (Math.abs(candidateDistance - priorDistance) <= 1e-9 &&
            (candidateUsedHops > priorUsedHops ||
              (candidateUsedHops === priorUsedHops &&
                (successorTarget > priorTarget ||
                  (successorTarget === priorTarget &&
                    priorNext >= 0 &&
                    successorIndex >= priorNext)))))
        ) {
          continue;
        }
        distanceFromLaneStartByHopBudget[stateIndex] = candidateDistance;
        usedHopsByHopBudget[stateIndex] = candidateUsedHops;
        nextLaneIndexByHopBudget[stateIndex] = successorIndex;
        targetLaneIndexByHopBudget[stateIndex] = successorTarget;
      }
    }
  }
  return {
    laneCount,
    distanceFromLaneStartByHopBudget,
    usedHopsByHopBudget,
    nextLaneIndexByHopBudget,
    targetLaneIndexByHopBudget,
    targetEntryDistance,
    targetExitDistance,
    targetMinimumDirectOriginDistance,
    targetAllowsPredecessorEntry,
  };
}

function independentGoalTravelTimeSeconds(
  lanes: readonly OracleLane[],
  table: IndependentGoalTable,
  originLaneIndex: number,
  rawOriginDistanceM: number,
  rawHopBudget: number,
): { readonly seconds: number; readonly targetLaneIndex: number } | null {
  const originLane = lanes[originLaneIndex];
  if (!originLane) return null;
  let laneIndex = originLaneIndex;
  let distanceAlongM = Math.min(
    originLane.lengthM,
    Math.max(0, rawOriginDistanceM),
  );
  let hopBudget = Math.min(
    ACCEPTANCE_ROUTE_MAX_HOPS,
    Math.max(0, Math.trunc(rawHopBudget)),
  );
  const directTargetEntry = table.targetEntryDistance[laneIndex];
  const physicalDistanceM = Number.isFinite(directTargetEntry)
    ? Math.max(0, directTargetEntry - distanceAlongM)
    : Math.max(
        0,
        table.distanceFromLaneStartByHopBudget[
          hopBudget * table.laneCount + laneIndex
        ] - distanceAlongM,
      );
  const usedHops = Number.isFinite(directTargetEntry)
    ? 0
    : table.usedHopsByHopBudget[
        hopBudget * table.laneCount + laneIndex
      ];
  if (
    !Number.isFinite(physicalDistanceM) ||
    physicalDistanceM > ACCEPTANCE_ROUTE_LOOKAHEAD_M ||
    usedHops === 0xffff ||
    usedHops > hopBudget
  ) {
    return null;
  }
  const speedOn = (lane: OracleLane): number =>
    Math.max(
      1,
      Math.min(45, Math.max(2, lane.lane.speedLimitMps ?? 13.4)) *
        ACCEPTANCE_STREAMABLE_DRIVER_SPEED_FACTOR,
    );
  let etaSeconds = ACCEPTANCE_STREAMABLE_STARTUP_SECONDS;
  for (
    let transition = 0;
    transition <= ACCEPTANCE_ROUTE_MAX_HOPS;
    transition += 1
  ) {
    const lane = lanes[laneIndex];
    const targetEntry = table.targetEntryDistance[laneIndex];
    if (Number.isFinite(targetEntry)) {
      if (
        distanceAlongM <
          table.targetMinimumDirectOriginDistance[laneIndex] - 1e-9 ||
        distanceAlongM > table.targetExitDistance[laneIndex] + 1e-9
      ) {
        return null;
      }
      etaSeconds +=
        Math.max(0, targetEntry - distanceAlongM) / speedOn(lane);
      return {
        seconds: etaSeconds,
        targetLaneIndex: laneIndex,
      };
    }
    if (hopBudget <= 0) return null;
    const stateIndex = hopBudget * table.laneCount + laneIndex;
    const nextLaneIndex = table.nextLaneIndexByHopBudget[stateIndex];
    const nextLane = lanes[nextLaneIndex];
    if (!nextLane) return null;
    const successorId = nextLane.lane.id;
    const currentEnd = lane.lane.points[lane.lane.points.length - 1];
    const successorStart = nextLane.lane.points[0];
    if (
      !(lane.lane.successorLaneIds ?? []).includes(successorId) ||
      distance(currentEnd, successorStart) > 0.5
    ) {
      return null;
    }
    etaSeconds +=
      Math.max(0, lane.lengthM - distanceAlongM) / speedOn(lane);
    laneIndex = nextLaneIndex;
    distanceAlongM = 0;
    hopBudget -= 1;
  }
  return null;
}

function resolveIndependentStreamableCorridorCapacity(
  config: SimulationCoreConfig,
  laneOracle: ReadonlyMap<string, OracleLane>,
  currentRoadOracle: IndependentCurrentRoadOracle,
  device: DeviceClass,
): IndependentStreamableCorridorCapacity {
  const lanes = (config.lanes ?? []).map((lane) => {
    const oracleLane = laneOracle.get(lane.id);
    if (!oracleLane) throw new Error(`missing lane oracle for ${lane.id}`);
    return oracleLane;
  });
  const laneIndexById = new Map(
    lanes.map((lane, index) => [lane.lane.id, index]),
  );
  const currentSeeds: IndependentGoalSeed[] = [];
  const forwardSeeds: IndependentGoalSeed[] = [];
  const player = config.spawn;
  if (!player) return { currentRoad: 0, forwardRoad: 0 };
  const alignmentMinimum = Math.cos(ACCEPTANCE_CURRENT_ROAD_ALIGNMENT_RAD);
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (!currentRoadOracle.corridorLaneIds.has(lane.lane.id)) continue;
    const currentInterval = firstIndependentLaneLocalityInterval(
      lane,
      player,
      ACCEPTANCE_FOG_RADIUS_M,
      currentRoadOracle.heading,
      false,
    );
    if (currentInterval) {
      currentSeeds.push({ laneIndex, ...currentInterval });
    }
    const forwardInterval = firstIndependentLaneLocalityInterval(
      lane,
      player,
      ACCEPTANCE_FOG_RADIUS_M,
      currentRoadOracle.heading,
      true,
    );
    if (!forwardInterval) continue;
    const start = lane.lane.points[0];
    const startHeading = endpointHeading(lane.lane, true);
    const sameDirection =
      startHeading !== null &&
      Math.cos(
        angleDifference(startHeading, currentRoadOracle.heading),
      ) >= alignmentMinimum;
    const startLongitudinal =
      (start.x - player.x) * Math.sin(currentRoadOracle.heading) +
      (start.z - player.z) * Math.cos(currentRoadOracle.heading);
    const unsafeSameDirectionLaneStart =
      sameDirection && startLongitudinal < -1e-9;
    forwardSeeds.push({
      laneIndex,
      ...forwardInterval,
      ...(unsafeSameDirectionLaneStart
        ? {
            minimumDirectOriginDistance: forwardInterval.entryDistance,
            allowPredecessorEntry: false,
          }
        : {}),
    });
  }
  const currentTable = buildIndependentGoalTable(
    lanes,
    laneIndexById,
    currentSeeds,
  );
  const forwardTable = buildIndependentGoalTable(
    lanes,
    laneIndexById,
    forwardSeeds,
  );
  const currentTargetMarks = new Uint8Array(lanes.length);
  const forwardTargetMarks = new Uint8Array(lanes.length);
  const capacityLaneIds = new Set(config.trafficCapacityLaneIds ?? []);
  for (const portal of config.runtimeTrafficPortals ?? []) {
    const laneIndex = laneIndexById.get(portal.laneId);
    if (laneIndex === undefined || !capacityLaneIds.has(portal.laneId)) {
      continue;
    }
    const portalDistanceM = Math.min(
      lanes[laneIndex].lengthM,
      Math.max(0, portal.distance),
    );
    // Runtime normalizes every authored portal back onto its lane before the
    // spatial annulus query; repeat that public-geometry operation rather than
    // trusting an optional/stale authored x/z cache.
    const portalPose = pointOnLane(lanes[laneIndex].lane, portalDistanceM);
    const radialM = distance(portalPose, player);
    if (
      radialM < ACCEPTANCE_APPROACH_MIN_M ||
      radialM > ACCEPTANCE_APPROACH_MAX_M
    ) {
      continue;
    }
    for (
      let hopBudget = 0;
      hopBudget <= ACCEPTANCE_ROUTE_MAX_HOPS;
      hopBudget += 1
    ) {
      const current = independentGoalTravelTimeSeconds(
        lanes,
        currentTable,
        laneIndex,
        portalDistanceM,
        hopBudget,
      );
      if (
        current &&
        current.seconds <= ACCEPTANCE_STREAMABLE_FEED_ETA_SECONDS
      ) {
        currentTargetMarks[current.targetLaneIndex] = 1;
      }
      const forward = independentGoalTravelTimeSeconds(
        lanes,
        forwardTable,
        laneIndex,
        portalDistanceM,
        hopBudget,
      );
      if (
        forward &&
        forward.seconds <= ACCEPTANCE_STREAMABLE_FEED_ETA_SECONDS
      ) {
        forwardTargetMarks[forward.targetLaneIndex] = 1;
      }
    }
  }
  const laneCap = BUSTLING_CALIBRATION[device].laneCap;
  const corridorCap = BUSTLING_CALIBRATION[device].corridorCap;
  const countSlots = (
    marks: Uint8Array,
    table: IndependentGoalTable,
  ): number => {
    let slots = 0;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (
        marks[laneIndex] !== 1 ||
        !capacityLaneIds.has(lanes[laneIndex].lane.id)
      ) {
        continue;
      }
      slots += Math.min(
        laneCap,
        Math.floor(
          Math.max(
            0,
            table.targetExitDistance[laneIndex] -
              table.targetEntryDistance[laneIndex],
          ) / ACCEPTANCE_CORRIDOR_SAFE_SPACING_M,
        ),
      );
    }
    return Math.min(corridorCap, slots);
  };
  return {
    currentRoad: countSlots(currentTargetMarks, currentTable),
    forwardRoad: countSlots(forwardTargetMarks, forwardTable),
  };
}

function pointToSegmentDistanceSquared(
  point: SimulationPoint,
  start: SimulationPoint,
  end: SimulationPoint,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return (point.x - start.x) ** 2 + (point.z - start.z) ** 2;
  }
  const fraction = Math.min(
    1,
    Math.max(
      0,
      ((point.x - start.x) * dx + (point.z - start.z) * dz) /
        lengthSquared,
    ),
  );
  const closestX = start.x + dx * fraction;
  const closestZ = start.z + dz * fraction;
  return (point.x - closestX) ** 2 + (point.z - closestZ) ** 2;
}

function laneRangeReachesCircle(
  oracleLane: OracleLane,
  fromDistanceM: number,
  toDistanceM: number,
  centre: SimulationPoint,
  radiusM: number,
): boolean {
  let segmentStartDistanceM = 0;
  for (
    let index = 0;
    index < oracleLane.segmentLengthsM.length;
    index += 1
  ) {
    const segmentLengthM = oracleLane.segmentLengthsM[index];
    const segmentEndDistanceM = segmentStartDistanceM + segmentLengthM;
    const overlapStartM = Math.max(fromDistanceM, segmentStartDistanceM);
    const overlapEndM = Math.min(toDistanceM, segmentEndDistanceM);
    if (overlapEndM >= overlapStartM && segmentLengthM > Number.EPSILON) {
      const start = oracleLane.lane.points[index];
      const end = oracleLane.lane.points[index + 1];
      const startFraction =
        (overlapStartM - segmentStartDistanceM) / segmentLengthM;
      const endFraction =
        (overlapEndM - segmentStartDistanceM) / segmentLengthM;
      const clippedStart = {
        x: start.x + (end.x - start.x) * startFraction,
        z: start.z + (end.z - start.z) * startFraction,
      };
      const clippedEnd = {
        x: start.x + (end.x - start.x) * endFraction,
        z: start.z + (end.z - start.z) * endFraction,
      };
      if (
        pointToSegmentDistanceSquared(centre, clippedStart, clippedEnd) <=
        radiusM * radiusM
      ) {
        return true;
      }
    }
    segmentStartDistanceM = segmentEndDistanceM;
    if (segmentStartDistanceM > toDistanceM) break;
  }
  return false;
}

/** Independent bounded graph proof for the plan's "route-connected" clause.
 * Runtime hard feeds may temporarily use a hidden goal-directed next hop, so
 * predicting the legacy modulo successor from a public snapshot is knowingly
 * wrong. This oracle instead proves that some legal endpoint-continuous route
 * reaches the corridor; actual inward velocity is still required separately. */
function routeReachesApproachCorridor(
  laneOracle: ReadonlyMap<string, OracleLane>,
  firstLane: OracleLane,
  firstDistanceM: number,
  centre: SimulationPoint,
): boolean {
  interface RouteState {
    readonly lane: OracleLane;
    readonly fromDistanceM: number;
    readonly travelledM: number;
    readonly hops: number;
  }
  const queue: RouteState[] = [{
    lane: firstLane,
    fromDistanceM: Math.min(firstLane.lengthM, Math.max(0, firstDistanceM)),
    travelledM: 0,
    hops: 0,
  }];
  // Distance and hop budgets are independent constraints. A shorter arrival
  // that used more hops must not suppress a slightly longer arrival that still
  // has enough hops left to reach the corridor, so dominance is tracked per
  // lane and hop count rather than by lane alone.
  const bestTravelledByLaneAndHop = new Map<string, number>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    const remainingM = ACCEPTANCE_ROUTE_LOOKAHEAD_M - state.travelledM;
    if (remainingM < 0) continue;
    const toDistanceM = Math.min(
      state.lane.lengthM,
      state.fromDistanceM + remainingM,
    );
    if (
      laneRangeReachesCircle(
        state.lane,
        state.fromDistanceM,
        toDistanceM,
        centre,
        ACCEPTANCE_APPROACH_CORRIDOR_RADIUS_M,
      )
    ) {
      return true;
    }
    const distanceToEndM = state.lane.lengthM - state.fromDistanceM;
    if (
      state.hops >= ACCEPTANCE_ROUTE_MAX_HOPS ||
      distanceToEndM > remainingM
    ) {
      continue;
    }
    const sourceEnd =
      state.lane.lane.points[state.lane.lane.points.length - 1];
    const successorIds = state.lane.lane.successorLaneIds?.length
      ? state.lane.lane.successorLaneIds
      : state.lane.lane.loop === false
        ? []
        : [state.lane.lane.id];
    const nextTravelledM = state.travelledM + distanceToEndM;
    for (const successorId of successorIds) {
      const successor = laneOracle.get(successorId);
      if (
        !successor ||
        distance(sourceEnd, successor.lane.points[0]) > 0.5
      ) {
        continue;
      }
      const successorHops = state.hops + 1;
      const stateKey = `${successorId}:${successorHops}`;
      const priorTravelledM = bestTravelledByLaneAndHop.get(stateKey);
      if (
        priorTravelledM !== undefined &&
        priorTravelledM <= nextTravelledM
      ) {
        continue;
      }
      bestTravelledByLaneAndHop.set(stateKey, nextTravelledM);
      queue.push({
        lane: successor,
        fromDistanceM: 0,
        travelledM: nextTravelledM,
        hops: successorHops,
      });
    }
  }
  return false;
}

function segmentLengthInsideCircle(
  start: SimulationPoint,
  end: SimulationPoint,
  centre: SimulationPoint,
  radiusM: number,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM <= Number.EPSILON || radiusM <= 0) return 0;
  const ox = start.x - centre.x;
  const oz = start.z - centre.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radiusM * radiusM;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return c <= 0 ? lengthM : 0;
  const root = Math.sqrt(Math.max(0, discriminant));
  const from = Math.max(0, Math.min(1, (-b - root) / (2 * a)));
  const to = Math.max(0, Math.min(1, (-b + root) / (2 * a)));
  return Math.max(0, to - from) * lengthM;
}

/** Exact arclength in the intersection of a circle and the nonnegative
 * projected-road longitudinal half-plane. This is duplicated test geometry,
 * not a production capacity helper. */
function segmentLengthInsideCircleAndForwardHalfPlane(
  start: SimulationPoint,
  end: SimulationPoint,
  centre: SimulationPoint,
  radiusM: number,
  heading: number,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM <= Number.EPSILON || radiusM <= 0) return 0;
  const ox = start.x - centre.x;
  const oz = start.z - centre.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radiusM * radiusM;
  const discriminant = b * b - 4 * a * c;
  let from = 0;
  let to = 1;
  if (discriminant < 0) {
    if (c > 0) return 0;
  } else {
    const root = Math.sqrt(Math.max(0, discriminant));
    from = Math.max(from, (-b - root) / (2 * a));
    to = Math.min(to, (-b + root) / (2 * a));
  }
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const startLongitudinal = ox * forwardX + oz * forwardZ;
  const longitudinalDelta = dx * forwardX + dz * forwardZ;
  if (Math.abs(longitudinalDelta) <= Number.EPSILON) {
    if (startLongitudinal < 0) return 0;
  } else {
    const boundary = -startLongitudinal / longitudinalDelta;
    if (longitudinalDelta > 0) from = Math.max(from, boundary);
    else to = Math.min(to, boundary);
  }
  from = Math.max(0, Math.min(1, from));
  to = Math.max(0, Math.min(1, to));
  return Math.max(0, to - from) * lengthM;
}

function independentLaneLengthWithinCircle(
  lanes: readonly SimulationLane[],
  capacityLaneIds: ReadonlySet<string>,
  centre: SimulationPoint,
  radiusM: number,
): number {
  let result = 0;
  for (const lane of lanes) {
    if (!capacityLaneIds.has(lane.id)) continue;
    for (let index = 1; index < lane.points.length; index += 1) {
      result += segmentLengthInsideCircle(
        lane.points[index - 1],
        lane.points[index],
        centre,
        radiusM,
      );
    }
  }
  return result;
}

function completeAnchor(
  kind: AnchorKind,
  config: SimulationCoreConfig,
  capacityLaneIds: ReadonlySet<string>,
  projection: LaneProjection,
): TrafficAnchor {
  const centre = { x: projection.x, z: projection.z };
  return {
    kind,
    laneId: projection.laneId,
    distanceAlongM: projection.distanceAlongM,
    x: projection.x,
    z: projection.z,
    heading: projection.heading,
    laneLengthWithinFogM: independentLaneLengthWithinCircle(
      config.lanes ?? [],
      capacityLaneIds,
      centre,
      ACCEPTANCE_FOG_RADIUS_M,
    ),
    laneLengthWithinInnerM: independentLaneLengthWithinCircle(
      config.lanes ?? [],
      capacityLaneIds,
      centre,
      ACCEPTANCE_INNER_RADIUS_M,
    ),
  };
}

function representativeAnchors(
  mapPack: MapPack,
  config: SimulationCoreConfig,
): readonly TrafficAnchor[] {
  const lanes = config.lanes ?? [];
  const capacityLaneIds = new Set(config.trafficCapacityLaneIds ?? []);
  const authoredSpawn = config.spawn;
  if (!authoredSpawn || capacityLaneIds.size === 0) {
    throw new Error(`${mapPack.id} lacks a production spawn or traffic-capacity lanes`);
  }

  const authoredProjection = lanes
    .filter((lane) => capacityLaneIds.has(lane.id))
    .flatMap((lane) => {
      const projection = projectToLane(lane, authoredSpawn);
      if (!projection) return [];
      return [{
        projection,
        score:
          projection.separationM +
          Math.abs(angleDifference(projection.heading, authoredSpawn.heading)) *
            0.25,
      }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.projection.laneId.localeCompare(right.projection.laneId),
    )[0]?.projection;
  if (!authoredProjection) {
    throw new Error(`${mapPack.id} authored start cannot project to a capacity lane`);
  }
  const authored = completeAnchor(
    "authored",
    config,
    capacityLaneIds,
    {
      ...authoredProjection,
      x: authoredSpawn.x,
      z: authoredSpawn.z,
      heading: authoredSpawn.heading,
    },
  );

  const sampled: TrafficAnchor[] = [];
  for (const lane of lanes) {
    if (!capacityLaneIds.has(lane.id) || lane.points.length < 2) continue;
    const lengthM = laneLength(lane);
    const firstDistanceM = Math.min(
      ANCHOR_ENDPOINT_INSET_M,
      lengthM / 2,
    );
    const lastDistanceM = Math.max(firstDistanceM, lengthM - ANCHOR_ENDPOINT_INSET_M);
    for (
      let distanceAlongM = firstDistanceM;
      distanceAlongM <= lastDistanceM + 1e-6;
      distanceAlongM += ANCHOR_SAMPLE_INTERVAL_M
    ) {
      const pose = pointOnLane(lane, distanceAlongM);
      sampled.push(
        completeAnchor(
          "median",
          config,
          capacityLaneIds,
          {
            laneId: lane.id,
            distanceAlongM,
            separationM: 0,
            heading: pose.heading,
            x: pose.x,
            z: pose.z,
          },
        ),
      );
    }
  }
  if (sampled.length < 10) {
    throw new Error(`${mapPack.id} has only ${sampled.length} representative traffic anchors`);
  }
  sampled.sort(
    (left, right) =>
      left.laneLengthWithinFogM - right.laneLengthWithinFogM ||
      left.laneId.localeCompare(right.laneId) ||
      left.distanceAlongM - right.distanceAlongM,
  );
  const committed = COMMITTED_REPRESENTATIVE_ANCHORS[mapPack.id];
  if (!committed) {
    throw new Error(`${mapPack.id} lacks committed representative anchors`);
  }
  const committedAnchor = (
    quantile: number,
    kind: Exclude<AnchorKind, "authored">,
  ): TrafficAnchor => {
    const definition = committed[kind];
    const selectedIndex = sampled.findIndex(
      (candidate) =>
        candidate.laneId === definition.laneId &&
        Math.abs(candidate.distanceAlongM - definition.distanceAlongM) <= 1e-6,
    );
    const expectedIndex = Math.round((sampled.length - 1) * quantile);
    if (selectedIndex < 0) {
      throw new Error(
        `${mapPack.id}/${kind} committed lane anchor no longer exists`,
      );
    }
    if (Math.abs(selectedIndex - expectedIndex) > 1) {
      const expected = sampled[expectedIndex];
      throw new Error(
        `${mapPack.id}/${kind} committed anchor rank ${selectedIndex}/${sampled.length} drifted from quantile index ${expectedIndex}; current quantile is ${expected.laneId}@${expected.distanceAlongM} with ${(expected.laneLengthWithinFogM / 1_000).toFixed(9)}/${(expected.laneLengthWithinInnerM / 1_000).toFixed(9)} lane-km`,
      );
    }
    const selected = sampled[selectedIndex];
    if (
      Math.abs(
        selected.laneLengthWithinFogM / 1_000 -
          definition.expectedFogLaneKm,
      ) > 0.001 ||
      Math.abs(
        selected.laneLengthWithinInnerM / 1_000 -
          definition.expectedInnerLaneKm,
      ) > 0.001
    ) {
      throw new Error(
        `${mapPack.id}/${kind} committed lane-km drifted from ${definition.expectedFogLaneKm.toFixed(9)}/${definition.expectedInnerLaneKm.toFixed(9)} to ${(selected.laneLengthWithinFogM / 1_000).toFixed(9)}/${(selected.laneLengthWithinInnerM / 1_000).toFixed(9)}`,
      );
    }
    return { ...selected, kind };
  };
  return [
    authored,
    committedAnchor(0.1, "sparse"),
    committedAnchor(0.5, "median"),
    committedAnchor(0.9, "dense"),
  ];
}

function percentile(
  values: readonly number[],
  requestedPercentile: number,
): number {
  if (values.length === 0) throw new Error("Cannot summarize an empty sample");
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * requestedPercentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function summarize(values: readonly number[]): DistributionSummary {
  return {
    p10: percentile(values, 0.1),
    p50: percentile(values, 0.5),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    p90: percentile(values, 0.9),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

function maximumZeroRun(values: readonly number[]): number {
  let current = 0;
  let maximum = 0;
  for (const value of values) {
    if (value === 0) {
      current += 1;
      maximum = Math.max(maximum, current);
    } else {
      current = 0;
    }
  }
  return maximum;
}

function maximumBelowFloorRun(
  values: readonly number[],
  floor: number,
): number {
  return maximumZeroRun(values.map((value) => (value < floor ? 0 : 1)));
}

function snapshotCounts(
  snapshot: SimulationSnapshot,
  trafficSeed: number,
  laneOracle: ReadonlyMap<string, OracleLane>,
  currentRoadOracle: IndependentCurrentRoadOracle,
  nearViewRadiusM: number,
): Pick<
  PerceptualSample,
  | "withinFog"
  | "withinInner"
  | "movingWithinInner"
  | "currentRoad"
  | "forwardRoad"
  | "movingCurrentRoad"
  | "movingForwardRoad"
  | "movingOffCurrentFallback"
  | "conservedCurrentPresence"
  | "conservedForwardPresence"
  | "lowSpeedCurrentRoad"
  | "nearView"
  | "independentSectorForward"
  | "independentSectorRight"
  | "independentSectorRear"
  | "independentSectorLeft"
  | "maximumLaneOccupancy"
  | "maximumStoppedLaneQueue"
  | "aheadOrApproaching"
  | "patrolWithinFog"
  | "patrolWithinInner"
  | "duplicateNpcIdentityCount"
> {
  let withinFog = 0;
  let withinInner = 0;
  let movingWithinInner = 0;
  let nearView = 0;
  let independentSectorForward = 0;
  let independentSectorRight = 0;
  let independentSectorRear = 0;
  let independentSectorLeft = 0;
  let aheadOrApproaching = 0;
  let patrolWithinFog = 0;
  let patrolWithinInner = 0;
  const laneOccupancy = new Map<string, number>();
  const stoppedLaneQueue = new Map<string, number>();
  const seenNpcIds = new Set<string>();
  const currentRoadIds = new Set<string>();
  const forwardRoadIds = new Set<string>();
  const movingCurrentRoadIds = new Set<string>();
  const movingForwardRoadIds = new Set<string>();
  const lowSpeedCurrentRoadIds = new Set<string>();
  const movingOffCurrentFallbackIds = new Set<string>();
  let duplicateNpcIdentityCount = 0;
  for (const npc of snapshot.npcs) {
    if (seenNpcIds.has(npc.id)) duplicateNpcIdentityCount += 1;
    else seenNpcIds.add(npc.id);
    const dx = npc.x - snapshot.player.x;
    const dz = npc.z - snapshot.player.z;
    const separationM = Math.hypot(dx, dz);
    if (separationM > ACCEPTANCE_FOG_RADIUS_M) continue;
    withinFog += 1;
    laneOccupancy.set(npc.laneId, (laneOccupancy.get(npc.laneId) ?? 0) + 1);
    if (npc.speedMps < MOVING_SPEED_MPS) {
      stoppedLaneQueue.set(
        npc.laneId,
        (stoppedLaneQueue.get(npc.laneId) ?? 0) + 1,
      );
    }
    const patrol = isTrafficNpcPatrol({
      vehicleId: npc.id,
      trafficSeed,
      variant: npc.variant,
    });
    if (patrol) patrolWithinFog += 1;
    const relativeBearing = Math.abs(
      angleDifference(Math.atan2(dx, dz), snapshot.player.heading),
    );
    if (
      separationM <= nearViewRadiusM &&
      relativeBearing <= AHEAD_HALF_ANGLE_RAD
    ) {
      nearView += 1;
    }
    const sectorLongitudinal =
      dx * Math.sin(snapshot.player.heading) +
      dz * Math.cos(snapshot.player.heading);
    const sectorLateral =
      dx * Math.cos(snapshot.player.heading) -
      dz * Math.sin(snapshot.player.heading);
    if (Math.abs(sectorLongitudinal) >= Math.abs(sectorLateral)) {
      if (sectorLongitudinal >= 0) independentSectorForward += 1;
      else independentSectorRear += 1;
    } else if (sectorLateral >= 0) {
      independentSectorRight += 1;
    } else {
      independentSectorLeft += 1;
    }
    const npcLane = laneOracle.get(npc.laneId);
    const onCurrentRoad =
      npcLane !== undefined &&
      currentRoadOracle.corridorLaneIds.has(npcLane.lane.id);
    if (npcLane) {
      if (onCurrentRoad) {
        currentRoadIds.add(npc.id);
        const moving = npc.speedMps >= MOVING_SPEED_MPS;
        if (moving) movingCurrentRoadIds.add(npc.id);
        else lowSpeedCurrentRoadIds.add(npc.id);
        const longitudinal =
          dx * Math.sin(currentRoadOracle.heading) +
          dz * Math.cos(currentRoadOracle.heading);
        if (longitudinal >= 0) {
          forwardRoadIds.add(npc.id);
          if (moving) movingForwardRoadIds.add(npc.id);
        }
      }
    }
    if (separationM > ACCEPTANCE_INNER_RADIUS_M) continue;
    withinInner += 1;
    if (patrol) patrolWithinInner += 1;
    if (npc.speedMps >= MOVING_SPEED_MPS) {
      movingWithinInner += 1;
      // Compensation is deliberately disjoint from the current corridor and
      // only credits visibly moving inner traffic. One NPC contributes at
      // most once even when it is also near/ahead/approaching, and the same
      // nested set backs both current and forward conservation inequalities.
      if (!onCurrentRoad) movingOffCurrentFallbackIds.add(npc.id);
    }
    const ahead = relativeBearing <= AHEAD_HALF_ANGLE_RAD;
    if (ahead) {
      aheadOrApproaching += 1;
      continue;
    }
    if (npc.speedMps < MOVING_SPEED_MPS || separationM <= Number.EPSILON) {
      continue;
    }
    const oracleLane = npcLane;
    if (!oracleLane) continue;
    const projection = projectToLane(oracleLane.lane, npc);
    if (!projection) continue;
    const crossTangent =
      Math.abs(
        Math.cos(
          angleDifference(projection.heading, snapshot.player.heading),
        ),
      ) < Math.cos(CROSS_TRAFFIC_TANGENT_MINIMUM_ANGLE_RAD);
    // The projected tangent establishes that this is cross traffic; actual
    // pose velocity establishes whether the rendered car is physically moving
    // inward. Keeping those proofs separate prevents a car traversing a corner
    // or lane change from being counted while it visibly moves away.
    const inwardCosine =
      (Math.sin(npc.heading) * -dx + Math.cos(npc.heading) * -dz) /
      separationM;
    if (
      crossTangent &&
      inwardCosine > 0 &&
      routeReachesApproachCorridor(
        laneOracle,
        oracleLane,
        projection.distanceAlongM,
        snapshot.player,
      )
    ) {
      aheadOrApproaching += 1;
    }
  }
  // A malformed duplicate row cannot simultaneously represent one identity
  // on the current corridor and in its disjoint fallback set.
  for (const id of currentRoadIds) movingOffCurrentFallbackIds.delete(id);
  const currentRoad = currentRoadIds.size;
  const forwardRoad = forwardRoadIds.size;
  const movingOffCurrentFallback = movingOffCurrentFallbackIds.size;
  return {
    withinFog,
    withinInner,
    movingWithinInner,
    currentRoad,
    forwardRoad,
    movingCurrentRoad: movingCurrentRoadIds.size,
    movingForwardRoad: movingForwardRoadIds.size,
    movingOffCurrentFallback,
    conservedCurrentPresence: currentRoad + movingOffCurrentFallback,
    conservedForwardPresence: forwardRoad + movingOffCurrentFallback,
    lowSpeedCurrentRoad: lowSpeedCurrentRoadIds.size,
    nearView,
    independentSectorForward,
    independentSectorRight,
    independentSectorRear,
    independentSectorLeft,
    maximumLaneOccupancy: Math.max(0, ...laneOccupancy.values()),
    maximumStoppedLaneQueue: Math.max(0, ...stoppedLaneQueue.values()),
    aheadOrApproaching,
    patrolWithinFog,
    patrolWithinInner,
    duplicateNpcIdentityCount,
  };
}

function runPerceptualCase(
  mapPack: MapPack,
  baseConfig: SimulationCoreConfig,
  device: DeviceClass,
  anchor: TrafficAnchor,
): { readonly report: PerceptualReport; readonly failures: readonly string[] } {
  const config: SimulationCoreConfig = {
    ...baseConfig,
    spawn: { x: anchor.x, z: anchor.z, heading: anchor.heading },
  };
  const laneOracle = buildLaneOracle(config.lanes ?? []);
  const currentRoadOracle = buildIndependentCurrentRoadOracle(
    laneOracle,
    config.spawn!,
    new Set(config.trafficCapacityLaneIds ?? []),
  );
  const streamableCapacity = resolveIndependentStreamableCorridorCapacity(
    config,
    laneOracle,
    currentRoadOracle,
    device,
  );
  const simulation = new SimulationCore(config);
  const failures: string[] = [];
  const samples: PerceptualSample[] = [];
  const oracleSamples: ReturnType<typeof snapshotCounts>[] = [];
  const startedAt = performance.now();
  const label = `${mapPack.id}/${device}/${anchor.kind}`;
  const productionConstantPairs = [
    ["stream ETA seconds", LOCAL_TRAFFIC_STREAMABLE_FEED_ETA_SECONDS, ACCEPTANCE_STREAMABLE_FEED_ETA_SECONDS],
    ["stream speed factor", LOCAL_TRAFFIC_STREAMABLE_DRIVER_SPEED_FACTOR, ACCEPTANCE_STREAMABLE_DRIVER_SPEED_FACTOR],
    ["stream startup seconds", LOCAL_TRAFFIC_STREAMABLE_STARTUP_SECONDS, ACCEPTANCE_STREAMABLE_STARTUP_SECONDS],
    ["approach minimum", RUNTIME_TRAFFIC_APPROACH_MIN_M, ACCEPTANCE_APPROACH_MIN_M],
    ["approach maximum", RUNTIME_TRAFFIC_APPROACH_MAX_M, ACCEPTANCE_APPROACH_MAX_M],
  ] as const;
  for (const [name, actual, expected] of productionConstantPairs) {
    if (actual !== expected) {
      failures.push(`production ${name} ${actual} != frozen ${expected}`);
    }
  }
  const expectedTargets = resolveLocalTrafficTargets(
    anchor.laneLengthWithinFogM,
    anchor.laneLengthWithinInnerM,
    device === "touch",
  );
  const initialLocality = simulation.getTrafficDiagnostics().locality;
  const expectedTopologyTargets = resolveTopologyAwareLocalTrafficTargets(
    initialLocality.poolCount,
    expectedTargets,
    device === "touch",
    currentRoadOracle.laneLengthWithinFogM,
    currentRoadOracle.forwardLaneLengthWithinFogM,
    streamableCapacity.currentRoad,
    streamableCapacity.forwardRoad,
  );
  const expectedPerceptualTargets = expectedTopologyTargets.perceptual;
  const bustlingTargets = resolveBustlingAcceptanceTargets(
    anchor.laneLengthWithinFogM,
    anchor.laneLengthWithinInnerM,
    currentRoadOracle.laneLengthWithinFogM,
    currentRoadOracle.forwardLaneLengthWithinFogM,
    initialLocality.poolCount,
    device,
    streamableCapacity.currentRoad,
    streamableCapacity.forwardRoad,
  );
  if (
    expectedTopologyTargets.population.withinFog !==
      bustlingTargets.withinFog ||
    expectedTopologyTargets.population.withinInner !==
      bustlingTargets.withinInner
  ) {
    failures.push(
      `production topology-aware radial resolver ${expectedTopologyTargets.population.withinFog}/${expectedTopologyTargets.population.withinInner} != independently frozen compensated target ${bustlingTargets.withinFog}/${bustlingTargets.withinInner}`,
    );
  }
  if (
    initialLocality.streamableCurrentRoadCapacity !==
      streamableCapacity.currentRoad ||
    initialLocality.streamableForwardCorridorCapacity !==
      streamableCapacity.forwardRoad ||
    initialLocality.targetCorridorContinuityCompensation !==
      bustlingTargets.corridorShortfall
  ) {
    failures.push(
      `production streamable capacities/compensation ${initialLocality.streamableCurrentRoadCapacity}/${initialLocality.streamableForwardCorridorCapacity}/${initialLocality.targetCorridorContinuityCompensation} != independent immutable ETA ${streamableCapacity.currentRoad}/${streamableCapacity.forwardRoad}/${bustlingTargets.corridorShortfall}`,
    );
  }
  const topologyPerceptualPairs = [
    ["moving-inner", expectedPerceptualTargets.movingWithinInner, bustlingTargets.movingWithinInner],
    ["current-road", expectedPerceptualTargets.currentRoadCorridor, bustlingTargets.currentRoad],
    ["forward-road", expectedPerceptualTargets.forwardCorridor, bustlingTargets.forwardRoad],
    ["ahead-or-approaching", expectedPerceptualTargets.aheadOrApproaching, bustlingTargets.aheadOrApproaching],
  ] as const;
  for (const [name, actual, expected] of topologyPerceptualPairs) {
    if (actual !== expected) {
      failures.push(
        `production topology-aware ${name} target ${actual} != independently frozen target ${expected}`,
      );
    }
  }
  if (
    expectedTopologyTargets.currentRoadCapacity !==
      bustlingTargets.currentRoadCapacity ||
    expectedTopologyTargets.forwardCorridorCapacity !==
      bustlingTargets.forwardRoadCapacity ||
    expectedTopologyTargets.corridorShortfall !==
      bustlingTargets.corridorShortfall
  ) {
    failures.push(
      `production topology capacities ${expectedTopologyTargets.currentRoadCapacity}/${expectedTopologyTargets.forwardCorridorCapacity}/${expectedTopologyTargets.corridorShortfall} != independent ${bustlingTargets.currentRoadCapacity}/${bustlingTargets.forwardRoadCapacity}/${bustlingTargets.corridorShortfall}`,
    );
  }
  const expectedPoolCount = BUSTLING_CALIBRATION[device].poolCount;
  if (
    config.npcCount !== expectedPoolCount ||
    initialLocality.poolCount !== expectedPoolCount
  ) {
    failures.push(
      `configured/initial pool ${String(config.npcCount)}/${initialLocality.poolCount} != frozen ${expectedPoolCount}`,
    );
  }
  if (!initialLocality.enabled) failures.push("locality is disabled");
  if (initialLocality.targetWithinFog !== expectedTargets.withinFog) {
    failures.push(
      `initial fog target ${initialLocality.targetWithinFog} != computed ${expectedTargets.withinFog}`,
    );
  }
  if (initialLocality.targetWithinInner !== bustlingTargets.withinInner) {
    failures.push(
      `initial inner target ${initialLocality.targetWithinInner} != independently compensated ${bustlingTargets.withinInner}`,
    );
  }
  const initialPerceptualTargetPairs = [
    ["moving-inner", initialLocality.targetMovingWithinInner, bustlingTargets.movingWithinInner],
    ["current-corridor", initialLocality.targetCurrentRoadCorridor, bustlingTargets.currentRoad],
    ["forward-corridor", initialLocality.targetForwardCorridor, bustlingTargets.forwardRoad],
    ["ahead-or-approaching", initialLocality.targetAheadOrApproaching, bustlingTargets.aheadOrApproaching],
    ["near-view", initialLocality.targetNearView, bustlingTargets.nearView],
    ["circulating-approach", initialLocality.targetCirculatingApproach, expectedPerceptualTargets.circulatingApproach],
  ] as const;
  for (const [name, actual, expected] of initialPerceptualTargetPairs) {
    if (actual !== expected) {
      failures.push(`initial ${name} target ${actual} != computed ${expected}`);
    }
  }
  const expectedPatrolFogCap = device === "touch" ? 1 : 2;
  const expectedPatrolInnerCap = 1;
  if (initialLocality.patrolFogCap !== expectedPatrolFogCap) {
    failures.push(
      `patrol fog cap ${initialLocality.patrolFogCap} != controlled ${expectedPatrolFogCap}`,
    );
  }
  if (initialLocality.patrolInnerCap !== expectedPatrolInnerCap) {
    failures.push(
      `patrol inner cap ${initialLocality.patrolInnerCap} != controlled ${expectedPatrolInnerCap}`,
    );
  }

  let poolConservationFailures = 0;
  let identityInvariantFailures = 0;
  let diagnosticInvariantFailures = 0;
  let targetDriftFailures = 0;
  let maximumPortalAttempts = 0;
  let maximumActivations = 0;
  let maximumRetirements = 0;
  let maximumRadialDiagnosticDelta = 0;
  let maximumPatrolDiagnosticDelta = 0;
  let maximumSectorDiagnosticDelta = 0;
  let maximumGhostDecisionCount = 0;
  let currentIndependentGhostSamples = 0;
  let maximumIndependentGhostSamples = 0;
  let currentDiagnosticCorridorGhostSamples = 0;
  let maximumDiagnosticCorridorGhostSamples = 0;
  let diagnosticCorridorOccupiedOracleSamples = 0;
  let maximumQueuedCount = 0;
  let maximumPendingRecycleCount = 0;
  let ghostDecisionCountCarriedFromWarmup: number | null = null;
  type LifecycleCheckpoint = {
    readonly activations: number;
    readonly retirements: number;
    readonly active: number;
    readonly queued: number;
  };
  let gradedLifecycleStart: LifecycleCheckpoint | null = null;
  let gradedLifecycleEnd: LifecycleCheckpoint | null = null;
  const identityVariants = new Map<string, string>();
  try {
    for (let tick = 0; tick < WARMUP_TICKS + SAMPLE_TICKS; tick += 1) {
      const snapshot = simulation.step(FIXED_STEP_SECONDS, {
        throttle: 0,
        brake: 0,
        reverse: 0,
        steer: 0,
        viewHeading: anchor.heading,
      });
      if (tick + 1 === WARMUP_TICKS) {
        const locality = simulation.getTrafficDiagnostics().locality;
        gradedLifecycleStart = {
          activations: locality.activations,
          retirements: locality.retirements,
          active: locality.activeCount,
          queued: locality.queuedCount,
        };
      }
      if (tick + 1 <= WARMUP_TICKS) continue;
      const locality = simulation.getTrafficDiagnostics().locality;
      gradedLifecycleEnd = {
        activations: locality.activations,
        retirements: locality.retirements,
        active: locality.activeCount,
        queued: locality.queuedCount,
      };
      maximumQueuedCount = Math.max(
        maximumQueuedCount,
        locality.queuedCount,
      );
      maximumPendingRecycleCount = Math.max(
        maximumPendingRecycleCount,
        locality.pendingRecycleCount,
      );
      if (
        locality.poolCount !== expectedPoolCount ||
        locality.activeCount + locality.queuedCount !== locality.poolCount ||
        snapshot.npcs.length + snapshot.queuedNpcCount !== locality.poolCount ||
        locality.activeCount !== snapshot.npcs.length ||
        locality.queuedCount !== snapshot.queuedNpcCount
      ) {
        poolConservationFailures += 1;
      }
      if (ghostDecisionCountCarriedFromWarmup === null) {
        ghostDecisionCountCarriedFromWarmup = locality.ghostGap
          ? locality.ghostGapDecisionCount
          : 0;
      }
      const measuredGhostDecisionCount = locality.ghostGap
        ? Math.max(
            0,
            locality.ghostGapDecisionCount -
              ghostDecisionCountCarriedFromWarmup,
          )
        : 0;
      maximumGhostDecisionCount = Math.max(
        maximumGhostDecisionCount,
        measuredGhostDecisionCount,
      );
      if (!locality.ghostGap) ghostDecisionCountCarriedFromWarmup = 0;
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
      const measuredTick = tick + 1 - WARMUP_TICKS;
      let counts: ReturnType<typeof snapshotCounts> | null = null;
      if (measuredTick % TICKS_PER_ORACLE_SAMPLE === 0) {
        counts = snapshotCounts(
          snapshot,
          config.seed ?? 0,
          laneOracle,
          currentRoadOracle,
          BUSTLING_CALIBRATION[device].nearViewRadiusM,
        );
        oracleSamples.push(counts);
        identityInvariantFailures += counts.duplicateNpcIdentityCount;
        currentIndependentGhostSamples =
          counts.aheadOrApproaching === 0
            ? currentIndependentGhostSamples + 1
            : 0;
        maximumIndependentGhostSamples = Math.max(
          maximumIndependentGhostSamples,
          currentIndependentGhostSamples,
        );
        currentDiagnosticCorridorGhostSamples =
          locality.currentRoadCorridorCount === 0
            ? currentDiagnosticCorridorGhostSamples + 1
            : 0;
        maximumDiagnosticCorridorGhostSamples = Math.max(
          maximumDiagnosticCorridorGhostSamples,
          currentDiagnosticCorridorGhostSamples,
        );
        if (locality.currentRoadCorridorCount > 0) {
          diagnosticCorridorOccupiedOracleSamples += 1;
        }
      }
      if (measuredTick % TICKS_PER_SECOND !== 0) continue;

      counts ??= snapshotCounts(
        snapshot,
        config.seed ?? 0,
        laneOracle,
        currentRoadOracle,
        BUSTLING_CALIBRATION[device].nearViewRadiusM,
      );
      for (const npc of snapshot.npcs) {
        const priorVariant = identityVariants.get(npc.id);
        if (priorVariant !== undefined && priorVariant !== npc.variant) {
          identityInvariantFailures += 1;
        }
        identityVariants.set(npc.id, npc.variant);
      }
      if (
        locality.targetWithinFog !== bustlingTargets.withinFog ||
        locality.targetWithinInner !== bustlingTargets.withinInner ||
        locality.targetMovingWithinInner !== bustlingTargets.movingWithinInner ||
        locality.targetCurrentRoadCorridor !== bustlingTargets.currentRoad ||
        locality.targetForwardCorridor !== bustlingTargets.forwardRoad ||
        locality.targetAheadOrApproaching !== bustlingTargets.aheadOrApproaching ||
        locality.targetNearView !== bustlingTargets.nearView ||
        locality.targetCorridorContinuityCompensation !== bustlingTargets.corridorShortfall ||
        locality.streamableCurrentRoadCapacity !== streamableCapacity.currentRoad ||
        locality.streamableForwardCorridorCapacity !== streamableCapacity.forwardRoad ||
        locality.targetCirculatingApproach !== expectedPerceptualTargets.circulatingApproach ||
        locality.patrolFogCap !== expectedPatrolFogCap ||
        locality.patrolInnerCap !== expectedPatrolInnerCap
      ) {
        targetDriftFailures += 1;
      }
      const sectorTotal =
        locality.sectorForwardCount +
        locality.sectorRightCount +
        locality.sectorRearCount +
        locality.sectorLeftCount;
      maximumSectorDiagnosticDelta = Math.max(
        maximumSectorDiagnosticDelta,
        Math.abs(sectorTotal - locality.withinFogCount),
      );
      if (
        locality.movingWithinInnerCount > locality.withinInnerCount ||
        locality.nearViewCount > locality.withinInnerCount ||
        locality.movingNearViewCount > locality.nearViewCount ||
        locality.currentRoadCorridorCount > locality.withinFogCount ||
        locality.forwardCorridorCount > locality.currentRoadCorridorCount ||
        locality.approachingCorridorCount > locality.withinInnerCount ||
        locality.aheadOrApproachingCount < locality.approachingCorridorCount ||
        locality.aheadOrApproachingCount > locality.withinInnerCount ||
        locality.ghostGap !== (locality.aheadOrApproachingCount === 0) ||
        (!locality.ghostGap && locality.ghostGapDecisionCount !== 0)
      ) {
        diagnosticInvariantFailures += 1;
      }
      // Locality diagnostics are refreshed on the 10 Hz decision before the
      // remaining fixed-step movement. The public snapshot is post-movement,
      // so a boundary crossing can differ by one or two cars without either
      // source being wrong. Record and bound that cadence delta rather than
      // demanding impossible same-phase equality.
      maximumRadialDiagnosticDelta = Math.max(
        maximumRadialDiagnosticDelta,
        Math.abs(locality.withinFogCount - counts.withinFog),
        Math.abs(locality.withinInnerCount - counts.withinInner),
      );
      maximumPatrolDiagnosticDelta = Math.max(
        maximumPatrolDiagnosticDelta,
        Math.abs(locality.patrolWithinFogCount - counts.patrolWithinFog),
        Math.abs(locality.patrolWithinInnerCount - counts.patrolWithinInner),
      );
      samples.push({
        ...counts,
        diagnosticMovingWithinInner: locality.movingWithinInnerCount,
        currentCorridor: locality.currentRoadCorridorCount,
        forwardCorridor: locality.forwardCorridorCount,
        approachingCorridor: locality.approachingCorridorCount,
        diagnosticAheadOrApproaching: locality.aheadOrApproachingCount,
        sectorForward: locality.sectorForwardCount,
        sectorRight: locality.sectorRightCount,
        sectorRear: locality.sectorRearCount,
        sectorLeft: locality.sectorLeftCount,
        active: locality.activeCount,
        queued: locality.queuedCount,
        pendingRecycle: locality.pendingRecycleCount,
        approach: locality.approachCount,
        inboundTransit: locality.inboundTransitCount,
      });
    }
  } finally {
    simulation.dispose();
  }

  const gradedLifecycle = (() => {
    const maximumEach =
      expectedPoolCount * MAX_GRADED_LIFECYCLE_TURNS_PER_POOL;
    if (!gradedLifecycleStart || !gradedLifecycleEnd) {
      failures.push("missing graded-window lifecycle checkpoints");
      return {
        activationDelta: 0,
        retirementDelta: 0,
        activeDelta: 0,
        queuedDelta: 0,
        maximumEach,
      };
    }
    const activationDelta =
      gradedLifecycleEnd.activations - gradedLifecycleStart.activations;
    const retirementDelta =
      gradedLifecycleEnd.retirements - gradedLifecycleStart.retirements;
    const activeDelta = gradedLifecycleEnd.active - gradedLifecycleStart.active;
    const queuedDelta = gradedLifecycleEnd.queued - gradedLifecycleStart.queued;
    if (activationDelta < 0 || retirementDelta < 0) {
      failures.push(
        `cumulative lifecycle counters regressed ${activationDelta}/${retirementDelta}`,
      );
    }
    if (activationDelta > maximumEach) {
      failures.push(
        `graded-window activations ${activationDelta} > one-pool churn limit ${maximumEach}`,
      );
    }
    if (retirementDelta > maximumEach) {
      failures.push(
        `graded-window retirements ${retirementDelta} > one-pool churn limit ${maximumEach}`,
      );
    }
    if (
      activationDelta - retirementDelta !== activeDelta ||
      retirementDelta - activationDelta !== queuedDelta
    ) {
      failures.push(
        `lifecycle conservation mismatch activations-retirements ${activationDelta - retirementDelta}, active delta ${activeDelta}, queued delta ${queuedDelta}`,
      );
    }
    return {
      activationDelta,
      retirementDelta,
      activeDelta,
      queuedDelta,
      maximumEach,
    };
  })();

  if (samples.length !== SAMPLE_SECONDS) {
    failures.push(`sample count ${samples.length} != ${SAMPLE_SECONDS}`);
  }
  if (oracleSamples.length !== SAMPLE_SECONDS * ORACLE_SAMPLES_PER_SECOND) {
    failures.push(
      `10 Hz oracle sample count ${oracleSamples.length} != ${SAMPLE_SECONDS * ORACLE_SAMPLES_PER_SECOND}`,
    );
  }
  if (poolConservationFailures > 0) {
    failures.push(
      `pool conservation failed on ${poolConservationFailures} measured fixed ticks`,
    );
  }
  if (identityInvariantFailures > 0) {
    failures.push(
      `active/queued identity invariant failed ${identityInvariantFailures} times`,
    );
  }
  if (diagnosticInvariantFailures > 0) {
    failures.push(
      `perceptual diagnostic invariants failed in ${diagnosticInvariantFailures} samples`,
    );
  }
  if (targetDriftFailures > 0) {
    failures.push(`stationary target drifted in ${targetDriftFailures} samples`);
  }
  if (maximumPortalAttempts > LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET) {
    failures.push(
      `portal attempts ${maximumPortalAttempts} > ${LOCAL_TRAFFIC_PORTAL_ATTEMPT_BUDGET}`,
    );
  }
  if (maximumActivations > LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET) {
    failures.push(
      `decision activations ${maximumActivations} > ${LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET}`,
    );
  }
  if (maximumRetirements > LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET) {
    failures.push(
      `decision retirements ${maximumRetirements} > ${LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET}`,
    );
  }
  if (
    maximumRadialDiagnosticDelta >
    LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET +
      LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET
  ) {
    failures.push(
      `radial diagnostic cadence delta ${maximumRadialDiagnosticDelta} exceeds one bounded lifecycle batch`,
    );
  }
  if (
    maximumPatrolDiagnosticDelta >
    LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET +
      LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET
  ) {
    failures.push(
      `patrol diagnostic cadence delta ${maximumPatrolDiagnosticDelta} exceeds one bounded lifecycle batch`,
    );
  }
  if (maximumSectorDiagnosticDelta > 0) {
    failures.push(
      `road-relative sectors differ from diagnostic fog population by ${maximumSectorDiagnosticDelta}`,
    );
  }

  const values = <Key extends keyof PerceptualSample>(key: Key): number[] =>
    samples.map((sample) => sample[key]);
  type OracleSample = ReturnType<typeof snapshotCounts>;
  const oracleValues = <Key extends keyof OracleSample>(key: Key): number[] =>
    oracleSamples.map((sample) => sample[key]);
  const fog = summarize(oracleValues("withinFog"));
  const inner = summarize(oracleValues("withinInner"));
  const movingInner = summarize(oracleValues("movingWithinInner"));
  const diagnosticMovingInner = summarize(
    values("diagnosticMovingWithinInner"),
  );
  const currentRoad = summarize(oracleValues("currentRoad"));
  const forwardRoad = summarize(oracleValues("forwardRoad"));
  const movingCurrentRoad = summarize(oracleValues("movingCurrentRoad"));
  const movingForwardRoad = summarize(oracleValues("movingForwardRoad"));
  const movingOffCurrentFallback = summarize(
    oracleValues("movingOffCurrentFallback"),
  );
  const conservedCurrentPresence = summarize(
    oracleValues("conservedCurrentPresence"),
  );
  const conservedForwardPresence = summarize(
    oracleValues("conservedForwardPresence"),
  );
  const lowSpeedCurrentRoad = summarize(oracleValues("lowSpeedCurrentRoad"));
  const nearView = summarize(oracleValues("nearView"));
  const forwardCorridor = summarize(values("forwardCorridor"));
  const approachingCorridor = summarize(values("approachingCorridor"));
  const aheadOrApproaching = summarize(
    oracleValues("aheadOrApproaching"),
  );
  const diagnosticAheadOrApproaching = summarize(
    values("diagnosticAheadOrApproaching"),
  );
  const currentCorridor = summarize(values("currentCorridor"));
  const patrolWithinFog = summarize(oracleValues("patrolWithinFog"));
  const patrolWithinInner = summarize(oracleValues("patrolWithinInner"));
  const active = summarize(values("active"));
  const queued = summarize(values("queued"));
  const movingInnerFraction = oracleSamples.reduce(
    (total, sample) =>
      total +
      (sample.withinInner === 0
        ? 0
        : sample.movingWithinInner / sample.withinInner),
    0,
  ) / oracleSamples.length;
  const conservationViolations = oracleSamples.flatMap((sample, index) => {
    const currentMissing = Math.max(
      0,
      bustlingTargets.currentRoad - sample.currentRoad,
    );
    const forwardMissing = Math.max(
      0,
      bustlingTargets.forwardRoad - sample.forwardRoad,
    );
    const requiredNestedFallback = Math.max(currentMissing, forwardMissing);
    return sample.movingOffCurrentFallback < requiredNestedFallback
      ? [{
          index,
          currentMissing,
          forwardMissing,
          fallback: sample.movingOffCurrentFallback,
        }]
      : [];
  });
  const conservationViolationSamples = conservationViolations.length;
  const currentRoadZeroFraction =
    oracleValues("currentRoad").filter((value) => value === 0).length /
    oracleSamples.length;
  const forwardRoadZeroFraction =
    oracleValues("forwardRoad").filter((value) => value === 0).length /
    oracleSamples.length;
  const aheadZeroFraction =
    oracleValues("aheadOrApproaching").filter((value) => value === 0).length /
    oracleSamples.length;
  const occupiedSectorCounts = oracleSamples.map((sample) =>
    [
      sample.independentSectorForward,
      sample.independentSectorRight,
      sample.independentSectorRear,
      sample.independentSectorLeft,
    ].filter((count) => count > 0).length,
  );
  const minimumIndependentOccupiedSectors = Math.min(...occupiedSectorCounts);
  const occupiedSectorSummary = summarize(occupiedSectorCounts);
  const independentSectorShares = oracleSamples.map((sample) =>
      Math.max(
        sample.independentSectorForward,
        sample.independentSectorRight,
        sample.independentSectorRear,
        sample.independentSectorLeft,
      ) / Math.max(1, sample.withinFog),
  );
  const independentSectorShareSummary = summarize(independentSectorShares);
  const maximumIndependentSectorShare = Math.max(...independentSectorShares);
  const maximumLaneOccupancy = Math.max(
    ...oracleValues("maximumLaneOccupancy"),
  );
  const maximumStoppedLaneQueue = Math.max(
    ...oracleValues("maximumStoppedLaneQueue"),
  );
  const currentCorridorOccupiedFraction =
    diagnosticCorridorOccupiedOracleSamples / oracleSamples.length;
  const maximumAheadGhostSeconds =
    maximumIndependentGhostSamples / ORACLE_SAMPLES_PER_SECOND;
  // This is the controller's separate road-relative diagnostic. Primary
  // acceptance uses the independent ten-Hz oracle above; retaining both makes
  // semantic drift visible without letting implementation counters self-grade.
  const maximumDiagnosticGhostSeconds = maximumGhostDecisionCount / 10;
  const maximumCurrentCorridorGhostSeconds =
    maximumDiagnosticCorridorGhostSamples / ORACLE_SAMPLES_PER_SECOND;
  const minimumFogP10 = Math.max(3, bustlingTargets.withinFog - 3);
  const minimumInnerP10 = Math.max(1, bustlingTargets.withinInner - 2);
  const maximumPrimaryBelowFloorSeconds = {
    fog:
      maximumBelowFloorRun(oracleValues("withinFog"), minimumFogP10) /
      ORACLE_SAMPLES_PER_SECOND,
    inner:
      maximumBelowFloorRun(oracleValues("withinInner"), minimumInnerP10) /
      ORACLE_SAMPLES_PER_SECOND,
    movingInner:
      maximumBelowFloorRun(
        oracleValues("movingWithinInner"),
        bustlingTargets.movingWithinInner,
      ) / ORACLE_SAMPLES_PER_SECOND,
    currentRoad:
      maximumBelowFloorRun(
        oracleValues("currentRoad"),
        bustlingTargets.currentRoad,
      ) / ORACLE_SAMPLES_PER_SECOND,
    forwardRoad:
      maximumBelowFloorRun(
        oracleValues("forwardRoad"),
        bustlingTargets.forwardRoad,
      ) / ORACLE_SAMPLES_PER_SECOND,
    conservedCurrent:
      maximumBelowFloorRun(
        oracleValues("conservedCurrentPresence"),
        bustlingTargets.currentRoad,
      ) / ORACLE_SAMPLES_PER_SECOND,
    conservedForward:
      maximumBelowFloorRun(
        oracleValues("conservedForwardPresence"),
        bustlingTargets.forwardRoad,
      ) / ORACLE_SAMPLES_PER_SECOND,
    ahead:
      maximumBelowFloorRun(
        oracleValues("aheadOrApproaching"),
        bustlingTargets.aheadOrApproaching,
      ) / ORACLE_SAMPLES_PER_SECOND,
    nearView:
      maximumBelowFloorRun(
        oracleValues("nearView"),
        bustlingTargets.nearView,
      ) / ORACLE_SAMPLES_PER_SECOND,
  };
  const maximumPendingRecycle = maximumPendingRecycleCount;
  const maximumApproach = Math.max(...values("approach"));
  const maximumInboundTransit = Math.max(...values("inboundTransit"));

  if (Math.abs(fog.p50 - bustlingTargets.withinFog) > 2) {
    failures.push(
      `fog p50 ${fog.p50.toFixed(1)} is not within 2 of frozen target ${bustlingTargets.withinFog}`,
    );
  }
  if (fog.p10 < minimumFogP10) {
    failures.push(
      `fog p10 ${fog.p10.toFixed(1)} < ${minimumFogP10}`,
    );
  }
  if (fog.p90 > bustlingTargets.withinFog + 4) {
    failures.push(
      `fog p90 ${fog.p90.toFixed(1)} > ${bustlingTargets.withinFog + 4}`,
    );
  }
  if (Math.abs(inner.p50 - bustlingTargets.withinInner) > 1) {
    failures.push(
      `inner p50 ${inner.p50.toFixed(1)} is not within 1 of frozen target ${bustlingTargets.withinInner}`,
    );
  }
  if (inner.p10 < minimumInnerP10) {
    failures.push(
      `inner p10 ${inner.p10.toFixed(1)} < ${minimumInnerP10}`,
    );
  }
  if (inner.p90 > bustlingTargets.withinInner + 4) {
    failures.push(
      `inner p90 ${inner.p90.toFixed(1)} > ${bustlingTargets.withinInner + 4}`,
    );
  }
  if (movingInnerFraction < MIN_MOVING_INNER_FRACTION) {
    failures.push(
      `moving-inner fraction ${movingInnerFraction.toFixed(3)} < ${MIN_MOVING_INNER_FRACTION}`,
    );
  }
  if (movingInner.p50 < bustlingTargets.movingWithinInner) {
    failures.push(
      `independent moving-inner p50 ${movingInner.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.movingWithinInner}`,
    );
  }
  if (movingCurrentRoad.p50 < bustlingTargets.movingCurrentRoad) {
    failures.push(
      `independent moving-current-road p50 ${movingCurrentRoad.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.movingCurrentRoad}`,
    );
  }
  if (movingForwardRoad.p50 < bustlingTargets.movingForwardRoad) {
    failures.push(
      `independent moving-forward-road p50 ${movingForwardRoad.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.movingForwardRoad}`,
    );
  }
  if (currentRoad.p50 < bustlingTargets.currentRoad) {
    failures.push(
      `independent current-road p50 ${currentRoad.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.currentRoad}`,
    );
  }
  if (forwardRoad.p50 < bustlingTargets.forwardRoad) {
    failures.push(
      `independent forward-road p50 ${forwardRoad.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.forwardRoad}`,
    );
  }
  if (conservedCurrentPresence.p50 < bustlingTargets.currentRoad) {
    failures.push(
      `independent current-plus-disjoint-moving-fallback p50 ${conservedCurrentPresence.p50.toFixed(1)} < storage bustling floor ${bustlingTargets.currentRoad} (fallback p50 ${movingOffCurrentFallback.p50.toFixed(1)})`,
    );
  }
  if (conservedForwardPresence.p50 < bustlingTargets.forwardRoad) {
    failures.push(
      `independent forward-plus-disjoint-moving-fallback p50 ${conservedForwardPresence.p50.toFixed(1)} < storage bustling floor ${bustlingTargets.forwardRoad} (same nested fallback p50 ${movingOffCurrentFallback.p50.toFixed(1)})`,
    );
  }
  if (conservationViolationSamples > 0) {
    const worst = conservationViolations.reduce((left, right) =>
      Math.max(right.currentMissing, right.forwardMissing) - right.fallback >
      Math.max(left.currentMissing, left.forwardMissing) - left.fallback
        ? right
        : left,
    );
    failures.push(
      `independent nested corridor conservation failed in ${conservationViolationSamples}/${oracleSamples.length} 10 Hz samples; worst sample ${worst.index} needed current/forward ${worst.currentMissing}/${worst.forwardMissing} but had ${worst.fallback} unique moving off-current inner fallback`,
    );
  }
  if (aheadOrApproaching.p50 < bustlingTargets.aheadOrApproaching) {
    failures.push(
      `independent ahead-or-approaching p50 ${aheadOrApproaching.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.aheadOrApproaching}`,
    );
  }
  if (nearView.p50 < bustlingTargets.nearView) {
    failures.push(
      `independent ${BUSTLING_CALIBRATION[device].nearViewRadiusM}m current-view p50 ${nearView.p50.toFixed(1)} < absolute bustling floor ${bustlingTargets.nearView}`,
    );
  }
  const maximumMedianLowSpeedCurrent =
    bustlingTargets.currentRoad - bustlingTargets.movingCurrentRoad;
  if (lowSpeedCurrentRoad.p50 > maximumMedianLowSpeedCurrent) {
    failures.push(
      `low-speed current-road p50 ${lowSpeedCurrentRoad.p50.toFixed(1)} > derived queue allowance ${maximumMedianLowSpeedCurrent}`,
    );
  }
  const maximumP90LowSpeedCurrent =
    BUSTLING_CALIBRATION[device].corridorCap -
    bustlingTargets.movingCurrentRoad;
  if (lowSpeedCurrentRoad.p90 > maximumP90LowSpeedCurrent) {
    failures.push(
      `low-speed current-road p90 ${lowSpeedCurrentRoad.p90.toFixed(1)} > corridor-minus-moving allowance ${maximumP90LowSpeedCurrent}`,
    );
  }
  for (const [metric, seconds] of Object.entries(
    maximumPrimaryBelowFloorSeconds,
  )) {
    if (seconds > MAX_PRIMARY_BELOW_FLOOR_SECONDS) {
      failures.push(
        `${metric} continuously below its frozen floor for ${seconds.toFixed(1)}s > ${MAX_PRIMARY_BELOW_FLOOR_SECONDS}s`,
      );
    }
  }
  const minimumOccupiedSectorP10 = device === "touch" ? 2 : 3;
  if (occupiedSectorSummary.p10 < minimumOccupiedSectorP10) {
    failures.push(
      `independent occupied-sector p10 ${occupiedSectorSummary.p10.toFixed(1)} < ${minimumOccupiedSectorP10}`,
    );
  }
  const maximumSectorShareP90 = device === "touch" ? 0.75 : 0.65;
  if (independentSectorShareSummary.p90 > maximumSectorShareP90) {
    failures.push(
      `independent largest-sector share p90 ${independentSectorShareSummary.p90.toFixed(3)} > ${maximumSectorShareP90}`,
    );
  }
  const laneCap = BUSTLING_CALIBRATION[device].laneCap;
  if (maximumLaneOccupancy > laneCap + 1) {
    failures.push(
      `independent per-lane occupancy peak ${maximumLaneOccupancy} > lane cap ${laneCap} plus one transition`,
    );
  }
  if (maximumStoppedLaneQueue > laneCap) {
    failures.push(
      `independent stopped per-lane queue peak ${maximumStoppedLaneQueue} > lane cap ${laneCap}`,
    );
  }
  if (maximumAheadGhostSeconds > MAX_AHEAD_OR_APPROACHING_GHOST_SECONDS) {
    failures.push(
      `independent ahead-or-approaching ghost gap ${maximumAheadGhostSeconds.toFixed(1)}s > ${MAX_AHEAD_OR_APPROACHING_GHOST_SECONDS}s (production diagnostic ${maximumDiagnosticGhostSeconds.toFixed(1)}s)`,
    );
  }
  const corridorOccupancyCap =
    device === "touch"
      ? LOCAL_TRAFFIC_TOUCH_CORRIDOR_OCCUPANCY_CAP
      : LOCAL_TRAFFIC_DESKTOP_CORRIDOR_OCCUPANCY_CAP;
  if (
    corridorOccupancyCap !== BUSTLING_CALIBRATION[device].corridorCap
  ) {
    failures.push(
      `production corridor cap ${corridorOccupancyCap} != frozen ${BUSTLING_CALIBRATION[device].corridorCap}`,
    );
  }
  if (currentRoad.p90 > corridorOccupancyCap + 1) {
    failures.push(
      `independent current-road p90 ${currentRoad.p90.toFixed(1)} > production cap ${corridorOccupancyCap} plus one-car crossing tolerance`,
    );
  }
  if (currentCorridor.p90 > corridorOccupancyCap + 1) {
    failures.push(
      `diagnostic current-corridor p90 ${currentCorridor.p90.toFixed(1)} > production cap ${corridorOccupancyCap} plus one-car crossing tolerance`,
    );
  }
  if (
    currentCorridorOccupiedFraction <
    MIN_CURRENT_CORRIDOR_OCCUPIED_FRACTION
  ) {
    failures.push(
      `diagnostic current-corridor occupied fraction ${currentCorridorOccupiedFraction.toFixed(3)} < ${MIN_CURRENT_CORRIDOR_OCCUPIED_FRACTION}`,
    );
  }
  if (
    maximumCurrentCorridorGhostSeconds >
    MAX_CURRENT_CORRIDOR_GHOST_SECONDS
  ) {
    failures.push(
      `diagnostic current-corridor ghost gap ${maximumCurrentCorridorGhostSeconds}s > ${MAX_CURRENT_CORRIDOR_GHOST_SECONDS}s`,
    );
  }
  const maximumQueued = maximumQueuedCount;
  const minimumStableActive = Math.min(
    initialLocality.poolCount,
    bustlingTargets.withinFog + expectedPerceptualTargets.circulatingApproach,
  );
  const queueCeiling =
    initialLocality.poolCount -
    minimumStableActive +
    LOCAL_TRAFFIC_DECISION_ACTIVATION_BUDGET +
    LOCAL_TRAFFIC_DECISION_RETIREMENT_BUDGET;
  if (maximumQueued > queueCeiling) {
    failures.push(`queued peak ${maximumQueued} > derived ceiling ${queueCeiling}`);
  }
  if (maximumPendingRecycle > MAX_PENDING_RECYCLES) {
    failures.push(
      `pending-recycle peak ${maximumPendingRecycle} > ${MAX_PENDING_RECYCLES}`,
    );
  }

  // Admission caps prevent the controller from deliberately making a patrol
  // cluster. Cars already on the road can cross a radius together, so means
  // get one-car slack and instantaneous maxima get one bounded crossing group.
  const patrolLimits = {
    innerMean: initialLocality.patrolInnerCap + (device === "touch" ? 0.5 : 1),
    innerMaximum:
      initialLocality.patrolInnerCap + (device === "touch" ? 2 : 3),
    fogMean: initialLocality.patrolFogCap + 1,
    fogMaximum: initialLocality.patrolFogCap + (device === "touch" ? 3 : 4),
  };
  if (patrolWithinInner.mean > patrolLimits.innerMean) {
    failures.push(
      `patrol inner mean ${patrolWithinInner.mean.toFixed(3)} > ${patrolLimits.innerMean}`,
    );
  }
  if (patrolWithinInner.maximum > patrolLimits.innerMaximum) {
    failures.push(
      `patrol inner maximum ${patrolWithinInner.maximum} > ${patrolLimits.innerMaximum}`,
    );
  }
  if (patrolWithinFog.mean > patrolLimits.fogMean) {
    failures.push(
      `patrol fog mean ${patrolWithinFog.mean.toFixed(3)} > ${patrolLimits.fogMean}`,
    );
  }
  if (patrolWithinFog.maximum > patrolLimits.fogMaximum) {
    failures.push(
      `patrol fog maximum ${patrolWithinFog.maximum} > ${patrolLimits.fogMaximum}`,
    );
  }

  let cleanMainRatios: PerceptualReport["cleanMainRatios"] = null;
  let cleanMainFivefoldAssessment: PerceptualReport["cleanMainFivefoldAssessment"] =
    null;
  if (anchor.kind === "authored") {
    const baseline = AUTHORED_CLEAN_MAIN_BASELINE[mapPack.id]?.[device];
    if (!baseline) {
      failures.push("missing committed clean-main authored baseline");
    } else {
      const ratio = (candidate: number, prior: number): number | null =>
        prior > 0 ? candidate / prior : null;
      cleanMainRatios = {
        fog: ratio(fog.mean, baseline.fogMean),
        inner: ratio(inner.mean, baseline.innerMean),
        movingInner: ratio(movingInner.mean, baseline.movingMean),
        currentRoad: ratio(currentRoad.mean, baseline.currentRoadMean),
        forwardRoad: ratio(forwardRoad.mean, baseline.forwardRoadMean),
        aheadOrApproaching: ratio(
          aheadOrApproaching.mean,
          baseline.aheadOrApproachingMean,
        ),
      };
      cleanMainFivefoldAssessment = assessCleanMainFivefoldCapacity(
        baseline,
        cleanMainFivefoldCapacityCeilings(
          device,
          initialLocality.poolCount,
          bustlingTargets.currentRoadCapacity,
          bustlingTargets.forwardRoadCapacity,
        ),
      );
      const comparisonRows = [
        ["fog", "fog", fog.mean],
        ["inner", "inner", inner.mean],
        ["moving-inner", "movingInner", movingInner.mean],
        ["current-road", "currentRoad", currentRoad.mean],
        ["forward-road", "forwardRoad", forwardRoad.mean],
        [
          "ahead-or-approaching",
          "aheadOrApproaching",
          aheadOrApproaching.mean,
        ],
      ] as const;
      for (const [name, metric, candidate] of comparisonRows) {
        const assessment = cleanMainFivefoldAssessment[metric];
        const prior = assessment.baselineMean;
        if (candidate < prior) {
          failures.push(
            `${name} mean ${candidate.toFixed(3)} regressed below clean-main ${prior.toFixed(3)}`,
          );
        }
        // Fivefold eligibility is independent of both city identity and the
        // chosen production target. Exempt only a zero baseline or a demand
        // above the fixed pool/topology/safety ceiling; the assessment is
        // retained in the report so every exemption is explicit.
        if (
          assessment.eligibility === "eligible" &&
          assessment.requiredMean !== null &&
          candidate < assessment.requiredMean
        ) {
          failures.push(
            `${name} mean ${candidate.toFixed(3)} is ${(
              candidate / prior
            ).toFixed(2)}x clean-main, below required 5x (independent safe ceiling ${assessment.maximumSafeMean})`,
          );
        }
      }
      const maximumForwardZeroFraction =
        baseline.forwardZeroFraction === 0
          ? 0
          : baseline.forwardZeroFraction * 0.5;
      if (forwardRoadZeroFraction > maximumForwardZeroFraction + 1e-9) {
        failures.push(
          `independent forward zero fraction ${forwardRoadZeroFraction.toFixed(3)} > clean-main improvement gate ${maximumForwardZeroFraction.toFixed(3)}`,
        );
      }
      const maximumAheadZeroFraction =
        baseline.aheadZeroFraction === 0
          ? 0
          : baseline.aheadZeroFraction * 0.5;
      if (aheadZeroFraction > maximumAheadZeroFraction + 1e-9) {
        failures.push(
          `independent ahead/approaching zero fraction ${aheadZeroFraction.toFixed(3)} > clean-main improvement gate ${maximumAheadZeroFraction.toFixed(3)}`,
        );
      }
    }
  }

  return {
    report: {
      label,
      device,
      mapId: mapPack.id,
      anchor: anchor.kind,
      laneId: anchor.laneId,
      position: [
        Math.round(anchor.x * 10) / 10,
        Math.round(anchor.z * 10) / 10,
      ],
      laneKm: {
        fog: anchor.laneLengthWithinFogM / 1_000,
        inner: anchor.laneLengthWithinInnerM / 1_000,
        currentRoad: currentRoadOracle.laneLengthWithinFogM / 1_000,
        forwardRoad: currentRoadOracle.forwardLaneLengthWithinFogM / 1_000,
      },
      target: {
        fog: bustlingTargets.withinFog,
        inner: bustlingTargets.withinInner,
        movingInner: bustlingTargets.movingWithinInner,
        currentCorridor: bustlingTargets.currentRoad,
        forwardCorridor: bustlingTargets.forwardRoad,
        movingCurrentRoad: bustlingTargets.movingCurrentRoad,
        movingForwardRoad: bustlingTargets.movingForwardRoad,
        nearView: bustlingTargets.nearView,
        aheadOrApproaching: bustlingTargets.aheadOrApproaching,
        circulatingApproach: expectedPerceptualTargets.circulatingApproach,
        patrolFogCap: initialLocality.patrolFogCap,
        patrolInnerCap: initialLocality.patrolInnerCap,
        currentRoadCapacity: bustlingTargets.currentRoadCapacity,
        forwardRoadCapacity: bustlingTargets.forwardRoadCapacity,
        streamableCurrentRoadCapacity:
          bustlingTargets.streamableCurrentRoadCapacity,
        streamableForwardRoadCapacity:
          bustlingTargets.streamableForwardRoadCapacity,
        corridorShortfall: bustlingTargets.corridorShortfall,
      },
      fog,
      inner,
      movingInner,
      diagnosticMovingInner,
      currentRoad,
      forwardRoad,
      movingCurrentRoad,
      movingForwardRoad,
      movingOffCurrentFallback,
      conservedCurrentPresence,
      conservedForwardPresence,
      lowSpeedCurrentRoad,
      nearView,
      forwardCorridor,
      approachingCorridor,
      aheadOrApproaching,
      diagnosticAheadOrApproaching,
      currentCorridor,
      patrolWithinFog,
      patrolWithinInner,
      movingInnerFraction,
      currentRoadZeroFraction,
      forwardRoadZeroFraction,
      aheadOrApproachingZeroFraction: aheadZeroFraction,
      maximumAheadOrApproachingGhostSeconds: maximumAheadGhostSeconds,
      maximumDiagnosticGhostSeconds,
      currentCorridorOccupiedFraction,
      maximumCurrentCorridorGhostSeconds,
      conservationViolationSamples,
      maximumPrimaryBelowFloorSeconds,
      minimumIndependentOccupiedSectors,
      maximumIndependentSectorShare,
      maximumLaneOccupancy,
      maximumStoppedLaneQueue,
      active,
      queued,
      maximumQueued,
      maximumPendingRecycle,
      maximumApproach,
      maximumInboundTransit,
      maximumRadialDiagnosticDelta,
      maximumPatrolDiagnosticDelta,
      maximumSectorDiagnosticDelta,
      gradedLifecycle,
      elapsedWallMs: performance.now() - startedAt,
      cleanMainRatios,
      cleanMainFivefoldAssessment,
    },
    failures,
  };
}

describe("independent perceptual traffic oracle", () => {
  it("chooses a heading-stable locality lane at an equidistant junction", () => {
    const sharedNodeLanes: readonly SimulationLane[] = [
      {
        id: "z-cross-road",
        points: [{ x: 0, z: -20 }, { x: 0, z: 0 }],
        loop: false,
      },
      {
        id: "z-driven-road",
        points: [{ x: 0, z: 0 }, { x: 20, z: 0 }],
        loop: false,
      },
      {
        id: "a-driven-road",
        points: [{ x: 0, z: 0 }, { x: 20, z: 0 }],
        loop: false,
      },
    ];
    const preferredHeading = Math.PI / 2;
    expect(
      projectToRoadWithHeadingTie(
        sharedNodeLanes,
        { x: 0, z: 0 },
        preferredHeading,
      )?.laneId,
    ).toBe("a-driven-road");
    expect(
      projectToRoadWithHeadingTie(
        [...sharedNodeLanes].reverse(),
        { x: 0, z: 0 },
        preferredHeading,
      )?.laneId,
    ).toBe("a-driven-road");

    const exactCrossAndNearAligned: readonly SimulationLane[] = [
      sharedNodeLanes[0],
      {
        id: "aligned-within-epsilon",
        points: [{ x: -20, z: 0.1 }, { x: 20, z: 0.1 }],
        loop: false,
      },
    ];
    expect(
      projectToRoadWithHeadingTie(
        exactCrossAndNearAligned,
        { x: 0, z: 0 },
        preferredHeading,
      )?.laneId,
    ).toBe("aligned-within-epsilon");
    expect(
      projectToRoadWithHeadingTie(
        [
          sharedNodeLanes[0],
          {
            id: "aligned-outside-epsilon",
            points: [{ x: -20, z: 0.101 }, { x: 20, z: 0.101 }],
            loop: false,
          },
        ],
        { x: 0, z: 0 },
        preferredHeading,
      )?.laneId,
    ).toBe("z-cross-road");
  });

  it("recognizes bounded public route connectivity without reading hidden route goals", () => {
    const lanes: readonly SimulationLane[] = [
      {
        id: "entry",
        points: [{ x: 200, z: 0 }, { x: 100, z: 0 }],
        successorLaneIds: ["away", "toward"],
        loop: false,
      },
      {
        id: "away",
        points: [{ x: 100, z: 0 }, { x: 100, z: 200 }],
        loop: false,
      },
      {
        id: "toward",
        points: [{ x: 100, z: 0 }, { x: 0, z: 0 }],
        loop: false,
      },
    ];
    const oracle = buildLaneOracle(lanes);
    const entry = oracle.get("entry");
    const away = oracle.get("away");
    expect(entry).toBeDefined();
    expect(away).toBeDefined();
    expect(
      routeReachesApproachCorridor(
        oracle,
        entry!,
        0,
        { x: 0, z: 0 },
      ),
    ).toBe(true);
    expect(
      routeReachesApproachCorridor(
        oracle,
        away!,
        0,
        { x: 0, z: 0 },
      ),
    ).toBe(false);
  });

  it("builds the local aligned road closure without admitting turns or remote lanes", () => {
    const lanes: readonly SimulationLane[] = [
      {
        id: "predecessor",
        points: [{ x: -200, z: 0 }, { x: -100, z: 0 }],
        successorLaneIds: ["player-road"],
        loop: false,
      },
      {
        id: "player-road",
        points: [{ x: -100, z: 0 }, { x: 0, z: 0 }],
        successorLaneIds: ["straight", "turn"],
        loop: false,
      },
      {
        id: "straight",
        points: [{ x: 0, z: 0 }, { x: 200, z: 0 }],
        successorLaneIds: ["disc-edge"],
        loop: false,
      },
      {
        id: "disc-edge",
        points: [{ x: 200, z: 0 }, { x: 600, z: 0 }],
        successorLaneIds: ["outside-disc"],
        loop: false,
      },
      {
        id: "outside-disc",
        points: [{ x: 600, z: 0 }, { x: 700, z: 0 }],
        loop: false,
      },
      {
        id: "turn",
        points: [{ x: 0, z: 0 }, { x: 0, z: 200 }],
        loop: false,
      },
      {
        id: "opposing-seed",
        points: [{ x: 100, z: 20 }, { x: -100, z: 20 }],
        successorLaneIds: ["opposing-continuation"],
        loop: false,
      },
      {
        id: "opposing-continuation",
        points: [{ x: -100, z: 20 }, { x: -200, z: 20 }],
        loop: false,
      },
      {
        id: "remote-parallel",
        points: [{ x: -100, z: 80 }, { x: 100, z: 80 }],
        loop: false,
      },
    ];
    const oracle = buildIndependentCurrentRoadOracle(
      buildLaneOracle(lanes),
      { x: -50, z: 0, heading: Math.PI / 2 },
    );
    expect([...oracle.corridorLaneIds].sort()).toEqual([
      "disc-edge",
      "opposing-continuation",
      "opposing-seed",
      "player-road",
      "predecessor",
      "straight",
    ]);
    expect(oracle.heading).toBeCloseTo(Math.PI / 2);
  });

  it("credits each genuinely moving off-corridor inner car once to nested conservation", () => {
    const lanes: readonly SimulationLane[] = [
      {
        id: "current",
        points: [{ x: -200, z: 0 }, { x: 200, z: 0 }],
        loop: false,
      },
      {
        id: "cross",
        points: [{ x: 0, z: -200 }, { x: 0, z: 200 }],
        loop: false,
      },
    ];
    const laneOracle = buildLaneOracle(lanes);
    const currentRoad = buildIndependentCurrentRoadOracle(
      laneOracle,
      { x: 0, z: 0, heading: Math.PI / 2 },
    );
    const snapshot = {
      player: { x: 0, z: 0, heading: Math.PI / 2 },
      npcs: [
        {
          id: "current-moving",
          laneId: "current",
          x: 30,
          z: 0,
          heading: Math.PI / 2,
          speedMps: 5,
          variant: "car",
        },
        {
          id: "cross-moving",
          laneId: "cross",
          x: 0,
          z: 30,
          heading: Math.PI,
          speedMps: 5,
          variant: "car",
        },
        {
          id: "cross-stopped",
          laneId: "cross",
          x: 0,
          z: -30,
          heading: 0,
          speedMps: 0,
          variant: "car",
        },
        {
          id: "cross-moving",
          laneId: "cross",
          x: 0,
          z: 40,
          heading: Math.PI,
          speedMps: 5,
          variant: "car",
        },
      ],
    } as unknown as SimulationSnapshot;
    const counts = snapshotCounts(
      snapshot,
      1,
      laneOracle,
      currentRoad,
      120,
    );
    expect(counts.currentRoad).toBe(1);
    expect(counts.forwardRoad).toBe(1);
    expect(counts.movingOffCurrentFallback).toBe(1);
    expect(counts.conservedCurrentPresence).toBe(2);
    expect(counts.conservedForwardPresence).toBe(2);
    expect(counts.duplicateNpcIdentityCount).toBe(1);
  });

  it("resolves the committed sparse, median, and dense anchors in every city", () => {
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario: buildFreeDriveScenario(freeDrive),
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
        touchFirst: false,
      });
      const anchors = representativeAnchors(mapPack, config);
      expect(anchors.map((anchor) => anchor.kind)).toEqual([
        "authored",
        "sparse",
        "median",
        "dense",
      ]);
      expect(new Set(anchors.map((anchor) => anchor.laneId)).size).toBe(4);
    }
  });

  it("freezes authored corridor arclength capacity and compensated targets", () => {
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario: buildFreeDriveScenario(freeDrive),
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
        touchFirst: false,
      });
      const evidence = AUTHORED_CORRIDOR_CAPACITY_EVIDENCE[
        mapPack.id as keyof typeof AUTHORED_CORRIDOR_CAPACITY_EVIDENCE
      ];
      expect(evidence).toBeDefined();
      if (!evidence) continue;
      const laneOracle = buildLaneOracle(config.lanes ?? []);
      const currentRoad = buildIndependentCurrentRoadOracle(
        laneOracle,
        config.spawn!,
        new Set(config.trafficCapacityLaneIds ?? []),
      );
      // The committed evidence table is rounded to centimetres; retain a
      // two-centimetre comparison envelope, then assert the integer capacities
      // and every derived floor exactly below.
      expect(
        Math.abs(currentRoad.laneLengthWithinFogM - evidence.currentM),
      ).toBeLessThanOrEqual(0.02);
      expect(
        Math.abs(currentRoad.forwardLaneLengthWithinFogM - evidence.forwardM),
      ).toBeLessThanOrEqual(0.02);
      const authored = representativeAnchors(mapPack, config)[0];
      for (const device of ["desktop", "touch"] as const) {
        const expected = evidence[device];
        const streamable = resolveIndependentStreamableCorridorCapacity(
          config,
          laneOracle,
          currentRoad,
          device,
        );
        expect(streamable.currentRoad).toBe(expected.streamCurrent);
        expect(streamable.forwardRoad).toBe(expected.streamForward);
        const target = resolveBustlingAcceptanceTargets(
          authored.laneLengthWithinFogM,
          authored.laneLengthWithinInnerM,
          currentRoad.laneLengthWithinFogM,
          currentRoad.forwardLaneLengthWithinFogM,
          BUSTLING_CALIBRATION[device].poolCount,
          device,
          streamable.currentRoad,
          streamable.forwardRoad,
        );
        expect(target.currentRoad).toBe(expected.current);
        expect(target.forwardRoad).toBe(expected.forward);
        expect(target.aheadOrApproaching).toBe(expected.ahead);
        expect(target.withinInner).toBe(expected.inner);
      }
    }
  });

  it("freezes authored fivefold eligibility against safety capacity", () => {
    for (const freeDrive of FREE_DRIVES) {
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario: buildFreeDriveScenario(freeDrive),
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
        touchFirst: false,
      });
      const baselineByDevice = AUTHORED_CLEAN_MAIN_BASELINE[mapPack.id];
      const expectedByDevice =
        AUTHORED_FIVEFOLD_ELIGIBILITY_EVIDENCE[mapPack.id];
      expect(baselineByDevice).toBeDefined();
      expect(expectedByDevice).toBeDefined();
      if (!baselineByDevice || !expectedByDevice) continue;
      const currentRoad = buildIndependentCurrentRoadOracle(
        buildLaneOracle(config.lanes ?? []),
        config.spawn!,
        new Set(config.trafficCapacityLaneIds ?? []),
      );
      const currentRoadCapacity = Math.floor(
        currentRoad.laneLengthWithinFogM /
          ACCEPTANCE_CORRIDOR_SAFE_SPACING_M,
      );
      const forwardRoadCapacity = Math.floor(
        currentRoad.forwardLaneLengthWithinFogM /
          ACCEPTANCE_CORRIDOR_SAFE_SPACING_M,
      );
      for (const device of ["desktop", "touch"] as const) {
        const assessment = assessCleanMainFivefoldCapacity(
          baselineByDevice[device],
          cleanMainFivefoldCapacityCeilings(
            device,
            BUSTLING_CALIBRATION[device].poolCount,
            currentRoadCapacity,
            forwardRoadCapacity,
          ),
        );
        const eligible = CLEAN_MAIN_COMPARISON_METRICS.filter(
          (metric) => assessment[metric].eligibility === "eligible",
        );
        expect(eligible).toEqual(expectedByDevice[device]);
      }
    }
  });
});

describe("four-city perceptual traffic density acceptance", () => {
  it(
    "keeps desktop and touch traffic locally dense, moving, and perceptually present",
    () => {
      expect(LOCAL_TRAFFIC_FOG_RADIUS_M).toBe(ACCEPTANCE_FOG_RADIUS_M);
      expect(LOCAL_TRAFFIC_INNER_RADIUS_M).toBe(ACCEPTANCE_INNER_RADIUS_M);
      expect(LOCAL_TRAFFIC_APPROACHING_ROAD_RADIUS_M).toBe(
        ACCEPTANCE_APPROACH_CORRIDOR_RADIUS_M,
      );
      expect(RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_LOOKAHEAD_M).toBe(
        ACCEPTANCE_ROUTE_LOOKAHEAD_M,
      );
      expect(RUNTIME_TRAFFIC_PORTAL_INNER_ROUTE_MAX_HOPS).toBe(
        ACCEPTANCE_ROUTE_MAX_HOPS,
      );
      expect(FREE_DRIVES).toHaveLength(4);
      const reports: PerceptualReport[] = [];
      const failures: string[] = [];
      for (const freeDrive of FREE_DRIVES) {
        const country = getCountryProfile(freeDrive.countryId);
        const mapPack = getMapPack(freeDrive.mapId);
        const scenario = buildFreeDriveScenario(freeDrive);
        const desktopConfig = buildSimulationCoreConfig({
          scenario,
          mapPack,
          trafficSide: country.trafficSide,
          speedUnit: country.speedUnit,
          touchFirst: false,
        });
        const anchors = representativeAnchors(mapPack, desktopConfig);
        const selectedAnchors = AUTHORED_SHORT_PROBE
          ? anchors.filter((anchor) => anchor.kind === "authored")
          : anchors;
        for (const device of ["desktop", "touch"] as const) {
          const config =
            device === "desktop"
              ? desktopConfig
              : buildSimulationCoreConfig({
                  scenario,
                  mapPack,
                  trafficSide: country.trafficSide,
                  speedUnit: country.speedUnit,
                  touchFirst: true,
                });
          for (const anchor of selectedAnchors) {
            const result = runPerceptualCase(
              mapPack,
              config,
              device,
              anchor,
            );
            reports.push(result.report);
            for (const failure of result.failures) {
              failures.push(`${result.report.label}: ${failure}`);
            }
          }
        }
      }

      for (const report of reports) {
        const rounded = (value: number): number =>
          Math.round(value * 100) / 100;
        console.info(
          `[trafficPerceptualDensityAcceptance] ${JSON.stringify({
            label: report.label,
            laneKm: report.laneKm,
            target: report.target,
            fog: [report.fog.p10, report.fog.p50, report.fog.p90].map(rounded),
            inner: [report.inner.p10, report.inner.p50, report.inner.p90].map(rounded),
            moving: [
              report.movingInner.p50,
              rounded(report.movingInnerFraction),
              report.diagnosticMovingInner.p50,
            ],
            road: [
              report.currentRoad.p50,
              report.forwardRoad.p50,
              report.movingCurrentRoad.p50,
              report.movingForwardRoad.p50,
            ].map(rounded),
            continuityCompensation: [
              report.movingOffCurrentFallback.p50,
              report.conservedCurrentPresence.p50,
              report.conservedForwardPresence.p50,
            ].map(rounded),
            conservationViolationSamples:
              report.conservationViolationSamples,
            lowSpeedCurrent: [
              report.lowSpeedCurrentRoad.p50,
              report.lowSpeedCurrentRoad.p90,
            ].map(rounded),
            nearView: report.nearView.p50,
            diagnosticCorridor: [
              report.currentCorridor.p50,
              report.forwardCorridor.p50,
              report.approachingCorridor.p50,
            ].map(rounded),
            ahead: [
              report.aheadOrApproaching.p50,
              report.diagnosticAheadOrApproaching.p50,
            ].map(rounded),
            ghostSeconds: [
              report.maximumAheadOrApproachingGhostSeconds,
              report.maximumDiagnosticGhostSeconds,
            ].map(rounded),
            patrolInner: [report.patrolWithinInner.mean, report.patrolWithinInner.maximum].map(rounded),
            patrolFog: [report.patrolWithinFog.mean, report.patrolWithinFog.maximum].map(rounded),
            queuedMax: report.maximumQueued,
            pendingMax: report.maximumPendingRecycle,
            gradedLifecycle: report.gradedLifecycle,
            lanePeak: [
              report.maximumLaneOccupancy,
              report.maximumStoppedLaneQueue,
            ],
            sector: [
              report.minimumIndependentOccupiedSectors,
              rounded(report.maximumIndependentSectorShare),
            ],
            belowFloorSeconds: Object.fromEntries(
              Object.entries(report.maximumPrimaryBelowFloorSeconds).map(
                ([key, value]) => [key, rounded(value)],
              ),
            ),
            selectedMetricCleanMainRatios: report.cleanMainRatios
              ? Object.fromEntries(
                  Object.entries(report.cleanMainRatios).map(([key, value]) => [
                    key,
                    value === null ? null : rounded(value),
                  ]),
                )
              : null,
            cleanMainFivefoldAssessment: report.cleanMainFivefoldAssessment
              ? Object.fromEntries(
                  Object.entries(report.cleanMainFivefoldAssessment).map(
                    ([key, assessment]) => [
                      key,
                      {
                        required:
                          assessment.requiredMean === null
                            ? null
                            : rounded(assessment.requiredMean),
                        safeCeiling: assessment.maximumSafeMean,
                        eligibility: assessment.eligibility,
                      },
                    ],
                  ),
                )
              : null,
            wallMs: rounded(report.elapsedWallMs),
          })}`,
        );
      }
      expect(reports).toHaveLength(4 * 2 * (AUTHORED_SHORT_PROBE ? 1 : 4));
      expect(
        failures.length,
        `Perceptual traffic acceptance failures:\n${failures.join("\n")}`,
      ).toBe(0);
    },
    240_000,
  );
});
