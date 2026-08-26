import { describe, expect, it } from "vitest";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import {
  ELEVATED_ROAD_BARRIER_COLLIDER_MAX_LENGTH_M,
  ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
  ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
  ELEVATED_ROAD_DECK_OVERHANG_M,
  ELEVATED_ROAD_PARAPET_DEPTH_M,
  ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M,
  ELEVATED_ROAD_PIER_ROADSIDE_MARGIN_M,
  ELEVATED_DECK_START_M,
  createElevatedRoadDeckHeadroomQuery,
  createElevatedRoadGroundClearanceQuery,
  elevatedRoadBarrierPlacements,
  elevatedRoadDeckHeadroomAt,
  elevatedRoadDeckRun,
  elevatedRoadEdgeRuns,
  elevatedRoadPierPlacements,
  elevatedRoadSegmentPlacements,
} from "../app/game/geometry/elevatedRoadGeometry";
import { isElevatedRoadSurface } from "../app/game/roadElevation";

const distanceToPolylineM = (
  point: { readonly x: number; readonly z: number },
  centerline: readonly { readonly x: number; readonly z: number }[],
): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < centerline.length; index += 1) {
    const start = centerline[index - 1];
    const end = centerline[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.z - start.z) * dz) /
                lengthSquared,
            ),
          )
        : 0;
    nearest = Math.min(
      nearest,
      Math.hypot(
        point.x - (start.x + dx * amount),
        point.z - (start.z + dz * amount),
      ),
    );
  }
  return nearest;
};

describe("elevated-road structure placement", () => {
  const viaduct = {
    id: "viaduct",
    widthM: 14,
    centerline: [
      { x: -100, z: 0, elevationM: 0 },
      { x: -50, z: 0, elevationM: 10 },
      { x: 50, z: 0, elevationM: 10 },
      { x: 100, z: 0, elevationM: 0 },
    ],
  };

  it("turns every authored profile segment into a pitched structural span", () => {
    const segments = elevatedRoadSegmentPlacements(viaduct);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      startElevationM: ELEVATED_DECK_START_M,
      endElevationM: 10,
      deckWidthM: 15.4,
    });
    expect(segments[0].slopeRad).toBeGreaterThan(0);
    expect(segments[1].slopeRad).toBe(0);
    expect(segments[2].slopeRad).toBeLessThan(0);
  });

  it("leaves an at-grade taper open before its slab and parapets begin", () => {
    const rampWithSlip = {
      id: "ramp-with-slip",
      widthM: 5.2,
      centerline: [
        { x: 0, z: 0, elevationM: 0 },
        { x: 0, z: 35, elevationM: 0 },
        { x: 0, z: 100, elevationM: 6 },
      ],
    };
    const segments = elevatedRoadSegmentPlacements(rampWithSlip);
    expect(segments).toHaveLength(1);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].startElevationM).toBe(ELEVATED_DECK_START_M);
    expect(segments[0].center.z).toBeGreaterThan(35);
  });

  it("derives short height-aware barrier OBBs from every rendered edge run", () => {
    const segments = elevatedRoadSegmentPlacements(viaduct);
    const barriers = elevatedRoadBarrierPlacements(viaduct, [viaduct]);
    expect(barriers.length).toBeGreaterThan(segments.length * 2);
    expect(new Set(barriers.map((barrier) => barrier.id)).size).toBe(
      barriers.length,
    );
    for (const barrier of barriers) {
      expect(barrier.lengthM).toBeLessThanOrEqual(
        ELEVATED_ROAD_BARRIER_COLLIDER_MAX_LENGTH_M + 1e-9,
      );
      expect(barrier.halfV).toBeCloseTo(
        ELEVATED_ROAD_PARAPET_DEPTH_M / 2,
        9,
      );
      expect(barrier.minElevationM).toBeLessThan(
        barrier.maxElevationM,
      );
    }

    const flat = barriers.filter((barrier) => barrier.segmentIndex === 1);
    expect(flat.length).toBeGreaterThan(2);
    for (const barrier of flat) {
      expect(Math.abs(barrier.z)).toBeCloseTo(7.5, 9);
      expect(barrier.ux).toBeCloseTo(1, 9);
      expect(barrier.uz).toBeCloseTo(0, 9);
      expect(barrier.minElevationM).toBeCloseTo(
        10 - ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
        9,
      );
      expect(barrier.maxElevationM).toBeCloseTo(
        10 + ELEVATED_ROAD_BARRIER_LEVEL_TOLERANCE_M,
        9,
      );
    }

    const ascending = barriers
      .filter((barrier) => barrier.segmentIndex === 0 && barrier.side === 1)
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    expect(ascending[0].minElevationM).toBeGreaterThan(0);
    expect(ascending.at(-1)?.minElevationM ?? 0).toBeGreaterThan(8);
  });

  it("reports exact pitched-slab headroom only beneath rendered deck", () => {
    const prepared = createElevatedRoadDeckHeadroomQuery([viaduct]);
    const lowRamp = elevatedRoadDeckHeadroomAt(
      { x: -90, z: 0 },
      [viaduct],
    );
    expect(prepared({ x: -90, z: 0 })).toEqual(lowRamp);
    expect(lowRamp).not.toBeNull();
    expect(lowRamp?.deckElevationM).toBeCloseTo(2, 9);
    const slopeCos = 50 / Math.hypot(50, 10);
    expect(lowRamp?.soffitElevationM).toBeCloseTo(
      2 - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M / slopeCos,
      9,
    );
    expect(lowRamp?.headroomM).toBeLessThan(1.5);

    const highSpan = elevatedRoadDeckHeadroomAt(
      { x: 0, z: 0 },
      [viaduct],
      1,
    );
    expect(highSpan).toMatchObject({
      surfaceId: "viaduct",
      segmentIndex: 1,
      deckElevationM: 10,
    });
    expect(highSpan?.soffitElevationM).toBeCloseTo(
      10 - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
      9,
    );
    expect(highSpan?.headroomM).toBeCloseTo(
      9 - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
      9,
    );
    expect(
      elevatedRoadDeckHeadroomAt({ x: 0, z: 8 }, [viaduct]),
    ).toBeNull();
    expect(prepared({ x: 0, z: 8 }, 0, 0.31)?.surfaceId).toBe(
      "viaduct",
    );
    expect(
      prepared({ x: 0, z: 0 }, 10, 0, false),
      "the slab carrying an elevated caller is below it, not overhead",
    ).toBeNull();
  });

  it("closes the raised-asphalt seam before the structural slab begins", () => {
    const structural = createElevatedRoadDeckHeadroomQuery([viaduct]);
    const groundClearance = createElevatedRoadGroundClearanceQuery([viaduct]);

    // The asphalt is already 0.4 m above ground here, but the concrete slab is
    // deliberately clipped until 0.65 m. A ground walker must see the grade.
    expect(structural({ x: -98, z: 0 }, 0, 0.5)).toBeNull();
    expect(groundClearance({ x: -98, z: 0 }, 0, 0.5)).toMatchObject({
      surfaceId: "viaduct",
      segmentIndex: 0,
      obstructionKind: "raised_surface",
      roadSurfaceElevationM: 0.4,
      clearanceM: 0.4,
    });

    // At full height, exact slab soffit remains authoritative and there is
    // ample room for a person beneath the bridge.
    expect(groundClearance({ x: 0, z: 0 }, 0, 0.5)).toMatchObject({
      obstructionKind: "deck",
      roadSurfaceElevationM: 10,
    });
    expect(groundClearance({ x: 0, z: 0 }, 0, 0.5)!.clearanceM).toBeCloseTo(
      10 - ELEVATED_ROAD_DECK_SLAB_THICKNESS_M,
      9,
    );
  });

  it("rejects Cairo's exact west and east landing apron intrusions", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const structural = createElevatedRoadDeckHeadroomQuery(surfaces);
    const groundClearance = createElevatedRoadGroundClearanceQuery(surfaces);
    const apronPoints = [
      { x: -798.87, z: 318.44 },
      { x: 703.77, z: 163.26 },
    ];
    for (const point of apronPoints) {
      expect(structural(point, 0, 0.5), `${point.x},${point.z} slab`).toBeNull();
      const obstruction = groundClearance(point, 0, 0.5);
      expect(obstruction, `${point.x},${point.z} grade`).not.toBeNull();
      expect(obstruction!.obstructionKind).toBe("raised_surface");
      expect(obstruction!.clearanceM).toBeGreaterThan(0.3);
      expect(obstruction!.clearanceM).toBeLessThan(0.65);
    }
  });

  it("reports a support footing as zero headroom with caller footprint inflation", () => {
    const pier = elevatedRoadPierPlacements(viaduct, [viaduct])[0];
    expect(pier).toBeDefined();
    if (!pier) return;
    const query = createElevatedRoadDeckHeadroomQuery([viaduct]);
    expect(query(pier.position)).toMatchObject({
      surfaceId: viaduct.id,
      structureKind: "pier",
      supportIndex: pier.index,
      headroomM: 0,
    });
    expect(
      query(
        {
          x: pier.position.x + ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M + 0.45,
          z: pier.position.z,
        },
        0,
        0.5,
      )?.structureKind,
    ).toBe("pier");
    expect(
      query(pier.position, 0, 0, false)?.structureKind,
      "camera ceiling queries can intentionally ignore vertical supports",
    ).not.toBe("pier");
  });

  it("opens only the joining side of a mainline and both sides of its ramp", () => {
    const mainline = {
      id: "mainline",
      widthM: 14,
      centerline: [
        { x: -50, z: 0, elevationM: 10 },
        { x: 0, z: 0, elevationM: 10 },
        { x: 50, z: 0, elevationM: 10 },
      ],
    };
    const ramp = {
      id: "ramp",
      widthM: 7.6,
      centerline: [
        { x: 0, z: -40, elevationM: 6 },
        { x: 0, z: 0, elevationM: 10 },
      ],
    };
    const surfaces = [mainline, ramp];
    const mainlineSegments = elevatedRoadSegmentPlacements(mainline);
    for (const segment of mainlineSegments) {
      const runs = elevatedRoadEdgeRuns(mainline, segment, surfaces);
      const joiningSide = runs.find((run) => run.side === -1)!;
      const outside = runs.find((run) => run.side === 1)!;
      expect(
        Math.max(joiningSide.startTrimM, joiningSide.endTrimM),
      ).toBeCloseTo(ramp.widthM / 2 + 0.8);
      expect(outside.startTrimM + outside.endTrimM).toBe(0);
    }

    const rampSegment = elevatedRoadSegmentPlacements(ramp)[0];
    const rampRuns = elevatedRoadEdgeRuns(ramp, rampSegment, surfaces);
    expect(rampRuns).toHaveLength(2);
    for (const run of rampRuns) {
      // The ramp is pitched, so a 7.8 m opening in plan is slightly longer
      // along the physical concrete edge.
      expect(run.endTrimM).toBeCloseTo(
        (mainline.widthM / 2 + 0.8) * Math.hypot(40, 4) / 40,
      );
    }

    // This point is in the mainline's concrete overhang beside the merge,
    // where its parapet edge run is deliberately open. The retained slab is
    // still overhead, so headroom must not depend on the parapet run.
    const headroom = createElevatedRoadDeckHeadroomQuery(surfaces)({
      x: -1,
      z: -7.4,
    });
    expect(headroom?.surfaceId).toBe("mainline");
    expect(headroom?.deckElevationM).toBeCloseTo(10, 9);
  });

  it("cuts an oblique branch slab and parapets back to the mainline edge", () => {
    const mainline = {
      id: "mainline",
      widthM: 14,
      centerline: [
        { x: -50, z: 0, elevationM: 10 },
        { x: 0, z: 0, elevationM: 10 },
        { x: 50, z: 0, elevationM: 10 },
      ],
    };
    const branch = {
      id: "oblique-branch",
      widthM: 7.6,
      centerline: [
        { x: 0, z: 0, elevationM: 10 },
        { x: 24, z: -40, elevationM: 6 },
      ],
    };
    const surfaces = [mainline, branch];
    const segment = elevatedRoadSegmentPlacements(branch)[0];
    const deck = elevatedRoadDeckRun(branch, segment, surfaces)!;
    const edges = elevatedRoadEdgeRuns(branch, segment, surfaces);

    expect(deck.startTrimM).toBeGreaterThan(10);
    expect(edges).toHaveLength(2);
    expect(Math.max(...edges.map((run) => run.startTrimM))).toBeGreaterThan(10);
    expect(Math.min(...edges.map((run) => run.startTrimM))).toBeGreaterThan(5);
  });

  it("opens every Cairo ramp-to-mainline merge instead of walling it off", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces;
    const mainline = surfaces.find(
      (surface) => surface.id === "cairo-sixth-october-bridge",
    )!;
    const branchIds = [
      "cairo-sixth-october-bridge-dokki-ramp",
      "cairo-sixth-october-bridge-gezira-ramp",
      "cairo-sixth-october-bridge-corniche-entry",
      "cairo-sixth-october-bridge-corniche-exit",
      "cairo-sixth-october-bridge-ramses-ramp",
    ] as const;

    for (const branchId of branchIds) {
      const branch = surfaces.find((surface) => surface.id === branchId)!;
      const sharedPoint = branch.centerline.find((branchPoint) =>
        mainline.centerline.some(
          (mainlinePoint) =>
            Math.hypot(
              branchPoint.x - mainlinePoint.x,
              branchPoint.z - mainlinePoint.z,
            ) < 0.05 &&
            Math.abs(
              (branchPoint.elevationM ?? 0) -
                (mainlinePoint.elevationM ?? 0),
            ) < 0.05,
        ),
      )!;
      expect(sharedPoint, branchId).toBeDefined();
      const isSharedPoint = (point: (typeof surfaces)[number]["centerline"][number]) =>
        Math.hypot(point.x - sharedPoint.x, point.z - sharedPoint.z) < 0.05 &&
        Math.abs(
          (point.elevationM ?? 0) - (sharedPoint.elevationM ?? 0),
        ) < 0.05;
      const sharedIndex = branch.centerline.findIndex(isSharedPoint);
      const throatNeighbour = branch.centerline[
        sharedIndex === 0 ? 1 : sharedIndex - 1
      ];
      expect(
        throatNeighbour.elevationM,
        `${branchId} reaches full height before the mainline footprint`,
      ).toBeCloseTo(sharedPoint.elevationM ?? 0, 3);

      const adjoiningBranchSegment = elevatedRoadSegmentPlacements(branch).find(
        (segment) => {
          const start = branch.centerline[segment.segmentIndex];
          const end = branch.centerline[segment.segmentIndex + 1];
          return isSharedPoint(start) || isSharedPoint(end);
        },
      )!;
      const branchRuns = elevatedRoadEdgeRuns(
        branch,
        adjoiningBranchSegment,
        surfaces,
      );
      expect(branchRuns, branchId).toHaveLength(2);
      for (const run of branchRuns) {
        expect(
          Math.max(run.startTrimM, run.endTrimM),
          `${branchId} side ${run.side}`,
        ).toBeGreaterThan(3.5);
      }
      const branchDeck = elevatedRoadDeckRun(
        branch,
        adjoiningBranchSegment,
        surfaces,
      );
      expect(branchDeck, `${branchId} deck cutback`).not.toBeNull();
      expect(
        branchDeck?.lengthM ?? 0,
        `${branchId} retains a usable full-height merge throat`,
      ).toBeGreaterThan(0.35);
      expect(
        Math.max(
          branchDeck?.startTrimM ?? 0,
          branchDeck?.endTrimM ?? 0,
        ),
        `${branchId} slab reaches the mainline edge`,
      ).toBeGreaterThan(mainline.widthM / 2 + 0.7);

      const adjoiningMainlineSegments = elevatedRoadSegmentPlacements(
        mainline,
      ).filter((segment) => {
        const start = mainline.centerline[segment.segmentIndex];
        const end = mainline.centerline[segment.segmentIndex + 1];
        return isSharedPoint(start) || isSharedPoint(end);
      });
      expect(adjoiningMainlineSegments.length, branchId).toBeGreaterThan(0);
      for (const segment of adjoiningMainlineSegments) {
        const runs = elevatedRoadEdgeRuns(mainline, segment, surfaces);
        expect(
          Math.max(
            ...runs.map((run) =>
              Math.max(run.startTrimM, run.endTrimM),
            ),
          ),
          `${branchId} mainline opening`,
        ).toBeGreaterThan(branch.widthM / 2 + 0.6);
      }
    }
  });

  it("omits hammerhead columns where an at-grade carriageway passes below", () => {
    const open = elevatedRoadPierPlacements(viaduct, [viaduct], 25);
    const crossing = {
      id: "ground-crossing",
      widthM: 12,
      centerline: [
        { x: 0, z: -40 },
        { x: 0, z: 40 },
      ],
    };
    const protectedPiers = elevatedRoadPierPlacements(
      viaduct,
      [viaduct, crossing],
      25,
    );
    expect(open.length).toBeGreaterThan(protectedPiers.length);
    expect(
      protectedPiers.every(
        (pier) => Math.hypot(pier.position.x, pier.position.z) > 8.2,
      ),
    ).toBe(true);
  });

  it("keeps footings out of an adjacent road's full pavement envelope", () => {
    const pavement = {
      id: "ground-parallel",
      widthM: 9.6,
      sidewalkWidthM: 3.4,
      centerline: [
        { x: -120, z: 9.3 },
        { x: 120, z: 9.3 },
      ],
    };
    const open = elevatedRoadPierPlacements(viaduct, [viaduct], 25);
    const protectedPiers = elevatedRoadPierPlacements(
      viaduct,
      [viaduct, pavement],
      25,
    );
    expect(open.length).toBeGreaterThan(protectedPiers.length);
  });

  it("keeps every Cairo footing outside every other road and pavement", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces;
    for (const surface of surfaces) {
      for (const pier of elevatedRoadPierPlacements(surface, surfaces)) {
        for (const other of surfaces) {
          if (other.id === surface.id) continue;
          const roadsideEnvelopeM = isElevatedRoadSurface(other)
            ? ELEVATED_ROAD_DECK_OVERHANG_M
            : Math.max(0, other.sidewalkWidthM ?? 2.2);
          const requiredM =
            other.widthM / 2 +
            roadsideEnvelopeM +
            ELEVATED_ROAD_PIER_FOOTPRINT_RADIUS_M +
            ELEVATED_ROAD_PIER_ROADSIDE_MARGIN_M;
          expect(
            distanceToPolylineM(pier.position, other.centerline),
            `${pier.surfaceId} pier ${pier.index} clips ${other.id}`,
          ).toBeGreaterThanOrEqual(requiredM - 1e-9);
        }
      }
    }
  });
});
