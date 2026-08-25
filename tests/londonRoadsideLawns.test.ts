import {
  type AbstractMesh,
  NullEngine,
  Scene,
  StandardMaterial,
  VertexBuffer,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import {
  planMapBuildings,
  type BuildingLayoutPlan,
  type StructuralObb,
} from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import {
  aabbOfShape,
  booleanIntersectionArea,
  collectGroundSurfaces,
  parkLawnEdgeLapGeometry,
  pointInShape,
} from "../app/game/geometry/visualSceneFootprints";
import {
  parkLawnEdgeLapBands,
  parkLawnEdgeLapLiftM,
  parkLawnVisualRect,
  parkLayoutForLandmark,
  type ParkLocalEdge,
} from "../app/game/parkLayouts";
import {
  buildParkLawn,
  createParksRenderMasters,
  type ParksRenderCtx,
} from "../app/game/render/parksRender";
import {
  BUILDING_GROUND_LIFT,
  GRASS_TILE_M,
  PARK_LAWN_Y,
  ROAD_SHOULDER_Y,
  ROAD_SURFACE_Y,
} from "../app/game/render/renderConstants";
import { resolveMapVisualPalette } from "../app/game/visuals";

type Point2 = { readonly x: number; readonly z: number };
type Axis = "x" | "z";

interface RoadsideLawnTarget {
  readonly id: string;
  readonly roadId: string;
  readonly additionalRoadIds?: readonly string[];
  readonly roadEdge: ParkLocalEdge;
  /** Park-local position along the ribbon where a real facade crosses the ray. */
  readonly sampleLongM: number;
  readonly expectedBackingOwnerId: string;
  /** Every block allowed to provide the nearest facade anywhere on the run. */
  readonly backingBlockIds?: readonly string[];
  /** Building-like landmarks or adjoining lawns allowed to close the far edge. */
  readonly backingLandmarkIds?: readonly string[];
  /** Career layouts known to exercise the widest procedural facade jitter. */
  readonly stressSeeds?: readonly number[];
}

const ROADSIDE_LAWNS: readonly RoadsideLawnTarget[] = [
  {
    id: "london-gloucester-west-strip",
    roadId: "london-gloucester",
    roadEdge: "+x",
    sampleLongM: -1,
    expectedBackingOwnerId: "london-block-gloucester-w-2",
    backingBlockIds: ["london-block-gloucester-w-2"],
  },
  {
    id: "london-gloucester-east-strip",
    roadId: "london-gloucester",
    roadEdge: "-x",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-gloucester-e-2",
    backingBlockIds: ["london-block-gloucester-e-2"],
  },
  {
    id: "london-cromwell-fw-north-strip",
    roadId: "london-cromwell-far-west",
    roadEdge: "-z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-cromwell-fw-n-w",
    backingBlockIds: [
      "london-block-cromwell-fw-n-w",
      "london-block-cromwell-fw-n",
      "london-block-qgt-west-fab",
    ],
  },
  {
    id: "london-cromwell-fw-north-strip-east",
    roadId: "london-cromwell-far-west",
    roadEdge: "-z",
    // The Queen's Gate procedural frontage is the deepest of the eleven
    // representative samples: 4.66 m behind the authored lawn edge.
    sampleLongM: -8,
    expectedBackingOwnerId: "london-queen-gate-terraces",
    backingBlockIds: [
      "london-block-cromwell-fw-n",
      "london-block-qgt-west-fab",
      "london-queen-gate-terraces",
    ],
    stressSeeds: [781_501_526],
  },
  {
    id: "london-spawn-road-verge",
    roadId: "london-quiet-loop",
    roadEdge: "+z",
    sampleLongM: -8,
    expectedBackingOwnerId: "london-block-quiet-s",
    backingBlockIds: ["london-block-quiet-s"],
  },
  {
    id: "london-spawn-road-verge-w",
    roadId: "london-quiet-loop",
    roadEdge: "+x",
    sampleLongM: -12,
    expectedBackingOwnerId: "london-block-quiet-w",
    backingBlockIds: ["london-block-quiet-w"],
  },
  {
    id: "london-park-west-strip",
    roadId: "london-park-west",
    roadEdge: "+x",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-park-west-w",
    backingBlockIds: ["london-block-park-west-w"],
  },
  {
    id: "london-notting-hill-south-strip-east",
    roadId: "london-notting-hill",
    roadEdge: "-z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-notting-s-1",
    backingBlockIds: ["london-block-notting-s-1"],
  },
  {
    id: "london-notting-hill-south-strip-west",
    roadId: "london-notting-hill",
    roadEdge: "-z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-notting-s-2",
    backingBlockIds: ["london-block-notting-s-2"],
  },
  {
    id: "london-st-james-strip",
    roadId: "london-mall",
    roadEdge: "+z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-mall-s",
    backingBlockIds: ["london-block-mall-s", "london-block-mall-s-mid"],
    stressSeeds: [2_036_132_045],
  },
  {
    id: "london-st-james-strip-east",
    roadId: "london-mall",
    roadEdge: "+z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-block-mall-s-e",
    backingBlockIds: ["london-block-mall-s-e", "london-block-mall-s-mid"],
    stressSeeds: [1_232_987_091],
  },
  {
    id: "london-museum-forecourt-west",
    roadId: "london-cromwell-west",
    roadEdge: "-z",
    sampleLongM: -33.5,
    expectedBackingOwnerId: "london-science-museum-block",
    backingBlockIds: ["london-science-museum-block"],
    backingLandmarkIds: ["london-science-museum"],
  },
  {
    id: "london-museum-forecourt-east",
    roadId: "london-cromwell-east",
    roadEdge: "-z",
    sampleLongM: -28.8,
    expectedBackingOwnerId: "london-v-and-a-block",
    backingBlockIds: ["london-v-and-a-block"],
    backingLandmarkIds: ["london-victoria-and-albert-museum"],
  },
  {
    id: "london-museum-forecourt-south-west",
    roadId: "london-cromwell-west",
    additionalRoadIds: ["london-cromwell-east"],
    roadEdge: "+z",
    sampleLongM: -43.4,
    expectedBackingOwnerId: "london-natural-history-museum-block",
    backingBlockIds: ["london-natural-history-museum-block"],
    backingLandmarkIds: ["london-natural-history-museum"],
  },
  {
    id: "london-museum-forecourt-south-east",
    roadId: "london-cromwell-east",
    roadEdge: "+z",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-cromwell-terraces",
    backingBlockIds: ["london-cromwell-terraces"],
  },
  {
    id: "london-museum-forecourt-north-west",
    roadId: "london-thurloe-place",
    roadEdge: "+z",
    sampleLongM: -34,
    expectedBackingOwnerId: "london-science-museum-block",
    backingBlockIds: ["london-science-museum-block"],
    backingLandmarkIds: ["london-science-museum"],
  },
  {
    id: "london-museum-forecourt-north-east",
    roadId: "london-thurloe-place",
    roadEdge: "+z",
    sampleLongM: -28.4,
    expectedBackingOwnerId: "london-v-and-a-block",
    backingBlockIds: ["london-v-and-a-block"],
    backingLandmarkIds: ["london-victoria-and-albert-museum"],
  },
  {
    id: "london-exhibition-road-public-space",
    roadId: "london-exhibition-road",
    roadEdge: "-x",
    sampleLongM: 0,
    expectedBackingOwnerId: "london-v-and-a-block",
    backingBlockIds: ["london-v-and-a-block"],
    backingLandmarkIds: ["london-victoria-and-albert-museum"],
  },
];

const MIN_CURB_EDGE_LAP_M = 0.15;
const MIN_BUILDING_EDGE_LAP_M = 0.15;
const EPSILON_M = 1e-6;
// polygon-clipping snaps real-map coordinates to 1 mm; the longest surviving
// pavement-boundary rounding sliver is 20 cm² and cannot resolve to a pixel.
const MAX_CLIPPING_SLIVER_AREA_M2 = 0.003;

type LondonLandmark = (typeof LONDON_MAP_PACK.geometry.landmarks)[number];

function landmarkById(id: string): LondonLandmark {
  const landmark = LONDON_MAP_PACK.geometry.landmarks.find(
    (candidate) => candidate.id === id,
  );
  if (!landmark) throw new Error(`Missing London landmark ${id}`);
  return landmark;
}

function transverseAxis(edge: ParkLocalEdge): Axis {
  return edge.endsWith("x") ? "x" : "z";
}

function longitudinalAxis(edge: ParkLocalEdge): Axis {
  return transverseAxis(edge) === "x" ? "z" : "x";
}

function edgeSign(edge: ParkLocalEdge): 1 | -1 {
  return edge.startsWith("+") ? 1 : -1;
}

function worldToParkLocal(landmark: LondonLandmark, point: Point2): Point2 {
  const heading = ((landmark.headingDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const dx = point.x - landmark.center.x;
  const dz = point.z - landmark.center.z;
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function parkLocalToWorld(landmark: LondonLandmark, point: Point2): Point2 {
  const heading = ((landmark.headingDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: landmark.center.x + point.x * cos + point.z * sin,
    z: landmark.center.z - point.x * sin + point.z * cos,
  };
}

function nearestProjectionOnPolyline(
  point: Point2,
  polyline: readonly Point2[],
): { readonly point: Point2; readonly segmentIndex: number; readonly t: number } {
  let nearest:
    | { readonly point: Point2; readonly segmentIndex: number; readonly t: number }
    | undefined;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    const start = polyline[i - 1];
    const end = polyline[i];
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    if (lengthSq <= Number.EPSILON) continue;
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.x) * segmentX +
          (point.z - start.z) * segmentZ) /
          lengthSq,
      ),
    );
    const candidate = {
      x: start.x + projection * segmentX,
      z: start.z + projection * segmentZ,
    };
    const dx = point.x - candidate.x;
    const dz = point.z - candidate.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < nearestDistanceSq) {
      nearest = { point: candidate, segmentIndex: i - 1, t: projection };
      nearestDistanceSq = distanceSq;
    }
  }
  if (!nearest) throw new Error("Road surface has no non-zero-length segment");
  return nearest;
}

function nearestPointOnPolyline(
  point: Point2,
  polyline: readonly Point2[],
): Point2 {
  return nearestProjectionOnPolyline(point, polyline).point;
}

function structuralSolidCorners(solid: StructuralObb): readonly Point2[] {
  return (
    [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ] as const
  ).map(([uSign, vSign]) => ({
    x:
      solid.x +
      uSign * solid.halfU * solid.ux +
      vSign * solid.halfV * solid.uz,
    z:
      solid.z +
      uSign * solid.halfU * solid.uz -
      vSign * solid.halfV * solid.ux,
  }));
}

function boundsAlong(
  points: readonly Point2[],
  axis: Axis,
): { readonly min: number; readonly max: number } {
  return {
    min: Math.min(...points.map((point) => point[axis])),
    max: Math.max(...points.map((point) => point[axis])),
  };
}

/** Exact polygon cross-section at one park-local longitudinal coordinate. */
function transverseSliceBounds(
  corners: readonly Point2[],
  longitudinal: Axis,
  transverse: Axis,
  sampleLongM: number,
): { readonly min: number; readonly max: number } | undefined {
  const hits: number[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    const deltaLongM = end[longitudinal] - start[longitudinal];
    if (Math.abs(deltaLongM) <= EPSILON_M) {
      if (Math.abs(sampleLongM - start[longitudinal]) <= EPSILON_M) {
        hits.push(start[transverse], end[transverse]);
      }
      continue;
    }
    const t = (sampleLongM - start[longitudinal]) / deltaLongM;
    if (t < -EPSILON_M || t > 1 + EPSILON_M) continue;
    hits.push(start[transverse] + (end[transverse] - start[transverse]) * t);
  }
  if (hits.length < 2) return undefined;
  return { min: Math.min(...hits), max: Math.max(...hits) };
}

function assertBackingFacadeOverlap(
  target: RoadsideLawnTarget,
  landmark: LondonLandmark,
  layout: BuildingLayoutPlan,
): void {
  const laps = landmark.lawnEdgeLaps;
  if (!laps) throw new Error(`${target.id} has no lawnEdgeLaps`);
  const transverse = transverseAxis(laps.roadEdge);
  const longitudinal = longitudinalAxis(laps.roadEdge);
  const sign = edgeSign(laps.roadEdge);
  const halfLongM = landmark.size[longitudinal] / 2;
  const visual = parkLawnVisualRect(landmark);
  const visualCenterLocal = worldToParkLocal(landmark, visual.center);
  const visualBuildingEdge =
    visualCenterLocal[transverse] - (sign * visual.size[transverse]) / 2;
  const logicalBuildingEdge = (-sign * landmark.size[transverse]) / 2;
  const backingBlockIds = new Set<string>(target.backingBlockIds ?? []);
  const backingSolids: {
    readonly blockId: string;
    readonly buildingId: string;
    readonly solidId: string;
    readonly corners: readonly Point2[];
    readonly minLongM: number;
    readonly maxLongM: number;
  }[] = [];

  const addSolid = (
    blockId: string,
    buildingId: string,
    solidId: string,
    worldCorners: readonly Point2[],
  ) => {
    const localCorners = worldCorners.map((corner) =>
      worldToParkLocal(landmark, corner),
    );
    const longBounds = boundsAlong(localCorners, longitudinal);
    const minLongM = Math.max(-halfLongM, longBounds.min);
    const maxLongM = Math.min(halfLongM, longBounds.max);
    if (maxLongM - minLongM <= EPSILON_M) return;
    backingSolids.push({
      blockId,
      buildingId,
      solidId,
      corners: localCorners,
      minLongM,
      maxLongM,
    });
  };

  for (const building of layout.buildings) {
    if (!backingBlockIds.has(building.blockId)) continue;
    for (const solid of building.solids) {
      addSolid(
        building.blockId,
        building.id,
        solid.localId,
        structuralSolidCorners(solid),
      );
    }
  }
  for (const backingId of target.backingLandmarkIds ?? []) {
    const backing = landmarkById(backingId);
    const worldCorners = (
      [
        { x: -backing.size.x / 2, z: -backing.size.z / 2 },
        { x: -backing.size.x / 2, z: backing.size.z / 2 },
        { x: backing.size.x / 2, z: backing.size.z / 2 },
        { x: backing.size.x / 2, z: -backing.size.z / 2 },
      ] as const
    ).map((corner) => parkLocalToWorld(backing, corner));
    addSolid(backingId, `landmark:${backingId}`, "footprint", worldCorners);
  }

  const nearestBuildingAt = (sampleLongM: number) => {
    let nearest:
      | {
          readonly blockId: string;
          readonly buildingId: string;
          readonly solidId: string;
          readonly face: number;
          readonly gapM: number;
        }
      | undefined;
    for (const solid of backingSolids) {
      if (
        sampleLongM < solid.minLongM - EPSILON_M ||
        sampleLongM > solid.maxLongM + EPSILON_M
      ) {
        continue;
      }
      const slice = transverseSliceBounds(
        solid.corners,
        longitudinal,
        transverse,
        sampleLongM,
      );
      if (!slice) continue;
      const face = sign > 0 ? slice.max : slice.min;
      const gapM = sign * (logicalBuildingEdge - face);
      if (gapM < -EPSILON_M || (nearest && gapM >= nearest.gapM)) continue;
      nearest = {
        blockId: solid.blockId,
        buildingId: solid.buildingId,
        solidId: solid.solidId,
        face,
        gapM,
      };
    }
    return nearest;
  };

  const label = `${target.id} seed ${layout.trafficSeed}`;
  const nearestBuilding = nearestBuildingAt(target.sampleLongM);
  expect(nearestBuilding, `${label} backing building`).toBeDefined();
  expect(nearestBuilding?.blockId, label).toBe(target.expectedBackingOwnerId);
  if (!nearestBuilding) return;
  expect(
    sign * (nearestBuilding.face - visualBuildingEdge),
    `${label} building-side overlap (logical gap ${nearestBuilding.gapM.toFixed(3)} m)`,
  ).toBeGreaterThanOrEqual(MIN_BUILDING_EDGE_LAP_M - EPSILON_M);

  // Every projected corner can change the active OBB edge. Between adjacent
  // corners each face is linear; pairwise line crossings can change which
  // facade is nearest, so those crossings join the interval samples too.
  const breakpoints = [
    -halfLongM,
    halfLongM,
    ...backingSolids.flatMap((solid) =>
      solid.corners.map((corner) =>
        Math.max(-halfLongM, Math.min(halfLongM, corner[longitudinal])),
      ),
    ),
  ].sort((left, right) => left - right);
  const facesAt = (sampleLongM: number) => {
    const faces = new Map<string, number>();
    for (const solid of backingSolids) {
      const slice = transverseSliceBounds(
        solid.corners,
        longitudinal,
        transverse,
        sampleLongM,
      );
      if (!slice) continue;
      const face = sign > 0 ? slice.max : slice.min;
      const gapM = sign * (logicalBuildingEdge - face);
      if (gapM < -EPSILON_M) continue;
      faces.set(`${solid.buildingId}/${solid.solidId}`, gapM);
    }
    return faces;
  };

  let checkedIntervals = 0;
  for (let index = 1; index < breakpoints.length; index += 1) {
    const left = breakpoints[index - 1];
    const right = breakpoints[index];
    if (right - left <= EPSILON_M) continue;
    const insetM = Math.min(0.000_01, (right - left) / 4);
    const intervalLeft = left + insetM;
    const intervalRight = right - insetM;
    const samples = [intervalLeft, (left + right) / 2, intervalRight];
    const leftFaces = facesAt(intervalLeft);
    const rightFaces = facesAt(intervalRight);
    const sharedFaces = [...leftFaces.keys()].filter((key) =>
      rightFaces.has(key),
    );
    for (let a = 0; a < sharedFaces.length; a += 1) {
      for (let b = a + 1; b < sharedFaces.length; b += 1) {
        const aLeft = leftFaces.get(sharedFaces[a]);
        const aRight = rightFaces.get(sharedFaces[a]);
        const bLeft = leftFaces.get(sharedFaces[b]);
        const bRight = rightFaces.get(sharedFaces[b]);
        if (
          aLeft === undefined ||
          aRight === undefined ||
          bLeft === undefined ||
          bRight === undefined
        ) {
          continue;
        }
        const deltaChangeM = aRight - aLeft - (bRight - bLeft);
        if (Math.abs(deltaChangeM) <= EPSILON_M) continue;
        const t = -(aLeft - bLeft) / deltaChangeM;
        if (t > 0 && t < 1) {
          samples.push(intervalLeft + t * (intervalRight - intervalLeft));
        }
      }
    }

    for (const sampleLongM of samples) {
      const nearest = nearestBuildingAt(sampleLongM);
      if (!nearest) continue;
      checkedIntervals += 1;
      expect(
        sign * (nearest.face - visualBuildingEdge),
        `${label} full-run overlap at local ${longitudinal}=${sampleLongM.toFixed(5)} against ${nearest.buildingId}/${nearest.solidId} (logical gap ${nearest.gapM.toFixed(3)} m)`,
      ).toBeGreaterThanOrEqual(MIN_BUILDING_EDGE_LAP_M - EPSILON_M);
    }
  }
  expect(checkedIntervals, `${label} sampled backing intervals`).toBeGreaterThan(0);
}

describe("London roadside lawn visual edge laps", () => {
  it("authors every curbside ribbon and changes only its transverse visual extent", () => {
    // Chelsea's old King's Road lawn ribbon was retired with the disconnected
    // patchwork parks; the two formal Cheyne Walk gardens are ordinary park
    // rectangles and do not use the curb-lap system.
    expect(ROADSIDE_LAWNS).toHaveLength(18);
    expect(
      LONDON_MAP_PACK.geometry.landmarks
        .filter((landmark) => landmark.lawnEdgeLaps)
        .map((landmark) => landmark.id)
        .sort(),
    ).toEqual(ROADSIDE_LAWNS.map((target) => target.id).sort());

    for (const target of ROADSIDE_LAWNS) {
      const landmark = landmarkById(target.id);
      const laps = landmark.lawnEdgeLaps;
      expect(laps, target.id).toBeDefined();
      expect(laps?.roadEdge, target.id).toBe(target.roadEdge);
      expect(laps?.roadSurfaceId, target.id).toBe(target.roadId);
      expect(laps?.additionalRoadSurfaceIds ?? [], target.id).toEqual(
        target.additionalRoadIds ?? [],
      );
      if (!laps) continue;

      const visual = parkLawnVisualRect(landmark);
      const transverse = transverseAxis(laps.roadEdge);
      const longitudinal = longitudinalAxis(laps.roadEdge);
      const sign = edgeSign(laps.roadEdge);
      const visualCenterLocal = worldToParkLocal(landmark, visual.center);

      expect(visual.headingDeg, target.id).toBe(landmark.headingDeg);
      expect(visual.size[longitudinal], target.id).toBeCloseTo(
        landmark.size[longitudinal],
        8,
      );
      expect(visualCenterLocal[longitudinal], target.id).toBeCloseTo(0, 8);
      expect(visual.size[transverse], target.id).toBeCloseTo(
        landmark.size[transverse] + laps.roadM + laps.buildingM,
        8,
      );
      expect(visualCenterLocal[transverse], target.id).toBeCloseTo(
        (sign * (laps.roadM - laps.buildingM)) / 2,
        8,
      );

      const bands = parkLawnEdgeLapBands(landmark);
      expect(bands, `${target.id} edge bands`).toHaveLength(2);
      for (const band of bands) {
        const bandCenterLocal = worldToParkLocal(landmark, band.center);
        expect(band.size[longitudinal], target.id).toBeCloseTo(
          landmark.size[longitudinal],
          8,
        );
        expect(bandCenterLocal[longitudinal], target.id).toBeCloseTo(0, 8);
      }
    }
  });

  it("keeps derived paths away from the two raised transverse bands", () => {
    for (const target of ROADSIDE_LAWNS) {
      const landmark = landmarkById(target.id);
      const transverse = transverseAxis(target.roadEdge);
      const halfTransverseM = landmark.size[transverse] / 2;
      for (const path of parkLayoutForLandmark(LONDON_MAP_PACK, landmark).paths) {
        for (const endpoint of [path.points[0], path.points.at(-1)]) {
          if (!endpoint) continue;
          const local = worldToParkLocal(landmark, endpoint);
          expect(
            Math.abs(local[transverse]),
            `${target.id}/${path.id} terminates under a raised grass band`,
          ).toBeLessThan(halfTransverseM - EPSILON_M);
        }
      }
    }
  });

  it("laps under each asphalt curb and every planned backing facade", () => {
    const layout = planMapBuildings(
      LONDON_MAP_PACK,
      2251,
      relaxationPolicyForMap(LONDON_MAP_PACK.id),
    );
    for (const target of ROADSIDE_LAWNS) {
      const landmark = landmarkById(target.id);
      const laps = landmark.lawnEdgeLaps;
      if (!laps) throw new Error(`${target.id} has no lawnEdgeLaps`);
      const targetRoadIds = [target.roadId, ...(target.additionalRoadIds ?? [])];
      const roads = targetRoadIds.map((roadId) => {
        const road = LONDON_MAP_PACK.geometry.roadSurfaces.find(
          (candidate) => candidate.id === roadId,
        );
        if (!road) throw new Error(`Missing London road surface ${roadId}`);
        return road;
      });
      const road = roads[0];

      const transverse = transverseAxis(laps.roadEdge);
      const longitudinal = longitudinalAxis(laps.roadEdge);
      const sign = edgeSign(laps.roadEdge);
      const halfLongM = landmark.size[longitudinal] / 2;
      const visual = parkLawnVisualRect(landmark);
      const visualCenterLocal = worldToParkLocal(landmark, visual.center);
      const visualRoadEdge =
        visualCenterLocal[transverse] +
        (sign * visual.size[transverse]) / 2;

      const logicalRoadEdgeLocal: Point2 =
        transverse === "x"
          ? { x: (sign * landmark.size.x) / 2, z: 0 }
          : { x: 0, z: (sign * landmark.size.z) / 2 };
      const logicalRoadEdgeWorld = parkLocalToWorld(
        landmark,
        logicalRoadEdgeLocal,
      );
      const roadCenter = nearestPointOnPolyline(
        logicalRoadEdgeWorld,
        road.centerline,
      );
      const towardParkX = logicalRoadEdgeWorld.x - roadCenter.x;
      const towardParkZ = logicalRoadEdgeWorld.z - roadCenter.z;
      const centerToParkM = Math.hypot(towardParkX, towardParkZ);
      expect(centerToParkM, target.id).toBeGreaterThan(0);
      const curbRadiusM = road.widthM / 2;
      const curbWorld = {
        x: roadCenter.x +
          (towardParkX / centerToParkM) * curbRadiusM,
        z: roadCenter.z +
          (towardParkZ / centerToParkM) * curbRadiusM,
      };
      const curbLocal = worldToParkLocal(landmark, curbWorld)[transverse];
      const curbOverlapM = sign * (visualRoadEdge - curbLocal);
      expect(curbOverlapM, `${target.id} curb-side overlap`).toBeGreaterThanOrEqual(
        MIN_CURB_EDGE_LAP_M - EPSILON_M,
      );

      let minimumRoadOverlapM = Number.POSITIVE_INFINITY;
      let minimumRoadOverlapAtM = 0;
      const heading = ((landmark.headingDeg ?? 0) * Math.PI) / 180;
      const localRoadX = transverse === "x" ? sign : 0;
      const localRoadZ = transverse === "z" ? sign : 0;
      const roadwardX =
        localRoadX * Math.cos(heading) + localRoadZ * Math.sin(heading);
      const roadwardZ =
        -localRoadX * Math.sin(heading) + localRoadZ * Math.cos(heading);
      const localLongX = longitudinal === "x" ? 1 : 0;
      const localLongZ = longitudinal === "z" ? 1 : 0;
      const longitudinalX =
        localLongX * Math.cos(heading) + localLongZ * Math.sin(heading);
      const longitudinalZ =
        -localLongX * Math.sin(heading) + localLongZ * Math.cos(heading);
      for (
        let sampleLongM = -halfLongM;
        sampleLongM <= halfLongM + EPSILON_M;
        sampleLongM = Math.min(halfLongM, sampleLongM + 1)
      ) {
        const logicalEdgeLocal = { x: 0, z: 0 };
        logicalEdgeLocal[transverse] =
          (sign * landmark.size[transverse]) / 2;
        logicalEdgeLocal[longitudinal] = sampleLongM;
        const logicalEdgeWorld = parkLocalToWorld(landmark, logicalEdgeLocal);
        for (const targetRoad of roads) {
          const roadProjection = nearestProjectionOnPolyline(
            logicalEdgeWorld,
            targetRoad.centerline,
          );
          const nearestRoadCenter = roadProjection.point;
          const segmentStart = targetRoad.centerline[roadProjection.segmentIndex];
          const segmentEnd = targetRoad.centerline[roadProjection.segmentIndex + 1];
          const segmentLengthM = Math.hypot(
            segmentEnd.x - segmentStart.x,
            segmentEnd.z - segmentStart.z,
          );
          const tangentAlignment =
            segmentLengthM > EPSILON_M
              ? Math.abs(
                  ((segmentEnd.x - segmentStart.x) * longitudinalX +
                    (segmentEnd.z - segmentStart.z) * longitudinalZ) /
                    segmentLengthM,
                )
              : 0;
          const fromRoadX = logicalEdgeWorld.x - nearestRoadCenter.x;
          const fromRoadZ = logicalEdgeWorld.z - nearestRoadCenter.z;
          const fromRoadM = Math.hypot(fromRoadX, fromRoadZ);
          const roadwardAlignment =
            fromRoadM > EPSILON_M
              ? (-(fromRoadX * roadwardX + fromRoadZ * roadwardZ)) / fromRoadM
              : -1;
          // At a right-angle corner the perpendicular ribbon owns the turn;
          // this declared edge applies only along aligned interior segments.
          if (
            fromRoadM > EPSILON_M &&
            roadProjection.t > EPSILON_M &&
            roadProjection.t < 1 - EPSILON_M &&
            tangentAlignment >= 0.9 &&
            roadwardAlignment >= 0.9
          ) {
            const curbEdgeWorld = {
              x:
                nearestRoadCenter.x +
                (fromRoadX / fromRoadM) * (targetRoad.widthM / 2),
              z:
                nearestRoadCenter.z +
                (fromRoadZ / fromRoadM) * (targetRoad.widthM / 2),
            };
            const curbEdgeLocal = worldToParkLocal(landmark, curbEdgeWorld);
            const overlapM = sign * (visualRoadEdge - curbEdgeLocal[transverse]);
            if (overlapM < minimumRoadOverlapM) {
              minimumRoadOverlapM = overlapM;
              minimumRoadOverlapAtM = sampleLongM;
            }
          }
        }
        if (sampleLongM >= halfLongM) break;
      }
      expect(
        minimumRoadOverlapM,
        `${target.id} minimum curb-side overlap at local ${longitudinal}=${minimumRoadOverlapAtM.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_CURB_EDGE_LAP_M - EPSILON_M);

      assertBackingFacadeOverlap(target, landmark, layout);
    }
  });

  it("keeps procedural facade corners on grass across known career seeds", () => {
    const layouts = new Map<number, BuildingLayoutPlan>();
    for (const target of ROADSIDE_LAWNS) {
      for (const trafficSeed of target.stressSeeds ?? []) {
        let layout = layouts.get(trafficSeed);
        if (!layout) {
          layout = planMapBuildings(
            LONDON_MAP_PACK,
            trafficSeed,
            relaxationPolicyForMap(LONDON_MAP_PACK.id),
          );
          layouts.set(trafficSeed, layout);
        }
        assertBackingFacadeOverlap(target, landmarkById(target.id), layout);
      }
    }
    expect(layouts.size).toBe(3);
  });

  it("records the logical lawn and expanded apron in ground-surface characterization", () => {
    const surfaces = collectGroundSurfaces(LONDON_MAP_PACK);

    for (const target of ROADSIDE_LAWNS) {
      const landmark = landmarkById(target.id);
      const targetRoadIds = new Set([
        target.roadId,
        ...(target.additionalRoadIds ?? []),
      ]);
      const logicalSurface = surfaces.find(
        (candidate) => candidate.id === `park-${target.id}`,
      );
      expect(logicalSurface, target.id).toBeDefined();
      expect(logicalSurface?.surfaceY, target.id).toBe(PARK_LAWN_Y);
      const apronSurface = surfaces.find(
        (candidate) => candidate.id === `park-edge-lap-${target.id}`,
      );
      expect(apronSurface, target.id).toBeDefined();
      expect(apronSurface?.surfaceY, target.id).toBeCloseTo(
        PARK_LAWN_Y + parkLawnEdgeLapLiftM(landmark),
        8,
      );
      expect(apronSurface?.surfaceY, `${target.id} covers sidewalk`).toBeGreaterThan(
        ROAD_SHOULDER_Y,
      );
      expect(apronSurface?.surfaceY, `${target.id} stays below road`).toBeLessThan(
        ROAD_SURFACE_Y,
      );
      expect(
        apronSurface?.surfaceY,
        `${target.id} stays below building foundations`,
      ).toBeLessThan(BUILDING_GROUND_LIFT);
      expect(apronSurface?.geometry.kind, target.id).toBe("multiPolygon");
      if (!apronSurface || apronSurface.geometry.kind !== "multiPolygon") continue;

      const expected = parkLawnEdgeLapGeometry(LONDON_MAP_PACK, landmark);
      expect(apronSurface.geometry, target.id).toEqual(expected);
      expect(expected.parts.length, target.id).toBeGreaterThan(0);
      expect(
        expected.parts.every((part) => !part.holes?.length),
        `${target.id} apron stays simple-ring triangulable`,
      ).toBe(true);
      expect(
        pointInShape(expected, landmark.center.x, landmark.center.z),
        `${target.id} logical centre stays on the lower lawn rung`,
      ).toBe(false);

      for (const foreignSurface of surfaces) {
        const isForeignSidewalk =
          foreignSurface.kind === "sidewalk" &&
          !targetRoadIds.has(foreignSurface.ownerId);
        const isShoulderJunction =
          foreignSurface.kind === "junction" &&
          foreignSurface.surfaceY < ROAD_SHOULDER_Y;
        if (!isForeignSidewalk && !isShoulderJunction) continue;
        expect(
          booleanIntersectionArea(expected, foreignSurface.geometry),
          `${target.id} overwrites ${foreignSurface.id}`,
        ).toBeLessThan(MAX_CLIPPING_SLIVER_AREA_M2);
      }
    }
  });

  it("keeps every overlapping lawn surface on a distinct y-rung", () => {
    const parkSurfaces = collectGroundSurfaces(LONDON_MAP_PACK).filter(
      (surface) => surface.kind === "park",
    );
    for (let left = 0; left < parkSurfaces.length; left += 1) {
      for (let right = left + 1; right < parkSurfaces.length; right += 1) {
        const a = parkSurfaces[left];
        const b = parkSurfaces[right];
        if (
          !a.id.startsWith("park-edge-lap-") &&
          !b.id.startsWith("park-edge-lap-")
        ) {
          continue;
        }
        if (Math.abs(a.surfaceY - b.surfaceY) > EPSILON_M) continue;
        expect(
          booleanIntersectionArea(a.geometry, b.geometry),
          `${a.id} and ${b.id} are coplanar`,
        ).toBeLessThan(EPSILON_M);
      }
    }
  });

  it("builds every Babylon lawn mesh from that resolved visual rectangle", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const masters = createParksRenderMasters();
    masters.parkLawnMaterial = new StandardMaterial(
      "roadside-lawn-test-material",
      scene,
    );
    const mirrorSurfaces: AbstractMesh[] = [];
    const ctx: ParksRenderCtx = {
      scene,
      masters,
      lowSpec: true,
      registerMirrorSurface: (mesh) => {
        if (mesh) mirrorSurfaces.push(mesh);
      },
      applyGrassDetailMap: () => {},
      applyWorldPlanarGrassUVs: () => {},
      registerStaticCell: () => {},
      registerShadowCaster: () => {},
      createRoadSurfaceMesh: () => undefined,
    };
    const palette = resolveMapVisualPalette(LONDON_MAP_PACK.id);

    try {
      for (const target of ROADSIDE_LAWNS) {
        const landmark = landmarkById(target.id);
        const expectedApron = parkLawnEdgeLapGeometry(
          LONDON_MAP_PACK,
          landmark,
        );
        const expectedApronBounds = aabbOfShape(expectedApron);
        const lawn = buildParkLawn(
          ctx,
          landmark,
          palette,
          LONDON_MAP_PACK.id,
          LONDON_MAP_PACK,
        );
        const positions = lawn.getVerticesData(VertexBuffer.PositionKind);
        const uvs = lawn.getVerticesData(VertexBuffer.UVKind);
        expect(positions, target.id).not.toBeNull();
        expect(uvs, target.id).not.toBeNull();
        if (!positions || !uvs) continue;

        const apronWorldXs: number[] = [];
        const apronWorldZs: number[] = [];
        const logicalXs: number[] = [];
        const logicalZs: number[] = [];
        const ys: number[] = [];
        for (let index = 0; index < positions.length; index += 3) {
          ys.push(positions[index + 1]);
          if (positions[index + 1] <= EPSILON_M) {
            logicalXs.push(positions[index]);
            logicalZs.push(positions[index + 2]);
          }
        }
        expect(Math.min(...logicalXs), target.id).toBeCloseTo(
          -landmark.size.x / 2,
          8,
        );
        expect(Math.max(...logicalXs), target.id).toBeCloseTo(
          landmark.size.x / 2,
          8,
        );
        expect(Math.min(...logicalZs), target.id).toBeCloseTo(
          -landmark.size.z / 2,
          8,
        );
        expect(Math.max(...logicalZs), target.id).toBeCloseTo(
          landmark.size.z / 2,
          8,
        );
        expect(lawn.position.x, target.id).toBeCloseTo(landmark.center.x, 8);
        expect(lawn.position.z, target.id).toBeCloseTo(landmark.center.z, 8);
        expect(Math.min(...ys), target.id).toBeCloseTo(
          0,
          8,
        );
        expect(Math.max(...ys), target.id).toBeCloseTo(
          parkLawnEdgeLapLiftM(landmark),
          8,
        );
        expect(lawn.rotation.y, target.id).toBeCloseTo(
          ((landmark.headingDeg ?? 0) * Math.PI) / 180,
          8,
        );
        const cos = Math.cos(lawn.rotation.y);
        const sin = Math.sin(lawn.rotation.y);
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
          const localX = positions[vertex * 3];
          const localZ = positions[vertex * 3 + 2];
          const worldX = landmark.center.x + localX * cos + localZ * sin;
          const worldZ = landmark.center.z - localX * sin + localZ * cos;
          if (positions[vertex * 3 + 1] > EPSILON_M) {
            apronWorldXs.push(worldX);
            apronWorldZs.push(worldZ);
          }
          expect(uvs[vertex * 2], `${target.id} vertex ${vertex} u`).toBeCloseTo(
            worldX / GRASS_TILE_M,
            6,
          );
          expect(
            uvs[vertex * 2 + 1],
            `${target.id} vertex ${vertex} v`,
          ).toBeCloseTo(worldZ / GRASS_TILE_M, 6);
        }
        expect(apronWorldXs, `${target.id} apron vertices`).toHaveLength(
          expectedApron.parts.reduce(
            (count, part) => count + part.outer.length,
            0,
          ),
        );
        expect(Math.min(...apronWorldXs), target.id).toBeCloseTo(
          expectedApronBounds.minX,
          6,
        );
        expect(Math.max(...apronWorldXs), target.id).toBeCloseTo(
          expectedApronBounds.maxX,
          6,
        );
        expect(Math.min(...apronWorldZs), target.id).toBeCloseTo(
          expectedApronBounds.minZ,
          6,
        );
        expect(Math.max(...apronWorldZs), target.id).toBeCloseTo(
          expectedApronBounds.maxZ,
          6,
        );
        expect(lawn.subMeshes, `${target.id} one draw range`).toHaveLength(1);
        expect(mirrorSurfaces.at(-1), target.id).toBe(lawn);
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
