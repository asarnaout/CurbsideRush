import type {
  RegulatorySignPlacement,
  SpeedLimitSignPlacement,
} from "./regulatorySigns";

/**
 * Cairo's dense one-way network needs fewer physical posts than NYC's grid.
 * One readable post is retained at each logical station, while negative-flow
 * warnings are limited to two well-separated posts over an entire named road.
 */
const CAIRO_WARNING_PAIR_MIN_SEPARATION_M = 72;

const CAIRO_REGULATORY_SIGN_EXCLUSIONS = new Set([
  // Far-east braid: the entry warnings and exit blades overlap each other and
  // stand in the driven ramp envelope.
  "cairo-sixth-october-bridge-east-entry@638,180:dne:l",
  "cairo-sixth-october-bridge-east-entry@638,180:dne:r",
  "cairo-sixth-october-bridge-east-entry@638,180:ww35:l",
  "cairo-sixth-october-bridge-east-entry@638,180:ww35:r",
  "cairo-sixth-october-bridge-east-exit@638,180:oneway:l",
  "cairo-sixth-october-bridge-east-exit@638,180:oneway:r",
  // The ground-level east exit's right DNE and WRONG WAY posts resolve to the
  // same off-kerb gap. Keep the properly seated left DNE instead.
  "cairo-sixth-october-east-exit-slip@713.8,85:dne:r",
  "cairo-sixth-october-east-exit-slip@713.8,85:ww35:r",
  // Corniche access: retain the clear right-side DNE, not the post in the
  // roadway or either near-duplicate WRONG WAY repeater.
  "cairo-sixth-october-bridge-corniche-entry@160,231.6:dne:l",
  "cairo-sixth-october-bridge-corniche-entry@160,231.6:ww35:l",
  "cairo-sixth-october-bridge-corniche-entry@160,231.6:ww35:r",
  // Far-west braid: these are the two centre-road signs in the reviewed exit.
  "cairo-sixth-october-bridge-west-entry@-720,340:dne:l",
  "cairo-sixth-october-bridge-west-exit@-720,340:oneway:r",
]);

export const CAIRO_REMOVED_WEST_RAMP_SPEED_SIGN_REF_ID =
  "cairo-sixth-october-bridge-west-ramp@-664,318.2:w:limit40:repeater";

export const CAIRO_REMOVED_DOKKI_RAMP_SPEED_SIGN_REF_ID =
  "cairo-sixth-october-bridge-dokki-ramp@-610,312.5:nw:limit40:entry";

const CAIRO_SPEED_LIMIT_SIGN_EXCLUSIONS = new Set([
  CAIRO_REMOVED_WEST_RAMP_SPEED_SIGN_REF_ID,
  CAIRO_REMOVED_DOKKI_RAMP_SPEED_SIGN_REF_ID,
]);

const stationKey = (placement: RegulatorySignPlacement): string =>
  placement.refId.replace(/:[lr]$/, "");

const distanceBetween = (
  first: RegulatorySignPlacement,
  second: RegulatorySignPlacement,
): number => Math.hypot(first.x - second.x, first.z - second.z);

/** Prefer the right-hand post in Cairo's right-driving road system. */
function onePostPerStation(
  placements: readonly RegulatorySignPlacement[],
): readonly RegulatorySignPlacement[] {
  const selected = new Map<string, RegulatorySignPlacement>();
  for (const placement of placements) {
    const key = stationKey(placement);
    const current = selected.get(key);
    if (!current || placement.refId.endsWith(":r")) {
      selected.set(key, placement);
    }
  }
  return [...selected.values()];
}

function sparseWarningsForRoad(
  placements: readonly RegulatorySignPlacement[],
): readonly RegulatorySignPlacement[] {
  const doNotEnter = placements
    .filter((placement) => placement.kind === "do_not_enter")
    .sort((a, b) => a.refId.localeCompare(b.refId));
  const wrongWay = placements
    .filter((placement) => placement.kind === "wrong_way")
    .sort((a, b) => a.refId.localeCompare(b.refId));

  if (!doNotEnter.length) return wrongWay.slice(0, 1);
  if (!wrongWay.length) return doNotEnter.slice(0, 1);

  let bestDoNotEnter = doNotEnter[0];
  let bestWrongWay = wrongWay[0];
  let bestSeparationM = distanceBetween(bestDoNotEnter, bestWrongWay);
  for (const first of doNotEnter) {
    for (const second of wrongWay) {
      const separationM = distanceBetween(first, second);
      if (separationM > bestSeparationM) {
        bestDoNotEnter = first;
        bestWrongWay = second;
        bestSeparationM = separationM;
      }
    }
  }

  return bestSeparationM >= CAIRO_WARNING_PAIR_MIN_SEPARATION_M
    ? [bestDoNotEnter, bestWrongWay]
    : [bestDoNotEnter];
}

export function curateCairoRegulatorySigns(
  placements: readonly RegulatorySignPlacement[],
): readonly RegulatorySignPlacement[] {
  const singlePosts = onePostPerStation(
    placements.filter(
      (placement) => !CAIRO_REGULATORY_SIGN_EXCLUSIONS.has(placement.refId),
    ),
  );
  const oneWay = singlePosts.filter(
    (placement) => placement.kind === "one_way",
  );
  const warningsByRoad = new Map<string, RegulatorySignPlacement[]>();
  for (const placement of singlePosts) {
    if (placement.kind === "one_way") continue;
    const roadWarnings = warningsByRoad.get(placement.roadId);
    if (roadWarnings) roadWarnings.push(placement);
    else warningsByRoad.set(placement.roadId, [placement]);
  }
  const warnings = [...warningsByRoad.values()].flatMap(sparseWarningsForRoad);
  return [...oneWay, ...warnings].sort((a, b) => a.refId.localeCompare(b.refId));
}

export function curateCairoSpeedLimitSigns(
  placements: readonly SpeedLimitSignPlacement[],
): readonly SpeedLimitSignPlacement[] {
  return placements.filter(
    (placement) => !CAIRO_SPEED_LIMIT_SIGN_EXCLUSIONS.has(placement.refId),
  );
}
