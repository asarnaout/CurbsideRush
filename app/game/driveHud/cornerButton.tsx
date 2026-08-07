/**
 * The round corner button the app (not the session) owns on a phone — music
 * and the city map, clear of `TouchDriveControls`' own camera/pause/
 * fullscreen row. Split out of `DriveHud.tsx` (#290).
 */

import { DRIVE_LAYER } from "../driveLayers";
import { HudGlyph, HUD_CREAM, MUSIC_DIM_COLOR } from "./tokens";
import { TOUCH_CORNER_SLOT_PX } from "../TouchDriveControls";

/**
 * A round button the app owns on a phone.
 *
 * `TouchDriveControls` starts its own row clear of these — camera, pause and
 * fullscreen are the session's, music and the city map are the app's, and the
 * two sets must not stack on top of each other. `TOUCH_CORNER_RAIL_PX` is the
 * width they agree on; a third app button means widening it.
 *
 * `slot` counts leftward from the corner, so slot 0 is the corner itself.
 */
export function DriveCornerButton({
  inset,
  slot = 0,
  icon,
  activeIcon,
  label,
  pressed,
  onPress,
  testId,
}: {
  inset: { readonly top: string; readonly right: string };
  slot?: number;
  icon: readonly string[];
  /** Swapped in while `pressed`, and dimmed — the muted note's treatment. */
  activeIcon?: readonly string[];
  label: string;
  pressed?: boolean;
  onPress: () => void;
  testId?: string;
}) {
  const dimmed = Boolean(pressed && activeIcon);
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      data-testid={testId}
      style={{
        position: "absolute",
        top: inset.top,
        right: `calc(${inset.right} + ${slot * TOUCH_CORNER_SLOT_PX}px)`,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "rgba(11,15,17,.6)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,.1)",
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: "pointer",
        zIndex: DRIVE_LAYER.action,
      }}
    >
      <HudGlyph
        path={dimmed ? activeIcon! : icon}
        size={19}
        strokeWidth={2.75}
        color={dimmed ? MUSIC_DIM_COLOR : HUD_CREAM}
      />
    </button>
  );
}
