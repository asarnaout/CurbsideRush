/**
 * The career port: the in-flight career day's own state — which run is
 * live, the day-local cash and ledger (settled into the persisted slice only
 * at day's end), the day clock, and the flags that coordinate settlement
 * with whatever else is on screen when the whistle blows. See
 * `app/drivePort.ts`'s header for why this, the drive session's own status
 * and the active gig (`gigDispatchPort.ts`) are three separate ports — and
 * for why every write here is a method rather than an exposed raw setter on
 * a ref: `useGameEventHandler.ts` receives this port as a plain argument,
 * and the React Compiler's ESLint rules forbid mutating anything reachable
 * from a hook's own arguments, `ref.current` included. Reads are unaffected;
 * `handleHud`/`beginCareerDay`/`endCareerDay`/`finishCareerDayExit` (all
 * still plain `SideSwapApp` code, not hook arguments) keep reading and
 * writing `careerRunRef`/`dayElapsedBaseRef`/`dayActiveRef`/etc. directly,
 * exactly as before this port existed.
 *
 * `chargeCareer` and `recordGigPayout` are the two compound operations
 * `useGameEventHandler` actually performs: a debit (with an optional ledger
 * update) and a completed gig's payout (cash credit plus five ledger fields
 * at once, previously eight lines of manual bookkeeping duplicated nowhere
 * else — the clearest "atomic pair" case of the three ports since it is
 * both a ref+state pair *and* a multi-field struct update, done together or
 * not at all).
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { DayLedgerInput } from "./game/career";
import { DAY_LENGTH_MS, emptyDayLog } from "./game/career";
import type { CareerRun } from "./SideSwapApp";

/** What one completed career gig settles into the day's ledger. */
export interface CareerGigPayoutInput {
  readonly gross: number;
  readonly net: number;
  readonly tip: number;
  readonly onTime: boolean;
  /** `null` when the customer never rated — see `dispatch.ts`'s `gigRating`. */
  readonly stars: number | null;
}

export interface CareerPort {
  readonly careerRun: CareerRun | null;
  readonly careerRunRef: MutableRefObject<CareerRun | null>;
  setCareerRun(next: CareerRun | null): void;

  readonly dayCash: number;
  readonly dayCashRef: MutableRefObject<number>;
  setDayCash(next: number): void;
  /** Debits the day's cash and its ref together, and logs it atomically. */
  chargeCareer(
    amount: number,
    log?: (current: DayLedgerInput) => DayLedgerInput,
  ): void;
  /** Credits a finished gig's cash and its five ledger fields together. */
  recordGigPayout(input: CareerGigPayoutInput): void;
  readonly dayLogRef: MutableRefObject<DayLedgerInput>;

  /** Sim-clock day time, folded across tow resets — see `handleHud`. */
  readonly dayElapsedBaseRef: MutableRefObject<number>;
  readonly lastSimElapsedRef: MutableRefObject<number>;
  readonly dayRemainingMs: number;
  setDayRemainingMs(next: number): void;
  /** How long the "DAY n" title has been up, or null while withheld. */
  readonly dayIntroFromMs: number | null;
  setDayIntroFromMs(next: number | null): void;

  /** The whistle blew mid-cutscene/tow: settle as soon as the scene resolves. */
  readonly pendingSettleRef: MutableRefObject<boolean>;
  /** Clears the deferred-settlement flag once the scene has resolved. */
  clearPendingSettle(): void;
  /** Guards double settlement from the 10 Hz HUD stream. */
  readonly dayActiveRef: MutableRefObject<boolean>;
  /**
   * The freshest `endCareerDay`, assigned each render so a `[]`-deps
   * callback (or a timer queued long before) always calls the current
   * closure without itself needing to be rebuilt.
   */
  readonly endCareerDayRef: MutableRefObject<() => void>;
}

export function useCareerPort(): CareerPort {
  const [careerRun, setCareerRunState] = useState<CareerRun | null>(null);
  const careerRunRef = useRef<CareerRun | null>(null);
  const setCareerRun = useCallback((next: CareerRun | null) => {
    careerRunRef.current = next;
    setCareerRunState(next);
  }, []);

  const [dayCash, setDayCashState] = useState(0);
  const dayCashRef = useRef(0);
  const setDayCash = useCallback((next: number) => {
    dayCashRef.current = next;
    setDayCashState(next);
  }, []);
  const dayLogRef = useRef<DayLedgerInput>(emptyDayLog());
  const chargeCareer = useCallback(
    (amount: number, log?: (current: DayLedgerInput) => DayLedgerInput) => {
      dayCashRef.current -= amount;
      setDayCashState(dayCashRef.current);
      if (log) dayLogRef.current = log(dayLogRef.current);
    },
    [],
  );
  const recordGigPayout = useCallback((input: CareerGigPayoutInput) => {
    dayCashRef.current += input.net + input.tip;
    setDayCashState(dayCashRef.current);
    dayLogRef.current = {
      ...dayLogRef.current,
      grossFares: dayLogRef.current.grossFares + input.gross,
      netFares: dayLogRef.current.netFares + input.net,
      tips: dayLogRef.current.tips + input.tip,
      gigsCompleted: dayLogRef.current.gigsCompleted + 1,
      gigsOnTime: dayLogRef.current.gigsOnTime + (input.onTime ? 1 : 0),
      ratings:
        input.stars === null
          ? dayLogRef.current.ratings
          : [...dayLogRef.current.ratings, input.stars],
    };
  }, []);

  const dayElapsedBaseRef = useRef(0);
  const lastSimElapsedRef = useRef(0);
  const [dayRemainingMs, setDayRemainingMs] = useState(DAY_LENGTH_MS);
  const [dayIntroFromMs, setDayIntroFromMs] = useState<number | null>(null);

  const pendingSettleRef = useRef(false);
  const clearPendingSettle = useCallback(() => {
    pendingSettleRef.current = false;
  }, []);
  const dayActiveRef = useRef(false);
  const endCareerDayRef = useRef<() => void>(() => {});

  return {
    careerRun,
    careerRunRef,
    setCareerRun,
    dayCash,
    dayCashRef,
    setDayCash,
    chargeCareer,
    recordGigPayout,
    dayLogRef,
    dayElapsedBaseRef,
    lastSimElapsedRef,
    dayRemainingMs,
    setDayRemainingMs,
    dayIntroFromMs,
    setDayIntroFromMs,
    pendingSettleRef,
    clearPendingSettle,
    dayActiveRef,
    endCareerDayRef,
  };
}
