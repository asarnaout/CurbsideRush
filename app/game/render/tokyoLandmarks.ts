import {
  Color3,
  type Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBox, createCylinder, createIcoSphere } from "./meshPrimitives";
import { cairoBridgePortalVisualAxis } from "../geometry/waterGeometry";
import { nearestPointOnPolyline } from "../geometry/roadStrips";
import type { GameCanvasMapPack } from "../sessionContract";
import { defaultSidewalkWidthM } from "../visuals";

/**
 * Tokyo's per-landmark dispatcher (cityRenderRegistry.ts), same `(ctx,
 * landmark, material, mapPack) => boolean` shape as `buildNycLandmark`/
 * `buildCairoLandmark`. Two bespoke cases: bridges (Phase 3) and the Hikari
 * Tower (Phase 8, R15, `jp-hikari-tower` — matched by id, not by
 * `landmark.kind === "tower"`, since `jp-carrot-tower` in the old quarter
 * shares that kind and must keep rendering through the generic fallback
 * unchanged). The station and every park/railway landmark still read fine
 * through babylonGameSession.ts's generic `landmark.kind` fallback.
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

// ---------------------------------------------------------------------------
// Hikari Tower (Tokyo expansion Phase 8, R15)
// ---------------------------------------------------------------------------

const HIKARI_TOWER_ID = "jp-hikari-tower";

/** The four diagonal corners the legs stand at — identical to
 * `geometry/landmarkGroundSolids.ts`'s own `HIKARI_LEG_CORNERS`, restated
 * here since that module is pure (no Babylon) and cannot be imported by a
 * render file, and this one cannot be imported by the pure geometry layer.
 * Both files' `HIKARI_LEG_OFFSET_M` (16) agree for the same reason. */
const HIKARI_LEG_CORNERS: ReadonlyArray<{ readonly sx: -1 | 1; readonly sz: -1 | 1 }> = [
  { sx: 1, sz: 1 },
  { sx: 1, sz: -1 },
  { sx: -1, sz: 1 },
  { sx: -1, sz: -1 },
];
const HIKARI_LEG_OFFSET_M = 16;
/** (height, radial distance from the tower's own centre along a leg's
 * diagonal, cross-section half-extent) breakpoints — a stepped taper
 * (constant cross-section per straight segment) in the same "stacked
 * sections" idiom `render/londonLandmarks.ts`'s Shard/Gherkin use, rather
 * than one continuously-tapered primitive. The first breakpoint's radius
 * (`HIKARI_LEG_OFFSET_M * sqrt(2)`) and half-extent (2 m) are exactly
 * `landmarkGroundSolids.ts`'s own base leg OBB, so the visible base and the
 * collision box agree; the last breakpoint lands each leg just inside the
 * main deck's own 9 m radius and 88.5 m underside, so the join has no
 * visible seam. */
const HIKARI_LEG_PROFILE: ReadonlyArray<{ readonly y: number; readonly r: number; readonly half: number }> = [
  { y: 0, r: HIKARI_LEG_OFFSET_M * Math.SQRT2, half: 2 },
  { y: 24, r: 19, half: 1.6 },
  { y: 48, r: 15, half: 1.2 },
  { y: 70, r: 11.5, half: 0.85 },
  { y: 90, r: 9, half: 0.6 },
];
/** Every ~12 m, matching plan section 8.6's own figure — four boxes (one
 * per side of the square the legs stand at) per level, forming a ring. */
const HIKARI_BRACE_HEIGHTS_M: readonly number[] = [10, 22, 34, 46, 58, 70, 82];
const HIKARI_BRACE_HALF_M = 0.28;
/** Index pairs into `HIKARI_LEG_CORNERS`, walking the square's four true
 * edges (adjacent corners only) — `[0,3]`/`[1,2]` would be the two
 * diagonals across the tower's own centre and are deliberately excluded. */
const HIKARI_BRACE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
];

const HIKARI_DECK_Y = 92;
const HIKARI_DECK_RADIUS_M = 9;
const HIKARI_DECK_HEIGHT_M = 7;
const HIKARI_UPPER_DECK_Y = 118;
const HIKARI_UPPER_DECK_RADIUS_M = 6.5;
const HIKARI_UPPER_DECK_HEIGHT_M = 5;
const HIKARI_SPIRE_TIP_Y = 140;
/** The FootTown-analog base building — smaller than the tower's own 44x44
 * footprint on purpose (`landmarkGroundSolids.ts` collides exactly this
 * box), so the ground between the four legs but outside the podium stays
 * open at plaza level: plan section 8.6's "photo spot", not an oversight. */
const HIKARI_PODIUM_HALF_X_M = 9;
const HIKARI_PODIUM_HALF_Z_M = 7;
const HIKARI_PODIUM_HEIGHT_M = 9;

/** Linear interpolation across `HIKARI_LEG_PROFILE`'s own breakpoints —
 * used only to place the horizontal cross-braces at a leg's true position
 * for a given height, so a brace ring never floats off its own legs. */
function hikariLegRadiusAtHeight(heightM: number): number {
  for (let index = 1; index < HIKARI_LEG_PROFILE.length; index += 1) {
    const a = HIKARI_LEG_PROFILE[index - 1];
    const b = HIKARI_LEG_PROFILE[index];
    if (heightM <= b.y || index === HIKARI_LEG_PROFILE.length - 1) {
      const t = (heightM - a.y) / (b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return HIKARI_LEG_PROFILE[HIKARI_LEG_PROFILE.length - 1].r;
}

/**
 * The Hikari Tower: four leaning lattice legs converging under a main
 * observation deck, a slender mast up to a smaller upper deck, and a spire
 * to a beacon at 140 m. Fog end is capped at 440 m at night (`docs/
 * rendering.md`), so the tower reads as a district beacon from a couple of
 * blocks rather than a skyline object — it does not need to be visible from
 * the far side of the map to do its job.
 *
 * Each leg leans in its own vertical plane (the diagonal from the tower's
 * centre to that corner, and world Y) — built the same two-rotation way
 * this file's own Kawanaka-bashi arch rib is: a per-leg `TransformNode`
 * carries the horizontal heading (`rotation.y`), and each straight segment
 * is a child box whose own `rotation.z` tilts it within that node's local
 * (outward, up) plane — `atan2(dx, dz) - PI/2` is this codebase's own
 * "Babylon yaw when the mesh's long dimension is local +x" convention
 * (`geometry/waterGeometry.ts`'s `boxYawRad`), reused here for a leg's own
 * outward direction instead of a bridge's long axis. Cross-braces need no
 * such parent — both ends sit at the same height, so a brace is a plain
 * horizontal box with only a heading rotation, positioned by
 * `hikariLegRadiusAtHeight`.
 *
 * Night dressing per plan section 8.6: international-orange lattice with
 * white bands (torii-red-adjacent, not a literal Tokyo Tower trademark
 * copy — this is the fictional "Hikari Tower"), lit deck glass via a
 * dark-body/warm-emissive material — the same flat-colour-plus-emissive
 * technique this file's own lamp heads already use, no facade window-grid
 * texture — and a red aircraft-warning beacon at the tip. No real Babylon
 * light of any kind: this engine's night stack is 100% emissive + bloom.
 */
function buildHikariTower(
  ctx: TokyoLandmarkCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
): void {
  const scene = ctx.scene;
  const { x: cx, z: cz } = landmark.center;

  const freeze = (mesh: Mesh): Mesh => {
    mesh.isPickable = false;
    ctx.staticSceneryFreeze.push(mesh);
    return mesh;
  };

  // Emissive values tuned against the night pipeline's own bloomThreshold
  // (0.72, post-exposure 1.55x — babylonGameSession.ts) rather than picked
  // by eye: this file's own proven lamp-head glow (0.98, 0.75, 0.35) is the
  // reference point a first pass (~0.2-0.5 peak channel) sat well under,
  // rendering as flat colour with no visible halo. These land close to the
  // lamp's own intensity so the lattice and deck glass genuinely bloom.
  const orange = makeMaterial(
    scene,
    `${landmark.id}-orange`,
    new Color3(0.72, 0.28, 0.08),
    new Color3(0.62, 0.21, 0.05),
  );
  const white = makeMaterial(
    scene,
    `${landmark.id}-white`,
    new Color3(0.82, 0.8, 0.76),
    new Color3(0.26, 0.25, 0.23),
  );
  const deckGlow = makeMaterial(
    scene,
    `${landmark.id}-deck`,
    new Color3(0.12, 0.11, 0.14),
    new Color3(0.78, 0.58, 0.27),
  );
  const beaconMaterial = makeMaterial(
    scene,
    `${landmark.id}-beacon`,
    new Color3(0.3, 0.02, 0.02),
    new Color3(0.95, 0.12, 0.08),
  );

  // Four leaning legs, each its own tilt plane.
  for (const [legIndex, corner] of HIKARI_LEG_CORNERS.entries()) {
    const dx = corner.sx / Math.SQRT2;
    const dz = corner.sz / Math.SQRT2;
    const heading = Math.atan2(dx, dz);
    const legRoot = new TransformNode(`${landmark.id}-leg-${legIndex}`, scene);
    legRoot.position.set(cx, 0, cz);
    legRoot.rotation.y = heading - Math.PI / 2;
    ctx.staticSceneryFreeze.push(legRoot);

    for (let segment = 1; segment < HIKARI_LEG_PROFILE.length; segment += 1) {
      const a = HIKARI_LEG_PROFILE[segment - 1];
      const b = HIKARI_LEG_PROFILE[segment];
      const segLengthM = Math.hypot(b.r - a.r, b.y - a.y);
      const crossM = a.half + b.half;
      const box = createBox(
        scene,
        `${landmark.id}-leg-${legIndex}-seg-${segment}`,
        { width: segLengthM, height: crossM, depth: crossM },
        new Vector3((a.r + b.r) / 2, (a.y + b.y) / 2, 0),
        segment % 2 === 1 ? orange : white,
        legRoot,
      );
      box.rotation.z = Math.atan2(b.y - a.y, b.r - a.r);
      freeze(box);
    }
  }

  // Horizontal cross-brace rings between adjacent legs.
  for (const [levelIndex, y] of HIKARI_BRACE_HEIGHTS_M.entries()) {
    const radius = hikariLegRadiusAtHeight(y);
    const positions = HIKARI_LEG_CORNERS.map((corner) => ({
      x: cx + (corner.sx / Math.SQRT2) * radius,
      z: cz + (corner.sz / Math.SQRT2) * radius,
    }));
    for (const [edgeIndex, [i, j]] of HIKARI_BRACE_EDGES.entries()) {
      const from = positions[i];
      const to = positions[j];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthM = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      const brace = createBox(
        scene,
        `${landmark.id}-brace-${levelIndex}-${edgeIndex}`,
        { width: lengthM, height: HIKARI_BRACE_HALF_M * 2, depth: HIKARI_BRACE_HALF_M * 2 },
        new Vector3((from.x + to.x) / 2, y, (from.z + to.z) / 2),
        levelIndex % 2 === 0 ? white : orange,
      );
      brace.rotation.y = heading - Math.PI / 2;
      freeze(brace);
    }
  }

  // Main observation deck, capping the legs.
  freeze(
    createCylinder(
      scene,
      `${landmark.id}-main-deck`,
      { height: HIKARI_DECK_HEIGHT_M, diameter: HIKARI_DECK_RADIUS_M * 2, tessellation: 16 },
      new Vector3(cx, HIKARI_DECK_Y, cz),
      deckGlow,
    ),
  );

  // Slender mast up to the upper deck.
  const mastBottomY = HIKARI_DECK_Y + HIKARI_DECK_HEIGHT_M / 2;
  const mastTopY = HIKARI_UPPER_DECK_Y - HIKARI_UPPER_DECK_HEIGHT_M / 2;
  freeze(
    createCylinder(
      scene,
      `${landmark.id}-mast`,
      { height: mastTopY - mastBottomY, diameterBottom: 5.6, diameterTop: 4.2, tessellation: 12 },
      new Vector3(cx, (mastBottomY + mastTopY) / 2, cz),
      orange,
    ),
  );

  // Upper deck.
  freeze(
    createCylinder(
      scene,
      `${landmark.id}-upper-deck`,
      { height: HIKARI_UPPER_DECK_HEIGHT_M, diameter: HIKARI_UPPER_DECK_RADIUS_M * 2, tessellation: 14 },
      new Vector3(cx, HIKARI_UPPER_DECK_Y, cz),
      deckGlow,
    ),
  );

  // Spire, a white band partway up, and the tip beacon.
  const spireBottomY = HIKARI_UPPER_DECK_Y + HIKARI_UPPER_DECK_HEIGHT_M / 2;
  freeze(
    createCylinder(
      scene,
      `${landmark.id}-spire`,
      { height: HIKARI_SPIRE_TIP_Y - spireBottomY, diameterBottom: 3.6, diameterTop: 0.5, tessellation: 10 },
      new Vector3(cx, (spireBottomY + HIKARI_SPIRE_TIP_Y) / 2, cz),
      orange,
    ),
  );
  freeze(
    createCylinder(
      scene,
      `${landmark.id}-spire-band`,
      { height: 0.6, diameter: 1.7, tessellation: 10 },
      new Vector3(cx, spireBottomY + (HIKARI_SPIRE_TIP_Y - spireBottomY) * 0.55, cz),
      white,
    ),
  );
  freeze(createIcoSphere(scene, `${landmark.id}-beacon`, 0.6, new Vector3(cx, HIKARI_SPIRE_TIP_Y + 0.5, cz), beaconMaterial));

  // FootTown-analog podium — the ground solid this exact box matches lives
  // in `geometry/landmarkGroundSolids.ts`'s `tokyoHikariTower`.
  freeze(
    createBox(
      scene,
      `${landmark.id}-podium`,
      { width: HIKARI_PODIUM_HALF_X_M * 2, height: HIKARI_PODIUM_HEIGHT_M, depth: HIKARI_PODIUM_HALF_Z_M * 2 },
      new Vector3(cx, HIKARI_PODIUM_HEIGHT_M / 2, cz),
      deckGlow,
    ),
  );
}

export function buildTokyoLandmark(
  ctx: TokyoLandmarkCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  _material: StandardMaterial,
  mapPack: GameCanvasMapPack,
): boolean {
  if (landmark.id === HIKARI_TOWER_ID) {
    buildHikariTower(ctx, landmark);
    return true;
  }
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
