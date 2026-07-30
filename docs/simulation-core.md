# The simulation core

`app/game/simulation.ts` — physics, traffic, road-rule enforcement and scoring.
Read this before touching the core, the adapter, or anything that changes NPC
behaviour, and before adding or repricing a `RuleCode`.

## Determinism contract

60 Hz fixed step (`FIXED_STEP_SECONDS`), traffic *decisions* at 10 Hz. `step()`
clamps delta to 0.25 s and drops the excess — under stall the sim runs slow
rather than exploding. `step(0, action)` is the sanctioned way to inject a
one-shot edge-triggered input.

One xorshift32 PRNG seeded from `lesson.trafficSeed`, consumed in exactly two
places: initial NPC spawn, and the 10 Hz decision pass. **Everything else is
deterministically tie-broken, not randomized** — gates sort by `localeCompare`;
crossing priority and successor-lane choice parse digits out of the NPC id
string. So **NPC ids are load-bearing data**: renaming the `npc-${n}` scheme
changes traffic behaviour.

There is no float discipline — plain doubles. Determinism holds only because the
same operations happen in the same order. `tests/trafficSafetyAcceptance.test.ts`
replays 8 minutes twice and compares a trace hash; anything that perturbs NPC
iteration order, id naming, or lane ordering fails it. **Geometry edits that look
purely visual can move the hash**, because supplemental oncoming gates are
derived from road-surface lane membership.

## Rules, severity and enforcement

There are 21 `RuleCode`s (`app/game/types.ts`) and three severities: `coach`,
`minor`, `critical`.

**Under `"coach"` enforcement nothing hard-resets the player — including
collisions.** `buildSimulationCoreConfig` picks `"coach"` iff
`lesson.kind === "free_drive"`, which is every free drive *and* every career day.

- `flagCritical` softens all four codes it is ever called with — `collision`
  against static geometry (`resolveStaticCollisions`), `wrong_way` and
  `out_of_bounds` (`monitorRoadRules`), `red_light` (`checkStopLines`) — into
  non-terminating `minor` events.
- NPC-vehicle collisions are softened inline in `checkCollisions`: separate the
  bodies, scrub speed, knock the NPC askew, `continue`.
- Pedestrian/cyclist/prop contact is softened in `reportExternalContact`.

The one unconditional `triggerCritical` entry point left is
`reportExternalCollision`, reachable only through the session's
`reset(incidentMessage)` — and **no caller passes that argument**, so it is dead
in practice. Wiring it up would silently resurrect checkpoint-teleporting in the
open world.

## Penalties

**Inline `penalty:` fallbacks at `emitEvent` call sites never fire — for any
rule.** `penaltyFor` is `scoring.penalties[code] ?? fallback`, and `penalties` is
typed `Partial`, so the mechanism is real; but both scoring configs that can
reach it cover all 21 codes with identical values — `SCORING_CONFIG` in
`content.ts`, and `DEFAULT_SCORING` in `simulation.ts` when a caller omits
`scoring`. Editing `penalty: 6` at a call site changes nothing; edit
`SCORING_CONFIG`.

Keep the fallbacks in mind when **adding** a `RuleCode`: miss it in both maps and
the inline number silently becomes live.

## Reading the event stream

**`snapshot.recentEvents` is always empty in production** — `GameCanvas` calls
`drainEvents()` every fixed update. Use `drainEvents()` or `latestEvent`.

## Policing: who can fine you, and for what

The chain runs core → `GameCanvas.processSimulationEvents` → `SideSwapApp`.

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

The monitor's tolerance is set to *coach* — `max(1.3, limit * 0.08)`, about
3 mph on a 30 — far too tight to take money at; a patrol inside 35 m would stop
you for drifting. `speedingWarrantsCitation` (`speeding.ts`) draws the wider band
a ticket costs (`CITATION_TOLERANCE_MPS` 2.2, or 15% of the limit, whichever is
larger), and `content.ts`'s `speedingFine` scales the flat fine 1x→2x over the
excess (full scale at 20 mph / 32 km/h over).

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

### `processSimulationEvents` drops everything while any cutscene runs

The choreography owns the car, so rule trips in that window are artifacts, not
driving. Without it the pull-over's own kerbside park reads as `out_of_bounds`
and summons a second pull-over. Side effect worth knowing: an NPC that rear-ends
you mid-scene does no damage either.

## Ambient traffic and its cost model

**Count comes from `resolveAmbientVehicleCount`** (`simulationAdapter.ts`) — one
source for both sim and renderer, which allocate separately and must agree. A map
sets `ambientTraffic` when its size makes the lesson's density band wrong; NYC
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
