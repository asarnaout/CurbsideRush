import { describe, expect, it } from "vitest";
import { getMapPack, MAP_PACKS } from "../app/game/content";
import { BUILDING_BASE_CLEARANCE_M } from "../app/game/GameCanvas";
import { roadAxisHeadingNear } from "../app/game/geometry/roadStrips";
import {
  mastArmTopY,
  signalStopBarSegment,
  SIGNAL_MAST,
  TRAFFIC_CAMERA_BODY,
  trafficCameraHeadIds,
  trafficCameraPlacement,
} from "../app/game/geometry/roadFurnitureLayout";
import { trafficCameraControlIds } from "../app/game/trafficSignals";
import type { LaneSegment, MapPack } from "../app/game/types";

/**
 * Issue #149: at signalised junctions the stop bars rendered slanted — the
 * bar was laid perpendicular to the lane's local centreline heading, which
 * bends through the junction connector blend — and every signal head hung
 * from a mast on the near corner, directly above the waiting car, where the
 * driver cannot see their own light. Bars must sit square to the road, and
 * NYC masts must stand across the junction from the approach they govern.
 */

const wrapRad = (angle: number): number => {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};

/** Mirrors the renderer's resolveLaneAnchor arc walk. */
const anchorPose = (
  lane: LaneSegment,
  distanceAlongM: number,
): { x: number; z: number; heading: number } | null => {
  let remaining = Math.max(0, distanceAlongM);
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const start = lane.centerline[index];
    const end = lane.centerline[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < 0.001) continue;
    if (remaining <= length || index === lane.centerline.length - 2) {
      const amount = Math.min(remaining, length) / length;
      return {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
      };
    }
    remaining -= length;
  }
  return null;
};

const stopBars = (pack: MapPack) => {
  const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const bars: {
    controlId: string;
    approachId: string;
    laneId: string;
    start: { x: number; z: number };
    end: { x: number; z: number };
    surface: (typeof pack.geometry.roadSurfaces)[number] | undefined;
    stop: { x: number; z: number; heading: number };
  }[] = [];
  for (const control of pack.laneGraph.controls) {
    for (const approach of control.approaches ?? []) {
      const lane = laneById.get(approach.stopLine.laneId);
      if (!lane) continue;
      const stop = anchorPose(lane, approach.stopLine.distanceAlongM);
      if (!stop) continue;
      const surface = pack.geometry.roadSurfaces?.find((candidate) =>
        candidate.laneIds.includes(lane.id),
      );
      const bar = signalStopBarSegment(stop, lane, surface);
      bars.push({
        controlId: control.id,
        approachId: approach.id,
        laneId: lane.id,
        ...bar,
        surface,
        stop,
      });
    }
  }
  return bars;
};

describe("signal stop bars (#149)", () => {
  it("paints every stop bar square to its road surface", () => {
    let checked = 0;
    for (const pack of MAP_PACKS) {
      for (const bar of stopBars(pack)) {
        if (!bar.surface) continue;
        const axis = roadAxisHeadingNear(bar.surface.centerline, bar.stop);
        if (axis === null) continue;
        const barDirection = Math.atan2(
          bar.end.x - bar.start.x,
          bar.end.z - bar.start.z,
        );
        checked += 1;
        // A bar square to the road is perpendicular to the surface axis.
        expect(
          Math.abs(Math.cos(barDirection - axis)),
          `${pack.id}/${bar.controlId}/${bar.approachId}`,
        ).toBeLessThan(0.02);
      }
    }
    expect(checked, "signal approaches with surfaces").toBeGreaterThan(40);
  });

  it("keeps NYC's grid stop bars exactly axis-aligned", () => {
    // The issue's screenshot: the two Amsterdam approach bars tilted ±7.2deg
    // into a shallow V at the road centre. On an orthogonal grid every bar
    // must run exactly east-west or north-south.
    const pack = getMapPack("nyc-upper-west-side");
    const bars = stopBars(pack);
    expect(bars.length).toBeGreaterThan(30);
    for (const bar of bars) {
      const dx = Math.abs(bar.end.x - bar.start.x);
      const dz = Math.abs(bar.end.z - bar.start.z);
      expect(
        Math.min(dx, dz),
        `${bar.controlId}/${bar.approachId} off-axis drift`,
      ).toBeLessThan(0.005);
    }
  });

  it("merges parallel one-way lanes' bars into one continuous line", () => {
    // The junction in the issue screenshot was Amsterdam & 79th: where an
    // avenue runs two lanes the same way into one signal approach, their bars
    // must sit on a single line with overlapping spans rather than reading as
    // two stubs. Every such approach on the map has to hold, not just that one.
    const pack = getMapPack("nyc-upper-west-side");
    const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
    // One bar per approach, so parallel lanes are separate approaches of the
    // same control. Group by junction and direction of travel: that is exactly
    // the set of bars that has to read as one painted line.
    const headingOf = (laneId: string) => {
      const lane = laneById.get(laneId)!;
      const from = lane.centerline[0];
      const to = lane.centerline[lane.centerline.length - 1];
      return Math.atan2(to.x - from.x, to.z - from.z);
    };
    const byArm = new Map<string, ReturnType<typeof stopBars>>();
    for (const bar of stopBars(pack)) {
      const octant =
        ((Math.round(headingOf(bar.laneId) / (Math.PI / 4)) % 8) + 8) % 8;
      const key = `${bar.controlId}|${octant}`;
      byArm.set(key, [...(byArm.get(key) ?? []), bar]);
    }
    let merged = 0;
    for (const [key, bars] of byArm) {
      if (bars.length < 2) continue;
      // The bars run across the lanes, so they share the coordinate on the
      // approach's own axis and overlap along the other.
      const alongZ = Math.abs(Math.cos(headingOf(bars[0].laneId))) > 0.5;
      const shared = bars.flatMap((bar) =>
        alongZ ? [bar.start.z, bar.end.z] : [bar.start.x, bar.end.x],
      );
      expect(Math.max(...shared) - Math.min(...shared), `${key} off-line`).toBeLessThan(0.005);
      const spans = bars
        .map((bar) =>
          (alongZ ? [bar.start.x, bar.end.x] : [bar.start.z, bar.end.z]).sort(
            (a, b) => a - b,
          ),
        )
        .sort((a, b) => a[0] - b[0]);
      for (let index = 1; index < spans.length; index += 1) {
        expect(
          spans[index - 1][1] - spans[index][0],
          `${key} bars overlap into one line`,
        ).toBeGreaterThan(0);
      }
      merged += 1;
    }
    expect(merged, "multi-lane signal approaches").toBeGreaterThan(0);
  });
});

describe("NYC signal masts (#149)", () => {
  const pack = getMapPack("nyc-upper-west-side");
  const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
  const signals = pack.laneGraph.controls.filter(
    (control) => control.type === "signal",
  );

  it("stands every mast across the junction from its approach", () => {
    expect(signals.length).toBeGreaterThan(10);
    for (const control of signals) {
      const approachById = new Map(
        (control.approaches ?? []).map((approach) => [approach.id, approach]),
      );
      for (const installation of control.installations ?? []) {
        const approachIds = installation.approachIds ?? [];
        expect(approachIds.length, `${installation.id} approaches`).toBeGreaterThan(0);
        for (const approachId of approachIds) {
          const approach = approachById.get(approachId);
          expect(approach, `${installation.id} -> ${approachId}`).toBeDefined();
          const lane = laneById.get(approach!.stopLine.laneId)!;
          const first = lane.centerline[0];
          const last = lane.centerline[lane.centerline.length - 1];
          const length = Math.hypot(last.x - first.x, last.z - first.z);
          const travelX = (last.x - first.x) / length;
          const travelZ = (last.z - first.z) / length;
          const forward =
            (installation.position.x - control.position.x) * travelX +
            (installation.position.z - control.position.z) * travelZ;
          // The pole must stand past the node in the direction of travel —
          // the driver waiting at the stop line looks across the junction at
          // their own light, the way NYC mounts its signals.
          expect(forward, `${installation.id} forward of node`).toBeGreaterThan(4);
        }
      }
      const approachesCovered = (control.installations ?? []).flatMap(
        (installation) => installation.approachIds ?? [],
      );
      expect(new Set(approachesCovered).size, `${control.id} coverage`).toBe(
        (control.approaches ?? []).length,
      );
    }
  });

  it("gives each approach direction exactly one mast, clear of the others", () => {
    for (const control of signals) {
      const installations = control.installations ?? [];
      for (let a = 0; a < installations.length; a += 1) {
        expect(
          Math.abs(installations[a].headingDeg % 90),
          `${installations[a].id} grid heading`,
        ).toBeLessThan(1e-6);
        for (let b = a + 1; b < installations.length; b += 1) {
          const gap = Math.hypot(
            installations[a].position.x - installations[b].position.x,
            installations[a].position.z - installations[b].position.z,
          );
          expect(gap, `${installations[a].id} vs ${installations[b].id}`).toBeGreaterThan(1);
        }
      }
    }
  });
});

describe("roadAxisHeadingNear", () => {
  it("returns the nearest segment's heading", () => {
    const polyline = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    expect(roadAxisHeadingNear(polyline, { x: 5, z: 1 })).toBeCloseTo(Math.PI / 2, 6);
    expect(roadAxisHeadingNear(polyline, { x: 11, z: 8 })).toBeCloseTo(0, 6);
    expect(
      Math.abs(wrapRad(roadAxisHeadingNear(polyline, { x: 2, z: -3 })! - Math.PI / 2)),
    ).toBeLessThan(1e-6);
  });

  it("returns null without a usable segment", () => {
    expect(roadAxisHeadingNear([], { x: 0, z: 0 })).toBeNull();
    expect(roadAxisHeadingNear([{ x: 1, z: 1 }], { x: 0, z: 0 })).toBeNull();
    expect(
      roadAxisHeadingNear([{ x: 1, z: 1 }, { x: 1, z: 1 }], { x: 0, z: 0 }),
    ).toBeNull();
  });
});

describe("enforcement camera placement", () => {
  const MAST_POLE_HEIGHT = SIGNAL_MAST.poleHeightM;
  const POLE_HEIGHT = SIGNAL_MAST.kerbsidePoleHeightM;

  it("looks back down the approach, the way the signal head it shares does", () => {
    // Heading is the direction of travel of the approach. The driver it is
    // for is coming toward +z, so the glass has to be on the -z side of the
    // body — pointed at them, not away up an empty road.
    const placed = trafficCameraPlacement(
      { position: { x: 0, z: 0 }, headingDeg: 0, armHeadingDeg: 180, mounting: "mast_arm" },
      MAST_POLE_HEIGHT,
      6,
    );
    expect(placed.yaw).toBeCloseTo(0, 6);
    expect(placed.lens.z).toBeLessThan(placed.z);
    expect(placed.lens.z).toBeCloseTo(placed.z - TRAFFIC_CAMERA_BODY.lensForwardM, 6);

    // And a quarter turn round, the same relation holds on the other axis.
    const east = trafficCameraPlacement(
      { position: { x: 0, z: 0 }, headingDeg: 90, armHeadingDeg: 270, mounting: "roadside_pole" },
      POLE_HEIGHT,
      0,
    );
    expect(east.lens.x).toBeLessThan(east.x);
  });

  it("rests on the arm rather than hovering over it", () => {
    const span = 6;
    const placed = trafficCameraPlacement(
      { position: { x: 0, z: 0 }, headingDeg: 0, armHeadingDeg: 0, mounting: "mast_arm" },
      MAST_POLE_HEIGHT,
      span,
    );
    // It shipped 17 cm in the air, because the placement measured from the top
    // of the *pole* while the arm hangs a full thickness below it. The bottom
    // of the housing has to be on the arm's upper surface — a shade into it, so
    // no seam shows, and never above it.
    const armTop = mastArmTopY(MAST_POLE_HEIGHT);
    expect(armTop).toBeCloseTo(MAST_POLE_HEIGHT - SIGNAL_MAST.armThicknessM / 2, 6);
    const bottom = placed.y - TRAFFIC_CAMERA_BODY.housing.height / 2;
    expect(bottom).toBeLessThanOrEqual(armTop);
    expect(armTop - bottom).toBeLessThan(0.05);
    // The head hangs at `span - 0.45` along the same arm. The camera must be
    // clearly inboard of it or the two read as one lump of hardware.
    expect(Math.hypot(placed.x, placed.z)).toBeLessThan(span - 0.45 - 1);
    // And well over anything driving under it.
    expect(bottom).toBeGreaterThan(4.6);
  });

  it("beds a kerbside camera into the pole it is bolted to", () => {
    const placed = trafficCameraPlacement(
      { position: { x: 0, z: 0 }, headingDeg: 0, mounting: "roadside_pole" },
      POLE_HEIGHT,
      0,
    );
    // Bolted on, which is two bounds, not one: the housing's centre has to be
    // outside the shaft or the pole skewers it, and its back face has to reach
    // the shaft's surface or the camera hangs in the air beside the pole.
    const shaft = SIGNAL_MAST.kerbsidePoleDiameterM / 2;
    const offset = Math.hypot(placed.x, placed.z);
    expect(offset).toBeGreaterThan(shaft);
    expect(offset - TRAFFIC_CAMERA_BODY.housing.depth / 2).toBeLessThanOrEqual(shaft);
    // And the bottom of it has to clear the top of the signal head below,
    // which hangs centred at `poleHeight - 0.95` and stands 1.48 tall.
    const headTop = POLE_HEIGHT - 0.95 + 1.48 / 2;
    expect(placed.y - TRAFFIC_CAMERA_BODY.housing.height / 2).toBeGreaterThan(
      headTop,
    );
    expect(placed.y).toBeLessThan(POLE_HEIGHT);
  });

  it("puts a camera on every approach a watched junction actually books", () => {
    // Enforcement is per control: cross the line on red on *any* arm of an
    // equipped junction and you are fined. The props were hung per
    // `role: "primary"` head, and London's southbound Queen's Gate arm is
    // signalled only by a secondary pole — so that approach was ticketed by a
    // camera standing nowhere on the road the driver could see.
    let checked = 0;
    for (const mapId of ["nyc-upper-west-side", "london-south-kensington"]) {
      const pack = getMapPack(mapId as MapPack["id"]);
      const equipped = trafficCameraControlIds(
        pack.laneGraph.controls
          .filter((control) => control.type === "signal")
          .map((control) => control.id),
      );
      for (const control of pack.laneGraph.controls) {
        if (!equipped.has(control.id)) continue;
        const withCamera = trafficCameraHeadIds(control);
        expect(withCamera.size, `${control.id} has cameras`).toBeGreaterThan(0);
        for (const approach of control.approaches) {
          const served = control.installations.some(
            (head) =>
              withCamera.has(head.id) &&
              (head.approachIds ?? []).includes(approach.id),
          );
          expect(served, `${mapId}/${approach.id} is booked but unwatched`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked, "approaches checked").toBeGreaterThan(0);
  });

  it("watches oncoming traffic on every shipped map, and from across the junction on a mast", () => {
    for (const mapId of ["nyc-upper-west-side", "london-south-kensington"]) {
      const pack = getMapPack(mapId as MapPack["id"]);
      const laneById = new Map(pack.laneGraph.lanes.map((lane) => [lane.id, lane]));
      const equipped = trafficCameraControlIds(
        pack.laneGraph.controls
          .filter((control) => control.type === "signal")
          .map((control) => control.id),
      );
      let checked = 0;
      for (const control of pack.laneGraph.controls) {
        if (!equipped.has(control.id)) continue;
        const withCamera = trafficCameraHeadIds(control);
        for (const installation of control.installations) {
          if (!withCamera.has(installation.id)) continue;
          const mast = installation.mounting === "mast_arm";
          const placed = trafficCameraPlacement(
            installation,
            mast ? MAST_POLE_HEIGHT : POLE_HEIGHT,
            mast ? Math.max(4.8, Math.min(8.5, pack.geometry.roadWidth * 0.68)) : 0,
          );
          for (const approachId of installation.approachIds ?? []) {
            const approach = control.approaches.find((a) => a.id === approachId);
            const lane = approach && laneById.get(approach.stopLine.laneId);
            if (!approach || !lane) continue;
            const stop = anchorPose(lane, approach.stopLine.distanceAlongM);
            if (!stop) continue;
            // The glass looks along -Z through the yaw, and it has to look
            // into the flow: a camera turned the way the traffic goes films
            // the boots of cars leaving the junction.
            const facingX = -Math.sin(placed.yaw);
            const facingZ = -Math.cos(placed.yaw);
            const travelX = Math.sin(stop.heading);
            const travelZ = Math.cos(stop.heading);
            expect(
              facingX * travelX + facingZ * travelZ,
              `${mapId}/${control.id}/${approachId} looks the way the cars go`,
            ).toBeLessThan(-0.9);
            // A mast camera hangs across the junction, so the line it books is
            // genuinely in front of it. That is what the 1.9 m inset back from
            // the head must not undo. A kerbside signal is a near-side one —
            // the car stops level with the pole — so the same is not asked of
            // it, only that it is standing close to the line it watches.
            const toStopX = stop.x - placed.x;
            const toStopZ = stop.z - placed.z;
            const along = facingX * toStopX + facingZ * toStopZ;
            if (installation.mounting === "mast_arm") {
              expect(
                along,
                `${mapId}/${control.id}/${approachId} sits past its stop line`,
              ).toBeGreaterThan(0);
            } else {
              expect(
                Math.hypot(toStopX, toStopZ),
                `${mapId}/${control.id}/${approachId} stands away from its line`,
              ).toBeLessThan(12);
            }
            checked += 1;
          }
        }
      }
      expect(checked, `${mapId} cameras checked`).toBeGreaterThan(0);
    }
  });
});

/**
 * A building whose base plate is level with the ground plane or the pavement
 * gives the depth buffer two coplanar surfaces to choose between, and it picks
 * differently as the camera moves: the pale ground shimmers through the dark
 * band the facade texture paints along the bottom of every building. The
 * instanced glb wall was lifted clear when it was written. The procedural
 * facade boxes were not, and every call site passed height/2 -- base plate
 * exactly on y=0 -- so the clearance is applied inside `createFacadeBox` where
 * a new call site cannot miss it.
 */
describe("building base clearance", () => {
  it("keeps every facade off the ground and pavement planes", () => {
    expect(BUILDING_BASE_CLEARANCE_M).toBeGreaterThan(0.02);
  });
});
