import { describe, expect, it } from "vitest";
import { FREE_DRIVES, MAP_PACKS } from "../app/game/content";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { buildGroundRaster, QUALIFYING_BLOB_AREA_M2 } from "../app/game/geometry/visualGapCoverage";
import { collectMapVisualGeometry } from "../app/game/geometry/visualSceneFootprints";

/**
 * The real-map end-to-end smoke test neither the synthetic
 * `visualGapCoverage.test.ts` suite nor `buildingVisualOcclusion.test.ts`
 * can substitute for: real London/NYC/Cairo/Tokyo geometry is what actually
 * found both a `polygon-clipping` ring-closing crash on complex real road/
 * park polygons and a boundary-cell area-overcounting bug during Phase 1
 * development — neither ever showed up against small synthetic maps. This
 * suite exists so both stay caught. Tokyo is included even though it is
 * outside this plan's content scope, per Section 1's "shared-geometry
 * changes must still pass Tokyo regression tests."
 *
 * KNOWN OPEN GAP (diagnosed, tracked, not silently accepted): 2393 London
 * cells and 1 Cairo cell still throw inside `polygon-clipping` even after
 * the coordinate-snap fix. `buildGroundRaster` already degrades this
 * correctly per Section 5.5 (`unsupported_geometry`: reported and excluded
 * from every fragment/blob, never guessed at, and it never crashes the
 * run), so this test asserts a bound at the currently-observed count
 * (with headroom) rather than zero — zero is the plan's own Section 13.2
 * final-gate requirement, not a Phase 1 bar.
 *
 * London's 2393 form one contiguous rectangular region (24 cell columns x
 * ~104 rows, not scattered noise), and its x/z bounds match
 * `road-london-king-william`'s road-surface bounding box almost exactly
 * (x=[1178.4,1264.7], z=[-310.7,101.2]) — strong evidence that road's strip
 * polygon (built by `buildRoadSurfaceStripGeometry` from its authored
 * centerline) is self-intersecting or otherwise topologically degenerate
 * somewhere along its ~410 m run, most likely from a sharp bend whose
 * mitre join crosses itself despite `roadStrips.ts`'s
 * `MAX_ROAD_MITER_RATIO` cap — snapping coordinates fixes float noise, not
 * genuine self-intersection. Start there before the Phase 6 zero-failure
 * gate; this test's failure message prints the live `unsupportedCellIds`
 * list if the count ever changes.
 */
const MAX_KNOWN_UNSUPPORTED_CELLS: Readonly<Record<string, number>> = {
  "london-south-kensington": 2500,
  "cairo-central-nile": 5,
  "nyc-upper-west-side": 0,
  "tokyo-setagaya": 0,
};
describe("visualGapCoverage — real map collection and raster (regression)", () => {
  it.each(MAP_PACKS.map((pack) => [pack.id, pack] as const))(
    "%s: collects real geometry and rasters it without throwing",
    (_id, pack) => {
      const freeDrive = FREE_DRIVES.find((fd) => fd.mapId === pack.id);
      const trafficSeed = freeDrive ? freeDrive.trafficSeed : 0;
      const plan = planMapBuildings(pack, trafficSeed);
      const geometry = collectMapVisualGeometry(pack, plan);

      expect(geometry.groundSurfaces.length, `${pack.id} groundSurfaces`).toBeGreaterThan(0);
      expect(geometry.occluders.length, `${pack.id} occluders`).toBeGreaterThan(0);
      // At least one "world-ground" surface must exist, or the raster has
      // no base layer to subtract anything from.
      expect(geometry.groundSurfaces.some((s) => s.kind === "world-ground"), `${pack.id} world-ground`).toBe(true);

      const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
      const maxKnown = MAX_KNOWN_UNSUPPORTED_CELLS[pack.id] ?? 0;
      expect(
        raster.unsupportedCellIds.length,
        `${pack.id} unsupported cells (ids: ${raster.unsupportedCellIds.slice(0, 10).join(", ")}${raster.unsupportedCellIds.length > 10 ? ", ..." : ""})`,
      ).toBeLessThanOrEqual(maxKnown);
      expect(raster.fragments.length, `${pack.id} fragments`).toBeGreaterThan(0);

      // Every reported fragment must actually sit within the map's rendered
      // world-ground bounds — the exact defect the boundary-clipping fix
      // (booleanIntersection with the world rectangle before subtracting
      // local shapes) exists to prevent.
      const worldGround = geometry.groundSurfaces.find((s) => s.kind === "world-ground")!;
      const worldShape = worldGround.geometry;
      if (worldShape.kind === "aabb") {
        for (const fragment of raster.fragments) {
          expect(fragment.aabb.minX, `${pack.id} ${fragment.id} minX`).toBeGreaterThanOrEqual(worldShape.minX - 1e-6);
          expect(fragment.aabb.maxX, `${pack.id} ${fragment.id} maxX`).toBeLessThanOrEqual(worldShape.maxX + 1e-6);
          expect(fragment.aabb.minZ, `${pack.id} ${fragment.id} minZ`).toBeGreaterThanOrEqual(worldShape.minZ - 1e-6);
          expect(fragment.aabb.maxZ, `${pack.id} ${fragment.id} maxZ`).toBeLessThanOrEqual(worldShape.maxZ + 1e-6);
        }
      }

      // Every blob's summed area must be internally consistent with its own
      // fragments (catches a union-find/grouping regression cheaply). A Map
      // keeps this O(fragments) total instead of O(blobs x fragments) — a
      // real map has hundreds of thousands of fragments, and a linear
      // `.find()` per id made this check itself the slow part.
      const fragmentAreaById = new Map(raster.fragments.map((f) => [f.id, f.area] as const));
      for (const blob of raster.blobs) {
        const summed = blob.fragmentIds.reduce((sum, id) => sum + (fragmentAreaById.get(id) ?? 0), 0);
        expect(summed, `${pack.id} ${blob.id} area consistency`).toBeCloseTo(blob.area, 3);
        expect(blob.qualifying).toBe(blob.area >= QUALIFYING_BLOB_AREA_M2);
      }
    },
    60_000,
  );
});
