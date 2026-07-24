"use client";

import { useState } from "react";

// Career Mode's interstitial screens: the garage (morning vehicle choice), the
// end-of-day ledger, and the career-over report. Props-pure — everything they
// show arrives as data, so tests render them directly without the app shell.

import type { CountryProfile, DestinationId } from "./game/types";
import { formatMoney } from "./game/content";
import {
  activeCity,
  BUYOUT_RENT_MULTIPLIER,
  buyableVehicles,
  buyoutPrice,
  canBuyVehicle,
  CAREER_CITIES,
  CAREER_STARTING_CASH_BY_COUNTRY,
  CAREER_VEHICLES,
  getCareerVehicle,
  nextCareerCity,
  nextInstallment,
  PLATFORM_FEE_BY_COUNTRY,
  ticketPrice,
  ownsVehicle,
  vehicleRent,
  type CareerCityView,
  type CareerSliceV2,
  type CareerVehicleId,
  type CareerVehicleSpec,
  type LedgerLine,
  type SettlementResult,
} from "./game/career";

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const LEDGER_LABELS: Record<LedgerLine["kind"], string> = {
  earnings: "Fares (gross)",
  commission_info: "Platform commission",
  tips: "Tips",
  fines: "Fines",
  repairs: "Repairs & towing",
  fuel: "Fuel",
  rent_info: "Vehicle rent (prepaid)",
  platform_fee: "Platform fee",
  loan_installment: "Loan installment",
  loan_cleared: "Loan cleared",
  shortfall: "Shortfall",
  loan_origination: "New loan (incl. 15% fee)",
  final_notice: "FINAL NOTICE issued",
  bankruptcy: "Bankrupt",
  closing_balance: "Closing balance",
};

/** Kinds whose row is a banner rather than a money line. */
const BANNER_KINDS = new Set<LedgerLine["kind"]>([
  "loan_cleared",
  "final_notice",
  "bankruptcy",
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const cardStyle: React.CSSProperties = {
  borderRadius: "1rem",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(15, 18, 22, 0.55)",
  padding: "1.1rem 1.25rem",
  color: "inherit",
};

export function GarageView({
  slice,
  city,
  country,
  selectedVehicleId,
  lockedVehicles,
  onSelect,
  onStartDay,
  onBuy,
  onTravel,
  onAbandon,
  cityName,
}: {
  slice: CareerSliceV2;
  /** The city being played: all money, rent and debt come from here. */
  city: CareerCityView;
  country: CountryProfile;
  selectedVehicleId: CareerVehicleId;
  /** Vehicles present but not yet playable, with the reason shown on the card. */
  lockedVehicles: Readonly<Partial<Record<CareerVehicleId, string>>>;
  onSelect: (id: CareerVehicleId) => void;
  onStartDay: (id: CareerVehicleId) => void;
  onBuy: (id: CareerVehicleId) => void;
  onTravel: () => void;
  onAbandon: () => void;
  /** Where the driver is, shown on the travel button. */
  cityName: string;
}) {
  const selected = CAREER_VEHICLES.find(
    (vehicle) => vehicle.id === selectedVehicleId,
  );
  const selectedRent = selected ? vehicleRent(selected, city) : 0;
  const selectedLocked = Boolean(lockedVehicles[selectedVehicleId]);
  const selectedStartable = !selectedLocked && city.cash >= selectedRent;
  const fee = PLATFORM_FEE_BY_COUNTRY[country.id];
  const installment = city.loan ? nextInstallment(city.loan) : 0;
  const dueToday = selectedRent + fee + installment;
  return (
    <section className="garage-page" aria-label="Career garage">
      <div className="garage-head">
        <div className="garage-head-copy">
          <p className="garage-eyebrow">
            <span className="garage-eyebrow-dot" aria-hidden="true" />
            CAREER · DAY {city.day}
          </p>
          <h1>Pick today&apos;s ride.</h1>
          <p className="garage-sub">
            Rent is paid up front — every idle minute burns money you&apos;ve
            already spent. Choose what you can keep busy.
          </p>
        </div>
        <div className="garage-cash">
          <span className="garage-cash-label">CASH ON HAND</span>
          <span className="garage-cash-value" data-testid="garage-cash">
            {formatMoney(city.cash, country)}
          </span>
        </div>
      </div>

      <div className="garage-fleet" role="group" aria-label="Vehicles">
        {CAREER_VEHICLES.map((vehicle) => {
          const rent = vehicleRent(vehicle, city);
          const lockedReason = lockedVehicles[vehicle.id];
          const affordable = city.cash >= rent;
          // Only a locked vehicle is unselectable. Not being able to afford
          // *today's rent* must not hide the card, because the buy price is
          // reached long before that stops mattering — an unselectable card was
          // exactly what made vehicles look un-purchasable.
          const disabled = Boolean(lockedReason);
          const active = selectedVehicleId === vehicle.id;
          const rideshare = vehicle.allowedGigKinds.includes("passenger");
          const owned = ownsVehicle(city, vehicle);
          const price = buyoutPrice(vehicle, city.countryId);
          const buyable = canBuyVehicle(slice, vehicle);
          return (
            <div className="garage-slot" key={vehicle.id}>
            <button
              type="button"
              data-testid={`garage-vehicle-${vehicle.id}`}
              className={`garage-card${active ? " active" : ""}${disabled ? " locked" : ""}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(vehicle.id)}
            >
              {/* Placeholder art until the real vehicle renders land. */}
              <span className="garage-card-art" aria-hidden="true">
                <VehicleGlyph kind={vehicle.visualKind} />
                <span className="garage-card-art-note">Artwork soon</span>
                {disabled && (
                  <span className="garage-card-lock">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    LOCKED
                  </span>
                )}
              </span>
              <span className="garage-card-body">
                <span className="garage-card-info">
                  <span className="garage-card-name">{vehicle.name}</span>
                  {owned ? (
                    <span className="garage-card-rent owned">
                      {vehicle.owned ? "Yours · no rent" : "Owned — no rent"}
                    </span>
                  ) : (
                    <span className="garage-card-rent">
                      {formatMoney(rent, country)}
                      <em> / day</em>
                    </span>
                  )}
                  <span className="garage-card-meta">
                    <span className="garage-card-tags">
                      {rideshare ? (
                        <>
                          <span className="garage-tag">Deliveries</span>
                          <span className="garage-tag rideshare">Rideshare</span>
                        </>
                      ) : (
                        <span className="garage-tag">Deliveries only</span>
                      )}
                    </span>
                    {vehicle.tankL > 0 ? (
                      <span className="garage-card-fuel">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18" />
                          <path d="M2 22h13" />
                          <path d="M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3" />
                          <path d="M6 8h4" />
                        </svg>
                        {vehicle.tankL} L tank
                      </span>
                    ) : (
                      <span className="garage-card-fuel green">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                          <path d="M2 21c0-3 1.85-5.36 5.08-6" />
                        </svg>
                        No fuel needed
                      </span>
                    )}
                  </span>
                </span>
                <span className="garage-card-foot">
                  <span className="garage-card-foot-label">
                    {active ? (
                      <span className="garage-card-today">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        TODAY&apos;S RIDE
                      </span>
                    ) : disabled ? (
                      <span className="garage-card-cant">{lockedReason}</span>
                    ) : affordable ? (
                      <span className="garage-card-choose">Choose this ride</span>
                    ) : (
                      <span className="garage-card-cant">
                        Rent&apos;s out of reach today
                      </span>
                    )}
                  </span>
                  {!disabled && (
                    <span
                      className={`garage-card-dot${active ? " on" : ""}`}
                      aria-hidden="true"
                    >
                      {active ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                      )}
                    </span>
                  )}
                </span>
              </span>
            </button>
            {/* Buying is per card, not per selection: every eligible vehicle
                shows its own price, and the only gate is cash on hand. */}
            {vehicle.buyoutEligible &&
              (owned ? (
                <span className="garage-card-buy owned">✓ Yours</span>
              ) : (
                <button
                  type="button"
                  className="garage-card-buy"
                  data-testid={`garage-buy-${vehicle.id}`}
                  disabled={!buyable}
                  onClick={() => onBuy(vehicle.id)}
                >
                  Buy · {formatMoney(price, country)}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="garage-footer">
        <GarageFreedom slice={slice} city={city} country={country} />
        <div className="garage-panel garage-obligations" data-testid="garage-forecast">
          <div className="garage-panel-label coral">TONIGHT&apos;S OBLIGATIONS</div>
          <div className="garage-ob-row">
            <span>Rent · {selected?.name ?? "—"}</span>
            <strong>
              {selectedRent === 0 ? "Free" : formatMoney(selectedRent, country)}
            </strong>
          </div>
          <div className="garage-ob-row">
            <span>Platform fee</span>
            <strong>{formatMoney(fee, country)}</strong>
          </div>
          {city.loan && (
            <div className="garage-ob-row" data-testid="forecast-installment">
              <span>Loan installment</span>
              <strong>{formatMoney(installment, country)}</strong>
            </div>
          )}
          <div className="garage-ob-rule" />
          <div className="garage-ob-total">
            <span>Due today</span>
            <strong>{formatMoney(dueToday, country)}</strong>
          </div>
          <div className="garage-ob-note">
            Anything unpaid rolls into a loan (+15%).
          </div>
        </div>
        <div className="garage-actions">
          <button
            type="button"
            className="garage-start"
            data-testid="garage-start-day"
            disabled={!selectedStartable}
            onClick={() => onStartDay(selectedVehicleId)}
          >
            Start Day {city.day}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
          <button
            type="button"
            className="garage-travel"
            data-testid="garage-travel"
            onClick={onTravel}
          >
            ✈ Travel · {cityName}
          </button>
          <button type="button" className="garage-abandon" onClick={onAbandon}>
            Abandon career
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The garage footer's left panel. One adaptive slot that shows the buyout
 * progress (the finish line), or — when that is hidden — the win, the final
 * notice, or the outstanding debt, so the footer keeps a stable three-panel
 * shape in every state.
 */
function GarageFreedom({
  slice,
  city,
  country,
}: {
  slice: CareerSliceV2;
  city: CareerCityView;
  country: CountryProfile;
}) {
  if (slice.state === "won") {
    return (
      <div className="garage-panel garage-freedom won" data-testid="victory-banner">
        <div className="garage-panel-label green">🏁 THE WHOLE MAP</div>
        <div className="garage-freedom-copy">
          Every city, every vehicle, bought outright on day {slice.victoryDay}.
          There is nothing left to owe anyone — keep driving for the records.
        </div>
      </div>
    );
  }
  if (city.finalNotice) {
    return (
      <div className="garage-panel garage-freedom notice" role="alert">
        <div className="garage-panel-label coral">⚠ FINAL NOTICE</div>
        <div className="garage-freedom-copy">
          End another day short while owing and this city wipes — cash, debts
          and the fleet you bought here. Clear the books tonight.
        </div>
      </div>
    );
  }
  if (city.loan) {
    return (
      <div className="garage-panel garage-freedom debt">
        <div className="garage-panel-label coral">OUTSTANDING DEBT</div>
        <div className="garage-freedom-copy">
          You owe {formatMoney(city.loan.principalRemaining, country)} over{" "}
          {city.loan.daysRemaining}{" "}
          {city.loan.daysRemaining === 1 ? "day" : "days"} — tonight&apos;s
          installment is {formatMoney(nextInstallment(city.loan), country)}.
        </div>
      </div>
    );
  }
  return <CareerGoal slice={slice} city={city} country={country} />;
}

/**
 * What you are saving for here: the onward ticket while one is unbought, and
 * the city's remaining fleet once the flight is behind you (or there is no
 * flight left to take). Kept visible from day 1 — an all-loss ledger with no
 * stated escape route is what burns players out.
 */
export function CareerGoal({
  slice,
  city,
  country,
}: {
  slice: CareerSliceV2;
  city: CareerCityView;
  country: CountryProfile;
}) {
  const onward = nextCareerCity(city.destinationId);
  const price = ticketPrice(city.destinationId);
  const ticketOutstanding =
    onward !== null && price !== null && slice.cities[onward] === undefined;

  if (ticketOutstanding) {
    const remaining = Math.max(0, price - city.cash);
    return (
      <div className="garage-panel garage-freedom" data-testid="career-goal">
        <div className="garage-panel-head">
          <span className="garage-panel-label">THE WAY OUT</span>
          <span className="garage-panel-note">one-way ticket</span>
        </div>
        <p className="garage-freedom-copy">
          Buy the flight and start again somewhere new — or stay and keep
          building here. Entirely your call.
        </p>
        <div className="garage-bar">
          <i style={{ width: `${clamp01(city.cash / price) * 100}%` }} />
        </div>
        <div className="garage-freedom-foot">
          <span>
            {formatMoney(city.cash, country)}
            <em> / {formatMoney(price, country)}</em>
          </span>
          <span>
            {remaining > 0
              ? `${formatMoney(remaining, country)} to go`
              : "Ready to fly"}
          </span>
        </div>
      </div>
    );
  }

  const buyable = buyableVehicles();
  const owned = buyable.filter((vehicle) =>
    city.ownedVehicleIds.includes(vehicle.id),
  ).length;
  const nextBuy = buyable.find(
    (vehicle) => !city.ownedVehicleIds.includes(vehicle.id),
  );
  const target = nextBuy ? buyoutPrice(nextBuy, city.countryId) : 0;
  return (
    <div className="garage-panel garage-freedom" data-testid="career-goal">
      <div className="garage-panel-head">
        <span className="garage-panel-label">OWN THE FLEET</span>
        <span className="garage-panel-note">
          {owned}/{buyable.length} here
        </span>
      </div>
      <p className="garage-freedom-copy">
        {nextBuy
          ? `Own every vehicle in every city to beat the game. Next up here: the ${nextBuy.name.toLowerCase()}.`
          : "This city's fleet is complete. Finish the others to beat the game."}
      </p>
      <div className="garage-bar">
        <i
          style={{
            width: `${
              (nextBuy ? clamp01(city.cash / target) : 1) * 100
            }%`,
          }}
        />
      </div>
      <div className="garage-freedom-foot">
        <span>
          {formatMoney(city.cash, country)}
          {nextBuy && <em> / {formatMoney(target, country)}</em>}
        </span>
        <span>{nextBuy ? nextBuy.name : "Complete"}</span>
      </div>
    </div>
  );
}

export function LedgerView({
  result,
  slice,
  city,
  country,
  reducedMotion,
  onContinue,
}: {
  result: SettlementResult;
  /** The slice AFTER settlement (already advanced to the next day). */
  slice: CareerSliceV2;
  /** That slice's active city, likewise post-settlement. */
  city: CareerCityView;
  country: CountryProfile;
  reducedMotion: boolean;
  onContinue: () => void;
}) {
  // Papers-Please pacing: lines land one by one. Clicking the ledger (or
  // preferring reduced motion) shows everything at once.
  const [revealAll, setRevealAll] = useState(reducedMotion);
  const staged = !revealAll;
  return (
    <section className="subpage" aria-label="End of day ledger">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">CAREER · DAY {city.day - 1} COMPLETE</p>
          <h1>The day&apos;s reckoning.</h1>
        </div>
      </div>
      {staged && (
        <style>{"@keyframes ledger-line-in { from { opacity: 0; transform: translateY(0.35rem); } to { opacity: 1; transform: none; } }"}</style>
      )}
      <div
        style={{ ...cardStyle, maxWidth: "30rem", cursor: staged ? "pointer" : "auto" }}
        onClick={() => setRevealAll(true)}
      >
        <ol
          data-testid="ledger-lines"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          {result.lines.map((line, index) => (
            <li
              key={`${line.kind}-${index}`}
              data-testid={`ledger-${line.kind}`}
              style={{
                animation: staged
                  ? `ledger-line-in 0.3s ease-out both ${index * 0.28}s`
                  : "none",
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                fontWeight:
                  line.kind === "closing_balance" || BANNER_KINDS.has(line.kind)
                    ? 700
                    : 500,
                color:
                  line.kind === "bankruptcy" || line.kind === "final_notice"
                    ? "#e0533f"
                    : line.kind === "loan_cleared"
                      ? "#5bbf6a"
                      : "inherit",
                borderTop:
                  line.kind === "closing_balance"
                    ? "1px solid rgba(255,255,255,0.2)"
                    : "none",
                paddingTop: line.kind === "closing_balance" ? "0.45rem" : 0,
              }}
            >
              <span>{LEDGER_LABELS[line.kind]}</span>
              {!BANNER_KINDS.has(line.kind) && (
                <strong>{formatMoney(line.amount, country)}</strong>
              )}
            </li>
          ))}
        </ol>
      </div>
      {result.outcome === "final_notice" && (
        <div
          role="alert"
          style={{
            ...cardStyle,
            borderColor: "#e0533f",
            background: "rgba(150, 24, 28, 0.28)",
            marginTop: "1rem",
            maxWidth: "30rem",
            fontWeight: 700,
          }}
        >
          ⚠ FINAL NOTICE — your debts were consolidated one last time. Another
          shortfall ends the career.
        </div>
      )}
      {city.loan && result.outcome !== "final_notice" && (
        <p style={{ marginTop: "0.9rem", opacity: 0.85 }}>
          Outstanding debt {formatMoney(city.loan.principalRemaining, country)}{" "}
          — next installment{" "}
          {formatMoney(nextInstallment(city.loan), country)}.
        </p>
      )}
      <div style={{ maxWidth: "30rem" }}>
        <CareerGoal slice={slice} city={city} country={country} />
      </div>
      <div className="settings-actions" style={{ marginTop: "1.1rem" }}>
        <button
          type="button"
          className="primary-button"
          data-testid="ledger-continue"
          onClick={onContinue}
        >
          Continue to Day {city.day} →
        </button>
      </div>
    </section>
  );
}

export function CareerOverView({
  city,
  cityName,
  country,
  onContinue,
}: {
  /** The city as it stood the morning of the day that broke it. */
  city: CareerCityView;
  cityName: string;
  country: CountryProfile;
  onContinue: () => void;
}) {
  const stats = city.stats;
  const rows: readonly (readonly [string, string])[] = [
    ["Days worked here", String(stats.daysCompleted)],
    ["Gigs completed", String(stats.gigsCompleted)],
    ["On-time deliveries", String(stats.gigsOnTime)],
    ["Gross earned", formatMoney(stats.grossEarned, country)],
    ["Tips earned", formatMoney(stats.tipsEarned, country)],
    ["Fines paid", formatMoney(stats.finesPaid, country)],
    ["Loans taken", String(stats.loansTaken)],
    ["Largest debt", formatMoney(stats.largestDebt, country)],
  ];
  return (
    <section className="subpage" aria-label="Career over">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">WIPED OUT</p>
          <h1>{cityName} took everything.</h1>
          <p>
            The bank called it on day {city.day}. Your {cityName} fleet is
            repossessed and you start over here on{" "}
            {formatMoney(CAREER_STARTING_CASH_BY_COUNTRY[city.countryId], country)}
            {" "}— but only here. Every other city is exactly as you left it.
          </p>
        </div>
      </div>
      <div style={{ ...cardStyle, maxWidth: "26rem" }} data-testid="career-stats">
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "0.25rem 0",
            }}
          >
            <span style={{ opacity: 0.7 }}>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="settings-actions" style={{ marginTop: "1.1rem" }}>
        <button
          type="button"
          className="primary-button"
          data-testid="career-continue-after-wipe"
          onClick={onContinue}
        >
          Start again in {cityName}
        </button>
      </div>
    </section>
  );
}

/** The launcher career card's display fields. Kept flat so the card only lays out. */
export interface CareerCardModel {
  readonly day: number;
  readonly cash: string;
  readonly note: { readonly text: string; readonly tone: "good" | "warn" } | null;
  readonly driving: {
    readonly name: string;
    readonly badge: "RENTED" | "OWNED";
    readonly kind: CareerVehicleSpec["visualKind"];
  };
  readonly bar: {
    readonly label: string;
    readonly target: string;
    readonly fraction: number;
    readonly saved: string;
  };
  readonly footnote: string;
}

/**
 * Derives the launcher career card from the live slice, or — before any career
 * exists — from the chosen country's day-1 defaults, so the card doubles as a
 * "here's what you'll start with" preview. Pure (money formatted here) so the
 * copy is unit-testable without rendering. The progress bar tracks the next
 * rental you can't yet afford; once every rental is within reach it flips to
 * the buyout, which is the actual win.
 */
export function careerCardModel(
  slice: CareerSliceV2 | null,
  city: CareerCityView | null,
  country: CountryProfile,
  garageVehicleId: CareerVehicleId,
): CareerCardModel {
  const startingCash = CAREER_STARTING_CASH_BY_COUNTRY[country.id];
  const day = city?.day ?? 1;
  const cash = city?.cash ?? startingCash;
  const ownedIds = city?.ownedVehicleIds ?? [];
  const won = slice?.state === "won";
  const loan = city?.loan ?? null;

  const drivingSpec = getCareerVehicle(ownedIds[0] ?? garageVehicleId);
  const ownsDriving = drivingSpec.owned || ownedIds.includes(drivingSpec.id);
  const driving = {
    name: drivingSpec.name,
    badge: (ownsDriving ? "OWNED" : "RENTED") as "OWNED" | "RENTED",
    kind: drivingSpec.visualKind,
  };

  let note: CareerCardModel["note"] = null;
  if (won) {
    note = { text: "freedom bought", tone: "good" };
  } else if (loan) {
    note = {
      text: `owes ${formatMoney(loan.principalRemaining, country)}`,
      tone: "warn",
    };
  } else if (day === 1) {
    note = { text: `+${formatMoney(startingCash, country)} starter`, tone: "good" };
  }

  const rentOf = (vehicle: CareerVehicleSpec): number =>
    vehicle.owned || ownedIds.includes(vehicle.id)
      ? 0
      : vehicle.rentByCountry[country.id];
  const cheapestBuyout = CAREER_VEHICLES.filter((v) => v.buyoutEligible).reduce(
    (best, v) =>
      buyoutPrice(v, country.id) < buyoutPrice(best, country.id) ? v : best,
  );
  const buyoutCost = buyoutPrice(cheapestBuyout, country.id);
  const nextRental = CAREER_VEHICLES.filter(
    (v) => v.id !== "bicycle" && !v.owned && !ownedIds.includes(v.id) && rentOf(v) > cash,
  ).sort((a, b) => rentOf(a) - rentOf(b))[0];

  let bar: CareerCardModel["bar"];
  let footnote: string;
  if (won) {
    bar = {
      label: "OWNED OUTRIGHT",
      target: "",
      fraction: 1,
      saved: `The ${drivingSpec.name.toLowerCase()} is yours`,
    };
    footnote = slice?.victoryDay
      ? `Treadmill beaten on day ${slice.victoryDay} — keep driving.`
      : "The treadmill is beaten — keep driving.";
  } else if (nextRental) {
    const rent = rentOf(nextRental);
    bar = {
      label: `NEXT · RENT THE ${nextRental.name.toUpperCase()}`,
      target: formatMoney(rent, country),
      fraction: clamp01(cash / rent),
      saved: `${formatMoney(cash, country)} / ${formatMoney(rent, country)} saved`,
    };
    footnote = `Own one outright at ${formatMoney(buyoutCost, country)} · buy your way out`;
  } else {
    bar = {
      label: `NEXT · BUY THE ${cheapestBuyout.name.toUpperCase()}`,
      target: formatMoney(buyoutCost, country),
      fraction: clamp01(cash / buyoutCost),
      saved: `${formatMoney(cash, country)} / ${formatMoney(buyoutCost, country)} saved`,
    };
    footnote = `Own it outright (${BUYOUT_RENT_MULTIPLIER}× rent) and beat the treadmill`;
  }

  return { day, cash: formatMoney(cash, country), note, driving, bar, footnote };
}

/** Line-art vehicle mark for the card's "now driving" row, chosen by visual kind. */
function VehicleGlyph({ kind }: { kind: CareerVehicleSpec["visualKind"] }) {
  const props = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.1,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "bicycle") {
    return (
      <svg {...props}>
        <circle cx="5.5" cy="17.5" r="3.3" />
        <circle cx="18.5" cy="17.5" r="3.3" />
        <path d="M5.5 17.5 10 8h4l4.5 9.5" />
        <path d="M10 8 8 6" />
        <path d="M13.5 8 15 6h2.5" />
      </svg>
    );
  }
  if (kind === "motorbike") {
    return (
      <svg {...props}>
        <circle cx="5" cy="17" r="3.2" />
        <circle cx="19" cy="17" r="3.2" />
        <path d="M5 17h6l3.5-4.5H11" />
        <path d="M12.5 12.5h4L19 17" />
        <path d="M14.5 8H18" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M3 13l1.6-4.7A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.3L21 13" />
      <path d="M3 13h18v4a1 1 0 0 1-1 1h-1.6" />
      <path d="M5.6 18H4a1 1 0 0 1-1-1v-4" />
      <circle cx="7.6" cy="18" r="1.6" />
      <circle cx="16.4" cy="18" r="1.6" />
    </svg>
  );
}

/**
 * The rich career status card shown on the launcher: balance, the ride you'll
 * take out, and progress toward the next goal. Presentational — every value
 * arrives already formatted from {@link careerCardModel}.
 */
export function CareerLauncherCard({ model }: { model: CareerCardModel }) {
  return (
    <div className="career-card" data-testid="career-card">
      <div className="career-card-head">
        <span className="career-card-eyebrow">CAREER</span>
        <span className="career-card-day">
          <i aria-hidden="true" />
          DAY {model.day}
        </span>
      </div>
      <div className="career-card-balance">
        <span className="career-card-label">BALANCE</span>
        <div className="career-card-amount-row">
          <strong className="career-card-amount" data-testid="career-card-cash">
            {model.cash}
          </strong>
          {model.note && (
            <span className={`career-card-note ${model.note.tone}`}>
              {model.note.text}
            </span>
          )}
        </div>
      </div>
      <div className="career-card-rule" />
      <div className="career-card-vehicle">
        <span className="career-card-vehicle-icon">
          <VehicleGlyph kind={model.driving.kind} />
        </span>
        <span className="career-card-vehicle-copy">
          <small>NOW DRIVING</small>
          <strong>{model.driving.name}</strong>
        </span>
        <span className="career-card-badge">{model.driving.badge}</span>
      </div>
      <div className="career-card-progress">
        <div className="career-card-progress-head">
          <span>{model.bar.label}</span>
          {model.bar.target && <strong>{model.bar.target}</strong>}
        </div>
        <div className="career-card-bar">
          <i style={{ width: `${model.bar.fraction * 100}%` }} />
        </div>
        <div className="career-card-progress-foot">
          <span>{model.bar.saved}</span>
          <span>{model.footnote}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The launcher's career pane: the status card plus the primary action — start a
 * fresh career in the chosen city, continue the saved one, or clean up a
 * damaged/finished save. The buyout goal is stated inside the card so a run has
 * a visible finish line from day 1.
 */
export function CareerSetupPanel({
  career,
  city,
  cityName,
  country,
  garageVehicleId,
  onStartCareer,
  onContinue,
  onResetCorrupt,
}: {
  career: CareerSliceV2 | { state: "corrupt" } | null;
  /** The active city of `career`, or null before one exists. */
  city: CareerCityView | null;
  cityName: string;
  country: CountryProfile;
  garageVehicleId: CareerVehicleId;
  onStartCareer: () => void;
  onContinue: () => void;
  onResetCorrupt: () => void;
}) {
  if (career && career.state === "corrupt") {
    return (
      <div className="launcher-actions" data-testid="career-corrupt">
        <p role="alert" style={{ fontWeight: 700 }}>
          Your career save is damaged and can&apos;t be loaded.
        </p>
        <button
          type="button"
          className="danger-button"
          data-testid="career-reset-corrupt"
          onClick={onResetCorrupt}
        >
          Reset career data
        </button>
      </div>
    );
  }
  // Corrupt handled above, so `career` is now a live slice or null (a fresh
  // start) — both drive the card, one live and one as a preview.
  const slice: CareerSliceV2 | null = career;
  const model = careerCardModel(slice, city, country, garageVehicleId);
  return (
    <div
      className="career-launcher"
      data-testid={slice ? "career-continue-panel" : "career-new-panel"}
    >
      <CareerLauncherCard model={model} />
      <div className="launcher-actions">
        {slice ? (
          <button
            type="button"
            className="primary-button launcher-primary"
            data-testid="career-continue"
            onClick={onContinue}
          >
            Continue shift · Day {city?.day ?? 1}
            <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button
            type="button"
            className="primary-button launcher-primary"
            data-testid="career-start"
            onClick={onStartCareer}
          >
            Start career in {cityName}
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** One row of the travel board: a ladder city and what you can do with it. */
export interface TravelStop {
  readonly destinationId: DestinationId;
  readonly name: string;
  readonly countryName: string;
  readonly flagEmoji: string;
  readonly state: "here" | "unlocked" | "next" | "locked";
  /** Cash and fleet waiting there, for a city already reached. */
  readonly waiting: { readonly cash: string; readonly vehicles: number } | null;
  /** Ticket price from the *current* city, on the "next" row only. */
  readonly ticket: string | null;
  readonly affordable: boolean;
}

/**
 * Derives the travel board from the career. Pure (money formatted here) so the
 * copy is unit-testable without rendering, in the style of careerCardModel.
 */
export function travelBoard(
  slice: CareerSliceV2,
  countryOf: (destinationId: DestinationId) => CountryProfile,
  nameOf: (destinationId: DestinationId) => string,
): readonly TravelStop[] {
  const here = activeCity(slice);
  const onward = nextCareerCity(here.destinationId);
  const price = ticketPrice(here.destinationId);
  return CAREER_CITIES.map((destinationId) => {
    const country = countryOf(destinationId);
    const reached = slice.cities[destinationId];
    const state: TravelStop["state"] =
      destinationId === here.destinationId
        ? "here"
        : reached
          ? "unlocked"
          : destinationId === onward
            ? "next"
            : "locked";
    return {
      destinationId,
      name: nameOf(destinationId),
      countryName: country.countryName,
      flagEmoji: country.flagEmoji,
      state,
      waiting: reached
        ? {
            cash: formatMoney(reached.cash, country),
            vehicles: reached.ownedVehicleIds.length,
          }
        : null,
      ticket:
        state === "next" && price !== null
          ? formatMoney(price, countryOf(here.destinationId))
          : null,
      affordable: state === "next" && price !== null && here.cash >= price,
    };
  });
}

/**
 * The travel board: every city on the career ladder, the ones you have reached
 * (free to fly back to, with whatever you left there still waiting), and the
 * one onward ticket you can buy. Moving on is always optional — this page is
 * reachable from the garage and never forces a choice.
 */
export function TravelView({
  stops,
  onGoTo,
  onBuyTicket,
  onBack,
}: {
  stops: readonly TravelStop[];
  onGoTo: (destinationId: DestinationId) => void;
  onBuyTicket: () => void;
  onBack: () => void;
}) {
  return (
    <section className="subpage" aria-label="Travel">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">CAREER · TRAVEL</p>
          <h1>Where are you working?</h1>
          <p>
            Money and vehicles stay in the city you earned them in. Fly back any
            time — everything you left is still there.
          </p>
        </div>
      </div>

      <ol className="travel-board" data-testid="travel-board">
        {stops.map((stop) => (
          <li
            key={stop.destinationId}
            className={`travel-stop ${stop.state}`}
            data-testid={`travel-${stop.destinationId}`}
          >
            <span className="travel-flag" aria-hidden="true">
              {stop.flagEmoji}
            </span>
            <span className="travel-copy">
              <strong>{stop.name}</strong>
              <small>
                {stop.state === "here" && "You're here"}
                {stop.state === "unlocked" &&
                  stop.waiting &&
                  `${stop.waiting.cash} waiting · ${stop.waiting.vehicles} owned`}
                {stop.state === "next" && `Ticket ${stop.ticket}`}
                {stop.state === "locked" && "Locked"}
              </small>
            </span>
            {stop.state === "unlocked" && (
              <button
                type="button"
                className="travel-action"
                data-testid={`travel-go-${stop.destinationId}`}
                onClick={() => onGoTo(stop.destinationId)}
              >
                Fly here
              </button>
            )}
            {stop.state === "next" && (
              <button
                type="button"
                className="travel-action buy"
                data-testid="travel-buy-ticket"
                disabled={!stop.affordable}
                onClick={onBuyTicket}
              >
                Buy ticket
              </button>
            )}
            {stop.state === "here" && (
              <span className="travel-action current">✓</span>
            )}
          </li>
        ))}
      </ol>

      <div className="settings-actions" style={{ marginTop: "1.1rem" }}>
        <button
          type="button"
          className="primary-button"
          data-testid="travel-back"
          onClick={onBack}
        >
          Back to the garage
        </button>
      </div>
    </section>
  );
}
