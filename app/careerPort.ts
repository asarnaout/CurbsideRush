/**
 * The career port: the in-flight career day's own state — which run is
 * live, the day-local cash and ledger (settled into the persisted slice only
 * at day's end), the day clock, and the flags that coordinate settlement
 * with whatever else is on screen when the whistle blows. See
 * `app/drivePort.ts`'s header for why this, the drive session's own status
 * and the active gig (`gigDispatchPort.ts`) are three separate ports.
 *
 * Unlike the drive port, most of what is here is exposed as plain
 * ref/state/setter triples rather than wrapped in bespoke methods. That is
 * a direct read of the evidence, not an inconsistency: `handleGameEvent` and
 * the sibling callbacks that fold into `useGameEventHandler` never *write*
 * `careerRun`, the day clock or the day-active flag — only
 * `beginCareerDay`/`endCareerDay`/`finishCareerDayExit`/`handleHud` do, and
 * every one of those already pairs `xRef.current = y; setX(y)` correctly by
 * hand today. There is no in-scope compound write to fold into a method, so
 * wrapping them would add a layer without removing a risk. `chargeCareer` is
 * the one genuine exception — it is the atomic debit+ledger operation every
 * fine/repair/refuel/tow path in `useGameEventHandler` performs — so it is
 * the one method this port defines.
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { DayLedgerInput } from "./game/career";
import { DAY_LENGTH_MS, emptyDayLog } from "./game/career";
import type { CareerRun } from "./SideSwapApp";

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

  const dayElapsedBaseRef = useRef(0);
  const lastSimElapsedRef = useRef(0);
  const [dayRemainingMs, setDayRemainingMs] = useState(DAY_LENGTH_MS);
  const [dayIntroFromMs, setDayIntroFromMs] = useState<number | null>(null);

  const pendingSettleRef = useRef(false);
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
    dayLogRef,
    dayElapsedBaseRef,
    lastSimElapsedRef,
    dayRemainingMs,
    setDayRemainingMs,
    dayIntroFromMs,
    setDayIntroFromMs,
    pendingSettleRef,
    dayActiveRef,
    endCareerDayRef,
  };
}
