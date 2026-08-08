"use client";

// The drive screen: the GameCanvas mount, the desktop/touch HUD clusters,
// offer/dispatch/fine toasts, the service prompt at a pump or repair bay,
// the pause overlay, the map, and the end-day confirmation. Props-pure —
// large by necessity (75 props), which the plan for this extraction called
// "acceptable and honest" rather than force a smaller surface through an
// artificial grouping. Owns the one `dynamic(() => import("./game/GameCanvas"))`
// literal now — it was SideSwapApp.tsx's before this extraction, and
// `tests/architecture.test.ts` was updated to look for it here instead,
// since this is GameCanvas's only remaining mount point.

import dynamic from "next/dynamic";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { formatMoney } from "./game/economyTables";
import { formatClock } from "./CareerViews";
import type {
  CutsceneRequest,
  DriveScenario,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/sessionContract";
import type {
  CameraMode,
  CountryProfile,
  DestinationProfile,
  MapPack,
  PlayerProgressV2,
  SpeedUnit,
  SteeringSide,
} from "./game/types";
import type { CareerVehicleSpec } from "./game/career";
import type { Gig } from "./game/gigs";
import type { GpsPoint, GpsRoute } from "./game/gpsRoute";
import type { SurgeWindow } from "./game/dispatch";
import { DRIVE_LAYER } from "./game/driveLayers";
import { rearViewCssRect } from "./game/cockpitLayout";
import {
  TOUCH_MINIMAP_PX,
  TOUCH_PEDAL_ROW_PX,
  TOUCH_TOP_RAIL_PX,
} from "./game/TouchDriveControls";
import { ExpandedMap } from "./game/ExpandedMap";
import { Minimap } from "./game/MinimapCanvas";
import type { MapDestination } from "./game/minimapDraw";
import type { MapPoi } from "./game/mapPoi";
import {
  DriveCornerButton,
  DriveDayEdge,
  DriveMoneyCluster,
  DriveNavCard,
  DriveOfferBar,
  DriveOfferCard,
  OFFER_TOP_OFFSET_PX,
  DriveOfferGlow,
  DriveSpeedCluster,
  DriveSurgeBanner,
  DriveToast,
  HUD_CORAL,
  HUD_GOLD,
  HUD_SAGE,
} from "./game/DriveHud";
import type {
  DriveMoneyClusterButton,
  HudDayTimer,
  HudGauge,
  HudJob,
  HudManoeuvre,
  HudOffer,
} from "./game/DriveHud";
import { MAP_ICON, MUSIC_ICON, MUSIC_MUTED_ICON } from "./game/hudIcons";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CareerRun, ServicePromptAction } from "./SideSwapApp";

const GameCanvas = dynamic(() => import("./game/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="game-loading" role="status">
      Building roads, traffic and your cockpit…
    </div>
  ),
});

/** "kmh" is the canonical unit everywhere except the HUD's own display text. */
const formatSpeedUnit = (unit: SpeedUnit): string =>
  unit === "kmh" ? "km/h" : unit;

/** How each dispatch outcome reads: taken, paid, passed over, or lost. */
const DISPATCH_TOAST_COLOR = {
  accept: HUD_SAGE,
  paid: HUD_GOLD,
  pass: "rgba(244,239,222,.55)",
  lost: HUD_CORAL,
} as const;

export function DriveScreen({
  camera,
  carCondition,
  careerRun,
  cutscene,
  dayCash,
  dayRemainingMs,
  dispatchToast,
  driveElapsedMs,
  driveFuel,
  fineToast,
  gpsRoute,
  hud,
  mapOpen,
  offer,
  paused,
  payoutGain,
  pendingConfirm,
  previewRoute,
  progress,
  queuedGig,
  sessionEarnings,
  surge,
  touchFirst,
  towFee,
  towing,
  towResetNonce,
  viewportHeight,
  viewportWidth,
  setCamera,
  setMapOpen,
  setPaused,
  setPendingConfirm,
  activeSteeringSide,
  answerOffer,
  careerVehicle,
  cutsceneCaption,
  dayIntroElapsedMs,
  dayTimer,
  dayTimerInRow,
  detourLabel,
  driveCountry,
  driveDestination,
  exitDrive,
  finishCareerDayExit,
  gigStopCarrying,
  gigStopId,
  handleGameEvent,
  handleHud,
  hudInset,
  hudOffer,
  hudScale,
  mapDestination,
  mapPois,
  mapVisible,
  minimapPois,
  minimapRoute,
  moneyClusterButtons,
  musicMuted,
  navGauges,
  navJob,
  navManoeuvre,
  promptActions,
  promptEnterAct,
  promptKind,
  refuel,
  riderVenueId,
  runtimeScenario,
  runtimeMap,
  splitPrompt,
  tankCapacityL,
  themeStyle,
  toggleMusicMuted,
  touchOfferSlotPx,
  walletHere,
}: {
  camera: CameraMode;
  carCondition: number;
  careerRun: CareerRun | null;
  cutscene: CutsceneRequest | null;
  dayCash: number;
  dayRemainingMs: number;
  dispatchToast: { readonly text: string; readonly tone: "accept" | "pass" | "lost" | "paid" } | null;
  driveElapsedMs: number;
  driveFuel: number;
  fineToast: { readonly amount: number; readonly reason: string; readonly issuedBy: "patrol" | "camera" } | null;
  gpsRoute: GpsRoute | null;
  hud: GameHudSnapshot | null;
  mapOpen: boolean;
  offer: { readonly gig: Gig; readonly offeredAtMs: number } | null;
  paused: boolean;
  payoutGain: string | null;
  pendingConfirm: "end-day" | "abandon-career" | "buy-ticket" | null;
  previewRoute: GpsRoute | null;
  progress: PlayerProgressV2;
  queuedGig: Gig | null;
  sessionEarnings: number;
  surge: SurgeWindow | null;
  touchFirst: boolean;
  towFee: number;
  towing: boolean;
  towResetNonce: number;
  viewportHeight: number;
  viewportWidth: number;
  setCamera: (camera: CameraMode) => void;
  setMapOpen: Dispatch<SetStateAction<boolean>>;
  setPaused: (paused: boolean) => void;
  setPendingConfirm: (value: "end-day" | "abandon-career" | "buy-ticket" | null) => void;
  activeSteeringSide: SteeringSide;
  answerOffer: (accepted: boolean) => void;
  careerVehicle: CareerVehicleSpec | null;
  cutsceneCaption: string | null;
  dayIntroElapsedMs: number | null;
  dayTimer: HudDayTimer | null;
  dayTimerInRow: boolean;
  detourLabel: string | null;
  driveCountry: CountryProfile;
  driveDestination: DestinationProfile;
  exitDrive: () => void;
  finishCareerDayExit: () => void;
  gigStopCarrying: boolean;
  gigStopId: string | null;
  handleGameEvent: (event: GameRuntimeEvent) => void;
  handleHud: (snapshot: GameHudSnapshot) => void;
  hudInset: { readonly top: string; readonly left: string; readonly right: string };
  hudOffer: HudOffer | null;
  hudScale: number;
  mapDestination: MapDestination | null;
  mapPois: readonly MapPoi[];
  mapVisible: boolean;
  minimapPois: readonly MapPoi[];
  minimapRoute: readonly GpsPoint[] | undefined;
  moneyClusterButtons: readonly DriveMoneyClusterButton[];
  musicMuted: boolean;
  navGauges: readonly HudGauge[];
  navJob: HudJob | null;
  navManoeuvre: HudManoeuvre | null;
  promptActions: readonly ServicePromptAction[];
  promptEnterAct: () => void;
  promptKind: "refuel" | "repair" | null;
  refuel: () => void;
  riderVenueId: string | null;
  runtimeScenario: DriveScenario;
  runtimeMap: MapPack;
  splitPrompt: boolean;
  tankCapacityL: number;
  themeStyle: CSSProperties;
  toggleMusicMuted: () => void;
  touchOfferSlotPx: number;
  walletHere: number;
}) {
    return (
      <main className="game-page" style={themeStyle}>
        <GameCanvas
          key={`${driveDestination.id}-${runtimeScenario.id}-${activeSteeringSide}${
            careerRun ? `-${careerRun.vehicleId}` : ""
          }`}
          className="game-canvas"
          trafficSide={driveCountry.trafficSide}
          steeringSide={activeSteeringSide}
          scenario={runtimeScenario}
          mapPack={runtimeMap}
          cameraMode={camera}
          speedUnit={driveCountry.speedUnit}
          paused={paused}
          reducedMotion={progress.accessibility.reducedMotion}
          steeringSensitivity={progress.accessibility.steeringSensitivity}
          fieldOfView={(progress.accessibility.fieldOfView * Math.PI) / 180}
          masterVolume={progress.accessibility.masterVolume}
          effectsVolume={progress.accessibility.effectsVolume}
          cameraShake={progress.accessibility.cameraShake}
          headBob={progress.accessibility.headBob}
          outOfFuel={tankCapacityL > 0 && driveFuel <= 0}
          playerVehicle={
            careerVehicle
              ? {
                  model: careerVehicle.model,
                  visualKind: careerVehicle.visualKind,
                }
              : null
          }
          vehiclePhysics={careerVehicle ? careerVehicle.physics : null}
          carConditionPct={carCondition}
          resetNonce={towResetNonce}
          riderVenueId={riderVenueId}
          gigStopId={gigStopId}
          gigStopCarrying={gigStopCarrying}
          cutscene={cutscene}
          onHudUpdate={handleHud}
          onEvent={handleGameEvent}
          onPauseChange={setPaused}
          onCameraChange={setCamera}
          onExit={exitDrive}
        />
        {/*
          Cheap contrast insurance. Every HUD element is cream-on-glass, and a
          midday sky or a white building fills the top band with exactly the
          value the text is — so the corners and the two HUD bands get darkened
          and the middle of the road, where the player is actually looking, is
          left alone.
        */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: DRIVE_LAYER.scrim,
            background:
              "linear-gradient(180deg, rgba(9,13,15,.42), transparent 22%, transparent 74%, rgba(9,13,15,.44))," +
              "radial-gradient(120% 110% at 50% 45%, transparent 52%, rgba(5,8,9,.42))",
          }}
        />
        {/*
          The rear-view mirror's housing.

          The reflection itself is not a texture on a mesh — it is a second
          camera rendered into a fixed strip of the canvas. That makes it
          screen-space, so its surround has to be screen-space too: a 3D housing
          hung in the cabin would swing away from its own reflection the moment
          the player glanced left. Both read their rectangle from
          rearViewCssRect, so the frame cannot drift off the glass.

          box-sizing keeps the border outside the reflection: the content box is
          the viewport rectangle exactly, and the housing grows outward from it.
        */}
        {hud?.rearViewVisible && (
          <div
            aria-hidden="true"
            data-testid="rear-view-housing"
            style={{
              position: "absolute",
              boxSizing: "border-box",
              left: `calc(${rearViewCssRect().leftPercent}% - 9px)`,
              top: `calc(${rearViewCssRect().topPercent}% - 8px)`,
              width: `calc(${rearViewCssRect().widthPercent}% + 18px)`,
              height: `calc(${rearViewCssRect().heightPercent}% + 16px)`,
              border: "8px solid #2b2724",
              borderBottomWidth: "10px",
              borderRadius: "14px",
              boxShadow:
                "0 10px 22px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.6)," +
                "inset 0 2px 5px rgba(0,0,0,0.75)",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.hud,
            }}
          />
        )}
        {careerRun && dayIntroElapsedMs !== null && dayIntroElapsedMs < 2600 && hud && (
          <div
            aria-hidden="true"
            data-testid="day-title"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            <div
              style={{
                textAlign: "center",
                color: "#f4f6f8",
                textShadow: "0 4px 24px rgba(0,0,0,0.55)",
                opacity: progress.accessibility.reducedMotion
                  ? 1
                  : Math.min(1, (2600 - dayIntroElapsedMs) / 600),
              }}
            >
              <div
                style={{
                  font: "800 3.2rem/1 system-ui, sans-serif",
                  letterSpacing: "0.12em",
                }}
              >
                DAY {careerRun.city.day}
              </div>
              <div
                style={{
                  font: "600 1rem/1.6 system-ui, sans-serif",
                  opacity: 0.8,
                }}
              >
                {driveDestination.destinationName}
                {hud.scenarioClock ? ` · ${hud.scenarioClock}` : ""}
              </div>
            </div>
          </div>
        )}
        {cutsceneCaption && (
          <div
            role="status"
            style={{
              position: "absolute",
              left: "50%",
              // Bottom-centre is inside the steering region on touch, and a
              // knob track can reach 80px either side of the thumb.
              ...(touchFirst
                ? { top: `calc(${hudInset.top} + 3.4rem)` }
                : { bottom: "1.4rem" }),
              transform: "translateX(-50%)",
              padding: "0.55rem 1.2rem",
              borderRadius: "999px",
              background: "rgba(15, 18, 22, 0.78)",
              backdropFilter: "blur(10px)",
              color: "#f4f6f8",
              font: "600 0.95rem/1.2 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            {cutsceneCaption}
          </div>
        )}
        {fineToast && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: "1.25rem",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              background: "rgba(150, 24, 28, 0.92)",
              color: "#fff",
              font: "700 0.95rem/1.2 system-ui, sans-serif",
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
              zIndex: DRIVE_LAYER.toast,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span aria-hidden="true">
              {fineToast.issuedBy === "camera" ? "📷" : "🚓"}
            </span>
            <span>
              {fineToast.issuedBy === "camera" ? "Camera fined" : "Fined"}{" "}
              {formatMoney(fineToast.amount, driveCountry)} for{" "}
              {fineToast.reason}
            </span>
          </div>
        )}
        {dispatchToast && (
          <DriveToast
            scale={hudScale}
            inset={{
              top: `calc(${hudInset.top} + ${touchFirst ? 12.5 : 9}rem)`,
              right: touchFirst ? "auto" : hudInset.right,
            }}
            tone={DISPATCH_TOAST_COLOR[dispatchToast.tone]}
            testId="dispatch-toast"
          >
            {dispatchToast.text}
          </DriveToast>
        )}
        {/*
          Both placements stand down while the whole-city map is up: the offer
          docks into the map's own column instead, so there is never a card
          floating over a centred panel (#241). `ExpandedMap` renders the same
          `gig-offer` card, so exactly one is on screen either way.
        */}
        {hudOffer && !mapVisible && touchFirst && (
          <DriveOfferBar
            inset={{
              top: `calc(${hudInset.top} + ${TOUCH_TOP_RAIL_PX}px)`,
              right: hudInset.right,
            }}
            offer={hudOffer}
            width={TOUCH_PEDAL_ROW_PX}
            slotHeight={touchOfferSlotPx}
            onAccept={() => answerOffer(true)}
            onPass={() => answerOffer(false)}
          />
        )}
        {hudOffer && !mapVisible && !touchFirst && (
          <>
            <DriveOfferGlow />
            <DriveOfferCard
              scale={hudScale}
              inset={{
                top: `calc(${hudInset.top} + ${Math.round(OFFER_TOP_OFFSET_PX * hudScale)}px)`,
                right: hudInset.right,
              }}
              offer={hudOffer}
              acceptKey="F"
              passKey="G"
              onAccept={() => answerOffer(true)}
              onPass={() => answerOffer(false)}
            />
          </>
        )}
        {surge && (
          <DriveSurgeBanner
            scale={hudScale}
            inset={{ top: `calc(${hudInset.top} + ${touchFirst ? 3 : 7.2}rem)` }}
            multiplier={surge.multiplier}
            remaining={formatClock(Math.max(0, surge.endMs - driveElapsedMs))}
          />
        )}
        <DriveNavCard
          scale={hudScale}
          inset={{ top: hudInset.top, left: hudInset.left }}
          manoeuvre={navManoeuvre}
          job={navJob}
          idleLabel={
            offer ? "Offer waiting…" : "Waiting for a job…"
          }
          gauges={navGauges}
          compact={touchFirst}
          money={
            touchFirst
              ? {
                  balance: formatMoney(
                    careerRun ? dayCash : walletHere,
                    driveCountry,
                  ),
                  session: `+${formatMoney(sessionEarnings, driveCountry)}`,
                  sessionVisible: sessionEarnings !== 0,
                  // Normally just what the figure beside it means: the clock
                  // left this header for the top centre when the phone got the
                  // same readout the desktop has (#236). It comes back only on
                  // a handset too narrow to stand one there.
                  label:
                    careerRun && !dayTimerInRow
                      ? `DAY ${careerRun.city.day} · ${formatClock(dayRemainingMs)}`
                      : "TODAY",
                }
              : null
          }
          queued={
            queuedGig
              ? {
                  title: queuedGig.pickup.name,
                  pay: `+${formatMoney(queuedGig.reward, driveCountry)}`,
                }
              : null
          }
        />
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            background: "#0c0e11",
            color: "#f4f6f8",
            textAlign: "center",
            font: "700 1.25rem/1.35 system-ui, sans-serif",
            zIndex: DRIVE_LAYER.curtain,
            opacity: towing ? 1 : 0,
            pointerEvents: "none",
            transition: progress.accessibility.reducedMotion
              ? "none"
              : "opacity 0.4s ease",
          }}
        >
          {towing && (
            <>
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                🚧
              </span>
              <span>
                {careerVehicle && careerVehicle.visualKind !== "car"
                  ? "Your bike's wrecked."
                  : "Your car's a write-off."}
              </span>
              <span style={{ fontSize: "0.95rem", opacity: 0.75 }}>
                {careerVehicle && careerVehicle.visualKind !== "car"
                  ? "Fixed up kerbside — "
                  : "Towed & repaired — "}
                {formatMoney(towFee, driveCountry)}
              </span>
            </>
          )}
        </div>
        {promptKind && !cutscene && !towing && tankCapacityL > 0 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              ...(touchFirst
                ? { top: `calc(${hudInset.top} + 3.4rem)` }
                : { bottom: "1.4rem" }),
              transform: "translateX(-50%)",
              zIndex: DRIVE_LAYER.action,
            }}
          >
            {/*
              One pill when there is one way to pay, which is every case but a
              career pump the day's cash cannot cover. Two segments share a
              single dark shell rather than floating as two loose buttons: the
              choice is between two prices for the same errand, and the shell is
              what says so. The gold segment is the one that costs nothing but
              money you have; the credit one is deliberately not gold.
            */}
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: "0.25rem",
                padding: splitPrompt ? "0.25rem" : 0,
                borderRadius: "999px",
                background: splitPrompt ? "rgba(18,20,23,0.78)" : "transparent",
                border: splitPrompt
                  ? "1px solid rgba(244,239,222,0.12)"
                  : "none",
                boxShadow: splitPrompt ? "0 10px 28px rgba(0,0,0,0.34)" : "none",
                backdropFilter: splitPrompt ? "blur(10px)" : "none",
              }}
            >
              {promptActions.map((action, index) => {
                const credit = action.tone === "credit";
                return (
                  <button
                    key={action.testId}
                    type="button"
                    data-testid={action.testId}
                    // Entry 0 is always the Enter action and entry 1, when there
                    // is one, is always the borrow — the same two values the key
                    // handler above binds, so a click and a keypress can never
                    // drift apart.
                    onClick={index === 0 ? promptEnterAct : refuel}
                    disabled={!action.enabled}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      padding: "0.65rem 1.3rem",
                      borderRadius: "999px",
                      // The credit offer is tinted and outlined in the same
                      // coral its "on credit" note is written in. Left as a
                      // plain dark fill it was a near match for the disabled
                      // grey, so the one offer a broke driver *can* take read
                      // as the one thing they could not.
                      border:
                        action.enabled && credit
                          ? `1px solid ${HUD_CORAL}66`
                          : "1px solid transparent",
                      cursor: action.enabled ? "pointer" : "not-allowed",
                      background: !action.enabled
                        ? "rgba(60,64,70,0.85)"
                        : credit
                          ? `${HUD_CORAL}24`
                          : "#f2c658",
                      color: !action.enabled
                        ? "#f4f6f8"
                        : credit
                          ? "#f7e2dc"
                          : "#1a1c1f",
                      font: "700 1rem/1 system-ui, sans-serif",
                      backdropFilter: splitPrompt ? "none" : "blur(10px)",
                    }}
                  >
                    <span>{action.label}</span>
                    {/* The borrowed part, set apart from the price so the debt
                        is read rather than skimmed past. */}
                    {action.note && (
                      <span
                        style={{
                          font: "700 0.78rem/1 system-ui, sans-serif",
                          letterSpacing: "0.01em",
                          color: action.enabled ? HUD_CORAL : "#f4f6f8",
                          opacity: action.enabled ? 1 : 0.75,
                        }}
                      >
                        {action.note}
                      </span>
                    )}
                    {/* Only live while the action actually does something — same gate as the
                        Enter-key listener above. Touch has no keyboard to hint at. */}
                    {!touchFirst && action.enabled && (
                      <span
                        aria-hidden="true"
                        style={{
                          display: "grid",
                          placeItems: "center",
                          minWidth: action.hint === "ENTER" ? "2.3rem" : "1.5rem",
                          height: "1.35rem",
                          padding: "0 0.35rem",
                          borderRadius: 6,
                          background: credit
                            ? "rgba(12,13,15,0.34)"
                            : "rgba(26,28,31,0.18)",
                          font: "800 0.68rem/1 system-ui, sans-serif",
                          letterSpacing: "0.02em",
                          color: credit ? "#f4efde" : "#1a1c1f",
                        }}
                      >
                        {action.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/*
          Right edge, directly under the utility row. The pedals used to be a
          194px-tall stacked column, which owned that whole edge and pushed the
          map inboard beside them; abreast they are ~102px, so the strip between
          the button row and the pedals is free and the map gets the corner a
          driving game expects it in.
        */}
        {hud && (
          <Minimap
            worldSize={runtimeMap.geometry.worldSize}
            roadSurfaces={runtimeMap.geometry.roadSurfaces}
            waterBodies={runtimeMap.geometry.waterBodies}
            playerX={hud.playerX}
            playerZ={hud.playerZ}
            heading={hud.heading}
            destination={mapDestination}
            pois={minimapPois}
            route={minimapRoute}
            previewRoute={previewRoute ? previewRoute.points : undefined}
            previewLabel={touchFirst ? undefined : detourLabel ?? undefined}
            dimmed={touchFirst && hudOffer !== null}
            size={touchFirst ? TOUCH_MINIMAP_PX : Math.round(344 * hudScale)}
            anchorStyle={
              touchFirst
                ? {
                    right: hudInset.right,
                    top: `calc(${hudInset.top} + ${TOUCH_TOP_RAIL_PX}px)`,
                    bottom: "auto",
                  }
                : undefined
            }
          />
        )}
        {/*
          The "Visual honk cue" accessibility setting. It used to render inside
          GameCanvas's built-in HUD — which the app has always passed
          `showBuiltInHud={false}`, so the toggle in Settings has never done
          anything. Lives with the HUD that is actually on screen now.
        */}
        {hud?.honking && progress.accessibility.visualHonkIndicator && (
          <div
            role="status"
            data-testid="honk-cue"
            style={{
              position: "absolute",
              left: "50%",
              top: `calc(${hudInset.top} + 3.4rem)`,
              transform: "translateX(-50%)",
              padding: "0.4rem 0.85rem",
              borderRadius: "999px",
              background: "#f2c658",
              color: "#172226",
              font: "800 0.72rem/1 system-ui, sans-serif",
              letterSpacing: "0.08em",
              pointerEvents: "none",
              zIndex: DRIVE_LAYER.toast,
            }}
          >
            HORN
          </div>
        )}
        {/*
          Set on the view itself rather than in a panel. Speed is the one number
          read continuously and never deliberately looked at, so it is sized to
          be caught in peripheral vision and given a shadow instead of a plate —
          a pill here would be a second object between the player and the road.
        */}
        {hud && (
          <DriveSpeedCluster
            scale={hudScale}
            inset={{ top: hudInset.top }}
            speed={hud.speed}
            speedUnit={formatSpeedUnit(hud.speedUnit)}
            speedLimit={hud.speedLimit}
            gear={hud.gear}
            dayTimer={dayTimerInRow ? dayTimer : null}
            compact={touchFirst}
          />
        )}
        {/*
          The same clock again as a bar across the very top of the screen. Not
          redundancy: the numerals answer "how long", which you have to look up
          to read, and the bar answers "how far through", which you cannot help
          seeing. Outside the scaled frame, so it always spans the viewport.
        */}
        {hud && dayTimer && <DriveDayEdge timer={dayTimer} compact={touchFirst} />}
        {/*
          The two buttons the app owns on a phone, holding the top-right corner
          while the session's camera/pause/fullscreen row starts clear of them
          (`TOUCH_CORNER_RAIL_PX`). On touch there is no M, so the map control
          is the only way in.
        */}
        {touchFirst && (
          <>
            <DriveCornerButton
              inset={{ top: hudInset.top, right: hudInset.right }}
              icon={MUSIC_ICON}
              activeIcon={MUSIC_MUTED_ICON}
              label={musicMuted ? "Unmute music" : "Mute music"}
              pressed={musicMuted}
              onPress={toggleMusicMuted}
            />
            <DriveCornerButton
              inset={{ top: hudInset.top, right: hudInset.right }}
              slot={1}
              icon={MAP_ICON}
              label={mapOpen ? "Close the city map" : "Open the city map"}
              pressed={mapOpen}
              onPress={() => setMapOpen((open) => !open)}
            />
          </>
        )}
        {!touchFirst && (
        <DriveMoneyCluster
          scale={hudScale}
          inset={{ top: hudInset.top, right: hudInset.right }}
          balance={formatMoney(careerRun ? dayCash : walletHere, driveCountry)}
          balanceLabel={careerRun ? "Cash today" : "Wallet"}
          session={`+${formatMoney(sessionEarnings, driveCountry)}`}
          sessionLabel="TODAY"
          sessionVisible={sessionEarnings !== 0}
          gain={payoutGain}
          compact={touchFirst}
          buttons={moneyClusterButtons}
        />
        )}
        {hud && (
          <div className="sr-only" aria-live="polite">
            Speed {hud.speed} {formatSpeedUnit(hud.speedUnit)}, gear {hud.gear}.
          </div>
        )}
        {/*
          The clock itself is inside the speed cluster, which is `aria-hidden`
          — speed is announced from here too rather than read off a readout
          that changes eleven times a second. `announcement` is deliberately
          coarse for the same reason: it settles to whole minutes, so this
          region speaks about once a minute instead of continuously.
        */}
        {dayTimer && (
          <div className="sr-only" aria-live="polite">
            {dayTimer.announcement}
          </div>
        )}
        {/*
          Last of the drive overlays, so it paints over the HUD it is meant to
          replace for as long as it is up. The live offer is the one thing that
          still shows over it, and it does that by sitting a layer higher; the
          pause screen outranks it by closing it — see `mapVisible`.
        */}
        {mapVisible && hud && (
          <ExpandedMap
            cityName={driveDestination.destinationName}
            subtitle={navJob ? `${navJob.eyebrow} · ${navJob.target}` : null}
            worldSize={runtimeMap.geometry.worldSize}
            roadSurfaces={runtimeMap.geometry.roadSurfaces}
            waterBodies={runtimeMap.geometry.waterBodies}
            pois={mapPois}
            destination={mapDestination}
            // The whole line, not the remainder the corner widget draws: the
            // question this view answers is what the journey looks like.
            route={gpsRoute ? gpsRoute.points : undefined}
            previewRoute={previewRoute ? previewRoute.points : undefined}
            playerX={hud.playerX}
            playerZ={hud.playerZ}
            heading={hud.heading}
            viewport={{ width: viewportWidth, height: viewportHeight }}
            showKeyHints={!touchFirst}
            // The card the HUD would otherwise float, docked in the column
            // beside the dashed detour `previewRoute` draws to its pickup.
            dockedOffer={
              hudOffer && {
                offer: hudOffer,
                onAccept: () => answerOffer(true),
                onPass: () => answerOffer(false),
              }
            }
            onClose={() => setMapOpen(false)}
          />
        )}
        {pendingConfirm === "end-day" && (
          <ConfirmDialog
            title="End the day early?"
            body="Today's progress is discarded and the day restarts from the garage."
            cancelLabel="Keep driving"
            confirmLabel="End day"
            onCancel={() => setPendingConfirm(null)}
            onConfirm={finishCareerDayExit}
          />
        )}
      </main>
    );
}
