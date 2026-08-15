import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // Vitest's default is 5 s, and several map tests are quadratic in lane or
    // address count (content's opposing-lane sweep, staticColliders' corridor
    // and pavement checks, streetAddresses' pairwise spacing). They sit at
    // 30-130 ms today, so a map that grows the lane graph several-fold can
    // still land an order of magnitude inside this budget — and a test that
    // does blow past 30 s is hung, not merely thorough. Tests needing more
    // (npcTurnSmoothness, the traffic-safety sweep) declare it inline.
    testTimeout: 30_000,
    coverage: {
      reporter: ["text", "json-summary"],
    },
    // GitHub Actions' runner has grown too memory-constrained for this
    // suite's default fork parallelism: the Tokyo authenticity plan's
    // per-phase growth (dozens of real glb models now loaded across
    // buildingWinding/buildingPlacement/tokyoAssets/the characterization
    // suites) pushed peak concurrent-worker memory past the runner's ceiling
    // -- reproduced twice in a row as an unattributed "Worker exited
    // unexpectedly" crash (no failing test, no stack trace into any test's
    // own code) at the identical point in the run both times, which never
    // reproduces locally (far more RAM available there). Capping worker
    // count in CI only -- not locally, where the extra parallelism is a real
    // iteration-speed win and there is no memory ceiling to hit -- trades
    // some CI wall-clock for peak memory headroom, the same "raise the
    // budget, don't cut coverage" call this repo already made once for the
    // CI job's own timeout. (vitest v4's config field is the top-level
    // `maxWorkers`; the older `poolOptions.forks.maxForks` from vitest
    // v1-v3 no longer exists on this version's config type.)
    maxWorkers: process.env.CI ? 2 : undefined,
  },
});
