# Curbside Rush

Curbside Rush is a low-poly, single-player 3D open-world driving game where you run deliveries and passenger fares across four city maps in four countries — each country with its own currency, road rules, and side of the road.

The maps are New York City (Upper West Side to the East River), London (Kensington to the City), Tokyo (Setagaya to the Sakuragawa), and Cairo (the Central Nile). New York's large Manhattan grid runs east past Central Park's transverses into an Upper-East-Side-style avenue district, then crosses the East River on two drivable bridges to a residential Queens-style borough of houses and stop-sign corners with its own low-rise shopping street on Steinway Avenue — matched by Cairo's equally broad but deliberately non-grid river city: Tahrir and Garden City's winding streets connect across Qasr El-Nil and Al-Galaa bridges to Gezira, south Zamalek, and the west bank, with the Nile, Cairo Tower, river traffic, and warm low-poly streets defining the view. London is the third at that scale and keeps left through all of it: the Thames crosses the whole map with three drivable bridges over it, six roundabouts and a signalled Parliament Square gyratory, the King's Road through Chelsea, Knightsbridge and Piccadilly into Regent Street's quadrant, and a royal park with its own lake that you can actually drive through — Serpentine Road crosses the water on its own bridge on the way from Bayswater to the museums. Its streets are built from modelled buildings: gabled brick terraces from Earls Court through Notting Hill out to Islington, white-stucco squares in Chelsea, shopfront parades on the high streets, steel-blue towers in the City around Bank — behind boulevard lawns where the roads want green, with parked cars half up the kerbs, pedestrian guardrails at the big junctions, a clock tower keeping the scenario's own time, an observation wheel on the south bank, red pillar boxes, telephone kiosks and zebra crossings under Belisha beacons; the other three in-game maps shade their parks green instead of building them. Tokyo is the fourth, and the only one after dark: the Sakuragawa runs the length of the map under three drivable bridges — Sakura-ōhashi, Kawanaka-bashi and Tsuki-ōhashi — between Gotokuji's narrow hand-built lanes and level crossing on the west bank and low-rise residential webs of T-junctions and 30 km/h zone streets, strung with utility poles and — on two named streets — sagging overhead cable, most of those webs now salted with their own konbini corner and a diner, izakaya or bakery too — modelled Japanese houses and apāto walk-ups line eight of those webs and both shotengai streets, and modelled zakkyo towers and manshon mid-rises now line downtown, the ring roads and the riverside and east-bank districts too, not just procedural facades — converging on Sakuragawa Downtown's neon core, where Chūō-dōri and Ekimae-dōri cross at a four-way pedestrian scramble lit by chōchin lanterns, vending-machine glow and vertical shop signage, with the Nakamise Yokochō shotengai's shared-space alley of food stalls running right through the middle of it; the Hikari Tower's lit lattice legs and spire stand over the east bank, visible for blocks through the night fog. Pick a city and drive: dispatch offers you work and you take it or pass on it, deliveries load at a business and drop off across town, passenger fares carry a rider to their destination, earnings and fuel are tracked per country, you refuel at gas stations — buying whatever your money covers when it will not stretch to a full tank — and driving badly in front of a patrol car gets you pulled over — the patrol stops you at the kerb, an officer walks up to your window, and the fine lands there. A third of the traffic lights watch themselves: run one of those reds, or speed past one, and the ticket arrives with no one there to hand it to you. Every street posts a speed limit, on signs you can read from the road and on the HUD, in whatever that country signs in. Crashes wear the car down, and what putting it right costs depends on how badly: drive into a repair shop's bay and you pay for the damage you are carrying, while wrecking it outright means a tow that bills for the lot at a premium. A corner minimap scrolls under you with a GPS line to the next stop and turn-by-turn directions above it; press **M** for the whole city, including fuel, repairs, venues and traffic-light cameras. Also included are first- and third-person cameras with rear-view and wing mirrors, keyboard/gamepad/touch controls, ambient traffic and pedestrian crowds, local progress, accessibility settings, and official road-rule references.

On a phone, hold it sideways: drag your left thumb anywhere on the lower-left of the screen to steer — wherever you touch down becomes centre — and use Drive and Brake on the right. Holding Brake once you have stopped reverses. Offers arrive where the map is and tuck it away while you decide, with Pass and Accept sized for a thumb. A map button beside the music one opens the same full-city map — there is no M to press. Portrait pauses the drive and asks you to rotate; nothing is lost and nothing reloads.

The ⛶ control goes fullscreen, which is worth it — mobile browsers only hide their own toolbars when a page scrolls, and the drive screen deliberately cannot. Adding the game to your Home Screen gives the same thing for the whole session, with no browser chrome at all.

## Two ways to play

**Free drive** drops you into any of the four cities with your own car and no clock — work keeps coming for as long as you want to keep driving.

**Career** is the campaign. You start in New York on the local equivalent of $20, owning nothing but a bicycle, and rent something better each morning — the garage opens on the motorbike, the cheapest ride that actually earns — paying it back over a ~6-minute working day: 25% platform commission, a daily fee, and a loan waiting if you end a day short. Pull into a pump without the cash for a tank and you pick your poison: top up with what the day has made so far, or press **B** to fill up and carry the rest to the night's reckoning. Save enough and you can buy a vehicle outright — any of them, as many as you can afford — or buy a plane ticket and start again from nothing in Tokyo, then Cairo, then London.

Your customers are rating you the whole time, on how fast the job was and — if they were in the back — how you drove. You never see it while you are out there; it is waiting in the garage the next morning. Let it slide far enough and the work dries up, the fares thin out, and eventually the platform stops calling.

Money, vehicles and your rating belong to the city you earned them in. Flying on means a fresh balance in the local currency and none of the fleet you built, but nothing is lost: you can fly back any time and pick that city up exactly where you left it. Losing a city — to the bank or to your rating — costs you its cash, its debts and its fleet, and nothing else. Owning every vehicle in every city is how you finish the game.

## Taking work

You are offered jobs rather than assigned them. An offer arrives with the fare, the kind of job and how far out of your way it is — the minimap dashes a line to it while you decide — and you have fifteen seconds to take it (**F**) or pass (**G**). Passing costs nothing but the wait for the next one, which can be up to forty-five seconds. Accepting while you already have a job queues it behind the one in hand, so a good driver is never empty.

Tips work differently by kind. A food customer decides their tip when they order, so you know it before you accept, and a quick delivery *might* earn a little more on top. A rider makes their mind up on the way: their tip is hidden until they get out, and it falls the longer the trip takes and the more traffic laws you break with them in the car.

Every so often the city surges. Fares double while it lasts — a minute or two — though customers paying twice the going rate tip a little less. It is worth driving hard for.

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

`npm test` takes about two minutes, almost all of it in the traffic-safety acceptance test (all four cities, 51 seeds, 60 seconds of simulation each). Everything else runs in about twelve seconds, so while iterating, skip it:

```bash
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"
```

CI runs typecheck, lint, and the full test suite on pull requests and pushes to
`main`; run the same checks locally before committing.

One vehicle model, `public/models/vehicles/london-double-decker.glb`, is a purchased asset whose licence forbids redistribution, so it is not in the repo. In a clone without it, London's buses stand in with the committed single-deck city bus recoloured to the same red. To build the real one from your own purchased OBJ, run `node tools/build-london-bus.mjs <path-to.obj>`.

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

Full detail, including the `vinext` metadata quirks: [docs/build-and-deploy.md](docs/build-and-deploy.md).

## Architecture

Four rings, with dependency arrows pointing only inward: `SideSwapApp.tsx` (views, economy, saves) → `GameCanvas.tsx` (the Babylon scene) → `simulation.ts` (the deterministic core) ← `simulationAdapter.ts` (authored map → core config, once, before the drive starts).

- `app/game/simulation.ts` is the deterministic fixed-step simulation: vehicle physics, traffic, and road-rule events. It imports nothing but its own types — no React, no Babylon, no clock, no unseeded randomness — so a drive replays bit-exactly from a seed.
- `app/game/GameCanvas.tsx` owns the client-only Babylon.js scene, cameras, input, audio and strict cleanup.
- `app/game/content.ts`, `londonContent.ts`, and `cairoContent.ts` define country profiles, official references, and the map packs. A map pack pairs a directed lane graph (the legal truth the simulation drives on) with road-surface centrelines (the visual truth); road meshes, junctions, kerbs, pavements, markings, signage, addresses and pedestrian routes are all derived from those two at load time. Cairo derives its lanes and surfaces from one irregular road specification plus an explicit junction-turn table; its polygonal Nile bodies whitelist the two drivable bridge portals, from which shoreline gaps and physical parapets are derived. Deterministic shallow parcels line every non-bridge road with dense, rotated frontage while rejecting roads, water, landmarks, POIs and unseen world margins; four Nile-facing carriageway sides remain open for waterfront views. Rotated city blocks keep their façades and colliders on the same heading.
- `app/game/gigs.ts` generates the jobs and `app/game/dispatch.ts` decides when they are offered, what they tip and when the city surges — both pure and seeded, so a career day replays exactly. `app/game/gpsRoute.ts` finds the minimap's route and its turn-by-turn directions across the lane graph, `app/game/DriveHud.tsx` is the drive screen's readout, `app/game/career.ts` is Career Mode's pure economy (the city ladder, rentals, loans, tickets and the win condition), and `app/game/progress.ts` validates and normalizes the current `sideswap:v2` local save.
- `app/game/regulatorySigns.ts` works out where a city posts its one-way and speed-limit signs, from the same lane graph the rules run on, so what a street tells you can never disagree with what it fines you for. `app/game/speeding.ts` decides what a patrol will actually stop you for, and `app/game/trafficSignals.ts` picks which junctions carry an enforcement camera.
- `public/map-data/` contains frozen, checksummed OpenStreetMap extracts kept for provenance and attribution. Nothing reads them at runtime; the drivable geography is authored separately.

`docs/` documents the internals in depth — the layering rules, the geometry conventions, and the invariants that are easy to break silently. [`CLAUDE.md`](CLAUDE.md) indexes it and says which page answers which kind of change.

Curbside Rush is a game for entertainment, not legal advice or driver-licensing instruction. Each country's road rules are tied to dated official sources recorded in `app/game/content.ts`.

## Map attribution

Map geography is derived from © OpenStreetMap contributors and distributed under the ODbL — see [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). Third-party 3D model licences and provenance are logged in [CREDITS.md](CREDITS.md).
