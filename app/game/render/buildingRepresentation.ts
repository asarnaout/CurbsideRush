import type { PlannedBuilding, StructuralObb } from "../geometry/buildingLayout";

/**
 * What actually stands for one planned structural solid, and what actually
 * stands for one whole planned building — plan
 * `.claude/building-collision-visual-parity-plan.md` Section 7.6. Queried by
 * tests and the debug hook; mesh names are only a helpful GLB diagnostic,
 * never the source of truth for "is every plan solid represented" (a mesh
 * count/name sweep cannot tell a `glb` holder from a `proxy` box, nor prove
 * a compound entry's every solid has its own record).
 *
 * An authored procedural cell or museum wing uses `"planned-box"` — it never
 * becomes a `"proxy"` merely because asset loading was forced off, since it
 * never had a glb to fail loading in the first place.
 */
export interface BuildingSolidRepresentation {
  readonly solidId: string;
  readonly kind: "glb" | "planned-box" | "proxy";
  readonly transform: StructuralObb;
  /** Mesh/instance name backing this solid — a merged-master instance, an
   * unbatched proxy box, or the one planned-box mesh. */
  readonly holderId: string;
}

export interface BuildingRepresentationRecord {
  readonly planId: string;
  readonly source: PlannedBuilding["source"];
  readonly solids: readonly BuildingSolidRepresentation[];
}

/**
 * Session-owned, written by both `ProceduralFacades` (planned-box entries)
 * and `BuildingLayer` (asset-slot entries, glb or proxy) — the same
 * "explicit inputs, not a class reaching into the session" shape their own
 * ctx objects already use elsewhere. Disposal (`clear()`) drops every
 * record; nothing here owns the meshes themselves.
 */
export class BuildingRepresentationRegistry {
  private readonly records = new Map<string, BuildingRepresentationRecord>();

  set(record: BuildingRepresentationRecord): void {
    this.records.set(record.planId, record);
  }

  get(planId: string): BuildingRepresentationRecord | undefined {
    return this.records.get(planId);
  }

  get size(): number {
    return this.records.size;
  }

  all(): readonly BuildingRepresentationRecord[] {
    return [...this.records.values()];
  }

  clear(): void {
    this.records.clear();
  }
}
