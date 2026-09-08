import type {
  RegulatorySignPlacement,
  SpeedLimitSignPlacement,
} from "./regulatorySigns";

/**
 * These posts clear their road's nominal width but stand inside the wider
 * profiled merge asphalt. Remove the complete installation, not only its
 * blade; the opposite-side warnings remain outside the driven pavement.
 * The bridge-sign geometry audit checks full poles and faces against every
 * Queensview road strip and junction collar, including terminal movements.
 */
export const NYC_REMOVED_QUEENSVIEW_REGULATORY_SIGN_REF_IDS = [
  "nyc-queensview-manhattan-third-entry-ramp@570,-845.2:dne:l",
  "nyc-queensview-manhattan-third-exit-ramp@510,-834.7:oneway:r",
  "nyc-queensview-queens-vernon-entry-ramp@850,-834.7:dne:r",
  "nyc-queensview-queens-vernon-exit-ramp@730,-845.2:oneway:r",
] as const;

/**
 * The two 40 mph floor repeaters add no information within the 480 m repeat
 * interval. The four 25 mph posts stand inside widened terminal/ramp mouths,
 * despite clearing the narrow strip used by the generic placement search.
 */
export const NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS = [
  "nyc-queensview-bridge@510,-834.7:w:limit40:repeater",
  "nyc-queensview-bridge@730,-841.7:e:limit40:repeater",
  "nyc-queensview-east-carrier@930,-841.7:e:limit25:entry",
  "nyc-queensview-manhattan-65th-exit-ramp@360,-834.7:w:limit25:entry",
  "nyc-queensview-manhattan-third-exit-ramp@510,-834.7:n:limit25:entry",
  "nyc-queensview-queens-vernon-exit-ramp@730,-845.2:s:limit25:entry",
] as const;

const REMOVED_REGULATORY_SIGN_REF_IDS = new Set<string>(
  NYC_REMOVED_QUEENSVIEW_REGULATORY_SIGN_REF_IDS,
);
const REMOVED_SPEED_SIGN_REF_IDS = new Set<string>(
  NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS,
);

export function curateNycRegulatorySigns(
  placements: readonly RegulatorySignPlacement[],
): readonly RegulatorySignPlacement[] {
  return placements.filter(
    (placement) => !REMOVED_REGULATORY_SIGN_REF_IDS.has(placement.refId),
  );
}

export function curateNycSpeedLimitSigns(
  placements: readonly SpeedLimitSignPlacement[],
): readonly SpeedLimitSignPlacement[] {
  return placements.filter(
    (placement) => !REMOVED_SPEED_SIGN_REF_IDS.has(placement.refId),
  );
}
