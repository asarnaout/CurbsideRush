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
import type { StagedBlocker } from "./cutsceneScript";
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

export const CHASE_CAMERA_MIN_DISTANCE_M = 7;
export const CHASE_CAMERA_MAX_DISTANCE_M = 24;
export const CHASE_CAMERA_MIN_ELEVATION_RAD = (12 * Math.PI) / 180;
export const CHASE_CAMERA_MAX_ELEVATION_RAD = (55 * Math.PI) / 180;

export interface ChaseCameraOrbit {
  /** Horizontal orbit relative to the vehicle's heading. */
  readonly yawOffsetRad?: number;
  /** Added to the vehicle tuning's authored eye elevation. */
  readonly elevationOffsetRad?: number;
  /** Horizontal distance from the vehicle, not optical/FOV zoom. */
  readonly distanceM?: number;
}

/** Keeps the authored road-ahead composition behind the car, then blends the
 * focal point back onto the vehicle as an orbit reaches either side. */
export function chaseLookAheadScale(yawOffsetRad: number): number {
  return Math.max(0, Math.cos(yawOffsetRad));
}

/** A full side glance. Values above `QUICK_LOOK_BEHIND_THRESHOLD` are the
 * existing discrete rear-view selector rather than a larger analogue axis. */
export const QUICK_LOOK_SIDE_ANGLE_RAD = 1.18;
export const QUICK_LOOK_BEHIND_THRESHOLD = 1.5;

/** Turns the shared keyboard/touch/gamepad/mouse selector into camera yaw. */
export function quickLookAngleForInput(input: number): number {
  return Math.abs(input) > QUICK_LOOK_BEHIND_THRESHOLD
    ? Math.PI
    : input * QUICK_LOOK_SIDE_ANGLE_RAD;
}

/**
 * Presentation-only ease for entering and releasing a glance. Simulation uses
 * the raw deterministic selector; this function is only for what the rendered
 * camera does between fixed ticks.
 */
export function smoothQuickLookAngle(
  current: number,
  target: number,
  deltaSeconds: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || deltaSeconds <= 0) return target;
  const next = current + (target - current) * (1 - Math.exp(-14 * deltaSeconds));
  return Math.abs(next - target) < 1e-4 ? target : next;
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
  orbit: ChaseCameraOrbit = {},
): ChaseCameraPose {
  const chase = (vehicleModel && CHASE_TUNING_BY_MODEL[vehicleModel]) || DEFAULT_CHASE_TUNING;
  const vehicleForwardX = Math.sin(pose.heading);
  const vehicleForwardZ = Math.cos(pose.heading);
  const yawOffset = orbit.yawOffsetRad ?? 0;
  const cameraHeading = pose.heading + yawOffset;
  const orbitForwardX = Math.sin(cameraHeading);
  const orbitForwardZ = Math.cos(cameraHeading);
  const distanceM = Math.min(
    CHASE_CAMERA_MAX_DISTANCE_M,
    Math.max(CHASE_CAMERA_MIN_DISTANCE_M, orbit.distanceM ?? chase.backM),
  );
  const authoredElevation = Math.atan2(chase.upM, chase.backM);
  const elevation = Math.min(
    CHASE_CAMERA_MAX_ELEVATION_RAD,
    Math.max(
      CHASE_CAMERA_MIN_ELEVATION_RAD,
      authoredElevation + (orbit.elevationOffsetRad ?? 0),
    ),
  );
  const baseY = 0.12;
  const targetAheadM =
    chase.targetAheadM * chaseLookAheadScale(yawOffset);
  return {
    target: {
      // The normal chase focuses down the road. At a side/rear orbit the
      // vehicle becomes the stable subject instead, so it cannot drift out of
      // frame merely because the player looked farther around.
      x: pose.x + vehicleForwardX * targetAheadM,
      y: baseY + 1.05,
      z: pose.z + vehicleForwardZ * targetAheadM,
    },
    eye: {
      x: pose.x - orbitForwardX * distanceM,
      y: baseY + Math.tan(elevation) * distanceM,
      z: pose.z - orbitForwardZ * distanceM,
    },
  };
}

// ---------------------------------------------------------------------------
// Chase camera obstruction
// ---------------------------------------------------------------------------

/** A small stand-off from the facade keeps the camera's near plane out of it. */
export const CHASE_CAMERA_BLOCKER_CLEARANCE_M = 0.45;
const CHASE_CAMERA_MIN_LINE_FRACTION = 0.08;

export interface PreparedChaseCameraBlocker {
  readonly blocker: StagedBlocker;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Precomputes the only broad-phase data camera collision needs. The authored
 * solids never move, so deriving convex bounds in the render loop would be
 * pure waste while somebody holds mouse-look.
 */
export function prepareChaseCameraBlockers(
  blockers: readonly StagedBlocker[],
): readonly PreparedChaseCameraBlocker[] {
  return blockers.map((blocker) => {
    if ("points" in blocker) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const point of blocker.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
      return { blocker, minX, maxX, minZ, maxZ };
    }
    const extentX =
      Math.abs(blocker.ux) * blocker.halfU +
      Math.abs(blocker.uz) * blocker.halfV;
    const extentZ =
      Math.abs(blocker.uz) * blocker.halfU +
      Math.abs(blocker.ux) * blocker.halfV;
    return {
      blocker,
      minX: blocker.x - extentX,
      maxX: blocker.x + extentX,
      minZ: blocker.z - extentZ,
      maxZ: blocker.z + extentZ,
    };
  });
}

/** Segment entry into an axis-aligned rectangle, or null on a miss. */
function segmentRectEntryFraction(
  startU: number,
  startV: number,
  deltaU: number,
  deltaV: number,
  halfU: number,
  halfV: number,
): number | null {
  let enter = 0;
  let exit = 1;
  const clipAxis = (start: number, delta: number, half: number): boolean => {
    if (Math.abs(delta) < 1e-9) return Math.abs(start) <= half;
    let near = (-half - start) / delta;
    let far = (half - start) / delta;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    return enter <= exit;
  };
  return clipAxis(startU, deltaU, halfU) &&
    clipAxis(startV, deltaV, halfV) &&
    exit >= 0 &&
    enter <= 1
    ? Math.max(0, enter)
    : null;
}

function pointInPolygon(
  x: number,
  z: number,
  points: readonly { readonly x: number; readonly z: number }[],
): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    if (
      a.z > z !== b.z > z &&
      x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** First exact edge crossing into a convex landmark footprint. */
function segmentPolygonEntryFraction(
  startX: number,
  startZ: number,
  deltaX: number,
  deltaZ: number,
  points: readonly { readonly x: number; readonly z: number }[],
): number | null {
  if (pointInPolygon(startX, startZ, points)) return 0;
  let entry = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const edgeX = b.x - a.x;
    const edgeZ = b.z - a.z;
    const denominator = deltaX * edgeZ - deltaZ * edgeX;
    if (Math.abs(denominator) < 1e-9) continue;
    const offsetX = a.x - startX;
    const offsetZ = a.z - startZ;
    const segmentT = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
    const edgeT = (offsetX * deltaZ - offsetZ * deltaX) / denominator;
    if (
      segmentT >= 0 &&
      segmentT <= 1 &&
      edgeT >= 0 &&
      edgeT <= 1
    ) {
      entry = Math.min(entry, segmentT);
    }
  }
  return Number.isFinite(entry) ? entry : null;
}

function segmentBlockerEntryFraction(
  target: CameraPoint3,
  desiredEye: CameraPoint3,
  blocker: StagedBlocker,
): number | null {
  const deltaX = desiredEye.x - target.x;
  const deltaZ = desiredEye.z - target.z;
  if ("points" in blocker) {
    return segmentPolygonEntryFraction(
      target.x,
      target.z,
      deltaX,
      deltaZ,
      blocker.points,
    );
  }
  const relativeX = target.x - blocker.x;
  const relativeZ = target.z - blocker.z;
  return segmentRectEntryFraction(
    relativeX * blocker.ux + relativeZ * blocker.uz,
    relativeX * blocker.uz - relativeZ * blocker.ux,
    deltaX * blocker.ux + deltaZ * blocker.uz,
    deltaX * blocker.uz - deltaZ * blocker.ux,
    blocker.halfU,
    blocker.halfV,
  );
}

/**
 * Fraction of the target-to-eye boom that is safe to use. A result below one
 * contracts the camera along its own sightline, which preserves framing and
 * height while keeping an orbiting chase camera in front of nearby facades.
 */
export function resolveChaseCameraSafeFraction(
  target: CameraPoint3,
  desiredEye: CameraPoint3,
  blockers: readonly PreparedChaseCameraBlocker[],
  clearanceM = CHASE_CAMERA_BLOCKER_CLEARANCE_M,
): number {
  const minX = Math.min(target.x, desiredEye.x);
  const maxX = Math.max(target.x, desiredEye.x);
  const minZ = Math.min(target.z, desiredEye.z);
  const maxZ = Math.max(target.z, desiredEye.z);
  let closestEntry = 1;
  for (const prepared of blockers) {
    if (
      prepared.maxX < minX ||
      prepared.minX > maxX ||
      prepared.maxZ < minZ ||
      prepared.minZ > maxZ
    ) {
      continue;
    }
    const entry = segmentBlockerEntryFraction(
      target,
      desiredEye,
      prepared.blocker,
    );
    // A target already inside an authored solid has no unobstructed side to
    // shorten toward. Ignoring that solid avoids collapsing the camera onto
    // the target while another nearby facade can still be handled normally.
    if (entry !== null && entry > 1e-6) closestEntry = Math.min(closestEntry, entry);
  }
  if (closestEntry >= 1) return 1;
  const horizontalLength = Math.hypot(
    desiredEye.x - target.x,
    desiredEye.z - target.z,
  );
  const clearanceFraction = clearanceM / Math.max(horizontalLength, 1e-6);
  return Math.max(
    CHASE_CAMERA_MIN_LINE_FRACTION,
    closestEntry - clearanceFraction,
  );
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
