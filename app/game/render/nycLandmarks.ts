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
/** Deck-edge parapet, between the footway and the water. */
const PARAPET_HEIGHT_M = 1;
/** Kerbside guardrail, between the carriageway and the footway. */
const GUARDRAIL_HEIGHT_M = 0.5;
/** How far outboard of the deck edge a tower's centre stands. */
const PYLON_DECK_OVERHANG_M = 1;

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
    defaultSidewalkWidthM(mapPack),
  );
  const length = axis.lengthM;
  // The full deck: carriageway + both pavement bands + the parapet's own
  // clearance. `width / 2` is therefore the water's edge, and the collider
  // `simulationAdapter` emits for this portal stands on exactly that line.
  const width = axis.widthM;
  // The carriageway alone. Kept separate from `width` on purpose: the two were
  // interchangeable only while the axis ignored the pavement, and conflating
  // them is what would silently promote a 12 m bridge to 40 m towers the
  // moment the deck width started counting its footways.
  const carriagewayWidthM =
    roadSurfaces.find((surface) => surface.id === landmark.id)?.widthM ?? width;
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
  //
  // This is the barrier between the footway and the river, and it is drawn on
  // the same line as the `-portal-` obstacle in `simulationAdapter`: you see
  // the wall you hit. Solid and waist-high rather than a floating slab,
  // because a pedestrian deck over open water with nothing at its edge was the
  // thing that read as unfinished.
  for (const side of [-1, 1] as const) {
    const parapet = createBox(
      scene,
      `${landmark.id}-parapet-${side}`,
      { width: length, height: PARAPET_HEIGHT_M, depth: 0.22 },
      new Vector3(0, PARAPET_HEIGHT_M / 2, (side * width) / 2),
      parapetStone,
      root,
    );
    parapet.isPickable = false;
    ctx.staticSceneryFreeze.push(parapet);

    // Roadway-to-footway guardrail at the kerb. Deliberately **visual only**:
    // there is no collider here and never was, so the deck stays exactly as
    // drivable as it has always been. Adding one would wall a live
    // carriageway off from its own shoulder, which `staticColliders.test.ts`
    // is entitled to refuse — if it ever should stop a car, it has to be
    // authored as an obstacle in the adapter, not quietly grown here.
    const guardrail = createBox(
      scene,
      `${landmark.id}-guardrail-${side}`,
      { width: length, height: GUARDRAIL_HEIGHT_M, depth: 0.16 },
      new Vector3(
        0,
        GUARDRAIL_HEIGHT_M / 2,
        side * (carriagewayWidthM / 2 + 0.3),
      ),
      steel,
      root,
    );
    guardrail.isPickable = false;
    ctx.staticSceneryFreeze.push(guardrail);
  }

  // Two steel pylon towers with a low-poly cable suggestion, standing just
  // outboard of the deck edge so neither the tower nor the cables it carries
  // stands in the roadway or on the footway.
  //
  // `lateralM` must be `side * (…)` throughout: written as `(side * width)/2
  // + 1` the pair is displaced 1 m in the *same* world direction rather than
  // mirrored, which put one tower of every pair — and the low end of its
  // cables, at bumper height — 1.3 m inside the carriageway.
  const directionX = Math.sin(axis.headingRad);
  const directionZ = Math.cos(axis.headingRad);
  // Local +z of `root` in world terms, i.e. the deck's lateral axis.
  const lateralAxisX = -Math.cos(axis.headingRad);
  const lateralAxisZ = Math.sin(axis.headingRad);
  const pylonHeightM = carriagewayWidthM >= 13 ? 40 : 28;
  const deckLevelM = 0.65;
  for (const fraction of PYLON_FRACTIONS) {
    const alongM = (fraction - 0.5) * length;
    const worldX = axis.center.x + directionX * alongM;
    const worldZ = axis.center.z + directionZ * alongM;
    for (const side of [-1, 1] as const) {
      const lateralM = side * (width / 2 + PYLON_DECK_OVERHANG_M);
      // Sampled where the tower actually stands, not on the deck centreline:
      // a centreline sample is blind to lateral placement and so could never
      // have caught the mirroring bug above. A tower this deep into the
      // clipped over-water span is never really going to land on a
      // carriageway (nothing else crosses the river here), but the check
      // costs nothing and matches `cairoElevatedBridgePierPlacements`'s own
      // precedent of never trusting that assumption silently.
      const towerX = worldX + lateralAxisX * lateralM;
      const towerZ = worldZ + lateralAxisZ * lateralM;
      const blocksRoad = roadSurfaces.some((surface) => {
        if (surface.id === landmark.id) return false;
        const nearest = nearestPointOnPolyline(
          { x: towerX, z: towerZ },
          surface.centerline,
        );
        return (
          Math.hypot(towerX - nearest.x, towerZ - nearest.z) <
          surface.widthM / 2 + 1.5
        );
      });
      if (blocksRoad) continue;
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

  // Lamp posts every ~26 m along both footways, small emissive heads — a
  // night map, so the lit bridge over dark water is the point. Set inboard of
  // the parapet rather than on it: on the deck-edge line the post stands in
  // the parapet's own 0.22 m and its head hangs over the river.
  const lampCount = Math.max(2, Math.round(length / LAMP_SPACING_M));
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

  return true;
}
