/**
 * CLI for the visual-gap audit — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 7.1/7.8.
 *
 *   npm run audit:visual-gaps -- --maps london,nyc,cairo --format table --fail-on-failures
 *   npm run audit:visual-gaps -- --maps london,nyc,cairo --format json --output artifacts/visual-gap-audit/report.json
 *
 * Current scope (see the module doc in `geometry/visualGapCoverage.ts` and
 * `geometry/visualSceneFootprints.ts` for what each phase of this plan has
 * built so far): this CLI runs the real-map ground-surface/occluder
 * collector and the 4 m ground raster's connected-void detector end to end
 * against live map packs, and reports every qualifying (>= 300 m²) void
 * blob plus every unresolved-geometry issue. It does **not** yet run the
 * full Section 7.6 production camera-fan sampling matrix (chase/first-person
 * profiles x viewports x FOVs x seeds x representation profiles), so its
 * blob list is a superset of true failures: Section 5.3 also requires "a
 * sampled driving camera has an unobstructed sightline to it within 70 m,"
 * which this pass does not yet verify. Treat a blob reported here as a
 * candidate to investigate, not yet as the plan's final zero-failure gate —
 * that gate lands once the camera-sampling/state-machine wiring (Sections
 * 7.6-7.8) is connected to this same collector, a following change.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MAP_PACKS, FREE_DRIVES } from "../app/game/content";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { collectMapVisualGeometry } from "../app/game/geometry/visualSceneFootprints";
import { buildGroundRaster, QUALIFYING_BLOB_AREA_M2 } from "../app/game/geometry/visualGapCoverage";
import type { MapId } from "../app/game/types";

interface CliOptions {
  readonly maps: readonly string[];
  readonly format: "json" | "table";
  readonly output: string | null;
  readonly failOnFailures: boolean;
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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--maps") maps = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--format") format = argv[++i] === "json" ? "json" : "table";
    else if (arg === "--output") output = argv[++i] ?? null;
    else if (arg === "--fail-on-failures") failOnFailures = true;
    else if (arg === "--fail-on-unclassified") {
      throw new Error("--fail-on-unclassified is not a valid mode (Section 7.8): a correctly classified park_to_void must still fail.");
    }
  }
  return { maps, format, output, failOnFailures };
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
}

function auditMap(alias: string): MapAuditSummary {
  const mapId = MAP_ALIASES[alias] ?? (alias as MapId);
  const pack = MAP_PACKS.find((p) => p.id === mapId);
  if (!pack) {
    throw new Error(`Unknown map "${alias}" (resolved id "${mapId}"). Known aliases: ${Object.keys(MAP_ALIASES).join(", ")}`);
  }
  const freeDrive = FREE_DRIVES.find((fd) => fd.mapId === pack.id);
  const trafficSeed = freeDrive ? freeDrive.trafficSeed : 0;

  const t0 = Date.now();
  const plan = planMapBuildings(pack, trafficSeed);
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
    console.log(
      `  qualifying void blobs (>= ${QUALIFYING_BLOB_AREA_M2} m²): ${summary.qualifyingBlobs.length}`,
    );
    for (const blob of summary.qualifyingBlobs.slice(0, 25)) {
      console.log(`    ${blob.id}: ${blob.areaM2} m² at (${blob.centroid.x}, ${blob.centroid.z})`);
    }
    if (summary.qualifyingBlobs.length > 25) {
      console.log(`    ... and ${summary.qualifyingBlobs.length - 25} more`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summaries = options.maps.map(auditMap);

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
  if (options.failOnFailures && (totalIssues > 0 || totalBlobs > 0)) {
    console.error(
      `\naudit:visual-gaps failing: ${totalBlobs} qualifying void blob(s), ${totalIssues} unresolved-geometry issue(s).`,
    );
    process.exitCode = 1;
  }
}

await main();
