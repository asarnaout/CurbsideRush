import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import {
  TRAFFIC_CAMERA_RATE,
  authoredSignalAspectAt,
  authoredSignalOffsetSeconds,
  trafficCameraControlIds,
} from "../app/game/trafficSignals";

const signalControlIdsOf = (mapId: string): string[] =>
  MAP_PACKS.find((map) => map.id === mapId)!
    .laneGraph.controls.filter((control) => control.type === "signal")
    .map((control) => control.id);

const aspectAt = (
  style: "nyc_signal" | "uk_signal",
  controlId: string,
  phaseGroup: string,
  phaseGroups: readonly string[],
  unshiftedSeconds: number,
) =>
  authoredSignalAspectAt({
    elapsedSeconds: unshiftedSeconds - authoredSignalOffsetSeconds(controlId),
    controlId,
    phaseGroup,
    phaseGroups,
    style,
  });

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.0001) return Math.hypot(point.x - start.x, point.z - start.z);
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
}

function laneHeadingAt(
  lane: { readonly centerline: readonly { x: number; z: number }[] },
  distanceAlongM: number,
): number {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (remaining <= length || index === lane.centerline.length - 2) {
      return (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI;
    }
    remaining -= length;
  }
  return 0;
}

function angularDifferenceDegrees(left: number, right: number): number {
  const wrapped = ((left - right + 540) % 360) - 180;
  return Math.abs(wrapped);
}

describe("authored traffic-signal phases", () => {
  it("keeps antagonistic NYC approaches from showing green together", () => {
    const groups = ["east-west", "north-south"];
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 0.1)).toBe("green");
    expect(aspectAt("nyc_signal", "nyc-test", groups[1], groups, 0.1)).toBe("red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 7.1)).toBe("amber");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 9.1)).toBe("all_red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[0], groups, 10.1)).toBe("red");
    expect(aspectAt("nyc_signal", "nyc-test", groups[1], groups, 10.1)).toBe("green");

    for (let seconds = 0; seconds < 20; seconds += 0.1) {
      const aspects = groups.map((group) =>
        aspectAt("nyc_signal", "nyc-test", group, groups, seconds),
      );
      expect(aspects.filter((aspect) => aspect === "green")).toHaveLength(
        aspects.includes("green") ? 1 : 0,
      );
    }
  });

  it("uses UK red-amber, green, amber and all-red clearance", () => {
    const groups = ["queen-gate", "cromwell"];
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 0.1)).toBe("red_amber");
    expect(aspectAt("uk_signal", "uk-test", groups[1], groups, 0.1)).toBe("red");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 1.6)).toBe("green");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 8.6)).toBe("amber");
    expect(aspectAt("uk_signal", "uk-test", groups[0], groups, 11.6)).toBe("all_red");
    expect(aspectAt("uk_signal", "uk-test", groups[1], groups, 12.6)).toBe("red_amber");
  });
});

describe("authored traffic-signal installations", () => {
  it("maps every NYC and London signal head to one compatible approach phase", () => {
    const maps = MAP_PACKS.filter((map) =>
      ["nyc-upper-west-side", "london-south-kensington"].includes(map.id),
    );
    for (const map of maps) {
      for (const control of map.laneGraph.controls.filter(
        (candidate) => candidate.type === "signal",
      )) {
        const approaches = new Map(control.approaches.map((approach) => [approach.id, approach]));
        for (const signalHead of control.installations.filter(
          (candidate) =>
            candidate.style === "nyc_signal" || candidate.style === "uk_signal",
        )) {
          expect(signalHead.approachIds?.length, `${control.id}/${signalHead.id}`).toBeGreaterThan(0);
          const mappedGroups = new Set(
            (signalHead.approachIds ?? []).map((approachId) => {
              const mapped = approaches.get(approachId);
              expect(mapped, `${signalHead.id} → ${approachId}`).toBeDefined();
              const lane = map.laneGraph.lanes.find(
                (candidate) => candidate.id === mapped!.stopLine.laneId,
              );
              expect(lane, `${approachId} lane`).toBeDefined();
              expect(
                angularDifferenceDegrees(
                  signalHead.headingDeg,
                  laneHeadingAt(lane!, mapped!.stopLine.distanceAlongM),
                ),
                `${signalHead.id} faces ${approachId}`,
              ).toBeLessThan(20);
              return mapped!.phaseGroup;
            }),
          );
          expect([...mappedGroups], `${signalHead.id} phase mapping`).toHaveLength(1);
        }
      }
    }
  });

  it("keeps every NYC and London signal-pole base outside driveable lanes", () => {
    const maps = MAP_PACKS.filter((map) =>
      ["nyc-upper-west-side", "london-south-kensington"].includes(map.id),
    );
    for (const map of maps) {
      for (const control of map.laneGraph.controls.filter(
        (candidate) => candidate.type === "signal",
      )) {
        for (const signalHead of control.installations.filter(
          (candidate) =>
            candidate.style === "nyc_signal" || candidate.style === "uk_signal",
        )) {
          for (const lane of map.laneGraph.lanes) {
            let nearest = Number.POSITIVE_INFINITY;
            for (let index = 0; index < lane.centerline.length - 1; index += 1) {
              nearest = Math.min(
                nearest,
                distanceToSegment(
                  signalHead.position,
                  lane.centerline[index],
                  lane.centerline[index + 1],
                ),
              );
            }
            expect(
              nearest,
              `${map.id}/${signalHead.id} overlaps ${lane.id}`,
            ).toBeGreaterThan((lane.widthM ?? 3.2) / 2 + 0.2);
          }
        }
      }
    }
  });

  it("equips a quarter of a city's signals with a camera", () => {
    for (const mapId of ["nyc-upper-west-side", "london-south-kensington"]) {
      const ids = signalControlIdsOf(mapId);
      expect(ids.length, `${mapId} has signals`).toBeGreaterThan(0);
      const equipped = trafficCameraControlIds(ids);
      expect(equipped.size, `${mapId} camera count`).toBe(
        Math.max(1, Math.round(ids.length * TRAFFIC_CAMERA_RATE)),
      );
      for (const id of equipped) expect(ids).toContain(id);
    }
  });

  it("gives a signalled city at least one camera however few signals it has", () => {
    // London has two. A `hash(id) < 0.25` threshold lands on zero here more
    // often than not, which is the whole reason the draw ranks and cuts.
    expect(trafficCameraControlIds(["a", "b"]).size).toBe(1);
    expect(trafficCameraControlIds(["only-one"]).size).toBe(1);
    expect(trafficCameraControlIds([]).size).toBe(0);
  });

  it("draws the same cameras every time, whatever order the controls arrive in", () => {
    const ids = signalControlIdsOf("nyc-upper-west-side");
    const once = [...trafficCameraControlIds(ids)].sort();
    expect([...trafficCameraControlIds(ids)].sort()).toEqual(once);
    expect([...trafficCameraControlIds([...ids].reverse())].sort()).toEqual(once);
    expect([...trafficCameraControlIds([...ids, ...ids])].sort()).toEqual(once);
  });

  it("spreads New York's cameras across the grid rather than down a few roads", () => {
    // Signal ids are `nyc-sig-<avenue>-<street>`, and they all share the same
    // long prefix. Ranking on raw FNV-1a — whose high bits barely move once a
    // prefix is folded in — put all sixteen on Amsterdam, West End and
    // Broadway, leaving Riverside, Columbus and Central Park West with none.
    const equipped = [...trafficCameraControlIds(signalControlIdsOf("nyc-upper-west-side"))];
    const avenues = new Set(equipped.map((id) => id.split("-")[2]));
    const streets = new Set(equipped.map((id) => id.split("-")[3]));
    expect(avenues.size, `avenues: ${[...avenues].join(",")}`).toBeGreaterThanOrEqual(5);
    expect(streets.size, `streets: ${[...streets].join(",")}`).toBeGreaterThanOrEqual(8);
  });

  it("does not draw cameras where the phase offsets already cluster", () => {
    // Both hash the same control ids. Unsalted they would agree, and every
    // camera in the city would sit on a junction sharing one phase offset.
    const ids = signalControlIdsOf("nyc-upper-west-side");
    const equipped = trafficCameraControlIds(ids);
    const offsets = new Set(
      [...equipped].map((id) => authoredSignalOffsetSeconds(id)),
    );
    expect(offsets.size).toBeGreaterThan(1);
  });

  it("honours a rate other than the default", () => {
    const ids = signalControlIdsOf("nyc-upper-west-side");
    expect(trafficCameraControlIds(ids, 0).size).toBe(0);
    expect(trafficCameraControlIds(ids, 1).size).toBe(ids.length);
    expect(trafficCameraControlIds(ids, 2).size).toBe(ids.length);
    expect(trafficCameraControlIds(ids, 0.5).size).toBe(Math.round(ids.length / 2));
    // A larger rate can only add to a smaller one, never reshuffle it.
    const quarter = trafficCameraControlIds(ids, 0.25);
    const half = trafficCameraControlIds(ids, 0.5);
    for (const id of quarter) expect(half.has(id)).toBe(true);
  });

  it("groups opposing London axes correctly", () => {
    const london = MAP_PACKS.find((map) => map.id === "london-south-kensington")!;
    const queenGate = london.laneGraph.controls.find(
      (control) => control.id === "london-signal-queen-gate-cromwell",
    )!;
    const groups = Object.fromEntries(
      queenGate.approaches.map((approach) => [approach.id, approach.phaseGroup]),
    );
    expect(groups["london-queen-gate-north-approach"]).toBe(
      groups["london-queen-gate-south-approach"],
    );
    expect(groups["london-cromwell-west-approach"]).not.toBe(
      groups["london-queen-gate-north-approach"],
    );
  });
});
