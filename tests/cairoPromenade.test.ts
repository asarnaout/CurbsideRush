import { describe, expect, it } from "vitest";
import { shorelineParapetRuns } from "../app/game/GameCanvas";
import { getMapPack } from "../app/game/content";
import { buildStaticObstacles } from "../app/game/simulationAdapter";

/**
 * The corniche parapet renders the shoreline colliders verbatim, so these
 * tests pin the derivation the visuals stand on: every kept run hugs a water
 * polygon edge, all four open-waterfront road sides get railed, and the two
 * drivable bridges keep their portals open.
 */
describe("Cairo corniche parapet", () => {
  const pack = getMapPack("cairo-central-nile");
  const padding = Math.max(2, pack.geometry.shoulderWidth ?? 0);
  const obstacles = buildStaticObstacles(pack, {
    minX: -pack.geometry.worldSize.x / 2 - padding,
    maxX: pack.geometry.worldSize.x / 2 + padding,
    minZ: -pack.geometry.worldSize.z / 2 - padding,
    maxZ: pack.geometry.worldSize.z / 2 + padding,
  });
  const runs = shorelineParapetRuns(obstacles);
  const water = pack.geometry.waterBodies ?? [];

  it("rails both banks of both channels and nothing else", () => {
    // Achieved: 27 runs across the two channels. A collapse here means the
    // shoreline derivation changed; a jump means portal or edge plumbing
    // started leaking into the visible wall.
    expect(runs.length).toBeGreaterThanOrEqual(22);
    expect(runs.length).toBeLessThanOrEqual(40);
    for (const run of runs) {
      expect(run.id.includes("-portal-"), run.id).toBe(false);
      expect(Math.abs(run.z), run.id).toBeLessThanOrEqual(905);
      expect(run.halfU, run.id).toBeGreaterThanOrEqual(2);
    }
    const westRuns = runs.filter((run) =>
      run.id.startsWith("cairo-nile-west-channel"),
    );
    const eastRuns = runs.filter((run) =>
      run.id.startsWith("cairo-nile-east-channel"),
    );
    expect(westRuns.length).toBeGreaterThan(8);
    expect(eastRuns.length).toBeGreaterThan(8);
    expect(westRuns.length + eastRuns.length).toBe(runs.length);
  });

  it("keeps every parapet run on a water polygon edge", () => {
    const distanceToEdge = (x: number, z: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const body of water) {
        const polygon = body.polygon;
        for (let index = 0; index < polygon.length; index += 1) {
          const from = polygon[index];
          const to = polygon[(index + 1) % polygon.length];
          const dx = to.x - from.x;
          const dz = to.z - from.z;
          const lengthSq = dx * dx + dz * dz;
          const t =
            lengthSq > 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((x - from.x) * dx + (z - from.z) * dz) / lengthSq,
                  ),
                )
              : 0;
          best = Math.min(
            best,
            Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)),
          );
        }
      }
      return best;
    };
    for (const run of runs) {
      // Centre and both ends: a run that merely crosses an edge would pass a
      // centre-only check while sweeping its length across open ground.
      for (const t of [-1, 0, 1]) {
        const x = run.x + run.ux * run.halfU * t;
        const z = run.z + run.uz * run.halfU * t;
        expect(distanceToEdge(x, z), `${run.id} @t=${t}`).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it("rails the bank beside every open-waterfront road side", () => {
    // Road side -> the channel that side faces (cairoContent's
    // CAIRO_OPEN_WATERFRONT_SIDES, side -1 = -x/west of a south-to-north
    // polyline, +1 = +x/east).
    const cases: readonly {
      readonly surfaceId: string;
      readonly side: -1 | 1;
    }[] = [
      { surfaceId: "cairo-corniche-el-nil", side: -1 },
      { surfaceId: "cairo-saray-el-gezira", side: -1 },
      { surfaceId: "cairo-nile-island-drive", side: 1 },
      { surfaceId: "cairo-dokki-nile-drive", side: 1 },
    ];
    for (const { surfaceId, side } of cases) {
      const surface = pack.geometry.roadSurfaces.find(
        (candidate) => candidate.id === surfaceId,
      )!;
      // Sample the road's midspan; the bank must carry a parapet run within
      // 70 m on the open side (bank offsets run 10-60 m on these roads).
      let railed = 0;
      let samples = 0;
      for (
        let index = 1;
        index < surface.centerline.length - 1;
        index += 1
      ) {
        const point = surface.centerline[index];
        if (Math.abs(point.z) > 700) continue;
        samples += 1;
        const near = runs.some((run) => {
          const toRunX = run.x - point.x;
          const sideways = toRunX * side;
          return (
            sideways > 0 &&
            Math.hypot(run.x - point.x, run.z - point.z) <
              70 + run.halfU
          );
        });
        if (near) railed += 1;
      }
      expect(samples, surfaceId).toBeGreaterThan(2);
      expect(railed / samples, surfaceId).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("leaves both drivable bridge portals unwalled", () => {
    for (const surfaceId of [
      "cairo-qasr-el-nil-bridge",
      "cairo-al-galaa-bridge",
    ]) {
      const surface = pack.geometry.roadSurfaces.find(
        (candidate) => candidate.id === surfaceId,
      )!;
      for (const [from, to] of [
        [surface.centerline[0], surface.centerline[1]],
      ] as const) {
        const steps = 40;
        for (let step = 0; step <= steps; step += 1) {
          const x = from.x + ((to.x - from.x) * step) / steps;
          const z = from.z + ((to.z - from.z) * step) / steps;
          for (const run of runs) {
            // Point-in-OBB test against the parapet's plan footprint.
            const dx = x - run.x;
            const dz = z - run.z;
            const along = dx * run.ux + dz * run.uz;
            const across = dx * -run.uz + dz * run.ux;
            const inside =
              Math.abs(along) <= run.halfU && Math.abs(across) <= run.halfV;
            expect(inside, `${surfaceId} crosses ${run.id}`).toBe(false);
          }
        }
      }
    }
  });
});
