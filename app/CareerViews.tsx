"use client";

import { useState } from "react";

// Career Mode's interstitial screens: the garage (morning vehicle choice), the
// end-of-day ledger, and the career-over report. Props-pure — everything they
// show arrives as data, so tests render them directly without the app shell.

import type { CountryProfile, DestinationId } from "./game/types";
import { formatMoney } from "./game/content";
import {
  activeCity,
  buyableVehicles,
  buyoutPrice,
  canBuyVehicle,
  CAREER_CITIES,
  CAREER_STARTING_CASH_BY_COUNTRY,
  CAREER_VEHICLES,
  nextCareerCity,
  nextInstallment,
  unlockedCities,
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
            already spent. Buy one outright and the rent stops for good.
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
          const showBuy = vehicle.buyoutEligible && !owned;
          // Choosing and buying both live in the action row *outside* the card
          // button — nesting a button in a button is invalid HTML, and the slot
          // is what draws the card, so they still read as inside it. Desktop
          // stacks the row, mobile lays it side by side.
          const canChoose = !active && !disabled && affordable;
          const showActions = canChoose || showBuy;
          // The status line the card carries under its specs: what it is today,
          // or why it cannot be today's ride.
          const status = active ? (
            <span className="garage-card-today">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              TODAY&apos;S RIDE
            </span>
          ) : disabled ? (
            <span className="garage-card-cant">{lockedReason}</span>
          ) : affordable ? null : (
            <span className="garage-card-cant">
              Rent&apos;s out of reach today
            </span>
          );
          return (
            <div
              className={`garage-slot${active ? " active" : ""}${disabled ? " locked" : ""}${showActions ? " with-actions" : ""}`}
              key={vehicle.id}
            >
            <button
              type="button"
              data-testid={`garage-vehicle-${vehicle.id}`}
              className="garage-card"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(vehicle.id)}
            >
              {/* Art beside the specs on mobile, above them on desktop. */}
              <span className="garage-card-main">
                {/* Placeholder art until the real vehicle renders land. */}
                <span className="garage-card-art" aria-hidden="true">
                  <VehicleGlyph kind={vehicle.visualKind} />
                  <span className="garage-card-art-note">Artwork soon</span>
                  {owned && <span className="garage-card-owned">OWNED</span>}
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
                    <span className="garage-card-heading">
                      <span className="garage-card-titles">
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
                      </span>
                      {/* Mobile's selection mark; desktop says it in words. */}
                      {active && (
                        <span className="garage-card-dot" aria-hidden="true">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </span>
                      )}
                    </span>
                    <span className="garage-card-meta">
                      <span className={`garage-tag${rideshare ? " rideshare" : ""}`}>
                        {rideshare ? "Deliveries + Rideshare" : "Deliveries only"}
                      </span>
                      {vehicle.tankL > 0 ? (
                        <span className="garage-card-fuel">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18" />
                            <path d="M2 22h13" />
                            <path d="M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3" />
                            <path d="M6 8h4" />
                          </svg>
                          {vehicle.tankL} L tank
                        </span>
                      ) : (
                        /* Only the leaf goes green — the label stays as quiet as
                           every other card's, so the row scans as one column. */
                        <span className="garage-card-fuel">
                          <svg className="green" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                            <path d="M2 21c0-3 1.85-5.36 5.08-6" />
                          </svg>
                          No fuel needed
                        </span>
                      )}
                    </span>
                  </span>
                  {status && <span className="garage-card-foot">{status}</span>}
                </span>
              </span>
            </button>
            {showActions && (
              <div className="garage-card-actions">
                {/* Redundant with tapping the card, which also selects — but the
                    card gives no visible affordance without it. */}
                {canChoose && (
                  <button
                    type="button"
                    className="garage-card-choose"
                    aria-label={`Choose ${vehicle.name}`}
                    onClick={() => onSelect(vehicle.id)}
                  >
                    Choose this ride
                  </button>
                )}
                {showBuy && (
                  <button
                    type="button"
                    className="garage-card-buy"
                    data-testid={`garage-buy-${vehicle.id}`}
                    disabled={!buyable}
                    onClick={() => onBuy(vehicle.id)}
                  >
                    Buy · {formatMoney(price, country)}
                  </button>
                )}
              </div>
            )}
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
        {/* DOM order is the mobile reading order: travel scrolls with the page,
            then the bar pins to the bottom carrying what the day costs and the
            two ways out of it. Desktop reorders these into one column. */}
        <div className="garage-actions">
          <button
            type="button"
            className="garage-travel"
            data-testid="garage-travel"
            onClick={onTravel}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9 1.7l4 3.1-2.4 2.4H3.2a.8.8 0 0 0-.5 1.4l2.2 1.6 1.6 2.2a.8.8 0 0 0 1.4-.5v-2.3l2.4-2.4 3.1 4a1 1 0 0 0 1.7-.9Z" />
            </svg>
            Travel · {cityName}
          </button>
          <div className="garage-dock">
            {/* The obligations panel scrolls away on mobile; the bar keeps the
                number that decides whether to start the day at all. */}
            <div className="garage-dock-due">
              <span className="garage-dock-label">DUE TODAY</span>
              <span className="garage-dock-value">
                {formatMoney(dueToday, country)} · {selected?.name ?? "—"}
              </span>
            </div>
            <button type="button" className="garage-abandon" onClick={onAbandon}>
              Abandon career
            </button>
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
          </div>
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
}

/**
 * Derives the launcher career card from the live slice, or — before any career
 * exists — from the chosen country's day-1 defaults, so the card doubles as a
 * "here's what you'll start with" preview. Pure (money formatted here) so the
 * copy is unit-testable without rendering. What you are saving for is stated on
 * the garage's own panel, so the card stays a balance and nothing else.
 */
export function careerCardModel(
  slice: CareerSliceV2 | null,
  city: CareerCityView | null,
  country: CountryProfile,
): CareerCardModel {
  const startingCash = CAREER_STARTING_CASH_BY_COUNTRY[country.id];
  const day = city?.day ?? 1;
  const cash = city?.cash ?? startingCash;
  const loan = city?.loan ?? null;

  let note: CareerCardModel["note"] = null;
  if (slice?.state === "won") {
    note = { text: "freedom bought", tone: "good" };
  } else if (loan) {
    note = {
      text: `owes ${formatMoney(loan.principalRemaining, country)}`,
      tone: "warn",
    };
  } else if (day === 1) {
    note = { text: `+${formatMoney(startingCash, country)} starter`, tone: "good" };
  }

  return { day, cash: formatMoney(cash, country), note };
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
 * The career status card shown on the launcher: the day and the balance.
 * Presentational — every value arrives already formatted from
 * {@link careerCardModel}.
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
  onStartCareer,
  onContinue,
  onResetCorrupt,
}: {
  career: CareerSliceV2 | { state: "corrupt" } | null;
  /** The active city of `career`, or null before one exists. */
  city: CareerCityView | null;
  cityName: string;
  country: CountryProfile;
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
  const model = careerCardModel(slice, city, country);
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

/** What the travel board needs to describe a city, resolved by the caller. */
export interface TravelCityFacts {
  readonly name: string;
  /** Short neighbourhood line under the name. */
  readonly area: string;
  readonly country: CountryProfile;
  /** Cover photo for the card header. */
  readonly imageSrc: string;
}

/** One card on the travel board: a ladder city and what you can do with it. */
export interface TravelStop {
  readonly destinationId: DestinationId;
  readonly name: string;
  readonly area: string;
  readonly flagEmoji: string;
  /** "DRIVES ON THE LEFT/RIGHT" — the thing that actually changes when you fly. */
  readonly side: string;
  readonly imageSrc: string;
  readonly state: "here" | "unlocked" | "next" | "locked";
  /** Cash and fleet waiting there, for a city already reached. */
  readonly waiting: { readonly cash: string; readonly vehicles: number } | null;
  /** Ticket price out of the *current* city, on the "next" card only. */
  readonly ticket: string | null;
  readonly affordable: boolean;
  /** How far short of the ticket you are, when you cannot afford it. */
  readonly shortBy: string | null;
  /** What it takes to reach a city still beyond the ladder's edge. */
  readonly unlockAt: string | null;
  /** Whether picking this card as a destination does anything. */
  readonly selectable: boolean;
}

/**
 * Derives the travel board from the career. Pure (money formatted here) so the
 * copy is unit-testable without rendering, in the style of careerCardModel.
 */
export function travelBoard(
  slice: CareerSliceV2,
  describe: (destinationId: DestinationId) => TravelCityFacts,
): readonly TravelStop[] {
  const here = activeCity(slice);
  const hereCountry = describe(here.destinationId).country;
  const onward = nextCareerCity(here.destinationId);
  const price = ticketPrice(here.destinationId);
  return CAREER_CITIES.map((destinationId, index) => {
    const facts = describe(destinationId);
    const reached = slice.cities[destinationId];
    const state: TravelStop["state"] =
      destinationId === here.destinationId
        ? "here"
        : reached
          ? "unlocked"
          : destinationId === onward
            ? "next"
            : "locked";
    const isNext = state === "next" && price !== null;
    const affordable = isNext && here.cash >= (price as number);
    // A city past the ladder's edge opens by reaching the one before it —
    // derived from CAREER_CITIES, so reordering the route rewrites this too.
    const previous = index > 0 ? describe(CAREER_CITIES[index - 1]).name : null;
    return {
      destinationId,
      name: facts.name,
      area: facts.area,
      flagEmoji: facts.country.flagEmoji,
      side: `DRIVES ON THE ${facts.country.trafficSide === "left" ? "LEFT" : "RIGHT"}`,
      imageSrc: facts.imageSrc,
      state,
      waiting: reached
        ? {
            cash: formatMoney(reached.cash, facts.country),
            vehicles: reached.ownedVehicleIds.length,
          }
        : null,
      ticket: isNext ? formatMoney(price as number, hereCountry) : null,
      affordable,
      shortBy:
        isNext && !affordable
          ? formatMoney((price as number) - here.cash, hereCountry)
          : null,
      unlockAt: state === "locked" && previous ? `Fly to ${previous} first` : null,
      selectable: state === "unlocked" || state === "next",
    };
  });
}

/** The wallet/unlocked pair beside the travel heading. */
export interface TravelSummary {
  readonly hereName: string;
  readonly cash: string;
  readonly unlockedCount: number;
  readonly totalCount: number;
}

export function travelSummary(
  slice: CareerSliceV2,
  hereCountry: CountryProfile,
  hereName: string,
): TravelSummary {
  return {
    hereName,
    cash: formatMoney(activeCity(slice).cash, hereCountry),
    unlockedCount: unlockedCities(slice).length,
    totalCount: CAREER_CITIES.length,
  };
}

const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/**
 * The travel board: every city on the career ladder — where you are, the ones
 * you have reached (free to fly back to, with whatever you left there still
 * waiting), the one onward ticket you can buy, and the rest still locked.
 *
 * Picking a card only *selects* a destination; the flight itself is the single
 * action in the footer. That split is deliberate — it puts one obvious commit
 * point on a page where one of the choices spends money you cannot get back.
 */
export function TravelView({
  stops,
  summary,
  onGoTo,
  onBuyTicket,
  onBack,
}: {
  stops: readonly TravelStop[];
  summary: TravelSummary;
  onGoTo: (destinationId: DestinationId) => void;
  onBuyTicket: () => void;
  onBack: () => void;
}) {
  const [destinationId, setDestinationId] = useState<DestinationId | null>(null);
  const destination = stops.find((stop) => stop.destinationId === destinationId);
  const here = stops.find((stop) => stop.state === "here");
  // A selected destination is flyable when it is already unlocked (free) or is
  // the next rung and the ticket is covered.
  const canFly = Boolean(
    destination &&
      (destination.state === "unlocked" ||
        (destination.state === "next" && destination.affordable)),
  );

  const footerLine = !destination
    ? "Pick a city to fly to"
    : destination.state === "unlocked"
      ? `${destination.name} · already yours, no ticket`
      : canFly
        ? `${destination.name} · ticket ${destination.ticket}`
        : `${destination.name} · need ${destination.shortBy} more`;

  const flyLabel = !destination
    ? "Select a destination"
    : canFly
      ? `Fly to ${destination.name}`
      : `Ticket costs ${destination.ticket}`;

  return (
    <section className="travel-page" aria-label="Travel">
      <div className="travel-head">
        <div className="travel-head-copy">
          <p className="travel-eyebrow">
            <span className="travel-eyebrow-dot" aria-hidden="true" />
            CAREER · TRAVEL
          </p>
          <h1>Where are you working?</h1>
          <p className="travel-sub">
            Money and vehicles stay in the city you earned them in. Fly back any
            time — everything you left is still there.
          </p>
        </div>
        <div className="travel-stats">
          <div className="travel-stat">
            <span className="travel-stat-label">
              WALLET IN {summary.hereName.toUpperCase()}
            </span>
            <strong className="travel-stat-value yellow" data-testid="travel-wallet">
              {summary.cash}
            </strong>
            <span className="travel-stat-note">
              Only cash here pays for tickets.
            </span>
          </div>
          <div className="travel-stat">
            <span className="travel-stat-label">UNLOCKED</span>
            <strong className="travel-stat-value">
              {summary.unlockedCount}
              <em> / {summary.totalCount}</em>
            </strong>
          </div>
        </div>
      </div>

      <div className="travel-grid" role="group" aria-label="Cities">
        {stops.map((stop) => {
          const chosen = stop.destinationId === destinationId;
          return (
            <div
              key={stop.destinationId}
              className={`travel-card ${stop.state}${chosen ? " chosen" : ""}`}
              data-testid={`travel-${stop.destinationId}`}
            >
              {stop.selectable ? (
                <button
                  type="button"
                  className="travel-card-hit"
                  aria-pressed={chosen}
                  aria-label={`Select ${stop.name}`}
                  data-testid={`travel-pick-${stop.destinationId}`}
                  onClick={() => setDestinationId(stop.destinationId)}
                />
              ) : null}
              {chosen && <span className="travel-card-ring" aria-hidden="true" />}

              <div className="travel-card-art">
                {/* eslint-disable-next-line @next/next/no-img-element -- static city art in /public; next/image adds nothing for a fixed, non-critical thumbnail */}
                <img src={stop.imageSrc} alt="" aria-hidden="true" draggable={false} />
                <span className="travel-card-scrim" aria-hidden="true" />
                {stop.state === "here" && (
                  <span className="travel-card-badge">
                    <i aria-hidden="true" />
                    YOU&apos;RE HERE
                  </span>
                )}
                {stop.state === "locked" && (
                  <span className="travel-card-lock" aria-hidden="true">
                    <LockIcon />
                  </span>
                )}
              </div>

              <div className="travel-card-body">
                <div className="travel-card-heading">
                  <div className="travel-card-titles">
                    <div className="travel-card-name">{stop.name}</div>
                    <div className="travel-card-area">{stop.area}</div>
                    {/* Positioned over the art on desktop, inline under the
                        name on mobile — one element, two layouts. */}
                    <span className="travel-card-side">
                      <span className="travel-flag" aria-hidden="true">
                        {stop.flagEmoji}
                      </span>
                      {stop.side}
                    </span>
                  </div>
                  {chosen && (
                    <span className="travel-card-tick" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </div>

                {stop.waiting && (
                  <div className="travel-card-stash">
                    <div className="travel-chip stash">
                      <span className="travel-chip-label">STASHED</span>
                      <strong className="yellow">{stop.waiting.cash}</strong>
                    </div>
                    <div className="travel-chip parked">
                      <span className="travel-chip-label">PARKED</span>
                      <strong>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 13l1.6-4.7A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.3L21 13" />
                          <path d="M3 13h18v4a1 1 0 0 1-1 1h-1.6" />
                          <path d="M5.6 18H4a1 1 0 0 1-1-1v-4" />
                          <circle cx="7.6" cy="18" r="1.7" />
                          <circle cx="16.4" cy="18" r="1.7" />
                        </svg>
                        {stop.waiting.vehicles}
                        {stop.waiting.vehicles === 1 ? " car" : " cars"}
                      </strong>
                    </div>
                  </div>
                )}

                {stop.unlockAt && (
                  <div className="travel-card-unlock">
                    <span className="travel-chip-label">UNLOCKS AT</span>
                    <strong>{stop.unlockAt}</strong>
                  </div>
                )}

                <div className="travel-card-foot">
                  {stop.state === "here" && (
                    <span className="travel-card-base">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      CURRENT BASE
                    </span>
                  )}
                  {stop.state === "unlocked" && (
                    <span className="travel-card-free">Fly back free</span>
                  )}
                  {stop.state === "next" && (
                    <span className="travel-card-ticket">
                      <span>
                        <span className="travel-chip-label">TICKET</span>
                        <strong className={stop.affordable ? "yellow" : undefined}>
                          {stop.ticket}
                        </strong>
                      </span>
                      {stop.affordable ? (
                        <span className="travel-card-cta">Fly here</span>
                      ) : (
                        <span className="travel-card-short">
                          {stop.shortBy}
                          <br />
                          to go
                        </span>
                      )}
                    </span>
                  )}
                  {stop.state === "locked" && (
                    <span className="travel-card-locked">LOCKED</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="travel-footer">
        <div className="travel-footer-copy">
          <span className="travel-flag big" aria-hidden="true">
            {(destination ?? here)?.flagEmoji}
          </span>
          <div>
            <div className="travel-stat-label">
              {destination ? "DESTINATION" : "NO TICKET BOOKED"}
            </div>
            <div className="travel-footer-line" data-testid="travel-footer-line">
              {footerLine}
            </div>
          </div>
        </div>
        <div className="travel-footer-actions">
          <button type="button" className="travel-back" onClick={onBack}>
            Back to the garage
          </button>
          <button
            type="button"
            className="travel-fly"
            data-testid="travel-fly"
            disabled={!canFly}
            onClick={() => {
              if (!destination || !canFly) return;
              if (destination.state === "unlocked") onGoTo(destination.destinationId);
              else onBuyTicket();
            }}
          >
            {flyLabel}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
