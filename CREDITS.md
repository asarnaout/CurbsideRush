# Third-party asset credits

Curbside Rush's imported 3D vehicle, character and building models are low-poly
glTF (`.glb`) assets, all free for commercial use. Vehicles + people live under
`public/models/{vehicles,characters}/`; environment buildings (gig venues + gas
stations) live under `public/models/props/`.

## CC0 — public domain (no attribution required)

- **sedan.glb, sports.glb, suv.glb** — Quaternius (<https://quaternius.com>),
  released CC0. Recolourable solid-material low-poly cars.
- **person-a.glb, person-b.glb, person-c.glb** (rigged, animated pedestrians) —
  Quaternius, "Animated Men Pack" (<https://quaternius.com>), released CC0.
- **props/residence.glb** ("House") and **props/office.glb** ("Big Building") —
  Quaternius via Poly Pizza (<https://poly.pizza/m/HeHDd2rTpX>,
  <https://poly.pizza/m/AVCS8jUd2l>), released **CC0 1.0**. Low-poly detached
  house + civic block, used for residence / office gig venues.
- **props/shop.glb** ("Building") — by **Kay Lousberg** via Poly Pizza
  (<https://poly.pizza/m/EL3ePInr1N>), released **CC0 1.0**. Low-poly corner
  shop, used for shop gig venues.
- **props/cairo-residence-kay.glb** ("Building") — by **Kay Lousberg**, from
  the City Builder Bits pack via Poly Pizza
  (<https://poly.pizza/m/otRsYa6pan>; creator page:
  <https://kaylousberg.com/game-assets/city-builder-bits>; source GLB:
  <https://static.poly.pizza/1c40976f-9fd1-4779-ba85-8105d523f3d8.glb>),
  released **CC0 1.0**. Downloaded 2026-07-29. Source GLB SHA-256
  `5ebaa83522c99c877e28b9c482aa8629226d574fa398dc91ba71430d4e38e290`;
  committed GLB SHA-256
  `0ffe7683eb228040858ba8d83e3de52008564dca303f4c4a04c889d4e95fdd4e`.
  Modified with a muted Cairo façade palette and matte materials by
  `tools/style-cairo-residences.mjs`; used as one of Cairo's flat-roofed urban
  residence venues.
- **props/cairo-residence-quaternius.glb** (`3Story_Balcony_Mat`) — by
  **Quaternius**, from the Ultimate Textured Buildings Pack
  (<https://quaternius.com/packs/ultimatetexturedbuildings.html>), released
  **CC0 1.0**. Downloaded 2026-07-29 from the pack's
  [official Google Drive](https://drive.google.com/drive/folders/1RE3qXhbE5yGS3t-xGFJ8GmOtTgCUF3LQ).
  Source OBJ SHA-256
  `a44feafee3fc6a6f5f891cbcdb66ad68e7114d4d379cfcae3ad5ea1fad14a345`;
  source MTL SHA-256
  `5454773af5b796b58e33b1774ce60429098ff50c0139c6a540b23a48f6fd69eb`;
  bundled `License.txt` SHA-256
  `83d8959f9fc56353ed571fbe2dc52e4bcd64508e2399501cd45ac2ce3df0bf8c`;
  committed GLB SHA-256
  `dd9e6487f6c5cb4480b4489c2e8152994e1b9d9a9efc3fd002f1b1046c9eee63`.
  Converted from OBJ + MTL to self-contained quantized GLB, then given a muted
  Cairo palette and matte materials by `tools/style-cairo-residences.mjs`;
  used as Cairo's three-storey balcony residence variant.
- **characters/motorbike.glb** ("Cartoony Purple Motorcycle") — by
  **AliceCassie** via Poly Pizza (<https://poly.pizza/m/j20srJUjpB>), released
  **CC0 1.0**. Career Mode's motorbike tier; the LightPurple body panels are
  recoloured to the courier livery at load, and a rigged rider is seated on it
  at runtime (`setupSeatedRiderPose`).

### NYC Nightfall environment kit (CC0)

Added to dress the NYC map with dense, clustered buildings + street life. Every
per-model Poly Pizza source URL is recorded in `app/game/buildingCatalog.ts`
(the catalogue is the single source of truth for these assets).

**Modified — recoloured (issue #120).** These kits ship in bright toy colours
(saturated primary red, pumpkin orange, teal, cobalt; the tenement's brick is
pink), which read as a blockset rather than a city. `tools/recolor-nyc-buildings.mjs`
maps the saturated hues in their textures and materials into a New York facade
palette — brownstone, terracotta brick, buff, limestone, slate — while leaving
low-saturation pixels alone so the pale trim, cornices and window surrounds
survive. CC0 permits modification; re-run the script to regenerate from a fresh
download.

- **props/nyc-tower-a.glb, nyc-tower-b.glb, nyc-tower-c.glb, nyc-midrise-a.glb,
  nyc-midrise-b.glb, nyc-midrise-low.glb** — low-poly skyscrapers + mid-rise
  buildings by **Kenney** (<https://kenney.nl>) via Poly Pizza, released
  **CC0 1.0**. Downtown-tower cluster and mid-rise fill.
- **props/nyc-brownstone-a.glb, nyc-brownstone-b.glb, nyc-brownstone-c.glb,
  nyc-brownstone-d.glb** — low-poly rowhouses by **Kay Lousberg** via Poly Pizza,
  released **CC0 1.0**. The Upper West Side brownstone belt (same author as
  `shop.glb`, so the style matches).
- **props/vendor-stand.glb** ("Market Stand"), **props/vendor-cart.glb** ("Cart"),
  **props/market-stalls.glb** ("Market Stalls Compact") — by **Quaternius**
  (<https://quaternius.com>) via Poly Pizza, released **CC0 1.0**. Street vendors.
- **characters/person-woman-a.glb** ("Woman Casual"), **person-woman-b.glb**
  ("Woman in Dress"), **person-punk.glb** ("Punk") — rigged pedestrians by
  **Quaternius** via Poly Pizza, released **CC0 1.0**. Sidewalk-crowd variety
  alongside the existing person-a/b/c.

## CC-BY — attribution required

- **bus.glb** (single-deck city bus) — by **"jeremy"** via Poly Pizza
  (<https://poly.pizza/m/bsvS0E1eo4R>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "jeremy" (Poly Pizza).
- **van.glb** (recolourable panel van) — "Generic Van" by **PuKkBuMXDD** via
  Poly Pizza (<https://poly.pizza/m/BbRojf2v3H>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Generic Van by
  PuKkBuMXDD". Solid `bodywork` material, recoloured per vehicle.
- **bicycle.glb** — by **"Poly by Google"** via Poly Pizza
  (<https://poly.pizza/m/eRg_VrQlvXY>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Poly by Google".
  **Modified (issue #121):** the two pedal platforms were split out of the
  baked frame mesh into their own nodes and the tire meshes re-pivoted about
  their wheel centres, so the pedals can orbit the crank and the wheels can
  spin while a rider pedals — see `tools/split-bicycle-pedals.mjs`; re-run it
  to regenerate from a fresh download. No geometry was added or removed.
- **props/gas-station.glb** ("Gas Station") — by **Alex Safayan** via Poly Pizza
  (<https://poly.pizza/m/7rUkCX-AIR2>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Gas Station by Alex
  Safayan". Fuel station used for the refuel service points. **Modified:** the
  model's bundled clutter (parked cars/trucks, trees, bushes, flowers, crates,
  power box, filler buildings), its mirrored "QUICK STOP" lettering, and a
  freestanding sign/pylon were all trimmed to match the game's art style, keeping
  just the canopy + pumps + store — see `tools/clean-gas-station.mjs`. The model
  keeps its own baked forecourt slab, which the maps park flush against the
  road shoulder (see `tests/gasStationLots.test.ts`).
- **props/restaurant.glb** ("Diner") — by **"Poly by Google"** via Poly Pizza
  (<https://poly.pizza/m/4Xlqz9IfdrV>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Credit: "Poly by Google".
  Diner used for restaurant gig venues. **Modified:** the extruded cursive
  "Diner" script on the roof sign board was removed — the glTF import's
  handedness reflection rendered it back-to-front (#125) — along with the
  decorative fin that speared through the board (without the script it read
  as a stray slab and blocked the board's centre); see
  `tools/clean-restaurant.mjs`. The game letters each venue's own name onto
  the now-blank board at runtime.

### NYC Nightfall environment kit (CC-BY 3.0)

A few NYC-character pieces added alongside the CC0 kit above. All are **CC-BY 3.0**
(<https://creativecommons.org/licenses/by/3.0/>); per-model Poly Pizza source URLs
are in `app/game/buildingCatalog.ts`, and each model's required credit also travels
in that catalogue's `attribution` field.

- **props/nyc-tower-artdeco.glb** ("Skyscraper") — **Poly by Google**. Credit:
  "Skyscraper by Poly by Google". Art-deco setback tower.
- **props/nyc-tower-spire.glb** ("Skyscraper") — **Jarlan Perez**. Credit:
  "Skyscraper by Jarlan Perez". Spired skyline landmark.
- **props/nyc-tenement.glb** ("Apartment building") — **Poly by Google**. Credit:
  "Apartment building by Poly by Google". Fire-escape tenement.
- **props/nyc-house-a.glb** ("House") — **Poly by Google**. Credit: "House by Poly
  by Google". Detached house for the residential pocket.
- **props/nyc-house-b.glb** ("Farm house") — **Poly by Google**. Credit: "Farm
  house by Poly by Google". Detached house for the residential pocket.
- **props/nyc-shop-corner.glb** ("Pizza Corner") — **J-Toastie**. Credit: "Pizza
  Corner by J-Toastie". Corner bodega / ground-floor retail in the street wall,
  and (as prop-registry key `restaurant-pizzeria`) the Broadway Pizzeria gig
  venue, so the map's two restaurants are visibly different buildings.
- **props/vendor-food.glb** ("Street Vendor Cart") — **Alan Zimmerman**. Credit:
  "Street Vendor Cart by Alan Zimmerman". Street vendor.

## Purchased — used under licence, NOT redistributed in this repo

- **london-double-decker.glb** — "Low Poly London Bus" by **LinderMedia**
  (Envato / 3DOcean, TurboSquid product 1381797,
  <https://3docean.net/item/low-poly-london-bus/23371870>), used under a
  purchased Envato Market licence. That licence permits use of the model in the
  game but **not** redistribution of the raw asset, so this `.glb` is
  **gitignored** and never committed to this public repo. If you own the asset,
  regenerate it from your purchased OBJ with
  `node tools/build-london-bus.mjs <path-to/LowPoly-LondonBus_OBJ.obj>`. When the
  file is absent, the game falls back to its procedural double-decker
  automatically. Recoloured to plain London red with no operator/TfL branding.

## Fonts — SIL Open Font License 1.1

Self-hosted under `public/fonts/`. The OFL permits bundling/redistribution
provided its licence text travels with the fonts (included alongside them):

- **Figtree** (`figtree.woff2`) — Erik Kennedy, © 2022 The Figtree Project
  Authors. Licence: `public/fonts/Figtree-OFL.txt`.
- **Playfair Display** (`playfair-display.woff2`, `playfair-display-italic.woff2`)
  — Claus Eggers Sørensen, © 2017 The Playfair Display Project Authors, Reserved
  Font Name "Playfair Display". Licence: `public/fonts/PlayfairDisplay-OFL.txt`.
- **Noto Sans Arabic** (`noto-sans-arabic.woff2`) — The Noto Project Authors.
  Arabic subset of the variable font distributed by Google Fonts under the SIL
  Open Font License 1.1. Exact official source:
  `https://fonts.gstatic.com/s/notosansarabic/v33/nwpCtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlj4wv4rqxzLIhjE.woff2`
  (downloaded 2026-07-28; SHA-256
  `69cdf0bf005fdc9cc13fb5a8581697eb9ba8f761aeaf255fc717d14c62c38891`).
  Licence: `public/fonts/NotoSansArabic-OFL.txt`.

## Cairo authoring references — reference only

No photographs, map tiles, façades, photogrammetry, or third-party 3D models
from the sources below are bundled in the game. The two imported CC0 Cairo
residences are documented separately above; these references were consulted
only to ground the original low-poly Central Nile layout, landmarks,
public-space character, and currency naming:

- [Cairo Governorate — Qasr El-Nil Bridge](https://www.cairo.gov.eg/en/culture/cairo-history/modern-landmarks/qasr-el-nil-bridge/)
  for the bridge and its four lion sculptures.
- [JICA — Greater Cairo Urban Transport Master Plan](https://openjicareport.jica.go.jp/pdf/11893427_03.pdf)
  for the radial/arterial street and bridge network.
- [The Journal of Public Space — Tahrir Square](https://www.journalpublicspace.org/index.php/jps/article/view/1248)
  for the renovated square's landscape and public-life character.
- [Central Bank of Egypt](https://www.cbe.org.eg/en/) for the Egyptian pound
  (`EGP`) naming used by the economy.

## First-party — created for Curbside Rush (no third-party rights)

- **favicon.svg** — original Curbside Rush mark.
- **`public/landing/*.webp`** (per-city preview illustrations) — generated with
  OpenAI (ChatGPT) by the project owner, who owns the output under OpenAI's
  Terms of Use. Stylised generic city scenes; no third-party assets, logos, or
  branding. `cairo.webp` was supplied separately by the project owner, who
  confirmed commercial-use rights, and converted locally from the original
  1672×941 PNG without changing the composition.
- **og.jpg** (the link-preview card) — generated with OpenAI (ChatGPT) by the
  project owner on 2026-07-24, who owns the output under OpenAI's Terms of Use.
  Downloaded as `curbside-rush-og-image-generic-vehicles.jpg`. A stylised
  generic New York street with the game's own title and mark; no third-party
  assets, marque or branding. Sized 1200x630 at ~181 KB for the reasons noted in
  `app/layout.tsx`.
  It replaces an `og.png` that still carried the pre-rebrand "SideSwap" name.
- **`public/vehicles/*.webp`** (Career garage card art) — generated with OpenAI
  (ChatGPT) by the project owner on 2026-07-24, who owns the output under
  OpenAI's Terms of Use. Studio shots of generic low-poly vehicles; no
  third-party assets, marque, badging or number plates. They are renders in
  their own right, not photographs of the `.glb` models above, so nothing in the
  model credits carries over. Framed for the cards by
  `tools/build-vehicle-art.mjs`.
- **All sound effects** — engine, wind and road noise, tyre and brake squeal,
  horn, and collision impacts are **synthesised at runtime in Web Audio**
  (`app/game/audio/`). No sample, recording, or third-party audio asset is used
  or shipped, so there is nothing here to license.
- **`public/audio/music/*.mp3`** (19 background tracks). The original 14 were
  generated with [Suno](https://suno.com) on 2026-07-19, 2026-07-21 and
  2026-07-23 by the project owner while subscribed to a paid (Pro/Premier)
  plan. Suno assigns the subscriber all of its right, title and interest in
  output generated during the subscription term, including commercial use, and
  that grant survives the subscription ending. See Suno's
  [Terms of Service](https://suno.com/terms-of-service) and
  [rights FAQ](https://help.suno.com/en/articles/9601665). Note that rights are
  **not** granted retroactively for anything made on the free tier, which is why
  the generation date is recorded here.

  The five Cairo tracks were downloaded from Suno and supplied by the project
  owner for this project on 2026-07-29. Their embedded artist is `rykard12`.
  Repository filenames are ASCII and URL-safe; the Arabic source filename is
  retained below for provenance. Tests pin each repository copy to the exact
  SHA-256 of the supplied master.

  Tracks are matched to the city they were written for. Cairo draws only from
  its five tracks, which are excluded from every other destination; Milton
  Keynes retains the original shared 14-track pool. Original download names are
  kept here so the files can be traced back to the Suno account:

  | File | Title | City | Source |
  |---|---|---|---|
  | `nyc-upper-west-glide.mp3` | Upper West Glide | NYC | track1 |
  | `nyc-west-end-glide.mp3` | West End Glide | NYC | West End Glide |
  | `nyc-midnight-bridge-loop.mp3` | Midnight Bridge Loop | NYC | Midnight Bridge Loop |
  | `nyc-midnight-bridge-loop-2.mp3` | Midnight Bridge Loop (II) | NYC | Midnight Bridge Loop-2 |
  | `nyc-gridline-glow.mp3` | Gridline Glow | NYC | Gridline Glow |
  | `nyc-wet-bridge-run.mp3` | Wet Bridge Run | NYC | Wet Bridge Run |
  | `nyc-east-river-glide.mp3` | East River Glide | NYC | East River Glide |
  | `nyc-tribeca-after-midnight.mp3` | Tribeca After Midnight | NYC | Tribeca After Midnight |
  | `london-exhibition-road-glide-1.mp3` | Exhibition Road Glide | London | track2 |
  | `london-exhibition-road-glide-2.mp3` | Exhibition Road Glide | London | track3 |
  | `calais-coast-run-1.mp3` | Calais Coast Run | Calais | track4 |
  | `calais-coast-run-2.mp3` | Calais Coast Run | Calais | track5 |
  | `tokyo-setagaya-glide.mp3` | Setagaya Glide | Tokyo | track6 |
  | `tokyo-setagaya-morning.mp3` | Setagaya Morning | Tokyo | track8 |
  | `cairo-maadi-road.mp3` | طريق المعادي | Cairo | طريق المعادي |
  | `cairo-october-bridge-glide.mp3` | October Bridge Glide | Cairo | October Bridge Glide |
  | `cairo-heliopolis-after-dark.mp3` | Heliopolis After Dark | Cairo | Heliopolis After Dark |
  | `cairo-nile-loop-drive.mp3` | Nile Loop Drive | Cairo | Nile Loop Drive |
  | `cairo-corniche-after-sunset.mp3` | Corniche After Sunset | Cairo | Corniche After Sunset |
