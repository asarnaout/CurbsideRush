/**
 * The first-person cockpit's layout, as pure numbers.
 *
 * `GameCanvas` owns the Babylon meshes; this module owns where they go. The
 * split exists for the same reason the road-surface geometry layer is exported
 * from `GameCanvas` — so tests can check the shape of the cabin without
 * standing up an engine, a scene and a city first.
 *
 * Two conventions carry over from the renderer and are easy to get wrong here:
 *
 * - **Cockpit space is the player node's space.** Every `y` below is measured
 *   from the `player-root` transform, which rides at `y = 0.12`, so a value of
 *   `0.96` here is `1.08` above the road. `+z` is forward (out through the
 *   windscreen) and `+x` is the driver's right when they sit on the left.
 * - **Cross-sections are `{y, z}` swept along `x`.** That is exactly what
 *   `createExtrudedPrism` consumes: a profile in the vertical fore-aft plane,
 *   extruded sideways. A part that runs fore-aft instead (a pillar, a door
 *   card) is the same profile swept a very short distance.
 *
 * Nothing here imports Babylon, and nothing here may.
 */

import type { SteeringSide } from "./types";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * How far the wheel turns lock to lock on screen, in radians. Deliberately far
 * short of a real car's ~1.5 turns: the rim carries the only visible cue that
 * the front wheels moved, and past ~55 degrees the spokes read as a blur rather
 * than as steering.
 */
export const MAX_STEERING_WHEEL_SPIN = 0.95;

/**
 * The z of the dash face directly ahead of the driver — the plane the steering
 * column emerges from. The tilted wheel rim must stay in front of it, which is
 * what `tests/gameCanvasInput.test.ts` pins.
 */
export const COCKPIT_DASH_DRIVER_Z = 0.28;

/**
 * The rear-view mirror's rectangle, in Babylon viewport coordinates (fractions
 * of the canvas, origin bottom-left).
 *
 * The mirror is not a texture on a mesh: it is a whole second camera rendered
 * into this strip. That makes it screen-space, so the housing drawn around it
 * has to be screen-space too — the HUD reads the same numbers to place its
 * bezel. Change it here and both move together; hard-code it in either place
 * and they drift apart the first time someone retunes the framing.
 */
export const REAR_VIEW_VIEWPORT = Object.freeze({
  x: 0.36,
  y: 0.845,
  width: 0.28,
  height: 0.125,
});

/** Where the driver's eye sits, in cockpit space. Mirrors the world-space
 * numbers `resolveCockpitCameraPoses` writes: eye height 1.49 and 0.6 m behind
 * the car's origin, less the 0.12 the player node itself rides at. */
export const COCKPIT_EYE_Y = 1.37;
export const COCKPIT_EYE_Z = -0.6;

export interface CockpitProfilePoint {
  readonly y: number;
  readonly z: number;
}

/**
 * The dashboard's cross-section, swept the width of the cabin.
 *
 * Read it as a loop starting at the bottom of the face the driver sees, rising
 * up that face, rolling over the crown and running forward to the windscreen,
 * then back underneath. The shape is doing the lighting: with two lights and no
 * specular anywhere in this game, the only thing that stops a dashboard reading
 * as one flat slab is having surfaces at genuinely different angles. The
 * undercut, the recess step and the proud vent lip each catch a different amount
 * of the sky light, which is where the banding in the reference comes from.
 *
 * The closest point to the driver is `COCKPIT_DASH_DRIVER_Z`, and it must stay
 * that way — the tilted steering rim passes just in front of it.
 */
export const COCKPIT_DASH_PROFILE: readonly CockpitProfilePoint[] = Object.freeze([
  { y: 0.6, z: 0.44 },
  { y: 0.72, z: 0.335 },
  { y: 0.9, z: 0.318 },
  { y: 0.945, z: 0.368 },
  { y: 1.05, z: 0.352 },
  { y: 1.13, z: COCKPIT_DASH_DRIVER_Z },
  { y: 1.185, z: 0.4 },
  { y: 1.195, z: 0.62 },
  { y: 1.155, z: 0.99 },
  { y: 0.88, z: 1.0 },
  { y: 0.66, z: 0.86 },
]);

/** The cabin's full interior width, and the dash's own sweep. */
export const COCKPIT_CABIN_WIDTH = 1.92;

/**
 * The hood over the instrument cluster. Swept only the width of the binnacle
 * and centred on the steering column, so it reads as a separate moulding rather
 * than another ridge running the whole dash.
 */
export const COCKPIT_BINNACLE_PROFILE: readonly CockpitProfilePoint[] =
  Object.freeze([
    { y: 1.198, z: 0.272 },
    { y: 1.232, z: 0.3 },
    { y: 1.236, z: 0.42 },
    { y: 1.206, z: 0.52 },
    { y: 1.186, z: 0.5 },
    { y: 1.19, z: 0.34 },
  ]);

export const COCKPIT_BINNACLE_WIDTH = 0.33;

/**
 * An air vent's outline, as a flattened hexagon.
 *
 * Built in the same `{y, z}` form every other profile uses, but the mesh is
 * turned a quarter turn about Y before it is placed — so `z` here ends up
 * running left-to-right across the dash and the sweep width becomes the vent's
 * depth. That is what gives the pointed ends the reference has; a hexagon swept
 * the ordinary way would come out as a bar with flat, square ends.
 */
export const COCKPIT_VENT_PROFILE: readonly CockpitProfilePoint[] = Object.freeze([
  { y: 0, z: -0.5 },
  { y: 0.34, z: -0.3 },
  { y: 0.34, z: 0.3 },
  { y: 0, z: 0.5 },
  { y: -0.34, z: 0.3 },
  { y: -0.34, z: -0.3 },
]);

export interface CockpitVentSlot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Full width across the points, in metres. */
  readonly width: number;
}

/**
 * The four vents, sitting on the dash's proud lip.
 *
 * Symmetric about the centreline and therefore identical for left- and
 * right-hand drive: a real car moves its centre stack, but nothing else in this
 * cabin is asymmetric and a shifted vent pair would read as a mistake rather
 * than as a detail. The outboard pair is wider, as in the reference.
 */
export const COCKPIT_VENT_SLOTS: readonly CockpitVentSlot[] = Object.freeze([
  { x: -0.79, y: 1.095, z: 0.3, width: 0.3 },
  { x: -0.115, y: 1.095, z: 0.3, width: 0.24 },
  { x: 0.115, y: 1.095, z: 0.3, width: 0.24 },
  { x: 0.79, y: 1.095, z: 0.3, width: 0.3 },
]);

/**
 * Where the cluster's faceplate hangs.
 *
 * It has to stand *proud* of the dash's upper slope, not sit at the depth a
 * real binnacle would — the dashboard is one solid swept prism, so anything
 * placed at a plausible recessed depth is simply inside it and invisible. Set
 * in front of the slope and shaded by the binnacle hood above, it reads as
 * recessed anyway, and the steering rim still passes between it and the driver
 * the way it does in a real car.
 */
export const COCKPIT_CLUSTER = Object.freeze({
  y: 1.148,
  z: 0.275,
  width: 0.235,
  height: 0.072,
  /** Lean-back about X, matching the sightline from the eye point. */
  tiltX: -0.24,
});

/**
 * The cluster's faceplate is baked at this size and never repainted. Its aspect
 * ratio is the mesh's, so the dial faces stay circular.
 */
export const COCKPIT_CLUSTER_TEXTURE = Object.freeze({ width: 512, height: 160 });

/**
 * Both dials sweep from lower-left round through the top to lower-right, the
 * ordinary 270 degrees of a car gauge.
 *
 * These are values for `rotation.z` on a needle pivot, not abstract angles, so
 * start is greater than end: the cluster's local +X is the driver's right and
 * +Y is up, which makes a positive rotation about Z read as anticlockwise from
 * the seat. Assign the result directly and the needle turns the right way.
 */
export const COCKPIT_GAUGE_SWEEP_START = (135 * Math.PI) / 180;
export const COCKPIT_GAUGE_SWEEP_END = (-135 * Math.PI) / 180;

/**
 * Dial centres as a fraction of the faceplate's width, shared by the baked
 * texture and the needle pivots so a retouch of one cannot drift from the other.
 */
export const COCKPIT_GAUGE_CENTRES: readonly number[] = Object.freeze([
  0.2266, 0.7734,
]);

/** Dial radius as a fraction of the faceplate's height. */
export const COCKPIT_GAUGE_RADIUS = 0.375;

/** Fastest reading on the speedometer, in m/s — a shade over the sim's cap. */
export const COCKPIT_SPEEDO_MAX_MPS = 42;

export function resolveGaugeNeedleAngle(
  value: number,
  maximum: number,
  sweepStart: number = COCKPIT_GAUGE_SWEEP_START,
  sweepEnd: number = COCKPIT_GAUGE_SWEEP_END,
): number {
  if (!(maximum > 0)) return sweepStart;
  const travelled = clamp(value / maximum, 0, 1);
  return sweepStart + travelled * (sweepEnd - sweepStart);
}

/**
 * Vertical screen position of the dash's crown, as a fraction from the top of
 * the viewport.
 *
 * The cowl is the one part of the cabin that can eat the road, and it has done
 * before. Anything at or below 0.5 means the crown sits in the lower half of the
 * frame and the carriageway ahead is clear above it.
 */
export function cockpitCowlScreenFraction(
  horizontalFovRad: number,
  viewportAspectRatio: number,
): number {
  const crown = COCKPIT_DASH_PROFILE.reduce((highest, point) =>
    point.y > highest.y ? point : highest,
  );
  const pitch = resolveCockpitPitch(viewportAspectRatio);
  const angleDown = Math.atan2(
    COCKPIT_EYE_Y - crown.y,
    crown.z - COCKPIT_EYE_Z,
  );
  const verticalHalfFov = Math.atan(
    Math.tan(horizontalFovRad / 2) / viewportAspectRatio,
  );
  return 0.5 + (0.5 * Math.tan(angleDown - pitch)) / Math.tan(verticalHalfFov);
}

/**
 * Pitches the cockpit camera down slightly on wider viewports.
 *
 * A phone in landscape is much shorter than a desktop window, so the same
 * horizontal field of view shows far less road. Nudging the pitch keeps the
 * driver's sightline landing in roughly the same place on the tarmac.
 */
export function resolveCockpitPitch(viewportAspectRatio: number): number {
  const wideBlend = clamp((viewportAspectRatio - 1.6) / 0.4, 0, 1);
  return 0.1 + wideBlend * 0.02;
}

/** Returns rotation around the wheel's own steering-column axis. */
export function resolveSteeringWheelSpin(steer: number): number {
  if (steer === 0) return 0;
  return -clamp(steer, -1, 1) * MAX_STEERING_WHEEL_SPIN;
}

export interface CockpitSteeringGeometry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mountRotationX: number;
  readonly wheelDiameter: number;
  readonly rimThickness: number;
}

export function resolveCockpitSteeringGeometry(
  steeringSide: SteeringSide,
): CockpitSteeringGeometry {
  return {
    x: steeringSide === "left" ? -0.47 : 0.47,
    // Low enough that the rim's crown stays under the dash's own skyline and
    // the cluster reads through the top of the wheel's opening. At the old 1.16
    // the rim topped out within 4 cm of the eye point, which is why the wheel
    // used to fill the frame and hide the instruments it sits in front of.
    y: 1.05,
    z: 0.22,
    mountRotationX: Math.PI / 2 + 0.2,
    wheelDiameter: 0.32,
    rimThickness: 0.027,
  };
}
