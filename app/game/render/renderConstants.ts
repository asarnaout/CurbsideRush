/**
 * Camera layer masks, field-of-view bounds, and the y-layer stack
 * that keeps the whole scene from z-fighting.
 *
 * The y-layer values below are the definitive ordering (see
 * docs/rendering.md's "y-layer stack" table, which this module backs):
 *
 *   0.02 park lawn  <  0.0255 park beds  <  0.031 park paths/terraces
 *   <  0.045 shoulder  <  0.0435 shoulder junction fill  <  0.07 road surface
 *   <  0.0716 asphalt junction fill  <  ...
 *
 * They are spread across three modules in total (here, crowdRenderer.ts,
 * vehicleMeshes.ts) because each layer belongs to the geometry that draws
 * it — this file only owns the ones GameCanvas.tsx's own builders read.
 * Changing one without the others out of sync is exactly how a park lawn
 * ends up coplanar with its own path.
 */

export const MIN_HORIZONTAL_FOV = (55 * Math.PI) / 180;
export const MAX_HORIZONTAL_FOV = (100 * Math.PI) / 180;
export const DEFAULT_HORIZONTAL_FOV = (72 * Math.PI) / 180;
export const clampHorizontalFieldOfView = (value: number) =>
  Math.min(Math.max(value, MIN_HORIZONTAL_FOV), MAX_HORIZONTAL_FOV);
export const WORLD_LAYER_MASK = 0x0fffffff;
/**
 * The cabin's own bit, so the rear-view camera never sees it.
 *
 * First person renders the whole scene twice — once full-screen, once into the
 * mirror strip — and the mirror looks backwards from a point behind the
 * dashboard. Every cockpit mesh submitted to that pass is work with no possible
 * effect on a pixel.
 */
export const COCKPIT_LAYER_MASK = 0x20000000;
export const PRIMARY_CAMERA_LAYER_MASK =
  WORLD_LAYER_MASK | COCKPIT_LAYER_MASK;
export const ROAD_SURFACE_Y = 0.07;
// The asphalt junction fill sits a hair ABOVE the carriageway strips so it wins
// the depth test across the whole crossing: it caps the two coplanar road strips
// that would otherwise z-fight where they overlap, and it paves over any dirt
// shoulder that a crossing road's wider strip pushes into the junction throat.
// The dirt-shoulder junction fill stays just below its shoulder strips, forming
// the thin tan apron that rings the paved junction.
export const ROAD_JUNCTION_FILL_Y = ROAD_SURFACE_Y + 0.0016;
export const ROAD_SHOULDER_Y = 0.045;
export const ROAD_SHOULDER_JUNCTION_FILL_Y = ROAD_SHOULDER_Y - 0.0015;
/**
 * A park lawn's surface. Was the top face of a 0.02-high box, and stays at that
 * height: parks sit deliberately BELOW the shoulder (0.045) and the road (0.07)
 * so an authored road crossing a park keeps visual priority.
 */
export const PARK_LAWN_Y = 0.02;
/**
 * Parterre and court ground patches, on their own rung UNDER the walks: a path
 * may cross a court or graze a bed, and the walk must win. They once shared
 * `PARK_PATH_Y`, which is a coplanar fight the depth buffer cannot settle —
 * the Opera Grounds shipped shimmering because of it.
 */
export const PARK_BED_Y = 0.0255;
/** Park footpaths, in the ~23 mm between the lawn and the shoulder fill. */
export const PARK_PATH_Y = 0.031;
// Lift every building so no model's base plate lands exactly on the ground
// plane. Base plates face -Y and are back-face culled, so this is depth-buffer
// hygiene, not a visible-flicker fix — the Cairo brick-band flicker was never
// here (see CAIRO_DECAL_Z_OFFSET_UNITS). Above the sidewalk band (0.045),
// small enough to read as flush.
export const BUILDING_GROUND_LIFT = 0.08;
/**
 * Clearance between a procedural facade box's base plate and the pavement
 * band: every `createFacadeBox` caller passes height/2, so the plate lands
 * exactly at `BUILDING_GROUND_LIFT`. Keep it positive so the plate is never
 * coplanar with the ground or the pavement. The instanced glbs get the same
 * lift but not the same guarantee — six Cairo models' native bases dip below
 * y=0 (cairo-block-slim and -terrace by 0.076 at placement scale), landing
 * them just above the ground plane instead.
 */
export const BUILDING_BASE_CLEARANCE_M =
  BUILDING_GROUND_LIFT - ROAD_SHOULDER_Y;
/**
 * Metres of world per repeat of the grass tile. Every grass surface — the base
 * ground and every park lawn — uses this one figure so a park never shows a
 * seam against the ground it sits on.
 *
 * Small enough that individual blades read at walking distance; the visible
 * repeat that follows from that is what `GRASS_DETAIL_TILE_M` exists to break.
 */
export const GRASS_TILE_M = 12;
/**
 * The detail map's own repeat. Deliberately not a divisor of `GRASS_TILE_M` —
 * 3.1 against 12 beats at ~37 m rather than reinforcing the base tile's grid,
 * which is the entire point of the second layer.
 */
export const GRASS_DETAIL_TILE_M = 3.1;
