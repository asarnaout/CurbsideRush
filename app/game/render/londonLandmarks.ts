import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { createBox, createCylinder, setMeshMaterial } from "./meshPrimitives";
import { textureContext } from "./proceduralTextures";
import {
  LONDON_BOLLARD_POSITIONS,
  LONDON_LAMP_POSITIONS,
  LONDON_PLANTER_POSITIONS,
  type DestructiblePropPart,
} from "./propCatalog";
import {
  LONDON_BELISHA_BEACONS,
  LONDON_GUARDRAILS,
  LONDON_PHONE_BOXES,
  LONDON_PILLAR_BOXES,
} from "../londonStreetFurniture";
import {
  regulatorySignYawRad,
  speedLimitSignFamily,
  speedLimitSignYawRad,
  type RegulatorySignKind,
  type RegulatorySignPlacement,
  type SpeedLimitSignPlacement,
} from "../regulatorySigns";
import type { GameCanvasMapPack } from "../sessionContract";
import { cairoBridgePortalVisualAxis } from "../geometry/waterGeometry";
import { defaultSidewalkWidthM } from "../visuals";

/**
 * London-specific landmark silhouettes, its hand-placed street furniture, and
 * the two nationwide sign families (regulatory one-way/DNE/wrong-way blades,
 * speed-limit plates). De-methodized out of `BabylonGameSession`
 * (Phase 3.5) — all five functions share one ctx shape, since none needs to
 * be called from outside this file (unlike venueProps.ts's
 * `instantiateProp`).
 *
 * `signPostMaster`'s memoized post mesh — shared by both sign families,
 * whichever builds first — was a `this.signPost` field read/written nowhere
 * else in the class; it becomes a cache here rather than a ctx field, since
 * ctx is for session state, not this file's own cache. Keyed by `Scene`
 * (`WeakMap`, not a bare module-level `let`): a session is rebuilt on map,
 * traffic-side, steering-side or scenario-id changes, each rebuild gets a
 * fresh `Scene`, and a bare `let` would keep returning the previous scene's
 * (by then disposed) mesh — confirmed empirically, a second London mount
 * silently produced posts for neither sign family, half the expected
 * instances, no thrown error. `registerShadowCaster`/`registerDestructibleProp`
 * are threaded as ctx callbacks (shared class-wide); `staticSceneryFreeze`
 * passes through ctx as a live array reference. `makeMaterial`/
 * `setMeshMaterial`/`textureContext` are duplicated or imported per the same
 * house convention every prior commit has used.
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

const signPostMasterCache = new WeakMap<Scene, Mesh>();

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The three materials every London landmark dresses itself with — pale trim,
 * dark glazing, dark roof. They were made per landmark, with the id baked
 * into the name and the *same three colours* every time: fine at five
 * landmarks, and 60 redundant `StandardMaterial`s once the map had twenty.
 * Materials are GPU state changes, so this is a draw-call saving as much as a
 * memory one.
 *
 * Keyed by `Scene` for the same reason `signPostMasterCache` is: a session
 * rebuild gets a fresh scene, and a module-level `let` would hand the second
 * mount the first one's disposed materials.
 */
interface LondonLandmarkPalette {
  readonly trim: StandardMaterial;
  readonly windows: StandardMaterial;
  readonly roof: StandardMaterial;
}
const landmarkPaletteCache = new WeakMap<Scene, LondonLandmarkPalette>();

function landmarkPalette(scene: Scene): LondonLandmarkPalette {
  const cached = landmarkPaletteCache.get(scene);
  if (cached) return cached;
  const palette: LondonLandmarkPalette = {
    trim: makeMaterial(
      scene,
      "london-landmark-trim",
      new Color3(0.82, 0.76, 0.65),
    ),
    // These panels are verified glazing on the museums, palace and department
    // store, not a broad facade slab. A restrained incandescent glow makes the
    // civic street wall feel occupied while leaving its pale masonry ordinary.
    windows: makeMaterial(
      scene,
      "london-landmark-windows",
      new Color3(0.12, 0.2, 0.23),
      new Color3(0.34, 0.25, 0.13),
    ),
    roof: makeMaterial(
      scene,
      "london-landmark-roof",
      new Color3(0.25, 0.22, 0.2),
    ),
  };
  landmarkPaletteCache.set(scene, palette);
  return palette;
}

export interface LondonLandmarksCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly registerShadowCaster: (
    mesh: AbstractMesh,
    x: number,
    z: number,
  ) => void;
  readonly registerDestructibleProp: (
    kind: string,
    x: number,
    z: number,
    scale: number,
    parts: readonly DestructiblePropPart[],
    elevationM?: number,
  ) => void;
}

/**
 * Gives the South Kensington miniature a readable silhouette without using
 * imagery, branding, or detailed replicas of the real museum buildings.
 */
/** Deck-edge parapet, between the footway and the river. */
const BRIDGE_PARAPET_HEIGHT_M = 1;
/** Kerbside guardrail, between the carriageway and the footway. */
const BRIDGE_GUARDRAIL_HEIGHT_M = 0.5;
const BRIDGE_LAMP_SPACING_M = 24;
const BRIDGE_DECK_LEVEL_M = 0.65;

/**
 * A drivable Thames bridge's deck dressing: the parapet the driver actually
 * hits, a kerbside guardrail, and a lamp line along both footways.
 *
 * Two invariants, both learned the hard way on NYC's pair:
 *
 * - **The parapet is drawn on the same line as the `-portal-` collider
 *   `simulationAdapter` emits**, which resolves the deck's footway through
 *   `sidewalkWidthM`. Every London bridge authors that field explicitly; a
 *   silent fallback on one side of the two is what put a visible rail 3.4 m
 *   inboard of the wall the car hits.
 * - **The guardrail is visual only.** There is no collider at the kerb and
 *   never was, so the deck stays exactly as drivable as the carriageway
 *   either side of it.
 *
 * Each bridge's own character — Albert's cable stays, Westminster's arches,
 * the Tower's stone towers and high walkways — is built on top of this by the
 * caller.
 */
function buildLondonBridgeDeck(
  ctx: LondonLandmarksCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  mapPack: GameCanvasMapPack,
): {
  readonly root: TransformNode;
  readonly axis: ReturnType<typeof cairoBridgePortalVisualAxis>;
  readonly carriagewayWidthM: number;
  readonly steel: StandardMaterial;
} {
  const scene = ctx.scene;
  const roadSurfaces = mapPack.geometry.roadSurfaces ?? [];
  const axis = cairoBridgePortalVisualAxis(
    landmark,
    roadSurfaces,
    mapPack.geometry.waterBodies ?? [],
    defaultSidewalkWidthM(mapPack),
  );
  const length = axis.lengthM;
  const width = axis.widthM;
  const carriagewayWidthM =
    roadSurfaces.find((surface) => surface.id === landmark.id)?.widthM ?? width;
  const root = new TransformNode(`${landmark.id}-axis`, scene);
  root.position.set(axis.center.x, 0, axis.center.z);
  root.rotation.y = axis.boxYawRad;
  ctx.staticSceneryFreeze.push(root);

  const steel = makeMaterial(
    scene,
    `${landmark.id}-steel`,
    Color3.FromHexString(landmark.color),
  );
  const parapetStone = makeMaterial(
    scene,
    `${landmark.id}-parapet-stone`,
    new Color3(0.53, 0.51, 0.47),
  );
  const lampGlow = makeMaterial(
    scene,
    `${landmark.id}-lamp`,
    new Color3(0.09, 0.09, 0.08),
    new Color3(0.95, 0.86, 0.6),
  );

  for (const side of [-1, 1] as const) {
    const parapet = createBox(
      scene,
      `${landmark.id}-parapet-${side}`,
      { width: length, height: BRIDGE_PARAPET_HEIGHT_M, depth: 0.24 },
      new Vector3(0, BRIDGE_PARAPET_HEIGHT_M / 2, (side * width) / 2),
      parapetStone,
      root,
    );
    parapet.isPickable = false;
    ctx.staticSceneryFreeze.push(parapet);
    const guardrail = createBox(
      scene,
      `${landmark.id}-guardrail-${side}`,
      { width: length, height: BRIDGE_GUARDRAIL_HEIGHT_M, depth: 0.16 },
      new Vector3(
        0,
        BRIDGE_GUARDRAIL_HEIGHT_M / 2,
        side * (carriagewayWidthM / 2 + 0.3),
      ),
      steel,
      root,
    );
    guardrail.isPickable = false;
    ctx.staticSceneryFreeze.push(guardrail);
  }

  const lampCount = Math.max(2, Math.round(length / BRIDGE_LAMP_SPACING_M));
  for (let index = 0; index <= lampCount; index += 1) {
    const alongM = -length / 2 + (index / lampCount) * length;
    for (const side of [-1, 1] as const) {
      const lateralM = side * (width / 2 - 1.2);
      const pole = createCylinder(
        scene,
        `${landmark.id}-lamp-pole-${index}-${side}`,
        { height: 3.4, diameter: 0.14, tessellation: 6 },
        new Vector3(alongM, BRIDGE_DECK_LEVEL_M + 1.7, lateralM),
        steel,
        root,
      );
      pole.isPickable = false;
      ctx.staticSceneryFreeze.push(pole);
      const head = createBox(
        scene,
        `${landmark.id}-lamp-head-${index}-${side}`,
        { width: 0.36, height: 0.4, depth: 0.36 },
        new Vector3(alongM, BRIDGE_DECK_LEVEL_M + 3.5, lateralM),
        lampGlow,
        root,
      );
      head.isPickable = false;
      ctx.staticSceneryFreeze.push(head);
    }
  }

  return { root, axis, carriagewayWidthM, steel };
}

export function buildLondonLandmark(
  ctx: LondonLandmarksCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  material: StandardMaterial,
  mapPack: GameCanvasMapPack,
): boolean {
  const scene = ctx.scene;

  if (landmark.kind === "bridge") {
    const deck = buildLondonBridgeDeck(ctx, landmark, mapPack);
    if (landmark.id === "london-tower-bridge") {
      // Two stone towers a third of the way in from each bank, joined by a
      // high walkway — the one bridge silhouette on the map that is
      // recognisable from the other side of the city.
      const stone = makeMaterial(
        scene,
        `${landmark.id}-tower-stone`,
        new Color3(0.7, 0.66, 0.55),
      );
      const towerHeight = 44;
      const half = deck.axis.widthM / 2;
      for (const [index, fraction] of ([0.28, 0.72] as const).entries()) {
        const alongM = (fraction - 0.5) * deck.axis.lengthM;
        for (const side of [-1, 1] as const) {
          const lateralM = side * (half + 2.6);
          const pier = createBox(
            scene,
            `${landmark.id}-tower-${index}-${side}`,
            { width: 7.4, height: towerHeight, depth: 7.4 },
            new Vector3(alongM, towerHeight / 2, lateralM),
            stone,
            deck.root,
          );
          pier.isPickable = false;
          const cap = createBox(
            scene,
            `${landmark.id}-tower-cap-${index}-${side}`,
            { width: 8.6, height: 2, depth: 8.6 },
            new Vector3(alongM, towerHeight + 1, lateralM),
            stone,
            deck.root,
          );
          cap.isPickable = false;
          const spire = createCylinder(
            scene,
            `${landmark.id}-tower-spire-${index}-${side}`,
            {
              height: 9,
              diameterBottom: 6.4,
              diameterTop: 0.5,
              tessellation: 4,
            },
            new Vector3(alongM, towerHeight + 6.5, lateralM),
            deck.steel,
            deck.root,
          );
          spire.isPickable = false;
        }
        // The cross-piece joining each pair of piers over the roadway.
        const brace = createBox(
          scene,
          `${landmark.id}-tower-brace-${index}`,
          { width: 6.6, height: 3, depth: half * 2 + 8 },
          new Vector3(alongM, towerHeight - 6, 0),
          stone,
          deck.root,
        );
        brace.isPickable = false;
      }
      // The two high walkways between the towers.
      for (const [index, y] of (
        [towerHeight - 12, towerHeight - 4] as const
      ).entries()) {
        const walkway = createBox(
          scene,
          `${landmark.id}-walkway-${index}`,
          { width: deck.axis.lengthM * 0.44, height: 1.1, depth: 5.6 },
          new Vector3(0, y, 0),
          deck.steel,
          deck.root,
        );
        walkway.isPickable = false;
      }
    }
    return true;
  }

  const { trim, windows, roof } = landmarkPalette(scene);

  if (landmark.id === "london-natural-history-museum") {
    const height = 12;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-parapet`,
      {
        width: landmark.size.x + 1.2,
        height: 1.05,
        depth: landmark.size.z + 1.2,
      },
      new Vector3(landmark.center.x, height + 0.4, landmark.center.z),
      trim,
    );
    for (let column = -3; column <= 3; column += 1) {
      const x = landmark.center.x + column * (landmark.size.x / 8);
      createBox(
        scene,
        `${landmark.id}-pilaster-${column}`,
        { width: 1.2, height: 9.5, depth: 0.65 },
        new Vector3(x, 5.4, landmark.center.z - landmark.size.z / 2 - 0.35),
        trim,
      );
      if (column !== 0) {
        createBox(
          scene,
          `${landmark.id}-window-${column}`,
          { width: 3.4, height: 2.7, depth: 0.18 },
          new Vector3(
            x + landmark.size.x / 16,
            6.4,
            landmark.center.z - landmark.size.z / 2 - 0.7,
          ),
          windows,
        );
      }
    }
    createBox(
      scene,
      `${landmark.id}-entrance`,
      { width: 7.5, height: 6.2, depth: 0.85 },
      new Vector3(
        landmark.center.x,
        3.1,
        landmark.center.z - landmark.size.z / 2 - 0.5,
      ),
      roof,
    );
    return true;
  }

  if (landmark.id === "london-natural-history-tower") {
    const height = 24;
    createBox(
      scene,
      landmark.id,
      { width: 11, height, depth: 11 },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-clock-band`,
      { width: 12.4, height: 2.2, depth: 12.4 },
      new Vector3(landmark.center.x, 19, landmark.center.z),
      trim,
    );
    createCylinder(
      scene,
      `${landmark.id}-roof`,
      { height: 7, diameterTop: 0.8, diameterBottom: 13.5, tessellation: 4 },
      new Vector3(landmark.center.x, height + 3.5, landmark.center.z),
      roof,
    ).rotation.y = Math.PI / 4;
    return true;
  }

  if (
    landmark.id === "london-science-museum" ||
    landmark.id === "london-victoria-and-albert-museum"
  ) {
    const isVictoriaAndAlbert = landmark.id.includes("victoria");
    const height = isVictoriaAndAlbert ? 13 : 10;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-roofline`,
      {
        width: landmark.size.x + 0.8,
        height: 1.1,
        depth: landmark.size.z + 0.8,
      },
      new Vector3(landmark.center.x, height + 0.45, landmark.center.z),
      trim,
    );
    for (let bay = -3; bay <= 3; bay += 1) {
      const x = landmark.center.x + bay * (landmark.size.x / 8);
      createBox(
        scene,
        `${landmark.id}-bay-${bay}`,
        {
          width: isVictoriaAndAlbert ? 2.2 : 4.2,
          height: isVictoriaAndAlbert ? 6.5 : 3.1,
          depth: 0.2,
        },
        new Vector3(
          x,
          isVictoriaAndAlbert ? 6.1 : 5.3,
          landmark.center.z - landmark.size.z / 2 - 0.12,
        ),
        windows,
      );
    }
    return true;
  }

  // Generic brick tube-station front. Deliberately no roundel and no
  // "Underground" wordmark: those are protected marks, and a plain brick
  // front with a name board reads as a station perfectly well.
  if (
    landmark.kind === "station" &&
    landmark.id !== "london-south-kensington-station"
  ) {
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height: 5.6, depth: landmark.size.z },
      new Vector3(landmark.center.x, 2.8, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-awning`,
      { width: landmark.size.x + 2, height: 0.35, depth: 2.6 },
      new Vector3(
        landmark.center.x,
        3.2,
        landmark.center.z - landmark.size.z / 2 - 1.1,
      ),
      roof,
    );
    createBox(
      scene,
      `${landmark.id}-name-board`,
      { width: landmark.size.x * 0.62, height: 1.1, depth: 0.2 },
      new Vector3(
        landmark.center.x,
        4.4,
        landmark.center.z - landmark.size.z / 2 - 0.14,
      ),
      trim,
    );
    return true;
  }

  // Elizabeth-Tower-ish: a tapering stone shaft, a belfry with four clock
  // faces, and a pyramidal spire. The hands are frozen at 08:30 because that
  // is the scenario clock — a tower whose clock disagrees with the sky is the
  // one detail everybody notices.
  if (landmark.id === "london-clock-tower") {
    const stone = makeMaterial(
      scene,
      `${landmark.id}-stone`,
      new Color3(0.72, 0.67, 0.55),
    );
    const clockFace = makeMaterial(
      scene,
      `${landmark.id}-face`,
      new Color3(0.93, 0.9, 0.8),
      new Color3(0.32, 0.29, 0.2),
    );
    const hand = makeMaterial(
      scene,
      `${landmark.id}-hand`,
      new Color3(0.14, 0.13, 0.11),
    );
    const shaftHeight = 66;
    const width = landmark.size.x;
    createBox(
      scene,
      landmark.id,
      { width, height: shaftHeight, depth: landmark.size.z },
      new Vector3(landmark.center.x, shaftHeight / 2, landmark.center.z),
      stone,
    );
    for (let band = 1; band <= 5; band += 1) {
      createBox(
        scene,
        `${landmark.id}-band-${band}`,
        { width: width + 0.7, height: 0.7, depth: landmark.size.z + 0.7 },
        new Vector3(
          landmark.center.x,
          (shaftHeight / 6) * band,
          landmark.center.z,
        ),
        trim,
      );
    }
    const belfry = shaftHeight + 6;
    createBox(
      scene,
      `${landmark.id}-belfry`,
      { width: width + 1.6, height: 12, depth: landmark.size.z + 1.6 },
      new Vector3(landmark.center.x, shaftHeight + 6, landmark.center.z),
      stone,
    );
    // 08:30: the minute hand straight down, the hour hand a quarter past
    // eight — the same clock the HUD is showing.
    const HOUR_HAND_RAD = ((8 + 30 / 60) / 12) * Math.PI * 2;
    const MINUTE_HAND_RAD = (30 / 60) * Math.PI * 2;
    for (const [index, [dx, dz, yaw]] of (
      [
        [0, -1, 0],
        [0, 1, Math.PI],
        [-1, 0, -Math.PI / 2],
        [1, 0, Math.PI / 2],
      ] as const
    ).entries()) {
      const faceX = landmark.center.x + dx * (width / 2 + 0.9);
      const faceZ = landmark.center.z + dz * (landmark.size.z / 2 + 0.9);
      const face = createCylinder(
        scene,
        `${landmark.id}-clock-${index}`,
        { height: 0.25, diameter: 6.4, tessellation: 16 },
        new Vector3(faceX, belfry, faceZ),
        clockFace,
      );
      face.rotation.x = Math.PI / 2;
      face.rotation.y = yaw;
      for (const [handIndex, [angle, length]] of (
        [
          [HOUR_HAND_RAD, 1.9],
          [MINUTE_HAND_RAD, 2.7],
        ] as const
      ).entries()) {
        const arm = createBox(
          scene,
          `${landmark.id}-clock-${index}-hand-${handIndex}`,
          { width: 0.22, height: length, depth: 0.1 },
          new Vector3(0, length / 2, 0.2),
          hand,
          face,
        );
        arm.rotation.z = angle;
        arm.position.x = -Math.sin(angle) * (length / 2);
        arm.position.y = Math.cos(angle) * (length / 2);
        arm.isPickable = false;
      }
      ctx.staticSceneryFreeze.push(face);
    }
    for (const [index, [step, size]] of (
      [
        [0, 1],
        [1, 0.72],
        [2, 0.44],
        [3, 0.18],
      ] as const
    ).entries()) {
      createBox(
        scene,
        `${landmark.id}-spire-${index}`,
        {
          width: (width + 2) * size,
          height: 5,
          depth: (landmark.size.z + 2) * size,
        },
        new Vector3(
          landmark.center.x,
          belfry + 8 + step * 5,
          landmark.center.z,
        ),
        roof,
      );
    }
    return true;
  }

  // A 90 m observation wheel, standing in the plane of the river bank.
  // **Static on purpose**: a slow-turning wheel forfeits `freezeWorldMatrix`
  // on every one of its ~90 meshes, and the map cannot afford that for an
  // animation nobody watches at driving speed.
  if (landmark.id === "london-eye-wheel") {
    // London Eye's white/cool architectural outline is its night silhouette.
    // One shared emissive steel material lights rim, spokes and supports with
    // no extra geometry, animation or point lights.
    const steel = makeMaterial(
      scene,
      `${landmark.id}-steel`,
      new Color3(0.68, 0.72, 0.76),
      new Color3(0.42, 0.5, 0.62),
    );
    const pod = makeMaterial(
      scene,
      `${landmark.id}-pod`,
      new Color3(0.55, 0.68, 0.74),
      new Color3(0.1, 0.13, 0.15),
    );
    const radius = landmark.size.x / 2;
    const hubY = radius + 8;
    const root = new TransformNode(`${landmark.id}-root`, scene);
    root.position.set(landmark.center.x, 0, landmark.center.z);
    ctx.staticSceneryFreeze.push(root);
    for (const [index, angleDeg] of Array.from(
      { length: 36 },
      (_, i) => i * 10,
    ).entries()) {
      const angle = (angleDeg * Math.PI) / 180;
      const next = ((angleDeg + 10) * Math.PI) / 180;
      const ax = Math.cos(angle) * radius;
      const ay = Math.sin(angle) * radius;
      const bx = Math.cos(next) * radius;
      const by = Math.sin(next) * radius;
      const rim = createBox(
        scene,
        `${landmark.id}-rim-${index}`,
        { width: Math.hypot(bx - ax, by - ay) + 0.4, height: 0.8, depth: 0.8 },
        new Vector3((ax + bx) / 2, hubY + (ay + by) / 2, 0),
        steel,
        root,
      );
      rim.rotation.z = Math.atan2(by - ay, bx - ax);
      rim.isPickable = false;
      const capsule = createBox(
        scene,
        `${landmark.id}-pod-${index}`,
        { width: 2.6, height: 1.9, depth: 2.2 },
        new Vector3(ax * 1.05, hubY + ay * 1.05, 0),
        pod,
        root,
      );
      capsule.isPickable = false;
      if (index % 3 === 0) {
        const spoke = createBox(
          scene,
          `${landmark.id}-spoke-${index}`,
          { width: radius, height: 0.3, depth: 0.3 },
          new Vector3(ax / 2, hubY + ay / 2, 0),
          steel,
          root,
        );
        spoke.rotation.z = angle;
        spoke.isPickable = false;
      }
    }
    createCylinder(
      scene,
      `${landmark.id}-hub`,
      { height: 3.4, diameter: 4.2, tessellation: 12 },
      new Vector3(0, hubY, 0),
      steel,
      root,
    ).rotation.x = Math.PI / 2;
    for (const side of [-1, 1] as const) {
      const leg = createBox(
        scene,
        `${landmark.id}-leg-${side}`,
        { width: 1.6, height: hubY + 4, depth: 1.6 },
        new Vector3(side * 9, (hubY + 4) / 2, side * 5),
        steel,
        root,
      );
      leg.rotation.z = (-side * 12 * Math.PI) / 180;
      leg.isPickable = false;
    }
    return true;
  }

  // Battersea-ish: a brick box with four white chimneys.
  if (landmark.id === "london-power-station") {
    const chimney = makeMaterial(
      scene,
      `${landmark.id}-chimney`,
      new Color3(0.86, 0.85, 0.8),
    );
    const height = 26;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    for (const [index, [dx, dz]] of (
      [
        [-0.38, -0.34],
        [0.38, -0.34],
        [-0.38, 0.34],
        [0.38, 0.34],
      ] as const
    ).entries()) {
      createCylinder(
        scene,
        `${landmark.id}-chimney-${index}`,
        { height: 34, diameterTop: 4.6, diameterBottom: 5.6, tessellation: 12 },
        new Vector3(
          landmark.center.x + dx * landmark.size.x,
          height + 17,
          landmark.center.z + dz * landmark.size.z,
        ),
        chimney,
      );
    }
    return true;
  }

  // Royal-Albert-Hall-ish: an elliptical drum, a shallow dome and a frieze.
  if (landmark.id === "london-round-hall") {
    const drumHeight = 22;
    const drum = createCylinder(
      scene,
      landmark.id,
      { height: drumHeight, diameter: landmark.size.x, tessellation: 24 },
      new Vector3(landmark.center.x, drumHeight / 2, landmark.center.z),
      material,
    );
    drum.scaling.z = landmark.size.z / landmark.size.x;
    createCylinder(
      scene,
      `${landmark.id}-frieze`,
      { height: 2.4, diameter: landmark.size.x + 1.2, tessellation: 24 },
      new Vector3(landmark.center.x, drumHeight - 2.6, landmark.center.z),
      trim,
    ).scaling.z = landmark.size.z / landmark.size.x;
    const dome = createCylinder(
      scene,
      `${landmark.id}-dome`,
      {
        height: 7.5,
        diameterTop: landmark.size.x * 0.32,
        diameterBottom: landmark.size.x * 0.96,
        tessellation: 24,
      },
      new Vector3(landmark.center.x, drumHeight + 3.6, landmark.center.z),
      roof,
    );
    dome.scaling.z = landmark.size.z / landmark.size.x;
    return true;
  }

  // The Gherkin: a lathe-ish tower of stacked, tapering glass drums.
  if (landmark.id === "london-glass-gherkin") {
    const glass = makeMaterial(
      scene,
      `${landmark.id}-glass`,
      new Color3(0.32, 0.45, 0.5),
      new Color3(0.14, 0.22, 0.28),
    );
    const bands = 12;
    const height = 132;
    let y = 0;
    for (let band = 0; band < bands; band += 1) {
      // Widest a third of the way up, tapering to a nose — a pickle, not a
      // cone, and the profile is the whole reason it is worth building.
      const profile = (t: number) =>
        Math.sin(Math.PI * (0.12 + t * 0.82)) ** 0.7;
      const lower = profile(band / bands);
      const upper = profile((band + 1) / bands);
      const bandHeight = height / bands;
      createCylinder(
        scene,
        `${landmark.id}-band-${band}`,
        {
          height: bandHeight,
          diameterBottom: landmark.size.x * lower,
          diameterTop: landmark.size.x * upper,
          tessellation: 16,
        },
        new Vector3(landmark.center.x, y + bandHeight / 2, landmark.center.z),
        band % 2 === 0 ? glass : material,
      );
      y += bandHeight;
    }
    return true;
  }

  // The Shard: four glass shards leaning to a common point. Tallest thing on
  // the map by a long way, which is what makes the south bank read from the
  // north side of the river.
  if (landmark.id === "london-shard-spire") {
    const glass = makeMaterial(
      scene,
      `${landmark.id}-glass`,
      new Color3(0.55, 0.66, 0.72),
      new Color3(0.18, 0.25, 0.32),
    );
    const height = 190;
    const sections = 8;
    for (let section = 0; section < sections; section += 1) {
      const lower = 1 - section / sections;
      const upper = 1 - (section + 1) / sections;
      const sectionHeight = height / sections;
      createCylinder(
        scene,
        `${landmark.id}-section-${section}`,
        {
          height: sectionHeight,
          diameterBottom: landmark.size.x * lower,
          diameterTop: landmark.size.x * upper * 0.92,
          tessellation: 4,
        },
        new Vector3(
          landmark.center.x,
          section * sectionHeight + sectionHeight / 2,
          landmark.center.z,
        ),
        glass,
      ).rotation.y = Math.PI / 4;
    }
    return true;
  }

  // A classical palace front with a forecourt railing, behind Victoria Circus.
  if (landmark.id === "london-palace") {
    const height = 21;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-parapet`,
      {
        width: landmark.size.x + 1.4,
        height: 1.5,
        depth: landmark.size.z + 1.4,
      },
      new Vector3(landmark.center.x, height + 0.6, landmark.center.z),
      trim,
    );
    createBox(
      scene,
      `${landmark.id}-pediment`,
      {
        width: landmark.size.x * 0.26,
        height: 4.5,
        depth: landmark.size.z + 2.2,
      },
      new Vector3(landmark.center.x, height + 2.4, landmark.center.z),
      trim,
    );
    for (let column = -6; column <= 6; column += 1) {
      createCylinder(
        scene,
        `${landmark.id}-column-${column}`,
        { height: height - 3, diameter: 1.7, tessellation: 10 },
        new Vector3(
          landmark.center.x + column * (landmark.size.x / 14),
          (height - 3) / 2,
          landmark.center.z - landmark.size.z / 2 - 1,
        ),
        trim,
      );
    }
    for (let post = -8; post <= 8; post += 1) {
      createBox(
        scene,
        `${landmark.id}-railing-${post}`,
        { width: 0.18, height: 2.6, depth: 0.18 },
        new Vector3(
          landmark.center.x + post * (landmark.size.x / 17),
          1.3,
          landmark.center.z - landmark.size.z / 2 - 12,
        ),
        roof,
      );
    }
    return true;
  }

  // A terracotta department store: awnings the whole length of the frontage.
  if (landmark.id === "london-department-store") {
    const height = 28;
    const awning = makeMaterial(
      scene,
      `${landmark.id}-awning`,
      new Color3(0.16, 0.22, 0.19),
    );
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-cornice`,
      {
        width: landmark.size.x + 1.6,
        height: 1.8,
        depth: landmark.size.z + 1.6,
      },
      new Vector3(landmark.center.x, height + 0.7, landmark.center.z),
      trim,
    );
    for (let dome = -2; dome <= 2; dome += 1) {
      createCylinder(
        scene,
        `${landmark.id}-dome-${dome}`,
        { height: 6, diameterTop: 0.6, diameterBottom: 5, tessellation: 12 },
        new Vector3(
          landmark.center.x + dome * (landmark.size.x / 5.5),
          height + 4.5,
          landmark.center.z,
        ),
        roof,
      );
    }
    for (let bay = -4; bay <= 4; bay += 1) {
      createBox(
        scene,
        `${landmark.id}-awning-${bay}`,
        { width: landmark.size.x / 11, height: 0.3, depth: 3.2 },
        new Vector3(
          landmark.center.x + bay * (landmark.size.x / 10),
          5.2,
          landmark.center.z + landmark.size.z / 2 + 1.4,
        ),
        awning,
      );
      createBox(
        scene,
        `${landmark.id}-window-${bay}`,
        { width: landmark.size.x / 12, height: 3.6, depth: 0.2 },
        new Vector3(
          landmark.center.x + bay * (landmark.size.x / 10),
          2.6,
          landmark.center.z + landmark.size.z / 2 + 0.12,
        ),
        windows,
      );
    }
    return true;
  }

  // A fluted Monument column with a gilded urn.
  if (landmark.id === "london-monument-column") {
    const gilt = makeMaterial(
      scene,
      `${landmark.id}-gilt`,
      new Color3(0.72, 0.58, 0.24),
      new Color3(0.24, 0.18, 0.05),
    );
    createBox(
      scene,
      `${landmark.id}-plinth`,
      { width: landmark.size.x, height: 8, depth: landmark.size.z },
      new Vector3(landmark.center.x, 4, landmark.center.z),
      material,
    );
    createCylinder(
      scene,
      landmark.id,
      { height: 44, diameterBottom: 5, diameterTop: 4.2, tessellation: 16 },
      new Vector3(landmark.center.x, 30, landmark.center.z),
      trim,
    );
    createCylinder(
      scene,
      `${landmark.id}-capital`,
      { height: 3, diameterBottom: 4.6, diameterTop: 6.2, tessellation: 16 },
      new Vector3(landmark.center.x, 53.5, landmark.center.z),
      trim,
    );
    createCylinder(
      scene,
      `${landmark.id}-urn`,
      { height: 6, diameterBottom: 3.4, diameterTop: 0.8, tessellation: 12 },
      new Vector3(landmark.center.x, 58, landmark.center.z),
      gilt,
    );
    return true;
  }

  if (landmark.id === "london-south-kensington-station") {
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height: 5.4, depth: landmark.size.z },
      new Vector3(landmark.center.x, 2.7, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-awning`,
      { width: landmark.size.x + 2, height: 0.35, depth: 2.8 },
      new Vector3(
        landmark.center.x,
        3.1,
        landmark.center.z - landmark.size.z / 2 - 1.2,
      ),
      roof,
    );
    createBox(
      scene,
      `${landmark.id}-name-board`,
      { width: 9, height: 1.1, depth: 0.2 },
      new Vector3(
        landmark.center.x,
        4.25,
        landmark.center.z - landmark.size.z / 2 - 0.14,
      ),
      trim,
    );
    return true;
  }

  if (landmark.id === "london-exhibition-road-public-space") {
    const paving = makeMaterial(
      scene,
      `${landmark.id}-paving`,
      new Color3(0.54, 0.54, 0.5),
    );
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height: 0.14, depth: landmark.size.z },
      new Vector3(landmark.center.x, 0.14, landmark.center.z),
      paving,
    );
    for (const zOffset of [-18, -6, 6, 18]) {
      createBox(
        scene,
        `${landmark.id}-paving-band-${zOffset}`,
        { width: landmark.size.x, height: 0.025, depth: 0.35 },
        new Vector3(landmark.center.x, 0.23, landmark.center.z + zOffset),
        trim,
      );
    }
    return true;
  }

  return false;
}

/**
 * Regulatory signage for one-way roads: ONE WAY blades at enterable mouths,
 * DO NOT ENTER pairs at forbidden mouths, WRONG WAY repeaters down each
 * block (placements derived in regulatorySigns.ts). Each placement becomes
 * a post plus a textured blade. Faces are drawn on DynamicTextures — MUTCD
 * sign designs are US-government public domain — with the message on the
 * box's -Z face, the one Babylon renders upright (+Z comes out rotated
 * 180deg; see computePlatePlacements), and every remaining face mapped to a
 * flat aluminum patch of the same texture. A DO NOT ENTER / WRONG WAY face
 * therefore only reads against the flow: legal traffic sees a gray back.
 */
export function buildRegulatorySigns(
  ctx: LondonLandmarksCtx,
  placements: readonly RegulatorySignPlacement[],
) {
  const scene = ctx.scene;
  const aluminum = "#9aa0a3";
  const white = "#f4f6f6";
  const signRed = "#a6141c";
  // Bottom half of every canvas stays solid gray; gray faces sample a small
  // centred rect of it so mipmap bleed from the designs can never reach in.
  const GRAY_UV = new Vector4(0.4, 0.1, 0.6, 0.3);
  const faceTexture = (
    name: string,
    width: number,
    height: number,
    draw: (context: CanvasRenderingContext2D) => void,
  ): DynamicTexture => {
    const texture = new DynamicTexture(name, { width, height }, scene, true);
    const context = textureContext(texture);
    context.fillStyle = aluminum;
    context.fillRect(0, 0, width, height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    draw(context);
    texture.update();
    return texture;
  };
  const faceMaterial = (
    name: string,
    texture: DynamicTexture,
  ): StandardMaterial => {
    const material = new StandardMaterial(name, scene);
    material.diffuseTexture = texture;
    // Plate recipe: self-illuminated for night legibility, but held below
    // the night bloom threshold so signs read without glowing.
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(0.3, 0.3, 0.3);
    material.specularColor = new Color3(0.12, 0.12, 0.12);
    material.specularPower = 48;
    return material;
  };
  // R6-1 blade cell (512x256 at x0): black field, white border, white arrow
  // through the middle with "ONE WAY" set into the shaft.
  const drawOneWayCell = (
    context: CanvasRenderingContext2D,
    x0: number,
    pointLeft: boolean,
  ) => {
    context.fillStyle = "#101214";
    context.fillRect(x0, 0, 512, 256);
    context.strokeStyle = white;
    context.lineWidth = 8;
    context.strokeRect(x0 + 12, 12, 488, 232);
    context.fillStyle = white;
    const middle = 128;
    const headX = pointLeft ? x0 + 44 : x0 + 468;
    const neckX = pointLeft ? x0 + 150 : x0 + 362;
    const tailX = pointLeft ? x0 + 468 : x0 + 44;
    context.beginPath();
    context.moveTo(headX, middle);
    context.lineTo(neckX, middle - 92);
    context.lineTo(neckX, middle - 44);
    context.lineTo(tailX, middle - 44);
    context.lineTo(tailX, middle + 44);
    context.lineTo(neckX, middle + 44);
    context.lineTo(neckX, middle + 92);
    context.closePath();
    context.fill();
    context.fillStyle = "#101214";
    context.font = "bold 54px Arial, sans-serif";
    context.fillText("ONE WAY", x0 + 256 + (pointLeft ? 34 : -34), middle + 2);
  };
  const oneWayTexture = faceTexture("regsign-oneway", 1024, 512, (context) => {
    drawOneWayCell(context, 0, true);
    drawOneWayCell(context, 512, false);
  });
  // R5-1: white square, red disc, white bar, DO NOT / ENTER around it.
  const dneTexture = faceTexture("regsign-dne", 512, 1024, (context) => {
    context.fillStyle = white;
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = signRed;
    context.beginPath();
    context.arc(256, 256, 232, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = white;
    context.fillRect(72, 232, 368, 48);
    context.font = "bold 64px Arial, sans-serif";
    context.fillText("DO NOT", 256, 152);
    context.fillText("ENTER", 256, 366);
  });
  // R5-1a: red panel, white border, WRONG WAY.
  const wrongWayTexture = faceTexture(
    "regsign-wrongway",
    512,
    512,
    (context) => {
      context.fillStyle = signRed;
      context.fillRect(0, 0, 512, 256);
      context.strokeStyle = white;
      context.lineWidth = 8;
      context.strokeRect(10, 10, 492, 236);
      context.fillStyle = white;
      context.font = "bold 68px Arial, sans-serif";
      context.fillText("WRONG WAY", 256, 130);
    },
  );
  const materials = {
    one_way: faceMaterial("regsign-oneway", oneWayTexture),
    do_not_enter: faceMaterial("regsign-dne", dneTexture),
    wrong_way: faceMaterial("regsign-wrongway", wrongWayTexture),
  };
  const blade = (
    name: string,
    width: number,
    height: number,
    material: StandardMaterial,
    minusZ: Vector4,
    plusZ: Vector4,
  ): Mesh => {
    // Babylon box faces: 0 = +Z (renders a faceUV region rotated 180deg),
    // 1 = -Z (renders it upright) — pass the +Z region pre-swapped.
    const faceUV = [plusZ, minusZ, GRAY_UV, GRAY_UV, GRAY_UV, GRAY_UV];
    const mesh = MeshBuilder.CreateBox(
      `prop-master-${name}`,
      { width, height, depth: 0.045, faceUV },
      scene,
    );
    setMeshMaterial(mesh, material);
    mesh.isVisible = false;
    return mesh;
  };
  const swapped = (region: Vector4): Vector4 =>
    new Vector4(region.z, region.w, region.x, region.y);
  const post = signPostMaster(ctx);
  const blades: Record<RegulatorySignKind, Mesh> = {
    // Double-faced: left-arrow cell reads on -Z, right-arrow cell on +Z, so
    // cross traffic on either side sees the arrow pointing along the flow.
    one_way: blade(
      "regsign-oneway",
      0.9,
      0.3,
      materials.one_way,
      new Vector4(0, 0.5, 0.5, 1),
      swapped(new Vector4(0.5, 0.5, 1, 1)),
    ),
    do_not_enter: blade(
      "regsign-dne",
      0.75,
      0.75,
      materials.do_not_enter,
      new Vector4(0, 0.5, 1, 1),
      GRAY_UV,
    ),
    wrong_way: blade(
      "regsign-wrongway",
      0.9,
      0.6,
      materials.wrong_way,
      new Vector4(0, 0.5, 1, 1),
      GRAY_UV,
    ),
  };
  const bladeOffsets: Record<RegulatorySignKind, Vector3> = {
    one_way: new Vector3(0, 2.75, 0),
    do_not_enter: new Vector3(0, 2.2, -0.08),
    wrong_way: new Vector3(0, 2.05, -0.08),
  };
  const kindKeys: Record<RegulatorySignKind, string> = {
    one_way: "oneway-sign",
    do_not_enter: "dne-sign",
    wrong_way: "wrongway-sign",
  };
  const postOffset = new Vector3(0, 1.3, 0);
  let instanceIndex = 0;
  for (const placement of placements) {
    const yaw = regulatorySignYawRad(placement.kind, placement.flowHeadingRad);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const destructibleParts: DestructiblePropPart[] = [];
    for (const part of [
      { master: post, offset: postOffset },
      { master: blades[placement.kind], offset: bladeOffsets[placement.kind] },
    ]) {
      const instance = part.master.createInstance(
        `prop-${kindKeys[placement.kind]}-${instanceIndex}`,
      );
      instanceIndex += 1;
      instance.position.set(
        placement.x + part.offset.x * cos + part.offset.z * sin,
        (placement.elevationM ?? 0) + part.offset.y,
        placement.z - part.offset.x * sin + part.offset.z * cos,
      );
      instance.rotation.y = yaw;
      instance.isPickable = false;
      ctx.staticSceneryFreeze.push(instance);
      ctx.registerShadowCaster(instance, placement.x, placement.z);
      destructibleParts.push({ node: instance, isLightPool: false });
    }
    ctx.registerDestructibleProp(
      kindKeys[placement.kind],
      placement.x,
      placement.z,
      1,
      destructibleParts,
      placement.elevationM ?? 0,
    );
  }
  materials.one_way.freeze();
  materials.do_not_enter.freeze();
  materials.wrong_way.freeze();
}

/**
 * The 2.6 m sign post, shared by both sign families — either may build first
 * or alone, so it is memoised rather than owned by one of them. Sharing it
 * means the second family's posts cost no extra draw call.
 */
function signPostMaster(ctx: LondonLandmarksCtx): Mesh {
  const cached = signPostMasterCache.get(ctx.scene);
  if (cached) return cached;
  const material = makeMaterial(
    ctx.scene,
    "regsign-post",
    new Color3(0.45, 0.47, 0.48),
  );
  const post = MeshBuilder.CreateCylinder(
    "prop-master-regsign-post",
    { height: 2.6, diameter: 0.09, tessellation: 8 },
    ctx.scene,
  );
  setMeshMaterial(post, material);
  post.isVisible = false;
  material.freeze();
  signPostMasterCache.set(ctx.scene, post);
  return post;
}

/**
 * Speed-limit plates, on every map, in the host country's own design.
 *
 * Unlike the one-way family this cannot key its masters off the sign kind:
 * the number is baked into the blade's `faceUV`, so instances of one master
 * can only ever read one figure. One master, texture and material per
 * distinct posted figure instead — at most three on any shipped city, and
 * every instance of a figure batches into a single draw call.
 */
export function buildSpeedLimitSigns(
  ctx: LondonLandmarksCtx,
  placements: readonly SpeedLimitSignPlacement[],
  countryId: string,
) {
  const scene = ctx.scene;
  const vienna = speedLimitSignFamily(countryId) !== "mutcd";
  const white = "#f4f6f6";
  const post = signPostMaster(ctx);
  const materials: StandardMaterial[] = [];
  const bladeFor = (figure: number): Mesh => {
    // The design occupies the top half (Vienna) or top 5/8 (MUTCD) of the
    // canvas; the rest stays the aluminium fill so GRAY_UV keeps sampling a
    // flat patch of this same texture for every other face.
    //
    // As a fraction of canvas height — and canvas y runs down from the top
    // while texture v runs up from the bottom, so the design's lower edge is
    // at v = 1 - designV. Getting this wrong does not fail: it silently
    // samples the wrong band and slices the numeral off the plate.
    const designHeightPx = vienna ? 512 : 640;
    const designV = designHeightPx / 1024;
    const texture = new DynamicTexture(
      `speedsign-${figure}-texture`,
      { width: 512, height: 1024 },
      scene,
      true,
    );
    const context = textureContext(texture);
    context.fillStyle = "#9aa0a3";
    context.fillRect(0, 0, 512, 1024);
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (vienna) {
      // The Vienna Convention disc: white field, red annulus, numeral.
      context.fillStyle = white;
      context.fillRect(0, 0, 512, 512);
      context.fillStyle = "#c1121f";
      context.beginPath();
      context.arc(256, 256, 244, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = white;
      context.beginPath();
      context.arc(256, 256, 186, 0, Math.PI * 2);
      context.fill();
      // Japan is the Vienna signatory that sets its limit numerals in blue
      // rather than black — the one visual tell that you are in Tokyo.
      context.fillStyle = countryId === "jp" ? "#12266e" : "#101214";
      context.font = "bold 232px Arial, sans-serif";
      context.fillText(String(figure), 256, 268);
    } else {
      // MUTCD R2-1: white rectangle, black border, SPEED / LIMIT / figure.
      context.fillStyle = white;
      context.fillRect(0, 0, 512, 640);
      context.strokeStyle = "#101214";
      context.lineWidth = 14;
      context.strokeRect(18, 18, 512 - 36, 640 - 36);
      context.fillStyle = "#101214";
      context.font = "bold 96px Arial, sans-serif";
      context.fillText("SPEED", 256, 118);
      context.fillText("LIMIT", 256, 224);
      context.font = "bold 260px Arial, sans-serif";
      context.fillText(String(figure), 256, 452);
    }
    texture.update();
    const material = new StandardMaterial(`speedsign-${figure}`, scene);
    material.diffuseTexture = texture;
    // The plate recipe: lit enough to read after dark, held under the night
    // bloom threshold so it does not glow.
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(0.3, 0.3, 0.3);
    material.specularColor = new Color3(0.12, 0.12, 0.12);
    material.specularPower = 48;
    materials.push(material);
    const design = new Vector4(0, 1 - designV, 1, 1);
    const gray = new Vector4(0.4, 0.1, 0.6, 0.3);
    let mesh: Mesh;
    if (vienna) {
      // A disc, not a plate with a disc painted on it: the round silhouette
      // is the strongest cue that this is not an American street, and it
      // reads at a distance where the numeral does not. Babylon inscribes a
      // cap's circle into its faceUV rect, so the 512-square design lands
      // 1:1 — [bottom cap, tube, top cap].
      mesh = MeshBuilder.CreateCylinder(
        `prop-master-speedsign-${figure}`,
        {
          height: 0.05,
          diameter: 0.62,
          tessellation: 32,
          faceUV: [gray, gray, design],
        },
        scene,
      );
      // Baked rather than set per instance: an instance carries only the
      // yaw, and this stands the disc up so its face reads like the box's
      // -Z face does.
      mesh.rotation.x = -Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
    } else {
      mesh = MeshBuilder.CreateBox(
        `prop-master-speedsign-${figure}`,
        {
          width: 0.61,
          height: 0.76,
          depth: 0.045,
          // Face 1 is -Z, the one Babylon renders upright.
          faceUV: [gray, design, gray, gray, gray, gray],
        },
        scene,
      );
    }
    setMeshMaterial(mesh, material);
    mesh.isVisible = false;
    return mesh;
  };
  const blades = new Map<number, Mesh>();
  for (const figure of new Set(placements.map((p) => p.limitFigure))) {
    blades.set(figure, bladeFor(figure));
  }
  const bladeOffset = new Vector3(0, vienna ? 2.2 : 2.12, -0.08);
  const postOffset = new Vector3(0, 1.3, 0);
  let instanceIndex = 0;
  for (const placement of placements) {
    const blade = blades.get(placement.limitFigure);
    if (!blade) continue;
    const yaw = speedLimitSignYawRad(placement.flowHeadingRad);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const destructibleParts: DestructiblePropPart[] = [];
    for (const part of [
      { master: post, offset: postOffset },
      { master: blade, offset: bladeOffset },
    ]) {
      const instance = part.master.createInstance(
        `prop-speedlimit-sign-${instanceIndex}`,
      );
      instanceIndex += 1;
      instance.position.set(
        placement.x + part.offset.x * cos + part.offset.z * sin,
        (placement.elevationM ?? 0) + part.offset.y,
        placement.z - part.offset.x * sin + part.offset.z * cos,
      );
      instance.rotation.y = yaw;
      instance.isPickable = false;
      ctx.staticSceneryFreeze.push(instance);
      ctx.registerShadowCaster(instance, placement.x, placement.z);
      destructibleParts.push({ node: instance, isLightPool: false });
    }
    ctx.registerDestructibleProp(
      "speedlimit-sign",
      placement.x,
      placement.z,
      1,
      destructibleParts,
      placement.elevationM ?? 0,
    );
  }
  for (const material of materials) material.freeze();
}

export function buildLondonStreetFurniture(ctx: LondonLandmarksCtx) {
  const scene = ctx.scene;
  const iron = makeMaterial(
    scene,
    "london-street-iron",
    new Color3(0.055, 0.065, 0.065),
  );
  // The museum quarter's eight hand-placed heritage lamps. Their head carries
  // the same warm sodium emissive as the scattered `streetlight` line's
  // (`roadsideProps.ts`'s `lampHead`), because they now stand among about a
  // thousand of them: the old value was a faint daytime warm cast, and eight
  // dark lanterns in a lit street read as eight broken lamps. No ground light
  // pool, matching the park lamp — the pool is the roadside line's signature,
  // and these sit inside its rhythm rather than filling a gap in it.
  const lamp = makeMaterial(
    scene,
    "london-street-lamp",
    new Color3(0.78, 0.72, 0.5),
    new Color3(1.5, 0.86, 0.34),
  );
  const planter = makeMaterial(
    scene,
    "london-planter",
    new Color3(0.2, 0.34, 0.19),
  );
  const postBoxRed = makeMaterial(
    scene,
    "london-post-box",
    new Color3(0.62, 0.045, 0.04),
  );

  const lampPositions = LONDON_LAMP_POSITIONS;
  for (let index = 0; index < lampPositions.length; index += 1) {
    const [x, z] = lampPositions[index];
    const post = createCylinder(
      scene,
      `london-lamp-post-${index}`,
      { height: 4.7, diameter: 0.18 },
      new Vector3(x, 2.35, z),
      iron,
    );
    const head = createBox(
      scene,
      `london-lamp-head-${index}`,
      { width: 0.62, height: 0.78, depth: 0.62 },
      new Vector3(x, 4.68, z),
      lamp,
    );
    ctx.registerDestructibleProp("london-lamp", x, z, 1, [
      { node: post, isLightPool: false },
      { node: head, isLightPool: false },
    ]);
  }

  for (const [index, [x, z]] of LONDON_BOLLARD_POSITIONS.entries()) {
    const bollard = createCylinder(
      scene,
      `london-bollard-${index}-${x}`,
      { height: 0.95, diameterTop: 0.17, diameterBottom: 0.28 },
      new Vector3(x, 0.49, z),
      iron,
    );
    ctx.registerDestructibleProp("london-bollard", x, z, 1, [
      { node: bollard, isLightPool: false },
    ]);
  }

  for (const [index, [x, z]] of LONDON_PLANTER_POSITIONS.entries()) {
    const planterBody = createCylinder(
      scene,
      `london-planter-${index}`,
      { height: 0.72, diameterTop: 1.15, diameterBottom: 0.92 },
      new Vector3(x, 0.38, z),
      planter,
    );
    ctx.registerDestructibleProp("london-planter", x, z, 1, [
      { node: planterBody, isLightPool: false },
    ]);
  }

  // Pedestrian guardrails at the roundabout mouths — the black railed
  // barriers that hem a real London junction. Deliberately visual-only, like
  // the bridge kerbside guardrails: no collider registration of any kind.
  // Yaw convention: headingDeg is the run's clockwise world yaw, so the long
  // axis direction is (sin, cos) of it — NOT the block-local heading map.
  for (const run of LONDON_GUARDRAILS) {
    const yawRad = (run.headingDeg * Math.PI) / 180;
    const ax = Math.sin(yawRad);
    const az = Math.cos(yawRad);
    for (const railY of [0.55, 0.95]) {
      const bar = createBox(
        scene,
        `${run.id}-bar-${railY}`,
        { width: 0.06, height: 0.05, depth: run.lengthM },
        new Vector3(run.position.x, railY, run.position.z),
        iron,
      );
      bar.rotation.y = yawRad;
    }
    const postCount = Math.max(2, Math.round(run.lengthM / 2.7));
    for (let index = 0; index < postCount; index += 1) {
      const t = postCount === 1 ? 0 : index / (postCount - 1) - 0.5;
      createCylinder(
        scene,
        `${run.id}-post-${index}`,
        { height: 1.02, diameter: 0.07 },
        new Vector3(
          run.position.x + ax * t * run.lengthM,
          0.51,
          run.position.z + az * t * run.lengthM,
        ),
        iron,
      );
    }
  }

  // Pillar boxes and K6-style telephone kiosks, from the same module the
  // adapter reads to make them solid. Neither is knockable: cast iron and a
  // quarter-tonne of glazed kiosk both beat a car.
  for (const box of LONDON_PILLAR_BOXES) {
    createCylinder(
      scene,
      `${box.id}-body`,
      { height: 1.55, diameter: 0.62 },
      new Vector3(box.position.x, 0.79, box.position.z),
      postBoxRed,
    );
    createCylinder(
      scene,
      `${box.id}-cap`,
      { height: 0.28, diameterTop: 0.4, diameterBottom: 0.72 },
      new Vector3(box.position.x, 1.69, box.position.z),
      postBoxRed,
    );
  }

  // Belisha beacons: a banded black-and-white pole with an amber globe, one
  // pair per zebra crossing. The globe is emissive because the real ones
  // flash, and a dark ball on a pole reads as nothing at all.
  const beaconWhite = makeMaterial(
    scene,
    "london-beacon-white",
    new Color3(0.88, 0.87, 0.83),
  );
  const beaconAmber = makeMaterial(
    scene,
    "london-beacon-amber",
    new Color3(0.85, 0.55, 0.08),
    new Color3(0.7, 0.42, 0.05),
  );
  for (const beacon of LONDON_BELISHA_BEACONS) {
    for (let band = 0; band < 6; band += 1) {
      const segment = createCylinder(
        scene,
        `${beacon.id}-band-${band}`,
        { height: 0.42, diameter: 0.15, tessellation: 8 },
        new Vector3(beacon.position.x, 0.21 + band * 0.42, beacon.position.z),
        band % 2 === 0 ? iron : beaconWhite,
      );
      segment.isPickable = false;
      ctx.staticSceneryFreeze.push(segment);
    }
    const globe = createCylinder(
      scene,
      `${beacon.id}-globe`,
      { height: 0.46, diameter: 0.42, tessellation: 10 },
      new Vector3(beacon.position.x, 2.78, beacon.position.z),
      beaconAmber,
    );
    globe.isPickable = false;
    ctx.staticSceneryFreeze.push(globe);
  }

  const kioskGlass = makeMaterial(
    scene,
    "london-kiosk-glass",
    new Color3(0.36, 0.45, 0.44),
  );
  for (const kiosk of LONDON_PHONE_BOXES) {
    const yaw = degreesToRadians(kiosk.headingDeg);
    const shell = createBox(
      scene,
      `${kiosk.id}-shell`,
      { width: 0.94, height: 2.44, depth: 0.94 },
      new Vector3(kiosk.position.x, 1.22, kiosk.position.z),
      postBoxRed,
    );
    shell.rotation.y = yaw;
    // Glazing on all four faces, set marginally proud of the shell so the
    // kiosk reads as glass in a red frame rather than a red slab.
    for (const [index, side] of [
      [0, 0.48],
      [1, -0.48],
    ].entries()) {
      const [, offset] = side;
      const front = createBox(
        scene,
        `${kiosk.id}-glazing-${index}`,
        { width: 0.66, height: 1.62, depth: 0.04 },
        new Vector3(0, 0.26, offset),
        kioskGlass,
        shell,
      );
      front.isPickable = false;
      const flank = createBox(
        scene,
        `${kiosk.id}-glazing-side-${index}`,
        { width: 0.04, height: 1.62, depth: 0.66 },
        new Vector3(offset, 0.26, 0),
        kioskGlass,
        shell,
      );
      flank.isPickable = false;
    }
    const frieze = createBox(
      scene,
      `${kiosk.id}-frieze`,
      { width: 1.04, height: 0.26, depth: 1.04 },
      new Vector3(0, 1.32, 0),
      postBoxRed,
      shell,
    );
    frieze.isPickable = false;
    const crown = createBox(
      scene,
      `${kiosk.id}-crown`,
      { width: 0.78, height: 0.2, depth: 0.78 },
      new Vector3(0, 1.55, 0),
      postBoxRed,
      shell,
    );
    crown.isPickable = false;
    ctx.staticSceneryFreeze.push(shell);
  }
}
