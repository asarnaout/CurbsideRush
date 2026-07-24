"use client";

import { useState } from "react";

// Career Mode's interstitial screens: the garage (morning vehicle choice), the
// end-of-day ledger, and the career-over report. Props-pure — everything they
// show arrives as data, so tests render them directly without the app shell.

import type { CountryProfile } from "./game/types";
import { formatMoney } from "./game/content";
import {
  BUYOUT_RENT_MULTIPLIER,
  buyoutPrice,
  canBuyout,
  CAREER_STARTING_CASH_BY_COUNTRY,
  CAREER_VEHICLES,
  getCareerVehicle,
  nextInstallment,
  vehicleRent,
  type CareerSliceV1,
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

const cardStyle: React.CSSProperties = {
  borderRadius: "1rem",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(15, 18, 22, 0.55)",
  padding: "1.1rem 1.25rem",
  color: "inherit",
};

export function GarageView({
  slice,
  country,
  selectedVehicleId,
  lockedVehicles,
  onSelect,
  onStartDay,
  onBuyout,
  onAbandon,
}: {
  slice: CareerSliceV1;
  country: CountryProfile;
  selectedVehicleId: CareerVehicleId;
  /** Vehicles present but not yet playable, with the reason shown on the card. */
  lockedVehicles: Readonly<Partial<Record<CareerVehicleId, string>>>;
  onSelect: (id: CareerVehicleId) => void;
  onStartDay: (id: CareerVehicleId) => void;
  onBuyout: (id: CareerVehicleId) => void;
  onAbandon: () => void;
}) {
  const selected = CAREER_VEHICLES.find(
    (vehicle) => vehicle.id === selectedVehicleId,
  );
  const selectedRent = selected ? vehicleRent(selected, slice) : 0;
  const selectedLocked = Boolean(lockedVehicles[selectedVehicleId]);
  const selectedStartable = !selectedLocked && slice.cash >= selectedRent;
  return (
    <section className="subpage" aria-label="Career garage">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">
            CAREER · DAY {slice.day} · {country.flagEmoji}
          </p>
          <h1>Pick today&apos;s ride.</h1>
          <p>
            Rent is paid up front — every idle minute burns money you already
            spent. Cash on hand:{" "}
            <strong data-testid="garage-cash">
              {formatMoney(slice.cash, country)}
            </strong>
          </p>
        </div>
      </div>
      {slice.state === "won" && (
        <div
          data-testid="victory-banner"
          style={{
            ...cardStyle,
            borderColor: "#5bbf6a",
            background: "rgba(46, 110, 64, 0.28)",
            marginBottom: "1rem",
            fontWeight: 700,
          }}
        >
          🏁 CAREER COMPLETE — you bought your own wheels on day{" "}
          {slice.victoryDay}. The treadmill is beaten; keep driving for the
          records.
        </div>
      )}
      {slice.finalNotice && (
        <div
          role="alert"
          style={{
            ...cardStyle,
            borderColor: "#e0533f",
            background: "rgba(150, 24, 28, 0.28)",
            marginBottom: "1rem",
            fontWeight: 700,
          }}
        >
          ⚠ FINAL NOTICE — end another day short while owing and the career is
          over.
        </div>
      )}
      <div
        role="group"
        aria-label="Vehicles"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "0.9rem",
        }}
      >
        {CAREER_VEHICLES.map((vehicle) => {
          const rent = vehicleRent(vehicle, slice);
          const lockedReason = lockedVehicles[vehicle.id];
          const affordable = slice.cash >= rent;
          const disabled = Boolean(lockedReason) || !affordable;
          const active = selectedVehicleId === vehicle.id;
          const capability = vehicle.allowedGigKinds.includes("passenger")
            ? "Deliveries + rideshare"
            : "Deliveries only";
          return (
            <button
              key={vehicle.id}
              type="button"
              data-testid={`garage-vehicle-${vehicle.id}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(vehicle.id)}
              style={{
                ...cardStyle,
                textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                borderColor: active ? "#f2c658" : "rgba(255,255,255,0.12)",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              <strong style={{ fontSize: "1.05rem" }}>{vehicle.name}</strong>
              <span>
                {rent === 0
                  ? vehicle.owned
                    ? "Yours — no rent"
                    : "Owned — no rent"
                  : `Rent ${formatMoney(rent, country)} / day`}
              </span>
              <small style={{ opacity: 0.75 }}>
                {capability}
                {vehicle.tankL > 0
                  ? ` · ${vehicle.tankL} L tank`
                  : " · no fuel needed"}
              </small>
              {lockedReason ? (
                <small style={{ color: "#f2c658" }}>{lockedReason}</small>
              ) : !affordable ? (
                <small style={{ color: "#e0533f" }}>Can&apos;t afford today</small>
              ) : null}
            </button>
          );
        })}
      </div>
      <BuyoutFund slice={slice} country={country} />
      <div style={{ ...cardStyle, marginTop: "1rem" }} data-testid="garage-forecast">
        <strong>Tonight&apos;s obligations</strong>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", opacity: 0.85 }}>
          <li>Platform fee</li>
          {slice.loan && (
            <li data-testid="forecast-installment">
              Loan installment {formatMoney(nextInstallment(slice.loan), country)}{" "}
              ({formatMoney(slice.loan.principalRemaining, country)} over{" "}
              {slice.loan.daysRemaining}{" "}
              {slice.loan.daysRemaining === 1 ? "day" : "days"})
            </li>
          )}
          <li>Anything you still owe becomes a loan (+15%)</li>
        </ul>
      </div>
      <div
        className="settings-actions"
        style={{ marginTop: "1.1rem", display: "flex", gap: "0.75rem" }}
      >
        <button type="button" className="danger-button" onClick={onAbandon}>
          Abandon career
        </button>
        {selected && canBuyout(slice, selected) && (
          <button
            type="button"
            className="secondary-button"
            data-testid="garage-buyout"
            onClick={() => onBuyout(selectedVehicleId)}
            style={{ borderColor: "#f2c658", color: "#f2c658" }}
          >
            Buy the {selected.name.toLowerCase()} outright —{" "}
            {formatMoney(buyoutPrice(selected, slice.countryId), country)}
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          data-testid="garage-start-day"
          disabled={!selectedStartable}
          onClick={() => onStartDay(selectedVehicleId)}
        >
          Start Day {slice.day} →
        </button>
      </div>
    </section>
  );
}

/**
 * The run's finish line, kept visible from day 1 (research: all-loss ledgers
 * burn players out — show the escape route). Progress toward the cheapest
 * eligible buyout; hidden once won, while indebted, or under notice.
 */
export function BuyoutFund({
  slice,
  country,
}: {
  slice: CareerSliceV1;
  country: CountryProfile;
}) {
  if (slice.state !== "active" || slice.loan || slice.finalNotice) return null;
  const cheapest = CAREER_VEHICLES.filter(
    (vehicle) => vehicle.buyoutEligible,
  ).reduce((best, vehicle) =>
    buyoutPrice(vehicle, slice.countryId) < buyoutPrice(best, slice.countryId)
      ? vehicle
      : best,
  );
  const price = buyoutPrice(cheapest, slice.countryId);
  const fraction = Math.max(0, Math.min(1, slice.cash / price));
  return (
    <div
      style={{ ...cardStyle, marginTop: "1rem" }}
      data-testid="buyout-fund"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "0.4rem",
        }}
      >
        <strong>Buy your freedom</strong>
        <span>
          {formatMoney(slice.cash, country)} / {formatMoney(price, country)}
        </span>
      </div>
      <div
        style={{
          height: "0.5rem",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.16)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${fraction * 100}%`,
            background: "#f2c658",
          }}
        />
      </div>
      <small style={{ opacity: 0.7 }}>
        Own the {cheapest.name.toLowerCase()} outright (
        {BUYOUT_RENT_MULTIPLIER}× its rent) and the daily treadmill is beaten.
      </small>
    </div>
  );
}

export function LedgerView({
  result,
  slice,
  country,
  reducedMotion,
  onContinue,
}: {
  result: SettlementResult;
  /** The slice AFTER settlement (already advanced to the next day). */
  slice: CareerSliceV1;
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
          <p className="eyebrow">CAREER · DAY {slice.day - 1} COMPLETE</p>
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
      {slice.loan && result.outcome !== "final_notice" && (
        <p style={{ marginTop: "0.9rem", opacity: 0.85 }}>
          Outstanding debt {formatMoney(slice.loan.principalRemaining, country)}{" "}
          — next installment{" "}
          {formatMoney(nextInstallment(slice.loan), country)}.
        </p>
      )}
      <div style={{ maxWidth: "30rem" }}>
        <BuyoutFund slice={slice} country={country} />
      </div>
      <div className="settings-actions" style={{ marginTop: "1.1rem" }}>
        <button
          type="button"
          className="primary-button"
          data-testid="ledger-continue"
          onClick={onContinue}
        >
          Continue to Day {slice.day} →
        </button>
      </div>
    </section>
  );
}

export function CareerOverView({
  slice,
  country,
  onRestart,
  onMenu,
}: {
  slice: CareerSliceV1;
  country: CountryProfile;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const stats = slice.stats;
  const rows: readonly (readonly [string, string])[] = [
    ["Days survived", String(stats.daysCompleted)],
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
          <p className="eyebrow">CAREER OVER</p>
          <h1>The bank called it.</h1>
          <p>
            Day {slice.day} ended {formatMoney(slice.cash, country)} short with
            nothing left to borrow.
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
      <div className="settings-actions" style={{ marginTop: "1.1rem", display: "flex", gap: "0.75rem" }}>
        <button type="button" className="secondary-button" onClick={onMenu}>
          Back to menu
        </button>
        <button
          type="button"
          className="primary-button"
          data-testid="career-restart"
          onClick={onRestart}
        >
          Start a new career
        </button>
      </div>
    </section>
  );
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

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
  slice: CareerSliceV1 | null,
  country: CountryProfile,
  garageVehicleId: CareerVehicleId,
): CareerCardModel {
  const startingCash = CAREER_STARTING_CASH_BY_COUNTRY[country.id];
  const day = slice?.day ?? 1;
  const cash = slice?.cash ?? startingCash;
  const ownedId = slice?.ownedVehicleId ?? null;
  const won = slice?.state === "won";
  const loan = slice?.loan ?? null;

  const drivingSpec = getCareerVehicle(ownedId ?? garageVehicleId);
  const ownsDriving = drivingSpec.owned || ownedId === drivingSpec.id;
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
    vehicle.owned || ownedId === vehicle.id
      ? 0
      : vehicle.rentByCountry[country.id];
  const cheapestBuyout = CAREER_VEHICLES.filter((v) => v.buyoutEligible).reduce(
    (best, v) =>
      buyoutPrice(v, country.id) < buyoutPrice(best, country.id) ? v : best,
  );
  const buyoutCost = buyoutPrice(cheapestBuyout, country.id);
  const nextRental = CAREER_VEHICLES.filter(
    (v) => v.id !== "bicycle" && !v.owned && ownedId !== v.id && rentOf(v) > cash,
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
  cityName,
  country,
  garageVehicleId,
  onStartCareer,
  onContinue,
  onViewLastRun,
  onResetCorrupt,
  onStartFresh,
}: {
  career: CareerSliceV1 | { state: "corrupt" } | null;
  cityName: string;
  country: CountryProfile;
  garageVehicleId: CareerVehicleId;
  onStartCareer: () => void;
  onContinue: () => void;
  onViewLastRun: () => void;
  onResetCorrupt: () => void;
  onStartFresh: () => void;
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
  if (career && career.state === "over") {
    return (
      <div className="launcher-actions" data-testid="career-finished">
        <button
          type="button"
          className="secondary-button"
          onClick={onViewLastRun}
        >
          View last run — Day {career.day}
        </button>
        <button
          type="button"
          className="primary-button launcher-primary"
          data-testid="career-start"
          onClick={onStartFresh}
        >
          Start a new career
          <span aria-hidden="true">→</span>
        </button>
      </div>
    );
  }
  // Corrupt and over handled above, so `career` is now an active/won slice or
  // null (a fresh start) — both drive the card, one live and one as a preview.
  const slice: CareerSliceV1 | null = career;
  const model = careerCardModel(slice, country, garageVehicleId);
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
            Continue shift · Day {slice.day}
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
