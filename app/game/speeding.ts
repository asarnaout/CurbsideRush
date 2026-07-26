// What counts as a speeding offence worth stopping someone for, and how far
// over the limit they were — the measurement half of a speeding ticket.
//
// Pure and money-free, because both rings need it and neither can reach the
// other's: `GameCanvas` decides whether a patrol acts and deliberately knows
// nothing of `content.ts`, while `SideSwapApp` decides what it costs and only
// ever loads `GameCanvas` lazily. Pricing lives in `content.ts`'s
// `speedingFine`, which is the one part that needs a currency.

import type { SpeedUnit } from "./types";

/**
 * How far over the limit a patrol will actually pull someone over for, on top
 * of the tolerance the coaching already allows.
 *
 * The rule monitor coaches at `max(1.3, limit * 0.08)` over — about 3 mph on a
 * 30 — which is the right place to *say something* and completely the wrong
 * place to take money. No force writes a ticket for three over, and with a
 * patrol inside 35 m being common, citing at the coaching threshold would stop
 * a driver for drifting. This second, wider band is what a ticket costs: the
 * coaching still fires underneath it and charges nothing.
 */
export const CITATION_TOLERANCE_MPS = 2.2;
export const CITATION_TOLERANCE_FRACTION = 0.15;

/**
 * How long after a speeding stop before another one can be staged.
 *
 * The rule re-arms after 8 s in the core and the app's own fine debounce is
 * another 8, so a driver holding well over on a long avenue would be pulled
 * roughly every ten seconds — more often than any other fineable rule can
 * fire, and unrecognisable as policing. The officer just dealt with you.
 */
export const SPEEDING_STOP_GRACE_MS = 45_000;

/**
 * How far over the limit a ticket stops getting worse, in each unit's own
 * figures. Twenty over is where a real schedule stops counting in small steps
 * and starts talking about court.
 */
export const SPEEDING_FINE_FULL_SCALE_OVER: Readonly<Record<SpeedUnit, number>> =
  {
    mph: 20,
    kmh: 32,
  };

/**
 * How far over the limit the driver was, from a `speeding` event's own
 * evidence, or null when the event did not carry both figures.
 *
 * Null is the honest answer rather than zero: the amount charged is derived
 * from this, so a violation that cannot be measured must not be one that can
 * be priced. The monitor always emits both, so this is a contract check.
 */
export function speedingExcessMps(
  evidence: Readonly<Record<string, string | number | boolean>> | undefined,
): number | null {
  const speed = evidence?.speedMps;
  const limit = evidence?.limitMps;
  if (typeof speed !== "number" || typeof limit !== "number" || limit <= 0) {
    return null;
  }
  return speed - limit;
}

/** Whether a `speeding` event is over the line a patrol would stop someone at. */
export function speedingWarrantsCitation(
  evidence: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  const excess = speedingExcessMps(evidence);
  if (excess === null) return false;
  const limit = evidence?.limitMps as number;
  return (
    excess >
    Math.max(CITATION_TOLERANCE_MPS, limit * CITATION_TOLERANCE_FRACTION)
  );
}

/**
 * What to multiply the flat fine by, from how far over the driver was in that
 * country's own posted unit.
 *
 * Runs from 1x at the limit to 2x at `SPEEDING_FINE_FULL_SCALE_OVER` and stops
 * there. In practice a ticket never starts at the bottom of that range: a
 * patrol only cites past its own tolerance, about five over, so real tickets
 * land between roughly 1.25x and 2x.
 */
export function speedingFineMultiplier(
  overInPostedUnits: number,
  speedUnit: SpeedUnit,
): number {
  const over = Number.isFinite(overInPostedUnits)
    ? Math.max(0, overInPostedUnits)
    : 0;
  return 1 + Math.min(1, over / SPEEDING_FINE_FULL_SCALE_OVER[speedUnit]);
}
