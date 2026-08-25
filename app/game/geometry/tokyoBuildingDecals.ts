/**
 * Tokyo's three Quaternius block models use the same geometry as their Cairo
 * counterparts: brick patches, dark trim and glazing are separate primitives
 * laid only millimetres over the wall. At ordinary driving distances a 24-bit
 * depth buffer can no longer resolve that authored gap, so the wall wins parts
 * of the dark primitives as the camera moves and they flash pale/white.
 *
 * Pulling only the overlay materials toward the camera by two polygon-offset
 * units separates them in depth without moving the meshes or changing the
 * building silhouette. The value matches the proven Cairo and London fixes
 * for this exact Quaternius construction.
 */
export const TOKYO_BLOCK_DECAL_Z_OFFSET_UNITS = -2;

export const TOKYO_BLOCK_DECAL_MATERIAL_NAMES: readonly string[] = [
  "Bricks",
  "Dark",
  "DarkBrown",
  "DarkWood",
  "Glass",
];

/** Restrict the bias to the three affected flat-palette Quaternius models. */
export const TOKYO_QUATERNIUS_BLOCK_URL_RE =
  /\/tokyo-block-(?:slim|small|4story)\.glb(?:[?#].*)?$/;

export function biasTokyoBlockDecalMaterials(
  materials: readonly { name: string; zOffsetUnits: number }[],
): number {
  let biased = 0;
  for (const material of materials) {
    if (!TOKYO_BLOCK_DECAL_MATERIAL_NAMES.includes(material.name)) continue;
    material.zOffsetUnits = TOKYO_BLOCK_DECAL_Z_OFFSET_UNITS;
    biased += 1;
  }
  return biased;
}
