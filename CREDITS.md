# Third-party asset credits

Curbside Rush's imported 3D vehicle, character and building models are low-poly
glTF (`.glb`) assets, all free for commercial use. Vehicles + people live under
`public/models/{vehicles,characters}/`; environment buildings (gig venues + gas
stations) live under `public/models/props/`.


## London

London's street wall is built from the **London street-wall kit** below — 15
CC0 glbs (Quaternius pitched-roof terraces in brick and stucco renders, Kenney
towers in City glass, Kay Lousberg shopfronts) — plus the procedural facade
grid, which Whitehall's Portland-stone blocks and the museum quarter keep on
purpose. Every licence was verified on its source page at import time and
every file's provenance is hashed below and baked into the glb itself
(`asset.extras.curbsideRush`); `tests/londonAssets.test.ts` pins the committed
bytes.

London's landmarks stay procedural: the clock tower, observation wheel,
Gherkin, Shard, palace, department store, Monument, power station, round hall,
station fronts, bridge decks and towers, pillar boxes, telephone kiosks and
Belisha beacons are all built from primitives in `render/londonLandmarks.ts` —
nothing on that list is worth a licence to verify, and building it
procedurally keeps it stylistically of a piece.

The one London asset that is not ours is the double-decker bus, already
recorded below: a purchased model whose licence forbids redistribution, so it
is not in the repo and the committed single-deck bus stands in for it.

London's kerbside parked cars reuse the committed traffic-fleet glbs
(`sedan`, `sports`, `suv` — CC0; `van` — CC-BY, credit below) as static
street dressing; no new files and no new licences are involved.

## Tokyo

Tokyo shipped its ten-phase city expansion with `buildingSets: []` — every
building on the map was a procedural facade box. The **Tokyo street-wall
kit** below (13 CC-BY 4.0 glbs from Sketchfab: houses, apāto walk-ups, a
konbini, shotengai shopfronts, an izakaya and a ramen shop) is the first
round of real building models for it (Tokyo authenticity plan, phase P1).
**Phase P2 wired ten of the thirteen live**: two new sets, `tokyo-house`
(house-a/b/c/d + apato-a) and `tokyo-shotengai` (shop-a/b/c/d + konbini +
house-a), dress miyanosaka/yamashita/nishi and the `jp-nakamise-yokocho`
shotengai — see `docs/map-authoring.md`'s "Tokyo is two halves" section.
`tokyo-izakaya`/`tokyo-ramen` stay catalogued but unplaced (venue models, a
later phase's job) and `tokyo-apato-b` stays unplaced too (no set built so
far names it). Every licence was verified on the model's own Sketchfab page
and via the download panel at import time (2026-08-14), and every file's
provenance is hashed below and baked into the glb itself
(`asset.extras.curbsideRush`); `tests/tokyoAssets.test.ts` pins the
committed bytes.

Unlike the CC0 kits below (Quaternius/KayKit solids with no baked textures),
these Sketchfab exports ship their own authored textures and materials, so
the normalization pass (`tools/style-tokyo-buildings.mjs`) is lighter-touch
than a full palette replacement — see the kit's own entry for exactly what it
does to each file.

**Phase P3a adds 13 more models, import-only** (same "catalogued, measured,
not yet referenced by any `BuildingSetId`" scope P1 shipped): the downtown/
zakkyo backbone. Six `tokyo-zakkyo-{a..f}.glb` files split from one
19-building Sketchfab night-city pack (`tools/split-asian-city-pack.mjs`),
the optional `tokyo-nippori-bldg` real-Tokyo photogrammetry hero (both
CC-BY 4.0, documented in the Tokyo street-wall kit table below), and six
**restyle-backbone** models — re-imports of already-committed CC0 sources
restyled for Tokyo (`tokyo-walkup-a/b` from `cairo-walkup-a/b.glb`,
`tokyo-tower-a` from `nyc-tower-a.glb`, `tokyo-block-slim/small/4story`
freshly re-converted from the same Quaternius Ultimate Textured Buildings
Pack `cairo-block-slim/small/4story.glb` already uses), documented in their
own "Tokyo restyle-backbone kit (CC0)" section below. Every licence was
re-verified at import time (2026-08-14): the Sketchfab pair's license.txt
downloads and archive SHA-256s both matched the plan's own research
manifest; the Quaternius OBJ+MTL pair's SHA-256s came back byte-identical to
the ones already hashed for `cairo-block-slim/small/4story.glb`, confirming
the same pack/download.

**Phase P3b wires the rest live**, no new imports: the six
`tokyo-zakkyo-{a..f}` splits plus `tokyo-block-slim/small/4story` form a new
`tokyo-zakkyo` set (downtown + ring); `tokyo-walkup-a/b`, `tokyo-block-4story`
and `tokyo-tower-a` form a new `tokyo-manshon` set (riverside + higashi).
`tokyo-nippori-bldg` stays deliberately unplaced (an optional hero, not
worth its own draw-call cost this phase — see the P3b PR). `tokyo-apato-b`
also stays unplaced, but for a different, harder reason discovered live: a
paired before/after headless-Chrome measurement at the Tokyo scramble found
including it in `tokyo-manshon` nearly doubled the scramble's draw calls —
its glb's ~99 distinct architectural-style submeshes (Wall/Slab/Roof
Gable/Moulding, each separately named) each cost a real, fixed draw call
the moment even one instance is on screen. Removing it from the set
resolved the regression entirely (confirmed by re-measuring) and left every
other Sketchfab/restyle model's licence and provenance below unaffected —
no bytes changed, only which sets reference which already-committed files.

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
Both are also placed by the Cairo street wall (`buildingSets.ts`) as long
ministry/warehouse frontage runs, at street-wall scales of their own.

### London street-wall kit (CC0)

Added so London's roadside frontage is built from real models instead of
procedural windowed boxes. Per-model source URLs are also in
`app/game/buildingCatalog.ts` (`LONDON_ENV_MODELS`), and
`tests/londonAssets.test.ts` byte-pins every committed file.

**Selection rule — pitched roofs on purpose, the inverse of Cairo's.** The five
Quaternius sources are exactly the `GableRoof` / `RoundRoof` / `_Roof_` models
the Cairo kit bans: a gable reads as European on sight, which is what a London
terrace wants. The stucco family re-converts the same five sources into
separate files (`modelLibrary` keys asset containers by URL, so one file cannot
carry both the brick and the stucco palette).

**Modified — recoloured and made matte.** `tools/style-london-terraces.mjs`
assigns the terrace family Victorian-red/stock-brick walls with slate roofs and
the stucco family a white-cream render with dark joinery;
`tools/style-london-towers.mjs` gives the towers three steel-blue glass
families; `tools/style-london-shops.mjs` remaps the shopfront atlases to brick,
cream fascia and slate. All three flatten the specular and bake provenance into
`asset.extras.curbsideRush`. CC0 permits modification; re-run each script to
regenerate.

The Quaternius models come from the **Ultimate Textured Buildings Pack**
(<https://quaternius.com/packs/ultimatetexturedbuildings.html> — licence page
re-verified CC0 on 2026-08-08), downloaded 2026-08-08 from the pack's
[official Google Drive](https://drive.google.com/drive/folders/1RE3qXhbE5yGS3t-xGFJ8GmOtTgCUF3LQ)
(`Models with Materials/OBJ`), bundled `License.txt` SHA-256
`83d8959f9fc56353ed571fbe2dc52e4bcd64508e2399501cd45ac2ce3df0bf8c` —
byte-identical to the copy hashed at the Cairo import. Each was converted from
OBJ + MTL by `tools/obj-to-glb.mjs` before styling.

| File | Source model | Source OBJ SHA-256 | Source MTL SHA-256 | Committed GLB SHA-256 |
|---|---|---|---|---|
| **props/london-terrace-a.glb** | `2Story_GableRoof_Mat` | `ed3a11cfdbf637d0f3512a52022122d6f7a7ef24a92e828ea6b812894234daca` | `452d56b002916ca9844e338b6d032d85cd1a8e9a56c213c9b4733181057ceecd` | `640b69020bbf84cc28376079619fd3d82dba87d9615d816f09d63b7004deb7e5` |
| **props/london-terrace-b.glb** | `2Story_RoundRoof_Mat` | `50b109ea88d34c300f0b80a5c81c6f688e3b53f69f25723e58ec547b36ec0355` | `2e2fe28fe6b7ed72133a4e851f4164b93e72ce1202f93724926a7c514ee0a6a9` | `91116d70319cf1f02523ee55724e00af57d73e2e13fe0705d6e0cab495171e9b` |
| **props/london-terrace-c.glb** | `4Story_Wide_2Doors_Roof_Mat` | `03984e13c98fee5009d5345b39a2da2239eca8ddee9fe9ab6170c12cebfd7f4e` | `a2987b6683c57feb333af6c6bb34387722a946c9a8b463f722fa8411c447b3a9` | `12f9f5ea8fb870f61b4616a0ec7937df778902c3e8aa24af0fae428a42f16643` |
| **props/london-terrace-d.glb** | `1Story_GableRoof_Mat` | `647671a27dd10b7d9e3246fb792dfbf4c4c1b5a71197d5e7809006239d0cda5f` | `cf360867b3cd427b7de605b58495a5361cfff2132d7551f16af8f80032ed4bb8` | `194994bcb7a9adac6778be430e218cbc3ba14b7d6f9d7d98e409ceda3047e414` |
| **props/london-terrace-e.glb** | `1Story_RoundRoof_Mat` | `7e2977c8df40757b5b4accac0477c844f1a607413b0425a447aec97ffe94ed75` | `1163516abcd47ddb81cbfdbf17046e006ebc64979d03530ecc0bc17669f3a424` | `20ab00901e2ab83c0c646a6a0274f0be7d7222fdbaa9b68457f08f1315710566` |
| **props/london-stucco-a.glb** | `2Story_GableRoof_Mat` | (as terrace-a) | (as terrace-a) | `6a1775b3d9f9373bab3387174500c71aed692cae371aac1ce361436c2f20ee56` |
| **props/london-stucco-b.glb** | `2Story_RoundRoof_Mat` | (as terrace-b) | (as terrace-b) | `1574c95fbcfc5070778e8c69271d33c1feee2adce32e55151b03ab8e4cc294fd` |
| **props/london-stucco-c.glb** | `4Story_Wide_2Doors_Roof_Mat` | (as terrace-c) | (as terrace-c) | `f7574c4acb2e8cc4bb34b3ee793fa0c818d6461cffe679f90171414524ccf371` |
| **props/london-stucco-d.glb** | `1Story_GableRoof_Mat` | (as terrace-d) | (as terrace-d) | `b1d1684c682e39044a063d8f7bfd7c6ad4ee5e88ef5265c3254ece41843da809` |

- **props/london-tower-a.glb, london-tower-b.glb, london-tower-c.glb**
  ("Skyscraper" ×3) — by **Kenney** (<https://kenney.nl>) via Poly Pizza
  (<https://poly.pizza/m/XST1j6kYsL>, <https://poly.pizza/m/JTsKOSB23Y>,
  <https://poly.pizza/m/jIRx0AhYOR>), released **CC0 1.0**. Copied 2026-08-08
  from the committed `nyc-tower-{a,b,c}.glb`, each verified **byte-identical to
  its original Poly Pizza source GLB** (tower-b's original re-downloaded from
  <https://static.poly.pizza/11f09e73-8df5-4ad8-b721-ff1315948a5e.glb> to
  confirm). Source SHA-256s
  `43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c`,
  `9e4587c640afbb45b3def91b3a9fd40c7b705391c9668e304f245886d1cb1cdd`,
  `6137b8892acea9711f305d8c7f2adafb0eec5d51ec489fd8c3cb754fac28b080`;
  committed GLB SHA-256s
  `8a7de989d38632dad453f96c0d9924bbcec00acf5fda77090fde3ce2aba4c91a`,
  `49c6d1317007b5bf396d4ab88041509924ceccc7ce1a11d6cf51cd9543fc54a7`,
  `b0ad5bc830ca8c0255734e100515d7bc02bc6ca509e40a149001ce5a62cc04cc`.
  Restyled steel-blue by `tools/style-london-towers.mjs`; the City of London's
  tower cluster.
- **props/london-shop.glb, london-walkup-a.glb, london-walkup-b.glb**
  ("Building" ×3) — by **Kay Lousberg**, City Builder Bits pack via Poly Pizza
  (<https://poly.pizza/m/EL3ePInr1N>, <https://poly.pizza/m/qOhhGLftam>,
  <https://poly.pizza/m/T3oyvK6VEU>; creator page
  <https://kaylousberg.com/game-assets/city-builder-bits> — licence line
  re-verified CC0 on 2026-08-08), released **CC0 1.0**. Copied 2026-08-08 from
  the committed `cairo-shop.glb` / `cairo-walkup-{a,b}.glb` (SHA-256s
  `8c4f9a9f613d5d68c0f3d001efa5191946368bbddc193790634383d73457a520`,
  `bfe108c90afb5ba5faa47b976dd8f37e1f98065f4d669a9204656bb3bd1b7ea3`,
  `d63a6174590d3b631f7f4da7edd7b76f14032fbe4dbcdd3c05426c8928f22555`) so that
  `tools/cairo-shopfront.mjs`'s corrections — the flattened awning stripe and
  the deleted American fire hydrant, neither of which belongs on a London
  street either — carry over; original download hashes are recorded in those
  files' own entries above. Committed GLB SHA-256s
  `1b70d4b0ade5a59d9542e157ca801ce0b2d438907dc04c802c8bf1bf31a88cee`,
  `5bb3c8791147a503045d626ac83e6ae7eaada83be6da8f04859f75cb9c066496`,
  `bb94180b3fdf24859c12fac98e207ca538f95915fe22ea494a4e4a3fd926c2da`.
  Remapped to the London high-street palette by `tools/style-london-shops.mjs`;
  shopfront parades on the high streets.

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
  Also placed by the Zamalek street wall (`buildingSets.ts`) as the corner
  shop breaking up the walk-up runs.
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

### Park planting kit (CC0)

Added so parks are planted with real models rather than procedural cones
(issue #206). Placement, scoping and per-city tinting live in
`app/game/natureCatalog.ts`; `tests/natureAssets.test.ts` pins every committed
byte.

All of these come from **Kenney**'s **Nature Kit** version 2.1
(<https://kenney.nl/assets/nature-kit>, zip
<https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip>),
downloaded 2026-07-31. Released **CC0 1.0**, stated on the pack page and in the
`License.txt` bundled inside the zip: *"License: (Creative Commons Zero, CC0)
… free to use in personal, educational and commercial projects. Support us by
crediting Kenney or www.kenney.nl (this is not mandatory)."* Credit is given
here anyway. There is no free/paid split — the whole kit is CC0.

**Why this kit.** All 329 of its GLBs contain **zero textures** — materials are
named swatches with a `baseColorFactor` and nothing else. That is what lets one
committed file serve all four city palettes through per-instance colour, and it
is why an atlas-textured nature pack was not taken.

**Modified — matte and recoloured**, by `tools/style-nature-pack.mjs`. Two
corrections, both to the JSON chunk only so the binary chunk stays byte-identical
to the source: the kit ships every material at `metallicFactor: 1,
roughnessFactor: 1`, which Babylon renders as dark plastic; and its palette is a
toy blockset rather than a landscape — `leafsGreen` is linear (0.16, 0.79, 0.67),
a bright turquoise, and `woodBark` is orange. Because the whole kit shares 23
material names, one mapping by name recolours all of it consistently. Provenance
is baked into `asset.extras.curbsideRush`. CC0 permits modification; re-run the
script against a fresh download to regenerate.

Committed as, in catalogue order: **nature-tree-broadleaf.glb**
(`tree_default`), **nature-tree-oak.glb** (`tree_oak`), **nature-tree-tall.glb**
(`tree_tall`), **nature-tree-small.glb** (`tree_small`),
**nature-conifer-tall.glb** (`tree_pineTallB`), **nature-conifer-round.glb**
(`tree_pineRoundC`), **nature-palm-tall.glb** (`tree_palmTall`),
**nature-palm-short.glb** (`tree_palmShort`), **nature-bush.glb**
(`plant_bush`), **nature-bush-large.glb** (`plant_bushLarge`),
**nature-bush-clipped.glb** (`plant_bushTriangle`), **nature-flower-red.glb**
(`flower_redA`), **nature-flower-yellow.glb** (`flower_yellowA`),
**nature-grass-tuft.glb** (`grass`), **nature-grass-tuft-large.glb**
(`grass_large`), **nature-rock-large.glb** (`rock_largeA`),
**nature-rock-small.glb** (`rock_smallB`), **nature-obelisk.glb**
(`statue_obelisk`). Eighteen files, ~170 KB in total.

### Tokyo restyle-backbone kit (CC0)

Added so the "downtown/zakkyo backbone" street wall has street-level variety
beyond the Sketchfab pack's own towers (Tokyo authenticity plan, phase P3a —
see the "Tokyo" section above for scope). Every file is a re-import of a
source *already* committed to this repo for another city, restyled for
Tokyo — the same pattern London used reskinning Cairo's own CC0 sources, one
point further removed (Tokyo restyles Cairo's/NYC's already-committed
copies, not the original Poly Pizza/Quaternius downloads directly). Per-model
source URLs are also in `app/game/buildingCatalog.ts` (`TOKYO_ENV_MODELS`),
and `tests/tokyoAssets.test.ts` byte-pins every committed file.

**Modified — two palette paths, picked per source shape**, both by the new
flat-palette path in `tools/style-tokyo-buildings.mjs` (extending the
Sketchfab-normalization pass that file already had for P1's textured
imports):

- `tokyo-tower-a.glb` and `tokyo-block-{slim,small,4story}.glb` carry named
  solid materials with no baked texture (Kenney/Quaternius), so each takes
  the **direct material-colour assignment** path
  (`tools/style-london-terraces.mjs`'s own shape): steel-blue-dark for the
  tower (a glassy scramble-backdrop slab), charcoal/tile tones with a light
  fascia band for the two narrow-frontage zakkyo mid-rise blocks, cool grey
  for the ekimae mixed-use 4-storey block.
- `tokyo-walkup-a.glb` and `tokyo-walkup-b.glb` carry one embedded
  swatch-atlas texture (KayKit), so they take the **texture-recolour** path
  (`tools/style-cairo-residences.mjs`'s own shape, but a different tone
  function): every pixel is desaturated toward a near-neutral cool grey
  while its own *lightness* is preserved exactly (`tokyoManshonGreyTone` in
  the tool), rather than Cairo's warm hue-band remap — the plan's own words
  for this restyle are "white/grey render, dark window frames", i.e. the
  goal is near-zero saturation, not a different target hue. Preserving
  lightness is what keeps window-frame swatches (already darker than wall
  swatches in the source atlas) reading dark after the recolour. Geometry
  (including each model's own rooftop water tank) is untouched.

Every model is also given a flat matte material pass
(`metallicFactor: 0, roughnessFactor: 0.88`) and provenance baked into
`asset.extras.curbsideRush` (`style: "tokyo-block-v1"`). CC0 permits
modification; re-run `tools/style-tokyo-buildings.mjs` to regenerate.

| File | Copy of (already committed) | Source model | Source SHA-256 | Committed GLB SHA-256 |
|---|---|---|---|---|
| **props/tokyo-walkup-a.glb** | `cairo-walkup-a.glb` | "Building" by Kay Lousberg (<https://poly.pizza/m/qOhhGLftam>) | `a98d4fa6bf1e261da717fbdeef7937ef7578af86db3ba31a14296d814cf44e65` | `9cebb30c4bdc100cfa6920afd29c614234f46f979ccda1cb0fbd47c9d6df01c7` |
| **props/tokyo-walkup-b.glb** | `cairo-walkup-b.glb` | "Building" by Kay Lousberg (<https://poly.pizza/m/T3oyvK6VEU>) | `ecda4d8e3a89bb751f61e179725ca59d2a19f7f3aa88fedd4fc371eb8f0eaede` | `45779172dd14f3a41441b34b34041766ebff31b8e06ba80393b5dace9f789171` |
| **props/tokyo-tower-a.glb** | `nyc-tower-a.glb` | "Skyscraper" by Kenney (<https://poly.pizza/m/XST1j6kYsL>) | `43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c` | `21bb529bb66b64e174ee2e110c81fb1426b77239400ab246c007ffa3d29d7917` |
| **props/tokyo-block-slim.glb** | (re-converted, see below) | `3Story_Slim_Mat` by Quaternius | obj:`778673a3cd8508d7b484c2b243fde8b59ebda9b507dcbf9198daa3a02429fe3f` mtl:`6f97086bad010e876d8bc35b0a51d9cabca187eca8250ce77e412a332ceb4692` | `03e01c862605a6dbe99ee405f72ac06f77770c832d370b39e31226bbe5dee577` |
| **props/tokyo-block-small.glb** | (re-converted, see below) | `3Story_Small_Mat` by Quaternius | obj:`26377da6033df73d46eed0a1953ac149e07c93eb4b10d0587417e16cd7bd8863` mtl:`cac01cb1df1d5022e574e03ed02e73b6c199f6f55350b1f411fb9906386390fa` | `7c24defc0bd2b2da1be718394a0101b19c556fa7b0f5d96182832e7c87ff8068` |
| **props/tokyo-block-4story.glb** | (re-converted, see below) | `4Story_Mat` by Quaternius | obj:`d326d20f0c29ad2499132dd7773aacab675946efadf18f56a926a5a8d004366a` mtl:`df1c8f0fdff17e0fecffec423d57f240011a024d9d16b16ff092dfe8e72fb44a` | `b998bb3ce5141037d3a2d53f440ce3ed4a7abfb6b0fd340e4cf73f8da5809f1e` |

`tokyo-walkup-a/b.glb` are direct copies of the committed `cairo-walkup-a/b.glb`
(themselves unchanged since Cairo's own P0 import — `modelLibrary` keys asset
containers by URL, so Tokyo needs its own file even though the starting bytes
are identical); the "Source SHA-256" column above is that same original
KayKit download's hash, already recorded under Cairo's own entry earlier in
this file. `tokyo-tower-a.glb` is a direct copy of the committed
`nyc-tower-a.glb` the same way. `tokyo-block-{slim,small,4story}.glb` are
fresh conversions (`node tools/obj-to-glb.mjs <in.obj> <out.glb>`) of the
**same** Quaternius Ultimate Textured Buildings Pack OBJ+MTL pair already
used for `cairo-block-{slim,small,4story}.glb`
(<https://quaternius.com/packs/ultimatetexturedbuildings.html> — licence page
re-verified CC0 on 2026-08-14), re-downloaded 2026-08-14 from the pack's
[official Google Drive](https://drive.google.com/drive/folders/1RE3qXhbE5yGS3t-xGFJ8GmOtTgCUF3LQ)
(`Models with Materials/OBJ`) — the "Source SHA-256" column's obj/mtl hashes
above came back byte-identical to Cairo's own recorded hashes for the same
three models, confirming the same pack; bundled `License.txt` SHA-256
`83d8959f9fc56353ed571fbe2dc52e4bcd64508e2399501cd45ac2ce3df0bf8c`, also
byte-identical to every prior download of this pack.

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

### Tokyo street-wall kit (CC-BY 4.0)

20 Sketchfab models: 13 from phase P1 (see the "Tokyo" section above for
scope) plus 7 from phase P3a — six `tokyo-zakkyo-{a..f}.glb` files split from
one 19-building "Asian Themed Low Poly Night City Buildings" pack, and the
optional `tokyo-nippori-bldg` real-Tokyo photogrammetry hero. Every one is
**CC-BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>) — a
plain-attribution licence, the same obligation as the CC-BY 3.0 kits above,
one point release newer. Per-model Sketchfab source URLs are also in
`app/game/buildingCatalog.ts` (`TOKYO_ENV_MODELS`), and each model's required
credit travels in that catalogue's `attribution` field.

**Downloaded** 2026-08-14 as Sketchfab's autoconverted glTF export (a
`.gltf` + `.bin` + separate image files, zipped). **Packed** into one
self-contained glb by `tools/pack-gltf.mjs` (this repo's hand-written
glTF→glb packer, the sibling of `tools/obj-to-glb.mjs` — written rather than
an npm converter for the same byte-stability reason: `tests/tokyoAssets.test.ts`
pins the committed SHA-256 of every file). **Normalized** by
`tools/style-tokyo-buildings.mjs`:

- Every embedded texture whose longer side exceeded 1024 px (several ship at
  2048², the izakaya at 4096²) was downscaled to fit within 1024 px via
  `sharp` (re-encoded in its original format) — a real new devDependency,
  not previously declared: `sharp` was already resolving into `node_modules`
  as a transitive dependency (`miniflare`, itself a dependency of `wrangler`,
  which this repo already depends on for `npm run dev`, depends on it
  directly), so declaring it explicitly in `package.json` makes that
  existing resolution reproducible via `npm ci` rather than incidental — see
  the tool's own header for the full reasoning.
- A material with no `metallicFactor` and no metallic/roughness texture — the
  glTF core-spec default (metallic = 1) renders it chrome-mirror — was
  normalized to `metallicFactor: 0`. Fired on three of `tokyo-house-d`'s
  small hardware materials (a hinge, a door handle, a railing).
  Texture-driven PBR materials were left untouched.
- Three models shipped a bundled diorama/street-furniture node unrelated to
  the building itself, unlinked from the scene graph: `tokyo-house-d`'s
  `Carretera` (a flat paved-street slab 4504×0×2266 native units — far
  larger than the house itself) and two flat dirt-ground patches
  (`Tierra_G`, `Tierra_P`); `tokyo-izakaya`'s `Floor` (a flat 1272×0×1272
  ground plate); `tokyo-shop-b`'s generic streetlamp pair
  (`StreetFarol2_2`/`StreetPoste2_3`, positioned off the shop's own
  footprint — this map already scatters its own streetlights procedurally).
  A scene-graph unlink, not a full mesh/accessor/material/image
  garbage-collection pass — every stripped node here is geometrically tiny
  and shares its material/texture with the rest of its model, so the dead
  JSON bytes left behind are negligible next to the texture-downscale
  savings above.
- Two models' emissive materials measurably would not bloom under this map's
  real night pipeline (`bloomThreshold: 0.72`, post-`exposure` 1.55× —
  `render/babylonGameSession.ts`) as shipped — checked against the actual
  formula (`extractHighlights.fragment`'s
  `luma = dot((0.2126,0.7152,0.0722), color * exposure)`, threshold-gated),
  not picked by eye: `tokyo-izakaya`'s sign glow (a saturated red pixel
  region, measured raw linear luma ≈0.22 — red alone is capped at 0.2126 of
  the luma weight no matter how saturated) and two of `tokyo-shop-b`'s four
  emissive materials (also near-pure red, raw luma ≈0.24-0.25). Both raised
  via `KHR_materials_emissive_strength` (3.2× and 2.2× respectively) rather
  than diluting the red with green, which would shift the intended hue.
- Provenance baked into `asset.extras.curbsideRush`:
  `{style, author, title, license: "CC-BY 4.0", sourceUrl, sourceSha256,
  modifications}`, the same shape `tools/style-london-terraces.mjs` uses.

**Phase P3a's own normalization (the zakkyo split + the Nippori hero):**

- The 19-building source pack ships 19 real buildings plus 7 `RED_FLARE`/
  `Flare` lens-flare glow cards — a matte-painting VFX trick baked into the
  source scene's own hero render, unrelated to any building's architecture.
  All 7 are stripped entirely by `tools/split-asian-city-pack.mjs` itself
  (before any file is even written), the same "diorama/street-furniture,
  unlinked from the building" category as the bullet above, just resolved a
  step earlier in the pipeline since the source glTF isn't packed into one
  glb yet at that point.
- Every one of the 19 buildings' own container node carries a substantial,
  non-identity `matrix` (its own ~100x corrective scale + rotation + a large
  translation, evidently left over from the artist's own Blender/FBX
  pipeline) — all 19 mutually overlap in world space when that matrix is
  applied (measured: every one of 171 possible pairs overlaps), i.e. this is
  a Sketchfab "kit" hero shot with every piece piled at the origin for one
  thumbnail, not a laid-out scene. A first version of the split tool assumed
  these nodes were identity-transformed (checking only for
  `translation`/`rotation`/`scale`, never `matrix`) and added its own
  `translation` alongside the existing `matrix` — invalid glTF, silently
  ignored by the loader, which would have shipped every building at its
  original scattered position. The shipped tool instead loads the pack under
  a real Babylon `NullEngine` and bakes each kept building's full world
  transform into fresh vertex data (`Mesh.MergeMeshes` on that one mesh
  alone, `getBuildingMaster`'s own recipe) before doing anything else — see
  the tool's own header for the full story. The split tool partitions the 19
  by material family (10 `BACKGROUND_BUILDINGS_1` buildings, 9
  `BACKGROUND_BUILDING_2`), deals each family by measured world-space height
  into 3 files apiece (six total, sizes [4,3,3,3,3,3]), and lays each file's
  buildings out left-to-right along world X — grounded at Y=0, centred on
  Z=0, the whole row re-centred on X=0 — by adding the offset directly into
  each building's already-baked position data (no node transform at all, so
  there is no repeat of the matrix-conflict bug to hit). Materials/textures/
  images are pruned to exactly what each file's kept buildings reference
  (real savings: a single-material file needs only 4 of the pack's 8 texture
  maps); geometry is rebuilt into fresh, per-building accessors/bufferViews
  sized to exactly what each file needs, rather than embedding the whole
  shared source buffer.
- The source's own baked-in `KHR_materials_emissive_strength: 2` was
  measured (not eyeballed) against this map's real
  `bloomThreshold: 0.72`/`exposure: 1.55` the same way the P1 bullet above
  did: decoding every pixel of both emissive PNGs (2048², pre-downscale) to
  linear and averaging luma over the "is this a glow pixel" population (raw
  luma > 0.05) gives a representative "typical readable window" luma of
  ≈0.23 (`BACKGROUND_BUILDINGS_1`) / ≈0.27 (`BACKGROUND_BUILDING_2`) — at
  the source's own strength 2 that computes to 0.71/0.84 against the 0.72
  threshold, i.e. the dimmer family barely fails to bloom and the brighter
  one clears with almost no margin. Raised to 3.5×/3.0× respectively (a
  real ~1.75× margin) via the same `KHR_materials_emissive_strength`
  mechanism, replacing rather than stacking with the source value.
- `tokyo-nippori-bldg` is a photogrammetry bake: one
  `KHR_materials_unlit` material with a single 8192² baseColor JPEG (its own
  lighting is already in the pixels) — downscaled to ≤1024px like every
  other embedded texture in this kit, nothing else to normalize.
- Provenance baked the same shape as P1's own entries above; every
  `tokyo-zakkyo-*` file's `title` records exactly which of the 19 original
  buildings it carries (`tools/style-tokyo-buildings.mjs`'s own TARGETS
  list has the authoritative per-file list — re-run
  `tools/split-asian-city-pack.mjs` to reproduce/verify).

Reproduce from clean sources: re-download each row's Sketchfab glTF export.
For P1's 13 and the Nippori hero: `node tools/pack-gltf.mjs
<dir>/scene.gltf public/models/props/<id>.glb`. For the zakkyo pack: extract
the download, then `node tools/split-asian-city-pack.mjs <extracted-dir>`
(writes all six `tokyo-zakkyo-*.glb` in one run — no separate pack-gltf.mjs
step, the split tool embeds directly). Then, for every file,
`node tools/style-tokyo-buildings.mjs`.

| File | Source title | Author | Source page (`sketchfab.com/3d-models/…`) | Original archive SHA-256 | Committed GLB SHA-256 |
|---|---|---|---|---|---|
| **props/tokyo-house-a.glb** | Japanese Residential Home 01 | Morrissey Alexander | `japanese-residential-home-01-d690f83d8e8d48e6a532bebe84901595` | `8788dc786017a99a931307f8adfd8c2c4961423b5470324dd80b2ff6837131f5` | `c88e4970840a6f19ba8752f5289a87be80b3bae452e647445d5815b4940e131f` |
| **props/tokyo-house-b.glb** | Japanese Residential Home 02 | Morrissey Alexander | `japanese-residential-home-02-c31697f09152453cb3ed215482e7a810` | `825aed04802350d83503e84d39a4012f8c34395da7a28d4ead74ace200edc9a9` | `6b8e20e0b733da3616640485e52ddc49e9b77dbb024c1d55c38a62537ea15def` |
| **props/tokyo-house-c.glb** | Japanese Residential Home 03 | Morrissey Alexander | `japanese-residential-home-03-1c53f4f37fc44c32a8874464025aea48` | `911b4a5d52872135e73136ffccaef7c4d30daabbbbfca3acfe128e547903404e` | `0c0e4eaa7fcdbae349ef9cb2a8041cbcdf28d863162494fe440619864d9b1fee` |
| **props/tokyo-house-d.glb** | Tokyo Japanese House / Casa Japonesa [Low Poly] | SitoNyaa | `tokyo-japanese-house-casa-japonesa-low-poly-05e04ee0c3d04ff9a2fe4c348b3c1bcd` | `cfe54e8c25daf66cb2c43a4519c6506ee86708b44744bf4709fcc7a3a8e8d2c0` | `1c1f2e79417cf8b5b2ab5779f8cbac7424cf764b981d30f1af0a58f798fb177f` |
| **props/tokyo-apato-a.glb** | PSX Japanese Apartment | DeadFrame Studio† | `psx-japanese-apartment-0a12452df55c4e3687759732c81a8437` | `c4cae7d69a95f07b190fa236c01eb308c2b9ede31d7c51985e09a5e6f377578e` | `80dd62de4789d5f2798def067073e3f5f4751308ca9b2d9f6057d053c687d157` |
| **props/tokyo-apato-b.glb** | Grey Japanease Apartment | Kasuga | `grey-japanease-apartment-8589efeb25284d709934497e02a25421` | `8969bd766b81998af72cb91d116fcb0c8f24250dbef3bd350b2afa5821c79295` | `db408a486fd98a1551d84c5fd92f6ea9881ae3d491046b16bd2b8eb52576f433` |
| **props/tokyo-konbini.glb** | Konbini | Arthur Sauvaget | `konbini-6f66ee45303e4b90b1bcd13fad484269` | `cd48ed4f594929f5ded7a85ee406b961f1f0ea3897288ba2daff1af3649c1763` | `3abc6babc8f48dd605cd5f8cf0d21f04b6a64e9da101e9761626ddd24554f53e` |
| **props/tokyo-shop-a.glb** | Japanese Store | Nick.Stark | `japanese-store-78396a70304b412d9bc8e3955891f6cd` | `342dda42209437ad61404d2ef6f8e5e714ad330362b9a669abc1a10fe48fcff3` | `e8405c3f5e13850436d6e2cc09f847cc40031513f8b1d884165210917c6265cc` |
| **props/tokyo-shop-b.glb** | Japanese low poly building store | KingKusak | `japanese-low-poly-building-store-565dc84823834d4884bef69944e0d4be` | `f60efe983d8270a78b8f63f7a303c9ac3e11c885d22946a6ebf437c468408409` | `6f301e6fdccf79607a645dbf9cd9b131c2708769a7f8b9a6c9a09f4f6fced172` |
| **props/tokyo-shop-c.glb** | Old Japanese Store | Frid.blend | `old-japanese-store-d3442a89f7ff43ed9867d305b8951be0` | `f3fb1f62142511d7787f50acad4ea07429915f83f02f1d3422808d371cbc0946` | `8090b33f73ffc9ec049bec181d0dbe25fc7acc338c748c518f77223f81cdc41b` |
| **props/tokyo-shop-d.glb** | Japanese Shop 3 | Christian Camelo | `japanese-shop-3-b8c9864f973a491fbfdc6dc0c96ed58e` | `16558727c8ef82c9d8b578e026af27240aa48b6a171db898a88e853c70f78eb8` | `1607578094db7934beb28ded8e2fc7a56978fc13792f090103e5ea63c8e59528` |
| **props/tokyo-izakaya.glb** | Izakaya - Low Poly Building | BenMaher | `izakaya-low-poly-building-3f43e5429171408e9bd19553ea813364` | `5336a59fd4a2c412b2650c97350585fa4cadb7c688c3075f1f5384d88d4343d8` | `deb7798951e5d8004b6adf3ff121fed339189544af49e29e8137f0a83a883d10` |
| **props/tokyo-ramen.glb** | Ramen Shop | Naitogosuto | `ramen-shop-4d189bf2710f422ea287718f968cea68` | `2dd4df0a181e3d6aa6c5558ee2dcc481a22f410914a291e0719d27e85bce1b3a` | `50e13b3dd3eea88705bbf6372a768a26ddd82e2a185f0204c848fa7c3fec2cbe` |
| **props/tokyo-zakkyo-a.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `723514e4d286cfcd5c7e1d089554aca2d0e1ac2d422089f38d5776e6c2789c0a` |
| **props/tokyo-zakkyo-b.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `3a5fdc7d896451c348f5e3289c0d060210c49c66003830fffc29c77b62afbffc` |
| **props/tokyo-zakkyo-c.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `583edc1b9a78697f47332656f74dd14f11bcf55c3ca8b385d0cdccb01cd978b9` |
| **props/tokyo-zakkyo-d.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `06d659447687e4a38afbc36bcb9431b0cfa10b418c04ecb2b73de9690f700e97` |
| **props/tokyo-zakkyo-e.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `4141a649e1064bfa7b4f58d436d7e2f168fcae171324b18959b595c55c7b4cdd` |
| **props/tokyo-zakkyo-f.glb** | Asian Themed Low Poly Night City Buildings‡ | 99.Miles | `asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0` | `2b1eaf09fc5fc9d9283eebd749decc25b65b0ba6f27abddf7b1dc364443aa5e9` | `e6c451821ec695d9d13489d031a4ffea5e0369f120bcde4fc10de9c3b558ada8` |
| **props/tokyo-nippori-bldg.glb** | Nice building in Nippori：日暮里のいいビル§ | kazugoru | `nice-building-in-nippori-8e82ddace3af4b0681764f2cbcb77ff7` | `eec70c5993f89fd9ea6cffe5b10d4505a5e13aaac0d7a87a9f4c5d963dbe01fb` | `3ef267714635cba4b15945715b06b13a6908fb51142857f8c910ef38aa511125` |

† `tokyo-apato-a`'s author is corrected from the plan's research manifest
("Shazly"): Sketchfab's own embedded `asset.extras.author` on the downloaded
export — freshest, authoritative, baked server-side into the file — says
"DeadFrame Studio" for this exact uid/model. Credited as DeadFrame Studio here
and in `buildingCatalog.ts`.

‡ All six `tokyo-zakkyo-*.glb` files are split from this ONE 19-building
source archive (`tools/split-asian-city-pack.mjs`) — the "Original archive
SHA-256" column is identical across all six rows on purpose, since there is
only one archive. See the split's own bullet above for which of the 19
original buildings landed in which file.

§ `tokyo-nippori-bldg` additionally carries a Sketchfab "NoAI" flag (the
model page states it may not be used to train generative-AI datasets),
layered on top of its CC-BY 4.0 licence. That is not an NC/ND/SA term and
does not fail this plan's licence bar (section 5.1), but it is a real,
unusual extra restriction — recorded here so it stays visible to anyone
auditing this repo's licences, and worth knowing before this optional hero
is ever used for anything beyond rendering it in-game (e.g. it should not be
fed to any future asset-generation/training pipeline this project might
build).

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
- **`public/audio/music/*.mp3`** (33 tracks currently shipped). The original 14 were
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

  A second batch — three more Cairo pieces and one NYC piece — was downloaded
  from Suno and supplied by the project owner for this project on 2026-08-02.
  Same embedded artist, `rykard12`, and the same paid-plan terms as the batch
  above. Tests pin each repository copy to the exact SHA-256 of the supplied
  master, as with the first Cairo batch.

  A third batch — four more Cairo-only pieces — was downloaded from Suno and
  supplied by the project owner for this project on 2026-08-02, same embedded
  artist and paid-plan terms again. One master's original download name was
  Arabic (`ليالي القاهرة.mp3`, "Cairo Nights"); unlike `cairo-maadi-road.mp3`
  above, this time both the filename *and* the title were made English before
  import — the Downloads copy was renamed to `Cairo Nights.mp3` first, so nothing
  Arabic exists in either location. Tests pin each repository copy to the exact
  SHA-256 of the supplied master.

  A fourth batch — nine London-only pieces — was downloaded from Suno and
  supplied by the project owner for this project on 2026-08-08, same embedded
  artist (`rykard12`) and paid-plan terms as the batches above. All nine
  Downloads filenames were already English and title-cased (e.g. `Peckham
  Market Route.mp3`); only the URL-safe rename to lower-kebab-case with a
  `london-` prefix happened before import, which is also where the apostrophe
  in `Heath to Regent's Park.mp3` was dropped to make
  `london-heath-to-regents-park.mp3`. Tests pin each repository copy to the
  exact SHA-256 of the supplied master.

  Tracks are matched to the city they were written for, and a city plays only
  its own. Two pieces written for Calais (`calais-coast-run-1/2.mp3`, Suno
  `track4`/`track5`) were removed with that map. One Cairo piece,
  `cairo-nile-loop-drive.mp3` (Suno source `Nile Loop Drive`, part of the
  2026-07-29 batch), was pulled from Cairo's pool and deleted from the repo on
  2026-08-02 at the project owner's request — no map change involved, the
  owner simply no longer wanted it in rotation. Original download names are
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
  | `tokyo-setagaya-glide.mp3` | Setagaya Glide | Tokyo | track6 |
  | `tokyo-setagaya-morning.mp3` | Setagaya Morning | Tokyo | track8 |
  | `cairo-maadi-road.mp3` | طريق المعادي | Cairo | طريق المعادي |
  | `cairo-october-bridge-glide.mp3` | October Bridge Glide | Cairo | October Bridge Glide |
  | `cairo-heliopolis-after-dark.mp3` | Heliopolis After Dark | Cairo | Heliopolis After Dark |
  | `cairo-corniche-after-sunset.mp3` | Corniche After Sunset | Cairo | Corniche After Sunset |
  | `cairo-flyover-dawn.mp3` | Flyover Dawn | Cairo | Flyover Dawn |
  | `cairo-dokki-before-dawn.mp3` | Dokki Before Dawn | Cairo | Dokki Before Dawn |
  | `cairo-corniche-loop.mp3` | Corniche Loop | Cairo | Corniche Loop |
  | `nyc-glass-arcade-drift.mp3` | Glass Arcade Drift | NYC | Glass Arcade Drift |
  | `cairo-nights.mp3` | Cairo Nights | Cairo | ليالي القاهرة |
  | `cairo-dokki-after-midnight.mp3` | Dokki After Midnight | Cairo | Dokki After Midnight |
  | `cairo-after-midnight.mp3` | After Midnight Cairo | Cairo | After Midnight Cairo |
  | `cairo-after-midnight-2.mp3` | After Midnight Cairo (Second Edition) | Cairo | After Midnight Cairo - Second Edition |
  | `london-peckham-market-route.mp3` | Peckham Market Route | London | Peckham Market Route |
  | `london-damp-brixton-turn.mp3` | Damp Brixton Turn | London | Damp Brixton Turn |
  | `london-heath-to-regents-park.mp3` | Heath to Regent's Park | London | Heath to Regent's Park |
  | `london-camden-roundabout-queue.mp3` | Camden Roundabout Queue | London | Camden Roundabout Queue |
  | `london-clockwork-on-the-thames.mp3` | Clockwork on the Thames | London | Clockwork on the Thames |
  | `london-westminster-morning-drive.mp3` | Westminster Morning Drive | London | Westminster Morning Drive |
  | `london-kew-to-putney.mp3` | Kew to Putney | London | Kew to Putney |
  | `london-overcast-viaduct-run.mp3` | Overcast Viaduct Run | London | Overcast Viaduct Run |
  | `london-rain-over-vauxhall.mp3` | Rain Over Vauxhall | London | Rain Over Vauxhall |
