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
    y: 1.16,
    z: 0.22,
    mountRotationX: Math.PI / 2 + 0.2,
    wheelDiameter: 0.32,
    rimThickness: 0.027,
  };
}
