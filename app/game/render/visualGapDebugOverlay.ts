/**
 * Debug-only wireframe overlay for one visual-gap report record, toggled
 * through `window.__sideswapVisualGapOverlay` — see `installDebugHooks` in
 * `babylonGameSession.ts`. Draws the eye marker, the eye-to-target ray, the
 * failing void blob's AABB (if any), the nearest opaque owner's exact
 * outline (if resolvable), and every ground surface the ray actually
 * crossed — plan Section 13.4. One record at a time, one draw call.
 *
 * `geometry` must be the SAME `CollectedGeometry` the report was computed
 * against: owner ids in `nearestOpaqueOwnerId`/`crossedOwners` only resolve
 * against the exact occluder/ground-surface list that produced them, not a
 * freshly recomputed one that could legitimately differ.
 */
import { Color4, type LinesMesh, MeshBuilder, type Scene, Vector3 } from "@babylonjs/core";
import {
  shapeToPolygonal,
  type Aabb2,
  type CollectedGeometry,
  type Shape2d,
} from "../geometry/visualSceneFootprints";
import type { VisualGapReportRecord } from "../geometry/visualGapCoverage";

const OVERLAY_Y = 0.4;
const CIRCLE_SEGMENTS = 16;
const EYE_MARKER_RADIUS_M = 1.2;

const EYE_COLOR = new Color4(1, 1, 1, 1);
const RAY_COLOR = new Color4(1, 0.85, 0.1, 1);
const BLOB_COLOR = new Color4(1, 0.15, 0.15, 1);
const NEAREST_OPAQUE_COLOR = new Color4(0.15, 0.85, 1, 1);
const CROSSED_OWNER_COLOR = new Color4(0.25, 0.85, 0.15, 1);

function circleLoop(cx: number, cz: number, radius: number): Vector3[] {
  const loop: Vector3[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    loop.push(new Vector3(cx + Math.cos(angle) * radius, OVERLAY_Y, cz + Math.sin(angle) * radius));
  }
  return loop;
}

/** Ground-flat closed loop from an XZ point ring (`OVERLAY_Y`, not the
 * ring's own elevation — blob/owner outlines are a plan view, not a
 * height survey). */
function flatRingLoop(points: readonly { readonly x: number; readonly z: number }[]): Vector3[] {
  if (points.length < 2) return [];
  const loop = points.map((p) => new Vector3(p.x, OVERLAY_Y, p.z));
  loop.push(loop[0]);
  return loop;
}

function aabbLoop(aabb: Aabb2): Vector3[] {
  return flatRingLoop([
    { x: aabb.minX, z: aabb.minZ },
    { x: aabb.maxX, z: aabb.minZ },
    { x: aabb.maxX, z: aabb.maxZ },
    { x: aabb.minX, z: aabb.maxZ },
  ]);
}

/** Every ring of a shape, flattened to plan-view loops via the same
 * circle/aabb/obb-to-polygon conversion the audit engine's own boolean-op
 * pipeline uses, so an overlaid circle/OBB matches the audited shape
 * exactly rather than an independently-drawn approximation. */
function shapeLoops(shape: Shape2d): Vector3[][] {
  const polygonal = shapeToPolygonal(shape);
  if (polygonal.kind === "polygon") return [flatRingLoop(polygonal.outer)];
  return polygonal.parts.map((part) => flatRingLoop(part.outer));
}

export function buildVisualGapOverlay(
  scene: Scene,
  record: VisualGapReportRecord,
  geometry: CollectedGeometry,
): LinesMesh {
  const lines: Vector3[][] = [];
  const colors: Color4[][] = [];
  const push = (loop: Vector3[], color: Color4) => {
    if (loop.length < 2) return;
    lines.push(loop);
    colors.push(loop.map(() => color));
  };

  push(circleLoop(record.eye.x, record.eye.z, EYE_MARKER_RADIUS_M), EYE_COLOR);
  // Real eye/target heights, not the flat overlay plane — the one part of
  // this overlay that is genuinely 3-D, since a camera-origin-height bug is
  // exactly the kind of defect this ray is meant to make visible.
  push(
    [
      new Vector3(record.eye.x, record.eye.y, record.eye.z),
      new Vector3(record.target.x, record.target.y, record.target.z),
    ],
    RAY_COLOR,
  );
  if (record.blobAabb) push(aabbLoop(record.blobAabb), BLOB_COLOR);

  if (record.nearestOpaqueOwnerId) {
    const occluder = geometry.occluders.find((o) => o.ownerId === record.nearestOpaqueOwnerId);
    if (occluder) for (const loop of shapeLoops(occluder.geometry)) push(loop, NEAREST_OPAQUE_COLOR);
  }
  for (const crossed of record.crossedOwners) {
    const surface = geometry.groundSurfaces.find((s) => s.ownerId === crossed.ownerId);
    if (surface) for (const loop of shapeLoops(surface.geometry)) push(loop, CROSSED_OWNER_COLOR);
  }

  const mesh = MeshBuilder.CreateLineSystem("visual-gap-debug-overlay", { lines, colors }, scene);
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}
