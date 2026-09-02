// @vitest-environment jsdom

import { afterAll, describe, expect, it } from "vitest";
import {
  peekAudioContext,
  primeAudioContext,
  suspendAudioContext,
} from "../app/game/audio/audioContext";

class FakeAudioContext {
  state: AudioContextState = "suspended";
  resumeCalls = 0;
  suspendCalls = 0;
  rejectResume = false;
  private finishSuspend: (() => void) | null = null;

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.rejectResume) return Promise.reject(new Error("gesture expired"));
    this.state = "running";
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    return new Promise((resolve) => {
      this.finishSuspend = () => {
        this.state = "suspended";
        resolve();
      };
    });
  }

  resolveSuspend(): void {
    const finish = this.finishSuspend;
    this.finishSuspend = null;
    if (!finish) throw new Error("No suspend is pending");
    finish();
  }
}

const originalAudioContext = Object.getOwnPropertyDescriptor(
  window,
  "AudioContext",
);
class InstalledAudioContext extends FakeAudioContext {}

Object.defineProperty(window, "AudioContext", {
  configurable: true,
  value: InstalledAudioContext,
});

afterAll(() => {
  if (originalAudioContext) {
    Object.defineProperty(window, "AudioContext", originalAudioContext);
  } else {
    Reflect.deleteProperty(window, "AudioContext");
  }
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("shared AudioContext lifecycle", () => {
  it("recovers from interruption and a late suspend after a new drive starts", async () => {
    const first = primeAudioContext();
    const context = first as unknown as FakeAudioContext | null;
    expect(peekAudioContext()).toBe(context);
    expect(context).not.toBeNull();
    if (!context) return;

    await flushPromises();
    expect(context.state).toBe("running");
    expect(context.resumeCalls).toBe(1);

    // A successful first unlock must not disarm recovery for the rest of the
    // page. WebKit can report this state after an interruption.
    window.dispatchEvent(new Event("keydown"));
    context.state = "interrupted" as AudioContextState;
    window.dispatchEvent(new Event("keydown"));
    await flushPromises();
    expect(context.state).toBe("running");
    expect(context.resumeCalls).toBe(2);

    // A late suspend completion also repairs itself without waiting for more
    // input when the new drive's resume request is accepted.
    suspendAudioContext();
    expect(context.suspendCalls).toBe(1);
    expect(primeAudioContext()).toBe(context);
    context.resolveSuspend();
    await flushPromises();
    expect(context.state).toBe("running");

    // Reproduce a quick exit/re-entry: suspend is still queued when the next
    // drive-start gesture arrives, and both immediate recovery attempts are
    // rejected after that gesture expires. The next driving input must still
    // be able to unlock the context.
    suspendAudioContext();
    expect(context.suspendCalls).toBe(2);
    context.rejectResume = true;
    expect(primeAudioContext()).toBe(context);
    context.resolveSuspend();
    await flushPromises();
    expect(context.state).toBe("suspended");

    context.rejectResume = false;
    window.dispatchEvent(new Event("pointerdown"));
    await flushPromises();
    expect(context.state).toBe("running");
    expect(context.resumeCalls).toBeGreaterThanOrEqual(5);
  });
});
