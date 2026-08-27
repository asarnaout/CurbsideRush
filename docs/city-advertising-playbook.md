# City advertising, signs and billboards

Use this playbook when adding a dense commercial-sign layer to another map.
It records the cross-file decisions behind Cairo's implementation and, more
importantly, the failure modes that were not obvious from a single screenshot.
The Cairo source of truth is `app/game/cairoAdvertising.ts`; the Babylon builder
is `app/game/render/cairoAdvertising.ts`.

This is a recipe, not a request to copy Cairo's language, creative direction or
counts into every city. Keep the architecture and safety invariants; author the
campaigns, density, structures and local language for the destination.

## The target look

Advertising is a city layer, not random decoration near the player spawn. A
successful pass has three readable scales:

- repeated portrait campaigns on lamp-style poles along ordinary streets;
- large landscape boards that remain legible while approaching at speed; and
- bridge/expressway structures visible over long sightlines.

The layer should feel bright, glossy and attention-seeking at night. Use a
controlled emissive face, high specular response and small fixture lights. Do
not turn the surrounding wall or road into a light source. Judge the result
while driving, not only from a free camera directly in front of a sign.

## Content is data, artwork is imagery

Keep every headline and subline in an auditable creative table like
`CAIRO_AD_CREATIVES`. The current product rules are:

- every campaign has visible text; image-only panels are not acceptable;
- use fictional, vague campaigns and no real company names or logos;
- exclude sexual, political and religious advertising;
- use the destination's language prominently, with a smaller natural mix of
  English or bilingual campaigns where appropriate; and
- keep generated art free of baked text. Image-generation lettering is both
  unreliable and impossible to review systematically.

A word blacklist and language-count test cannot determine whether imagery or
copy is sexual, political, religious or accidentally resembles a real logo.
Those policy checks still require human review of every creative and atlas cell.

Compose copy at runtime on `DynamicTexture` layers. Cairo uses the bundled
shaping-capable Arabic font through `ARABIC_CANVAS_FONT_FAMILY`; a new script or
language needs an equivalent verified font path. Put image and copy on separate
planes so either can change without regenerating the other.

If artwork is stored in an atlas, never assume the visual cells are an exact
mathematical grid. Cairo's generated 2-by-4 atlas had irregular row boundaries;
equal quarter-height UVs sampled the neighbouring campaign and repeated a strip
at the top. Measure the source-pixel edges, encode them in a pure crop helper
like `cairoAdAtlasUv`, inset each edge by a few pixels, use clamp addressing and
account for Babylon's `invertY` setting. Add a crop test for every cell.
The current crop test pins constants, not the PNG's bytes; a replaceable-asset
workflow should also verify the committed image dimensions or checksum so new
pixels cannot silently invalidate old measured edges.

Record generated/imported-art provenance in `CREDITS.md` and keep any required
source prompt or licence information with the asset entry.

## Keep planning separate from rendering

Follow Cairo's split:

- the city planning module owns campaigns, copy, deterministic station rules,
  placement geometry and collision decisions;
- the render module owns Babylon meshes, materials, textures and instancing;
- `CITY_RENDER_REGISTRY` attaches the builder to exactly one map; and
- `BabylonGameSession` passes the exact session `BuildingLayoutPlan` into both
  the city builder and any system that reserves advertising space.

Do not recompute buildings with a hard-coded traffic seed. Career/free-drive
scenarios can supply different authored inputs; the billboard planner must see
the same `BuildingLayoutPlan` that the renderer sees. Cairo caches its placement
array by that plan object so `buildRoadsideProps` and `buildCairoAdvertising`
consume identical results without paying for the gap search twice.

## Author campaigns along whole corridors

Define named corridor rules with a station spacing, start pad, end pad, initial
creative and side rhythm. Test the whole map:

- every intended arterial/collector is represented;
- long roads have a minimum number of repeated signs;
- north/south and east/west regions all receive coverage;
- bridges and approaches receive explicit coverage; and
- the result is not concentrated around the default spawn.

Change campaigns in runs rather than randomly at every pole. Repetition is what
makes a citywide buy read as a campaign. Give every placement a deterministic,
unique ID derived from corridor, station and chosen side.

Treat structures as different placement kinds. Cairo has `pole-banner`,
`skyline-billboard` and `bridge-gantry`; each has different geometry and safety
rules. Do not force them through one generic root-point test.

Cairo's skyline boards are freestanding, double-sided structures. Façade wraps,
roof mounts and building-mounted signs need separate envelopes and mounting
rules rather than borrowing the pedestal assumptions below.

## Pole banners

Seat a pole inside the source sidewalk/pavement band, face its double-sided card
head-on to traffic, and reserve the complete foreign-road pavement envelope at
junctions. A point that is a valid kerb offset from one road can be the centre of
a crossing road. Keep rail reservations clear too.

Pass pole/support points into roadside scatter's occupied-point grid. Otherwise
a generated tree, lamp or vendor can share the same coordinates even though the
ad itself passed every road test.
That shared scatter grid reserves roots with ordinary point spacing; it is not a
substitute for the skyline installation OBB checks.

Cairo's pole checks are intentionally support-centred; they do not prove the
complete portrait panel clear of buildings, water or every hard keep-out. If a
port uses wider cards, deep fixtures or tighter sidewalks, promote pole banners
to the same full-envelope audit used for skyline boards.

## Large roadside boards: find gaps, do not hide the face

The first Cairo version canted 14-18 m boards toward drivers but checked only the
central pedestal. The long frame swept several metres sideways into roads and
building facades. Moving every board to the sidewalk centre and almost parallel
to the kerb fixed collisions but made the advertising nearly invisible from the
driving camera. Neither result is acceptable.

The correct solution is conditional placement:

1. Keep the strongly readable approach cant as the first choice. Cairo uses 55
   degrees; all boards in its current free-drive building plan find a safe
   opening at that angle.
2. Compute how far the complete canted installation projects toward the road.
   Place its centre beyond the kerb by that projected half-extent plus clearance.
3. Search longitudinally around the nominal station in deterministic small
   increments. Cairo uses 5 m steps within the station's local interval.
4. Try the preferred side and then the opposite side. Small additional outward
   setbacks are allowed when they produce a cleaner gap.
5. Only after exhausting nearby gaps should slightly less driver-facing
   fallback cants be considered.
6. Never silently skip an unresolved logical slot. Use a deterministic fallback
   or fail loudly so a test catches the map change; deletion is not a collision
   solution.

Open roadsides naturally accept the preferred angle at or near the nominal
station. Dense street walls relocate the board into a real nearby opening. This
preserves both visibility and believable physical placement.

## Test the whole installation, not its origin

Derive a horizontal oriented bounding box from the rendered geometry. Cairo's
current skyline envelope is `(width + 0.55 m) x 1.08 m`: the depth includes the
frame, central pedestal, crossbar and lamps projecting behind the face. If the
renderer changes, update the planner envelope and regression test together.

The full envelope must clear:

- every drivable road segment, including the source road and junction joins;
- every rendered building visual with visible breathing room;
- rail, landmark, park, service-point and venue reservations;
- other billboard envelopes and same-corridor spacing.

Probe the complete pedestal footprint against water, not only its centre. This
is not a full board-to-water OBB test. A port whose candidate corridors approach
the map edge should also add an explicit whole-envelope world-boundary check;
Cairo's current resolver does not need or implement one.

Cairo expands roads by 0.25 m and rendered buildings by 0.5 m. These are visual
buffers, not excuses to accept touching geometry.

Do not test skyline boards against `mapPack.geometry.blocks` alone. Blocks are
coarse authoring parcels and can contain several buildings plus genuine gaps;
rejecting a whole block erases exactly the openings the resolver needs. Use the
session `BuildingLayoutPlan`:

- for asset-slot buildings, use `buildingPlacementConfig(modelId)` and its full
  measured `footprintM`/`depthM` at the planned position and yaw. Ground-contact
  structural solids can miss balconies and upper-floor projection;
- for procedural/museum buildings, use their exact planned structural solids.

Keep XZ separation even when a billboard happens to sit above a low roof. The
requested visual is a real gap, not an object that technically clears by height
while appearing meshed from the road.

One valuable regression proves that at least one accepted board overlaps a
coarse block parcel while clearing every individual rendered building. That
shows the implementation is finding real between-building gaps rather than
retreating outside all authored blocks.

## Bridge and expressway structures

Handle overhead gantries separately from roadside boards. A gantry is allowed to
span a carriageway because its role is explicit and its vertical clearance is
tested. Its legs must land beyond asphalt and any parapet, and the bottom of its
face must clear the tallest supported traffic. Cairo uses more than 6.5 m.

Give long bridges multiple approach-facing installations across their full run.
One board at the bridge mouth does not create the reference-city rhythm and can
still leave the driver's entire main crossing empty.

Cairo currently pins gantry span, leg setback, vertical clearance, corridor
identity and route distribution. A map with dense bridge furniture, nearby
buildings or rail needs an additional full gantry collision audit.

## Rendering and performance

Build one set of master meshes and shared materials, then instance every
placement. Cairo shares eight atlas materials, eight landscape-copy materials,
eight portrait campaign materials and three frame/support/lamp materials across
the city. Never create a material or texture per placement.

Use double-sided faces where both travel directions should read the board. Keep
the support compact; a central pedestal avoids end legs projecting into traffic
when a wide face is canted. Freeze static instances/materials through the same
scene pipeline as other city furniture.

Adding or relocating advertisements changes roadside occupied points, which can
re-deal ordinary generated props. A render-characterization mesh-count change is
therefore expected, but it must be measured and explained rather than guessed.

## Required regression coverage

The city-specific suite should pin:

- fictional copy, forbidden-name exclusions and the intended language mix;
- exact atlas crops with no neighbouring-cell sampling;
- committed atlas dimensions/checksum when the asset may be replaced;
- exact or minimum counts by placement kind and unique IDs;
- corridor count, long-road density and whole-map regional distribution;
- repeated creative runs rather than per-pole noise;
- pole supports inside pavement and outside crossing roads/rail;
- the complete skyline installation clear of roads, full rendered-building
  visuals, reservations and water;
- a readable approach-angle range and proof that preferred angles are actually
  used on open stretches;
- billboard-to-billboard separation and non-overlap;
- proof of genuine within-parcel building-gap placement;
- bridge span, support setback, vertical clearance and full-route distribution;
  and
- no advertising leakage into other map IDs.

If a map can run with multiple traffic/building seeds, execute the skyline
resolver against a representative seed matrix. Cairo's exact 55-degree/count
assertion currently covers its free-drive seed; a different layout can expose a
new unresolved slot, which deliberately throws instead of deleting the board.

The angle assertion is only a geometric visibility proxy. It does not prove
screen-space size, line of sight, occlusion or readability from the chase
camera, so the manual driving sweep below remains a release requirement.

Also run the registry test and the four-city render characterization. The latter
protects shared materials, instancing, mirrors and unrelated cities from a local
advertising change.

## Porting checklist

1. Study several driving-height references and mark the intended corridors and
   bridge sightlines before generating art.
2. Write the local content policy and creative table first.
3. Produce text-free imagery, measure its atlas cells and add crop tests.
4. Add the pure placement module and three placement kinds needed by that city.
5. Feed it the exact session building plan and existing hard keep-outs.
6. Run a geometry audit for all candidates before opening the renderer.
7. Build shared materials/masters and instance the accepted placements.
8. Reserve support points from roadside scatter.
9. Drive the spawn district, several remote arterials, the longest bridge and
   both directions past large boards. Check shine, text, approach readability,
   supports, water edges and silhouettes against buildings.
10. Run focused tests, typecheck, lint, production build and render
    characterization. Update player-facing scope and asset credits when needed.

The current Cairo output is 534 pole banners on 27 surface corridors, 69 skyline
boards on 13 corridors and 10 bridge gantries, including eight across the Sixth
of October Bridge. The focused suite pins 69 and eight exactly while using
minimums for the broader pole/gantry totals. These numbers are evidence that the
method scales; they are not universal targets for London, New York or another
map.
