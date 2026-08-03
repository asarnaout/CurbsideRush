import { useEffect, useRef } from "react";

/**
 * D-pad/left-stick focus movement and A/B activate/back across the app
 * shell's own screens (not the drive itself) — polled at 30 Hz since the
 * Gamepad API has no change events. Self-contained: closes over nothing but
 * its own two parameters.
 */
export function useGamepadUiNavigation(
  enabled: boolean,
  onBack: () => void,
) {
  const previousButtonsRef = useRef<boolean[]>([]);
  const previousDirectionsRef = useRef({ up: false, down: false });

  useEffect(() => {
    if (!enabled || !("getGamepads" in navigator)) return;

    const visibleFocusable = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const root = dialog ?? document.querySelector<HTMLElement>("main");
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.closest("[hidden], [aria-hidden=\"true\"]") &&
          element.getAttribute("aria-disabled") !== "true",
      );
    };
    const preferredFocusable = (items: HTMLElement[]) =>
      items.find((item) =>
        item.matches(
          ".launcher-primary:not(:disabled), .primary-button:not(:disabled)",
        ),
      ) ?? items[0];
    const moveFocus = (direction: -1 | 1) => {
      const items = visibleFocusable();
      if (!items.length) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        currentIndex < 0
          ? items.indexOf(preferredFocusable(items))
          : (currentIndex + direction + items.length) % items.length;
      items[Math.max(0, nextIndex)]?.focus();
    };
    const activateFocused = () => {
      const items = visibleFocusable();
      const active = document.activeElement as HTMLElement | null;
      const target = active && items.includes(active)
        ? active
        : preferredFocusable(items);
      target?.focus();
      target?.click();
    };
    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(gamepads).find(Boolean);
      if (!pad) {
        previousButtonsRef.current = [];
        previousDirectionsRef.current = { up: false, down: false };
        return;
      }
      const buttons = pad.buttons.map((button) => button.pressed);
      const up = Boolean(buttons[12]) || (pad.axes[1] ?? 0) <= -0.65;
      const down = Boolean(buttons[13]) || (pad.axes[1] ?? 0) >= 0.65;
      if (up && !previousDirectionsRef.current.up) moveFocus(-1);
      if (down && !previousDirectionsRef.current.down) moveFocus(1);
      if (buttons[0] && !previousButtonsRef.current[0]) activateFocused();
      if (buttons[1] && !previousButtonsRef.current[1]) onBack();
      previousButtonsRef.current = buttons;
      previousDirectionsRef.current = { up, down };
    };
    poll();
    const interval = window.setInterval(poll, 1000 / 30);
    return () => window.clearInterval(interval);
  }, [enabled, onBack]);
}
