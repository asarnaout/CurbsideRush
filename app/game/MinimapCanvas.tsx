"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  createMinimapFollowProjector,
  createMinimapProjector,
  createMinimapSheetProjector,
  minimapRoadFloorPx,
  resolveMinimapScale,
} from "./minimap";
import {
  drawMapOverlay,
  drawMapParks,
  drawMapRailLines,
  drawMapWaterBodies,
  drawPlayerMarker,
  drawRoadNetwork,
  minimapSymbolSizes,
  type MapDestination,
  type MapDrawPark,
  type MapDrawRailLine,
  type MapDrawWaterBody,
} from "./minimapDraw";
import { MapPoiLayer } from "./MapPoiLayer";
import type { MapPoi } from "./mapPoi";
import { DRIVE_LAYER } from "./driveLayers";
import { roadLevelAtElevation } from "./roadElevation";

interface MinimapProps {
  readonly worldSize: { readonly x: number; readonly z: number };
  readonly roadSurfaces: readonly {
    readonly centerline: readonly {
      readonly x: number;
      readonly z: number;
      readonly elevationM?: number;
    }[];
    readonly widthM?: number;
  }[];
  readonly waterBodies?: readonly MapDrawWaterBody[];
  /** Park rectangles, drawn as green fills under the water and the roads. */
  readonly parks?: readonly MapDrawPark[];
  /** Rail polylines, drawn between the water and the road network. */
  readonly railLines?: readonly MapDrawRailLine[];
  readonly playerX: number;
  readonly playerZ: number;
  readonly playerElevationM?: number;
  readonly heading: number;
  /**
   * Where the player is going. The only marker on the canvas, so it can never
   * be lost among the places — see `MapDestination`.
   */
  readonly destination?: MapDestination | null;
  /**
   * Services worth knowing about mid-drive, as icons over the canvas. The app
   * hands in a filtered set (`MINIMAP_POI_KINDS`) — the whole city's would bury
   * a 104 px square.
   */
  readonly pois?: readonly MapPoi[];
  /**
   * The GPS line from the car to the current destination, in world metres,
   * already trimmed to start at the player. Computed app-side — see
   * `gpsRoute.ts` — and passed in rather than searched here, because the search
   * must run once per destination and this component redraws at 10 Hz.
   */
  readonly route?: readonly { readonly x: number; readonly z: number }[];
  /**
   * A second, dashed line to somewhere the player has not committed to — the
   * pickup of an offer they are being asked to take. Drawn under the live route
   * and in a different hand entirely, because the whole question it answers is
   * "how far out of my way is this?".
   */
  readonly previewRoute?: readonly { readonly x: number; readonly z: number }[];
  /** What the preview line is worth taking, e.g. "0.4 mi". */
  readonly previewLabel?: string;
  /**
   * Fades the whole widget out without unmounting it.
   *
   * On a phone the offer card lands in this exact slot — there is nowhere else
   * for something that size — so the map gets out of its way rather than being
   * buried by it. Kept mounted so the rasterised sheet and the scroll position
   * survive: an offer resolves every few seconds.
   */
  readonly dimmed?: boolean;
  readonly size?: number;
  /**
   * Corner placement. The default bottom-right corner is a thumb zone on touch,
   * so the drive screen moves it out of the way rather than covering a pedal.
   */
  readonly anchorStyle?: CSSProperties;
}

/**
 * Corner minimap: rasterises the static road network once per map to an
 * offscreen canvas, then each update blits it and overlays the route line, the
 * destination and the live player marker. Place icons ride above it in the DOM
 * (`MapPoiLayer`). Projection maths live in ./minimap (unit-tested); the route
 * search lives in ./gpsRoute and never runs here.
 *
 * A map small enough to fit is drawn whole; every city the game ships is past
 * the follow span and scrolls under the player instead. The sheet is rasterised
 * for the whole world at a readable scale and each update blits the window
 * around the car — fitting a 3 km city into 150 px turns every street into a
 * hairline, which is a worse map than one you can only see part of.
 *
 * Roads draw as wide translucent strips rather than centrelines, so the blocks
 * between them read as blocks and crossings brighten where two strips overlap.
 * That overlap is the whole junction treatment: no fills, no second pass.
 */
export function Minimap({
  worldSize,
  roadSurfaces,
  waterBodies = [],
  parks = [],
  railLines = [],
  playerX,
  playerZ,
  playerElevationM = 0,
  heading,
  destination,
  pois = [],
  route,
  previewRoute,
  previewLabel,
  dimmed = false,
  size = 150,
  anchorStyle,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<HTMLCanvasElement | null>(null);
  const activeRoadLevel = roadLevelAtElevation(playerElevationM);
  const scale = useMemo(
    () => resolveMinimapScale(worldSize, size),
    [worldSize, size],
  );
  // The sheet the network is drawn on: the widget itself when the world fits,
  // otherwise a canvas covering the whole world at the same readable scale.
  const sheet = useMemo(
    () =>
      scale.follows
        ? createMinimapSheetProjector(worldSize, scale.pixelsPerMetre, size / 2)
        : { ...createMinimapProjector(worldSize, size), width: size, height: size },
    [worldSize, size, scale],
  );
  // Where the route, the destination and the place icons go in the widget: the
  // same sheet when the map is drawn whole, or a window centred on the car when
  // it scrolls.
  const projector = useMemo(
    () =>
      scale.follows
        ? createMinimapFollowProjector(playerX, playerZ, scale.pixelsPerMetre, size)
        : sheet,
    [scale, playerX, playerZ, size, sheet],
  );

  // Rasterise the static road network once per map/size.
  useEffect(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = sheet.width;
    offscreen.height = sheet.height;
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      drawMapParks(ctx, parks, sheet);
      drawMapWaterBodies(ctx, waterBodies, sheet);
      drawMapRailLines(ctx, railLines, sheet, scale.pixelsPerMetre);
      drawRoadNetwork(
        ctx,
        roadSurfaces,
        sheet,
        scale.pixelsPerMetre,
        minimapRoadFloorPx(size),
        activeRoadLevel,
      );
    }
    networkRef.current = offscreen;
  }, [
    roadSurfaces,
    waterBodies,
    parks,
    railLines,
    sheet,
    scale,
    size,
    activeRoadLevel,
  ]);

  // Composite the cached network, the route and the destination each update.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (networkRef.current) {
      if (scale.follows) {
        // Blit the slice of the sheet the player stands in the middle of.
        const at = sheet.project(playerX, playerZ);
        ctx.drawImage(
          networkRef.current,
          at.x - size / 2,
          at.y - size / 2,
          size,
          size,
          0,
          0,
          size,
          size,
        );
      } else {
        ctx.drawImage(networkRef.current, 0, 0);
      }
    }

    drawMapOverlay(ctx, {
      projector,
      // Fractions of the widget's own edge, so the arrow keeps its proportions
      // on the smaller touch map instead of swelling to fill it.
      symbols: minimapSymbolSizes(size),
      route,
      previewRoute,
      destination,
    });
  }, [
    playerX,
    playerZ,
    heading,
    destination,
    route,
    previewRoute,
    projector,
    size,
    scale,
    sheet,
  ]);

  // The car, onto its own canvas above the place icons — see `drawPlayerMarker`.
  useEffect(() => {
    const ctx = playerRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    drawPlayerMarker(ctx, {
      projector,
      symbols: minimapSymbolSizes(size),
      playerX,
      playerZ,
      heading,
    });
  }, [projector, size, playerX, playerZ, heading]);

  /**
   * The widget's chrome, as fractions of its own edge so a 344 px desktop map
   * and a 104 px touch one keep the same proportions — the rule the detour bar
   * below already follows.
   *
   * `Curbside Driving HUD Desktop` is where every fraction comes from (26 px of
   * rounding on 344, an 18 px compass over a 2x17 tick), and at 104 px they
   * collapse into a smudge. **Each floor is the value the touch widget had
   * before those fractions arrived**, so the phone is pinned exactly where it
   * was until its own comp lands.
   */
  const radius = Math.max(11, Math.round(size * 0.076));
  const compass = {
    top: Math.max(5, Math.round(size * 0.035)),
    left: Math.max(6, Math.round(size * 0.047)),
    gap: Math.max(3, Math.round(size * 0.02)),
    font: Math.max(9, Math.round(size * 0.052)),
    tickW: Math.max(1, Math.round(size * 0.006)),
    tickH: Math.max(8, Math.round(size * 0.049)),
  };

  return (
    <div
      aria-hidden="true"
      data-testid="minimap"
      style={{
        position: "absolute",
        right: "1rem",
        bottom: "1rem",
        ...anchorStyle,
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.11)",
        // Nearly opaque: the road strips are drawn translucent so crossings can
        // brighten, which only reads if what is behind them is flat and dark.
        background: "rgba(11, 14, 16, 0.92)",
        backdropFilter: "blur(14px)",
        boxShadow: "0 22px 50px -26px rgba(0,0,0,.85)",
        pointerEvents: "none",
        opacity: dimmed ? 0 : 1,
        transition: "opacity .26s ease",
        zIndex: DRIVE_LAYER.hud,
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ display: "block", width: `${size}px`, height: `${size}px` }}
      />
      {/*
        Sized off the widget like everything else here, but with a floor: below
        about 10 px a stroked glyph stops being a picture and becomes a smudge,
        and the touch map is only 104 px across.
      */}
      <MapPoiLayer
        pois={pois}
        projector={projector}
        width={size}
        height={size}
        glyphPx={Math.round(Math.min(15, Math.max(10, size * 0.105)))}
      />
      {/* Above the icons, so a camera at the junction you are crossing cannot
          sit on top of the arrow telling you which way you are pointing. */}
      <canvas
        ref={playerRef}
        width={size}
        height={size}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: `${size}px`,
          height: `${size}px`,
          pointerEvents: "none",
        }}
      />
      {/*
        The map is north-up — `projectRoadNetwork` never rotates it — and
        without saying so it reads as a heading-up map whose roads refuse to
        turn.
      */}
      {previewLabel && (
        <div
          data-testid="detour-preview"
          style={{
            position: "absolute",
            left: Math.round(size * 0.04),
            right: Math.round(size * 0.04),
            bottom: Math.round(size * 0.04),
            display: "flex",
            alignItems: "center",
            gap: Math.max(4, Math.round(size * 0.026)),
            background: "rgba(250,243,228,.92)",
            borderRadius: Math.round(size * 0.04),
            padding: `${Math.round(size * 0.023)}px ${Math.round(size * 0.04)}px`,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: Math.max(5, Math.round(size * 0.026)),
              height: Math.max(5, Math.round(size * 0.026)),
              borderRadius: "50%",
              background: "#201e1d",
              flex: "none",
            }}
          />
          <span
            style={{
              font: `800 ${Math.max(8, Math.round(size * 0.039))}px/1 "Figtree", system-ui, sans-serif`,
              letterSpacing: "1.4px",
              color: "rgba(32,30,29,.75)",
              whiteSpace: "nowrap",
            }}
          >
            DETOUR PREVIEW
          </span>
          <span
            style={{
              marginLeft: "auto",
              font: `900 ${Math.max(9, Math.round(size * 0.043))}px/1 "Figtree", system-ui, sans-serif`,
              color: "#201e1d",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {previewLabel}
          </span>
        </div>
      )}
      <span
        style={{
          position: "absolute",
          top: compass.top,
          left: compass.left,
          display: "flex",
          alignItems: "center",
          gap: compass.gap,
          font: `900 ${compass.font}px/1 "Figtree", system-ui, sans-serif`,
          color: "rgba(244,239,222,.7)",
        }}
      >
        N
        <span
          style={{
            width: compass.tickW,
            height: compass.tickH,
            background: "rgba(244,239,222,.4)",
          }}
        />
      </span>
    </div>
  );
}
