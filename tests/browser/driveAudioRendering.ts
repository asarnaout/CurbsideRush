/**
 * Native Web Audio regression, run via /tools/audio-render-check.html on the dev
 * server. Node's fake AudioParams cannot detect corrupt PCM at a loop boundary.
 * Keep raw source checks separate: adding a source tap changes Chrome's in-place
 * processing and can hide the downstream NaNs this regression caused.
 */
import { DriveAudio } from "../../app/game/audio/DriveAudio";
import {
  DEFAULT_ENGINE_PROFILE,
  MOTORBIKE_ENGINE_PROFILE,
  type ResolvedEngineProfile,
} from "../../app/game/audio/audioMath";
import {
  createAmbienceBuffer,
  createNoiseBuffer,
  createNoiseSource,
} from "../../app/game/audio/voices/voiceContext";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkLoop(sampleRate: number, flavour: "white" | "pink"): Promise<void> {
  const offline = new OfflineAudioContext(1, sampleRate * 10, sampleRate);
  const context = offline as unknown as AudioContext;
  const noiseBuffer = createNoiseBuffer(context);
  const ambienceBuffer = createAmbienceBuffer(context);
  const source = createNoiseSource({
    context, noiseBuffer, ambienceBuffer, destination: offline.destination,
    jitter: offline.createGain(), lowPower: false,
  }, 1, flavour);
  // Copy before rendering: the browser can acquire/detach channel storage.
  const expected = source.buffer!.getChannelData(0).slice();
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    assert(samples[i] === expected[i % expected.length],
      `${flavour} at ${sampleRate} Hz: loop PCM diverged at sample ${i}`);
  }
}

function rms(samples: Float32Array, sampleRate: number, from: number, to: number): number {
  let sum = 0;
  const start = Math.floor(from * sampleRate);
  const end = Math.floor(to * sampleRate);
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

async function checkDrive(sampleRate: number, lowPower: boolean, profile: ResolvedEngineProfile) {
  const offline = new OfflineAudioContext(2, sampleRate * 36, sampleRate);
  let time = 0;
  // Schedule the same per-frame updates without waiting 36 wall-clock seconds.
  // Bind native methods to their actual context (Web IDL checks the receiver).
  const context = new Proxy(offline, {
    get(target, key) {
      if (key === "currentTime") return time;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as AudioContext;
  // Test-only construction bypasses create()'s real-time singleton. Exercise
  // the entire production graph; no output taps or replacement DSP nodes.
  const drive = Reflect.construct(DriveAudio, [
    context, { master: 0.8, effects: 0.8 }, lowPower, false, profile,
  ]) as DriveAudio;
  for (let frame = 0; frame < 36 * 60; frame++) {
    time = frame / 60;
    const reverse = time >= 18 && time < 22;
    const accelerating = time >= 2 && time < 8;
    const braking = time >= 8 && time < 12;
    const speed = accelerating ? (time - 2) * 5
      : braking ? Math.max(0, 30 - (time - 8) * 9)
        : reverse ? 3 : time >= 24 && time < 26 ? 10 : 0;
    drive.update({
      dtSeconds: 1 / 60, speedMps: speed, signedSpeedMps: reverse ? -speed : speed,
      gear: reverse ? "R" : "D", throttle: accelerating || reverse ? 1 : 0,
      brake: braking ? 1 : 0, steer: 0, offRoad: false,
      outOfFuel: time >= 26, firstPerson: false,
    });
    if (frame === 12 * 60) drive.setPaused(true);
    if (frame === 16 * 60) drive.setPaused(false);
    if (frame === 22 * 60) drive.setVolumes({ master: 0.8, effects: 0 });
    if (frame === 24 * 60) drive.setVolumes({ master: 0.8, effects: 0.8 });
    // With the engine stalled and road layers settled, these windows verify
    // individual one-shots still reach the output after many buffer loops.
    if (frame === 30 * 60) drive.impact(12, time * 1000);
    if (frame === 32 * 60) drive.hornPress();
    if (frame === 32.5 * 60) drive.hornRelease();
    if (frame === 34 * 60) drive.indicatorTick(true);
  }
  const rendered = await offline.startRendering();
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    const samples = rendered.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      assert(Number.isFinite(samples[i]), `Non-finite effects PCM at ${i / sampleRate}s`);
      peak = Math.max(peak, Math.abs(samples[i]));
    }
  }
  assert(peak < 1, `Effects exceeded full scale: ${peak}`);
  const samples = rendered.getChannelData(0);
  const stalledFloor = rms(samples, sampleRate, 29, 30);
  const audible = [
    ["idle", 1, 2], ["acceleration", 5, 6], ["braking", 8.2, 8.8],
    ["resumed", 17, 18], ["reverse", 20, 21], ["unmuted", 25, 26],
    ["impact", 30, 30.2], ["horn", 32.1, 32.4], ["indicator", 34, 34.05],
  ] as const;
  for (const [name, from, to] of audible) {
    const level = rms(samples, sampleRate, from, to);
    assert(level > 0.0001, `${name} is silent (${level})`);
    if (from >= 30) {
      assert(level > stalledFloor * 3, `${name} did not rise above the settled engine tail`);
    }
  }
  for (const [name, from, to] of [["paused", 14, 15], ["muted", 23, 24]] as const) {
    const level = rms(samples, sampleRate, from, to);
    assert(level < 0.00001, `${name} should be silent (${level})`);
  }
  drive.dispose();
  return peak;
}

const button = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLElement>("#result")!;
button.addEventListener("click", async () => {
  button.disabled = true;
  const lines = [navigator.userAgent];
  result.textContent = "Rendering…";
  try {
    for (const rate of [22_050, 44_100, 48_000, 96_000]) {
      for (const flavour of ["white", "pink"] as const) {
        await checkLoop(rate, flavour);
        lines.push(`PASS ${flavour} loops, ${rate} Hz: every sample matches across 3 loops`);
        result.textContent = lines.join("\n");
      }
    }
    for (const rate of [44_100, 48_000]) {
      for (const [name, lowPower, profile] of [
        ["car", false, DEFAULT_ENGINE_PROFILE],
        ["low-power car", true, DEFAULT_ENGINE_PROFILE],
        ["motorbike", false, MOTORBIKE_ENGINE_PROFILE],
      ] as const) {
        const peak = await checkDrive(rate, lowPower, profile);
        lines.push(`PASS ${name}, ${rate} Hz: 36s finite PCM, controls/cues audible, pause/mute silent, peak ${peak.toFixed(3)}`);
        result.textContent = lines.join("\n");
      }
    }
    lines.push("PASS all 14 native rendering checks");
  } catch (error) {
    lines.push(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    result.textContent = lines.join("\n");
    button.disabled = false;
  }
});
