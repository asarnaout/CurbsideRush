import { describe, expect, it } from "vitest";
import {
  AUDIT_CHASE_VEHICLE_PROFILES,
  resolveChaseCameraPose,
  resolveCockpitCameraPoses,
} from "../app/game/cameraPoses";
import { CAREER_VEHICLES } from "../app/game/career";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import {
  BIKE_CUTSCENE_BODY,
  buildPulloverScript,
  cutsceneBodyProfile,
  DEFAULT_CUTSCENE_BODY,
  MOTORBIKE_CUTSCENE_BODY,
  type CutsceneBodyProfile,
  type PulloverRoad,
} from "../app/game/cutsceneScript";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { MIRROR_RADIUS_M } from "../app/game/mirrorRenderList";
import { resolveStagedCameraFraming } from "../app/game/render/cutsceneDirector";
import {
  PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
  RUNTIME_TRAFFIC_APPROACH_MAX_M,
  RUNTIME_TRAFFIC_APPROACH_MIN_M,
  RUNTIME_TRAFFIC_EXCEPTION_RECYCLE_RADIUS_M,
  RUNTIME_TRAFFIC_RECYCLE_RADIUS_M,
} from "../app/game/simulation/trafficLocality";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import { resolveWingMirrorPose } from "../app/game/cockpitLayout";
import {
  VEHICLE_DIMENSIONS,
  type VehicleModel,
} from "../app/game/vehicleVisuals";
import {
  resolveCameraFarPlane,
  resolveMapVisualPalette,
} from "../app/game/visuals";

const horizontalDistance = (
  point: { readonly x: number; readonly z: number },
  origin: { readonly x: number; readonly z: number } = { x: 0, z: 0 },
): number => Math.hypot(point.x - origin.x, point.z - origin.z);

/** A centre can lie this far beyond maxZ while a corner of the largest
 * rendered vehicle still intersects the frustum. Use the full 3-D half
 * diagonal rather than just its road footprint, so this remains conservative
 * for the double-decker's roof as well as its bumpers. */
const maximumVehicleBoundingRadiusM = (): number =>
  Math.max(
    ...Object.values(VEHICLE_DIMENSIONS).map((dimensions) =>
      Math.hypot(dimensions.length, dimensions.width, dimensions.height) / 2,
    ),
  );

const bodyForCareerVehicle = (
  vehicle: (typeof CAREER_VEHICLES)[number],
): CutsceneBodyProfile => {
  if (vehicle.visualKind === "bicycle") return BIKE_CUTSCENE_BODY;
  if (vehicle.visualKind === "motorbike") return MOTORBIKE_CUTSCENE_BODY;
  return vehicle.model
    ? cutsceneBodyProfile(
        VEHICLE_DIMENSIONS[vehicle.model].length,
        VEHICLE_DIMENSIONS[vehicle.model].width,
      )
    : DEFAULT_CUTSCENE_BODY;
};

describe("traffic presentation envelope", () => {
  it("covers every steady free-drive camera, quick-look direction and complete vehicle bound", () => {
    const origin = { x: 0, z: 0, heading: 0 };
    const playerModels = new Set<VehicleModel | undefined>([
      undefined,
      ...AUDIT_CHASE_VEHICLE_PROFILES.map((profile) => profile.model),
      ...CAREER_VEHICLES.map((vehicle) => vehicle.model ?? undefined),
    ]);
    let maximumMainCameraOffsetM = 0;
    for (const model of playerModels) {
      maximumMainCameraOffsetM = Math.max(
        maximumMainCameraOffsetM,
        horizontalDistance(resolveChaseCameraPose(model, origin).eye),
      );
    }

    for (const seatSide of [-0.46, 0.46]) {
      for (const quickLookAngle of [-Math.PI, -1.18, 0, 1.18, Math.PI]) {
        for (const viewportAspectRatio of [16 / 9, 844 / 390]) {
          const poses = resolveCockpitCameraPoses({
            x: origin.x,
            z: origin.z,
            vehicleHeading: origin.heading,
            cameraHeading: origin.heading,
            seatSide,
            headBob: 0.015,
            quickLookAngle,
            viewportAspectRatio,
          });
          // Quick-look rotates the camera but never translates its eye. Both
          // the first-person and rear-view origins remain player-centred.
          maximumMainCameraOffsetM = Math.max(
            maximumMainCameraOffsetM,
            horizontalDistance(poses.first),
          );
        }
      }
    }

    const maximumFarPlaneM = Math.max(
      ...FREE_DRIVES.map((freeDrive) => {
        const mapPack = getMapPack(freeDrive.mapId);
        const palette = resolveMapVisualPalette(mapPack.id);
        expect(palette.night, `${mapPack.id} must remain in the proven night profile`).toBe(
          true,
        );
        return resolveCameraFarPlane(
          palette.night ?? false,
          mapPack.geometry.worldSize,
          palette.fogEndCapM,
        );
      }),
    );
    const completeVehicleRadiusM = maximumVehicleBoundingRadiusM();
    const worstVisibleVehicleCentreM =
      maximumMainCameraOffsetM + maximumFarPlaneM + completeVehicleRadiusM;

    expect(maximumMainCameraOffsetM).toBeCloseTo(11.6, 9);
    expect(maximumFarPlaneM).toBe(460);
    expect(completeVehicleRadiusM).toBeGreaterThan(3);
    expect(worstVisibleVehicleCentreM).toBeLessThan(
      PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
    );
  });

  it("covers both mirror cameras with their tighter production range", () => {
    let maximumMirrorOffsetM = 0;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const steeringSide of ["left", "right"] as const) {
        const cockpit = resolveCockpitCameraPoses({
          x: 0,
          z: 0,
          vehicleHeading: heading,
          cameraHeading: heading,
          seatSide: steeringSide === "left" ? -0.46 : 0.46,
          headBob: 0,
          quickLookAngle: Math.PI,
        });
        const wing = resolveWingMirrorPose({
          x: 0,
          z: 0,
          vehicleHeading: heading,
          steeringSide,
        });
        maximumMirrorOffsetM = Math.max(
          maximumMirrorOffsetM,
          horizontalDistance(cockpit.rear),
          horizontalDistance(wing),
        );
      }
    }
    const worstMirrorVisibleCentreM =
      maximumMirrorOffsetM + MIRROR_RADIUS_M + maximumVehicleBoundingRadiusM();
    expect(MIRROR_RADIUS_M).toBe(80);
    expect(worstMirrorVisibleCentreM).toBeLessThan(
      PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
    );
  });

  it("covers the worst shipping high-speed pullover staged shot", () => {
    const freeDriveTopSpeeds = FREE_DRIVES.map((freeDrive) => {
      const country = getCountryProfile(freeDrive.countryId);
      const mapPack = getMapPack(freeDrive.mapId);
      const config = buildSimulationCoreConfig({
        scenario: buildFreeDriveScenario(freeDrive),
        mapPack,
        trafficSide: country.trafficSide,
        speedUnit: country.speedUnit,
      });
      return config.maxForwardSpeedMps ?? 22;
    });
    const playerProfiles: readonly {
      readonly id: string;
      readonly model: VehicleModel | undefined;
      readonly speedMps: number;
      readonly body: CutsceneBodyProfile;
    }[] = [
      {
        id: "free-drive",
        model: "electric-fastback",
        speedMps: Math.max(...freeDriveTopSpeeds),
        body: DEFAULT_CUTSCENE_BODY,
      },
      ...CAREER_VEHICLES.map((vehicle) => ({
        id: vehicle.id,
        model: vehicle.model ?? undefined,
        speedMps: vehicle.physics.maxForwardSpeedMps,
        body: bodyForCareerVehicle(vehicle),
      })),
    ];
    const widestRoadM = Math.max(
      ...FREE_DRIVES.flatMap((freeDrive) =>
        (getMapPack(freeDrive.mapId).geometry.roadSurfaces ?? []).map(
          (surface) => surface.widthM,
        ),
      ),
    );
    const widestShippingRoad: PulloverRoad = {
      centerline: [
        { x: 0, z: -1_000 },
        { x: 0, z: 1_000 },
      ],
      halfWidthM: widestRoadM / 2,
    };
    const car = { x: 0, z: 0, heading: 0 };
    let maximumCameraToMovingPlayerOffsetM = 0;

    for (const profile of playerProfiles) {
      for (const steeringSide of ["left", "right"] as const) {
        for (const trafficSide of ["left", "right"] as const) {
          for (const road of [null, widestShippingRoad]) {
            const pullover = buildPulloverScript(
              car,
              profile.speedMps,
              steeringSide,
              trafficSide,
              road,
              profile.body,
            );
            const framing = resolveStagedCameraFraming(
              pullover.parked,
              pullover.patrol,
              true,
            );
            // chooseStagedShot always returns a point exactly `radius` from
            // this midpoint. Taking midpoint distance + radius bounds every
            // blocker-selected azimuth without duplicating its ranking logic.
            const stagedAgainstStart =
              Math.hypot(framing.midX - car.x, framing.midZ - car.z) +
              framing.radius;
            const stagedAgainstParked =
              Math.hypot(
                framing.midX - pullover.parked.x,
                framing.midZ - pullover.parked.z,
              ) + framing.radius;
            const chaseEye = resolveChaseCameraPose(profile.model, car).eye;
            const chaseAgainstStart = horizontalDistance(chaseEye, car);
            const chaseAgainstParked = horizontalDistance(
              chaseEye,
              pullover.parked,
            );
            // The live cutscene interpolates camera and player between these
            // endpoint sets. Distance between their convex hulls is bounded by
            // the largest endpoint pairing, including a slower camera glide
            // against a faster car settle (or vice versa).
            maximumCameraToMovingPlayerOffsetM = Math.max(
              maximumCameraToMovingPlayerOffsetM,
              stagedAgainstStart,
              stagedAgainstParked,
              chaseAgainstStart,
              chaseAgainstParked,
            );
          }
        }
      }
    }

    const maximumFarPlaneM = Math.max(
      ...FREE_DRIVES.map((freeDrive) => {
        const mapPack = getMapPack(freeDrive.mapId);
        const palette = resolveMapVisualPalette(mapPack.id);
        return resolveCameraFarPlane(
          palette.night ?? false,
          mapPack.geometry.worldSize,
          palette.fogEndCapM,
        );
      }),
    );
    expect(Math.max(...freeDriveTopSpeeds)).toBeLessThanOrEqual(
      Math.max(...CAREER_VEHICLES.map((vehicle) => vehicle.physics.maxForwardSpeedMps)),
    );
    // Non-vacuous: this is materially wider than the 11.6 m steady chase
    // offset and specifically exercises the high-speed moving pullover case.
    expect(maximumCameraToMovingPlayerOffsetM).toBeGreaterThan(50);
    expect(
      maximumCameraToMovingPlayerOffsetM +
        maximumFarPlaneM +
        maximumVehicleBoundingRadiusM(),
    ).toBeLessThan(PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M);
  });

  it("keeps lifecycle boundaries outside the proven presentation radius", () => {
    expect(RUNTIME_TRAFFIC_APPROACH_MIN_M).toBeGreaterThan(
      PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
    );
    expect(RUNTIME_TRAFFIC_APPROACH_MAX_M).toBeGreaterThan(
      RUNTIME_TRAFFIC_APPROACH_MIN_M,
    );
    expect(RUNTIME_TRAFFIC_EXCEPTION_RECYCLE_RADIUS_M).toBe(
      PROVEN_TRAFFIC_PRESENTATION_ENVELOPE_RADIUS_M,
    );
    expect(RUNTIME_TRAFFIC_RECYCLE_RADIUS_M).toBeGreaterThan(
      RUNTIME_TRAFFIC_APPROACH_MAX_M,
    );
  });
});
