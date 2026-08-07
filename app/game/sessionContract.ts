import type { Color4, TransformNode } from "@babylonjs/core";
import type { CutsceneKind } from "./cutsceneScript";
import type { ServicePointKind } from "./servicePoints";
import type { SimulationCoreConfig } from "./simulation";
import type { AuthoredSignalAspect, AuthoredSignalStyle } from "./trafficSignals";
import type { VehicleModel } from "./vehicleVisuals";

/**
 * The public contract between `SideSwapApp` and `GameCanvas`: everything a
 * caller needs to describe a drive, and everything the session reports back.
 * Types only — enforced by `tests/architecture.test.ts`, which fails on any
 * runtime `export` here. `GameCanvasProps` stays in `GameCanvas.tsx` as the
 * component's own signature, not shared contract.
 *
 * Several of these unions deliberately DIFFER from same-named types in
 * `./types` (the simulation-facing contract): `CameraMode` here is
 * `"first" | "third"` vs `types.ts`'s `"first_person" | "third_person"`, and
 * `SpeedUnit` here is `"mph" | "km/h"` vs `types.ts`'s `"mph" | "kmh"`.
 * `SideSwapApp` bridges the two with `toCanvasCamera`/`fromCanvasCamera`.
 * This is not an oversight — unifying them is tracked as a follow-up, not a
 * drive-by fix, because the divergence is exactly what makes importing the
 * wrong module's version of one of these a compile error rather than a
 * silent bug.
 */

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
  instruction: string;
  paused: boolean;
  honking: boolean;
  rearViewVisible: boolean;
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

type GameRuntimeEvidence = Readonly<
  Record<string, string | number | boolean>
>;

/** Only events with a live app-layer consumer cross the canvas boundary. */
export type GameRuntimeEvent =
  | { readonly type: "ready" }
  | {
      readonly type: "coaching";
      readonly ruleCode: string;
      readonly evidence?: GameRuntimeEvidence;
    }
  | {
      readonly type: "collision";
      readonly evidence?: GameRuntimeEvidence;
    }
  | {
      readonly type: "fine";
      readonly ruleCode: string;
      readonly evidence?: GameRuntimeEvidence;
      /** A patrol stages a stop; a camera debits immediately. */
      readonly issuedBy: "patrol" | "camera";
    }
  | {
      readonly type: "cutscene";
      readonly nonce: number;
      readonly phase: "cite" | "pump" | "repair" | "done";
      readonly durationMs?: number;
    };

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

/** The live inputs that make one authored, non-terminating drive reproducible. */
export interface DriveScenario {
  readonly id: string;
  readonly startSpawnId: string;
  readonly trafficSeed: number;
  readonly trafficDensity: "none" | "light" | "moderate" | "busy";
  readonly vulnerableRoadUsers?: Readonly<{
    pedestrians: number;
    cyclists: number;
  }>;
  readonly scenarioClock?: Readonly<{
    readonly weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
    readonly minutesAfterMidnight: number;
    readonly label: string;
  }>;
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
        | "terminal";
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
          | "road_marking";
        readonly style:
          | "nyc_signal"
          | "uk_signal"
          | "egypt_signal"
          | "stop_sign"
          | "yield_sign"
          | "restricted_lane"
          | "crosswalk"
          | "box_junction"
          | "japan_railway";
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
    }[];
    spawnPoints: readonly (
      | {
          readonly id: string;
          readonly kind: "player" | "vehicle";
          readonly anchor: {
            readonly laneId: string;
            readonly distanceAlongM: number;
          };
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
    )[];
  }>;
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

/**
 * Session-owned per-frame visual state for one signal head or railway
 * crossing: built by `render/trafficControlRender.ts`'s installation
 * builders, then read and mutated every frame by the session's own
 * `updateAuthoredSignalVisuals`/`resolvedSignalLight` — the reason these
 * live here rather than in that render module, which never touches them
 * again once built.
 */
export interface AuthoredSignalHeadVisual {
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

export interface RailwayCrossingVisual {
  readonly trafficLightIds: readonly string[];
  /** Per-instance color handles, same contract as AuthoredSignalHeadVisual. */
  readonly lampColors: readonly Color4[];
  readonly barrierPivot: TransformNode;
  /** Cache for resolvedSignalLight; see that helper for the contract. */
  resolvedLightIndex?: number;
  lastWarningActive?: boolean;
  lastFlashIndex?: number;
}
