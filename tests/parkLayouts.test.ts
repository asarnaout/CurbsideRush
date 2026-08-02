import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import {
  buildParkLayout,
  CAIRO_TAHRIR_PLAZA_RADIUS_M,
  parkLayoutForLandmark,
  resolveParkStyle,
  type ParkLandmarkInput,
  type ParkLayout,
  type ParkLayoutContext,
} from "../app/game/parkLayouts";
import { distanceToPolylineM, resolveMapVisualKey } from "../app/game/visuals";
import type { MapId } from "../app/game/types";

const MAPS: readonly MapId[] = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "cairo-central-nile",
];

interface ParkCase {
  readonly mapId: MapId;
  readonly landmark: ParkLandmarkInput;
  readonly context: ParkLayoutContext;
  readonly visualKey: string;
  /**
   * Built through the same entry point the renderer and the collider builder
   * use. Assembling a context by hand here once meant the tests ran against a
   * layout with no water in it, and cheerfully passed while the shipped one
   * grew a woodland out of Central Park's lake.
   */
  readonly layout: ParkLayout;
}

/** Every authored park on every shipped map, with the context the renderer uses. */
const parkCases = (): readonly ParkCase[] => {
  const cases: ParkCase[] = [];
  for (const mapId of MAPS) {
    const pack = getMapPack(mapId);
    const roadSurfaces = (pack.geometry.roadSurfaces ?? []).map((surface) => ({
      centerline: surface.centerline,
      widthM: surface.widthM,
    }));
    for (const landmark of pack.geometry.landmarks) {
      if (landmark.kind !== "park") continue;
      cases.push({
        mapId,
        landmark,
        visualKey: resolveMapVisualKey(mapId),
        context: {
          roadSurfaces,
          sidewalkWidthM: 3.4,
          waterPolygons: (pack.geometry.waterBodies ?? []).map((w) => w.polygon),
          seed: 4242,
        },
        layout: parkLayoutForLandmark(pack, landmark),
      });
    }
  }
  return cases;
};

describe("park layouts", () => {
  it("covers every authored park on every shipped map", () => {
    // The twelve parks this was written against — four NYC, three Tokyo, two
    // Cairo, and London's Exhibition Road strip plus its two roundabout
    // islands, which are generated rather than listed and are easy to forget.
    // Pinned so adding a park is a deliberate act, not a surprise.
    expect(parkCases().length).toBe(12);
  });

  it("is deterministic — two builds are identical", () => {
    for (const { landmark, visualKey, context } of parkCases()) {
      expect(
        buildParkLayout(landmark, visualKey, context),
        landmark.id,
      ).toEqual(buildParkLayout(landmark, visualKey, context));
    }
  });

  it("gives each authored park the style its shape and city imply", () => {
    const styleOf = (id: string) => {
      const found = parkCases().find((c) => c.landmark.id === id);
      expect(found, id).toBeDefined();
      return found ? resolveParkStyle(found.landmark, found.visualKey) : null;
    };
    expect(styleOf("nyc-joan-of-arc-park")).toBe("urban_greensward");
    expect(styleOf("nyc-verdi-green")).toBe("pocket_green");
    expect(styleOf("jp-gotokuji-temple")).toBe("temple_grounds");
    expect(styleOf("jp-shoin-shrine")).toBe("temple_grounds");
    expect(styleOf("cairo-tahrir-square")).toBe("civic_plaza");
    expect(styleOf("cairo-opera-grounds")).toBe("urban_greensward");
    // The id beats the size gate: `jp-temple-green` is 24x28, small enough to
    // be a pocket green by proportions alone, but it is a named temple green
    // and gets gravel and an approach rather than a lawn with a bench.
    expect(styleOf("jp-temple-green")).toBe("temple_grounds");
    // Both London islands are 12x12 — pocket greens, which is the style that
    // must never grow a solid perimeter inside a turning loop.
    expect(styleOf("london-brompton-loop-green")).toBe("pocket_green");
    expect(styleOf("london-gloucester-loop-green")).toBe("pocket_green");
  });

  it("keeps every placement inside its own park", () => {
    for (const { landmark, layout } of parkCases()) {
      const halfX = landmark.size.x / 2;
      const halfZ = landmark.size.z / 2;
      // Generous by the furniture offset, which pushes a bench off the path.
      const slack = 2.5;
      for (const placement of layout.placements) {
        const dx = Math.abs(placement.x - landmark.center.x);
        const dz = Math.abs(placement.z - landmark.center.z);
        expect(
          dx <= halfX + slack && dz <= halfZ + slack,
          `${landmark.id}: ${placement.kind} at (${placement.x.toFixed(1)}, ${placement.z.toFixed(1)}) is outside the park`,
        ).toBe(true);
      }
    }
  });

  it("never plants on a carriageway", () => {
    // Several authored parks are grazed or crossed by roads, and the lawn is
    // drawn UNDER them — so a tree in the middle of a street is the failure
    // this scatter has to avoid on its own.
    for (const { mapId, landmark, context, layout } of parkCases()) {
      for (const placement of layout.placements) {
        for (const surface of context.roadSurfaces) {
          const distance = distanceToPolylineM(placement, surface.centerline);
          expect(
            distance,
            `${mapId}/${landmark.id}: ${placement.kind} stands ${distance.toFixed(1)}m from a road centreline`,
          ).toBeGreaterThanOrEqual(surface.widthM / 2);
        }
      }
    }
  });

  it("keeps civic-plaza planting on the plaza side of a crossing road", () => {
    // Ramses is authored through Tahrir's rectangle and the lawn is clipped
    // at its centreline — so a palm that clears the carriageway by distance
    // can still stand on bare ground on the far kerbside. Everything must
    // stay on the park-centre side of every crossing segment.
    const tahrir = parkCases().find(
      (c) => c.landmark.id === "cairo-tahrir-square",
    );
    expect(tahrir).toBeDefined();
    if (!tahrir) return;
    const { landmark, context, layout } = tahrir;
    const minX = landmark.center.x - landmark.size.x / 2;
    const maxX = landmark.center.x + landmark.size.x / 2;
    const minZ = landmark.center.z - landmark.size.z / 2;
    const maxZ = landmark.center.z + landmark.size.z / 2;
    let crossings = 0;
    for (const surface of context.roadSurfaces) {
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
        const sideOf = (point: { x: number; z: number }) =>
          Math.sign(dx * (point.z - start.z) - dz * (point.x - start.x));
        const parkSide = sideOf(landmark.center);
        for (const placement of layout.placements) {
          expect(
            sideOf(placement),
            `${placement.kind} at (${placement.x.toFixed(1)}, ${placement.z.toFixed(1)}) is across the road`,
          ).toBe(parkSide);
        }
      }
    }
    // Vacuous without the road that motivates the rule.
    expect(crossings).toBeGreaterThan(0);
  });

  it("keeps planting off Tahrir's paved plaza", () => {
    // The disc is renderer-side (GameCanvas's Tahrir branch), ringed on the
    // obelisk landmark; `landmarkClearings` is what tells the scatter.
    const tahrir = parkCases().find(
      (c) => c.landmark.id === "cairo-tahrir-square",
    );
    expect(tahrir).toBeDefined();
    if (!tahrir) return;
    const obelisk = getMapPack("cairo-central-nile").geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-obelisk",
    );
    expect(obelisk).toBeDefined();
    if (!obelisk) return;
    for (const placement of tahrir.layout.placements) {
      expect(
        Math.hypot(
          placement.x - obelisk.center.x,
          placement.z - obelisk.center.z,
        ),
        `${placement.kind} stands on the plaza paving`,
      ).toBeGreaterThanOrEqual(CAIRO_TAHRIR_PLAZA_RADIUS_M + 1);
    }
  });

  it("keeps planting off its own paths", () => {
    for (const { landmark, layout } of parkCases()) {
      for (const placement of layout.placements) {
        if (placement.kind === "bench" || placement.kind === "lamp") continue;
        for (const path of layout.paths) {
          expect(
            distanceToPolylineM(placement, path.points),
            `${landmark.id}: ${placement.kind} stands on the ${path.id} path`,
          ).toBeGreaterThan(path.widthM / 2);
        }
      }
    }
  });

  it("gives a big park a path network and a token green none of the furniture", () => {
    const central = parkCases().find((c) => c.landmark.id === "nyc-central-park");
    expect(central).toBeDefined();
    if (central) {
      const layout = buildParkLayout(
        central.landmark,
        central.visualKey,
        central.context,
      );
      expect(layout.paths.length).toBeGreaterThan(0);
      expect(layout.placements.filter((p) => p.kind === "tree").length)
        .toBeGreaterThan(200);
      expect(layout.placements.some((p) => p.kind === "bench")).toBe(true);
      expect(layout.placements.some((p) => p.kind === "lamp")).toBe(true);
    }

    const verdi = parkCases().find((c) => c.landmark.id === "nyc-verdi-green");
    expect(verdi).toBeDefined();
    if (verdi) {
      const layout = buildParkLayout(verdi.landmark, verdi.visualKey, verdi.context);
      // A 40x24 traffic green has no room for a lamp-lit walk.
      expect(layout.placements.some((p) => p.kind === "bench")).toBe(false);
      expect(layout.placements.some((p) => p.kind === "lamp")).toBe(false);
      expect(layout.placements.some((p) => p.kind === "tree")).toBe(true);
    }
  });

  it("walls the big parks and never the small or road-bound ones", () => {
    const walled = new Map<string, number>();
    for (const { landmark, layout } of parkCases()) {
      walled.set(landmark.id, layout.wall.length);
    }
    // A solid ring inside a 12x12 turning-loop island, or across Tahrir's
    // road-cut rectangle, is a hazard rather than a boundary.
    expect(walled.get("london-brompton-loop-green")).toBe(0);
    expect(walled.get("london-gloucester-loop-green")).toBe(0);
    expect(walled.get("cairo-tahrir-square")).toBe(0);
    expect(walled.get("nyc-verdi-green")).toBe(0);
    expect(walled.get("jp-temple-green")).toBe(0);
    // The big ones do get one.
    expect(walled.get("nyc-central-park") ?? 0).toBeGreaterThan(0);
    expect(walled.get("nyc-riverside-park") ?? 0).toBeGreaterThan(0);
    expect(walled.get("nyc-joan-of-arc-park") ?? 0).toBeGreaterThan(0);
  });

  it("keeps every wall run clear of every carriageway and pavement band", () => {
    // This is the invariant `staticColliders.test.ts` will enforce against the
    // built world; checking it here too means a failure names the park.
    for (const { mapId, context, layout } of parkCases()) {
      for (const run of layout.wall) {
        for (const step of [-1, -0.5, 0, 0.5, 1]) {
          const point = {
            x: run.x + run.ux * run.halfU * step,
            z: run.z + run.uz * run.halfU * step,
          };
          for (const surface of context.roadSurfaces) {
            const clearance =
              distanceToPolylineM(point, surface.centerline) -
              surface.widthM / 2 -
              context.sidewalkWidthM;
            expect(
              clearance,
              `${mapId}/${run.id} sits ${clearance.toFixed(2)}m past the pavement band`,
            ).toBeGreaterThan(0.3);
          }
        }
      }
    }
  });

  it("never leaves a stretch of wall too long to find a way past", () => {
    // "Has an opening somewhere" is not the invariant that matters. Central
    // Park first came out with a single unbroken 2,897 m run down its western
    // edge and a gate only at each far end — technically enterable, 2.9 km
    // apart. What has to hold is that a gate is always reasonably near.
    const MAX_UNBROKEN_RUN_M = 420;
    for (const { layout } of parkCases()) {
      for (const run of layout.wall) {
        expect(
          run.halfU * 2,
          `${run.id} is an unbroken ${(run.halfU * 2).toFixed(0)}m of wall`,
        ).toBeLessThanOrEqual(MAX_UNBROKEN_RUN_M);
      }
    }
  });

  it("opens a gate wherever a path reaches the boundary", () => {
    const central = parkCases().find((c) => c.landmark.id === "nyc-central-park");
    expect(central).toBeDefined();
    if (!central) return;
    const layout = buildParkLayout(
      central.landmark,
      central.visualKey,
      central.context,
    );
    // A 2.9 km park earns crossings at a few hundred metres, like the real
    // transverses — and each crossing is what opens the wall.
    const crossings = layout.paths.filter((p) => p.id.startsWith("cross-"));
    expect(crossings.length).toBeGreaterThanOrEqual(8);
    expect(layout.wall.length).toBeGreaterThan(crossings.length);
  });

  it("never plants in a lake", () => {
    // The scatter is driven off the park rectangle and has nothing but the
    // water polygon to reject a candidate with — so Central Park's lake would
    // otherwise grow a woodland straight out of it.
    const central = parkCases().find((c) => c.landmark.id === "nyc-central-park");
    expect(central).toBeDefined();
    if (!central) return;
    const lake = getMapPack("nyc-upper-west-side").geometry.waterBodies?.[0];
    expect(lake, "NYC should carry Central Park's lake").toBeDefined();
    if (!lake) return;

    const inside = (point: { x: number; z: number }) => {
      let hit = false;
      const polygon = lake.polygon;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const a = polygon[i];
        const b = polygon[j];
        if (
          a.z > point.z !== b.z > point.z &&
          point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
        ) {
          hit = !hit;
        }
      }
      return hit;
    };

    const layout = buildParkLayout(
      central.landmark,
      central.visualKey,
      central.context,
    );
    for (const placement of layout.placements) {
      expect(
        inside(placement),
        `${placement.kind} stands in the lake at (${placement.x.toFixed(0)}, ${placement.z.toFixed(0)})`,
      ).toBe(false);
    }
  });

  it("gives the named parks their own pieces, and leaves them room", () => {
    const featuresOf = (id: string) =>
      parkCases().find((c) => c.landmark.id === id)?.layout.features ?? [];
    const kinds = (id: string) => new Set(featuresOf(id).map((f) => f.kind));

    // A temple approach without a torii is just a gravel path.
    expect(kinds("jp-gotokuji-temple")).toContain("torii");
    expect(kinds("jp-gotokuji-temple")).toContain("lantern");
    expect(kinds("jp-gotokuji-temple")).toContain("court");
    expect(kinds("jp-shoin-shrine")).toContain("torii");
    expect(kinds("cairo-opera-grounds")).toContain("parterre");
    expect(kinds("nyc-joan-of-arc-park")).toContain("plinth");
    // Nothing bespoke for a park with no character to state.
    expect(featuresOf("nyc-verdi-green")).toHaveLength(0);

    // Every solid piece must stand clear of its park's own walks, or the
    // driver meets masonry in the middle of a path. Monuments settle for this
    // reason; the test is what proves the settle actually found somewhere.
    for (const { landmark, layout } of parkCases()) {
      const solids = [
        ...layout.features.filter((f) => f.solid && f.kind !== "torii"),
        ...layout.placements
          .filter((p) => p.kind === "monument")
          .map((p) => ({ id: `${landmark.id}-monument`, x: p.x, z: p.z, sizeX: 3, sizeZ: 3 })),
      ];
      for (const solid of solids) {
        for (const path of layout.paths) {
          expect(
            distanceToPolylineM(solid, path.points),
            `${solid.id} blocks the ${path.id} path`,
          ).toBeGreaterThan(path.widthM / 2);
        }
      }
    }
  });

  it("honours an authored style over the derived one", () => {
    const base = parkCases()[0];
    const forced = buildParkLayout(
      { ...base.landmark, parkStyle: "temple_grounds" },
      base.visualKey,
      base.context,
    );
    expect(forced.style).toBe("temple_grounds");
  });
});
