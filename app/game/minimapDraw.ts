/**
 * The canvas 2D pass both maps share: the road network raster, the GPS lines,
 * the destination pin and the player arrow. Place markers are not here — they
 * are DOM icons layered over this, so the legend and the map draw one glyph.
 *
 * Two surfaces draw the same city — the corner widget (`MinimapCanvas.tsx`) and
 * the whole-city view (`ExpandedMap.tsx`) — and a second copy of this would be
 * free to drift from the first. It imports only `./minimap` (pure maths) and
 * touches no React and no DOM beyond the context it is handed, so the recording
 * fake the minimap tests already use can observe every call.
 *
 * **Symbol sizes are an input, not a calculation.** The widget expresses every
 * radius and stroke as a fraction of its own edge, which works only because it
 * is a fixed square: at 150 px the route line is 4.8 px and sits inside the
 * street it follows. Scale that rule to a 900 px screen and the same line is
 * 27 px — a bar laid across the city. So each surface hands in the pixel sizes
 * it wants and this draws them. `minimapSymbolSizes` reproduces the widget's
 * numbers exactly.
 */
import {
  MINIMAP_ROUTE_WIDTH_FRACTION,
  projectRoadNetwork,
  resolveMapRoadWidth,
  type MinimapProjector,
} from "./minimap";

/**
 * The one place the route line ends at.
 *
 * Deliberately the only marker this module draws. Everything else a map shows —
 * fuel, repairs, diners, shops, cameras — is an icon in the DOM layer above the
 * canvas (see `mapPoi.ts`), so a screenful of services can never compete with
 * where the player is actually going: it is the only round thing on the map.
 */
export interface MapDestination {
  readonly x: number;
  readonly z: number;
  readonly color: string;
}

/** A point in world metres — what every polyline here is expressed in. */
export interface MapDrawPoint {
  readonly x: number;
  readonly z: number;
}

/** Enough of a road surface to stroke it. */
export interface MapDrawSurface {
  readonly centerline: readonly MapDrawPoint[];
  readonly widthM?: number;
}

/** A filled geographic feature under the road network (currently the Nile). */
export interface MapDrawWaterBody {
  readonly polygon: readonly MapDrawPoint[];
  readonly color: string;
}

/**
 * A park rectangle, drawn as a green fill under the water and the roads.
 * `headingDeg` matches the landmark convention (local +x maps to world
 * (cos, -sin)); every shipped park is axis-aligned today, but the corners are
 * built through the rotation so a future rotated green just works.
 */
export interface MapDrawPark {
  readonly center: MapDrawPoint;
  readonly size: MapDrawPoint;
  readonly headingDeg?: number;
}

/** One muted green for every park — the map reads land use, not species. */
const PARK_FILL = "rgba(96, 138, 88, 0.42)";

const mapParksCache = new WeakMap<object, readonly MapDrawPark[]>();

/**
 * The park rectangles of a landmark list, referentially stable per list.
 *
 * The corner widget re-rasterises its whole offscreen sheet whenever its
 * `parks` prop changes identity, and the caller (`DriveScreen`) renders at HUD
 * rate — a bare `.filter()` at the call site would rebuild the sheet every
 * frame. Map-pack geometry is frozen, so caching on the landmarks array itself
 * is exact.
 */
export function parksFromLandmarks(
  landmarks: readonly {
    readonly kind?: string;
    readonly center: MapDrawPoint;
    readonly size: MapDrawPoint;
    readonly headingDeg?: number;
  }[],
): readonly MapDrawPark[] {
  const cached = mapParksCache.get(landmarks);
  if (cached) return cached;
  const parks = landmarks
    .filter((landmark) => landmark.kind === "park")
    .map((landmark) => ({
      center: landmark.center,
      size: landmark.size,
      headingDeg: landmark.headingDeg,
    }));
  mapParksCache.set(landmarks, parks);
  return parks;
}

/**
 * Roundabout islands are parks too, 15-28 m squares that would rasterise to
 * near-invisible specks and just fuzz the junctions — the maps skip anything
 * whose short side is under this.
 */
const MAP_PARK_MIN_SHORT_SIDE_M = 24;

/**
 * Draws park fills before `drawMapWaterBodies` so a lake sitting inside its
 * park (the Serpentine) reads as water over green, and roads read over both.
 * Until this existed neither map drew parks at all — the royal park was a
 * void in the road network, which is exactly how "why is the park so hidden"
 * reads on a map screen.
 */
export function drawMapParks(
  ctx: CanvasRenderingContext2D,
  parks: readonly MapDrawPark[],
  projector: MinimapProjector,
): void {
  ctx.fillStyle = PARK_FILL;
  for (const park of parks) {
    if (Math.min(park.size.x, park.size.z) < MAP_PARK_MIN_SHORT_SIDE_M) {
      continue;
    }
    const rad = ((park.headingDeg ?? 0) * Math.PI) / 180;
    const axisX = { x: Math.cos(rad), z: -Math.sin(rad) };
    const axisZ = { x: Math.sin(rad), z: Math.cos(rad) };
    const halfX = park.size.x / 2;
    const halfZ = park.size.z / 2;
    const corners = [
      { u: halfX, v: halfZ },
      { u: -halfX, v: halfZ },
      { u: -halfX, v: -halfZ },
      { u: halfX, v: -halfZ },
    ].map(({ u, v }) =>
      projector.project(
        park.center.x + axisX.x * u + axisZ.x * v,
        park.center.z + axisX.z * u + axisZ.z * v,
      ),
    );
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index += 1) {
      ctx.lineTo(corners[index].x, corners[index].y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Every pixel size the overlay draws with. Named rather than derived so the two
 * surfaces can disagree about scale without disagreeing about the drawing.
 */
export interface MapSymbolSizes {
  readonly routeWidthPx: number;
  readonly previewWidthPx: number;
  readonly previewDashPx: readonly [number, number];
  readonly previewRingRadiusPx: number;
  readonly previewRingWidthPx: number;
  readonly destinationRadiusPx: number;
  readonly playerHaloRadiusPx: number;
  readonly playerNosePx: number;
  readonly playerTailPx: number;
}

/**
 * The corner widget's symbol sizes: fractions of its own edge, so the arrow
 * keeps its proportions on the smaller touch map instead of swelling to fill
 * it. These are the numbers the widget has always drawn.
 */
export function minimapSymbolSizes(size: number): MapSymbolSizes {
  return {
    routeWidthPx: Math.max(2, size * MINIMAP_ROUTE_WIDTH_FRACTION),
    previewWidthPx: Math.max(1.5, size * MINIMAP_ROUTE_WIDTH_FRACTION * 0.7),
    previewDashPx: [Math.max(4, size * 0.042), Math.max(4, size * 0.05)],
    previewRingRadiusPx: Math.max(4, size * 0.03),
    previewRingWidthPx: Math.max(2, size * 0.01),
    destinationRadiusPx: Math.max(4, size * 0.042),
    playerHaloRadiusPx: Math.max(8, size * 0.075),
    playerNosePx: Math.max(5, size * 0.055),
    playerTailPx: Math.max(3.5, size * 0.038),
  };
}

/** The gold the route line, the player arrow and the HUD all share. */
export const MAP_ROUTE_COLOR = "#f2c658";
/**
 * Translucent, so the overlap at a crossing brightens into a junction patch on
 * its own — the reason there is no junction pass anywhere in here.
 */
const ROAD_STROKE = "rgba(170, 182, 192, 0.28)";

/** Draws water before roads so bridge surfaces remain clear navigation lines. */
export function drawMapWaterBodies(
  ctx: CanvasRenderingContext2D,
  waterBodies: readonly MapDrawWaterBody[],
  projector: MinimapProjector,
): void {
  for (const body of waterBodies) {
    if (body.polygon.length < 3) continue;
    const first = projector.project(body.polygon[0].x, body.polygon[0].z);
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < body.polygon.length; index += 1) {
      const point = projector.project(
        body.polygon[index].x,
        body.polygon[index].z,
      );
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Strokes the whole road network onto `ctx`. Called once per map and size, into
 * an offscreen canvas the live pass then blits from.
 */
export function drawRoadNetwork(
  ctx: CanvasRenderingContext2D,
  roadSurfaces: readonly MapDrawSurface[],
  projector: MinimapProjector,
  pixelsPerMetre: number,
  floorPx: number,
): void {
  ctx.strokeStyle = ROAD_STROKE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const line of projectRoadNetwork(roadSurfaces, projector)) {
    if (line.points.length < 2) continue;
    ctx.lineWidth = resolveMapRoadWidth(line.widthM, pixelsPerMetre, floorPx);
    ctx.beginPath();
    ctx.moveTo(line.points[0].x, line.points[0].y);
    for (let index = 1; index < line.points.length; index += 1) {
      ctx.lineTo(line.points[index].x, line.points[index].y);
    }
    ctx.stroke();
  }
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly MapDrawPoint[],
  projector: MinimapProjector,
): void {
  ctx.beginPath();
  const first = projector.project(points[0].x, points[0].z);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = projector.project(points[index].x, points[index].z);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

export interface MapOverlayInput {
  readonly projector: MinimapProjector;
  readonly symbols: MapSymbolSizes;
  readonly route?: readonly MapDrawPoint[];
  readonly previewRoute?: readonly MapDrawPoint[];
  readonly destination?: MapDestination | null;
}

/**
 * The lines and the pin: detour preview, GPS route, destination. Assumes the
 * road network has already been laid down underneath, and expects
 * `drawPlayerMarker` to go on top of it — with the place icons in between.
 */
export function drawMapOverlay(
  ctx: CanvasRenderingContext2D,
  { projector, symbols, route, previewRoute, destination }: MapOverlayInput,
): void {
  // The detour preview goes down first, so the committed route paints over it
  // wherever the two share streets — the player is being shown the extra, not
  // a competing plan.
  if (previewRoute && previewRoute.length > 1) {
    ctx.save();
    ctx.strokeStyle = "rgba(250,243,228,0.85)";
    ctx.lineWidth = symbols.previewWidthPx;
    ctx.setLineDash([...symbols.previewDashPx]);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokePolyline(ctx, previewRoute, projector);
    // A hollow ring at the far end: a place being offered, not a pin planted.
    const end = previewRoute[previewRoute.length - 1];
    const at = projector.project(end.x, end.z);
    ctx.setLineDash([]);
    ctx.lineWidth = symbols.previewRingWidthPx;
    ctx.beginPath();
    ctx.arc(at.x, at.y, symbols.previewRingRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The GPS line, under the destination so the pin caps it. One path
  // per update over a few dozen points — the search that produced them ran
  // once, when the destination changed.
  if (route && route.length > 1) {
    ctx.strokeStyle = MAP_ROUTE_COLOR;
    ctx.lineWidth = symbols.routeWidthPx;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokePolyline(ctx, route, projector);
  }

  if (destination) {
    // The head of a map pin: a filled disc with a white eye, sized to sit on
    // top of the route line rather than beside it.
    const point = projector.project(destination.x, destination.z);
    const radius = symbols.destinationRadiusPx;
    ctx.fillStyle = destination.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

}

export interface PlayerMarkerInput {
  readonly projector: MinimapProjector;
  readonly symbols: MapSymbolSizes;
  readonly playerX: number;
  readonly playerZ: number;
  /** Radians, `atan2(dx, dz)` — 0 is +z (north). */
  readonly heading: number;
}

/**
 * The car, drawn last of everything and onto its own canvas.
 *
 * Separate because the place icons are DOM above the map canvas, so anything
 * painted with the roads is behind them — and a marker at a junction would then
 * sit squarely on top of the arrow. On the corner widget the car is always dead
 * centre, and New York puts an enforcement camera on a third of its junctions,
 * so the arrow would disappear every time the player crossed one. Which way am
 * I pointing is the whole job of that widget.
 */
export function drawPlayerMarker(
  ctx: CanvasRenderingContext2D,
  { projector, symbols, playerX, playerZ, heading }: PlayerMarkerInput,
): void {
  // A triangle pointing along the heading. Heading θ maps to a world direction
  // (sin θ, cos θ); on the map +x is right and +z is up (screen -y), so the
  // screen direction is (sin θ, -cos θ).
  const center = projector.project(playerX, playerZ);
  const dx = Math.sin(heading);
  const dy = -Math.cos(heading);
  const px = -dy;
  const py = dx;
  // A soft disc under the arrow, so the car stays findable where the route line
  // runs beneath it and against a bright junction patch.
  ctx.fillStyle = "rgba(242, 198, 88, 0.20)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, symbols.playerHaloRadiusPx, 0, Math.PI * 2);
  ctx.fill();
  const nose = symbols.playerNosePx;
  const tail = symbols.playerTailPx;
  ctx.fillStyle = MAP_ROUTE_COLOR;
  ctx.beginPath();
  ctx.moveTo(center.x + dx * nose, center.y + dy * nose);
  ctx.lineTo(center.x - dx * tail + px * tail, center.y - dy * tail + py * tail);
  ctx.lineTo(center.x - dx * tail - px * tail, center.y - dy * tail - py * tail);
  ctx.closePath();
  ctx.fill();
}
