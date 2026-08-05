import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EGYPT_SIGNAL_BORDER_BARS } from "../app/game/geometry/roadFurnitureLayout";
import { buildFacadeLayout } from "../app/game/geometry/facadesAndKeepouts";

/**
 * Pins architecture invariants that ESLint cannot express. Import boundaries
 * belong to eslint.config.mjs, where they also run in editors and on every
 * lint invocation; this file is reserved for source-shape and runtime-purity
 * checks plus deterministic import-time computations.
 */

const root = process.cwd();

const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

/** Strips block and line comments well enough for token-presence checks below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Full text of every top-level `import ...;` statement. Brace lists wrap
 * across lines in this codebase, so the match spans newlines up to the
 * terminating semicolon. */
function importStatements(source: string): string[] {
  return [...source.matchAll(/^[ \t]*import\b[^;]*?;/gm)].map((m) => m[0]);
}

describe("simulation.ts stays pure", () => {
  const source = read("app", "game", "simulation.ts");

  it("imports only types, and only from ./types", () => {
    const statements = importStatements(source);
    expect(statements).toHaveLength(1);
    expect(statements[0].startsWith("import type")).toBe(true);
    expect(statements[0]).toMatch(/from\s+["']\.\/types["'];$/);
  });

  it("touches no impure runtime API, DOM, Babylon, or React", () => {
    const stripped = stripComments(source);
    // Deliberately NOT checking bare "window." — simulation.ts has a local
    // RestrictionWindow parameter named `window` (a schedule window, not the
    // global), and a naive grep would false-positive on it forever.
    const forbidden = [
      "Math.random",
      "Date.now(",
      "performance.",
      "document.",
      "localStorage",
      "addEventListener",
      "@babylonjs",
      'from "react',
    ];
    for (const token of forbidden) {
      expect(stripped.includes(token), token).toBe(false);
    }
  });
});

describe("GameCanvas has one client-only mount site", () => {
  it("DriveScreen holds the one dynamic() literal for GameCanvas; SideSwapApp has no static reference to it at all", () => {
    // The mount moved from SideSwapApp.tsx to DriveScreen.tsx in the Phase 5
    // god-file decomposition (DriveScreen is GameCanvas's only remaining
    // render site) — this asserts the invariant against its new home rather
    // than dropping it.
    const driveScreenSource = stripComments(read("app", "DriveScreen.tsx"));
    const dynamicLiterals = [
      ...driveScreenSource.matchAll(
        /dynamic\(\s*\(\)\s*=>\s*import\(\s*["']\.\/game\/GameCanvas["']\s*\)/g,
      ),
    ];
    expect(dynamicLiterals).toHaveLength(1);

    // SideSwapApp no longer references GameCanvas at all — not even
    // type-only, unlike the pre-DriveScreen era where it could hold a
    // type-only import of the props it passed straight through.
    const sideSwapAppSource = read("app", "SideSwapApp.tsx");
    const staticImports = importStatements(sideSwapAppSource).filter(
      (statement) => statement.includes("./game/GameCanvas"),
    );
    expect(staticImports).toHaveLength(0);
  });
});

describe("the shared session contract stays types-only", () => {
  const sessionContractPath = path.join(root, "app", "game", "sessionContract.ts");

  it.skipIf(!fs.existsSync(sessionContractPath))(
    "sessionContract.ts stays types-only",
    () => {
      const stripped = stripComments(fs.readFileSync(sessionContractPath, "utf8"));
      expect(stripped).not.toMatch(/export\s+(const|function|class|let)\b/);
    },
  );
});

describe("import-time computations are pinned before they move", () => {
  it("EGYPT_SIGNAL_BORDER_BARS keeps its four-bar layout", () => {
    expect(EGYPT_SIGNAL_BORDER_BARS).toHaveLength(4);

    const left = EGYPT_SIGNAL_BORDER_BARS[0];
    expect(left.id).toBe("left");
    expect(left.x).toBeCloseTo(-0.32, 9);
    expect(left.y).toBeCloseTo(0, 9);
    expect(left.z).toBeCloseTo(-0.19, 9);
    expect(left.width).toBeCloseTo(0.06, 9);
    expect(left.height).toBeCloseTo(1.6, 9);
    expect(left.depth).toBeCloseTo(0.08, 9);

    const bottom = EGYPT_SIGNAL_BORDER_BARS[EGYPT_SIGNAL_BORDER_BARS.length - 1];
    expect(bottom.id).toBe("bottom");
    expect(bottom.x).toBeCloseTo(0, 9);
    expect(bottom.y).toBeCloseTo(-0.77, 9);
    expect(bottom.z).toBeCloseTo(-0.19, 9);
    expect(bottom.width).toBeCloseTo(0.58, 9);
    expect(bottom.height).toBeCloseTo(0.06, 9);
    expect(bottom.depth).toBeCloseTo(0.08, 9);
  });

  it("buildFacadeLayout(0x9e3779b1) keeps its deterministic window pattern", () => {
    const cells = buildFacadeLayout(0x9e3779b1);
    expect(cells).toHaveLength(24);

    const first = cells[0];
    expect(first.row).toBe(0);
    expect(first.col).toBe(0);
    expect(first.lit).toBe(true);
    expect(first.shade).toBe(44);

    const last = cells[cells.length - 1];
    expect(last.row).toBe(5);
    expect(last.col).toBe(3);
    expect(last.lit).toBe(false);
    expect(last.shade).toBe(52);
  });
});
