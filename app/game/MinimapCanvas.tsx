"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { createMinimapProjector, projectRoadNetwork } from "./minimap";
import { DRIVE_LAYER } from "./driveLayers";

export interface MinimapPin {
  readonly x: number;
  readonly z: number;
  readonly color: string;
}

interface MinimapProps {
  readonly worldSize: { readonly x: number; readonly z: number };
  readonly roadSurfaces: readonly {
    readonly centerline: readonly { readonly x: number; readonly z: number }[];
  }[];
  readonly playerX: number;
  readonly playerZ: number;
  readonly heading: number;
  readonly pins?: readonly MinimapPin[];
  readonly size?: number;
  /**
   * Corner placement. The default bottom-right corner is a thumb zone on touch,
   * so the drive screen moves it out of the way rather than covering a pedal.
   */
  readonly anchorStyle?: CSSProperties;
}

/**
 * Corner minimap: rasterises the static road network once per map to an
 * offscreen canvas, then each update blits it and overlays the pins + the live
 * player marker. Projection maths live in ./minimap (unit-tested).
 */
export function Minimap({
  worldSize,
  roadSurfaces,
  playerX,
  playerZ,
  heading,
  pins = [],
  size = 150,
  anchorStyle,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<HTMLCanvasElement | null>(null);
  const projector = useMemo(
    () => createMinimapProjector(worldSize, size),
    [worldSize, size],
  );

  // Rasterise the static road network once per map/size.
  useEffect(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = size;
    offscreen.height = size;
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = "rgba(206, 214, 222, 0.55)";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const line of projectRoadNetwork(roadSurfaces, projector)) {
        if (line.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(line[0].x, line[0].y);
        for (let index = 1; index < line.length; index += 1) {
          ctx.lineTo(line[index].x, line[index].y);
        }
        ctx.stroke();
      }
    }
    networkRef.current = offscreen;
  }, [roadSurfaces, projector, size]);

  // Composite the cached network + pins + live player pose each update.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (networkRef.current) ctx.drawImage(networkRef.current, 0, 0);

    for (const pin of pins) {
      const point = projector.project(pin.x, pin.z);
      ctx.fillStyle = pin.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
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
    ctx.fillStyle = "#f2c658";
    ctx.beginPath();
    ctx.moveTo(center.x + dx * 6, center.y + dy * 6);
    ctx.lineTo(center.x - dx * 4 + px * 4, center.y - dy * 4 + py * 4);
    ctx.lineTo(center.x - dx * 4 - px * 4, center.y - dy * 4 - py * 4);
    ctx.closePath();
    ctx.fill();
  }, [playerX, playerZ, heading, pins, projector, size]);

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
        background: "rgba(11, 15, 17, 0.82)",
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
