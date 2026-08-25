import { describe, expect, it } from "vitest";

import { LONDON_MAP_PACK } from "../app/game/cities/london";
import type { ProceduralBlock, RoadSurface, WorldPoint } from "../app/game/types";
import { PAVED_SIDEWALK_WIDTH_M } from "../app/game/visuals";

const OPPOSITE_EDGE = {
  "+x": "-x",
  "-x": "+x",
  "+z": "-z",
  "-z": "+z",
} as const;

const distanceToSegment = (
  candidate: WorldPoint,
  from: WorldPoint,
  to: WorldPoint,
): number => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return Math.hypot(candidate.x - from.x, candidate.z - from.z);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((candidate.x - from.x) * dx + (candidate.z - from.z) * dz) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    candidate.x - (from.x + dx * t),
    candidate.z - (from.z + dz * t),
  );
};

const isRoadClear = (
  candidate: WorldPoint,
  roads: readonly RoadSurface[],
): boolean =>
  roads.every((road) => {
    const clearanceM =
      (road.widthM ?? 10) / 2 + PAVED_SIDEWALK_WIDTH_M + 5;
    return road.centerline.slice(1).every(
      (to, index) =>
        distanceToSegment(candidate, road.centerline[index], to) >= clearanceM,
    );
  });

const localAlongOf = (
  block: ProceduralBlock,
  candidate: WorldPoint,
  alongX: boolean,
): number => {
  const yaw = ((block.headingDeg ?? 0) * Math.PI) / 180;
  const dx = candidate.x - block.center.x;
  const dz = candidate.z - block.center.z;
  const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return alongX ? localX : localZ;
};

describe("London whole-map urban-fabric coverage", () => {
  it("keeps both sides of Kensington Park Road as real street wall", () => {
    const corridorBlocks = LONDON_MAP_PACK.geometry.blocks.filter((block) =>
      block.id.startsWith("london-block-fine-kensington-park-road-0-"),
    );
    const left = corridorBlocks.filter((block) =>
      block.id.startsWith("london-block-fine-kensington-park-road-0-l"),
    );
    const right = corridorBlocks.filter((block) =>
      block.id.startsWith("london-block-fine-kensington-park-road-0-r"),
    );

    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(corridorBlocks.every((block) => block.buildingSet)).toBe(true);
    // Small fitted greens may cut a local opening, but neither side may be
    // mistaken for one park reservation and discarded wholesale again.
    expect(left.reduce((sum, block) => sum + block.size.x, 0)).toBeGreaterThan(400);
    expect(right.reduce((sum, block) => sum + block.size.x, 0)).toBeGreaterThan(400);
  });

  it("fills oversized modelled blocks with compact interior courtyards", () => {
    const allInteriorCourtyards = LONDON_MAP_PACK.geometry.blocks.filter(
      (block) => block.id.startsWith("london-block-interior-"),
    );
    const markedWestbourneBlock = allInteriorCourtyards.filter((block) =>
      block.id.startsWith("london-block-interior-wc-fab-e-"),
    );
    const westbourneGreen = LONDON_MAP_PACK.geometry.landmarks.find(
      (landmark) => landmark.id === "london-westbourne-green",
    );

    expect(allInteriorCourtyards.length).toBeGreaterThanOrEqual(50);
    expect(markedWestbourneBlock).toHaveLength(6);
    expect(westbourneGreen).toBeDefined();
    for (const block of markedWestbourneBlock) {
      expect(
        Math.abs(block.center.x - westbourneGreen!.center.x) <
          block.size.x / 2 + westbourneGreen!.size.x / 2 &&
          Math.abs(block.center.z - westbourneGreen!.center.z) <
            block.size.z / 2 + westbourneGreen!.size.z / 2,
      ).toBe(false);
    }
  });

  it("never leaves 18 m of a deep parcel's rear edge as unbuilt concrete", () => {
    const blocks = LONDON_MAP_PACK.geometry.blocks;
    const roads = LONDON_MAP_PACK.geometry.roadSurfaces;
    const failures: string[] = [];

    for (const block of blocks) {
      if (
        !block.buildingSet ||
        block.streetEdges?.length !== 1 ||
        block.id.includes("-rear-mews-") ||
        block.id.startsWith("london-block-courtyard-")
      ) {
        continue;
      }
      const publicEdge = block.streetEdges[0];
      const alongX = publicEdge.endsWith("z");
      const depthM = alongX ? block.size.z : block.size.x;
      // Ordinary 34–44 m terrace strips are one-row parcels; 46 m is the
      // authored point at which London treats a parcel as genuinely two-row.
      if (depthM < 46) continue;
      const frontageM = alongX ? block.size.x : block.size.z;
      const rearEdge = OPPOSITE_EDGE[publicEdge];
      const yaw = ((block.headingDeg ?? 0) * Math.PI) / 180;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const localDepthM =
        rearEdge === "+z"
          ? block.size.z / 2
          : rearEdge === "-z"
            ? -block.size.z / 2
            : rearEdge === "+x"
              ? block.size.x / 2
              : -block.size.x / 2;
      const sourceBlockId = block.id.replace(/-rw\d+$/, "");
      const descendants = blocks.filter((candidate) =>
        candidate.id.startsWith(`${sourceBlockId}-rear-mews-`),
      );
      const sampleCount = Math.max(1, Math.ceil(frontageM / 6));
      const sampleLengthM = frontageM / sampleCount;
      let openRunM = 0;
      let longestOpenRunM = 0;

      for (let index = 0; index < sampleCount; index += 1) {
        const localAlongM =
          -frontageM / 2 + sampleLengthM * (index + 0.5);
        const localX = alongX ? localAlongM : localDepthM;
        const localZ = alongX ? localDepthM : localAlongM;
        const sample = {
          x: block.center.x + cos * localX + sin * localZ,
          z: block.center.z - sin * localX + cos * localZ,
        };
        const protectedByRoad = !isRoadClear(sample, roads);
        const protectedByRearMews = descendants.some((descendant) => {
          const descendantAlongM = localAlongOf(block, descendant.center, alongX);
          const descendantLengthM = alongX ? descendant.size.x : descendant.size.z;
          return Math.abs(localAlongM - descendantAlongM) <= descendantLengthM / 2 + 0.1;
        });
        if (protectedByRoad || protectedByRearMews) {
          openRunM = 0;
        } else {
          openRunM += sampleLengthM;
          longestOpenRunM = Math.max(longestOpenRunM, openRunM);
        }
      }
      if (longestOpenRunM >= 18) {
        failures.push(`${block.id}: ${longestOpenRunM.toFixed(1)} m open`);
      }
    }

    expect(failures).toEqual([]);
  });
});
