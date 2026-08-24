/**
 * The `GameRuntimeEvent` switch, extracted from `SideSwapApp.tsx` (issue
 * #289). It handles `ready`, rider-violation coaching/collision tracking,
 * the `cutscene` sub-switch (`cite`/`repair`/`pump`/`done`), collisions, and
 * fines — everything the drive session reports that has to move money,
 * change the car's condition, or advance a gig.
 *
 * The 38-binding closure the pre-extraction version had (2 state values, 1
 * derived value, 8 setters, 20 refs, 7 sibling callbacks — see
 * `docs/architecture.md`) is now three port objects
 * (`app/drivePort.ts`/`app/careerPort.ts`/`app/gigDispatchPort.ts`) plus a
 * handful of values with no port to belong to: `progress`/`setProgress` is
 * the whole persisted save, used far outside driving, and `driveFuel`/
 * `setDriveFuel` has no ref mirror to formalize into a port method — both
 * stay exactly what they were, plain `SideSwapApp` state threaded in as
 * parameters, matching their position in the original dependency array.
 *
 * `chargeFine` and `beginTow` move in whole rather than becoming port
 * methods: both call into *two* ports at once (drive's cutscene/condition
 * state and career's day-cash, or the free-drive wallet directly) depending
 * on whether a career is running, and neither had a single caller besides
 * this switch — folding them in here, rather than forcing an artificial home
 * on one port, is what actually shrinks the closure instead of just moving
 * where it lives.
 *
 * `clock` makes the two kinds of real time in here injectable: the citation
 * dedupe timers read wall-clock `Date.now()`, and `beginTow`'s two staged
 * beats use `window.setTimeout`. The day clock itself
 * (`dayElapsedBaseRef`/`lastSimElapsedRef`) is *not* wired through the
 * clock — it was already deterministic before this extraction, fed by
 * `handleHud` (still plain `SideSwapApp` code, unchanged) from
 * `GameHudSnapshot.simElapsedMs` rather than read from the wall clock, so a
 * test drives it by dispatching HUD snapshots through the mock canvas —
 * `tests/careerFlow.test.tsx`'s existing harness — not by faking time.
 */
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DriveStatusPort } from "./drivePort";
import type { CareerPort } from "./careerPort";
import type { GigDispatchPort } from "./gigDispatchPort";
import { gigTipFor } from "./SideSwapApp";
import {
  FINE_BY_COUNTRY,
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  TANK_CAPACITY_L,
  fuelPurchase,
  postedSpeed,
  railwayCrossingFine,
  repairPrice,
  speedingFine,
} from "./game/economyTables";
import { SPEEDING_STOP_GRACE_MS, speedingExcessMps } from "./game/speeding";
import { debit, saveProgress, setFuel } from "./game/progress";
import {
  careerFare,
  ratingFareFactor,
  ratingTipFactor,
  ROADSIDE_CALLOUT_FEE_BY_COUNTRY,
  ROADSIDE_PRICE_FACTOR,
} from "./game/career";
import { damageForCollision, FULL_CONDITION_PCT } from "./game/damage";
import { gigParMs, gigRating, ridePromptness } from "./game/dispatch";
import type { GameRuntimeEvent } from "./game/sessionContract";
import type { CountryProfile, PlayerProgressV2 } from "./game/types";

/**
 * The shortest gap between two fines from *any* source.
 *
 * Short on purpose. It is here to stop one incident being charged twice — a
 * swerve that leaves the road and hits someone trips two rules in the same
 * breath, and two different mechanisms answer them — not to re-pace a driver
 * who reoffends a few seconds later, which each mechanism's own clock already
 * governs.
 */
const FINE_MIN_SPACING_MS = 3000;

/**
 * Breathing room after an officer releases the driver from a pull-over.
 *
 * The scene itself can outlast the ordinary witnessed-fine debounce. Anchoring
 * that same eight-second window to `done` prevents the rule that prompted the
 * stop from immediately staging another one while the driver is still pulling
 * away from the kerb.
 */
const PULLOVER_RELEASE_GRACE_MS = 8000;

/**
 * Human-readable reason for a fine toast, from the violation's rule code.
 *
 * Speeding is the only one that cites figures, because it is the only one
 * whose fine moves: a driver told they were charged "for speeding" cannot see
 * that the amount tracked the offence, and would read two different tickets as
 * a bug. "Doing 42 in a 30" makes the scaling legible without a second line of
 * UI. Both figures come out of the event's own evidence, so what the officer
 * says and what the wallet loses are computed from one measurement.
 */
function fineReason(
  code: string | undefined,
  evidence: Readonly<Record<string, string | number | boolean>> | undefined,
  country: CountryProfile,
): string {
  switch (code) {
    case "wrong_way":
      return "driving on the wrong side";
    case "out_of_bounds":
      return "leaving the road";
    case "red_light":
      return "running a red light";
    case "collision":
      return "careless driving";
    case "speeding": {
      const speed = evidence?.speedMps;
      const limit = evidence?.limitMps;
      if (typeof speed !== "number" || typeof limit !== "number") {
        return "speeding";
      }
      return `doing ${Math.round(postedSpeed(speed, country))} in a ${Math.round(
        postedSpeed(limit, country),
      )}`;
    }
    case "railway_crossing":
      return "running a closed level crossing";
    default:
      return "a road violation";
  }
}

/** The two real-clock primitives `useGameEventHandler` needs. */
export interface GameEventClock {
  now(): number;
  /** Returns a handle in whatever form the caller's own timer needs — unused today. */
  setTimeout(handler: () => void, delayMs: number): number;
}

const REAL_CLOCK: GameEventClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
};

export interface UseGameEventHandlerArgs {
  readonly drive: DriveStatusPort;
  readonly career: CareerPort;
  readonly gigDispatch: GigDispatchPort;
  readonly progress: PlayerProgressV2;
  readonly setProgress: Dispatch<SetStateAction<PlayerProgressV2>>;
  readonly driveCountry: CountryProfile;
  readonly driveFuel: number;
  readonly setDriveFuel: Dispatch<SetStateAction<number>>;
  /** Defaults to real `Date.now`/`window.setTimeout`; a test may override both. */
  readonly clock?: GameEventClock;
}

export function useGameEventHandler({
  drive,
  career,
  gigDispatch,
  progress,
  setProgress,
  driveCountry,
  driveFuel,
  setDriveFuel,
  clock = REAL_CLOCK,
}: UseGameEventHandlerArgs): (event: GameRuntimeEvent) => void {
  /**
   * The one place money is taken for a violation, whoever wrote it — the
   * officer at the window, the camera over the junction, or the app's own
   * citation for striking someone.
   *
   * Career fines are day-local like every other career charge and may push the
   * day negative; free drive debits the country wallet and persists. Those two
   * branches were copied at all three sites, which is exactly where they would
   * have drifted apart. Stamping the shared clock here means it marks money
   * actually moving rather than an intention to charge.
   */
  const chargeFine = useCallback(
    (amount: number, reason: string, issuedBy: "patrol" | "camera") => {
      drive.stampAnyFineAt(clock.now());
      if (career.careerRunRef.current) {
        career.chargeCareer(amount, (log) => ({
          ...log,
          finesTotal: log.finesTotal + amount,
        }));
      } else {
        const fined = debit(progress, driveCountry.id, amount);
        setProgress(fined);
        saveProgress(fined);
      }
      drive.setFineToast({ amount, reason, issuedBy });
    },
    [progress, driveCountry, career, drive, clock, setProgress],
  );

  // The car is a write-off: fade to the tow overlay, debit the repair bill,
  // snap the car back to its spawn repaired, and fade back in. No button, no
  // modal — the drive itself never stops being playable for long.
  const beginTow = useCallback(() => {
    if (drive.towingRef.current) return;
    // A scene in flight is torn down by the session's reset; drop the app
    // side too so nothing waits on a `done` that will never come.
    drive.clearCutscene();
    // A write-off is billed for all 100 points at the roadside premium, so it
    // always costs strictly more than driving into a shop would have. Stashed
    // in state rather than re-derived by the overlay below: the two used to
    // read the same flat constant independently, which was harmless only for
    // as long as the price was constant.
    const fee = repairPrice(driveCountry, FULL_CONDITION_PCT, "tow");
    drive.startTow(fee);
    if (career.careerRunRef.current) {
      // Day-local money: the repair bill can push the day negative.
      career.chargeCareer(fee, (log) => ({
        ...log,
        repairsTotal: log.repairsTotal + fee,
      }));
    } else {
      const paid = debit(progress, driveCountry.id, fee);
      setProgress(paid);
      saveProgress(paid);
    }
    const reduced = progress.accessibility.reducedMotion;
    clock.setTimeout(() => {
      drive.pulseTowReset();
    }, reduced ? 80 : 900);
    clock.setTimeout(() => {
      drive.endTow();
      // The whistle blew during the tow: settle now that the overlay is gone.
      if (career.pendingSettleRef.current && career.careerRunRef.current) {
        career.clearPendingSettle();
        career.endCareerDayRef.current();
      }
    }, reduced ? 500 : 2400);
  }, [progress, driveCountry, drive, career, clock, setProgress]);

  // Collision events wear the car down (and striking a person is cited on the
  // spot); a fine event reaches us only when a patrol witnessed the violation.
  // Both debit the local wallet and flash the toast, mirroring the refuel path.
  const handleGameEvent = useCallback(
    (event: GameRuntimeEvent) => {
      if (event.type === "ready") {
        // The scene is built and GameCanvas's overlay has cleared, so the title
        // now has somewhere to land. Anchored to the day clock rather than to
        // wall time so it fades on the same clock it is measured against.
        career.setDayIntroFromMs(
          career.dayElapsedBaseRef.current + career.lastSimElapsedRef.current,
        );
        return;
      }
      // A rider in the back sees everything, witnessed or not, so the tip reads
      // the rule stream rather than the fine stream. Every violation surfaces
      // exactly once as coaching/collision; the `fine` that may follow
      // is the same offence again, which is why it is excluded here.
      if (
        (event.type === "coaching" || event.type === "collision") &&
        gigDispatch.gigRef.current?.state === "carrying"
      ) {
        gigDispatch.recordViolation();
      }
      if (event.type === "cutscene") {
        const active = drive.cutsceneRef.current;
        if (!active || event.nonce !== active.nonce) return;
        if (event.phase === "cite") {
          // The officer is at the window. The amount was settled when the stop
          // was staged — a speeding ticket is priced off the excess, everything
          // else is the flat fine.
          chargeFine(
            drive.pendingFineAmountRef.current ?? FINE_BY_COUNTRY[driveCountry.id],
            drive.pendingFineReasonRef.current ??
              fineReason(undefined, undefined, driveCountry),
            "patrol",
          );
          return;
        }
        if (event.phase === "repair") {
          // The bonnet is up: pay and mend atomically, the same contract the
          // pump step keeps. An aborted scene after this point was still a
          // completed repair; before it, nothing happened.
          //
          // Damage comes off the ref, not the `carCondition` state: the ref is
          // what the collision handler decrements, and the state can be a
          // render behind a shunt taken on the way in.
          const damage = Math.max(
            0,
            FULL_CONDITION_PCT - drive.carConditionRef.current,
          );
          const price = repairPrice(driveCountry, damage, "shop");
          if (career.careerRunRef.current) {
            career.chargeCareer(price, (log) => ({
              ...log,
              repairsTotal: log.repairsTotal + price,
            }));
          } else {
            const paid = debit(progress, driveCountry.id, price);
            setProgress(paid);
            saveProgress(paid);
          }
          // No session reset, unlike the tow — the car is mended where it
          // stands, in the bay it drove into.
          drive.setCarCondition(FULL_CONDITION_PCT);
          return;
        }
        if (event.phase === "pump") {
          // The nozzle is in: pay and fill atomically, and stretch the fuel
          // bar's transition across the fill window so the gauge pours while
          // the driver pumps. An aborted scene after this point was still a
          // completed purchase; before it, nothing happened.
          const run = career.careerRunRef.current;
          if (run) {
            // Career fuel is integer, priced per vehicle, and never gated on
            // being able to afford it — the charge may push the day negative.
            // A roadside rescue fills the whole tank at a premium plus the
            // call-out fee: the price of not planning around the gauge.
            const roadside = active.kind === "roadside_refuel";
            const missing = Math.max(0, run.vehicle.tankL - driveFuel);
            // How much was bought is the fraction the scene was staged with —
            // which is the whole missing tank for a full fill or a rescue, and
            // less than that for a cash-only top-up. Carrying it on the request
            // is what saves a second channel telling the two offers apart, and
            // it survives the scene being restaged.
            const litres = roadside
              ? missing
              : Math.min(missing, (active.fuelFillFraction ?? 1) * run.vehicle.tankL);
            const cost =
              Math.round(
                litres *
                  FUEL_PRICE_PER_LITRE_BY_COUNTRY[run.city.countryId] *
                  run.vehicle.fuelPriceFactor *
                  (roadside ? ROADSIDE_PRICE_FACTOR : 1),
              ) +
              (roadside ? ROADSIDE_CALLOUT_FEE_BY_COUNTRY[run.city.countryId] : 0);
            career.chargeCareer(cost, (log) => ({
              ...log,
              fuelSpendTotal: log.fuelSpendTotal + cost,
            }));
            drive.setFuelFillMs(event.durationMs ?? 0);
            setDriveFuel(Math.min(run.vehicle.tankL, driveFuel + litres));
            return;
          }
          // Free drive pours only what the wallet covers, so an empty-enough
          // wallet buys a part tank instead of nothing at all. Re-priced here
          // against the wallet as it stands rather than trusting the figure the
          // prompt quoted: a citation can still land mid-scene (a pedestrian
          // walking into a parked car is not gated on the cutscene), and this
          // way that re-prices the fill instead of overdrawing the wallet.
          const purchased = fuelPurchase(
            driveCountry.id,
            Math.max(0, TANK_CAPACITY_L - driveFuel),
            progress.walletByCountry[driveCountry.id],
          );
          const filled = driveFuel + purchased.litres;
          const refueled = setFuel(
            debit(progress, driveCountry.id, purchased.cost),
            driveCountry.id,
            filled,
          );
          setProgress(refueled);
          saveProgress(refueled);
          drive.setFuelFillMs(event.durationMs ?? 0);
          setDriveFuel(filled);
          return;
        }
        if (event.phase === "done") {
          if (active.kind === "pullover") {
            // A pull-over can run longer than the debounce stamped when it was
            // staged. Re-arm from the officer's release instead, so a rule
            // still true at the kerb cannot throw the driver straight back
            // into the same scene.
            drive.stampFineAt(clock.now());
          }
          drive.clearCutscene();
          if (active.kind === "board" || active.kind === "food_pickup") {
            gigDispatch.setGig((current) =>
              current && current.state === "enroute_pickup"
                ? { ...current, state: "carrying" }
                : current,
            );
            // The carrying leg starts here in both modes: free drive tips too
            // now, and both the par clock and the rider's patience run from
            // the moment the job is actually in the car.
            const elapsed =
              career.dayElapsedBaseRef.current + career.lastSimElapsedRef.current;
            gigDispatch.startCarrying(elapsed);
          } else if (active.kind === "exit" || active.kind === "food_dropoff") {
            const run = career.careerRunRef.current;
            const current = gigDispatch.gigRef.current;
            if (
              run &&
              current &&
              current.state === "carrying" &&
              gigDispatch.paidGigRef.current !== current.id
            ) {
              // Career pays synchronously in the scene's done event (not via
              // the free-drive payout effect) so a drop-off finishing right at
              // the whistle is credited before the settlement below runs.
              gigDispatch.markGigPaid(current.id);
              const { gross, net } = careerFare(
                current.reward,
                current.kind,
                run.vehicle,
                ratingFareFactor(run.ratingStanding),
              );
              // Tips are commission-free either way, but the two kinds settle
              // differently: a food order tipped when it was placed, and may
              // add something if it arrived hot; a rider decides on the way and
              // pays for how the trip went. Late still pays the fare — no hard
              // fail.
              const parMs = gigParMs(
                Math.hypot(
                  current.dropoff.x - current.pickup.x,
                  current.dropoff.z - current.pickup.z,
                ),
                run.vehicle.paceFactor,
              );
              const elapsedNow =
                career.dayElapsedBaseRef.current + career.lastSimElapsedRef.current;
              const since = gigDispatch.carryingSinceRef.current;
              const carriedMs = since === null ? parMs : elapsedNow - since;
              const onTime = since !== null && carriedMs <= parMs;
              const tip = gigTipFor(
                current,
                gross,
                carriedMs,
                parMs,
                onTime,
                gigDispatch.carryViolationsRef.current,
                ratingTipFactor(run.ratingStanding),
              );
              // The same trip, judged a second way. Deliberately silent: the
              // stars never reach the HUD, the toast or the payout call-out —
              // a driver reads their standing on the career page after the day
              // is over, or not at all.
              const stars = gigRating(current.kind, current.seed, {
                promptness: ridePromptness(carriedMs, parMs),
                violations: gigDispatch.carryViolationsRef.current,
              });
              gigDispatch.endCarryingLeg();
              career.recordGigPayout({ gross, net, tip, onTime, stars });
              gigDispatch.announcePayout(net, tip);
              // The next job is whatever was accepted while this one ran —
              // nothing is conjured on completion any more. With an empty queue
              // the driver goes idle until dispatch offers again.
              gigDispatch.promoteQueuedGig();
            } else if (!run) {
              gigDispatch.setGig((existing) =>
                existing && existing.state === "carrying"
                  ? { ...existing, state: "delivered" }
                  : existing,
              );
            }
          }
          // The day ended while this scene played out: settle now that its
          // durable effects (including the payout above) have landed.
          if (
            career.pendingSettleRef.current &&
            career.careerRunRef.current &&
            !drive.towingRef.current
          ) {
            career.clearPendingSettle();
            career.endCareerDayRef.current();
          }
        }
        return;
      }
      if (event.type === "collision") {
        const evidence = event.evidence ?? {};
        const damage = damageForCollision(evidence);
        if (damage > 0 && !drive.towingRef.current) {
          const next = Math.max(0, drive.carConditionRef.current - damage);
          drive.setCarCondition(next);
          if (next <= 0) beginTow();
        }
        const roadUser = evidence.roadUserType;
        if (roadUser === "pedestrian" || roadUser === "cyclist") {
          const now = clock.now();
          if (now - drive.lastPedFineAtRef.current < 4000) return;
          if (now - drive.lastAnyFineAtRef.current < FINE_MIN_SPACING_MS) return;
          drive.stampPedFineAt(now);
          chargeFine(
            FINE_BY_COUNTRY[driveCountry.id],
            roadUser === "cyclist"
              ? "striking a cyclist"
              : "striking a pedestrian",
            "patrol",
          );
        }
        return;
      }
      if (event.type !== "fine") return;
      const now = clock.now();
      if (now - drive.lastAnyFineAtRef.current < FINE_MIN_SPACING_MS) return;
      if (now - drive.lastFineAtRef.current < PULLOVER_RELEASE_GRACE_MS) return;
      const speeding = event.ruleCode === "speeding";
      if (
        speeding &&
        now - drive.lastSpeedingFineAtRef.current < SPEEDING_STOP_GRACE_MS
      ) {
        return;
      }
      // A scene already running (or a tow) means the violation goes uncited
      // rather than queueing behind it — every clock below is stamped only once
      // the citation is really under way, so the next one is not swallowed too.
      if (drive.cutsceneRef.current || drive.towingRef.current) return;
      drive.stampFineAt(now);
      if (speeding) drive.stampSpeedingFineAt(now);
      // Price it here, not at `cite`: this is where the measurement is. A
      // speeding ticket scales with the excess, a closed level crossing pays
      // the game's heftiest flat rate; every other violation is binary and
      // pays the ordinary flat fine.
      const excessMps = speeding ? speedingExcessMps(event.evidence) : null;
      const amount =
        event.ruleCode === "railway_crossing"
          ? railwayCrossingFine(driveCountry)
          : excessMps === null
            ? null
            : speedingFine(driveCountry, postedSpeed(excessMps, driveCountry));
      const reason = fineReason(event.ruleCode, event.evidence, driveCountry);
      if (event.issuedBy === "camera") {
        // Nobody to pull you over, so there is no scene and no `cite` step to
        // carry the amount to: the camera posts the ticket where the driver
        // stands, the way striking someone is charged. The pull-over is the
        // better moment when there is an officer to stage it, which is why
        // GameCanvas only reaches for a camera when there is not.
        chargeFine(amount ?? FINE_BY_COUNTRY[driveCountry.id], reason, "camera");
        return;
      }
      // The stop *is* the citation: stage the pull-over and let its `cite`
      // step debit, the same way the pump scene pays for its fuel.
      drive.stampAnyFineAt(now);
      drive.stagePendingFine(amount, reason);
      drive.beginCutscene("pullover");
    },
    [
      progress,
      driveCountry,
      driveFuel,
      setDriveFuel,
      setProgress,
      drive,
      career,
      gigDispatch,
      clock,
      chargeFine,
      beginTow,
    ],
  );

  return handleGameEvent;
}
