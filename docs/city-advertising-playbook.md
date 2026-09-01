# City advertising, signs and billboards

Use this playbook when adding a dense commercial-sign layer to another map.
The current source pairs are `cairoAdvertising.ts`/`render/cairoAdvertising.ts`
and `tokyoAdvertising.ts`/`render/tokyoAdvertising.ts`.

The architecture and safety checks are reusable. The mounting language,
creative direction, density and local-language mix are not. Cairo and Tokyo are
deliberately different systems.

## Start with the city silhouette

Advertising is a city layer, not a handful of props around one landmark. Study
driving-height references and decide which physical forms make that place read:

- Cairo uses repeated pole banners, freestanding skyline boards, parapet signs
  and bridge gantries.
- Tokyo uses building-mounted campaign posters and screens, rooftop screens,
  projecting tenant kanban, tenant-directory ladders and storefront fascia.
  It has no advertising poles, pedestals, parapet signs or bridge gantries.

Tokyo's small tenant signs are not filler around the “real” billboards. Their
repetition and vertical stacking create the street wall; broad screens supply
punctuation only on procedural commercial hosts. Residential-style hosts,
identified from their authored building set or residential asset model, receive
only narrow projecting blade kanban; non-residential authored/modelled hosts may
also carry fascia and directories, but never campaigns. Reusing Cairo's roadside
structures or glossy dark-background product-packshot art would erase that
distinction.

Judge the result from the chase camera while moving in both directions. A sign
that looks good from a free camera directly in front of it may be edge-on,
occluded or too small for a driver.

## Keep copy auditable and artwork text-free

Store every campaign headline and subline in a table such as
`CAIRO_AD_CREATIVES` or `TOKYO_AD_CREATIVES`. Tenant names and details belong in
their own table when they are a separate sign family. The content rules are:

- use fictional, generic campaigns and businesses with no real names or logos;
- exclude sexual, political and religious content;
- lead with the destination's language, with only a deliberate minority of
  bilingual copy; and
- keep generated artwork free of baked words, pseudo-writing, numbers and
  marks. Runtime text is reviewable and does not inherit ImageGen lettering.

A blacklist and language-count test do not prove the imagery safe or original.
Human-review every source cell as well as the authored copy.

Compose copy on separate `DynamicTexture` planes. Cairo gates rendering on its
bundled shaping-capable Arabic font; Tokyo uses the bundled Noto Sans JP subset
through `ensureJapaneseCanvasFontLoaded`. Keep image and copy planes separate so
either can change without regenerating the other.

Generated/imported art needs provenance in `CREDITS.md`; retain the exact shared
brief and ordered subject list beside editable source cells.

## Atlas cells are an interface

Never assume generated atlas cells form an exact mathematical grid. Cairo's
original 2-by-4 source had irregular boundaries, so `cairoAdAtlasUv` records
measured pixel edges. Tokyo's portrait and landscape atlases are built
mechanically from normalized cells, and `tokyoAdAtlasUv` applies a pixel inset.
In both cases account for Babylon's `invertY`, use clamp addressing and test
every crop for neighbouring-cell bleed.

The visible textured face of Tokyo's box-based masters is the Babylon `+Z`
face. Its campaign art, campaign copy and every tenant texture must invert both
U and V; fixing only V leaves Japanese copy mirrored even when art looks upright.

Pin committed atlas dimensions and checksums. If the source art changes, rerun
the importer and update the checksum deliberately; do not replace runtime bytes
without proving the crop contract still holds.

## Planning and rendering stay separate

The city planning module owns copy, deterministic density rules, placement
geometry and collision/visibility decisions. The render module owns Babylon
meshes, materials, textures and instancing. `CITY_RENDER_REGISTRY` attaches the
builder to exactly one map.

Pass the exact session `BuildingLayoutPlan` to every consumer. Do not recompute
buildings with a hard-coded traffic seed: career and free-drive can have
different authored inputs. Both advertising planners cache against the plan
object so rendering and roadside reservations see the same result.

Use conservative spatial broadphases once reservations grow. Index every cell
touched by an envelope's AABB, restore deterministic candidate order after the
query, then run the exact geometric test. Indexing only an object's centre can
miss a long face crossing the query cell.

## Coverage is a measured contract

Do not optimize for maximum separation between a few props; that creates a map
where a driver sees nothing for minutes. Test road coverage and approach
frequency across the full map:

- the spawn district, signature core, remote arterials and ordinary satellite
  streets all receive signs;
- long commercial roads have repeated hosts rather than one representative;
- several sign families can share one building when the city calls for a
  stacked frontage; and
- placements have deterministic unique IDs and stable creative rotation.

Tokyo classifies road-facing hosts as `core`, `corridor` or `satellite`. The
spawn district and downtown are both core; selected host spacing is
approximately 7 m, 19 m and 38 m respectively. Core hosts may carry several
projecting blades; non-residential hosts may also carry fascia or a directory,
while campaign posters/screens repeat at a lower cadence only on procedural
hosts. The current shipped plan
has 4,288 placements on 1,450 distinct buildings across 99 roads. The unique-host
count matters as much as the placement count: stacking more signs on the same
few facades does not create citywide continuity.

Exact totals can change with the building plan. Preserve density floors,
represented-road floors and near-spawn/core approach counts rather than relying
only on one global count.

## Mounting and visibility are the same decision

Choose actual road-facing structural OBB faces from the session building plan.
Tokyo accepts a host only when its face is within 22 m of a surface road, points
toward it and has a clear segment from the road projection to the facade; a
building hidden behind another building is not a host. A corner building may
contribute one clear face to each adjacent road, which prevents a sign-rich
cross street from leaving the player's own approach blank. Expressways,
elevated roads and bridge decks are excluded from this facade search.

A flush wall plane is usually edge-on from an approaching vehicle. Tokyo uses
three complementary treatments, subject to the host split above:

- projecting blade kanban are perpendicular to the facade and double-sided;
- directories and procedural-host campaign panels are canted toward an approach and moved
  outward by their projected half-width; and
- fascia remain facade-parallel because they are read at storefront distance.

The cant is a visibility proxy, not proof. A release sweep still needs the real
chase-camera field of view, screen-space size and building occlusion. Sample
both travel directions, the default spawn route, downtown and remote corridors.

## Freestanding boards need complete-envelope tests

The first Cairo skyline-board implementation checked only the central pedestal.
Canted wide faces then swept into roads and buildings. Flattening every board
against the kerb avoided collisions but made the ads nearly invisible. The
resolver now searches nearby gaps while retaining a driver-facing cant.

For a freestanding installation:

1. Derive an XZ OBB from the complete rendered frame, support and lamps.
2. Move its centre beyond the kerb by the canted projected half-extent plus
   clearance.
3. Search longitudinal offsets deterministically, then opposite sides and only
   then less favourable cants.
4. Test the full envelope against all roads, rendered buildings, rail, water,
   landmarks, parks, venues, service points, other signs and world edges where
   relevant.
5. Fail loudly when a required logical slot cannot resolve. Silent deletion is
   not a collision strategy.

Use real rendered-building extents: measured asset footprints for model slots
and structural solids for procedural buildings. Coarse authored block parcels
contain genuine gaps and cannot substitute for individual visuals.

Pole banners have their own contract: seat supports inside the source pavement,
clear crossing roads and rail, face the card toward traffic, and reserve their
roots from generated roadside scatter. A root-point test is sufficient only
while the card remains narrow enough for the city's stated envelope.

## Bridges and expressways are explicit structures

An overhead gantry may span asphalt only because its role and clearance are
tested explicitly. Its legs land beyond carriageway/parapet envelopes and its
face clears the tallest supported traffic. Side-mounted deck signs place their
complete frames beyond asphalt and parapets, remain readable in both directions
and reserve gaps around gantries and same-level merges.

Distribute bridge signs across the full route. A single board at a bridge mouth
does not create a sustained approach rhythm. Do not let elevated installations
remove unrelated at-grade scatter under the structure.

## Rendering and performance

Create shared materials and one master per creative/sign family, then instance
placements. Never create a texture or material per placement. Tokyo merges the
frame and separate art/copy planes into campaign masters, plus shared blade,
fascia and directory masters; its projecting signs are explicitly double-sided.
Only the faces emit. Frames stay dark/specular and surrounding walls remain
ordinary building materials.

Cairo's much larger freestanding layer thin-instances each master into spatial
cells so frustum culling remains useful. Each chunk needs its own Babylon
`Geometry` before `thinInstanceSetBuffer`; instance attributes live on geometry
even when the CPU matrix cache lives on the mesh. Freeze static meshes and
materials through the normal scenery pipeline.

Changing advertising can re-deal roadside scatter when new supports become
occupied points. Render-characterization changes must be measured rather than
blindly accepted.

## Regression and release gate

The city-specific suite should pin:

- copy uniqueness, forbidden-name exclusions and language mix;
- all atlas crops, dimensions, checksums and source-cell sizes;
- unique placement IDs, every placement kind, unique-host density and
  represented-road floors;
- near-spawn, core and outer-region presence, plus bounded gaps on long roads;
- procedural-only campaigns, vertical blade-only residential-style hosts;
- facade-to-road line of sight, readable approach-facing geometry and the
  two-axis texture correction on every `+Z` campaign/tenant face;
- full installation clearance where signs are freestanding or overhead; and
- no advertising leakage into other map IDs.

Run the registry and four-city render characterizations as well. Geometry tests
do not prove visual readability, so drive the spawn district, downtown, remote
arterials and both directions past the largest screens. Check that the layer is
already present when a drive begins, small signs accumulate into a street wall,
hero art stays legible, luminous faces bloom without lighting whole buildings,
and no structure clips roads, roofs or facades.

The current Cairo scale—hundreds of pole banners plus dozens of skyline,
parapet and gantry structures—is evidence that the architecture scales, not a
universal target. Tokyo reaches comparable visual persistence through many more
building-mounted tenant signs and a smaller campaign-screen layer. Preserve the
city-specific silhouette, not another city's raw counts.
