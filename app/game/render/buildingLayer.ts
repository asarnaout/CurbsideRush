import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  biasCairoDecalMaterials,
  CAIRO_STREET_WALL_URL_RE,
} from "../geometry/cairoParkland";
import { buildingPlacementConfig } from "../buildingSets";
import { MERGE_INCOMPATIBLE_MODEL_IDS } from "../buildingCatalog";
import type { PlannedAssetBuilding } from "../geometry/buildingLayout";
import { instantiateModel, instantiateModelInstanced, modelMaterials } from "../modelLibrary";
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
  readonly cairoRoofClutterMasters: { readonly tank: Mesh; readonly dish: Mesh } | null;
  /** Nodes to freeze once, after the first render — shared with every other
   * static-scenery builder in `buildScenarioEnvironment`. */
  readonly staticSceneryFreeze: TransformNode[];
  /** The session's shared merged-master-per-url cache; see the class doc
   * comment for why this class does not own it. */
  readonly getBuildingMaster: (url: string, squareUpYaw?: number) => Mesh | null;
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
  readonly registerRepresentation: (record: BuildingRepresentationRecord) => void;
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
  private readonly storefrontSignMaterials = new Map<string, StandardMaterial>();

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
   * Night city: make every building material glow its own albedo/texture, so
   * facades and painted windows read as lit-from-within under the dim moonlight
   * (the low-poly glbs have no emissive of their own). Bloom does the rest.
   * Mutates the shared container materials once — all instances light up.
   */
  private applyNightGlow(buildingModelUrls: readonly string[]): void {
    // Warm sodium/incandescent colour for lit windows (blue-hour amber). Kept
    // below pure white so bloom softens it to a glow instead of blowing it out.
    const WARM = new Color3(0.95, 0.6, 0.29);
    for (const url of buildingModelUrls) {
      const mats = modelMaterials(this.scene, url);
      // Models with a dedicated window material get the realistic treatment:
      // light only the windows, keep the walls dark (lit by moonlight +
      // streetlights). Single-texture models (windows baked into one texture)
      // can't isolate windows, so they get a dim warm self-glow — enough to read
      // as lit without blowing the whole facade out to white.
      const hasWindowMat = mats.some((mm) =>
        /window|glass/.test((mm.name ?? "").toLowerCase()),
      );
      for (const mat of mats) {
        const name = (mat.name ?? "").toLowerCase();
        const m = mat as unknown as {
          albedoColor?: Color3;
          diffuseColor?: Color3;
          albedoTexture?: unknown;
          diffuseTexture?: unknown;
          emissiveColor?: Color3;
          emissiveTexture?: unknown;
          emissiveIntensity?: number;
        };
        if (hasWindowMat) {
          const isWindow = /window|glass|trim/.test(name);
          if (isWindow) {
            // A lit window is a dark pane that only glows warm — otherwise the
            // pane's own (light) albedo, lit by the sky, washes it out to white.
            const dark = new Color3(0.05, 0.045, 0.04);
            if (m.albedoColor) m.albedoColor = dark;
            if (m.diffuseColor) m.diffuseColor = dark;
            m.emissiveColor = WARM.clone();
            if (typeof m.emissiveIntensity === "number") m.emissiveIntensity = 0.72;
          } else {
            m.emissiveColor = new Color3(0, 0, 0);
            if (typeof m.emissiveIntensity === "number") m.emissiveIntensity = 0;
          }
        } else {
          const tex = m.albedoTexture ?? m.diffuseTexture;
          m.emissiveColor = new Color3(0.42, 0.32, 0.19);
          if (tex) m.emissiveTexture = tex;
          if (typeof m.emissiveIntensity === "number") m.emissiveIntensity = 0.32;
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
        .filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
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
  private getStorefrontSignMaterial(variant: StorefrontVariant): StandardMaterial {
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
    const inst = master.createInstance(`cairo-roof-${building.renderOrdinal}-${roll}`);
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

  private isForcedUnavailable(modelId: string, ctx: BuildingLayerInstantiateCtx): boolean {
    const policy = ctx.debugAssetPolicy;
    if (!policy) return false;
    return policy.unavailableModelIds === "all" || policy.unavailableModelIds.includes(modelId);
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
    const squareUpYaw = buildingPlacementConfig(entry.modelId)?.squareUpYaw ?? 0;
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
  private buildProxy(entry: PlannedAssetBuilding, ctx: BuildingLayerInstantiateCtx): void {
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
    if (ctx.night) this.applyNightGlow(ctx.buildingModelUrls);
    // Pull the Cairo kit's decal primitives off their wall planes; see
    // CAIRO_DECAL_Z_OFFSET_UNITS. Container materials are shared by every
    // instance and by the merged masters, so once per url covers the map.
    for (const url of ctx.buildingModelUrls) {
      if (CAIRO_STREET_WALL_URL_RE.test(url)) {
        biasCairoDecalMaterials(modelMaterials(this.scene, url));
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
        if (!this.instantiateViaSubmeshes(entry, ctx)) this.buildProxy(entry, ctx);
        continue;
      }
      const master = attemptGlb
        ? entry.modelId === STOREFRONT_MODEL_ID
          ? this.getStorefrontMaster(entry.url, pickStorefrontVariant(entry.x, entry.z), ctx)
          : ctx.getBuildingMaster(entry.url, buildingPlacementConfig(entry.modelId)?.squareUpYaw ?? 0)
        : null;
      if (master) {
        // Fast path: one instance = one scene mesh = one cull check.
        const inst = master.createInstance(`bldg-${entry.id}`);
        inst.position.set(entry.x, entry.groundY + BUILDING_GROUND_LIFT, entry.z);
        inst.rotation.y = entry.yaw;
        inst.scaling.setAll(entry.scale);
        inst.isPickable = false;
        ctx.staticSceneryFreeze.push(inst);
        // Mirror-only: these deliberately cast no sun shadow, so they are not
        // in the shadow ring — but a mirror with no street wall in it looks
        // broken, and the rear view is mostly buildings.
        ctx.registerStaticCell(inst, entry.x, entry.z, false);
        this.addCairoRoofClutter(entry, ctx);
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
  }
}
