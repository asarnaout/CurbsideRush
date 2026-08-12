# Architecture

The layering, the purity rules that hold it up, and the vocabulary traps. Read
this before adding a module or moving a responsibility between files.

## Four rings; dependency arrows only point inward

```
SideSwapApp.tsx     views, economy, gigs, fuel, damage, music, localStorage
   | props                    ^ GameHudSnapshot (10 Hz) + GameRuntimeEvent
GameCanvas.tsx      Babylon scene, input, cameras, audio, own fixed-step pump
   | SimulationInput          ^ SimulationSnapshot (plain data)
simulation.ts       SimulationCore — physics, traffic, rule events
   ^ SimulationCoreConfig
simulationAdapter   authored MapPack + DriveScenario -> core config (once)
```

This ring's own implementation is split across two files:
`GameCanvas.tsx` is the React wrapper (props contract, canvas
element, load/fullscreen UI) that constructs and disposes the session; the
exported `class BabylonGameSession`, in `render/babylonGameSession.ts`, is
everything the ring label above describes — the Babylon scene, input,
cameras, audio and the fixed-step pump. See rendering.md's "Shape of the
file" for the split.

The outer ring is split too, since the Phase 5 god-file decomposition:
`SideSwapApp.tsx` stays the state owner (progress, career, dispatch, the
view switch) and composes `app/LauncherView.tsx`, `app/SettingsView.tsx`,
`app/CreditsView.tsx` and `app/DriveScreen.tsx` — each a props-pure child
component, all state and derived values threaded down rather than read
from context. `app/uiControls.tsx` and `app/MobilePlayTips.tsx` hold
`LauncherView`'s/`SettingsView`'s own shared form controls;
`app/useGamepadUiNavigation.ts` is a standalone hook.

`handleGameEvent` (the `GameRuntimeEvent` switch) no longer stays inline: its
38-binding closure (issue #289) is grouped into three app-layer
state-action **ports**, each a hook returning live state plus atomic mutator
methods — `app/drivePort.ts` (vehicle condition, tow, the staged cutscene,
citation dedupe), `app/careerPort.ts` (the in-flight career day: cash,
ledger, day clock, settlement coordination) and `app/gigDispatchPort.ts`
(the active gig, its queue slot, carrying-leg bookkeeping, payout). The
switch itself is `useGameEventHandler` in `app/useGameEventHandler.ts`,
called with the three ports plus the few bindings with no port to belong to
(`progress`/`driveFuel`, both plain `SideSwapApp` state). `SideSwapApp`
still calls all three port hooks itself and destructures their fields under
the same names its other code already used, so only `useGameEventHandler`
needed the `port.field` form throughout.

**Every port write is a method, never an exposed ref setter** — not a style
preference, a hard requirement. `useGameEventHandler` receives the three
ports as plain arguments, and the React Compiler's ESLint rules
(`react-hooks/immutability`) forbid mutating anything reachable from a
hook's own arguments, `ref.current` writes included; only a ref created by
a *local* `useRef` in the hook that owns it is provably safe to mutate. This
bit even single dedupe timestamps with no paired state (e.g.
`drivePort.ts`'s `stampFineAt`) — reads are unaffected, so a port's refs
stay exposed for direct reading, but every write from outside the port that
created it must go through a method.

The props/HUD/event types on the SideSwapApp<->GameCanvas edge — including
`GameHudSnapshot` and `GameRuntimeEvent` above — live in
`app/game/sessionContract.ts`, not in `GameCanvas.tsx` itself. It is
types-only (enforced by `tests/architecture.test.ts`) and sits outside the
ring diagram: everything that needs the shared vocabulary imports it
directly, including `GameCanvas.tsx`, `render/babylonGameSession.ts` and
`simulationAdapter.ts`, without that making any of them a dependency of
another.

`simulation.ts` is itself split across a stable facade (`SimulationCore`, the
fixed-step tick order, and the public API) and four seam modules under
`app/game/simulation/` — `roadNetwork.ts`, `playerDynamics.ts`,
`trafficSystem.ts`, `roadRuleMonitor.ts` — see
[simulation-core.md](simulation-core.md) for what each owns. The purity that
matters spans the whole set, not just the facade file: every one of the five
imports only from `./types`/`../types`, a sibling `simulation/*.ts` module,
or — type-only — back to the facade for shared vocabulary
(`SimulationPoint`/`TurnSignal`/`MutablePose`, the same pattern #291 used for
`MAP_VISUAL_PROFILES`). No React, DOM, Babylon, `Math.random`, or `Date.now`
anywhere in the set. That purity is the load-bearing property of the whole
design and is guarded by `tests/architecture.test.ts`, which walks every file
in `app/game/simulation/` rather than hand-checking `simulation.ts` alone.
Dependency arrows and forbidden content/app-shell imports are enforced by the
flat ESLint config (`curbside-rush/game-boundaries` and
`curbside-rush/simulation-purity`); the architecture test retains
source-shape checks ESLint cannot express: `app/DriveScreen.tsx` holds the
one `dynamic()` GameCanvas literal and `SideSwapApp.tsx` has no GameCanvas
reference, even type-only.

`simulationAdapter.ts` imports `sessionContract.ts` **type-only** for the
scenario/map-pack shapes it consumes, so there is no cycle with
`render/babylonGameSession.ts`; it also pulls `content.ts` and `visuals.ts`
at runtime, which is why it is a build-time translator and never runs in the
frame loop.

`content.ts` is a registry over per-city data in `app/game/cities/`
(`nyc.ts`, `tokyo.ts`, `london.ts`, `cairo.ts`) — each exports its own map
pack, free-drive definition and (London/Cairo) rule references; `content.ts`
imports and re-exports them, never the other way. `render/` may import
`cities/` (`roadsideProps.ts` reads Cairo's `CAIRO_OPEN_WATERFRONT_SIDES`;
`render/cityRenderRegistry.ts` maps a mapId to that city's own landmark and
street-furniture builders — see [rendering.md](rendering.md)) — enforced by
`import/no-restricted-paths`, which also bans `render/`/`geometry/` from
importing `content.ts` directly.

## Pure modules and what "pure" buys

These have no Babylon, no DOM and no clock, so their tests run in plain node and
their invariants can be pinned without an engine:

| Module | Imports | Owns |
|---|---|---|
| `gigs.ts` | *none* | Seeded gig generation |
| `gpsRoute.ts` | *none* | A\* over the lane graph, legs + manoeuvres |
| `driveLayers.ts` | *none* | `DRIVE_LAYER` z-order |
| `minimap.ts` | *none* | Both maps' projections |
| `renderInterpolation.ts` | *none* | prev/current pose blend |
| `touchSteering.ts` | *none* | Drag-with-floating-origin steering |
| `mirrorRenderList.ts` | *none* | Mirror cell cull |
| `renderScaling.ts` | *none* | Touch scaling ladder + desktop level |
| `crowdRenderMath.ts` | *none* | Thin-instance matrix conjugation |
| `damage.ts` | *none* | Collision → condition loss |
| `dispatch.ts` | `hashToUnit` from `gigs` | When work appears, surge, tips |
| `career.ts` | types only | The whole career economy |
| `economyTables.ts` | `FULL_CONDITION_PCT`/`speedingFineMultiplier`/`ROADSIDE_*` from `damage`/`speeding`/`career` | Per-country pricing (fuel, fares, fines, repairs, starting cash) + money/distance formatters |
| `speeding.ts` | types only | Citation band + excess measurement |
| `cockpitLayout.ts` | types only | Every cabin number |
| `cutsceneScript.ts` | types only | Cutscene choreography |
| `audioMath.ts` | `seededUnit` from `visuals` | The entire car sound model |

`speeding.ts` is pure *because* both rings need it and neither can reach the
other's: `GameCanvas` never imports `economyTables.ts`, and `SideSwapApp` only
loads `GameCanvas` lazily through `next/dynamic`.

**`app/game/geometry/*.ts`** (`roadStrips`, `roadFurnitureLayout`,
`waterGeometry`, `facadesAndKeepouts`, `cairoParkland`, `buildingLayout`,
`venuePlacement`, `landmarkGroundSolids`) is
the same kind of pure module, moved out of `GameCanvas.tsx` by the god-file
decomposition. It isn't hand-listed above because its purity is mechanically
enforced rather than a fact to remember: ESLint rejects Babylon/React imports
and browser or DOM globals in every file under `geometry/`. Their
Babylon-owning counterpart, `app/game/render/*.ts`, has no such guarantee —
`renderConstants.ts` is genuinely import-free but the rest construct real
Babylon objects (`DynamicTexture`, `VertexData`, `MeshBuilder`) and belong on
the render side of the ring, not this table.

`buildingLayout`/`landmarkGroundSolids` are pure for the same reason
`speeding.ts` is above: `render/` and `simulationAdapter.ts` both consume
their exact output, so a rendered building or landmark and its collider can
no longer independently drift into two different shapes.

## What the core deliberately does not know

**The core knows nothing about gigs, money, fuel or damage.** Everything
economic is an outer ring. Wallet debits and — career only — customer ratings
are derived from the rule events the app sees while driving (see
[economy.md](economy.md)).

- **Gig arrival** is app-side: stopped inside `GIG_ARRIVAL_RADIUS_M` (14 m)
  stages an **interaction cutscene**; the gig advances when the scene's `done`
  event lands.
- **Refuel** debits and fills at the scene's `pump` step, not at the button.
- **Repair** pays and mends at the scene's `repair` step.
- **A witnessed fine** debits at the pull-over scene's `cite` step.
- **Fuel** is enforced at the input boundary — throttle is zeroed before it
  reaches the core.
- **The minimap's GPS line** is outer-ring: `SideSwapApp` runs `gpsRoute` from
  `handleHud`, once per destination change and then only once the player is 30 m
  off the line, throttled to 1.5 s. Never per frame, never per step. Holding the
  route rather than re-deriving it is also what keeps the drawn line still,
  since a grid offers many equal-cost staircases. It shares no state with
  `routeDistanceAhead`, the hot in-sim lane search.

## A drive always starts from authored data

`DriveScenario` is the minimal runtime contract: identity, a player spawn id,
traffic seed/density and an optional scenario clock. `buildFreeDriveScenario`
and `buildCareerDayScenario` (`app/game/driveScenario.ts`) are the factories;
do not hand-roll copies in the app.

Both `scenario` and `mapPack` are required by `GameCanvas`. The adapter resolves
`startSpawnId` through the map's player spawns and lane anchors and throws a
descriptive error for a missing, non-player, malformed or out-of-range start.
There is no synthetic map or start-position fallback.

## The build-time boundary

`buildSimulationCoreConfig` runs **once**, in the `BabylonGameSession`
constructor — never in the frame loop. It validates the authored player start,
translates lanes, infers single-lane adjacency, and synthesizes signal phases
and supplemental oncoming traffic gates. See
[map-authoring.md](map-authoring.md).

## Sharp edges that cut across rings

- **Some unreachable code is invisible to the gates.** ESLint warnings now fail
  the lint command, but `tsconfig` has no `noUnusedLocals`, and a `private`
  method that loses its last caller can still sit there without a diagnostic.
  When you supersede a subsystem, delete its old path in the same change.
  Write-only struct fields are a recurring trap because nothing flags them.
- **A new field usually has to be declared in a second place, or it is silently
  dropped.** Any new mutable field on `SimulationCore` must be reset in
  `reset()`; `reset()` is called from the
  constructor, so its fields must be initialized above that line.
  `saveProgress` normalizes through the current-schema `parseProgress`, so a new
  field on `PlayerProgressV2` is stripped on the next write unless added there
  too.
- **`window.__sideswap*` debug hooks install once in `installDebugHooks`** and
  are deleted in `dispose()`. A new hook must be added to both, or it leaks the
  disposed session.
- **The drive HUD is inline styles, not CSS.** Its shared animations live in
  `app/globals.css`, since a style object cannot express `@keyframes`; new HUD
  layout selectors do not belong there.
