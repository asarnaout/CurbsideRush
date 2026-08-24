import { describe, expect, it } from "vitest";

import { CAIRO_MAP_PACK, CAIRO_OPEN_WATERFRONT_SIDES } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK, TOKYO_OPEN_WATERFRONT_SIDES } from "../app/game/cities/tokyo";
import { railCorridorExclusionRects } from "../app/game/geometry/railGeometry";
import { roadsidePropKeepOuts } from "../app/game/geometry/roadFurnitureLayout";
import { roadsidePropKindsForMap } from "../app/game/render/propCatalog";
import { speedLimitSignPlacements } from "../app/game/regulatorySigns";
import type { GameCanvasMapPack, GameCanvasPoint } from "../app/game/sessionContract";
import {
  generatePromenadeDecor,
  generateRoadsidePropPlacements,
  hashStringToSeed,
  PAVED_SIDEWALK_WIDTH_M,
  PROMENADE_SHORELINE_CLEARANCE_M,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  type PropPlacement,
  type PropScatterRect,
} from "../app/game/visuals";

/**
 * No scattered prop stands anywhere it physically cannot.
 *
 * This exists because a lit lamp post shipped standing **between the rails**
 * of a Cairo level crossing, and nothing in the suite noticed. The reason
 * nothing noticed is worth keeping written down: scattered props are
 * *knockable*, not solid, so they are absent from `buildStaticObstacles` and
 * therefore invisible to `railCorridors.test.ts`'s "keeps every solid obstacle
 * off the right-of-way" — the test that looks exactly like the one that should
 * have caught it. A prop can be in the worst possible place and every existing
 * assertion stays green.
 *
 * The regression itself was a bucketing mistake: kerb-seated props
 * (`PropKindConfig.curbOffsetM`) are exempt from rects that a carriageway
 * legitimately runs through — a park with a drive across it — because their
 * kerb is real inside one. `buildRoadsideProps` passed authored landmarks, the
 * rail right-of-way and the service/venue keep-outs as ONE array, so the
 * exemption reached all three; and a rail corridor crosses a carriageway by
 * construction at every level crossing. Four Cairo lamps, five Tokyo, one
 * London.
 *
 * `roadsidePropKeepOuts` is the real production bucketing, called here exactly
 * as `buildRoadsideProps` calls it; the scatter and promenade generators below
 * are the real ones too, driven from the real per-city `kinds` table. Only the
 * few lines of plumbing between them are restated (the render module they live
 * in imports Babylon, so it cannot be loaded here).
 */

const inflatedRectContains = (
  point: GameCanvasPoint,
  rect: PropScatterRect,
  inflateM = 1,
): boolean => {
  const heading = ((rect.headingDeg ?? 0) * Math.PI) / 180;
  const dx = point.x - rect.center.x;
  const dz = point.z - rect.center.z;
  const localX = dx * Math.cos(heading) - dz * Math.sin(heading);
  const localZ = dx * Math.sin(heading) + dz * Math.cos(heading);
  return (
    Math.abs(localX) <= rect.size.x / 2 + inflateM &&
    Math.abs(localZ) <= rect.size.z / 2 + inflateM
  );
};

const OPEN_WATERFRONT_SIDES_BY_KEY = {
  cairo: CAIRO_OPEN_WATERFRONT_SIDES,
  tokyo: TOKYO_OPEN_WATERFRONT_SIDES,
} as const;
const PROMENADE_KINDS_BY_KEY = {
  cairo: { treeKind: "palm", lampKind: "streetlight" },
  tokyo: { treeKind: "sakura", lampKind: "chochin-post" },
} as const;

function scatterFor(mapPack: GameCanvasMapPack): readonly PropPlacement[] {
  const mapId = mapPack.id;
  const key = resolveMapVisualKey(mapId);
  const palette = resolveMapVisualPalette(mapId);
  const keepOuts = roadsidePropKeepOuts(mapPack);
  const roadSurfaces = (mapPack.geometry.roadSurfaces ?? []).map((surface) => ({
    id: surface.id,
    centerline: surface.centerline,
    widthM: surface.widthM,
    sidewalkWidthM: surface.sidewalkWidthM,
  }));
  const waterPolygons = (mapPack.geometry.waterBodies ?? []).map(
    (body) => body.polygon,
  );
  const railLines = (mapPack.geometry.railLines ?? []).map((line) => ({
    points: line.points,
    corridorHalfWidthM: line.corridorHalfWidthM,
  }));

  const promenadeKinds =
    PROMENADE_KINDS_BY_KEY[key as keyof typeof PROMENADE_KINDS_BY_KEY];
  const openSides =
    OPEN_WATERFRONT_SIDES_BY_KEY[
      key as keyof typeof OPEN_WATERFRONT_SIDES_BY_KEY
    ];
  const promenade =
    openSides && promenadeKinds
      ? generatePromenadeDecor({
          roadSurfaces,
          waterPolygons,
          openSides,
          sidewalkWidthM: PAVED_SIDEWALK_WIDTH_M,
          worldSize: mapPack.geometry.worldSize,
          seed: hashStringToSeed(`${mapId}-promenade`),
          treeKind: promenadeKinds.treeKind,
          lampKind: promenadeKinds.lampKind,
          railLines,
          keepOutRects: keepOuts.poiRects,
          buildingRects:
            key === "cairo"
              ? mapPack.geometry.blocks.map((block) => ({
                  center: block.center,
                  size: block.size,
                  headingDeg: block.headingDeg,
                }))
              : undefined,
          shorelineClearanceM:
            key === "cairo" ? PROMENADE_SHORELINE_CLEARANCE_M : undefined,
        })
      : [];

  const roadside = generateRoadsidePropPlacements({
    roadSurfaces,
    blocks: mapPack.geometry.blocks.map((block) => ({
      center: block.center,
      size: block.size,
      headingDeg: block.headingDeg,
    })),
    landmarks: keepOuts.hardRects,
    roadCrossedRects: keepOuts.roadCrossedRects,
    worldSize: mapPack.geometry.worldSize,
    shoulderWidthM: palette.paved
      ? PAVED_SIDEWALK_WIDTH_M
      : Math.max(0.9, mapPack.geometry.shoulderWidth ?? 1.2),
    seed: hashStringToSeed(`${mapId}-props`),
    kinds: roadsidePropKindsForMap(key),
    waterPolygons,
    occupiedPoints: [
      ...speedLimitSignPlacements({
        lanes: mapPack.laneGraph.lanes,
        roadSurfaces: mapPack.geometry.roadSurfaces,
        defaultRoadWidthM: mapPack.geometry.roadWidth,
        occupiedPositions: mapPack.laneGraph.controls.flatMap((control) =>
          (control.installations ?? [])
            .filter((installation) => installation.mounting !== "road_marking")
            .map((installation) => installation.position),
        ),
      }),
      ...promenade,
    ],
  });
  return [...roadside, ...promenade];
}

const MAPS = [NYC_MAP_PACK, LONDON_MAP_PACK, TOKYO_MAP_PACK, CAIRO_MAP_PACK];

describe("roadside prop keep-outs", () => {
  it("covers every shipped map", () => {
    expect(MAPS.map((pack) => pack.id).sort()).toEqual([
      "cairo-central-nile",
      "london-south-kensington",
      "nyc-upper-west-side",
      "tokyo-setagaya",
    ]);
  });

  for (const mapPack of MAPS) {
    describe(mapPack.id, () => {
      it("stands no prop on the rail right-of-way, a forecourt or a venue lot", () => {
        // **Ground truth is derived here, NOT read back out of
        // `keepOuts.hardRects`.** Asserting against the same partition the
        // production function chose is a tautology: move the rail corridor
        // into the permeable bucket — precisely the bug — and a test written
        // that way goes on passing, because the list it checks shrank with
        // the mistake. Verified by making the mistake and watching it stay
        // green. So the corridor rects come straight from
        // `railCorridorExclusionRects`, and the landmark rects straight from
        // the map pack.
        const railRects = railCorridorExclusionRects(
          mapPack.geometry.railLines ?? [],
        );
        const landmarkRects: PropScatterRect[] = mapPack.geometry.landmarks
          .filter(
            (landmark) => landmark.kind !== "bridge" && landmark.kind !== "park",
          )
          .map((landmark) => ({ center: landmark.center, size: landmark.size }));
        const forbidden = [
          ...railRects,
          ...roadsidePropKeepOuts(mapPack).poiRects,
          ...landmarkRects,
        ];
        // Non-empty on every map, so this cannot pass by measuring nothing.
        expect(forbidden.length).toBeGreaterThan(0);

        const violations = scatterFor(mapPack)
          .filter((placement) =>
            forbidden.some((rect) => inflatedRectContains(placement, rect)),
          )
          .map(
            (placement) =>
              `${placement.kind} @(${Math.round(placement.x)},${Math.round(placement.z)})`,
          );
        expect(violations).toEqual([]);
      });

      it("still lights the park drives the kerb exemption exists for", () => {
        // The other side of the same rule: `roadCrossedRects` must stay
        // permeable to kerb-seated props, or Serpentine Road goes dark again.
        const kinds = roadsidePropKindsForMap(resolveMapVisualKey(mapPack.id));
        const kerbSeated = kinds.filter(
          (kind) => kind.curbOffsetM !== undefined,
        );
        const { roadCrossedRects } = roadsidePropKeepOuts(mapPack);
        if (!kerbSeated.length || !roadCrossedRects.length) return;
        const insidePark = scatterFor(mapPack).filter(
          (placement) =>
            kerbSeated.some((kind) => kind.kind === placement.kind) &&
            roadCrossedRects.some((rect) =>
              inflatedRectContains(placement, rect),
            ),
        );
        expect(insidePark.length).toBeGreaterThan(0);
      });
    });
  }
});
