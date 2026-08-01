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

A park wall is a scored `collision` with damage (`parkEdge` in
`STATIC_OBSTACLE_MESSAGES`), so it must be plainly visible at speed —
`PARK_WALL_HEIGHT_M` is set for that, not for realism. The lawn inside stays
drivable; it is the boundary that stops you, not the grass.

**A lake in a park is a `WaterBody`, and that buys three things free**: the
adapter already emits a shoreline obstacle per polygon edge, the minimap
already draws it, and `parkLayoutForLandmark` passes the same polygon in as a
planting keep-out. Watch one trap — `generateWaterBoatPlacements` is not
map-gated and always wants at least one craft, and the only two models are
`cairo-felucca` and `cairo-skiff`, so a lake anywhere but Cairo would get an
Egyptian felucca on it. `buildWaterBodies` gates the call on the map.

## The planting kit, and two ways it goes wrong

Species come from `natureModelsForMap`, so a city plants only what it
downloaded: Cairo's "trees" resolve to palms and Tokyo's to the temple set with
none of that spelled out at the call site. Placements queue in
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
so no conifer was ever planted in a temperate park.

## A park's style is derived, and two styles can never be walled

`resolveParkStyle` reads the landmark id first and its proportions second, so a
named `jp-temple-green` stays temple grounds at 24x28 m where the size gate
alone would call it a token green. `ProceduralLandmark.parkStyle` overrules
both. `pocket_green` and `civic_plaza` are the two that must never grow a solid
perimeter: London's islands are 12x12 inside a radius-12 turning loop, and roads
cut Tahrir's authored rectangle — which is why `cairoTahrirFurnitureLayout`
already has a `settle()` that drags furniture inward.

There are **twelve** authored parks, not the ten you get by reading the content
files: London's two roundabout islands are generated by its turning-loop helper
rather than listed. `tests/parkLayouts.test.ts` pins the count.
