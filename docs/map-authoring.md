# Authoring map content

There is **no generic procedural city generator and no runtime map import**.
`getMapPack(id)` is a pure frozen lookup that throws on unknown ids.

## Two parallel truths that must stay in sync

- **`laneGraph.lanes`** — directed *legal* truth. What the simulation, GPS
  routing and NPCs use.
- **`geometry.roadSurfaces`** — *visual* truth. Centrelines + markings.

Linked only by `LaneSegment.roadId` ↔ `RoadSurface.id`/`laneIds`. Two-way streets
mirror one directed lane onto each side of the surface centreline.

Also authored: `RoadSurface.sidewalkWidthM` overrides the map default per road;
`ProceduralBlock.headingDeg` rotates its façade slots, exclusions and every
planned structural solid together — `geometry/buildingLayout.ts`'s
`planMapBuildings` is the one plan the street wall, the procedural facade grid
and the collider all read, so there is no separate per-block OBB collider left
to drift out of rotation with the rest; each `WaterBody` is a visual polygon
whose shoreline opens
only for its `bridgePortalSurfaceIds`, with paired parapets derived over those
spans, and whose **`flowHeadingDeg` decides river or pond**.
**`ProceduralLandmark.color` does nothing on a `kind: "park"`** — every park
shares one per-map grass material and nothing warns — and anything laid in a
park must fit the ~23 mm between the lawn (`PARK_LAWN_Y`, 0.02) and the
shoulder junction fill at 0.0435: parks sit under the roads on purpose. That
layering is why Tahrir's visible lawn is `cairoTahrirLawnPolygon`'s
tuck-and-clip (out under the flanking bands, cut at Ramses' centreline); the
authored rect stays the envelope scatter, exclusions and prop keep-outs read.
A park's dressing, wall and gates are derived ([greenery.md](greenery.md));
`parkStyle` is the only park field worth authoring, and only to overrule those.

## Everything else is derived at load time

| Derived | From | Where |
|---|---|---|
| asphalt strips, kerb/junction fills | `roadSurfaces` | `buildRoadSurfaceStripGeometry`, `collectRoadJunctionFills` |
| paint broken at junctions | `roadSurfaces` | `splitMarkingAtCrossings` |
| walkable pavement rails | `roadSurfaces` | `buildPavementGraph` |
| ambient traffic routes | `lanes.successors` | `SimulationCore.advanceNpcAlongLegalRoute` |
| gig drop-off addresses | `lanes` + `blocks` | `generateStreetAddresses` |
| instanced building street wall | `blocks.buildingSet` | `slotBlockBuildings` |
| signal phase clock | `controls.phaseGroup` | `authoredSignalAspectAt` |
| one-way + speed-limit signage | `lanes` (+ `speedLimit`) | `regulatorySigns.ts` |
| enforcement cameras | `controls` of `type: "signal"` | `trafficCameraControlIds` |

**A third of every map's signals carry an enforcement camera**
(`TRAFFIC_CAMERA_RATE`, the one knob). Ranked by salted FNV-1a hash and **cut
at the count**, never authored or threshold-drawn (a threshold gives *about*
a third — zero on London's 2 signals). Ties break on `localeCompare` so
reordering controls cannot shift the draw; a `max(1)` floor guarantees a
signalled city always has one to find.

**One `TrafficControlApproach` is one arm — one direction of travel — not one
road.** Grouping a two-way street's arms by `roadId` gives the pair one stop
line on one direction's lane and one head facing the other way: the opposing
driver is enforced against a signal never built for them, silently. Group by
the node each lane arrives *from* (Cairo) or by approach heading (NYC). Keep
`phaseGroup` keyed by road, though — opposing arms of one street must still
run together, or splitting the approaches also splits the cycle.

**A kerbside head belongs beside its own stop line**, roughly a metre before
the bar and a metre past the kerb face, on the traffic side. Clearance is a
**veto** on that ideal spot, never the thing being maximised — maximising it is
how every Cairo head once stood 13–24 m out on open ground.

**Signage is derived, controls are authored, so the post is what moves.**
`RegulatorySignInput.occupiedPositions` carries every authored pole; a
speed-limit sign landing within `LIMIT_FURNITURE_CLEARANCE_M` of one slides
further down its own kerb instead of dropping — dropping could silence a
corridor whose only sign collided, which the repeater floor exists to prevent.
Omit the field and posts stand bolted to signal poles, unread and unwarned.

## The shipped cities

| Map | Lanes | Roads | Lane km | Signals | Cameras | World (x × z m) |
|---|---|---|---|---|---|---|
| `nyc-upper-west-side` | 415 | 39 | 96.0 | 104 | 35 | 2600 × 3000 |
| `cairo-central-nile` | 224 | 27 | 44.8 | 10 | 3 | 1770 × 1830 |
| `tokyo-setagaya` | 458 | 89 | 81.0 | 42 | 14 | 2600 × 2400 |
| `london-south-kensington` | 338 | 73 | 61.3 | 12 | 4 | 2950 × 2000 |

### NYC is declared as a grid, not written lane by lane

`NYC_AVENUES` / `NYC_STREETS` state each road's coordinate, width, one-way
direction, lanes per direction and which cross-roads it reaches — an omitted
`crossings` defaults to *every* road on the other axis, so any street that
doesn't span the grid's full width (a park transverse's neighbour, a bank
street) must list its crossings explicitly or silently reach through
whatever should have stopped it. `buildNycGrid` derives the lanes, offsets,
successors, surfaces and a control at every crossing fed by two roads — a
signal when at least two arriving roads are signal-class, else a stop.
`buildNycBlocks` derives the blocks — zoned by column and latitude, so
inserting a street splits a cell without changing what stands on either half.

Hence **lane ids name the crossing each block starts at** (`nyc-we-n-72`):
numbering *spans* would rename every lane on a road the moment one crosses it,
and `roadIdForLane` has **no NYC branches** — the generator passes each road
id; a bridge's landmark id must equal its own road id the same way, for the
dressing builder and the water body's `bridgePortalSurfaceIds` to find it.

### London is two halves

The South Kensington museum quarter — Cromwell Road, Queen's Gate, Exhibition
Road and their neighbours — is still **hand-authored lane by lane**, and stays
that way: its geometry is the reference the whole map's left-hand lane offsets
are checked against (Queen's Gate's centreline is x−108 and its *northbound*
lane runs at x−109.7, which is that driver's left), and its two signals are the
only ones in the project positioned by eye against the rendered scene.

Everything grown around it comes from **`LONDON_ROAD_SPECS` plus the turn
whitelist in `LONDON_JUNCTION_CONNECTORS`** — Cairo's pattern, mirrored for
left-hand traffic, so a two-way lane's lateral offset is *negated*. The two
halves meet at shared nodes: a generated lane picks up the quarter's lanes as
successors from the whitelist, and `withGeneratedSuccessors` gives the
quarter's hand-authored lanes the same turns back, append-only. **Never write a
generated lane id into a hand-authored `successors` literal** — the id encodes
a segment index nobody can keep true. The same index arithmetic is why **a new
road's termini should be existing nodes**: inserting a node into a shipped
spec's polyline renumbers every later segment's lane ids, and venue anchors
and spawns name those ids with distances. Serpentine Road and the Notting
Hill grid land exclusively on nodes that already existed (the park corner,
`bayswater-mid`, `kensington-exhibition`, the Nevern Place tees) for exactly
this reason.

**Emptiness is judged by what the CAMERA sees, not by kerb-distance rules.**
Six plan-space detectors went to zero and the map was still rejected: they
measured geometry within metres of the kerb while the chase view sees
50–100 m deep. The standard now: **(A′)** any flood-filled void blob ≥300 m²
with an *unoccluded 2-D sightline* from a kerb within ~70 m (occluders are
building rects, walled parks, water) must be filled — distance from the kerb
is **never** an exemption; **(C)** kerb bare over 28 m, no road exempt;
**(D′)** strip spans measured over *name-chained* road sequences — a street
that continues across a junction as another road id is one street; **(G)**
a park edge facing a road more than 0.6 m off the pavement band (0.3 m is
the convention; unwalled lawns fix it by extending INTO the band, walled
parks hold at +0.3 or their wall dies to the 0.65 m veto), including
park-to-park concrete seams; **(H)** a kerb green whose first content behind
its far edge is beyond ~1.5 m. Exemptions: Thames-facing frontage (encode
the outward-ray test) and the world-edge margin only. The proof pass is a
**teleport camera sweep**: `__sideswapTeleport` poses the chase view along
every road both ways (~50 m steps) and each frame is pixel-scored; the score
RANKS work (white stucco reads as grey, so it cannot be a zero-bar) and the
detectors above are the bar. An authored `roadsideParcel` span under ~50 m
ships **nothing** (26 m floor after the 12 m end insets) — always re-query
the block after authoring.

Four parcel traps: `roadsideParcel`'s trimmer clears *foreign roads only* —
a parcel spanning its own road's **bend** chords across its own carriageway
(give it per-segment endpoints; Victoria Street's 70° turn caught this twice),
it does not know parks (the block-vs-park invariant in `content.test.ts` is
the net), and neighbouring parcels tile corners by overlapping — which this
map's visual language absorbs as corner mass and ships everywhere, so treat
block-block overlap as a diagnostic, not a defect. The fourth carves at
*render* time: `buildingReservations`' default historical-buffer circle
clears every service point and venue (gas = footprint max + 16 m — far wider
than the visible lot), so a block or span inside those circles ships
nothing, silently — the quiet-loop island's
authored block stood empty through two play-tests this way. Check
`facadeGridCells` survival against the circles before authoring near a
venue, and where a circle blankets a kerb band outright, green it instead
(Cromwell Fuel's side lawn) — a lawn is not a building and may stand there.

Where a wall against the kerb is wrong, the **boulevard grammar** applies: a
14 m lawn ribbon on the kerb (a pocket park, rotated to the road's bearing via
the park `headingDeg` if the road is off-axis, and **always
`parkStyle: "lawn"`** — a kerb ribbon is scenery seen from the carriageway, and
left to the default dressing a long one elects a full-length trail across its
own width) and the parcel behind it through
`roadsideParcel`'s `extraInsetM`. It comes with two obligations — the ribbon
runs its road **junction to junction**, and it has a building row tucked behind
it for its whole length. A road that bends needs **one rect per centreline
segment**, butt-joined on an exact shared edge where the headings match and
left a ≤0.4 m seam where they cannot; two coplanar lawns must never overlap.
Parcels pushed past the address probe's 22 m reach simply yield no letterboxes.

**Everything rotates the same way: `headingDeg` is a clockwise world yaw**
(local +x to (cos, −sin)) — blocks, parks, colliders, addresses, both maps. A
rect following a run of (dx, dz) therefore wants **`atan2(-dz, dx)`**, never the
textbook `atan2(dz, dx)`; `roadsideParcel` already computes it that way, so
cribbing the sign off the parcel band you are lawning in front of is always
safe. This paragraph used to claim the opposite for parks, and `toWorld` really
was mirrored against the lawn mesh it describes, so all five of London's rotated
ribbons shipped negated. **The AABB is identical under either sign**: audits,
mesh dumps and both map screens showed them straight, the error is zero at the
centre and opens only toward the ends (Notting Hill 9.5 m off its kerb; the
King's Road green 24 m). Three play-test rounds and a car teleported onto the
boundary to find it. Same sign, same z-mirror, same invisibility on axis-aligned
runs as the park-wall yaw in [greenery.md](greenery.md). Gate:
`content.test.ts`'s "keeps every rotated park's long axis on the road it
follows".

**A junction's arms must stay ~45° apart.** `buildPavementGraph` mitres a
junction's rails apart only down to about 40° (Cairo's tightest shipped
corner); below that the surviving rail walks straight through the neighbouring
carriageway, and `pavementPaths.test.ts` catches it. Cheyne Mews originally
met the King's Road 16° off Chelsea Manor Street's arm and had to be rerouted
to join Flood Street instead.

**A roundabout is a road spec with a `roundabout` block**: its `nodeIds` are
the arm nodes in *clockwise* order (left-hand traffic circulates clockwise),
its lanes are arcs about the centre, and the arcs are computed once and used
for both the lanes and the carriageway surface — sampled any other way, the
arms land mid-segment on the ring's asphalt and the pavement graph finds
junctions the asphalt fill never paved. **Keep the arms ~80° apart**:
`buildPavementGraph` trims a rail back at a junction but never further than
the gap to the next one, so two close arms leave the ring's outer rail walking
through an approach's carriageway. Entries are `yield` controls; what makes
them *roundabout* give-ways is derived (docs/simulation-core.md). A
`signalled` roundabout is a **gyratory** — Parliament Square — and signals its
entries instead; circulating lanes are never controlled either way, and a
signal head sampled on a ring arc would face 20° off the bar it governs.

**A bend under 25° is a *continuation*, and continuations get 30° of heading
budget across the node** (`npcTurnSmoothness.test.ts`). A 1.7 m lane offset
cannot hand over across a 16° bend inside that budget, so London's shape nodes
either straighten (Park Lane is dead straight; Regent Street's quadrant is a
real 397 m arc sampled every 8°) or turn properly (Smith Street leaves Royal
Hospital Road at 29°). A **four-lane** road additionally needs Cairo's
`connectorBlendSteps: 12`: its outer lane sits 4.9 m off centre and sweeps all
of it across the six-metre blend.

**Only the landward kerb of a riverside road carries a street wall.** The
parcel trimmer measures against roads, not water, so a parcel on the river
side is shortened by nothing and ends up in the Thames.

**A roadside parcel's *length* is derived, not authored** (`roadsideParcel`):
it starts as long as its road segment and shortens until the whole rectangle
clears every other road's carriageway and pavement. Corner-only checks are not
enough — a parcel whose long side straddles a crossing road has both corners
comfortably clear, one on each side. `cities/tokyo.ts` carries its own
independent copy (`tokyoRoadsideParcel`, Tokyo expansion Phase 4) rather than
importing London's — the function is file-private there, and Tokyo's foreign-
road universe differs — but the algorithm, sign convention and `headingDeg`
formula are identical on purpose. Tokyo's own copy is called from a generator
loop (one call per road-segment-and-side of every non-bridge generated road,
district-styled) rather than ~150 hand-authored call sites, since it has no
per-road building-set overrides to hand-tune around.

### Cairo is the non-grid equivalent

`CAIRO_ROAD_SPECS` plus the turn whitelist in `CAIRO_JUNCTION_CONNECTORS`.
`tests/cairoContent.test.ts` pins its winding/radial headings, lane counts,
kilometre bands, graph connectivity and stable ordering.

Its shallow roadside parcels generate only *after* POIs exist, and must clear
roads, water, bounds, existing blocks, the Sixth October corridor and every
authored exclusion — but an exclusion's inflated margin counts only against
parcels on its **own side** of the fronted road (`RoadsideExclusion`'s
raw/inflated pair + `nearestPointOnOrientedParcel`): the opera park's margin
once erased the kerb *across the street* from itself, so a road-divided park's
exclusion is first clipped to the side its centre is on. Four Nile-facing
sides stay building-free (`CAIRO_OPEN_WATERFRONT_SIDES`, exported) and carry
the derived corniche promenade instead — a parapet off the shoreline colliders
(`shorelineParapetRuns`) plus `generatePromenadeDecor`'s palm/lamp/bench line;
see docs/rendering.md for the render side.

**Cairo's `buildingSet` is derived from where a parcel landed**
(`cairoRoadsideBuildingSet`), not listed per road, so a new road picks up its
district's fabric with no content edit; riverfront roads get `cairo-corniche`.
**Depth is what gets a roadside parcel refused, so it is derived, not chosen**
(`buildingSetDepthM` gives each parcel exactly the depth its set needs), and
there is deliberately **no second rank** behind the frontage (`ROADSIDE_RANKS`
pins zero): the glb kit is one-sided, so a back row stared at the front row's
service wall, planted its own back on the next street over (parallel corridors
run 30–60 m apart), and its early acceptance blocked later roads' front rows.

**A glb parcel whose windowless back would crowd another road keeps the boxes
instead** — demoted to the all-faces-glazed facade grid when its back edge comes
within `CAIRO_BACK_TO_ROAD_MARGIN_M` of any road's pavement envelope (exact
segment-to-segment, `backEdgeNearsARoad`; enforced in `tests/cairoContent.test.ts`).
Raising the margin turns the wall back into a box city — at 12 m boxes
outnumbered glbs — so treat the glb majority as a decision, not a count.

**Measure the kerb, not the neighbourhood.** What a driver sees is the share of
kerb with a building on it, projected onto the road normal — a "block near this
road" metric said 55% where the exact one said 28%. Acceptance is greedy and
ordered, so a road visited late inherits an eaten band; the **gap-fill pass**
after the slot pass projects everything in each kerb's own band (parcels and
same-side exclusions, clipped so a grazing corner casts only its real shadow)
and tiles the true bare intervals — halving to 12 m, then 12 m and 9 m sliver
boxes where parallel streets pinch below full parcel depth. The percentage-
based two-tier audit this paragraph used to describe is gone (visual-gap plan
Section 12.11): `tests/cairoContent.test.ts`'s "leaves no qualifying
bare-kerb run unexplained" now measures the real ground-contact occluder
volumes `collectMapVisualGeometry` produces (the same geometry the `--fan`
audit and `buildGroundRaster` use), gated by `bareKerbRuns`'s 28 m standard —
a candidate only fails if no known qualifying void blob explains it within
70 m. `tests/tokyoContent.test.ts` mirrors this exact shape for Tokyo's own
generated street wall (Tokyo expansion Phase 4), plus a per-district
walled-kerb coverage floor the Cairo version does not carry.

**A third, reviewed pass runs after slot-fill and gap-fill: `CAIRO_VISUAL_CLOSURES`**
(visual-gap plan Section 12.3) — hand-authored closures the camera-fan audit
found necessary, never a general second rank over every hidden parcel
interior. Every `RoadsideExclusion` now carries a stable `id`/`ownerId`/
`ownerKind`, and one pure validator (`validateCairoClosureCandidate`, the
same road/water/bounds/exclusion/sibling checks the two generator passes
already used) gates every closure through `addReviewedCairoClosure`. Its
only new power over the generator passes: an explicit
`allowInflatedOverlapOwnerIds` allow-list can forgive a *specific* owner's
`inflated` margin — never its `raw` footprint, which stays absolute for
every owner, listed or not. A closure that fails validation, or whose
allow-list names an owner with no real exclusion, throws at import time
rather than silently not building — see `tests/cairoVisualClosures.test.ts`
for the negative-case proof.

**A roadside strip must name its one road-facing edge** (`streetEdges` on
`ProceduralBlock`). `slotBlockBuildings` defaults to all four, which is right
for a city block and wrong for a strip: buildings inset by half their depth,
so on a parcel shallower than two depths the opposite rows occupy the same
ground. Guarded twice in `buildingPlacement.test.ts` — the per-parcel and the
map-wide cross-parcel interpenetration sweeps, both seeded like the renderer
because the overlap depends on which models the seed draws.
**One roadside parcel in six deliberately keeps the procedural facade boxes**
(`cairoParcelKeepsFacadeBoxes`), as do all the inland district parcels: plain
stucco blocks are real Cairo, and their size/height jitter varies in a way the
model catalogue cannot — deleting the holdback would make the map *more*
repetitive. Deterministic on the block id; `Math.random` would desync loads.

### Tokyo is two halves

Gotokuji — the original ~600×420 m village, node ids `jp-a`…`jp-ss-e` — is still
**hand-authored lane by lane**, and stays that way: its 56 lanes and 20 road
surfaces are the seed the ten-phase expansion (`.claude/tokyo-city-expansion-plan.md`,
gitignored) grew around, the same way South Kensington anchors London.

Everything grown around it comes from **`TOKYO_ROAD_SPECS` plus the turn
whitelist in `TOKYO_JUNCTION_CONNECTORS`** — London's own pattern, mirrored
again since Tokyo is also left-hand traffic. The two halves meet only at
nodes the quarter already had (`jp-ss-w`, `jp-ss-e`, `jp-nw2`, `jp-ne2`, `jp-d`,
`jp-j`…) — same "never write a generated lane id into a hand-authored
`successors` literal, new roads terminate on existing nodes" discipline as
London's own halves.

**Tokyo carries its own copy of the roadside-parcel trimmer**
(`tokyoRoadsideParcel` in `cities/tokyo.ts`, file-private) rather than
importing London's — the algorithm, sign convention and `headingDeg` formula
are identical on purpose, but Tokyo's foreign-road universe differs and it is
called from a **generator loop** (one call per road-segment-and-side of every
non-bridge generated road, keyed to a per-road `TokyoBlockZone` via
`tokyoStyleForRoad`/`TOKYO_ZONE_FOR_ROAD`) rather than ~150 hand-authored call
sites. Materials/height-range/`density` still come from the district's own
zone style alone (no per-road override table for those — `TOKYO_ROAD_STYLE_OVERRIDE`
is the one exception, a handful of named streets). **`buildingSet` is a
separate, later decision** (Tokyo authenticity plan P2/P3b): `tokyoRoadsideBuildingSet`
derives it from the zone — miyanosaka/yamashita/nishi/`ekimae-nishi`/
`hanamizu` → `tokyo-house`; downtown (outside two exceptions) and `ring` → `tokyo-zakkyo`;
`riverside` and `higashi` → `tokyo-manshon` — with exactly two per-road
overrides of its own, checked before the zone switch so they win regardless
of what their own zone would otherwise resolve to: `jp-nakamise-yokocho`
(zoned `downtown`) and `jp-ekimae-nishi-dori` (zoned `ekimae-nishi`, P4's own
neighbourhood shopping street) both read as `tokyo-shotengai` — the plan is
explicit that only these two shotengai roads diverge from their own zone's
set. Every generator zone now names a set; what still ships
the procedural facade grid is only the ~1-in-4 street-wall holdback parcels
(`tokyoParcelKeepsFacadeBoxes`) plus the hand-authored quarter, which this
generator never touches. `density` is not a fill fraction: it is `facadeGridCells`'s grid-resolution
knob (`count = round(3+density*7)`, tiled `columns × rows`), and only the
front row (`columns`) is ever visible from a road-facing camera — see
`TOKYO_ZONE_STYLE`'s own comment (Tokyo expansion Phase 10) for the draw-call
consequence of getting this wrong.

A long road threading many side-street junctions (`jp-nishi-kanjo-dori`,
`jp-kanpachi-dori` — each 15-24 segments) can chain two short inter-junction
segments that individually fail `tokyoRoadsideParcel`'s own 12 m end-inset
plus `TOKYO_MIN_PARCEL_HALF_LENGTH_M` floor, leaving a bare stretch well past
the 28 m qualifying threshold even though every *other* junction's ~24 m gap
on the same road is normal. `tokyoPhase10RingRoadKerbPatches` is the fix
shape: re-derive one fresh parcel spanning the whole bare interval (the
combined span clears the floor even though its original short constituent
segments did not) — same mechanism as the `jp-tower-park`-adjacent
`tokyoPhase6KerbPatches` patch, both applying the generator's own R18 park/
water exemption (`tokyoBlockOverlapsParkOrWater`) before accepting a patch,
since a "gap" the generator left on purpose (a park providing the frontage
instead) must stay a gap.

The emptiness standard (rules 1-11 below) applies to Tokyo exactly as it does
to the other three cities, camera-fan-verified: `tests/tokyoContent.test.ts`
mirrors Cairo's real-geometry bare-kerb gate with an added per-district
walled-kerb coverage floor, and `npm run audit:visual-gaps -- --maps tokyo
--fan --full-matrix` is the same zero-new-systemic-void bar. A same-methodology
comparison against Cairo (already through dedicated visual-gap-elimination
phases) at full scope shows a *comparable or larger* raw fan-failure volume —
most of it the connected margin/interstitial void the "179 systemic void
blobs" backlog (`three-city-visual-gap-elimination-plan.md`) already scoped as
a future initiative, not a per-map defect; Tokyo's own R2 ("not an NYC-style
grid") guarantees real unbuilt land between its districts that a flood-fill
blob detector will find and a camera, correctly, will not.

## Every road posts a speed limit

Declared once per road — on its `NycRoadSpec` for the grid, in a per-city
`*_ROAD_SPEED_LIMITS` table elsewhere — which `laneTrue` **stamps onto that
road's lanes** rather than taking as a parameter, so a street cannot disagree
with itself. An unposted road throws on import.

The figure is the one on the sign, in the country's own `speedUnit`, never a
canonical unit — chosen from frontage (housing/park/school lower it), class
(arterial > through > local > mews) and geometry (width, curvature, junction
density), and never a number that country does not sign.
NPCs cruise at 68–92% of the limit, drawn once at spawn and re-applied at every
road change, so **the limits are what actually paces traffic** — raising one
speeds up the city and is the one content edit that can move
`trafficSafetyAcceptance`. **London's flat 20 is researched, not lazy**: RBKC
is 20 borough-wide and TfL's 2023 order took the A4 through it down too — both
cited in `LONDON_RULE_REFERENCES` *and shown to the player*.

`roadRealism.test.ts` holds the rest: only figures that country signs, one
figure per road, nothing non-`standard` out-ranking an ordinary road.

## Two authoring tolerances that fail silently

- **`0.08 m` is the definition of "shared node"** for junction fills
  (`ROAD_POINT_EPSILON_M`), pavement rails (`DEFAULT_NODE_EPSILON_M`) *and* both
  sign families (`NODE_EPSILON_M`). A shared endpoint authored 0.1 m apart yields
  no junction fill (grass through the crossing), no pavement trim (walkers on
  the asphalt) and no signage at that mouth.
- **Successors must be geometrically continuous** — tests require 0.01 m and
  the simulation rejects transitions beyond 0.5 m. Break it and traffic queues
  for respawn rather than snapping across the map. An **empty** successor list
  does the same, wherever the player happens to be looking: London's bus lane
  dead-ended at a signal and the double-decker blinked out every green (#128).

Both guarded by `content.test.ts`'s "gives every lane somewhere legal to go"
and `roadRealism.test.ts`'s per-pack circuit walk.

## Addresses

**`streetAddressesForMap` caches by `pack.id`** in a module-level Map (mutating
a pack after the first call has no effect); addresses exist only for roads
listed in `STREET_PROFILES` (today: NYC, London and Tokyo) — a road missing
from it generates none, silently (`addressableStreetNames` catches this).
Cairo has none and relies on authored venues alone.

**A gap-closure block set `addressable: false`** is skipped by the frontage
probe entirely. `generateStreetAddresses` otherwise checks every block in
`geometry.blocks` blind to *why* it exists, so a scenery-only corner cap or
backdrop strip authored purely to stop a camera seeing through to grey ground
can silently create or reorder a gig-pool job. Default (absent) is `true`;
set it `false` unless the block deliberately designs a reachable destination.

**`STREET_PROFILES` holds numbering and gates addressability; display names
live on `MapPack.roadNames`.** Split deliberately, so naming a street for GPS
cannot start issuing gigs on it: Cairo is named and address-free, and both
London and Tokyo name more streets (bridges, ring roads) than they profile —
Tokyo's own three Sakuragawa bridges carry names but no doors, the same
reason NYC's two Hudson/East River crossings do.

**The frontage probe walks the lane's NEARSIDE kerb**, which is the driver's
right where traffic drives on the right and their left where it drives on the
left. Venue set-back is always the driver's right — an author picks the kerb
by choosing which direction's lane to anchor on — but the generator has no
author to make that choice, so it must find the kerb *that lane* runs beside.
Using the right-hand normal on a two-way British street points across the
centreline into the opposing carriageway, and London generated no addresses at
all until this was fixed.

**A block that names no building set zones its addresses by facade material**
(`KINDS_BY_BLOCK_MATERIAL`, consulted only then — `KINDS_BY_BUILDING_SET`
wins the moment a block does name one): the City's glass yields offices,
stock brick yields homes and the odd shop. Tokyo reads the same material
table off its own four generated-block materials — `wood-plaster` homes,
`plaster` a residence/shop mix, `tile` and `concrete` (the east bank's own
material) lean commercial — for every block that still has no `buildingSet`
(most of the map; the Tokyo authenticity plan's P2 gave miyanosaka/
yamashita/nishi and `jp-nakamise-yokocho` their own `KINDS_BY_BUILDING_SET`
rows instead, mirroring what the material table already produced there so
the address pool didn't silently reshuffle). Never `"restaurant"`: a
generated address is never a food pickup on any city, only an authored venue
is. `isInsideRect` is rotation-aware for the same reason — London's parcels
follow streets that bend.

## Service points and venues

**`ServicePoint.kind` is two kinds** (`gas_station`, `repair_shop`); most
machinery wants both — the block carve, prop-scatter and address keep-outs.
Gas-specific readers go through `gasStationsOf`, never an inline `kind ===`,
or the pump maths invents four pumps on a garage forecourt.

`servicePoints.ts` cannot import the model registry (Babylon), so
`SERVICE_MODEL_FRAME` restates each kind's scale and yaw, pinned by
`modelLibrary.test.ts`: a drifted copy rotates every collider off its building.

The repair shop is authored rather than imported (`repairShopLayout.ts`: no
free low-poly auto shop has a drivable bay), so its colliders come off the
constants that draw it, not a glb like `GAS_STATION_SOLIDS_M`. Either way,
solids describe what stops a car: the canopy is excluded (it would wall off
the forecourt) and measured into `GAS_STATION_CANOPY_M` instead, for a staged
camera to duck.

**The setback normal is always the driver's right regardless of traffic
side** — hence London's gas station on a far-side lane and Tokyo's
`setbackM: 19.2`. So **the anchor lane's direction picks the kerb**, and on an
avenue whose two sides differ — park against street wall, houses against shops
— the wrong one cannot be rescued by any `distanceAlongM`. Six venues had
shipped on the wrong side. Two rules hold it now: nothing inside a walled park
(`content.test.ts`) and no shopfront on a detached-house block
(`serviceLots.test.ts`, deliberately not brownstone — a corner bodega on a
brownstone street is Manhattan).

## Private authoring helpers live in one shared module

`cities/nyc.ts`, `cities/tokyo.ts` and `cities/london.ts` import common
primitives (`point`, `node`, `roadMarking`, `control`, `connectorConflictZones`
and more) from `cities/cityAuthoringHelpers.ts`; Cairo's separate road-spec
generator imports none of it. `laneTrue`, `roadIdForLane`, `laneWidthForLane`
and `conflictZoneForNode` stay file-local where a city's values genuinely
differ (London's lane widths, hardcoded left-hand `trafficSide`); NYC/Tokyo's
identical copies share `makeLaneTrue`, closed over each file's own
`speedLimitForRoad`. London *also* carries its own Cairo-style road-spec
generator (`LondonRoadSpec`, `LONDON_JUNCTION_CONNECTORS`) beside its
hand-authored quarter — see "London is two halves" below.

**Adding a city**: a `cities/<city>.ts` importing shared helpers where they
fit; rows in `content.ts` (`MAP_PACKS`/`FREE_DRIVES`/`COUNTRY_PROFILES`/
`DESTINATION_PROFILES`) and `visuals.ts`'s `MAP_VISUAL_PROFILES`, keyed on the
exact `mapId` — no fallback, a missing row throws on load; a column on every
`economyTables.ts` table; map assets; and, for a bespoke landmark, a row in
`render/cityRenderRegistry.ts` plus — if the bespoke shape departs from its
generic kind's box/circle at vehicle height — a recipe in
`geometry/landmarkGroundSolids.ts` (`docs/simulation-core.md`).

## The frozen OSM data is provenance only

The JSON in `public/map-data/` (see its own
[README](../public/map-data/README.md)) is never read at runtime;
`scripts/fetch-osm.mjs` is a manually-run, one-off freezer.
`tests/map-data.test.ts` recomputes a sha256 over
`JSON.stringify({roads, buildings})`, so **reformatting or reordering keys
breaks the checksum even when geometry is identical**. Regenerate; never
hand-edit.
