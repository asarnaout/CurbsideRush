import {
  type AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  createBox,
  createCylinder,
  createExtrudedPrism,
  setMeshMaterial,
} from "./meshPrimitives";
import { makeInstrumentClusterTexture } from "./proceduralTextures";
import { COCKPIT_LAYER_MASK } from "./renderConstants";
import {
  cockpitScreenSpan,
  cockpitScreenTiltX,
  COCKPIT_BINNACLE_PROFILE,
  COCKPIT_BINNACLE_WIDTH,
  COCKPIT_CABIN_WIDTH,
  COCKPIT_CLUSTER,
  COCKPIT_DASH_PROFILE,
  COCKPIT_DOOR_PROFILE,
  COCKPIT_DOOR_X,
  COCKPIT_GAUGE_CENTRES,
  COCKPIT_GAUGE_RADIUS,
  COCKPIT_PILLAR_PROFILE,
  COCKPIT_PILLAR_THICKNESS,
  COCKPIT_PILLAR_X,
  COCKPIT_ROOF_PROFILE,
  COCKPIT_SCREEN,
  COCKPIT_STEERING_EMBLEM,
  COCKPIT_STEERING_HUB,
  COCKPIT_VENT_PROFILE,
  COCKPIT_VENT_SLOTS,
  resolveCockpitSteeringGeometry,
} from "../cockpitLayout";
import type { MapVisualPalette } from "../visuals";
import type { SteeringSide } from "../sessionContract";

/**
 * The first-person cabin: `buildCockpit`'s ~40 hand-placed parts (dash,
 * pillars, vents, instrument cluster, steering assembly, windscreen),
 * `mergeCockpitStatics`'s post-build collapse to one mesh per material, and
 * the `makeInteriorMaterial` cabin-surface helper they both need — exclusive
 * to this cargo (6 call sites, all inside `buildCockpit`), unlike
 * `makeMaterial`, which stays behind and is duplicated locally per house
 * convention since `makeInteriorMaterial` itself calls it.
 *
 * De-methodized (Phase 3.7 — the first Phase 3 commit crossing the plan's
 * coupling >= 9 threshold, characterized ahead of time by
 * `tests/cockpitCharacterization.test.tsx`). `playerCockpit` is
 * constructor-owned session state that outlives any one build call, so it
 * comes in through ctx rather than being created here; `steeringAssembly`/
 * `gaugeNeedles`/`windscreenParts` are written here but read every frame by
 * session-resident per-frame methods (steering-wheel spin, gauge-needle
 * pose, low-spec windscreen toggling) that stay behind, so they come back as
 * a returned record instead of ctx fields, matching the pattern Phase 3.1
 * established for `cameraFarPlaneM`. `buildWingMirror` is threaded as a ctx
 * callback — it is cross-cargo (Phase 3.12's `mirrorRig`), not part of this
 * commit, and every caller should stay agnostic to where it currently lives.
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

export interface CockpitBuilderCtx {
  readonly scene: Scene;
  readonly playerCockpit: TransformNode;
  readonly visualPalette: MapVisualPalette;
  readonly steeringSide: SteeringSide;
  readonly buildWingMirror: (
    steeringRubber: StandardMaterial,
    shell: StandardMaterial,
  ) => void;
}

export interface CockpitBuildResult {
  readonly steeringAssembly: TransformNode;
  readonly gaugeNeedles: TransformNode[];
  readonly windscreenParts: Mesh[];
}

/**
 * A cabin surface: like `makeMaterial`, but it actually collects the scene's
 * ambient term.
 *
 * Babylon defaults `StandardMaterial.ambientColor` to black, and the ambient
 * contribution is `scene.ambientColor * material.ambientColor` — so every
 * material built by `makeMaterial` throws the scene's ambient light away. Out in
 * the city that is invisible, because the sun and the sky light do the work. In
 * the cockpit it is most of the problem: the interior faces away from both
 * lights, sits under the pipeline's vignette, and had nothing else lifting it.
 *
 * Ambient is also the only lift available that costs nothing. The scene has
 * exactly two lights and every material in the game compiles against both;
 * adding a third for the cabin would recompile every material and put another
 * light term on every fragment on screen, to brighten geometry that covers a
 * third of one camera.
 */
function makeInteriorMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
  ambient = 0.75,
): StandardMaterial {
  const material = makeMaterial(scene, name, color, emissive);
  material.ambientColor = new Color3(ambient, ambient, ambient);
  return material;
}

/**
 * The first-person interior.
 *
 * Built unconditionally, even on a bicycle day where it is never shown, and
 * hung off `playerCockpit` — which `applyCameraStack` enables only in first
 * person. Layout lives in `cockpitLayout`; this method is only the
 * translation from those numbers into meshes.
 */
export function buildCockpit(ctx: CockpitBuilderCtx): CockpitBuildResult {
  const scene = ctx.scene;
  const bodyDark = makeMaterial(scene, "player-blue-dark", new Color3(0.04, 0.23, 0.3));
  // A cabin is a lit room, not a silhouette. These sit an order of magnitude
  // above where they used to, because the old values were tuned as if the
  // dash were part of the night outside — the emissive term is a floor that
  // keeps surfaces legible through the pipeline's vignette, which lands
  // squarely on the lower half of the frame where the cockpit is. All of them
  // stay well under the lowest shipped `bloomThreshold` (Cairo's 0.62); only
  // the gauge accents are allowed anywhere near it.
  // A cabin needs a big ambient floor after dark and almost none at noon.
  // Diffuse is the term the sun multiplies, and the sun runs at 1.3 by day
  // against 0.6 at night, while ambient and emissive are flat in both — so a
  // single palette is either unreadable in New York or bleached in London.
  // Pick per map, the way the building night glow already does.
  // The numbers below are the night values; daylight scales all three down,
  // because by day the sun does the work and the same floor that rescues a
  // New York cabin bleaches a London one to flat beige.
  const night = ctx.visualPalette?.night ?? false;
  const toneScale = night ? 1 : 0.73;
  const ambientFloor = night ? 0.6 : 0.3;
  const glowScale = night ? 1 : 0.5;
  const surface = (r: number, g: number, b: number) =>
    new Color3(r * toneScale, g * toneScale, b * toneScale);
  const lit = (r: number, g: number, b: number) =>
    new Color3(r * glowScale, g * glowScale, b * glowScale);
  const steeringRubber = makeInteriorMaterial(
    scene,
    "steering-rubber",
    surface(0.105, 0.097, 0.09),
    lit(0.02, 0.019, 0.017),
    ambientFloor * 0.72,
  );
  const dash = makeInteriorMaterial(
    scene,
    "dashboard",
    surface(0.275, 0.253, 0.229),
    lit(0.038, 0.035, 0.031),
    ambientFloor,
  );
  const cockpitTrim = makeInteriorMaterial(
    scene,
    "cockpit-trim",
    surface(0.335, 0.31, 0.281),
    lit(0.044, 0.04, 0.035),
    ambientFloor,
  );
  const instrumentFace = makeInteriorMaterial(
    scene,
    "instrument-face",
    new Color3(0.045, 0.055, 0.062),
    new Color3(0.02, 0.032, 0.038),
    0.3,
  );
  const instrumentGlow = makeInteriorMaterial(
    scene,
    "instrument-glow",
    new Color3(0.08, 0.4, 0.38),
    new Color3(0.05, 0.28, 0.26),
    0.3,
  );
  const ventShadow = makeInteriorMaterial(
    scene,
    "cockpit-vent-shadow",
    new Color3(0.028, 0.026, 0.024),
    undefined,
    0.15,
  );
  createBox(scene, "cockpit-hood", { width: 1.62, height: 0.045, depth: 0.42 }, new Vector3(0, 0.74, 1.55), bodyDark, ctx.playerCockpit);
  createExtrudedPrism(
    scene,
    "cockpit-dash-shell",
    COCKPIT_CABIN_WIDTH,
    COCKPIT_DASH_PROFILE,
    dash,
    ctx.playerCockpit,
  );
  createBox(scene, "cockpit-dash-trim", { width: 1.78, height: 0.014, depth: 0.02 }, new Vector3(0, 0.948, 0.354), cockpitTrim, ctx.playerCockpit);
  createBox(scene, "windshield-sill", { width: COCKPIT_CABIN_WIDTH, height: 0.028, depth: 0.09 }, new Vector3(0, 1.155, 0.985), cockpitTrim, ctx.playerCockpit);
  for (const side of [-1, 1]) {
    createBox(
      scene,
      `cockpit-door-beltline-${side}`,
      { width: 0.12, height: 0.11, depth: 1.12 },
      new Vector3(side * 0.94, 0.82, 0.12),
      cockpitTrim,
      ctx.playerCockpit,
    );
    const doorCard = createExtrudedPrism(
      scene,
      `cockpit-door-card-${side}`,
      0.05,
      COCKPIT_DOOR_PROFILE,
      dash,
      ctx.playerCockpit,
    );
    doorCard.position.x = side * COCKPIT_DOOR_X;
    const pillar = createExtrudedPrism(
      scene,
      `cockpit-a-pillar-${side}`,
      COCKPIT_PILLAR_THICKNESS,
      COCKPIT_PILLAR_PROFILE,
      cockpitTrim,
      ctx.playerCockpit,
    );
    pillar.position.x = side * COCKPIT_PILLAR_X;
    createBox(
      scene,
      `cockpit-sun-visor-${side}`,
      { width: 0.44, height: 0.022, depth: 0.19 },
      new Vector3(side * 0.4, 1.652, 0.612),
      cockpitTrim,
      ctx.playerCockpit,
    ).rotation.x = -0.42;
  }
  createExtrudedPrism(
    scene,
    "cockpit-header-rail",
    COCKPIT_CABIN_WIDTH,
    COCKPIT_ROOF_PROFILE,
    cockpitTrim,
    ctx.playerCockpit,
  );

  // The glass. One near-transparent pane over the whole aperture plus a
  // darker band along the header, the way a real screen is tinted. Lighting
  // is off (the colour IS the emissive) and depth writes are disabled, so it
  // can never occlude the alpha-blended crowd and shadows behind it.
  const screenTilt = cockpitScreenTiltX();
  const screenSpan = cockpitScreenSpan();
  const screenMidY = (COCKPIT_SCREEN.sillY + COCKPIT_SCREEN.headerY) / 2;
  const screenMidZ = (COCKPIT_SCREEN.sillZ + COCKPIT_SCREEN.headerZ) / 2;
  const glassMaterial = new StandardMaterial("windscreen-glass", scene);
  glassMaterial.diffuseColor = Color3.Black();
  glassMaterial.specularColor = Color3.Black();
  glassMaterial.emissiveColor = new Color3(0.44, 0.5, 0.56);
  glassMaterial.alpha = 0.055;
  glassMaterial.disableLighting = true;
  glassMaterial.disableDepthWrite = true;
  glassMaterial.backFaceCulling = false;
  const windscreenParts: Mesh[] = [];
  const glass = MeshBuilder.CreatePlane(
    "windscreen-glass",
    { width: COCKPIT_SCREEN.halfWidth * 2, height: screenSpan },
    scene,
  );
  glass.parent = ctx.playerCockpit;
  glass.position.set(0, screenMidY, screenMidZ);
  glass.rotation.x = screenTilt;
  setMeshMaterial(glass, glassMaterial);
  windscreenParts.push(glass);

  const bandMaterial = new StandardMaterial("windscreen-band", scene);
  bandMaterial.diffuseColor = Color3.Black();
  bandMaterial.specularColor = Color3.Black();
  bandMaterial.emissiveColor = new Color3(0.06, 0.07, 0.085);
  bandMaterial.alpha = 0.5;
  bandMaterial.disableLighting = true;
  bandMaterial.disableDepthWrite = true;
  bandMaterial.backFaceCulling = false;
  const band = MeshBuilder.CreatePlane(
    "windscreen-band",
    { width: COCKPIT_SCREEN.halfWidth * 2, height: screenSpan * 0.16 },
    scene,
  );
  band.parent = ctx.playerCockpit;
  const bandOffset = screenSpan * 0.42;
  band.position.set(
    0,
    screenMidY + bandOffset * Math.cos(screenTilt),
    screenMidZ + bandOffset * Math.sin(screenTilt),
  );
  band.rotation.x = screenTilt;
  setMeshMaterial(band, bandMaterial);
  windscreenParts.push(band);

  // Wipers, parked along the sill.
  for (const side of [-1, 1]) {
    const wiper = createBox(
      scene,
      `windscreen-wiper-${side}`,
      { width: 0.66, height: 0.014, depth: 0.026 },
      new Vector3(side * 0.35, COCKPIT_SCREEN.sillY + 0.036, COCKPIT_SCREEN.sillZ - 0.03),
      steeringRubber,
      ctx.playerCockpit,
    );
    wiper.rotation.z = side * 0.075;
    windscreenParts.push(wiper);
  }

  // Air vents. The profile is authored lying down and turned a quarter turn
  // about Y so its sweep becomes depth — see COCKPIT_VENT_PROFILE. Each one
  // is a bezel, a dark throat set behind it so the opening reads as a hole
  // rather than a badge, and a single blade across the middle.
  for (const [index, slot] of COCKPIT_VENT_SLOTS.entries()) {
    const bezel = createExtrudedPrism(
      scene,
      `cockpit-vent-${index}`,
      0.05,
      COCKPIT_VENT_PROFILE,
      cockpitTrim,
      ctx.playerCockpit,
    );
    bezel.rotation.y = Math.PI / 2;
    bezel.scaling.set(1, slot.width * 0.42, slot.width);
    bezel.position.set(slot.x, slot.y, slot.z);
    // The throat sits a whisker in FRONT of the bezel's face, not behind it.
    // The bezel is a solid prism, so a throat at a physically-correct depth
    // is simply inside it and never seen; a smaller dark plate laid on top
    // reads as the hole instead, and the bezel survives as a border.
    const throat = createExtrudedPrism(
      scene,
      `cockpit-vent-throat-${index}`,
      0.012,
      COCKPIT_VENT_PROFILE,
      ventShadow,
      ctx.playerCockpit,
    );
    throat.rotation.y = Math.PI / 2;
    throat.scaling.set(1, slot.width * 0.3, slot.width * 0.84);
    throat.position.set(slot.x, slot.y, slot.z - 0.029);
    createBox(
      scene,
      `cockpit-vent-blade-${index}`,
      { width: slot.width * 0.7, height: 0.008, depth: 0.01 },
      new Vector3(slot.x, slot.y, slot.z - 0.036),
      cockpitTrim,
      ctx.playerCockpit,
    );
  }

  const steeringGeometry = resolveCockpitSteeringGeometry(
    ctx.steeringSide,
  );
  const wheelX = steeringGeometry.x;

  const binnacle = createExtrudedPrism(
    scene,
    "instrument-hood",
    COCKPIT_BINNACLE_WIDTH,
    COCKPIT_BINNACLE_PROFILE,
    dash,
    ctx.playerCockpit,
  );
  binnacle.position.x = wheelX;

  const clusterRoot = new TransformNode("instrument-cluster", scene);
  clusterRoot.parent = ctx.playerCockpit;
  clusterRoot.position.set(wheelX, COCKPIT_CLUSTER.y, COCKPIT_CLUSTER.z);
  clusterRoot.rotation.x = COCKPIT_CLUSTER.tiltX;
  createBox(
    scene,
    "instrument-cluster-shell",
    { width: COCKPIT_CLUSTER.width + 0.022, height: COCKPIT_CLUSTER.height + 0.018, depth: 0.02 },
    Vector3.Zero(),
    instrumentFace,
    clusterRoot,
  );
  const clusterFace = MeshBuilder.CreatePlane(
    "instrument-cluster-face",
    { width: COCKPIT_CLUSTER.width, height: COCKPIT_CLUSTER.height },
    scene,
  );
  clusterFace.parent = clusterRoot;
  clusterFace.position.z = -0.0105;
  const clusterMaterial = makeMaterial(
    scene,
    "instrument-cluster-lit",
    Color3.White(),
    new Color3(0.62, 0.62, 0.62),
  );
  const clusterTexture = makeInstrumentClusterTexture(scene);
  clusterMaterial.diffuseTexture = clusterTexture;
  clusterMaterial.emissiveTexture = clusterTexture;
  setMeshMaterial(clusterFace, clusterMaterial);

  // Needles are meshes on pivots, driven from updatePlayerVisuals.
  const needleMaterial = makeMaterial(
    scene,
    "instrument-needle",
    new Color3(0.85, 0.93, 0.92),
    new Color3(0.42, 0.5, 0.49),
  );
  const needleLength = COCKPIT_CLUSTER.height * COCKPIT_GAUGE_RADIUS * 1.55;
  const gaugeNeedles = COCKPIT_GAUGE_CENTRES.map((centre, index) => {
    const pivot = new TransformNode(`instrument-needle-pivot-${index}`, scene);
    pivot.parent = clusterRoot;
    pivot.position.set(
      (centre - 0.5) * COCKPIT_CLUSTER.width,
      0,
      -0.0135,
    );
    createBox(
      scene,
      `instrument-needle-${index}`,
      { width: 0.0038, height: needleLength, depth: 0.0026 },
      new Vector3(0, needleLength * 0.4, 0),
      needleMaterial,
      pivot,
    );
    return pivot;
  });

  createBox(scene, "instrument-status", { width: 0.05, height: 0.012, depth: 0.01 }, new Vector3(0, 0.905, 0.298), instrumentGlow, ctx.playerCockpit);

  const steeringMount = new TransformNode("steering-mount", scene);
  steeringMount.position.set(
    steeringGeometry.x,
    steeringGeometry.y,
    steeringGeometry.z,
  );
  steeringMount.rotation.x = steeringGeometry.mountRotationX;
  steeringMount.parent = ctx.playerCockpit;
  createCylinder(
    scene,
    "steering-column-shroud",
    {
      height: 0.13,
      diameterTop: 0.075,
      diameterBottom: 0.055,
      tessellation: 16,
    },
    new Vector3(0, 0.075, 0),
    steeringRubber,
    steeringMount,
  );

  const steeringAssembly = new TransformNode("steering-spin", scene);
  steeringAssembly.parent = steeringMount;
  const steeringWheel = MeshBuilder.CreateTorus(
    "steering-wheel",
    {
      diameter: steeringGeometry.wheelDiameter,
      thickness: steeringGeometry.rimThickness,
      tessellation: 28,
    },
    scene,
  );
  steeringWheel.parent = steeringAssembly;
  setMeshMaterial(steeringWheel, steeringRubber);

  // Three spokes, not two. The assembly's local +Z points down the face of
  // the wheel once the column tilt is applied, so the bottom spoke runs along
  // +Z and the pair runs along ±X. The spokes and hub take the dash colour
  // and the rim stays dark, which is the two-tone the reference has and the
  // only thing that keeps a wheel from reading as one black ring.
  const spokeReach = steeringGeometry.wheelDiameter / 2;
  for (const side of [-1, 1]) {
    createBox(
      scene,
      `wheel-spoke-${side}`,
      { width: spokeReach, height: 0.02, depth: 0.038 },
      new Vector3(side * spokeReach * 0.55, 0, 0.022),
      cockpitTrim,
      steeringAssembly,
    );
  }
  createBox(
    scene,
    "wheel-lower-spoke",
    { width: 0.044, height: 0.02, depth: spokeReach * 0.82 },
    new Vector3(0, 0, spokeReach * 0.56),
    cockpitTrim,
    steeringAssembly,
  );
  const steeringHub = createCylinder(
    scene,
    "steering-hub",
    {
      height: COCKPIT_STEERING_HUB.height,
      diameter: COCKPIT_STEERING_HUB.diameter,
      tessellation: COCKPIT_STEERING_HUB.tessellation,
    },
    new Vector3(
      0,
      COCKPIT_STEERING_HUB.centerY,
      COCKPIT_STEERING_HUB.centerZ,
    ),
    cockpitTrim,
    steeringAssembly,
  );
  steeringHub.scaling.z = COCKPIT_STEERING_HUB.scaleZ;
  const steeringEmblem = createCylinder(
    scene,
    "steering-emblem",
    {
      height: COCKPIT_STEERING_EMBLEM.height,
      diameter: COCKPIT_STEERING_EMBLEM.diameter,
      tessellation: COCKPIT_STEERING_EMBLEM.tessellation,
    },
    new Vector3(
      0,
      COCKPIT_STEERING_EMBLEM.centerY,
      COCKPIT_STEERING_EMBLEM.centerZ,
    ),
    steeringRubber,
    steeringAssembly,
  );
  steeringEmblem.scaling.z = COCKPIT_STEERING_EMBLEM.scaleZ;

  ctx.buildWingMirror(steeringRubber, cockpitTrim);
  mergeCockpitStatics(ctx.scene, ctx.playerCockpit, windscreenParts);
  for (const mesh of ctx.playerCockpit.getChildMeshes(false)) {
    mesh.layerMask = COCKPIT_LAYER_MASK;
    // The cabin is on screen by definition whenever it is enabled at all, so
    // frustum-testing it every frame is pure waste. It also cannot be
    // freezeWorldMatrix'd — playerCockpit hangs off the player node, whose
    // transform is rewritten every frame — which is exactly why the part
    // count matters and the statics above are merged.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
  }
  for (const material of [
    bodyDark,
    steeringRubber,
    dash,
    cockpitTrim,
    ventShadow,
    instrumentFace,
    instrumentGlow,
    clusterMaterial,
    needleMaterial,
    glassMaterial,
    bandMaterial,
  ]) {
    material.freeze();
  }

  return { steeringAssembly, gaugeNeedles, windscreenParts };
}

/**
 * Collapses the cabin's static parts down to one mesh per material.
 *
 * The interior is now around forty pieces, and none of them can have its
 * world matrix frozen, so every one is a draw call and a matrix walk on every
 * frame of every first-person drive. Merging by material takes that back
 * below where it was before the cabin was rebuilt.
 *
 * The parent is dropped before merging and restored after: `mesh.parent =
 * null` leaves the local transform in place as the world transform, which is
 * cockpit space, so the baked vertices come out in the coordinates the
 * cockpit node expects. Merging while still parented would bake in wherever
 * the car happened to be sitting at construction time. A fresh mesh is passed
 * as the merge target for the same reason — Babylon would otherwise reuse the
 * first source, whose own transform has already been applied to its vertices.
 *
 * The windscreen parts stay out of it: they are toggled independently on the
 * blurriest render rung.
 */
function mergeCockpitStatics(
  scene: Scene,
  playerCockpit: TransformNode,
  windscreenParts: readonly Mesh[],
): void {
  const keepSeparate = new Set<AbstractMesh>(windscreenParts);
  const groups = new Map<string, Mesh[]>();
  for (const child of playerCockpit.getChildMeshes(true)) {
    if (keepSeparate.has(child)) continue;
    const key = child.material?.name ?? "";
    const group = groups.get(key);
    if (group) group.push(child as Mesh);
    else groups.set(key, [child as Mesh]);
  }
  for (const [key, meshes] of groups) {
    if (meshes.length < 2) continue;
    const material = meshes[0].material;
    const target = new Mesh(`cockpit-merged-${key}`, scene);
    for (const mesh of meshes) mesh.parent = null;
    const merged = Mesh.MergeMeshes(meshes, true, true, target, false, false);
    if (!merged) {
      // Nothing was merged, so the sources are still live: put them back
      // rather than leaving the cabin scattered at the world origin.
      target.dispose();
      for (const mesh of meshes) mesh.parent = playerCockpit;
      continue;
    }
    merged.material = material;
    merged.isPickable = false;
    merged.receiveShadows = false;
    merged.parent = playerCockpit;
  }
}
