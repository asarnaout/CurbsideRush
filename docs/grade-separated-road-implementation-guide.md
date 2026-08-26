# Grade-separated road implementation guide

This document is the reusable contract for drivable bridges, flyovers and
ramps. It records the Cairo failure modes that made a bridge *look* elevated
while parts of gameplay still treated it as a second line painted on the
ground. Future maps should follow this contract before adding bridge scenery.

Use this together with [map-authoring.md](map-authoring.md) for the lane/surface
schema and [rendering.md](rendering.md) for live QA hooks. Cairo's concrete
application of the contract is recorded in
[cairo-elevated-road-network.md](cairo-elevated-road-network.md).

## Non-negotiable invariants

1. A road user's location is `(x, z, elevation)`, not only `(x, z)`.
2. Roads that cross in plan but at different heights do not share a graph
   node. Only a real ramp, merge or junction connects their lanes.
3. The host street remains continuous through every ramp area. An entrance or
   exit begins as an auxiliary lane and tapers into the host; it never replaces
   the full street.
4. Rendered solids and physical solids come from the same geometry runs.
5. A ground actor, prop, camera or enforcement vehicle cannot interact with an
   elevated vehicle merely because their plan-view footprints overlap.
6. Buildings are preserved by routing through reviewed reservations and by
   adjusting bridge geometry. Deleting the surrounding city is not a bridge
   authoring technique.

## One source of height truth

`RoadSurface.centerline` and the matching legal lane centreline carry optional
`elevationM` values. Omitted means exactly zero. Height between authored points
is linearly interpolated along the segment.

There is one important API distinction: an omitted zero in stored map data is
only a compact representation, while an explicit `elevationM: 0` in a pose
command is authoritative. `SimulationCore.setPlayerPose` clears the old lane
projection whenever it receives any finite elevation, including zero, before
projecting the new pose. Do not test elevation with truthiness at an API
boundary; otherwise a teleport from a flyover to the road directly below can
retain the flyover as its preferred lane.

The same profile drives:

- player and NPC road projection;
- asphalt, markings and junction fills;
- slab, parapet, girder and pier placement;
- vehicle render height, cameras, mirrors, smoke and signs;
- physical parapet collision bands;
- minimap/full-map level emphasis;
- enforcement and cutscene staging.

Do not add a decorative mesh with a separate vertical curve. If a road is
drivable, its lane graph and road surface must own its height.

### Code ownership

| Concern | Authoritative implementation |
|---|---|
| Level thresholds and physical contact | `simulation/roadLevels.ts`, re-exported by `roadElevation.ts` |
| Lane projection and height hysteresis | `simulation/roadNetwork.ts` |
| Player road ownership and pose authority | `simulation.ts` |
| NPC elevation, avoidance, conflicts and swept contacts | `simulation/trafficSystem.ts` |
| Deck/edge/barrier/headroom geometry | `geometry/elevatedRoadGeometry.ts` |
| Rendered slab, girders, parapets and supports | `render/elevatedRoadLayer.ts` |
| Barrier obstacle registration and response | `simulationAdapter.ts`, `simulation/playerDynamics.ts` |
| Ground-walker occupancy | `crowdWalkers.ts`, wired by `render/babylonGameSession.ts` |
| Parked-car and prop headroom | `parkedCars.ts`, `render/roadsideProps.ts` |
| Destructible level ownership | `render/destructibles.ts` |
| Pull-over grade sampling and actor interpolation | `cutsceneScript.ts`, `render/cutsceneDirector.ts` |
| Map level emphasis | `minimapDraw.ts`, `MinimapCanvas.tsx`, `ExpandedMap.tsx` |

Do not recreate these decisions in a city file. A city owns its alignment,
profiles and legal connectors; the shared modules own what elevation means.

### Stacked crossings

Give the ground crossing and elevated crossing different node ids even when
their `x/z` coordinates match. A junction declaration is a legal connection;
never declare one simply to make meshes meet. A real connection needs a ramp
whose successive points provide continuous plan position and elevation.

Every projection query on a map containing elevated roads must supply both the
previous lane and previous elevation. Zero is an explicit preferred elevation,
not “unknown”. This is the distinction that prevents a car on the street below
from being captured by a bridge lane at the same `x/z`.

The same rule applies to debug teleports, resets, cutscene-authored poses and
any future respawn system. A command that knows the intended level supplies it;
one that genuinely does not know may omit it and let the normal road query
resolve the pose.

## Authoring a usable ramp

### Preserve the through street

Insert merge nodes into the existing host surface without moving its
centreline. Add a one-way auxiliary slip beside the appropriate travel lane:

```text
host through lane ────────────────┬────────────────
                                  ╲ taper / aux lane
                                   ╲ ramp grade ─── elevated deck
```

For a two-way connection, use direction-specific entry and exit slips on the
correct sides of the street. Keep the low portions separate. They may braid
into a shared two-way stem only after both soffits clear traffic and people
below.

The following are authoring failures:

- attaching a two-way ramp to the host centreline;
- making the entire host segment become a ramp while an apparent street
  continues underneath;
- putting a ramp touchdown in the middle of a signalized intersection;
- using an undirected junction that permits traffic to turn across the ramp
  mouth from the wrong side;
- beginning parapets at the shared ground node and creating a wall across the
  live lane.

### Use a physical clearance envelope

Review the whole *raised road* footprint, not only its centreline. Include the
pitched asphalt from the first non-zero rise, then the structural deck
overhang, parapet depth and the vehicle/pedestrian envelope below it. The
asphalt and concrete do not begin at the same place: Cairo clips the visible
slab until 0.65 m so the merge mouth stays open, while the road surface rises
from 0 m. A slab-only headroom query therefore leaves a low apron seam where a
ground-height person can intersect the grade.

Ground actors use `createElevatedRoadGroundClearanceQuery`, which takes the
tighter of the complete raised-asphalt profile and the exact slab/pier
headroom. Do not replace it with a larger pedestrian-height constant and do
not simply ban every plan-view bridge overlap: the former still misses the
pre-slab asphalt, while the latter incorrectly removes people from usable
streets beneath high viaducts.

At each sample along a low grade, verify:

- the ramp surface and side structure are outside all continuing through
  lanes;
- pedestrians and required signal heads have adequate soffit clearance;
- the approach has enough length for an understandable taper;
- the first structural slab begins beyond the open merge mouth;
- the pre-slab asphalt apron still excludes ground actors wherever its rise
  intersects their vertical envelope;
- every pier footing, including its 0.10 m visual margin, clears the complete
  carriageway-and-sidewalk envelope of every other road and the deck overhang
  of every lower elevated road.

High viaduct spans may intentionally pass above a ground street or pavement.
Low ramp spans may not. This is why a simple two-dimensional “overlaps another
road” prohibition is too strict for bridges and too weak for ramps.

Author `sidewalkWidthM: 0` on vehicle-only bridge and ramp surfaces. The
pavement graph treats zero as no pedestrian facility; it must never synthesize
a kerb-line rail for such a surface even when a caller forgets to filter
elevated roads first.

### Preserve the city around the bridge

Use this order when a proposed alignment conflicts with the environment:

1. use an existing road, median, waterfront or reserved flyover corridor;
2. shift or narrow the auxiliary ramp while preserving safe lane width;
3. split the directions and braid them after gaining clearance;
4. adjust the grade or add a deliberate curve around frontage;
5. move one asset only when the first four cannot produce a valid result.

Record any moved authored asset explicitly. Procedural pavement furniture that
cannot physically fit beneath a low ramp may be vetoed by the clearance query;
the same furniture remains beneath high spans with real headroom.

## Runtime level ownership

### Player projection

On every fixed step, project with:

- `preferredLaneId`: the last occupied lane;
- `preferredElevationM`: the player's last road height, including `0`;
- heading, to reject implausible opposite-direction captures.

Ground is a physical layer, not a plan-view proximity hint. At ground height,
the road network may search every lane whose complete authored profile remains
at grade. That global ground-only search lets the car recover at intersections
and while briefly off road without ever selecting the nearest deck overhead.
If no compatible ground candidate exists, projection returns no lane and the
car stays at elevation zero; `offRoad` must never be used as permission to copy
an unrelated road's height.

A lane whose profile eventually rises into structural bridge height is more
strictly owned. Live ground driving may acquire it only from the occupied lane,
its adjacent lane, or an immediate **directed successor** (including that
successor's adjacent lane). Do not admit predecessors to this ground-to-ramp
set: on an exit connection, the raised ramp is a predecessor of the continuing
ground slip, and accepting it lets ordinary through traffic climb the off-ramp
backwards. Once the car is elevated, predecessor and successor lanes are both
valid continuity candidates so legitimate travel through either end remains
stable.

The shipped defaults allow 0.55 m of per-step height change. A ground-height
lock never expires because of plan distance: otherwise a ground lane more than
12 m away loses to an overhead deck and the deck's parapet collision can then
throw the newly elevated car sideways. The 12 m capture limit applies only
after the car is already elevated, allowing genuine departures and recovery
from stale bridge state. Lane-id hysteresis is deliberately much narrower than
the heading tie band, so an exactly stacked road stays stable while a genuinely
closer, connected ramp lane can still acquire the car at its mouth.

An explicit finite `setPlayerPose` elevation is a separate authored/debug
operation and may perform a global height-matching capture; this is required to
place a car directly onto a ramp for tests and cutscenes. Normal fixed-step
driving never enables that escape hatch. A ramp changes height continuously;
there is no discrete “teleport to bridge” trigger and no x/z-only trigger
volume toggling the car between levels.

### NPC traffic

NPC state carries current and previous elevation alongside `x/z/heading`.
Spawn, activation, lane changes, corner arcs, render snapshots and swept
collision checks all propagate it. Interpolation must blend elevation at the
same time as plan position; deriving render height afterward from the nearest
two-dimensional lane reintroduces the ambiguity.

Use swept height as well as swept x/z for moving contacts. Two vehicles whose
plan-view paths cross during a fixed step interact only if their vertical paths
also enter the contact band. This preserves a real collision on a changing
grade without making a car below a bridge brake for, hit or reserve space for
traffic above it.

### Physical interaction bands

`roadElevationsCanInteract` is the shared gate for road users. It deliberately
uses a tighter band than the minimap's broad “ground/elevated” presentation
threshold. Apply it before:

- player/NPC swept collision and avoidance;
- NPC/NPC physical clearance at stacked crossings;
- pedestrian and cyclist strikes;
- destructible roadside-prop hits;
- train and crossing-barrier hits;
- patrol proximity and traffic-camera witnessing.

Ground-only service and venue interactions need the same gate. A fuel pump,
repair bay or gig marker authored on the street below must not activate while
the player's plan-view marker happens to pass over it on a flyover.

The check belongs before side effects. A rejected cross-level contact must not
play impact audio, pause the game, damage a vehicle, issue a fine or knock down
an actor.

### Vehicle roof clearance

Elevation filtering prevents phantom contact between different levels, but it
does not by itself make the underside of a low ramp solid. Do not register the
whole deck footprint as a ground-level collider: that would close every valid
high-clearance underpass. Instead, prepare the combined elevated-road clearance
query once and test the player's complete roof envelope after planar motion.

Sample the centre and both end discs of the same capsule used by ordinary
vehicle collision, using the rendered vehicle (or seated rider) height plus a
small roof margin. The query must include the pitched asphalt from its first
rise as well as the later structural soffit. Existing pier colliders remain
responsible for support impacts and normals; exclude them from this second
query rather than resolving one column twice.

A prospective, topology-constrained lane projection supplies each sample's
tyre height. Thus the player's own legal ramp is at or below the vehicle and is
not mistaken for a roof obstruction, while the identical x/z footprint remains
solid to a car on an unrelated lower street. Clip a clear-to-blocked fixed-step
move back to the precise clearance boundary and stop the vehicle. A car already
authored inside a low envelope may move outward so a debug pose cannot become
permanently trapped.

Do not implement carrier ownership as a comparison against only the single
obstruction returned by the query. At a ramp/slip seam the axle may already
project to the flat road while the trailing capsule disc still overlaps the
profiled predecessor; an exact road-id comparison then turns a centimetre-high
pavement seam into an invisible transverse wall. Filter candidates *inside*
the prepared query before it selects the lowest one:

- discard road tops within the 0.35 m road-level capture band of the tyres;
- always exclude the projected carrier road;
- for the leading capsule sample, exclude only a directed successor;
- for the trailing sample, exclude only a directed predecessor;
- never use the predecessor exemption on a leading/wrong-way ground approach;
- after removing carrier candidates, still return any genuinely separate deck
  above them.

The front/centre/rear distinction matters. Broadly exempting every connected
road makes an off-ramp climbable backward; rejecting every differently named
surface blocks legal handoffs. Directional capsule ownership resolves both.

## Pedestrians, signals and ground props

Building pavement rails only from ground surfaces is necessary but not
sufficient: those rails may still pass under the low end of a ramp.

The elevated geometry layer exposes a prepared soffit/headroom query based on
the same clipped deck runs, slab thickness and overhang used to render the
structure. Its footprint argument matters: checking only the centre of a pole,
car or person permits the edge of a sloping slab to cut through the rest of the
object. Ground walkers use the query as an occupancy predicate:

- respawn candidates inside a low-clearance envelope are rejected;
- a walker approaching that envelope keeps the last valid pose, turns around
  and pauses;
- pavement below a high viaduct remains walkable.

Every ground placement supplies its own required height and footprint:

- a traffic signal uses the complete head-and-pole clearance and its kerbside
  search rejects candidates that intersect the structural envelope;
- a parked car uses the selected model's roof clearance and a footprint large
  enough for the full vehicle, not a generic point sample;
- roadside furniture uses a kind-, variant- and scale-aware envelope, so a
  short bollard may legally remain beneath a span that cannot fit a streetlight
  or utility pole;
- reachable park planting and batched interior thickets are gated before they
  enter their separate render queues, not only after ordinary roadside scatter
  has been filtered.

Required traffic controls cannot simply disappear. Their authoring search must
find a nearby kerbside position that clears both live lanes and the ramp
structure. If no such position exists, reauthor the ramp touchdown rather than
putting a signal through concrete. Conversely, do not apply one excessively
tall clearance constant to every prop: that erases plausible low furniture and
makes a high, useful undercroft needlessly empty.

### Destructible props retain their level

A destructible registration carries the prop's road elevation. Broad-phase
x/z overlap is followed by `roadElevationsCanInteract` before damage, audio,
particles or fall animation can start. The fall pivot, light pool and impact
burst are based on the registered elevation as well; otherwise an elevated sign
can be hit from below or fall down to world zero after a legitimate deck-level
strike.

## Parapets are gameplay geometry

Rendered parapets are not collision. Build physical barrier OBBs from the
exact trimmed edge runs used by the elevated-road renderer. This guarantees
that openings at elevated merges remain open and every visible uninterrupted
barrier is solid.

`elevatedRoadEdgeRuns` is the shared source for both the visible parapet and
`elevatedRoadBarrierPlacements`. Long sloped runs are subdivided into at most
8 m collision chunks, with small plan overlaps that close grade seams. Each OBB
carries `minElevationM` and `maxElevationM` for its local road-height band.
Without a minimum, a parapet at 10.5 m blocks ground traffic below; without
subdivision, one long ramp barrier has a vertical range broad enough to block
both levels. Never author a second, approximate set of side-wall colliders.

The collision response should:

- prevent penetration from either side;
- preserve tangent motion so a glancing hit slides along the wall;
- report the barrier id and a bridge-specific correction;
- operate at mainline and ramp heights, while permitting traffic below a high
  span.

## Enforcement and cutscenes

A patrol can witness a violation only when its elevation is compatible with
the player. Speed cameras have the same rule. This prevents a ground patrol
from citing an otherwise empty bridge.

The traffic-stop scene keeps elevation in every car pose. Its road selection
ranks candidate surfaces by both horizontal distance and height, so a ground
street beneath the player cannot win. The pull-over road is then sampled by
arc length: parked player, patrol start, patrol stop and every officer path mark
receive the interpolated elevation at their own x/z position. The director
interpolates actor elevation between path marks and keeps the actor's foot
offset separate from the road height. Do not stage every participant at one
constant Y copied from the player; that works on a flat mainline and visibly
cuts actors and cars into a sloped ramp.

The scene writes the full pose back to simulation throughout the pull-over, and
the camera target follows the same selected level. A cross-level patrol is not
eligible to start the scene in the first place.

The camera is structural geometry too. Query the real soffit over every staged
car/officer mark **and over each candidate camera position**. Rank a ring
azimuth outside an impossibly low slab ahead of one inside it, then clamp the
chosen camera below the lowest relevant soffit with the same cover clearance
used for roofs. If the actor, either car or the minimum usable camera height
does not fit, move the complete pull-over mark forward along the selected road;
never leave the people on one level and merely move the lens.

## Map presentation

The minimap and expanded map render both levels so connections remain legible:

- the player's current level uses the stronger, prominent stroke;
- the other level remains visible but translucent;
- the switch uses road elevation, not camera height or a hand-authored zone;
- ramps transition continuously and remain navigable at every point.

## Cairo lessons

The Cairo network uses the 6th October Bridge corridor and retains its original
reservation parcels so deterministic frontage does not reshuffle. The mainline
and access roads are legal lane-graph surfaces, not the old scenic landmark.

The bugs that prompted this guide came from independent planar assumptions in
several systems:

1. ground projection did not pass an explicit zero-height preference;
2. NPC snapshots and collision checks omitted elevation;
3. vulnerable-user, prop and enforcement checks used only `x/z`;
4. parapets were registered for rendering/shadows but never as simulation
   obstacles;
5. low ramp footprints were absent from pavement and signal-clearance rules;
6. parked cars and queued park planting did not test structural headroom;
7. destructible props forgot their authored elevation after registration;
8. pull-over choreography treated a sloped road as one flat Y plane;
9. a 12 m plan-distance cutoff discarded the ground lock beneath a wide or
   oblique flyover, selected the deck above and activated its parapet collider;
10. ground projection accepted profiled predecessors, so through traffic could
    capture a shallow exit apron and ratchet upward against legal direction;
11. player physics had no roof-versus-soffit test, so a ground car could enter
    beneath a physically impassable low ramp even though tall props and walkers
    were already excluded there;
12. the first roof fix exempted only an exact projected road id, so every
    differently named ramp/slip handoff could become an invisible wall as the
    axle changed lanes before the vehicle's trailing footprint did.

Fixing only a mesh or one ramp could not solve those failures. The implementation
now treats grade separation as a shared simulation invariant and then reauthors
the Cairo approaches that violate the auxiliary-lane/clearance contract.

## Implementation order for another map

1. Author matching lane and road-surface elevation profiles; split stacked
   nodes and grant turns only at real ramps or same-height junctions.
2. Preserve each host street, then add direction-specific auxiliary entry and
   exit slips with a real taper and an open ground mouth.
3. Run deck, block, pavement, pier and through-lane clearance audits before
   changing any building. Adjust alignment and grade first.
4. Generate asphalt and all structure runs from the surface profile. Register
   local-height parapet OBBs from the same trimmed edge runs. Offset elevated
   poles, signal heads, enforcement cameras and crossing rigs by their authored
   base height, and pitch stop bars/road markings between endpoint heights.
5. Enable height-continuous projection for player and NPC traffic and propagate
   previous/current elevation through snapshots and render interpolation. Pose
   snap detection must measure vertical displacement too, so a pure level
   reassignment cannot be blended through a deck.
6. Gate collisions, vulnerable users, enforcement, ground-only interactions
   and destructibles with the shared physical elevation band.
7. Prepare one structural headroom query and apply object-specific envelopes to
   the player's full roof capsule, walkers, signals, parked cars, roadside props
   and every park-planting queue. Preserve high underpasses and legal ramp
   travel; never substitute a blanket two-dimensional slab collider.
8. Make cutscene vehicles, walking actors and camera targets sample the chosen
   road profile instead of using a constant stage Y.
9. Add ground/elevated emphasis to both map views from the player's road
   elevation.
10. Complete the automated and in-game checks below before copying the pattern.

## Required verification for every future map

### Geometry and content tests

- every elevated surface and lane has the same elevation profile;
- stacked crossings have distinct nodes and no accidental turn grant;
- each ramp is reachable in its intended direction and can return to the host;
- the host road has a continuous through route past every mouth;
- low ramp structure does not overlap the host through-lane envelope;
- blocks/landmarks do not intersect the deck or ramp volume;
- pier footings clear the full road-and-pavement envelope of every other road;
- required traffic controls clear the deck soffit;
- elevated traffic-control poles, heads, cameras, crossing rigs and road
  markings render at their authored road height;
- each parked-car model and each roadside/park prop clears the soffit over its
  full footprint;
- every rendered edge run is fully covered by barrier chunks, with no extra
  barrier crossing a trimmed merge opening.

### Simulation tests

- a ground player remains on ground below a bridge for repeated fixed steps;
- the same remains true when the nearest compatible ground lane is farther than
  the elevated capture radius and the overhead deck is closest in plan view;
- an unrelated shallow ramp cannot capture a ground player within the normal
  per-step elevation tolerance;
- a profiled exit predecessor cannot be acquired backward from its ground slip,
  while the same profile is acquired when it is a directed entry successor;
- an elevated player remains elevated at the same crossing;
- ramp ascent/descent changes height monotonically without oscillation;
- cross-level player/NPC swept paths do not collide or brake for each other;
- cross-level NPC/NPC conflicts, reservations and spawn checks ignore one
  another while same-level versions still work;
- same-level collisions still work;
- bridge parapets block at their local height and do not block the road below;
- a low soffit and the pre-slab raised-asphalt apron stop the player's roof at
  their actual footprint boundary, while a high span remains driveable below;
- the same clearance query does not block a player climbing the connected
  profiled ramp that carries the vehicle;
- every profile/slip handoff passes in its legal direction, while approaching
  an exit ramp backward from its ground slip still collides;
- excluding the carrier before lowest-candidate selection still reveals a
  separate stacked deck above it;
- pedestrians cannot spawn in or walk into low-clearance ramp envelopes;
- an elevated car cannot strike a ground pedestrian or destructible, and an
  elevated destructible falls and emits effects at its own level;
- a ground patrol cannot witness an elevated violation;
- a ground service/gig marker does not activate from the bridge above;
- an elevated or sloped-ramp pull-over keeps every vehicle and actor on the
  sampled road profile from first frame to last.
- exact under-deck pull-over fixtures keep the selected camera below the
  authored soffit, including when the camera ring reaches a slab that does not
  cover either filmed subject.

The shipped regression homes are `tests/elevatedRoadGeometry.test.ts`,
`tests/elevatedRoadVehicleHeadroom.test.ts`,
`tests/cairoContent.test.ts`, `tests/simulation.test.ts`,
`tests/simulationAdapter.test.ts`, `tests/trafficRouteGoal.test.ts`,
`tests/crowdWalkers.test.ts`, `tests/parkedCars.test.ts`,
`tests/roadsidePropHeadroom.test.ts`, `tests/destructibles.test.ts`,
`tests/cutsceneScript.test.ts`, `tests/cairoBridgeCutscene.test.ts` and
`tests/minimapDraw.test.ts`. A new map should
extend the shared invariant tests and add map-specific geometry assertions; do
not replace shared coverage with screenshots.

### Live debug checklist

- Use `__sideswapTeleport({x, z, heading, elevationM: 0})` for the street at a
  stacked crossing, then repeat with the authored bridge elevation. Never omit
  `elevationM` in this test.
- Use `__sideswapCollisionOverlay(true)` and
  `__sideswapCollisionDebug()` to compare visible parapet runs with nearby
  obstacle OBBs and their `minElevationM`/`maxElevationM` bands.
- Use `__sideswapEnforcementDebug()` at the same x/z on both levels to verify
  patrol and camera eligibility changes with level rather than plan distance.
- During a ramp pull-over, inspect `__sideswapCutsceneDebug().active`; actor and
  patrol Y values must follow the sampled grade and must not collapse to ground
  level.
- Capture the minimap and expanded map once on each level. Both networks remain
  legible, but only the occupied level receives the strong stroke.

### In-game acceptance drive

Drive every entry and exit in both camera modes. At each stacked crossing,
stop once on the ground and once above it. Confirm:

- no vertical snapping or ground meshing;
- no phantom collision, horn, impact sound, pause or fine;
- no pedestrian, signal, sign, tree or lamp intersects a low deck;
- the continuing street is visibly and physically open beside the ramp;
- parapets contain the vehicle without invisible transverse walls at merges;
- low ramp soffits stop the vehicle cleanly, while every authored high-clearance
  underpass remains open and does not trigger a collision event;
- nearby buildings remain present and clear of the structure;
- minimap emphasis changes cleanly with the occupied level.

Also drive a continuous ground route beneath each main deck and every ramp,
including points well outside a road centreline's nominal capture radius. Then
drive past each exit mouth without turning and enter each legal on-ramp from
its connected auxiliary lane. The first two drives must remain at ground
height; the legal entry must climb smoothly.

Do not copy a bridge to another map until all three groups pass.
