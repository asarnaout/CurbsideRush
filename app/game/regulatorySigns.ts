/**
 * Regulatory sign placement, derived from the lane graph.
 *
 * Two families live here, sharing one junction model so signage can never
 * disagree with the rules the simulation enforces:
 *
 * - **One-way signage** (US MUTCD). The simulation already fines wrong-way
 *   driving, but the world gave the driver none of the cues a real street
 *   does — so at a junction there was no way to tell a legal turn from a
 *   wrong-way one. ONE WAY blades at every mouth where a one-way road may be
 *   entered, DO NOT ENTER pairs where it may not, and WRONG WAY repeaters
 *   facing down each one-way block, readable only against the flow.
 * - **Speed-limit signage**, on every map. Same idea against the speeding
 *   rule, which now costs money: the limit is the one number the game charges
 *   you for exceeding, so it has to be legible from the road and not only from
 *   the HUD.
 *
 * Lane endpoints sit exactly on shared junction nodes, so incident lane-ends
 * cluster into junction "arms" (per road, per direction). An arm with only
 * departing lanes is an enterable one-way mouth; only arriving lanes, a
 * forbidden one; both, an ordinary two-way road.
 */
import type { TrafficSide, WorldPoint } from "./types";
import {
  elevationOnPolylineAt,
  roadLevelAtElevation,
} from "./roadElevation";

export type RegulatorySignKind = "one_way" | "do_not_enter" | "wrong_way";

export interface RegulatorySignPlacement {
  readonly kind: RegulatorySignKind;
  readonly x: number;
  readonly z: number;
  readonly elevationM?: number;
  /**
   * Heading (rad, 0 = +z north) of legal travel on the arm's road at the
   * sign. DO NOT ENTER / WRONG WAY message faces point along it (into the
   * junction / at the wrong-way driver); ONE WAY arrows point along it.
   */
  readonly flowHeadingRad: number;
  /** Stable id for tests and QA, e.g. "nyc-amsterdam@40,0:dne:l". */
  readonly refId: string;
}

export interface RegulatorySignLaneInput {
  readonly id: string;
  readonly roadId?: string;
  readonly role?: string;
  readonly centerline: readonly WorldPoint[];
  /**
   * Legal next lanes. Regulatory signs use this only to distinguish a real
   * junction mouth from an authoring seam where one one-way road id hands
   * directly to another without offering the driver a choice.
   */
  readonly successors?: readonly string[];
  /** Posted limit on this lane's road, in the host country's own unit. */
  readonly speedLimit?: number;
  readonly trafficSide?: TrafficSide;
}

export interface RegulatorySignSurfaceInput {
  readonly widthM: number;
  readonly laneIds: readonly string[];
  /**
   * The road's own centreline. Optional only so older fixtures still type;
   * without it a sign on a curved road is stationed off the straight chord
   * between junctions, which lands it inside the carriageway.
   */
  readonly centerline?: readonly WorldPoint[];
}

export interface RegulatorySignInput {
  readonly lanes: readonly RegulatorySignLaneInput[];
  readonly roadSurfaces?: readonly RegulatorySignSurfaceInput[];
  /** Carriageway width used when no surface lists an arm's lanes. */
  readonly defaultRoadWidthM: number;
  /**
   * Ground already claimed by authored street furniture — signal heads, their
   * poles, stop and yield posts. Signage is derived and authored controls are
   * not, so a post that would land on one slides down its own kerb rather than
   * the control moving. Omitting these only risks a post sharing a square
   * metre with a signal pole; nothing else reads them.
   */
  readonly occupiedPositions?: readonly WorldPoint[];
}

export type SpeedLimitSignInput = RegulatorySignInput;

export type SpeedLimitSignFamily = "mutcd" | "vienna";

export interface SpeedLimitSignPlacement {
  readonly x: number;
  readonly z: number;
  readonly elevationM?: number;
  /**
   * Heading (rad, 0 = +z north) of legal travel *past* the sign — the driver
   * it is for. The message face looks back along it, which is the opposite of
   * the DO NOT ENTER relation: that one faces the driver coming the wrong way.
   */
  readonly flowHeadingRad: number;
  /** The figure on the blade, in the host country's own unit. */
  readonly limitFigure: number;
  /** The road this sign posts — `LaneSegment.roadId`. */
  readonly roadId: string;
  /** "entry" where the limit changes at this mouth; "repeater" is a reminder. */
  readonly reason: "entry" | "repeater";
  /** Stable id, e.g. "nyc-broadway@-120,-480:limit30:entry". */
  readonly refId: string;
}

/** Longitudinal distance from the junction node to a mouth sign post. */
const MOUTH_OFFSET_M = 10;
/** Posts stand this far past the kerb (carriageway edge), on the sidewalk. */
const KERB_MARGIN_M = 0.9;
/** First WRONG WAY station past a forbidden mouth. */
const WRONG_WAY_NEAR_M = 35;
/** Blocks longer than this also get a mid-block WRONG WAY station. */
const WRONG_WAY_MIDBLOCK_MIN_M = 320;
/** Shared-node tolerance, matching the map's 0.08 m authoring convention. */
const NODE_EPSILON_M = 0.08;
/** A post needs half a metre beyond the asphalt edge to read as kerbside. */
const REGULATORY_SIGN_CARRIAGEWAY_CLEARANCE_M = 0.5;
/** Keep a mouth post far enough from an authored pole to read separately. */
const REGULATORY_SIGN_FURNITURE_CLEARANCE_M = 2.6;
/** A mouth sign may slide this far down its own kerb to find clear ground. */
const REGULATORY_SIGN_MAX_SLIDE_M = 48;
/** Fine-grained enough to clear a crossing carriageway without a large jump. */
const REGULATORY_SIGN_SLIDE_STEP_M = 2;
/** Never station a post exactly on the next lane-graph node. */
const REGULATORY_SIGN_END_MARGIN_M = 2;

/**
 * Limit posts stand further in than mouth signs deliberately, so a SPEED LIMIT
 * plate and a ONE WAY blade never contend for the same kerb station.
 */
const LIMIT_OFFSET_M = 16;
/** Longest run of road a driver may cover without passing a limit sign. */
export const LIMIT_REPEATER_SPACING_M = 480;
/** How straight-on a continuation has to be to count as the same street. */
const LIMIT_CORRIDOR_MIN_DOT = 0.7;
/** Two posts closer than this are one post as far as a driver is concerned. */
const LIMIT_MIN_SEPARATION_M = 4;
/** A post this close to a signal pole reads as bolted to it. */
const LIMIT_FURNITURE_CLEARANCE_M = 2.6;
/** How much further down the kerb a blocked post may be stationed. */
const LIMIT_SLIDE_STEPS_M = [0, 8, 16, 24, 32] as const;

const TWO_PI = Math.PI * 2;

const normalizeRad = (angle: number): number => {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
};

/**
 * Mesh `rotation.y` for a placement. DO NOT ENTER / WRONG WAY carry their
 * message on the box's -Z face, so the mesh faces away from the flow and the
 * -Z normal points along it; ONE WAY blades hang perpendicular, the -Z face
 * reading left-arrow to one side of the road and the +Z face right-arrow to
 * the other.
 */
export function regulatorySignYawRad(
  kind: RegulatorySignKind,
  flowHeadingRad: number,
): number {
  return normalizeRad(
    kind === "one_way" ? flowHeadingRad + Math.PI / 2 : flowHeadingRad + Math.PI,
  );
}

/**
 * Mesh `rotation.y` for a speed-limit sign — the flow heading itself, which is
 * `regulatorySignYawRad`'s message-face answer turned through pi.
 *
 * The two differ because their readers do. A DO NOT ENTER is for the driver
 * coming the wrong way, so its face looks *into* the flow; a limit sign is for
 * the driver obeying it, so its face looks back *down* the flow at them. Same
 * geometry, opposite relation — which is exactly why this is a second function
 * and not a fourth `RegulatorySignKind`.
 */
export function speedLimitSignYawRad(flowHeadingRad: number): number {
  return normalizeRad(flowHeadingRad);
}

/**
 * Which sign design a country posts its limits on. The United States uses the
 * MUTCD R2-1 rectangle; everyone else in the game signs the Vienna Convention
 * disc. Deliberately not derived from `speedUnit`: Britain reads in mph and
 * still posts a red-ringed circle.
 */
export function speedLimitSignFamily(countryId: string): SpeedLimitSignFamily {
  return countryId === "us" ? "mutcd" : "vienna";
}

interface LaneEnd {
  readonly lane: RegulatorySignLaneInput;
  /** True when the lane departs the node (its centerline starts here). */
  readonly departing: boolean;
  /** The lane's opposite endpoint — the far end of the arm. */
  readonly opposite: WorldPoint;
}

const nodeKey = (point: WorldPoint): string =>
  `${Math.round(point.x / NODE_EPSILON_M)}:${Math.round(point.z / NODE_EPSILON_M)}`;

/**
 * True only for a degree-two, successor-linked hand-off between differently
 * named one-way roads. This is the lane-graph definition of an authoring seam:
 * one arriving arm, one departing arm, and no choice in either direction.
 */
const isSuccessorContinuitySeam = (
  position: WorldPoint,
  ends: readonly LaneEnd[],
): boolean => {
  const roadIds = new Set(ends.map((end) => end.lane.roadId ?? end.lane.id));
  if (roadIds.size !== 2) return false;
  const armKeys = new Set(
    ends.map((end) => {
      const bearing = Math.atan2(
        end.opposite.x - position.x,
        end.opposite.z - position.z,
      );
      const bucket = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
      return `${end.lane.roadId ?? end.lane.id}|${bucket}`;
    }),
  );
  if (armKeys.size !== 2) return false;

  const arriving = ends.filter((end) => !end.departing);
  const departing = ends.filter((end) => end.departing);
  if (!arriving.length || !departing.length) return false;
  const arrivingRoads = new Set(
    arriving.map((end) => end.lane.roadId ?? end.lane.id),
  );
  const departingRoads = new Set(
    departing.map((end) => end.lane.roadId ?? end.lane.id),
  );
  if (arrivingRoads.size !== 1 || departingRoads.size !== 1) return false;
  if (arrivingRoads.values().next().value === departingRoads.values().next().value) {
    return false;
  }

  const departingIds = new Set(departing.map((end) => end.lane.id));
  return (
    arriving.every((end) =>
      (end.lane.successors ?? []).some((id) => departingIds.has(id)),
    ) &&
    departing.every((end) =>
      arriving.some((arrival) =>
        (arrival.lane.successors ?? []).includes(end.lane.id),
      ),
    )
  );
};

const distanceToPolyline = (
  point: WorldPoint,
  polyline: readonly WorldPoint[],
): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq),
        )
      : 0;
    best = Math.min(
      best,
      Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)),
    );
  }
  return best;
};

/** Bearing octants, indexed the way the arm bucket counts them. */
const COMPASS_POINTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

/**
 * One road at one junction, in one direction: the cluster of lane ends that a
 * driver would call "the street going that way from here".
 */
interface JunctionArm {
  /** Stable and unique, so a sweep over arms can be ordered deterministically. */
  readonly id: string;
  readonly nodeKey: string;
  /** The junction node the arm leaves from. */
  readonly position: WorldPoint;
  readonly roadId: string;
  readonly ends: readonly LaneEnd[];
  readonly departing: boolean;
  readonly arriving: boolean;
  readonly farPoint: WorldPoint;
  readonly lengthM: number;
  /**
   * Physical walk away through same-road segments and successor-linked
   * road-id hand-offs. Unlike `lengthM`, it may span authoring-only seams.
   */
  readonly regulatoryPath: readonly WorldPoint[];
  readonly regulatoryLengthM: number;
  /** Unit chord from the node toward the far end. */
  readonly ux: number;
  readonly uz: number;
  readonly headingRad: number;
  /** Octant of the bearing to the far end, 0 = north, stepping clockwise. */
  readonly bucket: number;
  readonly widthM: number;
  readonly speedLimit?: number;
  readonly trafficSide: TrafficSide;
  readonly surfaceCenterline?: readonly WorldPoint[];
}

interface JunctionModel {
  readonly nodesByKey: ReadonlyMap<
    string,
    { readonly position: WorldPoint; readonly arms: readonly JunctionArm[] }
  >;
  readonly arms: readonly JunctionArm[];
}

/**
 * Clusters lane ends into junction arms. Both sign families read this; the
 * one-way family skips every node a roundabout touches (rings are one-way by
 * construction and carry their own conventions), while the limit family does
 * not — a roundabout's approach arms are ordinary roads and must be signable.
 * Roundabout *lanes* are excluded either way.
 */
function buildJunctionModel(
  input: RegulatorySignInput,
  options: { readonly skipRoundaboutNodes: boolean },
): JunctionModel {
  const lanesById = new Map(input.lanes.map((lane) => [lane.id, lane]));
  const predecessorsByLaneId = new Map<string, RegulatorySignLaneInput[]>();
  for (const lane of input.lanes) {
    for (const successorId of lane.successors ?? []) {
      const predecessors = predecessorsByLaneId.get(successorId);
      if (predecessors) predecessors.push(lane);
      else predecessorsByLaneId.set(successorId, [lane]);
    }
  }
  const nodes = new Map<string, { position: WorldPoint; ends: LaneEnd[] }>();
  const addEnd = (position: WorldPoint, end: LaneEnd) => {
    const key = nodeKey(position);
    const existing = nodes.get(key);
    if (existing) existing.ends.push(end);
    else nodes.set(key, { position, ends: [end] });
  };
  const roundaboutNodes = new Set<string>();
  for (const lane of input.lanes) {
    if (lane.role !== "roundabout" || lane.centerline.length < 2) continue;
    roundaboutNodes.add(nodeKey(lane.centerline[0]));
    roundaboutNodes.add(nodeKey(lane.centerline[lane.centerline.length - 1]));
  }
  for (const lane of input.lanes) {
    if (lane.role === "roundabout") continue;
    if (lane.centerline.length < 2) continue;
    const start = lane.centerline[0];
    const end = lane.centerline[lane.centerline.length - 1];
    if (nodeKey(start) === nodeKey(end)) continue; // self-loop
    const skip = options.skipRoundaboutNodes;
    if (!skip || !roundaboutNodes.has(nodeKey(start))) {
      addEnd(start, { lane, departing: true, opposite: end });
    }
    if (!skip || !roundaboutNodes.has(nodeKey(end))) {
      addEnd(end, { lane, departing: false, opposite: start });
    }
  }

  const polylineLength = (points: readonly WorldPoint[]): number => {
    let lengthM = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      lengthM += Math.hypot(
        points[index + 1].x - points[index].x,
        points[index + 1].z - points[index].z,
      );
    }
    return lengthM;
  };

  /**
   * Follow the reference lane physically away from its junction, crossing
   * same-road lane seams and successor-linked degree-two road-id hand-offs.
   * Any node that offers a branch or crossing remains a hard stationing
   * boundary, so a post can never slide through a real junction.
   */
  const regulatoryPathFor = (reference: LaneEnd): readonly WorldPoint[] => {
    const orientAway = (
      lane: RegulatorySignLaneInput,
    ): readonly WorldPoint[] =>
      reference.departing ? lane.centerline : [...lane.centerline].reverse();
    const path = [...orientAway(reference.lane)];
    let cursor = reference.lane;
    const visited = new Set<string>([cursor.id]);

    while (path.length >= 2) {
      const seam = path[path.length - 1];
      const seamEnds = nodes.get(nodeKey(seam))?.ends ?? [];
      const cursorRoadId = cursor.roadId ?? cursor.id;
      const roadIdsAtSeam = new Set(
        seamEnds.map((end) => end.lane.roadId ?? end.lane.id),
      );
      const successorContinuity = isSuccessorContinuitySeam(seam, seamEnds);
      if (roadIdsAtSeam.size > 1 && !successorContinuity) break;

      const candidates = (
        reference.departing
          ? (cursor.successors ?? [])
              .map((id) => lanesById.get(id))
              .filter(
                (lane): lane is RegulatorySignLaneInput => lane !== undefined,
              )
          : (predecessorsByLaneId.get(cursor.id) ?? [])
      ).filter(
        (lane) =>
          !visited.has(lane.id) &&
          ((lane.roadId ?? lane.id) === cursorRoadId || successorContinuity) &&
          lane.centerline.length >= 2,
      );

      const previous = path[path.length - 2];
      const previousDx = seam.x - previous.x;
      const previousDz = seam.z - previous.z;
      const previousLength = Math.hypot(previousDx, previousDz);
      let best:
        | { readonly lane: RegulatorySignLaneInput; readonly points: readonly WorldPoint[] }
        | undefined;
      let bestDot = Number.NEGATIVE_INFINITY;
      for (const lane of candidates) {
        const points = orientAway(lane);
        if (nodeKey(points[0]) !== nodeKey(seam)) continue;
        const nextDx = points[1].x - points[0].x;
        const nextDz = points[1].z - points[0].z;
        const nextLength = Math.hypot(nextDx, nextDz);
        const dot =
          previousLength > 0 && nextLength > 0
            ? (previousDx * nextDx + previousDz * nextDz) /
              (previousLength * nextLength)
            : -1;
        if (
          dot > bestDot ||
          (dot === bestDot && best && lane.id.localeCompare(best.lane.id) < 0)
        ) {
          best = { lane, points };
          bestDot = dot;
        }
      }
      if (!best) break;
      visited.add(best.lane.id);
      cursor = best.lane;
      path.push(...best.points.slice(1));
    }
    return path;
  };

  const surfaceFor = (
    ends: readonly LaneEnd[],
  ): RegulatorySignSurfaceInput | undefined =>
    (input.roadSurfaces ?? []).find((surface) =>
      ends.some((end) => surface.laneIds.includes(end.lane.id)),
    );

  const nodesByKey = new Map<
    string,
    { position: WorldPoint; arms: JunctionArm[] }
  >();
  const arms: JunctionArm[] = [];
  for (const [key, node] of nodes) {
    const buckets = new Map<string, LaneEnd[]>();
    for (const end of node.ends) {
      const bearing = Math.atan2(
        end.opposite.x - node.position.x,
        end.opposite.z - node.position.z,
      );
      // Bucket by the direction to the far endpoint — exact for straight
      // arms, and immune to the connector blend's local tilt near the node.
      const bucket = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
      const bucketKey = `${end.lane.roadId ?? end.lane.id}|${bucket}`;
      const existing = buckets.get(bucketKey);
      if (existing) existing.push(end);
      else buckets.set(bucketKey, [end]);
    }
    const nodeArms: JunctionArm[] = [];
    for (const [bucketKey, ends] of buckets) {
      const bucket = Number(bucketKey.slice(bucketKey.lastIndexOf("|") + 1));
      const sorted = [...ends].sort((a, b) => a.lane.id.localeCompare(b.lane.id));
      const reference = sorted[0];
      const dx = reference.opposite.x - node.position.x;
      const dz = reference.opposite.z - node.position.z;
      const lengthM = Math.hypot(dx, dz);
      if (lengthM <= 0) continue;
      const surface = surfaceFor(sorted);
      const regulatoryPath = regulatoryPathFor(reference);
      const arm: JunctionArm = {
        id: `${key}|${bucketKey}`,
        nodeKey: key,
        position: node.position,
        roadId: reference.lane.roadId ?? reference.lane.id,
        ends: sorted,
        departing: sorted.some((end) => end.departing),
        arriving: sorted.some((end) => !end.departing),
        farPoint: reference.opposite,
        lengthM,
        regulatoryPath,
        regulatoryLengthM: polylineLength(regulatoryPath),
        ux: dx / lengthM,
        uz: dz / lengthM,
        headingRad: Math.atan2(dx / lengthM, dz / lengthM),
        bucket,
        widthM: surface?.widthM ?? input.defaultRoadWidthM,
        speedLimit: reference.lane.speedLimit,
        trafficSide: reference.lane.trafficSide ?? "right",
        surfaceCenterline: surface?.centerline,
      };
      nodeArms.push(arm);
      arms.push(arm);
    }
    nodesByKey.set(key, { position: node.position, arms: nodeArms });
  }
  return { nodesByKey, arms };
}

export function regulatorySignPlacements(
  input: RegulatorySignInput,
): readonly RegulatorySignPlacement[] {
  const model = buildJunctionModel(input, { skipRoundaboutNodes: true });
  const placements: RegulatorySignPlacement[] = [];
  for (const node of model.nodesByKey.values()) {
    // Mouth signs only make sense where roads actually meet — a mid-road
    // node linking two blocks of the same road offers no turn to warn about.
    const roadIds = new Set(node.arms.map((arm) => arm.roadId));
    if (roadIds.size < 2) continue;

    // Generated ramps deliberately change road ids where a ground-level slip
    // lane hands to its elevated continuation (and back again on exits). That
    // degree-two seam is not a junction: there is exactly one legal movement
    // and the player cannot choose another road. Successors are the authority
    // here, so a sharp but continuous ramp still stays free of contradictory
    // ONE WAY / DO NOT ENTER clutter while a real two-road mouth remains
    // signed even when its geometry happens to be straight.
    if (
      isSuccessorContinuitySeam(
        node.position,
        node.arms.flatMap((arm) => arm.ends),
      )
    ) {
      continue;
    }

    for (const arm of node.arms) {
      if (arm.departing === arm.arriving) continue; // two-way — no signs
      const lateral = arm.widthM / 2 + KERB_MARGIN_M;
      const nodeRef = `${arm.roadId}@${Math.round(node.position.x * 10) / 10},${Math.round(node.position.z * 10) / 10}`;
      const post = (
        kind: RegulatorySignKind,
        preferredDistanceM: number,
        suffix: string,
      ) => {
        for (const side of [-1, 1] as const) {
          const maxStationM =
            arm.regulatoryLengthM - REGULATORY_SIGN_END_MARGIN_M;
          if (maxStationM <= 0) continue;
          const firstStationM = Math.min(preferredDistanceM, maxStationM);
          const lastStationM = Math.min(
            maxStationM,
            preferredDistanceM + REGULATORY_SIGN_MAX_SLIDE_M,
          );
          for (
            let distanceM = firstStationM;
            distanceM <= lastStationM + 1e-6;
            distanceM += REGULATORY_SIGN_SLIDE_STEP_M
          ) {
            const toward = arm.regulatoryPath[1] ?? arm.farPoint;
            const station =
              stationAlongSurface(
                arm.surfaceCenterline,
                arm.position,
                toward,
                distanceM,
                false,
              ) ?? stationAlongPolyline(arm.regulatoryPath, distanceM);
            if (!station) break;
            // The walked tangent points physically away from the junction.
            // Arriving-only arms carry legal traffic in the reverse direction.
            const awayHeading = Math.atan2(station.tx, station.tz);
            const flowHeadingRad = normalizeRad(
              arm.departing ? awayHeading : awayHeading + Math.PI,
            );
            // Right normal of the local arm tangent; each side searches its
            // own kerb independently so one blocked post never costs its mate.
            const candidate = {
              kind,
              x: station.x + Math.cos(awayHeading) * lateral * side,
              z: station.z - Math.sin(awayHeading) * lateral * side,
              elevationM: station.elevationM,
              flowHeadingRad,
              refId: `${nodeRef}:${suffix}:${side < 0 ? "l" : "r"}`,
            } satisfies RegulatorySignPlacement;
            const intrudesOnCarriageway = (input.roadSurfaces ?? []).some(
              (surface) =>
                surface.centerline &&
                roadLevelAtElevation(candidate.elevationM ?? 0) ===
                  roadLevelAtElevation(
                    elevationOnPolylineAt(
                      surface.centerline,
                      candidate.x,
                      candidate.z,
                    ),
                  ) &&
                distanceToPolyline(candidate, surface.centerline) <
                  surface.widthM / 2 +
                    REGULATORY_SIGN_CARRIAGEWAY_CLEARANCE_M,
            );
            const intrudesOnFurniture = (input.occupiedPositions ?? []).some(
              (item) =>
                roadLevelAtElevation(item.elevationM ?? 0) ===
                  roadLevelAtElevation(candidate.elevationM ?? 0) &&
                Math.hypot(item.x - candidate.x, item.z - candidate.z) <
                  REGULATORY_SIGN_FURNITURE_CLEARANCE_M,
            );
            if (intrudesOnCarriageway || intrudesOnFurniture) continue;
            placements.push(candidate);
            break;
          }
        }
      };
      if (arm.departing) {
        // Enterable one-way mouth: blades tell cross traffic the only legal
        // direction, which here points away from the junction.
        post("one_way", MOUTH_OFFSET_M, "oneway");
        continue;
      }
      // Forbidden mouth: flow arrives along the arm, so legal travel at the
      // mouth points INTO the junction — and so do the message faces.
      post("do_not_enter", MOUTH_OFFSET_M, "dne");
      post("wrong_way", WRONG_WAY_NEAR_M, `ww${WRONG_WAY_NEAR_M}`);
      if (arm.regulatoryLengthM > WRONG_WAY_MIDBLOCK_MIN_M) {
        const midBlock = Math.round(arm.regulatoryLengthM / 2);
        post("wrong_way", arm.regulatoryLengthM / 2, `ww${midBlock}`);
      }
    }
  }
  return placements.sort((a, b) => a.refId.localeCompare(b.refId));
}

interface Station {
  readonly x: number;
  readonly z: number;
  readonly elevationM: number;
  /** Unit tangent, pointing the way the walk went. */
  readonly tx: number;
  readonly tz: number;
}

/** Point and tangent at an arc-length station on an already oriented path. */
function stationAlongPolyline(
  path: readonly WorldPoint[],
  distanceM: number,
): Station | null {
  if (path.length < 2 || distanceM < 0) return null;
  let travelled = 0;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segment = Math.hypot(dx, dz);
    if (segment <= 0) continue;
    if (distanceM <= travelled + segment || index + 2 === path.length) {
      const t = Math.max(0, Math.min(1, (distanceM - travelled) / segment));
      return {
        x: a.x + dx * t,
        z: a.z + dz * t,
        elevationM:
          (a.elevationM ?? 0) +
          ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * t,
        tx: dx / segment,
        tz: dz / segment,
      };
    }
    travelled += segment;
  }
  return null;
}

/** Arc length along `centerline` of the point on it closest to `point`. */
function arcLengthNearest(
  centerline: readonly WorldPoint[],
  point: WorldPoint,
): number {
  let travelled = 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < centerline.length; index += 1) {
    const a = centerline[index];
    const b = centerline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq),
        )
      : 0;
    const distance = Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = travelled + Math.sqrt(lengthSq) * t;
    }
    travelled += Math.sqrt(lengthSq);
  }
  return best;
}

/**
 * The point and unit tangent `distanceM` of arc length along a road's own
 * centreline, starting where `from` sits on it and walking toward `toward`.
 *
 * Stationing off the straight chord between junctions instead is what puts a
 * post inside the carriageway on every curved road: measured 0.8 m into
 * Cromwell Road, 2.8 m into `fr-north-west-road` and 0.6 m into
 * `jp-east-curve`. Following the road fixes all three to the kerb margin.
 */
function stationAlongSurface(
  centerline: readonly WorldPoint[] | undefined,
  from: WorldPoint,
  toward: WorldPoint,
  distanceM: number,
  clampToSurface = true,
): Station | null {
  if (!centerline || centerline.length < 2) return null;
  const start = arcLengthNearest(centerline, from);
  const forward = arcLengthNearest(centerline, toward) >= start;
  const target = start + (forward ? distanceM : -distanceM);
  if (!clampToSurface) {
    let totalLengthM = 0;
    for (let index = 0; index + 1 < centerline.length; index += 1) {
      totalLengthM += Math.hypot(
        centerline[index + 1].x - centerline[index].x,
        centerline[index + 1].z - centerline[index].z,
      );
    }
    if (target < 0 || target > totalLengthM) return null;
  }
  let travelled = 0;
  for (let index = 0; index + 1 < centerline.length; index += 1) {
    const a = centerline[index];
    const b = centerline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segment = Math.hypot(dx, dz);
    if (segment <= 0) continue;
    if (target <= travelled + segment || index + 2 === centerline.length) {
      const t = Math.max(0, Math.min(1, (target - travelled) / segment));
      const sign = forward ? 1 : -1;
      return {
        x: a.x + dx * t,
        z: a.z + dz * t,
        elevationM:
          (a.elevationM ?? 0) +
          ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * t,
        tx: (dx / segment) * sign,
        tz: (dz / segment) * sign,
      };
    }
    travelled += segment;
  }
  return null;
}

/**
 * Where every map posts its speed limits.
 *
 * Three rules, in order. **Entry**: a road earns a sign at a mouth where the
 * limit differs from a road arriving at that junction — signs mark changes,
 * which is both how real signage works and what keeps a checkerboard grid from
 * sprouting a post at every corner. **Repeater**: consecutive same-limit arms
 * chain into corridors (crossing a `roadId` boundary where the geometry runs
 * on, which is what merges Cromwell Road's three surfaces into the one street
 * a driver perceives), and a corridor gets a reminder whenever the run since
 * its last sign would exceed `LIMIT_REPEATER_SPACING_M`. **Floor**: a corridor
 * that earned nothing at all gets one at its first arm.
 *
 * The floor is not a nicety — it is what makes "every map" true. London posts
 * one limit everywhere, so an entry-only rule leaves the whole city silent.
 *
 * Together they give the invariant that answers a mid-road spawn: no legal
 * drive longer than `LIMIT_REPEATER_SPACING_M` passes zero signs, because
 * corridors are same-limit by construction, so leaving one always crosses a
 * change, and a change is always an entry sign.
 */
export function speedLimitSignPlacements(
  input: SpeedLimitSignInput,
): readonly SpeedLimitSignPlacement[] {
  const model = buildJunctionModel(input, { skipRoundaboutNodes: false });
  const signed = new Map<string, "entry" | "repeater">();
  const usable = (arm: JunctionArm): boolean =>
    arm.departing &&
    arm.speedLimit !== undefined &&
    arm.lengthM >= LIMIT_OFFSET_M * 2;

  for (const node of model.nodesByKey.values()) {
    if (new Set(node.arms.map((arm) => arm.roadId)).size < 2) continue;
    for (const arm of node.arms) {
      if (!usable(arm)) continue;
      const changes = node.arms.some(
        (other) =>
          other.roadId !== arm.roadId &&
          other.arriving &&
          other.speedLimit !== undefined &&
          other.speedLimit !== arm.speedLimit,
      );
      if (changes) signed.set(arm.id, "entry");
    }
  }

  // The straightest same-limit continuation at an arm's far node, or null.
  const nextArm = (arm: JunctionArm): JunctionArm | null => {
    const node = model.nodesByKey.get(nodeKey(arm.farPoint));
    if (!node) return null;
    let best: JunctionArm | null = null;
    let bestDot = LIMIT_CORRIDOR_MIN_DOT;
    for (const candidate of node.arms) {
      if (!usable(candidate)) continue;
      if (candidate.speedLimit !== arm.speedLimit) continue;
      const dot = candidate.ux * arm.ux + candidate.uz * arm.uz;
      if (dot > bestDot) {
        bestDot = dot;
        best = candidate;
      }
    }
    return best;
  };

  const eligible = model.arms
    .filter(usable)
    .sort((a, b) => a.id.localeCompare(b.id));
  const hasPredecessor = new Set<string>();
  for (const arm of eligible) {
    const next = nextArm(arm);
    if (next) hasPredecessor.add(next.id);
  }
  const visited = new Set<string>();
  const walk = (start: JunctionArm) => {
    const chain: JunctionArm[] = [];
    let cursor: JunctionArm | null = start;
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      chain.push(cursor);
      cursor = nextArm(cursor);
    }
    let gap = 0;
    for (const arm of chain) {
      if (signed.has(arm.id)) {
        gap = arm.lengthM;
        continue;
      }
      if (gap + arm.lengthM > LIMIT_REPEATER_SPACING_M) {
        signed.set(arm.id, "repeater");
        gap = arm.lengthM;
      } else {
        gap += arm.lengthM;
      }
    }
    if (chain.length && !chain.some((arm) => signed.has(arm.id))) {
      signed.set(chain[0].id, "repeater");
    }
  };
  for (const arm of eligible) {
    if (!hasPredecessor.has(arm.id)) walk(arm);
  }
  // Whatever is left is a closed loop with no entry point.
  for (const arm of eligible) {
    if (!visited.has(arm.id)) walk(arm);
  }

  const occupied = input.occupiedPositions ?? [];
  const placements: SpeedLimitSignPlacement[] = [];
  for (const arm of eligible) {
    const reason = signed.get(arm.id);
    if (!reason) continue;
    // Station at LIMIT_OFFSET_M, then further down the same kerb if authored
    // furniture or an adjacent slip lane already stands there. Both ends are
    // bounded by the arm so a post cannot walk into the next junction. A
    // floor sign may be omitted only when every station is physically invalid;
    // retaining an invalid fallback would put the post in live traffic.
    let posted: {
      x: number;
      z: number;
      heading: number;
      elevationM: number;
    } | null = null;
    for (const slide of LIMIT_SLIDE_STEPS_M) {
      const offset = LIMIT_OFFSET_M + slide;
      if (slide > 0 && offset > arm.lengthM - LIMIT_OFFSET_M) break;
      const station =
        stationAlongSurface(
          arm.surfaceCenterline,
          arm.position,
          arm.farPoint,
          offset,
        ) ??
        ({
          x: arm.position.x + arm.ux * offset,
          z: arm.position.z + arm.uz * offset,
          elevationM:
            (arm.position.elevationM ?? 0) +
            ((arm.farPoint.elevationM ?? 0) -
              (arm.position.elevationM ?? 0)) *
              Math.max(0, Math.min(1, offset / arm.lengthM)),
          tx: arm.ux,
          tz: arm.uz,
        } satisfies Station);
      // Read the heading off the local tangent, not the chord: on a curve they
      // differ by enough to swing the post across the road.
      const heading = Math.atan2(station.tx, station.tz);
      const side = arm.trafficSide === "left" ? -1 : 1;
      const lateral = arm.widthM / 2 + KERB_MARGIN_M;
      const candidate = {
        x: station.x + Math.cos(heading) * lateral * side,
        z: station.z - Math.sin(heading) * lateral * side,
        elevationM: station.elevationM,
        heading,
      };
      const intrudesOnCarriageway = (input.roadSurfaces ?? []).some(
        (surface) =>
          surface.centerline &&
          roadLevelAtElevation(candidate.elevationM) ===
            roadLevelAtElevation(
              elevationOnPolylineAt(
                surface.centerline,
                candidate.x,
                candidate.z,
              ),
            ) &&
          distanceToPolyline(candidate, surface.centerline) <
            surface.widthM / 2 + REGULATORY_SIGN_CARRIAGEWAY_CLEARANCE_M,
      );
      if (
        !intrudesOnCarriageway &&
        occupied.every(
          (item) =>
            roadLevelAtElevation(item.elevationM ?? 0) !==
              roadLevelAtElevation(candidate.elevationM) ||
            Math.hypot(item.x - candidate.x, item.z - candidate.z) >=
              LIMIT_FURNITURE_CLEARANCE_M,
        )
      ) {
        posted = candidate;
        break;
      }
    }
    if (!posted) continue;
    const { x, z, heading, elevationM } = posted;
    // Two roads that continue each other can both open a corridor at one node
    // and land their floor signs on the same square metre.
    if (
      placements.some(
        (other) => Math.hypot(other.x - x, other.z - z) < LIMIT_MIN_SEPARATION_M,
      )
    ) {
      continue;
    }
    placements.push({
      x,
      z,
      elevationM,
      flowHeadingRad: normalizeRad(heading),
      limitFigure: arm.speedLimit!,
      roadId: arm.roadId,
      reason,
      // The compass point is load-bearing, not decoration: a two-way road at
      // one junction has an arm leaving each way, each with its own sign on
      // its own kerb, and without a direction the two share an id.
      refId: `${arm.roadId}@${Math.round(arm.position.x * 10) / 10},${Math.round(arm.position.z * 10) / 10}:${COMPASS_POINTS[arm.bucket]}:limit${arm.speedLimit}:${reason}`,
    });
  }
  return placements.sort((a, b) => a.refId.localeCompare(b.refId));
}
