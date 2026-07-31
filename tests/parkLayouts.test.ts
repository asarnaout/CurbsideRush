import { describe, expect, it } from "vitest";
import { getMapPack } from "../app/game/content";
import {
  buildParkLayout,
  resolveParkStyle,
  type ParkLandmarkInput,
  type ParkLayoutContext,
} from "../app/game/parkLayouts";
import { distanceToPolylineM, resolveMapVisualKey } from "../app/game/visuals";
import type { MapId } from "../app/game/types";

const MAPS: readonly MapId[] = [
  "nyc-upper-west-side",
  "london-south-kensington",
  "tokyo-setagaya",
  "cairo-central-nile",
];

interface ParkCase {
  readonly mapId: MapId;
  readonly landmark: ParkLandmarkInput;
  readonly context: ParkLayoutContext;
  readonly visualKey: string;
}

/** Every authored park on every shipped map, with the context the renderer uses. */
const parkCases = (): readonly ParkCase[] => {
  const cases: ParkCase[] = [];
  for (const mapId of MAPS) {
    const pack = getMapPack(mapId);
    const roadSurfaces = (pack.geometry.roadSurfaces ?? []).map((surface) => ({
      centerline: surface.centerline,
      widthM: surface.widthM,
    }));
    for (const landmark of pack.geometry.landmarks) {
      if (landmark.kind !== "park") continue;
      cases.push({
        mapId,
        landmark,
        visualKey: resolveMapVisualKey(mapId),
        context: {
          roadSurfaces,
          sidewalkWidthM: 3.4,
          seed: 4242,
        },
      });
    }
  }
  return cases;
};

describe("park layouts", () => {
  it("covers every authored park on every shipped map", () => {
    // The twelve parks this was written against — four NYC, three Tokyo, two
    // Cairo, and London's Exhibition Road strip plus its two roundabout
    // islands, which are generated rather than listed and are easy to forget.
    // Pinned so adding a park is a deliberate act, not a surprise.
    expect(parkCases().length).toBe(12);
  });

  it("is deterministic — two builds are identical", () => {
    for (const { landmark, visualKey, context } of parkCases()) {
      expect(
        buildParkLayout(landmark, visualKey, context),
        landmark.id,
      ).toEqual(buildParkLayout(landmark, visualKey, context));
    }
  });

  it("gives each authored park the style its shape and city imply", () => {
    const styleOf = (id: string) => {
      const found = parkCases().find((c) => c.landmark.id === id);
      expect(found, id).toBeDefined();
      return found ? resolveParkStyle(found.landmark, found.visualKey) : null;
    };
    expect(styleOf("nyc-joan-of-arc-park")).toBe("urban_greensward");
    expect(styleOf("nyc-verdi-green")).toBe("pocket_green");
    expect(styleOf("jp-gotokuji-temple")).toBe("temple_grounds");
    expect(styleOf("jp-shoin-shrine")).toBe("temple_grounds");
    expect(styleOf("cairo-tahrir-square")).toBe("civic_plaza");
    expect(styleOf("cairo-opera-grounds")).toBe("urban_greensward");
    // The id beats the size gate: `jp-temple-green` is 24x28, small enough to
    // be a pocket green by proportions alone, but it is a named temple green
    // and gets gravel and an approach rather than a lawn with a bench.
    expect(styleOf("jp-temple-green")).toBe("temple_grounds");
    // Both London islands are 12x12 — pocket greens, which is the style that
    // must never grow a solid perimeter inside a turning loop.
    expect(styleOf("london-brompton-loop-green")).toBe("pocket_green");
    expect(styleOf("london-gloucester-loop-green")).toBe("pocket_green");
  });

  it("keeps every placement inside its own park", () => {
    for (const { landmark, visualKey, context } of parkCases()) {
      const layout = buildParkLayout(landmark, visualKey, context);
      const halfX = landmark.size.x / 2;
      const halfZ = landmark.size.z / 2;
      // Generous by the furniture offset, which pushes a bench off the path.
      const slack = 2.5;
      for (const placement of layout.placements) {
        const dx = Math.abs(placement.x - landmark.center.x);
        const dz = Math.abs(placement.z - landmark.center.z);
        expect(
          dx <= halfX + slack && dz <= halfZ + slack,
          `${landmark.id}: ${placement.kind} at (${placement.x.toFixed(1)}, ${placement.z.toFixed(1)}) is outside the park`,
        ).toBe(true);
      }
    }
  });

  it("never plants on a carriageway", () => {
    // Several authored parks are grazed or crossed by roads, and the lawn is
    // drawn UNDER them — so a tree in the middle of a street is the failure
    // this scatter has to avoid on its own.
    for (const { mapId, landmark, visualKey, context } of parkCases()) {
      const layout = buildParkLayout(landmark, visualKey, context);
      for (const placement of layout.placements) {
        for (const surface of context.roadSurfaces) {
          const distance = distanceToPolylineM(placement, surface.centerline);
          expect(
            distance,
            `${mapId}/${landmark.id}: ${placement.kind} stands ${distance.toFixed(1)}m from a road centreline`,
          ).toBeGreaterThanOrEqual(surface.widthM / 2);
        }
      }
    }
  });

  it("keeps planting off its own paths", () => {
    for (const { landmark, visualKey, context } of parkCases()) {
      const layout = buildParkLayout(landmark, visualKey, context);
      for (const placement of layout.placements) {
        if (placement.kind === "bench" || placement.kind === "lamp") continue;
        for (const path of layout.paths) {
          expect(
            distanceToPolylineM(placement, path.points),
            `${landmark.id}: ${placement.kind} stands on the ${path.id} path`,
          ).toBeGreaterThan(path.widthM / 2);
        }
      }
    }
  });

  it("gives a big park a path network and a token green none of the furniture", () => {
    const central = parkCases().find((c) => c.landmark.id === "nyc-central-park");
    expect(central).toBeDefined();
    if (central) {
      const layout = buildParkLayout(
        central.landmark,
        central.visualKey,
        central.context,
      );
      expect(layout.paths.length).toBeGreaterThan(0);
      expect(layout.placements.filter((p) => p.kind === "tree").length)
        .toBeGreaterThan(200);
      expect(layout.placements.some((p) => p.kind === "bench")).toBe(true);
      expect(layout.placements.some((p) => p.kind === "lamp")).toBe(true);
    }

    const verdi = parkCases().find((c) => c.landmark.id === "nyc-verdi-green");
    expect(verdi).toBeDefined();
    if (verdi) {
      const layout = buildParkLayout(verdi.landmark, verdi.visualKey, verdi.context);
      // A 40x24 traffic green has no room for a lamp-lit walk.
      expect(layout.placements.some((p) => p.kind === "bench")).toBe(false);
      expect(layout.placements.some((p) => p.kind === "lamp")).toBe(false);
      expect(layout.placements.some((p) => p.kind === "tree")).toBe(true);
    }
  });

  it("honours an authored style over the derived one", () => {
    const base = parkCases()[0];
    const forced = buildParkLayout(
      { ...base.landmark, parkStyle: "temple_grounds" },
      base.visualKey,
      base.context,
    );
    expect(forced.style).toBe("temple_grounds");
  });
});
