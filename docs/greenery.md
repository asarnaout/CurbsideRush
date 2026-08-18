# Grass, parks and planting

How the ground reads as ground, and what stands on it.

## Grass is two tiles, and a detail map's neutral is 0.5 — including alpha

Every grass surface takes world-planar UVs at `1 / GRASS_TILE_M`, so the tile is
anchored to the world, not the mesh: a park lawn continues the ground plane's
grass instead of restarting at its own corner. That shared convention is what
lets **one** `DynamicTexture` serve every grass material through
`StandardMaterial.detailMap`, at a fixed `GRASS_TILE_M / GRASS_DETAIL_TILE_M`
ratio — per-mesh `uScale` would need a texture per mesh. The tiles are
non-divisible (12 m against 3.1 m) so they beat rather than reinforce a grid.

**A roadside lawn may draw larger than its logical park rectangle.**
`lawnEdgeLaps` names the park-local edge facing the road and independently
overscans that edge and its building-facing opposite. `parkLawnEdgeLapBands`
creates only two narrow transverse bands; `parkLawnEdgeLapGeometry` unions them
and cuts out every foreign pavement and shoulder-junction fill. Renderer and
visual-ground collector consume that same clipped MultiPolygon, so the long
ends stay exact, grass covers only the named sidewalk(s) up to the asphalt curb,
and perpendicular footways remain concrete. The far band disappears beneath
building foundations or the adjoining lawn. The authored middle remains at
0.02; x-normal bands start at 0.050 and z-normal bands at 0.052, so perpendicular
corner laps and neighbouring logical lawns never become coplanar. `depthLayer`
raises a same-axis bend by another 4 mm when its bands meet.

The middle is not raised, so paths and beds remain visible. Pin `parkStyle:
"lawn"` only when a derived cross path would terminate at a raised transverse
band (the Gloucester, Park West, Exhibition Road and other pathless kerb
ribbons do); a path running along the ribbon can stay. Layout, scatter, walls,
collisions and park/block overlap checks continue to use the authored `center`
and `size`. The visual ground collector records both rungs at their real
heights, so its geometry describes the pixels rather than only the smaller
gameplay rectangle.

**A detail map is four channels, and three have a non-zero neutral.**
`default.fragment` reads `2 · mix(0.5, detailColor.r, diffuseBlendLevel)`, so R
neutral is 0.5 — and `bumpFragment` reads a tangent normal out of **alpha and
green** (`detailColor.wy * 2 - 1`, `B = sqrt(1 - |RG|²)`), so those are 0.5 too.
Alpha is the trap: a 2D canvas is opaque, and A = 1 decodes as `normal.x = 1`,
forcing B to zero — a tangent normal lying flat along the surface, 90° off the
sun. It took Tokyo's grass from `(24,68,25)` to `(3,10,0)`, and `bumpLevel = 0`
cannot rescue it, since zeroing `.xy` leaves a zero-length vector rather than an
upright one. So `createGrassDetailTexture` paints greys for R and overwrites G
and A with 128, and keeps `premulAlpha` off in `update()` — on, it would halve
the red the diffuse blend reads. Author a real detail normal only on purpose.
`DetailMapConfiguration` is also a `MaterialPluginBase`, so each material
enabling it adds a define and one more compile; it is off on `lowSpec`, which
also drops the base tile to 512².

## Park planting is split by what a driver can reach

`parkLayouts.ts` is pure and returns paths plus placements; `roadsideProps.ts`'s
`collectParkPlacements` splits them. Within `PARK_KNOCKABLE_REACH_M` of a path
(plus every bench and lamp) they join the roadside scatter's pipeline, sharing
its tree masters and becoming knockable street furniture; deeper ones are
instanced scenery, unreachable and not knockable. Shrubs are never knockable at
any distance — densest zone, and `damage: "none"` anyway.

Both halves are `createInstance` off a `getBuildingMaster` merge, so they share
geometry. Measured against `main` at the NYC free-drive spawn: **+3,298 meshes,
+23 MB heap, +3 draw calls**.

Two routes were tried and rejected. **Merging a cell into one mesh** costs
+100 MB of heap (geometry duplicated per plant) for 12 draw calls — a bad
trade on a phone. **Thin instances draw nothing here at all**: every observable
is correct (visible, enabled, counts, bounds, draw calls submitted) and no
pixels land; bisect ruled out the multi-material merge, `freezeWorldMatrix`
and the `material.freeze()` ending `buildRoadsideProps`. Do not spend the
afternoon again.

## A park's gates are derived from its own paths

`parkPerimeterPlan` walks each boundary edge and drops a span wherever one of
the park's paths reaches it, or wherever the wall would come within
`PARK_WALL_ROAD_CLEARANCE_M` of a carriageway. Nothing is authored. The path
rule means the wall can never seal in the planting the paths lead to; the road
rule is a **veto**, and it is what keeps `staticColliders.test.ts`'s "every lane
corridor clear" and "never walls off the walkable pavement" green with no
hand-listed exceptions.

**A park tucked to its pavements needs `wallsFollowRoadEdges`.** The blanket
1.8 m veto deletes a whole road-facing edge for any park whose rect sits at the
kerb, and it does so silently. London's royal park shipped with no west wall
at all — 9.3 m off West Carriage Drive's centreline against a 9.7 m threshold
— and its north and east walls survived only because their distance came out at
exactly 10.4 against a threshold of exactly 10.4 and the comparison is a strict
`<`. Four walls should not hang on a float tie. The opt-in clears each road's
**own** pavement band (`sidewalkWidthM`, not the map default — Serpentine
Road's is 2.4 m against London's 3.4) by the 0.3 m `staticColliders` allows
plus the wall's half thickness. A road alongside the edge then cannot delete
it; a road crossing it still opens a gap exactly as wide as its own pavements,
so the wall **ends where the sidewalk begins** instead of floating short of it.
Opted-in runs also bisect for their true end rather than stopping at the last
whole-metre sample. Leave it off for a park held well back: the blanket veto is
the safer default and every other city relies on it.

**The opt-in only saves a wall that is already inside the park's own rect.**
Author the rect edge at (or just past) each road's pavement edge —
`roadWidthM/2 + sidewalkWidthM` out from that road's centreline, plus a
little margin — never at the centreline itself. A rect that instead runs
edge-to-edge between four bounding roads' *centrelines* (the natural way to
size a park to "the whole block") puts the 1.5 m-inset wall on all four
sides inside its own nearest road's clearance band at once, and
`parkPerimeterPlan` returns zero runs for the whole perimeter, silently —
Tokyo's Kitazawa-kōen shipped exactly this way first and `parkLayouts.test`'s
"walls the big parks..." caught it (expected >0, got 0).

**"Has an opening" is the wrong invariant.** Central Park's first wall was a
single unbroken 2,897 m run down its western edge with a gate at each far end —
enterable, 2.9 km apart. Long parks now get crossings every
`PARK_CROSSING_SPACING_M` (~300 m, the spacing of the real transverses), each
of which opens a gate, and `tests/parkLayouts.test.ts` caps any single run.

Where a road crosses the park itself, the boundary follows the road: each
divider lays a rail parallel to the carriageway at the same clearance the
road veto enforces, clipped to the inset rect — the rect edge beside a
crossing road is otherwise vetoed down to stubs and the park stands open to
the street. Gates fall out of the same path rule, so the opera's cross-east
street entrance opens its rail exactly like the west gate.

A park wall is a scored `collision` with damage (`parkEdge` in
`STATIC_OBSTACLE_MESSAGES`), so it must be plainly visible at speed —
`PARK_WALL_HEIGHT_M` is set for that, not for realism.

**Nothing geometrically keeps a building out of a park.** The wall's vetoes
read roads; `landmarkClearings` skips parks and feeds planting only;
`buildingReservations`' historical buffer guards the street wall against
venues, not venues against parks. And a venue lands on the **driver's right of its anchor lane**, so which
kerb of a park-flanking avenue it takes is decided by whether the anchor names
the northbound or the southbound lane — pick the wrong one and no
`distanceAlongM` can save it, because that whole kerb is park. Four venues
across NYC and Tokyo had shipped inside one. `content.test.ts`'s "keeps every
venue building out of every walled park" is the guard, against the collider box
(`PROP_MODEL_FOOTPRINTS_M`, what you see and hit) rather than the authored
`footprint` (what sizes the keep-out circle), and gated on parks that actually
grow a wall so a `pocket_green` beside a shared-space street still may.

## Park ground is four polygon-offset tiers

Walks, courts and parterre beds once all shared `PARK_PATH_Y`, and any two
that overlapped were a coplanar fight the depth buffer resolved as shimmer —
the Opera Grounds' spine through its beds, and its crossing where the two
walks met. Beds and courts now sit at `PARK_BED_Y` between lawn and walks, and
the stack is backed by polygon-offset tiers: crossing paths (-4) over spines
(-2) over beds and courts (-1) over the ground rung (lawn, plaza discs,
terraces). Two park surfaces may overlap only when they differ in tier — which
is also why a formal garden's arms *terminate* at its plaza disc and lap it by
half a metre rather than crossing each other.

**Lay a wall box with `boxLengthYaw`, not with the heading convention.** A box's
length is its `width`, which is local +X, and `rotation.y = θ` lays local +X
along world **(cos θ, −sin θ)** — so the yaw is `atan2(-uz, ux)`, not the map's
heading (`atan2(dx, dz)`, 0 = +z, 90° off — Central Park's west wall shipped as
a 2,897 m ledge through every avenue) and not `atan2(uz, ux)` (z-mirrored,
invisible on axis-aligned runs and ~20° crooked on the opera rail, the first
angled one). In both failures the collider — which takes `ux`/`uz` straight as
the OBB axis — stayed correct, so what you saw and what you hit were different
walls. `tests/parkWalls.test.ts` pins the sign on a diagonal, since
axis-aligned pins cannot, and requires each mesh's world AABB to stay inside
its own park. The lawn inside stays drivable; it is the boundary that stops
you, not the grass.

**A lake in a park is a `WaterBody`, and that buys three things free**: the
adapter already emits a shoreline obstacle per polygon edge, the minimap
already draws it, and `parkLayoutForLandmark` passes the same polygon in as a
planting keep-out. Watch one trap — `generateWaterBoatPlacements` is not
map-gated and always wants at least one craft, and the only two models are
`cairo-felucca` and `cairo-skiff`, so a lake anywhere but Cairo would get an
Egyptian felucca on it. `buildWaterBodies` gates the call on the map.

## The planting kit, and two ways it goes wrong

Species come from `natureModelsForMap`, so a city plants only what it
downloaded: Tokyo its temple set, Cairo a palm-heavy mix, with none of that
spelled out at the call site. Placements queue in
`pendingPlantedProps` / `pendingParkThickets` and drain in `buildParkPlanting`
after the preload, the way vendor carts do — glb masters do not exist when the
scene is built.

**The queue is named for planting, not for parks.** Cairo's street palms ride
it too: `buildRoadsideProps` diverts every `"palm"` placement onto it instead
of building one procedurally, so a palm on the Corniche and a palm in the
Opera Grounds are one master, one shadow caster and one knockable prop. That
is also the cheaper shape — an imported palm is a single mesh where the
procedural one was three. **A queued placement is silently dropped when its
master is missing**, which is exactly what a suite mocking the preload empty
does; `fourCityRenderCharacterization` counts Cairo with zero palms for that
reason, and its baseline says so.

**Kenney's kit is authored at roughly a fifth of world scale.** Its trees are
1.1–1.9 m tall in the file, not the 4–6 m their silhouettes suggest, so a scale
near 1 plants saplings — which is exactly what the first pass shipped.
`natureCatalog`'s scales are measured, and `tests/natureAssets.test.ts` pins the
resulting world heights per role.

**Planting must stay out of `buildingModelUrls`.** Everything in that list is
treated as a building. It used to be actively dangerous — `applyNightGlow` gave
every material in it a warm self-glow of its own albedo, which turned Central
Park's trees tan — and although that pass now only lights materials *named* as
glass, so it can no longer discolour a tree, the separation stands: it is the
list that decides what a night pass, a decal pass or a merge policy is allowed
to touch, and each new pass would otherwise have to re-derive "but not the
trees". `natureModelUrls` rides the same preload and nothing else; the same
reasoning gates the Cairo boat models on the map rather than on "has water".

Scatter `variants` has to be wide enough to reach the whole species pool:
`variant % pool.length` at 3 variants never got past the first three species,
so no conifer was ever planted in a temperate park. The inverse trap: a
bespoke piece that means ONE species must pick its pool index deliberately —
Cairo's canopy pool leads with broadleaf and oak, so the opera allée at
`variant: 0` planted ten broadleaves down the axis. Where a caller means
*palms specifically*, `speciesFor`'s `"palm"` kind draws from a palm-only pool
rather than the mixed canopy; asking the canopy for them would have planted
oaks down the Corniche.

## Named parks get pieces no scatter would produce

`bespokeFeatures` keys on the landmark id where a park has real character worth
stating and on its style otherwise — so a fifth city's temple grounds gets a
torii, a gravel court and paired lanterns for free, while Central Park's Great
Lawn stays Central Park's. Features come back with **clearings**: a gravel court
with trees growing out of it, or a Great Lawn that is not a lawn, is worse than
having neither. The Great Lawn is only a clearing, never a mesh, which is also
why it costs nothing.

Masonry `settle`s clear of the park's own walks, like
`cairoTahrirFurnitureLayout` does, and the search runs in **both** axes: a park
short enough to get its single crossing at the centre has a path through the
ideal spot in both directions, so sliding sideways alone can never clear it.
Joan of Arc's plinth is the surviving customer — the Opera Grounds obelisk
needed it too, until that garden was recomposed to put a plaza disc under the
monument and stop every walk at the disc's rim.

The torii and the lanterns are procedural because the kit has no torii, and no
CC0 Japanese stone lantern appears to exist — the only matches are CC-BY, which
would put an attribution string in the catalogue for two models. Solid features
are emitted as **circles**, so they are exempt from the walkable-pavement sweep
like other small furniture, and so a torii stays drivable *through*.

## A park's style is derived, and two styles can never be walled

`resolveParkStyle` reads the landmark id first and its proportions second, so a
named `jp-temple-green` stays temple grounds where the size gate alone would
call it a token green. `ProceduralLandmark.parkStyle` overrules both —
London's roundabout islands are pinned `pocket_green` in their generator
(Parliament Square's is 34 m across, past the size gate, and a walled
greensward inside a traffic ring is absurd).

**`"lawn"` is the filler style: pure grass, authored-only.** `pathRecipe`
returns nothing for it, and everything else keys off paths — no gravel, no
benches or lamps, no shrubs (they only grow in a band beside a path), never a
wall; trees still scatter. It exists because **a trail may only end at a
pavement**: every other style derives at least one edge-to-edge path, so a
lawn tiled from several styled rects grows one dead-ended trail per tile.
Give ONE rect the trail (a `pocket_green` band spanning the full run, its
ends inside the bounding roads' hidden corridors so the path emerges at both
pavements) and make every filler `"lawn"`.

**Benches, walks and a railing are one package — no seating without the
fence.** `pathFurniture` returns nothing for `pocket_green` and `lawn` has no
path to hang furniture on, so the only styles emitting a bench also grow a wall.
A green meant to be sat in must clear `POCKET_GREEN_MAX_SHORT_SIDE_M` (30) and
stay under `STRIP_ASPECT` (6) to derive `urban_greensward`, and its railing is a
collider — that ground stops being drivable. Weigh that before reaching for the
seating: London's Chelsea square is 184 x 116 and derives greensward by shape,
but ships pinned to `pocket_green`, because **a perimeter wall inside a block
reads side-on as a black-and-cream stripe ruled across the lawn** and play-tested
worse than the missing benches. A railing earns its place fronting a street,
where it is seen end-on and reads as a garden's edge.

**A promenade beside a derived shoreline parapet must stay unwallable.**
Cairo and Tokyo both render a corniche-style parapet off the water body's own
shoreline colliders (`shorelineParapetRuns`, gated in
`babylonGameSession.ts`) — NYC has no such pass, so its riverside parks' own
walls are that map's *only* river-edge barrier, a different, equally correct
answer for a map without a derived parapet. A walled style right behind the
parapet grows a second fence, since the wall veto reads roads, never water;
Tokyo's riverside promenade (`jp-kawabe-koen`) stays `pocket_green` on every
segment for exactly this reason, and hand-places its lost benches back
through `bespokeFeatures`'s id-keyed props (the Opera Grounds/Joan of Arc
mechanism) rather than reaching for a walled style to get them free.
`pocket_green`'s path is a fixed cross along local +x — wrong for a park
hugging a road running the *other* way. `headingDeg: 90` fixes it (swaps
which world axis `size.x`/`size.z` each span) and is one of the few angles
safe from this file's own yaw-sign trap (the cross path is symmetric about
its centre, so +90°/-90° render identically) — but still author, then drive
to and check, never trust the sign by inspection alone.

**Where the park IS the barrier, its water-facing edge and the shore are one
number.** The wall veto reads roads, never water, so a wall stands
`PARK_WALL_INSET_M` inside the authored rect whatever the river does — while
water draws ABOVE the lawn (docs/rendering.md) and hides whatever the shore
overlaps. Author the shore inside the rect and you get the wall out in the
river, water on both sides of it and a strip of water between it and the
visible grass that wobbles with the shore. Both of NYC's banks shipped that
way (issue #389) — the Hudson's on purpose, to "keep the grass/water seam from
cracking", and Queens' by taking the shore's *minimum* reach on a bank the
water reaches *east* across. The third, `nyc-esplanade`, took that same formula
on the one bank where it names the right extreme, looked right throughout, and
is what named the cause. So a shore beside a walled park is ruled straight
along that park's rect edge, and keeps its irregularity where no park
constrains it — never both banks straight, which reads as a canal.
`tests/parkLayouts.test.ts`'s "never stands a park wall in open water" is the
guard, on every map.

**An island enclosed by a road loop is one lawn or none.** A small green
floating in it reads as "a random strip of green surrounded by concrete" — the
play-test's words for an 80x28 stamp in a 250x195 island. Tile the whole thing
with butt-joined rects (Pembroke Crescent ships as one trail band plus twelve
`"lawn"` fillers, solver-verified to cover 100% of the visible interior), and
let each tile run into the surrounding roads' **hidden corridor**: lawn draws
at y0.02, under the pavement band at 0.045 and the carriageway at 0.07, so any
edge within centreline ± (width/2 + sidewalk) is invisible and the visible
edge is the kerb itself. A curve is hugged by stepping axis-aligned tiles
whose outer edges stay inside that corridor over each step's span. Past the
far pavement's outer edge lawn surfaces on the wrong side — the limit to
solve against. `pocket_green`, `civic_plaza` and `lawn` must never grow a
solid perimeter (`UNWALLABLE_STYLES`). Tahrir's plaza ensemble rings the
`cairo-tahrir-obelisk` landmark's centre with rings authored clear of every
pavement band; `cairoTahrirFurnitureLayout`'s `settle()` is only the safety
net for future road edits. The Opera Grounds keep the greensward style but
swap its walks for an id-keyed recipe (`operaGardenPaths`): four straight
arms on the opera house's axis ending at the plaza disc, and parterres that
run from the walk centrelines outward so every bed edge lands on a walk, the
rim, the terrace or the band — beds floating in lawn read as unaligned.

Two scatter rules exist for the same reason, and the first generalises by id.
`civic_plaza` planting keeps to the park-centre side of any road crossing the
rectangle (the lawn mesh is clipped at that centreline —
`cairoTahrirLawnPolygon` — so the far side is bare ground, and a palm there
passed the plain distance veto); `ROAD_DIVIDED_PARK_IDS` opts other road-cut
parks into the whole side-aware family — lawn clip (`roadSideParkLawnPolygon`),
scatter, path furniture AND `parkPerimeterPlan`, whose road-proximity veto
alone left the Opera Grounds a 4 m orphan wall run on the far kerbside of its
corridor. **A park drive wants the opposite**: London's Serpentine Road
crosses the royal park with the park deliberately NOT in
`ROAD_DIVIDED_PARK_IDS`, so the full-rect lawn runs under the asphalt (roads
draw above it in the y-stack), planting and benches keep clear through the
plain distance veto, and the perimeter wall's road veto opens gates where the
drive punches the boundary — grass on both sides of the car is the point. The
lake crossing is the same portal machinery as the Thames bridges: the water body
whitelists the road's surface id or the shoreline collider stays an unbroken
invisible wall across the deck. Non-park landmarks standing in a park become
scatter keep-outs via `landmarkClearings`, the obelisk keyed to the paved disc's
radius rather than its plinth.

Every authored park is listed in its city's content file (London's roundabout
islands are the one generated family). `tests/parkLayouts.test.ts` pins the
total.
