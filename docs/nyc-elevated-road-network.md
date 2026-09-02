# NYC elevated road network

This is the map-specific preservation record for the Queensview Bridge and its
approaches. The generic contract remains
[grade-separated-road-implementation-guide.md](grade-separated-road-implementation-guide.md).

## Identity and visual brief

Queensview is a high, four-lane East River crossing with a substantial approach
network. Harborline remains the smaller at-grade portal bridge. The two must not
be collapsed into one rendering or shoreline rule.

The structural reference is New York's Queensboro/59th Street Bridge: a deep
cantilever-truss silhouette, dense steelwork, large approach structures and warm
night lighting, not suspension towers copied from the other NYC crossing. This
choice follows the [NYC DOT bridge history](https://www.nyc.gov/html/dot/html/infrastructure/queensboro-bridge.shtml)
and the [Historic American Engineering Record](https://www.loc.gov/item/ny0326/).
The dressing is suggestive rather than a scale replica; the authored road remains
the only drivable deck.

## Access inventory

The network has four access sites and eight one-way movements:

| Site | Entry | Exit |
|---|---|---|
| Manhattan terminal | eastbound E 65th to eastbound bridge | westbound bridge to westbound E 65th |
| Third Avenue | northbound Third to eastbound bridge | westbound bridge to northbound Third |
| Vernon Boulevard | northbound Vernon to westbound bridge | eastbound bridge to southbound Vernon |
| Queens terminal | westbound 40th Avenue to westbound bridge | eastbound bridge to eastbound 40th Avenue |

Every ground mouth is a flat auxiliary slip on the driver's physical right.
The host lane continues through the mouth. Intermediate mainline movements use
the outer/right-hand travel lane; the two terminal fan/funnel joins are the only
intentional exception.

## Authored geometry

- The main deck is a separate high road graph, never an elevated version of a
  grid intersection. Third Avenue, the river banks and Vernon Boulevard pass
  below distinct high nodes.
- The main deck holds its full crest across the river and the complete Third and
  Vernon vehicle envelopes. A ramp may begin descending only after its complete
  deck, parapet and vehicle sweep clear the lower road.
- Low opposing grades stay independent. Where terminal movements overlap in
  plan, a raised carrier/braid owns the overlap; there is no low two-way slab.
- Every curved surface is sampled once through `sampleOpenRoadCurve`. Its lanes,
  road surface, paint, structure, collision and maps consume that same sampled
  profile.
- The authored curve caps are 7.5 m chords and 5-degree heading steps. The map's
  target is at most 8% grade, at least 24 m plan radius and at most 15 degrees at
  a legal cross-road handoff.
- Elevated surfaces carry no sidewalk and use the shared 0.36 m parapet depth.
  Flat slips keep a narrow real pavement until the grade begins.

## Map integration

The ordinary NYC grid owns the ground streets and topology breaks at the ramp
mouths. The Queensview generator owns only its slips, grades, carriers and high
mainline, then grants direction- and lane-qualified successors between the two
sets. Free-flow mouths receive no signal or stop control.

`nyc-east-river.bridgePortalSurfaceIds` contains Harborline only. Queensview
passes above an unbroken shoreline collider, so adding it as a portal would
create a false ground opening and side walls at the wrong level. The borough
freight line likewise has no Queensview level crossing; the bridge network ends
west of that rail corridor.

Blocks around E 65th, Third, Vernon and 40th Avenue are carved against the full
road/parapet corridor before buildings are planned. Waterfront park ribbons,
walls, planting, venues, parked cars, signs and other furniture must yield to the
complete grade-separated clearance query, not merely to a centreline distance.

## Rendering and performance

`buildElevatedRoadStructures` supplies the physical deck, fascia, continuous
crash base, rail, barrier colliders, supports and warm lamp line. The bespoke NYC
landmark layer adds only the outboard/overhead cantilever-truss silhouette. It
must not add collision or a second road surface.

Keep the complete stable road-surface array in the shared junction and clearance
caches. Resolve edge runs once, keep the 32 m clearance broadphase and 45 m
static batching, compound repeated lattice/rail/lamp pieces, and retain the
65,536-vertex ceiling for every merged mesh.

## Verification inventory

Focused NYC tests must keep these facts explicit:

- physical-right entry/exit mouths and uninterrupted host lanes;
- exact eight-movement successor inventory and two-way cross-river reachability;
- identical lane/surface elevation, grade/vertical continuity and curve quality;
- complete lower-road, largest-vehicle and freight-corridor headroom;
- continuous visible/physical barriers with openings only at real joins;
- distinct ground/high projection, routing, NPC poses and minimap sheets;
- support, building, sign, tree, parked-car, crowd and street-furniture clearance;
- batched/unbatched render equivalence and deliberate geometry/object budgets;
- physical acceptance drives through every mouth and one complete trip in each
  bridge direction.
