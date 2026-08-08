import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { buildNycLandmark } from "../app/game/render/nycLandmarks";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { nearestPointOnPolyline } from "../app/game/geometry/roadStrips";
import { defaultSidewalkWidthM } from "../app/game/visuals";
import type { GameCanvasMapPack } from "../app/game/sessionContract";

/**
 * The drivable bridge decks, measured rather than read.
 *
 * Three defects shipped here at once and none of them was visible to any
 * existing gate, because every one is a *lateral* placement and nothing had
 * ever asserted a lateral placement:
 *
 * 1. `cairoBridgePortalVisualAxis` resolved the deck's pavement band as
 *    `surface.sidewalkWidthM ?? 0` while `simulationAdapter` resolved the same
 *    band through the map's paved default. Cairo authors a width on every
 *    surface so the two agreed there; NYC authors none, so the drawn parapet
 *    stood 3.4 m inboard of the collider that represents it — a rail at the
 *    kerb, an invisible wall at the water, and an apparently unguarded footway
 *    in between.
 * 2. The pylon lateral was `(side * width) / 2 + 1` rather than
 *    `side * (width / 2 + 1)`, so each pair was displaced in one world
 *    direction instead of mirrored and one tower per pair stood inside the
 *    carriageway.
 * 3. The cables inherit the pylon lateral verbatim, so their low ends came
 *    down into the roadway at bumper height with them.
 *
 * Everything below is asked in world space against the bridge's own
 * centreline, which is the only frame in which "is it in the road" is a real
 * question.
 */

const BRIDGE_IDS = ["nyc-queensview-bridge", "nyc-harborline-bridge"] as const;

const bridgeSurface = (id: string) => {
  const surface = (NYC_MAP_PACK.geometry.roadSurfaces ?? []).find(
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
    const landmark = NYC_MAP_PACK.geometry.landmarks.find(
      (candidate) => candidate.id === id,
    );
    if (!landmark) throw new Error(`no landmark ${id}`);
    const before = new Set(scene.meshes.map((mesh) => mesh.name));
    const handled = buildNycLandmark(
      { scene, staticSceneryFreeze: [] as TransformNode[] },
      landmark,
      // The generic material argument the dispatcher passes; the bridge
      // builder makes its own and ignores it.
      null as never,
      NYC_MAP_PACK as unknown as GameCanvasMapPack,
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

describe("NYC bridge decks", () => {
  const bridges = buildBridges();

  it("draws the deck-edge parapet exactly where the collider stands", () => {
    // One formula, two files. When they disagree you hit a wall that is not
    // drawn and drive through one that is.
    const obstacles = buildStaticObstacles(
      NYC_MAP_PACK as unknown as GameCanvasMapPack,
      { minX: -1300, maxX: 1300, minZ: -1500, maxZ: 1500 },
    );
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
        // mesh reads back ~12 µm off the collider's exact metre value. The
        // error this guards against was 3.4 m.
        expect(bridge.lateralByName.get(name), name).toBeCloseTo(
          colliderLaterals[0],
          3,
        );
      }
      expect(colliderLaterals[0]).toBeCloseTo(colliderLaterals[1], 6);
    }
  });

  it("keeps every pylon, cable and lamp out of the carriageway", () => {
    for (const bridge of bridges) {
      const halfCarriagewayM = bridgeSurface(bridge.id).widthM / 2;
      const deckEdgeM =
        halfCarriagewayM + defaultSidewalkWidthM(NYC_MAP_PACK) + 0.4;
      const towers = namesMatching(bridge, "-pylon-");
      const cables = namesMatching(bridge, "-cable-");
      const lamps = namesMatching(bridge, "-lamp-");
      expect(towers.length, `${bridge.id} pylon meshes`).toBeGreaterThan(0);
      expect(cables.length, `${bridge.id} cable meshes`).toBeGreaterThan(0);
      expect(lamps.length, `${bridge.id} lamp meshes`).toBeGreaterThan(0);

      // Towers and their cables stand outboard of the whole deck.
      for (const name of [...towers, ...cables]) {
        expect(bridge.lateralByName.get(name), name).toBeGreaterThan(deckEdgeM);
      }
      // Lamps stand on the footway: clear of the carriageway, inboard of the
      // parapet so no head hangs over the river.
      for (const name of lamps) {
        const lateralM = bridge.lateralByName.get(name)!;
        expect(lateralM, name).toBeGreaterThan(halfCarriagewayM);
        expect(lateralM, name).toBeLessThan(deckEdgeM);
      }
    }
  });

  it("mirrors each pylon pair instead of sliding both the same way", () => {
    // The `(side * width) / 2 + 1` bug is invisible to a distance-only check
    // on one side: the pair straddled the deck, one 1 m too far out and one
    // 1.3 m into the road. Both sides of a pair must be the same distance out.
    for (const bridge of bridges) {
      const byFraction = new Map<string, number[]>();
      for (const name of namesMatching(bridge, "-pylon-")) {
        if (name.includes("-pylon-head-")) continue;
        const fraction = name.split("-pylon-")[1].split("-")[0];
        const laterals = byFraction.get(fraction) ?? [];
        laterals.push(bridge.lateralByName.get(name)!);
        byFraction.set(fraction, laterals);
      }
      expect(byFraction.size, `${bridge.id} pylon pairs`).toBe(2);
      for (const [fraction, laterals] of byFraction) {
        expect(laterals.length, `${bridge.id} @${fraction}`).toBe(2);
        expect(laterals[0], `${bridge.id} @${fraction}`).toBeCloseTo(
          laterals[1],
          3,
        );
      }
    }
  });

  it("puts a guardrail between the carriageway and the footway", () => {
    // Visual only by design — no collider, so the deck stays as drivable as it
    // has always been. What is pinned is where it stands, not that it stops
    // anything.
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
