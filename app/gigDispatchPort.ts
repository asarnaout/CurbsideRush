/**
 * The gig/dispatch port: the job currently being carried out, whatever is
 * queued behind it, and how a completed one gets announced. See
 * `app/drivePort.ts`'s header for why this, drive status and career money
 * (`careerPort.ts`) are three separate ports.
 *
 * This is deliberately narrower than "the dispatch subsystem": offer
 * scheduling, the surge window and the preview route (`offerRef`,
 * `dispatchRef`, `dispatchStretchRef`, `surge`, `previewRoute`) stay in
 * `SideSwapApp` untouched, because `handleGameEvent` and its folding-in
 * siblings never read or write them — only the job itself, its queue slot,
 * and the carrying-leg bookkeeping (violations witnessed, when the leg
 * started) are in that closure. `dispatchToast` joins this port even though
 * `stepDispatchNow`/`answerOffer` (both out of scope, unchanged) also write
 * it — every one of its four possible messages ("OFFER LOST", "PASSED",
 * "ADDED TO QUEUE"/"JOB ACCEPTED", the paid toast `announcePayout` shows) is
 * dispatch-facing, so splitting it into "the in-scope paid toast" and "the
 * rest" would separate one cohesive piece of UI state for no reason.
 *
 * `gig`/`gigRef` follow the one binding in the whole 38-strong closure that
 * was never manually paired at each write site: a dedicated
 * `useEffect(() => { gigRef.current = gig }, [gig])`, kept verbatim here.
 * `startCarrying`/`endCarryingLeg` exist because the pre-port code repeated
 * the same three-line reset (violations to zero, carrying-since to null,
 * both in the career payout branch of `handleGameEvent` and in the
 * free-drive payout effect) verbatim in two places — the textbook case the
 * issue's "read the existing code for places that already do a pair" advice
 * is pointing at.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { formatMoney } from "./game/economyTables";
import type { Gig } from "./game/gigs";
import type { CountryProfile } from "./game/types";

export interface DispatchToast {
  readonly text: string;
  readonly tone: "accept" | "pass" | "lost" | "paid";
}

export interface GigDispatchPort {
  readonly gig: Gig | null;
  readonly gigRef: MutableRefObject<Gig | null>;
  setGig(next: Gig | null | ((current: Gig | null) => Gig | null)): void;

  readonly queuedGig: Gig | null;
  readonly queuedGigRef: MutableRefObject<Gig | null>;
  setQueuedGig(next: Gig | null): void;
  /** Hands the queued job over on a drop-off, or leaves the driver idle. */
  promoteQueuedGig(): Gig | null;

  readonly carryingSinceMs: number | null;
  readonly carryingSinceRef: MutableRefObject<number | null>;
  /** Rules broken since the current job was picked up — the rider is watching. */
  readonly carryViolationsRef: MutableRefObject<number>;
  /** Starts a carrying leg at `atMs` and zeroes its violation tally. */
  startCarrying(atMs: number): void;
  /** Ends the carrying leg: violations and carrying-since both reset. */
  endCarryingLeg(): void;

  /** Guards a free-drive drop-off from being credited twice. */
  readonly paidGigRef: MutableRefObject<string | null>;

  readonly sessionEarnings: number;
  setSessionEarnings(updater: number | ((total: number) => number)): void;
  readonly payoutGain: string | null;
  setPayoutGain(next: string | null): void;
  readonly dispatchToast: DispatchToast | null;
  setDispatchToast(next: DispatchToast | null): void;
  /** Says what a finished job actually paid, in the shared toast + tally. */
  announcePayout(fare: number, tip: number): void;
}

export function useGigDispatchPort(driveCountry: CountryProfile): GigDispatchPort {
  const [gig, setGig] = useState<Gig | null>(null);
  const gigRef = useRef<Gig | null>(null);
  useEffect(() => {
    gigRef.current = gig;
  }, [gig]);

  const [queuedGig, setQueuedGig] = useState<Gig | null>(null);
  const queuedGigRef = useRef<Gig | null>(null);
  const promoteQueuedGig = useCallback((): Gig | null => {
    const promoted = queuedGigRef.current;
    queuedGigRef.current = null;
    setQueuedGig(null);
    gigRef.current = promoted;
    setGig(promoted);
    return promoted;
  }, []);

  const [carryingSinceMs, setCarryingSinceMs] = useState<number | null>(null);
  const carryingSinceRef = useRef<number | null>(null);
  const carryViolationsRef = useRef(0);
  const startCarrying = useCallback((atMs: number) => {
    carryingSinceRef.current = atMs;
    setCarryingSinceMs(atMs);
    carryViolationsRef.current = 0;
  }, []);
  const endCarryingLeg = useCallback(() => {
    carryViolationsRef.current = 0;
    carryingSinceRef.current = null;
    setCarryingSinceMs(null);
  }, []);

  const paidGigRef = useRef<string | null>(null);

  const [sessionEarnings, setSessionEarnings] = useState(0);
  const [payoutGain, setPayoutGain] = useState<string | null>(null);
  const [dispatchToast, setDispatchToast] = useState<DispatchToast | null>(
    null,
  );
  const announcePayout = useCallback(
    (fare: number, tip: number) => {
      setSessionEarnings((total) => total + fare + tip);
      setPayoutGain(`+${formatMoney(fare + tip, driveCountry)}`);
      setDispatchToast({
        text:
          tip > 0
            ? `+${formatMoney(fare, driveCountry)} · TIP +${formatMoney(tip, driveCountry)}`
            : `+${formatMoney(fare, driveCountry)}`,
        tone: "paid",
      });
    },
    [driveCountry],
  );

  return {
    gig,
    gigRef,
    setGig,
    queuedGig,
    queuedGigRef,
    setQueuedGig,
    promoteQueuedGig,
    carryingSinceMs,
    carryingSinceRef,
    carryViolationsRef,
    startCarrying,
    endCarryingLeg,
    paidGigRef,
    sessionEarnings,
    setSessionEarnings,
    payoutGain,
    setPayoutGain,
    dispatchToast,
    setDispatchToast,
    announcePayout,
  };
}
