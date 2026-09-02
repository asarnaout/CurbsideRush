import type { SpeedLimitSignPlacement } from "./regulatorySigns";

/**
 * Floor repeaters created where a same-limit Queensview corridor is split by
 * an exit branch. Drivers already pass a 40 mph entry sign well inside the
 * 480 m repeater interval, so these two add clutter without information; the
 * west one also crowds Third Avenue's ramp-mouth ONE WAY blade.
 */
export const NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS = [
  "nyc-queensview-bridge@510,-834.7:w:limit40:repeater",
  "nyc-queensview-bridge@730,-841.7:e:limit40:repeater",
] as const;

const REMOVED_SPEED_SIGN_REF_IDS = new Set<string>(
  NYC_REMOVED_QUEENSVIEW_SPEED_SIGN_REF_IDS,
);

export function curateNycSpeedLimitSigns(
  placements: readonly SpeedLimitSignPlacement[],
): readonly SpeedLimitSignPlacement[] {
  return placements.filter(
    (placement) => !REMOVED_SPEED_SIGN_REF_IDS.has(placement.refId),
  );
}
