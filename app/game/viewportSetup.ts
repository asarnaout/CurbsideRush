/**
 * Browser viewport plumbing the framework does not do for us.
 *
 * Everything here is best-effort: none of it has a return value anything is
 * allowed to depend on, because each piece is missing on some browser that
 * still has to be able to play the game.
 */

/**
 * Makes `env(safe-area-inset-*)` mean something.
 *
 * Those variables resolve to `0px` unless the viewport meta carries
 * `viewport-fit=cover`, which means every notch and home-indicator inset in the
 * driving HUD and controls is silently dead without it.
 *
 * It has to be patched at runtime rather than declared: `vinext`'s `Viewport`
 * shim (unlike Next's own) has no `viewportFit` field, so an
 * `export const viewport` from `app/layout.tsx` is dropped on the floor. Editing
 * the tag the shim already rendered works identically in dev, in the Worker and
 * in the prerendered static build.
 */
export function applyViewportFitCover(doc: Document = document): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  if (meta.content.includes("viewport-fit")) return;
  meta.content = `${meta.content.trim().replace(/,\s*$/, "")}, viewport-fit=cover`;
}

/*
 * ## Why fullscreen has to be a button
 *
 * Mobile Safari hides its toolbars in landscape, but only in response to
 * *scrolling* — and the drive screen is `position: fixed; inset: 0` with
 * `overscroll-behavior: none` and `touch-action: none`, so the document cannot
 * scroll at all and Safari has nothing to react to. Rotating on the launcher
 * (a scrollable page) hides the chrome and the state survives into the drive;
 * rotating once the drive has started cannot, ever.
 *
 * There is no CSS or scroll trick that fixes that without breaking the control
 * surface, so the Fullscreen API is the only route — and the API needs a user
 * gesture, which means an affordance the player can reach at the moment they
 * want it. Requesting once at drive start (as this first did) helps only the
 * players who were already in landscape when they tapped Start.
 */

type FullscreenCapableElement = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type OrientationLock = { lock?: (orientation: string) => Promise<void> };

/**
 * WebKit unprefixed the Fullscreen API on macOS and iPadOS in Safari 16.4 and
 * brought it to iPhone in 17.2-17.4. Both spellings are checked because the
 * prefixed one is all an older iOS has, and a `requestFullscreen` guard alone
 * silently no-ops there — which looks exactly like the feature not working.
 */
export function canFullscreen(element: Element | null = null): boolean {
  if (typeof document === "undefined") return false;
  const target = (element ?? document.documentElement) as FullscreenCapableElement | null;
  if (!target) return false;
  return (
    typeof target.requestFullscreen === "function" ||
    typeof target.webkitRequestFullscreen === "function"
  );
}

export function isFullscreen(doc: Document = document): boolean {
  const d = doc as FullscreenCapableDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/**
 * Goes fullscreen and, where the browser allows it, pins landscape.
 *
 * Must be called synchronously from a click handler — the same
 * transient-activation rule that governs `primeAudioContext`.
 *
 * Deliberately no `navigationUI` option: it is only a hint, WebKit does not
 * implement it, and passing an options dictionary is a needless way to lose the
 * whole call on a browser that objects to it.
 *
 * `ScreenOrientation.lock()` has never shipped in Safari, and where it exists
 * MDN requires the context to be fullscreen first — hence the ordering, and
 * hence the rotate gate still existing.
 */
export function requestImmersiveLandscape(element: Element): void {
  const target = element as FullscreenCapableElement;
  void (async () => {
    try {
      if (!isFullscreen()) {
        if (typeof target.requestFullscreen === "function") {
          await target.requestFullscreen();
        } else if (typeof target.webkitRequestFullscreen === "function") {
          await target.webkitRequestFullscreen();
        }
      }
    } catch {
      // Denied or unsupported. The player can tap the control again.
    }
    try {
      const orientation = screen.orientation as ScreenOrientation & OrientationLock;
      await orientation?.lock?.("landscape");
    } catch {
      // Safari has never supported this. The rotate gate covers it.
    }
  })();
}

export function exitFullscreen(): void {
  const d = document as FullscreenCapableDocument;
  void (async () => {
    try {
      if (!isFullscreen()) return;
      if (typeof d.exitFullscreen === "function") await d.exitFullscreen();
      else if (typeof d.webkitExitFullscreen === "function") await d.webkitExitFullscreen();
    } catch {
      // Already left, or the browser took us out itself.
    }
  })();
}

/**
 * Subscribes to fullscreen entering *and* leaving. Leaving matters as much as
 * entering: iOS exits on a swipe with no button press, and a control that only
 * tracked its own taps would then offer to do something already done.
 */
export function onFullscreenChange(handler: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  return () => {
    document.removeEventListener("fullscreenchange", handler);
    document.removeEventListener("webkitfullscreenchange", handler);
  };
}

/**
 * True when launched from the Home Screen, where iOS gives real fullscreen with
 * no browser chrome at all and the in-game control would be pointless.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (legacy === true) return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  );
}
