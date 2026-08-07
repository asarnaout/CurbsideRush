import { describe, expect, it } from "vitest";
import {
  CITY_RENDER_REGISTRY,
  cityRenderRegistryFor,
} from "../app/game/render/cityRenderRegistry";
import { buildCairoLandmark } from "../app/game/render/cairoLandmarks";
import {
  buildLondonLandmark,
  buildLondonStreetFurniture,
} from "../app/game/render/londonLandmarks";
import { buildNycLandmark } from "../app/game/render/nycLandmarks";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";

/**
 * Pins the Phase 4.5 dispatch table (.claude/refactor-plan.md, gitignored)
 * that replaced buildScenarioEnvironment's mapId.includes("london") /
 * resolveMapVisualKey(mapId) === "cairo" branches — the one deliberate
 * structural change in an otherwise move-only decomposition program.
 *
 * Registry shape only: buildLondonLandmark/buildCairoLandmark/
 * buildLondonStreetFurniture themselves construct real Babylon meshes and
 * need a Scene to run for real; gameCanvasSession.test.tsx's NullEngine
 * mount already proves London's landmarks/furniture actually populate a
 * scene, so this file checks identity (the right function is wired to the
 * right mapId) rather than re-driving that mesh output.
 */
describe("cityRenderRegistry", () => {
  it("routes London's real map id to its own landmark and street-furniture builders", () => {
    const entry = cityRenderRegistryFor(LONDON_MAP_PACK.id);
    expect(entry?.landmarks).toBe(buildLondonLandmark);
    expect(entry?.streetFurniture).toBe(buildLondonStreetFurniture);
  });

  it("routes Cairo's real map id to its own landmark builder, with no street-furniture entry", () => {
    const entry = cityRenderRegistryFor(CAIRO_MAP_PACK.id);
    expect(entry?.landmarks).toBe(buildCairoLandmark);
    expect(entry?.streetFurniture).toBeUndefined();
  });

  it("routes NYC's real map id to its own landmark builder, with no street-furniture entry", () => {
    const entry = cityRenderRegistryFor(NYC_MAP_PACK.id);
    expect(entry?.landmarks).toBe(buildNycLandmark);
    expect(entry?.streetFurniture).toBeUndefined();
  });

  it("has no row for Tokyo's real map id — its landmarks fall through to the generic kind-based rendering", () => {
    expect(cityRenderRegistryFor(TOKYO_MAP_PACK.id)).toBeUndefined();
  });

  it("an unrecognised mapId gets no entry — never a default city's look", () => {
    expect(cityRenderRegistryFor("some-future-city")).toBeUndefined();
    expect(cityRenderRegistryFor("")).toBeUndefined();
  });

  it("CITY_RENDER_REGISTRY's own keys are exactly the cities with a real dispatch", () => {
    expect(Object.keys(CITY_RENDER_REGISTRY).sort()).toEqual(
      [CAIRO_MAP_PACK.id, LONDON_MAP_PACK.id, NYC_MAP_PACK.id].sort(),
    );
  });
});
