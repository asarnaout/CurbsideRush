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
 * Every write is a method, including the citation timers, which have no
 * state mirror to pair and so look like a case for a raw exposed ref. They
 * are not one: `useGameEventHandler.ts` receives this port as a plain
 * argument, and the React Compiler's ESLint rules refuse to let a hook
 * mutate anything reachable from its own arguments, `ref.current` included —
 * only a ref created by a *local* `useRef` in the hook that owns it is
 * provably safe to mutate, which is exactly why these are `useRef` calls in
 * here and methods everywhere else. Reads are unaffected (an argument's
 * `.current` may still be read freely), so callers needing the live value —
 * `useGameEventHandler`'s cutscene-nonce check, `handleHud`'s tow/cutscene
 * guard — still read `drive.cutsceneRef.current`/`drive.towingRef.current`
 * directly.
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
  /** The shortest gap between two fines from *any* source (3s) — read live. */
  readonly lastAnyFineAtRef: MutableRefObject<number>;
  /** A witnessed (non-speeding) violation's own re-arm clock (8s) — read live. */
  readonly lastFineAtRef: MutableRefObject<number>;
  /** Striking a pedestrian or cyclist's own clock (4s) — read live. */
  readonly lastPedFineAtRef: MutableRefObject<number>;
  /** A speeding stop's much longer grace period — read live. */
  readonly lastSpeedingFineAtRef: MutableRefObject<number>;
  /** Why and how much the staged pull-over will charge at its `cite` step. */
  readonly pendingFineReasonRef: MutableRefObject<string | null>;
  readonly pendingFineAmountRef: MutableRefObject<number | null>;
  /** Stamps the shared any-mechanism clock — the one every fine path touches. */
  stampAnyFineAt(nowMs: number): void;
  /** Stamps a witnessed (non-speeding) violation's own re-arm clock. */
  stampFineAt(nowMs: number): void;
  /** Stamps striking-a-pedestrian-or-cyclist's own clock. */
  stampPedFineAt(nowMs: number): void;
  /** Stamps a speeding stop's clock. */
  stampSpeedingFineAt(nowMs: number): void;
  /** Stages what the pull-over's `cite` step will charge, together. */
  stagePendingFine(amount: number | null, reason: string): void;
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
  const stampAnyFineAt = useCallback((nowMs: number) => {
    lastAnyFineAtRef.current = nowMs;
  }, []);
  const stampFineAt = useCallback((nowMs: number) => {
    lastFineAtRef.current = nowMs;
  }, []);
  const stampPedFineAt = useCallback((nowMs: number) => {
    lastPedFineAtRef.current = nowMs;
  }, []);
  const stampSpeedingFineAt = useCallback((nowMs: number) => {
    lastSpeedingFineAtRef.current = nowMs;
  }, []);
  const stagePendingFine = useCallback(
    (amount: number | null, reason: string) => {
      pendingFineAmountRef.current = amount;
      pendingFineReasonRef.current = reason;
    },
    [],
  );

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
    stampAnyFineAt,
    stampFineAt,
    stampPedFineAt,
    stampSpeedingFineAt,
    stagePendingFine,
  };
}
