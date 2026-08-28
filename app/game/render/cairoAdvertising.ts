import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  CAIRO_AD_CREATIVES,
  cairoAdAtlasUv,
  cairoAdPlacements,
  type CairoAdAtlasId,
  type CairoAdCreative,
  type CairoAdPlacement,
} from "../cairoAdvertising";
import { ARABIC_CANVAS_FONT_FAMILY } from "../arabicFont";
import type { BuildingLayoutPlan } from "../geometry/buildingLayout";
import type { GameCanvasMapPack } from "../sessionContract";
import { createBox, createCylinder, createIcoSphere } from "./meshPrimitives";

/**
 * Cairo's commercial-sign pass: glossy image-led skyline boards, repeated
 * text-led pole campaigns, parapet signs, and unmistakable bridge gantries. The image atlases
 * contains no baked copy; every word is rasterised here so Arabic uses the
 * bundled shaping-capable font and never inherits image-generation gibberish.
 * All materials are shared and all repeated geometry is instanced: city-wide
 * density does not turn into one texture or mesh recipe per placement.
 */

const AD_ATLAS_URLS: Readonly<Record<CairoAdAtlasId, string>> = {
  v1: "/art/cairo/fictional-ad-atlas-v1.png",
  v2: "/art/cairo/fictional-ad-atlas-v2.png",
};

export interface CairoAdvertisingCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly buildingLayout: BuildingLayoutPlan;
}

export interface CairoAdvertisingRenderOptions {
  /** Test-only escape hatch for comparing the legacy node-per-part renderer. */
  readonly batchStaticMeshes?: boolean;
}

const CAIRO_AD_BATCH_CELL_M = 128;

interface CairoAdMaterials {
  readonly frame: StandardMaterial;
  readonly steel: StandardMaterial;
  readonly lamp: StandardMaterial;
  readonly art: readonly StandardMaterial[];
  readonly landscapeCopy: readonly StandardMaterial[];
  readonly poleFace: readonly StandardMaterial[];
}

function makeMetalMaterial(
  scene: Scene,
  name: string,
  color: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.95, 0.97, 1);
  material.specularPower = 192;
  return material;
}

function fitFont(
  context: CanvasRenderingContext2D,
  text: string,
  family: string,
  startPx: number,
  minPx: number,
  maxWidth: number,
): number {
  let size = startPx;
  context.font = `800 ${size}px ${family}`;
  while (size > minPx && context.measureText(text).width > maxWidth) {
    size -= 4;
    context.font = `800 ${size}px ${family}`;
  }
  return size;
}

function configureTextDirection(
  context: CanvasRenderingContext2D,
  creative: CairoAdCreative,
): string {
  const arabic = creative.language === "ar";
  context.direction = arabic ? "rtl" : "ltr";
  return arabic
    ? `"${ARABIC_CANVAS_FONT_FAMILY}", Tahoma, Arial, sans-serif`
    : "Figtree, Arial, sans-serif";
}

function makeLandscapeCopyMaterial(
  scene: Scene,
  creative: CairoAdCreative,
): StandardMaterial {
  const texture = new DynamicTexture(
    `cairo-ad-copy-${creative.id}-texture`,
    { width: 1024, height: 288 },
    scene,
    true,
  );
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, 1024, 288);
  const shade = context.createLinearGradient(430, 0, 1010, 0);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.38, "rgba(0,0,0,0.42)");
  shade.addColorStop(1, "rgba(0,0,0,0.72)");
  context.fillStyle = shade;
  context.fillRect(390, 0, 634, 288);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.95)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 5;
  const family = configureTextDirection(context, creative);
  const headlineSize = fitFont(
    context,
    creative.headline,
    family,
    creative.language === "ar" ? 82 : 74,
    44,
    470,
  );
  context.fillStyle = "#ffffff";
  context.font = `800 ${headlineSize}px ${family}`;
  context.fillText(creative.headline, 756, 116);
  context.shadowBlur = 9;
  const subFamily =
    creative.language === "en"
      ? "Figtree, Arial, sans-serif"
      : `"${ARABIC_CANVAS_FONT_FAMILY}", Tahoma, Arial, sans-serif`;
  context.direction = creative.language === "en" ? "ltr" : "rtl";
  const subSize = fitFont(context, creative.subline, subFamily, 35, 24, 430);
  context.fillStyle = creative.accent;
  context.font = `700 ${subSize}px ${subFamily}`;
  context.fillText(creative.subline, 756, 202);
  context.shadowColor = "transparent";
  context.fillStyle = creative.accent;
  context.fillRect(610, 239, 292, 7);
  texture.update();

  const material = new StandardMaterial(`cairo-ad-copy-${creative.id}`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(1.1, 1.1, 1.1);
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = true;
  return material;
}

const POLE_BACKGROUNDS: readonly [string, string][] = [
  ["#087b82", "#06344f"],
  ["#173c86", "#6a1f8f"],
  ["#e64f2f", "#8c1534"],
  ["#789820", "#176d62"],
  ["#613019", "#161d31"],
  ["#0b6a72", "#183c5c"],
  ["#8a1b69", "#401371"],
  ["#0d3e81", "#172049"],
  ["#7b4b16", "#24150b"],
  ["#43307a", "#182854"],
  ["#78511f", "#283448"],
  ["#156a83", "#102c61"],
  ["#9a4a1a", "#432316"],
  ["#0b7775", "#173255"],
  ["#7d1d5c", "#281342"],
  ["#9b5619", "#3a1f12"],
];

function makePoleFaceMaterial(
  scene: Scene,
  creative: CairoAdCreative,
  creativeIndex: number,
): StandardMaterial {
  const texture = new DynamicTexture(
    `cairo-pole-ad-${creative.id}-texture`,
    { width: 512, height: 768 },
    scene,
    true,
  );
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const colors = POLE_BACKGROUNDS[creativeIndex % POLE_BACKGROUNDS.length];
  const gradient = context.createLinearGradient(0, 0, 512, 768);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 768);
  context.globalAlpha = 0.22;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(428, 120, 178, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(-40, 650);
  context.lineTo(552, 420);
  context.lineTo(552, 575);
  context.lineTo(-40, 805);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
  context.strokeStyle = creative.accent;
  context.lineWidth = 12;
  context.strokeRect(16, 16, 480, 736);
  context.fillStyle = creative.accent;
  context.fillRect(76, 152, 360, 10);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.9)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 6;
  const family = configureTextDirection(context, creative);
  const headlineSize = fitFont(context, creative.headline, family, 72, 42, 420);
  context.fillStyle = "#ffffff";
  context.font = `800 ${headlineSize}px ${family}`;
  context.fillText(creative.headline, 256, 300);
  const subFamily =
    creative.language === "en"
      ? "Figtree, Arial, sans-serif"
      : `"${ARABIC_CANVAS_FONT_FAMILY}", Tahoma, Arial, sans-serif`;
  context.direction = creative.language === "en" ? "ltr" : "rtl";
  const subSize = fitFont(context, creative.subline, subFamily, 38, 27, 390);
  context.fillStyle = creative.accent;
  context.font = `700 ${subSize}px ${subFamily}`;
  context.fillText(creative.subline, 256, 410);
  context.shadowColor = "transparent";
  context.globalAlpha = 0.86;
  context.fillStyle = "#ffffff";
  for (let index = 0; index < 3; index += 1) {
    context.fillRect(106 + index * 108, 590, 82, 9);
  }
  context.globalAlpha = 1;
  texture.update();

  const material = new StandardMaterial(`cairo-pole-ad-${creative.id}`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.White();
  material.emissiveColor = new Color3(0.88, 0.88, 0.88);
  material.specularColor = new Color3(0.72, 0.74, 0.8);
  material.specularPower = 128;
  material.backFaceCulling = false;
  return material;
}

function makeAtlasMaterial(
  scene: Scene,
  creative: CairoAdCreative,
): StandardMaterial {
  const texture = new Texture(
    AD_ATLAS_URLS[creative.artAtlas],
    scene,
    true,
    true,
  );
  const crop = cairoAdAtlasUv(creative.artIndex, creative.artAtlas);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.uScale = crop.uScale;
  texture.vScale = crop.vScale;
  texture.uOffset = crop.uOffset;
  texture.vOffset = crop.vOffset;

  const material = new StandardMaterial(`cairo-ad-art-${creative.id}`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.White();
  // Night bloom supplies the attention-grabbing shine; the relatively high
  // specular response keeps the face glossy when a street lamp crosses it.
  material.emissiveColor = new Color3(0.82, 0.82, 0.82);
  material.specularColor = new Color3(0.9, 0.92, 0.98);
  material.specularPower = 160;
  material.backFaceCulling = false;
  return material;
}

function buildMaterials(scene: Scene): CairoAdMaterials {
  const frame = makeMetalMaterial(
    scene,
    "cairo-ad-polished-frame",
    new Color3(0.25, 0.27, 0.3),
  );
  const steel = makeMetalMaterial(
    scene,
    "cairo-ad-support-steel",
    new Color3(0.12, 0.13, 0.15),
  );
  const lamp = new StandardMaterial("cairo-ad-lamp", scene);
  lamp.diffuseColor = new Color3(1, 0.9, 0.7);
  lamp.emissiveColor = new Color3(1.35, 1.05, 0.68);
  lamp.specularColor = Color3.White();
  lamp.specularPower = 128;
  return {
    frame,
    steel,
    lamp,
    art: CAIRO_AD_CREATIVES.map((creative) =>
      makeAtlasMaterial(scene, creative),
    ),
    landscapeCopy: CAIRO_AD_CREATIVES.map((creative) =>
      makeLandscapeCopyMaterial(scene, creative),
    ),
    poleFace: CAIRO_AD_CREATIVES.map((creative, index) =>
      makePoleFaceMaterial(scene, creative, index),
    ),
  };
}

interface CairoAdMasters {
  readonly pole: Mesh;
  readonly poleBacking: Mesh;
  readonly poleFaces: readonly Mesh[];
  readonly unitBox: Mesh;
  readonly artFaces: readonly Mesh[];
  readonly copyFaces: readonly Mesh[];
  readonly lamp: Mesh;
}

function buildMasters(
  scene: Scene,
  materials: CairoAdMaterials,
): CairoAdMasters {
  const pole = createCylinder(
    scene,
    "cairo-ad-pole-master",
    { height: 6.35, diameter: 0.16, tessellation: 10 },
    Vector3.Zero(),
    materials.steel,
  );
  const poleBacking = createBox(
    scene,
    "cairo-ad-pole-backing-master",
    { width: 1, height: 1, depth: 0.14 },
    Vector3.Zero(),
    materials.frame,
  );
  const unitBox = createBox(
    scene,
    "cairo-ad-unit-box-master",
    { width: 1, height: 1, depth: 1 },
    Vector3.Zero(),
    materials.steel,
  );
  const poleFaces = materials.poleFace.map((material, index) => {
    const mesh = MeshBuilder.CreatePlane(
      `cairo-ad-pole-face-master-${index}`,
      { width: 1, height: 1 },
      scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  });
  const artFaces = materials.art.map((material, index) => {
    const mesh = MeshBuilder.CreatePlane(
      `cairo-ad-art-master-${index}`,
      { width: 1, height: 1 },
      scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  });
  const copyFaces = materials.landscapeCopy.map((material, index) => {
    const mesh = MeshBuilder.CreatePlane(
      `cairo-ad-copy-master-${index}`,
      { width: 1, height: 1 },
      scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  });
  const lamp = createIcoSphere(
    scene,
    "cairo-ad-lamp-master",
    0.16,
    Vector3.Zero(),
    materials.lamp,
  );
  for (const master of [
    pole,
    poleBacking,
    unitBox,
    lamp,
    ...poleFaces,
    ...artFaces,
    ...copyFaces,
  ]) {
    master.isVisible = false;
    master.isPickable = false;
  }
  return { pole, poleBacking, poleFaces, unitBox, artFaces, copyFaces, lamp };
}

interface CairoAdPlacementFrame {
  readonly worldMatrix: Matrix;
  readonly legacyRoot?: TransformNode;
}

interface CairoAdThinInstanceChunk {
  readonly master: Mesh;
  readonly cellX: number;
  readonly cellZ: number;
  readonly matrices: Matrix[];
}

interface CairoAdInstanceSink {
  createPlacementFrame(placement: CairoAdPlacement): CairoAdPlacementFrame;
  placeInstance(
    frame: CairoAdPlacementFrame,
    master: Mesh,
    name: string,
    position: Vector3,
    scaling: Vector3,
    yaw?: number,
  ): void;
  finalize(): void;
}

class LegacyCairoAdInstanceSink implements CairoAdInstanceSink {
  constructor(private readonly ctx: CairoAdvertisingCtx) {}

  createPlacementFrame(placement: CairoAdPlacement): CairoAdPlacementFrame {
    const root = new TransformNode(`${placement.id}-root`, this.ctx.scene);
    root.position.set(
      placement.position.x,
      placement.position.elevationM ?? 0,
      placement.position.z,
    );
    root.rotation.y = placement.headingRad;
    this.ctx.staticSceneryFreeze.push(root);
    return {
      worldMatrix: root.computeWorldMatrix(true).clone(),
      legacyRoot: root,
    };
  }

  placeInstance(
    frame: CairoAdPlacementFrame,
    master: Mesh,
    name: string,
    position: Vector3,
    scaling: Vector3,
    yaw = 0,
  ): void {
    const instance = master.createInstance(name);
    instance.parent = frame.legacyRoot ?? null;
    instance.position.copyFrom(position);
    instance.scaling.copyFrom(scaling);
    instance.rotation.y = yaw;
    instance.isPickable = false;
    this.ctx.staticSceneryFreeze.push(instance);
  }

  finalize(): void {}
}

class BatchedCairoAdInstanceSink implements CairoAdInstanceSink {
  private readonly chunksByMaster = new Map<
    Mesh,
    Map<string, CairoAdThinInstanceChunk>
  >();

  constructor(private readonly ctx: CairoAdvertisingCtx) {}

  createPlacementFrame(placement: CairoAdPlacement): CairoAdPlacementFrame {
    return {
      worldMatrix: Matrix.Compose(
        Vector3.One(),
        Quaternion.FromEulerAngles(0, placement.headingRad, 0),
        new Vector3(
          placement.position.x,
          placement.position.elevationM ?? 0,
          placement.position.z,
        ),
      ),
    };
  }

  placeInstance(
    frame: CairoAdPlacementFrame,
    master: Mesh,
    _name: string,
    position: Vector3,
    scaling: Vector3,
    yaw = 0,
  ): void {
    // Babylon composes a child's world matrix as local * parent. Baking that
    // exact order into the thin-instance buffer preserves every existing
    // front/back face, cant, bracket and bridge-relative elevation without
    // retaining thousands of TransformNodes and InstancedMeshes.
    const worldMatrix = Matrix.Compose(
      scaling,
      Quaternion.FromEulerAngles(0, yaw, 0),
      position,
    ).multiply(frame.worldMatrix);
    const cellX = Math.floor(worldMatrix.m[12] / CAIRO_AD_BATCH_CELL_M);
    const cellZ = Math.floor(worldMatrix.m[14] / CAIRO_AD_BATCH_CELL_M);
    let chunks = this.chunksByMaster.get(master);
    if (!chunks) {
      chunks = new Map();
      this.chunksByMaster.set(master, chunks);
    }
    const key = `${cellX}:${cellZ}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { master, cellX, cellZ, matrices: [] };
      chunks.set(key, chunk);
    }
    chunk.matrices.push(worldMatrix);
  }

  finalize(): void {
    for (const chunks of this.chunksByMaster.values()) {
      for (const chunk of chunks.values()) {
        const batch = chunk.master.clone(
          `${chunk.master.name}-batch-${chunk.cellX}-${chunk.cellZ}`,
          null,
          true,
          false,
        );
        if (!batch) {
          throw new Error(
            `Unable to clone Cairo ad master ${chunk.master.name}`,
          );
        }
        // Thin-instance matrix attributes (`world0` ... `world3`) live on the
        // mesh Geometry in Babylon. Cloned meshes share that Geometry by
        // default, so installing a later spatial chunk would otherwise replace
        // the GPU matrices used by every earlier chunk of the same ad part.
        // Keep the lightweight shared material, but give each culling chunk
        // its own vertex-buffer container before attaching instance matrices.
        batch.makeGeometryUnique();
        batch.position.setAll(0);
        batch.rotation.setAll(0);
        batch.scaling.setAll(1);
        batch.rotationQuaternion = null;
        batch.isVisible = true;
        batch.isPickable = false;
        batch.thinInstanceEnablePicking = false;
        batch.alwaysSelectAsActiveMesh = false;
        batch.receiveShadows = chunk.master.receiveShadows;
        batch.renderingGroupId = chunk.master.renderingGroupId;
        batch.alphaIndex = chunk.master.alphaIndex;
        batch.layerMask = chunk.master.layerMask;
        const matrices = new Float32Array(chunk.matrices.length * 16);
        for (let index = 0; index < chunk.matrices.length; index += 1) {
          chunk.matrices[index].copyToArray(matrices, index * 16);
        }
        // The scene's aggressive performance mode can already disable bound
        // syncing on construction. Set the final chunk bounds explicitly once
        // so frustum culling remains conservative in every scene mode.
        batch.computeWorldMatrix(true);
        batch.doNotSyncBoundingInfo = true;
        batch.thinInstanceSetBuffer("matrix", matrices, 16, true);
        batch.thinInstanceRefreshBoundingInfo(true);
        this.ctx.staticSceneryFreeze.push(batch);
      }
    }
  }
}

function placeInstance(
  sink: CairoAdInstanceSink,
  frame: CairoAdPlacementFrame,
  master: Mesh,
  name: string,
  position: Vector3,
  scaling: Vector3,
  yaw = 0,
): void {
  sink.placeInstance(frame, master, name, position, scaling, yaw);
}

function buildPoleBanner(
  sink: CairoAdInstanceSink,
  frame: CairoAdPlacementFrame,
  placement: CairoAdPlacement,
  masters: CairoAdMasters,
): void {
  placeInstance(
    sink,
    frame,
    masters.pole,
    `${placement.id}-pole`,
    new Vector3(0, 3.175, 0),
    Vector3.One(),
  );
  placeInstance(
    sink,
    frame,
    masters.poleBacking,
    `${placement.id}-frame`,
    new Vector3(0, placement.panelCenterYM, 0),
    new Vector3(placement.widthM + 0.18, placement.heightM + 0.18, 1),
  );
  const faceMaster = masters.poleFaces[placement.creativeIndex];
  for (const side of [-1, 1] as const) {
    placeInstance(
      sink,
      frame,
      faceMaster,
      `${placement.id}-face-${side === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, side * 0.081),
      new Vector3(placement.widthM, placement.heightM, 1),
      side === -1 ? 0 : Math.PI,
    );
  }
}

function buildBridgeSideSign(
  sink: CairoAdInstanceSink,
  frame: CairoAdPlacementFrame,
  placement: CairoAdPlacement,
  masters: CairoAdMasters,
): void {
  const side = placement.side ?? 1;
  const frameHalfWidthM = (placement.widthM + 0.18) / 2;
  // The face's inner edge sits outside the parapet. This pole lands on the
  // parapet edge and short brackets cantilever outward to the luminous card,
  // so neither the frame nor any support intrudes into a live lane.
  const mountX = -side * (frameHalfWidthM + 0.18);
  const supportHeightM = placement.panelCenterYM + placement.heightM / 2 + 0.32;
  placeInstance(
    sink,
    frame,
    masters.unitBox,
    `${placement.id}-parapet-post`,
    new Vector3(mountX, supportHeightM / 2, 0),
    new Vector3(0.18, supportHeightM, 0.18),
  );
  for (const bracketY of [
    placement.panelCenterYM - placement.heightM * 0.32,
    placement.panelCenterYM + placement.heightM * 0.32,
  ]) {
    placeInstance(
      sink,
      frame,
      masters.unitBox,
      `${placement.id}-bracket-${bracketY}`,
      new Vector3(mountX / 2, bracketY, 0),
      new Vector3(Math.abs(mountX), 0.14, 0.18),
    );
  }
  placeInstance(
    sink,
    frame,
    masters.poleBacking,
    `${placement.id}-frame`,
    new Vector3(0, placement.panelCenterYM, 0),
    new Vector3(placement.widthM + 0.18, placement.heightM + 0.18, 1.35),
  );
  const faceMaster = masters.poleFaces[placement.creativeIndex];
  for (const faceSide of [-1, 1] as const) {
    placeInstance(
      sink,
      frame,
      faceMaster,
      `${placement.id}-face-${faceSide === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, faceSide * 0.1),
      new Vector3(placement.widthM, placement.heightM, 1),
      faceSide === -1 ? 0 : Math.PI,
    );
  }
  for (const lampX of [-0.28, 0.28]) {
    placeInstance(
      sink,
      frame,
      masters.lamp,
      `${placement.id}-lamp-${lampX}`,
      new Vector3(
        placement.widthM * lampX,
        placement.panelCenterYM + placement.heightM / 2 + 0.18,
        -0.22,
      ),
      new Vector3(0.82, 0.82, 0.82),
    );
  }
}

function buildSkylineBillboard(
  sink: CairoAdInstanceSink,
  frame: CairoAdPlacementFrame,
  placement: CairoAdPlacement,
  masters: CairoAdMasters,
): void {
  const frameDepthM = 0.34;
  const frameBottomY = placement.panelCenterYM - placement.heightM / 2;
  const supportHeightM = Math.max(4, frameBottomY - 0.25);
  // A central pedestal keeps the support compact inside the selected street-
  // wall gap. Placement has already audited the complete 55-degree frame,
  // lamps and pedestal against roads and the exact rendered buildings.
  placeInstance(
    sink,
    frame,
    masters.unitBox,
    `${placement.id}-support`,
    new Vector3(0, supportHeightM / 2, 0),
    new Vector3(0.68, supportHeightM, 0.68),
  );
  placeInstance(
    sink,
    frame,
    masters.unitBox,
    `${placement.id}-crossbar`,
    new Vector3(0, frameBottomY - 0.42, 0),
    new Vector3(placement.widthM * 0.72, 0.26, 0.26),
  );
  placeInstance(
    sink,
    frame,
    masters.poleBacking,
    `${placement.id}-frame`,
    new Vector3(0, placement.panelCenterYM, 0),
    new Vector3(
      placement.widthM + 0.55,
      placement.heightM + 0.55,
      frameDepthM / 0.14,
    ),
  );
  const artMaster = masters.artFaces[placement.creativeIndex];
  const copyMaster = masters.copyFaces[placement.creativeIndex];
  for (const side of [-1, 1] as const) {
    const yaw = side === -1 ? 0 : Math.PI;
    placeInstance(
      sink,
      frame,
      artMaster,
      `${placement.id}-art-${side === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, side * 0.185),
      new Vector3(placement.widthM, placement.heightM, 1),
      yaw,
    );
    placeInstance(
      sink,
      frame,
      copyMaster,
      `${placement.id}-copy-${side === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, side * 0.205),
      new Vector3(placement.widthM, placement.heightM, 1),
      yaw,
    );
  }
  for (const lampOffset of [-0.31, 0, 0.31]) {
    placeInstance(
      sink,
      frame,
      masters.lamp,
      `${placement.id}-lamp-${lampOffset}`,
      new Vector3(placement.widthM * lampOffset, frameBottomY - 0.08, -0.38),
      Vector3.One(),
    );
  }
}

function buildBridgeGantry(
  sink: CairoAdInstanceSink,
  frame: CairoAdPlacementFrame,
  placement: CairoAdPlacement,
  masters: CairoAdMasters,
): void {
  const frameDepthM = 0.42;
  const frameBottomY = placement.panelCenterYM - placement.heightM / 2;
  const supportHeightM = frameBottomY - 0.2;
  // Placement owns the exact road/parapet clearance; the renderer only turns
  // that audited span into geometry.
  const supportOffsetM = placement.supportOffsetM ?? placement.widthM * 0.42;
  for (const side of [-1, 1] as const) {
    placeInstance(
      sink,
      frame,
      masters.unitBox,
      `${placement.id}-support-${side}`,
      new Vector3(side * supportOffsetM, supportHeightM / 2, 0),
      new Vector3(0.4, supportHeightM, 0.4),
    );
  }
  placeInstance(
    sink,
    frame,
    masters.unitBox,
    `${placement.id}-crossbar`,
    new Vector3(0, frameBottomY - 0.34, 0),
    new Vector3(placement.widthM * 0.9, 0.34, 0.32),
  );
  placeInstance(
    sink,
    frame,
    masters.poleBacking,
    `${placement.id}-frame`,
    new Vector3(0, placement.panelCenterYM, 0),
    new Vector3(
      placement.widthM + 0.55,
      placement.heightM + 0.55,
      frameDepthM / 0.14,
    ),
  );

  const artMaster = masters.artFaces[placement.creativeIndex];
  const copyMaster = masters.copyFaces[placement.creativeIndex];
  for (const side of [-1, 1] as const) {
    const yaw = side === -1 ? 0 : Math.PI;
    placeInstance(
      sink,
      frame,
      artMaster,
      `${placement.id}-art-${side === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, side * 0.225),
      new Vector3(placement.widthM, placement.heightM, 1),
      yaw,
    );
    placeInstance(
      sink,
      frame,
      copyMaster,
      `${placement.id}-copy-${side === -1 ? "front" : "back"}`,
      new Vector3(0, placement.panelCenterYM, side * 0.245),
      new Vector3(placement.widthM, placement.heightM, 1),
      yaw,
    );
  }
  for (const lampOffset of [-0.36, -0.12, 0.12, 0.36]) {
    placeInstance(
      sink,
      frame,
      masters.lamp,
      `${placement.id}-lamp-${lampOffset}`,
      new Vector3(placement.widthM * lampOffset, frameBottomY - 0.08, -0.46),
      Vector3.One(),
    );
  }
}

/** Registry `streetFurniture` builder for Cairo's city-wide ad layer. */
export function buildCairoAdvertising(
  ctx: CairoAdvertisingCtx,
  mapPack: GameCanvasMapPack,
  options: CairoAdvertisingRenderOptions = {},
): void {
  const placements = cairoAdPlacements(mapPack, ctx.buildingLayout);
  if (!placements.length) return;
  const materials = buildMaterials(ctx.scene);
  const masters = buildMasters(ctx.scene, materials);
  const sink: CairoAdInstanceSink =
    options.batchStaticMeshes === false
      ? new LegacyCairoAdInstanceSink(ctx)
      : new BatchedCairoAdInstanceSink(ctx);
  for (const placement of placements) {
    const frame = sink.createPlacementFrame(placement);
    if (placement.kind === "pole-banner") {
      buildPoleBanner(sink, frame, placement, masters);
    } else if (placement.kind === "bridge-side-sign") {
      buildBridgeSideSign(sink, frame, placement, masters);
    } else if (placement.kind === "skyline-billboard") {
      buildSkylineBillboard(sink, frame, placement, masters);
    } else {
      buildBridgeGantry(sink, frame, placement, masters);
    }
  }
  sink.finalize();
  for (const material of [
    materials.frame,
    materials.steel,
    materials.lamp,
    ...materials.art,
    ...materials.landscapeCopy,
    ...materials.poleFace,
  ]) {
    material.freeze();
  }
}
