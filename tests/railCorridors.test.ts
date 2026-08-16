import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import { buildSimulationCoreConfig } from "../app/game/simulationAdapter";
import { railConsistLengthM } from "../app/game/render/trainRender";
import {
  polylineLengthM,
  RAIL_GATE_BARRIER_LENGTH_M,
  RAIL_GAUGE_CLEAR_M,
  railGateArmDirection,
} from "../app/game/geometry/railGeometry";
import {
  railCyclePeriodSeconds,
  railTrainStatesAt,
} from "../app/game/simulation/railSchedule";
import type { StaticObstacle, WorldPoint } from "../app/game/types";

/**
 * The rail right-of-way guarantee: for every authored rail line, nothing
 * solid stands on the corridor, every road that crosses it carries a level
 * crossing, and every water crossing rides a bridge span. This runs against
 * the REAL static-collision world (`buildSimulationCoreConfig`), so it
 * covers planned buildings, venue lots, service furniture, landmark solids
 * and park walls alike — whatever the generators or a future map edit
 * produce. See `geometry/railCorridor.ts` for the carver this verifies.
 */

interface Quad {
  readonly points: readonly WorldPoint[];
}

function corridorQuads(
  points: readonly WorldPoint[],
  halfWidth: number,
): Quad[] {
  const quads: Quad[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const nx = (-(b.z - a.z) / length) * halfWidth;
    const nz = ((b.x - a.x) / length) * halfWidth;
    quads.push({
      points: [
        { x: a.x + nx, z: a.z + nz },
        { x: b.x + nx, z: b.z + nz },
        { x: b.x - nx, z: b.z - nz },
        { x: a.x - nx, z: a.z - nz },
      ],
    });
  }
  return quads;
}

function polygonsOverlap(
  left: readonly WorldPoint[],
  right: readonly WorldPoint[],
): boolean {
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const p1 = polygon[index];
      const p2 = polygon[(index + 1) % polygon.length];
      const axisX = -(p2.z - p1.z);
      const axisZ = p2.x - p1.x;
      let minLeft = Number.POSITIVE_INFINITY;
      let maxLeft = Number.NEGATIVE_INFINITY;
      let minRight = Number.POSITIVE_INFINITY;
      let maxRight = Number.NEGATIVE_INFINITY;
      for (const p of left) {
        const projection = axisX * p.x + axisZ * p.z;
        minLeft = Math.min(minLeft, projection);
        maxLeft = Math.max(maxLeft, projection);
      }
      for (const p of right) {
        const projection = axisX * p.x + axisZ * p.z;
        minRight = Math.min(minRight, projection);
        maxRight = Math.max(maxRight, projection);
      }
      if (maxLeft < minRight || maxRight < minLeft) return false;
    }
  }
  return true;
}

function obstaclePolygon(obstacle: StaticObstacle): readonly WorldPoint[] | null {
  switch (obstacle.kind) {
    case "aabb":
      return [
        { x: obstacle.minX, z: obstacle.minZ },
        { x: obstacle.maxX, z: obstacle.minZ },
        { x: obstacle.maxX, z: obstacle.maxZ },
        { x: obstacle.minX, z: obstacle.maxZ },
      ];
    case "obb": {
      const vx = -obstacle.uz;
      const vz = obstacle.ux;
      return [
        {
          x: obstacle.x + obstacle.ux * obstacle.halfU + vx * obstacle.halfV,
          z: obstacle.z + obstacle.uz * obstacle.halfU + vz * obstacle.halfV,
        },
        {
          x: obstacle.x - obstacle.ux * obstacle.halfU + vx * obstacle.halfV,
          z: obstacle.z - obstacle.uz * obstacle.halfU + vz * obstacle.halfV,
        },
        {
          x: obstacle.x - obstacle.ux * obstacle.halfU - vx * obstacle.halfV,
          z: obstacle.z - obstacle.uz * obstacle.halfU - vz * obstacle.halfV,
        },
        {
          x: obstacle.x + obstacle.ux * obstacle.halfU - vx * obstacle.halfV,
          z: obstacle.z + obstacle.uz * obstacle.halfU - vz * obstacle.halfV,
        },
      ];
    }
    case "convex":
      return obstacle.points;
    case "circle":
      return null;
  }
}

function circleTouchesQuad(
  quad: Quad,
  x: number,
  z: number,
  radius: number,
): boolean {
  // Inside test via SAT with a degenerate polygon, then edge distances.
  if (polygonsOverlap(quad.points, [{ x, z }, { x: x + 1e-4, z }, { x, z: z + 1e-4 }])) {
    return true;
  }
  for (let index = 0; index < quad.points.length; index += 1) {
    const a = quad.points[index];
    const b = quad.points[(index + 1) % quad.points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (lengthSq || 1)),
    );
    if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) <= radius) return true;
  }
  return false;
}

function distanceAlongAt(
  points: readonly WorldPoint[],
  target: WorldPoint,
): number {
  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let accumulated = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const t = Math.max(
      0,
      Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / (length * length)),
    );
    const distance = Math.hypot(
      target.x - (a.x + dx * t),
      target.z - (a.z + dz * t),
    );
    if (distance < best) {
      best = distance;
      bestAlong = accumulated + length * t;
    }
    accumulated += length;
  }
  return bestAlong;
}

const railWorlds = FREE_DRIVES.flatMap((freeDrive) => {
  const mapPack = getMapPack(freeDrive.mapId);
  const railLines = mapPack.geometry.railLines ?? [];
  if (!railLines.length) return [];
  const country = getCountryProfile(freeDrive.countryId);
  const config = buildSimulationCoreConfig({
    scenario: buildFreeDriveScenario(freeDrive),
    mapPack,
    trafficSide: country.trafficSide,
    speedUnit: country.speedUnit,
  });
  return [{ freeDrive, mapPack, railLines, obstacles: config.staticObstacles ?? [] }];
});

describe("rail corridors", () => {
  it("covers every map that authors a rail line", () => {
    // A sanity pin so the suite cannot silently go vacuous: today only Tokyo
    // ships a line. Grow this list as cities gain theirs.
    expect(railWorlds.map((world) => world.mapPack.id).sort()).toEqual([
      "cairo-central-nile",
      "london-south-kensington",
      "nyc-upper-west-side",
      "tokyo-setagaya",
    ]);
  });

  for (const world of railWorlds) {
    describe(world.mapPack.id, () => {
      it("keeps every solid obstacle off the right-of-way", () => {
        const violations: string[] = [];
        for (const line of world.railLines) {
          const quads = corridorQuads(line.points, line.corridorHalfWidthM);
          // Three structures are allowed INSIDE the corridor — the split
          // shoreline flanks at a drivable bridge mouth, a depot shed's
          // walls, and the bridge girder guards — but nothing, ever, across
          // the running gauge itself.
          const gaugeQuads = corridorQuads(line.points, RAIL_GAUGE_CLEAR_M);
          for (const obstacle of world.obstacles) {
            // The world's outer walls are linear features the corridor
            // legitimately crosses where the line leaves the map. A fully
            // elevated line (London) flies over its banks, so its shoreline
            // stays solid underneath. Everything else beside the track must
            // still clear the running gauge; everything unlisted is a hard
            // zero on the whole corridor.
            if (obstacle.tag === "worldEdge") continue;
            if (obstacle.tag === "shoreline" && line.elevationM) continue;
            if (
              obstacle.tag === "shoreline" ||
              obstacle.tag === "railShed" ||
              obstacle.tag === "railBridge"
            ) {
              const polygon = obstaclePolygon(obstacle);
              if (
                polygon &&
                gaugeQuads.some((quad) => polygonsOverlap(quad.points, polygon))
              ) {
                violations.push(
                  `${line.id}: ${obstacle.tag} ${obstacle.id} crosses the running gauge`,
                );
              }
              continue;
            }
            const polygon = obstaclePolygon(obstacle);
            const hit = polygon
              ? quads.some((quad) => polygonsOverlap(quad.points, polygon))
              : quads.some((quad) =>
                  circleTouchesQuad(
                    quad,
                    (obstacle as { x: number }).x,
                    (obstacle as { z: number }).z,
                    (obstacle as { radius: number }).radius,
                  ),
                );
            if (hit) {
              violations.push(`${line.id}: ${obstacle.tag} ${obstacle.id}`);
            }
          }
        }
        expect(violations).toEqual([]);
      });

      it("sweeps every crossing boom across a carriageway", () => {
        // The lowered barrier must land on the road it guards, not the
        // sidewalk beside it — sixteen generated booms across three cities
        // shipped mis-aimed because the arm direction was implicit in the
        // pole's facing (owner-reported). Uses the same
        // `railGateArmDirection` the renderer rotates the pivot with, so
        // this cannot drift from what is drawn.
        const failures: string[] = [];
        for (const ctl of world.mapPack.laneGraph.controls) {
          for (const inst of ctl.installations ?? []) {
            if (inst.mounting !== "railway_crossing") continue;
            const arm = railGateArmDirection(inst.headingDeg, inst.armHeadingDeg);
            const tipX = inst.position.x + arm.x * RAIL_GATE_BARRIER_LENGTH_M;
            const tipZ = inst.position.z + arm.z * RAIL_GATE_BARRIER_LENGTH_M;
            const onRoad = world.mapPack.geometry.roadSurfaces.some((surface) => {
              for (let index = 0; index < surface.centerline.length - 1; index += 1) {
                const a = surface.centerline[index];
                const b = surface.centerline[index + 1];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const lengthSq = dx * dx + dz * dz;
                if (lengthSq < 1e-9) continue;
                const t = Math.max(
                  0,
                  Math.min(1, ((tipX - a.x) * dx + (tipZ - a.z) * dz) / lengthSq),
                );
                const distance = Math.hypot(
                  tipX - (a.x + dx * t),
                  tipZ - (a.z + dz * t),
                );
                if (distance < surface.widthM / 2 + 0.2) return true;
              }
              return false;
            });
            if (!onRoad) {
              failures.push(
                `${ctl.id} ${inst.id}: boom tip (${tipX.toFixed(1)}, ${tipZ.toFixed(1)}) misses every carriageway`,
              );
            }
          }
        }
        expect(failures).toEqual([]);
      });

      it("never lets two consists co-occupy the single track", () => {
        // Every line is one track. A `through` timetable alternates
        // directions every half-headway, so a half-headway shorter than a
        // full traversal sends opposing trains through each other mid-line
        // (owner-reported in Cairo at headway 210). Sampled empirically over
        // one whole cycle rather than asserted arithmetically, so any future
        // timetable shape inherits the guarantee.
        for (const line of world.railLines) {
          const simLine = {
            id: line.id,
            lengthM: polylineLengthM(line.points),
            schedule: line.schedule,
          };
          const period = railCyclePeriodSeconds(simLine);
          const collisions: string[] = [];
          for (let t = 0; t < period; t += 0.5) {
            const states = railTrainStatesAt(simLine, t);
            for (let a = 0; a < states.length; a += 1) {
              for (let b = a + 1; b < states.length; b += 1) {
                const left = states[a];
                const right = states[b];
                // A dwell/travel boundary instant enumerates the same
                // consist from both motions (at a shuttle reversal even with
                // opposite direction signs) — an identical occupied span is
                // one train, not two. A real head-on pass only ever crosses,
                // so its spans differ at the surrounding samples.
                if (
                  Math.abs(left.occupiedFromM - right.occupiedFromM) < 0.01 &&
                  Math.abs(left.occupiedToM - right.occupiedToM) < 0.01
                ) {
                  continue;
                }
                const overlap =
                  Math.min(left.occupiedToM, right.occupiedToM) -
                  Math.max(left.occupiedFromM, right.occupiedFromM);
                if (overlap > 0.5) {
                  collisions.push(
                    `${line.id} t=${t}: [${left.occupiedFromM.toFixed(0)},${left.occupiedToM.toFixed(0)}] dir ${left.direction} x [${right.occupiedFromM.toFixed(0)},${right.occupiedToM.toFixed(0)}] dir ${right.direction}`,
                  );
                }
              }
            }
          }
          expect(collisions.slice(0, 5)).toEqual([]);
        }
      });

      it("guards both sides of every drivable at-grade bridge span", () => {
        // With the shoreline mouth open (a car may cross the bridge), the
        // girder guards are the only thing between a straying car and the
        // water — so their presence is load-bearing, not dressing.
        for (const line of world.railLines) {
          if (line.elevationM) continue;
          for (const span of (line.elevatedSpans ?? []).filter(
            (candidate) => candidate.kind === "bridge",
          )) {
            const sides = new Set<number>();
            for (const obstacle of world.obstacles) {
              if (obstacle.tag !== "railBridge" || obstacle.kind !== "obb") continue;
              const along = distanceAlongAt(line.points, {
                x: obstacle.x,
                z: obstacle.z,
              });
              if (along < span.startM - 5 || along > span.endM + 5) continue;
              // Signed side of the line at the obstacle's own station.
              let bestDistance = Number.POSITIVE_INFINITY;
              let side = 0;
              for (let index = 0; index < line.points.length - 1; index += 1) {
                const a = line.points[index];
                const b = line.points[index + 1];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const lengthSq = dx * dx + dz * dz;
                if (lengthSq < 1e-9) continue;
                const t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((obstacle.x - a.x) * dx + (obstacle.z - a.z) * dz) / lengthSq,
                  ),
                );
                const distance = Math.hypot(
                  obstacle.x - (a.x + dx * t),
                  obstacle.z - (a.z + dz * t),
                );
                if (distance < bestDistance) {
                  bestDistance = distance;
                  side = Math.sign(
                    dx * (obstacle.z - a.z) - dz * (obstacle.x - a.x),
                  );
                }
              }
              if (side !== 0) sides.add(side);
            }
            expect(
              [...sides].sort(),
              `${line.id} span ${span.startM}-${span.endM} must carry a guard on each side`,
            ).toEqual([-1, 1]);
          }
        }
      });

      it("carries a level crossing wherever a road crosses the line at grade", () => {
        const missing: string[] = [];
        for (const line of world.railLines) {
          const elevatedSpans = line.elevatedSpans ?? [];
          const crossingDistances = line.crossingControlIds.flatMap(
            (controlId) => {
              const control = world.mapPack.laneGraph.controls.find(
                (candidate) => candidate.id === controlId,
              );
              return control ? [distanceAlongAt(line.points, control.position)] : [];
            },
          );
          for (const road of world.mapPack.geometry.roadSurfaces) {
            for (let s = 0; s < line.points.length - 1; s += 1) {
              const a = line.points[s];
              const b = line.points[s + 1];
              for (let r = 0; r < road.centerline.length - 1; r += 1) {
                const c = road.centerline[r];
                const d = road.centerline[r + 1];
                const denominator =
                  (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
                if (Math.abs(denominator) < 1e-9) continue;
                const t =
                  ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) /
                  denominator;
                const u =
                  ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) /
                  denominator;
                if (t < 0 || t > 1 || u < 0 || u > 1) continue;
                const crossingPoint = {
                  x: a.x + (b.x - a.x) * t,
                  z: a.z + (b.z - a.z) * t,
                };
                const along = distanceAlongAt(line.points, crossingPoint);
                // A road under a bridge or viaduct threads the structure —
                // no crossing wanted there, only clearance.
                const flownOver = elevatedSpans.some(
                  (span) => along >= span.startM - 1 && along <= span.endM + 1,
                );
                if (flownOver) continue;
                const guarded = crossingDistances.some(
                  (candidate) => Math.abs(candidate - along) < 8,
                );
                if (!guarded) {
                  missing.push(
                    `${line.id} x ${road.id} at (${crossingPoint.x.toFixed(0)}, ${crossingPoint.z.toFixed(0)})`,
                  );
                }
              }
            }
          }
        }
        expect(missing).toEqual([]);
      });

      it("keeps every listed crossing control on the polyline", () => {
        for (const line of world.railLines) {
          for (const controlId of line.crossingControlIds) {
            const control = world.mapPack.laneGraph.controls.find(
              (candidate) => candidate.id === controlId,
            );
            expect(control, `${line.id} names missing control ${controlId}`).toBeDefined();
            expect(control?.type).toBe("railway_signal");
            if (!control) continue;
            let best = Number.POSITIVE_INFINITY;
            for (let index = 0; index < line.points.length - 1; index += 1) {
              const a = line.points[index];
              const b = line.points[index + 1];
              const dx = b.x - a.x;
              const dz = b.z - a.z;
              const lengthSq = dx * dx + dz * dz;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((control.position.x - a.x) * dx +
                    (control.position.z - a.z) * dz) /
                    (lengthSq || 1),
                ),
              );
              best = Math.min(
                best,
                Math.hypot(
                  control.position.x - (a.x + dx * t),
                  control.position.z - (a.z + dz * t),
                ),
              );
            }
            expect(best, `${controlId} sits ${best.toFixed(1)}m off ${line.id}`).toBeLessThan(1.5);
          }
        }
      });

      it("keeps the consist recipe and the schedule's train length in lockstep", () => {
        for (const line of world.railLines) {
          // The crossings time their windows off schedule.trainLengthM; the
          // renderer sizes cars off the consist. If these drift, barriers
          // lift while the visible tail is still on the crossing.
          expect(
            Math.abs(railConsistLengthM(line.consist) - line.schedule.trainLengthM),
            `${line.id}: consist implies ${railConsistLengthM(line.consist)}m, schedule says ${line.schedule.trainLengthM}m`,
          ).toBeLessThan(1.5);
        }
      });

      it("rides a bridge span across every water body it crosses", () => {
        for (const line of world.railLines) {
          const bridges = (line.elevatedSpans ?? []).filter(
            (span) => span.kind === "bridge",
          );
          for (const water of world.mapPack.geometry.waterBodies ?? []) {
            // Collect polyline/water-outline crossings as stations along the
            // line; consecutive pairs are in-water spans.
            const stations: number[] = [];
            let accumulated = 0;
            for (let s = 0; s < line.points.length - 1; s += 1) {
              const a = line.points[s];
              const b = line.points[s + 1];
              const segment = Math.hypot(b.x - a.x, b.z - a.z);
              for (let w = 0; w < water.polygon.length; w += 1) {
                const c = water.polygon[w];
                const d = water.polygon[(w + 1) % water.polygon.length];
                const denominator =
                  (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
                if (Math.abs(denominator) < 1e-9) continue;
                const t =
                  ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) /
                  denominator;
                const u =
                  ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) /
                  denominator;
                if (t < 0 || t > 1 || u < 0 || u > 1) continue;
                stations.push(accumulated + t * segment);
              }
              accumulated += segment;
            }
            stations.sort((left, right) => left - right);
            for (let pair = 0; pair + 1 < stations.length; pair += 2) {
              const from = stations[pair];
              const to = stations[pair + 1];
              const covered = bridges.some(
                (span) => span.startM <= from + 1 && span.endM >= to - 1,
              );
              expect(
                covered,
                `${line.id} crosses ${water.id} over [${from.toFixed(0)}, ${to.toFixed(0)}]m without a bridge span`,
              ).toBe(true);
            }
          }
        }
      });
    });
  }
});
