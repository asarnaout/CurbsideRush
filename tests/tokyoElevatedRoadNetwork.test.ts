import { describe, expect, it } from "vitest";
import {
  TOKYO_JUNCTION_CONNECTORS,
  TOKYO_MAP_PACK,
  TOKYO_ROAD_SPECS,
} from "../app/game/cities/tokyo";
import {
  ELEVATED_DECK_START_M,
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
  elevatedRoadBarrierPlacements,
  elevatedRoadSegmentPlacements,
} from "../app/game/geometry/elevatedRoadGeometry";
import type {
  LaneSegment,
  ProceduralBlock,
  RoadSurface,
  WorldPoint,
} from "../app/game/types";

/**
 * Production contract for Tokyo's Sakuragawa Urban Expressway. These checks
 * deliberately reuse the Cairo network's measured quality bars: the Tokyo
 * route must be a real cross-city transport system, not a scenic bridge that
 * happens to carry a lane graph.
 */

const EXPRESSWAY_PREFIX = "jp-sakuragawa-urban-expressway";
const MAINLINE_ID = `${EXPRESSWAY_PREFIX}-mainline`;
const ACCESS_SITES = [
  "west",
  "kanpachi",
  "chuo",
  "kawagishi",
  "east",
] as const;
const MAXIMUM_CHORD_M = 7.5;
const MAXIMUM_CHORD_HEADING_CHANGE_DEG = 12;
const MINIMUM_LOCAL_CURVE_RADIUS_M = 14;
const MAXIMUM_RAMP_GRADE = 0.105;
const MAXIMUM_ROAD_HANDOFF_DEG = 22;
const NON_DEGENERATE_CHORD_M = 0.001;

const expresswaySpecs = TOKYO_ROAD_SPECS.filter((spec) =>
  spec.id.startsWith(EXPRESSWAY_PREFIX),
);
const expresswaySurfaces = TOKYO_MAP_PACK.geometry.roadSurfaces.filter(
  (surface) => surface.id.startsWith(EXPRESSWAY_PREFIX),
);
const elevatedExpresswaySurfaces = expresswaySurfaces.filter((surface) =>
  surface.centerline.some((candidate) => (candidate.elevationM ?? 0) > 0),
);
const laneById = new Map(
  TOKYO_MAP_PACK.laneGraph.lanes.map((lane) => [lane.id, lane]),
);
const surfaceById = new Map(
  TOKYO_MAP_PACK.geometry.roadSurfaces.map((surface) => [surface.id, surface]),
);
const nodeById = new Map(
  TOKYO_MAP_PACK.laneGraph.nodes.map((node) => [node.id, node]),
);

const planLengthM = (points: readonly WorldPoint[]): number =>
  points.slice(1).reduce(
    (totalM, current, index) =>
      totalM +
      Math.hypot(
        current.x - points[index].x,
        current.z - points[index].z,
      ),
    0,
  );

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

const laneDirectionAtEnd = (
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

const headingDifferenceDeg = (
  first: { readonly x: number; readonly z: number },
  second: { readonly x: number; readonly z: number },
): number =>
  (Math.acos(
    Math.max(-1, Math.min(1, first.x * second.x + first.z * second.z)),
  ) *
    180) /
  Math.PI;

interface TestOrientedRect {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

const blockRect = (block: ProceduralBlock): TestOrientedRect => {
  const headingRad = ((block.headingDeg ?? 0) * Math.PI) / 180;
  return {
    id: block.id,
    x: block.center.x,
    z: block.center.z,
    ux: Math.cos(headingRad),
    uz: -Math.sin(headingRad),
    halfU: block.size.x / 2,
    halfV: block.size.z / 2,
  };
};

const corridorSegmentRect = (
  surface: RoadSurface,
  segmentIndex: number,
): TestOrientedRect | null => {
  const start = surface.centerline[segmentIndex];
  const end = surface.centerline[segmentIndex + 1];
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM <= NON_DEGENERATE_CHORD_M) return null;
  return {
    id: `${surface.id}:${segmentIndex}`,
    x: (start.x + end.x) / 2,
    z: (start.z + end.z) / 2,
    ux: dx / lengthM,
    uz: dz / lengthM,
    halfU: lengthM / 2 + 0.1,
    // The production carver reserves a still larger margin. This assertion
    // covers asphalt, deck/parapet and a visible facade guard.
    halfV:
      surface.widthM / 2 +
      (surface.sidewalkWidthM ?? 0) +
      (surface.parapetDepthM ?? 0) +
      0.75,
  };
};

const orientedRectsOverlap = (
  first: TestOrientedRect,
  second: TestOrientedRect,
): boolean => {
  const firstV = { x: -first.uz, z: first.ux };
  const secondV = { x: -second.uz, z: second.ux };
  const offsetX = second.x - first.x;
  const offsetZ = second.z - first.z;
  const axes = [
    { x: first.ux, z: first.uz },
    firstV,
    { x: second.ux, z: second.uz },
    secondV,
  ];
  return axes.every((axis) => {
    const separationM = Math.abs(offsetX * axis.x + offsetZ * axis.z);
    const firstRadiusM =
      first.halfU * Math.abs(first.ux * axis.x + first.uz * axis.z) +
      first.halfV * Math.abs(firstV.x * axis.x + firstV.z * axis.z);
    const secondRadiusM =
      second.halfU * Math.abs(second.ux * axis.x + second.uz * axis.z) +
      second.halfV * Math.abs(secondV.x * axis.x + secondV.z * axis.z);
    // A mathematical edge touch is acceptable; an area overlap is not.
    return separationM < firstRadiusM + secondRadiusM - 0.01;
  });
};

describe("Tokyo Sakuragawa Urban Expressway", () => {
  it("builds a substantial cross-city network that crosses the Sakuragawa", () => {
    expect(expresswaySpecs).toHaveLength(23);
    expect(expresswaySurfaces).toHaveLength(23);

    const mainline = surfaceById.get(MAINLINE_ID)!;
    expect(mainline).toBeTruthy();
    expect(planLengthM(mainline.centerline)).toBeGreaterThan(1_800);
    expect(
      expresswaySurfaces.reduce(
        (totalM, surface) => totalM + planLengthM(surface.centerline),
        0,
      ),
    ).toBeGreaterThan(4_000);
    expect(
      Math.max(...mainline.centerline.map((candidate) => candidate.x)) -
        Math.min(...mainline.centerline.map((candidate) => candidate.x)),
    ).toBeGreaterThan(1_750);

    const river = TOKYO_MAP_PACK.geometry.waterBodies?.find(
      (candidate) => candidate.id === "jp-sakuragawa",
    );
    expect(river).toBeTruthy();
    const overWater = mainline.centerline.filter((candidate) =>
      pointInPolygon(candidate, river!.polygon),
    );
    expect(overWater.length).toBeGreaterThan(10);
    expect(
      overWater.every((candidate) => (candidate.elevationM ?? 0) === 10.5),
    ).toBe(true);
  });

  it("authors exactly five access sites with one legal entry and exit each", () => {
    const accessMovements = TOKYO_JUNCTION_CONNECTORS.flatMap((connector) =>
      connector.movements.flatMap((movement) =>
        movement.toRoadIds.map((toRoadId) => ({
          connector,
          movement,
          toRoadId,
          fromExpressway: movement.fromRoadId.startsWith(EXPRESSWAY_PREFIX),
          toExpressway: toRoadId.startsWith(EXPRESSWAY_PREFIX),
        })),
      ),
    ).filter(
      (candidate) =>
        candidate.fromExpressway !== candidate.toExpressway,
    );

    expect(accessMovements).toHaveLength(10);
    for (const site of ACCESS_SITES) {
      const atSite = accessMovements.filter((candidate) =>
        candidate.connector.nodeId.startsWith(`jp-sx-${site}-`),
      );
      expect(atSite, site).toHaveLength(2);
      expect(
        atSite.filter(
          (candidate) =>
            !candidate.fromExpressway && candidate.toExpressway,
        ),
        `${site} entry`,
      ).toHaveLength(1);
      expect(
        atSite.filter(
          (candidate) =>
            candidate.fromExpressway && !candidate.toExpressway,
        ),
        `${site} exit`,
      ).toHaveLength(1);
      expect(
        atSite.every((candidate) =>
          (candidate.fromExpressway
            ? candidate.movement.fromRoadId
            : candidate.toRoadId
          ).endsWith("-slip"),
        ),
        `${site} ground handoffs use flat slips`,
      ).toBe(true);
    }
  });

  it("provides a continuous legal cross-city journey in both directions", () => {
    const findJourney = (
      fromRoadId: string,
      fromDirection: "forward" | "reverse",
      entryNodeId: string,
      toRoadId: string,
      toDirection: "forward" | "reverse",
      exitNodeId: string,
    ): readonly LaneSegment[] | null => {
      const starts = TOKYO_MAP_PACK.laneGraph.lanes.filter(
        (lane) =>
          lane.roadId === fromRoadId &&
          lane.to === entryNodeId &&
          lane.id.includes(`-${fromDirection}-`),
      );
      const isGoal = (lane: LaneSegment): boolean =>
        lane.roadId === toRoadId &&
        lane.from === exitNodeId &&
        lane.id.includes(`-${toDirection}-`);
      const queue = starts.map((lane) => [lane] as readonly LaneSegment[]);
      const visited = new Set(starts.map((lane) => lane.id));

      while (queue.length) {
        const path = queue.shift()!;
        const current = path.at(-1)!;
        if (isGoal(current)) return path;
        for (const successorId of current.successors) {
          if (visited.has(successorId)) continue;
          const successor = laneById.get(successorId);
          if (
            !successor ||
            (!successor.roadId.startsWith(EXPRESSWAY_PREFIX) &&
              successor.roadId !== toRoadId)
          ) {
            continue;
          }
          visited.add(successorId);
          queue.push([...path, successor]);
        }
      }
      return null;
    };

    const journeys = [
      findJourney(
        "jp-setagaya-dori-west",
        "forward",
        "jp-sx-west-entry-ground",
        "jp-higashi-dori",
        "forward",
        "jp-sx-east-exit-ground",
      ),
      findJourney(
        "jp-higashi-dori",
        "reverse",
        "jp-sx-east-entry-ground",
        "jp-setagaya-dori-west",
        "reverse",
        "jp-sx-west-exit-ground",
      ),
    ];

    for (const [index, journey] of journeys.entries()) {
      expect(journey, index === 0 ? "eastbound" : "westbound").toBeTruthy();
      const roadIds = new Set(journey?.map((lane) => lane.roadId));
      expect(roadIds.has(MAINLINE_ID), index === 0 ? "eastbound" : "westbound").toBe(
        true,
      );
      expect(
        journey?.some((lane) =>
          lane.centerline.some((point) => (point.elevationM ?? 0) >= 10.5),
        ),
        index === 0 ? "eastbound high deck" : "westbound high deck",
      ).toBe(true);
    }
  });

  it("keeps the four-lane mainline at 10.5 m and attaches ramps to the left-hand outer lanes", () => {
    const mainlineSpec = expresswaySpecs.find(
      (candidate) => candidate.id === MAINLINE_ID,
    )!;
    const mainline = surfaceById.get(MAINLINE_ID)!;
    expect(mainlineSpec.laneCount).toBe(4);
    expect(mainlineSpec.speedLimitKmh).toBe(60);
    expect(mainline.widthM).toBe(14);
    expect(
      mainline.centerline.every(
        (candidate) => (candidate.elevationM ?? 0) === 10.5,
      ),
    ).toBe(true);

    const mainlineLanes = TOKYO_MAP_PACK.laneGraph.lanes.filter(
      (lane) => lane.roadId === MAINLINE_ID,
    );
    expect(mainlineLanes).toHaveLength(
      (mainlineSpec.nodeIds.length - 1) * 4,
    );
    for (const lane of mainlineLanes) {
      expect(lane.trafficSide, lane.id).toBe("left");
      expect(lane.role, lane.id).toBe(
        lane.id.endsWith("-2") ? "travel" : "passing",
      );
    }

    const branchAttachments = TOKYO_JUNCTION_CONNECTORS.flatMap(
      (connector) =>
        connector.movements.flatMap((movement) =>
          movement.toRoadIds.map((toRoadId) => ({
            connector,
            movement,
            toRoadId,
          })),
        ),
    ).filter(({ movement, toRoadId }) => {
      const otherRoadId =
        movement.fromRoadId === MAINLINE_ID
          ? toRoadId
          : toRoadId === MAINLINE_ID
            ? movement.fromRoadId
            : "";
      return otherRoadId.endsWith("-ramp");
    });
    expect(branchAttachments).toHaveLength(6);

    for (const { connector, movement, toRoadId } of branchAttachments) {
      const mainlineIsDestination = toRoadId === MAINLINE_ID;
      if (mainlineIsDestination) {
        // Connector authoring uses zero-based indices; index 1 is lane-id
        // suffix 2, Tokyo's outer/nearside travel lane.
        expect(
          movement.toLaneIndices?.[MAINLINE_ID],
          connector.nodeId,
        ).toEqual([1]);
      } else {
        expect(movement.fromLaneIndices, connector.nodeId).toEqual([1]);
      }

      const arrivals = TOKYO_MAP_PACK.laneGraph.lanes.filter(
        (lane) =>
          lane.roadId === movement.fromRoadId &&
          lane.to === connector.nodeId &&
          (!movement.fromDirection ||
            lane.id.includes(`-${movement.fromDirection}-`)) &&
          (!movement.fromLaneIndices ||
            movement.fromLaneIndices.some((index) =>
              lane.id.endsWith(`-${index + 1}`),
            )),
      );
      expect(arrivals.length, connector.nodeId).toBeGreaterThan(0);
      const legalHandoffs = arrivals.flatMap((lane) =>
        lane.successors
          .map((successorId) => ({ lane, successor: laneById.get(successorId) }))
          .filter(
            (candidate) => candidate.successor?.roadId === toRoadId,
          ),
      );
      expect(legalHandoffs.length, connector.nodeId).toBeGreaterThan(0);
      for (const { lane, successor } of legalHandoffs) {
        const mainlineLane = mainlineIsDestination ? successor! : lane;
        expect(mainlineLane.id, connector.nodeId).toMatch(/-2$/);
        expect(mainlineLane.role, connector.nodeId).toBe("travel");
      }
    }
  });

  it("keeps all ten host-road tapers flat before a separate profiled grade", () => {
    const slips = expresswaySpecs.filter((spec) => spec.id.endsWith("-slip"));
    const ramps = expresswaySpecs.filter((spec) => spec.id.endsWith("-ramp"));
    expect(slips).toHaveLength(10);
    expect(ramps).toHaveLength(10);

    for (const slip of slips) {
      const surface = surfaceById.get(slip.id)!;
      expect(
        surface.centerline.every(
          (candidate) => (candidate.elevationM ?? 0) === 0,
        ),
        slip.id,
      ).toBe(true);
      expect(surface.parapetDepthM, slip.id).toBeUndefined();
    }

    for (const site of ACCESS_SITES) {
      const entrySlip = expresswaySpecs.find(
        (spec) => spec.id === `${EXPRESSWAY_PREFIX}-${site}-entry-slip`,
      )!;
      const entryRamp = expresswaySpecs.find(
        (spec) => spec.id === `${EXPRESSWAY_PREFIX}-${site}-entry-ramp`,
      )!;
      const exitRamp = expresswaySpecs.find(
        (spec) => spec.id === `${EXPRESSWAY_PREFIX}-${site}-exit-ramp`,
      )!;
      const exitSlip = expresswaySpecs.find(
        (spec) => spec.id === `${EXPRESSWAY_PREFIX}-${site}-exit-slip`,
      )!;
      expect(entrySlip.nodeIds.at(-1), `${site} entry seam`).toBe(
        entryRamp.nodeIds[0],
      );
      expect(exitRamp.nodeIds.at(-1), `${site} exit seam`).toBe(
        exitSlip.nodeIds[0],
      );
      expect(entryRamp.elevationsM?.[0], `${site} entry touchdown`).toBe(0);
      expect(exitRamp.elevationsM?.at(-1), `${site} exit touchdown`).toBe(0);
      expect(
        entryRamp.elevationsM?.some((elevationM) => elevationM >= 7.5),
        `${site} entry grade`,
      ).toBe(true);
      expect(
        exitRamp.elevationsM?.some((elevationM) => elevationM >= 7.5),
        `${site} exit grade`,
      ).toBe(true);
    }
  });

  it("uses one aligned elevation profile for every elevated surface and lane", () => {
    for (const spec of expresswaySpecs.filter((candidate) =>
      candidate.elevationsM?.some((elevationM) => elevationM > 0),
    )) {
      const surface = surfaceById.get(spec.id)!;
      expect(surface, spec.id).toBeTruthy();
      expect(spec.elevationsM, spec.id).toHaveLength(spec.nodeIds.length);

      for (let knotIndex = 0; knotIndex < spec.nodeIds.length; knotIndex += 1) {
        const node = nodeById.get(spec.nodeIds[knotIndex])!;
        const surfaceKnot = surface.centerline.find(
          (candidate) =>
            Math.hypot(
              candidate.x - node.position.x,
              candidate.z - node.position.z,
            ) < 0.001,
        );
        expect(surfaceKnot, `${spec.id} knot ${spec.nodeIds[knotIndex]}`).toBeTruthy();
        expect(
          surfaceKnot?.elevationM ?? 0,
          `${spec.id} knot ${spec.nodeIds[knotIndex]}`,
        ).toBeCloseTo(spec.elevationsM![knotIndex], 6);
      }

      const lanes = surface.laneIds.map((laneId) => laneById.get(laneId)!);
      expect(lanes.every(Boolean), `${spec.id} lane inventory`).toBe(true);
      for (const lane of lanes) {
        const match = lane.id.match(/-(\d+)-(forward|reverse)-(\d+)$/);
        expect(match, lane.id).toBeTruthy();
        const segmentIndex = Number(match![1]) - 1;
        const direction = match![2];
        const expectedStartM =
          direction === "forward"
            ? spec.elevationsM![segmentIndex]
            : spec.elevationsM![segmentIndex + 1];
        const expectedEndM =
          direction === "forward"
            ? spec.elevationsM![segmentIndex + 1]
            : spec.elevationsM![segmentIndex];
        expect(lane.centerline[0].elevationM ?? 0, lane.id).toBeCloseTo(
          expectedStartM,
          6,
        );
        expect(lane.centerline.at(-1)!.elevationM ?? 0, lane.id).toBeCloseTo(
          expectedEndM,
          6,
        );

        for (const candidate of lane.centerline) {
          const nearest = nearestSurfaceProjection(candidate, surface);
          expect(nearest.distanceM, `${lane.id} asphalt envelope`).toBeLessThanOrEqual(
            surface.widthM / 2 + 0.05,
          );
          expect(
            Math.abs((candidate.elevationM ?? 0) - nearest.elevationM),
            `${lane.id} elevation profile`,
          ).toBeLessThanOrEqual(0.02);
        }
      }

      const expectedStructuralSegments = surface.centerline
        .slice(0, -1)
        .flatMap((start, index) =>
          Math.max(
            start.elevationM ?? 0,
            surface.centerline[index + 1].elevationM ?? 0,
          ) >= ELEVATED_DECK_START_M
            ? [index]
            : [],
        );
      expect(
        elevatedRoadSegmentPlacements(surface).map(
          (placement) => placement.segmentIndex,
        ),
        `${spec.id} structural profile`,
      ).toEqual(expectedStructuralSegments);
    }
  });

  it("seats visible parapets on every structure and keeps the high river span out of shoreline portals", () => {
    expect(ELEVATED_ROAD_PARAPET_BASE_LIFT_M).toBe(0);
    for (const surface of elevatedExpresswaySurfaces) {
      expect(surface.parapetDepthM, surface.id).toBe(0.36);
      expect(surface.sidewalkWidthM, surface.id).toBe(0);
      expect(
        elevatedRoadBarrierPlacements(surface, elevatedExpresswaySurfaces)
          .length,
        `${surface.id} visible/physical parapets`,
      ).toBeGreaterThan(0);
    }

    const sakuragawa = TOKYO_MAP_PACK.geometry.waterBodies?.find(
      (candidate) => candidate.id === "jp-sakuragawa",
    );
    expect(sakuragawa?.bridgePortalSurfaceIds).toEqual([
      "jp-sakura-ohashi",
      "jp-kawanaka-bashi",
      "jp-tsuki-ohashi",
    ]);
    expect(
      sakuragawa?.bridgePortalSurfaceIds?.some((surfaceId) =>
        surfaceId.startsWith(EXPRESSWAY_PREFIX),
      ),
    ).toBe(false);
  });

  it("never derives a traffic control or invisible stop barrier at an expressway node", () => {
    const expresswayNodeIds = new Set(
      expresswaySpecs.flatMap((spec) => spec.nodeIds),
    );
    const expresswayNodes = [...expresswayNodeIds].map(
      (nodeId) => nodeById.get(nodeId)!,
    );
    expect(expresswayNodes.every(Boolean)).toBe(true);

    for (const control of TOKYO_MAP_PACK.laneGraph.controls) {
      expect(
        expresswayNodes.some(
          (node) =>
            Math.hypot(
              control.position.x - node.position.x,
              control.position.z - node.position.z,
            ) < 0.05,
        ),
        control.id,
      ).toBe(false);
      expect(
        control.laneIds.some((laneId) =>
          laneById.get(laneId)?.roadId.startsWith(EXPRESSWAY_PREFIX),
        ),
        control.id,
      ).toBe(false);
      expect(
        control.approaches.some((approach) =>
          approach.laneIds.some((laneId) =>
            laneById.get(laneId)?.roadId.startsWith(EXPRESSWAY_PREFIX),
          ),
        ),
        control.id,
      ).toBe(false);
    }
  });

  it("keeps every curve broad, every grade civil and every legal handoff tangent", () => {
    const violations: string[] = [];

    for (const surface of elevatedExpresswaySurfaces) {
      const directions: Array<{
        readonly endPointIndex: number;
        readonly x: number;
        readonly z: number;
      }> = [];
      let curvedChordCount = 0;
      for (let index = 1; index < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM <= NON_DEGENERATE_CHORD_M) continue;
        if (lengthM > MAXIMUM_CHORD_M + 0.001) {
          violations.push(
            `${surface.id} chord ${index - 1}: ${lengthM.toFixed(2)}m`,
          );
        }
        const grade =
          Math.abs((end.elevationM ?? 0) - (start.elevationM ?? 0)) /
          lengthM;
        if (grade > MAXIMUM_RAMP_GRADE + 1e-9) {
          violations.push(
            `${surface.id} grade ${index - 1}: ${(grade * 100).toFixed(2)}%`,
          );
        }
        directions.push({ endPointIndex: index, x: dx / lengthM, z: dz / lengthM });
      }

      for (let index = 1; index < directions.length; index += 1) {
        const headingChangeDeg = headingDifferenceDeg(
          directions[index - 1],
          directions[index],
        );
        if (headingChangeDeg > 0.2) curvedChordCount += 1;
        if (headingChangeDeg > MAXIMUM_CHORD_HEADING_CHANGE_DEG + 1e-9) {
          violations.push(
            `${surface.id} heading near ${directions[index - 1].endPointIndex}: ${headingChangeDeg.toFixed(2)}deg`,
          );
        }
      }

      for (let index = 1; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index - 1];
        const middle = surface.centerline[index];
        const end = surface.centerline[index + 1];
        const firstM = Math.hypot(middle.x - start.x, middle.z - start.z);
        const secondM = Math.hypot(end.x - middle.x, end.z - middle.z);
        const diagonalM = Math.hypot(end.x - start.x, end.z - start.z);
        const twiceAreaM2 = Math.abs(
          (middle.x - start.x) * (end.z - start.z) -
            (middle.z - start.z) * (end.x - start.x),
        );
        if (twiceAreaM2 <= 0.0001) continue;
        const radiusM =
          (firstM * secondM * diagonalM) / (2 * twiceAreaM2);
        if (radiusM < MINIMUM_LOCAL_CURVE_RADIUS_M - 1e-6) {
          violations.push(
            `${surface.id} radius at ${index}: ${radiusM.toFixed(2)}m`,
          );
        }
      }

      if (surface.id.endsWith("-ramp") && curvedChordCount === 0) {
        violations.push(`${surface.id}: ramp was reduced to a straight chord`);
      }
    }

    for (const lane of TOKYO_MAP_PACK.laneGraph.lanes) {
      for (const successorId of lane.successors) {
        const successor = laneById.get(successorId);
        if (
          !successor ||
          successor.roadId === lane.roadId ||
          (!lane.roadId.startsWith(EXPRESSWAY_PREFIX) &&
            !successor.roadId.startsWith(EXPRESSWAY_PREFIX))
        ) {
          continue;
        }
        const handoffDeg = headingDifferenceDeg(
          laneDirectionAtEnd(lane, "end"),
          laneDirectionAtEnd(successor, "start"),
        );
        if (handoffDeg > MAXIMUM_ROAD_HANDOFF_DEG + 1e-9) {
          violations.push(
            `${lane.id} -> ${successor.id}: ${handoffDeg.toFixed(2)}deg handoff`,
          );
        }
      }
    }

    expect(
      violations,
      `Every Sakuragawa structure must keep at least ${MINIMUM_LOCAL_CURVE_RADIUS_M}m radius, no more than ${(MAXIMUM_RAMP_GRADE * 100).toFixed(1)}% grade, and legal handoffs within ${MAXIMUM_ROAD_HANDOFF_DEG}deg`,
    ).toEqual([]);
  });

  it("keeps every procedural building block outside the complete expressway envelope", () => {
    const blockRects = TOKYO_MAP_PACK.geometry.blocks.map(blockRect);
    const failures: string[] = [];
    for (const surface of expresswaySurfaces) {
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const corridor = corridorSegmentRect(surface, index);
        if (!corridor) continue;
        for (const block of blockRects) {
          const broadHalfX =
            Math.abs(corridor.ux) * corridor.halfU +
            Math.abs(corridor.uz) * corridor.halfV;
          const broadHalfZ =
            Math.abs(corridor.uz) * corridor.halfU +
            Math.abs(corridor.ux) * corridor.halfV;
          const blockHalfX =
            Math.abs(block.ux) * block.halfU +
            Math.abs(block.uz) * block.halfV;
          const blockHalfZ =
            Math.abs(block.uz) * block.halfU +
            Math.abs(block.ux) * block.halfV;
          if (
            Math.abs(corridor.x - block.x) >= broadHalfX + blockHalfX ||
            Math.abs(corridor.z - block.z) >= broadHalfZ + blockHalfZ
          ) {
            continue;
          }
          if (orientedRectsOverlap(corridor, block)) {
            failures.push(`${corridor.id} intersects ${block.id}`);
          }
        }
      }
    }
    expect(
      failures,
      "Expressway asphalt, deck, parapets and facade guard must remain building-free",
    ).toEqual([]);
  });
});
