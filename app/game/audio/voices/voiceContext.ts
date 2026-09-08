/**
 * The shared resources every voice builds on: the context, the bus they feed,
 * one noise buffer, and the modulation source that keeps the engine and tyres
 * from sounding mechanically perfect.
 */
import { fillPinkNoise, fillValueNoise, fillWhiteNoise } from "../waveTables";
import { seededUnit } from "../../visuals";

export interface VoiceContext {
  readonly context: AudioContext;
  /** Voices connect here, never to `destination` — see masterBus. */
  readonly destination: AudioNode;
  /**
   * White. Only ever heard through narrow bandpasses (squeal, disc, induction),
   * where the source spectrum barely survives the filter anyway.
   */
  readonly noiseBuffer: AudioBuffer;
  /**
   * Pink, for the broadband wind and road layers. Those are heard wide open, and
   * white noise there sounds like static rather than moving air.
   */
  readonly ambienceBuffer: AudioBuffer;
  /**
   * A looping buffer of slow fractal noise, running whether anything listens or
   * not. Voices tap it through their own depth gains into AudioParams, so the
   * modulation costs no per-frame JavaScript at all.
   */
  readonly jitter: AudioNode;
  /** Drops the more expensive layers on hardware that needs the headroom. */
  readonly lowPower: boolean;
}

/**
 * Keep the duration a whole number of seconds. With 2.7s, converting duration
 * back to frames yields e.g. 129600.00000000001 at 48kHz. Affected Chromium
 * versions mishandle that fractional loop end, replaying stale output (which
 * can become NaN through a filter and silence the entire effects bus). An exact
 * endpoint avoids that native loop bug without changing playback pitch.
 * Upstream: https://crbug.com/540961964 (observed in Chrome 152.0.7977.82).
 *
 * Three seconds also avoids the audible 1Hz chuff of a one-second noise loop.
 * Voices share the buffer at different playback rates rather than regenerating
 * the noise for each layer. `audioBuffers` guards the exact frame round trip;
 * the browser audio check verifies the PCM actually repeats across boundaries.
 */
const NOISE_SECONDS = 3;
const JITTER_SECONDS = 4;
const JITTER_HZ = 8;

export function createNoiseBuffer(context: AudioContext, seed = 90210): AudioBuffer {
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * NOISE_SECONDS),
    context.sampleRate,
  );
  fillWhiteNoise(buffer.getChannelData(0), seededUnit(seed));
  return buffer;
}

export function createAmbienceBuffer(context: AudioContext, seed = 31337): AudioBuffer {
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * NOISE_SECONDS),
    context.sampleRate,
  );
  fillPinkNoise(buffer.getChannelData(0), seededUnit(seed));
  return buffer;
}

export function createJitterSource(context: AudioContext, seed = 4711): AudioBufferSourceNode {
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * JITTER_SECONDS),
    context.sampleRate,
  );
  fillValueNoise(buffer.getChannelData(0), context.sampleRate, JITTER_HZ, seededUnit(seed));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  // Detuned off the buffer length so the wobble does not line up with anything.
  source.playbackRate.value = 0.87;
  return source;
}

/** A looping noise source tapped off one of the shared buffers. */
export function createNoiseSource(
  voice: VoiceContext,
  playbackRate: number,
  flavour: "white" | "pink" = "white",
): AudioBufferSourceNode {
  const source = voice.context.createBufferSource();
  source.buffer = flavour === "pink" ? voice.ambienceBuffer : voice.noiseBuffer;
  source.loop = true;
  source.playbackRate.value = playbackRate;
  return source;
}

/** Builds a periodic wave from an amplitude table, with normalisation on. */
export function periodicWave(context: AudioContext, harmonics: Float32Array): PeriodicWave {
  return context.createPeriodicWave(harmonics, new Float32Array(harmonics.length));
}
