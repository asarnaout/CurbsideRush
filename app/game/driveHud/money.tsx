/**
 * The money cluster: top-right balance readout and the four buttons
 * (music/camera/map/pause) the app owns on desktop. Split out of
 * `DriveHud.tsx` (#290). `DriveMoneyClusterButton` moves with it — despite
 * living under the original file's "Shared shapes" heading, it is consumed
 * only by `DriveMoneyCluster` below.
 */

import { DRIVE_LAYER } from "../driveLayers";
import { cluster, HudGlyph, HUD_CREAM, HUD_GOLD, HUD_SANS, MUSIC_DIM_COLOR } from "./tokens";
import { CAMERA_ICON, MAP_ICON, MUSIC_ICON, MUSIC_MUTED_ICON, PAUSE_ICON, WALLET_ICON } from "../hudIcons";

export interface DriveMoneyClusterButton {
  readonly id: "music" | "camera" | "map" | "pause";
  readonly label: string;
  readonly pressed?: boolean;
  readonly onPress: () => void;
}

export function DriveMoneyCluster({
  scale,
  inset,
  balance,
  balanceLabel,
  gain,
  buttons,
  compact = false,
}: {
  scale: number;
  inset: { readonly top: string; readonly right: string };
  compact?: boolean;
  balance: string;
  balanceLabel: string;
  /** The `+$x.xx` that floats up on a payout, cleared once it has run. */
  gain: string | null;
  buttons: readonly DriveMoneyClusterButton[];
}) {
  const icon = {
    music: MUSIC_ICON,
    camera: CAMERA_ICON,
    map: MAP_ICON,
    pause: PAUSE_ICON,
  };
  const m = compact
    ? { balance: 26, wallet: 15, gain: 13, button: 39, glyph: 16, gap: 7 }
    : { balance: 47, wallet: 28, gain: 23, button: 46, glyph: 21, gap: 10 };
  return (
    <div
      style={cluster(scale, "top right", {
        top: inset.top,
        right: inset.right,
        display: "flex",
        flexDirection: compact ? "row-reverse" : "column",
        alignItems: compact ? "center" : "flex-end",
        gap: compact ? 11 : 10,
        zIndex: DRIVE_LAYER.action,
      })}
    >
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", gap: compact ? 8 : 14 }}
      >
        <div
          aria-hidden="true"
          data-testid="money-gain"
          style={{
            position: "absolute",
            right: 2,
            top: compact ? -18 : -28,
            font: `900 ${m.gain}px ${HUD_SANS}`,
            color: HUD_GOLD,
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 2px 12px rgba(0,0,0,.9)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            opacity: gain ? 1 : 0,
            transform: gain ? "translateY(0)" : "translateY(-20px)",
            transition: gain ? "none" : "opacity .85s ease, transform .95s cubic-bezier(.2,.7,.3,1)",
          }}
        >
          {gain}
        </div>
        <HudGlyph path={WALLET_ICON} size={m.wallet} strokeWidth={2.3} color="rgba(244,239,222,.4)" />
        <span className="sr-only">{balanceLabel}</span>
        <span
          data-testid="day-cash"
          style={{
            font: `900 ${m.balance}px/.9 ${HUD_SANS}`,
            color: HUD_CREAM,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-2px",
            textShadow: "0 3px 16px rgba(0,0,0,.88)",
          }}
        >
          {balance}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: m.gap,
          marginTop: compact ? 0 : 6,
          // The balance's glow (`day-cash`'s 16px text-shadow blur) reads as
          // wider than its box, so a flex-end edge that is technically flush
          // with the button row looks short by a few px. Nudge to match the
          // eye, not the box.
          marginRight: compact ? 0 : -6,
        }}
      >
        {buttons.map((button) => {
          const muted = button.id === "music" && button.pressed;
          return (
            <button
              key={button.id}
              type="button"
              onClick={button.onPress}
              aria-label={button.label}
              aria-pressed={button.pressed}
              title={button.label}
              style={{
                width: m.button,
                height: m.button,
                borderRadius: "50%",
                background: "rgba(11,15,17,.6)",
                backdropFilter: "blur(14px)",
                border: "1px solid rgba(255,255,255,.1)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                opacity: 0.78,
                padding: 0,
              }}
            >
              <HudGlyph
                path={muted ? MUSIC_MUTED_ICON : icon[button.id]}
                size={m.glyph}
                strokeWidth={2.75}
                color={muted ? MUSIC_DIM_COLOR : HUD_CREAM}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
