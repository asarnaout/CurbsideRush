import { Color3, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import {
  buildActorVisual,
  buildCourierVisual,
  buildOfficerVisual,
  type ActorVisual,
  type CharacterColors,
  type CharacterVisual,
} from "../characterMeshes";
import {
  BIKE_CUTSCENE_BODY,
  buildBikeErrandScript,
  buildBoardScript,
  buildErrandScript,
  buildExitScript,
  buildPulloverScript,
  buildRefuelScript,
  buildRepairScript,
  buildRoadsideRefuelScript,
  chooseStagedShot,
  cutsceneBodyProfile,
  DEFAULT_CUTSCENE_BODY,
  lerpCarPose,
  MOTORBIKE_CUTSCENE_BODY,
  projectOntoPolyline,
  repairCameraPosition,
  scriptFocusPoint,
  settleEase,
  type CutsceneAction,
  type CutsceneBodyProfile,
  type CutsceneCarPose,
  type CutsceneKind,
  type CutsceneSound,
  type CutsceneStep,
  type ErrandCargo,
  type PulloverPlan,
  type PulloverRoad,
  type StagedBlocker,
  type StagedCover,
} from "../cutsceneScript";
import {
  distanceToRepairBay,
  FUEL_PUMP_REACH_M,
  gasStationCanopyWorld,
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
} from "../servicePoints";
import { resolveSimulationLaneAnchor } from "../laneAnchors";
import { REPAIR_BAY_REACH_M } from "../repairShopLayout";
import {
  policeAppearanceForMap,
  policeBeaconLamps,
  VEHICLE_DIMENSIONS,
} from "../vehicleVisuals";
import { createVehicleMesh, type VehicleMeshVisual } from "../vehicleMeshes";
import type { SimulationPose } from "../simulation";
import type {
  CameraMode,
  CutsceneRequest,
  GameCanvasMapPack,
  GameRuntimeEvent,
  PlayerVehicleOption,
  SteeringSide,
  TrafficSide,
} from "../sessionContract";

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

/** How far off a carriageway centreline the traffic stop will still measure its
 * kerb from that road. Beyond it (a car deep in a car park or on the grass) the
 * stop parks heading-relative instead of dragging the car back to a street it
 * has left. Half a wide road plus a pavement. */
const PULLOVER_ROAD_REACH_M = 14;

/**
 * One staged interaction scene, in progress: a walking actor (and, for a
 * traffic stop, a stand-in patrol car) choreographed against the parked
 * player car, filmed from a fixed wide shot. De-methodized out of
 * `BabylonGameSession` (Phase 3.13, characterized ahead of time by
 * `tests/cutsceneDirectorCharacterization.test.tsx` — coupling 35, the
 * largest cargo in this program, and the plan's explicitly flagged
 * riskiest phase — verified with mandatory manual QA of all four scene
 * kinds beyond the automated suite).
 *
 * `ActiveCutscene` moves here rather than to `sessionContract.ts`: unlike
 * `AuthoredSignalHeadVisual` (Phase 3.9), every write to it happens inside
 * this cargo — the session only ever reads a handful of fields off it
 * (`cameraPosition`/`cameraTarget` for `updateCamera`, a presence check for
 * `mergedInput`/`setCameraMode`/`toggleCamera`/`processSimulationEvents`,
 * and a debug snapshot), all exposed as getters/a method instead.
 *
 * `PlayerState` moves nowhere and isn't imported either — it stays a
 * `GameCanvas.tsx`-local type (core session state read and written far
 * beyond cutscenes), and `ctx.playerState` is typed with just the seven
 * fields `applyCutsceneCarMoves` actually touches; the session's real
 * `PlayerState` object satisfies that shape structurally, with room to
 * spare (`gear`/`indicator`), so passing `this.playerState` needs no export.
 * The reference is live, not a copy — the same live-reference-through-ctx
 * shape `staticSceneryFreeze`/`shadowCasterCells` use elsewhere in this
 * program — because the simulation core and every other reader of player
 * pose need the write to land immediately.
 *
 * `playFoley`, `setPlayerPose`, `applyCameraStack`, `patrolSimulationIdNear`,
 * `passengerColors`, and `emit` are threaded as ctx callbacks: all six are
 * session methods or session-field capabilities this cargo calls but does
 * not own. `playFoley` narrows `this.audio?.foley(sound)` to the one
 * capability every call site here needs, so this file never imports the
 * `DriveAudio` type. `applyCameraStack` is the general camera-stack helper
 * `setCameraMode` also calls; `passengerColors` is also called directly by
 * the session's `syncRider`; `patrolSimulationIdNear` narrows
 * `patrolNearPlayer`'s `NpcVehicle | null` return to just the one field this
 * cargo reads, so this file never imports that large session-internal type
 * either. `riderNode` and `playerCyclistVisual` are passed as ctx fields
 * rather than callbacks — this cargo only ever reads them or calls a method
 * on what they point to, never reassigns the field itself, so a live
 * reference is enough and matches how every other shared mutable object in
 * this program is threaded through ctx.
 */

export interface ActiveCutscene {
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

export interface CutsceneDirectorCtx {
  readonly playerState: {
    x: number;
    z: number;
    previousX: number;
    previousZ: number;
    heading: number;
    previousHeading: number;
    speedMps: number;
  };
  readonly steeringSide: SteeringSide;
  readonly trafficSide: TrafficSide;
  readonly playerVehicle: PlayerVehicleOption | null | undefined;
  readonly mapPack: GameCanvasMapPack | undefined;
  readonly lessonTrafficSeed: number | undefined;
  readonly thirdCameraX: number;
  readonly thirdCameraZ: number;
  readonly stagedBlockers: readonly StagedBlocker[];
  readonly cameraMode: CameraMode;
  readonly riderNode: TransformNode | null;
  readonly playerCyclistVisual: CharacterVisual | null;
  readonly gigVenueCurbside: ReadonlyMap<
    string,
    { readonly x: number; readonly z: number; readonly facing: number }
  >;
  readonly gigVenueDoors: ReadonlyMap<
    string,
    { readonly x: number; readonly z: number }
  >;
  /** The two literal cues cutscenes reach for that `CutsceneSound` alone
   * doesn't cover ("chime" on finish) — together, exactly `FoleyCue`'s
   * member set, without this module reaching into the audio layer's own
   * types for it. */
  readonly playFoley: (sound: CutsceneSound | "chime") => void;
  readonly setPlayerPose: (pose: SimulationPose) => void;
  readonly applyCameraStack: (firstPerson: boolean) => void;
  readonly patrolSimulationIdNear: (radiusM: number) => string | null;
  readonly passengerColors: (seedId: string) => CharacterColors;
  readonly emit: (
    type: GameRuntimeEvent["type"],
    message: string,
    severity?: GameRuntimeEvent["severity"],
    rule?: Pick<GameRuntimeEvent, "ruleCode" | "penalty" | "evidence" | "issuedBy">,
  ) => void;
}

/**
 * Mirrors the `active` sub-object of the `__sideswapCutsceneDebug` window
 * hook field-for-field (flat X/Y/Z names, `Math.round(v * 100) / 100`
 * position rounding) so the session can spread this directly into that
 * hook without changing its shape. The hook's other fields — playerX/Z/
 * heading, cameraMode, activeCamera, dip — are session state, not cutscene
 * cargo, and stay assembled session-side.
 */
export interface CutsceneDebugSnapshot {
  readonly kind: CutsceneKind;
  readonly nonce: number;
  readonly step: number;
  readonly action: CutsceneAction | null;
  readonly actorX: number;
  readonly actorZ: number;
  readonly actorVisible: boolean;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  readonly patrolX: number | null;
  readonly patrolZ: number | null;
}

export class CutsceneDirector {
  private active: ActiveCutscene | null = null;
  private dipSeconds = 0;
  private dipOffsetField = 0;
  private hiddenNpcId: string | null = null;

  constructor(private readonly scene: Scene) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  get cameraPosition(): Vector3 | null {
    return this.active?.cameraPosition ?? null;
  }

  get cameraTarget(): Vector3 | null {
    return this.active?.cameraTarget ?? null;
  }

  get dipOffset(): number {
    return this.dipOffsetField;
  }

  get hiddenNpcSimulationId(): string | null {
    return this.hiddenNpcId;
  }

  debugSnapshot(): CutsceneDebugSnapshot | null {
    const cutscene = this.active;
    if (!cutscene) return null;
    return {
      kind: cutscene.kind,
      nonce: cutscene.nonce,
      step: cutscene.stepIndex,
      action: cutscene.script[cutscene.stepIndex]?.action ?? null,
      actorX: Math.round(cutscene.actorNode.position.x * 100) / 100,
      actorZ: Math.round(cutscene.actorNode.position.z * 100) / 100,
      actorVisible: cutscene.actorNode.isEnabled(),
      // Where the scene is watched from. A staged shot that ends up
      // inside a wall looks like a rendering bug and is really a
      // placement one, and there is no way to tell from a screenshot
      // which wall you are inside of.
      cameraX: Math.round(cutscene.cameraPosition.x * 100) / 100,
      cameraY: Math.round(cutscene.cameraPosition.y * 100) / 100,
      cameraZ: Math.round(cutscene.cameraPosition.z * 100) / 100,
      // The traffic stop's second car, so QA can assert it actually
      // pulls in behind rather than parking on top of the player.
      patrolX: cutscene.patrolNode
        ? Math.round(cutscene.patrolNode.position.x * 100) / 100
        : null,
      patrolZ: cutscene.patrolNode
        ? Math.round(cutscene.patrolNode.position.z * 100) / 100
        : null,
    };
  }

  /**
   * The walk-path envelope for interaction scenes, sized to whatever the
   * player is actually driving so a van's longer bumpers are skirted and its
   * doors sit on its real flanks. The flagship (and any vehicle without
   * registered dimensions) reproduces the long-standing default exactly.
   */
  private cutsceneBody(ctx: CutsceneDirectorCtx): CutsceneBodyProfile {
    const kind = ctx.playerVehicle?.visualKind;
    if (kind === "bicycle") return BIKE_CUTSCENE_BODY;
    if (kind === "motorbike") return MOTORBIKE_CUTSCENE_BODY;
    const model = ctx.playerVehicle?.model;
    const dimensions = model ? VEHICLE_DIMENSIONS[model] : undefined;
    if (!dimensions) return DEFAULT_CUTSCENE_BODY;
    return cutsceneBodyProfile(dimensions.length, dimensions.width);
  }

  /**
   * Stages one interaction cutscene: builds the choreography for the request,
   * spawns its actor, and swings the camera to a wide shot of the car and the
   * scene's far point. While `isActive` is true, the session's `mergedInput`
   * reads as all-zero (the "game is unplayable" contract) and `updateCamera`
   * holds the staged shot. Anything unstageable resolves as an instant `done`
   * so the app-side effects (fuel, gig state) are never lost.
   */
  start(ctx: CutsceneDirectorCtx, request: CutsceneRequest): void {
    this.cancel(ctx);
    const car = {
      x: ctx.playerState.x,
      z: ctx.playerState.z,
      heading: ctx.playerState.heading,
    };
    const body = this.cutsceneBody(ctx);
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
          Math.max(0, ctx.playerState.speedMps),
          ctx.steeringSide,
          ctx.trafficSide,
          this.pulloverRoadAt(ctx, car.x, car.z),
          body,
        );
        script = pullover.steps;
        // Stand the scene's own patrol in for the one that clocked you: the
        // ambient car is still under the simulation's control and would drive
        // off mid-scene, so it goes off screen for the duration rather than
        // being commandeered. Wider than the 35 m witness radius because the
        // stop is staged a render frame or two after the violation.
        this.hiddenNpcId = ctx.patrolSimulationIdNear(60);
        break;
      }
      case "refuel": {
        const pump = this.nearestPumpTo(ctx, car.x, car.z);
        if (pump) {
          script = buildRefuelScript(
            car,
            ctx.steeringSide,
            pump,
            request.fuelFillFraction ?? 1,
            body,
          );
        }
        break;
      }
      case "roadside_refuel": {
        // No pump needed: the rescue plays wherever the tank ran dry.
        script = buildRoadsideRefuelScript(car, ctx.steeringSide, body);
        break;
      }
      case "repair": {
        // Likewise needs no map data — the work happens at the car's own front
        // wing, so this branch always yields a script. Deliberate: the bill
        // is charged on the scene's repair step, so a shop visit that could not
        // be staged would be a repair that silently cost nothing.
        script = buildRepairScript(car, ctx.steeringSide, body);
        break;
      }
      case "board": {
        const spot = request.venueId
          ? ctx.gigVenueCurbside.get(request.venueId)
          : undefined;
        if (spot) {
          const from = ctx.riderNode
            ? { x: ctx.riderNode.position.x, z: ctx.riderNode.position.z }
            : { x: spot.x, z: spot.z };
          script = buildBoardScript(car, ctx.trafficSide, from, body);
          passengerSeed = request.actorSeedId ?? request.venueId ?? null;
        }
        break;
      }
      case "exit": {
        // The passenger always walks straight off the car's own kerb side, so
        // the scene needs nothing but the car pose. Routing to a fixed venue
        // spot instead sent them around the car on an off-square park (#128-era
        // "walks away then comes back"); a car-relative walk-off can't.
        script = buildExitScript(car, ctx.trafficSide, body);
        passengerSeed = request.actorSeedId ?? request.venueId ?? null;
        break;
      }
      case "food_pickup":
      case "food_dropoff": {
        const door = request.venueId
          ? (ctx.gigVenueDoors.get(request.venueId) ??
            ctx.gigVenueCurbside.get(request.venueId))
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
          const twoWheelerKind = ctx.playerVehicle?.visualKind;
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
                    ctx.steeringSide,
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
      this.hiddenNpcId = null;
      this.emitCutsceneDone(ctx, request.nonce, request.kind);
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
            ctx.passengerColors(passengerSeed),
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

    const patrolRig = pullover ? this.buildPatrolRig(ctx, request.nonce, pullover) : null;

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
    const towardCameraX = ctx.thirdCameraX - midX;
    const towardCameraZ = ctx.thirdCameraZ - midZ;
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
        ? this.repairBayFramingAt(ctx, car.x, car.z)
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
        ctx.stagedBlockers,
        this.coverOverScene(ctx, subjects),
      );

    const riderWasHidden = request.kind === "board" && ctx.riderNode !== null;
    if (riderWasHidden) ctx.riderNode?.setEnabled(false);
    const playerRiderHidden =
      // A stopped cyclist stays on the bike — they are being spoken to, not
      // dismounting — so the traffic stop is the one scene that keeps the
      // player's own rider on their vehicle.
      request.kind !== "pullover" &&
      ctx.playerVehicle !== null &&
      ctx.playerVehicle !== undefined &&
      ctx.playerVehicle.visualKind !== "car" &&
      ctx.playerCyclistVisual !== null;
    if (playerRiderHidden) ctx.playerCyclistVisual?.setRiderVisible?.(false);

    this.active = {
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
    ctx.applyCameraStack(false);
  }

  /**
   * The carriageway the traffic stop parks against: the road surface nearest
   * the car, projected onto rather than looked up by lane, because the pose has
   * to be measured from the *street's* centreline to land at its kerb — a lane
   * id would only say which half of it the car is on. Out of reach (a car well
   * off the map's roads) yields null and the scene parks heading-relative.
   */
  private pulloverRoadAt(
    ctx: CutsceneDirectorCtx,
    x: number,
    z: number,
  ): PulloverRoad | null {
    const surfaces = ctx.mapPack?.geometry.roadSurfaces;
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
    ctx: CutsceneDirectorCtx,
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
        ctx.mapPack?.id ?? "orientation-yard",
        `pullover-${nonce}`,
        ctx.lessonTrafficSeed ?? 0,
      ),
    );
    visual.setDetailVisible(true);
    return { node, visual };
  }

  /** Fired at a step's first frame: placement, visibility, clip, foley, dip. */
  private beginCutsceneStep(
    ctx: CutsceneDirectorCtx,
    cutscene: ActiveCutscene,
    step: CutsceneStep,
  ): void {
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
    if (step.sound) ctx.playFoley(step.sound);
    if (step.carDip) this.dipSeconds = CUTSCENE_DIP_SECONDS;
    if (step.citeWindow && !cutscene.citeEmitted) {
      // The officer is at the window: this is the moment the fine is written,
      // the same way the refuel scene pays for its fuel when the nozzle goes
      // in rather than when the button was pressed.
      cutscene.citeEmitted = true;
      ctx.emit("cutscene", "Licence and registration.", "warning", {
        evidence: { phase: "cite", nonce: cutscene.nonce },
      });
    }
    if (step.fuelWindow && !cutscene.pumpEmitted) {
      cutscene.pumpEmitted = true;
      ctx.emit("cutscene", "Filling the tank.", "info", {
        evidence: {
          phase: "pump",
          nonce: cutscene.nonce,
          durationMs: Math.round(step.seconds * 1000),
        },
      });
    }
    if (step.repairWindow && !cutscene.repairEmitted) {
      cutscene.repairEmitted = true;
      ctx.emit("cutscene", "Panels straightened, lights replaced.", "info", {
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
  advance(ctx: CutsceneDirectorCtx, frameSeconds: number): void {
    if (this.dipSeconds > 0) {
      this.dipSeconds = Math.max(0, this.dipSeconds - frameSeconds);
      this.dipOffsetField =
        Math.sin(Math.PI * (1 - this.dipSeconds / CUTSCENE_DIP_SECONDS)) *
        CUTSCENE_DIP_DEPTH_M;
    } else {
      this.dipOffsetField = 0;
    }
    const cutscene = this.active;
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
      this.beginCutsceneStep(ctx, cutscene, step);
    }
    cutscene.stepElapsed += frameSeconds;
    while (cutscene.stepElapsed >= step.seconds) {
      // Land the outgoing step's cars exactly on their marks before rolling
      // forward: a slow frame can skip a whole step, and a car left a metre
      // short of the kerb is where the officer would then be walking to.
      this.applyCutsceneCarMoves(ctx, cutscene, step, 1);
      cutscene.stepElapsed -= step.seconds;
      cutscene.stepIndex += 1;
      if (cutscene.stepIndex >= cutscene.script.length) {
        this.finishCutscene(ctx, cutscene);
        return;
      }
      step = cutscene.script[cutscene.stepIndex];
      this.beginCutsceneStep(ctx, cutscene, step);
    }
    if (step.carMoves && step.seconds > 0) {
      this.applyCutsceneCarMoves(
        ctx,
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
    ctx: CutsceneDirectorCtx,
    cutscene: ActiveCutscene,
    step: CutsceneStep,
    t: number,
  ): void {
    if (!step.carMoves) return;
    const eased = settleEase(t);
    for (const move of step.carMoves) {
      const pose = lerpCarPose(move.from, move.to, eased);
      if (move.vehicle === "player") {
        ctx.setPlayerPose(pose);
        // The glide already advances at render rate; pin prev to the same
        // pose so the interpolated car sits exactly on the choreography
        // rather than one blend step behind it.
        ctx.playerState.previousX = pose.x;
        ctx.playerState.previousZ = pose.z;
        ctx.playerState.previousHeading = pose.heading;
        ctx.playerState.x = pose.x;
        ctx.playerState.z = pose.z;
        ctx.playerState.heading = pose.heading;
        ctx.playerState.speedMps = 0;
      } else if (cutscene.patrolNode) {
        cutscene.patrolNode.position.set(pose.x, 0.12, pose.z);
        cutscene.patrolNode.rotation.y = pose.heading;
      }
    }
  }

  private finishCutscene(ctx: CutsceneDirectorCtx, cutscene: ActiveCutscene): void {
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
      ctx.playerCyclistVisual?.setRiderVisible?.(true);
    }
    this.active = null;
    ctx.applyCameraStack(ctx.cameraMode === "first");
    ctx.playFoley("chime");
    this.emitCutsceneDone(ctx, cutscene.nonce, cutscene.kind);
  }

  /** Tears a scene down without a `done` event: tow reset, session dispose. */
  cancel(ctx: CutsceneDirectorCtx): void {
    const cutscene = this.active;
    if (!cutscene) return;
    this.active = null;
    cutscene.actorVisual?.dispose();
    cutscene.actorNode.dispose(false, false);
    this.disposePatrolRig(cutscene);
    if (cutscene.riderWasHidden) ctx.riderNode?.setEnabled(true);
    if (cutscene.playerRiderHidden) {
      ctx.playerCyclistVisual?.setRiderVisible?.(true);
    }
    if (cutscene.pumpEmitted) ctx.playFoley("pump_stop");
    this.dipSeconds = 0;
    this.dipOffsetField = 0;
    ctx.applyCameraStack(ctx.cameraMode === "first");
  }

  /** Tears down the traffic stop's own patrol car and lets the ambient one
   * that clocked you back on screen. Safe on every other scene, which has
   * neither. */
  private disposePatrolRig(cutscene: ActiveCutscene) {
    cutscene.patrolVisual?.dispose();
    cutscene.patrolNode?.dispose(false, false);
    this.hiddenNpcId = null;
  }

  private emitCutsceneDone(
    ctx: CutsceneDirectorCtx,
    nonce: number,
    kind: CutsceneKind,
  ): void {
    ctx.emit("cutscene", CUTSCENE_DONE_MESSAGE[kind], "info", {
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
    ctx: CutsceneDirectorCtx,
    x: number,
    z: number,
  ): {
    readonly bay: { readonly x: number; readonly z: number };
    readonly mouth: { readonly x: number; readonly z: number };
  } | null {
    const mapPack = ctx.mapPack;
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
    ctx: CutsceneDirectorCtx,
    subjects: readonly { x: number; z: number }[],
  ): StagedCover | null {
    const mapPack = ctx.mapPack;
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
    ctx: CutsceneDirectorCtx,
    x: number,
    z: number,
  ): { x: number; z: number } | null {
    const mapPack = ctx.mapPack;
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

  dispose(ctx: CutsceneDirectorCtx): void {
    this.cancel(ctx);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
