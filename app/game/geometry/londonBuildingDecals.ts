/**
 * The Quaternius London terrace/stucco models build their corner quoins, dark
 * base bands and glazing as separate primitives laid directly over the wall.
 * Their authored separation is only a few millimetres (and quantization can
 * collapse it entirely), so a 24-bit depth buffer eventually treats both
 * surfaces as the same plane. The pale wall then wins individual triangles as
 * the camera moves, producing the white flashes visible on the dark bricks.
 *
 * A negative polygon-offset unit pulls only those overlay materials toward the
 * camera. Unlike moving the geometry by a fixed distance, the offset follows
 * the local depth-buffer quantum and remains effective throughout the map's
 * viewing range. Two units matches the established Quaternius Cairo fix while
 * leaving the wall, roof and trim materials at their authored depth.
 */
export const LONDON_DECAL_Z_OFFSET_UNITS = -2;

export const LONDON_DECAL_MATERIAL_NAMES: readonly string[] = [
  "Bricks",
  "Bricks_Glass",
  "Dark",
  "DarkBrown",
  "DarkWood",
  "Glass",
];

/** Restrict the bias to the affected Quaternius family, not every London GLB. */
export const LONDON_QUATERNIUS_STREET_WALL_URL_RE =
  /\/london-(?:terrace|stucco)-[^/?#]+\.glb(?:[?#].*)?$/;

export function biasLondonDecalMaterials(
  materials: readonly { name: string; zOffsetUnits: number }[],
): number {
  let biased = 0;
  for (const material of materials) {
    if (!LONDON_DECAL_MATERIAL_NAMES.includes(material.name)) continue;
    material.zOffsetUnits = LONDON_DECAL_Z_OFFSET_UNITS;
    biased += 1;
  }
  return biased;
}
