import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { createBox, createCylinder, setMeshMaterial } from "./meshPrimitives";
import { textureContext } from "./proceduralTextures";
import {
  LONDON_BOLLARD_POSITIONS,
  LONDON_LAMP_POSITIONS,
  LONDON_PLANTER_POSITIONS,
  LONDON_POST_BOX_POSITION,
  type DestructiblePropPart,
} from "./propCatalog";
import {
  regulatorySignYawRad,
  speedLimitSignFamily,
  speedLimitSignYawRad,
  type RegulatorySignKind,
  type RegulatorySignPlacement,
  type SpeedLimitSignPlacement,
} from "../regulatorySigns";
import type { GameCanvasMapPack } from "../sessionContract";

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
 * else in the class; it becomes a module-level `let` here rather than a ctx
 * field, since ctx is for session state, not this file's own cache.
 * `registerShadowCaster`/`registerDestructibleProp` are threaded as ctx
 * callbacks (shared class-wide); `staticSceneryFreeze` passes through ctx as
 * a live array reference. `makeMaterial`/`setMeshMaterial`/`textureContext`
 * are duplicated or imported per the same house convention every prior
 * commit has used.
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

let signPostMasterCache: Mesh | null = null;

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
  ) => void;
}

/**
 * Gives the South Kensington miniature a readable silhouette without using
 * imagery, branding, or detailed replicas of the real museum buildings.
 */
export function buildLondonLandmark(
  ctx: LondonLandmarksCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  material: StandardMaterial,
): boolean {
  const scene = ctx.scene;
  const trim = makeMaterial(scene, `${landmark.id}-trim`, new Color3(0.82, 0.76, 0.65));
  const windows = makeMaterial(scene, `${landmark.id}-windows`, new Color3(0.12, 0.2, 0.23));
  const roof = makeMaterial(scene, `${landmark.id}-roof`, new Color3(0.25, 0.22, 0.2));

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
      { width: landmark.size.x + 1.2, height: 1.05, depth: landmark.size.z + 1.2 },
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
      { width: landmark.size.x + 0.8, height: 1.1, depth: landmark.size.z + 0.8 },
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
      new Vector3(landmark.center.x, 3.1, landmark.center.z - landmark.size.z / 2 - 1.2),
      roof,
    );
    createBox(
      scene,
      `${landmark.id}-name-board`,
      { width: 9, height: 1.1, depth: 0.2 },
      new Vector3(landmark.center.x, 4.25, landmark.center.z - landmark.size.z / 2 - 0.14),
      trim,
    );
    return true;
  }

  if (landmark.id === "london-exhibition-road-public-space") {
    const paving = makeMaterial(scene, `${landmark.id}-paving`, new Color3(0.54, 0.54, 0.5));
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
  const faceMaterial = (name: string, texture: DynamicTexture): StandardMaterial => {
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
  const wrongWayTexture = faceTexture("regsign-wrongway", 512, 512, (context) => {
    context.fillStyle = signRed;
    context.fillRect(0, 0, 512, 256);
    context.strokeStyle = white;
    context.lineWidth = 8;
    context.strokeRect(10, 10, 492, 236);
    context.fillStyle = white;
    context.font = "bold 68px Arial, sans-serif";
    context.fillText("WRONG WAY", 256, 130);
  });
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
    const faceUV = [
      plusZ,
      minusZ,
      GRAY_UV,
      GRAY_UV,
      GRAY_UV,
      GRAY_UV,
    ];
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
        part.offset.y,
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
  if (signPostMasterCache) return signPostMasterCache;
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
  signPostMasterCache = post;
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
        { height: 0.05, diameter: 0.62, tessellation: 32, faceUV: [gray, gray, design] },
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
        part.offset.y,
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
    );
  }
  for (const material of materials) material.freeze();
}

export function buildLondonStreetFurniture(ctx: LondonLandmarksCtx) {
  const scene = ctx.scene;
  const iron = makeMaterial(scene, "london-street-iron", new Color3(0.055, 0.065, 0.065));
  const lamp = makeMaterial(
    scene,
    "london-street-lamp",
    new Color3(0.78, 0.72, 0.5),
    new Color3(0.16, 0.12, 0.05),
  );
  const planter = makeMaterial(scene, "london-planter", new Color3(0.2, 0.34, 0.19));
  const postBoxRed = makeMaterial(scene, "london-post-box", new Color3(0.62, 0.045, 0.04));

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

  createCylinder(
    scene,
    "london-generic-post-box",
    { height: 1.55, diameter: 0.62 },
    new Vector3(LONDON_POST_BOX_POSITION[0], 0.79, LONDON_POST_BOX_POSITION[1]),
    postBoxRed,
  );
  createCylinder(
    scene,
    "london-generic-post-box-cap",
    { height: 0.28, diameterTop: 0.4, diameterBottom: 0.72 },
    new Vector3(LONDON_POST_BOX_POSITION[0], 1.69, LONDON_POST_BOX_POSITION[1]),
    postBoxRed,
  );
}
