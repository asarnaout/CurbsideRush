/**
 * The dispatch loop: when work is offered, how long you have to answer, and
 * when the city is paying double.
 *
 * The game used to assign the next gig the instant the last one landed, so
 * there was never a decision to make and never a quiet minute. This module is
 * the other half of that loop — offers open, you accept or pass, and sometimes
 * nothing comes for a while.
 *
 * Pure in the `gigs.ts` sense: the only import is a hash and a type from
 * `gigs.ts` itself, there is no clock and no stored RNG. Every answer is a
 * function of a seed and a **sim-clock** millisecond count, which is what makes
 * it replayable — Career's "a mid-day quit redoes the day" invariant means a
 * retried day must offer the same work at the same moments, so nothing here may
 * reach for `Date.now` or `Math.random`. Callers step it from the 10 Hz HUD
 * snapshot, whose `simElapsedMs` pauses with the simulation; dispatch therefore
 * pauses too, exactly as the career day clock does.
 */

import { hashToUnit } from "./gigs";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Surge
// ---------------------------------------------------------------------------

/**
 * How often the city is asked whether a surge starts. Windows always open on
 * an epoch boundary, which nobody can perceive but which is what lets the whole
 * mechanic be stateless — see `surgeWindowAt`.
 */
export const SURGE_EPOCH_MS = 30_000;

/**
 * Chance each epoch opens a window. At 7% per 30 s a six-minute career day sees
 * one about 58% of the time (`1 - 0.93^12`) — uncommon enough to feel like an
 * event, common enough that a player who never chases one is leaving money on
 * the table.
 */
export const SURGE_CHANCE = 0.07;

export const SURGE_MIN_MS = 60_000;
export const SURGE_MAX_MS = 120_000;

/** What a surge does to a fare, and to the tip on top of it. */
export const SURGE_FARE_MULTIPLIER = 2;
/**
 * Tips are *reduced* during a surge rather than doubled with the fare: the
 * customer is already paying twice the going rate and feels it, which is
 * exactly how the real apps behave.
 */
export const SURGE_TIP_FACTOR = 0.6;

export interface SurgeWindow {
  /** Sim-clock ms the window opened. */
  readonly startMs: number;
  /** Sim-clock ms it closes. */
  readonly endMs: number;
  readonly multiplier: number;
}

/** Epochs to look back — the longest a window can still be running from. */
const SURGE_LOOKBACK_EPOCHS = Math.ceil(SURGE_MAX_MS / SURGE_EPOCH_MS);

const SURGE_ROLL_SALT = 0x51_2a_9e_37;
const SURGE_LENGTH_SALT = 0x2f_6b_c1_05;

/** Mixes a seed with an epoch index into something the hash will scatter. */
const surgeKey = (seed: number, epoch: number, salt: number): number =>
  ((seed ^ salt) + Math.imul(epoch + 1, 0x9e3779b1)) | 0;

/**
 * The surge window covering `nowMs`, or null.
 *
 * Stateless by construction: rather than storing a window and ticking it down,
 * this asks each of the last few epochs whether it opened one and whether that
 * one is still running. There is nothing to reset between drives, nothing to
 * persist, and no way for the answer to drift from the seed. Overlapping rolls
 * merge — the window runs to the later end — so a run of lucky epochs reads as
 * one long surge rather than a flicker.
 *
 * O(SURGE_LOOKBACK_EPOCHS), which is four.
 */
export function surgeWindowAt(seed: number, nowMs: number): SurgeWindow | null {
  if (!Number.isFinite(nowMs) || nowMs < 0) return null;
  const epoch = Math.floor(nowMs / SURGE_EPOCH_MS);
  let startMs = 0;
  let endMs = -1;
  for (let index = Math.max(0, epoch - SURGE_LOOKBACK_EPOCHS); index <= epoch; index += 1) {
    if (hashToUnit(surgeKey(seed, index, SURGE_ROLL_SALT)) >= SURGE_CHANCE) continue;
    const start = index * SURGE_EPOCH_MS;
    const span =
      SURGE_MIN_MS +
      hashToUnit(surgeKey(seed, index, SURGE_LENGTH_SALT)) * (SURGE_MAX_MS - SURGE_MIN_MS);
    const end = start + Math.round(span);
    if (end <= nowMs) continue;
    if (endMs < 0) {
      startMs = start;
      endMs = end;
    } else {
      startMs = Math.min(startMs, start);
      endMs = Math.max(endMs, end);
    }
  }
  if (endMs <= nowMs) return null;
  return { startMs, endMs, multiplier: SURGE_FARE_MULTIPLIER };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** How long an offer stays on screen before it is lost. */
export const OFFER_WINDOW_MS = 15_000;

/** Shortest and longest quiet spell between offers. */
export const SEARCH_MIN_MS = 2_500;
export const SEARCH_MAX_MS = 45_000;

/**
 * Skews the wait towards the short end. A flat draw over 2.5–45 s averages a
 * near-24-second gap, which reads as the game being broken rather than the city
 * being quiet; raising the unit draw to this power pulls the mean to about 16 s
 * and keeps the full 45 s as a rare, noticeable lull.
 */
const SEARCH_BIAS = 2.2;

const SEARCH_SALT = 0x7a_31_c4_9b;

/** How long dispatch stays quiet before opening the offer with this seed. */
export function searchDelayMs(seed: number): number {
  const unit = hashToUnit((seed ^ SEARCH_SALT) | 0);
  return Math.round(
    SEARCH_MIN_MS + Math.pow(unit, SEARCH_BIAS) * (SEARCH_MAX_MS - SEARCH_MIN_MS),
  );
}

export type DispatchPhase = "idle" | "offered";

export interface DispatchState {
  readonly phase: DispatchPhase;
  /**
   * Seed of the live offer, or of the one that opens next. It advances once per
   * offer **opened**, never per offer accepted — so a replayed career day sees
   * the identical sequence of jobs however the player answered them.
   */
  readonly offerSeed: number;
  /** Sim-clock ms the live offer opened. Only meaningful while `offered`. */
  readonly offeredAtMs: number;
  /** Sim-clock ms the next offer opens. Only meaningful while `idle`. */
  readonly nextOfferAtMs: number;
}

/** What a step did, so the caller knows when to build a gig or fire a toast. */
export type DispatchEvent = "none" | "opened" | "expired";

export interface DispatchStep {
  readonly state: DispatchState;
  readonly event: DispatchEvent;
}

/**
 * A drive's opening dispatch state: idle, armed to fire at once.
 *
 * Starting a drive always comes with something to answer — being dropped into
 * a city with no work and no idea whether any is coming is a bad first ten
 * seconds, so the first offer lands at t=0 and the quiet spells start after it.
 */
export function createDispatch(baseSeed: number): DispatchState {
  return {
    phase: "idle",
    offerSeed: baseSeed,
    offeredAtMs: 0,
    nextOfferAtMs: 0,
  };
}

/** Closes the live (or pending) offer and arms the next one. */
function armNext(state: DispatchState, nowMs: number): DispatchState {
  const offerSeed = state.offerSeed + 1;
  return {
    phase: "idle",
    offerSeed,
    offeredAtMs: 0,
    nextOfferAtMs: nowMs + searchDelayMs(offerSeed),
  };
}

/**
 * Advances dispatch to `nowMs`.
 *
 * `canOffer` is false when the player's hands are full — carrying a gig with
 * another already queued behind it. Rather than letting the countdown run down
 * while blocked (which would fire an offer the instant a slot freed, every
 * time), the wait is continuously re-armed, so clearing the queue starts a
 * fresh quiet spell.
 */
export function stepDispatch(
  state: DispatchState,
  nowMs: number,
  canOffer: boolean,
): DispatchStep {
  if (state.phase === "offered") {
    if (nowMs - state.offeredAtMs < OFFER_WINDOW_MS) return { state, event: "none" };
    return { state: armNext(state, nowMs), event: "expired" };
  }
  if (!canOffer) {
    return {
      state: { ...state, nextOfferAtMs: nowMs + searchDelayMs(state.offerSeed) },
      event: "none",
    };
  }
  if (nowMs < state.nextOfferAtMs) return { state, event: "none" };
  return {
    state: { ...state, phase: "offered", offeredAtMs: nowMs },
    event: "opened",
  };
}

/**
 * Answers the live offer. Accepting and passing land in the same place: the
 * only cost of being picky is the wait for the next one, which is deliberate —
 * a hidden acceptance-rate stat would punish the player for a choice the game
 * just asked them to make.
 */
export function resolveOffer(state: DispatchState, nowMs: number): DispatchState {
  if (state.phase !== "offered") return state;
  return armNext(state, nowMs);
}

/** Milliseconds left on the live offer, floored at zero. */
export function offerRemainingMs(state: DispatchState, nowMs: number): number {
  if (state.phase !== "offered") return 0;
  return Math.max(0, OFFER_WINDOW_MS - (nowMs - state.offeredAtMs));
}

/** How much of the live offer's window has burnt, 0→1. Drives the card's fuse. */
export function offerElapsedFraction(state: DispatchState, nowMs: number): number {
  if (state.phase !== "offered") return 0;
  const elapsed = (nowMs - state.offeredAtMs) / OFFER_WINDOW_MS;
  return Math.min(1, Math.max(0, elapsed));
}

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

/**
 * Par-time model for the carrying leg (pickup scene done → dropped off): the
 * effective city pace of the reference sedan, a slack factor covering
 * road-versus-straight-line detour plus forgiveness, and a floor so a short hop
 * is never impossible.
 *
 * Lives here rather than in `career.ts` because tips are no longer a Career
 * mechanic — free drive pays them too, at `paceFactor` 1.
 */
export const PAR_BASE_SPEED_MPS = 8;
export const PAR_SLACK = 1.9;
export const PAR_MIN_MS = 45_000;

/**
 * The tip window for one gig. A pure function of the gig and the vehicle, so it
 * replays identically on a retried day.
 */
export function gigParMs(pickupToDropoffM: number, paceFactor: number): number {
  const seconds = (pickupToDropoffM / (PAR_BASE_SPEED_MPS * paceFactor)) * PAR_SLACK;
  return Math.max(PAR_MIN_MS, Math.round(seconds * 1000));
}

/** Share of the gross a food order tips, drawn once and quoted with the offer. */
export const FOOD_TIP_MIN_RATE = 0.08;
export const FOOD_TIP_MAX_RATE = 0.28;

/**
 * Chance an on-time food delivery earns something extra on top of the quoted
 * tip, and what that is worth as a share of the gross.
 *
 * Deliberately a coin-flip rather than a rule: a customer who is pleased their
 * food arrived hot *might* add to what they already tipped. Guaranteeing it
 * would turn the quoted figure into a lie and make par a second fare table.
 */
export const FOOD_SPEED_BONUS_CHANCE = 0.45;
export const FOOD_SPEED_BONUS_RATE = 0.08;

/** The most generous a rider ever is, before speed and driving are accounted for. */
export const RIDE_TIP_MAX_RATE = 0.22;
/**
 * Floor the speed factor never drops below. A slow ride still tips something —
 * riders forgive traffic, and zeroing the tip for a long trip would punish the
 * player for the city rather than for their driving.
 */
export const RIDE_TIP_SLOW_FLOOR = 0.35;
/** Share of what is left that each rule broken during the ride costs. */
export const RIDE_TIP_VIOLATION_PENALTY = 0.3;

const FOOD_TIP_SALT = 0x13_9a_5c_71;
const FOOD_BONUS_SALT = 0x64_c2_0d_3f;
const RIDE_TIP_SALT = 0x38_e7_b1_92;

/** Applies the surge discount, then rounds to whole currency units. */
const settle = (gross: number, rate: number, surged: boolean): number => {
  const scaled = rate * (surged ? SURGE_TIP_FACTOR : 1);
  return Math.max(0, Math.round(gross * scaled));
};

/**
 * What a food order tips, known before the offer is accepted.
 *
 * A delivery customer decides their tip in the app when they order, so the
 * figure is real and shows on the card — it is part of what the player is
 * weighing up, not a reward revealed afterwards.
 */
export function quotedTip(gross: number, seed: number, surged = false): number {
  const rate =
    FOOD_TIP_MIN_RATE +
    hashToUnit((seed ^ FOOD_TIP_SALT) | 0) * (FOOD_TIP_MAX_RATE - FOOD_TIP_MIN_RATE);
  return settle(gross, rate, surged);
}

/**
 * The extra a *fast* food delivery may earn on top of the quoted tip — zero if
 * it was late, and zero on a bit under half of on-time runs.
 */
export function foodSpeedBonus(gross: number, seed: number, onTime: boolean, surged = false): number {
  if (!onTime) return 0;
  if (hashToUnit((seed ^ FOOD_BONUS_SALT) | 0) >= FOOD_SPEED_BONUS_CHANCE) return 0;
  return settle(gross, FOOD_SPEED_BONUS_RATE, surged);
}

/**
 * How well the carrying leg was driven, 1 at or inside par falling to 0 at
 * twice it.
 */
export function ridePromptness(elapsedMs: number, parMs: number): number {
  if (!(parMs > 0)) return 1;
  if (elapsedMs <= parMs) return 1;
  return clamp(1 - (elapsedMs - parMs) / parMs, 0, 1);
}

export interface RideTipInputs {
  /** From `ridePromptness`. */
  readonly promptness: number;
  /** Rules broken between boarding and getting out. */
  readonly violations: number;
  readonly surged?: boolean;
}

/**
 * What a rider tips, unknown until they are out of the car.
 *
 * Unlike a food order there is no figure decided up front — the passenger is
 * sitting there watching how the trip goes, and what they leave depends on how
 * long it took and how it was driven. Each violation costs a share of what is
 * left rather than a flat amount, so the first one stings and the tenth cannot
 * push the tip negative.
 */
export function rideTip(gross: number, seed: number, inputs: RideTipInputs): number {
  const generosity = hashToUnit((seed ^ RIDE_TIP_SALT) | 0) * RIDE_TIP_MAX_RATE;
  const speed =
    RIDE_TIP_SLOW_FLOOR + (1 - RIDE_TIP_SLOW_FLOOR) * clamp(inputs.promptness, 0, 1);
  const behaviour = Math.pow(
    1 - RIDE_TIP_VIOLATION_PENALTY,
    Math.max(0, Math.floor(inputs.violations)),
  );
  return settle(gross, generosity * speed * behaviour, inputs.surged === true);
}
