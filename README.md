# Curbside Rush

Curbside Rush is a low-poly, single-player 3D open-world driving game where you run deliveries and passenger fares across five city maps in four countries — each country with its own currency, road rules, and side of the road.

The maps are New York City (Upper West Side), London (South Kensington), Milton Keynes (Oldbrook), Calais/Coquelles, and Tokyo (Setagaya). Pick a city and drive: deliveries load at a business and drop off across town, passenger fares carry a rider to their destination, earnings and fuel are tracked per country, you refuel at gas stations, and driving badly in front of a patrol car costs you a fine. Also included are first- and third-person cameras with a rear-view mirror, keyboard/gamepad/touch controls, ambient traffic and pedestrian crowds, local progress, accessibility settings, and official road-rule references.

On a phone, hold it sideways: drag your left thumb anywhere on the lower-left of the screen to steer — wherever you touch down becomes centre — and use Drive and Brake on the right. Holding Brake once you have stopped reverses. Portrait pauses the drive and asks you to rotate; nothing is lost and nothing reloads.

The ⛶ control goes fullscreen, which is worth it — mobile browsers only hide their own toolbars when a page scrolls, and the drive screen deliberately cannot. Adding the game to your Home Screen gives the same thing for the whole session, with no browser chrome at all.

## Two ways to play

**Free drive** drops you into any of the five cities with your own car and no clock — gigs come one after another for as long as you want to keep driving.

**Career** is the campaign. You start in New York on the local equivalent of $20 and your own bicycle, renting a vehicle each morning and paying it back over a ~6-minute working day: 25% platform commission, a daily fee, and a loan waiting if you end a day short. Save enough and you can buy a vehicle outright — any of them, as many as you can afford — or buy a plane ticket and start again from nothing in Tokyo, then London.

Money and vehicles belong to the city you earned them in. Flying on means a fresh balance in the local currency and none of the fleet you built, but nothing is lost: you can fly back any time and pick that city up exactly where you left it. Going bankrupt costs you that city — its cash, its debts and its fleet — and nothing else. Owning every vehicle in every city is how you finish the game.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` takes about two minutes, almost all of it in the traffic-safety acceptance test (every start position across five cities, 51 seeds, 60 seconds of simulation each). While iterating, skip it:

```bash
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"
```

One vehicle model, `public/models/vehicles/london-double-decker.glb`, is a purchased asset whose licence forbids redistribution, so it is not in the repo. In a clone without it, London's buses stand in with the committed single-deck city bus recoloured to the same red. To build the real one from your own purchased OBJ, run `node tools/build-london-bus.mjs <path-to.obj>`.

`CLAUDE.md` documents the architecture in depth — the layering rules, the geometry conventions, and the invariants that are easy to break silently.

## Deploying

The build targets Cloudflare Workers, and the same build can be published as a
plain static site. Nothing here needs a server at runtime: there are no route
handlers or server actions, and the game is client-side after the first paint.

```bash
npm run build                                              # Cloudflare Worker -> dist/
npx wrangler deploy                                        # ...deploy it

SITE_URL=https://your-site.example npm run build:static    # + prerendered index.html
```

`build:static` renders the one route through the built Worker and writes
`dist/client/index.html`, so `dist/client` can be published as static files.
`netlify.toml` already points Netlify at it; Netlify supplies the site URL
itself, so `SITE_URL` is only needed when building the static output by hand.

It is deliberate that the prerender **fails without a site URL**. Absolute
`og:image` and `og:url` values are frozen into the HTML at build time, and a
wrong origin is invisible on the site itself — it only shows up as a shared link
with no preview card.

**Deploying to Netlify for the first time:** remove `@netlify/plugin-nextjs`
under Site configuration → Build & deploy → Build plugins. Netlify installs it
on sight of `next` in `package.json`, it looks for a `.next` directory this
build never produces, and `netlify.toml` cannot uninstall a UI-installed plugin.

## Architecture

- `app/game/simulation.ts` is the deterministic fixed-step simulation: vehicle physics, traffic, road-rule enforcement and scoring. It imports nothing but its own types — no React, no Babylon, no clock, no unseeded randomness — so a drive replays bit-exactly from a seed.
- `app/game/simulationAdapter.ts` translates an authored map pack into the simulation's configuration once, before the drive starts.
- `app/game/GameCanvas.tsx` owns the client-only Babylon.js scene, cameras, input, audio and strict cleanup.
- `app/game/content.ts` and `londonContent.ts` define country profiles, official references, and the map packs. A map pack pairs a directed lane graph (the legal truth the simulation drives on) with road-surface centrelines (the visual truth); road meshes, junctions, kerbs, pavements, markings, addresses and pedestrian routes are all derived from those two at load time.
- `app/game/gigs.ts` is the delivery/fare state machine, `app/game/career.ts` is Career Mode's pure economy (the city ladder, rentals, loans, tickets and the win condition), and `app/game/progress.ts` validates and migrates the versioned `sideswap:v2` local save.
- `public/map-data/` contains frozen, checksummed OpenStreetMap extracts kept for provenance and attribution. Nothing reads them at runtime; the drivable geography is authored separately.

Curbside Rush is a game for entertainment, not legal advice or driver-licensing instruction. The in-game Sources & credits view links to the dated official material behind each country's road rules.

## Map attribution

Map geography is derived from © OpenStreetMap contributors and distributed under the ODbL. See the in-game Credits view and [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).
