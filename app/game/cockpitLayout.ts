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
  x: 0.385,
  // Hangs below the speed readout rather than behind it. The readout is
  // centred at the top of the frame and takes a much larger share of a 390px
  // phone in landscape than of a desktop window, so the clearance has to be
  // set for the phone or the numeral ends up sitting on the glass.
  y: 0.775,
  width: 0.23,
  height: 0.115,
});

/**
 * Where to hang a quad off the first-person camera so it covers a viewport
 * rectangle exactly.
 *
 * The mirror's reflection used to be a second camera rendered straight into
 * that rectangle. It is now a render target, which has to be shown on some
 * geometry — and geometry parented to the camera is screen-space by
 * construction, so the rectangle, the HUD housing drawn around it and the image
 * inside it all stay locked together however the player is looking.
 *
 * The camera is `FOVMODE_HORIZONTAL_FIXED`, so `fov` is the horizontal angle
 * and the vertical half-extent is the horizontal one over the aspect ratio.
 * Both depend on the field of view and the canvas shape, so this has to be
 * recomputed whenever either moves — a quad sized once at construction slides
 * out from under its own housing the first time someone drags the FOV slider.
 */
export function cameraPanelPlacement(
  rect: { x: number; y: number; width: number; height: number },
  horizontalFovRad: number,
  viewportAspectRatio: number,
  distance: number,
): { width: number; height: number; x: number; y: number } {
  const halfWidth = Math.tan(horizontalFovRad / 2) * distance;
  const halfHeight = halfWidth / viewportAspectRatio;
  return {
    width: 2 * halfWidth * rect.width,
    height: 2 * halfHeight * rect.height,
    x: (rect.x + rect.width / 2 - 0.5) * 2 * halfWidth,
    y: (rect.y + rect.height / 2 - 0.5) * 2 * halfHeight,
  };
}

/** The same rectangle in CSS terms, measured from the top-left of the canvas. */
export function rearViewCssRect(): {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
} {
  return {
    leftPercent: REAR_VIEW_VIEWPORT.x * 100,
    topPercent: (1 - REAR_VIEW_VIEWPORT.y - REAR_VIEW_VIEWPORT.height) * 100,
    widthPercent: REAR_VIEW_VIEWPORT.width * 100,
    heightPercent: REAR_VIEW_VIEWPORT.height * 100,
  };
}

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
 * The windscreen aperture, as the two points its rake runs between.
 *
 * The A-pillars, the glass, the shade band and the wiper park all derive from
 * these four numbers, so the screen cannot end up with its glass and its frame
 * on slightly different planes.
 */
export const COCKPIT_SCREEN = Object.freeze({
  sillY: 1.155,
  sillZ: 0.99,
  headerY: 1.7,
  headerZ: 0.72,
  halfWidth: 0.93,
});

/** Distance from sill to header along the rake. */
export function cockpitScreenSpan(): number {
  return Math.hypot(
    COCKPIT_SCREEN.headerY - COCKPIT_SCREEN.sillY,
    COCKPIT_SCREEN.headerZ - COCKPIT_SCREEN.sillZ,
  );
}

/**
 * Rotation about X that lays a Babylon plane flat against the windscreen.
 *
 * A plane is authored in XY facing -Z; this turns that face into the screen's
 * inner surface, which on a raked screen points down and back at the driver.
 */
export function cockpitScreenTiltX(): number {
  return -Math.atan2(
    COCKPIT_SCREEN.sillZ - COCKPIT_SCREEN.headerZ,
    COCKPIT_SCREEN.headerY - COCKPIT_SCREEN.sillY,
  );
}

/** Outer face of each A-pillar, and how thick the slab is. */
export const COCKPIT_PILLAR_X = 1.08;
export const COCKPIT_PILLAR_THICKNESS = 0.065;

/**
 * The A-pillar, as a slab lying along the screen's edge.
 *
 * Built by walking the rake line and stepping sideways off it, so the pillar's
 * inner face is the glass line by construction. It does not lean inward as it
 * rises — a prism swept along X is a constant-X slab and cannot — which is a
 * liberty the rest of the low-poly bodywork already takes.
 */
export const COCKPIT_PILLAR_PROFILE: readonly CockpitProfilePoint[] =
  Object.freeze([
    { y: 1.146, z: 0.972 },
    { y: 1.691, z: 0.702 },
    { y: 1.74, z: 0.801 },
    { y: 1.195, z: 1.071 },
  ]);

/**
 * The header rail and the strip of headliner behind it.
 *
 * Deliberately high: the lip lands about 4% down the frame on a phone in
 * landscape, so it crops the sky the way a real cabin does without taking any
 * of the road. It sits behind the rear-view mirror's viewport, which is drawn
 * by a later camera and paints straight over it — the same relationship a real
 * mirror has with the headliner it hangs off.
 */
export const COCKPIT_ROOF_PROFILE: readonly CockpitProfilePoint[] = Object.freeze([
  { y: 1.672, z: 0.695 },
  { y: 1.745, z: 0.715 },
  { y: 1.762, z: 0.2 },
  { y: 1.688, z: 0.2 },
]);

/** The inner door panel, swept thin down each flank. */
export const COCKPIT_DOOR_PROFILE: readonly CockpitProfilePoint[] = Object.freeze([
  { y: 0.5, z: -0.55 },
  { y: 0.5, z: 0.78 },
  { y: 1.02, z: 0.88 },
  { y: 1.06, z: -0.6 },
]);

export const COCKPIT_DOOR_X = 0.958;

/**
 * The driver's wing mirror, in cockpit space.
 *
 * Driver's side only. The passenger mirror sits about 50 degrees off the
 * driver's axis, which is outside the frame at every field of view the game
 * allows — a real cabin gets away with two because your own vision spans 180
 * degrees and a 72-degree screen does not. Cheating it inboard far enough to be
 * seen would float it over the middle of the dashboard.
 */
export const COCKPIT_WING_MIRROR = Object.freeze({
  /** Lateral offset from the centreline, signed outward by the driver's side. */
  lateral: 1.22,
  // Just clear of the dashboard's outboard corner, which sits closer to the eye
  // and therefore spreads wider across the frame than its width suggests.
  y: 1.224,
  z: 0.78,
  glassWidth: 0.2,
  glassHeight: 0.105,
  /** How far the bezel stands proud of the glass, as a fraction of each axis. */
  bezelMargin: 0.2,
  /**
   * The mount. A door mirror this high has nothing under it to sit on — the
   * door card tops out at 1.06 and the A-pillar has already risen away by this
   * z — so without a sail panel and a visible arm it reads as floating beside
   * the car rather than bolted to it.
   */
  sailX: 0.99,
  sailThickness: 0.075,
  /**
   * The arm is measured in the mirror head's own space, not the cabin's.
   *
   * The head is yawed about 29 degrees to face the seat, which swings the
   * glass's inboard edge forward in z — straight through where a cabin-aligned
   * arm at the same height would run. Hung off the head instead, the arm
   * emerges from behind the housing by construction, and because the yaw is
   * what points it inboard-and-forward it lands on the sail on its own.
   */
  armLength: 0.26,
  armLocalY: -0.015,
  armLocalZ: 0.028,
  armHeight: 0.048,
  armDepth: 0.058,
  /** How far the mirror camera swings outboard of straight back. */
  splayRad: 0.42,
});

/** Which way the driver's side lies: -x for left-hand drive. */
export function wingMirrorSide(steeringSide: SteeringSide): number {
  return steeringSide === "left" ? -1 : 1;
}

/**
 * The sail panel — the triangular filler at the front corner of the door
 * window that a real door mirror bolts to. Swept thin across `sailX`.
 */
export const WING_MIRROR_SAIL_PROFILE: readonly CockpitProfilePoint[] =
  Object.freeze([
    { y: 1.005, z: 0.585 },
    { y: 1.03, z: 0.985 },
    { y: 1.235, z: 0.955 },
    { y: 1.175, z: 0.66 },
  ]);

export interface MirrorOutlinePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The wing mirror's outline, normalised to ±1 on both axes.
 *
 * A door mirror is not a rectangle, and built as one it read as a panel stuck
 * to the door rather than a moulded housing. Chamfered corners and a taller
 * outboard edge are what give it the cast shape a real one has. Kept as a
 * normalised outline so the glass and the bezel behind it are provably the same
 * shape at two different scales.
 *
 * Convex, and wound anticlockwise — `createChamferedPanel` fans it from the
 * centre and relies on both.
 */
export const WING_MIRROR_OUTLINE: readonly MirrorOutlinePoint[] = Object.freeze([
  { x: 1, y: 0.54 },
  { x: 0.7, y: 1 },
  { x: -0.62, y: 1 },
  { x: -1, y: 0.46 },
  { x: -1, y: -0.66 },
  { x: -0.68, y: -1 },
  { x: 0.72, y: -1 },
  { x: 1, y: -0.6 },
]);

/**
 * The outline as the driver sees it. Flipped for right-hand drive so the taller
 * edge stays outboard rather than turning to face the cabin.
 */
export function wingMirrorOutline(
  steeringSide: SteeringSide,
): MirrorOutlinePoint[] {
  const side = wingMirrorSide(steeringSide);
  const points = WING_MIRROR_OUTLINE.map((point) => ({
    x: point.x * side,
    y: point.y,
  }));
  // Negating x reverses the winding, and the fan depends on it.
  return side < 0 ? points : points.reverse();
}

/**
 * Euler angles that turn the mirror head to face the driver's eye.
 *
 * Derived rather than authored, so the head keeps pointing at the seat if the
 * mirror is ever moved. Babylon composes rotations in YXZ and a plane is
 * authored facing -Z, so this solves for the pair that puts -Z along the line
 * from the mirror to the eye.
 */
export function wingMirrorHeadRotation(steeringSide: SteeringSide): {
  readonly x: number;
  readonly y: number;
} {
  const side = wingMirrorSide(steeringSide);
  const toEyeX = side * 0.46 - side * COCKPIT_WING_MIRROR.lateral;
  const toEyeY = COCKPIT_EYE_Y - COCKPIT_WING_MIRROR.y;
  const toEyeZ = COCKPIT_EYE_Z - COCKPIT_WING_MIRROR.z;
  const length = Math.hypot(toEyeX, toEyeY, toEyeZ);
  // The mesh's +Z has to end up opposite the eye for its -Z face to meet it.
  const forwardX = -toEyeX / length;
  const forwardY = -toEyeY / length;
  const forwardZ = -toEyeZ / length;
  return {
    x: Math.asin(clamp(-forwardY, -1, 1)),
    y: Math.atan2(forwardX, forwardZ),
  };
}

/**
 * Where the wing mirror appears across the frame, 0 at the left edge.
 *
 * It is a real object out beside the door, so at a narrow field of view it
 * slides off the side of the screen entirely. Rendering a mirror nobody can see
 * is pure waste, and the render target is the expensive part — so this is what
 * decides whether the whole thing is built into the frame at all.
 */
export function wingMirrorScreenFraction(
  horizontalFovRad: number,
  steeringSide: SteeringSide,
): number {
  const side = wingMirrorSide(steeringSide);
  const seat = side * 0.46;
  const lateral = side * COCKPIT_WING_MIRROR.lateral - seat;
  const forward = COCKPIT_WING_MIRROR.z - COCKPIT_EYE_Z;
  const offset =
    (0.5 * Math.tan(Math.atan2(Math.abs(lateral), forward))) /
    Math.tan(horizontalFovRad / 2);
  return side < 0 ? 0.5 - offset : 0.5 + offset;
}

/**
 * Below this much clearance from the edge the mirror is more than half cut off,
 * and is skipped rather than drawn as a sliver.
 */
export const WING_MIRROR_MIN_EDGE_FRACTION = 0.025;

export function wingMirrorIsVisible(
  horizontalFovRad: number,
  steeringSide: SteeringSide,
): boolean {
  const fraction = wingMirrorScreenFraction(horizontalFovRad, steeringSide);
  return (
    fraction > WING_MIRROR_MIN_EDGE_FRACTION &&
    fraction < 1 - WING_MIRROR_MIN_EDGE_FRACTION
  );
}

/**
 * The wing mirror camera, in world space.
 *
 * Aimed back and outboard rather than straight back: the point of the thing is
 * the lane beside you, which a rear-view mirror cannot show. Built the same way
 * as `resolveCockpitCameraPoses` — world space, no reliance on Babylon parent
 * transforms — so it cannot drift from the car it is bolted to.
 */
export function resolveWingMirrorPose({
  x,
  z,
  vehicleHeading,
  steeringSide,
}: {
  readonly x: number;
  readonly z: number;
  readonly vehicleHeading: number;
  readonly steeringSide: SteeringSide;
}): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationX: number;
  readonly rotationY: number;
} {
  const side = wingMirrorSide(steeringSide);
  const forwardX = Math.sin(vehicleHeading);
  const forwardZ = Math.cos(vehicleHeading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const lateral = side * COCKPIT_WING_MIRROR.lateral;
  return {
    x: x + rightX * lateral + forwardX * COCKPIT_WING_MIRROR.z,
    // Cockpit space rides 0.12 above the road, as everything else here does.
    y: COCKPIT_WING_MIRROR.y + 0.12,
    z: z + rightZ * lateral + forwardZ * COCKPIT_WING_MIRROR.z,
    rotationX: 0.06,
    rotationY:
      vehicleHeading + Math.PI - side * COCKPIT_WING_MIRROR.splayRad,
  };
}

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
