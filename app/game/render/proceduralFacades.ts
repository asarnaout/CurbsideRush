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
import { cairoFrontagePosition, facadeGridCells } from "../geometry/facadesAndKeepouts";
import type { GameCanvasMapPack } from "../sessionContract";
import type { PlannedProceduralBuilding } from "../geometry/buildingLayout";
import type { BuildingSolidRepresentation } from "./buildingRepresentation";
import {
  createBox,
  createCylinder,
  createFacadeBox,
  makeFacadeMaterial,
} from "./meshPrimitives";
import {
  makeBaladiFacadeTextures,
  makeFacadeEmissiveTexture,
  makeFloodlitFacadeTextures,
} from "./proceduralTextures";

/**
 * The procedural windowed-facade-box renderer: paints exactly the boxes
 * `geometry/buildingLayout.ts` already planned (position, yaw, width, depth,
 * height are the plan's, never redrawn here), plus Cairo's purely decorative
 * street-level detailing on top where the block's material calls for it, and
 * rooftop water tanks/dishes cloned per cell on Cairo maps. Structural
 * occupancy is decided once, by the planner; this class only ever renders
 * what it is handed. De-methodized into a collaborator class (issue #304),
 * matching Phase 3's `WaterLayer`/`Destructibles`/`CutsceneDirector`/
 * `BuildingLayer` shape, and since the building-collision-visual-parity plan
 * this class draws no randomness at all — the `seededUnit(trafficSeed)`
 * stream `buildScenarioEnvironment` used to hand it (`ProceduralFacadesCtx.random`)
 * was the planner's own input, consumed once when the plan was built, not
 * here (see `docs/rendering.md` for why that stream's draw order still
 * matters at the point the plan itself is constructed).
 *
 * Cairo's decorative detail placement (which face gets the cornice/balcony/AC
 * unit, and which local axis is "along the frontage") is re-derived from
 * `cairoFrontagePosition` at render time rather than stored on the plan: it is
 * a pure function of the block, the cell, and the plan's own already-decided
 * width/depth, so recomputing it can never disagree with what the planner
 * used to place the box — and keeps the plan's own type free of
 * decoration-only fields (Section 6.6: structural, not decorative, bounds).
 *
 * Four things this class deliberately does **not** own, all threaded through
 * `ProceduralFacadesCtx` instead — the same "explicit inputs, not reaching
 * into the session" shape `BuildingLayerInstantiateCtx` uses:
 *
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
 * - **`mapId`**. Lowercased map id, gates the Cairo frontage-detail branch.
 *
 * The emissive window-glow texture (`makeFacadeEmissiveTexture`) is the one
 * resource this class *does* own outright — built lazily, once, behind
 * `emissiveTexture` — even though `buildScenarioEnvironment`'s landmark loop
 * also needs it, for one-off per-landmark facade materials that never go
 * through `materialFor`'s cache. `emissiveTexture` hands back that same
 * instance rather than let the landmark loop build a second, wastefully
 * duplicate texture.
 */

type MapBlock = GameCanvasMapPack["geometry"]["blocks"][number];

export interface ProceduralFacadesCtx {
  /** Lowercased map id — gates the Cairo frontage-detail branch. */
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
   * rings read. `castsShadow` defaults true; pass false to stay in the
   * mirror ring only (see `renderPlannedBuilding`'s Tokyo gate below). */
  readonly registerShadowCaster: (
    mesh: AbstractMesh,
    x: number,
    z: number,
    castsShadow?: boolean,
  ) => void;
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
    // Whitehall's Portland stone: pale, grey-cream, and only the civic
    // quarter is built out of it.
    "london-portland-stone": new Color3(0.79, 0.78, 0.72),
    // The City's glass curtain wall: steel-blue, and the only London material
    // that goes above 40 m.
    "london-glass-curtain": new Color3(0.42, 0.5, 0.56),
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

  /**
   * The baladi keys render through `makeBaladiFacadeTextures` (brick infill
   * in an exposed concrete skeleton) rather than the flat windowed wall the
   * palette above paints — see `materialFor`. Infill tones straddle the
   * red-brown band of Cairo's actual brick stock; the frame is always the
   * pale unpainted concrete that holds it.
   */
  private static readonly BALADI_PALETTE: Record<
    string,
    { readonly infill: Color3; readonly frame: Color3; readonly courses: boolean }
  > = {
    "cairo-brick": {
      infill: new Color3(0.4, 0.24, 0.17),
      frame: new Color3(0.5, 0.48, 0.43),
      courses: true,
    },
    "cairo-brick-worn": {
      infill: new Color3(0.47, 0.31, 0.22),
      frame: new Color3(0.53, 0.51, 0.45),
      courses: true,
    },
    "cairo-render-grey": {
      infill: new Color3(0.5, 0.46, 0.4),
      frame: new Color3(0.55, 0.53, 0.48),
      courses: false,
    },
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
   * `buildScenarioEnvironment`'s landmark loop for the London museum-wing
   * branch, which paints its wings in the block's facade material without
   * going through `renderPlannedBuilding` for the museum quarter's non-wing
   * dressing.
   */
  materialFor(materialKey: string): StandardMaterial {
    const cached = this.facadeMaterials.get(materialKey);
    if (cached) return cached;
    const baladi = ProceduralFacades.BALADI_PALETTE[materialKey];
    let created: StandardMaterial;
    if (materialKey === "cairo-khedivial-stone") {
      // Downtown's floodlit gold: the wall itself glows an uplight
      // gradient and the windows stay dark — see makeFloodlitFacadeTextures.
      const textures = makeFloodlitFacadeTextures(
        this.scene,
        `facade-${materialKey}`,
        ProceduralFacades.BUILDING_PALETTE[materialKey],
      );
      created = new StandardMaterial(`facade-${materialKey}`, this.scene);
      created.diffuseColor = new Color3(1, 1, 1);
      created.diffuseTexture = textures.diffuse;
      created.emissiveTexture = textures.emissive;
      created.emissiveColor = new Color3(1, 1, 1);
      created.specularColor = new Color3(0.05, 0.05, 0.05);
    } else if (baladi) {
      const textures = makeBaladiFacadeTextures(
        this.scene,
        `facade-${materialKey}`,
        baladi.infill,
        baladi.frame,
        baladi.courses,
      );
      created = new StandardMaterial(`facade-${materialKey}`, this.scene);
      created.diffuseColor = new Color3(1, 1, 1);
      created.diffuseTexture = textures.diffuse;
      created.emissiveTexture = textures.emissive;
      created.emissiveColor = new Color3(1, 1, 1);
      created.specularColor = new Color3(0.04, 0.04, 0.04);
    } else {
      const wallColor =
        ProceduralFacades.BUILDING_PALETTE[materialKey] ?? new Color3(0.56, 0.5, 0.43);
      created = makeFacadeMaterial(
        this.scene,
        `facade-${materialKey}`,
        wallColor,
        this.emissiveTexture,
      );
    }
    this.facadeMaterials.set(materialKey, created);
    return created;
  }

  /**
   * Renders one planned procedural-cell or museum-wing building: the exact
   * box the plan describes (position/yaw/width/depth/height), Cairo
   * street-level detailing on top where the block's material calls for it
   * (procedural-cell entries only — museum wings get none, matching current
   * behaviour), and rooftop water tanks/dishes on Cairo maps. Returns the
   * representation record for the caller's registry.
   */
  renderPlannedBuilding(
    entry: PlannedProceduralBuilding,
    block: MapBlock,
    ctx: ProceduralFacadesCtx,
  ): BuildingSolidRepresentation {
    const material = this.materialFor(entry.material);
    const facade = createFacadeBox(
      this.scene,
      `building-${entry.id}`,
      { width: entry.widthM, height: entry.heightM, depth: entry.depthM },
      new Vector3(entry.x, entry.heightM / 2, entry.z),
      material,
    );
    facade.rotation.y = entry.yaw;
    // Phase 10 perf remediation: Tokyo's procedural buildings skip the sun
    // shadow pass (still mirror-visible — `registerShadowCaster`'s false
    // branch only sets `castsShadow`, never drops the spatial-hash entry).
    // `docs/rendering.md`'s own `registerStaticCell` note already documents
    // this exact trade-off for NYC's instanced street wall ("deliberately
    // casts none"); Tokyo's procedural boxes are the one part of R18's street
    // wall NYC's glb kit does not have to pay this cost for, and at 0.42
    // shadow darkness under a bloom-heavy night palette the loss is not
    // something a player stops to notice.
    //
    // It stays Tokyo-only even though every city is now a night city and the
    // "you cannot see it under bloom" argument therefore applies to all four:
    // this was a remediation for a MEASURED collapse on one map, and Cairo and
    // London both hold frame budget with their procedural boxes still casting.
    // Widening it is a perf change to make against a measurement, not a
    // consequence of the palette flip.
    ctx.registerShadowCaster(facade, entry.x, entry.z, !ctx.mapId.includes("tokyo"));

    const solid = entry.solids[0];
    const representation: BuildingSolidRepresentation = {
      solidId: solid.localId,
      kind: "planned-box",
      transform: solid,
      holderId: facade.name,
    };

    if (entry.source === "museum-wing" || entry.cellIndex === undefined) {
      return representation;
    }

    const freezeDetail = (mesh: Mesh) => {
      mesh.isPickable = false;
      ctx.staticSceneryFreeze.push(mesh);
    };
    const isGardenCity = block.material === "cairo-garden-stucco";
    const isBaladi = block.material.startsWith("cairo-brick") ||
      block.material === "cairo-render-grey";
    const isWestBank =
      block.material === "cairo-west-bank-concrete" || isBaladi;
    const cellIndex = entry.cellIndex;
    const width = entry.widthM;
    const depth = entry.depthM;
    const height = entry.heightM;

    if (
      ctx.mapId.includes("cairo") &&
      ctx.cairoFacadeTrimMaterial &&
      ctx.cairoBalconyRailMaterial &&
      ctx.cairoAcMaterial
    ) {
      const cells = facadeGridCells(
        isWestBank ? { ...block, density: Math.min(1, block.density + 0.17) } : block,
      );
      const cell = cells[cellIndex];
      const frontagePlacement = cairoFrontagePosition(block, cell, width, depth);
      const detailRoot = new TransformNode(`${facade.name}-street-detail`, this.scene);
      detailRoot.parent = facade;
      detailRoot.rotation.y = frontagePlacement.detailYawRad;
      ctx.staticSceneryFreeze.push(detailRoot);
      const frontageSpan = frontagePlacement.edgeAxis === "x" ? depth : width;
      const frontageDepth = frontagePlacement.edgeAxis === "x" ? width : depth;
      if (isGardenCity) {
        freezeDetail(
          createBox(
            this.scene,
            `${facade.name}-cornice`,
            { width: width + 0.55, height: 0.48, depth: depth + 0.55 },
            new Vector3(0, height / 2 + 0.18, 0),
            ctx.cairoFacadeTrimMaterial,
            facade,
          ),
        );
        if (cellIndex % 2 === 0) {
          const balconyWidth = Math.min(5.4, frontageSpan * 0.54);
          const balconyY = Math.min(6.8, Math.max(4.3, height * 0.34));
          freezeDetail(
            createBox(
              this.scene,
              `${facade.name}-balcony`,
              { width: balconyWidth, height: 0.22, depth: 1.15 },
              new Vector3(0, balconyY - height / 2, frontageDepth / 2 + 0.48),
              ctx.cairoFacadeTrimMaterial,
              detailRoot,
            ),
          );
          freezeDetail(
            createBox(
              this.scene,
              `${facade.name}-balcony-rail`,
              { width: balconyWidth, height: 0.55, depth: 0.09 },
              new Vector3(0, balconyY + 0.38 - height / 2, frontageDepth / 2 + 1.02),
              ctx.cairoBalconyRailMaterial,
              detailRoot,
            ),
          );
        }
      } else if (cellIndex % 2 === 0) {
        const acY = Math.min(height - 2.1, Math.max(5.3, height * 0.58));
        freezeDetail(
          createBox(
            this.scene,
            `${facade.name}-ac`,
            { width: 1.15, height: 0.72, depth: 0.38 },
            new Vector3(frontageSpan * 0.24, acY - height / 2, frontageDepth / 2 + 0.18),
            ctx.cairoAcMaterial,
            detailRoot,
          ),
        );
      }
      if (
        (isWestBank || block.material === "cairo-khedivial-stone") &&
        cellIndex % 3 === 1
      ) {
        freezeDetail(
          createBox(
            this.scene,
            `${facade.name}-awning`,
            { width: Math.min(5.8, frontageSpan * 0.62), height: 0.18, depth: 1.5 },
            new Vector3(0, 3.15 - height / 2, frontageDepth / 2 + 0.72),
            ctx.cairoAwningMaterials[cellIndex % ctx.cairoAwningMaterials.length],
            detailRoot,
          ),
        );
      }
    }

    if (ctx.cairoRooftopMaterial && cellIndex % 3 === 0) {
      const tank = createCylinder(
        this.scene,
        `${facade.name}-roof-tank`,
        { height: 1.15, diameter: Math.min(1.8, Math.max(1.1, width * 0.12)), tessellation: 10 },
        new Vector3(entry.x, height + 0.62, entry.z),
        ctx.cairoRooftopMaterial,
      );
      ctx.registerShadowCaster(tank, entry.x, entry.z);
      ctx.staticSceneryFreeze.push(tank);
    } else if (ctx.cairoDishMaterial && cellIndex % 3 === 1) {
      const dish = createCylinder(
        this.scene,
        `${facade.name}-roof-dish`,
        { height: 0.16, diameterTop: 1.35, diameterBottom: 0.75, tessellation: 10 },
        new Vector3(entry.x, height + 0.65, entry.z),
        ctx.cairoDishMaterial,
      );
      dish.rotation.x = -0.7;
      dish.rotation.y = entry.yaw + 0.4;
      ctx.registerShadowCaster(dish, entry.x, entry.z);
      ctx.staticSceneryFreeze.push(dish);
    }

    return representation;
  }

  /**
   * Cairo Garden City's low perimeter walls/iron gates — one per block, not
   * per building, so the caller invokes this once for each block that
   * planned any procedural-cell buildings and carries the garden-stucco
   * material (never for a block that placed an asset-slot street wall
   * instead). Distinguishes the secured Garden City compounds from denser
   * downtown street walls.
   */
  renderGardenCityCompound(block: MapBlock, ctx: ProceduralFacadesCtx): void {
    if (!ctx.cairoFacadeTrimMaterial || !ctx.cairoBalconyRailMaterial) return;
    const freezeDetail = (mesh: Mesh) => {
      mesh.isPickable = false;
      ctx.staticSceneryFreeze.push(mesh);
    };
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
          new Vector3(half * (gateHalf + run / 2), wallHeight / 2, side * halfZ),
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

  dispose(): void {
    this.facadeMaterials.clear();
    this.facadeEmissiveTexture = null;
  }
}
