import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import {
  buildParkLayout,
  CAIRO_OPERA_AXIS_X,
  CAIRO_OPERA_CROSS_Z,
  CAIRO_OPERA_PLAZA_RADIUS_M,
  CAIRO_OPERA_STREET_GATE_X,
  CAIRO_TAHRIR_PLAZA_RADIUS_M,
  parkLayoutForLandmark,
  resolveParkStyle,
  ROAD_DIVIDED_PARK_IDS,
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
    // sidewalkWidthM travels with the surface: `parkLayoutForLandmark` passes
    // the pack's own road list through, so a context that drops it measures a
    // different pavement band than the layout it is checking.
    const roadSurfaces = (pack.geometry.roadSurfaces ?? []).map((surface) => ({
      centerline: surface.centerline,
      widthM: surface.widthM,
      sidewalkWidthM: surface.sidewalkWidthM,
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
    // Twenty-eight — NYC's three original (Central Park now split into four
    // segments, net +3) plus Riverside and Joan of Arc plus the three-part
    // East River Esplanade plus Queensbridge Green, three Tokyo, two Cairo,
    // and London's Exhibition Road strip, its two garden squares and
    // Battersea Park, the royal park, and the islands of all six
    // roundabouts. Pinned so adding a park is a deliberate act, not a
    // surprise. 26 -> 28: the Kensington lawn (the walled greensward that
    // closes the 70 m concrete band between Kensington Road and the royal
    // park) and the Fitzrovia pocket green in the infill between Oxford
    // Street's and Euston Road's parcel rows. 28 -> 30: the Notting Hill
    // district's garden square and the Westbourne pocket green. 30 -> 33:
    // the museum quarter's three boulevard strips — lawn ribbons between
    // Gloucester Road / Cromwell's far-west reach and the set-back terraces
    // behind them (the owner's requested arrangement for that corner).
    // 33 -> 34: the St James's ribbon along The Mall's south kerb, the same
    // boulevard grammar at the palace. 34 -> 39: the round that made every
    // kerb green run its road end to end — the Cromwell ribbon's east half,
    // Notting Hill Gate's south ribbon in two segment-aligned rects, The
    // Mall's ribbon split into its own two, and the pocket that closes the
    // Gloucester / Kensington / West Carriage corner. 39 -> 43: the museums'
    // four forecourt lawns, the one place on this map where the answer to a
    // bare kerb is planting rather than a street wall (the buildings behind
    // are already the frontage, and they are landmarks, not parcels).
    // 43 -> 46: the V&A's north forecourt, and the two greens the eastern
    // half of that sweep chose over a street wall — St James's between The
    // Mall's civic stone and Whitehall's, and the palace garden. Both are
    // walled greenswards: the rule that an enclosed block reads as one thing
    // applies to a 30,000 m2 void as much as to a roundabout island.
    // 46 -> 48: Pembroke Crescent's island became three butt-joined lawn
    // tiles in place of the one 80 x 28 stamp that used to float in it.
    expect(parkCases().length).toBe(48);
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
    expect(styleOf("jp-gotokuji-temple")).toBe("temple_grounds");
    expect(styleOf("jp-shoin-shrine")).toBe("temple_grounds");
    expect(styleOf("cairo-tahrir-square")).toBe("civic_plaza");
    expect(styleOf("cairo-opera-grounds")).toBe("urban_greensward");
    // The id beats the size gate: `jp-temple-green` is 24x28, small enough to
    // be a pocket green by proportions alone, but it is a named temple green
    // and gets gravel and an approach rather than a lawn with a bench.
    expect(styleOf("jp-temple-green")).toBe("temple_grounds");
    // London's two turning-island greens went with the turning loops when
    // Chelsea and the King's Road gave both dead ends somewhere to go. Their
    // replacements are proper garden squares — the pocket-green style, which
    // is still the one that must never grow a solid perimeter.
    expect(styleOf("london-chelsea-square-green")).toBe("pocket_green");
    expect(styleOf("london-pembroke-green")).toBe("pocket_green");
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

  it("keeps opera-grounds planting, furniture and walls on the park side of the crossing corridor", () => {
    // El Gezira Street is authored through the Opera Grounds rectangle and
    // the lawn is clipped at its centreline. The park is in
    // ROAD_DIVIDED_PARK_IDS, so scatter, benches, lamps AND the perimeter
    // wall must all stay on the park-centre side — the road-proximity veto
    // alone once left a 4 m orphan wall run across the corridor.
    const opera = parkCases().find(
      (c) => c.landmark.id === "cairo-opera-grounds",
    );
    expect(opera).toBeDefined();
    if (!opera) return;
    expect(ROAD_DIVIDED_PARK_IDS.has(opera.landmark.id)).toBe(true);
    const { landmark, context, layout } = opera;
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
        for (const run of layout.wall) {
          for (const step of [-1, -0.5, 0, 0.5, 1]) {
            const point = {
              x: run.x + run.ux * run.halfU * step,
              z: run.z + run.uz * run.halfU * step,
            };
            expect(
              sideOf(point),
              `wall run ${run.id} reaches (${point.x.toFixed(1)}, ${point.z.toFixed(1)}) across the road`,
            ).toBe(parkSide);
          }
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

  it("keeps park walks smooth at driving scale", () => {
    // The spine wander was once sampled at a fixed 24 steps regardless of
    // park length — 4 m chords with ~15° corners on a ribbon barely 4 m wide,
    // which renders as a staircase. The chord budget scales with the park now.
    const limit = (8 * Math.PI) / 180;
    for (const { landmark, layout } of parkCases()) {
      for (const path of layout.paths) {
        for (let index = 0; index + 2 < path.points.length; index += 1) {
          const a = path.points[index];
          const b = path.points[index + 1];
          const c = path.points[index + 2];
          const into = Math.atan2(b.x - a.x, b.z - a.z);
          const outOf = Math.atan2(c.x - b.x, c.z - b.z);
          let turn = Math.abs(outOf - into);
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          expect(
            turn,
            `${landmark.id}/${path.id}: ${((turn * 180) / Math.PI).toFixed(1)}° corner at point ${index + 1}`,
          ).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("gives a big park a path network and full furniture", () => {
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
  });

  it("walls the big parks and never the small or road-bound ones", () => {
    const walled = new Map<string, number>();
    for (const { landmark, layout } of parkCases()) {
      walled.set(landmark.id, layout.wall.length);
    }
    // A solid ring around a garden square in the middle of a Chelsea block,
    // or across Tahrir's road-cut rectangle, is a hazard rather than a
    // boundary.
    expect(walled.get("london-chelsea-square-green")).toBe(0);
    expect(walled.get("london-pembroke-green")).toBe(0);
    expect(walled.get("cairo-tahrir-square")).toBe(0);
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
            // Each road's OWN pavement width where it has one, not the map's
            // default. Serpentine Road's is 2.4 m against London's 3.4, and
            // once the royal park opted into `wallsFollowRoadEdges` — walls
            // that clear the pavement band by the tightest legal margin
            // rather than a blanket 1.8 m — the map-wide figure stopped being
            // a conservative proxy and started failing walls that genuinely
            // clear the pavement. `staticColliders.test.ts` samples the real
            // band and remains the net that matters.
            const clearance =
              distanceToPolylineM(point, surface.centerline) -
              surface.widthM / 2 -
              (surface.sidewalkWidthM ?? context.sidewalkWidthM);
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
    // A long park earns crossings at a few hundred metres. Central Park
    // itself is now four shorter segments (one per side of the three real
    // transverse roads, which run through the gaps between segments rather
    // than through any one of them), so this landmark's own internal
    // crossings are fewer than when it was one 2.9 km rectangle — but it
    // still earns some, and each crossing is what opens the wall.
    const crossings = layout.paths.filter((p) => p.id.startsWith("cross-"));
    expect(crossings.length).toBeGreaterThanOrEqual(2);
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

describe("opera grounds formal garden", () => {
  const opera = () => {
    const found = parkCases().find(
      (c) => c.landmark.id === "cairo-opera-grounds",
    );
    expect(found).toBeDefined();
    return found;
  };
  const corridor = () => {
    const surface = getMapPack("cairo-central-nile").geometry.roadSurfaces?.find(
      (candidate) => candidate.id === "cairo-opera-corridor",
    );
    expect(surface).toBeDefined();
    return surface;
  };

  it("lays four straight arms that stop at the plaza rim", () => {
    const found = opera();
    if (!found) return;
    const ids = found.layout.paths.map((path) => path.id).sort();
    expect(ids).toEqual([
      "axis-north",
      "axis-south",
      "cross-east",
      "cross-west",
    ]);
    for (const path of found.layout.paths) {
      expect(path.points, path.id).toHaveLength(2);
      // Each arm's plaza-facing tip laps the disc by exactly half a metre.
      const nearest = Math.min(
        ...path.points.map((point) =>
          Math.hypot(
            point.x - CAIRO_OPERA_AXIS_X,
            point.z - CAIRO_OPERA_CROSS_Z,
          ),
        ),
      );
      expect(nearest, path.id).toBeCloseTo(CAIRO_OPERA_PLAZA_RADIUS_M - 0.5, 6);
    }
    for (const arm of found.layout.paths) {
      if (!arm.id.startsWith("axis")) continue;
      for (const point of arm.points) {
        expect(point.x, arm.id).toBe(CAIRO_OPERA_AXIS_X);
      }
    }
    // No arm's ribbon touches another arm's: the walks only ever meet the
    // disc, which is the whole reason the crossing flicker is gone.
    for (const first of found.layout.paths) {
      for (const second of found.layout.paths) {
        if (first.id >= second.id) continue;
        let closest = Infinity;
        for (let step = 0; step <= 50; step += 1) {
          const amount = step / 50;
          const [a, b] = first.points;
          const sample = {
            x: a.x + (b.x - a.x) * amount,
            z: a.z + (b.z - a.z) * amount,
          };
          closest = Math.min(
            closest,
            distanceToPolylineM(sample, second.points),
          );
        }
        expect(
          closest,
          `${first.id} ribbon reaches ${second.id}`,
        ).toBeGreaterThan(first.widthM / 2 + second.widthM / 2);
      }
    }
  });

  it("tiles the four parterre quadrants edge to edge", () => {
    // The beds ARE the quadrants: each runs from the walk centrelines out
    // to the park rectangle, and everything above — walks, disc, terrace,
    // the corridor's band — paints over it, so every visible bed edge is
    // flush with something real. The renderer clips the east pair to the
    // corridor's park side; the authored rects deliberately cross it.
    const found = opera();
    if (!found) return;
    const beds = found.layout.features.filter(
      (feature) => feature.kind === "parterre",
    );
    expect(beds).toHaveLength(4);
    const minX = found.landmark.center.x - found.landmark.size.x / 2;
    const maxX = found.landmark.center.x + found.landmark.size.x / 2;
    const minZ = found.landmark.center.z - found.landmark.size.z / 2;
    const maxZ = found.landmark.center.z + found.landmark.size.z / 2;
    const spans = beds.map((bed) => ({
      minX: bed.x - bed.sizeX / 2,
      maxX: bed.x + bed.sizeX / 2,
      minZ: bed.z - bed.sizeZ / 2,
      maxZ: bed.z + bed.sizeZ / 2,
    }));
    for (const xSide of [
      [minX, CAIRO_OPERA_AXIS_X],
      [CAIRO_OPERA_AXIS_X, maxX],
    ]) {
      for (const zSide of [
        [minZ, CAIRO_OPERA_CROSS_Z],
        [CAIRO_OPERA_CROSS_Z, maxZ],
      ]) {
        expect(
          spans.filter(
            (span) =>
              Math.abs(span.minX - xSide[0]) < 1e-6 &&
              Math.abs(span.maxX - xSide[1]) < 1e-6 &&
              Math.abs(span.minZ - zSide[0]) < 1e-6 &&
              Math.abs(span.maxZ - zSide[1]) < 1e-6,
          ),
          `no bed spans x[${xSide[0]}, ${xSide[1]}] z[${zSide[0]}, ${zSide[1]}]`,
        ).toHaveLength(1);
      }
    }
  });

  it("rails the corridor side with an angled wall gated at the street walk", () => {
    // The rect's east edge is road-vetoed down to stubs, so the boundary
    // follows the road instead: a rail parallel to the corridor at the same
    // clearance the veto enforces, opened where the cross-east walk exits
    // to the street — exactly like the west gate.
    const found = opera();
    const surface = corridor();
    if (!found || !surface) return;
    const roadRuns = found.layout.wall.filter((run) =>
      run.id.includes("-wall-road-"),
    );
    expect(roadRuns.length).toBeGreaterThanOrEqual(2);
    const endsOf = (run: (typeof roadRuns)[number]) => [
      { x: run.x - run.ux * run.halfU, z: run.z - run.uz * run.halfU },
      { x: run.x + run.ux * run.halfU, z: run.z + run.uz * run.halfU },
    ];
    // The gate splits the rail: whole runs both north and south of it.
    expect(
      roadRuns.some((run) =>
        endsOf(run).every((end) => end.z > CAIRO_OPERA_CROSS_Z),
      ),
    ).toBe(true);
    expect(
      roadRuns.some((run) =>
        endsOf(run).every((end) => end.z < CAIRO_OPERA_CROSS_Z),
      ),
    ).toBe(true);
    const gate = { x: CAIRO_OPERA_STREET_GATE_X, z: CAIRO_OPERA_CROSS_Z };
    for (const run of roadRuns) {
      const ends = endsOf(run);
      // Parallel to the corridor at a constant clearance past the walkable
      // band — recomputed from road data, so a road nudge fails by name.
      for (const point of [ends[0], { x: run.x, z: run.z }, ends[1]]) {
        const clearance = distanceToPolylineM(point, surface.centerline);
        expect(clearance).toBeGreaterThanOrEqual(
          surface.widthM / 2 + 3.4 + 1.8 - 1e-6,
        );
        expect(clearance).toBeLessThanOrEqual(surface.widthM / 2 + 3.4 + 3);
      }
      // The street-walk gate stays open.
      expect(distanceToPolylineM(gate, ends)).toBeGreaterThan(4);
    }
  });

  it("centres the plaza, obelisk, benches and allée on the opera axis", () => {
    const found = opera();
    const surface = corridor();
    if (!found || !surface) return;
    const plaza = found.layout.features.find(
      (feature) => feature.kind === "plaza",
    );
    expect(plaza).toBeDefined();
    if (!plaza) return;
    expect(plaza.solid).toBe(false);
    expect(plaza.x).toBe(CAIRO_OPERA_AXIS_X);
    expect(plaza.z).toBe(CAIRO_OPERA_CROSS_Z);
    expect(plaza.sizeX).toBe(CAIRO_OPERA_PLAZA_RADIUS_M * 2);

    const monuments = found.layout.placements.filter(
      (placement) => placement.kind === "monument",
    );
    expect(monuments).toHaveLength(1);
    expect(monuments[0].x).toBe(CAIRO_OPERA_AXIS_X);
    expect(monuments[0].z).toBe(CAIRO_OPERA_CROSS_Z);

    // Four benches ON the disc at the diagonals, each facing the obelisk —
    // the ground beyond the rim is planted bed, not lawn.
    const ringBenches = found.layout.placements.filter(
      (placement) =>
        placement.kind === "bench" &&
        Math.abs(
          Math.hypot(
            placement.x - CAIRO_OPERA_AXIS_X,
            placement.z - CAIRO_OPERA_CROSS_Z,
          ) -
            (CAIRO_OPERA_PLAZA_RADIUS_M - 1.7),
        ) < 1e-6,
    );
    expect(ringBenches).toHaveLength(4);
    for (const bench of ringBenches) {
      expect(bench.rotationY).toBeCloseTo(
        Math.atan2(
          CAIRO_OPERA_AXIS_X - bench.x,
          CAIRO_OPERA_CROSS_Z - bench.z,
        ),
        6,
      );
    }

    // The quadrant clearings starve pathFurniture, so the lamps are
    // authored: two pairs bracketing the axis walk, one pair on the cross.
    const lamps = found.layout.placements.filter(
      (placement) => placement.kind === "lamp",
    );
    expect(lamps).toHaveLength(6);
    expect(
      lamps.filter(
        (lamp) => Math.abs(Math.abs(lamp.x - CAIRO_OPERA_AXIS_X) - 2.75) < 1e-6,
      ),
    ).toHaveLength(4);
    expect(
      lamps.filter(
        (lamp) => Math.abs(Math.abs(lamp.z - CAIRO_OPERA_CROSS_Z) - 2.15) < 1e-6,
      ),
    ).toHaveLength(2);

    // Ten allée palms, five a side, mirrored about the axis.
    const palms = found.layout.placements.filter(
      (placement) =>
        placement.kind === "tree" &&
        Math.abs(Math.abs(placement.x - CAIRO_OPERA_AXIS_X) - 3.6) < 1e-9,
    );
    expect(palms).toHaveLength(10);
    const westRows = palms
      .filter((palm) => palm.x < CAIRO_OPERA_AXIS_X)
      .map((palm) => palm.z)
      .sort((a, b) => a - b);
    const eastRows = palms
      .filter((palm) => palm.x > CAIRO_OPERA_AXIS_X)
      .map((palm) => palm.z)
      .sort((a, b) => a - b);
    expect(westRows).toEqual(eastRows);
    expect(westRows).toHaveLength(5);

    // The east arm's street gate ends inside the corridor's pavement band —
    // proven against the road's own data, not the constant.
    const gate = { x: CAIRO_OPERA_STREET_GATE_X, z: CAIRO_OPERA_CROSS_Z };
    const gateDistance = distanceToPolylineM(gate, surface.centerline);
    expect(gateDistance).toBeGreaterThan(surface.widthM / 2);
    expect(gateDistance).toBeLessThanOrEqual(
      surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8),
    );
  });
});
