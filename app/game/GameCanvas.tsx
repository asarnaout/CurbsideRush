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
  TransformNode,
  UniversalCamera,
  Vector3,
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
import type {
  CameraMode,
  CutsceneRequest,
  DriveGear,
  GameCanvasLane,
  GameCanvasLesson,
  GameCanvasMapPack,
  GameCanvasPoint,
  GameHudSnapshot,
  GameRuntimeEvent,
  PlayerVehicleOption,
  PlayerVehiclePhysics,
  SpeedUnit,
  SteeringSide,
  TrafficSide,
  TurnIndicator,
} from "./sessionContract";
import {
  buildRoadSurfaceStripGeometry,
  collectRoadJunctionFills,
  smoothClosedRoadCenterline,
  type RoadJunctionFill,
} from "./geometry/roadStrips";
import {
  clampHorizontalFieldOfView,
  computeRouteChevronPlacements,
  guidanceCueOverlapsCheckpoint,
  resolveAuthoritativeRouteIndex,
  resolveCheckpointTargetWidth,
  resolveRouteChevronHalfSpan,
} from "./geometry/routeGuidance";
import {
  BUILDING_GROUND_LIFT,
  COCKPIT_LAYER_MASK,
  DEFAULT_HORIZONTAL_FOV,
  GUIDANCE_LAYER_MASK,
  GUIDANCE_LATERAL_CLEARANCE_M,
  PARK_BED_Y,
  PARK_LAWN_Y,
  PARK_PATH_Y,
  PLAYER_GUIDANCE_HALF_WIDTH_M,
  PRIMARY_CAMERA_LAYER_MASK,
  ROAD_JUNCTION_FILL_Y,
  ROAD_SHOULDER_JUNCTION_FILL_Y,
  ROAD_SHOULDER_Y,
  ROAD_SURFACE_Y,
  WORLD_LAYER_MASK,
} from "./render/renderConstants";
import {
  AdaptiveInputRouter,
  createInitialInputPresentation,
  isCameraStackActive,
  resolveCockpitCameraPoses,
  type AdaptiveInputPresentation,
} from "./adaptiveInputRouter";
import {
  createAsphaltTexture,
  createFlowerbedTexture,
  createGrassDetailTexture,
  createGrassTexture,
  makeFacadeEmissiveTexture,
  makeInstrumentClusterTexture,
} from "./render/proceduralTextures";
import {
  appendDashedMarkingBoxes,
  appendSolidMarkingBoxes,
  createBox,
  createChamferedPanel,
  createCylinder,
  createExtrudedPrism,
  createFacadeBox,
  createIcoSphere,
  createMarkingGeometry,
  makeFacadeMaterial,
  type MarkingGeometry,
} from "./render/meshPrimitives";
import {
  AMBIENT_CROWD_CONFIG,
  crowdClothingPaletteForMap,
  DEFAULT_ROAD_USER_RADII,
  DESTRUCTIBLE_GRID_CELL_M,
  DESTRUCTIBLE_PROP_CONFIGS,
  PLAYER_CAPSULE_HALF_LENGTH_M,
  PLAYER_CAPSULE_RADIUS_M,
  PROP_MAX_ACTIVE_TOPPLES,
  PROP_MIN_STRIKE_SPEED_MPS,
  PROP_TOPPLE_MAX_ANGLE_RAD,
  PROP_TOPPLE_SECONDS,
  type ActivePropFall,
  type DestructibleProp,
  type DestructiblePropPart,
} from "./render/propCatalog";
import { createSkyAndHorizon, createSunShadows } from "./render/skyAndShadows";
import { buildCairoLandmark } from "./render/cairoLandmarks";
import { buildRoadsideProps } from "./render/roadsideProps";
import {
  buildRepairShop,
  collectBuildingExclusions,
  instantiateProp,
  placeProp,
} from "./render/venueProps";
import {
  buildLondonLandmark,
  buildLondonStreetFurniture,
  buildRegulatorySigns,
  buildSpeedLimitSigns,
} from "./render/londonLandmarks";
import { WaterLayer } from "./render/waterLayer";
import {
  crosswalkStripeLayout,
  EGYPT_SIGNAL_BORDER_BARS,
  LANE_PAINT_STYLES,
  roadSurfacePlacementForMarking,
  SIGNAL_HOUSING_BOX,
  SIGNAL_MAST,
  signalStopBarSegment,
  TRAFFIC_CAMERA_BODY,
  trafficCameraHeadIds,
  trafficCameraPlacement,
} from "./geometry/roadFurnitureLayout";
import {
  earClipPolygonIndices,
  WATER_BOAT_MODEL_URLS,
} from "./geometry/waterGeometry";
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
} from "./geometry/facadesAndKeepouts";
import {
  biasCairoDecalMaterials,
  boxLengthYaw,
  CAIRO_STREET_WALL_URL_RE,
  clipRectToRoadSide,
  roadSideParkLawnPolygon,
  shorelineParapetRuns,
} from "./geometry/cairoParkland";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type NpcVehicleVariant,
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
} from "./simulationAdapter";
import {
  FUEL_PUMP_REACH_M,
  gasStationCanopyWorld,
  gasStationPumpPositions,
  gasStationsOf,
  distanceToRepairBay,
  repairShopBayPosition,
  repairShopsOf,
  resolveServicePointLot,
} from "./servicePoints";
import { PROP_MODEL_FOOTPRINTS_M } from "./propFootprints";
import { REPAIR_BAY_REACH_M } from "./repairShopLayout";
import { DRIVE_LAYER } from "./driveLayers";
import { INPUT_GUIDANCE } from "./inputGuidance";
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
  buildPlanarUVs,
  hashStringToSeed,
  mixHexColors,
  PAVED_SIDEWALK_WIDTH_M,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  seededUnit,
  type MapVisualPalette,
} from "./visuals";
import {
  natureModelsForMap,
  natureSetUrls,
  natureSetsForMap,
} from "./natureCatalog";
import {
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
  modelMaterials,
  preloadModels,
  propModelUrls,
  vehicleModelUrls,
} from "./modelLibrary";
import {
  buildingPlacementConfig,
  buildingSetUrls,
  isBuildingSetId,
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
  speedLimitSignPlacements,
} from "./regulatorySigns";
import {
  buildConnectedNpcPath,
  type NpcPathSegment as NpcPathSegmentData,
} from "./npcPaths";
import {
  splitMarkingAtCrossings,
  type MarkingPoint,
} from "./roadMarkings";

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

/** Mirrors the simulation's standstill threshold, for deciding which pedal is
 * driving and which is braking when the audio reads the controls. */
const STOPPED_AUDIO_SPEED_MPS = 0.2;
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

/** How far past a roof's edge a scene still counts as under it — see
 * `coverOverScene`. Roughly the walk between a car and the pump it is drawn up
 * at, which is the span such a scene straddles the edge by. */
const COVER_REACH_M = 3;

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
    this.waterLayer?.dispose();
    this.waterLayer = null;
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
      this.waterLayer?.update(this.visualElapsedSeconds);
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
    this.cameraFarPlaneM = createSkyAndHorizon(
      { scene, registerMirrorSurface: (mesh) => this.registerMirrorSurface(mesh) },
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
    this.registerMirrorSurface(ground);
    const waterLayer = new WaterLayer(scene);
    waterLayer.build(mapPack, mapId, {
      palette: this.visualPalette,
      lowSpec: this.lowSpec,
      registerMirrorSurface: (mesh) => this.registerMirrorSurface(mesh),
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
      if (
        mapId.includes("london") &&
        buildLondonLandmark(
          {
            scene,
            staticSceneryFreeze: this.staticSceneryFreeze,
            registerShadowCaster: (mesh, x, z) =>
              this.registerShadowCaster(mesh, x, z),
            registerDestructibleProp: (kind, x, z, scale, parts) =>
              this.registerDestructibleProp(kind, x, z, scale, parts),
          },
          landmark,
          material,
        )
      ) {
        continue;
      }
      if (
        resolveMapVisualKey(mapId) === "cairo" &&
        buildCairoLandmark(
          {
            scene,
            visualPalette: this.visualPalette,
            staticSceneryFreeze: this.staticSceneryFreeze,
            buildFlatPolygonMesh: (id, polygon, y, polygonMaterial) =>
              this.buildFlatPolygonMesh(id, polygon, y, polygonMaterial),
            buildParkLawnPolygon: (id, polygon, palette, mapPackId) =>
              this.buildParkLawnPolygon(id, polygon, palette, mapPackId),
          },
          landmark,
          material,
          mapPack,
        )
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
      buildLondonStreetFurniture({
        scene,
        staticSceneryFreeze: this.staticSceneryFreeze,
        registerShadowCaster: (mesh, x, z) =>
          this.registerShadowCaster(mesh, x, z),
        registerDestructibleProp: (kind, x, z, scale, parts) =>
          this.registerDestructibleProp(kind, x, z, scale, parts),
      });
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
      ) => this.registerDestructibleProp(kind, x, z, scale, parts),
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
          this.registerDestructibleProp(kind, x, z, scale, parts),
      },
      mapPack,
      palette,
      mapId,
      roadSurfaces,
      [...regulatorySigns, ...speedLimitSigns],
    );

    for (const checkpoint of this.authoredCheckpoints) {
      this.checkpointVisuals.push(
        this.createCheckpointTarget(checkpoint, checkpointMaterial),
      );
    }
    this.finishVisual = this.createFinishBeacon(mapPack);
    this.updateGuidanceVisuals();
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
    this.cameraFarPlaneM = createSkyAndHorizon(
      { scene, registerMirrorSurface: (mesh) => this.registerMirrorSurface(mesh) },
      yardPalette,
      "orientation-yard",
      { x: 180, z: 180 },
    ).cameraFarPlaneM;
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
    const yardSunShadows = createSunShadows(
      {
        visualPalette: this.visualPalette,
        touchFirst: this.options.inputCapabilities.touchFirst,
      },
      sun,
    );
    this.shadowGenerator = yardSunShadows.shadowGenerator;
    this.shadowRefreshSeconds = yardSunShadows.shadowRefreshSeconds;

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

    // Two-wheelers have no cockpit — see `toggleCamera` on the session class —
    // so the button that would switch into one is withheld rather than left
    // as a dead tap.
    const cameraSwitchable = !playerVehicle || playerVehicle.visualKind === "car";
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
            cameraSwitchable={cameraSwitchable}
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
