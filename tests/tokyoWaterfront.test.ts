import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { hashStringToSeed } from "../app/game/visuals";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import type { StaticObstacle } from "../app/game/types";

/**
 * Tokyo's Sakuragawa shoreline collider contract (Tokyo expansion Phase 3,
 * `.claude/tokyo-city-expansion-plan.md` Section 4.4/8.3), cloned from
 * `tests/nycWaterfront.test.ts`'s invariants for a single river with THREE
 * bridge portals instead of NYC's two-river/two-bridge shape. Proves the
 * *collider* `simulationAdapter.ts` derives from `jp-sakuragawa` follows the
 * visible shore, opens exactly at the three real bridges and nowhere else,
 * never crosses the two riverside collectors, and never duplicates the
 * world-edge fence (the river deliberately runs the map's full z-span, so
 * both ends deliberately exit the world at the edge margin).
 */

const pack = getMapPack("tokyo-setagaya");
const padding = Math.max(2, pack.geometry.shoulderWidth ?? 0);
const bounds = {
  minX: -pack.geometry.worldSize.x / 2 - padding,
  maxX: pack.geometry.worldSize.x / 2 + padding,
  minZ: -pack.geometry.worldSize.z / 2 - padding,
  maxZ: pack.geometry.worldSize.z / 2 + padding,
};
const buildingLayout = planMapBuildings(pack, hashStringToSeed(pack.id));
const obstacles = buildStaticObstacles({ mapPack: pack, bounds, buildingLayout });

type ShoreObb = Extract<StaticObstacle, { kind: "obb" }>;

const shoreline = obstacles.filter((o): o is ShoreObb => o.kind === "obb" && o.tag === "shoreline");
const shoreRuns = shoreline.filter((o) => o.id.includes("-shore-"));
const portalRuns = shoreline.filter((o) => o.id.includes("-portal-"));
const sakuragawaShore = shoreRuns.filter((o) => o.id.startsWith("jp-sakuragawa-"));
const sakuragawaPortals = portalRuns.filter((o) => o.id.startsWith("jp-sakuragawa-"));

const BRIDGE_IDS = ["jp-sakura-ohashi", "jp-kawanaka-bashi", "jp-tsuki-ohashi"] as const;
const RIVERSIDE_ROAD_IDS = ["jp-kawate-dori", "jp-kawagishi-dori"] as const;

const obbCorners = (o: ShoreObb): { x: number; z: number }[] => {
  const vx = o.uz;
  const vz = -o.ux;
  return [
    { x: o.x + o.ux * o.halfU + vx * o.halfV, z: o.z + o.uz * o.halfU + vz * o.halfV },
    { x: o.x - o.ux * o.halfU + vx * o.halfV, z: o.z - o.ux * o.halfU + vz * o.halfV },
    { x: o.x - o.ux * o.halfU - vx * o.halfV, z: o.z - o.uz * o.halfU - vz * o.halfV },
    { x: o.x + o.ux * o.halfU - vx * o.halfV, z: o.z + o.uz * o.halfU - vz * o.halfV },
  ];
};

function distanceToPolygonEdge(x: number, z: number, polygon: readonly { x: number; z: number }[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)));
  }
  return best;
}

describe("Tokyo waterfront shoreline collider", () => {
  it("has real, non-degenerate shore obstacles for the Sakuragawa", () => {
    expect(sakuragawaShore.length).toBeGreaterThan(0);
    for (const run of sakuragawaShore) {
      expect(run.halfU, run.id).toBeGreaterThan(0);
      expect(run.halfV, run.id).toBeCloseTo(0.75);
    }
  });

  it("keeps every shore run on the Sakuragawa's own polygon edge (centre and both ends)", () => {
    const polygon = (pack.geometry.waterBodies ?? []).find((w) => w.id === "jp-sakuragawa")?.polygon;
    expect(polygon, "jp-sakuragawa water body").toBeTruthy();
    for (const run of sakuragawaShore) {
      for (const t of [-1, 0, 1]) {
        const x = run.x + run.ux * run.halfU * t;
        const z = run.z + run.uz * run.halfU * t;
        expect(distanceToPolygonEdge(x, z, polygon!), `${run.id} @t=${t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("opens the shoreline at exactly the three real bridges, and nowhere else", () => {
    expect(portalRuns.every((o) => o.id.startsWith("jp-sakuragawa-")), "a portal exists on a non-Sakuragawa water body").toBe(
      true,
    );
    // 3 bridges x 2 sides (left/right parapet) = 6, per jp-sakuragawa's own
    // bridgePortalSurfaceIds.
    expect(sakuragawaPortals.length).toBe(6);
    for (const bridgeId of BRIDGE_IDS) {
      expect(sakuragawaPortals.some((o) => o.id.includes(bridgeId)), bridgeId).toBe(true);
    }
  });

  it("leaves all three bridge portals themselves unwalled", () => {
    for (const bridgeId of BRIDGE_IDS) {
      const surface = pack.geometry.roadSurfaces.find((candidate) => candidate.id === bridgeId)!;
      expect(surface, bridgeId).toBeTruthy();
      for (let index = 0; index < surface.centerline.length - 1; index += 1) {
        const from = surface.centerline[index];
        const to = surface.centerline[index + 1];
        const steps = 20;
        for (let step = 0; step <= steps; step += 1) {
          const x = from.x + ((to.x - from.x) * step) / steps;
          const z = from.z + ((to.z - from.z) * step) / steps;
          for (const run of sakuragawaShore) {
            const dx = x - run.x;
            const dz = z - run.z;
            const along = dx * run.ux + dz * run.uz;
            const across = dx * -run.uz + dz * run.ux;
            const inside = Math.abs(along) <= run.halfU && Math.abs(across) <= run.halfV;
            expect(inside, `${bridgeId} crosses ${run.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("never crosses jp-kawate-dori or jp-kawagishi-dori with the shore collider", () => {
    // Both riverside collectors run close and roughly parallel to the bank
    // (Tokyo's equivalent of NYC's "never crosses Riverside Drive" case) —
    // rather than NYC's fixed-x hack (only valid for a dead-straight road),
    // this checks every shore-run corner clears each road's own carriageway
    // half-width from the NEAREST point on its centreline, which also covers
    // jp-kawagishi-dori's own gentle wobble.
    for (const roadId of RIVERSIDE_ROAD_IDS) {
      const road = pack.geometry.roadSurfaces.find((s) => s.id === roadId)!;
      expect(road, roadId).toBeTruthy();
      for (const run of sakuragawaShore) {
        for (const corner of obbCorners(run)) {
          const nearest = nearestPointOnPolyline(corner, road.centerline);
          const distanceM = Math.hypot(corner.x - nearest.x, corner.z - nearest.z);
          expect(distanceM, `${run.id} corner vs ${roadId}`).toBeGreaterThanOrEqual(road.widthM / 2);
        }
      }
    }
  });

  it("never duplicates the world-edge fence", () => {
    // The Sakuragawa deliberately runs the map's full z-span so both ends
    // exit the world at the edge margin (plan Section 8.3) — the world-edge
    // exemption this proves is load-bearing here, not just a defensive check.
    const worldEdges = obstacles.filter(
      (o): o is Extract<StaticObstacle, { kind: "aabb" }> => o.kind === "aabb" && o.tag === "worldEdge",
    );
    expect(worldEdges.length).toBeGreaterThan(0);
    for (const run of shoreline) {
      for (const corner of obbCorners(run)) {
        for (const fence of worldEdges) {
          const inside = corner.x >= fence.minX && corner.x <= fence.maxX && corner.z >= fence.minZ && corner.z <= fence.maxZ;
          expect(inside, `${run.id} corner overlaps ${fence.id}`).toBe(false);
        }
      }
    }
  });

  it("keeps the static obstacle tag census stable (regression-pinned)", () => {
    // Achieved today (Tokyo expansion Phase 3's first landing, dumped via a
    // scratchpad script reading `buildStaticObstacles`' real output, not
    // guessed). A drop means the water body/bridges stopped contributing
    // colliders they used to; a rise means something new started — either is
    // worth a deliberate look, the same discipline as NYC's own pin.
    //
    // 36 -> 46 (Tokyo expansion Phase 6, R4): Kitazawa-kōen's pond
    // (`jp-kitazawa-pond`) is a second `WaterBody`, and `buildStaticObstacles`
    // emits one "-shore-" collider per polygon edge — its 10-vertex closed
    // outline is 10 new shore runs and, having no `bridgePortalSurfaceIds`,
    // zero new portals. `sakuragawaShore`/`portalRuns` (filtered to the
    // river specifically, and to portals, which only the river has) are
    // unchanged.
    const byTag = new Map<string, number>();
    for (const o of obstacles) byTag.set(o.tag, (byTag.get(o.tag) ?? 0) + 1);
    expect(byTag.get("shoreline")).toBe(46);
    expect(shoreRuns.length).toBe(40);
    expect(portalRuns.length).toBe(6);
    expect(sakuragawaShore.length).toBe(30);
  });
});
