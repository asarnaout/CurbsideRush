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
import { defaultSidewalkWidthM } from "../visuals";

/**
 * Tokyo's per-landmark dispatcher (cityRenderRegistry.ts), same `(ctx,
 * landmark, material, mapPack) => boolean` shape as `buildNycLandmark`/
 * `buildCairoLandmark`. Bridges are the only bespoke case this phase (Phase
 * 8 adds Hikari Tower); the station and every park/railway landmark read
 * fine through babylonGameSession.ts's generic `landmark.kind` fallback.
 *
 * Modelled on `render/nycLandmarks.ts`'s `buildNycLandmark`, minus the
 * suspension-bridge parts: per plan §4.4, Tokyo's bridges read as girder/arch
 * road bridges, not suspension bridges. Dropped: the two pylon towers and
 * their cables. Kept, unchanged in shape/placement from NYC's proven recipe
 * (only this phase's decor tuning is deferred to Phase 9, not the structure):
 * deck-edge parapet, kerbside guardrail, footway lamp posts. Added: a
 * vermilion (torii-red) arch rib, Kawanaka-bashi only — it is the
 * geometrically central of the three bridges (z=180, between Sakura-ōhashi's
 * -168 and Tsuki-ōhashi's 560), matching the plan's "central bridge" note.
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

export interface TokyoLandmarkCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
}

const LAMP_SPACING_M = 26;
/** Deck-edge parapet, between the footway and the water. */
const PARAPET_HEIGHT_M = 1;
/** Kerbside guardrail, between the carriageway and the footway. */
const GUARDRAIL_HEIGHT_M = 0.5;
/** Only Kawanaka-bashi (the geometric middle of the three crossings) gets
 * the vermilion arch — the other two read as plain girder bridges. */
const ARCH_ROAD_ID = "jp-kawanaka-bashi";
const ARCH_SEGMENTS = 8;
const ARCH_RISE_M = 6;
/** How far outboard of the deck edge the arch rib stands — barely past the
 * parapet, unlike NYC's pylons (1 m past a much wider deck), so it never
 * has a realistic chance of reaching a foreign road; the clearance check
 * below is cheap insurance, not a real expected rejection. */
const ARCH_LATERAL_OVERHANG_M = 0.6;

export function buildTokyoLandmark(
  ctx: TokyoLandmarkCtx,
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
    defaultSidewalkWidthM(mapPack),
  );
  const length = axis.lengthM;
  // The full deck: carriageway + both pavement bands + the parapet's own
  // clearance. `width / 2` is therefore the water's edge, and the collider
  // `simulationAdapter` emits for this portal stands on exactly that line.
  const width = axis.widthM;
  // The carriageway alone. Kept separate from `width` on purpose — see
  // nycLandmarks.ts's own comment on the same pair of locals.
  const carriagewayWidthM =
    roadSurfaces.find((surface) => surface.id === landmark.id)?.widthM ?? width;
  const root = new TransformNode(`${landmark.id}-axis`, scene);
  root.position.set(axis.center.x, 0, axis.center.z);
  root.rotation.y = axis.boxYawRad;
  ctx.staticSceneryFreeze.push(root);

  // Cooler than NYC's warm steel/stone — Tokyo's night palette leans
  // mercury-vapour blue.
  const steel = makeMaterial(scene, `${landmark.id}-steel`, new Color3(0.28, 0.3, 0.34));
  const parapetConcrete = makeMaterial(scene, `${landmark.id}-parapet`, new Color3(0.38, 0.37, 0.4));
  const lampGlow = makeMaterial(
    scene,
    `${landmark.id}-lamp`,
    new Color3(0.08, 0.07, 0.06),
    new Color3(0.98, 0.75, 0.35),
  );

  // Deck-edge parapet both sides at the water edge — VISUAL ONLY, no new
  // collider; the adapter already emits the shoreline `-portal-` obstacle on
  // this exact line ("you see the wall you hit"), same as NYC's.
  for (const side of [-1, 1] as const) {
    const parapet = createBox(
      scene,
      `${landmark.id}-parapet-${side}`,
      { width: length, height: PARAPET_HEIGHT_M, depth: 0.22 },
      new Vector3(0, PARAPET_HEIGHT_M / 2, (side * width) / 2),
      parapetConcrete,
      root,
    );
    parapet.isPickable = false;
    ctx.staticSceneryFreeze.push(parapet);

    // Kerbside guardrail, between the carriageway and the footway.
    // Deliberately VISUAL ONLY — staticColliders.test.ts refuses a collider
    // on a live lane, same rule NYC's guardrail follows.
    const guardrail = createBox(
      scene,
      `${landmark.id}-guardrail-${side}`,
      { width: length, height: GUARDRAIL_HEIGHT_M, depth: 0.16 },
      new Vector3(0, GUARDRAIL_HEIGHT_M / 2, side * (carriagewayWidthM / 2 + 0.3)),
      steel,
      root,
    );
    guardrail.isPickable = false;
    ctx.staticSceneryFreeze.push(guardrail);
  }

  // Lamp posts every ~26 m along both footways, inboard of the parapet by
  // 1.2 m (on the parapet line a post would stand in its own 0.22 m
  // thickness with the head hanging over the river).
  const lampCount = Math.max(2, Math.round(length / LAMP_SPACING_M));
  const deckLevelM = 0.65;
  for (let index = 0; index <= lampCount; index += 1) {
    const alongM = -length / 2 + (index / lampCount) * length;
    for (const side of [-1, 1] as const) {
      const lateralM = side * (width / 2 - 1.2);
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

  // The vermilion arch rib — Kawanaka-bashi only, the geometric middle
  // crossing. A shallow sine profile approximated by ARCH_SEGMENTS straight
  // boxes per side, each tilted to its own local tangent (the same
  // along/height-plane rotation NYC's cable suggestion used). Flavour
  // dressing, not a structural sim — a low-poly arch silhouette is the goal.
  if (landmark.id === ARCH_ROAD_ID) {
    const vermilion = makeMaterial(
      scene,
      `${landmark.id}-vermilion`,
      new Color3(0.75, 0.22, 0.1),
      new Color3(0.12, 0.02, 0.01),
    );
    const archLateralM = width / 2 + ARCH_LATERAL_OVERHANG_M;
    // One representative clearance check at the arch's own lateral offset —
    // cheap insurance against a foreign road, matching nycLandmarks.ts's
    // pylon precedent, even though this arch sits barely past its own
    // parapet and is never realistically going to reach another surface.
    const midWorldX = axis.center.x + -Math.cos(axis.headingRad) * archLateralM;
    const midWorldZ = axis.center.z + Math.sin(axis.headingRad) * archLateralM;
    const archBlocked = roadSurfaces.some((surface) => {
      if (surface.id === landmark.id) return false;
      const nearest = nearestPointOnPolyline({ x: midWorldX, z: midWorldZ }, surface.centerline);
      return Math.hypot(midWorldX - nearest.x, midWorldZ - nearest.z) < surface.widthM / 2 + 1.5;
    });
    if (!archBlocked) {
      for (const side of [-1, 1] as const) {
        let previous = { along: -length / 2, height: deckLevelM };
        for (let segment = 1; segment <= ARCH_SEGMENTS; segment += 1) {
          const t = segment / ARCH_SEGMENTS;
          const along = -length / 2 + t * length;
          const height = deckLevelM + ARCH_RISE_M * Math.sin(Math.PI * t);
          const dAlong = along - previous.along;
          const dHeight = height - previous.height;
          const segmentLengthM = Math.hypot(dAlong, dHeight);
          // Segment number first, side last: a `side=-1` embedded mid-string
          // is ambiguous to split on "-" (a naming trap NYC's own pylon
          // names avoid the same way — its test groups by fraction, never
          // parses side out of the name either).
          const rib = createBox(
            scene,
            `${landmark.id}-arch-${segment}-${side}`,
            { width: segmentLengthM, height: 0.5, depth: 0.5 },
            new Vector3((previous.along + along) / 2, (previous.height + height) / 2, side * archLateralM),
            vermilion,
            root,
          );
          rib.rotation.z = Math.atan2(dHeight, dAlong);
          rib.isPickable = false;
          ctx.staticSceneryFreeze.push(rib);
          previous = { along, height };
        }
      }
    }
  }

  return true;
}
