import { describe, expect, it } from "vitest";
import { CAREER_VEHICLES } from "../app/game/career";
import {
  NYC_FREE_DRIVE,
  NYC_MAP_PACK,
  NYC_QUEENSVIEW_DENSITY_BLOCK_PREFIX,
  NYC_QUEENSVIEW_DENSITY_BLOCKS,
} from "../app/game/cities/nyc";
import {
  NYC_QUEENSVIEW_ACCESS_SITES,
  NYC_QUEENSVIEW_NETWORK_PREFIX,
} from "../app/game/cities/nycElevatedRoadNetwork";
import {
  buildingSolidObstacleId,
  planMapBuildings,
  type PlannedBuilding,
  type StructuralObb,
} from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import { createElevatedRoadGroundClearanceQuery } from "../app/game/geometry/elevatedRoadGeometry";
import {
  buildOccluderIndex,
  nearestOccluderHit,
} from "../app/game/geometry/visualGapCoverage";
import {
  aabbOfShape,
  booleanIntersectionArea,
  collectMapVisualGeometry,
  shapeArea,
  type Aabb2,
  type OccluderVolume,
  type Shape2d,
} from "../app/game/geometry/visualSceneFootprints";
import { isElevatedRoadSurface } from "../app/game/roadElevation";
import {
  buildStaticObstacles,
  distanceToStaticObstacle,
} from "../app/game/simulationAdapter";
import type {
  LaneSegment,
  StaticObstacle,
} from "../app/game/types";

/**
 * This suite deliberately keys the density work by an authored block prefix,
 * then follows those blocks through the one production building plan into
 * collision solids and visual occluders. A coarse block rectangle cannot pass
 * on behalf of a layout that reservations emptied or a model that overhangs
 * its parcel.
 */

const mapPack = NYC_MAP_PACK;
const buildingLayout = planMapBuildings(
  mapPack,
  NYC_FREE_DRIVE.trafficSeed,
  relaxationPolicyForMap(mapPack.id),
);
const visualGeometry = collectMapVisualGeometry(mapPack, buildingLayout);
const occluderIndex = buildOccluderIndex(visualGeometry.occluders);
const roadSurfaces = mapPack.geometry.roadSurfaces ?? [];
const laneById = new Map(mapPack.laneGraph.lanes.map((lane) => [lane.id, lane]));
const densityBlocks = mapPack.geometry.blocks.filter((block) =>
  block.id.startsWith(NYC_QUEENSVIEW_DENSITY_BLOCK_PREFIX),
);
const densityBuildings = buildingLayout.buildings.filter((building) =>
  building.blockId.startsWith(NYC_QUEENSVIEW_DENSITY_BLOCK_PREFIX),
);
const densityBuildingIds = new Set(densityBuildings.map((building) => building.id));
const densityOccluders = visualGeometry.occluders.filter((occluder) =>
  densityBuildingIds.has(occluder.ownerId),
);

const worldHalfX = mapPack.geometry.worldSize.x / 2;
const worldHalfZ = mapPack.geometry.worldSize.z / 2;
const staticObstacles = buildStaticObstacles({
  mapPack,
  buildingLayout,
  bounds: {
    minX: -worldHalfX,
    maxX: worldHalfX,
    minZ: -worldHalfZ,
    maxZ: worldHalfZ,
  },
});

const maximumVehicleRadiusM = Math.max(
  ...CAREER_VEHICLES.map((vehicle) => vehicle.physics.playerCapsuleRadiusM),
);
const maximumVehicleHalfLengthM = Math.max(
  ...CAREER_VEHICLES.map(
    (vehicle) => vehicle.physics.playerCapsuleHalfLengthM,
  ),
);

const obbShape = (solid: StructuralObb): Shape2d => ({
  kind: "obb",
  x: solid.x,
  z: solid.z,
  ux: solid.ux,
  uz: solid.uz,
  halfU: solid.halfU,
  halfV: solid.halfV,
});

const obstacleShape = (obstacle: StaticObstacle): Shape2d => {
  switch (obstacle.kind) {
    case "aabb":
      return {
        kind: "aabb",
        minX: obstacle.minX,
        maxX: obstacle.maxX,
        minZ: obstacle.minZ,
        maxZ: obstacle.maxZ,
      };
    case "obb":
      return {
        kind: "obb",
        x: obstacle.x,
        z: obstacle.z,
        ux: obstacle.ux,
        uz: obstacle.uz,
        halfU: obstacle.halfU,
        halfV: obstacle.halfV,
      };
    case "circle":
      return {
        kind: "circle",
        x: obstacle.x,
        z: obstacle.z,
        radius: obstacle.radius,
      };
    case "convex":
      return { kind: "polygon", outer: obstacle.points };
  }
};

const boxesMeet = (a: Aabb2, b: Aabb2, paddingM = 0): boolean =>
  a.minX <= b.maxX + paddingM &&
  a.maxX >= b.minX - paddingM &&
  a.minZ <= b.maxZ + paddingM &&
  a.maxZ >= b.minZ - paddingM;

const densityBlockId = (suffix: string): string =>
  `${NYC_QUEENSVIEW_DENSITY_BLOCK_PREFIX}${suffix}`;

const EXPECTED_BUILDING_COUNT_BY_AUTHORED_BLOCK_ID = new Map<string, number>([
  [densityBlockId("manhattan-65th-park-west-south"), 5],
  [densityBlockId("manhattan-65th-park-east-south"), 8],
  [densityBlockId("manhattan-65th-park-west-north"), 12],
  [densityBlockId("manhattan-65th-park-east-north"), 11],
  [densityBlockId("manhattan-third-lexington-east-north"), 8],
  [densityBlockId("manhattan-third-west-north"), 10],
  [densityBlockId("manhattan-third-west-bridge-bay"), 1],
  [densityBlockId("queens-vernon-bridge-facing"), 8],
  [densityBlockId("queens-vernon-east"), 6],
  [densityBlockId("queens-crescent-east"), 10],
  [densityBlockId("queens-40th-infield"), 4],
  [densityBlockId("queens-40th-north"), 4],
]);

/**
 * E 65th and Third share one compact Manhattan approach, just as Vernon and
 * 40th Avenue share the Queens terminal braid. Buildings seen from either
 * movement are therefore intentionally shared. Keeping those relationships
 * explicit prevents a count floor from demanding fake parcels inside ramp
 * loops merely to make a test pass; the sightline itself still caps reach at
 * 240 m, so distant borough scenery cannot satisfy a site.
 */
const DENSITY_BLOCK_IDS_BY_SITE = {
  "manhattan-65th": [
    densityBlockId("manhattan-65th-park-west-south"),
    densityBlockId("manhattan-65th-park-east-south"),
    densityBlockId("manhattan-65th-park-west-north"),
    densityBlockId("manhattan-65th-park-east-north"),
    densityBlockId("manhattan-third-lexington-east-north"),
    densityBlockId("manhattan-third-west-north"),
    densityBlockId("manhattan-third-west-bridge-bay"),
  ],
  "manhattan-third": [
    densityBlockId("manhattan-65th-park-west-south"),
    densityBlockId("manhattan-65th-park-east-south"),
    densityBlockId("manhattan-65th-park-west-north"),
    densityBlockId("manhattan-65th-park-east-north"),
    densityBlockId("manhattan-third-lexington-east-north"),
    densityBlockId("manhattan-third-west-north"),
    densityBlockId("manhattan-third-west-bridge-bay"),
  ],
  "queens-vernon": [
    densityBlockId("queens-vernon-bridge-facing"),
    densityBlockId("queens-vernon-east"),
    densityBlockId("queens-crescent-east"),
    densityBlockId("queens-40th-infield"),
    densityBlockId("queens-40th-north"),
  ],
  "queens-40th": [
    densityBlockId("queens-vernon-bridge-facing"),
    densityBlockId("queens-vernon-east"),
    densityBlockId("queens-crescent-east"),
    densityBlockId("queens-40th-infield"),
    densityBlockId("queens-40th-north"),
  ],
} as const;

const actualBlockComesFrom = (actualId: string, authoredId: string): boolean =>
  actualId === authoredId || actualId.startsWith(`${authoredId}-`);

const blockIdsForSite = (siteId: keyof typeof DENSITY_BLOCK_IDS_BY_SITE) =>
  DENSITY_BLOCK_IDS_BY_SITE[siteId];

const siteBuildings = (siteId: string): readonly PlannedBuilding[] =>
  densityBuildings.filter((building) => {
    const authoredIds = blockIdsForSite(
      siteId as keyof typeof DENSITY_BLOCK_IDS_BY_SITE,
    );
    return authoredIds.some((authoredId) =>
      actualBlockComesFrom(building.blockId, authoredId),
    );
  });

const siteOccluders = (siteId: string): readonly OccluderVolume[] => {
  const owners = new Set(siteBuildings(siteId).map((building) => building.id));
  return densityOccluders.filter((occluder) => owners.has(occluder.ownerId));
};

interface LanePose {
  readonly x: number;
  readonly z: number;
  readonly elevationM: number;
  readonly heading: number;
}

const lanePoseAtFraction = (lane: LaneSegment, fraction: number): LanePose => {
  const lengths = lane.centerline.slice(1).map((point, index) =>
    Math.hypot(
      point.x - lane.centerline[index].x,
      point.z - lane.centerline[index].z,
    ),
  );
  const totalM = lengths.reduce((sum, lengthM) => sum + lengthM, 0);
  const targetM = totalM * Math.max(0, Math.min(1, fraction));
  let travelledM = 0;
  for (let index = 0; index + 1 < lane.centerline.length; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const lengthM = lengths[index];
    if (lengthM < 1e-8) continue;
    if (travelledM + lengthM + 1e-8 < targetM) {
      travelledM += lengthM;
      continue;
    }
    const amount = Math.max(0, Math.min(1, (targetM - travelledM) / lengthM));
    return {
      x: start.x + (end.x - start.x) * amount,
      z: start.z + (end.z - start.z) * amount,
      elevationM:
        (start.elevationM ?? 0) +
        ((end.elevationM ?? 0) - (start.elevationM ?? 0)) * amount,
      heading: Math.atan2(end.x - start.x, end.z - start.z),
    };
  }
  throw new Error(`lane ${lane.id} has no measurable segment`);
};

const requireLane = (laneId: string): LaneSegment => {
  const lane = laneById.get(laneId);
  if (!lane) throw new Error(`missing Queensview density sightline lane ${laneId}`);
  return lane;
};

const movementSightlinePoses = (
  slipSurfaceId: string,
  rampLaneId: string,
  kind: "entry" | "exit",
): readonly LanePose[] => {
  const slip = requireLane(`${slipSurfaceId}-lane`);
  const ramp = requireLane(rampLaneId);
  return kind === "entry"
    ? [
        lanePoseAtFraction(slip, 0.35),
        lanePoseAtFraction(slip, 0.8),
        lanePoseAtFraction(ramp, 0.08),
        lanePoseAtFraction(ramp, 0.28),
      ]
    : [
        lanePoseAtFraction(ramp, 0.72),
        lanePoseAtFraction(ramp, 0.92),
        lanePoseAtFraction(slip, 0.2),
        lanePoseAtFraction(slip, 0.65),
      ];
};

interface SightlineCoverage {
  readonly rayHits: number;
  readonly visibleOwnerIds: ReadonlySet<string>;
}

const occluderTarget = (
  occluder: OccluderVolume,
): { readonly x: number; readonly z: number } => {
  const bounds = aabbOfShape(occluder.geometry);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
};

/**
 * Aim at the real visual solids from the legal road poses and require the
 * density owner to be the first opaque hit. This is stronger than proximity:
 * a building hidden behind an older frontage or another block cannot claim
 * to repair the driver's view. The 270-degree window matches a chase camera
 * that the player can orbit while retaining a small directly-behind blind
 * wedge.
 */
const directlyVisibleOwners = (
  poses: readonly LanePose[],
  candidateOccluders: readonly OccluderVolume[],
  allowedOwnerIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  const visible = new Set<string>();
  const maximumAngleRad = (135 * Math.PI) / 180;
  for (const pose of poses) {
    const forwardX = Math.sin(pose.heading);
    const forwardZ = Math.cos(pose.heading);
    const eye = {
      x: pose.x - forwardX * 5.5,
      z: pose.z - forwardZ * 5.5,
      y: pose.elevationM + 2.7,
    };
    for (const occluder of candidateOccluders) {
      const target = occluderTarget(occluder);
      const dx = target.x - eye.x;
      const dz = target.z - eye.z;
      const distanceM = Math.hypot(dx, dz);
      if (distanceM > 240 || distanceM < 1) continue;
      const targetHeading = Math.atan2(dx, dz);
      const angle = Math.atan2(
        Math.sin(targetHeading - pose.heading),
        Math.cos(targetHeading - pose.heading),
      );
      if (Math.abs(angle) > maximumAngleRad) continue;
      const targetY = Math.max(
        occluder.minY + 0.2,
        Math.min(eye.y, occluder.maxY - 0.2),
      );
      const hit = nearestOccluderHit(
        visualGeometry.occluders,
        eye,
        { ...target, y: targetY },
        occluderIndex,
      );
      if (hit && allowedOwnerIds.has(hit.ownerId)) {
        visible.add(hit.ownerId);
      }
    }
  }
  return visible;
};

const routeFacingCoverage = (
  poses: readonly LanePose[],
  allowedOwnerIds: ReadonlySet<string>,
): SightlineCoverage => {
  const visibleOwnerIds = new Set<string>();
  let rayHits = 0;
  const halfFanRad = (50 * Math.PI) / 180;
  const rayCount = 51;
  const rayLengthM = 180;
  for (const pose of poses) {
    const forwardX = Math.sin(pose.heading);
    const forwardZ = Math.cos(pose.heading);
    const eye = {
      x: pose.x - forwardX * 5.5,
      z: pose.z - forwardZ * 5.5,
      y: pose.elevationM + 2.7,
    };
    for (let rayIndex = 0; rayIndex < rayCount; rayIndex += 1) {
      const amount = rayIndex / (rayCount - 1);
      const heading = pose.heading - halfFanRad + halfFanRad * 2 * amount;
      const hit = nearestOccluderHit(
        visualGeometry.occluders,
        eye,
        {
          x: eye.x + Math.sin(heading) * rayLengthM,
          z: eye.z + Math.cos(heading) * rayLengthM,
          // A bridge approach camera looks slightly down into the street wall;
          // keeping this at a first-floor height lets low Queens fabric remain
          // visible from a rising ramp without pretending it is a tower.
          y: 2.7,
        },
        occluderIndex,
      );
      if (!hit || !allowedOwnerIds.has(hit.ownerId)) continue;
      rayHits += 1;
      visibleOwnerIds.add(hit.ownerId);
    }
  }
  return { rayHits, visibleOwnerIds };
};

const solidSamples = (
  solid: StructuralObb,
  maximumSpacingM: number,
): readonly { readonly x: number; readonly z: number }[] => {
  const stepsU = Math.max(1, Math.ceil((solid.halfU * 2) / maximumSpacingM));
  const stepsV = Math.max(1, Math.ceil((solid.halfV * 2) / maximumSpacingM));
  const samples: { x: number; z: number }[] = [];
  for (let uIndex = 0; uIndex <= stepsU; uIndex += 1) {
    const u = -solid.halfU + (solid.halfU * 2 * uIndex) / stepsU;
    for (let vIndex = 0; vIndex <= stepsV; vIndex += 1) {
      const v = -solid.halfV + (solid.halfV * 2 * vIndex) / stepsV;
      samples.push({
        x: solid.x + solid.ux * u + solid.uz * v,
        z: solid.z + solid.uz * u - solid.ux * v,
      });
    }
  }
  return samples;
};

describe("NYC Queensview approach density", () => {
  it("puts substantial planned, driver-visible urban fabric at all four access sites", () => {
    expect(NYC_QUEENSVIEW_ACCESS_SITES).toHaveLength(4);
    const allDensityBlockIds = new Set(densityBlocks.map((block) => block.id));
    expect(allDensityBlockIds.size).toBe(densityBlocks.length);
    expect(
      NYC_QUEENSVIEW_DENSITY_BLOCKS.map((block) => block.id),
      "reviewed authored density inventory",
    ).toEqual([
      densityBlockId("manhattan-65th-park-west-south"),
      densityBlockId("manhattan-65th-park-east-south"),
      densityBlockId("manhattan-65th-park-west-north"),
      densityBlockId("manhattan-65th-park-east-north"),
      densityBlockId("manhattan-third-lexington-east-north"),
      densityBlockId("manhattan-third-west-north"),
      densityBlockId("manhattan-third-west-bridge-bay"),
      densityBlockId("queens-vernon-bridge-facing"),
      densityBlockId("queens-vernon-east"),
      densityBlockId("queens-crescent-east"),
      densityBlockId("queens-40th-infield"),
      densityBlockId("queens-40th-north"),
    ]);
    for (const [authoredBlockId, expectedCount] of
      EXPECTED_BUILDING_COUNT_BY_AUTHORED_BLOCK_ID) {
      expect(
        densityBuildings.filter((building) =>
          actualBlockComesFrom(building.blockId, authoredBlockId),
        ),
        `${authoredBlockId} planned building inventory`,
      ).toHaveLength(expectedCount);
    }
    expect(densityBuildings, "complete reviewed density plan").toHaveLength(87);

    for (const site of NYC_QUEENSVIEW_ACCESS_SITES) {
      const authoredIds = blockIdsForSite(site.id);
      const blocks = densityBlocks.filter((block) =>
        authoredIds.some((authoredId) =>
          actualBlockComesFrom(block.id, authoredId),
        ),
      );
      const buildings = siteBuildings(site.id);
      const occluders = siteOccluders(site.id);
      const buildingIds = new Set(buildings.map((building) => building.id));

      expect(blocks.length, `${site.id} authored density blocks`).toBeGreaterThanOrEqual(2);
      expect(buildings.length, `${site.id} planned buildings`).toBeGreaterThanOrEqual(8);
      expect(occluders.length, `${site.id} visual occluders`).toBeGreaterThanOrEqual(8);
      expect(
        buildings.reduce(
          (areaM2, building) =>
            areaM2 +
            building.solids.reduce(
              (solidAreaM2, solid) => solidAreaM2 + shapeArea(obbShape(solid)),
              0,
            ),
          0,
        ),
        `${site.id} planned structural footprint`,
      ).toBeGreaterThanOrEqual(650);
      expect(
        occluders.reduce(
          (areaM2, occluder) => areaM2 + shapeArea(occluder.geometry),
          0,
        ),
        `${site.id} visual occluder footprint`,
      ).toBeGreaterThanOrEqual(500);

      const entryCoverage = routeFacingCoverage(
        movementSightlinePoses(
          site.entry.slipSurfaceId,
          site.entry.rampLaneId,
          "entry",
        ),
        buildingIds,
      );
      const exitCoverage = routeFacingCoverage(
        movementSightlinePoses(
          site.exit.slipSurfaceId,
          site.exit.rampLaneId,
          "exit",
        ),
        buildingIds,
      );
      const entryVisibleOwners = directlyVisibleOwners(
        movementSightlinePoses(
          site.entry.slipSurfaceId,
          site.entry.rampLaneId,
          "entry",
        ),
        occluders,
        buildingIds,
      );
      const exitVisibleOwners = directlyVisibleOwners(
        movementSightlinePoses(
          site.exit.slipSurfaceId,
          site.exit.rampLaneId,
          "exit",
        ),
        occluders,
        buildingIds,
      );
      // The directed fan samples exposed facade slivers that an AABB-centre
      // aim can miss (notably Third's one-building bridge bay), while the
      // centre aims enumerate distinct unobscured owners without depending on
      // a ray-grid phase. Their union is the driver-visible set; each legal
      // movement must see some of it and the whole access site must see a
      // substantial street wall.
      const entryVisible = new Set([
        ...entryVisibleOwners,
        ...entryCoverage.visibleOwnerIds,
      ]);
      const exitVisible = new Set([
        ...exitVisibleOwners,
        ...exitCoverage.visibleOwnerIds,
      ]);
      const allVisible = new Set([
        ...entryVisible,
        ...exitVisible,
      ]);
      expect.soft(
        entryCoverage.rayHits + exitCoverage.rayHits,
        `${site.id} forward chase-camera rays hitting new fabric`,
      ).toBeGreaterThanOrEqual(2);
      expect.soft(
        entryVisible.size,
        `${site.id} distinct density buildings visible from entry poses`,
      ).toBeGreaterThanOrEqual(1);
      expect.soft(
        exitVisible.size,
        `${site.id} distinct density buildings visible from exit poses`,
      ).toBeGreaterThanOrEqual(1);
      expect.soft(
        allVisible.size,
        `${site.id} distinct density buildings visible from its legal movements`,
      ).toBeGreaterThanOrEqual(4);
    }

    expect(
      densityBlocks.length,
      "all twelve reviewed Queensview density parcels survive the carvers",
    ).toBe(12);
    expect(
      visualGeometry.issues.filter((issue) =>
        [...densityBuildingIds].some((buildingId) => issue.ownerId === buildingId),
      ),
      "every density building supplies auditable visual occlusion geometry",
    ).toEqual([]);
  });

  it("keeps every density solid outside exact ground carriageway and sidewalk geometry", () => {
    const groundRoadIds = new Set(
      roadSurfaces
        .filter((surface) => !isElevatedRoadSurface(surface))
        .map((surface) => surface.id),
    );
    const groundCorridors = visualGeometry.groundSurfaces.filter((surface) => {
      if (surface.kind === "road" || surface.kind === "sidewalk") {
        return groundRoadIds.has(surface.ownerId);
      }
      return (
        surface.kind === "junction" &&
        surface.ownerId.split("+").some((roadId) => groundRoadIds.has(roadId))
      );
    });
    const failures: string[] = [];
    let evaluatedPairs = 0;
    for (const building of densityBuildings) {
      for (const solid of building.solids) {
        const solidShape = obbShape(solid);
        const solidBounds = aabbOfShape(solidShape);
        for (const corridor of groundCorridors) {
          evaluatedPairs += 1;
          if (!boxesMeet(solidBounds, aabbOfShape(corridor.geometry))) continue;
          const overlapM2 = booleanIntersectionArea(solidShape, corridor.geometry);
          if (overlapM2 <= 0.02) continue;
          failures.push(
            `${building.id}/${solid.localId} overlaps ${corridor.id} by ${overlapM2.toFixed(3)}m²`,
          );
        }
      }
    }
    expect(evaluatedPairs).toBeGreaterThan(densityBuildings.length * 100);
    expect(failures.slice(0, 30)).toEqual([]);
  });

  it("keeps every density solid below or outside the exact elevated structure envelope", () => {
    const clearanceAt = createElevatedRoadGroundClearanceQuery(roadSurfaces);
    const failures: string[] = [];
    let sampleCount = 0;
    for (const building of densityBuildings) {
      for (const solid of building.solids) {
        for (const sample of solidSamples(solid, 0.5)) {
          sampleCount += 1;
          const obstruction = clearanceAt(sample, 0, 0, true);
          if (!obstruction || obstruction.clearanceM >= building.heightM + 0.2) {
            continue;
          }
          failures.push(
            `${building.id}/${solid.localId} at (${sample.x.toFixed(2)}, ${sample.z.toFixed(2)}) reaches ${building.heightM.toFixed(2)}m into ${obstruction.surfaceId}/${obstruction.obstructionKind} with ${obstruction.clearanceM.toFixed(2)}m clearance`,
          );
        }
      }
    }
    expect(sampleCount).toBeGreaterThan(densityBuildings.length * 100);
    expect(failures.slice(0, 30)).toEqual([]);
  });

  it("keeps the complete largest-vehicle Queensview sweep clear of every density solid", () => {
    const densityObstacleById = new Map(
      staticObstacles
        .filter(
          (obstacle) =>
            obstacle.tag === "building" && densityBuildingIds.has(
              obstacle.id.includes(":solid:")
                ? obstacle.id.slice(0, obstacle.id.indexOf(":solid:"))
                : obstacle.id,
            ),
        )
        .map((obstacle) => [obstacle.id, obstacle]),
    );
    const densityObstacles: StaticObstacle[] = [];
    for (const building of densityBuildings) {
      for (const solid of building.solids) {
        const id = buildingSolidObstacleId(building, solid);
        const obstacle = densityObstacleById.get(id);
        expect(obstacle, `${id} exists in the production obstacle set`).toBeDefined();
        expect(obstacle?.kind, id).toBe("obb");
        if (obstacle?.kind === "obb") {
          expect(obstacle, `${id} uses the exact planned solid`).toMatchObject({
            x: solid.x,
            z: solid.z,
            ux: solid.ux,
            uz: solid.uz,
            halfU: solid.halfU,
            halfV: solid.halfV,
          });
          densityObstacles.push(obstacle);
        }
      }
    }

    const failures: string[] = [];
    let sampleCount = 0;
    const lanes = mapPack.laneGraph.lanes.filter((lane) =>
      lane.roadId.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX),
    );
    for (const lane of lanes) {
      const maximumCrossTrackM = Math.max(
        0,
        lane.widthM / 2 - maximumVehicleRadiusM,
      );
      const lateralOffsets = maximumCrossTrackM > 0.01
        ? [-maximumCrossTrackM, 0, maximumCrossTrackM]
        : [0];
      for (let pointIndex = 0; pointIndex + 1 < lane.centerline.length; pointIndex += 1) {
        const start = lane.centerline[pointIndex];
        const end = lane.centerline[pointIndex + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthM = Math.hypot(dx, dz);
        if (lengthM < 1e-8) continue;
        const forwardX = dx / lengthM;
        const forwardZ = dz / lengthM;
        const leftX = -forwardZ;
        const leftZ = forwardX;
        const steps = Math.max(1, Math.ceil(lengthM / 0.5));
        for (let step = 0; step <= steps; step += 1) {
          const amount = step / steps;
          const baseX = start.x + dx * amount;
          const baseZ = start.z + dz * amount;
          for (const lateralM of lateralOffsets) {
            const centreX = baseX + leftX * lateralM;
            const centreZ = baseZ + leftZ * lateralM;
            for (const longitudinalSign of [-1, 0, 1] as const) {
              sampleCount += 1;
              const x =
                centreX +
                forwardX * maximumVehicleHalfLengthM * longitudinalSign;
              const z =
                centreZ +
                forwardZ * maximumVehicleHalfLengthM * longitudinalSign;
              for (const obstacle of densityObstacles) {
                const distanceM = distanceToStaticObstacle(obstacle, x, z);
                if (distanceM + 1e-6 >= maximumVehicleRadiusM) continue;
                failures.push(
                  `${lane.id} point ${pointIndex}/${step} lateral ${lateralM.toFixed(2)} longitudinal ${longitudinalSign}: ${obstacle.id} within ${distanceM.toFixed(3)}m`,
                );
              }
            }
          }
        }
      }
    }
    expect(lanes.length).toBeGreaterThanOrEqual(20);
    expect(sampleCount).toBeGreaterThan(10_000);
    expect(failures.slice(0, 30)).toEqual([]);
  });

  it("keeps density solids out of every other production static obstacle", () => {
    const nonBuildingObstacles = staticObstacles.filter(
      (obstacle) => obstacle.tag !== "building",
    );
    const failures: string[] = [];
    let evaluatedPairs = 0;
    for (const building of densityBuildings) {
      for (const solid of building.solids) {
        const solidShape = obbShape(solid);
        const solidBounds = aabbOfShape(solidShape);
        for (const obstacle of nonBuildingObstacles) {
          const minimumElevationM = obstacle.minElevationM ?? Number.NEGATIVE_INFINITY;
          const maximumElevationM = obstacle.maxElevationM ?? Number.POSITIVE_INFINITY;
          if (maximumElevationM < 0 || minimumElevationM > building.heightM) continue;
          evaluatedPairs += 1;
          const otherShape = obstacleShape(obstacle);
          if (!boxesMeet(solidBounds, aabbOfShape(otherShape))) continue;
          const overlapM2 = booleanIntersectionArea(solidShape, otherShape);
          if (overlapM2 <= 0.02) continue;
          failures.push(
            `${building.id}/${solid.localId} overlaps ${obstacle.id} (${obstacle.tag}) by ${overlapM2.toFixed(3)}m²`,
          );
        }
      }
    }
    expect(evaluatedPairs).toBeGreaterThan(densityBuildings.length * 10);
    expect(failures.slice(0, 30)).toEqual([]);
  });

  it("does not interpenetrate the new fabric with any other planned building", () => {
    const failures: string[] = [];
    const checked = new Set<string>();
    let evaluatedPairs = 0;
    for (const building of densityBuildings) {
      for (const solid of building.solids) {
        const shape = obbShape(solid);
        const bounds = aabbOfShape(shape);
        for (const otherBuilding of buildingLayout.buildings) {
          if (otherBuilding.id === building.id) continue;
          for (const otherSolid of otherBuilding.solids) {
            const leftKey = `${building.id}/${solid.localId}`;
            const rightKey = `${otherBuilding.id}/${otherSolid.localId}`;
            const pairKey = [leftKey, rightKey].sort().join("|");
            if (checked.has(pairKey)) continue;
            checked.add(pairKey);
            evaluatedPairs += 1;
            const otherShape = obbShape(otherSolid);
            if (!boxesMeet(bounds, aabbOfShape(otherShape))) continue;
            const overlapM2 = booleanIntersectionArea(shape, otherShape);
            if (overlapM2 <= 0.02) continue;
            failures.push(
              `${leftKey} overlaps ${rightKey} by ${overlapM2.toFixed(3)}m²`,
            );
          }
        }
      }
    }
    expect(evaluatedPairs).toBeGreaterThan(densityBuildings.length * 1_000);
    expect(failures.slice(0, 30)).toEqual([]);
  });
});
