import {
  Mesh,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { buildNycLandmark } from "../app/game/render/nycLandmarks";
import { buildStaticObstacles } from "../app/game/simulationAdapter";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
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
const QUEENSVIEW_TEST_OVERHEAD_CLEARANCE_M = 6.5;

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

interface BuiltBridgeMesh {
  readonly name: string;
  readonly materialName: string | undefined;
  readonly totalVertices: number;
  readonly checkCollisions: boolean;
  readonly worldVertices: readonly Vector3[];
}

interface BuiltBridge {
  readonly id: string;
  readonly meshes: readonly BuiltBridgeMesh[];
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
    const sceneMeshes = scene.meshes.filter(
      (mesh): mesh is Mesh => !before.has(mesh.name) && mesh instanceof Mesh,
    );
    const meshes = sceneMeshes.map((mesh): BuiltBridgeMesh => {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
      const world = mesh.computeWorldMatrix(true);
      const worldVertices: Vector3[] = [];
      for (let offset = 0; offset < positions.length; offset += 3) {
        worldVertices.push(
          Vector3.TransformCoordinates(
            Vector3.FromArray(positions, offset),
            world,
          ),
        );
      }
      return {
        name: mesh.name,
        materialName: mesh.material?.name,
        totalVertices: mesh.getTotalVertices(),
        checkCollisions: mesh.checkCollisions,
        worldVertices,
      };
    });
    const lateralByName = new Map<string, number>();
    for (const mesh of sceneMeshes) {
      const absolute = mesh.getAbsolutePosition();
      lateralByName.set(
        mesh.name,
        lateralFromDeckCentre(id, { x: absolute.x, z: absolute.z }),
      );
    }
    built.push({ id, meshes, lateralByName });
  }
  scene.dispose();
  engine.dispose();
  return built;
};

const namesMatching = (bridge: BuiltBridge, fragment: string): string[] =>
  [...bridge.lateralByName.keys()].filter((name) => name.includes(fragment));

const queensviewVerticalRangesWithOffset = (
  elevationOffsetM: number,
): ReadonlyMap<string, readonly [number, number]> => {
  const mapPack = {
    ...NYC_MAP_PACK,
    geometry: {
      ...NYC_MAP_PACK.geometry,
      roadSurfaces: (NYC_MAP_PACK.geometry.roadSurfaces ?? []).map((surface) =>
        surface.id === "nyc-queensview-bridge"
          ? {
              ...surface,
              centerline: surface.centerline.map((point) => ({
                ...point,
                elevationM: (point.elevationM ?? 0) + elevationOffsetM,
              })),
            }
          : surface,
      ),
    },
  } as unknown as GameCanvasMapPack;
  const landmark = mapPack.geometry.landmarks.find(
    (candidate) => candidate.id === "nyc-queensview-bridge",
  )!;
  const engine = new NullEngine();
  const scene = new Scene(engine);
  buildNycLandmark(
    { scene, staticSceneryFreeze: [] },
    landmark,
    null as never,
    mapPack,
  );
  const ranges = new Map<string, readonly [number, number]>();
  for (const suffix of [
    "-cantilever-lattice",
    "-cantilever-necklace-lights",
  ]) {
    const mesh = scene.meshes.find((candidate) => candidate.name.endsWith(suffix));
    if (!(mesh instanceof Mesh)) throw new Error(`missing Queensview ${suffix}`);
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const world = mesh.computeWorldMatrix(true);
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    for (let offset = 0; offset < positions.length; offset += 3) {
      const vertex = Vector3.TransformCoordinates(
        Vector3.FromArray(positions, offset),
        world,
      );
      minimumY = Math.min(minimumY, vertex.y);
      maximumY = Math.max(maximumY, vertex.y);
    }
    ranges.set(suffix, [minimumY, maximumY]);
  }
  scene.dispose();
  engine.dispose();
  return ranges;
};

describe("NYC bridge decks", () => {
  const bridges = buildBridges();
  const harborline = bridges.find(
    (bridge) => bridge.id === "nyc-harborline-bridge",
  )!;
  const queensview = bridges.find(
    (bridge) => bridge.id === "nyc-queensview-bridge",
  )!;

  it("keeps Harborline's at-grade deck-edge parapet on its collider", () => {
    // One formula, two files. When they disagree you hit a wall that is not
    // drawn and drive through one that is.
    const obstacles = buildStaticObstacles({
      mapPack: NYC_MAP_PACK as unknown as GameCanvasMapPack,
      bounds: { minX: -1300, maxX: 1300, minZ: -1500, maxZ: 1500 },
      buildingLayout: planMapBuildings(
        NYC_MAP_PACK as unknown as GameCanvasMapPack,
        1,
      ),
    });
    for (const bridge of [harborline]) {
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

  it("keeps Harborline's pylons, cables and lamps out of the carriageway", () => {
    for (const bridge of [harborline]) {
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

  it("mirrors each Harborline pylon pair instead of sliding both the same way", () => {
    // The `(side * width) / 2 + 1` bug is invisible to a distance-only check
    // on one side: the pair straddled the deck, one 1 m too far out and one
    // 1.3 m into the road. Both sides of a pair must be the same distance out.
    for (const bridge of [harborline]) {
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

  it("keeps Harborline's guardrail between the carriageway and footway", () => {
    // Visual only by design — no collider, so the deck stays as drivable as it
    // has always been. What is pinned is where it stands, not that it stops
    // anything.
    for (const bridge of [harborline]) {
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

  it("renders Queensview as a compact blackened-steel cantilever lattice", () => {
    const lattice = queensview.meshes.filter((mesh) =>
      mesh.name.endsWith("-cantilever-lattice"),
    );
    const necklace = queensview.meshes.filter((mesh) =>
      mesh.name.endsWith("-cantilever-necklace-lights"),
    );
    expect(lattice).toHaveLength(1);
    expect(necklace).toHaveLength(1);
    expect(
      queensview.meshes.some(
        (mesh) => mesh.name.includes("-pylon-") || mesh.name.includes("-cable-"),
      ),
    ).toBe(false);
    expect(lattice[0].materialName).toBe(
      "nyc-queensview-bridge-cantilever-blackened-steel",
    );
    expect(necklace[0].materialName).toBe(
      "nyc-queensview-bridge-cantilever-amber-light",
    );
    expect(lattice[0].totalVertices).toBeGreaterThan(1_000);
    expect(queensview.meshes.length).toBeLessThanOrEqual(3);
    expect(queensview.meshes.every((mesh) => !mesh.checkCollisions)).toBe(true);
  });

  it("keeps Queensview's low lattice outboard and only crosses lanes high overhead", () => {
    const lattice = queensview.meshes.find((mesh) =>
      mesh.name.endsWith("-cantilever-lattice"),
    )!;
    const surface = bridgeSurface(queensview.id);
    const fullDeckHalfWidthM =
      surface.widthM / 2 +
      (surface.sidewalkWidthM ?? defaultSidewalkWidthM(NYC_MAP_PACK)) +
      0.4;
    for (const [index, vertex] of lattice.worldVertices.entries()) {
      const nearest = nearestPointOnPolyline(vertex, surface.centerline);
      const lateralM = Math.hypot(vertex.x - nearest.x, vertex.z - nearest.z);
      if (lateralM >= fullDeckHalfWidthM + 0.5) continue;
      expect(
        vertex.y - (nearest.elevationM ?? 0),
        `inboard truss vertex ${index}`,
      ).toBeGreaterThan(QUEENSVIEW_TEST_OVERHEAD_CLEARANCE_M);
    }
  });

  it("moves every Queensview truss and necklace level with the authored deck", () => {
    const baseline = queensviewVerticalRangesWithOffset(0);
    const lifted = queensviewVerticalRangesWithOffset(7);
    for (const [suffix, baselineRange] of baseline) {
      const liftedRange = lifted.get(suffix)!;
      expect(liftedRange[0] - baselineRange[0], `${suffix} minimum`).toBeCloseTo(
        7,
        5,
      );
      expect(liftedRange[1] - baselineRange[1], `${suffix} maximum`).toBeCloseTo(
        7,
        5,
      );
    }
  });
});
