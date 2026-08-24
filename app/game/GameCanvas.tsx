"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BabylonGameSession,
  type LoadProgress,
  type SessionCallbacks,
} from "./render/babylonGameSession";
import type { DebugBuildingAssetPolicy } from "./render/buildingLayer";
import {
  type AdaptiveInputPresentation,
  createInitialInputPresentation,
} from "./adaptiveInputRouter";
import {
  clampHorizontalFieldOfView,
  DEFAULT_HORIZONTAL_FOV,
} from "./render/renderConstants";
import { DRIVE_LAYER } from "./driveLayers";
import { INPUT_GUIDANCE } from "./inputGuidance";
import { TouchDriveControls } from "./TouchDriveControls";
import {
  readInputCapabilities,
  type InputCapabilities,
} from "./pointerCapabilities";
import {
  canFullscreen,
  exitFullscreen,
  isFullscreen,
  isStandaloneDisplay,
  onFullscreenChange,
  requestImmersiveLandscape,
} from "./viewportSetup";
import {
  assertArabicCanvasFontDebug,
  ensureArabicCanvasFontLoaded,
  inspectArabicCanvasFont,
} from "./arabicFont";
import type {
  CameraMode,
  CutsceneRequest,
  DriveScenario,
  GameCanvasMapPack,
  GameHudSnapshot,
  GameRuntimeEvent,
  PlayerVehicleOption,
  PlayerVehiclePhysics,
  SpeedUnit,
  SteeringSide,
  TrafficSide,
} from "./sessionContract";

export interface GameCanvasProps {
  trafficSide: TrafficSide;
  steeringSide: SteeringSide;
  /** Reproducible inputs for this authored, non-terminating drive. */
  scenario: DriveScenario;
  /** Selected authored map. */
  mapPack: GameCanvasMapPack;
  cameraMode?: CameraMode;
  speedUnit?: SpeedUnit;
  paused?: boolean;
  reducedMotion?: boolean;
  steeringSensitivity?: number;
  fieldOfView?: number;
  masterVolume?: number;
  effectsVolume?: number;
  cameraShake?: boolean;
  headBob?: boolean;
  /** When true (out of fuel), the throttle is held at zero. */
  outOfFuel?: boolean;
  /** Car condition 0..100 (app-owned damage state); drives the hood smoke. */
  carConditionPct?: number;
  /** Bump to snap the car back to its spawn (the tow-and-repair flow). */
  resetNonce?: number;
  /** Venue id where a passenger is waiting to be collected, else null. */
  riderVenueId?: string | null;
  /** Stop the active gig is currently heading for, else null. */
  gigStopId?: string | null;
  /** True once the parcel/rider is aboard, so the marker reads as a drop-off. */
  gigStopCarrying?: boolean;
  /** Interaction cutscene to play; controls lock until its `done` event. */
  cutscene?: CutsceneRequest | null;
  /**
   * The vehicle the player takes out (career). Constructor-only: changing it
   * requires a remount (the career key includes the vehicle id). Omitted =
   * the free-drive flagship. A null model means the composed bicycle rig
   * (playable in a later phase).
   */
  playerVehicle?: PlayerVehicleOption | null;
  /** Per-vehicle physics spread over the adapter's sim config. Constructor-only. */
  vehiclePhysics?: PlayerVehiclePhysics | null;
  className?: string;
  style?: CSSProperties;
  onHudUpdate?: (snapshot: GameHudSnapshot) => void;
  onEvent?: (event: GameRuntimeEvent) => void;
  onPauseChange?: (paused: boolean) => void;
  onCameraChange?: (mode: CameraMode) => void;
  /** Called when the player chooses Exit from the pause dialog. */
  onExit?: () => void;
  /**
   * Test/development-only forced-unavailable building-asset policy — see
   * `render/buildingLayer.ts`'s `DebugBuildingAssetPolicy`. Never set by
   * `DriveScreen.tsx`/`SideSwapApp.tsx`; exists so a NullEngine test can
   * exercise the per-entry proxy/failure path deterministically, without
   * relying on an incidental network failure.
   */
  debugBuildingAssetPolicy?: DebugBuildingAssetPolicy;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const LOADING_MODELS_LABEL = "Loading models…";

// No `isolation: "isolate"` here, deliberately. It would make this subtree an
// atomic stacking context at the shell's own level, so no z-index inside could
// ever rise above a HUD sibling rendered by SideSwapApp — which is exactly how
// the touch controls ended up painted under the wallet card and the minimap.
// Layering across both files goes through DRIVE_LAYER instead.
// No `minHeight` either. A landscape phone viewport is about 393px tall, so a
// 420px floor made the shell taller than the page that clips it — and the
// bottom of the shell is exactly where the pedals and the steering region are
// anchored.
const shellStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  borderRadius: 24,
  background: "#172226",
  color: "#f6f2e7",
};

const canvasStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  outline: "none",
  touchAction: "none",
};

const glassPanelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(12,20,23,.6)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px rgba(0,0,0,.35)",
  backdropFilter: "blur(14px) saturate(1.2)",
};

const actionButtonStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(12,20,23,.72)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09)",
  backdropFilter: "blur(10px)",
  color: "#fff9ea",
  font: "700 12px/1 system-ui, sans-serif",
  letterSpacing: ".03em",
  touchAction: "none",
  userSelect: "none",
};

export function GameCanvas({
      trafficSide,
      steeringSide,
      scenario,
      mapPack,
      cameraMode = "third_person",
      speedUnit = "mph",
      paused = false,
      reducedMotion = false,
      steeringSensitivity = 1,
      fieldOfView = DEFAULT_HORIZONTAL_FOV,
      masterVolume = 0.75,
      effectsVolume = 0.75,
      cameraShake = false,
      headBob = false,
      outOfFuel = false,
      carConditionPct = 100,
      resetNonce = 0,
      riderVenueId = null,
      gigStopId = null,
      gigStopCarrying = false,
      cutscene = null,
      playerVehicle = null,
      vehiclePhysics = null,
      className,
      style,
      onHudUpdate,
      onEvent,
      onPauseChange,
      onCameraChange,
      onExit,
      debugBuildingAssetPolicy,
    }: GameCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sessionRef = useRef<BabylonGameSession | null>(null);
    const callbackRef = useRef<SessionCallbacks>({});
    const viewportReadyRef = useRef(false);
    const touchPortraitGateRef = useRef(false);
    const [initialInputCapabilities] = useState<InputCapabilities>(
      readInputCapabilities,
    );
    const inputCapabilitiesRef = useRef(initialInputCapabilities);
    const [runtimeState, setRuntimeState] = useState<
      "loading" | "ready" | "unsupported" | "context-lost" | "error"
    >("loading");
    const [loadProgress, setLoadProgress] = useState<LoadProgress>({
      fraction: 0,
      label: LOADING_MODELS_LABEL,
    });
    const [isPortrait, setIsPortrait] = useState(false);
    // Tracked rather than assumed, because iOS leaves fullscreen on a swipe
    // without any press of ours.
    const [fullscreen, setFullscreen] = useState(false);
    const [fullscreenOffered, setFullscreenOffered] = useState(false);
    const [inputPresentation, setInputPresentation] =
      useState<AdaptiveInputPresentation>(() =>
        createInitialInputPresentation(initialInputCapabilities),
      );
    const [hud, setHud] = useState<GameHudSnapshot>({
      speed: 0,
      speedUnit,
      gear: "D",
      cameraMode,
      instruction: "Preparing your drive…",
      paused,
      honking: false,
      rearViewVisible: cameraMode === "first_person",
      playerX: 0,
      playerZ: 0,
      heading: 0,
      simElapsedMs: 0,
      speedLimit: 0,
      scenarioClock: scenario.scenarioClock?.label,
    });

    useEffect(() => {
      callbackRef.current = {
        onHudUpdate: (snapshot: GameHudSnapshot) => {
          setHud(snapshot);
          onHudUpdate?.(snapshot);
        },
        onEvent,
        onPauseChange,
        onCameraChange,
        onReady: () => setRuntimeState("ready"),
        onContextLost: () => setRuntimeState("context-lost"),
        onContextRestored: () => setRuntimeState("ready"),
        onLoadProgress: (progress: LoadProgress) => setLoadProgress(progress),
      };
    }, [onCameraChange, onEvent, onHudUpdate, onPauseChange]);

    // The gate pauses the drive; it does not tear it down. It used to keep the
    // session-creation effect from running at all, so every rotation rebuilt
    // the entire city — and since `screen.orientation.lock()` has never shipped
    // in Safari, rotating is something a phone player does over and over.
    useEffect(() => {
      const updateViewportFlags = () => {
        const capabilities = readInputCapabilities();
        const portrait = window.matchMedia("(orientation: portrait)").matches;
        const portraitGate = portrait && capabilities.touchFirst;
        const wasReady = viewportReadyRef.current;
        const wasPortraitGate = touchPortraitGateRef.current;
        viewportReadyRef.current = true;
        touchPortraitGateRef.current = portraitGate;
        inputCapabilitiesRef.current = capabilities;
        if (!wasReady) {
          setInputPresentation(createInitialInputPresentation(capabilities));
        }
        sessionRef.current?.setInputCapabilities(capabilities);
        setIsPortrait(portrait);

        if (portraitGate) {
          sessionRef.current?.clearTouch();
          sessionRef.current?.setPaused(true);
        } else if (wasReady && wasPortraitGate) {
          sessionRef.current?.setPaused(paused, false);
        }
      };
      updateViewportFlags();
      window.addEventListener("resize", updateViewportFlags);
      window.addEventListener("orientationchange", updateViewportFlags);
      return () => {
        window.removeEventListener("resize", updateViewportFlags);
        window.removeEventListener("orientationchange", updateViewportFlags);
      };
    }, [paused]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!viewportReadyRef.current) {
        setRuntimeState("loading");
        return;
      }
      const testCanvas = document.createElement("canvas");
      if (!testCanvas.getContext("webgl2")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRuntimeState("unsupported");
        return;
      }

      let alive = true;
      let ownedSession: BabylonGameSession | null = null;
      let perfQaTimer: number | undefined;
      const writePerfQaSnapshot = () => {
        const hook = (
          window as unknown as Record<string, unknown>
        ).__sideswapPerfDebug;
        if (typeof hook === "function") {
          canvas.dataset.perfQa = JSON.stringify(hook());
        }
      };
      setRuntimeState("loading");
      // A rebuild (scenario/mapPack change) reuses this component instance
      // rather than remounting, so the bar needs its own reset here — useState's
      // initial value only covers a fresh mount.
      setLoadProgress({ fraction: 0, label: LOADING_MODELS_LABEL });
      const startSession = async () => {
        try {
          if (mapPack.id === "cairo-central-nile") {
            setLoadProgress({
              fraction: 0.02,
              label: "Loading Cairo lettering…",
            });
            // DynamicTextures do not repaint after a late webfont swap. Awaiting
            // the bundled face here guarantees every Arabic sign, plate, and
            // patrol decal is rasterised with the intended offline font.
            await ensureArabicCanvasFontLoaded();
            if (!alive) return;
            const fontDebug = inspectArabicCanvasFont();
            assertArabicCanvasFontDebug(fontDebug);
            (
              window as unknown as Record<string, unknown>
            ).__sideswapArabicFontDebug = fontDebug;
            canvas.dataset.arabicFontQa = JSON.stringify(fontDebug);
          }
          const session = new BabylonGameSession(
            canvas,
            {
              trafficSide,
              steeringSide,
              scenario,
              mapPack,
              cameraMode,
              inputCapabilities: inputCapabilitiesRef.current,
              speedUnit,
              paused: paused || touchPortraitGateRef.current,
              reducedMotion,
              steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
              fieldOfView: clampHorizontalFieldOfView(fieldOfView),
              masterVolume: clamp(masterVolume, 0, 1),
              effectsVolume: clamp(effectsVolume, 0, 1),
              cameraShake,
              headBob,
              outOfFuel,
              carConditionPct,
              riderVenueId,
              gigStopId,
              gigStopCarrying,
              cutscene,
              playerVehicle: playerVehicle ?? null,
              vehiclePhysics: vehiclePhysics ?? null,
              debugBuildingAssetPolicy,
            },
            {
              onHudUpdate: (snapshot) =>
                callbackRef.current.onHudUpdate?.(snapshot),
              onEvent: (event) => callbackRef.current.onEvent?.(event),
              onPauseChange: (value) =>
                callbackRef.current.onPauseChange?.(value),
              onCameraChange: (value) =>
                callbackRef.current.onCameraChange?.(value),
              onInputPresentationChange: (value) =>
                setInputPresentation(value),
              onReady: () => callbackRef.current.onReady?.(),
              onContextLost: () => callbackRef.current.onContextLost?.(),
              onContextRestored: () =>
                callbackRef.current.onContextRestored?.(),
              onLoadProgress: (progress) =>
                callbackRef.current.onLoadProgress?.(progress),
            },
          );
          ownedSession = session;
          if (!alive) {
            session.dispose();
            return;
          }
          sessionRef.current = session;
          if (mapPack.id === "cairo-central-nile") {
            perfQaTimer = window.setTimeout(writePerfQaSnapshot, 2_500);
          }
        } catch (error) {
          if (!alive) return;
          console.error("Unable to start Curbside Rush", error);
          setRuntimeState(
            error instanceof Error && error.message.includes("WebGL 2")
              ? "unsupported"
              : "error",
          );
        }
      };
      void startSession();
      return () => {
        alive = false;
        if (perfQaTimer !== undefined) window.clearTimeout(perfQaTimer);
        delete canvas.dataset.perfQa;
        if (mapPack.id === "cairo-central-nile") {
          delete (
            window as unknown as Record<string, unknown>
          ).__sideswapArabicFontDebug;
          delete canvas.dataset.arabicFontQa;
        }
        if (sessionRef.current === ownedSession) sessionRef.current = null;
        ownedSession?.dispose();
      };
      // Rebuild only when scene-defining jurisdiction/cockpit choices change.
      // Notably not orientation: rotating a phone pauses the drive, it does not
      // rebuild the city.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trafficSide, steeringSide, scenario.id, mapPack.id]);

    useEffect(() => {
      sessionRef.current?.updateOptions({
        cameraMode,
        speedUnit,
        paused: paused || touchPortraitGateRef.current,
        reducedMotion,
        steeringSensitivity: clamp(steeringSensitivity, 0.45, 1.8),
        fieldOfView: clampHorizontalFieldOfView(fieldOfView),
        masterVolume: clamp(masterVolume, 0, 1),
        effectsVolume: clamp(effectsVolume, 0, 1),
        cameraShake,
        headBob,
        outOfFuel,
        carConditionPct,
        riderVenueId,
        gigStopId,
        gigStopCarrying,
        cutscene,
      });
    }, [cameraMode, speedUnit, paused, reducedMotion, steeringSensitivity, fieldOfView, masterVolume, effectsVolume, cameraShake, headBob, outOfFuel, carConditionPct, riderVenueId, gigStopId, gigStopCarrying, cutscene]);

    // The tow-and-repair flow: the app bumps `resetNonce` once the fee is
    // debited and the car snaps back to its spawn, repaired.
    const lastResetNonceRef = useRef(resetNonce);
    useEffect(() => {
      if (resetNonce === lastResetNonceRef.current) return;
      lastResetNonceRef.current = resetNonce;
      sessionRef.current?.reset();
    }, [resetNonce]);

    // Mobile Safari only collapses its toolbars in response to scrolling, and
    // the drive screen cannot scroll by design — so on a phone this control is
    // the only way to reclaim the strip the address bar and tab bar occupy.
    // Pointless where the browser is already chrome-less (added to the Home
    // Screen) or has no Fullscreen API at all.
    useEffect(() => {
      // Browser capability detection has to happen after the DOM exists.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFullscreenOffered(canFullscreen() && !isStandaloneDisplay());
      const sync = () => setFullscreen(isFullscreen());
      sync();
      return onFullscreenChange(sync);
    }, []);

    const toggleFullscreen = useCallback(() => {
      // Straight out of the click, with no await in front of it: the same
      // transient-activation rule that governs priming audio.
      if (isFullscreen()) exitFullscreen();
      else requestImmersiveLandscape(document.documentElement);
    }, []);

    const registerTouchPointer = useCallback((pointerType: string) => {
      if (pointerType === "touch" || pointerType === "pen") {
        sessionRef.current?.registerTouchInput();
      }
    }, []);

    // Two-wheelers have no cockpit — see `toggleCamera` on the session class —
    // so the button that would switch into one is withheld rather than left
    // as a dead tap.
    const cameraSwitchable = !playerVehicle || playerVehicle.visualKind === "car";
    const touchVisible =
      inputPresentation.touchFirst || inputPresentation.touchRevealed;
    const touchPortraitGate = inputPresentation.touchFirst && isPortrait;
    const criticalOverlay = runtimeState !== "ready";
    const activeInputGuide = INPUT_GUIDANCE[inputPresentation.activeFamily];
    const loadPercent = Math.round(clamp(loadProgress.fraction, 0, 1) * 100);

    return (
      <div className={className} style={{ ...shellStyle, ...style }}>
        <canvas
          ref={canvasRef}
          aria-label={`Curbside Rush 3D ${trafficSide}-side driving area`}
          tabIndex={0}
          style={canvasStyle}
        />


        {touchVisible && runtimeState === "ready" && !isPortrait && (
          <TouchDriveControls
            cameraMode={hud.cameraMode}
            cameraSwitchable={cameraSwitchable}
            dimmed={inputPresentation.touchControlsDimmed}
            reducedMotion={reducedMotion}
            onSteer={(value) => sessionRef.current?.setTouchSteer(value)}
            onSteerRelease={() => sessionRef.current?.releaseTouchSteer()}
            onThrottle={(value) => sessionRef.current?.setTouchAnalog("throttle", value)}
            onBrake={(value) => sessionRef.current?.setTouchAnalog("reverse", value)}
            onQuickLook={(value) => sessionRef.current?.setTouchAnalog("quickLook", value)}
            onLookBehind={(on) => sessionRef.current?.setTouchLookBehind(on)}
            onCamera={() => sessionRef.current?.toggleCamera()}
            onHorn={(down) => (down ? sessionRef.current?.horn() : sessionRef.current?.hornRelease())}
            onPause={() => sessionRef.current?.togglePause()}
            onToggleFullscreen={fullscreenOffered ? toggleFullscreen : undefined}
            isFullscreen={fullscreen}
            onTouchPointer={registerTouchPointer}
          />
        )}

        {hud.paused && runtimeState === "ready" && (
          <div
            role="dialog"
            aria-label="Game paused"
            aria-modal="true"
            onPointerDownCapture={(event) => registerTouchPointer(event.pointerType)}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(8,14,16,.54)",
              backdropFilter: "blur(5px)",
              zIndex: DRIVE_LAYER.action,
            }}
          >
            <div
              style={{
                ...glassPanelStyle,
                width: "min(430px, calc(100% - 32px))",
                boxSizing: "border-box",
                padding: "24px 28px",
                borderRadius: 20,
                textAlign: "center",
                fontFamily: "system-ui",
              }}
            >
              <strong style={{ display: "block", marginBottom: 6, fontSize: 24 }}>Paused</strong>
              <span style={{ display: "block", marginBottom: 8, opacity: 0.9, fontSize: 13 }}>{hud.instruction}</span>
              <span style={{ display: "block", marginBottom: 18, opacity: 0.62, fontSize: 11 }}>Inputs have been cleared for safety.</span>
              <details style={{ width: "min(330px, 100%)", margin: "0 auto 18px", textAlign: "left", fontSize: 12, lineHeight: 1.45 }}>
                <summary style={{ cursor: "pointer", color: "#f2c658", fontWeight: 800 }}>
                  How to drive · {activeInputGuide.label}
                </summary>
                <span style={{ display: "block", marginTop: 8, opacity: 0.82 }}>
                  {activeInputGuide.details}
                </span>
              </details>
              {/*
                Where someone stares at the browser bars and pauses to look for
                a setting. There is no in-page fullscreen on iPhone Safari — no
                Fullscreen API outside <video>, and its own toolbar hiding only
                answers to scrolling, which this screen deliberately cannot do —
                so the Home Screen really is the answer, and this is where it
                gets asked for.
              */}
              {inputPresentation.touchFirst && !fullscreenOffered && (
                <p
                  data-testid="pause-home-screen-tip"
                  style={{
                    width: "min(330px, 100%)",
                    margin: "0 auto 18px",
                    opacity: 0.72,
                    font: "600 11px/1.5 system-ui, sans-serif",
                  }}
                >
                  Browser bars in the way? Tap <strong>Share</strong> then{" "}
                  <strong>Add to Home Screen</strong>, and open the game from
                  there for a full screen.
                </p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button autoFocus type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={() => sessionRef.current?.setPaused(false)}>
                  RESUME
                </button>
                {onExit && (
                  <button type="button" style={{ ...actionButtonStyle, width: "auto", paddingInline: 20 }} onClick={onExit}>
                    EXIT TO MENU
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {criticalOverlay && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 28,
              background: "#172226",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
              // Without this the app's HUD painted its wallet card straight
              // through "Preparing your drive…".
              zIndex: DRIVE_LAYER.curtain,
            }}
          >
            <div style={{ maxWidth: 470 }}>
              <div
                aria-hidden="true"
                style={{
                  margin: "0 auto 18px",
                  width: 54,
                  height: 54,
                  borderRadius: 18,
                  border: "5px solid #f2c658",
                  transform: "rotate(45deg)",
                  animation: runtimeState === "loading" ? "sideswap-loading-spin 2.2s linear infinite" : undefined,
                }}
              />
              <strong style={{ display: "block", marginBottom: 9, fontSize: 23 }}>
                {runtimeState === "unsupported" && "This browser cannot start the 3D drive"}
                {runtimeState === "context-lost" && "The 3D view was interrupted"}
                {runtimeState === "error" && "The drive could not load"}
                {runtimeState === "loading" && "Preparing your drive…"}
              </strong>
              <span style={{ opacity: 0.72, fontSize: 14, lineHeight: 1.5 }}>
                {runtimeState === "unsupported"
                  ? "Curbside Rush needs WebGL 2 with hardware acceleration. Try an up-to-date Chrome, Edge, Firefox, or Safari browser."
                  : runtimeState === "context-lost"
                    ? "Your position is safe. The drive is paused while the browser restores graphics."
                    : runtimeState === "error"
                      ? "Refresh the page to rebuild the drive."
                      : "Building roads, traffic, and your cockpit."}
              </span>
              {runtimeState === "loading" && (
                <div style={{ marginTop: 20 }}>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={loadPercent}
                    aria-valuetext={`${loadProgress.label} ${loadPercent}%`}
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.12)",
                      overflow: "hidden",
                    }}
                  >
                    {/* No width transition, deliberately: the % text has none either
                        (it can't — it's discrete text), so animating the fill would
                        make it lag behind the number it's supposed to equal on every
                        jump. They must always read the same value at the same instant. */}
                    <div
                      style={{
                        width: `${loadPercent}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "linear-gradient(90deg, #d9a53e, #f2c658)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
                          animation: "sideswap-loading-shimmer 1.6s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                  {/* aria-hidden: a sighted-only duplicate of the progressbar's own
                      aria-valuetext. The card above is role="status" (a live region),
                      and this text changes many times a second — without hiding it, a
                      screen reader would re-announce every percentage tick instead of
                      the rare, meaningful state changes the region exists for. */}
                  <div
                    aria-hidden="true"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.68,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{loadProgress.label}</span>
                    <span>{loadPercent}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/*
          Deliberately a scrim over a live, paused scene rather than an opaque
          wall. `screen.orientation.lock()` has never shipped in Safari, so a
          phone held in portrait cannot be corrected by the page — the overlay
          is the only lever there is, which makes rotating back out of it a
          thing players will do repeatedly. It used to cost a full city rebuild,
          because the session-creation effect refused to construct Babylon at
          all while the gate was up. It now only pauses.
        */}
        {touchPortraitGate && (
          <div
            role="dialog"
            aria-label="Rotate device"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 30,
              background: "rgba(12,20,22,.72)",
              backdropFilter: "blur(3px)",
              textAlign: "center",
              fontFamily: "system-ui, sans-serif",
              zIndex: DRIVE_LAYER.curtain,
            }}
          >
            <div style={{ ...glassPanelStyle, padding: "22px 26px", borderRadius: 20 }}>
              <div aria-hidden="true" style={{ fontSize: 44, marginBottom: 12 }}>
                ↻
              </div>
              <strong style={{ display: "block", fontSize: 21, marginBottom: 8 }}>
                Turn your phone sideways
              </strong>
              <span style={{ display: "block", opacity: 0.7, fontSize: 14, maxWidth: 260 }}>
                Your drive is paused right where you left it.
              </span>
            </div>
          </div>
        )}
      </div>
    );
}

export default GameCanvas;
