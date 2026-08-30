# Tokyo Sakuragawa elevated road network

This is the map-specific preservation record for Tokyo's shipped Sakuragawa
Urban Expressway. The generic implementation contract remains in
[grade-separated-road-implementation-guide.md](grade-separated-road-implementation-guide.md).
Keep this page about topology and non-obvious city constraints; the road data
and tests remain the executable specification.

## Shipped shape

`TOKYO_SAKURAGAWA_EXPRESSWAY_SPECS` owns 23 road surfaces under the
`jp-sakuragawa-urban-expressway` prefix:

- one four-lane, roughly 1.9 km cross-city trunk, 14 m wide and 10.5 m above
  grade through its elevated run;
- two terminal carriers that braid between the host streets and the trunk;
- ten one-way profiled ramps; and
- ten one-way, ground-level paved slips that connect those ramps to the host
  road merge nodes.

Together they provide roughly 4.3 km of authored road surface. The trunk runs
west to east across both halves of Tokyo and crosses the Sakuragawa high above
the water. It is a useful network through the city, not a decorative bridge or
an edge-of-map bypass.

## Five access sites, ten directional movements

Each access site has exactly one entry and one exit. These are the intended
movements at the host-road boundary:

| Site | Entry | Exit |
|---|---|---|
| West terminal, `jp-setagaya-dori-west` | eastbound host to eastbound trunk | westbound trunk to westbound host |
| Kanpachi, `jp-kanpachi-dori` | northbound host to eastbound trunk | westbound trunk to southbound host |
| Chuo, `jp-chuo-dori-south` | northbound host to eastbound trunk | westbound trunk to southbound host |
| Kawagishi, `jp-kawagishi-dori` | southbound host to westbound trunk | eastbound trunk to northbound host |
| East terminal, `jp-higashi-dori` | westbound host to westbound trunk | eastbound trunk to eastbound host |

`TOKYO_SAKURAGAWA_EXPRESSWAY_CONNECTORS` is the directional graph boundary.
Every host connection lands at an explicit merge node inserted into a
continuous host-road polyline; do not reconnect an interchange to an arbitrary
lane point or create a disconnected mouth.

## Left-driving lane ownership

Tokyo keeps left. On each two-lane mainline carriageway, lane index `1` (the
lane whose id ends in `-2`) is the outer/nearside travel lane and lane index `0`
is the inner passing lane. Every intermediate entry and exit attaches only to
that outer lane. Entries merge from the left and exits peel away to the left in
the direction of travel. Never make an ordinary ramp cross or branch from the
passing lane.

The west and east carrier transitions are route ends, not intermediate
branches. At each terminal the entry feeds the outer mainline lane while the
ending mainline carriageway exits into the carrier. Keep that topology separate
from the six ordinary branch movements at the three intermediate sites.

## Mouth, grade and curve contract

Every ramp begins or ends in a flat, paved, road-registered slip at the host
street before any vehicle-only grade begins. This keeps the road graph,
sidewalks, junction fill and physical mouth in agreement. Structural deck and
barrier geometry must not start in the pedestrian crossing zone or leave a
seam between ground and ramp.

The profiled ramp centreline is the canonical sampled curve. Sample it once in
`openTokyoRoadGeometryForSpec`, store it in `tokyoRoadGeometryById`, and derive
the road surface, lane offsets, elevation profile, barriers, clearance and
audits from that same sample. Do not independently redraw a visual or collision
curve. The shipped regression limits are:

- minimum local curve radius: 14 m;
- maximum grade: 10.5%;
- maximum legal road-to-road handoff angle: 22 degrees; and
- canonical curve sampling: no more than 7.5 m chord or 5 degrees heading
  change per sample.

The curves are deliberately visible and gradual. A ramp may not collapse into
a straight diagonal merely because its endpoints remain connected.

## River and city preservation

The elevated trunk crosses the Sakuragawa but is not a water portal. The river
portal list remains exactly `jp-sakura-ohashi`, `jp-kawanaka-bashi` and
`jp-tsuki-ohashi`; adding the expressway there would make water collision and
navigation treat the high deck as a surface bridge.

Tokyo's building solids extend vertically, so vertical separation alone does
not clear a route. `tokyoSakuragawaBuildCorridors` derives a plan-view envelope
from all 23 expressway surfaces, including road half-width, parapet depth and a
clearance margin. `carveBlocksForLinearCorridors` must trim or split only the
overlapping block fragments before building placement. Do not delete an entire
city block to clear one curve, and keep rail-corridor carving compatible with
the resulting fragments.

No traffic control, sign, utility pole, lamp, parked vehicle, building or other
prop may occupy a driving or barrier envelope. Expressway nodes remain excluded
from generic junction controls, and every control or prop clearance query must
be elevation-aware and complete for the full candidate search radius. When a
surface route is redrawn, relocate affected authored objects to valid lane
anchors rather than preserving their old world coordinates inside the deck.

## Structure, barriers and rendering

All elevated deck edges and ramp edges require a continuous visible barrier
and matching collider envelope. Barrier bases follow the profiled road surface;
they may not float, expose gaps at the asphalt edge, stop short of a connected
mouth, or rely on an invisible collider. Barrier colliders remain chunked on
grades so their collision envelope follows the visible curve.

Tokyo shares the proven detailed elevated-road construction and batching path
with Cairo, while using its own pale concrete, blue-grey coping, dark steel and
cool-white lighting palette. Static and mirror geometry is world-baked into
45 m spatial cells by material, role, vertex layout, side orientation and
shadow behaviour. Preserve exact shadow-registration semantics and shared
post, reflector and lamp geometry; do not replace the batches with one mesh per
post or one citywide merged collider.

## Verification anchors

The Tokyo network tests should continue to prove all of these together:

- 23 surfaces, about 1.9 km of four-lane trunk and about 4.3 km total;
- all five sites and ten legal one-way movements, with intermediate branches
  restricted to the left-driving outer lane;
- the canonical curve, radius, grade and handoff limits;
- a high river crossing without changing the three surface water portals;
- flat paved mouths, continuous grounded barrier envelopes and no hidden-only
  containment;
- corridor carving without wholesale block loss, and no controls or authored
  props intruding into road or barrier clearance; and
- exact 45 m-cell equivalence for static/mirror batches and exact-coordinate
  equivalence for shadow batches.
