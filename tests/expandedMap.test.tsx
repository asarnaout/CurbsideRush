// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOBILE_OFFER_DENSE_H,
  MOBILE_OFFER_H,
  type HudOffer,
} from "../app/game/DriveHud";
import { ExpandedMap } from "../app/game/ExpandedMap";
import { DRIVE_LAYER } from "../app/game/driveLayers";
import { MAP_POI_FAMILY, type MapPoi } from "../app/game/mapPoi";
import { fitMinimapPanel } from "../app/game/minimap";

afterEach(cleanup);

/** jsdom has no canvas; the whole-city map also needs `setTransform`. */
function createRecordingContext(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    lineCap: "round",
    setTransform: noop,
    clearRect: noop,
    drawImage: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => createRecordingContext() as never,
  );
});

const NYC = { x: 1080, z: 3000 };
const ROADS = [
  { centerline: [{ x: -400, z: 0 }, { x: 400, z: 0 }], widthM: 10.4 },
  { centerline: [{ x: 0, z: -1400 }, { x: 0, z: 1400 }], widthM: 22 },
];
const POIS: MapPoi[] = [
  { id: "gas", kind: "fuel", x: 0, z: 100, label: "Broadway Fuel" },
  { id: "shop", kind: "repair", x: 40, z: -200, label: "West 65th Auto" },
  { id: "diner", kind: "food", x: -60, z: 400, label: "Amsterdam Diner" },
];
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 874, height: 402 };

function renderMap(overrides: Partial<Parameters<typeof ExpandedMap>[0]> = {}) {
  const onClose = vi.fn();
  const result = render(
    <ExpandedMap
      cityName="New York"
      subtitle="Deliver to Amsterdam Diner"
      worldSize={NYC}
      roadSurfaces={ROADS}
      pois={POIS}
      playerX={0}
      playerZ={0}
      heading={0}
      viewport={DESKTOP}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose, ...result };
}

describe("the whole-city map", () => {
  it("is a dialog you can name, and does not claim to be modal", () => {
    // The car is still rolling behind it and the HUD is still updating, so
    // `aria-modal` would be a lie — and would hide a running game from a
    // screen reader.
    renderMap();
    const dialog = screen.getByRole("dialog", { name: "City map" });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(Number(dialog.style.zIndex)).toBe(DRIVE_LAYER.action);
  });

  it("closes on the button, on Escape and on a click outside it", () => {
    const { onClose } = renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Close the map" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.pointerDown(screen.getByTestId("expanded-map"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("never lets Escape reach the drive, which would pause behind it", () => {
    // `BabylonGameSession` maps Escape to togglePause on its own window
    // listener. Without the capture-phase stop the map would close *and* the
    // game would pause underneath.
    const drive = vi.fn();
    window.addEventListener("keydown", drive);
    try {
      renderMap();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(drive).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", drive);
    }
  });

  it("lets every other key through, because the car is still moving", () => {
    // The opposite of ConfirmDialog, which swallows everything — its drive is
    // paused. Swallowing the throttle here would strand the player.
    const drive = vi.fn();
    window.addEventListener("keydown", drive);
    try {
      renderMap();
      fireEvent.keyDown(window, { code: "KeyW", key: "w" });
      fireEvent.keyDown(window, { code: "Space", key: " " });
      expect(drive).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", drive);
    }
  });

  it("puts focus on the panel, never on a button", () => {
    // Space is the handbrake and Enter answers the service prompt; both are
    // default activations on a focused button, so the player would slam the
    // brakes and shut the map trying to drive away.
    renderMap();
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).not.toBe("BUTTON");
    expect(screen.getByTestId("expanded-map")).toContainElement(active);
  });

  it("gives the canvas the city's own shape, not the screen's", () => {
    // New York is 1080x3000 — a tall column. A square canvas would spend most
    // of itself on nothing.
    renderMap();
    const canvas = screen.getByTestId("expanded-map").querySelector("canvas")!;
    const width = Number.parseFloat(canvas.style.width);
    const height = Number.parseFloat(canvas.style.height);
    expect(height).toBeGreaterThan(width * 2);
    expect(width / height).toBeCloseTo(NYC.x / NYC.z, 2);
  });

  it("turns the same city sideways when the city is wide", () => {
    // A 1500x300 corridor city. Same rule, opposite result.
    renderMap({ worldSize: { x: 1500, z: 300 } });
    const canvas = screen.getByTestId("expanded-map").querySelector("canvas")!;
    const width = Number.parseFloat(canvas.style.width);
    const height = Number.parseFloat(canvas.style.height);
    expect(width).toBeGreaterThan(height * 4);
  });

  it("renders more backing store than CSS pixels, so it is not soft", () => {
    // A full-screen canvas at 1x reads visibly mushy on the displays this is
    // played on, and it is the one surface a player stops to look at.
    const originalRatio = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 3,
      configurable: true,
    });
    try {
      renderMap();
      const canvas = screen.getByTestId("expanded-map").querySelector("canvas")!;
      const cssWidth = Number.parseFloat(canvas.style.width);
      // Capped at 2 — a DPR-3 phone gains nothing visible for half again the
      // memory.
      expect(canvas.width).toBe(Math.round(cssWidth * 2));
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        value: originalRatio,
        configurable: true,
      });
    }
  });

  it("marks every place, not just the three the corner map carries", () => {
    renderMap();
    const marked = screen.getAllByTestId("expanded-map-poi");
    expect(marked).toHaveLength(3);
    expect(marked.map((node) => node.getAttribute("data-poi-kind"))).toContain("food");
  });

  it("keys every family, whether or not this city has any", () => {
    // A key that quietly drops a symbol leaves the player wondering what it
    // meant when they meet one.
    renderMap();
    const rows = screen.getAllByTestId("map-legend-row");
    expect(rows).toHaveLength(5);
    const fuel = rows.find((row) => row.dataset.poiKind === "fuel")!;
    expect(fuel).toHaveTextContent("Fuel");
    expect(fuel.querySelector("svg")).toHaveAttribute(
      "stroke",
      MAP_POI_FAMILY.fuel.color,
    );
  });

  it("says what each symbol is and never how many there are", () => {
    // The key explains the icons; the map itself is already showing how many.
    renderMap();
    for (const row of screen.getAllByTestId("map-legend-row")) {
      expect(row.textContent).not.toMatch(/\d/);
    }
  });

  it("fades a family the city has none of", () => {
    // This test's fixture POIS carries no "camera" entry (fuel/repair/food
    // only) — worth the difference between "not found one yet" and "there
    // are none to find". Not a claim about any real map's own signal count
    // (Tokyo expansion Phase 5 gave Tokyo its first 42 signals and 14
    // derived cameras; this fixture is independent of real map content).
    renderMap();
    const rows = screen.getAllByTestId("map-legend-row");
    const cameras = rows.find((row) => row.dataset.poiKind === "camera")!;
    const fuel = rows.find((row) => row.dataset.poiKind === "fuel")!;
    expect(Number(cameras.style.opacity)).toBeLessThan(1);
    expect(Number(fuel.style.opacity)).toBe(1);
  });

  it("names where you are going, and says north-up when you are going nowhere", () => {
    renderMap();
    expect(screen.getByTestId("expanded-map-subtitle")).toHaveTextContent(
      "Deliver to Amsterdam Diner",
    );
    cleanup();
    renderMap({ subtitle: null });
    expect(screen.getByTestId("expanded-map-subtitle")).toHaveTextContent("North up");
  });

  it("only promises keys where there are keys", () => {
    renderMap({ showKeyHints: true });
    expect(screen.getByTestId("expanded-map-hint")).toHaveTextContent("M");
    cleanup();
    renderMap({ showKeyHints: false });
    expect(screen.queryByTestId("expanded-map-hint")).toBeNull();
  });

  it("still fits a landscape phone, height being the thing that binds", () => {
    // ~874x402 with the browser's chrome gone. The map comes out small; that is
    // the honest answer for a 1:2.8 city on a 2:1 screen, and it is still a
    // where-am-I glance the corner widget cannot give.
    renderMap({ viewport: PHONE });
    const canvas = screen.getByTestId("expanded-map").querySelector("canvas")!;
    const height = Number.parseFloat(canvas.style.height);
    const width = Number.parseFloat(canvas.style.width);
    expect(height).toBeGreaterThan(300);
    expect(height).toBeLessThanOrEqual(PHONE.height);
    expect(width).toBeGreaterThan(100);
    // The legend still gets its column — width is never what runs out.
    expect(screen.getAllByTestId("map-legend-row")).toHaveLength(5);
  });
});

describe("an offer docked into the map (#241)", () => {
  const OFFER: HudOffer = {
    kind: "delivery",
    pay: "+$12.40",
    bonus: "+$4.10 tip",
    title: "Amsterdam Bagels",
    sub: "then 214 W 108th St",
    chips: ["0.4 mi away", "3 items"],
    detour: "0.4 mi",
    meta: "3 items",
    footnote: "Nothing else in hand",
    secondsLeft: 12,
    elapsed: 0.2,
    surged: false,
  };
  const docked = () => ({ offer: OFFER, onAccept: vi.fn(), onPass: vi.fn() });

  it("puts the card in the column rather than over the panel", () => {
    // The whole point of docking: one object. A card positioned against the
    // viewport while the panel is centred overlapped by an amount that came
    // out of the city's aspect ratio — Cairo clipped the legend, New York did
    // not touch it.
    renderMap({ dockedOffer: docked() });
    const card = screen.getByTestId("gig-offer");
    expect(screen.getByTestId("expanded-map")).toContainElement(card);
    expect(card.style.position).not.toBe("absolute");
    expect(card.style.zIndex).toBe("");
  });

  it("takes the column's width, and never the map's", () => {
    // The canvas must be the same size with an offer up as without, or the
    // map would resize under a player who is reading it.
    const { rerender } = renderMap();
    const before = screen.getByTestId("expanded-map").querySelector("canvas")!.style.width;
    rerender(
      <ExpandedMap
        cityName="New York"
        subtitle={null}
        worldSize={NYC}
        roadSurfaces={ROADS}
        pois={POIS}
        playerX={0}
        playerZ={0}
        heading={0}
        viewport={DESKTOP}
        dockedOffer={docked()}
        onClose={vi.fn()}
      />,
    );
    const after = screen.getByTestId("expanded-map").querySelector("canvas")!.style.width;
    expect(after).toBe(before);
    // 1440 * 0.26 = 374, capped at the legend's 240.
    expect(screen.getByTestId("gig-offer").style.width).toBe("240px");
  });

  it("keeps the whole comp on a desktop, where the column has room for it", () => {
    renderMap({ dockedOffer: docked() });
    expect(screen.getAllByTestId("map-legend-row")).toHaveLength(5);
    expect(screen.getByTestId("gig-offer").style.height).toBe(`${MOBILE_OFFER_H}px`);
    // The whole comp: the pickup's name, the dropoff line, the detour rail.
    expect(screen.getByTestId("detour-rail")).toBeInTheDocument();
    expect(screen.getByTestId("gig-offer")).toHaveTextContent("Amsterdam Bagels");
    expect(screen.queryByTestId("offer-meta")).toBeNull();
  });

  it("keeps the whole card on a landscape phone now the comp fits", () => {
    // jsdom has no layout, so this arithmetic *is* the check — the same reason
    // `touchDriveControls.test.tsx` asserts the rail budget by hand. New York's
    // column on a 402 px phone is the panel's 366, less a 36 header, five 24 px
    // rows with 5 px between them and two 8 px gaps: 174. Against the old
    // 184-tall comp that was ten pixels short and bought `dense`; against the
    // 153 the comp is now it is room to spare, so the phone gets the pickup's
    // name and the rail back and the legend still keeps its place.
    renderMap({ dockedOffer: docked(), viewport: PHONE });
    expect(screen.getByTestId("gig-offer").style.height).toBe(`${MOBILE_OFFER_H}px`);
    expect(screen.getAllByTestId("map-legend-row")).toHaveLength(5);
    expect(screen.getByTestId("gig-offer")).toHaveTextContent("Amsterdam Bagels");
    expect(screen.getByTestId("detour-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-meta")).toBeNull();
  });

  it("yields the legend only where the panel is too short even for that", () => {
    // Fitted, a 1500x300 corridor city's panel is a letterbox barely taller
    // than the card itself, and no arrangement keeps five legend rows.
    // A clipped ACCEPT would be far worse than a key the player has read.
    renderMap({
      dockedOffer: docked(),
      viewport: PHONE,
      worldSize: { x: 1500, z: 300 },
    });
    expect(screen.queryAllByTestId("map-legend-row")).toHaveLength(0);
    expect(screen.getByTestId("gig-offer").style.height).toBe(
      `${MOBILE_OFFER_DENSE_H}px`,
    );
    expect(screen.getByTestId("offer-accept")).toBeVisible();

    // And it is back the moment the offer is answered.
    cleanup();
    renderMap({ viewport: PHONE, worldSize: { x: 1500, z: 300 } });
    expect(screen.getAllByTestId("map-legend-row")).toHaveLength(5);
  });

  it("answers from inside the map, so the drive never has to be returned to", () => {
    const onAccept = vi.fn();
    const onPass = vi.fn();
    renderMap({ dockedOffer: { offer: OFFER, onAccept, onPass } });
    fireEvent.click(screen.getByTestId("offer-accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("offer-pass"));
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when there is no offer", () => {
    renderMap();
    expect(screen.queryByTestId("gig-offer")).toBeNull();
  });
});

describe("panel fitting", () => {
  it("keeps the world's aspect and fills the binding axis", () => {
    const tall = fitMinimapPanel(NYC, { width: 1000, height: 800 });
    expect(tall.height).toBeCloseTo(800, 6);
    expect(tall.width).toBeCloseTo((800 * NYC.x) / NYC.z, 6);

    const wide = fitMinimapPanel({ x: 1500, z: 300 }, { width: 600, height: 800 });
    expect(wide.width).toBeCloseTo(600, 6);
    expect(wide.height).toBeCloseTo((600 * 300) / 1500, 6);
  });

  it("never returns a box with no area, however little room there is", () => {
    const squeezed = fitMinimapPanel(NYC, { width: -50, height: 0 });
    expect(squeezed.width).toBeGreaterThan(0);
    expect(squeezed.height).toBeGreaterThan(0);
  });
});
