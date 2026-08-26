import { Color3, NullEngine, Scene } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import {
  buildPulloverScript,
  STAGED_COVER_HEADROOM_M,
  type CutsceneCarPose,
  type PulloverRoad,
} from "../app/game/cutsceneScript";
import { createElevatedRoadDeckHeadroomQuery } from "../app/game/geometry/elevatedRoadGeometry";
import {
  CutsceneDirector,
  resolveStagedCameraFraming,
  stagedCameraHeightBelowRoadDeck,
  type CutsceneDirectorCtx,
} from "../app/game/render/cutsceneDirector";

const engines: NullEngine[] = [];

afterEach(() => {
  while (engines.length > 0) engines.pop()?.dispose();
});

const road = (id: string): PulloverRoad => {
  const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
    (candidate) => candidate.id === id,
  );
  if (!surface) throw new Error(`Missing Cairo road surface ${id}`);
  return { centerline: surface.centerline, halfWidthM: surface.widthM / 2 };
};

const context = (
  car: CutsceneCarPose,
  speedMps = 8,
): CutsceneDirectorCtx => {
  const playerState = {
    x: car.x,
    z: car.z,
    elevationM: car.elevationM ?? 0,
    previousX: car.x,
    previousZ: car.z,
    previousElevationM: car.elevationM ?? 0,
    heading: car.heading,
    previousHeading: car.heading,
    speedMps,
  };
  return {
    playerState,
    steeringSide: "left",
    trafficSide: "right",
    playerVehicle: null,
    mapPack: CAIRO_MAP_PACK,
    scenarioTrafficSeed: 127,
    thirdCameraX: car.x - 10,
    thirdCameraZ: car.z - 10,
    stagedBlockers: [],
    cameraMode: "third_person",
    riderNode: null,
    playerCyclistVisual: null,
    gigVenueCurbside: new Map(),
    gigVenueDoors: new Map(),
    playFoley: vi.fn(),
    setPlayerPose: vi.fn(),
    applyCameraStack: vi.fn(),
    patrolSimulationIdNear: () => null,
    passengerColors: () => ({
      clothing: new Color3(0.4, 0.4, 0.4),
      pants: new Color3(0.2, 0.2, 0.2),
      complexion: new Color3(0.7, 0.5, 0.4),
      hair: new Color3(0.1, 0.1, 0.1),
    }),
    emit: vi.fn(),
  };
};

const fixtures = [
  {
    name: "Ramses under the eastern exit",
    car: {
      x: 566.46,
      z: 277.93,
      heading: 0.46364760900080665,
      elevationM: 0,
    },
    roadId: "cairo-ramses",
    overheadPoint: "parked" as const,
  },
  {
    name: "Corniche under the riverside exit",
    car: {
      x: 97.18,
      z: 203.21,
      heading: 0.022220151844784694,
      elevationM: 0,
    },
    roadId: "cairo-corniche-el-nil",
    overheadPoint: "patrol" as const,
  },
] as const;

describe("Cairo bridge-aware traffic-stop staging", () => {
  for (const fixture of fixtures) {
    it(`keeps the ${fixture.name} camera and officer beneath the real soffit`, () => {
      const plan = buildPulloverScript(
        fixture.car,
        8,
        "left",
        "right",
        road(fixture.roadId),
      );
      const overheadPoint = plan[fixture.overheadPoint];
      const headroomAt = createElevatedRoadDeckHeadroomQuery(
        CAIRO_MAP_PACK.geometry.roadSurfaces,
      );
      // The shot spans the car/patrol pair; a deck within the director's
      // three-metre framing reach still crosses the sightline at its edge.
      const slab = headroomAt(overheadPoint, 0, 3, false);
      expect(slab, fixture.name).toMatchObject({ structureKind: "deck" });

      const framing = resolveStagedCameraFraming(
        plan.parked,
        plan.patrol,
        true,
      );
      const safeHeight = stagedCameraHeightBelowRoadDeck(
        framing.cameraY,
        plan.parked.elevationM ?? 0,
        slab!.soffitElevationM,
      );
      expect(safeHeight, fixture.name).not.toBeNull();
      expect(safeHeight!, fixture.name).toBeLessThan(framing.cameraY);
      expect(safeHeight!, fixture.name).toBeLessThanOrEqual(
        slab!.soffitElevationM - STAGED_COVER_HEADROOM_M,
      );

      for (const point of plan.steps.flatMap((step) => step.path ?? [])) {
        const obstruction = headroomAt(
          point,
          point.elevationM ?? 0,
          0.45,
        );
        expect(
          obstruction === null || obstruction.headroomM >= 2.25,
          `${fixture.name}: officer mark ${point.x},${point.z}`,
        ).toBe(true);
      }

      const engine = new NullEngine();
      engines.push(engine);
      const scene = new Scene(engine);
      const director = new CutsceneDirector(scene);
      const ctx = context(fixture.car);
      director.start(ctx, { nonce: 1, kind: "pullover" });
      const debug = director.debugSnapshot();
      expect(debug, fixture.name).not.toBeNull();
      expect(debug!.cameraY, fixture.name).toBeLessThan(
        slab!.soffitElevationM,
      );
      expect(debug!.cameraY, fixture.name).toBeGreaterThanOrEqual(2.4);
      director.dispose(ctx);
      scene.dispose();
    });
  }

  it("keeps the rendered patrol and officer on the authored Ramses ramp grade", () => {
    const ramp = road("cairo-sixth-october-bridge-ramses-exit");
    const start = ramp.centerline[1];
    const end = ramp.centerline[2];
    const amount = 0.35;
    const car = {
      x: start.x + (end.x - start.x) * amount,
      z: start.z + (end.z - start.z) * amount,
      heading: Math.atan2(end.x - start.x, end.z - start.z),
      elevationM:
        (start.elevationM ?? 0) +
        ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
    };
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const director = new CutsceneDirector(scene);
    const ctx = context(car, 0);
    const expected = buildPulloverScript(
      car,
      0,
      "left",
      "right",
      ramp,
    );
    director.start(ctx, { nonce: 2, kind: "pullover" });
    expect(director.debugSnapshot()?.patrolY).toBeCloseTo(
      (expected.patrolStart.elevationM ?? 0) + 0.12,
      2,
    );

    director.advance(ctx, expected.steps[0].seconds + 0.01);
    const debug = director.debugSnapshot();
    expect(debug?.actorVisible).toBe(true);
    expect(debug?.actorY).toBeCloseTo(
      (expected.steps[1].path?.[0]?.elevationM ?? 0) + 0.08,
      2,
    );
    director.dispose(ctx);
    scene.dispose();
  });
});
