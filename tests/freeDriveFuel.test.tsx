// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDestinationProfile,
  getFreeDrive,
  getMapPack,
} from "../app/game/content";
import {
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  TANK_CAPACITY_L,
} from "../app/game/economyTables";
import {
  gasStationPumpPositions,
  gasStationsOf,
} from "../app/game/servicePoints";
import {
  PROGRESS_STORAGE_KEY,
  createDefaultProgress,
  debit,
  setFuel,
} from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";
import type {
  GameHudSnapshot,
  GameRuntimeEvent,
} from "../app/game/sessionContract";

// Free-drive fuelling had no test at all (it is the one economy path career
// never exercises), which is how the pump could refuse a sale to a player with
// money in their pocket for as long as it did — #259. The mock canvas is the
// cut-down cousin of `careerFlow.test.tsx`'s: park the car, fire the scene's
// `pump` event, and the whole buy runs on fireEvent.click.
const mockStop = { x: 0, z: 0 };

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas(props: {
      scenario?: { readonly id: string };
      cutscene?: { readonly nonce: number; readonly kind: string } | null;
      onHudUpdate?: (snapshot: GameHudSnapshot) => void;
      onEvent?: (event: GameRuntimeEvent) => void;
      onExit?: () => void;
    }) {
      return (
        <section
          aria-label="Mock driving scene"
          data-scenario={props.scenario?.id}
          data-cutscene-kind={props.cutscene?.kind ?? "none"}
        >
          <button
            type="button"
            data-testid="mock-hud-at-stop"
            onClick={() =>
              props.onHudUpdate?.({
                speed: 0,
                speedUnit: "mph",
                gear: "D",
                cameraMode: "third_person",
                instruction: "",
                paused: false,
                honking: false,
                rearViewVisible: false,
                playerX: mockStop.x,
                playerZ: mockStop.z,
                heading: 0,
                simElapsedMs: 1_000,
                speedLimit: 30,
              })
            }
          >
            drive to the pumps
          </button>
          <button
            type="button"
            data-testid="mock-scene-pump"
            onClick={() =>
              props.onEvent?.({
                type: "cutscene",
                nonce: props.cutscene?.nonce ?? -1,
                phase: "pump",
                durationMs: 4_000,
              })
            }
          >
            pump
          </button>
          <button type="button" data-testid="mock-exit-drive" onClick={props.onExit}>
            exit drive
          </button>
        </section>
      );
    },
}));

// jsdom in this project does not expose window.localStorage.
const installLocalStorage = () => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
};

const desktopMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }) as unknown as MediaQueryList;

beforeEach(() => {
  mockStop.x = 0;
  mockStop.z = 0;
  installLocalStorage();
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(desktopMatchMedia));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const US_PRICE_PER_L = FUEL_PRICE_PER_LITRE_BY_COUNTRY.us; // 0.40
/** New York, so the money reads in dollars and the tank is the shared 40 L. */
const NYC = getDestinationProfile("us-nyc");

/**
 * Opens a New York free drive holding `wallet` dollars over `litres` of fuel,
 * with the car parked at the first pump on the map.
 */
const driveToThePumpsWith = async (wallet: number, litres: number) => {
  const start = createDefaultProgress();
  window.localStorage.setItem(
    PROGRESS_STORAGE_KEY,
    JSON.stringify(
      setFuel(
        debit(start, "us", start.walletByCountry.us - wallet),
        "us",
        litres,
      ),
    ),
  );
  render(<SideSwapApp />);
  await screen.findByRole("heading", { name: /Rise and Grind/i });
  // The launcher opens on the saved city, which is London on a fresh save.
  fireEvent.click(
    within(screen.getByRole("group", { name: "Destination" })).getByRole(
      "button",
      { name: new RegExp(NYC.destinationName, "i") },
    ),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`Start driving in ${NYC.destinationName}`, "i"),
    }),
  );
  await screen.findByLabelText("Mock driving scene");

  const map = getMapPack(getFreeDrive(NYC.freeDriveId).mapId);
  const station = gasStationsOf(map.geometry.servicePoints)[0];
  const pump = gasStationPumpPositions(map.laneGraph.lanes, station)[0];
  mockStop.x = pump.x;
  mockStop.z = pump.z;
  fireEvent.click(screen.getByTestId("mock-hud-at-stop"));
  return screen.findByTestId("refuel-button");
};

/** The wallet as it stands on disk — free drive saves on every purchase. */
const storedWallet = (): number =>
  (
    JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as {
      walletByCountry: Record<string, number>;
    }
  ).walletByCountry.us;

const storedFuel = (): number =>
  (
    JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as {
      fuelByCountry: Record<string, number>;
    }
  ).fuelByCountry.us;

const storedDistance = (): number =>
  (
    JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as {
      freeDriveStats: { distanceDrivenM: number };
    }
  ).freeDriveStats.distanceDrivenM;

describe("free-drive refuelling", () => {
  it("fills the tank and bills the wallet when the money is there", async () => {
    // 30 L missing at $0.40 = $12, against $20 in hand.
    const button = await driveToThePumpsWith(20, 10);
    expect(button).toHaveTextContent("Refuel — $12.00");
    expect(button).toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "refuel",
    );

    fireEvent.click(screen.getByTestId("mock-scene-pump"));
    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("100%");
    expect(storedWallet()).toBe(8);
    expect(storedFuel()).toBe(TANK_CAPACITY_L);
  });

  it("sells a short wallet the fraction it can pay for (#259)", async () => {
    // The same 30 L / $12 fill, with $4 in hand: a quarter of the money buys a
    // quarter of the fuel, taking a tank at 25% to 50%.
    const button = await driveToThePumpsWith(4, 10);
    expect(button).toHaveTextContent("Top up — $4.00");
    expect(button).toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    fireEvent.click(screen.getByTestId("mock-scene-pump"));

    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("50%");
    expect(storedWallet()).toBe(0);
    expect(storedFuel()).toBe(10 + 4 / US_PRICE_PER_L);
  });

  it("still tops up a tank run dry, which used to be the trap", async () => {
    // Empty tank, $2 left: before #259 this was unrecoverable — no fuel to
    // reach a gig with, and the pump would not take the $2 on offer.
    const button = await driveToThePumpsWith(2, 0);
    expect(button).toHaveTextContent("Top up — $2.00");

    fireEvent.keyDown(window, { code: "Enter" });
    fireEvent.click(screen.getByTestId("mock-scene-pump"));

    expect(storedFuel()).toBe(2 / US_PRICE_PER_L);
    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("13%");
  });

  it("says so, and stays silent on Enter, when there is no money at all", async () => {
    const button = await driveToThePumpsWith(0, 10);
    expect(button).toHaveTextContent("No money for fuel");
    expect(button).not.toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "none",
    );
    expect(storedFuel()).toBe(10);
  });

  it("offers nothing at all once the tank is full", async () => {
    const button = await driveToThePumpsWith(20, TANK_CAPACITY_L);
    expect(button).toHaveTextContent("Tank full");
    expect(button).not.toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "none",
    );
  });
});

describe("free-drive odometer persistence", () => {
  const moveThirtyMetres = () => {
    mockStop.x += 30;
    fireEvent.click(screen.getByTestId("mock-hud-at-stop"));
  };

  it("flushes without a render-facing state update after crossing 250 metres", async () => {
    await driveToThePumpsWith(20, 10);
    for (let step = 0; step < 9; step += 1) moveThirtyMetres();

    expect(storedDistance()).toBe(270);
  });

  it("flushes the remaining distance on normal exit", async () => {
    await driveToThePumpsWith(20, 10);
    moveThirtyMetres();
    moveThirtyMetres();
    fireEvent.click(screen.getByTestId("mock-exit-drive"));

    expect(await screen.findByRole("heading", { name: /Rise and Grind/i })).toBeVisible();
    expect(storedDistance()).toBe(60);
  });

  it("flushes on pagehide and reloads the saved odometer", async () => {
    await driveToThePumpsWith(20, 10);
    for (let step = 0; step < 8; step += 1) moveThirtyMetres();
    window.dispatchEvent(new Event("pagehide"));
    expect(storedDistance()).toBe(240);

    cleanup();
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Rise and Grind/i });
    fireEvent.click(screen.getByRole("button", { name: /^Status$/i }));
    expect(await screen.findByLabelText("0.1 miles driven")).toBeVisible();
  });
});
