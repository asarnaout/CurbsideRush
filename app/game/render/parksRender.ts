import {
  type AbstractMesh,
  Color3,
  type DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { boxLengthYaw, clipRectToRoadSide } from "../geometry/cairoParkland";
import { earClipPolygonIndices } from "../geometry/waterGeometry";
import { createBox, createCylinder, setMeshMaterial } from "./meshPrimitives";
import { parkLayoutForLandmark, type ParkFeature } from "../parkLayouts";
import {
  createAsphaltTexture,
  createFlowerbedTexture,
  createGrassTexture,
} from "./proceduralTextures";
import { GRASS_TILE_M, PARK_BED_Y, PARK_LAWN_Y, PARK_PATH_Y } from "./renderConstants";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import { buildPlanarUVs, hashStringToSeed, mixHexColors, type MapVisualPalette } from "../visuals";

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

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

function colorFromHex(value: string, fallback: Color3): Color3 {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return fallback;
  const n = Number.parseInt(match[1], 16);
  return new Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Polygon offset pulling park paths toward the camera. The lawn/path gap is
 * finer than the depth quantum at Central Park's far end, and polygon offset
 * scales with that quantum where another millimetre of height does not — the
 * same reasoning as `CAIRO_DECAL_Z_OFFSET_UNITS`.
 */
const PARK_PATH_Z_OFFSET_UNITS = -2;
/**
 * The park ground stack is FOUR offset tiers, one per rung: crossing paths
 * (-4) over spines (-2) over beds/courts (-1) over the ground rung (0: lawn,
 * plaza discs, terraces). Two park surfaces may overlap only when they differ
 * in tier — a crossing lies over the spine it meets at the same y, and a
 * spine lies over the bed it grazes 5.5 mm below.
 */
const PARK_BED_Z_OFFSET_UNITS = -1;
const PARK_PATH_CROSS_Z_OFFSET_UNITS = -4;
/**
 * Park boundary wall height. Tall enough to read as a boundary from a car at
 * speed — a hit is a scored collision, so an edge the driver cannot see coming
 * would be indistinguishable from an invisible wall.
 */
const PARK_WALL_HEIGHT_M = 0.95;

/**
 * A park's ground (lawn, arbitrary-outline lawn, footpaths, wall) and its
 * bespoke pieces (courts, parterres, plaza discs, torii, lanterns, plinths).
 * De-methodized out of `BabylonGameSession` (Phase 3.11, characterized ahead
 * of time by `tests/parksRenderCharacterization.test.tsx` — coupling 20,
 * over the plan's >= 9 threshold).
 *
 * `buildFlatPolygonMesh`/`buildParkLawnPolygon` were threaded as ctx
 * callbacks into `cairoLandmarks.ts` back in Phase 3.2 — session-resident
 * methods this cargo hadn't reached yet, and every caller was written to
 * stay agnostic to where they eventually landed. That callback shape in
 * cairoLandmarks.ts is unchanged; only GameCanvas.tsx's closure bodies now
 * route to the free functions here instead of `this`.
 *
 * The seven memoized materials/textures (`parkLawnMaterial` and friends)
 * were `this.parkLawnMaterial` etc. — read and written only inside this
 * cargo, so they become `ctx.masters`, one record `buildScenarioEnvironment`
 * constructs fresh per pass and threads through every call, the same
 * `signPostMasterCache`-bug-avoidance shape Phase 3.9's `trafficControlRender`
 * established (a module-level cache doesn't reset between session rebuilds;
 * a per-pass record can't help but reset, since nothing outside one
 * `buildScenarioEnvironment` call keeps a reference to it).
 *
 * `registerMirrorSurface`, `applyGrassDetailMap`, `applyWorldPlanarGrassUVs`,
 * `registerStaticCell`, `registerShadowCaster` and `createRoadSurfaceMesh`
 * are threaded as ctx callbacks — all six are shared well beyond this cargo
 * (the base ground, the shoulder/junction fills, every other builder that
 * files into the static-scenery spatial hash), not owned by any one Phase 3
 * file. `makeMaterial`/`colorFromHex`/`degreesToRadians` are duplicated
 * locally per the house convention every prior commit has used.
 */

export interface ParksRenderMasters {
  parkLawnMaterial: StandardMaterial | null;
  parkPathTexture: DynamicTexture | null;
  parkPathMaterial: StandardMaterial | null;
  parkPathCrossMaterial: StandardMaterial | null;
  parkCourtMaterial: StandardMaterial | null;
  parkBedMaterial: StandardMaterial | null;
  parkWallMaterial: StandardMaterial | null;
}

export function createParksRenderMasters(): ParksRenderMasters {
  return {
    parkLawnMaterial: null,
    parkPathTexture: null,
    parkPathMaterial: null,
    parkPathCrossMaterial: null,
    parkCourtMaterial: null,
    parkBedMaterial: null,
    parkWallMaterial: null,
  };
}

export interface ParksRenderCtx {
  readonly scene: Scene;
  readonly masters: ParksRenderMasters;
  readonly lowSpec: boolean;
  readonly registerMirrorSurface: (mesh: AbstractMesh | undefined | null) => void;
  readonly applyGrassDetailMap: (material: StandardMaterial, mapId: string) => void;
  readonly applyWorldPlanarGrassUVs: (
    mesh: Mesh,
    offsetX?: number,
    offsetZ?: number,
  ) => void;
  readonly registerStaticCell: (
    mesh: AbstractMesh,
    x: number,
    z: number,
    castsShadow: boolean,
  ) => void;
  readonly registerShadowCaster: (mesh: AbstractMesh, x: number, z: number) => void;
  readonly createRoadSurfaceMesh: (
    name: string,
    centerline: readonly GameCanvasPoint[],
    widthM: number,
    material: StandardMaterial,
    smoothClosed?: boolean,
    surfaceY?: number,
  ) => Mesh | undefined;
}

/**
 * The one grass material every park lawn shares.
 *
 * Built lazily because the two paved cities need it and never build the
 * ground-plane grass: NYC and Cairo set `paved`, so their base ground is
 * concrete and their parks were the only green in the city — painted, until
 * now, as a flat untextured `diffuseColor`.
 *
 * Deliberately **one material for every park on a map**, so a city's parks
 * are one surface rather than eleven near-identical ones. That retires
 * `ProceduralLandmark.color` as the thing that colours a park lawn (it still
 * colours every other landmark kind); per-park character is meant to come
 * from what stands on the grass, not from the shade of the grass.
 */
export function getParkLawnMaterial(
  ctx: ParksRenderCtx,
  palette: MapVisualPalette,
  mapId: string,
): StandardMaterial {
  if (ctx.masters.parkLawnMaterial) return ctx.masters.parkLawnMaterial;
  const material = makeMaterial(ctx.scene, "park-lawn", Color3.White());
  material.diffuseTexture = createGrassTexture(
    ctx.scene,
    "park-lawn-texture",
    palette,
    hashStringToSeed(`${mapId}-park-lawn`),
    !ctx.lowSpec,
  );
  ctx.applyGrassDetailMap(material, mapId);
  ctx.masters.parkLawnMaterial = material;
  return material;
}

/**
 * A park's ground. Flat, because the simulation has no terrain — displacing
 * it would float or sink the car, which is pinned to y = 0.
 *
 * This replaces a `createBox` whose default face UVs stretched a single tile
 * across the whole footprint; on Central Park that was one texture over
 * 200x2900 m, which is why giving the old box a texture would have changed
 * nothing visible. `CreateGround` plus world-planar UVs tiles it properly and
 * continues the surrounding ground's grass across the boundary.
 */
export function buildParkLawn(
  ctx: ParksRenderCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  palette: MapVisualPalette,
  mapId: string,
): Mesh {
  const lawn = MeshBuilder.CreateGround(
    landmark.id,
    {
      width: landmark.size.x,
      height: landmark.size.z,
      // ~25 m cells. One quad would do for a flat plane today, but the sun's
      // shadow map and any later per-vertex tinting both need vertices to
      // land on, and a grid this coarse costs nothing (Central Park: ~1k).
      subdivisionsX: Math.max(1, Math.round(landmark.size.x / 25)),
      subdivisionsY: Math.max(1, Math.round(landmark.size.z / 25)),
    },
    ctx.scene,
  );
  lawn.position.set(landmark.center.x, PARK_LAWN_Y, landmark.center.z);
  if (landmark.headingDeg !== undefined) {
    lawn.rotation.y = degreesToRadians(landmark.headingDeg);
  }
  // `CreateGround` emits local positions, so the park's own centre has to be
  // folded in or every park restarts the tile at its own corner and shows a
  // seam against the ground plane.
  ctx.applyWorldPlanarGrassUVs(lawn, landmark.center.x, landmark.center.z);
  setMeshMaterial(lawn, getParkLawnMaterial(ctx, palette, mapId), true);
  lawn.freezeWorldMatrix();
  // Too large for any spatial cull to reject — Central Park is 2.9 km long,
  // which is the case `registerMirrorSurface` exists for.
  ctx.registerMirrorSurface(lawn);
  return lawn;
}

/**
 * A flat ground polygon at `y`, ear-clipped, with world-planar UVs — the
 * shared builder behind Tahrir's clipped lawn and its forecourt esplanade.
 * The outline is already in world space, so the UVs come straight off the
 * positions with no centre shift — the counterpart of the offset
 * `applyWorldPlanarGrassUVs` needs for `CreateGround`.
 */
export function buildFlatPolygonMesh(
  ctx: ParksRenderCtx,
  id: string,
  polygon: readonly GameCanvasPoint[],
  y: number,
  material: StandardMaterial,
): Mesh | undefined {
  if (polygon.length < 3) return undefined;
  const positions = polygon.flatMap((point) => [point.x, y, point.z]);
  const indices = earClipPolygonIndices(polygon);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = buildPlanarUVs(positions, 1 / GRASS_TILE_M);
  const mesh = new Mesh(id, ctx.scene);
  data.applyToMesh(mesh);
  setMeshMaterial(mesh, material, true);
  mesh.freezeWorldMatrix();
  ctx.registerMirrorSurface(mesh);
  return mesh;
}

/**
 * A park lawn with an arbitrary outline, for the one park a road is
 * authored straight through (`cairoTahrirLawnPolygon` explains the cut).
 * Same material and world-anchored grass tile as `buildParkLawn`.
 */
export function buildParkLawnPolygon(
  ctx: ParksRenderCtx,
  id: string,
  polygon: readonly GameCanvasPoint[],
  palette: MapVisualPalette,
  mapId: string,
): Mesh | undefined {
  return buildFlatPolygonMesh(
    ctx,
    id,
    polygon,
    PARK_LAWN_Y,
    getParkLawnMaterial(ctx, palette, mapId),
  );
}

/** The gravel tile shared by walk, crossing and court materials. */
function ensureParkPathTexture(
  ctx: ParksRenderCtx,
  palette: MapVisualPalette,
  mapId: string,
): DynamicTexture {
  if (!ctx.masters.parkPathTexture) {
    ctx.masters.parkPathTexture = createAsphaltTexture(
      ctx.scene,
      "park-path-texture",
      // Pale gravel, not tarmac: a park walk is a hoggin or stone-dust
      // path everywhere this game is set.
      mixHexColors(palette.dirtShoulder, "#e8e2d2", 0.55),
      hashStringToSeed(`${mapId}-park-path`),
    );
  }
  return ctx.masters.parkPathTexture;
}

/**
 * A park's footpaths, as thin road strips.
 *
 * They sit at `PARK_PATH_Y`, which is only 11 mm above the lawn — the whole
 * park band is squeezed between the lawn at 0.02 and the shoulder junction
 * fill at 0.0435, because parks are drawn *under* the roads on purpose. At
 * Central Park's length that gap is finer than the depth buffer resolves out
 * near the far plane, so the path material also carries a negative
 * `zOffsetUnits`: polygon offset scales with the local depth quantum, which
 * nudging the vertices up by another millimetre does not.
 */
export function buildParkFeatures(
  ctx: ParksRenderCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  mapPack: GameCanvasMapPack,
  palette: MapVisualPalette,
  mapId: string,
): void {
  const layout = parkLayoutForLandmark(mapPack, landmark);

  if (layout.paths.length) {
    if (!ctx.masters.parkPathMaterial || !ctx.masters.parkPathCrossMaterial) {
      const texture = ensureParkPathTexture(ctx, palette, mapId);
      const material = makeMaterial(ctx.scene, "park-path", Color3.White());
      material.diffuseTexture = texture;
      material.zOffsetUnits = PARK_PATH_Z_OFFSET_UNITS;
      ctx.masters.parkPathMaterial = material;
      // Two walks of one park may cross at the same y; the deeper tier
      // decides the winner where height cannot.
      const crossing = makeMaterial(
        ctx.scene,
        "park-path-crossing",
        Color3.White(),
      );
      crossing.diffuseTexture = texture;
      crossing.zOffsetUnits = PARK_PATH_CROSS_Z_OFFSET_UNITS;
      ctx.masters.parkPathCrossMaterial = crossing;
    }
    for (const path of layout.paths) {
      const mesh = ctx.createRoadSurfaceMesh(
        `${landmark.id}-path-${path.id}`,
        path.points,
        path.widthM,
        path.id.startsWith("cross")
          ? ctx.masters.parkPathCrossMaterial
          : ctx.masters.parkPathMaterial,
        false,
        PARK_PATH_Y,
      );
      if (!mesh) continue;
      mesh.isPickable = false;
      ctx.registerStaticCell(mesh, landmark.center.x, landmark.center.z, false);
    }
  }

  buildParkBespokeFeatures(
    ctx,
    landmark,
    layout.features,
    palette,
    mapId,
    mapPack.geometry.roadSurfaces ?? [],
  );

  // The wall. A static-obstacle hit is a scored collision with damage, so it
  // has to be plainly visible — a low kerb you cannot see would read as an
  // invisible wall, which is exactly the complaint this is meant to avoid.
  if (!layout.wall.length) return;
  if (!ctx.masters.parkWallMaterial) {
    ctx.masters.parkWallMaterial = makeMaterial(
      ctx.scene,
      "park-wall",
      colorFromHex(
        mixHexColors(palette.pavement ?? palette.dirtShoulder, "#e6ded0", 0.4),
        new Color3(0.62, 0.6, 0.55),
      ),
    );
  }
  for (const run of layout.wall) {
    const wall = createBox(
      ctx.scene,
      run.id,
      {
        width: run.halfU * 2,
        height: PARK_WALL_HEIGHT_M,
        depth: run.halfV * 2,
      },
      new Vector3(run.x, PARK_WALL_HEIGHT_M / 2, run.z),
      ctx.masters.parkWallMaterial,
    );
    wall.rotation.y = boxLengthYaw(run.ux, run.uz);
    wall.isPickable = false;
    ctx.registerShadowCaster(wall, run.x, run.z);
  }
}

/**
 * The pieces a named park needs that no scatter would produce.
 *
 * Built procedurally rather than imported: the kit has no torii, and no CC0
 * Japanese stone lantern exists that I could find — the only matches are
 * CC-BY, which would put an attribution string in the catalogue for two
 * models. A lantern is a stack of boxes; this is the cheaper answer.
 */
function buildParkBespokeFeatures(
  ctx: ParksRenderCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  features: readonly ParkFeature[],
  palette: MapVisualPalette,
  mapId: string,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): void {
  if (!features.length) return;
  const scene = ctx.scene;
  const material = (suffix: string, color: Color3) =>
    makeMaterial(scene, `park-${suffix}`, color);
  const stone = material("stone", new Color3(0.66, 0.63, 0.57));
  // Vermilion, which is what a torii is and the one strong colour a temple
  // garden carries.
  const vermilion = material("torii", new Color3(0.72, 0.24, 0.16));
  // The warm paving Tahrir's plaza and the ministries esplanade set.
  const plaza = material("plaza", new Color3(0.63, 0.57, 0.47));

  for (const feature of features) {
    switch (feature.kind) {
      case "court": {
        // A ground patch on the bed rung, 5.5 mm UNDER the walks: a path
        // may cross a court, and the walk must win — sharing the paths'
        // rung was a coplanar fight the depth buffer resolved as shimmer.
        const patch = MeshBuilder.CreateGround(
          feature.id,
          { width: feature.sizeX, height: feature.sizeZ },
          scene,
        );
        patch.position.set(feature.x, PARK_BED_Y, feature.z);
        ctx.applyWorldPlanarGrassUVs(patch, feature.x, feature.z);
        if (!ctx.masters.parkCourtMaterial) {
          const court = makeMaterial(scene, "park-court", Color3.White());
          court.diffuseTexture = ensureParkPathTexture(ctx, palette, mapId);
          court.zOffsetUnits = PARK_BED_Z_OFFSET_UNITS;
          ctx.masters.parkCourtMaterial = court;
        }
        setMeshMaterial(patch, ctx.masters.parkCourtMaterial, true);
        patch.isPickable = false;
        ctx.registerStaticCell(patch, feature.x, feature.z, false);
        break;
      }
      case "parterre": {
        // Same bed rung as a court, but a polygon: a parterre's authored
        // rect deliberately runs under the walks, the plaza disc and any
        // crossing road — everything above paints over it, so every
        // visible bed edge lands flush on a walk edge, the disc rim, or a
        // pavement band. The clip cuts the rect back to the park side of
        // a crossing road's centreline, exactly like the lawn: a
        // rectangle cannot hug a diagonal street.
        if (!ctx.masters.parkBedMaterial) {
          // Planted colour, not lawn: a parterre reads as groundcover
          // with flower heads, sharing only the palette.
          const bedMaterial = makeMaterial(scene, "park-bed", Color3.White());
          bedMaterial.diffuseTexture = createFlowerbedTexture(
            scene,
            "park-bed-texture",
            palette,
            hashStringToSeed(`${mapId}-park-bed`),
          );
          bedMaterial.zOffsetUnits = PARK_BED_Z_OFFSET_UNITS;
          ctx.masters.parkBedMaterial = bedMaterial;
        }
        const bed = buildFlatPolygonMesh(
          ctx,
          feature.id,
          clipRectToRoadSide(
            feature.x - feature.sizeX / 2,
            feature.x + feature.sizeX / 2,
            feature.z - feature.sizeZ / 2,
            feature.z + feature.sizeZ / 2,
            landmark.center,
            roadSurfaces,
          ),
          PARK_BED_Y,
          ctx.masters.parkBedMaterial,
        );
        if (bed) {
          bed.isPickable = false;
          ctx.registerStaticCell(bed, feature.x, feature.z, false);
        }
        break;
      }
      case "plaza": {
        // The paved disc a formal garden's walk arms terminate at —
        // Tahrir's disc idiom: top face exactly at PARK_PATH_Y, ground
        // tier, so each arm's half-metre lap draws over its rim.
        const disc = createCylinder(
          scene,
          feature.id,
          {
            height: 0.022,
            diameter: feature.sizeX,
            tessellation: 32,
          },
          new Vector3(feature.x, PARK_PATH_Y - 0.011, feature.z),
          plaza,
        );
        disc.isPickable = false;
        ctx.registerStaticCell(disc, feature.x, feature.z, false);
        break;
      }
      case "torii": {
        const half = feature.sizeX / 2;
        const height = feature.sizeX * 0.95;
        for (const side of [-1, 1]) {
          const column = createCylinder(
            scene,
            `${feature.id}-column-${side > 0 ? "r" : "l"}`,
            { height, diameterTop: 0.34, diameterBottom: 0.44, tessellation: 8 },
            new Vector3(
              feature.x + Math.cos(feature.rotationY) * half * side,
              height / 2,
              feature.z - Math.sin(feature.rotationY) * half * side,
            ),
            vermilion,
          );
          column.isPickable = false;
          ctx.registerShadowCaster(column, feature.x, feature.z);
        }
        for (const [index, lift] of [height, height * 0.83].entries()) {
          const beam = createBox(
            scene,
            `${feature.id}-beam-${index}`,
            {
              width: feature.sizeX * (index === 0 ? 1.28 : 1.06),
              height: index === 0 ? 0.36 : 0.24,
              depth: 0.34,
            },
            new Vector3(feature.x, lift, feature.z),
            vermilion,
          );
          beam.rotation.y = feature.rotationY;
          beam.isPickable = false;
          ctx.registerShadowCaster(beam, feature.x, feature.z);
        }
        break;
      }
      case "lantern": {
        const parts: readonly [number, number, number][] = [
          [0.44, 0.34, 0.17],
          [0.3, 0.5, 0.55],
          [0.62, 0.42, 0.98],
          [0.44, 0.16, 1.25],
        ];
        for (const [index, [width, tall, lift]] of parts.entries()) {
          const block = createBox(
            scene,
            `${feature.id}-${index}`,
            { width, height: tall, depth: width },
            new Vector3(feature.x, lift, feature.z),
            stone,
          );
          block.isPickable = false;
          ctx.registerShadowCaster(block, feature.x, feature.z);
        }
        break;
      }
      case "plinth": {
        const base = createBox(
          scene,
          `${feature.id}-base`,
          { width: feature.sizeX, height: 1.1, depth: feature.sizeZ },
          new Vector3(feature.x, 0.55, feature.z),
          stone,
        );
        base.isPickable = false;
        ctx.registerShadowCaster(base, feature.x, feature.z);
        const shaft = createBox(
          scene,
          `${feature.id}-shaft`,
          {
            width: feature.sizeX * 0.5,
            height: 3.2,
            depth: feature.sizeZ * 0.5,
          },
          new Vector3(feature.x, 2.7, feature.z),
          stone,
        );
        shaft.isPickable = false;
        ctx.registerShadowCaster(shaft, feature.x, feature.z);
        break;
      }
    }
  }
}
