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
 * How wide a road draws on the widget, in pixels.
 *
 * True scale is unreadable: a 10.4 m street at the follow scale is under 2 px
 * on a phone, so the grid reads as a mesh of hairlines rather than streets with
 * blocks between them. Roads therefore get a floor proportional to the widget,
 * which is what every map renderer does — the drawn width stops being a
 * measurement and becomes a symbol. Real width still wins wherever it is wider,
 * so a boulevard stays fatter than a side street.
 */
export function resolveMinimapRoadWidth(
  widthM: number,
  pixelsPerMetre: number,
  size: number,
): number {
  return Math.max(size * 0.032, widthM * pixelsPerMetre);
}

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

/**
 * Builds a square projector that fits the map's worldSize inside a `size`×`size`
 * canvas (minus `padding` on each edge), preserving aspect and flipping +z
 * (north) to screen-up.
 */
export function createMinimapProjector(
  worldSize: MinimapWorldSize,
  size: number,
  padding = 6,
): MinimapProjector {
  const usable = Math.max(1, size - padding * 2);
  const scale = Math.min(
    usable / Math.max(1, worldSize.x),
    usable / Math.max(1, worldSize.z),
  );
  const center = size / 2;
  return {
    size,
    project(worldX, worldZ) {
      return { x: center + worldX * scale, y: center - worldZ * scale };
    },
  };
}

/** A road ready to stroke: widget-space points, plus the width it draws at. */
export interface MinimapRoadLine {
  readonly points: MinimapPoint[];
  /** Carriageway width in metres — `resolveMinimapRoadWidth` turns it into a stroke. */
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
