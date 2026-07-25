import { describe, expect, it } from "vitest";
import {
  BIKE_CUTSCENE_BODY,
  buildBikeErrandScript,
  buildPulloverScript,
  buildRoadsideRefuelScript,
  cutsceneBodyProfile,
  DEFAULT_CUTSCENE_BODY,
  lerpCarPose,
  MAX_LEG_SECONDS,
  MIN_PULLOVER_RUN_M,
  pointAlongPolyline,
  projectOntoPolyline,
  PUMP_BASE_SECONDS,
  PUMP_EXTRA_SECONDS,
  pulloverPose,
  pulloverRunM,
  settleEase,
  STORE_DWELL_SECONDS,
  WINDOW_DWELL_SECONDS,
  buildBoardScript,
  buildErrandScript,
  buildExitScript,
  buildRefuelScript,
  driverDoorPoint,
  pathLength,
  rearKerbDoorPoint,
  routeAroundCar,
  scriptFocusPoint,
  scriptSeconds,
  type CutsceneBodyProfile,
  type CutsceneCarPose,
  type CutsceneStep,
  type PulloverRoad,
} from "../app/game/cutsceneScript";
import type { TrafficSide, WorldPoint } from "../app/game/types";

const CAR_POSES: readonly CutsceneCarPose[] = [
  { x: 0, z: 0, heading: 0 },
  { x: 40, z: -12, heading: Math.PI / 2 },
  { x: -7, z: 88, heading: -2.3 },
  { x: 3, z: 3, heading: Math.PI },
];

/** Independent world→car-local transform (mirrors the sim conventions). */
function local(car: CutsceneCarPose, point: WorldPoint) {
  const dx = point.x - car.x;
  const dz = point.z - car.z;
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  return { long: dx * sin + dz * cos, lat: dx * cos - dz * sin };
}

/** Every point 5 cm apart along every walk/run leg of a script. */
function* walkSamples(script: readonly CutsceneStep[]): Generator<WorldPoint> {
  for (const step of script) {
    if (step.action !== "walk" && step.action !== "run") continue;
    const path = step.path ?? [];
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const count = Math.max(1, Math.ceil(length / 0.05));
      for (let sample = 0; sample <= count; sample += 1) {
        const t = sample / count;
        yield { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }
  }
}

function expectClearOfCarBody(
  car: CutsceneCarPose,
  script: readonly CutsceneStep[],
) {
  for (const sample of walkSamples(script)) {
    const p = local(car, sample);
    const insideBody = Math.abs(p.long) < 2.35 && Math.abs(p.lat) < 1.0;
    expect(
      insideBody,
      `sample (${sample.x.toFixed(2)}, ${sample.z.toFixed(2)}) crosses the car body`,
    ).toBe(false);
  }
}

describe("routeAroundCar", () => {
  it("goes straight when the line already clears the car", () => {
    const car: CutsceneCarPose = { x: 0, z: 0, heading: 0 };
    const path = routeAroundCar(car, { x: 2, z: 1 }, { x: 4, z: -2 });
    expect(path).toHaveLength(2);
  });

  it("skirts the bumpers when crossing flanks, on every heading", () => {
    for (const car of CAR_POSES) {
      const sin = Math.sin(car.heading);
      const cos = Math.cos(car.heading);
      // Driver-right normal is (cos h, -sin h): points 2 m off each flank.
      const left = { x: car.x - 2 * cos, z: car.z + 2 * sin };
      const right = { x: car.x + 2 * cos, z: car.z - 2 * sin };
      const path = routeAroundCar(car, left, right);
      expect(path.length).toBeGreaterThan(2);
      expectClearOfCarBody(car, [
        { action: "walk", path, seconds: 1 },
      ]);
    }
  });
});

describe("buildRefuelScript", () => {
  it("walks to the pump, fills for 3-5 s, and never crosses the car", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const pump = { x: car.x + 6, z: car.z + 5 };
        const script = buildRefuelScript(car, steeringSide, pump, 0.7);
        expectClearOfCarBody(car, script);
        // The fill step happens within nozzle reach of the pump.
        const fillIndex = script.findIndex((step) => step.fuelWindow);
        expect(fillIndex).toBeGreaterThan(0);
        const walkOut = script[fillIndex - 1];
        const stand = walkOut.path?.[walkOut.path.length - 1];
        expect(stand).toBeDefined();
        expect(Math.hypot(stand!.x - pump.x, stand!.z - pump.z)).toBeLessThan(
          1.6,
        );
        // Fill duration scales with the missing fuel inside the 3-5 s brief.
        expect(script[fillIndex].seconds).toBeCloseTo(
          PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS * 0.7,
          5,
        );
        // Starts at the driver's door, ends getting back in with the dip.
        expect(script[0].action).toBe("show");
        expect(script[0].path?.[0]).toEqual(driverDoorPoint(car, steeringSide));
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
      }
    }
  });

  it("clamps the fill window to the 3-5 s brief at the extremes", () => {
    const car = CAR_POSES[0];
    const pump = { x: 5, z: 5 };
    const empty = buildRefuelScript(car, "left", pump, 1);
    const topUp = buildRefuelScript(car, "left", pump, 0.02);
    const over = buildRefuelScript(car, "left", pump, 3.5);
    const fill = (script: CutsceneStep[]) =>
      script.find((step) => step.fuelWindow)!.seconds;
    expect(fill(empty)).toBe(PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS);
    expect(fill(topUp)).toBeGreaterThanOrEqual(PUMP_BASE_SECONDS);
    expect(fill(over)).toBe(PUMP_BASE_SECONDS + PUMP_EXTRA_SECONDS);
  });
});

describe("buildBoardScript", () => {
  it("walks the rider to the rear kerb-side door in all four conventions", () => {
    for (const car of CAR_POSES) {
      for (const trafficSide of ["left", "right"] as const) {
        const kerbSign = trafficSide === "right" ? 1 : -1;
        const sin = Math.sin(car.heading);
        const cos = Math.cos(car.heading);
        const riderSpot = {
          x: car.x + kerbSign * 5 * cos + 2 * sin,
          z: car.z - kerbSign * 5 * sin + 2 * cos,
        };
        const script = buildBoardScript(car, trafficSide, riderSpot);
        expectClearOfCarBody(car, script);
        const approach = script[0];
        expect(approach.action).toBe("walk");
        const doorPoint = approach.path?.[approach.path.length - 1];
        expect(doorPoint).toEqual(rearKerbDoorPoint(car, trafficSide));
        // The rear door is behind the axle midpoint and on the kerb side.
        const p = local(car, doorPoint!);
        expect(p.long).toBeLessThan(0);
        expect(Math.sign(p.lat)).toBe(kerbSign);
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
      }
    }
  });
});

describe("buildExitScript", () => {
  it("steps out the rear kerb-side door and dips the car", () => {
    const car = CAR_POSES[1];
    const script = buildExitScript(car, "right");
    expect(script[0]).toMatchObject({ action: "show", carDip: true });
    expect(script[0].path?.[0]).toEqual(rearKerbDoorPoint(car, "right"));
    expect(script[script.length - 1]).toMatchObject({ action: "hide" });
  });

  // The regression guard for the "walks away, then comes back" bug: the walk-off
  // is car-relative, so for any park (any heading) it heads straight off the
  // kerb side and never routes back across the body toward a fixed venue point.
  it("walks off the kerb side clear of the car, for every pose and side", () => {
    for (const car of CAR_POSES) {
      for (const trafficSide of ["left", "right"] as const) {
        const script = buildExitScript(car, trafficSide);
        expectClearOfCarBody(car, script);
        const walk = script[1];
        const end = local(car, walk.path![walk.path!.length - 1]);
        const kerbSign = trafficSide === "right" ? 1 : -1;
        expect(Math.sign(end.lat)).toBe(kerbSign);
        expect(Math.abs(end.lat)).toBeGreaterThan(4);
      }
    }
  });
});

describe("buildErrandScript", () => {
  it("jogs out, dwells inside, jogs back and gets in - clear of the car", () => {
    for (const car of CAR_POSES) {
      const buildingDoor = { x: car.x - 9, z: car.z + 14 };
      const script = buildErrandScript(car, "left", buildingDoor);
      expectClearOfCarBody(car, script);
      expect(script.map((step) => step.action)).toEqual([
        "show",
        "run",
        "hide",
        "show",
        "run",
        "hide",
      ]);
      expect(script[2].seconds).toBe(STORE_DWELL_SECONDS);
      expect(script[3].path?.[0]).toEqual(buildingDoor);
      expect(script[script.length - 1]).toMatchObject({
        action: "hide",
        carDip: true,
      });
    }
  });

  it("hurries far doors instead of overrunning the leg cap", () => {
    const car = CAR_POSES[0];
    const script = buildErrandScript(car, "right", { x: 38, z: 24 });
    for (const step of script) {
      if (step.action === "run") {
        expect(step.seconds).toBeLessThanOrEqual(MAX_LEG_SECONDS + 1e-9);
        expect(pathLength(step.path!)).toBeGreaterThan(30);
      }
    }
  });
});

describe("script metadata", () => {
  it("is deterministic: identical inputs build identical scripts", () => {
    const car = CAR_POSES[2];
    const a = buildRefuelScript(car, "right", { x: 4, z: 90 }, 0.4);
    const b = buildRefuelScript(car, "right", { x: 4, z: 90 }, 0.4);
    expect(a).toEqual(b);
  });

  it("sums durations and finds the farthest focus point", () => {
    const car = CAR_POSES[0];
    const buildingDoor = { x: 15, z: 10 };
    const script = buildErrandScript(car, "left", buildingDoor);
    expect(scriptSeconds(script)).toBeGreaterThan(STORE_DWELL_SECONDS + 2);
    expect(scriptFocusPoint(car, script)).toEqual(buildingDoor);
  });
});

describe("CutsceneBodyProfile", () => {
  const VAN = cutsceneBodyProfile(5.18, 2.02);

  /** Profile-aware clear-of-body check (margins mirror expectClearOfCarBody). */
  function expectClearOfBody(
    car: CutsceneCarPose,
    script: readonly CutsceneStep[],
    body: CutsceneBodyProfile,
  ) {
    for (const step of script) {
      if (step.action !== "walk" && step.action !== "run") continue;
      const path = step.path ?? [];
      for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1];
        const b = path[index];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const count = Math.max(1, Math.ceil(length / 0.05));
        for (let sample = 0; sample <= count; sample += 1) {
          const t = sample / count;
          const p = local(car, {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
          });
          const insideBody =
            Math.abs(p.long) < body.bodyHalfLongM - 0.1 &&
            Math.abs(p.lat) < body.bodyHalfLatM - 0.1;
          expect(
            insideBody,
            `sample crosses the ${body.bodyHalfLongM.toFixed(2)}-half-long body`,
          ).toBe(false);
        }
      }
    }
  }

  it("reproduces the long-standing default envelope exactly for the flagship", () => {
    expect(cutsceneBodyProfile(4.55, 1.9)).toEqual(DEFAULT_CUTSCENE_BODY);
  });

  it("keeps every builder byte-identical when the default profile is passed explicitly", () => {
    for (const car of CAR_POSES) {
      const pump = { x: car.x + 6, z: car.z + 5 };
      const door = { x: car.x - 8, z: car.z + 3 };
      expect(buildRefuelScript(car, "left", pump, 0.5)).toEqual(
        buildRefuelScript(car, "left", pump, 0.5, DEFAULT_CUTSCENE_BODY),
      );
      expect(buildErrandScript(car, "right", door)).toEqual(
        buildErrandScript(
          car,
          "right",
          door,
          undefined,
          DEFAULT_CUTSCENE_BODY,
        ),
      );
      expect(buildExitScript(car, "left")).toEqual(
        buildExitScript(car, "left", DEFAULT_CUTSCENE_BODY),
      );
      expect(buildBoardScript(car, "right", door)).toEqual(
        buildBoardScript(car, "right", door, DEFAULT_CUTSCENE_BODY),
      );
    }
  });

  it("scales the envelope up for the van: longer body, wider doors", () => {
    expect(VAN.bodyHalfLongM).toBeGreaterThan(
      DEFAULT_CUTSCENE_BODY.bodyHalfLongM,
    );
    expect(VAN.doorLateralM).toBeGreaterThan(DEFAULT_CUTSCENE_BODY.doorLateralM);
    // Doors always sit outside their own body's flank.
    expect(VAN.doorLateralM).toBeGreaterThan(VAN.bodyHalfLatM);
  });

  it("walks clear of the van's real bumpers on every heading and both sides", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const sin = Math.sin(car.heading);
        const cos = Math.cos(car.heading);
        // A venue door 6 m off the flank OPPOSITE the driver's door forces an
        // around-the-body route for at least one steering side.
        const lat = steeringSide === "left" ? 6 : -6;
        const target = { x: car.x + lat * cos, z: car.z - lat * sin };
        const errand = buildErrandScript(
          car,
          steeringSide,
          target,
          undefined,
          VAN,
        );
        expectClearOfBody(car, errand, VAN);
        const refuel = buildRefuelScript(car, steeringSide, target, 0.6, VAN);
        expectClearOfBody(car, refuel, VAN);
      }
    }
  });
});

describe("buildBikeErrandScript", () => {
  it("dismounts beside the bike with no door sounds and no suspension dip", () => {
    for (const bike of CAR_POSES) {
      const door = { x: bike.x + 7, z: bike.z - 4 };
      const script = buildBikeErrandScript(bike, door);
      // A bicycle has neither doors nor suspension: nothing in the scene may
      // play a door/pump cue or dip the "car".
      for (const step of script) {
        expect(step.sound, step.action).toBeUndefined();
        expect(step.carDip ?? false).toBe(false);
      }
      // Appears at the mount point just off the bike's flank...
      const mount = script[0].path?.[0];
      expect(script[0].action).toBe("show");
      const mountLocal = local(bike, mount!);
      expect(Math.abs(mountLocal.lat)).toBeCloseTo(
        BIKE_CUTSCENE_BODY.doorLateralM,
        5,
      );
      // ...reaches the venue door, and ends hidden (remounting).
      const runOut = script[1];
      expect(runOut.action).toBe("run");
      expect(runOut.path?.[runOut.path.length - 1]).toEqual(door);
      expect(script[script.length - 1].action).toBe("hide");
      // The walk legs clear the bike's own tiny footprint.
      for (const step of script) {
        if (step.action !== "walk" && step.action !== "run") continue;
        for (let index = 1; index < (step.path ?? []).length; index += 1) {
          const a = step.path![index - 1];
          const b = step.path![index];
          const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
          for (let sample = 0; sample <= count; sample += 1) {
            const t = sample / count;
            const p = local(bike, {
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
            });
            const inside =
              Math.abs(p.long) < BIKE_CUTSCENE_BODY.bodyHalfLongM - 0.05 &&
              Math.abs(p.lat) < BIKE_CUTSCENE_BODY.bodyHalfLatM - 0.05;
            expect(inside, "sample crosses the bike frame").toBe(false);
          }
        }
      }
    }
  });
});

describe("buildRoadsideRefuelScript", () => {
  it("fills at the driver-side rear filler without crossing the body, both sides", () => {
    for (const car of CAR_POSES) {
      for (const steeringSide of ["left", "right"] as const) {
        const script = buildRoadsideRefuelScript(car, steeringSide);
        expectClearOfCarBody(car, script);
        // Exactly one fill window, book-ended by the pump foley.
        const fills = script.filter((step) => step.fuelWindow);
        expect(fills).toHaveLength(1);
        expect(script.some((step) => step.sound === "pump_start")).toBe(true);
        expect(script.some((step) => step.sound === "pump_stop")).toBe(true);
        // Steps out the driver door, ends back inside with the dip.
        expect(script[0].path?.[0]).toEqual(driverDoorPoint(car, steeringSide));
        expect(script[script.length - 1]).toMatchObject({
          action: "hide",
          carDip: true,
        });
        // The filler stand point sits on the driver's own side, clear of the
        // flank — the walk never needs to cross the body.
        const walkOut = script[1];
        const filler = walkOut.path?.[walkOut.path.length - 1];
        const fillerLocal = local(car, filler!);
        const driverSign = steeringSide === "left" ? -1 : 1;
        expect(Math.sign(fillerLocal.lat)).toBe(driverSign);
        expect(Math.abs(fillerLocal.lat)).toBeGreaterThan(1.1);
      }
    }
  });
});

// --- The traffic stop -------------------------------------------------------

/** A straight 8 m carriageway running north, centred on x = 0. */
const NORTH_ROAD: PulloverRoad = {
  centerline: [
    { x: 0, z: -400 },
    { x: 0, z: 400 },
  ],
  halfWidthM: 4,
};

describe("projectOntoPolyline / pointAlongPolyline", () => {
  it("finds the nearest point, its tangent and its arc length", () => {
    const hit = projectOntoPolyline(NORTH_ROAD.centerline, 3, 25);
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(0, 6);
    expect(hit!.point.z).toBeCloseTo(25, 6);
    expect(hit!.distance).toBeCloseTo(3, 6);
    // Heading convention: 0 = +z, so a due-north polyline reads as 0.
    expect(hit!.tangent).toBeCloseTo(0, 6);
    expect(hit!.along).toBeCloseTo(425, 6);
  });

  it("walks a bent polyline by arc length and clamps past its end", () => {
    const bend: readonly WorldPoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: 10 },
      { x: 10, z: 10 },
    ];
    const mid = pointAlongPolyline(bend, 15);
    expect(mid!.point.x).toBeCloseTo(5, 6);
    expect(mid!.point.z).toBeCloseTo(10, 6);
    expect(mid!.tangent).toBeCloseTo(Math.PI / 2, 6);
    const past = pointAlongPolyline(bend, 999);
    expect(past!.point).toEqual({ x: 10, z: 10 });
    expect(pointAlongPolyline([{ x: 0, z: 0 }], 1)).toBeNull();
  });
});

describe("settleEase", () => {
  it("starts at twice the average speed and arrives at rest", () => {
    expect(settleEase(0)).toBe(0);
    expect(settleEase(1)).toBe(1);
    // Derivative at t=0 is 2 (the entry speed pulloverSeconds solves for) and
    // 0 at t=1 — the car decelerates into its stop rather than snapping.
    const h = 1e-6;
    expect((settleEase(h) - settleEase(0)) / h).toBeCloseTo(2, 3);
    expect((settleEase(1) - settleEase(1 - h)) / h).toBeCloseTo(0, 3);
    expect(settleEase(-3)).toBe(0);
    expect(settleEase(3)).toBe(1);
  });
});

describe("pulloverPose", () => {
  it("parks against the kerb on the correct side, both traffic sides", () => {
    for (const trafficSide of ["right", "left"] as const) {
      const car: CutsceneCarPose = { x: -1.7, z: 0, heading: 0 };
      const parked = pulloverPose(car, 20, trafficSide, NORTH_ROAD);
      // Kerb is on the vehicle's right in right-hand traffic.
      const kerbSign = trafficSide === "right" ? 1 : -1;
      expect(Math.sign(parked.x)).toBe(kerbSign);
      // Inside the carriageway, with the flank close to but clear of the kerb.
      const flank = Math.abs(parked.x) + DEFAULT_CUTSCENE_BODY.bodyHalfLatM;
      expect(flank).toBeLessThanOrEqual(NORTH_ROAD.halfWidthM);
      expect(flank).toBeGreaterThan(NORTH_ROAD.halfWidthM - 0.5);
      expect(parked.z).toBeCloseTo(20, 6);
      expect(parked.heading).toBeCloseTo(0, 6);
    }
  });

  it("rolls the way the car is going, not the way the road was authored", () => {
    // Same road, car heading south: it must end up behind the start in world
    // terms, still on its own kerb side.
    const car: CutsceneCarPose = { x: 1.7, z: 0, heading: Math.PI };
    const parked = pulloverPose(car, 20, "right", NORTH_ROAD);
    expect(parked.z).toBeCloseTo(-20, 6);
    expect(Math.abs(parked.heading)).toBeCloseTo(Math.PI, 6);
    // Driving south on the right puts the kerb at negative x.
    expect(parked.x).toBeLessThan(0);
  });

  it("still parks ahead and kerbward with no road to measure", () => {
    for (const trafficSide of ["right", "left"] as const) {
      for (const car of CAR_POSES) {
        const parked = pulloverPose(car, 12, trafficSide, null);
        const p = local(car, parked);
        expect(p.long).toBeCloseTo(12, 6);
        expect(Math.sign(p.lat)).toBe(trafficSide === "right" ? 1 : -1);
        expect(parked.heading).toBe(car.heading);
      }
    }
  });
});

describe("pulloverRunM", () => {
  it("scales the roll-out with speed but never stops on the spot", () => {
    expect(pulloverRunM(0)).toBe(MIN_PULLOVER_RUN_M);
    expect(pulloverRunM(-5)).toBe(MIN_PULLOVER_RUN_M);
    expect(pulloverRunM(30)).toBeGreaterThan(MIN_PULLOVER_RUN_M);
    expect(pulloverRunM(30)).toBeGreaterThan(pulloverRunM(10));
  });
});

describe("buildPulloverScript", () => {
  const CASES: readonly {
    trafficSide: TrafficSide;
    steeringSide: "left" | "right";
  }[] = [
    { trafficSide: "right", steeringSide: "left" },
    { trafficSide: "left", steeringSide: "right" },
    // Deliberately mismatched: a left-hand-drive car on a left-hand-traffic
    // map is a legal combination the launcher allows.
    { trafficSide: "left", steeringSide: "left" },
  ];

  it("puts the patrol behind the parked car, nose to tail, not through it", () => {
    for (const { trafficSide, steeringSide } of CASES) {
      const car: CutsceneCarPose = { x: -1.7, z: -30, heading: 0 };
      const plan = buildPulloverScript(
        car,
        18,
        steeringSide,
        trafficSide,
        NORTH_ROAD,
      );
      const behind = local(plan.parked, plan.patrol);
      expect(behind.long).toBeLessThan(-DEFAULT_CUTSCENE_BODY.bodyHalfLongM * 2);
      expect(Math.abs(behind.lat)).toBeCloseTo(0, 6);
      expect(plan.patrol.heading).toBeCloseTo(plan.parked.heading, 6);
      // It arrives from further back still, so it reads as following you in.
      const runUp = local(plan.parked, plan.patrolStart);
      expect(runUp.long).toBeLessThan(behind.long - 10);
    }
  });

  it("walks the officer up the driver's flank and back, clear of both cars", () => {
    for (const { trafficSide, steeringSide } of CASES) {
      const car: CutsceneCarPose = { x: 1.7, z: 40, heading: 2.1 };
      const plan = buildPulloverScript(
        car,
        9,
        steeringSide,
        trafficSide,
        NORTH_ROAD,
      );
      expectClearOfCarBody(plan.parked, plan.steps);
      expectClearOfCarBody(plan.patrol, plan.steps);
      // He ends up beside the driver's own window, on the driver's side.
      const approach = plan.steps.find((step) => step.action === "walk");
      const stand = approach!.path![approach!.path!.length - 1];
      const p = local(plan.parked, stand);
      expect(Math.sign(p.lat)).toBe(steeringSide === "left" ? -1 : 1);
      expect(Math.abs(p.lat)).toBeGreaterThan(
        DEFAULT_CUTSCENE_BODY.bodyHalfLatM,
      );
      expect(Math.abs(p.long)).toBeLessThan(1.5);
    }
  });

  it("cites once, at the window, for 2-3 s", () => {
    const plan = buildPulloverScript(
      { x: 0, z: 0, heading: 0 },
      14,
      "left",
      "right",
      NORTH_ROAD,
    );
    const cites = plan.steps.filter((step) => step.citeWindow);
    expect(cites).toHaveLength(1);
    expect(cites[0].action).toBe("idle");
    expect(cites[0].seconds).toBe(WINDOW_DWELL_SECONDS);
    expect(cites[0].seconds).toBeGreaterThanOrEqual(2);
    expect(cites[0].seconds).toBeLessThanOrEqual(3);
    // The citation lands after the officer has actually walked over.
    expect(plan.steps.indexOf(cites[0])).toBeGreaterThan(1);
  });

  it("moves both cars in one opening step that lands them on their marks", () => {
    const car: CutsceneCarPose = { x: -1.7, z: 0, heading: 0 };
    const plan = buildPulloverScript(car, 22, "left", "right", NORTH_ROAD);
    const moves = plan.steps.flatMap((step) => step.carMoves ?? []);
    expect(plan.steps.filter((step) => step.carMoves).length).toBe(1);
    expect(plan.steps[0].carMoves).toBeDefined();
    const player = moves.find((move) => move.vehicle === "player");
    const patrol = moves.find((move) => move.vehicle === "patrol");
    expect(player).toMatchObject({ from: car, to: plan.parked });
    expect(patrol).toMatchObject({ from: plan.patrolStart, to: plan.patrol });
    // The eased track is continuous from the clocked pose to the parked one.
    expect(lerpCarPose(player!.from, player!.to, settleEase(0))).toEqual(car);
    expect(lerpCarPose(player!.from, player!.to, settleEase(1))).toEqual(
      plan.parked,
    );
  });

  it("takes the shortest way round when the stop crosses the heading wrap", () => {
    // Heading just under +π gliding to just over −π: a naive lerp would spin
    // the car a full turn on the spot.
    const from: CutsceneCarPose = { x: 0, z: 0, heading: Math.PI - 0.05 };
    const to: CutsceneCarPose = { x: 0, z: 10, heading: -Math.PI + 0.05 };
    const mid = lerpCarPose(from, to, 0.5);
    expect(Math.abs(mid.heading)).toBeGreaterThan(Math.PI - 0.06);
  });

  it("still stages a full stop when the car is nowhere near a road", () => {
    // The app debits the fine on the citation step, so a stop that cannot be
    // built is a violation that silently costs nothing.
    const car: CutsceneCarPose = { x: 900, z: -900, heading: 0.4 };
    const plan = buildPulloverScript(car, 0, "right", "left", null);
    expect(plan.steps.length).toBeGreaterThan(3);
    expect(plan.steps.some((step) => step.citeWindow)).toBe(true);
    expect(scriptSeconds(plan.steps)).toBeGreaterThan(WINDOW_DWELL_SECONDS);
    expectClearOfCarBody(plan.parked, plan.steps);
  });

  it("runs long enough to read as a stop, and hurries when clocked fast", () => {
    const slow = buildPulloverScript(
      { x: 0, z: 0, heading: 0 },
      2,
      "left",
      "right",
      NORTH_ROAD,
    );
    const fast = buildPulloverScript(
      { x: 0, z: 0, heading: 0 },
      28,
      "left",
      "right",
      NORTH_ROAD,
    );
    for (const plan of [slow, fast]) {
      expect(scriptSeconds(plan.steps)).toBeGreaterThan(7);
      expect(scriptSeconds(plan.steps)).toBeLessThan(20);
    }
    // Clocked at speed you roll further before stopping.
    expect(
      Math.hypot(fast.parked.x, fast.parked.z),
    ).toBeGreaterThan(Math.hypot(slow.parked.x, slow.parked.z));
  });
});
