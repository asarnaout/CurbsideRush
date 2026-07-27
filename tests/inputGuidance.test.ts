import { describe, expect, it } from "vitest";
import { INPUT_GUIDANCE } from "../app/game/inputGuidance";

/**
 * Every key that works whenever you are driving, and where it is bound.
 *
 * The point of the list is the last column. `BabylonGameSession.installListeners`
 * owns all of these but M, which is `SideSwapApp`'s — and the copy describing
 * them is rendered by `GameCanvas`, a third place again. A binding added in one
 * ring and left out of the sentence in another is invisible until a player goes
 * looking for a control nobody mentioned.
 *
 * F and G are deliberately absent: they only do anything while an offer is up,
 * and the offer card prints its own keycap on each button, which is a better
 * place to learn them than a list you have to pause to read.
 */
const ALWAYS_LIVE_KEYS: readonly { readonly key: RegExp; readonly bound: string }[] = [
  { key: /\bW\b/, bound: "session" },
  { key: /\bS\b/, bound: "session" },
  { key: /\bSpace\b/, bound: "session" },
  { key: /\bA\/D\b/, bound: "session" },
  { key: /\bQ\/E\b/, bound: "session" },
  { key: /\bC\b/, bound: "session" },
  { key: /\bH\b/, bound: "session" },
  { key: /\bM\b/, bound: "app" },
  { key: /\bP\b/, bound: "session" },
  { key: /\bEscape\b/, bound: "session" },
];

describe("what the pause card promises", () => {
  it("names every always-live key, whichever ring binds it", () => {
    const copy = INPUT_GUIDANCE.keyboard.details;
    for (const { key, bound } of ALWAYS_LIVE_KEYS) {
      expect(copy, `${key} (${bound})`).toMatch(key);
    }
  });

  it("tells a keyboard player that M opens the map", () => {
    // Issue #216 asks for exactly this sentence.
    expect(INPUT_GUIDANCE.keyboard.details).toMatch(/M opens the map/i);
  });

  it("points a phone at the corner button instead, since there is no M", () => {
    expect(INPUT_GUIDANCE.touch.details).toMatch(/map/i);
    expect(INPUT_GUIDANCE.touch.details).toMatch(/top-right corner/i);
  });

  it("promises a controller nothing it does not have", () => {
    // No gamepad button opens the map, so the controller copy must not imply
    // one — a player would go hunting for a button that is not there.
    expect(INPUT_GUIDANCE.gamepad.details).not.toMatch(/map/i);
  });

  it("gives every input family a name and a sentence", () => {
    for (const family of ["keyboard", "gamepad", "touch"] as const) {
      expect(INPUT_GUIDANCE[family].label, family).toMatch(/\S/);
      expect(INPUT_GUIDANCE[family].details.length, family).toBeGreaterThan(80);
    }
  });
});
