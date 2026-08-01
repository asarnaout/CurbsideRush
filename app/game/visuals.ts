/**
 * Pure, deterministic helpers for the 3D scene's visual overhaul: per-map
 * palettes, sky gradients, fog ranges, horizon silhouettes, procedural
 * texture specs, planar UVs, and roadside prop placement. Everything here is
 * renderer-agnostic (no Babylon imports) so it can be unit-tested directly;
 * GameCanvas owns the canvas painting and mesh construction.
 */

export function seededUnit(seed: number) {
  let value = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

export interface VisualPoint {
  readonly x: number;
  readonly z: number;
}

export interface MapVisualPalette {
  readonly skyTop: string;
  readonly skyHorizon: string;
  readonly fogColor: string;
  readonly grassBase: string;
  readonly grassAlt: string;
  /**
   * The three greens are a *range*, not a base plus an accent. `grassBase` is
   * the mid tone, `grassAlt` the lit one and `grassDeep` the shadowed one, and
   * the blade layer draws across all three — which is what stops a lawn reading
   * as one flat card. Keep them a genuine spread; collapsing them toward each
   * other silently returns the ground to the flat green this replaced.
   */
  readonly grassDeep: string;
  /** Sun-bleached/parched tone for the worn patches. Arid on Cairo. */
  readonly grassDry: string;
  /** Flower-head colour for the sparse flora dots. */
  readonly floraAccent: string;
  readonly dirtShoulder: string;
  readonly silhouetteNear: string;
  readonly silhouetteFar: string;
  readonly sunTint: string;
  /**
   * Paved-city option. When `paved` is set, the base ground renders as concrete
   * (`groundBase`) instead of grass, and the road shoulder band becomes a
   * concrete sidewalk (`pavement`). Parks still paint their own green on top.
   * Omitted on rural/suburban maps, which keep the grass ground + dirt shoulder.
   */
  readonly paved?: boolean;
  readonly groundBase?: string;
  readonly pavement?: string;
  /**
   * Night city. When set, the scene lights dim to a cool moonlight, building
   * materials gain a warm emissive so windows/facades glow, streetlights and
   * signage light up, and bloom is nudged — a night drive lit by the city
   * itself. The sky/fog/silhouette colours above are authored dark to match.
   */
  readonly night?: boolean;
}

export type MapVisualKey =
  | "nyc"
  | "london"
  | "tokyo"
  | "cairo"
  | "orientation";

/**
 * How wide the concrete sidewalk band renders on `paved` maps. Shared by the
 * renderer (sidewalk strips), the pavement rail graph (walkers), and the
 * static-collider clamp that keeps venue lots off the walkable band.
 */
export const PAVED_SIDEWALK_WIDTH_M = 3.4;

// Warm cinematic low-poly palette. Each sky is a saturated blue zenith that
// warms into a COLORED horizon (retiring the old near-white haze that washed
// every map out); fog matches the horizon so distance reads as atmosphere;
// grass is richer, dirt warmer, and distant silhouettes recede into a warm
// haze rather than a cold grey. Per-map moods: NYC golden-hour, London rich
// late-afternoon, Tokyo soft warm residential, Cairo clear hot daylight over
// warm stone and blue-green Nile water.
const MAP_VISUAL_PALETTES: Record<MapVisualKey, MapVisualPalette> = {
  nyc: {
    // Realistic city night: a deep navy zenith easing to a slightly lit
    // night-blue near the horizon, with matching dark-blue fog — so the warm
    // sodium streetlights/windows pop against a cool, properly dark sky rather
    // than the flat grey a blue→amber dusk gradient washed out to.
    skyTop: "#0e1a33",
    skyHorizon: "#22355a",
    fogColor: "#1c2a44",
    grassBase: "#3f6a3c",
    grassAlt: "#4d7c44",
    // Cool and deep: Central Park after dark is lit by the avenue, not the sun.
    grassDeep: "#27492a",
    grassDry: "#5c6b41",
    floraAccent: "#d8dba8",
    dirtShoulder: "#6b5a3f",
    silhouetteNear: "#3a3742",
    silhouetteFar: "#6a5d55",
    sunTint: "#ffddab",
    // NYC is a paved city: concrete lots + sidewalks instead of the grass plane.
    paved: true,
    groundBase: "#34363b",
    pavement: "#45474c",
    night: true,
  },
  london: {
    skyTop: "#3f7fb8",
    skyHorizon: "#ecd7bb",
    fogColor: "#e2d0ba",
    grassBase: "#3c6444",
    grassAlt: "#4a7550",
    // Rich and damp — a London square keeps its green through the afternoon.
    grassDeep: "#28472f",
    grassDry: "#6a7048",
    floraAccent: "#e6e3d2",
    dirtShoulder: "#5f5540",
    silhouetteNear: "#a6a89f",
    silhouetteFar: "#cdc8b6",
    sunTint: "#ffe6c0",
  },
  tokyo: {
    skyTop: "#4a8ec2",
    skyHorizon: "#f0dcbd",
    fogColor: "#e6d6bd",
    grassBase: "#40663d",
    grassAlt: "#4f7a45",
    // Lush: Setagaya's temple gardens are watered and shaded.
    grassDeep: "#2a4b2c",
    grassDry: "#6d7245",
    floraAccent: "#f0d6dd",
    dirtShoulder: "#665a3f",
    silhouetteNear: "#a9b0b0",
    silhouetteFar: "#cfccb8",
    sunTint: "#ffe9c2",
  },
  cairo: {
    // Central Cairo is bright rather than desert-orange: a hard blue sky,
    // dusty cream haze over the dense city, warm stone/plaster, and neutral
    // grey paving. Keeping the fog pale-blue instead of tan prevents the Nile
    // loop from reading as a sand level.
    skyTop: "#4c9ac8",
    skyHorizon: "#e7d7bd",
    fogColor: "#d8cfbd",
    grassBase: "#3f7046",
    grassAlt: "#5c8150",
    // Arid: Cairo's greens are irrigated islands, and they show the dust. The
    // dry tone runs much closer to the sand than the other cities' do.
    grassDeep: "#2c5133",
    grassDry: "#8a8552",
    floraAccent: "#e8d59c",
    dirtShoulder: "#8b795b",
    silhouetteNear: "#8d8377",
    silhouetteFar: "#b9aa96",
    sunTint: "#fff0c8",
    paved: true,
    groundBase: "#77736a",
    pavement: "#aaa18f",
  },
  orientation: {
    skyTop: "#3f86c6",
    skyHorizon: "#ecdcbe",
    fogColor: "#e2d5bc",
    grassBase: "#3d673f",
    grassAlt: "#4c7a46",
    grassDeep: "#294a2d",
    grassDry: "#687046",
    floraAccent: "#e4e2c6",
    dirtShoulder: "#625740",
    silhouetteNear: "#a8aca2",
    silhouetteFar: "#cdc9b6",
    sunTint: "#ffe9c4",
  },
};

export function resolveMapVisualKey(mapId: string): MapVisualKey {
  const id = mapId.toLowerCase();
  if (id.includes("cairo")) return "cairo";
  if (id.includes("tokyo")) return "tokyo";
  if (id.includes("london")) return "london";
  if (id.includes("orientation") || id.includes("yard")) return "orientation";
  return "nyc";
}

export function resolveMapVisualPalette(mapId: string): MapVisualPalette {
  return MAP_VISUAL_PALETTES[resolveMapVisualKey(mapId)];
}

const clampChannel = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)));

export function mixHexColors(from: string, to: string, amount: number): string {
  const parse = (hex: string): [number, number, number] => {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!match) return [128, 128, 128];
    return [
      parseInt(match[1], 16),
      parseInt(match[2], 16),
      parseInt(match[3], 16),
    ];
  };
  const [fr, fg, fb] = parse(from);
  const [tr, tg, tb] = parse(to);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (a: number, b: number) => clampChannel(a + (b - a) * t);
  return `#${[channel(fr, tr), channel(fg, tg), channel(fb, tb)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface SkyGradientStop {
  readonly offset: number;
  readonly color: string;
}

/**
 * Zenith-to-horizon gradient stops (offset 0 = top of the sky dome). A rich
 * blue holds through the upper dome, then warms into the colored horizon band
 * near eye level; the horizon colour holds to offset 1 so the dome never shows
 * a hard edge under the world. Keeping the blue dominant up high (only a 35%
 * warm mix at the half-way stop) avoids a muddy blue↔warm blend across the
 * middle of the sky.
 */
export function skyGradientStops(
  palette: MapVisualPalette,
): readonly SkyGradientStop[] {
  return [
    { offset: 0, color: palette.skyTop },
    { offset: 0.5, color: mixHexColors(palette.skyTop, palette.skyHorizon, 0.35) },
    { offset: 0.8, color: mixHexColors(palette.skyTop, palette.skyHorizon, 0.78) },
    { offset: 1, color: palette.skyHorizon },
  ];
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export interface FogRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Linear-fog band scaled to the map so small yards fade gently at their
 * edges while a long city melts into the horizon instead of hard-clipping.
 */
export function resolveFogRange(worldSize: VisualPoint): FogRange {
  const maxDimension = Math.max(90, worldSize.x, worldSize.z);
  return {
    start: clamp(0.45 * maxDimension, 70, 160),
    end: clamp(1.15 * maxDimension, 340, 1100),
  };
}

/**
 * The fog band the scene actually runs. Night maps tighten it: the far end of
 * a long avenue fades out so a corner turn onto a canyon draws far fewer
 * buildings (the worst-case spike), and it deepens the night mood. This is
 * the single source of that tightening — the sky builder and the camera far
 * plane must agree on where the world ends.
 */
export function resolveEffectiveFogRange(
  night: boolean,
  worldSize: VisualPoint,
): FogRange {
  const range = resolveFogRange(worldSize);
  if (!night) return range;
  return {
    start: Math.min(range.start, 100),
    end: Math.min(range.end, 440),
  };
}

/**
 * Camera far plane, hugging the fog: linear fog fully swallows everything at
 * fogEnd, so geometry past it contributes nothing but frustum tests and draw
 * calls — on the 3 km NYC grid that was the whole city, every frame, from
 * anywhere. The +20m margin keeps the last visible sliver of the fade off the
 * clip edge.
 */
export function resolveCameraFarPlane(
  night: boolean,
  worldSize: VisualPoint,
): number {
  return resolveEffectiveFogRange(night, worldSize).end + 20;
}

export type SilhouetteShapeKind = "box" | "hill" | "spike" | "pylon";

export interface SilhouetteShape {
  readonly kind: SilhouetteShapeKind;
  /** Normalised horizontal centre position, 0..1 around the ring. */
  readonly x: number;
  /** Normalised width, 0..1. */
  readonly w: number;
  /** Normalised height above the horizon base, 0..1. */
  readonly h: number;
  /** 1 = far (painted first, lighter), 0 = near (painted last, darker). */
  readonly layer: 0 | 1;
}

const pushRange = (
  shapes: SilhouetteShape[],
  random: () => number,
  count: number,
  make: (index: number) => SilhouetteShape,
): void => {
  for (let index = 0; index < count; index += 1) {
    shapes.push(make(index));
  }
};

/**
 * Deterministic, per-map skyline recipe in normalised coordinates. NYC gets
 * a dense high-rise wall, London low terraces with one tall spike and a dome
 * hump, Tokyo hills behind mid-rises and utility pylons, and Cairo a dense
 * low/mid-rise roofline punctuated by minarets and Cairo Tower.
 */
export function buildHorizonSilhouetteSpec(
  mapId: string,
  seed: number,
): readonly SilhouetteShape[] {
  const key = resolveMapVisualKey(mapId);
  const random = seededUnit(seed);
  const shapes: SilhouetteShape[] = [];

  if (key === "nyc") {
    pushRange(shapes, random, 44, () => ({
      kind: "box",
      x: random(),
      w: 0.012 + random() * 0.02,
      h: 0.22 + random() * 0.3,
      layer: 1,
    }));
    pushRange(shapes, random, 30, () => ({
      kind: "box",
      x: random(),
      w: 0.014 + random() * 0.022,
      h: 0.34 + random() * 0.4,
      layer: 0,
    }));
    pushRange(shapes, random, 4, () => ({
      kind: "spike",
      x: random(),
      w: 0.012,
      h: 0.72 + random() * 0.22,
      layer: 0,
    }));
    return shapes;
  }

  if (key === "london") {
    pushRange(shapes, random, 26, () => ({
      kind: "box",
      x: random(),
      w: 0.03 + random() * 0.05,
      h: 0.12 + random() * 0.14,
      layer: 1,
    }));
    pushRange(shapes, random, 20, () => ({
      kind: "box",
      x: random(),
      w: 0.024 + random() * 0.045,
      h: 0.14 + random() * 0.16,
      layer: 0,
    }));
    shapes.push({ kind: "hill", x: random(), w: 0.07, h: 0.3, layer: 0 });
    shapes.push({
      kind: "spike",
      x: 0.18 + random() * 0.64,
      w: 0.02,
      h: 0.78,
      layer: 0,
    });
    return shapes;
  }

  if (key === "tokyo") {
    pushRange(shapes, random, 8, () => ({
      kind: "hill",
      x: random(),
      w: 0.14 + random() * 0.16,
      h: 0.14 + random() * 0.16,
      layer: 1,
    }));
    pushRange(shapes, random, 22, () => ({
      kind: "box",
      x: random(),
      w: 0.016 + random() * 0.03,
      h: 0.16 + random() * 0.24,
      layer: 0,
    }));
    pushRange(shapes, random, 8, (index) => ({
      kind: "pylon",
      x: (index + 0.5) / 8 + (random() - 0.5) * 0.04,
      w: 0.012,
      h: 0.42 + random() * 0.14,
      layer: 0,
    }));
    return shapes;
  }

  if (key === "cairo") {
    pushRange(shapes, random, 36, () => ({
      kind: "box",
      x: random(),
      w: 0.018 + random() * 0.035,
      h: 0.14 + random() * 0.22,
      layer: 1,
    }));
    pushRange(shapes, random, 28, () => ({
      kind: "box",
      x: random(),
      w: 0.015 + random() * 0.03,
      h: 0.2 + random() * 0.28,
      layer: 0,
    }));
    // Slender mosque minarets, plus one markedly taller Cairo Tower silhouette.
    pushRange(shapes, random, 7, () => ({
      kind: "spike",
      x: random(),
      w: 0.008 + random() * 0.005,
      h: 0.42 + random() * 0.2,
      layer: 0,
    }));
    shapes.push({
      kind: "pylon",
      x: 0.18 + random() * 0.64,
      w: 0.018,
      h: 0.92,
      layer: 0,
    });
    return shapes;
  }

  pushRange(shapes, random, 10, () => ({
    kind: "hill",
    x: random(),
    w: 0.14 + random() * 0.18,
    h: 0.08 + random() * 0.12,
    layer: 1,
  }));
  pushRange(shapes, random, 14, () => ({
    kind: "hill",
    x: random(),
    w: 0.01 + random() * 0.02,
    h: 0.05 + random() * 0.07,
    layer: 0,
  }));
  return shapes;
}

export interface AsphaltCrack {
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

export interface AsphaltTextureSpec {
  readonly noiseSeed: number;
  readonly cracks: readonly AsphaltCrack[];
  readonly patches: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly lighten: number;
  }[];
}

/** Subtle wear spec: wandering thin cracks plus soft lighter patches. */
export function buildAsphaltTextureSpec(seed: number): AsphaltTextureSpec {
  const random = seededUnit(seed);
  const cracks: AsphaltCrack[] = [];
  const crackCount = 6 + Math.floor(random() * 4);
  for (let crack = 0; crack < crackCount; crack += 1) {
    let x = random();
    let y = random();
    const points = [{ x, y }];
    const steps = 4 + Math.floor(random() * 4);
    const drift = random() * Math.PI * 2;
    for (let step = 0; step < steps; step += 1) {
      const angle = drift + (random() - 0.5) * 1.6;
      x = (x + Math.cos(angle) * (0.03 + random() * 0.05) + 1) % 1;
      y = (y + Math.sin(angle) * (0.03 + random() * 0.05) + 1) % 1;
      points.push({ x, y });
    }
    cracks.push({ points });
  }
  const patches = Array.from({ length: 2 + Math.floor(random() * 2) }, () => ({
    x: random(),
    y: random(),
    r: 0.035 + random() * 0.05,
    lighten: 0.015 + random() * 0.02,
  }));
  return { noiseSeed: Math.floor(random() * 0xffff) + 1, cracks, patches };
}

/**
 * One sine component of a river's surface.
 *
 * `cyclesU`/`cyclesV` count whole waves across the tile along world +x and +z,
 * and they are **integers on purpose**: one tile repeats over a kilometre of
 * river, so a fractional cycle count puts a hard seam on every tile edge. A
 * component's direction is therefore quantised to what the tile can express,
 * which is why the builder rounds a direction into a lattice pair instead of
 * storing the angle it wanted.
 */
export interface RiverWave {
  readonly cyclesU: number;
  readonly cyclesV: number;
  readonly amplitude: number;
  /** Radians. Without it, components sharing a lattice pair stack into a band. */
  readonly phase: number;
}

export interface RiverWaveFieldOptions {
  readonly seed: number;
  /** Flow direction in the lane-pose convention: 0 = +z (north), +π/2 = +x. */
  readonly flowHeadingRad: number;
  readonly count: number;
  /** The wavelength band, as cycles across one tile. */
  readonly minCycles: number;
  readonly maxCycles: number;
  /** How far a component may fan off its nominal axis, radians. */
  readonly spreadRad?: number;
  /** Share of components turned broadside — chop running across the current. */
  readonly crossFraction?: number;
}

/**
 * Deterministic wave components for one tile of river surface.
 *
 * **Crests run along the current**, so most wave vectors point across it. That
 * one choice is the difference between water that reads as a river and water
 * that reads as a lake: a current drags its silt and foam into long downstream
 * streaks, and the eye reads the streaks, not the ripples. `crossFraction`
 * turns a minority broadside so the result is chop rather than combing.
 */
export function buildRiverWaveField(
  options: RiverWaveFieldOptions,
): readonly RiverWave[] {
  const random = seededUnit(options.seed);
  const spread = options.spreadRad ?? 0.45;
  const crossFraction = options.crossFraction ?? 0.3;
  // Heading (0 = +z) into the tile's own axes, where u = world +x, v = world
  // +z and an angle is measured from +u toward +v.
  const alongFlow = Math.PI / 2 - options.flowHeadingRad;
  const acrossFlow = alongFlow + Math.PI / 2;
  const waves: RiverWave[] = [];
  for (let index = 0; index < options.count; index += 1) {
    // A broadside component's *wave vector* runs along the flow.
    const broadside = random() < crossFraction;
    const angle =
      (broadside ? alongFlow : acrossFlow) + (random() - 0.5) * 2 * spread;
    const cycles =
      options.minCycles + random() * (options.maxCycles - options.minCycles);
    const cyclesU = Math.round(Math.cos(angle) * cycles);
    const cyclesV = Math.round(Math.sin(angle) * cycles);
    // Rounded flat: a zero pair is a constant, which would only shift the tile.
    if (cyclesU === 0 && cyclesV === 0) continue;
    waves.push({
      cyclesU,
      cyclesV,
      // Amplitude falls with frequency, as a water spectrum does rather than as
      // white noise: long swells carry the shape, short chop only textures it.
      amplitude: 1 / Math.hypot(cyclesU, cyclesV),
      phase: random() * Math.PI * 2,
    });
  }
  return waves;
}

/**
 * Rasterises a wave field into a `size × size` height tile, normalised so the
 * strongest peak reaches ±1. Seamless in both axes by construction — see
 * `RiverWave` for why the cycle counts have to be integers.
 *
 * Expanded through the angle-sum identity so each component costs `4 · size`
 * transcendentals instead of one `Math.sin` per pixel: at 512² with a dozen
 * components that trades ~3M sines on the map-load path for ~4k.
 */
export function sampleRiverWaveField(
  waves: readonly RiverWave[],
  size: number,
): Float32Array {
  const field = new Float32Array(size * size);
  if (!waves.length || size <= 0) return field;
  const sinU = new Float64Array(size);
  const cosU = new Float64Array(size);
  const sinV = new Float64Array(size);
  const cosV = new Float64Array(size);
  for (const wave of waves) {
    for (let u = 0; u < size; u += 1) {
      const angle = (2 * Math.PI * wave.cyclesU * u) / size + wave.phase;
      sinU[u] = Math.sin(angle);
      cosU[u] = Math.cos(angle);
    }
    for (let v = 0; v < size; v += 1) {
      const angle = (2 * Math.PI * wave.cyclesV * v) / size;
      sinV[v] = Math.sin(angle);
      cosV[v] = Math.cos(angle);
    }
    for (let v = 0; v < size; v += 1) {
      const row = v * size;
      const sinRow = sinV[v];
      const cosRow = cosV[v];
      for (let u = 0; u < size; u += 1) {
        // sin(a + b) = sin a cos b + cos a sin b
        field[row + u] +=
          wave.amplitude * (sinU[u] * cosRow + cosU[u] * sinRow);
      }
    }
  }
  let peak = 0;
  for (const value of field) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) {
    for (let index = 0; index < field.length; index += 1) field[index] /= peak;
  }
  return field;
}

/**
 * One painted blade. `tone` indexes the painter's four-entry ramp (0 lightest
 * → 3 darkest), and the painter draws the top `tipFraction` of the stroke one
 * ramp step lighter, so every blade carries a light-from-above gradient. That
 * baked gradient is deliberately doing the job a normal map would: the ground
 * is a flat plane under a fixed sun, where a real normal map reads as static
 * noise rather than relief.
 */
export interface GrassBlade {
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = up the tile. */
  readonly angle: number;
  /** Stroke length as a fraction of the tile. */
  readonly length: number;
  /** Stroke width in tile fractions; the painter scales it to pixels. */
  readonly width: number;
  readonly tone: number;
}

export interface GrassTextureSpec {
  readonly noiseSeed: number;
  /**
   * Large soft tonal fields. This is the layer that stops a big lawn reading
   * as one flat card at distance, where blades have long since mipped away.
   */
  readonly patches: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    /** 0 = deep/shadowed, 1 = lit, 2 = dry. */
    readonly tone: number;
  }[];
  /** Mid-scale mottle. Retained from the two-tone spec this replaced. */
  readonly blobs: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly alt: boolean;
  }[];
  /** The close-range texture — scattered singles plus clustered tuft blades. */
  readonly blades: readonly GrassBlade[];
  /** Worn earth showing through, in the palette's dry tone. */
  readonly bare: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
  }[];
  /** Sparse flower heads in the palette accent. */
  readonly flora: readonly {
    readonly x: number;
    readonly y: number;
    readonly r: number;
  }[];
  readonly speckles: readonly { readonly x: number; readonly y: number }[];
}

/** Blades per tile. Dense enough to read as turf rather than as scribble. */
const GRASS_SCATTERED_BLADES = 1600;
const GRASS_TUFTS = 150;
const GRASS_BLADES_PER_TUFT = 6;

/**
 * Layered meadow spec: tonal patches, mid-scale mottle, a dense directional
 * blade field, worn earth, and sparse flora.
 *
 * **Blades lean, they do not point randomly.** Every blade takes a small offset
 * from one per-tile prevailing angle (and tuft blades fan about their cluster's
 * own lean). Uniformly random angles paint visual noise — the eye reads a lawn
 * by its combing, so the correlation is the whole effect.
 */
export function buildGrassTextureSpec(seed: number): GrassTextureSpec {
  const random = seededUnit(seed);
  const prevailing = random() * Math.PI * 2;

  const patches = Array.from({ length: 16 }, () => ({
    x: random(),
    y: random(),
    r: 0.14 + random() * 0.24,
    tone: Math.floor(random() * 3),
  }));
  const blobs = Array.from({ length: 150 }, () => ({
    x: random(),
    y: random(),
    r: 0.02 + random() * 0.05,
    alt: random() < 0.5,
  }));

  const blades: GrassBlade[] = [];
  for (let index = 0; index < GRASS_SCATTERED_BLADES; index += 1) {
    blades.push({
      x: random(),
      y: random(),
      angle: prevailing + (random() - 0.5) * 1.5,
      length: 0.006 + random() * 0.009,
      width: 0.0013 + random() * 0.0009,
      tone: Math.floor(random() * 4),
    });
  }
  // Tufts: a shared origin and lean, so growth reads as clumped rather than
  // evenly sown. They run longer and darker than the scattered blades.
  for (let tuft = 0; tuft < GRASS_TUFTS; tuft += 1) {
    const originX = random();
    const originY = random();
    const lean = prevailing + (random() - 0.5) * 1.1;
    for (let blade = 0; blade < GRASS_BLADES_PER_TUFT; blade += 1) {
      blades.push({
        x: (originX + (random() - 0.5) * 0.016 + 1) % 1,
        y: (originY + (random() - 0.5) * 0.016 + 1) % 1,
        angle: lean + (random() - 0.5) * 0.9,
        length: 0.011 + random() * 0.013,
        width: 0.0016 + random() * 0.001,
        tone: 2 + Math.floor(random() * 2),
      });
    }
  }

  const bare = Array.from({ length: 7 }, () => ({
    x: random(),
    y: random(),
    r: 0.025 + random() * 0.045,
  }));
  const flora = Array.from({ length: 22 }, () => ({
    x: random(),
    y: random(),
    r: 0.0011 + random() * 0.0012,
  }));
  const speckles = Array.from({ length: 42 }, () => ({
    x: random(),
    y: random(),
  }));

  return {
    noiseSeed: Math.floor(random() * 0xffff) + 1,
    patches,
    blobs,
    blades,
    bare,
    flora,
    speckles,
  };
}

/**
 * The second, much finer tile that `StandardMaterial.detailMap` multiplies over
 * the base grass, so the 12 m tile stops reading as a grid. Blades only, and
 * deliberately no tonal layers — a detail map carries high frequency; anything
 * low-frequency in here just re-introduces a visible repeat at its own scale.
 */
export function buildGrassDetailSpec(seed: number): readonly GrassBlade[] {
  const random = seededUnit(seed);
  const prevailing = random() * Math.PI * 2;
  return Array.from({ length: 520 }, () => ({
    x: random(),
    y: random(),
    angle: prevailing + (random() - 0.5) * 1.9,
    length: 0.018 + random() * 0.03,
    width: 0.005 + random() * 0.004,
    tone: Math.floor(random() * 4),
  }));
}

/**
 * World-planar UVs from interleaved xyz positions so tiled surface textures
 * stay continuous across independently authored road meshes.
 */
export function buildPlanarUVs(
  positions: readonly number[],
  scale: number,
): number[] {
  const uvs: number[] = [];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    uvs.push(positions[index] * scale, positions[index + 2] * scale);
  }
  return uvs;
}

export function distanceToPolylineM(
  point: VisualPoint,
  polyline: readonly VisualPoint[],
): number {
  if (!polyline.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared < 1e-9
      ? 0
      : clamp(
          ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
          0,
          1,
        );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    best = Math.min(best, Math.hypot(point.x - x, point.z - z));
  }
  if (polyline.length === 1) {
    best = Math.hypot(point.x - polyline[0].x, point.z - polyline[0].z);
  }
  return best;
}

export interface PropPlacement {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly variant: number;
}

export interface PropKindConfig {
  readonly kind: string;
  /** Average distance between candidates along a road, in metres. */
  readonly spacingM: number;
  /** Random +/- variation applied to spacing, in metres. */
  readonly jitterM: number;
  /** Extra clearance beyond the road edge + shoulder, in metres (>= 0.9). */
  readonly lateralMarginM: number;
  /**
   * Optional centre offset beyond the carriageway edge, seating a prop at the
   * kerb — before the sidewalk rather than beyond its outer edge. No prop kind
   * sets it today (Cairo's kerb-parked vehicles were removed); it survives as
   * the hook anything parked at the kerb would need.
   */
  readonly curbOffsetM?: number;
  readonly bothSides: boolean;
  /** Alternate sides along the road (streetlight rhythm). */
  readonly alternateSides?: boolean;
  readonly variants: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  /** Face the carriageway instead of taking a random rotation. */
  readonly faceRoad?: boolean;
}

export interface PropScatterRoadSurface {
  readonly id: string;
  readonly centerline: readonly VisualPoint[];
  readonly widthM: number;
  /** Per-road pavement band; falls back to the input default when absent. */
  readonly sidewalkWidthM?: number;
}

export interface PropScatterRect {
  readonly center: VisualPoint;
  readonly size: VisualPoint;
  /** Clockwise yaw from +z; defaults to an axis-aligned rectangle. */
  readonly headingDeg?: number;
}

export interface PropScatterInput {
  readonly roadSurfaces: readonly PropScatterRoadSurface[];
  readonly blocks: readonly PropScatterRect[];
  readonly landmarks: readonly PropScatterRect[];
  readonly worldSize: VisualPoint;
  readonly shoulderWidthM: number;
  readonly seed: number;
  readonly kinds: readonly PropKindConfig[];
  /** Existing hand-placed furniture that scattered props must keep clear of. */
  readonly occupiedPoints?: readonly VisualPoint[];
  /**
   * Water surfaces, as world polygons. Scatter is driven off road geometry, so
   * a riverside road offers candidates on its water side exactly like any other
   * — and with nothing to reject them, Cairo grew trees in the Nile.
   */
  readonly waterPolygons?: readonly (readonly VisualPoint[])[];
}

const PROP_MIN_MUTUAL_SPACING_M = 3;
const PROP_ROAD_CLEARANCE_M = 0.6;
const PROP_WORLD_EDGE_MARGIN_M = 4;
const RECT_INFLATION_M = 1;

interface SpacingGrid {
  readonly cellSize: number;
  readonly cells: Map<string, VisualPoint[]>;
}

const gridKey = (column: number, row: number): string => `${column}:${row}`;

const createSpacingGrid = (cellSize: number): SpacingGrid => ({
  cellSize,
  cells: new Map(),
});

const gridHasNeighborWithin = (
  grid: SpacingGrid,
  point: VisualPoint,
  radius: number,
): boolean => {
  const column = Math.floor(point.x / grid.cellSize);
  const row = Math.floor(point.z / grid.cellSize);
  const reach = Math.ceil(radius / grid.cellSize);
  for (let dc = -reach; dc <= reach; dc += 1) {
    for (let dr = -reach; dr <= reach; dr += 1) {
      const bucket = grid.cells.get(gridKey(column + dc, row + dr));
      if (!bucket) continue;
      for (const existing of bucket) {
        if (Math.hypot(existing.x - point.x, existing.z - point.z) < radius) {
          return true;
        }
      }
    }
  }
  return false;
};

const gridInsert = (grid: SpacingGrid, point: VisualPoint): void => {
  const key = gridKey(
    Math.floor(point.x / grid.cellSize),
    Math.floor(point.z / grid.cellSize),
  );
  const bucket = grid.cells.get(key);
  if (bucket) bucket.push(point);
  else grid.cells.set(key, [point]);
};

const isInsideInflatedRect = (
  point: VisualPoint,
  rect: PropScatterRect,
): boolean => {
  // Transform the world point into the rectangle's local frame before testing.
  // AABB testing diagonal Cairo blocks leaves four large false "free" wedges
  // where trees and stalls can grow through a building.
  const heading = ((rect.headingDeg ?? 0) * Math.PI) / 180;
  const dx = point.x - rect.center.x;
  const dz = point.z - rect.center.z;
  const localX = dx * Math.cos(heading) - dz * Math.sin(heading);
  const localZ = dx * Math.sin(heading) + dz * Math.cos(heading);
  return (
    Math.abs(localX) <= rect.size.x / 2 + RECT_INFLATION_M &&
    Math.abs(localZ) <= rect.size.z / 2 + RECT_INFLATION_M
  );
};

/**
 * Is the point inside any water polygon? Crossing number, so it holds for the
 * concave river outlines Cairo and London author.
 */
const isOverWater = (
  point: VisualPoint,
  polygons: readonly (readonly VisualPoint[])[],
): boolean =>
  polygons.some((polygon) => {
    let inside = false;
    for (
      let index = 0, previous = polygon.length - 1;
      index < polygon.length;
      previous = index, index += 1
    ) {
      const left = polygon[index];
      const right = polygon[previous];
      if (
        left.z > point.z !== right.z > point.z &&
        point.x <
          ((right.x - left.x) * (point.z - left.z)) / (right.z - left.z) +
            left.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  });

/**
 * Deterministic roadside prop scatter. Walks each road surface by arclength,
 * offsets candidates beyond the shoulder, and rejects anything that would sit
 * on a carriageway, in open water, inside authored blocks/landmarks, outside
 * the world, or too close to another prop or hand-placed furniture.
 */
export function generateRoadsidePropPlacements(
  input: PropScatterInput,
): readonly PropPlacement[] {
  const random = seededUnit(input.seed);
  const placements: PropPlacement[] = [];
  const grid = createSpacingGrid(PROP_MIN_MUTUAL_SPACING_M);
  for (const occupied of input.occupiedPoints ?? []) {
    gridInsert(grid, occupied);
  }

  const halfWorldX = input.worldSize.x / 2 - PROP_WORLD_EDGE_MARGIN_M;
  const halfWorldZ = input.worldSize.z / 2 - PROP_WORLD_EDGE_MARGIN_M;

  const isClearOfRoads = (
    point: VisualPoint,
    sourceSurfaceId: string,
    curbOffsetM: number | undefined,
  ): boolean =>
    input.roadSurfaces.every(
      (surface) =>
        distanceToPolylineM(point, surface.centerline) >=
        surface.widthM / 2 +
          (surface.id === sourceSurfaceId && curbOffsetM !== undefined
            ? 0.05
            : (surface.sidewalkWidthM ?? input.shoulderWidthM) +
              PROP_ROAD_CLEARANCE_M),
    );

  for (const kindConfig of input.kinds) {
    for (const surface of input.roadSurfaces) {
      let sideToggle = random() < 0.5 ? 1 : -1;
      let nextAt = kindConfig.spacingM * (0.3 + random() * 0.7);
      let travelled = 0;
      for (
        let segment = 0;
        segment < surface.centerline.length - 1;
        segment += 1
      ) {
        const start = surface.centerline[segment];
        const end = surface.centerline[segment + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const segmentLength = Math.hypot(dx, dz);
        if (segmentLength < 1e-6) continue;
        const tangentX = dx / segmentLength;
        const tangentZ = dz / segmentLength;

        while (nextAt <= travelled + segmentLength) {
          const along = nextAt - travelled;
          const baseX = start.x + tangentX * along;
          const baseZ = start.z + tangentZ * along;
          const sides = kindConfig.bothSides
            ? [1, -1]
            : [kindConfig.alternateSides ? sideToggle : random() < 0.5 ? 1 : -1];
          if (kindConfig.alternateSides) sideToggle = -sideToggle;

          for (const side of sides) {
            const lateral =
              surface.widthM / 2 +
              (kindConfig.curbOffsetM !== undefined
                ? kindConfig.curbOffsetM + (random() - 0.5) * 0.12
                : (surface.sidewalkWidthM ?? input.shoulderWidthM) +
                  kindConfig.lateralMarginM +
                  random() * 1.5);
            const normalX = tangentZ * side;
            const normalZ = -tangentX * side;
            const candidate = {
              x: baseX + normalX * lateral,
              z: baseZ + normalZ * lateral,
            };
            const rotationY = kindConfig.faceRoad
              ? Math.atan2(baseX - candidate.x, baseZ - candidate.z)
              : random() * Math.PI * 2;
            const scale =
              (kindConfig.minScale ?? 1) +
              random() *
                Math.max(0, (kindConfig.maxScale ?? 1) - (kindConfig.minScale ?? 1));
            const variant = Math.floor(random() * kindConfig.variants);
            if (
              Math.abs(candidate.x) > halfWorldX ||
              Math.abs(candidate.z) > halfWorldZ ||
              !isClearOfRoads(
                candidate,
                surface.id,
                kindConfig.curbOffsetM,
              ) ||
              isOverWater(candidate, input.waterPolygons ?? []) ||
              input.blocks.some((rect) => isInsideInflatedRect(candidate, rect)) ||
              input.landmarks.some((rect) =>
                isInsideInflatedRect(candidate, rect),
              ) ||
              gridHasNeighborWithin(grid, candidate, PROP_MIN_MUTUAL_SPACING_M)
            ) {
              continue;
            }
            gridInsert(grid, candidate);
            placements.push({
              kind: kindConfig.kind,
              x: candidate.x,
              z: candidate.z,
              rotationY,
              scale,
              variant,
            });
          }

          nextAt += Math.max(
            2,
            kindConfig.spacingM + (random() - 0.5) * 2 * kindConfig.jitterM,
          );
        }
        travelled += segmentLength;
      }
    }
  }
  return placements;
}

/** Small deterministic hash so per-map prop scatter is stable across runs. */
export function hashStringToSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}
