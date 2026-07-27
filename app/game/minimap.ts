// Pure top-down projection for the corner minimap. World coordinates are centred
// on the origin and span the map's worldSize; these helpers fit that box into a
// square canvas so the driving view can rasterise the road network once and then
// overlay the live player pose + pins each frame. No rendering here — just maths,
// so it is trivially unit-testable.

export interface MinimapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MinimapWorldSize {
  readonly x: number;
  readonly z: number;
}

export interface MinimapProjector {
  readonly size: number;
  /** Maps a centred world position (metres) to minimap pixel coordinates. */
  project(worldX: number, worldZ: number): MinimapPoint;
}

/**
 * Metres the widget shows across its own width once a map is too big to fit.
 *
 * Every shipped map is now past this, so in practice they all scroll: the
 * largest dimensions run 3000 m (NYC), 1500 m (Milton Keynes), 800 m (London),
 * 680 m (Calais) and 600 m (Tokyo). That is the point of the number — a map
 * drawn whole has to shrink its streets to hairlines, and once the widget
 * carries a route line to the destination there is nothing an overview buys
 * that the route does not already answer.
 *
 * The fitted path below is still live code for a world smaller than this.
 */
export const MINIMAP_FOLLOW_SPAN_M = 500;

/**
 * How wide a road draws, in pixels: true scale, but never thinner than `floorPx`.
 *
 * True scale alone is unreadable at the corner widget's scale — a 10.4 m street
 * is under 2 px on a phone, so the grid reads as a mesh of hairlines rather than
 * streets with blocks between them. A floor turns the drawn width from a
 * measurement into a symbol, which is what every map renderer does.
 *
 * The floor is a parameter because the two surfaces want it expressed
 * differently. See `minimapRoadFloorPx` and `MAP_ROAD_WIDTH_FLOOR_PX`.
 */
export function resolveMapRoadWidth(
  widthM: number,
  pixelsPerMetre: number,
  floorPx: number,
): number {
  return Math.max(floorPx, widthM * pixelsPerMetre);
}

/**
 * The corner widget's floor: a share of the widget itself, so the roads keep
 * the same share of the map at either size rather than swallowing the smaller
 * one.
 *
 * At the shipped follow span this floor governs *every* road — beating it takes
 * a carriageway over ~31 m and the widest authored anywhere is 25 m — so on the
 * widget the true-width term is not load-bearing, and streets of different
 * widths deliberately draw alike.
 */
export function minimapRoadFloorPx(size: number): number {
  return size * ROAD_WIDTH_FLOOR_FRACTION;
}

/**
 * The whole-city map's floor, in flat pixels rather than a share of the canvas.
 *
 * A share is the wrong model once the canvas is the screen: 5.8% of 900 px is a
 * 52 px street, which fuses the entire grid into one slab. Fitted, the scale is
 * high enough that true width carries most roads on its own (a 10.4 m street is
 * ~3 px across a fitted NYC), so this only catches the narrowest lanes and
 * mews — the opposite balance to the widget, where the floor governs
 * everything.
 */
export const MAP_ROAD_WIDTH_FLOOR_PX = 1.75;

/**
 * Road width as a share of the widget, and the route line's share of that.
 *
 * The two are a pair: the GPS line has to sit *inside* the street it follows,
 * or it reads as a separate object laid over the city rather than the way
 * through it. Roughly half the road width is what does that.
 */
const ROAD_WIDTH_FLOOR_FRACTION = 0.058;
export const MINIMAP_ROUTE_WIDTH_FRACTION = ROAD_WIDTH_FLOOR_FRACTION * 0.55;

/** Pixels per metre a projector draws at, and whether it scrolls. */
export interface MinimapScale {
  readonly pixelsPerMetre: number;
  /** True when the world is larger than the widget can show at that scale. */
  readonly follows: boolean;
}

export function resolveMinimapScale(
  worldSize: MinimapWorldSize,
  size: number,
  padding = 6,
  followSpanM = MINIMAP_FOLLOW_SPAN_M,
): MinimapScale {
  const usable = Math.max(1, size - padding * 2);
  const largest = Math.max(1, worldSize.x, worldSize.z);
  const follows = largest > followSpanM;
  return {
    pixelsPerMetre: usable / (follows ? followSpanM : largest),
    follows,
  };
}

/**
 * Projects into a sheet big enough for the whole world at a fixed scale — the
 * offscreen canvas the network is rasterised into once, then blitted from.
 */
export function createMinimapSheetProjector(
  worldSize: MinimapWorldSize,
  pixelsPerMetre: number,
  margin: number,
): MinimapProjector & { readonly width: number; readonly height: number } {
  const width = Math.ceil(worldSize.x * pixelsPerMetre) + margin * 2;
  const height = Math.ceil(worldSize.z * pixelsPerMetre) + margin * 2;
  return {
    size: Math.max(width, height),
    width,
    height,
    project(worldX, worldZ) {
      return {
        x: margin + (worldX + worldSize.x / 2) * pixelsPerMetre,
        y: margin + (worldSize.z / 2 - worldZ) * pixelsPerMetre,
      };
    },
  };
}

/**
 * Projects world metres into widget pixels around a player standing at its
 * centre. Same +z-is-up flip as the fitted projector.
 */
export function createMinimapFollowProjector(
  playerX: number,
  playerZ: number,
  pixelsPerMetre: number,
  size: number,
): MinimapProjector {
  const centre = size / 2;
  return {
    size,
    project(worldX, worldZ) {
      return {
        x: centre + (worldX - playerX) * pixelsPerMetre,
        y: centre - (worldZ - playerZ) * pixelsPerMetre,
      };
    },
  };
}

/** A fit projector, plus the canvas it fits into and the scale it landed on. */
export interface MinimapFitProjector extends MinimapProjector {
  readonly width: number;
  readonly height: number;
  /** Needed to width roads, which the fitted map draws close to true scale. */
  readonly pixelsPerMetre: number;
}

/**
 * Fits the whole world inside a `width`×`height` canvas (minus `padding` on
 * each edge), preserving aspect and flipping +z (north) to screen-up.
 *
 * Rectangular rather than square because the cities are nothing like square —
 * 1080x3000 m in New York against 1500x300 m in Milton Keynes — and a whole-city
 * view boxed into a square spends most of itself on nothing. The caller sizes
 * the canvas to the world's own aspect and this fills it.
 */
export function createMinimapFitProjector(
  worldSize: MinimapWorldSize,
  width: number,
  height: number,
  padding = 6,
): MinimapFitProjector {
  const pixelsPerMetre = Math.min(
    Math.max(1, width - padding * 2) / Math.max(1, worldSize.x),
    Math.max(1, height - padding * 2) / Math.max(1, worldSize.z),
  );
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    size: Math.max(width, height),
    width,
    height,
    pixelsPerMetre,
    project(worldX, worldZ) {
      return {
        x: centerX + worldX * pixelsPerMetre,
        y: centerY - worldZ * pixelsPerMetre,
      };
    },
  };
}

/**
 * Builds a square projector that fits the map's worldSize inside a `size`×`size`
 * canvas. The square case of `createMinimapFitProjector`, which is what the
 * corner widget wants — it is square by construction.
 */
export function createMinimapProjector(
  worldSize: MinimapWorldSize,
  size: number,
  padding = 6,
): MinimapProjector {
  return createMinimapFitProjector(worldSize, size, size, padding);
}

/** A road ready to stroke: widget-space points, plus the width it draws at. */
export interface MinimapRoadLine {
  readonly points: MinimapPoint[];
  /** Carriageway width in metres — `resolveMapRoadWidth` turns it into a stroke. */
  readonly widthM: number;
}

/**
 * Projects road-surface centrelines into minimap polylines for drawing. The
 * width travels with the points rather than being looked up by index at the
 * call site, so a filtered or reordered network cannot silently draw the wrong
 * street at the wrong weight.
 */
export function projectRoadNetwork(
  roadSurfaces: readonly {
    readonly centerline: readonly { readonly x: number; readonly z: number }[];
    readonly widthM?: number;
  }[],
  projector: MinimapProjector,
): MinimapRoadLine[] {
  return roadSurfaces.map((surface) => ({
    points: surface.centerline.map((point) => projector.project(point.x, point.z)),
    widthM: surface.widthM ?? 0,
  }));
}
