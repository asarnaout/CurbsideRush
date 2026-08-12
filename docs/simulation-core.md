# The simulation core

`app/game/simulation.ts` — physics, traffic and road-rule events, as the
stable public facade over four seam modules under `app/game/simulation/`.
Read this before touching the core, the adapter, or anything that changes NPC
behaviour, and before adding a `RuleCode`.

## The seam split

`SimulationCore` owns the fixed-step tick order (`fixedUpdate`) and every
field the public API (`step`, `getSnapshot`, `reportExternalContact`, ...)
touches directly, but delegates to four collaborators, each `SimulationCore`
holds as a field and constructs once:

- **`simulation/roadNetwork.ts`** (`RoadNetwork`) — the lane graph, traffic
  lights, stop lines, and every pure geometry/timing query against them
  (`pointOnLane`, `projectToRoad`, `routeDistanceAhead`, `trafficLightTiming`,
  ...). Read-only after construction bar its own route-search scratch
  buffers. The one seam every other seam and the facade itself all depend on.
- **`simulation/playerDynamics.ts`** — pedal/steer integration (`movePlayer`)
  and static-world collision (`resolveStaticCollisions`), operating on a
  plain `PlayerPhysicsState` object `SimulationCore` holds and passes by
  reference (not a class — the player's pose and speed are read from too
  many unrelated places in `simulation.ts` for method-wrapping to buy
  anything).
- **`simulation/trafficSystem.ts`** (`TrafficSystem`) — seeded NPC spawn,
  gate safety, decisions, movement, corner-arc rendering, lane changes, and
  jam/incident recovery. Owns the PRNG (`SeededRandom`) outright: both
  places it is ever consumed (initial spawn, the 10 Hz decision pass) are
  internal to this class.
- **`simulation/roadRuleMonitor.ts`** (`RoadRuleMonitor`) — open-world rule
  detection: speeding, wrong-way, out-of-bounds, following distance, passing
  lane, box junctions, restricted lanes, and every stop-line kind. Reports
  through an `emitEvent` callback rather than owning the event queue itself
  — `events`/`ruleCooldowns` stay on `SimulationCore`, since
  `playerDynamics.ts`'s two collision paths and `reportExternalContact` all
  report into the same queue.

**`checkCollisions` (the player/NPC impact resolver) stays on `SimulationCore`
itself**, not in any seam: it reads and writes both the player's physical
state and an NPC's internal state in one atomic pass (separating the two
bodies, rebounding the player, marking the NPC struck) plus calls
`resolveStaticCollisions` so the separation shove can't bury the player in a
wall — genuinely the intersection of two seams, not cleanly either one.

Every seam-owned piece of per-tick-volatile state
(`viewHeading`/`roadState`/`elapsedSeconds`/`tick`) is threaded through as an
explicit `TrafficTickCtx`, built fresh by `simulation.ts` at each call site —
`RoadNetwork` and the stable parts of `TrafficSystem`/`RoadRuleMonitor`
(themselves, `playerState`, `config`) are captured once at construction
instead, since none of those three are ever reassigned wholesale.

The purity guard (`tests/architecture.test.ts`) that used to check only
`simulation.ts` now walks every file in `app/game/simulation/`: each may
import type-only from `../types`, type-only back to `../simulation` itself
(for shared vocabulary like `SimulationPoint`/`TurnSignal`/`MutablePose` —
the same pattern issue #291 used for `MAP_VISUAL_PROFILES`), or freely from
a sibling `simulation/*.ts` module — nothing else, and the same forbidden-
token check (no `Math.random`, `Date.now(`, `@babylonjs`, ...) applies to
every file, not just `simulation.ts`.

## Static obstacles come from the shared building plan, not from blocks

`simulationAdapter.ts`'s `buildStaticObstacles` does not walk
`mapPack.geometry.blocks` to build one collider per authored block. It walks
the same `BuildingLayoutPlan` (`geometry/buildingLayout.ts`) the renderer
paints — one `tag: "building"` OBB per planned building's own structural
solids, not per block — so a rendered building and its collider are the
identical shape by construction, never two independently-derived
approximations of "where is a building." `BabylonGameSession` computes the
plan once and threads that exact instance into both
`buildScenarioEnvironment` and `buildSimulationCoreConfig`; a caller with no
reason to share one across rings (a direct test, a one-off tool) may omit it
and `buildSimulationCoreConfig` computes its own from `mapPack` +
`scenario.trafficSeed` — but a supplied plan for the wrong map/seed throws
rather than silently resolving collision against the wrong drive's buildings.

Service-point lots (gas/repair) need no carving out of a collider any more:
the plan already excludes any building whose placement would land inside one
(`buildingKeepOuts`). `tests/buildingColliderAgreement.test.ts` is the exact
plan-to-collider parity proof — every planned solid has exactly one obstacle
and vice versa, at float epsilon, across all four maps.

### Bespoke landmarks need their own ground solid, not the generic kind box/circle

`mapPack.geometry.landmarks` sits outside the building plan — a city renderer
either draws a landmark's generic `kind` verbatim (box for station/shops/
museum/cultural, circle for tower/monument) or replaces it with a bespoke
shape. `buildStaticObstacles`'s landmark loop asks `geometry/landmarkGroundSolids.ts`
first: a defined result (compound `aabb`/`obb`/circle/**convex** `GroundSolid`s,
`tag: "landmark"`) is authoritative; `undefined` means the bespoke renderer was
checked and found to draw exactly the generic shape at vehicle height. The
clockwise-wound `convex` `StaticObstacle` kind exists only for this; every
`kind`/`shape` switch has an explicit convex branch, none silently falling
back to a circle or box for a shape needing more than 4 corners.

`VEHICLE_HEIGHT_BAND_M` (tallest *player-selectable* vehicle body) decides
whether a protrusion needs a primitive — window panes and department-store
awnings stay deliberately uncollided, their whole mass above it.
`tests/landmarkGroundSolids.test.ts` proves every bespoke recipe and checks
every landmark on every map is bespoke, a semantic exception (park/railway/
bridge), or hand-verified generic, so a future one cannot skip the review.

## Determinism contract

60 Hz fixed step (`FIXED_STEP_SECONDS`), traffic *decisions* at 10 Hz. `step()`
clamps delta to 0.25 s and drops the excess — under stall the sim runs slow
rather than exploding. `step(0, action)` is the sanctioned way to inject a
one-shot edge-triggered input.

One xorshift32 PRNG (`SeededRandom`, in `trafficSystem.ts`) seeded from
`scenario.trafficSeed`, consumed in exactly two places: initial NPC spawn,
and the 10 Hz decision pass. **Everything else is deterministically
tie-broken, not randomized** — gates sort by `localeCompare`; crossing
priority and successor-lane choice parse digits out of the NPC id string. So
**NPC ids are load-bearing data**: renaming the `npc-${n}` scheme changes
traffic behaviour.

There is no float discipline — plain doubles. Determinism holds only because the
same operations happen in the same order. `tests/trafficSafetyAcceptance.test.ts`
replays 8 minutes twice and compares a trace hash; anything that perturbs NPC
iteration order, id naming, or lane ordering fails it. **Geometry edits that look
purely visual can move the hash**, because supplemental oncoming gates are
derived from road-surface lane membership.

## Rule events never end a drive

There are 20 `RuleCode`s (`app/game/types.ts`). Road monitors enqueue
non-terminating events; the app decides whether an event affects a rider rating,
damage or a witnessed fine. The core has no score, completion state, authored
route or reset-enforcement mode.

Static and NPC collisions still resolve physically: bodies separate, speed is
scrubbed and an NPC can be knocked askew. Pedestrian, cyclist and prop contact
enters through `reportExternalContact`, which also scrubs speed before emitting
the collision. None of those paths teleports the player.

`BabylonGameSession` drains the queue every fixed update with `drainEvents()`;
events are deliberately absent from `SimulationSnapshot`.

## A roundabout give-way is a filtered yield line

A `yield` stop line holds for **any** vehicle inside its conflict radius, from
any direction. That is right for a plain give-way and wrong for a roundabout:
entering and circulating traffic block each other, and the enterer — an
ordinary road lane, so unlike a ring lane *not* exempt from the jam recycler —
visibly teleports away instead of giving way.

So a yield line whose own lane leads straight onto a `role: "roundabout"` lane
carries `roundaboutYieldFrom`, and both readers (`TrafficSystem.yieldGapForLane`
for NPCs, `RoadRuleMonitor.checkStopLines` for the player) then hold only for
traffic that is **on a roundabout-kind lane** and **on the named side** of the
bar. The side comes from `CountryProfile.roundaboutPolicy.yieldToTrafficFrom`,
which until then was authored for all four countries and read by nothing;
`buildStopAndYieldLines` derives the flag from the lane graph, so an entry
cannot be authored with its give-way mislabelled.

The player's lapse emits `roundabout_yield`, not `unsafe_gap`, and it
**coaches rather than fines** — it is not in the fineable set. Queueing behind
a car that happens to be across the line is not failing to give way: both
readers filter out vehicles on the player's own lane.

## Policing: who can fine you, and for what

The chain runs core → `BabylonGameSession.processSimulationEvents` →
`SideSwapApp`.

**A fine needs a witness or a camera, and one violation is answered once.**
`processSimulationEvents` emits a `fine` runtime event for `wrong_way`,
`out_of_bounds`, `red_light`, `speeding`, **and** `collision` without an
`evidence.roadUserType` — but only if `patrolNearPlayer(35)` finds a patrol,
**`else if`** `trafficCameraWitnesses(event)`.

That `else` is the structural half of never double-charging. The other half is
scope: a camera takes only `red_light` (matched exactly by
`evidence.trafficLightId`, never by distance) and `speeding` (within 30 m), so it
can never see the `collision` event a pedestrian fine rides on.

- **Hitting a person** is cited by `handleGameEvent` unconditionally on its own
  4 s debounce, and lands instantly because by construction no patrol is on scene.
- **`chargeFine` is the only place money moves for a violation**, and
  `lastAnyFineAtRef` (`FINE_MIN_SPACING_MS`, 3 s) is checked by all three paths.
  The per-mechanism clocks (8 s witnessed, `SPEEDING_STOP_GRACE_MS` 45 s
  speeding, 4 s pedestrian) cannot see each other, so one swerve that leaves the
  road *and* hits someone used to pay twice. Keep that window short: it collapses
  one incident, it is not a rate limit.

### Speeding is the one fineable rule with two thresholds and a price

The monitor's tolerance is `max(1.3, limit * 0.08)`, about
3 mph on a 30 — far too tight to take money at; a patrol inside 35 m would stop
you for drifting. `speedingWarrantsCitation` (`speeding.ts`) draws the wider band
a ticket costs (`CITATION_TOLERANCE_MPS` 2.2, or 15% of the limit, whichever is
larger), and `economyTables.ts`'s `speedingFine` scales the flat fine 1x→2x
over the excess (full scale at 20 mph / 32 km/h over).

The amount is settled **where the stop is staged**, not at `cite` — that is where
the evidence is.

### A witnessed fine is a pull-over, and the money moves on `cite`

A patrol's `fine` does not debit: it stages the `"pullover"` cutscene, and the
debit + toast land on that scene's `cite` step (the `pump` pattern). A camera's
(`issuedBy: "camera"`) has no officer to stage and debits inline instead.

So a stop that never staged is a violation that never cost anything — which is
why `buildPulloverScript` is the one builder that can never fail (`pulloverPose`
falls back to a heading-relative park when no road resolves).

It is also the only scene that **moves cars**: `CutsceneStep.carMoves` poses are
replayed onto `SimulationCore.setPlayerPose` *and* onto a scene-owned patrol rig,
because leaving the core's player behind would have NPCs avoiding a ghost in the
lane the visible car had left. Speed is pinned to 0 through the glide — every
collision reporter is gated on the player moving, and that is what keeps a
scripted swerve from mowing down a crowd.

**So the citation quotes a speed the car is provably no longer doing, and that is
correct.** `monitorRoadRules` freezes `evidence.speedMps` when it clocks you; the
glide above then parks the car, and only after it, the door and the officer's walk
does the `cite` step render "doing 56 in a 30". A driver reads that while
stationary, which looks like the game mismeasuring — it was reported as exactly
that (#257). Repointing the toast at the live speed would make every ticket read
"doing 0 in a 30". The evidence is a radar snapshot, not a readout.

### `processSimulationEvents` drops everything while any cutscene runs

The choreography owns the car, so rule trips in that window are artifacts, not
driving. Without it the pull-over's own kerbside park reads as `out_of_bounds`
and summons a second pull-over. Side effect worth knowing: an NPC that rear-ends
you mid-scene does no damage either.

## Ambient traffic and its cost model

**Count comes from `resolveAmbientVehicleCount`** (`simulationAdapter.ts`) — one
source for both sim and renderer, which allocate separately and must agree. A map
sets `ambientTraffic` when its size makes the scenario's density band wrong; NYC
and Cairo do (32 desktop / 16 touch, against the core's clamp of 32).

**Patrols are not authored.** `isPatrolVehicle` (`vehicleVisuals.ts`) marks one
`variant: "car"` in five (`PATROL_IN_EVERY`), hashed off the vehicle's own
identity rather than its render slot — so the car count *is* the police count,
and a car stays a patrol for as long as it exists.

Cars being cheap depends on `routeDistanceAhead` being bounded by **distance** as
well as hops (`ROUTE_LOOKAHEAD_LIMIT_M`, 240 m): it runs for every pair of cars
every step, six hops out of a three-exit junction is hundreds of lanes, and it
was 97% of the step before the limit existed. Raising it re-opens the cost; below
~62 m it changes following behaviour.
