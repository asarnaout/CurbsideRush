/**
 * External benchmark harness for the static-collision narrow phase — see
 * plan `.claude/building-collision-visual-parity-plan.md` Sections 8 (Phase
 * 0 / Phase 6) and 12.1. Never imports a clock into `simulation.ts`,
 * `playerDynamics.ts`, or `staticObstacleIndex.ts`; every `process.hrtime`
 * call lives here, in the external harness, exactly as the plan requires.
 *
 * Run: `npx vitest bench tests/perf/staticCollision.bench.ts --pool=forks --maxWorkers=1`
 *
 * This file measures the CURRENT (pre-plan) full-block collider baseline.
 * Phase 6 reruns the identical, unmodified harness — both against the
 * candidate build and, from a worktree pinned at the Phase 0 commit, against
 * this same baseline on the same machine — to control for drift. Obstacle
 * count alone is not a gate; candidate count and measured time are.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import { bench, describe } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../../app/game/content";
import { buildFreeDriveScenario } from "../../app/game/driveScenario";
import { SimulationCore, type SimulationCoreConfig } from "../../app/game/simulation";
import { buildSimulationCoreConfig } from "../../app/game/simulationAdapter";
import type { StaticObstacle } from "../../app/game/types";
import {
  controlTraceInputAtTick,
  STATIC_COLLISION_CONTROL_TRACE_TICKS,
} from "./fixtures/staticCollisionControlTrace";

const FIXED_STEP_SECONDS = 1 / 60;
const WARMUP_REPLAYS = 5;
const MEASURED_REPLAYS = 30;
// Sit at the densest cluster for 10 s of fixed steps with zero pedal input:
// collision resolution still runs every step (movePlayer always calls
// resolveStaticCollisions), so this measures steady-state worst-case
// candidate/narrow-test cost independent of whatever a driven route happens
// to pass through.
const WORST_CASE_CLUSTER_TICKS = 600;
const DENSITY_CELL_SIZE_M = 32;

// execFileSync (argument array, no shell) rather than execSync: no shell
// metacharacter interpretation, even though every call site here passes
// fixed literals with nothing external interpolated in.
function safeExec(file: string, args: readonly string[]): string {
  try {
    return execFileSync(file, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function gitSha(): string {
  return safeExec("git", ["rev-parse", "HEAD"]);
}

function vitestVersion(): string {
  const raw = safeExec("npm", ["ls", "vitest", "--depth=0", "--json"]);
  try {
    const parsed = JSON.parse(raw) as { dependencies?: { vitest?: { version?: string } } };
    return parsed.dependencies?.vitest?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function percentile(sortedAscending: readonly number[], p: number): number {
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index];
}

function obstacleCenter(obstacle: StaticObstacle): { x: number; z: number } {
  if (obstacle.kind === "circle" || obstacle.kind === "obb") {
    return { x: obstacle.x, z: obstacle.z };
  }
  if (obstacle.kind === "aabb") {
    return { x: (obstacle.minX + obstacle.maxX) / 2, z: (obstacle.minZ + obstacle.maxZ) / 2 };
  }
  let sumX = 0;
  let sumZ = 0;
  for (const point of obstacle.points) {
    sumX += point.x;
    sumZ += point.z;
  }
  return { x: sumX / obstacle.points.length, z: sumZ / obstacle.points.length };
}

interface MapBenchCase {
  readonly mapId: string;
  readonly config: SimulationCoreConfig;
}

const MAP_CASES: readonly MapBenchCase[] = FREE_DRIVES.map((freeDrive) => {
  const country = getCountryProfile(freeDrive.countryId);
  const mapPack = getMapPack(freeDrive.mapId);
  return {
    mapId: mapPack.id,
    config: buildSimulationCoreConfig({
      scenario: buildFreeDriveScenario(freeDrive),
      mapPack,
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    }),
  };
});

/** The single most obstacle-dense `DENSITY_CELL_SIZE_M` cell across all
 * shipped maps, found once at module load from the same production
 * `buildStaticObstacles` output the collision system itself consumes — not a
 * hand-picked coordinate. */
function findDensestCluster(cases: readonly MapBenchCase[]): {
  mapId: string;
  x: number;
  z: number;
  obstacleCount: number;
} {
  let best = { mapId: cases[0]?.mapId ?? "", x: 0, z: 0, obstacleCount: 0 };
  for (const { mapId, config } of cases) {
    const cells = new Map<string, { sumX: number; sumZ: number; count: number }>();
    for (const obstacle of config.staticObstacles ?? []) {
      const { x, z } = obstacleCenter(obstacle);
      const key = `${Math.floor(x / DENSITY_CELL_SIZE_M)}:${Math.floor(z / DENSITY_CELL_SIZE_M)}`;
      const cell = cells.get(key) ?? { sumX: 0, sumZ: 0, count: 0 };
      cell.sumX += x;
      cell.sumZ += z;
      cell.count += 1;
      cells.set(key, cell);
    }
    for (const cell of cells.values()) {
      if (cell.count > best.obstacleCount) {
        best = { mapId, x: cell.sumX / cell.count, z: cell.sumZ / cell.count, obstacleCount: cell.count };
      }
    }
  }
  return best;
}

interface ReplayResult {
  readonly elapsedMs: number;
  readonly finalSnapshotFingerprint: string;
  readonly counters: ReturnType<SimulationCore["getStaticCollisionCounters"]>;
}

/** Rounded so float noise cannot spuriously fail a same-input-trace
 * determinism comparison across replays. */
function fingerprintSnapshot(core: SimulationCore): string {
  const snapshot = core.getSnapshot();
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    x: round(snapshot.player.x),
    z: round(snapshot.player.z),
    heading: round(snapshot.player.heading),
    signedSpeedMps: round(snapshot.player.signedSpeedMps),
    npcCount: snapshot.npcs.length,
  });
}

function runDrivenReplay(config: SimulationCoreConfig): ReplayResult {
  const core = new SimulationCore(config);
  core.resetStaticCollisionCounters();
  const started = process.hrtime.bigint();
  for (let tick = 0; tick < STATIC_COLLISION_CONTROL_TRACE_TICKS; tick += 1) {
    core.step(FIXED_STEP_SECONDS, controlTraceInputAtTick(tick));
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const result: ReplayResult = {
    elapsedMs,
    finalSnapshotFingerprint: fingerprintSnapshot(core),
    counters: core.getStaticCollisionCounters(),
  };
  core.dispose();
  return result;
}

function runIdleClusterReplay(config: SimulationCoreConfig, x: number, z: number): ReplayResult {
  const core = new SimulationCore(config);
  core.setPlayerPose({ x, z, heading: 0 });
  core.resetStaticCollisionCounters();
  const started = process.hrtime.bigint();
  for (let tick = 0; tick < WORST_CASE_CLUSTER_TICKS; tick += 1) {
    core.step(FIXED_STEP_SECONDS, { throttle: 0, brake: 0, reverse: 0, steer: 0 });
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const result: ReplayResult = {
    elapsedMs,
    finalSnapshotFingerprint: fingerprintSnapshot(core),
    counters: core.getStaticCollisionCounters(),
  };
  core.dispose();
  return result;
}

function summarize(
  label: string,
  replays: readonly ReplayResult[],
  obstacleCountByTag: Readonly<Record<string, number>>,
) {
  const elapsed = replays.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const fingerprints = new Set(replays.map((r) => r.finalSnapshotFingerprint));
  const last = replays[replays.length - 1];
  const report = {
    label,
    gitSha: gitSha(),
    vitestVersion: vitestVersion(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    // Node has no portable AC/battery/performance-mode API without adding a
    // dependency (out of scope for this work) — record this by hand when
    // comparing runs.
    powerMode: "unknown — record manually",
    warmupReplays: WARMUP_REPLAYS,
    measuredReplays: replays.length,
    // True only if every replay of this IDENTICAL input trace reached the
    // same final pose/NPC count — the determinism gate in plan Section 12.2.
    deterministic: fingerprints.size === 1,
    elapsedMsMedian: percentile(elapsed, 0.5),
    elapsedMsP95: percentile(elapsed, 0.95),
    elapsedMsMax: elapsed[elapsed.length - 1],
    finalStaticCollisionCounters: last.counters,
    obstacleCountByTag,
  };
  console.log(`[staticCollision.bench] ${JSON.stringify(report)}`);
  return report;
}

describe("static collision — fixed control trace per map", () => {
  for (const { mapId, config } of MAP_CASES) {
    const obstacleCountByTag: Record<string, number> = {};
    for (const obstacle of config.staticObstacles ?? []) {
      obstacleCountByTag[obstacle.tag] = (obstacleCountByTag[obstacle.tag] ?? 0) + 1;
    }
    bench(
      mapId,
      () => {
        for (let i = 0; i < WARMUP_REPLAYS; i += 1) runDrivenReplay(config);
        const replays = Array.from({ length: MEASURED_REPLAYS }, () => runDrivenReplay(config));
        summarize(mapId, replays, obstacleCountByTag);
      },
      { iterations: 1, warmupIterations: 0 },
    );
  }
});

describe("static collision — synthetic worst-case cluster", () => {
  const cluster = findDensestCluster(MAP_CASES);
  const clusterCase = MAP_CASES.find((entry) => entry.mapId === cluster.mapId);

  bench(
    `densest-32m-cell (${cluster.mapId} @ ${cluster.x.toFixed(1)},${cluster.z.toFixed(1)}, ${cluster.obstacleCount} obstacles)`,
    () => {
      if (!clusterCase) throw new Error("No map cases to benchmark");
      for (let i = 0; i < WARMUP_REPLAYS; i += 1) {
        runIdleClusterReplay(clusterCase.config, cluster.x, cluster.z);
      }
      const replays = Array.from({ length: MEASURED_REPLAYS }, () =>
        runIdleClusterReplay(clusterCase.config, cluster.x, cluster.z),
      );
      const obstacleCountByTag: Record<string, number> = {};
      for (const obstacle of clusterCase.config.staticObstacles ?? []) {
        obstacleCountByTag[obstacle.tag] = (obstacleCountByTag[obstacle.tag] ?? 0) + 1;
      }
      summarize(`${cluster.mapId}-densest-cell`, replays, obstacleCountByTag);
    },
    { iterations: 1, warmupIterations: 0 },
  );
});
