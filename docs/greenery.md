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

`parkLayouts.ts` is pure and returns paths plus placements; `GameCanvas` splits
them. Within `PARK_KNOCKABLE_REACH_M` of a path (plus every bench and lamp) they
join the roadside scatter's pipeline, sharing its tree masters and becoming
knockable street furniture; deeper ones are instanced
scenery, unreachable and not knockable. Shrubs are never knockable at any
distance — densest zone, and `damage: "none"` anyway.

Both halves are `createInstance` off a `getBuildingMaster` merge, so they share
geometry. Measured against `main` at the NYC free-drive spawn: **+3,298 meshes,
+23 MB heap, +3 draw calls**.

Two routes were tried and rejected, and the numbers are why. **Merging a cell
into one mesh** duplicates its geometry per plant: it saved 2,000 meshes and 12
draw calls but cost **+100 MB of heap** (368 -> 468 MB on NYC), which is a bad
trade on a phone. It was also the right answer while planting was procedural,
because a procedural tree is four part-meshes where an imported one is a single
merged glb — the +9,283 meshes that motivated batching never materialise now.
**Thin instances draw nothing here at all**: chunks come out visible, enabled,
right material, right `thinInstanceCount`, correct refreshed bounds, Babylon
submits them (draw calls rise ~7x) and no pixels land. Bisect ruled out the
multi-material merge, `freezeWorldMatrix`, and the `material.freeze()` ending
`buildRoadsideProps`. Do not spend the afternoon again.

## A park's gates are derived from its own paths

`parkPerimeterPlan` walks each boundary edge and drops a span wherever one of
the park's paths reaches it, or wherever the wall would come within
`PARK_WALL_ROAD_CLEARANCE_M` of a carriageway. Nothing is authored. The path
rule means the wall can never seal in the planting the paths lead to; the road
rule is a **veto**, and it is what keeps `staticColliders.test.ts`'s "every lane
corridor clear" and "never walls off the walkable pavement" green with no
hand-listed exceptions.

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
`pendingParkProps` / `pendingParkThickets` and drain in `buildParkPlanting`
after the preload, the way vendor carts do — glb masters do not exist when the
scene is built.

**Kenney's kit is authored at roughly a fifth of world scale.** Its trees are
1.1–1.9 m tall in the file, not the 4–6 m their silhouettes suggest, so a scale
near 1 plants saplings — which is exactly what the first pass shipped.
`natureCatalog`'s scales are measured, and `tests/natureAssets.test.ts` pins the
resulting world heights per role.

**Planting must stay out of `buildingModelUrls`.** Both consumers of that list
treat its contents as buildings, and `applyBuildingNightGlow` gives every
material in it a warm sodium self-glow — which turned Central Park's trees tan.
`natureModelUrls` is a separate field that rides the same preload and nothing
else. The same reasoning gates the Cairo boat models on the map rather than on
"has water", now that NYC has a lake.

Scatter `variants` has to be wide enough to reach the whole species pool:
`variant % pool.length` at 3 variants never got past the first three species,
so no conifer was ever planted in a temperate park. The inverse trap: a
bespoke piece that means ONE species must pick its pool index deliberately —
Cairo's canopy pool leads with broadleaf and oak, so the opera allée at
`variant: 0` planted ten broadleaves down the axis.

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
named `jp-temple-green` stays temple grounds at 24x28 m where the size gate
alone would call it a token green. `ProceduralLandmark.parkStyle` overrules
both. `pocket_green` and `civic_plaza` are the two that must never grow a solid
perimeter: London's islands are 12x12 inside a radius-12 turning loop, and roads
cut Tahrir's authored rectangle. Tahrir's plaza ensemble — paved disc, benches,
olives — rings the `cairo-tahrir-obelisk` landmark's centre, with rings authored
to clear every pavement band outright; `cairoTahrirFurnitureLayout`'s `settle()`
remains only as the safety net for future road edits. The Opera Grounds keep
their greensward style but not its walks: an id-keyed recipe
(`operaGardenPaths`) lays four straight arms on the opera house's axis — not
the park's own centre — ending at the plaza disc, with the east arm tucked
half a metre under the corridor's pavement band so the seam reads as a street
entrance. Its parterres ARE the quadrants: each bed runs from the walk
centrelines to the park rectangle and everything above paints over it, so a
bed edge can only land on a walk, the disc rim, the terrace or the band —
straight-edged beds floating in lawn read as unaligned with all of them, and
against the diagonal street the gap visibly tapered.

Two scatter rules exist for the same reason, and the first generalises by id.
`civic_plaza` planting keeps to the park-centre side of any road crossing the
rectangle (the lawn mesh is clipped at that centreline —
`cairoTahrirLawnPolygon` — so the far side is bare ground, and a palm there
passed the plain distance veto); `ROAD_DIVIDED_PARK_IDS` opts other road-cut
parks into the whole side-aware family — lawn clip (`roadSideParkLawnPolygon`),
scatter, path furniture AND `parkPerimeterPlan`, whose road-proximity veto
alone left the Opera Grounds a 4 m orphan wall run on the far kerbside of its
corridor. And non-park landmarks standing in any park become scatter keep-outs
via `landmarkClearings`, with the obelisk keyed to the paved disc's radius
rather than its plinth.

There are **twelve** authored parks, not the ten you get by reading the content
files: London's two roundabout islands are generated by its turning-loop helper
rather than listed. `tests/parkLayouts.test.ts` pins the count.
