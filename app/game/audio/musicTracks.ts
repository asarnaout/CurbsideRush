/**
 * The soundtrack, and which city each piece belongs to.
 *
 * The tracks were written per-destination, so a drive through South Kensington
 * gets the South Kensington music rather than something about Tokyo. Milton
 * Keynes has no piece of its own and retains the original shared set instead.
 * Cairo's five strongly local pieces are isolated from that fallback.
 *
 * Pure: no DOM, no audio element, so the selection logic is unit-testable.
 */
import type { DestinationId } from "../types";

export interface MusicTrack {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** Null when the piece is not tied to a particular city. */
  readonly destinationId: DestinationId | null;
  /**
   * False for strongly local pieces that must not enter another city's shared
   * fallback pool. Owned tracks still play normally in their destination.
   */
  readonly includeInFallback?: boolean;
}

const BASE = "/audio/music";

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: "nyc-upper-west-glide", title: "Upper West Glide", url: `${BASE}/nyc-upper-west-glide.mp3`, destinationId: "us-nyc" },
  { id: "nyc-west-end-glide", title: "West End Glide", url: `${BASE}/nyc-west-end-glide.mp3`, destinationId: "us-nyc" },
  { id: "nyc-midnight-bridge-loop", title: "Midnight Bridge Loop", url: `${BASE}/nyc-midnight-bridge-loop.mp3`, destinationId: "us-nyc" },
  { id: "nyc-midnight-bridge-loop-2", title: "Midnight Bridge Loop (II)", url: `${BASE}/nyc-midnight-bridge-loop-2.mp3`, destinationId: "us-nyc" },
  { id: "nyc-gridline-glow", title: "Gridline Glow", url: `${BASE}/nyc-gridline-glow.mp3`, destinationId: "us-nyc" },
  { id: "nyc-wet-bridge-run", title: "Wet Bridge Run", url: `${BASE}/nyc-wet-bridge-run.mp3`, destinationId: "us-nyc" },
  { id: "nyc-east-river-glide", title: "East River Glide", url: `${BASE}/nyc-east-river-glide.mp3`, destinationId: "us-nyc" },
  { id: "nyc-tribeca-after-midnight", title: "Tribeca After Midnight", url: `${BASE}/nyc-tribeca-after-midnight.mp3`, destinationId: "us-nyc" },
  { id: "london-exhibition-road-glide-1", title: "Exhibition Road Glide", url: `${BASE}/london-exhibition-road-glide-1.mp3`, destinationId: "uk-london" },
  { id: "london-exhibition-road-glide-2", title: "Exhibition Road Glide (II)", url: `${BASE}/london-exhibition-road-glide-2.mp3`, destinationId: "uk-london" },
  { id: "calais-coast-run-1", title: "Calais Coast Run", url: `${BASE}/calais-coast-run-1.mp3`, destinationId: "fr-calais" },
  { id: "calais-coast-run-2", title: "Calais Coast Run (II)", url: `${BASE}/calais-coast-run-2.mp3`, destinationId: "fr-calais" },
  { id: "tokyo-setagaya-glide", title: "Setagaya Glide", url: `${BASE}/tokyo-setagaya-glide.mp3`, destinationId: "jp-tokyo" },
  { id: "tokyo-setagaya-morning", title: "Setagaya Morning", url: `${BASE}/tokyo-setagaya-morning.mp3`, destinationId: "jp-tokyo" },
  { id: "cairo-maadi-road", title: "طريق المعادي", url: `${BASE}/cairo-maadi-road.mp3`, destinationId: "eg-cairo", includeInFallback: false },
  { id: "cairo-october-bridge-glide", title: "October Bridge Glide", url: `${BASE}/cairo-october-bridge-glide.mp3`, destinationId: "eg-cairo", includeInFallback: false },
  { id: "cairo-heliopolis-after-dark", title: "Heliopolis After Dark", url: `${BASE}/cairo-heliopolis-after-dark.mp3`, destinationId: "eg-cairo", includeInFallback: false },
  { id: "cairo-nile-loop-drive", title: "Nile Loop Drive", url: `${BASE}/cairo-nile-loop-drive.mp3`, destinationId: "eg-cairo", includeInFallback: false },
  { id: "cairo-corniche-after-sunset", title: "Corniche After Sunset", url: `${BASE}/cairo-corniche-after-sunset.mp3`, destinationId: "eg-cairo", includeInFallback: false },
];

const SHARED_FALLBACK_TRACKS = MUSIC_TRACKS.filter(
  (track) => track.includeInFallback !== false,
);

/**
 * The pool a given city draws from: its own pieces, or the shared fallback when
 * it has none. Strongly local tracks opt out so Cairo music cannot leak into
 * Milton Keynes's otherwise unchanged catalogue.
 */
export function tracksForDestination(destinationId: DestinationId): readonly MusicTrack[] {
  const owned = MUSIC_TRACKS.filter((track) => track.destinationId === destinationId);
  return owned.length > 0 ? owned : SHARED_FALLBACK_TRACKS;
}

/**
 * A shuffled bag, so every track in the pool plays before any of them repeats —
 * markedly better than independent random draws over a long free-roam session,
 * which cluster.
 *
 * `avoidFirst` guards the seam between bags: without it the last track of one
 * bag can be the first of the next, which is the one repeat a listener notices.
 */
export function shuffleTrackBag(
  pool: readonly MusicTrack[],
  avoidFirst: string | null,
  random: () => number,
): MusicTrack[] {
  const bag = [...pool];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  if (avoidFirst !== null && bag.length > 1 && bag[0].id === avoidFirst) {
    [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  return bag;
}
