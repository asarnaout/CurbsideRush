import {
  Mesh,
  type Scene,
  type StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { createBox } from "./meshPrimitives";
import { boxLengthYaw } from "../geometry/cairoParkland";
import {
  offsetPolyline,
  polylineLengthM,
  polylinePoseAt,
  railBallastIntervals,
  RAIL_BALLAST_WIDTH_M,
  RAIL_HALF_GAUGE_M,
  railSleeperPlacements,
  slicePolyline,
  type RailInterval,
} from "../geometry/railGeometry";
import { RAIL_BALLAST_Y } from "./renderConstants";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";

/**
 * Ground track for authored rail lines: a ballast bed (segmented so the road
 * surface carries the deck through every level crossing), two running rails,
 * and instanced sleepers. Replaces the old `kind: "railway"` landmark decal,
 * which drew two fixed east-west boxes and could not follow a polyline.
 *
 * Everything built here is static scenery: rails and sleepers are instances
 * of one hidden master each (one draw call per master), pushed through
 * `ctx.addStatic` into the session's freeze list, and none of it casts a sun
 * shadow. The moving train is deliberately NOT built here — it is dynamic
 * and lives with the session's per-frame pose code.
 */

/** Rail head sits above the carriageway (0.07) but below lane paint (0.12),
 * so a rail crossing asphalt reads as embedded in the road. */
const RAIL_TOP_HEIGHT_M = 0.09;
const RAIL_PROFILE_WIDTH_M = 0.14;
// Long side on local X, so `boxLengthYaw`-style yaws apply directly.
const SLEEPER_SIZE = { width: 2.3, height: 0.06, depth: 0.26 };

export interface RailRenderCtx {
  readonly scene: Scene;
  readonly ballast: StandardMaterial;
  readonly steel: StandardMaterial;
  readonly sleeper: StandardMaterial;
  readonly girder: StandardMaterial;
  readonly createRoadSurfaceMesh: (
    name: string,
    centerline: readonly GameCanvasPoint[],
    widthM: number,
    material: StandardMaterial,
    smoothClosed?: boolean,
    surfaceY?: number,
  ) => unknown;
  readonly addStatic: (mesh: Mesh, x: number, z: number) => void;
}

function buildRailRibbon(
  ctx: RailRenderCtx,
  namePrefix: string,
  railPoints: readonly GameCanvasPoint[],
  intervals: readonly RailInterval[],
): void {
  // Each running rail is a chain of thin boxes, all instances of one hidden
  // unit master per line — segment count stays tiny (authored polylines are
  // a handful of vertices), so this is one draw call per line.
  const master = createBox(
    ctx.scene,
    `${namePrefix}-master`,
    { width: 1, height: RAIL_TOP_HEIGHT_M, depth: RAIL_PROFILE_WIDTH_M },
    Vector3.Zero(),
    ctx.steel,
  );
  master.isVisible = false;
  master.isPickable = false;
  for (const lateral of [-RAIL_HALF_GAUGE_M, RAIL_HALF_GAUGE_M]) {
    for (const interval of intervals) {
      const sub = slicePolyline(railPoints, interval.startM, interval.endM);
      const offset = offsetPolyline(sub, lateral);
      for (let index = 0; index < offset.length - 1; index += 1) {
        const a = offset[index];
        const b = offset[index + 1];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.05) continue;
        const rail = master.createInstance(
          `${namePrefix}-${lateral > 0 ? "r" : "l"}-${interval.startM.toFixed(0)}-${index}`,
        );
        rail.position.set(
          (a.x + b.x) / 2,
          RAIL_BALLAST_Y + RAIL_TOP_HEIGHT_M / 2 + 0.02,
          (a.z + b.z) / 2,
        );
        // Slight overlong so mitered joints never show a gap.
        rail.scaling.x = length + RAIL_PROFILE_WIDTH_M;
        rail.rotation.y = boxLengthYaw((b.x - a.x) / length, (b.z - a.z) / length);
        rail.isPickable = false;
        ctx.addStatic(rail as unknown as Mesh, rail.position.x, rail.position.z);
      }
    }
  }
}

/**
 * Rails run through crossings (embedded in the asphalt); ballast and sleepers
 * do not. So rails are built over the full line, sleepers only over the
 * ballast intervals.
 */
export function buildRailTracks(
  ctx: RailRenderCtx,
  mapPack: GameCanvasMapPack,
): void {
  const railLines = mapPack.geometry.railLines ?? [];
  const roads = mapPack.geometry.roadSurfaces ?? [];
  for (const line of railLines) {
    const lengthM = polylineLengthM(line.points);
    if (lengthM < 2) continue;
    const elevated: RailInterval[] = (line.elevatedSpans ?? []).map((span) => ({
      startM: span.startM,
      endM: span.endM,
    }));
    const ballastIntervals = railBallastIntervals(
      line.points,
      roads,
      elevated,
    );

    for (const interval of ballastIntervals) {
      const sub = slicePolyline(line.points, interval.startM, interval.endM);
      if (sub.length < 2) continue;
      ctx.createRoadSurfaceMesh(
        `rail-ballast-${line.id}-${interval.startM.toFixed(0)}`,
        sub,
        RAIL_BALLAST_WIDTH_M,
        ctx.ballast,
        false,
        RAIL_BALLAST_Y,
      );
    }

    const sleeperMaster = createBox(
      ctx.scene,
      `rail-sleeper-${line.id}-master`,
      SLEEPER_SIZE,
      Vector3.Zero(),
      ctx.sleeper,
    );
    sleeperMaster.isVisible = false;
    sleeperMaster.isPickable = false;
    // Sleepers run over ballast AND over bridge decks (open-deck girder
    // style); only level-crossing asphalt swallows them.
    for (const [index, pose] of railSleeperPlacements(
      line.points,
      [...ballastIntervals, ...elevated],
    ).entries()) {
      const sleeper = sleeperMaster.createInstance(
        `rail-sleeper-${line.id}-${index}`,
      );
      sleeper.position.set(pose.x, RAIL_BALLAST_Y + SLEEPER_SIZE.height / 2, pose.z);
      sleeper.rotation.y = pose.headingRad;
      sleeper.isPickable = false;
      ctx.addStatic(sleeper as unknown as Mesh, pose.x, pose.z);
    }

    // Rails run the whole line — ground, crossings and bridge decks sit at
    // one height, exactly like the road bridges' flat carriageways.
    buildRailRibbon(ctx, `rail-track-${line.id}`, line.points, [
      { startM: 0, endM: lengthM },
    ]);

    for (const span of (line.elevatedSpans ?? []).filter(
      (candidate) => candidate.kind === "bridge",
    )) {
      buildRailBridge(ctx, line.id, line.points, span);
    }
  }
}

/** Bridge deck depth below the rail plane, and the girders rising past it. */
const BRIDGE_DECK_WIDTH_M = 4.4;
const BRIDGE_GIRDER_HEIGHT_M = 1.35;
const BRIDGE_GIRDER_THICKNESS_M = 0.34;
const BRIDGE_GIRDER_OFFSET_M = 2.15;
const BRIDGE_PIER_SPACING_M = 26;

/**
 * A Japanese plate-girder crossing: a solid deck strip, a painted girder
 * riding each side of the track, piers into the water on a steady rhythm,
 * and a squat abutment block at each end. All instanced boxes plus one deck
 * strip — the Cairo elevated-road recipe, sized for rail.
 */
function buildRailBridge(
  ctx: RailRenderCtx,
  lineId: string,
  railPoints: readonly GameCanvasPoint[],
  span: { startM: number; endM: number },
): void {
  const sub = slicePolyline(railPoints, span.startM, span.endM);
  if (sub.length < 2) return;
  ctx.createRoadSurfaceMesh(
    `rail-bridge-deck-${lineId}-${span.startM.toFixed(0)}`,
    sub,
    BRIDGE_DECK_WIDTH_M,
    ctx.steel,
    false,
    RAIL_BALLAST_Y + 0.004,
  );
  const girderMaster = createBox(
    ctx.scene,
    `rail-girder-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1, height: BRIDGE_GIRDER_HEIGHT_M, depth: BRIDGE_GIRDER_THICKNESS_M },
    Vector3.Zero(),
    ctx.girder,
  );
  girderMaster.isVisible = false;
  girderMaster.isPickable = false;
  for (const lateral of [-BRIDGE_GIRDER_OFFSET_M, BRIDGE_GIRDER_OFFSET_M]) {
    const offset = offsetPolyline(sub, lateral);
    for (let index = 0; index < offset.length - 1; index += 1) {
      const a = offset[index];
      const b = offset[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.05) continue;
      const girder = girderMaster.createInstance(
        `rail-girder-${lineId}-${span.startM.toFixed(0)}-${lateral > 0 ? "r" : "l"}-${index}`,
      );
      girder.position.set(
        (a.x + b.x) / 2,
        RAIL_BALLAST_Y + BRIDGE_GIRDER_HEIGHT_M / 2 - 0.3,
        (a.z + b.z) / 2,
      );
      girder.scaling.x = length + BRIDGE_GIRDER_THICKNESS_M;
      girder.rotation.y = boxLengthYaw((b.x - a.x) / length, (b.z - a.z) / length);
      girder.isPickable = false;
      ctx.addStatic(girder as unknown as Mesh, girder.position.x, girder.position.z);
    }
  }
  const pierMaster = createBox(
    ctx.scene,
    `rail-pier-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1.4, height: 2.6, depth: BRIDGE_DECK_WIDTH_M - 0.6 },
    Vector3.Zero(),
    ctx.girder,
  );
  pierMaster.isVisible = false;
  pierMaster.isPickable = false;
  const spanLength = span.endM - span.startM;
  const bays = Math.max(1, Math.round(spanLength / BRIDGE_PIER_SPACING_M));
  for (let bay = 1; bay < bays; bay += 1) {
    const pose = polylinePoseAt(railPoints, span.startM + (spanLength * bay) / bays);
    const pier = pierMaster.createInstance(
      `rail-pier-${lineId}-${span.startM.toFixed(0)}-${bay}`,
    );
    pier.position.set(pose.x, -1.1, pose.z);
    pier.rotation.y = pose.headingRad - Math.PI / 2;
    pier.isPickable = false;
    ctx.addStatic(pier as unknown as Mesh, pose.x, pose.z);
  }
  for (const endM of [span.startM, span.endM]) {
    const pose = polylinePoseAt(railPoints, endM);
    const abutment = pierMaster.createInstance(
      `rail-abutment-${lineId}-${endM.toFixed(0)}`,
    );
    abutment.position.set(pose.x, -0.75, pose.z);
    abutment.scaling.set(2.4, 1, 1.25);
    abutment.rotation.y = pose.headingRad - Math.PI / 2;
    abutment.isPickable = false;
    ctx.addStatic(abutment as unknown as Mesh, pose.x, pose.z);
  }
}
