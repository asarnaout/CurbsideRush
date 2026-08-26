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
  ELEVATED_ROAD_PARAPET_DEPTH_M,
  ELEVATED_ROAD_PARAPET_HEIGHT_M,
  ELEVATED_ROAD_PIER_COLUMN_BOTTOM_DIAMETER_M,
  ELEVATED_ROAD_PIER_COLUMN_TOP_DIAMETER_M,
  ELEVATED_ROAD_PIER_FOOTING_DIAMETER_M,
  elevatedRoadDeckRun,
  elevatedRoadEdgeRuns,
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

const appendQuad = (
  positions: number[],
  indices: number[],
  points: readonly [number, number, number][],
): void => {
  const base = positions.length / 3;
  for (const point of points) positions.push(...point);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
    (startWasClipped || segment.segmentIndex === 0);
  const capEnd =
    deckRun.endTrimM <= 0.001 &&
    (endWasClipped ||
      segment.segmentIndex + 2 === surface.centerline.length);
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
    new Color3(0.78, 0.52, 0.12),
  );
  reflector.emissiveColor = new Color3(0.2, 0.105, 0.018);

  for (const surface of surfaces) {
    for (const segment of elevatedRoadSegmentPlacements(surface)) {
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

        const parapet = createBox(
          ctx.scene,
          `${root.name}-parapet-${side}-${runIndex}`,
          {
            width: run.lengthM,
            height: ELEVATED_ROAD_PARAPET_HEIGHT_M,
            depth: ELEVATED_ROAD_PARAPET_DEPTH_M,
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

        // A restrained reflector rhythm makes long Cairo ramps readable after
        // dark without turning the concrete into an emissive ribbon.
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
}
