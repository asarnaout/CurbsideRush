import type { GameCanvasMapPack, GameCanvasPoint } from "./sessionContract";
import { buildingPlacementConfig } from "./buildingSets";
import type {
  BuildingLayoutPlan,
  StructuralObb,
} from "./geometry/buildingLayout";
import { roadsidePropKeepOuts } from "./geometry/roadFurnitureLayout";

/**
 * Cairo's commercial-sign layer is authored as campaigns, not one-off props.
 * The reference streets repeat one creative down a whole run of lamp posts,
 * then interrupt that rhythm with a much larger skyline panel. Keeping the
 * placement math here (outside Babylon) makes that density deterministic and
 * lets tests guard the Arabic/English mix without constructing a scene.
 */

export interface CairoAdCreative {
  readonly id: string;
  readonly headline: string;
  readonly subline: string;
  readonly language: "ar" | "en" | "bilingual";
  /** Cell in public/art/cairo/fictional-ad-atlas-v1.png, row-major. */
  readonly artIndex: number;
  /** Copy sits in the art atlas's deliberately clear right-hand field. */
  readonly copySide: "right";
  readonly accent: string;
}

/**
 * Slogan-only fictional campaigns. They name no company or product brand;
 * the art supplies the category while the copy stays deliberately generic.
 * Arabic leads the mix, with two English/bilingual interruptions so the city
 * does not read as one repeated texture set.
 */
export const CAIRO_AD_CREATIVES: readonly CairoAdCreative[] = [
  {
    id: "fresh-every-day",
    headline: "كل يوم أطيب",
    subline: "انتعاش بطعم جديد",
    language: "ar",
    artIndex: 0,
    copySide: "right",
    accent: "#fff1a6",
  },
  {
    id: "closer-to-you",
    headline: "أقرب إليك",
    subline: "اتصال أسرع كل يوم",
    language: "ar",
    artIndex: 1,
    copySide: "right",
    accent: "#71e8ff",
  },
  {
    id: "move-bright",
    headline: "MOVE BRIGHT",
    subline: "Comfort in every step",
    language: "en",
    artIndex: 2,
    copySide: "right",
    accent: "#fff3df",
  },
  {
    id: "first-sip",
    headline: "طازة من أول رشفة",
    subline: "نكهة تفتح يومك",
    language: "ar",
    artIndex: 3,
    copySide: "right",
    accent: "#fff4b0",
  },
  {
    id: "morning-mood",
    headline: "صباحك له مزاج",
    subline: "لحظة دافية على مهلك",
    language: "ar",
    artIndex: 4,
    copySide: "right",
    accent: "#ffd39b",
  },
  {
    id: "your-kind-of-home",
    headline: "بيت على ذوقك",
    subline: "مساحة أهدى كل يوم",
    language: "ar",
    artIndex: 5,
    copySide: "right",
    accent: "#baf6ef",
  },
  {
    id: "door-to-door",
    headline: "يوصل بسرعة",
    subline: "من الباب للباب",
    language: "ar",
    artIndex: 6,
    copySide: "right",
    accent: "#ffd5a4",
  },
  {
    id: "hear-the-city",
    headline: "HEAR THE CITY",
    subline: "اسمع الفرق",
    language: "bilingual",
    artIndex: 7,
    copySide: "right",
    accent: "#8ee7ff",
  },
];

/**
 * ImageGen produced a visually regular 2x4 atlas, but its horizontal rules are
 * not mathematically quarter-height. Equal 0.25 UV slices therefore straddled
 * two campaigns (most visibly a strip of shoe art over the coffee board).
 * These are the measured source-pixel cell edges; the two-pixel inset keeps
 * bilinear filtering wholly inside one creative at every edge.
 */
const CAIRO_AD_ATLAS_WIDTH_PX = 1774;
const CAIRO_AD_ATLAS_HEIGHT_PX = 887;
const CAIRO_AD_ATLAS_COLUMN_EDGES_PX = [0, 887, 1774] as const;
const CAIRO_AD_ATLAS_ROW_EDGES_PX = [0, 249, 478, 674, 887] as const;
const CAIRO_AD_ATLAS_INSET_PX = 2;

export interface CairoAdAtlasUv {
  readonly uOffset: number;
  readonly uScale: number;
  readonly vOffset: number;
  readonly vScale: number;
}

/** UV crop for the atlas's `invertY: true` Babylon texture. */
export function cairoAdAtlasUv(artIndex: number): CairoAdAtlasUv {
  const column = artIndex % 2;
  const row = Math.floor(artIndex / 2);
  const leftPx = CAIRO_AD_ATLAS_COLUMN_EDGES_PX[column] + CAIRO_AD_ATLAS_INSET_PX;
  const rightPx =
    CAIRO_AD_ATLAS_COLUMN_EDGES_PX[column + 1] - CAIRO_AD_ATLAS_INSET_PX;
  const topPx = CAIRO_AD_ATLAS_ROW_EDGES_PX[row] + CAIRO_AD_ATLAS_INSET_PX;
  const bottomPx = CAIRO_AD_ATLAS_ROW_EDGES_PX[row + 1] - CAIRO_AD_ATLAS_INSET_PX;
  return {
    uOffset: leftPx / CAIRO_AD_ATLAS_WIDTH_PX,
    uScale: (rightPx - leftPx) / CAIRO_AD_ATLAS_WIDTH_PX,
    // The texture is loaded with invertY=true, so a top-origin pixel crop has
    // to be addressed upward from the bottom of Babylon's V range.
    vOffset: 1 - bottomPx / CAIRO_AD_ATLAS_HEIGHT_PX,
    vScale: (bottomPx - topPx) / CAIRO_AD_ATLAS_HEIGHT_PX,
  };
}

export interface CairoAdPlacement {
  readonly id: string;
  readonly kind: "pole-banner" | "skyline-billboard" | "bridge-gantry";
  readonly sourceRoadId: string;
  readonly position: GameCanvasPoint;
  /** Babylon yaw. A plane's local Z normal is the direction of the ad face. */
  readonly headingRad: number;
  readonly creativeIndex: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly panelCenterYM: number;
  /** Gantry leg distance from road centre; absent on ordinary roadside ads. */
  readonly supportOffsetM?: number;
}

type RoadSurface = NonNullable<
  GameCanvasMapPack["geometry"]["roadSurfaces"]
>[number];

interface CampaignRule {
  readonly roadId: string;
  readonly spacingM: number;
  readonly startM: number;
  readonly endPadM: number;
  readonly creativeStart: number;
  readonly firstSide: 1 | -1;
  readonly bothSides?: boolean;
}

/*
 * These runs cover every ordinary named boulevard/collector in the authored
 * centre, not just the long north-south roads near the default spawn. Wide
 * roads carry a pair at each station; smaller collectors alternate sides.
 * A 60-78 m station interval reads as the repeated lamp-post campaigns in the
 * references once junction/rail clearances remove unsafe candidates.
 */
const POLE_CAMPAIGNS: readonly CampaignRule[] = [
  { roadId: "cairo-corniche-el-nil", spacingM: 66, startM: 34, endPadM: 32, creativeStart: 0, firstSide: 1, bothSides: true },
  { roadId: "cairo-qasr-el-ainy", spacingM: 68, startM: 36, endPadM: 34, creativeStart: 1, firstSide: -1, bothSides: true },
  { roadId: "cairo-simon-bolivar", spacingM: 76, startM: 38, endPadM: 36, creativeStart: 2, firstSide: 1 },
  { roadId: "cairo-talaat-harb", spacingM: 72, startM: 38, endPadM: 36, creativeStart: 3, firstSide: -1 },
  { roadId: "cairo-ramses", spacingM: 66, startM: 34, endPadM: 32, creativeStart: 3, firstSide: 1, bothSides: true },
  { roadId: "cairo-galaa-street", spacingM: 68, startM: 36, endPadM: 34, creativeStart: 4, firstSide: -1, bothSides: true },
  { roadId: "cairo-garden-city-south", spacingM: 76, startM: 40, endPadM: 38, creativeStart: 5, firstSide: 1 },
  { roadId: "cairo-abdel-qader-hamza", spacingM: 76, startM: 40, endPadM: 38, creativeStart: 6, firstSide: -1 },
  { roadId: "cairo-tahrir-approach", spacingM: 64, startM: 34, endPadM: 32, creativeStart: 7, firstSide: 1, bothSides: true },
  { roadId: "cairo-qasr-el-nil-street", spacingM: 60, startM: 32, endPadM: 30, creativeStart: 7, firstSide: -1, bothSides: true },
  { roadId: "cairo-champollion", spacingM: 74, startM: 38, endPadM: 36, creativeStart: 0, firstSide: 1 },
  { roadId: "cairo-ramses-approach", spacingM: 70, startM: 36, endPadM: 34, creativeStart: 1, firstSide: -1, bothSides: true },
  { roadId: "cairo-saray-el-gezira", spacingM: 70, startM: 36, endPadM: 34, creativeStart: 2, firstSide: 1, bothSides: true },
  { roadId: "cairo-el-gabalaya", spacingM: 74, startM: 38, endPadM: 36, creativeStart: 3, firstSide: -1 },
  { roadId: "cairo-opera-corridor", spacingM: 72, startM: 38, endPadM: 36, creativeStart: 4, firstSide: 1 },
  { roadId: "cairo-nile-island-drive", spacingM: 66, startM: 34, endPadM: 32, creativeStart: 5, firstSide: -1, bothSides: true },
  { roadId: "cairo-south-gezira-road", spacingM: 68, startM: 34, endPadM: 32, creativeStart: 6, firstSide: 1 },
  { roadId: "cairo-zamalek-south", spacingM: 66, startM: 34, endPadM: 32, creativeStart: 7, firstSide: -1 },
  { roadId: "cairo-opera-square", spacingM: 64, startM: 34, endPadM: 32, creativeStart: 0, firstSide: 1 },
  { roadId: "cairo-zamalek-north", spacingM: 62, startM: 32, endPadM: 30, creativeStart: 1, firstSide: -1 },
  { roadId: "cairo-qasr-el-nil-bridge", spacingM: 55, startM: 30, endPadM: 28, creativeStart: 2, firstSide: 1, bothSides: true },
  { roadId: "cairo-al-galaa-bridge", spacingM: 50, startM: 28, endPadM: 26, creativeStart: 3, firstSide: -1, bothSides: true },
  { roadId: "cairo-west-nile-street", spacingM: 68, startM: 36, endPadM: 34, creativeStart: 4, firstSide: 1, bothSides: true },
  { roadId: "cairo-dokki-nile-drive", spacingM: 66, startM: 34, endPadM: 32, creativeStart: 5, firstSide: -1, bothSides: true },
  { roadId: "cairo-dokki-south", spacingM: 58, startM: 30, endPadM: 28, creativeStart: 6, firstSide: 1 },
  { roadId: "cairo-dokki-midtown", spacingM: 55, startM: 28, endPadM: 26, creativeStart: 7, firstSide: -1 },
  { roadId: "cairo-agouza-approach", spacingM: 52, startM: 27, endPadM: 25, creativeStart: 0, firstSide: 1 },
];

const SKYLINE_CAMPAIGNS: readonly CampaignRule[] = [
  { roadId: "cairo-corniche-el-nil", spacingM: 220, startM: 105, endPadM: 95, creativeStart: 0, firstSide: 1 },
  { roadId: "cairo-qasr-el-ainy", spacingM: 245, startM: 120, endPadM: 105, creativeStart: 4, firstSide: 1 },
  { roadId: "cairo-simon-bolivar", spacingM: 230, startM: 105, endPadM: 95, creativeStart: 6, firstSide: -1 },
  { roadId: "cairo-ramses", spacingM: 220, startM: 105, endPadM: 95, creativeStart: 1, firstSide: -1 },
  { roadId: "cairo-galaa-street", spacingM: 235, startM: 110, endPadM: 100, creativeStart: 6, firstSide: 1 },
  { roadId: "cairo-tahrir-approach", spacingM: 195, startM: 92, endPadM: 82, creativeStart: 2, firstSide: 1 },
  { roadId: "cairo-qasr-el-nil-street", spacingM: 185, startM: 88, endPadM: 78, creativeStart: 3, firstSide: -1 },
  { roadId: "cairo-ramses-approach", spacingM: 210, startM: 98, endPadM: 88, creativeStart: 7, firstSide: -1 },
  { roadId: "cairo-saray-el-gezira", spacingM: 245, startM: 115, endPadM: 105, creativeStart: 4, firstSide: 1 },
  { roadId: "cairo-nile-island-drive", spacingM: 235, startM: 110, endPadM: 100, creativeStart: 5, firstSide: -1 },
  { roadId: "cairo-zamalek-north", spacingM: 160, startM: 72, endPadM: 62, creativeStart: 0, firstSide: 1 },
  { roadId: "cairo-west-nile-street", spacingM: 235, startM: 110, endPadM: 100, creativeStart: 2, firstSide: -1 },
  { roadId: "cairo-dokki-nile-drive", spacingM: 230, startM: 108, endPadM: 98, creativeStart: 5, firstSide: 1 },
];

interface BridgeCampaignRule {
  readonly roadId: string;
  readonly spacingM: number;
  readonly startM: number;
  readonly endPadM: number;
  readonly creativeStart: number;
}

/** Approach-facing boards that physically span the deck with kerb-side legs. */
const BRIDGE_GANTRY_CAMPAIGNS: readonly BridgeCampaignRule[] = [
  { roadId: "cairo-sixth-october-bridge", spacingM: 150, startM: 70, endPadM: 65, creativeStart: 0 },
  { roadId: "cairo-qasr-el-nil-bridge", spacingM: 180, startM: 102, endPadM: 90, creativeStart: 5 },
  { roadId: "cairo-al-galaa-bridge", spacingM: 160, startM: 88, endPadM: 80, creativeStart: 7 },
];

interface PolylineSample extends GameCanvasPoint {
  readonly headingRad: number;
}

function roadLength(road: RoadSurface): number {
  let total = 0;
  for (let index = 0; index < road.centerline.length - 1; index += 1) {
    const a = road.centerline[index];
    const b = road.centerline[index + 1];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

function sampleRoad(road: RoadSurface, distanceM: number): PolylineSample | null {
  let remaining = distanceM;
  for (let index = 0; index < road.centerline.length - 1; index += 1) {
    const a = road.centerline[index];
    const b = road.centerline[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    if (remaining <= length || index === road.centerline.length - 2) {
      const amount = Math.min(1, Math.max(0, remaining / length));
      return {
        x: a.x + dx * amount,
        z: a.z + dz * amount,
        elevationM:
          (a.elevationM ?? 0) + ((b.elevationM ?? 0) - (a.elevationM ?? 0)) * amount,
        headingRad: Math.atan2(dx, dz),
      };
    }
    remaining -= length;
  }
  return null;
}

function distanceToSegmentM(
  point: GameCanvasPoint,
  start: GameCanvasPoint,
  end: GameCanvasPoint,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-6) return Math.hypot(point.x - start.x, point.z - start.z);
  const amount = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared),
  );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  );
}

function distanceToRoadM(point: GameCanvasPoint, road: RoadSurface): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < road.centerline.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToSegmentM(point, road.centerline[index], road.centerline[index + 1]),
    );
  }
  return nearest;
}

function pointIsClearOfCrossings(
  mapPack: GameCanvasMapPack,
  point: GameCanvasPoint,
  sourceRoadId: string,
  alongReachM: number,
): boolean {
  const clearOfRoads = (mapPack.geometry.roadSurfaces ?? []).every((road) => {
    if (road.id === sourceRoadId) return true;
    return (
      distanceToRoadM(point, road) >=
      road.widthM / 2 + (road.sidewalkWidthM ?? 2.6) + alongReachM
    );
  });
  if (!clearOfRoads) return false;
  return (mapPack.geometry.railLines ?? []).every(
    (rail) =>
      rail.points.slice(1).every(
        (end, index) =>
          distanceToSegmentM(point, rail.points[index], end) >=
          rail.corridorHalfWidthM + alongReachM,
      ),
  );
}

interface OrientedFootprint {
  readonly center: GameCanvasPoint;
  readonly axisU: GameCanvasPoint;
  readonly axisV: GameCanvasPoint;
  readonly halfU: number;
  readonly halfV: number;
}

interface SkylineCandidate {
  readonly sourceRoadId: string;
  readonly position: GameCanvasPoint;
  readonly headingRad: number;
  readonly side: 1 | -1;
  readonly footprint: OrientedFootprint;
}

// The frame itself is 0.34 m deep, but the three lamps project to local
// z=-0.54. Auditing a 1.08 m envelope covers frame, lamps, crossbar and the
// compact pedestal as one installation rather than letting an accessory clip.
const SKYLINE_INSTALLATION_DEPTH_M = 1.08;
const SKYLINE_FRAME_WIDTH_TRIM_M = 0.55;
const SKYLINE_ROAD_BUFFER_M = 0.25;
const SKYLINE_BUILDING_BUFFER_M = 0.5;
const SKYLINE_SUPPORT_WATER_RADIUS_M = 0.5;
const SKYLINE_MIN_MUTUAL_SPACING_M = 50;
const SKYLINE_GAP_SEARCH_STEP_M = 5;
const SKYLINE_GAP_SEARCH_FRACTION = 0.48;
const SKYLINE_EXTRA_SETBACKS_M = [0, 0.75, 1.5, 2.25] as const;
// 55 degrees is the original, strongly driver-facing stance. Later entries
// are fallbacks only; the current Cairo layout finds a real gap for every
// board at the first angle.
const SKYLINE_APPROACH_CANTS_DEG = [55, 58, 61, 64, 67] as const;
const CAIRO_AD_PLACEMENT_CACHE = new WeakMap<
  BuildingLayoutPlan,
  readonly CairoAdPlacement[]
>();

function orientedFootprint(
  center: GameCanvasPoint,
  widthM: number,
  depthM: number,
  yawRad: number,
  bufferM = 0,
): OrientedFootprint {
  return {
    center,
    axisU: { x: Math.cos(yawRad), z: -Math.sin(yawRad) },
    axisV: { x: Math.sin(yawRad), z: Math.cos(yawRad) },
    halfU: widthM / 2 + bufferM,
    halfV: depthM / 2 + bufferM,
  };
}

function structuralFootprint(
  solid: StructuralObb,
  bufferM: number,
): OrientedFootprint {
  return {
    center: { x: solid.x, z: solid.z },
    axisU: { x: solid.ux, z: solid.uz },
    axisV: { x: -solid.uz, z: solid.ux },
    halfU: solid.halfU + bufferM,
    halfV: solid.halfV + bufferM,
  };
}

function footprintsOverlap(
  first: OrientedFootprint,
  second: OrientedFootprint,
): boolean {
  const offset = {
    x: second.center.x - first.center.x,
    z: second.center.z - first.center.z,
  };
  const dot = (left: GameCanvasPoint, right: GameCanvasPoint): number =>
    left.x * right.x + left.z * right.z;
  return [first.axisU, first.axisV, second.axisU, second.axisV].every(
    (axis) => {
      const separationM = Math.abs(dot(offset, axis));
      const firstRadiusM =
        first.halfU * Math.abs(dot(first.axisU, axis)) +
        first.halfV * Math.abs(dot(first.axisV, axis));
      const secondRadiusM =
        second.halfU * Math.abs(dot(second.axisU, axis)) +
        second.halfV * Math.abs(dot(second.axisV, axis));
      return separationM <= firstRadiusM + secondRadiusM;
    },
  );
}

function roadFootprints(mapPack: GameCanvasMapPack): OrientedFootprint[] {
  return (mapPack.geometry.roadSurfaces ?? []).flatMap((road) =>
    road.centerline.slice(1).flatMap((end, index) => {
      const start = road.centerline[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthM = Math.hypot(dx, dz);
      if (lengthM < 0.01) return [];
      return [
        {
          center: {
            x: (start.x + end.x) / 2,
            z: (start.z + end.z) / 2,
          },
          axisU: { x: dx / lengthM, z: dz / lengthM },
          axisV: { x: -dz / lengthM, z: dx / lengthM },
          halfU: lengthM / 2 + SKYLINE_ROAD_BUFFER_M,
          halfV: road.widthM / 2 + SKYLINE_ROAD_BUFFER_M,
        },
      ];
    }),
  );
}

function pointIsInsidePolygon(
  point: GameCanvasPoint,
  polygon: readonly GameCanvasPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const left = polygon[index];
    const right = polygon[previous];
    if (
      (left.z > point.z) !== (right.z > point.z) &&
      point.x <
        ((right.x - left.x) * (point.z - left.z)) /
          (right.z - left.z) +
          left.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function supportIsOverWater(
  mapPack: GameCanvasMapPack,
  position: GameCanvasPoint,
): boolean {
  const probes = [
    position,
    ...Array.from({ length: 8 }, (_, index) => ({
      x:
        position.x +
        Math.cos((index * Math.PI) / 4) * SKYLINE_SUPPORT_WATER_RADIUS_M,
      z:
        position.z +
        Math.sin((index * Math.PI) / 4) * SKYLINE_SUPPORT_WATER_RADIUS_M,
    })),
  ];
  return probes.some((probe) =>
    (mapPack.geometry.waterBodies ?? []).some((water) =>
      pointIsInsidePolygon(probe, water.polygon),
    ),
  );
}

function billboardInstallationFootprint(
  position: GameCanvasPoint,
  widthM: number,
  headingRad: number,
  bufferM = 0,
): OrientedFootprint {
  return orientedFootprint(
    position,
    widthM + SKYLINE_FRAME_WIDTH_TRIM_M,
    SKYLINE_INSTALLATION_DEPTH_M,
    headingRad,
    bufferM,
  );
}

function gapSearchOffsets(spacingM: number): readonly number[] {
  const offsets = [0];
  const limitM = Math.min(110, spacingM * SKYLINE_GAP_SEARCH_FRACTION);
  for (
    let offsetM = SKYLINE_GAP_SEARCH_STEP_M;
    offsetM <= limitM;
    offsetM += SKYLINE_GAP_SEARCH_STEP_M
  ) {
    offsets.push(offsetM, -offsetM);
  }
  return offsets;
}

function poleBannerPlacements(mapPack: GameCanvasMapPack): CairoAdPlacement[] {
  const roads = new Map(
    (mapPack.geometry.roadSurfaces ?? []).map((road) => [road.id, road]),
  );
  const placements: CairoAdPlacement[] = [];
  for (const rule of POLE_CAMPAIGNS) {
    const road = roads.get(rule.roadId);
    if (!road) continue;
    const lengthM = roadLength(road);
    let stationIndex = 0;
    for (
      let distanceM = rule.startM;
      distanceM <= lengthM - rule.endPadM;
      distanceM += rule.spacingM
    ) {
      const sample = sampleRoad(road, distanceM);
      if (!sample) continue;
      const stationSide = (stationIndex % 2 === 0
        ? rule.firstSide
        : -rule.firstSide) as 1 | -1;
      const sides: readonly (1 | -1)[] = rule.bothSides
        ? [stationSide, (-stationSide) as 1 | -1]
        : [stationSide];
      const normalX = Math.cos(sample.headingRad);
      const normalZ = -Math.sin(sample.headingRad);
      const sidewalkWidthM = road.sidewalkWidthM ?? 2.6;
      const lateralM =
        road.widthM / 2 + Math.max(1.35, sidewalkWidthM * 0.64);
      const creativeIndex =
        (rule.creativeStart + Math.floor(stationIndex / 4)) %
        CAIRO_AD_CREATIVES.length;
      for (const side of sides) {
        const position = {
          x: sample.x + normalX * lateralM * side,
          z: sample.z + normalZ * lateralM * side,
          elevationM: sample.elevationM,
        };
        // This is the missing safety invariant from the first pass: a kerb
        // position on one road can be the centre of a crossing road. Reject
        // the whole foreign pavement envelope (plus the panel's longitudinal
        // reach), and keep the rail reservation clear as well.
        if (!pointIsClearOfCrossings(mapPack, position, road.id, 2.2)) {
          continue;
        }
        placements.push({
          id: `cairo-ad-pole-banner-${rule.roadId}-${stationIndex}-${side > 0 ? "r" : "l"}`,
          kind: "pole-banner",
          sourceRoadId: rule.roadId,
          position,
          // Pole cards face traffic head-on; their double-sided copy remains
          // legible to both travel directions.
          headingRad: sample.headingRad,
          creativeIndex,
          widthM: 1.75,
          heightM: 2.65,
          panelCenterYM: 5.05,
        });
      }
      stationIndex += 1;
    }
  }
  return placements;
}

function skylineBillboardPlacements(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): CairoAdPlacement[] {
  const roads = new Map(
    (mapPack.geometry.roadSurfaces ?? []).map((road) => [road.id, road]),
  );
  const roadsReserved = roadFootprints(mapPack);
  const buildingsReserved = buildingLayout.buildings.flatMap((building) => {
    // Asset solids describe collision-bearing ground contact. Cairo balconies
    // and upper floors can project farther, so billboard sightline planning
    // uses the catalogue's full measured visual rectangle instead. Procedural
    // boxes have no separate overhang model and use their exact planned solid.
    if (building.source === "asset-slot") {
      const config = buildingPlacementConfig(building.modelId);
      if (config) {
        return [
          orientedFootprint(
            { x: building.x, z: building.z },
            config.footprintM,
            config.depthM ?? config.footprintM,
            building.yaw,
            SKYLINE_BUILDING_BUFFER_M,
          ),
        ];
      }
    }
    return building.solids.map((solid) =>
      structuralFootprint(solid, SKYLINE_BUILDING_BUFFER_M),
    );
  });
  const keepOuts = roadsidePropKeepOuts(mapPack);
  const groundReserved = [
    ...keepOuts.hardRects,
    ...keepOuts.roadCrossedRects,
  ].map((rect) =>
    orientedFootprint(
      rect.center,
      rect.size.x,
      rect.size.z,
      ((rect.headingDeg ?? 0) * Math.PI) / 180,
      SKYLINE_BUILDING_BUFFER_M,
    ),
  );
  const accepted: SkylineCandidate[] = [];
  const placements: CairoAdPlacement[] = [];

  for (const rule of SKYLINE_CAMPAIGNS) {
    const road = roads.get(rule.roadId);
    if (!road) continue;
    const lengthM = roadLength(road);
    let stationIndex = 0;
    for (
      let nominalDistanceM = rule.startM;
      nominalDistanceM <= lengthM - rule.endPadM;
      nominalDistanceM += rule.spacingM
    ) {
      const preferredSide = (stationIndex % 2 === 0
        ? rule.firstSide
        : -rule.firstSide) as 1 | -1;
      const sides: readonly (1 | -1)[] = [
        preferredSide,
        (-preferredSide) as 1 | -1,
      ];
      const wide = stationIndex % 3 === 0;
      const widthM = wide ? 18 : 14;
      let chosen: SkylineCandidate | undefined;

      // Preserve the original readable 55-degree stance first, searching in
      // five-metre steps around the nominal station until an actual opening in
      // the rendered street wall is found. Only after exhausting that entire
      // local search do the slightly shallower fallback angles run.
      candidateSearch: for (const cantDeg of SKYLINE_APPROACH_CANTS_DEG) {
        const cantRad = (cantDeg * Math.PI) / 180;
        const frameHalfNormalM =
          ((widthM + SKYLINE_FRAME_WIDTH_TRIM_M) / 2) *
            Math.abs(Math.cos(cantRad)) +
          (SKYLINE_INSTALLATION_DEPTH_M / 2) * Math.abs(Math.sin(cantRad));
        for (const offsetM of gapSearchOffsets(rule.spacingM)) {
          const distanceM = nominalDistanceM + offsetM;
          if (distanceM < 28 || distanceM > lengthM - 28) continue;
          const sample = sampleRoad(road, distanceM);
          if (!sample) continue;
          const normalX = Math.cos(sample.headingRad);
          const normalZ = -Math.sin(sample.headingRad);
          for (const side of sides) {
            for (const extraSetbackM of SKYLINE_EXTRA_SETBACKS_M) {
              // The inner frame edge gets half a metre beyond the kerb before
              // the complete OBB audit runs. This is why restoring the old
              // cant does not put the sign back above moving traffic.
              const lateralM =
                road.widthM / 2 +
                0.5 +
                frameHalfNormalM +
                extraSetbackM;
              const position = {
                x: sample.x + normalX * lateralM * side,
                z: sample.z + normalZ * lateralM * side,
                elevationM: sample.elevationM,
              };
              const headingRad = sample.headingRad + side * cantRad;
              const footprint = billboardInstallationFootprint(
                position,
                widthM,
                headingRad,
              );
              if (
                roadsReserved.some((reserved) =>
                  footprintsOverlap(footprint, reserved),
                ) ||
                buildingsReserved.some((reserved) =>
                  footprintsOverlap(footprint, reserved),
                ) ||
                groundReserved.some((reserved) =>
                  footprintsOverlap(footprint, reserved),
                ) ||
                supportIsOverWater(mapPack, position) ||
                accepted.some(
                  (other) =>
                    (other.sourceRoadId === road.id &&
                      Math.hypot(
                        position.x - other.position.x,
                        position.z - other.position.z,
                      ) < SKYLINE_MIN_MUTUAL_SPACING_M) ||
                    footprintsOverlap(
                      billboardInstallationFootprint(
                        position,
                        widthM,
                        headingRad,
                        0.7,
                      ),
                      other.footprint,
                    ),
                )
              ) {
                continue;
              }
              chosen = {
                sourceRoadId: road.id,
                position,
                headingRad,
                side,
                footprint,
              };
              break candidateSearch;
            }
          }
        }
      }

      if (!chosen) {
        throw new Error(
          `No safe skyline-billboard gap for ${rule.roadId} station ${stationIndex}`,
        );
      }
      accepted.push(chosen);
      placements.push({
        id: `cairo-ad-skyline-billboard-${rule.roadId}-${stationIndex}-${chosen.side > 0 ? "r" : "l"}`,
        kind: "skyline-billboard",
        sourceRoadId: rule.roadId,
        position: chosen.position,
        headingRad: chosen.headingRad,
        creativeIndex:
          (rule.creativeStart + stationIndex) % CAIRO_AD_CREATIVES.length,
        widthM,
        heightM: wide ? 4.8 : 3.8,
        panelCenterYM: wide ? 14.6 : 12.8,
      });
      stationIndex += 1;
    }
  }
  return placements;
}

function bridgeGantryPlacements(mapPack: GameCanvasMapPack): CairoAdPlacement[] {
  const roads = new Map(
    (mapPack.geometry.roadSurfaces ?? []).map((road) => [road.id, road]),
  );
  const placements: CairoAdPlacement[] = [];
  for (const rule of BRIDGE_GANTRY_CAMPAIGNS) {
    const road = roads.get(rule.roadId);
    if (!road) continue;
    const lengthM = roadLength(road);
    let index = 0;
    for (
      let distanceM = rule.startM;
      distanceM <= lengthM - rule.endPadM;
      distanceM += rule.spacingM
    ) {
      const sample = sampleRoad(road, distanceM);
      if (!sample) continue;
      placements.push({
        id: `cairo-ad-bridge-gantry-${rule.roadId}-${index}`,
        kind: "bridge-gantry",
        sourceRoadId: rule.roadId,
        position: sample,
        // The panel spans the road and faces both streams of traffic.
        headingRad: sample.headingRad,
        creativeIndex: (rule.creativeStart + index) % CAIRO_AD_CREATIVES.length,
        widthM: road.widthM + 4.8,
        heightM: 4.6,
        panelCenterYM: 9.15,
        supportOffsetM: road.widthM / 2 + (road.parapetDepthM ?? 0) + 0.9,
      });
      index += 1;
    }
  }
  return placements;
}

/** All authored commercial-sign placements for the Cairo map. */
export function cairoAdPlacements(
  mapPack: GameCanvasMapPack,
  buildingLayout?: BuildingLayoutPlan,
): readonly CairoAdPlacement[] {
  if (mapPack.id !== "cairo-central-nile") return [];
  if (!buildingLayout || buildingLayout.mapId !== mapPack.id) {
    throw new Error(
      `Cairo advertising requires the exact ${mapPack.id} building layout`,
    );
  }
  const cached = CAIRO_AD_PLACEMENT_CACHE.get(buildingLayout);
  if (cached) return cached;
  const placements = [
    ...poleBannerPlacements(mapPack),
    ...skylineBillboardPlacements(mapPack, buildingLayout),
    ...bridgeGantryPlacements(mapPack),
  ];
  CAIRO_AD_PLACEMENT_CACHE.set(buildingLayout, placements);
  return placements;
}
