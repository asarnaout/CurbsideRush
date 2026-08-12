/**
 * CLI for the visual-gap audit — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 7.1/7.8.
 *
 *   npm run audit:visual-gaps -- --maps london,nyc,cairo --format table --fail-on-failures
 *   npm run audit:visual-gaps -- --maps london,nyc,cairo --format json --output artifacts/visual-gap-audit/report.json
 *
 * Default scope is the fast raster/blob pass only (Phase 1's ground-surface/
 * occluder collector plus the 4 m connected-void detector) — every
 * qualifying (>= 300 m²) void blob plus every unresolved-geometry issue.
 * That blob list is a SUPERSET of true failures: Section 5.3 also requires
 * "a sampled driving camera has an unobstructed sightline to it within
 * 70 m," which the raster alone does not verify (a blob can be real void
 * ground that happens to sit behind an existing building from every road).
 *
 * `--fan` runs the actual Section 7.6-7.8 camera-fan sweep
 * (`auditMapVisualGapsForMap`) on top of the raster and reports the real,
 * camera-verified failure classes — this is the plan's actual zero-failure
 * gate. It is opt-in and not the default because it is genuinely heavy by
 * design (Section 14.2 gives it its own 120-second budget for "the complete
 * seed/representation/camera corpus" and explicitly sanctions sharding);
 * every road x station x heading x camera-profile x viewport x FOV
 * combination is a real, distinct audited view, not redundant work, so a
 * content-heavy map (many still-unfixed qualifying blobs) costs
 * proportionally more to fully verify — that cost is highest exactly when a
 * map most needs auditing. `--fan` alone runs the lightest honest sweep (one
 * chase profile, one viewport, both travel headings, both FOVs); add
 * `--full-matrix` for the complete Section 7.6 camera-profile x viewport
 * cartesian product (all three chase tunings plus first-person from both
 * seats x both viewports) once a fix needs verifying against every
 * production camera a player can actually select. `--roads <id,id,...>`
 * scopes either sweep to specific road-surface ids — the fast way to iterate
 * on one content fix without re-auditing the whole map every time.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MAP_PACKS, FREE_DRIVES } from "../app/game/content";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import { collectMapVisualGeometry } from "../app/game/geometry/visualSceneFootprints";
import {
  auditMapVisualGapsForMap,
  buildGroundRaster,
  DEFAULT_AUDIT_CAMERA_PROFILES,
  QUALIFYING_BLOB_AREA_M2,
  type VisualGapReportRecord,
} from "../app/game/geometry/visualGapCoverage";
import { AUDIT_VIEWPORT_PROFILES } from "../app/game/cameraPoses";
import { defaultSidewalkWidthM } from "../app/game/visuals";
import type { MapId } from "../app/game/types";

interface CliOptions {
  readonly maps: readonly string[];
  readonly format: "json" | "table";
  readonly output: string | null;
  readonly failOnFailures: boolean;
  readonly runFan: boolean;
  readonly fullMatrix: boolean;
  readonly onlyRoadIds: ReadonlySet<string> | null;
}

const MAP_ALIASES: Readonly<Record<string, MapId>> = {
  london: "london-south-kensington",
  nyc: "nyc-upper-west-side",
  cairo: "cairo-central-nile",
  tokyo: "tokyo-setagaya",
};

function parseArgs(argv: readonly string[]): CliOptions {
  let maps: readonly string[] = ["london", "nyc", "cairo"];
  let format: "json" | "table" = "table";
  let output: string | null = null;
  let failOnFailures = false;
  let runFan = false;
  let fullMatrix = false;
  let onlyRoadIds: Set<string> | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--maps") maps = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--format") format = argv[++i] === "json" ? "json" : "table";
    else if (arg === "--output") output = argv[++i] ?? null;
    else if (arg === "--fail-on-failures") failOnFailures = true;
    else if (arg === "--fan") runFan = true;
    else if (arg === "--full-matrix") fullMatrix = true;
    else if (arg === "--roads") onlyRoadIds = new Set((argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--fail-on-unclassified") {
      throw new Error("--fail-on-unclassified is not a valid mode (Section 7.8): a correctly classified park_to_void must still fail.");
    }
  }
  return { maps, format, output, failOnFailures, runFan, fullMatrix, onlyRoadIds };
}

interface FanFailureGroup {
  readonly key: string;
  readonly failureClass: string;
  readonly cause: string;
  readonly rayCount: number;
  readonly affectedStations: number;
  readonly worst: VisualGapReportRecord;
}

/** Groups raw per-ray records by (failureClass, cause) — Section 7.8's "The
 * table groups by blob/cause and prints the worst pose, affected road
 * metres, and ray count." `cause` is the blob id for a void-blob failure, the
 * nearest opaque owner for a structural failure, or the road/segment for
 * anything else (an unblocked world edge, a missing-geometry error). */
function groupFanRecords(records: readonly VisualGapReportRecord[]): readonly FanFailureGroup[] {
  const groups = new Map<string, { records: VisualGapReportRecord[]; stations: Set<string> }>();
  for (const record of records) {
    const cause = record.blobId ?? record.nearestOpaqueOwnerId ?? `${record.roadId}/seg-${record.segmentIndex}`;
    const key = `${record.failureClass}::${cause}`;
    const stationKey = `${record.roadId}/seg-${record.segmentIndex}/station-${Math.round(record.stationDistanceM * 100)}/${record.side}`;
    let group = groups.get(key);
    if (!group) {
      group = { records: [], stations: new Set() };
      groups.set(key, group);
    }
    group.records.push(record);
    group.stations.add(stationKey);
  }
  return [...groups.entries()]
    .map(([key, { records: groupRecords, stations }]) => {
      const cause = groupRecords[0].blobId ?? groupRecords[0].nearestOpaqueOwnerId ?? `${groupRecords[0].roadId}/seg-${groupRecords[0].segmentIndex}`;
      const worst =
        groupRecords.find((r) => r.blobId !== null) ??
        [...groupRecords].sort((a, b) => (b.nearestOpaqueDistanceM ?? 0) - (a.nearestOpaqueDistanceM ?? 0))[0];
      return { key, failureClass: groupRecords[0].failureClass, cause, rayCount: groupRecords.length, affectedStations: stations.size, worst };
    })
    .sort((a, b) => b.rayCount - a.rayCount);
}

interface MapAuditSummary {
  readonly mapId: string;
  readonly trafficSeed: number;
  readonly blockCount: number;
  readonly plannedStructureCount: number;
  readonly groundSurfaceCount: number;
  readonly occluderCount: number;
  readonly issues: readonly { readonly kind: string; readonly ownerId: string; readonly reason: string }[];
  readonly unsupportedCellIds: readonly string[];
  readonly qualifyingBlobs: readonly {
    readonly id: string;
    readonly areaM2: number;
    readonly centroid: { readonly x: number; readonly z: number };
    readonly aabb: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  }[];
  readonly collectMs: number;
  readonly rasterMs: number;
  readonly fan: {
    readonly ms: number;
    readonly recordCount: number;
    readonly groups: readonly FanFailureGroup[];
  } | null;
}

function auditMap(alias: string, options: CliOptions): MapAuditSummary {
  const mapId = MAP_ALIASES[alias] ?? (alias as MapId);
  const pack = MAP_PACKS.find((p) => p.id === mapId);
  if (!pack) {
    throw new Error(`Unknown map "${alias}" (resolved id "${mapId}"). Known aliases: ${Object.keys(MAP_ALIASES).join(", ")}`);
  }
  const freeDrive = FREE_DRIVES.find((fd) => fd.mapId === pack.id);
  const trafficSeed = freeDrive ? freeDrive.trafficSeed : 0;

  const t0 = Date.now();
  const plan = planMapBuildings(pack, trafficSeed, relaxationPolicyForMap(pack.id));
  const geometry = collectMapVisualGeometry(pack, plan);
  const collectMs = Date.now() - t0;

  const t1 = Date.now();
  const raster = buildGroundRaster(geometry.groundSurfaces, geometry.occluders);
  const rasterMs = Date.now() - t1;

  const qualifyingBlobs = raster.blobs
    .filter((b) => b.qualifying)
    .sort((a, b) => b.area - a.area)
    .map((b) => ({
      id: b.id,
      areaM2: Math.round(b.area * 100) / 100,
      centroid: { x: Math.round(b.centroid.x * 100) / 100, z: Math.round(b.centroid.z * 100) / 100 },
      aabb: b.aabb,
    }));

  let fan: MapAuditSummary["fan"] = null;
  if (options.runFan) {
    const t2 = Date.now();
    const records = auditMapVisualGapsForMap(
      pack.id,
      pack.geometry.worldSize,
      pack.geometry.roadSurfaces ?? [],
      defaultSidewalkWidthM(pack),
      geometry,
      raster,
      {
        seedId: `seed-${trafficSeed}`,
        representationProfile: "full-detail",
        cameraProfiles: options.fullMatrix ? undefined : [DEFAULT_AUDIT_CAMERA_PROFILES[0]],
        viewports: options.fullMatrix ? undefined : [AUDIT_VIEWPORT_PROFILES[0]],
        onlyRoadIds: options.onlyRoadIds ?? undefined,
      },
    );
    fan = { ms: Date.now() - t2, recordCount: records.length, groups: groupFanRecords(records) };
  }

  return {
    mapId: pack.id,
    trafficSeed,
    blockCount: pack.geometry.blocks.length,
    plannedStructureCount: plan.buildings.length,
    groundSurfaceCount: geometry.groundSurfaces.length,
    occluderCount: geometry.occluders.length,
    issues: geometry.issues,
    unsupportedCellIds: raster.unsupportedCellIds,
    qualifyingBlobs,
    collectMs,
    rasterMs,
    fan,
  };
}

function printTable(summaries: readonly MapAuditSummary[]): void {
  for (const summary of summaries) {
    console.log(`\n=== ${summary.mapId} (seed ${summary.trafficSeed}) ===`);
    console.log(
      `  blocks=${summary.blockCount} plannedStructures=${summary.plannedStructureCount} ` +
        `groundSurfaces=${summary.groundSurfaceCount} occluders=${summary.occluderCount}`,
    );
    console.log(`  collect=${summary.collectMs}ms raster=${summary.rasterMs}ms`);
    if (summary.issues.length) {
      const byKind = new Map<string, number>();
      for (const issue of summary.issues) byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1);
      console.log(`  issues: ${[...byKind.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
    } else {
      console.log(`  issues: none`);
    }
    if (summary.unsupportedCellIds.length) {
      console.log(`  unsupported raster cells: ${summary.unsupportedCellIds.length}`);
    }
    console.log(`  qualifying void blobs (>= ${QUALIFYING_BLOB_AREA_M2} m²): ${summary.qualifyingBlobs.length}`);
    for (const blob of summary.qualifyingBlobs.slice(0, 25)) {
      console.log(`    ${blob.id}: ${blob.areaM2} m² at (${blob.centroid.x}, ${blob.centroid.z})`);
    }
    if (summary.qualifyingBlobs.length > 25) {
      console.log(`    ... and ${summary.qualifyingBlobs.length - 25} more`);
    }

    if (summary.fan) {
      console.log(`  fan sweep: ${summary.fan.ms}ms, ${summary.fan.recordCount} failing rays, ${summary.fan.groups.length} groups`);
      for (const group of summary.fan.groups.slice(0, 40)) {
        const w = group.worst;
        console.log(
          `    [${group.failureClass}] ${group.cause} — rays=${group.rayCount} stations=${group.affectedStations} ` +
            `worst=(${w.eye.x.toFixed(1)},${w.eye.z.toFixed(1)}) heading=${w.travelHeading} teleport={x:${w.suggestedTeleport.x.toFixed(1)},z:${w.suggestedTeleport.z.toFixed(1)},heading:${w.suggestedTeleport.heading.toFixed(3)}}`,
        );
      }
      if (summary.fan.groups.length > 40) console.log(`    ... and ${summary.fan.groups.length - 40} more groups`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summaries = options.maps.map((alias) => auditMap(alias, options));

  if (options.format === "json") {
    const json = JSON.stringify({ generatedAtNote: "byte-identical across runs at the same SHA", maps: summaries }, null, 2);
    if (options.output) {
      mkdirSync(dirname(options.output), { recursive: true });
      writeFileSync(options.output, json);
      console.log(`Wrote ${options.output}`);
    } else {
      console.log(json);
    }
  } else {
    printTable(summaries);
  }

  const totalIssues = summaries.reduce((s, m) => s + m.issues.length + m.unsupportedCellIds.length, 0);
  const totalBlobs = summaries.reduce((s, m) => s + m.qualifyingBlobs.length, 0);
  const totalFanFailures = summaries.reduce((s, m) => s + (m.fan?.recordCount ?? 0), 0);
  if (options.failOnFailures && (totalIssues > 0 || totalBlobs > 0 || totalFanFailures > 0)) {
    console.error(
      `\naudit:visual-gaps failing: ${totalBlobs} qualifying void blob(s), ${totalIssues} unresolved-geometry issue(s)` +
        (options.runFan ? `, ${totalFanFailures} failing camera-fan ray(s)` : "") +
        `.`,
    );
    process.exitCode = 1;
  }
}

await main();
