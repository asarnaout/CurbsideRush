import type { LaneNode, LaneSegment, RoadSurface, WorldPoint } from "../types";
import { offsetOpenRoadPolyline, sampleOpenRoadCurve } from "../geometry/openRoadCurve";

/**
 * Four-lane Queensview crossing plus four paired RHT access sites. Surface,
 * lane, node, and elevation paths are emitted together so rendering,
 * collision, routing, NPC traffic, and the minimap share one authored source.
 */
export const NYC_QUEENSVIEW_NETWORK_PREFIX = "nyc-queensview-";
export const NYC_QUEENSVIEW_DECK_ELEVATION_M = 11.5;
export const NYC_QUEENSVIEW_MAX_GRADE = 0.08;
export const NYC_QUEENSVIEW_MAX_CHORD_M = 7.5;
export const NYC_QUEENSVIEW_MAX_HEADING_STEP_DEG = 5;
const NYC_QUEENSVIEW_AUTHORED_CHORD_M = 4;

export interface NycQueensviewAccessMovement {
  readonly hostRoadId: string;
  /** Grid lane that is split to create the ramp mouth. */
  readonly sourceHostLaneId: string;
  /** Host lane that physically arrives at an entry mouth or leaves an exit mouth. */
  readonly hostLaneId: string;
  readonly mouthNodeId: string;
  readonly highNodeId: string;
  readonly slipSurfaceId: string;
  readonly rampSurfaceId: string;
  readonly rampLaneId: string;
  readonly direction: "eastbound" | "westbound" | "northbound" | "southbound";
  readonly crossedSurfaceRoadIds: readonly string[];
}

export interface NycQueensviewAccessSite {
  readonly id: "manhattan-65th" | "manhattan-third" | "queens-vernon" | "queens-40th";
  readonly hostRoadId: string;
  readonly entry: NycQueensviewAccessMovement;
  readonly exit: NycQueensviewAccessMovement;
}

const accessMovement = (
  siteId: NycQueensviewAccessSite["id"],
  kind: "entry" | "exit",
  hostRoadId: string,
  hostLaneId: string,
  direction: NycQueensviewAccessMovement["direction"],
  crossedSurfaceRoadIds: readonly string[],
): NycQueensviewAccessMovement => {
  const mouthNodeId = `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-${kind}-mouth`;
  return {
    hostRoadId,
    sourceHostLaneId: hostLaneId,
    hostLaneId: kind === "entry" ? `${mouthNodeId}-host` : hostLaneId,
    mouthNodeId,
    highNodeId: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-${kind}-high`,
    slipSurfaceId: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-${kind}-slip`,
    rampSurfaceId: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-${kind}-ramp`,
    rampLaneId: `${NYC_QUEENSVIEW_NETWORK_PREFIX}${siteId}-${kind}-ramp-lane`,
    direction,
    crossedSurfaceRoadIds,
  };
};

export const NYC_QUEENSVIEW_ACCESS_SITES: readonly NycQueensviewAccessSite[] = [
  {
    id: "manhattan-65th",
    hostRoadId: "nyc-west-65",
    entry: accessMovement("manhattan-65th", "entry", "nyc-west-65", "nyc-65-e-mad", "eastbound", ["nyc-park-ave", "nyc-lexington"]),
    exit: accessMovement("manhattan-65th", "exit", "nyc-west-65", "nyc-65-w-pk", "westbound", ["nyc-park-ave", "nyc-lexington"]),
  },
  {
    id: "manhattan-third",
    hostRoadId: "nyc-third",
    entry: accessMovement("manhattan-third", "entry", "nyc-third", "nyc-third-n-e61", "northbound", ["nyc-west-65"]),
    exit: accessMovement("manhattan-third", "exit", "nyc-third", "nyc-third-n-65", "northbound", []),
  },
  {
    id: "queens-vernon",
    hostRoadId: "nyc-vernon",
    entry: accessMovement("queens-vernon", "entry", "nyc-vernon", "nyc-vern-n-bk40", "northbound", []),
    exit: accessMovement("queens-vernon", "exit", "nyc-vernon", "nyc-vern-s-bk44", "southbound", []),
  },
  {
    id: "queens-40th",
    hostRoadId: "nyc-bank-40",
    entry: accessMovement("queens-40th", "entry", "nyc-bank-40", "nyc-bk40-w-cres", "westbound", []),
    exit: accessMovement("queens-40th", "exit", "nyc-bank-40", "nyc-bk40-e-vern", "eastbound", []),
  },
] as const;

export interface NycElevatedRoadNetworkInput {
  readonly nodes: readonly LaneNode[];
  readonly lanes: readonly LaneSegment[];
  readonly roadSurfaces: readonly RoadSurface[];
  readonly roadNames: Readonly<Record<string, string>>;
}

export interface NycElevatedRoadNetworkBuild extends NycElevatedRoadNetworkInput {
  readonly elevatedSurfaceIds: readonly string[];
  readonly accessSites: readonly NycQueensviewAccessSite[];
  readonly hostLaneSplits: readonly {
    readonly sourceLaneId: string;
    readonly beforeLaneId: string;
    readonly distanceAlongM: number;
  }[];
}

const p = (x: number, z: number, elevationM = 0): WorldPoint => ({ x, z, elevationM });
const n = (id: string, position: WorldPoint): LaneNode => ({ id, position });

const profiledPath = (
  plan: readonly WorldPoint[],
  startElevationM: number,
  endElevationM: number,
  startPlateauM = 0,
  endPlateauM = 0,
): readonly WorldPoint[] => {
  const chordLengths = plan.slice(1).map((point, index) =>
    Math.hypot(point.x - plan[index].x, point.z - plan[index].z),
  );
  const totalLengthM = chordLengths.reduce((sum, length) => sum + length, 0);
  const profiledLengthM = Math.max(0, totalLengthM - startPlateauM - endPlateauM);
  const transitionLengthM = Math.min(28, profiledLengthM / 3);
  const steadyLengthM = profiledLengthM - 2 * transitionLengthM;
  const elevationDeltaM = endElevationM - startElevationM;
  const steadyGrade = profiledLengthM > transitionLengthM
    ? elevationDeltaM / (profiledLengthM - transitionLengthM)
    : 0;
  let distanceM = 0;
  return plan.map((point, index) => {
    if (index > 0) distanceM += chordLengths[index - 1];
    const profiledDistanceM = Math.max(
      0,
      Math.min(profiledLengthM, distanceM - startPlateauM),
    );
    let elevationDeltaAtDistanceM: number;
    if (profiledDistanceM <= transitionLengthM) {
      elevationDeltaAtDistanceM =
        transitionLengthM > 0
          ? (steadyGrade * profiledDistanceM * profiledDistanceM) /
            (2 * transitionLengthM)
          : 0;
    } else if (profiledDistanceM < transitionLengthM + steadyLengthM) {
      elevationDeltaAtDistanceM =
        steadyGrade * (profiledDistanceM - transitionLengthM / 2);
    } else {
      const remainingM = profiledLengthM - profiledDistanceM;
      elevationDeltaAtDistanceM =
        elevationDeltaM -
        (transitionLengthM > 0
          ? (steadyGrade * remainingM * remainingM) / (2 * transitionLengthM)
          : 0);
    }
    return p(point.x, point.z, startElevationM + elevationDeltaAtDistanceM);
  });
};

const cubicPlan = (
  start: WorldPoint,
  control1: WorldPoint,
  control2: WorldPoint,
  end: WorldPoint,
  steps: number,
): readonly WorldPoint[] =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const amount = index / steps;
    const inverse = 1 - amount;
    return p(
      inverse * inverse * inverse * start.x +
        3 * inverse * inverse * amount * control1.x +
        3 * inverse * amount * amount * control2.x +
        amount * amount * amount * end.x,
      inverse * inverse * inverse * start.z +
        3 * inverse * inverse * amount * control1.z +
        3 * inverse * amount * amount * control2.z +
        amount * amount * amount * end.z,
    );
  });

const arcPlan = (
  center: WorldPoint,
  radiusM: number,
  startAngleRad: number,
  endAngleRad: number,
  steps: number,
): readonly WorldPoint[] =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const amount = index / steps;
    const angle = startAngleRad + (endAngleRad - startAngleRad) * amount;
    return p(
      center.x + Math.cos(angle) * radiusM,
      center.z + Math.sin(angle) * radiusM,
    );
  });

const linePlan = (
  start: WorldPoint,
  end: WorldPoint,
): readonly WorldPoint[] => {
  const lengthM = Math.hypot(end.x - start.x, end.z - start.z);
  const steps = Math.max(1, Math.ceil(lengthM / NYC_QUEENSVIEW_AUTHORED_CHORD_M));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const amount = index / steps;
    return p(
      start.x + (end.x - start.x) * amount,
      start.z + (end.z - start.z) * amount,
    );
  });
};

const vernonEntryRampPath = (): readonly WorldPoint[] => {
  const approach = linePlan(p(812, -970), p(815, -799.75));
  const hook = arcPlan(p(850, -799.75), 35, Math.PI, -Math.PI / 2, 72);
  return profiledPath([...approach, ...hook.slice(1)], 0, NYC_QUEENSVIEW_DECK_ELEVATION_M);
};

const vernonExitRampPath = (): readonly WorldPoint[] => {
  // Leave the outer bridge lane on a compact but motorway-safe radius. The
  // former R60 turn remained inside the parent deck's full van envelope for
  // almost twenty metres, so the diverging roadway was physically blocked
  // even though its one-sided collar was topologically open.
  const turn = arcPlan(p(730, -869.45), 24.2, Math.PI / 2, 0, 24);
  const descent = cubicPlan(
    turn.at(-1)!,
    p(754.2, -915),
    p(780, -970),
    p(780, -1010),
    40,
  );
  return profiledPath(
    [...turn, ...descent.slice(1)],
    NYC_QUEENSVIEW_DECK_ELEVATION_M,
    0,
  );
};

const q40EntryRampPath = (): readonly WorldPoint[] => {
  const groundTurn = arcPlan(p(870, -1033), 35, -Math.PI / 2, -Math.PI, 24);
  const northbound = linePlan(groundTurn.at(-1)!, p(835, -819));
  const upperTurn = arcPlan(p(870, -819), 35, Math.PI, Math.PI / 2, 24);
  const upperRun = linePlan(upperTurn.at(-1)!, p(980, -782.25));
  const terminalLoop = arcPlan(
    p(980, -810.25),
    28,
    Math.PI / 2,
    -Math.PI / 2,
    48,
  );
  const plan = [
    ...groundTurn,
    ...northbound.slice(1),
    ...upperTurn.slice(1),
    ...upperRun.slice(1),
    ...terminalLoop.slice(1),
  ];
  // Stay on the ground until the loop is north of the opposing descending
  // ramp; their one plan crossing then has full grade-separated clearance.
  return profiledPath(plan, 0, NYC_QUEENSVIEW_DECK_ELEVATION_M, 155);
};

const q40ExitRampPath = (): readonly WorldPoint[] => {
  const highTurn = arcPlan(p(980, -866.75), 25, Math.PI / 2, 0, 24);
  const sweep = cubicPlan(
    highTurn.at(-1)!,
    p(1005, -965),
    p(815, -957),
    p(815, -1057),
    100,
  );
  const landingTurn = arcPlan(p(865, -1057), 50, Math.PI, 3 * Math.PI / 2, 30);
  // Carry the vertical profile beyond the Bank 40th crossing before handing
  // off to the flat merge. This extra tangent gives a delivery van full roof
  // clearance beneath the descending slab without sharpening the grade.
  const touchdown = linePlan(landingTurn.at(-1)!, p(873, -1107));
  return profiledPath(
    [
      ...highTurn,
      ...sweep.slice(1),
      ...landingTurn.slice(1),
      ...touchdown.slice(1),
    ],
    NYC_QUEENSVIEW_DECK_ELEVATION_M,
    0,
    230,
  );
};

const curve = (
  points: readonly WorldPoint[],
  start: WorldPoint,
  end: WorldPoint,
  handleRatio = 0.48,
): readonly WorldPoint[] => {
  const sampledGeometry = sampleOpenRoadCurve(points, {
    handleRatio,
    tangentOverrides: {
      0: { x: start.x, z: start.z },
      [points.length - 1]: { x: end.x, z: end.z },
    },
    maximumChordM: NYC_QUEENSVIEW_AUTHORED_CHORD_M,
    maximumHeadingStepDeg: NYC_QUEENSVIEW_MAX_HEADING_STEP_DEG,
  });
  const segmentLengths = sampledGeometry.segments.map((segment) =>
    segment.slice(1).reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - segment[index].x, point.z - segment[index].z),
      0,
    ),
  );
  const elevations = points.map((point) => point.elevationM ?? 0);
  const secantGrades = segmentLengths.map((length, index) =>
    length > 0 ? (elevations[index + 1] - elevations[index]) / length : 0,
  );
  // A shape-preserving cubic grade profile keeps every authored clearance
  // plateau exact while sharing one tangent across adjacent spans. Per-span
  // smoothstep would flatten at every plan knot, producing a succession of
  // vertical kinks even though the horizontal spline is C1-continuous.
  const knotGrades = elevations.map((_, index) => {
    if (index === 0 || index === elevations.length - 1) return 0;
    const before = secantGrades[index - 1];
    const after = secantGrades[index];
    if (before === 0 || after === 0 || before * after <= 0) return 0;
    const beforeLength = segmentLengths[index - 1];
    const afterLength = segmentLengths[index];
    const beforeWeight = 2 * afterLength + beforeLength;
    const afterWeight = afterLength + 2 * beforeLength;
    return (beforeWeight + afterWeight) /
      (beforeWeight / before + afterWeight / after);
  });
  const graded: WorldPoint[] = [];
  for (const [segmentIndex, segment] of sampledGeometry.segments.entries()) {
    const lengths = segment.slice(1).map((point, index) =>
      Math.hypot(point.x - segment[index].x, point.z - segment[index].z),
    );
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let distance = 0;
    const startElevationM = elevations[segmentIndex];
    const endElevationM = elevations[segmentIndex + 1];
    const startGrade = knotGrades[segmentIndex];
    const endGrade = knotGrades[segmentIndex + 1];
    const span = segment.map((point, index) => {
      if (index > 0) distance += lengths[index - 1];
      const amount = total > 0 ? distance / total : 0;
      const amountSquared = amount * amount;
      const amountCubed = amountSquared * amount;
      const startWeight = 2 * amountCubed - 3 * amountSquared + 1;
      const startGradeWeight = amountCubed - 2 * amountSquared + amount;
      const endWeight = -2 * amountCubed + 3 * amountSquared;
      const endGradeWeight = amountCubed - amountSquared;
      const elevationM =
        startElevationM === endElevationM && startGrade === 0 && endGrade === 0
          ? startElevationM
          : startWeight * startElevationM +
            startGradeWeight * total * startGrade +
            endWeight * endElevationM +
            endGradeWeight * total * endGrade;
      return p(
        point.x,
        point.z,
        elevationM,
      );
    });
    graded.push(...(segmentIndex === 0 ? span : span.slice(1)));
  }
  const dense: WorldPoint[] = [graded[0]];
  for (let index = 1; index < graded.length; index += 1) {
    const a = graded[index - 1];
    const b = graded[index];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const pieces = Math.max(1, Math.ceil(length / NYC_QUEENSVIEW_AUTHORED_CHORD_M));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const amount = piece / pieces;
      dense.push(p(
        a.x + (b.x - a.x) * amount,
        a.z + (b.z - a.z) * amount,
        (a.elevationM ?? 0) + ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * amount,
      ));
    }
  }
  return dense;
};

const lane = (
  id: string,
  roadId: string,
  from: LaneNode,
  to: LaneNode,
  centerline: readonly WorldPoint[],
  successors: readonly string[],
  role: LaneSegment["role"] = "entry",
  adjacentLaneIds?: readonly string[],
): LaneSegment => ({
  id,
  roadId,
  widthM: 3.5,
  from: from.id,
  to: to.id,
  centerline,
  role,
  trafficSide: "right",
  speedLimit: roadId === "nyc-queensview-bridge" ? 40 : 25,
  successors,
  ...(adjacentLaneIds ? { adjacentLaneIds } : {}),
});

const surface = (
  id: string,
  centerline: readonly WorldPoint[],
  laneIds: readonly string[],
  widthM: number,
  elevated = true,
): RoadSurface => ({
  id,
  centerline,
  widthM,
  ...(elevated ? { parapetDepthM: 0.36 } : {}),
  sidewalkWidthM: elevated ? 0 : 1.4,
  laneIds,
  surfaceType: "standard",
  markings: [],
});

interface Projection {
  readonly point: WorldPoint;
  readonly segmentIndex: number;
  readonly amount: number;
  readonly distanceAlongM: number;
}

const projectToLane = (centerline: readonly WorldPoint[], target: WorldPoint): Projection => {
  let best: Projection | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let accumulated = 0;
  for (let index = 0; index + 1 < centerline.length; index += 1) {
    const a = centerline[index];
    const b = centerline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const amount = lengthSq > 0
      ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / lengthSq))
      : 0;
    const point = p(
      a.x + dx * amount,
      a.z + dz * amount,
      (a.elevationM ?? 0) + ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * amount,
    );
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        point,
        segmentIndex: index,
        amount,
        distanceAlongM: accumulated + Math.sqrt(lengthSq) * amount,
      };
    }
    accumulated += Math.sqrt(lengthSq);
  }
  if (!best) throw new Error("Cannot split a lane with fewer than two points");
  return best;
};

const splitHostLane = (
  lanes: LaneSegment[],
  surfaces: RoadSurface[],
  nodes: LaneNode[],
  movement: NycQueensviewAccessMovement,
  target: WorldPoint,
  branchLaneId?: string,
): { readonly sourceLaneId: string; readonly beforeLaneId: string; readonly distanceAlongM: number } => {
  const laneIndex = lanes.findIndex((candidate) => candidate.id === movement.sourceHostLaneId);
  if (laneIndex < 0) throw new Error(`Queensview access references missing host lane ${movement.sourceHostLaneId}`);
  const host = lanes[laneIndex];
  const projection = projectToLane(host.centerline, target);
  const mouth = n(movement.mouthNodeId, projection.point);
  const beforeId = `${movement.mouthNodeId}-host`;
  const beforePoints = [...host.centerline.slice(0, projection.segmentIndex + 1), projection.point];
  const afterPoints = [projection.point, ...host.centerline.slice(projection.segmentIndex + 1)];
  const beforeRanges = host.connectorRanges?.filter(
    (range) => range.endDistanceAlongM <= projection.distanceAlongM + 1e-6,
  );
  const afterRanges = host.connectorRanges
    ?.filter((range) => range.startDistanceAlongM >= projection.distanceAlongM - 1e-6)
    .map((range) => ({
      ...range,
      startDistanceAlongM: range.startDistanceAlongM - projection.distanceAlongM,
      endDistanceAlongM: range.endDistanceAlongM - projection.distanceAlongM,
    }));
  const before: LaneSegment = {
    ...host,
    id: beforeId,
    to: mouth.id,
    centerline: beforePoints,
    successors: [host.id, ...(branchLaneId ? [branchLaneId] : [])],
    connectorRanges: beforeRanges,
  };
  const after: LaneSegment = {
    ...host,
    from: mouth.id,
    centerline: afterPoints,
    connectorRanges: afterRanges,
  };
  lanes.splice(laneIndex, 1, before, after);
  for (let index = 0; index < lanes.length; index += 1) {
    if (lanes[index].id === before.id || lanes[index].id === after.id) continue;
    if (!lanes[index].successors.includes(host.id)) continue;
    lanes[index] = {
      ...lanes[index],
      successors: lanes[index].successors.map((id) => id === host.id ? before.id : id),
    };
  }
  for (let index = 0; index < surfaces.length; index += 1) {
    if (!surfaces[index].laneIds.includes(host.id)) continue;
    surfaces[index] = {
      ...surfaces[index],
      laneIds: surfaces[index].laneIds.flatMap((id) => id === host.id ? [before.id, host.id] : [id]),
    };
  }
  nodes.push(mouth);
  return {
    sourceLaneId: movement.sourceHostLaneId,
    beforeLaneId: before.id,
    distanceAlongM: projection.distanceAlongM,
  };
};

const MAIN_ROAD_ID = "nyc-queensview-bridge";
const mainXs = [360, 510, 570, 730, 850, 930] as const;
const mainKeys = ["west", "third-exit", "third-entry", "vernon-exit", "vernon-entry", "east"] as const;
const mainLaneId = (direction: "eb" | "wb", side: "inner" | "outer", from: string, to: string) =>
  `${NYC_QUEENSVIEW_NETWORK_PREFIX}main-${direction}-${side}-${from}-${to}`;

const movementFor = (site: NycQueensviewAccessSite["id"], kind: "entry" | "exit") => {
  const access = NYC_QUEENSVIEW_ACCESS_SITES.find((candidate) => candidate.id === site)!;
  return access[kind];
};

export function buildNycElevatedRoadNetwork(input: NycElevatedRoadNetworkInput): NycElevatedRoadNetworkBuild {
  const nodes = [...input.nodes];
  const lanes = [...input.lanes];
  const roadSurfaces = [...input.roadSurfaces];
  const networkNodes: LaneNode[] = [];
  const networkLanes: LaneSegment[] = [];
  const networkSurfaces: RoadSurface[] = [];
  const hostLaneSplits: NycElevatedRoadNetworkBuild["hostLaneSplits"][number][] = [];
  const high = NYC_QUEENSVIEW_DECK_ELEVATION_M;

  const nodeGrid = new Map<string, LaneNode>();
  const outerHighIds = new Map<string, string>([
    ["eb-west", movementFor("manhattan-65th", "entry").highNodeId],
    ["wb-west", movementFor("manhattan-65th", "exit").highNodeId],
    ["wb-third-exit", movementFor("manhattan-third", "exit").highNodeId],
    ["eb-third-entry", movementFor("manhattan-third", "entry").highNodeId],
    ["eb-vernon-exit", movementFor("queens-vernon", "exit").highNodeId],
    ["wb-vernon-entry", movementFor("queens-vernon", "entry").highNodeId],
  ]);
  for (let index = 0; index < mainXs.length; index += 1) {
    for (const [direction, offsets] of [["eb", [-1.75, -5.25]], ["wb", [1.75, 5.25]]] as const) {
      for (const [sideIndex, side] of (["inner", "outer"] as const).entries()) {
        const key = `${direction}-${mainKeys[index]}`;
        const id = side === "outer" && outerHighIds.has(key)
          ? outerHighIds.get(key)!
          : `${NYC_QUEENSVIEW_NETWORK_PREFIX}main-${direction}-${side}-${mainKeys[index]}-node`;
        // The narrow east carrier needs a terminal fan, but Manhattan's
        // outer travel lanes stay at their real offsets so both ramp mouths
        // meet their routing nodes and the deck edge through one-sided collars.
        const terminalFan = side === "outer" && index === mainXs.length - 1;
        const built = n(
          id,
          p(
            mainXs[index],
            terminalFan ? -840 + offsets[0] : -840 + offsets[sideIndex],
            high,
          ),
        );
        nodeGrid.set(`${direction}-${side}-${index}`, built);
        networkNodes.push(built);
      }
    }
  }
  // Each pair of same-direction mainline lanes funnels to one carrier lane,
  // but the eastbound and westbound fan nodes remain a full lane apart. A
  // coincident opposing pair here would make a nominal two-way carrier into
  // one head-on centreline even though its eight-metre surface looked valid.
  const eastEbInner = nodeGrid.get(`eb-inner-${mainXs.length - 1}`)!;
  const eastEbOuter = nodeGrid.get(`eb-outer-${mainXs.length - 1}`)!;
  nodeGrid.set(`eb-inner-${mainXs.length - 1}`, eastEbOuter);
  networkNodes.splice(networkNodes.indexOf(eastEbInner), 1);
  const eastWbInner = nodeGrid.get(`wb-inner-${mainXs.length - 1}`)!;
  const eastWbOuter = nodeGrid.get(`wb-outer-${mainXs.length - 1}`)!;
  nodeGrid.set(`wb-inner-${mainXs.length - 1}`, eastWbOuter);
  networkNodes.splice(networkNodes.indexOf(eastWbInner), 1);
  const westEbInner = nodeGrid.get("eb-inner-0")!;
  const westEbOuter = nodeGrid.get("eb-outer-0")!;
  nodeGrid.set("eb-inner-0", westEbOuter);
  networkNodes.splice(networkNodes.indexOf(westEbInner), 1);
  const westWbInner = nodeGrid.get("wb-inner-0")!;
  const westWbOuter = nodeGrid.get("wb-outer-0")!;
  nodeGrid.set("wb-inner-0", westWbOuter);
  networkNodes.splice(networkNodes.indexOf(westWbInner), 1);

  const rampId = (site: NycQueensviewAccessSite["id"], kind: "entry" | "exit") => movementFor(site, kind).rampLaneId;
  const ebOuterIds = mainXs.slice(1).map((_, index) => mainLaneId("eb", "outer", mainKeys[index], mainKeys[index + 1]));
  const ebInnerIds = mainXs.slice(1).map((_, index) => mainLaneId("eb", "inner", mainKeys[index], mainKeys[index + 1]));
  const wbOuterIds = mainXs.slice(1).map((_, reverseIndex) => {
    const index = mainXs.length - 1 - reverseIndex;
    return mainLaneId("wb", "outer", mainKeys[index], mainKeys[index - 1]);
  });
  const wbInnerIds = mainXs.slice(1).map((_, reverseIndex) => {
    const index = mainXs.length - 1 - reverseIndex;
    return mainLaneId("wb", "inner", mainKeys[index], mainKeys[index - 1]);
  });
  const mainPath = (
    direction: "eb" | "wb",
    side: "inner" | "outer",
    segmentIndex: number,
    from: LaneNode,
    to: LaneNode,
  ): readonly WorldPoint[] => {
    const regularZ = direction === "eb"
      ? side === "inner" ? -841.75 : -845.25
      : side === "inner" ? -838.25 : -834.75;
    const terminalSegment = mainXs.length - 2;
    // The west inner lanes fan between the two-lane mainline and their
    // one-lane ramp throats. Author the two directions as mirrored monotone
    // cubics: a multi-knot cardinal spline overshot both regular offsets near
    // x=394, squeezing opposing lane centres below a vehicle width even
    // though both endpoints were correctly separated.
    if (side === "inner" && direction === "eb" && segmentIndex === 0) {
      const fanEnd = p(375, regularZ, high);
      const fan = cubicPlan(
        from.position,
        p(367.5, from.position.z, high),
        p(367.5, regularZ, high),
        fanEnd,
        16,
      ).map((point) => p(point.x, point.z, high));
      const run = linePlan(fanEnd, to.position).map((point) =>
        p(point.x, point.z, high));
      return [...fan, ...run.slice(1)];
    }
    if (
      side === "inner" &&
      direction === "wb" &&
      segmentIndex === terminalSegment
    ) {
      const fanStart = p(375, regularZ, high);
      const run = linePlan(from.position, fanStart).map((point) =>
        p(point.x, point.z, high));
      const fan = cubicPlan(
        fanStart,
        p(367.5, regularZ, high),
        p(367.5, to.position.z, high),
        to.position,
        16,
      ).map((point) => p(point.x, point.z, high));
      return [...run, ...fan.slice(1)];
    }
    const points = direction === "eb"
      ? segmentIndex === 0
        ? [from.position, p(370, regularZ, high), to.position]
        : segmentIndex === terminalSegment
          ? [from.position, p(920, regularZ, high), to.position]
          : [from.position, to.position]
      : segmentIndex === 0
        ? [from.position, p(920, regularZ, high), to.position]
        : segmentIndex === terminalSegment
          ? [from.position, p(370, regularZ, high), to.position]
          : [from.position, to.position];
    return curve(points, direction === "eb" ? p(1, 0) : p(-1, 0), direction === "eb" ? p(1, 0) : p(-1, 0));
  };

  for (let index = 0; index + 1 < mainXs.length; index += 1) {
    const outerFrom = nodeGrid.get(`eb-outer-${index}`)!;
    const outerTo = nodeGrid.get(`eb-outer-${index + 1}`)!;
    const innerFrom = nodeGrid.get(`eb-inner-${index}`)!;
    const innerTo = index === mainXs.length - 2 ? outerTo : nodeGrid.get(`eb-inner-${index + 1}`)!;
    const outerSuccessors = index === mainXs.length - 2
      ? [`${NYC_QUEENSVIEW_NETWORK_PREFIX}east-carrier-eb-lane`]
      : [ebOuterIds[index + 1], ...(index === 2 ? [rampId("queens-vernon", "exit")] : [])];
    networkLanes.push(
      lane(ebOuterIds[index], MAIN_ROAD_ID, outerFrom, outerTo, mainPath("eb", "outer", index, outerFrom, outerTo), outerSuccessors, "travel", [ebInnerIds[index]]),
      lane(ebInnerIds[index], MAIN_ROAD_ID, innerFrom, innerTo, mainPath("eb", "inner", index, innerFrom, innerTo), index === mainXs.length - 2 ? [`${NYC_QUEENSVIEW_NETWORK_PREFIX}east-carrier-eb-lane`] : [ebInnerIds[index + 1]], "passing", [ebOuterIds[index]]),
    );
  }
  for (let reverseIndex = 0; reverseIndex + 1 < mainXs.length; reverseIndex += 1) {
    const fromIndex = mainXs.length - 1 - reverseIndex;
    const toIndex = fromIndex - 1;
    const outerFrom = nodeGrid.get(`wb-outer-${fromIndex}`)!;
    const outerTo = nodeGrid.get(`wb-outer-${toIndex}`)!;
    const innerFrom = nodeGrid.get(`wb-inner-${fromIndex}`)!;
    const innerTo = toIndex === 0 ? outerTo : nodeGrid.get(`wb-inner-${toIndex}`)!;
    const outerSuccessors = toIndex === 0
      ? [rampId("manhattan-65th", "exit")]
      : [wbOuterIds[reverseIndex + 1], ...(toIndex === 1 ? [rampId("manhattan-third", "exit")] : [])];
    networkLanes.push(
      lane(wbOuterIds[reverseIndex], MAIN_ROAD_ID, outerFrom, outerTo, mainPath("wb", "outer", reverseIndex, outerFrom, outerTo), outerSuccessors, "travel", [wbInnerIds[reverseIndex]]),
      lane(wbInnerIds[reverseIndex], MAIN_ROAD_ID, innerFrom, innerTo, mainPath("wb", "inner", reverseIndex, innerFrom, innerTo), toIndex === 0 ? [rampId("manhattan-65th", "exit")] : [wbInnerIds[reverseIndex + 1]], "passing", [wbOuterIds[reverseIndex]]),
    );
  }

  const mainSurfacePoints = curve(mainXs.map((x) => p(x, -840, high)), p(1, 0), p(1, 0));
  networkSurfaces.push({
    ...surface(MAIN_ROAD_ID, mainSurfacePoints, [...ebOuterIds, ...ebInnerIds, ...wbOuterIds, ...wbInnerIds], 15.2),
    markings: [
      { id: `${MAIN_ROAD_ID}-centre`, style: "centre_solid", points: mainSurfacePoints, color: "yellow" },
      { id: `${MAIN_ROAD_ID}-eb-lane`, style: "lane_dashed", points: offsetOpenRoadPolyline(mainSurfacePoints, -3.5), color: "white" },
      { id: `${MAIN_ROAD_ID}-wb-lane`, style: "lane_dashed", points: offsetOpenRoadPolyline(mainSurfacePoints, 3.5), color: "white" },
    ],
  });

  const carrierId = `${NYC_QUEENSVIEW_NETWORK_PREFIX}east-carrier`;
  const carrierEbId = `${carrierId}-eb-lane`;
  const carrierWbId = `${carrierId}-wb-lane`;
  const mainEbEast = nodeGrid.get(`eb-outer-${mainXs.length - 1}`)!;
  const mainWbEast = nodeGrid.get(`wb-outer-${mainXs.length - 1}`)!;
  const carrierEntryTerminal = p(980, -838.25, high);
  const carrierExitTerminal = p(980, -841.75, high);
  const q40EntryHigh = n(
    movementFor("queens-40th", "entry").highNodeId,
    carrierEntryTerminal,
  );
  const q40ExitHigh = n(
    movementFor("queens-40th", "exit").highNodeId,
    carrierExitTerminal,
  );
  networkNodes.push(q40EntryHigh, q40ExitHigh);
  const carrierPath = curve(
    [p(930, -840, high), p(980, -840, high)],
    p(1, 0),
    p(1, 0),
  );
  const carrierEbPath = curve(
    [mainEbEast.position, carrierExitTerminal],
    p(1, 0),
    p(1, 0),
  );
  const carrierWbPath = curve(
    [carrierEntryTerminal, mainWbEast.position],
    p(-1, 0),
    p(-1, 0),
  );
  networkLanes.push(
    lane(carrierEbId, carrierId, mainEbEast, q40ExitHigh, carrierEbPath, [rampId("queens-40th", "exit")], "connector", [carrierWbId]),
    lane(carrierWbId, carrierId, q40EntryHigh, mainWbEast, carrierWbPath, [wbOuterIds[0], wbInnerIds[0]], "connector", [carrierEbId]),
  );
  networkSurfaces.push({
    ...surface(carrierId, carrierPath, [carrierEbId, carrierWbId], 8),
    markings: [
      {
        id: `${carrierId}-centre`,
        style: "centre_solid",
        points: carrierPath,
        color: "yellow",
      },
    ],
  });

  const accessGeometry: Record<NycQueensviewAccessSite["id"], {
    entryMouth: WorldPoint; entrySlipEnd: WorldPoint; entryKnots: readonly WorldPoint[]; entryStart: WorldPoint; entryEnd: WorldPoint; entrySuccessor: string;
    exitMouth: WorldPoint; exitSlipStart: WorldPoint; exitKnots: readonly WorldPoint[]; exitStart: WorldPoint; exitEnd: WorldPoint;
  }> = {
    "manhattan-65th": {
      entryMouth: p(40, -965), entrySlipEnd: p(74, -971), entryKnots: [p(74, -971), p(120, -985, 1.8), p(170, -1010, 5), p(225, -995, 6.5), p(270, -955, 8.5), p(300, -905, 10.5), p(360, -845.25, high)], entryStart: p(1, 0), entryEnd: p(1, 0), entrySuccessor: ebOuterIds[0],
      exitMouth: p(20, -955), exitSlipStart: p(80, -940), exitKnots: [p(360, -834.75, high), p(300, -820, high), p(240, -835, 9.5), p(200, -870, 7.5), p(160, -910, 4.4), p(80, -940)], exitStart: p(-1, 0), exitEnd: p(-1, 0),
    },
    "manhattan-third": {
      entryMouth: p(445, -1110), entrySlipEnd: p(451, -1065), entryKnots: [p(451, -1065), p(455, -1045), p(465, -990, 2.8), p(485, -940, 5.5), p(520, -895, 8.5), p(570, -845.25, high)], entryStart: p(0, 1), entryEnd: p(1, 0), entrySuccessor: ebOuterIds[2],
      exitMouth: p(445, -540), exitSlipStart: p(470, -620), exitKnots: [p(510, -834.75, high), p(487.04, -830.18, high), p(467.57, -817.18, 10.9), p(454.57, -797.71, 9.5), p(450, -774.75, 8), p(460, -700, 4.7), p(470, -620)], exitStart: p(-1, 0), exitEnd: p(0, 1),
    },
    "queens-vernon": {
      entryMouth: p(805, -1010), entrySlipEnd: p(812, -970), entryKnots: [p(812, -970), p(820, -940), p(850, -915, 2), p(890, -910, 5.5), p(910, -894.75, 7), p(905.43, -871.79, 8.5), p(892.43, -852.32, 9.7), p(872.96, -839.32, 10.9), p(850, -834.75, high)], entryStart: p(0, 1), entryEnd: p(-1, 0), entrySuccessor: wbOuterIds[1],
      exitMouth: p(795, -1070), exitSlipStart: p(780, -1010), exitKnots: [p(730, -845.25, high), p(780, -1010)], exitStart: p(1, 0), exitEnd: p(0, -1),
    },
    "queens-40th": {
      entryMouth: p(940, -1075), entrySlipEnd: p(870, -1068), entryKnots: [p(870, -1068), carrierEntryTerminal], entryStart: p(-1, 0), entryEnd: p(-1, 0), entrySuccessor: carrierWbId,
      exitMouth: p(930, -1085), exitSlipStart: p(873, -1107), exitKnots: [carrierExitTerminal, p(873, -1107)], exitStart: p(1, 0), exitEnd: p(1, 0),
    },
  };

  for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
    const geometry = accessGeometry[site.id];
    const entrySlipLaneId = `${site.entry.slipSurfaceId}-lane`;
    hostLaneSplits.push(
      splitHostLane(lanes, roadSurfaces, nodes, site.entry, geometry.entryMouth, entrySlipLaneId),
      splitHostLane(lanes, roadSurfaces, nodes, site.exit, geometry.exitMouth),
    );
    const entryMouth = nodes.find((candidate) => candidate.id === site.entry.mouthNodeId)!;
    const exitMouth = nodes.find((candidate) => candidate.id === site.exit.mouthNodeId)!;
    const entryTransition = n(`${site.entry.rampSurfaceId}-ground-node`, p(geometry.entrySlipEnd.x, geometry.entrySlipEnd.z));
    const exitTransition = n(`${site.exit.rampSurfaceId}-ground-node`, p(geometry.exitSlipStart.x, geometry.exitSlipStart.z));
    const entryHigh = networkNodes.find((candidate) => candidate.id === site.entry.highNodeId)!;
    const exitHigh = networkNodes.find((candidate) => candidate.id === site.exit.highNodeId)!;
    networkNodes.push(entryTransition, exitTransition);
    const entrySlipPath = curve([entryMouth.position, entryTransition.position], geometry.entryStart, geometry.entryStart);
    const entryRampPath = site.id === "queens-vernon"
      ? vernonEntryRampPath()
      : site.id === "queens-40th"
        ? q40EntryRampPath()
        : curve(geometry.entryKnots, geometry.entryStart, geometry.entryEnd);
    const exitRampPath = site.id === "queens-vernon"
      ? vernonExitRampPath()
      : site.id === "queens-40th"
        ? q40ExitRampPath()
        : curve(geometry.exitKnots, geometry.exitStart, geometry.exitEnd);
    const exitSlipPath = curve([exitTransition.position, exitMouth.position], geometry.exitEnd, geometry.exitEnd);
    const exitSlipLaneId = `${site.exit.slipSurfaceId}-lane`;
    const entrySuccessors = site.id === "manhattan-65th"
      ? [geometry.entrySuccessor, ebInnerIds[0]]
      : [geometry.entrySuccessor];
    networkLanes.push(
      lane(entrySlipLaneId, site.entry.slipSurfaceId, entryMouth, entryTransition, entrySlipPath, [site.entry.rampLaneId], "entry"),
      lane(site.entry.rampLaneId, site.entry.rampSurfaceId, entryTransition, entryHigh, entryRampPath, entrySuccessors, "entry"),
      lane(site.exit.rampLaneId, site.exit.rampSurfaceId, exitHigh, exitTransition, exitRampPath, [exitSlipLaneId], "exit"),
      lane(exitSlipLaneId, site.exit.slipSurfaceId, exitTransition, exitMouth, exitSlipPath, [site.exit.hostLaneId], "exit"),
    );
    networkSurfaces.push(
      surface(site.entry.slipSurfaceId, entrySlipPath, [entrySlipLaneId], 5.8, false),
      surface(site.entry.rampSurfaceId, entryRampPath, [site.entry.rampLaneId], 5.8),
      surface(site.exit.rampSurfaceId, exitRampPath, [site.exit.rampLaneId], 5.8),
      surface(site.exit.slipSurfaceId, exitSlipPath, [exitSlipLaneId], 5.8, false),
    );
  }

  nodes.push(...networkNodes);
  lanes.push(...networkLanes);
  roadSurfaces.push(...networkSurfaces);
  return {
    nodes,
    lanes,
    roadSurfaces,
    roadNames: {
      ...input.roadNames,
      [MAIN_ROAD_ID]: "Queensview Bridge",
      ...Object.fromEntries(networkSurfaces.filter((candidate) => candidate.id !== MAIN_ROAD_ID).map((candidate) => [candidate.id, "Queensview Interchange"])),
    },
    elevatedSurfaceIds: networkSurfaces
      .filter((candidate) => candidate.parapetDepthM !== undefined)
      .map((candidate) => candidate.id),
    accessSites: NYC_QUEENSVIEW_ACCESS_SITES,
    hostLaneSplits,
  };
}
