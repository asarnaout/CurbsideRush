# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping this file true

**This file is loaded into context every session, so a wrong line in it misleads every future run.** Treat it as part of the work, not documentation about the work. Before you finish any task:

1. **Re-read whatever sections your change touched, and fix what it made false.** A subsystem you reworked, a behaviour you inverted, a helper you renamed or deleted — if this file describes it, it is now stale. This is not optional cleanup; a confidently wrong invariant here costs more than no invariant at all.
2. **Only add genuinely load-bearing facts.** Invariants that fail silently, conventions that bite, decisions whose rationale is not recoverable from the code. Not API summaries, not change logs, not anything `git log` or the code already says plainly. The bar for adding is high.
3. **Never exceed 200 lines.** A hard cap, not a target. If something new deserves a place and the file is full, find what has stopped earning its place and cut it. Brevity is the whole reason this gets read.
4. **Never cite line numbers — name the symbol.** Write `collectRoadJunctionFills`, not `GameCanvas.tsx:800`. Any edit above a line silently invalidates a line number, and a stale pointer sends the next reader to the wrong code; symbol names survive and are greppable.

The same duty points outward. **Update code comments your change invalidates** — a comment describing behaviour the code no longer has is worse than no comment, and this repo leans heavily on long explanatory headers. **Update `README.md`** whenever player-facing scope moves: modes, cities, controls, saves, the asset caveats.

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run typecheck    # tsc --noEmit, ~2s
npm run lint         # eslint, ~4s
npm test             # vitest run: 53 files, 712 tests, ~145s
```

Node >= 22.13 (repo currently runs v26).

### Testing

`npm test` takes ~145s and **97% of that is one file** — `tests/trafficSafetyAcceptance.test.ts` (141s: 5 cities x every start/checkpoint x 51 seeds x 60s of sim). Use the fast loop while iterating, full suite before committing:

```bash
# everything except the acceptance test -> 52 files / 710 tests in ~7s
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"

npx vitest run tests/simulation.test.ts                     # one file
npx vitest run tests/simulation.test.ts -t "reverses off"   # one test (substring)
npm test -- tests/minimap.test.ts -t "flips north"          # note the `--`
npx vitest tests/gigs.test.ts                               # watch
```

The `--exclude "**/node_modules/**"` is required because passing `--exclude` overrides vitest's defaults. The acceptance test's `2_700_000`ms timeout is a label only — the body is synchronous, so it can never truncate coverage.

**There is no CI.** No `.github/`. Nothing runs test/lint/typecheck unless you do.

Lint is currently **clean — 0 errors, 0 warnings**. Keep it that way: unused vars are warnings, not errors, so dead code accumulates silently rather than failing anything. `build/` is a *source* directory but is in ESLint's ignore list (inherited from the Next preset, where `build/` means output), so `build/sites-vite-plugin.ts` is never linted.

## `lesson` does not mean a lesson

The game pivoted from a driving curriculum to an open-world gig driver: the lessons were deleted and the save key is `sideswap:v2` (`PROGRESS_STORAGE_KEY`). The README covers the current game and is the player-facing picture; this file is the internals.

**`lesson` survives as internal vocabulary.** `GameCanvasLesson` is the *runtime scenario contract*, and the only scenario type left is free drive: `buildFreeDriveLesson` / `buildCareerDayLesson` (`app/game/freeDriveLesson.ts`) both produce `kind: "free_drive"` with empty `route`/`checkpoints`/`coachPrompts`, and `SideSwapApp` builds `runtimeLesson` from one of them every render. Vestigial dead branches remain for retired content: `roadIdForLane` still maps `yard-*`/`xf-*` ids, `RoadSurfaceType` still has `"orientation"`, `GameCanvas` defaults `mapId` to `"orientation-yard"`. No such map exists.

## Architecture

Four rings; dependency arrows only point inward.

```
SideSwapApp.tsx     views, economy, gigs, fuel, music, localStorage
   | props                    ^ GameHudSnapshot (10 Hz) + GameRuntimeEvent
GameCanvas.tsx      Babylon scene, input, cameras, audio, own fixed-step pump
   | SimulationInput          ^ SimulationSnapshot (plain data)
simulation.ts       SimulationCore — physics, traffic, rules, scoring
   ^ SimulationCoreConfig
simulationAdapter   authored MapPack + lesson -> core config (build-time only)
```

`simulation.ts` imports **only** `./types` — no React, DOM, Babylon, `Math.random`, or `Date.now`. That purity is the load-bearing property of the design and is guarded by tests.

**The core knows nothing about gigs, money, or fuel.** Gigs are a pure proximity state machine (`gigs.ts`, no imports at all), but its state no longer flips on drive-by: the app detects arrival (stopped inside 14 m) and stages an **interaction cutscene** (`cutsceneScript.ts` builds the pure choreography; the session executes it — actor, staged third-person shot, all driving input zeroed at `mergedInput`), and the gig advances when the scene's `done` event lands. Refuel works the same way — the debit+fill happen at the scene's `pump` event, not the button press. Fuel is enforced at the input boundary by zeroing throttle before it reaches the core. The police-fine loop lives in `GameCanvas` + `SideSwapApp`. The economy is strictly an outer ring, and **no score, event history or infraction is ever persisted** — the wallet debit is the only durable consequence.

`buildSimulationCoreConfig` runs **once**, in the `BabylonGameSession` constructor — never in the frame loop. It translates lanes, infers single-lane adjacency, synthesizes signal phases and supplemental oncoming traffic gates, and **throws** on invalid authored data (missing lane, illegal successor transition, out-of-range anchor). A bad map pack crashes the drive rather than degrading.

### Content: two parallel truths

There is **no procedural city generator and no runtime map import**. A map pack is a hand-authored TypeScript literal in `content.ts` / `londonContent.ts`, and it carries two structures that must be kept in sync:

- **`laneGraph.lanes`** — directed legal truth. What the simulation, guidance, NPCs and scoring use.
- **`geometry.roadSurfaces`** — visual truth. Centrelines + markings.

Linked only by `LaneSegment.roadId <-> RoadSurface.id`/`laneIds`. Two-way streets are two lanes mirrored ±1.7m off the surface centreline. **Everything else in the world is derived at load time** from those two:

| Derived | From | Where |
|---|---|---|
| asphalt strips, kerb/junction fills | `roadSurfaces` | `buildRoadSurfaceStripGeometry`, `collectRoadJunctionFills` |
| paint broken at junctions | `roadSurfaces` | `splitMarkingAtCrossings` |
| walkable pavement rails | `roadSurfaces` | `buildPavementGraph` |
| ambient traffic routes | `lanes.successors` | `buildConnectedNpcPath` |
| gig drop-off addresses | `lanes` + `blocks` | `generateStreetAddresses` |
| instanced building street wall | `blocks.buildingSet` | `slotBlockBuildings` |
| signal phase clock | `controls.phaseGroup` | `authoredSignalAspectAt` |

`getMapPack(id)` is a pure frozen lookup that throws on unknown ids.

The JSON in `public/map-data/` is **provenance only** — nothing reads it at runtime. `scripts/fetch-osm.mjs` is a manually-run, one-off freezer, not part of any build. `tests/map-data.test.ts` recomputes a sha256 over `JSON.stringify({roads, buildings})`, so reformatting or reordering keys breaks the checksum even when geometry is identical. Regenerate; never hand-edit.

### Determinism contract

60 Hz fixed step (`FIXED_STEP_SECONDS`), traffic *decisions* at 10 Hz. `step()` clamps delta to 0.25s and drops the excess — under stall the sim runs slow rather than exploding. `step(0, action)` is the sanctioned way to inject a one-shot edge-triggered input.

One xorshift32 PRNG seeded from `lesson.trafficSeed`, consumed in exactly two places (initial NPC spawn, the 10 Hz decision pass). **Everything else is deterministically tie-broken, not randomized** — gates sort by `localeCompare`, crossing priority and successor-lane choice parse digits out of the NPC id string. So **NPC ids are load-bearing data**: renaming the `npc-${n}` scheme changes traffic behaviour.

There is no float discipline — plain doubles. Determinism holds only because the same operations happen in the same order. `tests/trafficSafetyAcceptance.test.ts` replays 8 minutes twice and compares a trace hash; anything that perturbs NPC iteration order, id naming, or lane ordering fails it. Note that geometry edits which *look* purely visual can move the hash, because supplemental oncoming gates are derived from road-surface lane membership.

### Career Mode

A second mode beside free drive: a **ladder of cities** (`CAREER_CITIES`, the single knob that defines the route — start city, unlock order and ticket destinations all derive from it), prepaid vehicle rental, a ~6-minute sim-clock day, 25% commission + a flat platform fee, shortfall→3-day loan at +15%, one FINAL NOTICE. It lives **entirely in the outer ring** — the sim core still knows nothing about money.

- **`app/game/career.ts` is the pure brain** (gigs.ts-style): vehicle catalog (physics/fuel/fares/allowed gig kinds), `settleDay` (order: recap → platform fee → ceil-per-remaining-day installment → shortfall→loan → bankruptcy gate; the notice clears only on a fully clean settlement), seeds, checksum codec. Tune numbers there, nowhere else; `tests/careerBalance.test.ts` trips if rent+fee exceeds 4 median gig nets anywhere, or if a ticket stops being reachable in 3–20 days of driving.
- **Everything is per city, keyed by destination** (`CareerSliceV2.cities`): cash, debt, day counter, fleet and stats. Presence in that map **is** the unlock — no second list. `activeCity(slice)` returns the current one plus `destinationId`/`countryId` under the names the app already used, which is why the views stay props-pure; `withCity` is the only way to edit one. Currency needs no special handling as a result: every price goes through `formatMoney(amount, country)` with `country` derived from the active city, so Tokyo reads in yen throughout.
- **The slice persists inside `PlayerProgressV2.career`** (`writeCareer`/`clearCareer` are the ONLY sanctioned write paths — `saveProgress` re-verifies the FNV-1a checksum via `migrateProgress`, so any other mutation path comes back `{state:"corrupt"}` on the next load; that corrupt marker is itself persisted state). A blob with no `version` decodes to **null**, not corrupt — obsolete is not tampered with. Career money is day-local (`dayCash`/`dayLog` refs in `SideSwapApp`), integer-only, and **never touches** `walletByCountry`/`fuelByCountry`/`lifetimeEarnings`. Saves happen at day boundaries only — a mid-day quit redoes the day (per-day seeds from `careerDayTrafficSeed`, which folds in the city index so day 3 in Tokyo is not day 3 in New York).
- **Travel is one-way by ticket, free thereafter.** `applyTicket` debits the departure city and opens the next on a fresh sheet; `travelTo` moves between cities already reached at no cost. Nothing crosses — money and vehicles stay where they were earned. **Bankruptcy is local**: it resets that city (starting float, day 1, debts cleared, **fleet repossessed**) and leaves the rest of the career standing. The repossession is load-bearing — without it, going bust would be a strictly better exit from a bad loan than driving out of it. There is no terminal failure state.
- **Winning is `careerWon`**: stand in the last ladder city having bought every `buyoutEligible` vehicle in *every* city. `withVictoryIfEarned` stamps it on the two moves that can complete it (a purchase, a flight) and it is sticky. Buying is gated on **cash alone** — debt and the final notice do not block it, and there is no cap on how many you own.
- **A day = a GameCanvas remount**: `buildCareerDayLesson` gives each day its own lesson id + traffic seed, and the React key carries `-d${day}-${vehicleId}`. The day clock rides `GameHudSnapshot.simElapsedMs` (sim time — pauses with the sim; the app folds it across tow resets). Whistle mid-cutscene defers settlement until the scene's `done` lands — which is also why career gig payouts are **synchronous in the cutscene handler**, not the free-drive payout effect.
- **Per-vehicle physics are `SimulationCoreConfig` fields whose defaults equal the old literals exactly** — the acceptance replay pins that identity, so never change a default without meaning to change free drive. NPC-to-NPC spacings are deliberately pinned literals (they must not re-space around the player's vehicle). Note every career vehicle is *slower* than free drive, sports car included: the `BabylonGameSession` constructor spreads `vehiclePhysics` **after** the adapter's config, and the adapter sets 31.29 m/s (70 mph) while the reference sedan takes the core's own default of 22.
- **The five-vehicle catalog splits three ways visually** (`CAREER_VEHICLES`): three car models, plus the bicycle and motorbike as composed rigs (`model: null`). Both two-wheelers force third-person — there is no cockpit to sit in — take `buildBikeErrandScript` with their own `CutsceneBodyProfile` (`BIKE_`/`MOTORBIKE_CUTSCENE_BODY`) instead of car doors, and hide the rider on the vehicle for the scene (see `cutsceneBody` and `startCutscene`). Cars take a profile scaled from `VEHICLE_DIMENSIONS`; the flagship reproduces the defaults exactly.

### Conventions that bite

**Three angle conventions coexist.**

| Thing | Convention |
|---|---|
| World | `x` east, `z` north, `y` up, metres, origin = map centre |
| Lane/pose heading | `atan2(dx, dz)` — **0 = +z (north)**, +pi/2 = +x |
| `arcPoints` angles | **0 = +x (east)**, 90 = +z — standard math, *not* the heading convention |
| Right-hand normal | `(cos h, -sin h)` — the **driver's right** |

**The setback normal is always the driver's right regardless of traffic side.** On left-hand-traffic maps that lands on the far side of the road — which is why MK/London gas stations are anchored on far-side lanes and Tokyo's needs `setbackM: 17.3`.

**The glTF loader bakes a 180° Y flip**, so model fronts are on local −Z. This propagates into four separate offset conventions: props `yawOffset = pi/2`, characters `pi`, buildings per-model `frontOffset`, vehicles per-model (the van's `-pi/2` is what plate placement derives its axes from). A Babylon box's +Z face also renders textures 180°-rotated, so both plates present their −Z face.

**The y-layer stack is a hard global ordering**, every value a bare constant tuned to kill z-fighting:

```
0.0435 shoulder junction fill  <  0.045 shoulder/sidewalk  <  0.07 road surface
<  0.0716 asphalt junction fill  <  0.08 walkers  <  0.1 crowd shadows
<  0.12 markings & vehicle nodes  <  0.144-0.147 chevrons/stop lines
```

Vehicle ground contact is a two-value handshake: nodes at `y = 0.12` and `LOCAL_GROUND_Y = -0.05` put tyres at exactly `0.07`. Change either alone and the whole fleet floats or sinks.

### Rendering layer

`GameCanvas.tsx` is ~11.3k lines but only two live objects: `class BabylonGameSession` and the React component at the bottom. **React owns the canvas element, the props, and one 10 Hz HUD snapshot; the session owns everything else.** No React state is driven at frame rate. The session is rebuilt only on `[trafficSide, steeringSide, lesson?.id, mapPack?.id, sessionActivation]`; every other prop flows through `session.updateOptions(...)`.

Everything above `GameCanvasProps` is an **exported pure geometry layer** (road strips, junction fills, chevron placement) — exported specifically so tests can import them without instantiating Babylon.

Models are a two-phase construction: everything starts as an empty placeholder, then an async preload upgrades vehicles/characters/props, builds instanced buildings and the VAT crowd, and only then calls `markReady()` — which is what lifts the React loading gate. There is no procedural vehicle/character fallback any more, so **anything that lifts `markReady` early ships invisible cars and people**.

The ambient crowd is the whole city's pedestrians rendered as **3-5 meshes total**: a hand-baked vertex animation texture (the stock Babylon baker doesn't work on glTF animation groups) plus thin instances, with per-person colour as thin-instance colour channels. The thin matrix must be the conjugate `W0 · Pose · W0⁻¹` (`crowdRenderMath.ts`) — that's what keeps walkers in world space and winding correct despite the loader's handedness mirror.

`resolveMapVisualKey(mapId)` is **substring matching with an `nyc` default** — a typo'd or new map id silently gets NYC's night+paved palette, which changes lighting, fog, ground texture, sidewalk width *and* the crowd's rail geometry.

### Audio

`audioMath.ts` (577 lines) has zero Web Audio imports — it is the entire car model (invented 5-speed gearbox, rpm curves, wind/road/squeal) and mutates caller-owned objects, allocating nothing. Voices only schedule those numbers. `DriveAudio.create()` returns `null` when Web Audio is unavailable, hence `this.audio?.…` everywhere.

The AudioContext is a **module-level singleton**, deliberately not per-session, because `GameCanvas` remounts on destination/steering change. `primeAudioContext()` + `music.start()` must run **synchronously inside the click handler** — Safari only honours resume/play in the same task as the gesture. Moving either into an effect silently kills sound. Two such pairings exist and both are load-bearing: `beginDrive` and `beginCareerDay`.

`tests/driveAudioScheduling.test.ts` injects a fake context whose `FakeParam` records a failure on any direct `.value` write after setup. The discipline it enforces — always schedule, never assign — is the difference between clean audio and clicks.

## Sharp edges

- **Unreachable code does not warn.** `tsconfig` has no `noUnusedLocals` and ESLint treats unused vars as warnings, so a `private` method that loses its last caller just sits there. The `evaluateLesson` and `computeNpcRenderSnapshots` subtrees, superseded by `SimulationCore`, sat unreferenced until they were deleted; when you supersede a subsystem, delete its old path in the same change. Two traps that made that cleanup non-obvious and will recur: **duplicate names across layers** — `buildConnectedNpcPath` is both a `BabylonGameSession` private wrapper and a live module-level function in `npcPaths.ts`, and the deleted `angleDifference` had exactly that shape against the live one in `simulation.ts`, so never delete or rename by name alone — and **write-only struct fields**, which nothing flags at all: `NpcVehicle` carried ten (`pathSegments`, `spawnPathSegment`, …) that were assigned at spawn and read only by the dead subtree.
- **Inline `penalty:` fallbacks at `emitEvent` call sites never fire — for any rule.** `penaltyFor` is `scoring.penalties[code] ?? fallback`, and `penalties` is typed `Partial`, so the mechanism is real; but both scoring configs that can reach it cover all 21 `RuleCode`s with identical values (`SCORING_CONFIG` in `content.ts`, and `DEFAULT_SCORING` in `simulation.ts` when a caller omits `scoring`). So editing `penalty: 6` at a call site changes nothing — edit `SCORING_CONFIG`. Keep the fallbacks in mind when **adding** a `RuleCode`: miss it in both maps and the inline number silently becomes live.
- **`snapshot.recentEvents` is always empty in production** — `GameCanvas` calls `drainEvents()` every fixed update. Use `drainEvents()` or `latestEvent`.
- **Under `"coach"` enforcement nothing hard-resets the player — including collisions.** `buildSimulationCoreConfig` picks `"coach"` iff `lesson.kind === "free_drive"`, which is every free drive *and* every career day. `flagCritical` softens all four codes it is ever called with — `collision` against static geometry (`resolveStaticCollisions`), `wrong_way` and `out_of_bounds` (`monitorRoadRules`), `red_light` (`checkStopLines`) — into non-terminating `minor` events; NPC-vehicle collisions are softened inline in `checkCollisions` (separate the bodies, scrub speed, knock the NPC askew, `continue`); pedestrian/cyclist/prop contact is softened in `reportExternalContact`. The one unconditional `triggerCritical` entry point left is `reportExternalCollision`, reachable only through the session's `reset(incidentMessage)` — and no caller passes that argument, so it is dead in practice. Wiring it up would silently resurrect checkpoint-teleporting in the open world.
- **A fine needs a witness, and covers collisions.** `processSimulationEvents` emits `fine` only when `patrolNearPlayer(35)` finds a patrol, for `wrong_way`, `out_of_bounds`, `red_light`, **and** `collision` without an `evidence.roadUserType`. Hitting a person is the exception: `handleGameEvent` cites that unconditionally on its own 4s debounce, separate from the 8s debounce on witnessed fines.
- **The free-drive `GameCanvasLesson` contract has one factory** — `buildFreeDriveLesson` in `app/game/freeDriveLesson.ts`, pinned by `tests/freeDriveLesson.test.ts`. SideSwapApp and the simulation-facing tests all call it; don't hand-roll the literal again.
- **Any new mutable field on `SimulationCore` must be reset in `reset()`**, and usually in `restoreCheckpointPose()` too. `reset()` is called from the constructor, so fields it touches must be initialized before that line.
- **`migrateProgress` runs on save as well as load** and rebuilds from known keys only — a new field on `PlayerProgressV2` is silently stripped on the next write unless added there too.
- **`content.ts` and `londonContent.ts` each carry private copies** of `point`, `node`, `laneTrue`, `arcPoints`, `turningLoop`, `connectorConflictZones`. Fixing one does not fix the other.
- **`0.08m` is the definition of "shared node"** for both junction fills and pavement rails. Authoring a shared endpoint 0.1m apart yields no junction fill (grass through the crossing) and no pavement trim (walkers on the asphalt), silently.
- **Successors must be geometrically continuous** — tests require 0.01m; `buildConnectedNpcPath` requires 2.5m. Break it and traffic despawns rather than errors. An *empty* successor list does the same thing, wherever the player happens to be looking: London's bus lane dead-ended at a signal and the double-decker blinked out every green (#128). Both are now guarded by "gives every lane somewhere legal to go" in `content.test.ts`.
- **`streetAddressesForMap` caches by `pack.id`** in a module-level Map; gig selection, the renderer and tests must all agree, so mutating a pack after first call has no effect. Street addresses only exist for the ~8 NYC roads in `STREET_PROFILES` — other maps fall back to authored venues.
- **`window.__sideswap*` debug hooks are rebuilt every frame** and deleted in `dispose()` — a new hook must be added to both the install block in `updateGuidanceVisuals` and the deletion list in `dispose()`, or it leaks the disposed session.
- **`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test needs the `installLocalStorage` polyfill from `launcher.test.tsx` (or inject `ProgressStorage` like `progress.test.ts` does), plus a **synchronous `requestAnimationFrame` stub** — otherwise `SideSwapApp`'s `hydrated` guard never lifts and every test sees only the loading screen. Tests default to `environment: "node"`; DOM needs `// @vitest-environment jsdom` on line 1 and a local `@testing-library/jest-dom/vitest` import (there is no setup file).
- **Six test files import `GameCanvas.tsx` for real in node** — `content`, `gameCanvasInput`, `guidanceCoverage`, `intersectionVisuals`, `pavementPaths`, `roadJunctions`. Adding a top-level side effect touching `window`/`document`/WebGL breaks tests unrelated to rendering. Five more name the module but use `import type` and never load it (`freeDriveLesson`, `npcTurnSmoothness`, `simulationAdapter`, `staticColliders`, `trafficSafetyAcceptance`), as do all three app-side importers — so the only other runtime load is `SideSwapApp`'s lazy `dynamic()`. Grep alone misleads here; check whether the import is type-only.
- **`public/models/vehicles/london-double-decker.glb` is gitignored** (purchased asset, licence forbids redistribution). Its test is `skipIf`-guarded, so a fresh clone silently skips it. Rebuild with `node tools/build-london-bus.mjs <path-to.obj>`.
- **The app shell is tested through Career and almost nowhere else.** `careerFlow.test.tsx` renders a real `SideSwapApp` (GameCanvas mocked) across 14 tests: rent prepay, fines landing in day-cash rather than the wallet, settlement/ledger lines, the quit-day discard, a tampered save, per-vehicle physics/model props, buyout, the roadside-refuel cutscene, and the day title waiting on the `ready` event. `launcher.test.tsx` adds 4 on the launcher itself. What no test touches: free-drive fuel drain, free-drive refuel pricing, the 8s fine debounce, the gig double-credit guard (`paidGigRef`), minimap pins, music mute. Changing any of those is invisible to `npm test` (the cutscene *choreography* is covered by `tests/cutsceneScript.test.ts`; the free-drive wiring is not).
- **`app/globals.css` is ~3445 lines and substantially dead** (removed lesson hub, passport, results views). The driving HUD is inline styles in `SideSwapApp.tsx`, not CSS.
- **`.app-shell` sets `overflow: hidden`, which silently disables `position: sticky` anywhere below it** — a scroll container, so a sticky child pins to *it* rather than the viewport and simply never moves. The career pages override it to `overflow: clip` (clips identically, no scrollport) inside the 860px block, which is what lets the garage dock and the travel flight bar pin at all. Nothing warns; the element just sits in flow.
- **No `wrangler.toml`.** Worker config is inline in `vite.config.ts` (`localBindingConfig`) at dev time and generated into `dist/server/wrangler.json` at build. The `@cloudflare/vite-plugin` import is deliberately dynamic — Wrangler snapshots its log path on import. The image-optimization branch in `worker/index.ts` and the D1/drizzle packaging in `build/sites-vite-plugin.ts` are inherited template code with no live consumer.
- **Two deploy shapes from one build.** `npm run build` emits a Cloudflare Worker; `npm run build:static` adds `tools/prerender-static.mjs`, which renders `/` *through that same Worker in-process* (it has no `cloudflare:` imports, and `env` is only touched on `/_vinext/image`) and writes `dist/client/index.html` for Netlify to publish as static files. **`vinext start` is not a substitute** — it serves unhashed dev URLs that 404 on a static host, so the page never hydrates; `assertUsableHtml` fails the build on exactly that. The prerender freezes the origin into `og:image`, so it refuses to run without a real `SITE_URL`/Netlify `URL` — a wrong one is invisible until a shared link renders with no card.
- The `@/*` tsconfig path alias exists and is **used zero times**. Every import is relative; follow that.
