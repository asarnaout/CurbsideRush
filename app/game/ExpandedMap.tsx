"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { HudGlyph, HUD_CREAM, HUD_GLASS, HUD_SANS, HUD_SERIF } from "./DriveHud";
import { DRIVE_LAYER } from "./driveLayers";
import { CLOSE_ICON } from "./hudIcons";
import {
  countMapPois,
  MAP_POI_FAMILY,
  MAP_POI_LEGEND,
  type MapPoi,
  type MapPoiKind,
} from "./mapPoi";
import { MapPoiLayer } from "./MapPoiLayer";
import {
  createMinimapFitProjector,
  fitMinimapPanel,
  MAP_ROAD_WIDTH_FLOOR_PX,
} from "./minimap";
import {
  drawMapOverlay,
  drawMapWaterBodies,
  drawPlayerMarker,
  drawRoadNetwork,
  type MapDestination,
  type MapDrawPoint,
  type MapDrawSurface,
  type MapDrawWaterBody,
  type MapSymbolSizes,
} from "./minimapDraw";

/**
 * Symbol sizes for a whole city on a screen.
 *
 * Flat pixels, not fractions of the canvas — see `minimapSymbolSizes` for why
 * the widget's rule cannot come along. There is one real departure from the
 * corner map: fitted, a street is about three pixels wide, so the route line
 * can no longer sit *inside* the road it follows. It is drawn over the top
 * instead, wider than the street, the way every map app does at this zoom.
 */
const EXPANDED_MAP_SYMBOLS: MapSymbolSizes = {
  routeWidthPx: 3.5,
  previewWidthPx: 2.5,
  previewDashPx: [6, 7],
  previewRingRadiusPx: 6,
  previewRingWidthPx: 2,
  destinationRadiusPx: 7,
  playerHaloRadiusPx: 13,
  playerNosePx: 9,
  playerTailPx: 6,
};

/** Breathing room outside the panel, and inside it. Tighter on a short phone. */
const ROOMY = { margin: 24, padding: 18, gap: 18 };
const TIGHT = { margin: 8, padding: 10, gap: 10 };
/** Below this much viewport height, every spare pixel belongs to the map. */
const TIGHT_BELOW_PX = 460;

export interface ExpandedMapProps {
  readonly cityName: string;
  /** Where the player is headed, or null when they are carrying nothing. */
  readonly subtitle: string | null;
  readonly worldSize: { readonly x: number; readonly z: number };
  readonly roadSurfaces: readonly MapDrawSurface[];
  readonly waterBodies?: readonly MapDrawWaterBody[];
  readonly pois: readonly MapPoi[];
  readonly destination?: MapDestination | null;
  /**
   * The whole GPS line, untrimmed — unlike the corner widget, which is handed
   * the remainder from the car. The point of this view is the journey.
   */
  readonly route?: readonly MapDrawPoint[];
  readonly previewRoute?: readonly MapDrawPoint[];
  readonly playerX: number;
  readonly playerZ: number;
  readonly heading: number;
  readonly viewport: { readonly width: number; readonly height: number };
  /** Keyboard hints are a lie on a phone. */
  readonly showKeyHints?: boolean;
  readonly onClose: () => void;
}

/**
 * The whole city, north-up, opened with M.
 *
 * The corner widget answers "which way at this junction"; on a 3 km map at a
 * fixed 500 m span it can never answer "where am I" or "where is the nearest
 * pump". This is that answer, and it is deliberately the *fitted* projection —
 * `resolveMinimapScale` reports `follows` for every shipped city, and a
 * follow-scale sheet at this size would rasterise New York into roughly
 * 2818x6228 px, some 70 MB. `createMinimapFitProjector` is the only way in.
 *
 * The drive keeps running behind it. That is a decision, not an oversight: the
 * car still steers, so the panel must not trap keys, must not claim to be modal,
 * and must not park focus anywhere Space or Enter would activate.
 *
 * Unlike the widget there is no offscreen sheet. Fitted, a city is a couple of
 * dozen polylines — New York is 19 — so redrawing them with the overlay costs
 * less than the blit would, and it sidesteps having to scale a cached canvas by
 * the device pixel ratio and hand `drawImage` an explicit destination size.
 */
export function ExpandedMap({
  cityName,
  subtitle,
  worldSize,
  roadSurfaces,
  waterBodies = [],
  pois,
  destination,
  route,
  previewRoute,
  playerX,
  playerZ,
  heading,
  viewport,
  showKeyHints = false,
  onClose,
}: ExpandedMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const tight = viewport.height < TIGHT_BELOW_PX;
  const room = tight ? TIGHT : ROOMY;
  // The legend keeps its column at every size. Width is never the binding
  // constraint — even a landscape phone has 874 px of it — so moving the key
  // under the map buys nothing and costs the map its height, which always is.
  const legendWidth = Math.round(
    Math.min(240, Math.max(150, viewport.width * 0.26)),
  );

  const box = useMemo(
    () =>
      fitMinimapPanel(worldSize, {
        width:
          viewport.width - room.margin * 2 - room.padding * 2 - legendWidth - room.gap,
        height: viewport.height - room.margin * 2 - room.padding * 2,
      }),
    [worldSize, viewport, room, legendWidth],
  );

  const projector = useMemo(
    () => createMinimapFitProjector(worldSize, box.width, box.height, 0),
    [worldSize, box],
  );

  // Capped at 2: a DPR-3 phone would allocate half as much again for a
  // difference nobody can see on a 130 px-wide map.
  const dpr = useMemo(
    () =>
      Math.min(2, (typeof window === "undefined" ? 1 : window.devicePixelRatio) || 1),
    [],
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    // Everything below is in CSS pixels; the backing store is bigger, and this
    // is the only place that knows it.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    drawMapWaterBodies(ctx, waterBodies, projector);
    drawRoadNetwork(
      ctx,
      roadSurfaces,
      projector,
      projector.pixelsPerMetre,
      MAP_ROAD_WIDTH_FLOOR_PX,
    );
    drawMapOverlay(ctx, {
      projector,
      symbols: EXPANDED_MAP_SYMBOLS,
      route,
      previewRoute,
      destination,
    });
  }, [
    roadSurfaces,
    waterBodies,
    projector,
    box,
    dpr,
    route,
    previewRoute,
    destination,
  ]);

  // The car, above the place icons — see `drawPlayerMarker`.
  useEffect(() => {
    const ctx = playerRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    drawPlayerMarker(ctx, {
      projector,
      symbols: EXPANDED_MAP_SYMBOLS,
      playerX,
      playerZ,
      heading,
    });
  }, [projector, box, dpr, playerX, playerZ, heading]);

  /*
   * Escape has to be caught in the capture phase and stopped dead.
   *
   * `BabylonGameSession` maps Escape to `togglePause` on its own window
   * listener, so without this the map would close and the drive would pause
   * behind it. `ConfirmDialog` uses the same trick — but it swallows *every*
   * key, because its drive is already paused. This one must swallow only
   * Escape: the car is still moving and the player still needs the throttle.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);

  /*
   * Focus the panel, never the close button.
   *
   * Space is the handbrake and Enter answers the service prompt; both are
   * default activations on a focused `<button>`, so landing focus there would
   * have the player slam the brakes and shut the map trying to drive. A div
   * activates on neither.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Which families this city has at all — for fading a row, not for counting.
  // What a key is for is telling you what a symbol means; how many of them
  // there are is what the map itself is showing you.
  const hasAny = useMemo(() => {
    const present = countMapPois(pois);
    return Object.fromEntries(
      MAP_POI_LEGEND.map((kind) => [kind, present[kind] > 0]),
    ) as Readonly<Record<MapPoiKind, boolean>>;
  }, [pois]);
  const glyphPx = Math.round(
    Math.min(16, Math.max(11, Math.min(box.width, box.height) * 0.035)),
  );

  return (
    <div
      data-testid="expanded-map"
      role="dialog"
      /*
       * Deliberately no `aria-modal`. The drive is still live behind this and
       * the HUD behind it is still updating; claiming modality would be a lie
       * to a screen reader and would hide a running game.
       */
      aria-label="City map"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        // The pause dialog's own scrim, so the drive screen keeps one language
        // for "something is in front of the road".
        background: "rgba(8,14,16,.54)",
        backdropFilter: "blur(5px)",
        zIndex: DRIVE_LAYER.action,
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          display: "flex",
          gap: room.gap,
          padding: room.padding,
          borderRadius: 22,
          background: HUD_GLASS,
          border: "1px solid rgba(255,255,255,.1)",
          boxShadow: "0 30px 70px -30px rgba(0,0,0,.9)",
          outline: "none",
          fontFamily: HUD_SANS,
        }}
      >
        <div style={{ position: "relative", width: box.width, height: box.height }}>
          <canvas
            ref={canvasRef}
            width={Math.round(box.width * dpr)}
            height={Math.round(box.height * dpr)}
            style={{
              display: "block",
              width: `${box.width}px`,
              height: `${box.height}px`,
              borderRadius: 10,
              background: "rgba(11, 14, 16, 0.92)",
            }}
          />
          <MapPoiLayer
            pois={pois}
            projector={projector}
            width={box.width}
            height={box.height}
            glyphPx={glyphPx}
            testId="expanded-map-poi"
          />
          <canvas
            ref={playerRef}
            width={Math.round(box.width * dpr)}
            height={Math.round(box.height * dpr)}
            style={{
              position: "absolute",
              inset: 0,
              display: "block",
              width: `${box.width}px`,
              height: `${box.height}px`,
              pointerEvents: "none",
            }}
          />
        </div>

        <div
          style={{
            width: legendWidth,
            display: "flex",
            flexDirection: "column",
            gap: tight ? 8 : 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong
                style={{
                  display: "block",
                  font: `700 ${tight ? 17 : 21}px/1.15 ${HUD_SERIF}`,
                  color: HUD_CREAM,
                }}
              >
                {cityName}
              </strong>
              <span
                data-testid="expanded-map-subtitle"
                style={{
                  display: "block",
                  marginTop: 3,
                  font: `700 ${tight ? 9 : 10}px/1.3 ${HUD_SANS}`,
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                  color: "rgba(244,239,222,.42)",
                }}
              >
                {subtitle ?? "North up"}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the map"
              title="Close the map"
              style={{
                width: 34,
                height: 34,
                flex: "none",
                borderRadius: "50%",
                background: "rgba(11,15,17,.6)",
                border: "1px solid rgba(255,255,255,.1)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <HudGlyph path={CLOSE_ICON} size={16} strokeWidth={2.75} color={HUD_CREAM} />
            </button>
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: tight ? 5 : 8,
            }}
          >
            {MAP_POI_LEGEND.map((kind) => {
              const family = MAP_POI_FAMILY[kind];
              return (
                <li
                  key={kind}
                  data-testid="map-legend-row"
                  data-poi-kind={kind}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    // Faded where the city has none of them — Milton Keynes,
                    // Calais and Tokyo have no traffic lights at all. Not a
                    // tally, just the difference between "you have not found one
                    // yet" and "there are none to find".
                    opacity: hasAny[kind] ? 1 : 0.38,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 24,
                      height: 24,
                      flex: "none",
                      borderRadius: "50%",
                      background: "rgba(9,12,14,.82)",
                      border: `1px solid ${family.color}`,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <HudGlyph path={family.icon} size={13} strokeWidth={2.3} color={family.color} />
                  </span>
                  <span
                    style={{
                      flex: 1,
                      font: `800 ${tight ? 11 : 12}px/1 ${HUD_SANS}`,
                      color: HUD_CREAM,
                    }}
                  >
                    {family.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {showKeyHints && (
            <span
              data-testid="expanded-map-hint"
              style={{
                marginTop: "auto",
                font: `700 10px/1.4 ${HUD_SANS}`,
                letterSpacing: "1px",
                color: "rgba(244,239,222,.42)",
              }}
            >
              <Keycap>M</Keycap> or <Keycap>Esc</Keycap> to close
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const KEYCAP: CSSProperties = {
  display: "inline-block",
  padding: "2px 5px",
  borderRadius: 4,
  background: "rgba(244,239,222,.14)",
  color: HUD_CREAM,
  font: `900 10px/1 ${HUD_SANS}`,
};

function Keycap({ children }: { children: string }) {
  return <em style={{ ...KEYCAP, fontStyle: "normal" }}>{children}</em>;
}
