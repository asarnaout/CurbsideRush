# Audio

Read this before touching `app/game/audio/` or anything that starts a drive.

## The model is pure; the voices only schedule it

`audioMath.ts` (577 lines) has **zero Web Audio imports** — it is the entire car
model (invented 5-speed gearbox, rpm curves, wind/road/squeal) and mutates
caller-owned objects, allocating nothing. Its only import is `seededUnit` from
`visuals.ts`. Voices (`audio/voices/*`) do nothing but schedule those numbers.

`DriveAudio.create()` returns `null` when Web Audio is unavailable, hence the
`this.audio?.…` everywhere in `GameCanvas`.

## The AudioContext is a module-level singleton

Deliberately not per-session, because `GameCanvas` remounts on destination and
steering change.

## `primeAudioContext()` + `music.start()` must run synchronously inside the click handler

Safari only honours resume/play in the same task as the gesture. **Moving either
into an effect silently kills sound.** Two such pairings exist and both are
load-bearing: `beginDrive` and `beginCareerDay`.

## Music pools are per destination

`musicTracks.ts` owns them. Cairo's five pieces set `includeInFallback: false` so
they cannot play elsewhere, while a city with no owned music keeps the legacy
common pool.

## Always schedule, never assign

`tests/driveAudioScheduling.test.ts` injects a fake context whose `FakeParam`
records a failure on any direct `.value` write after setup. The discipline it
enforces is the difference between clean audio and clicks.
