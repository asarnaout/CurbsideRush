import {
  AbstractMesh,
  Color3,
  Color4,
  type DirectionalLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
} from "@babylonjs/core";
import {
  createHorizonSilhouetteTexture,
  createSkyGradientTexture,
} from "./proceduralTextures";
import {
  resolveCameraFarPlane,
  resolveEffectiveFogRange,
  type MapVisualPalette,
} from "../visuals";
import type { GameCanvasPoint } from "../sessionContract";

/**
 * The sky dome + horizon silhouette ring + fog band, and the sun's PCF shadow
 * generator. De-methodized out of `BabylonGameSession` (Phase 3.1) — each
 * function takes a narrow `ctx` for the session state it reads, and returns
 * the fields the session must assign back onto itself. `registerMirrorSurface`
 * is threaded as a callback rather than inlined against a raw array, since it
 * is itself slated to move into a future mirror-rig collaborator (Phase
 * 3.12) and every extracted builder that calls it should stay agnostic to
 * where it ends up living.
 */

export interface SkyAndHorizonCtx {
  readonly scene: Scene;
  readonly registerMirrorSurface: (mesh: AbstractMesh | undefined | null) => void;
}

export interface SkyAndHorizonResult {
  readonly cameraFarPlaneM: number;
}

/**
 * Camera-following gradient sky dome, distance fog matched to the horizon,
 * and a low-poly skyline ring. Both atmosphere meshes use infiniteDistance
 * so they work identically on every world size; their world matrices are
 * therefore recomputed per frame and must never be frozen.
 */
export function createSkyAndHorizon(
  ctx: SkyAndHorizonCtx,
  palette: MapVisualPalette,
  mapId: string,
  worldSize: GameCanvasPoint,
): SkyAndHorizonResult {
  const scene = ctx.scene;
  const horizon = Color3.FromHexString(palette.skyHorizon);
  scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
  // The night tightening and the palette's own day cap (Cairo's dust haze)
  // live inside resolveEffectiveFogRange so the fog and the camera far
  // plane can never disagree about where the world ends.
  const fogRange = resolveEffectiveFogRange(
    palette.night === true,
    worldSize,
    palette.fogEndCapM,
  );
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = Color3.FromHexString(palette.fogColor);
  scene.fogStart = fogRange.start;
  scene.fogEnd = fogRange.end;
  // Everything past fogEnd is fully fogged, so clipping there culls the
  // rest of the city for free. Stored on the session because the cameras
  // are built after the environment; the constructor applies it to all
  // three. The sky dome and horizon ring follow the camera
  // (infiniteDistance), so their angular look is scale-invariant — shrink
  // them to sit inside the far plane instead of being clipped by it.
  const cameraFarPlaneM = resolveCameraFarPlane(
    palette.night === true,
    worldSize,
    palette.fogEndCapM,
  );
  const domeScale = Math.min(1, (cameraFarPlaneM * 0.98) / 950);

  const skyMaterial = new StandardMaterial("sky-dome-material", scene);
  skyMaterial.emissiveTexture = createSkyGradientTexture(scene, palette);
  skyMaterial.diffuseColor = Color3.Black();
  skyMaterial.specularColor = Color3.Black();
  skyMaterial.disableLighting = true;
  skyMaterial.fogEnabled = false;
  const skyDome = MeshBuilder.CreateSphere(
    "sky-dome",
    {
      diameter: 1900 * domeScale,
      segments: 12,
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  skyDome.material = skyMaterial;
  skyDome.infiniteDistance = true;
  skyDome.isPickable = false;
  skyDome.applyFog = false;
  skyMaterial.freeze();
  ctx.registerMirrorSurface(skyDome);

  const ringMaterial = new StandardMaterial("horizon-ring-material", scene);
  const silhouette = createHorizonSilhouetteTexture(scene, mapId, palette);
  // hasAlpha on the diffuse texture opts into alpha *testing*: crisp
  // silhouette edges with no blend-sorting concerns against the sky dome.
  ringMaterial.diffuseTexture = silhouette;
  ringMaterial.emissiveTexture = silhouette;
  ringMaterial.diffuseColor = Color3.Black();
  ringMaterial.specularColor = Color3.Black();
  ringMaterial.disableLighting = true;
  ringMaterial.fogEnabled = false;
  const ring = MeshBuilder.CreateCylinder(
    "horizon-ring",
    {
      height: 110 * domeScale,
      diameter: 1700 * domeScale,
      tessellation: 48,
      cap: Mesh.NO_CAP,
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  ring.material = ringMaterial;
  ring.position.y = 26 * domeScale;
  ring.infiniteDistance = true;
  ring.isPickable = false;
  ring.applyFog = false;
  ringMaterial.freeze();
  ctx.registerMirrorSurface(ring);

  return { cameraFarPlaneM };
}

export interface SunShadowsCtx {
  readonly visualPalette: MapVisualPalette;
  readonly touchFirst: boolean;
}

export interface SunShadowsResult {
  readonly shadowGenerator: ShadowGenerator;
  readonly shadowRefreshSeconds: number;
}

/**
 * Subtle PCF sun shadows. The render list is rebuilt around the player at
 * a slow cadence so the auto-computed directional frustum stays tight even
 * on the 3 km NYC grid.
 */
export function createSunShadows(
  ctx: SunShadowsCtx,
  sun: DirectionalLight,
): SunShadowsResult {
  sun.diffuse = Color3.FromHexString(ctx.visualPalette.sunTint);
  sun.position = sun.direction.scale(-260);
  sun.autoUpdateExtends = true;
  sun.autoCalcShadowZBounds = true;
  // 1024 (was 2048): the dense city re-renders this shadow map every frame,
  // so quartering its pixels frees real per-frame budget; night shadows are
  // soft + dim enough that the lower resolution isn't noticeable.
  // Percentage-closer filtering is the per-pixel cost here, and on a phone it
  // is paid on every shadowed fragment in a dense city. The softness
  // difference is invisible at a phone's viewing distance.
  const generator = new ShadowGenerator(1024, sun);
  generator.usePercentageCloserFiltering = true;
  generator.filteringQuality = ctx.touchFirst
    ? ShadowGenerator.QUALITY_LOW
    : ShadowGenerator.QUALITY_MEDIUM;
  generator.bias = 0.015;
  generator.normalBias = 0.4;
  generator.setDarkness(0.42);
  return {
    shadowGenerator: generator,
    shadowRefreshSeconds: Number.POSITIVE_INFINITY,
  };
}
