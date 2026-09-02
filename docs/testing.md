# Commands and testing

## Commands

```bash
npm run dev          # Vite dev server + Miniflare worker on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server (Cloudflare Worker + assets)
npm run build:static # + prerendered index.html for a static host
npm run typecheck    # tsc --noEmit, ~3s
npm run lint         # eslint, ~11s
npm test             # vitest run, ~2min
```

Traffic-only CPU measurements use a fixed-tick replay and remain outside the
pure simulation ring:

```bash
npx vitest bench tests/perf/trafficSimulation.bench.ts --pool=forks --maxWorkers=1
```

The report includes deterministic replay status, p50/p95/max step and replay
time, route-search work, spatial candidates, portal attempts, lifecycle work,
and queued peak for every shipped map. Compare paired runs on the same machine;
it is a profiling harness, not a gameplay assertion.

Node >= 22.13 (repo currently runs v26). GitHub Actions runs typecheck and lint
on pull requests and pushes to `main`; the full suite exceeds the hosted
runner's reliable memory budget, so `npm test` is the required local gate before
committing or merging.

## The fast loop

`npm test` takes about two minutes and **most of it is one file** —
`tests/trafficSafetyAcceptance.test.ts` (4 cities × 51 seeds × 60 s of sim).
Everything else runs in ~1 min, dominated by the full-mount NullEngine
characterization suites (`facadeGridDrawOrderCharacterization`,
`fourCityRenderCharacterization`, `buildingLayerCharacterization`,
`buildingRenderParity`), not by any one collision test —
`staticColliders.test.ts`'s two whole-map clearance sweeps (thousands of
sample points per map) build a test-local `ObstacleIndex` rather than
brute-forcing every sample against every obstacle, or they alone would run
far slower now that building obstacles are one-per-solid rather than
one-per-block. Use the fast loop while iterating, the full suite before
committing:

```bash
# everything except the acceptance test -> the fast suite in ~1min
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

## The visual-gap audit CLI

`npm run audit:visual-gaps -- --maps london,nyc,cairo` (plan
`.claude/three-city-visual-gap-elimination-plan.md`) defaults to the fast
raster/void-blob pass only — every qualifying (>= 300 m²) unclaimed ground
area, whole-map, no camera involved. **That blob list is a superset of real
failures**, not the zero-failure gate: a blob can be genuine void ground that
sits entirely behind an existing building on every road that can see it.
Add `--fan` to run the actual Section 7.6-7.8 camera-fan sweep
(`auditMapVisualGaps` in `geometry/visualGapCoverage.ts`) — real production
camera poses, real 72°/100° fans, real 3-D occlusion — and get the report
that is the real gate. `--fan` alone audits one chase profile at one
viewport (both travel headings, both FOVs); add `--full-matrix` for every
production camera a player can actually select (all three chase tunings
plus first-person from both seats, both viewports). Both are opt-in because
a full unscoped `--fan --full-matrix` sweep of a content-heavy map is
minutes, not seconds, by design (every road × station × heading × profile ×
viewport × FOV is a distinct audited view, not redundant work) — scope to
one content fix's own road(s) with `--roads <id,id,...>` for a fast
dev-loop iteration, and drop the scope only for the real final-gate run.

A committed per-commit test cannot call `auditMapVisualGaps` unscoped either,
for the same reason: measured directly, an unscoped whole-Cairo default-profile
sweep took 7+ minutes. `cairoContent.test.ts`'s own bare-kerb-run test
(visual-gap plan Section 12.11) is the pattern for a city that needs a real
committed gate instead of ad hoc CLI runs: the fast `bareKerbRuns` metric
(Section 5.4) finds candidates, then each candidate is checked against the
*already-computed* raster's own qualifying void blobs (same cost as one
`buildGroundRaster` call, no camera involved) rather than re-verified with a
live sweep — a candidate is only a real test failure if no known blob within
70 m (Section 5.3's own sightline distance) explains it. `tokyoContent.test.ts`
(Tokyo expansion Phase 4) reuses this exact pattern for Tokyo's own generated
street wall, plus a per-district walled-kerb coverage floor Cairo's version
does not carry — the first city this shape was cloned to, proving the
pattern generalises rather than being Cairo-specific machinery.

## Lint is clean and must stay clean

0 errors, 0 warnings today. `npm run lint` uses `--max-warnings 0`, so warnings
fail the local gate and CI just like errors do. Unused variables are still
reported at warning severity, but they can no longer accumulate behind a green
lint command.

`build/` is a *source* directory but is in ESLint's ignore list (inherited from the
Next preset, where `build/` means output), so `build/sites-vite-plugin.ts` is never
linted.

## GameCanvas test boundaries

Ordinary pure tests import helpers from `geometry/`, `render/` or their leaf
modules, never runtime symbols from `GameCanvas.tsx`. In particular,
`gameCanvasInput.test.ts` exercises road geometry, input math, cockpit math and
NPC visual-slot assignment without mounting React or starting WebGL.

Nine jsdom suites deliberately cross that boundary:
`gameCanvasSession`, `cockpitCharacterization`,
`trafficControlCharacterization`, `parksRenderCharacterization`,
`mirrorRigCharacterization`, `cutsceneDirectorCharacterization`,
`fourCityRenderCharacterization`, `buildingLayerCharacterization` and
`facadeGridDrawOrderCharacterization`. They mount the real component and
`BabylonGameSession` against a `NullEngine`, copying the jsdom-gap
workarounds documented in `gameCanvasSession.test.tsx`. The four-city suite
pins the complete authored scene shape; the focused suites make failures
easier to localize. Full-mount suites that include Tokyo mock the Japanese
font readiness/ink proof exactly as the Cairo-capable suites mock the Arabic
proof; jsdom has neither the Font Loading API nor a real raster canvas.

`mirrorRigCharacterization` ticks the session because mirror render-list
closures run only once Babylon renders. `cutsceneDirectorCharacterization` uses
the real prop/nonce flow and lets the repair script finish, so it proves cleanup
as well as staging. `buildingLayerCharacterization` mocks `modelLibrary.ts`
more deeply than its siblings: every other full-mount suite (including
`fourCityRenderCharacterization`) keeps every model unloaded, which routes
every building through the procedural facade-grid fallback and never
exercises the *instanced* glb path at all. This suite instead real-loads
every shipped building-set glb from `public/` on disk (the data-URI recipe
`buildingPlacement.test.ts`/`cairoRoofs.test.ts` use, no network) so
`BuildingLayer`'s actual placement, storefront-variant and Cairo-roof-clutter
logic runs for real. `facadeGridDrawOrderCharacterization` shares the
four-city suite's unloaded-model mock on purpose (it needs the same
procedural-fallback path) and fingerprints per-mesh position/size rather than
mesh names or counts, sorted by name — see `docs/rendering.md`'s
`buildScenarioEnvironment` section for why a raw `seededUnit`-output
fingerprint would not actually catch a draw-order regression here.

Tokyo advertising has two focused gates. `tokyoStreetFurniture` checks the
fictional Japanese/bilingual copy, regular-atlas crops, every campaign/tenant
mounting kind and unique IDs. Its density gates require at least twice the
rejected pass's placements and advertised buildings, cap signs per unique host,
and pin represented-road, spawn/core and opening-block coverage; the current
plan is 4,288 placements on 1,450 buildings across 99 roads. It also enforces
procedural-only campaigns, vertical blade-only residential-style hosts,
road-to-facade visibility, carriageway-edge clearance, and both U/V inversions
on every textured `+Z` campaign and tenant face, plus shared masters and map
isolation.
`tokyoAdvertisingAssets` separately pins all 28 normalized source-cell sizes,
both v2 atlas dimensions/checksums and the self-hosted Japanese font bytes.
These geometry gates do not replace an actual chase-camera drive sweep.

## DOM tests

**`window.localStorage` does not exist in this project's jsdom.** A new `.tsx` test
needs the `installLocalStorage` polyfill (copied in `launcher.test.tsx` and
`careerFlow.test.tsx`), or an injected `ProgressStorage` the way `progress.test.ts`
does — plus a **synchronous `requestAnimationFrame` stub**, or `SideSwapApp`'s
`hydrated` guard never lifts and every test sees only the loading screen.

Tests default to `environment: "node"`. DOM needs `// @vitest-environment jsdom` on
line 1 and a local `@testing-library/jest-dom/vitest` import — **there is no setup
file**. Nineteen test files do this today: `buildingLayerCharacterization`,
`careerFlow`, `cockpitCharacterization`, `confirmDialog`,
`cutsceneDirectorCharacterization`, `driveHud`, `expandedMap`,
`facadeGridDrawOrderCharacterization`, `fourCityRenderCharacterization`,
`freeDriveFuel`, `gameCanvasSession`, `launcher`, `minimapCanvas`,
`mirrorRigCharacterization`, `parksRenderCharacterization`,
`touchDriveControls`, `tokyoStreetFurniture`, `trafficControlCharacterization`,
`viewportSetup`. The
nine full-mount Babylon tests are listed above; the rest are ordinary
component tests.

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
| `trafficLocality` | Exact clipped lane length and density targets, deterministic portal catalogue/indexing, safe endpoint/control/conflict-zone setbacks and one-way coverage, bounded locality lifecycle work, a tick-indexed moving-player recycle/re-entry trace, and fresh/full-reset parity across all four maps |
| `trafficPortalCoverage` | Every eligible shipped lane sampled at 100 m, including terminal remainders, has a deterministic 500–650 m hidden-approach portal; current maps have no topology exceptions |
| `trafficSpatialIndex` | Lane/world-cell lifecycle and a conservative route-leading candidate oracle for same-lane, successor, long-target-lane, and six-hop/240 m cases |
| `buildingColliderAgreement` | Every "building" static obstacle traces back to exactly one `planMapBuildings` solid, at float epsilon, across all four maps — the building-collision-visual-parity plan's Section 10.2 proof that render and collision cannot drift |
| `landmarkGroundSolids` | Every over/under-collided bespoke landmark's exact ground solid (positive/negative probes against the real map descriptor); every landmark on every map classified as bespoke, semantic exception (park/railway/bridge), or hand-verified generic — the building-collision-visual-parity plan's Section 10.3 proof, doubling as the audit's regression lock |
| `visualSceneFootprints` | The visual-gap audit's own geometry kernel (point-in-shape, boolean ops, circle sagitta, winding) against hand-authored shapes; `collectGroundSurfaces`/`collectOccluderVolumes` against all four real map packs — every surface's `surfaceY`/`layerPriority` matches `render/renderConstants.ts`'s y-layer stack, sidewalks never substantially overlap their own carriageway, every landmark-building occluder matches `babylonGameSession.ts`'s own tower/facade-box fallback formula byte-for-byte, and the current `audit_geometry_missing` issue set is pinned per map |
| `cameraPoses` | `resolveChaseCameraPose`'s tuning fallback/geometry; `forwardVectorFromYawPitch` verified against a real `UniversalCamera` under `NullEngine`, per that source file's own doc-comment promise |
| `architecture` | simulation.ts purity + the ring rules the god-file decomposition depends on |
| `gameCanvasSession` | `BabylonGameSession` actually constructs, ticks, pauses, resets and disposes (headless, NullEngine); every `__sideswap*` debug hook exists and is removed on dispose; the Section 14.1 content-budget counters and a real (single-road-scoped) visual-gap fan sweep + overlay draw/clear are exercised against actual session state, not stubs |
| `cockpitCharacterization` | `buildCockpit`'s exact mesh/merge output (first-person, headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `trafficControlCharacterization` | Signal/camera/railway-crossing/road-marking exact mesh output across London + Tokyo (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `parksRenderCharacterization` | Park lawn/path/wall/court/torii/lantern exact mesh output for Tokyo's temple parks (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `tokyoStreetFurniture` / `tokyoAdvertisingAssets` | Tokyo's placement/unique-host density and road-coverage floors, residential/commercial host split, approach visibility, two-axis `+Z` texture orientation, runtime Japanese copy, campaign/tenant renderer families, 28 editable source cells, v2 atlas bytes and Japanese font provenance |
| `mirrorRigCharacterization` | Rear-view/wing-mirror exact mesh output, plus non-zero render/candidate/drawn counts after ticking (first-person, headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `cutsceneDirectorCharacterization` | Pullover (patrol rig, actor visibility/position) and repair (runs to completion, emits its `done` event, clears itself) staged via a real `cutscene` prop rerender (headless, NullEngine) — the Phase 3 god-file decomposition's safety net for that extraction |
| `fourCityRenderCharacterization` | Exact four-city mesh/material fingerprint, cockpit mirror names, and mirror render activity (headless, NullEngine) |
| `buildingLayerCharacterization` | Real-loaded (from disk) instanced-building placement counts, Cairo roof-clutter instance counts, and NYC storefront-variant sign material counts, per city (headless, NullEngine) — the issue #288 `BuildingLayer` extraction's safety net |
| `facadeGridDrawOrderCharacterization` | The render-side `seededUnit` draw count and a per-mesh (name, position, size) fingerprint for every facade-grid/museum-wing mesh, per city (headless, NullEngine) — the issue #304 `ProceduralFacades` extraction's safety net |
| `cityRenderRegistry` | The right landmark/street-furniture builder is wired to each city's real map id, and an unrecognised id gets no entry — the Phase 4.5 registry's safety net |
| `cairoQasrLions` | Qasr El-Nil's detailed instanced lion master appears as two outward-facing pairs on stepped plinths, one pair at each bridge approach |
| `visuals` (per-city visual profile) | `MAP_VISUAL_PROFILES`'s buildingSets/natureSets/weights are internally consistent and its buildingSets allow-list matches every real MapPack's blocks — the issue #291 registry's safety net |
| `content` / `cairoContent` / `londonContent` / `tokyoContent` | Lane-graph continuity, "every lane has somewhere legal to go"; `cairoContent`/`tokyoContent` also carry the bare-kerb-run committed gate described above |
| `londonRoadsideLawns` | All 19 London curbside ribbons (boulevard/spawn, Chelsea and museum-quarter forecourts) preserve their logical long axis while clipped raised edge bands overlap the asphalt curb and every backing-facade interval; known worst-case career seeds are included, renderer vertices and the audit's two ground rungs must match, foreign junction pavements stay concrete, and intersecting lawn surfaces may never share a y-rung |
| `nycWaterfront` | The Hudson/East River shoreline *collider* (`simulationAdapter.ts`'s `buildStaticObstacles`, not the rendered water polygon `content.test.ts` already covers): every shore run sits on its own water body's real edge, only at-grade Harborline opens the East River bank, high Queensview stays above an unbroken shoreline, the Harborline portal stays unwalled, the Hudson opens nowhere or crosses Riverside Drive, and nothing duplicates the world-edge fence |
| `tokyoWaterfront` | Same shoreline-collider contract for the Sakuragawa (Tokyo expansion Phase 3): opens at exactly its three bridges, portals unwalled, the shore never crosses `jp-kawate-dori`/`jp-kawagishi-dori` (checked by nearest-point clearance rather than NYC's fixed-x line, since `jp-kawagishi-dori` wobbles), and the river's full-map-height span is the world-edge exemption rather than a fence-duplication bug |
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
