/** Shared road-height bands kept inside the simulation dependency boundary. */
export const ELEVATED_ROAD_LEVEL_THRESHOLD_M = 3.5;
export const ELEVATED_ROAD_STRUCTURE_THRESHOLD_M = 0.35;

/**
 * Maximum road-surface height difference at which two road users can still
 * physically touch. This is deliberately smaller than the broad minimap
 * `ground`/`elevated` threshold: a car two metres up a ramp is already above
 * a pedestrian or vehicle on the street below even though it has not reached
 * the fully elevated presentation band yet.
 */
export const ROAD_USER_VERTICAL_CONTACT_M = 1.75;

export function roadLevelAtElevation(
  elevationM: number,
): "ground" | "elevated" {
  return elevationM >= ELEVATED_ROAD_LEVEL_THRESHOLD_M
    ? "elevated"
    : "ground";
}

/** True only when two road-surface elevations occupy the same physical band. */
export function roadElevationsCanInteract(
  firstElevationM: number,
  secondElevationM: number,
  toleranceM = ROAD_USER_VERTICAL_CONTACT_M,
): boolean {
  return (
    Math.abs(firstElevationM - secondElevationM) <=
    Math.max(0, toleranceM)
  );
}

/**
 * Swept version of {@link roadElevationsCanInteract}. A collision probe must
 * not discard a genuine contact when two road users change relative height
 * during the same fixed step, so crossing vertical paths count as touching
 * even when both endpoints sit outside the contact band.
 */
export function roadElevationSweepsCanInteract(
  firstStartElevationM: number,
  firstEndElevationM: number,
  secondStartElevationM: number,
  secondEndElevationM: number,
  toleranceM = ROAD_USER_VERTICAL_CONTACT_M,
): boolean {
  const tolerance = Math.max(0, toleranceM);
  const startDifference =
    firstStartElevationM - secondStartElevationM;
  const endDifference = firstEndElevationM - secondEndElevationM;
  return (
    Math.abs(startDifference) <= tolerance ||
    Math.abs(endDifference) <= tolerance ||
    (startDifference < 0 && endDifference > 0) ||
    (startDifference > 0 && endDifference < 0)
  );
}
