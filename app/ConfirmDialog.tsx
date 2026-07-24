"use client";

import { useEffect, useRef, type CSSProperties } from "react";

// The in-game replacement for native window.confirm(), whose stark browser
// chrome clashed with the dark HUD (#164). Props-pure so tests render it
// directly, and self-contained so it drops into any view. Two tones: the
// neutral "primary" (yellow CTA) for routine confirmations, and "danger"
// (coral CTA) for irreversible ones like deleting a save.

export interface ConfirmDialogProps {
  /** Bold heading, e.g. "End the day early?". */
  readonly title: string;
  /** The explanatory line under the title. */
  readonly body: string;
  /** Affirmative button label, e.g. "End day". */
  readonly confirmLabel: string;
  /** Dismiss button label. Defaults to "Cancel". */
  readonly cancelLabel?: string;
  /** "danger" paints the confirm button coral for irreversible actions. */
  readonly tone?: "primary" | "danger";
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Modal keyboard behaviour, intercepted in the capture phase so no key
  // reaches GameCanvas's window-level handler underneath — otherwise Escape
  // (and P) would toggle pause, resuming the drive behind the open dialog.
  // Escape dismisses; Tab is trapped between the two buttons; every other key
  // is swallowed to keep the paused drive inert, mirroring the OS-modal block
  // the native confirm gave us for free. Button activation (Enter/Space on the
  // focused button) is a default action, unaffected by stopping propagation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const buttons = Array.from(card.querySelectorAll<HTMLElement>("button"));
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !card.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onCancel]);

  // Land focus on the safe (dismiss) button so a stray Enter can't confirm a
  // destructive action.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
      data-testid="confirm-dialog"
      onClick={(event) => {
        // A click that lands on the scrim itself — not the card — dismisses.
        if (event.target === event.currentTarget) onCancel();
      }}
      style={scrimStyle}
    >
      <div ref={cardRef} style={cardStyle}>
        <strong id="confirm-dialog-title" style={titleStyle}>
          {title}
        </strong>
        <p id="confirm-dialog-body" style={bodyStyle}>
          {body}
        </p>
        <div style={rowStyle}>
          <button
            ref={cancelRef}
            type="button"
            data-testid="confirm-cancel"
            className="secondary-button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-accept"
            className={tone === "danger" ? "danger-button solid" : "primary-button"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const scrimStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: "1.5rem",
  background: "rgba(8, 12, 14, 0.62)",
  backdropFilter: "blur(6px)",
  zIndex: 60,
  fontFamily: "system-ui, sans-serif",
};

const cardStyle: CSSProperties = {
  width: "min(28rem, 100%)",
  boxSizing: "border-box",
  padding: "1.5rem 1.6rem 1.35rem",
  borderRadius: "1.1rem",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  background: "rgba(18, 24, 28, 0.94)",
  boxShadow:
    "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 24px 60px -20px rgba(0, 0, 0, 0.7)",
  color: "#f4efde",
};

const titleStyle: CSSProperties = {
  display: "block",
  fontSize: "1.18rem",
  fontWeight: 800,
  letterSpacing: "0.005em",
};

const bodyStyle: CSSProperties = {
  margin: "0.55rem 0 1.4rem",
  fontSize: "0.92rem",
  lineHeight: 1.5,
  color: "rgba(244, 239, 222, 0.72)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "0.6rem",
  flexWrap: "wrap",
};
