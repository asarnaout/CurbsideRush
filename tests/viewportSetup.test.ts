// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyViewportFitCover,
  canFullscreen,
  isFullscreen,
} from "../app/game/viewportSetup";

const docWithViewport = (content: string): Document => {
  const doc = document.implementation.createHTMLDocument("test");
  const meta = doc.createElement("meta");
  meta.name = "viewport";
  meta.content = content;
  doc.head.appendChild(meta);
  return doc;
};

const contentOf = (doc: Document) =>
  doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

describe("viewport-fit=cover", () => {
  it("adds the token the framework will not", () => {
    // vinext's Viewport shim has no viewportFit field, so an
    // `export const viewport` from the layout is silently dropped — and without
    // this token every env(safe-area-inset-*) in the HUD resolves to 0px.
    const doc = docWithViewport("width=device-width, initial-scale=1");
    applyViewportFitCover(doc);
    expect(contentOf(doc)).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
  });

  it("is idempotent, because it runs on every mount", () => {
    const doc = docWithViewport("width=device-width, initial-scale=1");
    applyViewportFitCover(doc);
    applyViewportFitCover(doc);
    applyViewportFitCover(doc);
    expect(contentOf(doc)).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
  });

  it("leaves an existing declaration alone, whatever its value", () => {
    const doc = docWithViewport("width=device-width, viewport-fit=contain");
    applyViewportFitCover(doc);
    expect(contentOf(doc)).toBe("width=device-width, viewport-fit=contain");
  });

  it("does not double a trailing comma", () => {
    const doc = docWithViewport("width=device-width, initial-scale=1,");
    applyViewportFitCover(doc);
    expect(contentOf(doc)).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
  });

  it("does nothing when there is no viewport tag to patch", () => {
    const doc = document.implementation.createHTMLDocument("test");
    expect(() => applyViewportFitCover(doc)).not.toThrow();
  });
});

describe("fullscreen capability", () => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const original = {
    request: proto.requestFullscreen,
    webkit: proto.webkitRequestFullscreen,
  };

  afterEach(() => {
    for (const [key, value] of [
      ["requestFullscreen", original.request],
      ["webkitRequestFullscreen", original.webkit],
    ] as const) {
      if (value === undefined) delete proto[key];
      else proto[key] = value;
    }
  });

  it("accepts the prefixed spelling on its own", () => {
    // The bug this guards: guarding on `requestFullscreen` alone silently
    // no-ops on any WebKit that only has the prefixed name — which looks
    // exactly like the feature not being implemented.
    delete proto.requestFullscreen;
    proto.webkitRequestFullscreen = vi.fn();
    expect(canFullscreen()).toBe(true);
  });

  it("accepts the unprefixed spelling on its own", () => {
    delete proto.webkitRequestFullscreen;
    proto.requestFullscreen = vi.fn();
    expect(canFullscreen()).toBe(true);
  });

  it("reports no capability when the browser has neither", () => {
    delete proto.requestFullscreen;
    delete proto.webkitRequestFullscreen;
    expect(canFullscreen()).toBe(false);
  });

  it("reads the fullscreen element under either spelling", () => {
    const doc = { fullscreenElement: null, webkitFullscreenElement: null };
    expect(isFullscreen(doc as unknown as Document)).toBe(false);
    expect(
      isFullscreen({ ...doc, webkitFullscreenElement: {} } as unknown as Document),
    ).toBe(true);
    expect(
      isFullscreen({ ...doc, fullscreenElement: {} } as unknown as Document),
    ).toBe(true);
  });
});
