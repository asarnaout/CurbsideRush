"use client";

import {
  AbstractMesh,
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  ColorCurves,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FresnelParameters,
  Frustum,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Plane,
  Quaternion,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  UniversalCamera,
  Vector3,
  Vector4,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  FIXED_STEP_SECONDS,
  isPointInPolygon,
  SimulationCore,
  type NpcVehicleVariant,
  type SimulationCoreConfig,
  type SimulationInput,
  type SimulationRuleEvent,
  type SimulationScoreSnapshot,
  type SimulationSnapshot,
} from "./simulation";
import {
  buildSimulationCoreConfig,
  resolveAmbientVehicleCount,
  resolveSimulationLaneAnchor,
  resolveVenuePlacement,
  type StaticObstacle,
  type StaticObstacleTag,
} from "./simulationAdapter";
import {
  BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M,
  bridgePortalRailSpans,
} from "./bridgePortalGeometry";
import {
  DEFAULT_SERVICE_SETBACK_M,
  FUEL_PUMP_REACH_M,
  gasStationCanopyWorld,
  gasStationPumpPositions,
  gasStationsOf,
  distanceToRepairBay,
  repairShopBayPosition,
  repairShopsOf,
  resolveServicePointLot,
  type ServicePointKind,
} from "./servicePoints";
import { PROP_MODEL_FOOTPRINTS_M } from "./propFootprints";
import {
  REPAIR_BAY_REACH_M,
  REPAIR_SHOP_LOT_HALF_M,
  REPAIR_SHOP_PARTS,
  type RepairShopSurface,
} from "./repairShopLayout";
import { DRIVE_LAYER } from "./driveLayers";
import { INPUT_GUIDANCE, type InputFamily } from "./inputGuidance";
import {
  MIRROR_RADIUS_M,
  mirrorCandidatesAreStale,
  mirrorCells,
} from "./mirrorRenderList";
import {
  COCKPIT_BINNACLE_PROFILE,
  COCKPIT_BINNACLE_WIDTH,
  COCKPIT_CABIN_WIDTH,
  COCKPIT_CLUSTER,
  COCKPIT_CLUSTER_TEXTURE,
  COCKPIT_DASH_PROFILE,
  COCKPIT_DOOR_PROFILE,
  COCKPIT_DOOR_X,
  COCKPIT_GAUGE_CENTRES,
  COCKPIT_GAUGE_RADIUS,
  COCKPIT_PILLAR_PROFILE,
  COCKPIT_PILLAR_THICKNESS,
  COCKPIT_PILLAR_X,
  COCKPIT_ROOF_PROFILE,
  COCKPIT_SCREEN,
  COCKPIT_SPEEDO_MAX_MPS,
  COCKPIT_VENT_PROFILE,
  COCKPIT_VENT_SLOTS,
  COCKPIT_WING_MIRROR,
  WING_MIRROR_SAIL_PROFILE,
  REAR_VIEW_VIEWPORT,
  cameraPanelPlacement,
  cockpitScreenSpan,
  cockpitScreenTiltX,
  resolveCockpitPitch,
  resolveCockpitSteeringGeometry,
  resolveGaugeNeedleAngle,
  resolveSteeringWheelSpin,
  resolveWingMirrorPose,
  wingMirrorHeadRotation,
  wingMirrorIsVisible,
  wingMirrorOutline,
  wingMirrorSide,
} from "./cockpitLayout";
import { TouchDriveControls } from "./TouchDriveControls";
import { releaseTouchSteer } from "./touchSteering";
import {
  POSE_SNAP_STEP_M,
  lerpHeading,
  lerpValue,
  shouldSnapPose,
} from "./renderInterpolation";
import {
  readInputCapabilities,
  type InputCapabilities,
} from "./pointerCapabilities";
import {
  canFullscreen,
  exitFullscreen,
  isFullscreen,
  isStandaloneDisplay,
  onFullscreenChange,
  requestImmersiveLandscape,
} from "./viewportSetup";
import {
  createRenderScalingState,
  desktopHardwareScalingLevel,
  RENDER_SCALING_WARMUP_MS,
  RENDER_SCALING_WINDOW_MS,
  renderScalingLevel,
  stepRenderScaling,
  TOUCH_SCALING_LADDER,
  TOUCH_TARGET_FPS,
  type RenderScalingState,
} from "./renderScaling";
import {
  BIKE_CUTSCENE_BODY,
  buildBikeErrandScript,
  buildBoardScript,
  buildErrandScript,
  buildExitScript,
  buildPulloverScript,
  buildRefuelScript,
  buildRepairScript,
  chooseStagedShot,
  repairCameraPosition,
  buildRoadsideRefuelScript,
  cutsceneBodyProfile,
  DEFAULT_CUTSCENE_BODY,
  lerpCarPose,
  MOTORBIKE_CUTSCENE_BODY,
  projectOntoPolyline,
  scriptFocusPoint,
  settleEase,
  type CutsceneBodyProfile,
  type CutsceneCarPose,
  type CutsceneKind,
  type CutsceneStep,
  type ErrandCargo,
  type StagedBlocker,
  type StagedCover,
  type PulloverPlan,
  type PulloverRoad,
} from "./cutsceneScript";
import { DriveAudio } from "./audio/DriveAudio";
import {
  ENGINE,
  GEAR_TOP_MPS,
  MOTORBIKE_ENGINE_PROFILE,
  targetRpm,
} from "./audio/audioMath";
import {
  authoredSignalAspectAt,
  trafficCameraControlIds,
  type AuthoredSignalAspect,
  type AuthoredSignalStyle,
} from "./trafficSignals";
import {
  buildAsphaltTextureSpec,
  buildGrassDetailSpec,
  buildGrassTextureSpec,
  buildHorizonSilhouetteSpec,
  buildPlanarUVs,
  buildRiverWaveField,
  distanceToPolylineM,
  generateRoadsidePropPlacements,
  hashStringToSeed,
  mixHexColors,
  PAVED_SIDEWALK_WIDTH_M,
  resolveCameraFarPlane,
  resolveEffectiveFogRange,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  sampleRiverWaveField,
  seededUnit,
  skyGradientStops,
  type GrassBlade,
  type MapVisualPalette,
  type PropKindConfig,
  type PropPlacement,
  type RiverWave,
} from "./visuals";
import {
  natureModelsForMap,
  natureSetUrls,
  natureSetsForMap,
} from "./natureCatalog";
import {
  CAIRO_OPERA_TERRACE_NORTH_Z,
  CAIRO_TAHRIR_PLAZA_RADIUS_M,
  parkLayoutForLandmark,
  ROAD_DIVIDED_PARK_IDS,
  type ParkFeature,
  type ParkPlacement,
} from "./parkLayouts";
import {
  createVehicleMesh,
  type VehicleMeshVisual,
} from "./vehicleMeshes";
import {
  assertArabicCanvasFontDebug,
  ensureArabicCanvasFontLoaded,
  inspectArabicCanvasFont,
} from "./arabicFont";
import {
  policeAppearanceForMap,
  policeBeaconLamps,
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  VEHICLE_DIMENSIONS,
  type VehicleAppearance,
  type VehicleModel,
} from "./vehicleVisuals";
import {
  disposeModels,
  instantiateModel,
  instantiateModelInstanced,
  isModelReady,
  modelMaterials,
  PROP_MODEL_REGISTRY,
  preloadModels,
  type PropModelConfig,
  propModelUrls,
  vehicleModelUrls,
} from "./modelLibrary";
import {
  buildingPlacementConfig,
  buildingSetUrls,
  isBuildingSetId,
  NYC_VENDORS,
  nycVendorUrls,
  slotBlockBuildings,
  type BuildingSetId,
  type PlacedBuilding,
  type StreetPropConfig,
} from "./buildingSets";
import {
  orientMergedFacesOutward,
  recentreMergedMasterXZ,
  squareUpMergedMaster,
} from "./buildingWinding";
import {
  pickStorefrontVariant,
  STOREFRONT_MODEL_ID,
  type StorefrontVariant,
} from "./storefronts";
import { assembleStorefrontVariantMaster } from "./storefrontMaster";
import { streetAddressesForMap } from "./streetAddresses";
import { speedingWarrantsCitation } from "./speeding";
import {
  regulatorySignPlacements,
  regulatorySignYawRad,
  speedLimitSignFamily,
  speedLimitSignPlacements,
  speedLimitSignYawRad,
  type RegulatorySignKind,
  type RegulatorySignPlacement,
  type SpeedLimitSignPlacement,
} from "./regulatorySigns";
import {
  buildConnectedNpcPath,
  type NpcPathSegment as NpcPathSegmentData,
} from "./npcPaths";
import {
  splitMarkingAtCrossings,
  type MarkingPoint,
} from "./roadMarkings";

/** Marking styles that run along a road, and so break where one crosses. */
const LANE_PAINT_STYLES = new Set([
  "centre_solid",
  "centre_dashed",
  "lane_solid",
  "lane_dashed",
  "edge_solid",
]);
import {
  buildActorVisual,
  buildCourierVisual,
  buildCyclistVisual,
  buildMotorbikeVisual,
  buildOfficerVisual,
  buildPedestrianVisual,
  characterModelUrls,
  CHARACTER_MODELS,
  type ActorVisual,
  type CharacterColors,
  type CharacterVisual,
} from "./characterMeshes";
import {
  complexionPaletteForMap,
  hairPaletteForMap,
  type CharacterTone,
} from "./characterPalettes";
import { CrowdRenderer } from "./crowdRenderer";
import {
  SMOKE_HEAVY_CONDITION_PCT,
  SMOKE_LIGHT_CONDITION_PCT,
} from "./damage";
import {
  createCrowdSim,
  WALKER_DOWNED_TOTAL_SECONDS,
  WALKER_FALL_SECONDS,
  WALKER_LIE_SECONDS,
  WALKER_RISE_SECONDS,
  walkerDownedPhase,
  type CrowdSim,
  type WalkerDownedPhase,
} from "./crowdWalkers";
import { buildPavementGraph, type PavementGraph } from "./pavementPaths";
import { PED_TURN_PAUSE_S, stepStroll } from "./pedestrianStroll";

export type TrafficSide = "left" | "right";
export type SteeringSide = "left" | "right";
export type CameraMode = "first" | "third";
export type DriveGear = "D" | "R";
export type TurnIndicator = "left" | "right" | "off";
export type SpeedUnit = "mph" | "km/h";

export interface GameHudSnapshot {
  speed: number;
  speedUnit: SpeedUnit;
  gear: DriveGear;
  cameraMode: CameraMode;
  indicator: TurnIndicator;
  score: number;
  objectiveProgress: number;
  instruction: string;
  paused: boolean;
  honking: boolean;
  rearViewVisible: boolean;
  scenarioId: string;
  scenarioTitle: string;
  objective: string;
  checkpoint: string;
  trafficSide: TrafficSide;
  /** Player world position and heading (radians), for the corner minimap. */
  playerX: number;
  playerZ: number;
  heading: number;
  /**
   * Deterministic sim-clock milliseconds since the session started (or last
   * reset). Pauses with the sim, so the career day countdown derives from it
   * rather than wall time.
   */
  simElapsedMs: number;
  /**
   * The limit posted on the road under the car, already rounded and in the same
   * unit as `speed` — so a HUD can put the two side by side without converting
   * anything. Zero only before the first lane projection lands.
   */
  speedLimit: number;
  scenarioClock?: string;
}

export const MIN_HORIZONTAL_FOV = (55 * Math.PI) / 180;
export const MAX_HORIZONTAL_FOV = (100 * Math.PI) / 180;
export const DEFAULT_HORIZONTAL_FOV = (72 * Math.PI) / 180;
export const PLAYER_GUIDANCE_HALF_WIDTH_M = 0.91;
export const GUIDANCE_LATERAL_CLEARANCE_M = 0.3;
export const WORLD_LAYER_MASK = 0x0fffffff;
export const GUIDANCE_LAYER_MASK = 0x10000000;
/**
 * The cabin's own bit, so the rear-view camera never sees it.
 *
 * First person renders the whole scene twice — once full-screen, once into the
 * mirror strip — and the mirror looks backwards from a point behind the
 * dashboard. Every cockpit mesh submitted to that pass is work with no possible
 * effect on a pixel. Same trick the guidance arrows already use to stay out of
 * the mirror.
 */
export const COCKPIT_LAYER_MASK = 0x20000000;
export const PRIMARY_CAMERA_LAYER_MASK =
  WORLD_LAYER_MASK | GUIDANCE_LAYER_MASK | COCKPIT_LAYER_MASK;
/** Mirrors the simulation's standstill threshold, for deciding which pedal is
 * driving and which is braking when the audio reads the controls. */
const STOPPED_AUDIO_SPEED_MPS = 0.2;
const ROAD_SURFACE_Y = 0.07;
// The asphalt junction fill sits a hair ABOVE the carriageway strips so it wins
// the depth test across the whole crossing: it caps the two coplanar road strips
// that would otherwise z-fight where they overlap, and it paves over any dirt
// shoulder that a crossing road's wider strip pushes into the junction throat.
// The dirt-shoulder junction fill stays just below its shoulder strips, forming
// the thin tan apron that rings the paved junction.
const ROAD_JUNCTION_FILL_Y = ROAD_SURFACE_Y + 0.0016;
const ROAD_SHOULDER_Y = 0.045;
const ROAD_SHOULDER_JUNCTION_FILL_Y = ROAD_SHOULDER_Y - 0.0015;
const ROAD_POINT_EPSILON_M = 0.08;
/**
 * Metres of world per repeat of the grass tile. Every grass surface — the base
 * ground and every park lawn — uses this one figure so a park never shows a
 * seam against the ground it sits on.
 *
 * Small enough that individual blades read at walking distance; the visible
 * repeat that follows from that is what `GRASS_DETAIL_TILE_M` exists to break.
 */
const GRASS_TILE_M = 12;
/**
 * The detail map's own repeat. Deliberately not a divisor of `GRASS_TILE_M` —
 * 3.1 against 12 beats at ~37 m rather than reinforcing the base tile's grid,
 * which is the entire point of the second layer.
 */
const GRASS_DETAIL_TILE_M = 3.1;
/**
 * A park lawn's surface. Was the top face of a 0.02-high box, and stays at that
 * height: parks sit deliberately BELOW the shoulder (0.045) and the road (0.07)
 * so an authored road crossing a park keeps visual priority.
 */
export const PARK_LAWN_Y = 0.02;
/**
 * Parterre and court ground patches, on their own rung UNDER the walks: a path
 * may cross a court or graze a bed, and the walk must win. They once shared
 * `PARK_PATH_Y`, which is a coplanar fight the depth buffer cannot settle —
 * the Opera Grounds shipped shimmering because of it.
 */
export const PARK_BED_Y = 0.0255;
/** Park footpaths, in the ~23 mm between the lawn and the shoulder fill. */
export const PARK_PATH_Y = 0.031;
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
 * Yaw that lays a box's LENGTH along a given world direction.
 *
 * A box's length is its `width`, which is local **+X**, and under
 * `rotation.y = θ` this engine lays local +X along world **(cos θ, −sin θ)**
 * — the same convention the torii builder and its adapter collider both
 * encode. Two ways this has gone wrong, both silent:
 *
 * - Using the map's heading convention (`atan2(dx, dz)`, 0 = +z), which is
 *   90° off: Central Park's west wall drew as a 2,897 m east-west ledge
 *   straight through every avenue while its collider — which takes
 *   `ux`/`uz` directly as the OBB axis — stayed correct.
 * - Using `atan2(uz, ux)`, which mirrors the direction in z. That slept for
 *   as long as every wall run was axis-aligned (a box turned −90° is the
 *   box turned +90°) and surfaced the day the Opera Grounds laid the first
 *   road-parallel rail: drawn rotated ~20° off the street it was authored
 *   flush with, collider correct, seeing and hitting disagreeing again.
 */
export function boxLengthYaw(ux: number, uz: number): number {
  return Math.atan2(-uz, ux);
}
/**
 * How close to a path a plant must be to stay an individually instanced,
 * knockable prop. Everything beyond becomes batched scenery, which cannot be
 * knocked down — so this is really "how far off a path a car can plausibly get
 * before the trees stop reacting", and it wants to stay generous.
 */
const PARK_KNOCKABLE_REACH_M = 10;
// Lift every building so no model's base plate lands exactly on the ground
// plane. Base plates face -Y and are back-face culled, so this is depth-buffer
// hygiene, not a visible-flicker fix — the Cairo brick-band flicker was never
// here (see CAIRO_DECAL_Z_OFFSET_UNITS). Above the sidewalk band (0.045),
// small enough to read as flush.
const BUILDING_GROUND_LIFT = 0.08;
/**
 * Clearance between a procedural facade box's base plate and the pavement
 * band: every `createFacadeBox` caller passes height/2, so the plate lands
 * exactly at `BUILDING_GROUND_LIFT`. Keep it positive so the plate is never
 * coplanar with the ground or the pavement. The instanced glbs get the same
 * lift but not the same guarantee — six Cairo models' native bases dip below
 * y=0 (cairo-block-slim and -terrace by 0.076 at placement scale), landing
 * them just above the ground plane instead.
 */
export const BUILDING_BASE_CLEARANCE_M =
  BUILDING_GROUND_LIFT - ROAD_SHOULDER_Y;
/**
 * The Quaternius Cairo street-wall models carry their brick patches, dark base
 * bands and glazing as separate primitives floating 0.6–3.5 mm in front of the
 * wall primitives on the same plane (cairo-residence-quaternius has pairs at
 * exactly 0 mm — its converter's quantization grid collapsed the authored
 * offset). A 24-bit depth buffer stops resolving gaps that small from ~15–35 m
 * away, so the pale wall bleeds through the dark decal and flickers as the
 * camera moves. Pulling just the decal materials toward the camera by two
 * depth quanta (gl.polygonOffset units — negative is toward the camera, and
 * the bias scales with the local depth quantum, unlike a geometry nudge)
 * separates every pair at every distance. Applied per cairo-*.glb container
 * material, so no other city's models are touched.
 */
export const CAIRO_DECAL_Z_OFFSET_UNITS = -2;
export const CAIRO_DECAL_MATERIAL_NAMES: readonly string[] = [
  "Bricks",
  "Dark",
  "DarkBrown",
  "DarkWood",
  "Glass",
];
export const CAIRO_STREET_WALL_URL_RE = /\/cairo-[^/]+\.glb$/;
export function biasCairoDecalMaterials(
  materials: readonly { name: string; zOffsetUnits: number }[],
): number {
  let biased = 0;
  for (const material of materials) {
    if (!CAIRO_DECAL_MATERIAL_NAMES.includes(material.name)) continue;
    material.zOffsetUnits = CAIRO_DECAL_Z_OFFSET_UNITS;
    biased += 1;
  }
  return biased;
}
const MAX_ROAD_MITER_RATIO = 3.25;
// Junctions get a kerb radius: real corners curve so a turning vehicle can hold
// its line, and the pavement wraps that curve. Capped well inside the sidewalk
// band so the rounded asphalt never eats through to the buildings behind it.
const JUNCTION_KERB_MAX_RADIUS_M = 3.5;
const JUNCTION_KERB_ARC_STEPS = 4;
// Below this the corner is a gore, not a street corner, and stays a sharp point.
const JUNCTION_KERB_MIN_WEDGE_RAD = (70 * Math.PI) / 180;

export interface RoadSurfaceStripGeometry {
  /** Two vertices per authored centreline point: positive and negative lateral offsets. */
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly closed: boolean;
}

export interface RoadJunctionSource {
  readonly id: string;
  readonly centerline: readonly GameCanvasPoint[];
  readonly widthM: number;
}

export interface RoadJunctionFill {
  /**
   * The junction outline, walked in heading order. Deliberately not convex: a
   * crossroads is a plus, not a blob, and its corners are rounded off by a kerb
   * radius. Every vertex is visible from `pivot`, so it fan-triangulates from
   * there without needing a general polygon triangulator.
   */
  readonly polygon: readonly GameCanvasPoint[];
  /** The shared node the outline is fanned around. */
  readonly pivot: GameCanvasPoint;
}

type RoadDirection = Readonly<{ x: number; z: number }>;

function roadPointDistance(
  first: GameCanvasPoint,
  second: GameCanvasPoint,
): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function normalizeRoadDirection(
  vector: RoadDirection,
): RoadDirection | null {
  const length = Math.hypot(vector.x, vector.z);
  return length > 0.0001
    ? { x: vector.x / length, z: vector.z / length }
    : null;
}

function roadLateral(direction: RoadDirection): RoadDirection {
  return { x: direction.z, z: -direction.x };
}

function dotRoadDirections(first: RoadDirection, second: RoadDirection): number {
  return first.x * second.x + first.z * second.z;
}

/**
 * Nearest point on a polyline to a query point. Used to anchor stop bars to the
 * road's centreline rather than the offset lane centreline, so a two-way road's
 * bar can start exactly at the centre line instead of painting across it.
 */
function nearestPointOnPolyline(
  query: GameCanvasPoint,
  polyline: readonly GameCanvasPoint[],
): GameCanvasPoint {
  let best: GameCanvasPoint = polyline[0] ?? query;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((query.x - start.x) * dx + (query.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    const point = { x: start.x + dx * t, z: start.z + dz * t };
    const distance = Math.hypot(query.x - point.x, query.z - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * Heading (radians, 0 = +z north) of the polyline segment nearest the query
 * point, or null when the polyline has no usable segment.
 */
export function roadAxisHeadingNear(
  polyline: readonly GameCanvasPoint[],
  query: GameCanvasPoint,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= 0) continue;
    const t = Math.max(
      0,
      Math.min(1, ((query.x - start.x) * dx + (query.z - start.z) * dz) / lengthSquared),
    );
    const distance = Math.hypot(
      query.x - (start.x + dx * t),
      query.z - (start.z + dz * t),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = Math.atan2(dx, dz);
    }
  }
  return best;
}

/**
 * World-space segment for a signal approach's painted stop bar.
 *
 * The bar is anchored at the lane's stop point but laid square to the road
 * surface's centreline, not the lane's local heading: a laneTrue centreline
 * eases onto the shared junction node over its last few metres, and a bar
 * perpendicular to that blended heading renders visibly slanted — adjacent
 * lanes' bars kink into a shallow V at the road centre (#149).
 *
 * Lane widths are authored much narrower than the painted carriageway, so a
 * half-lane-width bar reads as a short stub floating mid-lane. A centre line
 * means a two-way road: the bar runs from the centre line to the near kerb so
 * it never paints across the oncoming side. A one-way road (lane dividers
 * only) gets a bar spanning the lane, widened toward the road edge — so
 * adjacent lanes' bars meet into one continuous line — capped at the
 * carriageway half-width so it never spills onto the shoulder.
 */
export function signalStopBarSegment(
  stop: { readonly x: number; readonly z: number; readonly heading: number },
  lane: { readonly widthM?: number },
  surface:
    | {
        readonly centerline: readonly GameCanvasPoint[];
        readonly widthM: number;
        readonly markings?: readonly { readonly style: string }[];
      }
    | undefined,
): { readonly start: GameCanvasPoint; readonly end: GameCanvasPoint } {
  const roadHalfWidth = (surface?.widthM ?? lane.widthM ?? 3.2) / 2;
  const axis = surface ? roadAxisHeadingNear(surface.centerline, stop) : null;
  // Align the road axis with the lane's travel direction so `side` stays the
  // driver's right regardless of which way the surface was authored.
  const barHeading =
    axis === null
      ? stop.heading
      : Math.abs(Math.atan2(Math.sin(axis - stop.heading), Math.cos(axis - stop.heading))) >
          Math.PI / 2
        ? axis + Math.PI
        : axis;
  const sideX = Math.cos(barHeading);
  const sideZ = -Math.sin(barHeading);
  const twoWay = (surface?.markings ?? []).some(
    (marking) => marking.style === "centre_solid" || marking.style === "centre_dashed",
  );
  if (twoWay && surface) {
    const centre = nearestPointOnPolyline(stop, surface.centerline);
    const towardKerb =
      (stop.x - centre.x) * sideX + (stop.z - centre.z) * sideZ >= 0 ? 1 : -1;
    return {
      start: centre,
      end: {
        x: centre.x + towardKerb * roadHalfWidth * sideX,
        z: centre.z + towardKerb * roadHalfWidth * sideZ,
      },
    };
  }
  const halfWidth = Math.min((lane.widthM ?? 3.2) / 2 + 1.4, roadHalfWidth);
  return {
    start: { x: stop.x - sideX * halfWidth, z: stop.z - sideZ * halfWidth },
    end: { x: stop.x + sideX * halfWidth, z: stop.z + sideZ * halfWidth },
  };
}

/**
 * The signal hardware a camera has to sit on. Shared with
 * `buildSignalInstallation`, which builds the pole and arm from these same
 * figures — the camera hangs off geometry it does not own, and reading the
 * numbers from a second copy is how it ended up floating 17 cm over the arm.
 *
 * Note the arm's centre hangs a full thickness below the top of the mast, so
 * its upper surface is at `poleHeight - armThicknessM / 2` — *not* at
 * `poleHeight`, which is the trap.
 */
export const SIGNAL_MAST = {
  poleHeightM: 5.4,
  poleDiameterM: 0.22,
  armThicknessM: 0.18,
  kerbsidePoleHeightM: 3.7,
  kerbsidePoleDiameterM: 0.17,
} as const;

/** The upper surface of a mast arm hung from a pole of `poleHeight`. */
export function mastArmTopY(poleHeight: number): number {
  return poleHeight - SIGNAL_MAST.armThicknessM / 2;
}

/**
 * The enforcement camera's body: a squat housing under a rain hood. Every
 * figure is shared between the mesh and `trafficCameraPlacement` below, so the
 * lens can never drift off the front of the box it is set into.
 *
 * There is no bracket. One merged master serves both mountings, and a stub can
 * only point one way: backwards into a kerbside pole leaves it stuck out in
 * mid-air over a mast arm, which is exactly how it shipped and looked wrong.
 * The housing seats directly against what holds it instead — resting on the arm
 * over the carriageway, bedded into the shaft at the kerb — which needs no stub
 * at all and cannot leave a gap.
 */
export const TRAFFIC_CAMERA_BODY = {
  housing: { width: 0.3, height: 0.24, depth: 0.44 },
  hood: { width: 0.34, height: 0.05, depth: 0.32 },
  /** How far forward of the body centre the glass sits. */
  lensForwardM: 0.23,
  /** How far back along a mast arm the camera stands from the signal head. */
  armInsetM: 1.9,
  /** How far the housing beds into whatever carries it, so no seam shows. */
  seatM: 0.02,
  /**
   * Drop below the top of a kerbside pole, and how far the body steps off it.
   *
   * The drop is small because there is very little pole left to use: a kerbside
   * head hangs centred at `poleHeight - 0.95` and is 1.48 tall, so it already
   * reaches to within 0.21 m of the top. The camera goes in the gap above it.
   *
   * The step is set so the *back face* lands just inside the shaft — clear of
   * the pole's centre so the camera is not skewered by it, but not beyond the
   * shaft's surface either, or it hangs in the air off the side.
   */
  poleDropM: 0.08,
  poleClearM: 0.28,
} as const;

/**
 * Which of an equipped junction's signal heads carry a camera: one per approach
 * it enforces, deduped, because a head often serves several approaches.
 *
 * Not simply "the primary heads", which is what it was. Enforcement is per
 * control — every approach of a watched junction is booked — but the props were
 * hung per `role: "primary"` head, and London's southbound Queen's Gate arm is
 * signalled only by a `secondary` pole. That approach was ticketed by a camera
 * standing nowhere, which is the one thing a visible rule must never do.
 *
 * The fallback covers a junction whose heads name no approaches at all: better
 * a camera on every primary than an enforced junction with nothing on it.
 */
export function trafficCameraHeadIds(control: {
  readonly approaches?: readonly { readonly id: string }[];
  readonly installations?: readonly {
    readonly id: string;
    readonly style: string;
    readonly role: string;
    readonly approachIds?: readonly string[];
  }[];
}): ReadonlySet<string> {
  const heads = (control.installations ?? []).filter(
    (candidate) =>
      candidate.style === "nyc_signal" ||
      candidate.style === "uk_signal" ||
      candidate.style === "egypt_signal",
  );
  const chosen = new Set<string>();
  for (const approach of control.approaches ?? []) {
    const serving = heads.filter((head) =>
      (head.approachIds ?? []).includes(approach.id),
    );
    const pick = serving.find((head) => head.role === "primary") ?? serving[0];
    if (pick) chosen.add(pick.id);
  }
  if (chosen.size === 0) {
    for (const head of heads) if (head.role === "primary") chosen.add(head.id);
  }
  return chosen;
}

export interface TrafficCameraPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw of the body, matching the signal head so the glass looks at oncoming traffic. */
  readonly yaw: number;
  /** Where the glass itself lands, for the lens instance set into the front. */
  readonly lens: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Where an enforcement camera stands on the signal it watches.
 *
 * It takes the head's own yaw rather than deriving one. A head's lenses hang on
 * its local -Z and it is turned by the approach's direction of travel, which
 * puts the glass facing back down the road at the driver being signalled — the
 * same thing a camera has to look at, so the two are the same number. This is
 * the relation `regulatorySigns.ts` spells out for DO NOT ENTER: a sign (or a
 * lens) meant for the driver coming at you faces into the flow.
 *
 * Over the carriageway it rests on the mast arm's upper surface, back from the
 * head so the two read as separate hardware. On a kerbside pole there is no arm
 * to stand on, so it goes in the gap above the head, bedded into the shaft.
 * Either way the housing touches its mount: nothing here floats.
 */
export function trafficCameraPlacement(
  installation: {
    readonly position: GameCanvasPoint;
    readonly headingDeg: number;
    readonly armHeadingDeg?: number;
    readonly mounting: string;
  },
  poleHeight: number,
  armSpanM: number,
): TrafficCameraPlacement {
  const yaw = degreesToRadians(installation.headingDeg);
  // The direction the glass looks: local -Z through a yaw about Y.
  const facingX = -Math.sin(yaw);
  const facingZ = -Math.cos(yaw);
  const base = installation.position;
  let x: number;
  let z: number;
  let y: number;
  if (installation.mounting === "mast_arm") {
    const armHeading = degreesToRadians(
      installation.armHeadingDeg ?? installation.headingDeg,
    );
    const along = Math.max(0, armSpanM - TRAFFIC_CAMERA_BODY.armInsetM);
    x = base.x + Math.cos(armHeading) * along;
    z = base.z - Math.sin(armHeading) * along;
    // Sat on the arm's upper surface, bedded in a shade so no seam shows.
    y =
      mastArmTopY(poleHeight) +
      TRAFFIC_CAMERA_BODY.housing.height / 2 -
      TRAFFIC_CAMERA_BODY.seatM;
  } else {
    x = base.x + facingX * TRAFFIC_CAMERA_BODY.poleClearM;
    z = base.z + facingZ * TRAFFIC_CAMERA_BODY.poleClearM;
    y = poleHeight - TRAFFIC_CAMERA_BODY.poleDropM;
  }
  return {
    x,
    y,
    z,
    yaw,
    lens: {
      x: x + facingX * TRAFFIC_CAMERA_BODY.lensForwardM,
      y,
      z: z + facingZ * TRAFFIC_CAMERA_BODY.lensForwardM,
    },
  };
}

/** Removes authored duplicate points while retaining the fact that a path is closed. */
function normalizeRoadCenterline(
  points: readonly GameCanvasPoint[],
): { readonly points: readonly GameCanvasPoint[]; readonly closed: boolean } {
  const compact: GameCanvasPoint[] = [];
  for (const point of points) {
    if (!compact.length || roadPointDistance(compact.at(-1)!, point) > ROAD_POINT_EPSILON_M) {
      compact.push(point);
    }
  }
  const closed =
    compact.length > 2 &&
    roadPointDistance(compact[0], compact.at(-1)!) <= ROAD_POINT_EPSILON_M;
  if (closed) compact.pop();
  return { points: compact, closed };
}

/**
 * Smooths only the visual roundabout centreline. The simulation continues to
 * use its authored lane graph, while the low-poly asphalt reads as a proper
 * continuous ring instead of an octagon made from separate boxes.
 */
export function smoothClosedRoadCenterline(
  points: readonly GameCanvasPoint[],
  subdivisions = 4,
): readonly GameCanvasPoint[] {
  const normalized = normalizeRoadCenterline(points);
  const source = normalized.points;
  if (!normalized.closed || source.length < 3 || subdivisions < 1) return source;

  const result: GameCanvasPoint[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const previous = source[(index - 1 + source.length) % source.length];
    const start = source[index];
    const end = source[(index + 1) % source.length];
    const next = source[(index + 2) % source.length];
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x:
          0.5 *
          ((2 * start.x) +
            (-previous.x + end.x) * t +
            (2 * previous.x - 5 * start.x + 4 * end.x - next.x) * t2 +
            (-previous.x + 3 * start.x - 3 * end.x + next.x) * t3),
        z:
          0.5 *
          ((2 * start.z) +
            (-previous.z + end.z) * t +
            (2 * previous.z - 5 * start.z + 4 * end.z - next.z) * t2 +
            (-previous.z + 3 * start.z - 3 * end.z + next.z) * t3),
      });
    }
  }
  return result;
}

/**
 * Builds one watertight top surface for a road polyline. Unlike a chain of
 * boxes, mitered offsets share vertices at every bend so grass cannot show
 * through chipped joins.
 */
export function buildRoadSurfaceStripGeometry(
  sourcePoints: readonly GameCanvasPoint[],
  widthM: number,
  closedOverride?: boolean,
): RoadSurfaceStripGeometry {
  const normalized = normalizeRoadCenterline(sourcePoints);
  const points = normalized.points;
  const closed = closedOverride ?? normalized.closed;
  if (points.length < 2 || widthM <= 0) {
    return { positions: [], indices: [], closed };
  }

  const directions: RoadDirection[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const direction = normalizeRoadDirection({ x: end.x - start.x, z: end.z - start.z });
    if (!direction) return { positions: [], indices: [], closed };
    directions.push(direction);
  }

  const halfWidth = widthM / 2;
  const positions: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const incoming =
      index === 0 && !closed
        ? directions[0]
        : directions[(index - 1 + directions.length) % directions.length];
    const outgoing =
      index === points.length - 1 && !closed
        ? directions.at(-1)!
        : directions[index % directions.length];
    const incomingLateral = roadLateral(incoming);
    const outgoingLateral = roadLateral(outgoing);
    const miter = normalizeRoadDirection({
      x: incomingLateral.x + outgoingLateral.x,
      z: incomingLateral.z + outgoingLateral.z,
    });
    const alignment = miter ? dotRoadDirections(miter, outgoingLateral) : 0;
    const miterLength =
      miter && alignment > 0.12
        ? Math.min(halfWidth / alignment, halfWidth * MAX_ROAD_MITER_RATIO)
        : halfWidth;
    const lateral = miter
      ? { x: miter.x * miterLength, z: miter.z * miterLength }
      : { x: outgoingLateral.x * halfWidth, z: outgoingLateral.z * halfWidth };
    const point = points[index];
    positions.push(
      point.x + lateral.x,
      0,
      point.z + lateral.z,
      point.x - lateral.x,
      0,
      point.z - lateral.z,
    );
  }

  const indices: number[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const next = (index + 1) % points.length;
    const positive = index * 2;
    const negative = positive + 1;
    const nextPositive = next * 2;
    const nextNegative = nextPositive + 1;
    indices.push(
      positive,
      nextPositive,
      negative,
      negative,
      nextPositive,
      nextNegative,
    );
  }
  return { positions, indices, closed };
}

/** One carriageway leaving a shared node, as the junction outline sees it. */
interface RoadJunctionLeg {
  readonly direction: RoadDirection;
  /** Unit normal pointing at the next leg round the node in heading order. */
  readonly lateral: RoadDirection;
  readonly half: number;
  readonly reach: number;
}

/**
 * Where leg `a`'s near-side kerb meets leg `b`'s, as a distance along each leg
 * from the node. Both distances positive is a street corner — the kerbs close
 * in front of the node. Both negative is the outside of a bend: the kerbs only
 * meet behind the node, at the miter point that squares the turn off. Null when
 * they are parallel and never meet at all.
 */
function junctionKerbCorner(
  a: RoadJunctionLeg,
  b: RoadJunctionLeg,
): { alongA: number; alongB: number } | null {
  const offsetX = -b.lateral.x * b.half - a.lateral.x * a.half;
  const offsetZ = -b.lateral.z * b.half - a.lateral.z * a.half;
  const determinant = b.direction.x * a.direction.z - a.direction.x * b.direction.z;
  if (Math.abs(determinant) < 1e-6) return null;
  return {
    alongA: (b.direction.x * offsetZ - offsetX * b.direction.z) / determinant,
    alongB: (a.direction.x * offsetZ - offsetX * a.direction.z) / determinant,
  };
}

/**
 * The vertices that carry the outline from leg `a` round to leg `b`: a rounded
 * kerb at a street corner, a bare point at a gore too sharp to round, a miter
 * on the outside of a bend — where two surfaces meeting end-on leave a notch
 * of bare ground that a single mitered strip would never have had — and a
 * chamfer across the node when the kerbs are parallel or the corner runs away
 * to somewhere too far off to be a corner at all.
 */
function junctionCornerVertices(
  node: GameCanvasPoint,
  a: RoadJunctionLeg,
  b: RoadJunctionLeg,
  kerbRadiusM: number,
): GameCanvasPoint[] {
  const at = (leg: RoadJunctionLeg, lateralSign: number, along: number) => ({
    x: node.x + leg.lateral.x * leg.half * lateralSign + leg.direction.x * along,
    z: node.z + leg.lateral.z * leg.half * lateralSign + leg.direction.z * along,
  });
  const chamfer = [at(a, 1, 0), at(b, -1, 0)];
  const meeting = junctionKerbCorner(a, b);
  if (!meeting) return chamfer;
  if (meeting.alongA < 1e-3 && meeting.alongB < 1e-3) {
    const miter = at(a, 1, meeting.alongA);
    // Same guard the strip mitering uses: past this a near-hairpin would throw
    // out a long spike instead of squaring off a turn.
    return Math.hypot(miter.x - node.x, miter.z - node.z) <=
      Math.min(a.half, b.half) * MAX_ROAD_MITER_RATIO
      ? [miter]
      : chamfer;
  }
  if (meeting.alongA < 1e-3 || meeting.alongB < 1e-3) return chamfer;
  // The kerbs meet beyond where this fill ends, so these two carriageways are
  // still overlapping at its edge — there is no inner corner inside the fill to
  // round off. Bridge straight between the arms' outer corners: chamfering here
  // would cut back to within `half` of the node, notching paved surface out of
  // the throat of an acute fork and doubling the outline back on itself.
  if (meeting.alongA > a.reach || meeting.alongB > b.reach) return [];
  const corner = at(a, 1, meeting.alongA);
  const wedge = Math.acos(
    clamp(dotRoadDirections(a.direction, b.direction), -1, 1),
  );
  const tangent = Math.tan(wedge / 2);
  const radius = Math.min(
    kerbRadiusM,
    Math.min(a.half, b.half) * 0.6,
    Math.min(meeting.alongA, meeting.alongB) * 0.5,
    // The arc's tangent points have to stay on the kerbs they round off.
    Math.min(a.reach - meeting.alongA, b.reach - meeting.alongB) * tangent,
  );
  if (wedge < JUNCTION_KERB_MIN_WEDGE_RAD || radius < 0.2) return [corner];
  const setback = radius / tangent;
  const start = {
    x: corner.x + a.direction.x * setback,
    z: corner.z + a.direction.z * setback,
  };
  const end = {
    x: corner.x + b.direction.x * setback,
    z: corner.z + b.direction.z * setback,
  };
  const bisector = normalizeRoadDirection({
    x: a.direction.x + b.direction.x,
    z: a.direction.z + b.direction.z,
  });
  if (!bisector) return [corner];
  const centreX = corner.x + (bisector.x * radius) / Math.sin(wedge / 2);
  const centreZ = corner.z + (bisector.z * radius) / Math.sin(wedge / 2);
  const startAngle = Math.atan2(start.z - centreZ, start.x - centreX);
  let sweep = Math.atan2(end.z - centreZ, end.x - centreX) - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc: GameCanvasPoint[] = [];
  for (let step = 0; step <= JUNCTION_KERB_ARC_STEPS; step += 1) {
    const angle = startAngle + (sweep * step) / JUNCTION_KERB_ARC_STEPS;
    arc.push({
      x: centreX + Math.cos(angle) * radius,
      z: centreZ + Math.sin(angle) * radius,
    });
  }
  return arc;
}

/**
 * Paves each junction where independently-authored road surfaces share a node
 * (a side street meeting an avenue, a roundabout approach, a spliced segment).
 *
 * The fill traces the junction's actual outline: out along one carriageway to
 * its reach, across, back down its far kerb, round the corner into the next
 * carriageway, and so on round the node. That shape matters — a crossroads is a
 * plus, and anything blobbier (a convex hull, say) swallows the four pavement
 * corners between the arms and paves the very spot the traffic-light pole and
 * the waiting pedestrians stand on.
 *
 * Each arm reaches into the crossing by the WIDEST half-width present at the
 * node, not just its own, so the fill clears every crossing kerb rather than
 * stopping short and leaving the shoulder to show through as a wedge.
 * `lateralInflationM` widens the sections to build the matching shoulder fill
 * that underlies the paved junction. That one passes `kerbRadiusM` of 0: a kerb
 * radius rounds a corner *outwards*, which is what the carriageway wants and
 * the exact opposite of what the pavement wants — rounding the shoulder fill
 * would balloon the footway out past the building line at every block corner.
 */
/** Two ring points closer than this in bearing are the same corner twice. */
const JUNCTION_RING_BEARING_EPSILON_RAD = 1e-4;

/**
 * Orders a traced junction outline into a ring the pivot can see all of.
 *
 * The fill is drawn as a triangle fan from the shared node, which is only valid
 * if the boundary is star-shaped about it. Tracing leg by leg in heading order
 * gives that for free when the legs are properly separated — but where two
 * arms fork at an acute angle they still overlap at the fill's edge, so one
 * arm's outer corner sits *behind* the next arm's in bearing and the outline
 * doubles back. Fanning that folds triangles over each other: they z-fight,
 * and the ones that come out wound backwards face down and light black.
 *
 * Sorting by bearing restores the invariant. For a well-formed junction the
 * trace is already in bearing order, so this returns it unchanged; where two
 * points share a bearing the farther one wins, which is the one that keeps the
 * carriageway paved.
 */
function starShapedRing(
  pivot: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): GameCanvasPoint[] {
  const ordered = polygon
    .map((point) => ({
      point,
      bearing: Math.atan2(point.z - pivot.z, point.x - pivot.x),
      radius: Math.hypot(point.x - pivot.x, point.z - pivot.z),
    }))
    .filter((entry) => entry.radius > 1e-6)
    // Descending, to keep the winding the leg walk already produced.
    .sort(
      (first, second) =>
        second.bearing - first.bearing || second.radius - first.radius,
    );
  const ring: typeof ordered = [];
  for (const entry of ordered) {
    const previous = ring[ring.length - 1];
    if (
      previous &&
      previous.bearing - entry.bearing <= JUNCTION_RING_BEARING_EPSILON_RAD
    ) {
      continue;
    }
    ring.push(entry);
  }
  // The seam wraps, so the last point can still double the first.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length > 2 &&
    first &&
    last &&
    first.bearing + 2 * Math.PI - last.bearing <= JUNCTION_RING_BEARING_EPSILON_RAD
  ) {
    ring.pop();
  }
  return ring.map((entry) => entry.point);
}

export function collectRoadJunctionFills(
  surfaces: readonly RoadJunctionSource[],
  lateralInflationM = 0,
  kerbRadiusM = JUNCTION_KERB_MAX_RADIUS_M,
): readonly RoadJunctionFill[] {
  const clusters: Array<{
    x: number;
    z: number;
    surfaceIds: Set<string>;
    maxHalf: number;
    arms: Array<{
      half: number;
      node: GameCanvasPoint;
      neighbours: GameCanvasPoint[];
    }>;
  }> = [];
  // Pass 1: gather every centreline point into shared-node clusters, recording
  // the widest half-width that meets there so the reach can clear it.
  for (const surface of surfaces) {
    const { points, closed } = normalizeRoadCenterline(surface.centerline);
    const half = surface.widthM / 2 + lateralInflationM;
    for (let index = 0; index < points.length; index += 1) {
      const node = points[index];
      let cluster = clusters.find(
        (candidate) =>
          Math.hypot(candidate.x - node.x, candidate.z - node.z) <=
          ROAD_POINT_EPSILON_M,
      );
      if (!cluster) {
        cluster = {
          x: node.x,
          z: node.z,
          surfaceIds: new Set(),
          maxHalf: 0,
          arms: [],
        };
        clusters.push(cluster);
      }
      cluster.surfaceIds.add(surface.id);
      cluster.maxHalf = Math.max(cluster.maxHalf, half);
      // A closed ring wraps, so its seam node has a carriageway either side of
      // it like any other — miss that and a roundabout is left with a bite out
      // of it exactly where an approach joins.
      const neighbours: GameCanvasPoint[] = [];
      if (index > 0) neighbours.push(points[index - 1]);
      else if (closed) neighbours.push(points[points.length - 1]);
      if (index < points.length - 1) neighbours.push(points[index + 1]);
      else if (closed) neighbours.push(points[0]);
      cluster.arms.push({ half, node, neighbours });
    }
  }
  // Pass 2: at every shared node, walk the legs in heading order and trace the
  // outline — out one carriageway, across its end, back down the far kerb, round
  // the corner, on to the next.
  const fills: RoadJunctionFill[] = [];
  for (const cluster of clusters) {
    if (cluster.surfaceIds.size <= 1) continue;
    const pivot = { x: cluster.x, z: cluster.z };
    const legs: RoadJunctionLeg[] = [];
    for (const arm of cluster.arms) {
      for (const neighbour of arm.neighbours) {
        const direction = normalizeRoadDirection({
          x: neighbour.x - arm.node.x,
          z: neighbour.z - arm.node.z,
        });
        if (!direction) continue;
        legs.push({
          direction,
          // `roadLateral` turns a heading clockwise, which is the direction the
          // sort below advances in, so this always faces the next leg round.
          lateral: roadLateral(direction),
          half: arm.half,
          reach: Math.min(
            Math.max(cluster.maxHalf * 1.7, arm.half * 1.3),
            roadPointDistance(arm.node, neighbour) * 0.9,
          ),
        });
      }
    }
    if (legs.length < 2) continue;
    legs.sort(
      (first, second) =>
        Math.atan2(first.direction.x, first.direction.z) -
        Math.atan2(second.direction.x, second.direction.z),
    );
    const polygon: GameCanvasPoint[] = [];
    for (const [index, leg] of legs.entries()) {
      const tipX = pivot.x + leg.direction.x * leg.reach;
      const tipZ = pivot.z + leg.direction.z * leg.reach;
      polygon.push({
        x: tipX - leg.lateral.x * leg.half,
        z: tipZ - leg.lateral.z * leg.half,
      });
      polygon.push({
        x: tipX + leg.lateral.x * leg.half,
        z: tipZ + leg.lateral.z * leg.half,
      });
      polygon.push(
        ...junctionCornerVertices(
          pivot,
          leg,
          legs[(index + 1) % legs.length],
          kerbRadiusM,
        ),
      );
    }
    const ring = starShapedRing(pivot, polygon);
    if (ring.length >= 3) fills.push({ polygon: ring, pivot });
  }
  return fills;
}

/** A circle the street wall must not build inside. */
export interface BuildingKeepOut {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Whether a street-wall building would stand in someone's lot.
 *
 * Takes the building's own half-extents rather than just its centre. The
 * instanced glb wall can get away with a centre test because its buildings are
 * slotted along a block edge at roughly the keep-out's own scale; the
 * procedural facade grid divides a whole block into as few as nine boxes, and
 * on NYC one of those is 48 m across — far enough that its centre clears a
 * forecourt by 30 m while its wall still covers it.
 */
export function isInsideKeepOut(
  keepOuts: readonly BuildingKeepOut[],
  x: number,
  z: number,
  halfWidth = 0,
  halfDepth = 0,
): boolean {
  return keepOuts.some((ex) => {
    // Nearest point of the building's footprint to the keep-out's centre.
    const nearestX = Math.max(x - halfWidth, Math.min(ex.x, x + halfWidth));
    const nearestZ = Math.max(z - halfDepth, Math.min(ex.z, z + halfDepth));
    return Math.hypot(nearestX - ex.x, nearestZ - ex.z) < ex.radius;
  });
}

/**
 * Where the procedural facade grid puts a building on a block.
 *
 * The cell centres are fully determined by the block; only each box's size and
 * height are jittered by the scene's PRNG. Split out so the placement can be
 * checked against the service and venue keep-outs without standing up a scene —
 * a facade box inside a lot is invisible in code and unmistakable in play.
 */
export function facadeGridCells(block: {
  readonly center: { readonly x: number; readonly z: number };
  readonly size: { readonly x: number; readonly z: number };
  readonly density: number;
  readonly headingDeg?: number;
}): readonly {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly cellWidth: number;
  readonly cellDepth: number;
  readonly rotationY: number;
}[] {
  const count = Math.max(1, Math.round(3 + block.density * 7));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellWidth = block.size.x / columns;
  const cellDepth = block.size.z / rows;
  const rotationY = degreesToRadians(block.headingDeg ?? 0);
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const localX = -block.size.x / 2 + cellWidth * (column + 0.5);
    const localZ = -block.size.z / 2 + cellDepth * (row + 0.5);
    cells.push({
      index,
      x: block.center.x + localX * cos + localZ * sin,
      z: block.center.z - localX * sin + localZ * cos,
      cellWidth,
      cellDepth,
      rotationY,
    });
  }
  return cells;
}

/** Stable low-spec culling: the same seed always keeps the same scenery. */
export function deterministicSceneryKeep(
  key: string,
  fraction: number,
): boolean {
  if (fraction >= 1) return true;
  if (fraction <= 0) return false;
  return hashStringToSeed(key) / 0xffff_ffff < fraction;
}

/**
 * Pulls Cairo's procedural filler toward the nearest block edge so avenues get
 * a continuous, dense frontage instead of a vacant apron around a centre grid.
 * The returned footprint stays inset inside the authored rotated block.
 */
export interface CairoFrontagePlacement extends GameCanvasPoint {
  readonly edgeAxis: "x" | "z";
  readonly outwardSign: -1 | 1;
  /** Local yaw whose +z axis points out through the street-facing wall. */
  readonly detailYawRad: number;
  readonly localX: number;
  readonly localZ: number;
}

export function cairoFrontagePosition(
  block: {
    readonly center: GameCanvasPoint;
    readonly size: GameCanvasPoint;
    readonly headingDeg?: number;
    readonly frontageAxis?: "x" | "z";
  },
  cell: { readonly index: number; readonly x: number; readonly z: number },
  buildingWidthM: number,
  buildingDepthM: number,
): CairoFrontagePlacement {
  const heading = degreesToRadians(block.headingDeg ?? 0);
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dx = cell.x - block.center.x;
  const dz = cell.z - block.center.z;
  let localX = dx * cos - dz * sin;
  let localZ = dx * sin + dz * cos;
  const halfX = block.size.x / 2;
  const halfZ = block.size.z / 2;
  const xScore = Math.abs(localX) / Math.max(1, halfX);
  const zScore = Math.abs(localZ) / Math.max(1, halfZ);
  const chooseX =
    block.frontageAxis !== undefined
      ? block.frontageAxis === "x"
      : Math.abs(xScore - zScore) > 0.04
        ? xScore > zScore
        : cell.index % 2 === 0;
  let outwardSign: -1 | 1;
  if (chooseX) {
    const side =
      localX === 0 ? (cell.index % 4 < 2 ? -1 : 1) : Math.sign(localX);
    outwardSign = side < 0 ? -1 : 1;
    localX =
      outwardSign * Math.max(0, halfX - buildingWidthM / 2 - 1.15);
  } else {
    const side =
      localZ === 0 ? (cell.index % 4 < 2 ? 1 : -1) : Math.sign(localZ);
    outwardSign = side < 0 ? -1 : 1;
    localZ =
      outwardSign * Math.max(0, halfZ - buildingDepthM / 2 - 1.15);
  }
  return {
    x: block.center.x + localX * cos + localZ * sin,
    z: block.center.z - localX * sin + localZ * cos,
    edgeAxis: chooseX ? "x" : "z",
    outwardSign,
    detailYawRad: chooseX
      ? outwardSign * Math.PI / 2
      : outwardSign > 0
        ? 0
        : Math.PI,
    localX,
    localZ,
  };
}

export interface CairoFrontageFootprint {
  readonly placement: CairoFrontagePlacement;
  readonly widthM: number;
  readonly depthM: number;
}

/** All Cairo filler in one block shares its yaw, so local AABB overlap is O(1). */
export function cairoFrontageFootprintsOverlap(
  first: CairoFrontageFootprint,
  second: CairoFrontageFootprint,
  gapM = 0.6,
): boolean {
  return (
    Math.abs(first.placement.localX - second.placement.localX) <
      (first.widthM + second.widthM) / 2 + gapM &&
    Math.abs(first.placement.localZ - second.placement.localZ) <
      (first.depthM + second.depthM) / 2 + gapM
  );
}

/** Rotates axis-authored street-wall slots into a block's local heading. */
export function rotateBlockBuildingPlacements(
  placements: readonly PlacedBuilding[],
  center: GameCanvasPoint,
  headingDeg = 0,
): readonly PlacedBuilding[] {
  if (Math.abs(headingDeg) < 0.0001) return placements;
  const heading = (headingDeg * Math.PI) / 180;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return placements.map((placement) => {
    const localX = placement.x - center.x;
    const localZ = placement.z - center.z;
    return {
      ...placement,
      x: center.x + localX * cos + localZ * sin,
      z: center.z - localX * sin + localZ * cos,
      yaw: placement.yaw + heading,
    };
  });
}

/**
 * Every circle the street wall must leave clear: each service point's lot and
 * each gig venue's plot.
 *
 * Exported so the placement can be checked against it without a scene. The two
 * street-wall paths consume this at very different times — the instanced glb
 * wall after preload, the procedural facade grid inline — which is exactly how
 * a terrace ended up standing through London's and Tokyo's repair shops: the
 * keep-outs used to be collected as each building was placed, which was in time
 * for one path and far too late for the other.
 */
export function buildingKeepOuts(
  mapPack: GameCanvasMapPack,
): readonly BuildingKeepOut[] {
  const keepOuts: BuildingKeepOut[] = [];
  for (const service of mapPack.geometry.servicePoints ?? []) {
    const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
    if (!lot) continue;
    keepOuts.push({
      x: lot.x,
      z: lot.z,
      // The station's glb lot is bigger than its authored footprint, so it
      // wants a generous clearance. The repair shop is a much smaller building,
      // and clearing 16 m round it would punch a hole in the street wall far
      // larger than the shop standing in it.
      radius:
        service.kind === "repair_shop"
          ? REPAIR_SHOP_LOT_HALF_M + 3
          : Math.max(service.footprint.x, service.footprint.z) + 16,
    });
  }
  for (const venue of mapPack.geometry.gigVenues ?? []) {
    const placement = resolveVenuePlacement(mapPack, venue);
    if (!placement) continue;
    keepOuts.push({
      x: placement.x,
      z: placement.z,
      radius: Math.max(venue.footprint.x, venue.footprint.z) / 2 + 12,
    });
  }
  return keepOuts;
}

/**
 * The instanced street-wall buildings that survive the keep-outs.
 *
 * The renderer's filter and the test's assertion have to be the same decision,
 * or the test only proves that a predicate exists — which is exactly what the
 * first version of it proved, while the renderer went on passing centres and
 * meshing a brownstone into Broadway Auto.
 */
export function keptStreetWallBuildings<
  T extends { readonly modelId: string; readonly x: number; readonly z: number },
>(placements: readonly T[], keepOuts: readonly BuildingKeepOut[]): readonly T[] {
  return placements.filter((b) => {
    // Measured against the building's own footprint, not just its centre. A
    // brownstone is ~11 m across, so one centred a comfortable 8 m outside a
    // repair shop's keep-out still has its flank 2.5 m inside the shop.
    const half = (buildingPlacementConfig(b.modelId)?.footprintM ?? 0) / 2;
    return !isInsideKeepOut(keepOuts, b.x, b.z, half, half);
  });
}

/** Keeps a checkpoint target wholly inside its authored lane. */
export function resolveCheckpointTargetWidth(laneWidthM: number): number {
  return Math.max(0, Math.min(2.4, laneWidthM - 0.6));
}

/** Keeps each chevron, including its stroke, inside the guidance envelope. */
export function resolveRouteChevronHalfSpan(laneWidthM: number): number {
  return Math.max(0.32, Math.min(0.72, (laneWidthM - 0.8) / 2 - 0.12));
}

/**
 * Resolves the single simulation-owned route occurrence whose chevrons may be
 * rendered. Overtaking owns the guidance channel while active and suppresses
 * the normal route stream so two competing lanes are never highlighted.
 */
export function resolveAuthoritativeRouteIndex(
  routeLength: number,
  guidance: Pick<SimulationSnapshot["guidance"], "owner" | "status" | "blockingReason">,
): number | null {
  if (
    routeLength <= 0 ||
    guidance.status === "inactive" ||
    guidance.status === "complete" ||
    guidance.owner?.kind !== "route"
  ) {
    return null;
  }
  const authoritativeIndex = guidance.owner.routeIndex;
  if (
    authoritativeIndex !== null &&
    authoritativeIndex >= 0 &&
    authoritativeIndex < routeLength
  ) {
    return authoritativeIndex;
  }
  return null;
}

/** Avoids stacking an amber lane cue directly on the active cyan checkpoint. */
export function guidanceCueOverlapsCheckpoint(
  cue: Pick<NonNullable<SimulationSnapshot["guidance"]["cue"]>, "laneId" | "distanceAlongM"> | null,
  checkpoint: Pick<AuthoredCheckpoint, "laneId" | "distanceAlongM"> | null,
): boolean {
  return Boolean(
    cue &&
      checkpoint &&
      checkpoint.laneId === cue.laneId &&
      checkpoint.distanceAlongM !== null &&
      Math.abs(checkpoint.distanceAlongM - cue.distanceAlongM) <= 2.5,
  );
}

export function clampHorizontalFieldOfView(value: number): number {
  return clamp(value, MIN_HORIZONTAL_FOV, MAX_HORIZONTAL_FOV);
}

export interface GameRuntimeEvent {
  type:
    | "ready"
    | "camera"
    | "indicator"
    | "horn"
    | "coaching"
    | "collision"
    | "cutscene"
    | "fine"
    | "incident"
    | "reset"
    | "complete"
    | "context-lost"
    | "context-restored";
  message: string;
  severity?: "info" | "warning" | "critical";
  timestamp: number;
  ruleCode?: string;
  penalty?: number;
  evidence?: Readonly<Record<string, string | number | boolean>>;
  /**
   * On a `fine`, who wrote it. A patrol means a traffic stop, and the money
   * moves on that scene's `cite` step; a camera has nobody to stage, so the app
   * debits where it stands. Deliberately its own field rather than a key inside
   * `evidence`, which is what the simulation measured about the driving — who
   * happened to be watching is not.
   */
  issuedBy?: "patrol" | "camera";
}

/**
 * One interaction cutscene the app wants played: the driver refuelling, the
 * rider boarding or leaving, a delivery errand. Nonce-keyed like `resetNonce`
 * so a re-render can never restart a scene; the session answers with
 * `cutscene` events (`phase: "pump" | "done"`) carrying the same nonce.
 */
export interface CutsceneRequest {
  readonly nonce: number;
  readonly kind: CutsceneKind;
  /** The gig stop the scene plays at (venue/address id). Refuel resolves the
   * nearest pump instead. */
  readonly venueId?: string;
  /** Stop id whose seed styles the passenger — the pickup, so the person who
   * gets out at the drop-off is the person who got in. */
  readonly actorSeedId?: string;
  /**
   * How much of a tank is going in (0..1), sizing the refuel fill window.
   * Career and the roadside rescue always pour what is missing; a free-drive
   * wallet that cannot cover a whole tank pours less.
   */
  readonly fuelFillFraction?: number;
}

/** Structural lesson contract; existing LessonDefinition objects can be passed directly. */
export interface GameCanvasLesson {
  readonly id: string;
  readonly title: string;
  readonly kind: "orientation" | "guided" | "transition" | "free_drive";
  readonly trafficSide: TrafficSide;
  readonly startSpawnId?: string;
  readonly route: readonly string[];
  readonly objectives: readonly {
    readonly id: string;
    readonly label: string;
    readonly ruleCode?: string;
  }[];
  readonly trafficSeed: number;
  readonly trafficDensity: "none" | "light" | "moderate" | "busy";
  readonly vulnerableRoadUsers?: Readonly<{
    pedestrians: number;
    cyclists: number;
  }>;
  readonly checkpoints: readonly string[];
  readonly coachPrompts: readonly {
    readonly id: string;
    readonly message: string;
    readonly trigger:
      | { readonly type: "start" }
      | { readonly type: "route_progress"; readonly value: number }
      | { readonly type: "checkpoint"; readonly checkpointId: string }
      | {
          readonly type: "maneuver_phase";
          readonly maneuverId: string;
          readonly phase:
            | "approach"
            | "observe"
            | "pass"
            | "establish_clearance"
            | "return"
            | "complete";
        }
      | { readonly type: "rule_event"; readonly ruleCode: string };
  }[];
  readonly assessedRules?: readonly string[];
  readonly scenarioClock?: Readonly<{
    readonly weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    readonly minutesAfterMidnight: number;
    readonly label: string;
  }>;
  readonly profileTransitions?: readonly {
    readonly checkpointId: string;
    readonly fromCountryId: string;
    readonly toCountryId: string;
    readonly message: string;
  }[];
  readonly maneuvers?: readonly {
    readonly id: string;
    readonly kind: "overtake";
    readonly normalLaneId: string;
    readonly passingLaneId: string;
    readonly corridorStart: { readonly laneId: string; readonly distanceAlongM: number };
    readonly corridorEnd: { readonly laneId: string; readonly distanceAlongM: number };
    readonly leadVehicleStart: {
      readonly laneId: string;
      readonly distanceAlongM: number;
    };
    readonly leadVehicleSpeedFactor: number;
    readonly phaseAnchors: Readonly<{
      approach: { readonly laneId: string; readonly distanceAlongM: number };
      observe: { readonly laneId: string; readonly distanceAlongM: number };
      pass: { readonly laneId: string; readonly distanceAlongM: number };
      return: { readonly laneId: string; readonly distanceAlongM: number };
      complete: { readonly laneId: string; readonly distanceAlongM: number };
    }>;
    readonly predictedClearSeconds: number;
    readonly returnStandstillGapM: number;
    readonly returnHeadwaySeconds: number;
    readonly sourceReferenceIds: readonly string[];
  }[];
}

export interface GameCanvasPoint {
  readonly x: number;
  readonly z: number;
}

export interface GameCanvasWaterBody {
  readonly id: string;
  readonly polygon: readonly GameCanvasPoint[];
  readonly color: string;
  readonly flowHeadingDeg?: number;
  /** Road surfaces that cross this water — their over-water spans wall boat
   * tracks (the drivable bridges have no underside to pass beneath). */
  readonly bridgePortalSurfaceIds?: readonly string[];
}

export interface WaterPolygonGeometry {
  /** The deduplicated outline, in the order it was authored. */
  readonly polygon: readonly GameCanvasPoint[];
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly uvs: readonly number[];
  /**
   * Per vertex: 1 hard against the bank, 0 out in open water. Empty when the
   * caller asked for no shore band, or when the outline was too tight to inset
   * one into. The renderer turns it into vertex colours; keeping it a bare
   * number here is what stops the geometry layer from having to know a colour.
   */
  readonly shoreFactors: readonly number[];
}

function polygonSignedArea(polygon: readonly GameCanvasPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += point.x * next.z - next.x * point.z;
  }
  return twiceArea / 2;
}

function pointInTriangle(
  point: GameCanvasPoint,
  first: GameCanvasPoint,
  second: GameCanvasPoint,
  third: GameCanvasPoint,
): boolean {
  const cross = (a: GameCanvasPoint, b: GameCanvasPoint, p: GameCanvasPoint) =>
    (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const one = cross(first, second, point);
  const two = cross(second, third, point);
  const three = cross(third, first, point);
  return one >= -1e-7 && two >= -1e-7 && three >= -1e-7;
}

/** UV units per metre baked into the water tile's world-planar UVs. */
export const WATER_UV_PER_M = 0.025;

/**
 * Ear-clips one closed outline into upward-facing triangles, as indices into
 * `vertices` shifted by `offset`. Concave outlines are the whole reason this is
 * not a centre fan — a fan across a river bend bridges straight over the bank.
 *
 * **The triangle winding is what lights the water.** It is one flat sheet with
 * no relief for the eye to correct against, so its vertex normals come entirely
 * from the winding — get it backwards and `ComputeNormals` hands every vertex a
 * downward normal, the sun and the sky half of the hemispheric light both drop
 * out, and the Nile renders as the near-black slick that shipped for months.
 * Nothing culls it, so there is no missing-face symptom to notice; it just goes
 * dark. `tests/cairoVisuals.test.ts` pins the normals themselves.
 */
function earClipPolygonIndices(
  polygon: readonly GameCanvasPoint[],
  offset = 0,
): number[] {
  const remaining = polygon.map((_, index) => index);
  if (polygonSignedArea(polygon) < 0) remaining.reverse();
  const indices: number[] = [];
  let guard = polygon.length * polygon.length;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      const a = polygon[previous];
      const b = polygon[current];
      const c = polygon[next];
      const turn =
        (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      if (turn <= 1e-7) continue;
      const containsVertex = remaining.some(
        (candidate) =>
          candidate !== previous &&
          candidate !== current &&
          candidate !== next &&
          pointInTriangle(polygon[candidate], a, b, c),
      );
      if (containsVertex) continue;
      // Emit the ear in the order the clipper walked it. Babylon's face normal
      // is `(p1 - p2) × (p3 - p2)`, whose y term is the *negation* of the x/z
      // cross product, so it is this counter-clockwise winding that faces up
      // and the reversed one — which is what shipped — that faces the riverbed.
      indices.push(previous, current, next);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    indices.push(remaining[0], remaining[1], remaining[2]);
  }
  if (indices.length !== (polygon.length - 2) * 3) {
    indices.length = 0;
    const counterClockwise =
      polygonSignedArea(polygon) > 0
        ? polygon.map((_, index) => index)
        : polygon.map((_, index) => index).reverse();
    for (let index = 1; index < counterClockwise.length - 1; index += 1) {
      indices.push(
        counterClockwise[0],
        counterClockwise[index],
        counterClockwise[index + 1],
      );
    }
  }
  return offset ? indices.map((index) => index + offset) : indices;
}

/** A corner sharper than this would spike its inset vertex out into open water. */
const WATER_INSET_MITER_LIMIT = 3;

/**
 * Walks a closed outline inward by `insetM`, mitered at the corners, or gives
 * up and returns undefined.
 *
 * Giving up is the point: a mitered inset is only well behaved while the offset
 * stays small against the local feature size, and there is no cheap general
 * answer for the cases where it isn't (a spit narrower than the band, a hairpin
 * corner) — it folds the outline inside out and the ring self-intersects. The
 * checks below are all cheap consequences of that folding, and a caller that
 * gets `undefined` simply goes without a shore band rather than rendering a
 * knot in the river.
 */
function insetWaterPolygon(
  polygon: readonly GameCanvasPoint[],
  insetM: number,
): GameCanvasPoint[] | undefined {
  const area = polygonSignedArea(polygon);
  if (!Number.isFinite(area) || area === 0) return undefined;
  // Edge normals point into the water, whichever way the outline was authored.
  const inward = area > 0 ? 1 : -1;
  const normals = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(next.x - point.x, next.z - point.z);
    if (length <= 1e-6) return undefined;
    return {
      x: (-(next.z - point.z) / length) * inward,
      z: ((next.x - point.x) / length) * inward,
    };
  });
  if (normals.some((normal) => !normal)) return undefined;

  const inset: GameCanvasPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const before = normals[(index - 1 + polygon.length) % polygon.length]!;
    const after = normals[index]!;
    const miterX = before.x + after.x;
    const miterZ = before.z + after.z;
    const miterLength = Math.hypot(miterX, miterZ);
    if (miterLength <= 1e-6) return undefined;
    const unitX = miterX / miterLength;
    const unitZ = miterZ / miterLength;
    // 1 / cos(half the corner angle): how much further the corner has to move
    // for both of its edges to end up `insetM` in.
    const stretch = 1 / (unitX * after.x + unitZ * after.z);
    if (!Number.isFinite(stretch) || stretch > WATER_INSET_MITER_LIMIT) {
      return undefined;
    }
    inset.push({
      x: polygon[index].x + unitX * insetM * stretch,
      z: polygon[index].z + unitZ * insetM * stretch,
    });
  }

  const insetArea = polygonSignedArea(inset);
  // Same handedness, genuinely smaller, and not eaten alive by its own band.
  if (Math.sign(insetArea) !== Math.sign(area)) return undefined;
  const ratio = Math.abs(insetArea) / Math.abs(area);
  if (ratio > 0.995 || ratio < 0.25) return undefined;
  // Every edge must still run the way it used to. A reversed one is a fold,
  // which the area test alone can miss when two folds cancel out.
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const originalX = polygon[next].x - polygon[index].x;
    const originalZ = polygon[next].z - polygon[index].z;
    const insetX = inset[next].x - inset[index].x;
    const insetZ = inset[next].z - inset[index].z;
    if (originalX * insetX + originalZ * insetZ <= 0) return undefined;
  }
  return inset;
}

/**
 * Builds the flat mesh for one authored water outline, optionally with a shore
 * band: a `shoreBandM`-wide ring of extra triangles just inside the bank, whose
 * vertices come back marked in `shoreFactors`.
 *
 * The ring exists because **every vertex of the bare outline is a bank vertex**,
 * so there is nowhere to hang an edge-darkening gradient — the interior has no
 * vertices at all. Inset one ring and the water gains an inner edge to fade to.
 */
export function buildWaterPolygonGeometry(
  source: readonly GameCanvasPoint[],
  y = 0.025,
  shoreBandM = 0,
): WaterPolygonGeometry {
  const polygon: GameCanvasPoint[] = [];
  for (const point of source) {
    const previous = polygon.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
      polygon.push({ x: point.x, z: point.z });
    }
  }
  if (
    polygon.length > 2 &&
    Math.hypot(
      polygon[0].x - polygon.at(-1)!.x,
      polygon[0].z - polygon.at(-1)!.z,
    ) <= 1e-6
  ) {
    polygon.pop();
  }
  if (polygon.length < 3) {
    return { polygon, positions: [], indices: [], uvs: [], shoreFactors: [] };
  }

  const inset =
    shoreBandM > 0 ? insetWaterPolygon(polygon, shoreBandM) : undefined;
  const vertices = inset ? [...polygon, ...inset] : polygon;
  const indices: number[] = [];
  if (inset) {
    // The ring, one quad per bank edge. Walking the outline in its own
    // direction and closing back along the inset keeps each quad wound like
    // the outline itself, so an anticlockwise outline needs no fix-up and a
    // clockwise one takes the mirrored triangle pair.
    const clockwise = polygonSignedArea(polygon) < 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const next = (index + 1) % polygon.length;
      const outerA = index;
      const outerB = next;
      const innerA = polygon.length + index;
      const innerB = polygon.length + next;
      if (clockwise) {
        indices.push(outerA, innerB, outerB, outerA, innerA, innerB);
      } else {
        indices.push(outerA, outerB, innerB, outerA, innerB, innerA);
      }
    }
  }
  indices.push(
    ...earClipPolygonIndices(inset ?? polygon, inset ? polygon.length : 0),
  );

  const positions = vertices.flatMap((point) => [point.x, y, point.z]);
  const uvs = vertices.flatMap((point) => [
    point.x * WATER_UV_PER_M,
    point.z * WATER_UV_PER_M,
  ]);
  const shoreFactors = inset
    ? vertices.map((_, index) => (index < polygon.length ? 1 : 0))
    : [];
  return { polygon, positions, indices, uvs, shoreFactors };
}

export interface WaterBoatPlacement {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly variant: 0 | 1 | 2;
  /** Safe travel interval along heading, inset from the authored shoreline. */
  readonly trackStartM: number;
  readonly trackLengthM: number;
  /** Stable visual phase/speed; these never consume simulation randomness. */
  readonly phase: number;
  readonly speedMps: number;
}

export interface WaterBoatPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly roll: number;
}

function distanceToPolygonEdges(
  point: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSq = dx * dx + dz * dz;
    const along =
      lengthSq > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSq,
            ),
          )
        : 0;
    nearest = Math.min(
      nearest,
      Math.hypot(
        point.x - (start.x + dx * along),
        point.z - (start.z + dz * along),
      ),
    );
  }
  return nearest;
}

function rayDistanceToPolygonEdge(
  origin: GameCanvasPoint,
  direction: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edgeX = end.x - start.x;
    const edgeZ = end.z - start.z;
    const denominator = direction.x * edgeZ - direction.z * edgeX;
    if (Math.abs(denominator) < 1e-8) continue;
    const offsetX = start.x - origin.x;
    const offsetZ = start.z - origin.z;
    const rayDistance = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
    const edgeAmount =
      (offsetX * direction.z - offsetZ * direction.x) / denominator;
    if (
      rayDistance >= 0 &&
      edgeAmount >= -1e-8 &&
      edgeAmount <= 1 + 1e-8
    ) {
      nearest = Math.min(nearest, rayDistance);
    }
  }
  return nearest;
}

/**
 * What a boat track must never cross. The two drivable Nile bridges have no
 * underside at all — their road surface IS the deck, at water level — so no
 * craft passes them at any mast height; their over-water spans are hard
 * walls. The elevated expressway is the opposite: its soffit clears every
 * mast, and only its pier columns need avoiding.
 */
export interface WaterBoatObstacles {
  readonly spans: readonly {
    readonly x: number;
    readonly z: number;
    readonly ux: number;
    readonly uz: number;
    readonly halfLengthM: number;
    readonly halfWidthM: number;
  }[];
  readonly piers: readonly {
    readonly x: number;
    readonly z: number;
    readonly radiusM: number;
  }[];
}

/** Hull lengths per variant: motor skiff, felucca, tour boat. */
export const WATER_BOAT_LENGTHS_M = [4.6, 6.5, 6.2] as const;
/** Highest point above the waterline per variant — the felucca's masthead at
 * its 6.5 m hull is 5.7 m, under the elevated deck soffit
 * (CAIRO_ELEVATED_DECK_Y − thickness/2 = 6.84). */
export const WATER_BOAT_AIR_DRAFTS_M = [1.1, 5.7, 1.5] as const;
/** Track clearance around obstacles: the widest half-beam plus water room. */
export const WATER_BOAT_CLEARANCE_M = 3.6;
/** Per-variant craft glbs: motor skiff, felucca, tour boat (the skiff again
 * at a longer hull). Cairo-only files; CREDITS.md logs their provenance. */
export const WATER_BOAT_MODEL_URLS = [
  "/models/props/cairo-skiff.glb",
  "/models/props/cairo-felucca.glb",
  "/models/props/cairo-skiff.glb",
] as const;
/** How deep each hull sits below the waterline pose. */
const WATER_BOAT_DRAUGHT_M = 0.3;
export const CAIRO_ELEVATED_DECK_Y = 7.2;
export const CAIRO_ELEVATED_DECK_THICKNESS_M = 0.72;
export const CAIRO_ELEVATED_PIER_RADIUS_M = 0.825;

/** The obstacle set for one water body, shared verbatim by the renderer and
 * the tests so neither can drift from what the boats actually avoid. */
export function cairoWaterBoatObstacles(
  geometry: {
    readonly roadSurfaces?: GameCanvasMapPack["geometry"]["roadSurfaces"];
    readonly landmarks?: GameCanvasMapPack["geometry"]["landmarks"];
  },
  body: GameCanvasWaterBody,
): WaterBoatObstacles {
  const spans: WaterBoatObstacles["spans"][number][] = [];
  for (const surfaceId of body.bridgePortalSurfaceIds ?? []) {
    const surface = geometry.roadSurfaces?.find(
      (candidate) => candidate.id === surfaceId,
    );
    if (!surface) continue;
    for (const span of bridgePortalRailSpans(body, surface)) {
      spans.push({
        x: span.center.x,
        z: span.center.z,
        ux: span.ux,
        uz: span.uz,
        halfLengthM: span.halfLengthM,
        halfWidthM: surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8),
      });
    }
  }
  const piers: WaterBoatObstacles["piers"][number][] = [];
  const scenic = geometry.landmarks?.find(
    (landmark) => landmark.id === "cairo-sixth-october-bridge",
  );
  if (scenic) {
    const axis = cairoBridgeVisualAxis(scenic, geometry.roadSurfaces ?? []);
    for (const pier of cairoElevatedBridgePierPlacements(
      axis,
      geometry.roadSurfaces ?? [],
    )) {
      piers.push({
        x: pier.position.x,
        z: pier.position.z,
        radiusM: CAIRO_ELEVATED_PIER_RADIUS_M,
      });
    }
  }
  return { spans, piers };
}

function rayObstacleDistance(
  origin: GameCanvasPoint,
  direction: GameCanvasPoint,
  obstacles: WaterBoatObstacles | undefined,
): number {
  if (!obstacles) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const span of obstacles.spans) {
    // Slab test in the span's own frame, inflated by the boat clearance.
    const vx = -span.uz;
    const vz = span.ux;
    const halfU = span.halfLengthM + WATER_BOAT_CLEARANCE_M;
    const halfV = span.halfWidthM + WATER_BOAT_CLEARANCE_M;
    const ou = (origin.x - span.x) * span.ux + (origin.z - span.z) * span.uz;
    const ov = (origin.x - span.x) * vx + (origin.z - span.z) * vz;
    const du = direction.x * span.ux + direction.z * span.uz;
    const dv = direction.x * vx + direction.z * vz;
    let enter = -Infinity;
    let exit = Infinity;
    let miss = false;
    for (const [offset, delta, half] of [
      [ou, du, halfU],
      [ov, dv, halfV],
    ] as const) {
      if (Math.abs(delta) < 1e-9) {
        if (Math.abs(offset) > half) miss = true;
        continue;
      }
      const t0 = (-half - offset) / delta;
      const t1 = (half - offset) / delta;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    if (!miss && enter <= exit && exit > 0) {
      nearest = Math.min(nearest, Math.max(0, enter));
    }
  }
  for (const pier of obstacles.piers) {
    const radius = pier.radiusM + WATER_BOAT_CLEARANCE_M;
    const ox = origin.x - pier.x;
    const oz = origin.z - pier.z;
    const b = ox * direction.x + oz * direction.z;
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const tNear = -b - root;
    const tFar = -b + root;
    if (tFar > 0) nearest = Math.min(nearest, Math.max(0, tNear));
  }
  return nearest;
}

/** Stable visual-only Nile traffic; never consumes the simulation PRNG. */
export function generateWaterBoatPlacements(
  mapId: string,
  body: GameCanvasWaterBody,
  obstacles?: WaterBoatObstacles,
): readonly WaterBoatPlacement[] {
  const polygon = buildWaterPolygonGeometry(body.polygon).polygon;
  if (polygon.length < 3) return [];
  const xs = polygon.map((point) => point.x);
  const zs = polygon.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const area = Math.abs(polygonSignedArea(polygon));
  const wanted = Math.max(1, Math.min(5, Math.round(area / 28_000)));
  const random = seededUnit(hashStringToSeed(`${mapId}-${body.id}-boats`));
  const defaultHeadingDeg =
    maxZ - minZ >= maxX - minX ? 0 : 90;
  const placements: WaterBoatPlacement[] = [];
  for (let attempt = 0; attempt < wanted * 32 && placements.length < wanted; attempt += 1) {
    const candidate = {
      x: minX + random() * (maxX - minX),
      z: minZ + random() * (maxZ - minZ),
    };
    if (
      !isPointInPolygon(candidate, polygon) ||
      distanceToPolygonEdges(candidate, polygon) < 7 ||
      placements.some(
        (placement) =>
          Math.hypot(placement.x - candidate.x, placement.z - candidate.z) < 28,
      )
    ) {
      continue;
    }
    const heading =
      ((body.flowHeadingDeg ?? defaultHeadingDeg) * Math.PI) / 180 +
      (random() - 0.5) * 0.22;
    const direction = { x: Math.sin(heading), z: Math.cos(heading) };
    // A candidate already inside an obstacle's clearance can never sail out.
    if (rayObstacleDistance(candidate, direction, obstacles) === 0) continue;
    const forward = Math.min(
      rayDistanceToPolygonEdge(candidate, direction, polygon),
      rayObstacleDistance(candidate, direction, obstacles),
    );
    const reverse = { x: -direction.x, z: -direction.z };
    const backward = Math.min(
      rayDistanceToPolygonEdge(candidate, reverse, polygon),
      rayObstacleDistance(candidate, reverse, obstacles),
    );
    const trackStartM = -(backward - 7);
    const trackLengthM = forward + backward - 14;
    if (
      !Number.isFinite(trackLengthM) ||
      trackLengthM < 24
    ) {
      continue;
    }
    const variant = Math.floor(random() * 3) as 0 | 1 | 2;
    placements.push({
      ...candidate,
      heading,
      variant,
      trackStartM,
      trackLengthM,
      phase: random(),
      // Motor launch, felucca, tour boat: restrained and intentionally
      // different speeds, with only a small stable per-craft variation.
      speedMps: [1.45, 0.72, 1.05][variant] * (0.9 + random() * 0.2),
    });
  }
  return placements;
}

/** Ping-pong pose keeps craft inside their authored channel without teleporting. */
export function waterBoatPoseAt(
  placement: WaterBoatPlacement,
  visualTimeSeconds: number,
): WaterBoatPose {
  const cycleLength = placement.trackLengthM * 2;
  const cycleDistance =
    ((placement.phase * cycleLength +
      Math.max(0, visualTimeSeconds) * placement.speedMps) %
      cycleLength +
      cycleLength) %
    cycleLength;
  const returning = cycleDistance > placement.trackLengthM;
  const trackDistance = returning
    ? cycleLength - cycleDistance
    : cycleDistance;
  const along = placement.trackStartM + trackDistance;
  const directionX = Math.sin(placement.heading);
  const directionZ = Math.cos(placement.heading);
  const wavePhase =
    visualTimeSeconds * (placement.variant === 1 ? 0.74 : 1.12) +
    placement.phase * Math.PI * 2;
  return {
    x: placement.x + directionX * along,
    y: 0.04 + Math.sin(wavePhase) * 0.035,
    z: placement.z + directionZ * along,
    heading: placement.heading + (returning ? Math.PI : 0),
    roll: Math.sin(wavePhase * 0.73 + 0.8) * 0.018,
  };
}

export interface GameCanvasLane {
  readonly id: string;
  readonly roadId?: string;
  readonly widthM?: number;
  readonly centerline: readonly GameCanvasPoint[];
  readonly role?: string;
  readonly trafficSide?: TrafficSide;
  readonly speedLimit?: number;
  readonly localSpeedUnit?: "mph" | "kmh" | "km/h";
  readonly successors?: readonly string[];
  readonly adjacentLaneIds?: readonly string[];
  readonly connectorRanges?: readonly {
    readonly startDistanceAlongM: number;
    readonly endDistanceAlongM: number;
    readonly conflictZoneId?: string;
  }[];
}

/** Connector tapers are navigation-free junction geometry, not lane targets. */
export function isLaneGuidanceDistanceAllowed(
  lane: GameCanvasLane,
  distanceAlongM: number,
): boolean {
  return !(lane.connectorRanges ?? []).some(
    (range) =>
      distanceAlongM >= range.startDistanceAlongM - 0.05 &&
      distanceAlongM <= range.endDistanceAlongM + 0.05,
  );
}

export interface RouteChevronPlacement {
  readonly distanceAlongM: number;
  readonly tip: GameCanvasPoint;
  readonly back: GameCanvasPoint;
  readonly sideX: number;
  readonly sideZ: number;
}

/**
 * Deterministic chevron layout for one route lane. Arrows march every 12 m,
 * skipping junction connectors and compact conflict zones; roundabout rings
 * are exempt from the conflict-zone rule because their priority zone covers
 * the whole circle and would otherwise erase every arrow on the ring. Pure so
 * per-lesson guidance coverage can be asserted in tests.
 */
export function computeRouteChevronPlacements(
  lane: GameCanvasLane,
  conflictZones: GameCanvasMapPack["laneGraph"]["conflictZones"],
): readonly RouteChevronPlacement[] {
  const placements: RouteChevronPlacement[] = [];
  let travelled = 0;
  let nextChevronAt = 7;
  for (let segmentIndex = 0; segmentIndex < lane.centerline.length - 1; segmentIndex += 1) {
    const start = lane.centerline[segmentIndex];
    const end = lane.centerline[segmentIndex + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const ux = dx / length;
    const uz = dz / length;
    while (nextChevronAt <= travelled + length) {
      const along = nextChevronAt - travelled;
      const tip = { x: start.x + ux * along, z: start.z + uz * along };
      const back = { x: tip.x - ux * 1.45, z: tip.z - uz * 1.45 };
      const inConnectorRange = !isLaneGuidanceDistanceAllowed(
        lane,
        nextChevronAt,
      );
      const inConflictZone =
        lane.role !== "roundabout" &&
        conflictZones.some(
          (zone) =>
            zone.laneIds.includes(lane.id) &&
            (isPointInPolygon(tip, zone.polygon) || isPointInPolygon(back, zone.polygon)),
        );
      if (!inConnectorRange && !inConflictZone) {
        placements.push({
          distanceAlongM: nextChevronAt,
          tip,
          back,
          sideX: uz,
          sideZ: -ux,
        });
      }
      nextChevronAt += 12;
    }
    travelled += length;
  }
  return placements;
}

/** Structural map contract; existing MapPack objects can be passed directly. */
export interface GameCanvasMapPack {
  readonly id: string;
  readonly name: string;
  readonly areaLabel?: string;
  /**
   * Host country, for signage that differs by jurisdiction. Not derivable from
   * `speedUnit`: Britain reads in mph and still posts the Vienna disc.
   */
  readonly countryIds?: readonly string[];
  readonly ambientTraffic?: {
    readonly desktop: number;
    readonly touch: number;
  };
  readonly geometry: Readonly<{
    worldSize: GameCanvasPoint;
    roadWidth: number;
    shoulderWidth?: number;
    roadSurfaces?: readonly {
      readonly id: string;
      readonly centerline: readonly GameCanvasPoint[];
      readonly widthM: number;
      readonly sidewalkWidthM?: number;
      readonly laneIds: readonly string[];
      readonly surfaceType:
        | "standard"
        | "roundabout"
        | "shared_space"
        | "terminal"
        | "orientation";
      readonly markings: readonly {
        readonly id: string;
        readonly style:
          | "centre_dashed"
          | "centre_solid"
          | "lane_dashed"
          | "lane_solid"
          | "edge_solid"
          | "give_way"
          | "box_junction";
        readonly points: readonly GameCanvasPoint[];
        readonly color?: "white" | "yellow";
      }[];
    }[];
    blocks: readonly {
      readonly id: string;
      readonly center: GameCanvasPoint;
      readonly size: GameCanvasPoint;
      readonly headingDeg?: number;
      readonly frontageAxis?: "x" | "z";
      readonly streetEdges?: readonly ("+x" | "-x" | "+z" | "-z")[];
      readonly heightRange: readonly [number, number];
      readonly density: number;
      readonly material: string;
      readonly buildingSet?: string;
    }[];
    waterBodies?: readonly {
      readonly id: string;
      readonly polygon: readonly GameCanvasPoint[];
      readonly color: string;
      readonly flowHeadingDeg?: number;
      readonly bridgePortalSurfaceIds?: readonly string[];
    }[];
    landmarks: readonly {
      readonly id: string;
      readonly kind: string;
      readonly center: GameCanvasPoint;
      readonly size: GameCanvasPoint;
      readonly color: string;
      /** Compass heading of the landmark's long axis, clockwise from +z. */
      readonly headingDeg?: number;
    }[];
    // `kind` is the real union rather than `string` (as the neighbouring
    // structural types use), because placement resolves the lot's yaw from it —
    // a widened kind has to reach every consumer, not slip through as a string.
    servicePoints?: readonly {
      readonly id: string;
      readonly kind: ServicePointKind;
      readonly anchor: {
        readonly laneId: string;
        readonly distanceAlongM: number;
      };
      readonly footprint: GameCanvasPoint;
      readonly label: string;
      readonly setbackM?: number;
    }[];
    gigVenues?: readonly {
      readonly id: string;
      readonly kind: string;
      readonly anchor: {
        readonly laneId: string;
        readonly distanceAlongM: number;
      };
      readonly footprint: GameCanvasPoint;
      readonly name: string;
      readonly setbackM?: number;
      readonly modelId?: string;
    }[];
  }>;
  readonly laneGraph: Readonly<{
    lanes: readonly GameCanvasLane[];
    controls: readonly {
      readonly id: string;
      readonly type: string;
      readonly position: GameCanvasPoint;
      readonly headingDeg: number;
      readonly laneIds: readonly string[];
      readonly conflictZoneIds?: readonly string[];
      readonly approaches?: readonly {
        readonly id: string;
        readonly laneIds: readonly string[];
        readonly stopLine: {
          readonly laneId: string;
          readonly distanceAlongM: number;
        };
        readonly conflictZoneIds?: readonly string[];
        readonly phaseGroup: string;
      }[];
      readonly installations?: readonly {
        readonly id: string;
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
        readonly armHeadingDeg?: number;
        /** Exact carriageway span for road markings, when authored. */
        readonly spanM?: number;
        readonly mounting:
          | "roadside_pole"
          | "mast_arm"
          | "secondary_pole"
          | "railway_crossing"
          | "road_marking"
          | "terminal_portal";
        readonly style:
          | "nyc_signal"
          | "uk_signal"
          | "egypt_signal"
          | "stop_sign"
          | "yield_sign"
          | "restricted_lane"
          | "crosswalk"
          | "box_junction"
          | "japan_railway"
          | "side_swap_gate";
        readonly role: "primary" | "secondary" | "companion" | "warning" | "marking";
        readonly approachIds?: readonly string[];
      }[];
    }[];
    conflictZones: readonly {
      readonly id: string;
      readonly laneIds: readonly string[];
      readonly polygon: readonly GameCanvasPoint[];
    }[];
    restrictions?: readonly {
      readonly id: string;
      readonly laneId: string;
      readonly ruleCode: "restricted_lane";
      readonly activeWindows: readonly {
        readonly weekdays: readonly (
          | "mon"
          | "tue"
          | "wed"
          | "thu"
          | "fri"
          | "sat"
          | "sun"
        )[];
        readonly startMinutes: number;
        readonly endMinutes: number;
      }[];
      readonly sourceReferenceId: string;
      readonly message: string;
    }[];
    spawnPoints: readonly (
      | {
          readonly id: string;
          readonly kind: "player" | "vehicle";
          readonly anchor: {
            readonly laneId: string;
            readonly distanceAlongM: number;
          };
          /** Legacy map compatibility during the v1 map migration. */
          readonly pose?: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
        }
      | {
          readonly id: string;
          readonly kind: "pedestrian" | "cyclist";
          readonly pose: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
          readonly anchor?: never;
        }
      | {
          readonly id: string;
          readonly kind: "player" | "vehicle";
          readonly pose: {
            readonly position: GameCanvasPoint;
            readonly headingDeg: number;
          };
          readonly laneId?: string;
          readonly anchor?: never;
        }
    )[];
    checkpoints: readonly {
      readonly id: string;
      readonly label: string;
      readonly anchor?: {
        readonly laneId: string;
        readonly distanceAlongM: number;
      };
      readonly pose?: {
        readonly position: GameCanvasPoint;
        readonly headingDeg: number;
      };
      readonly laneId?: string;
    }[];
  }>;
}

export interface CairoBridgeVisualAxis {
  readonly center: GameCanvasPoint;
  readonly lengthM: number;
  readonly widthM: number;
  /** Compass direction along the long axis, clockwise from +z. */
  readonly headingRad: number;
  /** Babylon yaw when the mesh's long dimension is local +x. */
  readonly boxYawRad: number;
}

/**
 * Keeps scenic parapets on the same axis as the road portal. A same-id road
 * surface is authoritative; authored heading covers visual-only structures
 * such as the elevated expressway, which deliberately has no road.
 */
export function cairoBridgeVisualAxis(
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): CairoBridgeVisualAxis {
  const surface = roadSurfaces.find((candidate) => candidate.id === landmark.id);
  const surfaceStart = surface?.centerline[0];
  const surfaceEnd = surface?.centerline.at(-1);
  const surfaceHeading =
    surfaceStart && surfaceEnd
      ? Math.atan2(
          surfaceEnd.x - surfaceStart.x,
          surfaceEnd.z - surfaceStart.z,
        )
      : undefined;
  const longX = landmark.size.x >= landmark.size.z;
  const headingRad =
    surfaceHeading ??
    (landmark.headingDeg !== undefined
      ? degreesToRadians(landmark.headingDeg)
      : longX
        ? Math.PI / 2
        : 0);
  return {
    center: landmark.center,
    lengthM: Math.max(landmark.size.x, landmark.size.z),
    widthM: Math.min(landmark.size.x, landmark.size.z),
    headingRad,
    boxYawRad: headingRad - Math.PI / 2,
  };
}

/**
 * Restricts a drivable bridge's decorative rails to its over-water deck.
 * Bridge road surfaces continue to the neighbouring junction nodes, but rails
 * must stop at the shore instead of crossing the shoreline carriageways.
 */
export function cairoBridgePortalVisualAxis(
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
  waterBodies: NonNullable<GameCanvasMapPack["geometry"]["waterBodies"]>,
): CairoBridgeVisualAxis {
  const fallback = cairoBridgeVisualAxis(landmark, roadSurfaces);
  const surface = roadSurfaces.find((candidate) => candidate.id === landmark.id);
  const water = waterBodies.find((candidate) =>
    candidate.bridgePortalSurfaceIds?.includes(landmark.id),
  );
  const segmentStart = surface?.centerline[0];
  const segmentEnd = surface?.centerline.at(-1);
  if (!surface || !water || !segmentStart || !segmentEnd) return fallback;

  const longest = bridgePortalRailSpans(water, surface).reduce<
    ReturnType<typeof bridgePortalRailSpans>[number] | undefined
  >(
    (current, candidate) =>
      !current || candidate.halfLengthM > current.halfLengthM
        ? candidate
        : current,
    undefined,
  );
  if (!longest || longest.halfLengthM < 0.5) return fallback;

  const headingRad = Math.atan2(longest.ux, longest.uz);
  const sidewalkWidthM = Math.max(0, surface.sidewalkWidthM ?? 0);
  return {
    center: longest.center,
    lengthM: longest.halfLengthM * 2,
    widthM:
      surface.widthM +
      2 * (sidewalkWidthM + BRIDGE_PARAPET_PAVEMENT_CLEARANCE_M),
    headingRad,
    boxYawRad: headingRad - Math.PI / 2,
  };
}

export interface CairoElevatedPierPlacement {
  readonly index: number;
  readonly alongM: number;
  readonly position: GameCanvasPoint;
}

/**
 * Uniform elevated-bridge supports with deterministic omissions wherever a
 * column would stand in an authored carriageway.
 */
export function cairoElevatedBridgePierPlacements(
  axis: CairoBridgeVisualAxis,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): readonly CairoElevatedPierPlacement[] {
  const pierCount = Math.max(5, Math.floor(axis.lengthM / 46));
  const directionX = Math.sin(axis.headingRad);
  const directionZ = Math.cos(axis.headingRad);
  const columnClearanceM = 1.15;
  const placements: CairoElevatedPierPlacement[] = [];
  for (let index = 0; index <= pierCount; index += 1) {
    const alongM = -axis.lengthM / 2 + (index / pierCount) * axis.lengthM;
    const position = {
      x: axis.center.x + directionX * alongM,
      z: axis.center.z + directionZ * alongM,
    };
    const blocksRoad = roadSurfaces.some((surface) => {
      const nearest = nearestPointOnPolyline(position, surface.centerline);
      return (
        Math.hypot(position.x - nearest.x, position.z - nearest.z) <
        surface.widthM / 2 + columnClearanceM
      );
    });
    if (!blocksRoad) placements.push({ index, alongM, position });
  }
  return placements;
}

export interface CairoTahrirFurnitureLayout {
  readonly olives: readonly GameCanvasPoint[];
  readonly benches: readonly (GameCanvasPoint & {
    readonly rotationY: number;
  })[];
}

/**
 * Cairo's bilingual direction panel is printed on one side only, like the real
 * thing — the back of a road sign is bare aluminium.
 *
 * This has to be done per face, not on the material. Rotating the whole texture
 * 180° does land the legend upright on the road-facing face, but Babylon's two
 * broad box faces already differ by 180°, so the same transform lands the
 * legend on the *back* upside down — which is exactly what it used to do.
 *
 * So: the design occupies the top half of the canvas and the bottom half stays
 * aluminium; face 0 (+Z, the road-facing side under the face-road yaw
 * convention) takes the design pre-swapped, and the other five sample a small
 * patch well inside the aluminium half, far enough from the boundary that
 * mipmap bleed cannot drag the legend onto an edge.
 */
export const CAIRO_DIRECTION_PANEL_DESIGN_V = 0.5;

export function cairoDirectionPanelFaceUv(): readonly Vector4[] {
  // Swapped min/max corner = the region applied 180° round, cancelling the
  // rotation Babylon's +Z face applies. See the regulatory blade's `swapped`.
  const printed = new Vector4(1, 1, 0, CAIRO_DIRECTION_PANEL_DESIGN_V);
  const bare = new Vector4(0.4, 0.1, 0.6, 0.3);
  return [printed, bare, bare, bare, bare, bare];
}

/**
 * True when any part of the segment a→b lies strictly inside the rectangle —
 * a Liang–Barsky interval test. Grazing a corner or running along an edge
 * does not count: a road that merely touches a park's boundary has nothing
 * of the park on its far side, so clipping against it would only shave the
 * lawn for no visible reason.
 */
function segmentCrossesRect(
  a: GameCanvasPoint,
  b: GameCanvasPoint,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let enter = 0;
  let exit = 1;
  const bounds: readonly (readonly [number, number])[] = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dz, a.z - minZ],
    [dz, maxZ - a.z],
  ];
  for (const [towards, clearance] of bounds) {
    if (Math.abs(towards) <= 1e-9) {
      if (clearance < 0) return false;
      continue;
    }
    const at = clearance / towards;
    if (towards < 0) {
      if (at > exit) return false;
      if (at > enter) enter = at;
    } else {
      if (at < enter) return false;
      if (at < exit) exit = at;
    }
  }
  return exit - enter > 1e-9;
}

/** Sutherland–Hodgman against one line: keeps the side `anchor` is on. */
function clipPolygonToLineSide(
  polygon: readonly GameCanvasPoint[],
  a: GameCanvasPoint,
  b: GameCanvasPoint,
  anchor: GameCanvasPoint,
): GameCanvasPoint[] {
  const side = (point: GameCanvasPoint) =>
    (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
  const anchorSide = side(anchor);
  // The anchor sitting on the line itself means there is no meaningful
  // "anchor's side" — leave the polygon alone rather than guess.
  if (Math.abs(anchorSide) <= 1e-6) return [...polygon];
  const orient = anchorSide > 0 ? 1 : -1;
  const clipped: GameCanvasPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentSide = side(current) * orient;
    const nextSide = side(next) * orient;
    if (currentSide >= -1e-9) clipped.push(current);
    if (
      (currentSide > 1e-9 && nextSide < -1e-9) ||
      (currentSide < -1e-9 && nextSide > 1e-9)
    ) {
      const amount = currentSide / (currentSide - nextSide);
      clipped.push({
        x: current.x + (next.x - current.x) * amount,
        z: current.z + (next.z - current.z) * amount,
      });
    }
  }
  return clipped;
}

/**
 * Where Tahrir's lawn tucks out under Qasr El-Ainy's pavement band. The kerb
 * face runs x 325.1→322.9 along the park, the band outer edge 328.5→326.3,
 * so 324.5 is under the band for most of the run and under the asphalt at
 * the far south — painted over either way. `tests/cairoVisuals.test.ts`
 * re-derives both bounds from the road data and pins the tuck.
 */
export const CAIRO_TAHRIR_LAWN_WEST_TUCK_X = 324.5;
/**
 * ...and out under Qasr El-Nil's band to the south, whose outer edge runs
 * z -93.3→-92.0 across the lawn's reachable span west of Ramses.
 */
export const CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z = -94;
/**
 * ...and out under Ramses' band to the east. The rect edge at x 391 left a
 * bare triangle against the diagonal band north of the centreline cut —
 * Ramses' band-west edge climbs from x 391 (z -6.5) to 401.6 (z 6) while
 * the rect edge stands still. 402 sits past the band edge over that whole
 * span, and above z 5.7 the ministries esplanade takes over.
 */
export const CAIRO_TAHRIR_LAWN_EAST_TUCK_X = 402;

/**
 * The lawn Tahrir actually shows: the authored rectangle, tucked out under
 * its west, south and east pavement bands, then cut back to the park-centre
 * side of every road segment that crosses it.
 *
 * Both moves exist because Cairo's base ground is paved grey and any ground
 * the lawn, band and asphalt leave uncovered reads as a bare strip. The
 * lawn draws below both the carriageway and the pavement band
 * (`PARK_LAWN_Y` under `ROAD_SHOULDER_Y` under `ROAD_SURFACE_Y`), so:
 *
 * - The tucked edges are painted over and the visible grass seam lands
 *   exactly on each band's outer edge — flush, with no sliver for strip
 *   mitres or junction fans to expose. (Authoring the tuck into the rect
 *   itself would instead drag the park's 18 m roadside-parcel exclusion
 *   across Qasr El-Ainy and demolish the street wall facing the park.)
 * - Ramses is authored straight through the rectangle, and a rectangle
 *   cannot hug a diagonal — rendered raw, its far corner surfaced as a
 *   grass triangle on the opposite curbside. The cut runs along the
 *   *centreline*, not the kerb: grass up to the centreline is painted over,
 *   nothing shows past it.
 */
export function cairoTahrirLawnPolygon(
  landmark: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  const minX = Math.min(
    landmark.center.x - landmark.size.x / 2,
    CAIRO_TAHRIR_LAWN_WEST_TUCK_X,
  );
  const maxX = Math.max(
    landmark.center.x + landmark.size.x / 2,
    CAIRO_TAHRIR_LAWN_EAST_TUCK_X,
  );
  const minZ = Math.min(
    landmark.center.z - landmark.size.z / 2,
    CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z,
  );
  const maxZ = landmark.center.z + landmark.size.z / 2;
  return clipRectToRoadSide(
    minX,
    maxX,
    minZ,
    maxZ,
    landmark.center,
    roadSurfaces,
  );
}

/**
 * The lawn of a `ROAD_DIVIDED_PARK_IDS` park: the authored rectangle cut back
 * to the park-centre side of every road segment crossing it — Tahrir's clip
 * without Tahrir's band tucks, for parks whose other edges no road grazes.
 * Rendered raw, the Opera Grounds' rectangle surfaced as a grass wedge on the
 * far kerbside of the corridor authored through it.
 */
export function roadSideParkLawnPolygon(
  landmark: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  return clipRectToRoadSide(
    landmark.center.x - landmark.size.x / 2,
    landmark.center.x + landmark.size.x / 2,
    landmark.center.z - landmark.size.z / 2,
    landmark.center.z + landmark.size.z / 2,
    landmark.center,
    roadSurfaces,
  );
}

/**
 * The paved terrace between the opera house's garden colonnade and the
 * formal garden. The building's north 12 m stand inside the park rect, so
 * the paving must run from under its face (x inset 2 m from each flank)
 * north past the rect line to `CAIRO_OPERA_TERRACE_NORTH_Z`, where the
 * garden's axis walk laps it by half a metre. Clipped to the opera house's
 * side of any crossing road — a no-op against today's corridor, but a road
 * nudge fails the seam test instead of paving the far kerbside.
 */
export function cairoOperaTerracePolygon(
  operaHouse: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  return clipRectToRoadSide(
    operaHouse.center.x - operaHouse.size.x / 2 - 2,
    operaHouse.center.x + operaHouse.size.x / 2 + 2,
    // 12 m south of the building's north face — the park's own south line,
    // so the paving covers exactly the strip the building borrows from it.
    operaHouse.center.z + operaHouse.size.z / 2 - 12,
    CAIRO_OPERA_TERRACE_NORTH_Z,
    operaHouse.center,
    roadSurfaces,
  );
}

/**
 * A rect cut back to `anchor`'s side of every road-centreline segment that
 * crosses it. The shared core of Tahrir's lawn and forecourt polygons, the
 * road-divided park lawns and the opera parterre quadrants: all lean on the
 * same fact — the surface drawn from the result sits below the carriageway
 * and the pavement band, so running the rect out to a road's centreline
 * paints a seam exactly on the band's outer edge.
 */
export function clipRectToRoadSide(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  anchor: GameCanvasPoint,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  let polygon: GameCanvasPoint[] = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
  for (const surface of roadSurfaces) {
    for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
      const start = surface.centerline[index];
      const end = surface.centerline[index + 1];
      if (Math.hypot(end.x - start.x, end.z - start.z) <= 1e-6) continue;
      if (!segmentCrossesRect(start, end, minX, maxX, minZ, maxZ)) continue;
      polygon = clipPolygonToLineSide(polygon, start, end, anchor);
      if (polygon.length < 3) return polygon;
    }
  }
  return polygon;
}

/**
 * How far the ministries' esplanade laps over the park lawn's north edge.
 * The two surfaces sit 11 mm apart in y, so an exactly-shared edge would let
 * a glancing camera see the grey base ground through the parallax gap; a
 * hand's width of overlap closes it, and at that size the paving edge reads
 * as kissing the grass, not covering it.
 */
export const CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M = 0.3;

/**
 * The paved esplanade between Tahrir's lawn and the ministries frontage —
 * the whole pocket, not a floating slab-front apron. Cairo's base ground is
 * paved grey, and every edge of this polygon lands on a real boundary so no
 * grey can show and no paving edge floats in open ground:
 *
 * - south: the park lawn's north edge (plus a small lap, above), so grass
 *   meets paving the way it meets the sidewalks;
 * - west: the same in-band tuck line as the lawn — Qasr El-Ainy's pavement
 *   covers the edge and the visible seam is the band's outer edge;
 * - north: under the ministries and frontage buildings;
 * - east: run generously past Ramses and cut back to its centreline by
 *   `clipRectToRoadSide`, exactly like the lawn.
 */
export function cairoTahrirForecourtPolygon(
  ministries: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  parkNorthEdgeZ: number,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  // Past Ramses' centreline at every z the esplanade spans; the clip owns
  // the real east boundary.
  const eastSeedX = 436;
  return clipRectToRoadSide(
    CAIRO_TAHRIR_LAWN_WEST_TUCK_X,
    eastSeedX,
    parkNorthEdgeZ - CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M,
    ministries.center.z + ministries.size.z / 2,
    ministries.center,
    roadSurfaces,
  );
}

/** Benches sit ON the paving disc, facing the obelisk at its centre... */
export const CAIRO_TAHRIR_BENCH_RING_M = 9;
/** ...and the olives stand on the grass just outside it. */
export const CAIRO_TAHRIR_OLIVE_RING_M = 16.5;

/**
 * Keeps Tahrir's visual-only furniture ringed around the plaza, clear of
 * traffic. `plazaCenter` is the `cairo-tahrir-obelisk` landmark's centre —
 * the obelisk, the paved disc and both furniture rings share it, so the
 * whole ensemble moves as one when the landmark is re-authored.
 *
 * `roadClear` demands the pavement band too, not just the carriageway: a
 * bench standing on the kerbside pavement reads as street clutter, not park
 * furniture. The rings are authored to clear every band outright
 * (`tests/cairoVisuals.test.ts` pins it); `settle()` stays as the safety
 * net for future road edits, walking a placement toward the plaza centre
 * until it clears.
 */
export function cairoTahrirFurnitureLayout(
  plazaCenter: GameCanvasPoint,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): CairoTahrirFurnitureLayout {
  const roadClear = (point: GameCanvasPoint, radiusM: number) =>
    roadSurfaces.every((surface) => {
      const nearest = nearestPointOnPolyline(point, surface.centerline);
      return (
        Math.hypot(point.x - nearest.x, point.z - nearest.z) >=
        surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + radiusM + 1
      );
    });
  const settle = (
    candidate: GameCanvasPoint,
    radiusM: number,
  ): GameCanvasPoint => {
    for (let step = 0; step <= 24; step += 1) {
      const amount = step / 24;
      const point = {
        x: candidate.x + (plazaCenter.x - candidate.x) * amount,
        z: candidate.z + (plazaCenter.z - candidate.z) * amount,
      };
      if (roadClear(point, radiusM)) return point;
    }
    return plazaCenter;
  };
  return {
    olives: Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return settle(
        {
          x: plazaCenter.x + Math.sin(angle) * CAIRO_TAHRIR_OLIVE_RING_M,
          z: plazaCenter.z + Math.cos(angle) * CAIRO_TAHRIR_OLIVE_RING_M,
        },
        1.9,
      );
    }),
    benches: Array.from({ length: 6 }, (_, index) => {
      const rotationY = (index / 6) * Math.PI * 2;
      return {
        ...settle(
          {
            x: plazaCenter.x + Math.sin(rotationY) * CAIRO_TAHRIR_BENCH_RING_M,
            z: plazaCenter.z + Math.cos(rotationY) * CAIRO_TAHRIR_BENCH_RING_M,
          },
          1.5,
        ),
        rotationY,
      };
    }),
  };
}

export interface CrosswalkStripeLayout {
  readonly center: GameCanvasPoint;
  readonly widthM: number;
  readonly depthM: number;
  readonly rotationY: number;
}

/** Zebra stripes progress with traffic; each long bar spans across traffic. */
export function crosswalkStripeLayout(
  position: GameCanvasPoint,
  headingDeg: number,
  roadWidthM: number,
): readonly CrosswalkStripeLayout[] {
  const heading = degreesToRadians(headingDeg);
  const travelX = Math.sin(heading);
  const travelZ = Math.cos(heading);
  return Array.from({ length: 7 }, (_, index) => {
    const stripe = index - 3;
    return {
      center: {
        x: position.x + travelX * stripe * 1.05,
        z: position.z + travelZ * stripe * 1.05,
      },
      // A box's local +x maps to (cos yaw, -sin yaw): perpendicular to the
      // travel vector above when yaw equals the compass heading.
      widthM: roadWidthM * 0.82,
      depthM: 0.62,
      rotationY: heading,
    };
  });
}

/** The black lamp housing every authored signal head is built around. */
export const SIGNAL_HOUSING_BOX = {
  width: 0.58,
  height: 1.48,
  depth: 0.42,
} as const;

export interface SignalBorderBar {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Cairo's yellow surround, as four bars around the face rather than one box.
 *
 * It used to be a single 0.7 x 1.6 x 0.44 box at z +0.015 — larger than the
 * housing in **all three** dimensions, so it enclosed the head completely and
 * the entire black-face-with-a-yellow-border look rested on the housing's front
 * face protruding 5 mm. Depth precision at any distance beats 5 mm, so the
 * yellow swallowed the head: a solid amber slab that flickered as you drove and
 * only settled once you were stopped at the bar.
 *
 * These bars sit strictly *outside* the housing footprint, so no two surfaces
 * ever contend for the same pixel and there is no epsilon left to lose. They
 * meet the housing edge-on at x ±0.29 / y ±0.74; touching faces point away from
 * each other, which is ordinary adjacency, not overlap.
 */
export const EGYPT_SIGNAL_BORDER_BARS: readonly SignalBorderBar[] = (() => {
  const thickness = 0.06;
  const halfWidth = SIGNAL_HOUSING_BOX.width / 2;
  const halfHeight = SIGNAL_HOUSING_BOX.height / 2;
  // Proud of the black face (-0.21) but behind the lens plane (-0.25), so the
  // border reads as a bezel without touching either.
  const z = -0.19;
  const depth = 0.08;
  return [
    {
      id: "left",
      x: -(halfWidth + thickness / 2),
      y: 0,
      z,
      width: thickness,
      height: SIGNAL_HOUSING_BOX.height + thickness * 2,
      depth,
    },
    {
      id: "right",
      x: halfWidth + thickness / 2,
      y: 0,
      z,
      width: thickness,
      height: SIGNAL_HOUSING_BOX.height + thickness * 2,
      depth,
    },
    {
      id: "top",
      x: 0,
      y: halfHeight + thickness / 2,
      z,
      width: SIGNAL_HOUSING_BOX.width,
      height: thickness,
      depth,
    },
    {
      id: "bottom",
      x: 0,
      y: -(halfHeight + thickness / 2),
      z,
      width: SIGNAL_HOUSING_BOX.width,
      height: thickness,
      depth,
    },
  ];
})();

export function roadSurfaceWidthForMarking(
  mapPack: GameCanvasMapPack,
  control: GameCanvasMapPack["laneGraph"]["controls"][number],
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
): number {
  return roadSurfacePlacementForMarking(
    mapPack,
    control,
    installation,
  ).widthM;
}

export interface RoadSurfaceMarkingPlacement {
  readonly position: GameCanvasPoint;
  readonly widthM: number;
  readonly surfaceId?: string;
}

export function roadSurfacePlacementForMarking(
  mapPack: GameCanvasMapPack,
  control: GameCanvasMapPack["laneGraph"]["controls"][number],
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
): RoadSurfaceMarkingPlacement {
  const allowedApproaches = new Set(installation.approachIds ?? []);
  const candidates = (control.approaches ?? [])
    .filter(
      (approach) =>
        allowedApproaches.size === 0 || allowedApproaches.has(approach.id),
    )
    .flatMap((approach) =>
      approach.laneIds.flatMap((laneId) => {
        const lane = mapPack.laneGraph.lanes.find(
          (candidate) => candidate.id === laneId,
        );
        if (!lane || lane.centerline.length < 2) return [];
        const start = lane.centerline[lane.centerline.length - 2];
        const end = lane.centerline[lane.centerline.length - 1];
        const laneHeading = Math.atan2(end.x - start.x, end.z - start.z);
        const target = degreesToRadians(installation.headingDeg);
        const delta = Math.abs(
          Math.atan2(Math.sin(laneHeading - target), Math.cos(laneHeading - target)),
        );
        return [{ lane, delta }];
      }),
    )
    .sort((a, b) => a.delta - b.delta);
  const lane = candidates[0]?.lane;
  const surface = mapPack.geometry.roadSurfaces?.find(
    (candidate) =>
      candidate.id === lane?.roadId ||
      (lane ? candidate.laneIds.includes(lane.id) : false),
  );
  return {
    position: surface
      ? nearestPointOnPolyline(installation.position, surface.centerline)
      : installation.position,
    widthM:
      installation.spanM ?? surface?.widthM ?? mapPack.geometry.roadWidth,
    surfaceId: surface?.id,
  };
}


export interface PlayerVehicleOption {
  readonly model: VehicleModel | null;
  readonly visualKind: "car" | "bicycle" | "motorbike";
  readonly paintHex?: string;
}

export type PlayerVehiclePhysics = Pick<
  SimulationCoreConfig,
  | "maxForwardSpeedMps"
  | "maxReverseSpeedMps"
  | "forwardAccelMps2"
  | "reverseAccelMps2"
  | "brakeBaseMps2"
  | "brakeStrengthMps2"
  | "dragBaseMps2"
  | "dragPerMps"
  | "steerBaseRate"
  | "steerAuthorityRate"
  | "steerAuthoritySpeedMps"
  | "instabilityLateralMps2"
  | "playerRadiusM"
  | "playerCapsuleHalfLengthM"
  | "playerCapsuleRadiusM"
>;

/** Third-person follow framing per player vehicle; the default is the values
 * the chase camera has always used for the car. */
interface ChaseTuning {
  readonly backM: number;
  readonly upM: number;
  readonly targetAheadM: number;
}

const DEFAULT_CHASE_TUNING: ChaseTuning = {
  backM: 10.5,
  upM: 5.5,
  targetAheadM: 3.5,
};

const CHASE_TUNING_BY_MODEL: Partial<Record<VehicleModel, ChaseTuning>> = {
  // The van's tall box fills the default frame; pull back and up a touch.
  "delivery-van": { backM: 11.6, upM: 6.2, targetAheadM: 3.5 },
  // The sports car sits low; tighten the frame slightly.
  "sport-sedan": { backM: 9.8, upM: 5, targetAheadM: 3.8 },
};

export interface GameCanvasProps {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  /** Selected authored lesson. Pass the domain LessonDefinition directly. */
  lesson?: GameCanvasLesson;
  /** Selected authored map. Pass the domain MapPack directly. */
  mapPack?: GameCanvasMapPack;
  cameraMode?: CameraMode;
  speedUnit?: SpeedUnit;
  paused?: boolean;
  reducedMotion?: boolean;
  steeringSensitivity?: number;
  fieldOfView?: number;
  masterVolume?: number;
  effectsVolume?: number;
  cameraShake?: boolean;
  headBob?: boolean;
  /** When true (out of fuel), the throttle is held at zero. */
  outOfFuel?: boolean;
  /** Car condition 0..100 (app-owned damage state); drives the hood smoke. */
  carConditionPct?: number;
  /** Bump to snap the car back to its spawn (the tow-and-repair flow). */
  resetNonce?: number;
  /** Venue id where a passenger is waiting to be collected, else null. */
  riderVenueId?: string | null;
  /** Stop the active gig is currently heading for, else null. */
  gigStopId?: string | null;
  /** True once the parcel/rider is aboard, so the marker reads as a drop-off. */
  gigStopCarrying?: boolean;
  /** Interaction cutscene to play; controls lock until its `done` event. */
  cutscene?: CutsceneRequest | null;
  /**
   * The vehicle the player takes out (career). Constructor-only: changing it
   * requires a remount (the career key includes the vehicle id). Omitted =
   * the free-drive flagship. A null model means the composed bicycle rig
   * (playable in a later phase).
   */
  playerVehicle?: PlayerVehicleOption | null;
  /** Per-vehicle physics spread over the adapter's sim config. Constructor-only. */
  vehiclePhysics?: PlayerVehiclePhysics | null;
  className?: string;
  style?: CSSProperties;
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  /** Called when the player chooses Exit from the pause dialog. */
  onExit?: () => void;
  onComplete?: (score: SimulationScoreSnapshot) => void;
}

export interface GameCanvasHandle {
  reset: () => void;
  toggleCamera: () => void;
  togglePause: () => void;
  horn: () => void;
  setIndicator: (indicator: TurnIndicator) => void;
  focus: () => void;
}

/** 0..1, monotonically non-decreasing over one load — see LOAD_PHASE_WEIGHTS. */
interface LoadProgress {
  readonly fraction: number;
  readonly label: string;
}

interface SessionCallbacks {
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  onInputPresentationChange?: (presentation: AdaptiveInputPresentation) => void;
  onComplete?: (score: SimulationScoreSnapshot) => void;
  onReady?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onLoadProgress?: (progress: LoadProgress) => void;
}

interface SessionOptions {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  cameraMode: CameraMode;
  inputCapabilities: InputCapabilities;
  speedUnit: SpeedUnit;
  paused: boolean;
  reducedMotion: boolean;
  steeringSensitivity: number;
  fieldOfView: number;
  masterVolume: number;
  effectsVolume: number;
  cameraShake: boolean;
  headBob: boolean;
  outOfFuel: boolean;
  carConditionPct: number;
  riderVenueId: string | null;
  gigStopId: string | null;
  gigStopCarrying: boolean;
  cutscene: CutsceneRequest | null;
  playerVehicle: PlayerVehicleOption | null;
  vehiclePhysics: PlayerVehiclePhysics | null;
  lesson?: GameCanvasLesson;
  mapPack?: GameCanvasMapPack;
}

interface AnalogInput {
  throttle: number;
  brake: number;
  /** "Go backwards" — brakes a car still rolling forwards, reverses once stopped. */
  reverse: number;
  steer: number;
  quickLook: number;
}

/**
 * The input with the largest magnitude, ties to the earlier argument —
 * reduce-with-rest-args semantics without the per-call array. A value only
 * wins against zero by strictly exceeding it.
 */
function strongestOfThree(first: number, second: number, third: number): number {
  let best = 0;
  if (Math.abs(first) > Math.abs(best)) best = first;
  if (Math.abs(second) > Math.abs(best)) best = second;
  if (Math.abs(third) > Math.abs(best)) best = third;
  return best;
}

/** Driving input while a cutscene owns the car: everything at rest. */
const CUTSCENE_LOCKED_INPUT: Readonly<AnalogInput> = Object.freeze({
  throttle: 0,
  brake: 0,
  reverse: 0,
  steer: 0,
  quickLook: 0,
});

/** Execution state of the interaction cutscene being performed. */
interface ActiveCutscene {
  readonly nonce: number;
  readonly kind: CutsceneKind;
  readonly script: readonly CutsceneStep[];
  stepIndex: number;
  stepElapsed: number;
  stepStarted: boolean;
  /** Cumulative polyline lengths for the current walk/run step. */
  segmentLengths: number[];
  segmentTotal: number;
  readonly actorNode: TransformNode;
  readonly actorVisual: ActorVisual | null;
  /** The staged wide shot, framing the car and the farthest scene point. */
  readonly cameraPosition: Vector3;
  readonly cameraTarget: Vector3;
  /** The plane the actor's feet walk on (forecourt slab vs walker plane). */
  readonly groundY: number;
  /** The waiting rider was hidden for a boarding scene (restored on cancel). */
  riderWasHidden: boolean;
  /** The player's own bike rider was hidden for a dismount (restored on cancel). */
  playerRiderHidden: boolean;
  pumpEmitted: boolean;
  repairEmitted: boolean;
  /**
   * The traffic stop's second car: a scene-owned patrol rig rather than the
   * ambient patrol that clocked you, because that one is still being driven by
   * the simulation and would not hold a mark. The ambient one is hidden by id
   * for the scene's duration (see `hiddenNpcSimulationId`) so there is never a
   * pair of them on screen.
   */
  readonly patrolNode: TransformNode | null;
  readonly patrolVisual: VehicleMeshVisual | null;
  citeEmitted: boolean;
  /** Seconds since the scene began, driving the patrol's light bar. */
  elapsedSeconds: number;
}

/**
 * The world's solids restated as things a staged camera must not look through.
 *
 * Two filters, both to keep the ranking honest rather than to save work. Only
 * `building`, `venue` and `landmark` count — a shoreline, a park's kerb or the
 * world edge stops a car and blocks nothing you can see over. And only the
 * boxes: `circle` obstacles are a park's masonry, a monument plinth or a stone
 * lantern, none of which is tall enough to hide a scene, and treating them as
 * blockers would push the camera off good angles for knee-high stone.
 *
 * What is left is the geometry that actually ruins a shot — buildings, venue
 * lots, and the station boxes that carry the pump islands and canopy pillars.
 */
const STAGED_BLOCKER_TAGS: ReadonlySet<StaticObstacleTag> = new Set([
  "building",
  "landmark",
  "venue",
]);

/** How far past a roof's edge a scene still counts as under it — see
 * `coverOverScene`. Roughly the walk between a car and the pump it is drawn up
 * at, which is the span such a scene straddles the edge by. */
const COVER_REACH_M = 3;

export function stagedBlockersOf(
  obstacles: readonly StaticObstacle[],
): readonly StagedBlocker[] {
  const blockers: StagedBlocker[] = [];
  for (const obstacle of obstacles) {
    if (!STAGED_BLOCKER_TAGS.has(obstacle.tag)) continue;
    if (obstacle.kind === "obb") {
      blockers.push(obstacle);
    } else if (obstacle.kind === "aabb") {
      blockers.push({
        x: (obstacle.minX + obstacle.maxX) / 2,
        z: (obstacle.minZ + obstacle.maxZ) / 2,
        ux: 1,
        uz: 0,
        halfU: (obstacle.maxX - obstacle.minX) / 2,
        halfV: (obstacle.maxZ - obstacle.minZ) / 2,
      });
    }
  }
  return blockers;
}

/** The player avatar every cutscene stages: one consistent driver. Index 1 is
 * person-b — a casual short-sleeve tee, not a suit — in both the cyclist
 * roster (CYCLIST_RIDER_MODELS) and the actor roster (CHARACTER_MODELS), which
 * agree at index 1; keep them aligned if either list is reordered. A courier
 * kept out of formalwear: soft sage-green tee up top, denim below. */
const DRIVER_ACTOR_VARIANT = 1;
const DRIVER_ACTOR_COLORS: CharacterColors = {
  clothing: new Color3(0.48, 0.68, 0.44), // soft sage-green tee
  pants: new Color3(0.2, 0.24, 0.37), // denim jeans
  complexion: new Color3(0.72, 0.53, 0.4),
  hair: new Color3(0.16, 0.12, 0.09),
};

/** Matches the waiting-rider tint so the boarding actor is the same person. */
const RIDER_CLOTHING_TINT = new Color3(0.92, 0.55, 0.2);

/** How deep and how long the suspension dips when somebody gets in or out. */
const CUTSCENE_DIP_SECONDS = 0.42;
const CUTSCENE_DIP_DEPTH_M = 0.05;

/** Characters stand on the walker plane of the y-stack (matches the ambient
 * crowd's WALKER_Y and the scenario pedestrians), not on y=0 — the road tops
 * out at 0.07, so feet placed at zero read as buried to the ankles. */
const ACTOR_WALK_Y = 0.08;
/** The gas station's forecourt slab tops out at ~0.095 (measured world AABB
 * of the placed model), so the refuel scene walks a touch higher still. */
const FORECOURT_WALK_Y = 0.1;

/**
 * The ground plane each scene's actor walks on, where it is not the road.
 *
 * A lookup rather than the ternary this started as, so a scene added without a
 * thought about what it stands on gets the road rather than the gas station's
 * slab. The repair shop's bay floor tops out at 0.07 — flush with the road, so
 * it wants no entry at all.
 */
const CUTSCENE_GROUND_Y: Partial<Record<CutsceneKind, number>> = {
  refuel: FORECOURT_WALK_Y,
};

/**
 * What the scene reports on its way out, per kind.
 *
 * A full `Record` rather than the ternary chain this was, so adding a kind is a
 * compile error here instead of silently inheriting whichever branch happened
 * to be last ("Order delivered.", as it went).
 */
const CUTSCENE_DONE_MESSAGE: Record<CutsceneKind, string> = {
  refuel: "Tank filled; back behind the wheel.",
  roadside_refuel: "Tank filled; back behind the wheel.",
  repair: "Repaired; back on the road.",
  board: "Rider aboard.",
  exit: "Rider dropped off.",
  pullover: "Ticket written; you're free to go.",
  food_pickup: "Order collected.",
  food_dropoff: "Order delivered.",
};

/** How far inside the pavement a street address's "front door" sits. */
const STREET_DOOR_INSET_M = 3.2;

/** How far off a carriageway centreline the traffic stop will still measure its
 * kerb from that road. Beyond it (a car deep in a car park or on the grass) the
 * stop parks heading-relative instead of dragging the car back to a street it
 * has left. Half a wide road plus a pavement. */
const PULLOVER_ROAD_REACH_M = 14;

interface PlayerState {
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  heading: number;
  previousHeading: number;
  speedMps: number;
  gear: DriveGear;
  indicator: TurnIndicator;
}

type NpcPathSegment = NpcPathSegmentData;

/** How long a patrol strobes after clocking a violation (~6s at 60 Hz). */
const PATROL_BEACON_TICKS = 360;

/**
 * How close a camera has to be to book you for speed.
 *
 * Only speeding needs this — a red light names the light it was run, so that
 * camera is resolved by id. Kept near the junction it stands on rather than
 * generous, because the fiction is passing under the camera, not being
 * somewhere in its half of the neighbourhood; New York's blocks run 240 m
 * apart, so 30 m is comfortably one junction's worth.
 */
const TRAFFIC_CAMERA_SPEED_RADIUS_M = 30;

interface NpcVehicle {
  node: TransformNode;
  visual: VehicleMeshVisual;
  visualKey: string;
  visualVehicleId: string;
  visualVariant: NpcVehicleVariant;
  simulationId?: string;
  direction: 1 | -1;
  speed: number;
  z: number;
  laneX: number;
  // Previous/current sim pose pair; updateNpcVisuals blends between them at
  // render rate. laneX/z above keep their legacy meanings — don't overload.
  poseX: number;
  poseZ: number;
  poseHeading: number;
  prevPoseX: number;
  prevPoseZ: number;
  prevPoseHeading: number;
  laneId?: string;
  active?: boolean;
  currentSpeed?: number;
  signal?: TurnIndicator;
  braking?: boolean;
  /** Marked patrol car: its presence turns a nearby violation into a fine. */
  police?: boolean;
  /**
   * Simulation tick until which this patrol's light bar strobes. A patrol
   * cruises dark and lights up only when it clocks you, which is both what real
   * traffic looks like and immediate feedback that a fine just landed.
   */
  beaconUntilTick?: number;
}

/**
 * Identity of a built vehicle visual. Any change to it forces a rebuild — the
 * role is in there because a patrol car and a civilian car can otherwise share
 * a model and colours yet need entirely different geometry (light bar, livery).
 */
function appearanceVisualKey(appearance: VehicleAppearance): string {
  return [
    appearance.model,
    appearance.role,
    appearance.paintHex,
    appearance.accentHex,
  ].join("|");
}

/**
 * Reconciles authoritative simulation ids with a fixed pool of render roots.
 * Existing live associations win first, then numeric `npc-N` ids claim their
 * stable slots, leaving tail slots for scripted/non-numeric vehicles. This
 * prevents a newly activated ambient car from evicting a maneuver lead.
 */
/**
 * Merged road-paint geometry. Every dash and solid run used to be its own
 * unfrozen CreateBox — ~1,100 meshes on the NYC grid, each a per-frame
 * frustum test and draw call. These accumulators collect the exact same
 * boxes (same dash phase walk, same +0.25 depth pad and height rule, same
 * winding via Babylon's own box data, rotated and translated) so the session
 * can pour one mesh per paint colour. Pure and exported for node tests.
 */
export interface MarkingGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
}

export function createMarkingGeometry(): MarkingGeometry {
  return { positions: [], normals: [], indices: [] };
}

/** One paint box, replicating createFlatSegment's dimensions exactly. */
export function appendMarkingBox(
  geometry: MarkingGeometry,
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  width: number,
  y: number,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return;
  const heading = Math.atan2(dx, dz);
  const box = VertexData.CreateBox({
    width,
    height: Math.max(0.025, y * 0.45),
    depth: length + 0.25,
  });
  const centerX = (start.x + end.x) / 2;
  const centerZ = (start.z + end.z) / 2;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const indexBase = geometry.positions.length / 3;
  const positions = box.positions as number[];
  const normals = box.normals as number[];
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i];
    const py = positions[i + 1];
    const pz = positions[i + 2];
    // rotation.y = heading, as Babylon applies it to a mesh.
    geometry.positions.push(
      centerX + px * cos + pz * sin,
      y + py,
      centerZ - px * sin + pz * cos,
    );
    const nx = normals[i];
    const nz = normals[i + 2];
    geometry.normals.push(nx * cos + nz * sin, normals[i + 1], -nx * sin + nz * cos);
  }
  for (const index of box.indices as number[]) {
    geometry.indices.push(indexBase + index);
  }
}

/** The dash walk from createDashedPath, phase carry-over and all. */
export function appendDashedMarkingBoxes(
  geometry: MarkingGeometry,
  points: readonly GameCanvasPoint[],
  width: number,
  y: number,
  dashLength = 3,
  gapLength = 4,
): void {
  let phase = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const ux = dx / length;
    const uz = dz / length;
    for (
      let distance = -phase;
      distance < length;
      distance += dashLength + gapLength
    ) {
      const from = Math.max(0, distance);
      const to = Math.min(length, distance + dashLength);
      if (to - from > 0.2) {
        appendMarkingBox(
          geometry,
          { x: start.x + ux * from, z: start.z + uz * from },
          { x: start.x + ux * to, z: start.z + uz * to },
          width,
          y,
        );
      }
    }
    phase = (phase + length) % (dashLength + gapLength);
  }
}

export function appendSolidMarkingBoxes(
  geometry: MarkingGeometry,
  points: readonly GameCanvasPoint[],
  width: number,
  y: number,
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    appendMarkingBox(geometry, points[index], points[index + 1], width, y);
  }
}

export function resolveNpcVisualSlotAssignments(
  slots: readonly Readonly<{ simulationId?: string }>[],
  vehicles: readonly Readonly<{ id: string }>[],
): readonly number[] {
  const assignments = Array<number>(vehicles.length).fill(-1);
  const usedSlots = new Set<number>();
  const activeIds = new Set(vehicles.map((vehicle) => vehicle.id));

  for (const [vehicleIndex, vehicle] of vehicles.entries()) {
    const existingIndex = slots.findIndex(
      (slot, slotIndex) =>
        !usedSlots.has(slotIndex) && slot.simulationId === vehicle.id,
    );
    if (existingIndex < 0) continue;
    assignments[vehicleIndex] = existingIndex;
    usedSlots.add(existingIndex);
  }

  for (const [vehicleIndex, vehicle] of vehicles.entries()) {
    if (assignments[vehicleIndex] >= 0) continue;
    const numeric = /^npc-(\d+)$/.exec(vehicle.id);
    if (!numeric) continue;
    const preferredIndex = Number.parseInt(numeric[1], 10) - 1;
    const preferredSlot = slots[preferredIndex];
    if (
      !preferredSlot ||
      usedSlots.has(preferredIndex) ||
      (preferredSlot.simulationId && activeIds.has(preferredSlot.simulationId))
    ) {
      continue;
    }
    assignments[vehicleIndex] = preferredIndex;
    usedSlots.add(preferredIndex);
  }

  for (const vehicleIndex of vehicles.keys()) {
    if (assignments[vehicleIndex] >= 0) continue;
    const availableIndex = slots.findIndex(
      (slot, slotIndex) =>
        !usedSlots.has(slotIndex) &&
        (!slot.simulationId || !activeIds.has(slot.simulationId)),
    );
    const fallbackIndex = availableIndex >= 0
      ? availableIndex
      : slots.findIndex((_, slotIndex) => !usedSlots.has(slotIndex));
    if (fallbackIndex < 0) continue;
    assignments[vehicleIndex] = fallbackIndex;
    usedSlots.add(fallbackIndex);
  }

  return assignments;
}

interface Pedestrian {
  node: TransformNode;
  /** Distance along the walk strip in metres, within [0, span]. */
  distanceM: number;
  speed: number;
  z: number;
  origin?: GameCanvasPoint;
  heading?: number;
  span?: number;
  walkDir?: 1 | -1;
  pauseRemaining?: number;
  /** Driven by a pavement-rail walker sim instead of the strip stroll. */
  railMode?: boolean;
  kind?: "pedestrian" | "cyclist";
  /** While set (rule-clock seconds), this road user is knocked down. */
  downedUntilSeconds?: number;
  /** Last knockdown phase applied, so one-shots trigger exactly once. */
  downPhase?: WalkerDownedPhase;
  /** Model (or procedural-fallback) visual under `node`; null before build. */
  visual?: CharacterVisual | null;
  /** Which character model + clothing, so it can rebuild on model upgrade. */
  variant?: number;
  colors?: CharacterColors;
}

interface AuthoredCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly laneId: string | null;
  readonly laneWidthM: number;
  readonly distanceAlongM: number | null;
}

interface GuidanceVisual {
  readonly id: string;
  readonly meshes: readonly Mesh[];
  readonly dispose?: () => void;
}

interface RouteChevronVisual {
  readonly routeIndex: number;
  readonly laneId: string;
  readonly distanceAlongM: number;
  readonly meshes: readonly Mesh[];
}

interface TrafficControlMaterials {
  readonly dark: StandardMaterial;
  readonly pale: StandardMaterial;
  readonly redLamp: StandardMaterial;
  readonly amberLamp: StandardMaterial;
  readonly greenLamp: StandardMaterial;
  readonly stopRed: StandardMaterial;
  readonly yieldGold: StandardMaterial;
  readonly warningYellow: StandardMaterial;
  readonly restrictedBlue: StandardMaterial;
}

interface AuthoredSignalHeadVisual {
  readonly controlId: string;
  readonly trafficLightIds: readonly string[];
  readonly phaseGroup: string;
  readonly phaseGroups: readonly string[];
  readonly style: AuthoredSignalStyle;
  // Live handles into the shared lens master's per-instance color buffer —
  // writing one recolours that lens on the next draw. One master mesh + one
  // material serve every lens in the city; the per-head material clones they
  // replaced put ~750 unbatchable materials in the scene.
  readonly redColor: Color4;
  readonly amberColor: Color4;
  readonly greenColor: Color4;
  /** Cache for resolvedSignalLight; see that helper for the contract. */
  resolvedLightIndex?: number;
  /** Last aspect written to the lens colors — writes are skipped until it changes. */
  lastAspect?: AuthoredSignalAspect;
}

interface RailwayCrossingVisual {
  readonly trafficLightIds: readonly string[];
  /** Per-instance color handles, same contract as AuthoredSignalHeadVisual. */
  readonly lampColors: readonly Color4[];
  readonly barrierPivot: TransformNode;
  /** Cache for resolvedSignalLight; see that helper for the contract. */
  resolvedLightIndex?: number;
  lastWarningActive?: boolean;
  lastFlashIndex?: number;
}

interface RouteProjection {
  readonly segmentIndex: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly distance: number;
  readonly distanceAlong: number;
}

interface ScenarioLaneProjection extends RouteProjection {
  readonly laneId: string;
  readonly speedLimit?: number;
}

const FIXED_STEP = 1 / 60;
const START_Z = -52;
const FINISH_Z = 72;
const LANE_CENTER = 2.75;

// Frame-budget accounting drained by __sideswapPerfDebug. Indices into the
// session's perfSumMs/perfMaxMs arrays; the first four are per-fixed-step
// stages, the rest per-rendered-frame, and drainPerfStats averages each over
// its own denominator.
// Caps the camera shake/bob phase rate: 12 m/s * 2.7 rad/m ≈ 5.2 Hz for the
// chase shake (whose |sin| height term doubles that), ~3.6 Hz for head bob —
// both comfortably under the 30 Hz Nyquist limit of 60 Hz sampling.
const CAMERA_MOTION_SPEED_CAP_MPS = 12;

const PERF_SIM_STEP = 0;
const PERF_SNAPSHOT_APPLY = 1;
const PERF_CROWD = 2;
const PERF_COLLISION = 3;
const PERF_GUIDANCE = 4;
const PERF_CAMERA = 5;
const PERF_SCENE_RENDER = 6;
const PERF_STAGE_COUNT = 7;
const PERF_STAGE_NAMES = [
  "simStepMs",
  "snapshotApplyMs",
  "crowdMs",
  "collisionMs",
  "guidanceMs",
  "cameraMs",
  "sceneRenderMs",
] as const;

export const INPUT_PROMPT_SWITCH_COOLDOWN_MS = 750;
export const TOUCH_CONTROL_DIM_DELAY_MS = 1_500;

export interface AdaptiveInputPresentation {
  readonly activeFamily: InputFamily;
  readonly touchFirst: boolean;
  readonly touchRevealed: boolean;
  readonly touchControlsDimmed: boolean;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export interface CockpitCameraPoses {
  readonly first: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
  readonly rear: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
}

export function isCameraStackActive(
  mode: CameraMode,
  activeCameraName: string | null,
  activeCameraNames: readonly string[],
): boolean {
  // One scene camera in either mode. The rear-view camera used to be a second
  // entry here, rendering the mirror straight into a screen-space viewport; it
  // now belongs to a render target instead and never joins the scene's own
  // list, which is what lets the mirror be throttled.
  const mainCameraName =
    mode === "first" ? "first-person-camera" : "third-person-camera";
  return (
    activeCameraName === mainCameraName &&
    activeCameraNames.length === 1 &&
    activeCameraNames[0] === mainCameraName
  );
}

/**
 * Resolves cockpit cameras in world space so their movement never depends on
 * Babylon parent-transform propagation or multi-camera render ordering.
 */
export function resolveCockpitCameraPoses({
  x,
  z,
  vehicleHeading,
  cameraHeading,
  seatSide,
  headBob,
  quickLookAngle,
  viewportAspectRatio = 2,
}: {
  readonly x: number;
  readonly z: number;
  readonly vehicleHeading: number;
  readonly cameraHeading: number;
  readonly seatSide: number;
  readonly headBob: number;
  readonly quickLookAngle: number;
  readonly viewportAspectRatio?: number;
}): CockpitCameraPoses {
  const forwardX = Math.sin(vehicleHeading);
  const forwardZ = Math.cos(vehicleHeading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  return {
    first: {
      x: x + rightX * seatSide - forwardX * 0.6,
      y: 1.49 + headBob,
      z: z + rightZ * seatSide - forwardZ * 0.6,
      rotationX: resolveCockpitPitch(viewportAspectRatio),
      rotationY: cameraHeading + quickLookAngle,
    },
    rear: {
      x: x - forwardX * 0.52,
      y: 1.59,
      z: z - forwardZ * 0.52,
      rotationX: 0.04,
      rotationY: cameraHeading + Math.PI,
    },
  };
}

const eventNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

export function createInitialInputPresentation(
  capabilities: InputCapabilities,
): AdaptiveInputPresentation {
  return {
    activeFamily: capabilities.touchFirst ? "touch" : "keyboard",
    touchFirst: capabilities.touchFirst,
    touchRevealed: capabilities.touchFirst,
    touchControlsDimmed: false,
  };
}

/**
 * Owns adaptive input presentation for one live drive. It never disables an
 * input method: the active family only controls the prompts and touch-overlay
 * presentation.
 */
export class AdaptiveInputRouter {
  private capabilities: InputCapabilities;
  private presentation: AdaptiveInputPresentation;
  private reducedMotion: boolean;
  private lastPromptSwitchAt = Number.NEGATIVE_INFINITY;
  private pendingFamily: InputFamily | null = null;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private dimTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    capabilities: InputCapabilities,
    reducedMotion: boolean,
    private readonly onPresentationChange: (
      presentation: AdaptiveInputPresentation,
    ) => void,
    private readonly now: () => number = eventNow,
  ) {
    this.capabilities = capabilities;
    this.presentation = createInitialInputPresentation(capabilities);
    this.reducedMotion = reducedMotion;
  }

  getPresentation(): AdaptiveInputPresentation {
    return this.presentation;
  }

  setCapabilities(capabilities: InputCapabilities) {
    const changed =
      capabilities.touchFirst !== this.capabilities.touchFirst ||
      capabilities.hybridTouch !== this.capabilities.hybridTouch;
    if (!changed) return;
    this.capabilities = capabilities;

    let next: AdaptiveInputPresentation = {
      ...this.presentation,
      touchFirst: capabilities.touchFirst,
    };
    if (capabilities.touchFirst && !next.touchRevealed) {
      next = { ...next, touchRevealed: true };
    }
    if (!capabilities.touchFirst && next.touchControlsDimmed) {
      this.clearDimTimer();
      next = { ...next, touchControlsDimmed: false };
    }
    if (next !== this.presentation) {
      this.presentation = next;
      this.emitPresentation();
    }
    if (capabilities.touchFirst && this.presentation.activeFamily !== "touch") {
      this.scheduleTouchDimming();
    }
  }

  setReducedMotion(reducedMotion: boolean) {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    if (reducedMotion && this.pendingFamily) {
      this.applyActiveFamily(this.pendingFamily, this.now());
    }
    if (
      reducedMotion &&
      this.capabilities.touchFirst &&
      this.presentation.activeFamily !== "touch" &&
      !this.presentation.touchControlsDimmed
    ) {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }
  }

  registerMeaningfulInput(family: InputFamily) {
    if (this.disposed) return;
    if (family === "touch") this.revealTouchControls();

    if (family === this.presentation.activeFamily) {
      if (family === "touch") {
        this.restoreTouchControls();
      } else {
        this.scheduleTouchDimming();
      }
      return;
    }

    const now = this.now();
    const elapsed = now - this.lastPromptSwitchAt;
    if (this.reducedMotion || elapsed >= INPUT_PROMPT_SWITCH_COOLDOWN_MS) {
      this.applyActiveFamily(family, now);
      return;
    }

    this.pendingFamily = family;
    this.clearPromptTimer();
    this.promptTimer = setTimeout(() => {
      this.promptTimer = null;
      const pending = this.pendingFamily;
      this.pendingFamily = null;
      if (pending && !this.disposed) this.applyActiveFamily(pending, this.now());
    }, Math.max(0, INPUT_PROMPT_SWITCH_COOLDOWN_MS - elapsed));
  }

  handleGamepadDisconnect(): InputFamily {
    this.pendingFamily = null;
    this.clearPromptTimer();
    const fallback: InputFamily = this.capabilities.touchFirst ? "touch" : "keyboard";
    this.applyActiveFamily(fallback, this.now(), true);
    return fallback;
  }

  dispose() {
    this.disposed = true;
    this.clearPromptTimer();
    this.clearDimTimer();
  }

  private applyActiveFamily(family: InputFamily, now: number, force = false) {
    this.pendingFamily = null;
    this.clearPromptTimer();
    if (!force && family === this.presentation.activeFamily) return;

    this.lastPromptSwitchAt = now;
    this.presentation = {
      ...this.presentation,
      activeFamily: family,
      touchRevealed:
        this.presentation.touchRevealed || family === "touch" || this.capabilities.touchFirst,
    };
    if (family === "touch") {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: false };
    } else {
      this.scheduleTouchDimming();
    }
    this.emitPresentation();
  }

  private revealTouchControls() {
    const shouldReveal = !this.presentation.touchRevealed;
    const shouldRestore = this.presentation.touchControlsDimmed || this.dimTimer !== null;
    if (!shouldReveal && !shouldRestore) return;
    this.clearDimTimer();
    this.presentation = {
      ...this.presentation,
      touchRevealed: true,
      touchControlsDimmed: false,
    };
    this.emitPresentation();
  }

  private restoreTouchControls() {
    if (!this.presentation.touchControlsDimmed && this.dimTimer === null) return;
    this.clearDimTimer();
    this.presentation = { ...this.presentation, touchControlsDimmed: false };
    this.emitPresentation();
  }

  private scheduleTouchDimming() {
    if (
      !this.capabilities.touchFirst ||
      this.presentation.activeFamily === "touch" ||
      this.presentation.touchControlsDimmed ||
      this.dimTimer !== null
    ) {
      return;
    }
    if (this.reducedMotion) {
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
      return;
    }
    this.dimTimer = setTimeout(() => {
      this.dimTimer = null;
      if (
        this.disposed ||
        !this.capabilities.touchFirst ||
        this.presentation.activeFamily === "touch"
      ) {
        return;
      }
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }, TOUCH_CONTROL_DIM_DELAY_MS);
  }

  private clearPromptTimer() {
    if (this.promptTimer === null) return;
    clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  private clearDimTimer() {
    if (this.dimTimer === null) return;
    clearTimeout(this.dimTimer);
    this.dimTimer = null;
  }

  private emitPresentation() {
    if (!this.disposed) this.onPresentationChange(this.presentation);
  }
}

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const LONDON_LAMP_POSITIONS: readonly (readonly [number, number])[] = [
  [-83, -52],
  [-50, -52],
  [-2, -52],
  [25, -52],
  [28, 2],
  [56, 18],
  [28, 60],
  [56, 72],
];

const LONDON_BOLLARD_POSITIONS: readonly (readonly [number, number])[] = [
  -2, 22, 46, 70,
].flatMap((z) => [
  [32, z] as const,
  [52, z] as const,
]);

const LONDON_PLANTER_POSITIONS: readonly (readonly [number, number])[] = [
  [57, -8],
  [57, 36],
  [57, 68],
];

// Mirrored as a solid circle obstacle in simulationAdapter (cast iron beats
// car); move both together.
const LONDON_POST_BOX_POSITION = [122, 87] as const;

/** Hand-placed South Kensington furniture that scattered props must avoid. */
const LONDON_FURNITURE_POINTS: readonly GameCanvasPoint[] = [
  ...LONDON_LAMP_POSITIONS,
  ...LONDON_BOLLARD_POSITIONS,
  ...LONDON_PLANTER_POSITIONS,
  LONDON_POST_BOX_POSITION,
].map(([x, z]) => ({ x, z }));

/**
 * Street furniture the car can knock over. Every scattered prop, vendor cart
 * and piece of hand-placed London furniture registers here; a hit scrubs the
 * player's speed via the sim's external-contact path (which is also what the
 * damage/fine layers listen to), topples or squashes the prop in place, and
 * leaves the wreckage lying for the rest of the drive. `damage: "none"` props
 * (grass tufts) are a purely visual crunch — no event, no speed change. The
 * London post box is deliberately absent: cast iron wins, it is a solid
 * obstacle in the core instead.
 */
interface DestructiblePropConfig {
  readonly radiusM: number;
  readonly speedScale: number;
  readonly damage: "none" | "light" | "medium";
  readonly noun: string;
  readonly fall: "topple" | "squash";
}

const DESTRUCTIBLE_PROP_CONFIGS: Readonly<Record<string, DestructiblePropConfig>> = {
  tree: { radiusM: 0.5, speedScale: 0.7, damage: "medium", noun: "a street tree", fall: "topple" },
  streetlight: { radiusM: 0.32, speedScale: 0.74, damage: "medium", noun: "a streetlight", fall: "topple" },
  "utility-pole": { radiusM: 0.35, speedScale: 0.72, damage: "medium", noun: "a utility pole", fall: "topple" },
  sign: { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a signpost", fall: "topple" },
  "oneway-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a ONE WAY sign", fall: "topple" },
  "dne-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a DO NOT ENTER sign", fall: "topple" },
  "wrongway-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a WRONG WAY sign", fall: "topple" },
  "speedlimit-sign": { radiusM: 0.28, speedScale: 0.93, damage: "light", noun: "a speed limit sign", fall: "topple" },
  // Park planting and furniture. A shrub squashes rather than topples — a bush
  // hinging over on one edge looks like a felled tree, which it is not.
  shrub: { radiusM: 0.55, speedScale: 0.94, damage: "none", noun: "a shrub", fall: "squash" },
  bench: { radiusM: 0.85, speedScale: 0.86, damage: "light", noun: "a park bench", fall: "topple" },
  lamp: { radiusM: 0.3, speedScale: 0.76, damage: "medium", noun: "a park lamp", fall: "topple" },
  hydrant: { radiusM: 0.35, speedScale: 0.9, damage: "light", noun: "a fire hydrant", fall: "topple" },
  bollard: { radiusM: 0.25, speedScale: 0.92, damage: "light", noun: "a bollard", fall: "topple" },
  vending: { radiusM: 0.6, speedScale: 0.88, damage: "light", noun: "a vending machine", fall: "topple" },
  vendor: { radiusM: 1.15, speedScale: 0.85, damage: "light", noun: "a vendor cart", fall: "topple" },
  "london-lamp": { radiusM: 0.32, speedScale: 0.74, damage: "medium", noun: "a lamp post", fall: "topple" },
  "london-bollard": { radiusM: 0.25, speedScale: 0.92, damage: "light", noun: "a bollard", fall: "topple" },
  "london-planter": { radiusM: 0.58, speedScale: 0.85, damage: "light", noun: "a planter", fall: "topple" },
};

interface DestructiblePropPart {
  readonly node: TransformNode;
  /** The streetlight's ground light pool: sinks away instead of rotating. */
  readonly isLightPool: boolean;
}

interface DestructibleProp {
  readonly kind: string;
  readonly config: DestructiblePropConfig;
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly parts: readonly DestructiblePropPart[];
  state: "standing" | "falling" | "down";
}

interface ActivePropFall {
  readonly prop: DestructibleProp;
  readonly pivot: TransformNode;
  readonly poolParts: readonly TransformNode[];
  progress: number;
}

/** Grid cell for the prop broad phase; must exceed the largest prop radius
 * plus the car capsule reach so a 3x3 neighbourhood always suffices. */
const DESTRUCTIBLE_GRID_CELL_M = 8;
const PROP_TOPPLE_SECONDS = 0.5;
const PROP_TOPPLE_MAX_ANGLE_RAD = 1.46;
const PROP_MIN_STRIKE_SPEED_MPS = 0.8;
/** Above this many simultaneous falls, further strikes settle instantly. */
const PROP_MAX_ACTIVE_TOPPLES = 8;

const PLAYER_CAPSULE_HALF_LENGTH_M = 1.15;
const PLAYER_CAPSULE_RADIUS_M = 1.0;

const PROP_TREE: PropKindConfig = {
  kind: "tree",
  spacingM: 26,
  jitterM: 8,
  lateralMarginM: 2.2,
  bothSides: true,
  variants: 3,
  minScale: 0.85,
  maxScale: 1.3,
};

const PROP_STREETLIGHT: PropKindConfig = {
  kind: "streetlight",
  spacingM: 38,
  jitterM: 6,
  lateralMarginM: 1,
  bothSides: false,
  alternateSides: true,
  variants: 1,
  faceRoad: true,
};

const PROP_SIGN: PropKindConfig = {
  kind: "sign",
  spacingM: 66,
  jitterM: 18,
  lateralMarginM: 1.2,
  bothSides: false,
  variants: 2,
  faceRoad: true,
};

// The ambient sidewalk crowd: walkers simulated on the pavement rail graph
// (crowdWalkers) inside a bubble around the player, drawn as GPU-animated thin
// instances (crowdRenderer). Counts are per map — the whole crowd costs a few
// meshes regardless, so these are set by how busy each city should feel, not
// by a draw-call budget. Radii track each map's fog: recycling happens beyond
// what the player can see. Maps absent here (the orientation yard) have no
// ambient crowd.
const AMBIENT_CROWD_CONFIG: Readonly<
  Record<
    string,
    {
      count: number;
      innerRadiusM: number;
      outerRadiusM: number;
      recycleRadiusM: number;
    }
  >
> = {
  "nyc-upper-west-side": { count: 96, innerRadiusM: 25, outerRadiusM: 130, recycleRadiusM: 170 },
  "tokyo-setagaya": { count: 56, innerRadiusM: 18, outerRadiusM: 100, recycleRadiusM: 140 },
  "london-south-kensington": { count: 64, innerRadiusM: 20, outerRadiusM: 120, recycleRadiusM: 160 },
  "cairo-central-nile": { count: 88, innerRadiusM: 22, outerRadiusM: 125, recycleRadiusM: 165 },
};

/** Bubble radii for the scenario road users on maps with no crowd config
 * (today only the orientation yard): they walk the same rails, just fewer. */
const DEFAULT_ROAD_USER_RADII = {
  innerRadiusM: 18,
  outerRadiusM: 110,
  recycleRadiusM: 150,
};

/** Clothing tints shared by the crowd and the scenario/yard pedestrians. */
const CROWD_CLOTHING_COLORS = [
  { r: 0.82, g: 0.21, b: 0.15 },
  { r: 0.2, g: 0.35, b: 0.6 },
  { r: 0.3, g: 0.5, b: 0.35 },
  { r: 0.7, g: 0.66, b: 0.5 },
  { r: 0.55, g: 0.3, b: 0.5 },
];

const CAIRO_CROWD_CLOTHING_COLORS = [
  { r: 0.12, g: 0.16, b: 0.2 },
  { r: 0.12, g: 0.34, b: 0.37 },
  { r: 0.32, g: 0.34, b: 0.19 },
  { r: 0.76, g: 0.68, b: 0.51 },
  { r: 0.56, g: 0.25, b: 0.21 },
  { r: 0.48, g: 0.31, b: 0.43 },
] as const;

/** Contemporary warm-neutrals and deep colours for Cairo's street crowd. */
export function crowdClothingPaletteForMap(
  mapId: string,
): readonly { readonly r: number; readonly g: number; readonly b: number }[] {
  return resolveMapVisualKey(mapId) === "cairo"
    ? CAIRO_CROWD_CLOTHING_COLORS
    : CROWD_CLOTHING_COLORS;
}

/** Per-map roadside dressing: shared basics plus locally recognisable extras. */
function roadsidePropKindsForMap(
  key: ReturnType<typeof resolveMapVisualKey>,
): readonly PropKindConfig[] {
  switch (key) {
    case "nyc":
      return [
        PROP_STREETLIGHT,
        { ...PROP_TREE, spacingM: 30 },
        {
          kind: "hydrant",
          spacingM: 58,
          jitterM: 14,
          lateralMarginM: 0.9,
          bothSides: false,
          variants: 1,
          faceRoad: true,
        },
        PROP_SIGN,
        // Street vendor carts, curbside and alternating sides. The placement is
        // computed here but the carts are glb instances (routed out of the
        // procedural-prop loop into pendingVendors), not master boxes.
        {
          // Sparser than one-per-frontage: a dumpster/cart every ~130 m curbside,
          // not outside every building (which read as unrealistic clutter).
          kind: "vendor",
          spacingM: 130,
          jitterM: 24,
          lateralMarginM: 1.4,
          bothSides: false,
          alternateSides: true,
          variants: Math.max(1, NYC_VENDORS.length),
          faceRoad: true,
        },
      ];
    case "london":
      // Street lamps are hand-placed for South Kensington; scattered props
      // stay clear of them via LONDON_FURNITURE_POINTS.
      return [{ ...PROP_TREE, spacingM: 30 }, PROP_SIGN];
    case "tokyo":
      return [
        {
          kind: "utility-pole",
          spacingM: 32,
          jitterM: 5,
          lateralMarginM: 0.9,
          bothSides: false,
          alternateSides: true,
          variants: 1,
          faceRoad: true,
        },
        {
          kind: "vending",
          spacingM: 74,
          jitterM: 20,
          lateralMarginM: 1,
          bothSides: false,
          variants: 2,
          faceRoad: true,
        },
        { ...PROP_TREE, spacingM: 34, minScale: 0.7, maxScale: 1 },
        PROP_SIGN,
      ];
    case "cairo":
      return [
        { ...PROP_STREETLIGHT, spacingM: 36, jitterM: 7 },
        { ...PROP_TREE, spacingM: 54, minScale: 0.8, maxScale: 1.15 },
        {
          kind: "palm",
          spacingM: 68,
          jitterM: 16,
          lateralMarginM: 1.2,
          bothSides: false,
          alternateSides: true,
          variants: 2,
          minScale: 0.85,
          maxScale: 1.2,
          faceRoad: true,
        },
        {
          kind: "bollard",
          spacingM: 42,
          jitterM: 9,
          lateralMarginM: 0.8,
          bothSides: false,
          variants: 1,
        },
        // Nothing parks at the Cairo kerb: the parked cars, microbuses, vendor
        // carts and scooters that used to are all gone. They were scattered on
        // road geometry alone, so they landed wherever the band allowed rather
        // than where a vehicle would plausibly stand — clutter dumped on the
        // pavement, not a parked street. The box-built ones were also badly
        // modelled (the scooter's handlebar floated free of its frame). Any
        // future kerb parking wants real placement, not scatter.
        { ...PROP_SIGN, spacingM: 78, variants: 2 },
      ];
    case "orientation":
    default:
      return [{ ...PROP_TREE, spacingM: 24 }];
  }
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

function scenarioRoutePoints(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
): GameCanvasPoint[] {
  if (!lesson || !mapPack) return [];
  const lanes = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const points: GameCanvasPoint[] = [];
  for (const laneId of lesson.route) {
    const lane = lanes.get(laneId);
    if (!lane) continue;
    for (const point of lane.centerline) {
      const previous = points.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.01) {
        points.push({ x: point.x, z: point.z });
      }
    }
  }
  return points;
}

interface ResolvedLaneAnchor extends GameCanvasPoint {
  readonly heading: number;
  readonly segmentIndex: number;
  readonly distanceOnSegment: number;
}

interface LanePointProjection {
  readonly distance: number;
  readonly distanceAlongM: number;
  readonly heading: number;
}

function projectPointToLane(
  lane: GameCanvasLane,
  point: GameCanvasPoint,
): LanePointProjection | null {
  let accumulated = 0;
  let best: LanePointProjection | null = null;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const amount = clamp(
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length),
      0,
      1,
    );
    const x = start.x + dx * amount;
    const z = start.z + dz * amount;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (!best || distance < best.distance) {
      best = {
        distance,
        distanceAlongM: accumulated + length * amount,
        heading: Math.atan2(dx, dz),
      };
    }
    accumulated += length;
  }
  return best;
}

export interface CheckpointCrossingInput {
  readonly lane: GameCanvasLane;
  readonly distanceAlongM: number;
  readonly previous: GameCanvasPoint;
  readonly current: GameCanvasPoint;
}

/**
 * Requires a forward crossing while the vehicle centre is inside the authored
 * lane envelope. Merely approaching from the adjacent lane never activates it.
 */
export function isAuthoredCheckpointCrossing({
  lane,
  distanceAlongM,
  previous,
  current,
}: CheckpointCrossingInput): boolean {
  const previousProjection = projectPointToLane(lane, previous);
  const currentProjection = projectPointToLane(lane, current);
  if (!previousProjection || !currentProjection) return false;
  const lateralTolerance = Math.max(
    0.1,
    (lane.widthM ?? 3.2) / 2 -
      PLAYER_GUIDANCE_HALF_WIDTH_M -
      GUIDANCE_LATERAL_CLEARANCE_M,
  );
  if (
    previousProjection.distance > lateralTolerance ||
    currentProjection.distance > lateralTolerance
  ) {
    return false;
  }
  const crossingSlopM = 0.12;
  return (
    previousProjection.distanceAlongM < distanceAlongM - crossingSlopM &&
    currentProjection.distanceAlongM >= distanceAlongM - crossingSlopM
  );
}

function resolveLaneAnchor(
  lanes: readonly GameCanvasLane[],
  anchor: { readonly laneId: string; readonly distanceAlongM: number },
): ResolvedLaneAnchor | null {
  const lane = lanes.find((candidate) => candidate.id === anchor.laneId);
  if (!lane || lane.centerline.length < 2) return null;
  let remaining = Math.max(0, anchor.distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 0.001) continue;
    if (remaining <= length || index === lane.centerline.length - 2) {
      const distanceOnSegment = Math.min(remaining, length);
      const amount = distanceOnSegment / length;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
        segmentIndex: index,
        distanceOnSegment,
      };
    }
    remaining -= length;
  }
  return null;
}

function scenarioCheckpoints(
  lesson: GameCanvasLesson | undefined,
  mapPack: GameCanvasMapPack | undefined,
): AuthoredCheckpoint[] {
  if (!lesson || !mapPack) return [];
  const byId = new Map(
    mapPack.laneGraph.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  return lesson.checkpoints.flatMap((id) => {
    const checkpoint = byId.get(id);
    if (!checkpoint) return [];
    const anchored = checkpoint.anchor
      ? resolveLaneAnchor(mapPack.laneGraph.lanes, checkpoint.anchor)
      : null;
    if (anchored) {
      const lane = mapPack.laneGraph.lanes.find(
        (candidate) => candidate.id === checkpoint.anchor?.laneId,
      );
      return [{
        id: checkpoint.id,
        label: checkpoint.label,
        x: anchored.x,
        z: anchored.z,
        heading: anchored.heading,
        laneId: checkpoint.anchor?.laneId ?? null,
        laneWidthM: lane?.widthM ?? 3.2,
        distanceAlongM: checkpoint.anchor?.distanceAlongM ?? null,
      }];
    }
    const legacyLaneId = checkpoint.laneId ?? null;
    const legacyLane = legacyLaneId
      ? mapPack.laneGraph.lanes.find((candidate) => candidate.id === legacyLaneId)
      : null;
    return checkpoint.pose
      ? [{
          id: checkpoint.id,
          label: checkpoint.label,
          x: checkpoint.pose.position.x,
          z: checkpoint.pose.position.z,
          heading: degreesToRadians(checkpoint.pose.headingDeg),
          laneId: legacyLaneId,
          laneWidthM: legacyLane?.widthM ?? 3.2,
          distanceAlongM: null,
        }]
      : [];
  });
}

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

/**
 * The instrument cluster's faceplate, drawn once.
 *
 * Everything on it is static: the dial rings, their ticks, the centre readout
 * bars. The two things that actually move are needles, and they are meshes that
 * rotate — nothing in this game repaints a DynamicTexture per frame and this is
 * not the place to start. A 512x160 re-raster plus upload every frame would cost
 * more than the whole rest of the cockpit put together, to animate two lines.
 *
 * Ring colours are the reference's: teal for road speed, amber for revs.
 */
function makeInstrumentClusterTexture(scene: Scene): DynamicTexture {
  const { width, height } = COCKPIT_CLUSTER_TEXTURE;
  const texture = new DynamicTexture(
    "instrument-cluster-face",
    { width, height },
    scene,
    true,
  );
  const context = textureContext(texture);
  context.fillStyle = "#080b0d";
  context.fillRect(0, 0, width, height);

  const centreY = height / 2;
  const radius = height * COCKPIT_GAUGE_RADIUS;
  const sweepStart = (135 * Math.PI) / 180;
  const sweepEnd = (405 * Math.PI) / 180;

  COCKPIT_GAUGE_CENTRES.forEach((centre, index) => {
    const centreX = centre * width;
    const accent = index === 0 ? "#3fd8c4" : "#f2a02a";

    context.fillStyle = "#0d1417";
    context.beginPath();
    context.arc(centreX, centreY, radius * 0.92, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = accent;
    context.lineWidth = 4;
    context.setLineDash([7, 6]);
    context.beginPath();
    context.arc(centreX, centreY, radius, sweepStart, sweepEnd);
    context.stroke();
    context.setLineDash([]);

    // A finer ring of ticks inside the accent, every 13.5 degrees of the sweep.
    context.strokeStyle = "rgba(206, 216, 220, 0.55)";
    context.lineWidth = 2;
    for (let tick = 0; tick <= 20; tick += 1) {
      const angle = sweepStart + ((sweepEnd - sweepStart) * tick) / 20;
      const long = tick % 5 === 0;
      const inner = radius * (long ? 0.62 : 0.72);
      const outer = radius * 0.8;
      context.beginPath();
      context.moveTo(
        centreX + Math.cos(angle) * inner,
        centreY + Math.sin(angle) * inner,
      );
      context.lineTo(
        centreX + Math.cos(angle) * outer,
        centreY + Math.sin(angle) * outer,
      );
      context.stroke();
    }
  });

  // The centre stack: a gear/readout block between the dials.
  context.fillStyle = "#3fd8c4";
  for (const offset of [-20, 0, 20]) {
    context.fillRect(width / 2 - 21, centreY + offset - 2, 42, 4);
  }

  texture.update(false);
  return texture;
}

/**
 * A cabin surface: like `makeMaterial`, but it actually collects the scene's
 * ambient term.
 *
 * Babylon defaults `StandardMaterial.ambientColor` to black, and the ambient
 * contribution is `scene.ambientColor * material.ambientColor` — so every
 * material built by `makeMaterial` throws the scene's ambient light away. Out in
 * the city that is invisible, because the sun and the sky light do the work. In
 * the cockpit it is most of the problem: the interior faces away from both
 * lights, sits under the pipeline's vignette, and had nothing else lifting it.
 *
 * Ambient is also the only lift available that costs nothing. The scene has
 * exactly two lights and every material in the game compiles against both;
 * adding a third for the cabin would recompile every material and put another
 * light term on every fragment on screen, to brighten geometry that covers a
 * third of one camera.
 */
function makeInteriorMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
  ambient = 0.75,
): StandardMaterial {
  const material = makeMaterial(scene, name, color, emissive);
  material.ambientColor = new Color3(ambient, ambient, ambient);
  return material;
}

function inferSpawnVehicleVariant(spawnId?: string): NpcVehicleVariant {
  const normalized = spawnId?.toLowerCase() ?? "";
  if (normalized.includes("bus")) return "bus";
  if (normalized.includes("cab") || normalized.includes("taxi")) return "taxi";
  if (normalized.includes("van")) return "van";
  return "car";
}

function setMeshMaterial(
  mesh: Mesh,
  material: StandardMaterial,
  receiveShadows = false,
) {
  mesh.material = material;
  mesh.receiveShadows = receiveShadows;
  mesh.isPickable = false;
}

function textureContext(texture: DynamicTexture): CanvasRenderingContext2D {
  return texture.getContext() as unknown as CanvasRenderingContext2D;
}

function createSkyGradientTexture(
  scene: Scene,
  palette: MapVisualPalette,
): DynamicTexture {
  const height = 256;
  const texture = new DynamicTexture(
    "sky-gradient",
    { width: 4, height },
    scene,
    false,
  );
  const context = textureContext(texture);
  // Canvas bottom samples the dome's top pole (v=0 after the flipped upload),
  // so the zenith stop is anchored at the bottom row.
  const gradient = context.createLinearGradient(0, height, 0, 0);
  for (const stop of skyGradientStops(palette)) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, height);
  texture.update();
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function createHorizonSilhouetteTexture(
  scene: Scene,
  mapId: string,
  palette: MapVisualPalette,
): DynamicTexture {
  const width = 2048;
  const height = 256;
  const texture = new DynamicTexture(
    "horizon-silhouette",
    { width, height },
    scene,
    true,
  );
  texture.hasAlpha = true;
  const context = textureContext(texture);
  context.clearRect(0, 0, width, height);

  const shapes = buildHorizonSilhouetteSpec(mapId, hashStringToSeed(mapId));
  // Keep the shared terrain band shallow: a tall band reads as a wall around
  // the map instead of a distant skyline.
  const baseBandHeight = height * 0.1;
  const usableHeight = height - baseBandHeight;

  const drawShape = (
    shape: (typeof shapes)[number],
    offsetX: number,
  ): void => {
    const centerX = (shape.x + offsetX) * width;
    const shapeWidth = Math.max(2, shape.w * width);
    const top = height - baseBandHeight - shape.h * usableHeight;
    if (shape.kind === "box") {
      context.fillRect(centerX - shapeWidth / 2, top, shapeWidth, height - top);
      return;
    }
    if (shape.kind === "spike") {
      context.beginPath();
      context.moveTo(centerX - shapeWidth / 2, height);
      context.lineTo(centerX, top);
      context.lineTo(centerX + shapeWidth / 2, height);
      context.closePath();
      context.fill();
      return;
    }
    if (shape.kind === "pylon") {
      const mastWidth = Math.max(2, shapeWidth * 0.3);
      context.fillRect(centerX - mastWidth / 2, top, mastWidth, height - top);
      const armWidth = shapeWidth * 4;
      const armHeight = Math.max(2, height * 0.012);
      context.fillRect(centerX - armWidth / 2, top + usableHeight * 0.08, armWidth, armHeight);
      context.fillRect(
        centerX - armWidth * 0.375,
        top + usableHeight * 0.2,
        armWidth * 0.75,
        armHeight,
      );
      return;
    }
    const radiusX = Math.max(3, shapeWidth / 2);
    context.beginPath();
    context.ellipse(
      centerX,
      height - baseBandHeight,
      radiusX,
      Math.max(2, shape.h * usableHeight),
      0,
      Math.PI,
      Math.PI * 2,
    );
    context.closePath();
    context.fill();
    context.fillRect(
      centerX - radiusX,
      height - baseBandHeight,
      radiusX * 2,
      baseBandHeight,
    );
  };

  // A continuous distant-terrain band keeps the ring base seamless where the
  // fogged ground meets the sky, with skyline shapes rising above it.
  context.fillStyle = palette.silhouetteFar;
  context.fillRect(0, height - baseBandHeight, width, baseBandHeight);
  for (const layer of [1, 0] as const) {
    context.fillStyle =
      layer === 1 ? palette.silhouetteFar : palette.silhouetteNear;
    for (const shape of shapes) {
      if (shape.layer !== layer) continue;
      // Draw wrapped copies so shapes crossing the seam stay continuous.
      drawShape(shape, -1);
      drawShape(shape, 0);
      drawShape(shape, 1);
    }
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function applyLuminanceNoise(
  context: CanvasRenderingContext2D,
  size: number,
  seed: number,
  amplitude: number,
): void {
  const image = context.getImageData(0, 0, size, size);
  const random = seededUnit(seed);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const factor = 1 + (random() - 0.5) * 2 * amplitude;
    data[index] = Math.min(255, Math.max(0, data[index] * factor));
    data[index + 1] = Math.min(255, Math.max(0, data[index + 1] * factor));
    data[index + 2] = Math.min(255, Math.max(0, data[index + 2] * factor));
  }
  context.putImageData(image, 0, 0);
}

function createAsphaltTexture(
  scene: Scene,
  name: string,
  baseColorHex: string,
  seed: number,
): DynamicTexture {
  const size = 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  context.fillStyle = baseColorHex;
  context.fillRect(0, 0, size, size);

  const spec = buildAsphaltTextureSpec(seed);
  applyLuminanceNoise(context, size, spec.noiseSeed, 0.03);
  context.fillStyle = "rgba(255, 255, 255, 1)";
  for (const patch of spec.patches) {
    context.globalAlpha = patch.lighten;
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.strokeStyle = "rgba(0, 0, 0, 0.14)";
  context.lineWidth = 2;
  context.lineJoin = "round";
  for (const crack of spec.cracks) {
    context.beginPath();
    for (const [pointIndex, point] of crack.points.entries()) {
      // Cracks that wrap the tile edge would draw a long straight artefact;
      // break the stroke on large jumps instead.
      const previous = crack.points[pointIndex - 1];
      if (
        pointIndex === 0 ||
        (previous &&
          (Math.abs(point.x - previous.x) > 0.5 ||
            Math.abs(point.y - previous.y) > 0.5))
      ) {
        context.moveTo(point.x * size, point.y * size);
        continue;
      }
      context.lineTo(point.x * size, point.y * size);
    }
    context.stroke();
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
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

/**
 * The river's diffuse tile: the wave field painted as a trough-to-crest ramp.
 *
 * The two halves of the ramp are deliberately asymmetric. Troughs spread into
 * broad soft areas of the deep tone while crests stay thin and bright, because
 * on real water the sky only reaches the eye off the top of a wave — a
 * symmetric ramp paints a quilt of equal light and dark blobs, which reads as
 * marble.
 */
function createRiverSurfaceTexture(
  scene: Scene,
  name: string,
  waves: readonly RiverWave[],
  tones: { readonly deep: Color3; readonly base: Color3; readonly crest: Color3 },
  size: number,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const field = sampleRiverWaveField(waves, size);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let index = 0; index < field.length; index += 1) {
    const height = field[index];
    const toward = height >= 0 ? tones.crest : tones.deep;
    const amount =
      height >= 0 ? Math.pow(height, 1.7) : Math.pow(-height, 0.75);
    const offset = index * 4;
    data[offset] = (tones.base.r + (toward.r - tones.base.r) * amount) * 255;
    data[offset + 1] =
      (tones.base.g + (toward.g - tones.base.g) * amount) * 255;
    data[offset + 2] =
      (tones.base.b + (toward.b - tones.base.b) * amount) * 255;
    data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The river's normal map, from the gradient of the same kind of wave field.
 *
 * The grass tile argues against normal-mapping flat ground, and it is right:
 * under a fixed sun a static normal map on a plane reads as grain, not relief.
 * Water is the exception precisely because this one *moves* — the highlights
 * crawling across the surface are the whole point, and they are what carries
 * the river at close range where the diffuse tile has gone soft.
 */
function createRiverRippleTexture(
  scene: Scene,
  name: string,
  waves: readonly RiverWave[],
  size: number,
  steepness: number,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const field = sampleRiverWaveField(waves, size);
  const image = context.createImageData(size, size);
  const data = image.data;
  // Central differences, wrapped — the tile repeats, so its edges have real
  // neighbours and clamping there would ring a seam into the highlights.
  const gradient = (steepness * size) / 2;
  for (let v = 0; v < size; v += 1) {
    const row = v * size;
    const rowUp = ((v + size - 1) % size) * size;
    const rowDown = ((v + 1) % size) * size;
    for (let u = 0; u < size; u += 1) {
      const left = field[row + ((u + size - 1) % size)];
      const right = field[row + ((u + 1) % size)];
      const x = -(right - left) * gradient;
      const y = -(field[rowDown + u] - field[rowUp + u]) * gradient;
      const inverse = 1 / Math.hypot(x, y, 1);
      const offset = (row + u) * 4;
      data[offset] = (x * inverse * 0.5 + 0.5) * 255;
      data[offset + 1] = (y * inverse * 0.5 + 0.5) * 255;
      data[offset + 2] = (inverse * 0.5 + 0.5) * 255;
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The four-tone blade ramp, lightest first. `paintGrassBlades` draws a blade in
 * `ramp[tone]` and its tip in `ramp[tone - 1]`, so a tone-0 blade tips into
 * pure `grassAlt`. Derived rather than authored so a palette only has to supply
 * the three greens.
 */
function grassBladeRamp(palette: MapVisualPalette): readonly string[] {
  // A deliberately tight ramp. Running the ends out to white and to the full
  // `grassDeep` made individual strokes legible as strokes — the lawn read as
  // scattered pine needles rather than as turf. Grass is a texture, not a set
  // of drawn objects, so the contrast has to sit below the threshold where the
  // eye starts counting marks.
  return [
    mixHexColors(palette.grassAlt, "#ffffff", 0.1),
    palette.grassAlt,
    palette.grassBase,
    mixHexColors(palette.grassBase, palette.grassDeep, 0.55),
  ];
}

/**
 * Strokes a blade field onto a canvas. Each blade is drawn twice — full length
 * in its own tone, then its top 45% one ramp step lighter — which is what gives
 * a flat ground plane its light-from-above read without a normal map.
 */
function paintGrassBlades(
  context: CanvasRenderingContext2D,
  size: number,
  blades: readonly GrassBlade[],
  ramp: readonly string[],
  alpha: number,
): void {
  context.lineCap = "round";
  context.globalAlpha = alpha;
  for (const blade of blades) {
    const x = blade.x * size;
    const y = blade.y * size;
    const dx = Math.sin(blade.angle) * blade.length * size;
    const dy = -Math.cos(blade.angle) * blade.length * size;
    context.lineWidth = Math.max(0.7, blade.width * size);
    context.strokeStyle = ramp[blade.tone] ?? ramp[ramp.length - 1];
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
    context.stroke();
    // The lit tip. Tone 0 is already the lightest, so it tips into itself.
    context.strokeStyle = ramp[Math.max(0, blade.tone - 1)];
    context.beginPath();
    context.moveTo(x + dx * 0.55, y + dy * 0.55);
    context.lineTo(x + dx, y + dy);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/**
 * The base grass tile. 1024² on desktop so blades survive a mip level or two at
 * the 12 m tile GRASS_TILE_M sets; 512² on weak devices, where the render scale
 * would throw the detail away anyway.
 *
 * Note there is no `applyLuminanceNoise` pass here any more. It was a full
 * 1M-pixel getImageData/putImageData round trip whose entire job — high
 * frequency — the blade field now does far better, and in colour.
 */
function createGrassTexture(
  scene: Scene,
  name: string,
  palette: MapVisualPalette,
  seed: number,
  highDetail: boolean,
): DynamicTexture {
  const size = highDetail ? 1024 : 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const spec = buildGrassTextureSpec(seed);
  const ramp = grassBladeRamp(palette);

  context.fillStyle = palette.grassBase;
  context.fillRect(0, 0, size, size);

  // Large tonal fields first — the layer that still reads once blades have
  // mipped away at distance.
  const patchTones = [palette.grassDeep, palette.grassAlt, palette.grassDry];
  context.globalAlpha = 0.2;
  for (const patch of spec.patches) {
    context.fillStyle = patchTones[patch.tone] ?? palette.grassBase;
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  // Kept low on purpose: these are hard-edged discs, and any higher they read
  // as circles drawn on the lawn rather than as mottling under it.
  context.globalAlpha = 0.22;
  context.fillStyle = palette.grassAlt;
  for (const blob of spec.blobs) {
    if (!blob.alt) continue;
    context.beginPath();
    context.arc(blob.x * size, blob.y * size, blob.r * size, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.3;
  context.fillStyle = palette.grassDry;
  for (const patch of spec.bare) {
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.3;
  context.fillStyle = palette.dirtShoulder;
  for (const speckle of spec.speckles) {
    context.beginPath();
    context.arc(speckle.x * size, speckle.y * size, size / 232, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  paintGrassBlades(context, size, spec.blades, ramp, 0.7);

  // Flora last, so a flower head sits on top of the blades rather than under.
  // Pulled most of the way back toward the grass: at full accent these are
  // 4-6 px on the tile, which at driving distance reads as white litter
  // scattered over the lawn rather than as flowers.
  context.fillStyle = mixHexColors(palette.grassAlt, palette.floraAccent, 0.55);
  context.globalAlpha = 0.45;
  for (const flower of spec.flora) {
    context.beginPath();
    context.arc(flower.x * size, flower.y * size, flower.r * size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * A parterre bed's groundcover, one tile.
 *
 * Deliberately NOT the lawn texture: a bed is planted colour — darker foliage
 * carrying flower heads at full strength, where the lawn pulls its flora most
 * of the way back so it reads as chance. Shares the lawn's spec so the drift
 * pattern is the same species of noise, just dressed differently.
 */
function createFlowerbedTexture(
  scene: Scene,
  name: string,
  palette: MapVisualPalette,
  seed: number,
): DynamicTexture {
  const size = 512;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  const spec = buildGrassTextureSpec(seed);

  context.fillStyle = mixHexColors(palette.grassDeep, palette.dirtShoulder, 0.25);
  context.fillRect(0, 0, size, size);

  // Foliage mottling — the lawn's discs, denser and darker.
  context.globalAlpha = 0.2;
  context.fillStyle = palette.grassAlt;
  for (const blob of spec.blobs) {
    context.beginPath();
    context.arc(blob.x * size, blob.y * size, blob.r * size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 0.25;
  context.fillStyle = palette.grassDeep;
  for (const patch of spec.patches) {
    context.beginPath();
    context.arc(patch.x * size, patch.y * size, patch.r * size, 0, Math.PI * 2);
    context.fill();
  }

  // Flower heads, two tones so the drift reads as planting rather than noise.
  context.globalAlpha = 0.8;
  for (const [index, head] of [...spec.flora, ...spec.speckles].entries()) {
    context.fillStyle =
      index % 2 === 0
        ? palette.floraAccent
        : mixHexColors(palette.floraAccent, "#ffffff", 0.35);
    context.beginPath();
    context.arc(head.x * size, head.y * size, size / 90, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/**
 * The detail tile fed to `StandardMaterial.detailMap`.
 *
 * **A detail map is not an image — it is four independent channels, and three
 * of them have a non-zero neutral.** `default.fragment` reads
 * `baseColor.rgb * 2 · mix(0.5, detailColor.r, diffuseBlendLevel)`, so **R
 * neutral is 0.5**; and `bumpFragment` reads the tangent-space normal out of
 * **alpha and green** — `detailNormalRG = detailColor.wy * 2 - 1`, with
 * `B = sqrt(1 - |RG|²)` — so **A and G neutral is also 0.5**.
 *
 * That alpha channel is the trap. A 2D canvas is fully opaque, so A = 1 decodes
 * as normal.x = 1, which forces B to zero: a tangent normal lying flat along
 * the surface, pointing 90° away from the sun. It does not look subtle — it
 * turned Tokyo's grass from (24,68,25) to (3,10,0), i.e. black — and
 * `bumpLevel = 0` cannot rescue it, because the zeroed `.xy` leaves a
 * zero-length vector rather than an upright one.
 *
 * So the blades are painted as greys (carrying R) and a final pass overwrites
 * G and A with 128, which is the flat normal. Give this a real normal only by
 * authoring those two channels deliberately.
 */
function createGrassDetailTexture(
  scene: Scene,
  name: string,
  seed: number,
): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture(name, size, scene, true);
  const context = textureContext(texture);
  context.fillStyle = "#808080";
  context.fillRect(0, 0, size, size);
  const ramp = ["#a8a8a8", "#949494", "#6e6e6e", "#5a5a5a"];
  paintGrassBlades(context, size, buildGrassDetailSpec(seed), ramp, 0.55);

  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    data[index + 1] = 128; // normal.y neutral
    data[index + 3] = 128; // normal.x neutral — NOT 255, see above
  }
  context.putImageData(image, 0, 0);

  // `update(invertY, premulAlpha)` — premultiply must stay off, or the 0.5
  // alpha just written would halve the red channel the diffuse blend reads.
  texture.update(true, false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

function createBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function createCylinder(
  scene: Scene,
  name: string,
  options: {
    height: number;
    diameter?: number;
    diameterTop?: number;
    diameterBottom?: number;
    tessellation?: number;
  },
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { tessellation: 8, ...options },
    scene,
  );
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function createIcoSphere(
  scene: Scene,
  name: string,
  radius: number,
  position: Vector3,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const mesh = MeshBuilder.CreateIcoSphere(
    name,
    { radius, subdivisions: 1 },
    scene,
  );
  mesh.position.copyFrom(position);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

// --- Building facades ------------------------------------------------------
// Boxes get windows from a tiled facade texture: one "tile" is a grid of window
// cells, and each box repeats it via faceUV so window size stays roughly
// constant regardless of building size. The wall colour is baked into a
// per-palette diffuse texture (dark glass + warm lit panes); a single shared
// emissive texture lights the same lit panes so cities glow at dusk.
const FACADE_COLS = 4;
const FACADE_ROWS = 6;
const FACADE_WIN_W_M = 3;
const FACADE_WIN_H_M = 3.2;
const FACADE_TEX_W = 256;
const FACADE_TEX_H = 384;

interface FacadeCell {
  readonly row: number;
  readonly col: number;
  readonly lit: boolean;
  readonly shade: number;
}

function buildFacadeLayout(seed: number): readonly FacadeCell[] {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const cells: FacadeCell[] = [];
  for (let row = 0; row < FACADE_ROWS; row += 1) {
    for (let col = 0; col < FACADE_COLS; col += 1) {
      cells.push({
        row,
        col,
        lit: rand() < 0.26,
        shade: 40 + Math.floor(rand() * 26),
      });
    }
  }
  return cells;
}

// Fixed so every building's window grid + lit pattern is stable and the diffuse
// and emissive tiles line up.
const FACADE_LAYOUT = buildFacadeLayout(0x9e3779b1);

function facadeColorHex(color: Color3): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function facadeCellMetrics() {
  const cellW = FACADE_TEX_W / FACADE_COLS;
  const cellH = FACADE_TEX_H / FACADE_ROWS;
  const marginX = cellW * 0.24;
  const marginY = cellH * 0.2;
  return { cellW, cellH, marginX, marginY, winW: cellW - marginX * 2, winH: cellH - marginY * 2 };
}

function makeFacadeEmissiveTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    "facade-emissive",
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(texture);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  const { cellW, cellH, marginX, marginY, winW, winH } = facadeCellMetrics();
  for (const cell of FACADE_LAYOUT) {
    if (!cell.lit) continue;
    ctx.fillStyle = "rgb(255,208,138)";
    ctx.fillRect(cell.col * cellW + marginX, cell.row * cellH + marginY, winW, winH);
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

function makeFacadeDiffuseTexture(
  scene: Scene,
  name: string,
  wallColor: Color3,
): DynamicTexture {
  const texture = new DynamicTexture(
    name,
    { width: FACADE_TEX_W, height: FACADE_TEX_H },
    scene,
    true,
  );
  const ctx = textureContext(texture);
  ctx.fillStyle = facadeColorHex(wallColor);
  ctx.fillRect(0, 0, FACADE_TEX_W, FACADE_TEX_H);
  const { cellW, cellH, marginX, marginY, winW, winH } = facadeCellMetrics();
  for (const cell of FACADE_LAYOUT) {
    const x = cell.col * cellW + marginX;
    const y = cell.row * cellH + marginY;
    if (cell.lit) {
      ctx.fillStyle = "#e8c684";
    } else {
      const s = cell.shade;
      ctx.fillStyle = `rgb(${s},${s + 8},${s + 18})`;
    }
    ctx.fillRect(x, y, winW, winH);
  }
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

function facadeFaceUV(width: number, height: number, depth: number): Vector4[] {
  // Whole window rows/cols sized in real-world metres, so windows stay a
  // consistent size whether the building is short or a tower (the V/U ranges
  // land on exact row/column boundaries, so no half-windows at the roofline).
  const rows = Math.max(2, Math.round(height / FACADE_WIN_H_M));
  const cols = (span: number) => Math.max(2, Math.round(span / FACADE_WIN_W_M));
  const v = rows / FACADE_ROWS;
  const faceUV: Vector4[] = [];
  for (let i = 0; i < 6; i += 1) faceUV.push(new Vector4(0, 0, 0, 0));
  faceUV[0] = new Vector4(0, 0, cols(width) / FACADE_COLS, v);
  faceUV[1] = new Vector4(0, 0, cols(width) / FACADE_COLS, v);
  faceUV[2] = new Vector4(0, 0, cols(depth) / FACADE_COLS, v);
  faceUV[3] = new Vector4(0, 0, cols(depth) / FACADE_COLS, v);
  faceUV[4] = new Vector4(0, 0, 0.02, 0.02);
  faceUV[5] = new Vector4(0, 0, 0.02, 0.02);
  return faceUV;
}

function makeFacadeMaterial(
  scene: Scene,
  name: string,
  wallColor: Color3,
  emissive: DynamicTexture,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.diffuseTexture = makeFacadeDiffuseTexture(scene, `${name}-diffuse`, wallColor);
  material.emissiveTexture = emissive;
  material.emissiveColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  return material;
}

function createFacadeBox(
  scene: Scene,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  position: Vector3,
  material: StandardMaterial,
): Mesh {
  const mesh = MeshBuilder.CreateBox(
    name,
    {
      ...dimensions,
      faceUV: facadeFaceUV(dimensions.width, dimensions.height, dimensions.depth),
      wrap: true,
    },
    scene,
  );
  mesh.position.copyFrom(position);
  // Every caller passes height/2; the lift keeps the base plate off the ground
  // plane and clear of the pavement band (BUILDING_BASE_CLEARANCE_M). Applied
  // here rather than at the four call sites so a fifth cannot reintroduce a
  // coplanar plate.
  mesh.position.y += BUILDING_GROUND_LIFT;
  setMeshMaterial(mesh, material);
  return mesh;
}

/**
 * A flat panel with a chamfered outline, facing -Z, with planar UVs.
 *
 * Neither existing primitive can carry a mirror image on a shape with cut
 * corners: `MeshBuilder.CreatePlane` only makes rectangles, and
 * `createExtrudedPrism` wraps its UVs around the section rather than across the
 * face, so a texture on it comes out smeared. This fans a convex outline from
 * its centre and takes UVs straight off the vertex positions, so the reflection
 * sits square on the glass whatever the outline is.
 */
function createChamferedPanel(
  scene: Scene,
  name: string,
  outline: readonly Readonly<{ x: number; y: number }>[],
  width: number,
  height: number,
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  for (const point of outline) {
    positions.push((point.x * width) / 2, (point.y * height) / 2, 0);
    uvs.push(point.x / 2 + 0.5, point.y / 2 + 0.5);
  }
  const indices: number[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const next = ((index + 1) % outline.length) + 1;
    indices.push(0, next, index + 1);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

function createExtrudedPrism(
  scene: Scene,
  name: string,
  width: number,
  crossSection: readonly Readonly<{ y: number; z: number }>[],
  material: StandardMaterial,
  parent?: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = width / 2;
  const pointCount = crossSection.length;

  for (const x of [-halfWidth, halfWidth]) {
    for (const point of crossSection) {
      positions.push(x, point.y, point.z);
    }
  }

  for (let index = 0; index < pointCount; index += 1) {
    const next = (index + 1) % pointCount;
    const left = index;
    const leftNext = next;
    const right = pointCount + index;
    const rightNext = pointCount + next;
    indices.push(left, right, rightNext, left, rightNext, leftNext);
  }
  for (let index = 1; index < pointCount - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(pointCount, pointCount + index + 1, pointCount + index);
  }

  // A planar unwrap round the section. Nothing built from a prism is textured
  // today, but Babylon refuses to merge meshes whose attribute sets differ, and
  // every MeshBuilder primitive carries UVs — so a prism without them cannot be
  // merged with a box, which is exactly what the cockpit does.
  const uvs: number[] = [];
  const lastPoint = Math.max(1, pointCount - 1);
  for (const v of [0, 1]) {
    for (let index = 0; index < pointCount; index += 1) {
      uvs.push(index / lastPoint, v);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.parent = parent ?? null;
  setMeshMaterial(mesh, material);
  return mesh;
}

const LOADING_MODELS_LABEL = "Loading models…";
const FINISHING_TOUCHES_LABEL = "Finishing touches…";

/**
 * Relative share of the "Preparing your drive…" bar each real build phase in
 * `preloadVehicleModels` gets. Profiled with performance.now() around each
 * phase on both the NYC and London maps (production build): loading models —
 * network fetch plus glTF decode, the only phase with byte-level signal and
 * the only one that scales with connection speed — is consistently ~80% of
 * wall time regardless of map size, because every other phase is local JS/GPU
 * work. The rest are real milestones sized off that same profiling; each
 * fires the instant its phase actually finishes, never a timer. Must sum to
 * 1, though nothing breaks if it drifts slightly — `preloadVehicleModels`
 * hardcodes the final report to exactly 1 regardless, so a forgotten update
 * here only throws off the mid-sequence jump sizes, not the end state.
 */
const LOAD_PHASE_WEIGHTS = {
  models: 0.8,
  vehiclesAndPeople: 0.08,
  city: 0.09,
  warmUp: 0.03,
} as const;

/**
 * Waits a full paint cycle. Two rAFs, not one: a promise resolved inside a
 * single requestAnimationFrame callback still runs its continuation as a
 * microtask of that same callback, before the browser paints — a state update
 * flushed there would never reach the screen ahead of the next (synchronous,
 * potentially heavy) build phase. Scheduling the second rAF from inside the
 * first defers the resolve to the following frame, by which point the current
 * one has already painted. Not `setTimeout`: a macrotask is not guaranteed to
 * land after a paint the way a *second* rAF is — rAF is specifically defined
 * as running immediately before the browser's next render, so waiting for two
 * of them is the one mechanism that's actually certain, not just usually
 * right. Used only to let a loading-progress update actually reach the screen
 * between build phases — never in the per-frame render path.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

class BabylonGameSession {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly player: TransformNode;
  private readonly playerExterior: TransformNode;
  private readonly playerCockpit: TransformNode;
  private steeringAssembly: TransformNode | null = null;
  /** Speedometer then tachometer pivots, spun in updatePlayerVisuals. */
  private gaugeNeedles: TransformNode[] = [];
  /** Glass, tint band and wipers — the first things dropped on the blurriest
   * touch rung, since the panes are the only fill-rate cost in the cabin. */
  private windscreenParts: Mesh[] = [];
  private readonly thirdCamera: ArcRotateCamera;
  private readonly firstCamera: UniversalCamera;
  private readonly rearCamera: UniversalCamera;
  private readonly simulation: SimulationCore;
  /**
   * The same solids the simulation resolves the car against, kept so a staged
   * cutscene can ask what is between its camera and the action.
   *
   * Retained here rather than read back off the core: the core takes them as
   * config and owes nobody a view of them, and building a second set would be
   * two answers to "what is solid" that are free to disagree.
   */
  private readonly stagedBlockers: readonly StagedBlocker[];
  private simulationSnapshot: SimulationSnapshot;
  private playerVehicleVisual: VehicleMeshVisual | null = null;
  /** The player-as-cyclist rig (career bicycle days); null on car days. */
  private playerCyclistVisual: CharacterVisual | null = null;
  private modelsReady = false;
  private readyEmitted = false;
  private readonly npcVehicles: NpcVehicle[] = [];
  private readonly pedestrians: Pedestrian[] = [];
  /**
   * Curbside standing spot (+facing) for every place a gig can send you —
   * authored venues and generated street addresses alike, keyed by stop id.
   */
  private readonly gigVenueCurbside = new Map<
    string,
    { x: number; z: number; facing: number }
  >();
  /**
   * The on-road stop point for each gig stop: the lane anchor a car actually
   * drives to (the arrival radius is centred here), as opposed to the kerb spot
   * 4.5 m off it where the rider waits. A rider-pickup beacon uses this so the
   * post marks the road and not the customer standing on the kerb.
   */
  private readonly gigVenueRoadStop = new Map<
    string,
    { x: number; z: number }
  >();
  private riderVisual: ActorVisual | null = null;
  private riderNode: TransformNode | null = null;
  private riderVenuePlaced: string | null = null;
  /**
   * Front-door point for each gig stop: a measured venue's face centre, or a
   * street address's building line. Where the delivery errand actor vanishes.
   */
  private readonly gigVenueDoors = new Map<string, { x: number; z: number }>();
  /** The interaction cutscene being performed, if any. While set, driving
   * input reads as zero and the third-person camera holds the staged shot. */
  private activeCutscene: ActiveCutscene | null = null;
  /** Highest request nonce already staged, so option echoes can't restart. */
  private handledCutsceneNonce = 0;
  /**
   * Ambient vehicle held off screen for the running scene, keyed by simulation
   * id rather than render slot: the traffic stop stands its own patrol in for
   * the one that clocked you, and a slot can recycle into a different vehicle
   * within the ten seconds the scene lasts.
   */
  private hiddenNpcSimulationId: string | null = null;
  /** Suspension dip when somebody gets in/out: half-sine over its window. */
  private cutsceneDipSeconds = 0;
  private cutsceneDipOffset = 0;
  private gigMarkerNode: TransformNode | null = null;
  private gigMarkerPlaced: string | null = null;
  private gigMarkerCarrying = false;
  private gigMarkerRidePickup = false;
  /** Venues/stations shown on their procedural box because the glb had not
   * preloaded yet; upgraded to models once preload finishes. */
  private readonly deferredProps: {
    kind: string;
    x: number;
    z: number;
    heading: number;
    fallback: TransformNode;
    label?: string;
  }[] = [];
  /** glb URLs of the current map's building sets, preloaded off the critical path. */
  private buildingModelUrls: string[] = [];
  /**
   * This map's park planting glbs. Deliberately NOT in `buildingModelUrls`,
   * even though both are map-scoped and preloaded together: everything in that
   * list is treated as a building, and `applyBuildingNightGlow` gives each of
   * them a warm sodium self-glow. Trees listed there came out tan.
   */
  private natureModelUrls: string[] = [];
  /** Blocks that dress with instanced glb building sets once their models load;
   * `buildFallback` builds procedural facade boxes if the models never arrive. */
  private readonly pendingBuildingBlocks: {
    block: GameCanvasMapPack["geometry"]["blocks"][number];
    setId: BuildingSetId;
    buildFallback: () => void;
  }[] = [];
  /** Static scenery (instanced buildings + roadside props) whose world matrices
   * are frozen once after the first render, so the dense city stops paying a
   * per-frame matrix + bounding-sync cost across ~9k meshes. Parents precede
   * children so the freeze pass computes the chain in order. */
  private readonly staticSceneryFreeze: TransformNode[] = [];
  /**
   * Cairo's rooftop water tanks and satellite dishes, as two hidden master
   * meshes the instanced street wall clones from. They belong to
   * `buildEnvironment` (which owns the Cairo materials) but are consumed by
   * `buildInstancedBuildings`, which only runs after the model preload — hence
   * the field rather than a local.
   */
  private cairoRoofClutterMasters: {
    readonly tank: Mesh;
    readonly dish: Mesh;
  } | null = null;
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
  private visualElapsedSeconds = 0;
  /** One source mesh batches every painted zebra stripe into one draw family. */
  private crosswalkStripeMaster: Mesh | null = null;
  /** Fraction of each block's building wall to build. 1 on desktop; thinned on
   * touch / low-core devices so phones stay playable. */
  private buildingKeepFraction = 1;
  /**
   * Touch or few-core device. The quality tier `buildingKeepFraction` is
   * derived from, kept as its own field because more than one subsystem now
   * needs the boolean rather than the fraction — the grass tile drops to 512²
   * and the ground detail map is switched off entirely.
   */
  private lowSpec = false;
  /** Shared fine grass tile for `detailMap`; built lazily, once per session. */
  private grassDetailTexture: DynamicTexture | null = null;
  /** One grass material for every park on the map; built lazily. */
  private parkLawnMaterial: StandardMaterial | null = null;
  /** One gravel material for every park path on the map; built lazily. */
  private parkPathMaterial: StandardMaterial | null = null;
  /** The gravel tile those materials share; built lazily with the first. */
  private parkPathTexture: DynamicTexture | null = null;
  /** Crossing-path sibling of `parkPathMaterial`, one offset tier deeper. */
  private parkPathCrossMaterial: StandardMaterial | null = null;
  /** Gravel again, on the bed tier — temple courts a path may cross. */
  private parkCourtMaterial: StandardMaterial | null = null;
  /** Flowerbed groundcover for parterres; built lazily. */
  private parkBedMaterial: StandardMaterial | null = null;
  /** One stone material for every park boundary wall; built lazily. */
  private parkWallMaterial: StandardMaterial | null = null;
  /** Keep-out circles (gas station + gig-venue lots) so the block street wall
   * never drops a scenery building on top of an interactive POI. */
  private readonly buildingExclusions: { x: number; z: number; radius: number }[] = [];
  /** Sidewalk vendor carts to instantiate once their glbs preload. */
  private readonly pendingVendors: { config: StreetPropConfig; x: number; z: number; yaw: number }[] = [];
  /**
   * Park planting waiting on the model preload. Split at collection time:
   * `pendingParkProps` become individual knockable instances, the thickets
   * merge one mesh per cell. Both need glb masters, which only exist once
   * `preloadVehicleModels` has run — the same reason vendor carts queue.
   */
  private readonly pendingParkProps: ParkPlacement[] = [];
  private readonly pendingParkThickets: ParkPlacement[] = [];
  /** River craft to instantiate once the boat glbs preload. */
  private readonly pendingWaterBoats: { bodyId: string; placement: WaterBoatPlacement }[] = [];
  private readonly waterBoatMasters = new Map<
    number,
    { mesh: Mesh; scale: number; yOffset: number; yawOffset: number } | null
  >();
  /** Knockable street furniture, bucketed for the per-step broad phase. */
  private readonly destructibleGrid = new Map<string, DestructibleProp[]>();
  private readonly activePropFalls: ActivePropFall[] = [];
  private impactPuffs: ParticleSystem | null = null;
  /** Decaying camera-kick amplitude fed by collision events. */
  private impactKick = 0;
  private impactShakeSeconds = 0;
  /** Hood smoke shown while the car's condition is low. */
  private damageSmoke: ParticleSystem | null = null;
  private readonly damageSmokeEmitter = new Vector3(0, -50, 0);
  /** Sidewalk positions (+ toward-road yaw) for the distributed animated crowd,
   * spawned as pedestrians once the character glbs preload. */
  private crowdSim: CrowdSim | null = null;
  private crowdRenderer: CrowdRenderer | null = null;
  private crowdDirty = false;
  private readonly crowdProbePoint = new Vector3();
  /** The gameplay camera's frustum for the crowd probes, refreshed each
   * fixed step. scene.frustumPlanes is unusable here: it holds whichever
   * camera rendered last, and in first-person that is the rear-view mirror —
   * a probe facing backward calls "hidden" exactly what is dead ahead. */
  private readonly crowdFrustumPlanes = [
    new Plane(0, 0, 0, 0),
    new Plane(0, 0, 0, 0),
    new Plane(0, 0, 0, 0),
    new Plane(0, 0, 0, 0),
    new Plane(0, 0, 0, 0),
    new Plane(0, 0, 0, 0),
  ];
  private readonly crowdFrustumMatrix = new Matrix();
  /** Cached per-map pavement graph; null once known to be unavailable. */
  private pavementGraph: PavementGraph | null | undefined;
  /** The sidewalk band the graph was built with; drives the crowd's scatter. */
  private pavementSidewalkWidthM = 0;
  private complexions: readonly CharacterTone[] | undefined;
  private hairTones: readonly CharacterTone[] | undefined;
  private roadUserPedSim: CrowdSim | null = null;
  private roadUserCycleSim: CrowdSim | null = null;
  private readonly railRoadUsers: Array<{
    pedestrian: Pedestrian;
    kind: "pedestrian" | "cyclist";
    index: number;
  }> = [];
  /** Per-url merged building master mesh (all submeshes baked into one, keeping
   * a MultiMaterial), built lazily and hidden. Every placement is a single
   * `createInstance` of it, so a building costs one scene mesh (one cull check)
   * instead of ~15 — the fix for the culling spike on fast/turning driving.
   * Keys are the url, or `url#variantId` for re-branded storefront masters.
   * null = merge failed for that url (falls back to the multi-mesh path). */
  private readonly buildingMasters = new Map<string, Mesh | null>();
  private readonly storefrontSignMaterials = new Map<string, StandardMaterial>();
  /** Shared by both sign families; see `signPostMaster`. */
  private signPost: Mesh | null = null;
  private signalLensMaster: Mesh | null = null;
  private trafficCameraMaster: Mesh | null = null;
  private signalRedMaterial: StandardMaterial | null = null;
  private signalAmberMaterial: StandardMaterial | null = null;
  private signalGreenMaterial: StandardMaterial | null = null;
  private readonly authoredSignalHeads: AuthoredSignalHeadVisual[] = [];
  private readonly railwayCrossingVisuals: RailwayCrossingVisual[] = [];
  /**
   * The enforcement cameras, resolved once from the map's signal controls when
   * the scene is built — never per frame, and never from the render tree.
   *
   * A red light names the light it was run (`evidence.trafficLightId`, which is
   * the approach id), so that one is answered exactly rather than by proximity:
   * a camera tickets the junction it watches and no other. Speeding names no
   * signal at all, so it falls back to the positions.
   */
  private readonly trafficCameraControlIdByLightId = new Map<string, string>();
  private readonly trafficCameraPoints: GameCanvasPoint[] = [];
  private readonly disposers: Array<() => void> = [];
  private callbacks: SessionCallbacks;
  private options: SessionOptions;
  private cameraMode: CameraMode;
  private paused: boolean;
  private disposed = false;
  private completed = false;
  private contextLost = false;
  private accumulator = 0;
  private lastFrameTime = 0;
  private lastHudTime = 0;
  /** Last non-zero posted limit — see `postedSpeedLimit`. */
  private lastPostedSpeedLimit = 0;
  // Substage timing sums/maxima since the last __sideswapPerfDebug poll
  // (polling drains them). Flat typed arrays so the hot loops allocate nothing.
  private readonly perfSumMs = new Float64Array(PERF_STAGE_COUNT);
  private readonly perfMaxMs = new Float64Array(PERF_STAGE_COUNT);
  private perfFrames = 0;
  private perfFixedSteps = 0;
  private perfDrawCalls = 0;
  private lastSpeedingEvent = -10_000;
  private collisionGraceUntil = 0;
  private wrongSideSeconds = 0;
  private offRoadSeconds = 0;
  private score = 100;
  private ruleElapsedSeconds = 0;
  private readonly authoredRuleCooldownUntil = new Map<string, number>();
  private readonly restrictedLaneSeconds = new Map<string, number>();
  private checkpoint = { x: 0, z: START_Z, heading: 0 };
  private instruction = "Settle into the correct lane and drive toward the first junction.";
  private readonly routePoints: readonly GameCanvasPoint[];
  private readonly authoredCheckpoints: readonly AuthoredCheckpoint[];
  private readonly checkpointVisuals: GuidanceVisual[] = [];
  private finishVisual: GuidanceVisual | null = null;
  private readonly routeChevronVisuals: RouteChevronVisual[] = [];
  private guidanceCueVisual: GuidanceVisual | null = null;
  private guidanceCueKey: string | null = null;
  private readonly maneuverPhases = new Map<string, string>();
  private readonly triggeredPrompts = new Set<string>();
  private routeLength = 0;
  private routeProgress = 0;
  private routeSegment = 0;
  private checkpointIndex = 0;
  private checkpointLabel = "Start";
  private activeTrafficSide: TrafficSide;
  private hornUntil = 0;
  private audio: DriveAudio | null = null;
  private hornHeld = false;
  private keyboard: AnalogInput = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
  private touch: AnalogInput = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
  /** True while a lifted thumb's steering is easing back to centre. */
  private touchSteerReleasing = false;
  /** Null on desktop, which is deliberately not governed. */
  private renderScaling: RenderScalingState | null;
  private lastRenderScalingCheck = 0;
  /** Set when the scene reports ready; the governor stays quiet until then. */
  private renderScalingArmedAt = Number.POSITIVE_INFINITY;
  private gamepad: AnalogInput = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
  private gamepadButtons: boolean[] = [];
  private gamepadConnected = false;
  private readonly inputRouter: AdaptiveInputRouter;
  private indicatorBlinkSeconds = 0;
  private previousIndicatorSignal: TurnIndicator = "off";
  private previousIndicatorBlinkOn = false;
  private trafficLightSeconds = 0;
  private trafficLightIsRed = false;
  private swipePointer: number | null = null;
  private swipeStartX = 0;
  private playerState: PlayerState;
  private displayedX = 0;
  private displayedZ = START_Z;
  private displayedHeading = 0;
  private cameraMotionSeconds = 0;
  // Set by createSkyAndHorizon from the map's fog band, applied to every
  // camera in the constructor. Babylon's default far plane is 10km.
  private cameraFarPlaneM = 10_000;
  /** Lane lookup for per-frame guidance code; null on the yard fallback. */
  private readonly laneById: Map<
    string,
    GameCanvasMapPack["laneGraph"]["lanes"][number]
  > | null;
  // mergedInput's reused result — its consumers all read synchronously.
  private readonly mergedInputScratch: AnalogInput = {
    throttle: 0,
    brake: 0,
    reverse: 0,
    steer: 0,
    quickLook: 0,
  };
  // updateCamera scratch, reused every frame so the camera path allocates
  // nothing. The target scratch is retained by setTarget between frames
  // (ArcRotate keeps the reference) — which is exactly why every setTarget
  // call here passes allowSamePosition=true: setTarget's change check is
  // `currentTarget.equals(newTarget)`, and against its own retained object
  // that is always true, so without the flag it never rebuilds the
  // spherical state and _getViewMatrix clobbers every position write with
  // the stale pose (the camera froze at its construction offset).
  private readonly cameraForwardScratch = new Vector3();
  private readonly cameraRightScratch = new Vector3();
  private readonly cameraBaseScratch = new Vector3();
  private readonly cameraTargetScratch = new Vector3();
  private readonly cameraDesiredScratch = new Vector3();
  private lastSimulationHonkActive = false;
  private lastSimulationCoachMessage: string | null = null;
  private visualPalette: MapVisualPalette = resolveMapVisualPalette("orientation-yard");
  private shadowGenerator: ShadowGenerator | null = null;
  // Static shadow casters bucketed by cell, so the periodic refresh queries
  // a ring instead of scanning every registered caster in the city. The
  // static sublist and the final render list are persistent and rebuilt in
  // place — the refresh allocates nothing in steady state.
  private readonly shadowCasterCells = new Map<
    string,
    Array<{ mesh: AbstractMesh; x: number; z: number; castsShadow: boolean }>
  >();
  private readonly shadowStaticList: AbstractMesh[] = [];
  private readonly shadowRenderList: AbstractMesh[] = [];
  private shadowStaticAnchorX = Number.POSITIVE_INFINITY;
  private shadowStaticAnchorZ = Number.POSITIVE_INFINITY;
  private shadowRefreshSeconds = Number.POSITIVE_INFINITY;
  // Mirror render lists. `mirrorAlways` holds the map-spanning surfaces that no
  // spatial cull can meaningfully reject — an avenue's road mesh is hundreds of
  // metres long, and the sky is everywhere. `mirrorCandidates` is the ring
  // gathered from the cell hash, re-gathered on movement; `mirrorRenderList` is
  // that ring frustum-tested against the mirror camera, rebuilt in place per
  // render. Babylon's ObjectRenderer culls nothing, so this is the whole cull.
  private readonly mirrorAlways: AbstractMesh[] = [];
  private readonly mirrorCandidates: AbstractMesh[] = [];
  private readonly mirrorRenderList: AbstractMesh[] = [];
  private mirrorGatheredX = Number.POSITIVE_INFINITY;
  private mirrorGatheredZ = Number.POSITIVE_INFINITY;
  private mirrorGatheredHeading = Number.POSITIVE_INFINITY;
  private rearViewTexture: RenderTargetTexture | null = null;
  private mirrorRenderCount = 0;
  /** Cleared by the blurriest render rung, which sheds the mirrors entirely. */
  private mirrorsAllowed = true;
  private rearViewPanel: Mesh | null = null;
  private wingMirrorTexture: RenderTargetTexture | null = null;
  private wingMirrorCamera: UniversalCamera | null = null;
  private wingMirrorRig: TransformNode | null = null;
  private effectsPipeline: DefaultRenderingPipeline | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options: SessionOptions,
    callbacks: SessionCallbacks,
  ) {
    this.canvas = canvas;
    this.options = options;
    this.callbacks = callbacks;
    // Two-wheelers have no cockpit to sit in — the first-person camera would
    // be a car-interior lie, so bike and motorbike days are third-person only.
    this.cameraMode =
      options.playerVehicle && options.playerVehicle.visualKind !== "car"
        ? "third"
        : options.cameraMode;
    this.inputRouter = new AdaptiveInputRouter(
      options.inputCapabilities,
      options.reducedMotion,
      (presentation) => this.callbacks.onInputPresentationChange?.(presentation),
    );
    this.paused = options.paused;
    this.activeTrafficSide = options.lesson?.trafficSide ?? options.trafficSide;
    this.routePoints = scenarioRoutePoints(options.lesson, options.mapPack);
    this.authoredCheckpoints = scenarioCheckpoints(options.lesson, options.mapPack);
    for (let index = 0; index < this.routePoints.length - 1; index += 1) {
      this.routeLength += Math.hypot(
        this.routePoints[index + 1].x - this.routePoints[index].x,
        this.routePoints[index + 1].z - this.routePoints[index].z,
      );
    }
    // Per-vehicle physics land after the adapter's config so a career
    // vehicle's caps override the scenario baseline; free drive passes null
    // and keeps the adapter's numbers untouched.
    const simulationConfig = buildSimulationCoreConfig({
      lesson: options.lesson,
      mapPack: options.mapPack,
      trafficSide: this.activeTrafficSide,
      speedUnit: options.speedUnit,
      touchFirst: options.inputCapabilities.touchFirst,
    });
    this.stagedBlockers = stagedBlockersOf(
      simulationConfig.staticObstacles ?? [],
    );
    this.simulation = new SimulationCore({
      ...simulationConfig,
      ...(options.vehiclePhysics ?? {}),
    });
    if (options.paused) this.simulation.setPaused(true);
    this.simulationSnapshot = this.simulation.getSnapshot();
    const start = this.simulationSnapshot.player;
    this.playerState = {
      x: start.x,
      z: start.z,
      previousX: start.x,
      previousZ: start.z,
      heading: start.heading,
      previousHeading: start.heading,
      speedMps: 0,
      gear: "D",
      indicator: "off",
    };
    this.laneById = options.mapPack
      ? new Map(options.mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]))
      : null;
    this.collisionGraceUntil = eventNow() + 2_000;
    this.checkpoint = { ...start };
    this.displayedX = start.x;
    this.displayedZ = start.z;
    this.displayedHeading = start.heading;
    while (
      this.checkpointIndex < this.authoredCheckpoints.length &&
      Math.hypot(
        start.x - this.authoredCheckpoints[this.checkpointIndex].x,
        start.z - this.authoredCheckpoints[this.checkpointIndex].z,
      ) < 2.5
    ) {
      this.checkpointLabel = this.authoredCheckpoints[this.checkpointIndex].label;
      this.checkpointIndex += 1;
    }
    this.checkpointLabel =
      this.authoredCheckpoints[Math.max(0, this.checkpointIndex - 1)]?.label ??
      "Start";
    const startPrompt = options.lesson?.coachPrompts.find(
      (prompt) => prompt.trigger.type === "start",
    );
    this.instruction =
      startPrompt?.message ??
      options.lesson?.objectives[0]?.label ??
      this.instruction;
    if (startPrompt) this.triggeredPrompts.add(startPrompt.id);

    const touchFirst = options.inputCapabilities.touchFirst;
    this.engine = new Engine(
      canvas,
      // MSAA on the main framebuffer is bypassed anyway — createEffectsPipeline
      // renders through an offscreen target — and on a mobile tile GPU it is the
      // most expensive thing you can ask for. Touch pays for FXAA instead.
      !touchFirst,
      {
        alpha: false,
        antialias: !touchFirst,
        preserveDrawingBuffer: false,
        stencil: true,
        powerPreference: "high-performance",
      },
      true,
    );
    if (this.engine.webGLVersion < 2) {
      this.engine.dispose();
      throw new Error("Curbside Rush requires WebGL 2.");
    }

    // Touch resolution is governed, because a phone cannot simply be pinned to
    // a good number: it throttles, and a career day runs about six minutes.
    // Desktop is not governed and keeps its static level — the DPR curve it
    // always had, now width-capped so a DPR-1 4K monitor stops rendering
    // every physical pixel (see renderScaling.ts for what governing cost).
    // Static means set once here: a window dragged to another monitor keeps
    // the level until the next session rebuild, and never resizes mid-drive.
    this.renderScaling = touchFirst ? createRenderScalingState() : null;
    this.engine.setHardwareScalingLevel(
      this.renderScaling
        ? renderScalingLevel(this.renderScaling)
        : desktopHardwareScalingLevel(
            window.devicePixelRatio || 1,
            canvas.clientWidth || undefined,
          ),
    );
    // Weak devices (touch, or few CPU cores) build a thinner building wall so
    // the dense city stays playable on phones.
    const cores =
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 8;
    const lowSpec = options.inputCapabilities.touchFirst || cores <= 4;
    this.lowSpec = lowSpec;
    this.buildingKeepFraction = lowSpec ? 0.5 : 1;
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.68, 0.84, 0.9, 1);
    // Low, faintly warm ambient: the directional sun and hemisphere fill do
    // the lighting so shadowed faces keep real depth instead of a flat grey wash.
    this.scene.ambientColor = new Color3(0.24, 0.23, 0.21);
    this.scene.skipPointerMovePicking = true;

    this.player = new TransformNode("player-root", this.scene);
    this.playerExterior = new TransformNode("player-exterior", this.scene);
    this.playerCockpit = new TransformNode("player-cockpit", this.scene);
    this.playerExterior.parent = this.player;
    this.playerCockpit.parent = this.player;
    this.buildEnvironment();
    this.buildPlayerCar();
    this.buildTraffic();
    this.applySimulationNpcSnapshots(this.simulationSnapshot);

    this.thirdCamera = new ArcRotateCamera(
      "third-person-camera",
      -Math.PI / 2,
      1.12,
      13,
      Vector3.Zero(),
      this.scene,
    );
    this.thirdCamera.inputs.clear();
    // No radius limits: updateCamera writes position + target every frame,
    // and ArcRotate's authoritative state is spherical — setTarget rebuilds
    // radius from the written position and _checkLimits clamps it, feeding
    // the clamped position back. At speed the chase lag pushed the radius
    // across upperRadiusLimit every other frame, and the clamp's ~0.2m
    // vertical snap-back was the high-speed camera nod. Inputs are cleared
    // and nothing else reads the radius, so the limits guarded nothing.
    this.thirdCamera.lowerRadiusLimit = null;
    this.thirdCamera.upperRadiusLimit = null;
    // Depth precision at distance scales with the near plane (a 24-bit quantum
    // at z metres is ~z²/(minZ·2²⁴), the far plane barely matters): 0.5 gives
    // every surface 5× the separating power 0.1 did, which the mm-scale decal
    // offsets in the Cairo building kit need (CAIRO_DECAL_Z_OFFSET_UNITS).
    // Nothing valid renders within 0.5 m of this camera — its radius is 13 m.
    this.thirdCamera.minZ = 0.5;
    this.thirdCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.thirdCamera.fov = clampHorizontalFieldOfView(options.fieldOfView);
    this.thirdCamera.layerMask = PRIMARY_CAMERA_LAYER_MASK;

    this.firstCamera = new UniversalCamera(
      "first-person-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.firstCamera.inputs.clear();
    // Stays tight: the cockpit shell renders centimetres from this camera, and
    // the wheel-well cutaway distance is derived from minZ. Depth precision in
    // the cockpit view is what it is.
    this.firstCamera.minZ = 0.04;
    this.firstCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.firstCamera.fov = clampHorizontalFieldOfView(options.fieldOfView);
    this.firstCamera.layerMask = PRIMARY_CAMERA_LAYER_MASK;

    this.rearCamera = new UniversalCamera(
      "rear-view-camera",
      Vector3.Zero(),
      this.scene,
    );
    this.rearCamera.inputs.clear();
    // Same depth-precision reasoning as thirdCamera; the mirror shows the road
    // behind the tail, never anything nearer than the bumper.
    this.rearCamera.minZ = 0.25;
    this.rearCamera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.rearCamera.fov = (64 * Math.PI) / 180;
    this.rearCamera.layerMask = WORLD_LAYER_MASK;

    // One far plane for all three cameras, from the fog band the environment
    // chose above. Fog hides but never culls: with the default 10km plane the
    // whole 3km NYC grid was frustum-tested and submitted from anywhere on
    // the map, fully fogged and invisible.
    this.thirdCamera.maxZ = this.cameraFarPlaneM;
    this.firstCamera.maxZ = this.cameraFarPlaneM;
    // The mirror looks a fixed distance back rather than to the fog line: it is
    // a 256px image of the road behind, and everything past the ring the render
    // list is gathered from would be submitted and then never resolve to a
    // pixel worth having.
    this.rearCamera.maxZ = Math.min(this.cameraFarPlaneM, MIRROR_RADIUS_M);
    this.snapChaseCameraToPose();
    // Sane probe planes before the first fixed step ever asks.
    this.refreshCrowdFrustum();

    this.createEffectsPipeline();
    // Before setCameraMode: applyCameraStack registers the render targets, and
    // it can only register what already exists.
    this.buildRearViewMirror();
    this.setCameraMode(this.cameraMode, false);
    this.installListeners();
    this.installDebugHooks();
    // Built here rather than lazily on first sound: the wavetables and noise
    // buffers cost a few milliseconds, and this runs behind the loading overlay
    // instead of hitching a live frame. Null when Web Audio is unavailable.
    this.audio = DriveAudio.create(
      { master: this.options.masterVolume, effects: this.options.effectsVolume },
      this.options.inputCapabilities.touchFirst,
      this.options.playerVehicle?.visualKind === "bicycle",
      this.options.playerVehicle?.visualKind === "motorbike"
        ? MOTORBIKE_ENGINE_PROFILE
        : undefined,
    );
    this.updatePlayerVisuals(1);
    this.callbacks.onInputPresentationChange?.(this.inputRouter.getPresentation());

    this.lastFrameTime = performance.now();
    this.engine.runRenderLoop(this.renderFrame);

    // Follow the standard game pattern: keep the loading overlay up until the
    // vehicle/character models have preloaded, then reveal the scene. `ready`
    // now fires from preloadVehicleModels (via markReady), not here.
    void this.preloadVehicleModels();
  }

  /**
   * Lifts the loading gate: emits `ready` so the React overlay
   * ("Preparing your drive…") clears and controls/HUD come up. Called
   * once, after the model preload settles (or fails — we still proceed).
   */
  private markReady() {
    if (this.disposed || this.readyEmitted) return;
    this.readyEmitted = true;
    // Arm the resolution governor from here, not from the constructor: the
    // frame rate before this point is model upload and shader warm-up, and
    // judging the device on it drops resolution the instant the scene appears.
    this.renderScalingArmedAt = performance.now() + RENDER_SCALING_WARMUP_MS;
    this.callbacks.onReady?.();
    this.emit("ready", "Training yard ready.");
    this.publishHud(true);
  }

  updateCallbacks(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
  }

  updateOptions(options: Partial<SessionOptions>) {
    this.options = { ...this.options, ...options };
    if (typeof options.reducedMotion === "boolean") {
      this.inputRouter.setReducedMotion(options.reducedMotion);
    }
    this.thirdCamera.fov = clampHorizontalFieldOfView(this.options.fieldOfView);
    this.firstCamera.fov = clampHorizontalFieldOfView(this.options.fieldOfView);
    // The mirror quad's size is derived from that field of view, so it has to
    // follow the slider or it drifts out from under its own HUD housing.
    this.layoutMirrorPanels();
    if (options.cameraMode) this.setCameraMode(options.cameraMode, false);
    if (typeof options.paused === "boolean") this.setPaused(options.paused, false);
    this.audio?.setVolumes({
      master: this.options.masterVolume,
      effects: this.options.effectsVolume,
    });
    this.syncRider();
    this.syncGigMarker();
    this.syncDamageSmoke();
    const cutsceneRequest = this.options.cutscene;
    if (cutsceneRequest && cutsceneRequest.nonce !== this.handledCutsceneNonce) {
      this.handledCutsceneNonce = cutsceneRequest.nonce;
      this.startCutscene(cutsceneRequest);
    }
  }

  setTouchAnalog(control: keyof AnalogInput, value: number) {
    this.touch[control] = clamp(value, -1, 1);
    if (value !== 0) this.inputRouter.registerMeaningfulInput("touch");
  }

  /**
   * Look behind. `quickLook` is an angle *selector*, not a -1..1 axis: only
   * magnitudes above 1.5 mean "over your shoulder", which is why the keyboard's
   * look-behind key assigns 2 directly. `setTouchAnalog` clamps to -1..1, so the
   * old touch REAR button could never reach the threshold and silently behaved
   * as a second "look right".
   */
  setTouchLookBehind(on: boolean) {
    this.touch.quickLook = on ? 2 : 0;
    if (on) this.inputRouter.registerMeaningfulInput("touch");
  }

  /** A live drag: takes the wheel straight, cancelling any release in flight. */
  setTouchSteer(value: number) {
    this.touchSteerReleasing = false;
    this.setTouchAnalog("steer", value);
  }

  /**
   * Hands the wheel back. The ease itself runs in `fixedUpdate` rather than in
   * React, so it costs nothing per frame and cannot be interrupted by a render.
   */
  releaseTouchSteer() {
    this.touchSteerReleasing = this.touch.steer !== 0;
    if (!this.touchSteerReleasing) this.touch.steer = 0;
  }

  clearTouch() {
    this.touch = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
    this.touchSteerReleasing = false;
  }

  registerTouchInput() {
    this.inputRouter.registerMeaningfulInput("touch");
  }

  setInputCapabilities(capabilities: InputCapabilities) {
    this.options = { ...this.options, inputCapabilities: capabilities };
    this.inputRouter.setCapabilities(capabilities);
  }

  setPaused(paused: boolean, notify = true) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.simulation.setPaused(true);
    } else if (this.simulation.getSnapshot().status === "incident") {
      this.simulation.resumeAfterIncident();
    } else {
      this.simulation.setPaused(false);
    }
    this.applySimulationSnapshot(this.simulation.getSnapshot());
    this.clearHeldInputs();
    this.audio?.setPaused(paused);
    if (notify) this.callbacks.onPauseChange?.(paused);
    this.publishHud(true);
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  /** Puts the render stack (cameras + exterior/cockpit visibility) into
   * first- or third-person shape. Split from `setCameraMode` because a
   * cutscene borrows the third-person stack without touching the mode. */
  private applyCameraStack(firstPerson: boolean) {
    this.playerExterior.setEnabled(!firstPerson);
    this.playerCockpit.setEnabled(firstPerson);
    this.scene.activeCamera = firstPerson ? this.firstCamera : this.thirdCamera;
    this.scene.activeCameras = [
      firstPerson ? this.firstCamera : this.thirdCamera,
    ];
    this.setMirrorsActive(firstPerson);
  }

  /**
   * Registers or withdraws the mirror render targets.
   *
   * An RTT only renders if something asks for it, and a texture used as an
   * `emissiveTexture` is never discovered by the scene — only `reflectionTexture`
   * and `refractionTexture` are. So it lives or dies by this list, which is also
   * exactly what we want: in third person there is no mirror on screen and no
   * reason to pay for one.
   */
  private setMirrorsActive(active: boolean) {
    const targets = this.scene.customRenderTargets;
    active = active && this.mirrorsAllowed;
    for (const texture of [this.rearViewTexture, this.wingMirrorTexture]) {
      if (!texture) continue;
      const index = targets.indexOf(texture);
      if (active && index === -1) targets.push(texture);
      else if (!active && index !== -1) targets.splice(index, 1);
    }
  }

  setCameraMode(mode: CameraMode, notify = true) {
    const activeCameraNames =
      this.scene.activeCameras?.map((camera) => camera.name) ?? [];
    if (
      this.cameraMode === mode &&
      (this.activeCutscene !== null ||
        isCameraStackActive(
          mode,
          this.scene.activeCamera?.name ?? null,
          activeCameraNames,
        ))
    ) {
      return;
    }
    this.cameraMode = mode;
    const firstPerson = mode === "first";
    // A running cutscene keeps its staged third-person stack; the recorded
    // mode is honoured the moment the scene ends.
    if (!this.activeCutscene) this.applyCameraStack(firstPerson);
    if (notify) {
      this.callbacks.onCameraChange?.(mode);
      this.emit("camera", `${firstPerson ? "First" : "Third"}-person camera selected.`);
    }
    this.publishHud(true);
  }

  toggleCamera() {
    // The staged shot owns the camera while an interaction scene plays.
    if (this.activeCutscene) return;
    // No cockpit on a two-wheeler; the toggle is a no-op rather than a lie.
    const kind = this.options.playerVehicle?.visualKind;
    if (kind && kind !== "car") return;
    this.setCameraMode(this.cameraMode === "first" ? "third" : "first");
  }

  setIndicator(indicator: TurnIndicator) {
    const action: SimulationInput =
      indicator === "left"
        ? { signalLeft: true }
        : indicator === "right"
          ? { signalRight: true }
          : { cancelSignal: true };
    this.simulation.step(0, action);
    this.simulationSnapshot = this.simulation.step(0, {});
    this.applySimulationSnapshot(this.simulationSnapshot);
    this.indicatorBlinkSeconds = 0;
    this.emit(
      "indicator",
      this.playerState.indicator === "off"
        ? "Indicators cancelled."
        : `${this.playerState.indicator === "left" ? "Left" : "Right"} indicator on.`,
    );
    this.publishHud(true);
  }

  horn() {
    const now = eventNow();
    // Guards the simulation side only: the sound now sustains for as long as the
    // control is held, which is orthogonal to how often we poke the sim.
    if (now < this.hornUntil - 80) return;
    this.hornUntil = now + 650;
    this.hornHeld = true;
    this.simulation.step(0, { horn: true });
    this.simulationSnapshot = this.simulation.step(0, {});
    this.applySimulationSnapshot(this.simulationSnapshot);
    this.audio?.hornPress();
    this.emit("horn", "Horn sounded.");
    this.publishHud(true);
  }

  hornRelease() {
    if (!this.hornHeld) return;
    this.hornHeld = false;
    this.audio?.hornRelease();
    this.publishHud(true);
  }

  reset(incidentMessage?: string) {
    this.cancelCutscene();
    if (incidentMessage) {
      this.simulation.reportExternalCollision(
        incidentMessage,
        "Review the incident, then continue from the safe checkpoint.",
        { source: "legacy-runtime-bridge" },
      );
    } else {
      this.simulation.resetToCheckpoint();
    }
    this.applySimulationSnapshot(this.simulation.getSnapshot());
    this.processSimulationEvents(this.simulation.drainEvents());
    this.clearHeldInputs();
    // A checkpoint can sit under the snap threshold; pin the blend pair
    // explicitly so the first frame after a reset shows the reset pose.
    this.playerState.previousX = this.playerState.x;
    this.playerState.previousZ = this.playerState.z;
    this.playerState.previousHeading = this.playerState.heading;
    this.displayedX = this.playerState.x;
    this.displayedZ = this.playerState.z;
    this.displayedHeading = this.playerState.heading;
    this.snapChaseCameraToPose();
    if (incidentMessage) {
      this.instruction = incidentMessage;
      this.setPaused(true);
    } else {
      this.instruction = "Reset to the last safe checkpoint.";
      this.emit("reset", this.instruction);
    }
    this.publishHud(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // The per-frame QA hooks (installed in updateGuidanceVisuals) close over
    // this session; left on window after dispose they pin the disposed scene
    // graph — and hand QA a dead session — until the next mount overwrites them.
    if (typeof window !== "undefined") {
      const debugWindow = window as unknown as Record<string, unknown>;
      for (const key of [
        "__sideswapGuidanceDebug",
        "__sideswapDriveControl",
        "__sideswapAudioDebug",
        "__sideswapMeshes",
        "__sideswapPerfDebug",
        "__sideswapCutsceneDebug",
        "__sideswapLampDebug",
        "__sideswapCrowdDebug",
        "__sideswapEnforcementDebug",
      ]) {
        delete debugWindow[key];
      }
    }
    this.cancelCutscene();
    this.engine.stopRenderLoop(this.renderFrame);
    // Withdraw the mirrors before the scene goes: a render target left in
    // customRenderTargets keeps its render list — and through it the whole
    // scene graph — alive past dispose.
    this.setMirrorsActive(false);
    this.rearViewTexture?.dispose();
    this.rearViewTexture = null;
    this.wingMirrorTexture?.dispose();
    this.wingMirrorTexture = null;
    this.simulation.dispose();
    this.inputRouter.dispose();
    this.clearHeldInputs();
    for (const dispose of this.disposers.splice(0)) dispose();
    // Fades out and tears itself down. The context itself is shared and
    // deliberately outlives the session — closing one mid-note is a click, and a
    // closed context can never be reopened for the next drive.
    this.audio?.dispose();
    this.audio = null;
    this.effectsPipeline?.dispose();
    this.effectsPipeline = null;
    this.impactPuffs?.dispose();
    this.impactPuffs = null;
    this.damageSmoke?.dispose();
    this.damageSmoke = null;
    this.playerCyclistVisual?.dispose();
    this.playerCyclistVisual = null;
    this.riderVisual?.dispose();
    this.riderNode?.dispose(false, false);
    this.gigMarkerNode?.dispose(false, true);
    this.crowdRenderer?.dispose();
    this.crowdRenderer = null;
    this.crowdSim = null;
    disposeModels(this.scene);
    this.scene.dispose();
    this.engine.dispose();
  }

  private reportLoadProgress(fraction: number, label: string) {
    this.callbacks.onLoadProgress?.({ fraction, label });
  }

  /**
   * Loads the vehicle glbs off the critical path. Vehicles are built with their
   * procedural fallback during construction and upgraded to the imported models
   * here once the containers arrive; a failed load simply leaves them procedural.
   *
   * Reports real progress throughout, never simulated: `preloadModels`'s own
   * byte/file-settlement signal drives the first (dominant) `models` share, and
   * every phase after it only advances the instant that exact phase actually
   * finishes — the running `progress` total is never a timer. Each `await
   * nextPaint()` exists solely so that milestone is actually visible: without
   * it, React's state update and the next (synchronous, CPU-bound) phase would
   * land in the same task, and the browser would never get a chance to paint
   * the intermediate number before the next chunk of work starts. An earlier
   * version yielded only once (before "Finishing touches" as a whole), on the
   * theory that the three sub-phases after it were short enough to read as one
   * beat. Confirmed wrong on a real drive: whichever of those sub-phases is
   * slowest on a given device and map, the bar sat frozen at 80% for its whole
   * duration — indistinguishable from a hang, exactly what this feature exists
   * to avoid. Every real milestone gets its own yield now, so no single
   * sub-phase — whichever it turns out to be, on whatever hardware — can hide
   * behind a neighbour's label. Two rAFs, not one: a promise resolved inside a
   * single requestAnimationFrame callback still runs its continuation as a
   * microtask of that callback, before the browser paints — see `nextPaint`.
   * Measured cost of all four yields together, on the heaviest map (NYC,
   * headless software rendering — a pessimistic case; real hardware should be
   * less): ~400ms against a multi-second load.
   * `this.disposed` is re-checked after every yield because a yield is a point
   * where dispose() (an unmount mid-load) could otherwise run before the next
   * phase touches the scene.
   */
  private async preloadVehicleModels() {
    this.reportLoadProgress(0, LOADING_MODELS_LABEL);
    try {
      await preloadModels(
        this.scene,
        [
          ...vehicleModelUrls(),
          ...characterModelUrls(),
          ...propModelUrls(),
          ...this.buildingModelUrls,
          ...this.natureModelUrls,
        ],
        (fraction) =>
          this.reportLoadProgress(fraction * LOAD_PHASE_WEIGHTS.models, LOADING_MODELS_LABEL),
      );
    } catch {
      // Preload failed (e.g. offline / blocked). Proceed anyway so the loading
      // gate still lifts; vehicles build from whatever models did load.
    }
    if (this.disposed) return;
    this.modelsReady = true;
    let progress = LOAD_PHASE_WEIGHTS.models;
    this.reportLoadProgress(progress, FINISHING_TOUCHES_LABEL);
    await nextPaint();
    if (this.disposed) return;

    this.upgradeVehiclesToModels();
    this.upgradeRoadUsersToModels();
    // The waiting rider is placed from options, usually before the character
    // glbs settle; rebuild it so the first passenger gig's rider isn't an
    // invisible placeholder.
    if (this.riderVenuePlaced) {
      this.riderVenuePlaced = null;
      this.syncRider();
    }
    this.upgradePropsToModels();
    progress += LOAD_PHASE_WEIGHTS.vehiclesAndPeople;
    this.reportLoadProgress(progress, FINISHING_TOUCHES_LABEL);
    await nextPaint();
    if (this.disposed) return;

    this.buildInstancedBuildings();
    this.buildAmbientCrowd();
    progress += LOAD_PHASE_WEIGHTS.city;
    this.reportLoadProgress(progress, FINISHING_TOUCHES_LABEL);
    await nextPaint();
    if (this.disposed) return;

    // Freeze the dense scenery once the first frame has computed its matrices.
    this.scene.onAfterRenderObservable.addOnce(() => this.freezeStaticScenery());
    // Compile every shader + upload every buffer now, while the loading gate is
    // still up, so the first corner of the drive doesn't stall.
    this.warmUpPipeline();
    this.reportLoadProgress(1, FINISHING_TOUCHES_LABEL);
    this.markReady();
  }

  /**
   * (Re)builds the player exterior and every pooled NPC visual from its imported
   * model, once the preload settles and the loading gate lifts. Until then those
   * visuals are empty placeholders; this replaces them in place. The player's
   * first-person cockpit is a separate node, so it is untouched. Paint/variant
   * keys are unchanged, so later `ensureNpcVehicleVisual` reconciliation is
   * unaffected.
   */
  private upgradeVehiclesToModels() {
    if (this.options.playerVehicle?.visualKind === "bicycle") {
      // The player IS the cyclist: same distance-driven pedal rig the NPC
      // riders use, mounted under the exterior node (hidden never — there is
      // no first person on a bike). The dismount scenes hide just the rider.
      this.playerCyclistVisual?.dispose();
      this.playerCyclistVisual = buildCyclistVisual(
        this.scene,
        this.playerExterior,
        "player-cyclist",
        DRIVER_ACTOR_VARIANT,
        DRIVER_ACTOR_COLORS,
      );
    } else if (this.options.playerVehicle?.visualKind === "motorbike") {
      // Same composed-rider treatment on the motorbike, in a single static
      // seated pose (no pedals; the merged-mesh wheels don't spin). Shares
      // the cyclist visual slot — every rider hide/advance call is optional.
      this.playerCyclistVisual?.dispose();
      this.playerCyclistVisual = buildMotorbikeVisual(
        this.scene,
        this.playerExterior,
        "player-motorbike",
        DRIVER_ACTOR_VARIANT,
        DRIVER_ACTOR_COLORS,
      );
    } else if (this.playerVehicleVisual) {
      this.playerVehicleVisual.dispose();
      this.playerVehicleVisual = createVehicleMesh(
        this.scene,
        this.playerExterior,
        "player",
        resolvePlayerVehicleAppearance(
          this.options.mapPack?.id ?? "orientation-yard",
          this.options.playerVehicle,
        ),
      );
    }
    const trafficSeed = this.options.lesson?.trafficSeed ?? 0;
    const mapId = this.options.mapPack?.id ?? "orientation-yard";
    for (const npc of this.npcVehicles) {
      if (!npc.visualVehicleId) continue;
      npc.visual.dispose();
      npc.visual = createVehicleMesh(
        this.scene,
        npc.node,
        `${npc.node.name}-${npc.visualVehicleId}`,
        resolveTrafficVehicleAppearance({
          vehicleId: npc.visualVehicleId,
          trafficSeed,
          variant: npc.visualVariant,
          mapId,
        }),
      );
    }
  }

  /** This map's palettes, built once each (see characterPalettes.ts). */
  private complexionPalette(): readonly CharacterTone[] {
    if (!this.complexions) {
      this.complexions = complexionPaletteForMap(this.paletteMapId());
    }
    return this.complexions;
  }

  private hairPalette(): readonly CharacterTone[] {
    if (!this.hairTones) {
      this.hairTones = hairPaletteForMap(this.paletteMapId());
    }
    return this.hairTones;
  }

  private paletteMapId(): string {
    return this.options.mapPack?.id ?? "orientation-yard";
  }

  /** Palette slots for a road user, by its index among the ones this map
   * spawns. Both palettes are pre-shuffled, so even a handful of people spread
   * across them; the hair slot is skewed off the complexion slot so the two do
   * not travel together. */
  private characterColorsAt(index: number, clothing: Color3): CharacterColors {
    const at = (palette: readonly CharacterTone[], slot: number) => {
      const tone = palette[Math.abs(slot) % palette.length];
      return new Color3(tone.r, tone.g, tone.b);
    };
    return {
      clothing,
      complexion: at(this.complexionPalette(), index),
      hair: at(this.hairPalette(), index * 7 + 3),
    };
  }

  /**
   * Builds a pedestrian/cyclist visual under `node`: the imported character
   * model when its glbs have loaded, else an empty placeholder (shown only
   * behind the loading gate while the models preload, then replaced).
   */
  private buildRoadUserVisual(
    node: TransformNode,
    name: string,
    isCyclist: boolean,
    variant: number,
    colors: CharacterColors,
    speed: number,
  ): CharacterVisual {
    const scene = this.scene;
    const model = isCyclist
      ? buildCyclistVisual(scene, node, name, variant, colors)
      : buildPedestrianVisual(
          scene,
          node,
          name,
          variant,
          colors,
          // Match the walk cadence to ground speed to cut foot-sliding; the
          // 1.4 divisor is the clip's natural m/s at speedRatio 1 (tunable).
          clamp(speed / 1.4, 0.5, 1.6),
        );
    if (model) return model;

    // Character models still preloading (or none loaded). Return an empty
    // placeholder — hidden by the loading gate and replaced the instant the
    // glbs finish. No procedural cylinder people any more.
    const root = new TransformNode(`${name}-pending`, scene);
    root.parent = node;
    return { root, dispose: () => root.dispose(false, false) };
  }

  /** Once the character glbs preload, (re)build every road user from its
   * walking/riding model in place (keeps the node + pathing), replacing the
   * empty placeholder shown behind the loading gate. */
  private upgradeRoadUsersToModels() {
    for (const pedestrian of this.pedestrians) {
      if (pedestrian.variant === undefined || !pedestrian.colors) continue;
      pedestrian.visual?.dispose();
      pedestrian.visual = this.buildRoadUserVisual(
        pedestrian.node,
        pedestrian.node.name,
        pedestrian.kind === "cyclist",
        pedestrian.variant,
        pedestrian.colors,
        pedestrian.speed,
      );
    }
  }

  /**
   * Stands up the ambient sidewalk crowd: the pavement rail graph, the walker
   * bubble simulation, and the VAT thin-instance renderer. Map-gated by
   * AMBIENT_CROWD_CONFIG; any failure (models missing, bake produced no
   * motion) simply leaves the map without an ambient crowd.
   */
  /** The map's pavement rail graph, built once and shared by the ambient
   * crowd and the scenario road users. Null when the map has no roads (the
   * orientation yard) or the build fails — callers fall back gracefully. */
  private ensurePavementGraph(): PavementGraph | null {
    if (this.pavementGraph !== undefined) return this.pavementGraph;
    this.pavementGraph = null;
    const mapPack = this.options.mapPack;
    const surfaces = mapPack?.geometry.roadSurfaces;
    if (!mapPack || !surfaces?.length) return null;
    const palette = resolveMapVisualPalette(mapPack.id);
    // The exact sidewalk band the environment renders, so walkers stay on it.
    const sidewalkWidthM = palette.paved
      ? PAVED_SIDEWALK_WIDTH_M
      : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2);
    this.pavementSidewalkWidthM = Math.min(
      sidewalkWidthM,
      ...surfaces.map((surface) => surface.sidewalkWidthM ?? sidewalkWidthM),
    );
    try {
      this.pavementGraph = buildPavementGraph(surfaces, { sidewalkWidthM });
    } catch (error) {
      console.warn("[crowd] pavement graph build failed", error);
    }
    return this.pavementGraph;
  }

  /** Half-width of the crowd's scatter band: the pavement band less standing
   * room for a body at each edge, so nobody's shoulder overhangs the kerb or
   * the building line (issue #127 — no more single file). */
  private crowdScatterHalfM(): number {
    return Math.max(0, this.pavementSidewalkWidthM / 2 - 0.55);
  }

  private buildAmbientCrowd() {
    const mapPack = this.options.mapPack;
    const config = mapPack ? AMBIENT_CROWD_CONFIG[mapPack.id] : undefined;
    if (!mapPack || !config) return;
    const graph = this.ensurePavementGraph();
    if (!graph) return;
    const clothing = crowdClothingPaletteForMap(mapPack.id);
    const sim = createCrowdSim(graph, {
      count: Math.floor(config.count * this.buildingKeepFraction),
      seed: hashStringToSeed(`${mapPack.id}-crowd`),
      innerRadiusM: config.innerRadiusM,
      outerRadiusM: config.outerRadiusM,
      recycleRadiusM: config.recycleRadiusM,
      minSpeedMps: 0.9,
      maxSpeedMps: 1.7,
      scatterHalfWidthM: this.crowdScatterHalfM(),
      turnPauseSeconds: 1,
      modelCount: CHARACTER_MODELS.length,
      tintCount: clothing.length,
      complexionCount: this.complexionPalette().length,
      hairCount: this.hairPalette().length,
    });
    if (!sim) return;
    // Prime the pool around the spawn point so the street is already lived-in
    // when the loading gate lifts.
    sim.step(0, { x: this.playerState.x, z: this.playerState.z }, () => true);
    const renderer = new CrowdRenderer(this.scene);
    const built = renderer.build(sim.walkers, {
      clothing,
      complexion: this.complexionPalette(),
      hair: this.hairPalette(),
    });
    if (!built) {
      renderer.dispose();
      return;
    }
    this.crowdSim = sim;
    this.crowdRenderer = renderer;
  }

  /** Whether a disc on the ground is inside the gameplay camera's frustum.
   * One frame stale after a camera cut; the bubble's radius condition covers
   * that. See crowdFrustumPlanes for why scene.frustumPlanes won't do. */
  private readonly crowdVisibility = (x: number, z: number, radiusM: number): boolean => {
    this.crowdProbePoint.set(x, 1, z);
    for (const plane of this.crowdFrustumPlanes) {
      if (plane.dotCoordinate(this.crowdProbePoint) < -radiusM) return false;
    }
    return true;
  };

  private refreshCrowdFrustum(): void {
    const camera =
      this.cameraMode === "first" ? this.firstCamera : this.thirdCamera;
    camera
      .getViewMatrix()
      .multiplyToRef(camera.getProjectionMatrix(), this.crowdFrustumMatrix);
    Frustum.GetPlanesToRef(this.crowdFrustumMatrix, this.crowdFrustumPlanes);
  }

  private stepAmbientCrowd(dt: number) {
    if (!this.crowdSim || !this.crowdRenderer) return;
    this.crowdSim.step(
      dt,
      { x: this.playerState.x, z: this.playerState.z },
      this.crowdVisibility,
    );
    this.crowdDirty = true;
  }

  /** Walks the scenario road users along the pavement rails: same bubble
   * rules as the crowd, but these stay skinned clones — pedestrians so the
   * pool keeps its authored variety, cyclists because pedalling legs are
   * posed on the CPU and cannot ride a baked walk cycle. */
  private syncRailRoadUsers(dt: number) {
    if (!this.railRoadUsers.length) return;
    const focus = { x: this.playerState.x, z: this.playerState.z };
    this.roadUserPedSim?.step(dt, focus, this.crowdVisibility);
    this.roadUserCycleSim?.step(dt, focus, this.crowdVisibility);
    for (const { pedestrian, kind, index } of this.railRoadUsers) {
      const walker = (kind === "cyclist" ? this.roadUserCycleSim : this.roadUserPedSim)
        ?.walkers[index];
      if (!walker) continue;
      pedestrian.node.position.x = walker.x;
      pedestrian.node.position.z = walker.z;
      pedestrian.node.rotation.y = walker.headingRad;
      // A knocked-down user's clips are driven by updateDownedRoadUsers;
      // poking setMoving here would fight the fall/recover one-shots.
      if (pedestrian.downedUntilSeconds !== undefined) continue;
      const moving = walker.state === "walk";
      pedestrian.visual?.setMoving?.(moving);
      if (moving) pedestrian.visual?.advancePedals?.(walker.speedMps * dt);
    }
  }

  /**
   * Places (or clears) the single waiting-passenger mesh at the curbside of the
   * active gig's pickup venue. Driven by `options.riderVenueId`, which is null
   * for parcel deliveries and once a rider has been collected.
   */
  private syncRider() {
    const target = this.options.riderVenueId ?? null;
    if (target === this.riderVenuePlaced) return;
    this.riderVisual?.dispose();
    this.riderVisual = null;
    this.riderNode?.dispose(false, false);
    this.riderNode = null;
    this.riderVenuePlaced = target;
    if (!target) return;
    const spot = this.gigVenueCurbside.get(target);
    if (!spot) return;
    const node = new TransformNode(`gig-rider-${target}`, this.scene);
    node.position.set(spot.x, ACTOR_WALK_Y, spot.z);
    node.rotation.y = spot.facing;
    this.riderNode = node;
    // The actor pipeline's Idle clip: somebody standing at the kerb waiting,
    // not the old walk-cycle-in-place. Null while the glbs preload; the
    // preload settle re-syncs so the first gig's rider is never left empty.
    this.riderVisual = buildActorVisual(
      this.scene,
      node,
      `gig-rider-${target}`,
      target.length,
      this.passengerColors(target),
    );
  }

  /** The rider/passenger palette for a stop id — one person per pickup, and
   * the same person again when they get out at the drop-off. */
  private passengerColors(seedId: string): CharacterColors {
    return this.characterColorsAt(hashStringToSeed(seedId), RIDER_CLOTHING_TINT);
  }

  /**
   * Stages one interaction cutscene: builds the choreography for the request,
   * spawns its actor, and swings the camera to a wide shot of the car and the
   * scene's far point. While `activeCutscene` is set, `mergedInput` reads as
   * all-zero (the "game is unplayable" contract) and `updateCamera` holds the
   * staged shot. Anything unstageable resolves as an instant `done` so the
   * app-side effects (fuel, gig state) are never lost.
   */
  /**
   * The walk-path envelope for interaction scenes, sized to whatever the
   * player is actually driving so a van's longer bumpers are skirted and its
   * doors sit on its real flanks. The flagship (and any vehicle without
   * registered dimensions) reproduces the long-standing default exactly.
   */
  private cutsceneBody(): CutsceneBodyProfile {
    const kind = this.options.playerVehicle?.visualKind;
    if (kind === "bicycle") return BIKE_CUTSCENE_BODY;
    if (kind === "motorbike") return MOTORBIKE_CUTSCENE_BODY;
    const model = this.options.playerVehicle?.model;
    const dimensions = model ? VEHICLE_DIMENSIONS[model] : undefined;
    if (!dimensions) return DEFAULT_CUTSCENE_BODY;
    return cutsceneBodyProfile(dimensions.length, dimensions.width);
  }

  private startCutscene(request: CutsceneRequest) {
    this.cancelCutscene();
    const car = {
      x: this.playerState.x,
      z: this.playerState.z,
      heading: this.playerState.heading,
    };
    const body = this.cutsceneBody();
    let script: readonly CutsceneStep[] | null = null;
    let passengerSeed: string | null = null;
    let pullover: PulloverPlan | null = null;
    switch (request.kind) {
      case "pullover": {
        // Needs no map data to stage — pulloverPose falls back to a heading-
        // relative park — so this branch always yields a script. The app leans
        // on that: the fine is debited on the scene's citation step, so a
        // traffic stop that could not be staged would be a violation that
        // silently cost nothing.
        pullover = buildPulloverScript(
          car,
          Math.max(0, this.playerState.speedMps),
          this.options.steeringSide,
          this.options.trafficSide,
          this.pulloverRoadAt(car.x, car.z),
          body,
        );
        script = pullover.steps;
        // Stand the scene's own patrol in for the one that clocked you: the
        // ambient car is still under the simulation's control and would drive
        // off mid-scene, so it goes off screen for the duration rather than
        // being commandeered. Wider than the 35 m witness radius because the
        // stop is staged a render frame or two after the violation.
        this.hiddenNpcSimulationId =
          this.patrolNearPlayer(60)?.simulationId ?? null;
        break;
      }
      case "refuel": {
        const pump = this.nearestPumpTo(car.x, car.z);
        if (pump) {
          script = buildRefuelScript(
            car,
            this.options.steeringSide,
            pump,
            request.fuelFillFraction ?? 1,
            body,
          );
        }
        break;
      }
      case "roadside_refuel": {
        // No pump needed: the rescue plays wherever the tank ran dry.
        script = buildRoadsideRefuelScript(car, this.options.steeringSide, body);
        break;
      }
      case "repair": {
        // Likewise needs no map data — the work happens at the car's own front
        // wing, so this branch always yields a script. Deliberate: the bill
        // is charged on the scene's repair step, so a shop visit that could not
        // be staged would be a repair that silently cost nothing.
        script = buildRepairScript(car, this.options.steeringSide, body);
        break;
      }
      case "board": {
        const spot = request.venueId
          ? this.gigVenueCurbside.get(request.venueId)
          : undefined;
        if (spot) {
          const from = this.riderNode
            ? { x: this.riderNode.position.x, z: this.riderNode.position.z }
            : { x: spot.x, z: spot.z };
          script = buildBoardScript(car, this.options.trafficSide, from, body);
          passengerSeed = request.actorSeedId ?? request.venueId ?? null;
        }
        break;
      }
      case "exit": {
        // The passenger always walks straight off the car's own kerb side, so
        // the scene needs nothing but the car pose. Routing to a fixed venue
        // spot instead sent them around the car on an off-square park (#128-era
        // "walks away then comes back"); a car-relative walk-off can't.
        script = buildExitScript(car, this.options.trafficSide, body);
        passengerSeed = request.actorSeedId ?? request.venueId ?? null;
        break;
      }
      case "food_pickup":
      case "food_dropoff": {
        const door = request.venueId
          ? (this.gigVenueDoors.get(request.venueId) ??
            this.gigVenueCurbside.get(request.venueId))
          : undefined;
        if (door) {
          // Which leg the courier walks with the order in hand is the only
          // thing that tells these two scenes apart on screen — the walk
          // itself is the same one run in opposite directions.
          const cargo: ErrandCargo =
            request.kind === "food_pickup" ? "collect" : "deliver";
          // On a two-wheeler the courier dismounts beside it — no doors, no
          // suspension dip — and the rider on the vehicle hides for the scene
          // so the walking actor reads as the same person.
          const twoWheelerKind = this.options.playerVehicle?.visualKind;
          script =
            twoWheelerKind === "bicycle"
              ? buildBikeErrandScript(
                  car,
                  { x: door.x, z: door.z },
                  undefined,
                  undefined,
                  cargo,
                )
              : twoWheelerKind === "motorbike"
                ? buildBikeErrandScript(
                    car,
                    { x: door.x, z: door.z },
                    undefined,
                    MOTORBIKE_CUTSCENE_BODY,
                    cargo,
                  )
                : buildErrandScript(
                    car,
                    this.options.steeringSide,
                    { x: door.x, z: door.z },
                    undefined,
                    body,
                    cargo,
                  );
        }
        break;
      }
    }
    if (!script || script.length === 0) {
      // Nothing staged, so nothing may stay hidden: without this an unstageable
      // scene would leave a patrol permanently off screen.
      this.hiddenNpcSimulationId = null;
      this.emitCutsceneDone(request.nonce, request.kind);
      return;
    }

    const actorNode = new TransformNode(`cutscene-actor-${request.nonce}`, this.scene);
    actorNode.setEnabled(false);
    const actorVisual = pullover
      ? buildOfficerVisual(
          this.scene,
          actorNode,
          `cutscene-officer-${request.nonce}`,
        )
      : passengerSeed
        ? buildActorVisual(
            this.scene,
            actorNode,
            `cutscene-passenger-${request.nonce}`,
            passengerSeed.length,
            this.passengerColors(passengerSeed),
          )
        : // The food errands are the driver with an order to carry; every
          // other scene is the same person with their hands free.
          (request.kind === "food_pickup" || request.kind === "food_dropoff"
            ? buildCourierVisual
            : buildActorVisual)(
            this.scene,
            actorNode,
            `cutscene-driver-${request.nonce}`,
            DRIVER_ACTOR_VARIANT,
            DRIVER_ACTOR_COLORS,
          );

    const patrolRig = pullover ? this.buildPatrolRig(request.nonce, pullover) : null;

    // The staged shot: a static wide framing of the car and the scene's far
    // point, from whichever side the camera is already on so the glide in
    // never swings across the action.
    //
    // A traffic stop frames the *parked* poses, not where the car happened to
    // be when it was clocked: the car drives into this shot over the first few
    // seconds, and framing it from the violation point would leave the camera
    // stranded up the road once it had. Both cars have to fit, so the span is
    // taken across the pair and the pull-back is wider than the one-actor
    // scenes need.
    const stage: CutsceneCarPose = pullover?.parked ?? car;
    const focus = pullover
      ? { x: pullover.patrol.x, z: pullover.patrol.z }
      : scriptFocusPoint(car, script);
    const midX = (stage.x + focus.x) / 2;
    const midZ = (stage.z + focus.z) / 2;
    const span = Math.hypot(focus.x - stage.x, focus.z - stage.z);
    let perpX = focus.z - stage.z;
    let perpZ = -(focus.x - stage.x);
    const perpLength = Math.hypot(perpX, perpZ);
    if (perpLength < 0.001) {
      perpX = Math.cos(stage.heading);
      perpZ = -Math.sin(stage.heading);
    } else {
      perpX /= perpLength;
      perpZ /= perpLength;
    }
    const towardCameraX = this.thirdCamera.position.x - midX;
    const towardCameraZ = this.thirdCamera.position.z - midZ;
    if (perpX * towardCameraX + perpZ * towardCameraZ < 0) {
      perpX = -perpX;
      perpZ = -perpZ;
    }
    const radius = pullover
      ? Math.max(14, span * 1.25)
      : Math.max(9, span * 0.85);
    const cameraY = 4.2 + span * 0.25;

    // The repair scene is the one that plays inside a building, so it does not
    // take the generic framing — see `repairCameraPosition`.
    const framing =
      request.kind === "repair"
        ? this.repairBayFramingAt(car.x, car.z)
        : null;
    // Measured from the BAY's centre, not from the scene's own midpoint. The
    // midpoint is already pulled toward the actor, so offsetting from it
    // compounds and walks the camera out past the flank — where it films the
    // outside of the wall. The shot is a property of the shop.
    const repairShot = framing
      ? repairCameraPosition(framing.bay.x, framing.bay.z, framing.mouth, {
          x: focus.x - car.x,
          z: focus.z - car.z,
        })
      : null;
    // Everything else takes the generic ring — but at the azimuth on it that
    // can see the scene, rather than at whichever perpendicular the chase
    // camera happened to be standing on. Both ends of the action have to stay
    // visible: framing that clears the car and hides the pump is the wrong side
    // to film a refuel from. See `chooseStagedShot`.
    const subjects = [{ x: stage.x, z: stage.z }, focus];
    const shot =
      repairShot ??
      chooseStagedShot(
        midX,
        midZ,
        radius,
        cameraY,
        { x: perpX, z: perpZ },
        subjects,
        this.stagedBlockers,
        this.coverOverScene(subjects),
      );

    const riderWasHidden = request.kind === "board" && this.riderNode !== null;
    if (riderWasHidden) this.riderNode?.setEnabled(false);
    const playerRiderHidden =
      // A stopped cyclist stays on the bike — they are being spoken to, not
      // dismounting — so the traffic stop is the one scene that keeps the
      // player's own rider on their vehicle.
      request.kind !== "pullover" &&
      this.options.playerVehicle !== null &&
      this.options.playerVehicle !== undefined &&
      this.options.playerVehicle.visualKind !== "car" &&
      this.playerCyclistVisual !== null;
    if (playerRiderHidden) this.playerCyclistVisual?.setRiderVisible?.(false);

    this.activeCutscene = {
      nonce: request.nonce,
      kind: request.kind,
      script,
      stepIndex: 0,
      stepElapsed: 0,
      stepStarted: false,
      segmentLengths: [],
      segmentTotal: 0,
      actorNode,
      actorVisual,
      cameraPosition: new Vector3(shot.x, shot.y, shot.z),
      // Both ends of the repair shot come off the shop: aiming at the scene's
      // own midpoint instead leaves the bay off to one side, because the
      // midpoint drifts with wherever the car stopped and whichever flank the
      // driver is working on.
      cameraTarget: framing
        ? new Vector3(framing.bay.x, 1.0, framing.bay.z)
        : new Vector3(midX, 1.0, midZ),
      groundY: CUTSCENE_GROUND_Y[request.kind] ?? ACTOR_WALK_Y,
      riderWasHidden,
      playerRiderHidden,
      pumpEmitted: false,
      repairEmitted: false,
      patrolNode: patrolRig?.node ?? null,
      patrolVisual: patrolRig?.visual ?? null,
      citeEmitted: false,
      elapsedSeconds: 0,
    };
    this.applyCameraStack(false);
  }

  /**
   * The carriageway the traffic stop parks against: the road surface nearest
   * the car, projected onto rather than looked up by lane, because the pose has
   * to be measured from the *street's* centreline to land at its kerb — a lane
   * id would only say which half of it the car is on. Out of reach (a car well
   * off the map's roads) yields null and the scene parks heading-relative.
   */
  private pulloverRoadAt(x: number, z: number): PulloverRoad | null {
    const surfaces = this.options.mapPack?.geometry.roadSurfaces;
    if (!surfaces?.length) return null;
    let best: PulloverRoad | null = null;
    let bestDistance = PULLOVER_ROAD_REACH_M;
    for (const surface of surfaces) {
      const hit = projectOntoPolyline(surface.centerline, x, z);
      if (!hit || hit.distance > bestDistance) continue;
      bestDistance = hit.distance;
      best = {
        centerline: surface.centerline,
        halfWidthM: surface.widthM / 2,
      };
    }
    return best;
  }

  /** The traffic stop's own patrol car, spawned at its run-up pose with the
   * light bar already going. Wears the local force's livery like any other
   * patrol on the map. */
  private buildPatrolRig(
    nonce: number,
    plan: PulloverPlan,
  ): { node: TransformNode; visual: VehicleMeshVisual } {
    const node = new TransformNode(`cutscene-patrol-${nonce}`, this.scene);
    node.position.set(plan.patrolStart.x, 0.12, plan.patrolStart.z);
    node.rotation.y = plan.patrolStart.heading;
    const visual = createVehicleMesh(
      this.scene,
      node,
      `cutscene-patrol-${nonce}`,
      policeAppearanceForMap(
        this.options.mapPack?.id ?? "orientation-yard",
        `pullover-${nonce}`,
        this.options.lesson?.trafficSeed ?? 0,
      ),
    );
    visual.setDetailVisible(true);
    return { node, visual };
  }

  /** Fired at a step's first frame: placement, visibility, clip, foley, dip. */
  private beginCutsceneStep(cutscene: ActiveCutscene, step: CutsceneStep) {
    const path = step.path ?? [];
    cutscene.segmentLengths = [];
    cutscene.segmentTotal = 0;
    for (let index = 1; index < path.length; index += 1) {
      cutscene.segmentTotal += Math.hypot(
        path[index].x - path[index - 1].x,
        path[index].z - path[index - 1].z,
      );
      cutscene.segmentLengths.push(cutscene.segmentTotal);
    }
    if (step.sound) this.audio?.foley(step.sound);
    if (step.carDip) this.cutsceneDipSeconds = CUTSCENE_DIP_SECONDS;
    if (step.citeWindow && !cutscene.citeEmitted) {
      // The officer is at the window: this is the moment the fine is written,
      // the same way the refuel scene pays for its fuel when the nozzle goes
      // in rather than when the button was pressed.
      cutscene.citeEmitted = true;
      this.emit("cutscene", "Licence and registration.", "warning", {
        evidence: { phase: "cite", nonce: cutscene.nonce },
      });
    }
    if (step.fuelWindow && !cutscene.pumpEmitted) {
      cutscene.pumpEmitted = true;
      this.emit("cutscene", "Filling the tank.", "info", {
        evidence: {
          phase: "pump",
          nonce: cutscene.nonce,
          durationMs: Math.round(step.seconds * 1000),
        },
      });
    }
    if (step.repairWindow && !cutscene.repairEmitted) {
      cutscene.repairEmitted = true;
      this.emit("cutscene", "Panels straightened, lights replaced.", "info", {
        evidence: {
          phase: "repair",
          nonce: cutscene.nonce,
          durationMs: Math.round(step.seconds * 1000),
        },
      });
    }
    // The order is in hand for whole legs at a time, so this rides the step
    // rather than the scene — see CutsceneStep.carrying. A no-op for every
    // actor that is not the courier.
    cutscene.actorVisual?.setCarrying?.(step.carrying === true);
    switch (step.action) {
      case "show":
      case "walk":
      case "run": {
        const at = path[0];
        if (at) cutscene.actorNode.position.set(at.x, cutscene.groundY, at.z);
        if (step.face !== undefined) cutscene.actorNode.rotation.y = step.face;
        cutscene.actorNode.setEnabled(true);
        if (step.action === "show") {
          cutscene.actorVisual?.setClip("idle");
        } else {
          const speed =
            step.seconds > 0 ? cutscene.segmentTotal / step.seconds : 0;
          if (step.action === "walk") {
            cutscene.actorVisual?.setClip("walk", clamp(speed / 1.4, 0.5, 1.8));
          } else {
            cutscene.actorVisual?.setClip("run", clamp(speed / 3.0, 0.6, 1.6));
          }
        }
        break;
      }
      case "idle":
        if (step.face !== undefined) cutscene.actorNode.rotation.y = step.face;
        cutscene.actorVisual?.setClip("idle");
        break;
      case "hide":
        cutscene.actorNode.setEnabled(false);
        break;
    }
  }

  /**
   * Advances the running cutscene by one rendered frame: moves the actor along
   * the current step's polyline, then rolls completed steps forward (several
   * can elapse in one slow frame). Also decays the suspension dip — that keeps
   * settling even after the scene ends.
   */
  private advanceCutscene(frameSeconds: number) {
    if (this.cutsceneDipSeconds > 0) {
      this.cutsceneDipSeconds = Math.max(
        0,
        this.cutsceneDipSeconds - frameSeconds,
      );
      this.cutsceneDipOffset =
        Math.sin(Math.PI * (1 - this.cutsceneDipSeconds / CUTSCENE_DIP_SECONDS)) *
        CUTSCENE_DIP_DEPTH_M;
    } else {
      this.cutsceneDipOffset = 0;
    }
    const cutscene = this.activeCutscene;
    if (!cutscene) return;
    cutscene.elapsedSeconds += frameSeconds;
    // Keeps a carried bag hanging plumb as the rig's arm swings; the actor
    // itself needs no per-frame work, so this costs nothing when hands are free.
    cutscene.actorVisual?.update?.();
    if (cutscene.patrolVisual) {
      const lamps = policeBeaconLamps(cutscene.elapsedSeconds);
      cutscene.patrolVisual.setBeacon(lamps.red, lamps.blue);
    }
    let step = cutscene.script[cutscene.stepIndex];
    if (!cutscene.stepStarted) {
      cutscene.stepStarted = true;
      this.beginCutsceneStep(cutscene, step);
    }
    cutscene.stepElapsed += frameSeconds;
    while (cutscene.stepElapsed >= step.seconds) {
      // Land the outgoing step's cars exactly on their marks before rolling
      // forward: a slow frame can skip a whole step, and a car left a metre
      // short of the kerb is where the officer would then be walking to.
      this.applyCutsceneCarMoves(cutscene, step, 1);
      cutscene.stepElapsed -= step.seconds;
      cutscene.stepIndex += 1;
      if (cutscene.stepIndex >= cutscene.script.length) {
        this.finishCutscene(cutscene);
        return;
      }
      step = cutscene.script[cutscene.stepIndex];
      this.beginCutsceneStep(cutscene, step);
    }
    if (step.carMoves && step.seconds > 0) {
      this.applyCutsceneCarMoves(
        cutscene,
        step,
        cutscene.stepElapsed / step.seconds,
      );
    }
    if (
      (step.action === "walk" || step.action === "run") &&
      cutscene.segmentTotal > 0 &&
      step.seconds > 0
    ) {
      const path = step.path ?? [];
      const along =
        cutscene.segmentTotal * Math.min(1, cutscene.stepElapsed / step.seconds);
      let segment = 0;
      while (
        segment < cutscene.segmentLengths.length - 1 &&
        along > cutscene.segmentLengths[segment]
      ) {
        segment += 1;
      }
      const segmentStart = segment === 0 ? 0 : cutscene.segmentLengths[segment - 1];
      const segmentLength = cutscene.segmentLengths[segment] - segmentStart;
      const a = path[segment];
      const b = path[segment + 1];
      const t = segmentLength > 0 ? (along - segmentStart) / segmentLength : 1;
      cutscene.actorNode.position.set(
        a.x + (b.x - a.x) * t,
        cutscene.groundY,
        a.z + (b.z - a.z) * t,
      );
      if (segmentLength > 0.01) {
        cutscene.actorNode.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      }
    }
  }

  /**
   * Carries the step's cars to their pose at `t`, eased so each settles into
   * its stop.
   *
   * The player's car is written straight through to the simulation as well as
   * to the render mirror: the core owns the pose everything else reads from
   * (traffic clearance, road state, the minimap), so leaving it behind while
   * the visible car glides to the kerb would have NPCs steering around a ghost
   * in the lane and the car snapping back the moment the scene released. Speed
   * stays zero throughout, which is what keeps the collision reporters — all
   * gated on the player actually moving — quiet while the choreography drives.
   */
  private applyCutsceneCarMoves(
    cutscene: ActiveCutscene,
    step: CutsceneStep,
    t: number,
  ) {
    if (!step.carMoves) return;
    const eased = settleEase(t);
    for (const move of step.carMoves) {
      const pose = lerpCarPose(move.from, move.to, eased);
      if (move.vehicle === "player") {
        this.simulation.setPlayerPose(pose);
        // The glide already advances at render rate; pin prev to the same
        // pose so the interpolated car sits exactly on the choreography
        // rather than one blend step behind it.
        this.playerState.previousX = pose.x;
        this.playerState.previousZ = pose.z;
        this.playerState.previousHeading = pose.heading;
        this.playerState.x = pose.x;
        this.playerState.z = pose.z;
        this.playerState.heading = pose.heading;
        this.playerState.speedMps = 0;
      } else if (cutscene.patrolNode) {
        cutscene.patrolNode.position.set(pose.x, 0.12, pose.z);
        cutscene.patrolNode.rotation.y = pose.heading;
      }
    }
  }

  private finishCutscene(cutscene: ActiveCutscene) {
    // Boarding leaves the rider hidden: the app flips the gig to "carrying" on
    // this event, which clears riderVenueId and disposes the waiting mesh —
    // re-enabling it here would flash the double for a frame.
    cutscene.actorVisual?.dispose();
    cutscene.actorNode.dispose(false, false);
    this.disposePatrolRig(cutscene);
    // The player's own bike rider is the opposite case: the courier always
    // remounts when the errand ends, on completion just as on abort. Missing
    // this here (it only lived in cancelCutscene) shipped a ghost bike after
    // every successful pickup.
    if (cutscene.playerRiderHidden) {
      this.playerCyclistVisual?.setRiderVisible?.(true);
    }
    this.activeCutscene = null;
    this.applyCameraStack(this.cameraMode === "first");
    this.audio?.foley("chime");
    this.emitCutsceneDone(cutscene.nonce, cutscene.kind);
  }

  /** Tears a scene down without a `done` event: tow reset, session dispose. */
  private cancelCutscene() {
    const cutscene = this.activeCutscene;
    if (!cutscene) return;
    this.activeCutscene = null;
    cutscene.actorVisual?.dispose();
    cutscene.actorNode.dispose(false, false);
    this.disposePatrolRig(cutscene);
    if (cutscene.riderWasHidden) this.riderNode?.setEnabled(true);
    if (cutscene.playerRiderHidden) {
      this.playerCyclistVisual?.setRiderVisible?.(true);
    }
    if (cutscene.pumpEmitted) this.audio?.foley("pump_stop");
    this.cutsceneDipSeconds = 0;
    this.cutsceneDipOffset = 0;
    this.applyCameraStack(this.cameraMode === "first");
  }

  /** Tears down the traffic stop's own patrol car and lets the ambient one
   * that clocked you back on screen. Safe on every other scene, which has
   * neither. */
  private disposePatrolRig(cutscene: ActiveCutscene) {
    cutscene.patrolVisual?.dispose();
    cutscene.patrolNode?.dispose(false, false);
    this.hiddenNpcSimulationId = null;
  }

  private emitCutsceneDone(nonce: number, kind: CutsceneKind) {
    this.emit("cutscene", CUTSCENE_DONE_MESSAGE[kind], "info", {
      evidence: { phase: "done", nonce, kind },
    });
  }

  /**
   * Which way the open side of the repair bay the car is standing in faces —
   * a unit vector, or null if the car is not in one.
   *
   * The shop is set back along the lane's driver-right normal and turned to
   * face back the way it came, so its mouth points along exactly the opposite
   * of that normal. That is a fact about the building, which is what makes it
   * the right thing to frame the scene against: how the driver got in — nose
   * first, reversed, or slewed across the bay — tells you nothing about where
   * the wall is.
   */
  private repairBayFramingAt(
    x: number,
    z: number,
  ): {
    readonly bay: { readonly x: number; readonly z: number };
    readonly mouth: { readonly x: number; readonly z: number };
  } | null {
    const mapPack = this.options.mapPack;
    if (!mapPack) return null;
    for (const service of repairShopsOf(mapPack.geometry.servicePoints)) {
      const reach = distanceToRepairBay(mapPack.laneGraph.lanes, service, x, z);
      // Slack over the prompt's own reach: the scene stages a frame or two
      // after the button, and a car rolling to a stop may have drifted.
      if (reach > REPAIR_BAY_REACH_M + 2) continue;
      const bay = repairShopBayPosition(mapPack.laneGraph.lanes, service);
      const pose = resolveSimulationLaneAnchor(
        mapPack.laneGraph.lanes,
        service.anchor,
      );
      if (!bay || !pose) continue;
      return {
        bay,
        mouth: { x: -Math.cos(pose.heading), z: Math.sin(pose.heading) },
      };
    }
    return null;
  }

  /**
   * The roof over a staged scene, if any part of what it films is under one.
   *
   * Only gas station canopies exist to find today — they are the one thing the
   * game builds that a camera has to duck and a car drives straight under, so
   * they are the one thing the collider set deliberately does not describe. A
   * scene with nothing overhead gets null and is framed exactly as it was.
   *
   * Tests every subject rather than the scene's midpoint, and allows them a
   * reach past the edge. The station's canopy is 7.2m across and sits off
   * centre over its two pump rows — the outer row has only 0.6m of overhang
   * beyond it, and the driver fills from a stand point 1.1m further out again.
   * So a scene at that row straddles the edge: nothing about it is "under" the
   * slab by a strict test, and the slab is still across the top of the shot.
   * The margin is about the length of the walk between a car and the pump it is
   * drawn up at, which is the span such a scene occupies either side of it.
   *
   * Only the *lookup* is generous. The rect handed on is the true one, so
   * `chooseStagedShot` still rejects only the azimuths genuinely beneath it.
   *
   * Matched on footprint rather than on the pump reach the refuel prompt uses:
   * a traffic stop can end up on a forecourt too, and what decides the shot is
   * the roof overhead, not what the scene happens to be about.
   */
  private coverOverScene(
    subjects: readonly { x: number; z: number }[],
  ): StagedCover | null {
    const mapPack = this.options.mapPack;
    if (!mapPack) return null;
    for (const service of gasStationsOf(mapPack.geometry.servicePoints)) {
      const canopy = gasStationCanopyWorld(mapPack.laneGraph.lanes, service);
      if (!canopy) continue;
      for (const subject of subjects) {
        const dx = subject.x - canopy.x;
        const dz = subject.z - canopy.z;
        if (
          Math.abs(dx * canopy.ux + dz * canopy.uz) <=
            canopy.halfU + COVER_REACH_M &&
          Math.abs(dx * canopy.uz - dz * canopy.ux) <=
            canopy.halfV + COVER_REACH_M
        ) {
          return canopy;
        }
      }
    }
    return null;
  }

  /** The pump the refuel scene plays at: nearest to the car, within the same
   * reach the refuel prompt uses (plus slack for the car's own footprint). */
  private nearestPumpTo(
    x: number,
    z: number,
  ): { x: number; z: number } | null {
    const mapPack = this.options.mapPack;
    if (!mapPack) return null;
    let best: { x: number; z: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const service of gasStationsOf(mapPack.geometry.servicePoints)) {
      for (const pump of gasStationPumpPositions(
        mapPack.laneGraph.lanes,
        service,
      )) {
        const distance = Math.hypot(x - pump.x, z - pump.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = pump;
        }
      }
    }
    return bestDistance <= FUEL_PUMP_REACH_M + 3 ? best : null;
  }

  /**
   * Places (or clears) a lit beacon on the kerb of the stop the gig is heading
   * for. Authored venues announce themselves with a building; a street address
   * is just a spot outside a row of brownstones that look like every other row,
   * so without this "you have arrived" would be guesswork.
   *
   * Only ever one beacon exists — it follows the active gig rather than marking
   * every stop, which keeps this to a single mesh no matter how many addresses
   * the map generates. Colours match the minimap pin: warm red heading to a
   * pickup, amber once you are carrying.
   */
  private syncGigMarker() {
    const target = this.options.gigStopId ?? null;
    const carrying = this.options.gigStopCarrying ?? false;
    // A rider pickup is the one stop with a person standing on the kerb spot
    // (riderVenueId is set only then, and only at the pickup). Planting the post
    // there sits it on the customer and the player parks on them, so the marker
    // moves onto the road stop instead. Every other stop — deliveries, and the
    // drop-off — has nobody waiting, so the kerb post reads fine.
    const ridePickup = target !== null && this.options.riderVenueId === target;
    if (
      target === this.gigMarkerPlaced &&
      carrying === this.gigMarkerCarrying &&
      ridePickup === this.gigMarkerRidePickup
    ) {
      return;
    }
    this.gigMarkerNode?.dispose(false, true);
    this.gigMarkerNode = null;
    this.gigMarkerPlaced = target;
    this.gigMarkerCarrying = carrying;
    this.gigMarkerRidePickup = ridePickup;
    if (!target) return;
    const curb = this.gigVenueCurbside.get(target);
    if (!curb) return;
    const roadStop = ridePickup ? this.gigVenueRoadStop.get(target) : undefined;
    // The head keeps the kerb-facing orientation either way; only the post's
    // ground position moves out to the lane for a rider pickup.
    const spot = roadStop
      ? { x: roadStop.x, z: roadStop.z, facing: curb.facing }
      : curb;

    const tint = carrying
      ? new Color3(0.95, 0.78, 0.35)
      : new Color3(0.88, 0.33, 0.25);
    // Emissive, because against NYC's night palette a diffuse-only post is just
    // another dark shape on a dark sidewalk.
    const material = makeMaterial(
      this.scene,
      `gig-marker-${target}`,
      tint,
      tint.scale(0.85),
    );

    // Children are positioned in the node's local frame so the head turns with
    // it to face the carriageway.
    const node = new TransformNode(`gig-marker-${target}`, this.scene);
    node.position.set(spot.x, 0, spot.z);
    node.rotation.y = spot.facing;
    this.gigMarkerNode = node;
    createCylinder(
      this.scene,
      `gig-marker-${target}-post`,
      { diameter: 0.34, height: 2.6 },
      new Vector3(0, 1.3, 0),
      material,
      node,
    );
    createBox(
      this.scene,
      `gig-marker-${target}-head`,
      { width: 0.9, height: 0.9, depth: 0.26 },
      new Vector3(0, 3, 0),
      material,
      node,
    );
    for (const mesh of node.getChildMeshes()) mesh.isPickable = false;
  }

  private readonly renderFrame = () => {
    if (this.disposed || this.contextLost) return;
    const now = performance.now();
    const frameSeconds = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.pollGamepad();

    if (!this.paused) {
      this.accumulator = Math.min(this.accumulator + frameSeconds, FIXED_STEP * 6);
      while (this.accumulator >= FIXED_STEP && !this.paused) {
        this.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    }

    if (this.crowdRenderer) {
      if (!this.paused) this.crowdRenderer.advanceTime(frameSeconds);
      if (this.crowdDirty && this.crowdSim) {
        this.crowdRenderer.writeFrame(this.crowdSim.walkers);
        this.crowdDirty = false;
      }
    }

    if (!this.paused) {
      this.visualElapsedSeconds += frameSeconds;
      this.updateWaterVisuals(this.visualElapsedSeconds);
    }
    const interpolation = this.paused ? 1 : this.accumulator / FIXED_STEP;
    if (!this.paused) this.advanceCutscene(frameSeconds);
    this.updatePlayerVisuals(interpolation);
    this.updateNpcVisuals(interpolation);
    let mark = performance.now();
    this.updateGuidanceVisuals();
    this.perfSample(PERF_GUIDANCE, performance.now() - mark);
    if (!this.paused) this.updatePropFalls(frameSeconds);
    if (this.damageSmoke?.isStarted()) {
      // Trail the smoke from the engine bay, wherever the car is facing.
      this.damageSmokeEmitter.set(
        this.displayedX + Math.sin(this.displayedHeading) * 1.05,
        0.92,
        this.displayedZ + Math.cos(this.displayedHeading) * 1.05,
      );
    }
    mark = performance.now();
    this.updateCamera(frameSeconds);
    this.perfSample(PERF_CAMERA, performance.now() - mark);
    this.updateIndicatorLights(frameSeconds);
    this.playerCyclistVisual?.advancePedals?.(
      this.playerState.speedMps * frameSeconds,
    );
    this.updateAudio(frameSeconds);
    this.shadowRefreshSeconds += frameSeconds;
    if (this.shadowRefreshSeconds >= 0.5) {
      this.shadowRefreshSeconds = 0;
      this.refreshShadowCasters();
    }
    // Before the render, never after. `setHardwareScalingLevel` resizes, and a
    // resize can leave the bloom blurs recompiling; doing it here means the
    // very next thing that happens is a full redraw into the new buffer,
    // rather than the frame being presented mid-rebuild.
    this.governRenderScaling(now);
    const drawCallsBefore = this.engineDrawCallCount();
    mark = performance.now();
    this.scene.render();
    this.perfSample(PERF_SCENE_RENDER, performance.now() - mark);
    const drawCallsAfter = this.engineDrawCallCount();
    if (drawCallsBefore !== null && drawCallsAfter !== null) {
      this.perfDrawCalls += drawCallsAfter - drawCallsBefore;
    }
    this.perfFrames += 1;
    if (now - this.lastHudTime >= 100) this.publishHud();
  };

  /**
   * Trades resolution against frame rate, on touch only.
   *
   * Quiet while paused — a stalled frame rate would read as a device in
   * trouble and blur the scene the player is staring at — and quiet for the
   * first seconds after ready, where the frame rate still carries model upload
   * and shader warm-up rather than anything about the device.
   */
  private governRenderScaling(now: number) {
    if (!this.renderScaling || this.paused || this.contextLost) return;
    if (now < this.renderScalingArmedAt) return;
    if (now - this.lastRenderScalingCheck < RENDER_SCALING_WINDOW_MS) return;
    this.lastRenderScalingCheck = now;
    const level = stepRenderScaling(this.renderScaling, this.engine.getFps());
    if (level !== this.engine.getHardwareScalingLevel()) {
      this.engine.setHardwareScalingLevel(level);
    }
    this.applyPerfRung(this.renderScaling.index);
  }

  /**
   * Non-resolution costs stepped with the touch ladder. Only the blurriest
   * rung sheds the sun shadows — a device that cannot hold the softest
   * resolution needs its per-frame budget back more than shadow polish; the
   * governor restores them the moment it climbs. Toggling light.shadowEnabled
   * skips the shadow-map render without any resize, so unlike the resolution
   * rungs it can never flash (flashes come from setHardwareScalingLevel's
   * resize recompiling the bloom kernels — see renderScaling.ts).
   */
  private applyPerfRung(rungIndex: number) {
    const topRung = rungIndex < TOUCH_SCALING_LADDER.length - 1;
    const light = this.shadowGenerator?.getLight();
    if (light && light.shadowEnabled !== topRung) {
      light.shadowEnabled = topRung;
    }
    // The windscreen panes are the cabin's only fill-rate cost: two large
    // alpha-blended quads across most of the frame. Everything else in there is
    // a handful of opaque triangles, so this is the only cockpit detail worth
    // shedding, and the wipers go with the glass because a wiper resting on
    // nothing reads as a bug.
    for (const part of this.windscreenParts) {
      if (part.isEnabled(false) !== topRung) part.setEnabled(topRung);
    }
    // The mirrors are render targets: a device that cannot hold the softest
    // resolution should not be rendering the scene a second and third time for
    // two small panels, however cheap the cull has made them.
    this.mirrorsAllowed = topRung;
    this.setMirrorsActive(topRung && this.cameraMode === "first");
    this.rearViewPanel?.setEnabled(topRung);
    if (!topRung) this.wingMirrorRig?.setEnabled(false);
    else this.syncWingMirrorVisibility();
  }

  private perfSample(stage: number, ms: number) {
    this.perfSumMs[stage] += ms;
    if (ms > this.perfMaxMs[stage]) this.perfMaxMs[stage] = ms;
  }

  // Cumulative since page load (no per-frame reset without scene
  // instrumentation) — meaningful only as a delta between two reads.
  private engineDrawCallCount(): number | null {
    return (
      (this.engine as unknown as { _drawCalls?: { current: number } })
        ._drawCalls?.current ?? null
    );
  }

  /**
   * Per-substage frame-budget report since the previous poll; polling resets
   * the window. Fixed-step stages average per sim step, render stages per
   * rendered frame — on a 120 Hz display those denominators differ 2:1.
   */
  private drainPerfStats() {
    const frames = Math.max(1, this.perfFrames);
    const steps = Math.max(1, this.perfFixedSteps);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const stages: Record<string, { avgMs: number; maxMs: number }> = {};
    for (let stage = 0; stage < PERF_STAGE_COUNT; stage += 1) {
      const denominator = stage <= PERF_COLLISION ? steps : frames;
      stages[PERF_STAGE_NAMES[stage]] = {
        avgMs: round(this.perfSumMs[stage] / denominator),
        maxMs: round(this.perfMaxMs[stage]),
      };
    }
    const heapBytes = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory?.usedJSHeapSize;
    const report = {
      perfWindowFrames: this.perfFrames,
      perfWindowFixedSteps: this.perfFixedSteps,
      stages,
      drawCallsPerFrame: Math.round(this.perfDrawCalls / frames),
      // Chrome only; Safari has no performance.memory, so null there.
      heapUsedMB: heapBytes ? Math.round(heapBytes / 1048576) : null,
    };
    this.perfSumMs.fill(0);
    this.perfMaxMs.fill(0);
    this.perfFrames = 0;
    this.perfFixedSteps = 0;
    this.perfDrawCalls = 0;
    return report;
  }

  /**
   * Feeds the engine sound once per rendered frame. Deliberately not driven from
   * fixedUpdate, which runs anywhere from zero to six times per frame — audio
   * ramps need a steady wall clock, not a variable one.
   *
   * The throttle and steer expressions mirror fixedUpdate exactly so that what
   * you hear is what the simulation is acting on: an engine that revs on an
   * empty tank, or a squeal that ignores the steering-sensitivity setting, would
   * be a lie about the car's state.
   */
  private updateAudio(frameSeconds: number) {
    if (!this.audio) return;
    const input = this.mergedInput();
    // Mirror the simulation's pedal rules so the engine revs for whichever
    // pedal is actually driving and the brake layer plays when the opposite
    // one is scrubbing speed off.
    const signed = this.simulationSnapshot.player.signedSpeedMps;
    const rollingForward = signed > STOPPED_AUDIO_SPEED_MPS;
    const rollingBack = signed < -STOPPED_AUDIO_SPEED_MPS;
    const drivePedal = rollingForward
      ? input.throttle
      : rollingBack
        ? input.reverse
        : Math.max(input.throttle, input.reverse);
    const brakePedal = Math.max(
      input.brake,
      rollingForward ? input.reverse : rollingBack ? input.throttle : 0,
    );
    this.audio.update({
      dtSeconds: frameSeconds,
      speedMps: this.playerState.speedMps,
      signedSpeedMps: this.simulationSnapshot.player.signedSpeedMps,
      gear: this.playerState.gear,
      throttle: this.options.outOfFuel ? 0 : drivePedal,
      brake: brakePedal,
      steer: clamp(input.steer * this.options.steeringSensitivity, -1, 1),
      offRoad: this.simulationSnapshot.road.offRoad,
      outOfFuel: this.options.outOfFuel,
      firstPerson: this.cameraMode === "first",
    });
  }

  private fixedUpdate(dt: number) {
    // Runs before mergedInput reads it: a lifted thumb eases the wheel back to
    // centre over ~120ms instead of dropping it, which would read as a twitch.
    if (this.touchSteerReleasing) {
      this.touch.steer = releaseTouchSteer(this.touch.steer, dt);
      if (this.touch.steer === 0) this.touchSteerReleasing = false;
    }
    const input = this.mergedInput();
    this.ruleElapsedSeconds += dt;
    const quickLookAngle =
      Math.abs(input.quickLook) > 1.5 ? Math.PI : input.quickLook * 1.18;
    const simulationInput: SimulationInput = {
      throttle: this.options.outOfFuel ? 0 : input.throttle,
      brake: input.brake,
      reverse: this.options.outOfFuel ? 0 : input.reverse,
      steer: clamp(
        input.steer * this.options.steeringSensitivity,
        -1,
        1,
      ),
      viewHeading: this.playerState.heading + quickLookAngle,
      observe:
        input.quickLook <= -0.55
          ? "left"
          : input.quickLook >= 0.55 && input.quickLook < 1.5
            ? "right"
            : undefined,
    };
    let mark = performance.now();
    const snapshot = this.simulation.step(dt, simulationInput);
    this.perfSample(PERF_SIM_STEP, performance.now() - mark);
    mark = performance.now();
    this.applySimulationSnapshot(snapshot);
    this.perfSample(PERF_SNAPSHOT_APPLY, performance.now() - mark);
    const events = this.simulation.drainEvents();
    this.processSimulationEvents(events);
    if (events.length === 0) this.publishSimulationCoachMessage(snapshot);
    mark = performance.now();
    this.animatePedestrians(dt);
    if (this.crowdSim || this.railRoadUsers.length) this.refreshCrowdFrustum();
    this.syncRailRoadUsers(dt);
    this.stepAmbientCrowd(dt);
    this.updateDownedRoadUsers();
    this.perfSample(PERF_CROWD, performance.now() - mark);
    mark = performance.now();
    this.reportVulnerableRoadUserCollision();
    this.checkDestructiblePropCollisions();
    this.evaluateAuthoredProgress();
    this.perfSample(PERF_COLLISION, performance.now() - mark);
    this.perfFixedSteps += 1;
  }

  private reportVulnerableRoadUserCollision() {
    if (
      this.simulationSnapshot.status !== "running" ||
      this.playerState.speedMps < 0.25
    ) {
      return;
    }
    const impactSpeedMps = Math.round(this.playerState.speedMps * 10) / 10;
    for (const roadUser of this.pedestrians) {
      if (roadUser.downedUntilSeconds !== undefined) continue;
      const safetyRadius = roadUser.kind === "cyclist" ? 1.9 : 1.55;
      if (
        Math.hypot(
          this.playerState.x - roadUser.node.position.x,
          this.playerState.z - roadUser.node.position.z,
        ) >= safetyRadius
      ) {
        continue;
      }
      const cyclist = roadUser.kind === "cyclist";
      const reported = this.simulation.reportExternalContact(
        cyclist
          ? "Your vehicle collided with a cyclist."
          : roadUser.railMode
            ? "Your vehicle struck a pedestrian on the pavement."
            : "Your vehicle entered an occupied pedestrian crossing.",
        cyclist
          ? "Leave more clearance and wait for a safe opportunity to pass."
          : roadUser.railMode
            ? "Keep the car off the kerb and clear of people on foot."
            : "Brake early and yield until the crossing is completely clear.",
        cyclist ? 0.8 : 0.75,
        {
          roadUserType: cyclist ? "cyclist" : "pedestrian",
          impactSpeedMps,
        },
      );
      if (!reported) return;
      this.knockDownRoadUser(roadUser);
      this.audio?.impact(this.playerState.speedMps * 0.5, eventNow());
      this.emitImpactBurst(
        roadUser.node.position.x,
        0.9,
        roadUser.node.position.z,
        10,
      );
      const snapshot = this.simulation.getSnapshot();
      this.applySimulationSnapshot(snapshot);
      this.processSimulationEvents(this.simulation.drainEvents());
      return;
    }
    // The ambient crowd walks the pavement, so hitting one means the car is
    // up on the kerb — the same offence the old clone crowd reported.
    if (!this.crowdSim) return;
    for (const walker of this.crowdSim.walkers) {
      if (walker.state === "downed") continue;
      if (
        Math.hypot(
          this.playerState.x - walker.x,
          this.playerState.z - walker.z,
        ) >= 1.55
      ) {
        continue;
      }
      const reported = this.simulation.reportExternalContact(
        "Your vehicle struck a pedestrian on the pavement.",
        "Keep the car off the kerb and clear of people on foot.",
        0.75,
        {
          roadUserType: "pedestrian",
          impactSpeedMps,
        },
      );
      if (!reported) return;
      this.crowdSim.strike(walker, this.playerState.x, this.playerState.z);
      this.crowdDirty = true;
      this.audio?.impact(this.playerState.speedMps * 0.5, eventNow());
      this.emitImpactBurst(walker.x, 0.9, walker.z, 10);
      const snapshot = this.simulation.getSnapshot();
      this.applySimulationSnapshot(snapshot);
      this.processSimulationEvents(this.simulation.drainEvents());
      return;
    }
  }

  /** Starts a scenario road user's knockdown: the walker sim (if any) halts
   * in place, pedestrians face the car and play the fitted fall clip, and
   * cyclists tip over via updateDownedRoadUsers' per-frame roll. */
  private knockDownRoadUser(roadUser: Pedestrian) {
    roadUser.downedUntilSeconds =
      this.ruleElapsedSeconds + WALKER_DOWNED_TOTAL_SECONDS;
    roadUser.downPhase = "falling";
    const railEntry = this.railRoadUsers.find(
      (entry) => entry.pedestrian === roadUser,
    );
    if (railEntry) {
      const sim =
        railEntry.kind === "cyclist"
          ? this.roadUserCycleSim
          : this.roadUserPedSim;
      const walker = sim?.walkers[railEntry.index];
      if (sim && walker) {
        sim.strike(walker, this.playerState.x, this.playerState.z);
      }
    }
    if (roadUser.kind === "cyclist") return;
    if (!roadUser.railMode) {
      // Strip strollers own their node yaw; face the car so the fall reads
      // as being knocked away from it. Rail walkers get this via strike().
      roadUser.node.rotation.y = Math.atan2(
        this.playerState.x - roadUser.node.position.x,
        this.playerState.z - roadUser.node.position.z,
      );
    }
    roadUser.visual?.playKnockdown?.(WALKER_FALL_SECONDS);
  }

  /** Advances every knocked-down road user's phase: cyclists roll over and
   * back upright, pedestrians get their one-shot recover, and everyone
   * resumes walking when the shared knockdown window closes. */
  private updateDownedRoadUsers() {
    for (const roadUser of this.pedestrians) {
      if (roadUser.downedUntilSeconds === undefined) continue;
      const remaining = roadUser.downedUntilSeconds - this.ruleElapsedSeconds;
      if (remaining <= 0) {
        roadUser.downedUntilSeconds = undefined;
        roadUser.downPhase = undefined;
        if (roadUser.kind === "cyclist") roadUser.node.rotation.z = 0;
        else roadUser.visual?.setMoving?.(true);
        continue;
      }
      const phase = walkerDownedPhase(remaining);
      if (roadUser.kind === "cyclist") {
        const tilt =
          phase === "falling"
            ? 1 -
              (remaining - WALKER_LIE_SECONDS - WALKER_RISE_SECONDS) /
                WALKER_FALL_SECONDS
            : phase === "lying"
              ? 1
              : remaining / WALKER_RISE_SECONDS;
        roadUser.node.rotation.z = -1.35 * clamp(tilt, 0, 1);
      } else if (phase === "rising" && roadUser.downPhase !== "rising") {
        roadUser.visual?.playRecover?.(WALKER_RISE_SECONDS);
      }
      roadUser.downPhase = phase;
    }
  }

  private evaluateAuthoredProgress() {
    const lesson = this.options.lesson;
    const mapPack = this.options.mapPack;
    if (!lesson || !mapPack || this.routePoints.length < 2) {
      this.completeFromSimulationIfNeeded();
      return;
    }
    const state = this.playerState;
    const routeProjection = this.projectToAuthoredRoute(state.x, state.z);
    const roadProjection = this.projectToScenarioLanes(
      state.x,
      state.z,
      mapPack.laneGraph.lanes,
    );
    const projectedLane = roadProjection
      ? this.laneById?.get(roadProjection.laneId) ?? null
      : null;
    const roadTolerance =
      (projectedLane?.widthM ?? Math.min(3.5, mapPack.geometry.roadWidth * 0.45)) / 2 +
      (mapPack.geometry.shoulderWidth ?? 1);

    if (routeProjection && routeProjection.distance < roadTolerance * 1.4) {
      this.routeSegment = Math.max(this.routeSegment, routeProjection.segmentIndex);
      const candidateProgress =
        this.routeLength > 0 ? routeProjection.distanceAlong / this.routeLength : 0;
      if (candidateProgress <= this.routeProgress + 0.2) {
        this.routeProgress = Math.max(
          this.routeProgress,
          clamp(candidateProgress, 0, 1),
        );
      }
    }

    this.advanceAuthoredCheckpoints(lesson);
    for (const prompt of lesson.coachPrompts) {
      if (
        prompt.trigger.type === "route_progress" &&
        this.routeProgress >= prompt.trigger.value &&
        !this.triggeredPrompts.has(prompt.id)
      ) {
        this.triggeredPrompts.add(prompt.id);
        this.coach(prompt.message);
      }
    }

    if (lesson.kind === "free_drive") return;
    const endpoint = this.routePoints[this.routePoints.length - 1];
    const endpointReached = Math.hypot(state.x - endpoint.x, state.z - endpoint.z) <= 7;
    const checkpointsComplete =
      this.authoredCheckpoints.length === 0 ||
      this.checkpointIndex >= this.authoredCheckpoints.length;
    const maneuversComplete = (this.simulationSnapshot.maneuvers ?? []).every(
      (maneuver) => maneuver.phase === "complete",
    );
    if (
      this.simulationSnapshot.status !== "complete" &&
      checkpointsComplete &&
      maneuversComplete &&
      (endpointReached || this.routeProgress >= 0.97)
    ) {
      this.simulation.completeLesson();
      this.applySimulationSnapshot(this.simulation.getSnapshot());
    }
    this.completeFromSimulationIfNeeded();
  }

  private completeFromSimulationIfNeeded() {
    if (this.completed || this.simulationSnapshot.status !== "complete") return;
    this.completed = true;
    this.routeProgress = 1;
    this.instruction = this.options.lesson
      ? `${this.options.lesson.title} complete — review your score and incident timeline.`
      : "Orientation complete — safe positioning achieved.";
    this.emit("complete", this.instruction);
    this.callbacks.onComplete?.({ ...this.simulationSnapshot.score });
    this.publishHud(true);
  }

  private mergedInput(): AnalogInput {
    // The "game is unplayable" contract while an interaction scene plays:
    // every consumer (sim input, engine audio, steering visual, quick-look)
    // reads through here, so one gate locks them all.
    if (this.activeCutscene) return CUTSCENE_LOCKED_INPUT;
    // Reuses one scratch object: this runs ~5x per frame and every consumer
    // reads it synchronously — nothing may hold the result across frames.
    const merged = this.mergedInputScratch;
    merged.throttle = clamp(
      Math.max(this.keyboard.throttle, this.touch.throttle, this.gamepad.throttle),
      0,
      1,
    );
    merged.brake = clamp(
      Math.max(this.keyboard.brake, this.touch.brake, this.gamepad.brake),
      0,
      1,
    );
    merged.reverse = clamp(
      Math.max(this.keyboard.reverse, this.touch.reverse, this.gamepad.reverse),
      0,
      1,
    );
    merged.steer = clamp(
      strongestOfThree(this.keyboard.steer, this.touch.steer, this.gamepad.steer),
      -1,
      1,
    );
    merged.quickLook = strongestOfThree(
      this.keyboard.quickLook,
      this.touch.quickLook,
      this.gamepad.quickLook,
    );
    return merged;
  }

  private advanceAuthoredCheckpoints(lesson: GameCanvasLesson) {
    const reachedCheckpointIds = new Set(
      this.simulationSnapshot.reachedCheckpointIds,
    );
    while (this.checkpointIndex < this.authoredCheckpoints.length) {
      const next = this.authoredCheckpoints[this.checkpointIndex];
      if (!reachedCheckpointIds.has(next.id)) break;
      this.checkpoint = { x: next.x, z: next.z, heading: next.heading };
      this.checkpointLabel = next.label;
      this.checkpointIndex += 1;
      this.updateGuidanceVisuals();
      this.emit("coaching", `Checkpoint: ${next.label}.`);
      const checkpointPrompt = lesson.coachPrompts.find(
        (prompt) =>
          prompt.trigger.type === "checkpoint" &&
          prompt.trigger.checkpointId === next.id &&
          !this.triggeredPrompts.has(prompt.id),
      );
      if (checkpointPrompt) {
        this.triggeredPrompts.add(checkpointPrompt.id);
        this.coach(checkpointPrompt.message);
      }
      const transition = lesson.profileTransitions?.find(
        (item) => item.checkpointId === next.id,
      );
      if (transition) {
        this.instruction = transition.message;
        this.emit("coaching", transition.message, "warning");
      }
    }
  }

  private projectToAuthoredRoute(x: number, z: number): RouteProjection | null {
    if (this.routePoints.length < 2) return null;
    let best: RouteProjection | null = null;
    let accumulated = 0;
    for (let index = 0; index < this.routePoints.length - 1; index += 1) {
      const start = this.routePoints[index];
      const end = this.routePoints[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.max(0.0001, Math.hypot(dx, dz));
      const amount = clamp(
        ((x - start.x) * dx + (z - start.z) * dz) / (length * length),
        0,
        1,
      );
      const projectedX = start.x + dx * amount;
      const projectedZ = start.z + dz * amount;
      const distance = Math.hypot(x - projectedX, z - projectedZ);
      const nearCurrentRoute =
        index >= Math.max(0, this.routeSegment - 1) &&
        index <= this.routeSegment + 5;
      if (nearCurrentRoute && (!best || distance < best.distance)) {
        best = {
          segmentIndex: index,
          x: projectedX,
          z: projectedZ,
          heading: Math.atan2(dx, dz),
          distance,
          distanceAlong: accumulated + length * amount,
        };
      }
      accumulated += length;
    }
    return best;
  }

  private projectToScenarioLanes(
    x: number,
    z: number,
    lanes: readonly GameCanvasLane[],
  ): ScenarioLaneProjection | null {
    let best: ScenarioLaneProjection | null = null;
    for (const lane of lanes) {
      let accumulated = 0;
      for (let index = 0; index < lane.centerline.length - 1; index += 1) {
        const start = lane.centerline[index];
        const end = lane.centerline[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.max(0.0001, Math.hypot(dx, dz));
        const amount = clamp(
          ((x - start.x) * dx + (z - start.z) * dz) / (length * length),
          0,
          1,
        );
        const projectedX = start.x + dx * amount;
        const projectedZ = start.z + dz * amount;
        const distance = Math.hypot(x - projectedX, z - projectedZ);
        if (!best || distance < best.distance) {
          best = {
            laneId: lane.id,
            segmentIndex: index,
            x: projectedX,
            z: projectedZ,
            heading: Math.atan2(dx, dz),
            distance,
            distanceAlong: accumulated + length * amount,
            speedLimit: lane.speedLimit,
          };
        }
        accumulated += length;
      }
    }
    return best;
  }

  private buildConnectedNpcPath(
    mapPack: GameCanvasMapPack,
    startLaneId: string,
    branchOffset: number,
  ): { segments: NpcPathSegment[]; loop: boolean; loopStartSegment: number } {
    return buildConnectedNpcPath(
      mapPack.laneGraph.lanes,
      startLaneId,
      branchOffset,
    );
  }

  private isNpcPositionSafe(
    npc: NpcVehicle,
    x: number,
    z: number,
    heading: number,
    requireHiddenGate: boolean,
  ): boolean {
    const playerDx = this.playerState.x - x;
    const playerDz = this.playerState.z - z;
    const playerDistance = Math.hypot(playerDx, playerDz);
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const longitudinal = playerDx * forwardX + playerDz * forwardZ;
    const lateral = Math.abs(playerDx * forwardZ - playerDz * forwardX);
    const speed = Math.max(0, npc.speed);
    if (lateral < 12) {
      if (longitudinal >= 0 && longitudinal < 20) return false;
      if (longitudinal < 0 && -longitudinal < Math.max(30, speed * 3 + 6)) return false;
    }
    if (playerDistance < 18) return false;
    if (requireHiddenGate) {
      if (playerDistance < 70) return false;
      const playerForwardX = Math.sin(this.playerState.heading);
      const playerForwardZ = Math.cos(this.playerState.heading);
      const gateFromPlayerX = x - this.playerState.x;
      const gateFromPlayerZ = z - this.playerState.z;
      if (gateFromPlayerX * playerForwardX + gateFromPlayerZ * playerForwardZ > 0) return false;
    }
    for (const other of this.npcVehicles) {
      if (other === npc || other.active === false) continue;
      const requiredGap = Math.max(10, Math.max(speed, other.currentSpeed ?? other.speed) * 1.8 + 4);
      if (Math.hypot(other.laneX - x, other.z - z) < requiredGap) return false;
    }
    return true;
  }

  private ensureNpcVehicleVisual(
    npc: NpcVehicle,
    vehicleId: string,
    variant: NpcVehicleVariant,
  ) {
    if (
      npc.visualVehicleId === vehicleId &&
      npc.visualVariant === variant
    ) {
      return;
    }
    const appearance = resolveTrafficVehicleAppearance({
      vehicleId,
      trafficSeed: this.options.lesson?.trafficSeed ?? 0,
      variant,
      mapId: this.options.mapPack?.id ?? "orientation-yard",
    });
    const visualKey = appearanceVisualKey(appearance);
    npc.visualVehicleId = vehicleId;
    npc.visualVariant = variant;
    // Patrol status travels with the vehicle's identity, so a slot that recycles
    // from a patrol into a civilian (or a bus) stops being one — and never
    // inherits the outgoing vehicle's unfinished flash.
    npc.police = appearance.role === "police";
    npc.beaconUntilTick = 0;
    if (npc.visualKey === visualKey) return;
    npc.visual.dispose();
    npc.visual = createVehicleMesh(
      this.scene,
      npc.node,
      `${npc.node.name}-${vehicleId}`,
      appearance,
    );
    npc.visualKey = visualKey;
  }

  /** The closest active patrol car within `radiusM` of the player, if any. */
  private patrolNearPlayer(radiusM: number): NpcVehicle | null {
    const { x, z } = this.playerState;
    let closest: NpcVehicle | null = null;
    let closestDistance = radiusM;
    for (const npc of this.npcVehicles) {
      if (!npc.police || !npc.active) continue;
      const distance = Math.hypot(npc.laneX - x, npc.z - z);
      if (distance <= closestDistance) {
        closest = npc;
        closestDistance = distance;
      }
    }
    return closest;
  }

  /**
   * Whether an enforcement camera saw this violation.
   *
   * Only the two a camera can actually establish on its own. A fixed lens
   * cannot tell a wrong-way driver from one who has just cleared a turn, nor
   * whose fault a crash was, which is precisely why those stay a patrol's job —
   * and keeping collisions out is also what makes it impossible for a camera
   * and the unconditional pedestrian-strike fine to charge for the same moment.
   *
   * Speeding is the only one that needs a radius, because its evidence names no
   * signal. It runs at most once per the core's 8s cooldown on the rule, over
   * the sixteen or so points in a city, so it is nowhere near a hot path.
   */
  private trafficCameraWitnesses(event: SimulationRuleEvent): boolean {
    if (event.code === "red_light") {
      const lightId = event.evidence?.trafficLightId;
      return (
        typeof lightId === "string" &&
        this.trafficCameraControlIdByLightId.has(lightId)
      );
    }
    if (event.code === "speeding") {
      const { x, z } = this.playerState;
      return this.trafficCameraPoints.some(
        (point) =>
          Math.hypot(point.x - x, point.z - z) <= TRAFFIC_CAMERA_SPEED_RADIUS_M,
      );
    }
    return false;
  }

  /**
   * Places the low-poly building glb registered under `modelKey` at (x, z),
   * facing the road via the lane `heading` + the model's yaw offset. Returns
   * false when the key has no registered model or its glb has not preloaded,
   * signalling the caller to keep its procedural box.
   *
   * `modelKey` is usually the venue/service kind, but a venue may name a
   * variant instead so two restaurants on one map are different buildings. The
   * per-model quirks (a base slab to strip, where a name board sits) live on
   * the registry config rather than being switched on here — otherwise every
   * new variant silently inherits surgery meant for a different glb.
   */
  private instantiateProp(
    modelKey: string,
    x: number,
    z: number,
    heading: number,
    label?: string,
  ): boolean {
    const config = PROP_MODEL_REGISTRY[modelKey];
    if (!config || !isModelReady(this.scene, config.url)) return false;
    const instance = instantiateModel(this.scene, config.url);
    const root = instance?.rootNodes[0] as TransformNode | undefined;
    if (!instance || !root) return false;
    const holder = new TransformNode(
      `prop-${modelKey}-${Math.round(x)}-${Math.round(z)}`,
      this.scene,
    );
    holder.position.set(x, config.groundY ?? 0, z);
    holder.rotation.y = heading + config.yawOffset;
    root.parent = holder;
    root.scaling.set(
      config.mirrorX ? -config.scale : config.scale,
      config.scale,
      config.scale,
    );
    if (config.stripMeshPattern) {
      // Drop a diorama base slab so the building sits on the ground like a
      // normal storefront rather than on a plinth.
      const pattern = new RegExp(config.stripMeshPattern);
      for (const mesh of root.getChildMeshes()) {
        if (pattern.test(mesh.name)) mesh.dispose();
      }
    }
    if (label && config.signBoard) {
      // The model's sign surface is known exactly (declared in native units),
      // so letter the venue name straight onto it.
      this.addBoardSign(holder, root, label, config.signBoard);
    } else if (label && config.roofSignMinY !== undefined) {
      // These models bake mirrored lettering; overlay a legible name on the
      // board so it reads as the venue rather than as gibberish.
      this.addRoofSign(holder, root, label, config.roofSignMinY);
    }
    return true;
  }

  /**
   * Letters the venue name onto a model's own sign surface, declared as a
   * native-units box in the registry (see PropModelConfig.signBoard). The box
   * corners are pushed through the imported root's transform into holder space
   * — which absorbs the loader's handedness flip and the registry scale — and
   * one text plane is laid a few cm proud of the face that corresponds to the
   * box's native +Z-max side (the face the model's own signage occupies; its
   * reverse is typically unpainted). The lettering is drawn on a transparent
   * texture, so what renders is red lettering sitting on the model's own board
   * rather than a pasted-on billboard.
   */
  private addBoardSign(
    holder: TransformNode,
    root: TransformNode,
    label: string,
    board: NonNullable<PropModelConfig["signBoard"]>,
  ): void {
    holder.computeWorldMatrix(true);
    root.computeWorldMatrix(true);
    const toHolder = Matrix.Invert(holder.getWorldMatrix());
    const toWorld = root.getWorldMatrix();
    const inHolder = (x: number, y: number, z: number) =>
      Vector3.TransformCoordinates(
        Vector3.TransformCoordinates(new Vector3(x, y, z), toWorld),
        toHolder,
      );
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const local = inHolder(
        corner & 1 ? board.max[0] : board.min[0],
        corner & 2 ? board.max[1] : board.min[1],
        corner & 4 ? board.max[2] : board.min[2],
      );
      min.minimizeInPlace(local);
      max.maximizeInPlace(local);
    }
    // Which holder-space side of the box the native front (+Z-max) face landed
    // on — the imports rotate by multiples of 90°, so it maps to a box face.
    const front = inHolder(
      (board.min[0] + board.max[0]) / 2,
      (board.min[1] + board.max[1]) / 2,
      board.max[2],
    );

    const spanX = max.x - min.x;
    const spanZ = max.z - min.z;
    const alongX = spanX >= spanZ;
    const width = alongX ? spanX : spanZ;
    const height = max.y - min.y;
    const centre = min.add(max).scale(0.5);
    const side = alongX
      ? Math.sign(front.z - centre.z)
      : Math.sign(front.x - centre.x);

    const textureHeight =
      Math.max(64, Math.round((1024 * height) / width / 2)) * 2;
    const texture = new DynamicTexture(
      `${holder.name}-board-texture`,
      { width: 1024, height: textureHeight },
      this.scene,
      true,
    );
    texture.hasAlpha = true;
    const context = texture.getContext();
    const text = label.toUpperCase();
    let fontSize = Math.round(textureHeight * 0.62);
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    while (fontSize > 40 && context.measureText(text).width > 1024 * 0.9) {
      fontSize -= 10;
      context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    }
    // null clear colour: the canvas stays transparent outside the glyphs.
    texture.drawText(
      text,
      null,
      null,
      `bold ${fontSize}px Figtree, Arial, sans-serif`,
      "#a63527",
      null,
      true,
    );
    texture.update();

    const material = new StandardMaterial(
      `${holder.name}-board-material`,
      this.scene,
    );
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    // Emissive from the same texture so the lettering reads on the night maps
    // (bloom picks it up like the rest of the signage).
    material.emissiveTexture = texture;
    material.specularColor = Color3.Black();

    const faceOffset = (alongX ? spanZ : spanX) / 2 + 0.05;
    const plane = MeshBuilder.CreatePlane(
      `${holder.name}-board-sign`,
      { width, height },
      this.scene,
    );
    plane.parent = holder;
    // Babylon planes face -z natively, so the +side face needs the π flip.
    if (alongX) {
      plane.position.set(centre.x, centre.y, centre.z + faceOffset * side);
      plane.rotation.y = side === 1 ? Math.PI : 0;
    } else {
      plane.position.set(centre.x + faceOffset * side, centre.y, centre.z);
      plane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    }
    plane.material = material;
  }

  /**
   * Overlays a legible name on a model's roof board — used where the glb has a
   * free-standing board the venue name can cover whole (the gas station's
   * billboard). The board is found geometrically (the largest elevated thin
   * plate above `minCentreY`, in holder space so the search works at any yaw),
   * then a text plane is laid over each of its two big faces. Models whose sign
   * surface is merged into a larger primitive — invisible to this search —
   * declare it as `signBoard` instead (the diner, see addBoardSign).
   */
  private addRoofSign(
    holder: TransformNode,
    root: TransformNode,
    label: string,
    minCentreY: number,
  ): void {
    holder.computeWorldMatrix(true);
    const toHolder = Matrix.Invert(holder.getWorldMatrix());
    let board: { area: number; min: Vector3; max: Vector3 } | null = null;
    for (const mesh of root.getChildMeshes()) {
      mesh.computeWorldMatrix(true);
      const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const corner of corners) {
        const local = Vector3.TransformCoordinates(corner, toHolder);
        min.minimizeInPlace(local);
        max.maximizeInPlace(local);
      }
      const spanX = max.x - min.x;
      const spanY = max.y - min.y;
      const spanZ = max.z - min.z;
      const thin = Math.min(spanX, spanZ);
      const wide = Math.max(spanX, spanZ);
      const centreY = (min.y + max.y) / 2;
      if (centreY > minCentreY && spanY > 1.2 && thin < 2.2 && wide > 3) {
        const area = wide * spanY;
        if (!board || area > board.area) board = { area, min, max };
      }
    }
    if (!board) return;

    const texture = new DynamicTexture(
      `${holder.name}-sign-texture`,
      { width: 1024, height: 384 },
      this.scene,
      true,
    );
    const context = texture.getContext();
    const text = label.toUpperCase();
    let fontSize = 170;
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    while (fontSize > 40 && context.measureText(text).width > 1024 * 0.84) {
      fontSize -= 10;
      context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    }
    texture.drawText(
      text,
      null,
      null,
      `bold ${fontSize}px Figtree, Arial, sans-serif`,
      "#a63527",
      "#ece7da",
      true,
    );
    context.strokeStyle = "#a63527";
    context.lineWidth = 14;
    context.strokeRect(20, 20, 1024 - 40, 384 - 40);
    texture.update();

    const material = new StandardMaterial(
      `${holder.name}-sign-material`,
      this.scene,
    );
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.55, 0.55, 0.55);
    material.specularColor = Color3.Black();
    // Each face gets its own plane sitting proud of the opaque board, so
    // rendering both sides costs nothing and sidesteps winding-order surprises.
    material.backFaceCulling = false;

    const spanX = board.max.x - board.min.x;
    const spanZ = board.max.z - board.min.z;
    const alongX = spanX >= spanZ;
    const width = (alongX ? spanX : spanZ) * 0.94;
    const height = (board.max.y - board.min.y) * 0.86;
    const centre = board.min.add(board.max).scale(0.5);
    const faceOffset = (alongX ? spanZ : spanX) / 2 + 0.05;
    for (const side of [1, -1]) {
      const plane = MeshBuilder.CreatePlane(
        `${holder.name}-sign-${side}`,
        { width, height },
        this.scene,
      );
      plane.parent = holder;
      // Babylon planes face -z natively, so the +side face needs the π flip.
      if (alongX) {
        plane.position.set(centre.x, centre.y, centre.z + faceOffset * side);
        plane.rotation.y = side === 1 ? Math.PI : 0;
      } else {
        plane.position.set(centre.x + faceOffset * side, centre.y, centre.z);
        plane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      }
      plane.material = material;
    }
  }

  /**
   * Places a venue/station: the imported model when its glb has preloaded, else
   * the caller's procedural fallback (built under a holder node) recorded so
   * upgradePropsToModels can swap it for the model once preload finishes. The
   * environment is built during construction — before the async model preload —
   * so at first pass the model is never ready and every prop starts procedural.
   */
  private placeProp(
    kind: string,
    x: number,
    z: number,
    heading: number,
    id: string,
    buildFallback: (parent: TransformNode) => void,
    label?: string,
  ) {
    if (this.instantiateProp(kind, x, z, heading, label)) return;
    const fallback = new TransformNode(`prop-fallback-${id}`, this.scene);
    buildFallback(fallback);
    this.deferredProps.push({ kind, x, z, heading, fallback, label });
  }

  /**
   * The circles the street wall must not build inside: every service point's
   * lot and every gig venue's plot.
   *
   * Collected up front rather than as each is placed, because the procedural
   * facade grid runs inline while the instanced glb wall is deferred until
   * after preload — so a keep-out added during placement arrives in time for
   * one path and far too late for the other. That asymmetry stood a terrace
   * straight through London's and Tokyo's repair shops, and it was only ever
   * latent for the gas stations because every one of them happens to sit on
   * ground no block covers.
   */
  private collectBuildingExclusions(mapPack: GameCanvasMapPack) {
    this.buildingExclusions.push(...buildingKeepOuts(mapPack));
  }

  /**
   * Builds a repair shop out of `REPAIR_SHOP_PARTS`.
   *
   * The one service building with no glb behind it (see `repairShopLayout.ts`
   * for why), so it is assembled here from the same constants the collider
   * builder reads — which is what makes the wall you can see and the wall that
   * stops you the same wall.
   *
   * The holder is rotated by the lane **heading**, not by the lot's yaw: the
   * parts are authored in the frame `propFootprints.ts` documents, which already
   * has the service yaw offset baked in. Rotating by the full yaw would turn the
   * building a further quarter-turn out of its own colliders.
   */
  private buildRepairShop(
    id: string,
    lot: { x: number; z: number },
    heading: number,
    label: string,
  ) {
    const scene = this.scene;
    const holder = new TransformNode(`repair-shop-${id}`, scene);
    holder.position.set(lot.x, 0, lot.z);
    holder.rotation.y = heading;

    // A workshop reads as a workshop mostly by being lit inside while the street
    // is not, so the bay surfaces carry their own emissive rather than relying on
    // a lamp that the night city's fog would swallow anyway.
    const materials: Record<RepairShopSurface, StandardMaterial> = {
      shell: makeMaterial(scene, `${id}-shell`, new Color3(0.34, 0.36, 0.4)),
      trim: makeMaterial(
        scene,
        `${id}-trim`,
        new Color3(0.82, 0.36, 0.16),
        new Color3(0.24, 0.1, 0.03),
      ),
      floor: makeMaterial(
        scene,
        `${id}-floor`,
        new Color3(0.27, 0.28, 0.3),
        new Color3(0.16, 0.14, 0.1),
      ),
      apron: makeMaterial(scene, `${id}-apron`, new Color3(0.3, 0.31, 0.33)),
      door: makeMaterial(scene, `${id}-door`, new Color3(0.24, 0.26, 0.29)),
      glass: makeMaterial(
        scene,
        `${id}-glass`,
        new Color3(0.5, 0.6, 0.66),
        new Color3(0.3, 0.34, 0.28),
      ),
      shutter: makeMaterial(scene, `${id}-shutter`, new Color3(0.55, 0.57, 0.6)),
    };

    for (const part of REPAIR_SHOP_PARTS) {
      createBox(
        scene,
        `${id}-${part.id}`,
        {
          width: part.maxX - part.minX,
          height: part.maxY - part.minY,
          depth: part.maxZ - part.minZ,
        },
        new Vector3(
          (part.minX + part.maxX) / 2,
          (part.minY + part.maxY) / 2,
          (part.minZ + part.maxZ) / 2,
        ),
        materials[part.surface],
        holder,
      );
    }

    this.addRepairShopSign(holder, id, label);
  }

  /**
   * Letters the shop's name across its fascia.
   *
   * Deliberately not `addRoofSign`'s geometric board search: that hunts for the
   * largest thin elevated plate, which on a bare shell can just as easily latch
   * onto the roof and render a name plane the size of a wall. Here the fascia is
   * a known part, so the sign is placed off the same box that draws it.
   */
  private addRepairShopSign(
    holder: TransformNode,
    id: string,
    label: string,
  ): void {
    const fascia = REPAIR_SHOP_PARTS.find((part) => part.id === "fascia");
    if (!fascia) return;
    // Inset so the lettering sits on the band rather than running into the
    // corners of the building.
    const width = (fascia.maxZ - fascia.minZ) * 0.86;
    const height = (fascia.maxY - fascia.minY) * 0.62;

    const textureHeight =
      Math.max(64, Math.round((1024 * height) / width / 2)) * 2;
    const texture = new DynamicTexture(
      `${id}-fascia-texture`,
      { width: 1024, height: textureHeight },
      this.scene,
      true,
    );
    texture.hasAlpha = true;
    const context = texture.getContext();
    const text = label.toUpperCase();
    let fontSize = Math.round(textureHeight * 0.72);
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    while (fontSize > 40 && context.measureText(text).width > 1024 * 0.92) {
      fontSize -= 10;
      context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
    }
    // null clear colour: the canvas stays transparent outside the glyphs.
    texture.drawText(
      text,
      null,
      null,
      `bold ${fontSize}px Figtree, Arial, sans-serif`,
      "#f6f1e4",
      null,
      true,
    );
    texture.update();

    const material = new StandardMaterial(`${id}-fascia-material`, this.scene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    // Emissive from the same texture so the name reads on the night maps, the
    // way every other bit of signage in the city does.
    material.emissiveTexture = texture;
    material.specularColor = Color3.Black();

    const plane = MeshBuilder.CreatePlane(
      `${id}-fascia-sign`,
      { width, height },
      this.scene,
    );
    plane.parent = holder;
    plane.position.set(
      fascia.minX - 0.03,
      (fascia.minY + fascia.maxY) / 2,
      (fascia.minZ + fascia.maxZ) / 2,
    );
    // A Babylon plane faces -z natively; a quarter turn about Y points it down
    // -x, which is the side the road is on in this frame.
    plane.rotation.y = Math.PI / 2;
    plane.material = material;
  }

  /** Once the prop glbs preload, replace each procedural venue/station box with
   * its imported model, disposing the fallback. Kinds whose glb never loaded stay
   * procedural. Mirrors upgradeRoadUsersToModels for the environment props. */
  private upgradePropsToModels() {
    const stillProcedural: typeof this.deferredProps = [];
    for (const prop of this.deferredProps) {
      if (
        this.instantiateProp(prop.kind, prop.x, prop.z, prop.heading, prop.label)
      ) {
        prop.fallback.dispose(false, false);
      } else {
        stillProcedural.push(prop);
      }
    }
    this.deferredProps.length = 0;
    this.deferredProps.push(...stillProcedural);
  }

  /**
   * After preload, dress each building-set block with a street wall of instanced
   * glb buildings. Every placement of a given model shares one uploaded geometry
   * (instantiateModelInstanced), so hundreds of buildings cost a handful of draw
   * calls rather than hundreds. A block whose set never loaded (offline) falls
   * back to its procedural facade-box grid so it is never left empty.
   */
  /**
   * Night city: make every building material glow its own albedo/texture, so
   * facades and painted windows read as lit-from-within under the dim moonlight
   * (the low-poly glbs have no emissive of their own). Bloom does the rest.
   * Mutates the shared container materials once — all instances light up.
   */
  private applyBuildingNightGlow() {
    // Warm sodium/incandescent colour for lit windows (blue-hour amber). Kept
    // below pure white so bloom softens it to a glow instead of blowing it out.
    const WARM = new Color3(0.95, 0.6, 0.29);
    for (const url of this.buildingModelUrls) {
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
   * The merged single-mesh master for a building url (built once, hidden). All
   * of the glb's submeshes are baked into one mesh with a MultiMaterial, folding
   * in the loader's 180° flip, so a placement is a single createInstance. Returns
   * null (cached) if the glb can't be merged, so the caller uses the multi-mesh
   * path for that url.
   */
  private getBuildingMaster(url: string, squareUpYaw = 0): Mesh | null {
    const cached = this.buildingMasters.get(url);
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
        ? Mesh.MergeMeshes(meshes, true, true, undefined, false, true)
        : null;
      root.dispose(false, false);
      if (master) {
        // The merge bakes the loader's reflection into the vertices, which leaves
        // some models inside-out (street-facing walls back-face culled → hollow).
        // Reverse the winding of just those; see buildingWinding.ts.
        orientMergedFacesOutward(master);
        // Placement slots assume an axis-aligned body centred on the pivot;
        // square up rotated assets, then recentre (#143).
        squareUpMergedMaster(master, squareUpYaw);
        recentreMergedMasterXZ(master);
        master.isVisible = false;
        master.isPickable = false;
      }
    }
    this.buildingMasters.set(url, master);
    return master;
  }

  /**
   * A merged master per boat variant, sized so the hull reads at its authored
   * length and seated so the waterline sits WATER_BOAT_DRAUGHT_M up the hull.
   * The boats sail bow-first along local +z of the wave root; a model whose
   * long axis merged onto x gets the quarter turn.
   */
  private getWaterBoatMaster(
    variant: number,
  ): { mesh: Mesh; scale: number; yOffset: number; yawOffset: number } | null {
    const cached = this.waterBoatMasters.get(variant);
    if (cached !== undefined) return cached;
    const url = WATER_BOAT_MODEL_URLS[variant % WATER_BOAT_MODEL_URLS.length];
    const mesh = this.getBuildingMaster(url);
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

  /**
   * A variant master for the one retail glb: same merged-master shape as
   * getBuildingMaster, but with the baked "PIZZA" lettering swapped for the
   * variant's fascia sign and awning tint (storefrontMaster.ts) so streets
   * carry a mix of businesses instead of a row of identical pizzerias (#146).
   * Any assembly failure falls back to the plain master — baked pizza beats a
   * missing building.
   */
  private getStorefrontMaster(url: string, variant: StorefrontVariant): Mesh | null {
    const key = `${url}#${variant.id}`;
    const cached = this.buildingMasters.get(key);
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
            { nightGlow: this.visualPalette?.night ?? false },
          )
        : null;
      root.dispose(false, false);
      if (master) {
        master.isVisible = false;
        master.isPickable = false;
      }
    }
    master ??= this.getBuildingMaster(url);
    this.buildingMasters.set(key, master);
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
  private addCairoRoofClutter(building: PlacedBuilding, index: number) {
    const masters = this.cairoRoofClutterMasters;
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
    this.staticSceneryFreeze.push(inst);
    this.registerStaticCell(inst, building.x, building.z, false);
  }

  private buildInstancedBuildings() {
    if (this.visualPalette?.night) this.applyBuildingNightGlow();
    // Pull the Cairo kit's decal primitives off their wall planes; see
    // CAIRO_DECAL_Z_OFFSET_UNITS. Container materials are shared by every
    // instance and by the merged masters, so once per url covers the map.
    for (const url of this.buildingModelUrls) {
      if (CAIRO_STREET_WALL_URL_RE.test(url)) {
        biasCairoDecalMaterials(modelMaterials(this.scene, url));
      }
    }
    for (const { block, setId, buildFallback } of this.pendingBuildingBlocks) {
      const slotted = rotateBlockBuildingPlacements(
        slotBlockBuildings(
          block.center,
          block.size,
          setId,
          hashStringToSeed(`${block.id}-buildings`),
          this.buildingKeepFraction,
          block.streetEdges,
        ),
        block.center,
        block.headingDeg,
      );
      const placements = keptStreetWallBuildings(slotted, this.buildingExclusions);
      let placed = 0;
      for (const b of placements) {
        const master =
          b.modelId === STOREFRONT_MODEL_ID
            ? this.getStorefrontMaster(b.url, pickStorefrontVariant(b.x, b.z))
            : this.getBuildingMaster(
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
          this.staticSceneryFreeze.push(inst);
          // Mirror-only: these deliberately cast no sun shadow, so they are not
          // in the shadow ring — but a mirror with no street wall in it looks
          // broken, and the rear view is mostly buildings.
          this.registerStaticCell(inst, b.x, b.z, false);
          this.addCairoRoofClutter(b, placed);
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
        this.staticSceneryFreeze.push(holder);
        for (const mesh of root.getChildMeshes(false)) {
          mesh.isPickable = false;
          this.staticSceneryFreeze.push(mesh);
          this.registerStaticCell(mesh, b.x, b.z, false);
        }
        placed += 1;
      }
      if (placed === 0) buildFallback();
    }
    this.pendingBuildingBlocks.length = 0;

    // River craft: merged-master instances of the CC0 boats, one cheap scene
    // mesh per boat, parented under a root the wave animation moves. Scale and
    // waterline seat are measured from the merged bounds, so the felucca's
    // masthead lands exactly at its pinned air draft.
    let boatIndex = 0;
    for (const pending of this.pendingWaterBoats) {
      const master = this.getWaterBoatMaster(pending.placement.variant);
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

    // Sidewalk vendor carts: glb instances via the same merged-master path, so
    // each cart is one cheap scene mesh. Frozen alongside the rest of the
    // static scenery.
    let vendorIndex = 0;
    for (const vendor of this.pendingVendors) {
      const master = this.getBuildingMaster(vendor.config.url);
      if (!master) continue;
      const inst = master.createInstance(`vendor-${vendorIndex}`);
      vendorIndex += 1;
      inst.position.set(vendor.x, vendor.config.groundY + BUILDING_GROUND_LIFT, vendor.z);
      inst.rotation.y = vendor.yaw;
      inst.scaling.setAll(vendor.config.scale);
      inst.isPickable = false;
      this.staticSceneryFreeze.push(inst);
      this.registerDestructibleProp("vendor", vendor.x, vendor.z, 1, [
        { node: inst, isLightPool: false },
      ]);
    }
    this.pendingVendors.length = 0;

    this.buildParkPlanting();
  }

  /**
   * The imported planting, once its glbs are in.
   *
   * Species are chosen from what this city actually downloaded
   * (`natureModelsForMap`), so Cairo's "trees" resolve to palms and Tokyo's to
   * the temple set without any of that being spelled out here.
   */
  private buildParkPlanting() {
    const key = resolveMapVisualKey(this.options.mapPack?.id ?? "");
    const catalogue = natureModelsForMap(key);
    const canopy = catalogue.filter(
      (model) =>
        model.role === "tree" || model.role === "conifer" || model.role === "palm",
    );
    const shrubs = catalogue.filter((model) => model.role === "shrub");
    const monuments = catalogue.filter((model) => model.role === "monument");
    const speciesFor = (kind: string, variant: number) => {
      const pool =
        kind === "shrub" ? shrubs : kind === "monument" ? monuments : canopy;
      return pool.length ? pool[variant % pool.length] : null;
    };

    let index = 0;
    for (const placement of this.pendingParkProps) {
      const species = speciesFor(placement.kind, placement.variant);
      if (!species) continue;
      const master = this.getBuildingMaster(species.url);
      if (!master) continue;
      const instance = master.createInstance(`park-plant-${index}`);
      index += 1;
      instance.position.set(placement.x, 0, placement.z);
      instance.rotation.y = placement.rotationY;
      instance.scaling.setAll(species.scale * placement.scale);
      instance.isPickable = false;
      this.staticSceneryFreeze.push(instance);
      this.registerShadowCaster(instance, placement.x, placement.z);
      // A monument is masonry: it stands where a tree topples.
      if (placement.kind === "monument") continue;
      // Knockable exactly like a street tree — that consistency is the reason
      // park planting rides the same destructible path at all.
      this.registerDestructibleProp(
        placement.kind,
        placement.x,
        placement.z,
        placement.scale,
        [{ node: instance, isLightPool: false }],
      );
    }
    this.pendingParkProps.length = 0;

    // Deep planting is instanced, not merged. Merging a cell into one mesh
    // duplicates its geometry per plant, and on Central Park that cost **+100
    // MB of heap** (368 -> 468 on NYC) to save meshes. Instances share the
    // master's geometry, and because an imported tree is ONE merged glb mesh
    // where the procedural tree was four parts, a plant now costs a single
    // scene mesh — so the mesh count this was avoiding never materialises.
    for (const [thicketIndex, placement] of this.pendingParkThickets.entries()) {
      const species = speciesFor(placement.kind, placement.variant);
      if (!species) continue;
      const master = this.getBuildingMaster(species.url);
      if (!master) continue;
      const instance = master.createInstance(`park-thicket-${thicketIndex}`);
      instance.position.set(placement.x, 0, placement.z);
      instance.rotation.y = placement.rotationY;
      instance.scaling.setAll(species.scale * placement.scale);
      instance.isPickable = false;
      this.staticSceneryFreeze.push(instance);
      // Deliberately no shadow: a whole woodland in the 90 m caster ring would
      // swamp the 1024 shadow map for planting nobody can reach.
      this.registerStaticCell(instance, placement.x, placement.z, false);
    }
    this.pendingParkThickets.length = 0;
  }

  /**
   * Freeze the dense static scenery so the render loop stops recomputing world
   * matrices and bounding info for ~9k instanced meshes every frame (the cause
   * of the driving stutter). Frustum culling of the frozen set is still a
   * linear per-mesh sweep — the camera far plane riding the fog band is what
   * keeps the submitted set small. Runs once after the first render, when
   * every world matrix is already correct — freezing earlier (mid
   * construction) cached identity matrices and dropped buildings at the
   * origin.
   */
  private freezeStaticScenery() {
    // Parents-before-children order (as pushed) means each freeze reads an
    // already-frozen parent matrix.
    for (const node of this.staticSceneryFreeze) {
      node.computeWorldMatrix(true);
    }
    for (const node of this.staticSceneryFreeze) {
      node.freezeWorldMatrix();
      const mesh = node as unknown as { doNotSyncBoundingInfo?: boolean };
      if ("doNotSyncBoundingInfo" in mesh) mesh.doNotSyncBoundingInfo = true;
    }
    this.staticSceneryFreeze.length = 0;
  }

  private destructibleCellKey(x: number, z: number): string {
    return `${Math.floor(x / DESTRUCTIBLE_GRID_CELL_M)}:${Math.floor(z / DESTRUCTIBLE_GRID_CELL_M)}`;
  }

  /** Enrols a placed prop as knockable. Unknown kinds are silently ignored so
   * a new scatter kind fails soft (indestructible) rather than crashing. */
  private registerDestructibleProp(
    kind: string,
    x: number,
    z: number,
    scale: number,
    parts: readonly DestructiblePropPart[],
  ) {
    const config = DESTRUCTIBLE_PROP_CONFIGS[kind];
    if (!config || !parts.length) return;
    const prop: DestructibleProp = {
      kind,
      config,
      x,
      z,
      radiusM: config.radiusM * scale,
      parts,
      state: "standing",
    };
    const key = this.destructibleCellKey(x, z);
    const bucket = this.destructibleGrid.get(key);
    if (bucket) bucket.push(prop);
    else this.destructibleGrid.set(key, [prop]);
  }

  /** The car's two capsule circles against every standing prop nearby. */
  private checkDestructiblePropCollisions() {
    if (
      this.simulationSnapshot.status !== "running" ||
      this.playerState.speedMps < PROP_MIN_STRIKE_SPEED_MPS ||
      this.destructibleGrid.size === 0
    ) {
      return;
    }
    const { x, z, heading } = this.playerState;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const column = Math.floor(x / DESTRUCTIBLE_GRID_CELL_M);
    const row = Math.floor(z / DESTRUCTIBLE_GRID_CELL_M);
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const bucket = this.destructibleGrid.get(`${column + dc}:${row + dr}`);
        if (!bucket) continue;
        for (const prop of bucket) {
          if (prop.state !== "standing") continue;
          const reach = prop.radiusM + PLAYER_CAPSULE_RADIUS_M;
          let contact = false;
          for (let end = -1; end <= 1 && !contact; end += 2) {
            const cx = x + forwardX * PLAYER_CAPSULE_HALF_LENGTH_M * end;
            const cz = z + forwardZ * PLAYER_CAPSULE_HALF_LENGTH_M * end;
            contact = Math.hypot(cx - prop.x, cz - prop.z) < reach;
          }
          if (contact) this.strikeDestructibleProp(prop);
        }
      }
    }
  }

  private strikeDestructibleProp(prop: DestructibleProp) {
    const impactSpeed = this.playerState.speedMps;
    if (prop.config.damage !== "none") {
      const reported = this.simulation.reportExternalContact(
        prop.config.fall === "squash"
          ? `You drove through ${prop.config.noun}.`
          : `You knocked over ${prop.config.noun}.`,
        "Mind the kerbside furniture.",
        prop.config.speedScale,
        {
          obstacle: "prop",
          propKind: prop.kind,
          impactSpeedMps: Math.round(impactSpeed * 10) / 10,
        },
      );
      if (!reported) return;
      const snapshot = this.simulation.getSnapshot();
      this.applySimulationSnapshot(snapshot);
      this.processSimulationEvents(this.simulation.drainEvents());
      this.audio?.impact(impactSpeed * 0.55, eventNow());
    } else {
      this.audio?.impact(Math.min(impactSpeed * 0.2, 1.5), eventNow());
    }
    prop.state = "falling";

    // Fall away from the car; a dead-centre hit falls along the travel dir.
    let fallX = prop.x - this.playerState.x;
    let fallZ = prop.z - this.playerState.z;
    const fallLength = Math.hypot(fallX, fallZ);
    if (fallLength > 1e-3) {
      fallX /= fallLength;
      fallZ /= fallLength;
    } else {
      fallX = Math.sin(this.playerState.heading);
      fallZ = Math.cos(this.playerState.heading);
    }

    const pivot = new TransformNode(`prop-fall-${prop.kind}`, this.scene);
    pivot.position.set(prop.x, 0, prop.z);
    const poolParts: TransformNode[] = [];
    for (const part of prop.parts) {
      part.node.unfreezeWorldMatrix();
      if (part.isLightPool) {
        poolParts.push(part.node);
        continue;
      }
      part.node.setParent(pivot);
    }
    if (prop.config.fall === "topple") {
      // Rotating about this horizontal axis tips the top toward (fallX, fallZ).
      pivot.rotationQuaternion = Quaternion.Identity();
      pivot.metadata = { axis: new Vector3(fallZ, 0, -fallX) };
    }
    const fall: ActivePropFall = { prop, pivot, poolParts, progress: 0 };
    if (this.activePropFalls.length >= PROP_MAX_ACTIVE_TOPPLES) {
      fall.progress = 1;
      this.applyPropFallPose(fall);
      this.settlePropFall(fall);
      return;
    }
    this.activePropFalls.push(fall);
    this.emitImpactBurst(prop.x, 0.7, prop.z, prop.config.damage === "none" ? 6 : 14);
  }

  private applyPropFallPose(fall: ActivePropFall) {
    const { prop, pivot } = fall;
    // Ease out with a small overshoot so the fall lands with a bounce.
    const t = Math.min(1, fall.progress);
    const eased = 1 - (1 - t) * (1 - t);
    const overshoot = t < 0.72 ? eased * 1.07 : 1.07 - ((t - 0.72) / 0.28) * 0.07;
    if (prop.config.fall === "squash") {
      pivot.scaling.y = 1 - 0.68 * eased;
      pivot.scaling.x = 1 + 0.22 * eased;
      pivot.scaling.z = 1 + 0.22 * eased;
      return;
    }
    const axis = (pivot.metadata as { axis: Vector3 }).axis;
    Quaternion.RotationAxisToRef(
      axis,
      PROP_TOPPLE_MAX_ANGLE_RAD * overshoot,
      pivot.rotationQuaternion!,
    );
    pivot.position.y = -0.06 * eased;
    for (const pool of fall.poolParts) {
      pool.position.y = 0.07 - 1.4 * eased;
    }
  }

  private settlePropFall(fall: ActivePropFall) {
    fall.prop.state = "down";
    // Refreeze at the settled pose so the wreckage costs nothing per frame.
    fall.pivot.computeWorldMatrix(true);
    for (const part of fall.prop.parts) {
      part.node.computeWorldMatrix(true);
      part.node.freezeWorldMatrix();
    }
  }

  private updatePropFalls(frameSeconds: number) {
    if (!this.activePropFalls.length) return;
    for (let index = this.activePropFalls.length - 1; index >= 0; index -= 1) {
      const fall = this.activePropFalls[index];
      fall.progress += frameSeconds / PROP_TOPPLE_SECONDS;
      this.applyPropFallPose(fall);
      if (fall.progress >= 1) {
        this.settlePropFall(fall);
        this.activePropFalls.splice(index, 1);
      }
    }
  }

  /** Shared one-shot burst system for prop crunches and hard impacts. */
  private ensureImpactPuffs(): ParticleSystem {
    if (this.impactPuffs) return this.impactPuffs;
    const texture = new DynamicTexture("impact-puff", 64, this.scene, false);
    const context = texture.getContext();
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 30);
    gradient.addColorStop(0, "rgba(235, 230, 220, 0.9)");
    gradient.addColorStop(1, "rgba(235, 230, 220, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.update();
    const puffs = new ParticleSystem("impact-puffs", 160, this.scene);
    puffs.particleTexture = texture;
    puffs.emitter = new Vector3(0, -50, 0);
    puffs.minEmitBox = new Vector3(-0.5, 0, -0.5);
    puffs.maxEmitBox = new Vector3(0.5, 0.6, 0.5);
    puffs.minLifeTime = 0.3;
    puffs.maxLifeTime = 0.7;
    puffs.minSize = 0.35;
    puffs.maxSize = 1.0;
    puffs.emitRate = 0;
    puffs.manualEmitCount = 0;
    puffs.minEmitPower = 0.8;
    puffs.maxEmitPower = 2.4;
    puffs.direction1 = new Vector3(-1, 0.6, -1);
    puffs.direction2 = new Vector3(1, 1.4, 1);
    puffs.gravity = new Vector3(0, -1.6, 0);
    puffs.color1 = new Color4(0.9, 0.87, 0.8, 0.55);
    puffs.color2 = new Color4(0.75, 0.72, 0.66, 0.4);
    puffs.colorDead = new Color4(0.7, 0.68, 0.64, 0);
    puffs.updateSpeed = 0.016;
    puffs.start();
    this.impactPuffs = puffs;
    return puffs;
  }

  private emitImpactBurst(x: number, y: number, z: number, count: number) {
    if (this.options.reducedMotion) return;
    const puffs = this.ensureImpactPuffs();
    (puffs.emitter as Vector3).set(x, y, z);
    puffs.manualEmitCount = count;
  }

  /** Continuous engine-bay smoke while the car's condition is low; rate and
   * colour step up as it worsens. Off (and never created) while healthy. */
  private ensureDamageSmoke(): ParticleSystem {
    if (this.damageSmoke) return this.damageSmoke;
    const texture = new DynamicTexture("damage-smoke", 64, this.scene, false);
    const context = texture.getContext();
    const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 30);
    gradient.addColorStop(0, "rgba(200, 200, 205, 0.85)");
    gradient.addColorStop(1, "rgba(200, 200, 205, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.update();
    const smoke = new ParticleSystem("damage-smoke", 90, this.scene);
    smoke.particleTexture = texture;
    smoke.emitter = this.damageSmokeEmitter;
    smoke.minEmitBox = new Vector3(-0.18, 0, -0.18);
    smoke.maxEmitBox = new Vector3(0.18, 0.1, 0.18);
    smoke.minLifeTime = 0.7;
    smoke.maxLifeTime = 1.4;
    smoke.minSize = 0.25;
    smoke.maxSize = 0.7;
    smoke.minEmitPower = 0.4;
    smoke.maxEmitPower = 0.9;
    smoke.direction1 = new Vector3(-0.2, 1, -0.2);
    smoke.direction2 = new Vector3(0.2, 1.6, 0.2);
    smoke.gravity = new Vector3(0, 0.6, 0);
    smoke.updateSpeed = 0.016;
    this.damageSmoke = smoke;
    return smoke;
  }

  private syncDamageSmoke() {
    const pct = this.options.carConditionPct ?? 100;
    const heavy = pct <= SMOKE_HEAVY_CONDITION_PCT;
    if (pct > SMOKE_LIGHT_CONDITION_PCT) {
      this.damageSmoke?.stop();
      return;
    }
    const smoke = this.ensureDamageSmoke();
    smoke.emitRate = heavy ? 34 : 13;
    const tone = heavy ? 0.32 : 0.62;
    smoke.color1 = new Color4(tone, tone, tone + 0.03, heavy ? 0.6 : 0.4);
    smoke.color2 = new Color4(tone * 0.8, tone * 0.8, tone * 0.8, heavy ? 0.45 : 0.3);
    smoke.colorDead = new Color4(tone, tone, tone, 0);
    if (!smoke.isStarted()) smoke.start();
  }

  /**
   * Pre-warm the render pipeline before the drive starts, so the first corner
   * doesn't stall. WebGL compiles a material's shader — and uploads its
   * geometry, textures and instance buffers — lazily on first render; driving
   * straight only pays for what's on that street, so turning to reveal new
   * geometry hitches until it's all been rendered once. Here we force every
   * mesh active (bypassing frustum culling) and render a couple of frames while
   * the loading gate is still up, paying every first-render cost upfront. The
   * first render also fires the static-scenery freeze (registered just before).
   */
  private warmUpPipeline() {
    if (!this.scene.activeCamera && !(this.scene.activeCameras?.length)) return;
    // Populate the shadow map's caster list so the shadow-depth shaders compile
    // during warm-up too, not on the first corner.
    this.refreshShadowCasters();
    // A drive that starts in third person has the cockpit disabled here, so its
    // shaders and buffers would otherwise be paid for mid-drive, on whichever
    // frame the player first presses C. Enable it for the warm-up regardless of
    // the recorded camera and put it back after — disabled meshes are skipped
    // entirely, so without this the whole cabin is a hitch waiting to happen.
    const cockpitWasEnabled = this.playerCockpit.isEnabled(false);
    this.playerCockpit.setEnabled(true);
    const renderable = this.scene.meshes.filter((m) => m.getTotalVertices() > 0);
    const previous = renderable.map((m) => m.alwaysSelectAsActiveMesh);
    for (const mesh of renderable) mesh.alwaysSelectAsActiveMesh = true;
    try {
      // Two frames: the first compiles/uploads, the second confirms a clean pass.
      this.scene.render();
      this.scene.render();
    } catch {
      // Warm-up is best-effort — never block the drive from starting.
    }
    renderable.forEach((mesh, index) => {
      mesh.alwaysSelectAsActiveMesh = previous[index];
    });
    this.playerCockpit.setEnabled(cockpitWasEnabled);
  }

  private applySimulationNpcSnapshots(snapshot: SimulationSnapshot) {
    for (const npc of this.npcVehicles) {
      npc.active = false;
      npc.node.setEnabled(false);
    }
    const slotAssignments = resolveNpcVisualSlotAssignments(
      this.npcVehicles,
      snapshot.npcs,
    );
    for (const [vehicleIndex, vehicle] of snapshot.npcs.entries()) {
      const npc = this.npcVehicles[slotAssignments[vehicleIndex]];
      if (!npc) continue;
      const previousSpeed = npc.currentSpeed ?? vehicle.speedMps;
      const reassigned = npc.simulationId !== vehicle.id;
      npc.simulationId = vehicle.id;
      this.ensureNpcVehicleVisual(npc, vehicle.id, vehicle.variant);
      npc.active = true;
      npc.laneId = vehicle.laneId;
      npc.currentSpeed = vehicle.speedMps;
      npc.speed = vehicle.speedMps;
      npc.signal = vehicle.signal;
      npc.braking =
        vehicle.state === "stopping" ||
        vehicle.state === "yielding" ||
        vehicle.speedMps < previousSpeed - 0.015;
      npc.visual.setBraking(npc.braking);
      if (npc.police) {
        const flashing = snapshot.tick < (npc.beaconUntilTick ?? 0);
        // Offset per vehicle so two patrols never strobe in lockstep.
        const lamps = flashing
          ? policeBeaconLamps(
              snapshot.tick * FIXED_STEP_SECONDS + vehicleIndex * 0.17,
            )
          : { red: 0, blue: 0 };
        npc.visual.setBeacon(lamps.red, lamps.blue);
      }
      npc.visual.setDetailVisible(
        Math.hypot(
          vehicle.x - snapshot.player.x,
          vehicle.z - snapshot.player.z,
        ) <= 55,
      );
      npc.laneX = vehicle.x;
      npc.z = vehicle.z;
      // Held off screen for a running cutscene (the patrol a traffic stop is
      // standing its own rig in for). Keyed on the simulation id rather than
      // the render slot, and re-applied every tick because this loop enables
      // every active vehicle from scratch.
      npc.node.setEnabled(vehicle.id !== this.hiddenNpcSimulationId);
      // Shift the pose pair for updateNpcVisuals' render-rate blend. A slot
      // that changed cars, or a car that jumped a teleport-sized gap, snaps —
      // blending across either would streak the vehicle through the map.
      if (
        reassigned ||
        shouldSnapPose(
          npc.poseX,
          npc.poseZ,
          vehicle.x,
          vehicle.z,
          POSE_SNAP_STEP_M,
        )
      ) {
        npc.prevPoseX = vehicle.x;
        npc.prevPoseZ = vehicle.z;
        npc.prevPoseHeading = vehicle.heading;
      } else {
        npc.prevPoseX = npc.poseX;
        npc.prevPoseZ = npc.poseZ;
        npc.prevPoseHeading = npc.poseHeading;
      }
      npc.poseX = vehicle.x;
      npc.poseZ = vehicle.z;
      npc.poseHeading = vehicle.heading;
    }
  }

  private applySimulationSnapshot(snapshot: SimulationSnapshot) {
    const previousX = this.playerState.x;
    const previousZ = this.playerState.z;
    const previousHeading = this.playerState.heading;
    this.simulationSnapshot = snapshot;
    // A gap no legal drive can produce is a teleport (tow reset, checkpoint
    // restore): snap the pair together so the render blend never streaks the
    // car across the map for a frame.
    if (
      shouldSnapPose(
        previousX,
        previousZ,
        snapshot.player.x,
        snapshot.player.z,
        POSE_SNAP_STEP_M,
      )
    ) {
      this.playerState.previousX = snapshot.player.x;
      this.playerState.previousZ = snapshot.player.z;
      this.playerState.previousHeading = snapshot.player.heading;
    } else {
      this.playerState.previousX = previousX;
      this.playerState.previousZ = previousZ;
      this.playerState.previousHeading = previousHeading;
    }
    this.playerState.x = snapshot.player.x;
    this.playerState.z = snapshot.player.z;
    this.playerState.heading = snapshot.player.heading;
    this.playerState.speedMps = snapshot.player.speedMps;
    this.playerState.gear = snapshot.player.gear === "drive" ? "D" : "R";
    this.playerState.indicator = snapshot.player.signal;
    this.score = snapshot.score.total;
    this.activeTrafficSide = snapshot.trafficSide;
    this.applySimulationNpcSnapshots(snapshot);
    this.updateAuthoredSignalVisuals();
    this.updateManeuverCoaching(snapshot);

    const npcHonkActive = snapshot.honk.active;
    if (npcHonkActive && !this.lastSimulationHonkActive) {
      this.hornUntil = eventNow() + 1_150;
      // Pitched and muffled differently from your own horn, so being honked at
      // reads as another car rather than a phantom press of your own button.
      this.audio?.hornBlip(0.6, snapshot.tick);
    }
    this.lastSimulationHonkActive = npcHonkActive;
  }

  private updateManeuverCoaching(snapshot: SimulationSnapshot) {
    for (const maneuver of snapshot.maneuvers ?? []) {
      const previousPhase = this.maneuverPhases.get(maneuver.id);
      if (previousPhase === maneuver.phase) continue;
      this.maneuverPhases.set(maneuver.id, maneuver.phase);
      const prompt = this.options.lesson?.coachPrompts.find(
        (candidate) =>
          candidate.trigger.type === "maneuver_phase" &&
          candidate.trigger.maneuverId === maneuver.id &&
          candidate.trigger.phase === maneuver.phase &&
          !this.triggeredPrompts.has(candidate.id),
      );
      if (!prompt) continue;
      this.triggeredPrompts.add(prompt.id);
      this.instruction = prompt.message;
      this.emit("coaching", prompt.message, "info");
    }
  }

  private processSimulationEvents(events: readonly SimulationRuleEvent[]) {
    // A scene owns the car while it runs — the driver's hands are off the
    // wheel, and a traffic stop is actively steering it across lanes onto the
    // kerb. Every rule the monitors trip in that window is an artifact of the
    // choreography rather than something the player did, so none of it is
    // voiced, scored or charged for. It also closes the obvious loop: without
    // this, the pull-over's own kerb-side park would read as leaving the road
    // and summon a second pull-over the moment the first ended.
    if (this.activeCutscene) return;
    for (const event of events) {
      const prompt = this.options.lesson?.coachPrompts.find(
        (candidate) =>
          candidate.trigger.type === "rule_event" &&
          candidate.trigger.ruleCode === event.code &&
          !this.triggeredPrompts.has(candidate.id),
      );
      if (prompt) this.triggeredPrompts.add(prompt.id);
      const correction = prompt?.message ?? event.correction;
      this.instruction = correction;
      this.lastSimulationCoachMessage = correction;
      if (event.code === "collision") {
        const impact = event.evidence?.impactSpeedMps;
        const impactMps = typeof impact === "number" ? impact : 0;
        // Prop and pedestrian contacts trigger their own softened thud at the
        // report site (and keep sounding inside the event cooldown); only
        // wall and vehicle crashes voice from the event stream.
        if (!event.evidence?.externalRoadUser) {
          this.audio?.impact(impactMps, eventNow());
        }
        this.impactKick = Math.min(
          1,
          Math.max(this.impactKick, (impactMps || 4) / 12),
        );
      }
      this.emit(
        event.severity === "critical"
          ? "incident"
          : event.code === "collision"
            ? "collision"
            : "coaching",
        `${event.message} ${correction}`,
        event.severity === "critical" ? "critical" : "warning",
        {
          ruleCode: event.code,
          penalty: event.penalty,
          evidence: event.evidence,
        },
      );
      if (event.severity === "critical") {
        this.setPaused(true);
      } else if (
        event.code === "wrong_way" ||
        event.code === "out_of_bounds" ||
        event.code === "red_light" ||
        // Speeding is the one fineable rule with a threshold of its own: the
        // monitor's tolerance is set to coach, not to ticket, so a patrol only
        // acts on the wider citation band.
        (event.code === "speeding" && speedingWarrantsCitation(event.evidence)) ||
        // Crashing into cars or buildings is fined when witnessed too;
        // pedestrian strikes are cited unconditionally by the app instead.
        (event.code === "collision" && !event.evidence?.roadUserType)
      ) {
        const patrol = this.patrolNearPlayer(35);
        if (patrol) {
          // A softened violation witnessed by a patrol → the app stages the
          // pull-over, which is what actually debits the fine. That patrol's
          // light bar strobes immediately, so you see who clocked you a beat
          // before the scene swings the camera round.
          patrol.beaconUntilTick =
            this.simulationSnapshot.tick + PATROL_BEACON_TICKS;
          // The evidence rides along because the app prices a speeding ticket
          // off how far over the driver was, and the `cite` step it lands on
          // carries nothing but a nonce.
          this.emit("fine", "A patrol clocked the violation.", "warning", {
            ruleCode: event.code,
            evidence: event.evidence,
            issuedBy: "patrol",
          });
        } else if (this.trafficCameraWitnesses(event)) {
          // `else`, not a second `if`: one violation can be answered once. An
          // officer on the scene outranks the camera above them because the
          // stop is the better moment, and this is what makes being charged
          // twice for one offence structurally impossible rather than a matter
          // of two debounce clocks agreeing.
          this.emit("fine", "A traffic camera caught the violation.", "warning", {
            ruleCode: event.code,
            evidence: event.evidence,
            issuedBy: "camera",
          });
        }
      }
    }
  }

  private publishSimulationCoachMessage(snapshot: SimulationSnapshot) {
    const message = snapshot.coachingMessage;
    if (!message || message === this.lastSimulationCoachMessage) return;
    this.lastSimulationCoachMessage = message;
    this.instruction = message;
    this.emit("coaching", message, "info");
  }

  /**
   * The head's snapshot light, via a resolved-index cache. getSnapshot maps
   * the core's trafficLights array, whose membership and order are fixed for
   * the session, so the index a head resolves once holds for every later
   * snapshot; the id recheck (a ≤4-entry includes) catches anything that
   * would break that. -1 records "no light exists for this head" — the
   * fixed-clock fallback case. Before this cache, every head ran a find()
   * over every light with an includes() inside, per fixed step: 27x more
   * iterations after the NYC grid grew, and the top per-frame CPU cost.
   */
  private resolvedSignalLight(
    visual: {
      readonly trafficLightIds: readonly string[];
      resolvedLightIndex?: number;
    },
    lights: SimulationSnapshot["trafficLights"],
  ): SimulationSnapshot["trafficLights"][number] | null {
    const cached = visual.resolvedLightIndex;
    if (cached === -1) return null;
    if (cached !== undefined) {
      const light = lights[cached];
      if (light && visual.trafficLightIds.includes(light.id)) return light;
    }
    const index = lights.findIndex((light) =>
      visual.trafficLightIds.includes(light.id),
    );
    visual.resolvedLightIndex = index;
    return index >= 0 ? lights[index] : null;
  }

  private updateAuthoredSignalVisuals() {
    const lights = this.simulationSnapshot.trafficLights;
    for (const head of this.authoredSignalHeads) {
      const simulationLight = this.resolvedSignalLight(head, lights);
      const aspect: AuthoredSignalAspect = simulationLight?.state ??
        authoredSignalAspectAt({
          elapsedSeconds: this.trafficLightSeconds,
          controlId: head.controlId,
          phaseGroup: head.phaseGroup,
          phaseGroups: head.phaseGroups,
          style: head.style,
        });
      if (aspect === head.lastAspect) continue;
      head.lastAspect = aspect;
      const redOn =
        aspect === "red" || aspect === "red_amber" || aspect === "all_red";
      const amberOn = aspect === "amber" || aspect === "red_amber";
      const greenOn = aspect === "green";
      head.redColor.copyFromFloats(
        redOn ? 0.75 : 0.08,
        redOn ? 0.025 : 0.005,
        redOn ? 0.015 : 0.005,
        1,
      );
      head.amberColor.copyFromFloats(
        amberOn ? 0.72 : 0.08,
        amberOn ? 0.31 : 0.04,
        amberOn ? 0.015 : 0.005,
        1,
      );
      head.greenColor.copyFromFloats(
        greenOn ? 0.01 : 0.005,
        greenOn ? 0.46 : 0.06,
        greenOn ? 0.1 : 0.012,
        1,
      );
    }
    for (const crossing of this.railwayCrossingVisuals) {
      const light = this.resolvedSignalLight(crossing, lights);
      const warningActive = Boolean(light && light.state !== "green");
      const flashIndex = Math.floor(this.simulationSnapshot.elapsedMs / 360) % 2;
      // The lamps alternate on a 360ms clock — rewrite them only on a tick
      // boundary or a state flip, not sixty times a second.
      if (
        warningActive !== crossing.lastWarningActive ||
        flashIndex !== crossing.lastFlashIndex
      ) {
        crossing.lastWarningActive = warningActive;
        crossing.lastFlashIndex = flashIndex;
        crossing.lampColors.forEach((color, index) => {
          const illuminated = warningActive && index % 2 === flashIndex;
          color.copyFromFloats(
            illuminated ? 0.92 : 0.08,
            illuminated ? 0.035 : 0.005,
            illuminated ? 0.02 : 0.005,
            1,
          );
        });
      }
      const targetBarrierRotation = warningActive ? 0 : -1.22;
      if (this.options.reducedMotion) {
        crossing.barrierPivot.rotation.z = targetBarrierRotation;
      } else {
        crossing.barrierPivot.rotation.z +=
          (targetBarrierRotation - crossing.barrierPivot.rotation.z) * 0.16;
      }
    }
  }

  private animatePedestrians(dt: number) {
    for (const pedestrian of this.pedestrians) {
      // Rail-mode road users are positioned by their walker sim instead.
      if (pedestrian.railMode) continue;
      // Knocked down: hold position and facing until the window closes.
      if (pedestrian.downedUntilSeconds !== undefined) continue;
      const span = pedestrian.span ?? 16;
      // The sawtooth this replaced covered `span` metres in 18 phase units, so
      // this keeps every road user's ground speed exactly as tuned.
      const metersPerSec = (span * pedestrian.speed) / 18;
      const next = stepStroll(
        {
          distanceM: pedestrian.distanceM,
          walkDir: pedestrian.walkDir ?? 1,
          pauseRemaining: pedestrian.pauseRemaining ?? 0,
        },
        span,
        metersPerSec,
        pedestrian.kind === "cyclist" ? 0.4 : PED_TURN_PAUSE_S,
        dt,
      );
      pedestrian.distanceM = next.distanceM;
      pedestrian.walkDir = next.walkDir;
      pedestrian.pauseRemaining = next.pauseRemaining;
      const moving = next.pauseRemaining <= 0;
      pedestrian.visual?.setMoving?.(moving);
      if (moving) pedestrian.visual?.advancePedals?.(metersPerSec * dt);
      const flip = next.walkDir === 1 ? 0 : Math.PI;
      if (pedestrian.origin && pedestrian.heading !== undefined) {
        const along = -span / 2 + next.distanceM;
        pedestrian.node.position.x = pedestrian.origin.x + Math.sin(pedestrian.heading) * along;
        pedestrian.node.position.z = pedestrian.origin.z + Math.cos(pedestrian.heading) * along;
        pedestrian.node.rotation.y = pedestrian.heading + flip;
      } else {
        pedestrian.node.position.x = -8 + next.distanceM;
        pedestrian.node.position.z = pedestrian.z;
        pedestrian.node.rotation.y = Math.PI / 2 + flip;
      }
    }
  }

  /**
   * Draws the car at the blend of its previous and current sim poses — real
   * fixed-step interpolation, not smoothing. The old exponential chase here
   * re-derived its blend factor from the accumulator phase every frame, so at
   * speed the car (and the camera chasing it) hopped by the phase difference
   * each frame — the high-speed "nodding" jitter, at its worst on 120 Hz
   * displays where the sim steps on alternating frames.
   */
  private updatePlayerVisuals(interpolation: number) {
    const state = this.playerState;
    const alpha = this.options.reducedMotion ? 1 : interpolation;
    this.displayedX = lerpValue(state.previousX, state.x, alpha);
    this.displayedZ = lerpValue(state.previousZ, state.z, alpha);
    this.displayedHeading = lerpHeading(
      state.previousHeading,
      state.heading,
      alpha,
    );
    this.player.position.set(
      this.displayedX,
      0.12 - this.cutsceneDipOffset,
      this.displayedZ,
    );
    this.player.rotation.y = this.displayedHeading;
    const visualSteer = this.mergedInput().steer;
    if (this.steeringAssembly) {
      this.steeringAssembly.rotation.y = resolveSteeringWheelSpin(visualSteer);
    }
    this.updateGaugeNeedles();
  }

  /**
   * Points the two dials at what the car is actually doing.
   *
   * The tachometer reuses the audio model's own `targetRpm` and gear ratios, so
   * the needle rises and drops on the same curve as the engine note. It calls
   * those pure functions rather than reading `DriveAudio`, which is null
   * whenever Web Audio is unavailable — a muted tab must still have a working
   * rev counter. The cost is that the ratio comes from road speed instead of the
   * voice's hysteresis state, so during a shift the two can briefly disagree by
   * one gear. On a dial that is a needle settling a moment early.
   */
  private updateGaugeNeedles() {
    if (this.gaugeNeedles.length !== 2) return;
    const speed = this.playerState.speedMps;
    this.gaugeNeedles[0].rotation.z = resolveGaugeNeedleAngle(
      speed,
      COCKPIT_SPEEDO_MAX_MPS,
    );
    const input = this.mergedInput();
    const signed = this.simulationSnapshot.player.signedSpeedMps;
    const reverse = signed < -STOPPED_AUDIO_SPEED_MPS;
    const load = this.options.outOfFuel
      ? 0
      : reverse
        ? input.reverse
        : Math.max(input.throttle, input.reverse);
    const gear =
      GEAR_TOP_MPS.findIndex((top) => speed <= top) + 1 || GEAR_TOP_MPS.length;
    const rpm = targetRpm(gear, speed, load, reverse);
    this.gaugeNeedles[1].rotation.z = resolveGaugeNeedleAngle(
      rpm - ENGINE.idleRpm,
      ENGINE.redlineRpm - ENGINE.idleRpm,
    );
  }

  /**
   * Same prev/current blend for the ambient cars. Walkers and cyclists stay
   * fixed-step on purpose — at ≤1.4 m/s they move under 2.5cm per step, below
   * anything a frame can show. Skips disabled slots; the fixed-step apply
   * owns setEnabled, lamps and detail levels.
   */
  private updateNpcVisuals(interpolation: number) {
    const alpha = this.options.reducedMotion ? 1 : interpolation;
    for (const npc of this.npcVehicles) {
      if (!npc.active) continue;
      npc.node.position.set(
        lerpValue(npc.prevPoseX, npc.poseX, alpha),
        0.12,
        lerpValue(npc.prevPoseZ, npc.poseZ, alpha),
      );
      npc.node.rotation.y = lerpHeading(
        npc.prevPoseHeading,
        npc.poseHeading,
        alpha,
      );
    }
  }

  /**
   * Pins the chase camera to its steady-state pose behind the car. Used at
   * construction and on pose teleports (tow reset): the per-frame smoothing
   * would otherwise glide the camera in from wherever it last stood — at
   * session start that is the ArcRotate construction pose near the map
   * origin, a cross-map swoop. The deleted upperRadiusLimit used to mask
   * the construction case by yanking the camera to within 16m of the target
   * on the first setTarget; this does the job on purpose instead.
   */
  private snapChaseCameraToPose() {
    const chase =
      (this.options.playerVehicle?.model &&
        CHASE_TUNING_BY_MODEL[this.options.playerVehicle.model]) ||
      DEFAULT_CHASE_TUNING;
    const forward = this.cameraForwardScratch.set(
      Math.sin(this.displayedHeading),
      0,
      Math.cos(this.displayedHeading),
    );
    const base = this.cameraBaseScratch.set(
      this.displayedX,
      0.12,
      this.displayedZ,
    );
    const target = this.cameraTargetScratch.copyFrom(base);
    forward.scaleAndAddToRef(chase.targetAheadM, target);
    target.y += 1.05;
    const desired = this.cameraDesiredScratch.copyFrom(base);
    forward.scaleAndAddToRef(-chase.backM, desired);
    desired.y += chase.upM;
    this.thirdCamera.position.copyFrom(desired);
    this.thirdCamera.setTarget(target, undefined, true);
  }

  private updateCamera(dt: number) {
    const routeHeading =
      this.playerState.speedMps < 0.2
        ? this.projectToAuthoredRoute(this.displayedX, this.displayedZ)
        : null;
    const chaseHeading =
      routeHeading && routeHeading.distance < 5
        ? routeHeading.heading
        : this.displayedHeading;
    const forward = this.cameraForwardScratch.set(
      Math.sin(chaseHeading),
      0,
      Math.cos(chaseHeading),
    );
    const right = this.cameraRightScratch.set(forward.z, 0, -forward.x);
    const base = this.cameraBaseScratch.set(
      this.displayedX,
      0.12,
      this.displayedZ,
    );
    // Shake/bob phase advances with distance covered, capped: uncapped, the
    // chase shake's |sin| vertical term reached ~21 Hz at top speed — beyond
    // what 60 Hz sampling can express, so it aliased into flicker instead of
    // reading as speed. The cap pins it at ~5 Hz; amplitude still scales
    // with true speed below.
    this.cameraMotionSeconds +=
      dt * Math.min(this.playerState.speedMps, CAMERA_MOTION_SPEED_CAP_MPS);
    const look = this.mergedInput().quickLook;
    const quickLookAngle = Math.abs(look) > 1.5 ? Math.PI : look * 1.18;

    if (this.activeCutscene) {
      // The staged wide shot: glide to it on the same lerp the chase camera
      // uses (slower, for a cinematic ease); the chase/cockpit pose resumes
      // through the same smoothing when the scene ends.
      if (this.options.reducedMotion) {
        this.thirdCamera.position.copyFrom(this.activeCutscene.cameraPosition);
      } else {
        const smooth = 1 - Math.exp(-3.5 * dt);
        Vector3.LerpToRef(
          this.thirdCamera.position,
          this.activeCutscene.cameraPosition,
          smooth,
          this.thirdCamera.position,
        );
      }
      // allowSamePosition: see the camera scratch fields — without it a
      // retained target object suppresses the spherical rebuild and the
      // position writes above are clobbered.
      this.thirdCamera.setTarget(
        this.activeCutscene.cameraTarget,
        undefined,
        true,
      );
    } else if (this.cameraMode === "first") {
      const seatSide = this.options.steeringSide === "left" ? -0.46 : 0.46;
      const headBob =
        this.options.headBob && !this.options.reducedMotion
          ? Math.sin(this.cameraMotionSeconds * 1.9) *
            Math.min(0.015, this.playerState.speedMps * 0.0015)
          : 0;
      const poses = resolveCockpitCameraPoses({
        x: this.displayedX,
        z: this.displayedZ,
        vehicleHeading: this.displayedHeading,
        cameraHeading: this.displayedHeading,
        seatSide,
        headBob,
        quickLookAngle,
        viewportAspectRatio:
          this.engine.getRenderWidth() /
          Math.max(1, this.engine.getRenderHeight()),
      });
      this.firstCamera.position.set(
        poses.first.x,
        poses.first.y,
        poses.first.z,
      );
      this.firstCamera.rotation.set(
        poses.first.rotationX,
        poses.first.rotationY,
        0,
      );
      this.rearCamera.position.set(
        poses.rear.x,
        poses.rear.y,
        poses.rear.z,
      );
      this.rearCamera.rotation.set(
        poses.rear.rotationX,
        poses.rear.rotationY,
        0,
      );
      if (this.wingMirrorCamera) {
        // Bolted to the car, not to the head: the wing mirror does not bob or
        // swing with a quick look, because the mirror it is standing in for is
        // welded to the door.
        const wing = resolveWingMirrorPose({
          x: this.displayedX,
          z: this.displayedZ,
          vehicleHeading: this.displayedHeading,
          steeringSide: this.options.steeringSide,
        });
        this.wingMirrorCamera.position.set(wing.x, wing.y, wing.z);
        this.wingMirrorCamera.rotation.set(wing.rotationX, wing.rotationY, 0);
      }
    } else {
      const chase =
        (this.options.playerVehicle?.model &&
          CHASE_TUNING_BY_MODEL[this.options.playerVehicle.model]) ||
        DEFAULT_CHASE_TUNING;
      const target = this.cameraTargetScratch.copyFrom(base);
      forward.scaleAndAddToRef(chase.targetAheadM, target);
      target.y += 1.05;
      const cameraShake =
        this.options.cameraShake && !this.options.reducedMotion
          ? Math.sin(this.cameraMotionSeconds * 2.7) *
            Math.min(0.08, this.playerState.speedMps * 0.004)
          : 0;
      const desiredPosition = this.cameraDesiredScratch.copyFrom(base);
      forward.scaleAndAddToRef(-chase.backM, desiredPosition);
      right.scaleAndAddToRef(cameraShake, desiredPosition);
      desiredPosition.y += chase.upM + Math.abs(cameraShake) * 0.35;
      if (this.options.reducedMotion) {
        this.thirdCamera.position.copyFrom(desiredPosition);
      } else {
        const smooth = 1 - Math.exp(-7 * dt);
        Vector3.LerpToRef(
          this.thirdCamera.position,
          desiredPosition,
          smooth,
          this.thirdCamera.position,
        );
      }
      // allowSamePosition: see the camera scratch fields — without it the
      // reused target scratch suppresses the spherical rebuild and the
      // position write above is clobbered by the stale pose.
      this.thirdCamera.setTarget(target, undefined, true);
    }

    // Impact kick: a short decaying jolt on top of whichever camera is live,
    // fed by collision events. Applied post-pose so the smoothing above
    // cannot iron it out.
    this.impactShakeSeconds += dt;
    if (this.impactKick > 0.012) {
      if (this.options.cameraShake && !this.options.reducedMotion) {
        const kick = this.impactKick;
        const jab = Math.sin(this.impactShakeSeconds * 47) * 0.24 * kick;
        const lift = Math.cos(this.impactShakeSeconds * 39) * 0.11 * kick;
        const camera =
          this.cameraMode === "first" ? this.firstCamera : this.thirdCamera;
        right.scaleAndAddToRef(jab, camera.position);
        camera.position.y += lift;
      }
      this.impactKick *= Math.exp(-5.2 * dt);
    }
  }

  private updateIndicatorLights(dt: number) {
    this.indicatorBlinkSeconds = (this.indicatorBlinkSeconds + dt) % 0.8;
    const blinkOn = this.indicatorBlinkSeconds < 0.4;
    const indicator = this.playerState.indicator;
    // A click on every edge the driver (or an auto-cancel) can produce: signal
    // engaged, signal cancelled, or the relay's own on/off half-cycle — the
    // same rhythm a physical flasher relay makes.
    const changedSignal = indicator !== this.previousIndicatorSignal;
    const changedPhase = indicator !== "off" && blinkOn !== this.previousIndicatorBlinkOn;
    if (changedSignal || changedPhase) {
      this.audio?.indicatorTick(indicator !== "off" && blinkOn);
    }
    this.previousIndicatorSignal = indicator;
    this.previousIndicatorBlinkOn = blinkOn;
    this.playerVehicleVisual?.setSignal(indicator, blinkOn);
    this.playerVehicleVisual?.setBraking(
      Math.max(this.keyboard.brake, this.touch.brake, this.gamepad.brake) > 0.08,
    );
    for (const npc of this.npcVehicles) {
      npc.visual.setSignal(npc.signal ?? "off", blinkOn);
      npc.visual.setBraking(Boolean(npc.braking));
    }
  }

  /**
   * Lane ids the active lesson can actually reach, walking successors and
   * adjacency as an undirected graph out from the route. Returns null when the
   * lesson has no route (free drive), meaning "show everything". Used to drop
   * road surfaces on a disconnected practice track—e.g. the orientation yard's
   * opposite-side loop—so they don't sit beside the route as a phantom
   * oncoming carriageway.
   */
  private lessonReachableLaneIds(
    mapPack: GameCanvasMapPack,
  ): Set<string> | null {
    const route = this.options.lesson?.route ?? [];
    if (!route.length) return null;
    const neighbors = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      const bucket = neighbors.get(from) ?? new Set<string>();
      bucket.add(to);
      neighbors.set(from, bucket);
    };
    for (const lane of mapPack.laneGraph.lanes) {
      for (const successor of lane.successors ?? []) {
        link(lane.id, successor);
        link(successor, lane.id);
      }
      for (const adjacent of lane.adjacentLaneIds ?? []) {
        link(lane.id, adjacent);
        link(adjacent, lane.id);
      }
    }
    const laneExists = new Set(mapPack.laneGraph.lanes.map((lane) => lane.id));
    const reachable = new Set<string>();
    const queue: string[] = [];
    for (const laneId of route) {
      if (laneExists.has(laneId) && !reachable.has(laneId)) {
        reachable.add(laneId);
        queue.push(laneId);
      }
    }
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of neighbors.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    return reachable;
  }

  private buildScenarioEnvironment(mapPack: GameCanvasMapPack) {
    const scene = this.scene;
    const mapId = mapPack.id.toLowerCase();
    const palette = resolveMapVisualPalette(mapId);
    const cairoScene = resolveMapVisualKey(mapId) === "cairo";
    this.visualPalette = palette;
    this.createSkyAndHorizon(palette, mapId, mapPack.geometry.worldSize);

    // Paved cities (NYC) render the base ground as concrete and the road shoulder
    // as a wider concrete sidewalk; everywhere else keeps grass + a dirt shoulder.
    const paved = palette.paved ?? false;

    const grass = makeMaterial(scene, "scenario-ground", new Color3(0.24, 0.39, 0.25));
    const asphalt = makeMaterial(scene, "scenario-asphalt", Color3.White());
    asphalt.diffuseTexture = createAsphaltTexture(
      scene,
      "scenario-asphalt-texture",
      // Medium-dark grey (was near-black #1b2125) so dark/black vehicles read
      // against the road instead of vanishing into it.
      "#383d42",
      hashStringToSeed(`${mapId}-asphalt`),
    );
    const sharedSpace = makeMaterial(scene, "scenario-shared-space", Color3.White());
    sharedSpace.diffuseTexture = createAsphaltTexture(
      scene,
      "scenario-shared-space-texture",
      "#40413e",
      hashStringToSeed(`${mapId}-shared`),
    );
    const terminalSurface = makeMaterial(
      scene,
      "scenario-terminal-surface",
      Color3.White(),
    );
    terminalSurface.diffuseTexture = createAsphaltTexture(
      scene,
      "scenario-terminal-texture",
      "#25292b",
      hashStringToSeed(`${mapId}-terminal`),
    );
    // On paved maps this band is the concrete sidewalk (textured like the road
    // but lighter); elsewhere it is a worn earth verge. Both go through the
    // asphalt generator — its noise, soft patches and hairline cracks describe
    // a scuffed dirt verge as well as they describe tarmac, and a flat colour
    // beside newly detailed grass is exactly where the eye lands.
    const dirtShoulder = makeMaterial(scene, "scenario-dirt-shoulder", Color3.White());
    dirtShoulder.diffuseTexture = createAsphaltTexture(
      scene,
      paved ? "scenario-sidewalk-texture" : "scenario-verge-texture",
      paved ? palette.pavement ?? "#6a6e71" : palette.dirtShoulder,
      hashStringToSeed(`${mapId}-${paved ? "sidewalk" : "verge"}`),
    );
    const routeMaterial = makeMaterial(
      scene,
      "scenario-route",
      new Color3(0.86, 0.66, 0.19),
      new Color3(0.08, 0.045, 0.005),
    );
    routeMaterial.alpha = 0.58;
    const laneMaterial = makeMaterial(scene, "scenario-marking", new Color3(0.88, 0.88, 0.79));
    const yellowMarkingMaterial = makeMaterial(
      scene,
      "scenario-yellow-marking",
      new Color3(0.9, 0.68, 0.08),
    );
    const dark = makeMaterial(scene, "scenario-fixture", new Color3(0.08, 0.1, 0.1));
    const stopRed = makeMaterial(scene, "scenario-stop", new Color3(0.72, 0.08, 0.06));
    const yieldGold = makeMaterial(scene, "scenario-yield", new Color3(0.92, 0.68, 0.13));
    const checkpointMaterial = makeMaterial(
      scene,
      "scenario-checkpoint",
      new Color3(0.12, 0.68, 0.62),
      new Color3(0.025, 0.16, 0.13),
    );

    // Night cities dim to a cool moonlight so the city's own emissive glow
    // (lit building facades, streetlights, signage) carries the scene.
    const night = palette.night ?? false;
    const hemi = new HemisphericLight("scenario-sky-light", new Vector3(0.1, 1, 0.15), scene);
    // Dusk / blue hour: a cool blue sky fill from above (twilight) plus a warm
    // low "sun" (set to palette.sunTint in createSkyAndHorizon) and a warm
    // ground bounce, so building faces + the street pick up sodium warmth
    // against the cool sky — the classic blue-hour warm/cool split. Bright
    // enough that the road + car stay clearly readable.
    hemi.intensity = night ? 0.64 : 0.5;
    hemi.diffuse = night
      ? new Color3(0.44, 0.54, 0.76)
      : new Color3(0.82, 0.88, 0.98);
    hemi.groundColor = night
      ? new Color3(0.38, 0.29, 0.18)
      : new Color3(0.34, 0.3, 0.24);
    const sun = new DirectionalLight("scenario-sun", new Vector3(-0.42, -1, 0.48), scene);
    sun.intensity = night ? 0.6 : 1.3;
    if (night) scene.ambientColor = new Color3(0.23, 0.22, 0.26);
    this.createSunShadows(sun);

    const groundWidth = Math.max(90, mapPack.geometry.worldSize.x + 36);
    const groundHeight = Math.max(90, mapPack.geometry.worldSize.z + 36);
    const groundTexture = paved
      ? createAsphaltTexture(
          scene,
          "scenario-ground-texture",
          palette.groundBase ?? "#4c5053",
          hashStringToSeed(`${mapId}-ground`),
        )
      : createGrassTexture(
          scene,
          "scenario-ground-texture",
          palette,
          hashStringToSeed(`${mapId}-grass`),
          !this.lowSpec,
        );
    grass.diffuseColor = Color3.White();
    grass.diffuseTexture = groundTexture;
    const ground = MeshBuilder.CreateGround(
      "scenario-world",
      { width: groundWidth, height: groundHeight, subdivisions: 1 },
      scene,
    );
    if (paved) {
      groundTexture.uScale = groundWidth / 10;
      groundTexture.vScale = groundHeight / 10;
    } else {
      // World-planar UVs instead of a uScale, so park lawns can share both the
      // tile origin and the detail texture. The ground sits at the world origin
      // untranslated, so its local positions are already world positions.
      this.applyWorldPlanarGrassUVs(ground);
      this.applyGrassDetailMap(grass, mapId);
    }
    setMeshMaterial(ground, grass, true);
    ground.freezeWorldMatrix();
    this.registerMirrorSurface(ground);
    this.buildWaterBodies(mapPack, mapId);

    const authoredRoadSurfaces = mapPack.geometry.roadSurfaces?.length
      ? mapPack.geometry.roadSurfaces
      : mapPack.laneGraph.lanes.map((lane) => ({
          id: `legacy-${lane.id}`,
          centerline: lane.centerline,
          widthM: lane.widthM ?? mapPack.geometry.roadWidth,
          sidewalkWidthM: undefined,
          laneIds: [lane.id],
          surfaceType: "standard" as const,
          markings: [],
        }));
    // Drop surfaces the lesson can never reach so a disconnected practice track
    // stops reading as an oncoming carriageway. Falls back to everything if the
    // filter would empty the map (route/surface id mismatch).
    const reachableLaneIds = this.lessonReachableLaneIds(mapPack);
    const connectedRoadSurfaces = reachableLaneIds
      ? authoredRoadSurfaces.filter((surface) =>
          surface.laneIds.some((laneId) => reachableLaneIds.has(laneId)),
        )
      : authoredRoadSurfaces;
    const roadSurfaces = connectedRoadSurfaces.length
      ? connectedRoadSurfaces
      : authoredRoadSurfaces;
    const defaultShoulderWidth = paved
      ? PAVED_SIDEWALK_WIDTH_M
      : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2);
    for (const surface of roadSurfaces) {
      const shoulderWidth = Math.max(
        0,
        surface.sidewalkWidthM ?? defaultShoulderWidth,
      );
      const surfaceMaterial =
        surface.surfaceType === "shared_space"
          ? sharedSpace
          : surface.surfaceType === "terminal"
          ? terminalSurface
            : asphalt;
      // A slightly wider dirt band under each carriageway grounds the road
      // in the landscape instead of letting it float on the green plane.
      this.registerMirrorSurface(
        this.createRoadSurfaceMesh(
          `road-shoulder-${surface.id}`,
          surface.centerline,
          surface.widthM + shoulderWidth * 2,
          dirtShoulder,
          surface.surfaceType === "roundabout",
          ROAD_SHOULDER_Y,
        ),
      );
      this.registerMirrorSurface(
        this.createRoadSurfaceMesh(
          `road-${surface.id}`,
          surface.centerline,
          surface.widthM,
          surfaceMaterial,
          surface.surfaceType === "roundabout",
        ),
      );
    }
    // Dirt-shoulder fills first (lowest), then the asphalt fills, mirroring the
    // strip layering so a junction reads as one continuous surface. Square
    // corners here: this band's outer edge is the building line.
    const shoulderJunctionSurfaces = roadSurfaces.map((surface) => ({
      ...surface,
      widthM:
        surface.widthM +
        Math.max(
          0,
          surface.sidewalkWidthM ?? defaultShoulderWidth,
        ) *
          2,
    }));
    for (const [index, fill] of collectRoadJunctionFills(
      shoulderJunctionSurfaces,
      0,
      0,
    ).entries()) {
      const shoulderFill = this.createRoadJunctionFill(
        `road-junction-shoulder-${index}`,
        fill,
        dirtShoulder,
        ROAD_SHOULDER_JUNCTION_FILL_Y,
      );
      if (shoulderFill) {
        this.registerStaticCell(shoulderFill, fill.pivot.x, fill.pivot.z, false);
      }
    }
    // The asphalt fill takes no inflation: it has to stop at the kerb, or it
    // eats the pavement corners between the arms. Nothing is lost by that —
    // where one road's shoulder band runs on through a crossing, the crossing
    // road's own carriageway strip already covers it, being the higher layer.
    for (const [index, fill] of collectRoadJunctionFills(roadSurfaces).entries()) {
      const junctionFill = this.createRoadJunctionFill(
        `road-junction-${index}`,
        fill,
        asphalt,
        ROAD_JUNCTION_FILL_Y,
      );
      if (junctionFill) {
        this.registerStaticCell(junctionFill, fill.pivot.x, fill.pivot.z, false);
      }
    }
    // All lane paint pours into two merged meshes (one per colour) instead
    // of a box per dash — see MarkingGeometry. Chevrons, crosswalks and
    // thresholds keep their own meshes: they need per-mesh setEnabled.
    const whitePaint = createMarkingGeometry();
    const yellowPaint = createMarkingGeometry();
    for (const surface of roadSurfaces) {
      for (const marking of surface.markings) {
        const paint = marking.color === "yellow" ? yellowPaint : whitePaint;
        // Give-way bars and box junctions belong *to* a junction; everything
        // else is lane paint, which stops at one.
        const runs = LANE_PAINT_STYLES.has(marking.style)
          ? splitMarkingAtCrossings(
              marking.points,
              roadSurfaces.filter((other) => other.id !== surface.id),
            )
          : [marking.points as MarkingPoint[]];
        for (const run of runs) {
          if (
            marking.style === "centre_dashed" ||
            marking.style === "lane_dashed" ||
            marking.style === "give_way"
          ) {
            appendDashedMarkingBoxes(
              paint,
              run,
              marking.style === "give_way" ? 0.24 : 0.11,
              0.12,
              marking.style === "centre_dashed"
                ? 3.2
                : marking.style === "give_way"
                  ? 0.65
                  : 2.2,
              marking.style === "centre_dashed"
                ? 4.3
                : marking.style === "give_way"
                  ? 0.55
                  : 3.4,
            );
            continue;
          }
          appendSolidMarkingBoxes(
            paint,
            run,
            marking.style === "box_junction" ? 0.18 : 0.11,
            0.12,
          );
        }
      }
    }
    this.registerMirrorSurface(
      this.buildMergedMarkingMesh("road-markings-white", whitePaint, laneMaterial),
    );
    this.registerMirrorSurface(
      this.buildMergedMarkingMesh(
        "road-markings-yellow",
        yellowPaint,
        yellowMarkingMaterial,
      ),
    );
    for (const [routeIndex, laneId] of (this.options.lesson?.route ?? []).entries()) {
      const lane = mapPack.laneGraph.lanes.find((candidate) => candidate.id === laneId);
      if (!lane || lane.role === "connector") continue;
      this.createRouteChevrons(
        lane,
        routeMaterial,
        routeIndex,
        mapPack.laneGraph.conflictZones,
      );
    }

    const random = seededUnit(this.options.lesson?.trafficSeed ?? 47);
    const buildingPalette: Record<string, Color3> = {
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
    const facadeEmissive = makeFacadeEmissiveTexture(scene);
    const cairoRooftopMaterial =
      cairoScene
        ? makeMaterial(
            scene,
            "cairo-rooftop-tanks",
            new Color3(0.16, 0.19, 0.18),
          )
        : null;
    const cairoDishMaterial =
      cairoScene
        ? makeMaterial(
            scene,
            "cairo-rooftop-dishes",
            new Color3(0.64, 0.61, 0.54),
          )
        : null;
    // Masters for the instanced street wall's rooftop clutter. Same shapes the
    // facade boxes grow below, but built once and cloned, so ~600 tanks and
    // dishes across the map cost two draw calls rather than six hundred.
    if (cairoRooftopMaterial && cairoDishMaterial) {
      const tank = createCylinder(
        scene,
        "cairo-roof-tank-master",
        { height: 1.6, diameter: 1.7, tessellation: 10 },
        Vector3.Zero(),
        cairoRooftopMaterial,
      );
      const dish = createCylinder(
        scene,
        "cairo-roof-dish-master",
        { height: 0.22, diameterTop: 1.9, diameterBottom: 1.05, tessellation: 10 },
        Vector3.Zero(),
        cairoDishMaterial,
      );
      for (const master of [tank, dish]) {
        master.isVisible = false;
        master.isPickable = false;
      }
      this.cairoRoofClutterMasters = { tank, dish };
    }
    const cairoFacadeTrimMaterial = cairoScene
      ? makeMaterial(
          scene,
          "cairo-facade-trim",
          new Color3(0.8, 0.73, 0.61),
        )
      : null;
    const cairoBalconyRailMaterial = cairoScene
      ? makeMaterial(
          scene,
          "cairo-balcony-iron",
          new Color3(0.16, 0.15, 0.13),
        )
      : null;
    const cairoAcMaterial = cairoScene
      ? makeMaterial(
          scene,
          "cairo-air-conditioners",
          new Color3(0.68, 0.67, 0.61),
        )
      : null;
    const cairoAwningMaterials = cairoScene
      ? [
          makeMaterial(
            scene,
            "cairo-awning-red",
            new Color3(0.55, 0.18, 0.13),
          ),
          makeMaterial(
            scene,
            "cairo-awning-green",
            new Color3(0.18, 0.35, 0.25),
          ),
        ]
      : [];
    const facadeMaterials = new Map<string, StandardMaterial>();
    const facadeMaterialFor = (materialKey: string): StandardMaterial => {
      const cached = facadeMaterials.get(materialKey);
      if (cached) return cached;
      const wallColor =
        buildingPalette[materialKey] ?? new Color3(0.56, 0.5, 0.43);
      const created = makeFacadeMaterial(
        scene,
        `facade-${materialKey}`,
        wallColor,
        facadeEmissive,
      );
      facadeMaterials.set(materialKey, created);
      return created;
    };
    // The procedural windowed-facade-box grid: the classic filler, and the
    // fallback for any block whose building-set glbs never load.
    // Every keep-out has to be known before a single building is dressed.
    // The instanced street wall gets away with collecting these as it goes,
    // because it is deferred until after preload; the procedural facade grid
    // below runs inline, so a keep-out pushed later in this method would arrive
    // after the boxes it was meant to exclude were already standing.
    this.collectBuildingExclusions(mapPack);

    const placeFacadeGrid = (
      block: GameCanvasMapPack["geometry"]["blocks"][number],
      material: StandardMaterial,
    ) => {
      const isGardenCity = block.material === "cairo-garden-stucco";
      const isWestBank = block.material === "cairo-west-bank-concrete";
      const facadeCells = facadeGridCells(
        isWestBank
          ? { ...block, density: Math.min(1, block.density + 0.17) }
          : block,
      );
      const freezeDetail = (mesh: Mesh) => {
        mesh.isPickable = false;
        this.staticSceneryFreeze.push(mesh);
      };
      const placedFrontages: CairoFrontageFootprint[] = [];
      for (const cell of facadeCells) {
        if (
          !deterministicSceneryKeep(
            `${mapId}:${block.id}:facade:${cell.index}`,
            this.buildingKeepFraction,
          )
        ) {
          continue;
        }
        const width = Math.max(5, cell.cellWidth * (0.58 + random() * 0.24));
        const depth = Math.max(5, cell.cellDepth * (0.58 + random() * 0.24));
        const frontagePlacement = mapId.includes("cairo")
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
          random() * (block.heightRange[1] - block.heightRange[0]);
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
            this.buildingExclusions,
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
          scene,
          `building-${block.id}-${cell.index}`,
          { width, height, depth },
          new Vector3(buildingPosition.x, height / 2, buildingPosition.z),
          material,
        );
        facade.rotation.y = cell.rotationY;
        this.registerShadowCaster(
          facade,
          buildingPosition.x,
          buildingPosition.z,
        );
        if (
          frontagePlacement &&
          cairoFacadeTrimMaterial &&
          cairoBalconyRailMaterial &&
          cairoAcMaterial
        ) {
          const detailRoot = new TransformNode(
            `building-${block.id}-${cell.index}-street-detail`,
            scene,
          );
          detailRoot.parent = facade;
          detailRoot.rotation.y = frontagePlacement.detailYawRad;
          this.staticSceneryFreeze.push(detailRoot);
          const frontageSpan =
            frontagePlacement.edgeAxis === "x" ? depth : width;
          const frontageDepth =
            frontagePlacement.edgeAxis === "x" ? width : depth;
          if (isGardenCity) {
            freezeDetail(
              createBox(
                scene,
                `building-${block.id}-${cell.index}-cornice`,
                {
                  width: width + 0.55,
                  height: 0.48,
                  depth: depth + 0.55,
                },
                new Vector3(0, height / 2 + 0.18, 0),
                cairoFacadeTrimMaterial,
                facade,
              ),
            );
            if (cell.index % 2 === 0) {
              const balconyWidth = Math.min(5.4, frontageSpan * 0.54);
              const balconyY = Math.min(6.8, Math.max(4.3, height * 0.34));
              freezeDetail(
                createBox(
                  scene,
                  `building-${block.id}-${cell.index}-balcony`,
                  { width: balconyWidth, height: 0.22, depth: 1.15 },
                  new Vector3(
                    0,
                    balconyY - height / 2,
                    frontageDepth / 2 + 0.48,
                  ),
                  cairoFacadeTrimMaterial,
                  detailRoot,
                ),
              );
              freezeDetail(
                createBox(
                  scene,
                  `building-${block.id}-${cell.index}-balcony-rail`,
                  { width: balconyWidth, height: 0.55, depth: 0.09 },
                  new Vector3(
                    0,
                    balconyY + 0.38 - height / 2,
                    frontageDepth / 2 + 1.02,
                  ),
                  cairoBalconyRailMaterial,
                  detailRoot,
                ),
              );
            }
          } else if (cell.index % 2 === 0) {
            const acY = Math.min(height - 2.1, Math.max(5.3, height * 0.58));
            freezeDetail(
              createBox(
                scene,
                `building-${block.id}-${cell.index}-ac`,
                { width: 1.15, height: 0.72, depth: 0.38 },
                new Vector3(
                  frontageSpan * 0.24,
                  acY - height / 2,
                  frontageDepth / 2 + 0.18,
                ),
                cairoAcMaterial,
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
                scene,
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
                cairoAwningMaterials[cell.index % cairoAwningMaterials.length],
                detailRoot,
              ),
            );
          }
        }
        if (cairoRooftopMaterial && cell.index % 3 === 0) {
          const tank = createCylinder(
            scene,
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
            cairoRooftopMaterial,
          );
          this.registerShadowCaster(
            tank,
            buildingPosition.x,
            buildingPosition.z,
          );
        } else if (cairoDishMaterial && cell.index % 3 === 1) {
          const dish = createCylinder(
            scene,
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
            cairoDishMaterial,
          );
          dish.rotation.x = -0.7;
          dish.rotation.y = cell.rotationY + 0.4;
          this.registerShadowCaster(
            dish,
            buildingPosition.x,
            buildingPosition.z,
          );
        }
      }
      if (
        isGardenCity &&
        cairoFacadeTrimMaterial &&
        cairoBalconyRailMaterial
      ) {
        // Low perimeter walls, iron gates and villa cornices distinguish the
        // secured Garden City compounds from denser downtown street walls.
        const compound = new TransformNode(`${block.id}-compound`, scene);
        compound.position.set(block.center.x, 0, block.center.z);
        compound.rotation.y = degreesToRadians(block.headingDeg ?? 0);
        const inset = 2.2;
        const halfX = Math.max(5, block.size.x / 2 - inset);
        const halfZ = Math.max(5, block.size.z / 2 - inset);
        const gateHalf = 3.3;
        const wallHeight = 1.28;
        for (const side of [-1, 1]) {
          const sideWall = createBox(
            scene,
            `${block.id}-compound-side-${side}`,
            { width: 0.38, height: wallHeight, depth: halfZ * 2 },
            new Vector3(side * halfX, wallHeight / 2, 0),
            cairoFacadeTrimMaterial,
            compound,
          );
          freezeDetail(sideWall);
          for (const half of [-1, 1]) {
            const run = halfX - gateHalf;
            const frontWall = createBox(
              scene,
              `${block.id}-compound-front-${side}-${half}`,
              { width: run, height: wallHeight, depth: 0.38 },
              new Vector3(
                half * (gateHalf + run / 2),
                wallHeight / 2,
                side * halfZ,
              ),
              cairoFacadeTrimMaterial,
              compound,
            );
            freezeDetail(frontWall);
          }
          const gate = createBox(
            scene,
            `${block.id}-compound-gate-${side}`,
            { width: gateHalf * 1.65, height: 1.05, depth: 0.12 },
            new Vector3(0, 0.53, side * halfZ),
            cairoBalconyRailMaterial,
            compound,
          );
          freezeDetail(gate);
        }
        this.staticSceneryFreeze.push(compound);
      }
    };
    for (const block of mapPack.geometry.blocks) {
      const material = facadeMaterialFor(block.material);
      const isLondonMuseumBlock =
        mapId.includes("london") && block.material.endsWith("-museum");
      if (isLondonMuseumBlock) {
        const wingWidth = Math.max(12, block.size.x * 0.23);
        const wingHeight = Math.max(11, block.heightRange[0] * 0.72);
        for (const side of [-1, 1]) {
          const wingX = block.center.x + side * block.size.x * 0.37;
          this.registerShadowCaster(
            createFacadeBox(
              scene,
              `building-${block.id}-wing-${side}`,
              { width: wingWidth, height: wingHeight, depth: block.size.z * 0.82 },
              new Vector3(wingX, wingHeight / 2, block.center.z),
              material,
            ),
            wingX,
            block.center.z,
          );
        }
        continue;
      }
      // Building-set blocks are dressed with instanced glb street walls after
      // preload (buildInstancedBuildings); box grid is the offline fallback.
      if (block.buildingSet && isBuildingSetId(block.buildingSet)) {
        const setId = block.buildingSet;
        this.pendingBuildingBlocks.push({
          block,
          setId,
          buildFallback: () => placeFacadeGrid(block, facadeMaterialFor(block.material)),
        });
        continue;
      }
      placeFacadeGrid(block, material);
    }
    // Preload just this map's building-set glbs (not every map's) off the
    // critical path; buildInstancedBuildings consumes them once ready. City
    // maps (those with building sets) also get the sidewalk vendor carts.
    const setIds = [...new Set(this.pendingBuildingBlocks.map((e) => e.setId))];
    this.buildingModelUrls = [
      ...buildingSetUrls(setIds),
      ...(setIds.length ? nycVendorUrls() : []),
      // River craft ride the same preload. Gated on Cairo, not on "has water":
      // the two models are `cairo-felucca` and `cairo-skiff` and only Cairo
      // places them, so keying off water alone made Central Park's lake pull
      // ~50 KB of boats NYC can never use.
      ...(resolveMapVisualKey(mapId) === "cairo" &&
      mapPack.geometry.waterBodies?.length
        ? WATER_BOAT_MODEL_URLS
        : []),
    ];
    // This map's park planting only — see `natureCatalog`. Kept in its own
    // list so the night-glow and Cairo-decal passes above never see it.
    this.natureModelUrls = natureSetUrls(
      natureSetsForMap(resolveMapVisualKey(mapId)),
    );

    for (const service of mapPack.geometry.servicePoints ?? []) {
      const pose = resolveSimulationLaneAnchor(
        mapPack.laneGraph.lanes,
        service.anchor,
      );
      if (!pose) continue;
      // Set the forecourt back just past the shoulder so its lot no longer bleeds
      // onto the carriageway (a small grass set-back, no big apron). Per-site
      // `setbackM` tunes cramped junction corners; 16 is the default. Shared
      // with the refuel prompt, which locates the pumps from the same lot pose.
      const lot = resolveServicePointLot(mapPack.laneGraph.lanes, service);
      if (!lot) continue;
      const px = lot.x;
      const pz = lot.z;
      // The street-wall keep-out for this lot is already in place — see
      // `collectBuildingExclusions`, which has to run before anything is built.
      if (service.kind === "repair_shop") {
        // No glb to wait on, so this is built outright rather than going through
        // placeProp — a deferred prop with no model would be retried after every
        // preload forever, and never upgrade.
        this.buildRepairShop(service.id, lot, pose.heading, service.label);
        continue;
      }
      this.placeProp(service.kind, px, pz, pose.heading, service.id, (parent) => {
        const trim = makeMaterial(
          scene,
          `${service.id}-trim`,
          new Color3(0.86, 0.24, 0.18),
        );
        createBox(
          scene,
          `${service.id}-pad`,
          { width: service.footprint.x, height: 0.06, depth: service.footprint.z },
          new Vector3(px, 0.04, pz),
          makeMaterial(scene, `${service.id}-pad`, new Color3(0.2, 0.21, 0.23)),
          parent,
        );
        createBox(
          scene,
          `${service.id}-canopy`,
          { width: service.footprint.x, height: 0.35, depth: service.footprint.z },
          new Vector3(px, 3.6, pz),
          trim,
          parent,
        );
        createBox(
          scene,
          `${service.id}-pillar`,
          { width: 0.5, height: 3.6, depth: 0.5 },
          new Vector3(px, 1.8, pz),
          trim,
          parent,
        );
        createBox(
          scene,
          `${service.id}-sign`,
          { width: 1.6, height: 1.6, depth: 0.24 },
          new Vector3(px, 5.4, pz),
          makeMaterial(scene, `${service.id}-sign`, new Color3(0.96, 0.86, 0.16)),
          parent,
        );
      }, service.label);
    }

    const gigVenueColor: Record<string, Color3> = {
      restaurant: new Color3(0.85, 0.45, 0.3),
      shop: new Color3(0.4, 0.6, 0.85),
      residence: new Color3(0.7, 0.66, 0.5),
      office: new Color3(0.55, 0.58, 0.62),
      depot: new Color3(0.5, 0.5, 0.55),
    };
    for (const venue of mapPack.geometry.gigVenues ?? []) {
      // Shared with the collider builder: on paved city maps the building's
      // measured front face lines up just behind the walkable pavement (the
      // street-wall look), elsewhere the authored setback stands. Keeping the
      // one resolver on both sides is what stops the visible building and its
      // collision from ever drifting apart again.
      const placement = resolveVenuePlacement(mapPack, venue);
      if (!placement) continue;
      const pose = {
        x: placement.anchorX,
        z: placement.anchorZ,
        heading: placement.heading,
      };
      const px = placement.x;
      const pz = placement.z;
      // The keep-out that holds scenery off this venue's lot is already in
      // place — see `collectBuildingExclusions`.
      // A rider waits curbside (nearer the lane than the building) facing the road.
      this.gigVenueCurbside.set(venue.id, {
        x: pose.x + Math.cos(pose.heading) * 4.5,
        z: pose.z - Math.sin(pose.heading) * 4.5,
        facing: Math.atan2(-Math.cos(pose.heading), Math.sin(pose.heading)),
      });
      // ...and the car pulls up on the lane anchor itself, 4.5 m off the rider.
      this.gigVenueRoadStop.set(venue.id, { x: pose.x, z: pose.z });
      // The delivery errand's "front door": the measured model's road-facing
      // face centre (same holder-frame convention as the venue collider:
      // right carries model X, forward carries model Z), or the near edge of
      // the authored footprint for unmeasured venues.
      {
        const rightX = Math.cos(pose.heading);
        const rightZ = -Math.sin(pose.heading);
        const forwardX = Math.sin(pose.heading);
        const forwardZ = Math.cos(pose.heading);
        const measured = PROP_MODEL_FOOTPRINTS_M[venue.modelId ?? venue.kind];
        const doorDepth = measured
          ? measured.minX - 0.45
          : (px - pose.x) * rightX + (pz - pose.z) * rightZ -
            Math.max(venue.footprint.x, venue.footprint.z) / 2 - 0.6;
        const doorAlong = measured ? (measured.minZ + measured.maxZ) / 2 : 0;
        this.gigVenueDoors.set(venue.id, {
          x: (measured ? px : pose.x) + rightX * doorDepth + forwardX * doorAlong,
          z: (measured ? pz : pose.z) + rightZ * doorDepth + forwardZ * doorAlong,
        });
      }
      // A venue may name a specific building model; its kind still drives the
      // procedural fallback colour and everything gameplay-facing.
      const modelKey = venue.modelId ?? venue.kind;
      this.placeProp(modelKey, px, pz, pose.heading, venue.id, (parent) => {
        const height = 6;
        createBox(
          scene,
          `${venue.id}-body`,
          { width: venue.footprint.x, height, depth: venue.footprint.z },
          new Vector3(px, height / 2, pz),
          makeMaterial(
            scene,
            `${venue.id}-body`,
            gigVenueColor[venue.kind] ?? new Color3(0.6, 0.6, 0.62),
          ),
          parent,
        );
        // Bright rooftop marker so venues read on approach.
        createBox(
          scene,
          `${venue.id}-roof`,
          {
            width: venue.footprint.x * 0.5,
            height: 0.6,
            depth: venue.footprint.z * 0.5,
          },
          new Vector3(px, height + 0.3, pz),
          makeMaterial(scene, `${venue.id}-roof`, new Color3(0.95, 0.82, 0.3)),
          parent,
        );
      }, venue.name);
    }

    // Generated street addresses are drop-off points, not buildings — they get a
    // kerb spot so a rider can wait and the gig marker has somewhere to stand,
    // and deliberately NO buildingExclusions entry. Punching a keep-out circle
    // per address would erase most of the block street wall, and the whole point
    // of an address is that the buildings already there are the destination.
    for (const address of streetAddressesForMap(mapPack)) {
      this.gigVenueCurbside.set(address.id, {
        x: address.kerbX,
        z: address.kerbZ,
        facing: address.facing,
      });
      // The lane point the address was derived from — the car's pull-up spot,
      // off the kerb where a picked-up rider stands.
      this.gigVenueRoadStop.set(address.id, { x: address.x, z: address.z });
      // The address's "front door" is its building line: the kerb spot pushed
      // across the pavement, away from the road (facing looks back across the
      // carriageway).
      this.gigVenueDoors.set(address.id, {
        x: address.kerbX - Math.sin(address.facing) * STREET_DOOR_INSET_M,
        z: address.kerbZ - Math.cos(address.facing) * STREET_DOOR_INSET_M,
      });
    }

    for (const landmark of mapPack.geometry.landmarks) {
      const color = colorFromHex(landmark.color, new Color3(0.35, 0.5, 0.4));
      const material = makeMaterial(scene, `landmark-${landmark.id}`, color);
      if (mapId.includes("london") && this.buildLondonLandmark(landmark, material)) {
        continue;
      }
      if (
        resolveMapVisualKey(mapId) === "cairo" &&
        this.buildCairoLandmark(landmark, material, mapPack)
      ) {
        continue;
      }
      if (mapId.includes("orientation") && landmark.id === "yard-cones") {
        for (let index = 0; index < 9; index += 1) {
          const column = index % 3;
          const row = Math.floor(index / 3);
          createCylinder(
            scene,
            `${landmark.id}-${index}`,
            { height: 0.9, diameterTop: 0.08, diameterBottom: 0.58, tessellation: 8 },
            new Vector3(
              landmark.center.x - 3 + column * 3,
              0.48,
              landmark.center.z - 2.5 + row * 2.5,
            ),
            material,
          );
        }
      } else if (landmark.kind === "park") {
        // The centre "feature" cone is gone. It was the whole of a park's
        // contents, and the thing issue #206 is a screenshot of; a park is now
        // dressed by `parkLayouts` and bounded by its own wall.
        if (ROAD_DIVIDED_PARK_IDS.has(landmark.id)) {
          // A road is authored through this rect; the raw rectangle would
          // surface as grass on the far kerbside.
          this.buildParkLawnPolygon(
            landmark.id,
            roadSideParkLawnPolygon(
              landmark,
              mapPack.geometry.roadSurfaces ?? [],
            ),
            palette,
            mapId,
          );
        } else {
          this.buildParkLawn(landmark, palette, mapId);
        }
        this.buildParkFeatures(landmark, mapPack, palette, mapId);
      } else if (landmark.kind === "railway") {
        for (const offset of [-1.25, 1.25]) {
          createBox(
            scene,
            `${landmark.id}-rail-${offset}`,
            { width: landmark.size.x, height: 0.14, depth: 0.2 },
            new Vector3(landmark.center.x, 0.16, landmark.center.z + offset),
            material,
          );
        }
      } else if (landmark.kind === "tower") {
        createCylinder(
          scene,
          landmark.id,
          { height: Math.max(12, landmark.size.z), diameter: Math.max(4, landmark.size.x * 0.4) },
          new Vector3(landmark.center.x, Math.max(12, landmark.size.z) / 2, landmark.center.z),
          material,
        );
      } else {
        // Station / terminal / other building-like landmarks: give them the
        // same windowed facade as regular buildings, in their landmark colour,
        // so they read as buildings rather than featureless blocks beside the
        // now-windowed skyline.
        const height = landmark.kind === "terminal" ? 8 : 5;
        createFacadeBox(
          scene,
          landmark.id,
          { width: landmark.size.x, height, depth: landmark.size.z },
          new Vector3(landmark.center.x, height / 2, landmark.center.z),
          makeFacadeMaterial(scene, `landmark-facade-${landmark.id}`, color, facadeEmissive),
        );
      }
    }

    if (mapId.includes("london")) {
      this.buildLondonStreetFurniture();
    }

    const redLamp = makeMaterial(scene, "scenario-signal-red", new Color3(0.45, 0.02, 0.01));
    const amberLamp = makeMaterial(scene, "scenario-signal-amber", new Color3(0.55, 0.27, 0.015));
    const greenLamp = makeMaterial(scene, "scenario-signal-green", new Color3(0.02, 0.4, 0.12));
    const paleFixture = makeMaterial(scene, "scenario-control-pale", new Color3(0.9, 0.9, 0.82));
    const warningYellow = makeMaterial(scene, "scenario-control-warning", new Color3(0.94, 0.68, 0.08));
    const restrictedBlue = makeMaterial(scene, "scenario-control-restricted", new Color3(0.08, 0.31, 0.56));
    const controlMaterials: TrafficControlMaterials = {
      dark,
      pale: paleFixture,
      redLamp,
      amberLamp,
      greenLamp,
      stopRed,
      yieldGold,
      warningYellow,
      restrictedBlue,
    };
    this.signalRedMaterial = redLamp;
    this.signalAmberMaterial = amberLamp;
    this.signalGreenMaterial = greenLamp;
    const cameraControlIds = trafficCameraControlIds(
      mapPack.laneGraph.controls
        .filter((control) => control.type === "signal")
        .map((control) => control.id),
    );
    for (const control of mapPack.laneGraph.controls) {
      const cameraHeadIds = cameraControlIds.has(control.id)
        ? trafficCameraHeadIds(control)
        : null;
      if (cameraControlIds.has(control.id)) {
        this.trafficCameraPoints.push(control.position);
        // The adapter names each light after its approach — `light.id` and
        // `stopLine.trafficLightId` are both `approach.id` — so this is the
        // same key the red-light evidence arrives under.
        for (const approach of control.approaches ?? []) {
          this.trafficCameraControlIdByLightId.set(approach.id, control.id);
        }
      }
      const logicalHeading = degreesToRadians(control.headingDeg);
      const offset = mapPack.geometry.roadWidth / 2 + 1.25;
      const inferredPosition = {
        x: control.position.x + Math.cos(logicalHeading) * offset,
        z: control.position.z - Math.sin(logicalHeading) * offset,
      };
      const installations = control.installations?.length
        ? control.installations
        : [{
            id: `${control.id}-legacy-safe`,
            position:
              control.type === "crosswalk" || control.type === "box_junction"
                ? control.position
                : inferredPosition,
            headingDeg: control.headingDeg,
            mounting:
              control.type === "crosswalk" || control.type === "box_junction"
                ? "road_marking" as const
                : control.type === "railway_signal"
                  ? "railway_crossing" as const
                  : "roadside_pole" as const,
            style:
              control.type === "signal"
                ? (resolveMapVisualKey(mapId) === "london"
                    ? "uk_signal" as const
                    : resolveMapVisualKey(mapId) === "cairo"
                      ? "egypt_signal" as const
                      : "nyc_signal" as const)
                : control.type === "railway_signal"
                  ? "japan_railway" as const
                  : control.type === "crosswalk"
                    ? "crosswalk" as const
                    : control.type === "box_junction"
                      ? "box_junction" as const
                      : control.type === "restricted_lane"
                        ? "restricted_lane" as const
                        : control.type === "side_swap_gate"
                          ? "side_swap_gate" as const
                          : control.type === "yield"
                            ? "yield_sign" as const
                            : "stop_sign" as const,
            role: "primary" as const,
            approachIds: (control.approaches ?? []).map((approach) => approach.id),
          }];
      const phaseGroups = [
        ...new Set((control.approaches ?? []).map((approach) => approach.phaseGroup)),
      ];
      for (const installation of installations) {
        if (
          installation.style === "nyc_signal" ||
          installation.style === "uk_signal" ||
          installation.style === "egypt_signal"
        ) {
          const installationApproaches = (installation.approachIds ?? [])
            .map((approachId) =>
              (control.approaches ?? []).find((approach) => approach.id === approachId),
            )
            .filter((approach): approach is NonNullable<typeof approach> => Boolean(approach));
          this.buildSignalInstallation(
            control.id,
            installation,
            mapPack.geometry.roadWidth,
            controlMaterials,
            {
              trafficLightIds: installationApproaches.length
                ? installationApproaches.map((approach) => approach.id)
                : (control.approaches ?? []).map((approach) => approach.id),
              phaseGroup: installationApproaches[0]?.phaseGroup ?? phaseGroups[0] ?? control.id,
              phaseGroups: phaseGroups.length ? phaseGroups : [control.id],
              style: installation.style,
            },
            // One per approach the junction enforces, so no arm is booked by a
            // camera the driver never had a chance to see.
            cameraHeadIds?.has(installation.id) ?? false,
          );
          continue;
        }
        if (installation.style === "japan_railway") {
          this.buildRailwayCrossingInstallation(
            control.id,
            installation,
            controlMaterials,
            installation.approachIds?.length
              ? installation.approachIds
              : (control.approaches ?? []).map((approach) => approach.id),
          );
          continue;
        }
        if (installation.mounting === "road_marking") {
          this.buildRoadMarkingInstallation(
            mapPack,
            control,
            installation,
            laneMaterial,
            warningYellow,
          );
          continue;
        }
        if (installation.style === "side_swap_gate") {
          this.buildTerminalPortal(
            control.id,
            installation,
            mapPack.geometry.roadWidth,
            controlMaterials,
          );
          continue;
        }
        const pole = createCylinder(
          scene,
          `${control.id}-${installation.id}-pole`,
          { height: 3.1, diameter: 0.17, tessellation: 14 },
          new Vector3(installation.position.x, 1.55, installation.position.z),
          dark,
        );
        pole.rotation.y = degreesToRadians(installation.headingDeg);
        const isYield = installation.style === "yield_sign";
        const sign = createCylinder(
          scene,
          `${control.id}-${installation.id}-sign`,
          { height: 0.13, diameter: 0.92, tessellation: isYield ? 3 : 8 },
          new Vector3(0, 1.2, 0),
          installation.style === "restricted_lane"
            ? restrictedBlue
            : isYield
              ? yieldGold
              : stopRed,
          pole,
        );
        sign.rotation.x = Math.PI / 2;
      }
      for (const approach of control.approaches ?? []) {
        const stop = resolveLaneAnchor(mapPack.laneGraph.lanes, approach.stopLine);
        const lane = mapPack.laneGraph.lanes.find(
          (candidate) => candidate.id === approach.stopLine.laneId,
        );
        if (!stop || !lane) continue;
        const stopSurface = mapPack.geometry.roadSurfaces?.find((candidate) =>
          candidate.laneIds.includes(lane.id),
        );
        const bar = signalStopBarSegment(stop, lane, stopSurface);
        this.createFlatSegment(
          `${control.id}-${approach.id}-stop-line`,
          bar.start,
          bar.end,
          0.28,
          0.147,
          laneMaterial,
        );
      }
    }

    // Both sign families derive from the lane graph, so signage can never
    // disagree with the rules the simulation enforces. One-way signage is US
    // MUTCD and stays NYC-only (and resolveMapVisualKey falls back to "nyc"
    // for unknown ids, so gate on the pack id); every city posts its speed
    // limits, in its own country's design.
    const signInput = {
      lanes: mapPack.laneGraph.lanes,
      roadSurfaces: mapPack.geometry.roadSurfaces,
      defaultRoadWidthM: mapPack.geometry.roadWidth,
      // Every authored pole, so a derived post slides clear of one rather than
      // standing bolted to it. Road markings carry no post, so they are not
      // ground a sign has to avoid.
      occupiedPositions: mapPack.laneGraph.controls.flatMap((control) =>
        (control.installations ?? [])
          .filter((installation) => installation.mounting !== "road_marking")
          .map((installation) => installation.position),
      ),
    };
    const regulatorySigns =
      mapPack.id === "nyc-upper-west-side"
        ? regulatorySignPlacements(signInput)
        : [];
    const speedLimitSigns = speedLimitSignPlacements(signInput);
    if (regulatorySigns.length) this.buildRegulatorySigns(regulatorySigns);
    if (speedLimitSigns.length) {
      this.buildSpeedLimitSigns(speedLimitSigns, mapPack.countryIds?.[0] ?? "us");
    }
    this.buildRoadsideProps(mapPack, palette, mapId, roadSurfaces, [
      ...regulatorySigns,
      ...speedLimitSigns,
    ]);

    for (const checkpoint of this.authoredCheckpoints) {
      this.checkpointVisuals.push(
        this.createCheckpointTarget(checkpoint, checkpointMaterial),
      );
    }
    this.finishVisual = this.createFinishBeacon(mapPack);
    this.updateGuidanceVisuals();
  }

  /**
   * Original low-poly silhouettes for central Cairo's navigation anchors.
   * These are impressionistic procedural forms, not imported replicas.
   */
  private buildCairoLandmark(
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    material: StandardMaterial,
    mapPack: GameCanvasMapPack,
  ): boolean {
    const scene = this.scene;
    const paleStone = makeMaterial(
      scene,
      `${landmark.id}-pale-stone`,
      new Color3(0.78, 0.7, 0.56),
    );
    const darkWindow = makeMaterial(
      scene,
      `${landmark.id}-window`,
      new Color3(0.1, 0.19, 0.21),
    );
    const bronze = makeMaterial(
      scene,
      `${landmark.id}-bronze`,
      new Color3(0.36, 0.25, 0.14),
    );

    if (landmark.id === "cairo-tahrir-square") {
      const paving = makeMaterial(
        scene,
        `${landmark.id}-paving`,
        new Color3(0.63, 0.57, 0.47),
      );
      const oliveLeaf = makeMaterial(
        scene,
        `${landmark.id}-olive-leaf`,
        new Color3(0.3, 0.4, 0.24),
      );
      // Tahrir's garden is the same grass as every other park's — it just has a
      // paved plaza laid over its middle. It intercepts the generic park branch
      // for its furniture, so without this it would keep the flat untextured
      // slab the rest of the map's greenery has now left behind. The lawn is
      // the clipped polygon, not the authored rectangle: Ramses runs through
      // the rectangle, and the raw rect surfaced as grass past the far kerb.
      this.buildParkLawnPolygon(
        landmark.id,
        cairoTahrirLawnPolygon(landmark, mapPack.geometry.roadSurfaces ?? []),
        this.visualPalette,
        mapPack.id.toLowerCase(),
      );
      // The obelisk landmark's centre IS the plaza centre — disc, benches
      // and olives all ring it, so re-authoring the landmark moves the whole
      // ensemble together.
      const plazaCenter =
        mapPack.geometry.landmarks.find(
          (candidate) => candidate.id === "cairo-tahrir-obelisk",
        )?.center ?? landmark.center;
      // Top face lands exactly on PARK_PATH_Y, inside the park's 0.02–0.0435
      // band like every other in-park paving. The previous disc topped out at
      // 0.0725 — above the road surface itself — so wherever it overhung a
      // road it drew ON TOP of the asphalt.
      createCylinder(
        scene,
        `${landmark.id}-central-plaza`,
        {
          height: 0.022,
          diameter: CAIRO_TAHRIR_PLAZA_RADIUS_M * 2,
          tessellation: 32,
        },
        new Vector3(plazaCenter.x, PARK_PATH_Y - 0.011, plazaCenter.z),
        paving,
      ).isPickable = false;
      const furniture = cairoTahrirFurnitureLayout(
        plazaCenter,
        mapPack.geometry.roadSurfaces ?? [],
      );
      for (const [index, position] of furniture.olives.entries()) {
        const trunk = createCylinder(
          scene,
          `${landmark.id}-olive-${index}-trunk`,
          {
            height: 2.2,
            diameterTop: 0.24,
            diameterBottom: 0.36,
            tessellation: 7,
          },
          new Vector3(position.x, 1.1, position.z),
          bronze,
        );
        trunk.isPickable = false;
        const crown = createIcoSphere(
          scene,
          `${landmark.id}-olive-${index}-crown`,
          1.45,
          new Vector3(position.x, 2.75, position.z),
          oliveLeaf,
        );
        crown.scaling.set(1.25, 0.72, 1);
        crown.isPickable = false;
      }
      for (const [index, position] of furniture.benches.entries()) {
        const bench = new TransformNode(`${landmark.id}-bench-${index}`, scene);
        bench.position.set(position.x, 0, position.z);
        bench.rotation.y = position.rotationY;
        createBox(
          scene,
          `${landmark.id}-bench-${index}-seat`,
          { width: 2.5, height: 0.18, depth: 0.52 },
          new Vector3(0, 0.58, 0),
          bronze,
          bench,
        ).isPickable = false;
        createBox(
          scene,
          `${landmark.id}-bench-${index}-back`,
          { width: 2.5, height: 0.62, depth: 0.14 },
          new Vector3(0, 0.9, 0.24),
          bronze,
          bench,
        ).isPickable = false;
      }
      return true;
    }

    if (landmark.id === "cairo-tower") {
      const height = 44;
      createCylinder(
        scene,
        `${landmark.id}-core`,
        {
          height: height - 8,
          diameterTop: 3.2,
          diameterBottom: 5.2,
          tessellation: 12,
        },
        new Vector3(landmark.center.x, (height - 8) / 2, landmark.center.z),
        paleStone,
      );
      // Slender ribs and horizontal collars suggest the tower's open lotus
      // lattice while staying within the game's bold low-poly language.
      for (let rib = 0; rib < 8; rib += 1) {
        const angle = (rib / 8) * Math.PI * 2;
        createCylinder(
          scene,
          `${landmark.id}-rib-${rib}`,
          {
            height: height - 9,
            diameterTop: 0.28,
            diameterBottom: 0.42,
            tessellation: 6,
          },
          new Vector3(
            landmark.center.x + Math.sin(angle) * 2.15,
            (height - 9) / 2,
            landmark.center.z + Math.cos(angle) * 2.15,
          ),
          material,
        );
      }
      for (const y of [8, 15, 22, 29]) {
        createCylinder(
          scene,
          `${landmark.id}-collar-${y}`,
          { height: 0.34, diameter: 5.1, tessellation: 12 },
          new Vector3(landmark.center.x, y, landmark.center.z),
          material,
        );
      }
      createCylinder(
        scene,
        `${landmark.id}-pod`,
        {
          height: 4.2,
          diameterTop: 8.1,
          diameterBottom: 6.1,
          tessellation: 16,
        },
        new Vector3(landmark.center.x, height - 6.2, landmark.center.z),
        darkWindow,
      );
      createCylinder(
        scene,
        `${landmark.id}-crown`,
        {
          height: 2.4,
          diameterTop: 5.2,
          diameterBottom: 8.2,
          tessellation: 16,
        },
        new Vector3(landmark.center.x, height - 2.9, landmark.center.z),
        paleStone,
      );
      createCylinder(
        scene,
        `${landmark.id}-antenna`,
        { height: 8, diameterTop: 0.1, diameterBottom: 0.38, tessellation: 8 },
        new Vector3(landmark.center.x, height + 2.2, landmark.center.z),
        bronze,
      );
      return true;
    }

    if (landmark.id === "cairo-egyptian-museum") {
      const height = 10;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height, depth: landmark.size.z },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-central-pavilion`,
        {
          width: Math.max(10, landmark.size.x * 0.27),
          height: height + 3,
          depth: landmark.size.z + 1.1,
        },
        new Vector3(landmark.center.x, (height + 3) / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-cornice`,
        {
          width: landmark.size.x + 1.2,
          height: 0.75,
          depth: landmark.size.z + 1.2,
        },
        new Vector3(landmark.center.x, height + 0.15, landmark.center.z),
        paleStone,
      );
      const facadeZ = landmark.center.z - landmark.size.z / 2 - 0.11;
      for (let bay = -4; bay <= 4; bay += 1) {
        if (bay === 0) continue;
        createBox(
          scene,
          `${landmark.id}-window-${bay}`,
          { width: 2.1, height: 3, depth: 0.18 },
          new Vector3(
            landmark.center.x + bay * (landmark.size.x / 10),
            5.8,
            facadeZ,
          ),
          darkWindow,
        );
      }
      createBox(
        scene,
        `${landmark.id}-entrance`,
        { width: 4.5, height: 5.5, depth: 0.28 },
        new Vector3(landmark.center.x, 3.2, facadeZ - 0.1),
        darkWindow,
      );
      return true;
    }

    // The Mogamma-inspired government slab that closes Tahrir's northern
    // horizon (the landmark comment in cairoContent.ts has the urban story).
    // Same cost class and idiom as the Egyptian Museum branch: boxes, one
    // cylinder run for the colonnade, no shadow casters. Every dimension
    // derives from the landmark so re-authoring its rect reshapes the
    // building instead of stranding it.
    if (landmark.id === "cairo-tahrir-ministries") {
      const centralWidth = landmark.size.x * 0.5;
      const wingWidth = landmark.size.x * 0.25;
      const centralHeight = 30;
      const wingHeight = 22;
      const southFaceZ = landmark.center.z - landmark.size.z / 2;
      const forecourtPaving = makeMaterial(
        scene,
        `${landmark.id}-forecourt-paving`,
        new Color3(0.63, 0.57, 0.47),
      );
      createBox(
        scene,
        landmark.id,
        {
          width: centralWidth,
          height: centralHeight,
          depth: landmark.size.z,
        },
        new Vector3(landmark.center.x, centralHeight / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-cornice`,
        { width: centralWidth + 1.2, height: 0.75, depth: landmark.size.z + 1.2 },
        new Vector3(landmark.center.x, centralHeight + 0.15, landmark.center.z),
        paleStone,
      );
      for (const side of [-1, 1] as const) {
        const wingX =
          landmark.center.x + side * (landmark.size.x / 2 - wingWidth / 2);
        // Wing faces sit 3 m behind the central face and 8 m lower — the
        // staggered silhouette keeps a 44 m slab from reading as one box.
        createBox(
          scene,
          `${landmark.id}-wing-${side}`,
          {
            width: wingWidth,
            height: wingHeight,
            depth: landmark.size.z - 4,
          },
          new Vector3(wingX, wingHeight / 2, landmark.center.z + 1),
          material,
        );
        createBox(
          scene,
          `${landmark.id}-wing-cornice-${side}`,
          {
            width: wingWidth + 1.2,
            height: 0.75,
            depth: landmark.size.z - 4 + 1.2,
          },
          new Vector3(wingX, wingHeight + 0.15, landmark.center.z + 1),
          paleStone,
        );
        // Two tiers of two bays per wing.
        for (const tier of [10, 16]) {
          for (const bay of [-1, 1] as const) {
            createBox(
              scene,
              `${landmark.id}-wing-window-${side}-${tier}-${bay}`,
              { width: 2.1, height: 3, depth: 0.18 },
              new Vector3(
                wingX + bay * 2.75,
                tier,
                landmark.center.z + 1 - (landmark.size.z - 4) / 2 - 0.11,
              ),
              darkWindow,
            );
          }
        }
      }
      // Four tiers of five bays on the central mass's park-facing face.
      for (const [tierIndex, tier] of [12, 16.5, 21, 25.5].entries()) {
        for (let bay = -2; bay <= 2; bay += 1) {
          if (bay === 0 && tierIndex === 0) continue; // the entrance's bay
          createBox(
            scene,
            `${landmark.id}-window-${tierIndex}-${bay}`,
            { width: 2.1, height: 3, depth: 0.18 },
            new Vector3(
              landmark.center.x + bay * (centralWidth / 5.5),
              tier,
              southFaceZ - 0.11,
            ),
            darkWindow,
          );
        }
      }
      // Portico: nine columns, an entablature, the recessed entrance.
      const porticoZ = southFaceZ - 1.1;
      for (let column = -4; column <= 4; column += 1) {
        createCylinder(
          scene,
          `${landmark.id}-column-${column}`,
          { height: 8, diameter: 0.9, tessellation: 8 },
          new Vector3(
            landmark.center.x + column * (centralWidth / 8.8),
            4,
            porticoZ,
          ),
          paleStone,
        );
      }
      createBox(
        scene,
        `${landmark.id}-entablature`,
        { width: centralWidth - 0.5, height: 1.1, depth: 1.6 },
        new Vector3(landmark.center.x, 8.55, porticoZ),
        paleStone,
      );
      createBox(
        scene,
        `${landmark.id}-entrance`,
        { width: 6, height: 7, depth: 0.28 },
        new Vector3(landmark.center.x, 3.5, southFaceZ - 0.11),
        darkWindow,
      );
      for (const side of [-1, 1] as const) {
        createBox(
          scene,
          `${landmark.id}-door-${side}`,
          { width: 1.4, height: 3.6, depth: 0.32 },
          new Vector3(landmark.center.x + side * 1.4, 1.8, southFaceZ - 0.15),
          bronze,
        );
      }
      // The esplanade between the lawn and the frontage — the whole pocket,
      // not a slab-front apron; `cairoTahrirForecourtPolygon` explains where
      // each edge lands. Drive-over like the plaza disc: its top sits at
      // PARK_PATH_Y, below the tyre plane.
      const park = mapPack.geometry.landmarks.find(
        (candidate) => candidate.id === "cairo-tahrir-square",
      );
      this.buildFlatPolygonMesh(
        `${landmark.id}-forecourt`,
        cairoTahrirForecourtPolygon(
          landmark,
          park ? park.center.z + park.size.z / 2 : southFaceZ - 13.5,
          mapPack.geometry.roadSurfaces ?? [],
        ),
        PARK_PATH_Y,
        forecourtPaving,
      );
      return true;
    }

    if (landmark.id === "cairo-tahrir-obelisk") {
      createBox(
        scene,
        `${landmark.id}-plinth`,
        { width: 7, height: 1.1, depth: 7 },
        new Vector3(landmark.center.x, 0.55, landmark.center.z),
        paleStone,
      );
      createBox(
        scene,
        `${landmark.id}-base`,
        { width: 3, height: 2.2, depth: 3 },
        new Vector3(landmark.center.x, 2.15, landmark.center.z),
        material,
      );
      createCylinder(
        scene,
        `${landmark.id}-shaft`,
        {
          height: 13,
          diameterTop: 0.65,
          diameterBottom: 1.8,
          tessellation: 4,
        },
        new Vector3(landmark.center.x, 9.7, landmark.center.z),
        material,
      );
      for (const [index, offset] of [
        [-2.3, -2.3],
        [2.3, -2.3],
        [-2.3, 2.3],
        [2.3, 2.3],
      ].entries()) {
        createBox(
          scene,
          `${landmark.id}-ram-${index}`,
          { width: 1.05, height: 0.75, depth: 1.7 },
          new Vector3(
            landmark.center.x + offset[0],
            1.35,
            landmark.center.z + offset[1],
          ),
          bronze,
        );
        createCylinder(
          scene,
          `${landmark.id}-ram-head-${index}`,
          { height: 0.8, diameter: 0.72, tessellation: 8 },
          new Vector3(
            landmark.center.x + offset[0],
            1.85,
            landmark.center.z + offset[1] - 0.65,
          ),
          bronze,
        );
      }
      return true;
    }

    if (landmark.id === "cairo-opera-house") {
      // The public face is the NORTH one, onto the Opera Grounds' formal
      // garden — the walk axis arrives centred on it. It is also the face
      // the sun never reaches (+z normals are unlit under this map's sun),
      // which is why the old plain box read as a black monolith looming
      // over the park: articulation alone cannot rescue an unlit face, so
      // the stone gets a small emissive lift too. Both materials here are
      // per-landmark (`${landmark.id}-…`), so the lift cannot leak to
      // another building.
      paleStone.emissiveColor = new Color3(0.055, 0.05, 0.04);
      material.emissiveColor = new Color3(0.05, 0.047, 0.04);
      const centerX = landmark.center.x;
      const northFaceZ = landmark.center.z + landmark.size.z / 2;
      // Main hall in front, taller stage house behind — the fly-tower step
      // every opera house silhouette carries.
      const hallDepth = landmark.size.z - 14;
      const hallCenterZ = northFaceZ - hallDepth / 2;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height: 9, depth: hallDepth },
        new Vector3(centerX, 4.5, hallCenterZ),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-cornice`,
        { width: landmark.size.x + 1.2, height: 0.75, depth: hallDepth + 1.2 },
        new Vector3(centerX, 9.15, hallCenterZ),
        paleStone,
      );
      const stageCenterZ = northFaceZ - hallDepth - 7;
      createBox(
        scene,
        `${landmark.id}-stage-house`,
        { width: landmark.size.x - 6, height: 13, depth: 14 },
        new Vector3(centerX, 6.5, stageCenterZ),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-stage-cornice`,
        { width: landmark.size.x - 6 + 1.2, height: 0.75, depth: 15.2 },
        new Vector3(centerX, 13.15, stageCenterZ),
        paleStone,
      );
      // A set-back attic carrying the low faceted dome the real Cairo Opera
      // House wears; the icosphere's lower half is buried in the attic.
      createBox(
        scene,
        `${landmark.id}-attic`,
        { width: 22.4, height: 4, depth: 30 },
        new Vector3(centerX, 11, northFaceZ - 20),
        material,
      );
      const dome = createIcoSphere(
        scene,
        `${landmark.id}-dome`,
        8,
        new Vector3(centerX, 13, northFaceZ - 20),
        paleStone,
      );
      dome.scaling.set(1, 0.45, 1);
      // Garden colonnade: nine columns an arm's reach proud of the face,
      // side-lit even when the wall behind them is not.
      const colonnadeZ = northFaceZ + 1.1;
      for (let column = -4; column <= 4; column += 1) {
        createCylinder(
          scene,
          `${landmark.id}-column-${column}`,
          { height: 7, diameter: 0.85, tessellation: 8 },
          new Vector3(
            centerX + column * (landmark.size.x / 8.8),
            3.5,
            colonnadeZ,
          ),
          paleStone,
        );
      }
      createBox(
        scene,
        `${landmark.id}-entablature`,
        { width: landmark.size.x - 1.5, height: 1.2, depth: 1.6 },
        new Vector3(centerX, 7.6, colonnadeZ),
        paleStone,
      );
      // Ground-tier bays between the columns, the attic's window row above,
      // and the recessed entrance with its bronze doors on the axis.
      for (let bay = -4; bay <= 3; bay += 1) {
        if (bay === -1 || bay === 0) continue; // the entrance's span
        createBox(
          scene,
          `${landmark.id}-bay-${bay}`,
          { width: 2.2, height: 3.4, depth: 0.18 },
          new Vector3(
            centerX + (bay + 0.5) * (landmark.size.x / 8.8),
            4.2,
            northFaceZ + 0.11,
          ),
          darkWindow,
        );
      }
      for (let window = -2; window <= 2; window += 1) {
        createBox(
          scene,
          `${landmark.id}-attic-window-${window}`,
          { width: 2.1, height: 2.6, depth: 0.18 },
          new Vector3(centerX + window * 4, 10.8, northFaceZ - 5 + 0.11),
          darkWindow,
        );
      }
      createBox(
        scene,
        `${landmark.id}-entrance`,
        { width: 6, height: 6.4, depth: 0.28 },
        new Vector3(centerX, 3.2, northFaceZ + 0.11),
        darkWindow,
      );
      for (const side of [-1, 1] as const) {
        createBox(
          scene,
          `${landmark.id}-door-${side}`,
          { width: 1.4, height: 3.6, depth: 0.32 },
          new Vector3(centerX + side * 1.4, 1.8, northFaceZ + 0.15),
          bronze,
        );
      }
      // The terrace between the facade and the garden. The building's north
      // 12 m stand INSIDE the park rect, so without this the colonnade met
      // raw lawn; the paving runs from under the building face out past the
      // rect line to meet the axis walk, whose half-metre lap draws over it.
      const terracePaving = makeMaterial(
        scene,
        `${landmark.id}-terrace-paving`,
        new Color3(0.63, 0.57, 0.47),
      );
      this.buildFlatPolygonMesh(
        `${landmark.id}-terrace`,
        cairoOperaTerracePolygon(landmark, mapPack.geometry.roadSurfaces ?? []),
        PARK_PATH_Y,
        terracePaving,
      );
      return true;
    }

    if (
      landmark.id === "cairo-sixth-october-bridge" ||
      landmark.id === "cairo-sixth-october-west-ramp-stub" ||
      landmark.id === "cairo-sixth-october-east-ramp-stub"
    ) {
      const axis = cairoBridgeVisualAxis(
        landmark,
        mapPack.geometry.roadSurfaces ?? [],
      );
      const length = axis.lengthM;
      const width = axis.widthM;
      const deckY = CAIRO_ELEVATED_DECK_Y;
      const root = new TransformNode(`${landmark.id}-axis`, scene);
      root.position.set(axis.center.x, 0, axis.center.z);
      root.rotation.y = axis.boxYawRad;
      this.staticSceneryFreeze.push(root);
      const concrete = makeMaterial(
        scene,
        `${landmark.id}-concrete`,
        new Color3(0.52, 0.5, 0.44),
      );
      const expressway = makeMaterial(
        scene,
        `${landmark.id}-asphalt`,
        new Color3(0.19, 0.2, 0.2),
      );
      const lanePaint = makeMaterial(
        scene,
        `${landmark.id}-lane-paint`,
        new Color3(0.82, 0.76, 0.58),
      );
      const rampStub = landmark.id.endsWith("-ramp-stub");
      if (rampStub) {
        const highEnd = landmark.id.includes("-west-") ? 1 : -1;
        const rise = deckY - 0.42;
        const slopeLength = Math.hypot(length, rise);
        const ramp = createBox(
          scene,
          `${landmark.id}-boundary-ramp`,
          { width: slopeLength, height: 0.72, depth: width },
          new Vector3(0, (deckY + 0.42) / 2, 0),
          expressway,
          root,
        );
        ramp.rotation.z = highEnd * Math.atan2(rise, length);
        ramp.isPickable = false;
        this.staticSceneryFreeze.push(ramp);
        for (const side of [-1, 1]) {
          const barrier = createBox(
            scene,
            `${landmark.id}-barrier-${side}`,
            { width: slopeLength, height: 0.54, depth: 0.2 },
            new Vector3(0, 0.56, side * (width / 2 - 0.18)),
            concrete,
            ramp,
          );
          barrier.isPickable = false;
          this.staticSceneryFreeze.push(barrier);
        }
        concrete.freeze();
        expressway.freeze();
        lanePaint.freeze();
        return true;
      }

      const deck = createBox(
        scene,
        `${landmark.id}-raised-deck`,
        { width: length, height: CAIRO_ELEVATED_DECK_THICKNESS_M, depth: width },
        new Vector3(0, deckY, 0),
        expressway,
        root,
      );
      deck.isPickable = false;
      this.staticSceneryFreeze.push(deck);

      // Paired hammerhead piers make the expressway read as a continuous
      // elevated structure over both Nile channels and the urban fabric.
      const pierMaster = MeshBuilder.CreateCylinder(
        `${landmark.id}-pier-master`,
        {
          height: deckY - 0.45,
          diameterTop: 1.25,
          diameterBottom: CAIRO_ELEVATED_PIER_RADIUS_M * 2,
          tessellation: 8,
        },
        scene,
      );
      setMeshMaterial(pierMaster, concrete);
      pierMaster.isVisible = false;
      const capMaster = MeshBuilder.CreateBox(
        `${landmark.id}-pier-cap-master`,
        { width: 1.25, height: 0.55, depth: width * 0.82 },
        scene,
      );
      setMeshMaterial(capMaster, concrete);
      capMaster.isVisible = false;
      for (const pier of cairoElevatedBridgePierPlacements(
        axis,
        mapPack.geometry.roadSurfaces ?? [],
      )) {
        const column = pierMaster.createInstance(
          `${landmark.id}-pier-${pier.index}`,
        );
        column.parent = root;
        column.position.set(pier.alongM, (deckY - 0.45) / 2, 0);
        column.isPickable = false;
        this.staticSceneryFreeze.push(column);
        const cap = capMaster.createInstance(
          `${landmark.id}-pier-cap-${pier.index}`,
        );
        cap.parent = root;
        cap.position.set(pier.alongM, deckY - 0.55, 0);
        cap.isPickable = false;
        this.staticSceneryFreeze.push(cap);
      }

      for (const side of [-1, 1]) {
        const barrier = createBox(
          scene,
          `${landmark.id}-barrier-${side}`,
          { width: length, height: 0.72, depth: 0.22 },
          new Vector3(0, deckY + 0.62, side * (width / 2 - 0.2)),
          concrete,
          root,
        );
        barrier.isPickable = false;
        this.staticSceneryFreeze.push(barrier);
      }
      const dashCount = Math.max(4, Math.floor(length / 13));
      const dashMaster = MeshBuilder.CreateBox(
        `${landmark.id}-dash-master`,
        { width: 5.2, height: 0.035, depth: 0.14 },
        scene,
      );
      setMeshMaterial(dashMaster, lanePaint);
      dashMaster.isVisible = false;
      for (let index = 0; index < dashCount; index += 1) {
        const along =
          -length / 2 + ((index + 0.5) / dashCount) * length;
        const dash = dashMaster.createInstance(
          `${landmark.id}-dash-${index}`,
        );
        dash.parent = root;
        dash.position.set(along, deckY + 0.38, 0);
        dash.isPickable = false;
        this.staticSceneryFreeze.push(dash);
      }
      concrete.freeze();
      expressway.freeze();
      lanePaint.freeze();
      return true;
    }

    if (
      landmark.id === "cairo-qasr-el-nil-bridge" ||
      landmark.id === "cairo-al-galaa-bridge"
    ) {
      const axis = cairoBridgePortalVisualAxis(
        landmark,
        mapPack.geometry.roadSurfaces ?? [],
        mapPack.geometry.waterBodies ?? [],
      );
      const length = axis.lengthM;
      const width = axis.widthM;
      const root = new TransformNode(`${landmark.id}-axis`, scene);
      root.position.set(axis.center.x, 0, axis.center.z);
      root.rotation.y = axis.boxYawRad;
      for (const side of [-1, 1]) {
        const railing = createBox(
          scene,
          `${landmark.id}-railing-${side}`,
          { width: length, height: 0.42, depth: 0.16 },
          new Vector3(0, 0.63, side * width / 2),
          paleStone,
          root,
        );
        railing.isPickable = false;
      }
      const posts = Math.max(3, Math.floor(length / 12));
      for (let post = 0; post <= posts; post += 1) {
        const along = -length / 2 + (post / posts) * length;
        for (const side of [-1, 1]) {
          createCylinder(
            scene,
            `${landmark.id}-post-${post}-${side}`,
            { height: 1.05, diameter: 0.18, tessellation: 8 },
            new Vector3(along, 0.6, side * width / 2),
            bronze,
            root,
          );
        }
      }
      if (landmark.id === "cairo-qasr-el-nil-bridge") {
        for (const end of [-1, 1]) {
          for (const side of [-1, 1]) {
            createBox(
              scene,
              `${landmark.id}-lion-plinth-${end}-${side}`,
              { width: 1.5, height: 1.1, depth: 1.5 },
              new Vector3(
                end * (length / 2 - 2.2),
                0.55,
                side * (width / 2 + 0.8),
              ),
              paleStone,
              root,
            );
            createBox(
              scene,
              `${landmark.id}-lion-${end}-${side}`,
              { width: 1.05, height: 0.72, depth: 1.65 },
              new Vector3(
                end * (length / 2 - 2.2),
                1.45,
                side * (width / 2 + 0.8),
              ),
              bronze,
              root,
            );
          }
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Gives the South Kensington miniature a readable silhouette without using
   * imagery, branding, or detailed replicas of the real museum buildings.
   */
  private buildLondonLandmark(
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    material: StandardMaterial,
  ): boolean {
    const scene = this.scene;
    const trim = makeMaterial(scene, `${landmark.id}-trim`, new Color3(0.82, 0.76, 0.65));
    const windows = makeMaterial(scene, `${landmark.id}-windows`, new Color3(0.12, 0.2, 0.23));
    const roof = makeMaterial(scene, `${landmark.id}-roof`, new Color3(0.25, 0.22, 0.2));

    if (landmark.id === "london-natural-history-museum") {
      const height = 12;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height, depth: landmark.size.z },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-parapet`,
        { width: landmark.size.x + 1.2, height: 1.05, depth: landmark.size.z + 1.2 },
        new Vector3(landmark.center.x, height + 0.4, landmark.center.z),
        trim,
      );
      for (let column = -3; column <= 3; column += 1) {
        const x = landmark.center.x + column * (landmark.size.x / 8);
        createBox(
          scene,
          `${landmark.id}-pilaster-${column}`,
          { width: 1.2, height: 9.5, depth: 0.65 },
          new Vector3(x, 5.4, landmark.center.z - landmark.size.z / 2 - 0.35),
          trim,
        );
        if (column !== 0) {
          createBox(
            scene,
            `${landmark.id}-window-${column}`,
            { width: 3.4, height: 2.7, depth: 0.18 },
            new Vector3(
              x + landmark.size.x / 16,
              6.4,
              landmark.center.z - landmark.size.z / 2 - 0.7,
            ),
            windows,
          );
        }
      }
      createBox(
        scene,
        `${landmark.id}-entrance`,
        { width: 7.5, height: 6.2, depth: 0.85 },
        new Vector3(
          landmark.center.x,
          3.1,
          landmark.center.z - landmark.size.z / 2 - 0.5,
        ),
        roof,
      );
      return true;
    }

    if (landmark.id === "london-natural-history-tower") {
      const height = 24;
      createBox(
        scene,
        landmark.id,
        { width: 11, height, depth: 11 },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-clock-band`,
        { width: 12.4, height: 2.2, depth: 12.4 },
        new Vector3(landmark.center.x, 19, landmark.center.z),
        trim,
      );
      createCylinder(
        scene,
        `${landmark.id}-roof`,
        { height: 7, diameterTop: 0.8, diameterBottom: 13.5, tessellation: 4 },
        new Vector3(landmark.center.x, height + 3.5, landmark.center.z),
        roof,
      ).rotation.y = Math.PI / 4;
      return true;
    }

    if (
      landmark.id === "london-science-museum" ||
      landmark.id === "london-victoria-and-albert-museum"
    ) {
      const isVictoriaAndAlbert = landmark.id.includes("victoria");
      const height = isVictoriaAndAlbert ? 13 : 10;
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height, depth: landmark.size.z },
        new Vector3(landmark.center.x, height / 2, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-roofline`,
        { width: landmark.size.x + 0.8, height: 1.1, depth: landmark.size.z + 0.8 },
        new Vector3(landmark.center.x, height + 0.45, landmark.center.z),
        trim,
      );
      for (let bay = -3; bay <= 3; bay += 1) {
        const x = landmark.center.x + bay * (landmark.size.x / 8);
        createBox(
          scene,
          `${landmark.id}-bay-${bay}`,
          {
            width: isVictoriaAndAlbert ? 2.2 : 4.2,
            height: isVictoriaAndAlbert ? 6.5 : 3.1,
            depth: 0.2,
          },
          new Vector3(
            x,
            isVictoriaAndAlbert ? 6.1 : 5.3,
            landmark.center.z - landmark.size.z / 2 - 0.12,
          ),
          windows,
        );
      }
      return true;
    }

    if (landmark.id === "london-south-kensington-station") {
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height: 5.4, depth: landmark.size.z },
        new Vector3(landmark.center.x, 2.7, landmark.center.z),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-awning`,
        { width: landmark.size.x + 2, height: 0.35, depth: 2.8 },
        new Vector3(landmark.center.x, 3.1, landmark.center.z - landmark.size.z / 2 - 1.2),
        roof,
      );
      createBox(
        scene,
        `${landmark.id}-name-board`,
        { width: 9, height: 1.1, depth: 0.2 },
        new Vector3(landmark.center.x, 4.25, landmark.center.z - landmark.size.z / 2 - 0.14),
        trim,
      );
      return true;
    }

    if (landmark.id === "london-exhibition-road-public-space") {
      const paving = makeMaterial(scene, `${landmark.id}-paving`, new Color3(0.54, 0.54, 0.5));
      createBox(
        scene,
        landmark.id,
        { width: landmark.size.x, height: 0.14, depth: landmark.size.z },
        new Vector3(landmark.center.x, 0.14, landmark.center.z),
        paving,
      );
      for (const zOffset of [-18, -6, 6, 18]) {
        createBox(
          scene,
          `${landmark.id}-paving-band-${zOffset}`,
          { width: landmark.size.x, height: 0.025, depth: 0.35 },
          new Vector3(landmark.center.x, 0.23, landmark.center.z + zOffset),
          trim,
        );
      }
      return true;
    }

    return false;
  }

  /**
   * Deterministic roadside dressing (trees, streetlights, signs plus per-map
   * extras) built from instanced master meshes: one draw call per part kind
   * regardless of how many props a map receives.
   */

  /**
   * Park planting and furniture as ordinary prop placements.
   *
   * Gated through `deterministicSceneryKeep` per placement: anything scattered
   * that skips that gate silently escapes the low-spec thinning entirely, and a
   * park is by some distance the densest thing this map scatters.
   */
  private collectParkPlacements(
    mapPack: GameCanvasMapPack,
  ): { reachable: PropPlacement[]; interior: ParkPlacement[] } {
    const reachable: PropPlacement[] = [];
    const interior: ParkPlacement[] = [];
    for (const landmark of mapPack.geometry.landmarks) {
      if (landmark.kind !== "park") continue;
      const layout = parkLayoutForLandmark(mapPack, landmark);
      for (const [index, placement] of layout.placements.entries()) {
        if (
          !deterministicSceneryKeep(
            `${landmark.id}:${placement.kind}:${index}`,
            this.buildingKeepFraction,
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
            reachable.push(placement);
          } else {
            this.pendingParkProps.push(placement);
          }
          continue;
        }
        interior.push(placement);
        this.pendingParkThickets.push(placement);
      }
    }
    return { reachable, interior };
  }

  private buildRoadsideProps(
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
  ) {
    const scene = this.scene;
    const key = resolveMapVisualKey(mapId);
    const kinds = roadsidePropKindsForMap(key);
    if (!kinds.length || !roadSurfaces.length) return;

    // Keep scattered trees / street furniture off the gas-station forecourts and
    // venue lots — those models already fill that ground, and a tree sprouting on
    // a forecourt reads as a bug. Treated as extra avoid-rectangles at each POI's
    // set-back model centre.
    const poiExclusions: { center: GameCanvasPoint; size: GameCanvasPoint }[] = [
      ...(mapPack.geometry.servicePoints ?? []).map((sp) => ({
        anchor: sp.anchor,
        setback: sp.setbackM ?? DEFAULT_SERVICE_SETBACK_M,
        span: 22,
      })),
      ...(mapPack.geometry.gigVenues ?? []).map((venue) => ({
        anchor: venue.anchor,
        setback: venue.setbackM ?? 13,
        span: 13,
      })),
    ].flatMap((poi) => {
      const pose = resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, poi.anchor);
      if (!pose) return [];
      return [
        {
          center: {
            x: pose.x + Math.cos(pose.heading) * poi.setback,
            z: pose.z - Math.sin(pose.heading) * poi.setback,
          },
          size: { x: poi.span, z: poi.span },
        },
      ];
    });
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
      landmarks: [
        ...mapPack.geometry.landmarks.map((landmark) => ({
          center: landmark.center,
          size: landmark.size,
        })),
        ...poiExclusions,
      ],
      worldSize: mapPack.geometry.worldSize,
      shoulderWidthM: palette.paved
        ? PAVED_SIDEWALK_WIDTH_M
        : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2),
      seed: hashStringToSeed(`${mapId}-props`),
      kinds,
      waterPolygons: (mapPack.geometry.waterBodies ?? []).map(
        (body) => body.polygon,
      ),
      // Hand-placed furniture and regulatory sign posts pre-seed the mutual
      // spacing grid so the random scatter can never stand a prop on them.
      occupiedPoints:
        key === "london" || signPoints.length
          ? [
              ...(key === "london" ? LONDON_FURNITURE_POINTS : []),
              ...signPoints,
            ]
          : undefined,
    });

    // Park planting rides the same pipeline as the roadside scatter, so it
    // shares the tree masters, the shadow-caster registration and — the point —
    // `registerDestructibleProp`. A tree you can flatten on the street and one
    // you cannot flatten in a park would read as a bug, and the alternative was
    // a second, parallel prop builder.
    const park = this.collectParkPlacements(mapPack);
    const placements = [...roadsidePlacements, ...park.reachable];
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
      const grad = pctx.createRadialGradient(64, 64, 3, 64, 64, 62);
      grad.addColorStop(0, "rgba(255,190,110,0.85)");
      grad.addColorStop(0.4, "rgba(255,155,80,0.42)");
      grad.addColorStop(1, "rgba(255,140,60,0)");
      pctx.fillStyle = grad;
      pctx.fillRect(0, 0, 128, 128);
      poolTex.update();
      poolTex.hasAlpha = true;
      lampPool = new StandardMaterial("lamp-pool", scene);
      // Dim warm tint (not white) so the pool reads as a soft sodium spill and
      // its centre stays below the bloom threshold instead of blowing out.
      lampPool.emissiveColor = new Color3(0.72, 0.44, 0.19);
      lampPool.emissiveTexture = poolTex;
      lampPool.opacityTexture = poolTex;
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
        case "palm": {
          // A tall faceted date palm: ringed tapering trunk and a broad pair of
          // low-poly crowns. The compressed crown stays legible from the chase
          // camera without introducing fragile transparent frond textures.
          const palmLeaf = variant % 2 === 0 ? leaves[1] : leaves[0];
          parts = [
            {
              master: masterCylinder(
                `${cacheKey}-trunk`,
                {
                  height: 5.8,
                  diameterTop: 0.28,
                  diameterBottom: 0.52,
                },
                trunk,
              ),
              offset: new Vector3(0, 2.9, 0),
            },
            {
              master: masterCylinder(
                `${cacheKey}-lower-crown`,
                {
                  height: 0.42,
                  diameterTop: 3.8,
                  diameterBottom: 0.55,
                },
                palmLeaf,
              ),
              offset: new Vector3(0, 5.78, 0),
            },
            {
              master: masterCylinder(
                `${cacheKey}-upper-crown`,
                {
                  height: 0.38,
                  diameterTop: 0.45,
                  diameterBottom: 3.1,
                },
                palmLeaf,
              ),
              offset: new Vector3(0, 6.08, 0),
              castShadow: false,
            },
          ];
          break;
        }
        case "streetlight":
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
                    master: masterBox(
                      `${cacheKey}-pool`,
                      { width: 7, height: 0.02, depth: 7 },
                      lampPool,
                    ),
                    offset: new Vector3(0, 0.07, 1.1),
                    castShadow: false,
                  },
                ]
              : []),
          ];
          break;
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
        case "utility-pole":
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
          ];
          break;
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
          this.pendingVendors.push({ config, x: placement.x, z: placement.z, yaw: placement.rotationY });
        }
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
        this.staticSceneryFreeze.push(instance);
        if (part.castShadow !== false) {
          this.registerShadowCaster(instance, placement.x, placement.z);
        }
        destructibleParts.push({
          node: instance,
          isLightPool: part.master.name.includes("-pool"),
        });
      }
      this.registerDestructibleProp(
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
    ]) {
      propMaterial.freeze();
    }
  }

  /**
   * Regulatory signage for one-way roads: ONE WAY blades at enterable mouths,
   * DO NOT ENTER pairs at forbidden mouths, WRONG WAY repeaters down each
   * block (placements derived in regulatorySigns.ts). Each placement becomes
   * a post plus a textured blade. Faces are drawn on DynamicTextures — MUTCD
   * sign designs are US-government public domain — with the message on the
   * box's -Z face, the one Babylon renders upright (+Z comes out rotated
   * 180deg; see computePlatePlacements), and every remaining face mapped to a
   * flat aluminum patch of the same texture. A DO NOT ENTER / WRONG WAY face
   * therefore only reads against the flow: legal traffic sees a gray back.
   */
  private buildRegulatorySigns(placements: readonly RegulatorySignPlacement[]) {
    const scene = this.scene;
    const aluminum = "#9aa0a3";
    const white = "#f4f6f6";
    const signRed = "#a6141c";
    // Bottom half of every canvas stays solid gray; gray faces sample a small
    // centred rect of it so mipmap bleed from the designs can never reach in.
    const GRAY_UV = new Vector4(0.4, 0.1, 0.6, 0.3);
    const faceTexture = (
      name: string,
      width: number,
      height: number,
      draw: (context: CanvasRenderingContext2D) => void,
    ): DynamicTexture => {
      const texture = new DynamicTexture(name, { width, height }, scene, true);
      const context = textureContext(texture);
      context.fillStyle = aluminum;
      context.fillRect(0, 0, width, height);
      context.textAlign = "center";
      context.textBaseline = "middle";
      draw(context);
      texture.update();
      return texture;
    };
    const faceMaterial = (name: string, texture: DynamicTexture): StandardMaterial => {
      const material = new StandardMaterial(name, scene);
      material.diffuseTexture = texture;
      // Plate recipe: self-illuminated for night legibility, but held below
      // the night bloom threshold so signs read without glowing.
      material.emissiveTexture = texture;
      material.emissiveColor = new Color3(0.3, 0.3, 0.3);
      material.specularColor = new Color3(0.12, 0.12, 0.12);
      material.specularPower = 48;
      return material;
    };
    // R6-1 blade cell (512x256 at x0): black field, white border, white arrow
    // through the middle with "ONE WAY" set into the shaft.
    const drawOneWayCell = (
      context: CanvasRenderingContext2D,
      x0: number,
      pointLeft: boolean,
    ) => {
      context.fillStyle = "#101214";
      context.fillRect(x0, 0, 512, 256);
      context.strokeStyle = white;
      context.lineWidth = 8;
      context.strokeRect(x0 + 12, 12, 488, 232);
      context.fillStyle = white;
      const middle = 128;
      const headX = pointLeft ? x0 + 44 : x0 + 468;
      const neckX = pointLeft ? x0 + 150 : x0 + 362;
      const tailX = pointLeft ? x0 + 468 : x0 + 44;
      context.beginPath();
      context.moveTo(headX, middle);
      context.lineTo(neckX, middle - 92);
      context.lineTo(neckX, middle - 44);
      context.lineTo(tailX, middle - 44);
      context.lineTo(tailX, middle + 44);
      context.lineTo(neckX, middle + 44);
      context.lineTo(neckX, middle + 92);
      context.closePath();
      context.fill();
      context.fillStyle = "#101214";
      context.font = "bold 54px Arial, sans-serif";
      context.fillText("ONE WAY", x0 + 256 + (pointLeft ? 34 : -34), middle + 2);
    };
    const oneWayTexture = faceTexture("regsign-oneway", 1024, 512, (context) => {
      drawOneWayCell(context, 0, true);
      drawOneWayCell(context, 512, false);
    });
    // R5-1: white square, red disc, white bar, DO NOT / ENTER around it.
    const dneTexture = faceTexture("regsign-dne", 512, 1024, (context) => {
      context.fillStyle = white;
      context.fillRect(0, 0, 512, 512);
      context.fillStyle = signRed;
      context.beginPath();
      context.arc(256, 256, 232, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = white;
      context.fillRect(72, 232, 368, 48);
      context.font = "bold 64px Arial, sans-serif";
      context.fillText("DO NOT", 256, 152);
      context.fillText("ENTER", 256, 366);
    });
    // R5-1a: red panel, white border, WRONG WAY.
    const wrongWayTexture = faceTexture("regsign-wrongway", 512, 512, (context) => {
      context.fillStyle = signRed;
      context.fillRect(0, 0, 512, 256);
      context.strokeStyle = white;
      context.lineWidth = 8;
      context.strokeRect(10, 10, 492, 236);
      context.fillStyle = white;
      context.font = "bold 68px Arial, sans-serif";
      context.fillText("WRONG WAY", 256, 130);
    });
    const materials = {
      one_way: faceMaterial("regsign-oneway", oneWayTexture),
      do_not_enter: faceMaterial("regsign-dne", dneTexture),
      wrong_way: faceMaterial("regsign-wrongway", wrongWayTexture),
    };
    const blade = (
      name: string,
      width: number,
      height: number,
      material: StandardMaterial,
      minusZ: Vector4,
      plusZ: Vector4,
    ): Mesh => {
      // Babylon box faces: 0 = +Z (renders a faceUV region rotated 180deg),
      // 1 = -Z (renders it upright) — pass the +Z region pre-swapped.
      const faceUV = [
        plusZ,
        minusZ,
        GRAY_UV,
        GRAY_UV,
        GRAY_UV,
        GRAY_UV,
      ];
      const mesh = MeshBuilder.CreateBox(
        `prop-master-${name}`,
        { width, height, depth: 0.045, faceUV },
        scene,
      );
      setMeshMaterial(mesh, material);
      mesh.isVisible = false;
      return mesh;
    };
    const swapped = (region: Vector4): Vector4 =>
      new Vector4(region.z, region.w, region.x, region.y);
    const post = this.signPostMaster();
    const blades: Record<RegulatorySignKind, Mesh> = {
      // Double-faced: left-arrow cell reads on -Z, right-arrow cell on +Z, so
      // cross traffic on either side sees the arrow pointing along the flow.
      one_way: blade(
        "regsign-oneway",
        0.9,
        0.3,
        materials.one_way,
        new Vector4(0, 0.5, 0.5, 1),
        swapped(new Vector4(0.5, 0.5, 1, 1)),
      ),
      do_not_enter: blade(
        "regsign-dne",
        0.75,
        0.75,
        materials.do_not_enter,
        new Vector4(0, 0.5, 1, 1),
        GRAY_UV,
      ),
      wrong_way: blade(
        "regsign-wrongway",
        0.9,
        0.6,
        materials.wrong_way,
        new Vector4(0, 0.5, 1, 1),
        GRAY_UV,
      ),
    };
    const bladeOffsets: Record<RegulatorySignKind, Vector3> = {
      one_way: new Vector3(0, 2.75, 0),
      do_not_enter: new Vector3(0, 2.2, -0.08),
      wrong_way: new Vector3(0, 2.05, -0.08),
    };
    const kindKeys: Record<RegulatorySignKind, string> = {
      one_way: "oneway-sign",
      do_not_enter: "dne-sign",
      wrong_way: "wrongway-sign",
    };
    const postOffset = new Vector3(0, 1.3, 0);
    let instanceIndex = 0;
    for (const placement of placements) {
      const yaw = regulatorySignYawRad(placement.kind, placement.flowHeadingRad);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const destructibleParts: DestructiblePropPart[] = [];
      for (const part of [
        { master: post, offset: postOffset },
        { master: blades[placement.kind], offset: bladeOffsets[placement.kind] },
      ]) {
        const instance = part.master.createInstance(
          `prop-${kindKeys[placement.kind]}-${instanceIndex}`,
        );
        instanceIndex += 1;
        instance.position.set(
          placement.x + part.offset.x * cos + part.offset.z * sin,
          part.offset.y,
          placement.z - part.offset.x * sin + part.offset.z * cos,
        );
        instance.rotation.y = yaw;
        instance.isPickable = false;
        this.staticSceneryFreeze.push(instance);
        this.registerShadowCaster(instance, placement.x, placement.z);
        destructibleParts.push({ node: instance, isLightPool: false });
      }
      this.registerDestructibleProp(
        kindKeys[placement.kind],
        placement.x,
        placement.z,
        1,
        destructibleParts,
      );
    }
    materials.one_way.freeze();
    materials.do_not_enter.freeze();
    materials.wrong_way.freeze();
  }

  /**
   * The 2.6 m sign post, shared by both sign families — either may build first
   * or alone, so it is memoised rather than owned by one of them. Sharing it
   * means the second family's posts cost no extra draw call.
   */
  private signPostMaster(): Mesh {
    if (this.signPost) return this.signPost;
    const material = makeMaterial(
      this.scene,
      "regsign-post",
      new Color3(0.45, 0.47, 0.48),
    );
    const post = MeshBuilder.CreateCylinder(
      "prop-master-regsign-post",
      { height: 2.6, diameter: 0.09, tessellation: 8 },
      this.scene,
    );
    setMeshMaterial(post, material);
    post.isVisible = false;
    material.freeze();
    this.signPost = post;
    return post;
  }

  /**
   * Speed-limit plates, on every map, in the host country's own design.
   *
   * Unlike the one-way family this cannot key its masters off the sign kind:
   * the number is baked into the blade's `faceUV`, so instances of one master
   * can only ever read one figure. One master, texture and material per
   * distinct posted figure instead — at most three on any shipped city, and
   * every instance of a figure batches into a single draw call.
   */
  private buildSpeedLimitSigns(
    placements: readonly SpeedLimitSignPlacement[],
    countryId: string,
  ) {
    const scene = this.scene;
    const vienna = speedLimitSignFamily(countryId) !== "mutcd";
    const white = "#f4f6f6";
    const post = this.signPostMaster();
    const materials: StandardMaterial[] = [];
    const bladeFor = (figure: number): Mesh => {
      // The design occupies the top half (Vienna) or top 5/8 (MUTCD) of the
      // canvas; the rest stays the aluminium fill so GRAY_UV keeps sampling a
      // flat patch of this same texture for every other face.
      //
      // As a fraction of canvas height — and canvas y runs down from the top
      // while texture v runs up from the bottom, so the design's lower edge is
      // at v = 1 - designV. Getting this wrong does not fail: it silently
      // samples the wrong band and slices the numeral off the plate.
      const designHeightPx = vienna ? 512 : 640;
      const designV = designHeightPx / 1024;
      const texture = new DynamicTexture(
        `speedsign-${figure}-texture`,
        { width: 512, height: 1024 },
        scene,
        true,
      );
      const context = textureContext(texture);
      context.fillStyle = "#9aa0a3";
      context.fillRect(0, 0, 512, 1024);
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (vienna) {
        // The Vienna Convention disc: white field, red annulus, numeral.
        context.fillStyle = white;
        context.fillRect(0, 0, 512, 512);
        context.fillStyle = "#c1121f";
        context.beginPath();
        context.arc(256, 256, 244, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = white;
        context.beginPath();
        context.arc(256, 256, 186, 0, Math.PI * 2);
        context.fill();
        // Japan is the Vienna signatory that sets its limit numerals in blue
        // rather than black — the one visual tell that you are in Tokyo.
        context.fillStyle = countryId === "jp" ? "#12266e" : "#101214";
        context.font = "bold 232px Arial, sans-serif";
        context.fillText(String(figure), 256, 268);
      } else {
        // MUTCD R2-1: white rectangle, black border, SPEED / LIMIT / figure.
        context.fillStyle = white;
        context.fillRect(0, 0, 512, 640);
        context.strokeStyle = "#101214";
        context.lineWidth = 14;
        context.strokeRect(18, 18, 512 - 36, 640 - 36);
        context.fillStyle = "#101214";
        context.font = "bold 96px Arial, sans-serif";
        context.fillText("SPEED", 256, 118);
        context.fillText("LIMIT", 256, 224);
        context.font = "bold 260px Arial, sans-serif";
        context.fillText(String(figure), 256, 452);
      }
      texture.update();
      const material = new StandardMaterial(`speedsign-${figure}`, scene);
      material.diffuseTexture = texture;
      // The plate recipe: lit enough to read after dark, held under the night
      // bloom threshold so it does not glow.
      material.emissiveTexture = texture;
      material.emissiveColor = new Color3(0.3, 0.3, 0.3);
      material.specularColor = new Color3(0.12, 0.12, 0.12);
      material.specularPower = 48;
      materials.push(material);
      const design = new Vector4(0, 1 - designV, 1, 1);
      const gray = new Vector4(0.4, 0.1, 0.6, 0.3);
      let mesh: Mesh;
      if (vienna) {
        // A disc, not a plate with a disc painted on it: the round silhouette
        // is the strongest cue that this is not an American street, and it
        // reads at a distance where the numeral does not. Babylon inscribes a
        // cap's circle into its faceUV rect, so the 512-square design lands
        // 1:1 — [bottom cap, tube, top cap].
        mesh = MeshBuilder.CreateCylinder(
          `prop-master-speedsign-${figure}`,
          { height: 0.05, diameter: 0.62, tessellation: 32, faceUV: [gray, gray, design] },
          scene,
        );
        // Baked rather than set per instance: an instance carries only the
        // yaw, and this stands the disc up so its face reads like the box's
        // -Z face does.
        mesh.rotation.x = -Math.PI / 2;
        mesh.bakeCurrentTransformIntoVertices();
      } else {
        mesh = MeshBuilder.CreateBox(
          `prop-master-speedsign-${figure}`,
          {
            width: 0.61,
            height: 0.76,
            depth: 0.045,
            // Face 1 is -Z, the one Babylon renders upright.
            faceUV: [gray, design, gray, gray, gray, gray],
          },
          scene,
        );
      }
      setMeshMaterial(mesh, material);
      mesh.isVisible = false;
      return mesh;
    };
    const blades = new Map<number, Mesh>();
    for (const figure of new Set(placements.map((p) => p.limitFigure))) {
      blades.set(figure, bladeFor(figure));
    }
    const bladeOffset = new Vector3(0, vienna ? 2.2 : 2.12, -0.08);
    const postOffset = new Vector3(0, 1.3, 0);
    let instanceIndex = 0;
    for (const placement of placements) {
      const blade = blades.get(placement.limitFigure);
      if (!blade) continue;
      const yaw = speedLimitSignYawRad(placement.flowHeadingRad);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const destructibleParts: DestructiblePropPart[] = [];
      for (const part of [
        { master: post, offset: postOffset },
        { master: blade, offset: bladeOffset },
      ]) {
        const instance = part.master.createInstance(
          `prop-speedlimit-sign-${instanceIndex}`,
        );
        instanceIndex += 1;
        instance.position.set(
          placement.x + part.offset.x * cos + part.offset.z * sin,
          part.offset.y,
          placement.z - part.offset.x * sin + part.offset.z * cos,
        );
        instance.rotation.y = yaw;
        instance.isPickable = false;
        this.staticSceneryFreeze.push(instance);
        this.registerShadowCaster(instance, placement.x, placement.z);
        destructibleParts.push({ node: instance, isLightPool: false });
      }
      this.registerDestructibleProp(
        "speedlimit-sign",
        placement.x,
        placement.z,
        1,
        destructibleParts,
      );
    }
    for (const material of materials) material.freeze();
  }

  private buildLondonStreetFurniture() {
    const scene = this.scene;
    const iron = makeMaterial(scene, "london-street-iron", new Color3(0.055, 0.065, 0.065));
    const lamp = makeMaterial(
      scene,
      "london-street-lamp",
      new Color3(0.78, 0.72, 0.5),
      new Color3(0.16, 0.12, 0.05),
    );
    const planter = makeMaterial(scene, "london-planter", new Color3(0.2, 0.34, 0.19));
    const postBoxRed = makeMaterial(scene, "london-post-box", new Color3(0.62, 0.045, 0.04));

    const lampPositions = LONDON_LAMP_POSITIONS;
    for (let index = 0; index < lampPositions.length; index += 1) {
      const [x, z] = lampPositions[index];
      const post = createCylinder(
        scene,
        `london-lamp-post-${index}`,
        { height: 4.7, diameter: 0.18 },
        new Vector3(x, 2.35, z),
        iron,
      );
      const head = createBox(
        scene,
        `london-lamp-head-${index}`,
        { width: 0.62, height: 0.78, depth: 0.62 },
        new Vector3(x, 4.68, z),
        lamp,
      );
      this.registerDestructibleProp("london-lamp", x, z, 1, [
        { node: post, isLightPool: false },
        { node: head, isLightPool: false },
      ]);
    }

    for (const [index, [x, z]] of LONDON_BOLLARD_POSITIONS.entries()) {
      const bollard = createCylinder(
        scene,
        `london-bollard-${index}-${x}`,
        { height: 0.95, diameterTop: 0.17, diameterBottom: 0.28 },
        new Vector3(x, 0.49, z),
        iron,
      );
      this.registerDestructibleProp("london-bollard", x, z, 1, [
        { node: bollard, isLightPool: false },
      ]);
    }

    for (const [index, [x, z]] of LONDON_PLANTER_POSITIONS.entries()) {
      const planterBody = createCylinder(
        scene,
        `london-planter-${index}`,
        { height: 0.72, diameterTop: 1.15, diameterBottom: 0.92 },
        new Vector3(x, 0.38, z),
        planter,
      );
      this.registerDestructibleProp("london-planter", x, z, 1, [
        { node: planterBody, isLightPool: false },
      ]);
    }

    createCylinder(
      scene,
      "london-generic-post-box",
      { height: 1.55, diameter: 0.62 },
      new Vector3(LONDON_POST_BOX_POSITION[0], 0.79, LONDON_POST_BOX_POSITION[1]),
      postBoxRed,
    );
    createCylinder(
      scene,
      "london-generic-post-box-cap",
      { height: 0.28, diameterTop: 0.4, diameterBottom: 0.72 },
      new Vector3(LONDON_POST_BOX_POSITION[0], 1.69, LONDON_POST_BOX_POSITION[1]),
      postBoxRed,
    );
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
  private buildWaterBodies(mapPack: GameCanvasMapPack, mapId: string) {
    const bodies = mapPack.geometry.waterBodies ?? [];
    if (!bodies.length) return;
    const scene = this.scene;
    const palette = this.visualPalette;
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
        this.lowSpec ? 256 : 512,
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
        if (!this.lowSpec) {
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
      this.registerMirrorSurface(mesh);
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

  private updateWaterVisuals(visualTimeSeconds: number) {
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

  private createRoadSurfaceMesh(
    name: string,
    centerline: readonly GameCanvasPoint[],
    widthM: number,
    material: StandardMaterial,
    smoothClosed = false,
    surfaceY = ROAD_SURFACE_Y,
  ): Mesh | undefined {
    const renderedCenterline = smoothClosed
      ? smoothClosedRoadCenterline(centerline)
      : centerline;
    // Smoothed roundabout rings arrive deduplicated and must force closure;
    // every other centreline relies on auto-detection so authored loops (for
    // example the orientation-yard rectangles) get mitered corners instead of
    // two dead-end caps at their shared first/last point.
    const geometry = buildRoadSurfaceStripGeometry(
      renderedCenterline,
      widthM,
      smoothClosed ? true : undefined,
    );
    if (!geometry.positions.length || !geometry.indices.length) return undefined;

    const positions = geometry.positions.map((value, index) =>
      index % 3 === 1 ? surfaceY : value,
    );
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, [...geometry.indices], normals);
    const mesh = new Mesh(name, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = [...geometry.indices];
    vertexData.normals = normals;
    // World-planar UVs (~20 m tile) keep the wear texture continuous where
    // independently authored surfaces meet without obvious repetition.
    vertexData.uvs = buildPlanarUVs(positions, 0.05);
    vertexData.applyToMesh(mesh);
    setMeshMaterial(mesh, material, true);
    mesh.freezeWorldMatrix();
    return mesh;
  }

  private createRoadJunctionFill(
    name: string,
    fill: RoadJunctionFill,
    material: StandardMaterial,
    y: number,
  ): Mesh | undefined {
    const { polygon, pivot } = fill;
    if (polygon.length < 3) return undefined;
    // Fan from the shared node, not from a vertex: the outline is a plus with
    // rounded corners, so no vertex of it can see the whole boundary — but the
    // node it was built around can.
    const positions: number[] = [pivot.x, y, pivot.z];
    for (const point of polygon) positions.push(point.x, y, point.z);
    const indices: number[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      indices.push(0, index + 1, ((index + 1) % polygon.length) + 1);
    }
    let normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    // Guarantee the surface faces up regardless of the hull's winding in world
    // space, so it lights the same as the road strips instead of going black.
    if (normals[1] < 0) {
      for (let index = 0; index < indices.length; index += 3) {
        const swap = indices[index + 1];
        indices[index + 1] = indices[index + 2];
        indices[index + 2] = swap;
      }
      normals = [];
      VertexData.ComputeNormals(positions, indices, normals);
    }
    const mesh = new Mesh(name, this.scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    // Same ~20 m world-planar tiling as createRoadSurfaceMesh so the wear
    // texture is continuous across the seam with the surrounding carriageway.
    vertexData.uvs = buildPlanarUVs(positions, 0.05);
    vertexData.applyToMesh(mesh);
    setMeshMaterial(mesh, material, true);
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  /** Pours a MarkingGeometry accumulator into one frozen static mesh. */
  private buildMergedMarkingMesh(
    name: string,
    geometry: MarkingGeometry,
    material: StandardMaterial,
  ): Mesh | undefined {
    if (geometry.indices.length === 0) return undefined;
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = geometry.positions;
    data.normals = geometry.normals;
    data.indices = geometry.indices;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }

  private createFlatSegment(
    name: string,
    start: GameCanvasPoint,
    end: GameCanvasPoint,
    width: number,
    y: number,
    material: StandardMaterial,
  ): Mesh | undefined {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return undefined;
    const segment = createBox(
      this.scene,
      name,
      { width, height: Math.max(0.025, y * 0.45), depth: length + 0.25 },
      new Vector3((start.x + end.x) / 2, y, (start.z + end.z) / 2),
      material,
    );
    segment.rotation.y = Math.atan2(dx, dz);
    return segment;
  }

  private createRouteChevrons(
    lane: GameCanvasLane,
    material: StandardMaterial,
    routeIndex: number,
    conflictZones: GameCanvasMapPack["laneGraph"]["conflictZones"],
  ) {
    const halfSpan = resolveRouteChevronHalfSpan(lane.widthM ?? 3.2);
    for (const [index, placement] of computeRouteChevronPlacements(
      lane,
      conflictZones,
    ).entries()) {
      const { tip, back, sideX, sideZ } = placement;
      const left = this.createFlatSegment(
        `route-chevron-${lane.id}-${index}-left`,
        { x: back.x + sideX * halfSpan, z: back.z + sideZ * halfSpan },
        tip,
        0.22,
        0.145,
        material,
      );
      const right = this.createFlatSegment(
        `route-chevron-${lane.id}-${index}-right`,
        { x: back.x - sideX * halfSpan, z: back.z - sideZ * halfSpan },
        tip,
        0.22,
        0.145,
        material,
      );
      const meshes = [left, right].filter((mesh): mesh is Mesh => Boolean(mesh));
      for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
      this.routeChevronVisuals.push({
        routeIndex,
        laneId: lane.id,
        distanceAlongM: placement.distanceAlongM,
        meshes,
      });
    }
  }

  private createCheckpointTarget(
    checkpoint: AuthoredCheckpoint,
    material: StandardMaterial,
    labelText = "◆  CHECKPOINT",
  ): GuidanceVisual {
    const meshes: Mesh[] = [];
    const targetWidth = resolveCheckpointTargetWidth(checkpoint.laneWidthM);
    const halfWidth = targetWidth / 2;
    const halfLength = 0.72;
    const armLength = Math.min(0.42, targetWidth * 0.22);
    const forward = {
      x: Math.sin(checkpoint.heading),
      z: Math.cos(checkpoint.heading),
    };
    const side = { x: forward.z, z: -forward.x };
    const point = (along: number, lateral: number): GameCanvasPoint => ({
      x: checkpoint.x + forward.x * along + side.x * lateral,
      z: checkpoint.z + forward.z * along + side.z * lateral,
    });
    for (const alongSign of [-1, 1]) {
      for (const sideSign of [-1, 1]) {
        const along = alongSign * halfLength;
        const lateral = sideSign * halfWidth;
        const alongArm = this.createFlatSegment(
          `checkpoint-${checkpoint.id}-${alongSign}-${sideSign}-along`,
          point(along, lateral),
          point(along - alongSign * armLength, lateral),
          0.13,
          0.155,
          material,
        );
        const sideArm = this.createFlatSegment(
          `checkpoint-${checkpoint.id}-${alongSign}-${sideSign}-side`,
          point(along, lateral),
          point(along, lateral - sideSign * armLength),
          0.13,
          0.155,
          material,
        );
        if (alongArm) meshes.push(alongArm);
        if (sideArm) meshes.push(sideArm);
      }
    }

    const texture = new DynamicTexture(
      `checkpoint-${checkpoint.id}-label-texture`,
      { width: 512, height: 128 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(8, 29, 31, 0.88)";
    context.beginPath();
    context.roundRect(10, 12, 492, 104, 24);
    context.fill();
    context.fillStyle = "#81fff0";
    context.font = "700 38px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(labelText, 256, 64);
    texture.update(false);
    const labelMaterial = new StandardMaterial(
      `checkpoint-${checkpoint.id}-label-material`,
      this.scene,
    );
    labelMaterial.diffuseTexture = texture;
    labelMaterial.opacityTexture = texture;
    labelMaterial.emissiveTexture = texture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(
      `checkpoint-${checkpoint.id}-label`,
      { width: Math.min(1.75, targetWidth * 0.78), height: 0.44 },
      this.scene,
    );
    label.position.set(
      checkpoint.x - forward.x * 0.03,
      0.165,
      checkpoint.z - forward.z * 0.03,
    );
    label.rotation.x = Math.PI / 2;
    label.rotation.y = checkpoint.heading;
    setMeshMaterial(label, labelMaterial);
    meshes.push(label);
    for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
    return { id: checkpoint.id, meshes };
  }

  /**
   * A gold "FINISH" target at the end of the route's last lane. The route end
   * is otherwise unmarked—on a loop lesson it coincides with the spawn corner—
   * so it stays hidden until every checkpoint is passed, then signposts exactly
   * where the drive completes.
   */
  private createFinishBeacon(
    mapPack: GameCanvasMapPack,
  ): GuidanceVisual | null {
    const route = this.options.lesson?.route ?? [];
    const lastLaneId = route.at(-1);
    if (!lastLaneId) return null;
    const lane = mapPack.laneGraph.lanes.find(
      (candidate) => candidate.id === lastLaneId,
    );
    const centerline = lane?.centerline;
    if (!lane || !centerline || centerline.length < 2) return null;
    const end = centerline[centerline.length - 1];
    const prev = centerline[centerline.length - 2];
    const finishMaterial = makeMaterial(
      this.scene,
      "scenario-finish",
      new Color3(0.95, 0.78, 0.25),
      new Color3(0.4, 0.3, 0.05),
    );
    return this.createCheckpointTarget(
      {
        id: "__route_finish__",
        label: "Finish",
        x: end.x,
        z: end.z,
        heading: Math.atan2(end.x - prev.x, end.z - prev.z),
        laneId: lane.id,
        laneWidthM: lane.widthM ?? mapPack.geometry.roadWidth ?? 3.2,
        distanceAlongM: null,
      },
      finishMaterial,
      "◆  FINISH",
    );
  }

  private updateGuidanceVisuals() {
    for (const [index, visual] of this.checkpointVisuals.entries()) {
      const enabled =
        index === this.checkpointIndex &&
        this.simulationSnapshot.nextCheckpointId === visual.id;
      for (const mesh of visual.meshes) mesh.setEnabled(enabled);
    }
    if (this.finishVisual) {
      const showFinish =
        this.checkpointIndex >= this.authoredCheckpoints.length &&
        !this.completed;
      for (const mesh of this.finishVisual.meshes) mesh.setEnabled(showFinish);
    }

    const lesson = this.options.lesson;
    const mapPack = this.options.mapPack;
    if (!lesson || !mapPack) {
      this.updateGuidanceCueVisual();
      return;
    }
    const visibleRouteIndex = resolveAuthoritativeRouteIndex(
      lesson.route.length,
      this.simulationSnapshot.guidance,
    );
    const currentLaneId =
      visibleRouteIndex === null ? null : lesson.route[visibleRouteIndex];
    // Map lookup, and none at all off-route: the find() this replaces
    // scanned every lane in the city per frame — including on free drive,
    // where currentLaneId is always null and it found nothing.
    const currentLane =
      currentLaneId != null ? this.laneById?.get(currentLaneId) : undefined;
    const currentProjection = currentLane
      ? projectPointToLane(currentLane, {
          x: this.playerState.x,
          z: this.playerState.z,
        })
      : null;
    const playerOccupiesVisibleLane = Boolean(
      currentProjection &&
        currentLane &&
        currentProjection.distance <= (currentLane.widthM ?? 3.2) / 2 + 0.5,
    );
    for (const visual of this.routeChevronVisuals) {
      let enabled = false;
      if (visual.routeIndex === visibleRouteIndex) {
        enabled =
          playerOccupiesVisibleLane && currentProjection
            ? visual.distanceAlongM > currentProjection.distanceAlongM + 2 &&
              visual.distanceAlongM < currentProjection.distanceAlongM + 58
            : visual.distanceAlongM < 42;
      } else if (
        visibleRouteIndex !== null &&
        visual.routeIndex === visibleRouteIndex + 1
      ) {
        // Preview the start of the next route occurrence so a turn is
        // signposted before the current lane's arrows run out; without this
        // every junction hand-off left a blind gap in the guidance.
        enabled = visual.distanceAlongM < 42;
      }
      for (const mesh of visual.meshes) mesh.setEnabled(enabled);
    }
    this.updateGuidanceCueVisual();
  }

  /**
   * QA's window hooks (__sideswap*), installed once per session. They lived
   * at the tail of updateGuidanceVisuals for years, re-allocating eight
   * closures — plus a guidance object with a per-chevron .map() — every
   * frame. Each hook now computes on call; dispose() still deletes the full
   * list, so the install/delete pairing rule is unchanged.
   */
  private installDebugHooks() {
    if (typeof window === "undefined") return;
    {
      const debugWindow = window as unknown as Record<string, unknown>;
      debugWindow.__sideswapGuidanceDebug = () => {
        const lesson = this.options.lesson;
        const visibleRouteIndex = lesson
          ? resolveAuthoritativeRouteIndex(
              lesson.route.length,
              this.simulationSnapshot.guidance,
            )
          : null;
        return {
          owner: this.simulationSnapshot.guidance.owner,
          status: this.simulationSnapshot.guidance.status,
          blockingReason:
            this.simulationSnapshot.guidance.blockingReason ?? null,
          cue: this.simulationSnapshot.guidance.cue ?? null,
          visibleRouteIndex,
          paused: this.paused,
          player: {
            x: Math.round(this.playerState.x * 100) / 100,
            z: Math.round(this.playerState.z * 100) / 100,
            heading: Math.round(this.playerState.heading * 1000) / 1000,
            speed: Math.round(this.playerState.speedMps * 100) / 100,
          },
          checkpoint: this.simulationSnapshot.nextCheckpointId ?? null,
          instruction: this.instruction,
          chevrons: this.routeChevronVisuals.map((visual) => ({
            routeIndex: visual.routeIndex,
            laneId: visual.laneId,
            d: Math.round(visual.distanceAlongM),
            x: Math.round((visual.meshes[0]?.position.x ?? 0) * 10) / 10,
            z: Math.round((visual.meshes[0]?.position.z ?? 0) * 10) / 10,
            on: visual.meshes[0]?.isEnabled() ?? false,
          })),
        };
      };
      debugWindow.__sideswapDriveControl = (input: {
        throttle?: number;
        brake?: number;
        reverse?: number;
        steer?: number;
      }) => {
        this.touch.throttle = clamp(input.throttle ?? 0, 0, 1);
        this.touch.brake = clamp(input.brake ?? 0, 0, 1);
        this.touch.reverse = clamp(input.reverse ?? 0, 0, 1);
        this.touch.steer = clamp(input.steer ?? 0, -1, 1);
      };
      // Revs, gear and per-voice levels, so QA can assert the engine actually
      // shifts and the tyres actually squeal without anyone having to listen.
      debugWindow.__sideswapAudioDebug = () => this.audio?.debugSnapshot() ?? null;
      // World-space AABB inventory: lets WebDriver QA verify placement (e.g.
      // "does the fuel lot overlap the shoulder?") numerically, not by pixel.
      debugWindow.__sideswapMeshes = () =>
        this.scene.meshes
          .filter((mesh) => mesh.isEnabled())
          .map((mesh) => {
            mesh.computeWorldMatrix(true);
            const bounds = mesh.getBoundingInfo().boundingBox;
            const lo = bounds.minimumWorld;
            const hi = bounds.maximumWorld;
            const r = (value: number) => Math.round(value * 100) / 100;
            return {
              n: mesh.name,
              x: r((lo.x + hi.x) / 2),
              y: r((lo.y + hi.y) / 2),
              z: r((lo.z + hi.z) / 2),
              sx: r(hi.x - lo.x),
              sy: r(hi.y - lo.y),
              sz: r(hi.z - lo.z),
              minx: r(lo.x),
              maxx: r(hi.x),
              minz: r(lo.z),
              maxz: r(hi.z),
            };
          });
      // Frame rate + mesh/draw-call counts, so QA can measure the cost of the
      // dense city and confirm the static-scenery freeze keeps it smooth.
      debugWindow.__sideswapPerfDebug = () => ({
        fps: Math.round(this.engine.getFps()),
        // CSS px per rendered px, so lower is sharper. Watching this settle is
        // how you tell a throttling device from a slow one. Null rung means
        // desktop, which is not governed.
        hardwareScalingLevel: this.engine.getHardwareScalingLevel(),
        renderScalingRung: this.renderScaling?.index ?? null,
        targetFps: this.renderScaling ? TOUCH_TARGET_FPS : null,
        totalMeshes: this.scene.meshes.length,
        activeMeshes: this.scene.getActiveMeshes().length,
        materials: this.scene.materials.length,
        // Cumulative since page load (no per-frame reset without scene
        // instrumentation) — meaningful as a delta between two polls.
        drawCallsCumulative: this.engineDrawCallCount(),
        // Mirror cull: the ring gathered from the cell hash, and what survived
        // the frustum test against the mirror camera. A zero in either — or a
        // render count that stops climbing — is the silent failure mode, since
        // a mirror stuck on a stale texture looks plausible until you watch it.
        mirrorRenders: this.mirrorRenderCount,
        mirrorCandidates: this.mirrorCandidates.length,
        mirrorDrawn: this.mirrorRenderList.length,
        crowdInstances: this.crowdRenderer?.instanceCount ?? 0,
        crowdMeshes: this.crowdRenderer?.meshCount ?? 0,
        // Substage timings since the previous poll — reading resets the
        // window, so poll on a fixed cadence when comparing runs.
        ...this.drainPerfStats(),
      });
      // The interaction cutscene's live state, so QA can assert the scene
      // actually runs, where its actor is, and that the camera stack and the
      // control lock restore when it ends.
      debugWindow.__sideswapCutsceneDebug = () => ({
        active: this.activeCutscene
          ? {
              kind: this.activeCutscene.kind,
              nonce: this.activeCutscene.nonce,
              step: this.activeCutscene.stepIndex,
              action:
                this.activeCutscene.script[this.activeCutscene.stepIndex]
                  ?.action ?? null,
              actorX:
                Math.round(this.activeCutscene.actorNode.position.x * 100) /
                100,
              actorZ:
                Math.round(this.activeCutscene.actorNode.position.z * 100) /
                100,
              actorVisible: this.activeCutscene.actorNode.isEnabled(),
              // Where the scene is watched from. A staged shot that ends up
              // inside a wall looks like a rendering bug and is really a
              // placement one, and there is no way to tell from a screenshot
              // which wall you are inside of.
              cameraX: Math.round(this.activeCutscene.cameraPosition.x * 100) / 100,
              cameraY: Math.round(this.activeCutscene.cameraPosition.y * 100) / 100,
              cameraZ: Math.round(this.activeCutscene.cameraPosition.z * 100) / 100,
              // The traffic stop's second car, so QA can assert it actually
              // pulls in behind rather than parking on top of the player.
              patrolX: this.activeCutscene.patrolNode
                ? Math.round(this.activeCutscene.patrolNode.position.x * 100) /
                  100
                : null,
              patrolZ: this.activeCutscene.patrolNode
                ? Math.round(this.activeCutscene.patrolNode.position.z * 100) /
                  100
                : null,
            }
          : null,
        playerX: Math.round(this.playerState.x * 100) / 100,
        playerZ: Math.round(this.playerState.z * 100) / 100,
        playerHeading: Math.round(this.playerState.heading * 1000) / 1000,
        cameraMode: this.cameraMode,
        activeCamera: this.scene.activeCamera?.name ?? null,
        dip: Math.round(this.cutsceneDipOffset * 1000) / 1000,
      });
      // Rear-lamp glow per side, so QA can assert the signalling lens actually
      // flashes bright while the other keeps the resting glow, numerically.
      debugWindow.__sideswapLampDebug = () => {
        const glow = (meshes?: ReadonlyArray<{ material: unknown }>) => {
          const material = meshes?.[0]?.material as
            | { emissiveColor?: { r: number } }
            | null
            | undefined;
          return material?.emissiveColor
            ? Math.round(material.emissiveColor.r * 100) / 100
            : null;
        };
        return {
          indicator: this.playerState.indicator,
          left: glow(this.playerVehicleVisual?.leftIndicators),
          right: glow(this.playerVehicleVisual?.rightIndicators),
        };
      };
      // What the enforcement cameras can currently see, and what every signal
      // is showing. Two rules are only fineable in a window that lasts a couple
      // of seconds — a red aspect, or a patrol out of range — so QA cannot
      // reproduce either by driving and hoping. This is the state that decides
      // it, without which "the camera did not fine me" is unfalsifiable.
      debugWindow.__sideswapEnforcementDebug = () => {
        const { x, z } = this.playerState;
        return {
          cameraLightIds: [...this.trafficCameraControlIdByLightId.keys()],
          cameraControlIds: [
            ...new Set(this.trafficCameraControlIdByLightId.values()),
          ],
          nearestCameraM: this.trafficCameraPoints.reduce(
            (best, point) => Math.min(best, Math.hypot(point.x - x, point.z - z)),
            Number.POSITIVE_INFINITY,
          ),
          inSpeedCameraRange: this.trafficCameraWitnesses({
            code: "speeding",
          } as SimulationRuleEvent),
          patrolWithin35M: Boolean(this.patrolNearPlayer(35)),
          lights: this.simulationSnapshot.trafficLights.map((light) => ({
            id: light.id,
            state: light.state,
            watched: this.trafficCameraControlIdByLightId.has(light.id),
          })),
        };
      };
      // Walker states + bubble, so the capture harness can assert the crowd
      // moves smoothly and never pops in or out on screen.
      debugWindow.__sideswapCrowdDebug = () => {
        const round = (value: number) => Math.round(value * 100) / 100;
        return {
          total: this.crowdSim?.walkers.length ?? 0,
          byModel: this.crowdRenderer?.modelCounts ?? [],
          vatTime: round(this.crowdRenderer?.vatTime ?? 0),
          walkers:
            this.crowdSim?.walkers.map((walker) => ({
              x: round(walker.x),
              z: round(walker.z),
              edge: walker.edgeId,
              s: round(walker.s),
              lateral: round(walker.lateralM),
              dir: walker.dir,
              state: walker.state,
              speed: round(walker.speedMps),
              down: round(walker.downedRemaining),
              recycled: walker.justRecycled,
            })) ?? [],
        };
      };
    }
  }

  private updateGuidanceCueVisual() {
    const guidance = this.simulationSnapshot.guidance;
    const activeCheckpoint = this.authoredCheckpoints.find(
      (checkpoint) => checkpoint.id === this.simulationSnapshot.nextCheckpointId,
    ) ?? null;
    const cue =
      guidance.owner?.kind === "route" &&
      guidanceCueOverlapsCheckpoint(guidance.cue, activeCheckpoint)
        ? null
        : guidance.cue;
    const key = guidance.owner && cue
      ? `${guidance.owner.kind}:${cue.id}:${cue.label}:${cue.laneId}:${cue.distanceAlongM}:${guidance.status}`
      : null;
    if (key !== this.guidanceCueKey) {
      if (this.guidanceCueVisual) {
        if (this.guidanceCueVisual.dispose) {
          this.guidanceCueVisual.dispose();
        } else {
          for (const mesh of this.guidanceCueVisual.meshes) mesh.dispose();
        }
      }
      this.guidanceCueVisual =
        guidance.owner && cue
          ? this.createGuidanceCueTarget(cue, guidance.owner.kind)
          : null;
      this.guidanceCueKey = key;
    }
    if (!this.guidanceCueVisual || !cue || !guidance.owner) return;
    const enabled =
      guidance.owner.kind === "route" || guidance.status === "ready";
    for (const mesh of this.guidanceCueVisual.meshes) {
      mesh.setEnabled(enabled);
    }
  }

  private createGuidanceCueTarget(
    cue: NonNullable<SimulationSnapshot["guidance"]["cue"]>,
    ownerKind: NonNullable<SimulationSnapshot["guidance"]["owner"]>["kind"],
  ): GuidanceVisual {
    const meshes: Mesh[] = [];
    const width = resolveCheckpointTargetWidth(cue.widthM);
    const halfWidth = width / 2;
    const forward = { x: Math.sin(cue.heading), z: Math.cos(cue.heading) };
    const side = { x: forward.z, z: -forward.x };
    const point = (along: number, lateral: number): GameCanvasPoint => ({
      x: cue.x + forward.x * along + side.x * lateral,
      z: cue.z + forward.z * along + side.z * lateral,
    });
    const isRoute = ownerKind === "route";
    const gateMaterial = makeMaterial(
      this.scene,
      `guidance-${cue.id}-material`,
      isRoute ? new Color3(0.96, 0.64, 0.12) : new Color3(0.12, 0.75, 0.68),
      isRoute ? new Color3(0.23, 0.12, 0.025) : new Color3(0.025, 0.18, 0.14),
    );
    const threshold = this.createFlatSegment(
      `guidance-${cue.id}-threshold`,
      point(0, -halfWidth),
      point(0, halfWidth),
      0.16,
      0.16,
      gateMaterial,
    );
    if (threshold) meshes.push(threshold);
    for (const sideSign of [-1, 1]) {
      const upright = this.createFlatSegment(
        `guidance-${cue.id}-edge-${sideSign}`,
        point(-0.45, sideSign * halfWidth),
        point(0.45, sideSign * halfWidth),
        0.16,
        0.16,
        gateMaterial,
      );
      if (upright) meshes.push(upright);
    }
    const texture = new DynamicTexture(
      `guidance-${cue.id}-texture`,
      { width: 512, height: 128 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(8, 29, 31, 0.9)";
    context.fillRect(8, 10, 496, 108);
    context.fillStyle = isRoute ? "#ffd15b" : "#81fff0";
    context.font = "700 34px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(cue.label, 256, 64);
    texture.update(false);
    const labelMaterial = new StandardMaterial(
      `guidance-${cue.id}-label-material`,
      this.scene,
    );
    labelMaterial.diffuseTexture = texture;
    labelMaterial.opacityTexture = texture;
    labelMaterial.emissiveTexture = texture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    const labelMesh = MeshBuilder.CreatePlane(
      `guidance-${cue.id}-label`,
      { width: Math.min(2.05, width * 0.9), height: 0.48 },
      this.scene,
    );
    labelMesh.position.set(
      cue.x - forward.x * 0.44,
      0.17,
      cue.z - forward.z * 0.44,
    );
    labelMesh.rotation.x = Math.PI / 2;
    labelMesh.rotation.y = cue.heading;
    setMeshMaterial(labelMesh, labelMaterial);
    meshes.push(labelMesh);
    for (const mesh of meshes) mesh.layerMask = GUIDANCE_LAYER_MASK;
    return {
      id: cue.id,
      meshes,
      dispose: () => {
        for (const mesh of meshes) mesh.dispose();
        labelMaterial.dispose();
        texture.dispose();
        gateMaterial.dispose();
      },
    };
  }

  /**
   * The one mesh + one material behind every signal and railway lens in the
   * city. Each lens is a plain instance whose registered color buffer IS its
   * lamp state — lighting disabled, white emissive, so the shader's
   * per-instance color multiply lands the exact color written. The per-head
   * StandardMaterial clones this replaces (three per head) were ~750 unique
   * materials on the NYC grid, one draw call each.
   */
  private getSignalLensMaster(): Mesh {
    if (this.signalLensMaster) return this.signalLensMaster;
    const material = new StandardMaterial("signal-lens-material", this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    const master = MeshBuilder.CreateCylinder(
      "signal-lens-master",
      { height: 0.1, diameter: 0.25, tessellation: 18 },
      this.scene,
    );
    master.material = material;
    master.isVisible = false;
    master.isPickable = false;
    master.registerInstancedBuffer(VertexBuffer.ColorKind, 4);
    master.instancedBuffers.color = new Color4(0, 0, 0, 1);
    this.signalLensMaster = master;
    return master;
  }

  /**
   * The one hidden mesh behind every enforcement camera in the city.
   *
   * Merged down to a single mesh on a single material on purpose: Babylon
   * batches instances of one mesh into one draw call, and a MultiMaterial merge
   * would have cost one per submesh per camera instead. Sixteen cameras on the
   * New York grid are therefore one draw call, and the glass on the front is an
   * instance of the signal lens master, so it joins a batch that already exists
   * and costs nothing at all.
   *
   * Built from boxes rather than a downloaded glb: the CC0 sets have generic
   * security cameras and no enforcement camera, and an imported one would have
   * carried a licence entry, a registry entry, preload weight and an art style
   * at odds with the hand-built signal head it bolts to.
   */
  private getTrafficCameraMaster(material: StandardMaterial): Mesh | null {
    if (this.trafficCameraMaster) return this.trafficCameraMaster;
    const { housing, hood } = TRAFFIC_CAMERA_BODY;
    const parts = [
      createBox(this.scene, "traffic-camera-housing", housing, Vector3.Zero(), material),
      createBox(
        this.scene,
        "traffic-camera-hood",
        hood,
        new Vector3(0, housing.height / 2 + hood.height / 2, -0.07),
        material,
      ),
    ];
    const master = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!master) return null;
    master.name = "prop-master-traffic-camera";
    master.isVisible = false;
    master.isPickable = false;
    this.trafficCameraMaster = master;
    return master;
  }

  /** Stands a camera on `installation`, looking back down the approach it watches. */
  private buildTrafficCamera(
    controlId: string,
    installation: {
      readonly position: GameCanvasPoint;
      readonly headingDeg: number;
      readonly armHeadingDeg?: number;
      readonly mounting: string;
    },
    poleHeight: number,
    armSpanM: number,
    materials: TrafficControlMaterials,
  ) {
    const master = this.getTrafficCameraMaster(materials.dark);
    if (!master) return;
    const placement = trafficCameraPlacement(installation, poleHeight, armSpanM);
    const body = master.createInstance(`prop-traffic-camera-${controlId}`);
    body.position.set(placement.x, placement.y, placement.z);
    body.rotation.y = placement.yaw;
    body.isPickable = false;
    this.staticSceneryFreeze.push(body);
    const lens = this.getSignalLensMaster().createInstance(
      `prop-traffic-camera-${controlId}-lens`,
    );
    lens.position.set(placement.lens.x, placement.lens.y, placement.lens.z);
    lens.rotation.x = Math.PI / 2;
    lens.rotation.y = placement.yaw;
    // The master lens is 0.25 across; a camera's glass is a smaller, flatter
    // disc. Its colour is the standby glow, written once — there is no flash to
    // drive, because the citation is a toast on the HUD and a camera you have
    // already passed is behind you by the time it would fire.
    lens.scaling.set(0.62, 0.6, 0.62);
    lens.isPickable = false;
    lens.instancedBuffers.color = new Color4(0.16, 0.012, 0.01, 1);
    this.staticSceneryFreeze.push(lens);
  }

  /** A lens instance parented to `head`; returns its live color handle. */
  private createSignalLens(
    name: string,
    head: TransformNode,
    localPosition: Vector3,
    dimColor: Color4,
    scale?: Vector3,
  ): Color4 {
    const lens = this.getSignalLensMaster().createInstance(name);
    lens.parent = head;
    lens.position.copyFrom(localPosition);
    lens.rotation.x = Math.PI / 2;
    if (scale) lens.scaling.copyFrom(scale);
    lens.isPickable = false;
    lens.instancedBuffers.color = dimColor;
    return dimColor;
  }

  private createSignalHead(
    name: string,
    position: GameCanvasPoint,
    heading: number,
    height: number,
    materials: TrafficControlMaterials,
    runtime: Pick<
      AuthoredSignalHeadVisual,
      "controlId" | "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
    >,
  ) {
    const head = new TransformNode(`${name}-head`, this.scene);
    head.position.set(position.x, height, position.z);
    head.rotation.y = heading;
    if (runtime.style === "egypt_signal") {
      // Cairo's roadside signals commonly frame the black head in the same
      // high-contrast yellow used on the striped support poles.
      for (const bar of EGYPT_SIGNAL_BORDER_BARS) {
        createBox(
          this.scene,
          `${name}-egypt-frame-${bar.id}`,
          { width: bar.width, height: bar.height, depth: bar.depth },
          new Vector3(bar.x, bar.y, bar.z),
          materials.warningYellow,
          head,
        );
      }
    }
    createBox(
      this.scene,
      `${name}-housing`,
      {
        width: SIGNAL_HOUSING_BOX.width,
        height: SIGNAL_HOUSING_BOX.height,
        depth: SIGNAL_HOUSING_BOX.depth,
      },
      Vector3.Zero(),
      materials.dark,
      head,
    );
    this.authoredSignalHeads.push({
      ...runtime,
      redColor: this.createSignalLens(
        `${name}-red`,
        head,
        new Vector3(0, 0.43, -0.25),
        new Color4(0.08, 0.005, 0.005, 1),
      ),
      amberColor: this.createSignalLens(
        `${name}-amber`,
        head,
        new Vector3(0, 0, -0.25),
        new Color4(0.08, 0.04, 0.005, 1),
      ),
      greenColor: this.createSignalLens(
        `${name}-green`,
        head,
        new Vector3(0, -0.43, -0.25),
        new Color4(0.005, 0.06, 0.012, 1),
      ),
    });
  }

  private buildSignalInstallation(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    roadWidth: number,
    materials: TrafficControlMaterials,
    runtime: Pick<
      AuthoredSignalHeadVisual,
      "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
    >,
    hasCamera: boolean,
  ) {
    const headHeading = degreesToRadians(installation.headingDeg);
    const armHeading = degreesToRadians(
      installation.armHeadingDeg ?? installation.headingDeg,
    );
    const base = installation.position;
    const mastArm = installation.mounting === "mast_arm";
    const poleHeight = mastArm
      ? SIGNAL_MAST.poleHeightM
      : SIGNAL_MAST.kerbsidePoleHeightM;
    createCylinder(
      this.scene,
      `${controlId}-${installation.id}-pole`,
      {
        height: poleHeight,
        diameter: mastArm
          ? SIGNAL_MAST.poleDiameterM
          : SIGNAL_MAST.kerbsidePoleDiameterM,
        tessellation: 14,
      },
      new Vector3(base.x, poleHeight / 2, base.z),
      materials.dark,
    );
    if (runtime.style === "egypt_signal") {
      // Thin sleeves preserve the one continuous structural pole while giving
      // it Cairo's black/yellow municipal hazard striping.
      const bandHeight = 0.52;
      for (
        let band = 0;
        (band + 0.5) * bandHeight < poleHeight;
        band += 2
      ) {
        createCylinder(
          this.scene,
          `${controlId}-${installation.id}-egypt-band-${band}`,
          {
            height: bandHeight,
            diameter:
              (mastArm
                ? SIGNAL_MAST.poleDiameterM
                : SIGNAL_MAST.kerbsidePoleDiameterM) + 0.018,
            tessellation: 14,
          },
          new Vector3(
            base.x,
            (band + 0.5) * bandHeight,
            base.z,
          ),
          materials.warningYellow,
        );
      }
    }
    if (mastArm) {
      const span = Math.max(4.8, Math.min(8.5, roadWidth * 0.68));
      const sideX = Math.cos(armHeading);
      const sideZ = -Math.sin(armHeading);
      const arm = createBox(
        this.scene,
        `${controlId}-${installation.id}-mast-arm`,
        {
          width: span,
          height: SIGNAL_MAST.armThicknessM,
          depth: SIGNAL_MAST.armThicknessM,
        },
        // Hung a full thickness below the top, so its upper surface — what the
        // camera stands on — is at `mastArmTopY(poleHeight)`.
        new Vector3(
          base.x + sideX * span / 2,
          poleHeight - SIGNAL_MAST.armThicknessM,
          base.z + sideZ * span / 2,
        ),
        materials.dark,
      );
      arm.rotation.y = armHeading;
      this.createSignalHead(
        `${controlId}-${installation.id}`,
        { x: base.x + sideX * (span - 0.45), z: base.z + sideZ * (span - 0.45) },
        headHeading,
        poleHeight - 0.95,
        materials,
        { controlId, ...runtime },
      );
      if (hasCamera) {
        this.buildTrafficCamera(
          `${controlId}-${installation.id}`,
          installation,
          poleHeight,
          span,
          materials,
        );
      }
      return;
    }
    this.createSignalHead(
      `${controlId}-${installation.id}`,
      base,
      headHeading,
      poleHeight - 0.95,
      materials,
      { controlId, ...runtime },
    );
    if (hasCamera) {
      this.buildTrafficCamera(
        `${controlId}-${installation.id}`,
        installation,
        poleHeight,
        0,
        materials,
      );
    }
  }

  private buildRailwayCrossingInstallation(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    materials: TrafficControlMaterials,
    trafficLightIds: readonly string[],
  ) {
    const heading = degreesToRadians(installation.headingDeg);
    const base = installation.position;
    const poleHeight = 3.4;
    createCylinder(
      this.scene,
      `${controlId}-${installation.id}-rail-pole`,
      { height: poleHeight, diameter: 0.18, tessellation: 14 },
      new Vector3(base.x, poleHeight / 2, base.z),
      materials.dark,
    );
    const crossbuck = new TransformNode(`${controlId}-${installation.id}-crossbuck`, this.scene);
    crossbuck.position.set(base.x, 3.15, base.z);
    crossbuck.rotation.y = heading;
    for (const angle of [-0.63, 0.63]) {
      const bar = createBox(
        this.scene,
        `${controlId}-${installation.id}-crossbuck-${angle}`,
        { width: 1.6, height: 0.14, depth: 0.08 },
        Vector3.Zero(),
        materials.pale,
        crossbuck,
      );
      bar.rotation.z = angle;
    }
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const lampColors: Color4[] = [];
    for (const side of [-1, 1]) {
      const lamp = this.getSignalLensMaster().createInstance(
        `${controlId}-${installation.id}-warning-${side}`,
      );
      lamp.position.set(
        base.x + sideX * side * 0.34,
        2.38,
        base.z + sideZ * side * 0.34,
      );
      lamp.rotation.x = Math.PI / 2;
      lamp.rotation.y = heading;
      // The master lens is 0.25across x 0.1 tall; the crossing lamp is a
      // wider, slightly deeper disc.
      lamp.scaling.set(1.4, 1.1, 1.4);
      lamp.isPickable = false;
      const color = new Color4(0.08, 0.005, 0.005, 1);
      lamp.instancedBuffers.color = color;
      lampColors.push(color);
    }
    const barrierLength = 4.6;
    const barrierPivot = new TransformNode(
      `${controlId}-${installation.id}-barrier-pivot`,
      this.scene,
    );
    barrierPivot.position.set(base.x, 1.25, base.z);
    barrierPivot.rotation.y = heading;
    const barrier = createBox(
      this.scene,
      `${controlId}-${installation.id}-barrier`,
      { width: barrierLength, height: 0.14, depth: 0.14 },
      new Vector3(barrierLength / 2, 0, 0),
      materials.warningYellow,
      barrierPivot,
    );
    barrier.rotation.y = 0;
    barrierPivot.rotation.z = -1.22;
    this.railwayCrossingVisuals.push({
      trafficLightIds,
      lampColors,
      barrierPivot,
    });
  }

  private buildRoadMarkingInstallation(
    mapPack: GameCanvasMapPack,
    control: GameCanvasMapPack["laneGraph"]["controls"][number],
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    laneMaterial: StandardMaterial,
    warningMaterial: StandardMaterial,
  ) {
    if (installation.style === "crosswalk") {
      const surfacePlacement = roadSurfacePlacementForMarking(
        mapPack,
        control,
        installation,
      );
      for (const [stripe, layout] of crosswalkStripeLayout(
        surfacePlacement.position,
        installation.headingDeg,
        surfacePlacement.widthM,
      ).entries()) {
        if (!this.crosswalkStripeMaster) {
          this.crosswalkStripeMaster = MeshBuilder.CreateBox(
            "crosswalk-stripe-master",
            { width: 1, height: 0.035, depth: 1 },
            this.scene,
          );
          setMeshMaterial(this.crosswalkStripeMaster, laneMaterial);
          this.crosswalkStripeMaster.isVisible = false;
        }
        const marking = this.crosswalkStripeMaster.createInstance(
          `${control.id}-${installation.id}-stripe-${stripe}`,
        );
        marking.position.set(layout.center.x, 0.14, layout.center.z);
        marking.rotation.y = layout.rotationY;
        marking.scaling.set(layout.widthM, 1, layout.depthM);
        marking.isPickable = false;
        this.staticSceneryFreeze.push(marking);
      }
      return;
    }
    if (installation.style !== "box_junction") return;
    const zones = this.options.mapPack?.laneGraph.conflictZones ?? [];
    for (const zoneId of control.conflictZoneIds ?? []) {
      const zone = zones.find((candidate) => candidate.id === zoneId);
      if (!zone || zone.polygon.length < 3) continue;
      for (let index = 0; index < zone.polygon.length; index += 1) {
        this.createFlatSegment(
          `${control.id}-${installation.id}-box-edge-${index}`,
          zone.polygon[index],
          zone.polygon[(index + 1) % zone.polygon.length],
          0.18,
          0.145,
          warningMaterial,
        );
      }
      const minX = Math.min(...zone.polygon.map((point) => point.x));
      const maxX = Math.max(...zone.polygon.map((point) => point.x));
      const minZ = Math.min(...zone.polygon.map((point) => point.z));
      const maxZ = Math.max(...zone.polygon.map((point) => point.z));
      const span = Math.max(maxX - minX, maxZ - minZ);
      for (let offset = -span; offset <= span; offset += 3) {
        const start = { x: Math.max(minX, minX + offset), z: Math.max(minZ, minZ - offset) };
        const end = { x: Math.min(maxX, maxX + offset), z: Math.min(maxZ, maxZ - offset) };
        if (Math.hypot(end.x - start.x, end.z - start.z) > 1) {
          this.createFlatSegment(
            `${control.id}-${installation.id}-box-hatch-${offset}`,
            start,
            end,
            0.12,
            0.144,
            warningMaterial,
          );
        }
      }
    }
  }

  private buildTerminalPortal(
    controlId: string,
    installation: NonNullable<
      GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
    >[number],
    roadWidth: number,
    materials: TrafficControlMaterials,
  ) {
    const heading = degreesToRadians(installation.headingDeg);
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const span = Math.max(6, roadWidth * 0.82);
    for (const side of [-1, 1]) {
      createCylinder(
        this.scene,
        `${controlId}-${installation.id}-portal-post-${side}`,
        { height: 4.8, diameter: 0.28, tessellation: 14 },
        new Vector3(
          installation.position.x + sideX * side * span / 2,
          2.4,
          installation.position.z + sideZ * side * span / 2,
        ),
        materials.dark,
      );
    }
    const beam = createBox(
      this.scene,
      `${controlId}-${installation.id}-portal-beam`,
      { width: span + 0.3, height: 0.32, depth: 0.32 },
      new Vector3(installation.position.x, 4.65, installation.position.z),
      materials.warningYellow,
    );
    beam.rotation.y = heading;
  }

  /**
   * Camera-following gradient sky dome, distance fog matched to the horizon,
   * and a low-poly skyline ring. Both atmosphere meshes use infiniteDistance
   * so they work identically on every world size; their world matrices are
   * therefore recomputed per frame and must never be frozen.
   */
  private createSkyAndHorizon(
    palette: MapVisualPalette,
    mapId: string,
    worldSize: GameCanvasPoint,
  ) {
    const scene = this.scene;
    const horizon = Color3.FromHexString(palette.skyHorizon);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    // The night tightening lives inside resolveEffectiveFogRange so the fog
    // and the camera far plane can never disagree about where the world ends.
    const fogRange = resolveEffectiveFogRange(palette.night === true, worldSize);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = Color3.FromHexString(palette.fogColor);
    scene.fogStart = fogRange.start;
    scene.fogEnd = fogRange.end;
    // Everything past fogEnd is fully fogged, so clipping there culls the
    // rest of the city for free. Stored on the session because the cameras
    // are built after the environment; the constructor applies it to all
    // three. The sky dome and horizon ring follow the camera
    // (infiniteDistance), so their angular look is scale-invariant — shrink
    // them to sit inside the far plane instead of being clipped by it.
    this.cameraFarPlaneM = resolveCameraFarPlane(
      palette.night === true,
      worldSize,
    );
    const domeScale = Math.min(1, (this.cameraFarPlaneM * 0.98) / 950);

    const skyMaterial = new StandardMaterial("sky-dome-material", scene);
    skyMaterial.emissiveTexture = createSkyGradientTexture(scene, palette);
    skyMaterial.diffuseColor = Color3.Black();
    skyMaterial.specularColor = Color3.Black();
    skyMaterial.disableLighting = true;
    skyMaterial.fogEnabled = false;
    const skyDome = MeshBuilder.CreateSphere(
      "sky-dome",
      {
        diameter: 1900 * domeScale,
        segments: 12,
        sideOrientation: Mesh.BACKSIDE,
      },
      scene,
    );
    skyDome.material = skyMaterial;
    skyDome.infiniteDistance = true;
    skyDome.isPickable = false;
    skyDome.applyFog = false;
    skyMaterial.freeze();
    this.registerMirrorSurface(skyDome);

    const ringMaterial = new StandardMaterial("horizon-ring-material", scene);
    const silhouette = createHorizonSilhouetteTexture(scene, mapId, palette);
    // hasAlpha on the diffuse texture opts into alpha *testing*: crisp
    // silhouette edges with no blend-sorting concerns against the sky dome.
    ringMaterial.diffuseTexture = silhouette;
    ringMaterial.emissiveTexture = silhouette;
    ringMaterial.diffuseColor = Color3.Black();
    ringMaterial.specularColor = Color3.Black();
    ringMaterial.disableLighting = true;
    ringMaterial.fogEnabled = false;
    const ring = MeshBuilder.CreateCylinder(
      "horizon-ring",
      {
        height: 110 * domeScale,
        diameter: 1700 * domeScale,
        tessellation: 48,
        cap: Mesh.NO_CAP,
        sideOrientation: Mesh.BACKSIDE,
      },
      scene,
    );
    ring.material = ringMaterial;
    ring.position.y = 26 * domeScale;
    ring.infiniteDistance = true;
    ring.isPickable = false;
    ring.applyFog = false;
    ringMaterial.freeze();
    this.registerMirrorSurface(ring);
  }

  /**
   * Subtle PCF sun shadows. The render list is rebuilt around the player at
   * a slow cadence so the auto-computed directional frustum stays tight even
   * on the 3 km NYC grid.
   */
  private createSunShadows(sun: DirectionalLight) {
    sun.diffuse = Color3.FromHexString(this.visualPalette.sunTint);
    sun.position = sun.direction.scale(-260);
    sun.autoUpdateExtends = true;
    sun.autoCalcShadowZBounds = true;
    // 1024 (was 2048): the dense city re-renders this shadow map every frame,
    // so quartering its pixels frees real per-frame budget; night shadows are
    // soft + dim enough that the lower resolution isn't noticeable.
    // Percentage-closer filtering is the per-pixel cost here, and on a phone it
    // is paid on every shadowed fragment in a dense city. The softness
    // difference is invisible at a phone's viewing distance.
    const generator = new ShadowGenerator(1024, sun);
    generator.usePercentageCloserFiltering = true;
    generator.filteringQuality = this.options.inputCapabilities.touchFirst
      ? ShadowGenerator.QUALITY_LOW
      : ShadowGenerator.QUALITY_MEDIUM;
    generator.bias = 0.015;
    generator.normalBias = 0.4;
    generator.setDarkness(0.42);
    this.shadowGenerator = generator;
    this.shadowRefreshSeconds = Number.POSITIVE_INFINITY;
  }

  /**
   * The rear-view mirror, as a throttled render target on a camera-locked quad.
   *
   * It used to be a third camera rendered straight into a screen-space viewport
   * — a full extra scene pass, every frame, for a strip 23% of the screen wide.
   * A viewport camera cannot be throttled (skip a frame and the strip shows
   * whatever the main camera drew there), but a render target can: on a skipped
   * frame Babylon does nothing at all and the texture keeps its contents. That
   * is what makes a second mirror affordable.
   *
   * Deliberately no mipmaps — Babylon runs a full `gl.generateMipmap` on every
   * render otherwise, and this is sampled at roughly 1:1.
   */
  private buildRearViewMirror() {
    const scene = this.scene;
    const texture = new RenderTargetTexture(
      "rear-view-mirror",
      { width: 256, height: 160 },
      scene,
      false,
    );
    texture.activeCamera = this.rearCamera;
    texture.refreshRate = 2;
    // A supplied render list bypasses Babylon's layer-mask check unless this is
    // set, and without it the cabin would be drawn into its own mirror.
    texture.forceLayerMaskCheck = true;
    texture.clearColor = this.scene.clearColor.clone();
    texture.getCustomRenderList = () =>
      this.updateMirrorRenderList(this.rearCamera);
    texture.onAfterRenderObservable.add(() => {
      this.mirrorRenderCount += 1;
    });
    this.rearViewTexture = texture;

    // Both slots, like the number plates and the instrument cluster. Emissive
    // alone is not enough: StandardMaterial multiplies its lit result by the
    // diffuse base, so a black diffuse leaves nothing for the reflection to
    // modulate and the panel renders as its flat emissive colour.
    const material = makeMaterial(
      scene,
      "rear-view-glass",
      Color3.White(),
      new Color3(0.72, 0.72, 0.72),
    );
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.disableLighting = true;

    const panel = MeshBuilder.CreatePlane(
      "rear-view-panel",
      { width: 1, height: 1 },
      scene,
    );
    panel.parent = this.firstCamera;
    setMeshMaterial(panel, material);
    panel.layerMask = COCKPIT_LAYER_MASK;
    panel.alwaysSelectAsActiveMesh = true;
    panel.doNotSyncBoundingInfo = true;
    this.rearViewPanel = panel;
    this.layoutMirrorPanels();
  }

  /**
   * The driver's wing mirror: a stalk, a shell, and glass showing its own
   * render target.
   *
   * Unlike the rear view this is a real object out beside the door, so it moves
   * with the cabin and is framed by the field of view like anything else — and
   * at a narrow FOV it slides off the edge of the screen, at which point the
   * whole thing including its render target is switched off rather than drawn
   * as a sliver.
   *
   * Its camera looks back *and outboard*: the lane beside you is the one thing
   * the rear-view mirror cannot show, and the only reason to have this at all.
   */
  private buildWingMirror(steeringRubber: StandardMaterial, shell: StandardMaterial) {
    const scene = this.scene;
    const side = wingMirrorSide(this.options.steeringSide);
    // The rig sits at the cabin's own origin so the mount can be authored in
    // plain cockpit coordinates alongside the door and pillar it has to meet;
    // only the head is moved out to the mirror.
    const rig = new TransformNode("wing-mirror", scene);
    rig.parent = this.playerCockpit;
    this.wingMirrorRig = rig;

    const sail = createExtrudedPrism(
      scene,
      "wing-mirror-sail",
      COCKPIT_WING_MIRROR.sailThickness,
      WING_MIRROR_SAIL_PROFILE,
      steeringRubber,
      rig,
    );
    sail.position.x = side * COCKPIT_WING_MIRROR.sailX;

    // The head carries the turn toward the seat, so the shell and the glass
    // cannot come apart: both hang off it at zero rotation.
    const head = new TransformNode("wing-mirror-head", scene);
    head.parent = rig;
    head.position.set(
      side * COCKPIT_WING_MIRROR.lateral,
      COCKPIT_WING_MIRROR.y,
      COCKPIT_WING_MIRROR.z,
    );
    const headRotation = wingMirrorHeadRotation(this.options.steeringSide);
    head.rotation.set(headRotation.x, headRotation.y, 0);

    // Inboard in the head's space is -side: the yaw mirrors between drive
    // sides, so local +x points inboard on the left of the car and outboard on
    // the right. It starts inside the housing, so there is no seam where the
    // two meet, and it clears the A-pillar, which has climbed well above this
    // height by the z the arm reaches.
    createBox(
      scene,
      "wing-mirror-arm",
      {
        width: COCKPIT_WING_MIRROR.armLength,
        height: COCKPIT_WING_MIRROR.armHeight,
        depth: COCKPIT_WING_MIRROR.armDepth,
      },
      new Vector3(
        (-side * COCKPIT_WING_MIRROR.armLength) / 2,
        COCKPIT_WING_MIRROR.armLocalY,
        COCKPIT_WING_MIRROR.armLocalZ,
      ),
      shell,
      head,
    );
    // Sized to hide behind the bezel from the front while still giving the
    // housing real depth from any other angle.
    createBox(
      scene,
      "wing-mirror-shell",
      {
        width: COCKPIT_WING_MIRROR.glassWidth * 0.88,
        height: COCKPIT_WING_MIRROR.glassHeight * 0.86,
        depth: 0.055,
      },
      Vector3.Zero(),
      shell,
      head,
    );
    const outline = wingMirrorOutline(this.options.steeringSide);
    const bezelMargin = 1 + COCKPIT_WING_MIRROR.bezelMargin;
    createChamferedPanel(
      scene,
      "wing-mirror-bezel",
      outline,
      COCKPIT_WING_MIRROR.glassWidth * bezelMargin,
      COCKPIT_WING_MIRROR.glassHeight * bezelMargin,
      shell,
      head,
    ).position.z = -0.026;

    const camera = new UniversalCamera(
      "wing-mirror-camera",
      Vector3.Zero(),
      scene,
    );
    camera.inputs.clear();
    camera.minZ = 0.08;
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    camera.fov = (58 * Math.PI) / 180;
    camera.layerMask = WORLD_LAYER_MASK;
    camera.maxZ = Math.min(this.cameraFarPlaneM, MIRROR_RADIUS_M);
    this.wingMirrorCamera = camera;

    const texture = new RenderTargetTexture(
      "wing-mirror",
      { width: 192, height: 128 },
      scene,
      false,
    );
    texture.activeCamera = camera;
    // A third of the rear view's rate. It is a smaller image further into the
    // corner of the eye, and staggering the two means they never both render on
    // the same frame — otherwise frame times spike in lockstep instead of
    // staying flat, which is worse than either cost on its own.
    texture.refreshRate = 3;
    texture.forceLayerMaskCheck = true;
    texture.clearColor = this.scene.clearColor.clone();
    texture.getCustomRenderList = () => this.updateMirrorRenderList(camera);
    this.wingMirrorTexture = texture;

    const glassMaterial = makeMaterial(
      scene,
      "wing-mirror-glass",
      Color3.White(),
      new Color3(0.62, 0.62, 0.62),
    );
    glassMaterial.diffuseTexture = texture;
    glassMaterial.emissiveTexture = texture;
    glassMaterial.disableLighting = true;

    const glass = createChamferedPanel(
      scene,
      "wing-mirror-glass",
      outline,
      COCKPIT_WING_MIRROR.glassWidth,
      COCKPIT_WING_MIRROR.glassHeight,
      glassMaterial,
      head,
    );
    glass.position.z = -0.029;
  }

  /** Hides the wing mirror, and stops rendering it, when the field of view has
   * pushed it off the side of the screen. */
  private syncWingMirrorVisibility() {
    const rig = this.wingMirrorRig;
    if (!rig) return;
    const visible = wingMirrorIsVisible(
      this.firstCamera.fov,
      this.options.steeringSide,
    );
    if (rig.isEnabled(false) !== visible) rig.setEnabled(visible);
  }

  /**
   * Sizes the mirror quad to the viewport rectangle it stands in for.
   *
   * Must run whenever the field of view or the canvas shape changes, or the
   * image slides out from under the HUD housing drawn around it.
   */
  private layoutMirrorPanels() {
    const panel = this.rearViewPanel;
    if (!panel) return;
    const distance = this.firstCamera.minZ * 3;
    const placement = cameraPanelPlacement(
      REAR_VIEW_VIEWPORT,
      this.firstCamera.fov,
      this.viewportAspectRatio(),
      distance,
    );
    panel.scaling.set(placement.width, placement.height, 1);
    panel.position.set(placement.x, placement.y, distance);
    this.syncWingMirrorVisibility();
  }

  private viewportAspectRatio(): number {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    return height > 0 ? width / height : 2;
  }

  /**
   * Re-gathers the ring of static meshes a mirror could possibly see.
   *
   * Amortised: only when the player has covered ground or swung round a
   * junction. The result is a candidate set of a few hundred, which
   * `updateMirrorRenderList` then frustum-tests per render.
   */
  private refreshMirrorCandidates() {
    const heading = this.displayedHeading;
    if (
      !mirrorCandidatesAreStale(
        this.mirrorGatheredX,
        this.mirrorGatheredZ,
        this.displayedX,
        this.displayedZ,
        heading - this.mirrorGatheredHeading,
      )
    ) {
      return;
    }
    this.mirrorGatheredX = this.displayedX;
    this.mirrorGatheredZ = this.displayedZ;
    this.mirrorGatheredHeading = heading;
    this.mirrorCandidates.length = 0;
    // One cone wide enough to cover every mirror on the car, rather than a ring
    // per mirror: the gather is the expensive half and the frustum test below
    // is what actually decides. A car's mirrors all point broadly backwards.
    const cells = mirrorCells(BabylonGameSession.SHADOW_CELL_M, {
      x: this.displayedX,
      z: this.displayedZ,
      dirX: -Math.sin(heading),
      dirZ: -Math.cos(heading),
      halfAngleRad: (105 * Math.PI) / 180,
      radiusM: MIRROR_RADIUS_M,
    });
    for (const cell of cells) {
      const bucket = this.shadowCasterCells.get(`${cell.cellX}:${cell.cellZ}`);
      if (!bucket) continue;
      for (const entry of bucket) this.mirrorCandidates.push(entry.mesh);
    }
  }

  /**
   * Rebuilds what a mirror actually draws, in place.
   *
   * Babylon's ObjectRenderer frustum-culls nothing — it draws whatever list it
   * is handed — so this does the job `Scene._evaluateActiveMeshes` does for a
   * real camera, but over a few hundred pre-gathered candidates instead of the
   * fifteen thousand meshes in the city. That difference is the entire reason a
   * mirror can be a render target here rather than a second full scene pass.
   */
  private updateMirrorRenderList(camera: UniversalCamera): AbstractMesh[] {
    this.refreshMirrorCandidates();
    const list = this.mirrorRenderList;
    list.length = 0;
    for (const mesh of this.mirrorAlways) list.push(mesh);
    camera.computeWorldMatrix();
    const planes = Frustum.GetPlanes(
      camera.getViewMatrix().multiply(camera.getProjectionMatrix(true)),
    );
    for (const mesh of this.mirrorCandidates) {
      if (!mesh.isEnabled()) continue;
      if (mesh.isInFrustum(planes)) list.push(mesh);
    }
    if (this.playerVehicleVisual) {
      for (const mesh of this.playerVehicleVisual.shadowCasters) list.push(mesh);
    }
    for (const npc of this.npcVehicles) {
      if (npc.active === false) continue;
      for (const mesh of npc.visual.shadowCasters) {
        if (mesh.isInFrustum(planes)) list.push(mesh);
      }
    }
    return list;
  }

  /** Static casters never move again, so their world matrices freeze here. */
  private registerShadowCaster(mesh: AbstractMesh, x: number, z: number) {
    this.registerStaticCell(mesh, x, z, true);
  }

  /**
   * Files a static mesh into the spatial hash both the shadow ring and the
   * mirror ring read.
   *
   * `castsShadow` is false for things the mirror wants but the sun pass
   * deliberately skips — the instanced NYC buildings and the junction fills.
   * Flipping one of those to true would silently add it to the shadow map and
   * change both the look and the cost of every camera, which is why the flag is
   * explicit rather than inferred.
   */
  private registerStaticCell(
    mesh: AbstractMesh,
    x: number,
    z: number,
    castsShadow: boolean,
  ) {
    mesh.freezeWorldMatrix();
    const cell = BabylonGameSession.SHADOW_CELL_M;
    const key = `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
    let bucket = this.shadowCasterCells.get(key);
    if (!bucket) {
      bucket = [];
      this.shadowCasterCells.set(key, bucket);
    }
    bucket.push({ mesh, x, z, castsShadow });
  }

  /**
   * A surface too large for any spatial cull to reject — road strips that run
   * the length of an avenue, the merged lane paint, the ground, the sky.
   * There are about twenty of these in NYC, so they simply always render.
   */
  /**
   * Multiplies a second, much finer grass tile over a grass material so the
   * base tile stops reading as a grid. One shared `DynamicTexture` per session
   * — `detailMap.texture` is only a reference, and a 256² canvas per lawn would
   * be pure waste.
   *
   * **`DetailMapConfiguration` is a `MaterialPluginBase`, so it adds a shader
   * define**: every material that enables it costs one more effect compile at
   * scene warm-up. Keep the number of materials that call this small, and note
   * that it is off entirely on low-spec devices, where the render scale throws
   * the detail away before the player could see it.
   */
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
  private getParkLawnMaterial(
    palette: MapVisualPalette,
    mapId: string,
  ): StandardMaterial {
    if (this.parkLawnMaterial) return this.parkLawnMaterial;
    const material = makeMaterial(this.scene, "park-lawn", Color3.White());
    material.diffuseTexture = createGrassTexture(
      this.scene,
      "park-lawn-texture",
      palette,
      hashStringToSeed(`${mapId}-park-lawn`),
      !this.lowSpec,
    );
    this.applyGrassDetailMap(material, mapId);
    this.parkLawnMaterial = material;
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
  private buildParkLawn(
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
      this.scene,
    );
    lawn.position.set(landmark.center.x, PARK_LAWN_Y, landmark.center.z);
    if (landmark.headingDeg !== undefined) {
      lawn.rotation.y = degreesToRadians(landmark.headingDeg);
    }
    // `CreateGround` emits local positions, so the park's own centre has to be
    // folded in or every park restarts the tile at its own corner and shows a
    // seam against the ground plane.
    this.applyWorldPlanarGrassUVs(lawn, landmark.center.x, landmark.center.z);
    setMeshMaterial(lawn, this.getParkLawnMaterial(palette, mapId), true);
    lawn.freezeWorldMatrix();
    // Too large for any spatial cull to reject — Central Park is 2.9 km long,
    // which is the case `registerMirrorSurface` exists for.
    this.registerMirrorSurface(lawn);
    return lawn;
  }

  /**
   * A flat ground polygon at `y`, ear-clipped, with world-planar UVs — the
   * shared builder behind Tahrir's clipped lawn and its forecourt esplanade.
   * The outline is already in world space, so the UVs come straight off the
   * positions with no centre shift — the counterpart of the offset
   * `applyWorldPlanarGrassUVs` needs for `CreateGround`.
   */
  private buildFlatPolygonMesh(
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
    const mesh = new Mesh(id, this.scene);
    data.applyToMesh(mesh);
    setMeshMaterial(mesh, material, true);
    mesh.freezeWorldMatrix();
    this.registerMirrorSurface(mesh);
    return mesh;
  }

  /**
   * A park lawn with an arbitrary outline, for the one park a road is
   * authored straight through (`cairoTahrirLawnPolygon` explains the cut).
   * Same material and world-anchored grass tile as `buildParkLawn`.
   */
  private buildParkLawnPolygon(
    id: string,
    polygon: readonly GameCanvasPoint[],
    palette: MapVisualPalette,
    mapId: string,
  ): Mesh | undefined {
    return this.buildFlatPolygonMesh(
      id,
      polygon,
      PARK_LAWN_Y,
      this.getParkLawnMaterial(palette, mapId),
    );
  }

  /** The gravel tile shared by walk, crossing and court materials. */
  private ensureParkPathTexture(palette: MapVisualPalette, mapId: string) {
    if (!this.parkPathTexture) {
      this.parkPathTexture = createAsphaltTexture(
        this.scene,
        "park-path-texture",
        // Pale gravel, not tarmac: a park walk is a hoggin or stone-dust
        // path everywhere this game is set.
        mixHexColors(palette.dirtShoulder, "#e8e2d2", 0.55),
        hashStringToSeed(`${mapId}-park-path`),
      );
    }
    return this.parkPathTexture;
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
  private buildParkFeatures(
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    mapPack: GameCanvasMapPack,
    palette: MapVisualPalette,
    mapId: string,
  ) {
    const layout = parkLayoutForLandmark(mapPack, landmark);

    if (layout.paths.length) {
      if (!this.parkPathMaterial || !this.parkPathCrossMaterial) {
        const texture = this.ensureParkPathTexture(palette, mapId);
        const material = makeMaterial(this.scene, "park-path", Color3.White());
        material.diffuseTexture = texture;
        material.zOffsetUnits = PARK_PATH_Z_OFFSET_UNITS;
        this.parkPathMaterial = material;
        // Two walks of one park may cross at the same y; the deeper tier
        // decides the winner where height cannot.
        const crossing = makeMaterial(
          this.scene,
          "park-path-crossing",
          Color3.White(),
        );
        crossing.diffuseTexture = texture;
        crossing.zOffsetUnits = PARK_PATH_CROSS_Z_OFFSET_UNITS;
        this.parkPathCrossMaterial = crossing;
      }
      for (const path of layout.paths) {
        const mesh = this.createRoadSurfaceMesh(
          `${landmark.id}-path-${path.id}`,
          path.points,
          path.widthM,
          path.id.startsWith("cross")
            ? this.parkPathCrossMaterial
            : this.parkPathMaterial,
          false,
          PARK_PATH_Y,
        );
        if (!mesh) continue;
        mesh.isPickable = false;
        this.registerStaticCell(mesh, landmark.center.x, landmark.center.z, false);
      }
    }

    this.buildParkBespokeFeatures(
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
    if (!this.parkWallMaterial) {
      this.parkWallMaterial = makeMaterial(
        this.scene,
        "park-wall",
        colorFromHex(
          mixHexColors(palette.pavement ?? palette.dirtShoulder, "#e6ded0", 0.4),
          new Color3(0.62, 0.6, 0.55),
        ),
      );
    }
    for (const run of layout.wall) {
      const wall = createBox(
        this.scene,
        run.id,
        {
          width: run.halfU * 2,
          height: PARK_WALL_HEIGHT_M,
          depth: run.halfV * 2,
        },
        new Vector3(run.x, PARK_WALL_HEIGHT_M / 2, run.z),
        this.parkWallMaterial,
      );
      wall.rotation.y = boxLengthYaw(run.ux, run.uz);
      wall.isPickable = false;
      this.registerShadowCaster(wall, run.x, run.z);
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
  private buildParkBespokeFeatures(
    landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
    features: readonly ParkFeature[],
    palette: MapVisualPalette,
    mapId: string,
    roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
  ) {
    if (!features.length) return;
    const scene = this.scene;
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
          this.applyWorldPlanarGrassUVs(patch, feature.x, feature.z);
          if (!this.parkCourtMaterial) {
            const court = makeMaterial(scene, "park-court", Color3.White());
            court.diffuseTexture = this.ensureParkPathTexture(palette, mapId);
            court.zOffsetUnits = PARK_BED_Z_OFFSET_UNITS;
            this.parkCourtMaterial = court;
          }
          setMeshMaterial(patch, this.parkCourtMaterial, true);
          patch.isPickable = false;
          this.registerStaticCell(patch, feature.x, feature.z, false);
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
          if (!this.parkBedMaterial) {
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
            this.parkBedMaterial = bedMaterial;
          }
          const bed = this.buildFlatPolygonMesh(
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
            this.parkBedMaterial,
          );
          if (bed) {
            bed.isPickable = false;
            this.registerStaticCell(bed, feature.x, feature.z, false);
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
          this.registerStaticCell(disc, feature.x, feature.z, false);
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
            this.registerShadowCaster(column, feature.x, feature.z);
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
            this.registerShadowCaster(beam, feature.x, feature.z);
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
            this.registerShadowCaster(block, feature.x, feature.z);
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
          this.registerShadowCaster(base, feature.x, feature.z);
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
          this.registerShadowCaster(shaft, feature.x, feature.z);
          break;
        }
      }
    }
  }

  private applyGrassDetailMap(material: StandardMaterial, mapId: string) {
    if (this.lowSpec) return;
    if (!this.grassDetailTexture) {
      const texture = createGrassDetailTexture(
        this.scene,
        "grass-detail-texture",
        hashStringToSeed(`${mapId}-grass-detail`),
      );
      // One repeat of the BASE tile spans one UV unit (every grass surface is
      // given world-planar UVs at 1/GRASS_TILE_M), so the detail scale is a
      // single ratio shared by every caller — which is what lets one texture
      // object serve them all. Per-mesh uScale would need a texture per mesh.
      texture.uScale = GRASS_TILE_M / GRASS_DETAIL_TILE_M;
      texture.vScale = texture.uScale;
      this.grassDetailTexture = texture;
    }
    material.detailMap.texture = this.grassDetailTexture;
    material.detailMap.diffuseBlendLevel = 0.22;
    material.detailMap.isEnabled = true;
  }

  /**
   * Rewrites a ground mesh's UVs from unit-square to world-planar, so the tile
   * is anchored to the world rather than to the mesh. Two things depend on it:
   * a park lawn tiles continuously with the ground plane it sits on instead of
   * showing a seam at its edge, and every grass surface then shares one UV
   * convention, which is what makes a single shared detail texture possible.
   *
   * `CreateGround` emits local positions, so a lawn that has been moved to its
   * park centre must pass that offset — otherwise each park restarts the tile
   * at its own corner and the seam comes straight back.
   */
  private applyWorldPlanarGrassUVs(mesh: Mesh, offsetX = 0, offsetZ = 0) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;
    const shifted = Array.from(positions);
    for (let index = 0; index + 2 < shifted.length; index += 3) {
      shifted[index] += offsetX;
      shifted[index + 2] += offsetZ;
    }
    mesh.setVerticesData(
      VertexBuffer.UVKind,
      buildPlanarUVs(shifted, 1 / GRASS_TILE_M),
    );
  }

  private registerMirrorSurface(mesh: AbstractMesh | undefined | null) {
    if (mesh) this.mirrorAlways.push(mesh);
  }

  private static readonly SHADOW_CASTER_RADIUS_M = 90;
  private static readonly SHADOW_CELL_M = 45;
  /** Distance the player must cover before the static sublist re-gathers. */
  private static readonly SHADOW_STATIC_REARM_M = 20;

  private refreshShadowCasters() {
    const shadowMap = this.shadowGenerator?.getShadowMap();
    if (!shadowMap) return;
    const radius = BabylonGameSession.SHADOW_CASTER_RADIUS_M;
    // Static casters re-gather only after real movement: within the 20m
    // rearm the anchored ring is off by at most 20m at the 90m boundary,
    // which fog and shadow softness swallow. Vehicle casters below refresh
    // on every 0.5s tick regardless, so a car pulling up never lacks its
    // shadow for long.
    if (
      Math.hypot(
        this.displayedX - this.shadowStaticAnchorX,
        this.displayedZ - this.shadowStaticAnchorZ,
      ) >= BabylonGameSession.SHADOW_STATIC_REARM_M
    ) {
      this.shadowStaticAnchorX = this.displayedX;
      this.shadowStaticAnchorZ = this.displayedZ;
      this.shadowStaticList.length = 0;
      const cell = BabylonGameSession.SHADOW_CELL_M;
      const minCellX = Math.floor((this.displayedX - radius) / cell);
      const maxCellX = Math.floor((this.displayedX + radius) / cell);
      const minCellZ = Math.floor((this.displayedZ - radius) / cell);
      const maxCellZ = Math.floor((this.displayedZ + radius) / cell);
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
          const bucket = this.shadowCasterCells.get(`${cellX}:${cellZ}`);
          if (!bucket) continue;
          for (const caster of bucket) {
            if (!caster.castsShadow) continue;
            if (
              Math.hypot(
                caster.x - this.displayedX,
                caster.z - this.displayedZ,
              ) <= radius
            ) {
              this.shadowStaticList.push(caster.mesh);
            }
          }
        }
      }
    }
    const list = this.shadowRenderList;
    list.length = 0;
    if (this.playerVehicleVisual) {
      list.push(...this.playerVehicleVisual.shadowCasters);
    } else {
      list.push(...this.playerExterior.getChildMeshes());
    }
    for (const npc of this.npcVehicles) {
      if (npc.active === false) continue;
      const position = npc.node.position;
      if (Math.hypot(position.x - this.displayedX, position.z - this.displayedZ) > radius) {
        continue;
      }
      list.push(...npc.visual.shadowCasters);
    }
    for (const mesh of this.shadowStaticList) list.push(mesh);
    shadowMap.renderList = list;
  }

  /**
   * Subtle full-screen grade: bloom limited to emissives, gentle contrast,
   * a soft multiply vignette and mild saturation. The rear mirror camera is
   * deliberately excluded so the mirror stays cheap and never shows a
   * vignette-in-a-mirror artefact; with image processing running as a
   * post-process the mirror renders slightly flatter, which is acceptable.
   * Both driving cameras stay attached for the session's lifetime, so
   * toggling scene.activeCameras needs no pipeline mutation.
   */
  private createEffectsPipeline() {
    const pipeline = new DefaultRenderingPipeline(
      "sideswap-fx",
      false,
      this.scene,
      [this.thirdCamera, this.firstCamera],
    );
    // The pipeline renders through an offscreen target, bypassing the
    // engine-level MSAA; re-enable multisampling on that target instead.
    //
    // Not on touch. 4x MSAA multiplies the cost of every pixel, and a mobile
    // GPU would rather spend that on having more of them: FXAA at a real
    // resolution beats MSAA at a fraction of one, especially for a low-poly
    // city that is mostly long straight edges — kerbs, lane paint, rooflines.
    // On desktop the sample count follows the buffer: at ~2560 wide (the
    // width-capped 4K case) 2x resolves what 4x resolved at laptop sizes,
    // for half the multisample cost. getRenderWidth is post-scaling — the
    // level was set at engine construction, before this runs.
    const touchFirst = this.options.inputCapabilities.touchFirst;
    pipeline.samples = touchFirst
      ? 1
      : this.engine.getRenderWidth() >= 2400
        ? 2
        : 4;
    pipeline.fxaaEnabled = touchFirst;
    pipeline.bloomEnabled = true;
    // Bloom stays keyed to bright emissives (lamps, brake lights); the
    // threshold is lifted alongside tone mapping so the newly warm, brighter
    // sky and sunlit surfaces don't bloom into a haze. A night city leans on
    // bloom harder — lower threshold + more weight so lit windows, streetlights
    // and signage bloom into a glowing skyline.
    const night = this.visualPalette?.night ?? false;
    // Softer night bloom (higher threshold, lower weight): the warm lights glow
    // rather than blowing out to white.
    pipeline.bloomThreshold = night ? 0.72 : 0.9;
    pipeline.bloomWeight = night ? 0.3 : 0.18;
    pipeline.bloomScale = 0.5;
    pipeline.bloomKernel = night ? 64 : 48;
    pipeline.imageProcessingEnabled = true;
    const imageProcessing = pipeline.imageProcessing;
    // ACES filmic tone mapping is the core of the "cinematic" look: it
    // compresses the warm sky and strengthened sun into a rich, non-blown-out
    // image instead of the flat, clipped WebGL default. Exposure is lifted to
    // compensate for the filmic curve's mid-tone rolloff.
    imageProcessing.toneMappingEnabled = true;
    imageProcessing.toneMappingType =
      ImageProcessingConfiguration.TONEMAPPING_ACES;
    imageProcessing.contrast = 1.12;
    // Lift night exposure so the road + car read clearly under the dark sky.
    imageProcessing.exposure = night ? 1.55 : 1.2;
    imageProcessing.vignetteEnabled = true;
    imageProcessing.vignetteWeight = 0.9;
    imageProcessing.vignetteColor = new Color4(0.03, 0.02, 0, 0);
    imageProcessing.vignetteBlendMode =
      ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    const curves = new ColorCurves();
    curves.globalSaturation = 22;
    curves.highlightsHue = 30;
    curves.highlightsDensity = 15;
    curves.highlightsSaturation = 10;
    imageProcessing.colorCurves = curves;
    imageProcessing.colorCurvesEnabled = true;
    this.effectsPipeline = pipeline;
  }

  private buildEnvironment() {
    if (this.options.mapPack && this.options.lesson) {
      this.buildScenarioEnvironment(this.options.mapPack);
      return;
    }
    const scene = this.scene;
    const yardPalette = resolveMapVisualPalette("orientation-yard");
    this.visualPalette = yardPalette;
    this.createSkyAndHorizon(yardPalette, "orientation-yard", { x: 180, z: 180 });
    const grass = makeMaterial(scene, "grass", Color3.White());
    const yardGrassTexture = createGrassTexture(
      scene,
      "yard-grass-texture",
      yardPalette,
      hashStringToSeed("yard-grass"),
      !this.lowSpec,
    );
    yardGrassTexture.uScale = 180 / GRASS_TILE_M;
    yardGrassTexture.vScale = 180 / GRASS_TILE_M;
    grass.diffuseTexture = yardGrassTexture;
    // Yard roads are stretched boxes whose 0..1 face UVs would smear a wear
    // texture across their full length; the yard keeps clean flat asphalt.
    const asphalt = makeMaterial(scene, "asphalt", new Color3(0.21, 0.24, 0.26));
    const paleAsphalt = makeMaterial(scene, "junction-asphalt", new Color3(0.25, 0.28, 0.3));
    const white = makeMaterial(scene, "road-white", new Color3(0.88, 0.87, 0.76));
    const yellow = makeMaterial(scene, "road-yellow", new Color3(0.96, 0.67, 0.13));
    const curb = makeMaterial(scene, "curb", new Color3(0.62, 0.64, 0.61));
    const trunk = makeMaterial(scene, "tree-trunk", new Color3(0.3, 0.19, 0.1));
    const leaves = makeMaterial(scene, "tree-leaves", new Color3(0.12, 0.32, 0.16));
    const lampDark = makeMaterial(scene, "lamp-dark", new Color3(0.08, 0.1, 0.1));
    const redLamp = makeMaterial(
      scene,
      "signal-red",
      new Color3(0.5, 0.03, 0.02),
      new Color3(0.35, 0.01, 0.01),
    );
    const greenLamp = makeMaterial(
      scene,
      "signal-green",
      new Color3(0.03, 0.42, 0.15),
      new Color3(0.01, 0.18, 0.04),
    );
    const amberLamp = makeMaterial(
      scene,
      "signal-amber",
      new Color3(0.58, 0.3, 0.02),
      new Color3(0.08, 0.04, 0.005),
    );
    this.signalRedMaterial = redLamp;
    this.signalAmberMaterial = amberLamp;
    this.signalGreenMaterial = greenLamp;

    const hemi = new HemisphericLight("soft-sky", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.5;
    hemi.diffuse = new Color3(0.82, 0.88, 0.98);
    hemi.groundColor = new Color3(0.34, 0.3, 0.24);
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.55), scene);
    sun.intensity = 1.3;
    this.createSunShadows(sun);

    const ground = MeshBuilder.CreateGround(
      "training-ground",
      { width: 180, height: 180, subdivisions: 1 },
      scene,
    );
    setMeshMaterial(ground, grass, true);
    createBox(scene, "main-road", { width: 13, height: 0.08, depth: 170 }, new Vector3(0, 0.04, 4), asphalt).receiveShadows = true;
    createBox(scene, "cross-road", { width: 100, height: 0.09, depth: 13 }, new Vector3(0, 0.05, 0), paleAsphalt).receiveShadows = true;

    const roundaboutRoad = MeshBuilder.CreateTorus(
      "roundabout-road",
      { diameter: 17, thickness: 5.6, tessellation: 40 },
      scene,
    );
    roundaboutRoad.position.set(0, 0.05, 32);
    roundaboutRoad.scaling.y = 0.025;
    setMeshMaterial(roundaboutRoad, asphalt);
    createCylinder(scene, "roundabout-island", { height: 0.34, diameter: 10.5, tessellation: 24 }, new Vector3(0, 0.18, 32), grass);
    createCylinder(scene, "roundabout-curb", { height: 0.18, diameter: 11.3, tessellation: 24 }, new Vector3(0, 0.09, 32), curb);
    createCylinder(scene, "roundabout-grass", { height: 0.22, diameter: 10.3, tessellation: 24 }, new Vector3(0, 0.22, 32), grass);

    for (let z = -74; z <= 82; z += 8) {
      if (z > 21 && z < 43) continue;
      createBox(scene, `center-dash-${z}`, { width: 0.14, height: 0.03, depth: 4 }, new Vector3(0, 0.105, z), white);
    }
    for (let x = -45; x <= 45; x += 8) {
      if (Math.abs(x) < 8) continue;
      createBox(scene, `cross-dash-${x}`, { width: 4, height: 0.03, depth: 0.14 }, new Vector3(x, 0.11, 0), white);
    }
    for (const side of [-1, 1]) {
      createBox(scene, `edge-${side}`, { width: 0.16, height: 0.025, depth: 168 }, new Vector3(side * 6.15, 0.105, 4), white);
    }
    if (this.options.trafficSide === "right") {
      createBox(scene, "jurisdiction-line", { width: 0.12, height: 0.035, depth: 168 }, new Vector3(-0.18, 0.11, 4), yellow);
    }

    for (let x = -5; x <= 5; x += 1.45) {
      createBox(scene, `crosswalk-${x}`, { width: 0.75, height: 0.035, depth: 3.2 }, new Vector3(x, 0.12, 4.5), white);
    }
    createBox(scene, "stop-line", { width: 5.8, height: 0.04, depth: 0.32 }, new Vector3(this.options.trafficSide === "right" ? 3 : -3, 0.125, -4), white);

    for (const x of [-8, 8]) {
      const pole = createCylinder(scene, `signal-pole-${x}`, { height: 4.6, diameter: 0.19 }, new Vector3(x, 2.3, -5), lampDark);
      const box = createBox(scene, `signal-box-${x}`, { width: 0.7, height: 1.75, depth: 0.55 }, new Vector3(0, 1.5, 0), lampDark, pole);
      createCylinder(scene, `red-${x}`, { height: 0.12, diameter: 0.31 }, new Vector3(0, 0.45, -0.31), redLamp, box).rotation.x = Math.PI / 2;
      createCylinder(scene, `green-${x}`, { height: 0.12, diameter: 0.31 }, new Vector3(0, -0.45, -0.31), greenLamp, box).rotation.x = Math.PI / 2;
    }

    const buildingColors = [
      new Color3(0.72, 0.42, 0.31),
      new Color3(0.72, 0.67, 0.51),
      new Color3(0.35, 0.53, 0.59),
      new Color3(0.57, 0.43, 0.61),
    ];
    const skylineEmissive = makeFacadeEmissiveTexture(scene);
    const skylineMaterials = buildingColors.map((color, index) =>
      makeFacadeMaterial(scene, `skyline-facade-${index}`, color, skylineEmissive),
    );
    for (let index = 0; index < 24; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -68 + Math.floor(index / 2) * 13;
      const height = 6 + ((index * 7) % 9);
      const buildingX = side * (13 + (index % 3) * 2);
      this.registerShadowCaster(
        createFacadeBox(
          scene,
          `building-${index}`,
          { width: 8 + (index % 3), height, depth: 8 },
          new Vector3(buildingX, height / 2, z),
          skylineMaterials[index % skylineMaterials.length],
        ),
        buildingX,
        z,
      );
    }

    for (let index = 0; index < 18; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -70 + index * 8.5;
      const tree = new TransformNode(`tree-${index}`, scene);
      tree.position.set(side * 8.7, 0, z);
      this.registerShadowCaster(
        createCylinder(scene, `trunk-${index}`, { height: 2, diameterTop: 0.27, diameterBottom: 0.39 }, new Vector3(0, 1, 0), trunk, tree),
        side * 8.7,
        z,
      );
      this.registerShadowCaster(
        createIcoSphere(scene, `crown-${index}`, 1.7, new Vector3(0, 2.94, 0), leaves, tree),
        side * 8.7,
        z,
      );
      createIcoSphere(scene, `crown-b-${index}`, 1.15, new Vector3(0.71, 3.79, -0.31), leaves, tree);
      createIcoSphere(scene, `crown-c-${index}`, 1, new Vector3(-0.77, 3.42, 0.51), leaves, tree);
    }
  }

  private buildPlayerCar() {
    const scene = this.scene;
    // A two-wheeler day builds no car body at all: the composed rider rig
    // arrives with the model upgrade pass (the glbs must be preloaded first),
    // and until then the player node is simply empty behind the loading gate.
    if ((this.options.playerVehicle?.visualKind ?? "car") === "car") {
      this.playerVehicleVisual = createVehicleMesh(
        scene,
        this.playerExterior,
        "player",
        resolvePlayerVehicleAppearance(
          this.options.mapPack?.id ?? "orientation-yard",
          this.options.playerVehicle,
        ),
      );
    }
    this.buildCockpit();
  }

  /**
   * The first-person interior.
   *
   * Built unconditionally, even on a bicycle day where it is never shown, and
   * hung off `playerCockpit` — which `applyCameraStack` enables only in first
   * person. Layout lives in `cockpitLayout`; this method is only the
   * translation from those numbers into meshes.
   */
  private buildCockpit() {
    const scene = this.scene;
    const bodyDark = makeMaterial(scene, "player-blue-dark", new Color3(0.04, 0.23, 0.3));
    // A cabin is a lit room, not a silhouette. These sit an order of magnitude
    // above where they used to, because the old values were tuned as if the
    // dash were part of the night outside — the emissive term is a floor that
    // keeps surfaces legible through the pipeline's vignette, which lands
    // squarely on the lower half of the frame where the cockpit is. All of them
    // stay well under `bloomThreshold` (0.72 at night); only the gauge accents
    // are allowed anywhere near it.
    // A cabin needs a big ambient floor after dark and almost none at noon.
    // Diffuse is the term the sun multiplies, and the sun runs at 1.3 by day
    // against 0.6 at night, while ambient and emissive are flat in both — so a
    // single palette is either unreadable in New York or bleached in London.
    // Pick per map, the way the building night glow already does.
    // The numbers below are the night values; daylight scales all three down,
    // because by day the sun does the work and the same floor that rescues a
    // New York cabin bleaches a London one to flat beige.
    const night = this.visualPalette?.night ?? false;
    const toneScale = night ? 1 : 0.73;
    const ambientFloor = night ? 0.6 : 0.3;
    const glowScale = night ? 1 : 0.5;
    const surface = (r: number, g: number, b: number) =>
      new Color3(r * toneScale, g * toneScale, b * toneScale);
    const lit = (r: number, g: number, b: number) =>
      new Color3(r * glowScale, g * glowScale, b * glowScale);
    const steeringRubber = makeInteriorMaterial(
      scene,
      "steering-rubber",
      surface(0.105, 0.097, 0.09),
      lit(0.02, 0.019, 0.017),
      ambientFloor * 0.72,
    );
    const dash = makeInteriorMaterial(
      scene,
      "dashboard",
      surface(0.275, 0.253, 0.229),
      lit(0.038, 0.035, 0.031),
      ambientFloor,
    );
    const cockpitTrim = makeInteriorMaterial(
      scene,
      "cockpit-trim",
      surface(0.335, 0.31, 0.281),
      lit(0.044, 0.04, 0.035),
      ambientFloor,
    );
    const instrumentFace = makeInteriorMaterial(
      scene,
      "instrument-face",
      new Color3(0.045, 0.055, 0.062),
      new Color3(0.02, 0.032, 0.038),
      0.3,
    );
    const instrumentGlow = makeInteriorMaterial(
      scene,
      "instrument-glow",
      new Color3(0.08, 0.4, 0.38),
      new Color3(0.05, 0.28, 0.26),
      0.3,
    );
    const ventShadow = makeInteriorMaterial(
      scene,
      "cockpit-vent-shadow",
      new Color3(0.028, 0.026, 0.024),
      undefined,
      0.15,
    );
    createBox(scene, "cockpit-hood", { width: 1.62, height: 0.045, depth: 0.42 }, new Vector3(0, 0.74, 1.55), bodyDark, this.playerCockpit);
    createExtrudedPrism(
      scene,
      "cockpit-dash-shell",
      COCKPIT_CABIN_WIDTH,
      COCKPIT_DASH_PROFILE,
      dash,
      this.playerCockpit,
    );
    createBox(scene, "cockpit-dash-trim", { width: 1.78, height: 0.014, depth: 0.02 }, new Vector3(0, 0.948, 0.354), cockpitTrim, this.playerCockpit);
    createBox(scene, "windshield-sill", { width: COCKPIT_CABIN_WIDTH, height: 0.028, depth: 0.09 }, new Vector3(0, 1.155, 0.985), cockpitTrim, this.playerCockpit);
    for (const side of [-1, 1]) {
      createBox(
        scene,
        `cockpit-door-beltline-${side}`,
        { width: 0.12, height: 0.11, depth: 1.12 },
        new Vector3(side * 0.94, 0.82, 0.12),
        cockpitTrim,
        this.playerCockpit,
      );
      const doorCard = createExtrudedPrism(
        scene,
        `cockpit-door-card-${side}`,
        0.05,
        COCKPIT_DOOR_PROFILE,
        dash,
        this.playerCockpit,
      );
      doorCard.position.x = side * COCKPIT_DOOR_X;
      const pillar = createExtrudedPrism(
        scene,
        `cockpit-a-pillar-${side}`,
        COCKPIT_PILLAR_THICKNESS,
        COCKPIT_PILLAR_PROFILE,
        cockpitTrim,
        this.playerCockpit,
      );
      pillar.position.x = side * COCKPIT_PILLAR_X;
      createBox(
        scene,
        `cockpit-sun-visor-${side}`,
        { width: 0.44, height: 0.022, depth: 0.19 },
        new Vector3(side * 0.4, 1.652, 0.612),
        cockpitTrim,
        this.playerCockpit,
      ).rotation.x = -0.42;
    }
    createExtrudedPrism(
      scene,
      "cockpit-header-rail",
      COCKPIT_CABIN_WIDTH,
      COCKPIT_ROOF_PROFILE,
      cockpitTrim,
      this.playerCockpit,
    );

    // The glass. One near-transparent pane over the whole aperture plus a
    // darker band along the header, the way a real screen is tinted. Lighting
    // is off (the colour IS the emissive) and depth writes are disabled, so it
    // can never occlude the alpha-blended crowd and shadows behind it.
    const screenTilt = cockpitScreenTiltX();
    const screenSpan = cockpitScreenSpan();
    const screenMidY = (COCKPIT_SCREEN.sillY + COCKPIT_SCREEN.headerY) / 2;
    const screenMidZ = (COCKPIT_SCREEN.sillZ + COCKPIT_SCREEN.headerZ) / 2;
    const glassMaterial = new StandardMaterial("windscreen-glass", scene);
    glassMaterial.diffuseColor = Color3.Black();
    glassMaterial.specularColor = Color3.Black();
    glassMaterial.emissiveColor = new Color3(0.44, 0.5, 0.56);
    glassMaterial.alpha = 0.055;
    glassMaterial.disableLighting = true;
    glassMaterial.disableDepthWrite = true;
    glassMaterial.backFaceCulling = false;
    this.windscreenParts = [];
    const glass = MeshBuilder.CreatePlane(
      "windscreen-glass",
      { width: COCKPIT_SCREEN.halfWidth * 2, height: screenSpan },
      scene,
    );
    glass.parent = this.playerCockpit;
    glass.position.set(0, screenMidY, screenMidZ);
    glass.rotation.x = screenTilt;
    setMeshMaterial(glass, glassMaterial);
    this.windscreenParts.push(glass);

    const bandMaterial = new StandardMaterial("windscreen-band", scene);
    bandMaterial.diffuseColor = Color3.Black();
    bandMaterial.specularColor = Color3.Black();
    bandMaterial.emissiveColor = new Color3(0.06, 0.07, 0.085);
    bandMaterial.alpha = 0.5;
    bandMaterial.disableLighting = true;
    bandMaterial.disableDepthWrite = true;
    bandMaterial.backFaceCulling = false;
    const band = MeshBuilder.CreatePlane(
      "windscreen-band",
      { width: COCKPIT_SCREEN.halfWidth * 2, height: screenSpan * 0.16 },
      scene,
    );
    band.parent = this.playerCockpit;
    const bandOffset = screenSpan * 0.42;
    band.position.set(
      0,
      screenMidY + bandOffset * Math.cos(screenTilt),
      screenMidZ + bandOffset * Math.sin(screenTilt),
    );
    band.rotation.x = screenTilt;
    setMeshMaterial(band, bandMaterial);
    this.windscreenParts.push(band);

    // Wipers, parked along the sill.
    for (const side of [-1, 1]) {
      const wiper = createBox(
        scene,
        `windscreen-wiper-${side}`,
        { width: 0.66, height: 0.014, depth: 0.026 },
        new Vector3(side * 0.35, COCKPIT_SCREEN.sillY + 0.036, COCKPIT_SCREEN.sillZ - 0.03),
        steeringRubber,
        this.playerCockpit,
      );
      wiper.rotation.z = side * 0.075;
      this.windscreenParts.push(wiper);
    }

    // Air vents. The profile is authored lying down and turned a quarter turn
    // about Y so its sweep becomes depth — see COCKPIT_VENT_PROFILE. Each one
    // is a bezel, a dark throat set behind it so the opening reads as a hole
    // rather than a badge, and a single blade across the middle.
    for (const [index, slot] of COCKPIT_VENT_SLOTS.entries()) {
      const bezel = createExtrudedPrism(
        scene,
        `cockpit-vent-${index}`,
        0.05,
        COCKPIT_VENT_PROFILE,
        cockpitTrim,
        this.playerCockpit,
      );
      bezel.rotation.y = Math.PI / 2;
      bezel.scaling.set(1, slot.width * 0.42, slot.width);
      bezel.position.set(slot.x, slot.y, slot.z);
      // The throat sits a whisker in FRONT of the bezel's face, not behind it.
      // The bezel is a solid prism, so a throat at a physically-correct depth
      // is simply inside it and never seen; a smaller dark plate laid on top
      // reads as the hole instead, and the bezel survives as a border.
      const throat = createExtrudedPrism(
        scene,
        `cockpit-vent-throat-${index}`,
        0.012,
        COCKPIT_VENT_PROFILE,
        ventShadow,
        this.playerCockpit,
      );
      throat.rotation.y = Math.PI / 2;
      throat.scaling.set(1, slot.width * 0.3, slot.width * 0.84);
      throat.position.set(slot.x, slot.y, slot.z - 0.029);
      createBox(
        scene,
        `cockpit-vent-blade-${index}`,
        { width: slot.width * 0.7, height: 0.008, depth: 0.01 },
        new Vector3(slot.x, slot.y, slot.z - 0.036),
        cockpitTrim,
        this.playerCockpit,
      );
    }

    const steeringGeometry = resolveCockpitSteeringGeometry(
      this.options.steeringSide,
    );
    const wheelX = steeringGeometry.x;

    const binnacle = createExtrudedPrism(
      scene,
      "instrument-hood",
      COCKPIT_BINNACLE_WIDTH,
      COCKPIT_BINNACLE_PROFILE,
      dash,
      this.playerCockpit,
    );
    binnacle.position.x = wheelX;

    const clusterRoot = new TransformNode("instrument-cluster", scene);
    clusterRoot.parent = this.playerCockpit;
    clusterRoot.position.set(wheelX, COCKPIT_CLUSTER.y, COCKPIT_CLUSTER.z);
    clusterRoot.rotation.x = COCKPIT_CLUSTER.tiltX;
    createBox(
      scene,
      "instrument-cluster-shell",
      { width: COCKPIT_CLUSTER.width + 0.022, height: COCKPIT_CLUSTER.height + 0.018, depth: 0.02 },
      Vector3.Zero(),
      instrumentFace,
      clusterRoot,
    );
    const clusterFace = MeshBuilder.CreatePlane(
      "instrument-cluster-face",
      { width: COCKPIT_CLUSTER.width, height: COCKPIT_CLUSTER.height },
      scene,
    );
    clusterFace.parent = clusterRoot;
    clusterFace.position.z = -0.0105;
    const clusterMaterial = makeMaterial(
      scene,
      "instrument-cluster-lit",
      Color3.White(),
      new Color3(0.62, 0.62, 0.62),
    );
    const clusterTexture = makeInstrumentClusterTexture(scene);
    clusterMaterial.diffuseTexture = clusterTexture;
    clusterMaterial.emissiveTexture = clusterTexture;
    setMeshMaterial(clusterFace, clusterMaterial);

    // Needles are meshes on pivots, driven from updatePlayerVisuals.
    const needleMaterial = makeMaterial(
      scene,
      "instrument-needle",
      new Color3(0.85, 0.93, 0.92),
      new Color3(0.42, 0.5, 0.49),
    );
    const needleLength = COCKPIT_CLUSTER.height * COCKPIT_GAUGE_RADIUS * 1.55;
    this.gaugeNeedles = COCKPIT_GAUGE_CENTRES.map((centre, index) => {
      const pivot = new TransformNode(`instrument-needle-pivot-${index}`, scene);
      pivot.parent = clusterRoot;
      pivot.position.set(
        (centre - 0.5) * COCKPIT_CLUSTER.width,
        0,
        -0.0135,
      );
      createBox(
        scene,
        `instrument-needle-${index}`,
        { width: 0.0038, height: needleLength, depth: 0.0026 },
        new Vector3(0, needleLength * 0.4, 0),
        needleMaterial,
        pivot,
      );
      return pivot;
    });

    createBox(scene, "instrument-status", { width: 0.05, height: 0.012, depth: 0.01 }, new Vector3(0, 0.905, 0.298), instrumentGlow, this.playerCockpit);

    const steeringMount = new TransformNode("steering-mount", scene);
    steeringMount.position.set(
      steeringGeometry.x,
      steeringGeometry.y,
      steeringGeometry.z,
    );
    steeringMount.rotation.x = steeringGeometry.mountRotationX;
    steeringMount.parent = this.playerCockpit;
    createCylinder(
      scene,
      "steering-column-shroud",
      {
        height: 0.13,
        diameterTop: 0.075,
        diameterBottom: 0.055,
        tessellation: 16,
      },
      new Vector3(0, 0.075, 0),
      steeringRubber,
      steeringMount,
    );

    this.steeringAssembly = new TransformNode("steering-spin", scene);
    this.steeringAssembly.parent = steeringMount;
    const steeringWheel = MeshBuilder.CreateTorus(
      "steering-wheel",
      {
        diameter: steeringGeometry.wheelDiameter,
        thickness: steeringGeometry.rimThickness,
        tessellation: 28,
      },
      scene,
    );
    steeringWheel.parent = this.steeringAssembly;
    setMeshMaterial(steeringWheel, steeringRubber);

    // Three spokes, not two. The assembly's local +Z points down the face of
    // the wheel once the column tilt is applied, so the bottom spoke runs along
    // +Z and the pair runs along ±X. The spokes and hub take the dash colour
    // and the rim stays dark, which is the two-tone the reference has and the
    // only thing that keeps a wheel from reading as one black ring.
    const spokeReach = steeringGeometry.wheelDiameter / 2;
    for (const side of [-1, 1]) {
      createBox(
        scene,
        `wheel-spoke-${side}`,
        { width: spokeReach, height: 0.02, depth: 0.038 },
        new Vector3(side * spokeReach * 0.55, 0, 0.022),
        cockpitTrim,
        this.steeringAssembly,
      );
    }
    createBox(
      scene,
      "wheel-lower-spoke",
      { width: 0.044, height: 0.02, depth: spokeReach * 0.82 },
      new Vector3(0, 0, spokeReach * 0.56),
      cockpitTrim,
      this.steeringAssembly,
    );
    const steeringHub = createCylinder(
      scene,
      "steering-hub",
      { height: 0.05, diameter: 0.148, tessellation: 20 },
      new Vector3(0, 0.004, 0.012),
      cockpitTrim,
      this.steeringAssembly,
    );
    steeringHub.scaling.z = 0.62;
    const steeringEmblem = createCylinder(
      scene,
      "steering-emblem",
      { height: 0.054, diameter: 0.056, tessellation: 16 },
      new Vector3(0, 0.006, 0.012),
      steeringRubber,
      this.steeringAssembly,
    );
    steeringEmblem.scaling.z = 0.62;

    this.buildWingMirror(steeringRubber, cockpitTrim);
    this.mergeCockpitStatics();
    for (const mesh of this.playerCockpit.getChildMeshes(false)) {
      mesh.layerMask = COCKPIT_LAYER_MASK;
      // The cabin is on screen by definition whenever it is enabled at all, so
      // frustum-testing it every frame is pure waste. It also cannot be
      // freezeWorldMatrix'd — playerCockpit hangs off the player node, whose
      // transform is rewritten every frame — which is exactly why the part
      // count matters and the statics above are merged.
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
    }
    for (const material of [
      bodyDark,
      steeringRubber,
      dash,
      cockpitTrim,
      ventShadow,
      instrumentFace,
      instrumentGlow,
      clusterMaterial,
      needleMaterial,
      glassMaterial,
      bandMaterial,
    ]) {
      material.freeze();
    }
  }

  /**
   * Collapses the cabin's static parts down to one mesh per material.
   *
   * The interior is now around forty pieces, and none of them can have its
   * world matrix frozen, so every one is a draw call and a matrix walk on every
   * frame of every first-person drive. Merging by material takes that back
   * below where it was before the cabin was rebuilt.
   *
   * The parent is dropped before merging and restored after: `mesh.parent =
   * null` leaves the local transform in place as the world transform, which is
   * cockpit space, so the baked vertices come out in the coordinates the
   * cockpit node expects. Merging while still parented would bake in wherever
   * the car happened to be sitting at construction time. A fresh mesh is passed
   * as the merge target for the same reason — Babylon would otherwise reuse the
   * first source, whose own transform has already been applied to its vertices.
   *
   * The windscreen parts stay out of it: they are toggled independently on the
   * blurriest render rung.
   */
  private mergeCockpitStatics() {
    const keepSeparate = new Set<AbstractMesh>(this.windscreenParts);
    const groups = new Map<string, Mesh[]>();
    for (const child of this.playerCockpit.getChildMeshes(true)) {
      if (keepSeparate.has(child)) continue;
      const key = child.material?.name ?? "";
      const group = groups.get(key);
      if (group) group.push(child as Mesh);
      else groups.set(key, [child as Mesh]);
    }
    for (const [key, meshes] of groups) {
      if (meshes.length < 2) continue;
      const material = meshes[0].material;
      const target = new Mesh(`cockpit-merged-${key}`, this.scene);
      for (const mesh of meshes) mesh.parent = null;
      const merged = Mesh.MergeMeshes(meshes, true, true, target, false, false);
      if (!merged) {
        // Nothing was merged, so the sources are still live: put them back
        // rather than leaving the cabin scattered at the world origin.
        target.dispose();
        for (const mesh of meshes) mesh.parent = this.playerCockpit;
        continue;
      }
      merged.material = material;
      merged.isPickable = false;
      merged.receiveShadows = false;
      merged.parent = this.playerCockpit;
    }
  }

  private buildTraffic() {
    if (this.options.mapPack && this.options.lesson) {
      this.buildScenarioTraffic(this.options.mapPack, this.options.lesson);
      return;
    }
    const scene = this.scene;
    const playerLaneSign = this.options.trafficSide === "right" ? 1 : -1;
    for (let index = 0; index < 8; index += 1) {
      const sameDirection = index % 2 === 0;
      const direction: 1 | -1 = sameDirection ? 1 : -1;
      const laneX = direction > 0
        ? playerLaneSign * LANE_CENTER
        : -playerLaneSign * LANE_CENTER;
      const z = -35 + index * 20 + (sameDirection ? 25 : 0);
      const node = new TransformNode(`npc-${index}`, scene);
      const vehicleId = `npc-${index + 1}`;
      const initialSnapshot = this.simulationSnapshot.npcs.find(
        (vehicle) => vehicle.id === vehicleId,
      );
      const appearance = resolveTrafficVehicleAppearance({
        vehicleId,
        trafficSeed: 0,
        variant: initialSnapshot?.variant ?? "car",
        mapId: "orientation-yard",
      });
      const visual = createVehicleMesh(
        scene,
        node,
        `fallback-${vehicleId}`,
        appearance,
      );
      const spawnHeading = direction > 0 ? 0 : Math.PI;
      this.npcVehicles.push({
        node,
        visual,
        visualKey: appearanceVisualKey(appearance),
        visualVehicleId: vehicleId,
        visualVariant: initialSnapshot?.variant ?? "car",
        direction,
        speed: 5.5 + (index % 4) * 0.65,
        z,
        laneX,
        poseX: laneX,
        poseZ: z,
        poseHeading: spawnHeading,
        prevPoseX: laneX,
        prevPoseZ: z,
        prevPoseHeading: spawnHeading,
      });
      node.position.set(laneX, 0.12, z);
      node.rotation.y = spawnHeading;
    }

    const clothes = [new Color3(0.83, 0.38, 0.22), new Color3(0.2, 0.45, 0.72), new Color3(0.68, 0.28, 0.62)];
    for (let index = 0; index < 4; index += 1) {
      const node = new TransformNode(`pedestrian-${index}`, scene);
      const colors = this.characterColorsAt(index, clothes[index % clothes.length]);
      const speed = 1.2 + index * 0.12;
      const visual = this.buildRoadUserVisual(node, `yard-pedestrian-${index}`, false, index, colors, speed);
      const z = index < 2 ? 4.5 : -10.5;
      const distanceM = (index * 4.1) % 16;
      this.pedestrians.push({ node, distanceM, speed, z, visual, variant: index, colors });
      node.position.set(-8 + distanceM, 0.08, z);
    }
  }

  private buildScenarioTraffic(
    mapPack: GameCanvasMapPack,
    lesson: GameCanvasLesson,
  ) {
    const scene = this.scene;
    const random = seededUnit(lesson.trafficSeed);
    const count = resolveAmbientVehicleCount(
      mapPack,
      lesson.trafficDensity,
      this.options.inputCapabilities.touchFirst,
    );
    const usableLanes = mapPack.laneGraph.lanes.filter((lane) => lane.centerline.length >= 2);
    const vehicleSpawns = mapPack.laneGraph.spawnPoints.filter(
      (spawn) => spawn.kind === "vehicle",
    );
    const trafficColors = [
      new Color3(0.82, 0.21, 0.15),
      new Color3(0.92, 0.66, 0.11),
      new Color3(0.25, 0.51, 0.63),
      new Color3(0.38, 0.59, 0.38),
      new Color3(0.67, 0.68, 0.7),
    ];

    for (let index = 0; index < count && usableLanes.length > 0; index += 1) {
      const spawn = vehicleSpawns[index % Math.max(1, vehicleSpawns.length)];
      const authoredAnchor =
        spawn && "anchor" in spawn && spawn.anchor && index < vehicleSpawns.length
          ? spawn.anchor
          : null;
      const legacyLaneId = spawn && "laneId" in spawn ? spawn.laneId : undefined;
      const lane =
        ((authoredAnchor?.laneId ?? legacyLaneId) &&
          usableLanes.find(
            (candidate) => candidate.id === (authoredAnchor?.laneId ?? legacyLaneId),
          )) ||
        usableLanes[(index * 3 + Math.floor(random() * usableLanes.length)) % usableLanes.length];
      const connectedPath = this.buildConnectedNpcPath(mapPack, lane.id, index);
      if (connectedPath.segments.length === 0) continue;
      const anchored = authoredAnchor
        ? resolveLaneAnchor(mapPack.laneGraph.lanes, authoredAnchor)
        : null;
      const legacyPose = spawn && "pose" in spawn ? spawn.pose : undefined;
      let segment = anchored?.segmentIndex ?? Math.floor(random() * connectedPath.segments.length);
      if (segment >= connectedPath.segments.length) segment = connectedPath.segments.length - 1;
      let pathSegment = connectedPath.segments[segment];
      let initialDistance = anchored?.distanceOnSegment ?? random() * pathSegment.length;
      if (legacyPose && index < vehicleSpawns.length && !anchored) {
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let candidateIndex = 0; candidateIndex < connectedPath.segments.length; candidateIndex += 1) {
          const candidate = connectedPath.segments[candidateIndex];
          const dx = candidate.end.x - candidate.start.x;
          const dz = candidate.end.z - candidate.start.z;
          const amount = clamp(
            ((legacyPose.position.x - candidate.start.x) * dx +
              (legacyPose.position.z - candidate.start.z) * dz) /
              Math.max(0.001, candidate.length * candidate.length),
            0,
            1,
          );
          const x = candidate.start.x + dx * amount;
          const z = candidate.start.z + dz * amount;
          const distance = Math.hypot(legacyPose.position.x - x, legacyPose.position.z - z);
          if (distance < bestDistance) {
            bestDistance = distance;
            segment = candidateIndex;
            pathSegment = candidate;
            initialDistance = candidate.length * amount;
          }
        }
      }
      const start = pathSegment.start;
      const end = pathSegment.end;
      const segmentLength = pathSegment.length;
      const amount = initialDistance / segmentLength;
      const x = start.x + (end.x - start.x) * amount;
      const z = start.z + (end.z - start.z) * amount;
      const heading = Math.atan2(end.x - start.x, end.z - start.z);
      const node = new TransformNode(`scenario-npc-${index}`, scene);
      const vehicleId = `npc-${index + 1}`;
      const initialSnapshot = this.simulationSnapshot.npcs.find(
        (vehicle) => vehicle.id === vehicleId,
      );
      const initialVariant =
        initialSnapshot?.variant ?? inferSpawnVehicleVariant(spawn?.id);
      const appearance = resolveTrafficVehicleAppearance({
        vehicleId,
        trafficSeed: lesson.trafficSeed,
        variant: initialVariant,
        mapId: mapPack.id,
      });
      const visual = createVehicleMesh(
        scene,
        node,
        `scenario-${vehicleId}`,
        appearance,
      );
      const displayLimit = lane.speedLimit ?? (this.options.speedUnit === "mph" ? 30 : 50);
      const limitMps = this.options.speedUnit === "mph"
        ? displayLimit / 2.236936
        : displayLimit / 3.6;
      const cruiseSpeed = Math.max(3.5, limitMps * (0.58 + random() * 0.22));
      const npc: NpcVehicle = {
        node,
        visual,
        visualKey: appearanceVisualKey(appearance),
        visualVehicleId: vehicleId,
        visualVariant: initialVariant,
        direction: 1,
        speed: cruiseSpeed,
        currentSpeed: cruiseSpeed,
        z,
        laneX: x,
        poseX: x,
        poseZ: z,
        poseHeading: heading,
        prevPoseX: x,
        prevPoseZ: z,
        prevPoseHeading: heading,
        laneId: pathSegment.laneId,
        active: true,
      };
      const safeAtStart = this.isNpcPositionSafe(npc, x, z, heading, false);
      npc.active = safeAtStart;
      node.position.set(x, 0.12, z);
      node.rotation.y = heading;
      node.setEnabled(safeAtStart);
      // Patrol status rides on the appearance (light bar + livery are built into
      // the vehicle visual); a nearby violation becomes a fine (phase 10).
      npc.police = appearance.role === "police";
      this.npcVehicles.push(npc);
    }

    const requestedPedestrians = Math.min(10, lesson.vulnerableRoadUsers?.pedestrians ?? 0);
    const requestedCyclists = Math.min(5, lesson.vulnerableRoadUsers?.cyclists ?? 0);
    const authoredSpawns = mapPack.laneGraph.spawnPoints.filter(
      (spawn) => spawn.kind === "pedestrian" || spawn.kind === "cyclist",
    );
    const crosswalks = mapPack.laneGraph.controls.filter(
      (control) => control.type === "crosswalk",
    );
    // On maps with a pavement graph the road users roam it like the ambient
    // crowd — pedestrians walking, cyclists riding the same rails at bike
    // pace — instead of pacing a fixed strip back and forth for ever. Two
    // sims because the two kinds move at different speeds.
    const graph = this.ensurePavementGraph();
    const radii = AMBIENT_CROWD_CONFIG[mapPack.id] ?? DEFAULT_ROAD_USER_RADII;
    const railSimFor = (
      count: number,
      tag: string,
      minSpeedMps: number,
      maxSpeedMps: number,
      scatterHalfWidthM: number,
    ) => {
      if (!graph || count <= 0) return null;
      const sim = createCrowdSim(graph, {
        count,
        seed: hashStringToSeed(`${mapPack.id}-${tag}`),
        innerRadiusM: radii.innerRadiusM,
        outerRadiusM: radii.outerRadiusM,
        recycleRadiusM: radii.recycleRadiusM,
        minSpeedMps,
        maxSpeedMps,
        scatterHalfWidthM,
        turnPauseSeconds: 1,
        modelCount: CHARACTER_MODELS.length,
        tintCount: trafficColors.length,
        complexionCount: this.complexionPalette().length,
        hairCount: this.hairPalette().length,
      });
      sim?.step(0, { x: this.playerState.x, z: this.playerState.z }, () => true);
      return sim;
    };
    this.roadUserPedSim = railSimFor(
      requestedPedestrians,
      "roadusers",
      1.1,
      1.6,
      this.crowdScatterHalfM(),
    );
    // Cyclists hold a straighter line than strollers do.
    this.roadUserCycleSim = railSimFor(
      requestedCyclists,
      "cyclists",
      3.2,
      4.2,
      Math.min(0.4, this.crowdScatterHalfM()),
    );
    const roadUserCount = requestedPedestrians + requestedCyclists;
    for (let index = 0; index < roadUserCount; index += 1) {
      const isCyclist = index >= requestedPedestrians;
      const slot = isCyclist ? index - requestedPedestrians : index;
      const walker = (isCyclist ? this.roadUserCycleSim : this.roadUserPedSim)
        ?.walkers[slot];
      const authored = authoredSpawns[index % Math.max(1, authoredSpawns.length)];
      const authoredPose = authored && "pose" in authored ? authored.pose : undefined;
      const crosswalk = crosswalks[index % Math.max(1, crosswalks.length)];
      const source = walker ?? authoredPose?.position ?? crosswalk?.position ?? this.routePoints[index % Math.max(1, this.routePoints.length)] ?? { x: 0, z: 0 };
      const heading = walker
        ? walker.headingRad
        : authoredPose
          ? degreesToRadians(authoredPose.headingDeg)
          : crosswalk
            ? degreesToRadians(crosswalk.headingDeg + 90)
            : (index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
      const node = new TransformNode(`scenario-road-user-${index}`, scene);
      const variant = index;
      const colors = this.characterColorsAt(
        index,
        trafficColors[(index + 1) % trafficColors.length],
      );
      const speed = walker
        ? walker.speedMps
        : isCyclist
          ? 3 + random()
          : 1.2 + random() * 0.5;
      const visual = this.buildRoadUserVisual(
        node,
        `scenario-road-user-${index}`,
        isCyclist,
        variant,
        colors,
        speed,
      );
      const span = isCyclist ? 34 : mapPack.geometry.roadWidth + 6;
      node.position.set(source.x, 0.08, source.z);
      node.rotation.y = heading;
      const pedestrian: Pedestrian = {
        node,
        distanceM: walker ? 0 : random() * span,
        speed,
        z: source.z,
        origin: walker ? undefined : { x: source.x, z: source.z },
        heading,
        span,
        railMode: Boolean(walker),
        kind: isCyclist ? "cyclist" : "pedestrian",
        visual,
        variant,
        colors,
      };
      this.pedestrians.push(pedestrian);
      if (walker) {
        this.railRoadUsers.push({
          pedestrian,
          kind: isCyclist ? "cyclist" : "pedestrian",
          index: slot,
        });
      }
    }
  }

  private installListeners() {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const drivingKey = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
        "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyC",
        "KeyH", "KeyP", "KeyR", "KeyZ", "KeyX", "KeyV", "Escape",
      ].includes(event.code);
      if (drivingKey) event.preventDefault();
      if (drivingKey) this.inputRouter.registerMeaningfulInput("keyboard");
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.keyboard.throttle = 1;
          break;
        case "ArrowDown":
        case "KeyS":
          // Brakes while the car is still rolling forwards, then reverses.
          this.keyboard.reverse = 1;
          break;
        case "Space":
          this.keyboard.brake = 1;
          break;
        case "ArrowLeft":
        case "KeyA":
          this.keyboard.steer = -1;
          break;
        case "ArrowRight":
        case "KeyD":
          this.keyboard.steer = 1;
          break;
        case "KeyZ":
          this.keyboard.quickLook = -1;
          break;
        case "KeyX":
          this.keyboard.quickLook = 1;
          break;
        case "KeyV":
          this.keyboard.quickLook = 2;
          break;
        case "KeyQ":
          if (!event.repeat) this.setIndicator("left");
          break;
        case "KeyE":
          if (!event.repeat) this.setIndicator("right");
          break;
        case "KeyC":
          if (!event.repeat) this.toggleCamera();
          break;
        case "KeyH":
          if (!event.repeat) this.horn();
          break;
        case "KeyP":
        case "Escape":
          if (!event.repeat) this.togglePause();
          break;
        case "KeyR":
          if (!event.repeat) this.reset();
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.keyboard.throttle = 0;
          break;
        case "ArrowDown":
        case "KeyS":
          this.keyboard.reverse = 0;
          break;
        case "Space":
          this.keyboard.brake = 0;
          break;
        case "ArrowLeft":
        case "KeyA":
          if (this.keyboard.steer < 0) this.keyboard.steer = 0;
          break;
        case "ArrowRight":
        case "KeyD":
          if (this.keyboard.steer > 0) this.keyboard.steer = 0;
          break;
        case "KeyZ":
        case "KeyX":
        case "KeyV":
          this.keyboard.quickLook = 0;
          break;
        case "KeyH":
          this.hornRelease();
          break;
      }
    };
    const onBlur = () => this.clearHeldInputs();
    const onVisibility = () => {
      if (document.hidden) this.setPaused(true);
      this.clearHeldInputs();
    };
    const onResize = () => {
      this.engine.resize();
      this.layoutMirrorPanels();
    };
    const onOrientationChange = () => {
      this.engine.resize();
      const portraitGateManagedByReact = this.options.inputCapabilities.touchFirst;
      if (!portraitGateManagedByReact) this.setPaused(true);
      this.clearHeldInputs();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      this.setPaused(true);
      this.emit("context-lost", "Graphics context lost. Curbside Rush is waiting to recover.", "warning");
      this.callbacks.onContextLost?.();
    };
    const onContextRestored = () => {
      this.contextLost = false;
      this.lastFrameTime = performance.now();
      this.emit("context-restored", "Graphics restored. Review your position before continuing.");
      this.callbacks.onContextRestored?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || this.swipePointer !== null) return;
      this.registerTouchInput();
      this.swipePointer = event.pointerId;
      this.swipeStartX = event.clientX;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== this.swipePointer) return;
      this.touch.quickLook = clamp((event.clientX - this.swipeStartX) / 90, -1, 1);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== this.swipePointer) return;
      this.swipePointer = null;
      this.touch.quickLook = 0;
    };
    const onGamepadDisconnected = () => {
      const remaining = "getGamepads" in navigator
        ? Array.from(navigator.getGamepads()).find(Boolean)
        : null;
      if (!remaining) this.handleGamepadDisconnected();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    document.addEventListener("visibilitychange", onVisibility);
    this.canvas.addEventListener("webglcontextlost", onContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
    this.canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    this.canvas.addEventListener("pointerup", onPointerEnd, { passive: true });
    this.canvas.addEventListener("pointercancel", onPointerEnd, { passive: true });
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(this.canvas);

    this.disposers.push(() => window.removeEventListener("keydown", onKeyDown));
    this.disposers.push(() => window.removeEventListener("keyup", onKeyUp));
    this.disposers.push(() => window.removeEventListener("blur", onBlur));
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.disposers.push(() =>
      window.removeEventListener("orientationchange", onOrientationChange),
    );
    this.disposers.push(() => window.removeEventListener("gamepaddisconnected", onGamepadDisconnected));
    this.disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));
    this.disposers.push(() => this.canvas.removeEventListener("webglcontextlost", onContextLost));
    this.disposers.push(() => this.canvas.removeEventListener("webglcontextrestored", onContextRestored));
    this.disposers.push(() => this.canvas.removeEventListener("pointerdown", onPointerDown));
    this.disposers.push(() => this.canvas.removeEventListener("pointermove", onPointerMove));
    this.disposers.push(() => this.canvas.removeEventListener("pointerup", onPointerEnd));
    this.disposers.push(() => this.canvas.removeEventListener("pointercancel", onPointerEnd));
    this.disposers.push(() => resizeObserver.disconnect());
  }

  private pollGamepad() {
    if (!("getGamepads" in navigator)) return;
    // Scanned by index — this runs every frame, almost always padless, and
    // Array.from allocated on every one of them.
    const pads = navigator.getGamepads();
    let pad: (typeof pads)[number] = null;
    for (let index = 0; index < pads.length; index += 1) {
      if (pads[index]) {
        pad = pads[index];
        break;
      }
    }
    if (!pad) {
      if (this.gamepadConnected) this.handleGamepadDisconnected();
      return;
    }
    this.gamepadConnected = true;
    const deadzone = (value: number) =>
      Math.abs(value) < 0.14 ? 0 : Math.sign(value) * ((Math.abs(value) - 0.14) / 0.86);
    const nextGamepad: AnalogInput = {
      steer: clamp(deadzone(pad.axes[0] ?? 0), -1, 1),
      quickLook: clamp(deadzone(pad.axes[2] ?? 0), -1, 1),
      throttle: pad.buttons[7]?.value ?? 0,
      // The left trigger is the reverse pedal, same as S: it brakes the car
      // down and then backs it up, so there is no gear to select.
      brake: 0,
      reverse: pad.buttons[6]?.value ?? 0,
    };

    const pressed = pad.buttons.map((button) => button.pressed);
    const edge = (index: number) => pressed[index] && !this.gamepadButtons[index];
    const buttonUsed = pressed.some(
      (isPressed, index) => isPressed && !this.gamepadButtons[index],
    );
    const analogUsed = (Object.keys(nextGamepad) as Array<keyof AnalogInput>).some(
      (control) =>
        Math.abs(nextGamepad[control]) >= 0.08 &&
        Math.abs(nextGamepad[control] - this.gamepad[control]) >= 0.04,
    );
    this.gamepad = nextGamepad;
    if (buttonUsed || analogUsed) this.inputRouter.registerMeaningfulInput("gamepad");
    // Above the paused early-return: letting go of the horn has to register even
    // if the pause landed while the button was still down.
    if (!pressed[0] && this.gamepadButtons[0]) this.hornRelease();
    if (this.paused) {
      if (edge(0) || edge(1) || edge(9)) this.setPaused(false);
      this.gamepadButtons = pressed;
      return;
    }
    if (edge(0)) this.horn();
    if (edge(1)) this.toggleCamera();
    if (edge(2)) this.setIndicator("left");
    if (edge(3)) this.setIndicator("right");
    if (edge(9)) this.togglePause();
    if (edge(8)) this.reset();
    this.gamepadButtons = pressed;
  }

  private handleGamepadDisconnected() {
    const wasActive = this.inputRouter.getPresentation().activeFamily === "gamepad";
    this.gamepadConnected = false;
    this.clearHeldInputs();
    this.gamepadButtons = [];
    if (!wasActive) return;

    const fallback = this.inputRouter.handleGamepadDisconnect();
    this.instruction =
      fallback === "touch"
        ? "Controller disconnected. Drive paused — use the touch controls to continue."
        : "Controller disconnected. Drive paused — use the keyboard to continue.";
    this.emit("coaching", this.instruction, "warning");
    this.setPaused(true);
    this.publishHud(true);
  }

  private clearHeldInputs() {
    this.keyboard = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
    this.touch = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
    this.gamepad = { throttle: 0, brake: 0, reverse: 0, steer: 0, quickLook: 0 };
    this.touchSteerReleasing = false;
    // Covers blur, tab hide, pause and reset: without this a keyup that never
    // arrives because the window lost focus leaves the horn blaring.
    this.hornRelease();
  }

  private coach(message: string) {
    this.instruction = message;
    this.emit("coaching", message, "warning");
    this.publishHud(true);
  }

  private emit(
    type: GameRuntimeEvent["type"],
    message: string,
    severity: GameRuntimeEvent["severity"] = "info",
    rule?: Pick<GameRuntimeEvent, "ruleCode" | "penalty" | "evidence" | "issuedBy">,
  ) {
    this.callbacks.onEvent?.({
      type,
      message,
      severity,
      timestamp: eventNow(),
      ...rule,
    });
  }

  private publishHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHudTime < 90) return;
    this.lastHudTime = now;
    const speed = this.simulationSnapshot.speedDisplay;
    const speedUnit: SpeedUnit =
      this.simulationSnapshot.speedUnit === "kmh" ? "km/h" : "mph";
    const objectives = this.options.lesson?.objectives ?? [];
    const objectiveIndex = objectives.length
      ? Math.min(
          objectives.length - 1,
          Math.floor(this.routeProgress * objectives.length),
        )
      : 0;
    const scenarioProgress = this.options.lesson
      ? this.routeProgress
      : clamp(
          (this.playerState.z - START_Z) / (FINISH_Z - START_Z),
          0,
          1,
        );
    this.callbacks.onHudUpdate?.({
      speed: Math.round(speed),
      speedUnit,
      gear: this.playerState.gear,
      cameraMode: this.cameraMode,
      indicator: this.playerState.indicator,
      score: Math.round(this.score),
      objectiveProgress: scenarioProgress,
      instruction: this.instruction,
      paused: this.paused,
      // The horn now sustains while held, so the visual cue has to follow the
      // hold rather than the fixed window the old fire-and-forget blip used.
      honking: this.hornHeld || now < this.hornUntil,
      rearViewVisible: this.cameraMode === "first",
      scenarioId: this.options.lesson?.id ?? "orientation-yard",
      scenarioTitle: this.options.lesson?.title ?? "Free drive",
      objective:
        objectives[objectiveIndex]?.label ??
        "Reach the end of the training route",
      checkpoint: this.checkpointLabel,
      trafficSide: this.simulationSnapshot.trafficSide,
      playerX: this.playerState.x,
      playerZ: this.playerState.z,
      heading: this.playerState.heading,
      simElapsedMs: this.simulationSnapshot.elapsedMs,
      speedLimit: this.postedSpeedLimit(),
      scenarioClock: this.options.lesson?.scenarioClock?.label,
    });
  }

  /**
   * The limit posted on the road under the car, in the same unit as `speed`.
   *
   * The simulation reports zero whenever the lane projection fails — a junction
   * gap, a car park, anything off the network — and a sign that blinks to zero
   * every time the car crosses a crossroads is worse than no sign. So the last
   * real figure is held instead: a driver on an unmarked stretch is still
   * bound by the limit of the road they turned off.
   */
  private postedSpeedLimit(): number {
    const posted = this.simulationSnapshot.road.speedLimitDisplay;
    if (posted > 0) this.lastPostedSpeedLimit = posted;
    return this.lastPostedSpeedLimit;
  }
}

// No `isolation: "isolate"` here, deliberately. It would make this subtree an
// atomic stacking context at the shell's own level, so no z-index inside could
// ever rise above a HUD sibling rendered by SideSwapApp — which is exactly how
// the touch controls ended up painted under the wallet card and the minimap.
// Layering across both files goes through DRIVE_LAYER instead.
// No `minHeight` either. A landscape phone viewport is about 393px tall, so a
// 420px floor made the shell taller than the page that clips it — and the
// bottom of the shell is exactly where the pedals and the steering region are
// anchored.
const shellStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  borderRadius: 24,
  background: "#172226",
  color: "#f6f2e7",
};

const canvasStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  outline: "none",
  touchAction: "none",
};

const glassPanelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(12,20,23,.6)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px rgba(0,0,0,.35)",
  backdropFilter: "blur(14px) saturate(1.2)",
};

const actionButtonStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(12,20,23,.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)",
  backdropFilter: "blur(10px)",
  color: "#fff9ea",
  font: "700 12px/1 system-ui, sans-serif",
  letterSpacing: ".03em",
  touchAction: "none",
  userSelect: "none",
};

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      trafficSide,
      steeringSide,
      lesson,
      mapPack,
      cameraMode = "third",
      speedUnit = "mph",
      paused = false,
      reducedMotion = false,
      steeringSensitivity = 1,
      fieldOfView = DEFAULT_HORIZONTAL_FOV,
      masterVolume = 0.75,
      effectsVolume = 0.75,
      cameraShake = false,
      headBob = false,
      outOfFuel = false,
      carConditionPct = 100,
      resetNonce = 0,
      riderVenueId = null,
      gigStopId = null,
      gigStopCarrying = false,
      cutscene = null,
      playerVehicle = null,
      vehiclePhysics = null,
      className,
      style,
      onHudUpdate,
      onEvent,
      onPauseChange,
      onCameraChange,
      onExit,
      onComplete,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sessionRef = useRef<BabylonGameSession | null>(null);
    const callbackRef = useRef<SessionCallbacks>({});
    const viewportReadyRef = useRef(false);
    const touchPortraitGateRef = useRef(false);
    const inputCapabilitiesRef = useRef<InputCapabilities>(
      readInputCapabilities(),
    );
    const [runtimeState, setRuntimeState] = useState<
      "loading" | "ready" | "unsupported" | "context-lost" | "error"
    >("loading");
    const [loadProgress, setLoadProgress] = useState<LoadProgress>({
      fraction: 0,
      label: LOADING_MODELS_LABEL,
    });
    const [isPortrait, setIsPortrait] = useState(false);
    // Tracked rather than assumed, because iOS leaves fullscreen on a swipe
    // without any press of ours.
    const [fullscreen, setFullscreen] = useState(false);
    const [fullscreenOffered, setFullscreenOffered] = useState(false);
    const [inputPresentation, setInputPresentation] =
      useState<AdaptiveInputPresentation>(() =>
        createInitialInputPresentation(inputCapabilitiesRef.current),
      );
    const [hud, setHud] = useState<GameHudSnapshot>({
      speed: 0,
      speedUnit,
      gear: "D",
      cameraMode,
      indicator: "off",
      score: 100,
      objectiveProgress: 0,
      instruction: "Preparing the training yard…",
      paused,
      honking: false,
      rearViewVisible: cameraMode === "first",
      scenarioId: lesson?.id ?? "orientation-yard",
      scenarioTitle: lesson?.title ?? "Free drive",
      objective:
        lesson?.objectives[0]?.label ??
        "Reach the end of the training route",
      checkpoint: "Start",
      trafficSide: lesson?.trafficSide ?? trafficSide,
      playerX: 0,
      playerZ: 0,
      heading: 0,
      simElapsedMs: 0,
      speedLimit: 0,
    });

    callbackRef.current = {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
        onHudUpdate?.(snapshot);
      },
      onEvent,
      onPauseChange,
      onCameraChange,
      onComplete,
      onReady: () => setRuntimeState("ready"),
      onContextLost: () => setRuntimeState("context-lost"),
      onContextRestored: () => setRuntimeState("ready"),
      onLoadProgress: (progress) => setLoadProgress(progress),
    };

    // The gate pauses the drive; it does not tear it down. It used to keep the
    // session-creation effect from running at all, so every rotation rebuilt
    // the entire city — and since `screen.orientation.lock()` has never shipped
    // in Safari, rotating is something a phone player does over and over.
    useEffect(() => {
      const updateViewportFlags = () => {
        const capabilities = readInputCapabilities();
        const portrait = window.matchMedia("(orientation: portrait)").matches;
        const portraitGate = portrait && capabilities.touchFirst;
        const wasReady = viewportReadyRef.current;
        const wasPortraitGate = touchPortraitGateRef.current;
        viewportReadyRef.current = true;
        touchPortraitGateRef.current = portraitGate;
        inputCapabilitiesRef.current = capabilities;
        if (!wasReady) {
          setInputPresentation(createInitialInputPresentation(capabilities));
        }
        sessionRef.current?.setInputCapabilities(capabilities);
        setIsPortrait(portrait);

        if (portraitGate) {
          sessionRef.current?.clearTouch();
          sessionRef.current?.setPaused(true);
        } else if (wasReady && wasPortraitGate) {
          sessionRef.current?.setPaused(paused, false);
        }
      };
      updateViewportFlags();
      window.addEventListener("resize", updateViewportFlags);
      window.addEventListener("orientationchange", updateViewportFlags);
      return () => {
        window.removeEventListener("resize", updateViewportFlags);
        window.removeEventListener("orientationchange", updateViewportFlags);
      };
    }, [paused]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!viewportReadyRef.current) {
        setRuntimeState("loading");
        return;
      }
      const testCanvas = document.createElement("canvas");
      if (!testCanvas.getContext("webgl2")) {
        setRuntimeState("unsupported");
        return;
      }

      let alive = true;
      let ownedSession: BabylonGameSession | null = null;
      let perfQaTimer: number | undefined;
      const writePerfQaSnapshot = () => {
        const hook = (
          window as unknown as Record<string, unknown>
        ).__sideswapPerfDebug;
        if (typeof hook === "function") {
          canvas.dataset.perfQa = JSON.stringify(hook());
        }
      };
      setRuntimeState("loading");
      // A rebuild (lesson/mapPack change) reuses this component instance
      // rather than remounting, so the bar needs its own reset here — useState's
      // initial value only covers a fresh mount.
      setLoadProgress({ fraction: 0, label: LOADING_MODELS_LABEL });
      const startSession = async () => {
        try {
          if (mapPack?.id === "cairo-central-nile") {
            setLoadProgress({
              fraction: 0.02,
              label: "Loading Cairo lettering…",
            });
            // DynamicTextures do not repaint after a late webfont swap. Awaiting
            // the bundled face here guarantees every Arabic sign, plate, and
            // patrol decal is rasterised with the intended offline font.
            await ensureArabicCanvasFontLoaded();
            if (!alive) return;
            const fontDebug = inspectArabicCanvasFont();
            assertArabicCanvasFontDebug(fontDebug);
            (
              window as unknown as Record<string, unknown>
            ).__sideswapArabicFontDebug = fontDebug;
            canvas.dataset.arabicFontQa = JSON.stringify(fontDebug);
          }
          const session = new BabylonGameSession(
            canvas,
            {
              trafficSide,
              steeringSide,
              lesson,
              mapPack,
              cameraMode,
              inputCapabilities: inputCapabilitiesRef.current,
              speedUnit,
              paused: paused || touchPortraitGateRef.current,
              reducedMotion,
              steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
              fieldOfView: clampHorizontalFieldOfView(fieldOfView),
              masterVolume: clamp(masterVolume, 0, 1),
              effectsVolume: clamp(effectsVolume, 0, 1),
              cameraShake,
              headBob,
              outOfFuel,
              carConditionPct,
              riderVenueId,
              gigStopId,
              gigStopCarrying,
              cutscene,
              playerVehicle: playerVehicle ?? null,
              vehiclePhysics: vehiclePhysics ?? null,
            },
            {
              onHudUpdate: (snapshot) =>
                callbackRef.current.onHudUpdate?.(snapshot),
              onEvent: (event) => callbackRef.current.onEvent?.(event),
              onPauseChange: (value) =>
                callbackRef.current.onPauseChange?.(value),
              onCameraChange: (value) =>
                callbackRef.current.onCameraChange?.(value),
              onInputPresentationChange: (value) =>
                setInputPresentation(value),
              onComplete: (score) => callbackRef.current.onComplete?.(score),
              onReady: () => callbackRef.current.onReady?.(),
              onContextLost: () => callbackRef.current.onContextLost?.(),
              onContextRestored: () =>
                callbackRef.current.onContextRestored?.(),
              onLoadProgress: (progress) =>
                callbackRef.current.onLoadProgress?.(progress),
            },
          );
          ownedSession = session;
          if (!alive) {
            session.dispose();
            return;
          }
          sessionRef.current = session;
          if (mapPack?.id === "cairo-central-nile") {
            perfQaTimer = window.setTimeout(writePerfQaSnapshot, 2_500);
          }
        } catch (error) {
          if (!alive) return;
          console.error("Unable to start Curbside Rush", error);
          setRuntimeState(
            error instanceof Error && error.message.includes("WebGL 2")
              ? "unsupported"
              : "error",
          );
        }
      };
      void startSession();
      return () => {
        alive = false;
        if (perfQaTimer !== undefined) window.clearTimeout(perfQaTimer);
        delete canvas.dataset.perfQa;
        if (mapPack?.id === "cairo-central-nile") {
          delete (
            window as unknown as Record<string, unknown>
          ).__sideswapArabicFontDebug;
          delete canvas.dataset.arabicFontQa;
        }
        if (sessionRef.current === ownedSession) sessionRef.current = null;
        ownedSession?.dispose();
      };
      // Rebuild only when scene-defining jurisdiction/cockpit choices change.
      // Notably not orientation: rotating a phone pauses the drive, it does not
      // rebuild the city.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trafficSide, steeringSide, lesson?.id, mapPack?.id]);

    useEffect(() => {
      sessionRef.current?.updateOptions({
        cameraMode,
        speedUnit,
        paused: paused || touchPortraitGateRef.current,
        reducedMotion,
        steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
        fieldOfView: clampHorizontalFieldOfView(fieldOfView),
        masterVolume: clamp(masterVolume, 0, 1),
        effectsVolume: clamp(effectsVolume, 0, 1),
        cameraShake,
        headBob,
        outOfFuel,
        carConditionPct,
        riderVenueId,
        gigStopId,
        gigStopCarrying,
        cutscene,
      });
    }, [cameraMode, speedUnit, paused, reducedMotion, steeringSensitivity, fieldOfView, masterVolume, effectsVolume, cameraShake, headBob, outOfFuel, carConditionPct, riderVenueId, gigStopId, gigStopCarrying, cutscene]);

    // The tow-and-repair flow: the app bumps `resetNonce` once the fee is
    // debited and the car snaps back to its spawn, repaired.
    const lastResetNonceRef = useRef(resetNonce);
    useEffect(() => {
      if (resetNonce === lastResetNonceRef.current) return;
      lastResetNonceRef.current = resetNonce;
      sessionRef.current?.reset();
    }, [resetNonce]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => sessionRef.current?.reset(),
        toggleCamera: () => sessionRef.current?.toggleCamera(),
        togglePause: () => sessionRef.current?.togglePause(),
        horn: () => sessionRef.current?.horn(),
        setIndicator: (indicator) => sessionRef.current?.setIndicator(indicator),
        focus: () => canvasRef.current?.focus(),
      }),
      [],
    );

    // Mobile Safari only collapses its toolbars in response to scrolling, and
    // the drive screen cannot scroll by design — so on a phone this control is
    // the only way to reclaim the strip the address bar and tab bar occupy.
    // Pointless where the browser is already chrome-less (added to the Home
    // Screen) or has no Fullscreen API at all.
    useEffect(() => {
      setFullscreenOffered(canFullscreen() && !isStandaloneDisplay());
      const sync = () => setFullscreen(isFullscreen());
      sync();
      return onFullscreenChange(sync);
    }, []);

    const toggleFullscreen = useCallback(() => {
      // Straight out of the click, with no await in front of it: the same
      // transient-activation rule that governs priming audio.
      if (isFullscreen()) exitFullscreen();
      else requestImmersiveLandscape(document.documentElement);
    }, []);

    const registerTouchPointer = useCallback((pointerType: string) => {
      if (pointerType === "touch" || pointerType === "pen") {
        sessionRef.current?.registerTouchInput();
      }
    }, []);

    const touchVisible =
      inputPresentation.touchFirst || inputPresentation.touchRevealed;
    const touchPortraitGate = inputPresentation.touchFirst && isPortrait;
    const criticalOverlay = runtimeState !== "ready";
    const activeInputGuide = INPUT_GUIDANCE[inputPresentation.activeFamily];
    const loadPercent = Math.round(clamp(loadProgress.fraction, 0, 1) * 100);

    return (
      <div className={className} style={{ ...shellStyle, ...style }}>
        <canvas
          ref={canvasRef}
          aria-label={`Curbside Rush 3D ${trafficSide}-side driving area`}
          tabIndex={0}
          style={canvasStyle}
        />


        {touchVisible && runtimeState === "ready" && !isPortrait && (
          <TouchDriveControls
            cameraMode={hud.cameraMode}
            dimmed={inputPresentation.touchControlsDimmed}
            reducedMotion={reducedMotion}
            onSteer={(value) => sessionRef.current?.setTouchSteer(value)}
            onSteerRelease={() => sessionRef.current?.releaseTouchSteer()}
            onThrottle={(value) => sessionRef.current?.setTouchAnalog("throttle", value)}
            onBrake={(value) => sessionRef.current?.setTouchAnalog("reverse", value)}
            onQuickLook={(value) => sessionRef.current?.setTouchAnalog("quickLook", value)}
            onLookBehind={(on) => sessionRef.current?.setTouchLookBehind(on)}
            onCamera={() => sessionRef.current?.toggleCamera()}
            onHorn={(down) => (down ? sessionRef.current?.horn() : sessionRef.current?.hornRelease())}
            onPause={() => sessionRef.current?.togglePause()}
            onToggleFullscreen={fullscreenOffered ? toggleFullscreen : undefined}
            isFullscreen={fullscreen}
            onTouchPointer={registerTouchPointer}
          />
        )}

        {hud.paused && runtimeState === "ready" && (
          <div
            role="dialog"
            aria-label="Game paused"
            aria-modal="true"
            onPointerDownCapture={(event) => registerTouchPointer(event.pointerType)}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(8,14,16,.54)",
              backdropFilter: "blur(5px)",
              zIndex: DRIVE_LAYER.action,
            }}
          >
            <div style={{ ...glassPanelStyle, padding: "24px 28px", borderRadius: 20, textAlign: "center", fontFamily: "system-ui" }}>
              <strong style={{ display: "block", marginBottom: 6, fontSize: 24 }}>Paused</strong>
              <span style={{ display: "block", marginBottom: 8, opacity: 0.9, fontSize: 13 }}>{hud.instruction}</span>
              <span style={{ display: "block", marginBottom: 18, opacity: 0.62, fontSize: 11 }}>Inputs have been cleared for safety.</span>
              <details style={{ width: "min(330px, 100%)", margin: "0 auto 18px", textAlign: "left", fontSize: 12, lineHeight: 1.45 }}>
                <summary style={{ cursor: "pointer", color: "#f2c658", fontWeight: 800 }}>
                  How to drive · {activeInputGuide.label}
                </summary>
                <span style={{ display: "block", marginTop: 8, opacity: 0.82 }}>
                  {activeInputGuide.details}
                </span>
              </details>
              {/*
                Where someone stares at the browser bars and pauses to look for
                a setting. There is no in-page fullscreen on iPhone Safari — no
                Fullscreen API outside <video>, and its own toolbar hiding only
                answers to scrolling, which this screen deliberately cannot do —
                so the Home Screen really is the answer, and this is where it
                gets asked for.
              */}
              {inputPresentation.touchFirst && !fullscreenOffered && (
                <p
                  data-testid="pause-home-screen-tip"
                  style={{
                    width: "min(330px, 100%)",
                    margin: "0 auto 18px",
                    opacity: 0.72,
                    font: "600 11px/1.5 system-ui, sans-serif",
                  }}
                >
                  Browser bars in the way? Tap <strong>Share</strong> then{" "}
                  <strong>Add to Home Screen</strong>, and open the game from
                  there for a full screen.
                </p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button autoFocus type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={() => sessionRef.current?.setPaused(false)}>
                  RESUME
                </button>
                {onExit && (
                  <button type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={onExit}>
                    EXIT TO MENU
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {criticalOverlay && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 28,
              background: "#172226",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
              // Without this the app's HUD painted its wallet card straight
              // through "Preparing your drive…".
              zIndex: DRIVE_LAYER.curtain,
            }}
          >
            <div style={{ maxWidth: 470 }}>
              <div
                aria-hidden="true"
                style={{
                  margin: "0 auto 18px",
                  width: 54,
                  height: 54,
                  borderRadius: 18,
                  border: "5px solid #f2c658",
                  transform: "rotate(45deg)",
                  animation: runtimeState === "loading" ? "sideswap-loading-spin 2.2s linear infinite" : undefined,
                }}
              />
              <strong style={{ display: "block", marginBottom: 9, fontSize: 23 }}>
                {runtimeState === "unsupported" && "This browser cannot start the 3D drive"}
                {runtimeState === "context-lost" && "The 3D view was interrupted"}
                {runtimeState === "error" && "The training yard could not load"}
                {runtimeState === "loading" && "Preparing your drive…"}
              </strong>
              <span style={{ opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
                {runtimeState === "unsupported"
                  ? "Curbside Rush needs WebGL 2 with hardware acceleration. Try an up-to-date Chrome, Edge, Firefox, or Safari browser."
                  : runtimeState === "context-lost"
                    ? "Your position is safe. The lesson is paused while the browser restores graphics."
                    : runtimeState === "error"
                      ? "Refresh the page to rebuild the lesson. Your saved progress is unaffected."
                      : "Building roads, traffic, and your cockpit."}
              </span>
              {runtimeState === "loading" && (
                <div style={{ marginTop: 20 }}>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={loadPercent}
                    aria-valuetext={`${loadProgress.label} ${loadPercent}%`}
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.12)",
                      overflow: "hidden",
                    }}
                  >
                    {/* No width transition, deliberately: the % text has none either
                        (it can't — it's discrete text), so animating the fill would
                        make it lag behind the number it's supposed to equal on every
                        jump. They must always read the same value at the same instant. */}
                    <div
                      style={{
                        width: `${loadPercent}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "linear-gradient(90deg, #d9a53e, #f2c658)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
                          animation: "sideswap-loading-shimmer 1.6s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                  {/* aria-hidden: a sighted-only duplicate of the progressbar's own
                      aria-valuetext. The card above is role="status" (a live region),
                      and this text changes many times a second — without hiding it, a
                      screen reader would re-announce every percentage tick instead of
                      the rare, meaningful state changes the region exists for. */}
                  <div
                    aria-hidden="true"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.68,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{loadProgress.label}</span>
                    <span>{loadPercent}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/*
          Deliberately a scrim over a live, paused scene rather than an opaque
          wall. `screen.orientation.lock()` has never shipped in Safari, so a
          phone held in portrait cannot be corrected by the page — the overlay
          is the only lever there is, which makes rotating back out of it a
          thing players will do repeatedly. It used to cost a full city rebuild,
          because the session-creation effect refused to construct Babylon at
          all while the gate was up. It now only pauses.
        */}
        {touchPortraitGate && (
          <div
            role="dialog"
            aria-label="Rotate device"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 30,
              background: "rgba(12,20,22,.72)",
              backdropFilter: "blur(3px)",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
              zIndex: DRIVE_LAYER.curtain,
            }}
          >
            <div style={{ ...glassPanelStyle, padding: "22px 26px", borderRadius: 20 }}>
              <div aria-hidden="true" style={{ fontSize: 44, marginBottom: 12 }}>
                ↻
              </div>
              <strong style={{ display: "block", fontSize: 21, marginBottom: 8 }}>
                Turn your phone sideways
              </strong>
              <span style={{ display: "block", opacity: 0.7, fontSize: 14, maxWidth: 260 }}>
                Your drive is paused right where you left it.
              </span>
            </div>
          </div>
        )}
      </div>
    );
  },
);

GameCanvas.displayName = "GameCanvas";

export default GameCanvas;
