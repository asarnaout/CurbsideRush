import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

const gameFiles = ["app/game/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const geometryFiles = ["app/game/geometry/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const simulationFiles = ["app/game/simulation/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: "curbside-rush/game-boundaries",
    files: gameFiles,
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          basePath: ".",
          zones: [
            {
              target: "./app/game",
              from: "./app",
              except: ["./game"],
              message:
                "Game modules must not import the app shell; pass app-owned data through the game boundary instead.",
            },
            {
              target: ["./app/game/render", "./app/game/geometry", "./app/game/simulation"],
              from: "./app/game/content.ts",
              message:
                "Render, geometry, and simulation modules must receive authored content through their inputs, not import the content registry.",
            },
            {
              target: ["./app/game/render", "./app/game/cities"],
              from: ".",
              // The app-shell zone above separately rejects app/ imports while
              // avoiding duplicate diagnostics for the same dependency edge.
              except: ["./app", "./node_modules"],
              message:
                "Render and city modules may depend only on app/game modules and external packages.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "curbside-rush/geometry-purity",
    files: geometryFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Geometry modules must remain framework-independent.",
            },
            {
              name: "react-dom",
              message: "Geometry modules must remain framework-independent.",
            },
          ],
          patterns: [
            {
              group: ["@babylonjs/**"],
              message: "Geometry modules must remain independent of the Babylon renderer.",
            },
            {
              group: ["react/**", "react-dom/**"],
              message: "Geometry modules must remain framework-independent.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "localStorage",
          "sessionStorage",
          "navigator",
          "location",
          "history",
          "addEventListener",
          "removeEventListener",
          "requestAnimationFrame",
          "cancelAnimationFrame",
        ].map((name) => ({
          name,
          message: "Geometry modules must remain independent of browser and DOM APIs.",
        })),
      ],
    },
  },
  {
    name: "curbside-rush/simulation-purity",
    files: simulationFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "simulation.ts and its seam modules must remain framework-independent.",
            },
            {
              name: "react-dom",
              message: "simulation.ts and its seam modules must remain framework-independent.",
            },
          ],
          patterns: [
            {
              group: ["@babylonjs/**"],
              message:
                "simulation.ts and its seam modules must remain independent of the Babylon renderer.",
            },
            {
              group: ["react/**", "react-dom/**"],
              message: "simulation.ts and its seam modules must remain framework-independent.",
            },
          ],
        },
      ],
      // Deliberately omits "window" from this list, unlike geometry-purity's
      // otherwise-identical set: simulation/roadRuleMonitor.ts has a local
      // RestrictionWindow parameter named `window` (a schedule window, not
      // the DOM global — see tests/architecture.test.ts's matching carve-out
      // for the same reason). ESLint's own scope analysis would not actually
      // false-positive on that shadowing parameter, but the other ten
      // browser/DOM globals below cover the real risk without relying on it.
      "no-restricted-globals": [
        "error",
        ...[
          "document",
          "localStorage",
          "sessionStorage",
          "navigator",
          "location",
          "history",
          "addEventListener",
          "removeEventListener",
          "requestAnimationFrame",
          "cancelAnimationFrame",
        ].map((name) => ({
          name,
          message:
            "simulation.ts and its seam modules must remain independent of browser and DOM APIs.",
        })),
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
