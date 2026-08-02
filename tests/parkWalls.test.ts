import { describe, expect, it } from "vitest";
import { boxLengthYaw } from "../app/game/GameCanvas";
import { getMapPack } from "../app/game/content";
import { parkLayoutForLandmark } from "../app/game/parkLayouts";
import type { MapId } from "../app/game/types";

const MAPS: readonly MapId[] = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "cairo-central-nile",
];

describe("park wall meshes lie along their own runs", () => {
  it("lays a box's length down the direction it is given", () => {
    // A box's length is `width`, which is local +X, and rotation.y = θ lays
    // local +X along world (cos θ, −sin θ) — the torii builder's convention.
    // Axis-aligned directions cannot pin the SIGN of the yaw (a box turned
    // −90° is the box turned +90°), which is how a z-mirroring atan2(uz, ux)
    // slept until the first angled wall run — so pin a diagonal too.
    expect(boxLengthYaw(1, 0)).toBeCloseTo(0, 9);
    expect(boxLengthYaw(0, 1)).toBeCloseTo(-Math.PI / 2, 9);
    const railLength = Math.hypot(-45, 250);
    for (const [ux, uz] of [
      [-1, 0], // atan2's ±π branch — assert the direction, not the angle
      [0.6, 0.8],
      [0.6, -0.8],
      [-45 / railLength, 250 / railLength], // the opera rail's own direction
    ] as const) {
      const yaw = boxLengthYaw(ux, uz);
      expect(Math.cos(yaw)).toBeCloseTo(ux, 9);
      expect(-Math.sin(yaw)).toBeCloseTo(uz, 9);
    }
  });

  it("keeps every wall's drawn footprint inside its own park", () => {
    // What actually went wrong: Central Park's west wall drew as a 2,897 m
    // ledge running east-west from x ~ -1107 to +1790, straight across every
    // avenue, while its collider stayed correct. Reconstruct the mesh's world
    // AABB from the yaw the renderer uses and require it to stay in the park.
    const failures: string[] = [];
    for (const mapId of MAPS) {
      const pack = getMapPack(mapId);
      for (const landmark of pack.geometry.landmarks) {
        if (landmark.kind !== "park") continue;
        const halfX = landmark.size.x / 2;
        const halfZ = landmark.size.z / 2;
        for (const run of parkLayoutForLandmark(pack, landmark).wall) {
          const yaw = boxLengthYaw(run.ux, run.uz);
          // Local box half-extents (length along X, thickness along Z) swept
          // through the yaw give the world-space half-extents.
          const cos = Math.abs(Math.cos(yaw));
          const sin = Math.abs(Math.sin(yaw));
          const spanX = run.halfU * cos + run.halfV * sin;
          const spanZ = run.halfU * sin + run.halfV * cos;
          const overX = Math.abs(run.x - landmark.center.x) + spanX - halfX;
          const overZ = Math.abs(run.z - landmark.center.z) + spanZ - halfZ;
          if (overX > 0.5 || overZ > 0.5) {
            failures.push(
              `${run.id} escapes its park by (${overX.toFixed(1)}, ${overZ.toFixed(1)})m`,
            );
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
