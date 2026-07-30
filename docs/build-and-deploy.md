# Build, bundling and deployment

Read this before touching `vite.config.ts`, `worker/`, `tools/prerender-static.mjs`,
`netlify.toml`, or `app/layout.tsx`'s metadata.

The framework is **`vinext`**, a Next-compatible shim on Vite that targets
Cloudflare Workers — not Next.js itself. `npm run dev` is `vinext dev`, **not**
`next dev`.

## No `wrangler.toml`

Worker config is inline in `vite.config.ts` (`localBindingConfig`) at dev time and
generated into `dist/server/wrangler.json` at build.

The `@cloudflare/vite-plugin` import is **deliberately dynamic** — Wrangler
snapshots its log path on import, so it has to come after the env vars are set.

The image-optimization branch in `worker/index.ts` and the D1/drizzle packaging in
`build/sites-vite-plugin.ts` are inherited template code with no live consumer.

`vite.config.ts` freezes `COMMIT_REF` (or `CF_PAGES_COMMIT_SHA`) into the bundle as
`__BUILD_REF__`, so a player can read back which build they are running — without
it, "the fix is deployed" and "your browser cached the old page" look identical
from both ends.

## Two deploy shapes from one build

```bash
npm run build                                              # Cloudflare Worker -> dist/
npx wrangler deploy

SITE_URL=https://your-site.example npm run build:static    # + prerendered index.html
```

`build:static` adds `tools/prerender-static.mjs`, which renders `/` **through that
same Worker, in-process** — the bundle has no `cloudflare:` imports and `env` is
only touched on `/_vinext/image` — and writes `dist/client/index.html` for Netlify
to publish as static files. Using the real Worker rather than re-rendering by hand
is the point: the HTML is byte-for-byte what Cloudflare would have served,
including the content-hashed asset URLs.

**`vinext start` is not a substitute.** It serves unhashed dev URLs
(`/@id/__x00__virtual:vite-rsc/entry-browser`, `/app/globals.css`) that 404 on a
static host, so the page never hydrates. `assertUsableHtml` fails the build on
exactly that.

The prerender freezes the origin into `og:image`/`og:url`, so **it refuses to run
without a real `SITE_URL`** (Netlify supplies `URL`/`DEPLOY_PRIME_URL` itself). A
wrong one is invisible on the site and only shows up as a shared link with no
preview card.

**Deploying to Netlify for the first time:** remove `@netlify/plugin-nextjs` under
Site configuration → Build & deploy → Build plugins. Netlify installs it on sight
of `next` in `package.json`, it looks for a `.next` directory this build never
produces, and `netlify.toml` cannot uninstall a UI-installed plugin.

## `vinext`'s metadata shim silently drops fields Next's own supports

Each dropped field looks declared and does nothing. Two have bitten so far:

- **`Viewport` has no `viewportFit`**, so an `export const viewport` is dropped on
  the floor. `applyViewportFitCover` patches the rendered tag at runtime instead —
  without it every `env(safe-area-inset-*)` in the HUD and controls is `0px`.
- **`appleWebApp` renders only `title`/`statusBarStyle`**, so `capable` goes
  through `metadata.other` (`apple-mobile-web-app-capable`). Only the apple- form:
  the shim already emits `mobile-web-app-capable` itself.

**Check the emitted `dist/client/index.html` rather than trusting the type.**

The favicon URL is versioned (`/favicon.svg?v=2`) deliberately — browsers cache
favicons past a hard reload and often past an incognito window, so a changed URL is
the only bust they cannot ignore. Bump it whenever the artwork changes.
