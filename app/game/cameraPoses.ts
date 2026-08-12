/**
 * The pure chase/cockpit camera-pose math shared by production and the
 * visual-gap audit — plan `.claude/three-city-visual-gap-elimination-plan.md`
 * Section 7.6 item 6. Not under `geometry/` (matching `adaptiveInputRouter.ts`,
 * which already owns the cockpit half of this): both are pure per-frame
 * camera math rather than authored-geometry derivation, but neither is
 * Babylon/DOM-touching, so both stay flat under `app/game/`.
 *
 * `resolveChaseCameraPose` reproduces `BabylonGameSession`'s
 * `snapChaseCameraToPose` — the steady-state resting pose, deliberately
 * without the per-frame lerp smoothing or speed-driven shake term
 * `updateCamera` applies: the audit samples a static scene (Section 6's
 * canonical manifest pins simulation tick 0), so the resting pose is the
 * correct and only deterministic target. `resolveCockpitCameraPoses` and
 * `resolveCockpitPitch` are re-exported from their existing homes
 * (`adaptiveInputRouter.ts`, `cockpitLayout.ts`) rather than duplicated —
 * they were already pure and already the production source of truth.
 */

import {
  resolveCockpitCameraPoses,
  type CockpitCameraPoses,
} from "./adaptiveInputRouter";
import { resolveCockpitPitch } from "./cockpitLayout";
import type { VehicleModel } from "./vehicleVisuals";

export { resolveCockpitCameraPoses, resolveCockpitPitch };
export type { CockpitCameraPoses };

// ---------------------------------------------------------------------------
// Chase (third-person) camera
// ---------------------------------------------------------------------------

/** Verbatim copy of `babylonGameSession.ts`'s private `ChaseTuning` table —
 * production imports this module's copy instead of keeping its own, so the
 * two can never drift (Section 7.6 item 6). */
export interface ChaseTuning {
  readonly backM: number;
  readonly upM: number;
  readonly targetAheadM: number;
}

export const DEFAULT_CHASE_TUNING: ChaseTuning = {
  backM: 10.5,
  upM: 5.5,
  targetAheadM: 3.5,
};

export const CHASE_TUNING_BY_MODEL: Partial<Record<VehicleModel, ChaseTuning>> = {
  "delivery-van": { backM: 11.6, upM: 6.2, targetAheadM: 3.5 },
  "sport-sedan": { backM: 9.8, upM: 5, targetAheadM: 3.8 },
};

export interface CameraPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChaseCameraPose {
  readonly eye: CameraPoint3;
  readonly target: CameraPoint3;
}

/**
 * The chase camera's steady-state world pose behind a car at `pose`.
 * `vehicleModel` selects the tuning the same way production does — an
 * unlisted model (including the default `electric-fastback`) falls back to
 * `DEFAULT_CHASE_TUNING`, matching `CHASE_TUNING_BY_MODEL[model] ||
 * DEFAULT_CHASE_TUNING`'s truthy-fallback semantics exactly.
 */
export function resolveChaseCameraPose(
  vehicleModel: VehicleModel | null | undefined,
  pose: { readonly x: number; readonly z: number; readonly heading: number },
): ChaseCameraPose {
  const chase = (vehicleModel && CHASE_TUNING_BY_MODEL[vehicleModel]) || DEFAULT_CHASE_TUNING;
  const forwardX = Math.sin(pose.heading);
  const forwardZ = Math.cos(pose.heading);
  const baseY = 0.12;
  return {
    target: {
      x: pose.x + forwardX * chase.targetAheadM,
      y: baseY + 1.05,
      z: pose.z + forwardZ * chase.targetAheadM,
    },
    eye: {
      x: pose.x - forwardX * chase.backM,
      y: baseY + chase.upM,
      z: pose.z - forwardZ * chase.backM,
    },
  };
}

/** The three distinct production chase tunings the audit must cover
 * (Section 4.3: "None is globally worst"). `model: undefined` audits the
 * default/fastback fallback path explicitly, not merely by omission. */
export interface ChaseVehicleProfile {
  readonly id: string;
  readonly model: VehicleModel | undefined;
}

export const AUDIT_CHASE_VEHICLE_PROFILES: readonly ChaseVehicleProfile[] = [
  { id: "fastback", model: "electric-fastback" },
  { id: "delivery-van", model: "delivery-van" },
  { id: "sport-sedan", model: "sport-sedan" },
];

// ---------------------------------------------------------------------------
// First person
// ---------------------------------------------------------------------------

/** Production's own seat-offset-by-steering-side table
 * (`babylonGameSession.ts`'s `updateCamera`), restated so the audit does not
 * need a whole session to compute a seat side. */
export const COCKPIT_SEAT_SIDE_BY_STEERING: Readonly<Record<"left" | "right", number>> = {
  left: -0.46,
  right: 0.46,
};

/**
 * Forward unit vector for a yaw/pitch pair, in this codebase's convention
 * (`(sin h, 0, cos h)` at zero pitch — 0 = +z). Babylon's `.rotation` Euler
 * vector on a `UniversalCamera` composes as yaw-then-pitch
 * (`Quaternion.RotationYawPitchRoll(y, x, z)`), so a positive pitch (the
 * cockpit's small downward tilt from `resolveCockpitPitch`) tips the forward
 * vector's Y component negative — looking down at the tarmac. Verified
 * against a real `UniversalCamera` under `NullEngine` in
 * `tests/cameraPoses.test.ts`.
 */
export function forwardVectorFromYawPitch(
  yawRad: number,
  pitchRad: number,
): CameraPoint3 {
  const cosPitch = Math.cos(pitchRad);
  return {
    x: Math.sin(yawRad) * cosPitch,
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * cosPitch,
  };
}

// ---------------------------------------------------------------------------
// Field of view
// ---------------------------------------------------------------------------

/**
 * Vertical FOV (radians) for a horizontal FOV under `FOVMODE_HORIZONTAL_FIXED`
 * (every production camera's mode) at a given viewport aspect ratio
 * (width/height). Same formula `cockpitCowlScreenFraction` already uses for
 * the cowl-crop budget (`cockpitLayout.ts`), restated here as the audit's own
 * frustum-height derivation so both consume one formula.
 */
export function verticalFovForHorizontal(
  horizontalFovRad: number,
  viewportAspectRatio: number,
): number {
  return 2 * Math.atan(Math.tan(horizontalFovRad / 2) / viewportAspectRatio);
}

export interface ViewportProfile {
  readonly id: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** The two pinned viewport profiles (Section 7.6 item 7): desktop 16:9 and
 * landscape touch. Horizontal FOV stays 72/100 degrees in both; only the
 * derived vertical FOV/cockpit pitch changes with aspect. */
export const AUDIT_VIEWPORT_PROFILES: readonly ViewportProfile[] = [
  { id: "desktop-1920x1080", widthPx: 1920, heightPx: 1080 },
  { id: "touch-844x390", widthPx: 844, heightPx: 390 },
];

export function viewportAspectRatio(profile: ViewportProfile): number {
  return profile.widthPx / profile.heightPx;
}
