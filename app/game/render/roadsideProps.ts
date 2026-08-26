import {
  type AbstractMesh,
  Color3,
  Constants,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
  type Vector4,
} from "@babylonjs/core";
import { NYC_VENDORS, type StreetPropConfig } from "../buildingSets";
import {
  CAIRO_OPEN_WATERFRONT_SIDES,
  cairoTahrirMarkedLotAllowsRoadsidePlacement,
} from "../cities/cairo";
import { LONDON_OPEN_WATERFRONT_SIDES } from "../cities/london";
import { TOKYO_OPEN_WATERFRONT_SIDES } from "../cities/tokyo";
import { deterministicSceneryKeep } from "../geometry/facadesAndKeepouts";
import { roadsidePropKeepOuts } from "../geometry/roadFurnitureLayout";
import { type ParkPlacement, parkLayoutForLandmark } from "../parkLayouts";
import { natureModelForPlacement } from "../natureCatalog";
import {
  cairoDirectionPanelFaceUv,
  textureContext,
} from "./proceduralTextures";
import { setMeshMaterial } from "./meshPrimitives";
import {
  LONDON_FURNITURE_POINTS,
  roadsidePropKindsForMap,
  TOKYO_FURNITURE_POINTS,
  type DestructiblePropPart,
} from "./propCatalog";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import {
  distanceToPolylineM,
  generatePromenadeDecor,
  generateRoadsidePropPlacements,
  hashStringToSeed,
  PAVED_SIDEWALK_WIDTH_M,
  PROMENADE_SHORELINE_CLEARANCE_M,
  resolveMapVisualKey,
  type MapVisualKey,
  type MapVisualPalette,
  type OpenWaterfrontSides,
  type PropPlacement,
} from "../visuals";

/**
 * Real per-road open-waterfront tables, by map key — each city keeps its own
 * table with its own content (`CAIRO_OPEN_WATERFRONT_SIDES`,
 * `LONDON_OPEN_WATERFRONT_SIDES`, `TOKYO_OPEN_WATERFRONT_SIDES`); this is just the lookup that picks the
 * right one. A map with no entry here gets no promenade decor at all (the
 * `?? []` fallback below), which is what keeps this additive — every other
 * city's roadside output is unchanged.
 */
const OPEN_WATERFRONT_SIDES_BY_KEY: Partial<Record<MapVisualKey, OpenWaterfrontSides>> = {
  cairo: CAIRO_OPEN_WATERFRONT_SIDES,
  london: LONDON_OPEN_WATERFRONT_SIDES,
  tokyo: TOKYO_OPEN_WATERFRONT_SIDES,
};

/**
 * The promenade's own tree/lamp prop kinds, by map key (Tokyo expansion
 * Phase 9: `generatePromenadeDecor`'s `treeKind`/`lampKind` used to be
 * hardcoded `"palm"`/`"streetlight"` inside that function — Cairo-only, the
 * exact kind of hidden assumption `visuals.ts`'s own per-map lookups above
 * exist to avoid). Cairo keeps its literal palm/streetlight, London takes
 * broadleaf trees and park lamps, and Tokyo swaps in cherry trees and chochin
 * lanterns. A map absent from either this table or
 * `OPEN_WATERFRONT_SIDES_BY_KEY` gets no promenade decor at all.
 */
const PROMENADE_DECOR_KINDS_BY_KEY: Partial<
  Record<
    MapVisualKey,
    {
      readonly treeKind: string;
      readonly lampKind: string;
      readonly treeVariants?: readonly number[];
    }
  >
> = {
  cairo: { treeKind: "palm", lampKind: "streetlight" },
  // Mature plane-tree silhouettes and short black globe lamps: recognisably
  // London civic riverfront, deliberately neither Cairo palms nor Tokyo's
  // blossom/chochin language. Variant 1 is the shared conifer, so exclude it.
  london: { treeKind: "tree", lampKind: "lamp", treeVariants: [0, 2] },
  tokyo: { treeKind: "sakura", lampKind: "chochin-post" },
};

/**
 * Deterministic roadside dressing (trees, streetlights, signs plus per-map
 * extras) built from instanced master meshes, plus park planting/furniture —
 * de-methodized out of `BabylonGameSession` (Phase 3.3). `collectParkPlacements`
 * was physically wedged between `buildRoadsideProps`'s doc comment and its
 * signature in the original source despite being unrelated by name (it is
 * park code, not roadside code); its only caller is `buildRoadsideProps`
 * itself, so it moves here as a local helper rather than a stand-alone
 * export, and the true header comment above travels with the function it
 * actually describes.
 *
 * `registerShadowCaster`/`registerDestructibleProp` are threaded as ctx
 * callbacks — shared class-wide, not exclusive to this cargo.
 * `pendingPlantedProps`/`pendingParkThickets`/`pendingVendors`/
 * `staticSceneryFreeze` are passed as live array references, matching how
 * the class already treats them (push-only accumulators, drained
 * elsewhere). `setMeshMaterial`/`textureContext` are imported from their
 * Phase 2 homes rather than duplicated a third time. `makeMaterial` IS
 * duplicated locally, same house convention as cairoLandmarks.ts: already a
 * plain function with no future move planned, unlike the two callbacks
 * above.
 */

function makeMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  material.emissiveColor = emissive ?? Color3.Black();
  return material;
}

export interface RoadsidePropsCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly pendingVendors: {
    config: StreetPropConfig;
    x: number;
    z: number;
    yaw: number;
  }[];
  readonly pendingPlantedProps: ParkPlacement[];
  readonly pendingParkThickets: ParkPlacement[];
  /** General scenery density — renamed from `buildingKeepFraction`, which
   * this never was: park/vendor prop thinning has nothing to do with
   * building structural occupancy (see `render/babylonGameSession.ts`'s
   * `sceneryKeepFraction` field doc comment). */
  readonly sceneryKeepFraction: number;
  readonly registerShadowCaster: (
    mesh: AbstractMesh,
    x: number,
    z: number,
  ) => void;
  readonly registerDestructibleProp: (
    kind: string,
    x: number,
    z: number,
    scale: number,
    parts: readonly DestructiblePropPart[],
    elevationM?: number,
  ) => void;
  /** True when this ground prop's measured envelope fits below every deck. */
  readonly canPlaceGroundProp?: (
    x: number,
    z: number,
    requiredHeadroomM: number,
    footprintRadiusM: number,
  ) => boolean;
}

export interface GroundPropClearanceEnvelope {
  readonly requiredHeadroomM: number;
  readonly footprintRadiusM: number;
}

type GroundPropRenderSource = "procedural" | "nature";

/** Air above the visible top and around the measured x/z footprint. */
const PROP_VERTICAL_CLEARANCE_MARGIN_M = 0.3;
const PROP_FOOTPRINT_CLEARANCE_MARGIN_M = 0.1;

/**
 * The physical envelope of a prop before its authored placement scale.
 * Values come directly from `partsFor` below; pools of projected light are
 * intentionally excluded because they lie on the pavement rather than pierce
 * a deck. Imported planting uses measured GLB bounds from `natureCatalog`.
 */
const proceduralPropBounds = (
  kind: string,
  variant: number,
): readonly [heightM: number, footprintRadiusM: number] => {
  switch (kind) {
    case "tree":
      return variant === 1 ? [4.79, 1.25] : variant === 2 ? [4.92, 1.64] : [4.94, 1.86];
    case "streetlight":
      return [5.2, 1.53];
    case "sign":
      return [2.44, 0.76];
    case "shrub":
      return [1.08, 0.78];
    case "bench":
      return [0.89, 0.88];
    case "lamp":
      return [3.46, 0.22];
    case "hydrant":
      return [0.86, 0.2];
    case "bollard":
      return [0.855, 0.1];
    case "utility-pole":
      return [7.4, 0.85];
    case "vending":
      return [1.7, 0.59];
    case "chochin-post":
      return [2.84, 0.17];
    case "sakura":
      return [5.2, 1.9];
    case "vendor":
      return [2.35, 1.25];
    default:
      // Unknown future furniture retains the old conservative safety rule.
      return [8.25, 1.4];
  }
};

export function groundPropClearanceEnvelope(
  placement: Pick<PropPlacement, "kind" | "variant" | "scale">,
  mapVisualKey: string,
  source: GroundPropRenderSource = "procedural",
): GroundPropClearanceEnvelope {
  const scale = Math.max(0.01, Math.abs(placement.scale));
  const nature =
    source === "nature" || placement.kind === "palm" || placement.kind === "monument"
      ? natureModelForPlacement(mapVisualKey, placement.kind, placement.variant)
      : null;
  const [heightM, footprintRadiusM] = nature
    ? [nature.heightM, nature.footprintRadiusM]
    : proceduralPropBounds(placement.kind, placement.variant);
  return {
    requiredHeadroomM: heightM * scale + PROP_VERTICAL_CLEARANCE_MARGIN_M,
    footprintRadiusM:
      footprintRadiusM * scale + PROP_FOOTPRINT_CLEARANCE_MARGIN_M,
  };
}

const groundPropFits = (
  ctx: RoadsidePropsCtx,
  placement: Pick<PropPlacement, "kind" | "x" | "z" | "variant" | "scale">,
  mapVisualKey: string,
  source: GroundPropRenderSource = "procedural",
): boolean => {
  const envelope = groundPropClearanceEnvelope(
    placement,
    mapVisualKey,
    source,
  );
  return (
    ctx.canPlaceGroundProp?.(
      placement.x,
      placement.z,
      envelope.requiredHeadroomM,
      envelope.footprintRadiusM,
    ) ?? true
  );
};

/**
 * How close to a path a plant must be to stay an individually instanced,
 * knockable prop. Everything beyond becomes batched scenery, which cannot be
 * knocked down — so this is really "how far off a path a car can plausibly get
 * before the trees stop reacting", and it wants to stay generous.
 */
const PARK_KNOCKABLE_REACH_M = 10;

/**
 * Park planting and furniture as ordinary prop placements.
 *
 * Gated through `deterministicSceneryKeep` per placement: anything scattered
 * that skips that gate silently escapes the low-spec thinning entirely, and a
 * park is by some distance the densest thing this map scatters.
 */
function collectParkPlacements(
  ctx: RoadsidePropsCtx,
  mapPack: GameCanvasMapPack,
): { reachable: PropPlacement[]; interior: ParkPlacement[] } {
  const reachable: PropPlacement[] = [];
  const interior: ParkPlacement[] = [];
  const key = resolveMapVisualKey(mapPack.id);
  for (const landmark of mapPack.geometry.landmarks) {
    if (landmark.kind !== "park") continue;
    const layout = parkLayoutForLandmark(mapPack, landmark);
    for (const [index, placement] of layout.placements.entries()) {
      if (
        !deterministicSceneryKeep(
          `${landmark.id}:${placement.kind}:${index}`,
          ctx.sceneryKeepFraction,
        )
      ) {
        continue;
      }
      // Anything a driver can actually reach stays an individually instanced,
      // knockable prop. Everything deeper is scenery, and scenery in a park
      // this size has to be batched — see `buildParkPlanting`.
      //
      // Shrubs are never in that set however close they are. They are the
      // densest zone by some way, and their destructible entry is `damage:
      // "none"` / `fall: "squash"` — so paying a scene mesh each to make a
      // bush flinch is the worst trade in the park.
      const reachablePlacement =
        placement.kind !== "shrub" &&
        (placement.kind === "bench" ||
          placement.kind === "lamp" ||
          layout.paths.some(
            (path) =>
              distanceToPolylineM(placement, path.points) <=
              path.widthM / 2 + PARK_KNOCKABLE_REACH_M,
          ));
      if (reachablePlacement) {
        // Benches and lamps have no model in the planting kit, so they stay
        // procedural and ride the roadside pipeline as before. Planting goes
        // to the glb queue, which can only be drained after the preload.
        if (placement.kind === "bench" || placement.kind === "lamp") {
          if (groundPropFits(ctx, placement, key)) reachable.push(placement);
        } else {
          if (groundPropFits(ctx, placement, key, "nature")) {
            ctx.pendingPlantedProps.push(placement);
          }
        }
        continue;
      }
      if (groundPropFits(ctx, placement, key, "nature")) {
        interior.push(placement);
        ctx.pendingParkThickets.push(placement);
      }
    }
  }
  return { reachable, interior };
}

/**
 * Deterministic roadside dressing (trees, streetlights, signs plus per-map
 * extras) built from instanced master meshes: one draw call per part kind
 * regardless of how many props a map receives.
 */
export function buildRoadsideProps(
  ctx: RoadsidePropsCtx,
  mapPack: GameCanvasMapPack,
  palette: MapVisualPalette,
  mapId: string,
  roadSurfaces: readonly {
    readonly id: string;
    readonly centerline: readonly GameCanvasPoint[];
    readonly widthM: number;
    readonly sidewalkWidthM?: number;
  }[],
  signPoints: readonly GameCanvasPoint[] = [],
  occupiedPoints: readonly GameCanvasPoint[] = [],
) {
  const scene = ctx.scene;
  const key = resolveMapVisualKey(mapId);
  const kinds = roadsidePropKindsForMap(key);
  if (!kinds.length || !roadSurfaces.length) return;

  // Ground the scatter must keep off — gas-station forecourts and venue lots
  // (those models already fill that ground, and a tree sprouting on a forecourt
  // reads as a bug), the rail right-of-way, and authored landmarks — bucketed
  // by how hard the rule is. Derived by `roadsidePropKeepOuts`, a pure geometry
  // function rather than inline here, because which bucket a rect lands in is
  // exactly what a test has to be able to assert: see its own doc comment for
  // the lamp posts that shipped between the rails when the buckets were one
  // array, and `tests/roadsidePropKeepOuts.test.ts` for the net.
  const keepOuts = roadsidePropKeepOuts(mapPack);
  // The corniche promenade is laid before the random scatter so its points
  // pre-seed the spacing grid — scatter can jitter around the tree line but
  // never stand a prop inside it. Per-map open-sides lookup: a map absent
  // from OPEN_WATERFRONT_SIDES_BY_KEY gets no promenade decor at all, so
  // this stays additive for every city but Cairo, London and (Tokyo expansion
  // Phase 3) Tokyo — Cairo's own output is unchanged (same table, same
  // values, just read through a lookup instead of a ternary). The kind
  // lookup (PROMENADE_DECOR_KINDS_BY_KEY) is the same shape for the same
  // reason — Cairo keeps its literal "palm"/"streetlight" strings.
  const openWaterfrontSides = OPEN_WATERFRONT_SIDES_BY_KEY[key];
  const promenadeDecorKinds = PROMENADE_DECOR_KINDS_BY_KEY[key];
  const promenadePlacements = openWaterfrontSides && promenadeDecorKinds
    ? generatePromenadeDecor({
        roadSurfaces: roadSurfaces.map((surface) => ({
          id: surface.id,
          centerline: surface.centerline,
          widthM: surface.widthM,
          sidewalkWidthM: surface.sidewalkWidthM,
        })),
        // The caller deliberately supplies only at-grade roads for ordinary
        // scatter. Promenade offsets still need the omitted flyover footprints
        // so furniture cannot pierce an elevated deck.
        elevatedRoadSurfaces: (mapPack.geometry.roadSurfaces ?? [])
          .filter((surface) =>
            surface.centerline.some(
              (point) => (point.elevationM ?? 0) > 0.35,
            ),
          )
          .map((surface) => ({
            id: surface.id,
            centerline: surface.centerline,
            widthM: surface.widthM,
            sidewalkWidthM: surface.sidewalkWidthM,
          })),
        waterPolygons: (mapPack.geometry.waterBodies ?? []).map(
          (body) => body.polygon,
        ),
        openSides: openWaterfrontSides,
        sidewalkWidthM: PAVED_SIDEWALK_WIDTH_M,
        worldSize: mapPack.geometry.worldSize,
        seed: hashStringToSeed(`${mapId}-promenade`),
        treeKind: promenadeDecorKinds.treeKind,
        lampKind: promenadeDecorKinds.lampKind,
        treeVariants: promenadeDecorKinds.treeVariants,
        railLines: (mapPack.geometry.railLines ?? []).map((line) => ({
          points: line.points,
          corridorHalfWidthM: line.corridorHalfWidthM,
        })),
        // The promenade is deterministic rather than random, but it must
        // honour the same immovable landmarks, rail exclusion rectangles and
        // POI forecourts as roadside scatter. Passing only `poiRects` let a
        // Thames lamp into the elevated rail approach and a tree into a venue
        // lot when London joined the promenade system.
        keepOutRects: keepOuts.hardRects,
        buildingRects:
          key === "cairo"
            ? mapPack.geometry.blocks.map((block) => ({
                center: block.center,
                size: block.size,
                headingDeg: block.headingDeg,
              }))
            : undefined,
        // Cairo's imported palms have a much wider measured crown than the
        // generator's generic half-metre deck allowance. Give the generator
        // the same final headroom query used by the renderer so a newly
        // widened flyover moves the palm along the Corniche instead of the
        // later render filter simply deleting it.
        canPlaceProp:
          key === "cairo"
            ? (placement) => groundPropFits(ctx, placement, key)
            : undefined,
        shorelineClearanceM:
          key === "cairo" ? PROMENADE_SHORELINE_CLEARANCE_M : undefined,
      })
    : [];
  const roadsidePlacements = generateRoadsidePropPlacements({
    roadSurfaces: roadSurfaces.map((surface) => ({
      id: surface.id,
      centerline: surface.centerline,
      widthM: surface.widthM,
      sidewalkWidthM: surface.sidewalkWidthM,
    })),
    blocks: mapPack.geometry.blocks.map((block) => ({
      center: block.center,
      size: block.size,
      headingDeg: block.headingDeg,
    })),
    landmarks: keepOuts.hardRects,
    roadCrossedRects: keepOuts.roadCrossedRects,
    worldSize: mapPack.geometry.worldSize,
    shoulderWidthM: palette.paved
      ? PAVED_SIDEWALK_WIDTH_M
      : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2),
    seed: hashStringToSeed(`${mapId}-props`),
    kinds,
    waterPolygons: (mapPack.geometry.waterBodies ?? []).map(
      (body) => body.polygon,
    ),
    // Hand-placed furniture, regulatory sign posts and the promenade line
    // pre-seed the mutual spacing grid so the random scatter can never
    // stand a prop on them.
    occupiedPoints:
      key === "london" ||
      key === "tokyo" ||
      signPoints.length ||
      occupiedPoints.length ||
      promenadePlacements.length
        ? [
            ...(key === "london" ? LONDON_FURNITURE_POINTS : []),
            ...(key === "tokyo" ? TOKYO_FURNITURE_POINTS : []),
            ...signPoints,
            ...occupiedPoints,
            ...promenadePlacements,
          ]
        : undefined,
  });

  // Park planting rides the same pipeline as the roadside scatter, so it
  // shares the tree masters, the shadow-caster registration and — the point —
  // `registerDestructibleProp`. A tree you can flatten on the street and one
  // you cannot flatten in a park would read as a bug, and the alternative was
  // a second, parallel prop builder.
  const park = collectParkPlacements(ctx, mapPack);
  const placements = [
    ...roadsidePlacements,
    ...promenadePlacements,
    ...park.reachable,
  ].filter(
    (placement) =>
      (key !== "cairo" ||
        cairoTahrirMarkedLotAllowsRoadsidePlacement(placement)) &&
      groundPropFits(ctx, placement, key),
  );
  if (!placements.length && !park.interior.length) return;

  const material = (name: string, color: Color3, emissive?: Color3) =>
    makeMaterial(scene, `prop-${name}`, color, emissive);
  const trunk = material("trunk", new Color3(0.3, 0.19, 0.1));
  const leaves = [
    material("leaves-0", new Color3(0.16, 0.36, 0.19)),
    material("leaves-1", new Color3(0.2, 0.42, 0.2)),
    material("leaves-2", new Color3(0.13, 0.3, 0.17)),
  ];
  const iron = material("iron", new Color3(0.09, 0.1, 0.11));
  // Streetlights blaze warm at night (bloom turns them into glowing points);
  // by day they carry only a faint warm cast.
  const night = palette.night ?? false;
  const lampHead = material(
    "lamp-head",
    new Color3(0.85, 0.66, 0.4),
    // Warm sodium-vapour orange at night (blooms into a soft glow); a faint
    // warm cast by day.
    night ? new Color3(1.5, 0.86, 0.34) : new Color3(0.3, 0.26, 0.12),
  );
  // At night each streetlight drops a soft warm pool of light on the pavement
  // (a radial-gradient decal) — the signature "sodium spill" of a dusk street.
  let lampPool: StandardMaterial | null = null;
  if (night) {
    const poolTex = new DynamicTexture(
      "lamp-pool-tex",
      { width: 128, height: 128 },
      scene,
      true,
    );
    const pctx = textureContext(poolTex);
    // Wide bright core, long tail. The effective falloff is steeper than
    // authored: with ALPHA_ADD the blend is src·alpha + dst, and the gradient
    // rides in both the rgb and the alpha, so the add fades roughly as the
    // square of these stops.
    const grad = pctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,196,120,0.72)");
    grad.addColorStop(0.22, "rgba(255,175,100,0.45)");
    grad.addColorStop(0.55, "rgba(255,150,78,0.18)");
    grad.addColorStop(1, "rgba(255,140,60,0)");
    pctx.fillStyle = grad;
    pctx.fillRect(0, 0, 128, 128);
    poolTex.update();
    poolTex.hasAlpha = true;
    lampPool = new StandardMaterial("lamp-pool", scene);
    // ADDITIVE, not alpha-combine: a combine pool at 85% centre alpha
    // *replaces* the asphalt with a flat gradient card — the owner read it as
    // "a yellow blurb, not lighting the street". Adding on top keeps the road
    // texture visible through the glow, which is what makes it read as light
    // falling on tarmac. Peak tuned to sit UNDER the night bloom threshold:
    // at the first pass (0.8 emissive, 0.9 centre alpha) every pool bloomed
    // into a white ellipse and the warm sodium colour was gone.
    lampPool.emissiveColor = new Color3(0.62, 0.4, 0.17);
    lampPool.emissiveTexture = poolTex;
    lampPool.opacityTexture = poolTex;
    lampPool.alphaMode = Constants.ALPHA_ADD;
    lampPool.diffuseColor = Color3.Black();
    lampPool.specularColor = Color3.Black();
    lampPool.disableLighting = true;
    lampPool.disableDepthWrite = true;
  }
  const signPost = material("sign-post", new Color3(0.45, 0.47, 0.48));
  const cairoDirectionPanel = (
    name: string,
    arabic: string,
    english: string,
    background: string,
  ): StandardMaterial => {
    // Square canvas: the legend fills the top half, the bottom half stays
    // bare aluminium for the back and the four edges. See
    // `cairoDirectionPanelFaceUv`.
    const texture = new DynamicTexture(
      `prop-${name}-texture`,
      { width: 512, height: 512 },
      scene,
      true,
    );
    const context = textureContext(texture);
    context.fillStyle = "#9aa0a3";
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = background;
    context.fillRect(0, 0, 512, 256);
    context.strokeStyle = "#f6f1dc";
    context.lineWidth = 12;
    context.strokeRect(8, 8, 496, 240);
    context.fillStyle = "#f6f1dc";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font =
      "700 84px 'Noto Sans Arabic', 'Geeza Pro', Arial, sans-serif";
    context.fillText(arabic, 256, 85);
    context.font = "700 47px Figtree, Arial, sans-serif";
    context.fillText(english, 256, 184);
    texture.update();
    const panel = new StandardMaterial(`prop-${name}`, scene);
    panel.diffuseTexture = texture;
    panel.emissiveTexture = texture;
    panel.emissiveColor = night
      ? new Color3(0.38, 0.42, 0.46)
      : new Color3(0.08, 0.08, 0.08);
    panel.specularColor = Color3.Black();
    return panel;
  };
  const signPanels =
    key === "cairo"
      ? [
          cairoDirectionPanel(
            "cairo-sign-downtown",
            "وسط البلد",
            "DOWNTOWN",
            "#1b5684",
          ),
          cairoDirectionPanel(
            "cairo-sign-zamalek",
            "الزمالك",
            "ZAMALEK",
            "#245f42",
          ),
        ]
      : [
          material(
            "sign-panel-blue",
            new Color3(0.1, 0.28, 0.5),
            night ? new Color3(0.14, 0.38, 0.72) : undefined,
          ),
          material(
            "sign-panel-green",
            new Color3(0.1, 0.35, 0.2),
            night ? new Color3(0.14, 0.5, 0.26) : undefined,
          ),
        ];
  const benchTimber = material("bench-timber", new Color3(0.35, 0.26, 0.17));
  const hydrantRed = material("hydrant", new Color3(0.62, 0.1, 0.07));
  const bollardPale = material("bollard", new Color3(0.75, 0.76, 0.72));
  const poleWood = material("utility-pole", new Color3(0.35, 0.32, 0.28));
  const vendingBodies = [
    material("vending-red", new Color3(0.68, 0.14, 0.13)),
    material("vending-white", new Color3(0.82, 0.83, 0.82)),
  ];
  const vendingPanel = material(
    "vending-panel",
    new Color3(0.55, 0.6, 0.58),
    new Color3(0.22, 0.26, 0.24),
  );
  // Tokyo expansion Phase 9 (R14): the promenade's own automatic chochin/
  // sakura placements (generatePromenadeDecor's treeKind/lampKind) render
  // through this same procedural pipeline — same dimensions as, but a
  // separate master set from, render/tokyoLandmarks.ts's hand-placed
  // shotengai posts (this file's own house style: see the streetlight case
  // above vs. londonLandmarks.ts's lamp for the same non-sharing precedent).
  // Gated on `key === "tokyo"`, same reasoning as the Cairo-only direction
  // panels above: only Tokyo ever emits a "chochin-post"/"sakura" placement
  // (`PROMENADE_DECOR_KINDS_BY_KEY`), so building these unconditionally
  // would cost every OTHER city six materials it can never use — confirmed
  // by `fourCityRenderCharacterization`'s own pinned material counts, which
  // is exactly the "byte-identical except a legitimate shared-code touch"
  // net this phase's own gate cares about.
  const tokyoNightProps =
    key === "tokyo"
      ? {
          chochinPole: material("chochin-pole", new Color3(0.24, 0.12, 0.08)),
          chochinLantern: material(
            "chochin-lantern",
            new Color3(0.55, 0.09, 0.07),
            new Color3(0.92, 0.38, 0.11),
          ),
          chochinCap: material("chochin-cap", new Color3(0.07, 0.06, 0.06)),
          sakuraTrunk: material("sakura-trunk", new Color3(0.3, 0.24, 0.22)),
          // White (Someiyoshino) and deep pink (Kanzan) — the two commonest
          // real cherry varieties, alternated by variant.
          sakuraBlossoms: [
            material("sakura-blossom-0", new Color3(0.86, 0.8, 0.78)),
            material("sakura-blossom-1", new Color3(0.82, 0.5, 0.6)),
          ],
          // Street life pass (P9): the utility pole's insulator studs — a
          // pale ceramic tone, deliberately far lighter than `iron`'s
          // near-black crossarms so the studs actually read as a distinct
          // fitting rather than disappearing against the arm they sit on.
          // Same Tokyo-only gate as everything else in this bag (only
          // Tokyo's kinds list ever emits a "utility-pole" placement).
          utilityInsulator: material("utility-insulator", new Color3(0.74, 0.71, 0.64)),
        }
      : null;

  interface PropPart {
    readonly master: Mesh;
    readonly offset: Vector3;
    readonly castShadow?: boolean;
  }
  const masterBox = (
    name: string,
    dimensions: {
      width: number;
      height: number;
      depth: number;
      faceUV?: readonly Vector4[];
    },
    partMaterial: StandardMaterial,
  ): Mesh => {
    const mesh = MeshBuilder.CreateBox(
      `prop-master-${name}`,
      { ...dimensions, faceUV: dimensions.faceUV?.slice() },
      scene,
    );
    setMeshMaterial(mesh, partMaterial);
    mesh.isVisible = false;
    return mesh;
  };
  const masterCylinder = (
    name: string,
    options: {
      height: number;
      diameter?: number;
      diameterTop?: number;
      diameterBottom?: number;
    },
    partMaterial: StandardMaterial,
  ): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(
      `prop-master-${name}`,
      { tessellation: 8, ...options },
      scene,
    );
    setMeshMaterial(mesh, partMaterial);
    mesh.isVisible = false;
    return mesh;
  };
  const masterIcoSphere = (
    name: string,
    radius: number,
    partMaterial: StandardMaterial,
  ): Mesh => {
    const mesh = MeshBuilder.CreateIcoSphere(
      `prop-master-${name}`,
      { radius, subdivisions: 1 },
      scene,
    );
    setMeshMaterial(mesh, partMaterial);
    mesh.isVisible = false;
    return mesh;
  };

  const masters = new Map<string, readonly PropPart[]>();
  const partsFor = (kind: string, variant: number): readonly PropPart[] => {
    const cacheKey = `${kind}:${variant}`;
    const cached = masters.get(cacheKey);
    if (cached) return cached;
    let parts: readonly PropPart[];
    switch (kind) {
      case "tree": {
        // Leafy canopy from overlapping faceted lobes (variants 0/2) or a
        // stacked-cone conifer (variant 1); secondary lobes skip shadow
        // casting since they sit inside the primary crown's shadow.
        const leaf =
          variant === 1 ? leaves[2] : variant === 2 ? leaves[1] : leaves[0];
        const lobe = (
          suffix: string,
          radius: number,
          offset: Vector3,
          castShadow?: boolean,
        ): PropPart => ({
          master: masterIcoSphere(`${cacheKey}-${suffix}`, radius, leaf),
          offset,
          castShadow,
        });
        if (variant === 1) {
          parts = [
            {
              master: masterCylinder(
                `${cacheKey}-trunk`,
                { height: 1.5, diameter: 0.28 },
                trunk,
              ),
              offset: new Vector3(0, 0.75, 0),
            },
            {
              master: masterCylinder(
                `${cacheKey}-t0`,
                { height: 2, diameterTop: 0, diameterBottom: 2.5 },
                leaf,
              ),
              offset: new Vector3(0, 2.2, 0),
            },
            {
              master: masterCylinder(
                `${cacheKey}-t1`,
                { height: 1.7, diameterTop: 0, diameterBottom: 1.9 },
                leaf,
              ),
              offset: new Vector3(0, 3.29, 0),
            },
            {
              master: masterCylinder(
                `${cacheKey}-t2`,
                { height: 1.3, diameterTop: 0, diameterBottom: 1.2 },
                leaf,
              ),
              offset: new Vector3(0, 4.14, 0),
            },
          ];
        } else if (variant === 2) {
          parts = [
            {
              master: masterCylinder(
                `${cacheKey}-trunk`,
                { height: 2.4, diameterTop: 0.24, diameterBottom: 0.35 },
                trunk,
              ),
              offset: new Vector3(0, 1.2, 0),
            },
            lobe("c0", 1.4, new Vector3(0, 3.17, 0)),
            lobe("c1", 1.05, new Vector3(0.59, 3.87, -0.25), false),
          ];
        } else {
          parts = [
            {
              master: masterCylinder(
                `${cacheKey}-trunk`,
                { height: 2, diameterTop: 0.27, diameterBottom: 0.39 },
                trunk,
              ),
              offset: new Vector3(0, 1, 0),
            },
            lobe("c0", 1.7, new Vector3(0, 2.94, 0)),
            lobe("c1", 1.15, new Vector3(0.71, 3.79, -0.31), false),
            lobe("c2", 1, new Vector3(-0.77, 3.42, 0.51), false),
          ];
        }
        break;
      }
      case "streetlight": {
        const cairoPoolSize =
          key === "cairo" ? [7.4, 8.8, 10][variant % 3] : 10;
        parts = [
          {
            master: masterCylinder(cacheKey, { height: 5.2, diameter: 0.16 }, iron),
            offset: new Vector3(0, 2.6, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-arm`,
              { width: 0.09, height: 0.09, depth: 1.4 },
              iron,
            ),
            offset: new Vector3(0, 5.15, 0.6),
          },
          {
            master: masterBox(
              `${cacheKey}-head`,
              { width: 0.26, height: 0.12, depth: 0.55 },
              lampHead,
            ),
            offset: new Vector3(0, 5.08, 1.25),
          },
          ...(lampPool
            ? [
                {
                  // 10 m pool pushed 2.1 m past the pole — with the pole
                  // kerb-seated (curbOffsetM 0.7) that centres the spill
                  // ~1.4 m INSIDE the carriageway, so the light visibly lands
                  // on the street, spanning kerb to roughly mid-lane. (12 m
                  // overlapped neighbouring pools into one washed band, and
                  // overhung a bridge parapet onto the water below.)
                  master: masterBox(
                    `${cacheKey}-pool`,
                    {
                      width: cairoPoolSize,
                      height: 0.02,
                      depth: cairoPoolSize,
                    },
                    lampPool,
                  ),
                  offset: new Vector3(0, 0.07, 2.1),
                  castShadow: false,
                },
              ]
            : []),
        ];
        break;
      }
      case "sign":
        parts = [
          {
            master: masterCylinder(cacheKey, { height: 2.4, diameter: 0.09 }, signPost),
            offset: new Vector3(0, 1.2, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-panel`,
              {
                width: key === "cairo" ? 1.5 : 0.72,
                height: key === "cairo" ? 0.78 : 0.5,
                depth: 0.05,
                faceUV:
                  key === "cairo" ? cairoDirectionPanelFaceUv() : undefined,
              },
              signPanels[variant % signPanels.length],
            ),
            // Hung on the road side of the post rather than threaded onto it:
            // the panel is 0.05 deep and the post 0.09 across, so a coaxial
            // panel leaves the post poking out of both faces. Same trick, and
            // the same clearance, as the regulatory blades' -0.08 — mirrored,
            // because those read on -Z and the scattered sign reads on +Z.
            offset: new Vector3(0, key === "cairo" ? 2.05 : 2.15, 0.08),
          },
        ];
        break;
      case "shrub": {
        // Two overlapping lobes at slightly different heights, so a run of
        // them along a path reads as planting rather than as a row of balls.
        const leaf = leaves[variant % leaves.length];
        parts = [
          {
            master: masterIcoSphere(`${cacheKey}-a`, 0.62, leaf),
            offset: new Vector3(0, 0.46, 0),
          },
          {
            master: masterIcoSphere(`${cacheKey}-b`, 0.44, leaf),
            offset: new Vector3(0.34, 0.33, 0.12),
            castShadow: false,
          },
        ];
        break;
      }
      case "bench":
        parts = [
          {
            master: masterBox(
              `${cacheKey}-seat`,
              { width: 1.7, height: 0.09, depth: 0.46 },
              benchTimber,
            ),
            offset: new Vector3(0, 0.45, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-back`,
              { width: 1.7, height: 0.42, depth: 0.08 },
              benchTimber,
            ),
            offset: new Vector3(0, 0.68, -0.19),
          },
          {
            master: masterBox(
              `${cacheKey}-legs`,
              { width: 1.5, height: 0.42, depth: 0.08 },
              iron,
            ),
            offset: new Vector3(0, 0.22, 0),
            castShadow: false,
          },
        ];
        break;
      case "lamp":
        // A park lamp, not a streetlight: shorter, on a slimmer column, and
        // without the road-facing arm.
        parts = [
          {
            master: masterCylinder(
              `${cacheKey}-column`,
              { height: 3.1, diameterTop: 0.09, diameterBottom: 0.15 },
              iron,
            ),
            offset: new Vector3(0, 1.55, 0),
          },
          {
            master: masterIcoSphere(`${cacheKey}-globe`, 0.22, lampHead),
            offset: new Vector3(0, 3.24, 0),
            castShadow: false,
          },
        ];
        break;
      case "hydrant":
        parts = [
          {
            master: masterCylinder(cacheKey, { height: 0.7, diameter: 0.4 }, hydrantRed),
            offset: new Vector3(0, 0.36, 0),
          },
          {
            master: masterCylinder(
              `${cacheKey}-cap`,
              { height: 0.16, diameterTop: 0.12, diameterBottom: 0.34 },
              hydrantRed,
            ),
            offset: new Vector3(0, 0.78, 0),
          },
        ];
        break;
      case "bollard":
        parts = [
          {
            master: masterCylinder(
              cacheKey,
              { height: 0.85, diameterTop: 0.16, diameterBottom: 0.2 },
              bollardPale,
            ),
            offset: new Vector3(0, 0.43, 0),
          },
        ];
        break;
      case "utility-pole": {
        // Street life pass (P9): a transformer can slung below the lower
        // crossarm and a few insulator studs on top of each arm — the plan's
        // own "dark wood/concrete cylinder, one or two crossarms, a
        // transformer can, small insulator studs" description in full. Cheap
        // (three more master part kinds, three more draw calls total for the
        // whole city, not per-pole) and purely additive: `utility-pole`'s
        // spacing/variant config is untouched, so the seeded roadside-prop
        // stream that walks `kinds` is unaffected — only the geometry each
        // already-placed pole instances gets more detailed.
        const insulator = tokyoNightProps?.utilityInsulator ?? iron;
        const insulatorStud = (suffix: string, offset: Vector3): PropPart => ({
          master: masterCylinder(
            `${cacheKey}-${suffix}`,
            { height: 0.14, diameterTop: 0.05, diameterBottom: 0.07 },
            insulator,
          ),
          offset,
        });
        parts = [
          {
            master: masterCylinder(cacheKey, { height: 7.4, diameter: 0.22 }, poleWood),
            offset: new Vector3(0, 3.7, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-arm-top`,
              { width: 1.7, height: 0.09, depth: 0.09 },
              iron,
            ),
            offset: new Vector3(0, 6.8, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-arm-low`,
              { width: 1.25, height: 0.08, depth: 0.08 },
              iron,
            ),
            offset: new Vector3(0, 6.25, 0),
          },
          // A grey cylindrical transformer can, hung off-centre below the
          // lower arm the way a real distribution transformer straddles a
          // pole rather than sitting on its own axis.
          {
            master: masterCylinder(
              `${cacheKey}-transformer`,
              { height: 0.62, diameter: 0.34 },
              poleWood,
            ),
            offset: new Vector3(0.32, 5.7, 0),
            castShadow: false,
          },
          insulatorStud("insulator-top-a", new Vector3(-0.62, 6.86, 0)),
          insulatorStud("insulator-top-b", new Vector3(0.62, 6.86, 0)),
          insulatorStud("insulator-low", new Vector3(-0.45, 6.31, 0)),
        ];
        break;
      }
      case "vending":
        parts = [
          {
            master: masterBox(
              cacheKey,
              { width: 0.92, height: 1.7, depth: 0.72 },
              vendingBodies[variant % vendingBodies.length],
            ),
            offset: new Vector3(0, 0.85, 0),
          },
          {
            master: masterBox(
              `${cacheKey}-panel`,
              { width: 0.78, height: 1.15, depth: 0.05 },
              vendingPanel,
            ),
            offset: new Vector3(0, 0.95, 0.37),
          },
        ];
        break;
      case "chochin-post": {
        // The promenade's own automatic lantern-post placements
        // (generatePromenadeDecor's lampKind, Tokyo only). Pole, barrel-ish
        // lantern body, and two tapered black cap bands — the classic
        // chochin silhouette, matching render/tokyoLandmarks.ts's hand-
        // placed shotengai posts dimension-for-dimension. Guarded (never
        // actually null in practice: only Tokyo ever emits this kind) so
        // the materials above stay Tokyo-only without an unsafe assertion.
        if (!tokyoNightProps) {
          parts = [];
          break;
        }
        const { chochinPole, chochinLantern, chochinCap } = tokyoNightProps;
        parts = [
          {
            master: masterCylinder(cacheKey, { height: 2.3, diameter: 0.09 }, chochinPole),
            offset: new Vector3(0, 1.15, 0),
          },
          {
            master: masterCylinder(`${cacheKey}-lantern`, { height: 0.46, diameter: 0.32 }, chochinLantern),
            offset: new Vector3(0, 2.55, 0),
          },
          {
            master: masterCylinder(
              `${cacheKey}-cap-bottom`,
              { height: 0.06, diameterTop: 0.34, diameterBottom: 0.12 },
              chochinCap,
            ),
            offset: new Vector3(0, 2.29, 0),
          },
          {
            master: masterCylinder(
              `${cacheKey}-cap-top`,
              { height: 0.06, diameterTop: 0.12, diameterBottom: 0.34 },
              chochinCap,
            ),
            offset: new Vector3(0, 2.81, 0),
          },
          // A lantern casts a small warm circle around its own post — a
          // quarter of a streetlight's spill, centred on the post since the
          // chochin hangs on it rather than reaching over the road.
          ...(lampPool
            ? [
                {
                  master: masterBox(
                    `${cacheKey}-pool`,
                    { width: 5, height: 0.02, depth: 5 },
                    lampPool,
                  ),
                  offset: new Vector3(0, 0.07, 0),
                  castShadow: false,
                },
              ]
            : []),
        ];
        break;
      }
      case "sakura": {
        // The promenade's cherry tree (generatePromenadeDecor's treeKind,
        // Tokyo only) — a slim trunk under one broad rounded blossom crown,
        // alternating white (Someiyoshino) and deep pink (Kanzan) by variant.
        if (!tokyoNightProps) {
          parts = [];
          break;
        }
        const { sakuraTrunk, sakuraBlossoms } = tokyoNightProps;
        const blossom = sakuraBlossoms[variant % sakuraBlossoms.length];
        parts = [
          {
            master: masterCylinder(
              `${cacheKey}-trunk`,
              { height: 2.2, diameterTop: 0.22, diameterBottom: 0.34 },
              sakuraTrunk,
            ),
            offset: new Vector3(0, 1.1, 0),
          },
          {
            master: masterIcoSphere(`${cacheKey}-canopy`, 1.9, blossom),
            offset: new Vector3(0, 3.3, 0),
          },
        ];
        break;
      }
      default:
        parts = [];
    }
    masters.set(cacheKey, parts);
    return parts;
  };

  let instanceIndex = 0;
  for (const placement of placements) {
    if (placement.kind === "vendor") {
      // glb cart, not a procedural master — instantiate later once preloaded.
      const config = NYC_VENDORS[placement.variant % NYC_VENDORS.length];
      if (config) {
        ctx.pendingVendors.push({ config, x: placement.x, z: placement.z, yaw: placement.rotationY });
      }
      continue;
    }
    if (placement.kind === "palm") {
      // Same deal as the vendor cart: an imported model, so it can only be
      // instanced once the preload is in. It rides the planting queue rather
      // than a queue of its own, which is what makes a street palm and a
      // park palm literally the same master — see `pendingPlantedProps`.
      //
      // The procedural palm this replaced was a bare trunk under a pair of
      // flat cones, and the owner did not read it as a palm at all: shown a
      // screenshot of the Corniche's own palm line, they asked for "a tree
      // that is very frequent" to be swapped FOR palms, and said they
      // "rarely if ever" saw one in Cairo. Fronds are not a detail here —
      // they are the whole of whether the species registers.
      ctx.pendingPlantedProps.push({
        kind: "palm",
        x: placement.x,
        z: placement.z,
        rotationY: placement.rotationY,
        scale: placement.scale,
        variant: placement.variant,
      });
      continue;
    }
    const parts = partsFor(placement.kind, placement.variant);
    // Every remaining scattered prop is street furniture: it faces the road
    // as placed, and it is knockable. The kerb-parked vehicles that needed a
    // quarter turn onto the kerb axis — and that were decoration with no
    // collider — are all gone, so neither special case survives.
    const rotationY = placement.rotationY;
    const sin = Math.sin(rotationY);
    const cos = Math.cos(rotationY);
    const destructibleParts: DestructiblePropPart[] = [];
    for (const part of parts) {
      const instance = part.master.createInstance(
        `prop-${placement.kind}-${instanceIndex}`,
      );
      instanceIndex += 1;
      const scaled = part.offset.scale(placement.scale);
      instance.position.set(
        placement.x + scaled.x * cos + scaled.z * sin,
        scaled.y,
        placement.z - scaled.x * sin + scaled.z * cos,
      );
      instance.rotation.y = rotationY;
      instance.scaling.setAll(placement.scale);
      instance.isPickable = false;
      ctx.staticSceneryFreeze.push(instance);
      if (part.castShadow !== false) {
        ctx.registerShadowCaster(instance, placement.x, placement.z);
      }
      destructibleParts.push({
        node: instance,
        isLightPool: part.master.name.includes("-pool"),
      });
    }
    ctx.registerDestructibleProp(
      placement.kind,
      placement.x,
      placement.z,
      placement.scale,
      destructibleParts,
    );
  }

  for (const propMaterial of [
    trunk,
    ...leaves,
    iron,
    lampHead,
    signPost,
    ...signPanels,
    hydrantRed,
    bollardPale,
    poleWood,
    ...vendingBodies,
    vendingPanel,
    ...(tokyoNightProps
      ? [
          tokyoNightProps.chochinPole,
          tokyoNightProps.chochinLantern,
          tokyoNightProps.chochinCap,
          tokyoNightProps.sakuraTrunk,
          ...tokyoNightProps.sakuraBlossoms,
          tokyoNightProps.utilityInsulator,
        ]
      : []),
  ]) {
    propMaterial.freeze();
  }
}
