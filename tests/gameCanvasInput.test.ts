import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexData } from "@babylonjs/core";
import {
  NpcVisualSlotAssignmentResolver,
  TickIndexedInputReplay,
  removeOwnedDebugHooks,
  resolveNpcVisualSlotAssignments,
} from "../app/game/render/babylonGameSession";
import {
  AdaptiveInputRouter,
  INPUT_PROMPT_SWITCH_COOLDOWN_MS,
  TOUCH_CONTROL_DIM_DELAY_MS,
  isCameraStackActive,
  resolveCockpitCameraPoses,
  type AdaptiveInputPresentation,
} from "../app/game/adaptiveInputRouter";
import {
  buildRoadSurfaceStripGeometry,
  collectRoadJunctionFills,
  smoothClosedRoadCenterline,
} from "../app/game/geometry/roadStrips";
import {
  clampHorizontalFieldOfView,
  DEFAULT_HORIZONTAL_FOV,
  MAX_HORIZONTAL_FOV,
  MIN_HORIZONTAL_FOV,
} from "../app/game/render/renderConstants";
import {
  COCKPIT_DASH_DRIVER_Z,
  MAX_STEERING_WHEEL_SPIN,
  resolveCockpitPitch,
  resolveCockpitSteeringGeometry,
  resolveSteeringWheelSpin,
} from "../app/game/cockpitLayout";

describe("authoritative NPC visual slots", () => {
  it("preserves live ids regardless of snapshot order", () => {
    const slots = [
      { simulationId: "npc-1" },
      { simulationId: "scripted-lead" },
      { simulationId: "npc-3" },
      {},
    ];
    const vehicles = [
      { id: "npc-3" },
      { id: "npc-1" },
      { id: "scripted-lead" },
      { id: "npc-4" },
    ];

    expect(resolveNpcVisualSlotAssignments(slots, vehicles)).toEqual([2, 0, 1, 3]);
  });

  it("reserves numeric slots before placing a new scripted vehicle", () => {
    const slots = [{}, {}, {}, {}];
    const vehicles = [
      { id: "scripted-lead" },
      { id: "npc-1" },
      { id: "npc-2" },
      { id: "npc-3" },
    ];

    expect(resolveNpcVisualSlotAssignments(slots, vehicles)).toEqual([3, 0, 1, 2]);
  });

  it("does not evict a scripted lead when its preferred numeric slot activates", () => {
    const slots = [
      { simulationId: "scripted-lead" },
      { simulationId: "npc-2" },
      {},
      {},
    ];
    const vehicles = [
      { id: "scripted-lead" },
      { id: "npc-1" },
      { id: "npc-2" },
    ];

    const assignments = resolveNpcVisualSlotAssignments(slots, vehicles);
    expect(assignments).toEqual([0, 2, 1]);
    expect(new Set(assignments).size).toBe(assignments.length);
  });

  it("retains reusable lookup scratch while refreshing changed slot ids", () => {
    const resolver = new NpcVisualSlotAssignmentResolver();
    const slots = [
      { simulationId: "npc-1" },
      { simulationId: "npc-1" },
      { simulationId: "scripted-lead" },
      {},
    ];

    const first = resolver.resolve(slots, [
      { id: "npc-1" },
      { id: "npc-1" },
      { id: "scripted-lead" },
    ]);
    expect(first).toEqual([0, 1, 2]);

    // Simulate the root's new association before the next fixed snapshot.
    slots[1].simulationId = "npc-2";
    resolver.commitSlotAssignment(1, "npc-2");
    const second = resolver.resolve(slots, [
      { id: "npc-2" },
      { id: "npc-1" },
      { id: "scripted-lead" },
    ]);

    expect(second).toBe(first);
    expect(second).toEqual([1, 0, 2]);
  });
});

describe("tick-indexed browser input replay", () => {
  const pose = (tick: number, x = tick, z = 0) => ({
    tick,
    player: { x, z, heading: tick * 0.01, speedMps: 6 },
  });

  it("selects controls by relative fixed tick and fingerprints route coverage", () => {
    const run = () => {
      const replay = new TickIndexedInputReplay();
      replay.start(
        pose(40, 0),
        [
          { fromTick: 0, toTick: 2, input: { throttle: 1 } },
          { fromTick: 3, toTick: 4, input: { steer: -0.5 } },
        ],
        2,
      );

      expect(replay.prepare(pose(40, 0))).toMatchObject({ throttle: 1 });
      replay.record(pose(41, 1));
      expect(replay.prepare(pose(41, 1))).toMatchObject({ throttle: 1 });
      replay.record(pose(42, 2));
      // Tick two is the deliberate neutral gap between the two segments.
      expect(replay.prepare(pose(42, 2))).toEqual({
        throttle: 0,
        brake: 0,
        reverse: 0,
        steer: 0,
        quickLook: 0,
      });
      replay.record(pose(43, 3));
      expect(replay.prepare(pose(43, 3))).toMatchObject({ steer: -0.5 });
      replay.record(pose(44, 4));
      return { replay, status: replay.status() };
    };

    const first = run();
    const second = run();
    expect(first.status).toMatchObject({
      state: "completed",
      active: false,
      startTick: 40,
      currentTick: 44,
      completedTicks: 4,
      durationTicks: 4,
      distanceM: 4,
    });
    expect(first.status.checkpoints.map((checkpoint) => checkpoint.replayTick)).toEqual([
      0,
      2,
      4,
    ]);
    expect(first.status.trajectoryHash).toBe(second.status.trajectoryHash);
    expect(first.replay.currentInput).toBeNull();
    expect(first.replay.takeControlReleaseRequest()).toBe(true);
    expect(first.replay.takeControlReleaseRequest()).toBe(false);
  });

  it("rejects ambiguous traces and aborts on a simulation tick discontinuity", () => {
    const replay = new TickIndexedInputReplay();
    expect(() =>
      replay.start(pose(0), [
        { fromTick: 0, toTick: 3 },
        { fromTick: 2, toTick: 4 },
      ]),
    ).toThrow(/overlaps or is out of order/);

    replay.start(pose(10), [{ fromTick: 0, toTick: 2 }]);
    expect(replay.prepare(pose(11))).toBeNull();
    expect(replay.status()).toMatchObject({
      state: "aborted",
      reason: "simulation-tick-discontinuity",
    });
    expect(replay.takeControlReleaseRequest()).toBe(true);
  });
});

describe("session-owned debug hook cleanup", () => {
  it("does not let an older session delete a newer session's HMR hooks", () => {
    const oldHook = () => "old";
    const newHook = () => "new";
    const target: Record<string, unknown> = { __sideswapPerfDebug: newHook };

    removeOwnedDebugHooks(
      target,
      new Map([["__sideswapPerfDebug", oldHook]]),
    );
    expect(target.__sideswapPerfDebug).toBe(newHook);

    removeOwnedDebugHooks(
      target,
      new Map([["__sideswapPerfDebug", newHook]]),
    );
    expect("__sideswapPerfDebug" in target).toBe(false);
  });
});


describe("continuous road-surface rendering", () => {
  it("builds one mitered surface through a right-angle bend instead of separate chipped boxes", () => {
    const geometry = buildRoadSurfaceStripGeometry(
      [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
        { x: 10, z: 10 },
      ],
      6,
    );

    expect(geometry.closed).toBe(false);
    expect(geometry.positions).toHaveLength(18);
    expect(geometry.indices).toHaveLength(12);
    // The shared corner uses the mitered outer and inner corners of the turn.
    expect(geometry.positions.slice(6, 12)).toEqual([3, 0, 7, -3, 0, 13]);
  });

  it("faces the asphalt upward so Babylon renders it from driving cameras", () => {
    const geometry = buildRoadSurfaceStripGeometry(
      [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
      ],
      6,
    );
    const normals: number[] = [];

    VertexData.ComputeNormals(
      [...geometry.positions],
      [...geometry.indices],
      normals,
    );

    expect(normals.filter((_, index) => index % 3 === 1)).toEqual([
      1,
      1,
      1,
      1,
    ]);
  });

  it("wraps a closed roundabout strip without a final-segment seam", () => {
    const ring = [
      { x: -20, z: -20 },
      { x: 20, z: -20 },
      { x: 20, z: 20 },
      { x: -20, z: 20 },
      { x: -20, z: -20 },
    ] as const;
    const geometry = buildRoadSurfaceStripGeometry(ring, 7.2);

    expect(geometry.closed).toBe(true);
    expect(geometry.positions).toHaveLength(24);
    expect(geometry.indices).toHaveLength(24);
    const smoothed = smoothClosedRoadCenterline(ring);
    expect(smoothed).toHaveLength(16);
    const smoothGeometry = buildRoadSurfaceStripGeometry(smoothed, 7.2, true);
    expect(smoothGeometry).toMatchObject({
      closed: true,
      indices: expect.any(Array),
    });
    expect(smoothGeometry.indices).toHaveLength(96);
  });

  it("paves one road-aligned junction fill only where independently-authored surfaces share a node", () => {
    const pointInPolygon = (
      point: { x: number; z: number },
      polygon: readonly { x: number; z: number }[],
    ): boolean => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (
          a.z > point.z !== b.z > point.z &&
          point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
        ) {
          inside = !inside;
        }
      }
      return inside;
    };

    const fills = collectRoadJunctionFills([
      {
        id: "north-south",
        widthM: 7.2,
        centerline: [
          { x: 0, z: -40 },
          { x: 0, z: 0 },
          { x: 0, z: 40 },
        ],
      },
      {
        id: "east-west",
        widthM: 10,
        centerline: [
          { x: -40, z: 0 },
          { x: 0, z: 0 },
          { x: 40, z: 0 },
        ],
      },
      {
        id: "isolated",
        widthM: 7.2,
        centerline: [
          { x: 80, z: 80 },
          { x: 100, z: 80 },
        ],
      },
    ]);

    // Only the shared crossing yields a fill; the isolated stub does not.
    expect(fills).toHaveLength(1);
    const polygon = fills[0].polygon;
    // A convex, non-degenerate hull centred on the shared node.
    expect(polygon.length).toBeGreaterThanOrEqual(4);
    expect(pointInPolygon({ x: 0, z: 0 }, polygon)).toBe(true);
    // Its footprint squares off to both carriageways: it reaches each road's
    // full half-width (east-west ±5 in x, north-south ±3.6 in z) but never
    // balloons past the wider road's span the way a circle would.
    const xs = polygon.map((p) => p.x);
    const zs = polygon.map((p) => p.z);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-5);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(5);
    expect(Math.min(...zs)).toBeLessThanOrEqual(-3.6);
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(3.6);
    expect(Math.max(...xs)).toBeLessThan(9);
    expect(Math.max(...zs)).toBeLessThan(9);
  });

});

describe("cockpit camera tracking", () => {
  it("does not mistake Babylon's initially active chase camera for cockpit mode", () => {
    expect(
      isCameraStackActive("first_person", "third-person-camera", []),
    ).toBe(false);
    expect(
      isCameraStackActive("first_person", "first-person-camera", [
        "first-person-camera",
      ]),
    ).toBe(true);
    expect(
      isCameraStackActive("third_person", "third-person-camera", [
        "third-person-camera",
      ]),
    ).toBe(true);
  });

  it("rejects a stack that still has the mirror rendering as a scene camera", () => {
    // The rear-view camera belongs to a render target now. If it turns up in
    // scene.activeCameras again, the mirror is back to a full un-throttled
    // scene pass every frame and the whole point has been undone.
    expect(
      isCameraStackActive("first_person", "first-person-camera", [
        "first-person-camera",
        "rear-view-camera",
      ]),
    ).toBe(false);
  });

  it("moves both first-person cameras with the vehicle in world space", () => {
    const start = resolveCockpitCameraPoses({
      x: -2,
      z: 10,
      vehicleHeading: 0,
      cameraHeading: 0,
      seatSide: -0.46,
      headBob: 0,
      quickLookAngle: 0,
    });
    const moved = resolveCockpitCameraPoses({
      x: 4,
      z: 28,
      vehicleHeading: 0,
      cameraHeading: 0,
      seatSide: -0.46,
      headBob: 0,
      quickLookAngle: 0,
    });

    expect(moved.first.x - start.first.x).toBeCloseTo(6);
    expect(moved.first.z - start.first.z).toBeCloseTo(18);
    expect(moved.rear.x - start.rear.x).toBeCloseTo(6);
    expect(moved.rear.z - start.rear.z).toBeCloseTo(18);
  });

  it("keeps the cockpit seat attached to the turning vehicle while looking with the road", () => {
    const pose = resolveCockpitCameraPoses({
      x: 12,
      z: -5,
      vehicleHeading: Math.PI / 2,
      cameraHeading: Math.PI / 2 + 0.1,
      seatSide: 0.46,
      headBob: 0.03,
      quickLookAngle: -0.25,
    });

    expect(pose.first.x).toBeCloseTo(11.4);
    expect(pose.first.z).toBeCloseTo(-5.46);
    expect(pose.first.y).toBeCloseTo(1.52);
    expect(pose.first.rotationX).toBeCloseTo(0.12);
    expect(pose.first.rotationY).toBeCloseTo(Math.PI / 2 - 0.15);
    expect(pose.rear.x).toBeCloseTo(11.48);
    expect(pose.rear.rotationX).toBeCloseTo(0.04);
    expect(pose.rear.rotationY).toBeCloseTo(Math.PI / 2 + 0.1 + Math.PI);
  });

  it("keeps the saved cockpit FOV within the supported horizontal range", () => {
    expect(clampHorizontalFieldOfView(DEFAULT_HORIZONTAL_FOV)).toBe(
      DEFAULT_HORIZONTAL_FOV,
    );
    expect(clampHorizontalFieldOfView(0)).toBe(MIN_HORIZONTAL_FOV);
    expect(clampHorizontalFieldOfView(Math.PI)).toBe(MAX_HORIZONTAL_FOV);
  });

  it("keeps the road sightline stable across landscape aspect ratios", () => {
    expect(resolveCockpitPitch(1.6)).toBeCloseTo(0.1);
    expect(resolveCockpitPitch(2)).toBeCloseTo(0.12);
    expect(resolveCockpitPitch(2.2)).toBeCloseTo(0.12);
  });

  it("spins the steering wheel around its own column axis", () => {
    expect(resolveSteeringWheelSpin(0)).toBe(0);
    expect(resolveSteeringWheelSpin(1)).toBe(-MAX_STEERING_WHEEL_SPIN);
    expect(resolveSteeringWheelSpin(-1)).toBe(MAX_STEERING_WHEEL_SPIN);
    expect(resolveSteeringWheelSpin(4)).toBe(-MAX_STEERING_WHEEL_SPIN);
  });

  it("mirrors the cockpit without embedding the wheel behind the dashboard", () => {
    const left = resolveCockpitSteeringGeometry("left");
    const right = resolveCockpitSteeringGeometry("right");

    expect(left.x).toBe(-right.x);
    expect(left.y).toBe(right.y);
    expect(left.z).toBe(right.z);
    expect(left.mountRotationX).toBe(right.mountRotationX);

    const rimRadius = left.wheelDiameter / 2 + left.rimThickness / 2;
    const deepestRimPoint =
      left.z + Math.abs(Math.cos(left.mountRotationX)) * rimRadius;
    expect(deepestRimPoint).toBeLessThan(COCKPIT_DASH_DRIVER_Z);
    expect(Math.cos(left.mountRotationX)).toBeLessThan(0);
    expect(Math.sin(left.mountRotationX)).toBeGreaterThan(0);
  });
});

describe("adaptive GameCanvas input presentation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses capabilities only for its initial presentation and never treats controller presence as input", () => {
    const updates: AdaptiveInputPresentation[] = [];
    const router = new AdaptiveInputRouter(
      { touchFirst: false, hybridTouch: true },
      false,
      (presentation) => updates.push(presentation),
    );

    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchFirst: false,
      touchRevealed: false,
    });
    expect(updates).toHaveLength(0);

    router.registerMeaningfulInput("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchRevealed: true,
    });
    router.dispose();
  });

  it("debounces prompt switches but switches immediately when reduced motion is enabled", () => {
    vi.useFakeTimers();
    let now = 0;
    const router = new AdaptiveInputRouter(
      { touchFirst: false, hybridTouch: false },
      false,
      () => undefined,
      () => now,
    );

    router.registerMeaningfulInput("gamepad");
    expect(router.getPresentation().activeFamily).toBe("gamepad");

    now = 100;
    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation().activeFamily).toBe("gamepad");

    now = INPUT_PROMPT_SWITCH_COOLDOWN_MS;
    vi.advanceTimersByTime(INPUT_PROMPT_SWITCH_COOLDOWN_MS - 100);
    expect(router.getPresentation().activeFamily).toBe("keyboard");

    now += 1;
    router.registerMeaningfulInput("touch");
    router.setReducedMotion(true);
    expect(router.getPresentation().activeFamily).toBe("touch");
    router.dispose();
  });

  it("dims touch-first controls after non-touch use, restores them on touch, and falls back safely after a controller disconnect", () => {
    vi.useFakeTimers();
    let now = 0;
    const router = new AdaptiveInputRouter(
      { touchFirst: true, hybridTouch: false },
      false,
      () => undefined,
      () => now,
    );

    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchControlsDimmed: false,
    });
    vi.advanceTimersByTime(TOUCH_CONTROL_DIM_DELAY_MS);
    expect(router.getPresentation().touchControlsDimmed).toBe(true);

    now = TOUCH_CONTROL_DIM_DELAY_MS + 1;
    router.registerMeaningfulInput("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchControlsDimmed: false,
    });

    now += INPUT_PROMPT_SWITCH_COOLDOWN_MS;
    router.registerMeaningfulInput("gamepad");
    expect(router.getPresentation().activeFamily).toBe("gamepad");
    expect(router.handleGamepadDisconnect()).toBe("touch");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "touch",
      touchControlsDimmed: false,
    });
    router.dispose();
  });

  it("applies the touch-overlay fallback immediately when reduced motion is enabled", () => {
    const router = new AdaptiveInputRouter(
      { touchFirst: true, hybridTouch: false },
      true,
      () => undefined,
    );

    router.registerMeaningfulInput("keyboard");
    expect(router.getPresentation()).toMatchObject({
      activeFamily: "keyboard",
      touchControlsDimmed: true,
    });
    router.dispose();
  });
});
