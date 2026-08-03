# Commands and testing

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run build:static # + prerendered index.html for a static host
npm run typecheck    # tsc --noEmit, ~3s
npm run lint         # eslint, ~11s
npm test             # vitest run: 94 files, 1524 tests, ~2min
```

Node >= 22.13 (repo currently runs v26). **There is no CI** — no `.github/`,
nothing runs test/lint/typecheck unless you do.

## The fast loop

`npm test` takes about two minutes and **almost all of it is one file** —
`tests/trafficSafetyAcceptance.test.ts` (4 cities × every start/checkpoint × 51
seeds × 60 s of sim). Everything else runs in ~20 s. Use the fast loop while
iterating, the full suite before committing:

```bash
# everything except the acceptance test -> 93 files / 1522 tests in ~20s
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"

npx vitest run tests/simulation.test.ts -t "reverses off"   # one file, -t filters by substring
                                                            # (`npx vitest <file>` watches instead)
```

The `--exclude "**/node_modules/**"` is **required**, because passing `--exclude`
overrides vitest's defaults.

The acceptance test's `2_700_000` ms timeout is a label only — the body is
synchronous, so it can never truncate coverage. The suite-wide `testTimeout` is
30 s (`vitest.config.ts`), sized so a map that grows the lane graph several-fold
still lands inside it; a test that blows past 30 s is hung, not merely thorough.

## Lint is clean and must stay clean

0 errors, 0 warnings today. Unused vars are **warnings, not errors**, so dead code
accumulates silently rather than failing anything.

`build/` is a *source* directory but is in ESLint's ignore list (inherited from the
Next preset, where `build/` means output), so `build/sites-vite-plugin.ts` is never
linted.

## No test file imports runtime symbols from `GameCanvas.tsx` itself any more

The god-file decomposition (`.claude/refactor-plan.md`, gitignored) finished
Phase 3 by moving `class BabylonGameSession` itself out to
`render/babylonGameSession.ts` (`export`ed). `gameCanvasInput.test.ts` —
previously the one holdout still pulling runtime symbols directly from
`GameCanvas.tsx` — now imports `isAuthoredCheckpointCrossing` and
`resolveNpcVisualSlotAssignments` from `render/babylonGameSession.ts`
instead; both moved with the class as session-adjacent code no phase before
3.14 had claimed. Everything else earlier importers needed — road strips,
water/facade/parkland geometry, route guidance, procedural textures, mesh
primitives, the prop/crowd catalogue — lives under `geometry/` or `render/`,
and `sessionContract.ts` holds the shared contract types.
`architecture.test.ts` reads `GameCanvas.tsx` as text (`fs.readFileSync`),
not as an ES import, and does not count here.

`GameCanvas.tsx` today is genuinely thin — `GameCanvasProps`/
`GameCanvasHandle`, the shell/canvas styles, and the `forwardRef` component
— so a top-level side effect touching `window`/`document`/WebGL there would
only affect that component and the six full-mount tests (below); a similar
side effect in `render/babylonGameSession.ts` is now the one that would
break `gameCanvasInput.test.ts`.

**Grep for `from ".../GameCanvas"` still misleads on one axis**: several test
files (`freeDriveLesson`, `npcTurnSmoothness`, `simulationAdapter`,
`trafficSafetyAcceptance`, plus app-side `SideSwapApp`/`simulationAdapter`/
`freeDriveLesson`) use `GameCanvasLesson` and friends but import them from
`sessionContract.ts`, not `GameCanvas.tsx` — the type names survived Phase 1's
move, the import specifier didn't. Check the specifier, not just the symbol
name.

`gameCanvasSession.test.tsx`, `cockpitCharacterization.test.tsx`,
`trafficControlCharacterization.test.tsx`, `parksRenderCharacterization.
test.tsx`, `mirrorRigCharacterization.test.tsx` and
`cutsceneDirectorCharacterization.test.tsx` (all jsdom) are different in
kind from `gameCanvasInput.test.ts` above, and are the only other runtime
loads besides `DriveScreen`'s lazy `dynamic()`: all six deliberately mount
the real component, session and a `NullEngine` (copying the same jsdom-gap
workarounds — see the first file's header for why), so a
`window`/`document`/WebGL touch is what they exist to exercise, not a
hazard. The other five exist solely to characterize a builder before the
god-file decomposition reaches it (`.claude/refactor-plan.md`, gitignored) —
`cockpitCharacterization` and `mirrorRigCharacterization` both mount with
`cameraMode="first"`, since `playerCockpit` starts disabled (the wing-mirror
rig is parented to it) and the default mount never observes what's parented
there; `trafficControlCharacterization` mounts London and Tokyo, since no
single shipped map exercises every installation style it builds;
`parksRenderCharacterization` mounts Tokyo only — Cairo's Opera Grounds
(`parterre`/`plaza` features) can't mount here at all, since
`assertArabicCanvasFontDebug` needs the canvas 2D context to actually
rasterise and shape Arabic text, which this suite's fake context (no real
font rendering — jsdom has none) cannot provide; NYC's Joan of Arc park
(`plinth`) was skipped as disproportionate (Upper West Side is the largest
authored map) for one feature kind. `mirrorRigCharacterization` also ticks
the mounted session briefly and reads `__sideswapPerfDebug`'s mirror
counters, since the render-target `getCustomRenderList` closures it
characterizes only run once Babylon's render loop is actually ticking, not
at construction. `cutsceneDirectorCharacterization` drives the scene the
same way the app does — a `cutscene` prop rerender with a bumped nonce, not
an imperative test hook — and only exercises `pullover` and `repair`: per
`CutsceneDirector.start`'s own comments, those two "need no map data to stage" (a
heading-relative park; the car's own wing), so they are the only kinds
guaranteed to stage from an arbitrary free-drive spawn without also being
near the venue/pump/door the other five kinds require. Its repair case runs
the real wall-clock scripted show to completion (~10 s) to prove the scene
actually finishes and clears itself, not just that it starts. See the
guardrails table below.

## DOM tests

**`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test
needs the `installLocalStorage` polyfill (copied in `launcher.test.tsx` and
`careerFlow.test.tsx`), or an injected `ProgressStorage` the way `progress.test.ts`
does — plus a **synchronous `requestAnimationFrame` stub**, or `SideSwapApp`'s
`hydrated` guard never lifts and every test sees only the loading screen.

Tests default to `environment: "node"`. DOM needs `// @vitest-environment jsdom` on
line 1 and a local `@testing-library/jest-dom/vitest` import — **there is no setup
file**. Fifteen test files do this today: `careerFlow`, `cockpitCharacterization`,
`confirmDialog`, `cutsceneDirectorCharacterization`, `driveHud`, `expandedMap`,
`freeDriveFuel`, `gameCanvasSession`, `launcher`, `minimapCanvas`,
`mirrorRigCharacterization`, `parksRenderCharacterization`, `touchDriveControls`,
`trafficControlCharacterization`, `viewportSetup` — six of those
(`gameCanvasSession`, `cockpitCharacterization`, `trafficControlCharacterization`,
`parksRenderCharacterization`, `mirrorRigCharacterization`,
`cutsceneDirectorCharacterization`) are the full-mount Babylon tests discussed
above, not ordinary component tests.

## What is and isn't covered

**The app shell is tested through Career and almost nowhere else.**
`careerFlow.test.tsx` renders a real `SideSwapApp` (GameCanvas mocked) across ~50
tests: rent prepay, a fine charging only on its `cite` step, settlement, the
quit-day discard, a tampered save, per-vehicle props, buyout, roadside refuel, the
pump's cash-or-credit split on a short day, and — through a mock that can drive to
a stop — a job from offer to payout, the queue promoting, and accept/pass/expiry.
`launcher.test.tsx` adds a dozen more.

`freeDriveFuel.test.tsx` is the one free-drive economy path with cover: parking at
a pump, what the prompt offers a wallet that cannot fill the tank, and what the
`pump` event actually pours and bills. Its mock canvas is a cut-down `careerFlow`
one — two buttons, no clock.

What no test touches: free-drive fuel drain, the 8 s fine debounce, music mute.

**`touchFirst` is false in jsdom**, so nothing rendering `SideSwapApp` ever sees
the phone layout — `driveHud.test.tsx` passes `compact` directly instead, and the
geometry against the pedals is a WebKit measurement at 874×402, 734×343 and
640×320.

## Guardrails worth knowing about

| Test | What it pins |
|---|---|
| `trafficSafetyAcceptance` | Determinism (trace hash over two replays) + no collisions across 4 cities × 51 seeds |
| `architecture` | simulation.ts purity + the ring rules the god-file decomposition depends on |
| `gameCanvasSession` | `BabylonGameSession` actually constructs, ticks, pauses, resets and disposes (headless, NullEngine) |
| `cockpitCharacterization` | `buildCockpit`'s exact mesh/merge output (first-person, headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `trafficControlCharacterization` | Signal/camera/railway-crossing/road-marking exact mesh output across London + Tokyo (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `parksRenderCharacterization` | Park lawn/path/wall/court/torii/lantern exact mesh output for Tokyo's temple parks (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `mirrorRigCharacterization` | Rear-view/wing-mirror exact mesh output, plus non-zero render/candidate/drawn counts after ticking (first-person, headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `cutsceneDirectorCharacterization` | Pullover (patrol rig, actor visibility/position) and repair (runs to completion, emits its `done` event, clears itself) staged via a real `cutscene` prop rerender (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `cityRenderRegistry` | The right landmark/street-furniture builder is wired to each city's real map id, and an unrecognised id gets no entry — the Phase 4.5 registry's safety net |
| `content` / `cairoContent` / `londonContent` | Lane-graph continuity, "every lane has somewhere legal to go" |
| `roadRealism` | Only speed figures that country actually signs |
| `careerBalance` | Rent + fee ≤ 4 median gig nets; tickets reachable in 3–20 days |
| `map-data` | sha256 over the frozen OSM extracts |
| `driveAudioScheduling` | No direct `AudioParam.value` writes |
| `cockpitLayout` | Cowl never eats the road, at any FOV/aspect |
| `modelLibrary` | `SERVICE_MODEL_FRAME` matches the model registry |
| `touchDriveControls` | The right-rail pixel budget (jsdom has no layout, so this *is* the check) |

`public/models/vehicles/london-double-decker.glb` is **gitignored** (purchased
asset, licence forbids redistribution). Its test is `skipIf`-guarded, so a fresh
clone silently skips it. Rebuild with
`node tools/build-london-bus.mjs <path-to.obj>`.
