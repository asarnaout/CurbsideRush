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
    // GitHub Actions' runner has less RAM than a local dev machine, and this
    // suite's Babylon-heavy files (buildingWinding/buildingPlacement/
    // tokyoAssets/the characterization suites, now loading dozens of real
    // Tokyo authenticity plan glbs) accumulate real memory across a long-
    // lived worker's whole file queue -- vitest's default `forks` pool does
    // not spawn a fresh OS process per file, only per-file *module*
    // isolation within the same process, so nothing frees that growth until
    // the worker itself exits. Reproduced five times in CI as an
    // unattributed "Worker exited unexpectedly" (no failing test, no stack
    // trace, no "JavaScript heap out of memory" message -- that absence
    // matters: a clean V8 heap-limit hit prints a distinctive fatal error
    // before exiting, where a silent vanish is the signature of an external
    // OS OOM-kill instead) after a consistent ~90 of ~114 files, regardless
    // of worker count and regardless of whether the single heaviest test
    // (trafficSafetyAcceptance, isolated into its own CI step) was even in
    // the run.
    //
    // `vmMemoryLimit` (below) is vitest's own purpose-built lever for
    // exactly this ("if you see memory leaks, try to tinker this value" --
    // its own doc comment) -- BUT it is a silent no-op under the default
    // `forks` pool: confirmed directly in vitest's own runtime source
    // (`getMemoryLimit`, node_modules/vitest/dist/chunks/cli-api.*.js --
    // `if (pool !== "vmForks" && pool !== "vmThreads") return null`), which
    // is exactly why setting it alone (a prior attempt) reproduced the
    // identical crash byte-for-byte. It only takes effect under the
    // `vmForks`/`vmThreads` pools, so CI switches pools to unlock it. Both
    // CI-only, same as every other CI-specific tuning in this file -- there
    // is no memory ceiling to hit locally, and `forks`' full OS-process
    // isolation is the safer default to keep for local dev.
    pool: process.env.CI ? "vmForks" : undefined,
    vmMemoryLimit: process.env.CI ? "1GB" : undefined,
  },
});
