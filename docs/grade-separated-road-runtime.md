# Grade-separated roads: runtime and performance

Read [the implementation guide](grade-separated-road-implementation-guide.md)
and [authoring chapter](grade-separated-road-authoring.md) first. This chapter
keeps every runtime consumer on the authored level without making bridge detail
too expensive to render or query.

## Level ownership is continuous

Normal fixed-step projection supplies the previous lane, previous elevation
including zero, and heading. A finite `elevationM: 0` is authoritative at API
boundaries; do not test it with truthiness. `SimulationCore.setPlayerPose`
clears stale projection ownership for every finite height before resolving the
new pose. Debug teleports, resets, spawns, respawns and cutscenes follow the same
rule.

Ground is a physical level, not “whichever road is closest in plan.” Ground
projection searches compatible at-grade lanes and stays at zero/off-road if
none fits. It never acquires the deck above because a distance lock expired.

Profiled ramps require tighter ownership:

- ordinary routing admits the occupied lane, adjacent lane and directed
  successors;
- the player may also capture an immediate predecessor so the physical pavement
  works in either travel direction while wrong-way enforcement still applies;
- same-height coincident endpoint branches are projection-only alternatives,
  selected from the driver's trajectory across the full paved endpoint strip;
- branch alternatives never become NPC successor edges or route guidance;
- a connected alternative is reconsidered only near its endpoint and after the
  car physically leaves the preferred paved width;
- a detached explicit 3D pose may use global height-matching capture, but normal
  driving may not.

There is no x/z trigger that teleports a vehicle between levels. Elevation
changes continuously along the profile.

## NPCs and contacts carry height

NPC current/previous poses, spawn/activation, lane changes, corner arcs, render
snapshots and interpolation all carry elevation with x/z/heading. A pure height
reassignment counts as a render snap; never interpolate a car through a deck.

Moving contacts sweep height with x/z. Apply `roadElevationsCanInteract` before:

- player/NPC and NPC/NPC collision, avoidance, spawn clearance and conflict
  reservation;
- pedestrian/cyclist, train and crossing-barrier contacts;
- destructible hits and effects;
- patrol witnessing and traffic-camera enforcement;
- ground-only service, repair, venue and gig activation.

Reject cross-level contact before audio, pause, damage, fines, knockdown or
particles. The minimap's broad presentation threshold is not the physical
contact band.

## Roof and soffit collision

Do not register the entire deck as a ground collider. Prepare
`createElevatedRoadGroundClearanceQuery` once; it combines the complete raised
asphalt profile with exact slab/collar/pier headroom while keeping high
underpasses open.

After planar motion, sample the centre and both end discs of the player's real
capsule using the rendered vehicle/rider height plus roof margin. Clip a clear-
to-blocked step to the clearance boundary and stop cleanly. Existing pier
colliders own support normals and are not resolved again as roofs. A pose
already inside a low envelope may move outward.

The carrier filter is topology-local, not an exact road-id exception:

- exclude road tops within the road-level capture band of the tyres;
- exclude the projected carrier road;
- exclude the immediate body-direction neighbour at the leading sample, both
  neighbours at the centre and the opposite neighbour at the trailing sample;
- swap predecessor/successor meaning when the body points against stored lane
  direction;
- gate exemptions by distance to the shared endpoint and keep them to one hop;
- after filtering carriers, still return a separate higher deck.

This prevents a connected pavement seam becoming an invisible transverse wall
without hiding an unrelated deck where the branch crosses again later.

## People, controls, props and buildings

The combined clearance query takes each object's required height and footprint.
Walkers reject blocked spawns and turn back at low envelopes; high undercrofts
remain usable. Signals test complete poles and heads. Parked cars use the chosen
model's roof and footprint. Roadside and park queues use kind/variant/scale-
specific envelopes before batching, so short furniture may remain where a tree
or lamp cannot.

The runtime building collider plan and rendered building plan are the same
`BuildingLayoutPlan`. Do not substitute block OBBs in a bridge audit: the chosen
asset can be wider, rotated differently or tall enough to read as standing in
the carriageway even when its parcel looks clear.

Required control searches move along their own kerb while clearing live lanes,
structure and occupied furniture. If no valid station exists, reauthor the
ramp. Nonessential generated furniture and repeated signs may use deterministic
relocation followed by explicit city presentation curation.

Rendered control poles, heads, enforcement cameras and crossing rigs add the
sampled road height to their authored installation offsets. Stop bars and other
road markings pitch between endpoint heights instead of lying flat through a
grade. The ordinary ground-roadside pass excludes elevated surfaces; any deck-
mounted furniture is placed by an elevation-aware bridge/control pass.

Regulatory signs derive from legal flow. Suppress a road-id seam only when it is
an explicit successor-linked degree-two one-way continuation with no branch.
Real mouths retain correctly faced information at the local road height. A
bounded station search may cross same-road segments and such authoring seams,
but must stop at a real branch, crossing or terminal.

Destructibles retain authored elevation through broadphase, contact, pivot,
fall, light pool and impact effects.

## Stops, cameras and maps

A patrol or camera can witness only a level-compatible player. Pull-over road
selection ranks both plan distance and height. Sample the player car, patrol
car, officer path and camera target independently along the chosen road profile;
do not copy one constant Y across a grade.

Treat the staged camera as geometry. Test candidate positions, scene marks and
camera-to-subject sightlines against the real soffit. Prefer a clear azimuth,
clamp beneath a usable deck, or advance the complete scene along the same road
when actors/cars/camera cannot fit.

The minimap and expanded map retain both levels but emphasize the player's
current road level. Ramps transition continuously. The corner minimap caches
both level sheets and switches them; it must not redraw the full network every
time the player crosses the level threshold.

## Performance rules that must survive new maps

Performance work may reduce queries, transforms and submissions; it may not
change geometry or selection semantics.

### Geometry and clearance

- Pass the map pack's stable full `roadSurfaces` array to the shared junction-
  envelope cache. A freshly filtered array defeats identity caching.
- Resolve edge runs once per segment and pass them to `elevatedRoadDeckRun`;
  rendering needs both and must not repeat the junction/corridor walk.
- Prepare deck/ground-clearance queries once. Their immutable 32 m broadphase
  inserts every exact frame into every touched cell, queries the footprint AABB
  and restores authored index order so tie results remain deterministic.
- Large or invalid broadphase queries deliberately fall back to the exact full
  scan; an optimization must never create a false negative.

### Road projection

`RoadNetwork` normalizes segment deltas, squared lengths, headings, cumulative
ends and elevation slopes once. `pointOnLane` uses a left-biased binary search;
an exact vertex must retain the legacy incoming-segment heading. Height-aware
projection scans topology/elevation-compatible lanes first and runs the global
fallback only for a detached raised pose.

Keep `tests/roadNetworkProjectionEquivalence.test.ts` exact against the frozen
legacy oracle when extending or optimizing this path. Update map-specific
sample counts only for real authored growth, and add the new network to an
equivalent exhaustive corpus rather than assuming Cairo coverage generalizes.
Traffic-locality decisions reuse one fresh player projection inside the same
synchronous decision; do not cache it across decisions.

### Rendering

Author detailed bridge pieces at full fidelity, then let
`ElevatedRoadStaticBatcher` world-bake them. Batches preserve material, role,
vertex layout, side orientation, `receiveShadows` and world-space geometry.
Static/mirror/freeze-only pieces use 45 m spatial cells. Shadow casters merge
only at identical original registration coordinates so the exact radial shadow
predicate and ramp cutoff do not pop.

Dispose empty source roots after merge, keep meshes non-pickable and do not
merge into a city-wide batch that defeats frustum/static visibility. Repeated
posts, reflectors, panels and lamps should be compound pieces per edge run
before the spatial bake, not thousands of independent scene nodes.

For every new network, add an unbatched-versus-batched characterization that
asserts identical world geometry, indices, render roles, static/shadow cells and
shadow registration groups. Establish deliberate caps for vertices, indices,
scene meshes, transform nodes and shadow submissions. Existing Cairo numbers in
[rendering.md](rendering.md) characterize Cairo only; do not adopt them as a
universal budget or raise them silently.

## Runtime anti-regressions

Never optimize by:

- dropping elevation from an intermediate snapshot;
- widening projection to every nearby profiled lane;
- treating zero height as absent;
- replacing prepared footprint queries with point tests;
- merging shadow registrations by an averaged cell position;
- simplifying curves, collars or barriers until a budget passes;
- adding a city-id branch for semantics that every future elevated road needs.

The required proofs are listed in
[grade-separated-road-verification.md](grade-separated-road-verification.md).
