import { describe, expect, it } from "vitest";
import {
  createAmbienceBuffer,
  createJitterSource,
  createNoiseBuffer,
} from "../app/game/audio/voices/voiceContext";

const SAMPLE_RATES = [8_000, 22_050, 44_100, 48_000, 96_000, 192_000];

/** Preserve AudioBuffer's duration arithmetic without pretending to render DSP. */
function makeContext(sampleRate: number): AudioContext {
  return {
    sampleRate,
    createBuffer(numberOfChannels: number, length: number, bufferSampleRate: number) {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels,
        length,
        sampleRate: bufferSampleRate,
        duration: length / bufferSampleRate,
        getChannelData: (channel: number) => channels[channel],
      };
    },
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      playbackRate: { value: 1 },
    }),
  } as unknown as AudioContext;
}

const BUFFER_CREATORS = [
  { name: "white noise", create: createNoiseBuffer },
  { name: "pink ambience", create: createAmbienceBuffer },
  {
    name: "jitter modulation",
    create: (context: AudioContext): AudioBuffer => {
      const source = createJitterSource(context);
      expect(source.loop).toBe(true);
      expect(source.buffer).not.toBeNull();
      return source.buffer!;
    },
  },
];

describe.each(BUFFER_CREATORS)("$name loop buffer", ({ create }) => {
  it.each(SAMPLE_RATES)("keeps an exact loop boundary at %i Hz", (sampleRate) => {
    const buffer = create(makeContext(sampleRate));

    // Chromium derives its loop endpoint from duration * sampleRate. An
    // endpoint even slightly beyond length can strand its playhead at the
    // bounds check before it wraps. Approximate equality would miss this.
    expect(buffer.duration * buffer.sampleRate).toBe(buffer.length);
  });
});
