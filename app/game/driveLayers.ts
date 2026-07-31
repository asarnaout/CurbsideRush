/**
 * The drive screen's one and only stacking order.
 *
 * The 3D view and the driving controls live in `GameCanvas`; the status panel,
 * minimap and toasts live in `SideSwapApp`. They are siblings in the
 * `.game-page` stacking context, so their z-indices have to be read together —
 * and for a long time they weren't: the HUD sat on `zIndex: 5` while the touch
 * controls had none, which painted the steering pad underneath the wallet card
 * and the pedals underneath the minimap. Both HUD panels are `pointerEvents:
 * "none"`, so the controls stayed tappable and nothing failed; they were simply
 * invisible, and no test could see it.
 *
 * Every absolutely-positioned layer on the drive screen takes its z-index from
 * here. A new overlay that hard-codes a number instead is the same bug again.
 *
 * `GameCanvas`'s shell deliberately does NOT set `isolation: "isolate"`. That
 * would make its whole subtree one atomic unit at the shell's own level, and no
 * z-index on a control could then rise above a HUD sibling.
 */
export const DRIVE_LAYER = Object.freeze({
  /**
   * The scene scrim: edge vignette + the bands the HUD reads against. Above the
   * canvas, below every readout, and `pointerEvents: "none"` throughout.
   */
  scrim: 5,
  /** Status panel, minimap, speed readout. Readouts, never targets. */
  hud: 10,
  /** Steering region, pedals, camera/horn/pause cluster. Must clear the HUD. */
  touch: 20,
  /** Fine toast, cutscene caption, day title — transient, above everything read. */
  toast: 30,
  /** Refuel button, pause dialog: things you tap that outrank driving. */
  action: 40,
  /**
   * The live offer — the one thing that outranks the whole-city map.
   *
   * `ExpandedMap` is at `action` and renders after the offer, so on the shared
   * rung a map left open buried ACCEPT for the whole fifteen seconds. The map
   * used to close itself on every offer to avoid that, which cost the player
   * the map they had deliberately opened (#241). A rung up, the card floats
   * over the map instead and is answered while the dashed line to the pickup
   * is on screen.
   */
  offer: 45,
  /** Full-bleed curtains — tow, loading/critical, the rotate gate. */
  curtain: 50,
});
