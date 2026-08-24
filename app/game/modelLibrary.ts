/**
 * Async glTF model library for vehicles, characters and props.
 *
 * Models are preloaded into per-scene {@link AssetContainer}s during setup, then
 * instantiated synchronously on demand. This lets the synchronous build paths
 * (`createVehicleMesh`, the character and prop builders) stay synchronous: each
 * asks whether a model is ready and, if so, instantiates it.
 *
 * There is no procedural fallback. A caller that asks before the container has
 * landed gets an empty placeholder (`createVehicleMesh`) or null (characters,
 * the crowd, props) — never stand-in geometry — and is upgraded in place once
 * the load settles. What keeps those placeholders off screen is the loading
 * gate: `markReady` only lifts after the preload has settled, so anything that
 * lifts it early ships invisible cars and people. A single failed load
 * therefore costs that one model, not the scene.
 *
 * Containers are keyed by URL (not by VehicleModel) so several models that share
 * one file — e.g. the sedan reused for the hatch and the recoloured taxi — load
 * that file only once.
 */
import {
  AssetContainer,
  InstantiatedEntries,
  LoadAssetContainerAsync,
  type Material,
  Scene,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import type { VehicleModel } from "./vehicleVisuals";

// Babylon 9 registers loaders as dynamic factories: the old
// `import "@babylonjs/loaders/glTF/2.0"` side effect no longer registers a
// plugin for LoadAssetContainerAsync (it silently returns no plugin, so every
// load throws and the caller falls back to procedural geometry). Register
// explicitly instead — once, lazily, on first preload.
let loadersRegistered = false;
function ensureLoadersRegistered(): void {
  if (loadersRegistered) return;
  registerBuiltInLoaders();
  loadersRegistered = true;
}

const CONTAINERS_BY_SCENE = new WeakMap<Scene, Map<string, AssetContainer>>();

function containersFor(scene: Scene): Map<string, AssetContainer> {
  let map = CONTAINERS_BY_SCENE.get(scene);
  if (!map) {
    map = new Map();
    CONTAINERS_BY_SCENE.set(scene, map);
  }
  return map;
}

/**
 * Loads every (de-duplicated) URL into the per-scene container cache. Failures
 * are logged and skipped so a missing or broken asset just leaves the affected
 * models on their procedural fallback. Resolves once all attempts have settled.
 *
 * `onProgress`, when given, reports a real (never simulated) 0..1 fraction:
 * each pending file contributes at most one equal-weighted unit — sized by its
 * own downloaded/total byte ratio where the server reports a length, capped at
 * 0.92 — and only reaches its full unit once that file's load has actually
 * settled (success or failure alike). Equal weighting per file, not per byte,
 * is deliberate: a handful of files (e.g. the character models) tend to settle
 * in the same tick because glTF parsing serialises on the main thread, and
 * weighting by byte size would make that cluster's jump proportional to its
 * share of total bytes — worse on a small map where a few files are a large
 * share. The 0.92 cap keeps a sliver of visible headroom for that per-file
 * parse tail (which fires no progress events of its own) rather than reading
 * 100% while the file is still settling.
 */
export async function preloadModels(
  scene: Scene,
  urls: readonly string[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  ensureLoadersRegistered();
  const map = containersFor(scene);
  const toLoad = [...new Set(urls)].filter((url) => !map.has(url));
  if (toLoad.length === 0) {
    onProgress?.(1);
    return;
  }
  const unitsDone = new Array(toLoad.length).fill(0);
  const report = () => {
    if (!onProgress) return;
    let sum = 0;
    for (const unit of unitsDone) sum += unit;
    onProgress(sum / toLoad.length);
  };
  await Promise.all(
    toLoad.map(async (url, index) => {
      try {
        const container = await LoadAssetContainerAsync(url, scene, {
          onProgress: (event) => {
            if (!event.lengthComputable || event.total <= 0) return;
            unitsDone[index] = Math.min(0.92, event.loaded / event.total);
            report();
          },
        });
        if (scene.isDisposed) {
          container.dispose();
          return;
        }
        map.set(url, container);
      } catch (error) {
        console.warn(`[modelLibrary] failed to load ${url}`, error);
      } finally {
        unitsDone[index] = 1;
        report();
      }
    }),
  );
}

export function isModelReady(scene: Scene, url: string): boolean {
  return CONTAINERS_BY_SCENE.get(scene)?.has(url) ?? false;
}

/**
 * Instantiates a preloaded model as independent geometry clones. Materials are
 * NOT cloned here (`cloneMaterials: false`): the caller replaces each mesh's
 * material with its own scene-consistent StandardMaterial (recoloured to the
 * vehicle's paint), so the shared source materials/textures on the container
 * stay untouched. `doNotInstantiate: true` yields real clones rather than
 * InstancedMeshes, which is required because InstancedMeshes cannot carry a
 * per-vehicle material override. Returns null when the model is not loaded,
 * signalling the caller to fall back to procedural geometry.
 */
export function instantiateModel(
  scene: Scene,
  url: string,
): InstantiatedEntries | null {
  const container = CONTAINERS_BY_SCENE.get(scene)?.get(url);
  if (!container) return null;
  return container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
}

/**
 * Instantiates a preloaded model as GPU **instances** that share the source
 * geometry (`doNotInstantiate: false`), for static scenery placed many times
 * over (buildings, vendors). Unlike {@link instantiateModel}, this keeps the
 * container's own materials (no per-unit recolour) and lets Babylon batch every
 * placement of a given model into one draw call per submesh regardless of count
 * — the only way "buildings everywhere" stays within a web draw-call budget.
 * The first call for a URL creates the source meshes; later calls create
 * `InstancedMesh`es pointing at them. Returns null when the model isn't loaded.
 */
export function instantiateModelInstanced(
  scene: Scene,
  url: string,
): InstantiatedEntries | null {
  const container = CONTAINERS_BY_SCENE.get(scene)?.get(url);
  if (!container) return null;
  return container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: false,
  });
}

/**
 * The (shared) materials of a preloaded model, so callers can retune them once —
 * e.g. add a night-time emissive glow to every building of a type. Empty when
 * the url hasn't loaded. Mutating these affects all instances of the model,
 * which is exactly what a per-model retune wants.
 */
export function modelMaterials(scene: Scene, url: string): Material[] {
  return CONTAINERS_BY_SCENE.get(scene)?.get(url)?.materials ?? [];
}

export function disposeModels(scene: Scene): void {
  const map = CONTAINERS_BY_SCENE.get(scene);
  if (!map) return;
  for (const container of map.values()) container.dispose();
  map.clear();
  CONTAINERS_BY_SCENE.delete(scene);
}

/**
 * Per-model import configuration. `bodyMaterialNames` lists the glTF material(s)
 * whose colour is replaced by the vehicle's paint (empty ⇒ keep the model's own
 * materials, e.g. the textured van). `scale` is a uniform factor chosen so the
 * model's length matches the SideSwap vehicle it stands in for; `yawOffset`
 * corrects the facing if the glTF import lands the model's front off +Z.
 */
export interface VehicleModelConfig {
  readonly url: string;
  readonly bodyMaterialNames: readonly string[];
  readonly scale: number;
  readonly yawOffset: number;
}

const V = "/models/vehicles";

/**
 * Maps each VehicleModel onto a CC0/CC-BY low-poly glb. The recolourable
 * Quaternius cars (CC0, solid `Blue`/`White` body material) cover the passenger
 * fleet; a recolourable CC-BY panel van (solid `bodywork` material) covers
 * delivery vans; a recolourable CC-BY single-deck bus (`039BE5`) covers city
 * buses, and a red Routemaster-style double-decker (LinderMedia, purchased Envato
 * licence; solid `body` material, OBJ recoloured to sensible part colours at
 * import) covers London. Scales are
 * length-matched to VEHICLE_DIMENSIONS. Most models import front-first (+Z,
 * yawOffset 0); the van imports front-along-+X, so it needs a -90° yawOffset.
 *
 * Ids describe the *role*, not the body: three of them resolve to the one
 * `sedan.glb` and differ only by scale, so `compact-hatch` is a saloon like the
 * rest of them. Career Mode calls it a "Compact sedan" for that reason — the id
 * stays as it is because it is persisted in the save.
 */
export const VEHICLE_MODEL_REGISTRY: Partial<
  Record<VehicleModel, VehicleModelConfig>
> = {
  "electric-fastback": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 1.08, yawOffset: 0 },
  "compact-hatch": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 0.95, yawOffset: 0 },
  "sport-sedan": { url: `${V}/sports.glb`, bodyMaterialNames: ["White"], scale: 1.15, yawOffset: 0 },
  "urban-crossover": { url: `${V}/suv.glb`, bodyMaterialNames: ["White"], scale: 1.03, yawOffset: 0 },
  "sport-wagon": { url: `${V}/suv.glb`, bodyMaterialNames: ["White"], scale: 1.06, yawOffset: 0 },
  "electric-taxi": { url: `${V}/sedan.glb`, bodyMaterialNames: ["Blue"], scale: 1.09, yawOffset: 0 },
  "delivery-van": { url: `${V}/van.glb`, bodyMaterialNames: ["bodywork"], scale: 0.85, yawOffset: -Math.PI / 2 },
  "city-bus": { url: `${V}/bus.glb`, bodyMaterialNames: ["039BE5"], scale: 0.24, yawOffset: 0 },
  "london-double-decker": { url: `${V}/london-double-decker.glb`, bodyMaterialNames: ["body"], scale: 0.0503, yawOffset: 0 },
};

/** De-duplicated list of every glb URL the registry references, for preloading. */
export function vehicleModelUrls(): string[] {
  return [
    ...new Set(
      Object.values(VEHICLE_MODEL_REGISTRY).map((config) => config.url),
    ),
  ];
}

const P = "/models/props";

/**
 * Per-prop import configuration for static environment models (gig venues + gas
 * stations). Unlike vehicles, props keep their own materials — no recolour — so
 * there is no material-name list. `scale` normalises the model to roughly its
 * on-map footprint; `yawOffset` corrects facing so the model's front lands toward
 * the road (the venue loop rotates the holder by the lane heading + this offset).
 */
export interface PropModelConfig {
  readonly url: string;
  readonly scale: number;
  readonly yawOffset: number;
  /** Vertical offset (m) applied to the holder. Negative sinks a model whose own
   * base/plinth would otherwise raise it above the road (e.g. the gas station,
   * which ships as a diorama on a raised lot). Defaults to 0. */
  readonly groundY?: number;
  /**
   * Regex source; child meshes whose name matches are disposed after import.
   * Some models ship as a diorama on a base slab that would read as a plinth
   * once the building is set on a real street.
   */
  readonly stripMeshPattern?: string;
  /**
   * Minimum centre height (m) for the board `addRoofSign` writes the venue's
   * name onto. Absent means this model gets no sign. Per-model because it
   * depends entirely on where that glb happens to put a flat facade — too low
   * and the search latches onto a window, too high and it finds nothing.
   */
  readonly roofSignMinY?: number;
  /**
   * Text area for the venue name, declared as an axis-aligned box in the glb's
   * own (native, unscaled) units — for models whose sign surface `addRoofSign`'s
   * geometric board search cannot find because it is merged into a larger
   * primitive. The name is lettered on a plane laid proud of the box's +Z-max
   * face (the face the model's own signage occupies), so unlike `roofSignMinY`
   * this writes one side only. Takes precedence over `roofSignMinY`.
   */
  readonly signBoard?: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /**
   * Mirrors the model across its local X axis on import. The glTF loader maps
   * right-handed glTF into left-handed Babylon with a reflection, which renders
   * any lettering baked into a model's texture back-to-front. Models carrying
   * painted signage set this to undo it. Babylon flips backface culling to match
   * a negative-determinant world matrix, so the model does not turn inside out.
   */
  readonly mirrorX?: boolean;
}

/**
 * Maps a venue/service kind to its low-poly building glb — keyed by the
 * ServicePoint kind ("gas_station") and by GigVenueKind. Any kind absent here,
 * or whose glb has not preloaded, falls back to the procedural box in GameCanvas.
 * All CC0/CC-BY low-poly glbs live under public/models/props/ (see CREDITS.md).
 */
export const PROP_MODEL_REGISTRY: Readonly<Record<string, PropModelConfig>> = {
  // Scales derived from each glb's measured bounding box (native sizes vary
  // wildly — the diner is authored at ~300 units, the shop at ~2) then set to a
  // sensible real-world footprint per building type.
  //
  // yawOffset makes the entrance face the road. The venue loop rotates the
  // holder by the lane heading `h` (the tangent, atan2(dx,dz)) plus this offset,
  // and sets the building back along `(cos h, -sin h)` — so the carriageway sits
  // at world yaw `h - π/2` from the building. The frame these offsets live in
  // is instantiateProp's, not the loader's: instantiateProp overwrites the
  // loader root's handedness scaling (1,1,-1) with a uniform scale, so only
  // the 180° Y-rotation half of the loader's flip survives — a front authored
  // on +Z lands on -Z in the placed frame, i.e. a native door facing of
  // `h + π` at offset 0. Solving `h + yawOffset + π ≡ h - π/2` gives
  // yawOffset = π/2, which turns every door/storefront to look across its
  // verge at the road. The gas station lands at the same offset independently
  // (its diorama forecourt faces the pumps to the lot's road edge).
  gas_station: { url: `${P}/gas-station.glb`, scale: 2.8, yawOffset: Math.PI / 2, groundY: -1.63, roofSignMinY: 4 },
  // Enlarged from 0.045 to read at a realistic size next to the avenue buildings.
  // groundY drops it back onto the road once its raised base platform (Box001)
  // is stripped: its body sits ~11.7 native units up, ×0.085.
  restaurant: {
    url: `${P}/restaurant.glb`,
    scale: 0.085,
    yawOffset: Math.PI / 2,
    groundY: -0.92,
    stripMeshPattern: "Box001",
    // The diner's own roof sign board: a white face (x -34.7..99.7,
    // y 51.8..84.0 at z 0.1) in a red frame — where the model's baked cursive
    // "Diner" script and its spear-through fin sat before
    // tools/clean-restaurant.mjs removed them (the import reflection rendered
    // the lettering back-to-front, and the fin both occluded runtime text from
    // oblique angles and forced it off-centre, #125). The venue name is
    // centred on the white face, lifted a touch above geometric centre so it
    // reads centred under the red top band; z spans the board solid
    // (-5.0..0.1) so the text lands proud of its road-facing face.
    signBoard: { min: [-30, 56, -5.0], max: [95, 82, 0.1] },
  },
  // A second restaurant so two diners on one map are visibly different places.
  // This glb already ships for the NYC street wall (buildingCatalog's
  // "Pizza Corner"), so the variety costs no new bytes. Its storefront is on
  // local +Z rather than the -Z the other props import with — the same fact
  // buildingSets records as `frontOffset: Math.PI` — so its yaw offset is a
  // half-turn round from the usual π/2.
  // No roofSignMinY: this model carries its own painted storefront branding and
  // has no sign board to overlay. The board search is geometric ("largest thin
  // elevated plate"), so pointing it at a building with no such plate makes it
  // pick the whole facade and render a name plane the size of a wall.
  "restaurant-pizzeria": {
    url: `${P}/nyc-shop-corner.glb`,
    scale: 8,
    // Its storefront fascia has "PIZZA" painted on, which the loader's
    // reflection renders back-to-front, so the model is mirrored back. That
    // moves the storefront to the opposite face, hence the extra half-turn on
    // top of this model's usual -π/2.
    yawOffset: Math.PI / 2,
    mirrorX: true,
  },
  shop: { url: `${P}/shop.glb`, scale: 4, yawOffset: Math.PI / 2 },
  residence: { url: `${P}/residence.glb`, scale: 2.6, yawOffset: Math.PI / 2 },
  // Cairo uses flat-roofed urban residences instead of the generic detached
  // house, and its own office/depot blocks instead of `office` below — that
  // model is Quaternius's "Big Building" and has a hipped roof, which is a
  // European shape Cairo's flat-roofed street simply does not have.
  //
  // All of these author their entrance on +Z — but that is measured in the
  // glb's AS-LOADED frame, and instantiateProp does not place models in that
  // frame. It overwrites the loader root's handedness scaling (1,1,-1) with a
  // uniform (s,s,s), so of the loader's flip only the 180° Y-rotation on the
  // same root survives — which turns an authored +Z entrance to -Z in the
  // placed frame, exactly like every other prop here. So they take the same
  // π/2 as the rest, NOT the -π/2 the as-loaded frame suggests: -π/2 stood
  // all 24 of these venues with their doors to the open land and their blank
  // backs on the pavement. Do not "verify" a venue yawOffset by measuring a
  // container under NullEngine without also wiping the root scaling the way
  // instantiateProp does — tests/cairoVisuals.test.ts now measures the placed
  // frame itself. (The street wall is the other frame: its merged masters bake
  // the intact reflection into vertices, hence `frontOffset: Math.PI` there
  // for the same +Z-authored models.)
  "cairo-residence-kay": {
    // Keep the venue loader on the corrected Cairo-only bytes too. Without the
    // revision, a browser that cached the old prop could retain its hydrant.
    url: `${P}/cairo-residence-kay.glb?rev=shopfront-v2`,
    scale: 5.5,
    yawOffset: Math.PI / 2,
  },
  "cairo-residence-quaternius": {
    url: `${P}/cairo-residence-quaternius.glb`,
    scale: 3.35,
    yawOffset: Math.PI / 2,
    groundY: 0.011,
  },
  // Cairo's own copy of `shop` below. Same model, but recoloured to the Cairo
  // palette, with the pack's diner-stripe awning flattened to one colour and its
  // bundled American fire hydrant deleted (tools/cairo-shopfront.mjs). `shop`
  // itself is untouched because NYC and London still place it.
  "cairo-shop": {
    url: `${P}/cairo-shop.glb?rev=shopfront-v2`,
    scale: 4,
    yawOffset: Math.PI / 2,
  },
  "cairo-office-block": {
    url: `${P}/cairo-office-block.glb`,
    scale: 2.4,
    yawOffset: Math.PI / 2,
    groundY: 0.059,
  },
  "cairo-depot": {
    url: `${P}/cairo-depot.glb`,
    scale: 2.4,
    yawOffset: Math.PI / 2,
    groundY: 0.038,
  },
  office: { url: `${P}/office.glb`, scale: 2.8, yawOffset: Math.PI / 2 },

  // ---- Tokyo authenticity plan P9 ("venue models' final polish") ----
  // `tokyo-konbini`/`tokyo-izakaya`/`tokyo-ramen` were catalogued since P1
  // but never wired as a venue's own `modelId` — every "Hoshi Mart"/ramen/
  // izakaya gig venue rendered through the generic `shop`/`restaurant`
  // fallback. Facing measured fresh, in THIS frame specifically (a NullEngine
  // probe replicating instantiateProp's own transform: instantiate, parent
  // under a holder rotated by yawOffset alone, overwrite root scaling to
  // (scale,scale,scale)) rather than translated from buildingSets.ts's own
  // PLACEMENTS entries for the same three models — cross-checking against
  // those confirmed the two frames' facing conventions do NOT share a fixed
  // offset (tokyo-izakaya's master-frame frontOffset -PI/2 does not map to
  // this frame's correct yawOffset via any single formula; the correct
  // answer here, 0, came from this model's own "Sign"/"Door Window"/"sign
  // support" submeshes sitting overwhelmingly on this frame's -X side at
  // yawOffset 0 — the SAME `PROP_MODEL_FOOTPRINTS_M`-frame convention
  // `tests/cairoVisuals.test.ts` checks, "entrance on the holder's
  // road-facing -X side"). Scale/groundY DO transfer from buildingSets.ts
  // (Y is untouched by either frame's handedness handling, so groundY is one
  // number regardless of pipeline).
  "tokyo-konbini": {
    url: `${P}/tokyo-konbini.glb`,
    scale: 1,
    // Confidence: HIGH -- live-verified (P10 final QA). The P1 aspect-ratio
    // reasoning that ruled out +-PI/2 was wrong: at yawOffset 0 every live
    // Hoshi Mart instance (jp-v46/v54/v58, all reachable via a delivery
    // pickup) rendered as a flat, featureless, textureless wall from its
    // venue's own approach pose -- not a facing tweak away from right, but
    // clearly the building's blind rear/side facing the street. A live CDP
    // drive-by around jp-v46 confirmed the model's real striped-awning/
    // bench/vending-machine frontage sits on a DIFFERENT face than the
    // {0, PI} candidates ever considered; testing all four multiples of
    // PI/2 from the venue's actual recorded approach pose isolated PI/2 as
    // the only one that puts that frontage on the road side (screenshots:
    // scratchpad p10-konbini-yawtest-shots/). PROP_MODEL_FOOTPRINTS_M's
    // entry is the same box rotated 90 deg to match (re-measured live, not
    // estimated) -- re-measure both together if this ever moves again.
    yawOffset: Math.PI / 2,
    groundY: 0.1,
  },
  "tokyo-izakaya": {
    url: `${P}/tokyo-izakaya.glb`,
    scale: 0.01,
    // Confidence: HIGH — measured directly (see header): the "Sign"/"Door
    // Window"/"sign support" submeshes' combined vertex centroid sits at
    // world (-3.40, 1.12) in this exact frame at yawOffset 0, an
    // overwhelmingly -X-dominant bias (cairoVisuals.test.ts's own bar),
    // while every other candidate in {+-PI/2, PI} either flips the sign or
    // makes the bias Z-dominant instead of X-dominant.
    yawOffset: 0,
    groundY: 0,
  },
  "tokyo-ramen": {
    url: `${P}/tokyo-ramen.glb`,
    scale: 0.01,
    // Confidence: VERIFIED (2026-08-15, live four-side chase-cam check of
    // the placed "Tsukimi Ramen" venue — the check the P1/P9 comments here
    // deferred). -PI/2 is correct: the open counter (stools, service bar,
    // kanji sign boards, chochin eave lanterns) squarely faces the street,
    // and the opposite side is a blank timber back wall into the block.
    // The original tie-break between {+PI/2, -PI/2} (aspect-ratio
    // reasoning, buildingSets.ts's own tokyo-ramen entry) happened to pick
    // the right one — but note the konbini precedent where that same class
    // of reasoning wrongly ELIMINATED the true answer; the live check is
    // the evidence, the aspect argument only ever narrowed candidates.
    yawOffset: -Math.PI / 2,
    groundY: 2.6,
  },
};

/** De-duplicated list of every prop glb URL the registry references, for preload. */
export function propModelUrls(): string[] {
  return [
    ...new Set(Object.values(PROP_MODEL_REGISTRY).map((config) => config.url)),
  ];
}
