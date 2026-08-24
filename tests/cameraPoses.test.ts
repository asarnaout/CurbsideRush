import { describe, expect, it } from "vitest";
import { NullEngine, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import {
  AUDIT_CHASE_VEHICLE_PROFILES,
  AUDIT_VIEWPORT_PROFILES,
  CHASE_CAMERA_MAX_DISTANCE_M,
  CHASE_CAMERA_MAX_ELEVATION_RAD,
  CHASE_CAMERA_MIN_DISTANCE_M,
  CHASE_TUNING_BY_MODEL,
  COCKPIT_SEAT_SIDE_BY_STEERING,
  DEFAULT_CHASE_TUNING,
  forwardVectorFromYawPitch,
  prepareChaseCameraBlockers,
  quickLookAngleForInput,
  resolveChaseCameraPose,
  resolveChaseCameraSafeFraction,
  smoothQuickLookAngle,
  verticalFovForHorizontal,
  viewportAspectRatio,
  type ChaseTuning,
} from "../app/game/cameraPoses";
import type { VehicleModel } from "../app/game/vehicleVisuals";

const toRad = (deg: number) => (deg * Math.PI) / 180;

describe("resolveChaseCameraPose", () => {
  const pose = { x: 100, z: 200, heading: 0 };
  // heading 0 -> forward is +z in this codebase's convention, so the eye
  // sits behind (smaller z) and the target ahead (larger z) of the pose.
  const expectGeometry = (
    result: ReturnType<typeof resolveChaseCameraPose>,
    tuning: ChaseTuning,
  ) => {
    expect(result.eye.x).toBeCloseTo(pose.x);
    expect(result.eye.y).toBeCloseTo(0.12 + tuning.upM);
    expect(result.eye.z).toBeCloseTo(pose.z - tuning.backM);
    expect(result.target.x).toBeCloseTo(pose.x);
    expect(result.target.y).toBeCloseTo(0.12 + 1.05);
    expect(result.target.z).toBeCloseTo(pose.z + tuning.targetAheadM);
  };

  it.each([null, undefined, "electric-fastback", "compact-hatch"] as const)(
    "falls back to DEFAULT_CHASE_TUNING for %s (unlisted or absent model)",
    (model) => {
      expectGeometry(resolveChaseCameraPose(model, pose), DEFAULT_CHASE_TUNING);
    },
  );

  it.each(Object.entries(CHASE_TUNING_BY_MODEL) as [VehicleModel, ChaseTuning][])(
    "uses %s's own tuning when listed in CHASE_TUNING_BY_MODEL",
    (model, tuning) => {
      expectGeometry(resolveChaseCameraPose(model, pose), tuning);
    },
  );

  it("resolves every AUDIT_CHASE_VEHICLE_PROFILES entry to its production tuning", () => {
    for (const profile of AUDIT_CHASE_VEHICLE_PROFILES) {
      const expectedTuning =
        (profile.model && CHASE_TUNING_BY_MODEL[profile.model]) || DEFAULT_CHASE_TUNING;
      expectGeometry(resolveChaseCameraPose(profile.model, pose), expectedTuning);
    }
  });

  it("places eye behind and target ahead along an arbitrary heading, not just heading 0", () => {
    // heading = +90deg (clockwise) -> forward is +x.
    const result = resolveChaseCameraPose(undefined, { x: 0, z: 0, heading: Math.PI / 2 });
    expect(result.target.x).toBeCloseTo(DEFAULT_CHASE_TUNING.targetAheadM);
    expect(result.target.z).toBeCloseTo(0, 5);
    expect(result.eye.x).toBeCloseTo(-DEFAULT_CHASE_TUNING.backM);
    expect(result.eye.z).toBeCloseTo(0, 5);
  });

  it("orbits the eye while keeping its focus ahead of the car", () => {
    const result = resolveChaseCameraPose(
      undefined,
      { x: 0, z: 0, heading: 0 },
      { yawOffsetRad: Math.PI / 2 },
    );
    expect(result.eye.x).toBeCloseTo(-DEFAULT_CHASE_TUNING.backM);
    expect(result.eye.z).toBeCloseTo(0, 5);
    expect(result.target.x).toBeCloseTo(0, 5);
    expect(result.target.z).toBeCloseTo(0, 5);
  });

  it("dollies along the authored elevation and clamps supported distances", () => {
    const authoredElevation = Math.atan2(
      DEFAULT_CHASE_TUNING.upM,
      DEFAULT_CHASE_TUNING.backM,
    );
    const near = resolveChaseCameraPose(
      undefined,
      { x: 0, z: 0, heading: 0 },
      { distanceM: -100 },
    );
    const far = resolveChaseCameraPose(
      undefined,
      { x: 0, z: 0, heading: 0 },
      { distanceM: 100 },
    );

    expect(near.eye.z).toBeCloseTo(-CHASE_CAMERA_MIN_DISTANCE_M);
    expect(far.eye.z).toBeCloseTo(-CHASE_CAMERA_MAX_DISTANCE_M);
    expect(far.eye.y).toBeCloseTo(
      0.12 + Math.tan(authoredElevation) * CHASE_CAMERA_MAX_DISTANCE_M,
    );
  });

  it("raises the orbit camera without exceeding its safe elevation", () => {
    const result = resolveChaseCameraPose(
      undefined,
      { x: 0, z: 0, heading: 0 },
      { elevationOffsetRad: Math.PI },
    );
    expect(result.eye.y).toBeCloseTo(
      0.12 +
        Math.tan(CHASE_CAMERA_MAX_ELEVATION_RAD) *
          DEFAULT_CHASE_TUNING.backM,
    );
  });
});

describe("quick-look presentation", () => {
  it("maps analogue sides and the discrete rear selector", () => {
    expect(quickLookAngleForInput(-1)).toBeCloseTo(-1.18);
    expect(quickLookAngleForInput(1)).toBeCloseTo(1.18);
    expect(quickLookAngleForInput(2)).toBeCloseTo(Math.PI);
  });

  it("eases normally and snaps when reduced motion is requested", () => {
    const eased = smoothQuickLookAngle(0, 1.18, 1 / 60, false);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(1.18);
    expect(smoothQuickLookAngle(eased, 0, 1 / 60, false)).toBeLessThan(eased);
    expect(smoothQuickLookAngle(0, 1.18, 1 / 60, true)).toBe(1.18);
  });
});

describe("chase camera obstruction", () => {
  const target = { x: 0, y: 1.2, z: 0 };
  const desiredEye = { x: 0, y: 5.6, z: -14 };

  it("leaves an unobstructed boom at full length", () => {
    const blockers = prepareChaseCameraBlockers([
      { x: 20, z: -7, ux: 1, uz: 0, halfU: 2, halfV: 2 },
    ]);
    expect(resolveChaseCameraSafeFraction(target, desiredEye, blockers)).toBe(1);
  });

  it("shortens before an oriented building with facade clearance", () => {
    const blockers = prepareChaseCameraBlockers([
      { x: 0, z: -8, ux: 1, uz: 0, halfU: 2, halfV: 1 },
    ]);
    const fraction = resolveChaseCameraSafeFraction(target, desiredEye, blockers);
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.5);
    expect(desiredEye.z * fraction).toBeGreaterThan(-7);
  });

  it("also shortens against a convex landmark footprint", () => {
    const blockers = prepareChaseCameraBlockers([
      {
        points: [
          { x: -2, z: -9 },
          { x: 2, z: -9 },
          { x: 2, z: -7 },
          { x: -2, z: -7 },
        ],
      },
    ]);
    expect(resolveChaseCameraSafeFraction(target, desiredEye, blockers)).toBeLessThan(0.5);
  });
});

describe("forwardVectorFromYawPitch", () => {
  // Verified against a real UniversalCamera under NullEngine, matching the
  // guarantee cameraPoses.ts's own doc comment makes for this function.
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("cameraPoses-oracle", Vector3.Zero(), scene);

  const realForward = (yawRad: number, pitchRad: number) => {
    camera.rotation.set(pitchRad, yawRad, 0);
    camera.getViewMatrix(true);
    const dir = camera.getDirection(Vector3.Forward());
    return { x: dir.x, y: dir.y, z: dir.z };
  };

  it.each([
    [0, 0],
    [Math.PI / 2, 0],
    [Math.PI, 0],
    [-Math.PI / 2, 0],
    [0, 0.1],
    [0, -0.1],
    [0.3, 0.12],
    [-1.2, 0.05],
    [2.4, -0.08],
  ])("matches a real UniversalCamera's forward direction at yaw=%p pitch=%p", (yaw, pitch) => {
    const real = realForward(yaw, pitch);
    const pure = forwardVectorFromYawPitch(yaw, pitch);
    expect(pure.x).toBeCloseTo(real.x, 5);
    expect(pure.y).toBeCloseTo(real.y, 5);
    expect(pure.z).toBeCloseTo(real.z, 5);
  });

  it("a positive (cockpit downward-tilt) pitch tips the forward vector's Y component negative", () => {
    expect(forwardVectorFromYawPitch(0, 0).y).toBeCloseTo(0);
    expect(forwardVectorFromYawPitch(0, 0.1).y).toBeLessThan(0);
    expect(forwardVectorFromYawPitch(0.5, 0.1).y).toBeLessThan(0);
  });

  it("returns a unit vector for any yaw/pitch", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1, 0.2],
      [-2, -0.3],
      [Math.PI, 0.05],
    ]) {
      const v = forwardVectorFromYawPitch(yaw, pitch);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    }
  });
});

describe("verticalFovForHorizontal", () => {
  it("returns the horizontal FOV unchanged at aspect ratio 1", () => {
    expect(verticalFovForHorizontal(1.2, 1)).toBeCloseTo(1.2);
  });

  it("derives 72deg horizontal at the pinned 1920x1080 desktop aspect to ~44.46deg vertical (pinned)", () => {
    expect(verticalFovForHorizontal(toRad(72), 1920 / 1080)).toBeCloseTo(0.775933629756607, 9);
  });

  it("derives 100deg horizontal at the pinned 844x390 touch aspect to ~57.68deg vertical (pinned)", () => {
    expect(verticalFovForHorizontal(toRad(100), 844 / 390)).toBeCloseTo(1.0067484162511946, 9);
  });

  it("narrows as the viewport widens, for both audit fan FOVs (72/100deg)", () => {
    for (const horizontalDeg of [72, 100]) {
      const horizontal = toRad(horizontalDeg);
      const wide = verticalFovForHorizontal(horizontal, 21 / 9);
      const square = verticalFovForHorizontal(horizontal, 1);
      const tall = verticalFovForHorizontal(horizontal, 9 / 21);
      expect(wide).toBeLessThan(square);
      expect(square).toBeLessThan(tall);
    }
  });
});

describe("viewportAspectRatio / AUDIT_VIEWPORT_PROFILES", () => {
  it("computes width/height for the pinned desktop and touch profiles", () => {
    const desktop = AUDIT_VIEWPORT_PROFILES.find((p) => p.id === "desktop-1920x1080")!;
    const touch = AUDIT_VIEWPORT_PROFILES.find((p) => p.id === "touch-844x390")!;
    expect(desktop).toBeTruthy();
    expect(touch).toBeTruthy();
    expect(viewportAspectRatio(desktop)).toBeCloseTo(1920 / 1080);
    expect(viewportAspectRatio(touch)).toBeCloseTo(844 / 390);
    // Desktop is landscape 16:9; touch is landscape but noticeably wider
    // per unit height (a phone rotated on its side) -- both > 1, not equal.
    expect(viewportAspectRatio(touch)).toBeGreaterThan(viewportAspectRatio(desktop));
  });
});

describe("COCKPIT_SEAT_SIDE_BY_STEERING", () => {
  it("mirrors left/right around the car's centreline", () => {
    expect(COCKPIT_SEAT_SIDE_BY_STEERING.left).toBeCloseTo(-COCKPIT_SEAT_SIDE_BY_STEERING.right);
    expect(COCKPIT_SEAT_SIDE_BY_STEERING.left).toBeLessThan(0);
    expect(COCKPIT_SEAT_SIDE_BY_STEERING.right).toBeGreaterThan(0);
  });
});
