/**
 * Imported low-poly people & cyclists (Phase 3 of the visual glow-up), built
 * from the same preloaded-glb pipeline as the vehicles. Pedestrians are rigged
 * Quaternius characters playing their Walk clip; cyclists are a rider posed on a
 * bicycle. Returns null when the models are not loaded so the caller can fall
 * back to the procedural cylinder people.
 */
import {
  type AbstractMesh,
  AnimationGroup,
  Color3,
  type Material,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  type Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  BIKE_SCALE,
  PEDAL_CRANK_RATE,
  WHEEL_ROLL_RATE,
  poseCyclist,
  setupCyclistPose,
  setupSeatedRiderPose,
  type SeatedPoseAnchors,
} from "./cyclistPose";
import { instantiateModel, isModelReady } from "./modelLibrary";
import {
  blobShadowMaterial,
  readAlbedo,
  readAlbedoTexture,
} from "./vehicleMeshes";

export interface CharacterVisual {
  readonly root: TransformNode;
  /** Advances the cyclist's pedal cycle by a ground distance (cyclists only). */
  advancePedals?(distanceMeters: number): void;
  /** Shows/hides the rider while keeping the bike parked (cyclists only) —
   * the dismount illusion for the player's errand cutscenes. */
  setRiderVisible?(visible: boolean): void;
  /** Pauses/resumes the walk clip so a stopped pedestrian stands still. */
  setMoving?(moving: boolean): void;
  /** Plays the stylised fall once, fitted to `seconds`, holding the final
   * lying pose until recovery (pedestrians only). */
  playKnockdown?(seconds: number): void;
  /** Stands the character back up over roughly `seconds` and resumes the
   * walk clip (pedestrians only). */
  playRecover?(seconds: number): void;
  dispose(): void;
}

interface CharacterModelConfig {
  readonly url: string;
  /** Material names recoloured to the crowd's clothing colour for variety. */
  readonly clothingMaterialNames: readonly string[];
  /** Material names taking the per-person complexion instead of the rig's
   * single baked one (see characterPalettes.ts). */
  readonly complexionMaterialNames: readonly string[];
  /** Same for hair. Some rigs split it in two (a base plus a top layer); both
   * take the one colour, so the two-tone shading the rig authored is lost. */
  readonly hairMaterialNames: readonly string[];
  /** Uniform scale to a ~1.8 m person (the rigs are authored ~4.8 u tall). */
  readonly scale: number;
  readonly yawOffset: number;
  /** Substring identifying the looping locomotion clip. */
  readonly walkClip: string;
}

const C = "/models/characters";

/** CC0 Quaternius "Animated Men" + "Animated Women" — the same 31-joint
 * HumanArmature rig family, flat baseColor materials (easy recolour), each
 * with a Man_/Female_Walk clip the `/Walk/i` matcher finds. (The repo also
 * ships person-punk.glb, deliberately unused: it is a different 62-joint
 * armature split across four skins, which the crowd renderer's shared-
 * skeleton bake cannot carry.) */
export const CHARACTER_MODELS: readonly CharacterModelConfig[] = [
  { url: `${C}/person-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-b.glb`, clothingMaterialNames: ["Shirt", "Shirt2", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair", "Hair2"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-c.glb`, clothingMaterialNames: ["Shirt", "Pants", "Details"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-a.glb`, clothingMaterialNames: ["Shirt", "Pants"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair", "HairBase"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
  { url: `${C}/person-woman-b.glb`, clothingMaterialNames: ["Dress"], complexionMaterialNames: ["Skin"], hairMaterialNames: ["Hair"], scale: 0.374, yawOffset: Math.PI, walkClip: "Walk" },
];

/** CC-BY "Poly by Google" bicycle (credited in CREDITS.md; pedals/tires split
 * into animatable nodes by tools/split-bicycle-pedals.mjs); authored huge and
 * facing +X (tires along X), so it yaws +90° to put its front (handlebars) on
 * +Z, aligned with the rider (verified against a side-on render). */
const BICYCLE_MODEL = { url: `${C}/bicycle.glb`, scale: BIKE_SCALE, yawOffset: Math.PI / 2 } as const;

/** CC0 "Cartoony Purple Motorcycle" by AliceCassie (credited in CREDITS.md).
 * Authored ~1.04 u long facing −Z (headlamp under the bars), origin on the
 * ground plane; scale puts it at ~2.0 m with a ~0.70 m seat. yawOffset 0: the
 * glTF loader's baked flip alone already lands the front on wrap +Z, aligned
 * with the rider (probe-verified — a π offset here mounts the bike backward).
 * One merged mesh — no separable wheels, so nothing spins. */
const MOTORBIKE_MODEL = { url: `${C}/motorbike.glb`, scale: 1.9, yawOffset: 0 } as const;

/** The courier's red. It repaints the motorbike's LightPurple body panels (the
 * frame/tires and the yellow lamp keep their authored colours) and dresses the
 * delivery bag, so the bike, the rider and the order they are carrying read as
 * one courier. */
const COURIER_RED = new Color3(0.72, 0.21, 0.13);

/** Measured motorbike.glb anchors (glb-local units, from the vertex-profile
 * dissection): seat dip top, grip centroids under the bar ends, and mid-low
 * outboard footpeg points. forwardLocal −Z = toward the headlamp. */
const MOTORBIKE_GLB_ANCHORS: SeatedPoseAnchors = {
  seatSit: { x: 0, y: 0.37, z: 0.05 },
  grips: [
    { x: 0.1, y: 0.42, z: -0.12 },
    { x: -0.1, y: 0.42, z: -0.12 },
  ],
  pegs: [
    { x: 0.09, y: 0.14, z: 0.02 },
    { x: -0.09, y: 0.14, z: 0.02 },
  ],
  forwardLocal: { x: 0, y: 0, z: -1 },
};

export function characterModelUrls(): string[] {
  return [
    ...CHARACTER_MODELS.map((config) => config.url),
    BICYCLE_MODEL.url,
    MOTORBIKE_MODEL.url,
  ];
}

/** The three colours that make one person distinct from the next; everything
 * else (eyes, shoes, bike paint) keeps the colour its rig authored. */
export interface CharacterColors {
  readonly clothing: Color3;
  /** Optional distinct colour for the "Pants" material, so a rider can wear a
   * contrasting top and bottom (e.g. a tee + jeans) instead of a one-colour
   * jumpsuit. Omitted by the ambient crowd, which stays single-tone. */
  readonly pants?: Color3;
  readonly complexion: Color3;
  readonly hair: Color3;
}

/** Which of a model's materials this person overrides, and with what. */
function materialOverrides(
  config: CharacterModelConfig,
  colors: CharacterColors,
): Map<string, Color3> {
  const overrides = new Map<string, Color3>();
  for (const material of config.clothingMaterialNames) {
    overrides.set(
      material,
      material === "Pants" && colors.pants ? colors.pants : colors.clothing,
    );
  }
  for (const material of config.complexionMaterialNames) {
    overrides.set(material, colors.complexion);
  }
  for (const material of config.hairMaterialNames) {
    overrides.set(material, colors.hair);
  }
  return overrides;
}

/**
 * Converts a glb subtree's PBR materials to scene-consistent StandardMaterials,
 * applying any per-material colour `overrides` and keeping the rest as authored.
 * Returns the created materials so the caller can dispose them without touching
 * shared container materials.
 */
function convertMaterials(
  scene: Scene,
  name: string,
  subtree: TransformNode,
  overrides: ReadonlyMap<string, Color3>,
): StandardMaterial[] {
  const converted = new Map<Material, StandardMaterial>();
  const owned: StandardMaterial[] = [];
  for (const mesh of subtree.getChildMeshes(false)) {
    const source = mesh.material;
    if (!source) continue;
    let standard = converted.get(source);
    if (!standard) {
      standard = new StandardMaterial(`${name}-${source.name}`, scene);
      const texture = readAlbedoTexture(source);
      if (texture) standard.diffuseTexture = texture;
      const override = overrides.get(source.name);
      standard.diffuseColor = override
        ? override.clone()
        : texture
          ? Color3.White()
          : readAlbedo(source).clone();
      standard.specularColor = new Color3(0.05, 0.05, 0.05);
      standard.specularPower = 32;
      converted.set(source, standard);
      owned.push(standard);
    }
    mesh.material = standard;
  }
  return owned;
}

/** Small oval contact shadow under a character/cyclist, at foot level. */
function addContactShadow(
  scene: Scene,
  name: string,
  root: TransformNode,
  width: number,
  depth: number,
): void {
  const blob = MeshBuilder.CreateGround(
    `${name}-shadow`,
    { width, height: depth },
    scene,
  );
  blob.material = blobShadowMaterial(scene);
  blob.position.y = 0.02;
  blob.parent = root;
  blob.isPickable = false;
  blob.receiveShadows = false;
}

/** glTF clips are keyed on a 60-frames-per-second timeline. */
const CLIP_TIMELINE_FPS = 60;

/** Starts the walk clip looping and retains the rig's stylised fall clip for
 * knockdowns; every other group is disposed (each instance clones all 11
 * clips, so drop the unused ones). */
function playWalkRetainingFall(
  groups: readonly AnimationGroup[],
  walkClip: string,
  speedRatio: number,
): { walk?: AnimationGroup; fall?: AnimationGroup } {
  const walkPattern = new RegExp(walkClip, "i");
  let walk: AnimationGroup | undefined;
  let fall: AnimationGroup | undefined;
  for (const group of groups) {
    if (!walk && walkPattern.test(group.name)) walk = group;
    else if (!fall && /death/i.test(group.name)) fall = group;
    else group.dispose();
  }
  if (walk) {
    walk.speedRatio = speedRatio;
    walk.play(true);
  }
  return { walk, fall };
}

/**
 * A walking pedestrian. `walkSpeedRatio` slows the ~1 s walk cycle toward the
 * character's slow ground speed to cut foot-sliding.
 */
export function buildPedestrianVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
  walkSpeedRatio: number,
): CharacterVisual | null {
  const config = CHARACTER_MODELS[Math.abs(variant) % CHARACTER_MODELS.length];
  if (!isModelReady(scene, config.url)) return null;
  const instance = instantiateModel(scene, config.url);
  const modelRoot = instance?.rootNodes[0] as TransformNode | undefined;
  if (!instance || !modelRoot) return null;

  const root = new TransformNode(`${name}-pedestrian`, scene);
  root.parent = parent;
  root.rotation.y = config.yawOffset;
  modelRoot.parent = root;
  modelRoot.scaling.setAll(config.scale);

  const owned = convertMaterials(
    scene,
    name,
    root,
    materialOverrides(config, colors),
  );
  addContactShadow(scene, name, root, 0.62, 0.5);
  const { walk, fall } = playWalkRetainingFall(
    instance.animationGroups,
    config.walkClip,
    walkSpeedRatio,
  );

  let disposed = false;
  let moving = true;
  return {
    root,
    setMoving(next) {
      if (disposed || !walk || next === moving) return;
      moving = next;
      if (next) walk.play(true);
      else walk.pause();
    },
    playKnockdown(seconds) {
      if (disposed || !fall) return;
      walk?.pause();
      moving = false;
      // Fit the clip to the shared knockdown timing; loop=false leaves the
      // skeleton holding the final lying pose until recovery.
      const clipSeconds =
        Math.max(1, fall.to - fall.from) / CLIP_TIMELINE_FPS;
      fall.stop();
      fall.start(false, clipSeconds / Math.max(0.2, seconds), fall.from, fall.to, false);
    },
    playRecover(seconds) {
      if (disposed || !walk) return;
      fall?.stop();
      // Blend from the lying pose back into the walk cycle: reads as the
      // character picking themselves up without needing a dedicated clip.
      walk.enableBlending = true;
      walk.blendingSpeed = 1 / (CLIP_TIMELINE_FPS * Math.max(0.2, seconds) * 0.5);
      moving = true;
      walk.play(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      walk?.dispose();
      fall?.dispose();
      root.dispose(false, false);
      for (const material of owned) material.dispose(true, false);
    },
  };
}

export type ActorClip = "idle" | "walk" | "run";

/**
 * A cutscene actor: the driver stepping out to pump fuel or run a delivery
 * errand, or the passenger boarding and leaving the car. Unlike a pedestrian it
 * switches between the rig's locomotion clips on demand.
 */
export interface ActorVisual {
  readonly root: TransformNode;
  setClip(clip: ActorClip, speedRatio?: number): void;
  /** Shows/hides the order in the courier's hand (courier actors only). */
  setCarrying?(carrying: boolean): void;
  /** Keeps bone-hung kit tracking the animating rig; call once a frame while
   * the actor is on screen. Costs nothing when nothing is being carried. */
  update?(): void;
  dispose(): void;
}

/** Clip name suffixes on the shared HumanArmature rigs ("…|Man_Walk",
 * "…|Female_Idle"). Anchored so Run never matches RunningJump. */
const ACTOR_CLIP_PATTERNS: readonly (readonly [ActorClip, RegExp])[] = [
  ["idle", /_Idle$/i],
  ["walk", /_Walk$/i],
  ["run", /_Run$/i],
];

/**
 * A character that idles, walks and runs under script control. Same clone
 * pipeline as the pedestrians; retains the three locomotion clips (the other
 * eight the clone carries are disposed) and blends between them so switches
 * read as the character changing pace rather than popping.
 */
export function buildActorVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
): ActorVisual | null {
  const config = CHARACTER_MODELS[Math.abs(variant) % CHARACTER_MODELS.length];
  return buildActorFromConfig(
    scene,
    parent,
    name,
    config,
    materialOverrides(config, colors),
  );
}

/**
 * The rig person-c happens to be — a man in an open jacket over a shirt front —
 * carries the only per-panel materials in the roster: `Shirt` (the jacket),
 * `TieTexture` (the chest panel between its lapels), `Pants` and `Details`
 * (collar and cuffs). All four are flat baseColorFactors with no textures, so
 * the whole police uniform is a recolour of a rig the game already ships,
 * rather than a sixth character glb to download, license and keep in step with
 * the crowd's shared-skeleton bake.
 */
const OFFICER_MODEL = CHARACTER_MODELS[2];

/**
 * The patrol uniform: a dark navy buttoned shirt with a lighter placket and a
 * pale collar, over navy trousers. Deliberately plain — what makes him read as
 * police is the peaked cap's silhouette, not the fabric. An earlier hi-vis
 * version was legible but wrong: patrol officers wear a shirt, not a vest.
 */
const OFFICER_UNIFORM: ReadonlyMap<string, Color3> = new Map([
  ["Shirt", Color3.FromHexString("#22314f")], // navy shirt + sleeves
  ["TieTexture", Color3.FromHexString("#2a3a5c")], // buttoned placket, a shade up
  ["Pants", Color3.FromHexString("#18243c")], // navy trousers
  ["Details", Color3.FromHexString("#c9ccd2")], // collar points + cuff trim
  ["Skin", Color3.FromHexString("#c8a077")],
  ["Hair", Color3.FromHexString("#3a3630")],
]);

const CAP_NAVY = Color3.FromHexString("#1d2c4a");
const CAP_BLACK = Color3.FromHexString("#10141c");

/**
 * The peaked cap, built procedurally and hung off the rig's `Head` bone.
 *
 * Silhouette is what identifies a police officer at the distance the traffic
 * stop actually plays at — a uniform recolour alone reads as a pedestrian in a
 * dark coat. Three primitives (crown, band, peak) are enough at this polygon
 * budget, and generating them beats shipping a sixth character glb.
 *
 * Two things here are measured, not guessed. The bone's world matrix carries
 * the rig's own 100x armature scale times the model scale (37.4x on these
 * rigs), so the holder divides it back out and every dimension below is plain
 * metres. And the peak sits on **+Z in bone space**, which is the face on this
 * rig — verified by render, and the opposite of what the wrap's yawOffset would
 * lead you to assume.
 */
function addPeakedCap(
  scene: Scene,
  name: string,
  skeleton: Skeleton | null,
  carrier: AbstractMesh | undefined,
): { meshes: Mesh[]; materials: StandardMaterial[] } | null {
  const head = skeleton?.bones.find((bone) => bone.name === "Head");
  if (!head || !carrier) return null;

  const navy = new StandardMaterial(`${name}-cap-navy`, scene);
  navy.diffuseColor = CAP_NAVY.clone();
  navy.specularColor = new Color3(0.05, 0.05, 0.05);
  const black = new StandardMaterial(`${name}-cap-black`, scene);
  black.diffuseColor = CAP_BLACK.clone();
  black.specularColor = new Color3(0.08, 0.08, 0.08);

  const crown = MeshBuilder.CreateCylinder(
    `${name}-cap-crown`,
    { diameterTop: 0.248, diameterBottom: 0.222, height: 0.088, tessellation: 14 },
    scene,
  );
  const band = MeshBuilder.CreateCylinder(
    `${name}-cap-band`,
    { diameter: 0.224, height: 0.045, tessellation: 14 },
    scene,
  );
  const peak = MeshBuilder.CreateCylinder(
    `${name}-cap-peak`,
    { diameter: 0.23, height: 0.017, tessellation: 14 },
    scene,
  );
  crown.material = navy;
  band.material = black;
  peak.material = black;
  crown.position.y = 0.174;
  band.position.y = 0.108;
  peak.position.set(0, 0.113, 0.086);
  peak.scaling.z = 1.05;
  peak.rotation.x = 0.16;

  const holder = new TransformNode(`${name}-cap`, scene);
  for (const mesh of [crown, band, peak]) {
    mesh.parent = holder;
    mesh.isPickable = false;
  }
  // An empty mesh is the only thing attachToBone accepts as the follower.
  const anchor = new Mesh(`${name}-cap-anchor`, scene);
  anchor.isPickable = false;
  holder.parent = anchor;
  anchor.attachToBone(head, carrier);
  // Both of these are load-bearing, and their absence fails silently. A
  // freshly instantiated skeleton still holds the glb's own armature transform
  // (100x on these rigs) and knows nothing of the 0.374 the caller just applied
  // to the model root, so the bone's world matrix reads scale 100 at y=4.2 m
  // rather than scale 37.4 at head height. Decomposing that builds the cap 2.7x
  // oversize and parks it in the air above him — visible in no frame at all.
  carrier.computeWorldMatrix(true);
  skeleton?.prepare();
  anchor.computeWorldMatrix(true);
  const boneScale = new Vector3();
  anchor.getWorldMatrix().decompose(boneScale);
  holder.scaling.setAll(1 / (boneScale.x || 1));

  return { meshes: [crown, band, peak, anchor], materials: [navy, black] };
}

/** The officer who walks up to your window on a traffic stop. */
export function buildOfficerVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
): ActorVisual | null {
  return buildActorFromConfig(
    scene,
    parent,
    name,
    OFFICER_MODEL,
    OFFICER_UNIFORM,
    addPeakedCap,
  );
}

/** Kraft-paper tone for the bag's rolled rim and its handles. */
const BAG_KRAFT = Color3.FromHexString("#8d5a3b");

/**
 * The takeaway bag, in metres — the holder restores real-world scale, so these
 * are not rig units. Sized against the 1.8 m rigs: a two-handful carrier, big
 * enough to read at the nine-to-fifteen metres these scenes are staged from
 * without swinging into the courier's own legs.
 */
const BAG_WIDTH_M = 0.21;
const BAG_HEIGHT_M = 0.24;
const BAG_DEPTH_M = 0.13;
/** Handle length: how far the bag's rim hangs below the palm. */
const BAG_DROP_M = 0.08;

/**
 * The takeaway bag the courier carries on a food errand, built procedurally and
 * hung off the rig's right hand.
 *
 * Generated rather than imported for the same reason the peaked cap is: at the
 * distance these scenes play, a sack, a rolled rim and two handles is the whole
 * silhouette — and `propModelUrls()` is not map-scoped, so a glb would cost all
 * four cities their download bytes forever.
 *
 * Three things here are measured rather than assumed, and all three fail
 * silently:
 *
 * 1. The armature scale, exactly as the cap documents it — a freshly
 *    instantiated skeleton still carries the glb's own 100x armature transform
 *    and knows nothing of the 0.374 the caller just applied, so the holder
 *    divides it back out.
 * 2. **The bone spins.** Across the Run clip `Palm.R` turns through roughly a
 *    right angle: world-down starts at the bone's local +Y (the arm chain runs
 *    wrist-to-fingertip, so this is already the opposite sign from the Head
 *    bone the cap hangs on) and reaches local +X at the front of the swing. A
 *    bag rigidly parented to that hand does not swing — it capsizes, ending up
 *    pointing forwards out of the fist. So the holder's rotation is recomputed
 *    each frame to cancel the bone's, leaving the bag hanging plumb while its
 *    position still swings with the arm, which is what a carried bag does.
 * 3. Because the holder is kept world-upright, everything below is built in
 *    ordinary axes — Y up, the bag hanging at negative Y — rather than in the
 *    bone's frame.
 *
 * The bag is deliberately symmetric front-to-back, so nothing here depends on
 * working out which way round the rig's hand is.
 *
 * Exported so `tests/courierBag.test.ts` can drive it against the real rigs:
 * every failure mode above is invisible in a still frame, and two of them are
 * only wrong once the skeleton is moving.
 */
export function addDeliveryBag(
  scene: Scene,
  name: string,
  skeleton: Skeleton | null,
  carrier: AbstractMesh | undefined,
  actorRoot: TransformNode,
): ActorAttachmentRig | null {
  const hand = skeleton?.bones.find((bone) => bone.name === "Palm.R");
  if (!hand || !carrier) return null;

  const paper = new StandardMaterial(`${name}-bag-paper`, scene);
  paper.diffuseColor = COURIER_RED.clone();
  paper.specularColor = new Color3(0.04, 0.04, 0.04);
  const kraft = new StandardMaterial(`${name}-bag-kraft`, scene);
  kraft.diffuseColor = BAG_KRAFT.clone();
  kraft.specularColor = new Color3(0.04, 0.04, 0.04);

  const sack = MeshBuilder.CreateBox(
    `${name}-bag-sack`,
    { width: BAG_WIDTH_M, height: BAG_HEIGHT_M, depth: BAG_DEPTH_M },
    scene,
  );
  const rim = MeshBuilder.CreateBox(
    `${name}-bag-rim`,
    { width: BAG_WIDTH_M * 1.08, height: 0.035, depth: BAG_DEPTH_M * 1.12 },
    scene,
  );
  const handles = [-1, 1].map((side) => {
    const handle = MeshBuilder.CreateBox(
      `${name}-bag-handle-${side > 0 ? "r" : "l"}`,
      { width: 0.016, height: BAG_DROP_M, depth: 0.016 },
      scene,
    );
    handle.material = kraft;
    handle.position.set(side * BAG_WIDTH_M * 0.28, -BAG_DROP_M / 2, 0);
    return handle;
  });
  sack.material = paper;
  rim.material = kraft;
  sack.position.y = -(BAG_DROP_M + BAG_HEIGHT_M / 2);
  rim.position.y = -(BAG_DROP_M + 0.012);

  const holder = new TransformNode(`${name}-bag`, scene);
  const meshes = [sack, rim, ...handles];
  for (const mesh of meshes) {
    mesh.parent = holder;
    mesh.isPickable = false;
  }
  // An empty mesh is the only thing attachToBone accepts as the follower.
  const anchor = new Mesh(`${name}-bag-anchor`, scene);
  anchor.isPickable = false;
  holder.parent = anchor;
  anchor.attachToBone(hand, carrier);
  carrier.computeWorldMatrix(true);
  skeleton?.prepare();
  anchor.computeWorldMatrix(true);
  const boneScale = new Vector3();
  anchor.getWorldMatrix().decompose(boneScale);
  holder.scaling.setAll(1 / (boneScale.x || 1));
  holder.setEnabled(false);

  // Scratch, so the per-frame plumb correction allocates nothing.
  const holderRotation = Quaternion.Identity();
  holder.rotationQuaternion = holderRotation;
  const boneRotation = new Quaternion();
  const rootRotation = new Quaternion();
  const scratchScale = new Vector3();
  const upright = new Quaternion();

  return {
    meshes: [...meshes, anchor],
    materials: [paper, kraft],
    setVisible(visible) {
      holder.setEnabled(visible);
    },
    update() {
      if (!holder.isEnabled()) return;
      anchor.computeWorldMatrix(true);
      anchor.getWorldMatrix().decompose(scratchScale, boneRotation);
      // The bag turns with the courier but never tips with their wrist. Taken
      // off the actor's own root rather than the bone, whose yaw is swinging.
      actorRoot.computeWorldMatrix(true);
      actorRoot.getWorldMatrix().decompose(scratchScale, rootRotation);
      Quaternion.RotationYawPitchRollToRef(
        rootRotation.toEulerAngles().y,
        0,
        0,
        upright,
      );
      boneRotation.invertInPlace();
      boneRotation.multiplyToRef(upright, holderRotation);
    },
  };
}

/** The courier on a food errand: the driver actor with a takeaway bag in hand,
 * shown only on the leg of the errand they are actually carrying the order. */
export function buildCourierVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
): ActorVisual | null {
  const config = CHARACTER_MODELS[Math.abs(variant) % CHARACTER_MODELS.length];
  return buildActorFromConfig(
    scene,
    parent,
    name,
    config,
    materialOverrides(config, colors),
    addDeliveryBag,
  );
}

/** What an attachment hands back: what to dispose, plus whatever handles the
 * kit needs to be driven by (the cap needs neither; the bag needs both). */
interface ActorAttachmentRig {
  readonly meshes: Mesh[];
  readonly materials: StandardMaterial[];
  setVisible?(visible: boolean): void;
  update?(): void;
}

/** Optional headwear/kit hung off the rig's skeleton once it is instantiated.
 * `actorRoot` is the yaw-carrying node above the model, which is where kit that
 * must stay world-upright reads the actor's own facing from. */
type ActorAttachment = (
  scene: Scene,
  name: string,
  skeleton: Skeleton | null,
  carrier: AbstractMesh | undefined,
  actorRoot: TransformNode,
) => ActorAttachmentRig | null;

function buildActorFromConfig(
  scene: Scene,
  parent: TransformNode,
  name: string,
  config: CharacterModelConfig,
  overrides: ReadonlyMap<string, Color3>,
  attachment?: ActorAttachment,
): ActorVisual | null {
  if (!isModelReady(scene, config.url)) return null;
  const instance = instantiateModel(scene, config.url);
  const modelRoot = instance?.rootNodes[0] as TransformNode | undefined;
  if (!instance || !modelRoot) return null;

  const root = new TransformNode(`${name}-actor`, scene);
  root.parent = parent;
  root.rotation.y = config.yawOffset;
  modelRoot.parent = root;
  modelRoot.scaling.setAll(config.scale);

  const owned = convertMaterials(scene, name, root, overrides);
  addContactShadow(scene, name, root, 0.62, 0.5);

  // Bone-attached kit rides the skeleton's world matrix, so it must be built
  // after the model is parented and scaled — and it lives outside `root`, which
  // is why dispose() has to reach it explicitly.
  const skeleton = instance.skeletons[0] ?? null;
  const carrier = instance.rootNodes[0]
    ?.getChildMeshes(false)
    .find((mesh) => mesh.skeleton === skeleton);
  const attached = attachment?.(scene, name, skeleton, carrier, root) ?? null;

  const clips = new Map<ActorClip, AnimationGroup>();
  for (const group of instance.animationGroups) {
    const match = ACTOR_CLIP_PATTERNS.find(
      ([clip, pattern]) => !clips.has(clip) && pattern.test(group.name),
    );
    if (match) {
      group.enableBlending = true;
      group.blendingSpeed = 0.09;
      clips.set(match[0], group);
    } else {
      group.dispose();
    }
  }

  let disposed = false;
  let active: AnimationGroup | undefined;
  const visual: ActorVisual = {
    root,
    setClip(clip, speedRatio = 1) {
      if (disposed) return;
      const next = clips.get(clip);
      if (!next) return;
      if (active === next) {
        next.speedRatio = speedRatio;
        return;
      }
      active?.stop();
      active = next;
      next.speedRatio = speedRatio;
      next.play(true);
    },
    setCarrying(carrying) {
      if (disposed) return;
      attached?.setVisible?.(carrying);
    },
    update() {
      if (disposed) return;
      attached?.update?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const group of clips.values()) group.dispose();
      for (const mesh of attached?.meshes ?? []) mesh.dispose(false, false);
      root.dispose(false, false);
      for (const material of [...owned, ...(attached?.materials ?? [])]) {
        material.dispose(true, false);
      }
    },
  };
  visual.setClip("idle");
  return visual;
}

/** Rigs a cyclist may ride: every model but the dress one — a knee-length
 * skirt skinned to two counter-phased pedalling legs shears unavoidably. */
const CYCLIST_RIDER_MODELS: readonly CharacterModelConfig[] = CHARACTER_MODELS.filter(
  (config) => !config.url.includes("person-woman-b"),
);

/**
 * A cyclist: the bicycle prop with a rider seated on it — hips on the saddle,
 * hands on the grips, feet riding the split pedal nodes, legs pedalling and
 * wheels rolling with ground distance. The rider is one of the pedestrian
 * character models; the posture and pedal cycle are solved from measured
 * geometry in cyclistPose.ts (no cycling clip ships CC0), with clothing and
 * complexion recoloured for crowd variety.
 */
export function buildCyclistVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
): CharacterVisual | null {
  const riderConfig =
    CYCLIST_RIDER_MODELS[Math.abs(variant) % CYCLIST_RIDER_MODELS.length];
  if (!isModelReady(scene, BICYCLE_MODEL.url) || !isModelReady(scene, riderConfig.url)) {
    return null;
  }
  const bikeInstance = instantiateModel(scene, BICYCLE_MODEL.url);
  const riderInstance = instantiateModel(scene, riderConfig.url);
  const bikeRoot = bikeInstance?.rootNodes[0] as TransformNode | undefined;
  const riderRoot = riderInstance?.rootNodes[0] as TransformNode | undefined;
  if (!bikeInstance || !riderInstance || !bikeRoot || !riderRoot) {
    bikeInstance?.rootNodes[0]?.dispose();
    riderInstance?.rootNodes[0]?.dispose();
    return null;
  }

  const root = new TransformNode(`${name}-cyclist`, scene);
  root.parent = parent;

  // Bike faces +X (tires along X); wrap + yaw so it points +Z. (Rotating the glb
  // __root__ directly is ignored — it carries a rotationQuaternion.)
  const bikeWrap = new TransformNode(`${name}-bikewrap`, scene);
  bikeWrap.parent = root;
  bikeWrap.rotation.y = BICYCLE_MODEL.yawOffset;
  bikeRoot.parent = bikeWrap;
  bikeRoot.scaling.setAll(BICYCLE_MODEL.scale);
  const bikeMaterials = convertMaterials(scene, `${name}-bike`, bikeWrap, new Map());

  // Centre the bike on the cyclist's pivot: the glb's wheelbase midpoint and
  // frame plane are offset from its origin, which used to park the whole bike
  // ~0.10 m to one side of the rail point (and of the rider).
  {
    const tires = bikeRoot
      .getChildTransformNodes(false)
      .filter((node) => /Tire/.test(node.name));
    if (tires.length === 2) {
      const mid = new Vector3();
      for (const tire of tires) {
        tire.computeWorldMatrix(true);
        mid.addInPlace(tire.getAbsolutePosition());
      }
      mid.scaleInPlace(0.5);
      root.computeWorldMatrix(true);
      const rootInv = root.getWorldMatrix().clone().invert();
      Vector3.TransformCoordinatesToRef(mid, rootInv, mid);
      bikeWrap.position.x -= mid.x;
      bikeWrap.position.z -= mid.z;
      bikeWrap.computeWorldMatrix(true);
    }
  }

  // Rider faces +Z (rig faces -Z); cyclistPose seats it onto the saddle.
  const riderWrap = new TransformNode(`${name}-riderwrap`, scene);
  riderWrap.parent = root;
  riderWrap.rotation.y = riderConfig.yawOffset;
  riderRoot.parent = riderWrap;
  riderRoot.scaling.setAll(riderConfig.scale);
  const riderMaterials = convertMaterials(
    scene,
    `${name}-rider`,
    riderRoot,
    materialOverrides(riderConfig, colors),
  );
  // The skeleton is posed from measured geometry; the imported walk/idle clips
  // would fight it, so drop them before solving.
  for (const group of riderInstance.animationGroups) group.dispose();
  const rig = setupCyclistPose(root, bikeRoot, riderWrap, riderRoot);
  let phase = 0;
  let wheelAngle = 0;

  addContactShadow(scene, name, root, 0.7, 1.7);

  let disposed = false;
  return {
    root,
    advancePedals(distanceMeters) {
      if (disposed || !rig) return;
      phase += distanceMeters * PEDAL_CRANK_RATE;
      wheelAngle += distanceMeters * WHEEL_ROLL_RATE;
      poseCyclist(rig, phase, wheelAngle);
    },
    setRiderVisible(visible) {
      if (disposed) return;
      riderWrap.setEnabled(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
      for (const material of [...bikeMaterials, ...riderMaterials]) {
        material.dispose(true, false);
      }
    },
  };
}

/**
 * The player's motorbike: the CC0 cartoon motorcycle recoloured to the courier
 * livery with a rigged rider seated on it — the static-pose sibling of
 * buildCyclistVisual (no pedals to animate; the merged-mesh wheels don't
 * spin). Returns null until both glbs are preloaded.
 */
export function buildMotorbikeVisual(
  scene: Scene,
  parent: TransformNode,
  name: string,
  variant: number,
  colors: CharacterColors,
): CharacterVisual | null {
  const riderConfig =
    CYCLIST_RIDER_MODELS[Math.abs(variant) % CYCLIST_RIDER_MODELS.length];
  if (
    !isModelReady(scene, MOTORBIKE_MODEL.url) ||
    !isModelReady(scene, riderConfig.url)
  ) {
    return null;
  }
  const bikeInstance = instantiateModel(scene, MOTORBIKE_MODEL.url);
  const riderInstance = instantiateModel(scene, riderConfig.url);
  const bikeRoot = bikeInstance?.rootNodes[0] as TransformNode | undefined;
  const riderRoot = riderInstance?.rootNodes[0] as TransformNode | undefined;
  if (!bikeInstance || !riderInstance || !bikeRoot || !riderRoot) {
    bikeInstance?.rootNodes[0]?.dispose();
    riderInstance?.rootNodes[0]?.dispose();
    return null;
  }

  const root = new TransformNode(`${name}-motorbike`, scene);
  root.parent = parent;

  // Authored front is −Z; the π yaw puts it on wrap +Z, matching the rider.
  const bikeWrap = new TransformNode(`${name}-bikewrap`, scene);
  bikeWrap.parent = root;
  bikeWrap.rotation.y = MOTORBIKE_MODEL.yawOffset;
  bikeRoot.parent = bikeWrap;
  bikeRoot.scaling.setAll(MOTORBIKE_MODEL.scale);
  const bikeMaterials = convertMaterials(
    scene,
    `${name}-bike`,
    bikeWrap,
    new Map([["LightPurple", COURIER_RED]]),
  );

  // Centre the bike on the pivot via its own AABB midpoint (no wheel nodes to
  // measure): the glb's footprint is offset toward the rear.
  {
    bikeWrap.computeWorldMatrix(true);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const mesh of bikeWrap.getChildMeshes(false)) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, bounds.minimumWorld.x);
      maxX = Math.max(maxX, bounds.maximumWorld.x);
      minZ = Math.min(minZ, bounds.minimumWorld.z);
      maxZ = Math.max(maxZ, bounds.maximumWorld.z);
    }
    if (Number.isFinite(minX)) {
      const mid = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      root.computeWorldMatrix(true);
      const rootInv = root.getWorldMatrix().clone().invert();
      Vector3.TransformCoordinatesToRef(mid, rootInv, mid);
      bikeWrap.position.x -= mid.x;
      bikeWrap.position.z -= mid.z;
      bikeWrap.computeWorldMatrix(true);
    }
  }

  const riderWrap = new TransformNode(`${name}-riderwrap`, scene);
  riderWrap.parent = root;
  riderWrap.rotation.y = riderConfig.yawOffset;
  riderRoot.parent = riderWrap;
  riderRoot.scaling.setAll(riderConfig.scale);
  const riderMaterials = convertMaterials(
    scene,
    `${name}-rider`,
    riderRoot,
    materialOverrides(riderConfig, colors),
  );
  for (const group of riderInstance.animationGroups) group.dispose();
  setupSeatedRiderPose(root, bikeRoot, riderWrap, riderRoot, MOTORBIKE_GLB_ANCHORS);

  addContactShadow(scene, name, root, 0.8, 2.0);

  let disposed = false;
  return {
    root,
    setRiderVisible(visible) {
      if (disposed) return;
      riderWrap.setEnabled(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.dispose(false, false);
      for (const material of [...bikeMaterials, ...riderMaterials]) {
        material.dispose(true, false);
      }
    },
  };
}
