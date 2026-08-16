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
  readonly deck: StandardMaterial;
  readonly brick: StandardMaterial;
  readonly platform: StandardMaterial;
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
  baseY: number,
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
          baseY + RAIL_TOP_HEIGHT_M / 2 + 0.02,
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
    const baseY = RAIL_BALLAST_Y + (line.elevationM ?? 0);
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
        baseY,
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
      sleeper.position.set(pose.x, baseY + SLEEPER_SIZE.height / 2, pose.z);
      sleeper.rotation.y = pose.headingRad;
      sleeper.isPickable = false;
      ctx.addStatic(sleeper as unknown as Mesh, pose.x, pose.z);
    }

    // Rails run the whole line — ground, crossings and bridge decks sit at
    // one height, exactly like the road bridges' flat carriageways.
    buildRailRibbon(
      ctx,
      `rail-track-${line.id}`,
      line.points,
      [{ startM: 0, endM: lengthM }],
      baseY,
    );

    for (const span of line.elevatedSpans ?? []) {
      if (span.kind === "bridge") {
        buildRailBridge(ctx, line.id, line.points, span, line.elevationM ?? 0);
      } else {
        buildRailViaduct(ctx, line.id, line.points, span, line.elevationM ?? 0, roads);
      }
    }

    if (line.terminus) {
      buildRailTerminus(ctx, line.id, line.points, lengthM, line.terminus.at, baseY);
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
  elevationM: number,
): void {
  const sub = slicePolyline(railPoints, span.startM, span.endM);
  if (sub.length < 2) return;
  const baseY = RAIL_BALLAST_Y + elevationM;
  // A dark deck: the rails and sleepers on top carry the read. The first cut
  // used the pale rail-steel paint and the whole span glowed like a plank.
  ctx.createRoadSurfaceMesh(
    `rail-bridge-deck-${lineId}-${span.startM.toFixed(0)}`,
    sub,
    BRIDGE_DECK_WIDTH_M,
    ctx.deck,
    false,
    baseY + 0.004,
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
  // The flange strip along each girder's top edge is what makes the side
  // read as a plate girder instead of a solid wall.
  const flangeMaster = createBox(
    ctx.scene,
    `rail-girder-flange-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1, height: 0.14, depth: BRIDGE_GIRDER_THICKNESS_M + 0.3 },
    Vector3.Zero(),
    ctx.girder,
  );
  flangeMaster.isVisible = false;
  flangeMaster.isPickable = false;
  for (const lateral of [-BRIDGE_GIRDER_OFFSET_M, BRIDGE_GIRDER_OFFSET_M]) {
    const offset = offsetPolyline(sub, lateral);
    for (let index = 0; index < offset.length - 1; index += 1) {
      const a = offset[index];
      const b = offset[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.05) continue;
      const yaw = boxLengthYaw((b.x - a.x) / length, (b.z - a.z) / length);
      const girder = girderMaster.createInstance(
        `rail-girder-${lineId}-${span.startM.toFixed(0)}-${lateral > 0 ? "r" : "l"}-${index}`,
      );
      girder.position.set(
        (a.x + b.x) / 2,
        baseY + BRIDGE_GIRDER_HEIGHT_M / 2 - 0.3,
        (a.z + b.z) / 2,
      );
      girder.scaling.x = length + BRIDGE_GIRDER_THICKNESS_M;
      girder.rotation.y = yaw;
      girder.isPickable = false;
      ctx.addStatic(girder as unknown as Mesh, girder.position.x, girder.position.z);
      const flange = flangeMaster.createInstance(
        `rail-girder-flange-${lineId}-${span.startM.toFixed(0)}-${lateral > 0 ? "r" : "l"}-${index}`,
      );
      flange.position.set(
        (a.x + b.x) / 2,
        baseY + BRIDGE_GIRDER_HEIGHT_M - 0.3 + 0.07,
        (a.z + b.z) / 2,
      );
      flange.scaling.x = length + BRIDGE_GIRDER_THICKNESS_M;
      flange.rotation.y = yaw;
      flange.isPickable = false;
      ctx.addStatic(flange as unknown as Mesh, flange.position.x, flange.position.z);
    }
  }
  // Concrete piers, not girder steel — and never anything above deck level
  // on the running line itself.
  const pierMaster = createBox(
    ctx.scene,
    `rail-pier-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1.4, height: 2.6, depth: BRIDGE_DECK_WIDTH_M - 0.9 },
    Vector3.Zero(),
    ctx.platform,
  );
  pierMaster.isVisible = false;
  pierMaster.isPickable = false;
  const spanLength = span.endM - span.startM;
  const bays = Math.max(1, Math.round(spanLength / BRIDGE_PIER_SPACING_M));
  // On an elevated line the same pier stretches from the water up to the
  // deck; at grade it is the original squat block sunk into the bank.
  const pierStretch = (2.6 + elevationM) / 2.6;
  const pierCentreY = -1.1 + elevationM / 2;
  for (let bay = 1; bay < bays; bay += 1) {
    const pose = polylinePoseAt(railPoints, span.startM + (spanLength * bay) / bays);
    const pier = pierMaster.createInstance(
      `rail-pier-${lineId}-${span.startM.toFixed(0)}-${bay}`,
    );
    pier.position.set(pose.x, pierCentreY, pose.z);
    pier.scaling.y = pierStretch;
    pier.rotation.y = pose.headingRad - Math.PI / 2;
    pier.isPickable = false;
    ctx.addStatic(pier as unknown as Mesh, pose.x, pose.z);
  }
  if (elevationM === 0) {
    // Abutment = a headwall UNDER the deck at each bank, facing the water.
    // The first cut put a pad ON the running line that rose above rail
    // height — the train ploughed through it and it read as a floating slab
    // (owner-reported). Everything here stays below the rails.
    for (const endM of [span.startM, span.endM]) {
      const pose = polylinePoseAt(railPoints, endM);
      const abutment = pierMaster.createInstance(
        `rail-abutment-${lineId}-${endM.toFixed(0)}`,
      );
      // Master is 2.6 tall centred on its origin; put the TOP just under
      // the deck: centre = deckTop - 0.06 - 1.3.
      abutment.position.set(pose.x, baseY - 0.06 - 1.3, pose.z);
      abutment.scaling.set(1.7, 1, (BRIDGE_DECK_WIDTH_M + 0.8) / (BRIDGE_DECK_WIDTH_M - 0.9));
      abutment.rotation.y = pose.headingRad - Math.PI / 2;
      abutment.isPickable = false;
      ctx.addStatic(abutment as unknown as Mesh, pose.x, pose.z);
    }
  }
}

const VIADUCT_DECK_WIDTH_M = 4.8;
const VIADUCT_PARAPET_HEIGHT_M = 1.05;
const VIADUCT_PARAPET_THICKNESS_M = 0.32;
const VIADUCT_PIER_SPACING_M = 13;

/**
 * A brick viaduct bay-by-bay: deck strip, brick parapets both sides, and a
 * pier per bay EXCEPT where one would land on a carriageway — the streets
 * below thread the arches, exactly the Cairo flyover's pier-omission rule.
 */
function buildRailViaduct(
  ctx: RailRenderCtx,
  lineId: string,
  railPoints: readonly GameCanvasPoint[],
  span: { startM: number; endM: number },
  elevationM: number,
  roads: readonly {
    readonly centerline: readonly GameCanvasPoint[];
    readonly widthM: number;
    readonly sidewalkWidthM?: number;
  }[],
): void {
  const sub = slicePolyline(railPoints, span.startM, span.endM);
  if (sub.length < 2 || elevationM <= 0) return;
  const baseY = RAIL_BALLAST_Y + elevationM;
  ctx.createRoadSurfaceMesh(
    `rail-viaduct-deck-${lineId}-${span.startM.toFixed(0)}`,
    sub,
    VIADUCT_DECK_WIDTH_M,
    ctx.brick,
    false,
    baseY + 0.002,
  );
  const parapetMaster = createBox(
    ctx.scene,
    `rail-viaduct-parapet-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1, height: VIADUCT_PARAPET_HEIGHT_M, depth: VIADUCT_PARAPET_THICKNESS_M },
    Vector3.Zero(),
    ctx.brick,
  );
  parapetMaster.isVisible = false;
  parapetMaster.isPickable = false;
  for (const lateral of [-(VIADUCT_DECK_WIDTH_M / 2 - 0.2), VIADUCT_DECK_WIDTH_M / 2 - 0.2]) {
    const offset = offsetPolyline(sub, lateral);
    for (let index = 0; index < offset.length - 1; index += 1) {
      const a = offset[index];
      const b = offset[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.05) continue;
      const parapet = parapetMaster.createInstance(
        `rail-viaduct-parapet-${lineId}-${span.startM.toFixed(0)}-${lateral > 0 ? "r" : "l"}-${index}`,
      );
      parapet.position.set(
        (a.x + b.x) / 2,
        baseY + VIADUCT_PARAPET_HEIGHT_M / 2 - 0.2,
        (a.z + b.z) / 2,
      );
      parapet.scaling.x = length + VIADUCT_PARAPET_THICKNESS_M;
      parapet.rotation.y = boxLengthYaw((b.x - a.x) / length, (b.z - a.z) / length);
      parapet.isPickable = false;
      ctx.addStatic(parapet as unknown as Mesh, parapet.position.x, parapet.position.z);
    }
  }
  const pierMaster = createBox(
    ctx.scene,
    `rail-viaduct-pier-${lineId}-${span.startM.toFixed(0)}-master`,
    { width: 1.7, height: 1, depth: 3.1 },
    Vector3.Zero(),
    ctx.brick,
  );
  pierMaster.isVisible = false;
  pierMaster.isPickable = false;
  const clearOfRoads = (pose: { x: number; z: number }): boolean =>
    roads.every((road) => {
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index < road.centerline.length - 1; index += 1) {
        const a = road.centerline[index];
        const b = road.centerline[index + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lengthSq = dx * dx + dz * dz;
        const t = Math.max(
          0,
          Math.min(1, ((pose.x - a.x) * dx + (pose.z - a.z) * dz) / (lengthSq || 1)),
        );
        best = Math.min(
          best,
          Math.hypot(pose.x - (a.x + dx * t), pose.z - (a.z + dz * t)),
        );
      }
      return best > road.widthM / 2 + (road.sidewalkWidthM ?? 2) + 1.4;
    });
  const spanLength = span.endM - span.startM;
  const bays = Math.max(1, Math.round(spanLength / VIADUCT_PIER_SPACING_M));
  for (let bay = 0; bay <= bays; bay += 1) {
    const pose = polylinePoseAt(railPoints, span.startM + (spanLength * bay) / bays);
    if (!clearOfRoads(pose)) continue;
    const pier = pierMaster.createInstance(
      `rail-viaduct-pier-${lineId}-${span.startM.toFixed(0)}-${bay}`,
    );
    // Sunk 0.4 so sloping ground never shows a floating pier foot.
    pier.position.set(pose.x, (elevationM + 0.4) / 2 - 0.4, pose.z);
    pier.scaling.y = elevationM + 0.4;
    pier.rotation.y = pose.headingRad - Math.PI / 2;
    pier.isPickable = false;
    ctx.addStatic(pier as unknown as Mesh, pose.x, pose.z);
  }
}

const TERMINUS_PLATFORM_LENGTH_M = 42;

/** Two flanking platforms and a buffer stop at a shuttle's dwell end. */
function buildRailTerminus(
  ctx: RailRenderCtx,
  lineId: string,
  railPoints: readonly GameCanvasPoint[],
  lengthM: number,
  at: "start" | "end",
  baseY: number,
): void {
  const from = at === "end" ? Math.max(0, lengthM - TERMINUS_PLATFORM_LENGTH_M - 2) : 2;
  const to = at === "end" ? lengthM - 2 : Math.min(lengthM, TERMINUS_PLATFORM_LENGTH_M + 2);
  const sub = slicePolyline(railPoints, from, to);
  if (sub.length < 2) return;
  const platformMaster = createBox(
    ctx.scene,
    `rail-terminus-${lineId}-platform-master`,
    { width: 1, height: 0.62, depth: 2.3 },
    Vector3.Zero(),
    ctx.platform,
  );
  platformMaster.isVisible = false;
  platformMaster.isPickable = false;
  for (const lateral of [-2.8, 2.8]) {
    const offset = offsetPolyline(sub, lateral);
    for (let index = 0; index < offset.length - 1; index += 1) {
      const a = offset[index];
      const b = offset[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.05) continue;
      const slab = platformMaster.createInstance(
        `rail-terminus-${lineId}-platform-${lateral > 0 ? "r" : "l"}-${index}`,
      );
      slab.position.set((a.x + b.x) / 2, baseY + 0.31, (a.z + b.z) / 2);
      slab.scaling.x = length;
      slab.rotation.y = boxLengthYaw((b.x - a.x) / length, (b.z - a.z) / length);
      slab.isPickable = false;
      ctx.addStatic(slab as unknown as Mesh, slab.position.x, slab.position.z);
    }
  }
  const stopPose = polylinePoseAt(railPoints, at === "end" ? lengthM - 1 : 1);
  const buffer = createBox(
    ctx.scene,
    `rail-terminus-${lineId}-buffer`,
    { width: 1.1, height: 1.15, depth: 2.6 },
    new Vector3(stopPose.x, baseY + 0.55, stopPose.z),
    ctx.sleeper,
  );
  buffer.rotation.y = stopPose.headingRad - Math.PI / 2;
  buffer.isPickable = false;
  ctx.addStatic(buffer, stopPose.x, stopPose.z);
}
