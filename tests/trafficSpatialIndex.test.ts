import { describe, expect, it } from "vitest";
import { FIXED_STEP_SECONDS, SimulationCore, type SimulationCoreConfig } from "../app/game/simulation";
import {
  RoadNetwork,
  ROUTE_LOOKAHEAD_LIMIT_M,
  type NormalizedLane,
  type SimulationLane,
} from "../app/game/simulation/roadNetwork";
import {
  TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M,
  TrafficSpatialIndex,
} from "../app/game/simulation/trafficSpatialIndex";

const lane = (
  id: string,
  startZ: number,
  endZ: number,
  successorLaneIds: readonly string[] = [],
): SimulationLane => ({
  id,
  points: [{ x: 0, z: startZ }, { x: 0, z: endZ }],
  successorLaneIds,
  loop: false,
});

const markedSlots = (index: TrafficSpatialIndex, count: number): number[] => {
  const result: number[] = [];
  for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
    if (index.isMarked(slotIndex)) result.push(slotIndex);
  }
  return result;
};

const requireLane = (roadNetwork: RoadNetwork, id: string): NormalizedLane => {
  const result = roadNetwork.lanesById.get(id);
  if (!result) throw new Error(`Missing test lane ${id}`);
  return result;
};

const seededUnitRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

interface IndexedSlotOracle {
  active: boolean;
  laneIndex: number;
  distance: number;
  x: number;
  z: number;
}

/** Exact semantic oracle for the lane-topology broad phase. Same-lane
 * occupants are deliberately always candidates: on a non-looping lane an
 * occupant behind the source has infinite route distance, but retaining that
 * bucket is the index's documented conservative behaviour. Every other mark
 * must agree exactly with RoadNetwork.routeDistanceAhead. */
const expectRouteCandidatesToMatchBruteForce = (
  roadNetwork: RoadNetwork,
  index: TrafficSpatialIndex,
  slots: readonly IndexedSlotOracle[],
  fromLane: NormalizedLane,
  fromDistance: number,
): void => {
  index.collectRouteLeadingCandidates(fromLane, fromDistance);
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const targetLane = roadNetwork.lanes[slot.laneIndex];
    const exact = roadNetwork.routeDistanceAhead(
      fromLane,
      fromDistance,
      targetLane,
      slot.distance,
    );
    const expected =
      slot.active &&
      (targetLane.index === fromLane.index || Number.isFinite(exact));
    expect(
      index.isMarked(slotIndex),
      `${fromLane.id}@${fromDistance.toFixed(3)} -> slot ${slotIndex} on ${targetLane.id}`,
    ).toBe(expected);
  }
};

const cellCoordinate = (value: number): number =>
  Math.floor(value / TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M);

/** The directed U is a single legal lane whose final arm runs physically close
 * to its first arm in the opposite direction. The forward car has the tail
 * car "behind" by route distance, even while it can drive toward it in world
 * space. This is the case the same-lane folded-body guard must cover. */
function foldedLaneBodyFixture(): SimulationCoreConfig {
  const laneId = "folded-u";
  return {
    seed: 42,
    npcCount: 2,
    lanes: [{
      id: laneId,
      points: [
        { x: 0, z: 0 },
        { x: 30, z: 0 },
        { x: 30, z: 2 },
        { x: 0, z: 2 },
      ],
      speedLimitMps: 8,
      loop: false,
    }],
    bounds: { minX: -200, maxX: 100, minZ: -20, maxZ: 20 },
    spawn: { x: -100, z: 0, heading: Math.PI / 2 },
    trafficGates: [
      {
        id: "folded-tail",
        laneId,
        distance: 5,
        variant: "car",
        desiredSpeedMps: 8,
      },
      {
        id: "folded-lead",
        laneId,
        distance: 42,
        variant: "car",
        desiredSpeedMps: 8,
      },
    ],
    minRuntimeSpawnDistanceM: 70,
  };
}

/** Two unrelated approaches share only their endpoint. They reach the last
 * 15 m at full speed on a non-decision tick, which used to leave four unchecked
 * fixed updates before the next 10 Hz crossing probe. */
function continuousConflictEndpointFixture(): SimulationCoreConfig {
  return {
    seed: 19,
    npcCount: 2,
    lanes: [
      {
        id: "south-approach",
        points: [{ x: 0, z: 0 }, { x: 0, z: 500 }],
        speedLimitMps: 45,
        loop: false,
      },
      {
        id: "west-approach",
        points: [{ x: -500, z: 500 }, { x: 0, z: 500 }],
        speedLimitMps: 45,
        loop: false,
      },
    ],
    bounds: { minX: -550, maxX: 40, minZ: -40, maxZ: 550 },
    spawn: { x: 300, z: -300, heading: 0 },
    trafficGates: [
      {
        id: "south-gate",
        laneId: "south-approach",
        distance: 100,
        desiredSpeedMps: 45,
      },
      {
        id: "west-gate",
        laneId: "west-approach",
        distance: 100,
        desiredSpeedMps: 45,
      },
    ],
  };
}

describe("TrafficSpatialIndex", () => {
  it("keeps lane and fixed-cell membership current without relying on bucket order", () => {
    const roadNetwork = new RoadNetwork(
      [lane("left", 0, 100), lane("right", 0, 100)],
      [],
      [],
    );
    const left = requireLane(roadNetwork, "left");
    const right = requireLane(roadNetwork, "right");
    const index = new TrafficSpatialIndex(roadNetwork, 3);
    expect(index.isMarked(0)).toBe(false);

    index.upsert(0, left.index!, 2, 2);
    index.upsert(1, right.index!, 38, 2);

    index.beginQuery();
    index.markLaneOccupants(left.index!);
    expect(markedSlots(index, 3)).toEqual([0]);

    index.beginQuery();
    index.markWorldAabb(-2, 31, -2, 31);
    expect(markedSlots(index, 3)).toEqual([0]);

    // A corrupt display pose must not make a logically valid lane occupant
    // disappear from route-leading. It has no safe geometric cell instead.
    index.upsert(2, left.index!, Number.NaN, 0);
    index.beginQuery();
    index.markLaneOccupants(left.index!);
    expect(markedSlots(index, 3)).toEqual([0, 2]);
    index.beginQuery();
    index.markWorldAabb(-2, 31, -2, 31);
    expect(markedSlots(index, 3)).toEqual([0]);

    // Move across both a lane boundary and a world-cell boundary. The stale
    // source lane/cell must no longer produce a candidate.
    index.upsert(0, right.index!, 66, 2);
    index.beginQuery();
    index.markLaneOccupants(left.index!);
    expect(markedSlots(index, 3)).toEqual([2]);

    index.beginQuery();
    index.markWorldAabb(64, 67, 0, 4);
    expect(markedSlots(index, 3)).toEqual([0]);

    index.remove(0);
    index.beginQuery();
    index.markLaneOccupants(right.index!);
    expect(markedSlots(index, 3)).toEqual([1]);
  });

  it("matches a brute-force cell oracle across boundaries and sequential slot churn", () => {
    const roadNetwork = new RoadNetwork(
      [
        lane("lane-a", 0, 200),
        lane("lane-b", 0, 200),
        lane("lane-c", 0, 200),
        lane("lane-d", 0, 200),
      ],
      [],
      [],
    );
    const capacity = 24;
    const index = new TrafficSpatialIndex(roadNetwork, capacity);
    const slots: IndexedSlotOracle[] = Array.from({ length: capacity }, () => ({
      active: false,
      laneIndex: -1,
      distance: 0,
      x: Number.NaN,
      z: Number.NaN,
    }));
    const random = seededUnitRandom(0x142_cafe);
    const boundaryOffsets = [
      -Number.EPSILON,
      0,
      Number.EPSILON,
      TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M - 1e-9,
      TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M,
      TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M + 1e-9,
    ] as const;

    const assertLaneBucket = (laneIndex: number): void => {
      index.beginQuery();
      index.markLaneOccupants(laneIndex);
      const expected = slots.flatMap((slot, slotIndex) =>
        slot.active && slot.laneIndex === laneIndex ? [slotIndex] : [],
      );
      expect(markedSlots(index, capacity)).toEqual(expected);
    };
    const assertCellQuery = (
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
    ): void => {
      index.beginQuery();
      index.markWorldAabb(minX, maxX, minZ, maxZ);
      const startX = cellCoordinate(Math.min(minX, maxX));
      const endX = cellCoordinate(Math.max(minX, maxX));
      const startZ = cellCoordinate(Math.min(minZ, maxZ));
      const endZ = cellCoordinate(Math.max(minZ, maxZ));
      const expected = slots.flatMap((slot, slotIndex) => {
        if (!slot.active || !Number.isFinite(slot.x) || !Number.isFinite(slot.z)) {
          return [];
        }
        const cellX = cellCoordinate(slot.x);
        const cellZ = cellCoordinate(slot.z);
        return cellX >= startX && cellX <= endX && cellZ >= startZ && cellZ <= endZ
          ? [slotIndex]
          : [];
      });
      expect(markedSlots(index, capacity)).toEqual(expected);
    };

    for (let operation = 0; operation < 500; operation += 1) {
      const slotIndex = Math.floor(random() * capacity);
      const slot = slots[slotIndex];
      if (random() < 0.28) {
        index.remove(slotIndex);
        slot.active = false;
        slot.laneIndex = -1;
        slot.x = Number.NaN;
        slot.z = Number.NaN;
      } else {
        // Frequent lane changes exercise unlink/link of both bucket heads and
        // interior list nodes. The coordinates deliberately move independently
        // of lane identity because display poses can cross cells mid-turn.
        const laneIndex = Math.floor(random() * roadNetwork.lanes.length);
        const cellX = Math.floor(random() * 11) - 5;
        const cellZ = Math.floor(random() * 11) - 5;
        const x =
          cellX * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M +
          boundaryOffsets[Math.floor(random() * boundaryOffsets.length)];
        const finitePose = operation % 37 !== 0;
        const z = finitePose
          ? cellZ * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M +
            boundaryOffsets[Math.floor(random() * boundaryOffsets.length)]
          : Number.NaN;
        index.upsert(slotIndex, laneIndex, x, z);
        slot.active = true;
        slot.laneIndex = laneIndex;
        slot.distance = random() * roadNetwork.lanes[laneIndex].length;
        slot.x = x;
        slot.z = z;
      }

      assertLaneBucket(Math.floor(random() * roadNetwork.lanes.length));
      const queryCellX = Math.floor(random() * 11) - 5;
      const queryCellZ = Math.floor(random() * 11) - 5;
      const x1 =
        queryCellX * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M +
        boundaryOffsets[Math.floor(random() * boundaryOffsets.length)];
      const x2 = x1 + (Math.floor(random() * 4) - 1) * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M;
      const z1 =
        queryCellZ * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M +
        boundaryOffsets[Math.floor(random() * boundaryOffsets.length)];
      const z2 = z1 + (Math.floor(random() * 4) - 1) * TRAFFIC_SPATIAL_INDEX_CELL_SIZE_M;
      // Alternate normal and reversed bounds; markWorldAabb promises both.
      assertCellQuery(
        operation % 2 === 0 ? x1 : x2,
        operation % 2 === 0 ? x2 : x1,
        operation % 3 === 0 ? z1 : z2,
        operation % 3 === 0 ? z2 : z1,
      );
    }

    // A resize reset must discard every stale lane/cell link before slots are
    // reused under the new capacity.
    index.reset(3);
    index.beginQuery();
    index.markWorldAabb(-1_000, 1_000, -1_000, 1_000);
    expect(markedSlots(index, 3)).toEqual([]);
    index.beginQuery();
    index.markLaneOccupants(0);
    expect(markedSlots(index, 3)).toEqual([]);
  });

  it("matches routeDistanceAhead on deterministic randomized graphs with cycles and disconnected parallels", () => {
    for (let graphSeed = 1; graphSeed <= 12; graphSeed += 1) {
      const random = seededUnitRandom(0x5eed_0000 + graphSeed);
      const laneCount = 14;
      const definitions: SimulationLane[] = [];
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        const componentStart = laneIndex < 7 ? 0 : laneIndex < 12 ? 7 : laneIndex;
        const componentEnd = laneIndex < 7 ? 7 : laneIndex < 12 ? 12 : laneIndex + 1;
        const successors = new Set<string>();
        if (laneIndex < 12) {
          // A guaranteed cycle in each connected component, plus deterministic
          // branches and self-edges. Lanes 12/13 are physically parallel but
          // topologically isolated decoys.
          const next = componentStart + ((laneIndex - componentStart + 1) % (componentEnd - componentStart));
          successors.add(`graph-${graphSeed}-lane-${next}`);
          const branchCount = 1 + Math.floor(random() * 3);
          for (let branch = 0; branch < branchCount; branch += 1) {
            const target = componentStart + Math.floor(random() * (componentEnd - componentStart));
            successors.add(`graph-${graphSeed}-lane-${target}`);
          }
        }
        const length = 12 + Math.floor(random() * 75);
        definitions.push({
          id: `graph-${graphSeed}-lane-${laneIndex}`,
          // All lanes are close parallel lines. Euclidean proximity therefore
          // cannot rescue an incorrect topology result.
          points: [
            { x: laneIndex * 1.5, z: 0 },
            { x: laneIndex * 1.5, z: length },
          ],
          successorLaneIds: [...successors],
          loop: laneIndex % 4 === 0,
        });
      }
      const roadNetwork = new RoadNetwork(definitions, [], []);
      const slots: IndexedSlotOracle[] = [];
      for (const candidate of roadNetwork.lanes) {
        for (let occupant = 0; occupant < 2; occupant += 1) {
          const distance = random() * candidate.length;
          const point = roadNetwork.pointOnLane(candidate, distance);
          slots.push({
            active: true,
            laneIndex: candidate.index!,
            distance,
            x: point.x,
            z: point.z,
          });
        }
      }
      const index = new TrafficSpatialIndex(roadNetwork, slots.length);
      slots.forEach((slot, slotIndex) => {
        index.upsert(slotIndex, slot.laneIndex, slot.x, slot.z);
      });

      for (const source of roadNetwork.lanes) {
        for (const fromDistance of [
          0,
          source.length / 2,
          Math.max(0, source.length - Number.EPSILON),
        ]) {
          expectRouteCandidatesToMatchBruteForce(
            roadNetwork,
            index,
            slots,
            source,
            fromDistance,
          );
        }
      }

      // Exercise live lane transitions and deactivation before running the
      // same brute-force oracle again. Slot order never changes.
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 3) {
        const slot = slots[slotIndex];
        if (slotIndex % 2 === 0) {
          index.remove(slotIndex);
          slot.active = false;
          continue;
        }
        const laneIndex = (slot.laneIndex + 5) % roadNetwork.lanes.length;
        const targetLane = roadNetwork.lanes[laneIndex];
        const distance = Math.min(targetLane.length, ROUTE_LOOKAHEAD_LIMIT_M / 3);
        const point = roadNetwork.pointOnLane(targetLane, distance);
        index.upsert(slotIndex, laneIndex, point.x, point.z);
        slot.laneIndex = laneIndex;
        slot.distance = distance;
        slot.x = point.x;
        slot.z = point.z;
      }
      for (const source of roadNetwork.lanes) {
        expectRouteCandidatesToMatchBruteForce(
          roadNetwork,
          index,
          slots,
          source,
          source.length * 0.37,
        );
      }
    }
  });

  it("marks every lane routeDistanceAhead can reach, including a target occupant past 240 m", () => {
    const roadNetwork = new RoadNetwork(
      [
        lane("source", 0, 20, ["merge", "branch"]),
        lane("merge", 20, 40, ["target"]),
        lane("branch", 20, 45, ["target"]),
        lane("target", 40, 1_040),
        lane("unreachable", 0, 100),
      ],
      [],
      [],
    );
    const slots = roadNetwork.lanes.map((candidate, slotIndex) => ({
      lane: candidate,
      slotIndex,
    }));
    const index = new TrafficSpatialIndex(roadNetwork, slots.length);
    for (const { lane: candidate, slotIndex } of slots) {
      // The target car is deliberately 900 m along a lane whose start is only
      // 40 m from source. Its exact route gap is >240 m but remains a legal
      // target of routeDistanceAhead, so the whole target bucket is required.
      const distance = candidate.id === "target" ? 900 : 5;
      const pose = roadNetwork.pointOnLane(candidate, distance);
      index.upsert(slotIndex, candidate.index!, pose.x, pose.z);
    }

    const source = requireLane(roadNetwork, "source");
    index.collectRouteLeadingCandidates(source, 0);
    expect(markedSlots(index, slots.length)).toEqual([0, 1, 2, 3]);
    const target = requireLane(roadNetwork, "target");
    expect(roadNetwork.routeDistanceAhead(source, 0, target, 900)).toBe(940);

    // This is the broad-phase oracle: it may mark additional candidates, but
    // no finite exact route is allowed to be missing from the mark set.
    for (const { lane: candidate, slotIndex } of slots) {
      const distance = candidate.id === "target" ? 900 : 5;
      const exact = roadNetwork.routeDistanceAhead(source, 0, candidate, distance);
      if (Number.isFinite(exact)) expect(index.isMarked(slotIndex)).toBe(true);
    }
  });

  it("honours routeDistanceAhead's 240 m and six-hop topology bounds", () => {
    const tooFarRoadNetwork = new RoadNetwork(
      [lane("source", 0, 300, ["too-far"]), lane("too-far", 300, 400)],
      [],
      [],
    );
    const farIndex = new TrafficSpatialIndex(tooFarRoadNetwork, 1);
    const tooFar = requireLane(tooFarRoadNetwork, "too-far");
    farIndex.upsert(0, tooFar.index!, 0, 350);
    farIndex.collectRouteLeadingCandidates(requireLane(tooFarRoadNetwork, "source"), 0);
    expect(farIndex.isMarked(0)).toBe(false);

    const chain = Array.from({ length: 8 }, (_, index) =>
      lane(
        `lane-${index}`,
        index * 10,
        (index + 1) * 10,
        index + 1 < 8 ? [`lane-${index + 1}`] : [],
      ),
    );
    const depthRoadNetwork = new RoadNetwork(chain, [], []);
    const depthIndex = new TrafficSpatialIndex(depthRoadNetwork, 2);
    const sixthHop = requireLane(depthRoadNetwork, "lane-6");
    const seventhHop = requireLane(depthRoadNetwork, "lane-7");
    depthIndex.upsert(0, sixthHop.index!, 0, 65);
    depthIndex.upsert(1, seventhHop.index!, 0, 75);
    depthIndex.collectRouteLeadingCandidates(requireLane(depthRoadNetwork, "lane-0"), 0);

    expect(depthIndex.isMarked(0)).toBe(true);
    expect(depthIndex.isMarked(1)).toBe(false);
  });

  it("keeps a folded lane's route-behind car outside rendered body clearance", () => {
    const simulation = new SimulationCore(foldedLaneBodyFixture());
    try {
      let minimumDistance = Number.POSITIVE_INFINITY;
      for (let tick = 0; tick < 120; tick += 1) {
        const snapshot = simulation.step(FIXED_STEP_SECONDS);
        expect(snapshot.npcs).toHaveLength(2);
        const [tail, lead] = snapshot.npcs;
        minimumDistance = Math.min(
          minimumDistance,
          Math.hypot(tail.x - lead.x, tail.z - lead.z),
        );
      }
      // The lane arms are only 2 m apart. The regular route-leading check
      // stops the tail, while this assertion proves the forward car also
      // honours the body envelope even though it sees the tail as behind.
      expect(minimumDistance).toBeGreaterThanOrEqual(3.8 - 1e-6);
    } finally {
      simulation.dispose();
    }
  });

  it("checks a converging endpoint on every fixed step inside its body envelope", () => {
    const simulation = new SimulationCore(continuousConflictEndpointFixture());
    try {
      let minimumDistance = Number.POSITIVE_INFINITY;
      let heldOnNonDecisionTick = false;
      // Tick 651 is intentionally not a 10 Hz decision tick. With only the
      // old cadence, npc-2 advances through ticks 651–653 and reaches 4.63 m
      // before tick 654 can arbitrate. The continuous endpoint guard instead
      // holds it at tick 651 and preserves the higher-priority 5 m envelope.
      for (let tick = 0; tick < 657; tick += 1) {
        const snapshot = simulation.step(FIXED_STEP_SECONDS);
        expect(snapshot.npcs).toHaveLength(2);
        const [first, second] = snapshot.npcs;
        minimumDistance = Math.min(
          minimumDistance,
          Math.hypot(first.x - second.x, first.z - second.z),
        );
        if (snapshot.tick % 6 !== 0 && second.speedMps === 0) {
          heldOnNonDecisionTick = true;
        }
      }
      expect(heldOnNonDecisionTick).toBe(true);
      expect(minimumDistance).toBeGreaterThanOrEqual(5 - 1e-6);
    } finally {
      simulation.dispose();
    }
  });
});
