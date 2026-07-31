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
  `2012755285875f9221074db08d58f48954a4ecb8fdfc5c1763bde421e13897ad`.
  Modified with a muted Cairo façade palette and matte materials by
  `tools/style-cairo-residences.mjs`, and its red/white striped door canopy
  deleted by `tools/cairo-shopfront.mjs` (v2); used as one of Cairo's
  flat-roofed urban residence venues.
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

### Cairo street-wall kit (CC0)

Added so Cairo's roadside frontage is built from real models instead of
procedural windowed boxes (issue: "more buildings, no triangular roofs"). Every
per-model source URL is also recorded in `app/game/buildingCatalog.ts`, and
`tests/cairoRoofs.test.ts` measures the committed geometry of each one.

**Selection rule — flat roofs only.** Cairo's building stock is flat-roofed;
a gable or hip reads as European on sight. The Quaternius pack encodes its roof
shape in the filename, so no source matching `GableRoof`, `RoundRoof` or
`_Roof_` was taken. Two KayKit buildings that looked flat in the pack's contents
sheet turned out to be pitched when measured, and were dropped.

**Modified — recoloured and made matte.** All of these ship in colours that read
as a toy blockset rather than a city. `tools/style-cairo-residences.mjs` assigns
each a muted Cairo façade tone (sand, cream, ochre, pale stone, weathered
concrete — one per model, so a street run does not read as copy-paste), flattens
the specular, and bakes provenance into `asset.extras.curbsideRush`. CC0 permits
modification; re-run the script to regenerate from a fresh download.

**Modified — shopfront corrections (KayKit models only).**
`tools/cairo-shopfront.mjs` then flattens the pack's two-tone scalloped awning to
a single colour and deletes the American fire hydrant that came bundled in the
diorama base. Neither belongs on a Cairo street: the local vocabulary is a flat
signboard fascia and a rigid one-colour canopy, and Cairo's roadside prop list
places no hydrants. The stripe is geometry rather than paint (the atlas is a grid
of gradient swatches, and the stripes are alternating faces pointed at two of
them), so it is corrected by a UV remap of the pale faces onto the dark swatch —
editing the texture would recolour every other surface sharing that swatch.
v2 additionally deletes `cairo-residence-kay`'s striped door canopy outright: at
29 triangles it slipped under v1's size filter, and its stripes pair two
lower-half swatches, which the half-atlas remap could never have reached. Each
target now declares what the filter must find, and the run refuses to stamp on
any mismatch.

All the Quaternius models below come from the **Ultimate Textured Buildings
Pack** (<https://quaternius.com/packs/ultimatetexturedbuildings.html>), released
**CC0 1.0**, downloaded 2026-07-30 from the pack's
[official Google Drive](https://drive.google.com/drive/folders/1RE3qXhbE5yGS3t-xGFJ8GmOtTgCUF3LQ)
(`Models with Materials/OBJ`), bundled `License.txt` SHA-256
`83d8959f9fc56353ed571fbe2dc52e4bcd64508e2399501cd45ac2ce3df0bf8c`. Each was
converted from OBJ + MTL to a self-contained quantized GLB by
`tools/obj-to-glb.mjs` before styling.

| File | Source model | Source OBJ SHA-256 | Source MTL SHA-256 | Committed GLB SHA-256 |
|---|---|---|---|---|
| **props/cairo-block-balcony.glb** | `2Story_Balcony_Mat` | `e00078c7618953cefcc39e16277b9a275cef0957e0daf081b72517fb0f790e5b` | `69fe57424d6ed1bf663e9a62bee02b98cc9110d7adfd529dce6609c95b060234` | `f97128e028dd57409fc0bde89fd84bd88c9d51dccc5ec83fff5cb6d954e47e99` |
| **props/cairo-block-colonnade.glb** | `2Story_Columns_Mat` | `faa0b597a7f6577a447081e3dc9dc7785aa4d70000eb691c5c9f9d7dbba45799` | `35047f8b42ff72b66b2e815ff8092863775ba101776add759dccd0503bba675e` | `56e4cecacd7f3382f067df97da1ebab6da8774bd6cd7ba29401af100560c95de` |
| **props/cairo-block-terrace.glb** | `2Story_Wide_Mat` | `3af55ffba86a236169814f39de768d5a496afaee63d0ad0a3aa2fd3a6d2900f5` | `6585298a9dacd61bc71768ab0267e72d7111aad2ea2b57e26f8a32a8bc4e27a8` | `7066e3a9df2eeb6e4da4ee70eb4ff596cbf45660b8e27e83cb18e46abe7f24b9` |
| **props/cairo-block-slim.glb** | `3Story_Slim_Mat` | `778673a3cd8508d7b484c2b243fde8b59ebda9b507dcbf9198daa3a02429fe3f` | `6f97086bad010e876d8bc35b0a51d9cabca187eca8250ce77e412a332ceb4692` | `a6d45cd63cc4a1dfb04fec66c95902fd0f417372288e94b736d30457e852443c` |
| **props/cairo-block-small.glb** | `3Story_Small_Mat` | `26377da6033df73d46eed0a1953ac149e07c93eb4b10d0587417e16cd7bd8863` | `cac01cb1df1d5022e574e03ed02e73b6c199f6f55350b1f411fb9906386390fa` | `33c751ffe82ec2b5605839192fb09523986f51dd7935866ea4ecfad3e99fc9b6` |
| **props/cairo-block-4story.glb** | `4Story_Mat` | `d326d20f0c29ad2499132dd7773aacab675946efadf18f56a926a5a8d004366a` | `df1c8f0fdff17e0fecffec423d57f240011a024d9d16b16ff092dfe8e72fb44a` | `a36fc88b9d40eb2f854cd54b5d726f4d2d28d863da00678c243fa5b9f448f6ae` |
| **props/cairo-block-4story-centre.glb** | `4Story_Center_Mat` | `7b457088cfd108df84cb534cc46837595382a34b59fc148893a3eaec2c99462f` | `0c1dae7711350389ea8988da39022704821861862a81127f99120a398fe01e58` | `7e056cb6b6bc02bbbebc00d1032c3038e6b4fd9315f0ce5233a9f3e98eda8445` |
| **props/cairo-office-block.glb** | `4Story_Wide_2Doors_Mat` | `d489f21bc4c06b0315ad81670f511adf44edbfcc10084668bbed83c97261b54b` | `39ecc25676df1db1d9b85e9041e844f28b0cc5b2587e3ef2f25ee5707b5b6ea5` | `e400ad21d2207d82f295e02981baa36e01bbc1a452a1b771e9a4c3b0b1d549e6` |
| **props/cairo-depot.glb** | `2Story_Wide_2Doors_Mat` | `eb46c1b5ef9fe4c0c91a97a5d10f082d590f7cc2c3960b94e94610ec2c818bc3` | `fb8b60be78ed5ec844899916136c77d512f668819403fbf0898d462c747a169a` | `ab7f01d005c1817f3c9a4f078a95822d966e28ca62110f062d0f2cdd4558a738` |

`cairo-office-block` and `cairo-depot` replace the pitched-roof `office.glb`
(Quaternius "Big Building") on the Cairo map only; NYC and London keep using it.

### Nile boats (CC0)

- **props/cairo-felucca.glb** ("Sail Boat") — by **Quaternius** via Poly Pizza
  (<https://poly.pizza/m/BgSZXwmm7k>; creator: <https://quaternius.com>),
  released **CC0 1.0**. Downloaded 2026-07-31. Source GLB SHA-256
  `dd0d959f66c058e2afcfc01227f80b83347b5105d324690596a0c0eb6e65fb95`;
  committed GLB SHA-256
  `e7dcd4b5c2888dfd050698ca1e52966e1b55230dc80d1153b060cf96edfb2ab6`.
  Sail retinted to felucca cream and all materials flattened matte by
  `tools/cairo-boats.mjs`; instanced as the Nile's masted craft.
- **props/cairo-skiff.glb** ("Boat") — by **Quaternius** via Poly Pizza
  (<https://poly.pizza/m/5UEl54KsuC>; creator: <https://quaternius.com>),
  released **CC0 1.0**. Downloaded 2026-07-31. Source GLB SHA-256
  `263e5d46f79e8b37afecd0db9056b22dc33c6456074d260589285d1891192335`;
  committed GLB SHA-256
  `f73cbe3bbe8f001e30d5ad78b258eb7ac6f417770773b0ba07806a44ac187472`.
  Materials flattened matte by `tools/cairo-boats.mjs`; instanced as the
  motor skiff and tour boat variants.

- **props/cairo-shop.glb** ("Building") — by **Kay Lousberg**, from the City
  Builder Bits pack via Poly Pizza (<https://poly.pizza/m/EL3ePInr1N>; creator
  page: <https://kaylousberg.com/game-assets/city-builder-bits>), released
  **CC0 1.0**. Downloaded 2026-07-30. Source GLB SHA-256
  `289278117dd1564c1ae190faa85c9dc309df94e45675431765e362b0b0ad36a5`;
  committed GLB SHA-256
  `8c4f9a9f613d5d68c0f3d001efa5191946368bbddc193790634383d73457a520`.
  Cairo's copy of `shop.glb` — same source model, but recoloured to the Cairo
  palette with the striped awning flattened and the bundled hydrant removed by
  `tools/cairo-shopfront.mjs`. It exists as a separate file because `shop.glb`
  is also placed by NYC and London, and `modelLibrary` keys asset containers by
  URL, so one file cannot carry two cities' decisions. The original is unchanged.
- **props/cairo-walkup-a.glb** ("Building") — by **Kay Lousberg**, from the City
  Builder Bits pack via Poly Pizza (<https://poly.pizza/m/qOhhGLftam>; creator
  page: <https://kaylousberg.com/game-assets/city-builder-bits>; source GLB:
  <https://static.poly.pizza/878d8f0d-cf0b-41ef-a6ab-94bd1aeb23dd.glb>),
  released **CC0 1.0**. Downloaded 2026-07-30. Source GLB SHA-256
  `a98d4fa6bf1e261da717fbdeef7937ef7578af86db3ba31a14296d814cf44e65`;
  committed GLB SHA-256
  `bfe108c90afb5ba5faa47b976dd8f37e1f98065f4d669a9204656bb3bd1b7ea3`.
  Same pack (and same flat roof + rooftop water tank) as
  `cairo-residence-kay.glb`.
- **props/cairo-walkup-b.glb** ("Building") — by **Kay Lousberg**, same pack via
  Poly Pizza (<https://poly.pizza/m/T3oyvK6VEU>; source GLB:
  <https://static.poly.pizza/e22ccf4f-e273-4ef8-9236-760829105617.glb>),
  released **CC0 1.0**. Downloaded 2026-07-30. Source GLB SHA-256
  `ecda4d8e3a89bb751f61e179725ca59d2a19f7f3aa88fedd4fc371eb8f0eaede`;
  committed GLB SHA-256
  `d63a6174590d3b631f7f4da7edd7b76f14032fbe4dbcdd3c05426c8928f22555`.
  The same source model as `nyc-brownstone-b.glb`, imported separately because
  `modelLibrary` keys asset containers by URL — one file cannot carry both the
  New York and the Cairo palette.
- **props/cairo-tower-a.glb** ("Skyscraper") — by **Kenney**
  (<https://kenney.nl>) via Poly Pizza (<https://poly.pizza/m/XST1j6kYsL>;
  source GLB:
  <https://static.poly.pizza/2bd81cbf-3d1b-4b64-935a-bc8f42896c16.glb>),
  released **CC0 1.0**. Downloaded 2026-07-30. Source GLB SHA-256
  `43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c`;
  committed GLB SHA-256
  `b9f98594295da9a35052c1c42ad2dbd3de665b4a8f7bc0ed318f5b113a0e703f`.
  Flat-topped slab for the Corniche el-Nil riverfront. Same source as
  `nyc-tower-a.glb`; separate file for the same URL-keying reason as above.
- **props/cairo-tower-b.glb** ("Skyscraper") — by **Kenney**, same pack via Poly
  Pizza (<https://poly.pizza/m/jIRx0AhYOR>; source GLB:
  <https://static.poly.pizza/ed22fd79-23e8-43cb-bf97-cc88fdd70ef0.glb>),
  released **CC0 1.0**. Downloaded 2026-07-30. Source GLB SHA-256
  `6137b8892acea9711f305d8c7f2adafb0eec5d51ec489fd8c3cb754fac28b080`;
  committed GLB SHA-256
  `596c072f3f86d4cfae0926f42f2a18568dfb8dba8afa1467e7d0ace6f1e0e676`.
  Second Corniche slab. Same source as `nyc-tower-c.glb`.

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
