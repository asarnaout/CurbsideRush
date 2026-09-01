import { describe, expect, it } from "vitest";
import {
  FREE_DRIVES,
  getCountryProfile,
  getMapPack,
} from "../app/game/content";
import { CAREER_VEHICLES, getCareerVehicle } from "../app/game/career";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { createElevatedRoadGroundClearanceQuery } from "../app/game/geometry/elevatedRoadGeometry";
import {
  SimulationCore,
  type SimulationCoreConfig,
} from "../app/game/simulation";
import {
  RoadNetwork,
  type NormalizedLane,
} from "../app/game/simulation/roadNetwork";
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
  const clearanceAt = createElevatedRoadGroundClearanceQuery([elevatedSurface]);
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
      clearanceAt({ x: 0, z: 0 }, 0, 0, false, new Set([carrier.id])),
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

  it("lets the player climb an exit ramp backward without an invisible deck collision", () => {
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
    const elevationsM: number[] = [];
    for (
      let tick = 0;
      tick < 360 && simulation.getSnapshot().player.x > -12;
      tick += 1
    ) {
      simulation.step(1 / 60, { throttle: 1 });
      elevationsM.push(simulation.getSnapshot().player.elevationM ?? 0);
    }
    const snapshot = simulation.getSnapshot();
    const deckCollisions = simulation
      .getEvents()
      .filter((event) => event.evidence.obstacle === "roadDeck");

    expect(snapshot.player.x).toBeLessThanOrEqual(-12);
    expect(snapshot.player.elevationM ?? 0).toBeGreaterThanOrEqual(1.2);
    expect(snapshot.road.laneId).toBe("directed-exit-ramp");
    expect(snapshot.road.wrongWay).toBe(true);
    expect(
      elevationsM
        .slice(1)
        .every((elevationM, index) => elevationM + 1e-6 >= elevationsM[index]),
      "the car must follow the ramp profile instead of blending back into it",
    ).toBe(true);
    expect(deckCollisions).toEqual([]);
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
  const tokyoFreeDrive = FREE_DRIVES.find(
    (freeDrive) => freeDrive.mapId === "tokyo-setagaya",
  );
  if (!tokyoFreeDrive) throw new Error("Tokyo free drive is missing");
  const tokyoCountry = getCountryProfile(tokyoFreeDrive.countryId);
  const tokyoMapPack = getMapPack(tokyoFreeDrive.mapId);
  const tokyoConfig = buildSimulationCoreConfig({
    scenario: buildFreeDriveScenario(tokyoFreeDrive),
    mapPack: tokyoMapPack,
    trafficSide: tokyoCountry.trafficSide,
    speedUnit: tokyoCountry.speedUnit,
  });
  const tokyoSurfaces = tokyoMapPack.geometry.roadSurfaces ?? [];
  const tokyoRoadNetwork = new RoadNetwork(tokyoConfig.lanes ?? [], [], []);
  const deliveryVan = getCareerVehicle("delivery-van");
  const deliveryVanClearanceHeightM = VEHICLE_DIMENSIONS["delivery-van"].height;
  const deliveryVanRequiredHeadroomM = deliveryVanClearanceHeightM + 0.08;

  it(
    "sweeps every career vehicle's full paved envelope through every Cairo Sixth October access profile",
    { timeout: 150_000 },
    () => {
      const accessSurfaces = cairoSurfaces.filter(
        (surface) =>
          surface.id.includes("sixth-october") &&
          Math.max(
            ...surface.centerline.map((point) => point.elevationM ?? 0),
          ) > 0 &&
          surface.id !== "cairo-sixth-october-bridge",
      );
      const surfaceSampler = new RoadNetwork(
        accessSurfaces.map((surface) => ({
          id: `sweep-${surface.id}`,
          roadId: surface.id,
          points: surface.centerline,
          width: surface.widthM,
          loop: false,
        })),
        [],
        [],
      );
      const surfacesById = new Map(
        accessSurfaces.map((surface) => [surface.id, surface]),
      );
      const failures: string[] = [];
      let samples = 0;

      for (const vehicle of CAREER_VEHICLES) {
        const playerClearanceHeightM = (() => {
          if (vehicle.visualKind === "bicycle") return 1.85;
          if (vehicle.visualKind === "motorbike") return 1.8;
          if (vehicle.model) return VEHICLE_DIMENSIONS[vehicle.model].height;
          throw new Error(
            `Missing rendered clearance height for ${vehicle.id}`,
          );
        })();
        const simulation = new SimulationCore({
          ...cairoConfig,
          ...vehicle.physics,
          playerClearanceHeightM,
          npcCount: 0,
        });

        for (const samplingLane of surfaceSampler.lanes) {
          const surface = samplingLane.roadId
            ? surfacesById.get(samplingLane.roadId)
            : undefined;
          if (!surface) {
            throw new Error(`Missing sampled surface for ${samplingLane.id}`);
          }
          const maximumLateralOffsetM = Math.max(
            0,
            surface.widthM / 2 - vehicle.physics.playerCapsuleRadiusM,
          );
          const lateralOffsetsM =
            maximumLateralOffsetM > 0.01
              ? [-maximumLateralOffsetM, 0, maximumLateralOffsetM]
              : [0];

          // At 15 m/s one fixed step advances less than 0.25 m. Stations
          // 0.75 m apart therefore overlap through every vehicle's front/rear
          // capsule discs, while the lateral tracks cover both usable pavement
          // edges and centre. Each station is entered in both headings.
          for (
            let distanceM = 0;
            distanceM + 0.3 < samplingLane.length;
            distanceM += 0.75
          ) {
            const centre = surfaceSampler.pointOnLane(samplingLane, distanceM);
            const ahead = surfaceSampler.pointOnLane(
              samplingLane,
              distanceM + 0.3,
            );
            const authoredHeading = Math.atan2(
              ahead.x - centre.x,
              ahead.z - centre.z,
            );

            for (const lateralOffsetM of lateralOffsetsM) {
              const x = centre.x + Math.cos(authoredHeading) * lateralOffsetM;
              const z = centre.z - Math.sin(authoredHeading) * lateralOffsetM;
              for (const reversePhysicalHeading of [false, true] as const) {
                const heading =
                  authoredHeading + (reversePhysicalHeading ? Math.PI : 0);
                simulation.setPlayerPose(
                  {
                    x,
                    z,
                    elevationM: centre.elevationM ?? 0,
                    heading,
                  },
                  Math.min(15, vehicle.physics.maxForwardSpeedMps),
                );
                simulation.drainEvents();
                const snapshot = simulation.step(1 / 60);
                samples += 1;
                const collision = simulation
                  .drainEvents()
                  .find((event) => event.code === "collision");
                if (!collision) continue;

                failures.push(
                  `${vehicle.id} on ${surface.id} (${snapshot.road.laneId ?? "no projected lane"}) at ${distanceM.toFixed(2)}m, lateral ${lateralOffsetM.toFixed(2)}m, ${
                    reversePhysicalHeading ? "reverse" : "forward"
                  } heading: ${String(
                    collision.evidence.obstacle ?? "unknown obstacle",
                  )}/${String(
                    collision.evidence.obstacleId ?? "unknown id",
                  )} (${collision.correction})`,
                );
              }
            }
          }
        }
      }

      expect(accessSurfaces).toHaveLength(17);
      expect(samples).toBeGreaterThan(85_000);
      expect(
        failures.slice(0, 25),
        `${failures.length} production collider contacts across the Sixth October paved envelope:\n${failures
          .slice(0, 25)
          .join("\n")}`,
      ).toEqual([]);
    },
  );

  it(
    "sweeps every career vehicle's full paved envelope through every Tokyo Sakuragawa access profile",
    { timeout: 150_000 },
    () => {
      const accessSurfaces = tokyoSurfaces.filter(
        (surface) =>
          surface.id.includes("sakuragawa-urban-expressway") &&
          Math.max(
            ...surface.centerline.map((point) => point.elevationM ?? 0),
          ) > 0 &&
          !surface.id.endsWith("-mainline"),
      );
      const surfaceSampler = new RoadNetwork(
        accessSurfaces.map((surface) => ({
          id: `sweep-${surface.id}`,
          roadId: surface.id,
          points: surface.centerline,
          width: surface.widthM,
          loop: false,
        })),
        [],
        [],
      );
      const surfacesById = new Map(
        accessSurfaces.map((surface) => [surface.id, surface]),
      );
      const failures: string[] = [];
      let samples = 0;

      for (const vehicle of CAREER_VEHICLES) {
        const playerClearanceHeightM = (() => {
          if (vehicle.visualKind === "bicycle") return 1.85;
          if (vehicle.visualKind === "motorbike") return 1.8;
          if (vehicle.model) return VEHICLE_DIMENSIONS[vehicle.model].height;
          throw new Error(
            `Missing rendered clearance height for ${vehicle.id}`,
          );
        })();
        const simulation = new SimulationCore({
          ...tokyoConfig,
          ...vehicle.physics,
          playerClearanceHeightM,
          npcCount: 0,
        });

        for (const samplingLane of surfaceSampler.lanes) {
          const surface = samplingLane.roadId
            ? surfacesById.get(samplingLane.roadId)
            : undefined;
          if (!surface) {
            throw new Error(`Missing sampled surface for ${samplingLane.id}`);
          }
          const maximumLateralOffsetM = Math.max(
            0,
            surface.widthM / 2 - vehicle.physics.playerCapsuleRadiusM,
          );
          const lateralOffsetsM =
            maximumLateralOffsetM > 0.01
              ? [-maximumLateralOffsetM, 0, maximumLateralOffsetM]
              : [0];

          for (
            let distanceM = 0;
            distanceM + 0.3 < samplingLane.length;
            distanceM += 0.75
          ) {
            const centre = surfaceSampler.pointOnLane(samplingLane, distanceM);
            const ahead = surfaceSampler.pointOnLane(
              samplingLane,
              distanceM + 0.3,
            );
            const authoredHeading = Math.atan2(
              ahead.x - centre.x,
              ahead.z - centre.z,
            );

            for (const lateralOffsetM of lateralOffsetsM) {
              const x = centre.x + Math.cos(authoredHeading) * lateralOffsetM;
              const z = centre.z - Math.sin(authoredHeading) * lateralOffsetM;
              for (const reversePhysicalHeading of [false, true] as const) {
                const heading =
                  authoredHeading + (reversePhysicalHeading ? Math.PI : 0);
                simulation.setPlayerPose(
                  {
                    x,
                    z,
                    elevationM: centre.elevationM ?? 0,
                    heading,
                  },
                  Math.min(15, vehicle.physics.maxForwardSpeedMps),
                );
                simulation.drainEvents();
                const snapshot = simulation.step(1 / 60);
                samples += 1;
                const collision = simulation
                  .drainEvents()
                  .find((event) => event.code === "collision");
                if (!collision) continue;

                failures.push(
                  `${vehicle.id} on ${surface.id} (${snapshot.road.laneId ?? "no projected lane"}) at ${distanceM.toFixed(2)}m, lateral ${lateralOffsetM.toFixed(2)}m, ${
                    reversePhysicalHeading ? "reverse" : "forward"
                  } heading: ${String(
                    collision.evidence.obstacle ?? "unknown obstacle",
                  )}/${String(
                    collision.evidence.obstacleId ?? "unknown id",
                  )} (${collision.correction})`,
                );
              }
            }
          }
        }
      }

      expect(accessSurfaces).toHaveLength(12);
      expect(samples).toBeGreaterThan(45_000);
      expect(
        failures.slice(0, 25),
        `${failures.length} production collider contacts across the Sakuragawa paved envelope:\n${failures
          .slice(0, 25)
          .join("\n")}`,
      ).toEqual([]);
    },
  );

  it("keeps every ordinary Tokyo lane open beneath the complete Sakuragawa structures", () => {
    const clearanceAt = createElevatedRoadGroundClearanceQuery(tokyoSurfaces);
    const failures: string[] = [];
    let samples = 0;

    for (const lane of tokyoRoadNetwork.lanes) {
      if (!lane.roadId || lane.roadId.includes("sakuragawa-urban-expressway")) {
        continue;
      }
      for (let distanceM = 0; distanceM <= lane.length; distanceM += 0.5) {
        const point = tokyoRoadNetwork.pointOnLane(lane, distanceM);
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
            new Set([lane.roadId]),
            ELEVATED_ROAD_STRUCTURE_THRESHOLD_M,
          );
          samples += 1;
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

    expect(samples).toBeGreaterThan(100_000);
    expect(
      failures.slice(0, 25),
      `Every ordinary-road roof disc needs ${deliveryVanRequiredHeadroomM.toFixed(2)}m beneath the Sakuragawa network`,
    ).toEqual([]);
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
    const entrySurfaceId = "cairo-sixth-october-bridge-corniche-entry";
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
    const entrySurfaceId = "cairo-sixth-october-bridge-corniche-entry";
    const mainlineSurfaceId = "cairo-sixth-october-bridge";
    const clearanceAt = createElevatedRoadGroundClearanceQuery(cairoSurfaces);
    const ownSurface = new Set([entrySurfaceId]);
    const failures: string[] = [];
    let samples = 0;

    // The shoulder slabs intentionally converge near deck height so the gore
    // has no hole. What must never happen is the driven vehicle envelope
    // passing beneath the mainline with only partial-height clearance.
    for (const lane of cairoRoadNetwork.lanes) {
      if (lane.roadId !== entrySurfaceId || !lane.id.endsWith("forward-1")) {
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
    const exitSurfaceId = "cairo-sixth-october-bridge-corniche-exit";
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
      if (lane.roadId !== exitSurfaceId || !lane.id.endsWith("forward-1")) {
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
          minimumHeadroomM = Math.min(minimumHeadroomM, obstruction.clearanceM);
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
          ["roadDeck", "roadBarrier"].includes(String(event.evidence.obstacle)),
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

  const cairoBridgeMouthNames = [
    "west",
    "east",
    "dokki",
    "gezira",
    "corniche",
    "ramses",
  ] as const;
  const cairoGroundHandoffLane = (roadId: string) => {
    const lane = cairoRoadNetwork.lanes.find((candidate) => {
      if (candidate.roadId !== roadId || !candidate.id.includes("-forward-")) {
        return false;
      }
      const elevationsM = [
        candidate.points[0]?.elevationM ?? 0,
        candidate.points.at(-1)?.elevationM ?? 0,
      ];
      return Math.min(...elevationsM) < 0.01 && Math.max(...elevationsM) > 0.5;
    });
    if (!lane) throw new Error(`Missing ground handoff lane for ${roadId}`);
    return lane;
  };

  type CairoPhysicalRoutePoint = {
    readonly x: number;
    readonly z: number;
    readonly elevationM: number;
    readonly heading: number;
    readonly physicalLaneId: string;
  };

  const buildCairoPhysicalRoute = (
    legs: readonly {
      readonly lane: NormalizedLane;
      readonly startDistanceM: number;
      readonly endDistanceM: number;
    }[],
    sampleSpacingM = 0.5,
  ): CairoPhysicalRoutePoint[] => {
    const sampled: Omit<CairoPhysicalRoutePoint, "heading">[] = [];
    const append = (lane: NormalizedLane, distanceM: number): void => {
      const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
      const previous = sampled.at(-1);
      if (
        previous &&
        Math.hypot(previous.x - point.x, previous.z - point.z) < 0.01
      ) {
        return;
      }
      sampled.push({
        x: point.x,
        z: point.z,
        elevationM: point.elevationM ?? 0,
        physicalLaneId: lane.id,
      });
    };

    for (const { lane, startDistanceM, endDistanceM } of legs) {
      const direction = endDistanceM >= startDistanceM ? 1 : -1;
      for (
        let distanceM = startDistanceM;
        direction > 0 ? distanceM < endDistanceM : distanceM > endDistanceM;
        distanceM += direction * sampleSpacingM
      ) {
        append(lane, distanceM);
      }
      append(lane, endDistanceM);
    }

    return sampled.map((point, index) => {
      const behind = sampled[Math.max(0, index - 3)];
      const ahead = sampled[Math.min(sampled.length - 1, index + 3)];
      return {
        ...point,
        heading: Math.atan2(ahead.x - behind.x, ahead.z - behind.z),
      };
    });
  };

  const offsetCairoPhysicalRoute = (
    route: readonly CairoPhysicalRoutePoint[],
    lateralOffsetM: number,
  ): CairoPhysicalRoutePoint[] =>
    route.map((point) => ({
      ...point,
      x: point.x + Math.cos(point.heading) * lateralOffsetM,
      z: point.z - Math.sin(point.heading) * lateralOffsetM,
    }));

  const advanceCairoPathCursor = (
    route: readonly CairoPhysicalRoutePoint[],
    currentCursor: number,
    x: number,
    z: number,
  ): { readonly cursor: number; readonly crossTrackM: number } => {
    let nearestIndex = currentCursor;
    let nearestDistanceM = Number.POSITIVE_INFINITY;
    for (
      let index = Math.max(0, currentCursor - 8);
      index < Math.min(route.length, currentCursor + 35);
      index += 1
    ) {
      const distanceM = Math.hypot(route[index].x - x, route[index].z - z);
      if (distanceM < nearestDistanceM) {
        nearestIndex = index;
        nearestDistanceM = distanceM;
      }
    }
    return {
      cursor: Math.max(currentCursor, nearestIndex),
      crossTrackM: nearestDistanceM,
    };
  };

  const cairoPathFollowerInput = (
    route: readonly CairoPhysicalRoutePoint[],
    cursor: number,
    pose: { readonly x: number; readonly z: number; readonly heading: number },
  ) => {
    const target = route[Math.min(route.length - 1, cursor + 10)];
    const desiredHeading = Math.atan2(target.x - pose.x, target.z - pose.z);
    const headingError = Math.atan2(
      Math.sin(desiredHeading - pose.heading),
      Math.cos(desiredHeading - pose.heading),
    );
    return {
      throttle: Math.abs(headingError) > 0.55 ? 0.15 : 0.48,
      brake: Math.abs(headingError) > 0.95 ? 0.35 : 0,
      steer: Math.max(-1, Math.min(1, headingError / 0.24)) * 0.9,
    };
  };

  it.each(cairoBridgeMouthNames)(
    "lets the player enter the Cairo %s exit mouth uphill in reverse",
    (mouthName) => {
      const rampRoadId = `cairo-sixth-october-bridge-${mouthName}-exit`;
      const rampLane = cairoGroundHandoffLane(rampRoadId);
      const groundPoint = rampLane.points.at(-1);
      if (!groundPoint) throw new Error(`Missing ${mouthName} exit endpoint`);
      const slipRoadId = `cairo-sixth-october-${mouthName}-exit-slip`;
      const slipLane = cairoRoadNetwork.lanes.find(
        (candidate) =>
          candidate.roadId === slipRoadId &&
          candidate.id.includes("-forward-") &&
          Math.hypot(
            candidate.points[0].x - groundPoint.x,
            candidate.points[0].z - groundPoint.z,
          ) < 0.05,
      );
      if (!slipLane) throw new Error(`Missing ${mouthName} exit slip lane`);

      const startDistanceM = Math.min(5, slipLane.length / 2);
      let raisedTargetDistanceM = rampLane.length;
      while (
        raisedTargetDistanceM > 0 &&
        (cairoRoadNetwork.pointOnLane(rampLane, raisedTargetDistanceM)
          .elevationM ?? 0) < 1
      ) {
        raisedTargetDistanceM -= 0.25;
      }
      const route = buildCairoPhysicalRoute([
        {
          lane: slipLane,
          startDistanceM,
          endDistanceM: 0,
        },
        {
          lane: rampLane,
          startDistanceM: rampLane.length,
          endDistanceM: Math.max(0, raisedTargetDistanceM),
        },
      ]);
      if (route.length < 8) {
        throw new Error(`Incomplete ${mouthName} reverse exit route`);
      }
      const simulation = new SimulationCore({
        ...cairoConfig,
        npcCount: 0,
        staticObstacles: [],
        trafficLights: [],
        stopLines: [],
      });
      simulation.setPlayerPose(route[0], 5);
      simulation.drainEvents();

      const profileElevationsM: number[] = [];
      const profileWrongWay: boolean[] = [];
      const deckCollisions: string[] = [];
      let cursor = 0;
      let firstOffRoad: string | null = null;
      for (let tick = 0; tick < 480; tick += 1) {
        const before = simulation.getSnapshot();
        cursor = advanceCairoPathCursor(
          route,
          cursor,
          before.player.x,
          before.player.z,
        ).cursor;
        const snapshot = simulation.step(
          1 / 60,
          cairoPathFollowerInput(route, cursor, before.player),
        );
        cursor = advanceCairoPathCursor(
          route,
          cursor,
          snapshot.player.x,
          snapshot.player.z,
        ).cursor;
        if (snapshot.road.offRoad && !firstOffRoad) {
          firstOffRoad = `tick ${tick}, lane ${snapshot.road.laneId ?? "none"}, ${snapshot.road.distanceFromLaneCentreM.toFixed(2)}m from centre`;
        }
        for (const event of simulation.drainEvents()) {
          if (event.evidence.obstacle === "roadDeck") {
            deckCollisions.push(
              `${String(event.evidence.obstacleId ?? "unknown deck")}: ${event.correction}`,
            );
          }
        }
        if (snapshot.road.laneId?.startsWith(`${rampRoadId}-`)) {
          profileElevationsM.push(snapshot.player.elevationM ?? 0);
          profileWrongWay.push(snapshot.road.wrongWay);
        }
        if ((snapshot.player.elevationM ?? 0) >= 0.75) break;
      }

      expect(profileElevationsM.length).toBeGreaterThan(5);
      expect(profileElevationsM.at(-1)).toBeGreaterThanOrEqual(0.75);
      expect(firstOffRoad).toBeNull();
      expect(
        profileElevationsM
          .slice(1)
          .every(
            (elevationM, index) =>
              elevationM + 0.002 >= profileElevationsM[index],
          ),
        `${mouthName} exit elevation must follow its rising profile`,
      ).toBe(true);
      expect(profileWrongWay.every(Boolean)).toBe(true);
      expect(deckCollisions).toEqual([]);
    },
  );

  it.each(cairoBridgeMouthNames)(
    "lets the player descend the Cairo %s entrance profile in reverse",
    (mouthName) => {
      const rampRoadId = `cairo-sixth-october-bridge-${mouthName}-entry`;
      const rampLane = cairoGroundHandoffLane(rampRoadId);
      let startDistanceM = 0;
      while (
        startDistanceM < rampLane.length &&
        (cairoRoadNetwork.pointOnLane(rampLane, startDistanceM).elevationM ??
          0) < 0.8
      ) {
        startDistanceM += 0.25;
      }
      const start = cairoRoadNetwork.pointOnLane(rampLane, startDistanceM);
      const behind = cairoRoadNetwork.pointOnLane(
        rampLane,
        Math.max(0, startDistanceM - 0.5),
      );
      const simulation = new SimulationCore({
        ...cairoConfig,
        npcCount: 0,
        staticObstacles: [],
        trafficLights: [],
        stopLines: [],
      });
      simulation.setPlayerPose(
        {
          ...start,
          heading: Math.atan2(behind.x - start.x, behind.z - start.z),
        },
        5,
      );
      simulation.drainEvents();

      const profileElevationsM: number[] = [];
      const profileWrongWay: boolean[] = [];
      let acquiredProfile = false;
      for (let tick = 0; tick < 240; tick += 1) {
        simulation.step(1 / 60, { throttle: 1 });
        const snapshot = simulation.getSnapshot();
        if (snapshot.road.laneId?.startsWith(`${rampRoadId}-`)) {
          acquiredProfile = true;
          profileElevationsM.push(snapshot.player.elevationM ?? 0);
          profileWrongWay.push(snapshot.road.wrongWay);
          if ((snapshot.player.elevationM ?? 0) <= 0.05) break;
        } else if (acquiredProfile) {
          break;
        }
      }

      expect(profileElevationsM.length).toBeGreaterThan(5);
      expect(
        profileElevationsM[0] - Math.min(...profileElevationsM),
      ).toBeGreaterThan(0.6);
      expect(
        profileElevationsM
          .slice(1)
          .every(
            (elevationM, index) =>
              elevationM <= profileElevationsM[index] + 0.002,
          ),
        `${mouthName} entrance elevation must follow its descending profile`,
      ).toBe(true);
      expect(profileWrongWay.every(Boolean)).toBe(true);
      expect(
        simulation
          .getEvents()
          .filter((event) => event.evidence.obstacle === "roadDeck"),
      ).toEqual([]);
    },
  );

  it(
    "traces both west braid choices across every usable pavement track with production colliders",
    { timeout: 90_000 },
    () => {
      const lane = (laneId: string) => {
        const result = cairoRoadNetwork.lanesById.get(laneId);
        if (!result) throw new Error(`Missing west braid lane ${laneId}`);
        return result;
      };
      const carrier = lane("cairo-sixth-october-bridge-west-ramp-2-forward-1");
      const exitLanes = [
        lane("cairo-sixth-october-bridge-west-exit-1-forward-1"),
        lane("cairo-sixth-october-bridge-west-exit-2-forward-1"),
        lane("cairo-sixth-october-bridge-west-exit-3-forward-1"),
      ] as const;
      const entryLanes = [
        lane("cairo-sixth-october-bridge-west-entry-3-forward-1"),
        lane("cairo-sixth-october-bridge-west-entry-2-forward-1"),
        lane("cairo-sixth-october-bridge-west-entry-1-forward-1"),
      ] as const;
      const carrierLeg = {
        lane: carrier,
        startDistanceM: Math.max(0, carrier.length - 20),
        endDistanceM: carrier.length,
      };
      const routeCases = [
        {
          name: "legal exit",
          route: buildCairoPhysicalRoute([
            carrierLeg,
            ...exitLanes.map((exitLane) => ({
              lane: exitLane,
              startDistanceM: 0,
              endDistanceM: exitLane.length,
            })),
          ]),
          expectedPrefix: "cairo-sixth-october-bridge-west-exit-",
          expectedLaneIds: exitLanes.map((exitLane) => exitLane.id),
          expectedWrongWay: false,
        },
        {
          name: "wrong-way entry",
          route: buildCairoPhysicalRoute([
            carrierLeg,
            ...entryLanes.map((entryLane) => ({
              lane: entryLane,
              startDistanceM: entryLane.length,
              endDistanceM: 0,
            })),
          ]),
          expectedPrefix: "cairo-sixth-october-bridge-west-entry-",
          expectedLaneIds: entryLanes.map((entryLane) => entryLane.id),
          expectedWrongWay: true,
        },
      ] as const;
      const westPavedWidthM = Math.min(
        ...cairoSurfaces
          .filter((surface) =>
            [
              "cairo-sixth-october-bridge-west-entry",
              "cairo-sixth-october-bridge-west-exit",
            ].includes(surface.id),
          )
          .map((surface) => surface.widthM),
      );
      expect(westPavedWidthM).toBe(4.2);
      const representativeVehicles = [
        {
          vehicle: getCareerVehicle("compact-hatch"),
          clearanceHeightM: VEHICLE_DIMENSIONS["compact-hatch"].height,
        },
        {
          vehicle: deliveryVan,
          clearanceHeightM: deliveryVanClearanceHeightM,
        },
      ] as const;
      const failures: string[] = [];
      let casesRun = 0;

      for (const { vehicle, clearanceHeightM } of representativeVehicles) {
        const usableEdgeOffsetM =
          westPavedWidthM / 2 - vehicle.physics.playerCapsuleRadiusM;
        const lateralOffsetsM = [
          -usableEdgeOffsetM,
          -0.9,
          0,
          0.9,
          usableEdgeOffsetM,
        ];
        for (const routeCase of routeCases) {
          const carrierEndIndex = routeCase.route.findLastIndex(
            (point) => point.physicalLaneId === carrier.id,
          );
          const ownershipDeadlineIndex = carrierEndIndex + Math.ceil(20 / 0.5);
          for (const lateralOffsetM of lateralOffsetsM) {
            casesRun += 1;
            const route = offsetCairoPhysicalRoute(
              routeCase.route,
              lateralOffsetM,
            );
            const simulation = new SimulationCore({
              ...cairoConfig,
              ...vehicle.physics,
              playerClearanceHeightM: clearanceHeightM,
              npcCount: 0,
            });
            simulation.setPlayerPose(route[0], 4);
            simulation.drainEvents();

            let cursor = 0;
            let previousElevationM = route[0].elevationM;
            let maximumElevationErrorM = 0;
            let maximumElevationStepM = 0;
            let maximumUpwardStepM = 0;
            let maximumElevationErrorDescription = "";
            let maximumElevationStepDescription = "";
            let maximumCrossTrackM = 0;
            let firstOffRoad: string | null = null;
            let firstLateOwnership: string | null = null;
            let firstDirectionMismatch: string | null = null;
            let collision: string | null = null;
            const seenLaneIds = new Set<string>();

            for (
              let tick = 0;
              tick < 2_600 && cursor < route.length - 5;
              tick += 1
            ) {
              const before = simulation.getSnapshot();
              const beforeProgress = advanceCairoPathCursor(
                route,
                cursor,
                before.player.x,
                before.player.z,
              );
              cursor = beforeProgress.cursor;
              maximumCrossTrackM = Math.max(
                maximumCrossTrackM,
                beforeProgress.crossTrackM,
              );
              const snapshot = simulation.step(
                1 / 60,
                cairoPathFollowerInput(route, cursor, before.player),
              );
              const afterProgress = advanceCairoPathCursor(
                route,
                cursor,
                snapshot.player.x,
                snapshot.player.z,
              );
              cursor = afterProgress.cursor;
              maximumCrossTrackM = Math.max(
                maximumCrossTrackM,
                afterProgress.crossTrackM,
              );

              const elevationM = snapshot.player.elevationM ?? 0;
              const elevationStepM = elevationM - previousElevationM;
              previousElevationM = elevationM;
              // The last few centimetres disappear when a projection becomes
              // ground (zero elevation is omitted). That ordinary pavement
              // landing is not a raised-profile snap.
              if (elevationM >= 0.25 || route[cursor].elevationM >= 0.25) {
                if (Math.abs(elevationStepM) > maximumElevationStepM) {
                  maximumElevationStepM = Math.abs(elevationStepM);
                  maximumElevationStepDescription = `tick ${tick}, point ${cursor}, ${snapshot.road.laneId ?? "none"}`;
                }
                maximumUpwardStepM = Math.max(
                  maximumUpwardStepM,
                  elevationStepM,
                );
                const elevationErrorM = Math.abs(
                  elevationM - route[cursor].elevationM,
                );
                if (elevationErrorM > maximumElevationErrorM) {
                  maximumElevationErrorM = elevationErrorM;
                  maximumElevationErrorDescription = `tick ${tick}, point ${cursor}, ${snapshot.road.laneId ?? "none"}`;
                }
              }
              if (snapshot.road.offRoad && !firstOffRoad) {
                firstOffRoad = `tick ${tick}, point ${cursor}, ${snapshot.road.laneId ?? "none"} at ${snapshot.road.distanceFromLaneCentreM.toFixed(2)}m`;
              }
              if (
                cursor >= ownershipDeadlineIndex &&
                !snapshot.road.laneId?.startsWith(routeCase.expectedPrefix) &&
                !firstLateOwnership
              ) {
                firstLateOwnership = `tick ${tick}, point ${cursor}, ${snapshot.road.laneId ?? "none"}`;
              }
              if (snapshot.road.laneId?.startsWith(routeCase.expectedPrefix)) {
                seenLaneIds.add(snapshot.road.laneId);
                if (
                  snapshot.road.wrongWay !== routeCase.expectedWrongWay &&
                  !firstDirectionMismatch
                ) {
                  firstDirectionMismatch = `tick ${tick}, ${snapshot.road.laneId}, wrongWay=${String(snapshot.road.wrongWay)}`;
                }
              }
              const collisionEvent = simulation
                .drainEvents()
                .find((event) => event.code === "collision");
              if (collisionEvent) {
                collision = `tick ${tick}, ${String(
                  collisionEvent.evidence.obstacle ?? "unknown obstacle",
                )}/${String(
                  collisionEvent.evidence.obstacleId ?? "unknown id",
                )}`;
                break;
              }
            }

            const reasons: string[] = [];
            if (collision) reasons.push(`collision ${collision}`);
            if (firstOffRoad) reasons.push(`off-road ${firstOffRoad}`);
            if (firstLateOwnership) {
              reasons.push(`ownership missed at ${firstLateOwnership}`);
            }
            if (firstDirectionMismatch) {
              reasons.push(`direction mismatch at ${firstDirectionMismatch}`);
            }
            if (cursor < route.length - 10) {
              reasons.push(`only reached point ${cursor}/${route.length - 1}`);
            }
            const missingLaneIds = routeCase.expectedLaneIds.filter(
              (laneId) => !seenLaneIds.has(laneId),
            );
            if (missingLaneIds.length > 0) {
              reasons.push(`never projected ${missingLaneIds.join(", ")}`);
            }
            // Route stations are 0.5 m apart; on a curved 10% grade the
            // monotonic cursor can lead the car's exact projected station by
            // just over 12 cm at the inside paved edge. One-tick step limits
            // below remain the independent guard against a real height snap.
            if (maximumElevationErrorM > 0.13) {
              reasons.push(
                `authored height error ${maximumElevationErrorM.toFixed(3)}m at ${maximumElevationErrorDescription}`,
              );
            }
            if (maximumElevationStepM > 0.12 || maximumUpwardStepM > 0.04) {
              reasons.push(
                `height step ${maximumElevationStepM.toFixed(3)}m, upward ${maximumUpwardStepM.toFixed(3)}m at ${maximumElevationStepDescription}`,
              );
            }
            if (maximumCrossTrackM > 1.25) {
              reasons.push(
                `path follower deviated ${maximumCrossTrackM.toFixed(2)}m`,
              );
            }
            if (reasons.length > 0) {
              failures.push(
                `${vehicle.id} ${routeCase.name}, ${lateralOffsetM.toFixed(2)}m lateral: ${reasons.join("; ")}`,
              );
            }
          }
        }
      }

      expect(casesRun).toBe(20);
      expect(
        failures,
        `West braid full-profile failures across usable pavement:\n${failures.join("\n")}`,
      ).toEqual([]);
    },
  );

  type CairoCrossRoadHandoff = {
    readonly fromLane: NormalizedLane;
    readonly toLane: NormalizedLane;
  };
  const cairoSixthOctoberCrossRoadHandoffs: CairoCrossRoadHandoff[] = [];
  for (const fromLane of cairoRoadNetwork.lanes) {
    for (const successorLaneId of fromLane.successorLaneIds) {
      const toLane = cairoRoadNetwork.lanesById.get(successorLaneId);
      if (
        !toLane ||
        fromLane.roadId === toLane.roadId ||
        !(
          fromLane.roadId?.includes("sixth-october") ||
          toLane.roadId?.includes("sixth-october")
        )
      ) {
        continue;
      }
      cairoSixthOctoberCrossRoadHandoffs.push({ fromLane, toLane });
    }
  }

  it(
    "crosses every Sixth October cross-road handoff in both physical directions with production colliders",
    { timeout: 90_000 },
    () => {
      const uniqueRoadPairs = new Set(
        cairoSixthOctoberCrossRoadHandoffs.map(
          ({ fromLane, toLane }) => `${fromLane.roadId}->${toLane.roadId}`,
        ),
      );
      expect(cairoSixthOctoberCrossRoadHandoffs).toHaveLength(50);
      expect(uniqueRoadPairs).toHaveLength(46);
      expect(
        cairoSixthOctoberCrossRoadHandoffs.some(
          ({ fromLane, toLane }) =>
            fromLane.id === "cairo-sixth-october-east-entry-slip-2-forward-1" &&
            toLane.id === "cairo-sixth-october-bridge-east-entry-1-forward-1",
        ),
        "The generated inventory must include the reported Al-Galaa lift mouth",
      ).toBe(true);

      const simulation = new SimulationCore({
        ...cairoConfig,
        ...deliveryVan.physics,
        playerClearanceHeightM: deliveryVanClearanceHeightM,
        npcCount: 0,
      });
      const failures: string[] = [];
      let casesRun = 0;

      for (const { fromLane, toLane } of cairoSixthOctoberCrossRoadHandoffs) {
        const fromEndpoint = fromLane.points.at(-1);
        const toEndpoint = toLane.points[0];
        if (!fromEndpoint || !toEndpoint) {
          failures.push(`${fromLane.id} -> ${toLane.id}: missing endpoint`);
          continue;
        }
        const endpointGapM = Math.hypot(
          fromEndpoint.x - toEndpoint.x,
          fromEndpoint.z - toEndpoint.z,
        );
        const endpointElevationGapM = Math.abs(
          (fromEndpoint.elevationM ?? 0) - (toEndpoint.elevationM ?? 0),
        );
        if (endpointGapM > 0.05 || endpointElevationGapM > 0.05) {
          failures.push(
            `${fromLane.id} -> ${toLane.id}: authored endpoint gap ${endpointGapM.toFixed(3)}m / elevation gap ${endpointElevationGapM.toFixed(3)}m`,
          );
          continue;
        }

        for (const reversePhysicalDirection of [false, true] as const) {
          casesRun += 1;
          const sourceLane = reversePhysicalDirection ? toLane : fromLane;
          const targetLane = reversePhysicalDirection ? fromLane : toLane;
          const startDistanceM = reversePhysicalDirection
            ? Math.min(4, sourceLane.length)
            : Math.max(0, sourceLane.length - 4);
          const targetDistanceM = reversePhysicalDirection
            ? Math.max(0, targetLane.length - 4)
            : Math.min(4, targetLane.length);
          const start = cairoRoadNetwork.pointOnLane(
            sourceLane,
            startDistanceM,
          );
          const afterHandoff = cairoRoadNetwork.pointOnLane(
            targetLane,
            targetDistanceM,
          );
          const outgoingDx = afterHandoff.x - fromEndpoint.x;
          const outgoingDz = afterHandoff.z - fromEndpoint.z;
          const outgoingLengthM = Math.hypot(outgoingDx, outgoingDz);
          if (outgoingLengthM < 0.5) {
            failures.push(
              `${fromLane.id} -> ${toLane.id} ${reversePhysicalDirection ? "reverse" : "forward"}: target probe is degenerate`,
            );
            continue;
          }
          const outgoingUx = outgoingDx / outgoingLengthM;
          const outgoingUz = outgoingDz / outgoingLengthM;
          const label = `${sourceLane.id} => ${targetLane.id} (${reversePhysicalDirection ? "reverse physical" : "legal"})`;

          simulation.reset();
          simulation.setPlayerPose(
            {
              ...start,
              heading: Math.atan2(
                fromEndpoint.x - start.x,
                fromEndpoint.z - start.z,
              ),
            },
            6,
          );
          simulation.drainEvents();

          let progressBeyondHandoffM = Number.NEGATIVE_INFINITY;
          let collisionDescription: string | null = null;
          let previousElevationM = start.elevationM ?? 0;
          let largestElevationStepM = 0;

          for (let tick = 0; tick < 120; tick += 1) {
            const snapshot = simulation.step(1 / 60, { throttle: 0.45 });
            progressBeyondHandoffM =
              (snapshot.player.x - fromEndpoint.x) * outgoingUx +
              (snapshot.player.z - fromEndpoint.z) * outgoingUz;
            const elevationM = snapshot.player.elevationM ?? 0;
            largestElevationStepM = Math.max(
              largestElevationStepM,
              Math.abs(elevationM - previousElevationM),
            );
            previousElevationM = elevationM;

            const collision = simulation
              .drainEvents()
              .find((event) => event.code === "collision");
            if (collision) {
              collisionDescription = `${String(
                collision.evidence.obstacle ?? "unknown obstacle",
              )}/${String(
                collision.evidence.obstacleId ?? "unknown id",
              )}: ${collision.correction}`;
            }
            if (collisionDescription || progressBeyondHandoffM > 2.5) break;
          }

          const reasons: string[] = [];
          if (collisionDescription)
            reasons.push(`collision ${collisionDescription}`);
          if (progressBeyondHandoffM <= 2.5) {
            reasons.push(
              `only reached ${progressBeyondHandoffM.toFixed(2)}m beyond the mouth`,
            );
          }
          if (largestElevationStepM > 0.35) {
            reasons.push(
              `elevation jumped ${largestElevationStepM.toFixed(3)}m in one tick`,
            );
          }
          if (reasons.length > 0)
            failures.push(`${label}: ${reasons.join("; ")}`);
        }
      }

      expect(casesRun).toBe(100);
      expect(
        failures.slice(0, 25),
        `${failures.length} Sixth October handoff traces failed:\n${failures
          .slice(0, 25)
          .join("\n")}`,
      ).toEqual([]);
    },
  );

  it(
    "drives the full legal Al-Galaa east entry at lane-centre and edge offsets without a hidden blocker",
    { timeout: 90_000 },
    () => {
      const routeLaneIds = [
        "cairo-galaa-street-10-reverse-1",
        "cairo-sixth-october-east-entry-slip-1-forward-1",
        "cairo-sixth-october-east-entry-slip-2-forward-1",
        "cairo-sixth-october-bridge-east-entry-1-forward-1",
        "cairo-sixth-october-bridge-east-entry-2-forward-1",
        "cairo-sixth-october-bridge-east-entry-3-forward-1",
        "cairo-sixth-october-bridge-east-ramp-2-reverse-1",
        "cairo-sixth-october-bridge-east-ramp-1-reverse-1",
        "cairo-sixth-october-bridge-6-reverse-1",
      ] as const;
      const route = routeLaneIds.map((laneId) => {
        const lane = cairoRoadNetwork.lanesById.get(laneId);
        if (!lane) throw new Error(`Missing east-entry route lane ${laneId}`);
        return lane;
      });
      for (let index = 0; index + 1 < route.length; index += 1) {
        expect(
          route[index].successorLaneIds,
          `${route[index].id} must legally lead to ${route[index + 1].id}`,
        ).toContain(route[index + 1].id);
      }

      type EastEntryRoutePoint = {
        readonly x: number;
        readonly z: number;
        readonly elevationM: number;
        readonly heading: number;
      };
      const centrelinePoints: EastEntryRoutePoint[] = [];
      const appendPoint = (point: EastEntryRoutePoint) => {
        const previous = centrelinePoints.at(-1);
        if (
          previous &&
          Math.hypot(previous.x - point.x, previous.z - point.z) < 0.01
        ) {
          return;
        }
        centrelinePoints.push(point);
      };
      route.forEach((lane, laneIndex) => {
        const startDistanceM =
          laneIndex === 0 ? Math.max(0, lane.length - 18) : 0;
        const endDistanceM =
          laneIndex === route.length - 1
            ? Math.min(30, lane.length)
            : lane.length;
        for (
          let distanceM = startDistanceM;
          distanceM < endDistanceM;
          distanceM += 0.75
        ) {
          const point = cairoRoadNetwork.pointOnLane(lane, distanceM);
          appendPoint({
            x: point.x,
            z: point.z,
            elevationM: point.elevationM ?? 0,
            heading: point.heading,
          });
        }
        const point = cairoRoadNetwork.pointOnLane(lane, endDistanceM);
        appendPoint({
          x: point.x,
          z: point.z,
          elevationM: point.elevationM ?? 0,
          heading: point.heading,
        });
      });
      const smoothedCentrelinePoints = centrelinePoints.map((point, index) => {
        const behind = centrelinePoints[Math.max(0, index - 2)];
        const ahead =
          centrelinePoints[Math.min(centrelinePoints.length - 1, index + 2)];
        return {
          ...point,
          heading: Math.atan2(ahead.x - behind.x, ahead.z - behind.z),
        };
      });
      expect(smoothedCentrelinePoints.length).toBeGreaterThan(300);

      const clampControl = (value: number) => Math.max(-1, Math.min(1, value));
      const angleDifference = (target: number, current: number) =>
        Math.atan2(Math.sin(target - current), Math.cos(target - current));
      const requiredRoadIds = [
        "cairo-galaa-street",
        "cairo-sixth-october-east-entry-slip",
        "cairo-sixth-october-bridge-east-entry",
        "cairo-sixth-october-bridge-east-ramp",
        "cairo-sixth-october-bridge",
      ] as const;
      const simulation = new SimulationCore({
        ...cairoConfig,
        ...deliveryVan.physics,
        playerClearanceHeightM: deliveryVanClearanceHeightM,
        npcCount: 0,
      });
      const failures: string[] = [];

      for (const lateralOffsetM of [-0.9, 0, 0.9] as const) {
        const routePoints = smoothedCentrelinePoints.map((point) => ({
          ...point,
          // Positive offsets are to the right of travel. The reported trace is
          // retained literally as -0.9 m rather than rounded to lane centre.
          x: point.x + Math.cos(point.heading) * lateralOffsetM,
          z: point.z - Math.sin(point.heading) * lateralOffsetM,
        }));
        simulation.reset();
        simulation.setPlayerPose(routePoints[0], 4);
        simulation.drainEvents();

        let cursor = 0;
        let collisionDescription: string | null = null;
        let firstOffRoadDescription: string | null = null;
        let largestElevationStepM = 0;
        let largestElevationDropM = 0;
        let previousElevationM = routePoints[0].elevationM;
        let maximumElevationM = previousElevationM;
        let maximumCrossTrackM = 0;
        const seenRoadIds = new Set<string>();

        for (
          let tick = 0;
          tick < 2_200 && cursor < routePoints.length - 5;
          tick += 1
        ) {
          const before = simulation.getSnapshot();
          let nearestIndex = cursor;
          let nearestDistanceM = Number.POSITIVE_INFINITY;
          for (
            let index = Math.max(0, cursor - 8);
            index < Math.min(routePoints.length, cursor + 28);
            index += 1
          ) {
            const distanceM = Math.hypot(
              routePoints[index].x - before.player.x,
              routePoints[index].z - before.player.z,
            );
            if (distanceM < nearestDistanceM) {
              nearestDistanceM = distanceM;
              nearestIndex = index;
            }
          }
          cursor = Math.max(cursor, nearestIndex);
          maximumCrossTrackM = Math.max(maximumCrossTrackM, nearestDistanceM);
          const target =
            routePoints[Math.min(routePoints.length - 1, cursor + 7)];
          const desiredHeading = Math.atan2(
            target.x - before.player.x,
            target.z - before.player.z,
          );
          const headingError = angleDifference(
            desiredHeading,
            before.player.heading,
          );
          const snapshot = simulation.step(1 / 60, {
            throttle: Math.abs(headingError) > 0.5 ? 0.18 : 0.45,
            brake: Math.abs(headingError) > 0.9 ? 0.4 : 0,
            steer: clampControl(headingError / 0.25) * 0.9,
          });

          const elevationM = snapshot.player.elevationM ?? 0;
          largestElevationStepM = Math.max(
            largestElevationStepM,
            Math.abs(elevationM - previousElevationM),
          );
          largestElevationDropM = Math.max(
            largestElevationDropM,
            previousElevationM - elevationM,
          );
          previousElevationM = elevationM;
          maximumElevationM = Math.max(maximumElevationM, elevationM);
          const projectedLane = snapshot.road.laneId
            ? cairoRoadNetwork.lanesById.get(snapshot.road.laneId)
            : undefined;
          if (projectedLane?.roadId) seenRoadIds.add(projectedLane.roadId);
          if (snapshot.road.offRoad && !firstOffRoadDescription) {
            firstOffRoadDescription = `tick ${tick}, cursor ${cursor}, lane ${snapshot.road.laneId ?? "none"}, ${snapshot.road.distanceFromLaneCentreM.toFixed(2)}m from centre`;
          }

          const collision = simulation
            .drainEvents()
            .find((event) => event.code === "collision");
          if (collision) {
            collisionDescription = `tick ${tick}, cursor ${cursor}, lane ${snapshot.road.laneId ?? "none"}: ${String(
              collision.evidence.obstacle ?? "unknown obstacle",
            )}/${String(
              collision.evidence.obstacleId ?? "unknown id",
            )} (${collision.correction})`;
            break;
          }
        }

        const finalSnapshot = simulation.getSnapshot();
        const finalLane = finalSnapshot.road.laneId
          ? cairoRoadNetwork.lanesById.get(finalSnapshot.road.laneId)
          : undefined;
        const reasons: string[] = [];
        if (collisionDescription)
          reasons.push(`collision ${collisionDescription}`);
        if (firstOffRoadDescription) {
          reasons.push(`went off-road at ${firstOffRoadDescription}`);
        }
        if (cursor < routePoints.length - 12) {
          reasons.push(
            `stopped at route point ${cursor}/${routePoints.length - 1} (${maximumCrossTrackM.toFixed(2)}m max cross-track)`,
          );
        }
        const missingRoadIds = requiredRoadIds.filter(
          (roadId) => !seenRoadIds.has(roadId),
        );
        if (missingRoadIds.length > 0) {
          reasons.push(`never acquired ${missingRoadIds.join(", ")}`);
        }
        if (finalLane?.roadId !== "cairo-sixth-october-bridge") {
          reasons.push(`finished on ${finalLane?.roadId ?? "no road"}`);
        }
        if (
          maximumElevationM < 10 ||
          (finalSnapshot.player.elevationM ?? 0) < 10
        ) {
          reasons.push(
            `failed to climb onto the 10.5m deck (max ${maximumElevationM.toFixed(2)}m, final ${(finalSnapshot.player.elevationM ?? 0).toFixed(2)}m)`,
          );
        }
        if (largestElevationStepM > 0.35 || largestElevationDropM > 0.08) {
          reasons.push(
            `discontinuous elevation (largest step ${largestElevationStepM.toFixed(3)}m, drop ${largestElevationDropM.toFixed(3)}m)`,
          );
        }
        if (reasons.length > 0) {
          failures.push(
            `${lateralOffsetM.toFixed(1)}m offset: ${reasons.join("; ")}`,
          );
        }
      }

      expect(
        failures,
        `The uninterrupted Al-Galaa entry traces must stay on their visible road:\n${failures.join("\n")}`,
      ).toEqual([]);
    },
  );
});
