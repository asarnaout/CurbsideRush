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
- **`simulation/railSchedule.ts`** — pure rail timetables: closed-form
  shuttle/through motion tables, per-crossing warning windows folded into
  one period, and `railTrainStatesAt` for whoever draws the train. A
  crossing head whose `TrafficLightDefinition` carries `rail` ignores its
  cycle: `trafficLightTiming` answers red/green from the windows instead, so
  NPC holds, the player citation, the lamps/barriers AND the rendered train
  all derive from one function of `elapsedSeconds` and cannot disagree. A
  railway head no line claims keeps the legacy free-run cycle (tests author
  those). The train itself is renderer-owned (`render/trainRender.ts`
  computes poses from this same module) and reports player contact through
  `reportExternalContact` — there is no train entity in the core.

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

`tests/architecture.test.ts` enforces the import and purity rules on every
file here, not just `simulation.ts`. The one clause worth knowing before you
reach for it: a type-only back-import from `../simulation` is allowed, for
shared vocabulary like `SimulationPoint`/`TurnSignal`/`MutablePose`.

### Road projection is cached geometry with legacy-exact selection

`RoadNetwork` derives segment deltas, squared lengths, headings, cumulative
end distances and elevation slopes once while normalizing a lane. Hot queries
must consume those arrays rather than rebuilding the same geometry. A
`pointOnLane` lookup uses a left-biased binary search over cumulative endpoints;
the bias is deliberate because an exact authored vertex retains the legacy
incoming-segment heading.

Height-aware `projectToRoad` searches only topology/elevation-compatible lanes
first. Ground projection always locks to that set, and an occupied raised ramp
locks when its graph-adjacent continuation is inside the existing capture
radius. Player callers enable bidirectional profile capture, which admits an
immediate predecessor and compares that connected ramp as an undirected axis.
At a same-height raised endpoint, the player query also admits physically
  coincident branches without adding them to `successorLaneIds`; the driver's
  trajectory selects between those visible surfaces across a short
  full-pavement-width endpoint strip before projection commits to the chosen
  grade. A connected sibling is reconsidered later only if the car's centre
  has physically left the preferred lane's paved half-width. The default query
  and every NPC successor route remain
directed. Only a detached raised pose runs the old global fallback. The default
lane choice, heading tie-breaks, hysteresis and returned floats remain
unchanged outside this player-only junction rule. The frozen legacy oracle
covers 49,592 lane-point samples and 42,597 Cairo projections, including all
814 directed seams; keep that exact equality when changing the scan.

One 10 Hz traffic-locality decision also owns one fresh player projection and
threads it through every recount, activation and preflight branch. The player
cannot move during that synchronous decision, so re-projecting inside a recount
only repeats work. Do not cache it across decisions or substitute the preceding
fixed tick's `ctx.roadState.projection`.

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
(`buildingReservations`). `tests/buildingColliderAgreement.test.ts` is the exact
plan-to-collider parity proof — every planned solid has exactly one obstacle
and vice versa, at float epsilon, across all four maps. Per-solid obstacles
pushed the raw linear scan from hundreds to thousands per map;
`tests/perf/staticCollision.bench.ts` measured rather than assumed — p95
`resolveStaticCollisions` stays under 14 µs at the densest 32 m cell, ~75x
inside the 1 ms gate, so there is still no spatial index. Measure first.

### Bespoke landmarks need their own ground solid, not the generic box/circle

`mapPack.geometry.landmarks` sits outside the building plan — a city renderer
either draws a landmark's generic `kind` verbatim (box for station/shops/
museum/cultural, circle for tower/monument) or replaces it with a bespoke
shape. `buildStaticObstacles`'s landmark loop asks `geometry/landmarkGroundSolids.ts`
first: a defined result (compound `aabb`/`obb`/circle/**convex** `GroundSolid`s,
`tag: "landmark"`) is authoritative; `undefined` means the bespoke renderer was
checked and found to draw exactly the generic shape at vehicle height. The
clockwise-wound `convex` kind exists only for this, with an explicit branch in
every `kind`/`shape` switch. `VEHICLE_HEIGHT_BAND_M` (tallest
*player-selectable* vehicle body) decides whether a protrusion needs a
primitive — window panes and awnings stay deliberately uncollided, their
whole mass above it. `tests/landmarkGroundSolids.test.ts` proves every recipe
and checks every landmark on every map is bespoke, a semantic exception, or
hand-verified generic, so a future one cannot skip the review.

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

There are 19 `RuleCode`s (`app/game/types.ts`). Road monitors enqueue
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
`out_of_bounds`, `red_light`, `speeding`, `railway_crossing` **only when
`evidence.warningActive` is true** (the same monitor also fires for skipping
Japan's courtesy stop at a dormant crossing, which must stay coaching), **and**
`collision` without an `evidence.roadUserType` — but only if
`patrolNearPlayer(35)` finds a patrol, **`else if`**
`trafficCameraWitnesses(event)`. A live crossing pays `railwayCrossingFine`
(5x flat — the deliberate exception to "deliberately modest"; its
`RULE_COOLDOWNS` entry is 15 s so the paired opposite-direction stop line
cannot ticket the same incursion twice).

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

### A forecourt is off-lane, not off-side

Every rule `RoadRuleMonitor` enforces is measured against the *nearest* lane, and
a forecourt sits 16-23 m off one — so standing at a pump read as `out_of_bounds`
every 2 s and became a fine whenever a patrol passed (issue #86), with
`wrong_way` and `red_light` both reachable from ground the car had never left.

The adapter now emits a `ServiceArea` per service point (`resolveServiceLotArea`:
the authored lot, flared by `SERVICE_AREA_TURN_IN_MARGIN_M`, reaching back to the
anchor lane's centreline so the pavement crossing is inside it). `updateRoadState`
sets `roadState.inServiceArea`, and the monitor then treats the car as on **no
lane at all** — `monitorRoadRules`, `checkBoxJunctions` and `checkStopLines`
return early, accumulators decaying rather than freezing. Two halves keep that
honest, and neither is optional:

- **`inServiceArea` is conjoined with `offRoad`.** Reaching the centreline is what
  makes the amnesty exactly contiguous with the road — no band where a driver is
  off the lane but still judged by it — and requiring the car to be off the
  carriageway first is what stops a station beside a junction from becoming a
  licence to run that junction's red light.
- **Collisions are staged outside this class and are untouched.** A lot excuses
  your *position*, never what you hit.

`tests/serviceLotRuleAmnesty.test.ts` pins both directions at every service point.

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

**Count comes from `resolveAmbientVehicleCount`** (`simulationAdapter.ts`),
backed by `normalizeAmbientVehicleSlotCount` and
`AMBIENT_VEHICLE_SLOT_CEILING` (`simulation/ambientTraffic.ts`). The adapter
normalizes every map override or density fallback, and `SimulationCore` repeats
that same defensive normalization before it creates its NPC pool; renderer and
core therefore cannot own different slot counts. All four shipped maps override
their bands with 32 desktop / 16 touch slots.

**Patrols are not authored.** `isPatrolVehicle` (`vehicleVisuals.ts`) marks one
`variant: "car"` in five (`PATROL_IN_EVERY`), hashed off the vehicle's own
identity rather than its render slot — so the car count *is* the police count,
and a car stays a patrol for as long as it exists.

### Local population window

`buildTrafficLocalityConfig` gives the core a separate, deterministic runtime
portal catalogue. Authored `SimulationTrafficGate`s remain the source of named
vehicle identity/variant placements: fresh-core priming preserves explicit
variant coordinates, and admits a generic authored coordinate only while it
fits the current local target; other slots use nearby runtime portals. Runtime
portals are sampled every 140 m from eligible
directed lanes, with a 25 m endpoint/stop-line/connector exclusion, and live in
`RuntimeTrafficPortalIndex`'s static spatial cells.

The controller targets traffic from *eligible directional lane length*, not map
area: desktop targets 8–18 vehicles in 440 m and 4–10 in 250 m (touch: 5–12 and
2–6). Fresh reset may prime the local bands; later activation is only in the
500–650 m approach annulus. Approach selection requires an inbound tangent and
the NPC's deterministic successor path into the fog circle; an inner-target
replacement proves a route into 250 m using its own bounded 750 m/12-hop
selector horizon. The
controller also treats inbound cars in the final 480–500 m hand-off as already
in flight so it cannot issue a duplicate arrival batch just before they enter
the fog band. Ordinary population shedding first becomes
`pendingRecycle` and retires only beyond 750 m; exceptional jam, route, and
collision recovery may release beyond the conservative 480 m hidden
envelope. Both paths use bounded 10 Hz batches. All traffic remains normal
authoritative `TrafficSystem` NPCs — locality never creates a decorative vehicle
class. `SimulationCore.getTrafficDiagnostics()` exposes the current bands,
targets, lifecycle work, route-search and spatial-index counters for external
profiling without feeding any of them back into simulation decisions.

`TrafficSpatialIndex` keeps lane buckets keyed by stable NPC slots. For
`leadVehicleGap`, it marks the source lane plus conservative successor-lane
candidates within the same six-hop/240 m topology envelope, then still runs the
unchanged exact `routeDistanceAhead` check in stable NPC order. That preserves
loop and route semantics while avoiding an exact route search for every active
car pair. Raising `ROUTE_LOOKAHEAD_LIMIT_M` re-opens cost; lowering it below
roughly 62 m changes following behaviour.
