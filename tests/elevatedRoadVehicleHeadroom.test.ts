import { describe, expect, it } from "vitest";
import { createElevatedRoadGroundClearanceQuery } from "../app/game/geometry/elevatedRoadGeometry";
import { SimulationCore, type SimulationCoreConfig } from "../app/game/simulation";

const crossingFixture = (
  deckElevationM: number,
  playerClearanceHeightM = 1.5,
): SimulationCore => {
  const elevatedSurface = {
    id: "test-crossing-deck",
    centerline: [
      { x: 0, z: -20, elevationM: deckElevationM },
      { x: 0, z: 20, elevationM: deckElevationM },
    ],
    widthM: 6,
  } as const;
  const clearanceAt = createElevatedRoadGroundClearanceQuery([
    elevatedSurface,
  ]);
  const config: SimulationCoreConfig = {
    npcCount: 0,
    bounds: { minX: -40, maxX: 40, minZ: -30, maxZ: 30 },
    lanes: [
      {
        id: "ground-through",
        roadId: "ground-through",
        points: [
          { x: -30, z: 0 },
          { x: 30, z: 0 },
        ],
        width: 3.2,
        loop: false,
      },
      {
        id: "test-crossing-deck-lane",
        roadId: elevatedSurface.id,
        points: elevatedSurface.centerline,
        width: 3.2,
        loop: false,
      },
    ],
    spawn: { x: -8, z: 0, heading: Math.PI / 2 },
    playerCapsuleHalfLengthM: 1,
    playerCapsuleRadiusM: 0.7,
    playerClearanceHeightM,
    staticObstacles: [],
    // Piers deliberately stay out of this query; their ordinary static circle
    // colliders remain the sole source of support collision response.
    elevatedRoadGroundClearanceAt: (point, elevationM, radiusM) =>
      clearanceAt(point, elevationM, radiusM, false),
  };
  return new SimulationCore(config);
};

const driveForward = (simulation: SimulationCore, ticks = 180) => {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.step(1 / 60, { throttle: 1 });
  }
  return simulation.getSnapshot();
};

describe("elevated-road vehicle headroom", () => {
  it("blocks a ground vehicle before its roof enters a low soffit", () => {
    // A 2.0 m deck has a ~1.38 m soffit after the authored 0.62 m slab.
    const simulation = crossingFixture(2);
    const snapshot = driveForward(simulation);

    expect(snapshot.player.x).toBeGreaterThan(-7);
    expect(snapshot.player.x).toBeLessThan(-4);
    expect(snapshot.player.elevationM).toBeUndefined();
    expect(simulation.getEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "collision",
          evidence: expect.objectContaining({
            obstacle: "roadDeck",
            clearanceM: 1.38,
          }),
        }),
      ]),
    );
  });

  it("keeps a high-clearance underpass driveable", () => {
    const simulation = crossingFixture(5);
    const snapshot = driveForward(simulation);

    expect(snapshot.player.x).toBeGreaterThan(8);
    expect(snapshot.player.elevationM).toBeUndefined();
    expect(
      simulation
        .getEvents()
        .some((event) => event.evidence.obstacle === "roadDeck"),
    ).toBe(false);
  });

  it("blocks lateral entry through the raised asphalt before the slab begins", () => {
    const rampSurface = {
      id: "test-low-apron",
      centerline: [
        { x: 0, z: -10, elevationM: 0 },
        { x: 0, z: 10, elevationM: 1 },
      ],
      widthM: 6,
    } as const;
    const clearanceAt = createElevatedRoadGroundClearanceQuery([rampSurface]);
    const simulation = new SimulationCore({
      npcCount: 0,
      bounds: { minX: -40, maxX: 40, minZ: -20, maxZ: 20 },
      lanes: [
        {
          id: "apron-ground-through",
          roadId: "apron-ground-through",
          points: [
            { x: -30, z: -4 },
            { x: 30, z: -4 },
          ],
          width: 3.2,
          loop: false,
        },
        {
          id: "apron-ramp-profile",
          roadId: rampSurface.id,
          points: rampSurface.centerline,
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: -8, z: -4, heading: Math.PI / 2 },
      playerCapsuleHalfLengthM: 1,
      playerCapsuleRadiusM: 0.7,
      playerClearanceHeightM: 1.5,
      staticObstacles: [],
      elevatedRoadGroundClearanceAt: (point, elevationM, radiusM) =>
        clearanceAt(point, elevationM, radiusM, false),
    });
    const snapshot = driveForward(simulation);

    expect(snapshot.player.x).toBeLessThan(-4);
    expect(snapshot.player.elevationM).toBeUndefined();
    expect(simulation.getEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "collision",
          evidence: expect.objectContaining({
            obstacleId: expect.stringContaining("raised_surface"),
          }),
        }),
      ]),
    );
  });

  it("does not mistake the player's own legal ramp for overhead structure", () => {
    const rampSurface = {
      id: "test-legal-ramp",
      centerline: [
        { x: -20, z: 0, elevationM: 0 },
        { x: 20, z: 0, elevationM: 4 },
      ],
      widthM: 4,
    } as const;
    const clearanceAt = createElevatedRoadGroundClearanceQuery([rampSurface]);
    const simulation = new SimulationCore({
      npcCount: 0,
      bounds: { minX: -40, maxX: 40, minZ: -20, maxZ: 20 },
      lanes: [
        {
          id: "ramp-approach",
          roadId: "ramp-approach",
          points: [
            { x: -30, z: 0 },
            { x: -20, z: 0 },
          ],
          successorLaneIds: ["ramp-profile"],
          width: 3.2,
          loop: false,
        },
        {
          id: "ramp-profile",
          roadId: rampSurface.id,
          points: rampSurface.centerline,
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: -26, z: 0, heading: Math.PI / 2 },
      playerCapsuleHalfLengthM: 1,
      playerCapsuleRadiusM: 0.7,
      playerClearanceHeightM: 1.5,
      staticObstacles: [],
      elevatedRoadGroundClearanceAt: (point, elevationM, radiusM) =>
        clearanceAt(point, elevationM, radiusM, false),
    });
    const snapshot = driveForward(simulation, 240);

    expect(snapshot.player.x).toBeGreaterThan(0);
    expect(snapshot.player.elevationM ?? 0).toBeGreaterThan(2);
    expect(
      simulation
        .getEvents()
        .some((event) => event.evidence.obstacle === "roadDeck"),
    ).toBe(false);
  });
});
