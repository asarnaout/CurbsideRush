import { describe, expect, it } from "vitest";
import {
  offsetOpenRoadPolyline,
  sampleOpenRoadCurve,
} from "../app/game/geometry/openRoadCurve";

describe("open-road curve geometry", () => {
  it("retains topology knots while adaptively sampling one continuous path", () => {
    const authored = [
      { x: 0, z: 0, elevationM: 0 },
      { x: 24, z: 0, elevationM: 2 },
      { x: 38, z: 24, elevationM: 5 },
    ] as const;
    const geometry = sampleOpenRoadCurve(authored, {
      maximumChordM: 5,
      maximumHeadingStepDeg: 3,
    });

    expect(geometry.segments).toHaveLength(2);
    expect(geometry.segments[0].at(-1)).toBe(authored[1]);
    expect(geometry.segments[1][0]).toBe(authored[1]);
    expect(
      geometry.centerline.filter((point) => point === authored[1]),
    ).toHaveLength(1);

    const chordDirections = geometry.centerline.slice(1).map((end, index) => {
      const start = geometry.centerline[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthM = Math.hypot(dx, dz);
      expect(lengthM).toBeLessThanOrEqual(5.001);
      return { x: dx / lengthM, z: dz / lengthM };
    });
    for (let index = 1; index < chordDirections.length; index += 1) {
      const incoming = chordDirections[index - 1];
      const outgoing = chordDirections[index];
      const headingStepDeg =
        (Math.acos(
          Math.max(
            -1,
            Math.min(1, incoming.x * outgoing.x + incoming.z * outgoing.z),
          ),
        ) *
          180) /
        Math.PI;
      expect(headingStepDeg).toBeLessThanOrEqual(3.001);
    }

    expect(geometry.centerline[0]).toBe(authored[0]);
    expect(geometry.centerline.at(-1)).toBe(authored[2]);
    expect(
      geometry.centerline.every(
        (point, index, points) =>
          index === 0 ||
          (point.elevationM ?? 0) >= (points[index - 1].elevationM ?? 0),
      ),
    ).toBe(true);
  });

  it("offsets a sampled path to the driver's right without changing height", () => {
    const offset = offsetOpenRoadPolyline(
      [
        { x: 0, z: 0, elevationM: 1 },
        { x: 0, z: 10, elevationM: 2 },
        { x: 0, z: 20, elevationM: 3 },
      ],
      2,
    );

    expect(offset).toEqual([
      { x: 2, z: 0, elevationM: 1 },
      { x: 2, z: 10, elevationM: 2 },
      { x: 2, z: 20, elevationM: 3 },
    ]);
  });
});
