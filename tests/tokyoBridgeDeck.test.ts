import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";
import { buildTokyoLandmark } from "../app/game/render/tokyoLandmarks";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import { defaultSidewalkWidthM, hashStringToSeed } from "../app/game/visuals";
import type { GameCanvasMapPack } from "../app/game/sessionContract";

/**
 * The drivable bridge decks, measured rather than read — cloned from
 * `tests/nycBridgeDeck.test.ts`'s invariants (see that file's header for the
 * three real defects this shape of test caught: a pavement-width mismatch
 * between the render axis and the collider, a mirrored-vs-slid lateral
 * offset, and cables inheriting the wrong lateral). Tokyo drops NYC's
 * suspension pylons/cables; the Kawanaka-bashi-only vermilion arch rib takes
 * their place in the "keeps every lateral extra out of the carriageway" and
 * "mirrors instead of sliding" cases.
 */

const BRIDGE_IDS = ["jp-sakura-ohashi", "jp-kawanaka-bashi", "jp-tsuki-ohashi"] as const;

const bridgeSurface = (id: string) => {
  const surface = (TOKYO_MAP_PACK.geometry.roadSurfaces ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!surface) throw new Error(`no road surface for ${id}`);
  return surface;
};

/** Perpendicular distance from a world point to the bridge's centreline. */
const lateralFromDeckCentre = (
  id: string,
  point: { x: number; z: number },
): number => {
  const nearest = nearestPointOnPolyline(point, bridgeSurface(id).centerline);
  return Math.hypot(point.x - nearest.x, point.z - nearest.z);
};

interface BuiltBridge {
  readonly id: string;
  /** Mesh name -> perpendicular distance from the deck centreline. */
  readonly lateralByName: ReadonlyMap<string, number>;
}

const buildBridges = (): readonly BuiltBridge[] => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const built: BuiltBridge[] = [];
  for (const id of BRIDGE_IDS) {
    const landmark = TOKYO_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === id,
    );
    if (!landmark) throw new Error(`no landmark ${id}`);
    const before = new Set(scene.meshes.map((mesh) => mesh.name));
    const handled = buildTokyoLandmark(
      { scene, staticSceneryFreeze: [] as TransformNode[] },
      landmark,
      // The generic material argument the dispatcher passes; the bridge
      // builder makes its own and ignores it.
      null as never,
      TOKYO_MAP_PACK as unknown as GameCanvasMapPack,
    );
    expect(handled, `${id} must be handled by the bespoke bridge builder`).toBe(
      true,
    );
    scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const lateralByName = new Map<string, number>();
    for (const mesh of scene.meshes) {
      if (before.has(mesh.name)) continue;
      const absolute = mesh.getAbsolutePosition();
      lateralByName.set(
        mesh.name,
        lateralFromDeckCentre(id, { x: absolute.x, z: absolute.z }),
      );
    }
    built.push({ id, lateralByName });
  }
  scene.dispose();
  engine.dispose();
  return built;
};

const namesMatching = (bridge: BuiltBridge, fragment: string): string[] =>
  [...bridge.lateralByName.keys()].filter((name) => name.includes(fragment));

describe("Tokyo bridge decks", () => {
  const bridges = buildBridges();

  it("draws the deck-edge parapet exactly where the collider stands", () => {
    // One formula, two files. When they disagree you hit a wall that is not
    // drawn and drive through one that is.
    const obstacles = buildStaticObstacles({
      mapPack: TOKYO_MAP_PACK as unknown as GameCanvasMapPack,
      bounds: { minX: -1300, maxX: 1300, minZ: -1200, maxZ: 1200 },
      buildingLayout: planMapBuildings(
        TOKYO_MAP_PACK as unknown as GameCanvasMapPack,
        hashStringToSeed(TOKYO_MAP_PACK.id),
      ),
    });
    for (const bridge of bridges) {
      const colliderLaterals = obstacles
        .filter(
          (obstacle) =>
            obstacle.kind === "obb" &&
            obstacle.id.includes(`-portal-${bridge.id}-`),
        )
        .map((obstacle) => {
          if (obstacle.kind !== "obb") throw new Error("narrowed above");
          return lateralFromDeckCentre(bridge.id, {
            x: obstacle.x,
            z: obstacle.z,
          });
        });
      expect(colliderLaterals.length, `${bridge.id} portal colliders`).toBe(2);

      const parapets = namesMatching(bridge, "-parapet-");
      expect(parapets.length, `${bridge.id} parapets`).toBe(2);
      for (const name of parapets) {
        // Millimetres, not float64: a Babylon world matrix is float32, so the
        // mesh reads back off the collider's exact metre value by a hair.
        expect(bridge.lateralByName.get(name), name).toBeCloseTo(
          colliderLaterals[0],
          3,
        );
      }
      expect(colliderLaterals[0]).toBeCloseTo(colliderLaterals[1], 6);
    }
  });

  it("keeps every lamp (and, on Kawanaka-bashi, the arch rib) out of the carriageway", () => {
    for (const bridge of bridges) {
      const halfCarriagewayM = bridgeSurface(bridge.id).widthM / 2;
      const deckEdgeM =
        halfCarriagewayM + defaultSidewalkWidthM(TOKYO_MAP_PACK) + 0.4;
      const lamps = namesMatching(bridge, "-lamp-");
      expect(lamps.length, `${bridge.id} lamp meshes`).toBeGreaterThan(0);
      // Lamps stand on the footway: clear of the carriageway, inboard of the
      // parapet so no head hangs over the river.
      for (const name of lamps) {
        const lateralM = bridge.lateralByName.get(name)!;
        expect(lateralM, name).toBeGreaterThan(halfCarriagewayM);
        expect(lateralM, name).toBeLessThan(deckEdgeM);
      }

      const archRibs = namesMatching(bridge, "-arch-");
      if (bridge.id === "jp-kawanaka-bashi") {
        expect(archRibs.length, `${bridge.id} arch rib segments`).toBeGreaterThan(0);
        // The arch stands outboard of the whole deck, same qualitative
        // placement as NYC's pylons (a fixed clearance past deckEdgeM).
        for (const name of archRibs) {
          expect(bridge.lateralByName.get(name), name).toBeGreaterThan(deckEdgeM);
        }
      } else {
        expect(archRibs.length, `${bridge.id} arch rib segments`).toBe(0);
      }
    }
  });

  it("mirrors the arch rib instead of sliding both sides the same way", () => {
    // The historical NYC bug (`(side * width) / 2 + 1` instead of
    // `side * (width / 2 + 1)`) displaced a whole pair in one world
    // direction rather than mirroring it. Tokyo's arch rib is the one
    // laterally-paired dressing this bridge set has, so it is the case that
    // would repeat the bug here — grouped by segment number (never parsed
    // out of a name containing an embedded sign, the same reason NYC's own
    // test groups by fraction instead of side).
    const bridge = bridges.find((b) => b.id === "jp-kawanaka-bashi")!;
    const byArchSegment = new Map<string, number[]>();
    for (const name of namesMatching(bridge, "-arch-")) {
      const segment = name.split("-arch-")[1].split("-")[0];
      const laterals = byArchSegment.get(segment) ?? [];
      laterals.push(bridge.lateralByName.get(name)!);
      byArchSegment.set(segment, laterals);
    }
    expect(byArchSegment.size, "arch segment groups").toBe(8);
    for (const [segment, laterals] of byArchSegment) {
      expect(laterals.length, `segment ${segment}`).toBe(2);
      expect(laterals[0], `segment ${segment}`).toBeCloseTo(laterals[1], 3);
    }
  });

  it("puts a guardrail between the carriageway and the footway", () => {
    // Visual only by design — no collider, so the deck stays as drivable as
    // it has always been. What is pinned is where it stands, not that it
    // stops anything.
    for (const bridge of bridges) {
      const halfCarriagewayM = bridgeSurface(bridge.id).widthM / 2;
      const rails = namesMatching(bridge, "-guardrail-");
      expect(rails.length, `${bridge.id} guardrails`).toBe(2);
      for (const name of rails) {
        const lateralM = bridge.lateralByName.get(name)!;
        expect(lateralM, name).toBeGreaterThan(halfCarriagewayM);
        expect(lateralM, name).toBeLessThan(halfCarriagewayM + 1);
      }
    }
  });
});
