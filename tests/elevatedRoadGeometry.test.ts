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
  elevatedRoadEndpointHasStructuralContinuation,
  elevatedRoadJunctionEnvelopes,
  elevatedRoadJunctionSurfaceElevationAt,
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

    const cairoDepth = 0.36;
    const cairoBarriers = elevatedRoadBarrierPlacements(
      { ...viaduct, id: "cairo-profile", parapetDepthM: cairoDepth },
      [{ ...viaduct, id: "cairo-profile", parapetDepthM: cairoDepth }],
    );
    expect(cairoBarriers.length).toBe(barriers.length);
    expect(
      cairoBarriers.every((barrier) =>
        Math.abs(barrier.halfV - cairoDepth / 2) < 1e-9,
      ),
    ).toBe(true);
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

  it("keeps clearance broadphase queries exact across grid-cell boundaries", () => {
    const apronAcrossBoundary = {
      id: "apron-across-boundary",
      widthM: 4,
      centerline: [
        { x: 34.1, z: -10, elevationM: 0.4 },
        { x: 34.1, z: 10, elevationM: 0.4 },
      ],
    };
    const clearanceAt = createElevatedRoadGroundClearanceQuery([
      apronAcrossBoundary,
      {
        id: "distant-apron-west",
        widthM: 4,
        centerline: [
          { x: -200, z: -10, elevationM: 0.4 },
          { x: -200, z: 10, elevationM: 0.4 },
        ],
      },
      {
        id: "distant-apron-east",
        widthM: 4,
        centerline: [
          { x: 200, z: -10, elevationM: 0.4 },
          { x: 200, z: 10, elevationM: 0.4 },
        ],
      },
    ]);

    // The road footprint begins at x=32.1, in the next 32 m grid cell. The
    // caller remains in the previous cell but its circular body reaches it.
    expect(clearanceAt({ x: 31.79, z: 5 }, 0, 0.32)).toMatchObject({
      surfaceId: apronAcrossBoundary.id,
      obstructionKind: "raised_surface",
      clearanceM: 0.4,
    });
    expect(clearanceAt({ x: 31.79, z: 5 }, 0, 0.3)).toBeNull();
    expect(
      clearanceAt(
        { x: 31.79, z: 5 },
        0,
        0.32,
        true,
        new Set([apronAcrossBoundary.id]),
      ),
    ).toBeNull();
    // Huge one-off placement envelopes fall back to the complete exact scan
    // instead of walking thousands of empty grid cells.
    expect(clearanceAt({ x: -1_000, z: 5 }, 0, 1_033)).toMatchObject({
      surfaceId: apronAcrossBoundary.id,
    });
  });

  it("preserves authored deck ties while indexing radius-crossing candidates", () => {
    const firstDeck = {
      id: "first-boundary-deck",
      widthM: 4,
      centerline: [
        { x: 34.8, z: -10, elevationM: 4 },
        { x: 34.8, z: 10, elevationM: 4 },
      ],
    };
    const secondDeck = { ...firstDeck, id: "second-boundary-deck" };
    const distantDeck = {
      ...firstDeck,
      id: "distant-boundary-deck",
      centerline: firstDeck.centerline.map((point) => ({
        ...point,
        x: 200,
      })),
    };
    const headroomAt = createElevatedRoadDeckHeadroomQuery([
      firstDeck,
      secondDeck,
      distantDeck,
    ]);

    expect(headroomAt({ x: 31.79, z: 5 }, 0, 0.32, false)).toMatchObject({
      surfaceId: firstDeck.id,
      structureKind: "deck",
    });
    expect(
      headroomAt(
        { x: 31.79, z: 5 },
        0,
        0.32,
        false,
        new Set([firstDeck.id]),
      ),
    ).toMatchObject({ surfaceId: secondDeck.id });
  });

  it("finds a support whose footing is reached across a grid boundary", () => {
    const supportSpan = (id: string, x: number) => ({
      id,
      widthM: 0.2,
      centerline: [
        { x, z: -45, elevationM: 7 },
        { x, z: 55, elevationM: 7 },
      ],
    });
    const target = supportSpan("boundary-support", 33.625);
    const headroomAt = createElevatedRoadDeckHeadroomQuery([
      target,
      supportSpan("distant-support-west", -200),
      supportSpan("distant-support-east", 200),
    ]);

    expect(headroomAt({ x: 31.99, z: 5 }, 0, 0.32)).toMatchObject({
      surfaceId: target.id,
      structureKind: "pier",
      headroomM: 0,
    });
    expect(headroomAt({ x: 31.99, z: 5 }, 0, 0.3)).toBeNull();
  });

  it("rejects Cairo's exact west and east landing apron intrusions", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces ?? [];
    const structural = createElevatedRoadDeckHeadroomQuery(surfaces);
    const groundClearance = createElevatedRoadGroundClearanceQuery(surfaces);
    const apronPoints = [
      "cairo-sixth-october-bridge-west-entry",
      "cairo-sixth-october-bridge-east-entry",
    ].map((surfaceId) => {
      const surface = surfaces.find((candidate) => candidate.id === surfaceId)!;
      const targetElevationM = 0.4;
      for (
        let index = 0;
        index + 1 < surface.centerline.length;
        index += 1
      ) {
        const start = surface.centerline[index];
        const end = surface.centerline[index + 1];
        const startElevationM = start.elevationM ?? 0;
        const endElevationM = end.elevationM ?? 0;
        if (
          targetElevationM < Math.min(startElevationM, endElevationM) ||
          targetElevationM > Math.max(startElevationM, endElevationM) ||
          startElevationM === endElevationM
        ) {
          continue;
        }
        const amount =
          (targetElevationM - startElevationM) /
          (endElevationM - startElevationM);
        return {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        };
      }
      throw new Error(`${surfaceId} has no 0.4 m landing apron`);
    });
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

  it("wraps a three-arm mainline junction in one gradual collar", () => {
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
    const [collar] = elevatedRoadJunctionEnvelopes(surfaces);
    expect(collar).toBeDefined();
    expect(collar.arms).toHaveLength(3);
    expect(collar.barrierGuardRuns.length).toBeGreaterThan(2);
    const rampArm = collar.arms.find((arm) => arm.surfaceId === ramp.id)!;
    const rampThroat = rampArm.sections[0];
    expect(
      Math.min(
        rampThroat.positiveHalfWidthM,
        rampThroat.negativeHalfWidthM,
      ),
      "the merge keeps its inner edge at the authored ramp width",
    ).toBeCloseTo(ramp.widthM / 2, 9);
    expect(
      Math.max(
        rampThroat.positiveHalfWidthM,
        rampThroat.negativeHalfWidthM,
      ),
      "only the outside edge fans toward the mainline parapet",
    ).toBeGreaterThan(mainline.widthM / 2);

    const mainlineSegments = elevatedRoadSegmentPlacements(mainline);
    for (const segment of mainlineSegments) {
      const runs = elevatedRoadEdgeRuns(mainline, segment, surfaces);
      expect(runs).toHaveLength(2);
      expect(
        runs.every(
          (run) =>
            Math.max(run.startTrimM, run.endTrimM) >= collar.arms[0].reachM,
        ),
        "the collar replaces both square mainline ends through its full taper",
      ).toBe(true);
    }

    const rampSegment = elevatedRoadSegmentPlacements(ramp)[0];
    const rampRuns = elevatedRoadEdgeRuns(ramp, rampSegment, surfaces);
    expect(rampRuns).toHaveLength(2);
    for (const run of rampRuns) {
      // The ramp is pitched, so the plan taper projects slightly longer along
      // the physical concrete edge.
      expect(run.endTrimM).toBeCloseTo(
        rampArm.reachM * Math.hypot(40, 4) / 40,
      );
    }

    // This point is in the shared paved mouth where the mainline parapet is
    // deliberately open. The descending branch slab is the lower physical
    // obstruction, so headroom must see it rather than depend on a parapet.
    const headroom = createElevatedRoadDeckHeadroomQuery(surfaces)({
      x: -1,
      z: -7.4,
    });
    expect(headroom?.surfaceId).toBe("ramp");
    expect(headroom?.deckElevationM).toBeCloseTo(9.26, 9);
  });

  it("supports an oblique merge completely while opening both parapets", () => {
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
    const [collar] = elevatedRoadJunctionEnvelopes(surfaces);
    const segment = elevatedRoadSegmentPlacements(branch)[0];
    const deck = elevatedRoadDeckRun(branch, segment, surfaces)!;
    const edges = elevatedRoadEdgeRuns(branch, segment, surfaces);

    expect(deck.startTrimM).toBe(0);
    expect(
      deck.centerAlongM - deck.lengthM / 2,
      "the branch slab overlaps beneath the wider carrier",
    ).toBeCloseTo(-segment.lengthM / 2 - 0.175, 9);
    expect(edges).toHaveLength(2);
    expect(Math.max(...edges.map((run) => run.startTrimM))).toBeGreaterThan(10);
    expect(Math.min(...edges.map((run) => run.startTrimM))).toBeGreaterThan(5);

    const deckAt = createElevatedRoadDeckHeadroomQuery(surfaces);
    const branchLengthM = Math.hypot(24, 40);
    const normal = { x: 40 / branchLengthM, z: 24 / branchLengthM };
    for (const amount of [0.01, 0.04, 0.08, 0.12, 0.16, 0.2]) {
      for (const lateralM of [-3.75, 0, 3.75]) {
        const expectedElevationM = 10 - amount * 4;
        const supportingDeck = deckAt({
          x: amount * 24 + normal.x * lateralM,
          z: -amount * 40 + normal.z * lateralM,
        });
        expect(
          supportingDeck,
          `branch deck support at ${amount}:${lateralM}`,
        ).toBeDefined();
        const collarElevationM = elevatedRoadJunctionSurfaceElevationAt(
          collar.deckMesh,
          {
            x: amount * 24 + normal.x * lateralM,
            z: -amount * 40 + normal.z * lateralM,
          },
        );
        const expectedPhysicalElevationM = Math.min(
          expectedElevationM,
          collarElevationM ?? Number.POSITIVE_INFINITY,
        );
        expect(supportingDeck!.deckElevationM).toBeCloseTo(
          expectedPhysicalElevationM,
          9,
        );
        expect(supportingDeck!.segmentIndex).toBe(
          collarElevationM !== undefined &&
            collarElevationM < expectedElevationM - 1e-6
            ? -1
            : 0,
        );
      }
    }

    for (const carrierSegment of elevatedRoadSegmentPlacements(mainline)) {
      const carrierDeck = elevatedRoadDeckRun(
        mainline,
        carrierSegment,
        surfaces,
      )!;
      const sharedExtensionM =
        carrierSegment.segmentIndex === 0
          ? carrierDeck.centerAlongM +
            carrierDeck.lengthM / 2 -
            carrierSegment.lengthM / 2
          : -carrierSegment.lengthM / 2 -
            (carrierDeck.centerAlongM - carrierDeck.lengthM / 2);
      expect(sharedExtensionM).toBeCloseTo(0.175, 9);
      expect(sharedExtensionM).toBeLessThanOrEqual(0.2);
    }
  });

  it("joins both parapet sides at the exact miter of a same-surface bend", () => {
    const bent = {
      id: "bent-ramp",
      widthM: 7.6,
      centerline: [
        { x: -40, z: 0, elevationM: 7 },
        { x: 0, z: 0, elevationM: 7 },
        { x: 24, z: 32, elevationM: 7 },
      ],
    };
    const segments = elevatedRoadSegmentPlacements(bent);
    const incoming = elevatedRoadEdgeRuns(bent, segments[0], [bent]);
    const outgoing = elevatedRoadEdgeRuns(bent, segments[1], [bent]);
    const incomingBySide = new Map(
      incoming.map((run) => [run.side, run.endTrimM]),
    );
    const outgoingBySide = new Map(
      outgoing.map((run) => [run.side, run.startTrimM]),
    );

    expect(incomingBySide.get(-1)).toBeLessThan(0);
    expect(incomingBySide.get(1)).toBeGreaterThan(0);
    expect(outgoingBySide.get(-1)).toBeCloseTo(incomingBySide.get(-1)!, 9);
    expect(outgoingBySide.get(1)).toBeCloseTo(incomingBySide.get(1)!, 9);
    expect(
      Math.abs(incomingBySide.get(-1)!),
      "the outside run extends by the same miter distance",
    ).toBeCloseTo(incomingBySide.get(1)!, 9);
  });

  it("opens both sides of a narrower near-collinear continuation", () => {
    const wide = {
      id: "wide-stem",
      widthM: 7.6,
      centerline: [
        { x: 0, z: -40, elevationM: 7 },
        { x: 0, z: 0, elevationM: 7 },
      ],
    };
    const narrow = {
      id: "narrow-branch",
      widthM: 4.2,
      centerline: [
        { x: 0, z: 0, elevationM: 7 },
        { x: 2.5, z: 40, elevationM: 7 },
      ],
    };
    const surfaces = [wide, narrow];
    const narrowSegment = elevatedRoadSegmentPlacements(narrow)[0];
    const narrowRuns = elevatedRoadEdgeRuns(
      narrow,
      narrowSegment,
      surfaces,
    );
    const wideRuns = elevatedRoadEdgeRuns(
      wide,
      elevatedRoadSegmentPlacements(wide)[0],
      surfaces,
    );

    expect(narrowRuns).toHaveLength(2);
    expect(
      narrowRuns.every((run) => run.startTrimM > wide.widthM / 2),
    ).toBe(true);
    expect(
      wideRuns.every((run) => run.endTrimM > narrow.widthM / 2),
      "the collar owns both sides of the wide stem while it eases inward",
    ).toBe(true);
    const [collar] = elevatedRoadJunctionEnvelopes(surfaces);
    const narrowArm = collar.arms.find((arm) => arm.surfaceId === narrow.id)!;
    expect(narrowArm.sections[0].halfWidthM).toBeGreaterThan(
      narrow.widthM / 2,
    );
    expect(narrowArm.sections.at(-1)!.halfWidthM).toBeCloseTo(
      narrow.widthM / 2,
      9,
    );
    expect(
      narrowArm.sections.every(
        (section, index) =>
          index === 0 ||
          section.halfWidthM <= narrowArm.sections[index - 1].halfWidthM + 1e-9,
      ),
      "the narrowed side eases monotonically instead of stepping inward",
    ).toBe(true);
    const narrowDeck = elevatedRoadDeckRun(
      narrow,
      narrowSegment,
      surfaces,
    )!;
    expect(narrowDeck.startTrimM).toBe(0);
    expect(
      narrowDeck.centerAlongM - narrowDeck.lengthM / 2,
    ).toBeCloseTo(
      -narrowSegment.lengthM / 2 - 0.175,
      9,
    );
  });

  it("recognizes an offset shoulder join only at an authored carrier knot", () => {
    const carrier = {
      id: "offset-join-carrier",
      widthM: 14,
      centerline: [
        { x: -60, z: 0, elevationM: 10 },
        { x: 0, z: 0, elevationM: 10 },
        { x: 60, z: 0, elevationM: 10 },
      ],
    };
    const branchAtKnot = {
      id: "offset-branch-at-knot",
      widthM: 5.8,
      centerline: [
        { x: 0, z: 5.25, elevationM: 10 },
        { x: 0, z: 30, elevationM: 10 },
      ],
    };
    const branchBetweenKnots = {
      id: "offset-branch-between-knots",
      widthM: 5.8,
      centerline: [
        { x: 30, z: 5.25, elevationM: 10 },
        { x: 30, z: 30, elevationM: 10 },
      ],
    };
    const atKnotSegment = elevatedRoadSegmentPlacements(branchAtKnot)[0];
    const betweenKnotsSegment = elevatedRoadSegmentPlacements(
      branchBetweenKnots,
    )[0];

    expect(
      elevatedRoadEndpointHasStructuralContinuation(
        branchAtKnot,
        atKnotSegment,
        [carrier, branchAtKnot],
        "start",
      ),
      "the collar builder can own an outer-lane join at a carrier knot",
    ).toBe(true);
    expect(
      elevatedRoadEndpointHasStructuralContinuation(
        branchBetweenKnots,
        betweenKnotsSegment,
        [carrier, branchBetweenKnots],
        "start",
      ),
      "mere footprint overlap cannot suppress a terminal deck face",
    ).toBe(false);
  });

  it("keeps a tangent branch open until both parapets clear its wider carrier", () => {
    const carrier = {
      id: "tangent-carrier",
      widthM: 14,
      centerline: [
        { x: -60, z: 0, elevationM: 10 },
        { x: 0, z: 0, elevationM: 10 },
        { x: 60, z: 0, elevationM: 10 },
      ],
    };
    const branch = {
      id: "tangent-branch",
      widthM: 7.6,
      centerline: [
        { x: 0, z: 0, elevationM: 10 },
        { x: -5, z: 0.1, elevationM: 10 },
        { x: -10, z: 0.5, elevationM: 10 },
        { x: -15, z: 1.5, elevationM: 10 },
        { x: -20, z: 3.5, elevationM: 10 },
        { x: -25, z: 7, elevationM: 10 },
        { x: -30, z: 12, elevationM: 10 },
        { x: -35, z: 18, elevationM: 10 },
      ],
    };
    const surfaces = [carrier, branch];
    const segments = elevatedRoadSegmentPlacements(branch);

    expect(
      segments
        .slice(0, 3)
        .every(
          (segment) =>
            elevatedRoadEdgeRuns(branch, segment, surfaces).length === 0,
        ),
      "no detached miter chips remain inside the carrier",
    ).toBe(true);
    expect(
      elevatedRoadEdgeRuns(branch, segments.at(-1)!, surfaces),
      "both sides return after the branch has peeled away",
    ).toHaveLength(2);

    for (const barrier of elevatedRoadBarrierPlacements(
      branch,
      surfaces,
      100,
    )) {
      const projectedHalfDepthM =
        Math.abs(barrier.uz) * barrier.halfU +
        Math.abs(barrier.ux) * barrier.halfV;
      expect(
        Math.abs(barrier.z) - projectedHalfDepthM,
        `segment ${barrier.segmentIndex} side ${barrier.side}`,
      ).toBeGreaterThanOrEqual(carrier.widthM / 2 + 0.05 - 0.001);
    }
  });

  it("opens both equal-width branches through their common wider carrier", () => {
    const carrier = {
      id: "paired-branch-carrier",
      widthM: 7.6,
      centerline: [
        { x: 0, z: -30, elevationM: 7 },
        { x: 0, z: 0, elevationM: 7 },
      ],
    };
    const left = {
      id: "paired-left-branch",
      widthM: 4.2,
      centerline: [
        { x: 0, z: 0, elevationM: 7 },
        { x: -6, z: 20, elevationM: 7 },
        { x: -18, z: 40, elevationM: 7 },
      ],
    };
    const right = {
      id: "paired-right-branch",
      widthM: 4.2,
      centerline: [
        { x: 0, z: 0, elevationM: 7 },
        { x: 6, z: 20, elevationM: 7 },
        { x: 18, z: 40, elevationM: 7 },
      ],
    };
    const surfaces = [carrier, left, right];
    const [collar] = elevatedRoadJunctionEnvelopes(surfaces);
    const branchReachesM: number[] = [];

    for (const branch of [left, right]) {
      const firstSegment = elevatedRoadSegmentPlacements(branch)[0];
      const runs = elevatedRoadEdgeRuns(branch, firstSegment, surfaces);
      expect(
        runs,
        `${branch.id} leaves its shared first chord entirely to the collar`,
      ).toHaveLength(0);
      const branchArm = collar.arms.find(
        (arm) => arm.surfaceId === branch.id,
      )!;
      const firstCoverage = branchArm.coverages.find(
        (coverage) => coverage.segmentIndex === firstSegment.segmentIndex,
      )!;
      expect(
        firstCoverage.planLengthM,
        `${branch.id} collar coverage owns the complete first chord`,
      ).toBeCloseTo(firstSegment.lengthM, 9);
      const continuationSegment = elevatedRoadSegmentPlacements(branch).at(-1)!;
      const continuationRuns = elevatedRoadEdgeRuns(
        branch,
        continuationSegment,
        surfaces,
      );
      expect(
        continuationRuns,
        `${branch.id} restores both ordinary rails after the shared fan`,
      ).toHaveLength(2);
      const continuationCoverage = branchArm.coverages.find(
        (coverage) =>
          coverage.segmentIndex === continuationSegment.segmentIndex,
      )!;
      expect(continuationCoverage.planLengthM).toBeGreaterThan(0);
      expect(
        continuationRuns.every(
          (run) =>
            Math.abs(run.startTrimM - continuationCoverage.planLengthM) <
            1e-9,
        ),
        `${branch.id} ordinary rails begin exactly where collar coverage ends`,
      ).toBe(true);
      expect(
        branchArm.coverages.reduce(
          (totalM, coverage) => totalM + coverage.planLengthM,
          0,
        ),
      ).toBeCloseTo(branchArm.reachM, 9);
      branchReachesM.push(branchArm.reachM);

      const deck = elevatedRoadDeckRun(branch, firstSegment, surfaces)!;
      expect(deck.startTrimM).toBe(0);
      expect(
        deck.centerAlongM - deck.lengthM / 2,
        `${branch.id} retains the watertight junction lap`,
      ).toBeCloseTo(-firstSegment.lengthM / 2 - 0.175, 9);
    }

    expect(branchReachesM[0]).toBeCloseTo(branchReachesM[1], 9);
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
      const finalThroatPlanM = Math.hypot(
        throatNeighbour.x - sharedPoint.x,
        throatNeighbour.z - sharedPoint.z,
      );
      const finalThroatGrade =
        Math.abs(
          (throatNeighbour.elevationM ?? 0) -
            (sharedPoint.elevationM ?? 0),
        ) / finalThroatPlanM;
      expect(
        finalThroatGrade,
        `${branchId} reaches the mainline at a continuous road-grade seam`,
      ).toBeLessThanOrEqual(0.1 + 1e-6);

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
      // A sampled curve may consume its complete first chord while it is
      // still inside the mainline corridor. Any retained run must start
      // beyond the shared mouth; the following chord restores both sides.
      for (const run of branchRuns) {
        const sharedTrimM =
          sharedIndex === 0 ? run.startTrimM : run.endTrimM;
        expect(
          sharedTrimM,
          `${branchId} side ${run.side}`,
        ).toBeGreaterThan(3.5);
      }
      const branchSegments = elevatedRoadSegmentPlacements(branch);
      const adjoiningIndex = branchSegments.indexOf(adjoiningBranchSegment);
      const awayFromMouth =
        sharedIndex === 0
          ? branchSegments.slice(adjoiningIndex + 1)
          : branchSegments.slice(0, adjoiningIndex).reverse();
      const protectedNeighbour = awayFromMouth.find(
        (candidate) =>
          elevatedRoadEdgeRuns(branch, candidate, surfaces).length === 2,
      );
      expect(protectedNeighbour, `${branchId} protected throat edge`).toBeDefined();
      expect(
        elevatedRoadEdgeRuns(branch, protectedNeighbour!, surfaces),
        `${branchId} restores both parapets after the open merge mouth`,
      ).toHaveLength(2);

      const adjoiningMainlineSegments = elevatedRoadSegmentPlacements(
        mainline,
      ).filter((segment) => {
        const start = mainline.centerline[segment.segmentIndex];
        const end = mainline.centerline[segment.segmentIndex + 1];
        return isSharedPoint(start) || isSharedPoint(end);
      });
      expect(adjoiningMainlineSegments.length, branchId).toBeGreaterThan(0);
      let openedMainlineSide = false;
      for (const segment of adjoiningMainlineSegments) {
        const runs = elevatedRoadEdgeRuns(mainline, segment, surfaces);
        const sharedAtStart = isSharedPoint(
          mainline.centerline[segment.segmentIndex],
        );
        openedMainlineSide ||=
          runs.length < 2 ||
          runs.some((run) =>
            (sharedAtStart ? run.startTrimM : run.endTrimM) > 0.01,
          );
      }
      expect(openedMainlineSide, `${branchId} mainline opening`).toBe(true);
    }
  });

  it("keeps both terminal carrier joins open and level through the mainline throat", () => {
    const surfaces = CAIRO_MAP_PACK.geometry.roadSurfaces;
    const mainline = surfaces.find(
      (surface) => surface.id === "cairo-sixth-october-bridge",
    )!;
    const terminalIds = [
      "cairo-sixth-october-bridge-west-ramp",
      "cairo-sixth-october-bridge-east-ramp",
    ] as const;

    for (const terminalId of terminalIds) {
      const carrier = surfaces.find((surface) => surface.id === terminalId)!;
      const shared = carrier.centerline[0];
      const mainlinePointIndex = mainline.centerline.findIndex(
        (point) =>
          Math.hypot(point.x - shared.x, point.z - shared.z) < 0.05 &&
          Math.abs((point.elevationM ?? 0) - (shared.elevationM ?? 0)) < 0.05,
      );
      expect(mainlinePointIndex, terminalId).toBeGreaterThanOrEqual(0);
      expect(
        carrier.centerline[1].elevationM,
        `${terminalId} stays level beyond the four-lane footprint`,
      ).toBeCloseTo(shared.elevationM ?? 0, 3);

      const carrierSegment = elevatedRoadSegmentPlacements(carrier)[0];
      const carrierRuns = elevatedRoadEdgeRuns(
        carrier,
        carrierSegment,
        surfaces,
      );
      expect(
        carrierRuns.every(
          (run) => run.startTrimM > mainline.widthM / 2,
        ),
        `${terminalId} parapets clear the mainline fan/funnel`,
      ).toBe(true);
      const protectedCarrierSegment = elevatedRoadSegmentPlacements(carrier)
        .slice(1)
        .find(
          (candidate) =>
            elevatedRoadEdgeRuns(carrier, candidate, surfaces).length === 2,
        );
      expect(
        protectedCarrierSegment,
        `${terminalId} restores both parapets beyond the merge mouth`,
      ).toBeDefined();
      expect(
        elevatedRoadDeckRun(carrier, carrierSegment, surfaces)?.startTrimM,
        `${terminalId} asphalt remains continuous`,
      ).toBe(0);

      const mainlineSegmentIndex =
        mainlinePointIndex === 0
          ? 0
          : mainlinePointIndex - 1;
      const mainlineSegment = elevatedRoadSegmentPlacements(mainline).find(
        (segment) => segment.segmentIndex === mainlineSegmentIndex,
      )!;
      const mainlineRuns = elevatedRoadEdgeRuns(
        mainline,
        mainlineSegment,
        surfaces,
      );
      const sharedTrim = (run: (typeof mainlineRuns)[number]) =>
        mainlinePointIndex === 0 ? run.startTrimM : run.endTrimM;
      expect(
        mainlineRuns.every((run) => sharedTrim(run) === 0),
        `${terminalId} does not cut a side opening into the mainline end`,
      ).toBe(true);
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
