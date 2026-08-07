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
  Frustum,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Plane,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type {
  AuthoredSignalHeadVisual,
  CameraMode,
  CutsceneRequest,
  DriveScenario,
  DriveGear,
  GameCanvasLane,
  GameCanvasMapPack,
  GameCanvasPoint,
  GameHudSnapshot,
  GameRuntimeEvent,
  PlayerVehicleOption,
  PlayerVehiclePhysics,
  RailwayCrossingVisual,
  SpeedUnit,
  SteeringSide,
  TrafficSide,
  TurnIndicator,
} from "../sessionContract";
import {
  buildRoadSurfaceStripGeometry,
  collectRoadJunctionFills,
  smoothClosedRoadCenterline,
  type RoadJunctionFill,
} from "../geometry/roadStrips";
import {
  BUILDING_GROUND_LIFT,
  clampHorizontalFieldOfView,
  GRASS_DETAIL_TILE_M,
  GRASS_TILE_M,
  PRIMARY_CAMERA_LAYER_MASK,
  ROAD_JUNCTION_FILL_Y,
  ROAD_SHOULDER_JUNCTION_FILL_Y,
  ROAD_SHOULDER_Y,
  ROAD_SURFACE_Y,
  WORLD_LAYER_MASK,
} from "./renderConstants";
import {
  AdaptiveInputRouter,
  isCameraStackActive,
  resolveCockpitCameraPoses,
  type AdaptiveInputPresentation,
} from "../adaptiveInputRouter";
import {
  createAsphaltTexture,
  createGrassDetailTexture,
  createGrassTexture,
  makeFacadeEmissiveTexture,
} from "./proceduralTextures";
import {
  appendDashedMarkingBoxes,
  appendSolidMarkingBoxes,
  createBox,
  createCylinder,
  createFacadeBox,
  createMarkingGeometry,
  makeFacadeMaterial,
  type MarkingGeometry,
} from "./meshPrimitives";
import {
  AMBIENT_CROWD_CONFIG,
  crowdClothingPaletteForMap,
  DEFAULT_ROAD_USER_RADII,
  PROP_MIN_STRIKE_SPEED_MPS,
  type DestructibleProp,
  type DestructiblePropPart,
} from "./propCatalog";
import { createSkyAndHorizon, createSunShadows } from "./skyAndShadows";
import { buildRoadsideProps } from "./roadsideProps";
import {
  buildRepairShop,
  collectBuildingExclusions,
  instantiateProp,
  placeProp,
} from "./venueProps";
import { buildRegulatorySigns, buildSpeedLimitSigns } from "./londonLandmarks";
import {
  cityRenderRegistryFor,
  type CityRenderRegistryCtx,
} from "./cityRenderRegistry";
import { WaterLayer } from "./waterLayer";
import { buildCockpit } from "./cockpitBuilder";
import { governRenderScaling } from "./perfGovernor";
import {
  buildRailwayCrossingInstallation,
  buildRoadMarkingInstallation,
  buildSignalInstallation,
  createTrafficControlMasters,
  type TrafficControlMaterials,
} from "./trafficControlRender";
import { Destructibles } from "./destructibles";
import {
  buildFlatPolygonMesh,
  buildParkFeatures,
  buildParkLawn,
  buildParkLawnPolygon,
  createParksRenderMasters,
} from "./parksRender";
import {
  type MirrorFrameInputs,
  MirrorRig,
  type MirrorRigCtx,
} from "./mirrorRig";
import { CutsceneDirector, type CutsceneDirectorCtx } from "./cutsceneDirector";
import {
  LANE_PAINT_STYLES,
  signalStopBarSegment,
  trafficCameraHeadIds,
} from "../geometry/roadFurnitureLayout";
import { WATER_BOAT_MODEL_URLS } from "../geometry/waterGeometry";
import {
  cairoFrontageFootprintsOverlap,
  cairoFrontagePosition,
  deterministicSceneryKeep,
  facadeGridCells,
  isInsideKeepOut,
  keptStreetWallBuildings,
  rotateBlockBuildingPlacements,
  stagedBlockersOf,
  type CairoFrontageFootprint,
} from "../geometry/facadesAndKeepouts";
import {
  biasCairoDecalMaterials,
  boxLengthYaw,
  CAIRO_STREET_WALL_URL_RE,
  roadSideParkLawnPolygon,
  shorelineParapetRuns,
} from "../geometry/cairoParkland";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type NpcVehicleVariant,
  type SimulationInput,
  type SimulationRuleEvent,
  type SimulationSnapshot,
} from "../simulation";
import {
  buildSimulationCoreConfig,
  resolveAmbientVehicleCount,
  resolveSimulationLaneAnchor,
  resolveVenuePlacement,
  type StaticObstacle,
} from "../simulationAdapter";
import { resolveServicePointLot } from "../servicePoints";
import { PROP_MODEL_FOOTPRINTS_M } from "../propFootprints";
import { MIRROR_RADIUS_M } from "../mirrorRenderList";
import {
  COCKPIT_SPEEDO_MAX_MPS,
  resolveGaugeNeedleAngle,
  resolveSteeringWheelSpin,
  resolveWingMirrorPose,
} from "../cockpitLayout";
import { releaseTouchSteer } from "../touchSteering";
import {
  POSE_SNAP_STEP_M,
  lerpHeading,
  lerpValue,
  shouldSnapPose,
} from "../renderInterpolation";
import { type InputCapabilities } from "../pointerCapabilities";
import {
  createRenderScalingState,
  desktopHardwareScalingLevel,
  RENDER_SCALING_WARMUP_MS,
  renderScalingLevel,
  TOUCH_TARGET_FPS,
  type RenderScalingState,
} from "../renderScaling";
import { type StagedBlocker } from "../cutsceneScript";
import { DriveAudio } from "../audio/DriveAudio";
import {
  ENGINE,
  GEAR_TOP_MPS,
  MOTORBIKE_ENGINE_PROFILE,
  targetRpm,
} from "../audio/audioMath";
import {
  authoredSignalAspectAt,
  trafficCameraControlIds,
  type AuthoredSignalAspect,
} from "../trafficSignals";
import {
  buildPlanarUVs,
  hashStringToSeed,
  mixHexColors,
  PAVED_SIDEWALK_WIDTH_M,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  seededUnit,
  type MapVisualPalette,
} from "../visuals";
import {
  natureModelsForMap,
  natureSetUrls,
  natureSetsForMap,
} from "../natureCatalog";
import {
  ROAD_DIVIDED_PARK_IDS,
  type ParkPlacement,
} from "../parkLayouts";
import {
  createVehicleMesh,
  type VehicleMeshVisual,
} from "../vehicleMeshes";
import {
  policeBeaconLamps,
  resolvePlayerVehicleAppearance,
  resolveTrafficVehicleAppearance,
  type VehicleAppearance,
  type VehicleModel,
} from "../vehicleVisuals";
import {
  disposeModels,
  instantiateModel,
  instantiateModelInstanced,
  modelMaterials,
  preloadModels,
  propModelUrls,
  vehicleModelUrls,
} from "../modelLibrary";
import {
  buildingPlacementConfig,
  buildingSetUrls,
  isBuildingSetId,
  nycVendorUrls,
  slotBlockBuildings,
  type BuildingSetId,
  type PlacedBuilding,
  type StreetPropConfig,
} from "../buildingSets";
import {
  orientMergedFacesOutward,
  recentreMergedMasterXZ,
  squareUpMergedMaster,
} from "../buildingWinding";
import {
  pickStorefrontVariant,
  STOREFRONT_MODEL_ID,
  type StorefrontVariant,
} from "../storefronts";
import { assembleStorefrontVariantMaster } from "../storefrontMaster";
import { streetAddressesForMap } from "../streetAddresses";
import { speedingWarrantsCitation } from "../speeding";
import {
  regulatorySignPlacements,
  speedLimitSignPlacements,
} from "../regulatorySigns";
import {
  splitMarkingAtCrossings,
  type MarkingPoint,
} from "../roadMarkings";

import {
  buildActorVisual,
  buildCyclistVisual,
  buildMotorbikeVisual,
  buildPedestrianVisual,
  characterModelUrls,
  CHARACTER_MODELS,
  type ActorVisual,
  type CharacterColors,
  type CharacterVisual,
} from "../characterMeshes";
import {
  complexionPaletteForMap,
  hairPaletteForMap,
  type CharacterTone,
} from "../characterPalettes";
import { CrowdRenderer } from "../crowdRenderer";
import {
  SMOKE_HEAVY_CONDITION_PCT,
  SMOKE_LIGHT_CONDITION_PCT,
} from "../damage";
import {
  createCrowdSim,
  WALKER_DOWNED_TOTAL_SECONDS,
  WALKER_FALL_SECONDS,
  WALKER_LIE_SECONDS,
  WALKER_RISE_SECONDS,
  walkerDownedPhase,
  type CrowdSim,
  type WalkerDownedPhase,
} from "../crowdWalkers";
import { buildPavementGraph, type PavementGraph } from "../pavementPaths";
import { PED_TURN_PAUSE_S, stepStroll } from "../pedestrianStroll";

/** Mirrors the simulation's standstill threshold, for deciding which pedal is
 * driving and which is braking when the audio reads the controls. */
const STOPPED_AUDIO_SPEED_MPS = 0.2;


/** Corniche parapet height — a masonry balustrade you read instantly at
 * speed, taller than the 0.95 m park wall by a lean. */
const CORNICHE_PARAPET_HEIGHT_M = 1.05;

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

/**
 * `BabylonGameSession`: the Babylon scene, engine, simulation adapter and
 * every render/input/audio subsystem that a drive owns, moved verbatim out
 * of `GameCanvas.tsx` (Phase 3.14, the last of the god-file decomposition's
 * Phase 3 — `.claude/refactor-plan.md`, gitignored). Unlike every builder
 * extracted earlier in this phase, this is a pure move: no `this.x` -> `ctx.x`
 * de-methodization, since the class doesn't change shape, only address.
 *
 * `GameCanvas.tsx` keeps just the React side — `GameCanvasProps`/
 * the component and the shell/canvas
 * styles — and constructs this class once per `[trafficSide, steeringSide,
 * scenario.id, mapPack.id]` combination; every other prop flows through
 * `updateOptions`. See rendering.md's "Shape of the file" for the ring this
 * sits in and why it stays one file rather than splitting further: at
 * ~7,450 lines it is still one class with ~190 fields, and the plan
 * deliberately treats that as a documented, deferred follow-up rather than a
 * Phase 3 goal — every builder with its own well-scoped seam (mirrors, water,
 * cutscenes, traffic control, parks, cockpit, destructibles, sky, landmarks,
 * props, perf governing) already moved out over the preceding thirteen
 * commits; what's left is the orchestrator that wires them together, plus
 * the simulation/input/audio/camera/HUD machinery no single seam owns.
 */
/** 0..1, monotonically non-decreasing over one load — see LOAD_PHASE_WEIGHTS. */
export interface LoadProgress {
  readonly fraction: number;
  readonly label: string;
}

export interface SessionCallbacks {
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  onInputPresentationChange?: (presentation: AdaptiveInputPresentation) => void;
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
  scenario: DriveScenario;
  mapPack: GameCanvasMapPack;
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

/** Characters stand on the walker plane of the y-stack (matches the ambient
 * crowd's WALKER_Y and the scenario pedestrians), not on y=0 — the road tops
 * out at 0.07, so feet placed at zero read as buried to the ankles. */
const ACTOR_WALK_Y = 0.08;

/** How far inside the pavement a street address's "front door" sits. */
const STREET_DOOR_INSET_M = 3.2;

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
 * prevents a newly activated ambient car from evicting a scripted vehicle.
 */

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

const FIXED_STEP = 1 / 60;

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
const PERF_CAMERA = 4;
const PERF_SCENE_RENDER = 5;
const PERF_STAGE_COUNT = 6;
const PERF_STAGE_NAMES = [
  "simStepMs",
  "snapshotApplyMs",
  "crowdMs",
  "collisionMs",
  "cameraMs",
  "sceneRenderMs",
] as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const eventNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;


function colorFromHex(value: string, fallback: Color3): Color3 {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return new Color3(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

interface ResolvedLaneAnchor extends GameCanvasPoint {
  readonly heading: number;
  readonly segmentIndex: number;
  readonly distanceOnSegment: number;
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

export class BabylonGameSession {
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
  /** The scenario's full solid set, kept so scenery that renders a collider
   * (the corniche parapet) reads the SAME source the simulation stands on. */
  private readonly scenarioStaticObstacles: readonly StaticObstacle[];
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
  private cutsceneDirector: CutsceneDirector | null = null;
  /** Highest request nonce already staged, so option echoes can't restart. */
  private handledCutsceneNonce = 0;
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
  private visualElapsedSeconds = 0;
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
  private destructibles: Destructibles | null = null;
  // Built in the constructor, unlike every other collaborator (built in
  // buildScenarioEnvironment): the rear-view mirror must exist before
  // setCameraMode's first applyCameraStack call registers its render target.
  private mirrorRig: MirrorRig | null = null;
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
  private waterLayer: WaterLayer | null = null;
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
  private collisionGraceUntil = 0;
  private ruleElapsedSeconds = 0;
  private instruction = "Explore the city.";
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
  private displayedZ = 0;
  private displayedHeading = 0;
  private cameraMotionSeconds = 0;
  // Set by createSkyAndHorizon from the map's fog band, applied to every
  // camera in the constructor. Babylon's default far plane is 10km.
  private cameraFarPlaneM = 10_000;
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
  private visualPalette: MapVisualPalette;
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
  private wingMirrorCamera: UniversalCamera | null = null;
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
    this.activeTrafficSide = options.trafficSide;
    this.visualPalette = resolveMapVisualPalette(options.mapPack.id);
    // Per-vehicle physics land after the adapter's config so a career
    // vehicle's caps override the scenario baseline; free drive passes null
    // and keeps the adapter's numbers untouched.
    const simulationConfig = buildSimulationCoreConfig({
      scenario: options.scenario,
      mapPack: options.mapPack,
      trafficSide: this.activeTrafficSide,
      speedUnit: options.speedUnit,
      touchFirst: options.inputCapabilities.touchFirst,
    });
    this.stagedBlockers = stagedBlockersOf(
      simulationConfig.staticObstacles ?? [],
    );
    this.scenarioStaticObstacles = simulationConfig.staticObstacles ?? [];
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
    this.collisionGraceUntil = eventNow() + 2_000;
    this.displayedX = start.x;
    this.displayedZ = start.z;
    this.displayedHeading = start.heading;

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
    // Before buildEnvironment: buildScenarioEnvironment builds the cockpit,
    // which calls back into buildWingMirror before this constructor ever
    // reaches the rear-view mirror's own build() call further down.
    this.mirrorRig = new MirrorRig(this.scene);
    this.cutsceneDirector = new CutsceneDirector(this.scene);
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
    this.mirrorRig.build(this.mirrorRigCtx());
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
    this.emit({ type: "ready" });
    this.publishHud(true);
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
    this.mirrorRig?.layoutPanels(this.mirrorRigCtx());
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
      this.cutsceneDirector?.start(this.cutsceneDirectorCtx(), cutsceneRequest);
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
    this.simulation.setPaused(paused);
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
    this.mirrorRig?.setActive(firstPerson);
  }

  setCameraMode(mode: CameraMode, notify = true) {
    const activeCameraNames =
      this.scene.activeCameras?.map((camera) => camera.name) ?? [];
    if (
      this.cameraMode === mode &&
      (this.cutsceneDirector?.isActive ||
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
    if (!this.cutsceneDirector?.isActive) this.applyCameraStack(firstPerson);
    if (notify) this.callbacks.onCameraChange?.(mode);
    this.publishHud(true);
  }

  toggleCamera() {
    // The staged shot owns the camera while an interaction scene plays.
    if (this.cutsceneDirector?.isActive) return;
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
    this.publishHud(true);
  }

  hornRelease() {
    if (!this.hornHeld) return;
    this.hornHeld = false;
    this.audio?.hornRelease();
    this.publishHud(true);
  }

  reset() {
    this.cutsceneDirector?.cancel(this.cutsceneDirectorCtx());
    this.simulation.resetToSpawn();
    this.applySimulationSnapshot(this.simulation.getSnapshot());
    this.processSimulationEvents(this.simulation.drainEvents());
    this.clearHeldInputs();
    // Pin the blend pair explicitly so the first frame after a reset shows the
    // authored spawn pose.
    this.playerState.previousX = this.playerState.x;
    this.playerState.previousZ = this.playerState.z;
    this.playerState.previousHeading = this.playerState.heading;
    this.displayedX = this.playerState.x;
    this.displayedZ = this.playerState.z;
    this.displayedHeading = this.playerState.heading;
    this.snapChaseCameraToPose();
    this.instruction = "Reset to the authored start.";
    this.publishHud(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // QA hooks close over this session; left on window after dispose they pin the disposed scene
    // graph — and hand QA a dead session — until the next mount overwrites them.
    if (typeof window !== "undefined") {
      const debugWindow = window as unknown as Record<string, unknown>;
      for (const key of [
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
    this.cutsceneDirector?.dispose(this.cutsceneDirectorCtx());
    this.engine.stopRenderLoop(this.renderFrame);
    // Withdraw the mirrors before the scene goes: a render target left in
    // customRenderTargets keeps its render list — and through it the whole
    // scene graph — alive past dispose.
    this.mirrorRig?.dispose();
    this.mirrorRig = null;
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
    this.waterLayer?.dispose();
    this.waterLayer = null;
    this.destructibles?.dispose();
    this.destructibles = null;
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
          this.options.mapPack.id,
          this.options.playerVehicle,
        ),
      );
    }
    const trafficSeed = this.options.scenario.trafficSeed;
    const mapId = this.options.mapPack.id;
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
    return this.options.mapPack.id;
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
   * crowd and the scenario road users. */
  private ensurePavementGraph(): PavementGraph | null {
    if (this.pavementGraph !== undefined) return this.pavementGraph;
    this.pavementGraph = null;
    const mapPack = this.options.mapPack;
    const surfaces = mapPack.geometry.roadSurfaces;
    if (!surfaces?.length) return null;
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
      this.waterLayer?.update(this.visualElapsedSeconds);
    }
    const interpolation = this.paused ? 1 : this.accumulator / FIXED_STEP;
    if (!this.paused) {
      this.cutsceneDirector?.advance(this.cutsceneDirectorCtx(), frameSeconds);
    }
    this.updatePlayerVisuals(interpolation);
    this.updateNpcVisuals(interpolation);
    if (!this.paused) this.destructibles?.update(frameSeconds);
    if (this.damageSmoke?.isStarted()) {
      // Trail the smoke from the engine bay, wherever the car is facing.
      this.damageSmokeEmitter.set(
        this.displayedX + Math.sin(this.displayedHeading) * 1.05,
        0.92,
        this.displayedZ + Math.cos(this.displayedHeading) * 1.05,
      );
    }
    let mark = performance.now();
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
    const scalingResult = governRenderScaling(
      {
        renderScaling: this.renderScaling,
        paused: this.paused,
        contextLost: this.contextLost,
        renderScalingArmedAt: this.renderScalingArmedAt,
        lastRenderScalingCheck: this.lastRenderScalingCheck,
        engine: this.engine,
        shadowGenerator: this.shadowGenerator,
        windscreenParts: this.windscreenParts,
        cameraMode: this.cameraMode,
        rearViewPanel: this.mirrorRig?.rearViewPanel ?? null,
        wingMirrorRig: this.mirrorRig?.wingMirrorRig ?? null,
        setMirrorsAllowed: (allowed) => {
          if (this.mirrorRig) this.mirrorRig.mirrorsAllowed = allowed;
        },
        setMirrorsActive: (active) => this.mirrorRig?.setActive(active),
        syncWingMirrorVisibility: () =>
          this.mirrorRig?.syncVisibility(this.mirrorRigCtx()),
      },
      now,
    );
    if (scalingResult) {
      this.lastRenderScalingCheck = scalingResult.lastRenderScalingCheck;
    }
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
    };
    let mark = performance.now();
    const snapshot = this.simulation.step(dt, simulationInput);
    this.perfSample(PERF_SIM_STEP, performance.now() - mark);
    mark = performance.now();
    this.applySimulationSnapshot(snapshot);
    this.perfSample(PERF_SNAPSHOT_APPLY, performance.now() - mark);
    const events = this.simulation.drainEvents();
    this.processSimulationEvents(events);
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

  private mergedInput(): AnalogInput {
    // The "game is unplayable" contract while an interaction scene plays:
    // every consumer (sim input, engine audio, steering visual, quick-look)
    // reads through here, so one gate locks them all.
    if (this.cutsceneDirector?.isActive) return CUTSCENE_LOCKED_INPUT;
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
      trafficSeed: this.options.scenario.trafficSeed,
      variant,
      mapId: this.options.mapPack.id,
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

  /** Once the prop glbs preload, replace each procedural venue/station box with
   * its imported model, disposing the fallback. Kinds whose glb never loaded stay
   * procedural. Mirrors upgradeRoadUsersToModels for the environment props. */
  private upgradePropsToModels() {
    const stillProcedural: typeof this.deferredProps = [];
    for (const prop of this.deferredProps) {
      if (
        instantiateProp(
          { scene: this.scene },
          prop.kind,
          prop.x,
          prop.z,
          prop.heading,
          prop.label,
        )
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

    this.waterLayer?.instantiatePendingBoats((url) => this.getBuildingMaster(url));

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
      this.destructibles?.register("vendor", vendor.x, vendor.z, 1, [
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
    const key = resolveMapVisualKey(this.options.mapPack.id);
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
      this.destructibles?.register(
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

  /** The car's two capsule circles against every standing prop nearby. Grid
   * walk, contact math and the fall animation live in the `Destructibles`
   * collaborator; the simulation report (and its audio/event side effects)
   * stay here, since render/ must never depend on simulation.ts or audio —
   * threaded in as `reportDestructibleStrike`, which returns whether the
   * strike should actually animate. */
  private checkDestructiblePropCollisions() {
    if (
      this.simulationSnapshot.status !== "running" ||
      this.playerState.speedMps < PROP_MIN_STRIKE_SPEED_MPS
    ) {
      return;
    }
    this.destructibles?.checkCollisions(
      this.playerState.x,
      this.playerState.z,
      this.playerState.heading,
      (prop) => this.reportDestructibleStrike(prop),
      (x, y, z, count) => this.emitImpactBurst(x, y, z, count),
    );
  }

  /** Reports a destructible-prop strike to the simulation and plays its
   * audio; returns whether `Destructibles` should animate the fall (true for
   * every accepted or damage-"none" strike, false only when the simulation
   * declines to report it). */
  private reportDestructibleStrike(prop: DestructibleProp): boolean {
    const impactSpeed = this.playerState.speedMps;
    if (prop.config.damage !== "none") {
      const reported = this.simulation.reportExternalContact(
        "Mind the kerbside furniture.",
        prop.config.speedScale,
        {
          obstacle: "prop",
          propKind: prop.kind,
          impactSpeedMps: Math.round(impactSpeed * 10) / 10,
        },
      );
      if (!reported) return false;
      const snapshot = this.simulation.getSnapshot();
      this.applySimulationSnapshot(snapshot);
      this.processSimulationEvents(this.simulation.drainEvents());
      this.audio?.impact(impactSpeed * 0.55, eventNow());
    } else {
      this.audio?.impact(Math.min(impactSpeed * 0.2, 1.5), eventNow());
    }
    return true;
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
      npc.node.setEnabled(vehicle.id !== this.cutsceneDirector?.hiddenNpcSimulationId);
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
    // A gap no legal drive can produce is a teleport (for example a tow
    // reset): snap the pair together so the render blend never streaks the
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
    this.activeTrafficSide = snapshot.trafficSide;
    this.applySimulationNpcSnapshots(snapshot);
    this.updateAuthoredSignalVisuals();

    const npcHonkActive = snapshot.honk.active;
    if (npcHonkActive && !this.lastSimulationHonkActive) {
      this.hornUntil = eventNow() + 1_150;
      // Pitched and muffled differently from your own horn, so being honked at
      // reads as another car rather than a phantom press of your own button.
      this.audio?.hornBlip(0.6, snapshot.tick);
    }
    this.lastSimulationHonkActive = npcHonkActive;
  }

  private processSimulationEvents(events: readonly SimulationRuleEvent[]) {
    // A scene owns the car while it runs — the driver's hands are off the
    // wheel, and a traffic stop is actively steering it across lanes onto the
    // kerb. Every rule the monitors trip in that window is an artifact of the
    // choreography rather than something the player did, so none of it is
    // voiced, scored or charged for. It also closes the obvious loop: without
    // this, the pull-over's own kerb-side park would read as leaving the road
    // and summon a second pull-over the moment the first ended.
    if (this.cutsceneDirector?.isActive) return;
    for (const event of events) {
      const correction = event.correction;
      this.instruction = correction;
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
        event.code === "collision"
          ? { type: "collision", evidence: event.evidence }
          : {
              type: "coaching",
              ruleCode: event.code,
              evidence: event.evidence,
            },
      );
      if (
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
          this.emit({
            type: "fine",
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
          this.emit({
            type: "fine",
            ruleCode: event.code,
            evidence: event.evidence,
            issuedBy: "camera",
          });
        }
      }
    }
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
      0.12 - (this.cutsceneDirector?.dipOffset ?? 0),
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
    const forward = this.cameraForwardScratch.set(
      Math.sin(this.displayedHeading),
      0,
      Math.cos(this.displayedHeading),
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

    const cutsceneCameraPosition = this.cutsceneDirector?.cameraPosition ?? null;
    const cutsceneCameraTarget = this.cutsceneDirector?.cameraTarget ?? null;
    if (cutsceneCameraPosition && cutsceneCameraTarget) {
      // The staged wide shot: glide to it on the same lerp the chase camera
      // uses (slower, for a cinematic ease); the chase/cockpit pose resumes
      // through the same smoothing when the scene ends.
      if (this.options.reducedMotion) {
        this.thirdCamera.position.copyFrom(cutsceneCameraPosition);
      } else {
        const smooth = 1 - Math.exp(-3.5 * dt);
        Vector3.LerpToRef(
          this.thirdCamera.position,
          cutsceneCameraPosition,
          smooth,
          this.thirdCamera.position,
        );
      }
      // allowSamePosition: see the camera scratch fields — without it a
      // retained target object suppresses the spherical rebuild and the
      // position writes above are clobbered.
      this.thirdCamera.setTarget(cutsceneCameraTarget, undefined, true);
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

  private buildScenarioEnvironment(mapPack: GameCanvasMapPack) {
    const scene = this.scene;
    const mapId = mapPack.id.toLowerCase();
    const palette = resolveMapVisualPalette(mapId);
    const cairoScene = resolveMapVisualKey(mapId) === "cairo";
    this.visualPalette = palette;
    this.destructibles = new Destructibles(scene);
    const parksRenderCtx = {
      scene,
      masters: createParksRenderMasters(),
      lowSpec: this.lowSpec,
      registerMirrorSurface: (mesh: AbstractMesh | undefined | null) =>
        this.mirrorRig?.registerSurface(mesh),
      applyGrassDetailMap: (material: StandardMaterial, id: string) =>
        this.applyGrassDetailMap(material, id),
      applyWorldPlanarGrassUVs: (mesh: Mesh, offsetX?: number, offsetZ?: number) =>
        this.applyWorldPlanarGrassUVs(mesh, offsetX, offsetZ),
      registerStaticCell: (mesh: AbstractMesh, x: number, z: number, castsShadow: boolean) =>
        this.registerStaticCell(mesh, x, z, castsShadow),
      registerShadowCaster: (mesh: AbstractMesh, x: number, z: number) =>
        this.registerShadowCaster(mesh, x, z),
      createRoadSurfaceMesh: (
        name: string,
        centerline: readonly GameCanvasPoint[],
        widthM: number,
        material: StandardMaterial,
        smoothClosed?: boolean,
        surfaceY?: number,
      ) =>
        this.createRoadSurfaceMesh(
          name,
          centerline,
          widthM,
          material,
          smoothClosed,
          surfaceY,
        ),
    };
    const cityRenderCtx: CityRenderRegistryCtx = {
      scene,
      staticSceneryFreeze: this.staticSceneryFreeze,
      visualPalette: palette,
      registerShadowCaster: (mesh, x, z) => this.registerShadowCaster(mesh, x, z),
      registerDestructibleProp: (kind, x, z, scale, parts) =>
        this.destructibles?.register(kind, x, z, scale, parts),
      buildFlatPolygonMesh: (id, polygon, y, polygonMaterial) =>
        buildFlatPolygonMesh(parksRenderCtx, id, polygon, y, polygonMaterial),
      buildParkLawnPolygon: (id, polygon, polygonPalette, mapPackId) =>
        buildParkLawnPolygon(parksRenderCtx, id, polygon, polygonPalette, mapPackId),
    };
    this.cameraFarPlaneM = createSkyAndHorizon(
      { scene, registerMirrorSurface: (mesh) => this.mirrorRig?.registerSurface(mesh) },
      palette,
      mapId,
      mapPack.geometry.worldSize,
    ).cameraFarPlaneM;

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
    const laneMaterial = makeMaterial(scene, "scenario-marking", new Color3(0.88, 0.88, 0.79));
    const yellowMarkingMaterial = makeMaterial(
      scene,
      "scenario-yellow-marking",
      new Color3(0.9, 0.68, 0.08),
    );
    const dark = makeMaterial(scene, "scenario-fixture", new Color3(0.08, 0.1, 0.1));
    const stopRed = makeMaterial(scene, "scenario-stop", new Color3(0.72, 0.08, 0.06));
    const yieldGold = makeMaterial(scene, "scenario-yield", new Color3(0.92, 0.68, 0.13));
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
    const scenarioSunShadows = createSunShadows(
      {
        visualPalette: this.visualPalette,
        touchFirst: this.options.inputCapabilities.touchFirst,
      },
      sun,
    );
    this.shadowGenerator = scenarioSunShadows.shadowGenerator;
    this.shadowRefreshSeconds = scenarioSunShadows.shadowRefreshSeconds;

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
    this.mirrorRig?.registerSurface(ground);
    const waterLayer = new WaterLayer(scene);
    waterLayer.build(mapPack, mapId, {
      palette: this.visualPalette,
      lowSpec: this.lowSpec,
      registerMirrorSurface: (mesh) => this.mirrorRig?.registerSurface(mesh),
    });
    this.waterLayer = waterLayer;

    // The corniche parapet: one hidden unit-box master, one instance per
    // shoreline collider run, scaled to the collider's exact plan footprint —
    // ~35 instances for both Nile banks at one draw call, versus the park
    // walls' box-per-run. Cairo only: London's shoreline runs belong to a
    // park lake whose kerb the park already dresses.
    if (cairoScene) {
      const parapetRuns = shorelineParapetRuns(this.scenarioStaticObstacles);
      if (parapetRuns.length) {
        const parapetMaterial = makeMaterial(
          scene,
          "corniche-parapet",
          colorFromHex(
            mixHexColors(palette.pavement ?? "#aaa18f", "#e8dcc2", 0.45),
            new Color3(0.71, 0.66, 0.57),
          ),
        );
        const parapetMaster = createBox(
          scene,
          "corniche-parapet-master",
          { width: 1, height: 1, depth: 1 },
          Vector3.Zero(),
          parapetMaterial,
        );
        parapetMaster.isVisible = false;
        parapetMaster.isPickable = false;
        for (const run of parapetRuns) {
          const parapet = parapetMaster.createInstance(`${run.id}-parapet`);
          parapet.position.set(run.x, CORNICHE_PARAPET_HEIGHT_M / 2, run.z);
          parapet.scaling.set(
            run.halfU * 2,
            CORNICHE_PARAPET_HEIGHT_M,
            run.halfV * 2,
          );
          parapet.rotation.y = boxLengthYaw(run.ux, run.uz);
          parapet.isPickable = false;
          this.staticSceneryFreeze.push(parapet);
          this.registerStaticCell(parapet, run.x, run.z, false);
        }
        parapetMaterial.freeze();
      }
    }

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
    const roadSurfaces = authoredRoadSurfaces;
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
      this.mirrorRig?.registerSurface(
        this.createRoadSurfaceMesh(
          `road-shoulder-${surface.id}`,
          surface.centerline,
          surface.widthM + shoulderWidth * 2,
          dirtShoulder,
          surface.surfaceType === "roundabout",
          ROAD_SHOULDER_Y,
        ),
      );
      this.mirrorRig?.registerSurface(
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
    this.mirrorRig?.registerSurface(
      this.buildMergedMarkingMesh("road-markings-white", whitePaint, laneMaterial),
    );
    this.mirrorRig?.registerSurface(
      this.buildMergedMarkingMesh(
        "road-markings-yellow",
        yellowPaint,
        yellowMarkingMaterial,
      ),
    );
    const random = seededUnit(this.options.scenario.trafficSeed);
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
    collectBuildingExclusions(
      { scene, deferredProps: this.deferredProps, buildingExclusions: this.buildingExclusions },
      mapPack,
    );

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
        buildRepairShop({ scene }, service.id, lot, pose.heading, service.label);
        continue;
      }
      placeProp(
        {
          scene,
          deferredProps: this.deferredProps,
          buildingExclusions: this.buildingExclusions,
        },
        service.kind,
        px,
        pz,
        pose.heading,
        service.id,
        (parent) => {
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
        },
        service.label,
      );
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
      placeProp(
        {
          scene,
          deferredProps: this.deferredProps,
          buildingExclusions: this.buildingExclusions,
        },
        modelKey,
        px,
        pz,
        pose.heading,
        venue.id,
        (parent) => {
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
        },
        venue.name,
      );
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
      const cityLandmarks = cityRenderRegistryFor(mapId)?.landmarks;
      if (cityLandmarks && cityLandmarks(cityRenderCtx, landmark, material, mapPack)) {
        continue;
      }
      if (landmark.kind === "park") {
        // The centre "feature" cone is gone. It was the whole of a park's
        // contents, and the thing issue #206 is a screenshot of; a park is now
        // dressed by `parkLayouts` and bounded by its own wall.
        if (ROAD_DIVIDED_PARK_IDS.has(landmark.id)) {
          // A road is authored through this rect; the raw rectangle would
          // surface as grass on the far kerbside.
          buildParkLawnPolygon(
            parksRenderCtx,
            landmark.id,
            roadSideParkLawnPolygon(
              landmark,
              mapPack.geometry.roadSurfaces ?? [],
            ),
            palette,
            mapId,
          );
        } else {
          buildParkLawn(parksRenderCtx, landmark, palette, mapId);
        }
        buildParkFeatures(parksRenderCtx, landmark, mapPack, palette, mapId);
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

    cityRenderRegistryFor(mapId)?.streetFurniture?.(cityRenderCtx);

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
    const trafficControlMasters = createTrafficControlMasters();
    const trafficControlRenderCtx = {
      scene,
      masters: trafficControlMasters,
      staticSceneryFreeze: this.staticSceneryFreeze,
      authoredSignalHeads: this.authoredSignalHeads,
      railwayCrossingVisuals: this.railwayCrossingVisuals,
      optionsMapPack: this.options.mapPack,
      createFlatSegment: (
        name: string,
        start: GameCanvasPoint,
        end: GameCanvasPoint,
        width: number,
        y: number,
        material: StandardMaterial,
      ) => this.createFlatSegment(name, start, end, width, y, material),
    };
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
          buildSignalInstallation(
            trafficControlRenderCtx,
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
          buildRailwayCrossingInstallation(
            trafficControlRenderCtx,
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
          buildRoadMarkingInstallation(
            trafficControlRenderCtx,
            mapPack,
            control,
            installation,
            laneMaterial,
            warningYellow,
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
    const londonLandmarksCtx = {
      scene,
      staticSceneryFreeze: this.staticSceneryFreeze,
      registerShadowCaster: (mesh: AbstractMesh, x: number, z: number) =>
        this.registerShadowCaster(mesh, x, z),
      registerDestructibleProp: (
        kind: string,
        x: number,
        z: number,
        scale: number,
        parts: readonly DestructiblePropPart[],
      ) => this.destructibles?.register(kind, x, z, scale, parts),
    };
    if (regulatorySigns.length) {
      buildRegulatorySigns(londonLandmarksCtx, regulatorySigns);
    }
    if (speedLimitSigns.length) {
      buildSpeedLimitSigns(
        londonLandmarksCtx,
        speedLimitSigns,
        mapPack.countryIds?.[0] ?? "us",
      );
    }
    buildRoadsideProps(
      {
        scene,
        staticSceneryFreeze: this.staticSceneryFreeze,
        pendingVendors: this.pendingVendors,
        pendingParkProps: this.pendingParkProps,
        pendingParkThickets: this.pendingParkThickets,
        buildingKeepFraction: this.buildingKeepFraction,
        registerShadowCaster: (mesh, x, z) =>
          this.registerShadowCaster(mesh, x, z),
        registerDestructibleProp: (kind, x, z, scale, parts) =>
          this.destructibles?.register(kind, x, z, scale, parts),
      },
      mapPack,
      palette,
      mapId,
      roadSurfaces,
      [...regulatorySigns, ...speedLimitSigns],
    );

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
    // every other centreline relies on auto-detection so authored loops get
    // mitered corners instead of
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

  /** QA's window hooks, installed once per session and removed on dispose. */
  private installDebugHooks() {
    if (typeof window === "undefined") return;
    {
      const debugWindow = window as unknown as Record<string, unknown>;
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
        mirrorRenders: this.mirrorRig?.renderCount ?? 0,
        mirrorCandidates: this.mirrorRig?.candidateCount ?? 0,
        mirrorDrawn: this.mirrorRig?.drawnCount ?? 0,
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
        active: this.cutsceneDirector?.debugSnapshot() ?? null,
        playerX: Math.round(this.playerState.x * 100) / 100,
        playerZ: Math.round(this.playerState.z * 100) / 100,
        playerHeading: Math.round(this.playerState.heading * 1000) / 1000,
        cameraMode: this.cameraMode,
        activeCamera: this.scene.activeCamera?.name ?? null,
        dip: Math.round((this.cutsceneDirector?.dipOffset ?? 0) * 1000) / 1000,
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

  /** Every field `MirrorRig`'s build/layout/visibility methods read off the
   * session; constructed fresh at every call site rather than cached, since
   * `steeringSide`/camera FOV/viewport size all change under it. */
  private mirrorRigCtx(): MirrorRigCtx {
    return {
      firstCamera: this.firstCamera,
      rearCamera: this.rearCamera,
      playerCockpit: this.playerCockpit,
      cameraFarPlaneM: this.cameraFarPlaneM,
      steeringSide: this.options.steeringSide,
      engineRenderWidth: this.engine.getRenderWidth(),
      engineRenderHeight: this.engine.getRenderHeight(),
      gatherFrameState: () => this.gatherMirrorFrameState(),
    };
  }

  private cutsceneDirectorCtx(): CutsceneDirectorCtx {
    return {
      playerState: this.playerState,
      steeringSide: this.options.steeringSide,
      trafficSide: this.options.trafficSide,
      playerVehicle: this.options.playerVehicle,
      mapPack: this.options.mapPack,
      scenarioTrafficSeed: this.options.scenario.trafficSeed,
      thirdCameraX: this.thirdCamera.position.x,
      thirdCameraZ: this.thirdCamera.position.z,
      stagedBlockers: this.stagedBlockers,
      cameraMode: this.cameraMode,
      riderNode: this.riderNode,
      playerCyclistVisual: this.playerCyclistVisual,
      gigVenueCurbside: this.gigVenueCurbside,
      gigVenueDoors: this.gigVenueDoors,
      playFoley: (sound) => this.audio?.foley(sound),
      setPlayerPose: (pose) => this.simulation.setPlayerPose(pose),
      applyCameraStack: (firstPerson) => this.applyCameraStack(firstPerson),
      patrolSimulationIdNear: (radiusM) =>
        this.patrolNearPlayer(radiusM)?.simulationId ?? null,
      passengerColors: (seedId) => this.passengerColors(seedId),
      emit: (event) => this.emit(event),
    };
  }

  /** Captured by `MirrorRig`'s `texture.getCustomRenderList` closures at
   * build time; Babylon calls it on its own schedule for the texture's
   * lifetime, so every read here must be live session state, never a
   * snapshot taken once. */
  private gatherMirrorFrameState(): MirrorFrameInputs {
    return {
      displayedX: this.displayedX,
      displayedZ: this.displayedZ,
      displayedHeading: this.displayedHeading,
      shadowCellM: BabylonGameSession.SHADOW_CELL_M,
      shadowCasterCells: this.shadowCasterCells,
      playerShadowCasters: this.playerVehicleVisual?.shadowCasters ?? [],
      activeNpcShadowCasters: this.npcVehicles
        .filter((npc) => npc.active !== false)
        .map((npc) => npc.visual.shadowCasters),
    };
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
    this.buildScenarioEnvironment(this.options.mapPack);
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
          this.options.mapPack.id,
          this.options.playerVehicle,
        ),
      );
    }
    const cockpit = buildCockpit({
      scene,
      playerCockpit: this.playerCockpit,
      visualPalette: this.visualPalette,
      steeringSide: this.options.steeringSide,
      buildWingMirror: (steeringRubber, shell) => {
        // updateCamera positions this every frame via resolveWingMirrorPose,
        // so the session needs the reference back — buildWingMirror lives on
        // the collaborator, but the camera itself stays session-resident.
        const camera = this.mirrorRig?.buildWingMirror(
          this.mirrorRigCtx(),
          steeringRubber,
          shell,
        );
        if (camera) this.wingMirrorCamera = camera;
      },
    });
    this.steeringAssembly = cockpit.steeringAssembly;
    this.gaugeNeedles = cockpit.gaugeNeedles;
    this.windscreenParts = cockpit.windscreenParts;
  }

  private buildTraffic() {
    this.buildScenarioTraffic(this.options.mapPack, this.options.scenario);
  }

  private buildScenarioTraffic(
    mapPack: GameCanvasMapPack,
    scenario: DriveScenario,
  ) {
    const scene = this.scene;
    const random = seededUnit(scenario.trafficSeed);
    const count = resolveAmbientVehicleCount(
      mapPack,
      scenario.trafficDensity,
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
      const requestedLaneId = authoredAnchor?.laneId ?? legacyLaneId;
      if (
        !requestedLaneId ||
        !usableLanes.some((candidate) => candidate.id === requestedLaneId)
      ) {
        random();
      }
      if (!authoredAnchor) {
        random();
        random();
      }
      // Ambient movement and routing now belong exclusively to SimulationCore.
      // Retain the old slot-builder's draw count before vulnerable-road-user
      // placement so their seeded positions do not move during this purge.
      random();
      const node = new TransformNode(`scenario-npc-${index}`, scene);
      const vehicleId = `npc-${index + 1}`;
      const initialSnapshot = this.simulationSnapshot.npcs.find(
        (vehicle) => vehicle.id === vehicleId,
      );
      const initialVariant =
        initialSnapshot?.variant ?? inferSpawnVehicleVariant(spawn?.id);
      const appearance = resolveTrafficVehicleAppearance({
        vehicleId,
        trafficSeed: scenario.trafficSeed,
        variant: initialVariant,
        mapId: mapPack.id,
      });
      const visual = createVehicleMesh(
        scene,
        node,
        `scenario-${vehicleId}`,
        appearance,
      );
      const x = initialSnapshot?.x ?? 0;
      const z = initialSnapshot?.z ?? 0;
      const heading = initialSnapshot?.heading ?? 0;
      const speed = initialSnapshot?.speedMps ?? 0;
      const npc: NpcVehicle = {
        node,
        visual,
        visualKey: appearanceVisualKey(appearance),
        visualVehicleId: vehicleId,
        visualVariant: initialVariant,
        speed,
        currentSpeed: speed,
        z,
        laneX: x,
        poseX: x,
        poseZ: z,
        poseHeading: heading,
        prevPoseX: x,
        prevPoseZ: z,
        prevPoseHeading: heading,
        active: Boolean(initialSnapshot),
      };
      node.position.set(x, 0.12, z);
      node.rotation.y = heading;
      node.setEnabled(Boolean(initialSnapshot));
      // Patrol status rides on the appearance (light bar + livery are built into
      // the vehicle visual); a nearby violation becomes a fine (phase 10).
      npc.police = appearance.role === "police";
      this.npcVehicles.push(npc);
    }

    const requestedPedestrians = Math.min(
      10,
      scenario.vulnerableRoadUsers?.pedestrians ?? 0,
    );
    const requestedCyclists = Math.min(
      5,
      scenario.vulnerableRoadUsers?.cyclists ?? 0,
    );
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
      const source = walker ?? authoredPose?.position ?? crosswalk?.position ?? { x: 0, z: 0 };
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
      this.mirrorRig?.layoutPanels(this.mirrorRigCtx());
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
      this.callbacks.onContextLost?.();
    };
    const onContextRestored = () => {
      this.contextLost = false;
      this.lastFrameTime = performance.now();
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

  private emit(event: GameRuntimeEvent) {
    this.callbacks.onEvent?.(event);
  }

  private publishHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHudTime < 90) return;
    this.lastHudTime = now;
    const speed = this.simulationSnapshot.speedDisplay;
    const speedUnit: SpeedUnit =
      this.simulationSnapshot.speedUnit === "kmh" ? "km/h" : "mph";
    this.callbacks.onHudUpdate?.({
      speed: Math.round(speed),
      speedUnit,
      gear: this.playerState.gear,
      cameraMode: this.cameraMode,
      instruction: this.instruction,
      paused: this.paused,
      // The horn now sustains while held, so the visual cue has to follow the
      // hold rather than the fixed window the old fire-and-forget blip used.
      honking: this.hornHeld || now < this.hornUntil,
      rearViewVisible: this.cameraMode === "first",
      playerX: this.playerState.x,
      playerZ: this.playerState.z,
      heading: this.playerState.heading,
      simElapsedMs: this.simulationSnapshot.elapsedMs,
      speedLimit: this.postedSpeedLimit(),
      scenarioClock: this.options.scenario.scenarioClock?.label,
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
