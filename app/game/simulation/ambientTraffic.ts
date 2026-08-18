/**
 * The production pool is deliberately fixed while traffic placement becomes
 * local. Keeping the ceiling beside its normalization prevents the adapter,
 * core, and renderer from quietly budgeting different numbers of vehicles.
 */
export const AMBIENT_VEHICLE_SLOT_CEILING = 32;

/**
 * Normalizes every ambient vehicle budget at the simulation boundary.
 *
 * A malformed authored value must never create a partial renderer-only pool:
 * non-finite values become zero, finite values truncate toward zero, and the
 * shared production ceiling remains the final bound.
 */
export function normalizeAmbientVehicleSlotCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    AMBIENT_VEHICLE_SLOT_CEILING,
    Math.max(0, Math.trunc(value)),
  );
}
