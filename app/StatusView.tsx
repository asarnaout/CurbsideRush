"use client";

import { useState } from "react";
import type { CareerPersisted } from "./game/career";
import { careerStatusStats } from "./game/career";
import { getCountryProfile } from "./game/content";
import { createEmptyDrivingStats, STATS_COUNTRY_ORDER } from "./game/drivingStats";
import { formatMoney } from "./game/economyTables";
import {
  ODOMETER_ICON,
  PARCEL_ICON,
  RIDER_ICON,
  TICKET_ICON,
  WALLET_ICON,
} from "./game/hudIcons";
import type { DrivingStats } from "./game/types";

type StatusMode = "free" | "career";

const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const milesFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function StatusGlyph({
  path,
}: {
  readonly path: readonly string[];
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {path.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      ))}
    </svg>
  );
}

function CountCard({
  label,
  value,
  icon,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: readonly string[];
  readonly tone?: "coral";
}) {
  return (
    <article className={`status-count-card${tone ? ` ${tone}` : ""}`}>
      <span className="status-card-icon"><StatusGlyph path={icon} /></span>
      <span className="status-card-label">{label}</span>
      <strong>{countFormatter.format(value)}</strong>
    </article>
  );
}

function MoneyCard({
  label,
  totals,
  tone,
}: {
  readonly label: string;
  readonly totals: DrivingStats["earnedByCountry"];
  readonly tone: "earned" | "spent";
}) {
  return (
    <article className={`status-money-card ${tone}`}>
      <header>
        <span className="status-card-icon"><StatusGlyph path={WALLET_ICON} /></span>
        <span className="status-card-label">{label}</span>
      </header>
      <dl>
        {STATS_COUNTRY_ORDER.map((countryId) => {
          const country = getCountryProfile(countryId);
          return (
            <div key={countryId}>
              <dt>
                <span aria-hidden="true">{country.flagEmoji}</span>
                {country.countryName}
                <small>{country.currency.code}</small>
              </dt>
              <dd>{formatMoney(totals[countryId], country)}</dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}

function Odometer({ miles }: { readonly miles: string }) {
  return (
    <span className="status-odometer" aria-hidden="true">
      {Array.from(miles).map((character, index) =>
        /\d/.test(character) ? (
          <span className="status-odometer-digit" key={`${character}-${index}`}>
            {character}
          </span>
        ) : (
          <span className="status-odometer-separator" key={`${character}-${index}`}>
            {character}
          </span>
        ),
      )}
      <small>mi</small>
    </span>
  );
}

export function StatusView({
  freeDriveStats,
  career,
  initialMode,
}: {
  readonly freeDriveStats: DrivingStats;
  readonly career: CareerPersisted;
  readonly initialMode: StatusMode;
}) {
  const [mode, setMode] = useState<StatusMode>(initialMode);
  const careerAvailable = career !== null && career.state !== "corrupt";
  const stats =
    mode === "free"
      ? freeDriveStats
      : careerAvailable
        ? careerStatusStats(career)
        : createEmptyDrivingStats();
  const miles = milesFormatter.format(stats.distanceDrivenM / 1609.344);

  return (
    <section className="status-page subpage" aria-labelledby="status-title">
      <div className="status-heading">
        <p className="eyebrow">YOUR ROAD SO FAR</p>
        <h1 id="status-title">The city keeps <em>score</em></h1>
        <div className="mode-toggle status-mode-toggle" role="group" aria-label="Status mode">
          <button
            type="button"
            className={mode === "career" ? "active" : ""}
            aria-pressed={mode === "career"}
            onClick={() => setMode("career")}
          >
            Career
          </button>
          <button
            type="button"
            className={mode === "free" ? "active" : ""}
            aria-pressed={mode === "free"}
            onClick={() => setMode("free")}
          >
            Free drive
          </button>
        </div>
        {mode === "career" && !careerAvailable && (
          <p className="status-empty-note">
            {career?.state === "corrupt"
              ? "Career statistics are unavailable until the damaged career is reset."
              : "Start a career to build your stats."}
          </p>
        )}
      </div>

      <div className="status-dashboard">
        <article className="status-mileage-card">
          <header>
            <span className="status-card-icon"><StatusGlyph path={ODOMETER_ICON} /></span>
            <span className="status-card-label">Miles driven</span>
          </header>
          <div className="status-mileage-value" aria-label={`${miles} miles driven`}>
            <Odometer miles={miles} />
          </div>
          <svg className="status-route-line" viewBox="0 0 560 140" aria-hidden="true">
            <path d="M18 110 C120 110 108 34 214 48 S330 142 408 87 S486 30 542 42" />
            <circle cx="18" cy="110" r="7" />
            <circle cx="542" cy="42" r="7" />
          </svg>
          <p>
            {mode === "career"
              ? "Across every settled career shift"
              : "Across every free drive"}
          </p>
        </article>

        <div className="status-count-grid">
          <CountCard label="Deliveries" value={stats.deliveriesCompleted} icon={PARCEL_ICON} />
          <CountCard label="Rideshares" value={stats.ridesharesCompleted} icon={RIDER_ICON} />
          <CountCard label="Tickets" value={stats.trafficCitations} icon={TICKET_ICON} tone="coral" />
        </div>

        <div className="status-money-grid">
          <MoneyCard label="Money earned" totals={stats.earnedByCountry} tone="earned" />
          <MoneyCard label="Money spent" totals={stats.spentByCountry} tone="spent" />
        </div>
      </div>
    </section>
  );
}
