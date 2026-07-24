// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../app/ConfirmDialog";

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="End the day early?"
      body="Today's progress is discarded and the day restarts."
      confirmLabel="End day"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("shows the title, body, and both button labels", () => {
    setup();
    expect(screen.getByText("End the day early?")).toBeVisible();
    expect(
      screen.getByText(/Today's progress is discarded/),
    ).toBeVisible();
    expect(screen.getByTestId("confirm-accept")).toHaveTextContent("End day");
    expect(screen.getByTestId("confirm-cancel")).toHaveTextContent("Cancel");
  });

  it("fires only onConfirm when the affirmative button is clicked", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByTestId("confirm-accept"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel from the dismiss button", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("dismisses on Escape without confirming", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(screen.getByTestId("confirm-dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("dismisses on a scrim click but not a click inside the card", () => {
    const { onCancel } = setup();
    // Click inside the card (the body text) — must not dismiss.
    fireEvent.click(screen.getByText(/Today's progress is discarded/));
    expect(onCancel).not.toHaveBeenCalled();
    // Click the scrim itself — dismisses.
    fireEvent.click(screen.getByTestId("confirm-dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("lands focus on the safe dismiss button", () => {
    setup();
    expect(screen.getByTestId("confirm-cancel")).toHaveFocus();
  });

  it("paints the confirm button as a solid danger CTA when tone is danger", () => {
    setup({ tone: "danger", confirmLabel: "Abandon career" });
    expect(screen.getByTestId("confirm-accept")).toHaveClass(
      "danger-button",
      "solid",
    );
  });

  it("uses the primary CTA class for the default tone", () => {
    setup();
    expect(screen.getByTestId("confirm-accept")).toHaveClass("primary-button");
  });

  it("traps Tab focus between the two buttons", () => {
    setup();
    const cancel = screen.getByTestId("confirm-cancel");
    const accept = screen.getByTestId("confirm-accept");
    // Focus starts on cancel (first). Shift+Tab wraps to the last button.
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(accept).toHaveFocus();
    // Tab off the last button wraps back to the first.
    fireEvent.keyDown(accept, { key: "Tab" });
    expect(cancel).toHaveFocus();
  });
});
