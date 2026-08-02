# Commands and testing

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run build:static # + prerendered index.html for a static host
npm run typecheck    # tsc --noEmit, ~3s
npm run lint         # eslint, ~11s
npm test             # vitest run: 89 files, 1513 tests, ~2min
```

Node >= 22.13 (repo currently runs v26). **There is no CI** — no `.github/`,
nothing runs test/lint/typecheck unless you do.

## The fast loop

`npm test` takes about two minutes and **almost all of it is one file** —
`tests/trafficSafetyAcceptance.test.ts` (4 cities × every start/checkpoint × 51
seeds × 60 s of sim). Everything else runs in ~12 s. Use the fast loop while
iterating, the full suite before committing:

```bash
# everything except the acceptance test -> 88 files / 1511 tests in ~15s
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

## One test file still imports `GameCanvas.tsx` for real, in node

The god-file decomposition (`.claude/refactor-plan.md`, gitignored) is
steadily hollowing this list out: as of Phase 2, only `gameCanvasInput.test.ts`
still pulls runtime symbols directly from `GameCanvas.tsx`
(`isAuthoredCheckpointCrossing`, `resolveNpcVisualSlotAssignments` — both
session-adjacent code not yet claimed by any phase). Everything the eleven
other former importers needed — road strips, water/facade/parkland geometry,
route guidance, procedural textures, mesh primitives, the prop/crowd catalogue
— now lives under `geometry/` or `render/` instead, and `sessionContract.ts`
holds the shared contract types. `architecture.test.ts` reads
`GameCanvas.tsx` as text (`fs.readFileSync`), not as an ES import, and does
not count here.

Adding a top-level side effect touching `window`/`document`/WebGL to
`GameCanvas.tsx` therefore breaks `gameCanvasInput.test.ts` and the two
full-mount tests (below) — nothing else in the pure-symbol tests touches it
any more.

**Grep for `from ".../GameCanvas"` still misleads on one axis**: several test
files (`freeDriveLesson`, `npcTurnSmoothness`, `simulationAdapter`,
`trafficSafetyAcceptance`, plus app-side `SideSwapApp`/`simulationAdapter`/
`freeDriveLesson`) use `GameCanvasLesson` and friends but import them from
`sessionContract.ts`, not `GameCanvas.tsx` — the type names survived Phase 1's
move, the import specifier didn't. Check the specifier, not just the symbol
name.

`gameCanvasSession.test.tsx` and `cockpitCharacterization.test.tsx` (both
jsdom) are different in kind from `gameCanvasInput.test.ts` above, and are
the only other runtime loads besides `SideSwapApp`'s lazy `dynamic()`: both
deliberately mount the real component, session and a `NullEngine` (copying
the same jsdom-gap workarounds — see the first file's header for why), so a
`window`/`document`/WebGL touch is what they exist to exercise, not a
hazard. The second exists solely to characterize `buildCockpit` before the
god-file decomposition reaches it (`.claude/refactor-plan.md`, gitignored) —
it mounts with `cameraMode="first"`, since `playerCockpit` starts disabled
and the default mount never observes it. See the guardrails table below.

## DOM tests

**`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test
needs the `installLocalStorage` polyfill (copied in `launcher.test.tsx` and
`careerFlow.test.tsx`), or an injected `ProgressStorage` the way `progress.test.ts`
does — plus a **synchronous `requestAnimationFrame` stub**, or `SideSwapApp`'s
`hydrated` guard never lifts and every test sees only the loading screen.

Tests default to `environment: "node"`. DOM needs `// @vitest-environment jsdom` on
line 1 and a local `@testing-library/jest-dom/vitest` import — **there is no setup
file**. Eleven test files do this today: `careerFlow`, `cockpitCharacterization`,
`confirmDialog`, `driveHud`, `expandedMap`, `freeDriveFuel`, `gameCanvasSession`,
`launcher`, `minimapCanvas`, `touchDriveControls`, `viewportSetup` — the last two
of those (`gameCanvasSession`, `cockpitCharacterization`) are the full-mount
Babylon tests discussed above, not ordinary component tests.

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
