import { describe, expect, it } from "vitest";
import { careerDayTrafficSeed } from "../app/game/career";
import { FREE_DRIVES } from "../app/game/content";
import {
  buildCareerDayScenario,
  buildFreeDriveScenario,
} from "../app/game/driveScenario";
import type { DriveScenario } from "../app/game/sessionContract";

describe("buildFreeDriveScenario", () => {
  it("produces the exact live scenario contract for every city", () => {
    expect(FREE_DRIVES.length).toBeGreaterThan(0);
    for (const freeDrive of FREE_DRIVES) {
      const expected: DriveScenario = {
        id: freeDrive.id,
        startSpawnId: freeDrive.startSpawnId,
        trafficSeed: freeDrive.trafficSeed,
        trafficDensity: "moderate",
        vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
        scenarioClock: freeDrive.scenarioClock,
      };
      expect(buildFreeDriveScenario(freeDrive), freeDrive.id).toEqual(expected);
    }
  });
});

describe("buildCareerDayScenario", () => {
  it("gives each day its own deterministic identity and traffic seed", () => {
    const drive = FREE_DRIVES[0];
    const seedDay3 = careerDayTrafficSeed(424242, 3);
    const day3 = buildCareerDayScenario(drive, 3, seedDay3);
    expect(day3.id).toBe(`career-${drive.id}-d3`);
    expect(day3.trafficSeed).toBe(seedDay3);
    expect(buildCareerDayScenario(drive, 3, seedDay3)).toEqual(day3);

    const day4 = buildCareerDayScenario(
      drive,
      4,
      careerDayTrafficSeed(424242, 4),
    );
    expect(day4.id).not.toBe(day3.id);
    expect(day4.trafficSeed).not.toBe(day3.trafficSeed);

    const base = buildFreeDriveScenario(drive);
    expect(day3.startSpawnId).toBe(base.startSpawnId);
    expect(day3.trafficDensity).toBe(base.trafficDensity);
    expect(day3.vulnerableRoadUsers).toEqual(base.vulnerableRoadUsers);
    expect(day3.scenarioClock).toEqual(base.scenarioClock);
  });
});
