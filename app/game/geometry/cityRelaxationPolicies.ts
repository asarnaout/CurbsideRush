/**
 * Per-map `RelaxationPolicy` registry — plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 8.2's reviewed
 * allow-list, applied. Every entry here is a specific owner a specific
 * content fix relaxed, with the specific restored plan ids that fix proved
 * (Rule 2: the first opaque hit before the original failure point) clear
 * that owner's exact reservations — never a blanket relaxation.
 *
 * A single shared registry (not one relaxation policy authored per city
 * file) because `planMapBuildings` is called from three independent places
 * — production render, collision, and this audit tooling — that must all
 * plan the *same* map identically; a policy sitting beside the content it
 * relaxes would need importing into render/collision/audit code that has no
 * other reason to depend on `cities/london.ts` et al.
 */
import { DEFAULT_RELAXATION_POLICY, type RelaxationPolicy } from "./facadesAndKeepouts";
import type { MapId } from "../types";

// Keyed by the closed MapId union (every map this registry actually has an
// entry for), but looked up by GameCanvasMapPack.id's wider `string` — every
// planMapBuildings caller has a MapPack, not necessarily one narrowed to
// MapId, and an unknown id correctly falls through to the default policy
// either way.

/**
 * London P0 Cornmarket fix (Section 10.2): Guild Lane Pharmacy's (london-v37)
 * 19 m historical buffer left the nearest civic backdrop block
 * (`london-block-cornmarket-w`) too far from the pavement to close the
 * segment-0 camera fan. `london-block-cornmarket-w-near`'s slots 0-3 are the
 * reviewed close frontage flanking the pharmacy; slots 4-5 (closest to the
 * venue, verified geometrically to still overlap its exact solid even
 * relaxed) are deliberately left off — they would never survive
 * `solidOverlapsReservation` regardless, and an allow-list entry that can
 * never ship documents nothing.
 */
const LONDON_RELAXATION_POLICY: RelaxationPolicy = {
  relaxations: [
    {
      ownerId: "london-v37",
      allowedRestoredPlanIds: new Set([
        "building:london-block-cornmarket-w-near:slot:-z:2",
        "building:london-block-cornmarket-w-near:slot:-z:3",
      ]),
    },
  ],
};

const RELAXATION_POLICIES_BY_MAP_ID: Partial<Record<MapId, RelaxationPolicy>> = {
  "london-south-kensington": LONDON_RELAXATION_POLICY,
};

/** The reviewed relaxation policy for a map, or the byte-identical default
 * (every owner on its historical buffer) for a map with no reviewed
 * relaxations yet. Takes the wider `string` id every `GameCanvasMapPack.id`
 * actually is, not the narrower `MapId` this registry's keys are drawn from —
 * an id with no entry (every map without a reviewed relaxation, and any
 * future/unknown id) safely falls through to the default. */
export function relaxationPolicyForMap(mapId: string): RelaxationPolicy {
  return RELAXATION_POLICIES_BY_MAP_ID[mapId as MapId] ?? DEFAULT_RELAXATION_POLICY;
}
