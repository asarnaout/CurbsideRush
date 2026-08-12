import { describe, expect, it } from "vitest";
import {
  ALL_RAY_FAILURE_CLASSES,
  AUDIT_ERROR_CLASSES,
  CONTENT_GAP_CLASSES,
  QUALIFYING_BLOB_AREA_M2,
  SPATIAL_INDEX_CELL_SIZE_M,
  SpatialIndex,
  bareKerbRuns,
  BARE_KERB_RUN_LIMIT_M,
  buildFailureId,
  buildGroundRaster,
  buildOccluderIndex,
  classifySightline,
  eyeInsideOpaqueOccluder,
  groundSurfaceCrossings,
  nearestOccluderHit,
  selectVisibleGroundSurface,
  auditMapVisualGaps,
  distanceToWorldBoundaryAlongRay,
  fanAzimuthOffsetsDeg,
  roadStations,
  ROAD_STATION_STEP_M,
  DEFAULT_AUDIT_CAMERA_PROFILES,
  type GroundCrossing,
  type OccluderHit,
} from "../app/game/geometry/visualGapCoverage";
import { AUDIT_VIEWPORT_PROFILES } from "../app/game/cameraPoses";
import type { GroundSurface, OccluderVolume } from "../app/game/geometry/visualSceneFootprints";

// ---------------------------------------------------------------------------
// Synthetic-geometry helpers (small artificial maps, per plan Section 7.9 —
// none of these tests touch real city content).
// ---------------------------------------------------------------------------

function worldGround(minX: number, maxX: number, minZ: number, maxZ: number): GroundSurface {
  return {
    id: "world-ground",
    ownerId: "world",
    kind: "world-ground",
    geometry: { kind: "aabb", minX, maxX, minZ, maxZ },
    surfaceY: 0,
    layerPriority: 0,
    provenance: "test",
  };
}

function water(id: string, minX: number, maxX: number, minZ: number, maxZ: number): GroundSurface {
  return {
    id,
    ownerId: id,
    kind: "water",
    geometry: { kind: "aabb", minX, maxX, minZ, maxZ },
    surfaceY: 0.005,
    layerPriority: 1,
    provenance: "test",
  };
}

function bridgeDeck(id: string, minX: number, maxX: number, minZ: number, maxZ: number): GroundSurface {
  return {
    id,
    ownerId: id,
    kind: "bridge-deck",
    geometry: { kind: "aabb", minX, maxX, minZ, maxZ },
    surfaceY: 0.07,
    layerPriority: 2,
    provenance: "test",
  };
}

function functionalOpen(id: string, minX: number, maxX: number, minZ: number, maxZ: number): GroundSurface {
  return {
    id,
    ownerId: id,
    kind: "functional-open",
    geometry: { kind: "aabb", minX, maxX, minZ, maxZ },
    surfaceY: 0.05,
    layerPriority: 1,
    provenance: "test",
  };
}

function building(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY = 0,
  maxY = 10,
): OccluderVolume {
  return {
    id,
    ownerId: id,
    kind: "building",
    geometry: { kind: "aabb", minX, maxX, minZ, maxZ },
    minY,
    maxY,
    provenance: "test",
  };
}

describe("visualGapCoverage — spatial index", () => {
  it("inserts a shape into every cell its AABB overlaps, not only its centre's cell", () => {
    // #15: a long thin 200 m shape whose centre is several buckets away from
    // the query ray must still be found.
    const index = new SpatialIndex();
    index.insert("long-wall", { minX: -100, maxX: 100, minZ: 5, maxZ: 6 });
    // Query near one far end, several 32 m buckets from the shape's centre.
    const candidates = index.candidatesAlongSegment(-95, 0, -95, 10);
    expect(candidates).toContain("long-wall");
    expect(SPATIAL_INDEX_CELL_SIZE_M).toBe(32);
  });

  it("returns query results sorted deterministically regardless of insertion order", () => {
    const forward = new SpatialIndex();
    forward.insert("b", { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    forward.insert("a", { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    const reversed = new SpatialIndex();
    reversed.insert("a", { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    reversed.insert("b", { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    expect(forward.queryBox({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })).toEqual(
      reversed.queryBox({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }),
    );
  });
});

describe("visualGapCoverage — ground raster and connected voids", () => {
  it("#1/#2: a sealed perimeter's interior is a separate blob from the exterior", () => {
    const surfaces = [worldGround(-20, 20, -20, 20)];
    const walls = [
      building("north", -12, 12, 10, 12),
      building("south", -12, 12, -12, -10),
      building("east", 10, 12, -12, 12),
      building("west", -12, -10, -12, 12),
    ];
    const sealed = buildGroundRaster(surfaces, walls);
    expect(sealed.blobs).toHaveLength(2);
    const interior = sealed.blobs.find((b) => Math.abs(b.centroid.x) < 1 && Math.abs(b.centroid.z) < 1);
    expect(interior?.area).toBeCloseTo(400, 5);
    expect(interior?.qualifying).toBe(true);

    // Removing the north wall reconnects interior and exterior into one blob.
    const opened = buildGroundRaster(surfaces, walls.filter((w) => w.id !== "north"));
    expect(opened.blobs).toHaveLength(1);
  });

  it("#3: a sparse scatter of solids never reads as one opaque parcel rectangle", () => {
    // Four small posts inside a nominal "parcel" rectangle leave the rest of
    // the parcel as visible ground — nothing here treats the parcel bounds
    // themselves as opaque.
    const surfaces = [worldGround(-50, 50, -50, 50)];
    const posts = [
      building("p1", -2, 2, -2, 2),
      building("p2", 18, 22, -2, 2),
      building("p3", -2, 2, 18, 22),
      building("p4", 18, 22, 18, 22),
    ];
    const raster = buildGroundRaster(surfaces, posts);
    const totalArea = raster.blobs.reduce((s, b) => s + b.area, 0);
    // 100x100 world minus four 4x4 posts = 10000 - 64.
    expect(totalArea).toBeCloseTo(10000 - 64, 5);
    // The gaps between posts remain part of the connected exterior blob.
    expect(raster.blobs.length).toBe(1);
  });

  it("#17/#18: the 300 m² blob threshold and its area precision", () => {
    // A sealed 20 m-wide ring (matching the verified sealed-perimeter shape
    // above) whose interior depth is tuned so its area sits just either side
    // of the 300 m² line: width 20 * depth 14.999 = 299.98, width 20 * depth
    // 15.001 = 300.02.
    function sealedRing(halfWidth: number, halfDepth: number): OccluderVolume[] {
      const t = 2; // wall thickness
      return [
        building("n", -(halfWidth + t), halfWidth + t, halfDepth, halfDepth + t),
        building("s", -(halfWidth + t), halfWidth + t, -(halfDepth + t), -halfDepth),
        building("e", halfWidth, halfWidth + t, -(halfDepth + t), halfDepth + t),
        building("w", -(halfWidth + t), -halfWidth, -(halfDepth + t), halfDepth + t),
      ];
    }
    const surfaces = [worldGround(-50, 50, -50, 50)];

    const below = buildGroundRaster(surfaces, sealedRing(10, 14.999 / 2));
    const interiorBelow = below.blobs.find((b) => Math.abs(b.centroid.x) < 1 && Math.abs(b.centroid.z) < 1)!;
    expect(interiorBelow.area).toBeCloseTo(299.98, 2);
    expect(interiorBelow.area).toBeLessThan(QUALIFYING_BLOB_AREA_M2);
    expect(interiorBelow.qualifying).toBe(false);

    const above = buildGroundRaster(surfaces, sealedRing(10, 15.001 / 2));
    const interiorAbove = above.blobs.find((b) => Math.abs(b.centroid.x) < 1 && Math.abs(b.centroid.z) < 1)!;
    expect(interiorAbove.area).toBeCloseTo(300.02, 2);
    expect(interiorAbove.area).toBeGreaterThan(QUALIFYING_BLOB_AREA_M2);
    expect(interiorAbove.qualifying).toBe(true);
  });

  it("#18: fragments touching only at a corner stay disconnected", () => {
    const surfaces = [worldGround(-20, 20, -20, 20)];
    const occluders = [
      building("blockA", 0, 20, -20, 0),
      building("blockB", -20, 0, 0, 20),
      building("blockC", -20, -10, -20, 0),
      building("blockD", 10, 20, 0, 20),
    ];
    const raster = buildGroundRaster(surfaces, occluders);
    // Two 10x20 voids (SW: x[-10,0] x z[-20,0]; NE: x[0,10] x z[0,20]),
    // touching only at the world origin.
    expect(raster.blobs).toHaveLength(2);
    for (const blob of raster.blobs) expect(blob.area).toBeCloseTo(200, 5);
  });

  it("elevated occluders (a gas canopy) do not erase the ground raster beneath them", () => {
    const surfaces = [worldGround(-20, 20, -20, 20)];
    const canopy = building("canopy", -5, 5, -5, 5, 4, 5); // minY=4, not ground-contact
    const raster = buildGroundRaster(surfaces, [canopy]);
    expect(raster.blobs).toHaveLength(1);
    expect(raster.blobs[0].area).toBeCloseTo(1600, 5);
  });

  it("results are deterministic regardless of input array order", () => {
    const surfaces = [worldGround(-20, 20, -20, 20)];
    const walls = [
      building("north", -12, 12, 10, 12),
      building("south", -12, 12, -12, -10),
      building("east", 10, 12, -12, 12),
      building("west", -12, -10, -12, 12),
    ];
    const forward = buildGroundRaster(surfaces, walls);
    const reversed = buildGroundRaster(surfaces, [...walls].reverse());
    expect(forward.blobs.map((b) => ({ id: b.id, area: b.area }))).toEqual(
      reversed.blobs.map((b) => ({ id: b.id, area: b.area })),
    );
  });
});

describe("visualGapCoverage — ground-surface selection", () => {
  it("#25: a bridge deck outranks the water beneath it by surfaceY", () => {
    const surfaces = [
      worldGround(-50, 50, -50, 50),
      water("river", -50, 50, -10, 10),
      bridgeDeck("deck", -50, 50, -4, 4),
    ];
    const selected = selectVisibleGroundSurface(surfaces, 0, 0);
    expect(selected?.kind).toBe("bridge-deck");
    // Off the deck, water is still the visible surface.
    const overWater = selectVisibleGroundSurface(surfaces, 0, 8);
    expect(overWater?.kind).toBe("water");
  });
});

describe("visualGapCoverage — 3-D sightline kernel", () => {
  it("#14: a low wall below the camera ray does not block it", () => {
    const wall = building("low-wall", -1, 1, 5, 6, 0, 0.9);
    const hit = nearestOccluderHit([wall], { x: 0, y: 5.5, z: 0 }, { x: 0, y: 5.5, z: 50 });
    expect(hit).toBeNull();
  });

  it("a wall tall enough to reach the ray's height at that point blocks it", () => {
    const wall = building("wall", -1, 1, 5, 6, 0, 10);
    const hit = nearestOccluderHit([wall], { x: 0, y: 5.5, z: 0 }, { x: 0, y: 5.5, z: 50 });
    expect(hit?.occluderId).toBe("wall");
  });

  it("#24: an elevated canopy blocks a descending segment only where height and footprint overlap", () => {
    // Camera descends from y=6 at z=0 to y=0 at z=20; canopy footprint spans
    // z=8..12 with underside 4, top 5 — the ray only enters that band while
    // over the footprint.
    const canopy = building("canopy", -3, 3, 8, 12, 4, 5);
    const eye = { x: 0, y: 6, z: 0 };
    const missTarget = { x: 0, y: 0, z: 20 };
    // At z=8..12 (t=0.4..0.6), ray height = 6 - 6*t -> at t=0.4, y=3.6; at
    // t=0.6, y=2.4 — both below the canopy's [4,5] band, so it should NOT hit.
    expect(nearestOccluderHit([canopy], eye, missTarget)).toBeNull();

    // A shallower descent (to y=3 at z=20) whose height is inside [4,5]
    // while crossing z=8..12 (t=0.4..0.6: y=4.8 at t=0.4, y=4.2 at t=0.6)
    // must hit.
    const hitTarget = { x: 0, y: 3, z: 20 };
    const hit = nearestOccluderHit([canopy], eye, hitTarget);
    expect(hit?.occluderId).toBe("canopy");
  });

  it("camera origin inside an opaque volume is reported explicitly", () => {
    const wall = building("wall", -5, 5, -5, 5, 0, 10);
    expect(eyeInsideOpaqueOccluder([wall], { x: 0, y: 2, z: 0 })).not.toBeNull();
    expect(eyeInsideOpaqueOccluder([wall], { x: 0, y: 12, z: 0 })).toBeNull();
    expect(eyeInsideOpaqueOccluder([wall], { x: 20, y: 2, z: 0 })).toBeNull();
  });

  it("#13: a compound landmark blocks only on its actual component footprints, not a bounding gap", () => {
    // Two separate towers of one landmark plan entry, with a real gap between
    // them a ray can pass straight through.
    const towerA = building("landmark-a", -10, -6, -2, 2, 0, 20);
    const towerB = building("landmark-b", 6, 10, -2, 2, 0, 20);
    const throughGap = nearestOccluderHit([towerA, towerB], { x: 0, y: 5, z: -30 }, { x: 0, y: 5, z: 30 });
    expect(throughGap).toBeNull();
    const intoTowerA = nearestOccluderHit([towerA, towerB], { x: -8, y: 5, z: -30 }, { x: -8, y: 5, z: 30 });
    expect(intoTowerA?.occluderId).toBe("landmark-a");
  });

  it("#12: a venue lot / service apron surface never blocks, only its real solid does", () => {
    const surfaces = [worldGround(-50, 50, -50, 50), functionalOpen("lot", -20, 20, -20, 20)];
    const crossings = groundSurfaceCrossings(surfaces, { x: 0, z: -30 }, { x: 0, z: 30 });
    expect(crossings.some((c) => c.kind === "functional-open")).toBe(true);
    // The lot surface itself never appears as an occluder, so a ray through
    // it (no separate shop building) is never blocked by the lot.
    const hit = nearestOccluderHit([], { x: 0, y: 5, z: -30 }, { x: 0, y: 5, z: 30 });
    expect(hit).toBeNull();
    const shop = building("shop", -3, 3, -3, 3, 0, 6);
    const hitByShop = nearestOccluderHit([shop], { x: 0, y: 5, z: -30 }, { x: 0, y: 5, z: 30 });
    expect(hitByShop?.occluderId).toBe("shop");
  });
});

describe("visualGapCoverage — semantic ray state machine", () => {
  const totalM = 100;
  const opaqueAt = (tM: number, ownerId = "backdrop"): OccluderHit => ({
    occluderId: `${ownerId}-occ`,
    ownerId,
    kind: "building",
    t: tM / totalM,
  });
  const crossingOf = (kind: GroundCrossing["kind"], t0: number, t1: number, ownerId: string = kind): GroundCrossing => ({
    surfaceId: `${ownerId}-s`,
    ownerId,
    kind,
    t0,
    t1,
  });

  it("#5/#6: park backed by a building within tolerance passes; open beyond it fails", () => {
    const backed = classifySightline({
      totalRangeM: totalM,
      groundCrossings: [crossingOf("park", 0.2, 0.6)],
      opaqueHit: opaqueAt(61),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: false,
    });
    expect(backed.failureClass).toBe("park_backed");

    const open = classifySightline({
      totalRangeM: totalM,
      groundCrossings: [crossingOf("park", 0.2, 0.6)],
      opaqueHit: null,
      endTarget: { kind: "blob", blobId: "b", areaM2: 500, qualifying: true },
      inProtectedCorridor: false,
    });
    expect(open.failureClass).toBe("park_to_void");
  });

  it("#7: a substantial park continuing through the visible range passes; ending just short into grey fails", () => {
    const continuing = classifySightline({
      totalRangeM: 160,
      groundCrossings: [crossingOf("park", 0.05, 1.0)],
      opaqueHit: null,
      endTarget: { kind: "open-surface" },
      inProtectedCorridor: false,
    });
    expect(continuing.failureClass).toBe("park_continues");

    const shortfall = classifySightline({
      totalRangeM: 160,
      groundCrossings: [crossingOf("park", 0.05, 159 / 160)],
      opaqueHit: null,
      endTarget: { kind: "blob", blobId: "b", areaM2: 500, qualifying: true },
      inProtectedCorridor: false,
    });
    expect(shortfall.failureClass).toBe("park_to_void");
  });

  it("#8/#9: park to water passes; a grey seam before water fails", () => {
    const toWater = classifySightline({
      totalRangeM: 200,
      groundCrossings: [crossingOf("park", 0.1, 0.3), crossingOf("water", 0.3, 1.0)],
      opaqueHit: null,
      endTarget: { kind: "open-surface" },
      inProtectedCorridor: false,
    });
    expect(toWater.failureClass).toBe("park_to_water");

    const seam = classifySightline({
      totalRangeM: 200,
      groundCrossings: [crossingOf("park", 0.1, 0.25), crossingOf("water", 0.3, 1.0)],
      opaqueHit: null,
      endTarget: { kind: "open-surface" },
      inProtectedCorridor: false,
    });
    expect(seam.failureClass).toBe("undressed_water_approach");
  });

  it("#10: an ordinary/oblique urban ray that eventually reaches water passes with no named exemption needed", () => {
    const r = classifySightline({
      totalRangeM: 200,
      groundCrossings: [crossingOf("water", 0.75, 1.0)],
      opaqueHit: null,
      endTarget: { kind: "open-surface" },
      inProtectedCorridor: false,
    });
    expect(r.failureClass).toBe("waterfront");
  });

  it("#26: a narrow water body with an undressed far bank fails; a dressed far bank passes", () => {
    const undressed = classifySightline({
      totalRangeM: 60,
      groundCrossings: [crossingOf("water", 0, 20 / 60)],
      opaqueHit: null,
      endTarget: { kind: "blob", blobId: "b", areaM2: 500, qualifying: true },
      inProtectedCorridor: false,
    });
    expect(undressed.failureClass).toBe("undressed_water_approach");

    const dressed = classifySightline({
      totalRangeM: 60,
      groundCrossings: [crossingOf("water", 0, 20 / 60)],
      opaqueHit: opaqueAt(21),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: false,
    });
    expect(dressed.failureClass).toBe("waterfront");
  });

  it("#11: an urban land-side world edge with no opaque, park, or water fails", () => {
    const r = classifySightline({
      totalRangeM: 70,
      groundCrossings: [],
      opaqueHit: null,
      endTarget: { kind: "world-edge" },
      inProtectedCorridor: false,
    });
    expect(r.failureClass).toBe("urban_world_edge");
  });

  it("#12: a functional-open apron backed by a building passes; open behind it fails as unresolved_land", () => {
    const backed = classifySightline({
      totalRangeM: totalM,
      groundCrossings: [crossingOf("functional-open", 0.1, 0.4)],
      opaqueHit: opaqueAt(45),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: false,
    });
    expect(backed.failureClass).toBe("functional_open_backed");

    const openBehind = classifySightline({
      totalRangeM: totalM,
      groundCrossings: [crossingOf("functional-open", 0.1, 0.4)],
      opaqueHit: null,
      endTarget: { kind: "blob", blobId: "b", areaM2: 500, qualifying: true },
      inProtectedCorridor: false,
    });
    expect(openBehind.failureClass).toBe("unresolved_land");
  });

  it("#20: ordinary structure before a distant park is opaque; the same structure inside a protected corridor is blocked", () => {
    const ordinary = classifySightline({
      totalRangeM: 40,
      groundCrossings: [],
      opaqueHit: opaqueAt(20),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: false,
    });
    expect(ordinary.failureClass).toBe("opaque");

    const protectedCorridor = classifySightline({
      totalRangeM: 40,
      groundCrossings: [],
      opaqueHit: opaqueAt(20),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: true,
    });
    expect(protectedCorridor.failureClass).toBe("protected_view_blocked");
  });

  it("a road crossing between a park and its backdrop does not itself count against the seam tolerance", () => {
    const r = classifySightline({
      totalRangeM: totalM,
      groundCrossings: [crossingOf("park", 0.2, 0.6), crossingOf("road", 0.61, 0.63, "road-1")],
      opaqueHit: opaqueAt(64),
      endTarget: { kind: "blob", blobId: "b", areaM2: 0, qualifying: false },
      inProtectedCorridor: false,
    });
    expect(r.failureClass).toBe("park_backed");
  });

  it("every literal in the failure-class union is reachable and the content-gap/audit-error sets partition correctly", () => {
    expect(new Set(ALL_RAY_FAILURE_CLASSES).size).toBe(ALL_RAY_FAILURE_CLASSES.length);
    for (const failureClass of CONTENT_GAP_CLASSES) {
      expect(ALL_RAY_FAILURE_CLASSES).toContain(failureClass);
      expect(AUDIT_ERROR_CLASSES.has(failureClass)).toBe(false);
    }
    for (const failureClass of AUDIT_ERROR_CLASSES) {
      expect(ALL_RAY_FAILURE_CLASSES).toContain(failureClass);
      expect(CONTENT_GAP_CLASSES.has(failureClass)).toBe(false);
    }
  });
});

describe("visualGapCoverage — bare-kerb-run metric", () => {
  const kerb = [
    { x: 0, z: 0 },
    { x: 0, z: 100 },
  ];
  function bracket(zn: number): OccluderVolume[] {
    return [
      building("south", 0, 10, -50, 0),
      building("north", 0, 10, zn, zn + 50),
    ];
  }

  it("#17: exactly 28.000 m passes; a hair over fails, at a 1 cm-scale tolerance", () => {
    const exact = bareKerbRuns(kerb, bracket(60));
    expect(exact.some((r) => r.qualifying)).toBe(false);

    const over = bareKerbRuns(kerb, bracket(60.02));
    expect(over.some((r) => r.qualifying)).toBe(true);
    const overRun = over.find((r) => r.qualifying)!;
    expect(overRun.lengthM).toBeCloseTo(BARE_KERB_RUN_LIMIT_M + 0.02, 2);
  });

  it("an exempt range (a junction mouth) splits a run without itself counting as bare or built", () => {
    const runs = bareKerbRuns(kerb, [], [{ startM: 40, endM: 50, reason: "junction" }]);
    expect(runs).toHaveLength(2);
    expect(runs[0].endM).toBeLessThanOrEqual(40.01);
    expect(runs[1].startM).toBeGreaterThanOrEqual(49.99);
  });
});

describe("visualGapCoverage — report ID contract", () => {
  it("#19: distinct sides/azimuths/targets at one station produce unique ids", () => {
    const base = {
      mapId: "test-map",
      seedId: "seed-1",
      representationProfile: "full-detail" as const,
      roadId: "road-1",
      segmentIndex: 0,
      stationDistanceM: 24,
      travelHeading: "travel-fwd" as const,
      cameraProfileId: "fastback",
      viewportId: "desktop-1920x1080",
      fovDeg: 72,
    };
    const ids = new Set([
      buildFailureId({ ...base, side: "side-left", rayOrTargetId: "az-0" }),
      buildFailureId({ ...base, side: "side-right", rayOrTargetId: "az-0" }),
      buildFailureId({ ...base, side: "side-left", rayOrTargetId: "az-5000" }),
      buildFailureId({ ...base, side: "side-left", rayOrTargetId: "blob-blob-1-cell-c1" }),
      buildFailureId({ ...base, side: "side-left", rayOrTargetId: "blob-blob-1-cell-c2" }),
    ]);
    expect(ids.size).toBe(5);
  });
});

describe("visualGapCoverage — occluder index helper", () => {
  it("buildOccluderIndex indexes every occluder and an empty map yields no candidates", () => {
    const index = buildOccluderIndex([building("a", -5, 5, -5, 5)]);
    expect(index.candidatesAlongSegment(-50, 0, 50, 0)).toContain("a");
    expect(buildOccluderIndex([]).candidatesAlongSegment(0, 0, 1, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Road station and camera-fan generation (Section 7.6)
// ---------------------------------------------------------------------------

describe("visualGapCoverage — road station generation", () => {
  it("stations both pavement edges every 8 m, plus both endpoints, symmetric about the centreline", () => {
    const road = { id: "road-1", centerline: [{ x: 0, z: 0 }, { x: 0, z: 20 }], widthM: 8, sidewalkWidthM: 2 };
    const stations = roadStations(road, 3.4, ROAD_STATION_STEP_M);
    // pavementOffsetM = 8/2 + 2 = 6; stations at s=0,8,16,20 (both endpoints, plus the fixed step) x 2 sides.
    const distances = [...new Set(stations.map((s) => s.stationDistanceM))].sort((a, b) => a - b);
    expect(distances).toEqual([0, 8, 16, 20]);
    expect(stations).toHaveLength(distances.length * 2);
    for (const s of stations) {
      expect(Math.abs(s.x)).toBeCloseTo(6, 6);
      expect(s.side).toBe(s.x < 0 ? "side-left" : "side-right");
    }
  });

  it("never emits a near-duplicate station where a fixed step lands on (or just short of) a vertex", () => {
    // A 16 m segment: the 8 m step already lands exactly on both vertices —
    // must not double-emit distance 0/8/16.
    const road = { id: "road-2", centerline: [{ x: 0, z: 0 }, { x: 0, z: 16 }], widthM: 6 };
    const stations = roadStations(road, 3.4, 8);
    const distances = stations.filter((s) => s.side === "side-left").map((s) => s.stationDistanceM);
    expect(distances).toEqual([0, 8, 16]);
  });

  it("a bend gets an explicit station at the vertex even when it falls off the fixed step", () => {
    const road = {
      id: "road-3",
      centerline: [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 10 }],
      widthM: 8,
    };
    const stations = roadStations(road, 3.4, 8);
    // Segment 0 (length 10) must include a station at its own end (distance 10),
    // even though the fixed 8 m step alone would only reach 8.
    const seg0 = stations.filter((s) => s.segmentIndex === 0 && s.side === "side-left").map((s) => s.stationDistanceM);
    expect(seg0).toContain(10);
    // Segment 1 starts its own distance count fresh from its own vertex.
    const seg1 = stations.filter((s) => s.segmentIndex === 1).map((s) => s.stationDistanceM);
    expect(Math.min(...seg1)).toBe(0);
  });

  it("heading matches this codebase's clockwise convention (0 = +z, 90deg = +x)", () => {
    const northSouth = roadStations({ id: "ns", centerline: [{ x: 0, z: 0 }, { x: 0, z: 10 }], widthM: 8 }, 3.4);
    expect(northSouth[0].forwardHeadingRad).toBeCloseTo(0, 6);
    const westEast = roadStations({ id: "we", centerline: [{ x: 0, z: 0 }, { x: 10, z: 0 }], widthM: 8 }, 3.4);
    expect(westEast[0].forwardHeadingRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it("a degenerate (single-point or empty) centreline stations nothing", () => {
    expect(roadStations({ id: "a", centerline: [], widthM: 8 }, 3.4)).toEqual([]);
    expect(roadStations({ id: "b", centerline: [{ x: 0, z: 0 }], widthM: 8 }, 3.4)).toEqual([]);
  });
});

describe("visualGapCoverage — fan azimuth generation", () => {
  it("always includes 0 and the exact +/- half-FOV edges, even off the 5-degree grid", () => {
    const offsets = fanAzimuthOffsetsDeg(72);
    expect(offsets[0]).toBeCloseTo(-36, 6);
    expect(offsets.at(-1)).toBeCloseTo(36, 6);
    expect(offsets).toContain(0);
    // 72 is not a multiple of 5 -- the grid steps (-36, -31, ..., 34) never
    // land exactly on +36, so the edge must be a distinct extra entry.
    expect(offsets.filter((o) => Math.abs(o - 36) < 1e-6)).toHaveLength(1);
  });

  it("is sorted, deduplicated, and symmetric for a FOV that IS a multiple of 5", () => {
    const offsets = fanAzimuthOffsetsDeg(100);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const o of offsets) expect(offsets).toContain(-o);
  });
});

describe("visualGapCoverage — world-boundary ray clip", () => {
  const bounds = { minX: -100, maxX: 100, minZ: -50, maxZ: 50 };
  it("clips to the nearest of the four faces along an axis-aligned ray", () => {
    expect(distanceToWorldBoundaryAlongRay(0, 0, 1, 0, bounds)).toBeCloseTo(100, 6);
    expect(distanceToWorldBoundaryAlongRay(0, 0, -1, 0, bounds)).toBeCloseTo(100, 6);
    expect(distanceToWorldBoundaryAlongRay(0, 0, 0, 1, bounds)).toBeCloseTo(50, 6);
  });
  it("clips to the closer of two faces on a diagonal ray", () => {
    // From the centre, the Z faces (50 m) are reached before the X faces
    // (100 m) along a 45-degree ray.
    const d = distanceToWorldBoundaryAlongRay(0, 0, Math.SQRT1_2, Math.SQRT1_2, bounds);
    expect(d).toBeCloseTo(50 / Math.SQRT1_2, 6);
  });
});

describe("visualGapCoverage — full camera-fan sweep (Section 7.6-7.8 integration)", () => {
  const worldSize = { x: 300, z: 300 };
  const lightOptions = {
    seedId: "seed-0",
    representationProfile: "full-detail" as const,
    cameraProfiles: [DEFAULT_AUDIT_CAMERA_PROFILES[0]],
    viewports: [AUDIT_VIEWPORT_PROFILES[0]],
    fovsDeg: [72 as const],
  };
  const road = [{ id: "road-1", centerline: [{ x: 0, z: -80 }, { x: 0, z: 80 }], widthM: 8 }];
  // Ground-surface coverage and occluder placement are independent layers
  // (`visualSceneFootprints.ts`'s "ground and occlusion are deliberately
  // separate"), so a wall alone does not make the raster treat its footprint
  // as covered -- a sidewalk surface flush against the road's own edge is
  // what real content always has there too, and is what keeps the 0.5 m
  // wall-setback below (needed so the chase camera's eye, which sits at
  // exactly the station's own x on a pure north/south road, never lands
  // inside the wall) from reading as an unintended sliver of bare void.
  const roadSurface = (): GroundSurface => ({ ...water("road-surface", -4, 4, -300, 300), kind: "road", surfaceY: 0.07 });
  const sidewalk = (id: string, minX: number, maxX: number): GroundSurface => ({
    ...functionalOpen(id, minX, maxX, -300, 300),
    kind: "sidewalk",
  });

  it("an open flank beside a long straight road produces content-gap records, all pointed at the open side", () => {
    // A close street wall (behind its own sidewalk) on the west; nothing at
    // all -- not even ground cover -- to the east. A station standing on the
    // *closed* west side can still legitimately fail here: an 8 m-wide road
    // is well within any FOV fan's reach, so a west-side camera looking
    // rightward across the carriageway sees the same open east side a
    // right-side camera does -- `side` records where the camera stood, not
    // which side of the street the failing ray happens to be looking at.
    // The real invariant is on the geometry, not the station label: every
    // failing ray's resolved target actually sits over east-side ground
    // (x > 4, past the carriageway) -- none can be explained by the west
    // wall having some undiscovered hole in it.
    const geometry = {
      groundSurfaces: [worldGround(-300, 300, -300, 300), roadSurface(), sidewalk("west-sidewalk", -34, -4)],
      occluders: [building("west-wall", -280, -4.5, -300, 300)],
      issues: [],
    };
    const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
    const records = auditMapVisualGaps("test-map", worldSize, undefined, road, 0, geometry, raster, lightOptions);

    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => CONTENT_GAP_CLASSES.has(r.failureClass) || AUDIT_ERROR_CLASSES.has(r.failureClass))).toBe(true);
    expect(records.every((r) => r.target.x >= 4)).toBe(true);
  });

  it("a fully street-walled road on both sides produces zero content-gap/audit-error records", () => {
    const geometry = {
      groundSurfaces: [
        worldGround(-300, 300, -300, 300),
        roadSurface(),
        sidewalk("west-sidewalk", -34, -4),
        sidewalk("east-sidewalk", 4, 34),
      ],
      occluders: [building("west-wall", -280, -4.5, -300, 300), building("east-wall", 4.5, 280, -300, 300)],
      issues: [],
    };
    const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
    const records = auditMapVisualGaps("test-map", worldSize, undefined, road, 0, geometry, raster, lightOptions);
    expect(records).toEqual([]);
  });

  it("`onlyRoadIds` scopes the sweep to the named roads only", () => {
    const secondRoad = { id: "road-2", centerline: [{ x: 200, z: -80 }, { x: 200, z: 80 }], widthM: 8 };
    const geometry = {
      groundSurfaces: [worldGround(-300, 300, -300, 300), roadSurface(), sidewalk("west-sidewalk", -34, -4)],
      occluders: [building("west-wall", -280, -4.5, -300, 300)],
      issues: [],
    };
    const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
    const scoped = auditMapVisualGaps("test-map", worldSize, undefined, [...road, secondRoad], 0, geometry, raster, {
      ...lightOptions,
      onlyRoadIds: new Set(["road-2"]),
    });
    expect(scoped.every((r) => r.roadId === "road-2")).toBe(true);
    // road-2 has no occluders anywhere nearby, so it should read as open too.
    expect(scoped.length).toBeGreaterThan(0);
  });

  it("every returned record has a report-contract-shaped, globally unique failureId", () => {
    const geometry = {
      groundSurfaces: [worldGround(-300, 300, -300, 300), roadSurface(), sidewalk("west-sidewalk", -34, -4)],
      occluders: [building("west-wall", -280, -4.5, -300, 300)],
      issues: [],
    };
    const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
    const records = auditMapVisualGaps("test-map", worldSize, undefined, road, 0, geometry, raster, lightOptions);
    const ids = new Set(records.map((r) => r.failureId));
    expect(ids.size).toBe(records.length);
    for (const id of [...ids].slice(0, 5)) {
      expect(id.startsWith("test-map/seed-0/full-detail/road-1/seg-0/station-")).toBe(true);
    }
  });

  it("all five camera profiles execute (Section 7.9 item 21: default/delivery-van/sport-sedan/both first-person seats)", () => {
    // Same wide-open-east-flank scene as the sibling tests above, but with
    // every profile x both viewports enabled -- fastback/van/sedan share one
    // viewport (chase ignores aspect), first-person genuinely varies by it.
    const geometry = {
      groundSurfaces: [worldGround(-300, 300, -300, 300), roadSurface(), sidewalk("west-sidewalk", -34, -4)],
      occluders: [building("west-wall", -280, -4.5, -300, 300)],
      issues: [],
    };
    const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
    const records = auditMapVisualGaps("test-map", worldSize, undefined, road, 0, geometry, raster, {
      ...lightOptions,
      cameraProfiles: DEFAULT_AUDIT_CAMERA_PROFILES,
      viewports: AUDIT_VIEWPORT_PROFILES,
    });

    expect(DEFAULT_AUDIT_CAMERA_PROFILES).toHaveLength(5);
    const seenProfileIds = new Set(records.map((r) => r.cameraProfileId));
    for (const profile of DEFAULT_AUDIT_CAMERA_PROFILES) {
      expect(seenProfileIds.has(profile.id), `profile ${profile.id} never executed/never failed`).toBe(true);
    }

    const firstPersonViewportIds = new Set(
      records.filter((r) => r.cameraProfileId.startsWith("first-person")).map((r) => r.viewportId),
    );
    for (const viewport of AUDIT_VIEWPORT_PROFILES) {
      expect(firstPersonViewportIds.has(viewport.id), `first-person viewport ${viewport.id} never executed/never failed`).toBe(true);
    }

    // Chase ignores viewport/aspect entirely (Section 7.6 item 6) -- every
    // chase record must carry the same single viewport id, never both.
    const chaseViewportIds = new Set(
      records.filter((r) => !r.cameraProfileId.startsWith("first-person")).map((r) => r.viewportId),
    );
    expect(chaseViewportIds.size).toBe(1);
  });
});
