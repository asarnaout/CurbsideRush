/**
 * Deterministic whole-traffic benchmark for issue #142's fixed local fleet.
 *
 * Run: `npx vitest bench tests/perf/trafficSimulation.bench.ts --pool=forks --maxWorkers=1`
 *
 * This is intentionally an external harness: every wall-clock read lives in
 * this file, while the production simulation receives only a fixed 1/60 s
 * tick and a tick-indexed input trace. That makes candidate/baseline timing
 * comparisons meaningful even when one implementation runs more slowly.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import { bench, describe } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../../app/game/content";
import { buildFreeDriveScenario } from "../../app/game/driveScenario";
import {
  FIXED_STEP_SECONDS,
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationInput,
  type TrafficDiagnosticsSnapshot,
} from "../../app/game/simulation";
import { buildSimulationCoreConfig } from "../../app/game/simulationAdapter";

// Each replay already contributes 3,600 fixed-step timings. Keep enough whole
// replays for a useful replay-level tail without turning Tinybench's own
// warm-up + measured invocation into a ten-minute command on the larger maps.
const WARMUP_REPLAYS = 2;
const MEASURED_REPLAYS = 12;
const TRAFFIC_CONTROL_TRACE_TICKS = 3_600;
// Traffic decisions run at 10 Hz, so this records each possible lifecycle
// transition without placing diagnostic allocation inside an individual step
// timing measurement.
const DIAGNOSTIC_SAMPLE_TICKS = 6;

interface MapBenchCase {
  readonly mapId: string;
  readonly config: SimulationCoreConfig;
}

interface ControlTraceSegment {
  readonly toTick: number;
  readonly input: SimulationInput;
}

/**
 * A committed input trace, rather than wall-clock browser input. It is not a
 * route-quality test: the same trace drives all four production maps so each
 * replay exercises player-relative traffic locality and the full NPC fleet
 * under byte-identical fixed-step input.
 */
const TRAFFIC_CONTROL_TRACE: readonly ControlTraceSegment[] = [
  { toTick: 900, input: { throttle: 0.8, brake: 0, reverse: 0, steer: 0 } },
  { toTick: 1_500, input: { throttle: 0.65, brake: 0, reverse: 0, steer: 0.22 } },
  { toTick: 2_100, input: { throttle: 0.7, brake: 0, reverse: 0, steer: -0.18 } },
  { toTick: 2_400, input: { throttle: 0, brake: 0.7, reverse: 0, steer: 0 } },
  { toTick: 3_000, input: { throttle: 0, brake: 0, reverse: 0.55, steer: 0.12 } },
  { toTick: TRAFFIC_CONTROL_TRACE_TICKS, input: { throttle: 0.75, brake: 0, reverse: 0, steer: 0 } },
];

const ZERO_INPUT: SimulationInput = { throttle: 0, brake: 0, reverse: 0, steer: 0 };

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

// execFileSync (argument array, no shell) keeps the metadata helper safe even
// though every call site currently uses only fixed literals.
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

function percentile(sortedAscending: readonly number[], percentileValue: number): number {
  const index = Math.min(
    sortedAscending.length - 1,
    Math.floor(percentileValue * sortedAscending.length),
  );
  return sortedAscending[index];
}

function trafficInputAtTick(tick: number): SimulationInput {
  for (const segment of TRAFFIC_CONTROL_TRACE) {
    if (tick < segment.toTick) return segment.input;
  }
  return ZERO_INPUT;
}

/** Rounded snapshot of every active NPC state, used solely to report whether
 * repeated executions of this exact input trace stayed deterministic. */
function fingerprintSnapshot(core: SimulationCore): string {
  const snapshot = core.getSnapshot();
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    player: [
      round(snapshot.player.x),
      round(snapshot.player.z),
      round(snapshot.player.heading),
      round(snapshot.player.signedSpeedMps),
    ],
    queuedNpcCount: snapshot.queuedNpcCount,
    npcs: snapshot.npcs.map((npc) => [
      npc.id,
      npc.laneId,
      npc.variant,
      npc.state,
      round(npc.x),
      round(npc.z),
      round(npc.heading),
      round(npc.speedMps),
    ]),
  });
}

interface ReplayResult {
  /** Each value measures exactly one `SimulationCore.step` call. */
  readonly stepElapsedMs: readonly number[];
  /** Sum of the fixed-step timings; diagnostics run outside this interval. */
  readonly replayElapsedMs: number;
  readonly finalSnapshotFingerprint: string;
  readonly diagnostics: TrafficDiagnosticsSnapshot;
  /** Sampled at initialization and after every 10 Hz decision boundary. */
  readonly queuedNpcPeak: number;
}

function runReplay(config: SimulationCoreConfig): ReplayResult {
  const core = new SimulationCore(config);
  const stepElapsedMs: number[] = [];
  let diagnostics = core.getTrafficDiagnostics();
  let queuedNpcPeak = diagnostics.queuedNpcCount;
  core.resetRouteSearchCounters();

  try {
    for (let tick = 0; tick < TRAFFIC_CONTROL_TRACE_TICKS; tick += 1) {
      const started = process.hrtime.bigint();
      core.step(FIXED_STEP_SECONDS, trafficInputAtTick(tick));
      stepElapsedMs.push(Number(process.hrtime.bigint() - started) / 1e6);

      if ((tick + 1) % DIAGNOSTIC_SAMPLE_TICKS === 0 || tick + 1 === TRAFFIC_CONTROL_TRACE_TICKS) {
        diagnostics = core.getTrafficDiagnostics();
        queuedNpcPeak = Math.max(queuedNpcPeak, diagnostics.queuedNpcCount);
      }
    }

    return {
      stepElapsedMs,
      replayElapsedMs: stepElapsedMs.reduce((total, elapsedMs) => total + elapsedMs, 0),
      finalSnapshotFingerprint: fingerprintSnapshot(core),
      diagnostics,
      queuedNpcPeak,
    };
  } finally {
    core.dispose();
  }
}

function summarize(mapCase: MapBenchCase, replays: readonly ReplayResult[]) {
  const elapsedSteps = replays.flatMap((replay) => replay.stepElapsedMs).sort((a, b) => a - b);
  const elapsedReplays = replays.map((replay) => replay.replayElapsedMs).sort((a, b) => a - b);
  const snapshotFingerprints = new Set(replays.map((replay) => replay.finalSnapshotFingerprint));
  const last = replays[replays.length - 1];
  const runtimePortalCatalogCount = mapCase.config.runtimeTrafficPortals?.length ?? 0;
  const report = {
    label: mapCase.mapId,
    gitSha: gitSha(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    fixedStepSeconds: FIXED_STEP_SECONDS,
    traceTicks: TRAFFIC_CONTROL_TRACE_TICKS,
    warmupReplays: WARMUP_REPLAYS,
    measuredReplays: replays.length,
    deterministic: snapshotFingerprints.size === 1,
    stepElapsedMsP50: percentile(elapsedSteps, 0.5),
    stepElapsedMsP95: percentile(elapsedSteps, 0.95),
    stepElapsedMsMax: elapsedSteps[elapsedSteps.length - 1],
    replayElapsedMsP50: percentile(elapsedReplays, 0.5),
    replayElapsedMsP95: percentile(elapsedReplays, 0.95),
    replayElapsedMsMax: elapsedReplays[elapsedReplays.length - 1],
    traffic: {
      activeNpcCount: last.diagnostics.activeNpcCount,
      queuedNpcCount: last.diagnostics.queuedNpcCount,
      queuedNpcPeak: Math.max(...replays.map((replay) => replay.queuedNpcPeak)),
      routeSearch: last.diagnostics.routeSearch,
      spatialIndex: last.diagnostics.spatialIndex,
      locality: {
        ...last.diagnostics.locality,
        runtimePortalCatalogCount,
      },
    },
  };
  console.log(`[trafficSimulation.bench] ${JSON.stringify(report)}`);
  return report;
}

describe("traffic simulation — fixed control trace per production map", () => {
  for (const mapCase of MAP_CASES) {
    bench(
      mapCase.mapId,
      () => {
        for (let replay = 0; replay < WARMUP_REPLAYS; replay += 1) runReplay(mapCase.config);
        const replays = Array.from({ length: MEASURED_REPLAYS }, () => runReplay(mapCase.config));
        summarize(mapCase, replays);
      },
      // Tinybench treats zero warm-up iterations as "use the default". One
      // explicit warm-up plus one measured invocation makes the work above run
      // exactly twice and keeps paired local measurements practical.
      { iterations: 1, warmupIterations: 1 },
    );
  }
});
