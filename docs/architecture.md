# Architecture

The layering, the purity rules that hold it up, and the vocabulary traps. Read
this before adding a module or moving a responsibility between files.

## Four rings; dependency arrows only point inward

```
SideSwapApp.tsx     views, economy, gigs, fuel, damage, music, localStorage
   | props                    ^ GameHudSnapshot (10 Hz) + GameRuntimeEvent
GameCanvas.tsx      Babylon scene, input, cameras, audio, own fixed-step pump
   | SimulationInput          ^ SimulationSnapshot (plain data)
simulation.ts       SimulationCore — physics, traffic, rules, scoring
   ^ SimulationCoreConfig
simulationAdapter   authored MapPack + lesson -> core config (build-time only)
```

The props/HUD/event types on the SideSwapApp<->GameCanvas edge — including
`GameHudSnapshot` and `GameRuntimeEvent` above — live in
`app/game/sessionContract.ts`, not in `GameCanvas.tsx` itself. It is
types-only (enforced by `tests/architecture.test.ts`) and sits outside the
ring diagram: everything that needs the shared vocabulary imports it
directly, including `GameCanvas.tsx` and `simulationAdapter.ts`, without
that making either of them a dependency of the other.

`simulation.ts` imports **only** `./types` — no React, DOM, Babylon,
`Math.random`, or `Date.now`. That purity is the load-bearing property of the
whole design and is guarded by `tests/architecture.test.ts`, which also pins
the ring arrows above (GameCanvas never reaches `content.ts`; SideSwapApp
touches GameCanvas only through one `dynamic()` literal, plus at most one
type-only import which today it has none of, having moved everything to
`sessionContract.ts`). See [simulation-core.md](simulation-core.md).

`simulationAdapter.ts` imports `sessionContract.ts` **type-only** for the
lesson/map-pack shapes it consumes, so there is no cycle with `GameCanvas.tsx`;
it also pulls `content.ts` and `visuals.ts` at runtime, which is why it is a
build-time translator and never runs in the frame loop.

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
| `speeding.ts` | types only | Citation band + excess measurement |
| `cockpitLayout.ts` | types only | Every cabin number |
| `cutsceneScript.ts` | types only | Cutscene choreography |
| `audioMath.ts` | `seededUnit` from `visuals` | The entire car sound model |

`speeding.ts` is pure *because* both rings need it and neither can reach the
other's: `GameCanvas` never imports `content.ts`, and `SideSwapApp` only loads
`GameCanvas` lazily through `next/dynamic`.

**`app/game/geometry/*.ts`** (six files — `roadStrips`, `roadFurnitureLayout`,
`waterGeometry`, `facadesAndKeepouts`, `cairoParkland`, `routeGuidance`) is
the same kind of pure module, moved out of `GameCanvas.tsx` by the god-file
decomposition. It isn't hand-listed above because its purity is mechanically
enforced rather than a fact to remember: `tests/architecture.test.ts` fails
the suite if any file under `geometry/` gains an `@babylonjs` import. Their
Babylon-owning counterpart, `app/game/render/*.ts`, has no such guarantee —
`renderConstants.ts` is genuinely import-free but the rest construct real
Babylon objects (`DynamicTexture`, `VertexData`, `MeshBuilder`) and belong on
the render side of the ring, not this table.

## What the core deliberately does not know

**The core knows nothing about gigs, money, fuel or damage.** Everything
economic is an outer ring, and **the core's own score and event history are
never persisted**. Two durable consequences are derived from them outside it: a
wallet debit, and — career only — the star a customer leaves, which counts the
rule trips the app saw while carrying (see [economy.md](economy.md)).

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

## `lesson` does not mean a lesson

The game pivoted from a driving curriculum to an open-world gig driver. The
lessons were deleted; the save key is `sideswap:v2` (`PROGRESS_STORAGE_KEY`).

**`lesson` survives as internal vocabulary.** `GameCanvasLesson` is the *runtime
scenario contract*, and the only scenario type left is free drive.
`buildFreeDriveLesson` / `buildCareerDayLesson` (`app/game/freeDriveLesson.ts`,
pinned by `tests/freeDriveLesson.test.ts`) both produce `kind: "free_drive"` with
empty `route`/`checkpoints`/`coachPrompts`, and `SideSwapApp` builds
`runtimeLesson` from one of them every render. **Don't hand-roll the literal
again** — five copies is what the factory replaced.

Vestigial branches for retired content survive (`yard-*`/`xf-*` lane ids,
`RoadSurfaceType`'s `"orientation"`, `GameCanvas`'s `"orientation-yard"`
default). No such map exists.

## The build-time boundary

`buildSimulationCoreConfig` runs **once**, in the `BabylonGameSession`
constructor — never in the frame loop. It translates lanes, infers single-lane
adjacency, synthesizes signal phases and supplemental oncoming traffic gates.

Its throws all sit on route/maneuver validation, **which free drive skips** — so
on a live map it does not reject bad data, it degrades quietly: short lanes are
filtered out, unresolvable checkpoints dropped, out-of-range anchors clamped to
a lane end. The tests are the real guardrail. See
[map-authoring.md](map-authoring.md).

## Sharp edges that cut across rings

- **Unreachable code does not warn.** `tsconfig` has no `noUnusedLocals` and
  ESLint treats unused vars as warnings, so a `private` method that loses its
  last caller just sits there. When you supersede a subsystem, delete its old
  path in the same change. Two traps that will recur:
  - **Duplicate names across layers.** `buildConnectedNpcPath` is *both* a
    `BabylonGameSession` private wrapper and a live module-level function in
    `npcPaths.ts`. Never delete or rename by name alone.
  - **Write-only struct fields**, which nothing flags at all — `NpcVehicle`
    once carried ten that were assigned at spawn and read only by a dead subtree.
- **A new field usually has to be declared in a second place, or it is silently
  dropped.** Any new mutable field on `SimulationCore` must be reset in
  `reset()` (and usually `restoreCheckpointPose()`); `reset()` is called from the
  constructor, so its fields must be initialized above that line.
  `migrateProgress` runs on **save as well as load** and rebuilds from known keys
  only, so a new field on `PlayerProgressV2` is stripped on the next write unless
  added there too.
- **`window.__sideswap*` debug hooks install once in `installDebugHooks`** and
  are deleted in `dispose()`. A new hook must be added to both, or it leaks the
  disposed session.
- **`app/globals.css` is ~3.4k lines and substantially dead** (removed lesson
  hub, passport, results views) — roughly a third of its class selectors have no
  reference left in any `.tsx`. The drive HUD is inline styles, not CSS; only
  `@keyframes` live there, since a style object cannot express one.
