"use client";

/**
 * Sets expectations before the drive rather than after it.
 *
 * Neither piece of advice can be replaced by code on an iPhone. Safari has
 * never shipped `ScreenOrientation.lock()`, so the rotate gate is unavoidable;
 * and it has no Fullscreen API for anything but `<video>`, while its own
 * toolbar hiding only responds to scrolling — which the drive screen, being
 * `position: fixed` with `touch-action: none`, structurally cannot do. Added to
 * the Home Screen there is no browser chrome in the first place, so on that
 * device this is the whole answer rather than a nicety.
 */
export function MobilePlayTips({ needsHomeScreen }: { needsHomeScreen: boolean }) {
  // Styled in `globals.css` (`.launcher-tip`) rather than inline, unlike the
  // driving HUD: these are launcher chrome, and a landscape phone hides the
  // rotate line — which an inline `display` would have outranked.
  return (
    <>
      <p className="launcher-tip launcher-tip-rotate">
        <span aria-hidden="true">↻</span>
        Best played with your phone sideways.
      </p>
      {needsHomeScreen && (
        <p className="launcher-tip" data-testid="home-screen-tip">
          <span aria-hidden="true">⤴</span>
          <span>
            For a full screen with no browser bars, tap <strong>Share</strong>{" "}
            then <strong>Add to Home Screen</strong>, and open it from there.
          </span>
        </p>
      )}
    </>
  );
}
