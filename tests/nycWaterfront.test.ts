import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { hashStringToSeed } from "../app/game/visuals";
import type { StaticObstacle } from "../app/game/types";

/**
 * NYC's Hudson/East River shoreline collider contract (plan Section 11.12,
 * `.claude/three-city-visual-gap-elimination-plan.md`) — the physics half of
 * the visual-gap plan's Section 11.7/11.8 water work. `content.test.ts`
 * already proves the *rendered* water polygons/esplanade seams close
 * correctly; this file proves the *collider* `simulationAdapter.ts` derives
 * from those same water bodies follows the visible shore, opens only at the
 * at-grade Harborline portal, remains continuous beneath high Queensview,
 * never crosses Riverside Drive, and never duplicates the world-edge fence.
 */

const pack = getMapPack("nyc-upper-west-side");
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
const hudsonShore = shoreRuns.filter((o) => o.id.startsWith("nyc-hudson-river-"));
const eastRiverShore = shoreRuns.filter((o) => o.id.startsWith("nyc-east-river-"));
const eastRiverPortals = portalRuns.filter((o) => o.id.startsWith("nyc-east-river-"));

const obbCorners = (o: ShoreObb): { x: number; z: number }[] => {
  const vx = o.uz;
  const vz = -o.ux;
  return [
    { x: o.x + o.ux * o.halfU + vx * o.halfV, z: o.z + o.uz * o.halfU + vz * o.halfV },
    { x: o.x - o.ux * o.halfU + vx * o.halfV, z: o.z - o.uz * o.halfU + vz * o.halfV },
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

describe("NYC waterfront shoreline collider", () => {
  it("has real, non-degenerate shore obstacles for the Hudson and East River", () => {
    expect(hudsonShore.length).toBeGreaterThan(0);
    expect(eastRiverShore.length).toBeGreaterThan(0);
    for (const run of [...hudsonShore, ...eastRiverShore]) {
      expect(run.halfU, run.id).toBeGreaterThan(0);
      expect(run.halfV, run.id).toBeCloseTo(0.75);
    }
  });

  it("keeps every shore run on its own water body's polygon edge (centre and both ends)", () => {
    const waterById = new Map((pack.geometry.waterBodies ?? []).map((w) => [w.id, w.polygon]));
    for (const run of shoreRuns) {
      const ownerId = run.id.split("-shore-")[0];
      const polygon = waterById.get(ownerId);
      expect(polygon, run.id).toBeTruthy();
      for (const t of [-1, 0, 1]) {
        const x = run.x + run.ux * run.halfU * t;
        const z = run.z + run.uz * run.halfU * t;
        expect(distanceToPolygonEdge(x, z, polygon!), `${run.id} @t=${t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("opens the East River shoreline only at at-grade Harborline, and nowhere on the Hudson", () => {
    // No `bridgePortalSurfaceIds` on nyc-hudson-river (nothing crosses it on
    // this map) -- its entire shore must stay a solid collider.
    expect(hudsonShore.some((o) => o.id.includes("-portal-"))).toBe(false);
    expect(portalRuns.every((o) => o.id.startsWith("nyc-east-river-")), "a portal exists on a non-East-River water body").toBe(
      true,
    );
    // A high deck passes over a continuous shoreline; only at-grade
    // Harborline receives the two water-portal side colliders.
    expect(eastRiverPortals.length).toBe(2);
    expect(eastRiverPortals.some((o) => o.id.includes("nyc-queensview-bridge"))).toBe(false);
    expect(eastRiverPortals.some((o) => o.id.includes("nyc-harborline-bridge"))).toBe(true);
  });

  it("leaves the at-grade Harborline bridge portal itself unwalled", () => {
    for (const bridgeId of ["nyc-harborline-bridge"]) {
      const surface = pack.geometry.roadSurfaces.find((candidate) => candidate.id === bridgeId)!;
      expect(surface, bridgeId).toBeTruthy();
      for (let index = 0; index < surface.centerline.length - 1; index += 1) {
        const from = surface.centerline[index];
        const to = surface.centerline[index + 1];
        const steps = 20;
        for (let step = 0; step <= steps; step += 1) {
          const x = from.x + ((to.x - from.x) * step) / steps;
          const z = from.z + ((to.z - from.z) * step) / steps;
          for (const run of eastRiverShore) {
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

  it("keeps the shoreline continuous in plan beneath high Queensview", () => {
    const bridge = pack.geometry.roadSurfaces.find(
      (surface) => surface.id === "nyc-queensview-bridge",
    );
    expect(bridge).toBeTruthy();
    expect(
      bridge!.centerline.some((point) => (point.elevationM ?? 0) >= 10),
    ).toBe(true);
    const runsAcrossQueensviewLatitude = eastRiverShore.flatMap((run) => {
      if (Math.abs(run.uz) < 1e-6) return [];
      const alongM = (-840 - run.z) / run.uz;
      if (Math.abs(alongM) > run.halfU + 0.01) return [];
      return [{ run, x: run.x + run.ux * alongM }];
    });
    expect(
      runsAcrossQueensviewLatitude.filter(({ x }) => x < 650),
      "Manhattan shoreline continues beneath Queensview",
    ).toHaveLength(1);
    expect(
      runsAcrossQueensviewLatitude.filter(({ x }) => x > 650),
      "Queens shoreline continues beneath Queensview",
    ).toHaveLength(1);
  });

  it("never crosses Riverside Drive with the Hudson shore collider", () => {
    const riverside = pack.geometry.roadSurfaces.find((s) => s.id === "nyc-riverside")!;
    expect(riverside).toBeTruthy();
    // Riverside Drive runs a straight north-south line at x=-1160 on this
    // map; the park (and the shore behind it) sit further west. A half-width
    // margin (the road's own carriageway, 11 m) is generous slack -- a real
    // crossing bug would land the shore obstacle's corner east of the
    // carriageway's own centreline, not just inside a hair of tolerance.
    const roadX = riverside.centerline[0].x;
    for (const p of riverside.centerline) expect(p.x, "nyc-riverside is not a straight north-south line as assumed").toBeCloseTo(roadX);
    for (const run of hudsonShore) {
      for (const corner of obbCorners(run)) {
        expect(corner.x, run.id).toBeLessThan(roadX - riverside.widthM / 2);
      }
    }
  });

  it("never duplicates the world-edge fence", () => {
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
    // Achieved today. A drop means a water body/bridge/park stopped
    // contributing colliders it used to; a rise means something new started
    // -- either is worth a deliberate look, not a silent drift.
    //
    // One run per polygon edge, split where a bridge portal cuts it. Both
    // rivers deliberately lost edges in issue #389: each park-facing shore is
    // now a single ruled bulkhead at that park's own rect edge (Hudson
    // 16 -> 14, keeping its wobble only beyond Riverside Park's two ends;
    // East River 20 -> 14, its whole Queens bank flat), which is what stopped
    // the water drawing over both lawns and left both park walls on grass.
    const byTag = new Map<string, number>();
    for (const o of obstacles) byTag.set(o.tag, (byTag.get(o.tag) ?? 0) + 1);
    expect(byTag.get("shoreline")).toBe(39);
    expect(byTag.get("worldEdge")).toBe(4);
    expect(shoreRuns.length).toBe(37);
    expect(portalRuns.length).toBe(2);
    expect(hudsonShore.length).toBe(14);
    expect(eastRiverShore.length).toBe(12);
  });
});
