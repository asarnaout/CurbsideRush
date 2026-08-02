/**
 * The soundtrack, and which city each piece belongs to.
 *
 * The tracks are written per-destination, so a drive through South Kensington
 * gets the South Kensington music rather than something about Tokyo. **Every
 * city must own at least one piece**: there is no shared fallback pool any
 * more — the one existed for Milton Keynes, which had no music of its own —
 * so a city listed in `DestinationId` with nothing here simply drives in
 * silence, and nothing warns. `musicTracks.test.ts` holds the cover.
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
  { id: "nyc-glass-arcade-drift", title: "Glass Arcade Drift", url: `${BASE}/nyc-glass-arcade-drift.mp3`, destinationId: "us-nyc" },
  { id: "london-exhibition-road-glide-1", title: "Exhibition Road Glide", url: `${BASE}/london-exhibition-road-glide-1.mp3`, destinationId: "uk-london" },
  { id: "london-exhibition-road-glide-2", title: "Exhibition Road Glide (II)", url: `${BASE}/london-exhibition-road-glide-2.mp3`, destinationId: "uk-london" },
  { id: "tokyo-setagaya-glide", title: "Setagaya Glide", url: `${BASE}/tokyo-setagaya-glide.mp3`, destinationId: "jp-tokyo" },
  { id: "tokyo-setagaya-morning", title: "Setagaya Morning", url: `${BASE}/tokyo-setagaya-morning.mp3`, destinationId: "jp-tokyo" },
  { id: "cairo-maadi-road", title: "طريق المعادي", url: `${BASE}/cairo-maadi-road.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-october-bridge-glide", title: "October Bridge Glide", url: `${BASE}/cairo-october-bridge-glide.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-heliopolis-after-dark", title: "Heliopolis After Dark", url: `${BASE}/cairo-heliopolis-after-dark.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-corniche-after-sunset", title: "Corniche After Sunset", url: `${BASE}/cairo-corniche-after-sunset.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-flyover-dawn", title: "Flyover Dawn", url: `${BASE}/cairo-flyover-dawn.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-dokki-before-dawn", title: "Dokki Before Dawn", url: `${BASE}/cairo-dokki-before-dawn.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-corniche-loop", title: "Corniche Loop", url: `${BASE}/cairo-corniche-loop.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-nights", title: "Cairo Nights", url: `${BASE}/cairo-nights.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-dokki-after-midnight", title: "Dokki After Midnight", url: `${BASE}/cairo-dokki-after-midnight.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-after-midnight", title: "After Midnight Cairo", url: `${BASE}/cairo-after-midnight.mp3`, destinationId: "eg-cairo" },
  { id: "cairo-after-midnight-2", title: "After Midnight Cairo (Second Edition)", url: `${BASE}/cairo-after-midnight-2.mp3`, destinationId: "eg-cairo" },
];

/** The pool a given city draws from: its own pieces, and nothing else. */
export function tracksForDestination(destinationId: DestinationId): readonly MusicTrack[] {
  return MUSIC_TRACKS.filter((track) => track.destinationId === destinationId);
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
