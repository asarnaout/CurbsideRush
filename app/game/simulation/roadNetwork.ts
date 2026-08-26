import type { SimulationPoint, SimulationPose, SimulationBounds, TurnSignal } from "../simulation";
import { angleDifference, clamp, distanceSquared } from "./mathUtils";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "./roadLevels";
import {
  railCrossingSignalAt,
  railCrossingWarningWindows,
  railCyclePeriodSeconds,
  type RailCrossingWindow,
  type SimulationRailLine,
} from "./railSchedule";

/**
 * The static, authored road graph — lanes, traffic lights, and stop lines —
 * plus every pure query against it: lane-relative positioning, nearest-lane
 * projection, route-graph distance search, and signal-cycle timing. Built
 * once per `SimulationCore` instance and read-only after construction
 * (aside from `routeDistanceAhead`'s own scratch buffers, which are a
 * performance cache with no semantic state — see its comment).
 *
 * This is a fourth seam beyond the issue's three-module hypothesis
 * (`playerDynamics`/`trafficSystem`/`roadRuleMonitor`), split out because
 * lane/signal geometry has no single natural owner among those three: the
 * player's own road projection (`updateRoadState`, still in `simulation.ts`)
 * needs it, `trafficSystem.ts` needs it for gate safety and following gaps,
 * and `roadRuleMonitor.ts` needs it for box junctions, stop lines, and
 * restricted-lane checks. Centralizing it here avoids `roadRuleMonitor.ts`
 * and the facade depending on `trafficSystem.ts` for something that has
 * nothing to do with NPCs.
 *
 * Moved verbatim out of `simulation.ts` (issue #284) — every method body is
 * byte-identical to its pre-split original, `this.` renamed to operate on
 * this class's own fields instead.
 */

export type LaneRole = "travel" | "passing" | "entry" | "exit";
export type LaneKind = "road" | "roundabout" | "merge";
export type TrafficLightState = "green" | "amber" | "all_red" | "red" | "red_amber";
export type TrafficLightSequence = "standard" | "uk";

export interface SimulationLane {
  readonly id: string;
  /** Stable authored road/corridor identity. Optional for synthetic callers
   * that predate map-pack road metadata. */
  readonly roadId?: string;
  /** Points are ordered in the legal direction of travel. */
  readonly points: readonly SimulationPoint[];
  readonly width?: number;
  readonly role?: LaneRole;
  readonly kind?: LaneKind;
  readonly speedLimitMps?: number;
  readonly adjacentLaneId?: string;
  /** Legal lanes an NPC may enter after reaching this lane's end. */
  readonly successorLaneIds?: readonly string[];
  readonly loop?: boolean;
}

export interface TrafficLightCycle {
  readonly greenSeconds: number;
  readonly amberSeconds: number;
  /** Clearance period after amber in which every approach is red. */
  readonly allRedSeconds: number;
  readonly redSeconds: number;
  /** UK pre-green red-and-amber period; ignored by standard sequences. */
  readonly redAmberSeconds: number;
  readonly offsetSeconds?: number;
  readonly sequence: TrafficLightSequence;
}

export interface TrafficLightDefinition extends SimulationPoint {
  readonly id: string;
  /** Lights in one approach share a phase-group identifier. */
  readonly phaseGroup?: string;
  readonly cycle?: Partial<TrafficLightCycle>;
  /**
   * Present on a level-crossing head tied to an authored rail line: the
   * light then ignores `cycle` and derives red/green from the line's
   * timetable (`railSchedule.ts`), so the lamps, the NPC hold and the
   * citation can never disagree with where the train actually is. A
   * railway head *without* this keeps the legacy free-running cycle.
   */
  readonly rail?: {
    readonly lineId: string;
    readonly crossingDistanceM: number;
  };
}

export interface StopLineDefinition {
  readonly id: string;
  readonly laneId: string;
  /** Distance in metres from the beginning of the lane. */
  readonly distance: number;
  readonly kind: "traffic_light" | "railway" | "stop" | "yield";
  readonly trafficLightId?: string;
  readonly turnDirection?: Exclude<TurnSignal, "off">;
  readonly conflictRadius?: number;
  /**
   * Set only on a give-way line whose own lane leads onto a roundabout ring,
   * and naming the side the circulating stream comes from — "right" wherever
   * traffic drives on the left.
   *
   * Without it a yield line holds for *any* vehicle inside its conflict
   * radius, from any direction, which is right for a plain give-way and wrong
   * for a roundabout: entering and circulating traffic would mutually block,
   * and the enterer — an ordinary road lane, so not exempt from the jam
   * recycler the way a ring lane is — would visibly teleport away rather than
   * give way.
   */
  readonly roundaboutYieldFrom?: "left" | "right";
}

export interface NormalizedLane {
  id: string;
  roadId?: string;
  points: SimulationPoint[];
  width: number;
  role: LaneRole;
  kind: LaneKind;
  speedLimitMps: number;
  adjacentLaneId?: string;
  successorLaneIds: string[];
  loop: boolean;
  segmentLengths: number[];
  length: number;
  /** Highest authored point on this lane. A lane whose profile ever rises
   * into structural bridge height cannot be acquired from an unrelated
   * ground street merely because their x/z projections overlap. */
  maxElevationM: number;
  /** Position in RoadNetwork.lanes, stamped in the constructor — lets hot
   * paths key typed arrays by lane without a map lookup. */
  index?: number;
}

export interface NormalizedTrafficLight extends SimulationPoint {
  id: string;
  phaseGroup: string;
  cycle: TrafficLightCycle;
  /** Precomputed timetable view for a rail-driven head: the crossing's
   * warning windows folded into one period. Absent on ordinary signals. */
  rail?: {
    windows: readonly RailCrossingWindow[];
    periodSeconds: number;
    offsetSeconds: number;
  };
}

export interface LaneProjection {
  lane: NormalizedLane;
  distance: number;
  distanceAlong: number;
  heading: number;
  x: number;
  z: number;
  elevationM: number;
}

export interface RoadProjectionPreference {
  /** Direction used only to break near-equal geometric projections. */
  readonly heading: number;
  /** Global minimum-distance band. The 0.1 m default covers authored shared
   * node tolerances while remaining far below a lane width. */
  readonly distanceTieEpsilonM?: number;
  /** Keeps exactly stacked lanes stable, but yields once another connected
   * surface is measurably closer so an on-ramp can acquire the car. */
  readonly preferredLaneId?: string;
  /** Height occupied on the previous simulation step. When a nearby lane
   * continues at this height, a geometrically closer road underneath it must
   * not steal the projection and snap the vehicle vertically. Zero remains a
   * real ground-height preference. Fully at-grade lanes remain global so a
   * one-tick intersection projection cannot trap the car; a lane whose profile
   * rises into bridge structure requires a connected, directed transition. */
  readonly preferredElevationM?: number;
  /** Maximum per-step height difference still considered the same continuous
   * road surface. Defaults to 0.55 m, comfortably above any authored ramp's
   * fixed-step rise while remaining far below a separate road level. */
  readonly elevationContinuityM?: number;
  /** Above ground, the height lock is abandoned when no compatible lane is
   * this close, so teleports and genuine departures from a ramp can still
   * reach the street. Ground itself never expires by distance. Defaults to
   * 12 m: a four-lane flyover plus an oblique ramp gore can put the car 7–10 m
   * from every lane centre while it is still on continuous elevated asphalt. */
  readonly elevationCaptureDistanceM?: number;
  /**
   * Lets an explicit authored 3D placement acquire any lane at the supplied
   * height. Live driving leaves this false: a ground car may enter a profiled
   * ramp only through the occupied lane's graph neighbours.
   */
  readonly allowUnconnectedElevationCapture?: boolean;
}

/** Read-only instrumentation for external traffic benchmarks. It is never
 * consulted by a routing decision, so resetting/polling it cannot desync a
 * deterministic replay. */
export interface RouteSearchCounterSnapshot {
  readonly calls: number;
  readonly lanesVisited: number;
  readonly maxLanesVisited: number;
}

/**
 * How far along the route ahead `routeDistanceAhead` will look before giving
 * up and calling a car "not ahead of me".
 *
 * Every consumer of that distance is a following-gap test, and the widest is a
 * car at top speed wanting its standstill gap plus 1.8 s of headway — under
 * 62 m. The traffic-gate headway check and the player's own following-distance
 * rule are both smaller again, and `followingNpc` discards anything past 80 m
 * outright. This is set several times over the largest of them, so it prunes
 * the search without any caller being able to tell.
 */
// Kept public for TrafficSpatialIndex's conservative lane-topology broad
// phase. The index may include extra lane occupants, but must never omit a
// lane `routeDistanceAhead` could examine under these same bounds.
export const ROUTE_LOOKAHEAD_LIMIT_M = 240;
export const ROUTE_LOOKAHEAD_MAX_HOPS = 6;

function normalizeLane(lane: SimulationLane): NormalizedLane {
  const points = lane.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    .map((point) =>
      Number.isFinite(point.elevationM)
        ? {
            x: point.x,
            z: point.z,
            elevationM: Math.max(0, point.elevationM ?? 0),
          }
        : { x: point.x, z: point.z },
    );
  if (points.length < 2) {
    throw new Error(`Simulation lane "${lane.id}" needs at least two finite points.`);
  }
  const segmentLengths: number[] = [];
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = Math.sqrt(distanceSquared(points[index], points[index + 1]));
    segmentLengths.push(segmentLength);
    length += segmentLength;
  }
  if (length <= Number.EPSILON) {
    throw new Error(`Simulation lane "${lane.id}" has no usable length.`);
  }
  const maxElevationM = points.reduce(
    (highest, point) => Math.max(highest, point.elevationM ?? 0),
    0,
  );
  return {
    id: lane.id,
    roadId: lane.roadId,
    points,
    width: clamp(lane.width ?? 3.5, 2.4, 8),
    role: lane.role ?? "travel",
    kind: lane.kind ?? "road",
    speedLimitMps: clamp(lane.speedLimitMps ?? 13.4, 2, 45),
    adjacentLaneId: lane.adjacentLaneId,
    successorLaneIds: [...(lane.successorLaneIds ?? [])],
    loop: lane.loop ?? true,
    segmentLengths,
    length,
    maxElevationM,
  };
}

function buildConflictApproachLaneIds(lanes: readonly NormalizedLane[]): Set<string> {
  const result = new Set<string>();
  for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
    const left = lanes[leftIndex];
    const leftEnd = left.points[left.points.length - 1];
    for (let rightIndex = leftIndex + 1; rightIndex < lanes.length; rightIndex += 1) {
      const right = lanes[rightIndex];
      const rightEnd = right.points[right.points.length - 1];
      if (distanceSquared(leftEnd, rightEnd) > 0.75 * 0.75) continue;
      result.add(left.id);
      result.add(right.id);
    }
  }
  return result;
}

function normalizeTrafficLight(
  light: TrafficLightDefinition,
  railLinesById: ReadonlyMap<string, SimulationRailLine>,
): NormalizedTrafficLight {
  const railLine = light.rail ? railLinesById.get(light.rail.lineId) : undefined;
  return {
    id: light.id,
    phaseGroup: light.phaseGroup ?? light.id,
    x: light.x,
    z: light.z,
    ...(railLine && light.rail
      ? {
          rail: {
            windows: railCrossingWarningWindows(railLine, light.rail.crossingDistanceM),
            periodSeconds: railCyclePeriodSeconds(railLine),
            offsetSeconds: railLine.schedule.offsetSeconds ?? 0,
          },
        }
      : {}),
    cycle: {
      greenSeconds: clamp(light.cycle?.greenSeconds ?? 9, 1, 120),
      amberSeconds: clamp(light.cycle?.amberSeconds ?? 2, 0.5, 10),
      allRedSeconds: clamp(light.cycle?.allRedSeconds ?? 0, 0, 10),
      redSeconds: clamp(light.cycle?.redSeconds ?? 9, 1, 120),
      redAmberSeconds: clamp(light.cycle?.redAmberSeconds ?? 0, 0, 10),
      offsetSeconds: light.cycle?.offsetSeconds ?? 0,
      sequence: light.cycle?.sequence ?? "standard",
    },
  };
}

export function isRedSignalState(state: TrafficLightState): boolean {
  return state === "red" || state === "red_amber" || state === "all_red";
}

/** Bounding box of a set of normalized lanes, padded for a bit of run-off
 * room. Used once, at construction, to default `SimulationCoreConfig.bounds`
 * when a scenario does not author one. */
export function boundsForLanes(lanes: readonly NormalizedLane[]): SimulationBounds {
  if (lanes.length === 0) {
    return { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const lane of lanes) {
    for (const point of lane.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }
  return {
    minX: minX - 10,
    maxX: maxX + 10,
    minZ: minZ - 5,
    maxZ: maxZ + 5,
  };
}

export class RoadNetwork {
  readonly lanes: NormalizedLane[];
  readonly lanesById: Map<string, NormalizedLane>;
  readonly conflictApproachLaneIds: Set<string>;
  readonly trafficLights: NormalizedTrafficLight[];
  readonly trafficLightsById: Map<string, NormalizedTrafficLight>;
  readonly stopLines: StopLineDefinition[];
  readonly stopLinesByLaneId: Map<string, StopLineDefinition[]>;
  private readonly predecessorLaneIdsById = new Map<string, string[]>();
  /** Reused by player projection; at most the occupied lane plus its immediate
   * legal neighbours. Clearing it avoids a Set allocation every fixed step. */
  private readonly projectionContinuityLaneIds = new Set<string>();
  /** Directional subset used only while acquiring a rising profile from
   * ground. Predecessors are intentionally absent: accepting one lets a car
   * on a through street latch onto a nearby exit ramp backwards. */
  private readonly groundProfileCaptureLaneIds = new Set<string>();

  // routeDistanceAhead scratch. Route-leading now reaches this exact search
  // only through TrafficSpatialIndex's conservative topology candidates;
  // gate and junction safety still use it where an exact route answer is
  // required. The queue used to allocate an array, a visited Map and a node
  // literal per pushed lane — over a million short-lived objects a second in
  // dense pair scans. It is now three
  // parallel arrays walked by a moving head (no shift() memmove); visited is
  // a generation-stamped pair keyed by lane.index, cleared by bumping the
  // generation (pre-incremented per call, so the post-reset zero can never
  // read as visited). Traversal order and float comparisons are identical
  // to the old form — the acceptance trace hash pins that.
  private readonly routeQueueLanes: NormalizedLane[] = [];
  private readonly routeQueueDistances: number[] = [];
  private readonly routeQueueDepths: number[] = [];
  private routeVisitedGeneration: Float64Array;
  private routeVisitedBest: Float64Array;
  private routeSearchGeneration = 0;
  private routeSearchCounters = {
    calls: 0,
    lanesVisited: 0,
    maxLanesVisited: 0,
  };

  constructor(
    lanes: readonly SimulationLane[],
    trafficLights: readonly TrafficLightDefinition[],
    stopLines: readonly StopLineDefinition[],
    railLines: readonly SimulationRailLine[] = [],
  ) {
    this.lanes = lanes.map(normalizeLane);
    this.lanesById = new Map(this.lanes.map((lane) => [lane.id, lane]));
    for (const [index, lane] of this.lanes.entries()) lane.index = index;
    this.routeVisitedGeneration = new Float64Array(this.lanes.length);
    this.routeVisitedBest = new Float64Array(this.lanes.length);
    for (const lane of this.lanes) {
      lane.successorLaneIds = lane.successorLaneIds.filter(
        (successorId, index, values) =>
          successorId !== lane.id &&
          this.lanesById.has(successorId) &&
          values.indexOf(successorId) === index,
      );
      for (const successorId of lane.successorLaneIds) {
        const predecessors = this.predecessorLaneIdsById.get(successorId);
        if (predecessors) predecessors.push(lane.id);
        else this.predecessorLaneIdsById.set(successorId, [lane.id]);
      }
    }
    this.conflictApproachLaneIds = buildConflictApproachLaneIds(this.lanes);

    const railLinesById = new Map(railLines.map((line) => [line.id, line]));
    this.trafficLights = trafficLights.map((light) =>
      normalizeTrafficLight(light, railLinesById),
    );
    this.trafficLightsById = new Map(this.trafficLights.map((light) => [light.id, light]));

    this.stopLines = stopLines
      .filter((line) => this.lanesById.has(line.laneId))
      .map((line) => ({ ...line }));
    // Per-lane view of the same objects, in the same relative order, so the
    // per-NPC-per-step control checks read one bucket instead of scanning
    // every stop line in the city.
    this.stopLinesByLaneId = new Map();
    for (const line of this.stopLines) {
      let bucket = this.stopLinesByLaneId.get(line.laneId);
      if (!bucket) {
        bucket = [];
        this.stopLinesByLaneId.set(line.laneId, bucket);
      }
      bucket.push(line);
    }
  }

  /** Pure scratch reset — stale content is unreadable behind the generation
   * pre-increment, but a reset run should start from a clean slate anyway. */
  resetRouteSearch(): void {
    this.routeSearchGeneration = 0;
    this.routeVisitedGeneration.fill(0);
  }

  getRouteSearchCounters(): RouteSearchCounterSnapshot {
    return { ...this.routeSearchCounters };
  }

  resetRouteSearchCounters(): void {
    this.routeSearchCounters = { calls: 0, lanesVisited: 0, maxLanesVisited: 0 };
  }

  /**
   * Adds the road surfaces that physically continue from one directed lane.
   * Vehicle headroom uses this at its leading/trailing capsule samples: the
   * leading edge may overlap a legal successor before the axle changes lanes,
   * and the trailing edge may remain over a predecessor just after it does.
   * Keeping direction selection at the caller prevents a wrong-way approach
   * from treating an exit ramp as its own pavement.
   */
  addLaneRoadSurfaceIds(
    laneId: string | undefined,
    target: Set<string>,
    {
      includePredecessors = false,
      includeSuccessors = false,
    }: {
      readonly includePredecessors?: boolean;
      readonly includeSuccessors?: boolean;
    } = {},
  ): void {
    if (!laneId) return;
    const addLane = (candidateId: string): void => {
      const candidate = this.lanesById.get(candidateId);
      if (!candidate) return;
      if (candidate.roadId) target.add(candidate.roadId);
      if (candidate.adjacentLaneId) {
        const adjacent = this.lanesById.get(candidate.adjacentLaneId);
        if (adjacent?.roadId) target.add(adjacent.roadId);
      }
    };
    const lane = this.lanesById.get(laneId);
    if (!lane) return;
    addLane(lane.id);
    if (includePredecessors) {
      for (const predecessorId of this.predecessorLaneIdsById.get(lane.id) ?? []) {
        addLane(predecessorId);
      }
    }
    if (includeSuccessors) {
      for (const successorId of lane.successorLaneIds) addLane(successorId);
    }
  }

  private recordRouteSearch(lanesVisited: number): void {
    this.routeSearchCounters.calls += 1;
    this.routeSearchCounters.lanesVisited += lanesVisited;
    if (lanesVisited > this.routeSearchCounters.maxLanesVisited) {
      this.routeSearchCounters.maxLanesVisited = lanesVisited;
    }
  }

  pointOnLane(lane: NormalizedLane, rawDistance: number): SimulationPose {
    let distance = rawDistance;
    if (lane.loop && (distance < 0 || distance > lane.length)) {
      distance = ((distance % lane.length) + lane.length) % lane.length;
    } else {
      distance = clamp(distance, 0, lane.length);
    }
    let accumulated = 0;
    for (let index = 0; index < lane.segmentLengths.length; index += 1) {
      const segmentLength = lane.segmentLengths[index];
      if (distance <= accumulated + segmentLength || index === lane.segmentLengths.length - 1) {
        const amount = segmentLength > 0 ? (distance - accumulated) / segmentLength : 0;
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const clampedAmount = clamp(amount, 0, 1);
        const elevationM =
          (start.elevationM ?? 0) +
          ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * clampedAmount;
        return {
          x: start.x + (end.x - start.x) * clampedAmount,
          z: start.z + (end.z - start.z) * clampedAmount,
          ...(elevationM > 0 ? { elevationM } : {}),
          heading: Math.atan2(end.x - start.x, end.z - start.z),
        };
      }
      accumulated += segmentLength;
    }
    const final = lane.points[lane.points.length - 1];
    return {
      x: final.x,
      z: final.z,
      ...((final.elevationM ?? 0) > 0
        ? { elevationM: final.elevationM }
        : {}),
      heading: 0,
    };
  }

  projectToRoad(
    x: number,
    z: number,
    preference?: RoadProjectionPreference,
  ): LaneProjection | null {
    if (preference) {
      let minimumDistance = Number.POSITIVE_INFINITY;
      let minimumElevationCompatibleDistance = Number.POSITIVE_INFINITY;
      const preferredElevationM = Number.isFinite(preference.preferredElevationM)
        ? Math.max(0, preference.preferredElevationM ?? 0)
        : null;
      const elevationContinuityM = Math.max(
        0,
        Number.isFinite(preference.elevationContinuityM)
          ? (preference.elevationContinuityM ?? 0.55)
          : 0.55,
      );
      const elevationCaptureDistanceM = Math.max(
        0,
        Number.isFinite(preference.elevationCaptureDistanceM)
          ? (preference.elevationCaptureDistanceM ?? 12)
          : 12,
      );
      const continuityLaneIds = this.projectionContinuityLaneIds;
      continuityLaneIds.clear();
      const groundProfileCaptureLaneIds = this.groundProfileCaptureLaneIds;
      groundProfileCaptureLaneIds.clear();
      const preferredLane = preference.preferredLaneId
        ? this.lanesById.get(preference.preferredLaneId)
        : undefined;
      if (preferredLane) {
        continuityLaneIds.add(preferredLane.id);
        groundProfileCaptureLaneIds.add(preferredLane.id);
        if (preferredLane.adjacentLaneId) {
          continuityLaneIds.add(preferredLane.adjacentLaneId);
          groundProfileCaptureLaneIds.add(preferredLane.adjacentLaneId);
        }
        for (const laneId of preferredLane.successorLaneIds) {
          continuityLaneIds.add(laneId);
          groundProfileCaptureLaneIds.add(laneId);
          const successor = this.lanesById.get(laneId);
          if (successor?.adjacentLaneId) {
            continuityLaneIds.add(successor.adjacentLaneId);
            groundProfileCaptureLaneIds.add(successor.adjacentLaneId);
          }
        }
        for (const laneId of this.predecessorLaneIdsById.get(preferredLane.id) ?? []) {
          continuityLaneIds.add(laneId);
          const predecessor = this.lanesById.get(laneId);
          if (predecessor?.adjacentLaneId) {
            continuityLaneIds.add(predecessor.adjacentLaneId);
          }
        }
      }
      const groundHeightPreference =
        preferredElevationM !== null &&
        preferredElevationM <= ELEVATED_ROAD_STRUCTURE_THRESHOLD_M;
      let hasDirectedRisingProfile = false;
      if (groundHeightPreference) {
        for (const laneId of groundProfileCaptureLaneIds) {
          if (
            (this.lanesById.get(laneId)?.maxElevationM ?? 0) >=
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M
          ) {
            hasDirectedRisingProfile = true;
            break;
          }
        }
      }
      const allowUnconnectedElevationCapture = Boolean(
        preference.allowUnconnectedElevationCapture,
      );
      // An authored elevated spawn has a height but no preceding lane yet, so
      // it needs a one-off all-lane height search. Ground projection stays
      // global only across lanes that remain entirely at grade: that recovers
      // from transient crossing/opposing projections without letting an
      // unrelated ramp's shallow apron become a staircase onto the bridge.
      // A live ground-to-ramp transition must instead come from the occupied
      // lane, its adjacent lane, or an immediate directed successor. A raised
      // predecessor is an exit ramp, not a valid entrance from this lane.
      const scanAllLanesForElevation =
        preferredElevationM !== null &&
        (allowUnconnectedElevationCapture ||
          (continuityLaneIds.size === 0 && !groundHeightPreference));
      for (const lane of this.lanes) {
        const elevationCandidateLane =
          scanAllLanesForElevation ||
          (groundHeightPreference
            ? lane.maxElevationM < ELEVATED_ROAD_STRUCTURE_THRESHOLD_M ||
              groundProfileCaptureLaneIds.has(lane.id)
            : continuityLaneIds.has(lane.id));
        for (let index = 0; index < lane.points.length - 1; index += 1) {
          const start = lane.points[index];
          const end = lane.points[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount =
            lengthSquared > Number.EPSILON
              ? clamp(
                  ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared,
                  0,
                  1,
                )
              : 0;
          const nearestX = start.x + dx * amount;
          const nearestZ = start.z + dz * amount;
          const distance = Math.hypot(x - nearestX, z - nearestZ);
          minimumDistance = Math.min(minimumDistance, distance);
          if (
            elevationCandidateLane &&
            preferredElevationM !== null &&
            Math.abs(
              (start.elevationM ?? 0) +
                ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount -
                preferredElevationM,
            ) <= elevationContinuityM
          ) {
            minimumElevationCompatibleDistance = Math.min(
              minimumElevationCompatibleDistance,
              distance,
            );
          }
        }
      }
      if (!Number.isFinite(minimumDistance)) return null;
      // Ground is a physical layer, not a proximity hint. If no legal lane at
      // that layer exists, returning no projection keeps the car on the ground
      // and off-road instead of assigning the closest deck's height.
      if (
        groundHeightPreference &&
        !Number.isFinite(minimumElevationCompatibleDistance)
      ) {
        return null;
      }
      const lockToContinuousElevation =
        preferredElevationM !== null &&
        (groundHeightPreference ||
          minimumElevationCompatibleDistance <= elevationCaptureDistanceM);
      if (lockToContinuousElevation) {
        minimumDistance = minimumElevationCompatibleDistance;
      }
      const authoredTieEpsilon = Math.max(
        0,
        Number.isFinite(preference.distanceTieEpsilonM)
          ? (preference.distanceTieEpsilonM ?? 0.1)
          : 0.1,
      );
      // At the low end of a legal ramp, the opposite-direction exit apron or
      // the host street can remain a few decimetres closer in plan even while
      // the driver's heading follows the connected rising lane. Give heading
      // enough room to select that graph-authorised profile. Unrelated ramps
      // never enter `groundProfileCaptureLaneIds`, so this cannot pull a car
      // from a street onto an arbitrary bridge above it.
      const tieEpsilon = hasDirectedRisingProfile
        ? Math.max(authoredTieEpsilon, 0.75)
        : authoredTieEpsilon;
      // Ordinary lane identity remains much narrower than the heading band so
      // an on-ramp can acquire the car as soon as it is measurably closer. At
      // a directed rising profile, however, that same narrow window lets an
      // overlapping wrong-way exit apron steal the car for one tick and erase
      // its legal successor set. Keep the occupied approach/ramp until the
      // matching-heading continuation is clearly closer; the enlarged value
      // is topology-gated and still far inside a lane width.
      const preferredLaneHysteresisM =
        (preferredLane?.maxElevationM ?? 0) >=
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M
        ? tieEpsilon
        : Math.min(tieEpsilon, 0.025);
      let best: LaneProjection | null = null;
      let bestHeadingDifference = Number.POSITIVE_INFINITY;
      let bestPreferred = false;
      let accumulated = 0;
      for (const lane of this.lanes) {
        const elevationCandidateLane =
          scanAllLanesForElevation ||
          (groundHeightPreference
            ? lane.maxElevationM < ELEVATED_ROAD_STRUCTURE_THRESHOLD_M ||
              groundProfileCaptureLaneIds.has(lane.id)
            : continuityLaneIds.has(lane.id));
        if (lockToContinuousElevation && !elevationCandidateLane) {
          continue;
        }
        accumulated = 0;
        for (let index = 0; index < lane.points.length - 1; index += 1) {
          const start = lane.points[index];
          const end = lane.points[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount =
            lengthSquared > Number.EPSILON
              ? clamp(
                  ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared,
                  0,
                  1,
                )
              : 0;
          const nearestX = start.x + dx * amount;
          const nearestZ = start.z + dz * amount;
          const distance = Math.hypot(x - nearestX, z - nearestZ);
          const elevationM =
            (start.elevationM ?? 0) +
            ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount;
          if (
            lockToContinuousElevation &&
            preferredElevationM !== null &&
            Math.abs(elevationM - preferredElevationM) > elevationContinuityM
          ) {
            accumulated += lane.segmentLengths[index];
            continue;
          }
          if (distance > minimumDistance + tieEpsilon + 1e-9) {
            accumulated += lane.segmentLengths[index];
            continue;
          }
          const heading = Math.atan2(dx, dz);
          const headingDifference = Math.abs(
            angleDifference(heading, preference.heading),
          );
          const distanceAlong =
            accumulated + lane.segmentLengths[index] * amount;
          const preferred = lane.id === preference.preferredLaneId;
          const preferredLaneDecision =
            best && preferred !== bestPreferred
              ? preferred
                ? distance <= best.distance + preferredLaneHysteresisM
                : distance < best.distance - preferredLaneHysteresisM
              : null;
          if (
            !best ||
            preferredLaneDecision === true ||
            (preferred === bestPreferred &&
              (headingDifference < bestHeadingDifference - 1e-9 ||
                (Math.abs(headingDifference - bestHeadingDifference) <=
                  1e-9 &&
                  (lane.id < best.lane.id ||
                    (lane.id === best.lane.id &&
                      distanceAlong < best.distanceAlong)))))
          ) {
            best = {
              lane,
              distance,
              distanceAlong,
              heading,
              x: nearestX,
              z: nearestZ,
              elevationM,
            };
            bestHeadingDifference = headingDifference;
            bestPreferred = preferred;
          }
          accumulated += lane.segmentLengths[index];
        }
      }
      return best;
    }
    let best: LaneProjection | null = null;
    for (const lane of this.lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.points.length - 1; index += 1) {
        const start = lane.points[index];
        const end = lane.points[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount =
          lengthSquared > Number.EPSILON
            ? clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1)
            : 0;
        const nearestX = start.x + dx * amount;
        const nearestZ = start.z + dz * amount;
        const offsetX = x - nearestX;
        const offsetZ = z - nearestZ;
        const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
        if (!best || distance < best.distance) {
          best = {
            lane,
            distance,
            distanceAlong: accumulated + lane.segmentLengths[index] * amount,
            heading: Math.atan2(dx, dz),
            x: nearestX,
            z: nearestZ,
            elevationM:
              (start.elevationM ?? 0) +
              ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
          };
        }
        accumulated += lane.segmentLengths[index];
      }
    }
    return best;
  }

  areLaneEndpointsContinuous(source: NormalizedLane, target: NormalizedLane): boolean {
    const sourceEnd = source.points[source.points.length - 1];
    const targetStart = target.points[0];
    return distanceSquared(sourceEnd, targetStart) <= 0.5 * 0.5;
  }

  distanceAhead(lane: NormalizedLane, from: number, to: number): number {
    const direct = to - from;
    if (direct >= 0) return direct;
    return lane.loop && this.areLaneEndpointsContinuous(lane, lane)
      ? direct + lane.length
      : Number.POSITIVE_INFINITY;
  }

  routeDistanceAhead(
    fromLane: NormalizedLane,
    fromDistance: number,
    targetLane: NormalizedLane,
    targetDistance: number,
  ): number {
    let lanesVisited = 0;
    if (fromLane.id === targetLane.id) {
      const direct = this.distanceAhead(fromLane, fromDistance, targetDistance);
      this.recordRouteSearch(lanesVisited);
      return direct;
    }
    const queueLanes = this.routeQueueLanes;
    const queueDistances = this.routeQueueDistances;
    const queueDepths = this.routeQueueDepths;
    this.routeSearchGeneration += 1;
    const generation = this.routeSearchGeneration;
    let head = 0;
    let tail = 0;
    for (const successorId of fromLane.successorLaneIds) {
      const successor = this.lanesById.get(successorId);
      if (successor) {
        queueLanes[tail] = successor;
        queueDistances[tail] = fromLane.length - fromDistance;
        queueDepths[tail] = 1;
        tail += 1;
      }
    }
    let result = Number.POSITIVE_INFINITY;
    while (head < tail) {
      const lane = queueLanes[head];
      const distanceToStart = queueDistances[head];
      const depth = queueDepths[head];
      head += 1;
      lanesVisited += 1;
      if (depth > ROUTE_LOOKAHEAD_MAX_HOPS) continue;
      // Nothing asks about a car this far along the route. The depth cap alone
      // bounded the search by *hops*, so on a city with more roads leading out
      // of each junction the same six hops walked several hundred lanes — and
      // TrafficSpatialIndex limits 60 Hz route-leading calls to candidates
      // whose lane topology can reach this branch. Every caller's threshold
      // is a following gap; the largest is a car at top speed wanting its
      // 1.8 s headway, under 62 m. See the note on the constant.
      if (distanceToStart > ROUTE_LOOKAHEAD_LIMIT_M) continue;
      const laneIndex = lane.index!;
      if (
        this.routeVisitedGeneration[laneIndex] === generation &&
        this.routeVisitedBest[laneIndex] <= distanceToStart
      ) {
        continue;
      }
      this.routeVisitedGeneration[laneIndex] = generation;
      this.routeVisitedBest[laneIndex] = distanceToStart;
      if (lane.id === targetLane.id) {
        result = distanceToStart + targetDistance;
        break;
      }
      for (const successorId of lane.successorLaneIds) {
        const successor = this.lanesById.get(successorId);
        if (!successor) continue;
        queueLanes[tail] = successor;
        queueDistances[tail] = distanceToStart + lane.length;
        queueDepths[tail] = depth + 1;
        tail += 1;
      }
    }
    // Drop the lane references so a search burst cannot pin lanes between
    // calls; the number arrays just keep their capacity.
    queueLanes.length = 0;
    this.recordRouteSearch(lanesVisited);
    return result;
  }

  /** `elapsedSeconds` is threaded in rather than owned here: the fixed-step
   * clock belongs to `SimulationCore`, and this stays a pure function of it. */
  trafficLightTiming(
    light: NormalizedTrafficLight,
    elapsedSeconds: number,
  ): { state: TrafficLightState; secondsUntilChange: number } {
    if (light.rail) {
      // A level-crossing head reports plain red/green from the timetable —
      // no amber, matching how real crossing lamps behave. Every consumer
      // already keys railway stop lines on `state !== "green"`.
      const signal = railCrossingSignalAt(
        light.rail.windows,
        light.rail.periodSeconds,
        light.rail.offsetSeconds,
        elapsedSeconds,
      );
      return {
        state: signal.warningActive ? "red" : "green",
        secondsUntilChange: signal.secondsUntilChange,
      };
    }
    const {
      greenSeconds,
      amberSeconds,
      allRedSeconds,
      redSeconds,
      redAmberSeconds,
      offsetSeconds = 0,
      sequence,
    } = light.cycle;
    const effectiveRedAmberSeconds = sequence === "uk" ? redAmberSeconds : 0;
    const duration =
      greenSeconds + amberSeconds + allRedSeconds + redSeconds + effectiveRedAmberSeconds;
    const phase = ((elapsedSeconds + offsetSeconds) % duration + duration) % duration;
    if (phase < greenSeconds) {
      return { state: "green", secondsUntilChange: greenSeconds - phase };
    }
    if (phase < greenSeconds + amberSeconds) {
      return {
        state: "amber",
        secondsUntilChange: greenSeconds + amberSeconds - phase,
      };
    }
    const allRedEnd = greenSeconds + amberSeconds + allRedSeconds;
    if (phase < allRedEnd) {
      return { state: "all_red", secondsUntilChange: allRedEnd - phase };
    }
    const redEnd = allRedEnd + redSeconds;
    if (phase < redEnd || effectiveRedAmberSeconds <= 0) {
      return {
        state: "red",
        secondsUntilChange: effectiveRedAmberSeconds <= 0 ? duration - phase : redEnd - phase,
      };
    }
    return { state: "red_amber", secondsUntilChange: duration - phase };
  }
}
