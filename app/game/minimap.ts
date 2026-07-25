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
 * Fitting the whole world in works while the world is small: it was ~1080 m
 * across, so a 150 px widget drew streets a pixel or so apart and you could
 * read the grid. Triple the world and the same fit draws the same grid at a
 * third the size — every street a hairline, the player marker larger than the
 * block it stands in. Past this span the map scrolls under the player instead,
 * at the scale it has always had.
 */
export const MINIMAP_FOLLOW_SPAN_M = 1050;

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

/** Projects road-surface centrelines into minimap polylines for drawing. */
export function projectRoadNetwork(
  roadSurfaces: readonly {
    readonly centerline: readonly { readonly x: number; readonly z: number }[];
  }[],
  projector: MinimapProjector,
): MinimapPoint[][] {
  return roadSurfaces.map((surface) =>
    surface.centerline.map((point) => projector.project(point.x, point.z)),
  );
}
