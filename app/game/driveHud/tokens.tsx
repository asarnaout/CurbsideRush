/**
 * Shared design tokens for the drive HUD: palette and type, the desktop-frame
 * scaling function, and the shared glyph renderer. Split out of
 * `DriveHud.tsx` (#290) because it is the one module every other `driveHud/*`
 * file depends on — `cluster()` alone is used by the nav card, the speed
 * cluster, the money cluster, the surge banner, the toast and the offer card.
 *
 * `cluster()` and `MUSIC_DIM_COLOR` were unexported locals in `DriveHud.tsx`
 * and still are not part of its public surface after the split — they are
 * exported here only so sibling `driveHud/*` modules can import them;
 * `DriveHud.tsx`'s barrel re-exports everything else below but not these two.
 */

import type { CSSProperties } from "react";

import { DRIVE_LAYER } from "../driveLayers";

// ---------------------------------------------------------------------------
// Palette and type. These repeat globals.css's `--hud-*` custom properties as
// literals for the same reason the rest of the drive screen does: it is styled
// inline throughout, and splitting it across a stylesheet is what caused the
// z-order bug driveLayers.ts exists to prevent.
// ---------------------------------------------------------------------------

export const HUD_CREAM = "#f4efde";
export const HUD_GOLD = "#f4c848";
export const HUD_CORAL = "#e8705a";
export const HUD_SAGE = "#8fae72";
export const HUD_GLASS = "rgba(11,15,17,.78)";
export const HUD_SANS = '"Figtree", system-ui, sans-serif';
export const HUD_SERIF = '"Playfair Display", Georgia, serif';
/** The ink and paper of the offer card, the one light surface on the screen. */
export const HUD_INK = "#201e1d";

/** Width the comp was drawn at. Everything below is in its pixels. */
export const HUD_DESIGN_WIDTH = 1920;
/** Below this the clusters would eat the road, so scaling stops. */
export const HUD_MIN_SCALE = 0.68;

/**
 * How much to shrink the HUD for a viewport narrower than the comp.
 *
 * A 486px nav card is a quarter of a 1920 screen and well over a third of a
 * 1280 one, which is the difference between a readout and an obstruction.
 */
export function resolveHudScale(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.min(1, Math.max(HUD_MIN_SCALE, viewportWidth / HUD_DESIGN_WIDTH));
}

// ---------------------------------------------------------------------------
// Icons — Lucide at stroke-width 2.75, the design system's own convention.
// ---------------------------------------------------------------------------

export function HudGlyph({
  path,
  size = 14,
  color = "rgba(244,239,222,.55)",
  strokeWidth = 2.4,
}: {
  path: readonly string[];
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {path.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Dims a pressed toggle's icon — shared by the money cluster's music button
 * and the phone's corner buttons, the two places a control can be "on". */
export const MUSIC_DIM_COLOR = "rgba(244,239,222,.4)";

/** Every scaled HUD cluster positions itself with this: absolute, scaled as a
 * whole from `resolveHudScale`, defaulting to `DRIVE_LAYER.hud` unless the
 * caller overrides `zIndex` in `rest`. */
export const cluster = (scale: number, origin: string, rest: CSSProperties): CSSProperties => ({
  position: "absolute",
  transform: scale === 1 ? undefined : `scale(${scale})`,
  transformOrigin: origin,
  zIndex: DRIVE_LAYER.hud,
  ...rest,
});
