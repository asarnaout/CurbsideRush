"use client";

// The landing screen: mode toggle, destination picker (free drive) or the
// career setup panel, the hero preview, and the legal/build-ref footer.
// Props-pure — everything it reads is threaded in, so tests render the app
// shell and interact with this screen exactly as a player would.

import type { MutableRefObject } from "react";
import type {
  CountryProfile,
  DestinationId,
  DestinationProfile,
  PlayerProgressV2,
} from "./game/types";
import type { CareerCityView, CareerVehicleId } from "./game/career";
import { CAREER_START_CITY, careerCountryOf, garageDefaultVehicle } from "./game/career";
import { DESTINATION_PROFILES, getCountryProfile, getDestinationProfile } from "./game/content";
import { CareerSetupPanel } from "./CareerViews";
import { MobilePlayTips } from "./MobilePlayTips";
import type { View } from "./SideSwapApp";

export const DESTINATION_PREVIEW_IMAGES: Record<DestinationId, string> = {
  "uk-london": "/landing/london.webp",
  "us-nyc": "/landing/nyc.webp",
  "jp-tokyo": "/landing/tokyo.webp",
  "eg-cairo": "/landing/cairo.webp",
};

// Horizontal focus for the cover-cropped preview, for a city whose subject sits
// off-centre. Anything absent takes the default `center`.
const DESTINATION_PREVIEW_FOCUS: Partial<Record<DestinationId, string>> = {
  "eg-cairo": "30% center",
};

/**
 * Short commit ref of the running build, frozen in by `vite.config.ts` from
 * Netlify's `COMMIT_REF`. `"dev"` locally. Declared rather than imported
 * because it is a compile-time `define`, not a module.
 */
declare const __BUILD_REF__: string;
const BUILD_REF: string =
  typeof __BUILD_REF__ === "string" ? __BUILD_REF__ : "dev";

export function LauncherView({
  destinationId,
  gameMode,
  needsHomeScreenForFullscreen,
  progress,
  touchFirst,
  setGameMode,
  setView,
  destinationRefs,
  beginDrive,
  careerCity,
  careerCountry,
  careerLauncherDestinationId,
  chooseDestination,
  commitGarageVehicle,
  destination,
  garageVehicleId,
  launcherCountry,
  launcherDestination,
  resetCareer,
  startCareer,
}: {
  destinationId: DestinationId;
  gameMode: "free" | "career";
  needsHomeScreenForFullscreen: boolean;
  progress: PlayerProgressV2;
  touchFirst: boolean;
  setGameMode: (mode: "free" | "career") => void;
  setView: (view: View) => void;
  destinationRefs: MutableRefObject<Map<DestinationId, HTMLButtonElement>>;
  beginDrive: (destinationId: DestinationId) => void;
  careerCity: CareerCityView | null;
  careerCountry: CountryProfile | null;
  careerLauncherDestinationId: DestinationId;
  chooseDestination: (id: DestinationId) => void;
  commitGarageVehicle: (vehicleId: CareerVehicleId, base?: PlayerProgressV2) => void;
  destination: DestinationProfile;
  garageVehicleId: CareerVehicleId;
  launcherCountry: CountryProfile;
  launcherDestination: DestinationProfile;
  resetCareer: (nextView?: View) => void;
  startCareer: () => void;
}) {
  return (
    <section className="launcher-page">
      <div className="launcher-copy">
        <p className="eyebrow">READY TO EARN</p>
        <h1 aria-label="Rise and Grind">
          <>Rise and <em>Grind</em></>
        </h1>

        <div className="mode-toggle" role="group" aria-label="Game mode">
          {(
            [
              ["free", "Free drive"],
              ["career", "Career"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={gameMode === mode ? "active" : ""}
              data-testid={`mode-${mode}`}
              aria-pressed={gameMode === mode}
              onClick={() => setGameMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        {gameMode === "free" && (
        <>
        <p className="launcher-pick-label">Choose a city</p>
        <div
          className="launcher-destinations"
          role="group"
          aria-label="Destination"
        >
          {DESTINATION_PROFILES.map((item) => {
            const itemCountry = getCountryProfile(item.countryId);
            return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) destinationRefs.current.set(item.id, node);
                else destinationRefs.current.delete(item.id);
              }}
              type="button"
              className={`${destinationId === item.id ? "active" : ""} ${item.promotion}`}
              aria-label={`${item.destinationName}. ${item.destinationSubtitle}`}
              aria-pressed={destinationId === item.id}
              onClick={() => chooseDestination(item.id)}
            >
              <span>{itemCountry.flagEmoji}</span>
              <strong>{item.destinationName}</strong>
              <small>{item.destinationSubtitle}</small>
            </button>
            );
          })}
        </div>
        </>
        )}

        {gameMode === "free" ? (
          <div className="launcher-actions">
            <button
              className="primary-button launcher-primary"
              type="button"
              aria-label={`Start driving in ${destination.destinationName}`}
              onClick={() => beginDrive(destination.id)}
            >
              Start driving
              <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <CareerSetupPanel
            career={progress.career}
            city={careerCity}
            cityName={
              getDestinationProfile(careerLauncherDestinationId)
                .destinationName
            }
            country={
              careerCountry ??
              getCountryProfile(careerCountryOf(CAREER_START_CITY))
            }
            onStartCareer={startCareer}
            onContinue={() => {
              // The one entry that reaches the garage across a reload, so
              // it is where the remembered ride gets re-priced: a career
              // resumed after a bad night may no longer afford what it was
              // last showing.
              if (careerCity) {
                commitGarageVehicle(
                  garageDefaultVehicle(careerCity, garageVehicleId),
                );
              }
              setView("career-garage");
            }}
            onResetCorrupt={() => resetCareer("launcher")}
          />
        )}
        {/* Before the drive, not after: on iPhone neither the rotate gate
            nor the browser chrome can be removed by code, so the only
            honest move is to say so where it can still be acted on. */}
        {touchFirst && (
          <MobilePlayTips needsHomeScreen={needsHomeScreenForFullscreen} />
        )}
      </div>

      <div
        className="launcher-road-visual"
        aria-label={`${launcherDestination.destinationName} driving preview`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static preview art in /public; next/image adds no value for a fixed, non-critical hero */}
        <img
          className="launcher-photo"
          src={DESTINATION_PREVIEW_IMAGES[launcherDestination.id]}
          style={{
            objectPosition: DESTINATION_PREVIEW_FOCUS[launcherDestination.id],
          }}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <div className="launcher-place">
          <span>{launcherCountry.flagEmoji} {launcherCountry.countryName}</span>
          <strong>{launcherDestination.destinationName}</strong>
          <em>{launcherDestination.destinationSubtitle}</em>
          <small>Keeps {launcherCountry.trafficSide}</small>
        </div>
      </div>
      <p className="launcher-legal">
        For entertainment—not legal advice or driver instruction. Map data © OpenStreetMap contributors.{" "}
        {/* Which build you are actually looking at. Mobile Safari will
            happily keep serving a cached page long after a deploy, and
            without this there is no way to tell that apart from the deploy
            having failed. */}
        <span data-testid="build-ref" style={{ opacity: 0.55 }}>
          build {BUILD_REF}
        </span>
      </p>
    </section>
  );
}
