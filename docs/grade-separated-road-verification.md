# Grade-separated roads: verification and handoff

Read [the implementation guide](grade-separated-road-implementation-guide.md),
[authoring chapter](grade-separated-road-authoring.md) and
[runtime chapter](grade-separated-road-runtime.md) first. A bridge is complete
only when the automated, live-debug and in-game gates below all pass.

## Start with an auditable inventory

Create a table in the map-specific test or reference doc with one row per legal
entry and exit. Include host direction, nearside kerb, slip, grade, carrier,
mainline lane and successor chain. Derive tests from this table. Never maintain
an “intermediate ramps” list that silently omits terminals or a newly added arm.

Record the largest catalogue capsule radius, half-length and roof height, the
map's traffic side, every stacked crossing, every at-grade water portal and any
reviewed asset relocation/curation. These are acceptance inputs, not comments
to reconstruct after a failure.

## Automated gate 1: content and legal topology

Assert that:

- every elevated `RoadSurface` and legal lane derives from the same sampled
  curve and has the same elevation profile at corresponding stations;
- different levels have distinct nodes and no accidental connector;
- every inventoried entry and exit is reachable through explicit successors;
- every host direction has a continuous through route past every mouth;
- each slip is on the nearside derived from `trafficSide`, remains flat through
  the widening and does not grant a cross-opposing-carriageway turn;
- constrained low entry/exit grades stay separate until a high braid;
- terminals use a distinct high carrier, level throat, directional braid and
  explicit fan/funnel successors;
- vehicle-only surfaces declare no sidewalk;
- every at-grade water portal is explicitly whitelisted, open through the bank
  and sealed by physical side parapets; high bridges do not open shorelines;
- real mouths retain legal signs while degree-two authoring seams do not create
  contradictory clutter.

Use the access inventory as the expected set; do not pin only a total count.

## Automated gate 2: road and structural geometry

Assert at adaptive or close fixed spacing that:

- sampled chords meet the map's heading-step, radius, grade and legal-handoff
  limits;
- a ramp mouth is an open, flat taper before meaningful ascent/turn/structure;
- the complete low ramp structure clears every continuing lane and pavement;
- ramp-to-parent overlap begins only near deck height and forms a closed gore;
- every merge/fork/width change has one gradual junction envelope, with asphalt
  clipped from the same profiled deck TIN;
- collar grade is bounded and every arm is supported across its full asphalt
  width;
- ordinary and collar guard endpoints hand off to another run with no gap;
- internal bends use exact signed miters and clear the largest vehicle at every
  legal lateral position;
- joined endpoints have slab lap but no transverse terminal cap;
- every visible edge run is covered by height-banded barrier chunks and no
  barrier crosses an open mouth;
- barrier crash toes sit on the deck; upper rails are supported by a solid base;
- support footings plus visual margin clear every other road, pavement and
  lower elevated deck.

Templates: `tests/elevatedRoadGeometry.test.ts`,
`tests/elevatedRoadJunctions.test.ts` and
`tests/cairoBridgeGeometryQuality.test.ts`. Keep shared synthetic invariants;
add a new map-specific geometry-quality suite for the authored network.

## Automated gate 3: the production world is unobstructed

Build the real scenario, `BuildingLayoutPlan` and `buildStaticObstacles` result.
Mocks, block rectangles, a bridge-only collider list and visual screenshots do
not qualify.

Run both complementary sweeps:

1. **All-lane sweep:** sample every legal lane at no more than 2 m, interpolate
   elevation and test the complete production obstacle set. This catches
   buildings, props, supports and stale unrelated solids throughout the map.
2. **Detailed bridge-envelope sweep:** sample every bridge/ramp lane at no more
   than 0.5 m. At left, centre and right legal vehicle positions, test the front
   and rear discs of the maximum catalogue capsule against **every** production
   solid, not only `roadBarrier`. A clear centreline is insufficient.

Generalize the Cairo-specific detailed sweep in `tests/staticColliders.test.ts`
when adding another map; do not leave its road-id filter covering only the old
network. Also test every spawn and the full walkable pavement band.

Audit rendered/planned envelopes, not anchors:

- actual building/model structural solids clear deck and driven envelopes;
- traffic-signal poles and heads clear soffits and live lanes;
- regulatory/speed-sign poles and faces remain on their own kerb profile and out
  of the driven merge envelope;
- bridge lamps include pole, arm and head and clear higher crossing decks;
- advertising gantries include faces, overhead clearance and both legs;
- parked vehicles use model-specific roofs and footprints;
- roadside and park props use kind/variant/scale-specific envelopes;
- relocated assets remain deterministic, counted and clear; required controls
  remain present; explicitly curated redundant furniture/signs remain absent.

## Automated gate 4: runtime level behavior

Provide fixtures proving:

- a ground player remains ground at every stacked crossing for repeated fixed
  steps, including when the compatible ground lane is farther away in plan;
- an unrelated shallow apron cannot capture that player;
- legal successor **and predecessor** ramp entry acquires height monotonically;
- a no-steering aligned handoff retains the rising lane beyond the seam;
- same-height raised forks choose from physical trajectory without adding NPC
  successor edges;
- an elevated player remains elevated and a detached authored 3D pose resolves
  to the requested level;
- cross-level player/NPC and NPC/NPC paths do not collide, avoid, reserve,
  witness or activate ground interactions; same-level cases still work;
- every profile/slip handoff is driveable in both physical directions; wrong-way
  reporting remains and NPC routing stays directed;
- a low soffit and pre-slab asphalt apron stop all three roof samples at the
  true boundary; a high underpass remains open;
- the player's connected one-hop pavement is not mistaken for a roof, but a
  separate stacked deck above it still is;
- parapets block at local height, slide glancing impacts and never block below;
- walkers, signals, parked cars, props and park queues respect their individual
  headroom envelopes;
- destructibles, enforcement, traffic stops, actors, effects and cameras retain
  the selected level through their complete lifecycle;
- minimap/full-map emphasis changes level without losing either network.

Templates include `tests/elevatedRoadVehicleHeadroom.test.ts`,
`tests/simulationAdapter.test.ts`, `tests/simulation.test.ts`,
`tests/crowdWalkers.test.ts`, `tests/roadsidePropHeadroom.test.ts`,
`tests/parkedCars.test.ts`, `tests/destructibles.test.ts`,
`tests/cutsceneScript.test.ts` and `tests/minimapDraw.test.ts`.

## Automated gate 5: exactness and performance

- Extend exhaustive projection equivalence to the new network: segment
  boundaries/midpoints, lateral tie bands, all directed seams, ramp mouths,
  stacked levels, ground/raised preferences and detached authored poses.
- Assert compatible-first projection scan reduction and logarithmic
  `pointOnLane` lookup without changing legacy results.
- Compare batched and unbatched bridge rendering for identical world geometry,
  indices, roles, visibility cells and exact shadow-registration groups.
- Pin deliberate per-map geometry and scene-object budgets. A content change
  updates them with explanation; an optimization must not reduce source
  fidelity; a regression must not raise caps silently.
- Verify both minimap level sheets are cached and a level transition does not
  rebuild network geometry.

Templates: `tests/roadNetworkProjectionEquivalence.test.ts`,
`tests/elevatedRoadLayer.test.ts`, `tests/minimapCanvas.test.tsx` and
`tests/perf/roadProjection.bench.ts`.

## Live debug checklist

- Use `__sideswapTeleport({x, z, heading, elevationM: 0})` at every stacked
  crossing, then repeat with the exact bridge/ramp height. Never omit elevation.
- Use `__sideswapCollisionOverlay(true)` and
  `__sideswapCollisionDebug()` to match every visible parapet/support to nearby
  OBBs and elevation bands. Investigate any collision with no visible cause and
  any visible solid with no collider.
- Use `__sideswapEnforcementDebug()` at the same x/z on both levels.
- During ramp and under-deck stops, inspect
  `__sideswapCutsceneDebug().active`; actor, car and camera heights must follow
  the selected road and clear the soffit.
- Inspect the planned/rendered building debug view at every close frontage;
  parcel clearance alone is not proof.
- Capture both map views once at ground, ramp and deck height. Both levels stay
  legible and only the occupied level is strong.
- Inspect day and night. Barriers must remain continuous and seated, merge mouths
  readable, and lamps/signs/gantries must not pierce slabs or carriageways.
- Record `__sideswapPerfDebug()` at a mainline, dense merge and ramp. Compare
  active meshes, draw calls, shadows and traffic/projection diagnostics with the
  established map budget.

## In-game acceptance drive

Use the widest/longest playable vehicle and both camera modes. Drive every
inventoried entry and exit, including the reverse physical direction used to
test pavement continuity. Drive straight past every exit without turning. Drive
a continuous ground route below each main deck and ramp, including places far
from a ground centreline. Stop once below and once above every stacked crossing.

Confirm:

- no vertical snap, lane-ownership oscillation or ground meshing;
- no invisible wall, transverse merge cap, barrier gap or collision side effect
  from another level;
- nearside entries/exits are unambiguous and host through lanes remain open;
- ramp curves, grades and handoffs are smooth without steering correction at a
  nominally tangent continuation;
- solid barriers contain and slide the vehicle, sit on the deck and remain open
  only at real mouths;
- low soffits stop cleanly while every intended underpass stays usable;
- no building, sign, signal, lamp, gantry, tree, pedestrian or parked object
  occupies the driven envelope or pierces a deck;
- nearby buildings and streetscape remain present;
- regulatory information is readable without forests of duplicate posts;
- maps, enforcement, interactions and cutscenes use the occupied level;
- frame behavior at dense bridge views remains within the measured budget.

Run `npm run typecheck`, `npm run lint` and the relevant focused tests while
iterating, then `npm test` before commit/merge as required by `AGENTS.md`.

Do not hand the pattern to another map until every gate passes.
