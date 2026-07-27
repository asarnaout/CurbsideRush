// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Milton Keynes is 1500x300. Same rule, opposite result.
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
    // Milton Keynes, Calais and Tokyo have no traffic lights at all, so no
    // cameras — worth the difference between "not found one yet" and "there
    // are none to find".
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
