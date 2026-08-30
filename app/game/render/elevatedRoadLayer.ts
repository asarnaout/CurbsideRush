import {
  Color3,
  Constants,
  Mesh,
  MeshBuilder,
  RawTexture,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type AbstractMesh,
} from "@babylonjs/core";
import {
  ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
  ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
  ELEVATED_ROAD_PARAPET_DECK_INSET_M,
  ELEVATED_ROAD_PARAPET_HEIGHT_M,
  ELEVATED_ROAD_PIER_COLUMN_BOTTOM_DIAMETER_M,
  ELEVATED_ROAD_PIER_COLUMN_TOP_DIAMETER_M,
  ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M,
  createElevatedRoadDeckHeadroomQuery,
  elevatedRoadDeckRun,
  elevatedRoadEdgeRuns,
  elevatedRoadEndpointHasStructuralContinuation,
  elevatedRoadJunctionEnvelopes,
  elevatedRoadParapetDepthM,
  elevatedRoadPierPlacements,
  elevatedRoadSegmentPlacements,
  type ElevatedRoadDeckRunPlacement,
  type ElevatedRoadEdgeRunPlacement,
  type ElevatedRoadGeometrySurface,
  type ElevatedRoadJunctionEnvelope,
  type ElevatedRoadJunctionGuardRun,
  type ElevatedRoadSegmentPlacement,
} from "../geometry/elevatedRoadGeometry";
import type { GameCanvasMapPack } from "../sessionContract";
import { isElevatedRoadSurface } from "../roadElevation";
import { createBox, setMeshMaterial } from "./meshPrimitives";

const GIRDER_HEIGHT_M = 0.72;

export const CAIRO_BRIDGE_PARAPET_COPING_HEIGHT_M = 0.1;
export const CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M = 0.52;
export const CAIRO_BRIDGE_PARAPET_RAIL_POST_SPACING_M = 1.35;
export const CAIRO_BRIDGE_PARAPET_REFLECTOR_SPACING_M = 9;
export const CAIRO_BRIDGE_LAMP_SPACING_M = 26;
export const CAIRO_BRIDGE_LAMP_END_INSET_M = 3;
export const CAIRO_BRIDGE_LAMP_HEIGHT_M = 5.8;
const CAIRO_BRIDGE_LAMP_OVERHEAD_CLEARANCE_M = 0.1;
// Tokyo deliberately reuses Cairo's proven detailed geometry dimensions. The
// inward-facing arm and head reach almost two metres from the parapet pole, so
// both styles test that complete plan footprint against higher flyover decks.
const CAIRO_BRIDGE_LAMP_OVERHEAD_FOOTPRINT_RADIUS_M = 2;
export const CAIRO_BRIDGE_PARAPET_TOTAL_HEIGHT_M =
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
  ELEVATED_ROAD_PARAPET_HEIGHT_M +
  CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M;

export interface CairoBridgeBarrierVisualPlan {
  readonly railPostOffsetsM: readonly number[];
  readonly reflectorOffsetsM: readonly number[];
}

export interface CairoBridgeLampStation {
  readonly offsetM: number;
  readonly side: -1 | 1;
}

const gridOffsetsWithinRun = (
  runLengthM: number,
  runStartDistanceM: number,
  spacingM: number,
  insetM: number,
): number[] => {
  const startM = runStartDistanceM + insetM;
  const endM = runStartDistanceM + runLengthM - insetM;
  if (endM < startM) return [];
  const offsets: number[] = [];
  for (
    let distanceM = Math.ceil(startM / spacingM) * spacingM;
    distanceM <= endM + 1e-6;
    distanceM += spacingM
  ) {
    offsets.push(distanceM - (runStartDistanceM + runLengthM / 2));
  }
  return offsets;
};

/**
 * Repeatable detailed barrier geometry laid out in surface-distance space.
 * The Cairo-named export is retained for compatibility; Tokyo deliberately
 * uses the same global post/reflector phase so the rhythm does not restart at
 * an authored polyline segment or trimmed flyover junction.
 */
export function cairoBridgeBarrierVisualPlan(
  runLengthM: number,
  runStartDistanceM = 0,
): CairoBridgeBarrierVisualPlan {
  const lengthM = Math.max(0, runLengthM);
  const railInsetM = Math.min(0.08, lengthM / 4);
  const railPostOffsetsM = gridOffsetsWithinRun(
    lengthM,
    runStartDistanceM,
    CAIRO_BRIDGE_PARAPET_RAIL_POST_SPACING_M,
    railInsetM,
  );
  if (lengthM >= 0.2) {
    railPostOffsetsM.unshift(-lengthM / 2 + railInsetM);
    railPostOffsetsM.push(lengthM / 2 - railInsetM);
  }

  const reflectorOffsetsM = gridOffsetsWithinRun(
    lengthM,
    runStartDistanceM,
    CAIRO_BRIDGE_PARAPET_REFLECTOR_SPACING_M,
    0.55,
  );
  if (!reflectorOffsetsM.length && lengthM >= 1.2) {
    reflectorOffsetsM.push(0);
  }

  return { railPostOffsetsM, reflectorOffsetsM };
}

/**
 * One globally phased, alternating lamp line for each detailed bridge style.
 * The Cairo-named export is retained for compatibility. Planning in surface-
 * distance space keeps the rhythm continuous across short authored segments
 * while the renderer can discard stations in an unsupported junction opening.
 */
export function cairoBridgeLampVisualPlan(
  runLengthM: number,
  runStartDistanceM = 0,
): readonly CairoBridgeLampStation[] {
  const lengthM = Math.max(0, runLengthM);
  return gridOffsetsWithinRun(
    lengthM,
    runStartDistanceM,
    CAIRO_BRIDGE_LAMP_SPACING_M,
    Math.min(CAIRO_BRIDGE_LAMP_END_INSET_M, lengthM / 2),
  ).map((offsetM) => {
    const stationDistanceM =
      runStartDistanceM + lengthM / 2 + offsetM;
    const stationIndex = Math.round(
      stationDistanceM / CAIRO_BRIDGE_LAMP_SPACING_M,
    );
    return {
      offsetM,
      side: stationIndex % 2 === 0 ? -1 : 1,
    };
  });
}

const appendQuad = (
  positions: number[],
  indices: number[],
  points: readonly [number, number, number][],
): void => {
  const base = positions.length / 3;
  for (const point of points) positions.push(...point);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const appendTriangle = (
  positions: number[],
  indices: number[],
  points: readonly [number, number, number][],
): void => {
  const base = positions.length / 3;
  for (const point of points) positions.push(...point);
  indices.push(base, base + 1, base + 2);
};

interface CompoundBox {
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

interface CompoundQuad {
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly normalZ: -1 | 1;
}

const appendCompoundBox = (
  positions: number[],
  indices: number[],
  box: CompoundBox,
): void => {
  const [cx, cy, cz] = box.center;
  const [width, height, depth] = box.size;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  appendQuad(positions, indices, [
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]);
  appendQuad(positions, indices, [
    [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
  ]);
  appendQuad(positions, indices, [
    [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
  ]);
  appendQuad(positions, indices, [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
  ]);
  appendQuad(positions, indices, [
    [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
  ]);
  appendQuad(positions, indices, [
    [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
  ]);
};

const appendCompoundQuad = (
  positions: number[],
  indices: number[],
  quad: CompoundQuad,
): void => {
  const [cx, cy, cz] = quad.center;
  const [width, height] = quad.size;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  appendQuad(
    positions,
    indices,
    quad.normalZ > 0
      ? [[x0, y0, cz], [x1, y0, cz], [x1, y1, cz], [x0, y1, cz]]
      : [[x1, y0, cz], [x0, y0, cz], [x0, y1, cz], [x1, y1, cz]],
  );
};

const createVertexMesh = (
  scene: Scene,
  name: string,
  positions: number[],
  indices: number[],
  meshMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh => {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  setMeshMaterial(mesh, meshMaterial);
  mesh.parent = parent;
  mesh.isPickable = false;
  return mesh;
};

const createCompoundBoxMesh = (
  scene: Scene,
  name: string,
  boxes: readonly CompoundBox[],
  meshMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh | null => {
  if (!boxes.length) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const box of boxes) appendCompoundBox(positions, indices, box);
  return createVertexMesh(scene, name, positions, indices, meshMaterial, parent);
};

const createCompoundQuadMesh = (
  scene: Scene,
  name: string,
  quads: readonly CompoundQuad[],
  meshMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh | null => {
  if (!quads.length) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const quad of quads) appendCompoundQuad(positions, indices, quad);
  return createVertexMesh(scene, name, positions, indices, meshMaterial, parent);
};

const createCairoParapetShell = (
  scene: Scene,
  name: string,
  run: ElevatedRoadEdgeRunPlacement,
  segment: ElevatedRoadSegmentPlacement,
  parapetDepthM: number,
  meshMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh => {
  const positions: number[] = [];
  const indices: number[] = [];
  const startX = run.centerAlongM - run.lengthM / 2;
  const endX = run.centerAlongM + run.lengthM / 2;
  const lateralCenterM =
    run.side *
    (segment.deckWidthM / 2 - ELEVATED_ROAD_PARAPET_DECK_INSET_M);
  const halfDepthM = parapetDepthM / 2;
  const bottomY = ELEVATED_ROAD_PARAPET_BASE_LIFT_M;
  const topY = bottomY + ELEVATED_ROAD_PARAPET_HEIGHT_M;
  // Cross-section proceeds around a New-Jersey-style traffic toe, narrower
  // upper stem and nearly vertical outer fascia. `outwardM` is mirrored for
  // the two bridge edges.
  const profile: readonly { readonly outwardM: number; readonly y: number }[] = [
    { outwardM: -halfDepthM, y: bottomY },
    { outwardM: halfDepthM, y: bottomY },
    { outwardM: halfDepthM - 0.025, y: topY },
    { outwardM: -0.07, y: topY },
    { outwardM: -0.07, y: bottomY + 0.58 },
    { outwardM: -halfDepthM, y: bottomY + 0.19 },
  ];
  const point = (
    x: number,
    item: (typeof profile)[number],
  ): [number, number, number] => [
    x,
    item.y,
    lateralCenterM + run.side * item.outwardM,
  ];
  const appendProfileQuad = (
    points: readonly [number, number, number][],
  ): void => {
    appendQuad(
      positions,
      indices,
      run.side > 0
        ? points
        : [points[0], points[3], points[2], points[1]],
    );
  };
  const appendProfileTriangle = (
    points: readonly [number, number, number][],
  ): void => {
    appendTriangle(
      positions,
      indices,
      run.side > 0 ? points : [points[0], points[2], points[1]],
    );
  };
  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length;
    appendProfileQuad([
      point(startX, profile[index]),
      point(endX, profile[index]),
      point(endX, profile[next]),
      point(startX, profile[next]),
    ]);
  }
  for (let index = 1; index + 1 < profile.length; index += 1) {
    appendProfileTriangle([
      point(startX, profile[0]),
      point(startX, profile[index + 1]),
      point(startX, profile[index]),
    ]);
    appendProfileTriangle([
      point(endX, profile[0]),
      point(endX, profile[index]),
      point(endX, profile[index + 1]),
    ]);
  }
  return createVertexMesh(scene, name, positions, indices, meshMaterial, parent);
};

/**
 * One structural slab without the closed-box fascia that used to wall off
 * every T-junction. Top and soffit stay continuous; the two long vertical
 * faces are emitted only for the edge runs that survive the ramp openings.
 */
const createJunctionAwareDeck = (
  scene: Scene,
  name: string,
  surface: ElevatedRoadGeometrySurface,
  segment: ElevatedRoadSegmentPlacement,
  deckRun: ElevatedRoadDeckRunPlacement,
  edgeRuns: readonly ElevatedRoadEdgeRunPlacement[],
  allSurfaces: readonly ElevatedRoadGeometrySurface[],
  deckMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh => {
  const positions: number[] = [];
  const indices: number[] = [];
  const startX = deckRun.centerAlongM - deckRun.lengthM / 2;
  const endX = deckRun.centerAlongM + deckRun.lengthM / 2;
  const halfWidthM = segment.deckWidthM / 2;
  const asphaltHalfWidthM = surface.widthM / 2;
  const bottomY = -ELEVATED_ROAD_DECK_SLAB_THICKNESS_M;

  // The core sits directly below asphalt and remains continuous through a
  // merge. Concrete overhangs are side pieces below, so an opening in the
  // fascia also removes the pale top lip that otherwise crosses the mouth.
  appendQuad(positions, indices, [
    [startX, 0, -asphaltHalfWidthM],
    [startX, 0, asphaltHalfWidthM],
    [endX, 0, asphaltHalfWidthM],
    [endX, 0, -asphaltHalfWidthM],
  ]);
  appendQuad(positions, indices, [
    [startX, bottomY, -asphaltHalfWidthM],
    [endX, bottomY, -asphaltHalfWidthM],
    [endX, bottomY, asphaltHalfWidthM],
    [startX, bottomY, asphaltHalfWidthM],
  ]);

  // Side fascia follows the already-split parapet/girder intervals. Clamp to
  // a branch deck cutback because its top can end before either edge does.
  for (const run of edgeRuns) {
    const runStartX = Math.max(
      startX,
      run.centerAlongM - run.lengthM / 2,
    );
    const runEndX = Math.min(
      endX,
      run.centerAlongM + run.lengthM / 2,
    );
    if (runEndX - runStartX < 0.02) continue;
    const wingMinZ =
      run.side === 1 ? asphaltHalfWidthM : -halfWidthM;
    const wingMaxZ =
      run.side === 1 ? halfWidthM : -asphaltHalfWidthM;
    appendQuad(positions, indices, [
      [runStartX, 0, wingMinZ],
      [runStartX, 0, wingMaxZ],
      [runEndX, 0, wingMaxZ],
      [runEndX, 0, wingMinZ],
    ]);
    appendQuad(positions, indices, [
      [runStartX, bottomY, wingMinZ],
      [runEndX, bottomY, wingMinZ],
      [runEndX, bottomY, wingMaxZ],
      [runStartX, bottomY, wingMaxZ],
    ]);
    if (run.side === 1) {
      appendQuad(positions, indices, [
        [runStartX, 0, halfWidthM],
        [runStartX, bottomY, halfWidthM],
        [runEndX, bottomY, halfWidthM],
        [runEndX, 0, halfWidthM],
      ]);
    } else {
      appendQuad(positions, indices, [
        [runStartX, 0, -halfWidthM],
        [runEndX, 0, -halfWidthM],
        [runEndX, bottomY, -halfWidthM],
        [runStartX, bottomY, -halfWidthM],
      ]);
    }
  }

  const authoredStart = surface.centerline[segment.segmentIndex];
  const authoredEnd = surface.centerline[segment.segmentIndex + 1];
  const startWasClipped =
    Math.abs(
      segment.startElevationM - (authoredStart?.elevationM ?? 0),
    ) > 0.05;
  const endWasClipped =
    Math.abs(segment.endElevationM - (authoredEnd?.elevationM ?? 0)) > 0.05;
  const capStart =
    deckRun.startTrimM <= 0.001 &&
    (startWasClipped || segment.segmentIndex === 0) &&
    !elevatedRoadEndpointHasStructuralContinuation(
      surface,
      segment,
      allSurfaces,
      "start",
    );
  const capEnd =
    deckRun.endTrimM <= 0.001 &&
    (endWasClipped ||
      segment.segmentIndex + 2 === surface.centerline.length) &&
    !elevatedRoadEndpointHasStructuralContinuation(
      surface,
      segment,
      allSurfaces,
      "end",
    );
  if (capStart) {
    appendQuad(positions, indices, [
      [startX, 0, -halfWidthM],
      [startX, bottomY, -halfWidthM],
      [startX, bottomY, halfWidthM],
      [startX, 0, halfWidthM],
    ]);
  }
  if (capEnd) {
    appendQuad(positions, indices, [
      [endX, 0, -halfWidthM],
      [endX, 0, halfWidthM],
      [endX, bottomY, halfWidthM],
      [endX, bottomY, -halfWidthM],
    ]);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  setMeshMaterial(mesh, deckMaterial);
  mesh.parent = parent;
  mesh.position.set(0, 0, 0);
  return mesh;
};

/** One profiled polygonal slab beneath a shared elevated-road collar. */
const createElevatedJunctionDeck = (
  scene: Scene,
  envelope: ElevatedRoadJunctionEnvelope,
  deckMaterial: StandardMaterial,
  parent: TransformNode,
): Mesh | null => {
  const { points, indices: triangles } = envelope.deckMesh;
  if (points.length < 3 || triangles.length < 3) return null;
  const positions: number[] = [];
  const pivotElevationM = envelope.pivot.elevationM ?? 0;
  for (const point of points) {
    positions.push(
      point.x - envelope.pivot.x,
      (point.elevationM ?? pivotElevationM) - pivotElevationM,
      point.z - envelope.pivot.z,
    );
  }
  const bottomOffset = points.length;
  for (const point of points) {
    positions.push(
      point.x - envelope.pivot.x,
      (point.elevationM ?? pivotElevationM) -
        pivotElevationM -
        ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
      point.z - envelope.pivot.z,
    );
  }
  const indices: number[] = [];
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index];
    const b = triangles[index + 1];
    const c = triangles[index + 2];
    // Babylon's left-handed front-face convention presents the collar TIN's
    // counter-clockwise x/z winding upward. Reverse only the underside.
    indices.push(a, b, c);
    indices.push(bottomOffset + a, bottomOffset + c, bottomOffset + b);
  }
  // Only the exterior guard boundary receives fascia. Arm-mouth caps stay
  // open because the ordinary deck continues beneath them.
  for (const run of envelope.deckGuardRuns) {
    const startTop: [number, number, number] = [
      run.start.x - envelope.pivot.x,
      (run.start.elevationM ?? pivotElevationM) - pivotElevationM,
      run.start.z - envelope.pivot.z,
    ];
    const endTop: [number, number, number] = [
      run.end.x - envelope.pivot.x,
      (run.end.elevationM ?? pivotElevationM) - pivotElevationM,
      run.end.z - envelope.pivot.z,
    ];
    appendQuad(positions, indices, [
      startTop,
      endTop,
      [endTop[0], endTop[1] - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M, endTop[2]],
      [
        startTop[0],
        startTop[1] - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
        startTop[2],
      ],
    ]);
  }
  return createVertexMesh(
    scene,
    `elevated-road-${envelope.id}-collar-slab`,
    positions,
    indices,
    deckMaterial,
    parent,
  );
};

const junctionRunFrame = (
  envelope: ElevatedRoadJunctionEnvelope,
  run: ElevatedRoadJunctionGuardRun,
): {
  readonly rootPosition: Vector3;
  readonly boxYawRad: number;
  readonly slopeRad: number;
  readonly segment: ElevatedRoadSegmentPlacement;
  readonly edgeRun: ElevatedRoadEdgeRunPlacement;
} | null => {
  const dx = run.end.x - run.start.x;
  const dz = run.end.z - run.start.z;
  const planLengthM = Math.hypot(dx, dz);
  if (planLengthM < 0.001) return null;
  const startElevationM = run.start.elevationM ?? envelope.pivot.elevationM ?? 0;
  const endElevationM = run.end.elevationM ?? envelope.pivot.elevationM ?? 0;
  const slopeRad = Math.atan2(endElevationM - startElevationM, planLengthM);
  const segment: ElevatedRoadSegmentPlacement = {
    surfaceId: envelope.id,
    segmentIndex: -1,
    center: {
      x: (run.start.x + run.end.x) / 2,
      z: (run.start.z + run.end.z) / 2,
      elevationM: (startElevationM + endElevationM) / 2,
    },
    lengthM: run.lengthM,
    // Places `createCairoParapetShell`'s side=+1 centre line at local z=0.
    deckWidthM: ELEVATED_ROAD_PARAPET_DECK_INSET_M * 2,
    boxYawRad: Math.atan2(dx, dz) - Math.PI / 2,
    slopeRad,
    startElevationM,
    endElevationM,
  };
  return {
    rootPosition: new Vector3(
      segment.center.x,
      segment.center.elevationM ?? 0,
      segment.center.z,
    ),
    boxYawRad: segment.boxYawRad,
    slopeRad,
    segment,
    edgeRun: {
      surfaceId: envelope.id,
      segmentIndex: -1,
      side: 1,
      centerAlongM: 0,
      lengthM: run.lengthM,
      startTrimM: 0,
      endTrimM: 0,
    },
  };
};

const createElevatedJunctionBarriers = (
  ctx: ElevatedRoadRenderCtx,
  envelope: ElevatedRoadJunctionEnvelope,
  surfaces: readonly ElevatedRoadGeometrySurface[],
  usesDetailedBarrierStyle: boolean,
  concrete: StandardMaterial,
  underside: StandardMaterial,
  parapetConcrete: StandardMaterial,
  copingMaterial: StandardMaterial,
  railMaterial: StandardMaterial,
): void => {
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const parapetDepthM = Math.max(
    ...envelope.surfaceIds.map((surfaceId) =>
      elevatedRoadParapetDepthM(surfaceById.get(surfaceId)!),
    ),
  );
  let distanceBeforeRunM = 0;
  for (const [runIndex, run] of envelope.barrierGuardRuns.entries()) {
    const frame = junctionRunFrame(envelope, run);
    if (!frame) continue;
    const root = new TransformNode(
      `elevated-road-${envelope.id}-collar-guard-${runIndex}`,
      ctx.scene,
    );
    root.position.copyFrom(frame.rootPosition);
    root.rotation.y = frame.boxYawRad;
    root.rotation.z = frame.slopeRad;
    ctx.staticSceneryFreeze.push(root);

    const girder = createBox(
      ctx.scene,
      `${root.name}-edge-girder`,
      { width: run.lengthM, height: GIRDER_HEIGHT_M, depth: 0.46 },
      new Vector3(
        0,
        -ELEVATED_ROAD_DECK_SLAB_THICKNESS_M - GIRDER_HEIGHT_M / 2 + 0.08,
        -0.22,
      ),
      underside,
      root,
    );
    girder.receiveShadows = true;
    ctx.registerStatic(girder, frame.segment.center.x, frame.segment.center.z);

    const parapet = usesDetailedBarrierStyle
      ? createCairoParapetShell(
          ctx.scene,
          `${root.name}-parapet-profile`,
          frame.edgeRun,
          frame.segment,
          parapetDepthM,
          parapetConcrete,
          root,
        )
      : createBox(
          ctx.scene,
          `${root.name}-parapet`,
          {
            width: run.lengthM,
            height: ELEVATED_ROAD_PARAPET_HEIGHT_M,
            depth: parapetDepthM,
          },
          new Vector3(
            0,
            ELEVATED_ROAD_PARAPET_HEIGHT_M / 2 +
              ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
            0,
          ),
          concrete,
          root,
        );
    ctx.registerShadowCaster(parapet, frame.segment.center.x, frame.segment.center.z);

    if (usesDetailedBarrierStyle) {
      const coping = createBox(
        ctx.scene,
        `${root.name}-parapet-coping`,
        {
          width: run.lengthM,
          height: CAIRO_BRIDGE_PARAPET_COPING_HEIGHT_M,
          depth: 0.3,
        },
        new Vector3(
          0,
          ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
            ELEVATED_ROAD_PARAPET_HEIGHT_M -
            CAIRO_BRIDGE_PARAPET_COPING_HEIGHT_M / 2,
          0.025,
        ),
        copingMaterial,
        root,
      );
      coping.isPickable = false;
      ctx.registerShadowCaster(coping, frame.segment.center.x, frame.segment.center.z);

      const railBaseY =
        ELEVATED_ROAD_PARAPET_BASE_LIFT_M + ELEVATED_ROAD_PARAPET_HEIGHT_M;
      const visualPlan = cairoBridgeBarrierVisualPlan(
        run.lengthM,
        distanceBeforeRunM,
      );
      const railBoxes: CompoundBox[] = [
        {
          center: [0, railBaseY + 0.1, 0.03],
          size: [run.lengthM, 0.065, 0.07],
        },
        {
          center: [0, railBaseY + 0.285, 0.03],
          size: [run.lengthM, 0.065, 0.07],
        },
        {
          center: [
            0,
            railBaseY + CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M - 0.035,
            0.03,
          ],
          size: [run.lengthM, 0.07, 0.085],
        },
        ...visualPlan.railPostOffsetsM.map((offsetM) => ({
          center: [
            offsetM,
            railBaseY + CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M / 2,
            0.03,
          ] as const,
          size: [
            0.065,
            CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M,
            0.065,
          ] as const,
        })),
      ];
      const railing = createCompoundBoxMesh(
        ctx.scene,
        `${root.name}-parapet-maintenance-rail`,
        railBoxes,
        railMaterial,
        root,
      );
      if (railing) {
        ctx.staticSceneryFreeze.push(railing);
        ctx.registerShadowCaster(
          railing,
          frame.segment.center.x,
          frame.segment.center.z,
        );
      }
    }
    distanceBeforeRunM += run.lengthM;
  }
};

export interface ElevatedRoadRenderCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly registerStatic: (mesh: AbstractMesh, x: number, z: number) => void;
  readonly registerShadowCaster: (mesh: AbstractMesh, x: number, z: number) => void;
}

export interface ElevatedRoadRenderOptions {
  /** Disable only in geometry-characterization tests that need source names. */
  readonly batchStaticMeshes?: boolean;
}

const ELEVATED_ROAD_BATCH_CELL_M = 45;

type ElevatedRoadBatchRole = "freeze-only" | "static" | "shadow";

interface ElevatedRoadMeshBatch {
  readonly meshes: Mesh[];
  readonly role: ElevatedRoadBatchRole;
  readonly receiveShadows: boolean;
  readonly cellX: number;
  readonly cellZ: number;
  readonly materialName: string;
  readonly registrationX: number;
  readonly registrationZ: number;
  registrationXSum: number;
  registrationZSum: number;
  registrationCount: number;
}

/**
 * Detailed bridge skins are intentionally authored as small, exact pieces.
 * Submitting each piece separately, however, made Cairo's bridge cost
 * thousands of main/shadow draw calls. This collector also handles Tokyo by
 * baking unchanged world-space vertices into material/role/spatial batches.
 * Main-camera and mirror-only pieces use the session's 45 m static-visibility
 * cell. Shadow casters are deliberately stricter: they merge only when their
 * original registration coordinates are identical, preserving the session's
 * exact 90 m radial shadow selection and avoiding coarse shadow pop at ramps.
 */
class ElevatedRoadStaticBatcher {
  readonly freezeNodes: TransformNode[] = [];

  private readonly batches = new Map<string, ElevatedRoadMeshBatch>();
  private readonly enqueued = new Set<AbstractMesh>();

  constructor(private readonly destination: ElevatedRoadRenderCtx) {}

  enqueue(
    mesh: AbstractMesh,
    x: number,
    z: number,
    role: ElevatedRoadBatchRole,
  ): void {
    if (this.enqueued.has(mesh)) return;
    this.enqueued.add(mesh);

    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) {
      this.destination.staticSceneryFreeze.push(mesh);
      if (role === "static") this.destination.registerStatic(mesh, x, z);
      if (role === "shadow") {
        this.destination.registerShadowCaster(mesh, x, z);
      }
      return;
    }

    mesh.isPickable = false;
    const cellX = Math.floor(x / ELEVATED_ROAD_BATCH_CELL_M);
    const cellZ = Math.floor(z / ELEVATED_ROAD_BATCH_CELL_M);
    const materialId = mesh.material?.uniqueId ?? -1;
    const vertexLayout = mesh.getVerticesDataKinds().sort().join(",");
    const spatialKey =
      role === "shadow" ? `${x},${z}` : `${cellX},${cellZ}`;
    const key = [
      materialId,
      role,
      mesh.receiveShadows ? 1 : 0,
      mesh.sideOrientation,
      spatialKey,
      vertexLayout,
    ].join("|");
    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        meshes: [],
        role,
        receiveShadows: mesh.receiveShadows,
        cellX,
        cellZ,
        materialName: mesh.material?.name ?? "unmaterialed",
        registrationX: x,
        registrationZ: z,
        registrationXSum: 0,
        registrationZSum: 0,
        registrationCount: 0,
      };
      this.batches.set(key, batch);
    }
    batch.meshes.push(mesh);
    batch.registrationXSum += x;
    batch.registrationZSum += z;
    batch.registrationCount += 1;
  }

  finalize(): void {
    // Anything placed only on the freeze list still needs to be collected.
    // Its world bounds provide the same spatial locality the registered
    // bridge pieces already carry explicitly.
    for (const node of this.freezeNodes) {
      if (!(node instanceof Mesh) || this.enqueued.has(node)) continue;
      node.computeWorldMatrix(true);
      const center = node.getBoundingInfo().boundingBox.centerWorld;
      this.enqueue(node, center.x, center.z, "freeze-only");
    }

    let batchIndex = 0;
    for (const batch of this.batches.values()) {
      const meshes = batch.meshes.filter(
        (mesh) => !mesh.isDisposed() && mesh.getTotalVertices() > 0,
      );
      if (!meshes.length) continue;
      for (const mesh of meshes) mesh.computeWorldMatrix(true);
      const merged = Mesh.MergeMeshes(
        meshes,
        true,
        true,
        undefined,
        false,
        false,
      );
      if (!merged) continue;
      merged.name = `elevated-road-batch-${batch.materialName}-${batch.cellX}-${batch.cellZ}-${batchIndex}`;
      batchIndex += 1;
      merged.isPickable = false;
      merged.receiveShadows = batch.receiveShadows;

      const registrationX =
        batch.role === "shadow"
          ? batch.registrationX
          : batch.registrationXSum / Math.max(1, batch.registrationCount);
      const registrationZ =
        batch.role === "shadow"
          ? batch.registrationZ
          : batch.registrationZSum / Math.max(1, batch.registrationCount);
      if (batch.role === "static") {
        this.destination.registerStatic(
          merged,
          registrationX,
          registrationZ,
        );
      } else if (batch.role === "shadow") {
        this.destination.registerShadowCaster(
          merged,
          registrationX,
          registrationZ,
        );
      } else {
        this.destination.staticSceneryFreeze.push(merged);
      }
    }

    // Source meshes were disposed by MergeMeshes. Their now-empty segment and
    // collar roots otherwise remain as thousands of inert scene nodes.
    for (const node of this.freezeNodes) {
      if (node instanceof Mesh) continue;
      if (node.getChildMeshes(false).length === 0) node.dispose();
      else this.destination.staticSceneryFreeze.push(node);
    }
    this.batches.clear();
    this.enqueued.clear();
    this.freezeNodes.length = 0;
  }
}

const material = (
  scene: Scene,
  name: string,
  color: Color3,
): StandardMaterial => {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = color;
  value.specularColor = new Color3(0.035, 0.035, 0.03);
  return value;
};

/**
 * City-specific road-bridge grammar built over the shared physical outline.
 * Cairo keeps its dusty concrete and aged green steel; Tokyo reuses the same
 * continuous crash base, coping, upper rail, reflectors and lamps in clean pale
 * concrete and blue-gray steel. The road top itself is built by the ordinary
 * RoadSurface pass, so this layer can never become a decorative, undrivable
 * duplicate.
 */
export function buildElevatedRoadStructures(
  destinationCtx: ElevatedRoadRenderCtx,
  mapPack: GameCanvasMapPack,
  options: ElevatedRoadRenderOptions = {},
): void {
  const allRoadSurfaces = mapPack.geometry.roadSurfaces ?? [];
  const surfaces = allRoadSurfaces.filter(
    isElevatedRoadSurface,
  );
  if (!surfaces.length) return;

  const batcher =
    options.batchStaticMeshes === false
      ? undefined
      : new ElevatedRoadStaticBatcher(destinationCtx);
  const ctx: ElevatedRoadRenderCtx = batcher
    ? {
        scene: destinationCtx.scene,
        staticSceneryFreeze: batcher.freezeNodes,
        registerStatic: (mesh, x, z) =>
          batcher.enqueue(mesh, x, z, "static"),
        registerShadowCaster: (mesh, x, z) =>
          batcher.enqueue(mesh, x, z, "shadow"),
      }
    : destinationCtx;

  const normalizedMapId = mapPack.id.toLowerCase();
  const usesCairoBarrierStyle = normalizedMapId.includes("cairo");
  const usesTokyoBarrierStyle = normalizedMapId.includes("tokyo");
  const usesDetailedBarrierStyle =
    usesCairoBarrierStyle || usesTokyoBarrierStyle;
  const bridgeLampOverheadDeckAt = usesDetailedBarrierStyle
    ? createElevatedRoadDeckHeadroomQuery(allRoadSurfaces)
    : null;

  const concrete = material(
    ctx.scene,
    usesTokyoBarrierStyle
      ? "tokyo-bridge-pale-structural-concrete"
      : "elevated-road-dusty-concrete",
    usesTokyoBarrierStyle
      ? new Color3(0.69, 0.71, 0.72)
      : new Color3(0.49, 0.47, 0.42),
  );
  const underside = material(
    ctx.scene,
    usesTokyoBarrierStyle
      ? "tokyo-bridge-blue-gray-concrete"
      : "elevated-road-shadow-concrete",
    usesTokyoBarrierStyle
      ? new Color3(0.3, 0.35, 0.39)
      : new Color3(0.31, 0.31, 0.29),
  );
  const reflector = material(
    ctx.scene,
    usesTokyoBarrierStyle
      ? "tokyo-bridge-cool-white-reflector"
      : "elevated-road-amber-reflector",
    usesCairoBarrierStyle
      ? new Color3(0.86, 0.62, 0.18)
      : usesTokyoBarrierStyle
        ? new Color3(0.78, 0.88, 0.96)
        : new Color3(0.78, 0.52, 0.12),
  );
  reflector.emissiveColor = usesCairoBarrierStyle
    ? new Color3(0.16, 0.085, 0.014)
    : usesTokyoBarrierStyle
      ? new Color3(0.12, 0.17, 0.24)
      : new Color3(0.2, 0.105, 0.018);

  const bridgeParapetConcrete = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-weathered-parapet",
        new Color3(0.6, 0.56, 0.48),
      )
    : usesTokyoBarrierStyle
      ? material(
          ctx.scene,
          "tokyo-bridge-clean-pale-parapet",
          new Color3(0.76, 0.78, 0.79),
        )
      : concrete;
  const bridgeCoping = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-sunlit-coping",
        new Color3(0.78, 0.72, 0.61),
      )
    : usesTokyoBarrierStyle
      ? material(
          ctx.scene,
          "tokyo-bridge-blue-gray-coping",
          new Color3(0.46, 0.55, 0.62),
        )
      : concrete;
  bridgeCoping.emissiveColor = usesCairoBarrierStyle
    ? new Color3(0.025, 0.021, 0.014)
    : usesTokyoBarrierStyle
      ? new Color3(0.012, 0.02, 0.028)
      : Color3.Black();
  const bridgeRail = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-aged-green-steel",
        new Color3(0.055, 0.12, 0.095),
      )
    : usesTokyoBarrierStyle
      ? material(
          ctx.scene,
          "tokyo-bridge-dark-steel",
          new Color3(0.055, 0.085, 0.12),
        )
      : underside;
  if (usesCairoBarrierStyle) {
    bridgeRail.specularColor = new Color3(0.12, 0.13, 0.1);
  } else if (usesTokyoBarrierStyle) {
    bridgeRail.specularColor = new Color3(0.18, 0.22, 0.25);
  }
  const bridgeLampIron = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-lamp-iron",
        new Color3(0.075, 0.085, 0.085),
      )
    : usesTokyoBarrierStyle
      ? material(
          ctx.scene,
          "tokyo-bridge-lamp-dark-steel",
          new Color3(0.045, 0.065, 0.09),
        )
      : null;
  const bridgeLampHead = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-lamp-head",
        new Color3(0.88, 0.68, 0.38),
      )
    : usesTokyoBarrierStyle
      ? material(
          ctx.scene,
          "tokyo-bridge-lamp-head",
          new Color3(0.78, 0.86, 0.94),
        )
      : null;
  if (bridgeLampHead) {
    bridgeLampHead.emissiveColor = usesCairoBarrierStyle
      ? new Color3(1.55, 0.88, 0.32)
      : new Color3(1.25, 1.48, 1.8);
    bridgeLampHead.specularColor = Color3.Black();
  }
  let bridgeLampPool: StandardMaterial | null = null;
  if (usesDetailedBarrierStyle) {
    // Raw RGBA keeps the bridge builder usable under Babylon's NullEngine
    // (no DOM/OffscreenCanvas) while producing the same soft additive spill
    // as the canvas-backed ground streetlights.
    const poolTextureSize = 128;
    const poolTextureData = new Uint8Array(
      poolTextureSize * poolTextureSize * 4,
    );
    for (let y = 0; y < poolTextureSize; y += 1) {
      for (let x = 0; x < poolTextureSize; x += 1) {
        const distance = Math.hypot(x - 63.5, y - 63.5) / 63;
        const falloff = Math.max(0, 1 - distance);
        const offset = (y * poolTextureSize + x) * 4;
        poolTextureData[offset] = usesCairoBarrierStyle ? 255 : 184;
        poolTextureData[offset + 1] = usesCairoBarrierStyle ? 178 : 218;
        poolTextureData[offset + 2] = usesCairoBarrierStyle ? 96 : 255;
        poolTextureData[offset + 3] = Math.round(
          255 * 0.74 * falloff * falloff,
        );
      }
    }
    const poolTexture = RawTexture.CreateRGBATexture(
      poolTextureData,
      poolTextureSize,
      poolTextureSize,
      ctx.scene,
      true,
      false,
    );
    poolTexture.name = usesCairoBarrierStyle
      ? "cairo-bridge-lamp-pool-tex"
      : "tokyo-bridge-lamp-pool-tex";
    poolTexture.hasAlpha = true;

    bridgeLampPool = new StandardMaterial(
      usesCairoBarrierStyle
        ? "cairo-bridge-lamp-pool"
        : "tokyo-bridge-lamp-pool",
      ctx.scene,
    );
    bridgeLampPool.emissiveColor = usesCairoBarrierStyle
      ? new Color3(0.64, 0.41, 0.17)
      : new Color3(0.28, 0.46, 0.68);
    bridgeLampPool.emissiveTexture = poolTexture;
    bridgeLampPool.opacityTexture = poolTexture;
    bridgeLampPool.alphaMode = Constants.ALPHA_ADD;
    bridgeLampPool.diffuseColor = Color3.Black();
    bridgeLampPool.specularColor = Color3.Black();
    bridgeLampPool.disableLighting = true;
    bridgeLampPool.disableDepthWrite = true;
  }

  for (const surface of surfaces) {
    const lampCarrierSurfaceIds = new Set([surface.id]);
    const segments = elevatedRoadSegmentPlacements(surface);
    const surfaceLengthM = segments.reduce(
      (totalM, segment) => totalM + segment.lengthM,
      0,
    );
    const surfaceLampStations = usesDetailedBarrierStyle
      ? cairoBridgeLampVisualPlan(surfaceLengthM).map((station) => ({
          distanceM: surfaceLengthM / 2 + station.offsetM,
          side: station.side,
        }))
      : [];
    const parapetDepthM = elevatedRoadParapetDepthM(surface);
    let surfaceDistanceBeforeSegmentM = 0;
    for (const segment of segments) {
      const root = new TransformNode(
        `elevated-road-${surface.id}-segment-${segment.segmentIndex}`,
        ctx.scene,
      );
      root.position.set(
        segment.center.x,
        segment.center.elevationM ?? 0,
        segment.center.z,
      );
      root.rotation.y = segment.boxYawRad;
      root.rotation.z = segment.slopeRad;
      ctx.staticSceneryFreeze.push(root);

      const edgeRuns = elevatedRoadEdgeRuns(
        surface,
        segment,
        allRoadSurfaces,
      );
      const deckRun = elevatedRoadDeckRun(
        surface,
        segment,
        allRoadSurfaces,
        edgeRuns,
      );
      if (deckRun) {
        const slab = createJunctionAwareDeck(
          ctx.scene,
          `${root.name}-slab`,
          surface,
          segment,
          deckRun,
          edgeRuns,
          allRoadSurfaces,
          concrete,
          root,
        );
        slab.receiveShadows = true;
        ctx.registerStatic(slab, segment.center.x, segment.center.z);
      }
      for (const [runIndex, run] of edgeRuns.entries()) {
        const side = run.side;
        const girder = createBox(
          ctx.scene,
          `${root.name}-edge-girder-${side}-${runIndex}`,
          {
            width: run.lengthM,
            height: GIRDER_HEIGHT_M,
            depth: 0.46,
          },
          new Vector3(
            run.centerAlongM,
            -ELEVATED_ROAD_DECK_SLAB_THICKNESS_M -
              GIRDER_HEIGHT_M / 2 +
              0.08,
            side * (segment.deckWidthM / 2 - 0.42),
          ),
          underside,
          root,
        );
        girder.receiveShadows = true;
        ctx.registerStatic(girder, segment.center.x, segment.center.z);

        const parapet = usesDetailedBarrierStyle
          ? createCairoParapetShell(
              ctx.scene,
              `${root.name}-parapet-profile-${side}-${runIndex}`,
              run,
              segment,
              parapetDepthM,
              bridgeParapetConcrete,
              root,
            )
          : createBox(
              ctx.scene,
              `${root.name}-parapet-${side}-${runIndex}`,
              {
                width: run.lengthM,
                height: ELEVATED_ROAD_PARAPET_HEIGHT_M,
                depth: parapetDepthM,
              },
              new Vector3(
                run.centerAlongM,
                ELEVATED_ROAD_PARAPET_HEIGHT_M / 2 +
                  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
                side *
                  (segment.deckWidthM / 2 -
                    ELEVATED_ROAD_PARAPET_DECK_INSET_M),
              ),
              concrete,
              root,
            );
        ctx.registerShadowCaster(parapet, segment.center.x, segment.center.z);

        if (usesDetailedBarrierStyle) {
          const lateralCenterM =
            side *
            (segment.deckWidthM / 2 -
              ELEVATED_ROAD_PARAPET_DECK_INSET_M);
          const runStartDistanceM =
            surfaceDistanceBeforeSegmentM +
            segment.lengthM / 2 +
            run.centerAlongM -
            run.lengthM / 2;
          const visualPlan = cairoBridgeBarrierVisualPlan(
            run.lengthM,
            runStartDistanceM,
          );
          const coping = createBox(
            ctx.scene,
            `${root.name}-parapet-coping-${side}-${runIndex}`,
            {
              width: run.lengthM,
              height: CAIRO_BRIDGE_PARAPET_COPING_HEIGHT_M,
              depth: 0.3,
            },
            new Vector3(
              run.centerAlongM,
              ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
                ELEVATED_ROAD_PARAPET_HEIGHT_M -
                CAIRO_BRIDGE_PARAPET_COPING_HEIGHT_M / 2,
              lateralCenterM + side * 0.025,
            ),
            bridgeCoping,
            root,
          );
          coping.isPickable = false;
          ctx.registerShadowCaster(coping, segment.center.x, segment.center.z);

          // The proven detailed grammar pairs a solid concrete crash base with
          // a close-spaced dark metal rail. It follows the already-trimmed run,
          // so Cairo and Tokyo ramp mouths stay open.
          const railBaseY =
            ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
            ELEVATED_ROAD_PARAPET_HEIGHT_M;
          const railCenterZ = lateralCenterM + side * 0.03;
          const railBoxes: CompoundBox[] = [
              {
                center: [run.centerAlongM, railBaseY + 0.1, railCenterZ],
                size: [run.lengthM, 0.065, 0.07],
              },
              {
                center: [run.centerAlongM, railBaseY + 0.285, railCenterZ],
                size: [run.lengthM, 0.065, 0.07],
              },
              {
                center: [
                  run.centerAlongM,
                  railBaseY + CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M - 0.035,
                  railCenterZ,
                ],
                size: [run.lengthM, 0.07, 0.085],
              },
              ...visualPlan.railPostOffsetsM.map((offsetM) => ({
                center: [
                  run.centerAlongM + offsetM,
                  railBaseY + CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M / 2,
                  railCenterZ,
                ] as const,
                size: [
                  0.065,
                  CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M,
                  0.065,
                ] as const,
              })),
          ];
          const railing = createCompoundBoxMesh(
            ctx.scene,
            `${root.name}-parapet-maintenance-rail-${side}-${runIndex}`,
            railBoxes,
            bridgeRail,
            root,
          );
          if (railing) {
            ctx.staticSceneryFreeze.push(railing);
            ctx.registerShadowCaster(
              railing,
              segment.center.x,
              segment.center.z,
            );
          }

          const upperTrafficFaceZ = lateralCenterM - side * 0.095;
          const reflectorBackings = visualPlan.reflectorOffsetsM.map(
            (offsetM): CompoundQuad => ({
              center: [
                run.centerAlongM + offsetM,
                ELEVATED_ROAD_PARAPET_BASE_LIFT_M + 0.665,
                upperTrafficFaceZ - side * 0.002,
              ],
              size: [0.31, 0.16],
              normalZ: -side as -1 | 1,
            }),
          );
          const reflectorLenses = visualPlan.reflectorOffsetsM.map(
            (offsetM): CompoundQuad => ({
              center: [
                run.centerAlongM + offsetM,
                ELEVATED_ROAD_PARAPET_BASE_LIFT_M + 0.665,
                upperTrafficFaceZ - side * 0.006,
              ],
              size: [0.16, 0.07],
              normalZ: -side as -1 | 1,
            }),
          );
          const backingMesh = createCompoundQuadMesh(
            ctx.scene,
            `${root.name}-reflector-backing-${side}-${runIndex}`,
            reflectorBackings,
            bridgeCoping,
            root,
          );
          const lensMesh = createCompoundQuadMesh(
            ctx.scene,
            `${root.name}-reflector-lens-${side}-${runIndex}`,
            reflectorLenses,
            reflector,
            root,
          );
          if (backingMesh) ctx.staticSceneryFreeze.push(backingMesh);
          if (lensMesh) ctx.staticSceneryFreeze.push(lensMesh);

          const lampStations = surfaceLampStations
            .filter(
              (station) =>
                station.side === side &&
                station.distanceM >= runStartDistanceM + 0.4 &&
                station.distanceM <=
                  runStartDistanceM + run.lengthM - 0.4,
            )
            .map((station) => ({
              offsetM:
                station.distanceM -
                (runStartDistanceM + run.lengthM / 2),
              side: station.side,
            }));
          if (
            lampStations.length &&
            bridgeLampIron &&
            bridgeLampHead &&
            bridgeLampPool
          ) {
            const poleBaseY =
              ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
              ELEVATED_ROAD_PARAPET_HEIGHT_M;
            const poleCenterZ = lateralCenterM + side * 0.025;
            const poleBoxes: CompoundBox[] = [];
            const headBoxes: CompoundBox[] = [];
            for (const station of lampStations) {
              const alongM = run.centerAlongM + station.offsetM;
              // A lamp mounted on a lower ramp can fit beside that ramp's own
              // parapet while still punching through a higher crossing deck.
              // The Corniche exit station at (84, 239) did exactly that on the
              // Sixth October mainline. Suppress any station whose complete
              // pole/arm envelope lacks headroom below a different surface.
              if (bridgeLampOverheadDeckAt) {
                const base = Vector3.TransformCoordinates(
                  new Vector3(alongM, poleBaseY, poleCenterZ),
                  root.computeWorldMatrix(true),
                );
                const overhead = bridgeLampOverheadDeckAt(
                  base,
                  base.y,
                  CAIRO_BRIDGE_LAMP_OVERHEAD_FOOTPRINT_RADIUS_M,
                  true,
                  lampCarrierSurfaceIds,
                  ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
                );
                if (
                  overhead &&
                  overhead.headroomM <
                    CAIRO_BRIDGE_LAMP_HEIGHT_M +
                      CAIRO_BRIDGE_LAMP_OVERHEAD_CLEARANCE_M
                ) {
                  continue;
                }
              }
              poleBoxes.push(
                {
                  center: [
                    alongM,
                    poleBaseY + CAIRO_BRIDGE_LAMP_HEIGHT_M / 2,
                    poleCenterZ,
                  ],
                  size: [0.14, CAIRO_BRIDGE_LAMP_HEIGHT_M, 0.14],
                },
                {
                  center: [
                    alongM,
                    poleBaseY + CAIRO_BRIDGE_LAMP_HEIGHT_M - 0.07,
                    poleCenterZ - side * 0.78,
                  ],
                  size: [0.12, 0.12, 1.7],
                },
              );
              headBoxes.push({
                center: [
                  alongM,
                  poleBaseY + CAIRO_BRIDGE_LAMP_HEIGHT_M - 0.15,
                  poleCenterZ - side * 1.62,
                ],
                size: [0.34, 0.16, 0.56],
              });

              const poolDepthM = Math.min(
                7.5,
                Math.max(4.4, segment.deckWidthM - 0.8),
              );
              const poolCenterZ =
                side *
                (segment.deckWidthM / 2 - 0.4 - poolDepthM / 2);
              const pool = createBox(
                ctx.scene,
                `${root.name}-lamp-pool-${side}-${runIndex}-${alongM.toFixed(2)}`,
                { width: 10.5, height: 0.018, depth: poolDepthM },
                new Vector3(alongM, 0.095, poolCenterZ),
                bridgeLampPool,
                root,
              );
              ctx.registerStatic(pool, segment.center.x, segment.center.z);
            }
            const poles = createCompoundBoxMesh(
              ctx.scene,
              `${root.name}-lamp-poles-${side}-${runIndex}`,
              poleBoxes,
              bridgeLampIron,
              root,
            );
            const heads = createCompoundBoxMesh(
              ctx.scene,
              `${root.name}-lamp-heads-${side}-${runIndex}`,
              headBoxes,
              bridgeLampHead,
              root,
            );
            if (poles) {
              ctx.registerStatic(poles, segment.center.x, segment.center.z);
            }
            if (heads) {
              ctx.registerStatic(heads, segment.center.x, segment.center.z);
            }
          }
          continue;
        }

        // Generic elevated-road fallback: sparse markers preserve the old
        // treatment outside Cairo and Tokyo without turning the edge into an
        // emissive ribbon.
        const reflectorCount = Math.max(1, Math.floor(run.lengthM / 26));
        for (let index = 0; index < reflectorCount; index += 1) {
          const alongM =
            run.centerAlongM -
            run.lengthM / 2 +
            ((index + 0.5) / reflectorCount) * run.lengthM;
          const marker = createBox(
            ctx.scene,
            `${root.name}-reflector-${side}-${runIndex}-${index}`,
            { width: 0.24, height: 0.13, depth: 0.05 },
            new Vector3(
              alongM,
              ELEVATED_ROAD_PARAPET_HEIGHT_M * 0.72,
              side * (segment.deckWidthM / 2 - 0.04),
            ),
            reflector,
            root,
          );
          ctx.staticSceneryFreeze.push(marker);
        }
      }
      surfaceDistanceBeforeSegmentM += segment.lengthM;
    }

    for (const pier of elevatedRoadPierPlacements(
      surface,
      allRoadSurfaces,
    )) {
      const columnHeightM = Math.max(1, pier.elevationM - 0.62);
      const column = MeshBuilder.CreateCylinder(
        `elevated-road-${surface.id}-pier-${pier.index}`,
        {
          height: columnHeightM,
          diameterTop: ELEVATED_ROAD_PIER_COLUMN_TOP_DIAMETER_M,
          diameterBottom: ELEVATED_ROAD_PIER_COLUMN_BOTTOM_DIAMETER_M,
          tessellation: 8,
        },
        ctx.scene,
      );
      setMeshMaterial(column, concrete);
      column.position.set(
        pier.position.x,
        columnHeightM / 2,
        pier.position.z,
      );
      column.isPickable = false;
      ctx.registerShadowCaster(column, pier.position.x, pier.position.z);

      const cap = createBox(
        ctx.scene,
        `elevated-road-${surface.id}-pier-cap-${pier.index}`,
        {
          width: 1.55,
          height: 0.62,
          depth: pier.deckWidthM * 0.82,
        },
        new Vector3(
          pier.position.x,
          pier.elevationM - 0.62,
          pier.position.z,
        ),
        concrete,
      );
      cap.rotation.y = pier.boxYawRad;
      ctx.registerShadowCaster(cap, pier.position.x, pier.position.z);

      const footing = MeshBuilder.CreateCylinder(
        `elevated-road-${surface.id}-pier-foot-${pier.index}`,
        {
          height: 0.38,
          diameter: ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M,
          tessellation: 10,
        },
        ctx.scene,
      );
      setMeshMaterial(footing, underside);
      footing.position.set(pier.position.x, 0.19, pier.position.z);
      footing.isPickable = false;
      ctx.registerStatic(footing, pier.position.x, pier.position.z);
    }
  }

  // Constant-width per-road slabs stop at different offsets around a merge.
  // Pour one profiled collar over that shared throat, then wrap its exterior
  // with the same barrier grammar as the ordinary bridge edges.
  for (const envelope of elevatedRoadJunctionEnvelopes(allRoadSurfaces)) {
    const root = new TransformNode(
      `elevated-road-${envelope.id}-collar`,
      ctx.scene,
    );
    root.position.set(
      envelope.pivot.x,
      envelope.pivot.elevationM ?? 0,
      envelope.pivot.z,
    );
    ctx.staticSceneryFreeze.push(root);
    const slab = createElevatedJunctionDeck(
      ctx.scene,
      envelope,
      concrete,
      root,
    );
    if (slab) {
      slab.receiveShadows = true;
      ctx.registerStatic(slab, envelope.pivot.x, envelope.pivot.z);
    }
    createElevatedJunctionBarriers(
      ctx,
      envelope,
      allRoadSurfaces,
      usesDetailedBarrierStyle,
      concrete,
      underside,
      bridgeParapetConcrete,
      bridgeCoping,
      bridgeRail,
    );
  }

  concrete.freeze();
  underside.freeze();
  reflector.freeze();
  if (usesDetailedBarrierStyle) {
    bridgeParapetConcrete.freeze();
    bridgeCoping.freeze();
    bridgeRail.freeze();
    bridgeLampIron?.freeze();
    bridgeLampHead?.freeze();
    bridgeLampPool?.freeze();
  }
  batcher?.finalize();
}
