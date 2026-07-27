/**
 * Every glyph the game draws, as Lucide 24x24 path data.
 *
 * Pure string arrays with no imports, so the pure data modules can name an icon
 * without pulling a React component into their graph — `mapPoi.ts` is
 * node-tested and must stay that way. `HudGlyph` (in `DriveHud.tsx`) turns any
 * of these into an `<svg>`; the drive HUD's convention is stroke-width 2.75.
 *
 * One home per glyph is the point. `FUEL_PUMP_ICON` was already written out
 * twice — once for the HUD's fuel gauge and once, byte-identical, in
 * `SideSwapApp` — and the city map wanting the same pump would have made three.
 * A pump that drifted from the pump beside it is the kind of thing nobody
 * notices and nobody can explain later.
 */

export const FUEL_PUMP_ICON = [
  "M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18",
  "M2 22h13",
  "M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3",
  "M6 8h4",
];
export const CAR_ICON = [
  "M3 13l1.6-4.7A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.3L21 13",
  "M3 13h18v4a1 1 0 0 1-1 1h-1.6",
  "M5.6 18H4a1 1 0 0 1-1-1v-4",
  "M7.6 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
  "M16.4 16.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8",
];
export const CLOCK_ICON = ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3.5 2"];
export const PARCEL_ICON = [
  "m7.5 4.27 9 5.15",
  "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
  "m3.3 7 8.7 5 8.7-5",
  "M12 22V12",
];
export const RIDER_ICON = ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4 21a8 8 0 0 1 16 0"];
export const WALLET_ICON = [
  "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5",
  "M17 13h.01",
];
export const MUSIC_ICON = [
  "M9 18V5l12-2v13",
  "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  "M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
];
/** The note, struck through — pressed/muted is otherwise silent on this glyph. */
export const MUSIC_MUTED_ICON = [...MUSIC_ICON, "M3 3l18 18"];
/** The view camera — the one you cycle with C, not the one that fines you. */
export const CAMERA_ICON = [
  "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z",
  "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
];
export const PAUSE_ICON = ["M7 4h2v16H7z", "M15 4h2v16h-2z"];

/** A folded paper map: the control that opens the whole city, and its legend. */
export const MAP_ICON = [
  "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z",
  "M15 5.764v15",
  "M9 3.236v15",
];
export const CLOSE_ICON = ["M18 6 6 18", "m6 6 12 12"];

/** A garage's spanner. The auto stores of issue #226 — `repair` on the map. */
export const WRENCH_ICON = [
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
];
/**
 * A slice. Already the offer card's glyph for a food job, so the diner it loads
 * at is marked with the same thing — one picture, one meaning.
 */
export const FOOD_ICON = [
  "M15 11h.01",
  "M11 15h.01",
  "M16 16h.01",
  "m2 16 20 6-6-20A20 20 0 0 0 2 16",
  "M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4",
];
/** A shopping bag: the corner grocers and convenience stores. */
export const SHOPPING_BAG_ICON = [
  "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z",
  "M3 6h18",
  "M16 10a4 4 0 0 1-8 0",
];
/**
 * A camera on a bracket — an enforcement camera watching a junction, and
 * deliberately nothing like `CAMERA_ICON`, which is the view you cycle with C.
 */
export const TRAFFIC_CAMERA_ICON = [
  "M7 9h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z",
  "M19 11.5 22 10v5l-3-1.5",
  "M9 15v3a2 2 0 0 1-2 2H5",
  "M12 5v4",
];
