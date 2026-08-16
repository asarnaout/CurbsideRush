import {
  Color3,
  Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBox, createCylinder, setMeshMaterial } from "./meshPrimitives";
import { polylineLengthM, polylinePoseAt } from "../geometry/railGeometry";
import {
  railTrainStatesAt,
  type SimulationRailLine,
} from "../simulation/railSchedule";
import type { GameCanvasMapPack } from "../sessionContract";

/**
 * The trains themselves — procedural, from primitives, per the repo's own
 * "bespoke shapes stay procedural" convention (the imported Kenney CC0 train
 * kit was evaluated and declined: its charming chibi proportions — a 2.7 m
 * near-cube per car — read as toys beside this game's proportioned traffic).
 *
 * A consist is a recipe (`RailConsist`): car kind, count, livery. Poses are
 * a pure function of simulation time via `railSchedule.ts` — the SAME
 * function the crossings' warning windows derive from, so the barriers and
 * the train can never disagree. The session steps poses on the fixed tick
 * (pose pair) and blends them at render rate, the NPC-vehicle pattern.
 */

type RailLineContent = NonNullable<
  GameCanvasMapPack["geometry"]["railLines"]
>[number];

interface CarPose {
  x: number;
  z: number;
  heading: number;
}

interface CarRig {
  readonly root: TransformNode;
  readonly prev: CarPose;
  readonly curr: CarPose;
  active: boolean;
  hasPose: boolean;
}

export const RAIL_CAR_GAP_M = 0.6;

export function railCarLengthM(kind: RailLineContent["consist"]["kind"]): number {
  switch (kind) {
    case "tram":
      return 12.2;
    case "emu":
      return 15;
    case "diesel_freight":
      return 12.6;
  }
}

/** Total consist length the recipe implies — held against the schedule's
 * `trainLengthM` by tests/railCorridors.test.ts. */
export function railConsistLengthM(consist: RailLineContent["consist"]): number {
  const carLength = railCarLengthM(consist.kind);
  return consist.cars * carLength + (consist.cars - 1) * RAIL_CAR_GAP_M;
}

const CAR_WIDTH_M = 2.55;
const RAIL_TOP_Y = 0.2;

function hexToColor3(hex: string, fallback: Color3): Color3 {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fallback;
  const value = parseInt(match[1], 16);
  return new Color3(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

interface TrainMaterials {
  readonly body: StandardMaterial;
  readonly accent: StandardMaterial;
  readonly glass: StandardMaterial;
  readonly under: StandardMaterial;
  readonly roof: StandardMaterial;
  readonly lamp: StandardMaterial;
}

function makeTrainMaterials(
  scene: Scene,
  lineId: string,
  consist: RailLineContent["consist"],
): TrainMaterials {
  const make = (suffix: string, color: Color3): StandardMaterial => {
    const material = new StandardMaterial(`train-${lineId}-${suffix}`, scene);
    material.diffuseColor = color;
    material.specularColor = new Color3(0.04, 0.04, 0.04);
    return material;
  };
  const body = make("body", hexToColor3(consist.liveryHex, new Color3(0.3, 0.5, 0.4)));
  const accent = make(
    "accent",
    hexToColor3(consist.accentHex ?? "#e8e2d2", new Color3(0.9, 0.88, 0.82)),
  );
  const glass = make("glass", new Color3(0.07, 0.1, 0.14));
  glass.emissiveColor = new Color3(0.16, 0.2, 0.26);
  const under = make("under", new Color3(0.12, 0.12, 0.13));
  const roof = make("roof", new Color3(0.42, 0.44, 0.46));
  const lamp = make("lamp", new Color3(1, 0.95, 0.75));
  lamp.emissiveColor = new Color3(0.95, 0.88, 0.6);
  for (const material of [body, accent, glass, under, roof, lamp]) {
    material.freeze();
  }
  return { body, accent, glass, under, roof, lamp };
}

/** One car's meshes under one root, sized per kind. All primitives — a car
 * is under a dozen boxes, and there is at most a handful of cars per map. */
function buildCarMeshes(
  scene: Scene,
  name: string,
  kind: RailLineContent["consist"]["kind"],
  materials: TrainMaterials,
  isLead: boolean,
): TransformNode {
  const root = new TransformNode(name, scene);
  const length = railCarLengthM(kind);
  const add = (
    suffix: string,
    size: { width: number; height: number; depth: number },
    position: Vector3,
    material: StandardMaterial,
  ): Mesh => {
    const mesh = createBox(scene, `${name}-${suffix}`, size, position, material);
    mesh.parent = root;
    mesh.isPickable = false;
    setMeshMaterial(mesh, material, false);
    return mesh;
  };
  // Local +x runs along the car (matches boxLengthYaw convention).
  if (kind === "diesel_freight" && !isLead) {
    // Freight wagon: low bed, tall box body, no glazing.
    add("bed", { width: length, height: 0.5, depth: CAR_WIDTH_M }, new Vector3(0, RAIL_TOP_Y + 0.65, 0), materials.under);
    add("bodybox", { width: length - 1.4, height: 2.4, depth: CAR_WIDTH_M - 0.15 }, new Vector3(0, RAIL_TOP_Y + 2.1, 0), materials.body);
    add("roofline", { width: length - 1.4, height: 0.18, depth: CAR_WIDTH_M - 0.35 }, new Vector3(0, RAIL_TOP_Y + 3.35, 0), materials.roof);
    return root;
  }
  const bodyHeight = kind === "diesel_freight" ? 2.5 : 2.15;
  const bodyCenterY = RAIL_TOP_Y + 0.95 + bodyHeight / 2;
  // Undercarriage + skirt.
  add("under", { width: length - 1.1, height: 0.62, depth: CAR_WIDTH_M - 0.5 }, new Vector3(0, RAIL_TOP_Y + 0.62, 0), materials.under);
  // Main body shell.
  add("body", { width: length, height: bodyHeight, depth: CAR_WIDTH_M }, new Vector3(0, bodyCenterY, 0), materials.body);
  if (kind === "diesel_freight") {
    // Locomotive: long hood + raised cab at the rear third.
    add("hood", { width: length * 0.52, height: 0.9, depth: CAR_WIDTH_M - 0.35 }, new Vector3(-length * 0.16, bodyCenterY + bodyHeight / 2 + 0.45, 0), materials.body);
    add("cab", { width: length * 0.26, height: 1.35, depth: CAR_WIDTH_M - 0.1 }, new Vector3(length * 0.26, bodyCenterY + bodyHeight / 2 + 0.67, 0), materials.accent);
    add("cab-glass", { width: length * 0.27, height: 0.62, depth: CAR_WIDTH_M - 0.04 }, new Vector3(length * 0.26, bodyCenterY + bodyHeight / 2 + 0.8, 0), materials.glass);
  } else {
    // Passenger glazing: a continuous window band proud of the shell.
    add("glass", { width: length - 1.6, height: 0.85, depth: CAR_WIDTH_M + 0.06 }, new Vector3(0, bodyCenterY + 0.42, 0), materials.glass);
    // Livery accent band under the windows.
    add("band", { width: length + 0.04, height: 0.34, depth: CAR_WIDTH_M + 0.04 }, new Vector3(0, bodyCenterY - 0.35, 0), materials.accent);
    // Door pillars break the band rhythm — two per side read as doors.
    for (const doorX of [-length * 0.28, length * 0.28]) {
      add(`door-${doorX.toFixed(0)}`, { width: 1.25, height: bodyHeight - 0.12, depth: CAR_WIDTH_M + 0.08 }, new Vector3(doorX, bodyCenterY, 0), materials.accent);
    }
  }
  // Roof cap.
  add("roof", { width: length - 0.5, height: 0.32, depth: CAR_WIDTH_M - 0.5 }, new Vector3(0, bodyCenterY + bodyHeight / 2 + (kind === "diesel_freight" ? 1.35 : 0.16), 0), materials.roof);
  // End lamps.
  for (const endX of [-length / 2 + 0.12, length / 2 - 0.12]) {
    for (const lampZ of [-0.75, 0.75]) {
      add(`lamp-${endX > 0 ? "f" : "r"}-${lampZ > 0 ? "l" : "r"}`, { width: 0.14, height: 0.22, depth: 0.34 }, new Vector3(endX, RAIL_TOP_Y + 1.35, lampZ), materials.lamp);
    }
  }
  if (isLead && kind !== "diesel_freight") {
    // Pantograph on the lead car: two raked struts and a head bar.
    const base = new Vector3(0, bodyCenterY + bodyHeight / 2 + 0.35, 0);
    for (const side of [-0.55, 0.55]) {
      const strut = createCylinder(
        scene,
        `${name}-panto-${side > 0 ? "l" : "r"}`,
        { height: 1.15, diameter: 0.09 },
        new Vector3(base.x + side * 0.9, base.y + 0.5, base.z),
        materials.under,
      );
      strut.rotation.z = side > 0 ? -0.5 : 0.5;
      strut.parent = root;
      strut.isPickable = false;
    }
    add("panto-head", { width: 0.16, height: 0.08, depth: 1.9 }, new Vector3(0, base.y + 1.0, 0), materials.roof);
  }
  return root;
}

export interface TrainCarObstacle {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfU: number;
  readonly halfV: number;
}

export class TrainVisual {
  private readonly simLine: SimulationRailLine;
  private readonly points: RailLineContent["points"];
  private readonly carLengthM: number;
  private readonly carsPerTrain: number;
  private readonly rigs: CarRig[] = [];
  private readonly speedMps: number;
  private readonly elevationM: number;

  constructor(scene: Scene, line: RailLineContent) {
    this.points = line.points;
    this.elevationM = line.elevationM ?? 0;
    this.simLine = {
      id: line.id,
      lengthM: polylineLengthM(line.points),
      schedule: line.schedule,
    };
    this.speedMps = line.schedule.speedMps;
    this.carLengthM = railCarLengthM(line.consist.kind);
    this.carsPerTrain = Math.max(1, line.consist.cars);
    const materials = makeTrainMaterials(scene, line.id, line.consist);
    // A shuttle is one consist; a through line can have one per direction on
    // the map at once. Rigs beyond the live set stay disabled.
    const maxTrains = line.schedule.mode === "through" ? 2 : 1;
    for (let train = 0; train < maxTrains; train += 1) {
      for (let car = 0; car < this.carsPerTrain; car += 1) {
        const root = buildCarMeshes(
          scene,
          `train-${line.id}-${train}-${car}`,
          line.consist.kind,
          materials,
          car === 0,
        );
        root.setEnabled(false);
        this.rigs.push({
          root,
          prev: { x: 0, z: 0, heading: 0 },
          curr: { x: 0, z: 0, heading: 0 },
          active: false,
          hasPose: false,
        });
      }
    }
  }

  /** Fixed-tick pose update from simulation time — pure via railSchedule. */
  stepPose(elapsedSeconds: number): void {
    const states = railTrainStatesAt(this.simLine, elapsedSeconds);
    let rigIndex = 0;
    for (const state of states) {
      for (let car = 0; car < this.carsPerTrain && rigIndex < this.rigs.length; car += 1) {
        const rig = this.rigs[rigIndex];
        rigIndex += 1;
        const centerM =
          state.frontM -
          state.direction * (car * (this.carLengthM + RAIL_CAR_GAP_M) + this.carLengthM / 2);
        if (centerM < -this.carLengthM || centerM > this.simLine.lengthM + this.carLengthM) {
          rig.active = false;
          continue;
        }
        const pose = polylinePoseAt(this.points, centerM);
        const heading =
          pose.headingRad + (state.direction < 0 ? Math.PI : 0);
        if (!rig.hasPose || !rig.active) {
          rig.prev.x = pose.x;
          rig.prev.z = pose.z;
          rig.prev.heading = heading;
        } else {
          rig.prev.x = rig.curr.x;
          rig.prev.z = rig.curr.z;
          rig.prev.heading = rig.curr.heading;
        }
        rig.curr.x = pose.x;
        rig.curr.z = pose.z;
        rig.curr.heading = heading;
        rig.active = true;
        rig.hasPose = true;
      }
    }
    for (; rigIndex < this.rigs.length; rigIndex += 1) {
      this.rigs[rigIndex].active = false;
    }
    for (const rig of this.rigs) {
      if (rig.root.isEnabled() !== rig.active) rig.root.setEnabled(rig.active);
    }
  }

  /** Render-rate blend between the last two fixed poses. */
  interpolate(alpha: number): void {
    const blend = Math.min(1, Math.max(0, alpha));
    for (const rig of this.rigs) {
      if (!rig.active) continue;
      const x = rig.prev.x + (rig.curr.x - rig.prev.x) * blend;
      const z = rig.prev.z + (rig.curr.z - rig.prev.z) * blend;
      let dh = rig.curr.heading - rig.prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const heading = rig.prev.heading + dh * blend;
      rig.root.position.set(x, this.elevationM, z);
      // polylinePoseAt heading is atan2(dx, dz); car length runs local +x,
      // so the yaw that aligns +x with (dx, dz) is heading - PI/2 in
      // Babylon's rotation.y frame (see boxLengthYaw).
      rig.root.rotation.y = heading - Math.PI / 2;
    }
  }

  /** Live car footprints for the player-collision check, in OBB form.
   * An elevated line's train flies over the streets — nothing to hit. */
  carObstacles(): TrainCarObstacle[] {
    if (this.elevationM > 2) return [];
    const result: TrainCarObstacle[] = [];
    for (const rig of this.rigs) {
      if (!rig.active) continue;
      const ux = Math.sin(rig.curr.heading);
      const uz = Math.cos(rig.curr.heading);
      result.push({
        x: rig.curr.x,
        z: rig.curr.z,
        ux,
        uz,
        halfU: this.carLengthM / 2,
        halfV: CAR_WIDTH_M / 2,
      });
    }
    return result;
  }

  trainSpeedMps(): number {
    return this.speedMps;
  }

  dispose(): void {
    for (const rig of this.rigs) {
      rig.root.dispose(false, true);
    }
    this.rigs.length = 0;
  }
}
