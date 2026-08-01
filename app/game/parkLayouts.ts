/**
 * What stands inside a park, as plain data.
 *
 * Pure and Babylon-free like `visuals.ts`, for two reasons. It is unit-testable
 * without an engine, and — more importantly — the collider builder in
 * `simulationAdapter.ts` and the renderer in `GameCanvas.tsx` are in different
 * rings and must agree exactly on where a park's paths and planting are. A
 * layout computed twice from the same seed is the only thing keeping them in
 * step.
 *
 * Everything is authored in **park-local normalised coordinates** (u, v each in
 * -0.5..0.5) and mapped out through the landmark's `center`, `size` and
 * `headingDeg` at the end, so one recipe scales to any park of its style and a
 * future city's park gets a sensible layout with no content edit.
 */

import {
  distanceToPolylineM,
  hashStringToSeed,
  PAVED_SIDEWALK_WIDTH_M,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  seededUnit,
  type VisualPoint,
} from "./visuals";

/**
 * Radius of the paved disc `GameCanvas.tsx` lays around Tahrir's obelisk.
 *
 * It lives here rather than beside the renderer branch that draws it because
 * the scatter in this module must keep planting off the paving, and this
 * module cannot import from `GameCanvas.tsx` — the dependency arrow points
 * the other way.
 */
export const CAIRO_TAHRIR_PLAZA_RADIUS_M = 13;

/**
 * How a park is dressed. Derived from id, map and proportions unless the
 * landmark names one explicitly.
 *
 * These are *recipes*, not decoration: `pocket_green` and `civic_plaza` are
 * also the two styles that must never grow a solid perimeter, because a traffic
 * island and a roads-crowded plaza have no room for one.
 */
export type ParkStyle =
  | "urban_greensward"
  | "riverside_strip"
  | "temple_grounds"
  | "civic_plaza"
  | "pocket_green";

export interface ParkLandmarkInput {
  readonly id: string;
  readonly center: VisualPoint;
  readonly size: VisualPoint;
  readonly headingDeg?: number;
  readonly parkStyle?: ParkStyle;
}

export interface ParkPath {
  readonly id: string;
  readonly points: readonly VisualPoint[];
  readonly widthM: number;
}

export type ParkPropKind = "tree" | "shrub" | "bench" | "lamp" | "monument";

/**
 * A built piece a park needs that no scatter would produce: a temple's torii
 * and lanterns, a formal garden's parterre beds, a monument. Rendered
 * procedurally except where a `monument` placement pulls one from the kit.
 */
export type ParkFeatureKind =
  | "court"
  | "parterre"
  | "torii"
  | "lantern"
  | "plinth";

export interface ParkFeature {
  readonly id: string;
  readonly kind: ParkFeatureKind;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  /** Emitted as a static obstacle when true. */
  readonly solid: boolean;
}

/** A rectangle the scatter must leave empty — a court, a bed, a lawn. */
export interface ParkClearing {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
}

export interface ParkPlacement {
  readonly kind: ParkPropKind;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly variant: number;
}

export interface ParkLayout {
  readonly style: ParkStyle;
  readonly paths: readonly ParkPath[];
  readonly placements: readonly ParkPlacement[];
  /** Solid boundary spans. Empty for parks that must never be walled. */
  readonly wall: readonly ParkWallRun[];
  /** Built pieces — courts, beds, a torii, a plinth. */
  readonly features: readonly ParkFeature[];
}

export interface ParkLayoutContext {
  /** Every road surface on the map, so nothing is planted on a carriageway. */
  readonly roadSurfaces: readonly {
    readonly centerline: readonly VisualPoint[];
    readonly widthM: number;
  }[];
  /** Pavement band beyond the carriageway edge that must also stay clear. */
  readonly sidewalkWidthM: number;
  /**
   * Water outlines, so a lake inside a park does not grow trees. The scatter is
   * driven off the park rectangle and has nothing else to reject them with.
   */
  readonly waterPolygons?: readonly (readonly VisualPoint[])[];
  readonly seed: number;
}

/** Crossing-number point-in-polygon, so concave lake outlines work. */
const isInsideWater = (
  point: VisualPoint,
  polygons: readonly (readonly VisualPoint[])[],
): boolean =>
  polygons.some((polygon) => {
    let inside = false;
    for (
      let index = 0, previous = polygon.length - 1;
      index < polygon.length;
      previous = index, index += 1
    ) {
      const left = polygon[index];
      const right = polygon[previous];
      if (
        left.z > point.z !== right.z > point.z &&
        point.x <
          ((right.x - left.x) * (point.z - left.z)) / (right.z - left.z) + left.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  });

/** Below this, a park is a token green with no room for a path network. */
const POCKET_GREEN_MAX_SHORT_SIDE_M = 30;
/** Above this length-to-width ratio a park is a strip, not a field. */
const STRIP_ASPECT = 6;
/** Nothing is planted within this of the park's own boundary. */
const PARK_EDGE_INSET_M = 3;
/** Clearance kept either side of a path centreline, beyond its half-width. */
const PATH_CLEARANCE_M = 1.4;

export function resolveParkStyle(
  landmark: ParkLandmarkInput,
  mapVisualKey: string,
): ParkStyle {
  if (landmark.parkStyle) return landmark.parkStyle;
  // The id is checked BEFORE the size gates, deliberately: a name is authored
  // intent and the proportions are only a fallback heuristic. `jp-temple-green`
  // is 24x28, small enough to read as a token green by its numbers alone, but
  // it is a named temple green and should get gravel and an approach rather
  // than a lawn with a bench on it.
  const id = landmark.id.toLowerCase();
  // Tahrir is a plaza that happens to be green, and roads cut its authored
  // rectangle — it is the reason `civic_plaza` exists as a separate recipe.
  if (id.includes("tahrir") || id.includes("plaza")) return "civic_plaza";
  if (
    mapVisualKey === "tokyo" &&
    (id.includes("temple") || id.includes("shrine") || id.includes("gotokuji"))
  ) {
    return "temple_grounds";
  }
  const shortSide = Math.min(landmark.size.x, landmark.size.z);
  const longSide = Math.max(landmark.size.x, landmark.size.z);
  if (shortSide < POCKET_GREEN_MAX_SHORT_SIDE_M) return "pocket_green";
  if (longSide / Math.max(1, shortSide) >= STRIP_ASPECT) return "riverside_strip";
  return "urban_greensward";
}

/** Park-local normalised (u, v) to world, through size, heading and centre. */
const toWorld = (
  landmark: ParkLandmarkInput,
  u: number,
  v: number,
): VisualPoint => {
  const localX = u * landmark.size.x;
  const localZ = v * landmark.size.z;
  const heading = ((landmark.headingDeg ?? 0) * Math.PI) / 180;
  if (!heading) {
    return { x: landmark.center.x + localX, z: landmark.center.z + localZ };
  }
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: landmark.center.x + localX * cos - localZ * sin,
    z: landmark.center.z + localX * sin + localZ * cos,
  };
};

/**
 * Roughly how far apart a long park's crossings should be. Central Park's real
 * transverses sit at 65th, 79th, 86th and 96th — a few hundred metres apart —
 * and that spacing is the reason this exists rather than a fixed count.
 *
 * It is also load-bearing for the wall: a gate is opened wherever a path meets
 * the boundary, so the crossings ARE the entrances. Without them Central Park
 * came out with a single unbroken 2,897 m run down its western edge and one
 * way in at each far end, 2.9 km apart.
 */
const PARK_CROSSING_SPACING_M = 300;
const PARK_MAX_CROSSINGS = 12;

/** Crossings at even intervals along a park's long axis, edge to edge. */
function crossPaths(
  landmark: ParkLandmarkInput,
  widthM: number,
): readonly ParkPath[] {
  const longIsZ = landmark.size.z >= landmark.size.x;
  const longSide = longIsZ ? landmark.size.z : landmark.size.x;
  const count = Math.min(
    PARK_MAX_CROSSINGS,
    Math.max(1, Math.round(longSide / PARK_CROSSING_SPACING_M) - 1),
  );
  return Array.from({ length: count }, (_, index) => {
    const at = (index + 1) / (count + 1) - 0.5;
    return {
      id: `cross-${index}`,
      points: longIsZ
        ? [toWorld(landmark, -0.5, at), toWorld(landmark, 0.5, at)]
        : [toWorld(landmark, at, -0.5), toWorld(landmark, at, 0.5)],
      widthM,
    };
  });
}

/**
 * The pieces a named park needs that no scatter would ever produce.
 *
 * Keyed on the landmark id where a park has real character worth stating, and
 * on its style otherwise — so a fifth city's temple grounds gets a torii and a
 * gravel court for free, while Central Park's Great Lawn stays Central Park's.
 *
 * Returns clearings as well as features: a gravel court with trees growing out
 * of it, or a Great Lawn that is not a lawn, is worse than neither.
 */
function bespokeFeatures(
  landmark: ParkLandmarkInput,
  style: ParkStyle,
  paths: readonly ParkPath[],
): { features: ParkFeature[]; clearings: ParkClearing[]; props: ParkPlacement[] } {
  /**
   * Nudge a piece of masonry sideways until it clears every walk.
   *
   * The same idea as `cairoTahrirFurnitureLayout`'s `settle`: the ideal spot is
   * the axis centre, and clearance is a veto on it rather than something being
   * maximised. Without this the Opera Grounds obelisk stood in the middle of
   * its own spine path.
   */
  const settle = (u: number, v: number, radiusM: number): VisualPoint => {
    const steps = [0, 0.1, -0.1, 0.18, -0.18, 0.26, -0.26];
    // Both axes, nearest-first. One axis is not enough: a park short enough to
    // get its single crossing at the centre has a path straight through the
    // ideal spot in BOTH directions, so sliding sideways can never clear it.
    const candidates = steps
      .flatMap((du) => steps.map((dv) => [du, dv] as const))
      .sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [du, dv] of candidates) {
      const point = toWorld(landmark, u + du, v + dv);
      const clear = paths.every(
        (path) =>
          distanceToPolylineM(point, path.points) >= path.widthM / 2 + radiusM,
      );
      if (clear) return point;
    }
    return toWorld(landmark, u, v);
  };
  const features: ParkFeature[] = [];
  const clearings: ParkClearing[] = [];
  const props: ParkPlacement[] = [];
  const id = landmark.id.toLowerCase();
  const longIsZ = landmark.size.z >= landmark.size.x;

  if (style === "temple_grounds") {
    // A raked gravel court over the middle, and the axial approach through it.
    const court = toWorld(landmark, 0, 0);
    const halfX = (landmark.size.x * 0.62) / 2;
    const halfZ = (landmark.size.z * 0.62) / 2;
    features.push({
      id: `${landmark.id}-court`,
      kind: "court",
      x: court.x,
      z: court.z,
      rotationY: 0,
      sizeX: halfX * 2,
      sizeZ: halfZ * 2,
      solid: false,
    });
    clearings.push({ x: court.x, z: court.z, halfX, halfZ });
    // The torii stands at the mouth of the approach, facing down it.
    const gate = longIsZ ? toWorld(landmark, 0, 0.42) : toWorld(landmark, 0.42, 0);
    features.push({
      id: `${landmark.id}-torii`,
      kind: "torii",
      x: gate.x,
      z: gate.z,
      rotationY: longIsZ ? 0 : Math.PI / 2,
      sizeX: Math.min(6.5, Math.min(landmark.size.x, landmark.size.z) * 0.3),
      sizeZ: 0.5,
      solid: true,
    });
    // Stone lanterns pairing off down the approach, as a sandō actually has.
    for (let step = 0; step < 3; step += 1) {
      const along = 0.3 - step * 0.16;
      for (const side of [-1, 1]) {
        const offset = 0.11 * side;
        const point = longIsZ
          ? toWorld(landmark, offset, along)
          : toWorld(landmark, along, offset);
        features.push({
          id: `${landmark.id}-lantern-${step}-${side > 0 ? "r" : "l"}`,
          kind: "lantern",
          x: point.x,
          z: point.z,
          rotationY: 0,
          sizeX: 0.5,
          sizeZ: 0.5,
          solid: true,
        });
      }
    }
  }

  if (id.includes("opera")) {
    // Four formal parterres either side of the axis, and an obelisk on it.
    for (const [index, [u, v]] of (
      [
        [-0.22, -0.2],
        [0.22, -0.2],
        [-0.22, 0.2],
        [0.22, 0.2],
      ] as const
    ).entries()) {
      const bed = toWorld(landmark, u, v);
      const halfX = landmark.size.x * 0.16;
      const halfZ = landmark.size.z * 0.14;
      features.push({
        id: `${landmark.id}-parterre-${index}`,
        kind: "parterre",
        x: bed.x,
        z: bed.z,
        rotationY: 0,
        sizeX: halfX * 2,
        sizeZ: halfZ * 2,
        solid: false,
      });
      clearings.push({ x: bed.x, z: bed.z, halfX, halfZ });
    }
    const centre = settle(0, 0, 3.5);
    props.push({
      kind: "monument",
      x: centre.x,
      z: centre.z,
      rotationY: 0,
      scale: 1,
      variant: 0,
    });
    clearings.push({ x: centre.x, z: centre.z, halfX: 5, halfZ: 5 });
  }

  if (id.includes("joan-of-arc")) {
    // The real park is a monument park: an equestrian statue on a plinth.
    const centre = settle(0, 0, 4.5);
    features.push({
      id: `${landmark.id}-plinth`,
      kind: "plinth",
      x: centre.x,
      z: centre.z,
      rotationY: 0,
      sizeX: 4.4,
      sizeZ: 4.4,
      solid: true,
    });
    clearings.push({ x: centre.x, z: centre.z, halfX: 9, halfZ: 9 });
  }

  if (id.includes("central-park")) {
    // The Great Lawn is grass with nothing on it. It is a hole in the scatter,
    // not a mesh — which is also why it costs nothing.
    const lawn = toWorld(landmark, 0.12, 0.21);
    clearings.push({ x: lawn.x, z: lawn.z, halfX: 78, halfZ: 115 });
  }

  return { features, clearings, props };
}

/**
 * The path network, in park-local coordinates.
 *
 * A long park gets a wandering spine so the eye is led down its length rather
 * than along a ruled line; a compact one gets a cross, which is what a small
 * civic green actually has. Temple grounds get a single straight approach,
 * because a Japanese shrine approach (`sandō`) is deliberately axial.
 */
function pathRecipe(
  style: ParkStyle,
  landmark: ParkLandmarkInput,
): readonly ParkPath[] {
  const longIsZ = landmark.size.z >= landmark.size.x;
  const spine = (id: string, offset: number, amplitude: number, widthM: number) => {
    const points: VisualPoint[] = [];
    const steps = 24;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps - 0.5;
      const wander = Math.sin(t * Math.PI * 3) * amplitude;
      points.push(
        longIsZ
          ? toWorld(landmark, offset + wander, t)
          : toWorld(landmark, t, offset + wander),
      );
    }
    return { id, points, widthM };
  };

  switch (style) {
    case "pocket_green":
      return [
        {
          id: "cross",
          points: [toWorld(landmark, -0.5, 0), toWorld(landmark, 0.5, 0)],
          widthM: 2.2,
        },
      ];
    case "temple_grounds":
      return [
        {
          id: "approach",
          points: longIsZ
            ? [toWorld(landmark, 0, 0.5), toWorld(landmark, 0, -0.12)]
            : [toWorld(landmark, 0.5, 0), toWorld(landmark, -0.12, 0)],
          widthM: 3.4,
        },
      ];
    case "riverside_strip":
      // Hugs one third rather than the centreline: a riverside park's walk runs
      // along the bank, not down the middle of the grass.
      return [spine("promenade", -0.16, 0.05, 3.6), ...crossPaths(landmark, 2.6)];
    case "civic_plaza":
      return [
        {
          id: "axis",
          points: [toWorld(landmark, -0.5, 0.1), toWorld(landmark, 0.5, 0.1)],
          widthM: 3.2,
        },
      ];
    default:
      return [spine("spine", 0, 0.14, 4.4), ...crossPaths(landmark, 2.8)];
  }
}

interface ScatterZone {
  readonly kind: ParkPropKind;
  readonly perHectare: number;
  readonly minSpacingM: number;
  /** Only place where the distance to the nearest path is inside this band. */
  readonly pathBandM?: readonly [number, number];
  readonly variants: number;
  readonly minScale: number;
  readonly maxScale: number;
}

function zoneRecipe(style: ParkStyle): readonly ScatterZone[] {
  const trees = (perHectare: number, minScale = 0.85, maxScale = 1.3) => ({
    kind: "tree" as const,
    perHectare,
    minSpacingM: 7,
    // Wide enough to reach the whole canopy pool a city downloads. At 3 the
    // renderer's `variant % pool.length` never got past the first three
    // species, so every temperate park was broadleaf/oak/tall and no conifer
    // was ever planted.
    variants: 8,
    minScale,
    maxScale,
  });
  const shrubs = (perHectare: number) => ({
    kind: "shrub" as const,
    perHectare,
    minSpacingM: 3,
    pathBandM: [1.5, 6] as const,
    variants: 3,
    minScale: 0.7,
    maxScale: 1.25,
  });
  switch (style) {
    case "pocket_green":
      return [trees(38, 0.7, 1.0), shrubs(120)];
    case "temple_grounds":
      // Clipped and sparse. A temple garden is mostly raked ground and a few
      // deliberate trees, so density here is a statement, not a shortfall.
      return [trees(26, 0.8, 1.15), shrubs(150)];
    case "civic_plaza":
      return [trees(18, 0.8, 1.1), shrubs(90)];
    case "riverside_strip":
      return [trees(34), shrubs(70)];
    default:
      return [trees(30), shrubs(60)];
  }
}

/**
 * Jittered-grid scatter over the park rectangle.
 *
 * Deliberately not dart-throwing: Central Park is 58 hectares, so rejection
 * sampling at these densities would throw tens of thousands of darts to keep a
 * thousand. One candidate per cell also gives an even, art-directable spread
 * and — because the jitter is bounded at `(cell - minSpacing) / 2` — guarantees
 * the minimum spacing outright, with no spacing grid to consult.
 */
function scatterZone(
  landmark: ParkLandmarkInput,
  zone: ScatterZone,
  paths: readonly ParkPath[],
  clearings: readonly ParkClearing[],
  context: ParkLayoutContext,
  random: () => number,
): ParkPlacement[] {
  const usableX = landmark.size.x - PARK_EDGE_INSET_M * 2;
  const usableZ = landmark.size.z - PARK_EDGE_INSET_M * 2;
  if (usableX <= 0 || usableZ <= 0) return [];

  const areaHa = (usableX * usableZ) / 10_000;
  const wanted = Math.max(1, Math.round(areaHa * zone.perHectare));
  const cell = Math.max(zone.minSpacingM, Math.sqrt((usableX * usableZ) / wanted));
  const columns = Math.max(1, Math.floor(usableX / cell));
  const rows = Math.max(1, Math.floor(usableZ / cell));
  const jitter = Math.max(0, (cell - zone.minSpacingM) / 2);

  const placements: ParkPlacement[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Draw every random for this cell up front, so a rejected candidate
      // consumes exactly as much of the stream as an accepted one and the
      // layout stays stable when a density is retuned.
      const jx = (random() - 0.5) * 2 * jitter;
      const jz = (random() - 0.5) * 2 * jitter;
      const rotation = random() * Math.PI * 2;
      const scaleRoll = random();
      const variant = Math.floor(random() * zone.variants);

      const u = (column + 0.5) / columns - 0.5;
      const v = (row + 0.5) / rows - 0.5;
      const point = toWorld(
        landmark,
        (u * usableX + jx) / landmark.size.x,
        (v * usableZ + jz) / landmark.size.z,
      );

      let nearestPath = Number.POSITIVE_INFINITY;
      for (const path of paths) {
        nearestPath = Math.min(
          nearestPath,
          distanceToPolylineM(point, path.points) - path.widthM / 2,
        );
      }
      if (nearestPath < PATH_CLEARANCE_M) continue;
      if (zone.pathBandM) {
        const [near, far] = zone.pathBandM;
        if (nearestPath < near || nearestPath > far) continue;
      }

      // Roads cross or grazes several authored parks, and the lawn is drawn
      // under them — so the scatter has to reject the carriageway itself.
      const onRoad = context.roadSurfaces.some(
        (surface) =>
          distanceToPolylineM(point, surface.centerline) <
          surface.widthM / 2 + context.sidewalkWidthM + 1,
      );
      if (onRoad) continue;
      if (isInsideWater(point, context.waterPolygons ?? [])) continue;
      // Courts, formal beds and the Great Lawn are meant to be empty.
      if (
        clearings.some(
          (clearing) =>
            Math.abs(point.x - clearing.x) <= clearing.halfX &&
            Math.abs(point.z - clearing.z) <= clearing.halfZ,
        )
      ) {
        continue;
      }

      placements.push({
        kind: zone.kind,
        x: point.x,
        z: point.z,
        rotationY: rotation,
        scale: zone.minScale + scaleRoll * (zone.maxScale - zone.minScale),
        variant,
      });
    }
  }
  return placements;
}

/** Benches and lamps along the paths, at a walking rhythm. */
function pathFurniture(
  paths: readonly ParkPath[],
  style: ParkStyle,
  context: ParkLayoutContext,
  random: () => number,
): ParkPlacement[] {
  if (style === "pocket_green") return [];
  const placements: ParkPlacement[] = [];
  const benchEvery = 58;
  const lampEvery = 46;
  for (const path of paths) {
    let travelled = 0;
    let nextBench = benchEvery * (0.4 + random() * 0.5);
    let nextLamp = lampEvery * (0.3 + random() * 0.5);
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const start = path.points[index];
      const end = path.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const tx = dx / length;
      const tz = dz / length;
      const emit = (
        kind: ParkPropKind,
        along: number,
        side: number,
        offset: number,
      ) => {
        const baseX = start.x + tx * along;
        const baseZ = start.z + tz * along;
        const point = {
          x: baseX + tz * side * offset,
          z: baseZ - tx * side * offset,
        };
        const onRoad = context.roadSurfaces.some(
          (surface) =>
            distanceToPolylineM(point, surface.centerline) <
            surface.widthM / 2 + context.sidewalkWidthM + 1,
        );
        if (onRoad) return;
        if (isInsideWater(point, context.waterPolygons ?? [])) return;
        placements.push({
          kind,
          x: point.x,
          z: point.z,
          // Benches face the path they sit beside; a bench with its back to the
          // walk is the detail that reads as procedural.
          rotationY: Math.atan2(-tz * side, tx * side),
          scale: 1,
          variant: 0,
        });
      };
      while (nextBench <= travelled + length) {
        emit("bench", nextBench - travelled, random() < 0.5 ? 1 : -1, 1.9);
        nextBench += benchEvery;
      }
      while (nextLamp <= travelled + length) {
        emit("lamp", nextLamp - travelled, random() < 0.5 ? 1 : -1, 1.6);
        nextLamp += lampEvery;
      }
      travelled += length;
    }
  }
  return placements;
}

/** A solid span of a park's boundary wall, as an oriented box. */
export interface ParkWallRun {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Unit vector along the run. */
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

/** Styles whose parks are too small or too road-bound to carry a wall. */
const UNWALLABLE_STYLES: readonly ParkStyle[] = ["pocket_green", "civic_plaza"];
/** A park narrower than this has no room for a wall and a drivable interior. */
const PARK_WALL_MIN_SHORT_SIDE_M = 30;
/** How far inside the boundary the wall stands. */
const PARK_WALL_INSET_M = 1.5;
const PARK_WALL_HALF_THICKNESS_M = 0.35;
/**
 * Clearance a wall segment must keep from any carriageway, beyond that road's
 * half-width and its pavement band. Comfortably wider than the 1.0 m player
 * capsule `tests/staticColliders.test.ts` checks lane corridors with, and than
 * the 0.3 m it allows against the walkable pavement band.
 */
const PARK_WALL_ROAD_CLEARANCE_M = 1.8;
/** Half-width of the opening left where one of the park's paths reaches out. */
const PARK_GATE_HALF_WIDTH_M = 4.5;
/** A surviving span shorter than this is a stub, not a wall. */
const PARK_WALL_MIN_RUN_M = 4;
const PARK_WALL_SAMPLE_M = 1;

/**
 * Where a park's boundary wall is solid.
 *
 * **Openings are derived, never authored.** A span is dropped wherever one of
 * the park's own paths reaches the boundary — that is the gate, and it means
 * the wall can never seal in the planting and benches the paths lead to — or
 * wherever the wall would come within `PARK_WALL_ROAD_CLEARANCE_M` of a
 * carriageway. The second rule is a veto, not a preference: it is what keeps
 * `staticColliders.test.ts`'s "every lane corridor clear" and "never walls off
 * the walkable pavement" green without anyone hand-listing an exception.
 */
export function parkPerimeterPlan(
  landmark: ParkLandmarkInput,
  style: ParkStyle,
  paths: readonly ParkPath[],
  context: ParkLayoutContext,
): readonly ParkWallRun[] {
  if (UNWALLABLE_STYLES.includes(style)) return [];
  if (Math.min(landmark.size.x, landmark.size.z) < PARK_WALL_MIN_SHORT_SIDE_M) {
    return [];
  }
  const insetU = Math.max(0, 0.5 - PARK_WALL_INSET_M / landmark.size.x);
  const insetV = Math.max(0, 0.5 - PARK_WALL_INSET_M / landmark.size.z);
  const corners = [
    toWorld(landmark, -insetU, -insetV),
    toWorld(landmark, insetU, -insetV),
    toWorld(landmark, insetU, insetV),
    toWorld(landmark, -insetU, insetV),
  ];

  const gatePoints: VisualPoint[] = [];
  for (const path of paths) {
    if (path.points.length < 2) continue;
    gatePoints.push(path.points[0], path.points[path.points.length - 1]);
  }

  const runs: ParkWallRun[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const from = corners[edge];
    const to = corners[(edge + 1) % 4];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < PARK_WALL_MIN_RUN_M) continue;
    const ux = dx / length;
    const uz = dz / length;
    const steps = Math.max(1, Math.ceil(length / PARK_WALL_SAMPLE_M));

    let runStart: number | null = null;
    const flush = (endAt: number) => {
      if (runStart === null) return;
      const span = endAt - runStart;
      if (span >= PARK_WALL_MIN_RUN_M) {
        const mid = runStart + span / 2;
        runs.push({
          id: `${landmark.id}-wall-${edge}-${runs.length}`,
          x: from.x + ux * mid,
          z: from.z + uz * mid,
          ux,
          uz,
          halfU: span / 2,
          halfV: PARK_WALL_HALF_THICKNESS_M,
        });
      }
      runStart = null;
    };

    for (let step = 0; step <= steps; step += 1) {
      const along = (length * step) / steps;
      const point = { x: from.x + ux * along, z: from.z + uz * along };
      const nearGate = gatePoints.some(
        (gate) => Math.hypot(gate.x - point.x, gate.z - point.z) <= PARK_GATE_HALF_WIDTH_M,
      );
      const nearRoad = context.roadSurfaces.some(
        (surface) =>
          distanceToPolylineM(point, surface.centerline) <
          surface.widthM / 2 +
            context.sidewalkWidthM +
            PARK_WALL_ROAD_CLEARANCE_M,
      );
      if (nearGate || nearRoad) {
        flush(along);
      } else if (runStart === null) {
        runStart = along;
      }
    }
    flush(length);
  }
  return runs;
}

/**
 * The whole layout for one park. Deterministic on `context.seed` — two calls
 * with the same input must agree exactly, because the renderer and the collider
 * builder each make their own call.
 */
export function buildParkLayout(
  landmark: ParkLandmarkInput,
  mapVisualKey: string,
  context: ParkLayoutContext,
): ParkLayout {
  const style = resolveParkStyle(landmark, mapVisualKey);
  const paths = pathRecipe(style, landmark);
  const bespoke = bespokeFeatures(landmark, style, paths);
  const random = seededUnit(context.seed);
  const placements: ParkPlacement[] = [...bespoke.props];
  for (const zone of zoneRecipe(style)) {
    placements.push(
      ...scatterZone(landmark, zone, paths, bespoke.clearings, context, random),
    );
  }
  placements.push(...pathFurniture(paths, style, context, random));
  return {
    style,
    paths,
    placements,
    wall: parkPerimeterPlan(landmark, style, paths, context),
    features: bespoke.features,
  };
}

/** The little a map pack has to expose for its parks to be laid out. */
export interface ParkLayoutMapPack {
  readonly id: string;
  readonly geometry: {
    readonly shoulderWidth?: number;
    readonly waterBodies?: readonly {
      readonly polygon: readonly VisualPoint[];
    }[];
    readonly roadSurfaces?: readonly {
      readonly centerline: readonly VisualPoint[];
      readonly widthM: number;
    }[];
  };
}

const LAYOUT_CACHE = new Map<string, ParkLayout>();

/**
 * The one way to get a park's layout.
 *
 * `GameCanvas` draws the wall and `simulationAdapter` makes it solid, and they
 * sit in different rings with no shared state — so if either derived its own
 * context (seed, sidewalk width, road list) the wall you crash into and the
 * wall you can see would drift apart silently. Everything that feeds the layout
 * is decided here, once.
 *
 * Cached by pack id + landmark id, like `streetAddressesForMap`: map packs are
 * frozen, so mutating one after the first call has no effect.
 */
export function parkLayoutForLandmark(
  pack: ParkLayoutMapPack,
  landmark: ParkLandmarkInput,
): ParkLayout {
  const key = `${pack.id}:${landmark.id}`;
  const cached = LAYOUT_CACHE.get(key);
  if (cached) return cached;
  const mapId = pack.id.toLowerCase();
  const palette = resolveMapVisualPalette(mapId);
  const layout = buildParkLayout(landmark, resolveMapVisualKey(mapId), {
    roadSurfaces: pack.geometry.roadSurfaces ?? [],
    sidewalkWidthM: palette.paved
      ? PAVED_SIDEWALK_WIDTH_M
      : Math.max(0.9, pack.geometry.shoulderWidth ?? 1.2),
    waterPolygons: (pack.geometry.waterBodies ?? []).map((body) => body.polygon),
    seed: hashStringToSeed(`${mapId}-${landmark.id}-park`),
  });
  LAYOUT_CACHE.set(key, layout);
  return layout;
}
