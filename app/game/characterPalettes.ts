/**
 * Per-map colour palettes for the character models: complexion and hair.
 *
 * Each of the five CC0 rigs ships one baked value for each, so both used to be
 * decided by which rig a walker wore — five complexions in a narrow mid-brown
 * band, five near-black hair colours. These palettes override them per instance,
 * which widens each range and decouples it from the model, so the same rig turns
 * up across the whole ramp.
 *
 * The per-map *weights* (how many of each ramp entry a city's crowd gets) live
 * in `visuals.ts`'s `MAP_VISUAL_PROFILES` — the shared per-city registry issue
 * #291 widened to hold this alongside plate/building/nature selectors — not
 * here; this file owns the ramps themselves and the expansion/shuffle that
 * turns a weight row into a full palette. Folding the weights into that
 * registry retired this file's own silent per-map fallback: an unmapped map id
 * now fails the same way for every visual fact, not just some.
 *
 * Tones are linear RGB, the same space as the glbs' `baseColorFactor` (what
 * `readAlbedo` hands back and what the materials already carry), so a
 * substituted tone lights exactly like an authored one. "Complexion" rather
 * than "skin" throughout: skin/skeleton already mean vertex skinning here.
 *
 * Both ramps are pitched brighter than the values they replace because the
 * scene's daylight lands well under full white on a figure — measured against a
 * render, a tone reads roughly one step darker on screen than on paper, so a
 * ramp authored to look right flat collapses into the murk this exists to break
 * up.
 */
import { hashStringToSeed, resolveMapVisualProfile, seededUnit } from "./visuals";

export interface CharacterTone {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Every ramp is expanded to this many slots, so weight rows are comparable and
 * a pool sampling by index lands on the intended proportions. */
const PALETTE_SLOTS = 24;

/** Deep to fair: as authored, sRGB rgb(85,67,56) through rgb(234,215,202). */
export const COMPLEXION_RAMP: readonly CharacterTone[] = [
  { r: 0.090, g: 0.056, b: 0.040 },
  { r: 0.145, g: 0.096, b: 0.068 },
  { r: 0.225, g: 0.152, b: 0.104 },
  { r: 0.360, g: 0.255, b: 0.170 },
  { r: 0.560, g: 0.430, b: 0.330 },
  { r: 0.820, g: 0.680, b: 0.590 },
];

/**
 * Black, dark brown, mid brown, light brown, blonde, grey. Hair reads mostly as
 * silhouette at street distance, which is why leaving it one near-black value
 * per rig kept crowds looking uniform however much the complexions varied.
 * Note this ramp is NOT monotonic in lightness — grey sits below blonde — so
 * index it by position, never by brightness.
 */
export const HAIR_RAMP: readonly CharacterTone[] = [
  { r: 0.030, g: 0.026, b: 0.024 },
  { r: 0.075, g: 0.048, b: 0.030 },
  { r: 0.165, g: 0.105, b: 0.058 },
  { r: 0.330, g: 0.225, b: 0.110 },
  { r: 0.620, g: 0.470, b: 0.230 },
  { r: 0.400, g: 0.395, b: 0.390 },
];

/**
 * Expands a weight row into one tone per palette slot. Consumers take a slot by
 * `index % length`, so the run is shuffled — seeded on the map id and the ramp,
 * so a map is identical run to run and its two ramps do not move in step —
 * otherwise every low index would land on one end of a ramp and short pools
 * would sample only that end.
 */
function expandPalette(
  weights: readonly number[],
  ramp: readonly CharacterTone[],
  seedKey: string,
): readonly CharacterTone[] {
  const slots: CharacterTone[] = [];
  for (const [index, weight] of weights.entries()) {
    for (let count = 0; count < weight; count += 1) slots.push(ramp[index]);
  }
  const random = seededUnit(hashStringToSeed(seedKey));
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    const held = slots[index];
    slots[index] = slots[swap];
    slots[swap] = held;
  }
  return slots;
}

export function complexionWeightsForMap(mapId: string): readonly number[] {
  return resolveMapVisualProfile(mapId).complexionWeights;
}

export function hairWeightsForMap(mapId: string): readonly number[] {
  return resolveMapVisualProfile(mapId).hairWeights;
}

export function complexionPaletteForMap(mapId: string): readonly CharacterTone[] {
  return expandPalette(
    complexionWeightsForMap(mapId),
    COMPLEXION_RAMP,
    `${mapId}-complexions`,
  );
}

export function hairPaletteForMap(mapId: string): readonly CharacterTone[] {
  return expandPalette(hairWeightsForMap(mapId), HAIR_RAMP, `${mapId}-hair`);
}

export const CHARACTER_RAMP_LENGTH = COMPLEXION_RAMP.length;
export const CHARACTER_PALETTE_SLOTS = PALETTE_SLOTS;
