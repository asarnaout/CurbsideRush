# Grade-separated road implementation guide

This is the mandatory entry point for every drivable bridge, viaduct, flyover,
interchange and ramp. It is map-agnostic: Cairo supplied the regression history,
but its coordinates, traffic side, dimensions and visual style are not a template.

Read all three companion chapters before editing a city:

| Chapter | Owns |
|---|---|
| [Authoring and structure](grade-separated-road-authoring.md) | access topology, curves, profiles, junction collars, decks, barriers, water portals and city preservation |
| [Runtime and performance](grade-separated-road-runtime.md) | level ownership, projection, collisions, headroom, actors, signs, cutscenes, maps and performance invariants |
| [Verification and handoff](grade-separated-road-verification.md) | test matrix, production-collider sweeps, live QA and acceptance drives |

Also read [map-authoring.md](map-authoring.md) for the road schema and
[rendering.md](rendering.md) for scene-level performance rules. The map-specific
alignment and preservation records are
[cairo-elevated-road-network.md](cairo-elevated-road-network.md) and
[tokyo-elevated-road-network.md](tokyo-elevated-road-network.md); consult them as
worked examples, never as the generic specification.

## The contract

1. A road user's location is `(x, z, elevation)`. Every system that reasons
   about road proximity must preserve the level.
2. The legal lane centreline and its matching `RoadSurface.centerline` own one
   identical elevation profile. Asphalt, paint, structure, collision, actors,
   cameras and both maps derive from it; no decorative bridge has a second curve.
3. Entry and exit slips use the **nearside/traffic-side kerb for their legal
   direction**: physical right in a right-hand-traffic map and physical left in
   a left-hand-traffic map. Derive this from `trafficSide`; do not hard-code
   world left/right or Cairo's right-side convention.
4. The host street remains continuous through a ramp mouth. A slip is an
   auxiliary lane that diverges from or tapers into the nearside through lane;
   it never replaces the street or crosses its opposing lane.
5. Roads that cross in plan at different heights use distinct graph nodes. Only
   a real ramp, same-level merge or junction grants a connection.
6. Ramps are smooth, driveable curves, not chains of sharp chords. One sampled
   curve supplies lanes, surfaces, markings, slabs, barriers and maps.
7. Independently authored elevated arms meet through one shared profiled
   junction envelope. Asphalt, slab, guard runs, headroom and barrier colliders
   consume that same envelope.
8. Every visible gameplay solid is physical and every physical solid is
   explainable by visible geometry. Parapets have no gaps at the deck, merges
   have no hidden transverse caps, and no approximation creates an invisible
   wall above or below the road.
9. Clearance is a 3D swept envelope, never a centreline or anchor-point check.
   It includes the largest playable vehicle, the complete legal lane width,
   pitched asphalt, slab/soffit, barrier toe, piers and the full footprint and
   height of every building, sign, lamp, signal, gantry, tree and parked object.
10. High spans deliberately preserve usable streets and pavements below; low
    grades exclude actors and objects that do not fit. A blanket 2D bridge
    footprint collider is forbidden.
11. Route around the city before moving assets. If a reviewed move is
    unavoidable, preserve identities and unaffected neighbours, record it
    explicitly and pin both asset count and clearance. Deletion is not bridge
    authoring.
12. Correctness and performance are both acceptance gates. New maps extend the
    shared invariant tests, add map-specific geometry tests, preserve exact
    projection/render equivalence and establish measured budgets before copyout.

## Ownership map

| Concern | Authoritative implementation |
|---|---|
| Road/lane schema and city alignment | `sessionContract.ts`, `cities/<city>.ts` |
| Level thresholds and contact bands | `simulation/roadLevels.ts`, re-exported by `roadElevation.ts` |
| Projection, height hysteresis and endpoint choice | `simulation/roadNetwork.ts` |
| Player level ownership and pose authority | `simulation.ts` |
| NPC height, avoidance, conflicts and contacts | `simulation/trafficSystem.ts` |
| Span, edge, deck, barrier, pier and headroom geometry | `geometry/elevatedRoadGeometry.ts` |
| Shared profiled merge/fork collars | `geometry/elevatedRoadJunctions.ts` |
| Rendered structure and spatial batching | `render/elevatedRoadLayer.ts` |
| Barrier/support obstacle registration and response | `simulationAdapter.ts`, `simulation/playerDynamics.ts` |
| Walkers, parked cars and roadside/park props | `crowdWalkers.ts`, `parkedCars.ts`, `render/roadsideProps.ts` |
| Regulatory signs and road-id seams | `regulatorySigns.ts` plus optional city presentation curation |
| Traffic controls and destructibles | `render/babylonGameSession.ts`, `render/destructibles.ts` |
| Stops and staged cameras | `cutsceneScript.ts`, `render/cutsceneDirector.ts` |
| Level-aware maps | `minimapDraw.ts`, `MinimapCanvas.tsx`, `ExpandedMap.tsx` |
| At-grade shoreline openings | `bridgePortalGeometry.ts`, water-body portal obstacle generation |

A city file owns alignments, profiles, legal successors, access inventory and
visual references. Shared modules own what elevation, clearance, collision and
render batching mean. Fix a cross-map rule in the shared layer rather than
forking it behind a city-id condition.

## Required implementation order

1. Research the real corridor and inventory every access site as separate legal
   entry and exit movements. Record traffic side, lane count, host direction,
   intended level, water crossings and terminal transitions.
2. Add failing topology and geometry tests for that inventory, host continuity,
   nearside placement, curvature, grade, handoff angle and obstructions.
3. Author lanes and matching surfaces. Split stacked nodes, keep ground slips
   flat and open, and introduce high carriers/braids where low approaches cannot
   coexist safely.
4. Resolve curves and elevation profiles once. Do not decorate yet.
5. Generate junction envelopes, asphalt, slabs, edge runs, solid crash barriers,
   supports and colliders from the resolved geometry. Prove every legal vehicle
   envelope before adding railings, lamps or signs.
6. Audit the production building plan, roads, pavements, water banks, controls,
   props and actor occupancy. Adjust alignment first; curate only exact reviewed
   conflicts after deterministic relocation has failed.
7. Verify player/NPC level ownership, physical contacts, roof/soffit response,
   enforcement, interactions, cutscenes and map presentation.
8. Preserve the geometry while batching render pieces and bounding hot road and
   clearance queries. Run equivalence and measured budget tests.
9. Complete all automated sweeps and every in-game acceptance route in the
   largest vehicle and both camera modes.

Do not copy or extend the network while any earlier stage is failing. Scenery
can hide a topology or collider defect long enough to make it much harder to
diagnose.

## Common failed shortcuts

- Attaching a two-way ramp to a host centreline or signalized intersection.
- Treating “driver's right” as universal instead of deriving the nearside from
  the map's traffic side.
- Raising the host street while rendering a fictional continuation underneath.
- Sharing a graph node merely because two levels have the same `x/z`.
- Sampling separate curves for the lane, road, slab and barrier.
- Beginning ascent, a turn or parapets before a full vehicle clears the mouth.
- Letting constant-width slab strips overlap at a fork instead of building one
  profiled collar.
- Using an open decorative rail as the crash barrier, floating a barrier above
  the deck, or hiding a solid terminal cap beneath asphalt.
- Registering a whole deck footprint as a ground collider or exempting an
  entire connected route from roof collision.
- Checking prop anchors while their poles, arms, crowns or signs pierce another
  deck; checking block rectangles while the chosen building asset still clips.
- Deleting buildings, required controls or streetscape to make the alignment
  pass; silently dropping nonessential furniture without a relocation attempt.
- Accepting a clear lane centreline, one small-car drive or screenshots in place
  of full production-collider and vehicle-envelope sweeps.
- Simplifying geometry or changing hot-path selection semantics to hit a
  performance target. Optimize with exact-equivalence tests.

## Current implementation floors, not design standards

These values explain existing helpers and tests. A future map may need gentler
curves, grades and transitions; it must not weaken a floor just to fit a poor
alignment.

| Existing value | Meaning |
|---|---|
| `0.65 m` | visible structural-deck start; raised asphalt exists before it |
| `0.175 m` | hidden slab lap beneath a connected paved mouth |
| `8 m` | maximum barrier-collider chunk length on a grade |
| `7.5 m`, `5°` | shipped Cairo/Tokyo curve-sampler chord and heading-step caps |
| `14 m`, `10.5%`, `22°` | shipped Cairo/Tokyo regression floors for radius, grade and legal handoff |
| `32 m` | exact clearance-query broadphase cell |
| `45 m` | bridge static/mirror render-batch cell |
| `2 m`, `0.5 m` | maximum all-lane and detailed bridge-envelope audit spacing |

Passing these numbers does not prove a plausible bridge. The complete
[verification chapter](grade-separated-road-verification.md) is the definition
of done.
