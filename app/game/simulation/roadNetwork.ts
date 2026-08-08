import type { SimulationPoint, SimulationPose, SimulationBounds, TurnSignal } from "../simulation";
import { clamp, distanceSquared } from "./mathUtils";

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
  /** Position in RoadNetwork.lanes, stamped in the constructor — lets hot
   * paths key typed arrays by lane without a map lookup. */
  index?: number;
}

export interface NormalizedTrafficLight extends SimulationPoint {
  id: string;
  phaseGroup: string;
  cycle: TrafficLightCycle;
}

export interface LaneProjection {
  lane: NormalizedLane;
  distance: number;
  distanceAlong: number;
  heading: number;
  x: number;
  z: number;
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
const ROUTE_LOOKAHEAD_LIMIT_M = 240;

function normalizeLane(lane: SimulationLane): NormalizedLane {
  const points = lane.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    .map((point) => ({ x: point.x, z: point.z }));
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
  return {
    id: lane.id,
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

function normalizeTrafficLight(light: TrafficLightDefinition): NormalizedTrafficLight {
  return {
    id: light.id,
    phaseGroup: light.phaseGroup ?? light.id,
    x: light.x,
    z: light.z,
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

  // routeDistanceAhead scratch. The search runs for every pair of cars,
  // every step (~61k/s at 32 cars) and used to allocate a queue array, a
  // visited Map and a node literal per pushed lane — over a million
  // short-lived objects a second, pure GC feed. The queue is now three
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

  constructor(
    lanes: readonly SimulationLane[],
    trafficLights: readonly TrafficLightDefinition[],
    stopLines: readonly StopLineDefinition[],
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
    }
    this.conflictApproachLaneIds = buildConflictApproachLaneIds(this.lanes);

    this.trafficLights = trafficLights.map(normalizeTrafficLight);
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
        return {
          x: start.x + (end.x - start.x) * clamp(amount, 0, 1),
          z: start.z + (end.z - start.z) * clamp(amount, 0, 1),
          heading: Math.atan2(end.x - start.x, end.z - start.z),
        };
      }
      accumulated += segmentLength;
    }
    const final = lane.points[lane.points.length - 1];
    return { x: final.x, z: final.z, heading: 0 };
  }

  projectToRoad(x: number, z: number): LaneProjection | null {
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
    if (fromLane.id === targetLane.id) {
      return this.distanceAhead(fromLane, fromDistance, targetDistance);
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
      if (depth > 6) continue;
      // Nothing asks about a car this far along the route. The depth cap alone
      // bounded the search by *hops*, so on a city with more roads leading out
      // of each junction the same six hops walked several hundred lanes — and
      // this runs for every pair of cars, every step. Every caller's threshold
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
    return result;
  }

  /** `elapsedSeconds` is threaded in rather than owned here: the fixed-step
   * clock belongs to `SimulationCore`, and this stays a pure function of it. */
  trafficLightTiming(
    light: NormalizedTrafficLight,
    elapsedSeconds: number,
  ): { state: TrafficLightState; secondsUntilChange: number } {
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
