# Grade-separated roads: authoring and structure

Read [the implementation guide](grade-separated-road-implementation-guide.md)
first. This chapter turns an access plan into continuous road and structure
geometry without sacrificing the host streets or surrounding map.

## Inventory movements before drawing ramps

Describe each access site as directed movements, not as “one ramp.” For every
entry and exit record the host road and direction, nearside kerb, auxiliary
lane, first rising point, elevated carrier/mainline lane and explicit successor
chain. Reachability tests must cover every row of this inventory.

`trafficSide` decides the physical nearside:

| Map rule | Nearside ramp position |
|---|---|
| right-hand traffic | right of the legal direction of travel |
| left-hand traffic | left of the legal direction of travel |

Opposing directions therefore use opposite physical kerbs. An on-ramp diverges
from that direction's nearside through lane; an off-ramp joins it and then
tapers away. Neither movement crosses the opposing carriageway. If a sourced
real interchange has a far-side exception, treat it as exceptional junction
geometry with its own conflicts and tests, never as the generator default.

## Preserve the through street

Insert merge nodes without moving the host centreline. Keep the entire widening
and slip at ground elevation until a full vehicle fits outside the through lane.
Only then begin the turn and climb. Starting a diagonal at the host centreline,
raising the apparent host, or placing the touchdown in an intersection closes
the road even when the asphalt image appears continuous.

At a constrained two-way access, keep the low entry and exit separate. They may
join into a two-way stem only after both structures have real clearance over
traffic and people. When one corridor cannot hold two low grades, separate them
longitudinally: climb in one block, descend in another, then braid at height.
End each directed lane at the braid; an extra reverse lane beyond the join is
unreachable pavement.

At a network terminal, finish the multi-lane mainline at deck height. Connect it
to a distinct high carrier, hold a short level throat until the carrier clears
the mainline footprint, then descend to a still-clear directional braid and
separate one-way grades. Author explicit fan/funnel successors across lane-count
changes. A low two-way mainline approach will cover the host street.

At nonterminal mainline connections, use only the outer/nearside mainline lane.
A terminal fan/funnel may deliberately use all same-direction lanes; do not turn
that exception into the ordinary merge rule.

## One curve and one height profile

`RoadSurface.centerline` and each matching legal lane centreline must derive from
the same sampled source and carry the same `elevationM` profile at corresponding
stations; lane x/z points are the expected lateral offsets. Omitted map-data
height means exactly zero, and interpolation along a chord is linear. Never
animate or render a second vertical curve.

Keep topology knots exact, but replace the chords between them with one sampled
C1-continuous open curve. Reuse those samples for lanes, surfaces, paint, slabs,
barriers and maps. Inherit endpoint tangents from the wider carrier when the
mouth is shallow; use explicit tangent overrides where frontage constrains the
approach. Adaptive sampling must bound both chord length and heading change.

Add map-specific tests for minimum local radius, maximum grade and maximum legal
handoff angle. Cairo's 7.5 m/5 degree sampler and 14 m/10.5%/22 degree regression
limits describe a compact existing map, not universal civil guidance. Choose
gentler limits where the map has room.

## Stacked crossings are separate topology

Ground and elevated crossings at the same `x/z` use different node ids and no
junction declaration. A junction is legal connectivity, not a mesh-welding
hint. A real connection requires a continuous ramp in plan and elevation plus
explicit directed lane successors.

Vehicle-only bridge and ramp surfaces use `sidewalkWidthM: 0`. Otherwise the
pavement graph can synthesize a false pedestrian rail along a vehicle structure.

## Build one profiled junction collar

Constant-width strips cannot safely form an elevated merge, fork or unequal-
width handoff. Their slabs step or overlap while independently trimmed parapets
leave gaps. `buildElevatedRoadJunctionEnvelopes` instead clusters same-level
shared endpoints and produces one physical collar. A narrow motorway branch is
the deliberate exception to centreline equality: its authored endpoint stays
on the wider carrier's outer travel lane. When that endpoint lies inside the
carrier footprint at an authored carrier knot, the junction planner inserts a
collar-only cross-deck arm to the carrier centre. Do not move the legal lane to
that synthetic pivot or widen a one-lane ramp to fake a centreline join.

The collar contract is:

- begin at the widest incident throat plus the legal connector flare;
- ease each arm to its authored width over a real reach, extending paired
  branches until their complete barrier corridors separate;
- widen only the outside of a smaller branch meeting an internal mainline;
  widening both sides pours a second mainline-width slab over live lanes;
- union overlapping nearby collars into one compound envelope;
- use one profiled deck TIN as the height source, then clip asphalt from that
  exact TIN so the two planes cannot float apart;
- derive exterior deck and barrier guard runs from the same boundary, leaving
  only real arm mouths open;
- blend grade across the collar and test its surface, not only arm centrelines.

`geometry/elevatedRoadJunctions.ts` is pure shared geometry. Do not re-create a
city-specific collar mesh or approximate its headroom/colliders elsewhere.

## Decks, barriers and supports

The ordinary road pass renders the asphalt. `elevatedRoadDeckRun`,
`elevatedRoadEdgeRuns` and the junction envelopes derive the structural layer.
At a connected endpoint the full-width slabs overlap beneath the paved mouth;
only edge/fascia/guard runs are trimmed. Suppress transverse terminal caps at a
join: a cap hidden under asphalt is still an invisible wall, while cutting the
slab back creates a drive-off gap.

Parapets are gameplay geometry. The lower crash profile must be a continuous
solid whose toe is seated directly on the deck and matches the shared barrier
OBB. An upper maintenance/pedestrian rail, coping, paint and reflectors are
render-only dressing; an open rail never replaces the solid base. Use the exact
trimmed edge and collar guard runs for every layer.

At an internal bend, intersect the two physical edge lines. Trim the inside run
to the miter and extend the outside run to it; clamping both trims positive
opens a gap. Phase posts, panels, lamps and reflectors by accumulated surface
distance so segment splits do not restart the pattern.

`elevatedRoadBarrierPlacements` and
`elevatedRoadJunctionBarrierPlacements` subdivide runs into local-height OBBs.
Their minimum and maximum elevations keep a ramp barrier from blocking the
street below. Do not add an approximate collider set or collision-only patch.
Pier visuals and ground-only colliders likewise share placements and the
rendered footing radius.

## Design with the complete clearance envelope

The structure footprint begins with pitched asphalt at the first nonzero rise,
then grows to include deck overhang, fascia, barrier toe and supports. The
visible slab begins only at the structural cutoff, so a slab-only query misses
the low raised-asphalt apron.

At close spacing, sample all of the following:

- continuing lanes and their full playable lateral envelope;
- lower roads and pavements, including the tallest required vehicle/person;
- every support footing plus its visual margin and every lower-deck overhang;
- blocks, landmarks and the **actual planned building/model solids**, not only
  parcel or block rectangles;
- complete installations: pole, head, arm, crown, panel, gantry legs and sign
  face, not only the anchor point;
- every merge gore, internal bend, collar mouth and slab handoff.

A kerb-side grade approaching its parent deck stays outside the parent's full
driven envelope until effectively at deck height. Then shoulder slabs may lap
to close the gore and their tangents must converge without a kink.

## Keep the city intact

Resolve conflicts in this order:

1. use an existing road, median, waterfront or reserved infrastructure corridor;
2. shift the ramp or narrow it without violating usable lane width;
3. separate directions and braid them after gaining clearance;
4. adjust tangent, curve or grade;
5. move only the exact affected asset by the smallest reviewed amount.

Preserve asset ids, models, materials, dimensions and unaffected neighbours.
Record reviewed moves in authored data and pin original counts plus façade/deck
clearance. A procedural object that does not fit first searches deterministic
local positions along its own road, promenade or planting run. It may be omitted
only if it is nonessential and no safe local position exists. Required controls
force reauthoring or a valid alternate installation; they do not disappear.

Generated regulatory and speed signs need a presentation review after geometry
is final. Preserve legal information, but de-pair or suppress redundant posts
that stand in a driven envelope, collide with another installation or make a
merge unreadable. Keep exact curated ids in the city layer and tests; do not
weaken the shared legal-flow generator for one dense interchange.

Bridge-mounted lamps and signs use their road height and test their complete
envelope against other decks. A lamp that clears its own parapet can still pierce
a crossing flyover with its pole or inward arm. Query overhead structure while
excluding only the carrier surface, and omit or relocate that station.

## Water crossings

An elevated deck passes over a continuous shoreline collider and must not be
listed in `bridgePortalSurfaceIds`. That whitelist is for an at-grade drivable
deck that cuts the bank. For such a bridge, derive the shoreline opening and
paired solid parapet runs from `bridgePortalRailSpans`; use the same portal width
for visuals and collision, overlap rails onto the bank, seal both sides and
prove the mouth itself remains open. Never open a shoreline merely because a
road is bridge-named.

After the structure is stable, add a city-specific visual grammar—materials,
coping, rails, reflectors and lighting—without changing the shared physical
outline.
