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
  },
});
