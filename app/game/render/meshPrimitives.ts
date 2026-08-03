import {
  Color3,
  type DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
  Vector4,
  VertexData,
} from "@babylonjs/core";
import { FACADE_COLS, FACADE_ROWS } from "../geometry/facadesAndKeepouts";
import type { GameCanvasPoint } from "../sessionContract";
import { BUILDING_GROUND_LIFT } from "./renderConstants";
import { FACADE_WIN_H_M, FACADE_WIN_W_M, makeFacadeDiffuseTexture } from "./proceduralTextures";

/**
 * Babylon mesh-primitive factories: the box/cylinder/ico-sphere/chamfered-
 * panel/extruded-prism builders every hand-built mesh in the session is
 * assembled from, the building-facade mesh/material half (the texture half
 * lives in proceduralTextures.ts — `facadeFaceUV` needing both
 * `FACADE_WIN_W_M`/`FACADE_WIN_H_M` from there is the one cross-file seam),
 * and the merged road-paint geometry accumulators (`MarkingGeometry` and its
 * `append*` builders) — pure vertex-array assembly that borrows
 * `VertexData.CreateBox` for its numbers rather than building a `Mesh`.
 *
 * `setMeshMaterial` is duplicated from GameCanvas.tsx rather than shared, per
 * house convention.
 */

function setMeshMaterial(
  mesh: Mesh,
  material: StandardMaterial,
  receiveShadows = false,
) {
  mesh.material = material;
  mesh.receiveShadows = receiveShadows;
  mesh.isPickable = false;
}

/**
 * Merged road-paint geometry. Every dash and solid run used to be its own
 * unfrozen CreateBox — ~1,100 meshes on the NYC grid, each a per-frame
 * frustum test and draw call. These accumulators collect the exact same
 * boxes (same dash phase walk, same +0.25 depth pad and height rule, same
 * winding via Babylon's own box data, rotated and translated) so the session
 * can pour one mesh per paint colour. Pure and exported for node tests.
 */
export interface MarkingGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
}

export function createMarkingGeometry(): MarkingGeometry {
  return { positions: [], normals: [], indices: [] };
}

/** One paint box, replicating createFlatSegment's dimensions exactly. */
export function appendMarkingBox(
  geometry: MarkingGeometry,
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  width: number,
  y: number,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return;
  const heading = Math.atan2(dx, dz);
  const box = VertexData.CreateBox({
    width,
    height: Math.max(0.025, y * 0.45),
    depth: length + 0.25,
  });
  const centerX = (start.x + end.x) / 2;
  const centerZ = (start.z + end.z) / 2;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const indexBase = geometry.positions.length / 3;
  const positions = box.positions as number[];
  const normals = box.normals as number[];
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i];
    const py = positions[i + 1];
    const pz = positions[i + 2];
    // rotation.y = heading, as Babylon applies it to a mesh.
    geometry.positions.push(
      centerX + px * cos + pz * sin,
      y + py,
      centerZ - px * sin + pz * cos,
    );
    const nx = normals[i];
    const nz = normals[i + 2];
    geometry.normals.push(nx * cos + nz * sin, normals[i + 1], -nx * sin + nz * cos);
  }
  for (const index of box.indices as number[]) {
    geometry.indices.push(indexBase + index);
  }
}

/** The dash walk from createDashedPath, phase carry-over and all. */
export function appendDashedMarkingBoxes(
  geometry: MarkingGeometry,
  points: readonly GameCanvasPoint[],
  width: number,
  y: number,
  dashLength = 3,
  gapLength = 4,
): void {
  let phase = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const ux = dx / length;
    const uz = dz / length;
    for (
      let distance = -phase;
      distance < length;
      distance += dashLength + gapLength
    ) {
      const from = Math.max(0, distance);
      const to = Math.min(length, distance + dashLength);
      if (to - from > 0.2) {
        appendMarkingBox(
          geometry,
          { x: start.x + ux * from, z: start.z + uz * from },
          { x: start.x + ux * to, z: start.z + uz * to },
          width,
          y,
        );
      }
    }
    phase = (phase + length) % (dashLength + gapLength);
  }
}

export function appendSolidMarkingBoxes(
  geometry: MarkingGeometry,
  points: readonly GameCanvasPoint[],
  width: number,
  y: number,
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    appendMarkingBox(geometry, points[index], points[index + 1], width, y);
  }
}

export function createBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

export function createCylinder(
  scene: Scene,
  name: string,
  options: {
    height: number;
    diameter?: number;
    diameterTop?: number;
    diameterBottom?: number;
    tessellation?: number;
  },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { tessellation: 8, ...options },
    scene,
  );
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

export function createIcoSphere(
  scene: Scene,
  name: string,
  radius: number,
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateIcoSphere(
    name,
    { radius, subdivisions: 1 },
    scene,
  );
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function facadeFaceUV(width: number, height: number, depth: number): Vector4[] {
  // Whole window rows/cols sized in real-world metres, so windows stay a
  // consistent size whether the building is short or a tower (the V/U ranges
  // land on exact row/column boundaries, so no half-windows at the roofline).
  const rows = Math.max(2, Math.round(height / FACADE_WIN_H_M));
  const cols = (span: number) => Math.max(2, Math.round(span / FACADE_WIN_W_M));
  const v = rows / FACADE_ROWS;
  const faceUV: Vector4[] = [];
  for (let i = 0; i < 6; i += 1) faceUV.push(new Vector4(0, 0, 0, 0));
  faceUV[0] = new Vector4(0, 0, cols(width) / FACADE_COLS, v);
  faceUV[1] = new Vector4(0, 0, cols(width) / FACADE_COLS, v);
  faceUV[2] = new Vector4(0, 0, cols(depth) / FACADE_COLS, v);
  faceUV[3] = new Vector4(0, 0, cols(depth) / FACADE_COLS, v);
  faceUV[4] = new Vector4(0, 0, 0.02, 0.02);
  faceUV[5] = new Vector4(0, 0, 0.02, 0.02);
  return faceUV;
}

export function makeFacadeMaterial(
  scene: Scene,
  name: string,
  wallColor: Color3,
  emissive: DynamicTexture,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.diffuseTexture = makeFacadeDiffuseTexture(scene, `${name}-diffuse`, wallColor);
  material.emissiveTexture = emissive;
  material.emissiveColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  return material;
}

export function createFacadeBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  position: Vector3,
  material: StandardMaterial,
): Mesh {
  const mesh = MeshBuilder.CreateBox(
    name,
    {
      ...dimensions,
      faceUV: facadeFaceUV(dimensions.width, dimensions.height, dimensions.depth),
      wrap: true,
    },
    scene,
  );
  mesh.position.copyFrom(position);
  // Every caller passes height/2; the lift keeps the base plate off the ground
  // plane and clear of the pavement band (BUILDING_BASE_CLEARANCE_M). Applied
  // here rather than at the four call sites so a fifth cannot reintroduce a
  // coplanar plate.
  mesh.position.y += BUILDING_GROUND_LIFT;
  setMeshMaterial(mesh, material);
  return mesh;
}

/**
 * A flat panel with a chamfered outline, facing -Z, with planar UVs.
 *
 * Neither existing primitive can carry a mirror image on a shape with cut
 * corners: `MeshBuilder.CreatePlane` only makes rectangles, and
 * `createExtrudedPrism` wraps its UVs around the section rather than across the
 * face, so a texture on it comes out smeared. This fans a convex outline from
 * its centre and takes UVs straight off the vertex positions, so the reflection
 * sits square on the glass whatever the outline is.
 */
export function createChamferedPanel(
  scene: Scene,
  name: string,
  outline: readonly Readonly<{ x: number; y: number }>[],
  width: number,
  height: number,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  for (const point of outline) {
    positions.push((point.x * width) / 2, (point.y * height) / 2, 0);
    uvs.push(point.x / 2 + 0.5, point.y / 2 + 0.5);
  }
  const indices: number[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const next = ((index + 1) % outline.length) + 1;
    indices.push(0, next, index + 1);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

export function createExtrudedPrism(
  scene: Scene,
  name: string,
  width: number,
  crossSection: readonly Readonly<{ y: number; z: number }>[],
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = width / 2;
  const pointCount = crossSection.length;

  for (const x of [-halfWidth, halfWidth]) {
    for (const point of crossSection) {
      positions.push(x, point.y, point.z);
    }
  }

  for (let index = 0; index < pointCount; index += 1) {
    const next = (index + 1) % pointCount;
    const left = index;
    const leftNext = next;
    const right = pointCount + index;
    const rightNext = pointCount + next;
    indices.push(left, right, rightNext, left, rightNext, leftNext);
  }
  for (let index = 1; index < pointCount - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(pointCount, pointCount + index + 1, pointCount + index);
  }

  // A planar unwrap round the section. Nothing built from a prism is textured
  // today, but Babylon refuses to merge meshes whose attribute sets differ, and
  // every MeshBuilder primitive carries UVs — so a prism without them cannot be
  // merged with a box, which is exactly what the cockpit does.
  const uvs: number[] = [];
  const lastPoint = Math.max(1, pointCount - 1);
  for (const v of [0, 1]) {
    for (let index = 0; index < pointCount; index += 1) {
      uvs.push(index / lastPoint, v);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}
