import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { getCareerVehicle } from "../app/game/career";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { createElevatedRoadGroundClearanceQuery } from "../app/game/geometry/elevatedRoadGeometry";
import { SimulationCore, type SimulationCoreConfig } from "../app/game/simulation";
import { RoadNetwork } from "../app/game/simulation/roadNetwork";
import { ELEVATED_ROAD_STRUCTURE_THRESHOLD_M } from "../app/game/simulation/roadLevels";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import { VEHICLE_DIMENSIONS } from "../app/game/vehicleVisuals";

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
  const deliveryVan = getCareerVehicle("delivery-van");
  const deliveryVanClearanceHeightM =
    VEHICLE_DIMENSIONS["delivery-van"].height;
  const deliveryVanRequiredHeadroomM = deliveryVanClearanceHeightM + 0.08;

  it("steps the delivery-van roof through every Cairo bridge and access-lane profile", { timeout: 90_000 }, () => {
    const simulation = new SimulationCore({
      ...cairoConfig,
      ...deliveryVan.physics,
      playerClearanceHeightM: deliveryVanClearanceHeightM,
      npcCount: 0,
      staticObstacles: [],
      trafficLights: [],
      stopLines: [],
    });
    const failures: string[] = [];
    let samples = 0;

    for (const lane of cairoRoadNetwork.lanes.filter(
      (candidate) =>
        candidate.roadId?.includes("sixth-october") &&
        (candidate.id.endsWith("-forward-1") ||
          candidate.id.endsWith("-reverse-1")),
    )) {
      // A 15 m/s fixed step advances just under 25 cm after drag. Half-metre
      // starts still overlap through the delivery van's three-disc roof
      // envelope, while keeping this production-core sweep practical. Each
      // prospective roof interval is entered from its clear side; merely
      // teleporting onto the profile would never exercise that path.
      for (let distanceM = 0; distanceM + 0.3 < lane.length; distanceM += 0.5) {
        const start = cairoRoadNetwork.pointOnLane(lane, distanceM);
        const ahead = cairoRoadNetwork.pointOnLane(lane, distanceM + 0.3);
        const heading = Math.atan2(ahead.x - start.x, ahead.z - start.z);
        simulation.setPlayerPose(
          {
            x: start.x,
            z: start.z,
            elevationM: start.elevationM ?? 0,
            heading,
          },
          15,
        );
        simulation.drainEvents();
        simulation.step(1 / 60);
        samples += 1;
        const deckCollision = simulation
          .drainEvents()
          .find((event) => event.evidence.obstacle === "roadDeck");
        if (deckCollision) {
          failures.push(
            `${lane.id} at ${distanceM.toFixed(1)}m: ${String(
              deckCollision.evidence.obstacleId,
            )} (${String(deckCollision.evidence.clearanceM)}m < ${String(
              deckCollision.evidence.requiredClearanceM,
            )}m)`,
          );
        }
      }
    }

    expect(samples).toBeGreaterThan(9_000);
    expect(failures.slice(0, 25)).toEqual([]);
  });

  it("keeps both Al Saraya host lanes clear beneath the complete Gezira entry slab", () => {
    const clearanceAt = createElevatedRoadGroundClearanceQuery(cairoSurfaces);
    const sarayaLanes = cairoRoadNetwork.lanes.filter(
      (lane) => lane.roadId === "cairo-saray-el-gezira",
    );
    const failures: string[] = [];
    let samples = 0;
    let minimumObservedHeadroomM = Number.POSITIVE_INFINITY;

    for (const lane of sarayaLanes) {
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.1) {
        const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
        for (const alongM of [
          -deliveryVan.physics.playerCapsuleHalfLengthM,
          0,
          deliveryVan.physics.playerCapsuleHalfLengthM,
        ]) {
          const roofSample = {
            x: point.x + Math.sin(point.heading) * alongM,
            z: point.z + Math.cos(point.heading) * alongM,
          };
          const obstruction = clearanceAt(
            roofSample,
            0,
            deliveryVan.physics.playerCapsuleRadiusM,
            false,
            undefined,
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
          );
          samples += 1;
          if (obstruction) {
            minimumObservedHeadroomM = Math.min(
              minimumObservedHeadroomM,
              obstruction.clearanceM,
            );
          }
          if (
            obstruction &&
            obstruction.clearanceM < deliveryVanRequiredHeadroomM
          ) {
            failures.push(
              `${lane.id} at ${distanceM.toFixed(1)}m: ${obstruction.surfaceId} leaves ${obstruction.clearanceM.toFixed(3)}m`,
            );
          }
        }
      }
    }

    expect(samples).toBeGreaterThan(50_000);
    expect(
      failures.slice(0, 25),
      `Every lane-centred delivery-van roof disc needs ${deliveryVanRequiredHeadroomM.toFixed(2)}m under the Gezira approach`,
    ).toEqual([]);
    expect(minimumObservedHeadroomM).toBeGreaterThanOrEqual(
      deliveryVanRequiredHeadroomM + 0.25,
    );
  });

  it("keeps both Corniche through lanes clear of the northbound entry structure", () => {
    const entrySurfaceId =
      "cairo-sixth-october-bridge-corniche-entry";
    const clearanceAt = createElevatedRoadGroundClearanceQuery(cairoSurfaces);
    const throughLaneIds = [
      "cairo-corniche-el-nil-7-forward-1",
      "cairo-corniche-el-nil-7-reverse-1",
    ] as const;
    const failures: string[] = [];
    let samples = 0;
    let entryObstructionSamples = 0;

    for (const laneId of throughLaneIds) {
      const lane = cairoRoadNetwork.lanesById.get(laneId);
      if (!lane) throw new Error(`Missing Corniche through lane ${laneId}`);
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.1) {
        const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
        for (const alongM of [
          -deliveryVan.physics.playerCapsuleHalfLengthM,
          0,
          deliveryVan.physics.playerCapsuleHalfLengthM,
        ]) {
          const roofSample = {
            x: point.x + Math.sin(point.heading) * alongM,
            z: point.z + Math.cos(point.heading) * alongM,
          };
          const obstruction = clearanceAt(
            roofSample,
            0,
            deliveryVan.physics.playerCapsuleRadiusM,
            false,
            undefined,
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
          );
          samples += 1;
          if (obstruction?.surfaceId === entrySurfaceId) {
            entryObstructionSamples += 1;
          }
          if (
            obstruction &&
            obstruction.clearanceM < deliveryVanRequiredHeadroomM
          ) {
            failures.push(
              `${lane.id} at ${distanceM.toFixed(1)}m: ${obstruction.surfaceId} leaves ${obstruction.clearanceM.toFixed(3)}m`,
            );
          }
        }
      }
    }

    expect(samples).toBeGreaterThan(10_000);
    expect(
      entryObstructionSamples,
      "The Corniche entrance must turn from its auxiliary lane without covering either through lane",
    ).toBe(0);
    expect(
      failures.slice(0, 25),
      `Every Corniche through-lane roof disc needs ${deliveryVanRequiredHeadroomM.toFixed(2)}m beneath the bridge network`,
    ).toEqual([]);
  });

  it("keeps the Corniche entry vehicle envelope out from beneath the parent deck", () => {
    const entrySurfaceId =
      "cairo-sixth-october-bridge-corniche-entry";
    const mainlineSurfaceId = "cairo-sixth-october-bridge";
    const clearanceAt = createElevatedRoadGroundClearanceQuery(cairoSurfaces);
    const ownSurface = new Set([entrySurfaceId]);
    const failures: string[] = [];
    let samples = 0;

    // The shoulder slabs intentionally converge near deck height so the gore
    // has no hole. What must never happen is the driven vehicle envelope
    // passing beneath the mainline with only partial-height clearance.
    for (const lane of cairoRoadNetwork.lanes) {
      if (
        lane.roadId !== entrySurfaceId ||
        !lane.id.endsWith("forward-1")
      ) {
        continue;
      }
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.1) {
        const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
        for (const alongM of [
          -deliveryVan.physics.playerCapsuleHalfLengthM,
          0,
          deliveryVan.physics.playerCapsuleHalfLengthM,
        ]) {
          const roofSample = {
            x: point.x + Math.sin(point.heading) * alongM,
            z: point.z + Math.cos(point.heading) * alongM,
          };
          const obstruction = clearanceAt(
            roofSample,
            point.elevationM ?? 0,
            deliveryVan.physics.playerCapsuleRadiusM,
            false,
            ownSurface,
            0,
          );
          samples += 1;
          if (
            obstruction?.surfaceId === mainlineSurfaceId &&
            obstruction.clearanceM > ELEVATED_ROAD_STRUCTURE_THRESHOLD_M &&
            obstruction.clearanceM < deliveryVanRequiredHeadroomM
          ) {
            failures.push(
              `${lane.id} at ${distanceM.toFixed(1)}m passes ${obstruction.clearanceM.toFixed(3)}m beneath the parent deck`,
            );
          }
        }
      }
    }

    expect(samples).toBeGreaterThan(3_000);
    expect(
      failures.slice(0, 25),
      "The rising entry's full vehicle envelope must not pass beneath the mainline before the near-level gore convergence",
    ).toEqual([]);
  });

  it("keeps full delivery-van headroom where the Corniche exit crosses beneath the mainline", () => {
    const exitSurfaceId =
      "cairo-sixth-october-bridge-corniche-exit";
    const mainlineSurfaceId = "cairo-sixth-october-bridge";
    const exitSurface = cairoSurfaces.find(
      (surface) => surface.id === exitSurfaceId,
    );
    if (!exitSurface) throw new Error("Missing Corniche exit surface");
    // The exit is a true deck-height diverge. Its descent begins only after
    // the throat has carried the whole vehicle laterally clear of mainline.
    const throat = cairoMapPack.laneGraph.nodes.find(
      (node) => node.id === "cairo-sixth-corniche-exit-throat",
    )?.position;
    if (!throat) throw new Error("Missing Corniche exit throat node");
    const throatIndex = exitSurface.centerline.findIndex(
      (point) => Math.hypot(point.x - throat.x, point.z - throat.z) < 0.001,
    );
    expect(throatIndex).toBeGreaterThan(0);
    expect(
      exitSurface.centerline
        .slice(0, throatIndex + 1)
        .every((point) => point.elevationM === 10.5),
    ).toBe(true);
    expect(exitSurface.centerline[throatIndex + 1]?.elevationM).toBeLessThan(
      10.5,
    );

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
        for (const alongM of [
          -deliveryVan.physics.playerCapsuleHalfLengthM,
          0,
          deliveryVan.physics.playerCapsuleHalfLengthM,
        ]) {
          const roofSample = {
            x: point.x + Math.sin(point.heading) * alongM,
            z: point.z + Math.cos(point.heading) * alongM,
          };
          const obstruction = clearanceAt(
            roofSample,
            point.elevationM ?? 0,
            deliveryVan.physics.playerCapsuleRadiusM,
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
    }

    expect(crossingSamples).toBeGreaterThan(20);
    expect(minimumHeadroomM).toBeGreaterThanOrEqual(
      deliveryVanRequiredHeadroomM,
    );
  });

  it("drives a delivery van beneath the mainline on the lane-centred Corniche exit trace", () => {
    const crossingLane = cairoRoadNetwork.lanesById.get(
      "cairo-sixth-october-bridge-corniche-exit-3-forward-1",
    );
    if (!crossingLane) throw new Error("Missing Corniche exit crossing lane");
    const start = cairoRoadNetwork.pointOnLane(crossingLane, 3);
    const simulation = new SimulationCore({
      ...cairoConfig,
      ...deliveryVan.physics,
      playerClearanceHeightM: deliveryVanClearanceHeightM,
      npcCount: 0,
      staticObstacles: [],
    });
    simulation.setPlayerPose(start, 8);

    for (let tick = 0; tick < 80; tick += 1) {
      simulation.step(1 / 60, { throttle: 1 });
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.player.distanceTravelledM).toBeGreaterThan(12);
    expect(snapshot.road.laneId).toBe(crossingLane.id);
    expect(snapshot.road.offRoad).toBe(false);
    expect(snapshot.road.distanceFromLaneCentreM).toBeLessThanOrEqual(
      crossingLane.width / 2 - deliveryVan.physics.playerCapsuleRadiusM,
    );
    expect(
      simulation
        .getEvents()
        .filter((event) =>
          ["roadDeck", "roadBarrier"].includes(
            String(event.evidence.obstacle),
          ),
        ),
    ).toEqual([]);
  });

  it("keeps the natural Gezira entrance tangent on its rising ramp", () => {
    const approach = cairoRoadNetwork.lanesById.get(
      "cairo-sixth-october-gezira-entry-slip-2-forward-1",
    );
    const rising = cairoRoadNetwork.lanesById.get(
      "cairo-sixth-october-bridge-gezira-entry-1-forward-1",
    );
    if (!approach || !rising) {
      throw new Error("Missing Gezira entrance handoff lanes");
    }
    expect(approach.successorLaneIds).toContain(rising.id);

    // Keep the driver's incoming tangent through the first physical seam.
    // The entrance is now intentionally split into a rising slip, smooth
    // entry curve, and bridge-height carrier; every seam is checked below.
    const simulation = new SimulationCore({
      ...cairoConfig,
      npcCount: 0,
      staticObstacles: [],
    });
    const start = cairoRoadNetwork.pointOnLane(
      approach,
      Math.max(0, approach.length - 8),
    );
    simulation.setPlayerPose(start, 8);

    for (
      let tick = 0;
      tick < 160 &&
      simulation.getSnapshot().player.distanceTravelledM <= 12 &&
      !simulation
        .getEvents()
        .some((event) => event.evidence.obstacle === "roadDeck");
      tick += 1
    ) {
      simulation.step(1 / 60, { throttle: 1 });
    }

    const snapshot = simulation.getSnapshot();
    expect(
      simulation
        .getEvents()
        .filter((event) => event.evidence.obstacle === "roadDeck"),
    ).toEqual([]);
    expect(snapshot.player.distanceTravelledM).toBeGreaterThan(12);
    expect(snapshot.road.laneId).toBe(rising.id);
    expect(
      cairoRoadNetwork.pointOnLane(rising, Math.min(15, rising.length))
        .elevationM ?? 0,
    ).toBeGreaterThan(0.5);
  });

  type TravelDirection = "forward" | "reverse";
  const cairoRampHandoffs = [
    {
      label: "Dokki entrance slip",
      approachSurfaceId: "cairo-sixth-october-dokki-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-dokki-entry",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Dokki entrance braid",
      approachSurfaceId: "cairo-sixth-october-bridge-dokki-entry",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-dokki-ramp",
      outgoingDirection: "reverse" as TravelDirection,
    },
    {
      label: "Dokki exit braid",
      approachSurfaceId: "cairo-sixth-october-bridge-dokki-ramp",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-dokki-exit",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Dokki exit slip",
      approachSurfaceId: "cairo-sixth-october-bridge-dokki-exit",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-dokki-exit-slip",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Gezira entrance slip",
      approachSurfaceId: "cairo-sixth-october-gezira-entry-slip",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-gezira-entry",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Gezira entrance braid",
      approachSurfaceId: "cairo-sixth-october-bridge-gezira-entry",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-gezira-ramp",
      outgoingDirection: "reverse" as TravelDirection,
    },
    {
      label: "Gezira exit braid",
      approachSurfaceId: "cairo-sixth-october-bridge-gezira-ramp",
      approachDirection: "forward" as TravelDirection,
      outgoingSurfaceId: "cairo-sixth-october-bridge-gezira-exit",
      outgoingDirection: "forward" as TravelDirection,
    },
    {
      label: "Gezira exit slip",
      approachSurfaceId: "cairo-sixth-october-bridge-gezira-exit",
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
      // Resolve the actual directed graph edge rather than assuming every
      // access joins at a surface endpoint. Dokki's entrance now joins the
      // middle of its safely splayed two-way stem, which is exactly the sort
      // of topology this test must follow instead of reconstructing from a
      // hand-authored point order.
      const approachLane = cairoRoadNetwork.lanes.find(
        (lane) =>
          lane.roadId === approachSurfaceId &&
          lane.id.includes(`-${approachDirection}-`) &&
          lane.successorLaneIds.some((successorId) => {
            const successor = cairoRoadNetwork.lanesById.get(successorId);
            return (
              successor?.roadId === outgoingSurfaceId &&
              successor.id.includes(`-${outgoingDirection}-`)
            );
          }),
      );
      const outgoingLane = approachLane?.successorLaneIds
        .map((successorId) => cairoRoadNetwork.lanesById.get(successorId))
        .find(
          (lane) =>
            lane?.roadId === outgoingSurfaceId &&
            lane.id.includes(`-${outgoingDirection}-`),
        );
      if (!approachLane || !outgoingLane) {
        throw new Error(
          `Missing directed Cairo handoff ${approachSurfaceId} -> ${outgoingSurfaceId}`,
        );
      }
      const lift = approachLane.points.at(-1);
      const beforeLift = approachLane.points.at(-2);
      const afterLift = outgoingLane.points.at(1);
      if (!lift || !beforeLift || !afterLift) {
        throw new Error(`Incomplete Cairo handoff ${approachSurfaceId}`);
      }
      expect(
        Math.hypot(
          lift.x - outgoingLane.points[0].x,
          lift.z - outgoingLane.points[0].z,
        ),
      ).toBeLessThan(0.05);

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
