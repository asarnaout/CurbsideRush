import type { BuildingLayoutPlan, StructuralObb } from "./geometry/buildingLayout";
import type { GameCanvasMapPack, GameCanvasPoint } from "./sessionContract";

/**
 * Tokyo's advertising is facade architecture: narrow stacked tenant kanban
 * and a smaller tier of broad campaign screens. It deliberately does not
 * reuse Cairo's pole-banner, freestanding-pedestal or bridge-gantry language.
 * The generated art contains no lettering; every auditable line below is
 * composited by the renderer with the bundled Japanese canvas font.
 */

export type TokyoAdAtlasId = "portrait" | "landscape";

export interface TokyoAdCreative {
  readonly id: string;
  readonly headline: string;
  readonly subline: string;
  readonly language: "ja" | "bilingual";
  readonly artAtlas: TokyoAdAtlasId;
  readonly artIndex: number;
  readonly accent: string;
}

export const TOKYO_AD_CREATIVES: readonly TokyoAdCreative[] = [
  { id: "city-in-motion", headline: "街を、着こなそう", subline: "今日の色で走り出す", language: "ja", artAtlas: "portrait", artIndex: 0, accent: "#ff4c3f" },
  { id: "hello-tomorrow", headline: "あしたに会いにいこう", subline: "やさしい相棒と毎日を", language: "ja", artAtlas: "portrait", artIndex: 1, accent: "#45d9dc" },
  { id: "noodle-rush", headline: "湯気までごちそう", subline: "できたてを今すぐ", language: "ja", artAtlas: "portrait", artIndex: 2, accent: "#ef3d32" },
  { id: "clear-morning", headline: "透明な朝へ", subline: "ひかりをまとう一日", language: "ja", artAtlas: "portrait", artIndex: 3, accent: "#ef8dc5" },
  { id: "sound-up", headline: "音を上げよう", subline: "街がステージになる", language: "ja", artAtlas: "portrait", artIndex: 4, accent: "#597cff" },
  { id: "blue-dream", headline: "青い夢の中へ", subline: "きらめく海の時間", language: "ja", artAtlas: "portrait", artIndex: 5, accent: "#4ce8ff" },
  { id: "run-light", headline: "光より軽く", subline: "次の角まで駆けよう", language: "ja", artAtlas: "portrait", artIndex: 6, accent: "#ff6554" },
  { id: "happy-paws", headline: "しっぽのある毎日", subline: "いっしょならもっと楽しい", language: "ja", artAtlas: "portrait", artIndex: 7, accent: "#ffd53f" },
  { id: "sweet-color", headline: "色までおいしい", subline: "ひとさじのごほうび", language: "ja", artAtlas: "portrait", artIndex: 8, accent: "#f06a9f" },
  { id: "window-journey", headline: "窓の向こうへ", subline: "景色が旅を連れてくる", language: "ja", artAtlas: "portrait", artIndex: 9, accent: "#4e9fff" },
  { id: "turn-the-page", headline: "次のページへ", subline: "物語と出会う場所", language: "ja", artAtlas: "portrait", artIndex: 10, accent: "#ffb942" },
  { id: "make-a-mark", headline: "ひらめきを描こう", subline: "色も形も思いのまま", language: "ja", artAtlas: "portrait", artIndex: 11, accent: "#ff5d48" },
  { id: "season-in-bloom", headline: "季節を飾ろう", subline: "今日の花をひとつ", language: "ja", artAtlas: "portrait", artIndex: 12, accent: "#f45c92" },
  { id: "catch-the-city", headline: "街の一瞬を", subline: "いつもの景色を特別に", language: "ja", artAtlas: "portrait", artIndex: 13, accent: "#f1584a" },
  { id: "quiet-green", headline: "緑のひと休み", subline: "深く、すっきり整う", language: "ja", artAtlas: "portrait", artIndex: 14, accent: "#65c976" },
  { id: "ride-light", headline: "風と走ろう", subline: "毎日の道を軽やかに", language: "ja", artAtlas: "portrait", artIndex: 15, accent: "#2fc9bd" },
  { id: "play-next-story", headline: "次の物語へ", subline: "遊びはもっと自由になる", language: "ja", artAtlas: "portrait", artIndex: 16, accent: "#9ae942" },
  { id: "new-horizon", headline: "まだ見ぬ空へ", subline: "新しい景色が待っている", language: "ja", artAtlas: "portrait", artIndex: 17, accent: "#ff563f" },
  { id: "coffee-break", headline: "ひと息つこう", subline: "会話がほどける時間", language: "ja", artAtlas: "portrait", artIndex: 18, accent: "#f49b54" },
  { id: "city-color", headline: "街に色を着よう", subline: "CITY COLOR / 自分らしい一日へ", language: "bilingual", artAtlas: "portrait", artIndex: 19, accent: "#ff4e45" },
  { id: "meet-in-color", headline: "笑顔で会おう", subline: "MEET IN COLOR / 今日は街で", language: "bilingual", artAtlas: "landscape", artIndex: 0, accent: "#ff6d4d" },
  { id: "mascot-parade", headline: "みんなで行こう", subline: "楽しい街へ出発", language: "ja", artAtlas: "landscape", artIndex: 1, accent: "#ffcf3f" },
  { id: "beauty-in-bloom", headline: "光をまとおう", subline: "新しい朝のきらめき", language: "ja", artAtlas: "landscape", artIndex: 2, accent: "#ed6ea8" },
  { id: "night-train", headline: "夜の向こうへ", subline: "窓辺から始まる旅", language: "ja", artAtlas: "landscape", artIndex: 3, accent: "#5abfff" },
  { id: "table-of-color", headline: "おいしいが勢ぞろい", subline: "みんなで囲むしあわせ", language: "ja", artAtlas: "landscape", artIndex: 4, accent: "#ff604a" },
  { id: "light-in-motion", headline: "光の波へ", subline: "LIGHT IN MOTION / まだ見ぬ夜へ", language: "bilingual", artAtlas: "landscape", artIndex: 5, accent: "#56f0ff" },
  { id: "room-to-play", headline: "暮らしに遊びを", subline: "毎日をもっとカラフルに", language: "ja", artAtlas: "landscape", artIndex: 6, accent: "#ff8c61" },
  { id: "summer-sky", headline: "夏空を見上げよう", subline: "きらめく夜をみんなで", language: "ja", artAtlas: "landscape", artIndex: 7, accent: "#ffd752" },
];

const TOKYO_AD_ATLAS_SPECS = {
  portrait: { widthPx: 1536, heightPx: 2880, columns: 4, rows: 5 },
  landscape: { widthPx: 3072, heightPx: 864, columns: 4, rows: 2 },
} as const satisfies Record<
  TokyoAdAtlasId,
  { readonly widthPx: number; readonly heightPx: number; readonly columns: number; readonly rows: number }
>;

const ATLAS_INSET_PX = 2;

export interface TokyoAdAtlasUv {
  readonly uOffset: number;
  readonly uScale: number;
  readonly vOffset: number;
  readonly vScale: number;
}

/** UV crop for a regular, mechanically-built atlas loaded with invertY=true. */
export function tokyoAdAtlasUv(
  artIndex: number,
  atlasId: TokyoAdAtlasId,
): TokyoAdAtlasUv {
  const atlas = TOKYO_AD_ATLAS_SPECS[atlasId];
  const cellWidthPx = atlas.widthPx / atlas.columns;
  const cellHeightPx = atlas.heightPx / atlas.rows;
  const column = artIndex % atlas.columns;
  const row = Math.floor(artIndex / atlas.columns);
  const leftPx = column * cellWidthPx + ATLAS_INSET_PX;
  const rightPx = (column + 1) * cellWidthPx - ATLAS_INSET_PX;
  const topPx = row * cellHeightPx + ATLAS_INSET_PX;
  const bottomPx = (row + 1) * cellHeightPx - ATLAS_INSET_PX;
  return {
    uOffset: leftPx / atlas.widthPx,
    uScale: (rightPx - leftPx) / atlas.widthPx,
    vOffset: 1 - bottomPx / atlas.heightPx,
    vScale: (bottomPx - topPx) / atlas.heightPx,
  };
}

export type TokyoAdPlacementKind =
  | "facade-poster"
  | "facade-screen"
  | "rooftop-screen";

export interface TokyoAdPlacement {
  readonly id: string;
  readonly kind: TokyoAdPlacementKind;
  readonly creativeIndex: number;
  readonly position: GameCanvasPoint;
  readonly headingDeg: number;
  readonly centerYM: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly buildingId: string;
  readonly roadId: string;
  readonly roadStationM: number;
  readonly roadDistanceM: number;
  readonly distribution: TokyoAdvertisingDensity;
}

export interface TokyoTenantCreative {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly background: string;
  readonly foreground: string;
  readonly accent: string;
}

/**
 * Fictional typography-led tenants. These are deliberately ordinary shops,
 * services and family entertainment rather than a second product-campaign
 * list: Tokyo's street texture comes from directory ladders and projecting
 * lightboxes at least as much as it does from hero media screens.
 */
export const TOKYO_TENANT_CREATIVES: readonly TokyoTenantCreative[] = [
  { id: "hoshi-market", name: "星マート", detail: "24時間営業", background: "#fff7db", foreground: "#ec2f3c", accent: "#176bd1" },
  { id: "menya-sakura", name: "麺屋さくら", detail: "あつあつの一杯", background: "#f13b28", foreground: "#fff7e8", accent: "#ffd34d" },
  { id: "ichiban-ramen", name: "一番ラーメン", detail: "自家製麺", background: "#ffd635", foreground: "#17203b", accent: "#e4382c" },
  { id: "tsukikage-diner", name: "月影食堂", detail: "焼きもの・小皿", background: "#17203b", foreground: "#fff7e8", accent: "#f24f3d" },
  { id: "torigen", name: "鳥源", detail: "炭火焼・1F", background: "#fff8e7", foreground: "#202020", accent: "#e83c31" },
  { id: "kotobuki-sushi", name: "鮨ことぶき", detail: "旬の魚・3F", background: "#165f55", foreground: "#fff9dd", accent: "#f4be45" },
  { id: "sakura-curry", name: "カレーさくら", detail: "じっくり煮込み", background: "#f39a24", foreground: "#241718", accent: "#fff0bc" },
  { id: "hikari-cafe", name: "喫茶ひかり", detail: "珈琲とケーキ", background: "#f7ead1", foreground: "#613c2e", accent: "#1b8a86" },
  { id: "nakamise-bento", name: "中見世弁当", detail: "毎日できたて", background: "#ef493f", foreground: "#ffffff", accent: "#ffd94d" },
  { id: "koban-taiyaki", name: "たい焼き小判", detail: "焼きたて", background: "#ffc940", foreground: "#5a281c", accent: "#ef4f37" },
  { id: "tempura-yokocho", name: "天ぷら横丁", detail: "揚げたて", background: "#f7f1df", foreground: "#17385b", accent: "#d93634" },
  { id: "yokocho-greengrocer", name: "横丁青果", detail: "野菜とくだもの", background: "#2c9b5d", foreground: "#fffceb", accent: "#ffd53f" },
  { id: "tsukimi-noodles", name: "月見ラーメン", detail: "夜も営業", background: "#243579", foreground: "#fff7d7", accent: "#f44e68" },
  { id: "yoimachi-kitchen", name: "よいまち台所", detail: "食事と飲みもの", background: "#e53b31", foreground: "#ffffff", accent: "#ffd650" },
  { id: "hinata-dining", name: "ひなた食堂", detail: "定食・丼もの", background: "#fff1cb", foreground: "#df3f32", accent: "#3a8f68" },
  { id: "sakuramachi-bakery", name: "桜町ベーカリー", detail: "毎朝焼きたて", background: "#f5c977", foreground: "#5d352e", accent: "#ee6e55" },
  { id: "nijimado-stationery", name: "虹窓文具", detail: "文具・画材・3F", background: "#2d70cf", foreground: "#ffffff", accent: "#ffd943" },
  { id: "amaoto-books", name: "雨音書房", detail: "本と雑誌・4F", background: "#153f5b", foreground: "#f8efd6", accent: "#74d5db" },
  { id: "furin-photo", name: "風鈴写真室", detail: "写真・プリント", background: "#f7f4ea", foreground: "#26293d", accent: "#f05278" },
  { id: "tsukifune-records", name: "月舟レコード", detail: "音楽・中古盤", background: "#201b37", foreground: "#fff3e0", accent: "#f04fb1" },
  { id: "hoshimichi-games", name: "星路ゲーム館", detail: "24時まで・5F", background: "#7038bd", foreground: "#ffffff", accent: "#9df04c" },
  { id: "hibari-cinema", name: "雲雀シネマ", detail: "本日上映・6F", background: "#e43d3d", foreground: "#fff6d8", accent: "#29254f" },
  { id: "yozora-glasses", name: "夜空眼鏡", detail: "メガネ・レンズ", background: "#0c8aa2", foreground: "#ffffff", accent: "#f6df4e" },
  { id: "suzukaze-salon", name: "すず風美容室", detail: "カット・カラー", background: "#f3b7d8", foreground: "#432b4f", accent: "#ffffff" },
] as const;

export type TokyoTenantPlacementKind =
  | "blade-kanban"
  | "tenant-directory"
  | "storefront-fascia";

export interface TokyoTenantPlacement {
  readonly id: string;
  readonly kind: TokyoTenantPlacementKind;
  readonly tenantIndex: number;
  readonly directoryVariant: number;
  readonly position: GameCanvasPoint;
  readonly headingDeg: number;
  readonly centerYM: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly buildingId: string;
  readonly roadId: string;
  readonly roadStationM: number;
  readonly distribution: TokyoAdvertisingDensity;
}

export type TokyoAdvertisingDensity = "core" | "corridor" | "satellite";

export interface TokyoAdvertisingPlan {
  readonly campaigns: readonly TokyoAdPlacement[];
  readonly tenantSigns: readonly TokyoTenantPlacement[];
}

interface FacadeCandidate {
  readonly faceCenter: GameCanvasPoint;
  readonly normal: GameCanvasPoint;
  readonly roadPoint: GameCanvasPoint;
  readonly roadTangent: GameCanvasPoint;
  readonly roadStationM: number;
  readonly faceWidthM: number;
  readonly buildingId: string;
  readonly buildingHeightM: number;
  readonly roadId: string;
  readonly roadDistanceM: number;
  readonly roadWidthM: number;
  /** Imported homes/apartments keep only Tokyo's narrow projecting kanban. */
  readonly residentialStyle: boolean;
  /** Hero campaign art is reserved for generic procedural commercial boxes. */
  readonly campaignEligible: boolean;
}

type RoadSurface = NonNullable<
  GameCanvasMapPack["geometry"]["roadSurfaces"]
>[number];

interface IndexedRoadSurface {
  readonly road: RoadSurface;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

interface IndexedSolid {
  readonly buildingId: string;
  readonly solid: StructuralObb;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const MAX_ROAD_DISTANCE_M = 22;
const SOLID_GRID_CELL_M = 32;
const DOWNTOWN_CENTER = { x: 440, z: 140 } as const;
const DOWNTOWN_RADIUS_M = 480;
const SPAWN_DISTRICT_CENTER = { x: -72, z: -72 } as const;
const SPAWN_DISTRICT_RADIUS_M = 330;
const PORTRAIT_CREATIVE_COUNT = 20;
const LANDSCAPE_CREATIVE_START = 20;
const LANDSCAPE_CREATIVE_COUNT = 8;

const TOKYO_RESIDENTIAL_BUILDING_SETS = new Set([
  "tokyo-house",
  "tokyo-apato",
  "tokyo-manshon",
]);
const TOKYO_RESIDENTIAL_MODEL = /^tokyo-(?:house|apato|walkup)-/;

const COMMERCIAL_CORRIDOR =
  /(?:chuo|eki-mae|ekimae|shotengai|nakamise|ichiban|niban|koshu|kanpachi|nishi-kanjo|sangen|minami-kaido|kawagishi|higashi-hondori|miyanosaka|setagaya|kawate)/;

function distanceSquared(a: GameCanvasPoint, b: GameCanvasPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function faceOptions(solid: StructuralObb): readonly {
  readonly center: GameCanvasPoint;
  readonly normal: GameCanvasPoint;
  readonly widthM: number;
}[] {
  const u = { x: solid.ux, z: solid.uz };
  const v = { x: solid.uz, z: -solid.ux };
  return [
    { center: { x: solid.x + u.x * solid.halfU, z: solid.z + u.z * solid.halfU }, normal: u, widthM: solid.halfV * 2 },
    { center: { x: solid.x - u.x * solid.halfU, z: solid.z - u.z * solid.halfU }, normal: { x: -u.x, z: -u.z }, widthM: solid.halfV * 2 },
    { center: { x: solid.x + v.x * solid.halfV, z: solid.z + v.z * solid.halfV }, normal: v, widthM: solid.halfU * 2 },
    { center: { x: solid.x - v.x * solid.halfV, z: solid.z - v.z * solid.halfV }, normal: { x: -v.x, z: -v.z }, widthM: solid.halfU * 2 },
  ];
}

function projectOntoRoad(
  point: GameCanvasPoint,
  road: RoadSurface,
): {
  readonly point: GameCanvasPoint;
  readonly tangent: GameCanvasPoint;
  readonly stationM: number;
  readonly distanceM: number;
} | undefined {
  let best:
    | {
        point: GameCanvasPoint;
        tangent: GameCanvasPoint;
        stationM: number;
        distanceM: number;
      }
    | undefined;
  let stationM = 0;
  for (let index = 1; index < road.centerline.length; index += 1) {
    const a = road.centerline[index - 1];
    const b = road.centerline[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM <= 1e-6) continue;
    const amount = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (lengthM * lengthM)),
    );
    const projected = { x: a.x + dx * amount, z: a.z + dz * amount };
    const distanceM = Math.hypot(point.x - projected.x, point.z - projected.z);
    if (!best || distanceM < best.distanceM) {
      best = {
        point: projected,
        tangent: { x: dx / lengthM, z: dz / lengthM },
        stationM: stationM + lengthM * amount,
        distanceM,
      };
    }
    stationM += lengthM;
  }
  return best;
}

function solidAabb(buildingId: string, solid: StructuralObb): IndexedSolid {
  const vx = solid.uz;
  const vz = -solid.ux;
  const extentX = Math.abs(solid.ux) * solid.halfU + Math.abs(vx) * solid.halfV;
  const extentZ = Math.abs(solid.uz) * solid.halfU + Math.abs(vz) * solid.halfV;
  return {
    buildingId,
    solid,
    minX: solid.x - extentX,
    maxX: solid.x + extentX,
    minZ: solid.z - extentZ,
    maxZ: solid.z + extentZ,
  };
}

function solidGridKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

function buildSolidGrid(
  buildingLayout: BuildingLayoutPlan,
): ReadonlyMap<string, readonly IndexedSolid[]> {
  const mutable = new Map<string, IndexedSolid[]>();
  for (const building of buildingLayout.buildings) {
    for (const solid of building.solids) {
      const indexed = solidAabb(building.id, solid);
      const minCellX = Math.floor(indexed.minX / SOLID_GRID_CELL_M);
      const maxCellX = Math.floor(indexed.maxX / SOLID_GRID_CELL_M);
      const minCellZ = Math.floor(indexed.minZ / SOLID_GRID_CELL_M);
      const maxCellZ = Math.floor(indexed.maxZ / SOLID_GRID_CELL_M);
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
          const key = solidGridKey(cellX, cellZ);
          const bucket = mutable.get(key) ?? [];
          bucket.push(indexed);
          mutable.set(key, bucket);
        }
      }
    }
  }
  return mutable;
}

function segmentHitsSolid(
  start: GameCanvasPoint,
  end: GameCanvasPoint,
  solid: StructuralObb,
): boolean {
  const vx = solid.uz;
  const vz = -solid.ux;
  const local = (point: GameCanvasPoint) => {
    const dx = point.x - solid.x;
    const dz = point.z - solid.z;
    return {
      u: dx * solid.ux + dz * solid.uz,
      v: dx * vx + dz * vz,
    };
  };
  const a = local(start);
  const b = local(end);
  const du = b.u - a.u;
  const dv = b.v - a.v;
  let minimum = 0;
  let maximum = 1;
  for (const [origin, delta, half] of [
    [a.u, du, solid.halfU],
    [a.v, dv, solid.halfV],
  ] as const) {
    if (Math.abs(delta) < 1e-8) {
      if (origin < -half || origin > half) return false;
      continue;
    }
    const t0 = (-half - origin) / delta;
    const t1 = (half - origin) / delta;
    minimum = Math.max(minimum, Math.min(t0, t1));
    maximum = Math.min(maximum, Math.max(t0, t1));
    if (minimum > maximum) return false;
  }
  return maximum > 0.02 && minimum < 0.98;
}

function facadeLineIsClear(
  candidate: FacadeCandidate,
  solidGrid: ReadonlyMap<string, readonly IndexedSolid[]>,
): boolean {
  const minX = Math.min(candidate.roadPoint.x, candidate.faceCenter.x);
  const maxX = Math.max(candidate.roadPoint.x, candidate.faceCenter.x);
  const minZ = Math.min(candidate.roadPoint.z, candidate.faceCenter.z);
  const maxZ = Math.max(candidate.roadPoint.z, candidate.faceCenter.z);
  const seen = new Set<IndexedSolid>();
  for (
    let cellX = Math.floor(minX / SOLID_GRID_CELL_M);
    cellX <= Math.floor(maxX / SOLID_GRID_CELL_M);
    cellX += 1
  ) {
    for (
      let cellZ = Math.floor(minZ / SOLID_GRID_CELL_M);
      cellZ <= Math.floor(maxZ / SOLID_GRID_CELL_M);
      cellZ += 1
    ) {
      for (const indexed of solidGrid.get(solidGridKey(cellX, cellZ)) ?? []) {
        if (seen.has(indexed) || indexed.buildingId === candidate.buildingId) continue;
        seen.add(indexed);
        if (
          indexed.maxX < minX ||
          indexed.minX > maxX ||
          indexed.maxZ < minZ ||
          indexed.minZ > maxZ
        ) {
          continue;
        }
        if (segmentHitsSolid(candidate.roadPoint, candidate.faceCenter, indexed.solid)) {
          return false;
        }
      }
    }
  }
  return true;
}

function roadFacingCandidates(
  indexedRoads: readonly IndexedRoadSurface[],
  building: BuildingLayoutPlan["buildings"][number],
  solidGrid: ReadonlyMap<string, readonly IndexedSolid[]>,
  residentialStyle: boolean,
): readonly FacadeCandidate[] {
  const options: (FacadeCandidate & { readonly score: number })[] = [];
  for (const solid of building.solids) {
    for (const face of faceOptions(solid)) {
      for (const indexed of indexedRoads) {
        if (
          face.center.x < indexed.minX - MAX_ROAD_DISTANCE_M ||
          face.center.x > indexed.maxX + MAX_ROAD_DISTANCE_M ||
          face.center.z < indexed.minZ - MAX_ROAD_DISTANCE_M ||
          face.center.z > indexed.maxZ + MAX_ROAD_DISTANCE_M
        ) {
          continue;
        }
        const road = indexed.road;
        const projection = projectOntoRoad(face.center, road);
        if (!projection) continue;
        const dx = projection.point.x - face.center.x;
        const dz = projection.point.z - face.center.z;
        const distanceM = projection.distanceM;
        if (distanceM <= 0.01 || distanceM > MAX_ROAD_DISTANCE_M) continue;
        const alignment = (dx * face.normal.x + dz * face.normal.z) / distanceM;
        if (alignment < 0.72) continue;
        const roadEdgeClearanceM = distanceM - road.widthM / 2;
        if (roadEdgeClearanceM < 0.2) continue;
        const score = distanceM + (1 - alignment) * 10;
        options.push({
          faceCenter: face.center,
          normal: face.normal,
          roadPoint: projection.point,
          roadTangent: projection.tangent,
          roadStationM: projection.stationM,
          faceWidthM: face.widthM,
          buildingId: building.id,
          buildingHeightM: building.heightM,
          roadId: road.id,
          roadDistanceM: distanceM,
          roadWidthM: road.widthM,
          residentialStyle,
          campaignEligible: building.source === "procedural-cell",
          score,
        });
      }
    }
  }
  options.sort(
    (a, b) => a.score - b.score || a.roadId.localeCompare(b.roadId),
  );
  const accepted: FacadeCandidate[] = [];
  const usedRoads = new Set<string>();
  for (const candidate of options) {
    if (usedRoads.has(candidate.roadId)) continue;
    if (!facadeLineIsClear(candidate, solidGrid)) continue;
    usedRoads.add(candidate.roadId);
    accepted.push(candidate);
  }
  return accepted;
}

function densityFor(candidate: FacadeCandidate): TokyoAdvertisingDensity {
  if (
    distanceSquared(candidate.faceCenter, DOWNTOWN_CENTER) <=
      DOWNTOWN_RADIUS_M * DOWNTOWN_RADIUS_M ||
    distanceSquared(candidate.faceCenter, SPAWN_DISTRICT_CENTER) <=
      SPAWN_DISTRICT_RADIUS_M * SPAWN_DISTRICT_RADIUS_M
  ) {
    return "core";
  }
  return COMMERCIAL_CORRIDOR.test(candidate.roadId) ? "corridor" : "satellite";
}

function stableIndex(value: string, modulo: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % modulo;
}

function normalized(x: number, z: number): GameCanvasPoint {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

function headingFor(normal: GameCanvasPoint): number {
  return (Math.atan2(normal.x, normal.z) * 180) / Math.PI;
}

function cantedNormal(candidate: FacadeCandidate, amount: number): GameCanvasPoint {
  const toRoad = normalized(
    candidate.roadPoint.x - candidate.faceCenter.x,
    candidate.roadPoint.z - candidate.faceCenter.z,
  );
  const negative = normalized(
    candidate.normal.x - candidate.roadTangent.x * amount,
    candidate.normal.z - candidate.roadTangent.z * amount,
  );
  const positive = normalized(
    candidate.normal.x + candidate.roadTangent.x * amount,
    candidate.normal.z + candidate.roadTangent.z * amount,
  );
  const negativeFacing = negative.x * toRoad.x + negative.z * toRoad.z;
  const positiveFacing = positive.x * toRoad.x + positive.z * toRoad.z;
  if (Math.abs(negativeFacing - positiveFacing) < 1e-6) {
    return stableIndex(`${candidate.buildingId}:${candidate.roadId}`, 2) === 0
      ? negative
      : positive;
  }
  return negativeFacing > positiveFacing ? negative : positive;
}

function selectedHosts(candidates: readonly FacadeCandidate[]): FacadeCandidate[] {
  const byRoad = new Map<string, FacadeCandidate[]>();
  for (const candidate of candidates) {
    const group = byRoad.get(candidate.roadId) ?? [];
    group.push(candidate);
    byRoad.set(candidate.roadId, group);
  }
  const selected: FacadeCandidate[] = [];
  for (const roadId of [...byRoad.keys()].sort()) {
    const ordered = [...(byRoad.get(roadId) ?? [])].sort(
      (a, b) =>
        a.roadStationM - b.roadStationM ||
        a.roadDistanceM - b.roadDistanceM ||
        a.buildingId.localeCompare(b.buildingId),
    );
    let lastStationM = Number.NEGATIVE_INFINITY;
    for (const candidate of ordered) {
      const density = densityFor(candidate);
      const spacingM = density === "core" ? 7 : density === "corridor" ? 19 : 38;
      if (candidate.roadStationM - lastStationM < spacingM) continue;
      selected.push(candidate);
      lastStationM = candidate.roadStationM;
    }
  }
  return selected.sort(
    (a, b) =>
      a.roadId.localeCompare(b.roadId) ||
      a.roadStationM - b.roadStationM ||
      a.buildingId.localeCompare(b.buildingId),
  );
}

function campaignPlacementFor(
  candidate: FacadeCandidate,
  creativeIndex: number,
  kind: TokyoAdPlacementKind,
  distribution: TokyoAdvertisingDensity,
): TokyoAdPlacement {
  const portrait = kind === "facade-poster";
  const requestedWidthM = portrait
    ? Math.min(5.2, Math.max(2.8, candidate.faceWidthM * 0.48))
    : Math.min(22, Math.max(9, candidate.faceWidthM * 0.82));
  const aspectHeightPerWidth = portrait ? 1.5 : 9 / 16;
  const widthM = kind === "rooftop-screen"
    ? requestedWidthM
    : Math.min(
        requestedWidthM,
        (candidate.buildingHeightM - 2.45) / aspectHeightPerWidth,
      );
  const heightM = widthM * aspectHeightPerWidth;
  const roadEdgeClearanceM =
    candidate.roadDistanceM - candidate.roadWidthM / 2;
  const targetCant = portrait ? 0.42 : 0.3;
  const maximumProjectedFraction = Math.max(
    0,
    Math.min(0.94, (roadEdgeClearanceM - 1.5) / widthM),
  );
  const maximumCant =
    maximumProjectedFraction /
    Math.sqrt(1 - maximumProjectedFraction * maximumProjectedFraction);
  const displayNormal = cantedNormal(
    candidate,
    Math.min(kind === "rooftop-screen" ? 0.55 : targetCant, maximumCant),
  );
  const localX = { x: displayNormal.z, z: -displayNormal.x };
  const outwardM =
    Math.abs(localX.x * candidate.normal.x + localX.z * candidate.normal.z) *
      widthM / 2 +
    0.24;
  const position = {
    x: candidate.faceCenter.x + candidate.normal.x * outwardM,
    z: candidate.faceCenter.z + candidate.normal.z * outwardM,
  };
  const centerYM =
    kind === "rooftop-screen"
      ? candidate.buildingHeightM + 0.8 + heightM / 2
      : Math.min(
          4 + heightM / 2,
          candidate.buildingHeightM - heightM / 2 - 0.45,
        );
  const creative = TOKYO_AD_CREATIVES[creativeIndex];
  return {
    id: `tokyo-ad-${distribution}-${creative.id}-${candidate.buildingId}-${candidate.roadId}`,
    kind,
    creativeIndex,
    position,
    headingDeg: headingFor(displayNormal),
    centerYM,
    widthM,
    heightM,
    buildingId: candidate.buildingId,
    roadId: candidate.roadId,
    roadStationM: candidate.roadStationM,
    roadDistanceM: candidate.roadDistanceM,
    distribution,
  };
}

function tenantPlacement(
  candidate: FacadeCandidate,
  kind: TokyoTenantPlacementKind,
  tenantIndex: number,
  ordinal: number,
  distribution: TokyoAdvertisingDensity,
): TokyoTenantPlacement | undefined {
  const tenant = TOKYO_TENANT_CREATIVES[tenantIndex];
  if (kind === "blade-kanban") {
    const roadEdgeClearanceM =
      candidate.roadDistanceM - candidate.roadWidthM / 2;
    if (roadEdgeClearanceM < 2) return undefined;
    const widthM = 1.15;
    const heightM = Math.min(4.8, candidate.buildingHeightM - 2.9);
    if (heightM < 2.5) return undefined;
    const offset =
      ordinal === 0
        ? 0
        : (ordinal % 2 === 0 ? -1 : 1) *
          Math.min(candidate.faceWidthM * 0.28, 3.4);
    const position = {
      x:
        candidate.faceCenter.x +
        candidate.roadTangent.x * offset +
        candidate.normal.x * (widthM / 2 + 0.22),
      z:
        candidate.faceCenter.z +
        candidate.roadTangent.z * offset +
        candidate.normal.z * (widthM / 2 + 0.22),
    };
    return {
      id: `tokyo-tenant-${kind}-${tenant.id}-${candidate.buildingId}-${candidate.roadId}-${ordinal}`,
      kind,
      tenantIndex,
      directoryVariant: 0,
      position,
      headingDeg: headingFor(candidate.roadTangent),
      centerYM: Math.min(
        2.45 + heightM / 2 + ordinal * 0.65,
        candidate.buildingHeightM - heightM / 2 - 0.35,
      ),
      widthM,
      heightM,
      buildingId: candidate.buildingId,
      roadId: candidate.roadId,
      roadStationM: candidate.roadStationM,
      distribution,
    };
  }
  if (kind === "storefront-fascia") {
    const widthM = Math.min(7.5, candidate.faceWidthM - 0.45);
    if (widthM < 2.5) return undefined;
    return {
      id: `tokyo-tenant-${kind}-${tenant.id}-${candidate.buildingId}-${candidate.roadId}`,
      kind,
      tenantIndex,
      directoryVariant: 0,
      position: {
        x: candidate.faceCenter.x + candidate.normal.x * 0.18,
        z: candidate.faceCenter.z + candidate.normal.z * 0.18,
      },
      headingDeg: headingFor(candidate.normal),
      centerYM: 3.15,
      widthM,
      heightM: 1.18,
      buildingId: candidate.buildingId,
      roadId: candidate.roadId,
      roadStationM: candidate.roadStationM,
      distribution,
    };
  }
  const heightM = Math.min(7.8, candidate.buildingHeightM - 3);
  if (heightM < 4.8) return undefined;
  const widthM = 1.65;
  const roadEdgeClearanceM =
    candidate.roadDistanceM - candidate.roadWidthM / 2;
  const maximumProjectedFraction = Math.max(
    0,
    Math.min(0.94, (roadEdgeClearanceM - 1) / widthM),
  );
  const maximumCant =
    maximumProjectedFraction /
    Math.sqrt(1 - maximumProjectedFraction * maximumProjectedFraction);
  const displayNormal = cantedNormal(candidate, Math.min(0.48, maximumCant));
  const localX = { x: displayNormal.z, z: -displayNormal.x };
  const outwardM =
    Math.abs(localX.x * candidate.normal.x + localX.z * candidate.normal.z) *
      widthM / 2 +
    0.2;
  return {
    id: `tokyo-tenant-${kind}-${candidate.buildingId}-${candidate.roadId}`,
    kind,
    tenantIndex,
    directoryVariant: stableIndex(candidate.buildingId, 8),
    position: {
      x: candidate.faceCenter.x + candidate.normal.x * outwardM,
      z: candidate.faceCenter.z + candidate.normal.z * outwardM,
    },
    headingDeg: headingFor(displayNormal),
    centerYM: 2.55 + heightM / 2,
    widthM,
    heightM,
    buildingId: candidate.buildingId,
    roadId: candidate.roadId,
    roadStationM: candidate.roadStationM,
    distribution,
  };
}

const placementCache = new WeakMap<BuildingLayoutPlan, TokyoAdvertisingPlan>();

/**
 * Builds dense commercial sign architecture around the spawn district and
 * downtown, then carries smaller clusters along corridors and satellite roads.
 */
export function tokyoAdvertisingPlan(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): TokyoAdvertisingPlan {
  if (mapPack.id !== "tokyo-setagaya") return { campaigns: [], tenantSigns: [] };
  const cached = placementCache.get(buildingLayout);
  if (cached) return cached;

  // A cheap whole-road AABB rejection removes almost every road before the
  // exact nearest-polyline query. Tokyo has thousands of structural solids,
  // so comparing every face with every road adds substantial scene boot work.
  const indexedRoads = (mapPack.geometry.roadSurfaces ?? [])
    .filter(
      (road) =>
        !road.id.includes("urban-expressway") &&
        !road.id.includes("ohashi") &&
        !road.id.endsWith("-bashi") &&
        road.centerline.every((point) => (point.elevationM ?? 0) < 1),
    )
    .map((road) => {
    const xs = road.centerline.map((point) => point.x);
    const zs = road.centerline.map((point) => point.z);
    return {
      road,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
  });
  const solidGrid = buildSolidGrid(buildingLayout);
  const blockBuildingSets = new Map(
    mapPack.geometry.blocks.map((block) => [block.id, block.buildingSet]),
  );
  const all = buildingLayout.buildings.flatMap((building) =>
    roadFacingCandidates(
      indexedRoads,
      building,
      solidGrid,
      TOKYO_RESIDENTIAL_BUILDING_SETS.has(
        blockBuildingSets.get(building.blockId) ?? "",
      ) ||
        (building.source === "asset-slot" &&
          TOKYO_RESIDENTIAL_MODEL.test(building.modelId)),
    ),
  );
  const hosts = selectedHosts(all);
  const campaigns: TokyoAdPlacement[] = [];
  const tenantSigns: TokyoTenantPlacement[] = [];
  let portraitCursor = 0;
  let landscapeCursor = 0;
  for (const [hostIndex, candidate] of hosts.entries()) {
    const distribution = densityFor(candidate);
    const tenantSeed = stableIndex(candidate.buildingId, TOKYO_TENANT_CREATIVES.length);
    const bladeCapacity = Math.min(
      3,
      Math.max(
        1,
        Math.floor(
          candidate.faceWidthM / (candidate.residentialStyle ? 2.6 : 3.1),
        ),
      ),
    );
    const bladeCount = candidate.residentialStyle
      ? bladeCapacity
      : distribution === "core"
        ? bladeCapacity
        : distribution === "corridor"
          ? Math.min(2, bladeCapacity)
          : 1;
    for (let ordinal = 0; ordinal < bladeCount; ordinal += 1) {
      const sign = tenantPlacement(
        candidate,
        "blade-kanban",
        (tenantSeed + ordinal * 7) % TOKYO_TENANT_CREATIVES.length,
        ordinal,
        distribution,
      );
      if (sign) tenantSigns.push(sign);
    }
    const wantsFascia =
      !candidate.residentialStyle &&
      (distribution === "core" ||
        (distribution === "corridor" && hostIndex % 2 === 0) ||
        (distribution === "satellite" && hostIndex % 3 === 0));
    if (wantsFascia) {
      const fascia = tenantPlacement(
        candidate,
        "storefront-fascia",
        (tenantSeed + 11) % TOKYO_TENANT_CREATIVES.length,
        0,
        distribution,
      );
      if (fascia) tenantSigns.push(fascia);
    }
    if (
      distribution === "core" &&
      !candidate.residentialStyle &&
      hostIndex % 4 === 0 &&
      candidate.faceWidthM >= 2.5
    ) {
      const directory = tenantPlacement(
        candidate,
        "tenant-directory",
        tenantSeed,
        0,
        distribution,
      );
      if (directory) tenantSigns.push(directory);
    }

    const campaignCadence = distribution === "core" ? 2 : distribution === "corridor" ? 3 : 4;
    if (!candidate.campaignEligible || hostIndex % campaignCadence !== 0) continue;
    const landscapeReady =
      candidate.faceWidthM >= 10 && candidate.buildingHeightM >= 10;
    const wantsRooftop =
      landscapeReady && candidate.buildingHeightM >= 15 && hostIndex % 17 === 0;
    const wantsScreen = landscapeReady && hostIndex % (distribution === "core" ? 7 : 12) === 0;
    if (wantsRooftop || wantsScreen) {
      campaigns.push(
        campaignPlacementFor(
          candidate,
          LANDSCAPE_CREATIVE_START + landscapeCursor % LANDSCAPE_CREATIVE_COUNT,
          wantsRooftop ? "rooftop-screen" : "facade-screen",
          distribution,
        ),
      );
      landscapeCursor += 1;
    } else if (candidate.faceWidthM >= 3.2 && candidate.buildingHeightM >= 7.5) {
      campaigns.push(
        campaignPlacementFor(
          candidate,
          portraitCursor % PORTRAIT_CREATIVE_COUNT,
          "facade-poster",
          distribution,
        ),
      );
      portraitCursor += 1;
    }
  }
  const plan = { campaigns, tenantSigns } as const;
  placementCache.set(buildingLayout, plan);
  return plan;
}

export function tokyoAdPlacements(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): readonly TokyoAdPlacement[] {
  return tokyoAdvertisingPlan(mapPack, buildingLayout).campaigns;
}

export function tokyoTenantSignPlacements(
  mapPack: GameCanvasMapPack,
  buildingLayout: BuildingLayoutPlan,
): readonly TokyoTenantPlacement[] {
  return tokyoAdvertisingPlan(mapPack, buildingLayout).tenantSigns;
}
