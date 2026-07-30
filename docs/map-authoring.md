# Authoring map content

Read this before editing `content.ts`, `londonContent.ts` or `cairoContent.ts`,
before adding a city, and before changing a road's width, speed limit or shape.

There is **no generic procedural city generator and no runtime map import**.
`getMapPack(id)` is a pure frozen lookup that throws on unknown ids.

## Two parallel truths that must stay in sync

Every pack carries two structures:

- **`laneGraph.lanes`** — directed *legal* truth. What the simulation, guidance,
  NPCs and scoring use.
- **`geometry.roadSurfaces`** — *visual* truth. Centrelines + markings.

Linked only by `LaneSegment.roadId` ↔ `RoadSurface.id`/`laneIds`. Two-way streets
mirror one directed lane onto each side of the surface centreline.

Also authored: `RoadSurface.sidewalkWidthM` overrides the map default per road;
`ProceduralBlock.headingDeg` rotates its façade slots, exclusions and OBB
collider together; each `WaterBody` is a visual polygon whose shoreline opens
only for its explicit `bridgePortalSurfaceIds`, with paired physical parapets
derived over those spans.

## Everything else is derived at load time

| Derived | From | Where |
|---|---|---|
| asphalt strips, kerb/junction fills | `roadSurfaces` | `buildRoadSurfaceStripGeometry`, `collectRoadJunctionFills` |
| paint broken at junctions | `roadSurfaces` | `splitMarkingAtCrossings` |
| walkable pavement rails | `roadSurfaces` | `buildPavementGraph` |
| ambient traffic routes | `lanes.successors` | `buildConnectedNpcPath` |
| gig drop-off addresses | `lanes` + `blocks` | `generateStreetAddresses` |
| instanced building street wall | `blocks.buildingSet` | `slotBlockBuildings` |
| signal phase clock | `controls.phaseGroup` | `authoredSignalAspectAt` |
| one-way + speed-limit signage | `lanes` (+ `speedLimit`) | `regulatorySigns.ts` |
| enforcement cameras | `controls` of `type: "signal"` | `trafficCameraControlIds` |

**A third of every map's signals carry an enforcement camera**
(`TRAFFIC_CAMERA_RATE`, the one knob — a new map wants a third too). Ranked by
salted FNV-1a hash and **cut at the count**, never authored, so a new city gets
them for free and needs no content edit. A threshold draw would give only *about*
a third — fine on NYC's 65 signals, zero on London's 2. Ties break on
`localeCompare`, so reordering a map's controls cannot shift the draw, and a
`max(1)` floor guarantees a signalled city has at least one camera to find.

**One `TrafficControlApproach` is one arm — one direction of travel — not one
road.** Where a signal sits mid-road both directions of a two-way street
terminate at that node, and grouping them by `roadId` gives the pair a single
stop line anchored on one direction's lane and a single head facing the other
way: the opposing driver is then enforced against a signal that was never built
for them, silently. Group by the node each lane arrives *from* (Cairo) or by
approach heading (NYC). Keep `phaseGroup` keyed by road, though — opposing arms
of one street must still run together, or splitting the approaches also splits
the cycle.

**A kerbside head belongs beside its own stop line**, roughly a metre before
the bar and a metre past the kerb face, on the traffic side. Cairo originally
searched for the position that maximised distance from every lane, which is not
the same objective at all: straying cost 0.01 m of score per metre, so the
widest, furthest-back corner of the grid always won and every head stood 13–24 m
out on open ground, most of them across the carriageway. Clearance is a **veto**
on that ideal spot, never the thing being maximised.

**Signage is derived, controls are authored, so the post is what moves.**
`RegulatorySignInput.occupiedPositions` carries every authored pole; a
speed-limit sign that would land within `LIMIT_FURNITURE_CLEARANCE_M` of one
slides further down its own kerb instead. It slides rather than drops because
dropping can silence a corridor whose only sign collided, which is exactly what
the repeater floor exists to prevent. Omit the field and posts stand bolted to
signal poles — nothing else reads it, and nothing warns.

## The shipped cities

| Map | Lanes | Roads | Lane km | Signals | Cameras | World (x × z m) |
|---|---|---|---|---|---|---|
| `nyc-upper-west-side` | 227 | 19 | 47.4 | 65 | 22 | 1080 × 3000 |
| `cairo-central-nile` | 224 | 27 | 44.8 | 10 | 3 | 1770 × 1830 |
| `tokyo-setagaya` | 56 | 20 | 5.5 | 0 | 0 | 600 × 420 |
| `london-south-kensington` | 40 | 13 | 4.7 | 2 | 1 | 800 × 540 |
| `milton-keynes-oldbrook` | 21 | 10 | 3.9 | 0 | 0 | 1500 × 300 |
| `calais-coquelles` | 20 | 10 | 2.2 | 0 | 0 | 680 × 300 |

### NYC is declared as a grid, not written lane by lane

`NYC_AVENUES` / `NYC_STREETS` state each road's coordinate, width, one-way
direction, lanes per direction and crossings reached. `buildNycGrid` derives the
lanes, offsets, successors, surfaces and a signal at every crossing fed by two
roads; `buildNycBlocks` derives the blocks — zoned by column and latitude, so
inserting a street splits a cell without changing what stands on either half.

Hence **lane ids name the crossing each block starts at** (`nyc-we-n-72`):
numbering *spans* would rename every lane on a road the moment one crosses it.
And `roadIdForLane` has **no NYC branches** — the generator passes each road id.

### Cairo is the non-grid equivalent

`CAIRO_ROAD_SPECS` plus the turn whitelist in `CAIRO_JUNCTION_CONNECTORS`.
`tests/cairoContent.test.ts` pins its winding/radial headings, lane counts,
kilometre bands, graph connectivity and stable ordering.

Its shallow roadside parcels are generated only *after* POIs exist, must clear
roads, water, bounds, landmarks, POIs, existing blocks and the Sixth October
corridor, and deliberately leave four Nile-facing sides open.

## Every road posts a speed limit

Declared once per road — on its `NycRoadSpec` for the grid, in a per-city
`*_ROAD_SPEED_LIMITS` table elsewhere — which `lane`/`laneTrue` **stamp onto that
road's lanes** rather than taking as a parameter, so a street cannot disagree
with itself. An unposted road throws on import.

The figure is the one on the sign, in the country's own `speedUnit`, never a
canonical unit. Choose it from:

1. **Frontage** — housing, park, school, shared space lower it.
2. **Class** — arterial > through street > local > mews/service/roundabout.
3. **Geometry** — width, lane count, curvature, junction density.

…and never a number that country does not sign.

NPCs cruise at 68–92% of the limit, drawn once at spawn and re-applied at every
road change, so **the limits are what actually paces traffic** — raising one
speeds up the city and is the one content edit that can move
`trafficSafetyAcceptance`.

**London's flat 20 is researched, not lazy**: RBKC is 20 borough-wide, and TfL's
2023 order took the A4 through it down too. Both are cited in
`LONDON_RULE_REFERENCES` *and shown to the player*, so raising it would put the
map at odds with the game's own sources.

`roadRealism.test.ts` holds the rest: only figures that country signs, one figure
per road, and nothing non-`standard` out-ranking an ordinary road.

## Two authoring tolerances that fail silently

- **`0.08 m` is the definition of "shared node"** for junction fills
  (`ROAD_POINT_EPSILON_M`), pavement rails (`DEFAULT_NODE_EPSILON_M`) *and* both
  sign families (`NODE_EPSILON_M`). A shared endpoint authored 0.1 m apart yields
  no junction fill (grass through the crossing), no pavement trim (walkers on the
  asphalt) and no signage at that mouth.
- **Successors must be geometrically continuous** — tests require 0.01 m;
  `buildConnectedNpcPath` requires 2.5 m. Break it and traffic *despawns* rather
  than errors. An **empty** successor list does the same thing, wherever the
  player happens to be looking: London's bus lane dead-ended at a signal and the
  double-decker blinked out every green (#128).

Both are now guarded by "gives every lane somewhere legal to go" in
`content.test.ts`.

## Addresses

**`streetAddressesForMap` caches by `pack.id`** in a module-level Map; gig
selection, the renderer and tests must all agree, so mutating a pack after the
first call has no effect.

Street addresses only exist for the NYC roads listed in `STREET_PROFILES` — a NYC
road missing from it generates none, silently, which is what
`addressableStreetNames` exists for the test to catch. Other maps fall back to
authored venues.

**`STREET_PROFILES` holds numbering and is the addressability gate; display names
live on `MapPack.roadNames`.** Deliberately split, so naming a street for GPS
guidance cannot start issuing gigs on it, and so whole named cities (London,
Tokyo, Cairo) stay address-free. Gating on the names instead would opt every
named city in at once.

## Service points and venues

**`ServicePoint.kind` is two kinds** (`gas_station`, `repair_shop`), and most
machinery wants both — the block carve that keeps a lot drivable, the prop-scatter
and address keep-outs. The gas-specific readers go through `gasStationsOf`, never
an inline `kind ===`, or the pump maths invents four pumps on a garage forecourt.

`servicePoints.ts` cannot import the model registry (Babylon), so
`SERVICE_MODEL_FRAME` restates each kind's scale and yaw and `modelLibrary.test.ts`
pins the two together — a copy that drifted would rotate every collider on the lot
while the building looked right.

The repair shop is the one service **authored rather than imported**
(`repairShopLayout.ts`: no free low-poly auto shop has a drivable bay), which is
why its colliders come off the same constants that draw it instead of being
measured off a glb like `GAS_STATION_SOLIDS_M`.

**The setback normal is always the driver's right regardless of traffic side.**
On left-hand-traffic maps that lands on the far side of the road — which is why
MK/London gas stations are anchored on far-side lanes and Tokyo's needs
`setbackM: 17.3`.

## Private authoring helpers are duplicated per city

`content.ts` and `londonContent.ts` each carry their own `point`, `node`,
`laneTrue`, `arcPoints`, `turningLoop`, `connectorConflictZones`; Cairo has a
separate road-spec generator. **Fixing one does not fix the others.**

## The frozen OSM data is provenance only

The JSON in `public/map-data/` — see its own
[README](../public/map-data/README.md) — is never read at runtime.
`scripts/fetch-osm.mjs` is a manually-run, one-off freezer, not part of any build.

`tests/map-data.test.ts` recomputes a sha256 over
`JSON.stringify({roads, buildings})`, so **reformatting or reordering keys breaks
the checksum even when the geometry is identical**. Regenerate; never hand-edit.
