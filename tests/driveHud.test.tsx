// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DAY_TIMER_CRITICAL_S,
  DAY_TIMER_METRICS,
  DAY_TIMER_MIN_VIEWPORT_PX,
  DAY_TIMER_WARN_S,
  DriveCornerButton,
  DriveDayEdge,
  DriveMoneyCluster,
  DriveNavCard,
  DriveOfferCard,
  DriveSpeedCluster,
  DriveSurgeBanner,
  DriveOfferBar,
  FUSE_SMOOTHING_MS,
  HUD_CREAM,
  HUD_DESIGN_WIDTH,
  HUD_MIN_SCALE,
  MOBILE_OFFER_H,
  RAIL_MIN_SLOT_PX,
  resolveDayTimer,
  resolveHudScale,
  speedOverBand,
  type HudGauge,
  type HudJob,
  type HudManoeuvre,
  type HudOffer,
} from "../app/game/DriveHud";
import { MAP_ICON, MUSIC_ICON, MUSIC_MUTED_ICON } from "../app/game/hudIcons";
import {
  TOUCH_CORNER_RAIL_PX,
  TOUCH_CORNER_SLOT_PX,
  TOUCH_PEDAL_ROW_PX,
} from "../app/game/TouchDriveControls";
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
  hint: null,
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
  detour: "0.4 mi",
  meta: "3 items",
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
    const band = speedOverBand("mph");
    const legal = colourAt(0);
    const warn = colourAt(band.warn);
    const alarm = colourAt(band.alarm);
    expect(warn).not.toBe(legal);
    expect(alarm).not.toBe(warn);
    // Just under the threshold is still the calm colour.
    expect(colourAt(band.warn - 1)).toBe(legal);
  });

  it("reads the same margin of road in km/h as in mph", () => {
    // The bug this pins: a flat mph band applied to a km/h readout alarmed at
    // 3.7 mph over. Both bands must describe the same overspeed, so a figure
    // that is calm in mph stays calm at its metric equivalent.
    const colourAt = (unit: string, over: number) => {
      cleanup();
      speed({ speed: 40 + over, speedLimit: 40, speedUnit: unit });
      return screen.getByTestId("speed-value").style.color;
    };
    const calm = colourAt("mph", 0);
    const mph = speedOverBand("mph");
    const kmh = speedOverBand("km/h");
    expect(kmh.warn).toBeGreaterThan(mph.warn);
    expect(kmh.alarm).toBeGreaterThan(mph.alarm);
    // 6 km/h over is 3.7 mph over — well inside the mph warning margin, so it
    // must not warn. It did before the band was split.
    expect(colourAt("km/h", mph.warn)).toBe(calm);
    expect(colourAt("km/h", kmh.warn)).not.toBe(calm);
    // Both bands land within a couple of units of the same real overspeed.
    expect(Math.abs(kmh.warn / 1.609 - mph.warn)).toBeLessThan(1);
    expect(Math.abs(kmh.alarm / 1.609 - mph.alarm)).toBeLessThan(1);
  });

  it("never warns when there is no limit to be over", () => {
    speed({ speed: 90, speedLimit: 0 });
    expect(screen.getByTestId("speed-value").style.color).toBe("rgb(244, 239, 222)");
  });

  it("reserves the speed's widest reading, so digits never move the row", () => {
    // 0 → 37 used to widen the centred row and walk the limit plate left and
    // the shift clock right: the whole top of the screen moving because the
    // driver touched the throttle. jsdom has no layout, so what is checkable
    // is the mechanism — a hidden widest-case sizer holding the box open.
    for (const value of [0, 8, 37, 105]) {
      cleanup();
      speed({ speed: value, speedLimit: 30 });
      const figure = screen.getByTestId("speed-value");
      expect(figure).toHaveTextContent(String(value));
      // The figure is laid over the sizer rather than laying out beside it.
      expect(figure.style.position).toBe("absolute");
      const slot = figure.parentElement!;
      expect(slot).toHaveStyle({ textAlign: "right" });
      const sizer = slot.firstElementChild!;
      expect(sizer).toHaveTextContent("000");
      expect(sizer).toHaveStyle({ visibility: "hidden" });
      // Same box, same font, whatever the reading — that is the whole fix.
      expect(slot.style.font).toContain("900 76px");
      expect(slot.style.fontVariantNumeric).toBe("tabular-nums");
    }
  });

  it("shows no shift clock outside career, where no day is running out", () => {
    speed();
    expect(screen.queryByTestId("day-clock")).not.toBeInTheDocument();
  });

  it("puts the shift clock on the speed's own baseline", () => {
    // The pair is why the clock lives in this cluster at all: two 76px
    // numerals side by side must share a baseline, and the label above the
    // clock is out of flow so it cannot push them apart.
    speed({ dayTimer: resolveDayTimer(3, 252_000, 360_000) });
    const clock = screen.getByTestId("day-clock");
    expect(clock).toHaveTextContent("DAY 3");
    expect(screen.getByTestId("day-clock-value")).toHaveTextContent("4:12");
    expect(clock).toHaveStyle({ alignItems: "baseline" });
    // Fixed width, or every tick of the last minute slides the speedometer:
    // the row is centred on itself.
    expect(clock.style.width).toBe(`${DAY_TIMER_METRICS.desktop.width}px`);
  });

  it("drops the row only far enough to clear the edge bar", () => {
    // The clock's label hangs out of flow above the numerals and lands under
    // the edge bar at the inset every other cluster uses. jsdom has no layout,
    // so the constant is the check — see DAY_TIMER_METRICS.
    speed();
    expect(screen.getByTestId("drive-speed").style.marginTop).toBe("");
    for (const compact of [false, true]) {
      cleanup();
      speed({ compact, dayTimer: resolveDayTimer(1, 60_000, 360_000) });
      const t = compact ? DAY_TIMER_METRICS.compact : DAY_TIMER_METRICS.desktop;
      expect(screen.getByTestId("drive-speed").style.marginTop).toBe(`${t.headroom}px`);
    }
  });

  it("draws the same clock smaller on a phone, not a different one", () => {
    // Same testids either way, so nothing downstream has to know which comp is
    // on screen — the rule the rest of this HUD already follows.
    for (const compact of [false, true]) {
      cleanup();
      speed({ compact, dayTimer: resolveDayTimer(3, 252_000, 360_000) });
      const t = compact ? DAY_TIMER_METRICS.compact : DAY_TIMER_METRICS.desktop;
      expect(screen.getByTestId("day-clock").style.width).toBe(`${t.width}px`);
      expect(screen.getByTestId("day-clock-value")).toHaveTextContent("4:12");
      expect(screen.getByTestId("day-phrase")).toHaveTextContent("ON SHIFT");
    }
    // The phone's column is the desktop comp halved, like the plate and the
    // numeral beside it. Anything wider would reach the corner button rail.
    expect(DAY_TIMER_METRICS.compact.width).toBeLessThan(
      DAY_TIMER_METRICS.desktop.width,
    );
  });

  it("drops the day number on a phone but never the phrase", () => {
    // The label overhangs toward the touch rail and is the widest thing in the
    // block. Which day it is survives in the title card and the ledger; how
    // long is left does not, so the phrase stays.
    speed({ dayTimer: resolveDayTimer(3, 252_000, 360_000) });
    expect(screen.getByTestId("day-clock")).toHaveTextContent("DAY 3");
    cleanup();
    speed({ compact: true, dayTimer: resolveDayTimer(3, 252_000, 360_000) });
    const clock = screen.getByTestId("day-clock");
    expect(clock).not.toHaveTextContent("DAY 3");
    expect(screen.getByTestId("day-phrase")).toHaveTextContent("ON SHIFT");
    // And it hangs off the right, so what it outgrows the block by spills into
    // the gap beside the speed rather than at the rail.
    expect((clock.firstElementChild as HTMLElement).style.right).toBe("0px");
  });

  it("keeps the phone's cut above the handsets the row cannot fit on", () => {
    // The rail is `SAFE_RIGHT + TOUCH_CORNER_RAIL_PX + 3 utility buttons`, and
    // SAFE_RIGHT is ~47px on whichever side a notch lands in landscape — a coin
    // toss on rotation. That worst case is what governs: measured in WebKit,
    // the row clears from about 836px up. 812 (iPhone X/XS/11 Pro, 12/13 mini)
    // is below it; 844 (iPhone 12/13/14) is the first that fits.
    expect(DAY_TIMER_MIN_VIEWPORT_PX).toBeGreaterThan(812);
    expect(DAY_TIMER_MIN_VIEWPORT_PX).toBeLessThanOrEqual(844);
    // The rail's own budget, so a change to either constant lands here.
    expect(TOUCH_CORNER_RAIL_PX).toBe(104);
  });
});

describe("the career shift clock", () => {
  const DAY_MS = 360_000;
  const at = (secondsLeft: number) => resolveDayTimer(3, secondsLeft * 1000, DAY_MS);
  /** The clock only ever renders inside the top-centre row. */
  const clusterWith = (dayTimer: ReturnType<typeof at>) =>
    render(
      <DriveSpeedCluster
        scale={1}
        inset={inset}
        speed={0}
        speedUnit="mph"
        speedLimit={30}
        gear="P"
        dayTimer={dayTimer}
      />,
    );

  it("counts a clock down to the last minute, then bare seconds", () => {
    // Under a minute "0:38" is still a clock face to read; "38 SEC" is a
    // number that has nearly run out. The switch is the escalation.
    expect(at(252).value).toBe("4:12");
    expect(at(60).value).toBe("1:00");
    expect(at(59).value).toBe("59");
    expect(at(0).value).toBe("0");
  });

  it("labels the bare seconds and nothing else", () => {
    // A `m:ss` reading needs no unit — the line above it already says what is
    // being counted — but a lone "38" beside a speedometer does.
    expect(at(252).unit).toBeNull();
    expect(at(60).unit).toBeNull();
    expect(at(59).unit).toBe("SEC");
    expect(at(0).unit).toBe("SEC");

    // And the null renders as nothing at all, not an empty span holding a gap.
    cleanup();
    clusterWith(at(252));
    expect(screen.getByTestId("day-clock-value")).toHaveTextContent("4:12");
    expect(screen.queryByTestId("day-clock-unit")).not.toBeInTheDocument();
    cleanup();
    clusterWith(at(38));
    expect(screen.getByTestId("day-clock-unit")).toHaveTextContent("SEC");
  });

  it("escalates its wording and its colour together", () => {
    expect(at(DAY_TIMER_WARN_S + 1).phrase).toBe("ON SHIFT");
    expect(at(DAY_TIMER_WARN_S).phrase).toBe("HURRY");
    expect(at(DAY_TIMER_CRITICAL_S).phrase).toBe("SHIFT ENDING");
    expect(at(0).phrase).toBe("SHIFT OVER");
    const tones = [DAY_TIMER_WARN_S + 1, DAY_TIMER_WARN_S, DAY_TIMER_CRITICAL_S].map(
      (s) => at(s).color,
    );
    expect(new Set(tones).size).toBe(3);
    expect(at(DAY_TIMER_WARN_S + 1).color).toBe(HUD_CREAM);
  });

  it("rounds the part-second up, so the readout never sits on a stale zero", () => {
    expect(resolveDayTimer(1, 1, DAY_MS).value).toBe("1");
    expect(resolveDayTimer(1, 0, DAY_MS).phrase).toBe("SHIFT OVER");
    // A day that overran is still over, not negative.
    expect(resolveDayTimer(1, -4_000, DAY_MS).value).toBe("0");
    expect(resolveDayTimer(1, -4_000, DAY_MS).fraction).toBe(0);
  });

  it("announces whole minutes, not the ticking numerals", () => {
    // The live region would otherwise speak eleven times a second.
    expect(at(252).announcement).toBe("Day 3, 5 minutes left of the shift.");
    expect(at(60).announcement).toBe("Day 3, 1 minute left of the shift.");
    expect(at(59).announcement).toBe("Day 3, under a minute left of the shift.");
    expect(at(0).announcement).toBe("Day 3, shift over.");
  });

  it("drains the edge bar across the whole screen, unscaled", () => {
    render(<DriveDayEdge timer={at(90)} />);
    const fill = screen.getByTestId("day-edge-fill");
    // A quarter of a six-minute day left is a quarter-width bar.
    expect(parseFloat(fill.style.width)).toBeCloseTo(25);
    expect(fill.style.width.endsWith("%")).toBe(true);
    // Anchored to the viewport, not laid out in the comp's 1920px frame —
    // scaling it would leave a gap at one end.
    const bar = screen.getByTestId("day-edge");
    expect(bar.style.transform).toBe("");
    expect(Number(bar.style.zIndex)).toBe(DRIVE_LAYER.hud);
  });

  it("stops pulsing at a shift that is already over", () => {
    cleanup();
    render(<DriveDayEdge timer={at(10)} />);
    expect(screen.getByTestId("day-edge-fill").style.animation).toContain("hudDayEdgeFlash");
    cleanup();
    render(<DriveDayEdge timer={at(0)} />);
    expect(screen.getByTestId("day-edge-fill").style.animation).toBe("");
    // The clock beside it stops with it — a shift that is over does not beat.
    cleanup();
    clusterWith(at(0));
    expect(screen.getByTestId("day-clock").style.animation).toBe("");
  });

  it("thins the bar on a phone, where 5px of a small screen is a band", () => {
    render(<DriveDayEdge timer={at(90)} compact />);
    expect(screen.getByTestId("day-edge").style.height).toBe(
      `${DAY_TIMER_METRICS.compact.edge}px`,
    );
    // Real screen pixels either way: the bar spans the viewport rather than
    // the comp's frame, so `resolveHudScale` never touches it.
    expect(DAY_TIMER_METRICS.compact.edge).toBeLessThan(DAY_TIMER_METRICS.desktop.edge);
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
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.offer);
    expect(DRIVE_LAYER.offer).toBeGreaterThan(DRIVE_LAYER.hud);
    // And above the whole-city map, which is at `action`: the player can open
    // the map over an offer and still answer it (#241).
    expect(DRIVE_LAYER.offer).toBeGreaterThan(DRIVE_LAYER.action);
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
        sessionVisible
        gain={null}
        buttons={[
          { id: "music", label: "Mute music", pressed: false, onPress: press },
          { id: "camera", label: "Switch camera", onPress: press },
          { id: "map", label: "Open the city map (M)", pressed: false, onPress: press },
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
    expect(screen.getByTestId("session-label")).toHaveTextContent("TODAY");
  });

  it("reserves the shift line's place but hides it on an exactly even day (#267)", () => {
    money({ session: "+$0.00", sessionVisible: false });
    const label = screen.getByTestId("session-label");
    expect(label).not.toBeVisible();
    expect(screen.getByText("+$0.00")).not.toBeVisible();
    // Hidden via `visibility`, not unmounted or `display: none` — the row
    // still occupies its line, so the balance above it never jumps down.
    expect(label.parentElement).toHaveStyle({ visibility: "hidden" });
  });

  it("leaves the shift clock to the top-centre readout", () => {
    // It used to be crammed in here at 11px and 34% opacity beside a 47px
    // balance, which is exactly how it came to be invisible (#236).
    money();
    expect(screen.queryByTestId("day-clock")).not.toBeInTheDocument();
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

  it("gives the desktop the four controls it never had", () => {
    const press = money();
    for (const name of [
      "Mute music",
      "Switch camera",
      "Open the city map (M)",
      "Pause",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(press).toHaveBeenCalledTimes(4);
  });

  it("shows the map control as pressed while the map is up", () => {
    // The button is a toggle, not a launcher — pressing it again closes.
    money({
      buttons: [
        { id: "map", label: "Close the city map (M)", pressed: true, onPress: vi.fn() },
      ],
    });
    expect(
      screen.getByRole("button", { name: "Close the city map (M)" }),
    ).toHaveAttribute("aria-pressed", "true");
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
        sessionVisible={false}
        gain={null}
        buttons={[]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.action);
  });

  it("dims and strikes the note through once muted, not just aria-pressed (#227)", () => {
    money({
      buttons: [
        { id: "music", label: "Unmute music", pressed: true, onPress: vi.fn() },
        { id: "camera", label: "Switch camera", onPress: vi.fn() },
        { id: "map", label: "Open the city map (M)", pressed: false, onPress: vi.fn() },
        { id: "pause", label: "Pause", onPress: vi.fn() },
      ],
    });
    const button = screen.getByRole("button", { name: "Unmute music" });
    const svg = button.querySelector("svg");
    expect(svg).not.toHaveAttribute("stroke", HUD_CREAM);
    // The struck-through note is one path longer than the plain glyph.
    expect(button.querySelectorAll("path")).toHaveLength(4);
  });

  it("leaves the plain note untouched while music is playing", () => {
    money();
    const button = screen.getByRole("button", { name: "Mute music" });
    const svg = button.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", HUD_CREAM);
    expect(button.querySelectorAll("path")).toHaveLength(3);
  });

  it("never lets the other controls borrow the muted-note treatment", () => {
    // A pressed map button is "the map is open", not "the map is off".
    money({
      buttons: [
        { id: "camera", label: "Switch camera", onPress: vi.fn() },
        { id: "map", label: "Close the city map (M)", pressed: true, onPress: vi.fn() },
      ],
    });
    const camera = screen.getByRole("button", { name: "Switch camera" });
    expect(camera.querySelector("svg")).toHaveAttribute("stroke", HUD_CREAM);
    expect(camera.querySelectorAll("path")).toHaveLength(2);
    const map = screen.getByRole("button", { name: "Close the city map (M)" });
    expect(map.querySelector("svg")).toHaveAttribute("stroke", HUD_CREAM);
  });
});

describe("the corner buttons", () => {
  const music = (props: Partial<Parameters<typeof DriveCornerButton>[0]> = {}) =>
    render(
      <DriveCornerButton
        inset={inset}
        icon={MUSIC_ICON}
        activeIcon={MUSIC_MUTED_ICON}
        label="Mute music"
        pressed={false}
        onPress={vi.fn()}
        {...props}
      />,
    );

  it("shows full-strength while playing", () => {
    music();
    const button = screen.getByRole("button", { name: "Mute music" });
    const svg = button.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", HUD_CREAM);
    expect(button.querySelectorAll("path")).toHaveLength(3);
  });

  it("dims and strikes the note through once muted (#227)", () => {
    music({ label: "Unmute music", pressed: true });
    const button = screen.getByRole("button", { name: "Unmute music" });
    const svg = button.querySelector("svg");
    expect(svg).not.toHaveAttribute("stroke", HUD_CREAM);
    expect(button.querySelectorAll("path")).toHaveLength(4);
  });

  it("steps a second button one slot in from the corner", () => {
    // The app owns two of these on a phone now, and the session's row starts
    // clear of both — `TOUCH_CORNER_RAIL_PX` is the width they agree on.
    music({ slot: 1, icon: MAP_ICON, activeIcon: undefined, label: "Open the city map" });
    const button = screen.getByRole("button", { name: "Open the city map" });
    expect(button.style.right).toContain(`${TOUCH_CORNER_SLOT_PX}px`);
  });

  it("leaves a button with no active icon at full strength when pressed", () => {
    // Pressed means "the map is open", which is not the muted note's meaning.
    music({ icon: MAP_ICON, activeIcon: undefined, label: "Close the city map", pressed: true });
    const button = screen.getByRole("button", { name: "Close the city map" });
    expect(button.querySelector("svg")).toHaveAttribute("stroke", HUD_CREAM);
    expect(button).toHaveAttribute("aria-pressed", "true");
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

describe("the phone HUD", () => {
  it("carries the money in the job card, where the corner cannot", () => {
    // The mobile comp puts the balance top-right, but that corner already
    // holds camera/pause/fullscreen — and fullscreen is the only way to
    // reclaim Safari's chrome once a drive has started.
    navCard({
      compact: true,
      money: { balance: "$248.60", session: "+$62.10", sessionVisible: true, label: "TODAY" },
    });
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$248.60");
    expect(screen.getByTestId("session-label")).toHaveTextContent("TODAY");
  });

  it("reserves the shift figure's place but hides it on an exactly even day (#267)", () => {
    // Unlike the desktop cluster, the label here can be the only clock a
    // narrow phone has room for (`dayTimerInRow`) — so only the amount hides,
    // never the caption beside it.
    navCard({
      compact: true,
      money: { balance: "$248.60", session: "+$0.00", sessionVisible: false, label: "TODAY" },
    });
    expect(screen.getByText("+$0.00")).not.toBeVisible();
    expect(screen.getByTestId("session-label")).toBeVisible();
  });

  it("leaves the shift clock to the top-centre readout here too", () => {
    // It rode in this header at 7px and 34% opacity while the desktop half of
    // #236 was landing. The phone reads it top-centre now, same as the desktop.
    navCard({
      compact: true,
      money: { balance: "$248.60", session: "+$62.10", sessionVisible: true, label: "TODAY" },
    });
    expect(screen.queryByTestId("day-clock")).not.toBeInTheDocument();
  });

  it("leaves the money out on desktop, where it has its own cluster", () => {
    navCard({ compact: false });
    expect(screen.queryByTestId("day-cash")).not.toBeInTheDocument();
  });

  it("draws the same card smaller rather than a different one", () => {
    // Both sizings render the same testids, so nothing downstream — the app,
    // these tests — has to know which one is on screen.
    for (const compact of [true, false]) {
      cleanup();
      navCard({ compact, queued: { title: "Amsterdam Bagels", pay: "+$12.40" } });
      expect(screen.getByTestId("manoeuvre-street")).toBeVisible();
      expect(screen.getByTestId("destination-progress")).toBeVisible();
      expect(screen.getByTestId("job-pay")).toBeVisible();
      expect(screen.getByTestId("queued-gig")).toBeVisible();
      expect(screen.getByText("Fuel")).toBeInTheDocument();
    }
  });

  it("says what to do when the driver is rolling through a stop", () => {
    // Stopping is what starts the pickup scene, so this outranks the tip clock.
    navCard({ job: job({ hint: "Stop the car to pick up." }) });
    expect(screen.getByTestId("job-hint")).toHaveTextContent("Stop the car");
    expect(screen.queryByTestId("job-tip")).not.toBeInTheDocument();
  });
});

describe("the offer on a phone", () => {
  const bar = (slotHeight: number, patch: Partial<HudOffer> = {}) => {
    const onAccept = vi.fn();
    const onPass = vi.fn();
    render(
      <DriveOfferBar
        inset={{ top: "64px", right: "12px" }}
        offer={offer(patch)}
        width={TOUCH_PEDAL_ROW_PX}
        slotHeight={slotHeight}
        onAccept={onAccept}
        onPass={onPass}
      />,
    );
    return { onAccept, onPass };
  };

  it("shows the same job the desktop card does", () => {
    bar(224);
    expect(screen.getByTestId("offer-pay")).toHaveTextContent("+$12.40");
    expect(screen.getByTestId("offer-countdown")).toHaveTextContent("12");
    expect(screen.getByText("Amsterdam Bagels")).toBeVisible();
    expect(screen.getByText("FOOD DELIVERY")).toBeVisible();
  });

  it("draws the detour as a rail when there is room for one", () => {
    bar(224);
    expect(screen.getByTestId("detour-rail")).toBeVisible();
    expect(screen.getByTestId("detour-label")).toHaveTextContent("0.4 mi");
    expect(screen.getByText("YOU")).toBeVisible();
    expect(screen.getByText("BACK ON ROUTE")).toBeVisible();
    // With the rail up the sub-line carries the load instead — the comp's
    // split, and the detour is not said twice on one card.
    expect(screen.getByTestId("gig-offer")).toHaveTextContent("3 items");
  });

  it("drops the rail rather than growing down into the pedals", () => {
    // The comp is drawn on a 400px frame; Safari with its toolbars leaves
    // ~343, and the shortest phone the rail budget admits is 320.
    bar(RAIL_MIN_SLOT_PX - 1);
    expect(screen.queryByTestId("detour-rail")).not.toBeInTheDocument();
    // The distance it carried takes the sub-line back — a short phone loses
    // the drawing, never the figure the decision turns on.
    expect(screen.getByTestId("gig-offer")).toHaveTextContent("0.4 mi");
  });

  it("has no rail to draw when the offer came in with no route to leave", () => {
    bar(224, { detour: null });
    expect(screen.queryByTestId("detour-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("gig-offer")).toHaveTextContent("3 items");
  });

  it("never stands taller than the slot it was given", () => {
    for (const slot of [224, 165, 142]) {
      cleanup();
      bar(slot);
      const card = screen.getByTestId("gig-offer").firstElementChild as HTMLElement;
      const height = Number.parseInt(card.style.height, 10);
      expect(height).toBeLessThanOrEqual(Math.max(slot, 120));
      expect(height).toBeLessThanOrEqual(MOBILE_OFFER_H);
    }
  });

  it("is never the map's dense card, at any slot height", () => {
    // The dense card belongs to the docked placement only: out here the phone
    // has no map on screen to be reading the pickup off, so the card is the
    // only thing that can name it. It is also what the player already knows —
    // changing it because the *other* placement had a problem would be a
    // regression they never asked for.
    for (const slot of [224, RAIL_MIN_SLOT_PX - 1, 120]) {
      cleanup();
      bar(slot);
      expect(screen.getByText("Amsterdam Bagels")).toBeVisible();
      expect(screen.queryByTestId("offer-meta")).toBeNull();
    }
  });

  it("answers to a tap, with no keycaps to press", () => {
    const { onAccept, onPass } = bar(224);
    expect(screen.getByTestId("offer-accept")).not.toHaveTextContent("F");
    fireEvent.click(screen.getByTestId("offer-pass"));
    expect(onPass).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("outranks both maps it is standing on top of", () => {
    const { container } = render(
      <DriveOfferBar
        inset={{ top: "64px", right: "12px" }}
        offer={offer()}
        width={TOUCH_PEDAL_ROW_PX}
        slotHeight={224}
        onAccept={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    // The corner widget it borrows the slot from is at `hud`; the whole-city
    // map, which may be open over the whole screen, is at `action`. ACCEPT has
    // to be tappable over either (#241).
    expect(Number(root.style.zIndex)).toBe(DRIVE_LAYER.offer);
    expect(DRIVE_LAYER.offer).toBeGreaterThan(DRIVE_LAYER.action);
  });
});
