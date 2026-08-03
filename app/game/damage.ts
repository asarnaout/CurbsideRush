/**
 * The car-condition model for the open world: how much a collision event
 * hurts the car, driven purely by the event's evidence. Condition is
 * per-drive app state (SideSwapApp) starting at 100; it can be bought back at a
 * repair shop for a bill proportional to the damage, and when it reaches zero
 * the car is towed and rebuilt at a premium — the wallet stays the only durable
 * consequence, matching the fine and fuel loops. What either costs is
 * `repairPrice` in `economyTables.ts`, which is where the currencies live.
 *
 * Pure module: no imports, so the tuning is unit-testable in isolation.
 */

export const FULL_CONDITION_PCT = 100;

/**
 * Damage below which no shop bothers lifting the bonnet.
 *
 * Lives here with the condition model rather than with the money, which is what
 * saves inventing a per-country minimum-bill table: five points is about a
 * dollar's work in every currency, and a prompt offering to fix a scuff for a
 * dollar reads as noise rather than as a service.
 */
export const MIN_REPAIRABLE_DAMAGE_PCT = 5;

/** Condition at or below which the car trails a light smoke wisp. */
export const SMOKE_LIGHT_CONDITION_PCT = 35;
/** Condition at or below which the smoke turns heavy. */
export const SMOKE_HEAVY_CONDITION_PCT = 15;

/** Street props that take a real bite out of the bodywork. */
const HEAVY_PROP_KINDS = new Set([
  "tree",
  "streetlight",
  "utility-pole",
  "london-lamp",
]);

type CollisionEvidence = Readonly<
  Record<string, string | number | boolean>
>;

const impactSpeedOf = (evidence: CollisionEvidence): number => {
  const value = evidence.impactSpeedMps;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Condition lost for one collision event. Walls and cars scale with impact
 * speed (a 2 m/s kerb-side scrape is free; a 15 m/s head-on takes ~40);
 * pedestrians barely mark the car — their cost is the citation; props charge
 * a flat rate by heft.
 */
export function damageForCollision(evidence: CollisionEvidence): number {
  if (
    evidence.roadUserType === "pedestrian" ||
    evidence.roadUserType === "cyclist"
  ) {
    return 6;
  }
  if (evidence.obstacle === "prop") {
    return HEAVY_PROP_KINDS.has(String(evidence.propKind)) ? 6 : 2;
  }
  const impact = impactSpeedOf(evidence);
  if (typeof evidence.vehicleId === "string") {
    return clamp((impact - 1.5) * 3.5, 2, 45);
  }
  if (typeof evidence.obstacle === "string") {
    return clamp((impact - 2) * 3.2, 0, 40);
  }
  return 0;
}
