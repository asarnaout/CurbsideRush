/**
 * Browser viewport plumbing the framework does not do for us.
 *
 * Both functions here are best-effort by design: neither has a return value
 * anything is allowed to depend on, because on iPhone — the majority of a web
 * game's phone traffic — one of them cannot work at all.
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

interface OrientationLock {
  lock?: (orientation: string) => Promise<void>;
}

/**
 * Asks for fullscreen landscape. Silently does nothing where it cannot.
 *
 * Must be called synchronously from within a click handler — the same
 * transient-activation rule that governs `primeAudioContext`.
 *
 * Support is narrower than it looks. `ScreenOrientation.lock()` has never
 * shipped in Safari (desktop or iOS) and WebKit's own bug for it notes that
 * iPad multitasking structurally prevents locking; where it does exist, MDN
 * requires the browsing context to be fullscreen first. So this is an Android
 * nicety that saves a rotation, never a guarantee — which is why the rotate
 * gate still has to exist and has to be cheap.
 */
export function requestLandscapeLock(element: Element): void {
  void (async () => {
    try {
      if (!document.fullscreenElement && element.requestFullscreen) {
        await element.requestFullscreen({ navigationUI: "hide" });
      }
      const orientation = screen.orientation as ScreenOrientation & OrientationLock;
      await orientation?.lock?.("landscape");
    } catch {
      // Denied, unsupported, or interrupted. The rotate gate covers it.
    }
  })();
}

/** Whether offering the lock is worth the screen space. */
export function canLockLandscape(): boolean {
  if (typeof window === "undefined" || typeof screen === "undefined") return false;
  const orientation = screen.orientation as (ScreenOrientation & OrientationLock) | undefined;
  return typeof orientation?.lock === "function";
}
