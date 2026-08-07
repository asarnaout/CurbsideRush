import type { DriveScenario } from "./sessionContract";
import type { FreeDriveDefinition } from "./types";

/** Build the reproducible, non-terminating scenario for an open-world drive. */
export function buildFreeDriveScenario(
  freeDrive: FreeDriveDefinition,
): DriveScenario {
  return {
    id: freeDrive.id,
    startSpawnId: freeDrive.startSpawnId,
    trafficSeed: freeDrive.trafficSeed,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    scenarioClock: freeDrive.scenarioClock,
  };
}

/** Give a career day its own deterministic world identity and traffic seed. */
export function buildCareerDayScenario(
  freeDrive: FreeDriveDefinition,
  day: number,
  trafficSeed: number,
): DriveScenario {
  return {
    ...buildFreeDriveScenario(freeDrive),
    id: `career-${freeDrive.id}-d${day}`,
    trafficSeed,
  };
}
