import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type AbstractMesh,
} from "@babylonjs/core";
import {
  ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M,
  ELEVATED_ROAD_PARAPET_DECK_INSET_M,
  ELEVATED_ROAD_PARAPET_HEIGHT_M,
  ELEVATED_ROAD_PIER_COLUMN_BOTTOM_DIAMETER_M,
  ELEVATED_ROAD_PIER_COLUMN_TOP_DIAMETER_M,
  ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M,
  elevatedRoadDeckRun,
  elevatedRoadEdgeRuns,
  elevatedRoadEndpointHasStructuralContinuation,
  elevatedRoadParapetDepthM,
  elevatedRoadPierPlacements,
  elevatedRoadSegmentPlacements,
  type ElevatedRoadDeckRunPlacement,
  type ElevatedRoadEdgeRunPlacement,
  type ElevatedRoadGeometrySurface,
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
export const CAIRO_BRIDGE_PARAPET_TOTAL_HEIGHT_M =
  ELEVATED_ROAD_PARAPET_BASE_LIFT_M +
  ELEVATED_ROAD_PARAPET_HEIGHT_M +
  CAIRO_BRIDGE_PARAPET_RAIL_HEIGHT_M;

export interface CairoBridgeBarrierVisualPlan {
  readonly railPostOffsetsM: readonly number[];
  readonly reflectorOffsetsM: readonly number[];
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
 * Repeatable Cairo barrier detail laid out in surface-distance space. Keeping
 * the post/reflector phase global stops the visual rhythm restarting at each
 * authored polyline segment or trimmed flyover junction.
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

export interface ElevatedRoadRenderCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly registerStatic: (mesh: AbstractMesh, x: number, z: number) => void;
  readonly registerShadowCaster: (mesh: AbstractMesh, x: number, z: number) => void;
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
 * Cairo's road-bridge grammar: dark asphalt rides a dusty concrete box-girder
 * deck, continuous Jersey-style parapets trace every ramp, and octagonal
 * hammerhead piers repeat below the high mainline while yielding every road it
 * crosses. The road top itself is built by the ordinary RoadSurface pass, so
 * this layer can never become a decorative, undrivable duplicate.
 */
export function buildElevatedRoadStructures(
  ctx: ElevatedRoadRenderCtx,
  mapPack: GameCanvasMapPack,
): void {
  const surfaces = (mapPack.geometry.roadSurfaces ?? []).filter(
    isElevatedRoadSurface,
  );
  if (!surfaces.length) return;

  const usesCairoBarrierStyle = mapPack.id.toLowerCase().includes("cairo");

  const concrete = material(
    ctx.scene,
    "elevated-road-dusty-concrete",
    new Color3(0.49, 0.47, 0.42),
  );
  const underside = material(
    ctx.scene,
    "elevated-road-shadow-concrete",
    new Color3(0.31, 0.31, 0.29),
  );
  const reflector = material(
    ctx.scene,
    "elevated-road-amber-reflector",
    usesCairoBarrierStyle
      ? new Color3(0.86, 0.62, 0.18)
      : new Color3(0.78, 0.52, 0.12),
  );
  reflector.emissiveColor = usesCairoBarrierStyle
    ? new Color3(0.16, 0.085, 0.014)
    : new Color3(0.2, 0.105, 0.018);

  const cairoParapetConcrete = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-weathered-parapet",
        new Color3(0.6, 0.56, 0.48),
      )
    : concrete;
  const cairoCoping = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-sunlit-coping",
        new Color3(0.78, 0.72, 0.61),
      )
    : concrete;
  cairoCoping.emissiveColor = usesCairoBarrierStyle
    ? new Color3(0.025, 0.021, 0.014)
    : Color3.Black();
  const cairoRail = usesCairoBarrierStyle
    ? material(
        ctx.scene,
        "cairo-bridge-aged-green-steel",
        new Color3(0.055, 0.12, 0.095),
      )
    : underside;
  if (usesCairoBarrierStyle) {
    cairoRail.specularColor = new Color3(0.12, 0.13, 0.1);
  }

  for (const surface of surfaces) {
    const segments = elevatedRoadSegmentPlacements(surface);
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

      const edgeRuns = elevatedRoadEdgeRuns(surface, segment, surfaces);
      const deckRun = elevatedRoadDeckRun(surface, segment, surfaces);
      if (deckRun) {
        const slab = createJunctionAwareDeck(
          ctx.scene,
          `${root.name}-slab`,
          surface,
          segment,
          deckRun,
          edgeRuns,
          surfaces,
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

        const parapet = usesCairoBarrierStyle
          ? createCairoParapetShell(
              ctx.scene,
              `${root.name}-parapet-profile-${side}-${runIndex}`,
              run,
              segment,
              parapetDepthM,
              cairoParapetConcrete,
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

        if (usesCairoBarrierStyle) {
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
            cairoCoping,
            root,
          );
          coping.isPickable = false;
          ctx.registerShadowCaster(coping, segment.center.x, segment.center.z);

          // Cairo's 6 October and 26 July bridge photographs consistently pair
          // a solid concrete crash base with a close-spaced dark metal rail.
          // The rail follows the already-trimmed run, so ramp mouths stay open.
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
            cairoRail,
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
            cairoCoping,
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
          continue;
        }

        // Generic elevated-road fallback: sparse markers preserve the old
        // treatment outside Cairo without turning the edge into an emissive
        // ribbon.
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
      mapPack.geometry.roadSurfaces ?? [],
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

  concrete.freeze();
  underside.freeze();
  reflector.freeze();
  if (usesCairoBarrierStyle) {
    cairoParapetConcrete.freeze();
    cairoCoping.freeze();
    cairoRail.freeze();
  }
}
