import { resolveCockpitPitch } from "./cockpitLayout";
import { type InputFamily } from "./inputGuidance";
import { type InputCapabilities } from "./pointerCapabilities";
import type { CameraMode } from "./sessionContract";

/**
 * Owns adaptive input presentation for one live drive, and the cockpit
 * camera-pose math the first-person/rear-view cameras read every frame.
 *
 * No Babylon, no DOM — flat alongside its siblings touchSteering.ts and
 * inputGuidance.ts rather than under geometry/ or render/, since it owns
 * live per-frame state (timers, presentation) rather than being a pure
 * function of authored data. `eventNow` is duplicated rather than shared
 * with GameCanvas.tsx's own copy — the same house convention every other
 * extracted module follows for `clamp` and similar trivial helpers.
 */

export const INPUT_PROMPT_SWITCH_COOLDOWN_MS = 750;
export const TOUCH_CONTROL_DIM_DELAY_MS = 1_500;
export const COCKPIT_LOOK_MIN_PITCH_RAD = (-26 * Math.PI) / 180;
export const COCKPIT_LOOK_MAX_PITCH_RAD = (37 * Math.PI) / 180;

export interface AdaptiveInputPresentation {
  readonly activeFamily: InputFamily;
  readonly touchFirst: boolean;
  readonly touchRevealed: boolean;
  readonly touchControlsDimmed: boolean;
}
export interface CockpitCameraPoses {
  readonly first: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
  readonly rear: Readonly<{
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
  }>;
}

export function isCameraStackActive(
  mode: CameraMode,
  activeCameraName: string | null,
  activeCameraNames: readonly string[],
): boolean {
  // One scene camera in either mode. The rear-view camera used to be a second
  // entry here, rendering the mirror straight into a screen-space viewport; it
  // now belongs to a render target instead and never joins the scene's own
  // list, which is what lets the mirror be throttled.
  const mainCameraName =
    mode === "first_person" ? "first-person-camera" : "third-person-camera";
  return (
    activeCameraName === mainCameraName &&
    activeCameraNames.length === 1 &&
    activeCameraNames[0] === mainCameraName
  );
}

/**
 * Resolves cockpit cameras in world space so their movement never depends on
 * Babylon parent-transform propagation or multi-camera render ordering.
 */
export function resolveCockpitCameraPoses({
  x,
  z,
  vehicleHeading,
  cameraHeading,
  seatSide,
  headBob,
  quickLookAngle,
  lookPitchAngle = 0,
  viewportAspectRatio = 2,
}: {
  readonly x: number;
  readonly z: number;
  readonly vehicleHeading: number;
  readonly cameraHeading: number;
  readonly seatSide: number;
  readonly headBob: number;
  readonly quickLookAngle: number;
  readonly lookPitchAngle?: number;
  readonly viewportAspectRatio?: number;
}): CockpitCameraPoses {
  const forwardX = Math.sin(vehicleHeading);
  const forwardZ = Math.cos(vehicleHeading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const authoredPitch = resolveCockpitPitch(viewportAspectRatio);
  const lookPitch = Math.min(
    COCKPIT_LOOK_MAX_PITCH_RAD,
    Math.max(COCKPIT_LOOK_MIN_PITCH_RAD, authoredPitch + lookPitchAngle),
  );
  return {
    first: {
      x: x + rightX * seatSide - forwardX * 0.6,
      y: 1.49 + headBob,
      z: z + rightZ * seatSide - forwardZ * 0.6,
      rotationX: lookPitch,
      rotationY: cameraHeading + quickLookAngle,
    },
    rear: {
      x: x - forwardX * 0.52,
      y: 1.59,
      z: z - forwardZ * 0.52,
      rotationX: 0.04,
      rotationY: cameraHeading + Math.PI,
    },
  };
}

const eventNow = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

export function createInitialInputPresentation(
  capabilities: InputCapabilities,
): AdaptiveInputPresentation {
  return {
    activeFamily: capabilities.touchFirst ? "touch" : "keyboard",
    touchFirst: capabilities.touchFirst,
    touchRevealed: capabilities.touchFirst,
    touchControlsDimmed: false,
  };
}

/**
 * Owns adaptive input presentation for one live drive. It never disables an
 * input method: the active family only controls the prompts and touch-overlay
 * presentation.
 */
export class AdaptiveInputRouter {
  private capabilities: InputCapabilities;
  private presentation: AdaptiveInputPresentation;
  private reducedMotion: boolean;
  private lastPromptSwitchAt = Number.NEGATIVE_INFINITY;
  private pendingFamily: InputFamily | null = null;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private dimTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    capabilities: InputCapabilities,
    reducedMotion: boolean,
    private readonly onPresentationChange: (
      presentation: AdaptiveInputPresentation,
    ) => void,
    private readonly now: () => number = eventNow,
  ) {
    this.capabilities = capabilities;
    this.presentation = createInitialInputPresentation(capabilities);
    this.reducedMotion = reducedMotion;
  }

  getPresentation(): AdaptiveInputPresentation {
    return this.presentation;
  }

  setCapabilities(capabilities: InputCapabilities) {
    const changed =
      capabilities.touchFirst !== this.capabilities.touchFirst ||
      capabilities.hybridTouch !== this.capabilities.hybridTouch;
    if (!changed) return;
    this.capabilities = capabilities;

    let next: AdaptiveInputPresentation = {
      ...this.presentation,
      touchFirst: capabilities.touchFirst,
    };
    if (capabilities.touchFirst && !next.touchRevealed) {
      next = { ...next, touchRevealed: true };
    }
    if (!capabilities.touchFirst && next.touchControlsDimmed) {
      this.clearDimTimer();
      next = { ...next, touchControlsDimmed: false };
    }
    if (next !== this.presentation) {
      this.presentation = next;
      this.emitPresentation();
    }
    if (capabilities.touchFirst && this.presentation.activeFamily !== "touch") {
      this.scheduleTouchDimming();
    }
  }

  setReducedMotion(reducedMotion: boolean) {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    if (reducedMotion && this.pendingFamily) {
      this.applyActiveFamily(this.pendingFamily, this.now());
    }
    if (
      reducedMotion &&
      this.capabilities.touchFirst &&
      this.presentation.activeFamily !== "touch" &&
      !this.presentation.touchControlsDimmed
    ) {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }
  }

  registerMeaningfulInput(family: InputFamily) {
    if (this.disposed) return;
    if (family === "touch") this.revealTouchControls();

    if (family === this.presentation.activeFamily) {
      if (family === "touch") {
        this.restoreTouchControls();
      } else {
        this.scheduleTouchDimming();
      }
      return;
    }

    const now = this.now();
    const elapsed = now - this.lastPromptSwitchAt;
    if (this.reducedMotion || elapsed >= INPUT_PROMPT_SWITCH_COOLDOWN_MS) {
      this.applyActiveFamily(family, now);
      return;
    }

    this.pendingFamily = family;
    this.clearPromptTimer();
    this.promptTimer = setTimeout(() => {
      this.promptTimer = null;
      const pending = this.pendingFamily;
      this.pendingFamily = null;
      if (pending && !this.disposed) this.applyActiveFamily(pending, this.now());
    }, Math.max(0, INPUT_PROMPT_SWITCH_COOLDOWN_MS - elapsed));
  }

  handleGamepadDisconnect(): InputFamily {
    this.pendingFamily = null;
    this.clearPromptTimer();
    const fallback: InputFamily = this.capabilities.touchFirst ? "touch" : "keyboard";
    this.applyActiveFamily(fallback, this.now(), true);
    return fallback;
  }

  dispose() {
    this.disposed = true;
    this.clearPromptTimer();
    this.clearDimTimer();
  }

  private applyActiveFamily(family: InputFamily, now: number, force = false) {
    this.pendingFamily = null;
    this.clearPromptTimer();
    if (!force && family === this.presentation.activeFamily) return;

    this.lastPromptSwitchAt = now;
    this.presentation = {
      ...this.presentation,
      activeFamily: family,
      touchRevealed:
        this.presentation.touchRevealed || family === "touch" || this.capabilities.touchFirst,
    };
    if (family === "touch") {
      this.clearDimTimer();
      this.presentation = { ...this.presentation, touchControlsDimmed: false };
    } else {
      this.scheduleTouchDimming();
    }
    this.emitPresentation();
  }

  private revealTouchControls() {
    const shouldReveal = !this.presentation.touchRevealed;
    const shouldRestore = this.presentation.touchControlsDimmed || this.dimTimer !== null;
    if (!shouldReveal && !shouldRestore) return;
    this.clearDimTimer();
    this.presentation = {
      ...this.presentation,
      touchRevealed: true,
      touchControlsDimmed: false,
    };
    this.emitPresentation();
  }

  private restoreTouchControls() {
    if (!this.presentation.touchControlsDimmed && this.dimTimer === null) return;
    this.clearDimTimer();
    this.presentation = { ...this.presentation, touchControlsDimmed: false };
    this.emitPresentation();
  }

  private scheduleTouchDimming() {
    if (
      !this.capabilities.touchFirst ||
      this.presentation.activeFamily === "touch" ||
      this.presentation.touchControlsDimmed ||
      this.dimTimer !== null
    ) {
      return;
    }
    if (this.reducedMotion) {
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
      return;
    }
    this.dimTimer = setTimeout(() => {
      this.dimTimer = null;
      if (
        this.disposed ||
        !this.capabilities.touchFirst ||
        this.presentation.activeFamily === "touch"
      ) {
        return;
      }
      this.presentation = { ...this.presentation, touchControlsDimmed: true };
      this.emitPresentation();
    }, TOUCH_CONTROL_DIM_DELAY_MS);
  }

  private clearPromptTimer() {
    if (this.promptTimer === null) return;
    clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  private clearDimTimer() {
    if (this.dimTimer === null) return;
    clearTimeout(this.dimTimer);
    this.dimTimer = null;
  }

  private emitPresentation() {
    if (!this.disposed) this.onPresentationChange(this.presentation);
  }
}
