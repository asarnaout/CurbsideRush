import { describe, expect, it } from "vitest";
import {
  elevationOnPolylineAt,
  isElevatedRoadSurface,
  roadElevationsCanInteract,
  roadLevelAtElevation,
  roadSurfaceLevel,
} from "../app/game/roadElevation";
import { buildRoadSurfaceStripGeometry } from "../app/game/geometry/roadStrips";

describe("road elevation", () => {
  const ramp = {
    centerline: [
      { x: 0, z: 0, elevationM: 0 },
      { x: 0, z: 100, elevationM: 10 },
      { x: 100, z: 100, elevationM: 10 },
    ],
  };

  it("interpolates the closest ramp segment and holds the deck height", () => {
    expect(elevationOnPolylineAt(ramp.centerline, 2, 25)).toBeCloseTo(2.5, 9);
    expect(elevationOnPolylineAt(ramp.centerline, 60, 98)).toBeCloseTo(10, 9);
  });

  it("classifies the live level independently from structural deck detection", () => {
    expect(isElevatedRoadSurface(ramp)).toBe(true);
    expect(roadSurfaceLevel(ramp)).toBe("elevated");
    expect(roadLevelAtElevation(3.49)).toBe("ground");
    expect(roadLevelAtElevation(3.5)).toBe("elevated");
    expect(
      isElevatedRoadSurface({ centerline: [{ x: 0, z: 0 }] }),
    ).toBe(false);
  });

  it("uses a tighter physical contact band than the map-level switch", () => {
    expect(roadElevationsCanInteract(0, 1.75)).toBe(true);
    expect(roadElevationsCanInteract(0, 1.751)).toBe(false);
    expect(roadElevationsCanInteract(10.5, 10.4)).toBe(true);
    expect(roadElevationsCanInteract(10.5, 0)).toBe(false);
  });

  it("carries an authored profile into both sides of the rendered road strip", () => {
    const strip = buildRoadSurfaceStripGeometry(ramp.centerline, 12);
    const ys = strip.positions.filter((_, index) => index % 3 === 1);
    expect(ys).toEqual([0, 0, 10, 10, 10, 10]);
  });
});
