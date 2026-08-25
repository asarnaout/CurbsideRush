import { MultiMaterial, NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { TOKYO_FREE_DRIVE, TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import { buildTokyoStreetFurniture } from "../app/game/render/tokyoLandmarks";
import {
  TOKYO_CHOCHIN_POSTS,
  TOKYO_NEON_SIGN_GEOMETRY,
  TOKYO_NEON_SIGNS,
} from "../app/game/tokyoStreetFurniture";

const CHOCHIN_POST_RADIUS_M = 0.28;

describe("Tokyo street furniture", () => {
  it("keeps every chochin post outside every carriageway", () => {
    for (const post of TOKYO_CHOCHIN_POSTS) {
      for (const road of TOKYO_MAP_PACK.geometry.roadSurfaces ?? []) {
        const nearest = nearestPointOnPolyline(
          post.position,
          road.centerline,
        );
        const clearanceM = Math.hypot(
          post.position.x - nearest.x,
          post.position.z - nearest.z,
        );
        expect(
          clearanceM,
          `${post.id} overlaps ${road.id}`,
        ).toBeGreaterThanOrEqual(road.widthM / 2 + CHOCHIN_POST_RADIUS_M);
      }
    }
  });

  it("leaves the Niban-dori crossing in the Nakamise row open", () => {
    expect(
      TOKYO_CHOCHIN_POSTS.some(
        (post) => post.id === "jp-chochin-yokocho-5",
      ),
    ).toBe(false);
  });

  it("mounts neon faces in dark housings with arms reaching every facade", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    buildTokyoStreetFurniture({
      scene,
      staticSceneryFreeze: [],
      registerShadowCaster: () => {},
      registerDestructibleProp: () => {},
    });

    const masters = scene.meshes.filter((mesh) =>
      /^prop-master-tokyo-neon-\d$/.test(mesh.name),
    );
    const instances = scene.meshes.filter((mesh) =>
      /^prop-tokyo-neon-\d+$/.test(mesh.name),
    );
    expect(masters).toHaveLength(4);
    expect(instances).toHaveLength(TOKYO_NEON_SIGNS.length);

    const expectedBackZ =
      -TOKYO_NEON_SIGN_GEOMETRY.housingDepthM / 2 -
      TOKYO_NEON_SIGN_GEOMETRY.facadeArmReachM;
    const expectedFaceZ =
      TOKYO_NEON_SIGN_GEOMETRY.housingDepthM / 2 +
      TOKYO_NEON_SIGN_GEOMETRY.panelDepthM +
      0.001;
    for (const [variant, master] of masters.entries()) {
      expect(master.material).toBeInstanceOf(MultiMaterial);
      const materialNames = (master.material as MultiMaterial).subMaterials.map(
        (material) => material?.name,
      );
      expect(materialNames).toContain("tokyo-billboard-frame");
      expect(materialNames).toContain(`tokyo-neon-${variant}`);
      expect(master.getBoundingInfo().boundingBox.minimum.z).toBeCloseTo(
        expectedBackZ,
      );
      expect(master.getBoundingInfo().boundingBox.maximum.z).toBeCloseTo(
        expectedFaceZ,
      );
      // Five boxes: housing, luminous face, two arms and the facade plate.
      expect(master.getTotalVertices()).toBeGreaterThanOrEqual(5 * 24);
    }

    scene.dispose();
    engine.dispose();
  });

  it("bridges the narrow facade seam behind the visible green sign", () => {
    const plan = planMapBuildings(
      TOKYO_MAP_PACK,
      TOKYO_FREE_DRIVE.trafficSeed,
    );
    const green = TOKYO_NEON_SIGNS.find(
      (sign) => sign.id === "jp-neon-chuo-3",
    )!;
    const yaw = (green.headingDeg * Math.PI) / 180;
    const localZ =
      -TOKYO_NEON_SIGN_GEOMETRY.housingDepthM / 2 -
      TOKYO_NEON_SIGN_GEOMETRY.facadeArmReachM;
    const pointInsideBuilding = (x: number, z: number) =>
      plan.buildings.some((building) =>
        building.solids.some((solid) => {
          const dx = x - solid.x;
          const dz = z - solid.z;
          const localU = dx * solid.ux + dz * solid.uz;
          const localV = dx * solid.uz - dz * solid.ux;
          return (
            Math.abs(localU) <= solid.halfU &&
            Math.abs(localV) <= solid.halfV
          );
        }),
      );
    const worldPoint = (localX: number) => ({
      x:
        green.position.x +
        localX * Math.cos(yaw) +
        localZ * Math.sin(yaw),
      z:
        green.position.z -
        localX * Math.sin(yaw) +
        localZ * Math.cos(yaw),
    });

    // The old arm axis lands in the 1.98 m visual seam, but the new wall plate
    // reaches the adjacent facade without moving the correctly-placed panel.
    const centre = worldPoint(0);
    expect(pointInsideBuilding(centre.x, centre.z)).toBe(false);
    const plateTouches = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4]
      .map(worldPoint)
      .some((point) => pointInsideBuilding(point.x, point.z));
    expect(plateTouches).toBe(true);
  });
});
