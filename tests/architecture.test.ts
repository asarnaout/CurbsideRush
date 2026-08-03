import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EGYPT_SIGNAL_BORDER_BARS } from "../app/game/geometry/roadFurnitureLayout";
import { buildFacadeLayout } from "../app/game/geometry/facadesAndKeepouts";

/**
 * Guards the dependency-arrow rules the god-file decomposition program relies
 * on (see .claude/refactor-plan.md, gitignored). Two things make this file
 * necessary rather than aspirational: docs/architecture.md has long claimed
 * simulation.ts's purity was "guarded by tests" when no such test existed,
 * and the coming extraction of GameCanvas.tsx into geometry/render/cities
 * sub-directories has no other mechanical check that a "pure" module stays
 * pure or that an inward-only ring stays inward-only. Source-text scanning
 * (not a bundler/lint rule) keeps this dependency-free and fast; it is not a
 * substitute for real import-boundary tooling (follow-up #9).
 */

const root = process.cwd();
const gameDir = path.join(root, "app", "game");
const contentPathNoExt = path.join(gameDir, "content");

const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

/** Strips block and line comments well enough for token-presence checks below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every file under `dir`, or `[]` if it doesn't exist yet — several rules
 * below are forward-looking and must stay green before Phase 1+ creates
 * their target directory. */
function listFilesRecursive(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full));
    else files.push(full);
  }
  return files;
}

/** Full text of every top-level `import ...;` statement. Brace lists wrap
 * across lines in this codebase, so the match spans newlines up to the
 * terminating semicolon. */
function importStatements(source: string): string[] {
  return [...source.matchAll(/^[ \t]*import\b[^;]*?;/gm)].map((m) => m[0]);
}

/** Every module specifier reached via a top-level `import` or `export ...
 * from` — the full set of this file's outgoing dependency arrows. */
function dependencySpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/^[ \t]*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["'];/gm),
  ].map((m) => m[1]);
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

describe("ring boundaries hold today", () => {
  it("BabylonGameSession never imports the content registry", () => {
    const source = read("app", "game", "render", "babylonGameSession.ts");
    // It DOES import cairoContent.ts for authored Cairo constants — that is
    // existing and allowed. The ban is on the registry module specifically.
    expect(dependencySpecifiers(source)).not.toContain("../content");
  });

  it("SideSwapApp's only static reference to GameCanvas is a type-only import, alongside exactly one dynamic() literal", () => {
    const source = read("app", "SideSwapApp.tsx");

    const dynamicLiterals = [
      ...source.matchAll(
        /dynamic\(\s*\(\)\s*=>\s*import\(\s*["']\.\/game\/GameCanvas["']\s*\)/g,
      ),
    ];
    expect(dynamicLiterals).toHaveLength(1);

    // At most one — SideSwapApp may hold zero (every prop/callback type now
    // lives in sessionContract.ts) or one static reference, and if one
    // exists it must be type-only; either way, no runtime value import.
    const staticImports = importStatements(source).filter((statement) =>
      statement.includes("./game/GameCanvas"),
    );
    expect(staticImports.length).toBeLessThanOrEqual(1);
    if (staticImports.length === 1) {
      expect(staticImports[0].startsWith("import type")).toBe(true);
    }
  });

  it("nothing under app/game imports the app shell", () => {
    const offenders: string[] = [];
    for (const file of listFilesRecursive(gameDir).filter((f) => /\.tsx?$/.test(f))) {
      for (const specifier of dependencySpecifiers(fs.readFileSync(file, "utf8"))) {
        const base = specifier.split("/").pop();
        if (base === "SideSwapApp" || base === "CareerViews") {
          offenders.push(`${path.relative(root, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("forward-looking module boundaries (pass vacuously before these directories exist)", () => {
  const geometryDir = path.join(gameDir, "geometry");
  const renderDir = path.join(gameDir, "render");
  const citiesDir = path.join(gameDir, "cities");
  const sessionContractPath = path.join(gameDir, "sessionContract.ts");

  it("geometry/ stays free of Babylon and the DOM", () => {
    for (const file of listFilesRecursive(geometryDir).filter((f) => /\.tsx?$/.test(f))) {
      const stripped = stripComments(fs.readFileSync(file, "utf8"));
      const label = path.relative(root, file);
      expect(stripped, label).not.toMatch(/@babylonjs/);
      expect(stripped, label).not.toMatch(/\bdocument\./);
      expect(stripped, label).not.toMatch(/\baddEventListener\b/);
      expect(stripped, label).not.toMatch(/\blocalStorage\b/);
    }
  });

  it.skipIf(!fs.existsSync(sessionContractPath))(
    "sessionContract.ts stays types-only",
    () => {
      const stripped = stripComments(fs.readFileSync(sessionContractPath, "utf8"));
      expect(stripped).not.toMatch(/export\s+(const|function|class|let)\b/);
    },
  );

  it("render/ and cities/ never import above app/game", () => {
    const offenders: string[] = [];
    const files = [...listFilesRecursive(renderDir), ...listFilesRecursive(citiesDir)].filter(
      (f) => /\.tsx?$/.test(f),
    );
    for (const file of files) {
      for (const specifier of dependencySpecifiers(fs.readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue; // bare package specifiers are fine
        const resolved = path.resolve(path.dirname(file), specifier);
        const rel = path.relative(gameDir, resolved);
        if (rel.startsWith("..")) {
          offenders.push(`${path.relative(root, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("render/ and geometry/ never import the content registry directly", () => {
    // render/ MAY import cities/ (GameCanvas already imports cairoContent
    // today) — the ban is on the registry module specifically.
    const offenders: string[] = [];
    const files = [...listFilesRecursive(renderDir), ...listFilesRecursive(geometryDir)].filter(
      (f) => /\.tsx?$/.test(f),
    );
    for (const file of files) {
      for (const specifier of dependencySpecifiers(fs.readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (resolved === contentPathNoExt) {
          offenders.push(`${path.relative(root, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
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
