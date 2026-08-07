/**
 * The drive-status port: everything about the *one drive session in
 * progress* that `SideSwapApp`'s `handleGameEvent` used to close over
 * directly — vehicle condition, whether it is mid-tow, the interaction
 * cutscene currently staged, and the citation bookkeeping that spans every
 * mechanism that can fine a driver (a patrol stop, a camera, or striking
 * someone). See `docs/architecture.md`'s port breakdown for why this,
 * career money (`careerPort.ts`) and the active gig (`gigDispatchPort.ts`)
 * are three separate ports rather than one: none of what is here is read
 * outside the driving screen, and none of it survives a drive.
 *
 * Condition, tow and cutscene state expose their writes as atomic ref+state
 * methods (`setCarCondition`, `startTow`/`pulseTowReset`/`endTow`,
 * `beginCutscene`/`clearCutscene`) because the pre-port code paired
 * `xRef.current = y; setX(y)` by hand at every call site — folding the pair
 * into one method is what makes a future caller unable to write one without
 * the other. The citation dedupe timers below have no state mirror to pair
 * (nothing renders them directly), so they stay raw refs; the asymmetric,
 * per-mechanism dedupe logic that reads them lives in `useGameEventHandler`,
 * carried over unchanged rather than flattened into a generic method that
 * would risk losing the asymmetry (see that file's header for why it is
 * asymmetric — the pedestrian-collision path and the generic fine-event path
 * check a different subset of these clocks, in a different order).
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { FULL_CONDITION_PCT } from "./game/damage";
import type { CutsceneRequest } from "./game/sessionContract";

/** What the fine toast shows: the amount, why, and who wrote the ticket. */
export interface DriveFineToast {
  readonly amount: number;
  readonly reason: string;
  readonly issuedBy: "patrol" | "camera";
}

export interface DriveStatusPort {
  readonly carCondition: number;
  readonly carConditionRef: MutableRefObject<number>;
  /** Sets the condition state and its ref together. */
  setCarCondition(next: number): void;

  readonly towing: boolean;
  readonly towingRef: MutableRefObject<boolean>;
  /** What the current/last tow actually charged, for the overlay to quote. */
  readonly towFee: number;
  readonly towResetNonce: number;
  /** Starts the tow overlay and stamps the fee. Does not itself charge anyone. */
  startTow(fee: number): void;
  /** The delayed mid-tow beat: car back to full, reset nonce bumped. */
  pulseTowReset(): void;
  /** Ends the tow overlay. */
  endTow(): void;

  readonly cutscene: CutsceneRequest | null;
  readonly cutsceneRef: MutableRefObject<CutsceneRequest | null>;
  beginCutscene(
    kind: CutsceneRequest["kind"],
    venueId?: string,
    actorSeedId?: string,
    fuelFillFraction?: number,
  ): void;
  clearCutscene(): void;

  /** While the pump runs, stretches the fuel bar's CSS transition to match. */
  readonly fuelFillMs: number;
  setFuelFillMs(ms: number): void;

  readonly fineToast: DriveFineToast | null;
  setFineToast(toast: DriveFineToast | null): void;
  /** The shortest gap between two fines from *any* source (3s). */
  readonly lastAnyFineAtRef: MutableRefObject<number>;
  /** A witnessed (non-speeding) violation's own re-arm clock (8s). */
  readonly lastFineAtRef: MutableRefObject<number>;
  /** Striking a pedestrian or cyclist's own clock (4s). */
  readonly lastPedFineAtRef: MutableRefObject<number>;
  /** A speeding stop's much longer grace period. */
  readonly lastSpeedingFineAtRef: MutableRefObject<number>;
  /** Why and how much the staged pull-over will charge at its `cite` step. */
  readonly pendingFineReasonRef: MutableRefObject<string | null>;
  readonly pendingFineAmountRef: MutableRefObject<number | null>;
}

export function useDriveStatusPort(): DriveStatusPort {
  const [carCondition, setCarConditionState] = useState(FULL_CONDITION_PCT);
  const carConditionRef = useRef(FULL_CONDITION_PCT);
  const setCarCondition = useCallback((next: number) => {
    carConditionRef.current = next;
    setCarConditionState(next);
  }, []);

  const [towing, setTowing] = useState(false);
  const towingRef = useRef(false);
  const [towFee, setTowFee] = useState(0);
  const towResetNonceRef = useRef(0);
  const [towResetNonce, setTowResetNonce] = useState(0);
  const startTow = useCallback((fee: number) => {
    towingRef.current = true;
    setTowing(true);
    setTowFee(fee);
  }, []);
  const pulseTowReset = useCallback(() => {
    towResetNonceRef.current += 1;
    setTowResetNonce(towResetNonceRef.current);
    carConditionRef.current = FULL_CONDITION_PCT;
    setCarConditionState(FULL_CONDITION_PCT);
  }, []);
  const endTow = useCallback(() => {
    towingRef.current = false;
    setTowing(false);
  }, []);

  const [cutscene, setCutscene] = useState<CutsceneRequest | null>(null);
  const cutsceneRef = useRef<CutsceneRequest | null>(null);
  const cutsceneNonceRef = useRef(0);
  const [fuelFillMs, setFuelFillMs] = useState(0);
  const beginCutscene = useCallback(
    (
      kind: CutsceneRequest["kind"],
      venueId?: string,
      actorSeedId?: string,
      fuelFillFraction?: number,
    ) => {
      if (cutsceneRef.current || towingRef.current) return;
      cutsceneNonceRef.current += 1;
      const request: CutsceneRequest = {
        nonce: cutsceneNonceRef.current,
        kind,
        venueId,
        actorSeedId,
        fuelFillFraction,
      };
      cutsceneRef.current = request;
      setCutscene(request);
    },
    [],
  );
  const clearCutscene = useCallback(() => {
    cutsceneRef.current = null;
    setCutscene(null);
    setFuelFillMs(0);
  }, []);

  const [fineToast, setFineToast] = useState<DriveFineToast | null>(null);
  const lastAnyFineAtRef = useRef(0);
  const lastFineAtRef = useRef(0);
  const lastPedFineAtRef = useRef(0);
  const lastSpeedingFineAtRef = useRef(0);
  const pendingFineReasonRef = useRef<string | null>(null);
  const pendingFineAmountRef = useRef<number | null>(null);

  return {
    carCondition,
    carConditionRef,
    setCarCondition,
    towing,
    towingRef,
    towFee,
    towResetNonce,
    startTow,
    pulseTowReset,
    endTow,
    cutscene,
    cutsceneRef,
    beginCutscene,
    clearCutscene,
    fuelFillMs,
    setFuelFillMs,
    fineToast,
    setFineToast,
    lastAnyFineAtRef,
    lastFineAtRef,
    lastPedFineAtRef,
    lastSpeedingFineAtRef,
    pendingFineReasonRef,
    pendingFineAmountRef,
  };
}
