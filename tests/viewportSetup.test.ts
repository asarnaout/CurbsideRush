// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { applyViewportFitCover } from "../app/game/viewportSetup";

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
