/**
 * The turn-signal relay click. Real flasher relays make a mechanical tick on
 * both edges of the cycle — lamp on, lamp off — so this fires once per
 * `updateIndicatorLights` transition rather than looping. Built the same way
 * as the fuel-nozzle latch in `foleyVoice.ts`: band-limited noise through a
 * narrow bandpass, gone in under a tenth of a second. The lamp-off click is
 * pitched a shade lower, which is what makes the two ticks read as a rhythm
 * ("tick... tock...") instead of one sound repeated.
 */
import { TRIGGER_LOOKAHEAD } from "../paramUtils";
import { createNoiseSource, type VoiceContext } from "./voiceContext";

export class IndicatorVoice {
  private readonly voice: VoiceContext;

  constructor(voice: VoiceContext) {
    this.voice = voice;
  }

  /** `open` is true for the lamp-lit half of the blink cycle. */
  tick(open: boolean): void {
    const context = this.voice.context;
    const when = context.currentTime + TRIGGER_LOOKAHEAD;

    const click = createNoiseSource(this.voice, 1);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(open ? 2500 : 1950, when);
    filter.Q.setValueAtTime(4.5, when);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.09, when + 0.002);
    gain.gain.setTargetAtTime(0, when + 0.002, 0.01);

    click.connect(filter).connect(gain).connect(this.voice.destination);
    click.start(when);
    click.stop(when + 0.08);
    click.onended = () => {
      click.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
}
