import { describe, expect, it } from "vitest";
import { assertUsableHtml, resolveSiteUrl } from "../tools/prerender-static.mjs";

/**
 * The static publish path renders `/` once at build time, which freezes the
 * origin into og:image. Every failure guarded here is silent on the site
 * itself — it only shows up as a preview-less link on someone else's timeline —
 * so the build has to refuse rather than warn.
 */
describe("site URL resolution", () => {
  it("throws rather than defaulting when nothing identifies the site", () => {
    expect(() => resolveSiteUrl({})).toThrow(/No site URL/);
  });

  it("prefers an explicit SITE_URL over the deploy environment", () => {
    expect(
      resolveSiteUrl({ SITE_URL: "https://curbsiderush.com", URL: "https://x.netlify.app" }),
    ).toBe("https://curbsiderush.com");
  });

  it("uses the production URL for a production build", () => {
    expect(
      resolveSiteUrl({
        CONTEXT: "production",
        URL: "https://curbsiderush.netlify.app",
        DEPLOY_PRIME_URL: "https://deploy-preview-7--curbsiderush.netlify.app",
      }),
    ).toBe("https://curbsiderush.netlify.app");
  });

  it("points a deploy preview's card at the preview, not at production", () => {
    // Otherwise every preview advertises production's URL and image.
    expect(
      resolveSiteUrl({
        CONTEXT: "deploy-preview",
        URL: "https://curbsiderush.netlify.app",
        DEPLOY_PRIME_URL: "https://deploy-preview-7--curbsiderush.netlify.app",
      }),
    ).toBe("https://deploy-preview-7--curbsiderush.netlify.app");
  });

  it("strips any path or trailing slash to a bare origin", () => {
    expect(resolveSiteUrl({ SITE_URL: "https://curbsiderush.com/" })).toBe(
      "https://curbsiderush.com",
    );
  });

  it("rejects localhost, which would send crawlers to their own machine", () => {
    expect(() => resolveSiteUrl({ SITE_URL: "http://localhost:3000" })).toThrow(/localhost/);
    expect(() => resolveSiteUrl({ SITE_URL: "http://127.0.0.1:8788" })).toThrow(/127\.0\.0\.1/);
  });

  it("rejects a malformed or non-http URL", () => {
    expect(() => resolveSiteUrl({ SITE_URL: "curbsiderush.com" })).toThrow(/not a valid URL/);
    expect(() => resolveSiteUrl({ SITE_URL: "ftp://curbsiderush.com" })).toThrow(/http/);
  });
});

const SITE = "https://curbsiderush.com";
const goodHtml = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/assets/index-abc123.css"/>
<meta property="og:title" content="Curbside Rush"/>
<meta property="og:description" content="Rise and grind"/>
<meta property="og:url" content="${SITE}"/>
<meta property="og:image" content="${SITE}/og.jpg"/>
<meta name="twitter:image" content="${SITE}/og.jpg"/>
<script src="/assets/index-def456.js"></script>
</head><body></body></html>`;

/** Everything the build actually emitted exists; nothing else does. */
const present = (...paths: string[]) => (p: string) => paths.includes(p);
const allPresent = present("/assets/index-abc123.css", "/assets/index-def456.js", "/og.jpg");

describe("prerendered HTML guards", () => {
  it("passes HTML that is safe to publish", () => {
    expect(assertUsableHtml(goodHtml, SITE, allPresent)).toEqual([]);
  });

  it("catches HTML captured from the dev server", () => {
    // `vinext start` emits these; they 404 on a static host and the page then
    // renders a shell that never hydrates — which looks like a working deploy.
    const devHtml = goodHtml.replace(
      '<script src="/assets/index-def456.js"></script>',
      '<script src="/@id/__x00__virtual:vite-rsc/entry-browser"></script>',
    );
    expect(assertUsableHtml(devHtml, SITE, allPresent).join(" ")).toMatch(/dev module URLs/);
  });

  it("catches an asset the build did not actually emit", () => {
    const problems = assertUsableHtml(goodHtml, SITE, present("/assets/index-abc123.css", "/og.jpg"));
    expect(problems.join(" ")).toMatch(/missing from the build: \/assets\/index-def456\.js/);
  });

  it("catches a localhost origin surviving into the card", () => {
    const local = goodHtml.replaceAll(SITE, "http://localhost:3000");
    const problems = assertUsableHtml(local, SITE, allPresent).join(" ");
    expect(problems).toMatch(/localhost/);
    expect(problems).toMatch(/expected an absolute URL/);
  });

  it("catches an og:image pointing at a file that is not in the build", () => {
    // The exact regression from renaming og.png to og.jpg.
    const stale = goodHtml.replaceAll("/og.jpg", "/og.png");
    expect(assertUsableHtml(stale, SITE, allPresent).join(" ")).toMatch(
      /og:image points at \/og\.png/,
    );
  });

  it("catches a relative og:image, which crawlers cannot resolve", () => {
    const relative = goodHtml.replace(
      `<meta property="og:image" content="${SITE}/og.jpg"/>`,
      '<meta property="og:image" content="/og.jpg"/>',
    );
    expect(assertUsableHtml(relative, SITE, allPresent).join(" ")).toMatch(
      /og:image is "\/og\.jpg"/,
    );
  });

  it("catches missing card tags entirely", () => {
    const bare = `<html><head><link href="/assets/index-abc123.css"/><script src="/assets/index-def456.js"></script></head></html>`;
    const problems = assertUsableHtml(bare, SITE, allPresent).join(" ");
    for (const tag of ["og:url", "og:image", "twitter:image", "og:title", "og:description"]) {
      expect(problems).toContain(`missing ${tag}`);
    }
  });

  it("catches og:image and twitter:image drifting apart", () => {
    const drifted = goodHtml.replace(
      `<meta name="twitter:image" content="${SITE}/og.jpg"/>`,
      `<meta name="twitter:image" content="${SITE}/other.jpg"/>`,
    );
    expect(assertUsableHtml(drifted, SITE, present("/assets/index-abc123.css", "/assets/index-def456.js", "/og.jpg", "/other.jpg")).join(" ")).toMatch(
      /disagree/,
    );
  });

  it("catches an empty render with no assets at all", () => {
    expect(assertUsableHtml("<html></html>", SITE, allPresent).join(" ")).toMatch(
      /references no \/assets/,
    );
  });
});
