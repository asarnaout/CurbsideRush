"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  createMinimapFollowProjector,
  createMinimapProjector,
  createMinimapSheetProjector,
  projectRoadNetwork,
  resolveMinimapRoadWidth,
  resolveMinimapScale,
} from "./minimap";
import { DRIVE_LAYER } from "./driveLayers";

export interface MinimapPin {
  readonly x: number;
  readonly z: number;
  readonly color: string;
  /**
   * `destination` draws the ringed map pin the route line ends at; everything
   * else stays a plain dot, so a screenful of gas stations cannot compete with
   * the one place the player is actually going.
   */
  readonly kind?: "dot" | "destination";
}

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
      // Translucent, so the overlap at a crossing brightens into a junction
      // patch on its own — the reason there is no junction pass here.
      ctx.strokeStyle = "rgba(158, 170, 180, 0.20)";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const line of projectRoadNetwork(roadSurfaces, sheet)) {
        if (line.points.length < 2) continue;
        ctx.lineWidth = resolveMinimapRoadWidth(
          line.widthM,
          scale.pixelsPerMetre,
          size,
        );
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let index = 1; index < line.points.length; index += 1) {
          ctx.lineTo(line.points[index].x, line.points[index].y);
        }
        ctx.stroke();
      }
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

    // The GPS line, under the pins so the destination marker caps it. One path
    // per update over a few dozen points — the search that produced them ran
    // once, when the destination changed.
    if (route && route.length > 1) {
      ctx.strokeStyle = "#f2c658";
      ctx.lineWidth = Math.max(2, size * 0.026);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      const first = projector.project(route[0].x, route[0].z);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < route.length; index += 1) {
        const point = projector.project(route[index].x, route[index].z);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }

    for (const pin of pins) {
      const point = projector.project(pin.x, pin.z);
      if (pin.kind === "destination") {
        // The head of a map pin: a filled disc with a white eye, sized to sit
        // on top of the route line rather than beside it.
        const radius = Math.max(4, size * 0.042);
        ctx.fillStyle = pin.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 0.38, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = pin.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player marker: a triangle pointing along the heading. Heading θ maps to a
    // world direction (sin θ, cos θ); on the minimap +x is right and +z is up
    // (screen -y), so the screen direction is (sin θ, -cos θ).
    const center = projector.project(playerX, playerZ);
    const dx = Math.sin(heading);
    const dy = -Math.cos(heading);
    const px = -dy;
    const py = dx;
    // A soft disc under the arrow, so the car stays findable where the route
    // line runs beneath it and against a bright junction patch.
    ctx.fillStyle = "rgba(242, 198, 88, 0.20)";
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.max(8, size * 0.075), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2c658";
    ctx.beginPath();
    ctx.moveTo(center.x + dx * 6, center.y + dy * 6);
    ctx.lineTo(center.x - dx * 4 + px * 4, center.y - dy * 4 + py * 4);
    ctx.lineTo(center.x - dx * 4 - px * 4, center.y - dy * 4 - py * 4);
    ctx.closePath();
    ctx.fill();
  }, [playerX, playerZ, heading, pins, route, projector, size, scale, sheet]);

  const radius = Math.round(size * 0.11);

  return (
    <div
      aria-hidden="true"
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
