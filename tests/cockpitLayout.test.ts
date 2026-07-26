import { describe, expect, it } from "vitest";
import {
  COCKPIT_CLUSTER,
  COCKPIT_DASH_DRIVER_Z,
  COCKPIT_DASH_PROFILE,
  COCKPIT_EYE_Y,
  COCKPIT_GAUGE_CENTRES,
  COCKPIT_GAUGE_SWEEP_END,
  COCKPIT_GAUGE_SWEEP_START,
  COCKPIT_PILLAR_PROFILE,
  COCKPIT_PILLAR_X,
  COCKPIT_SCREEN,
  COCKPIT_VENT_SLOTS,
  REAR_VIEW_VIEWPORT,
  cameraPanelPlacement,
  cockpitCowlScreenFraction,
  cockpitScreenSpan,
  cockpitScreenTiltX,
  rearViewCssRect,
  resolveCockpitSteeringGeometry,
  resolveGaugeNeedleAngle,
  resolveWingMirrorPose,
  wingMirrorHeadRotation,
  wingMirrorIsVisible,
  wingMirrorOutline,
  wingMirrorScreenFraction,
  wingMirrorSide,
} from "../app/game/cockpitLayout";

const MIN_FOV = (55 * Math.PI) / 180;
const MAX_FOV = (100 * Math.PI) / 180;

describe("cockpit sightline", () => {
  // There is a "Restore first-person road visibility" commit in this repo's
  // history. The cowl is the part of the cabin that can swallow the road, so
  // pin it: anything at or below 0.5 keeps the crown in the lower half of the
  // frame and the carriageway clear above it.
  it("keeps the dash crown in the lower half at every allowed field of view", () => {
    for (const fov of [MIN_FOV, (72 * Math.PI) / 180, MAX_FOV]) {
      for (const aspect of [1.6, 1.86, 2.16]) {
        const fraction = cockpitCowlScreenFraction(fov, aspect);
        expect(fraction).toBeGreaterThan(0.5);
        expect(fraction).toBeLessThan(0.62);
      }
    }
  });

  it("keeps the whole dashboard below the driver's eye", () => {
    for (const point of COCKPIT_DASH_PROFILE) {
      expect(point.y).toBeLessThan(COCKPIT_EYE_Y);
    }
  });

  it("puts the A-pillars outboard of the road ahead", () => {
    // Measured from the driver's eye, which sits 0.46 off centre. The inner
    // face of the near pillar must stay well outside the middle of the view or
    // it starts hiding oncoming traffic rather than framing it.
    const seatSide = 0.46;
    const nearestZ = Math.min(...COCKPIT_PILLAR_PROFILE.map((p) => p.z));
    const lateral = COCKPIT_PILLAR_X - seatSide;
    const angle = Math.atan2(lateral, nearestZ - -0.6);
    expect(angle).toBeGreaterThan((14 * Math.PI) / 180);
  });
});

describe("cockpit dashboard profile", () => {
  it("keeps its closest point at the documented driver-side depth", () => {
    const closest = Math.min(...COCKPIT_DASH_PROFILE.map((p) => p.z));
    expect(closest).toBeCloseTo(COCKPIT_DASH_DRIVER_Z);
  });

  it("leaves the tilted steering rim in front of the dash", () => {
    const left = resolveCockpitSteeringGeometry("left");
    const rimRadius = left.wheelDiameter / 2 + left.rimThickness / 2;
    const deepestRimPoint =
      left.z + Math.abs(Math.cos(left.mountRotationX)) * rimRadius;
    expect(deepestRimPoint).toBeLessThan(COCKPIT_DASH_DRIVER_Z);
  });

  it("does not double back on itself", () => {
    // A swept prism with a self-intersecting section renders inside out in
    // places, and it is not obvious from a screenshot which face is wrong.
    const points = COCKPIT_DASH_PROFILE;
    for (let index = 0; index < points.length; index += 1) {
      const next = points[(index + 1) % points.length];
      const span = Math.hypot(next.y - points[index].y, next.z - points[index].z);
      expect(span).toBeGreaterThan(0.01);
    }
  });
});

describe("cockpit fittings mirror between drive sides", () => {
  it("mirrors the steering geometry exactly", () => {
    const left = resolveCockpitSteeringGeometry("left");
    const right = resolveCockpitSteeringGeometry("right");
    expect(left.x).toBe(-right.x);
    expect(left.y).toBe(right.y);
    expect(left.z).toBe(right.z);
    expect(left.mountRotationX).toBe(right.mountRotationX);
  });

  it("lays the vents out symmetrically about the centreline", () => {
    const xs = COCKPIT_VENT_SLOTS.map((slot) => slot.x);
    for (const x of xs) {
      expect(xs.some((other) => Math.abs(other + x) < 1e-9)).toBe(true);
    }
    expect(COCKPIT_VENT_SLOTS).toHaveLength(4);
  });

  it("stands every vent proud of the dash it sits on", () => {
    for (const slot of COCKPIT_VENT_SLOTS) {
      expect(slot.z).toBeGreaterThanOrEqual(COCKPIT_DASH_DRIVER_Z);
      expect(slot.width).toBeGreaterThan(0);
    }
  });
});

describe("gauge needles", () => {
  it("parks at the sweep start and tops out at the sweep end", () => {
    expect(resolveGaugeNeedleAngle(0, 40)).toBeCloseTo(COCKPIT_GAUGE_SWEEP_START);
    expect(resolveGaugeNeedleAngle(40, 40)).toBeCloseTo(COCKPIT_GAUGE_SWEEP_END);
  });

  it("clamps past both ends rather than winding round", () => {
    expect(resolveGaugeNeedleAngle(-8, 40)).toBeCloseTo(COCKPIT_GAUGE_SWEEP_START);
    expect(resolveGaugeNeedleAngle(400, 40)).toBeCloseTo(COCKPIT_GAUGE_SWEEP_END);
  });

  it("sweeps clockwise from the seat", () => {
    // Local +X is the driver's right and +Y is up, so a rising value has to
    // produce a falling rotation.z. Getting this backwards gives a needle that
    // drops as you accelerate, which reads as a broken gauge rather than a
    // mirrored one.
    expect(COCKPIT_GAUGE_SWEEP_START).toBeGreaterThan(COCKPIT_GAUGE_SWEEP_END);
    expect(resolveGaugeNeedleAngle(10, 40)).toBeGreaterThan(
      resolveGaugeNeedleAngle(30, 40),
    );
  });

  it("returns something sane for a zero range", () => {
    expect(resolveGaugeNeedleAngle(5, 0)).toBe(COCKPIT_GAUGE_SWEEP_START);
  });

  it("keeps both dials inside the faceplate", () => {
    for (const centre of COCKPIT_GAUGE_CENTRES) {
      expect(centre).toBeGreaterThan(0);
      expect(centre).toBeLessThan(1);
    }
    expect(COCKPIT_GAUGE_CENTRES).toHaveLength(2);
    expect(COCKPIT_CLUSTER.width).toBeGreaterThan(COCKPIT_CLUSTER.height);
  });
});

describe("windscreen", () => {
  it("rakes back as it rises", () => {
    expect(COCKPIT_SCREEN.headerY).toBeGreaterThan(COCKPIT_SCREEN.sillY);
    expect(COCKPIT_SCREEN.headerZ).toBeLessThan(COCKPIT_SCREEN.sillZ);
    expect(cockpitScreenSpan()).toBeGreaterThan(0.4);
  });

  it("tilts a plane onto the glass so its face points back at the driver", () => {
    const tilt = cockpitScreenTiltX();
    // A Babylon plane is authored facing -Z; after this rotation that face has
    // to point down and back, which is where the driver is.
    const facingY = Math.sin(tilt);
    const facingZ = -Math.cos(tilt);
    expect(facingY).toBeLessThan(0);
    expect(facingZ).toBeLessThan(0);
  });
});

describe("camera-locked mirror panel", () => {
  const rect = REAR_VIEW_VIEWPORT;

  it("covers the viewport rectangle it stands in for", () => {
    // The panel replaced a screen-space viewport, so its job is to occupy
    // exactly the same box. At distance d the frustum is 2*d*tan(fov/2) wide,
    // and the panel takes the rect's fraction of that.
    const distance = 0.12;
    const fov = (72 * Math.PI) / 180;
    const placement = cameraPanelPlacement(rect, fov, 1.86, distance);
    const frustumWidth = 2 * Math.tan(fov / 2) * distance;
    const frustumHeight = frustumWidth / 1.86;
    expect(placement.width).toBeCloseTo(frustumWidth * rect.width);
    expect(placement.height).toBeCloseTo(frustumHeight * rect.height);
  });

  it("puts the panel where the rectangle is, not in the middle", () => {
    const placement = cameraPanelPlacement(rect, (72 * Math.PI) / 180, 1.86, 0.12);
    // The rect is centred horizontally and high up, so the panel sits on the
    // centreline and above it.
    expect(placement.x).toBeCloseTo(0);
    expect(placement.y).toBeGreaterThan(0);
  });

  it("grows with the field of view and with the canvas", () => {
    const narrow = cameraPanelPlacement(rect, MIN_FOV, 1.86, 0.12);
    const wide = cameraPanelPlacement(rect, MAX_FOV, 1.86, 0.12);
    expect(wide.width).toBeGreaterThan(narrow.width);
    // A taller viewport (smaller aspect) means a taller frustum at the same
    // horizontal angle, so the panel has to grow vertically to keep its share.
    const tall = cameraPanelPlacement(rect, MIN_FOV, 1.6, 0.12);
    expect(tall.height).toBeGreaterThan(narrow.height);
    expect(tall.width).toBeCloseTo(narrow.width);
  });
});

describe("wing mirror", () => {
  it("sits on the driver's side and mirrors between drive sides", () => {
    expect(wingMirrorSide("left")).toBe(-1);
    expect(wingMirrorSide("right")).toBe(1);
    const left = wingMirrorScreenFraction((72 * Math.PI) / 180, "left");
    const right = wingMirrorScreenFraction((72 * Math.PI) / 180, "right");
    expect(left).toBeCloseTo(1 - right);
    expect(left).toBeLessThan(0.5);
  });

  it("is skipped once a narrow field of view pushes it off the edge", () => {
    // This is what stops the game rendering a whole extra pass for a mirror
    // that is a sliver at the frame edge, and it is the only reason the wing
    // mirror can exist at the bottom of the FOV range at all.
    expect(wingMirrorIsVisible(MIN_FOV, "left")).toBe(false);
    expect(wingMirrorIsVisible((72 * Math.PI) / 180, "left")).toBe(true);
    expect(wingMirrorIsVisible(MAX_FOV, "left")).toBe(true);
    expect(wingMirrorIsVisible(MIN_FOV, "right")).toBe(false);
  });

  it("moves with the car in world space", () => {
    const start = resolveWingMirrorPose({
      x: 0,
      z: 0,
      vehicleHeading: 0,
      steeringSide: "left",
    });
    const moved = resolveWingMirrorPose({
      x: 7,
      z: -3,
      vehicleHeading: 0,
      steeringSide: "left",
    });
    expect(moved.x - start.x).toBeCloseTo(7);
    expect(moved.z - start.z).toBeCloseTo(-3);
    expect(moved.y).toBeCloseTo(start.y);
  });

  it("hangs off the driver's flank and looks back past it", () => {
    const pose = resolveWingMirrorPose({
      x: 0,
      z: 0,
      vehicleHeading: 0,
      steeringSide: "left",
    });
    // Heading 0 is +z, so the driver's side of a left-hand-drive car is -x.
    expect(pose.x).toBeLessThan(0);
    expect(pose.z).toBeGreaterThan(0);
    // Looking back down the flank: behind the car, and splayed outboard of
    // straight back rather than parallel to it — the lane beside you is the
    // whole point, and a rear-view mirror already covers straight back.
    const back = Math.PI;
    expect(pose.rotationY).toBeGreaterThan(back);
    expect(pose.rotationY).toBeLessThan(back + Math.PI / 2);
    const right = resolveWingMirrorPose({
      x: 0,
      z: 0,
      vehicleHeading: 0,
      steeringSide: "right",
    });
    expect(right.x).toBeCloseTo(-pose.x);
    expect(right.rotationY - back).toBeCloseTo(-(pose.rotationY - back));
  });

  it("keeps its outline convex", () => {
    // createChamferedPanel fans the outline from its centre, which is only
    // valid for a convex shape — a concave point would fold a triangle back
    // over the glass and put a wedge of the reflection in the wrong place.
    const points = wingMirrorOutline("left");
    let sign = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const c = points[(index + 2) % points.length];
      const cross =
        (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross === 0) continue;
      const turn = Math.sign(cross);
      if (sign === 0) sign = turn;
      expect(turn).toBe(sign);
    }
    expect(sign).not.toBe(0);
  });

  it("mirrors its outline between drive sides without flipping the winding", () => {
    const left = wingMirrorOutline("left");
    const right = wingMirrorOutline("right");
    expect(right).toHaveLength(left.length);
    // Same shape reflected: every point on one side has its mirror on the
    // other. Negating x alone would reverse the winding and cull the glass
    // away entirely, which is why the reversal is undone.
    for (const point of left) {
      expect(
        right.some(
          (other) =>
            Math.abs(other.x + point.x) < 1e-9 &&
            Math.abs(other.y - point.y) < 1e-9,
        ),
      ).toBe(true);
    }
    const winding = (points: { x: number; y: number }[]) =>
      Math.sign(
        points.reduce((sum, a, index) => {
          const b = points[(index + 1) % points.length];
          return sum + (a.x * b.y - b.x * a.y);
        }, 0),
      );
    expect(winding(right)).toBe(winding(left));
  });

  it("stays inside the box it is normalised to", () => {
    for (const point of wingMirrorOutline("left")) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
    }
  });

  it("turns its head toward the seat, mirrored per drive side", () => {
    const left = wingMirrorHeadRotation("left");
    const right = wingMirrorHeadRotation("right");
    expect(left.y).toBeCloseTo(-right.y);
    expect(left.x).toBeCloseTo(right.x);
    // The eye is inboard and behind, so the head yaws away from straight ahead
    // by a real amount rather than sitting flat against the door.
    expect(Math.abs(left.y)).toBeGreaterThan(0.2);
  });
});

describe("rear-view mirror rectangle", () => {
  it("is the single source for the camera viewport and the HUD housing", () => {
    const rect = rearViewCssRect();
    expect(rect.leftPercent).toBeCloseTo(REAR_VIEW_VIEWPORT.x * 100);
    expect(rect.widthPercent).toBeCloseTo(REAR_VIEW_VIEWPORT.width * 100);
    expect(rect.heightPercent).toBeCloseTo(REAR_VIEW_VIEWPORT.height * 100);
    // Babylon measures its viewport from the bottom; CSS measures from the top.
    expect(rect.topPercent).toBeCloseTo(
      (1 - REAR_VIEW_VIEWPORT.y - REAR_VIEW_VIEWPORT.height) * 100,
    );
  });

  it("sits fully on screen", () => {
    const rect = rearViewCssRect();
    expect(rect.topPercent).toBeGreaterThan(0);
    expect(rect.topPercent + rect.heightPercent).toBeLessThan(100);
    expect(rect.leftPercent + rect.widthPercent).toBeLessThan(100);
  });
});
