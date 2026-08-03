import type { Engine, Mesh, ShadowGenerator, TransformNode } from "@babylonjs/core";
import {
  RENDER_SCALING_WINDOW_MS,
  stepRenderScaling,
  TOUCH_SCALING_LADDER,
  type RenderScalingState,
} from "../renderScaling";
import type { CameraMode } from "../sessionContract";

/**
 * The touch-only render-scaling governor: every `RENDER_SCALING_WINDOW_MS`
 * window, trade resolution (`Engine.setHardwareScalingLevel`) and secondary
 * costs (sun shadows, the windscreen's alpha-blended glass, the mirrors)
 * against measured frame rate, climbing back the instant headroom returns.
 *
 * De-methodized (Phase 3.8). `governRenderScaling` runs every frame — unlike
 * every other Phase 3 extraction, which is a one-shot build call — so
 * `lastRenderScalingCheck`, the one field it only reads and writes here,
 * can't become an ordinary ctx field the session sets up once: it must
 * persist from this call to the next, so it comes back as a returned record
 * the caller assigns, present only on the window where the governor actually
 * ran — the same shape Phase 3.1 established for one-shot builders, adapted
 * for a per-frame caller. `mirrorsAllowed` looks like the same case but
 * isn't: `setMirrorsActive` (session-resident, cross-cargo — Phase 3.12's
 * `mirrorRig`) reads it *during this same call*, so it must be written
 * through a ctx setter at the exact point the original assigned it, not
 * deferred to the caller — deferring it left the recovery frame (blurriest
 * rung climbing back to the top) reading the previous window's stale value
 * and silently skipping the mirrors' re-enable. `setMirrorsActive` and
 * `syncWingMirrorVisibility` are threaded as ctx callbacks for the same
 * cross-cargo reason; every caller should stay agnostic to where they
 * currently live.
 */

export interface PerfGovernorCtx {
  readonly renderScaling: RenderScalingState | null;
  readonly paused: boolean;
  readonly contextLost: boolean;
  readonly renderScalingArmedAt: number;
  readonly lastRenderScalingCheck: number;
  readonly engine: Engine;
  readonly shadowGenerator: ShadowGenerator | null;
  readonly windscreenParts: readonly Mesh[];
  readonly cameraMode: CameraMode;
  readonly rearViewPanel: Mesh | null;
  readonly wingMirrorRig: TransformNode | null;
  readonly setMirrorsAllowed: (allowed: boolean) => void;
  readonly setMirrorsActive: (active: boolean) => void;
  readonly syncWingMirrorVisibility: () => void;
}

export interface RenderScalingGovernResult {
  readonly lastRenderScalingCheck: number;
}

/**
 * Trades resolution against frame rate, on touch only.
 *
 * Quiet while paused — a stalled frame rate would read as a device in
 * trouble and blur the scene the player is staring at — and quiet for the
 * first seconds after ready, where the frame rate still carries model upload
 * and shader warm-up rather than anything about the device.
 */
export function governRenderScaling(
  ctx: PerfGovernorCtx,
  now: number,
): RenderScalingGovernResult | undefined {
  if (!ctx.renderScaling || ctx.paused || ctx.contextLost) return undefined;
  if (now < ctx.renderScalingArmedAt) return undefined;
  if (now - ctx.lastRenderScalingCheck < RENDER_SCALING_WINDOW_MS) return undefined;
  const level = stepRenderScaling(ctx.renderScaling, ctx.engine.getFps());
  if (level !== ctx.engine.getHardwareScalingLevel()) {
    ctx.engine.setHardwareScalingLevel(level);
  }
  applyPerfRung(ctx, ctx.renderScaling.index);
  return { lastRenderScalingCheck: now };
}

/**
 * Non-resolution costs stepped with the touch ladder. Only the blurriest
 * rung sheds the sun shadows — a device that cannot hold the softest
 * resolution needs its per-frame budget back more than shadow polish; the
 * governor restores them the moment it climbs. Toggling light.shadowEnabled
 * skips the shadow-map render without any resize, so unlike the resolution
 * rungs it can never flash (flashes come from setHardwareScalingLevel's
 * resize recompiling the bloom kernels — see renderScaling.ts).
 */
function applyPerfRung(ctx: PerfGovernorCtx, rungIndex: number): void {
  const topRung = rungIndex < TOUCH_SCALING_LADDER.length - 1;
  const light = ctx.shadowGenerator?.getLight();
  if (light && light.shadowEnabled !== topRung) {
    light.shadowEnabled = topRung;
  }
  // The windscreen panes are the cabin's only fill-rate cost: two large
  // alpha-blended quads across most of the frame. Everything else in there is
  // a handful of opaque triangles, so this is the only cockpit detail worth
  // shedding, and the wipers go with the glass because a wiper resting on
  // nothing reads as a bug.
  for (const part of ctx.windscreenParts) {
    if (part.isEnabled(false) !== topRung) part.setEnabled(topRung);
  }
  // The mirrors are render targets: a device that cannot hold the softest
  // resolution should not be rendering the scene a second and third time for
  // two small panels, however cheap the cull has made them.
  ctx.setMirrorsAllowed(topRung);
  ctx.setMirrorsActive(topRung && ctx.cameraMode === "first");
  ctx.rearViewPanel?.setEnabled(topRung);
  if (!topRung) ctx.wingMirrorRig?.setEnabled(false);
  else ctx.syncWingMirrorVisibility();
}
