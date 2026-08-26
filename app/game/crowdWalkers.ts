// The ambient crowd's brain: a fixed pool of walkers strolling the pavement
// rail graph inside a simulation bubble around the player. The Midtown
// Madness rule set — spawn on the pavement out of view, recycle only out of
// view, and at the bubble's edge turn round rather than vanish — is what
// keeps a small pool reading as a whole city of pedestrians. Renderer-
// agnostic on purpose: visibility arrives as an injected predicate, so the
// bubble rules are assertable in a unit test without a camera.

import {
  EDGE_KIND_SCATTER,
  samplePavementEdgeOffset,
  type PavementEdge,
  type PavementGraph,
} from "./pavementPaths";
import { seededUnit } from "./visuals";

export interface CrowdWalker {
  edgeId: number;
  /** Arclength along the edge, within [0, lengthM]. */
  s: number;
  /** Direction of travel along the edge's arclength. */
  dir: 1 | -1;
  /** Cached segment index so resampling after a small advance is O(1). */
  segmentHint: number;
  speedMps: number;
  /** Lateral offset from the rail line (right of the edge direction), fixed
   * between recycles. This is what breaks the single-file look (issue #127):
   * every walker keeps to their own line across the pavement band. */
  lateralM: number;
  /** Which character model this walker wears; fixed for the pool's life so
   * the renderer's per-model instance partition never changes size. */
  readonly variant: number;
  /** Clothing tint slot; fixed for the pool's life, same reason. */
  readonly tintIndex: number;
  /** Complexion palette slot; fixed for the pool's life, same reason. */
  readonly complexionIndex: number;
  /** Hair palette slot; fixed for the pool's life, same reason. */
  readonly hairIndex: number;
  state: "walk" | "pause" | "downed";
  pauseRemaining: number;
  /** Seconds left of the knockdown (fall + lie + get-up) while `downed`. */
  downedRemaining: number;
  /** True only on the step this walker was recycled to a new spot. */
  justRecycled: boolean;
  x: number;
  z: number;
  headingRad: number;
}

// A struck walker falls, lies, then gets back up and walks on — the family
// arcade convention. These phase lengths are the contract between the sims
// (which own timing) and the renderers (which fit their fall/get-up clips to
// them); walkerDownedPhase derives the phase from the remaining time.
export const WALKER_FALL_SECONDS = 0.9;
export const WALKER_LIE_SECONDS = 2.6;
export const WALKER_RISE_SECONDS = 0.9;
export const WALKER_DOWNED_TOTAL_SECONDS =
  WALKER_FALL_SECONDS + WALKER_LIE_SECONDS + WALKER_RISE_SECONDS;

export type WalkerDownedPhase = "falling" | "lying" | "rising";

export function walkerDownedPhase(downedRemaining: number): WalkerDownedPhase {
  if (downedRemaining > WALKER_LIE_SECONDS + WALKER_RISE_SECONDS) {
    return "falling";
  }
  return downedRemaining > WALKER_RISE_SECONDS ? "lying" : "rising";
}

export interface CrowdConfig {
  readonly count: number;
  readonly seed: number;
  /** Recycled walkers land between inner and outer radius of the focus. */
  readonly innerRadiusM: number;
  readonly outerRadiusM: number;
  /** Beyond this a walker is recycled even if somehow still visible. */
  readonly recycleRadiusM: number;
  readonly minSpeedMps: number;
  readonly maxSpeedMps: number;
  /** Half-width of the band walkers scatter across, centred on the rail
   * line. Zero pins everyone back to the rail, single file. */
  readonly scatterHalfWidthM: number;
  /** How long a walker stands after turning at the bubble's edge. */
  readonly turnPauseSeconds: number;
  readonly modelCount: number;
  readonly tintCount: number;
  readonly complexionCount: number;
  readonly hairCount: number;
  /**
   * Optional static world-space occupancy test. Grade-separated maps use it
   * to reserve the low-headroom envelope below ramps while leaving genuinely
   * clear viaduct spans available to people on foot.
   */
  readonly canWalkAt?: (x: number, z: number) => boolean;
}

export interface CrowdFocus {
  readonly x: number;
  readonly z: number;
}

/** True when a disc at (x, z) of the given radius is on screen. */
export type CrowdVisibilityProbe = (x: number, z: number, radiusM: number) => boolean;

/**
 * Hair slots rotate by one full cycle of the pool rather than tracking the
 * index directly: every other slot is `index % count`, so hair would otherwise
 * be pinned to complexion for the pool's life and a crowd would show only
 * `count` of the possible pairings. Rotating by a stride coprime with the
 * palette length permutes within each cycle, so every slot is still drawn
 * exactly as often as its weight says.
 */
const HAIR_CYCLE_ROTATION = 7;

function hairSlot(index: number, hairCount: number): number {
  const count = Math.max(1, hairCount);
  return (index + Math.floor(index / count) * HAIR_CYCLE_ROTATION) % count;
}

const RESPAWN_ATTEMPTS = 16;
/** Cell size of the respawn grid — a few cells cover the spawn annulus. */
const RESPAWN_CELL_M = 32;
/** Fallback landings stay this far inside recycleRadiusM, so a forced spot
 * can never read as stranded and trigger a second respawn next step. */
const RESPAWN_RECYCLE_GUARD_M = 12;
const JUNCTION_PAUSE_CHANCE = 0.3;
const JUNCTION_PAUSE_S = 0.3;
const WALKER_VISIBILITY_RADIUS_M = 2;
const SPAWN_HIDE_MARGIN_PER_M = 0.35;
const SPAWN_HIDE_MARGIN_MAX_M = 24;

/**
 * How far outside the frustum a *spawn* must sit, by distance. The flat
 * walker radius is ~4° of slack at 30 m — one chase-camera yaw in a turn
 * sweeps that in a frame or two, and the fresh walker pops into view. Scaling
 * the margin with distance makes it angular (~20° near the player, tapering
 * to ~11° at a 130 m band edge, where fog is already dimming the pop). Spawn
 * placement only: the in-view checks that turn walkers round or recycle them
 * keep the flat radius, so removal semantics are untouched.
 */
export function spawnHideMarginM(distanceM: number): number {
  return (
    WALKER_VISIBILITY_RADIUS_M +
    Math.min(SPAWN_HIDE_MARGIN_MAX_M, distanceM * SPAWN_HIDE_MARGIN_PER_M)
  );
}
/** How far ahead a walker looks to face its true travel direction: through a
 * taper ramp the scattered position drifts diagonally toward the node, and a
 * body facing the rail tangent would visibly crab-walk the drift. */
const HEADING_LOOKAHEAD_M = 0.6;

/** One polyline segment of a pavement edge, bucketed for respawn sampling. */
interface RespawnSegment {
  readonly edgeIndex: number;
  /** Arclength where this segment starts on its edge. */
  readonly sStart: number;
  readonly lengthM: number;
}

export class CrowdSim {
  readonly walkers: CrowdWalker[];
  private readonly graph: PavementGraph;
  private readonly config: CrowdConfig;
  private readonly random: () => number;
  /** Length-weighted cumulative table so spawns favour long rails. */
  private readonly cumulativeLengths: Float64Array;
  private readonly totalLength: number;
  /** Pavement segments bucketed by midpoint cell; respawn samples only the
   * cells around the annulus instead of the whole city. */
  private readonly respawnCells = new Map<string, RespawnSegment[]>();
  /** Slack a cell-centre test needs before it can rule a cell out: half the
   * cell diagonal, half the longest bucketed segment, the scatter band. */
  private readonly respawnPadM: number;
  private primed = false;

  constructor(graph: PavementGraph, config: CrowdConfig) {
    this.graph = graph;
    this.config = config;
    this.random = seededUnit(config.seed);
    this.cumulativeLengths = new Float64Array(graph.edges.length);
    let total = 0;
    for (const [index, edge] of graph.edges.entries()) {
      total += edge.lengthM;
      this.cumulativeLengths[index] = total;
    }
    this.totalLength = total;
    let longestSegment = 0;
    for (const [edgeIndex, edge] of graph.edges.entries()) {
      for (let index = 0; index < edge.points.length - 1; index += 1) {
        const lengthM = edge.cumulativeM[index + 1] - edge.cumulativeM[index];
        if (lengthM <= 0) continue;
        longestSegment = Math.max(longestSegment, lengthM);
        const midX = (edge.points[index].x + edge.points[index + 1].x) / 2;
        const midZ = (edge.points[index].z + edge.points[index + 1].z) / 2;
        const key = `${Math.floor(midX / RESPAWN_CELL_M)}:${Math.floor(midZ / RESPAWN_CELL_M)}`;
        let bucket = this.respawnCells.get(key);
        if (!bucket) {
          bucket = [];
          this.respawnCells.set(key, bucket);
        }
        bucket.push({
          edgeIndex,
          sStart: edge.cumulativeM[index],
          lengthM,
        });
      }
    }
    this.respawnPadM =
      (RESPAWN_CELL_M * Math.SQRT2) / 2 +
      longestSegment / 2 +
      config.scatterHalfWidthM;
    this.walkers = Array.from({ length: config.count }, (_, index) => ({
      edgeId: 0,
      s: 0,
      dir: 1 as const,
      segmentHint: 0,
      speedMps: config.minSpeedMps,
      lateralM: 0,
      variant: index % Math.max(1, config.modelCount),
      tintIndex: index % Math.max(1, config.tintCount),
      complexionIndex: index % Math.max(1, config.complexionCount),
      hairIndex: hairSlot(index, config.hairCount),
      state: "walk" as const,
      pauseRemaining: 0,
      downedRemaining: 0,
      justRecycled: false,
      x: 0,
      z: 0,
      headingRad: 0,
    }));
  }

  /**
   * Knocks a walker down where it stands: it faces the striker (so the fall
   * clip's backward drop reads as being knocked away from the car), stops
   * advancing, and gets back up after the shared phase timings. Consumes no
   * randomness, so an unstruck run's walker stream is untouched.
   */
  strike(walker: CrowdWalker, fromX: number, fromZ: number): void {
    if (walker.state === "downed") return;
    walker.state = "downed";
    walker.downedRemaining = WALKER_DOWNED_TOTAL_SECONDS;
    walker.pauseRemaining = 0;
    const dx = fromX - walker.x;
    const dz = fromZ - walker.z;
    if (Math.hypot(dx, dz) > 1e-3) {
      walker.headingRad = Math.atan2(dx, dz);
    }
  }

  step(dt: number, focus: CrowdFocus, isVisible: CrowdVisibilityProbe): void {
    if (!this.graph.edges.length) return;
    if (!this.primed) {
      // The initial fill ignores visibility: people already standing on the
      // pavement when the scene fades in are exactly what a street looks
      // like. Only mid-drive recycling has to stay out of sight.
      this.primed = true;
      for (const walker of this.walkers) {
        this.respawn(walker, focus, () => false);
        walker.justRecycled = false;
      }
    }
    for (const walker of this.walkers) {
      walker.justRecycled = false;
      if (walker.state === "downed") {
        walker.downedRemaining -= dt;
        if (walker.downedRemaining <= 0) {
          walker.state = "walk";
          walker.downedRemaining = 0;
        }
      } else if (walker.state === "pause") {
        walker.pauseRemaining -= dt;
        if (walker.pauseRemaining <= 0) {
          walker.state = "walk";
          walker.pauseRemaining = 0;
        }
      } else {
        this.advance(walker, dt);
      }
      const dx = walker.x - focus.x;
      const dz = walker.z - focus.z;
      const distance = Math.hypot(dx, dz);
      if (distance > this.config.recycleRadiusM) {
        this.respawn(walker, focus, isVisible);
      } else if (distance > this.config.outerRadiusM && walker.state === "walk") {
        // Inbound walkers are left to wander back, seen or unseen — recycling
        // them would churn the fallback placements that deliberately land
        // just past the band facing inward when the whole band is on screen.
        const away =
          Math.sin(walker.headingRad) * dx + Math.cos(walker.headingRad) * dz;
        if (away > 0) {
          if (!isVisible(walker.x, walker.z, WALKER_VISIBILITY_RADIUS_M)) {
            this.respawn(walker, focus, isVisible);
          } else {
            // Walking away while watched: turn round like anyone reaching
            // the end of their street.
            walker.dir = -walker.dir as 1 | -1;
            walker.headingRad += Math.PI;
            walker.state = "pause";
            walker.pauseRemaining = this.config.turnPauseSeconds;
          }
        }
      }
    }
  }

  /** The walker's personal offset, scaled down on tightly-curved edge kinds. */
  private scatterOf(walker: CrowdWalker, edge: PavementEdge): number {
    return walker.lateralM * EDGE_KIND_SCATTER[edge.kind];
  }

  private canWalkAt(x: number, z: number): boolean {
    return this.config.canWalkAt?.(x, z) ?? true;
  }

  private advance(walker: CrowdWalker, dt: number): void {
    const previous = {
      edgeId: walker.edgeId,
      s: walker.s,
      dir: walker.dir,
      segmentHint: walker.segmentHint,
      x: walker.x,
      z: walker.z,
      headingRad: walker.headingRad,
    };
    const edge = this.graph.edges[walker.edgeId];
    walker.s += walker.dir * walker.speedMps * dt;
    if (edge.closed) {
      walker.s = ((walker.s % edge.lengthM) + edge.lengthM) % edge.lengthM;
      walker.segmentHint = 0;
    } else if (walker.s >= edge.lengthM || walker.s <= 0) {
      const nodeId = walker.s >= edge.lengthM ? edge.b : edge.a;
      walker.s = Math.min(Math.max(walker.s, 0), edge.lengthM);
      this.crossNode(walker, nodeId);
    }
    const current = this.graph.edges[walker.edgeId];
    const offset = this.scatterOf(walker, current);
    const pose = samplePavementEdgeOffset(
      current,
      walker.s,
      offset,
      walker.segmentHint,
    );
    walker.x = pose.x;
    walker.z = pose.z;
    walker.segmentHint = pose.segmentIndex;
    // Face the true travel direction, not the rail tangent — through a taper
    // ramp they differ. The lookahead degenerates at an edge's very end (the
    // sample clamps), where the taper has already put the walker back on the
    // rail and the tangent is exact.
    const ahead = samplePavementEdgeOffset(
      current,
      walker.s + walker.dir * HEADING_LOOKAHEAD_M,
      offset,
      pose.segmentIndex,
    );
    const dx = ahead.x - pose.x;
    const dz = ahead.z - pose.z;
    walker.headingRad =
      Math.hypot(dx, dz) > 0.05
        ? Math.atan2(dx, dz)
        : walker.dir === 1
          ? pose.headingRad
          : pose.headingRad + Math.PI;
    if (!this.canWalkAt(walker.x, walker.z)) {
      // A pavement rail can legitimately continue below a high viaduct, but
      // it must stop short of a ramp whose soffit is below head height. Keep
      // the last valid pose and turn around; never teleport across the
      // clearance keepout or let a walker clip through its deck.
      walker.edgeId = previous.edgeId;
      walker.s = previous.s;
      walker.dir = -previous.dir as 1 | -1;
      walker.segmentHint = previous.segmentHint;
      walker.x = previous.x;
      walker.z = previous.z;
      walker.headingRad = previous.headingRad + Math.PI;
      walker.state = "pause";
      walker.pauseRemaining = this.config.turnPauseSeconds;
    }
  }

  private crossNode(walker: CrowdWalker, nodeId: number): void {
    const node = this.graph.nodes[nodeId];
    const candidates = node.edgeIds.filter((id) => id !== walker.edgeId);
    if (!candidates.length) {
      // A true dead end: turn round on the spot.
      walker.dir = -walker.dir as 1 | -1;
      return;
    }
    const nextId =
      candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    const next = this.graph.edges[nextId];
    walker.edgeId = nextId;
    walker.segmentHint = 0;
    if (next.closed) {
      walker.s = 0;
      walker.dir = this.random() < 0.5 ? 1 : -1;
    } else if (next.a === nodeId) {
      walker.s = 0;
      walker.dir = 1;
    } else {
      walker.s = next.lengthM;
      walker.dir = -1;
    }
    if (this.random() < JUNCTION_PAUSE_CHANCE) {
      walker.state = "pause";
      walker.pauseRemaining = JUNCTION_PAUSE_S;
    }
  }

  private respawn(
    walker: CrowdWalker,
    focus: CrowdFocus,
    isVisible: CrowdVisibilityProbe,
  ): void {
    const { innerRadiusM, outerRadiusM } = this.config;
    // A fresh spot on the pavement band, not just a fresh spot on the rail —
    // the annulus and visibility checks probe where the walker will actually
    // stand, offset included.
    walker.lateralM = (this.random() * 2 - 1) * this.config.scatterHalfWidthM;
    // Sample only the pavement near the annulus. Picking uniformly over the
    // whole city made an in-band landing a ~1-in-60 shot once the map grew
    // ~4x. Placement is then three tiers: a hidden in-band sample wins
    // outright; failing that, the best hidden sample inside the recycle
    // guard — typically the shell just past the band, the natural spot when
    // the whole band is on screen; only with every sample watched does the
    // nearest-band-middle pick land regardless of visibility, because a
    // watched materialization beats a vanished walker. The fallbacks aim at
    // the band, never past it: the old farthest-pick fallback parked walkers
    // beyond recycleRadiusM, which the next step read as stranded and
    // respawned again — 12 whole-map picks per walker per step, forever.
    const segments: RespawnSegment[] = [];
    const cumulative: number[] = [];
    let total = 0;
    const outerReach = outerRadiusM + this.respawnPadM;
    const innerReach = Math.max(0, innerRadiusM - this.respawnPadM);
    const minCellX = Math.floor((focus.x - outerReach) / RESPAWN_CELL_M);
    const maxCellX = Math.floor((focus.x + outerReach) / RESPAWN_CELL_M);
    const minCellZ = Math.floor((focus.z - outerReach) / RESPAWN_CELL_M);
    const maxCellZ = Math.floor((focus.z + outerReach) / RESPAWN_CELL_M);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const centreX = (cellX + 0.5) * RESPAWN_CELL_M;
        const centreZ = (cellZ + 0.5) * RESPAWN_CELL_M;
        const centreDistance = Math.hypot(
          centreX - focus.x,
          centreZ - focus.z,
        );
        if (centreDistance < innerReach || centreDistance > outerReach) {
          continue;
        }
        const bucket = this.respawnCells.get(`${cellX}:${cellZ}`);
        if (!bucket) continue;
        for (const segment of bucket) {
          segments.push(segment);
          total += segment.lengthM;
          cumulative.push(total);
        }
      }
    }
    const bandMiddle = (innerRadiusM + outerRadiusM) / 2;
    const fallbackCeiling = this.config.recycleRadiusM - RESPAWN_RECYCLE_GUARD_M;
    let chosenEdge = -1;
    let chosenS = 0;
    let hiddenEdge = -1;
    let hiddenS = 0;
    let hiddenScore = Number.POSITIVE_INFINITY;
    let anyEdge = -1;
    let anyS = 0;
    let anyScore = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < RESPAWN_ATTEMPTS; attempt += 1) {
      let edgeIndex: number;
      let s: number;
      if (total > 0) {
        const pick = this.random() * total;
        let low = 0;
        let high = cumulative.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (cumulative[mid] < pick) low = mid + 1;
          else high = mid;
        }
        const segment = segments[low];
        edgeIndex = segment.edgeIndex;
        s = segment.sStart + this.random() * segment.lengthM;
      } else {
        // No pavement anywhere near the band (a focus off the network, or a
        // band wider than the map): fall back to the whole-city table.
        const pick = this.random() * this.totalLength;
        let low = 0;
        let high = this.cumulativeLengths.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (this.cumulativeLengths[mid] < pick) low = mid + 1;
          else high = mid;
        }
        edgeIndex = low;
        s = this.random() * this.graph.edges[low].lengthM;
      }
      const edge = this.graph.edges[edgeIndex];
      const pose = samplePavementEdgeOffset(edge, s, this.scatterOf(walker, edge));
      if (!this.canWalkAt(pose.x, pose.z)) continue;
      const distance = Math.hypot(pose.x - focus.x, pose.z - focus.z);
      const hidden = !isVisible(pose.x, pose.z, spawnHideMarginM(distance));
      if (hidden && distance >= innerRadiusM && distance <= outerRadiusM) {
        chosenEdge = edgeIndex;
        chosenS = s;
        break;
      }
      const score = Math.abs(distance - bandMiddle);
      if (
        hidden &&
        distance >= innerRadiusM &&
        distance <= fallbackCeiling &&
        score < hiddenScore
      ) {
        hiddenScore = score;
        hiddenEdge = edgeIndex;
        hiddenS = s;
      }
      if (score < anyScore) {
        anyScore = score;
        anyEdge = edgeIndex;
        anyS = s;
      }
    }
    if (chosenEdge < 0) {
      chosenEdge = hiddenEdge >= 0 ? hiddenEdge : anyEdge;
      chosenS = hiddenEdge >= 0 ? hiddenS : anyS;
    }
    if (chosenEdge < 0) {
      // The random annulus samples can all land in a ramp keepout. Make the
      // fallback deterministic and bounded: scan nearby bucket segments,
      // then the whole graph, at their midpoints. This path is rare and only
      // runs during recycling, never in the per-walker movement hot loop.
      const fallbackSegments = segments.length
        ? segments
        : this.graph.edges.flatMap((edge, edgeIndex) =>
            edge.points.slice(1).map((_, pointIndex) => ({
              edgeIndex,
              sStart: edge.cumulativeM[pointIndex],
              lengthM:
                edge.cumulativeM[pointIndex + 1] - edge.cumulativeM[pointIndex],
            })),
          );
      for (const segment of fallbackSegments) {
        const edge = this.graph.edges[segment.edgeIndex];
        for (const amount of [0.2, 0.5, 0.8]) {
          const s = segment.sStart + segment.lengthM * amount;
          const pose = samplePavementEdgeOffset(
            edge,
            s,
            this.scatterOf(walker, edge),
          );
          if (!this.canWalkAt(pose.x, pose.z)) continue;
          chosenEdge = segment.edgeIndex;
          chosenS = s;
          break;
        }
        if (chosenEdge >= 0) break;
      }
    }
    // A graph with no occupiable sample is malformed for this pool. Keeping
    // the previous pose is safer than indexing -1; normal maps always have
    // extensive pavement outside the small low-ramp envelopes.
    if (chosenEdge < 0) {
      walker.state = "pause";
      walker.pauseRemaining = this.config.turnPauseSeconds;
      walker.justRecycled = false;
      return;
    }
    walker.edgeId = chosenEdge;
    walker.s = chosenS;
    walker.dir = this.random() < 0.5 ? 1 : -1;
    walker.speedMps =
      this.config.minSpeedMps +
      this.random() * (this.config.maxSpeedMps - this.config.minSpeedMps);
    walker.state = "walk";
    walker.pauseRemaining = 0;
    walker.downedRemaining = 0;
    walker.justRecycled = true;
    const edge = this.graph.edges[chosenEdge];
    const pose = samplePavementEdgeOffset(edge, chosenS, this.scatterOf(walker, edge));
    walker.x = pose.x;
    walker.z = pose.z;
    walker.segmentHint = pose.segmentIndex;
    walker.headingRad =
      walker.dir === 1 ? pose.headingRad : pose.headingRad + Math.PI;
    // A fallback landing past the band faces home, so the next step's
    // outbound check cannot recycle it straight back out of the pool.
    if (Math.hypot(walker.x - focus.x, walker.z - focus.z) > outerRadiusM) {
      const away =
        Math.sin(walker.headingRad) * (walker.x - focus.x) +
        Math.cos(walker.headingRad) * (walker.z - focus.z);
      if (away > 0) {
        walker.dir = -walker.dir as 1 | -1;
        walker.headingRad += Math.PI;
      }
    }
  }
}

/** Null when the map has no pavement to walk (or an empty pool is asked for). */
export function createCrowdSim(
  graph: PavementGraph,
  config: CrowdConfig,
): CrowdSim | null {
  if (!graph.edges.length || config.count <= 0) return null;
  return new CrowdSim(graph, config);
}
