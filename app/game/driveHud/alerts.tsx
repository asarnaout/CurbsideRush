/**
 * Two small standalone overlays: the surge-pricing banner and the generic
 * toast wrapper the app fills with its own content (fines, dispatch
 * messages). Neither depends on anything else in `driveHud/*` beyond the
 * shared tokens. Split out of `DriveHud.tsx` (#290).
 */

import type { ReactNode } from "react";

import { DRIVE_LAYER } from "../driveLayers";
import { cluster, HUD_GOLD, HUD_SANS } from "./tokens";

// ---------------------------------------------------------------------------
// Surge
// ---------------------------------------------------------------------------

export function DriveSurgeBanner({
  scale,
  inset,
  multiplier,
  remaining,
}: {
  scale: number;
  inset: { readonly top: string };
  multiplier: number;
  remaining: string;
}) {
  return (
    <div
      data-testid="surge-banner"
      style={cluster(scale, "top center", {
        top: inset.top,
        left: "50%",
        translate: "-50%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 20px",
        borderRadius: 999,
        background: "rgba(244,200,72,.14)",
        border: `1.5px solid rgba(244,200,72,.5)`,
        backdropFilter: "blur(12px)",
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.toast,
      })}
    >
      <span
        style={{
          font: `900 15px ${HUD_SANS}`,
          letterSpacing: "2.4px",
          color: HUD_GOLD,
        }}
      >
        SURGE ×{multiplier}
      </span>
      <span aria-hidden="true" style={{ width: 1, height: 16, background: "rgba(244,200,72,.4)" }} />
      <span
        style={{
          font: `800 14px ${HUD_SANS}`,
          color: "rgba(244,239,222,.72)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {remaining}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts and wrappers the app still owns the content of
// ---------------------------------------------------------------------------

export function DriveToast({
  scale,
  inset,
  tone,
  children,
  testId,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  tone: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={cluster(scale, inset.right === "auto" ? "top left" : "top right", {
        top: inset.top,
        right: inset.right,
        left: inset.right === "auto" ? "0.75rem" : undefined,
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: inset.right === "auto" ? 44 : 74,
        padding: inset.right === "auto" ? "0 16px" : "0 30px",
        borderRadius: inset.right === "auto" ? 14 : 22,
        background: "rgba(11,15,17,.86)",
        backdropFilter: "blur(16px)",
        border: `1.5px solid ${tone}`,
        boxShadow: "0 26px 60px -24px rgba(0,0,0,.9)",
        font: `900 ${inset.right === "auto" ? 13 : 22}px ${HUD_SANS}`,
        letterSpacing: "2.4px",
        color: tone,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: DRIVE_LAYER.toast,
      })}
    >
      {children}
    </div>
  );
}
