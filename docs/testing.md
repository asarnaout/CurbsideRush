# Commands and testing

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run build:static # + prerendered index.html for a static host
npm run typecheck    # tsc --noEmit, ~3s
npm run lint         # eslint, ~11s
npm test             # vitest run: 83 files, 1366 tests, ~2min
```

Node >= 22.13 (repo currently runs v26). **There is no CI** — no `.github/`,
nothing runs test/lint/typecheck unless you do.

## The fast loop

`npm test` takes about two minutes and **almost all of it is one file** —
`tests/trafficSafetyAcceptance.test.ts` (4 cities × every start/checkpoint × 51
seeds × 60 s of sim). Everything else runs in ~12 s. Use the fast loop while
iterating, the full suite before committing:

```bash
# everything except the acceptance test -> 82 files / 1363 tests in ~14s
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

## Nine test files import `GameCanvas.tsx` for real, in node

`cairoVisuals`, `content`, `gameCanvasInput`, `guidanceCoverage`,
`intersectionVisuals`, `pavementPaths`, `roadJunctions`, `roadMarkings`,
`staticColliders`.

Adding a top-level side effect touching `window`/`document`/WebGL therefore breaks
tests that have nothing to do with rendering.

Four more *name* the module but use `import type` and never load it —
`freeDriveLesson`, `npcTurnSmoothness`, `simulationAdapter`,
`trafficSafetyAcceptance` — as do all three app-side importers (`SideSwapApp`,
`simulationAdapter`, `freeDriveLesson`). So the only other runtime load is
`SideSwapApp`'s lazy `dynamic()`. **Grep alone misleads here**; check whether the
import is type-only.

## DOM tests

**`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test
needs the `installLocalStorage` polyfill (copied in `launcher.test.tsx` and
`careerFlow.test.tsx`), or an injected `ProgressStorage` the way `progress.test.ts`
does — plus a **synchronous `requestAnimationFrame` stub**, or `SideSwapApp`'s
`hydrated` guard never lifts and every test sees only the loading screen.

Tests default to `environment: "node"`. DOM needs `// @vitest-environment jsdom` on
line 1 and a local `@testing-library/jest-dom/vitest` import — **there is no setup
file**. Eight test files do this today: `careerFlow`, `confirmDialog`, `driveHud`,
`expandedMap`, `launcher`, `minimapCanvas`, `touchDriveControls`, `viewportSetup`.

## What is and isn't covered

**The app shell is tested through Career and almost nowhere else.**
`careerFlow.test.tsx` renders a real `SideSwapApp` (GameCanvas mocked) across ~45
tests: rent prepay, a fine charging only on its `cite` step, settlement, the
quit-day discard, a tampered save, per-vehicle props, buyout, roadside refuel, and
— through a mock that can drive to a stop — a job from offer to payout, the queue
promoting, and accept/pass/expiry. `launcher.test.tsx` adds a dozen more.

What no test touches: free-drive fuel drain and refuel pricing, the 8 s fine
debounce, music mute.

**`touchFirst` is false in jsdom**, so nothing rendering `SideSwapApp` ever sees
the phone layout — `driveHud.test.tsx` passes `compact` directly instead, and the
geometry against the pedals is a WebKit measurement at 874×402, 734×343 and
640×320.

## Guardrails worth knowing about

| Test | What it pins |
|---|---|
| `trafficSafetyAcceptance` | Determinism (trace hash over two replays) + no collisions across 4 cities × 51 seeds |
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
