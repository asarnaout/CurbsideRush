export type AuthoredSignalStyle =
  | "nyc_signal"
  | "uk_signal"
  | "egypt_signal";

export type AuthoredSignalAspect =
  | "green"
  | "amber"
  | "all_red"
  | "red"
  | "red_amber";

export interface AuthoredSignalTimingInput {
  readonly elapsedSeconds: number;
  readonly controlId: string;
  readonly phaseGroup: string;
  readonly phaseGroups: readonly string[];
  readonly style: AuthoredSignalStyle;
}

const NYC_GREEN_SECONDS = 7;
const NYC_AMBER_SECONDS = 2;
const NYC_ALL_RED_SECONDS = 1;

const UK_RED_AMBER_SECONDS = 1.5;
const UK_GREEN_SECONDS = 7;
const UK_AMBER_SECONDS = 3;
const UK_ALL_RED_SECONDS = 1;

const CAMERA_SALT = 0x9e3779b9;

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function uniquePhaseGroups(groups: readonly string[]): string[] {
  return [...new Set(groups.filter(Boolean))];
}

/**
 * FNV-1a over a control id. The salt is what keeps two draws off the same ids
 * independent: without it the junctions that carry a camera would be the same
 * junctions that happen to sit at one end of the phase-offset spread.
 */
function hashControlId(controlId: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < controlId.length; index += 1) {
    hash ^= controlId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Gives separate junctions a deterministic offset without coupling their
 * phases to render order or random state.
 */
export function authoredSignalOffsetSeconds(controlId: string): number {
  return hashControlId(controlId, 0) % 7;
}

/**
 * FNV-1a with an avalanche on the end, because the camera draw *ranks* on the
 * whole word where the phase offset only takes it modulo seven.
 *
 * Raw FNV-1a folds left to right and never mixes back, so its high bits stay
 * largely fixed by a shared prefix — and every signal id on the grid shares
 * one (`nyc-sig-`), then an avenue key. Ranking on that put all sixteen New
 * York cameras on three avenues and none on the other three: a driver on
 * Columbus would never have met one. The finalizer is the same xorshift-multiply
 * `hashToUnit` uses, and pulling the low bits up is the whole job.
 */
function trafficCameraRank(controlId: string): number {
  let hash = hashControlId(controlId, CAMERA_SALT);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return hash >>> 0;
}

/** Share of a map's signalled junctions that watch themselves. */
export const TRAFFIC_CAMERA_RATE = 1 / 3;

/**
 * Which of a map's signals carry an enforcement camera — derived from the
 * control ids alone, so a city never authors them and a new map gets them for
 * free.
 *
 * Ranked by hash and cut at the count, rather than the obvious
 * `hash(id) < rate` threshold. A threshold yields *approximately* the share,
 * which is fine on New York's 65 signals and useless on London's two, where it
 * lands on zero more often than not and the feature simply does not exist in
 * that city. Ranking gives exactly the rate at any map size, and the `max(1)`
 * floor guarantees a signalled city has at least one camera to find.
 *
 * Ties break on `localeCompare` rather than on input order, so the draw cannot
 * shift when a map reorders its controls.
 */
export function trafficCameraControlIds(
  signalControlIds: readonly string[],
  rate: number = TRAFFIC_CAMERA_RATE,
): ReadonlySet<string> {
  const unique = [...new Set(signalControlIds)];
  if (unique.length === 0 || rate <= 0) return new Set<string>();
  const wanted = Math.min(
    unique.length,
    Math.max(1, Math.round(unique.length * rate)),
  );
  const ranked = unique
    .map((id) => ({ id, rank: trafficCameraRank(id) }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return new Set(ranked.slice(0, wanted).map((entry) => entry.id));
}

/**
 * Resolves one signal head's aspect. Each control advances one phase group at
 * a time, so conflicting approaches can never display green together. A
 * single authored group still receives a realistic red interval by reserving
 * an unassigned opposing slot.
 */
export function authoredSignalAspectAt({
  elapsedSeconds,
  controlId,
  phaseGroup,
  phaseGroups,
  style,
}: AuthoredSignalTimingInput): AuthoredSignalAspect {
  const groups = uniquePhaseGroups(phaseGroups);
  const groupIndex = groups.indexOf(phaseGroup);
  if (groupIndex < 0) return "red";

  // Egypt follows the familiar green → amber → red sequence used by the NYC
  // recipe here. The authored style remains distinct because its striped poles
  // and housings are rendered differently in GameCanvas.
  const isUk = style === "uk_signal";
  const redAmberSeconds = isUk ? UK_RED_AMBER_SECONDS : 0;
  const greenSeconds = isUk ? UK_GREEN_SECONDS : NYC_GREEN_SECONDS;
  const amberSeconds = isUk ? UK_AMBER_SECONDS : NYC_AMBER_SECONDS;
  const allRedSeconds = isUk ? UK_ALL_RED_SECONDS : NYC_ALL_RED_SECONDS;
  const slotSeconds = redAmberSeconds + greenSeconds + amberSeconds + allRedSeconds;
  const slotCount = Math.max(2, groups.length);
  const cycleSeconds = slotSeconds * slotCount;
  const cyclePosition = positiveModulo(
    elapsedSeconds + authoredSignalOffsetSeconds(controlId),
    cycleSeconds,
  );
  const activeSlot = Math.floor(cyclePosition / slotSeconds);
  const slotPosition = cyclePosition - activeSlot * slotSeconds;

  const clearanceStartsAt = redAmberSeconds + greenSeconds + amberSeconds;
  if (slotPosition >= clearanceStartsAt) return "all_red";
  if (activeSlot !== groupIndex) return "red";

  if (slotPosition < redAmberSeconds) return "red_amber";
  if (slotPosition < redAmberSeconds + greenSeconds) return "green";
  return "amber";
}
