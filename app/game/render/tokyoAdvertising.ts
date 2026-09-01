import {
  Color3,
  DynamicTexture,
  Mesh,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { BuildingLayoutPlan } from "../geometry/buildingLayout";
import { JAPANESE_CANVAS_FONT_FAMILY } from "../japaneseFont";
import type { GameCanvasMapPack } from "../sessionContract";
import {
  TOKYO_AD_CREATIVES,
  TOKYO_TENANT_CREATIVES,
  tokyoAdAtlasUv,
  tokyoAdvertisingPlan,
  type TokyoAdAtlasId,
  type TokyoAdCreative,
  type TokyoAdPlacement,
  type TokyoTenantCreative,
  type TokyoTenantPlacement,
  type TokyoTenantPlacementKind,
} from "../tokyoAdvertising";
import { createBox } from "./meshPrimitives";

const ATLAS_URLS: Readonly<Record<TokyoAdAtlasId, string>> = {
  portrait: "/art/tokyo/fictional-ad-portrait-atlas-v2.webp",
  landscape: "/art/tokyo/fictional-ad-landscape-atlas-v2.webp",
};

const JAPANESE_FONT_STACK =
  `"${JAPANESE_CANVAS_FONT_FAMILY}", Figtree, "Yu Gothic", sans-serif`;
const DIRECTORY_COUNT = 8;

export interface TokyoAdvertisingCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly buildingLayout: BuildingLayoutPlan;
}

interface TokyoAdMaterials {
  readonly frame: StandardMaterial;
  readonly support: StandardMaterial;
  readonly art: readonly StandardMaterial[];
  readonly copy: readonly StandardMaterial[];
  readonly blade: readonly StandardMaterial[];
  readonly fascia: readonly StandardMaterial[];
  readonly directory: readonly StandardMaterial[];
}

interface TenantMasters {
  readonly blade: readonly Mesh[];
  readonly fascia: readonly Mesh[];
  readonly directory: readonly Mesh[];
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
    size -= 2;
    context.font = `800 ${size}px ${family}`;
  }
  return size;
}

function luminousTextureMaterial(
  scene: Scene,
  name: string,
  texture: Texture | DynamicTexture,
  intensity: number,
  transparent = false,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(intensity, intensity, intensity);
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  if (transparent) {
    material.opacityTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
  }
  return material;
}

/**
 * Babylon maps a box's outward +Z face with both texture axes reversed. Tokyo
 * mounts its sign faces on that side of a thin box, so move the texture origin
 * to the opposite crop corner and reverse both spans. Flipping only V would
 * leave Japanese copy mirrored even though it was no longer upside down.
 */
function orientTextureForPositiveZBoxFace(texture: Texture | DynamicTexture): void {
  texture.uOffset += texture.uScale;
  texture.uScale *= -1;
  texture.vOffset += texture.vScale;
  texture.vScale *= -1;
}

function portraitCopyTexture(
  scene: Scene,
  creative: TokyoAdCreative,
): DynamicTexture {
  const texture = new DynamicTexture(
    `tokyo-ad-copy-${creative.id}-texture`,
    { width: 384, height: 576 },
    scene,
    true,
  );
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, 384, 576);
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.86)";
  context.shadowBlur = 10;
  const variant = creative.artIndex % 4;

  if (variant === 0 || variant === 2) {
    const left = variant === 2;
    const shade = context.createLinearGradient(
      left ? 0 : 384,
      0,
      left ? 250 : 134,
      0,
    );
    shade.addColorStop(0, "rgba(3,7,20,0.88)");
    shade.addColorStop(1, "rgba(3,7,20,0)");
    context.fillStyle = shade;
    context.fillRect(left ? 0 : 120, 0, 264, 576);
    const characters = Array.from(creative.headline.replace(/[、。]/g, ""));
    const rowsPerColumn = 7;
    const columns = Math.ceil(characters.length / rowsPerColumn);
    const xStart = left ? 72 + (columns - 1) * 76 : 312;
    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.font = `800 52px ${JAPANESE_FONT_STACK}`;
    for (const [index, character] of characters.entries()) {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      context.fillText(character, xStart - column * 76, 58 + row * 58);
    }
    context.fillStyle = creative.accent;
    context.fillRect(left ? 34 : 232, 498, 118, 7);
    context.font = `700 20px ${JAPANESE_FONT_STACK}`;
    context.fillText(creative.subline, left ? 112 : 272, 532, 190);
  } else {
    const top = variant === 1;
    const shade = context.createLinearGradient(
      0,
      top ? 0 : 576,
      0,
      top ? 250 : 326,
    );
    shade.addColorStop(0, "rgba(3,7,20,0.9)");
    shade.addColorStop(1, "rgba(3,7,20,0)");
    context.fillStyle = shade;
    context.fillRect(0, top ? 0 : 300, 384, 276);
    context.textAlign = variant === 1 ? "left" : "center";
    context.fillStyle = "#ffffff";
    const headlineSize = fitFont(
      context,
      creative.headline,
      JAPANESE_FONT_STACK,
      43,
      27,
      variant === 1 ? 326 : 350,
    );
    context.font = `800 ${headlineSize}px ${JAPANESE_FONT_STACK}`;
    context.fillText(
      creative.headline,
      variant === 1 ? 28 : 192,
      top ? 82 : 450,
    );
    context.fillStyle = creative.accent;
    context.font = `700 21px ${JAPANESE_FONT_STACK}`;
    context.fillText(
      creative.subline,
      variant === 1 ? 28 : 192,
      top ? 136 : 508,
      328,
    );
    context.fillRect(variant === 1 ? 28 : 102, top ? 176 : 386, 180, 7);
  }
  context.shadowColor = "transparent";
  texture.update();
  orientTextureForPositiveZBoxFace(texture);
  return texture;
}

function landscapeCopyTexture(
  scene: Scene,
  creative: TokyoAdCreative,
): DynamicTexture {
  const texture = new DynamicTexture(
    `tokyo-ad-copy-${creative.id}-texture`,
    { width: 768, height: 432 },
    scene,
    true,
  );
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, 768, 432);
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.9)";
  context.shadowBlur = 14;
  const variant = creative.artIndex % 3;
  const bottom = variant === 2;
  const left = variant === 1;
  if (bottom) {
    const shade = context.createLinearGradient(0, 432, 0, 218);
    shade.addColorStop(0, "rgba(2,5,17,0.92)");
    shade.addColorStop(1, "rgba(2,5,17,0)");
    context.fillStyle = shade;
    context.fillRect(0, 190, 768, 242);
  } else {
    const shade = context.createLinearGradient(
      left ? 0 : 768,
      0,
      left ? 350 : 418,
      0,
    );
    shade.addColorStop(0, "rgba(2,5,17,0.92)");
    shade.addColorStop(1, "rgba(2,5,17,0)");
    context.fillStyle = shade;
    context.fillRect(left ? 0 : 390, 0, 378, 432);
  }
  const x = bottom ? 384 : left ? 175 : 593;
  const maxWidth = bottom ? 680 : 310;
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  const headlineSize = fitFont(
    context,
    creative.headline,
    JAPANESE_FONT_STACK,
    bottom ? 64 : 58,
    34,
    maxWidth,
  );
  context.font = `800 ${headlineSize}px ${JAPANESE_FONT_STACK}`;
  context.fillText(creative.headline, x, bottom ? 322 : 172, maxWidth);
  context.fillStyle = creative.accent;
  context.font = `700 ${creative.language === "bilingual" ? 22 : 27}px ${JAPANESE_FONT_STACK}`;
  context.fillText(creative.subline, x, bottom ? 382 : 244, maxWidth);
  context.fillRect(
    x - Math.min(maxWidth * 0.32, 150),
    bottom ? 264 : 292,
    Math.min(maxWidth * 0.64, 300),
    7,
  );
  context.shadowColor = "transparent";
  texture.update();
  orientTextureForPositiveZBoxFace(texture);
  return texture;
}

function makeArtMaterial(
  scene: Scene,
  creative: TokyoAdCreative,
  atlasTexture: Texture,
): StandardMaterial {
  const crop = tokyoAdAtlasUv(creative.artIndex, creative.artAtlas);
  const texture = atlasTexture.clone();
  texture.name = `tokyo-ad-art-${creative.id}-texture`;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.uOffset = crop.uOffset;
  texture.uScale = crop.uScale;
  texture.vOffset = crop.vOffset;
  texture.vScale = crop.vScale;
  orientTextureForPositiveZBoxFace(texture);
  const material = luminousTextureMaterial(
    scene,
    `tokyo-ad-art-${creative.id}`,
    texture,
    1.55,
  );
  material.specularColor = new Color3(0.92, 0.96, 1);
  material.specularPower = 224;
  return material;
}

function makeBladeTexture(
  scene: Scene,
  tenant: TokyoTenantCreative,
): DynamicTexture {
  const texture = new DynamicTexture(
    `tokyo-tenant-blade-${tenant.id}-texture`,
    { width: 256, height: 512 },
    scene,
    true,
  );
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = tenant.background;
  context.fillRect(0, 0, 256, 512);
  context.strokeStyle = tenant.accent;
  context.lineWidth = 13;
  context.strokeRect(9, 9, 238, 494);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = tenant.foreground;
  context.shadowColor = "rgba(0,0,0,0.22)";
  context.shadowBlur = 4;
  const characters = Array.from(tenant.name.replace(/[・]/g, ""));
  const rows = Math.min(6, characters.length);
  const columns = Math.ceil(characters.length / rows);
  const size = columns > 1 ? 48 : 58;
  context.font = `800 ${size}px ${JAPANESE_FONT_STACK}`;
  const xStart = columns === 1 ? 128 : 164;
  for (const [index, character] of characters.entries()) {
    const column = Math.floor(index / rows);
    const row = index % rows;
    context.fillText(character, xStart - column * 72, 58 + row * 61);
  }
  context.fillStyle = tenant.accent;
  context.fillRect(31, 424, 194, 7);
  context.font = `700 24px ${JAPANESE_FONT_STACK}`;
  context.fillText(tenant.detail, 128, 468, 210);
  context.shadowColor = "transparent";
  texture.update();
  orientTextureForPositiveZBoxFace(texture);
  return texture;
}

function makeFasciaTexture(
  scene: Scene,
  tenant: TokyoTenantCreative,
): DynamicTexture {
  const texture = new DynamicTexture(
    `tokyo-tenant-fascia-${tenant.id}-texture`,
    { width: 512, height: 128 },
    scene,
    true,
  );
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = tenant.background;
  context.fillRect(0, 0, 512, 128);
  context.fillStyle = tenant.accent;
  context.fillRect(0, 0, 18, 128);
  context.fillRect(494, 0, 18, 128);
  context.textBaseline = "middle";
  context.fillStyle = tenant.foreground;
  context.textAlign = "left";
  const nameSize = fitFont(
    context,
    tenant.name,
    JAPANESE_FONT_STACK,
    55,
    35,
    325,
  );
  context.font = `800 ${nameSize}px ${JAPANESE_FONT_STACK}`;
  context.fillText(tenant.name, 35, 64, 325);
  context.textAlign = "right";
  context.font = `700 23px ${JAPANESE_FONT_STACK}`;
  context.fillText(tenant.detail, 478, 67, 145);
  texture.update();
  orientTextureForPositiveZBoxFace(texture);
  return texture;
}

function makeDirectoryTexture(scene: Scene, variant: number): DynamicTexture {
  const texture = new DynamicTexture(
    `tokyo-tenant-directory-${variant}-texture`,
    { width: 256, height: 512 },
    scene,
    true,
  );
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = "#0b1020";
  context.fillRect(0, 0, 256, 512);
  const floorLabels = ["6F", "5F", "4F", "3F", "2F", "1F", "B1"];
  for (let row = 0; row < 6; row += 1) {
    const tenant =
      TOKYO_TENANT_CREATIVES[
        (variant * 3 + row * 5) % TOKYO_TENANT_CREATIVES.length
      ];
    const top = 10 + row * 82;
    context.fillStyle = tenant.background;
    context.fillRect(10, top, 236, 73);
    context.fillStyle = tenant.accent;
    context.fillRect(10, top, 42, 73);
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillStyle = tenant.foreground;
    context.font = `800 25px ${JAPANESE_FONT_STACK}`;
    context.fillText(tenant.name, 148, top + 30, 180);
    context.font = `700 15px ${JAPANESE_FONT_STACK}`;
    context.fillText(tenant.detail, 148, top + 55, 178);
    context.fillStyle = row % 2 === 0 ? "#ffffff" : "#18213a";
    context.font = `800 18px ${JAPANESE_FONT_STACK}`;
    context.fillText(
      floorLabels[(row + variant) % floorLabels.length],
      31,
      top + 37,
    );
  }
  texture.update();
  orientTextureForPositiveZBoxFace(texture);
  return texture;
}

function createMaterials(scene: Scene): TokyoAdMaterials {
  const frame = new StandardMaterial("tokyo-ad-frame", scene);
  frame.diffuseColor = new Color3(0.025, 0.03, 0.045);
  frame.specularColor = new Color3(0.85, 0.9, 1);
  frame.specularPower = 192;
  const support = new StandardMaterial("tokyo-ad-support", scene);
  support.diffuseColor = new Color3(0.11, 0.13, 0.16);
  support.specularColor = new Color3(0.55, 0.6, 0.68);
  support.specularPower = 96;
  const atlasTextures = Object.fromEntries(
    (Object.entries(ATLAS_URLS) as [TokyoAdAtlasId, string][]).map(
      ([atlasId, url]) => [
        atlasId,
        new Texture(url, scene, true, true, Texture.TRILINEAR_SAMPLINGMODE),
      ],
    ),
  ) as Record<TokyoAdAtlasId, Texture>;
  const art = TOKYO_AD_CREATIVES.map((creative) =>
    makeArtMaterial(scene, creative, atlasTextures[creative.artAtlas]),
  );
  const copy = TOKYO_AD_CREATIVES.map((creative) =>
    luminousTextureMaterial(
      scene,
      `tokyo-ad-copy-${creative.id}`,
      creative.artAtlas === "portrait"
        ? portraitCopyTexture(scene, creative)
        : landscapeCopyTexture(scene, creative),
      1.75,
      true,
    ),
  );
  const blade = TOKYO_TENANT_CREATIVES.map((tenant) =>
    luminousTextureMaterial(
      scene,
      `tokyo-tenant-blade-${tenant.id}`,
      makeBladeTexture(scene, tenant),
      1.42,
    ),
  );
  const fascia = TOKYO_TENANT_CREATIVES.map((tenant) =>
    luminousTextureMaterial(
      scene,
      `tokyo-tenant-fascia-${tenant.id}`,
      makeFasciaTexture(scene, tenant),
      1.34,
    ),
  );
  const directory = Array.from({ length: DIRECTORY_COUNT }, (_, variant) =>
    luminousTextureMaterial(
      scene,
      `tokyo-tenant-directory-${variant}`,
      makeDirectoryTexture(scene, variant),
      1.45,
    ),
  );
  return { frame, support, art, copy, blade, fascia, directory };
}

function mergeMaster(scene: Scene, name: string, meshes: Mesh[]): Mesh {
  const target = new Mesh(name, scene);
  const merged = Mesh.MergeMeshes(meshes, true, true, target, false, true);
  if (!merged) {
    target.dispose();
    throw new Error(`Failed to assemble Tokyo sign master ${name}.`);
  }
  merged.isVisible = false;
  merged.isPickable = false;
  return merged;
}

function makeCampaignMaster(
  scene: Scene,
  creativeIndex: number,
  materials: TokyoAdMaterials,
): Mesh {
  const creative = TOKYO_AD_CREATIVES[creativeIndex];
  const portrait = creative.artAtlas === "portrait";
  const widthM = portrait ? 2 : 16;
  const heightM = portrait ? 3 : 9;
  const depthM = 0.18;
  const housing = createBox(
    scene,
    `tokyo-ad-master-${creative.id}-housing-source`,
    { width: widthM + 0.08, height: heightM + 0.08, depth: depthM },
    Vector3.Zero(),
    materials.frame,
  );
  const art = createBox(
    scene,
    `tokyo-ad-master-${creative.id}-art-source`,
    { width: widthM, height: heightM, depth: 0.025 },
    new Vector3(0, 0, depthM / 2 + 0.014),
    materials.art[creativeIndex],
  );
  const copy = createBox(
    scene,
    `tokyo-ad-master-${creative.id}-copy-source`,
    { width: widthM - 0.02, height: heightM - 0.02, depth: 0.012 },
    new Vector3(0, 0, depthM / 2 + 0.035),
    materials.copy[creativeIndex],
  );
  return mergeMaster(
    scene,
    `prop-master-tokyo-ad-${creative.id}`,
    [housing, art, copy],
  );
}

function tenantBaseSize(kind: TokyoTenantPlacementKind): {
  readonly widthM: number;
  readonly heightM: number;
} {
  if (kind === "blade-kanban") return { widthM: 1, heightM: 3.5 };
  if (kind === "tenant-directory") return { widthM: 1, heightM: 4 };
  return { widthM: 4, heightM: 1 };
}

function makeTenantMaster(
  scene: Scene,
  name: string,
  kind: TokyoTenantPlacementKind,
  faceMaterial: StandardMaterial,
  frameMaterial: StandardMaterial,
): Mesh {
  const size = tenantBaseSize(kind);
  const depthM = kind === "storefront-fascia" ? 0.12 : 0.16;
  const housing = createBox(
    scene,
    `${name}-housing-source`,
    {
      width: size.widthM + 0.06,
      height: size.heightM + 0.06,
      depth: depthM,
    },
    Vector3.Zero(),
    frameMaterial,
  );
  const front = createBox(
    scene,
    `${name}-front-source`,
    { width: size.widthM, height: size.heightM, depth: 0.018 },
    new Vector3(0, 0, depthM / 2 + 0.012),
    faceMaterial,
  );
  const meshes = [housing, front];
  if (kind !== "storefront-fascia") {
    const back = createBox(
      scene,
      `${name}-back-source`,
      { width: size.widthM, height: size.heightM, depth: 0.018 },
      new Vector3(0, 0, -depthM / 2 - 0.012),
      faceMaterial,
    );
    back.rotation.y = Math.PI;
    meshes.push(back);
  }
  return mergeMaster(scene, name, meshes);
}

function createTenantMasters(
  scene: Scene,
  materials: TokyoAdMaterials,
): TenantMasters {
  return {
    blade: TOKYO_TENANT_CREATIVES.map((tenant, index) =>
      makeTenantMaster(
        scene,
        `prop-master-tokyo-tenant-blade-${tenant.id}`,
        "blade-kanban",
        materials.blade[index],
        materials.frame,
      ),
    ),
    fascia: TOKYO_TENANT_CREATIVES.map((tenant, index) =>
      makeTenantMaster(
        scene,
        `prop-master-tokyo-tenant-fascia-${tenant.id}`,
        "storefront-fascia",
        materials.fascia[index],
        materials.frame,
      ),
    ),
    directory: Array.from({ length: DIRECTORY_COUNT }, (_, variant) =>
      makeTenantMaster(
        scene,
        `prop-master-tokyo-tenant-directory-${variant}`,
        "tenant-directory",
        materials.directory[variant],
        materials.frame,
      ),
    ),
  };
}

function instantiateCampaign(
  ctx: TokyoAdvertisingCtx,
  placement: TokyoAdPlacement,
  index: number,
  masters: readonly Mesh[],
  supportMaterial: StandardMaterial,
): void {
  const creative = TOKYO_AD_CREATIVES[placement.creativeIndex];
  const portrait = creative.artAtlas === "portrait";
  const sourceWidthM = portrait ? 2 : 16;
  const sourceHeightM = portrait ? 3 : 9;
  const instance = masters[placement.creativeIndex].createInstance(
    `prop-tokyo-ad-${index}-${placement.kind}-${creative.id}`,
  );
  instance.position.set(
    placement.position.x,
    placement.centerYM,
    placement.position.z,
  );
  instance.rotation.y = placement.headingDeg * Math.PI / 180;
  instance.scaling.set(
    placement.widthM / sourceWidthM,
    placement.heightM / sourceHeightM,
    1,
  );
  instance.isPickable = false;
  ctx.staticSceneryFreeze.push(instance);

  if (placement.kind !== "rooftop-screen") return;
  const yaw = instance.rotation.y;
  const localX = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const roofY = placement.centerYM - placement.heightM / 2 - 0.8;
  for (const side of [-1, 1] as const) {
    const post = createBox(
      ctx.scene,
      `${instance.name}-roof-post-${side}`,
      { width: 0.16, height: 1.6, depth: 0.16 },
      new Vector3(
        placement.position.x + localX.x * placement.widthM * 0.34 * side,
        roofY + 0.8,
        placement.position.z + localX.z * placement.widthM * 0.34 * side,
      ),
      supportMaterial,
    );
    post.rotation.y = yaw;
    post.isPickable = false;
    ctx.staticSceneryFreeze.push(post);
  }
}

function instantiateTenant(
  ctx: TokyoAdvertisingCtx,
  placement: TokyoTenantPlacement,
  index: number,
  masters: TenantMasters,
): void {
  const master =
    placement.kind === "blade-kanban"
      ? masters.blade[placement.tenantIndex]
      : placement.kind === "storefront-fascia"
        ? masters.fascia[placement.tenantIndex]
        : masters.directory[placement.directoryVariant];
  const base = tenantBaseSize(placement.kind);
  const tenant = TOKYO_TENANT_CREATIVES[placement.tenantIndex];
  const instance = master.createInstance(
    `prop-tokyo-tenant-${index}-${placement.kind}-${tenant.id}`,
  );
  instance.position.set(
    placement.position.x,
    placement.centerYM,
    placement.position.z,
  );
  instance.rotation.y = placement.headingDeg * Math.PI / 180;
  instance.scaling.set(
    placement.widthM / base.widthM,
    placement.heightM / base.heightM,
    1,
  );
  instance.isPickable = false;
  ctx.staticSceneryFreeze.push(instance);
}

/** Builds Tokyo's layered campaign screens, tenant blades and directory towers. */
export function buildTokyoAdvertising(
  ctx: TokyoAdvertisingCtx,
  mapPack: GameCanvasMapPack,
): void {
  const plan = tokyoAdvertisingPlan(mapPack, ctx.buildingLayout);
  if (!plan.campaigns.length && !plan.tenantSigns.length) return;
  const materials = createMaterials(ctx.scene);
  const campaignMasters = TOKYO_AD_CREATIVES.map((_, index) =>
    makeCampaignMaster(ctx.scene, index, materials),
  );
  const tenantMasters = createTenantMasters(ctx.scene, materials);
  for (const [index, placement] of plan.campaigns.entries()) {
    instantiateCampaign(
      ctx,
      placement,
      index,
      campaignMasters,
      materials.support,
    );
  }
  for (const [index, placement] of plan.tenantSigns.entries()) {
    instantiateTenant(ctx, placement, index, tenantMasters);
  }
  materials.frame.freeze();
  materials.support.freeze();
  for (const material of [
    ...materials.art,
    ...materials.copy,
    ...materials.blade,
    ...materials.fascia,
    ...materials.directory,
  ]) {
    material.freeze();
  }
}
