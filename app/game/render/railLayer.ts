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
    for (const [index, pose] of railSleeperPlacements(
      line.points,
      ballastIntervals,
    ).entries()) {
      const sleeper = sleeperMaster.createInstance(
        `rail-sleeper-${line.id}-${index}`,
      );
      sleeper.position.set(pose.x, RAIL_BALLAST_Y + SLEEPER_SIZE.height / 2, pose.z);
      sleeper.rotation.y = pose.headingRad;
      sleeper.isPickable = false;
      ctx.addStatic(sleeper as unknown as Mesh, pose.x, pose.z);
    }

    // Rails cover ground and crossing spans alike; elevated spans get their
    // rails from the bridge builder so they can ride at deck height.
    const groundAndCrossings: RailInterval[] = (() => {
      if (!elevated.length) return [{ startM: 0, endM: lengthM }];
      const spans: RailInterval[] = [];
      let cursor = 0;
      for (const span of [...elevated].sort((a, b) => a.startM - b.startM)) {
        if (span.startM > cursor) spans.push({ startM: cursor, endM: span.startM });
        cursor = Math.max(cursor, span.endM);
      }
      if (cursor < lengthM) spans.push({ startM: cursor, endM: lengthM });
      return spans;
    })();
    buildRailRibbon(ctx, `rail-track-${line.id}`, line.points, groundAndCrossings);
  }
}
