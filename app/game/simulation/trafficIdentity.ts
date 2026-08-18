/**
 * Identity-only traffic roles shared by simulation and presentation.
 *
 * Keep this module free of renderer and road-network imports. Traffic systems
 * may need to reason about a vehicle's stable role without constructing its
 * mesh or consuming either the simulation or appearance random streams.
 */

export type TrafficIdentityVariant = "car" | "taxi" | "bus" | "van" | "police";

export interface TrafficPatrolIdentity {
  readonly vehicleId: string;
  readonly trafficSeed: number;
  readonly variant: TrafficIdentityVariant;
}

/** Authored police vehicles bypass the ambient passenger-car roll. */
const AMBIENT_PATROL_IN_EVERY = 5;

/** Stable 32-bit FNV-1a hash used by the existing appearance identity rule. */
function hashTrafficIdentity(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedTrafficSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 0;
}

/**
 * Whether an NPC has the patrol role used by presentation.
 *
 * Named `police` variants are always patrols. Generic passenger cars are
 * patrols only when their stable seed/id identity wins the existing one-in-five
 * appearance roll; taxis, buses, and vans never do.
 */
export function isTrafficNpcPatrol(input: TrafficPatrolIdentity): boolean {
  if (input.variant === "police") return true;
  if (input.variant !== "car") return false;
  const identity = `${normalizedTrafficSeed(input.trafficSeed)}|${input.vehicleId}`;
  return hashTrafficIdentity(`${identity}|patrol`) % AMBIENT_PATROL_IN_EVERY === 0;
}
