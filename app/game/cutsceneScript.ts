/**
 * Choreography for the interaction cutscenes: refuel, rideshare board/exit and
 * the delivery errands. Pure data in, pure data out — a builder turns the car's
 * pose plus a target point into a list of timed steps for one actor, and the
 * session merely executes them. Keeping the waypoint and timing maths here (and
 * free of Babylon) is what lets the geometry invariants be unit-tested: paths
 * that never cross the car body, doors on the correct side for every
 * traffic/steering combination, pump and dwell times inside their brief.
 *
 * All geometry is in the sim's world frame (heading 0 = +z, driver-right
 * normal = (cos h, -sin h)); "local" coordinates put +long out the windscreen
 * and +lat out the driver-right window.
 */
import type { SteeringSide, TrafficSide, WorldPoint } from "./types";

export type CutsceneKind =
  | "refuel"
  | "repair"
  | "board"
  | "exit"
  | "food_pickup"
  | "food_dropoff"
  | "roadside_refuel"
  | "pullover";

export interface CutsceneCarPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Authored road-surface height; omitted is the ordinary ground plane. */
  readonly elevationM?: number;
}

export type CutsceneAction = "walk" | "run" | "idle" | "show" | "hide";

/**
 * Which end of a delivery an errand is, and therefore which leg the courier
 * walks with the order in hand: out to the door empty and back with it
 * (`"collect"`), or out with it and back empty (`"deliver"`).
 *
 * `"none"` is the default because the errand builders are the generic
 * shop-run choreography — a scene that has nothing to carry is a real thing to
 * be able to script, and it keeps every existing caller's script unchanged.
 * The food scenes are the ones that pass a real value: `food_pickup` is
 * `"collect"` and `food_dropoff` is `"deliver"`.
 */
export type ErrandCargo = "none" | "collect" | "deliver";

export type CutsceneSound =
  | "door"
  | "door_close"
  | "pump_start"
  | "pump_stop";

/**
 * The two vehicles a scene may drive. Every other scene plays out around a
 * parked car and moves nobody but the actor; the traffic stop is the one that
 * has to steer the player's own car (to the kerb) and bring a second one in
 * behind it.
 */
export type CutsceneVehicle = "player" | "patrol";

export interface CutsceneCarMove {
  readonly vehicle: CutsceneVehicle;
  readonly from: CutsceneCarPose;
  readonly to: CutsceneCarPose;
}

export interface CutsceneStep {
  readonly action: CutsceneAction;
  /** Polyline for walk/run; the single spawn point for show. */
  readonly path?: readonly WorldPoint[];
  readonly seconds: number;
  /** Facing (heading convention) held through show/idle steps. */
  readonly face?: number;
  /** One-shot foley cue fired as the step begins. */
  readonly sound?: CutsceneSound;
  /** Squash the car's suspension as the step begins (someone got in or out). */
  readonly carDip?: boolean;
  /** The refuel fill window: the app pours the tank over this step. */
  readonly fuelWindow?: boolean;
  /**
   * The repair window: the app bills for the work and restores the car's
   * condition as this step begins.
   *
   * Its own flag rather than a reuse of `fuelWindow` gated on the scene's kind,
   * because `fuelWindow` names the fuel gauge's fill animation as well as the
   * charge, and the app drives that off it.
   */
  readonly repairWindow?: boolean;
  /**
   * Vehicle poses interpolated across this step, eased so a car settles into
   * its stop rather than snapping to it. The session replays them onto the
   * simulation's player and onto the scene's own patrol rig.
   */
  readonly carMoves?: readonly CutsceneCarMove[];
  /** The citation window: the app debits the fine as this step begins. */
  readonly citeWindow?: boolean;
  /**
   * The actor is holding the order through this step, so the session shows the
   * delivery bag in their hand.
   *
   * Set per step rather than per scene because the two food scenes are the same
   * walk run in opposite directions: the courier is empty-handed on one leg and
   * carrying on the other, and which is which is the only thing that tells a
   * collection apart from a delivery. Only ever set on steps the actor is
   * visible for — a `hide` leg is the shop interior, and nothing there is on
   * screen to hold anything.
   */
  readonly carrying?: boolean;
}

export const WALK_SPEED_MPS = 1.5;
export const RUN_SPEED_MPS = 3.2;
/** No walking/jogging leg may exceed this; long paths just move faster. */
export const MAX_LEG_SECONDS = 6;
export const PUMP_BASE_SECONDS = 3;
export const PUMP_EXTRA_SECONDS = 2;
export const STORE_DWELL_SECONDS = 1.5;
/**
 * How long the driver spends at the car while it is put right. Flat
 * rather than scaled by the damage: this is the beat that tells the player the
 * work happened, and a repair that dragged on for a bad night would just be a
 * longer wait for the same outcome.
 */
export const REPAIR_WORK_SECONDS = 5;

/**
 * The vehicle envelope every walk path respects: the body rectangle to stay
 * out of, the waypoint ring used to skirt it, and the door positions in the
 * car's local frame (long forward, lat driver-right). The default is the
 * hand-tuned car envelope these scripts always used; Career Mode derives one
 * per rented vehicle so a van's longer bumpers are actually walked around.
 */
export interface CutsceneBodyProfile {
  readonly bodyHalfLongM: number;
  readonly bodyHalfLatM: number;
  readonly clearLongM: number;
  readonly clearLatM: number;
  readonly doorLateralM: number;
  readonly frontDoorForwardM: number;
  readonly rearDoorForwardM: number;
}

export const DEFAULT_CUTSCENE_BODY: CutsceneBodyProfile = {
  bodyHalfLongM: 2.45,
  bodyHalfLatM: 1.1,
  clearLongM: 3.1,
  clearLatM: 1.7,
  doorLateralM: 1.25,
  frontDoorForwardM: 0.35,
  rearDoorForwardM: -0.55,
};

/** Reference dimensions of the flagship the default envelope was tuned on. */
const REFERENCE_LENGTH_M = 4.55;
const REFERENCE_WIDTH_M = 1.9;

/**
 * Scales the hand-tuned default envelope to a vehicle's footprint. The
 * reference car reproduces DEFAULT_CUTSCENE_BODY exactly, so passing a
 * derived profile for the flagship changes nothing.
 */
export function cutsceneBodyProfile(
  lengthM: number,
  widthM: number,
): CutsceneBodyProfile {
  const long = lengthM / REFERENCE_LENGTH_M;
  const lat = widthM / REFERENCE_WIDTH_M;
  return {
    bodyHalfLongM: DEFAULT_CUTSCENE_BODY.bodyHalfLongM * long,
    bodyHalfLatM: DEFAULT_CUTSCENE_BODY.bodyHalfLatM * lat,
    clearLongM: DEFAULT_CUTSCENE_BODY.clearLongM * long,
    clearLatM: DEFAULT_CUTSCENE_BODY.clearLatM * lat,
    doorLateralM: DEFAULT_CUTSCENE_BODY.doorLateralM * lat,
    frontDoorForwardM: DEFAULT_CUTSCENE_BODY.frontDoorForwardM * long,
    rearDoorForwardM: DEFAULT_CUTSCENE_BODY.rearDoorForwardM * long,
  };
}

/** How far from the pump the driver stands while filling. */
const PUMP_STAND_OFF_M = 1.1;
/** How far a passenger wanders kerbward before despawning, absent a kerb spot. */
const EXIT_WANDER_M = 4.5;

const headingTo = (from: WorldPoint, to: WorldPoint): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

interface LocalPoint {
  readonly long: number;
  readonly lat: number;
}

function toLocal(car: CutsceneCarPose, point: WorldPoint): LocalPoint {
  const dx = point.x - car.x;
  const dz = point.z - car.z;
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return { long: dx * sin + dz * cos, lat: dx * cos - dz * sin };
}

function toWorld(car: CutsceneCarPose, long: number, lat: number): WorldPoint {
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return {
    x: car.x + long * sin + lat * cos,
    z: car.z + long * cos - lat * sin,
    ...(car.elevationM !== undefined
      ? { elevationM: car.elevationM }
      : {}),
  };
}

/**
 * Liang–Barsky segment-vs-rect test, in the rect's own frame: does the segment
 * (aU, aV) → (bU, bV) meet the box centred on the origin with these half-extents?
 *
 * Shared by the two things that have to not go through solid objects: the
 * driver's walk (against the car body, below) and the staged camera's sightline
 * (against the world's obstacles, in `chooseStagedAzimuth`). One routine because
 * they are one question, and because a second copy of clipping maths is a second
 * chance to get a sign wrong.
 */
function segmentCrossesRect(
  aU: number,
  aV: number,
  bU: number,
  bV: number,
  halfU: number,
  halfV: number,
): boolean {
  const dLong = bU - aU;
  const dLat = bV - aV;
  let t0 = 0;
  let t1 = 1;
  const clips: readonly (readonly [number, number])[] = [
    [-dLong, aU + halfU],
    [dLong, halfU - aU],
    [-dLat, aV + halfV],
    [dLat, halfV - aV],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** `segmentCrossesRect` against the car body, in the car's local frame. */
function segmentCrossesBody(
  a: LocalPoint,
  b: LocalPoint,
  body: CutsceneBodyProfile,
): boolean {
  return segmentCrossesRect(
    a.long,
    a.lat,
    b.long,
    b.lat,
    body.bodyHalfLongM,
    body.bodyHalfLatM,
  );
}

/**
 * A polyline from `from` to `to` that never crosses the car body: direct when
 * the straight line already clears it, otherwise skirting the nose or tail
 * (whichever end the walk is nearer) through a waypoint ring just beyond the
 * bumpers.
 */
export function routeAroundCar(
  car: CutsceneCarPose,
  from: WorldPoint,
  to: WorldPoint,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint[] {
  const a = toLocal(car, from);
  const b = toLocal(car, to);
  if (!segmentCrossesBody(a, b, body)) return [from, to];
  const endLong = a.long + b.long >= 0 ? body.clearLongM : -body.clearLongM;
  const sideA = a.lat >= 0 ? body.clearLatM : -body.clearLatM;
  const sideB = b.lat >= 0 ? body.clearLatM : -body.clearLatM;
  const path = [from, toWorld(car, endLong, sideA)];
  if (sideA !== sideB) path.push(toWorld(car, endLong, sideB));
  path.push(to);
  return path;
}

export function pathLength(path: readonly WorldPoint[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].z - path[index - 1].z,
    );
  }
  return total;
}

/** Leg duration at a nominal speed, hurrying instead of overrunning the cap. */
function legSeconds(path: readonly WorldPoint[], speedMps: number): number {
  return Math.max(
    0.2,
    Math.min(pathLength(path) / speedMps, MAX_LEG_SECONDS),
  );
}

const driverLat = (
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile,
): number =>
  steeringSide === "left" ? -body.doorLateralM : body.doorLateralM;

/** The kerb is opposite the traffic side: right-hand traffic parks with its
 * right flank to the kerb. */
const kerbLat = (
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile,
): number =>
  trafficSide === "right" ? body.doorLateralM : -body.doorLateralM;

export function driverDoorPoint(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint {
  return toWorld(car, body.frontDoorForwardM, driverLat(steeringSide, body));
}

export function rearKerbDoorPoint(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): WorldPoint {
  return toWorld(car, body.rearDoorForwardM, kerbLat(trafficSide, body));
}

/**
 * Driver walks from their door around the car to the nearest pump, fills for
 * 3–5 s (scaling with how much fuel is going in — which is not the same as how
 * empty the tank is, since a free-drive wallet can buy a part tank), and walks
 * back in.
 */
export function buildRefuelScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  pump: WorldPoint,
  fuelFillFraction: number,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const toCar = Math.hypot(car.x - pump.x, car.z - pump.z);
  const stand =
    toCar > 0.001
      ? {
          x: pump.x + ((car.x - pump.x) / toCar) * PUMP_STAND_OFF_M,
          z: pump.z + ((car.z - pump.z) / toCar) * PUMP_STAND_OFF_M,
        }
      : pump;
  const out = routeAroundCar(car, door, stand, body);
  const back = routeAroundCar(car, stand, door, body);
  const pumpSeconds =
    PUMP_BASE_SECONDS +
    PUMP_EXTRA_SECONDS * Math.min(1, Math.max(0, fuelFillFraction));
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
    },
    { action: "walk", path: out, seconds: legSeconds(out, WALK_SPEED_MPS) },
    {
      action: "idle",
      seconds: pumpSeconds,
      face: headingTo(stand, car),
      sound: "pump_start",
      fuelWindow: true,
    },
    {
      action: "walk",
      path: back,
      seconds: legSeconds(back, WALK_SPEED_MPS),
      sound: "pump_stop",
    },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

/**
 * The waiting rider walks from the kerb to the rear kerb-side door, pauses at
 * the handle, and ducks in.
 */
export function buildBoardScript(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  riderSpot: WorldPoint,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide, body);
  const approach = routeAroundCar(car, riderSpot, doorPoint, body);
  return [
    {
      action: "walk",
      path: approach,
      seconds: legSeconds(approach, WALK_SPEED_MPS),
    },
    {
      action: "idle",
      seconds: 0.55,
      face: headingTo(doorPoint, car),
      sound: "door",
    },
    { action: "hide", seconds: 0.5, sound: "door_close", carDip: true },
  ];
}

/**
 * The passenger steps out of the rear kerb-side door and walks a few metres
 * straight off that same kerb side before despawning.
 *
 * The target is deliberately car-relative rather than a fixed venue kerb spot.
 * The player parks wherever they stop, at any heading, so a fixed world point
 * can land across the car in its local frame — which made the passenger detour
 * back around the body ("walks away, then comes back"). Walking straight out
 * the door's own side is always a clean walk-off that never crosses the car,
 * whatever the park, and the scene cuts as soon as they have stepped clear.
 */
export function buildExitScript(
  car: CutsceneCarPose,
  trafficSide: TrafficSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const doorPoint = rearKerbDoorPoint(car, trafficSide, body);
  const lat = kerbLat(trafficSide, body);
  const away = toWorld(
    car,
    body.rearDoorForwardM,
    lat + (lat >= 0 ? EXIT_WANDER_M : -EXIT_WANDER_M),
  );
  const walk = [doorPoint, away];
  return [
    {
      action: "show",
      path: [doorPoint],
      seconds: 0.5,
      face: headingTo(car, doorPoint),
      sound: "door",
      carDip: true,
    },
    {
      action: "walk",
      path: walk,
      seconds: legSeconds(walk, WALK_SPEED_MPS),
      sound: "door_close",
    },
    { action: "hide", seconds: 0.2 },
  ];
}

/**
 * Spreads `carrying: true` onto a step, or nothing at all. Adding the key only
 * when it is true is what keeps a `"none"` errand's script identical to the one
 * this builder produced before there was anything to carry.
 */
const heldOn = (carrying: boolean) => (carrying ? { carrying: true } : {});

/**
 * The delivery errand, both ends: driver jogs from their door to the venue
 * door / address building line, disappears inside for the dwell, jogs back and
 * gets in. Long forecourts hurry rather than drag (MAX_LEG_SECONDS).
 *
 * `cargo` is what makes the two ends different to watch — see {@link
 * ErrandCargo}. The bag is in hand for the whole of the loaded leg, the walk
 * included, so it is stamped on the `show` that starts the leg as well as the
 * `run` itself.
 */
export function buildErrandScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  buildingDoor: WorldPoint,
  dwellSeconds: number = STORE_DWELL_SECONDS,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
  cargo: ErrandCargo = "none",
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const out = routeAroundCar(car, door, buildingDoor, body);
  const back = routeAroundCar(car, buildingDoor, door, body);
  const outbound = cargo === "deliver";
  const inbound = cargo === "collect";
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
      ...heldOn(outbound),
    },
    {
      action: "run",
      path: out,
      seconds: legSeconds(out, RUN_SPEED_MPS),
      sound: "door_close",
      ...heldOn(outbound),
    },
    { action: "hide", seconds: dwellSeconds },
    {
      action: "show",
      path: [buildingDoor],
      seconds: 0.15,
      ...heldOn(inbound),
    },
    {
      action: "run",
      path: back,
      seconds: legSeconds(back, RUN_SPEED_MPS),
      ...heldOn(inbound),
    },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

/**
 * The bicycle's walk envelope: tiny, door-less. The "door" lateral is where
 * the rider dismounts to, just clear of the frame.
 */
export const BIKE_CUTSCENE_BODY: CutsceneBodyProfile = {
  bodyHalfLongM: 1.0,
  bodyHalfLatM: 0.35,
  clearLongM: 1.5,
  clearLatM: 0.9,
  doorLateralM: 0.6,
  frontDoorForwardM: 0.2,
  rearDoorForwardM: -0.3,
};

/** The motorbike's walk envelope: bicycle-shaped but a real 2 m long. */
export const MOTORBIKE_CUTSCENE_BODY: CutsceneBodyProfile = {
  bodyHalfLongM: 1.05,
  bodyHalfLatM: 0.42,
  clearLongM: 1.55,
  clearLatM: 1.0,
  doorLateralM: 0.7,
  frontDoorForwardM: 0.2,
  rearDoorForwardM: -0.35,
};

/**
 * The courier's errand on a bicycle: dismount beside the parked bike, run to
 * the venue door, dwell inside, run back and remount. No door sounds and no
 * suspension dip — a bike has neither; the session hides the rider on the
 * bike for the scene's duration so the walking actor reads as the same
 * person. `cargo` loads the same leg it loads on a car errand.
 */
export function buildBikeErrandScript(
  bike: CutsceneCarPose,
  buildingDoor: WorldPoint,
  dwellSeconds: number = STORE_DWELL_SECONDS,
  body: CutsceneBodyProfile = BIKE_CUTSCENE_BODY,
  cargo: ErrandCargo = "none",
): CutsceneStep[] {
  const mount = toWorld(bike, 0, body.doorLateralM);
  const out = routeAroundCar(bike, mount, buildingDoor, body);
  const back = routeAroundCar(bike, buildingDoor, mount, body);
  const outbound = cargo === "deliver";
  const inbound = cargo === "collect";
  return [
    {
      action: "show",
      path: [mount],
      seconds: 0.4,
      face: headingTo(bike, mount),
      ...heldOn(outbound),
    },
    {
      action: "run",
      path: out,
      seconds: legSeconds(out, RUN_SPEED_MPS),
      ...heldOn(outbound),
    },
    { action: "hide", seconds: dwellSeconds },
    {
      action: "show",
      path: [buildingDoor],
      seconds: 0.15,
      ...heldOn(inbound),
    },
    {
      action: "run",
      path: back,
      seconds: legSeconds(back, RUN_SPEED_MPS),
      ...heldOn(inbound),
    },
    { action: "hide", seconds: 0.35 },
  ];
}

/**
 * Roadside rescue for a tank run dry mid-drive (career only): the driver
 * steps out, walks to the filler on their own side of the rear flank — never
 * crossing the body — waits out the fill, and gets back in. The scene's input
 * lock is the immobilization; the premium pricing lands on its pump event.
 */
export function buildRoadsideRefuelScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const fillerLat =
    steeringSide === "left" ? -(body.doorLateralM + 0.25) : body.doorLateralM + 0.25;
  const filler = toWorld(car, body.rearDoorForwardM - 0.4, fillerLat);
  const out = routeAroundCar(car, door, filler, body);
  const back = routeAroundCar(car, filler, door, body);
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
    },
    { action: "walk", path: out, seconds: legSeconds(out, WALK_SPEED_MPS) },
    {
      action: "idle",
      seconds: PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS,
      face: headingTo(filler, car),
      sound: "pump_start",
      fuelWindow: true,
    },
    {
      action: "walk",
      path: back,
      seconds: legSeconds(back, WALK_SPEED_MPS),
      sound: "pump_stop",
    },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

/**
 * Where the driver stands to work, in the car's own frame: at the front wing on
 * the driver's side, not out in front of the bumper.
 *
 * Dead ahead was the first attempt and it is wrong for the place this scene
 * plays. A car noses into a 6.4 m bay until its collider meets the back wall,
 * which leaves the point a bumper's length further forward standing outside the
 * building — the driver walked through the back wall to get to it. Beside the
 * wing, the actor is never further from the bay's centre than the car itself
 * is, whichever way it parked.
 */
const WORK_FORWARD_FRACTION = 0.6;
const WORK_LATERAL_CLEARANCE_M = 0.35;

// --- Where a staged scene is watched from ------------------------------------

/**
 * A solid the staged camera must not look through, as an oriented box in world
 * space. Structurally the OBB arm of `StaticObstacle` — U is the given unit
 * axis, V its perpendicular `(uz, -ux)` — so the session can hand its simulation
 * obstacles straight over without converting anything.
 *
 * No height, because `StaticObstacle` has none: the simulation resolves a car
 * against these and a car cannot duck. `chooseStagedShot` therefore *ranks* by
 * how many it crosses rather than rejecting outright, so a low solid the
 * sightline would clear — a pump island, a kerb — costs a candidate its place in
 * the order without ever leaving the scene unframeable.
 */
export interface StagedBoxBlocker {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

/** The convex arm — a bespoke landmark's exact ground footprint (the round
 * hall's ellipse, today) rather than an over- or under-broad box. Points
 * wound clockwise, matching `StaticObstacle`'s own "convex" variant.
 * Discriminated from `StagedBoxBlocker` structurally (by the presence of
 * `points`) rather than by an added `kind` tag, so every existing box
 * construction site — `stagedBlockersOf`'s obb/aabb branches,
 * `gasStationCanopyWorld`'s cover literal — needed no change to keep
 * satisfying the (now narrower) box shape. */
export interface StagedConvexBlocker {
  readonly points: readonly WorldPoint[];
}

export type StagedBlocker = StagedBoxBlocker | StagedConvexBlocker;

/** A blocker overhead: the same box, plus the height to stay under. Boxes
 * only — an overhead cover is always a canopy/roof slab in this codebase,
 * never a bespoke landmark silhouette. */
export interface StagedCover extends StagedBoxBlocker {
  readonly undersideY: number;
}

/**
 * Azimuths tried around the scene, the first being the one the stager asked
 * for. Twelve is 30° apart — finer than the framing is sensitive to, and the
 * whole sweep is a few hundred flops run once when a scene starts.
 */
const STAGED_AZIMUTH_COUNT = 12;

/**
 * How far under a roof the camera stands when the scene it is filming is under
 * one.
 *
 * Bounded on both sides, and the gap is not wide. Too low and the car's own roof
 * hides the actor working behind it; too high and the slab's underside — and the
 * fascia band around its edge — take the top of the frame, which is the bug this
 * exists to fix. Under the station's 4.36 m canopy this lands at ~3.0 m, a
 * sightline about 15° off level at the nine metres the stager pulls back.
 */
export const STAGED_COVER_HEADROOM_M = 1.35;
/** Below this the car is in the way whatever the cover is doing. */
export const STAGED_MIN_HEIGHT_M = 2.4;

/** Is (px, pz) inside the convex polygon? Same clockwise-winding cross-product
 * test as the collision core's own `convexEndpointPenetration`
 * (`app/game/simulation/playerDynamics.ts`) and `distanceToStaticObstacle`
 * (`simulationAdapter.ts`) — re-derived here rather than shared, since this
 * module has no reason to depend on either. */
function pointInConvexBlocker(px: number, pz: number, points: readonly WorldPoint[]): boolean {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    const cross = (b.x - a.x) * (pz - a.z) - (b.z - a.z) * (px - a.x);
    if (cross > 0) return false;
  }
  return true;
}

/** Is (px, pz) inside the blocker? */
function pointInBlocker(px: number, pz: number, box: StagedBlocker): boolean {
  if ("points" in box) return pointInConvexBlocker(px, pz, box.points);
  const dx = px - box.x;
  const dz = pz - box.z;
  return (
    Math.abs(dx * box.ux + dz * box.uz) <= box.halfU &&
    Math.abs(dx * box.uz - dz * box.ux) <= box.halfV
  );
}

/** Orientation of the turn a->b->c: 0 collinear, 1 clockwise, 2
 * counter-clockwise (in this codebase's x-right/z-"up" convention) — the
 * standard building block for exact segment-vs-segment intersection. */
function turnOrientation(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): 0 | 1 | 2 {
  const value = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

/** Whether collinear point c lies within segment a-b's own bounding box —
 * only meaningful when `turnOrientation(a, b, c)` is already 0. */
function collinearPointOnSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  return (
    cx <= Math.max(ax, bx) + 1e-9 &&
    cx >= Math.min(ax, bx) - 1e-9 &&
    cz <= Math.max(az, bz) + 1e-9 &&
    cz >= Math.min(az, bz) - 1e-9
  );
}

/** Exact segment-vs-segment intersection (including touching/collinear
 * overlap), via orientation tests. */
function segmentsIntersect(
  p1x: number,
  p1z: number,
  q1x: number,
  q1z: number,
  p2x: number,
  p2z: number,
  q2x: number,
  q2z: number,
): boolean {
  const o1 = turnOrientation(p1x, p1z, q1x, q1z, p2x, p2z);
  const o2 = turnOrientation(p1x, p1z, q1x, q1z, q2x, q2z);
  const o3 = turnOrientation(p2x, p2z, q2x, q2z, p1x, p1z);
  const o4 = turnOrientation(p2x, p2z, q2x, q2z, q1x, q1z);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && collinearPointOnSegment(p1x, p1z, q1x, q1z, p2x, p2z)) return true;
  if (o2 === 0 && collinearPointOnSegment(p1x, p1z, q1x, q1z, q2x, q2z)) return true;
  if (o3 === 0 && collinearPointOnSegment(p2x, p2z, q2x, q2z, p1x, p1z)) return true;
  if (o4 === 0 && collinearPointOnSegment(p2x, p2z, q2x, q2z, q1x, q1z)) return true;
  return false;
}

/** Does the segment meet the convex polygon — either endpoint inside, or it
 * crosses an edge? */
function segmentCrossesConvexBlocker(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  points: readonly WorldPoint[],
): boolean {
  if (pointInConvexBlocker(ax, az, points) || pointInConvexBlocker(bx, bz, points)) {
    return true;
  }
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    if (segmentsIntersect(ax, az, bx, bz, p1.x, p1.z, p2.x, p2.z)) return true;
  }
  return false;
}

/** Does the segment meet the blocker? `segmentCrossesRect` in the box's own
 * frame, or exact segment-vs-convex-polygon intersection. */
function segmentCrossesBlocker(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  box: StagedBlocker,
): boolean {
  if ("points" in box) return segmentCrossesConvexBlocker(ax, az, bx, bz, box.points);
  const adx = ax - box.x;
  const adz = az - box.z;
  const bdx = bx - box.x;
  const bdz = bz - box.z;
  return segmentCrossesRect(
    adx * box.ux + adz * box.uz,
    adx * box.uz - adz * box.ux,
    bdx * box.ux + bdz * box.uz,
    bdx * box.uz - bdz * box.ux,
    box.halfU,
    box.halfV,
  );
}

/** Blocker centre and its own maximum reach from that centre — the broad-phase
 * "could this possibly touch the ring" bound `chooseStagedShot` filters on
 * before running the exact per-candidate test. */
function blockerCenterAndReach(box: StagedBlocker): { x: number; z: number; reach: number } {
  if ("points" in box) {
    let sumX = 0;
    let sumZ = 0;
    for (const point of box.points) {
      sumX += point.x;
      sumZ += point.z;
    }
    const x = sumX / box.points.length;
    const z = sumZ / box.points.length;
    let reach = 0;
    for (const point of box.points) {
      reach = Math.max(reach, Math.hypot(point.x - x, point.z - z));
    }
    return { x, z, reach };
  }
  return { x: box.x, z: box.z, reach: Math.hypot(box.halfU, box.halfV) };
}

/**
 * Where to stand the staged camera: the same ring the generic stager has always
 * used, but at the azimuth on it that can actually see the scene.
 *
 * The stager picks a perpendicular to the car–actor line and flips it to
 * whichever side the chase camera already stands on, so the glide in never
 * swings across the action. What it never did was ask whether anything was in
 * the way, and on a gas station forecourt the answer is often yes: pulled nine
 * metres along the forecourt's long axis the camera is still under a 13 m
 * canopy, at a height above its 4.36 m underside, with a canopy pillar between
 * it and the car. Which of the two perpendiculars that happens on depends on
 * where the driver's door ended up, hence on how the player pulled in — which is
 * why the same station films fine most of the time and not the rest of it.
 *
 * Ranked, not filtered, and the requested azimuth is candidate zero with a turn
 * of zero. A scene nothing blocks therefore keeps the exact shot it had before
 * this existed; only a blocked one moves, and only as far as it must.
 */
export function chooseStagedShot(
  midX: number,
  midZ: number,
  radius: number,
  cameraY: number,
  /** Unit vector: the azimuth the stager would have used on its own. */
  preferred: WorldPoint,
  /** Points the shot exists to show — the car, and whatever the actor walks to. */
  subjects: readonly WorldPoint[],
  blockers: readonly StagedBlocker[],
  cover: StagedCover | null,
  /**
   * Optional structural test for the camera mark itself. A low flyover may
   * cover one ring azimuth while leaving the people and cars outside it; safe
   * azimuths rank ahead of those that would put the lens inside concrete.
   */
  cameraPositionAllowed?: (position: WorldPoint) => boolean,
): { readonly x: number; readonly y: number; readonly z: number } {
  // Only solids that could reach the ring are worth testing against it. One
  // pass, so the per-candidate loop below stays over a handful rather than over
  // every building solid and venue lot on the map.
  const near = blockers.filter((box) => {
    const { x, z, reach } = blockerCenterAndReach(box);
    return Math.hypot(x - midX, z - midZ) <= radius + reach;
  });
  const baseAngle = Math.atan2(preferred.x, preferred.z);
  let best: {
    x: number;
    z: number;
    structurallyUnsafe: boolean;
    covered: boolean;
    blocked: number;
    turn: number;
  } | null = null;
  for (let index = 0; index < STAGED_AZIMUTH_COUNT; index += 1) {
    const turn = (index * 2 * Math.PI) / STAGED_AZIMUTH_COUNT;
    const angle = baseAngle + turn;
    const x = midX + Math.sin(angle) * radius;
    const z = midZ + Math.cos(angle) * radius;
    const structurallyUnsafe = cameraPositionAllowed
      ? !cameraPositionAllowed({ x, z })
      : false;
    const covered = cover !== null && pointInBlocker(x, z, cover);
    let blocked = 0;
    for (const subject of subjects) {
      for (const box of near) {
        if (segmentCrossesBlocker(x, z, subject.x, subject.z, box)) blocked += 1;
      }
    }
    // Shortest way round, so a candidate 30° the other way is a small turn and
    // not an eleven-twelfths one.
    const swing = Math.min(turn, 2 * Math.PI - turn);
    if (
      best === null ||
      (structurallyUnsafe !== best.structurallyUnsafe
        ? !structurallyUnsafe
        : covered !== best.covered
          ? !covered
          : blocked !== best.blocked
            ? blocked < best.blocked
            : swing < best.turn)
    ) {
      best = { x, z, structurallyUnsafe, covered, blocked, turn: swing };
    }
  }
  const under = cover
    ? Math.max(
        STAGED_MIN_HEIGHT_M,
        Math.min(cameraY, cover.undersideY - STAGED_COVER_HEADROOM_M),
      )
    : cameraY;
  return best
    ? { x: best.x, y: under, z: best.z }
    : {
        x: midX + preferred.x * radius,
        y: under,
        z: midZ + preferred.z * radius,
      };
}

/**
 * Where the repair scene is watched from, relative to the car, given which way
 * the bay's open side faces.
 *
 * Every other scene is framed by the generic stager: a perpendicular offset
 * from the car–actor line, pulled back nine metres and lifted four. In a 4.6 m
 * bay walled on three sides that puts the camera through a wall and into the
 * roof, which is exactly what it did.
 *
 * The direction is the shop's, not the car's. Framing off the car's own axis
 * works right until someone reverses in, and then "behind the car" is the back
 * wall. The height sits below the lintel so the sightline goes through the
 * opening rather than down onto it.
 */
export const REPAIR_CAMERA_BACK_M = 9;
export const REPAIR_CAMERA_HEIGHT_M = 2.6;
/**
 * How far off the bay's axis the shot sits, toward the side the driver works
 * on. Square-on, the car is between the camera and the mechanic and hides the
 * only thing the scene exists to show.
 *
 * Bounded by the mouth, not by taste. Step outside the opening's own width and
 * you are looking along the outside of the flank wall at the building next
 * door — which is what 2.4 m did, on a bay whose opening only reaches 2.3 m
 * either side of the axis.
 */
export const REPAIR_CAMERA_ASIDE_M = 1.4;

export function repairCameraPosition(
  midX: number,
  midZ: number,
  mouth: WorldPoint,
  /** Which way is "the driver's side" — any vector pointing that way. */
  towardWorkside: WorldPoint = { x: 0, z: 0 },
): { readonly x: number; readonly y: number; readonly z: number } {
  // Perpendicular to the mouth, turned to whichever flank the work is on.
  const perpX = -mouth.z;
  const perpZ = mouth.x;
  const side =
    perpX * towardWorkside.x + perpZ * towardWorkside.z < 0 ? -1 : 1;
  return {
    x: midX + mouth.x * REPAIR_CAMERA_BACK_M + perpX * side * REPAIR_CAMERA_ASIDE_M,
    y: REPAIR_CAMERA_HEIGHT_M,
    z: midZ + mouth.z * REPAIR_CAMERA_BACK_M + perpZ * side * REPAIR_CAMERA_ASIDE_M,
  };
}

/**
 * Driver gets out, works at the front wing for a few seconds, gets back in.
 *
 * Takes only the car's pose — no bay, no map data — so like the roadside rescue
 * and the traffic stop it can never fail to stage. That matters more here than
 * it looks: `startCutscene` answers an unstageable scene by completing it
 * immediately, and this scene's `repairWindow` step is where the bill is
 * charged and the car is put right. A shop that could not be staged would be a
 * button that took the player's money and fixed nothing, or fixed the car for
 * free — depending which way it failed.
 *
 * Being car-relative also keeps the walk inside whatever space the car itself
 * fits in, which is what stops the driver strolling through a bay wall on the
 * way round — see `WORK_FORWARD_FRACTION` for why that is the wing rather than
 * the bumper.
 */
export function buildRepairScript(
  car: CutsceneCarPose,
  steeringSide: SteeringSide,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneStep[] {
  const door = driverDoorPoint(car, steeringSide, body);
  const driverSign = steeringSide === "left" ? -1 : 1;
  const wing = toWorld(
    car,
    body.bodyHalfLongM * WORK_FORWARD_FRACTION,
    driverSign * (body.doorLateralM + WORK_LATERAL_CLEARANCE_M),
  );
  const out = routeAroundCar(car, door, wing, body);
  const back = routeAroundCar(car, wing, door, body);
  return [
    {
      action: "show",
      path: [door],
      seconds: 0.35,
      face: headingTo(car, door),
      sound: "door",
    },
    { action: "walk", path: out, seconds: legSeconds(out, WALK_SPEED_MPS) },
    {
      action: "idle",
      seconds: REPAIR_WORK_SECONDS,
      face: headingTo(wing, car),
      repairWindow: true,
    },
    { action: "walk", path: back, seconds: legSeconds(back, WALK_SPEED_MPS) },
    { action: "hide", seconds: 0.45, sound: "door_close", carDip: true },
  ];
}

// --- The traffic stop -------------------------------------------------------
//
// Unlike every other scene, this one starts with the car moving and has to park
// it: a witnessed violation now plays out as an actual pull-over rather than a
// fine appearing out of nowhere (issue #141). The whole thing is choreography —
// the car is not driven to the kerb by the physics, it is carried there along
// an eased track that the session replays onto the simulation's player pose, so
// the core (and every NPC avoiding the player) agrees with what is on screen.

/** Clearance kept between the parked car's flank and the kerb line. */
const PULLOVER_KERB_GAP_M = 0.35;
/** Bumper-to-bumper gap the patrol leaves behind the car it stopped. */
const PATROL_STOP_GAP_M = 3.2;
/** How far back the patrol starts, so it visibly follows you in. */
const PATROL_RUN_UP_M = 21;
/** Lateral clearance the officer keeps off a flank while walking or standing. */
const OFFICER_CLEAR_M = 0.55;
/** Where the officer waits behind the car before stepping up to the window. */
const OFFICER_FLANK_BACK_M = 1.1;
/** How far off the carriageway centreline the fallback park sits, absent a road
 * frame to measure a real kerb against. Roughly one lane width. */
const PULLOVER_BLIND_SHIFT_M = 1.7;

/** The patrol's own envelope: a saloon, so the flagship's numbers fit it. */
const PATROL_BODY = DEFAULT_CUTSCENE_BODY;

/** Shortest distance the car rolls before it is stopped, whatever its speed. */
export const MIN_PULLOVER_RUN_M = 7;
/** Speed the glide is timed against when the car is already crawling, so a
 * standing stop still eases over rather than taking the full cap. */
const PULLOVER_NOMINAL_MPS = 5;
const MIN_PULLOVER_SECONDS = 1.6;
const MAX_PULLOVER_SECONDS = 4.5;
/** How long the officer stands at the driver's window. */
export const WINDOW_DWELL_SECONDS = 2.6;

/** The carriageway the pull-over parks against: a road surface's centreline
 * (not a lane's) plus its half width, which is what puts the car at the kerb
 * rather than at the edge of whichever lane it happened to be in. */
export interface PulloverRoad {
  readonly centerline: readonly WorldPoint[];
  readonly halfWidthM: number;
}

export interface PolylineHit {
  readonly point: WorldPoint;
  /** Segment tangent in the heading convention (0 = +z). */
  readonly tangent: number;
  /** Arc length from the polyline's start to the projected point. */
  readonly along: number;
  /** Perpendicular distance from the query point to the polyline. */
  readonly distance: number;
}

/** Nearest point on a polyline to (x, z). Null for a degenerate polyline. */
export function projectOntoPolyline(
  points: readonly WorldPoint[],
  x: number,
  z: number,
): PolylineHit | null {
  if (points.length < 2) return null;
  let best: PolylineHit | null = null;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length)),
    );
    const hasElevation =
      a.elevationM !== undefined || b.elevationM !== undefined;
    const point: WorldPoint = {
      x: a.x + dx * t,
      z: a.z + dz * t,
      ...(hasElevation
        ? {
            elevationM:
              (a.elevationM ?? 0) +
              ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * t,
          }
        : {}),
    };
    const distance = Math.hypot(x - point.x, z - point.z);
    if (!best || distance < best.distance) {
      best = {
        point,
        tangent: Math.atan2(dx, dz),
        along: travelled + length * t,
        distance,
      };
    }
    travelled += length;
  }
  return best;
}

/** The pose `along` metres into a polyline, clamped to its ends. */
export function pointAlongPolyline(
  points: readonly WorldPoint[],
  along: number,
): PolylineHit | null {
  if (points.length < 2) return null;
  let travelled = 0;
  let last: PolylineHit | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const tangent = Math.atan2(dx, dz);
    if (along <= travelled + length) {
      const t = Math.max(0, Math.min(1, (along - travelled) / length));
      const hasElevation =
        a.elevationM !== undefined || b.elevationM !== undefined;
      return {
        point: {
          x: a.x + dx * t,
          z: a.z + dz * t,
          ...(hasElevation
            ? {
                elevationM:
                  (a.elevationM ?? 0) +
                  ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * t,
              }
            : {}),
        },
        tangent,
        along: travelled + length * t,
        distance: 0,
      };
    }
    travelled += length;
    last = { point: b, tangent, along: travelled, distance: 0 };
  }
  return last;
}

/** Shortest-arc heading interpolation, so a stop never spins the long way. */
function lerpHeading(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

/**
 * A car's pose `t` of the way through a move. `t` is expected pre-eased; the
 * session eases once so the position and heading stay in step.
 */
export function lerpCarPose(
  from: CutsceneCarPose,
  to: CutsceneCarPose,
  t: number,
): CutsceneCarPose {
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    heading: lerpHeading(from.heading, to.heading, t),
    ...(from.elevationM !== undefined || to.elevationM !== undefined
      ? {
          elevationM:
            (from.elevationM ?? 0) +
            ((to.elevationM ?? 0) - (from.elevationM ?? 0)) * t,
        }
      : {}),
  };
}

/**
 * Ease-out for a car coming to rest: `1 - (1-t)²`. Its speed at t=0 is exactly
 * `2·distance/seconds`, which is why {@link pulloverSeconds} solves for the
 * duration that makes that the speed the car was already doing — the glide
 * starts at the driver's own pace and decelerates smoothly to nothing.
 */
export function settleEase(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

/** How far the car rolls before stopping, from the speed it was clocked at. */
export function pulloverRunM(speedMps: number): number {
  return Math.max(MIN_PULLOVER_RUN_M, Math.max(0, speedMps) * 1.4);
}

function pulloverSeconds(runM: number, speedMps: number): number {
  return Math.max(
    MIN_PULLOVER_SECONDS,
    Math.min(
      MAX_PULLOVER_SECONDS,
      (2 * runM) / Math.max(speedMps, PULLOVER_NOMINAL_MPS),
    ),
  );
}

/**
 * Where the car ends up: `runM` further along the road it is on, shifted to the
 * kerb. With a road frame the shift is measured from the carriageway centreline
 * so the car finishes hard against the kerb whatever lane it was in and however
 * wide the street is; without one (an unmapped surface, or a car already off
 * the road) it falls back to a lane-width shift off the car's own heading —
 * never nothing, because the scene has to end with the car parked somewhere.
 */
export function pulloverPose(
  car: CutsceneCarPose,
  runM: number,
  trafficSide: TrafficSide,
  road: PulloverRoad | null,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
): CutsceneCarPose {
  // The kerb is on the vehicle's right in right-hand traffic — the same rule
  // kerbLat encodes, in metres rather than door offsets.
  const kerbSign = trafficSide === "right" ? 1 : -1;
  const hit = road ? projectOntoPolyline(road.centerline, car.x, car.z) : null;
  if (!road || !hit) {
    const blind = toWorld(car, runM, kerbSign * PULLOVER_BLIND_SHIFT_M);
    return {
      x: blind.x,
      z: blind.z,
      heading: car.heading,
      ...(blind.elevationM !== undefined
        ? { elevationM: blind.elevationM }
        : {}),
    };
  }
  // Which way along the centreline the car is travelling; a road's centreline
  // is authored in one direction and the player may be going either way.
  const forward = Math.cos(car.heading - hit.tangent) >= 0 ? 1 : -1;
  const target =
    pointAlongPolyline(road.centerline, hit.along + forward * runM) ?? hit;
  const heading = forward > 0 ? target.tangent : target.tangent + Math.PI;
  const lateral = Math.max(
    0,
    road.halfWidthM - body.bodyHalfLatM - PULLOVER_KERB_GAP_M,
  );
  return {
    x: target.point.x + Math.cos(heading) * lateral * kerbSign,
    z: target.point.z - Math.sin(heading) * lateral * kerbSign,
    heading,
    ...(target.point.elevationM !== undefined || car.elevationM !== undefined
      ? {
          elevationM: target.point.elevationM ?? car.elevationM ?? 0,
        }
      : {}),
  };
}

export interface PulloverPlan {
  readonly steps: readonly CutsceneStep[];
  /** Where the player's car ends up; the session drives the sim to it. */
  readonly parked: CutsceneCarPose;
  /** Where the patrol ends up, and where its rig is spawned to arrive from. */
  readonly patrol: CutsceneCarPose;
  readonly patrolStart: CutsceneCarPose;
}

/**
 * The whole traffic stop: the car glides to the kerb while the patrol pulls in
 * behind it, an officer gets out, walks up the driver's flank, spends a few
 * seconds at the window (where the fine actually lands), walks back and gets
 * in.
 *
 * The officer's route is built entirely from the two *parked* poses, which
 * share a heading and sit nose-to-tail, so the walk runs parallel to both car
 * bodies at `doorLateralM + OFFICER_CLEAR_M` — outside `bodyHalfLatM` on
 * either of them, and therefore never through one.
 */
export function buildPulloverScript(
  car: CutsceneCarPose,
  speedMps: number,
  steeringSide: SteeringSide,
  trafficSide: TrafficSide,
  road: PulloverRoad | null,
  body: CutsceneBodyProfile = DEFAULT_CUTSCENE_BODY,
  /**
   * Explicit stopping run used by the renderer when the nominal mark lands
   * beneath a low flyover or on a support footing. Gameplay callers omit it
   * and retain the speed-derived braking distance exactly.
   */
  stoppingRunM: number = pulloverRunM(speedMps),
): PulloverPlan {
  const runM = Math.max(MIN_PULLOVER_RUN_M, stoppingRunM);
  const parked = pulloverPose(car, runM, trafficSide, road, body);
  const behindM =
    body.bodyHalfLongM + PATROL_BODY.bodyHalfLongM + PATROL_STOP_GAP_M;
  const parkedRoadHit = road
    ? projectOntoPolyline(road.centerline, parked.x, parked.z)
    : null;
  const roadForward = parkedRoadHit
    ? Math.cos(parked.heading - parkedRoadHit.tangent) >= 0
      ? 1
      : -1
    : 0;
  const kerbSign = trafficSide === "right" ? 1 : -1;
  const lateral = road
    ? Math.max(
        0,
        road.halfWidthM - body.bodyHalfLatM - PULLOVER_KERB_GAP_M,
      )
    : 0;
  const patrolAt = (back: number): CutsceneCarPose => {
    const target =
      road && parkedRoadHit
        ? pointAlongPolyline(
            road.centerline,
            parkedRoadHit.along - roadForward * back,
          )
        : null;
    if (target) {
      const heading =
        roadForward > 0 ? target.tangent : target.tangent + Math.PI;
      return {
        x: target.point.x + Math.cos(heading) * lateral * kerbSign,
        z: target.point.z - Math.sin(heading) * lateral * kerbSign,
        heading,
        ...(target.point.elevationM !== undefined ||
        parked.elevationM !== undefined
          ? {
              elevationM:
                target.point.elevationM ?? parked.elevationM ?? 0,
            }
          : {}),
      };
    }
    const point = toWorld(parked, -back, 0);
    return {
      x: point.x,
      z: point.z,
      heading: parked.heading,
      ...(point.elevationM !== undefined
        ? { elevationM: point.elevationM }
        : {}),
    };
  };
  const patrol = patrolAt(behindM);
  const patrolStart = patrolAt(behindM + PATROL_RUN_UP_M);

  // A ramp is not a single actor plane. Re-project each walking mark to the
  // same road profile as the cars so the officer's feet follow the grade from
  // the patrol door to the driver's window.
  const withRoadElevation = (worldPoint: WorldPoint): WorldPoint => {
    const hit = road
      ? projectOntoPolyline(road.centerline, worldPoint.x, worldPoint.z)
      : null;
    if (!hit || hit.point.elevationM === undefined) return worldPoint;
    return { ...worldPoint, elevationM: hit.point.elevationM };
  };

  // Both cars are driven from the same seat, so the officer's door and the
  // driver's window are on the same side of the road — he steps out and walks
  // straight up the flank.
  const side = driverLat(steeringSide, body) >= 0 ? 1 : -1;
  const officerDoor = withRoadElevation(
    toWorld(
      patrol,
      PATROL_BODY.frontDoorForwardM,
      side * (PATROL_BODY.doorLateralM + OFFICER_CLEAR_M),
    ),
  );
  const walkLat = side * (body.doorLateralM + OFFICER_CLEAR_M);
  const flank = withRoadElevation(
    toWorld(
      parked,
      -body.bodyHalfLongM - OFFICER_FLANK_BACK_M,
      walkLat,
    ),
  );
  const window = withRoadElevation(
    toWorld(parked, body.frontDoorForwardM, walkLat),
  );
  const approach = [officerDoor, flank, window];
  const back = [window, flank, officerDoor];
  const parkedPoint: WorldPoint = {
    x: parked.x,
    z: parked.z,
    ...(parked.elevationM !== undefined
      ? { elevationM: parked.elevationM }
      : {}),
  };

  return {
    parked,
    patrol,
    patrolStart,
    steps: [
      {
        // Nobody is out of a car yet: this step is purely the two cars moving.
        action: "hide",
        seconds: pulloverSeconds(runM, Math.max(0, speedMps)),
        carMoves: [
          { vehicle: "player", from: car, to: parked },
          { vehicle: "patrol", from: patrolStart, to: patrol },
        ],
      },
      {
        action: "show",
        path: [officerDoor],
        seconds: 0.55,
        face: headingTo(officerDoor, parkedPoint),
        sound: "door",
      },
      {
        action: "walk",
        path: approach,
        seconds: legSeconds(approach, WALK_SPEED_MPS),
        sound: "door_close",
      },
      {
        action: "idle",
        seconds: WINDOW_DWELL_SECONDS,
        face: headingTo(window, parkedPoint),
        citeWindow: true,
      },
      { action: "walk", path: back, seconds: legSeconds(back, WALK_SPEED_MPS) },
      { action: "hide", seconds: 0.5, sound: "door_close" },
    ],
  };
}

/** Total running time of a script, for captions and safety timeouts. */
export function scriptSeconds(script: readonly CutsceneStep[]): number {
  let total = 0;
  for (const step of script) total += step.seconds;
  return total;
}

/**
 * The point the camera should frame alongside the car: the step point farthest
 * from it (the pump, the shop door), or the car itself for doorside-only
 * scripts.
 */
export function scriptFocusPoint(
  car: CutsceneCarPose,
  script: readonly CutsceneStep[],
): WorldPoint {
  let focus: WorldPoint = { x: car.x, z: car.z };
  let farthest = 0;
  for (const step of script) {
    for (const point of step.path ?? []) {
      const distance = Math.hypot(point.x - car.x, point.z - car.z);
      if (distance > farthest) {
        farthest = distance;
        focus = point;
      }
    }
  }
  return focus;
}
