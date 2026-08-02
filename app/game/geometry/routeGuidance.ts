import { isPointInPolygon } from "../simulation";
import { MIN_HORIZONTAL_FOV, MAX_HORIZONTAL_FOV } from "../render/renderConstants";
import type { GameCanvasLane, GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import type { SimulationSnapshot } from "../simulation";

/**
 * Checkpoint/chevron guidance geometry: lane-graph route resolution, and the
 * widths and cue-overlap rules the drive HUD's guidance layer draws against.
 *
 * Pure by design — no Babylon, no DOM — so this geometry can be pinned in
 * plain node tests without instantiating a scene. `tests/architecture.test.ts`
 * enforces that this stays true for every file under `geometry/`.
 */

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

/** Keeps a checkpoint target wholly inside its authored lane. */
export function resolveCheckpointTargetWidth(laneWidthM: number): number {
  return Math.max(0, Math.min(2.4, laneWidthM - 0.6));
}

/** Keeps each chevron, including its stroke, inside the guidance envelope. */
export function resolveRouteChevronHalfSpan(laneWidthM: number): number {
  return Math.max(0.32, Math.min(0.72, (laneWidthM - 0.8) / 2 - 0.12));
}

/**
 * Resolves the single simulation-owned route occurrence whose chevrons may be
 * rendered. Overtaking owns the guidance channel while active and suppresses
 * the normal route stream so two competing lanes are never highlighted.
 */
export function resolveAuthoritativeRouteIndex(
  routeLength: number,
  guidance: Pick<SimulationSnapshot["guidance"], "owner" | "status" | "blockingReason">,
): number | null {
  if (
    routeLength <= 0 ||
    guidance.status === "inactive" ||
    guidance.status === "complete" ||
    guidance.owner?.kind !== "route"
  ) {
    return null;
  }
  const authoritativeIndex = guidance.owner.routeIndex;
  if (
    authoritativeIndex !== null &&
    authoritativeIndex >= 0 &&
    authoritativeIndex < routeLength
  ) {
    return authoritativeIndex;
  }
  return null;
}

/**
 * Avoids stacking an amber lane cue directly on the active cyan checkpoint.
 *
 * `checkpoint` takes the two fields by shape rather than importing
 * `AuthoredCheckpoint` (a GameCanvas.tsx session-internal type) — the same
 * structural shape, without geometry/ depending back on the session.
 */
export function guidanceCueOverlapsCheckpoint(
  cue: Pick<NonNullable<SimulationSnapshot["guidance"]["cue"]>, "laneId" | "distanceAlongM"> | null,
  checkpoint: { readonly laneId: string | null; readonly distanceAlongM: number | null } | null,
): boolean {
  return Boolean(
    cue &&
      checkpoint &&
      checkpoint.laneId === cue.laneId &&
      checkpoint.distanceAlongM !== null &&
      Math.abs(checkpoint.distanceAlongM - cue.distanceAlongM) <= 2.5,
  );
}

export function clampHorizontalFieldOfView(value: number): number {
  return clamp(value, MIN_HORIZONTAL_FOV, MAX_HORIZONTAL_FOV);
}

/** Connector tapers are navigation-free junction geometry, not lane targets. */
export function isLaneGuidanceDistanceAllowed(
  lane: GameCanvasLane,
  distanceAlongM: number,
): boolean {
  return !(lane.connectorRanges ?? []).some(
    (range) =>
      distanceAlongM >= range.startDistanceAlongM - 0.05 &&
      distanceAlongM <= range.endDistanceAlongM + 0.05,
  );
}

export interface RouteChevronPlacement {
  readonly distanceAlongM: number;
  readonly tip: GameCanvasPoint;
  readonly back: GameCanvasPoint;
  readonly sideX: number;
  readonly sideZ: number;
}

/**
 * Deterministic chevron layout for one route lane. Arrows march every 12 m,
 * skipping junction connectors and compact conflict zones; roundabout rings
 * are exempt from the conflict-zone rule because their priority zone covers
 * the whole circle and would otherwise erase every arrow on the ring. Pure so
 * per-lesson guidance coverage can be asserted in tests.
 */
export function computeRouteChevronPlacements(
  lane: GameCanvasLane,
  conflictZones: GameCanvasMapPack["laneGraph"]["conflictZones"],
): readonly RouteChevronPlacement[] {
  const placements: RouteChevronPlacement[] = [];
  let travelled = 0;
  let nextChevronAt = 7;
  for (let segmentIndex = 0; segmentIndex < lane.centerline.length - 1; segmentIndex += 1) {
    const start = lane.centerline[segmentIndex];
    const end = lane.centerline[segmentIndex + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const ux = dx / length;
    const uz = dz / length;
    while (nextChevronAt <= travelled + length) {
      const along = nextChevronAt - travelled;
      const tip = { x: start.x + ux * along, z: start.z + uz * along };
      const back = { x: tip.x - ux * 1.45, z: tip.z - uz * 1.45 };
      const inConnectorRange = !isLaneGuidanceDistanceAllowed(
        lane,
        nextChevronAt,
      );
      const inConflictZone =
        lane.role !== "roundabout" &&
        conflictZones.some(
          (zone) =>
            zone.laneIds.includes(lane.id) &&
            (isPointInPolygon(tip, zone.polygon) || isPointInPolygon(back, zone.polygon)),
        );
      if (!inConnectorRange && !inConflictZone) {
        placements.push({
          distanceAlongM: nextChevronAt,
          tip,
          back,
          sideX: uz,
          sideZ: -ux,
        });
      }
      nextChevronAt += 12;
    }
    travelled += length;
  }
  return placements;
}
