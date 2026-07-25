/**
 * Prerenders `/` into `dist/client/index.html` so the build can be published as
 * a plain static site (Netlify), with no server at runtime.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * `vinext build` targets Cloudflare Workers: it emits `dist/client` (assets)
 * plus `dist/server/index.js`, a Worker that renders `/` per request. Netlify
 * has no Worker runtime, and its Next.js plugin looks for a `.next` directory
 * that vinext never produces — which is the deploy failure this addresses.
 *
 * Nothing about this app actually needs a server. There are no route handlers,
 * no server actions, and the only per-request API in the codebase is the
 * `headers()` call in `app/layout.tsx`. So rendering the one route once, at
 * build time, and shipping the result as static HTML is a faithful trade rather
 * than a downgrade.
 *
 * WHY IT RUNS THE WORKER IN PROCESS
 * ---------------------------------
 * The Worker bundle has no `cloudflare:` imports and no bare specifiers, so it
 * runs under plain Node — no wrangler, no workerd, nothing extra in CI. The
 * `env` stub below is enough because `worker/index.ts` only touches
 * `env.ASSETS`/`env.IMAGES` on the `/_vinext/image` path, and we never ask for
 * it. Using the real Worker (rather than re-rendering by hand) is the point:
 * the HTML is byte-for-byte what Cloudflare would have served, including the
 * content-hashed asset URLs.
 *
 * Do NOT be tempted to capture this from `vinext start` instead. That server
 * emits unhashed dev URLs (`/@id/__x00__virtual:vite-rsc/entry-browser`,
 * `/app/globals.css`) which 404 on a static host, and the page then never
 * hydrates. `assertUsableHtml` checks for exactly that.
 *
 * WHY THE SITE URL IS MANDATORY
 * -----------------------------
 * `generateMetadata` builds absolute Open Graph URLs from the request, because
 * `og:image` has to be absolute — the crawler that reads it is a different
 * machine. Rendering once at build time freezes whatever origin we render
 * against into the HTML that every visitor and every crawler then receives.
 * Get it wrong and `og:image` ships as `http://localhost:3000/og.jpg`; crawlers
 * fetch their own localhost, and shared links render with no preview card. That
 * failure is invisible from the site itself, so this script refuses to guess:
 * with no resolvable site URL it fails the build rather than emit a page whose
 * only symptom appears on someone else's timeline.
 *
 * We pass the origin as `x-forwarded-host`/`x-forwarded-proto`, which is what a
 * real proxy sends and what `app/layout.tsx` already reads first. So the app
 * needs no build-time branch, and the same metadata code stays correct when
 * served per-request on Cloudflare.
 *
 * REPRODUCE
 *   npm run build:static                         # build + prerender
 *   SITE_URL=https://example.com node tools/prerender-static.mjs
 * On Netlify the URL comes from the deploy environment (see resolveSiteUrl).
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_DIR = "dist/client";
const WORKER_ENTRY = "dist/server/index.js";
const OUT_HTML = path.join(CLIENT_DIR, "index.html");

/**
 * The absolute origin the published site will be served from, without a
 * trailing slash. Explicit `SITE_URL` wins; otherwise we take Netlify's deploy
 * environment, preferring the alias that matches the context being built —
 * `URL` is the production address, `DEPLOY_PRIME_URL` the branch/preview one,
 * so previews get cards pointing at the preview rather than at production.
 * Throws rather than defaulting: see the header.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveSiteUrl(env = process.env) {
  const candidate =
    env.SITE_URL ||
    (env.CONTEXT && env.CONTEXT !== "production"
      ? env.DEPLOY_PRIME_URL || env.DEPLOY_URL || env.URL
      : env.URL || env.DEPLOY_PRIME_URL);

  if (!candidate) {
    throw new Error(
      "No site URL. Set SITE_URL=https://your-site (Netlify supplies URL/" +
        "DEPLOY_PRIME_URL automatically). Refusing to prerender without it: " +
        "the origin is baked into og:image, and a wrong one ships shared links " +
        "with no preview image.",
    );
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Site URL is not a valid URL: ${candidate}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Site URL must be http(s): ${candidate}`);
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    throw new Error(
      `Refusing to prerender against ${parsed.hostname}: crawlers would resolve ` +
        "og:image to their own machine and shared links would have no preview image.",
    );
  }
  return parsed.origin;
}

/**
 * Fails on any HTML we would regret publishing. Every check here is something
 * that produces a page which *looks* fine to a casual glance: a card with no
 * image, or a shell that silently never hydrates.
 *
 * @param {string} html
 * @param {string} site Absolute origin, no trailing slash.
 * @param {(urlPath: string) => boolean} fileExists Resolves a root-relative URL
 *   path against the publish directory.
 * @returns {string[]} Human-readable problems; empty means safe to publish.
 */
export function assertUsableHtml(html, site, fileExists) {
  const problems = [];

  // The dev-server trap described in the header.
  if (html.includes("/@id/") || html.includes('href="/app/')) {
    problems.push(
      "HTML references unhashed dev module URLs — this looks like it came from " +
        "`vinext start` rather than the built Worker; it would 404 and never hydrate",
    );
  }

  // Every asset the page pulls must actually be in the publish directory.
  const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (referenced.length === 0) {
    problems.push("HTML references no /assets/* files — the render looks empty");
  }
  for (const asset of [...new Set(referenced)]) {
    if (!fileExists(asset)) problems.push(`referenced asset is missing from the build: ${asset}`);
  }

  // The social card. Absolute, on this origin, and actually present on disk.
  const tags = Object.fromEntries(
    [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[a-z:]+)" content="([^"]*)"/g)]
      .map((m) => [m[1], m[2]]),
  );
  for (const key of ["og:url", "og:image", "twitter:image", "og:title", "og:description"]) {
    if (!tags[key]) problems.push(`missing ${key} meta tag`);
  }
  for (const key of ["og:image", "twitter:image", "og:url"]) {
    const value = tags[key];
    if (!value) continue;
    if (!value.startsWith(`${site}/`) && value !== site) {
      problems.push(`${key} is "${value}" — expected an absolute URL on ${site}`);
    }
  }
  const image = tags["og:image"];
  if (image?.startsWith(`${site}/`)) {
    const imagePath = image.slice(site.length);
    if (!fileExists(imagePath)) {
      problems.push(`og:image points at ${imagePath}, which is not in the build`);
    }
  }
  if (tags["og:image"] && tags["twitter:image"] && tags["og:image"] !== tags["twitter:image"]) {
    problems.push("og:image and twitter:image disagree");
  }
  if (/localhost|127\.0\.0\.1/.test(html)) {
    problems.push("HTML still contains a localhost reference");
  }

  return problems;
}

/** Renders `/` through the built Worker, exactly as Cloudflare would. */
async function renderIndex(site) {
  const entry = pathToFileURL(path.resolve(WORKER_ENTRY)).href;
  const worker = (await import(entry)).default;
  const { host, protocol } = new URL(site);
  const request = new Request(`${site}/`, {
    headers: {
      // What a proxy would send, and what app/layout.tsx reads first.
      "x-forwarded-host": host,
      "x-forwarded-proto": protocol.replace(":", ""),
      accept: "text/html",
    },
  });
  const env = {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    IMAGES: null,
  };
  const response = await worker.fetch(request, env, {
    waitUntil() {},
    passThroughOnException() {},
  });
  if (response.status !== 200) {
    throw new Error(`Worker returned ${response.status} for "/" — cannot prerender`);
  }
  return response.text();
}

/** macOS litter that would otherwise be published as part of the site. */
function removeCruft(dir) {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) removed += removeCruft(full);
    else if (entry.name === ".DS_Store") {
      rmSync(full);
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const site = resolveSiteUrl();
  if (!existsSync(WORKER_ENTRY)) {
    throw new Error(`${WORKER_ENTRY} not found — run \`npm run build\` first`);
  }

  const html = await renderIndex(site);
  const fileExists = (urlPath) => {
    const file = path.join(CLIENT_DIR, decodeURIComponent(urlPath.split("?")[0]));
    return existsSync(file) && statSync(file).isFile();
  };

  const problems = assertUsableHtml(html, site, fileExists);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to write ${OUT_HTML}:\n` + problems.map((p) => `  - ${p}`).join("\n"),
    );
  }

  writeFileSync(OUT_HTML, html);
  const cruft = removeCruft(CLIENT_DIR);
  const image = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  console.log(`prerendered ${OUT_HTML} for ${site} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`  og:image ${image}`);
  if (cruft > 0) console.log(`  removed ${cruft} .DS_Store file(s) from the publish directory`);
}

// Importable for tests; only renders when run as a script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
