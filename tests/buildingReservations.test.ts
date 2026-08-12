import { describe, expect, it } from "vitest";
import {
  buildingReservations,
  DEFAULT_RELAXATION_POLICY,
  isInsideHistoricalBuffer,
  keptStreetWallBuildings,
  solidOverlapsReservation,
  type BuildingReservation,
  type ReservationObb,
} from "../app/game/geometry/facadesAndKeepouts";
import { placedServiceShellSolids, placedVenueFootprint } from "../app/game/geometry/placedPropFootprints";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";

const MAPS = [LONDON_MAP_PACK, CAIRO_MAP_PACK, NYC_MAP_PACK];

function obb(x: number, z: number, headingRad: number, halfU: number, halfV: number): ReservationObb {
  return { kind: "obb", x, z, ux: Math.cos(headingRad), uz: -Math.sin(headingRad), halfU, halfV };
}

describe("solidOverlapsReservation — exact geometry tests", () => {
  it("circle: overlaps only within radius + clearance", () => {
    // Solid's right edge is at x=2 (halfU=2, centred on the origin). A
    // circle centred at x=3.5 with radius 2 reaches back to x=1.5, well
    // past the solid's edge -- a clean overlap, not a boundary case.
    const solid = obb(0, 0, 0, 2, 1);
    const near: BuildingReservation = { id: "a", ownerId: "a", ownerKind: "venue", purpose: "solid-clearance", geometry: { kind: "circle", x: 3.5, z: 0, radius: 2 }, clearanceM: 0.5 };
    const far: BuildingReservation = { ...near, geometry: { kind: "circle", x: 20, z: 0, radius: 2 } };
    expect(solidOverlapsReservation(solid, near)).toBe(true);
    expect(solidOverlapsReservation(solid, far)).toBe(false);
  });

  it("circle clearance is applied exactly once", () => {
    // Solid right edge at x=2. Circle left edge at x=5-2=3 -> gap of exactly 1m.
    const solid = obb(0, 0, 0, 2, 1);
    const gapReservation = (clearanceM: number): BuildingReservation => ({
      id: "a", ownerId: "a", ownerKind: "venue", purpose: "solid-clearance",
      geometry: { kind: "circle", x: 5, z: 0, radius: 2 }, clearanceM,
    });
    expect(solidOverlapsReservation(solid, gapReservation(0.99))).toBe(false);
    expect(solidOverlapsReservation(solid, gapReservation(1.01))).toBe(true);
  });

  it("obb: exact SAT overlap at 0/90/oblique headings", () => {
    const solid = obb(0, 0, 0, 2, 2);
    const touching0 = obb(5, 0, 0, 2.5, 2); // gap 5-2-2.5 = 0.5
    const touching90 = obb(0, 5, Math.PI / 2, 2.5, 2); // rotated reservation, same lateral gap
    const obliqueOverlap = obb(3, 3, Math.PI / 4, 3, 3);
    const reservation = (geometry: ReservationObb, clearanceM = 0): BuildingReservation => ({
      id: "b", ownerId: "b", ownerKind: "gas-station", purpose: "solid-clearance", geometry, clearanceM,
    });
    expect(solidOverlapsReservation(solid, reservation(touching0, 0.4))).toBe(false);
    expect(solidOverlapsReservation(solid, reservation(touching0, 0.6))).toBe(true);
    expect(solidOverlapsReservation(solid, reservation(touching90, 0.6))).toBe(true);
    expect(solidOverlapsReservation(solid, reservation(obliqueOverlap))).toBe(true);
  });

  it("polygon: corner-containment overlap either direction", () => {
    const solid = obb(0, 0, 0, 1, 1);
    const enclosingPolygon: BuildingReservation = {
      id: "c", ownerId: "c", ownerKind: "repair-shop", purpose: "vehicle-access",
      geometry: { kind: "polygon", points: [{ x: -5, z: -5 }, { x: -5, z: 5 }, { x: 5, z: 5 }, { x: 5, z: -5 }] },
      clearanceM: 0,
    };
    expect(solidOverlapsReservation(solid, enclosingPolygon)).toBe(true);
    const distantPolygon: BuildingReservation = { ...enclosingPolygon, geometry: { kind: "polygon", points: [{ x: 20, z: 20 }, { x: 20, z: 25 }, { x: 25, z: 25 }, { x: 25, z: 20 }] } };
    expect(solidOverlapsReservation(solid, distantPolygon)).toBe(false);
  });
});

describe("buildingReservations — default policy is the byte-identical historical-buffer path", () => {
  it.each(MAPS.map((m) => [m.id, m] as const))(
    "%s: every service/venue gets exactly one historical-buffer circle by default",
    (_id, mapPack) => {
      const reservations = buildingReservations(mapPack);
      expect(reservations.length).toBeGreaterThan(0);
      for (const r of reservations) {
        expect(r.purpose).toBe("historical-buffer");
        expect(r.geometry.kind).toBe("circle");
        expect(r.clearanceM).toBe(0);
      }
      const ownerIds = new Set(reservations.map((r) => r.ownerId));
      expect(ownerIds.size).toBe(reservations.length); // one per owner, no duplicates
    },
  );

  it("relaxing an owner adds its exact reservations without removing the historical buffer", () => {
    const service = CAIRO_MAP_PACK.geometry.servicePoints?.[0];
    expect(service).toBeTruthy();
    const relaxed = buildingReservations(CAIRO_MAP_PACK, {
      relaxations: [{ ownerId: service!.id, allowedRestoredPlanIds: new Set() }],
    });
    const forOwner = relaxed.filter((r) => r.ownerId === service!.id);
    expect(forOwner.some((r) => r.purpose === "historical-buffer")).toBe(true);
    expect(forOwner.some((r) => r.purpose !== "historical-buffer")).toBe(true);
    // Every other owner is untouched (still historical-buffer only).
    const otherOwnerReservations = relaxed.filter((r) => r.ownerId !== service!.id);
    expect(otherOwnerReservations.every((r) => r.purpose === "historical-buffer")).toBe(true);
  });
});

describe("keptStreetWallBuildings — relaxation and allow-list gating", () => {
  const reservations: BuildingReservation[] = [
    { id: "owner-buffer", ownerId: "owner", ownerKind: "venue", purpose: "historical-buffer", geometry: { kind: "circle", x: 0, z: 0, radius: 20 }, clearanceM: 0 },
    { id: "owner-solid", ownerId: "owner", ownerKind: "venue", purpose: "solid-clearance", geometry: { kind: "obb", x: 0, z: 0, ux: 1, uz: 0, halfU: 3, halfV: 3 }, clearanceM: 0.75 },
  ];
  // A candidate at x=15 sits inside the 20m historical buffer, but is 15 - 3
  // - 0.75 = 11.25m clear of the exact solid -- a textbook "generous
  // historical clearance, no real conflict" case.
  const candidateFarFromSolid = { modelId: "london-shop", x: 15, z: 0, yaw: 0, edge: "+x" as const, edgeSlot: 0 };
  // A candidate that genuinely overlaps the exact solid even after relaxation.
  const candidateInsideSolid = { modelId: "london-shop", x: 1, z: 0, yaw: 0, edge: "+x" as const, edgeSlot: 1 };

  it("an unrelaxed owner excludes every candidate inside its historical buffer, full stop", () => {
    const kept = keptStreetWallBuildings([candidateFarFromSolid, candidateInsideSolid], reservations);
    expect(kept).toHaveLength(0);
  });

  it("a relaxed owner without an allow-list entry still excludes the candidate (review gate, not automatic)", () => {
    const kept = keptStreetWallBuildings(
      [candidateFarFromSolid],
      reservations,
      { relaxations: [{ ownerId: "owner", allowedRestoredPlanIds: new Set() }] },
      () => "not-on-the-list",
    );
    expect(kept).toHaveLength(0);
  });

  it("a relaxed, allow-listed candidate that clears the exact solid is restored", () => {
    const planId = "building:test:slot:+x:0";
    const kept = keptStreetWallBuildings(
      [candidateFarFromSolid],
      reservations,
      { relaxations: [{ ownerId: "owner", allowedRestoredPlanIds: new Set([planId]) }] },
      () => planId,
    );
    expect(kept).toHaveLength(1);
  });

  it("a relaxed, allow-listed candidate that still overlaps the exact solid stays excluded", () => {
    const planId = "building:test:slot:+x:1";
    const kept = keptStreetWallBuildings(
      [candidateInsideSolid],
      reservations,
      { relaxations: [{ ownerId: "owner", allowedRestoredPlanIds: new Set([planId]) }] },
      () => planId,
    );
    expect(kept).toHaveLength(0);
  });

  it("a candidate clearing every historical buffer needs no relaxation at all", () => {
    const clear = { ...candidateFarFromSolid, x: 100 };
    const kept = keptStreetWallBuildings([clear], reservations, DEFAULT_RELAXATION_POLICY);
    expect(kept).toHaveLength(1);
  });
});

describe("isInsideHistoricalBuffer — matches the legacy nominal-footprint predicate", () => {
  it("tests the candidate's footprint, not just its centre", () => {
    const reservations: BuildingReservation[] = [
      { id: "x", ownerId: "x", ownerKind: "repair-shop", purpose: "historical-buffer", geometry: { kind: "circle", x: 10, z: 0, radius: 3 }, clearanceM: 0 },
    ];
    // Buffer is a 3m-radius circle at x=10, so its nearest edge is at x=7.
    // Centre at x=0 with half-width 6 reaches x=6, still short of x=7 -- clear.
    expect(isInsideHistoricalBuffer(reservations, 0, 0, 6, 6)).toBe(false);
    // Half-width 8 reaches x=8, past the x=7 edge -- inside.
    expect(isInsideHistoricalBuffer(reservations, 0, 0, 8, 8)).toBe(true);
  });

  it("ignores non-historical-buffer reservations", () => {
    const reservations: BuildingReservation[] = [
      { id: "x", ownerId: "x", ownerKind: "venue", purpose: "solid-clearance", geometry: { kind: "circle", x: 0, z: 0, radius: 5 }, clearanceM: 0 },
    ];
    expect(isInsideHistoricalBuffer(reservations, 0, 0)).toBe(false);
  });
});

describe("placedPropFootprints — asymmetric 0/90/oblique golden parity (Section 8.3)", () => {
  it.each(MAPS.map((m) => [m.id, m] as const))("%s: every resolved venue footprint is a finite, non-degenerate OBB", (_id, mapPack) => {
    for (const venue of mapPack.geometry.gigVenues ?? []) {
      const footprint = placedVenueFootprint(mapPack, venue);
      if (!footprint || !footprint.resolved) continue;
      for (const solid of footprint.solids) {
        expect(Number.isFinite(solid.obb.x), venue.id).toBe(true);
        expect(Number.isFinite(solid.obb.z), venue.id).toBe(true);
        expect(solid.obb.halfU, venue.id).toBeGreaterThan(0);
        expect(solid.obb.halfV, venue.id).toBeGreaterThan(0);
        // (ux, uz) must be a unit vector -- a quarter-turn transform bug
        // (composing two rotations, or dropping one) tends to produce a
        // non-unit or NaN axis rather than a subtly-wrong angle.
        expect(Math.hypot(solid.obb.ux, solid.obb.uz), venue.id).toBeCloseTo(1, 6);
      }
    }
  });

  it.each(MAPS.map((m) => [m.id, m] as const))("%s: every resolved service shell solid is a finite, non-degenerate OBB", (_id, mapPack) => {
    for (const service of mapPack.geometry.servicePoints ?? []) {
      const solids = placedServiceShellSolids(mapPack.laneGraph.lanes, service);
      if (!solids) continue;
      expect(solids.length).toBeGreaterThan(0);
      for (const solid of solids) {
        expect(Number.isFinite(solid.obb.x), service.id).toBe(true);
        expect(Number.isFinite(solid.obb.z), service.id).toBe(true);
        expect(Math.hypot(solid.obb.ux, solid.obb.uz), service.id).toBeCloseTo(1, 6);
      }
    }
  });
});
