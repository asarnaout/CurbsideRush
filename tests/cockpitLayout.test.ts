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
  cockpitCowlScreenFraction,
  cockpitScreenSpan,
  cockpitScreenTiltX,
  rearViewCssRect,
  resolveCockpitSteeringGeometry,
  resolveGaugeNeedleAngle,
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
