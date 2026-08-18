import {
  ROUTE_LOOKAHEAD_LIMIT_M,
  ROUTE_LOOKAHEAD_MAX_HOPS,
  type NormalizedLane,
  type RoadNetwork,
} from "./roadNetwork";

/** World-cell width for dynamic traffic proximity queries. Route-leading uses
 * lane buckets instead: route adjacency is not safe to infer from Euclidean
 * position until every authored successor has proven continuous. */
export const TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M = 32;

const EMPTY_SLOT = -1;

/**
 * Dynamic traffic's allocation-free broad phase.
 *
 * NPC slots are stable positions in TrafficSystem's `npcsList`; this class
 * stores only those numeric slots, never NPC references. Lane buckets serve
 * route-leading, while the fixed world grid is available for genuinely
 * geometric proximity checks as their brute-force oracles are introduced.
 * Query results live in a generation-stamped typed mark set. Callers always
 * consume that set by scanning `npcsList` order, so linked-list or Map order
 * can never alter simulation behaviour.
 */
export class TrafficSpatialIndex {
  private readonly lanes: readonly NormalizedLane[];
  private readonly laneLengths: Float64Array;
  private readonly successorOffsets: Int32Array;
  private readonly successorIndices: Int32Array;

  private laneHeads: Int32Array;
  private slotLaneIndices = new Int32Array(0);
  private laneNext = new Int32Array(0);
  private lanePrevious = new Int32Array(0);

  // World-cell buckets reuse the same bounded slot capacity: at most one
  // non-empty cell can be owned by each active NPC.
  private readonly cellBucketsByKey = new Map<number, number>();
  private cellHeads = new Int32Array(0);
  private cellKeys = new Float64Array(0);
  private slotCellBuckets = new Int32Array(0);
  private cellNext = new Int32Array(0);
  private cellPrevious = new Int32Array(0);
  private freeCellNext = new Int32Array(0);
  private freeCellBucket = EMPTY_SLOT;

  private candidateMarks = new Uint32Array(0);
  private routeStateMarks: Uint32Array;
  private routeStateDistances: Float64Array;
  private routeActiveLaneIndices: Int32Array;
  private readonly routeActiveCounts = new Int32Array(ROUTE_LOOKAHEAD_MAX_HOPS + 1);
  private queryGeneration = 0;
  private slotCapacity = 0;

  constructor(roadNetwork: RoadNetwork, slotCapacity = 0) {
    this.lanes = roadNetwork.lanes;
    this.laneHeads = new Int32Array(this.lanes.length);
    this.laneLengths = new Float64Array(this.lanes.length);
    this.successorOffsets = new Int32Array(this.lanes.length + 1);

    const successorIndices: number[] = [];
    for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex += 1) {
      const lane = this.lanes[laneIndex];
      this.laneLengths[laneIndex] = lane.length;
      this.successorOffsets[laneIndex] = successorIndices.length;
      for (const successorId of lane.successorLaneIds) {
        const successor = roadNetwork.lanesById.get(successorId);
        if (successor?.index !== undefined) successorIndices.push(successor.index);
      }
    }
    this.successorOffsets[this.lanes.length] = successorIndices.length;
    this.successorIndices = Int32Array.from(successorIndices);

    const routeStateCount = this.lanes.length * (ROUTE_LOOKAHEAD_MAX_HOPS + 1);
    this.routeStateMarks = new Uint32Array(routeStateCount);
    this.routeStateDistances = new Float64Array(routeStateCount);
    this.routeActiveLaneIndices = new Int32Array(routeStateCount);
    this.reset(slotCapacity);
  }

  /** Clears all live slots. A reset may also resize storage between sessions,
   * but no normal fixed-step operation allocates an array. */
  reset(slotCapacity = this.slotCapacity): void {
    const normalizedCapacity = Number.isFinite(slotCapacity)
      ? Math.max(0, Math.ceil(slotCapacity))
      : 0;
    if (normalizedCapacity !== this.slotCapacity) {
      this.slotCapacity = normalizedCapacity;
      this.slotLaneIndices = new Int32Array(normalizedCapacity);
      this.laneNext = new Int32Array(normalizedCapacity);
      this.lanePrevious = new Int32Array(normalizedCapacity);
      this.cellHeads = new Int32Array(normalizedCapacity);
      this.cellKeys = new Float64Array(normalizedCapacity);
      this.slotCellBuckets = new Int32Array(normalizedCapacity);
      this.cellNext = new Int32Array(normalizedCapacity);
      this.cellPrevious = new Int32Array(normalizedCapacity);
      this.freeCellNext = new Int32Array(normalizedCapacity);
      this.candidateMarks = new Uint32Array(normalizedCapacity);
    }

    this.laneHeads.fill(EMPTY_SLOT);
    this.slotLaneIndices.fill(EMPTY_SLOT);
    this.laneNext.fill(EMPTY_SLOT);
    this.lanePrevious.fill(EMPTY_SLOT);
    this.cellBucketsByKey.clear();
    this.cellHeads.fill(EMPTY_SLOT);
    this.slotCellBuckets.fill(EMPTY_SLOT);
    this.cellNext.fill(EMPTY_SLOT);
    this.cellPrevious.fill(EMPTY_SLOT);
    for (let bucket = 0; bucket < this.slotCapacity; bucket += 1) {
      this.freeCellNext[bucket] =
        bucket + 1 < this.slotCapacity ? bucket + 1 : EMPTY_SLOT;
    }
    this.freeCellBucket = this.slotCapacity > 0 ? 0 : EMPTY_SLOT;
    this.candidateMarks.fill(0);
    this.routeStateMarks.fill(0);
    this.routeActiveCounts.fill(0);
    this.queryGeneration = 0;
  }

  /** Inserts a stable NPC slot or updates its lane and world-cell membership. */
  upsert(slotIndex: number, laneIndex: number, x: number, z: number): void {
    if (
      slotIndex < 0 ||
      slotIndex >= this.slotCapacity ||
      laneIndex < 0 ||
      laneIndex >= this.lanes.length
    ) {
      this.remove(slotIndex);
      return;
    }

    const previousLaneIndex = this.slotLaneIndices[slotIndex];
    if (previousLaneIndex !== laneIndex) {
      if (previousLaneIndex !== EMPTY_SLOT) this.unlinkLane(slotIndex, previousLaneIndex);
      this.linkLane(slotIndex, laneIndex);
    }

    const previousCellBucket = this.slotCellBuckets[slotIndex];
    // Route-leading needs a lane/distance candidate even if a bad display pose
    // somehow reaches this seam. Keep that conservative lane membership and
    // simply omit the unusable point from geometric world-cell queries.
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      if (previousCellBucket !== EMPTY_SLOT) this.unlinkCell(slotIndex, previousCellBucket);
      return;
    }
    const cellKey = this.cellKeyForPosition(x, z);
    if (
      previousCellBucket !== EMPTY_SLOT &&
      this.cellKeys[previousCellBucket] === cellKey
    ) {
      return;
    }
    if (previousCellBucket !== EMPTY_SLOT) this.unlinkCell(slotIndex, previousCellBucket);
    this.linkCell(slotIndex, cellKey);
  }

  /** Removes a slot from both indexes. It is safe to call for an already
   * inactive or out-of-range slot, which keeps recovery paths simple. */
  remove(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.slotCapacity) return;
    const laneIndex = this.slotLaneIndices[slotIndex];
    if (laneIndex !== EMPTY_SLOT) this.unlinkLane(slotIndex, laneIndex);
    const cellBucket = this.slotCellBuckets[slotIndex];
    if (cellBucket !== EMPTY_SLOT) this.unlinkCell(slotIndex, cellBucket);
  }

  /** Starts a reusable mark-set query. Results from the prior query become
   * unreadable without clearing the whole array. */
  beginQuery(): void {
    this.queryGeneration = (this.queryGeneration + 1) >>> 0;
    if (this.queryGeneration !== 0) return;
    this.candidateMarks.fill(0);
    this.routeStateMarks.fill(0);
    this.queryGeneration = 1;
  }

  /** Marks all current occupants of one lane. Candidate order is deliberately
   * discarded; TrafficSystem scans its own stable slot order afterward. */
  markLaneOccupants(laneIndex: number): void {
    if (laneIndex < 0 || laneIndex >= this.laneHeads.length) return;
    for (
      let slotIndex = this.laneHeads[laneIndex];
      slotIndex !== EMPTY_SLOT;
      slotIndex = this.laneNext[slotIndex]
    ) {
      this.candidateMarks[slotIndex] = this.queryGeneration;
    }
  }

  /** Marks every slot in world cells overlapping an AABB. This is intentionally
   * not used by route-leading: adjacent lanes can be spatially discontinuous. */
  markWorldAabb(minX: number, maxX: number, minZ: number, maxZ: number): void {
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxZ)
    ) {
      return;
    }
    const startX = Math.floor(Math.min(minX, maxX) / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M);
    const endX = Math.floor(Math.max(minX, maxX) / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M);
    const startZ = Math.floor(Math.min(minZ, maxZ) / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M);
    const endZ = Math.floor(Math.max(minZ, maxZ) / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M);
    for (let cellX = startX; cellX <= endX; cellX += 1) {
      for (let cellZ = startZ; cellZ <= endZ; cellZ += 1) {
        const cellBucket = this.cellBucketsByKey.get(this.cellKey(cellX, cellZ));
        if (cellBucket === undefined) continue;
        for (
          let slotIndex = this.cellHeads[cellBucket];
          slotIndex !== EMPTY_SLOT;
          slotIndex = this.cellNext[slotIndex]
        ) {
          this.candidateMarks[slotIndex] = this.queryGeneration;
        }
      }
    }
  }

  /** Marks source-lane occupants plus every lane whose start is reachable
   * within the exact `routeDistanceAhead` six-hop / 240 m search envelope.
   * The whole bucket is retained: a target's start can be in range while its
   * occupant lies farther along that lane. */
  collectRouteLeadingCandidates(fromLane: NormalizedLane, fromDistance: number): void {
    this.beginQuery();
    const fromLaneIndex = fromLane.index;
    if (fromLaneIndex === undefined) return;
    this.markLaneOccupants(fromLaneIndex);

    const laneCount = this.lanes.length;
    if (laneCount === 0) return;
    const generation = this.queryGeneration;
    this.routeActiveCounts.fill(0);
    const firstDistance = fromLane.length - fromDistance;
    const firstSuccessorStart = this.successorOffsets[fromLaneIndex];
    const firstSuccessorEnd = this.successorOffsets[fromLaneIndex + 1];
    for (let edgeIndex = firstSuccessorStart; edgeIndex < firstSuccessorEnd; edgeIndex += 1) {
      this.setRouteState(1, this.successorIndices[edgeIndex], firstDistance, generation);
    }

    // This is a depth-indexed relaxation rather than an iterator over a Map or
    // bucket. It marks a conservative superset of the old route search's
    // targets while keeping the same hop and distance envelope. The following
    // exact routeDistanceAhead call remains the semantic authority.
    for (let depth = 1; depth <= ROUTE_LOOKAHEAD_MAX_HOPS; depth += 1) {
      const stateOffset = depth * laneCount;
      const activeCount = this.routeActiveCounts[depth];
      for (let activeIndex = 0; activeIndex < activeCount; activeIndex += 1) {
        const laneIndex = this.routeActiveLaneIndices[stateOffset + activeIndex];
        const stateIndex = stateOffset + laneIndex;
        if (this.routeStateMarks[stateIndex] !== generation) continue;
        const distanceToStart = this.routeStateDistances[stateIndex];
        if (distanceToStart > ROUTE_LOOKAHEAD_LIMIT_M) continue;
        this.markLaneOccupants(laneIndex);
        if (depth === ROUTE_LOOKAHEAD_MAX_HOPS) continue;
        const nextDistance = distanceToStart + this.laneLengths[laneIndex];
        const successorStart = this.successorOffsets[laneIndex];
        const successorEnd = this.successorOffsets[laneIndex + 1];
        for (let edgeIndex = successorStart; edgeIndex < successorEnd; edgeIndex += 1) {
          this.setRouteState(
            depth + 1,
            this.successorIndices[edgeIndex],
            nextDistance,
            generation,
          );
        }
      }
    }
  }

  isMarked(slotIndex: number): boolean {
    return (
      this.queryGeneration !== 0 &&
      slotIndex >= 0 &&
      slotIndex < this.slotCapacity &&
      this.candidateMarks[slotIndex] === this.queryGeneration
    );
  }

  private setRouteState(
    depth: number,
    laneIndex: number,
    distanceToStart: number,
    generation: number,
  ): void {
    const stateIndex = depth * this.lanes.length + laneIndex;
    const alreadyActive = this.routeStateMarks[stateIndex] === generation;
    if (alreadyActive && this.routeStateDistances[stateIndex] <= distanceToStart) {
      return;
    }
    if (!alreadyActive) {
      const activeOffset = depth * this.lanes.length;
      const activeCount = this.routeActiveCounts[depth];
      this.routeActiveLaneIndices[activeOffset + activeCount] = laneIndex;
      this.routeActiveCounts[depth] = activeCount + 1;
    }
    this.routeStateMarks[stateIndex] = generation;
    this.routeStateDistances[stateIndex] = distanceToStart;
  }

  private linkLane(slotIndex: number, laneIndex: number): void {
    const previousHead = this.laneHeads[laneIndex];
    this.slotLaneIndices[slotIndex] = laneIndex;
    this.lanePrevious[slotIndex] = EMPTY_SLOT;
    this.laneNext[slotIndex] = previousHead;
    if (previousHead !== EMPTY_SLOT) this.lanePrevious[previousHead] = slotIndex;
    this.laneHeads[laneIndex] = slotIndex;
  }

  private unlinkLane(slotIndex: number, laneIndex: number): void {
    const previous = this.lanePrevious[slotIndex];
    const next = this.laneNext[slotIndex];
    if (previous === EMPTY_SLOT) this.laneHeads[laneIndex] = next;
    else this.laneNext[previous] = next;
    if (next !== EMPTY_SLOT) this.lanePrevious[next] = previous;
    this.slotLaneIndices[slotIndex] = EMPTY_SLOT;
    this.lanePrevious[slotIndex] = EMPTY_SLOT;
    this.laneNext[slotIndex] = EMPTY_SLOT;
  }

  private linkCell(slotIndex: number, cellKey: number): void {
    let cellBucket = this.cellBucketsByKey.get(cellKey);
    if (cellBucket === undefined) {
      cellBucket = this.freeCellBucket;
      if (cellBucket === EMPTY_SLOT) {
        // An active slot always owns a cell bucket, so this can occur only if
        // an invalid caller exceeds the reset slot capacity. Leave the lane
        // bucket authoritative rather than corrupting a valid world bucket.
        return;
      }
      this.freeCellBucket = this.freeCellNext[cellBucket];
      this.cellBucketsByKey.set(cellKey, cellBucket);
      this.cellKeys[cellBucket] = cellKey;
      this.cellHeads[cellBucket] = EMPTY_SLOT;
    }
    const previousHead = this.cellHeads[cellBucket];
    this.slotCellBuckets[slotIndex] = cellBucket;
    this.cellPrevious[slotIndex] = EMPTY_SLOT;
    this.cellNext[slotIndex] = previousHead;
    if (previousHead !== EMPTY_SLOT) this.cellPrevious[previousHead] = slotIndex;
    this.cellHeads[cellBucket] = slotIndex;
  }

  private unlinkCell(slotIndex: number, cellBucket: number): void {
    const previous = this.cellPrevious[slotIndex];
    const next = this.cellNext[slotIndex];
    if (previous === EMPTY_SLOT) this.cellHeads[cellBucket] = next;
    else this.cellNext[previous] = next;
    if (next !== EMPTY_SLOT) this.cellPrevious[next] = previous;
    this.slotCellBuckets[slotIndex] = EMPTY_SLOT;
    this.cellPrevious[slotIndex] = EMPTY_SLOT;
    this.cellNext[slotIndex] = EMPTY_SLOT;

    if (this.cellHeads[cellBucket] !== EMPTY_SLOT) return;
    this.cellBucketsByKey.delete(this.cellKeys[cellBucket]);
    this.freeCellNext[cellBucket] = this.freeCellBucket;
    this.freeCellBucket = cellBucket;
  }

  private cellKeyForPosition(x: number, z: number): number {
    return this.cellKey(
      Math.floor(x / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M),
      Math.floor(z / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M),
    );
  }

  private cellKey(cellX: number, cellZ: number): number {
    // Game worlds are measured in kilometres, not millions of cells. This
    // lossless pair encoding keeps Map keys numeric (no per-move string
    // allocation) while still covering +/-33,554 km at 32 m cells.
    const coordinateBias = 1_048_576;
    const coordinateSpan = coordinateBias * 2 + 1;
    if (Math.abs(cellX) > coordinateBias || Math.abs(cellZ) > coordinateBias) {
      throw new RangeError("Traffic world cell lies outside the supported coordinate range.");
    }
    return (cellX + coordinateBias) * coordinateSpan + cellZ + coordinateBias;
  }
}
