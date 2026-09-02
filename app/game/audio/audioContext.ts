/**
 * The shared AudioContext.
 *
 * This is module-level rather than owned by the Babylon session on purpose.
 * GameCanvas remounts mid-session whenever the destination or steering side
 * changes, and a per-session context would be constructed and closed on each of
 * those — a click every time, and eventually fatal, since browsers cap how many
 * contexts a page may create. One context, suspended between drives, avoids
 * both and lets the drive-start click prime playback before the canvas mounts.
 */

type AudioContextConstructor = new () => AudioContext;

let shared: AudioContext | null = null;
let unlockInstalled = false;
let unavailable = false;
let playbackWanted = false;

const resolveConstructor = (): AudioContextConstructor | null => {
  if (typeof window === "undefined") return null;
  const legacy = window as unknown as { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? legacy.webkitAudioContext ?? null;
};

/**
 * Requests playback without leaking a rejected resume promise into the page.
 * Calling `resume()` while the context still reports `running` is intentional:
 * an earlier asynchronous `suspend()` may already be queued and must not win
 * after a new drive-start gesture.
 */
function requestResume(context: AudioContext): void {
  if (!playbackWanted || context.state === "closed") return;
  try {
    void context.resume().catch(() => {
      // The permanent input fallback below retries on the next real gesture.
    });
  } catch {
    // Some older implementations throw synchronously instead of rejecting.
  }
}

/**
 * Belt and braces: a late `suspend()`, rejected resume or WebKit `interrupted`
 * state is retried by the next real input. Keep this listener for the lifetime
 * of the singleton. Removing it after the first successful unlock made every
 * later drive vulnerable to an unrecoverable silent context.
 */
function installUnlockFallback(context: AudioContext): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    if (context.state !== "running") requestResume(context);
  };
  for (const type of events) window.addEventListener(type, unlock, true);
}

/**
 * Creates (once) and resumes the shared context, returning null when Web Audio
 * is unavailable so callers can carry on silently.
 *
 * Must be called synchronously inside a user-gesture handler: Safari only
 * honours a resume that happens in the same task as the gesture that triggered
 * it, so deferring this into an effect leaves the context suspended.
 */
export function primeAudioContext(): AudioContext | null {
  if (unavailable) return null;
  playbackWanted = true;
  try {
    if (!shared) {
      const Ctor = resolveConstructor();
      if (!Ctor) {
        unavailable = true;
        return null;
      }
      shared = new Ctor();
    }
    installUnlockFallback(shared);
    requestResume(shared);
    return shared;
  } catch {
    // Audio stays a progressive enhancement: the game is fully playable silent.
    unavailable = true;
    return null;
  }
}

/** The context if one already exists. Does not create or resume. */
export function peekAudioContext(): AudioContext | null {
  return shared;
}

/**
 * Parks the context between drives. Deliberately not `close()` — a closed
 * context can never be reopened, and the player will start another drive.
 */
export function suspendAudioContext(): void {
  playbackWanted = false;
  const context = shared;
  if (!context || context.state === "closed") return;
  try {
    void context
      .suspend()
      .then(() => {
        // `suspend()` is asynchronous. If another drive was started while it
        // was in flight, restore that newer intent instead of letting the old
        // exit operation silence the new session.
        if (playbackWanted) requestResume(context);
      })
      .catch(() => {
        // Parking audio is best-effort; playback recovery still happens on the
        // next drive-start/input gesture.
      });
  } catch {
    // Older Web Audio implementations may throw synchronously here too.
  }
}
