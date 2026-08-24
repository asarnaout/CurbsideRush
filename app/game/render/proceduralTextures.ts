import {
  Color3,
  DynamicTexture,
  type Scene,
  Texture,
  Vector4,
} from "@babylonjs/core";
import { COCKPIT_CLUSTER_TEXTURE, COCKPIT_GAUGE_CENTRES, COCKPIT_GAUGE_RADIUS } from "../cockpitLayout";
import { FACADE_COLS, FACADE_LAYOUT, FACADE_ROWS } from "../geometry/facadesAndKeepouts";
import {
  buildAsphaltTextureSpec,
  buildGrassDetailSpec,
  buildGrassTextureSpec,
  buildHorizonSilhouetteSpec,
  type AsphaltTextureProfile,
  type GrassBlade,
  hashStringToSeed,
  type MapVisualPalette,
  mixHexColors,
  type RiverWave,
  sampleRiverWaveField,
  seededUnit,
  skyGradientStops,
} from "../visuals";

/**
 * Procedural `DynamicTexture` factories: sky gradient, horizon silhouette,
 * asphalt, river surface/ripple, grass/flowerbed/grass-detail, the cockpit
 * instrument cluster face, the Cairo direction-panel face UVs, and the
 * building-facade window textures.
 *
 * All Babylon-owning (draws on a 2D canvas context, one raster per call —
 * see each factory's own header for why nothing here repaints per frame).
 * `textureContext` is duplicated from GameCanvas.tsx rather than shared with
 * it, and `makeMaterial`/`setMeshMaterial` stay in GameCanvas.tsx untouched —
 * neither is called by anything in this file, despite sitting beside this
 * cluster in the original source. The eleven `RIVER_*` tuning constants also
 * stay behind: they belong to the not-yet-extracted water-building code
 * (Phase 3.6), which resolves them into the `tones`/`waves` parameters the
 * river texture factories below actually take. `textureContext` is exported
 * for sibling render/ files (e.g. roadsideProps.ts) that need the same
 * ad-hoc `DynamicTexture`-drawing pattern — an ordinary same-ring import.
 */

export function textureContext(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D;
}

/**
 * Cairo's bilingual direction panel is printed on one side only, like the real
 * thing — the back of a road sign is bare aluminium.
 *
 * This has to be done per face, not on the material. Rotating the whole texture
 * 180° does land the legend upright on the road-facing face, but Babylon's two
 * broad box faces already differ by 180°, so the same transform lands the
 * legend on the *back* upside down — which is exactly what it used to do.
 *
 * So: the design occupies the top half of the canvas and the bottom half stays
 * aluminium; face 0 (+Z, the road-facing side under the face-road yaw
 * convention) takes the design pre-swapped, and the other five sample a small
 * patch well inside the aluminium half, far enough from the boundary that
 * mipmap bleed cannot drag the legend onto an edge.
 */
export const CAIRO_DIRECTION_PANEL_DESIGN_V = 0.5;

export function cairoDirectionPanelFaceUv(): readonly Vector4[] {
  // Swapped min/max corner = the region applied 180° round, cancelling the
  // rotation Babylon's +Z face applies. See the regulatory blade's `swapped`.
  const printed = new Vector4(1, 1, 0, CAIRO_DIRECTION_PANEL_DESIGN_V);
  const bare = new Vector4(0.4, 0.1, 0.6, 0.3);
  return [printed, bare, bare, bare, bare, bare];
}

/**
 * The instrument cluster's faceplate, drawn once.
 *
 * Everything on it is static: the dial rings, their ticks, the centre readout
 * bars. The two things that actually move are needles, and they are meshes that
 * rotate — nothing in this game repaints a DynamicTexture per frame and this is
 * not the place to start. A 512x160 re-raster plus upload every frame would cost
 * more than the whole rest of the cockpit put together, to animate two lines.
 *
 * Ring colours are the reference's: teal for road speed, amber for revs.
 */
export function makeInstrumentClusterTexture(scene: Scene): DynamicTexture {
  const { width, height } = COCKPIT_CLUSTER_TEXTURE;
  const texture = new DynamicTexture(
    "instrument-cluster-face",
    { width, height },
    scene,
    true,
  );
  const context = textureContext(texture);
  context.fillStyle = "#080b0d";
  context.fillRect(0, 0, width, height);

  const centreY = height / 2;
  const radius = height * COCKPIT_GAUGE_RADIUS;
  const sweepStart = (135 * Math.PI) / 180;
  const sweepEnd = (405 * Math.PI) / 180;

  COCKPIT_GAUGE_CENTRES.forEach((centre, index) => {
    const centreX = centre * width;
    const accent = index === 0 ? "#3fd8c4" : "#f2a02a";

    context.fillStyle = "#0d1417";
    context.beginPath();
    context.arc(centreX, centreY, radius * 0.92, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = accent;
    context.lineWidth = 4;
    context.setLineDash([7, 6]);
    context.beginPath();
    context.arc(centreX, centreY, radius, sweepStart, sweepEnd);
    context.stroke();
    context.setLineDash([]);

    // A finer ring of ticks inside the accent, every 13.5 degrees of the sweep.
    context.strokeStyle = "rgba(206, 216, 220, 0.55)";
    context.lineWidth = 2;
    for (let tick = 0; tick <= 20; tick += 1) {
      const angle = sweepStart + ((sweepEnd - sweepStart) * tick) / 20;
      const long = tick % 5 === 0;
      const inner = radius * (long ? 0.62 : 0.72);
      const outer = radius * 0.8;
      context.beginPath();
      context.moveTo(
        centreX + Math.cos(angle) * inner,
        centreY + Math.sin(angle) * inner,
      );
      context.lineTo(
        centreX + Math.cos(angle) * outer,
        centreY + Math.sin(angle) * outer,
      );
      context.stroke();
    }
  });

  // The centre stack: a gear/readout block between the dials.
  context.fillStyle = "#3fd8c4";
  for (const offset of [-20, 0, 20]) {
    context.fillRect(width / 2 - 21, centreY + offset - 2, 42, 4);
  }

  texture.update(false);
  return texture;
}

export function createSkyGradientTexture(
  scene: Scene,
  palette: MapVisualPalette,
): DynamicTexture {
  const height = 256;
  const texture = new DynamicTexture(
    "sky-gradient",
    { width: 4, height },
    scene,
    false,
  );
  const context = textureContext(texture);
  // Canvas bottom samples the dome's top pole (v=0 after the flipped upload),
  // so the zenith stop is anchored at the bottom row.
  const gradient = context.createLinearGradient(0, height, 0, 0);
  for (const stop of skyGradientStops(palette)) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, height);
  texture.update();
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

export function createHorizonSilhouetteTexture(
  scene: Scene,
  mapId: string,
  palette: MapVisualPalette,
): DynamicTexture {
  const width = 2048;
  const height = 256;
  const texture = new DynamicTexture(
    "horizon-silhouette",
    { width, height },
    scene,
    true,
  );
  texture.hasAlpha = true;
  const context = textureContext(texture);
  context.clearRect(0, 0, width, height);

  const shapes = buildHorizonSilhouetteSpec(mapId, hashStringToSeed(mapId));
  // Keep the shared terrain band shallow: a tall band reads as a wall around
  // the map instead of a distant skyline.
  const baseBandHeight = height * 0.1;
  const usableHeight = height - baseBandHeight;

  const drawShape = (
    shape: (typeof shapes)[number],
    offsetX: number,
  ): void => {
    const centerX = (shape.x + offsetX) * width;
    const shapeWidth = Math.max(2, shape.w * width);
    const top = height - baseBandHeight - shape.h * usableHeight;
    if (shape.kind === "box") {
      context.fillRect(centerX - shapeWidth / 2, top, shapeWidth, height - top);
      return;
    }
    if (shape.kind === "spike") {
      context.beginPath();
      context.moveTo(centerX - shapeWidth / 2, height);
      context.lineTo(centerX, top);
      context.lineTo(centerX + shapeWidth / 2, height);
      context.closePath();
      context.fill();
      return;
    }
    if (shape.kind === "pylon") {
      const mastWidth = Math.max(2, shapeWidth * 0.3);
      context.fillRect(centerX - mastWidth / 2, top, mastWidth, height - top);
      const armWidth = shapeWidth * 4;
      const armHeight = Math.max(2, height * 0.012);
      context.fillRect(centerX - armWidth / 2, top + usableHeight * 0.08, armWidth, armHeight);
      context.fillRect(
        centerX - armWidth * 0.375,
        top + usableHeight * 0.2,
        armWidth * 0.75,
        armHeight,
      );
      return;
    }
    const radiusX = Math.max(3, shapeWidth / 2);
    context.beginPath();
    context.ellipse(
      centerX,
      height - baseBandHeight,
      radiusX,
      Math.max(2, shape.h * usableHeight),
      0,
      Math.PI,
      Math.PI * 2,
    );
    context.closePath();
    context.fill();
    context.fillRect(
      centerX - radiusX,
      height - baseBandHeight,
      radiusX * 2,
      baseBandHeight,
    );
  };

  // A continuous distant-terrain band keeps the ring base seamless where the
  // fogged ground meets the sky, with skyline shapes rising above it.
  context.fillStyle = palette.silhouetteFar;
  context.fillRect(0, height - baseBandHeight, width, baseBandHeight);
  for (const layer of [1, 0] as const) {
    context.fillStyle =
      layer === 1 ? palette.silhouetteFar : palette.silhouetteNear;
    for (const shape of shapes) {
      if (shape.layer !== layer) continue;
      // Draw wrapped copies so shapes crossing the seam stay continuous.
      drawShape(shape, -1);
      drawShape(shape, 0);
      drawShape(shape, 1);
    }
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function applyLuminanceNoise(
  context: CanvasRenderingContext2D,
  size: number,
  seed: number,
  amplitude: number,
): void {
  const image = context.getImageData(0, 0, size, size);
  const random = seededUnit(seed);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const factor = 1 + (random() - 0.5) * 2 * amplitude;
    data[index] = Math.min(255, Math.max(0, data[index] * factor));
    data[index + 1] = Math.min(255, Math.max(0, data[index + 1] * factor));
    data[index + 2] = Math.min(255, Math.max(0, data[index + 2] * factor));
  }
  context.putImageData(image, 0, 0);
}

export function createAsphaltTexture(
  scene: Scene,
  name: string,
  baseColorHex: string,
  seed: number,
  profile?: AsphaltTextureProfile,
): DynamicTexture {
  const size = 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  context.fillStyle = baseColorHex;
  context.fillRect(0, 0, size, size);

  const spec = buildAsphaltTextureSpec(seed, profile);
  applyLuminanceNoise(
    context,
    size,
    spec.noiseSeed,
    profile?.noiseAmplitude ?? 0.03,
  );
  if (profile?.paverGrid) {
    context.strokeStyle = "rgba(35, 29, 23, 0.22)";
    context.lineWidth = 1;
    const step = 12;
    for (let y = 0; y <= size; y += step) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
      const offset = (Math.floor(y / step) % 2) * (step / 2);
      for (let x = offset; x <= size; x += step) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, Math.min(size, y + step));
        context.stroke();
      }
    }
  }
  for (const patch of spec.patches) {
    context.fillStyle =
      patch.lighten >= 0
        ? "rgba(255, 255, 255, 1)"
        : "rgba(0, 0, 0, 1)";
    context.globalAlpha = Math.abs(patch.lighten);
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }
  for (const repair of spec.repairs) {
    context.globalAlpha = repair.darken;
    context.fillStyle = "rgba(0, 0, 0, 1)";
    const centreX = repair.x * size;
    const centreY = repair.y * size;
    const halfWidth = (repair.width * size) / 2;
    const halfHeight = (repair.height * size) / 2;
    const cos = Math.cos(repair.rotation);
    const sin = Math.sin(repair.rotation);
    const corners = [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ] as const;
    context.beginPath();
    for (const [cornerIndex, [x, y]] of corners.entries()) {
      const rotatedX = centreX + x * cos - y * sin;
      const rotatedY = centreY + x * sin + y * cos;
      if (cornerIndex === 0) context.moveTo(rotatedX, rotatedY);
      else context.lineTo(rotatedX, rotatedY);
    }
    context.closePath();
    context.fill();
  }
  context.fillStyle = "rgba(190, 164, 116, 1)";
  for (const speck of spec.dust) {
    context.globalAlpha = speck.alpha;
    context.beginPath();
    context.arc(
      speck.x * size,
      speck.y * size,
      speck.radius * size,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
  context.strokeStyle = `rgba(0, 0, 0, ${profile?.crackAlpha ?? 0.14})`;
  context.lineWidth = profile?.crackWidthPx ?? 2;
  context.lineJoin = "round";
  for (const crack of spec.cracks) {
    context.beginPath();
    for (const [pointIndex, point] of crack.points.entries()) {
      // Cracks that wrap the tile edge would draw a long straight artefact;
      // break the stroke on large jumps instead.
      const previous = crack.points[pointIndex - 1];
      if (
        pointIndex === 0 ||
        (previous &&
          (Math.abs(point.x - previous.x) > 0.5 ||
            Math.abs(point.y - previous.y) > 0.5))
      ) {
        context.moveTo(point.x * size, point.y * size);
        continue;
      }
      context.lineTo(point.x * size, point.y * size);
    }
    context.stroke();
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The river's diffuse tile: the wave field painted as a trough-to-crest ramp.
 *
 * The two halves of the ramp are deliberately asymmetric. Troughs spread into
 * broad soft areas of the deep tone while crests stay thin and bright, because
 * on real water the sky only reaches the eye off the top of a wave — a
 * symmetric ramp paints a quilt of equal light and dark blobs, which reads as
 * marble.
 */
export function createRiverSurfaceTexture(
  scene: Scene,
  name: string,
  waves: readonly RiverWave[],
  tones: { readonly deep: Color3; readonly base: Color3; readonly crest: Color3 },
  size: number,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const field = sampleRiverWaveField(waves, size);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let index = 0; index < field.length; index += 1) {
    const height = field[index];
    const toward = height >= 0 ? tones.crest : tones.deep;
    const amount =
      height >= 0 ? Math.pow(height, 1.7) : Math.pow(-height, 0.75);
    const offset = index * 4;
    data[offset] = (tones.base.r + (toward.r - tones.base.r) * amount) * 255;
    data[offset + 1] =
      (tones.base.g + (toward.g - tones.base.g) * amount) * 255;
    data[offset + 2] =
      (tones.base.b + (toward.b - tones.base.b) * amount) * 255;
    data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The river's normal map, from the gradient of the same kind of wave field.
 *
 * The grass tile argues against normal-mapping flat ground, and it is right:
 * under a fixed sun a static normal map on a plane reads as grain, not relief.
 * Water is the exception precisely because this one *moves* — the highlights
 * crawling across the surface are the whole point, and they are what carries
 * the river at close range where the diffuse tile has gone soft.
 */
export function createRiverRippleTexture(
  scene: Scene,
  name: string,
  waves: readonly RiverWave[],
  size: number,
  steepness: number,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const field = sampleRiverWaveField(waves, size);
  const image = context.createImageData(size, size);
  const data = image.data;
  // Central differences, wrapped — the tile repeats, so its edges have real
  // neighbours and clamping there would ring a seam into the highlights.
  const gradient = (steepness * size) / 2;
  for (let v = 0; v < size; v += 1) {
    const row = v * size;
    const rowUp = ((v + size - 1) % size) * size;
    const rowDown = ((v + 1) % size) * size;
    for (let u = 0; u < size; u += 1) {
      const left = field[row + ((u + size - 1) % size)];
      const right = field[row + ((u + 1) % size)];
      const x = -(right - left) * gradient;
      const y = -(field[rowDown + u] - field[rowUp + u]) * gradient;
      const inverse = 1 / Math.hypot(x, y, 1);
      const offset = (row + u) * 4;
      data[offset] = (x * inverse * 0.5 + 0.5) * 255;
      data[offset + 1] = (y * inverse * 0.5 + 0.5) * 255;
      data[offset + 2] = (inverse * 0.5 + 0.5) * 255;
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The four-tone blade ramp, lightest first. `paintGrassBlades` draws a blade in
 * `ramp[tone]` and its tip in `ramp[tone - 1]`, so a tone-0 blade tips into
 * pure `grassAlt`. Derived rather than authored so a palette only has to supply
 * the three greens.
 */
function grassBladeRamp(palette: MapVisualPalette): readonly string[] {
  // A deliberately tight ramp. Running the ends out to white and to the full
  // `grassDeep` made individual strokes legible as strokes — the lawn read as
  // scattered pine needles rather than as turf. Grass is a texture, not a set
  // of drawn objects, so the contrast has to sit below the threshold where the
  // eye starts counting marks.
  return [
    mixHexColors(palette.grassAlt, "#ffffff", 0.1),
    palette.grassAlt,
    palette.grassBase,
    mixHexColors(palette.grassBase, palette.grassDeep, 0.55),
  ];
}

/**
 * Strokes a blade field onto a canvas. Each blade is drawn twice — full length
 * in its own tone, then its top 45% one ramp step lighter — which is what gives
 * a flat ground plane its light-from-above read without a normal map.
 */
function paintGrassBlades(
  context: CanvasRenderingContext2D,
  size: number,
  blades: readonly GrassBlade[],
  ramp: readonly string[],
  alpha: number,
): void {
  context.lineCap = "round";
  context.globalAlpha = alpha;
  for (const blade of blades) {
    const x = blade.x * size;
    const y = blade.y * size;
    const dx = Math.sin(blade.angle) * blade.length * size;
    const dy = -Math.cos(blade.angle) * blade.length * size;
    context.lineWidth = Math.max(0.7, blade.width * size);
    context.strokeStyle = ramp[blade.tone] ?? ramp[ramp.length - 1];
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
    context.stroke();
    // The lit tip. Tone 0 is already the lightest, so it tips into itself.
    context.strokeStyle = ramp[Math.max(0, blade.tone - 1)];
    context.beginPath();
    context.moveTo(x + dx * 0.55, y + dy * 0.55);
    context.lineTo(x + dx, y + dy);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/**
 * The base grass tile. 1024² on desktop so blades survive a mip level or two at
 * the 12 m tile GRASS_TILE_M sets; 512² on weak devices, where the render scale
 * would throw the detail away anyway.
 *
 * Note there is no `applyLuminanceNoise` pass here any more. It was a full
 * 1M-pixel getImageData/putImageData round trip whose entire job — high
 * frequency — the blade field now does far better, and in colour.
 */
export function createGrassTexture(
  scene: Scene,
  name: string,
  palette: MapVisualPalette,
  seed: number,
  highDetail: boolean,
): DynamicTexture {
  const size = highDetail ? 1024 : 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const spec = buildGrassTextureSpec(seed);
  const ramp = grassBladeRamp(palette);

  context.fillStyle = palette.grassBase;
  context.fillRect(0, 0, size, size);

  // Large tonal fields first — the layer that still reads once blades have
  // mipped away at distance.
  const patchTones = [palette.grassDeep, palette.grassAlt, palette.grassDry];
  context.globalAlpha = 0.2;
  for (const patch of spec.patches) {
    context.fillStyle = patchTones[patch.tone] ?? palette.grassBase;
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  // Kept low on purpose: these are hard-edged discs, and any higher they read
  // as circles drawn on the lawn rather than as mottling under it.
  context.globalAlpha = 0.22;
  context.fillStyle = palette.grassAlt;
  for (const blob of spec.blobs) {
    if (!blob.alt) continue;
    context.beginPath();
    context.arc(blob.x * size, blob.y * size, blob.r * size, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.3;
  context.fillStyle = palette.grassDry;
  for (const patch of spec.bare) {
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.3;
  context.fillStyle = palette.dirtShoulder;
  for (const speckle of spec.speckles) {
    context.beginPath();
    context.arc(speckle.x * size, speckle.y * size, size / 232, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  paintGrassBlades(context, size, spec.blades, ramp, 0.7);

  // Flora last, so a flower head sits on top of the blades rather than under.
  // Pulled most of the way back toward the grass: at full accent these are
  // 4-6 px on the tile, which at driving distance reads as white litter
  // scattered over the lawn rather than as flowers.
  context.fillStyle = mixHexColors(palette.grassAlt, palette.floraAccent, 0.55);
  context.globalAlpha = 0.45;
  for (const flower of spec.flora) {
    context.beginPath();
    context.arc(flower.x * size, flower.y * size, flower.r * size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * A parterre bed's groundcover, one tile.
 *
 * Deliberately NOT the lawn texture: a bed is planted colour — darker foliage
 * carrying flower heads at full strength, where the lawn pulls its flora most
 * of the way back so it reads as chance. Shares the lawn's spec so the drift
 * pattern is the same species of noise, just dressed differently.
 */
export function createFlowerbedTexture(
  scene: Scene,
  name: string,
  palette: MapVisualPalette,
  seed: number,
): DynamicTexture {
  const size = 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const spec = buildGrassTextureSpec(seed);

  context.fillStyle = mixHexColors(palette.grassDeep, palette.dirtShoulder, 0.25);
  context.fillRect(0, 0, size, size);

  // Foliage mottling — the lawn's discs, denser and darker.
  context.globalAlpha = 0.2;
  context.fillStyle = palette.grassAlt;
  for (const blob of spec.blobs) {
    context.beginPath();
    context.arc(blob.x * size, blob.y * size, blob.r * size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 0.25;
  context.fillStyle = palette.grassDeep;
  for (const patch of spec.patches) {
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  // Flower heads, two tones so the drift reads as planting rather than noise.
  context.globalAlpha = 0.8;
  for (const [index, head] of [...spec.flora, ...spec.speckles].entries()) {
    context.fillStyle =
      index % 2 === 0
        ? palette.floraAccent
        : mixHexColors(palette.floraAccent, "#ffffff", 0.35);
    context.beginPath();
    context.arc(head.x * size, head.y * size, size / 90, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The detail tile fed to `StandardMaterial.detailMap`.
 *
 * **A detail map is not an image — it is four independent channels, and three
 * of them have a non-zero neutral.** `default.fragment` reads
 * `baseColor.rgb * 2 · mix(0.5, detailColor.r, diffuseBlendLevel)`, so **R
 * neutral is 0.5**; and `bumpFragment` reads the tangent-space normal out of
 * **alpha and green** — `detailNormalRG = detailColor.wy * 2 - 1`, with
 * `B = sqrt(1 - |RG|²)` — so **A and G neutral is also 0.5**.
 *
 * That alpha channel is the trap. A 2D canvas is fully opaque, so A = 1 decodes
 * as normal.x = 1, which forces B to zero: a tangent normal lying flat along
 * the surface, pointing 90° away from the sun. It does not look subtle — it
 * turned Tokyo's grass from (24,68,25) to (3,10,0), i.e. black — and
 * `bumpLevel = 0` cannot rescue it, because the zeroed `.xy` leaves a
 * zero-length vector rather than an upright one.
 *
 * So the blades are painted as greys (carrying R) and a final pass overwrites
 * G and A with 128, which is the flat normal. Give this a real normal only by
 * authoring those two channels deliberately.
 */
export function createGrassDetailTexture(
  scene: Scene,
  name: string,
  seed: number,
): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  context.fillStyle = "#808080";
  context.fillRect(0, 0, size, size);
  const ramp = ["#a8a8a8", "#949494", "#6e6e6e", "#5a5a5a"];
  paintGrassBlades(context, size, buildGrassDetailSpec(seed), ramp, 0.55);

  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    data[index + 1] = 128; // normal.y neutral
    data[index + 3] = 128; // normal.x neutral — NOT 255, see above
  }
  context.putImageData(image, 0, 0);

  // `update(invertY, premulAlpha)` — premultiply must stay off, or the 0.5
  // alpha just written would halve the red channel the diffuse blend reads.
  texture.update(true, false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

// --- Building facades ------------------------------------------------------
// Boxes get windows from a tiled facade texture: one "tile" is a grid of window
// cells, and each box repeats it via faceUV so window size stays roughly
// constant regardless of building size. The wall colour is baked into a
// per-palette diffuse texture (dark glass + warm lit panes); a single shared
// emissive texture lights the same lit panes so cities glow at dusk.
export const FACADE_WIN_W_M = 3;
export const FACADE_WIN_H_M = 3.2;
const FACADE_TEX_W = 256;
const FACADE_TEX_H = 384;


function facadeColorHex(color: Color3): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function facadeCellMetrics() {
  const cellW = FACADE_TEX_W / FACADE_COLS;
  const cellH = FACADE_TEX_H / FACADE_ROWS;
  const marginX = cellW * 0.24;
  const marginY = cellH * 0.2;
  return { cellW, cellH, marginX, marginY, winW: cellW - marginX * 2, winH: cellH - marginY * 2 };
}

export function makeFacadeEmissiveTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    "facade-emissive",
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(texture);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  const { cellW, cellH, marginX, marginY, winW, winH } = facadeCellMetrics();
  for (const cell of FACADE_LAYOUT) {
    if (!cell.lit) continue;
    ctx.fillStyle = "rgb(255,208,138)";
    ctx.fillRect(cell.col * cellW + marginX, cell.row * cellH + marginY, winW, winH);
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The baladi (informal Cairo) facade pair: red-brick infill held in an
 * exposed concrete skeleton — a column at every window-column boundary and a
 * slab band at every floor line, the unfinished construction grammar most of
 * Cairo actually wears — with smaller, deeper-set windows and a sparse night
 * mix of incandescent amber and fluorescent tube-green rooms. One pair per
 * palette key, shared by every box that key paints, so the entire informal
 * city costs two DynamicTextures per key and zero extra meshes. The lit
 * cells are a SUBSET of `FACADE_LAYOUT`'s (about two-thirds, hash-picked) so
 * the poorer districts read dimmer than downtown without a separate layout.
 */
export function makeBaladiFacadeTextures(
  scene: Scene,
  name: string,
  infill: Color3,
  frame: Color3,
  courses = true,
): { readonly diffuse: DynamicTexture; readonly emissive: DynamicTexture } {
  const { cellW, cellH, marginX, marginY, winW, winH } = facadeCellMetrics();
  const frameW = Math.round(cellW * 0.16);
  const frameH = Math.round(cellH * 0.2);
  const litKind = (col: number, row: number): "warm" | "tube" | null => {
    const cell = FACADE_LAYOUT.find((c) => c.col === col && c.row === row);
    if (!cell?.lit) return null;
    const h = (col * 31 + row * 17) % 9;
    if (h < 4) return null; // nearly half of downtown's lit rooms stay dark here
    return h % 3 === 0 ? "tube" : "warm";
  };
  const WARM = "rgb(244,193,118)";
  const TUBE = "rgb(196,228,192)";

  const diffuse = new DynamicTexture(
    `${name}-diffuse`,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(diffuse);
  ctx.fillStyle = facadeColorHex(infill);
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  // Brick coursing: thin darker lines, slightly varied so the field reads
  // as laid brick rather than flat paint. Skipped for rendered infill —
  // courses on smooth render read as clapboard siding, not masonry.
  if (courses) {
    for (let y = 0; y < FACADE_TEX_H; y += 5) {
      ctx.fillStyle = `rgba(20,10,6,${y % 15 === 0 ? 0.22 : 0.13})`;
      ctx.fillRect(0, y, FACADE_TEX_W, 1);
    }
  }
  // Concrete skeleton: slabs on every floor line, columns on every window
  // column boundary. Drawn after the brick so the frame sits proud of it.
  ctx.fillStyle = facadeColorHex(frame);
  for (let row = 0; row <= FACADE_ROWS; row += 1) {
    ctx.fillRect(0, Math.round(row * cellH - frameH / 2), FACADE_TEX_W, frameH);
  }
  for (let col = 0; col <= FACADE_COLS; col += 1) {
    ctx.fillRect(Math.round(col * cellW - frameW / 2), 0, frameW, FACADE_TEX_H);
  }
  // A faint weathering streak under each slab edge.
  for (let row = 1; row <= FACADE_ROWS; row += 1) {
    ctx.fillStyle = "rgba(30,20,12,0.18)";
    ctx.fillRect(0, Math.round(row * cellH + frameH / 2), FACADE_TEX_W, 2);
  }
  // Windows: markedly smaller than downtown's — baladi rooms have one
  // shuttered opening, not a curtain-wall pane — deep-set dark unless lit.
  const winScaleW = 0.7;
  const winScaleH = 0.76;
  const smallW = winW * winScaleW;
  const smallH = winH * winScaleH;
  for (const cell of FACADE_LAYOUT) {
    const x = cell.col * cellW + marginX + (winW - smallW) / 2;
    const y = cell.row * cellH + marginY + (winH - smallH) / 2;
    const kind = litKind(cell.col, cell.row);
    ctx.fillStyle =
      kind === "warm" ? WARM : kind === "tube" ? TUBE : "#221812";
    ctx.fillRect(x, y, smallW, smallH);
    // lintel shadow so even dark windows read as openings, not paint
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, y, smallW, 2);
  }
  diffuse.update();
  diffuse.wrapU = Texture.WRAP_ADDRESSMODE;
  diffuse.wrapV = Texture.WRAP_ADDRESSMODE;

  const emissive = new DynamicTexture(
    `${name}-emissive`,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ectx = textureContext(emissive);
  ectx.fillStyle = "#000000";
  ectx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  for (const cell of FACADE_LAYOUT) {
    const kind = litKind(cell.col, cell.row);
    if (!kind) continue;
    ectx.fillStyle = kind === "tube" ? TUBE : WARM;
    ectx.fillRect(
      cell.col * cellW + marginX + (winW - smallW) / 2,
      cell.row * cellH + marginY + (winH - smallH) / 2,
      smallW,
      smallH,
    );
  }
  emissive.update();
  emissive.wrapU = Texture.WRAP_ADDRESSMODE;
  emissive.wrapV = Texture.WRAP_ADDRESSMODE;
  return { diffuse, emissive };
}

/**
 * Cairo's rendered apartment blocks: narrower recessed openings, dusty stone
 * surrounds, mismatched shutters, balcony rails, wall-mounted AC boxes and
 * runoff streaks. This deliberately replaces the generic polished window grid
 * only for `cairo-*` procedural materials; the shared facade texture below is
 * still what NYC, London and Tokyo receive.
 */
export function makeCairoFacadeTextures(
  scene: Scene,
  name: string,
  wallColor: Color3,
): { readonly diffuse: DynamicTexture; readonly emissive: DynamicTexture } {
  let seed = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    seed ^= name.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  const cellHash = (col: number, row: number, salt = 0) => {
    let value = seed ^ Math.imul(col + 11, 0x45d9f3b) ^ Math.imul(row + 17, 0x27d4eb2d) ^ salt;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    return value >>> 0;
  };
  const mix = (target: Color3, amount: number) =>
    new Color3(
      wallColor.r + (target.r - wallColor.r) * amount,
      wallColor.g + (target.g - wallColor.g) * amount,
      wallColor.b + (target.b - wallColor.b) * amount,
    );
  const { cellW, cellH } = facadeCellMetrics();
  const windowRect = (col: number, row: number) => {
    const hash = cellHash(col, row);
    const width = cellW * (0.43 + ((hash >>> 4) % 10) / 100);
    const height = cellH * (0.55 + ((hash >>> 9) % 12) / 100);
    return {
      x: col * cellW + (cellW - width) / 2,
      y: row * cellH + (cellH - height) / 2,
      width,
      height,
      hash,
    };
  };
  const lightKind = (hash: number): "warm" | "tube" | null => {
    const choice = hash % 13;
    if (choice < 3) return "warm";
    if (choice === 3) return "tube";
    return null;
  };
  const WARM = "#e5bd78";
  const TUBE = "#bfd6ba";

  const diffuse = new DynamicTexture(
    `${name}-diffuse`,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(diffuse);
  ctx.fillStyle = facadeColorHex(wallColor);
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);

  // Uneven render, slab lines and runoff. They interrupt the perfect beige
  // grid without turning the wall into high-frequency noise at driving speed.
  for (let col = 0; col < FACADE_COLS; col += 1) {
    const hash = cellHash(col, 0, 0x3a91);
    ctx.fillStyle = `rgba(48,38,29,${0.035 + (hash % 5) * 0.012})`;
    const streakX = col * cellW + ((hash >>> 5) % Math.max(1, Math.round(cellW)));
    ctx.fillRect(streakX, 0, 2 + ((hash >>> 10) % 4), FACADE_TEX_H);
  }
  for (let row = 1; row < FACADE_ROWS; row += 1) {
    ctx.fillStyle = "rgba(42,34,27,0.13)";
    ctx.fillRect(0, Math.round(row * cellH), FACADE_TEX_W, 3);
    ctx.fillStyle = "rgba(229,218,194,0.09)";
    ctx.fillRect(0, Math.round(row * cellH) - 2, FACADE_TEX_W, 2);
  }

  for (let row = 0; row < FACADE_ROWS; row += 1) {
    for (let col = 0; col < FACADE_COLS; col += 1) {
      const rect = windowRect(col, row);
      const kind = lightKind(rect.hash);
      const surround =
        rect.hash % 3 === 0
          ? mix(new Color3(0.76, 0.7, 0.6), 0.26)
          : mix(new Color3(0.39, 0.35, 0.3), 0.14);
      ctx.fillStyle = facadeColorHex(surround);
      ctx.fillRect(rect.x - 4, rect.y - 3, rect.width + 8, rect.height + 7);
      ctx.fillStyle = "rgba(20,17,15,0.62)";
      ctx.fillRect(rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2);
      ctx.fillStyle = kind === "warm" ? WARM : kind === "tube" ? TUBE : "#191817";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

      // Aluminium/wood window divisions and the occasional mismatched shutter.
      ctx.fillStyle = rect.hash % 4 === 0 ? "#5b4a3b" : "#5d625f";
      ctx.fillRect(rect.x + rect.width * 0.48, rect.y, 2, rect.height);
      if (rect.hash % 9 === 0) {
        ctx.fillStyle = "rgba(77,57,42,0.86)";
        ctx.fillRect(rect.x, rect.y, rect.width * 0.44, rect.height);
      }

      // Many Cairo flats wear shallow projecting balconies and split AC units;
      // paint their small-scale read into every face while the frontage gets
      // real geometry from ProceduralFacades.
      if (rect.hash % 5 === 0) {
        const railY = rect.y + rect.height + 3;
        ctx.fillStyle = "#363531";
        ctx.fillRect(rect.x - 5, railY, rect.width + 10, 3);
        for (let x = rect.x - 2; x < rect.x + rect.width + 4; x += 7) {
          ctx.fillRect(x, railY - 9, 2, 11);
        }
      }
      if (rect.hash % 4 === 1) {
        const acW = Math.max(9, rect.width * 0.34);
        const acH = Math.max(6, rect.height * 0.15);
        const acX = rect.x + rect.width - acW * 0.55;
        const acY = Math.min(row * cellH + cellH - acH - 2, rect.y + rect.height + 5);
        ctx.fillStyle = "#aaa89e";
        ctx.fillRect(acX, acY, acW, acH);
        ctx.fillStyle = "#555650";
        for (let grille = acX + 3; grille < acX + acW - 2; grille += 4) {
          ctx.fillRect(grille, acY + 2, 1, Math.max(2, acH - 4));
        }
      }
    }
  }
  diffuse.update();
  diffuse.wrapU = Texture.WRAP_ADDRESSMODE;
  diffuse.wrapV = Texture.WRAP_ADDRESSMODE;

  const emissive = new DynamicTexture(
    `${name}-emissive`,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ectx = textureContext(emissive);
  ectx.fillStyle = "#000000";
  ectx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  for (let row = 0; row < FACADE_ROWS; row += 1) {
    for (let col = 0; col < FACADE_COLS; col += 1) {
      const rect = windowRect(col, row);
      const kind = lightKind(rect.hash);
      if (!kind) continue;
      ectx.fillStyle = kind === "tube" ? TUBE : WARM;
      ectx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
  emissive.update();
  emissive.wrapU = Texture.WRAP_ADDRESSMODE;
  emissive.wrapV = Texture.WRAP_ADDRESSMODE;
  return { diffuse, emissive };
}

export function makeFacadeDiffuseTexture(
  scene: Scene,
  name: string,
  wallColor: Color3,
): DynamicTexture {
  const texture = new DynamicTexture(
    name,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(texture);
  ctx.fillStyle = facadeColorHex(wallColor);
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  const { cellW, cellH, marginX, marginY, winW, winH } = facadeCellMetrics();
  for (const cell of FACADE_LAYOUT) {
    const x = cell.col * cellW + marginX;
    const y = cell.row * cellH + marginY;
    if (cell.lit) {
      ctx.fillStyle = "#e8c684";
    } else {
      const s = cell.shade;
      ctx.fillStyle = `rgb(${s},${s + 8},${s + 18})`;
    }
    ctx.fillRect(x, y, winW, winH);
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}
