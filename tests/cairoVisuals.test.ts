import { describe, expect, it } from "vitest";
import {
  buildWaterPolygonGeometry,
  cairoBridgePortalVisualAxis,
  cairoBridgeVisualAxis,
  cairoDirectionPanelUvTransform,
  cairoElevatedBridgePierPlacements,
  cairoFrontagePosition,
  cairoFrontageFootprintsOverlap,
  cairoTahrirFurnitureLayout,
  crosswalkStripeLayout,
  crowdClothingPaletteForMap,
  deterministicSceneryKeep,
  facadeGridCells,
  generateWaterBoatPlacements,
  roadSurfaceWidthForMarking,
  roadSurfacePlacementForMarking,
  rotateBlockBuildingPlacements,
  trafficCameraHeadIds,
  waterBoatPoseAt,
} from "../app/game/GameCanvas";
import { generateRoadsidePropPlacements } from "../app/game/visuals";
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
        generateWaterBoatPlacements(CAIRO_MAP_PACK.id, body).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("Cairo visual axes", () => {
  it("counter-rotates bilingual direction panels into an upright road view", () => {
    const uv = cairoDirectionPanelUvTransform();
    const transform = (u: number, v: number) => ({
      u: u * uv.uScale + uv.uOffset,
      v: v * uv.vScale + uv.vOffset,
    });

    expect(transform(0, 0)).toEqual({ u: 1, v: 1 });
    expect(transform(1, 1)).toEqual({ u: 0, v: 0 });
    expect(transform(0.5, 0.5)).toEqual({ u: 0.5, v: 0.5 });
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
