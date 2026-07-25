/**
 * What kind of pointer is driving the page.
 *
 * Its own module rather than a corner of `GameCanvas.tsx` because the app shell
 * needs the same answer to lay the driving HUD out — and `SideSwapApp` loads
 * `GameCanvas` through `dynamic()` precisely so that Babylon stays out of the
 * initial bundle. Importing the detection from there would drag the whole
 * renderer back in.
 *
 * One source of truth, deliberately: a second copy of this test would drift,
 * and a HUD that thinks it is on a desktop while the controls think they are on
 * a phone lays panels straight over the thumb zones.
 */
export interface InputCapabilities {
  readonly touchFirst: boolean;
  readonly hybridTouch: boolean;
}

export function readInputCapabilities(): InputCapabilities {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { touchFirst: false, hybridTouch: false };
  }
  const touchFirst = window.matchMedia("(pointer: coarse)").matches;
  const anyCoarsePointer = window.matchMedia("(any-pointer: coarse)").matches;
  return {
    touchFirst,
    hybridTouch: !touchFirst && anyCoarsePointer,
  };
}
