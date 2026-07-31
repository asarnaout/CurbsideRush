import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NullEngine, Scene, LoadAssetContainerAsync } from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import {
  biasCairoDecalMaterials,
  buildWaterPolygonGeometry,
  CAIRO_ELEVATED_DECK_THICKNESS_M,
  CAIRO_ELEVATED_DECK_Y,
  cairoWaterBoatObstacles,
  PARKED_CAR_SOURCES,
  WATER_BOAT_AIR_DRAFTS_M,
  CAIRO_DECAL_MATERIAL_NAMES,
  CAIRO_DECAL_Z_OFFSET_UNITS,
  CAIRO_STREET_WALL_URL_RE,
  cairoBridgePortalVisualAxis,
  cairoBridgeVisualAxis,
  CAIRO_DIRECTION_PANEL_DESIGN_V,
  cairoDirectionPanelFaceUv,
  cairoElevatedBridgePierPlacements,
  cairoFrontagePosition,
  cairoFrontageFootprintsOverlap,
  cairoTahrirFurnitureLayout,
  crosswalkStripeLayout,
  crowdClothingPaletteForMap,
  deterministicSceneryKeep,
  EGYPT_SIGNAL_BORDER_BARS,
  facadeGridCells,
  generateWaterBoatPlacements,
  SIGNAL_HOUSING_BOX,
  roadSurfaceWidthForMarking,
  roadSurfacePlacementForMarking,
  rotateBlockBuildingPlacements,
  trafficCameraHeadIds,
  waterBoatPoseAt,
} from "../app/game/GameCanvas";
import { generateRoadsidePropPlacements } from "../app/game/visuals";
import { buildingSetUrls } from "../app/game/buildingSets";
import { isPointInPolygon } from "../app/game/simulation";
import { authoredSignalAspectAt } from "../app/game/trafficSignals";
import { CAIRO_MAP_PACK } from "../app/game/cairoContent";

describe("Cairo water scenery", () => {
  const concave = [
    { x: -40, z: -60 },
    { x: 40, z: -60 },
    { x: 40, z: -5 },
    { x: 5, z: -5 },
    { x: 5, z: 60 },
    { x: -40, z: 60 },
  ] as const;

  it("triangulates a concave riverbank without bridging outside it", () => {
    const geometry = buildWaterPolygonGeometry([
      ...concave,
      concave[0],
    ]);
    expect(geometry.polygon).toHaveLength(concave.length);
    expect(geometry.indices).toHaveLength((concave.length - 2) * 3);
    expect(geometry.positions).toHaveLength(concave.length * 3);
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = geometry.indices[index] * 3;
      const b = geometry.indices[index + 1] * 3;
      const c = geometry.indices[index + 2] * 3;
      const ax = geometry.positions[b] - geometry.positions[a];
      const az = geometry.positions[b + 2] - geometry.positions[a + 2];
      const bx = geometry.positions[c] - geometry.positions[a];
      const bz = geometry.positions[c + 2] - geometry.positions[a + 2];
      expect(az * bx - ax * bz).toBeGreaterThan(0);
    }
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
    const landmark = CAIRO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    )!;
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const layout = cairoTahrirFurnitureLayout(landmark, surfaces);
    const checks = [
      ...layout.olives.map((position) => ({ position, radius: 1.9 })),
      ...layout.benches.map((position) => ({ position, radius: 1.5 })),
    ];
    for (const check of checks) {
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
              ((check.position.x - start.x) * dx +
                (check.position.z - start.z) * dz) /
                lengthSquared,
            ),
          );
          nearest = Math.min(
            nearest,
            Math.hypot(
              check.position.x - (start.x + dx * amount),
              check.position.z - (start.z + dz * amount),
            ),
          );
        }
        expect(nearest).toBeGreaterThanOrEqual(
          surface.widthM / 2 + check.radius,
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
  it("places parked silhouettes between carriageway and outer sidewalk edge", () => {
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
          kind: "parked-car",
          spacingM: 24,
          jitterM: 0,
          lateralMarginM: 1,
          curbOffsetM: 1.08,
          bothSides: false,
          alternateSides: true,
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

// The kerbside parked cars instance the traffic fleet's own glbs and tint a
// named body material slot. A silent rename in the glb would silently un-tint
// every parked car, so pin the names against the committed bytes.
describe("Cairo parked-car sources", () => {
  it("names real vehicle glbs and their body materials", () => {
    for (const source of PARKED_CAR_SOURCES) {
      const buf = fs.readFileSync(
        path.join(process.cwd(), "public", source.url),
      );
      const jsonLen = buf.readUInt32LE(12);
      const json = JSON.parse(
        buf.subarray(20, 20 + jsonLen).toString("utf8"),
      ) as { materials?: readonly { name?: string }[] };
      expect(
        (json.materials ?? []).map((material) => material.name),
        source.url,
      ).toContain(source.bodyMaterial);
    }
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
