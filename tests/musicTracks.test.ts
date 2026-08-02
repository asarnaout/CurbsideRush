import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MUSIC_TRACKS,
  shuffleTrackBag,
  tracksForDestination,
} from "../app/game/audio/musicTracks";
import type { DestinationId } from "../app/game/types";

const DESTINATIONS: DestinationId[] = [
  "us-nyc",
  "uk-london",
  "jp-tokyo",
  "eg-cairo",
];

const PRE_CAIRO_TRACK_IDS = [
  "nyc-upper-west-glide",
  "nyc-west-end-glide",
  "nyc-midnight-bridge-loop",
  "nyc-midnight-bridge-loop-2",
  "nyc-gridline-glow",
  "nyc-wet-bridge-run",
  "nyc-east-river-glide",
  "nyc-tribeca-after-midnight",
  "london-exhibition-road-glide-1",
  "london-exhibition-road-glide-2",
  "tokyo-setagaya-glide",
  "tokyo-setagaya-morning",
] as const;

const CAIRO_TRACKS = [
  {
    id: "cairo-maadi-road",
    url: "/audio/music/cairo-maadi-road.mp3",
    sha256: "73754e25d47b55c6f06608e0e734dedb7d67b72dac0a09455be9ecb941dccfbb",
  },
  {
    id: "cairo-october-bridge-glide",
    url: "/audio/music/cairo-october-bridge-glide.mp3",
    sha256: "87d334771fed23ad743a804b45cfd3a6667ebf29b0915eba704926a021b304f6",
  },
  {
    id: "cairo-heliopolis-after-dark",
    url: "/audio/music/cairo-heliopolis-after-dark.mp3",
    sha256: "852155b1d6c57be27a4a9a41bba7c803fc4918d0fb8049996aac3ee1565620ac",
  },
  {
    id: "cairo-corniche-after-sunset",
    url: "/audio/music/cairo-corniche-after-sunset.mp3",
    sha256: "3024e7b4a49a753dceaadc4bc3a0166a33aa62a45f65a2c1d2b5722c56ad5f1d",
  },
] as const;

/**
 * Second batch: three more Cairo pieces and one NYC piece, added after the
 * original Cairo batch above. Same embedded Suno artist (`rykard12`) as that
 * batch — see CREDITS.md.
 */
const NEW_CAIRO_TRACKS = [
  {
    id: "cairo-flyover-dawn",
    url: "/audio/music/cairo-flyover-dawn.mp3",
    sha256: "9a9a3e9d416ed0f0b110d607e4147d24c5fe0afac3ba2dbe25a73c561a6f215a",
  },
  {
    id: "cairo-dokki-before-dawn",
    url: "/audio/music/cairo-dokki-before-dawn.mp3",
    sha256: "38903a7f13855b9b82eb5636ec899be24d258c6954aaf87ab7d4f37ee46c0910",
  },
  {
    id: "cairo-corniche-loop",
    url: "/audio/music/cairo-corniche-loop.mp3",
    sha256: "fef24b89b001b027fab29186b846c2443ff3cc94f7874c88b1eb58be808d46fc",
  },
] as const;

const NYC_GLASS_ARCADE_TRACK = {
  id: "nyc-glass-arcade-drift",
  url: "/audio/music/nyc-glass-arcade-drift.mp3",
  sha256: "ae593d3e9a7e78e2e4dcbf01e808be4756c23436f2d6c26ee0d3805930703bdb",
} as const;

/**
 * Third batch: four more Cairo-only pieces. Same embedded Suno artist
 * (`rykard12`) as the earlier batches — see CREDITS.md. The first master's
 * original download name was Arabic (`ليالي القاهرة.mp3`, "Cairo Nights");
 * it was renamed before import so every repository and Downloads copy stays
 * ASCII-referenceable.
 */
const THIRD_BATCH_CAIRO_TRACKS = [
  {
    id: "cairo-nights",
    url: "/audio/music/cairo-nights.mp3",
    sha256: "16722ffb9cbf1bb8c6cfd65d364fce310f2500d996467605c4134c8711d27d5f",
  },
  {
    id: "cairo-dokki-after-midnight",
    url: "/audio/music/cairo-dokki-after-midnight.mp3",
    sha256: "e8e907a93f707054ad050753e8fec5d6463037c49220923b46779dbfc85038f8",
  },
  {
    id: "cairo-after-midnight",
    url: "/audio/music/cairo-after-midnight.mp3",
    sha256: "d5671bd0e28c6ec0653c94b883bfa16545891a3205bb54cbf28afd316c5e9a42",
  },
  {
    id: "cairo-after-midnight-2",
    url: "/audio/music/cairo-after-midnight-2.mp3",
    sha256: "4b7964ed84d37ac35e0263b04f28ee9704110afbbbf6207424b2beaf59db343d",
  },
] as const;

/** Only London and Tokyo are untouched by either Cairo batch or the NYC add. */
const EXISTING_DESTINATION_POOLS: Readonly<
  Record<"uk-london" | "jp-tokyo", readonly string[]>
> = {
  "uk-london": PRE_CAIRO_TRACK_IDS.slice(8, 10),
  "jp-tokyo": PRE_CAIRO_TRACK_IDS.slice(10, 12),
};

/** Deterministic source so shuffle assertions do not flake. */
const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
};

describe("music catalogue", () => {
  it("ships every track it lists", () => {
    // A typo in a URL is silent at runtime: the element just never plays.
    for (const track of MUSIC_TRACKS) {
      expect(existsSync(`public${track.url}`), track.url).toBe(true);
    }
  });

  it("copies the four surviving original-Cairo masters byte-for-byte under URL-safe names", () => {
    for (const expected of CAIRO_TRACKS) {
      const track = MUSIC_TRACKS.find(({ id }) => id === expected.id);
      expect(track, expected.id).toMatchObject({
        id: expected.id,
        url: expected.url,
        destinationId: "eg-cairo",
      });
      const digest = createHash("sha256")
        .update(readFileSync(`public${expected.url}`))
        .digest("hex");
      expect(digest, expected.id).toBe(expected.sha256);
    }
  });

  it("copies the second batch byte-for-byte under URL-safe names", () => {
    for (const expected of [...NEW_CAIRO_TRACKS, NYC_GLASS_ARCADE_TRACK]) {
      const track = MUSIC_TRACKS.find(({ id }) => id === expected.id);
      expect(track, expected.id).toMatchObject({
        id: expected.id,
        url: expected.url,
      });
      const digest = createHash("sha256")
        .update(readFileSync(`public${expected.url}`))
        .digest("hex");
      expect(digest, expected.id).toBe(expected.sha256);
    }
  });

  it("copies the third batch byte-for-byte under URL-safe names", () => {
    for (const expected of THIRD_BATCH_CAIRO_TRACKS) {
      const track = MUSIC_TRACKS.find(({ id }) => id === expected.id);
      expect(track, expected.id).toMatchObject({
        id: expected.id,
        url: expected.url,
        destinationId: "eg-cairo",
      });
      const digest = createHash("sha256")
        .update(readFileSync(`public${expected.url}`))
        .digest("hex");
      expect(digest, expected.id).toBe(expected.sha256);
    }
  });

  it("has unique ids and urls", () => {
    expect(MUSIC_TRACKS).toHaveLength(24);
    expect(new Set(MUSIC_TRACKS.map((track) => track.id)).size).toBe(MUSIC_TRACKS.length);
    expect(new Set(MUSIC_TRACKS.map((track) => track.url)).size).toBe(MUSIC_TRACKS.length);
  });
});

describe("city matching", () => {
  it("plays every city its own music, and only its own", () => {
    // There is no shared fallback any more, so an empty pool is silence. This
    // is the cover for a new city shipping without a soundtrack.
    for (const destinationId of DESTINATIONS) {
      const pool = tracksForDestination(destinationId);
      expect(pool.length, destinationId).toBeGreaterThan(0);
      const owned = MUSIC_TRACKS.filter((track) => track.destinationId === destinationId);
      expect(pool.map((track) => track.id).sort()).toEqual(owned.map((track) => track.id).sort());
    }
  });

  it("reserves exactly its own tracks for Cairo, across all batches", () => {
    const cairoIds = [
      ...CAIRO_TRACKS,
      ...NEW_CAIRO_TRACKS,
      ...THIRD_BATCH_CAIRO_TRACKS,
    ].map(({ id }) => id);
    expect(tracksForDestination("eg-cairo").map(({ id }) => id)).toEqual(
      cairoIds,
    );
    for (const destinationId of DESTINATIONS.filter(
      (candidate) => candidate !== "eg-cairo",
    )) {
      const poolIds = new Set(
        tracksForDestination(destinationId).map(({ id }) => id),
      );
      for (const cairoId of cairoIds) {
        expect(poolIds.has(cairoId), `${cairoId} in ${destinationId}`).toBe(
          false,
        );
      }
    }
  });

  it("adds Glass Arcade Drift to NYC, and only NYC", () => {
    expect(tracksForDestination("us-nyc").map(({ id }) => id)).toEqual([
      ...PRE_CAIRO_TRACK_IDS.slice(0, 8),
      NYC_GLASS_ARCADE_TRACK.id,
    ]);
    for (const destinationId of DESTINATIONS.filter(
      (candidate) => candidate !== "us-nyc",
    )) {
      expect(
        tracksForDestination(destinationId).some(
          (track) => track.id === NYC_GLASS_ARCADE_TRACK.id,
        ),
        destinationId,
      ).toBe(false);
    }
  });

  it("preserves the untouched London and Tokyo pools exactly", () => {
    for (const [destinationId, expectedIds] of Object.entries(
      EXISTING_DESTINATION_POOLS,
    ) as ["uk-london" | "jp-tokyo", readonly string[]][]) {
      expect(
        tracksForDestination(destinationId).map(({ id }) => id),
        destinationId,
      ).toEqual(expectedIds);
    }
  });
});

describe("shuffle bag", () => {
  it("plays everything in the pool before repeating any of it", () => {
    for (const destinationId of DESTINATIONS) {
      const pool = tracksForDestination(destinationId);
      const bag = shuffleTrackBag(pool, null, seeded(11));
      expect(bag).toHaveLength(pool.length);
      expect(new Set(bag.map((track) => track.id)).size).toBe(pool.length);
    }
  });

  it("never starts a bag with the track that just finished", () => {
    // The seam is the one repeat a listener actually notices.
    const pool = tracksForDestination("us-nyc");
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const previous of pool) {
        const bag = shuffleTrackBag(pool, previous.id, seeded(seed));
        expect(bag[0].id, `seed ${seed} after ${previous.id}`).not.toBe(previous.id);
      }
    }
  });

  it("still reaches every track from a two-track pool", () => {
    // With only two pieces the seam guard forces strict alternation; make sure
    // that does not pin one of them permanently out of reach.
    const pool = tracksForDestination("uk-london");
    expect(pool).toHaveLength(2);
    const seen = new Set<string>();
    let previous: string | null = null;
    const random = seeded(5);
    for (let i = 0; i < 20; i += 1) {
      const bag = shuffleTrackBag(pool, previous, random);
      for (const track of bag) {
        seen.add(track.id);
        previous = track.id;
      }
    }
    expect(seen.size).toBe(2);
  });

  it("does not favour any track over many draws", () => {
    const pool = tracksForDestination("us-nyc");
    const counts = new Map<string, number>();
    const random = seeded(99);
    const rounds = 4000;
    for (let i = 0; i < rounds; i += 1) {
      const first = shuffleTrackBag(pool, null, random)[0];
      counts.set(first.id, (counts.get(first.id) ?? 0) + 1);
    }
    const expected = rounds / pool.length;
    for (const track of pool) {
      const seen = counts.get(track.id) ?? 0;
      expect(Math.abs(seen - expected) / expected, track.id).toBeLessThan(0.2);
    }
  });
});
