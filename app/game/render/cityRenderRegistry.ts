import type {
  AbstractMesh,
  Mesh,
  Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { buildCairoLandmark } from "./cairoLandmarks";
import { buildLondonLandmark, buildLondonStreetFurniture } from "./londonLandmarks";
import type { DestructiblePropPart } from "./propCatalog";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import type { MapVisualPalette } from "../visuals";

/**
 * Explicit mapId -> city-specific landmark/street-furniture builders,
 * replacing three mapId-sniffing branches that used to sit directly in
 * `buildScenarioEnvironment` (Phase 4.5 — the one deliberate structural
 * change in an otherwise move-only decomposition program,
 * `.claude/refactor-plan.md`, gitignored).
 *
 * An unrecognised mapId gets `undefined` back, never a default city's look —
 * a landmark on a map with no row renders through `buildScenarioEnvironment`'s
 * own generic `landmark.kind` fallback (park / railway / tower / plain
 * facade), same as it always has, rather than borrowing NYC's or anyone
 * else's silhouettes. `resolveMapVisualKey` (`../visuals`) makes the same
 * choice a different way, since it exists for a different reason: every map
 * needs *some* palette to render at all, so instead of a silent default it
 * throws on an unrecognised id — a landmark with no row here is a supported,
 * silent no-op, but a map with no palette is a configuration bug that should
 * fail loudly the moment it loads.
 *
 * `buildLondonLandmark`/`buildCairoLandmark` are per-landmark dispatchers —
 * called once for each entry in `mapPack.geometry.landmarks`, returning
 * whether they handled it — not per-scenario builders, so `landmarks` keeps
 * that `(ctx, landmark, material, mapPack) => boolean` shape rather than a
 * bare `(ctx) => void`. `CityRenderRegistryCtx` is the union of every field
 * either city's builders need; each still only reads the subset its own
 * narrower ctx type (`LondonLandmarksCtx`, `CairoLandmarkCtx`) declares, and
 * both are assignable a wider ctx like any other structurally-typed object.
 */

export interface CityRenderRegistryCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
  readonly visualPalette: MapVisualPalette;
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
  ) => void;
  readonly buildFlatPolygonMesh: (
    id: string,
    polygon: readonly GameCanvasPoint[],
    y: number,
    material: StandardMaterial,
  ) => Mesh | undefined;
  readonly buildParkLawnPolygon: (
    id: string,
    polygon: readonly GameCanvasPoint[],
    palette: MapVisualPalette,
    mapId: string,
  ) => Mesh | undefined;
}

export interface CityRenderRegistryEntry {
  readonly landmarks?: (
    ctx: CityRenderRegistryCtx,
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    material: StandardMaterial,
    mapPack: GameCanvasMapPack,
  ) => boolean;
  readonly streetFurniture?: (ctx: CityRenderRegistryCtx) => void;
}

export const CITY_RENDER_REGISTRY: Readonly<Record<string, CityRenderRegistryEntry>> = {
  "london-south-kensington": {
    landmarks: buildLondonLandmark,
    streetFurniture: buildLondonStreetFurniture,
  },
  "cairo-central-nile": {
    landmarks: buildCairoLandmark,
  },
};

/** `CITY_RENDER_REGISTRY[mapId]` directly would type as always-defined (no
 * `noUncheckedIndexedAccess`), which is exactly the silent-default trap this
 * registry exists to avoid — this makes the miss case explicit instead. */
export function cityRenderRegistryFor(mapId: string): CityRenderRegistryEntry | undefined {
  return CITY_RENDER_REGISTRY[mapId];
}
