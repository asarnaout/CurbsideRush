import { describe, expect, it } from "vitest";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import {
  NYC_QUEENSVIEW_ACCESS_SITES,
  NYC_QUEENSVIEW_NETWORK_PREFIX,
} from "../app/game/cities/nycElevatedRoadNetwork";
import { elevatedRoadJunctionEnvelopes } from "../app/game/geometry/elevatedRoadGeometry";
import { buildRoadSurfaceStripGeometry } from "../app/game/geometry/roadStrips";
import {
  curateNycRegulatorySigns,
  curateNycSpeedLimitSigns,
} from "../app/game/nycRoadSigns";
import {
  regulatorySignPlacements,
  regulatorySignYawRad,
  speedLimitSignPlacements,
  speedLimitSignYawRad,
  type RegulatorySignPlacement,
  type SpeedLimitSignPlacement,
} from "../app/game/regulatorySigns";

type Sign = RegulatorySignPlacement | SpeedLimitSignPlacement;
interface Point3 { readonly x: number; readonly y: number; readonly z: number }
interface PavementTriangle {
  readonly isQueensview: boolean;
  readonly points: readonly Point3[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const pack = NYC_MAP_PACK;
const allSurfaces = pack.geometry.roadSurfaces;
const signInput = {
  lanes: pack.laneGraph.lanes,
  roadSurfaces: allSurfaces,
  defaultRoadWidthM: pack.geometry.roadWidth,
  occupiedPositions: pack.laneGraph.controls.flatMap((control) =>
    (control.installations ?? [])
      .filter((installation) => installation.mounting !== "road_marking")
      .map((installation) => installation.position),
  ),
};
const rawRegulatory = regulatorySignPlacements(signInput);
const rawSpeed = speedLimitSignPlacements(signInput);
const presentedRegulatory = curateNycRegulatorySigns(rawRegulatory);
const presentedSpeed = curateNycSpeedLimitSigns(rawSpeed);

/** Real pavement triangles include the widened mouths missed by kerb offsets. */
const pavementTriangles: readonly PavementTriangle[] = (() => {
  const triangles: PavementTriangle[] = [];
  const add = (
    isQueensview: boolean,
    positions: readonly number[],
    indices: readonly number[],
  ) => {
    for (let offset = 0; offset + 2 < indices.length; offset += 3) {
      const points = indices.slice(offset, offset + 3).map((index) => ({
        x: positions[index * 3],
        y: positions[index * 3 + 1],
        z: positions[index * 3 + 2],
      }));
      triangles.push({
        isQueensview,
        points,
        minX: Math.min(...points.map((point) => point.x)),
        maxX: Math.max(...points.map((point) => point.x)),
        minZ: Math.min(...points.map((point) => point.z)),
        maxZ: Math.max(...points.map((point) => point.z)),
      });
    }
  };
  for (const surface of allSurfaces) {
    const strip = buildRoadSurfaceStripGeometry(surface.centerline, surface.widthM);
    add(surface.id.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX), strip.positions, strip.indices);
  }
  for (const envelope of elevatedRoadJunctionEnvelopes(allSurfaces)) {
    add(
      envelope.surfaceIds.some((id) => id.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX)),
      envelope.asphaltMesh.points.flatMap((point) => [point.x, point.elevationM ?? 0, point.z]),
      envelope.asphaltMesh.indices,
    );
  }
  return triangles;
})();
const queensviewPavement = pavementTriangles.filter((triangle) => triangle.isQueensview);

const clip = (
  polygon: readonly Point3[],
  distance: (point: Point3) => number,
): readonly Point3[] => {
  const result: Point3[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const da = distance(a);
    const db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) === (db >= 0)) continue;
    const fraction = da / (da - db);
    result.push({
      x: a.x + (b.x - a.x) * fraction,
      y: a.y + (b.y - a.y) * fraction,
      z: a.z + (b.z - a.z) * fraction,
    });
  }
  return result;
};

/**
 * Match buildRegulatorySigns/buildSpeedLimitSigns: the complete 2.6m pole and
 * each oriented blade, including its 8cm forward offset. Clipping the actual
 * asphalt triangle against that footprint catches face interiors as well as
 * corners. Its elevation plane keeps lower streets separate from high signs.
 */
const signIntrudes = (sign: Sign, triangles: readonly PavementTriangle[]): boolean => {
  const regulatory = "kind" in sign;
  const yaw = regulatory
    ? regulatorySignYawRad(sign.kind, sign.flowHeadingRad)
    : speedLimitSignYawRad(sign.flowHeadingRad);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const baseY = sign.elevationM ?? 0;
  const [width, height, bladeY, forward] = !regulatory
    ? [0.61, 0.76, 2.12, -0.08]
    : sign.kind === "one_way"
      ? [0.9, 0.3, 2.75, 0]
      : sign.kind === "do_not_enter"
        ? [0.75, 0.75, 2.2, -0.08]
        : [0.9, 0.6, 2.05, -0.08];
  const parts = [
    { x: sign.x, z: sign.z, halfX: 0.045, halfZ: 0.045, minY: baseY, maxY: baseY + 2.6 },
    {
      x: sign.x + sin * forward,
      z: sign.z + cos * forward,
      halfX: width / 2,
      halfZ: 0.045 / 2,
      minY: baseY + bladeY - height / 2,
      maxY: baseY + bladeY + height / 2,
    },
  ];
  for (const part of parts) {
    const radius = Math.hypot(part.halfX, part.halfZ);
    const localX = (point: Point3) => (point.x - part.x) * cos - (point.z - part.z) * sin;
    const localZ = (point: Point3) => (point.x - part.x) * sin + (point.z - part.z) * cos;
    const faces = [
      (point: Point3) => part.halfX - localX(point),
      (point: Point3) => part.halfX + localX(point),
      (point: Point3) => part.halfZ - localZ(point),
      (point: Point3) => part.halfZ + localZ(point),
      (point: Point3) => part.maxY - point.y - 0.01,
      // The same generous visual passage retained beneath the bridge truss.
      (point: Point3) => point.y + 6.5 - part.minY,
    ];
    for (const triangle of triangles) {
      if (triangle.maxX < part.x - radius || triangle.minX > part.x + radius ||
        triangle.maxZ < part.z - radius || triangle.minZ > part.z + radius) continue;
      let polygon = triangle.points;
      for (const face of faces) {
        polygon = clip(polygon, face);
        if (!polygon.length) break;
      }
      if (polygon.length) return true;
    }
  }
  return false;
};

const intrusiveRegulatory = rawRegulatory.filter((sign) => signIntrudes(sign, queensviewPavement));
const intrusiveSpeed = rawSpeed.filter((sign) => signIntrudes(sign, queensviewPavement));

describe("NYC Queensview sign presentation", () => {
  it("reproduces the four regulatory and four speed posts inside widened mouths", () => {
    expect(intrusiveRegulatory).toHaveLength(4);
    expect(intrusiveSpeed).toHaveLength(4);
  });

  it("keeps every presented NYC sign out of Queensview pavement, including full poles and blades", () => {
    const intrusions = [...presentedRegulatory, ...presentedSpeed]
      .filter((sign) => signIntrudes(sign, queensviewPavement))
      .map((sign) => sign.refId);
    expect(intrusions).toEqual([]);
  });

  it("keeps retained Queensview signs clear of every NYC road at the sign's height", () => {
    const intrusions = [...presentedRegulatory, ...presentedSpeed]
      .filter((sign) => sign.roadId.startsWith(NYC_QUEENSVIEW_NETWORK_PREFIX))
      .filter((sign) => signIntrudes(sign, pavementTriangles))
      .map((sign) => sign.refId);
    expect(intrusions).toEqual([]);
  });

  it("preserves safe placements and unrelated streets exactly", () => {
    expect(presentedRegulatory).toEqual(rawRegulatory.filter((sign) => !intrusiveRegulatory.includes(sign)));
    const originalRedundantRepeaters = new Set([
      "nyc-queensview-bridge@510,-834.7:w:limit40:repeater",
      "nyc-queensview-bridge@730,-841.7:e:limit40:repeater",
    ]);
    expect(presentedSpeed).toEqual(rawSpeed.filter((sign) =>
      !intrusiveSpeed.includes(sign) && !originalRedundantRepeaters.has(sign.refId),
    ));
  });

  it("retains direction warnings on all eight access movements", () => {
    const movements = NYC_QUEENSVIEW_ACCESS_SITES.flatMap((site) => [site.entry, site.exit]);
    expect(movements).toHaveLength(8);
    for (const movement of movements) {
      expect(presentedRegulatory.some((sign) =>
        sign.roadId === movement.rampSurfaceId || sign.roadId === movement.slipSurfaceId,
      ), movement.rampSurfaceId).toBe(true);
    }
  });
});
