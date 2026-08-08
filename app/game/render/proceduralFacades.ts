import {
  type AbstractMesh,
  Color3,
  type DynamicTexture,
  Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  type BuildingKeepOut,
  cairoFrontageFootprintsOverlap,
  cairoFrontagePosition,
  deterministicSceneryKeep,
  facadeGridCells,
  isInsideKeepOut,
  type CairoFrontageFootprint,
} from "../geometry/facadesAndKeepouts";
import {
  createBox,
  createCylinder,
  createFacadeBox,
  makeFacadeMaterial,
} from "./meshPrimitives";
import { makeFacadeEmissiveTexture } from "./proceduralTextures";
import type { GameCanvasMapPack } from "../sessionContract";

/**
 * The procedural windowed-facade-box grid: the classic filler for every block
 * whose material isn't dressed by an instanced glb street wall, and the
 * fallback for any building-set block whose glbs never load — wired through
 * `BuildingLayer.enqueueBlock`'s `buildFallback` callback, an *existing*,
 * already-shipped deferred path that this extraction does not change. De-
 * methodized into a collaborator class (issue #304), matching Phase 3's
 * `WaterLayer`/`Destructibles`/`CutsceneDirector`/`BuildingLayer` shape.
 *
 * Every `random()` call `buildScenarioEnvironment` makes lives in this
 * class's `placeBlock` — three draws per surviving facade cell (width,
 * depth, height) — which makes `ProceduralFacades` the **only** permitted
 * consumer of the session's shared `seededUnit(...)` stream (see
 * `docs/rendering.md`). That stream is still constructed exactly where it
 * always was, inside `buildScenarioEnvironment` (`const random =
 * seededUnit(...)`); only *consumption* moved here, via
 * `ProceduralFacadesCtx.random`, because the render-side draw order is
 * load-bearing for seeded-render determinism and reordering it would change
 * every downstream draw for every city, silently.
 *
 * Five things this class deliberately does **not** own, all threaded through
 * `ProceduralFacadesCtx` instead — the same "explicit inputs, not reaching
 * into the session" shape `BuildingLayerInstantiateCtx` uses:
 *
 * - **`random`**. Owned by `buildScenarioEnvironment`, not this class, so
 *   its one shared identity survives regardless of which of the two callers
 *   — the immediate block-loop call, or `BuildingLayer`'s deferred fallback
 *   — ends up invoking `placeBlock`.
 * - **The six Cairo material locals** (`cairoFacadeTrimMaterial`,
 *   `cairoBalconyRailMaterial`, `cairoAcMaterial`, `cairoAwningMaterials`,
 *   `cairoRooftopMaterial`, `cairoDishMaterial`). Built alongside the rest of
 *   Cairo's procedural materials in `buildScenarioEnvironment` (the
 *   rooftop/dish pair also feeds `BuildingLayer`, via
 *   `cairoRoofClutterMasters`), so they stay there and are passed in
 *   unchanged.
 * - **`staticSceneryFreeze`**. The one array every static-scenery builder in
 *   `buildScenarioEnvironment` pushes into; owning a private copy here would
 *   fork the freeze pass.
 * - **`registerShadowCaster`**. Writes into the session's shared shadow/
 *   mirror spatial hash — passed in as a callback for the same reason
 *   `BuildingLayer` and every other builder does.
 * - **`buildingKeepFraction` / `buildingExclusions`**. Both session-wide,
 *   read (never written) here exactly as `BuildingLayerInstantiateCtx`
 *   documents for its own copy of the same two fields — see that class's
 *   doc comment for why neither building system owns them.
 *
 * The emissive window-glow texture (`makeFacadeEmissiveTexture`) is the one
 * resource this class *does* own outright — built lazily, once, behind
 * `emissiveTexture` — even though `buildScenarioEnvironment`'s landmark loop
 * also needs it, for one-off per-landmark facade materials that never go
 * through `materialFor`'s cache. `emissiveTexture` hands back that same
 * instance rather than let the landmark loop build a second, wastefully
 * duplicate texture. Sharing it is safe regardless of which side asks first:
 * the texture is a pure function of `scene` alone (no map id, no
 * randomness), so its construction can never perturb the `random()` draw
 * order this class exists to protect.
 */

type MapBlock = GameCanvasMapPack["geometry"]["blocks"][number];

/**
 * Unlike `BuildingLayerInstantiateCtx` — which is rebuilt per `instantiate()`
 * call precisely so it can never drift — one of these is built once, before
 * the block loop, and reused by *both* of `placeBlock`'s call sites: the
 * immediate one, and `BuildingLayer`'s deferred fallback that runs after
 * preload. So mind which fields are references and which are values. The two
 * arrays (`staticSceneryFreeze`, `buildingExclusions`) are the session's own,
 * captured by reference, so writes after this object is built are visible to
 * the deferred call exactly as they were when this code read them off `this`.
 * `buildingKeepFraction` is a number, and therefore frozen at construction —
 * safe only because `BabylonGameSession` assigns it exactly once, in its
 * constructor, from the device's core count. Make that value dynamic (a
 * runtime quality toggle, say) and the deferred fallback would keep thinning
 * its grid by the stale fraction while everything else used the live one;
 * rebuild the ctx per call if that day comes.
 */
export interface ProceduralFacadesCtx {
  /** The session's shared seeded-random stream for this scenario
   * (`seededUnit(trafficSeed)`), constructed once inside
   * `buildScenarioEnvironment` and threaded through unchanged — see the
   * class doc comment for why its identity must never move. */
  readonly random: () => number;
  /** Lowercased map id — gates the Cairo frontage-placement branch and
   * seeds the per-cell deterministic-keep key. */
  readonly mapId: string;
  /** Cairo-only procedural materials, built alongside the rest of Cairo's
   * materials in `buildScenarioEnvironment`; `null` on every other map. */
  readonly cairoFacadeTrimMaterial: StandardMaterial | null;
  readonly cairoBalconyRailMaterial: StandardMaterial | null;
  readonly cairoAcMaterial: StandardMaterial | null;
  readonly cairoAwningMaterials: readonly StandardMaterial[];
  readonly cairoRooftopMaterial: StandardMaterial | null;
  readonly cairoDishMaterial: StandardMaterial | null;
  /** Nodes to freeze once, after the first render — shared with every other
   * static-scenery builder in `buildScenarioEnvironment`. */
  readonly staticSceneryFreeze: TransformNode[];
  /** Files a facade or rooftop mesh into the spatial hash the shadow/mirror
   * rings read. */
  readonly registerShadowCaster: (
    mesh: AbstractMesh,
    x: number,
    z: number,
  ) => void;
  /** Fraction of each block's facade grid to keep — see `BuildingLayer`'s
   * own doc comment for why this is a session-wide value, not owned by
   * either building system. */
  readonly buildingKeepFraction: number;
  /** Keep-out circles no placement may stand inside. */
  readonly buildingExclusions: readonly BuildingKeepOut[];
}

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export class ProceduralFacades {
  private static readonly BUILDING_PALETTE: Record<string, Color3> = {
    brick: new Color3(0.54, 0.29, 0.22),
    sandstone: new Color3(0.7, 0.61, 0.46),
    stone: new Color3(0.52, 0.53, 0.51),
    concrete: new Color3(0.48, 0.51, 0.52),
    stucco: new Color3(0.74, 0.67, 0.55),
    "pale-concrete": new Color3(0.68, 0.69, 0.66),
    plaster: new Color3(0.72, 0.7, 0.63),
    tile: new Color3(0.48, 0.52, 0.55),
    "wood-plaster": new Color3(0.58, 0.49, 0.39),
    "terracotta-museum": new Color3(0.63, 0.34, 0.25),
    "pale-stone-museum": new Color3(0.77, 0.76, 0.71),
    "red-brick-museum": new Color3(0.55, 0.29, 0.23),
    "london-brick": new Color3(0.49, 0.32, 0.27),
    // London stock brick: the yellow-grey most of the city west of the City
    // is actually built out of, beside the redder Victorian brick above.
    "london-stock-brick": new Color3(0.63, 0.56, 0.44),
    "white-stucco": new Color3(0.82, 0.81, 0.75),
    "cairo-cream": new Color3(0.76, 0.69, 0.57),
    "cairo-ochre": new Color3(0.67, 0.53, 0.36),
    "cairo-stone": new Color3(0.7, 0.63, 0.51),
    "cairo-concrete": new Color3(0.58, 0.56, 0.5),
    "cairo-villa": new Color3(0.77, 0.72, 0.62),
    "cairo-modern": new Color3(0.62, 0.64, 0.62),
    "cairo-warm-stone": new Color3(0.72, 0.61, 0.46),
    "cairo-garden-stucco": new Color3(0.78, 0.69, 0.56),
    "cairo-khedivial-stone": new Color3(0.68, 0.59, 0.46),
    "cairo-gezira-cream": new Color3(0.78, 0.73, 0.63),
    "cairo-west-bank-concrete": new Color3(0.58, 0.56, 0.5),
  };

  /** Per-materialKey memoized facade material — see `materialFor`. */
  private readonly facadeMaterials = new Map<string, StandardMaterial>();
  private facadeEmissiveTexture: DynamicTexture | null = null;

  constructor(private readonly scene: Scene) {}

  /** The shared window-glow emissive texture every facade-style material
   * uses, procedural or landmark — see the class doc comment for why this
   * class owns the single instance both sides share. */
  get emissiveTexture(): DynamicTexture {
    this.facadeEmissiveTexture ??= makeFacadeEmissiveTexture(this.scene);
    return this.facadeEmissiveTexture;
  }

  /**
   * A memoized facade material for one palette key (e.g. `"brick"`,
   * `"cairo-ochre"`) — one `StandardMaterial` per key, shared by every box
   * that key's cells place. Also called directly by
   * `buildScenarioEnvironment`'s block loop for the London museum-wing
   * branch, which paints its wings in the block's facade material without
   * ever calling `placeBlock`.
   */
  materialFor(materialKey: string): StandardMaterial {
    const cached = this.facadeMaterials.get(materialKey);
    if (cached) return cached;
    const wallColor =
      ProceduralFacades.BUILDING_PALETTE[materialKey] ?? new Color3(0.56, 0.5, 0.43);
    const created = makeFacadeMaterial(
      this.scene,
      `facade-${materialKey}`,
      wallColor,
      this.emissiveTexture,
    );
    this.facadeMaterials.set(materialKey, created);
    return created;
  }

  /**
   * Grows one block's windowed-facade-box grid: a box per surviving cell
   * (thinned by `ctx.buildingKeepFraction`), Cairo street-level detailing
   * (cornices, balconies, AC units, awnings, perimeter compounds) on top of
   * that where the block's material calls for it, and rooftop water tanks/
   * dishes cloned per cell on Cairo maps. Called either directly from the
   * block loop, or later, from `BuildingLayer`'s deferred fallback if every
   * placement in a building-set block failed to produce a glb instance.
   *
   * Moved verbatim (mechanical de-methodization, issue #304) from the
   * session's former `placeFacadeGrid` closure — see the PR's commit message
   * for the exact substitution table.
   */
  placeBlock(block: MapBlock, material: StandardMaterial, ctx: ProceduralFacadesCtx): void {
    const isGardenCity = block.material === "cairo-garden-stucco";
    const isWestBank = block.material === "cairo-west-bank-concrete";
    const facadeCells = facadeGridCells(
      isWestBank
        ? { ...block, density: Math.min(1, block.density + 0.17) }
        : block,
    );
    const freezeDetail = (mesh: Mesh) => {
      mesh.isPickable = false;
      ctx.staticSceneryFreeze.push(mesh);
    };
    const placedFrontages: CairoFrontageFootprint[] = [];
    for (const cell of facadeCells) {
      if (
        !deterministicSceneryKeep(
          `${ctx.mapId}:${block.id}:facade:${cell.index}`,
          ctx.buildingKeepFraction,
        )
      ) {
        continue;
      }
      const width = Math.max(5, cell.cellWidth * (0.58 + ctx.random() * 0.24));
      const depth = Math.max(5, cell.cellDepth * (0.58 + ctx.random() * 0.24));
      const frontagePlacement = ctx.mapId.includes("cairo")
        ? cairoFrontagePosition(block, cell, width, depth)
        : undefined;
      const buildingPosition = frontagePlacement ?? cell;
      const frontageFootprint = frontagePlacement
        ? { placement: frontagePlacement, widthM: width, depthM: depth }
        : undefined;
      if (
        frontageFootprint &&
        placedFrontages.some((placed) =>
          cairoFrontageFootprintsOverlap(placed, frontageFootprint),
        )
      ) {
        continue;
      }
      const height =
        block.heightRange[0] +
        ctx.random() * (block.heightRange[1] - block.heightRange[0]);
      // Same keep-outs the instanced street wall respects. Without this a
      // terrace box stands inside the gas station or the repair shop it was
      // supposed to make room for — and since the collider builder carves the
      // block rect regardless, the car drives straight through the visible
      // building rather than being stopped by it.
      const halfWidth =
        Math.abs(Math.cos(cell.rotationY)) * width / 2 +
        Math.abs(Math.sin(cell.rotationY)) * depth / 2;
      const halfDepth =
        Math.abs(Math.sin(cell.rotationY)) * width / 2 +
        Math.abs(Math.cos(cell.rotationY)) * depth / 2;
      if (
        isInsideKeepOut(
          ctx.buildingExclusions,
          buildingPosition.x,
          buildingPosition.z,
          halfWidth,
          halfDepth,
        )
      ) {
        continue;
      }
      if (frontageFootprint) placedFrontages.push(frontageFootprint);
      const facade = createFacadeBox(
        this.scene,
        `building-${block.id}-${cell.index}`,
        { width, height, depth },
        new Vector3(buildingPosition.x, height / 2, buildingPosition.z),
        material,
      );
      facade.rotation.y = cell.rotationY;
      ctx.registerShadowCaster(
        facade,
        buildingPosition.x,
        buildingPosition.z,
      );
      if (
        frontagePlacement &&
        ctx.cairoFacadeTrimMaterial &&
        ctx.cairoBalconyRailMaterial &&
        ctx.cairoAcMaterial
      ) {
        const detailRoot = new TransformNode(
          `building-${block.id}-${cell.index}-street-detail`,
          this.scene,
        );
        detailRoot.parent = facade;
        detailRoot.rotation.y = frontagePlacement.detailYawRad;
        ctx.staticSceneryFreeze.push(detailRoot);
        const frontageSpan =
          frontagePlacement.edgeAxis === "x" ? depth : width;
        const frontageDepth =
          frontagePlacement.edgeAxis === "x" ? width : depth;
        if (isGardenCity) {
          freezeDetail(
            createBox(
              this.scene,
              `building-${block.id}-${cell.index}-cornice`,
              {
                width: width + 0.55,
                height: 0.48,
                depth: depth + 0.55,
              },
              new Vector3(0, height / 2 + 0.18, 0),
              ctx.cairoFacadeTrimMaterial,
              facade,
            ),
          );
          if (cell.index % 2 === 0) {
            const balconyWidth = Math.min(5.4, frontageSpan * 0.54);
            const balconyY = Math.min(6.8, Math.max(4.3, height * 0.34));
            freezeDetail(
              createBox(
                this.scene,
                `building-${block.id}-${cell.index}-balcony`,
                { width: balconyWidth, height: 0.22, depth: 1.15 },
                new Vector3(
                  0,
                  balconyY - height / 2,
                  frontageDepth / 2 + 0.48,
                ),
                ctx.cairoFacadeTrimMaterial,
                detailRoot,
              ),
            );
            freezeDetail(
              createBox(
                this.scene,
                `building-${block.id}-${cell.index}-balcony-rail`,
                { width: balconyWidth, height: 0.55, depth: 0.09 },
                new Vector3(
                  0,
                  balconyY + 0.38 - height / 2,
                  frontageDepth / 2 + 1.02,
                ),
                ctx.cairoBalconyRailMaterial,
                detailRoot,
              ),
            );
          }
        } else if (cell.index % 2 === 0) {
          const acY = Math.min(height - 2.1, Math.max(5.3, height * 0.58));
          freezeDetail(
            createBox(
              this.scene,
              `building-${block.id}-${cell.index}-ac`,
              { width: 1.15, height: 0.72, depth: 0.38 },
              new Vector3(
                frontageSpan * 0.24,
                acY - height / 2,
                frontageDepth / 2 + 0.18,
              ),
              ctx.cairoAcMaterial,
              detailRoot,
            ),
          );
        }
        if (
          (isWestBank || block.material === "cairo-khedivial-stone") &&
          cell.index % 3 === 1
        ) {
          freezeDetail(
            createBox(
              this.scene,
              `building-${block.id}-${cell.index}-awning`,
              {
                width: Math.min(5.8, frontageSpan * 0.62),
                height: 0.18,
                depth: 1.5,
              },
              new Vector3(
                0,
                3.15 - height / 2,
                frontageDepth / 2 + 0.72,
              ),
              ctx.cairoAwningMaterials[cell.index % ctx.cairoAwningMaterials.length],
              detailRoot,
            ),
          );
        }
      }
      if (ctx.cairoRooftopMaterial && cell.index % 3 === 0) {
        const tank = createCylinder(
          this.scene,
          `building-${block.id}-${cell.index}-roof-tank`,
          {
            height: 1.15,
            diameter: Math.min(1.8, Math.max(1.1, width * 0.12)),
            tessellation: 10,
          },
          new Vector3(
            buildingPosition.x,
            height + 0.62,
            buildingPosition.z,
          ),
          ctx.cairoRooftopMaterial,
        );
        ctx.registerShadowCaster(
          tank,
          buildingPosition.x,
          buildingPosition.z,
        );
      } else if (ctx.cairoDishMaterial && cell.index % 3 === 1) {
        const dish = createCylinder(
          this.scene,
          `building-${block.id}-${cell.index}-roof-dish`,
          {
            height: 0.16,
            diameterTop: 1.35,
            diameterBottom: 0.75,
            tessellation: 10,
          },
          new Vector3(
            buildingPosition.x,
            height + 0.65,
            buildingPosition.z,
          ),
          ctx.cairoDishMaterial,
        );
        dish.rotation.x = -0.7;
        dish.rotation.y = cell.rotationY + 0.4;
        ctx.registerShadowCaster(
          dish,
          buildingPosition.x,
          buildingPosition.z,
        );
      }
    }
    if (
      isGardenCity &&
      ctx.cairoFacadeTrimMaterial &&
      ctx.cairoBalconyRailMaterial
    ) {
      // Low perimeter walls, iron gates and villa cornices distinguish the
      // secured Garden City compounds from denser downtown street walls.
      const compound = new TransformNode(`${block.id}-compound`, this.scene);
      compound.position.set(block.center.x, 0, block.center.z);
      compound.rotation.y = degreesToRadians(block.headingDeg ?? 0);
      const inset = 2.2;
      const halfX = Math.max(5, block.size.x / 2 - inset);
      const halfZ = Math.max(5, block.size.z / 2 - inset);
      const gateHalf = 3.3;
      const wallHeight = 1.28;
      for (const side of [-1, 1]) {
        const sideWall = createBox(
          this.scene,
          `${block.id}-compound-side-${side}`,
          { width: 0.38, height: wallHeight, depth: halfZ * 2 },
          new Vector3(side * halfX, wallHeight / 2, 0),
          ctx.cairoFacadeTrimMaterial,
          compound,
        );
        freezeDetail(sideWall);
        for (const half of [-1, 1]) {
          const run = halfX - gateHalf;
          const frontWall = createBox(
            this.scene,
            `${block.id}-compound-front-${side}-${half}`,
            { width: run, height: wallHeight, depth: 0.38 },
            new Vector3(
              half * (gateHalf + run / 2),
              wallHeight / 2,
              side * halfZ,
            ),
            ctx.cairoFacadeTrimMaterial,
            compound,
          );
          freezeDetail(frontWall);
        }
        const gate = createBox(
          this.scene,
          `${block.id}-compound-gate-${side}`,
          { width: gateHalf * 1.65, height: 1.05, depth: 0.12 },
          new Vector3(0, 0.53, side * halfZ),
          ctx.cairoBalconyRailMaterial,
          compound,
        );
        freezeDetail(gate);
      }
      ctx.staticSceneryFreeze.push(compound);
    }
  }

  dispose(): void {
    this.facadeMaterials.clear();
    this.facadeEmissiveTexture = null;
  }
}
