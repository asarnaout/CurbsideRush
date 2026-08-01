// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAREER_STARTING_CASH_BY_COUNTRY,
  activeCity,
  createCareerSlice,
  withCity,
  type CareerCityState,
  type CareerVehicleId,
  DAY_LENGTH_MS,
  type CareerSliceV2,
} from "../app/game/career";
import {
  getCountryProfile,
  getDestinationProfile,
  getFreeDrive,
  getMapPack,
  GIG_FARE_BY_COUNTRY,
  PASSENGER_FARE_BY_COUNTRY,
  formatMoney,
  repairPrice,
} from "../app/game/content";
import {
  FULL_CONDITION_PCT,
  damageForCollision,
} from "../app/game/damage";
import { careerCityIndex, careerFare, careerGigSeedBase } from "../app/game/career";
import { resolveGigAddresses, resolveGigVenues } from "../app/game/gigPools";
import {
  gasStationPumpPositions,
  gasStationsOf,
  repairShopBayPosition,
  repairShopsOf,
} from "../app/game/servicePoints";
import {
  generateGigFromPools,
  pickGigKindAvoidingStreak,
  selectGigPools,
} from "../app/game/gigs";
import type { Gig } from "../app/game/gigs";
import {
  createDefaultProgress,
  PROGRESS_STORAGE_KEY,
  writeCareer,
} from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";

/** Sim-clock the mock canvas advances, so a test can run time forward. */
const mockClock = { ms: 0 };
/** Where `mock-hud-at-stop` parks the car — a test sets it to the gig's stop. */
const mockStop = { x: 0, z: 0 };
/** How many 39m ticks `mock-drain` fires — lower for a partial drain. */
const mockDrainTicks = { count: 600 };
/**
 * Wall clock, which every fine debounce in the app reads through `Date.now()`
 * — not the sim clock above. Without a handle on it, two fines fired in the
 * same tick of a test are microseconds apart and every spacing rule swallows
 * the second, so a test could not tell a working debounce from a broken one.
 */
const wallClock = { ms: 1_700_000_000_000 };
const advanceWallClock = (ms: number) => {
  wallClock.ms += ms;
};

// The career loop is driven end-to-end through the mock canvas: buttons fire
// canned HUD snapshots (the sim clock) and runtime events (a fine, exit) so
// the whole day → settlement → next-day cycle runs on fireEvent.click with no
// timers and no Babylon.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas(props: {
      lesson?: { readonly id: string };
      playerVehicle?: {
        readonly model: string | null;
        readonly visualKind?: string;
      } | null;
      cutscene?: { readonly nonce: number; readonly kind: string } | null;
      vehiclePhysics?: { readonly maxForwardSpeedMps?: number } | null;
      paused?: boolean;
      onHudUpdate?: (snapshot: Record<string, unknown>) => void;
      onEvent?: (event: Record<string, unknown>) => void;
      onPauseChange?: (paused: boolean) => void;
      onExit?: () => void;
    }) {
      const snapshot = (simElapsedMs: number, playerX = 0, playerZ = 0) => ({
        speed: 0,
        speedUnit: "mph",
        gear: "D",
        cameraMode: "third",
        indicator: "off",
        score: 100,
        objectiveProgress: 0,
        instruction: "",
        paused: false,
        honking: false,
        rearViewVisible: false,
        scenarioId: props.lesson?.id ?? "",
        scenarioTitle: "",
        objective: "",
        checkpoint: "",
        trafficSide: "left",
        playerX,
        playerZ,
        heading: 0,
        simElapsedMs,
      });
      return (
        <section
          aria-label="Mock driving scene"
          data-scenario={props.lesson?.id}
          data-player-model={props.playerVehicle?.model ?? "default"}
          data-visual-kind={props.playerVehicle?.visualKind ?? "none"}
          data-max-speed={props.vehiclePhysics?.maxForwardSpeedMps ?? "default"}
          data-cutscene-kind={props.cutscene?.kind ?? "none"}
          // What the session was actually told to do. The whole-city map must
          // never move this: it is an overlay, not a pause.
          data-paused={String(props.paused ?? false)}
        >
          <button
            type="button"
            data-testid="mock-pause"
            onClick={() => props.onPauseChange?.(true)}
          >
            pause
          </button>
          <button
            type="button"
            data-testid="mock-hud-mid"
            onClick={() => props.onHudUpdate?.(snapshot(1_000))}
          >
            hud mid
          </button>
          <button
            type="button"
            data-testid="mock-hud-end"
            onClick={() => props.onHudUpdate?.(snapshot(DAY_LENGTH_MS))}
          >
            hud end
          </button>
          <button
            type="button"
            data-testid="mock-hud-late"
            onClick={() => props.onHudUpdate?.(snapshot(9_000))}
          >
            hud late
          </button>
          <button
            type="button"
            data-testid="mock-hud-past-offer"
            onClick={() => props.onHudUpdate?.(snapshot(20_000))}
          >
            hud past offer window
          </button>
          <button
            type="button"
            data-testid="mock-hud-at-stop"
            onClick={() => {
              mockClock.ms += 1_000;
              props.onHudUpdate?.(
                snapshot(mockClock.ms, mockStop.x, mockStop.z),
              );
            }}
          >
            drive to the stop
          </button>
          <button
            type="button"
            data-testid="mock-hud-advance"
            onClick={() => {
              mockClock.ms += 1_000;
              props.onHudUpdate?.(snapshot(mockClock.ms));
            }}
          >
            advance one second
          </button>
          <button
            type="button"
            data-testid="mock-ready"
            onClick={() =>
              props.onEvent?.({
                type: "ready",
                message: "Training yard ready.",
                timestamp: 0,
              })
            }
          >
            ready
          </button>
          <button
            type="button"
            data-testid="mock-fine"
            onClick={() =>
              props.onEvent?.({
                type: "fine",
                message: "Fined",
                timestamp: 1,
                ruleCode: "red_light",
              })
            }
          >
            fine
          </button>
          {/* A speeding stop, with the evidence the rule monitor emits. The
              excess is what the ticket is priced from, so the two buttons
              stand for a marginal and a flagrant one on a 30 mph road. */}
          {([
            ["mock-fine-speeding-mild", 13.4 + 2.4],
            ["mock-fine-speeding-bad", 13.4 + 12],
          ] as const).map(([testId, speedMps]) => (
            <button
              key={testId}
              type="button"
              data-testid={testId}
              onClick={() =>
                props.onEvent?.({
                  type: "fine",
                  message: "Fined",
                  timestamp: 1,
                  ruleCode: "speeding",
                  evidence: { speedMps, limitMps: 13.4 },
                })
              }
            >
              speeding
            </button>
          ))}
          {/* The same two violations, written by a camera instead. No patrol
              is on the scene, so there is no stop to stage and the money moves
              where the driver stands. */}
          <button
            type="button"
            data-testid="mock-fine-camera"
            onClick={() =>
              props.onEvent?.({
                type: "fine",
                message: "A traffic camera caught the violation.",
                timestamp: 1,
                ruleCode: "red_light",
                issuedBy: "camera",
              })
            }
          >
            camera fine
          </button>
          <button
            type="button"
            data-testid="mock-fine-camera-speeding"
            onClick={() =>
              props.onEvent?.({
                type: "fine",
                message: "A traffic camera caught the violation.",
                timestamp: 1,
                ruleCode: "speeding",
                evidence: { speedMps: 13.4 + 12, limitMps: 13.4 },
                issuedBy: "camera",
              })
            }
          >
            camera speeding
          </button>
          {/* Striking someone is cited by the app on its own, with no patrol
              and no camera involved — the third way money can move. */}
          <button
            type="button"
            data-testid="mock-hit-pedestrian"
            onClick={() =>
              props.onEvent?.({
                type: "collision",
                message: "You struck a pedestrian.",
                timestamp: 1,
                ruleCode: "collision",
                evidence: {
                  roadUserType: "pedestrian",
                  externalRoadUser: true,
                  impactSpeedMps: 6,
                },
              })
            }
          >
            hit a pedestrian
          </button>
          <button
            type="button"
            data-testid="mock-exit"
            onClick={() => props.onExit?.()}
          >
            exit
          </button>
          <button
            type="button"
            data-testid="mock-drain"
            onClick={() => {
              // 39m per tick; the default 600-tick count comfortably empties
              // any tank, and a test can lower it first for a partial drain.
              for (let index = 1; index <= mockDrainTicks.count; index += 1) {
                props.onHudUpdate?.(snapshot(1_000, index * 39));
              }
            }}
          >
            drain
          </button>
          <button
            type="button"
            data-testid="mock-scene-pump"
            onClick={() =>
              props.onEvent?.({
                type: "cutscene",
                message: "pump",
                timestamp: 2,
                evidence: {
                  nonce: props.cutscene?.nonce ?? -1,
                  phase: "pump",
                  durationMs: 4_000,
                },
              })
            }
          >
            pump
          </button>
          <button
            type="button"
            data-testid="mock-scene-cite"
            onClick={() =>
              props.onEvent?.({
                type: "cutscene",
                message: "cite",
                timestamp: 2,
                evidence: {
                  nonce: props.cutscene?.nonce ?? -1,
                  phase: "cite",
                },
              })
            }
          >
            cite
          </button>
          <button
            type="button"
            data-testid="mock-scene-repair"
            onClick={() =>
              props.onEvent?.({
                type: "cutscene",
                message: "repair",
                timestamp: 2,
                evidence: {
                  nonce: props.cutscene?.nonce ?? -1,
                  phase: "repair",
                  durationMs: 5_000,
                },
              })
            }
          >
            repair
          </button>
          <button
            type="button"
            data-testid="mock-collision"
            onClick={() =>
              props.onEvent?.({
                type: "collision",
                message: "bang",
                timestamp: 2,
                evidence: { obstacle: "building", impactSpeedMps: 12 },
              })
            }
          >
            collision
          </button>
          <button
            type="button"
            data-testid="mock-scene-done"
            onClick={() =>
              props.onEvent?.({
                type: "cutscene",
                message: "done",
                timestamp: 3,
                evidence: {
                  nonce: props.cutscene?.nonce ?? -1,
                  phase: "done",
                },
              })
            }
          >
            done
          </button>
        </section>
      );
    },
}));

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
  mockClock.ms = 0;
  mockStop.x = 0;
  mockStop.z = 0;
  mockDrainTicks.count = 600;
  wallClock.ms = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => wallClock.ms);
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

// Ending a career day now confirms through the in-game dialog (#164), not a
// native prompt: leave the drive, then accept the modal.
async function endDayEarly() {
  fireEvent.click(screen.getByTestId("mock-exit"));
  fireEvent.click(await screen.findByTestId("confirm-accept"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const storedCareer = (): CareerSliceV2 | { state: string } | null => {
  const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (raw === null) return null;
  return (JSON.parse(raw) as { career: CareerSliceV2 | null }).career;
};

/**
 * A career whose starting city has been patched — cash, debt, day. Money lives
 * per city now, so seeding a scenario means editing the city, not the slice.
 */
const careerIn = (
  destinationId: Parameters<typeof createCareerSlice>[0]["destinationId"],
  careerSeed: number,
  patch: Partial<CareerCityState> = {},
): CareerSliceV2 => {
  const slice = createCareerSlice({ destinationId, careerSeed });
  return withCity(slice, destinationId, { ...activeCity(slice), ...patch });
};

const seedProgressWithCareer = (
  slice: CareerSliceV2,
  /** The garage selection the save was left holding, when a test cares. */
  lastCareerVehicleId?: CareerVehicleId,
) => {
  const progress = writeCareer(createDefaultProgress(), slice);
  window.localStorage.setItem(
    PROGRESS_STORAGE_KEY,
    JSON.stringify(
      lastCareerVehicleId ? { ...progress, lastCareerVehicleId } : progress,
    ),
  );
};

/** The remembered garage selection as it stands on disk. */
const storedVehicleId = (): string =>
  (
    JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { lastCareerVehicleId: string }
  ).lastCareerVehicleId;

const findTagline = () =>
  screen.findByRole("heading", { name: /Rise and Grind/i });

const enterCareerMode = async () => {
  render(<SideSwapApp />);
  await findTagline();
  fireEvent.click(screen.getByTestId("mode-career"));
};

// A fresh career always opens at the ladder's first city, so these price in
// USD. Seeded-in-London tests price in GBP; the integers happen to match, only
// the symbol and the fuel price differ.
const US_START_CASH = CAREER_STARTING_CASH_BY_COUNTRY.us; // 20
const HATCH_RENT_US = 16;
const NYC_FREE_DRIVE_ID = getDestinationProfile("us-nyc").freeDriveId;

describe("career mode flow", () => {
  it("starts a career, persists a verified slice, and opens the garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));

    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("$20.00");

    const stored = storedCareer();
    expect(stored).not.toBeNull();
    expect((stored as CareerSliceV2).state).toBe("active");
    expect(activeCity(stored as CareerSliceV2).day).toBe(1);
    expect(activeCity(stored as CareerSliceV2).countryId).toBe("us");
    expect(typeof (stored as CareerSliceV2).checksum).toBe("string");
  });

  it("opens a new career on the motorbike, the seed float covering its rent", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    expect(screen.getByTestId("garage-vehicle-motorbike")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("garage-vehicle-bicycle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Preselected, not forced: the free bike is one click away and startable.
    fireEvent.click(screen.getByTestId("garage-vehicle-bicycle"));
    expect(screen.getByTestId("garage-vehicle-bicycle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("remembers the ride across a reload, and persists the pick as it is made", async () => {
    seedProgressWithCareer(careerIn("uk-london", 31, { cash: 100 }));
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    fireEvent.click(screen.getByTestId("garage-vehicle-sport-sedan"));
    expect(storedVehicleId()).toBe("sport-sedan");

    // A reload: same storage, a brand-new app with no memory of the session.
    cleanup();
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    expect(screen.getByTestId("garage-vehicle-sport-sedan")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-prices a remembered ride it can no longer afford, and keeps the demotion", async () => {
    // Left holding the sports car, resumed on £20: its £38 rent is gone, the
    // £26 van would leave less than the £3 fee, the £16 hatch clears it.
    seedProgressWithCareer(
      careerIn("uk-london", 33, { cash: 20 }),
      "sport-sedan",
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The day must be startable on whatever the garage put you in.
    expect(screen.getByTestId("garage-start-day")).toBeEnabled();
    // The walk-down is written through, so the garage never climbs back into
    // the sports car on its own once the balance recovers.
    expect(storedVehicleId()).toBe("compact-hatch");
  });

  it("keeps today's ride for tomorrow when the night's reckoning leaves it in reach", async () => {
    seedProgressWithCareer(careerIn("uk-london", 44, { cash: 200 }));
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    fireEvent.click(screen.getByTestId("garage-vehicle-delivery-van"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");
    fireEvent.click(screen.getByTestId("mock-hud-end"));

    fireEvent.click(await screen.findByTestId("ledger-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    // 200 − 26 rent − 3 fee = 171: the van is still affordable, so it stands.
    expect(screen.getByTestId("garage-vehicle-delivery-van")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rides day 1 on your own bicycle: free, fuel-less, deliveries-only", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    // The bike is owned, so the day starts without rent.
    const bikeCard = screen.getByTestId("garage-vehicle-bicycle");
    expect(bikeCard).toBeEnabled();
    expect(bikeCard).toHaveTextContent(/no fuel needed/i);
    fireEvent.click(bikeCard);

    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute(
      "data-scenario",
      `career-${NYC_FREE_DRIVE_ID}-d1`,
    );
    expect(scene).toHaveAttribute("data-visual-kind", "bicycle");
    expect(scene).toHaveAttribute("data-max-speed", "7.5");
    // No rent charged, and the bike day has no fuel gauge at all.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$20.00");
    expect(screen.queryByText(/^Fuel$/)).not.toBeInTheDocument();
  });

  it("holds the day title back until the scene is ready, then times it from there", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    // The sim starts stepping while GameCanvas is still preloading models, so
    // HUD ticks arrive with the loading overlay still up. The title must not
    // paint over it — that is what put "DAY 1" through "Preparing your drive…".
    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    expect(screen.queryByTestId("day-title")).not.toBeInTheDocument();

    // Ready lands 1s into the day; the title's window runs from there, not from
    // zero, or a slow load would eat it before there was a city to see it over.
    fireEvent.click(screen.getByTestId("mock-ready"));
    expect(screen.getByTestId("day-title")).toHaveTextContent("DAY 1");

    // 8s past ready is well beyond the 2.6s window.
    fireEvent.click(screen.getByTestId("mock-hud-late"));
    expect(screen.queryByTestId("day-title")).not.toBeInTheDocument();
  });

  it("charges the hatch rent up front when it is taken out instead", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");
    // Rent left the day cash before the first metre was driven.
    expect(screen.getByTestId("day-cash")).toHaveTextContent(
      `$${(US_START_CASH - HATCH_RENT_US).toFixed(2)}`,
    );
    // The morning slice is untouched on disk until settlement.
    expect(activeCity(storedCareer() as CareerSliceV2).cash).toBe(US_START_CASH);
  });

  it("keeps career fines out of the free-drive wallet and lets cash go negative", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    // A witnessed violation stages the traffic stop; nothing is charged until
    // the officer reaches the window.
    fireEvent.click(screen.getByTestId("mock-fine"));
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "pullover",
    );
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$4.00");

    fireEvent.click(screen.getByTestId("mock-scene-cite"));
    // 20 - 16 rent - 8 fine = -4.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");

    const raw = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(raw.walletByCountry.us).toBe(20);
  });

  it("charges a speeding ticket by how far over the driver was", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    // 12 m/s over a 30 mph limit — about 27 mph over, past the point where the
    // scale caps out, so this is the full 2x of the flat $8 fine.
    fireEvent.click(screen.getByTestId("mock-fine-speeding-bad"));
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "pullover",
    );
    // Still nothing charged: the stop is not the citation, the window is.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$4.00");

    fireEvent.click(screen.getByTestId("mock-scene-cite"));
    // 20 - 16 rent - 16 fine = -12, against -4 for the flat red-light fine.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$12.00");
    // And the toast says why in the figures the ticket was priced from,
    // rather than leaving a variable amount looking like a bug. (The
    // pull-over caption is also role="status", so this asks for the text.)
    expect(
      screen.getByText(/Fined \$16\.00 for doing 57 in a 30/),
    ).toBeInTheDocument();
  });

  it("does not stop the same driver for speeding twice in a row", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine-speeding-mild"));
    fireEvent.click(screen.getByTestId("mock-scene-cite"));
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    // 2.4 m/s over is 5.4 mph, just past the citation line, and already costs
    // above the flat $8: 20 - 16 rent - 10 fine = -6.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$6.00");

    // The rule re-arms in the core after 8s and the app debounce is another 8,
    // so without a grace period a driver holding over would be pulled roughly
    // every ten seconds. The next stop must not stage at all.
    //
    // Ten seconds on, so every shorter clock — the 3s any-fine spacing and the
    // 8s witnessed debounce — has already expired and the speeding grace is
    // demonstrably the one doing the work.
    advanceWallClock(10_000);
    fireEvent.click(screen.getByTestId("mock-fine-speeding-bad"));
    expect(screen.getByLabelText("Mock driving scene")).not.toHaveAttribute(
      "data-cutscene-kind",
      "pullover",
    );
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$6.00");
  });

  it("lets a camera write the ticket where the driver stands, with no stop to stage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine-camera"));
    // No officer to stage: nothing is choreographed, and unlike a patrol stop
    // the money has already moved. 20 - 16 rent - 8 fine = -4.
    expect(screen.getByLabelText("Mock driving scene")).not.toHaveAttribute(
      "data-cutscene-kind",
      "pullover",
    );
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");
    // The driver is told a machine did it, not an officer they never saw.
    expect(
      screen.getByText(/Camera fined \$8\.00 for running a red light/),
    ).toBeInTheDocument();

    // Career money stays day-local, exactly as a patrol's fine does.
    const raw = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(raw.walletByCountry.us).toBe(20);
  });

  it("prices a camera's speeding ticket off the excess, the same as a patrol's", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine-camera-speeding"));
    // The same 2x of the flat $8 the pull-over charges for this speed, taken
    // without a scene: 20 - 16 rent - 16 fine = -12.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$12.00");
    expect(
      screen.getByText(/Camera fined \$16\.00 for doing 57 in a 30/),
    ).toBeInTheDocument();
  });

  it("charges once when one incident is answered by two mechanisms", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    // One swerve can leave the road and hit someone in the same breath. Two
    // rules trip, two different mechanisms answer them, and the driver must
    // pay for the incident once. 20 - 16 rent - 8 = -4, not -12.
    fireEvent.click(screen.getByTestId("mock-fine-camera"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");
    fireEvent.click(screen.getByTestId("mock-hit-pedestrian"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");

    // And it holds the other way round, including against a patrol stop —
    // which must not even stage, or its citation step would charge later.
    fireEvent.click(screen.getByTestId("mock-fine"));
    expect(screen.getByLabelText("Mock driving scene")).not.toHaveAttribute(
      "data-cutscene-kind",
      "pullover",
    );
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");

    // Far enough on to be a new incident rather than the same one, and the
    // driver is chargeable again — the spacing collapses one moment, it does
    // not stop enforcement. 8s clears both the 3s spacing and the ped clock.
    advanceWallClock(8_000);
    fireEvent.click(screen.getByTestId("mock-hit-pedestrian"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$12.00");
  });

  it("settles at the whistle: ledger lines, borrowed shortfall, then the next day's garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine"));
    fireEvent.click(screen.getByTestId("mock-scene-cite"));
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    fireEvent.click(screen.getByTestId("mock-hud-end"));

    expect(
      await screen.findByRole("heading", { name: /The day's reckoning/i }),
    ).toBeVisible();
    expect(screen.getByTestId("ledger-rent_info")).toHaveTextContent("$16.00");
    expect(screen.getByTestId("ledger-fines")).toHaveTextContent("$8.00");
    expect(screen.getByTestId("ledger-platform_fee")).toHaveTextContent("$3.00");
    // −4 cash − 3 fee = −7 shortfall → loan ceil(7 × 1.15) = 9.
    expect(screen.getByTestId("ledger-loan_origination")).toHaveTextContent(
      "$9.00",
    );
    expect(screen.getByTestId("ledger-closing_balance")).toHaveTextContent(
      "$0.00",
    );

    const settled = activeCity(storedCareer() as CareerSliceV2);
    expect(settled.day).toBe(2);
    expect(settled.cash).toBe(0);
    expect(settled.loan).toEqual({ principalRemaining: 9, daysRemaining: 3 });

    fireEvent.click(screen.getByTestId("ledger-continue"));
    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    expect(screen.getByTestId("forecast-installment")).toHaveTextContent(
      "$3.00",
    );
  });

  it("discards a quit day: same slice, same day, back at the garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine"));
    fireEvent.click(screen.getByTestId("mock-scene-cite"));
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    await endDayEarly();

    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    const stored = storedCareer() as CareerSliceV2;
    expect(activeCity(stored).day).toBe(1);
    expect(activeCity(stored).cash).toBe(US_START_CASH);
  });

  it("offers only a reset for a tampered career, leaving free-drive progress alone", async () => {
    const slice = createCareerSlice({
      destinationId: "uk-london",
      careerSeed: 99,
    });
    const progress = writeCareer(createDefaultProgress(), slice);
    const raw = JSON.parse(JSON.stringify(progress)) as {
      career: { cash: number };
    };
    raw.career.cash = 999_999;
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(raw));

    await enterCareerMode();
    expect(await screen.findByTestId("career-corrupt")).toBeVisible();
    fireEvent.click(screen.getByTestId("career-reset-corrupt"));

    expect(await screen.findByTestId("career-new-panel")).toBeVisible();
    expect(storedCareer()).toBeNull();
    const stored = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(stored.walletByCountry.uk).toBe(20);
  });

  it("rides the motorbike: composed visual kind, 24 cap, fuel gauge, deliveries only", async () => {
    seedProgressWithCareer(
      careerIn("uk-london", 77, { cash: 50 }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    const motoCard = screen.getByTestId("garage-vehicle-motorbike");
    expect(motoCard).toBeEnabled();
    expect(motoCard).toHaveTextContent(/Deliveries only/i);
    expect(motoCard).toHaveTextContent(/12 L tank/i);
    fireEvent.click(motoCard);
    fireEvent.click(screen.getByTestId("garage-start-day"));

    const scene = await screen.findByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute("data-player-model", "default"); // composed, not a registry car
    expect(scene).toHaveAttribute("data-visual-kind", "motorbike");
    expect(scene).toHaveAttribute("data-max-speed", "28.4704");
    // Rent prepaid (50 - 10), and the 12 L tank gets a fuel gauge.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("£40.00");
    expect(screen.getByText(/^Fuel$/)).toBeInTheDocument();

    await endDayEarly();
    await screen.findByRole("heading", { name: /Pick today's ride/i });
  });

  it("takes the van out with its own model and physics", async () => {
    seedProgressWithCareer(
      careerIn("uk-london", 55, { cash: 100 }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    const vanCard = screen.getByTestId("garage-vehicle-delivery-van");
    expect(vanCard).toBeEnabled();
    expect(vanCard).toHaveTextContent(/Deliveries only/i);
    fireEvent.click(vanCard);
    fireEvent.click(screen.getByTestId("garage-start-day"));

    const scene = await screen.findByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute("data-player-model", "delivery-van");
    expect(scene).toHaveAttribute("data-max-speed", "23.4704");

    await endDayEarly();
    await screen.findByRole("heading", { name: /Pick today's ride/i });
  });

  it("falls back to the bike when broke, and a shortfall under FINAL NOTICE wipes the city", async () => {
    seedProgressWithCareer(
      careerIn("uk-london", 7, {
        cash: 0,
        loan: { principalRemaining: 30, daysRemaining: 3 },
        finalNotice: true,
        }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    expect(screen.getByRole("alert")).toHaveTextContent(/FINAL NOTICE/i);
    // Broke: the owned bike is auto-selected. The hatch card stays selectable
    // (you must be able to reach its Buy control at any balance) but its rent
    // is out of reach, so the day cannot start on it.
    const hatchCard = screen.getByTestId("garage-vehicle-compact-hatch");
    expect(hatchCard).toBeEnabled();
    expect(hatchCard).toHaveTextContent(/out of reach today/i);
    expect(screen.getByTestId("garage-buy-compact-hatch")).toBeDisabled();
    const bikeCard = screen.getByTestId("garage-vehicle-bicycle");
    expect(bikeCard).toBeEnabled();
    expect(bikeCard).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("forecast-installment")).toHaveTextContent(
      "£10.00",
    );

    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");
    expect(screen.getByTestId("day-cash")).toHaveTextContent("£0.00");

    // Earn nothing: fee 3 + installment 10 on 0 cash under the notice = wiped.
    fireEvent.click(screen.getByTestId("mock-hud-end"));
    expect(
      await screen.findByRole("heading", { name: /took everything/i }),
    ).toBeVisible();

    // The city resets; the career does not end.
    const wiped = storedCareer() as CareerSliceV2;
    expect(wiped.state).toBe("active");
    expect(activeCity(wiped).cash).toBe(CAREER_STARTING_CASH_BY_COUNTRY.uk);
    expect(activeCity(wiped).day).toBe(1);
    expect(activeCity(wiped).loan).toBeNull();

    fireEvent.click(screen.getByTestId("career-continue-after-wipe"));
    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("£20.00");
  });

  it("buys any vehicle from its own card, without selecting it first", async () => {
    seedProgressWithCareer(
      careerIn("uk-london", 21, {
        cash: 260,
        day: 5,
        // Debt is deliberately no gate on buying.
        loan: { principalRemaining: 40, daysRemaining: 3 },
      }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    // Every eligible vehicle prices itself; the bike is not for sale.
    expect(screen.getByTestId("garage-buy-compact-hatch")).toHaveTextContent(
      "£240.00",
    );
    expect(screen.getByTestId("garage-buy-motorbike")).toHaveTextContent(
      "£150.00",
    );
    expect(screen.queryByTestId("garage-buy-bicycle")).toBeNull();
    // £260 covers the motorbike and the hatch, not the van at £390.
    expect(screen.getByTestId("garage-buy-delivery-van")).toBeDisabled();

    // Take the motorbike out for the day, then buy the *hatch*. The old flow
    // could only ever buy whatever card was selected; these are now independent.
    fireEvent.click(screen.getByTestId("garage-vehicle-motorbike"));
    expect(screen.getByTestId("garage-vehicle-motorbike")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("garage-buy-compact-hatch"));

    const owned = storedCareer() as CareerSliceV2;
    expect(activeCity(owned).ownedVehicleIds).toEqual(["compact-hatch"]);
    expect(activeCity(owned).cash).toBe(20);
    // The debt is untouched: the purchase cost cash, not the loan.
    expect(activeCity(owned).loan).toEqual({
      principalRemaining: 40,
      daysRemaining: 3,
    });
    // Owned now, so it rents free and its card says so.
    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toHaveTextContent(
      /Owned — no rent/,
    );
    // Its Buy control is replaced by the ownership marker.
    expect(screen.queryByTestId("garage-buy-compact-hatch")).toBeNull();
    expect(screen.getByTestId("garage-buy-motorbike")).toBeInTheDocument();
  });

  it("flies to Tokyo: yen prices, a fresh float, and New York left intact", async () => {
    // Enough for the $400 ticket, with a hatch already bought in New York.
    seedProgressWithCareer(
      careerIn("us-nyc", 31, {
        cash: 500,
        day: 8,
        ownedVehicleIds: ["compact-hatch"],
      }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("$500.00");

    // The garage and the travel board must wear the same shell: it is what
    // pulls the header onto the page's gutter. Without it the header falls back
    // to a wider default and visibly steps out of line with the cards.
    const shell = () => document.querySelector("main")?.className ?? "";
    expect(shell()).toContain("career-shell");

    fireEvent.click(screen.getByTestId("garage-travel"));
    await screen.findByRole("heading", { name: /Where are you working/i });
    expect(shell()).toContain("career-shell");
    expect(screen.getByTestId("travel-wallet")).toHaveTextContent("$500.00");
    expect(screen.getByTestId("travel-us-nyc")).toHaveTextContent(/You're here/i);
    expect(screen.getByTestId("travel-jp-tokyo")).toHaveTextContent("$400.00");
    // Tokyo tells you which side of the road you are about to be on.
    expect(screen.getByTestId("travel-jp-tokyo")).toHaveTextContent(
      /DRIVES ON THE LEFT/i,
    );
    // Cairo is two legs away and London three: both stay locked.
    expect(screen.getByTestId("travel-eg-cairo")).toHaveTextContent(/Locked/i);
    expect(screen.getByTestId("travel-eg-cairo")).toHaveTextContent(
      /Fly to Tokyo first/i,
    );
    expect(screen.queryByTestId("travel-pick-eg-cairo")).toBeNull();
    expect(screen.getByTestId("travel-uk-london")).toHaveTextContent(/Locked/i);
    expect(screen.getByTestId("travel-uk-london")).toHaveTextContent(
      /Fly to Cairo first/i,
    );
    expect(screen.queryByTestId("travel-pick-uk-london")).toBeNull();

    // Nothing is bookable until a destination is picked.
    expect(screen.getByTestId("travel-fly")).toBeDisabled();
    expect(screen.getByTestId("travel-footer-line")).toHaveTextContent(
      /Pick a city to fly to/i,
    );

    // Picking Tokyo arms the one commit point in the footer.
    fireEvent.click(screen.getByTestId("travel-pick-jp-tokyo"));
    expect(screen.getByTestId("travel-footer-line")).toHaveTextContent(
      "Tokyo · ticket $400.00",
    );
    fireEvent.click(screen.getByTestId("travel-fly"));
    fireEvent.click(screen.getByRole("button", { name: /Buy the ticket/i }));

    // Tokyo: fresh yen float, day 1, and the hatch did not come along.
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("¥3,000");
    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toHaveTextContent(
      "¥1,600",
    );
    expect(screen.getByTestId("garage-buy-compact-hatch")).toHaveTextContent(
      "¥24,000",
    );
    const flown = storedCareer() as CareerSliceV2;
    expect(flown.currentDestinationId).toBe("jp-tokyo");
    expect(activeCity(flown).ownedVehicleIds).toEqual([]);
    // New York kept the change and the fleet.
    expect(flown.cities["us-nyc"]?.cash).toBe(100);
    expect(flown.cities["us-nyc"]?.ownedVehicleIds).toEqual(["compact-hatch"]);

    // And flying back is free and restores exactly what was left there.
    fireEvent.click(screen.getByTestId("garage-travel"));
    await screen.findByRole("heading", { name: /Where are you working/i });
    // New York now shows what is waiting there rather than a ticket price.
    expect(screen.getByTestId("travel-us-nyc")).toHaveTextContent("$100.00");
    expect(screen.getByTestId("travel-us-nyc")).toHaveTextContent(/1 car/i);
    expect(screen.getByTestId("travel-us-nyc")).toHaveTextContent(/Fly back free/i);
    fireEvent.click(screen.getByTestId("travel-pick-us-nyc"));
    fireEvent.click(screen.getByTestId("travel-fly"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("$100.00");
    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toHaveTextContent(
      /Owned — no rent/,
    );
  });

  it("flies from Tokyo to Cairo with a fresh EGP ledger and right-hand traffic", async () => {
    seedProgressWithCareer(
      careerIn("jp-tokyo", 32, {
        cash: 50_000,
        day: 6,
        ownedVehicleIds: ["compact-hatch"],
      }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    fireEvent.click(screen.getByTestId("garage-travel"));
    await screen.findByRole("heading", { name: /Where are you working/i });
    expect(screen.getByTestId("travel-eg-cairo")).toHaveTextContent("¥40,000");
    expect(screen.getByTestId("travel-eg-cairo")).toHaveTextContent(
      /DRIVES ON THE RIGHT/i,
    );
    fireEvent.click(screen.getByTestId("travel-pick-eg-cairo"));
    expect(screen.getByTestId("travel-footer-line")).toHaveTextContent(
      "Cairo · ticket ¥40,000",
    );
    fireEvent.click(screen.getByTestId("travel-fly"));
    fireEvent.click(screen.getByRole("button", { name: /Buy the ticket/i }));

    await screen.findByRole("heading", { name: /Pick today's ride/i });
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("E£1,000.00");
    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toHaveTextContent(
      "E£800.00",
    );
    expect(screen.getByTestId("garage-buy-compact-hatch")).toHaveTextContent(
      "E£12,000.00",
    );
    const flown = storedCareer() as CareerSliceV2;
    expect(flown.currentDestinationId).toBe("eg-cairo");
    expect(activeCity(flown).cash).toBe(1000);
    expect(flown.cities["jp-tokyo"]?.cash).toBe(10_000);
    expect(flown.cities["jp-tokyo"]?.ownedVehicleIds).toEqual([
      "compact-hatch",
    ]);
  });

  it("summons roadside service on an empty tank and charges the premium into the red", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");

    // 20 - 16 rent = 4 before the tank runs dry.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$4.00");
    fireEvent.click(screen.getByTestId("mock-drain"));

    // The rescue stages itself the moment the tank hits zero.
    expect(scene).toHaveAttribute("data-cutscene-kind", "roadside_refuel");
    expect(screen.getByText(/roadside service/i)).toBeVisible();

    // The pump event bills the full 40 L at 1.5x plus the call-out fee:
    // round(40 x 0.40 x 1.5) + 10 = 34 -> 4 - 34 = -30.
    fireEvent.click(screen.getByTestId("mock-scene-pump"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$30.00");

    fireEvent.click(screen.getByTestId("mock-scene-done"));
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");
    // The wallet never saw any of it.
    const raw = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(raw.walletByCountry.uk).toBe(20);
  });

  /** Parks the car at the first pump on New York's map. */
  const parkAtThePumps = () => {
    const nycMap = getMapPack(
      getFreeDrive(getDestinationProfile("us-nyc").freeDriveId).mapId,
    );
    const gasStation = gasStationsOf(nycMap.geometry.servicePoints)[0];
    const pump = gasStationPumpPositions(nycMap.laneGraph.lanes, gasStation)[0];
    mockStop.x = pump.x;
    mockStop.z = pump.z;
    fireEvent.click(screen.getByTestId("mock-hud-at-stop"));
  };

  it("refuels at the pump from the keyboard, and the prompt says how (#217)", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");

    // ~20 L of a 40 L tank (171 ticks x 39 m x 0.003 L/m) — enough to need
    // fuel without draining to zero, which would instead auto-stage the
    // roadside_refuel rescue rather than leave the ordinary prompt to press.
    mockDrainTicks.count = 171;
    fireEvent.click(screen.getByTestId("mock-drain"));
    parkAtThePumps();

    // The Enter hint only shows once pressing it would actually do something.
    const refuelButton = await screen.findByTestId("refuel-button");
    expect(refuelButton).toHaveTextContent("ENTER");
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "refuel");
  });

  /*
   * Career's pump splits in two when the day's cash will not cover a tank. The
   * numbers below all come from one setup: the hatch rents at 16 out of a 20
   * float, so the day opens on 4; draining ~20 L of its 40 L tank leaves a fill
   * costing round(20 x 0.40) = 8, which is 4 more than the day is holding.
   */
  const shortOfAFillAtThePumps = async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$4.00");
    mockDrainTicks.count = 171;
    fireEvent.click(screen.getByTestId("mock-drain"));
    parkAtThePumps();
    return scene;
  };

  it("offers cash and credit side by side when the day is short", async () => {
    await shortOfAFillAtThePumps();

    // $4 of cash buys 10 L at $0.40; the whole 20 L fill is $8, so $4 of it
    // would be borrowed. Both prices are on the card, and so is the borrowing.
    const topUp = await screen.findByTestId("refuel-button");
    expect(topUp).toHaveTextContent("Top up — $4.00");
    expect(topUp).toHaveTextContent("ENTER");
    const onCredit = screen.getByTestId("refuel-credit-button");
    expect(onCredit).toHaveTextContent("Fill up — $8.00");
    expect(onCredit).toHaveTextContent("$4.00 on credit");
    expect(onCredit).toHaveTextContent("B");
  });

  it("spends the cash on Enter and borrows nothing", async () => {
    const scene = await shortOfAFillAtThePumps();

    // Enter takes the FIRST offer, which is the cash one on purpose: mashing it
    // at a pump must never quietly sign the driver up for a loan.
    fireEvent.keyDown(window, { code: "Enter" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "refuel");
    fireEvent.click(screen.getByTestId("mock-scene-pump"));

    // 10 L bought on top of the ~20 L left: three quarters of a tank, and the
    // day is spent out but not in debt.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("75%");
    fireEvent.click(screen.getByTestId("mock-scene-done"));

    // With nothing left to spend there is nothing to choose between: the card
    // collapses to the one remaining option, and says it is all on credit.
    parkAtThePumps();
    const remaining = await screen.findByTestId("refuel-button");
    expect(remaining).toHaveTextContent("Fill up — $4.00");
    expect(remaining).toHaveTextContent("on credit");
    expect(screen.queryByTestId("refuel-credit-button")).not.toBeInTheDocument();

    // And taking it lands exactly where the old single button always did.
    fireEvent.keyDown(window, { code: "Enter" });
    fireEvent.click(screen.getByTestId("mock-scene-pump"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");
    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("100%");
  });

  it("borrows the shortfall on B, in one press", async () => {
    const scene = await shortOfAFillAtThePumps();

    fireEvent.keyDown(window, { code: "KeyB" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "refuel");
    fireEvent.click(screen.getByTestId("mock-scene-pump"));

    // The whole $8 fill against $4 of cash: full tank, $4 in the red — which is
    // what the day's settlement turns into a loan.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-$4.00");
    expect(screen.getByTestId("fuel-gauge")).toHaveTextContent("100%");
  });

  it("keeps one plain offer when the day can afford the tank", async () => {
    seedProgressWithCareer(careerIn("us-nyc", 77, { cash: 200 }));
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    mockDrainTicks.count = 171;
    fireEvent.click(screen.getByTestId("mock-drain"));
    parkAtThePumps();

    // 200 - 16 rent leaves far more than the $8 fill, so there is nothing to
    // decide and the card stays the single pill it has always been.
    const refuelButton = await screen.findByTestId("refuel-button");
    expect(refuelButton).toHaveTextContent("Refuel — $8.00");
    expect(refuelButton).not.toHaveTextContent("credit");
    expect(screen.queryByTestId("refuel-credit-button")).not.toBeInTheDocument();

    // B is career's borrow key and there is nothing to borrow: it must not be
    // a second way to fire the pump.
    fireEvent.keyDown(window, { code: "KeyB" });
    expect(screen.getByLabelText("Mock driving scene")).toHaveAttribute(
      "data-cutscene-kind",
      "none",
    );
  });

  it("leaves the prompt silent on Enter once the tank is full", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");

    const nycMap = getMapPack(
      getFreeDrive(getDestinationProfile("us-nyc").freeDriveId).mapId,
    );
    const gasStation = gasStationsOf(nycMap.geometry.servicePoints)[0];
    const pump = gasStationPumpPositions(nycMap.laneGraph.lanes, gasStation)[0];
    mockStop.x = pump.x;
    mockStop.z = pump.z;
    fireEvent.click(screen.getByTestId("mock-hud-at-stop"));

    const refuelButton = await screen.findByTestId("refuel-button");
    expect(refuelButton).toHaveTextContent("Tank full");
    expect(refuelButton).not.toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");
  });

  /** Parks the car in the bay of New York's first repair shop. */
  const parkInTheBay = () => {
    const nycMap = getMapPack(
      getFreeDrive(getDestinationProfile("us-nyc").freeDriveId).mapId,
    );
    const shop = repairShopsOf(nycMap.geometry.servicePoints)[0];
    const bay = repairShopBayPosition(nycMap.laneGraph.lanes, shop)!;
    mockStop.x = bay.x;
    mockStop.z = bay.z;
    fireEvent.click(screen.getByTestId("mock-hud-at-stop"));
  };

  it("offers nothing to an undamaged car sitting in the bay", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");

    parkInTheBay();
    const button = await screen.findByTestId("repair-button");
    expect(button).toHaveTextContent(/nothing to fix/i);
    expect(button).not.toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");
  });

  it("repairs a damaged car for what the damage costs, not a flat fee", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-vehicle-compact-hatch"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");

    // Two 12 m/s shunts into a wall: 32 condition points apiece by
    // damageForCollision, so 64 points of damage and nowhere near a write-off.
    const damage = damageForCollision({
      obstacle: "building",
      impactSpeedMps: 12,
    });
    fireEvent.click(screen.getByTestId("mock-collision"));
    fireEvent.click(screen.getByTestId("mock-collision"));
    const expected = repairPrice(
      getCountryProfile("us"),
      damage * 2,
      "shop",
    );
    // The bill has to be proportional to be worth anything — a flat fee would
    // read the same here as a full rebuild.
    expect(expected).toBeLessThan(
      repairPrice(getCountryProfile("us"), FULL_CONDITION_PCT, "shop"),
    );

    const cashBefore = Number(
      screen.getByTestId("day-cash").textContent!.replace(/[^0-9.-]/g, ""),
    );
    parkInTheBay();
    const button = await screen.findByTestId("repair-button");
    expect(button).toHaveTextContent(formatMoney(expected, getCountryProfile("us")));
    expect(button).toHaveTextContent("ENTER");

    fireEvent.keyDown(window, { code: "Enter" });
    expect(scene).toHaveAttribute("data-cutscene-kind", "repair");

    // Nothing moves until the scene says the bonnet is up.
    expect(
      Number(screen.getByTestId("day-cash").textContent!.replace(/[^0-9.-]/g, "")),
    ).toBeCloseTo(cashBefore, 2);

    fireEvent.click(screen.getByTestId("mock-scene-repair"));
    expect(
      Number(screen.getByTestId("day-cash").textContent!.replace(/[^0-9.-]/g, "")),
    ).toBeCloseTo(cashBefore - expected, 2);

    fireEvent.click(screen.getByTestId("mock-scene-done"));
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");
    // Mended: the prompt has nothing left to offer.
    parkInTheBay();
    expect(await screen.findByTestId("repair-button")).toHaveTextContent(
      /nothing to fix/i,
    );
  });
});

// The gig↔app seam had no coverage at all before dispatch landed: nothing
// exercised how a job reaches the driver, only what happened once it had.
describe("dispatch: offers, waits and the queue", () => {
  const startDay = async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    return screen.findByLabelText("Mock driving scene");
  };

  it("opens the day with an offer waiting rather than a job assigned", async () => {
    await startDay();
    // Before the first snapshot the driver simply has nothing.
    expect(screen.getByTestId("dispatch-idle")).toHaveTextContent(
      /waiting for a job/i,
    );
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    const card = screen.getByTestId("gig-offer");
    expect(card).toBeVisible();
    expect(card).toHaveTextContent(/FOOD DELIVERY|RIDESHARE/);
    // Still no job in hand — an offer is a question, not an assignment.
    expect(screen.getByTestId("dispatch-idle")).toHaveTextContent(/offer waiting/i);
  });

  it("takes the job on accept and clears the card", async () => {
    await startDay();
    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    const pickup = screen.getByTestId("gig-offer").textContent ?? "";

    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispatch-idle")).not.toBeInTheDocument();
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent("JOB ACCEPTED");
    // The status card is now showing the job that was accepted.
    expect(screen.getByTestId("drive-status-card")).toHaveTextContent("PICK UP");
    expect(pickup.length).toBeGreaterThan(0);
  });

  it("costs nothing to pass — the driver just waits for the next one", async () => {
    await startDay();
    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    fireEvent.click(screen.getByTestId("offer-pass"));

    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent("PASSED");
    expect(screen.getByTestId("dispatch-idle")).toHaveTextContent(
      /waiting for a job/i,
    );
    // No money moved, and nothing was recorded against the driver.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("$10.00");
  });

  it("loses an offer that is left unanswered", async () => {
    await startDay();
    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    expect(screen.getByTestId("gig-offer")).toBeVisible();

    fireEvent.click(screen.getByTestId("mock-hud-past-offer"));
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent("OFFER LOST");
  });

  it("answers F and G from the keyboard, leaving Q and E to the indicators", async () => {
    await startDay();
    fireEvent.click(screen.getByTestId("mock-hud-mid"));

    // Q and E are the turn signals and must not touch the offer.
    fireEvent.keyDown(window, { code: "KeyQ" });
    fireEvent.keyDown(window, { code: "KeyE" });
    expect(screen.getByTestId("gig-offer")).toBeVisible();

    fireEvent.keyDown(window, { code: "KeyF" });
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent("JOB ACCEPTED");
  });

  it("queues a second job behind the one in hand instead of replacing it", async () => {
    await startDay();
    const tick = () => fireEvent.click(screen.getByTestId("mock-hud-advance"));

    tick();
    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(screen.queryByTestId("queued-gig")).not.toBeInTheDocument();

    // Run the clock until dispatch offers again. The ceiling is one lost
    // window plus the longest quiet spell, so this always terminates.
    for (let second = 0; second < 70 && !screen.queryByTestId("gig-offer"); second += 1) {
      tick();
    }
    expect(screen.getByTestId("gig-offer")).toBeVisible();

    // Accepting a second job parks it — it does not replace the one in hand.
    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent("ADDED TO QUEUE");
    expect(screen.getByTestId("queued-gig")).toBeVisible();
    expect(screen.getByTestId("drive-status-card")).toHaveTextContent("PICK UP");

    // With both hands full, dispatch goes quiet rather than stacking a third.
    for (let second = 0; second < 90; second += 1) tick();
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
  });
});

/**
 * The gig the game will offer first on a given career day.
 *
 * Rebuilt from the very functions the app calls, so the test knows where the
 * stop is without the app having to expose it. If this ever diverges from what
 * the player is shown, the assertions below stop matching and say so.
 */
function firstOfferOf(destinationId: "us-nyc" | "uk-london", careerSeed: number): Gig {
  const profile = getDestinationProfile(destinationId);
  const map = getMapPack(getFreeDrive(profile.freeDriveId).mapId);
  const country = getCountryProfile(profile.countryId);
  const seed = careerGigSeedBase(careerSeed, 1, careerCityIndex(destinationId));
  const kind = pickGigKindAvoidingStreak(seed, []);
  const { pickups, dropoffs } = selectGigPools(
    resolveGigVenues(map),
    resolveGigAddresses(map),
    kind,
  );
  const fare =
    kind === "passenger"
      ? PASSENGER_FARE_BY_COUNTRY[country.id]
      : GIG_FARE_BY_COUNTRY[country.id];
  const gig = generateGigFromPools(
    pickups,
    dropoffs,
    fare,
    country.currency.code,
    seed,
    kind,
  );
  if (!gig) throw new Error("no gig generated for the seeded day");
  return gig;
}

describe("dispatch: a job from offer to payout", () => {
  /** The seeded career's first job, and the day started on the free bicycle. */
  const startSeededDay = async (careerSeed: number) => {
    seedProgressWithCareer(careerIn("us-nyc", careerSeed, { cash: 100 }));
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    // The bicycle is free and deliveries-only, so rent never muddies the sums.
    fireEvent.click(screen.getByTestId("garage-vehicle-bicycle"));
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");
  };

  const driveTo = (point: { x: number; z: number }) => {
    mockStop.x = point.x;
    mockStop.z = point.z;
    fireEvent.click(screen.getByTestId("mock-hud-at-stop"));
  };

  it("runs a delivery from offer to money in the bank", async () => {
    const CAREER_SEED = 4_242;
    const expected = firstOfferOf("us-nyc", CAREER_SEED);
    // The bicycle only takes deliveries, so this is the run being tested.
    expect(expected.kind).toBe("delivery");

    await startSeededDay(CAREER_SEED);
    fireEvent.click(screen.getByTestId("mock-hud-advance"));
    expect(screen.getByTestId("gig-offer")).toHaveTextContent(
      expected.pickup.name,
    );
    fireEvent.click(screen.getByTestId("offer-accept"));

    const scene = screen.getByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute("data-cutscene-kind", "none");

    // Pulling up at the pickup stages the errand; the job is only picked up
    // when its scene finishes.
    driveTo(expected.pickup);
    expect(scene).toHaveAttribute("data-cutscene-kind", "food_pickup");
    expect(screen.getByTestId("drive-status-card")).toHaveTextContent("PICK UP");
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    expect(screen.getByTestId("drive-status-card")).toHaveTextContent("DELIVER");

    const before = screen.getByTestId("day-cash").textContent ?? "";
    driveTo(expected.dropoff);
    expect(scene).toHaveAttribute("data-cutscene-kind", "food_dropoff");
    // Still unpaid: the money moves on the scene's done event, not on arrival.
    expect(screen.getByTestId("day-cash")).toHaveTextContent(before);

    fireEvent.click(screen.getByTestId("mock-scene-done"));
    const { net } = careerFare(expected.reward, "delivery", {
      fareFactors: { delivery: 1, passenger: 1 },
    } as Parameters<typeof careerFare>[2]);
    expect(screen.getByTestId("day-cash")).not.toHaveTextContent(before);
    // A food tip is quoted up front, so it always lands on top of the fare.
    expect(screen.getByTestId("dispatch-toast")).toHaveTextContent(/TIP \+/);
    expect(net).toBeGreaterThan(0);

    // Nothing queued behind it, so the driver goes back to waiting.
    expect(screen.getByTestId("dispatch-idle")).toBeVisible();
  });

  it("does not pay the same drop-off twice", async () => {
    const CAREER_SEED = 4_242;
    const expected = firstOfferOf("us-nyc", CAREER_SEED);
    await startSeededDay(CAREER_SEED);
    fireEvent.click(screen.getByTestId("mock-hud-advance"));
    fireEvent.click(screen.getByTestId("offer-accept"));

    driveTo(expected.pickup);
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    driveTo(expected.dropoff);
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    const paid = screen.getByTestId("day-cash").textContent ?? "";

    // A stray repeat of the scene's done event must not credit it again. The
    // guard that holds here is the cleared job rather than paidGigRef: the
    // drop-off leaves nothing carrying, so there is nothing left to pay for.
    fireEvent.click(screen.getByTestId("mock-scene-done"));
    expect(screen.getByTestId("day-cash")).toHaveTextContent(paid);
  });

  it("hands the queued job over the moment the current one lands", async () => {
    const CAREER_SEED = 4_242;
    const expected = firstOfferOf("us-nyc", CAREER_SEED);
    await startSeededDay(CAREER_SEED);
    fireEvent.click(screen.getByTestId("mock-hud-advance"));
    fireEvent.click(screen.getByTestId("offer-accept"));

    driveTo(expected.pickup);
    fireEvent.click(screen.getByTestId("mock-scene-done"));

    // Take a second job while carrying the first.
    for (let second = 0; second < 70 && !screen.queryByTestId("gig-offer"); second += 1) {
      fireEvent.click(screen.getByTestId("mock-hud-advance"));
    }
    fireEvent.click(screen.getByTestId("offer-accept"));
    const queued = screen.getByTestId("queued-gig").textContent ?? "";
    expect(queued).toContain("NEXT UP");

    driveTo(expected.dropoff);
    fireEvent.click(screen.getByTestId("mock-scene-done"));

    // The queue is empty and the driver is straight onto the next pickup —
    // no idle spell, because they had already lined one up.
    expect(screen.queryByTestId("queued-gig")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispatch-idle")).not.toBeInTheDocument();
    expect(screen.getByTestId("drive-status-card")).toHaveTextContent("PICK UP");
  });
});

describe("the whole-city map", () => {
  const startDay = async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");
    // One snapshot, so the app has a player pose to draw the map around. It
    // also opens the offer every drive starts with; pass it, so these tests
    // start from a clear screen and can open their own offer when they want
    // one.
    fireEvent.click(screen.getByTestId("mock-hud-mid"));
    fireEvent.click(screen.getByTestId("offer-pass"));
    return scene;
  };

  const openMap = () => fireEvent.keyDown(window, { code: "KeyM" });

  /**
   * Roll the sim clock forward a second at a time until dispatch opens an
   * offer. `OFFER_WINDOW_MS` is 15s and the quiet spell after a pass is capped
   * at 45s, so 90 seconds is well past needing one — and stopping the moment it
   * appears means the window cannot be driven past.
   */
  const driveUntilOffered = () => {
    for (let second = 0; second < 90; second += 1) {
      if (screen.queryByTestId("gig-offer")) return;
      fireEvent.click(screen.getByTestId("mock-hud-advance"));
    }
    throw new Error("dispatch never offered a job in 90s of driving");
  };

  it("opens on M and closes on M again", async () => {
    await startDay();
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
    openMap();
    expect(screen.getByRole("dialog", { name: "City map" })).toBeVisible();
    openMap();
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
  });

  it("closes on the close button too, for anyone without a keyboard", async () => {
    await startDay();
    openMap();
    fireEvent.click(screen.getByRole("button", { name: "Close the map" }));
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
  });

  it("opens from the HUD control beside the camera and pause ones", async () => {
    // Issue #216 asks for the icon there, and on a phone it is the only way in.
    await startDay();
    const open = screen.getByRole("button", { name: "Open the city map (M)" });
    expect(open).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(open);
    expect(screen.getByTestId("expanded-map")).toBeVisible();

    // The same control closes it, and says which state it is in.
    const close = screen.getByRole("button", { name: "Close the city map (M)" });
    expect(close).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(close);
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
  });

  it("does not pause the drive — the car keeps rolling", async () => {
    // The decision the whole component is built around. If this ever flips,
    // the focus and key-swallowing rules in `ExpandedMap` become wrong too.
    const scene = await startDay();
    expect(scene).toHaveAttribute("data-paused", "false");
    openMap();
    expect(screen.getByTestId("expanded-map")).toBeVisible();
    expect(scene).toHaveAttribute("data-paused", "false");
  });

  it("stays out of the way of the pause screen, and comes back after it", async () => {
    // Both sit at DRIVE_LAYER.action and the app paints after the session, so
    // a map left showing would float on top of the pause card.
    await startDay();
    openMap();
    fireEvent.click(screen.getByTestId("mock-pause"));
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
    // M is inert while paused rather than fighting it.
    openMap();
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
  });

  it("stays open when an offer arrives, and docks the card into it (#241)", async () => {
    // It used to close itself instead, because the offer renders before it at
    // the same layer and a map over ACCEPT is untappable on a phone. Losing
    // the map you just opened every time dispatch called was the worse half of
    // that trade. The card comes *into* the map now rather than floating over
    // it — one panel, and the offer sits beside the dashed line to its pickup.
    await startDay();
    openMap();
    expect(screen.getByTestId("expanded-map")).toBeVisible();

    // Drive on until dispatch offers the next job. Waiting for it rather than
    // naming a moment is what makes this deterministic: `startCareer` mints a
    // random career seed, so *when* the next offer opens is not a fixed number
    // — only that the quiet spell is capped at 45s, so one always arrives.
    driveUntilOffered();
    expect(screen.getByTestId("expanded-map")).toBeVisible();
    // `getByTestId` throws on a second match, so this also pins the rule the
    // whole design rests on: the HUD's floating card stands down while the map
    // is up, and exactly one offer is ever on screen.
    const card = screen.getByTestId("gig-offer");
    expect(screen.getByTestId("expanded-map")).toContainElement(card);
    expect(screen.getByTestId("offer-accept")).toBeVisible();

    // Answering it leaves the map alone: it was never the offer's to close.
    fireEvent.click(screen.getByTestId("offer-pass"));
    expect(screen.getByTestId("expanded-map")).toBeVisible();
    expect(screen.queryByTestId("gig-offer")).not.toBeInTheDocument();
  });

  it("opens over an offer that is already up (#241)", async () => {
    // The other half of the same bug: M and the HUD button both flipped the
    // flag but nothing appeared, so the map read as broken for fifteen seconds
    // at a stretch — the one moment the player most wants to see where the
    // pickup is, which the map draws as a dashed line out to it.
    await startDay();
    driveUntilOffered();
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();

    openMap();
    expect(screen.getByTestId("expanded-map")).toBeVisible();
    expect(screen.getByTestId("gig-offer")).toBeVisible();
  });

  it("marks the city's places, cameras and all", async () => {
    await startDay();
    openMap();
    const kinds = new Set(
      screen
        .getAllByTestId("expanded-map-poi")
        .map((node) => node.getAttribute("data-poi-kind")),
    );
    // New York has all five families, which the corner widget never shows.
    expect(kinds).toContain("fuel");
    expect(kinds).toContain("food");
    expect(kinds).toContain("camera");
    expect(screen.getAllByTestId("map-legend-row")).toHaveLength(5);
  });

  it("does not survive into the next day", async () => {
    await startDay();
    openMap();
    expect(screen.getByTestId("expanded-map")).toBeVisible();
    await endDayEarly();
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");
    expect(screen.queryByTestId("expanded-map")).not.toBeInTheDocument();
  });
});
