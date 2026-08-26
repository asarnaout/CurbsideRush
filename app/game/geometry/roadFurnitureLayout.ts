import { resolveSimulationLaneAnchor } from "../laneAnchors";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import { DEFAULT_SERVICE_SETBACK_M } from "../servicePoints";
import type { PropScatterRect } from "../visuals";
import { railCorridorExclusionRects } from "./railGeometry";
import { nearestPointOnPolyline, roadAxisHeadingNear } from "./roadStrips";

/**
 * Road furniture placement: stop bars, signal masts, enforcement cameras,
 * crosswalk stripes, the yellow signal-border bars, and where a marking sits
 * on the road surface it paints.
 *
 * Pure by design — no Babylon, no DOM — so this geometry can be pinned in
 * plain node tests without instantiating a scene. `tests/architecture.test.ts`
 * enforces that this stays true for every file under `geometry/`. The
 * VertexData-producing marking-mesh builders (`appendMarkingBox` and
 * siblings) are NOT here despite the shared "marking" name — they construct
 * real Babylon `VertexData`, so they live in `render/meshPrimitives.ts`.
 */

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface RoadMarkingSegmentPlacement {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly lengthM: number;
  readonly yawRad: number;
  readonly pitchRad: number;
}

/** World transform for a painted segment laid on a possibly sloped road. */
export function roadMarkingSegmentPlacement(
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  surfaceOffsetY: number,
): RoadMarkingSegmentPlacement | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const planLengthM = Math.hypot(dx, dz);
  if (planLengthM < 0.01) return null;
  const startElevationM = start.elevationM ?? 0;
  const endElevationM = end.elevationM ?? 0;
  const elevationDeltaM = endElevationM - startElevationM;
  return {
    center: {
      x: (start.x + end.x) / 2,
      y: surfaceOffsetY + (startElevationM + endElevationM) / 2,
      z: (start.z + end.z) / 2,
    },
    lengthM: Math.hypot(planLengthM, elevationDeltaM),
    yawRad: Math.atan2(dx, dz),
    // Local +Z points start->end after yaw. Babylon's X rotation raises +Z
    // with a negative angle.
    pitchRad: -Math.atan2(elevationDeltaM, planLengthM),
  };
}

/** Marking styles that run along a road, and so break where one crosses. */
export const LANE_PAINT_STYLES = new Set([
  "centre_solid",
  "centre_dashed",
  "lane_solid",
  "lane_dashed",
  "edge_solid",
]);
/**
 * World-space segment for a signal approach's painted stop bar.
 *
 * The bar is anchored at the lane's stop point but laid square to the road
 * surface's centreline, not the lane's local heading: a laneTrue centreline
 * eases onto the shared junction node over its last few metres, and a bar
 * perpendicular to that blended heading renders visibly slanted — adjacent
 * lanes' bars kink into a shallow V at the road centre (#149).
 *
 * Lane widths are authored much narrower than the painted carriageway, so a
 * half-lane-width bar reads as a short stub floating mid-lane. A centre line
 * means a two-way road: the bar runs from the centre line to the near kerb so
 * it never paints across the oncoming side. A one-way road (lane dividers
 * only) gets a bar spanning the lane, widened toward the road edge — so
 * adjacent lanes' bars meet into one continuous line — capped at the
 * carriageway half-width so it never spills onto the shoulder.
 */
export function signalStopBarSegment(
  stop: {
    readonly x: number;
    readonly z: number;
    readonly elevationM?: number;
    readonly heading: number;
  },
  lane: { readonly widthM?: number },
  surface:
    | {
        readonly centerline: readonly GameCanvasPoint[];
        readonly widthM: number;
        readonly markings?: readonly { readonly style: string }[];
      }
    | undefined,
): { readonly start: GameCanvasPoint; readonly end: GameCanvasPoint } {
  const roadHalfWidth = (surface?.widthM ?? lane.widthM ?? 3.2) / 2;
  const axis = surface ? roadAxisHeadingNear(surface.centerline, stop) : null;
  // Align the road axis with the lane's travel direction so `side` stays the
  // driver's right regardless of which way the surface was authored.
  const barHeading =
    axis === null
      ? stop.heading
      : Math.abs(Math.atan2(Math.sin(axis - stop.heading), Math.cos(axis - stop.heading))) >
          Math.PI / 2
        ? axis + Math.PI
        : axis;
  const sideX = Math.cos(barHeading);
  const sideZ = -Math.sin(barHeading);
  const twoWay = (surface?.markings ?? []).some(
    (marking) => marking.style === "centre_solid" || marking.style === "centre_dashed",
  );
  if (twoWay && surface) {
    const centre = nearestPointOnPolyline(stop, surface.centerline);
    const towardKerb =
      (stop.x - centre.x) * sideX + (stop.z - centre.z) * sideZ >= 0 ? 1 : -1;
    return {
      start: centre,
      end: {
        x: centre.x + towardKerb * roadHalfWidth * sideX,
        z: centre.z + towardKerb * roadHalfWidth * sideZ,
        ...(centre.elevationM !== undefined
          ? { elevationM: centre.elevationM }
          : {}),
      },
    };
  }
  const halfWidth = Math.min((lane.widthM ?? 3.2) / 2 + 1.4, roadHalfWidth);
  return {
    start: {
      x: stop.x - sideX * halfWidth,
      z: stop.z - sideZ * halfWidth,
      ...(stop.elevationM !== undefined
        ? { elevationM: stop.elevationM }
        : {}),
    },
    end: {
      x: stop.x + sideX * halfWidth,
      z: stop.z + sideZ * halfWidth,
      ...(stop.elevationM !== undefined
        ? { elevationM: stop.elevationM }
        : {}),
    },
  };
}

/**
 * The signal hardware a camera has to sit on. Shared with
 * `buildSignalInstallation`, which builds the pole and arm from these same
 * figures — the camera hangs off geometry it does not own, and reading the
 * numbers from a second copy is how it ended up floating 17 cm over the arm.
 *
 * Note the arm's centre hangs a full thickness below the top of the mast, so
 * its upper surface is at `poleHeight - armThicknessM / 2` — *not* at
 * `poleHeight`, which is the trap.
 */
export const SIGNAL_MAST = {
  poleHeightM: 5.4,
  poleDiameterM: 0.22,
  armThicknessM: 0.18,
  kerbsidePoleHeightM: 3.7,
  kerbsidePoleDiameterM: 0.17,
} as const;

/** The upper surface of a mast arm hung from a pole of `poleHeight`. */
export function mastArmTopY(poleHeight: number): number {
  return poleHeight - SIGNAL_MAST.armThicknessM / 2;
}

/**
 * The enforcement camera's body: a squat housing under a rain hood. Every
 * figure is shared between the mesh and `trafficCameraPlacement` below, so the
 * lens can never drift off the front of the box it is set into.
 *
 * There is no bracket. One merged master serves both mountings, and a stub can
 * only point one way: backwards into a kerbside pole leaves it stuck out in
 * mid-air over a mast arm, which is exactly how it shipped and looked wrong.
 * The housing seats directly against what holds it instead — resting on the arm
 * over the carriageway, bedded into the shaft at the kerb — which needs no stub
 * at all and cannot leave a gap.
 */
export const TRAFFIC_CAMERA_BODY = {
  housing: { width: 0.3, height: 0.24, depth: 0.44 },
  hood: { width: 0.34, height: 0.05, depth: 0.32 },
  /** How far forward of the body centre the glass sits. */
  lensForwardM: 0.23,
  /** How far back along a mast arm the camera stands from the signal head. */
  armInsetM: 1.9,
  /** How far the housing beds into whatever carries it, so no seam shows. */
  seatM: 0.02,
  /**
   * Drop below the top of a kerbside pole, and how far the body steps off it.
   *
   * The drop is small because there is very little pole left to use: a kerbside
   * head hangs centred at `poleHeight - 0.95` and is 1.48 tall, so it already
   * reaches to within 0.21 m of the top. The camera goes in the gap above it.
   *
   * The step is set so the *back face* lands just inside the shaft — clear of
   * the pole's centre so the camera is not skewered by it, but not beyond the
   * shaft's surface either, or it hangs in the air off the side.
   */
  poleDropM: 0.08,
  poleClearM: 0.28,
} as const;

/**
 * Which of an equipped junction's signal heads carry a camera: one per approach
 * it enforces, deduped, because a head often serves several approaches.
 *
 * Not simply "the primary heads", which is what it was. Enforcement is per
 * control — every approach of a watched junction is booked — but the props were
 * hung per `role: "primary"` head, and London's southbound Queen's Gate arm is
 * signalled only by a `secondary` pole. That approach was ticketed by a camera
 * standing nowhere, which is the one thing a visible rule must never do.
 *
 * The fallback covers a junction whose heads name no approaches at all: better
 * a camera on every primary than an enforced junction with nothing on it.
 */
export function trafficCameraHeadIds(control: {
  readonly approaches?: readonly { readonly id: string }[];
  readonly installations?: readonly {
    readonly id: string;
    readonly style: string;
    readonly role: string;
    readonly approachIds?: readonly string[];
  }[];
}): ReadonlySet<string> {
  const heads = (control.installations ?? []).filter(
    (candidate) =>
      candidate.style === "nyc_signal" ||
      candidate.style === "uk_signal" ||
      candidate.style === "egypt_signal",
  );
  const chosen = new Set<string>();
  for (const approach of control.approaches ?? []) {
    const serving = heads.filter((head) =>
      (head.approachIds ?? []).includes(approach.id),
    );
    const pick = serving.find((head) => head.role === "primary") ?? serving[0];
    if (pick) chosen.add(pick.id);
  }
  if (chosen.size === 0) {
    for (const head of heads) if (head.role === "primary") chosen.add(head.id);
  }
  return chosen;
}

export interface TrafficCameraPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw of the body, matching the signal head so the glass looks at oncoming traffic. */
  readonly yaw: number;
  /** Where the glass itself lands, for the lens instance set into the front. */
  readonly lens: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Where an enforcement camera stands on the signal it watches.
 *
 * It takes the head's own yaw rather than deriving one. A head's lenses hang on
 * its local -Z and it is turned by the approach's direction of travel, which
 * puts the glass facing back down the road at the driver being signalled — the
 * same thing a camera has to look at, so the two are the same number. This is
 * the relation `regulatorySigns.ts` spells out for DO NOT ENTER: a sign (or a
 * lens) meant for the driver coming at you faces into the flow.
 *
 * Over the carriageway it rests on the mast arm's upper surface, back from the
 * head so the two read as separate hardware. On a kerbside pole there is no arm
 * to stand on, so it goes in the gap above the head, bedded into the shaft.
 * Either way the housing touches its mount: nothing here floats.
 */
export function trafficCameraPlacement(
  installation: {
    readonly position: GameCanvasPoint;
    readonly headingDeg: number;
    readonly armHeadingDeg?: number;
    readonly mounting: string;
  },
  poleHeight: number,
  armSpanM: number,
): TrafficCameraPlacement {
  const yaw = degreesToRadians(installation.headingDeg);
  // The direction the glass looks: local -Z through a yaw about Y.
  const facingX = -Math.sin(yaw);
  const facingZ = -Math.cos(yaw);
  const base = installation.position;
  const baseElevationM = base.elevationM ?? 0;
  let x: number;
  let z: number;
  let y: number;
  if (installation.mounting === "mast_arm") {
    const armHeading = degreesToRadians(
      installation.armHeadingDeg ?? installation.headingDeg,
    );
    const along = Math.max(0, armSpanM - TRAFFIC_CAMERA_BODY.armInsetM);
    x = base.x + Math.cos(armHeading) * along;
    z = base.z - Math.sin(armHeading) * along;
    // Sat on the arm's upper surface, bedded in a shade so no seam shows.
    y =
      baseElevationM +
      mastArmTopY(poleHeight) +
      TRAFFIC_CAMERA_BODY.housing.height / 2 -
      TRAFFIC_CAMERA_BODY.seatM;
  } else {
    x = base.x + facingX * TRAFFIC_CAMERA_BODY.poleClearM;
    z = base.z + facingZ * TRAFFIC_CAMERA_BODY.poleClearM;
    y = baseElevationM + poleHeight - TRAFFIC_CAMERA_BODY.poleDropM;
  }
  return {
    x,
    y,
    z,
    yaw,
    lens: {
      x: x + facingX * TRAFFIC_CAMERA_BODY.lensForwardM,
      y,
      z: z + facingZ * TRAFFIC_CAMERA_BODY.lensForwardM,
    },
  };
}
export interface CrosswalkStripeLayout {
  readonly center: GameCanvasPoint;
  readonly widthM: number;
  readonly depthM: number;
  readonly rotationY: number;
}

/** Zebra stripes progress with traffic; each long bar spans across traffic. */
export function crosswalkStripeLayout(
  position: GameCanvasPoint,
  headingDeg: number,
  roadWidthM: number,
): readonly CrosswalkStripeLayout[] {
  const heading = degreesToRadians(headingDeg);
  const travelX = Math.sin(heading);
  const travelZ = Math.cos(heading);
  return Array.from({ length: 7 }, (_, index) => {
    const stripe = index - 3;
    return {
      center: {
        x: position.x + travelX * stripe * 1.05,
        z: position.z + travelZ * stripe * 1.05,
        ...(position.elevationM !== undefined
          ? { elevationM: position.elevationM }
          : {}),
      },
      // A box's local +x maps to (cos yaw, -sin yaw): perpendicular to the
      // travel vector above when yaw equals the compass heading.
      widthM: roadWidthM * 0.82,
      depthM: 0.62,
      rotationY: heading,
    };
  });
}

/** The black lamp housing every authored signal head is built around. */
export const SIGNAL_HOUSING_BOX = {
  width: 0.58,
  height: 1.48,
  depth: 0.42,
} as const;

export interface SignalBorderBar {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Cairo's yellow surround, as four bars around the face rather than one box.
 *
 * It used to be a single 0.7 x 1.6 x 0.44 box at z +0.015 — larger than the
 * housing in **all three** dimensions, so it enclosed the head completely and
 * the entire black-face-with-a-yellow-border look rested on the housing's front
 * face protruding 5 mm. Depth precision at any distance beats 5 mm, so the
 * yellow swallowed the head: a solid amber slab that flickered as you drove and
 * only settled once you were stopped at the bar.
 *
 * These bars sit strictly *outside* the housing footprint, so no two surfaces
 * ever contend for the same pixel and there is no epsilon left to lose. They
 * meet the housing edge-on at x ±0.29 / y ±0.74; touching faces point away from
 * each other, which is ordinary adjacency, not overlap.
 */
export const EGYPT_SIGNAL_BORDER_BARS: readonly SignalBorderBar[] = (() => {
  const thickness = 0.06;
  const halfWidth = SIGNAL_HOUSING_BOX.width / 2;
  const halfHeight = SIGNAL_HOUSING_BOX.height / 2;
  // Proud of the black face (-0.21) but behind the lens plane (-0.25), so the
  // border reads as a bezel without touching either.
  const z = -0.19;
  const depth = 0.08;
  return [
    {
      id: "left",
      x: -(halfWidth + thickness / 2),
      y: 0,
      z,
      width: thickness,
      height: SIGNAL_HOUSING_BOX.height + thickness * 2,
      depth,
    },
    {
      id: "right",
      x: halfWidth + thickness / 2,
      y: 0,
      z,
      width: thickness,
      height: SIGNAL_HOUSING_BOX.height + thickness * 2,
      depth,
    },
    {
      id: "top",
      x: 0,
      y: halfHeight + thickness / 2,
      z,
      width: SIGNAL_HOUSING_BOX.width,
      height: thickness,
      depth,
    },
    {
      id: "bottom",
      x: 0,
      y: -(halfHeight + thickness / 2),
      z,
      width: SIGNAL_HOUSING_BOX.width,
      height: thickness,
      depth,
    },
  ];
})();

export function roadSurfaceWidthForMarking(
  mapPack: GameCanvasMapPack,
  control: GameCanvasMapPack["laneGraph"]["controls"][number],
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
): number {
  return roadSurfacePlacementForMarking(
    mapPack,
    control,
    installation,
  ).widthM;
}

export interface RoadSurfaceMarkingPlacement {
  readonly position: GameCanvasPoint;
  readonly widthM: number;
  readonly surfaceId?: string;
}

export function roadSurfacePlacementForMarking(
  mapPack: GameCanvasMapPack,
  control: GameCanvasMapPack["laneGraph"]["controls"][number],
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
): RoadSurfaceMarkingPlacement {
  const allowedApproaches = new Set(installation.approachIds ?? []);
  const candidates = (control.approaches ?? [])
    .filter(
      (approach) =>
        allowedApproaches.size === 0 || allowedApproaches.has(approach.id),
    )
    .flatMap((approach) =>
      approach.laneIds.flatMap((laneId) => {
        const lane = mapPack.laneGraph.lanes.find(
          (candidate) => candidate.id === laneId,
        );
        if (!lane || lane.centerline.length < 2) return [];
        const start = lane.centerline[lane.centerline.length - 2];
        const end = lane.centerline[lane.centerline.length - 1];
        const laneHeading = Math.atan2(end.x - start.x, end.z - start.z);
        const target = degreesToRadians(installation.headingDeg);
        const delta = Math.abs(
          Math.atan2(Math.sin(laneHeading - target), Math.cos(laneHeading - target)),
        );
        return [{ lane, delta }];
      }),
    )
    .sort((a, b) => a.delta - b.delta);
  const lane = candidates[0]?.lane;
  const surface = mapPack.geometry.roadSurfaces?.find(
    (candidate) =>
      candidate.id === lane?.roadId ||
      (lane ? candidate.laneIds.includes(lane.id) : false),
  );
  return {
    position: surface
      ? nearestPointOnPolyline(installation.position, surface.centerline)
      : installation.position,
    widthM:
      installation.spanM ?? surface?.widthM ?? mapPack.geometry.roadWidth,
    surfaceId: surface?.id,
  };
}

/**
 * Ground the roadside prop scatter must keep off, bucketed by how hard the
 * rule is.
 *
 * This exists as a function because getting the buckets wrong is invisible
 * until someone drives past it. The scatter's `landmarks` input has always
 * been three different things unioned into one array — authored landmark
 * rects, the rail right-of-way, and service/venue keep-outs — and once
 * kerb-seated props (`PropKindConfig.curbOffsetM`) gained an exemption from
 * "rects drawn over a road", that union quietly handed the exemption to the
 * rail corridor too. A rail corridor crosses a carriageway BY CONSTRUCTION at
 * every level crossing, so the next scatter stood a lit lamp post between the
 * rails: four in Cairo, five in Tokyo, one in London, owner-reported. The
 * split is the fix, and `tests/roadsidePropKeepOuts.test.ts` is what keeps it
 * split.
 *
 * - `hardRects` — nothing stands here, however it is seated.
 * - `roadCrossedRects` — parks. A carriageway legitimately runs through one
 *   (Serpentine Road crosses 749 m of London's royal park), so a kerb-seated
 *   prop inside is standing on its own road's kerb; ordinary scatter still
 *   stops at the boundary, because a park lays its own planting.
 * - `poiRects` — the forecourt/venue subset on its own, because the corniche
 *   promenade line needs the same keep-out and takes it separately.
 *
 * Bridge landmarks are in NO bucket: their rect is an illustrative decoration
 * ON a carriageway spanning the land approaches too, and the carriageway test
 * already rejects scatter, so as an exclusion it only shadowed the kerb band —
 * that is what kept all three Sakuragawa bridges lampless end to end.
 */
export interface RoadsidePropKeepOuts {
  readonly hardRects: readonly PropScatterRect[];
  readonly roadCrossedRects: readonly PropScatterRect[];
  readonly poiRects: readonly PropScatterRect[];
}

/** Square span reserved around a service point's set-back model centre. */
const SERVICE_KEEP_OUT_SPAN_M = 22;
/** …and around a gig venue's, whose lot is smaller. */
const VENUE_KEEP_OUT_SPAN_M = 13;
const VENUE_DEFAULT_SETBACK_M = 13;

export function roadsidePropKeepOuts(
  mapPack: GameCanvasMapPack,
): RoadsidePropKeepOuts {
  const rect = (landmark: {
    center: GameCanvasPoint;
    size: GameCanvasPoint;
  }): PropScatterRect => ({ center: landmark.center, size: landmark.size });

  const poiRects = [
    ...(mapPack.geometry.servicePoints ?? []).map((service) => ({
      anchor: service.anchor,
      setbackM: service.setbackM ?? DEFAULT_SERVICE_SETBACK_M,
      spanM: SERVICE_KEEP_OUT_SPAN_M,
    })),
    ...(mapPack.geometry.gigVenues ?? []).map((venue) => ({
      anchor: venue.anchor,
      setbackM: venue.setbackM ?? VENUE_DEFAULT_SETBACK_M,
      spanM: VENUE_KEEP_OUT_SPAN_M,
    })),
  ].flatMap((poi) => {
    const pose = resolveSimulationLaneAnchor(mapPack.laneGraph.lanes, poi.anchor);
    if (!pose) return [];
    return [
      {
        center: {
          x: pose.x + Math.cos(pose.heading) * poi.setbackM,
          z: pose.z - Math.sin(pose.heading) * poi.setbackM,
        },
        size: { x: poi.spanM, z: poi.spanM },
      },
    ];
  });

  return {
    hardRects: [
      ...mapPack.geometry.landmarks
        .filter(
          (landmark) => landmark.kind !== "bridge" && landmark.kind !== "park",
        )
        .map(rect),
      ...railCorridorExclusionRects(mapPack.geometry.railLines ?? []),
      ...poiRects,
    ],
    roadCrossedRects: mapPack.geometry.landmarks
      .filter((landmark) => landmark.kind === "park")
      .map(rect),
    poiRects,
  };
}
