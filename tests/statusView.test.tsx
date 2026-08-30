// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCareerSlice, withCareerStatusStats } from "../app/game/career";
import { drivingStatsIncrement } from "../app/game/drivingStats";
import { StatusView } from "../app/StatusView";

afterEach(cleanup);

describe("Status view", () => {
  it("shows the complete zero state without hiding Career", () => {
    const zero = drivingStatsIncrement({});
    render(<StatusView freeDriveStats={zero} career={null} initialMode="career" />);

    expect(screen.getByRole("heading", { name: /The city keeps score/i })).toBeVisible();
    const modes = screen.getByRole("group", { name: "Status mode" });
    expect(within(modes).getByRole("button", { name: "Career" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Start a career to build your stats.")).toBeVisible();
    expect(screen.getByLabelText("0.0 miles driven")).toBeVisible();
    expect(screen.getByText("Deliveries")).toBeVisible();
    expect(screen.getByText("Rideshares")).toBeVisible();
    expect(screen.getByText("Tickets")).toBeVisible();
    expect(screen.getByText("Money earned")).toBeVisible();
    expect(screen.getByText("Money spent")).toBeVisible();
  });

  it("formats all six Free Drive metrics and keeps four currencies separate", () => {
    const stats = {
      ...drivingStatsIncrement({
        deliveriesCompleted: 12,
        ridesharesCompleted: 8,
        trafficCitations: 3,
        distanceDrivenM: 1_609,
        earned: { countryId: "us" as const, amount: 45 },
        spent: { countryId: "uk" as const, amount: 7 },
      }),
      earnedByCountry: { us: 45, jp: 6_000, eg: 900, uk: 30 },
      spentByCountry: { us: 10, jp: 500, eg: 75, uk: 7 },
    };
    render(<StatusView freeDriveStats={stats} career={null} initialMode="free" />);

    expect(screen.getByLabelText("1.0 miles driven")).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByText("8")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();

    const earned = screen.getByText("Money earned").closest("article");
    expect(earned).not.toBeNull();
    expect(within(earned!).getByText("$45.00")).toBeVisible();
    expect(within(earned!).getByText("¥6,000")).toBeVisible();
    expect(within(earned!).getByText("E£900.00")).toBeVisible();
    expect(within(earned!).getByText("£30.00")).toBeVisible();
  });

  it("switches between separate Career and Free Drive totals", () => {
    const free = drivingStatsIncrement({ deliveriesCompleted: 2 });
    const career = withCareerStatusStats(
      createCareerSlice({ destinationId: "us-nyc", careerSeed: 4 }),
      drivingStatsIncrement({ ridesharesCompleted: 9 }),
    );
    render(<StatusView freeDriveStats={free} career={career} initialMode="free" />);

    expect(screen.getByText("2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Career" }));
    expect(screen.getByText("9")).toBeVisible();
  });
});
