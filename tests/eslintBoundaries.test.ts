import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, "eslint.config.mjs"),
});

async function lintText(relativeFilePath: string, source: string): Promise<ESLint.LintResult> {
  const results = await eslint.lintText(source, {
    filePath: path.join(root, relativeFilePath),
  });
  expect(results).toHaveLength(1);
  return results[0];
}

function expectRule(result: ESLint.LintResult, ruleId: string): void {
  const diagnostics = JSON.stringify(result.messages);
  expect(result.messages.some((message) => message.ruleId === ruleId), diagnostics).toBe(true);
  expect(result.messages.some((message) => message.fatal), diagnostics).toBe(false);
}

describe("ESLint architecture boundaries", () => {
  it("rejects app-shell imports from the game ring", async () => {
    const result = await lintText(
      "app/game/__eslint_boundary_probe__.ts",
      'import "../SideSwapApp";\n',
    );

    expectRule(result, "import/no-restricted-paths");
  });

  it("rejects the content registry from render and geometry", async () => {
    const results = await Promise.all([
      lintText("app/game/render/__eslint_boundary_probe__.ts", 'import "../content";\n'),
      lintText("app/game/geometry/__eslint_boundary_probe__.ts", 'import "../content";\n'),
    ]);

    for (const result of results) expectRule(result, "import/no-restricted-paths");
  });

  it("keeps render and cities from reaching above app/game", async () => {
    const results = await Promise.all([
      lintText(
        "app/game/render/__eslint_boundary_probe__.ts",
        'import "../../../tests/architecture.test";\n',
      ),
      lintText(
        "app/game/cities/__eslint_boundary_probe__.ts",
        'import "../../../tests/architecture.test";\n',
      ),
    ]);

    for (const result of results) expectRule(result, "import/no-restricted-paths");
  });

  it.each([
    ["Babylon packages", 'import "@babylonjs/core";\n', "no-restricted-imports"],
    ["React packages", 'import "react";\n', "no-restricted-imports"],
    ["DOM globals", "void document;\n", "no-restricted-globals"],
    ["browser storage", "void localStorage;\n", "no-restricted-globals"],
  ])("keeps geometry free of %s", async (_label, source, ruleId) => {
    const result = await lintText("app/game/geometry/__eslint_boundary_probe__.ts", source);

    expectRule(result, ruleId);
  });

  it("allows dependencies that point inward or stay within their ring", async () => {
    const results = await Promise.all([
      lintText("app/game/__eslint_boundary_probe__.ts", 'import "./types";\n'),
      lintText(
        "app/game/render/__eslint_boundary_probe__.ts",
        'import "../geometry/facadesAndKeepouts";\n',
      ),
      lintText(
        "app/game/geometry/__eslint_boundary_probe__.ts",
        'import "./facadesAndKeepouts";\n',
      ),
      lintText("app/game/cities/__eslint_boundary_probe__.ts", 'import "../types";\n'),
    ]);

    for (const result of results) expect(result.messages).toEqual([]);
  });
});
