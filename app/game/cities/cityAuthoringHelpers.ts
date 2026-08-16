import type {
  ConflictZone,
  FrozenMapSource,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapSpawnPoint,
  RoadMarkingPath,
  RoadMarkingStyle,
  RoadSurface,
  RoadSurfaceType,
  SpeedUnit,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  TrafficSide,
  WorldPoint,
} from "../types";
import { buildLaneTrueGeometry } from "../laneConnectors";

/**
 * Authoring helpers shared by `cities/nyc.ts`, `cities/tokyo.ts` and
 * `cities/london.ts` (issue #287). Until this module existed, each of the
 * three carried its own byte-identical (or near-identical) copy of every
 * function below — verified byte-identical to the original source at the
 * decomposition program's extraction time, but duplication drifts: a bugfix
 * or a new field to one city's copy has no way to reach the others.
 *
 * `cities/cairo.ts` has its own structurally different road-spec generator and
 * is not part of this cluster; `cities/london.ts` grew one of the same shape
 * beside its hand-authored quarter, but still imports the primitives below for
 * that quarter. London lacks `roadIdForLane`,
 * `laneWidthForLane`, `conflictZoneForNode`, `laneTrue` and `osmSource`'s
 * exact shape (different lane-width rule, hardcoded left-hand `trafficSide`,
 * no `localSpeedUnit`) — those stay NYC/Tokyo-only here; forcing London onto
 * the same shapes would change what it generates, not just where the code
 * lives. `makeSpeedLimitForRoad` is the exception: all three cities' own
 * per-road tables are structurally `Record<string, number>` regardless of
 * how narrowly each declares its literal, so all three share it.
 *
 * `laneTrue` and `osmSource` close over one per-file value each
 * (`speedLimitForRoad`, the reviewed-on date) that only NYC and Tokyo happen
 * to want in the same shape — `makeLaneTrue`/`makeOsmSource` take that value
 * once and return the exact original function, so every existing call site
 * in both files (NYC's single grid-builder call; Tokyo's 56 hand-authored
 * ones) is unchanged, unaware its implementation now lives here.
 */

export const point = (x: number, z: number): WorldPoint => ({ x, z });

export const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

export const distanceBetweenPoints = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

export const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

export const roadMarking = (
  id: string,
  style: RoadMarkingStyle,
  points: readonly WorldPoint[],
  color?: RoadMarkingPath["color"],
): RoadMarkingPath => ({ id, style, points, ...(color ? { color } : {}) });

export const roadSurface = (
  id: string,
  centerline: readonly WorldPoint[],
  widthM: number,
  laneIds: readonly string[],
  surfaceType: RoadSurfaceType = "standard",
  markings: readonly RoadMarkingPath[] = [],
): RoadSurface => ({
  id,
  centerline,
  widthM,
  laneIds,
  surfaceType,
  markings,
});

export const anchoredSpawn = (
  id: string,
  kind: "player" | "vehicle",
  laneId: string,
  distanceAlongM: number,
): MapSpawnPoint => ({
  id,
  kind,
  anchor: anchor(laneId, distanceAlongM),
});

export const freeSpawn = (
  id: string,
  kind: "pedestrian" | "cyclist",
  x: number,
  z: number,
  headingDeg: number,
  laneId?: string,
): MapSpawnPoint => ({
  id,
  kind,
  pose: { position: point(x, z), headingDeg },
  ...(laneId ? { laneId } : {}),
});

export const approach = (
  id: string,
  laneId: string,
  distanceAlongM: number,
  phaseGroup: string,
  conflictZoneIds?: readonly string[],
): TrafficControlApproach => ({
  id,
  laneIds: [laneId],
  stopLine: anchor(laneId, distanceAlongM),
  phaseGroup,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
});

export const installation = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
  mounting: TrafficControlInstallation["mounting"],
  style: TrafficControlInstallation["style"],
  role: TrafficControlInstallation["role"],
  approachIds?: readonly string[],
  armHeadingDeg?: number,
): TrafficControlInstallation => ({
  id,
  position: point(x, z),
  headingDeg,
  mounting,
  style,
  role,
  ...(approachIds ? { approachIds } : {}),
  ...(armHeadingDeg === undefined ? {} : { armHeadingDeg }),
});

export const control = (
  id: string,
  type: TrafficControl["type"],
  x: number,
  z: number,
  headingDeg: number,
  laneIds: readonly string[],
  conflictZoneIds?: readonly string[],
  approaches: readonly TrafficControlApproach[] = [],
  installations: readonly TrafficControlInstallation[] = [],
): TrafficControl => ({
  id,
  type,
  position: point(x, z),
  headingDeg,
  laneIds,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
  approaches,
  installations,
});

export const CONNECTOR_ZONE_RADIUS_M = 2.1;

/**
 * Declares a compact conflict zone around every generic graph junction used
 * by an explicit connector range. Authored signal/roundabout zones keep their
 * wider polygons, while their lane membership is augmented automatically.
 */
export const connectorConflictZones = (
  lanes: readonly LaneSegment[],
  authoredZones: LaneGraph["conflictZones"],
): LaneGraph["conflictZones"] => {
  const connectorLaneIds = new Map<string, Set<string>>();
  const generatedCenters = new Map<string, WorldPoint>();
  const authoredIds = new Set(authoredZones.map((zone) => zone.id));

  for (const lane of lanes) {
    for (const range of lane.connectorRanges ?? []) {
      const conflictZoneId = range.conflictZoneId;
      if (!conflictZoneId) continue;
      const laneIds = connectorLaneIds.get(conflictZoneId) ?? new Set<string>();
      laneIds.add(lane.id);
      connectorLaneIds.set(conflictZoneId, laneIds);
      if (!authoredIds.has(conflictZoneId)) {
        generatedCenters.set(
          conflictZoneId,
          range.startDistanceAlongM <= 1e-6
            ? lane.centerline[0]
            : lane.centerline.at(-1)!,
        );
      }
    }
  }

  const authored = authoredZones.map((zone) => ({
    ...zone,
    laneIds: [
      ...new Set([
        ...zone.laneIds,
        ...(connectorLaneIds.get(zone.id) ?? []),
      ]),
    ],
  }));
  const generated = [...generatedCenters].map(([id, center]) => ({
    id,
    laneIds: [...(connectorLaneIds.get(id) ?? [])],
    polygon: [
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
    ],
  }));
  return [...authored, ...generated];
};

// --- NYC/Tokyo-only cluster below: London's own copies genuinely differ ----

/**
 * NYC is not here: its lanes come from `buildNycGrid`, which knows each
 * lane's road and passes the id straight to `laneTrue`. A prefix table would
 * have to grow a branch per street and would quietly mis-assign any it missed.
 */
export const roadIdForLane = (id: string): string => {
  if (id.startsWith("yard-r-")) return "yard-right-loop";
  if (id.startsWith("yard-l-")) return "yard-left-loop";
  if (id.startsWith("jp-south-east")) return "jp-south-road";
  if (id.startsWith("jp-curve")) return "jp-east-curve";
  if (id.startsWith("jp-center-west")) return "jp-center-road";
  if (id.startsWith("jp-west-north")) return "jp-west-road";
  if (id.startsWith("jp-north-east")) return "jp-north-road";
  if (id.startsWith("jp-junction-south")) return "jp-junction-road";
  if (id.startsWith("jp-narrow-north")) return "jp-narrow-road";
  return id;
};

export const laneWidthForLane = (id: string): number => {
  if (id.startsWith("jp-")) return id.includes("narrow") ? 2.7 : 3.0;
  if (id.startsWith("nyc-")) return 3.4;
  return 3.2;
};

export const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "nyc-b") return "nyc-conflict-72-bway";
  if (nodeId === "nyc-h") return "nyc-conflict-79-bway";
  if (nodeId === "nyc-d") return "nyc-conflict-columbus";
  if (nodeId === "jp-f") return "jp-station-conflict";
  if (nodeId === "jp-d") return "jp-east-curve-junction-conflict";
  if (nodeId === "jp-e") return "jp-east-neighbourhood-junction-conflict";
  return `junction-${nodeId}`;
};

/**
 * Throws rather than defaulting — a road with no posted limit is an
 * authoring omission, and a silent fallback would put ambient traffic
 * through it at whatever the guess happened to be. Runs at module scope, so
 * the failure lands on import — every test at once, naming the road.
 */
export const makeSpeedLimitForRoad =
  (table: Readonly<Record<string, number>>) =>
  (roadId: string): number => {
    const limit = table[roadId];
    if (limit === undefined) {
      throw new Error(`No speed limit posted for road "${roadId}"`);
    }
    return limit;
  };

/**
 * Keeps an authored lateral lane offset all the way to a junction, easing any
 * convergence on a shared node through a sampled S-curve blend (see
 * `laneConnectors.ts`) so segment headings never jump junction-crossing NPCs
 * sideways (#19). The logical graph nodes remain shared so existing route IDs
 * and deterministic successor routing stay stable.
 *
 * Takes `speedLimitForRoad` rather than a lookup table directly so it reads
 * the same as the un-curried original at every call site: each city writes
 * `const laneTrue = makeLaneTrue(speedLimitForRoad);` once, then calls
 * `laneTrue(...)` exactly as before.
 */
export const makeLaneTrue =
  (speedLimitForRoad: (roadId: string) => number) =>
  (
    id: string,
    from: LaneNode,
    to: LaneNode,
    trafficSide: TrafficSide,
    successors: readonly string[],
    role: LaneRole,
    establishedPath: readonly WorldPoint[],
    adjacentLaneIds?: readonly string[],
    roadId: string = roadIdForLane(id),
    widthM = laneWidthForLane(id),
    localSpeedUnit?: SpeedUnit,
  ): LaneSegment => {
    const { centerline, startConnectorLengthM, endConnectorLengthM, totalLengthM } =
      buildLaneTrueGeometry(from.position, to.position, establishedPath);

    return {
      id,
      roadId,
      widthM,
      from: from.id,
      to: to.id,
      centerline,
      role,
      trafficSide,
      speedLimit: speedLimitForRoad(roadId),
      ...(localSpeedUnit ? { localSpeedUnit } : {}),
      successors,
      ...(adjacentLaneIds ? { adjacentLaneIds } : {}),
      connectorRanges: [
        {
          startDistanceAlongM: 0,
          endDistanceAlongM: startConnectorLengthM,
          ...(conflictZoneForNode(from.id)
            ? { conflictZoneId: conflictZoneForNode(from.id) }
            : {}),
        },
        {
          startDistanceAlongM: totalLengthM - endConnectorLengthM,
          endDistanceAlongM: totalLengthM,
          ...(conflictZoneForNode(to.id)
            ? { conflictZoneId: conflictZoneForNode(to.id) }
            : {}),
        },
      ],
    };
  };

export const graph = (
  nodes: readonly LaneNode[],
  lanes: readonly LaneSegment[],
  controls: LaneGraph["controls"],
  conflictZones: LaneGraph["conflictZones"],
  spawnPoints: LaneGraph["spawnPoints"],
): LaneGraph => ({
  nodes,
  lanes,
  controls,
  conflictZones: connectorConflictZones(lanes, conflictZones),
  spawnPoints,
});

/** One rail level crossing, fully derived: control + conflict zone. */
export interface RailCrossingBuild {
  readonly control: TrafficControl;
  readonly conflictZone: ConflictZone;
}

function polylineIntersection(
  left: readonly WorldPoint[],
  right: readonly WorldPoint[],
): {
  point: WorldPoint;
  leftDir: WorldPoint;
  rightDir: WorldPoint;
} | null {
  for (let l = 0; l < left.length - 1; l += 1) {
    const a = left[l];
    const b = left[l + 1];
    for (let r = 0; r < right.length - 1; r += 1) {
      const c = right[r];
      const d = right[r + 1];
      const denominator = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
      if (Math.abs(denominator) < 1e-9) continue;
      const t =
        ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / denominator;
      const u =
        ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / denominator;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const leftLength = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const rightLength = Math.hypot(d.x - c.x, d.z - c.z) || 1;
      return {
        point: point(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t),
        leftDir: point((b.x - a.x) / leftLength, (b.z - a.z) / leftLength),
        rightDir: point((d.x - c.x) / rightLength, (d.z - c.z) / rightLength),
      };
    }
  }
  return null;
}

function distanceAlongPolylineTo(
  points: readonly WorldPoint[],
  target: WorldPoint,
): number {
  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let accumulated = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const t = Math.max(
      0,
      Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / (length * length)),
    );
    const distance = Math.hypot(target.x - (a.x + dx * t), target.z - (a.z + dz * t));
    if (distance < best) {
      best = distance;
      bestAlong = accumulated + length * t;
    }
    accumulated += length;
  }
  return bestAlong;
}

const headingDegOf = (direction: WorldPoint): number => {
  const degrees = (Math.atan2(direction.x, direction.z) * 180) / Math.PI;
  return (degrees + 360) % 360;
};

/**
 * Derive one railway level crossing where a rail line crosses a road: the
 * `railway_signal` control with a stop-lined approach per crossing lane, two
 * gate installations, and the conflict zone over the shared square.
 *
 * Hand-computing these per crossing is exactly how the first two Tokyo
 * crossings were authored, and it does not scale to a network of them across
 * four cities — every distance here is a projection someone can get one lane
 * segment wrong. The generator measures the real lane centrelines instead.
 * Gate placement mirrors the hand-authored originals: a diagonal pair for a
 * two-way road (each gate before the crossing for its own approach, standing
 * off the carriageway), a same-kerb before/after pair for a one-way.
 */
export function buildRailCrossingControl(options: {
  readonly id: string;
  readonly railPoints: readonly WorldPoint[];
  readonly surface: RoadSurface;
  readonly lanes: readonly LaneSegment[];
  /** Metres the stop line sits before the track centreline. Default 6. */
  readonly stopSetbackM?: number;
  /** Which side of the rail the one-way pair stands on (+1/-1 along the
   * road direction at the crossing). Default -1, matching jp-rail-signal-2. */
  readonly oneWayGateSide?: 1 | -1;
}): RailCrossingBuild {
  const { id, railPoints, surface, lanes } = options;
  const stopSetback = options.stopSetbackM ?? 6;
  const hit = polylineIntersection(railPoints, surface.centerline);
  if (!hit) {
    throw new Error(
      `buildRailCrossingControl(${id}): rail line does not cross surface ${surface.id}`,
    );
  }
  const roadDir = hit.rightDir;
  const railDir = hit.leftDir;
  const crossingLanes = surface.laneIds
    .map((laneId) => lanes.find((lane) => lane.id === laneId))
    .filter((lane): lane is LaneSegment => Boolean(lane))
    .map((lane) => {
      const laneHit = polylineIntersection(railPoints, lane.centerline);
      if (!laneHit) return null;
      return {
        lane,
        distanceAlongM: distanceAlongPolylineTo(lane.centerline, laneHit.point),
        direction: laneHit.rightDir,
      };
    })
    .filter(
      (entry): entry is { lane: LaneSegment; distanceAlongM: number; direction: WorldPoint } =>
        Boolean(entry),
    );
  if (!crossingLanes.length) {
    throw new Error(
      `buildRailCrossingControl(${id}): no lane of ${surface.id} crosses the rail line`,
    );
  }
  const approaches: TrafficControlApproach[] = crossingLanes.map(
    (entry, index) => ({
      id: `${id}-approach-${index + 1}`,
      laneIds: [entry.lane.id],
      stopLine: {
        laneId: entry.lane.id,
        distanceAlongM: Math.max(1, entry.distanceAlongM - stopSetback),
      },
      phaseGroup: "railway",
      conflictZoneIds: [`${id}-conflict`],
    }),
  );
  const gateLateral = surface.widthM / 2 + 1.8;
  const gateAlongRoad = 6;
  // Aim each gate's boom at the nearest point of the crossed carriageway —
  // explicitly, per gate. The renderer's legacy heading-implied arm lands
  // 90° clockwise of the pole facing, which pointed sixteen booms across
  // three cities at the sidewalk (owner-reported); the corridor audit now
  // asserts every boom tip sweeps its road via the same
  // `railGateArmDirection` contract.
  const armTowardRoadDeg = (gateX: number, gateZ: number): number => {
    let bestX = hit.point.x;
    let bestZ = hit.point.z;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < surface.centerline.length - 1; index += 1) {
      const a = surface.centerline[index];
      const b = surface.centerline[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-9) continue;
      const t = Math.max(
        0,
        Math.min(1, ((gateX - a.x) * dx + (gateZ - a.z) * dz) / lengthSq),
      );
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distance = Math.hypot(gateX - px, gateZ - pz);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestX = px;
        bestZ = pz;
      }
    }
    return headingDegOf(point(bestX - gateX, bestZ - gateZ));
  };
  const forward = crossingLanes.filter(
    (entry) => entry.direction.x * roadDir.x + entry.direction.z * roadDir.z > 0,
  );
  const twoWay = forward.length > 0 && forward.length < crossingLanes.length;
  const gate = (
    suffix: "a" | "b",
    x: number,
    z: number,
    headingDeg: number,
    role: "primary" | "secondary",
  ): TrafficControlInstallation =>
    installation(
      `${id}-gate-${suffix}`,
      x,
      z,
      headingDeg,
      "railway_crossing",
      "japan_railway",
      role,
      undefined,
      armTowardRoadDeg(x, z),
    );
  const installations: TrafficControlInstallation[] = twoWay
    ? [
        gate(
          "a",
          hit.point.x - roadDir.x * gateAlongRoad - railDir.x * gateLateral,
          hit.point.z - roadDir.z * gateAlongRoad - railDir.z * gateLateral,
          headingDegOf(roadDir),
          "primary",
        ),
        gate(
          "b",
          hit.point.x + roadDir.x * gateAlongRoad + railDir.x * gateLateral,
          hit.point.z + roadDir.z * gateAlongRoad + railDir.z * gateLateral,
          headingDegOf(point(-roadDir.x, -roadDir.z)),
          "secondary",
        ),
      ]
    : (() => {
        const travel = crossingLanes[0].direction;
        const side = options.oneWayGateSide ?? -1;
        const kerbX = railDir.x * gateLateral * side;
        const kerbZ = railDir.z * gateLateral * side;
        return [
          gate(
            "a",
            hit.point.x - travel.x * gateAlongRoad + kerbX,
            hit.point.z - travel.z * gateAlongRoad + kerbZ,
            headingDegOf(travel),
            "primary",
          ),
          gate(
            "b",
            hit.point.x + travel.x * gateAlongRoad + kerbX,
            hit.point.z + travel.z * gateAlongRoad + kerbZ,
            headingDegOf(travel),
            "secondary",
          ),
        ];
      })();
  const zoneAlongRoad = surface.widthM / 2 + 2;
  const zoneAlongRail = 4;
  const conflictZone: ConflictZone = {
    id: `${id}-conflict`,
    laneIds: crossingLanes.map((entry) => entry.lane.id),
    polygon: [
      point(
        hit.point.x - roadDir.x * zoneAlongRoad - railDir.x * zoneAlongRail,
        hit.point.z - roadDir.z * zoneAlongRoad - railDir.z * zoneAlongRail,
      ),
      point(
        hit.point.x + roadDir.x * zoneAlongRoad - railDir.x * zoneAlongRail,
        hit.point.z + roadDir.z * zoneAlongRoad - railDir.z * zoneAlongRail,
      ),
      point(
        hit.point.x + roadDir.x * zoneAlongRoad + railDir.x * zoneAlongRail,
        hit.point.z + roadDir.z * zoneAlongRoad + railDir.z * zoneAlongRail,
      ),
      point(
        hit.point.x - roadDir.x * zoneAlongRoad + railDir.x * zoneAlongRail,
        hit.point.z - roadDir.z * zoneAlongRoad + railDir.z * zoneAlongRail,
      ),
    ],
  };
  return {
    control: control(
      id,
      "railway_signal",
      hit.point.x,
      hit.point.z,
      headingDegOf(roadDir),
      crossingLanes.map((entry) => entry.lane.id),
      [`${id}-conflict`],
      approaches,
      installations,
    ),
    conflictZone,
  };
}

/** Same curry reason as `makeLaneTrue`: each city's `capturedOn` is its own
 * `*_CONTENT_REVIEWED_ON` constant, everything else about the source record
 * is identical. */
export const makeOsmSource =
  (reviewedOn: string) =>
  (
    boundingBox: FrozenMapSource["boundingBox"],
    sourceUrl: string,
    checksum: string,
    additionalBoundingBoxes?: readonly FrozenMapSource["boundingBox"][],
  ): FrozenMapSource => ({
    boundingBox,
    ...(additionalBoundingBoxes ? { additionalBoundingBoxes } : {}),
    capturedOn: reviewedOn,
    sourceUrl,
    checksum,
    importerVersion: "sideswap-procedural-1.0.0",
    attribution: "© OpenStreetMap contributors",
    licenseName: "Open Data Commons Open Database License 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  });
