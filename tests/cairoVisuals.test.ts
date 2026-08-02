import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  NullEngine,
  Scene,
  LoadAssetContainerAsync,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { PROP_MODEL_REGISTRY } from "../app/game/modelLibrary";
import { resolveVenuePlacement } from "../app/game/simulationAdapter";
import {
  biasCairoDecalMaterials,
  CAIRO_DECAL_MATERIAL_NAMES,
  CAIRO_DECAL_Z_OFFSET_UNITS,
  CAIRO_STREET_WALL_URL_RE,
  CAIRO_DIRECTION_PANEL_DESIGN_V,
  cairoDirectionPanelFaceUv,
  cairoFrontagePosition,
  cairoFrontageFootprintsOverlap,
  cairoOperaTerracePolygon,
  cairoTahrirForecourtPolygon,
  clipRectToRoadSide,
  cairoTahrirFurnitureLayout,
  cairoTahrirLawnPolygon,
  CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M,
  CAIRO_TAHRIR_LAWN_EAST_TUCK_X,
  CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z,
  CAIRO_TAHRIR_LAWN_WEST_TUCK_X,
  crowdClothingPaletteForMap,
  deterministicSceneryKeep,
  facadeGridCells,
  PARK_BED_Y,
  PARK_LAWN_Y,
  PARK_PATH_Y,
  roadSideParkLawnPolygon,
  rotateBlockBuildingPlacements,
} from "../app/game/GameCanvas";
import {
  crosswalkStripeLayout,
  EGYPT_SIGNAL_BORDER_BARS,
  roadSurfacePlacementForMarking,
  roadSurfaceWidthForMarking,
  SIGNAL_HOUSING_BOX,
  trafficCameraHeadIds,
} from "../app/game/geometry/roadFurnitureLayout";
import {
  buildWaterPolygonGeometry,
  CAIRO_ELEVATED_DECK_THICKNESS_M,
  CAIRO_ELEVATED_DECK_Y,
  cairoBridgePortalVisualAxis,
  cairoBridgeVisualAxis,
  cairoElevatedBridgePierPlacements,
  cairoWaterBoatObstacles,
  generateWaterBoatPlacements,
  WATER_BOAT_AIR_DRAFTS_M,
  waterBoatPoseAt,
} from "../app/game/geometry/waterGeometry";
import {
  distanceToPolylineM,
  generateRoadsidePropPlacements,
} from "../app/game/visuals";
import { buildingSetUrls } from "../app/game/buildingSets";
import { isPointInPolygon } from "../app/game/simulation";
import { authoredSignalAspectAt } from "../app/game/trafficSignals";
import { CAIRO_MAP_PACK } from "../app/game/cairoContent";
import {
  CAIRO_OPERA_AXIS_X,
  CAIRO_OPERA_CROSS_Z,
  CAIRO_OPERA_TERRACE_NORTH_Z,
  CAIRO_TAHRIR_PLAZA_RADIUS_M,
  parkLayoutForLandmark,
} from "../app/game/parkLayouts";

describe("Cairo water scenery", () => {
  const concave = [
    { x: -40, z: -60 },
    { x: 40, z: -60 },
    { x: 40, z: -5 },
    { x: 5, z: -5 },
    { x: 5, z: 60 },
    { x: -40, z: 60 },
  ] as const;

  /**
   * The river is one flat sheet that nothing culls, so a flipped winding does
   * not drop a face — it aims every normal at the riverbed, the sun and the
   * sky half of the hemispheric light both drop out, and the Nile goes black
   * under a noon sun. Run through Babylon's own `ComputeNormals` rather than a
   * cross-product sign, because the sign that means "up" here is the negation
   * of the obvious one and pinning it that way is what let this ship wrong.
   */
  const expectSkyFacingNormals = (geometry: {
    readonly positions: readonly number[];
    readonly indices: readonly number[];
  }) => {
    const normals: number[] = [];
    VertexData.ComputeNormals(
      [...geometry.positions],
      [...geometry.indices],
      normals,
    );
    expect(normals.length).toBe(geometry.positions.length);
    for (let index = 1; index < normals.length; index += 3) {
      expect(normals[index]).toBeCloseTo(1, 6);
    }
  };

  it("triangulates a concave riverbank without bridging outside it", () => {
    const geometry = buildWaterPolygonGeometry([
      ...concave,
      concave[0],
    ]);
    expect(geometry.polygon).toHaveLength(concave.length);
    expect(geometry.indices).toHaveLength((concave.length - 2) * 3);
    expect(geometry.positions).toHaveLength(concave.length * 3);
    expectSkyFacingNormals(geometry);
  });

  it("rings a shore band inside the bank without moving the bank", () => {
    const band = 4;
    const plain = buildWaterPolygonGeometry([...concave, concave[0]]);
    const ringed = buildWaterPolygonGeometry(
      [...concave, concave[0]],
      undefined,
      band,
    );
    // The outline itself is untouched — the band grows inward, so nothing that
    // reads `polygon` (boat tracks, shoreline colliders) can shift under it.
    expect(ringed.polygon).toEqual(plain.polygon);
    expect(ringed.positions.slice(0, plain.positions.length)).toEqual(
      plain.positions,
    );
    expect(ringed.shoreFactors).toHaveLength(concave.length * 2);
    expect(ringed.shoreFactors.slice(0, concave.length)).toEqual(
      new Array(concave.length).fill(1),
    );
    expect(ringed.shoreFactors.slice(concave.length)).toEqual(
      new Array(concave.length).fill(0),
    );
    expectSkyFacingNormals(ringed);

    // The miter property: each inset vertex lies exactly the band's width off
    // the *lines* of its own two edges, inside the outline, and never closer
    // than the band to any edge. It sits further than the band from the two
    // segments at the concave notch, which is correct — there the nearest point
    // on each is the corner itself.
    const lineDistance = (
      point: { x: number; z: number },
      from: { x: number; z: number },
      to: { x: number; z: number },
    ) => {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      return (
        Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) /
        Math.hypot(dx, dz)
      );
    };
    for (let index = 0; index < concave.length; index += 1) {
      const inset = {
        x: ringed.positions[(concave.length + index) * 3],
        z: ringed.positions[(concave.length + index) * 3 + 2],
      };
      expect(isPointInPolygon(inset, concave)).toBe(true);
      const before = concave[(index - 1 + concave.length) % concave.length];
      const after = concave[(index + 1) % concave.length];
      expect(lineDistance(inset, before, concave[index])).toBeCloseTo(band, 6);
      expect(lineDistance(inset, concave[index], after)).toBeCloseTo(band, 6);
      for (let edge = 0; edge < concave.length; edge += 1) {
        expect(
          distanceToPolylineM(inset, [
            concave[edge],
            concave[(edge + 1) % concave.length],
          ]),
        ).toBeGreaterThanOrEqual(band - 1e-6);
      }
    }
  });

  it("goes without a shore band rather than folding a tight outline", () => {
    // A 6 m spit cannot hold a 5 m band either side of it: the inset walls
    // cross, and a ring built on them would knot. Falls back to the bare sheet.
    const spit = [
      { x: -3, z: -60 },
      { x: 3, z: -60 },
      { x: 3, z: 60 },
      { x: -3, z: 60 },
    ] as const;
    const geometry = buildWaterPolygonGeometry([...spit], undefined, 5);
    expect(geometry.shoreFactors).toEqual([]);
    expect(geometry.positions).toHaveLength(spit.length * 3);
    expectSkyFacingNormals(geometry);
  });

  it("places visual-only boats deterministically, in navigable water", () => {
    const body = {
      id: "cairo-test-channel",
      color: "#24738c",
      flowHeadingDeg: 8,
      polygon: [
        { x: -50, z: -220 },
        { x: 50, z: -220 },
        { x: 50, z: 220 },
        { x: -50, z: 220 },
      ],
    } as const;
    const first = generateWaterBoatPlacements("cairo-central-nile", body);
    expect(first).toEqual(
      generateWaterBoatPlacements("cairo-central-nile", body),
    );
    expect(first.length).toBeGreaterThan(0);
    for (const boat of first) {
      expect(isPointInPolygon(boat, body.polygon)).toBe(true);
      expect([0, 1, 2]).toContain(boat.variant);
      expect(boat.heading).toBeCloseTo((8 * Math.PI) / 180, 0);
      expect(boat.trackLengthM).toBeGreaterThan(24);
      expect(boat.speedMps).toBeGreaterThan(0);
      for (const seconds of [0, 17, 83, 241]) {
        const pose = waterBoatPoseAt(boat, seconds);
        expect(isPointInPolygon(pose, body.polygon)).toBe(true);
        expect(pose).toEqual(waterBoatPoseAt(boat, seconds));
      }
    }
  });

  it("triangulates both authored Nile channels completely", () => {
    const bodies = CAIRO_MAP_PACK.geometry.waterBodies ?? [];
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const geometry = buildWaterPolygonGeometry(body.polygon);
      expect(geometry.indices).toHaveLength(
        (geometry.polygon.length - 2) * 3,
      );
      expectSkyFacingNormals(geometry);
      expect(
        generateWaterBoatPlacements(
          CAIRO_MAP_PACK.id,
          body,
          cairoWaterBoatObstacles(CAIRO_MAP_PACK.geometry, body),
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  // The two drivable bridges have no underside — their road surface IS the
  // deck at water level — so a boat can never pass them; the elevated
  // expressway clears every mast and only its piers matter. These run the
  // renderer's own obstacle set through the real generator.
  it("keeps every boat track clear of bridge spans and piers", () => {
    const soffitY =
      CAIRO_ELEVATED_DECK_Y - CAIRO_ELEVATED_DECK_THICKNESS_M / 2;
    // The felucca is the only masted variant; its masthead must clear the
    // elevated deck it is allowed to pass beneath.
    expect(WATER_BOAT_AIR_DRAFTS_M[1]).toBeLessThan(soffitY);

    const bodies = CAIRO_MAP_PACK.geometry.waterBodies ?? [];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const obstacles = cairoWaterBoatObstacles(CAIRO_MAP_PACK.geometry, body);
      expect(obstacles.spans.length, body.id).toBeGreaterThan(0);
      const placements = generateWaterBoatPlacements(
        CAIRO_MAP_PACK.id,
        body,
        obstacles,
      );
      expect(placements.length, body.id).toBeGreaterThan(0);
      for (const [index, placement] of placements.entries()) {
        const dx = Math.sin(placement.heading);
        const dz = Math.cos(placement.heading);
        const steps = Math.max(2, Math.ceil(placement.trackLengthM));
        for (let step = 0; step <= steps; step += 1) {
          const along =
            placement.trackStartM + (placement.trackLengthM * step) / steps;
          const px = placement.x + dx * along;
          const pz = placement.z + dz * along;
          for (const span of obstacles.spans) {
            const u = Math.abs(
              (px - span.x) * span.ux + (pz - span.z) * span.uz,
            );
            const v = Math.abs(
              (px - span.x) * -span.uz + (pz - span.z) * span.ux,
            );
            expect(
              u > span.halfLengthM + 1.5 || v > span.halfWidthM + 1.5,
              `${body.id} boat ${index} inside a bridge span at along=${along.toFixed(1)}`,
            ).toBe(true);
          }
          for (const pier of obstacles.piers) {
            expect(
              Math.hypot(px - pier.x, pz - pier.z),
              `${body.id} boat ${index} through a pier at along=${along.toFixed(1)}`,
            ).toBeGreaterThan(pier.radiusM + 1.5);
          }
        }
      }
    }
  });
});

describe("Cairo visual axes", () => {
  it("prints the bilingual direction panel on the road face alone", () => {
    const faces = cairoDirectionPanelFaceUv();
    expect(faces).toHaveLength(6);

    // Face 0 is +Z, the side the face-road yaw turns at the carriageway, and
    // the side Babylon renders 180° round — so the design region arrives with
    // its corners swapped, which is what cancels that rotation.
    const [printed, ...rest] = faces;
    expect(printed.x).toBeGreaterThan(printed.z);
    expect(printed.y).toBeGreaterThan(printed.w);
    expect(Math.min(printed.y, printed.w)).toBeGreaterThanOrEqual(
      CAIRO_DIRECTION_PANEL_DESIGN_V,
    );

    // Every other face — the back above all — samples the bare aluminium half,
    // clear of the boundary so no mip level can smear the legend onto it.
    expect(rest).toHaveLength(5);
    for (const face of rest) {
      expect(face).toEqual(rest[0]);
      expect(Math.max(face.y, face.w)).toBeLessThan(
        CAIRO_DIRECTION_PANEL_DESIGN_V,
      );
    }
  });

  it("aligns scenic bridge parapets to authored or portal-road headings", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    for (const id of [
      "cairo-qasr-el-nil-bridge",
      "cairo-al-galaa-bridge",
    ]) {
      const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
        (candidate) => candidate.id === id,
      )!;
      const surface = surfaces.find((candidate) => candidate.id === id)!;
      const axis = cairoBridgeVisualAxis(landmark, surfaces);
      const start = surface.centerline[0];
      const end = surface.centerline.at(-1)!;
      const roadHeading = Math.atan2(end.x - start.x, end.z - start.z);
      expect(
        Math.cos(axis.headingRad - roadHeading),
        `${id} parapet axis`,
      ).toBeGreaterThan(0.999);
    }

    const elevated = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-sixth-october-bridge",
    )!;
    const axis = cairoBridgeVisualAxis(elevated, surfaces);
    expect(axis.headingRad).toBeCloseTo((96 * Math.PI) / 180, 8);
    expect(axis.boxYawRad).toBeCloseTo((6 * Math.PI) / 180, 8);
  });

  it("clips drivable bridge rails to the Nile before shoreline junctions", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const waters = CAIRO_MAP_PACK.geometry.waterBodies ?? [];
    for (const id of [
      "cairo-qasr-el-nil-bridge",
      "cairo-al-galaa-bridge",
    ]) {
      const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
        (candidate) => candidate.id === id,
      )!;
      const water = waters.find((candidate) =>
        candidate.bridgePortalSurfaceIds?.includes(id),
      )!;
      const fullAxis = cairoBridgeVisualAxis(landmark, surfaces);
      const railAxis = cairoBridgePortalVisualAxis(
        landmark,
        surfaces,
        waters,
      );
      const surface = surfaces.find((candidate) => candidate.id === id)!;
      const travel = {
        x: Math.sin(railAxis.headingRad),
        z: Math.cos(railAxis.headingRad),
      };

      expect(railAxis.lengthM, id).toBeLessThan(fullAxis.lengthM - 20);
      expect(railAxis.widthM, `${id} lateral offset`).toBeCloseTo(
        surface.widthM + 2 * (surface.sidewalkWidthM! + 0.4),
        8,
      );
      const railStart = {
        x: railAxis.center.x - travel.x * railAxis.lengthM / 2,
        z: railAxis.center.z - travel.z * railAxis.lengthM / 2,
      };
      const railEnd = {
        x: railAxis.center.x + travel.x * railAxis.lengthM / 2,
        z: railAxis.center.z + travel.z * railAxis.lengthM / 2,
      };
      expect(
        Math.hypot(
          railStart.x - surface.centerline[0].x,
          railStart.z - surface.centerline[0].z,
        ),
        `${id} start junction clearance`,
      ).toBeGreaterThan(15);
      expect(
        Math.hypot(
          railEnd.x - surface.centerline.at(-1)!.x,
          railEnd.z - surface.centerline.at(-1)!.z,
        ),
        `${id} end junction clearance`,
      ).toBeGreaterThan(15);
      for (const end of [-1, 1]) {
        const inside = {
          x:
            railAxis.center.x +
            travel.x * end * (railAxis.lengthM / 2 - 1.6),
          z:
            railAxis.center.z +
            travel.z * end * (railAxis.lengthM / 2 - 1.6),
        };
        const beyond = {
          x:
            railAxis.center.x +
            travel.x * end * (railAxis.lengthM / 2 - 1.4),
          z:
            railAxis.center.z +
            travel.z * end * (railAxis.lengthM / 2 - 1.4),
        };
        expect(isPointInPolygon(inside, water.polygon), `${id} inside`).toBe(
          true,
        );
        expect(isPointInPolygon(beyond, water.polygon), `${id} beyond`).toBe(
          false,
        );
      }
    }
  });

  it("lays zebra bars across the associated road and progresses with travel", () => {
    const layout = crosswalkStripeLayout({ x: 10, z: -20 }, 32, 11.2);
    const heading = (32 * Math.PI) / 180;
    const travel = { x: Math.sin(heading), z: Math.cos(heading) };
    const across = { x: Math.cos(heading), z: -Math.sin(heading) };
    const step = {
      x: layout[4].center.x - layout[3].center.x,
      z: layout[4].center.z - layout[3].center.z,
    };
    expect(step.x * travel.x + step.z * travel.z).toBeCloseTo(1.05, 8);
    expect(step.x * across.x + step.z * across.z).toBeCloseTo(0, 8);
    expect(layout[0].widthM).toBeCloseTo(11.2 * 0.82, 8);
    expect(layout[0].depthM).toBe(0.62);
    // Local +x is each stripe's long axis after Babylon yaw.
    const renderedLongAxis = {
      x: Math.cos(layout[0].rotationY),
      z: -Math.sin(layout[0].rotationY),
    };
    expect(
      renderedLongAxis.x * travel.x + renderedLongAxis.z * travel.z,
    ).toBeCloseTo(0, 8);
  });

  it("uses the associated approach surface width for Cairo road markings", () => {
    const control = CAIRO_MAP_PACK.laneGraph.controls.find((candidate) =>
      candidate.installations?.some(
        (installation) => installation.style === "crosswalk",
      ),
    )!;
    const installation = control.installations!.find(
      (candidate) => candidate.style === "crosswalk",
    )!;
    const width = roadSurfaceWidthForMarking(
      CAIRO_MAP_PACK,
      control,
      installation,
    );
    expect(
      CAIRO_MAP_PACK.geometry.roadSurfaces?.some(
        (surface) =>
          surface.widthM === width &&
          surface.laneIds.some((laneId) =>
            control.approaches?.some((approach) =>
              approach.laneIds.includes(laneId),
            ),
          ),
      ),
    ).toBe(true);
  });

  it("centres every zebra on its associated road surface", () => {
    for (const control of CAIRO_MAP_PACK.laneGraph.controls) {
      for (const installation of control.installations ?? []) {
        if (installation.style !== "crosswalk") continue;
        const placement = roadSurfacePlacementForMarking(
          CAIRO_MAP_PACK,
          control,
          installation,
        );
        const surface = CAIRO_MAP_PACK.geometry.roadSurfaces?.find(
          (candidate) => candidate.id === placement.surfaceId,
        );
        expect(surface, installation.id).toBeTruthy();
        let nearest = Number.POSITIVE_INFINITY;
        for (let index = 0; index + 1 < surface!.centerline.length; index += 1) {
          const start = surface!.centerline[index];
          const end = surface!.centerline[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount = Math.max(
            0,
            Math.min(
              1,
              ((placement.position.x - start.x) * dx +
                (placement.position.z - start.z) * dz) /
                lengthSquared,
            ),
          );
          nearest = Math.min(
            nearest,
            Math.hypot(
              placement.position.x - (start.x + dx * amount),
              placement.position.z - (start.z + dz * amount),
            ),
          );
        }
        expect(nearest, installation.id).toBeLessThan(1e-7);
      }
    }
  });

  it("omits elevated expressway piers from every drivable surface", () => {
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-sixth-october-bridge",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const placements = cairoElevatedBridgePierPlacements(
      cairoBridgeVisualAxis(landmark, surfaces),
      surfaces,
    );
    expect(placements.length).toBeGreaterThan(20);
    for (const pier of placements) {
      for (const surface of surfaces) {
        let nearest = Number.POSITIVE_INFINITY;
        for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
          const start = surface.centerline[index];
          const end = surface.centerline[index + 1];
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const lengthSquared = dx * dx + dz * dz;
          const amount = Math.max(
            0,
            Math.min(
              1,
              ((pier.position.x - start.x) * dx +
                (pier.position.z - start.z) * dz) /
                lengthSquared,
            ),
          );
          nearest = Math.min(
            nearest,
            Math.hypot(
              pier.position.x - (start.x + dx * amount),
              pier.position.z - (start.z + dz * amount),
            ),
          );
        }
        expect(
          nearest,
          `pier ${pier.index} vs ${surface.id}`,
        ).toBeGreaterThanOrEqual(surface.widthM / 2 + 1.15);
      }
    }
  });

  it("keeps Tahrir's visual furniture out of surrounding traffic", () => {
    const park = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    )!;
    const obelisk = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-obelisk",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const layout = cairoTahrirFurnitureLayout(obelisk.center, surfaces);
    const checks = [
      ...layout.olives.map((position) => ({ position, radius: 1.9 })),
      ...layout.benches.map((position) => ({ position, radius: 1.5 })),
    ];
    const nearestTo = (position: { x: number; z: number }, surface: (typeof surfaces)[number]) => {
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const lengthSquared = dx * dx + dz * dz;
        const amount = Math.max(
          0,
          Math.min(
            1,
            ((position.x - start.x) * dx + (position.z - start.z) * dz) /
              lengthSquared,
          ),
        );
        nearest = Math.min(
          nearest,
          Math.hypot(
            position.x - (start.x + dx * amount),
            position.z - (start.z + dz * amount),
          ),
        );
      }
      return nearest;
    };
    // Not just the carriageway: the pavement band too. A bench on the
    // kerbside pavement reads as street clutter, not park furniture.
    for (const check of checks) {
      for (const surface of surfaces) {
        expect(nearestTo(check.position, surface)).toBeGreaterThanOrEqual(
          surface.widthM / 2 +
            (surface.sidewalkWidthM ?? 2.8) +
            check.radius +
            1,
        );
      }
    }
    // The paving disc itself clears every pavement band entirely.
    for (const surface of surfaces) {
      expect(
        nearestTo(obelisk.center, surface),
        `plaza disc vs ${surface.id}`,
      ).toBeGreaterThanOrEqual(
        surface.widthM / 2 +
          (surface.sidewalkWidthM ?? 2.8) +
          CAIRO_TAHRIR_PLAZA_RADIUS_M,
      );
    }
    // The rings held as authored — settle() had nothing to rescue: benches
    // sit on the disc facing the obelisk, olives on the grass beyond it.
    for (const bench of layout.benches) {
      expect(
        Math.hypot(bench.x - obelisk.center.x, bench.z - obelisk.center.z),
      ).toBeLessThanOrEqual(CAIRO_TAHRIR_PLAZA_RADIUS_M - 1);
    }
    for (const olive of layout.olives) {
      const distance = Math.hypot(
        olive.x - obelisk.center.x,
        olive.z - obelisk.center.z,
      );
      expect(distance).toBeGreaterThanOrEqual(CAIRO_TAHRIR_PLAZA_RADIUS_M + 1);
      expect(distance).toBeLessThanOrEqual(CAIRO_TAHRIR_PLAZA_RADIUS_M + 5);
    }
    // And the whole ensemble stays on the park side of the road that cuts
    // the rectangle (Ramses) — nothing settles across the carriageway.
    const minX = park.center.x - park.size.x / 2;
    const maxX = park.center.x + park.size.x / 2;
    const minZ = park.center.z - park.size.z / 2;
    const maxZ = park.center.z + park.size.z / 2;
    for (const surface of surfaces) {
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        let crosses = false;
        for (let step = 0; step <= 200 && !crosses; step += 1) {
          const amount = step / 200;
          const x = start.x + (end.x - start.x) * amount;
          const z = start.z + (end.z - start.z) * amount;
          crosses =
            x > minX + 1e-3 &&
            x < maxX - 1e-3 &&
            z > minZ + 1e-3 &&
            z < maxZ - 1e-3;
        }
        if (!crosses) continue;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const sideOf = (point: { x: number; z: number }) =>
          Math.sign(dx * (point.z - start.z) - dz * (point.x - start.x));
        const parkSide = sideOf(park.center);
        expect(sideOf(obelisk.center)).toBe(parkSide);
        for (const check of checks) {
          expect(sideOf(check.position), `${surface.id} side`).toBe(parkSide);
        }
      }
    }
  });

  it("clips Tahrir's lawn to the plaza side of Ramses", () => {
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const polygon = cairoTahrirLawnPolygon(landmark, surfaces);
    // The lawn's envelope is the authored rect plus the west/south/east tucks.
    const minX = Math.min(
      landmark.center.x - landmark.size.x / 2,
      CAIRO_TAHRIR_LAWN_WEST_TUCK_X,
    );
    const maxX = Math.max(
      landmark.center.x + landmark.size.x / 2,
      CAIRO_TAHRIR_LAWN_EAST_TUCK_X,
    );
    const minZ = Math.min(
      landmark.center.z - landmark.size.z / 2,
      CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z,
    );
    const maxZ = landmark.center.z + landmark.size.z / 2;

    // Independent crossing detector (clamped-interval overlap rather than the
    // helper's Liang–Barsky), so a bug there cannot vouch for itself here.
    const crossings: {
      start: { x: number; z: number };
      end: { x: number; z: number };
      id: string;
    }[] = [];
    for (const surface of surfaces) {
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        let inside = false;
        for (let step = 0; step <= 200; step += 1) {
          const amount = step / 200;
          const x = start.x + (end.x - start.x) * amount;
          const z = start.z + (end.z - start.z) * amount;
          if (
            x > minX + 1e-3 &&
            x < maxX - 1e-3 &&
            z > minZ + 1e-3 &&
            z < maxZ - 1e-3
          ) {
            inside = true;
            break;
          }
        }
        if (inside) crossings.push({ start, end, id: surface.id });
      }
    }
    // Ramses is authored through the park; the clip must have work to do.
    expect(crossings.some((crossing) => crossing.id === "cairo-ramses")).toBe(
      true,
    );

    for (const vertex of polygon) {
      expect(vertex.x).toBeGreaterThanOrEqual(minX - 1e-6);
      expect(vertex.x).toBeLessThanOrEqual(maxX + 1e-6);
      expect(vertex.z).toBeGreaterThanOrEqual(minZ - 1e-6);
      expect(vertex.z).toBeLessThanOrEqual(maxZ + 1e-6);
    }
    for (const crossing of crossings) {
      const dx = crossing.end.x - crossing.start.x;
      const dz = crossing.end.z - crossing.start.z;
      const length = Math.hypot(dx, dz);
      const centerSign = Math.sign(
        dx * (landmark.center.z - crossing.start.z) -
          dz * (landmark.center.x - crossing.start.x),
      );
      let onLine = 0;
      for (const vertex of polygon) {
        const offsetM =
          ((dx * (vertex.z - crossing.start.z) -
            dz * (vertex.x - crossing.start.x)) /
            length) *
          centerSign;
        expect(
          offsetM,
          `${crossing.id} vertex (${vertex.x}, ${vertex.z})`,
        ).toBeGreaterThanOrEqual(-1e-6);
        if (Math.abs(offsetM) <= 1e-6) onLine += 1;
      }
      // The cut itself must be present: two vertices sit on the centreline.
      expect(onLine).toBeGreaterThanOrEqual(2);
    }

    // The clip trims a corner, it must not consume the park.
    expect(polygon.length).toBeGreaterThanOrEqual(5);
    let doubledArea = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      doubledArea += current.x * next.z - next.x * current.z;
    }
    expect(Math.abs(doubledArea) / 2).toBeGreaterThanOrEqual(3000);
  });

  it("tucks Tahrir's lawn under its flanking pavement bands", () => {
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const polygon = cairoTahrirLawnPolygon(landmark, surfaces);
    const qasrElAiny = surfaces.find(
      (surface) => surface.id === "cairo-qasr-el-ainy",
    );
    const qasrElNil = surfaces.find(
      (surface) => surface.id === "cairo-qasr-el-nil-street",
    );
    expect(qasrElAiny).toBeDefined();
    expect(qasrElNil).toBeDefined();
    if (!qasrElAiny || !qasrElNil) return;

    const westEdge = Math.min(...polygon.map((vertex) => vertex.x));
    const southEdge = Math.min(...polygon.map((vertex) => vertex.z));
    const northEdge = Math.max(...polygon.map((vertex) => vertex.z));
    expect(westEdge).toBe(CAIRO_TAHRIR_LAWN_WEST_TUCK_X);
    expect(southEdge).toBe(CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z);

    const interpolate = (
      line: readonly { x: number; z: number }[],
      along: "x" | "z",
      at: number,
    ): number | null => {
      const across = along === "x" ? "z" : "x";
      for (let index = 0; index + 1 < line.length; index += 1) {
        const start = line[index];
        const end = line[index + 1];
        const span = end[along] - start[along];
        if (Math.abs(span) <= 1e-9) continue;
        const amount = (at - start[along]) / span;
        if (amount < 0 || amount > 1) continue;
        return start[across] + (end[across] - start[across]) * amount;
      }
      return null;
    };

    // West edge: between Qasr El-Ainy's centreline and its band's outer
    // edge at every z the lawn spans — covered by asphalt or band, with the
    // visible grass seam exactly on the band edge. This is what keeps the
    // bare grey wedge from coming back when a road node is nudged.
    for (let z = southEdge; z <= northEdge; z += 2) {
      const centerX = interpolate(qasrElAiny.centerline, "z", z);
      expect(centerX, `Qasr El-Ainy at z=${z}`).not.toBeNull();
      if (centerX === null) continue;
      expect(westEdge, `west edge at z=${z}`).toBeGreaterThan(centerX);
      expect(westEdge, `west edge at z=${z}`).toBeLessThanOrEqual(
        centerX + qasrElAiny.widthM / 2 + (qasrElAiny.sidewalkWidthM ?? 3.4),
      );
    }

    // South edge: same containment against Qasr El-Nil, along the span the
    // lawn actually reaches (Ramses' clip owns everything east of it).
    const southSpan = polygon
      .filter((vertex) => Math.abs(vertex.z - southEdge) <= 1e-6)
      .map((vertex) => vertex.x);
    expect(southSpan.length).toBeGreaterThanOrEqual(2);
    for (
      let x = Math.min(...southSpan);
      x <= Math.max(...southSpan);
      x += 1
    ) {
      const centerZ = interpolate(qasrElNil.centerline, "x", x);
      expect(centerZ, `Qasr El-Nil at x=${x}`).not.toBeNull();
      if (centerZ === null) continue;
      expect(southEdge, `south edge at x=${x}`).toBeGreaterThan(centerZ);
      expect(southEdge, `south edge at x=${x}`).toBeLessThanOrEqual(
        centerZ + qasrElNil.widthM / 2 + (qasrElNil.sidewalkWidthM ?? 3.4),
      );
    }

    // East edge: inside Ramses' band footprint wherever the lawn reaches it.
    // The rect edge at x 391 stood still while the diagonal band climbed
    // away, leaving a bare triangle north of the centreline cut — the tuck
    // fills it and the band paints the seam.
    const eastEdge = Math.max(...polygon.map((vertex) => vertex.x));
    expect(eastEdge).toBe(CAIRO_TAHRIR_LAWN_EAST_TUCK_X);
    const ramses = surfaces.find((surface) => surface.id === "cairo-ramses");
    expect(ramses).toBeDefined();
    if (!ramses) return;
    const eastSpan = polygon
      .filter((vertex) => Math.abs(vertex.x - eastEdge) <= 1e-6)
      .map((vertex) => vertex.z);
    expect(eastSpan.length).toBeGreaterThanOrEqual(2);
    for (let z = Math.min(...eastSpan); z <= Math.max(...eastSpan); z += 1) {
      expect(
        distanceToPolylineM({ x: eastEdge, z }, ramses.centerline),
        `east edge at z=${z.toFixed(1)}`,
      ).toBeLessThanOrEqual(
        ramses.widthM / 2 + (ramses.sidewalkWidthM ?? 3.4),
      );
    }
  });

  it("paves the ministries esplanade out to its sidewalks and the lawn", () => {
    const park = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    )!;
    const ministries = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-ministries",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const parkNorthZ = park.center.z + park.size.z / 2;
    const polygon = cairoTahrirForecourtPolygon(ministries, parkNorthZ, surfaces);
    expect(polygon.length).toBeGreaterThanOrEqual(4);

    // Every edge lands on a real boundary. South: the lawn line plus the
    // small anti-parallax lap; north: under the buildings; west: the same
    // in-band tuck as the lawn.
    const minX = Math.min(...polygon.map((vertex) => vertex.x));
    const minZ = Math.min(...polygon.map((vertex) => vertex.z));
    const maxZ = Math.max(...polygon.map((vertex) => vertex.z));
    expect(minZ).toBeCloseTo(
      parkNorthZ - CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M,
      6,
    );
    expect(CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M).toBeLessThanOrEqual(0.5);
    expect(maxZ).toBeCloseTo(
      ministries.center.z + ministries.size.z / 2,
      6,
    );
    expect(minX).toBe(CAIRO_TAHRIR_LAWN_WEST_TUCK_X);
    const qasrElAiny = surfaces.find(
      (surface) => surface.id === "cairo-qasr-el-ainy",
    )!;
    for (let z = Math.ceil(minZ); z <= maxZ; z += 2) {
      let centerX: number | null = null;
      for (
        let index = 0;
        index + 1 < qasrElAiny.centerline.length;
        index += 1
      ) {
        const start = qasrElAiny.centerline[index];
        const end = qasrElAiny.centerline[index + 1];
        const span = end.z - start.z;
        if (Math.abs(span) <= 1e-9) continue;
        const amount = (z - start.z) / span;
        if (amount < 0 || amount > 1) continue;
        centerX = start.x + (end.x - start.x) * amount;
        break;
      }
      expect(centerX, `Qasr El-Ainy at z=${z}`).not.toBeNull();
      if (centerX === null) continue;
      expect(minX, `west edge at z=${z}`).toBeGreaterThan(
        centerX + qasrElAiny.widthM / 2,
      );
      expect(minX, `west edge at z=${z}`).toBeLessThanOrEqual(
        centerX + qasrElAiny.widthM / 2 + (qasrElAiny.sidewalkWidthM ?? 3.4),
      );
    }

    // East: never past any crossing road's centreline — the seam is the
    // band's outer edge, same as the lawn's Ramses cut.
    const maxX = Math.max(...polygon.map((vertex) => vertex.x));
    for (const surface of surfaces) {
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        let crosses = false;
        for (let step = 0; step <= 200 && !crosses; step += 1) {
          const amount = step / 200;
          const x = start.x + (end.x - start.x) * amount;
          const z = start.z + (end.z - start.z) * amount;
          crosses =
            x > minX + 1e-3 &&
            x < maxX - 1e-3 &&
            z > minZ + 1e-3 &&
            z < maxZ - 1e-3;
        }
        if (!crosses) continue;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const anchorSign = Math.sign(
          dx * (ministries.center.z - start.z) -
            dz * (ministries.center.x - start.x),
        );
        for (const vertex of polygon) {
          const offset =
            (dx * (vertex.z - start.z) - dz * (vertex.x - start.x)) *
            anchorSign;
          expect(
            offset,
            `${surface.id} vertex (${vertex.x.toFixed(1)}, ${vertex.z.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }

    // And it actually fills the pocket: the strip west of the wing, the
    // colonnade front, the stretch before the frontage block, the alley.
    const inside = (point: { x: number; z: number }) => {
      let hit = false;
      for (
        let index = 0, previous = polygon.length - 1;
        index < polygon.length;
        previous = index, index += 1
      ) {
        const a = polygon[index];
        const b = polygon[previous];
        if (
          a.z > point.z !== b.z > point.z &&
          point.x <
            ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
        ) {
          hit = !hit;
        }
      }
      return hit;
    };
    for (const sample of [
      { x: 327, z: 12 },
      { x: 350, z: 12 },
      { x: 395, z: 12 },
      { x: 373.5, z: 25 },
    ]) {
      expect(
        inside(sample),
        `(${sample.x}, ${sample.z}) is unpaved`,
      ).toBe(true);
    }
  });

  it("clips the opera lawn to the park side of Montazah Al Gezira", () => {
    // El Gezira Street is authored diagonally through the Opera Grounds
    // rect; rendered raw, the rectangle surfaced as a grass wedge on the far
    // kerbside. The polygon must hug the rect everywhere except the corridor
    // cut, which runs along the centreline.
    const park = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-opera-grounds",
    );
    expect(park).toBeDefined();
    if (!park) return;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const polygon = roadSideParkLawnPolygon(park, surfaces);
    expect(polygon.length).toBeGreaterThanOrEqual(5);

    const minX = park.center.x - park.size.x / 2;
    const maxX = park.center.x + park.size.x / 2;
    const minZ = park.center.z - park.size.z / 2;
    const maxZ = park.center.z + park.size.z / 2;
    for (const vertex of polygon) {
      expect(vertex.x).toBeGreaterThanOrEqual(minX - 1e-6);
      expect(vertex.x).toBeLessThanOrEqual(maxX + 1e-6);
      expect(vertex.z).toBeGreaterThanOrEqual(minZ - 1e-6);
      expect(vertex.z).toBeLessThanOrEqual(maxZ + 1e-6);
    }

    // The three rect corners no road touches survive the clip...
    for (const corner of [
      { x: minX, z: minZ },
      { x: minX, z: maxZ },
      { x: maxX, z: minZ },
    ]) {
      expect(
        polygon.some(
          (vertex) =>
            Math.hypot(vertex.x - corner.x, vertex.z - corner.z) < 1e-6,
        ),
        `corner (${corner.x}, ${corner.z}) was clipped away`,
      ).toBe(true);
    }

    // ...and every vertex stays on the park side of every crossing segment.
    let crossings = 0;
    for (const surface of surfaces) {
      for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        let crosses = false;
        for (let step = 0; step <= 200 && !crosses; step += 1) {
          const amount = step / 200;
          const x = start.x + (end.x - start.x) * amount;
          const z = start.z + (end.z - start.z) * amount;
          crosses =
            x > minX + 1e-3 &&
            x < maxX - 1e-3 &&
            z > minZ + 1e-3 &&
            z < maxZ - 1e-3;
        }
        if (!crosses) continue;
        crossings += 1;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const cross = (point: { x: number; z: number }) =>
          dx * (point.z - start.z) - dz * (point.x - start.x);
        const parkSign = Math.sign(cross(park.center));
        let onLine = 0;
        for (const vertex of polygon) {
          const value = cross(vertex);
          expect(
            Math.sign(value) === parkSign || Math.abs(value) < 1e-4,
            `vertex (${vertex.x.toFixed(2)}, ${vertex.z.toFixed(2)}) is across the corridor`,
          ).toBe(true);
          if (Math.abs(value) < 1e-4) onLine += 1;
        }
        // The cut itself must exist: at least two vertices ride the line.
        expect(onLine).toBeGreaterThanOrEqual(2);
      }
    }
    expect(crossings).toBeGreaterThan(0);

    // The cut pulls the north-east corner well off the rect's east edge —
    // the centreline meets the north edge near x -256.5.
    const northVertices = polygon.filter(
      (vertex) => Math.abs(vertex.z - maxZ) < 1e-6,
    );
    expect(northVertices.length).toBeGreaterThan(0);
    expect(Math.max(...northVertices.map((vertex) => vertex.x))).toBeLessThan(
      -256,
    );
  });

  it("clips the east parterre quadrants at the corridor's centreline", () => {
    // The quadrant beds are authored across the road on purpose — the
    // renderer cuts each back to the park side with clipRectToRoadSide, the
    // same clip the lawn takes, so the visible bed seam lands on the band's
    // outer edge instead of tapering against the diagonal street.
    const park = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-opera-grounds",
    );
    expect(park).toBeDefined();
    if (!park) return;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const maxX = park.center.x + park.size.x / 2;
    const quadrants = [
      { minZ: CAIRO_OPERA_CROSS_Z, maxZ: park.center.z + park.size.z / 2 },
      { minZ: park.center.z - park.size.z / 2, maxZ: CAIRO_OPERA_CROSS_Z },
    ];
    let crossings = 0;
    for (const quadrant of quadrants) {
      const polygon = clipRectToRoadSide(
        CAIRO_OPERA_AXIS_X,
        maxX,
        quadrant.minZ,
        quadrant.maxZ,
        park.center,
        surfaces,
      );
      expect(polygon.length).toBeGreaterThanOrEqual(4);
      for (const surface of surfaces) {
        if (!surface.id.includes("opera-corridor")) continue;
        for (
          let index = 0;
          index + 1 < surface.centerline.length;
          index += 1
        ) {
          const start = surface.centerline[index];
          const end = surface.centerline[index + 1];
          // Only segments that actually cross this quadrant clip it — a
          // far-away segment's infinite line proves nothing.
          let crosses = false;
          for (let step = 0; step <= 200 && !crosses; step += 1) {
            const amount = step / 200;
            const x = start.x + (end.x - start.x) * amount;
            const z = start.z + (end.z - start.z) * amount;
            crosses =
              x > CAIRO_OPERA_AXIS_X + 1e-3 &&
              x < maxX - 1e-3 &&
              z > quadrant.minZ + 1e-3 &&
              z < quadrant.maxZ - 1e-3;
          }
          if (!crosses) continue;
          crossings += 1;
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const cross = (point: { x: number; z: number }) =>
            dx * (point.z - start.z) - dz * (point.x - start.x);
          const parkSign = Math.sign(cross(park.center));
          for (const vertex of polygon) {
            const value = cross(vertex);
            expect(
              Math.sign(value) === parkSign || Math.abs(value) < 1e-4,
              `bed vertex (${vertex.x.toFixed(2)}, ${vertex.z.toFixed(2)}) is across the corridor`,
            ).toBe(true);
          }
        }
      }
      // The clip actually bit: the corridor runs west of x -245 through
      // both quadrants' z-ranges, so each rect's north-east corner is gone.
      expect(
        polygon.every(
          (vertex) => Math.hypot(vertex.x - maxX, vertex.z - quadrant.maxZ) > 1,
        ),
      ).toBe(true);
    }
    // Vacuous without the road that motivates the clip.
    expect(crossings).toBeGreaterThan(0);
  });

  it("stacks park beds strictly between lawn and paths", () => {
    // The bed rung exists so a walk can cross a parterre or court without a
    // coplanar fight — the shimmer the Opera Grounds shipped with. Above the
    // paths the shoulder junction fill (0.0435) takes over; the whole park
    // band must stay under it.
    expect(PARK_LAWN_Y).toBeLessThan(PARK_BED_Y);
    expect(PARK_BED_Y).toBeLessThan(PARK_PATH_Y);
    expect(PARK_PATH_Y).toBeLessThan(0.0435);
  });

  it("paves the opera terrace from the facade to the garden", () => {
    const operaHouse = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-opera-house",
    );
    const park = CAIRO_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "cairo-opera-grounds",
    );
    expect(operaHouse).toBeDefined();
    expect(park).toBeDefined();
    if (!operaHouse || !park) return;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const polygon = cairoOperaTerracePolygon(operaHouse, surfaces);
    expect(polygon.length).toBeGreaterThanOrEqual(4);

    // Extents: two metres past each building flank, the park's own south
    // line, and the terrace line the garden's axis walk laps.
    const xs = polygon.map((vertex) => vertex.x);
    const zs = polygon.map((vertex) => vertex.z);
    expect(Math.min(...xs)).toBeCloseTo(
      operaHouse.center.x - operaHouse.size.x / 2 - 2,
      6,
    );
    expect(Math.max(...xs)).toBeCloseTo(
      operaHouse.center.x + operaHouse.size.x / 2 + 2,
      6,
    );
    expect(Math.min(...zs)).toBeCloseTo(park.center.z - park.size.z / 2, 6);
    expect(Math.max(...zs)).toBeCloseTo(CAIRO_OPERA_TERRACE_NORTH_Z, 6);

    // The garden's south walk arm ends lapping the paving by half a metre —
    // a gap here is a grey strip between walk and terrace.
    const layout = parkLayoutForLandmark(CAIRO_MAP_PACK, park);
    const axisSouth = layout.paths.find((path) => path.id === "axis-south");
    expect(axisSouth).toBeDefined();
    if (!axisSouth) return;
    const southEnd = Math.min(...axisSouth.points.map((point) => point.z));
    expect(southEnd).toBeCloseTo(CAIRO_OPERA_TERRACE_NORTH_Z - 0.5, 6);

    // The clip against the corridor is a no-op today and must stay one:
    // every vertex keeps a margin past the rendered pavement band,
    // recomputed from road data.
    for (const vertex of polygon) {
      for (const surface of surfaces) {
        if (!surface.id.includes("opera-corridor")) continue;
        expect(
          distanceToPolylineM(vertex, surface.centerline),
          `terrace vertex (${vertex.x.toFixed(1)}, ${vertex.z.toFixed(1)}) crowds the corridor`,
        ).toBeGreaterThanOrEqual(
          surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + 1.2,
        );
      }
    }
  });
});

describe("Cairo's rotated urban fabric", () => {
  it("rotates every procedural facade cell and its facing with the block", () => {
    const source = {
      center: { x: 25, z: -18 },
      size: { x: 60, z: 36 },
      density: 0.55,
    };
    const flat = facadeGridCells(source);
    const rotated = facadeGridCells({ ...source, headingDeg: 17 });
    const heading = (17 * Math.PI) / 180;
    for (const [index, cell] of rotated.entries()) {
      const localX = flat[index].x - source.center.x;
      const localZ = flat[index].z - source.center.z;
      expect(cell.x).toBeCloseTo(
        source.center.x +
          localX * Math.cos(heading) +
          localZ * Math.sin(heading),
        8,
      );
      expect(cell.z).toBeCloseTo(
        source.center.z -
          localX * Math.sin(heading) +
          localZ * Math.cos(heading),
        8,
      );
      expect(cell.rotationY).toBeCloseTo(heading, 8);
    }
  });

  it("rotates instanced street-wall placements in the same convention", () => {
    const placement = {
      modelId: "test",
      url: "/test.glb",
      x: 10,
      z: 0,
      yaw: 0.25,
      scale: 1,
      groundY: 0,
    };
    const [rotated] = rotateBlockBuildingPlacements(
      [placement],
      { x: 0, z: 0 },
      90,
    );
    expect(rotated.x).toBeCloseTo(0, 8);
    expect(rotated.z).toBeCloseTo(-10, 8);
    expect(rotated.yaw).toBeCloseTo(0.25 + Math.PI / 2, 8);
  });

  it("pulls Cairo filler toward a rotated block edge without leaving it", () => {
    const block = {
      center: { x: 25, z: -18 },
      size: { x: 60, z: 36 },
      headingDeg: 23,
      density: 0.55,
    };
    const cell = facadeGridCells(block)[4];
    const buildingWidthM = 10;
    const buildingDepthM = 8;
    const position = cairoFrontagePosition(
      block,
      cell,
      buildingWidthM,
      buildingDepthM,
    );
    const heading = (block.headingDeg * Math.PI) / 180;
    const dx = position.x - block.center.x;
    const dz = position.z - block.center.z;
    const localX = dx * Math.cos(heading) - dz * Math.sin(heading);
    const localZ = dx * Math.sin(heading) + dz * Math.cos(heading);
    const xInset = block.size.x / 2 - Math.abs(localX);
    const zInset = block.size.z / 2 - Math.abs(localZ);

    expect(xInset).toBeGreaterThanOrEqual(buildingWidthM / 2);
    expect(zInset).toBeGreaterThanOrEqual(buildingDepthM / 2);
    expect(
      Math.min(
        xInset - buildingWidthM / 2,
        zInset - buildingDepthM / 2,
      ),
    ).toBeCloseTo(1.15, 8);
    const detailNormal = {
      x: Math.sin(position.detailYawRad),
      z: Math.cos(position.detailYawRad),
    };
    expect(
      position.edgeAxis === "x"
        ? detailNormal.x
        : detailNormal.z,
    ).toBeCloseTo(position.outwardSign, 8);
  });

  it("forces long roadside strips onto their two carriageway-facing edges", () => {
    const block = {
      center: { x: 25, z: -18 },
      size: { x: 104, z: 30 },
      headingDeg: 23,
      frontageAxis: "z" as const,
      density: 0.82,
    };
    const placements = facadeGridCells(block).map((cell) =>
      cairoFrontagePosition(block, cell, 14, 7),
    );
    expect(placements.every((placement) => placement.edgeAxis === "z")).toBe(
      true,
    );
    expect(new Set(placements.map((placement) => placement.outwardSign))).toEqual(
      new Set([-1, 1]),
    );
  });

  it("rejects frontage cells that would overlap an already claimed slot", () => {
    const block = {
      center: { x: 25, z: -18 },
      size: { x: 60, z: 36 },
      headingDeg: 23,
      density: 0.9,
    };
    const accepted: Array<{
      placement: ReturnType<typeof cairoFrontagePosition>;
      widthM: number;
      depthM: number;
    }> = [];
    for (const cell of facadeGridCells(block)) {
      const widthM = cell.cellWidth * 0.7;
      const depthM = cell.cellDepth * 0.7;
      const candidate = {
        placement: cairoFrontagePosition(
          block,
          cell,
          widthM,
          depthM,
        ),
        widthM,
        depthM,
      };
      if (
        accepted.some((placed) =>
          cairoFrontageFootprintsOverlap(placed, candidate),
        )
      ) {
        continue;
      }
      accepted.push(candidate);
    }
    expect(accepted.length).toBeGreaterThanOrEqual(6);
    for (let first = 0; first < accepted.length; first += 1) {
      for (let second = first + 1; second < accepted.length; second += 1) {
        expect(
          cairoFrontageFootprintsOverlap(
            accepted[first],
            accepted[second],
          ),
        ).toBe(false);
      }
    }
  });

  it("deterministically halves procedural scenery on low-spec devices", () => {
    const keys = Array.from({ length: 200 }, (_, index) => `cairo-${index}`);
    const first = keys.filter((key) => deterministicSceneryKeep(key, 0.5));
    const second = keys.filter((key) => deterministicSceneryKeep(key, 0.5));
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(75);
    expect(first.length).toBeLessThan(125);
    expect(keys.every((key) => deterministicSceneryKeep(key, 1))).toBe(true);
    expect(keys.some((key) => deterministicSceneryKeep(key, 0))).toBe(false);
  });
});

describe("Cairo street identity", () => {
  // curbOffsetM parks a prop at the kerb — between the carriageway edge and the
  // outer sidewalk edge — instead of beyond the pavement like scattered
  // furniture. No shipped prop kind uses it now that Cairo's kerb-parked
  // vehicles are gone; the rule is kept (and pinned here, against a fixture
  // kind) as the placement hook any future kerb parking would need.
  it("places a kerb-offset prop between carriageway and outer sidewalk edge", () => {
    const placements = generateRoadsidePropPlacements({
      roadSurfaces: [
        {
          id: "test-cairo-road",
          centerline: [
            { x: 0, z: -100 },
            { x: 0, z: 100 },
          ],
          widthM: 10,
          sidewalkWidthM: 4,
        },
      ],
      blocks: [],
      landmarks: [],
      worldSize: { x: 300, z: 300 },
      shoulderWidthM: 4,
      seed: 42,
      kinds: [
        {
          kind: "kerb-parked-fixture",
          spacingM: 24,
          jitterM: 0,
          lateralMarginM: 1.05,
          curbOffsetM: 0.42,
          bothSides: false,
          variants: 1,
          faceRoad: true,
        },
      ],
    });
    expect(placements.length).toBeGreaterThan(3);
    for (const placement of placements) {
      const lateral = Math.abs(placement.x);
      expect(lateral).toBeGreaterThan(5);
      expect(lateral).toBeLessThan(9);
    }
  });

  it("uses a dedicated contemporary clothing palette", () => {
    const cairo = crowdClothingPaletteForMap("cairo-central-nile");
    expect(cairo).toHaveLength(6);
    expect(cairo).not.toEqual(
      crowdClothingPaletteForMap("nyc-upper-west-side"),
    );
  });

  it("treats Egyptian signal heads as camera-capable authored signals", () => {
    expect(
      trafficCameraHeadIds({
        approaches: [{ id: "north" }],
        installations: [
          {
            id: "cairo-head",
            style: "egypt_signal",
            role: "primary",
            approachIds: ["north"],
          },
        ],
      }),
    ).toEqual(new Set(["cairo-head"]));
  });

  it("borders the signal head without any surface contending for a pixel", () => {
    // The bug this pins: the yellow surround was one box larger than the
    // housing in all three dimensions, so it enclosed the head and the whole
    // look depended on the black face protruding 5 mm. Depth precision beats
    // 5 mm well inside the block, so the head rendered as a solid amber slab
    // that flickered on approach and only settled at the bar.
    const half = {
      x: SIGNAL_HOUSING_BOX.width / 2,
      y: SIGNAL_HOUSING_BOX.height / 2,
      z: SIGNAL_HOUSING_BOX.depth / 2,
    };
    expect(EGYPT_SIGNAL_BORDER_BARS.length).toBeGreaterThanOrEqual(4);

    for (const bar of EGYPT_SIGNAL_BORDER_BARS) {
      // Strictly outside the housing on x or y — never merely in front of it,
      // which is the arrangement that has to be decided by the depth buffer.
      const clearOnX =
        Math.abs(bar.x) - bar.width / 2 >= half.x - 1e-9;
      const clearOnY =
        Math.abs(bar.y) - bar.height / 2 >= half.y - 1e-9;
      expect(clearOnX || clearOnY, `${bar.id} overlaps the housing footprint`)
        .toBe(true);
      // Its face stands proud of the black face and stops behind the lens
      // plane, so the bezel reads as a bezel and touches neither. How far it
      // reaches *back* does not matter — being clear in x/y is what keeps it
      // out of the depth buffer's hands.
      expect(bar.z - bar.depth / 2, bar.id).toBeLessThan(-half.z);
      expect(bar.z - bar.depth / 2, bar.id).toBeGreaterThan(-0.25);
    }

    // The four bars still close into a continuous border, or it reads as
    // detached tabs rather than a frame.
    const sides = EGYPT_SIGNAL_BORDER_BARS.map((bar) => ({
      minX: bar.x - bar.width / 2,
      maxX: bar.x + bar.width / 2,
      minY: bar.y - bar.height / 2,
      maxY: bar.y + bar.height / 2,
    }));
    expect(Math.min(...sides.map((s) => s.minX))).toBeLessThan(-half.x);
    expect(Math.max(...sides.map((s) => s.maxX))).toBeGreaterThan(half.x);
    expect(Math.min(...sides.map((s) => s.minY))).toBeLessThan(-half.y);
    expect(Math.max(...sides.map((s) => s.maxY))).toBeGreaterThan(half.y);
    for (const corner of [
      { x: -half.x, y: -half.y },
      { x: -half.x, y: half.y },
      { x: half.x, y: -half.y },
      { x: half.x, y: half.y },
    ]) {
      expect(
        sides.some(
          (s) =>
            corner.x >= s.minX - 1e-9 &&
            corner.x <= s.maxX + 1e-9 &&
            corner.y >= s.minY - 1e-9 &&
            corner.y <= s.maxY + 1e-9,
        ),
        `corner ${corner.x},${corner.y} left open`,
      ).toBe(true);
    }
  });

  it("uses the non-UK signal sequence while preserving its visual style", () => {
    const input = {
      elapsedSeconds: 23.4,
      controlId: "cairo-signal",
      phaseGroup: "north",
      phaseGroups: ["north", "east"],
    } as const;
    expect(
      authoredSignalAspectAt({ ...input, style: "egypt_signal" }),
    ).toBe(authoredSignalAspectAt({ ...input, style: "nyc_signal" }));
  });
});

// At Cairo's radial junctions several arms meet at shallow angles, and a
// crossing set back by its own half-width lay inside a wider neighbour's
// carriageway — stripes ploughed through each other. The authoring now sets
// each arm back until its stripe envelope clears every other arm, and drops
// what cannot clear. These assertions run on the exact stripes the renderer
// draws (same placement snap, same heading, same layout call).
describe("Cairo crosswalks clear the junctions they serve", () => {
  interface StripeRect {
    x: number;
    z: number;
    yaw: number;
    halfW: number;
    halfD: number;
  }
  const separated = (a: StripeRect, b: StripeRect, marginM = 0): boolean => {
    const axesOf = (r: StripeRect) => {
      const cos = Math.cos(r.yaw);
      const sin = Math.sin(r.yaw);
      return [
        { x: cos, z: -sin, half: r.halfW },
        { x: sin, z: cos, half: r.halfD },
      ] as const;
    };
    const aAxes = axesOf(a);
    const bAxes = axesOf(b);
    return [...aAxes, ...bAxes].some((axis) => {
      const radius = (axes: typeof aAxes) =>
        axes[0].half * Math.abs(axes[0].x * axis.x + axes[0].z * axis.z) +
        axes[1].half * Math.abs(axes[1].x * axis.x + axes[1].z * axis.z);
      return (
        Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z) >
        radius(aAxes) + radius(bAxes) + marginM
      );
    });
  };
  const signals = CAIRO_MAP_PACK.laneGraph.controls.filter(
    (control) => control.type === "signal",
  );
  const crossingsOf = (control: (typeof signals)[number]) =>
    (control.installations ?? [])
      .filter((installation) => installation.style === "crosswalk")
      .map((installation) => {
        const placement = roadSurfacePlacementForMarking(
          CAIRO_MAP_PACK,
          control,
          installation,
        );
        const stripes = crosswalkStripeLayout(
          placement.position,
          installation.headingDeg,
          placement.widthM,
        ).map((stripe) => ({
          // Stripe local +x spans across traffic (widthM); +z is its depth.
          x: stripe.center.x,
          z: stripe.center.z,
          yaw: stripe.rotationY,
          halfW: stripe.widthM / 2,
          halfD: stripe.depthM / 2,
        }));
        return { installation, surfaceId: placement.surfaceId, stripes };
      });

  it("pins the stripe envelope the authoring mirrors", () => {
    const stripes = crosswalkStripeLayout({ x: 0, z: 0 }, 0, 10);
    expect(stripes).toHaveLength(7);
    const alongReach = Math.max(
      ...stripes.map((stripe) => Math.abs(stripe.center.z) + stripe.depthM / 2),
    );
    // cairoContent's CROSSING_ENVELOPE_HALF_M and span factor must equal these
    // or its setback maths silently diverges from what is drawn.
    expect(alongReach).toBeCloseTo(3 * 1.05 + 0.62 / 2, 6);
    expect(stripes[0].widthM).toBeCloseTo(10 * 0.82, 6);
  });

  it("never lets two arms' stripes touch", () => {
    expect(signals.length).toBeGreaterThanOrEqual(8);
    for (const control of signals) {
      const crossings = crossingsOf(control);
      for (let a = 0; a < crossings.length; a += 1) {
        for (let b = a + 1; b < crossings.length; b += 1) {
          for (const first of crossings[a].stripes) {
            for (const second of crossings[b].stripes) {
              expect(
                separated(first, second),
                `${crossings[a].installation.id} collides ${crossings[b].installation.id}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it("keeps every stripe out of the other arms' carriageways", () => {
    for (const control of signals) {
      const crossings = crossingsOf(control);
      const approachRoadIds = new Set(
        (control.approaches ?? []).flatMap((approach) =>
          approach.laneIds.map(
            (laneId) =>
              CAIRO_MAP_PACK.laneGraph.lanes.find(
                (lane) => lane.id === laneId,
              )!.roadId,
          ),
        ),
      );
      for (const crossing of crossings) {
        for (const roadId of approachRoadIds) {
          if (roadId === crossing.surfaceId) continue;
          const surface = CAIRO_MAP_PACK.geometry.roadSurfaces.find(
            (candidate) => candidate.id === roadId,
          )!;
          for (
            let index = 1;
            index < surface.centerline.length;
            index += 1
          ) {
            const start = surface.centerline[index - 1];
            const end = surface.centerline[index];
            const nearNode =
              Math.hypot(
                (start.x + end.x) / 2 - control.position.x,
                (start.z + end.z) / 2 - control.position.z,
              ) <
              Math.hypot(end.x - start.x, end.z - start.z) / 2 + 60;
            if (!nearNode) continue;
            const segHeading = Math.atan2(end.x - start.x, end.z - start.z);
            const band: StripeRect = {
              x: (start.x + end.x) / 2,
              z: (start.z + end.z) / 2,
              yaw: segHeading,
              halfW: surface.widthM / 2,
              halfD: Math.hypot(end.x - start.x, end.z - start.z) / 2,
            };
            for (const stripe of crossing.stripes) {
              // A near-collinear segment is the same corridor continuing under
              // another road id; the crossing legitimately spans it the way it
              // spans its own opposing lanes.
              let delta = Math.abs(stripe.yaw - segHeading) % Math.PI;
              if (delta > Math.PI / 2) delta = Math.PI - delta;
              if (Math.sin(delta) < 0.342) continue;
              expect(
                separated(stripe, band),
                `${crossing.installation.id} stripe inside ${roadId}'s carriageway`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});

// The Quaternius street-wall models carry brick patches / base bands / glazing
// as primitives 0.6-3.5mm proud of the wall primitives (one model exactly
// coplanar), which z-fights from ordinary viewing distance. The renderer pulls
// those decal materials toward the camera by two depth quanta; these pin the
// mechanism and its reach.
describe("Cairo decal depth bias", () => {
  registerBuiltInLoaders();

  it("pulls exactly the decal materials toward the camera", () => {
    const names = [
      "Bricks", "Dark", "DarkBrown", "DarkWood", "Glass",
      "Main", "White", "Light", "Windows", "Black", "Wood", "citybits_texture",
    ];
    const materials = names.map((name) => ({ name, zOffsetUnits: 0 }));
    expect(biasCairoDecalMaterials(materials)).toBe(5);
    for (const material of materials) {
      expect(material.zOffsetUnits, material.name).toBe(
        CAIRO_DECAL_MATERIAL_NAMES.includes(material.name)
          ? CAIRO_DECAL_Z_OFFSET_UNITS
          : 0,
      );
    }
    // gl.polygonOffset: negative units pull fragments toward the camera. A
    // positive value would push the decals behind the walls they decorate.
    expect(CAIRO_DECAL_Z_OFFSET_UNITS).toBeLessThan(0);
  });

  it("applies only to cairo model urls, never shared ones", () => {
    expect(CAIRO_STREET_WALL_URL_RE.test("/models/props/cairo-block-slim.glb")).toBe(true);
    expect(CAIRO_STREET_WALL_URL_RE.test("/models/props/cairo-residence-quaternius.glb")).toBe(true);
    expect(CAIRO_STREET_WALL_URL_RE.test("/models/props/nyc-brownstone-a.glb")).toBe(false);
    expect(CAIRO_STREET_WALL_URL_RE.test("/models/office.glb")).toBe(false);
    expect(CAIRO_STREET_WALL_URL_RE.test("/models/shop.glb")).toBe(false);
  });

  // If a model rename ever breaks the material-name match, the bias silently
  // stops applying and the flicker returns — so prove the names against the
  // real bytes of every street-wall glb.
  it("finds its decal materials inside every Quaternius street-wall glb", async () => {
    const urls = buildingSetUrls([
      "cairo-corniche", "cairo-downtown", "cairo-zamalek", "cairo-westbank",
    ]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(CAIRO_STREET_WALL_URL_RE.test(url), url).toBe(true);
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const buf = fs.readFileSync(path.join(process.cwd(), "public", url));
      const container = await LoadAssetContainerAsync(
        "data:model/gltf-binary;base64," + buf.toString("base64"),
        scene,
        { pluginExtension: ".glb" },
      );
      const biased = biasCairoDecalMaterials(container.materials);
      const quaternius = container.materials.some((m) => m.name === "Main");
      if (quaternius) {
        // Bricks + Dark at minimum; the rest of the decal family varies per
        // model (slim has no Glass, 4story no DarkWood).
        expect(biased, url).toBeGreaterThanOrEqual(3);
      } else {
        // Towers (obj2gltf palette) and KayKit atlas models carry none of the
        // decal names — the bias must leave them untouched.
        expect(biased, url).toBe(0);
      }
      for (const material of container.materials) {
        expect(material.zOffsetUnits, `${url} ${material.name}`).toBe(
          CAIRO_DECAL_MATERIAL_NAMES.includes(material.name)
            ? CAIRO_DECAL_Z_OFFSET_UNITS
            : 0,
        );
      }
      scene.dispose();
      engine.dispose();
    }
  });
});

/**
 * Cairo's venue buildings must face the road they are anchored to.
 *
 * The trap this guards: a venue model's facing depends on WHICH frame you
 * measure it in. instantiateProp overwrites the loader root's handedness
 * scaling (1,1,-1) with a uniform scale, so only the root's 180° Y-rotation
 * survives — an entrance authored on +Z lands on -Z in the placed frame. The
 * street wall's merged masters keep the intact reflection instead. Measuring
 * in the wrong frame is exactly how all 24 cairo-model venues shipped with
 * their doors to the open land and their brick-patch backs on the pavement.
 */
describe("Cairo venue buildings face their road", () => {
  // Detail (glazing/door) materials that mark the Quaternius kit's one dressed
  // face; the KayKit atlas models have a single material, so for those the
  // whole-mesh centroid carries the (real, measured) front bias instead.
  const DETAIL_MATERIALS = ["Windows", "Glass", "Wood", "DarkWood", "DarkBrown"];
  const CAIRO_VENUE_MODELS = [
    "cairo-residence-kay",
    "cairo-residence-quaternius",
    "cairo-shop",
    "cairo-office-block",
    "cairo-depot",
  ];

  it("puts each model's entrance on the holder's road-facing -X side", async () => {
    registerBuiltInLoaders();
    for (const modelKey of CAIRO_VENUE_MODELS) {
      const config = PROP_MODEL_REGISTRY[modelKey];
      expect(config, modelKey).toBeDefined();
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const buf = fs.readFileSync(path.join(process.cwd(), "public", config.url));
      const container = await LoadAssetContainerAsync(
        "data:model/gltf-binary;base64," + buf.toString("base64"),
        scene,
        { pluginExtension: ".glb" },
      );
      // Replicate instantiateProp at lane heading 0: holder rotated by the
      // yawOffset alone, root scaling overwritten (the wipe under test).
      const entries = container.instantiateModelsToScene(undefined, false, {
        doNotInstantiate: true,
      });
      const root = entries.rootNodes[0] as TransformNode;
      const holder = new TransformNode(`probe-${modelKey}`, scene);
      holder.rotation.y = config.yawOffset;
      root.parent = holder;
      root.scaling.set(config.scale, config.scale, config.scale);

      let detailN = 0;
      let detailX = 0;
      let detailZ = 0;
      let allN = 0;
      let allX = 0;
      let allZ = 0;
      for (const mesh of root.getChildMeshes()) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        if (!positions) continue;
        mesh.computeWorldMatrix(true);
        const world = mesh.getWorldMatrix();
        const detail = DETAIL_MATERIALS.includes(mesh.material?.name ?? "");
        for (let i = 0; i < positions.length; i += 3) {
          const p = Vector3.TransformCoordinates(
            new Vector3(positions[i], positions[i + 1], positions[i + 2]),
            world,
          );
          allN += 1;
          allX += p.x;
          allZ += p.z;
          if (detail) {
            detailN += 1;
            detailX += p.x;
            detailZ += p.z;
          }
        }
      }
      const meanX = detailN > 0 ? detailX / detailN : allX / allN;
      const meanZ = detailN > 0 ? detailZ / detailN : allZ / allN;
      // resolveVenuePlacement sets the building back along driver-right, so at
      // heading 0 the carriageway lies on -X of the holder. The dressed face
      // must lean that way, and lean x-wards, not sideways along the facade.
      expect(meanX, `${modelKey} entrance x`).toBeLessThan(-0.5);
      expect(Math.abs(meanZ), `${modelKey} sideways drift`).toBeLessThan(
        Math.abs(meanX),
      );
      scene.dispose();
      engine.dispose();
    }
  });

  it("points every cairo-model venue at its anchor road", () => {
    const pack = CAIRO_MAP_PACK as never;
    let checked = 0;
    for (const venue of CAIRO_MAP_PACK.geometry.gigVenues ?? []) {
      const modelKey =
        (venue as { modelId?: string }).modelId ?? venue.kind;
      if (!CAIRO_VENUE_MODELS.includes(modelKey)) continue;
      const placement = resolveVenuePlacement(pack, venue as never);
      expect(placement, venue.id).not.toBeNull();
      if (!placement) continue;
      // Placed-frame front: these models author their entrance on +Z, and the
      // instantiateProp frame (root scaling wiped, 180° root rotation kept)
      // lands it on -Z — so the door faces holder yaw + π.
      const front =
        placement.heading + PROP_MODEL_REGISTRY[modelKey].yawOffset + Math.PI;
      const toRoadX = placement.anchorX - placement.x;
      const toRoadZ = placement.anchorZ - placement.z;
      const length = Math.hypot(toRoadX, toRoadZ);
      expect(length, venue.id).toBeGreaterThan(1);
      const dot =
        (Math.sin(front) * toRoadX + Math.cos(front) * toRoadZ) / length;
      expect(dot, `${venue.id} (${venue.name}) faces its road`).toBeGreaterThan(
        0.95,
      );
      checked += 1;
    }
    // 3 residences + 6 shops + 6 offices + 6 depots + 3 more residences make
    // 24 of the 30 venues; the other 6 are restaurants on the shared diner.
    expect(checked).toBe(24);
  });
});
