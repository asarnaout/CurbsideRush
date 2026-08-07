import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import {
  biasCairoDecalMaterials,
  CAIRO_STREET_WALL_URL_RE,
} from "../geometry/cairoParkland";
import {
  type BuildingKeepOut,
  keptStreetWallBuildings,
  rotateBlockBuildingPlacements,
} from "../geometry/facadesAndKeepouts";
import {
  buildingPlacementConfig,
  slotBlockBuildings,
  type BuildingSetId,
  type PlacedBuilding,
} from "../buildingSets";
import {
  instantiateModel,
  instantiateModelInstanced,
  modelMaterials,
} from "../modelLibrary";
import { BUILDING_GROUND_LIFT } from "./renderConstants";
import type { GameCanvasMapPack } from "../sessionContract";
import {
  pickStorefrontVariant,
  STOREFRONT_MODEL_ID,
  type StorefrontVariant,
} from "../storefronts";
import { assembleStorefrontVariantMaster } from "../storefrontMaster";
import { hashStringToSeed } from "../visuals";

/**
 * The block-scoped, once-per-map building system: queues each building-set
 * block during `buildScenarioEnvironment`, then — once the map's building glbs
 * preload — dresses every queued block with an instanced glb street wall
 * (re-branding the one retail model into a mix of storefront variants), lights
 * every building's windows for a night city, and grows Cairo's rooftop water
 * tanks and satellite dishes on top. De-methodized into a collaborator class
 * (issue #288) rather than free functions, matching Phase 3's
 * `WaterLayer`/`Destructibles`/`CutsceneDirector` shape: build state (the
 * queue, the two merge-master caches) has to persist between the population
 * call (`enqueueBlock`, one call per building-set block, inline in
 * `buildScenarioEnvironment`) and the later one-shot `instantiate()` (called
 * from `buildInstancedBuildings`, itself only reachable once the async model
 * preload settles). `BabylonGameSession` holds one as
 * `private buildingLayer: BuildingLayer | null`, exactly like its
 * `waterLayer`/`destructibles` fields.
 *
 * Four things this class deliberately does **not** own, all threaded through
 * `BuildingLayerInstantiateCtx` instead — the same "explicit inputs, not
 * reaching into the session" shape every Phase 3 collaborator uses:
 *
 * - **`getBuildingMaster`** (the merged-master-per-url cache). Despite the
 *   name, it is not building-specific: `WaterLayer.instantiatePendingBoats`,
 *   the vendor-cart loop and `buildParkPlanting` all call the *same* session
 *   method for their own unrelated masters (boats, carts, trees). Owning it
 *   here would make every one of those reach into a "building" class for a
 *   generic "get or build an instancing master" cache — backwards ownership.
 *   It stays a session method, passed in as a plain callback, the identical
 *   pattern `WaterLayer.instantiatePendingBoats(getBuildingMaster)` already
 *   established. (`getStorefrontMaster` is the opposite case — nothing outside
 *   the building-placement loop ever calls it — so it and its own cache
 *   (`storefrontMasters`) move here outright, no longer sharing the session's
 *   `buildingMasters` map. The two caches never collided on a key before this
 *   split — storefront entries were always `${url}#${variant.id}`, plain
 *   entries always a bare url — so this is behaviourally invisible.)
 * - **`buildingKeepFraction`**. Reads like a building-only knob, but
 *   `buildAmbientCrowd` scales the crowd count by the exact same fraction and
 *   `buildRoadsideProps`' ctx threads it to vendor/park-prop density too — a
 *   session-wide low-spec content budget that happens to be named after the
 *   first thing it was built for. Passed in per `instantiate()` call rather
 *   than owned, so it can never drift from the value those other systems use.
 * - **`buildingExclusions`**. Written by `collectBuildingExclusions` and by
 *   every `placeProp`/`buildRepairShop` call across `buildScenarioEnvironment`
 *   (gas stations, gig venues, the repair shop), not just by buildings, and
 *   read by the *procedural* facade grid fallback (`placeFacadeGrid`, which
 *   stays behind in `buildScenarioEnvironment` — seeded, deeply-closed-over
 *   local state, out of this issue's scope) as well as by this class. A
 *   session-owned array both sides read is simpler than either copying it or
 *   this class reaching back into the session for it.
 * - **`cairoRoofClutterMasters`**. The two hidden tank/dish master meshes are
 *   built alongside the rest of Cairo's procedural materials in
 *   `buildScenarioEnvironment` (same `cairoScene` gate, same neighbourhood of
 *   code) but only ever consumed here — passed in unchanged, matching the
 *   field's own long-standing doc comment ("they belong to buildEnvironment
 *   ... but are consumed by buildInstancedBuildings").
 *
 * **Call-order note, because it is load-bearing:** `instantiate()` must run
 * from the exact point `buildInstancedBuildings`'s own body used to — this
 * class changes *who* does the building placement, never *when*. It reads no
 * shared seeded-random stream to do it: `slotBlockBuildings` and
 * `pickStorefrontVariant` each derive their own local seed from
 * `hashStringToSeed` (a pure per-string hash), never from the render-side
 * `seededUnit(...)` counter `buildScenarioEnvironment`'s procedural fallback
 * consumes — so nothing here can perturb that counter's downstream draws no
 * matter when it runs, and this class's queue (populated synchronously,
 * consumed later, after preload) was already the shape that made that true.
 */

type MapBlock = GameCanvasMapPack["geometry"]["blocks"][number];

export interface BuildingLayerInstantiateCtx {
  /** Whether this map's palette is a night city — gates `applyNightGlow`. */
  readonly night: boolean;
  /** This map's building-set glb urls (preloaded off the critical path) —
   * also what `applyNightGlow` and the Cairo decal bias pass iterate. */
  readonly buildingModelUrls: readonly string[];
  /** Fraction of each block's street wall to keep — see the class doc
   * comment for why this is a session-wide value, not a building one. */
  readonly buildingKeepFraction: number;
  /** Keep-out circles no placement may stand inside. */
  readonly buildingExclusions: readonly BuildingKeepOut[];
  /** Cairo's rooftop clutter masters, or null on every other map. */
  readonly cairoRoofClutterMasters: { readonly tank: Mesh; readonly dish: Mesh } | null;
  /** Nodes to freeze once, after the first render — shared with every other
   * static-scenery builder in `buildScenarioEnvironment`. */
  readonly staticSceneryFreeze: TransformNode[];
  /** The session's shared merged-master-per-url cache; see the class doc
   * comment for why this class does not own it. */
  readonly getBuildingMaster: (url: string, squareUpYaw?: number) => Mesh | null;
  /** Files a static mesh into the spatial hash the shadow/mirror rings read;
   * always called with `castsShadow: false` here — the instanced street wall
   * deliberately casts no sun shadow (see rendering.md). */
  readonly registerStaticCell: (
    mesh: AbstractMesh,
    x: number,
    z: number,
    castsShadow: boolean,
  ) => void;
}

export class BuildingLayer {
  private readonly pendingBlocks: {
    readonly block: MapBlock;
    readonly setId: BuildingSetId;
    readonly buildFallback: () => void;
  }[] = [];
  /** Per-`${url}#${variant.id}` re-branded storefront master. Its own cache,
   * separate from the session's `getBuildingMaster` one — see the class doc
   * comment. `undefined` = not yet attempted; `null` = attempted and failed
   * (falls back to the plain building master for that url). */
  private readonly storefrontMasters = new Map<string, Mesh | null>();
  private readonly storefrontSignMaterials = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  /** Every distinct set a queued block references — lets the session compute
   * this map's building-glb preload list before any block's models have
   * actually loaded, without reaching into the queue itself. */
  get queuedSetIds(): readonly BuildingSetId[] {
    return [...new Set(this.pendingBlocks.map((entry) => entry.setId))];
  }

  /**
   * Queues one building-set block to dress with an instanced glb street wall
   * once its models preload. `buildFallback` builds the procedural facade-box
   * grid instead — called from `instantiate()` only if every placement in the
   * block failed to produce a merged or multi-mesh instance (offline, or a
   * genuinely unmergeable asset), so a block whose set never loaded is never
   * left empty.
   */
  enqueueBlock(block: MapBlock, setId: BuildingSetId, buildFallback: () => void): void {
    this.pendingBlocks.push({ block, setId, buildFallback });
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
   * the placement so a reload puts the same clutter on the same roofs.
   */
  private addCairoRoofClutter(
    building: PlacedBuilding,
    index: number,
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
    const inst = master.createInstance(`cairo-roof-${index}-${roll}`);
    // Offset off-centre so a run of buildings does not line its tanks up in a
    // perfectly straight row down the street.
    const offset = ((index % 3) - 1) * 1.4;
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

  /**
   * Dresses every queued building-set block with an instanced glb street wall,
   * once the map's building glbs have preloaded. Every placement of a given
   * model (or model+variant, for storefronts) shares one uploaded geometry
   * (`createInstance`), so hundreds of buildings cost a handful of draw calls
   * rather than hundreds. A block whose set never loaded — or whose every
   * placement genuinely fails to merge — falls back to its procedural
   * facade-box grid so it is never left empty.
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
    for (const { block, setId, buildFallback } of this.pendingBlocks) {
      const slotted = rotateBlockBuildingPlacements(
        slotBlockBuildings(
          block.center,
          block.size,
          setId,
          hashStringToSeed(`${block.id}-buildings`),
          ctx.buildingKeepFraction,
          block.streetEdges,
        ),
        block.center,
        block.headingDeg,
      );
      const placements = keptStreetWallBuildings(slotted, ctx.buildingExclusions);
      let placed = 0;
      for (const b of placements) {
        const master =
          b.modelId === STOREFRONT_MODEL_ID
            ? this.getStorefrontMaster(b.url, pickStorefrontVariant(b.x, b.z), ctx)
            : ctx.getBuildingMaster(
                b.url,
                buildingPlacementConfig(b.modelId)?.squareUpYaw ?? 0,
              );
        if (master) {
          // Fast path: one instance = one scene mesh = one cull check.
          const inst = master.createInstance(`bldg-${block.id}-${placed}`);
          inst.position.set(b.x, b.groundY + BUILDING_GROUND_LIFT, b.z);
          inst.rotation.y = b.yaw;
          inst.scaling.setAll(b.scale);
          inst.isPickable = false;
          ctx.staticSceneryFreeze.push(inst);
          // Mirror-only: these deliberately cast no sun shadow, so they are not
          // in the shadow ring — but a mirror with no street wall in it looks
          // broken, and the rear view is mostly buildings.
          ctx.registerStaticCell(inst, b.x, b.z, false);
          this.addCairoRoofClutter(b, placed, ctx);
          placed += 1;
          continue;
        }
        // Fallback: the glb wouldn't merge — place it as a multi-mesh instance.
        const instance = instantiateModelInstanced(this.scene, b.url);
        const root = instance?.rootNodes[0] as TransformNode | undefined;
        if (!root) continue;
        const holder = new TransformNode(`bldg-${block.id}-${placed}`, this.scene);
        holder.position.set(b.x, b.groundY + BUILDING_GROUND_LIFT, b.z);
        holder.rotation.y = b.yaw;
        root.parent = holder;
        // Multiply, never setAll: the loader root carries the handedness flip
        // as scaling (1,1,-1), and wiping it leaves only the root's 180°
        // Y-rotation — which faces the building backwards relative to the
        // merged masters this is a stand-in for (frontOffset is calibrated
        // against the master frame).
        root.scaling.scaleInPlace(b.scale);
        ctx.staticSceneryFreeze.push(holder);
        for (const mesh of root.getChildMeshes(false)) {
          mesh.isPickable = false;
          ctx.staticSceneryFreeze.push(mesh);
          ctx.registerStaticCell(mesh, b.x, b.z, false);
        }
        placed += 1;
      }
      if (placed === 0) buildFallback();
    }
    this.pendingBlocks.length = 0;
  }

  dispose(): void {
    this.pendingBlocks.length = 0;
    this.storefrontMasters.clear();
    this.storefrontSignMaterials.clear();
  }
}
