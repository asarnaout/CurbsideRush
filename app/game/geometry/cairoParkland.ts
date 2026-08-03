import { CAIRO_OPERA_TERRACE_NORTH_Z } from "../parkLayouts";
import { nearestPointOnPolyline } from "./roadStrips";
import type { StaticObstacle } from "../simulationAdapter";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";

/**
 * Cairo's shoreline parapet, decal material bias, and the Tahrir/Corniche/
 * Opera park polygon family: lawns, forecourts, terraces, and their
 * furniture layout.
 *
 * Pure by design — no Babylon, no DOM — so this geometry can be pinned in
 * plain node tests without instantiating a scene. `tests/architecture.test.ts`
 * enforces that this stays true for every file under `geometry/`. The Cairo
 * bridge visual-axis and pier-placement functions live in `waterGeometry.ts`
 * instead, despite the Cairo naming — see that file's header for why.
 */

/**
 * Yaw that lays a box's LENGTH along a given world direction.
 *
 * A box's length is its `width`, which is local **+X**, and under
 * `rotation.y = θ` this engine lays local +X along world **(cos θ, −sin θ)**
 * — the same convention the torii builder and its adapter collider both
 * encode. Two ways this has gone wrong, both silent:
 *
 * - Using the map's heading convention (`atan2(dx, dz)`, 0 = +z), which is
 *   90° off: Central Park's west wall drew as a 2,897 m east-west ledge
 *   straight through every avenue while its collider — which takes
 *   `ux`/`uz` directly as the OBB axis — stayed correct.
 * - Using `atan2(uz, ux)`, which mirrors the direction in z. That slept for
 *   as long as every wall run was axis-aligned (a box turned −90° is the
 *   box turned +90°) and surfaced the day the Opera Grounds laid the first
 *   road-parallel rail: drawn rotated ~20° off the street it was authored
 *   flush with, collider correct, seeing and hitting disagreeing again.
 */
export function boxLengthYaw(ux: number, uz: number): number {
  return Math.atan2(-uz, ux);
}
/** One straight run of visible corniche parapet, in the same frame as the
 * shoreline collider OBB it renders. */
export interface ShorelineParapetRun {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

/**
 * The corniche parapet's layout is exactly the shoreline embankment colliders
 * the simulation already stands along every Nile bank (`buildStaticObstacles`
 * tags them "shoreline"): rendering those runs means the wall you see IS the
 * wall the car stops at, and every bridge portal stays open because the
 * colliders already gap it. Excluded: `-portal-` runs (the drivable bridges
 * draw their own railings), runs hugging the world edge (|z| > 905 — collider
 * plumbing along the map border, not a visible bank), and slivers under 2 m.
 */
export function shorelineParapetRuns(
  obstacles: readonly StaticObstacle[],
): ShorelineParapetRun[] {
  const runs: ShorelineParapetRun[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.kind !== "obb" || obstacle.tag !== "shoreline") continue;
    if (!obstacle.id.includes("-shore-")) continue;
    if (Math.abs(obstacle.z) > 905 || obstacle.halfU < 2) continue;
    runs.push({
      id: obstacle.id,
      x: obstacle.x,
      z: obstacle.z,
      ux: obstacle.ux,
      uz: obstacle.uz,
      halfU: obstacle.halfU,
      halfV: obstacle.halfV,
    });
  }
  return runs;
}
/**
 * The Quaternius Cairo street-wall models carry their brick patches, dark base
 * bands and glazing as separate primitives floating 0.6–3.5 mm in front of the
 * wall primitives on the same plane (cairo-residence-quaternius has pairs at
 * exactly 0 mm — its converter's quantization grid collapsed the authored
 * offset). A 24-bit depth buffer stops resolving gaps that small from ~15–35 m
 * away, so the pale wall bleeds through the dark decal and flickers as the
 * camera moves. Pulling just the decal materials toward the camera by two
 * depth quanta (gl.polygonOffset units — negative is toward the camera, and
 * the bias scales with the local depth quantum, unlike a geometry nudge)
 * separates every pair at every distance. Applied per cairo-*.glb container
 * material, so no other city's models are touched.
 */
export const CAIRO_DECAL_Z_OFFSET_UNITS = -2;
export const CAIRO_DECAL_MATERIAL_NAMES: readonly string[] = [
  "Bricks",
  "Dark",
  "DarkBrown",
  "DarkWood",
  "Glass",
];
export const CAIRO_STREET_WALL_URL_RE = /\/cairo-[^/]+\.glb$/;
export function biasCairoDecalMaterials(
  materials: readonly { name: string; zOffsetUnits: number }[],
): number {
  let biased = 0;
  for (const material of materials) {
    if (!CAIRO_DECAL_MATERIAL_NAMES.includes(material.name)) continue;
    material.zOffsetUnits = CAIRO_DECAL_Z_OFFSET_UNITS;
    biased += 1;
  }
  return biased;
}
export interface CairoTahrirFurnitureLayout {
  readonly olives: readonly GameCanvasPoint[];
  readonly benches: readonly (GameCanvasPoint & {
    readonly rotationY: number;
  })[];
}

/**
 * True when any part of the segment a→b lies strictly inside the rectangle —
 * a Liang–Barsky interval test. Grazing a corner or running along an edge
 * does not count: a road that merely touches a park's boundary has nothing
 * of the park on its far side, so clipping against it would only shave the
 * lawn for no visible reason.
 */
function segmentCrossesRect(
  a: GameCanvasPoint,
  b: GameCanvasPoint,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let enter = 0;
  let exit = 1;
  const bounds: readonly (readonly [number, number])[] = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dz, a.z - minZ],
    [dz, maxZ - a.z],
  ];
  for (const [towards, clearance] of bounds) {
    if (Math.abs(towards) <= 1e-9) {
      if (clearance < 0) return false;
      continue;
    }
    const at = clearance / towards;
    if (towards < 0) {
      if (at > exit) return false;
      if (at > enter) enter = at;
    } else {
      if (at < enter) return false;
      if (at < exit) exit = at;
    }
  }
  return exit - enter > 1e-9;
}

/** Sutherland–Hodgman against one line: keeps the side `anchor` is on. */
function clipPolygonToLineSide(
  polygon: readonly GameCanvasPoint[],
  a: GameCanvasPoint,
  b: GameCanvasPoint,
  anchor: GameCanvasPoint,
): GameCanvasPoint[] {
  const side = (point: GameCanvasPoint) =>
    (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
  const anchorSide = side(anchor);
  // The anchor sitting on the line itself means there is no meaningful
  // "anchor's side" — leave the polygon alone rather than guess.
  if (Math.abs(anchorSide) <= 1e-6) return [...polygon];
  const orient = anchorSide > 0 ? 1 : -1;
  const clipped: GameCanvasPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentSide = side(current) * orient;
    const nextSide = side(next) * orient;
    if (currentSide >= -1e-9) clipped.push(current);
    if (
      (currentSide > 1e-9 && nextSide < -1e-9) ||
      (currentSide < -1e-9 && nextSide > 1e-9)
    ) {
      const amount = currentSide / (currentSide - nextSide);
      clipped.push({
        x: current.x + (next.x - current.x) * amount,
        z: current.z + (next.z - current.z) * amount,
      });
    }
  }
  return clipped;
}

/**
 * Where Tahrir's lawn tucks out under Qasr El-Ainy's pavement band. The kerb
 * face runs x 325.1→322.9 along the park, the band outer edge 328.5→326.3,
 * so 324.5 is under the band for most of the run and under the asphalt at
 * the far south — painted over either way. `tests/cairoVisuals.test.ts`
 * re-derives both bounds from the road data and pins the tuck.
 */
export const CAIRO_TAHRIR_LAWN_WEST_TUCK_X = 324.5;
/**
 * ...and out under Qasr El-Nil's band to the south, whose outer edge runs
 * z -93.3→-92.0 across the lawn's reachable span west of Ramses.
 */
export const CAIRO_TAHRIR_LAWN_SOUTH_TUCK_Z = -94;
/**
 * ...and out under Ramses' band to the east. The rect edge at x 391 left a
 * bare triangle against the diagonal band north of the centreline cut —
 * Ramses' band-west edge climbs from x 391 (z -6.5) to 401.6 (z 6) while
 * the rect edge stands still. 402 sits past the band edge over that whole
 * span, and above z 5.7 the ministries esplanade takes over.
 */
export const CAIRO_TAHRIR_LAWN_EAST_TUCK_X = 402;

/**
 * The lawn Tahrir actually shows: the authored rectangle, tucked out under
 * its west, south and east pavement bands, then cut back to the park-centre
 * side of every road segment that crosses it.
 *
 * Both moves exist because Cairo's base ground is paved grey and any ground
 * the lawn, band and asphalt leave uncovered reads as a bare strip. The
 * lawn draws below both the carriageway and the pavement band
 * (`PARK_LAWN_Y` under `ROAD_SHOULDER_Y` under `ROAD_SURFACE_Y`), so:
 *
 * - The tucked edges are painted over and the visible grass seam lands
 *   exactly on each band's outer edge — flush, with no sliver for strip
 *   mitres or junction fans to expose. (Authoring the tuck into the rect
 *   itself would instead drag the park's 18 m roadside-parcel exclusion
 *   across Qasr El-Ainy and demolish the street wall facing the park.)
 * - Ramses is authored straight through the rectangle, and a rectangle
 *   cannot hug a diagonal — rendered raw, its far corner surfaced as a
 *   grass triangle on the opposite curbside. The cut runs along the
 *   *centreline*, not the kerb: grass up to the centreline is painted over,
 *   nothing shows past it.
 */
export function cairoTahrirLawnPolygon(
  landmark: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
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
  return clipRectToRoadSide(
    minX,
    maxX,
    minZ,
    maxZ,
    landmark.center,
    roadSurfaces,
  );
}

/**
 * The lawn of a `ROAD_DIVIDED_PARK_IDS` park: the authored rectangle cut back
 * to the park-centre side of every road segment crossing it — Tahrir's clip
 * without Tahrir's band tucks, for parks whose other edges no road grazes.
 * Rendered raw, the Opera Grounds' rectangle surfaced as a grass wedge on the
 * far kerbside of the corridor authored through it.
 */
export function roadSideParkLawnPolygon(
  landmark: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  return clipRectToRoadSide(
    landmark.center.x - landmark.size.x / 2,
    landmark.center.x + landmark.size.x / 2,
    landmark.center.z - landmark.size.z / 2,
    landmark.center.z + landmark.size.z / 2,
    landmark.center,
    roadSurfaces,
  );
}

/**
 * The paved terrace between the opera house's garden colonnade and the
 * formal garden. The building's north 12 m stand inside the park rect, so
 * the paving must run from under its face (x inset 2 m from each flank)
 * north past the rect line to `CAIRO_OPERA_TERRACE_NORTH_Z`, where the
 * garden's axis walk laps it by half a metre. Clipped to the opera house's
 * side of any crossing road — a no-op against today's corridor, but a road
 * nudge fails the seam test instead of paving the far kerbside.
 */
export function cairoOperaTerracePolygon(
  operaHouse: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  return clipRectToRoadSide(
    operaHouse.center.x - operaHouse.size.x / 2 - 2,
    operaHouse.center.x + operaHouse.size.x / 2 + 2,
    // 12 m south of the building's north face — the park's own south line,
    // so the paving covers exactly the strip the building borrows from it.
    operaHouse.center.z + operaHouse.size.z / 2 - 12,
    CAIRO_OPERA_TERRACE_NORTH_Z,
    operaHouse.center,
    roadSurfaces,
  );
}

/**
 * A rect cut back to `anchor`'s side of every road-centreline segment that
 * crosses it. The shared core of Tahrir's lawn and forecourt polygons, the
 * road-divided park lawns and the opera parterre quadrants: all lean on the
 * same fact — the surface drawn from the result sits below the carriageway
 * and the pavement band, so running the rect out to a road's centreline
 * paints a seam exactly on the band's outer edge.
 */
export function clipRectToRoadSide(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  anchor: GameCanvasPoint,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  let polygon: GameCanvasPoint[] = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
  for (const surface of roadSurfaces) {
    for (let index = 0; index + 1 < surface.centerline.length; index += 1) {
      const start = surface.centerline[index];
      const end = surface.centerline[index + 1];
      if (Math.hypot(end.x - start.x, end.z - start.z) <= 1e-6) continue;
      if (!segmentCrossesRect(start, end, minX, maxX, minZ, maxZ)) continue;
      polygon = clipPolygonToLineSide(polygon, start, end, anchor);
      if (polygon.length < 3) return polygon;
    }
  }
  return polygon;
}

/**
 * How far the ministries' esplanade laps over the park lawn's north edge.
 * The two surfaces sit 11 mm apart in y, so an exactly-shared edge would let
 * a glancing camera see the grey base ground through the parallax gap; a
 * hand's width of overlap closes it, and at that size the paving edge reads
 * as kissing the grass, not covering it.
 */
export const CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M = 0.3;

/**
 * The paved esplanade between Tahrir's lawn and the ministries frontage —
 * the whole pocket, not a floating slab-front apron. Cairo's base ground is
 * paved grey, and every edge of this polygon lands on a real boundary so no
 * grey can show and no paving edge floats in open ground:
 *
 * - south: the park lawn's north edge (plus a small lap, above), so grass
 *   meets paving the way it meets the sidewalks;
 * - west: the same in-band tuck line as the lawn — Qasr El-Ainy's pavement
 *   covers the edge and the visible seam is the band's outer edge;
 * - north: under the ministries and frontage buildings;
 * - east: run generously past Ramses and cut back to its centreline by
 *   `clipRectToRoadSide`, exactly like the lawn.
 */
export function cairoTahrirForecourtPolygon(
  ministries: Pick<
    GameCanvasMapPack["geometry"]["landmarks"][number],
    "center" | "size"
  >,
  parkNorthEdgeZ: number,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): GameCanvasPoint[] {
  // Past Ramses' centreline at every z the esplanade spans; the clip owns
  // the real east boundary.
  const eastSeedX = 436;
  return clipRectToRoadSide(
    CAIRO_TAHRIR_LAWN_WEST_TUCK_X,
    eastSeedX,
    parkNorthEdgeZ - CAIRO_TAHRIR_FORECOURT_LAWN_LAP_M,
    ministries.center.z + ministries.size.z / 2,
    ministries.center,
    roadSurfaces,
  );
}

/** Benches sit ON the paving disc, facing the obelisk at its centre... */
export const CAIRO_TAHRIR_BENCH_RING_M = 9;
/** ...and the olives stand on the grass just outside it. */
export const CAIRO_TAHRIR_OLIVE_RING_M = 16.5;

/**
 * Keeps Tahrir's visual-only furniture ringed around the plaza, clear of
 * traffic. `plazaCenter` is the `cairo-tahrir-obelisk` landmark's centre —
 * the obelisk, the paved disc and both furniture rings share it, so the
 * whole ensemble moves as one when the landmark is re-authored.
 *
 * `roadClear` demands the pavement band too, not just the carriageway: a
 * bench standing on the kerbside pavement reads as street clutter, not park
 * furniture. The rings are authored to clear every band outright
 * (`tests/cairoVisuals.test.ts` pins it); `settle()` stays as the safety
 * net for future road edits, walking a placement toward the plaza centre
 * until it clears.
 */
export function cairoTahrirFurnitureLayout(
  plazaCenter: GameCanvasPoint,
  roadSurfaces: NonNullable<GameCanvasMapPack["geometry"]["roadSurfaces"]>,
): CairoTahrirFurnitureLayout {
  const roadClear = (point: GameCanvasPoint, radiusM: number) =>
    roadSurfaces.every((surface) => {
      const nearest = nearestPointOnPolyline(point, surface.centerline);
      return (
        Math.hypot(point.x - nearest.x, point.z - nearest.z) >=
        surface.widthM / 2 + (surface.sidewalkWidthM ?? 2.8) + radiusM + 1
      );
    });
  const settle = (
    candidate: GameCanvasPoint,
    radiusM: number,
  ): GameCanvasPoint => {
    for (let step = 0; step <= 24; step += 1) {
      const amount = step / 24;
      const point = {
        x: candidate.x + (plazaCenter.x - candidate.x) * amount,
        z: candidate.z + (plazaCenter.z - candidate.z) * amount,
      };
      if (roadClear(point, radiusM)) return point;
    }
    return plazaCenter;
  };
  return {
    olives: Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return settle(
        {
          x: plazaCenter.x + Math.sin(angle) * CAIRO_TAHRIR_OLIVE_RING_M,
          z: plazaCenter.z + Math.cos(angle) * CAIRO_TAHRIR_OLIVE_RING_M,
        },
        1.9,
      );
    }),
    benches: Array.from({ length: 6 }, (_, index) => {
      const rotationY = (index / 6) * Math.PI * 2;
      return {
        ...settle(
          {
            x: plazaCenter.x + Math.sin(rotationY) * CAIRO_TAHRIR_BENCH_RING_M,
            z: plazaCenter.z + Math.cos(rotationY) * CAIRO_TAHRIR_BENCH_RING_M,
          },
          1.5,
        ),
        rotationY,
      };
    }),
  };
}
