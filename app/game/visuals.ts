/**
 * Pure, deterministic helpers for the 3D scene's visual overhaul: per-map
 * palettes, sky gradients, fog ranges, horizon silhouettes, procedural
 * texture specs, planar UVs, and roadside prop placement. Everything here is
 * renderer-agnostic (no Babylon imports) so it can be unit-tested directly;
 * GameCanvas owns the canvas painting and mesh construction.
 *
 * This is also the per-city *identity* registry (issue #291): `MapVisualProfile`
 * carries the small selector facts every render-side seam needs to pick its own
 * per-city data (which plate region, which building-set catalogues, which nature
 * sets, which character weights) — never the bulky content tables themselves
 * (paint hex codes, model catalogues, colour ramps stay in their domain file).
 * `BuildingSetId`/`PlateRegion` are imported type-only, so this file's back-
 * reference to `buildingSets.ts`/`vehicleVisuals.ts` is erased at compile time
 * and never becomes a runtime import cycle, even though both of those files
 * import real values from here.
 */
import { natureSetsForMap, type NatureSetId } from "./natureCatalog";
import type { BuildingSetId } from "./buildingSets";
import type { PlateRegion } from "./vehicleVisuals";

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
  readonly elevationM?: number;
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
   *
   * **Every shipped city sets it.** It stays optional because it is the flag
   * that carries the whole night rig, and a future daylight map should be able
   * to opt out by omission rather than by a second flag — but no `night:
   * false` path is exercised by anything a player can load, so a change to a
   * day-map branch is untested by the four-city characterization.
   *
   * A night map is also responsible for its own lighting AT STREET LEVEL: the
   * rig below is moonlight, and moonlight alone leaves a city unplayably dark.
   * Every night palette needs a real streetlight line under it — see
   * `roadsidePropKindsForMap`, where all four cities scatter a kerb-seated,
   * side-alternating lamp pass whose heads glow and whose ground pools light
   * the carriageway.
   */
  readonly night?: boolean;
  /**
   * Night maps only: this palette's override of the moonlit rig's
   * hemispheric/sun intensities (defaults 0.64/0.6 — NYC's tuning, applied
   * when unset). The other three all run higher, and for one reason: their
   * skies, grounds and sunTints are authored darker and less saturated than
   * NYC's golden-sodium set, so the identical rig play-tests as "very dim"
   * (the owner's words about Tokyo, which is what put these fields here).
   * Cairo runs the highest of the four — a warm ground bouncing a dense lit
   * street wall — then London, then Tokyo.
   */
  readonly nightHemiIntensity?: number;
  readonly nightSunIntensity?: number;
  /**
   * This palette's own ceiling on the fog's far end (metres), applied BEFORE
   * night's tighter clamp. The size formula hands a large map up to 1100 m of
   * draw; a palette that wants an atmosphere shorter than its geography —
   * Cairo's dust haze, London's — caps it here, and the camera far plane
   * follows (`resolveEffectiveFogRange`).
   *
   * Now that every city is a night city, both shipped caps (800 and 650) sit
   * above night's own 440 m end, so neither changes what a player sees. They
   * still bind on `auditMapVisualGaps`, which passes `night: false`
   * deliberately so a city being dark can never make its own sightline audit
   * lenient — which is why they are kept rather than retired.
   */
  readonly fogEndCapM?: number;
}

export type MapVisualKey = "nyc" | "london" | "tokyo" | "cairo";

/**
 * Shape shared by every city's own open-waterfront table (Cairo's
 * `CAIRO_OPEN_WATERFRONT_SIDES`, Tokyo's `TOKYO_OPEN_WATERFRONT_SIDES`):
 * road-surface id -> the side(s), in `generatePromenadeDecor`'s own
 * left/right sense, that face open water and so skip the street wall and
 * get the corniche-style parapet + promenade decor instead.
 */
export type OpenWaterfrontSides = Readonly<Partial<Record<string, readonly (-1 | 1)[]>>>;

/**
 * Which map keys get the promenade parapet render pass
 * (`shorelineParapetRuns`) and `generatePromenadeDecor` at all. The actual
 * per-road tables (`CAIRO_OPEN_WATERFRONT_SIDES`, `TOKYO_OPEN_WATERFRONT_SIDES`)
 * live with each city's own content instead of here — this file cannot import
 * them without a cycle (every `cities/*.ts` file already imports FROM this
 * one for `hashStringToSeed`/`PAVED_SIDEWALK_WIDTH_M`/etc; a `visuals.ts` ->
 * `cities/cairo.ts` -> `visuals.ts` circular import would make whichever
 * table loses the race a TDZ crash, not silently wrong data). Consumers
 * needing the real per-road table (`render/roadsideProps.ts`) import the
 * three cities' tables directly and key a small local lookup off this same
 * `MapVisualKey`; consumers only needing a yes/no gate
 * (`render/babylonGameSession.ts`) use this set alone.
 */
export const PROMENADE_DRESSING_MAP_KEYS: ReadonlySet<MapVisualKey> = new Set([
  "cairo",
  "tokyo",
  "london",
]);

/**
 * How wide the concrete sidewalk band renders on `paved` maps. Shared by the
 * renderer (sidewalk strips), the pavement rail graph (walkers), and the
 * static-collider clamp that keeps venue lots off the walkable band.
 */
export const PAVED_SIDEWALK_WIDTH_M = 3.4;

/**
 * What a road surface's pavement band is worth when it authors no
 * `sidewalkWidthM` of its own.
 *
 * Every consumer that measures out from a carriageway centreline has to agree
 * on this, because they are describing one physical kerb from different
 * angles: the drawn shoulder strip, the walkable pavement rails, the venue
 * setback clamp, and a drivable bridge's parapet — which exists twice over, as
 * a mesh in `render/` and as a collider in `simulationAdapter`. A private copy
 * that resolved the fallback as `?? 0` is what put both NYC bridges' visible
 * rail 3.4 m inboard of the wall the car actually hits.
 */
export function defaultSidewalkWidthM(mapPack: {
  readonly id: string;
  readonly geometry: { readonly shoulderWidth?: number };
}): number {
  return resolveMapVisualPalette(mapPack.id).paved
    ? PAVED_SIDEWALK_WIDTH_M
    : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2);
}

// Cinematic low-poly palette. Each sky is a deep zenith easing into a COLORED
// horizon (retiring the old near-white haze that washed every map out); fog
// matches the horizon so distance reads as atmosphere, and distant silhouettes
// recede into that haze rather than a flat grey.
//
// **All four cities now drive after dark** — `night: true` everywhere. The
// game is a night game, and the four palettes differ by what each city's night
// actually looks like rather than by time of day: NYC's cool sodium navy,
// London's light-polluted violet-grey, Tokyo's mercury-vapour blue, Cairo's
// warm dust-lit amber. Anything that reads a `night` palette (the moonlit
// light rig, the bloom/exposure nudge, `BuildingLayer`'s window glow, the
// water's night tiles, the streetlights' emissive heads and their ground light
// pools) is therefore live on every map; there is no longer a daylight path
// exercised by a shipped city, only by the day-map branches those consumers
// keep for a future one.
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
    // London after dark. The sky is the one thing that is NOT simply "NYC's
    // navy, dimmer": a British city night is overcast and heavily light-
    // polluted, so the zenith stays a deep blue but the horizon lifts into a
    // warm violet-grey rather than a clean blue — the sodium glow bouncing off
    // low cloud that stops you ever seeing stars over Kensington.
    skyTop: "#101a2e",
    skyHorizon: "#3c3743",
    fogColor: "#262a38",
    grassBase: "#2d4c36",
    grassAlt: "#395b3e",
    // Rich and damp, but unlit: the royal park's lawns keep their green only
    // where a lamp reaches them, so these sit a clear step under NYC's — where
    // Central Park is lit by the avenue on all four sides.
    grassDeep: "#1d3526",
    grassDry: "#4d5139",
    floraAccent: "#c8c5b6",
    dirtShoulder: "#4a4132",
    silhouetteNear: "#282b39",
    silhouetteFar: "#3b3a49",
    // Moonlight, cooled: the "sun" runs at reduced intensity at night.
    sunTint: "#b9c2dc",
    // London is a paved city. Its ground was the grass plane until the map
    // grew past the museum quarter, and that single missing flag was most of
    // why a "London" drive read as parkland: the base plane painted grass
    // between the roads and `defaultSidewalkWidthM` collapsed to the 1.5 m
    // unpaved fallback, so there was barely a kerb to walk on.
    //
    // Blue-grey asphalt under Portland-ish stone paving, both dropped to their
    // night values. The pavement deliberately stays the lightest ground tone
    // on the map: it is what the streetlights' pools actually land on at the
    // kerb, and a too-dark footway swallows the spill that makes a lit street
    // read as lit.
    paved: true,
    groundBase: "#3a3d43",
    pavement: "#5c5f62",
    night: true,
    // Above NYC's 0.64/0.6 defaults for the same reason Tokyo is: this sky,
    // ground and sunTint are all authored darker and less saturated than
    // NYC's, so the identical rig reads as murk rather than as night. Held a
    // notch under Cairo's, which has both a warmer bounce and a denser lit
    // street wall to carry it.
    nightHemiIntensity: 0.78,
    nightSunIntensity: 0.7,
    // Night's own 100/440 m clamp (`resolveEffectiveFogRange`) governs the
    // live fog and the camera far plane now, and it is far tighter than this
    // — so this cap no longer changes anything a player sees. It stays for
    // the one consumer that deliberately measures against the DAY range:
    // `auditMapVisualGaps` passes `night: false` on purpose, so that the
    // visual-gap sightline audit is never made lenient by a city being dark.
    // Retiring it would silently widen that audit's reach 820 -> 1120 m.
    //
    // The number is still London's own: a 2950x2000 world would otherwise
    // draw to the size formula's 1100 m ceiling, and the royal park's
    // planting alone is 4_400 meshes — measured in-browser, the whole map's
    // tree and thicket layer is 45% of its mesh count.
    fogEndCapM: 800,
  },
  tokyo: {
    // Sakuragawa Nights: the Setagaya village goes from a daytime unpaved
    // suburb to a night+paved city on the same footing as NYC (the repo's
    // only other night+paved palette — this entry copies its field set
    // exactly, values tuned separately). Moonlit sky, mercury-vapour-cool
    // asphalt, sakura pink kept as the one warm accent so it still reads
    // under bloom.
    skyTop: "#0a0f24",
    skyHorizon: "#232a45",
    fogColor: "#161b2e",
    grassBase: "#26391f",
    grassAlt: "#2e4527",
    grassDeep: "#182a18",
    grassDry: "#3d4a2c",
    floraAccent: "#e8a7bb",
    dirtShoulder: "#3a3a35",
    silhouetteNear: "#2c3346",
    silhouetteFar: "#1b2133",
    // Moonlight tint — the "sun" runs at reduced intensity at night, same as NYC.
    sunTint: "#9fb2e8",
    paved: true,
    // Cooler than NYC's neutral concrete: Tokyo's asphalt and pavement lean
    // blue under the mercury-vapour-ish street lighting. Lifted a step from
    // the original #2e323d/#3d4250 alongside the nightHemi/SunIntensity
    // overrides below — the owner read the streets as "very dim" with both
    // at NYC's values.
    groundBase: "#39404e",
    pavement: "#4a5162",
    night: true,
    nightHemiIntensity: 0.78,
    nightSunIntensity: 0.72,
    // No fogEndCapM: night's own 100/440m clamp (resolveEffectiveFogRange)
    // already governs a night map's draw distance — a second cap here would
    // just fight it.
  },
  cairo: {
    // Central Cairo after dark, and the warmest night of the four. The city's
    // own dust is still the defining fact about its air — it just scatters
    // streetlight now instead of sun, so the horizon glows amber-brown where
    // London's glows violet and NYC's blue. The zenith stays a deep indigo so
    // the warmth reads as a ground-lit band low down rather than as dusk.
    skyTop: "#101728",
    // The dusty amber band stays, but dimmed from #42382a/#2c2823: fog
    // TINTS every wall beyond ~60 m, and at the old saturation the whole
    // middle distance read as the same amber wash the wall fixes had just
    // removed up close. The horizon keeps a step more warmth than the fog
    // so the skyline still glows Cairo without repainting the buildings
    // in front of it.
    skyHorizon: "#332d24",
    fogColor: "#232120",
    grassBase: "#27412b",
    grassAlt: "#325033",
    // Arid: Cairo's greens are irrigated islands, and they show the dust. The
    // dry tone runs much closer to the sand than the other cities' do.
    grassDeep: "#182c1e",
    grassDry: "#4f4a33",
    floraAccent: "#cbb98d",
    dirtShoulder: "#4b4232",
    silhouetteNear: "#2c2822",
    silhouetteFar: "#3f382d",
    // A warm moon: the "sun" runs at reduced intensity at night, and what
    // little of it survives Cairo's dust arrives warm — still the warmest
    // night sunTint of the four, but pulled back from the original #e6d4ad:
    // that amber on eleven warm wall families read as paint, not light.
    sunTint: "#d9cdb6",
    paved: true,
    groundBase: "#403c35",
    pavement: "#5f594c",
    night: true,
    // Was 0.8/0.74 — the brightest rig of the four, on the warmest building
    // palette of the four, and that pairing is what kept re-creating the
    // owner's "flat orange"/"sandy shade" wall complaint no matter which
    // surface got muted. Cairo's busy-past-midnight identity is carried by
    // what is LIT (the densest lamp set of the four, lit windows,
    // shopfronts, the crowd) rather than by wall-wide brightness. Now under
    // London/Tokyo's 0.78 and above NYC's 0.64 floor; the warm ground
    // bounce keeps the Cairo character. Retune only against night wall
    // screenshots (the palette block in proceduralFacades moves with this),
    // never in isolation.
    nightHemiIntensity: 0.7,
    nightSunIntensity: 0.64,
    // Inert for the live fog now — night's own 100/440 m clamp is tighter —
    // and kept for the same reason London's is: `auditMapVisualGaps`
    // deliberately measures sightlines against the DAY range, so dropping
    // this would widen that audit's reach 670 -> 1120 m. The number is still
    // Cairo's own dust haze, and the perf budget for its dense street wall:
    // the 1770x1830 world would otherwise draw to 1100 m — 2.4x the radius
    // NYC's density was priced under.
    fogEndCapM: 650,
  },
};

/**
 * Per-city visual profile, keyed by the map's exact, authored id. Deliberately
 * a record rather than a bare `mapId -> MapVisualKey` map: widened in place by
 * issue #291 with the palette/vehicle/nature/building/character selectors every
 * render-side seam needs, rather than each seam keeping its own mapId-sniffing
 * union or switch. `visualKey` stays first.
 *
 * `buildingSets`/`natureSets` are *allow-lists*, not full catalogues — the
 * catalogues (glb urls, placement configs) stay in `buildingSets.ts` /
 * `natureCatalog.ts`. `plateRegion` replaces `vehicleVisuals.ts`'s old
 * substring-matched `plateRegionForMap`; vehicle paint/model policy (which is
 * *content*, not identity) stays a small table in `vehicleVisuals.ts` itself,
 * keyed by `visualKey`. `complexionWeights`/`hairWeights` are moved here
 * verbatim from `characterPalettes.ts`, which was already keyed by this same
 * exact mapId — folding them in retires its separate silent-default fallback,
 * so an unmapped city now fails the same way for every field, not just some.
 */
export interface MapVisualProfile {
  readonly visualKey: MapVisualKey;
  /** Country whose plate format this map's vehicles wear. */
  readonly plateRegion: PlateRegion;
  /** Instanced building-set catalogues (`buildingSets.ts`) this city's block
   * content may draw from. Every map names at least one today; a district
   * left on procedural facades / landmark dispatch instead just never
   * references one of the sets listed here (Tokyo's ~1-in-4 street-wall
   * holdback parcels and its hand-authored quarter, as of the Tokyo
   * authenticity plan's P3b — every generator zone now names a set) — an
   * empty array isn't required for that. */
  readonly buildingSets: readonly BuildingSetId[];
  /** Park-planting catalogues (`natureCatalog.ts`) this city draws from. */
  readonly natureSets: readonly NatureSetId[];
  /**
   * How many of each `characterPalettes.ts` ramp entry a walker pool gets;
   * both sum to `CHARACTER_PALETTE_SLOTS`. A row is a rough read of who
   * actually walks that neighbourhood: the Upper West Side draws flat across
   * the complexion ramp, South Kensington leans a little lighter, Setagaya —
   * a ward of a city that is overwhelmingly Japanese, with a visible but
   * small international population — sits mostly in the upper half without
   * emptying the lower one, and Central Cairo keeps a broad local range with
   * a visible international population. Hair is deliberately not conditioned
   * on complexion (dyed/bleached hair is ordinary in all four cities), but
   * Setagaya and Cairo are both weighted almost entirely to black/dark brown,
   * with none of the blonde their populations don't bear out.
   */
  readonly complexionWeights: readonly number[];
  readonly hairWeights: readonly number[];
}

const MAP_VISUAL_PROFILES: Readonly<Record<string, MapVisualProfile>> = {
  "nyc-upper-west-side": {
    visualKey: "nyc",
    plateRegion: "us",
    buildingSets: ["nyc-downtown", "nyc-midrise", "nyc-brownstone", "nyc-house", "nyc-shop"],
    natureSets: natureSetsForMap("nyc"),
    complexionWeights: [4, 4, 4, 4, 4, 4],
    hairWeights: [7, 6, 4, 3, 3, 1],
  },
  "london-south-kensington": {
    visualKey: "london",
    plateRegion: "uk",
    buildingSets: [
      "london-terrace",
      "london-stucco",
      "london-highstreet",
      "london-city",
    ],
    natureSets: natureSetsForMap("london"),
    complexionWeights: [2, 3, 4, 5, 5, 5],
    hairWeights: [5, 6, 5, 3, 4, 1],
  },
  "tokyo-setagaya": {
    visualKey: "tokyo",
    plateRegion: "jp",
    // Tokyo authenticity plan: P2 wired the first two glb sets live, on
    // miyanosaka/yamashita/nishi and jp-nakamise-yokocho; P3b adds
    // tokyo-zakkyo (downtown + ring) and tokyo-manshon (riverside +
    // higashi); P6 adds tokyo-apato (Region C's own collector,
    // jp-sumiregaoka-dori) — see `tokyoRoadsideBuildingSet` in
    // cities/tokyo.ts for the exact zone/road->set mapping. Every generator
    // zone now names a set; only the ~1-in-4 holdback parcels and the
    // hand-authored quarter stay procedural.
    buildingSets: ["tokyo-house", "tokyo-shotengai", "tokyo-zakkyo", "tokyo-manshon", "tokyo-apato"],
    natureSets: natureSetsForMap("tokyo"),
    complexionWeights: [0, 1, 2, 6, 8, 7],
    hairWeights: [15, 5, 3, 1, 0, 0],
  },
  "cairo-central-nile": {
    visualKey: "cairo",
    plateRegion: "eg",
    buildingSets: ["cairo-corniche", "cairo-downtown", "cairo-zamalek", "cairo-westbank"],
    natureSets: natureSetsForMap("cairo"),
    complexionWeights: [3, 5, 6, 5, 4, 1],
    hairWeights: [12, 7, 3, 1, 0, 1],
  },
};

/**
 * Throws on an unrecognised id rather than guessing. The substring match
 * this replaced (`id.includes("cairo")`, falling back to `"nyc"` for anything
 * else) meant a typo'd or new map id silently borrowed NYC's night+paved
 * palette — lighting, fog, ground texture, sidewalk width and the crowd's
 * rail geometry all change with it — with nothing to say so.
 */
export function resolveMapVisualProfile(mapId: string): MapVisualProfile {
  const profile = MAP_VISUAL_PROFILES[mapId];
  if (!profile) {
    throw new Error(
      `resolveMapVisualProfile: no visual profile registered for map id ${JSON.stringify(mapId)}. Add an entry to MAP_VISUAL_PROFILES in visuals.ts.`,
    );
  }
  return profile;
}

export function resolveMapVisualKey(mapId: string): MapVisualKey {
  return resolveMapVisualProfile(mapId).visualKey;
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
 * Linear-fog band scaled to the map so small worlds fade gently at their
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
 * buildings (the worst-case spike), and it deepens the night mood. A day map
 * may cap its own far end through the palette's `fogEndCapM` — Cairo runs a
 * dust haze at 650 m where the size formula alone would see 1100 m, both for
 * the look (the city IS hazy) and because its density was never priced for
 * 2.4× NYC's draw radius. This is the single source of both tightenings —
 * the sky builder and the camera far plane must agree on where the world ends.
 */
export function resolveEffectiveFogRange(
  night: boolean,
  worldSize: VisualPoint,
  fogEndCapM?: number,
): FogRange {
  const range = resolveFogRange(worldSize);
  const cappedEnd =
    fogEndCapM !== undefined ? Math.min(range.end, fogEndCapM) : range.end;
  if (!night) return { start: Math.min(range.start, cappedEnd), end: cappedEnd };
  return {
    start: Math.min(range.start, 100, cappedEnd),
    end: Math.min(cappedEnd, 440),
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
  fogEndCapM?: number,
): number {
  return resolveEffectiveFogRange(night, worldSize, fogEndCapM).end + 20;
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
  readonly repairs: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    readonly darken: number;
  }[];
  readonly dust: readonly {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly alpha: number;
  }[];
}

export interface AsphaltTextureProfile {
  readonly noiseAmplitude: number;
  readonly crackCount: readonly [minimum: number, maximum: number];
  readonly crackSteps: readonly [minimum: number, maximum: number];
  readonly patchCount: readonly [minimum: number, maximum: number];
  readonly patchRadius: readonly [minimum: number, maximum: number];
  readonly patchLighten: readonly [minimum: number, maximum: number];
  readonly repairCount: readonly [minimum: number, maximum: number];
  readonly dustCount: readonly [minimum: number, maximum: number];
  readonly crackAlpha: number;
  readonly crackWidthPx: number;
  readonly paverGrid?: boolean;
}

const STANDARD_ASPHALT_PROFILE: AsphaltTextureProfile = {
  noiseAmplitude: 0.03,
  crackCount: [6, 9],
  crackSteps: [4, 7],
  patchCount: [2, 3],
  patchRadius: [0.035, 0.085],
  patchLighten: [0.015, 0.035],
  repairCount: [0, 0],
  dustCount: [0, 0],
  crackAlpha: 0.14,
  crackWidthPx: 2,
};

/** Cairo's road surface: accumulated utility cuts, dusty aggregate and
 * repairs, stronger at the 20 m world-planar tile than the shared subtle wear. */
export const CAIRO_ASPHALT_PROFILE: AsphaltTextureProfile = {
  noiseAmplitude: 0.085,
  crackCount: [16, 23],
  crackSteps: [5, 10],
  patchCount: [7, 11],
  patchRadius: [0.045, 0.18],
  patchLighten: [-0.025, 0.055],
  repairCount: [3, 5],
  dustCount: [70, 105],
  crackAlpha: 0.28,
  crackWidthPx: 2.4,
};

/** Cairo's pavement band: repaired concrete/interlocking pavers with dusty
 * joints. It is intentionally distinct from the road profile. */
export const CAIRO_SIDEWALK_PROFILE: AsphaltTextureProfile = {
  noiseAmplitude: 0.07,
  crackCount: [12, 18],
  crackSteps: [4, 8],
  patchCount: [8, 12],
  patchRadius: [0.035, 0.13],
  patchLighten: [-0.035, 0.045],
  repairCount: [2, 4],
  dustCount: [85, 125],
  crackAlpha: 0.22,
  crackWidthPx: 1.8,
  paverGrid: true,
};

const rangedCount = (
  random: () => number,
  range: readonly [number, number],
): number =>
  range[0] === range[1]
    ? range[0]
    : range[0] + Math.floor(random() * (range[1] - range[0] + 1));

/** Deterministic wear spec. The default profile preserves the shared subtle
 * road exactly; Cairo opts into the stronger profiles above at render time. */
export function buildAsphaltTextureSpec(
  seed: number,
  profile: AsphaltTextureProfile = STANDARD_ASPHALT_PROFILE,
): AsphaltTextureSpec {
  const random = seededUnit(seed);
  const cracks: AsphaltCrack[] = [];
  const crackCount = rangedCount(random, profile.crackCount);
  for (let crack = 0; crack < crackCount; crack += 1) {
    let x = random();
    let y = random();
    const points = [{ x, y }];
    const steps = rangedCount(random, profile.crackSteps);
    const drift = random() * Math.PI * 2;
    for (let step = 0; step < steps; step += 1) {
      const angle = drift + (random() - 0.5) * 1.6;
      x = (x + Math.cos(angle) * (0.03 + random() * 0.05) + 1) % 1;
      y = (y + Math.sin(angle) * (0.03 + random() * 0.05) + 1) % 1;
      points.push({ x, y });
    }
    cracks.push({ points });
  }
  const patches = Array.from({ length: rangedCount(random, profile.patchCount) }, () => ({
    x: random(),
    y: random(),
    r:
      profile.patchRadius[0] +
      random() * (profile.patchRadius[1] - profile.patchRadius[0]),
    lighten:
      profile.patchLighten[0] +
      random() * (profile.patchLighten[1] - profile.patchLighten[0]),
  }));
  const repairs = Array.from({ length: rangedCount(random, profile.repairCount) }, () => ({
    x: random(),
    y: random(),
    width: 0.08 + random() * 0.24,
    height: 0.018 + random() * 0.055,
    rotation: (random() - 0.5) * 0.7,
    darken: 0.08 + random() * 0.12,
  }));
  const dust = Array.from({ length: rangedCount(random, profile.dustCount) }, () => ({
    x: random(),
    y: random(),
    radius: 0.0015 + random() * 0.006,
    alpha: 0.025 + random() * 0.07,
  }));
  return {
    noiseSeed: Math.floor(random() * 0xffff) + 1,
    cracks,
    patches,
    repairs,
    dust,
  };
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
   * kerb — before the sidewalk rather than beyond its outer edge. **Every
   * night city's streetlight line sets it (0.7 m), and street lighting does
   * not work without it.** The default band puts a prop a metre BEYOND the
   * pavement's outer edge, which on a real street wall is inside the ground
   * floor of a building, so `blocks.some(isInside…)` rejects it: at the same
   * 26 m spacing it is the difference between London's 264 lamps and 1_076,
   * and between Cairo's 521 and 1_005.
   *
   * A kerb-seated candidate also skips the open-water and `roadCrossedRects`
   * rejections — it stands on its own road's kerb, which exists wherever the
   * road does: bridge decks and park drives included. It skips NOTHING else;
   * see the rejection block in `generateRoadsidePropPlacements` for the three
   * bugs that boundary cost.
   */
  readonly curbOffsetM?: number;
  readonly bothSides: boolean;
  /** Alternate sides along the road (streetlight rhythm). */
  readonly alternateSides?: boolean;
  readonly variants: number;
  /**
   * Which variant indices this line may actually draw, when the renderer's
   * variant set is wider than the map wants. Cairo's street trees pass
   * `[0, 2]` because `partsFor("tree", 1)` is a stacked-cone conifer and there
   * are no conifers in Cairo — narrowing `variants` to 2 would have excluded
   * variant 2 instead, which is a second broadleaf and perfectly wanted.
   *
   * Still exactly one seeded draw, like the plain `variants` path: the pool
   * indexes the draw, it does not add one. Every rejection test below is
   * likewise draw-free, so which variants a map allows can never shift the
   * stream for the kinds that follow it.
   */
  readonly variantPool?: readonly number[];
  /**
   * A second species for this same line, chosen once per **road** rather than
   * per prop, off the road's own width.
   *
   * Cairo's street trees are mostly palms, and the way that must NOT be done
   * is a per-prop coin flip: five palms and one lone broadleaf down the same
   * street reads as a bug, not as variety (the owner's words). Deciding per
   * road is what rules that out — a street is a palm avenue or a shade-tree
   * street end to end, never a mix.
   *
   * Width is the criterion, and not for want of a tidier one. A hash over the
   * road id was written first and thrown away: it is uniform but it is blind,
   * and the deal it happened to produce made Corniche el-Nil — the palm
   * avenue the whole city is known for — a broadleaf street, with no share
   * below 0.94 that fixed it. Width is the thing actually being described.
   * Cairo's carriageways separate at 9 m with nothing in the gap: every
   * waterfront drive and grand avenue is 9-16 m, every downtown lane 7.4-8.4,
   * so the boulevards take palms and the tight Wust el-Balad streets keep
   * their shade trees — which is also what the real city does. A road added
   * later obeys the rule by construction, where a hash would have re-rolled.
   *
   * `variants` is the substituted species' own variant count, because the two
   * species rarely share one (Cairo's palms are two imported models, its
   * procedural trees three shapes) — and because reusing the host's
   * `variantPool` would silently pin every swapped road to a single palm.
   */
  readonly roadSpecies?: {
    readonly kind: string;
    /** Roads at least this wide are planted with `kind` instead. */
    readonly minRoadWidthM: number;
    readonly variants: number;
  };
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
  /**
   * Ground nothing may stand on, whatever its seating. Authored landmark
   * rects, the rail right-of-way, service forecourts and venue lots all
   * arrive here (see `buildRoadsideProps`, which assembles them).
   */
  readonly landmarks: readonly PropScatterRect[];
  /**
   * Rects a **carriageway legitimately runs through** — a park with a drive
   * across it, a plaza. They reject an ordinary scatter candidate exactly like
   * a landmark rect does (a park lays its own planting; a street tree inside
   * one is double-planting), but a *kerb-seated* candidate passes: it is
   * standing on its own road's kerb, and that kerb is as real inside the park
   * as anywhere else.
   *
   * Separate from `landmarks` because that array is not one thing. It is the
   * union of authored landmarks, `railCorridorExclusionRects` and the
   * service/venue keep-outs, and the second and third of those must stop a
   * kerb-seated prop dead: a rail corridor crosses a carriageway BY
   * CONSTRUCTION at every level crossing, so a kerb-seated lamp on that road
   * gets a candidate right between the rails. Ten of them shipped across three
   * cities on a working tree that let kerb-seated candidates skip `landmarks`
   * wholesale — owner-reported, "a light post in the middle of the railroad".
   */
  readonly roadCrossedRects?: readonly PropScatterRect[];
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
      // One species per road (see `roadSpecies`), off the road's width rather
      // than the seeded stream, so this decision costs no draw and retuning
      // it can never re-deal the kinds authored after this one.
      const swap =
        kindConfig.roadSpecies &&
        surface.widthM >= kindConfig.roadSpecies.minRoadWidthM
          ? kindConfig.roadSpecies
          : null;
      const emitKind = swap ? swap.kind : kindConfig.kind;
      const variantPool = swap ? null : kindConfig.variantPool;
      const variantCount = swap
        ? swap.variants
        : (variantPool?.length ?? kindConfig.variants);
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
            const drawn = Math.floor(random() * variantCount);
            const variant = variantPool ? variantPool[drawn] : drawn;
            // **A kerb-seated candidate stands on its own road's kerb, and
            // that kerb exists wherever the road does** — over a river, through
            // a park. It is therefore exempt from exactly two tests, and only
            // those two:
            //
            // - Open water. The water polygon under a bridge deck runs beneath
            //   the carriageway, so every kerb lamp candidate on one "stood in
            //   the river" — which is how all three Sakuragawa bridges shipped
            //   pitch dark.
            // - `roadCrossedRects`. London's 902x631 m royal park swallowed
            //   the whole 749 m of Serpentine Road — one continuous unlit
            //   stretch of a road the player is invited to drive.
            //
            // **`landmarks` and `blocks` are never skipped**, and the reason is
            // worth stating: "a rect overlapping a carriageway must be
            // illustrative" is FALSE. A rail right-of-way crosses roads by
            // construction, and a forecourt keep-out sits on the kerb by
            // definition — exempting them put a lamp between the rails at four
            // Cairo crossings, five Tokyo ones and one London one, plus
            // fifteen more on filling-station forecourts. Only a rect the call
            // site has positively identified as road-crossed earns the pass.
            //
            // None of these rejection tests consume seeded draws, so which
            // candidates are accepted never shifts the stream for later kinds.
            const kerbSeated = kindConfig.curbOffsetM !== undefined;
            if (
              Math.abs(candidate.x) > halfWorldX ||
              Math.abs(candidate.z) > halfWorldZ ||
              !isClearOfRoads(
                candidate,
                surface.id,
                kindConfig.curbOffsetM,
              ) ||
              (!kerbSeated &&
                isOverWater(candidate, input.waterPolygons ?? [])) ||
              input.blocks.some((rect) => isInsideInflatedRect(candidate, rect)) ||
              input.landmarks.some((rect) =>
                isInsideInflatedRect(candidate, rect),
              ) ||
              (!kerbSeated &&
                (input.roadCrossedRects ?? []).some((rect) =>
                  isInsideInflatedRect(candidate, rect),
                )) ||
              gridHasNeighborWithin(grid, candidate, PROP_MIN_MUTUAL_SPACING_M)
            ) {
              continue;
            }
            gridInsert(grid, candidate);
            placements.push({
              kind: emitKind,
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

export interface PromenadeDecorInput {
  /** Every road surface on the map — non-open surfaces gap the promenade at
   * junctions and bridge approaches. */
  readonly roadSurfaces: readonly {
    readonly id: string;
    readonly centerline: readonly VisualPoint[];
    readonly widthM: number;
    readonly sidewalkWidthM?: number;
  }[];
  /**
   * Elevated deck footprints that offset props must clear. Kept separate from
   * `roadSurfaces` so those decks do not open an oversized station-base gap in
   * an otherwise continuous waterfront promenade.
   */
  readonly elevatedRoadSurfaces?: readonly {
    readonly id: string;
    readonly centerline: readonly VisualPoint[];
    readonly widthM: number;
    readonly sidewalkWidthM?: number;
  }[];
  readonly waterPolygons: readonly (readonly VisualPoint[])[];
  /** Road side(s) that face open water (cairoContent's
   * CAIRO_OPEN_WATERFRONT_SIDES shape). */
  readonly openSides: Readonly<
    Partial<Record<string, readonly (-1 | 1)[]>>
  >;
  readonly sidewalkWidthM: number;
  readonly worldSize: VisualPoint;
  readonly seed: number;
  /**
   * Prop kind for the promenade's signature tree line and its lamp role —
   * required, not defaulted, so a new caller can never inherit Cairo's palm/
   * streetlight by omission (the `cairoBridgePortalVisualAxis` "argument
   * discipline" lesson: an implicit default is how NYC's own parapets once
   * drifted 3.4 m from their colliders). Cairo passes `"palm"`/`"streetlight"`
   * (unchanged); Tokyo (Tokyo expansion Phase 9) passes `"sakura"`/
   * `"chochin-post"` for cherry trees and lanterns. Both kinds need their own
   * `DESTRUCTIBLE_PROP_CONFIGS` row and `render/roadsideProps.ts` `partsFor`
   * case — this function only ever emits the kind string, never draws it.
   */
  readonly treeKind: string;
  readonly lampKind: string;
  /** Optional deterministic tree variants for a city's waterfront species
   * mix. London passes broadleaf-only [0, 2], so the shared generic tree kind
   * cannot put conifers along the Thames. Cairo/Tokyo omit this and keep their
   * established two-variant rhythm byte-for-byte. */
  readonly treeVariants?: readonly number[];
  /**
   * Rail corridors the promenade must keep out of. The corniche strip is
   * exactly where a rail line pierces the bank at its bridge abutments, and
   * this deliberate line never went through the random scatter's rail
   * keep-outs — which is how a palm ended up standing inside the Imbaba
   * corridor's girder mouth (owner-reported). Optional so non-rail callers
   * and older tests stay unchanged; the live renderer always passes it.
   */
  readonly railLines?: readonly {
    readonly points: readonly VisualPoint[];
    readonly corridorHalfWidthM: number;
  }[];
  /**
   * Service forecourts and venue lots, exactly as `generateRoadsidePropPlacements`
   * receives them. The same argument as `railLines` above, one keep-out later:
   * the corniche strip is also where a filling station's apron reaches the
   * bank, and this deliberate line never went through the random scatter's POI
   * keep-outs either — which left one palm growing on a Cairo forecourt. Found
   * by auditing every placement against every keep-out rect rather than by
   * anyone spotting it from the car.
   */
  readonly keepOutRects?: readonly PropScatterRect[];
  /**
   * Building footprints inside the promenade band. Most waterfront roads keep
   * this ground wholly open, but Cairo deliberately intersperses short
   * river-side Corniche buildings with broad view corridors. A deterministic
   * furniture station that lands in one is shifted along the bank before it
   * is dropped, so adding a building never leaves a palm or lamp inside it.
   */
  readonly buildingRects?: readonly PropScatterRect[];
  /**
   * Optional final physical-clearance query for a fully authored prop. The
   * generic promenade generator knows road and water footprints, but only the
   * renderer knows the measured height/radius of an imported palm (and the
   * exact deck underside above it). A rejected placement is searched along
   * the same waterfront run before it is abandoned, preserving the asset
   * instead of letting the renderer silently filter it out afterward.
   */
  readonly canPlaceProp?: (placement: PropPlacement) => boolean;
  /** Minimum distance from the exact water-polygon edge. Building avoidance
   * may shift a station along a bending bank; this keeps that relocation off
   * the shoreline parapet instead of relying on the original cross-section. */
  readonly shorelineClearanceM?: number;
}

/** Extra clear metres a promenade piece keeps beyond a rail corridor's own
 * half-width — enough that a palm fan or lantern never overhangs the fence
 * line even at max prop scale. */
export const PROMENADE_RAIL_CLEARANCE_M = 2;
export const PROMENADE_SHORELINE_CLEARANCE_M = 2;

/**
 * The corniche promenade: a signature tree line, lamps and benches on the
 * bank strip between an open-waterfront road and its parapet. The roadside
 * scatter never reaches this ground — its lateral offsets hug the pavement
 * while the water sits 10-60 m out — so the signature of the real Corniche
 * el-Nil (a palm line at the parapet, benches facing the river) has to be
 * laid deliberately. Deterministic on `seed`; placements ride the same
 * masters, shadow and destructible registration as every other roadside
 * prop. `treeKind`/`lampKind` swap the species per map (Cairo's palm and
 * streetlight; Tokyo's cherry tree and chochin lantern) — the rhythm and
 * geometry below are shared, only the two prop-kind strings differ.
 *
 * Rhythm per ~13 m station along each open side: the tree kind every second
 * station at 3.2 m off the waterline, the lamp kind every fourth at 2.6 m,
 * benches every fifth at 4.5 m facing the water, and — where the bank runs
 * deeper than 20 m — a kerbside tree row every fourth station, the double
 * line the real Corniche plants. Stations gap themselves at any other road's
 * envelope (junctions, bridge portals) and wherever the bank pinches under
 * 6 m.
 */
export function generatePromenadeDecor(
  input: PromenadeDecorInput,
): PropPlacement[] {
  const placements: PropPlacement[] = [];
  const random = seededUnit(input.seed);
  const halfWorldX = input.worldSize.x / 2 - 4;
  const halfWorldZ = input.worldSize.z / 2 - 4;
  const waterEdges = input.waterPolygons.map((polygon) =>
    polygon.length > 0 ? [...polygon, polygon[0]] : polygon,
  );
  const shorelineClearanceM = input.shorelineClearanceM ?? 0;
  const STATION_M = 13;
  for (const surface of input.roadSurfaces) {
    const sides = input.openSides[surface.id];
    if (!sides?.length) continue;
    const envelope =
      surface.widthM / 2 + (surface.sidewalkWidthM ?? input.sidewalkWidthM);
    for (const side of sides) {
      let station = 0;
      let nextAt = STATION_M / 2;
      let travelled = 0;
      for (
        let index = 1;
        index < surface.centerline.length;
        index += 1
      ) {
        const start = surface.centerline[index - 1];
        const end = surface.centerline[index];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const segmentLength = Math.hypot(dx, dz);
        if (segmentLength < 1e-6) continue;
        const alongX = dx / segmentLength;
        const alongZ = dz / segmentLength;
        const outX = alongZ * side;
        const outZ = -alongX * side;
        while (nextAt <= travelled + segmentLength) {
          const alongM = nextAt - travelled + (random() - 0.5) * 6;
          nextAt += STATION_M;
          const stationIndex = station;
          station += 1;
          const baseX =
            start.x + alongX * Math.max(0, Math.min(segmentLength, alongM));
          const baseZ =
            start.z + alongZ * Math.max(0, Math.min(segmentLength, alongM));
          // Walk outward to the waterline; the strip between the pavement
          // and the water is the promenade.
          let waterDistM = 0;
          for (let reach = envelope + 1; reach <= 70; reach += 0.5) {
            if (
              isOverWater(
                { x: baseX + outX * reach, z: baseZ + outZ * reach },
                input.waterPolygons,
              )
            ) {
              waterDistM = reach;
              break;
            }
          }
          if (!waterDistM || waterDistM - envelope < 6) continue;
          // Gap at every other road's envelope: junctions and the bridge
          // approaches carry their own furniture and their own openings.
          const clearOfOtherRoadsAt = (roadPoint: VisualPoint): boolean =>
            input.roadSurfaces.every((other) => {
              if (other.id === surface.id) return true;
              const otherEnvelope =
                other.widthM / 2 +
                (other.sidewalkWidthM ?? input.sidewalkWidthM) +
                2;
              return (
                distanceToPolylineM(roadPoint, other.centerline) >
                otherEnvelope + 6
              );
            });
          // The ordinary station check above already opens the promenade at
          // at-grade junctions.  Re-check the actual offset prop only against
          // elevated structures: a deep waterfront strip can otherwise put a
          // palm beneath/inside a bridge whose centreline is clear of the road
          // base, while applying this second envelope to every ground street
          // would unnecessarily thin established promenade dressing map-wide.
          const clearOfElevatedRoadsAt = (candidate: VisualPoint): boolean =>
            (input.elevatedRoadSurfaces ?? input.roadSurfaces).every((other) => {
              if (
                other.id === surface.id ||
                !other.centerline.some(
                  (point) => (point.elevationM ?? 0) > 0.35,
                )
              ) {
                return true;
              }
              // This is a physical deck-footprint check, not the generous
              // junction opening used for the station base. Keep the existing
              // promenade rhythm right up to a flyover while rejecting only
              // props that would actually pierce its carriageway.
              const otherEnvelope = other.widthM / 2 + 0.5;
              return (
                distanceToPolylineM(candidate, other.centerline) >
                otherEnvelope
              );
            });
          if (!clearOfOtherRoadsAt({ x: baseX, z: baseZ })) continue;
          const drop = (
            kind: string,
            offsetM: number,
            rotationY: number,
            scale: number,
            variant: number,
          ): void => {
            const candidateAt = (
              shiftAlongM: number,
            ): { readonly x: number; readonly z: number } => ({
              x: baseX + alongX * shiftAlongM + outX * offsetM,
              z: baseZ + alongZ * shiftAlongM + outZ * offsetM,
            });
            const placementAt = (shiftAlongM: number): PropPlacement => {
              const candidate = candidateAt(shiftAlongM);
              return {
                kind,
                x: candidate.x,
                z: candidate.z,
                rotationY,
                scale,
                variant,
              };
            };
            const clearsFixedKeepOuts = (
              candidate: VisualPoint,
              shiftAlongM: number,
            ): boolean =>
              Math.abs(candidate.x) <= halfWorldX &&
              Math.abs(candidate.z) <= halfWorldZ &&
              clearOfOtherRoadsAt({
                x: baseX + alongX * shiftAlongM,
                z: baseZ + alongZ * shiftAlongM,
              }) &&
              !isOverWater(candidate, input.waterPolygons) &&
              (!shorelineClearanceM ||
                waterEdges.every(
                  (edge) =>
                    distanceToPolylineM(candidate, edge) >= shorelineClearanceM,
                )) &&
              !input.railLines?.some(
                (line) =>
                  distanceToPolylineM(candidate, line.points) <
                  line.corridorHalfWidthM + PROMENADE_RAIL_CLEARANCE_M,
              ) &&
              !input.keepOutRects?.some((rect) =>
                isInsideInflatedRect(candidate, rect),
              );
            const clearsRelocatableKeepOuts = (
              placement: PropPlacement,
            ): boolean =>
              clearOfElevatedRoadsAt(placement) &&
              (input.canPlaceProp?.(placement) ?? true);
            const blockedByBuilding = (candidate: VisualPoint): boolean =>
              Boolean(
                input.buildingRects?.some((rect) =>
                  isInsideInflatedRect(candidate, rect),
                ),
              );

            const original = placementAt(0);
            if (!clearsFixedKeepOuts(original, 0)) return;
            if (
              clearsRelocatableKeepOuts(original) &&
              !blockedByBuilding(original)
            ) {
              placements.push(original);
              return;
            }

            // Half-station steps land between the promenade's normal 13 m
            // rhythm. Alternate directions so a building never shifts every
            // affected piece to the same end, and cap the search at 26 m -- a
            // small local move, not furniture leaking into the next district.
            const tryRelocated = (shiftAlongM: number): boolean => {
              const moved = placementAt(shiftAlongM);
              if (
                !clearsFixedKeepOuts(moved, shiftAlongM) ||
                !clearsRelocatableKeepOuts(moved) ||
                blockedByBuilding(moved) ||
                placements.some(
                  (existing) =>
                    Math.hypot(existing.x - moved.x, existing.z - moved.z) < 3,
                )
              ) {
                return false;
              }
              placements.push(moved);
              return true;
            };
            const alongShiftsM = [
              6.5,
              -6.5,
              13,
              -13,
              19.5,
              -19.5,
              26,
              -26,
            ];
            for (const shiftAlongM of alongShiftsM) {
              if (tryRelocated(shiftAlongM)) return;
            }
          };
          if (stationIndex % 2 === 0) {
            const establishedVariant = stationIndex % 4 === 0 ? 1 : 0;
            const treeVariant = input.treeVariants?.length
              ? input.treeVariants[
                  establishedVariant % input.treeVariants.length
                ]
              : establishedVariant;
            drop(
              input.treeKind,
              waterDistM - 3.2,
              random() * Math.PI * 2,
              0.95 + random() * 0.25,
              // Variant 0 leads, every fourth station takes variant 1. For
              // Cairo that is the tall date palm with the short one as the
              // accent — the Corniche's own proportions, and the reason the
              // waterline row reads from the carriageway at all. (Tokyo's
              // sakura only tints its blossoms by variant, so the swap is
              // cosmetic there.)
              treeVariant,
            );
            if (stationIndex % 4 === 0 && waterDistM - envelope > 20) {
              drop(
                input.treeKind,
                envelope + 5,
                random() * Math.PI * 2,
                0.9 + random() * 0.2,
                input.treeVariants?.length
                  ? input.treeVariants[1 % input.treeVariants.length]
                  : 1,
              );
            }
          }
          if (stationIndex % 4 === 1) {
            drop(
              input.lampKind,
              waterDistM - 2.6,
              Math.atan2(-outX, -outZ),
              1,
              0,
            );
          }
          if (stationIndex % 5 === 3) {
            drop("bench", waterDistM - 4.5, Math.atan2(outX, outZ), 1, 0);
          }
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
