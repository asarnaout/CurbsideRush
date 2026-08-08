# The drive screen: layers, HUD, touch controls and both maps

Read this before touching `DriveHud.tsx` (or the `driveHud/` modules it
re-exports), `TouchDriveControls.tsx`, `MinimapCanvas.tsx`, `ExpandedMap.tsx`,
or anything positioning an overlay on the drive screen.

## One z-order, spanning two files

**`DRIVE_LAYER` in `driveLayers.ts` is the drive screen's only stacking order.**
Controls come from `GameCanvas`, the HUD from `DriveScreen.tsx` (the drive
screen `SideSwapApp.tsx` renders, since the Phase 5 god-file decomposition),
and they are siblings in `.game-page`'s stacking context.

```
scrim 5  <  hud 10  <  touch 20  <  toast 30  <  action 40  <  offer 45  <  curtain 50
```

Hard-coding a z-index in either file is how the steering control ended up painted
under the status card and the pedals under the minimap for months — invisible, yet
still tappable through the HUD's `pointerEvents: "none"`, so nothing failed and no
test could see it.

`shellStyle` must therefore **not** set `isolation: "isolate"`: that makes the
GameCanvas subtree atomic at its own level, and no control inside could then
outrank a HUD sibling.

Two layer facts are load-bearing: the nav card is `pointerEvents: "none"` on
`DRIVE_LAYER.hud`, and the offer card is above it — which is the only reason an
accept button can be clicked at all. The offer then gets `offer`, a rung to
itself, because it is the only target with a countdown and the next overlay
added below it on `action` would silently cover ACCEPT. It does **not** outrank
`ExpandedMap`, also on `action`: see the map's own section for why that
collision does not exist.

## `DriveHud.tsx` is a barrel over `driveHud/`, and every module is props-pure

`DriveHud.tsx` holds no implementation (#290) — it re-exports eight
`driveHud/*.tsx` modules (tokens, navCard, dayTimer, speed, money, alerts,
offer, cornerButton), split along measured coupling rather than this doc's
section layout, so grep for a symbol rather than guessing its file from
subject matter; every importer still uses `./game/DriveHud` unchanged. No
module has a Babylon import, so `driveHud.test.tsx` renders all of them in
jsdom; `SideSwapApp` computes every string they show.

**One set of components serves both form factors, from two comps.** Desktop is a
fixed `HUD_DESIGN_WIDTH` (1920) × 1080 frame scaled whole (`resolveHudScale`,
floored at `HUD_MIN_SCALE` 0.68) rather than re-derived responsively; `compact`
swaps in the mobile comp's sizing via a metrics table per cluster (e.g. the nav
card is 486 px desktop, 330 px mobile).

**Both comps make the offer card exactly as wide as whatever it stands over, and
that is a rule, not a coincidence.** On a desktop that neighbour is the minimap
(`OFFER_W` and the `size` handed to `Minimap`, both 344, or the right edge
steps); on a phone it is the pedals, so the width is derived from
`TOUCH_PEDAL_ROW_PX` rather than copied — resizing BRAKE cannot then leave the
card overhanging. `OFFER_TOP_OFFSET_PX` scales with `resolveHudScale` for the
same reason: 150 px of desktop clearance closes as the window narrows, and a
fixed offset would put the card on the map. Only the offer differs in kind.
`DriveOfferBar` lands in the minimap's slot and dims the map, because there
is nowhere else on a phone for something that size.
**Its height comes from the slot between the button rail and the pedals, never
from the comp**: the comp is drawn on a 400 px frame, the shortest landscape phone
the rail budget admits is 320, and Safari with toolbars leaves ~343 — below
`RAIL_MIN_SLOT_PX` (140) the detour rail drops rather than the card growing into
DRIVE. That constant has to stay under `MOBILE_OFFER_H`, or the rail the comp
draws would never render at all.

That rule outgrew the phone. `DriveOfferPanel` takes a width and a height and
knows nothing about where it is; `DriveOfferBar` is only the absolute placement
around it, and the whole-city map is its second home. **Both callers must give it
real numbers** — the fuse is an SVG stroke whose `viewBox` is those numbers, so a
percentage width would letterbox or distort it.

The balance sits in the job card on touch, not the corner: that corner carries
camera/pause/fullscreen, the only way to reclaim Safari's chrome mid-drive.

**The career shift clock has two homes, and only one may be on screen at a
time.** `resolveDayTimer` feeds both the numerals inside `DriveSpeedCluster` and
the `DriveDayEdge` bar, so the two can never disagree about what colour the day
is. `dayTimerInRow` (`SideSwapApp.tsx` computes it, `DriveScreen.tsx` reads it)
is the switch: when false, the clock falls back to the `money.label` line in
`DriveStatusCard`'s header, which is where it lived before #236.

**On a phone that switch is a width question, and the constant that decides it is
governed by `SAFE_RIGHT`, not by the obvious arithmetic.** The band's right end
is the app's two corner buttons plus the session's utility row; a notched handset
in landscape adds ~47px of inset on whichever side the notch lands, so half the
time the rail arrives ~35px further in. That is why
`DAY_TIMER_MIN_VIEWPORT_PX` sits above 812 rather than the ~784 a 12px inset
suggests. The edge bar is never gated on it — it spans the viewport at any width.

For the same reason the phone's label drops `DAY n` and hangs off the *right* of
its block: it is the widest thing there and it points at that rail. Which day it
is survives in the day-title card and the ledger. `DriveDayEdge` itself is the
one HUD element `resolveHudScale` does not touch: it is anchored to the
viewport's edges rather than laid out in the comp's frame, so scaling it would
leave a gap at one end — which also means its height is the one number in
`DAY_TIMER_METRICS` already in real screen pixels.

## The touch layout is one budget split across two files

`TouchDriveControls.tsx` has **no Babylon import**, so
`tests/touchDriveControls.test.tsx` can render it in jsdom. A landscape phone
is ~343 px tall, not the ~390 the arithmetic wants.
`TOUCH_TOP_RAIL_PX` / `TOUCH_MINIMAP_PX` / `TOUCH_PEDAL_BLOCK_PX` /
`TOUCH_LEFT_RAIL_PX` are **exported** because `DriveScreen.tsx` places the status
panel and minimap against them, and the rail arithmetic is asserted in
`touchDriveControls.test.tsx` — jsdom has no layout, so that test *is* the check.

Two constants that look like one but are not: `TOUCH_TOP_RAIL_PX` is a **height**
(what the minimap sits below) and `TOUCH_CORNER_SLOT_PX` a **width** (how far one
more corner button reaches inward). They were the same constant while the app had
exactly one button.

The right edge reads top-down: buttons, minimap, pedals — which only fits because
the pedals sit **abreast**; stacked they were ~194 px and owned the whole edge.
Abreast is also what the offer card's width is measured against, above.

Steering is drag-with-a-floating-origin (`touchSteering.ts`, pure); the release
ease runs in `fixedUpdate` via `touchSteerReleasing`, never in React. **The
visible slider is an affordance drawn *inside* the drag region, not the target.**

## The corner minimap

The widget fits the whole world only while the world is small: past
`MINIMAP_FOLLOW_SPAN_M` (`minimap.ts`, 500 m) it keeps its scale and **scrolls**
instead, blitting the window the car sits in the middle of out of a sheet
rasterised once for the whole world. The sheet lays down park fills first
(`drawMapParks` — green rects for every `kind: "park"` landmark over a
short-side floor that hides roundabout islands), then water, then roads, so a
lake inside its park reads as water over green and bridges stay clear road
lines. Both maps take `parks` the same way they take `waterBodies`; the caller
derives the list through `parksFromLandmarks`, whose per-landmark-array cache
is what keeps this sheet from re-rasterising every HUD frame. **Every shipped city is over the span, so
the widget always scrolls.** Roads draw as translucent strips floored at a
share of the widget (`minimapRoadFloorPx`, 5.8%), not at true scale, where a
10.4 m street would be under 2 px. At the shipped follow span that floor
governs *every* authored road (beating it takes a carriageway over ~31 m; the
widest authored anywhere is 25 m), so streets of different widths deliberately
draw alike, and crossings brighten purely from the strips overlapping — there
is no junction pass.

## The whole-city map (`ExpandedMap`, opened with M)

**It is the fitted branch, and must never touch `resolveMinimapScale`** — that
answers `follows` for every city, and a follow-scale sheet at screen size
rasterises NYC's full 2600×3000 m world into a multi-megapixel sheet for a
view meant to show the whole thing at once anyway.

`createMinimapFitProjector` is the only way in. It takes a width *and* a height
because the cities are nothing like square (2600×3000 for NYC against London's
800×540), and `fitMinimapPanel` cuts the canvas to the world's own aspect
so no part of it is spent on empty ground.

Its road floor is flat pixels (`MAP_ROAD_WIDTH_FLOOR_PX`, 1.75), the **opposite
balance to the widget**: fitted, true width governs and the floor only catches
alleys.

**Both maps share `minimapDraw.ts`** for water beneath roads as well as
navigation, and **symbol sizes are an input to it** — the widget's
fractions-of-its-edge rule would give a 27 px route line on a screen.

It does **not** pause. It closes itself while paused (same `action` layer, and the
app paints after the session), derived rather than a close so it returns after.

**An offer does not close it, and does not float over it either — it docks into
it** (#241). While the map is up the HUD renders no card at all and
`DriveOfferPanel` goes in the legend column, so there is exactly one `gig-offer`
on screen and never two rectangles colliding. That is not only tidier: a card
anchored to the viewport over a centred panel overlapped by an amount that fell
out of the *city's aspect ratio* — Cairo clipped the legend, New York never
touched it. And the map is where an offer is best read, because `previewRoute`
already draws the dashed detour to its pickup.

**The card takes the column's width, so the canvas is sized identically with an
offer up or not** — the map must never resize under someone reading it. Height is
what gives, and the order of concessions is: legend first, then the whole card.

**A card in a box shorter than its content does not scale down — it eats
itself.** The type sizes are fixed, so the flex children shrink instead and the
pickup's name is sliced in half by the line under it. Hence `dense`, a *shorter*
card rather than a smaller one: same type, minus the pickup name, the dropoff and
the detour rail, all of which the map it stands on already shows; the tip drops
from beside the pay to the meta line. `DriveOfferBar` never sets it — out on the
road there is no map to read the pickup off. A landscape phone used to be what
bought `dense`, at 174 px of column against the 184 the comp then wanted. **It
no longer is:** the comp is 153, so a phone keeps the whole card *and* the
legend, and only a letterbox city (very wide, very shallow) still goes dense —
do not delete it for want of a caller.

`COLUMN_HEADER_PX` and `LEGEND_ROW_PX` are that arithmetic written down rather
than measured — a DOM read here is a forced reflow per frame, and jsdom has no
layout to measure anyway, so **those constants are the test**. The legend yields
only when not even the dense card fits beside it.

Key handling is asymmetric on purpose:

- **M is a *bubble* listener** in `SideSwapApp`, so `ConfirmDialog`'s capture-phase
  swallow keeps it inert.
- **Escape needs capture + `stopImmediatePropagation`**, or `BabylonGameSession`'s
  own Escape→`togglePause` fires and the drive pauses behind the closing map.
  **Only Escape may be swallowed** — the car is still moving and the player still
  needs the throttle.
- Focus lands on the panel, never a button: Space is the handbrake.

**`collectMapPois` (`mapPoi.ts`, cached per pack) is the one source of what either
map marks**, each position coming from the resolver that already owns it (fuel
markers sit on the pumps, not the lane anchor ~19 m out on the carriageway).
Markers are DOM icons over the canvas — one `HudGlyph`, shared with the
legend, and jsdom has no `Path2D` — so **anything drawn on the canvas is
behind them**. Hence the car's own second canvas above the icons, and hence
the place you are routed to drawing no marker of its own.

## Viewport, fullscreen and safe areas

**Mobile Safari only hides its toolbars in response to scrolling, and the drive
screen cannot scroll** — `.game-page` is `position: fixed` with
`overscroll-behavior: none` and `touch-action: none`. So rotating on the launcher
(scrollable) hides the chrome and the state survives into the drive, while rotating
once driving never can. There is no CSS route; the Fullscreen API is it, which
needs a gesture, which is why `TouchDriveControls` carries a fullscreen
**toggle** — offered whenever the API exists and the page is not already
`display-mode: standalone`.

`canFullscreen` checks **both spellings**: a `requestFullscreen` guard alone no-ops
on any WebKit that only has `webkitRequestFullscreen`, which reads as the feature
being unimplemented. `screen.orientation.lock()` has never shipped in Safari at
all, so the rotate gate stays — cheap, pausing the session, never again gating
session *construction*.

`applyViewportFitCover` patches the rendered viewport meta at runtime; without it
every `env(safe-area-inset-*)` in the HUD and controls is `0px`. See
[build-and-deploy.md](build-and-deploy.md) for why it cannot be declared.

## Launcher CSS traps

- **The launcher's breakpoints are width-only, and a landscape phone is ~874 px
  wide under `viewport-fit=cover`** — so it takes the *desktop* two-column layout,
  not the ≤860 px column. Which side of 860 px it lands on depends on whether the
  safe-area insets are counted, so a landscape bug can show in one iOS browser and
  not another.
- Hence `.launcher-shell`/`.launcher-page` size with **`min-height`, never
  `height`**: a box shorter than its own copy column drops the
  absolutely-positioned `.launcher-legal` out of the bottom padding band it lives
  in and into the middle of the city chips (#204).
- **`.app-shell` sets `overflow: hidden`, which silently disables
  `position: sticky` anywhere below it** — it is a scroll container, so a sticky
  child pins to *it* rather than the viewport and simply never moves. The career
  pages override it to `overflow: clip` (clips identically, no scrollport) inside
  the 860 px block, which lets the garage dock and portrait travel bar pin; at
  ≤480 px high the travel bar deliberately returns to normal flow so it cannot
  cover the heading on a landscape phone. Nothing warns; the element just sits in
  flow.

jsdom has no layout, so none of this is testable — the check is a WebKit
screenshot at 874×402.
