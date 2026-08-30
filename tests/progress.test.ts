import { describe, expect, it } from "vitest";
import {
  clearCareer,
  consumeFuel,
  createDefaultProgress,
  credit,
  debit,
  isPlayerProgressV2,
  loadProgress,
  PROGRESS_STORAGE_KEY,
  resetProgress,
  saveProgress,
  setFuel,
  writeCareer,
} from "../app/game/progress";
import {
  activeCity,
  applySettlement,
  createCareerSlice,
  DEFAULT_GARAGE_VEHICLE_ID,
  emptyDayLog,
  settleDay,
} from "../app/game/career";
import {
  STARTING_WALLET_BY_COUNTRY,
  TANK_CAPACITY_L,
} from "../app/game/economyTables";
import type { PlayerProgressV2 } from "../app/game/types";
import type { ProgressStorage } from "../app/game/progress";

function memoryStorage(seed?: Record<string, string>): ProgressStorage {
  const values = new Map<string, string>(seed ? Object.entries(seed) : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const fullTank = {
  us: TANK_CAPACITY_L,
  uk: TANK_CAPACITY_L,
  jp: TANK_CAPACITY_L,
  eg: TANK_CAPACITY_L,
};

describe("player progress (current V2 schema)", () => {
  it("seeds only live economy, preference, and career fields", () => {
    const progress = createDefaultProgress();

    expect(progress).toEqual({
      version: 2,
      walletByCountry: STARTING_WALLET_BY_COUNTRY,
      fuelByCountry: fullTank,
      freeDriveStats: {
        deliveriesCompleted: 0,
        ridesharesCompleted: 0,
        trafficCitations: 0,
        distanceDrivenM: 0,
        earnedByCountry: { us: 0, uk: 0, jp: 0, eg: 0 },
        spentByCountry: { us: 0, uk: 0, jp: 0, eg: 0 },
      },
      lastDestinationId: "uk-london",
      preferredCamera: "third_person",
      accessibility: {
        visualHonkIndicator: true,
        reducedMotion: false,
        cameraShake: false,
        headBob: false,
        steeringSensitivity: 1,
        fieldOfView: 72,
        masterVolume: 0.8,
        effectsVolume: 0.8,
        musicVolume: 0.55,
        musicMuted: false,
      },
      career: null,
      lastCareerVehicleId: DEFAULT_GARAGE_VEHICLE_ID,
    });
    expect(progress).not.toHaveProperty("lifetimeEarnings");
    expect(progress).not.toHaveProperty("completedGigCount");
    expect(progress).not.toHaveProperty("lastCountryId");
    expect(progress).not.toHaveProperty("updatedAt");
    expect(progress.accessibility).not.toHaveProperty("subtitles");
    expect(isPlayerProgressV2(progress)).toBe(true);
  });

  it("recovers from corrupt JSON and removes only the broken current save", () => {
    const storage = memoryStorage({
      [PROGRESS_STORAGE_KEY]: "{bad json",
      "sideswap:v1": "retired-save",
    });

    const progress = loadProgress(storage);

    expect(progress).toEqual(createDefaultProgress());
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("sideswap:v1")).toBe("retired-save");
  });

  it("does not discover, migrate, or delete retired save keys", () => {
    const lessonSave = JSON.stringify({
      version: 1,
      completedLessonIds: ["orientation-right"],
      lastDestinationId: "jp-tokyo",
      preferredCamera: "first_person",
    });
    const storage = memoryStorage({
      "sideswap:v1": lessonSave,
      "sideswap:progress": lessonSave,
      "sideswap:v0": lessonSave,
    });

    expect(loadProgress(storage)).toEqual(createDefaultProgress());
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("sideswap:v1")).toBe(lessonSave);
    expect(storage.getItem("sideswap:progress")).toBe(lessonSave);
    expect(storage.getItem("sideswap:v0")).toBe(lessonSave);
  });

  it("replaces a non-current record under the current key with a clean default", () => {
    const storage = memoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        lastDestinationId: "jp-tokyo",
        preferredCamera: "first_person",
        completedLessonIds: ["orientation-right"],
      }),
    });

    const restored = loadProgress(storage);
    const rewritten = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY) ?? "{}");

    expect(restored).toEqual(createDefaultProgress());
    expect(rewritten).toEqual(createDefaultProgress());
    expect(rewritten).not.toHaveProperty("completedLessonIds");
  });

  it("repairs malformed current fields and strips retired or unknown fields", () => {
    const defaults = createDefaultProgress();
    const storage = memoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({
        ...defaults,
        walletByCountry: { us: 73, uk: -5, jp: "many", eg: Number.MAX_SAFE_INTEGER },
        fuelByCountry: { us: 12, uk: -1, jp: 999, eg: null },
        lastDestinationId: "tokyo",
        preferredCamera: "cockpit",
        accessibility: {
          ...defaults.accessibility,
          visualHonkIndicator: "yes",
          steeringSensitivity: 9,
          fieldOfView: null,
          masterVolume: -1,
          effectsVolume: 2,
          musicVolume: "loud",
          musicMuted: "no",
          subtitles: true,
        },
        career: undefined,
        lastCareerVehicleId: "hovercraft",
        lifetimeEarnings: { us: 100, uk: 200, jp: 300, eg: 400 },
        completedGigCount: 17,
        lastCountryId: "jp",
        updatedAt: "2026-07-10T12:00:00.000Z",
        completedLessonIds: ["orientation-right"],
      }),
    });

    const restored = loadProgress(storage);
    const rewritten = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY) ?? "{}");

    expect(restored.walletByCountry).toEqual({
      us: 73,
      uk: 0,
      jp: STARTING_WALLET_BY_COUNTRY.jp,
      eg: Number.MAX_SAFE_INTEGER,
    });
    expect(restored.fuelByCountry).toEqual({
      us: 12,
      uk: 0,
      jp: TANK_CAPACITY_L,
      eg: TANK_CAPACITY_L,
    });
    expect(restored.lastDestinationId).toBe("uk-london");
    expect(restored.preferredCamera).toBe("third_person");
    expect(restored.accessibility).toEqual({
      ...defaults.accessibility,
      steeringSensitivity: 2,
      masterVolume: 0,
      effectsVolume: 1,
    });
    expect(restored.career).toBeNull();
    expect(restored.lastCareerVehicleId).toBe(DEFAULT_GARAGE_VEHICLE_ID);
    expect(isPlayerProgressV2(restored)).toBe(true);
    for (const retiredField of [
      "lifetimeEarnings",
      "completedGigCount",
      "lastCountryId",
      "updatedAt",
      "completedLessonIds",
    ]) {
      expect(rewritten).not.toHaveProperty(retiredField);
    }
    expect(rewritten.accessibility).not.toHaveProperty("subtitles");
  });

  it("rejects malformed values instead of treating legacy aliases as current", () => {
    const progress = createDefaultProgress();

    expect(isPlayerProgressV2({ ...progress, lastDestinationId: "tokyo" })).toBe(false);
    expect(isPlayerProgressV2({ ...progress, preferredCamera: "cockpit" })).toBe(false);
    expect(
      isPlayerProgressV2({
        ...progress,
        accessibility: { ...progress.accessibility, masterVolume: 2 },
      }),
    ).toBe(false);
    expect(
      isPlayerProgressV2({
        ...progress,
        fuelByCountry: { ...progress.fuelByCountry, us: -1 },
      }),
    ).toBe(false);
  });

  it("round-trips every live non-career field", () => {
    const storage = memoryStorage();
    const progress: PlayerProgressV2 = {
      ...createDefaultProgress(),
      walletByCountry: { us: 100, uk: 55, jp: 5000, eg: 750 },
      fuelByCountry: { us: 10, uk: 20, jp: 40, eg: 15 },
      lastDestinationId: "jp-tokyo",
      preferredCamera: "first_person",
      accessibility: {
        ...createDefaultProgress().accessibility,
        reducedMotion: true,
        musicMuted: true,
      },
      lastCareerVehicleId: "delivery-van",
    };

    expect(saveProgress(progress, storage)).toBe(true);
    expect(loadProgress(storage)).toEqual(progress);
  });

  it("credits and debits wallets without mutating the source", () => {
    const original = createDefaultProgress();
    const credited = credit(original, "uk", 40);
    const ignoredCredit = credit(credited, "uk", -10);
    const emptied = debit(ignoredCredit, "uk", original.walletByCountry.uk + 1000);

    expect(credited.walletByCountry.uk).toBe(original.walletByCountry.uk + 40);
    expect(original.walletByCountry.uk).toBe(STARTING_WALLET_BY_COUNTRY.uk);
    expect(ignoredCredit.walletByCountry.uk).toBe(credited.walletByCountry.uk);
    expect(emptied.walletByCountry.uk).toBe(0);
    expect(emptied.walletByCountry.us).toBe(STARTING_WALLET_BY_COUNTRY.us);
  });

  it("consumes and refuels within tank bounds", () => {
    const original = createDefaultProgress();
    const empty = consumeFuel(original, "jp", 1000);
    const full = setFuel(empty, "jp", 1000);
    const clamped = setFuel(full, "jp", -5);

    expect(empty.fuelByCountry.jp).toBe(0);
    expect(original.fuelByCountry.jp).toBe(TANK_CAPACITY_L);
    expect(full.fuelByCountry.jp).toBe(TANK_CAPACITY_L);
    expect(clamped.fuelByCountry.jp).toBe(0);
  });

  it("reset removes the current save without touching retired keys", () => {
    const storage = memoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify(createDefaultProgress()),
      "sideswap:v1": "retired-save",
    });

    expect(resetProgress(storage)).toEqual(createDefaultProgress());
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("sideswap:v1")).toBe("retired-save");
  });
});

describe("career slice persistence", () => {
  const freshSlice = () =>
    createCareerSlice({
      destinationId: "us-nyc",
      careerSeed: 424242,
    });

  it("round-trips a career through save and load byte-identically", () => {
    const storage = memoryStorage();
    const slice = freshSlice();

    expect(saveProgress(writeCareer(createDefaultProgress(), slice), storage)).toBe(true);
    const restored = loadProgress(storage);

    expect(restored.career).toEqual(slice);
    expect(restored.walletByCountry).toEqual(STARTING_WALLET_BY_COUNTRY);
  });

  it("defaults an absent or invalid remembered garage vehicle", () => {
    const picked = {
      ...createDefaultProgress(),
      lastCareerVehicleId: "delivery-van" as const,
    };
    const pickedStorage = memoryStorage();
    saveProgress(picked, pickedStorage);
    expect(loadProgress(pickedStorage).lastCareerVehicleId).toBe("delivery-van");

    const withoutVehicle = createDefaultProgress() as unknown as Record<string, unknown>;
    delete withoutVehicle.lastCareerVehicleId;
    expect(
      loadProgress(
        memoryStorage({ [PROGRESS_STORAGE_KEY]: JSON.stringify(withoutVehicle) }),
      ).lastCareerVehicleId,
    ).toBe(DEFAULT_GARAGE_VEHICLE_ID);
    expect(
      loadProgress(
        memoryStorage({
          [PROGRESS_STORAGE_KEY]: JSON.stringify({
            ...withoutVehicle,
            lastCareerVehicleId: "hovercraft",
          }),
        }),
      ).lastCareerVehicleId,
    ).toBe(DEFAULT_GARAGE_VEHICLE_ID);
  });

  it("surfaces a hand-tampered slice as corrupt and preserves the marker", () => {
    const storage = memoryStorage();
    saveProgress(writeCareer(createDefaultProgress(), freshSlice()), storage);

    const raw = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as {
      career: { cash: number };
    };
    raw.career.cash = 999999;
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(raw));

    const tampered = loadProgress(storage);
    expect(tampered.career).toEqual({ state: "corrupt" });
    expect(saveProgress(tampered, storage)).toBe(true);
    expect(loadProgress(storage).career).toEqual({ state: "corrupt" });
  });

  it("persists a settled slice only through writeCareer's checksum restamp", () => {
    const storage = memoryStorage();
    const slice = freshSlice();
    const settlement = settleDay({
      cash: -20,
      ledger: emptyDayLog(),
      loan: null,
      finalNotice: false,
      platformFee: 3,
      rule: slice.rule,
    });
    const advanced = applySettlement(slice, emptyDayLog(), settlement);

    saveProgress(writeCareer(createDefaultProgress(), advanced), storage);
    const restored = loadProgress(storage);

    expect(restored.career).toEqual(advanced);
    expect(
      restored.career !== null &&
        restored.career.state !== "corrupt" &&
        activeCity(restored.career).loan !== null,
    ).toBe(true);
  });

  it("clearCareer empties the slice and resetProgress starts careerless", () => {
    const withCareer = writeCareer(createDefaultProgress(), freshSlice());

    expect(withCareer.career).not.toBeNull();
    expect(clearCareer(withCareer).career).toBeNull();
    expect(resetProgress(memoryStorage()).career).toBeNull();
  });
});
