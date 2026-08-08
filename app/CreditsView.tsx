"use client";

// The sources & credits page: map-data provenance and every official rule
// reference, grouped by country. Props-pure.

import { COUNTRY_PROFILES } from "./game/content";

export function CreditsView({ onBack }: { onBack: () => void }) {
  const references = Array.from(new Map(COUNTRY_PROFILES.flatMap((country) => country.officialReferences).map((reference) => [reference.id, reference])).values());
  const extracts = [
    ["New York", "nyc-upper-west.json"],
    ["London — Kensington to the City", "uk-london-south-kensington.json"],
    ["Tokyo Setagaya", "jp-setagaya.json"],
    ["Cairo — Central Nile", "eg-cairo-central-nile.json"],
  ] as const;
  return (
    <section className="subpage credits-page">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">SOURCES &amp; CREDITS</p>
          <h1>Rules should have receipts.</h1>
          <p>Every assessed rule is tied to an official source and review date. OpenStreetMap supplies geography only.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to Homepage</button>
      </div>
      <article className="license-card">
        <h3 className="credits-section-title"><span className="settings-card-dot dot-sage" aria-hidden="true" />Map data — frozen, credited, separate from the law</h3>
        <p>Curbside Rush includes compact snapshots for Upper West Side, South Kensington, Setagaya and Central Cairo. Each extract records its bounds, freeze timestamp, source and content checksums, and importer version. The game makes no runtime map requests.</p>
        <div className="map-downloads" aria-label="Download frozen map extracts">
          {extracts.map(([label, filename]) => (
            <a key={filename} href={`/map-data/${filename}`} download>
              <span className="map-glyph" aria-hidden="true">{"{ }"}</span>
              <span className="map-copy"><strong>{label}</strong><small>JSON · importer v2</small></span>
            </a>
          ))}
        </div>
        <a className="osm-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL 1.0 ↗</a>
      </article>
      <h3 className="credits-section-title with-count">
        <span className="settings-card-dot dot-yellow" aria-hidden="true" />Rule sources
        <span className="credits-count">· {references.length} official references</span>
      </h3>
      <div className="source-groups">
        {COUNTRY_PROFILES.map((country) => (
          <section className="source-group" key={country.id}>
            <div className="source-group-head"><span className="flag">{country.flagEmoji}</span> {country.countryName}</div>
            {country.officialReferences.map((reference) => (
              <a className="source-row" key={reference.id} href={reference.url} target="_blank" rel="noreferrer">
                <span className="source-row-copy">
                  <span className="source-juris">{reference.jurisdiction}</span>
                  <strong>{reference.title}</strong>
                  <small>{reference.authority} · reviewed {reference.reviewedOn}</small>
                </span>
                <b className="source-arrow" aria-hidden="true">↗</b>
              </a>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
