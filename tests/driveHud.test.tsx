// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DriveMoneyCluster,
  DriveNavCard,
  DriveOfferCard,
  DriveSpeedCluster,
  DriveSurgeBanner,
  FUSE_SMOOTHING_MS,
  HUD_DESIGN_WIDTH,
  HUD_MIN_SCALE,
  resolveHudScale,
  SPEED_ALARM_OVER,
  SPEED_WARN_OVER,
  type HudGauge,
  type HudJob,
  type HudManoeuvre,
  type HudOffer,
} from "../app/game/DriveHud";
import { DRIVE_LAYER } from "../app/game/driveLayers";

afterEach(cleanup);

const inset = { top: "1rem", left: "1rem", right: "1rem" };

const manoeuvre = (patch: Partial<HudManoeuvre> = {}): HudManoeuvre => ({
  kind: "left",
  street: "Broadway",
  distanceValue: "0.3",
  distanceUnit: "mi",
  imminent: false,
  destinationProgress: 0.4,
  destinationDistance: "1.2 mi",
  ...patch,
});

const gauges: readonly HudGauge[] = [
  { id: "fuel", icon: ["M3 22V4"], label: "Fuel", value: "88%", fill: 0.88, fillColor: "#8fae72" },
  { id: "condition", icon: ["M3 13h18"], label: "Car", value: "100%", fill: 1, fillColor: "#8fae72" },
];

const job = (patch: Partial<HudJob> = {}): HudJob => ({
  kind: "delivery",
  eyebrow: "PICK UP",
  target: "West 106th Grocers",
  sub: "then 214 W 108th St",
  pay: "+$19.34",
  tip: null,
  surged: false,
  ...patch,
});

const offer = (patch: Partial<HudOffer> = {}): HudOffer => ({
  kind: "delivery",
  pay: "+$12.40",
  bonus: "+$4.10 tip",
  title: "Amsterdam Bagels",
  sub: "then 214 W 108th St",
  chips: ["0.4 mi away", "3 items"],
  footnote: "Stacks after West 106th Grocers",
  secondsLeft: 12,
  elapsed: 0.2,
  surged: false,
  ...patch,
});

const navCard = (props: Partial<Parameters<typeof DriveNavCard>[0]> = {}) =>
  render(
    <DriveNavCard
      scale={1}
      inset={inset}
      manoeuvre={manoeuvre()}
      nextManoeuvre={null}
      job={job()}
      idleLabel="Waiting for a job…"
      gauges={gauges}
      queued={null}
      {...props}
    />,
  );

describe("hud scaling", () => {
  it("leaves the comp alone at the width it was drawn for", () => {
    expect(resolveHudScale(HUD_DESIGN_WIDTH)).toBe(1);
    expect(resolveHudScale(HUD_DESIGN_WIDTH * 2)).toBe(1);
  });

  it("shrinks on a narrower window, but only so far", () => {
    // A 486px nav card is a quarter of a 1920 screen and well over a third of a
    // 1280 one — the difference between a readout and an obstruction.
    expect(resolveHudScale(1_440)).toBeCloseTo(1_440 / HUD_DESIGN_WIDTH, 5);
    // The floor bites below about 1305px, which takes in 1280-wide laptops.
    expect(resolveHudScale(1_280)).toBe(HUD_MIN_SCALE);
    expect(resolveHudScale(600)).toBe(HUD_MIN_SCALE);
    expect(resolveHudScale(0)).toBe(1);
    expect(resolveHudScale(Number.NaN)).toBe(1);
  });
});

describe("the nav card", () => {
  it("tells the driver where to turn, and onto what", () => {
    navCard();
    expect(screen.getByTestId("manoeuvre-distance")).toHaveTextContent("0.3");
    expect(screen.getByTestId("manoeuvre-street")).toHaveTextContent("Broadway");
    expect(screen.getByText("HEAD LEFT ONTO")).toBeVisible();
  });

  it("switches from describing the turn to calling it, close in", () => {
    navCard({ manoeuvre: manoeuvre({ imminent: true }) });
    expect(screen.getByText("TURN LEFT NOW")).toBeVisible();
  });

  it("words every kind of manoeuvre as a driver would say it", () => {
    for (const [kind, far, near] of [
      ["straight", "CONTINUE ONTO", "CONTINUE AHEAD"],
      ["uturn", "U-TURN ONTO", "U-TURN NOW"],
      ["right", "HEAD RIGHT ONTO", "TURN RIGHT NOW"],
      ["arrive", "ARRIVE AT", "ARRIVING"],
    ] as const) {
      cleanup();
      navCard({ manoeuvre: manoeuvre({ kind, imminent: false }) });
      expect(screen.getByText(far)).toBeVisible();
      cleanup();
      navCard({ manoeuvre: manoeuvre({ kind, imminent: true }) });
      expect(screen.getByText(near)).toBeVisible();
    }
  });

  it("measures the bar against the whole run to the stop, not the next turn", () => {
    // The comp's bar meant proximity to the manoeuvre, which sawtoothed back to
    // empty at every corner and said nothing about how far was left.
    navCard({
      manoeuvre: manoeuvre({ destinationProgress: 0.25, destinationDistance: "1.2 mi" }),
    });
    expect(screen.getByTestId("destination-progress")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("destination-distance")).toHaveTextContent("1.2 mi");
    // Labelled, because a bar that silently changed meaning is worse than one
    // that never had a caption.
    expect(screen.getByText("TO GO")).toBeVisible();
  });

  it("clamps the bar rather than overflowing it", () => {
    navCard({ manoeuvre: manoeuvre({ destinationProgress: 1.4 }) });
    expect(screen.getByTestId("destination-progress")).toHaveStyle({ width: "100%" });
    cleanup();
    navCard({ manoeuvre: manoeuvre({ destinationProgress: -0.2 }) });
    expect(screen.getByTestId("destination-progress")).toHaveStyle({ width: "0%" });
  });

  it("shows the job in hand and what it pays", () => {
    navCard();
    expect(screen.getByText("PICK UP")).toBeVisible();
    expect(screen.getByText("West 106th Grocers")).toBeVisible();
    expect(screen.getByTestId("job-pay")).toHaveTextContent("+$19.34");
    expect(screen.queryByTestId("dispatch-idle")).not.toBeInTheDocument();
  });

  it("says the driver is waiting when there is nothing in hand", () => {
    navCard({ job: null });
    expect(screen.getByTestId("dispatch-idle")).toHaveTextContent(
      "Waiting for a job…",
    );
    expect(screen.queryByTestId("job-pay")).not.toBeInTheDocument();
  });

  it("names a quoted tip, because the driver is owed it either way", () => {
    navCard({ job: job({ tip: "Tip $4.10 already added" }) });
    expect(screen.getByTestId("job-tip")).toHaveTextContent("$4.10");
  });

  it("keeps the gauges announceable", () => {
    // careerFlow.test.tsx queries on exactly these labels to tell a bicycle day
    // (no fuel gauge at all) from every other one.
    navCard();
    expect(screen.getByText("Fuel")).toBeInTheDocument();
    expect(screen.getByText("Car")).toBeInTheDocument();
    cleanup();
    navCard({ gauges: [gauges[1]] });
    expect(screen.queryByText("Fuel")).not.toBeInTheDocument();
  });

  it("shows a queued job only once one is queued", () => {
    navCard();
    expect(screen.queryByTestId("queued-gig")).not.toBeInTheDocument();
    cleanup();
    navCard({ queued: { title: "Amsterdam Bagels", pay: "+$12.40" } });
    expect(screen.getByTestId("queued-gig")).toHaveTextContent("NEXT UP");
    expect(screen.getByTestId("queued-gig")).toHaveTextContent("+$12.40");
  });

  it("reads as a readout rather than a target", () => {
    // The panel must never eat a click meant for the road or a control.
    const { container } = navCard();
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.hud);
  });
});

describe("the speed cluster", () => {
  const speed = (props: Partial<Parameters<typeof DriveSpeedCluster>[0]> = {}) =>
    render(
      <DriveSpeedCluster
        scale={1}
        inset={inset}
        speed={30}
        speedUnit="mph"
        speedLimit={30}
        gear="D"
        {...props}
      />,
    );

  it("posts the limit beside the speed", () => {
    speed();
    expect(screen.getByTestId("speed-limit-sign")).toHaveTextContent("30");
    expect(screen.getByText("SPEED")).toBeVisible();
    expect(screen.getByText("LIMIT")).toBeVisible();
  });

  it("hides the sign rather than posting a zero", () => {
    // The simulation reports zero wherever the lane projection fails, and a
    // sign blinking to zero at every junction is worse than no sign.
    speed({ speedLimit: 0 });
    expect(screen.queryByTestId("speed-limit-sign")).not.toBeInTheDocument();
    expect(screen.getByTestId("speed-value")).toHaveTextContent("30");
  });

  it("escalates the readout as the driver goes further over", () => {
    const colourAt = (over: number) => {
      cleanup();
      speed({ speed: 30 + over, speedLimit: 30 });
      return screen.getByTestId("speed-value").style.color;
    };
    const legal = colourAt(0);
    const warn = colourAt(SPEED_WARN_OVER);
    const alarm = colourAt(SPEED_ALARM_OVER);
    expect(warn).not.toBe(legal);
    expect(alarm).not.toBe(warn);
    // Just under the threshold is still the calm colour.
    expect(colourAt(SPEED_WARN_OVER - 1)).toBe(legal);
  });

  it("never warns when there is no limit to be over", () => {
    speed({ speed: 90, speedLimit: 0 });
    expect(screen.getByTestId("speed-value").style.color).toBe("rgb(244, 239, 222)");
  });
});

describe("the offer card", () => {
  const card = (
    props: Partial<Parameters<typeof DriveOfferCard>[0]> = {},
  ) => {
    const onAccept = vi.fn();
    const onPass = vi.fn();
    render(
      <DriveOfferCard
        scale={1}
        inset={inset}
        offer={offer()}
        acceptKey="F"
        passKey="G"
        onAccept={onAccept}
        onPass={onPass}
        {...props}
      />,
    );
    return { onAccept, onPass };
  };

  it("puts the pay, the job and the clock in front of the driver", () => {
    card();
    expect(screen.getByTestId("offer-pay")).toHaveTextContent("+$12.40");
    expect(screen.getByTestId("offer-bonus")).toHaveTextContent("+$4.10 tip");
    expect(screen.getByText("Amsterdam Bagels")).toBeVisible();
    expect(screen.getByTestId("offer-countdown")).toHaveTextContent("12");
    expect(screen.getByText("FOOD DELIVERY")).toBeVisible();
  });

  it("labels a fare as a fare", () => {
    card({ offer: offer({ kind: "passenger", bonus: null }) });
    expect(screen.getByText("RIDESHARE")).toBeVisible();
    expect(screen.queryByTestId("offer-bonus")).not.toBeInTheDocument();
  });

  it("shows which keys answer it", () => {
    card();
    expect(screen.getByTestId("offer-accept")).toHaveTextContent("F");
    expect(screen.getByTestId("offer-pass")).toHaveTextContent("G");
    expect(screen.getByTestId("offer-accept")).toHaveAccessibleName(
      "Accept this job (F)",
    );
  });

  it("answers to the mouse as well as the keyboard", () => {
    const { onAccept, onPass } = card();
    fireEvent.click(screen.getByTestId("offer-pass"));
    expect(onPass).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("burns the fuse in step with the window, and reddens near the end", () => {
    const fuse = () => document.querySelectorAll("rect")[1] as SVGRectElement;
    card({ offer: offer({ elapsed: 0 }) });
    expect(fuse().style.strokeDashoffset).toBe("0");
    expect(fuse().getAttribute("stroke")).toBe("#201e1d");

    cleanup();
    card({ offer: offer({ elapsed: 0.5 }) });
    // pathLength is normalised to 1000, so the offset *is* the fraction burnt
    // whatever the card's real perimeter.
    expect(fuse().style.strokeDashoffset).toBe("500");

    cleanup();
    card({ offer: offer({ elapsed: 0.9 }) });
    expect(fuse().getAttribute("stroke")).toBe("#d9614c");
  });

  it("interpolates between HUD samples rather than stepping with them", () => {
    // `elapsed` arrives ~10 times a second; without this the stroke jumps a
    // fifteenth of the border at a time and reads as a stutter.
    card();
    const fuse = document.querySelectorAll("rect")[1] as SVGRectElement;
    expect(fuse.style.transition).toContain("stroke-dashoffset");
    expect(fuse.style.transition).toContain("linear");
    // Longer than the publish interval, or the smoothing cannot bridge a gap.
    expect(FUSE_SMOOTHING_MS).toBeGreaterThan(100);
  });

  it("sits where it can actually be clicked", () => {
    // The nav card is pointerEvents:"none", so an accept button could never
    // have lived inside it — this has to outrank the read-only HUD layer.
    const { container } = render(
      <DriveOfferCard
        scale={1}
        inset={inset}
        offer={offer()}
        acceptKey="F"
        passKey="G"
        onAccept={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.action);
    expect(DRIVE_LAYER.action).toBeGreaterThan(DRIVE_LAYER.hud);
  });
});

describe("the money cluster", () => {
  const money = (props: Partial<Parameters<typeof DriveMoneyCluster>[0]> = {}) => {
    const press = vi.fn();
    render(
      <DriveMoneyCluster
        scale={1}
        inset={inset}
        balance="$248.60"
        balanceLabel="Wallet"
        session="+$62.10"
        sessionLabel="TODAY"
        gain={null}
        buttons={[
          { id: "music", label: "Mute music", pressed: false, onPress: press },
          { id: "camera", label: "Switch camera", onPress: press },
          { id: "pause", label: "Pause", onPress: press },
        ]}
        {...props}
      />,
    );
    return press;
  };

  it("shows the balance and what the shift has made", () => {
    money();
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$248.60");
    expect(screen.getByText("+$62.10")).toBeVisible();
    expect(screen.getByTestId("day-clock")).toHaveTextContent("TODAY");
  });

  it("carries the career day and its clock in the same line", () => {
    money({ sessionLabel: "DAY 3 · 4:12" });
    expect(screen.getByTestId("day-clock")).toHaveTextContent("DAY 3 · 4:12");
  });

  it("floats the gain only while there is one", () => {
    money();
    expect(screen.getByTestId("money-gain")).toHaveStyle({ opacity: "0" });
    cleanup();
    money({ gain: "+$19.34" });
    const gain = screen.getByTestId("money-gain");
    expect(gain).toHaveTextContent("+$19.34");
    expect(gain).toHaveStyle({ opacity: "1" });
  });

  it("gives the desktop the three controls it never had", () => {
    const press = money();
    for (const name of ["Mute music", "Switch camera", "Pause"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(press).toHaveBeenCalledTimes(3);
  });

  it("is a target, not a readout", () => {
    const { container } = render(
      <DriveMoneyCluster
        scale={1}
        inset={inset}
        balance="$0.00"
        balanceLabel="Wallet"
        session="+$0.00"
        sessionLabel="TODAY"
        gain={null}
        buttons={[]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.action);
  });
});

describe("the surge banner", () => {
  it("says what is on and how long it lasts", () => {
    render(
      <DriveSurgeBanner scale={1} inset={inset} multiplier={2} remaining="1:14" />,
    );
    const banner = screen.getByTestId("surge-banner");
    expect(banner).toHaveTextContent("SURGE ×2");
    expect(banner).toHaveTextContent("1:14");
    // Transient and above everything read, like the other toasts.
    expect(Number(banner.style.zIndex)).toBe(DRIVE_LAYER.toast);
  });
});
