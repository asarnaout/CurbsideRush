import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { createElevatedRoadGroundClearanceQuery } from "../app/game/geometry/elevatedRoadGeometry";
import { SimulationCore, type SimulationCoreConfig } from "../app/game/simulation";
import { RoadNetwork } from "../app/game/simulation/roadNetwork";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "../app/game/simulation/roadLevels";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";

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
    elevatedRoadGroundClearanceAt: (
      point,
      elevationM,
      radiusM,
      excludedSurfaceIds,
      minimumVerticalSeparationM,
    ) =>
      clearanceAt(
        point,
        elevationM,
        radiusM,
        false,
        excludedSurfaceIds,
        minimumVerticalSeparationM,
      ),
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

  it("filters the carrier before selecting the next stacked obstruction", () => {
    const carrier = {
      id: "test-stacked-carrier",
      centerline: [
        { x: 0, z: -10, elevationM: 1 },
        { x: 0, z: 10, elevationM: 1 },
      ],
      widthM: 6,
    } as const;
    const higherDeck = {
      id: "test-stacked-higher-deck",
      centerline: [
        { x: 0, z: -10, elevationM: 2 },
        { x: 0, z: 10, elevationM: 2 },
      ],
      widthM: 6,
    } as const;
    const clearanceAt = createElevatedRoadGroundClearanceQuery([
      carrier,
      higherDeck,
    ]);

    expect(clearanceAt({ x: 0, z: 0 }, 0, 0, false)?.surfaceId).toBe(
      carrier.id,
    );
    expect(
      clearanceAt(
        { x: 0, z: 0 },
        0,
        0,
        false,
        new Set([carrier.id]),
      ),
    ).toEqual(
      expect.objectContaining({
        surfaceId: higherDeck.id,
        obstructionKind: "deck",
        clearanceM: 1.38,
      }),
    );
  });

  it("treats a near-level ramp seam as pavement but retains a raised side wall", () => {
    const rampSurface = {
      id: "test-threshold-ramp",
      centerline: [
        { x: 0, z: -10, elevationM: 0 },
        { x: 0, z: 10, elevationM: 1 },
      ],
      widthM: 6,
    } as const;
    const clearanceAt = createElevatedRoadGroundClearanceQuery([rampSurface]);

    expect(
      clearanceAt(
        { x: 0, z: -4 },
        0,
        0,
        false,
        undefined,
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
      ),
    ).toBeNull();
    expect(
      clearanceAt(
        { x: 0, z: -2 },
        0,
        0,
        false,
        undefined,
        ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
      ),
    ).toEqual(
      expect.objectContaining({
        surfaceId: rampSurface.id,
        obstructionKind: "raised_surface",
        clearanceM: 0.4,
      }),
    );
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
            { x: -30, z: -2 },
            { x: 30, z: -2 },
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
      spawn: { x: -8, z: -2, heading: Math.PI / 2 },
      playerCapsuleHalfLengthM: 1,
      playerCapsuleRadiusM: 0.7,
      playerClearanceHeightM: 1.5,
      staticObstacles: [],
      elevatedRoadGroundClearanceAt: (
        point,
        elevationM,
        radiusM,
        excludedSurfaceIds,
        minimumVerticalSeparationM,
      ) =>
        clearanceAt(
          point,
          elevationM,
          radiusM,
          false,
          excludedSurfaceIds,
          minimumVerticalSeparationM,
        ),
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
      elevatedRoadGroundClearanceAt: (
        point,
        elevationM,
        radiusM,
        excludedSurfaceIds,
        minimumVerticalSeparationM,
      ) =>
        clearanceAt(
          point,
          elevationM,
          radiusM,
          false,
          excludedSurfaceIds,
          minimumVerticalSeparationM,
        ),
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

  it("keeps an exit ramp solid when a ground vehicle approaches it backward", () => {
    const exitRampSurface = {
      id: "test-directed-exit-ramp",
      centerline: [
        { x: -20, z: 0, elevationM: 2 },
        { x: 0, z: 0, elevationM: 0 },
      ],
      widthM: 4,
    } as const;
    const clearanceAt = createElevatedRoadGroundClearanceQuery([
      exitRampSurface,
    ]);
    const simulation = new SimulationCore({
      npcCount: 0,
      bounds: { minX: -30, maxX: 30, minZ: -10, maxZ: 10 },
      lanes: [
        {
          id: "directed-exit-ramp",
          roadId: exitRampSurface.id,
          points: exitRampSurface.centerline,
          successorLaneIds: ["exit-ground-slip"],
          width: 3.2,
          loop: false,
        },
        {
          id: "exit-ground-slip",
          roadId: "exit-ground-slip",
          points: [
            { x: 0, z: 0 },
            { x: 20, z: 0 },
          ],
          width: 3.2,
          loop: false,
        },
      ],
      spawn: { x: 8, z: 0, heading: -Math.PI / 2 },
      playerCapsuleHalfLengthM: 1,
      playerCapsuleRadiusM: 0.7,
      playerClearanceHeightM: 1.5,
      staticObstacles: [],
      elevatedRoadGroundClearanceAt: (
        point,
        elevationM,
        radiusM,
        excludedSurfaceIds,
        minimumVerticalSeparationM,
      ) =>
        clearanceAt(
          point,
          elevationM,
          radiusM,
          false,
          excludedSurfaceIds,
          minimumVerticalSeparationM,
        ),
    });
    const snapshot = driveForward(simulation, 300);
    const deckCollisions = simulation
      .getEvents()
      .filter((event) => event.evidence.obstacle === "roadDeck");

    expect(snapshot.player.x).toBeGreaterThan(-10);
    expect(snapshot.player.elevationM).toBeUndefined();
    expect(deckCollisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: expect.objectContaining({
            obstacleId: expect.stringContaining(
              "elevated-road-test-directed-exit-ramp",
            ),
          }),
        }),
      ]),
    );
  });

  const cairoFreeDrive = FREE_DRIVES.find(
    (freeDrive) => freeDrive.mapId === "cairo-central-nile",
  );
  if (!cairoFreeDrive) throw new Error("Cairo free drive is missing");
  const cairoCountry = getCountryProfile(cairoFreeDrive.countryId);
  const cairoMapPack = getMapPack(cairoFreeDrive.mapId);
  const cairoConfig = buildSimulationCoreConfig({
    scenario: buildFreeDriveScenario(cairoFreeDrive),
    mapPack: cairoMapPack,
    trafficSide: cairoCountry.trafficSide,
    speedUnit: cairoCountry.speedUnit,
  });
  const cairoSurfaces = cairoMapPack.geometry.roadSurfaces ?? [];
  const cairoRoadNetwork = new RoadNetwork(cairoConfig.lanes ?? [], [], []);

  it("keeps full vehicle headroom where the Corniche exit crosses beneath the mainline", () => {
    const exitSurfaceId =
      "cairo-sixth-october-bridge-corniche-exit";
    const mainlineSurfaceId = "cairo-sixth-october-bridge";
    const clearanceAt = createElevatedRoadGroundClearanceQuery(cairoSurfaces);
    const carrierSurfaceIds = new Set([exitSurfaceId]);
    let crossingSamples = 0;
    let minimumHeadroomM = Number.POSITIVE_INFINITY;

    for (const lane of cairoRoadNetwork.lanes) {
      if (
        lane.roadId !== exitSurfaceId ||
        !lane.id.endsWith("forward-1")
      ) {
        continue;
      }
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.25) {
        const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
        const obstruction = clearanceAt(
          point,
          point.elevationM ?? 0,
          1,
          false,
          carrierSurfaceIds,
          ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
        );
        if (obstruction?.surfaceId !== mainlineSurfaceId) continue;
        crossingSamples += 1;
        minimumHeadroomM = Math.min(
          minimumHeadroomM,
          obstruction.clearanceM,
        );
      }
    }

    expect(crossingSamples).toBeGreaterThan(20);
    // Production sedans require 1.50 m plus the simulation's 0.08 m margin.
    expect(minimumHeadroomM).toBeGreaterThanOrEqual(1.58);
  });

  it("drives the lane-centred Corniche exit trace beneath the mainline without a deck collision", () => {
    const crossingLane = cairoRoadNetwork.lanesById.get(
      "cairo-sixth-october-bridge-corniche-exit-3-forward-1",
    );
    if (!crossingLane) throw new Error("Missing Corniche exit crossing lane");
    const start = cairoRoadNetwork.pointOnLane(crossingLane, 7);
    const simulation = new SimulationCore({
      ...cairoConfig,
      npcCount: 0,
      staticObstacles: [],
    });
    simulation.setPlayerPose(start, 8);

    for (let tick = 0; tick < 120; tick += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.player.distanceTravelledM).toBeGreaterThan(20);
    expect(snapshot.road.laneId).toBe(crossingLane.id);
    expect(snapshot.road.distanceFromLaneCentreM).toBeLessThan(0.1);
    expect(
      simulation
        .getEvents()
        .filter((event) => event.evidence.obstacle === "roadDeck"),
    ).toEqual([]);
  });

  type TravelDirection = "forward" | "reverse";
  const cairoRampHandoffs = [
    {
      label: "Dokki entrance",
      approachSurfaceId: "cairo-sixth-october-dokki-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-dokki-ramp",
      outgoingDirection: "reverse" as TravelDirection,
    },
    {
      label: "Dokki exit",
      approachSurfaceId: "cairo-sixth-october-bridge-dokki-ramp",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-dokki-exit-slip",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Gezira entrance",
      approachSurfaceId: "cairo-sixth-october-gezira-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-gezira-ramp",
      outgoingDirection: "reverse" as TravelDirection,
    },
    {
      label: "Gezira exit",
      approachSurfaceId: "cairo-sixth-october-bridge-gezira-ramp",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-gezira-exit-slip",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Corniche entrance",
      approachSurfaceId: "cairo-sixth-october-corniche-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-corniche-entry",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Corniche exit",
      approachSurfaceId: "cairo-sixth-october-bridge-corniche-exit",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-corniche-exit-slip",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Ramses entrance",
      approachSurfaceId: "cairo-sixth-october-ramses-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-ramses-entry",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Ramses exit",
      approachSurfaceId: "cairo-sixth-october-bridge-ramses-exit",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-ramses-exit-slip",
      outgoingDirection: "forward" as TravelDirection,
    },
  ] as const;

  it.each(cairoRampHandoffs)(
    "does not mistake the connected $label profile/slip handoff for headroom",
    ({
      approachSurfaceId,
      approachDirection,
      outgoingSurfaceId,
      outgoingDirection,
    }) => {
      const directedPoints = (surfaceId: string, direction: TravelDirection) => {
        const surface = cairoSurfaces.find((candidate) => candidate.id === surfaceId);
        if (!surface) throw new Error(`Missing Cairo surface ${surfaceId}`);
        return direction === "forward"
          ? [...surface.centerline]
          : [...surface.centerline].reverse();
      };
      const approach = directedPoints(approachSurfaceId, approachDirection);
      const outgoing = directedPoints(outgoingSurfaceId, outgoingDirection);
      const lift = approach.at(-1);
      const beforeLift = approach.at(-2);
      const afterLift = outgoing.at(1);
      if (!lift || !beforeLift || !afterLift) {
        throw new Error(`Incomplete Cairo handoff ${approachSurfaceId}`);
      }
      expect(Math.hypot(lift.x - outgoing[0].x, lift.z - outgoing[0].z)).toBeLessThan(
        0.05,
      );

      const approachDx = lift.x - beforeLift.x;
      const approachDz = lift.z - beforeLift.z;
      const approachLengthM = Math.hypot(approachDx, approachDz);
      const approachUx = approachDx / approachLengthM;
      const approachUz = approachDz / approachLengthM;
      const startDistanceM = Math.min(8, approachLengthM / 2);
      const startAmount = startDistanceM / approachLengthM;
      const startElevationM =
        (lift.elevationM ?? 0) +
        ((beforeLift.elevationM ?? 0) - (lift.elevationM ?? 0)) * startAmount;

      const outgoingDx = afterLift.x - lift.x;
      const outgoingDz = afterLift.z - lift.z;
      const outgoingLengthM = Math.hypot(outgoingDx, outgoingDz);
      const outgoingUx = outgoingDx / outgoingLengthM;
      const outgoingUz = outgoingDz / outgoingLengthM;
      const simulation = new SimulationCore({
        ...cairoConfig,
        npcCount: 0,
        // This regression isolates the clearance query. Static scenery has its
        // own exhaustive collider tests and makes eight short traces needlessly
        // scan thousands of unrelated buildings per fixed step.
        staticObstacles: [],
      });
      simulation.setPlayerPose(
        {
          x: lift.x - approachUx * startDistanceM,
          z: lift.z - approachUz * startDistanceM,
          heading: Math.atan2(approachUx, approachUz),
          elevationM: startElevationM,
        },
        8,
      );

      let progressBeyondLiftM = Number.NEGATIVE_INFINITY;
      for (let tick = 0; tick < 120; tick += 1) {
        simulation.step(1 / 60, { throttle: 1 });
        const player = simulation.getSnapshot().player;
        progressBeyondLiftM =
          (player.x - lift.x) * outgoingUx + (player.z - lift.z) * outgoingUz;
        if (
          progressBeyondLiftM > 3 ||
          simulation
            .getEvents()
            .some((event) => event.evidence.obstacle === "roadDeck")
        ) {
          break;
        }
      }

      expect(
        simulation
          .getEvents()
          .filter((event) => event.evidence.obstacle === "roadDeck"),
      ).toEqual([]);
      expect(progressBeyondLiftM).toBeGreaterThan(3);
    },
  );
});
