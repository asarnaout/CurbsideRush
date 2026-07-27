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
  drawRoadNetwork,
  minimapSymbolSizes,
  type MinimapPin,
} from "./minimapDraw";
import { DRIVE_LAYER } from "./driveLayers";

export type { MinimapPin };

interface MinimapProps {
  readonly worldSize: { readonly x: number; readonly z: number };
  readonly roadSurfaces: readonly {
    readonly centerline: readonly { readonly x: number; readonly z: number }[];
    readonly widthM?: number;
  }[];
  readonly playerX: number;
  readonly playerZ: number;
  readonly heading: number;
  readonly pins?: readonly MinimapPin[];
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
 * pins and the live player marker. Projection maths live in ./minimap
 * (unit-tested); the route search lives in ./gpsRoute and never runs here.
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
  playerX,
  playerZ,
  heading,
  pins = [],
  route,
  previewRoute,
  previewLabel,
  dimmed = false,
  size = 150,
  anchorStyle,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<HTMLCanvasElement | null>(null);
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
  // Where pins and the player marker go in the widget: the same sheet when the
  // map is drawn whole, or a window centred on the car when it scrolls.
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
      drawRoadNetwork(
        ctx,
        roadSurfaces,
        sheet,
        scale.pixelsPerMetre,
        minimapRoadFloorPx(size),
      );
    }
    networkRef.current = offscreen;
  }, [roadSurfaces, sheet, scale, size]);

  // Composite the cached network + pins + live player pose each update.
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
      playerX,
      playerZ,
      heading,
      route,
      previewRoute,
      pins,
    });
  }, [
    playerX,
    playerZ,
    heading,
    pins,
    route,
    previewRoute,
    projector,
    size,
    scale,
    sheet,
  ]);

  const radius = Math.round(size * 0.11);

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
        boxShadow: "0 18px 40px -24px rgba(0,0,0,.85)",
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
            DETOUR
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
          top: Math.round(size * 0.05),
          left: Math.round(size * 0.06),
          display: "flex",
          alignItems: "center",
          gap: 3,
          font: '900 9px/1 "Figtree", system-ui, sans-serif',
          color: "rgba(244,239,222,.7)",
        }}
      >
        N
        <span
          style={{
            width: 1,
            height: 8,
            background: "rgba(244,239,222,.4)",
          }}
        />
      </span>
    </div>
  );
}
