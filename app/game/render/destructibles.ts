import { Quaternion, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import {
  DESTRUCTIBLE_GRID_CELL_M,
  DESTRUCTIBLE_PROP_CONFIGS,
  PLAYER_CAPSULE_HALF_LENGTH_M,
  PLAYER_CAPSULE_RADIUS_M,
  PROP_MAX_ACTIVE_TOPPLES,
  PROP_TOPPLE_MAX_ANGLE_RAD,
  PROP_TOPPLE_SECONDS,
  type ActivePropFall,
  type DestructibleProp,
  type DestructiblePropPart,
} from "./propCatalog";

/**
 * Street furniture the car can knock over: the broad-phase grid, the capsule
 * collision query against it, and the topple/squash fall animation. Owns the
 * grid and the active-fall list as a collaborator class (WaterLayer's
 * pattern), held as a nullable session field, constructed once near the top
 * of `buildScenarioEnvironment` — before any of the sub-builders that
 * register props into it run.
 *
 * `checkCollisions` and `strike` deliberately stop short of the simulation:
 * the original `strikeDestructiblePropCollisions`/`strikeDestructibleProp`
 * called `this.simulation.reportExternalContact` and `this.audio?.impact`
 * directly, but simulation.ts and the audio layer are exactly what render/
 * must never depend on (ring rule — arrows point inward only). So the
 * decision of whether a contact actually happened (the simulation call, plus
 * its audio and event-processing side effects) stays session-resident,
 * threaded in as the `onContact` callback: it returns whether the strike
 * should animate, and `checkCollisions` only calls `strike` when it does.
 * `emitImpactBurst` is threaded the same way because it's shared well beyond
 * this cargo (vehicle/pedestrian impacts too).
 */
export class Destructibles {
  private readonly grid = new Map<string, DestructibleProp[]>();
  private readonly activeFalls: ActivePropFall[] = [];

  constructor(private readonly scene: Scene) {}

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / DESTRUCTIBLE_GRID_CELL_M)}:${Math.floor(z / DESTRUCTIBLE_GRID_CELL_M)}`;
  }

  /** Enrols a placed prop as knockable. Unknown kinds are silently ignored so
   * a new scatter kind fails soft (indestructible) rather than crashing. */
  register(
    kind: string,
    x: number,
    z: number,
    scale: number,
    parts: readonly DestructiblePropPart[],
  ): void {
    const config = DESTRUCTIBLE_PROP_CONFIGS[kind];
    if (!config || !parts.length) return;
    const prop: DestructibleProp = {
      kind,
      config,
      x,
      z,
      radiusM: config.radiusM * scale,
      parts,
      state: "standing",
    };
    const key = this.cellKey(x, z);
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(prop);
    else this.grid.set(key, [prop]);
  }

  /** The car's two capsule circles against every standing prop nearby. */
  checkCollisions(
    playerX: number,
    playerZ: number,
    playerHeading: number,
    onContact: (prop: DestructibleProp) => boolean,
    emitImpactBurst: (x: number, y: number, z: number, count: number) => void,
  ): void {
    if (this.grid.size === 0) return;
    const forwardX = Math.sin(playerHeading);
    const forwardZ = Math.cos(playerHeading);
    const column = Math.floor(playerX / DESTRUCTIBLE_GRID_CELL_M);
    const row = Math.floor(playerZ / DESTRUCTIBLE_GRID_CELL_M);
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const bucket = this.grid.get(`${column + dc}:${row + dr}`);
        if (!bucket) continue;
        for (const prop of bucket) {
          if (prop.state !== "standing") continue;
          const reach = prop.radiusM + PLAYER_CAPSULE_RADIUS_M;
          let contact = false;
          for (let end = -1; end <= 1 && !contact; end += 2) {
            const cx = playerX + forwardX * PLAYER_CAPSULE_HALF_LENGTH_M * end;
            const cz = playerZ + forwardZ * PLAYER_CAPSULE_HALF_LENGTH_M * end;
            contact = Math.hypot(cx - prop.x, cz - prop.z) < reach;
          }
          if (contact && onContact(prop)) {
            this.strike(prop, playerX, playerZ, playerHeading, emitImpactBurst);
          }
        }
      }
    }
  }

  private strike(
    prop: DestructibleProp,
    playerX: number,
    playerZ: number,
    playerHeading: number,
    emitImpactBurst: (x: number, y: number, z: number, count: number) => void,
  ): void {
    prop.state = "falling";

    // Fall away from the car; a dead-centre hit falls along the travel dir.
    let fallX = prop.x - playerX;
    let fallZ = prop.z - playerZ;
    const fallLength = Math.hypot(fallX, fallZ);
    if (fallLength > 1e-3) {
      fallX /= fallLength;
      fallZ /= fallLength;
    } else {
      fallX = Math.sin(playerHeading);
      fallZ = Math.cos(playerHeading);
    }

    const pivot = new TransformNode(`prop-fall-${prop.kind}`, this.scene);
    pivot.position.set(prop.x, 0, prop.z);
    const poolParts: TransformNode[] = [];
    for (const part of prop.parts) {
      part.node.unfreezeWorldMatrix();
      if (part.isLightPool) {
        poolParts.push(part.node);
        continue;
      }
      part.node.setParent(pivot);
    }
    if (prop.config.fall === "topple") {
      // Rotating about this horizontal axis tips the top toward (fallX, fallZ).
      pivot.rotationQuaternion = Quaternion.Identity();
      pivot.metadata = { axis: new Vector3(fallZ, 0, -fallX) };
    }
    const fall: ActivePropFall = { prop, pivot, poolParts, progress: 0 };
    if (this.activeFalls.length >= PROP_MAX_ACTIVE_TOPPLES) {
      fall.progress = 1;
      this.applyFallPose(fall);
      this.settleFall(fall);
      return;
    }
    this.activeFalls.push(fall);
    emitImpactBurst(prop.x, 0.7, prop.z, prop.config.damage === "none" ? 6 : 14);
  }

  private applyFallPose(fall: ActivePropFall): void {
    const { prop, pivot } = fall;
    // Ease out with a small overshoot so the fall lands with a bounce.
    const t = Math.min(1, fall.progress);
    const eased = 1 - (1 - t) * (1 - t);
    const overshoot = t < 0.72 ? eased * 1.07 : 1.07 - ((t - 0.72) / 0.28) * 0.07;
    if (prop.config.fall === "squash") {
      pivot.scaling.y = 1 - 0.68 * eased;
      pivot.scaling.x = 1 + 0.22 * eased;
      pivot.scaling.z = 1 + 0.22 * eased;
      return;
    }
    const axis = (pivot.metadata as { axis: Vector3 }).axis;
    Quaternion.RotationAxisToRef(
      axis,
      PROP_TOPPLE_MAX_ANGLE_RAD * overshoot,
      pivot.rotationQuaternion!,
    );
    pivot.position.y = -0.06 * eased;
    for (const pool of fall.poolParts) {
      pool.position.y = 0.07 - 1.4 * eased;
    }
  }

  private settleFall(fall: ActivePropFall): void {
    fall.prop.state = "down";
    // Refreeze at the settled pose so the wreckage costs nothing per frame.
    fall.pivot.computeWorldMatrix(true);
    for (const part of fall.prop.parts) {
      part.node.computeWorldMatrix(true);
      part.node.freezeWorldMatrix();
    }
  }

  update(frameSeconds: number): void {
    if (!this.activeFalls.length) return;
    for (let index = this.activeFalls.length - 1; index >= 0; index -= 1) {
      const fall = this.activeFalls[index];
      fall.progress += frameSeconds / PROP_TOPPLE_SECONDS;
      this.applyFallPose(fall);
      if (fall.progress >= 1) {
        this.settleFall(fall);
        this.activeFalls.splice(index, 1);
      }
    }
  }

  dispose(): void {
    this.grid.clear();
    this.activeFalls.length = 0;
  }
}
