import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  biasCairoDecalMaterials,
  CAIRO_STREET_WALL_URL_RE,
} from "../geometry/cairoParkland";
import {
  biasLondonDecalMaterials,
  LONDON_QUATERNIUS_STREET_WALL_URL_RE,
} from "../geometry/londonBuildingDecals";
import {
  biasTokyoBlockDecalMaterials,
  TOKYO_QUATERNIUS_BLOCK_URL_RE,
} from "../geometry/tokyoBuildingDecals";
import { buildingPlacementConfig } from "../buildingSets";
import { buildingStructuralBoundsFor } from "../buildingStructuralBounds";
import { ARABIC_CANVAS_FONT_FAMILY } from "../arabicFont";
import { MERGE_INCOMPATIBLE_MODEL_IDS } from "../buildingCatalog";
import type { PlannedAssetBuilding } from "../geometry/buildingLayout";
import {
  instantiateModel,
  instantiateModelInstanced,
  modelMaterials,
} from "../modelLibrary";
import { createFacadeBox } from "./meshPrimitives";
import { BUILDING_GROUND_LIFT } from "./renderConstants";
import {
  pickStorefrontVariant,
  STOREFRONT_MODEL_ID,
  type StorefrontVariant,
} from "../storefronts";
import { assembleStorefrontVariantMaster } from "../storefrontMaster";
import { hashStringToSeed } from "../visuals";
import type { BuildingRepresentationRecord } from "./buildingRepresentation";

/**
 * The once-per-map instanced-glb building system: takes the exact
 * `PlannedAssetBuilding` entries `geometry/buildingLayout.ts` already
 * decided (position, yaw, scale, keep-out survivorship — nothing here
 * recomputes occupancy), dresses each with an instanced glb — merged-master
 * `createInstance` for an ordinary model (re-branding the one retail model
 * into a mix of storefront variants), per-submesh `instantiateModelInstanced`
 * for a `MERGE_INCOMPATIBLE_MODEL_IDS` one (`instantiateViaSubmeshes`,
 * `Mesh.MergeMeshes` throws on these) — and falls back to an exact per-solid
 * opaque proxy — never a hole, never a whole-block alternate grid — for any
 * entry whose model was unavailable, forced unavailable
 * (`DebugBuildingAssetPolicy`, dev/test-only), or fraction-thinned on a weak
 * device. De-methodized into a collaborator class (issue #288), matching
 * Phase 3's `WaterLayer`/`Destructibles`/`CutsceneDirector` shape.
 *
 * `setPlan` replaces the old `enqueueBlock`-during-the-block-loop queue: the
 * plan already exists in full before `buildScenarioEnvironment` runs (built
 * once in the `BabylonGameSession` constructor), so there is nothing left to
 * collect block by block — the caller just hands over the asset-slot subset
 * once, and `instantiate()` (still only reachable once the async model
 * preload settles, from `buildInstancedBuildings`) walks it flat, entry by
 * entry, never block by block. A failed or forced-unavailable model can
 * therefore never suppress or rename its successful neighbours: no
 * survivor's fallback state depends on any other entry's outcome.
 *
 * Three things this class deliberately does **not** own, all threaded
 * through `BuildingLayerInstantiateCtx` instead — the same "explicit inputs,
 * not reaching into the session" shape every Phase 3 collaborator uses:
 *
 * - **`getBuildingMaster`** (the merged-master-per-url cache). Despite the
 *   name, it is not building-specific: `WaterLayer.instantiatePendingBoats`,
 *   the vendor-cart loop and `buildParkPlanting` all call the *same* session
 *   method for their own unrelated masters (boats, carts, trees). It stays a
 *   session method, passed in as a plain callback. (`getStorefrontMaster` is
 *   the opposite case — nothing outside the building-placement loop ever
 *   calls it — so it and its own cache (`storefrontMasters`) live here
 *   outright, no longer sharing the session's `buildingMasters` map.)
 * - **`buildingAssetDetailFraction`**. Building-only (unlike the old
 *   `buildingKeepFraction` it replaces): `buildAmbientCrowd`/`roadsideProps.ts`
 *   keep reading the session's separate `sceneryKeepFraction` instead — see
 *   `geometry/buildingLayout.ts`'s plan and Section 7.6 of the parity plan
 *   for why the two must never be the same knob again. Structural occupancy
 *   (which XZ footprints exist) never varies with either fraction; only
 *   which entries get a real glb versus an exact proxy box does.
 * - **`materialFor`**. `ProceduralFacades` already owns the per-materialKey
 *   palette/cache every procedural box uses; a proxy box reuses it (via this
 *   callback) so a low-spec London brick terrace's proxy reads as brick, not
 *   a colour-blind grey placeholder.
 *
 * **Call-order note, because it is load-bearing:** `instantiate()` must run
 * from the exact point `buildInstancedBuildings`'s own body used to — after
 * the async model preload settles. It draws no randomness of its own
 * (`pickStorefrontVariant` derives its own local seed from a pure per-string
 * hash, never from a shared stream), so nothing here can perturb any other
 * seeded draw no matter when it runs.
 */

/**
 * `emissiveIntensity` for a lit window pane (`applyNightGlow` case 2).
 *
 * **This number is only readable against the wall beside it.** It was 0.72
 * back when every facade emitted its own albedo, so a pane had to shout to
 * out-read a glowing wall. With walls returned to being lit by the scene, the
 * same 0.72 blows the pane out to a flat white-yellow rectangle under night's
 * 1.55 exposure and the legacy 0.72 bloom threshold — the window stops
 * looking like a room and starts looking like a sticker. This is the shared
 * fallback; every shipped palette now pairs its own restrained pane intensity
 * with its own bloom threshold, so either value must be retuned against its
 * wall, never in isolation.
 */
const WINDOW_GLOW = 0.34;

/** Material-name aliases verified as actual panes in the shipped kits. */
export function isNightWindowMaterialName(name: string): boolean {
  return /window|glass|cristal/.test(name.toLowerCase());
}

/**
 * Cairo's kit gets NO special night wall treatment. Every incarnation of
 * one — the albedo-glow fallback, a flat constant kit emissive, a
 * height-pooled "floodlit" emissive with a compensating albedo mute — was
 * owner-rejected as the same complaint (an orange/sandy wash painted over
 * the buildings' real colours; four reports as of 2026-08-17). The sand
 * itself turned out to be baked into the kit by the v1 styling pass, since
 * retired (`tools/style-cairo-residences.mjs` restores the imported models'
 * real colours). The kit now reads exactly like every other city's: real
 * albedo under the scene rig, lit panes from `applyNightGlow`, and Cairo's
 * night identity carried by what is genuinely lit — lamps, windows,
 * shopfronts and the Corniche towers' neon crowns.
 */
const CAIRO_TOWER_URL_RE = /\/cairo-tower-[ab]\.glb$/;

/** Rooftop neon signs for the Corniche towers — the bank-and-hotel crowns
 * of the owner's Nile reference photos. Arabic is safe here: GameCanvas
 * awaits the bundled Arabic canvas font before a Cairo session constructs. */
const CAIRO_CROWN_SIGNS: readonly {
  readonly text: string;
  readonly color: string;
}[] = [
  { text: "بنك القاهرة", color: "#39e07a" },
  { text: "فندق النيل", color: "#48c8ff" },
  { text: "بنك مصر", color: "#ffc23e" },
  { text: "مصر للتأمين", color: "#ff5748" },
  { text: "شركة النصر", color: "#39e07a" },
  { text: "فندق أم كلثوم", color: "#48c8ff" },
];

/** Test/development-only forced-unavailable policy, evaluated before any URL
 * discovery or load attempt — plan Section 7.7. Production omits it and
 * follows normal loading; never exposed as a player setting. A forced model
 * makes no network request and follows the same proxy/readiness path as a
 * real load failure. */
export interface DebugBuildingAssetPolicy {
  readonly unavailableModelIds: "all" | readonly string[];
}

export interface BuildingLayerInstantiateCtx {
  /** Whether this map's palette is a night city — gates `applyNightGlow`. */
  readonly night: boolean;
  /** Optional per-palette pane intensity; omitted maps keep `WINDOW_GLOW`. */
  readonly nightWindowGlowIntensity?: number;
  /** This map's building-set glb urls (preloaded off the critical path) —
   * also what `applyNightGlow` and the Cairo decal bias pass iterate. */
  readonly buildingModelUrls: readonly string[];
  /** Fraction of asset-slot entries that attempt their real glb; the rest
   * render an exact per-solid proxy. `entry.assetDetailScore < fraction`
   * (with the `fraction >= 1` fast path) is strict, matching the plan's
   * `buildingSets.ts` `assetDetailScoreForBlockSlot` formula exactly —
   * see the class doc comment for why this is a building-only knob now. */
  readonly buildingAssetDetailFraction: number;
  /** Cairo's rooftop clutter masters, or null on every other map. */
  readonly cairoRoofClutterMasters: {
    readonly tank: Mesh;
    readonly dish: Mesh;
  } | null;
  /** Nodes to freeze once, after the first render — shared with every other
   * static-scenery builder in `buildScenarioEnvironment`. */
  readonly staticSceneryFreeze: TransformNode[];
  /** The session's shared merged-master-per-url cache; see the class doc
   * comment for why this class does not own it. */
  readonly getBuildingMaster: (
    url: string,
    squareUpYaw?: number,
  ) => Mesh | null;
  /** `ProceduralFacades.materialFor` — see the class doc comment. */
  readonly materialFor: (materialKey: string) => StandardMaterial;
  /** Files a static mesh into the spatial hash the shadow/mirror rings read;
   * always called with `castsShadow: false` here — the instanced street wall
   * deliberately casts no sun shadow (see rendering.md). */
  readonly registerStaticCell: (
    mesh: AbstractMesh,
    x: number,
    z: number,
    castsShadow: boolean,
  ) => void;
  /** Records what actually stands for one planned entry — queried by tests
   * and the debug hook. See `render/buildingRepresentation.ts`. */
  readonly registerRepresentation: (
    record: BuildingRepresentationRecord,
  ) => void;
  /** Test/development-only; absent in production. */
  readonly debugAssetPolicy?: DebugBuildingAssetPolicy;
}

export class BuildingLayer {
  private plannedEntries: readonly PlannedAssetBuilding[] = [];
  /** Per-`${url}#${variant.id}` re-branded storefront master. Its own cache,
   * separate from the session's `getBuildingMaster` one — see the class doc
   * comment. `undefined` = not yet attempted; `null` = attempted and failed
   * (falls back to the plain building master for that url). */
  private readonly storefrontMasters = new Map<string, Mesh | null>();
  private readonly storefrontSignMaterials = new Map<
    string,
    StandardMaterial
  >();
  private readonly crownSignMaterials = new Map<number, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  /** Every distinct asset-slot url the plan references — lets the session
   * compute this map's building-glb preload list from the plan itself
   * (Section 7.7), before any entry has actually loaded. */
  get plannedUrls(): readonly string[] {
    return [...new Set(this.plannedEntries.map((entry) => entry.url))];
  }

  /** The plan's asset-slot entries to dress once models preload — replaces
   * the old per-block `enqueueBlock` queue (see the class doc comment). */
  setPlan(entries: readonly PlannedAssetBuilding[]): void {
    this.plannedEntries = entries;
  }

  /**
   * Night city: light the windows, never the walls. Mutates the shared
   * container materials once, before any master is merged or any instance is
   * created — all instances of a model light up together.
   *
   * Every building material falls into exactly one of three cases, tested in
   * this order:
   *
   * 1. **The model brought its own emissive map.** The Tokyo zakkyo pack and
   *    `tokyo-izakaya` ship a hand-painted night layer — lit panes, neon,
   *    shopfront signage, black everywhere else — and `tokyo-shop-b` /
   *    `tokyo-house-d` ship authored emissive *colours* on their sign and
   *    porch-lamp materials. Nothing computed here can improve on an artist's
   *    own night pass, so an authored emissive is left exactly as it arrived.
   * 2. **A glass material**, by name. Its albedo is forced dark and only the
   *    warm emissive shows: otherwise the pane's own (light) albedo, lit by
   *    the sky, washes it out to white instead of reading as a lit room.
   * 3. **Everything else is a wall**, and a wall emits nothing — it is lit by
   *    the moonlit hemi/sun and the streetlights like every other surface.
   *    Walls arrive with a zero `emissiveFactor`, so this case is a no-op and
   *    needs no branch; case 1 is what keeps it from stealing case 2's job.
   *
   * **Never synthesise a glow for a model whose windows you cannot find.** The
   * fallback this replaced set `emissive = warm x the model's own albedo
   * texture` on every material of every single-texture model. Three things go
   * wrong at once: emissive proportional to albedo lights a facade hardest
   * where it is *brightest*, so it lights the plaster and leaves the glass
   * dark — the exact inverse of a lit building; emissive ignores the light
   * direction, so the sunlit face, the shaded face, the roof and the underside
   * of an awning all come out identical and the model loses its shading; and
   * feeding a texture that already carries baked top-light/bottom-dark shading
   * back in as light cancels the depth it was painted to give. Measured on
   * King's Road it was half of a wall's warmth and a quarter of its
   * brightness, and it is what made 2_873 NYC and 2_726 Tokyo buildings read
   * as flat orange card. Worse, it *overwrote* the models that already got
   * this right — case 1 exists because that fallback was silently replacing
   * the zakkyo pack's hand-painted night maps with warm x albedo.
   *
   * Recovering a window mask from these atlases was tried three ways — a
   * luminance/saturation threshold, geometry-weighted texel classification
   * (which faces are vertical), and per-swatch identification on the KayKit
   * colour sheet — and none is reliable: the glass shares its swatch with the
   * stall riser and the awning, and the photographic facades' windows are not
   * separable from wood, doors or roofs. A model with no glass material
   * therefore has no lit windows, and that is the honest result: it is lit by
   * the street, exactly like every other wall in the scene.
   */
  private applyNightGlow(
    buildingModelUrls: readonly string[],
    windowGlowIntensity = WINDOW_GLOW,
  ): void {
    // Warm sodium/incandescent colour for lit windows (blue-hour amber). Kept
    // below pure white so bloom softens it to a glow instead of blowing it out.
    const WARM = new Color3(0.95, 0.6, 0.29);
    // A lit window is a dark pane that only glows warm — see case 2 above.
    const DARK_PANE = new Color3(0.05, 0.045, 0.04);
    for (const url of buildingModelUrls) {
      for (const mat of modelMaterials(this.scene, url)) {
        const m = mat as unknown as {
          albedoColor?: Color3;
          diffuseColor?: Color3;
          emissiveColor?: Color3;
          emissiveTexture?: unknown;
          emissiveIntensity?: number;
        };
        const authored =
          m.emissiveTexture != null ||
          (m.emissiveColor != null &&
            m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b > 0.001);
        if (authored) continue;
        // `cristal` is glass in the Spanish-authored `tokyo-house-d`; its
        // `Ventana` is the frame, not the pane, so window-in-another-language
        // names are added one confirmed asset at a time, never speculatively.
        if (!isNightWindowMaterialName(mat.name ?? "")) continue;
        if (m.albedoColor) m.albedoColor = DARK_PANE.clone();
        if (m.diffuseColor) m.diffuseColor = DARK_PANE.clone();
        m.emissiveColor = WARM.clone();
        if (typeof m.emissiveIntensity === "number") {
          m.emissiveIntensity = windowGlowIntensity;
        }
      }
    }
  }

  /**
   * A variant master for the one retail glb: same merged-master shape as
   * `getBuildingMaster`, but with the baked "PIZZA" lettering swapped for the
   * variant's fascia sign and awning tint (storefrontMaster.ts) so streets
   * carry a mix of businesses instead of a row of identical pizzerias (#146).
   * Any assembly failure falls back to the plain building master — baked
   * pizza beats a missing building.
   */
  private getStorefrontMaster(
    url: string,
    variant: StorefrontVariant,
    ctx: BuildingLayerInstantiateCtx,
  ): Mesh | null {
    const key = `${url}#${variant.id}`;
    const cached = this.storefrontMasters.get(key);
    if (cached !== undefined) return cached;
    let master: Mesh | null = null;
    const instance = instantiateModel(this.scene, url); // real clones, mergeable
    const root = instance?.rootNodes[0] as TransformNode | undefined;
    if (root) {
      root.computeWorldMatrix(true);
      const meshes = root
        .getChildMeshes(false)
        .filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
        );
      for (const mesh of meshes) mesh.computeWorldMatrix(true);
      master = meshes.length
        ? assembleStorefrontVariantMaster(
            this.scene,
            meshes,
            variant,
            this.getStorefrontSignMaterial(variant),
            { nightGlow: ctx.night },
          )
        : null;
      root.dispose(false, false);
      if (master) {
        master.isVisible = false;
        master.isPickable = false;
      }
    }
    master ??= ctx.getBuildingMaster(url);
    this.storefrontMasters.set(key, master);
    return master;
  }

  /** One DynamicTexture sign material per variant, shared by both of its
   * fascia planes and every instance — the addRoofSign recipe (emissive so it
   * reads on the night map, no culling so a winding flip can't drop it). */
  private getStorefrontSignMaterial(
    variant: StorefrontVariant,
  ): StandardMaterial {
    const cached = this.storefrontSignMaterials.get(variant.id);
    if (cached) return cached;
    const texture = new DynamicTexture(
      `storefront-sign-${variant.id}-texture`,
      { width: 512, height: 128 },
      this.scene,
      true,
    );
    const context = texture.getContext();
    let fontSize = 88;
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    while (
      fontSize > 24 &&
      context.measureText(variant.signText).width > 512 * 0.86
    ) {
      fontSize -= 6;
      context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    }
    texture.drawText(
      variant.signText,
      null,
      null,
      `bold ${fontSize}px Figtree, Arial, sans-serif`,
      variant.signFg,
      variant.signBg,
      true,
    );
    context.strokeStyle = variant.signFg;
    context.lineWidth = 6;
    context.strokeRect(8, 8, 512 - 16, 128 - 16);
    texture.update();
    const material = new StandardMaterial(
      `storefront-sign-${variant.id}`,
      this.scene,
    );
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.55, 0.55, 0.55);
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    this.storefrontSignMaterials.set(variant.id, material);
    return material;
  }

  /**
   * Cairo's skyline is water tanks and satellite dishes, and the glb street wall
   * has neither — the procedural facade boxes it replaced grew them per cell.
   * Roofs are far from incidental here: the 6th October corridor is elevated, so
   * the player looks down on them.
   *
   * Only models carrying a `roofY` are dressed (the KayKit walk-ups model their
   * own tank; the Corniche hotels should not have one at all). Deterministic on
   * the placement (modelId + rounded x/z) so a reload puts the same clutter on
   * the same roofs; mesh naming uses the plan's own stable `renderOrdinal`
   * rather than a runtime placement counter (Section 7.7 — a failed neighbour
   * must never rename a successful instance's roof clutter).
   */
  private addCairoRoofClutter(
    building: PlannedAssetBuilding,
    ctx: BuildingLayerInstantiateCtx,
  ): void {
    const masters = ctx.cairoRoofClutterMasters;
    const roofY = buildingPlacementConfig(building.modelId)?.roofY;
    if (!masters || roofY === undefined) return;
    const roll =
      hashStringToSeed(
        `${building.modelId}-${Math.round(building.x)}-${Math.round(building.z)}`,
      ) % 4;
    if (roll >= 2) return;
    const tank = roll === 0;
    const master = tank ? masters.tank : masters.dish;
    const inst = master.createInstance(
      `cairo-roof-${building.renderOrdinal}-${roll}`,
    );
    // Offset off-centre so a run of buildings does not line its tanks up in a
    // perfectly straight row down the street.
    const offset = ((building.renderOrdinal % 3) - 1) * 1.4;
    inst.position.set(
      building.x + offset,
      roofY + (tank ? 0.8 : 0.55),
      building.z + offset * 0.6,
    );
    inst.rotation.y = building.yaw + (roll === 1 ? 0.5 : 0);
    if (!tank) inst.rotation.x = -0.7;
    inst.isPickable = false;
    ctx.staticSceneryFreeze.push(inst);
    ctx.registerStaticCell(inst, building.x, building.z, false);
  }

  private getCrownSignMaterial(variant: number): StandardMaterial {
    const cached = this.crownSignMaterials.get(variant);
    if (cached) return cached;
    const sign = CAIRO_CROWN_SIGNS[variant % CAIRO_CROWN_SIGNS.length];
    const texture = new DynamicTexture(
      `cairo-crown-${variant}-texture`,
      { width: 512, height: 128 },
      this.scene,
      true,
    );
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.fillStyle = "#0a0a0c";
    context.fillRect(0, 0, 512, 128);
    context.font = `bold 74px ${ARABIC_CANVAS_FONT_FAMILY}, Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = sign.color;
    context.fillText(sign.text, 256, 68);
    context.strokeStyle = sign.color;
    context.lineWidth = 5;
    context.strokeRect(10, 10, 492, 108);
    texture.update();
    const material = new StandardMaterial(`cairo-crown-${variant}`, this.scene);
    material.diffuseTexture = texture;
    material.diffuseColor = new Color3(0.1, 0.1, 0.1);
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(1, 1, 1);
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    this.crownSignMaterials.set(variant, material);
    return material;
  }

  /** One neon rooftop sign per Corniche tower, colour and name hashed on the
   * placement so reloads agree. A single quad per tower; the shared
   * per-variant material blooms under the night pipeline. */
  private addCornicheCrown(
    entry: PlannedAssetBuilding,
    ctx: BuildingLayerInstantiateCtx,
  ): void {
    const bounds = buildingStructuralBoundsFor(entry.modelId);
    if (!bounds) return;
    const variant =
      hashStringToSeed(`crown-${Math.round(entry.x)}-${Math.round(entry.z)}`) %
      CAIRO_CROWN_SIGNS.length;
    const plate = MeshBuilder.CreatePlane(
      `cairo-crown-${entry.renderOrdinal}`,
      { width: 14, height: 3.4 },
      this.scene,
    );
    plate.position.set(entry.x, bounds.proxyHeightM + 2.5, entry.z);
    plate.rotation.y = entry.yaw + Math.PI;
    plate.material = this.getCrownSignMaterial(variant);
    plate.isPickable = false;
    ctx.staticSceneryFreeze.push(plate);
    ctx.registerStaticCell(plate, entry.x, entry.z, false);
  }

  private isForcedUnavailable(
    modelId: string,
    ctx: BuildingLayerInstantiateCtx,
  ): boolean {
    const policy = ctx.debugAssetPolicy;
    if (!policy) return false;
    return (
      policy.unavailableModelIds === "all" ||
      policy.unavailableModelIds.includes(modelId)
    );
  }

  /**
   * Instances every submesh of a `MERGE_INCOMPATIBLE_MODEL_IDS` model
   * directly (`instantiateModelInstanced`, `modelLibrary.ts`) rather than
   * through `getBuildingMaster`'s `Mesh.MergeMeshes` recipe, which throws
   * on any of them (heterogeneous submesh vertex-attribute layouts — see
   * `buildingCatalog.ts`'s own doc comment on that set, and
   * `tokyoStreetFurniture.ts`'s parked bicycles for the same failure mode
   * on a non-building glb). Mirrors that bicycle recipe: a wrap
   * `TransformNode` carries position/yaw/`squareUpYaw` (baked into the
   * merged master at bake time on the ordinary path, so it has to be
   * applied here instead, on every placement, since there is no shared
   * master to bake it into once), the instanced root carries scale.
   *
   * Every solid in this catalogue's manifest is exactly one rect (`"body"`
   * — `buildingStructuralBounds.ts`'s header), so one `holderId` (the wrap
   * node's name) covers it regardless of how many actual glb submeshes
   * render it. Returns `false` — never throws, never partially wires a
   * building — when the model isn't loaded/available, so the caller falls
   * through to the ordinary proxy box exactly like a failed glb load.
   */
  private instantiateViaSubmeshes(
    entry: PlannedAssetBuilding,
    ctx: BuildingLayerInstantiateCtx,
  ): boolean {
    const instanced = instantiateModelInstanced(this.scene, entry.url);
    const root = instanced?.rootNodes[0] as TransformNode | undefined;
    if (!instanced || !root) return false;
    const holderId = `bldg-${entry.id}`;
    const wrap = new TransformNode(holderId, this.scene);
    const squareUpYaw =
      buildingPlacementConfig(entry.modelId)?.squareUpYaw ?? 0;
    wrap.position.set(entry.x, entry.groundY + BUILDING_GROUND_LIFT, entry.z);
    wrap.rotation.y = entry.yaw + squareUpYaw;
    root.parent = wrap;
    root.scaling.setAll(entry.scale);
    ctx.staticSceneryFreeze.push(wrap);
    ctx.staticSceneryFreeze.push(root);
    for (const mesh of root.getChildMeshes(false)) {
      mesh.isPickable = false;
      ctx.staticSceneryFreeze.push(mesh);
      // Mirror-only, same convention as the merged-master path: these
      // deliberately cast no sun shadow (see the class doc comment).
      ctx.registerStaticCell(mesh, entry.x, entry.z, false);
    }
    this.addCairoRoofClutter(entry, ctx);
    ctx.registerRepresentation({
      planId: entry.id,
      source: "asset-slot",
      solids: entry.solids.map((solid) => ({
        solidId: solid.localId,
        kind: "glb" as const,
        transform: solid,
        holderId,
      })),
    });
    return true;
  }

  /** Exact per-solid opaque proxy — one box per `StructuralObb`, at that
   * exact XZ transform and the plan's proxy height. Never one envelope
   * around a compound entry's solids, never a billboard, never expanded
   * across a neighbouring opening (Section 7.6). */
  private buildProxy(
    entry: PlannedAssetBuilding,
    ctx: BuildingLayerInstantiateCtx,
  ): void {
    const material = ctx.materialFor(entry.material);
    const solidRepresentations = entry.solids.map((solid) => {
      const yaw = Math.atan2(-solid.uz, solid.ux);
      const width = solid.halfU * 2;
      const depth = solid.halfV * 2;
      const proxy = createFacadeBox(
        this.scene,
        `${entry.id}:solid:${solid.localId}#proxy`,
        { width, height: entry.heightM, depth },
        new Vector3(solid.x, entry.heightM / 2, solid.z),
        material,
      );
      proxy.rotation.y = yaw;
      proxy.isPickable = false;
      ctx.staticSceneryFreeze.push(proxy);
      ctx.registerStaticCell(proxy, solid.x, solid.z, false);
      return {
        solidId: solid.localId,
        kind: "proxy" as const,
        transform: solid,
        holderId: proxy.name,
      };
    });
    ctx.registerRepresentation({
      planId: entry.id,
      source: "asset-slot",
      solids: solidRepresentations,
    });
  }

  /**
   * Dresses every planned asset-slot entry with an instanced glb, once the
   * map's building glbs have preloaded, or an exact per-solid proxy for any
   * entry whose model is unavailable, forced unavailable, or fraction-thinned.
   * Every placement of a given model (or model+variant, for storefronts)
   * shares one uploaded geometry (`createInstance`), so hundreds of buildings
   * cost a handful of draw calls rather than hundreds.
   *
   * Must be called from the exact point `buildInstancedBuildings` used to
   * call the code this replaces — see the class doc comment.
   */
  instantiate(ctx: BuildingLayerInstantiateCtx): void {
    if (ctx.night) {
      this.applyNightGlow(
        ctx.buildingModelUrls,
        ctx.nightWindowGlowIntensity ?? WINDOW_GLOW,
      );
    }
    // Pull the affected Quaternius kits' decal primitives off their wall
    // planes. Container materials are shared by every instance and by the
    // merged masters, so once per url covers the map.
    for (const url of ctx.buildingModelUrls) {
      if (CAIRO_STREET_WALL_URL_RE.test(url)) {
        biasCairoDecalMaterials(modelMaterials(this.scene, url));
      } else if (LONDON_QUATERNIUS_STREET_WALL_URL_RE.test(url)) {
        biasLondonDecalMaterials(modelMaterials(this.scene, url));
      } else if (TOKYO_QUATERNIUS_BLOCK_URL_RE.test(url)) {
        biasTokyoBlockDecalMaterials(modelMaterials(this.scene, url));
      }
    }
    const fraction = Math.max(0, Math.min(1, ctx.buildingAssetDetailFraction));
    for (const entry of this.plannedEntries) {
      const attemptGlb =
        (fraction >= 1 || entry.assetDetailScore < fraction) &&
        !this.isForcedUnavailable(entry.modelId, ctx);
      // MERGE_INCOMPATIBLE_MODEL_IDS entries never reach getBuildingMaster —
      // its Mesh.MergeMeshes throws on them (buildingCatalog.ts's own doc
      // comment on that set). instantiateViaSubmeshes already falls back to
      // buildProxy on its own failure, so this branch's own continue always
      // leaves the entry fully resolved one way or the other.
      if (attemptGlb && MERGE_INCOMPATIBLE_MODEL_IDS.has(entry.modelId)) {
        if (!this.instantiateViaSubmeshes(entry, ctx))
          this.buildProxy(entry, ctx);
        continue;
      }
      const master = attemptGlb
        ? entry.modelId === STOREFRONT_MODEL_ID
          ? this.getStorefrontMaster(
              entry.url,
              pickStorefrontVariant(entry.x, entry.z),
              ctx,
            )
          : ctx.getBuildingMaster(
              entry.url,
              buildingPlacementConfig(entry.modelId)?.squareUpYaw ?? 0,
            )
        : null;
      if (master) {
        // Fast path: one instance = one scene mesh = one cull check.
        const inst = master.createInstance(`bldg-${entry.id}`);
        inst.position.set(
          entry.x,
          entry.groundY + BUILDING_GROUND_LIFT,
          entry.z,
        );
        inst.rotation.y = entry.yaw;
        inst.scaling.setAll(entry.scale);
        inst.isPickable = false;
        ctx.staticSceneryFreeze.push(inst);
        // Mirror-only: these deliberately cast no sun shadow, so they are not
        // in the shadow ring — but a mirror with no street wall in it looks
        // broken, and the rear view is mostly buildings.
        ctx.registerStaticCell(inst, entry.x, entry.z, false);
        this.addCairoRoofClutter(entry, ctx);
        if (ctx.night && CAIRO_TOWER_URL_RE.test(entry.url)) {
          this.addCornicheCrown(entry, ctx);
        }
        ctx.registerRepresentation({
          planId: entry.id,
          source: "asset-slot",
          solids: entry.solids.map((solid) => ({
            solidId: solid.localId,
            kind: "glb" as const,
            transform: solid,
            holderId: inst.name,
          })),
        });
        continue;
      }
      // Every non-retained/failed/forced-unavailable entry gets an exact
      // per-solid proxy — never the old whole-block procedural fallback.
      // (The one other approved non-glb path, instantiateViaSubmeshes
      // above, is reserved for MERGE_INCOMPATIBLE_MODEL_IDS specifically —
      // an ordinary model that merely failed to load still lands here,
      // never on the raw uncorrected multi-mesh instantiation path.)
      this.buildProxy(entry, ctx);
    }
  }

  dispose(): void {
    this.plannedEntries = [];
    this.storefrontMasters.clear();
    this.storefrontSignMaterials.clear();
    this.crownSignMaterials.clear();
  }
}
