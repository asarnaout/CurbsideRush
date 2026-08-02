import {
  type AbstractMesh,
  Color3,
  FresnelParameters,
  Mesh,
  type Scene,
  StandardMaterial,
  type Texture,
  TransformNode,
  VertexData,
} from "@babylonjs/core";
import { setMeshMaterial } from "./meshPrimitives";
import { createRiverRippleTexture, createRiverSurfaceTexture } from "./proceduralTextures";
import {
  buildWaterPolygonGeometry,
  cairoWaterBoatObstacles,
  generateWaterBoatPlacements,
  WATER_BOAT_DRAUGHT_M,
  WATER_BOAT_LENGTHS_M,
  WATER_BOAT_MODEL_URLS,
  WATER_UV_PER_M,
  waterBoatPoseAt,
  type WaterBoatPlacement,
} from "../geometry/waterGeometry";
import type { GameCanvasMapPack } from "../sessionContract";
import {
  buildRiverWaveField,
  hashStringToSeed,
  mixHexColors,
  resolveMapVisualKey,
  type MapVisualPalette,
} from "../visuals";

/**
 * The Nile/river water bodies: their meshes and drifting surface/ripple
 * textures (built once, per map), and the Cairo river-craft boats (queued at
 * build time, instantiated once their glbs preload, animated every visual
 * frame). De-methodized into a collaborator class (Phase 3.6) rather than
 * free functions — the plan's other sanctioned shape, matching the existing
 * `CrowdRenderer`/`DriveAudio` precedent — because build state (the drifting
 * textures, the pending/animated boat lists, the boat-master cache) has to
 * persist between the one-shot `build()` call, the later `instantiatePendingBoats()`
 * once preload finishes, and the every-frame `update()`. `BabylonGameSession`
 * holds one as `private waterLayer: WaterLayer | null`, exactly like its
 * `crowdRenderer` field.
 *
 * `registerMirrorSurface` and `getBuildingMaster` are the only two
 * session-wide shared behaviours this class touches, and both are threaded
 * as plain callback parameters on the one method that needs each — not
 * constructor params — matching `CrowdRenderer.build`'s own style of taking
 * per-call data rather than binding session `this` into long-lived state.
 * `makeMaterial`/`colorFromHex` are duplicated locally per house convention.
 * The eleven `RIVER_*` tuning constants move here unchanged — Phase 2 commit
 * 2.8 deliberately left them behind in `GameCanvas.tsx` for exactly this
 * commit, since neither river texture factory reads them directly.
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

function colorFromHex(value: string, fallback: Color3): Color3 {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return new Color3(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

/**
 * Metres of river under one repeat of each tile. The surface tile carries the
 * current banding and the ripple tile the chop, so they are deliberately an
 * awkward ratio apart — matched tiles beat against each other into a visible
 * grid the moment both start scrolling.
 */
const RIVER_SURFACE_TILE_M = 31;
const RIVER_RIPPLE_TILE_M = 12;
/**
 * How fast each tile drifts downstream, m/s. Far under the Nile's real ~1 m/s:
 * the tile slides as a whole rather than deforming, and anything near walking
 * pace reads as a conveyor belt of water instead of a current.
 */
const RIVER_SURFACE_DRIFT_MPS = 0.22;
const RIVER_RIPPLE_DRIFT_MPS = 0.4;
/**
 * The ripple tile also creeps sideways. Two tiles drifting on exactly parallel
 * lines stay in lockstep forever, and the eye picks that out as a single
 * sliding sheet; a slow shear is what makes the surface look alive.
 */
const RIVER_RIPPLE_SHEAR_MPS = 0.06;
/**
 * How much of the authored water colour the tile is actually painted in.
 *
 * Well under 1, and that is the whole trick to water that reads as a river
 * instead of as a swimming pool: a sunlit horizontal plane here collects about
 * 1.5× light before the grazing sheen is added on top, so a tile painted at
 * face value comes back a good half-stop brighter than the sky it sits under.
 * Real water is dark stuff whose brightness is nearly all borrowed.
 *
 * Split day/night for the same reason `makeInteriorMaterial` is: the two
 * lighting rigs sit the better part of a stop apart (sun 1.3 against 0.6), and
 * one gain either bleaches the Nile or sinks Central Park's lake.
 */
const RIVER_TILE_GAIN_DAY = 0.52;
const RIVER_TILE_GAIN_NIGHT = 0.85;
/** Trough tone, as a fraction of the tile's base. */
const RIVER_TROUGH_GAIN = 0.62;
/** Crest tone: the base carried this far toward a dimmed sky. */
const RIVER_CREST_SKY_MIX = 0.44;
/**
 * How far the bank's own darkening reaches into the water, and what it
 * multiplies the tile by where it meets the stone.
 *
 * Deliberately *not* the pale silt fringe a beach would get. Both cities' banks
 * are walled — a corniche parapet, a park lake's kerb — and water that deep
 * against a vertical face reads darker and a shade greener there, from the
 * wall's shadow and its reflection. A bright foam line on a wall looks like
 * surf on masonry.
 */
const RIVER_SHORE_BAND_M = 5.5;
const RIVER_SHORE_TINT = { r: 0.62, g: 0.73, b: 0.68 };

export class WaterLayer {
  private readonly scene: Scene;
  /** Visual-only Nile craft. Kept outside every simulation/spatial index. */
  private readonly animatedWaterBoats: Array<{
    readonly root: TransformNode;
    readonly placement: WaterBoatPlacement;
  }> = [];
  /**
   * River tiles that creep downstream, in texture repeats per second. The whole
   * of the current is in here — the surface mesh never deforms — so a body with
   * no entry is a pond, not a river.
   */
  private readonly driftingWaterTextures: Array<{
    readonly texture: Texture;
    readonly uPerSecond: number;
    readonly vPerSecond: number;
  }> = [];
  /** River craft to instantiate once the boat glbs preload. */
  private readonly pendingWaterBoats: { bodyId: string; placement: WaterBoatPlacement }[] = [];
  private readonly waterBoatMasters = new Map<
    number,
    { mesh: Mesh; scale: number; yOffset: number; yawOffset: number } | null
  >();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Builds the authored Nile channels and computes the deterministic river
   * craft placements. Water is scenery, not simulation state: boats are keyed
   * from map/body ids and never touch the traffic PRNG. The craft themselves
   * are glb instances (cairo-felucca / cairo-skiff), so like the vendor carts
   * they are deferred to buildInstancedBuildings once the models preload.
   *
   * A body authors one colour, which the minimap draws flat and this derives a
   * whole surface from — trough, crest and sheen. Three colours per channel in
   * `content.ts` would only let a map author disagree with its own minimap.
   */
  build(
    mapPack: GameCanvasMapPack,
    mapId: string,
    options: {
      readonly palette: MapVisualPalette;
      readonly lowSpec: boolean;
      readonly registerMirrorSurface: (mesh: AbstractMesh | undefined | null) => void;
    },
  ): void {
    const bodies = mapPack.geometry.waterBodies ?? [];
    if (!bodies.length) return;
    const scene = this.scene;
    const palette = options.palette;
    // What the surface hands back at a graze: the zenith pulled most of the way
    // to the horizon haze, which is the band of sky a driver's-eye view of a
    // river actually reflects.
    const skyTone = colorFromHex(
      mixHexColors(palette.skyTop, palette.skyHorizon, 0.45),
      new Color3(0.57, 0.71, 0.76),
    );
    const tileGain = palette.night
      ? RIVER_TILE_GAIN_NIGHT
      : RIVER_TILE_GAIN_DAY;

    for (const body of bodies) {
      const geometry = buildWaterPolygonGeometry(
        body.polygon,
        undefined,
        RIVER_SHORE_BAND_M,
      );
      if (!geometry.positions.length || !geometry.indices.length) continue;
      const waterColor = colorFromHex(
        body.color,
        new Color3(0.13, 0.43, 0.55),
      );
      const seed = hashStringToSeed(`${mapId}-${body.id}-river`);
      // `flowHeadingDeg` is what separates a river from a pond, and everything
      // below forks on it: still water gets no dominant streak axis, nothing
      // drifting and no chop — Central Park's lake must not run south, and a
      // normal map that never moves is the static grain the grass tile warns
      // about rather than a surface.
      const flowHeadingRad =
        body.flowHeadingDeg === undefined
          ? undefined
          : (body.flowHeadingDeg * Math.PI) / 180;
      const baseTone = waterColor.scale(tileGain);
      // The tile carries the colour, so the material's own diffuse is white.
      const material = makeMaterial(scene, `water-${body.id}`, Color3.White());
      const surface = createRiverSurfaceTexture(
        scene,
        `water-${body.id}-surface`,
        buildRiverWaveField({
          seed,
          flowHeadingRad: flowHeadingRad ?? 0,
          count: 14,
          minCycles: 1,
          maxCycles: 5,
          // Fanned to a full half-turn either side, which is isotropic: with
          // no current there is nothing for the ripples to line up along.
          spreadRad: flowHeadingRad === undefined ? Math.PI / 2 : 0.5,
          crossFraction: flowHeadingRad === undefined ? 0.5 : 0.25,
        }),
        {
          deep: baseTone.scale(RIVER_TROUGH_GAIN),
          base: baseTone,
          crest: Color3.Lerp(
            baseTone,
            skyTone.scale(tileGain),
            RIVER_CREST_SKY_MIX,
          ),
        },
        options.lowSpec ? 256 : 512,
      );
      surface.uScale = 1 / (WATER_UV_PER_M * RIVER_SURFACE_TILE_M);
      surface.vScale = surface.uScale;
      // A river is seen almost entirely edge-on, which is the case trilinear
      // filtering handles worst: without this the surface picks a mip for its
      // *short* axis and a hundred metres of water shimmers.
      surface.anisotropicFilteringLevel = 8;
      material.diffuseTexture = surface;
      if (flowHeadingRad !== undefined) {
        const flowX = Math.sin(flowHeadingRad);
        const flowZ = Math.cos(flowHeadingRad);
        this.driftingWaterTextures.push({
          texture: surface,
          uPerSecond: (-flowX * RIVER_SURFACE_DRIFT_MPS) / RIVER_SURFACE_TILE_M,
          vPerSecond: (-flowZ * RIVER_SURFACE_DRIFT_MPS) / RIVER_SURFACE_TILE_M,
        });
        // Fill cost, on a surface that can own most of the screen from the
        // corniche: weak devices get the banding and the glint but no
        // per-pixel chop. The drift stays, so the river still reads as moving.
        if (!options.lowSpec) {
          const ripples = createRiverRippleTexture(
            scene,
            `water-${body.id}-ripples`,
            buildRiverWaveField({
              seed: seed ^ 0x5eed,
              flowHeadingRad,
              count: 16,
              minCycles: 3,
              maxCycles: 13,
              spreadRad: 0.7,
              crossFraction: 0.4,
            }),
            256,
            0.02,
          );
          ripples.uScale = 1 / (WATER_UV_PER_M * RIVER_RIPPLE_TILE_M);
          ripples.vScale = ripples.uScale;
          ripples.anisotropicFilteringLevel = 8;
          material.bumpTexture = ripples;
          this.driftingWaterTextures.push({
            texture: ripples,
            uPerSecond:
              -(
                flowX * RIVER_RIPPLE_DRIFT_MPS -
                flowZ * RIVER_RIPPLE_SHEAR_MPS
              ) / RIVER_RIPPLE_TILE_M,
            vPerSecond:
              -(
                flowZ * RIVER_RIPPLE_DRIFT_MPS +
                flowX * RIVER_RIPPLE_SHEAR_MPS
              ) / RIVER_RIPPLE_TILE_M,
          });
        }
      }
      // Emissive as illumination, or the standard shader folds it in *before*
      // the diffuse texture multiply — where the sheen can only brighten the
      // water within its own hue instead of lifting it toward the sky's.
      material.useEmissiveAsIllumination = true;
      material.emissiveColor = Color3.Lerp(waterColor, skyTone, 0.78).scale(
        0.16,
      );
      // Water is dark stuff that happens to be a mirror: nearly all of what
      // you see off a river at distance is sky, and almost none of it is when
      // you look straight down. `leftColor` is the grazing end, `rightColor`
      // the facing one — the shader's fresnel term runs 1 at face-on.
      material.emissiveFresnelParameters = new FresnelParameters({
        bias: 0.05,
        power: 1.6,
        leftColor: Color3.White(),
        rightColor: new Color3(0.2, 0.2, 0.2),
      });
      // A broad, weak highlight rather than a tight bright one. The sun on a
      // rippled plane is a field of sub-pixel glints, and any highlight sharp
      // enough to land inside one texel aliases into crawling sequins the
      // moment either the tile or the camera moves.
      material.specularColor = new Color3(0.42, 0.47, 0.48);
      material.specularPower = 60;
      material.backFaceCulling = false;
      const mesh = new Mesh(`water-${body.id}`, scene);
      const normals: number[] = [];
      VertexData.ComputeNormals(
        [...geometry.positions],
        [...geometry.indices],
        normals,
      );
      const data = new VertexData();
      data.positions = [...geometry.positions];
      data.indices = [...geometry.indices];
      data.normals = normals;
      data.uvs = [...geometry.uvs];
      // The shore band, as a per-vertex multiplier on the tile. Vertex colour
      // rather than a second mesh: the standard shader folds it straight into
      // the diffuse sample, so it costs no draw call, no transparency sort and
      // no second surface to z-fight with the water 25 mm below it.
      if (geometry.shoreFactors.length) {
        data.colors = geometry.shoreFactors.flatMap((factor) => [
          1 + (RIVER_SHORE_TINT.r - 1) * factor,
          1 + (RIVER_SHORE_TINT.g - 1) * factor,
          1 + (RIVER_SHORE_TINT.b - 1) * factor,
          1,
        ]);
      }
      data.applyToMesh(mesh);
      setMeshMaterial(mesh, material, true);
      mesh.freezeWorldMatrix();
      options.registerMirrorSurface(mesh);
      // Flowing water is deliberately *not* frozen, unlike every other static
      // material here. A frozen StandardMaterial stops re-uploading its
      // uniform buffer, and the texture matrix lives in that buffer — so
      // `uOffset` would be read once and the river would set solid. Two
      // unfrozen materials is a cost worth paying; there is no cheaper way to
      // move a texture. Still water has nothing to update, so it freezes.
      if (flowHeadingRad === undefined) material.freeze();

      // Boats are Cairo's. `generateWaterBoatPlacements` is not map-gated and
      // always wants at least one craft (`max(1, ...)`), and the only two
      // models are `cairo-felucca` and `cairo-skiff` — so any water body added
      // to another city, such as a lake in Central Park, would quietly get an
      // Egyptian felucca sailing round it.
      if (resolveMapVisualKey(mapId) === "cairo") {
        const obstacles = cairoWaterBoatObstacles(mapPack.geometry, body);
        for (const placement of generateWaterBoatPlacements(
          mapId,
          body,
          obstacles,
        )) {
          this.pendingWaterBoats.push({ bodyId: body.id, placement });
        }
      }
    }
  }

  private getWaterBoatMaster(
    variant: number,
    getBuildingMaster: (url: string) => Mesh | null,
  ): { mesh: Mesh; scale: number; yOffset: number; yawOffset: number } | null {
    const cached = this.waterBoatMasters.get(variant);
    if (cached !== undefined) return cached;
    const url = WATER_BOAT_MODEL_URLS[variant % WATER_BOAT_MODEL_URLS.length];
    const mesh = getBuildingMaster(url);
    let built:
      | { mesh: Mesh; scale: number; yOffset: number; yawOffset: number }
      | null = null;
    if (mesh) {
      const bounds = mesh.getBoundingInfo().boundingBox;
      const extentX = bounds.maximum.x - bounds.minimum.x;
      const extentZ = bounds.maximum.z - bounds.minimum.z;
      const scale =
        WATER_BOAT_LENGTHS_M[variant % WATER_BOAT_LENGTHS_M.length] /
        Math.max(extentX, extentZ);
      built = {
        mesh,
        scale,
        yOffset: -bounds.minimum.y * scale - WATER_BOAT_DRAUGHT_M,
        yawOffset: extentX > extentZ ? Math.PI / 2 : 0,
      };
    }
    this.waterBoatMasters.set(variant, built);
    return built;
  }

  // River craft: merged-master instances of the CC0 boats, one cheap scene
  // mesh per boat, parented under a root the wave animation moves. Scale and
  // waterline seat are measured from the merged bounds, so the felucca's
  // masthead lands exactly at its pinned air draft.
  instantiatePendingBoats(getBuildingMaster: (url: string) => Mesh | null): void {
    let boatIndex = 0;
    for (const pending of this.pendingWaterBoats) {
      const master = this.getWaterBoatMaster(pending.placement.variant, getBuildingMaster);
      if (!master) continue;
      const root = new TransformNode(
        `${pending.bodyId}-boat-${boatIndex}`,
        this.scene,
      );
      boatIndex += 1;
      const pose = waterBoatPoseAt(pending.placement, 0);
      root.position.set(pose.x, pose.y, pose.z);
      root.rotation.set(0, pose.heading, pose.roll);
      const inst = master.mesh.createInstance(`${root.name}-hull`);
      inst.parent = root;
      inst.position.set(0, master.yOffset, 0);
      inst.rotation.y = master.yawOffset;
      inst.scaling.setAll(master.scale);
      inst.isPickable = false;
      this.animatedWaterBoats.push({ root, placement: pending.placement });
    }
    this.pendingWaterBoats.length = 0;
  }

  update(visualTimeSeconds: number): void {
    for (const boat of this.animatedWaterBoats) {
      const pose = waterBoatPoseAt(boat.placement, visualTimeSeconds);
      boat.root.position.set(pose.x, pose.y, pose.z);
      boat.root.rotation.set(0, pose.heading, pose.roll);
    }
    for (const drift of this.driftingWaterTextures) {
      // Wrapped every repeat. The offsets are otherwise unbounded, and a drive
      // long enough to run one into float noise would stutter the current.
      drift.texture.uOffset = (drift.uPerSecond * visualTimeSeconds) % 1;
      drift.texture.vOffset = (drift.vPerSecond * visualTimeSeconds) % 1;
    }
  }

  dispose(): void {
    this.animatedWaterBoats.length = 0;
    this.driftingWaterTextures.length = 0;
    this.pendingWaterBoats.length = 0;
    this.waterBoatMasters.clear();
  }
}
