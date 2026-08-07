import type { LaneRestriction, RestrictionWindow, ScenarioClock, TrafficSide } from "../types";
import type { SimulationPoint, TurnSignal } from "../simulation";
import { clamp, distanceSquared, distanceToPolygon, isPointInPolygon } from "./mathUtils";
import type { EmitEventFn, PlayerPhysicsState } from "./playerDynamics";
import type { LaneProjection, RoadNetwork } from "./roadNetwork";
import { isRedSignalState } from "./roadNetwork";
import type { NpcInternal, TrafficSystem, TrafficTickCtx } from "./trafficSystem";

/**
 * Open-world rule detection: speeding, wrong-way, out-of-bounds, following
 * distance, passing-lane misuse, box junctions, restricted-lane hours, and
 * every stop-line kind (red light, railway, stop sign, yield). Emits
 * non-terminating events through the `emitEvent` callback every method
 * takes — the same shape `playerDynamics.ts` uses, and for the same reason:
 * the event queue and its per-`RuleCode` cooldowns stay owned by
 * `simulation.ts` itself, since it is the one thing every rule-detecting
 * seam (this one, and playerDynamics.ts's two collision paths) reports
 * into, plus the facade's own `reportExternalContact`.
 *
 * A class, like `TrafficSystem`: the accumulator seconds
 * (wrongWay/offRoad/speeding/following/passingLane) and the two per-id
 * maps (stopApproachSpeeds, restrictedLaneSeconds) are state genuinely
 * private to rule monitoring. `roadNetwork`, `trafficSystem`, `playerState`,
 * and `config` are captured once at construction for the same reasons
 * `TrafficSystem` captures them — see that class's own doc comment.
 * `TrafficTickCtx` (defined in trafficSystem.ts, reused here rather than
 * duplicated) supplies the volatile `roadState`/`elapsedSeconds` this seam
 * also needs on every call, built fresh by simulation.ts from the exact
 * same per-tick ctx object it already passes to `TrafficSystem`.
 *
 * `checkCollisions` — the other rule-adjacent path, staged separately —
 * stays in `simulation.ts` itself rather than here: see
 * `playerDynamics.ts`'s doc comment for why it is genuinely the
 * intersection of player and traffic state, not cleanly rule-detection.
 *
 * Moved verbatim out of `simulation.ts` (issue #284) — every method body is
 * byte-identical to its pre-split original, `this.` renamed to operate on
 * this class's own fields (or the captured `roadNetwork`/`trafficSystem`/
 * `playerState`/`config`, or the passed-in `ctx`) instead.
 */

/** A renderer-neutral box-junction conflict zone authored in world metres. */
export interface SimulationBoxJunctionDefinition {
  readonly id: string;
  readonly polygon: readonly SimulationPoint[];
  /** Lanes that pass through the box. */
  readonly laneIds: readonly string[];
  /** Lanes immediately beyond the box; defaults to `laneIds`. */
  readonly exitLaneIds?: readonly string[];
  /** How far beyond the polygon an occupied exit counts as blocked. */
  readonly exitClearanceM?: number;
}

interface NormalizedBoxJunction {
  id: string;
  polygon: SimulationPoint[];
  laneIds: string[];
  exitLaneIds: string[];
  exitClearanceM: number;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Returns whether a signed restriction window is active at the fixed scenario time. */
export function isRestrictionWindowActive(
  clock: ScenarioClock,
  window: RestrictionWindow,
): boolean {
  if (
    !Number.isFinite(clock.minutesAfterMidnight) ||
    clock.minutesAfterMidnight < 0 ||
    clock.minutesAfterMidnight >= 24 * 60 ||
    !Number.isFinite(window.startMinutes) ||
    !Number.isFinite(window.endMinutes)
  ) {
    return false;
  }
  const start = clamp(window.startMinutes, 0, 24 * 60);
  const end = clamp(window.endMinutes, 0, 24 * 60);
  const todayIsSigned = window.weekdays.includes(clock.weekday);
  if (start === end) return todayIsSigned;
  if (start < end) {
    return todayIsSigned && clock.minutesAfterMidnight >= start && clock.minutesAfterMidnight < end;
  }

  // Overnight restrictions start on the signed weekday and remain active after
  // midnight on the following day.
  const weekdayIndex = WEEKDAYS.indexOf(clock.weekday);
  const previousWeekday = WEEKDAYS[(weekdayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length];
  return (
    (todayIsSigned && clock.minutesAfterMidnight >= start) ||
    (window.weekdays.includes(previousWeekday) && clock.minutesAfterMidnight < end)
  );
}

export function isLaneRestrictionActive(
  restriction: LaneRestriction,
  clock: ScenarioClock | null | undefined,
): boolean {
  return Boolean(
    clock &&
      restriction.activeWindows.some((window) =>
        isRestrictionWindowActive(clock, window),
      ),
  );
}

export interface RoadRuleMonitorConfig {
  readonly trafficSide: TrafficSide;
  readonly scenarioClock: ScenarioClock | null;
}

export class RoadRuleMonitor {
  private readonly roadNetwork: RoadNetwork;
  private readonly trafficSystem: TrafficSystem;
  private readonly playerState: PlayerPhysicsState;
  private readonly config: RoadRuleMonitorConfig;
  private readonly laneRestrictions: LaneRestriction[];
  private readonly boxJunctions: NormalizedBoxJunction[];

  private wrongWaySeconds = 0;
  private offRoadSeconds = 0;
  private speedingSeconds = 0;
  private followingSeconds = 0;
  private passingLaneSeconds = 0;
  private readonly stopApproachSpeeds = new Map<string, number>();
  private readonly restrictedLaneSeconds = new Map<string, number>();

  constructor(
    laneRestrictionsConfig: readonly LaneRestriction[],
    boxJunctionsConfig: readonly SimulationBoxJunctionDefinition[],
    roadNetwork: RoadNetwork,
    trafficSystem: TrafficSystem,
    playerState: PlayerPhysicsState,
    config: RoadRuleMonitorConfig,
  ) {
    this.roadNetwork = roadNetwork;
    this.trafficSystem = trafficSystem;
    this.playerState = playerState;
    this.config = config;
    this.laneRestrictions = laneRestrictionsConfig
      .filter((restriction) => this.roadNetwork.lanesById.has(restriction.laneId))
      .map((restriction) => ({
        ...restriction,
        activeWindows: restriction.activeWindows.map((window) => ({
          ...window,
          weekdays: [...window.weekdays],
        })),
      }));
    this.boxJunctions = boxJunctionsConfig
      .filter(
        (junction) =>
          junction.polygon.length >= 3 &&
          junction.laneIds.some((laneId) => this.roadNetwork.lanesById.has(laneId)),
      )
      .map((junction) => ({
        ...junction,
        polygon: junction.polygon.map((point) => ({ ...point })),
        laneIds: junction.laneIds.filter((laneId) => this.roadNetwork.lanesById.has(laneId)),
        exitLaneIds: (junction.exitLaneIds ?? junction.laneIds).filter((laneId) =>
          this.roadNetwork.lanesById.has(laneId),
        ),
        exitClearanceM: clamp(junction.exitClearanceM ?? 12, 3, 40),
      }));
  }

  /** Clears every accumulator and per-id map — called by
   * `SimulationCore.reset()` and `restoreSpawnPose()`. Authored lane
   * restrictions and box junctions are construction-time data and are not
   * touched here, matching the pre-split code (neither was ever reset). */
  reset(): void {
    this.wrongWaySeconds = 0;
    this.offRoadSeconds = 0;
    this.speedingSeconds = 0;
    this.followingSeconds = 0;
    this.passingLaneSeconds = 0;
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
  }

  /** Matches the pre-split `this.stopApproachSpeeds.clear();
   * this.restrictedLaneSeconds.clear();` inside `SimulationCore.dispose()` —
   * deliberately narrower than `reset()`: the original `dispose()` never
   * zeroed the accumulator seconds, only released the two maps. */
  dispose(): void {
    this.stopApproachSpeeds.clear();
    this.restrictedLaneSeconds.clear();
  }

  monitorRoadRules(
    deltaSeconds: number,
    ctx: TrafficTickCtx,
    emitEvent: EmitEventFn,
    onHonk: (npcId: string) => void,
  ): void {
    const projection = ctx.roadState.projection;
    const speed = Math.abs(this.playerState.signedSpeedMps);

    if (ctx.roadState.wrongWay && speed > 1.4) {
      this.wrongWaySeconds += deltaSeconds;
    } else {
      this.wrongWaySeconds = Math.max(0, this.wrongWaySeconds - deltaSeconds * 2);
    }
    if (this.wrongWaySeconds >= 2) {
      emitEvent({
        code: "wrong_way",
        correction: `Keep to the ${this.config.trafficSide} and follow the direction shown by the lane arrows.`,
        evidence: {
          sustainedSeconds: Math.round(this.wrongWaySeconds * 10) / 10,
        },
      });
    }

    if (ctx.roadState.offRoad) this.offRoadSeconds += deltaSeconds;
    else this.offRoadSeconds = Math.max(0, this.offRoadSeconds - deltaSeconds * 2);
    if (this.offRoadSeconds >= 0.8) {
      emitEvent({
        code: "out_of_bounds",
        correction:
          "Slow down, steer smoothly, and remain between the lane boundaries.",
        evidence: {
          offRoadSeconds: Math.round(this.offRoadSeconds * 10) / 10,
        },
      });
    }

    if (!projection) return;
    const speedingThreshold = Math.max(1.3, projection.lane.speedLimitMps * 0.08);
    if (speed > projection.lane.speedLimitMps + speedingThreshold) {
      this.speedingSeconds += deltaSeconds;
    } else {
      this.speedingSeconds = Math.max(0, this.speedingSeconds - deltaSeconds * 1.5);
    }
    if (this.speedingSeconds >= 2.2) {
      emitEvent({
        code: "speeding",
        correction: "Ease off the accelerator and return smoothly to the posted limit.",
        evidence: {
          speedMps: Math.round(speed * 10) / 10,
          limitMps: Math.round(projection.lane.speedLimitMps * 10) / 10,
        },
      });
      this.speedingSeconds = 0;
    }

    this.monitorFollowingDistance(projection, deltaSeconds, ctx, emitEvent);
    this.monitorPassingLane(projection, deltaSeconds, emitEvent, onHonk);
  }

  checkBoxJunctions(
    previousPlayer: SimulationPoint,
    ctx: TrafficTickCtx,
    emitEvent: EmitEventFn,
  ): void {
    const projection = ctx.roadState.projection;
    if (!projection || Math.abs(this.playerState.signedSpeedMps) < 0.5) return;

    for (const junction of this.boxJunctions) {
      if (!junction.laneIds.includes(projection.lane.id)) continue;
      const entered =
        !isPointInPolygon(previousPlayer, junction.polygon) &&
        isPointInPolygon(this.playerState.player, junction.polygon);
      if (!entered) continue;

      const blockingNpc = this.findBlockedBoxExit(junction, projection);
      if (!blockingNpc) continue;
      const clearance = junction.exitClearanceM ?? 12;
      emitEvent({
        code: "box_junction",
        correction:
          "Wait before the box until there is enough room to clear it completely.",
        evidence: {
          junctionId: junction.id,
          laneId: projection.lane.id,
          blockingVehicleId: blockingNpc.id,
          exitClearanceM: Math.round(clearance * 10) / 10,
          speedMps: Math.round(Math.abs(this.playerState.signedSpeedMps) * 10) / 10,
        },
      });
    }
  }

  private findBlockedBoxExit(
    junction: NormalizedBoxJunction,
    playerProjection: LaneProjection,
  ): NpcInternal | null {
    const exitLaneIds = junction.exitLaneIds?.length ? junction.exitLaneIds : junction.laneIds;
    const clearance = junction.exitClearanceM ?? 12;
    for (const npc of this.trafficSystem.npcs) {
      if (!npc.active) continue;
      if (!exitLaneIds.includes(npc.laneId)) continue;
      if (distanceToPolygon(npc, junction.polygon) > clearance) continue;
      if (npc.laneId === playerProjection.lane.id) {
        const gap = this.roadNetwork.distanceAhead(
          playerProjection.lane,
          playerProjection.distanceAlong,
          npc.distance,
        );
        if (gap > 0.5 && gap <= clearance + 24) return npc;
        continue;
      }
      return npc;
    }
    return null;
  }

  monitorRestrictedLanes(deltaSeconds: number, ctx: TrafficTickCtx, emitEvent: EmitEventFn): void {
    const projection = ctx.roadState.projection;
    const clock = this.config.scenarioClock;
    for (const restriction of this.laneRestrictions) {
      const usingRestrictedLane =
        Boolean(clock) &&
        projection?.lane.id === restriction.laneId &&
        projection.distance <= projection.lane.width / 2 + 0.75 &&
        Math.abs(this.playerState.signedSpeedMps) >= 0.8 &&
        isLaneRestrictionActive(restriction, clock);
      const sustainedSeconds = usingRestrictedLane
        ? (this.restrictedLaneSeconds.get(restriction.id) ?? 0) + deltaSeconds
        : 0;
      this.restrictedLaneSeconds.set(restriction.id, sustainedSeconds);
      if (sustainedSeconds < 2.5 || !clock) continue;

      const activeWindow = restriction.activeWindows.find((window) =>
        isRestrictionWindowActive(clock, window),
      );
      emitEvent({
        code: "restricted_lane",
        correction:
          "Read the signed operating times and move into a general-traffic lane when it is safe.",
        evidence: {
          restrictionId: restriction.id,
          laneId: restriction.laneId,
          weekday: clock.weekday,
          scenarioTime: clock.label,
          sourceReferenceId: restriction.sourceReferenceId,
          sustainedSeconds: 2.5,
          activeWindow: activeWindow
            ? `${activeWindow.startMinutes}-${activeWindow.endMinutes}`
            : "unknown",
        },
      });
      this.restrictedLaneSeconds.set(restriction.id, 0);
    }
  }

  private monitorFollowingDistance(
    projection: LaneProjection,
    deltaSeconds: number,
    ctx: TrafficTickCtx,
    emitEvent: EmitEventFn,
  ): void {
    const speed = Math.abs(this.playerState.signedSpeedMps);
    if (speed < 2 || projection.distance > projection.lane.width) {
      this.followingSeconds = 0;
      return;
    }
    const gap = this.trafficSystem.leadVehicleGap(projection.lane, projection.distanceAlong, ctx);
    const safeGap = Math.max(6, speed * 1.5);
    if (gap !== null && gap < safeGap) this.followingSeconds += deltaSeconds;
    else this.followingSeconds = Math.max(0, this.followingSeconds - deltaSeconds * 2);

    if (this.followingSeconds >= 1.8 && gap !== null) {
      emitEvent({
        code: "following_distance",
        correction: "Brake gently and rebuild at least a two-second gap.",
        evidence: {
          gapM: Math.round(gap * 10) / 10,
          recommendedGapM: Math.round(safeGap * 10) / 10,
        },
      });
      this.followingSeconds = 0;
    }
  }

  // No TrafficTickCtx here: unlike monitorFollowingDistance, this needs
  // neither leadVehicleGap's roadState nor any other volatile field —
  // followingNpc and isPlayerLaneChangeClear both resolve entirely from
  // this.trafficSystem's own captured state.
  private monitorPassingLane(
    projection: LaneProjection,
    deltaSeconds: number,
    emitEvent: EmitEventFn,
    onHonk: (npcId: string) => void,
  ): void {
    const speed = Math.abs(this.playerState.signedSpeedMps);
    const lane = projection.lane;
    const follower = this.trafficSystem.followingNpc(lane, projection.distanceAlong);
    const adjacent = lane.adjacentLaneId
      ? this.roadNetwork.lanesById.get(lane.adjacentLaneId)
      : undefined;
    const safeOpportunity = adjacent
      ? this.trafficSystem.isPlayerLaneChangeClear(adjacent, projection.distanceAlong / lane.length)
      : false;
    const obstructing =
      lane.role === "passing" &&
      speed > 2 &&
      speed < lane.speedLimitMps * 0.82 &&
      follower !== null &&
      follower.gap < 34 &&
      follower.npc.speedMps > speed + 0.8 &&
      safeOpportunity;

    if (obstructing) this.passingLaneSeconds += deltaSeconds;
    else this.passingLaneSeconds = Math.max(0, this.passingLaneSeconds - deltaSeconds * 2);

    if (this.passingLaneSeconds >= 4 && follower) {
      const emitted = emitEvent({
        code: "lane_misuse",
        correction: "When the adjacent travel lane is clear, signal and move back. Do not exceed the speed limit.",
        evidence: {
          passingSide: this.config.trafficSide === "right" ? "left" : "right",
          followerGapM: Math.round(follower.gap * 10) / 10,
          safeReturnAvailable: true,
        },
      });
      if (emitted) {
        onHonk(follower.npc.id);
      }
      this.passingLaneSeconds = 0;
    }
  }

  checkStopLines(
    previousProjection: LaneProjection | null,
    currentProjection: LaneProjection | null,
    ctx: TrafficTickCtx,
    emitEvent: EmitEventFn,
  ): void {
    if (!currentProjection) return;
    const laneStopLines = this.roadNetwork.stopLinesByLaneId.get(currentProjection.lane.id);
    if (!laneStopLines) return;
    const speed = Math.abs(this.playerState.signedSpeedMps);
    for (const stopLine of laneStopLines) {
      const distanceAhead = stopLine.distance - currentProjection.distanceAlong;
      if (distanceAhead >= 0 && distanceAhead <= 14) {
        const previousMinimum = this.stopApproachSpeeds.get(stopLine.id) ?? Number.POSITIVE_INFINITY;
        this.stopApproachSpeeds.set(stopLine.id, Math.min(previousMinimum, speed));
      }
      if (
        !previousProjection ||
        previousProjection.lane.id !== currentProjection.lane.id ||
        previousProjection.distanceAlong >= stopLine.distance ||
        currentProjection.distanceAlong < stopLine.distance ||
        currentProjection.distanceAlong - previousProjection.distanceAlong > 8
      ) {
        continue;
      }

      if (
        (stopLine.kind === "traffic_light" || stopLine.kind === "railway") &&
        stopLine.trafficLightId
      ) {
        const light = this.roadNetwork.trafficLightsById.get(stopLine.trafficLightId);
        const lightState = light
          ? this.roadNetwork.trafficLightTiming(light, ctx.elapsedSeconds).state
          : "green";
        const signalRequiresStop = stopLine.kind === "railway"
          ? lightState !== "green"
          : isRedSignalState(lightState);
        if (stopLine.kind === "railway") {
          const minimumSpeed = this.stopApproachSpeeds.get(stopLine.id) ?? speed;
          if (signalRequiresStop || minimumSpeed > 0.35) {
            emitEvent({
              code: "railway_crossing",
              correction:
                "Stop before the line, check that the tracks and exit are clear, then cross without stopping on the rails.",
              evidence: {
                trafficLightId: light?.id ?? "unknown",
                warningActive: signalRequiresStop,
                minimumApproachSpeedMps: Math.round(minimumSpeed * 10) / 10,
              },
            });
          }
        } else if (signalRequiresStop && light) {
          emitEvent({
            code: "red_light",
            correction: "Stop before the line and wait for a green signal.",
            evidence: {
              trafficLightId: light.id,
              speedMps: Math.round(speed * 10) / 10,
            },
          });
        }
      } else if (stopLine.kind === "stop") {
        const minimumSpeed = this.stopApproachSpeeds.get(stopLine.id) ?? speed;
        if (minimumSpeed > 0.35) {
          emitEvent({
            code: "incomplete_stop",
            correction: "Stop fully before the line, check for conflicts, then proceed.",
            evidence: { minimumApproachSpeedMps: Math.round(minimumSpeed * 10) / 10 },
          });
        }
      } else if (stopLine.kind === "yield") {
        const conflictRadius = stopLine.conflictRadius ?? 12;
        const linePose = this.roadNetwork.pointOnLane(currentProjection.lane, stopLine.distance);
        const conflictingNpc = this.trafficSystem.npcs.find(
          (npc) =>
            npc.active &&
            distanceSquared(npc, linePose) < conflictRadius * conflictRadius,
        );
        if (conflictingNpc && speed > 1.5) {
          emitEvent({
            code: "unsafe_gap",
            correction: "Reduce speed, observe the conflict area, and wait for a larger gap.",
            evidence: { conflictingVehicleId: conflictingNpc.id, speedMps: Math.round(speed * 10) / 10 },
          });
        }
      }

      const signal: TurnSignal = this.playerState.signal;
      if (stopLine.turnDirection && signal !== stopLine.turnDirection) {
        emitEvent({
          code: "missing_indicator",
          correction: "Signal early enough for other road users to understand your intention.",
          evidence: { expectedSignal: stopLine.turnDirection, actualSignal: signal },
        });
      }
      this.stopApproachSpeeds.delete(stopLine.id);
    }
  }
}
