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

The capture-phase unlock listeners stay installed for the singleton's lifetime
and retry every non-running state while a drive wants playback. Do not remove
them after the first successful resume: `suspend()` is asynchronous, so a quick
exit/re-entry can let the old suspension land after the next start gesture, and
WebKit can later move the context through its `interrupted` state.
The pending suspend completion and the next pointer/key input are both recovery
paths.

## `primeAudioContext()` + `music.start()` must run synchronously inside the click handler

Safari only honours resume/play in the same task as the gesture. **Moving either
into an effect silently kills sound.** Two such pairings exist and both are
load-bearing: `beginDrive` and `beginCareerDay`.

## Music pools are per destination, and there is no fallback

`musicTracks.ts` owns them: a city plays its own pieces and only those. The
shared fallback pool (and Cairo's `includeInFallback: false` opt-out from it)
existed for Milton Keynes, which shipped without music; both went when that map
did. **A destination with no track listed now drives in silence** — `playNext`
handles the empty pool without erroring, so nothing warns. `musicTracks.test.ts`
is the cover.

## Always schedule, never assign

`tests/driveAudioScheduling.test.ts` injects a fake context whose `FakeParam`
records a failure on any direct `.value` write after setup. The discipline it
enforces is the difference between clean audio and clicks.
