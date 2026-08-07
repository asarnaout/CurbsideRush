import {
  Color3,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBox, createCylinder } from "./meshPrimitives";
import { cairoBridgePortalVisualAxis } from "../geometry/waterGeometry";
import { nearestPointOnPolyline } from "../geometry/roadStrips";
import type { GameCanvasMapPack } from "../sessionContract";

/**
 * NYC's per-landmark dispatcher (cityRenderRegistry.ts), same `(ctx,
 * landmark, material, mapPack) => boolean` shape as `buildCairoLandmark`.
 * Bridges are the only bespoke case — parks, the gallery and the
 * subway/AMNH boxes all read fine through babylonGameSession.ts's generic
 * `landmark.kind` fallback, the same as every other city's non-bespoke
 * landmarks.
 */

function makeMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  material.emissiveColor = emissive ?? Color3.Black();
  return material;
}

export interface NycLandmarkCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
}

/** Roughly a quarter and three-quarters along the span — the classic
 * suspension-bridge tower placement. */
const PYLON_FRACTIONS = [0.28, 0.72] as const;
/** How far a cable's deck end sits from its own tower, as a share of the
 * bridge's total (over-water) length. */
const CABLE_DECK_REACH_FRACTION = 0.22;
const LAMP_SPACING_M = 26;

export function buildNycLandmark(
  ctx: NycLandmarkCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  _material: StandardMaterial,
  mapPack: GameCanvasMapPack,
): boolean {
  if (landmark.kind !== "bridge") return false;
  const scene = ctx.scene;
  const roadSurfaces = mapPack.geometry.roadSurfaces ?? [];
  const axis = cairoBridgePortalVisualAxis(
    landmark,
    roadSurfaces,
    mapPack.geometry.waterBodies ?? [],
  );
  const length = axis.lengthM;
  const width = axis.widthM;
  const root = new TransformNode(`${landmark.id}-axis`, scene);
  root.position.set(axis.center.x, 0, axis.center.z);
  root.rotation.y = axis.boxYawRad;
  ctx.staticSceneryFreeze.push(root);

  const steel = makeMaterial(scene, `${landmark.id}-steel`, new Color3(0.3, 0.32, 0.35));
  const parapetStone = makeMaterial(scene, `${landmark.id}-parapet`, new Color3(0.4, 0.38, 0.35));
  const lampGlow = makeMaterial(
    scene,
    `${landmark.id}-lamp`,
    new Color3(0.08, 0.08, 0.07),
    new Color3(0.95, 0.82, 0.5),
  );

  // Deck-edge parapets over the over-water span only — the same clipped
  // axis the road portal itself uses, so the rails never cross the
  // shoreline carriageways.
  for (const side of [-1, 1] as const) {
    const parapet = createBox(
      scene,
      `${landmark.id}-parapet-${side}`,
      { width: length, height: 0.5, depth: 0.18 },
      new Vector3(0, 0.65, (side * width) / 2),
      parapetStone,
      root,
    );
    parapet.isPickable = false;
    ctx.staticSceneryFreeze.push(parapet);
  }

  // Two steel pylon towers with a low-poly cable suggestion, deterministic
  // on position: a tower this deep into the clipped over-water span is
  // never actually going to land on a carriageway (nothing else crosses
  // the river here), but the check costs nothing and matches
  // `cairoElevatedBridgePierPlacements`'s own precedent of never trusting
  // that assumption silently.
  const directionX = Math.sin(axis.headingRad);
  const directionZ = Math.cos(axis.headingRad);
  const pylonHeightM = width >= 13 ? 40 : 28;
  const deckLevelM = 0.65;
  for (const fraction of PYLON_FRACTIONS) {
    const alongM = (fraction - 0.5) * length;
    const worldX = axis.center.x + directionX * alongM;
    const worldZ = axis.center.z + directionZ * alongM;
    const blocksRoad = roadSurfaces.some((surface) => {
      if (surface.id === landmark.id) return false;
      const nearest = nearestPointOnPolyline({ x: worldX, z: worldZ }, surface.centerline);
      return (
        Math.hypot(worldX - nearest.x, worldZ - nearest.z) <
        surface.widthM / 2 + 1.5
      );
    });
    if (blocksRoad) continue;
    for (const side of [-1, 1] as const) {
      const lateralM = (side * width) / 2 + 1;
      const tower = createBox(
        scene,
        `${landmark.id}-pylon-${fraction}-${side}`,
        { width: 1.4, height: pylonHeightM, depth: 1.4 },
        new Vector3(alongM, pylonHeightM / 2, lateralM),
        steel,
        root,
      );
      tower.isPickable = false;
      ctx.staticSceneryFreeze.push(tower);
      const head = createBox(
        scene,
        `${landmark.id}-pylon-head-${fraction}-${side}`,
        { width: 2, height: 1.2, depth: 1.8 },
        new Vector3(alongM, pylonHeightM - 0.6, lateralM),
        steel,
        root,
      );
      head.isPickable = false;
      ctx.staticSceneryFreeze.push(head);
      // A cable suggestion each way from the tower head down to deck
      // level — a silhouette, not a catenary sim. Held at the tower's own
      // lateral offset throughout, so the only tilt needed is in the
      // along/height plane (a single local-Z rotation).
      for (const cableSign of [-1, 1] as const) {
        const dx = cableSign * length * CABLE_DECK_REACH_FRACTION;
        const dy = deckLevelM - (pylonHeightM - 1.2);
        const cableLengthM = Math.hypot(dx, dy);
        const cable = createBox(
          scene,
          `${landmark.id}-cable-${fraction}-${side}-${cableSign}`,
          { width: cableLengthM, height: 0.12, depth: 0.12 },
          new Vector3(alongM + dx / 2, pylonHeightM - 1.2 + dy / 2, lateralM),
          steel,
          root,
        );
        cable.rotation.z = Math.atan2(dy, dx);
        cable.isPickable = false;
        ctx.staticSceneryFreeze.push(cable);
      }
    }
  }

  // Lamp posts every ~26 m along both deck edges, small emissive heads —
  // a night map, so the lit bridge over dark water is the point.
  const lampCount = Math.max(2, Math.round(length / LAMP_SPACING_M));
  for (let index = 0; index <= lampCount; index += 1) {
    const alongM = -length / 2 + (index / lampCount) * length;
    for (const side of [-1, 1] as const) {
      const lateralM = (side * width) / 2;
      const pole = createCylinder(
        scene,
        `${landmark.id}-lamp-pole-${index}-${side}`,
        { height: 3.2, diameter: 0.14, tessellation: 6 },
        new Vector3(alongM, deckLevelM + 1.6, lateralM),
        steel,
        root,
      );
      pole.isPickable = false;
      ctx.staticSceneryFreeze.push(pole);
      const head = createBox(
        scene,
        `${landmark.id}-lamp-head-${index}-${side}`,
        { width: 0.3, height: 0.3, depth: 0.3 },
        new Vector3(alongM, deckLevelM + 3.2, lateralM),
        lampGlow,
        root,
      );
      head.isPickable = false;
      ctx.staticSceneryFreeze.push(head);
    }
  }

  return true;
}
