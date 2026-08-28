# The rendering layer

`GameCanvas.tsx` + `render/babylonGameSession.ts` and the Babylon scene. The 2D drive HUD is a separate concern — see [drive-hud.md](drive-hud.md).

## Shape of the file

`GameCanvas.tsx` is the thin React half of the god-file decomposition
(`.claude/refactor-plan.md`, gitignored): props, shell/canvas styles, and the
component lifecycle, nothing Babylon-owning of its own. The exported
`class BabylonGameSession` lives in `render/babylonGameSession.ts` instead.
`AdaptiveInputRouter` lives in `adaptiveInputRouter.ts`;
the pure geometry/render layer sits in `geometry/` (zero `@babylonjs`, enforced
by the flat ESLint config) and `render/` (Babylon-owning, no session state), both
exported for Babylon-free tests; contract types are in `sessionContract.ts`. **React owns the canvas
element, the props, and one 10 Hz HUD snapshot; the session owns everything
else, and no React state is driven at frame rate.**

The session is rebuilt only on `[trafficSide, steeringSide, scenario.id, mapPack.id]`;
every other prop flows through `session.updateOptions(...)`. Not orientation —
rotating a phone pauses the drive, it does not rebuild the city.

## Grade-separated roads render from simulation geometry

An elevated road is never a scenic mesh with separate gameplay beneath it.
The renderer consumes the same `RoadSurface.centerline` elevation profile as
the legal lane graph. `geometry/elevatedRoadGeometry.ts` derives pitched asphalt
structure placements, full-width watertight deck runs, independently trimmed
edge runs, piers, local-height barrier OBB placements and a prepared soffit
query from that profile. Connected slabs overlap 0.175 m beneath the paved
mouth; only parapet/fascia runs open around the legal carriageway. See
[grade-separated-road-implementation-guide.md](grade-separated-road-implementation-guide.md)
for the full simulation/authoring contract and
[cairo-elevated-road-network.md](cairo-elevated-road-network.md) for the Cairo
reference implementation.

Three render-side rules are load-bearing:

- visible parapets and simulation barriers share the trimmed edge runs; merge
  openings cannot be trimmed from only one representation;
- the soffit query is called with each object's real height and footprint before
  signals, parked cars, roadside props or either park-planting queue is built;
  a global tallest-prop envelope would erase valid low furniture;
- pier placement clears the full local pavement envelope and lower-deck
  overhang with the rendered footing radius, not merely the other road's
  centreline or carriageway;
- any destructible registration carries its elevation, and its pivot, fall,
  light pool and impact particles remain relative to that level.

The detailed bridge skin is authored at full fidelity and then world-baked into
spatial batches keyed by material, role, vertex layout, side orientation and
`receiveShadows`. Freeze-only and mirror/static pieces use the session's 45 m
grid. Shadow casters deliberately merge only at an **identical original x/z
registration point**: averaging a whole cell changes the exact 90 m radial
shadow predicate and can make ramp shadows pop at the cutoff. Source transforms,
vertices, indices, materials and the separate freeze-only/static/shadow roles
are preserved. Cairo therefore keeps all 665,906 vertices and 325,356 triangles
while replacing 13,566 meshes with 5,349 batches (a 60.6% reduction), including
7,284 shadow meshes/registrations reduced to 5,007. At the Dokki ramp the live
shadow units fall from 1,029 to 609 with the same 36,904 submitted source
triangles. Tests compare world-space geometry grouped by the exact shadow
registration point, not merely cell coverage.

The renderer also passes the map pack's stable road-surface array through the
shared junction-envelope cache and hands its already-resolved edge runs to the
deck resolver. Do not replace that stable key with a freshly filtered array or
recompute the same edge plan per slab; neither result changes during a session.

Player and NPC nodes interpolate elevation with x/z and heading. A discontinuous
height reassignment participates in teleport/snap detection, so unchanged x/z
cannot blend a vehicle vertically through a slab. Traffic-stop
cars and walking actors sample the selected road profile at their own positions
rather than sharing one constant Y; the actor's foot offset is kept separate
from road elevation. The staged camera tests its own ring position, all scene
marks and sampled camera-to-subject sightlines against the shared soffit query,
chooses a clear azimuth and ducks below the lowest usable deck. Elevated
traffic-control hardware adds its installation height, while marking segments
pitch between their endpoint heights. The minimap and expanded map derive their
active ground/elevated stroke from the player's road height, draw the occupied
level strongly and retain the other level as a translucent context layer. The
corner minimap pre-rasterises both exact road-level sheets when the map/size
changes; crossing the 3.5 m level threshold switches cached canvases and never
rebuilds the whole Cairo network during a ramp transition.

## Every building is planned once, before `buildScenarioEnvironment` runs

Two seeding mechanisms coexist: `seededUnit` (`visuals.ts`) is a stateful
*stream* whose call order is part of its output; `hashStringToSeed` is a
*pure* per-string hash every other seeded choice uses instead,
order-independent by construction. `geometry/buildingLayout.ts`'s
`planMapBuildings(mapPack, trafficSeed)` is the **only** permitted consumer
of the map's `seededUnit` stream for buildings, called once in the
`BabylonGameSession` constructor — before `buildScenarioEnvironment`, before
any Babylon object exists. Reordering its internal draws (width, depth, then
conditionally height, per authored block, direct-procedural blocks before
deferred zero-survivor-fallback ones) would re-roll every procedural
building's dimensions. `tests/facadeGridDrawOrderCharacterization.test.tsx`
gates that sequence by fingerprinting per-mesh output, not raw values.

`ProceduralFacades` and `BuildingLayer` only render what the plan already
decided — neither draws randomness. An asset-slot entry whose glb is forced
unavailable, low-spec-thinned, or fails to load gets an exact per-solid
opaque proxy box instead (one box per `StructuralObb`), never a whole-block
re-derivation and never a hole. `render/buildingRepresentation.ts`'s registry
records what stands for every planned entry (`glb`/`proxy`/`planned-box`),
queryable via `window.__sideswapBuildingRepresentationDebug()`.

## Fog is the draw-distance budget

A map's fog range comes from its world size; the camera's far plane rides the
band (`resolveCameraFarPlane`), so raising fog raises draw distance with it. It
is the cheapest lever in the renderer, and there are two ways to pull it:

- **`night`** clamps the band to 100/440 m. Every shipped city sets it, so 440 m
  is the real draw radius of the game.
- **`fogEndCapM`** is a palette's own ceiling, applied first. Both surviving
  caps (Cairo 650 m, London 800 m) now sit above night's clamp and change
  nothing a player sees. They are kept because `auditMapVisualGaps` passes
  `night: false` deliberately — a city being dark must never make its own
  sightline audit lenient — so retiring them would silently widen that audit.

Measured on London before it went night, capping the day range took **412 draw
calls to 171** and active meshes from 984 to 569 with no change to what the map
contains; Cairo's cap was −31% draw calls/frame against the uncapped 1100 m.
Night's tighter clamp is why both cities absorbed a thousand new streetlights
each and still came out with *fewer* active meshes at the same pose (London
878 → 500, Cairo 1_621 → 1_314; `fourCityRenderCharacterization`).

## Every city is a night city, and a night city needs a lamp line

`night` on a `MapVisualPalette` is one flag that turns on a whole rig —
moonlit hemi/sun (per-palette `nightHemiIntensity`/`nightSunIntensity`), a
lower bloom threshold with more weight, lifted exposure, `BuildingLayer`'s
window glow, the water's night tiles, emissive lamp heads and their ground
pools. All four cities set it. **None of that lights the street.** The rig is
moonlight; what makes a map drivable is the scattered `streetlight` line in
`roadsidePropKindsForMap`, and three things about it are load-bearing:

- **`curbOffsetM` (0.7 m) is not a detail — it is the difference between a lit
  city and a dark one.** The default lateral band seats a prop a metre *beyond*
  the pavement, which on a real street wall is inside a ground floor, so
  `blocks.some(isInside…)` rejects it. At the same 26 m spacing London measures
  264 lamps on the default band against 1_076 kerb-seated; Cairo 521 against
  1_005.
- **A kerb-seated candidate skips the open-water test and `roadCrossedRects`,
  and nothing else.** Its kerb exists wherever its road does — over a river,
  through a park. Skipping only water left London's 749 m Serpentine Road unlit
  inside the royal park's 902×631 m rect, and (before that) every Sakuragawa
  bridge. But the tempting generalisation — *"any rect overlapping a
  carriageway must be illustrative, so skip `landmarks` wholesale"* — is FALSE
  and ships lamps between rails: `buildRoadsideProps` packs authored landmarks,
  `railCorridorExclusionRects` and the service/venue keep-outs into one array,
  and a rail right-of-way crosses roads *by construction* at every level
  crossing. Only rects the call site positively identifies as road-crossed
  (parks) go in `roadCrossedRects`; everything else stays hard.
- **One pass, never two.** `alternateSides` gives left-gap-right-gap only
  within a single walk; a second appended streetlight pass carries its own side
  toggle and phase and their union reads as same-side and face-to-face pairs.
  Density changes go in `spacingM` (24 m Tokyo, 26 m London/Cairo, 38 m NYC on
  the wider default band).

Both halves are measurable without a browser, by running the real content
modules in plain Node:

- **Coverage.** Attribute each lamp to its **nearest** road — projecting onto
  every road within a width tolerance instead counts a crossing road's corner
  lamps and invents same-side pairs — and report each road's longest lampless
  run. The bar London, Tokyo and Cairo hold is no road over ~120 m.
- **Intrusion.** Test every emitted placement against every keep-out rect
  (rail corridors, service/venue lots, landmarks). The expected answer is
  zero, on all four maps — which is what turns "a light post in the middle of
  the railroad" from a thing the owner has to spot from the car into a number.
  Run it on a worktree at the last good commit too: that is what separates a
  regression from a pre-existing defect (it found one — a promenade palm on a
  Cairo forecourt, since `generatePromenadeDecor` had no `keepOutRects`).

## London's landmarks share one material trio

Every landmark in `render/londonLandmarks.ts` uses the same pale trim, dark
glazing and dark roof, cached by `landmarkPalette` per `Scene` — **not** in a
module-level `let`: a session rebuild gets a fresh scene, and the second mount
would otherwise draw with the first's disposed materials.

## Three angle conventions coexist

| Thing | Convention |
|---|---|
| World | `x` east, `z` north, `y` up, metres, origin = map centre |
| Lane/pose heading | `atan2(dx, dz)` — **0 = +z (north)**, +π/2 = +x |
| Right-hand normal | `(cos h, -sin h)` — the **driver's right** |

## The y-layer stack is a hard global ordering

Every value is tuned to kill z-fighting, and they are spread across three modules
(`render/babylonGameSession.ts`, `crowdRenderer.ts`, `vehicleMeshes.ts`, plus
water's own default in `geometry/waterGeometry.ts`):

```
0.02 park lawn  <  0.025 water  <  0.0255 park beds  <  0.031 park paths/terraces
<  0.04 rail ballast  <  0.0435 shoulder junction fill  <  0.045 shoulder/sidewalk
<  0.050-0.056 roadside lawn edge aprons  <  0.07 road surface
<  0.0716 asphalt junction fill  <  0.08 walkers/building bases
<  0.1 crowd shadows  <  0.12 markings & vehicle nodes  <  0.144-0.147 chevrons/stop lines
```

Roadside `lawnEdgeLaps` add their apron grids to the lawn's existing mesh and
draw call. An x-normal apron starts at 0.050 and a z-normal one at 0.052, so
perpendicular ribbons can cross at a corner without a coplanar fight;
`depthLayer` supplies further 4 mm sub-rungs for same-axis bends. The authored
lawn remains at 0.02, including its paths and beds. Only the two narrow edge
bands rise: the road band wins over the 0.045 target sidewalk, making grass
visibly meet the asphalt curb, while the building band disappears below the
0.08 foundation. `parkLawnEdgeLapGeometry` cuts foreign pavement and all
shoulder-junction fills out before triangulation; the 0.07 carriageway masks the
road band's outer edge. Pin path-free `lawn` styling only where a derived path
would terminate at a raised transverse band.

Rail ballast (`RAIL_BALLAST_Y`) deliberately loses to the shoulder and the
carriageway, so a level crossing's asphalt paves OVER the corridor; the rails
are 3D boxes riding above the rung and stay visible across the road.
`render/railLayer.ts` builds all of it (segmented ballast, miter-offset rails,
instanced sleepers, girder bridges, brick viaducts whose piers dodge
carriageways, terminus platforms or a depot shed per `terminus.style`) from
`geometry.railLines`, offset wholesale by the line's `elevationM`;
`render/trainRender.ts` runs the procedural consist on the NPC pose-pair
interpolation pattern, with poses from the same `simulation/railSchedule.ts`
the crossings time against. `offsetPolyline` must never apply its corner
mitre at a polyline's endpoints — the degenerate end direction maxes the
clamp and wedges every straight offset run (this shipped once: girders and
platforms flared 2.5x at each run's first vertex). Corniche parapet runs
split around each rail polyline at `RAIL_BRIDGE_MOUTH_CLEAR_M` — the same
clearance the adapter opens the shoreline COLLIDER with, because at-grade
bridge spans are drivable and the wall face must end exactly where the
solid does. `generatePromenadeDecor` takes the rail lines as a keep-out —
bank furniture must not stand in the corridor where a line pierces the
shore.

Vehicle ground contact is a **two-value handshake**: nodes at `y = 0.12` and
`LOCAL_GROUND_Y = -0.05` put tyres at exactly `0.07`. Change either alone and the
whole fleet floats or sinks. Lawn sitting at the bottom of the stack is also
usable: a park rect may run out under a pavement or a carriageway, which is how
an island lawn meets its kerbs with no fringe (docs/greenery.md).

**Water is the one layer above lawn you cannot trim a park under.** A shore
authored inside a park's rect hides the outer strip of that lawn — but nothing
else moves with it, so the park's own wall stays out where the rect edge is and
ends up standing in the river (docs/greenery.md).

**A junction outline tapers a width change, it does not step it.** In
`collectRoadJunctionFills`, two legs pointing away from each other are one road
running *through* the node rather than a corner. An unequal-width pair holds
the boundary to the WIDER leg's kerb at the node and tapers one-sidedly across
the narrow leg's reach (Kensington Road's 7.2 m into Knightsbridge's 10.4 m
resolves over ~9 m); equal widths bridge tip to tip. Chamfering to the node
instead jumps the whole step over centimetres, which play-tested as the
sidewalk "suddenly breaking".

**Junction fills ADOPT off-node road ends.** An open tip whose own cluster is
not a junction joins the nearest real junction within summed half-widths, with
a per-leg `origin` keeping the kerb math exact — the mirror of
`buildPavementGraph`'s adoption pass, and the fix for Cromwell Road's
deliberately lane-stack-centred dual carriageway, whose two junction mouths
were otherwise traced without the 11.4 m road present. A four-map pin in
`tests/roadJunctions.test.ts` asserts Cromwell's two arms stay the only
adopted ones.

QA hooks: `__sideswapTeleport({x, z, heading, elevationM?})` (radians) poses the car
through `SimulationCore.setPlayerPose` — the cutscene's replay-invisible entry
point — and snaps the chase camera, which is what lets a headless sweep
screenshot every road in one session (`installDebugHooks`). Supply an explicit
`elevationM: 0` or bridge height at stacked roads so a QA pose selects the
intended level deterministically.

For bridge QA, pair that teleport with `__sideswapCollisionOverlay(true)` and
`__sideswapCollisionDebug()` to compare visible parapets with nearby obstacle
OBBs and their elevation bands. `__sideswapEnforcementDebug()` exposes the live
patrol/camera witness decision, while `__sideswapCutsceneDebug().active` reports
the staged actor and patrol Y values during a pull-over. Repeat each stacked
location at ground and deck height; the x/z position alone is intentionally not
enough to choose or test a level.

`__sideswapVisualGapReport(options?)` runs the plan's own visual-gap audit
(`geometry/visualGapCoverage.ts`) against this session's real map/plan, live:
no args is the fast raster/blob census only; `{fan: true}` (optionally
`{roadIds: [...]}`, `{fullMatrix: true}`) runs the real camera-fan sweep —
see `docs/testing.md`'s CLI section for what each mode costs, since this hook
pays the identical price. `collectMapVisualGeometry`/`buildGroundRaster` are
cached on the session after their first call (`visualGapGeometryCache`) —
both are pure functions of `buildingLayout`/`mapPack` for a session's whole
lifetime, so recomputing them on every call would make repeated interactive
queries (and a full-matrix sweep right after a fast census) pay for the same
whole-map collection twice for no reason. The audit reads `buildingLayout`
directly (the planned structural solids), not whatever glb/proxy actually got
drawn — the same exact-proxy-box guarantee above means it audits identically
regardless of low-spec thinning or a forced/failed glb load.
`__sideswapVisualGapOverlay(failureId | null)` draws or clears one
`VisualGapReportRecord`'s eye marker, ray, blob outline, and nearest-
opaque/crossed-owner outlines (`render/visualGapDebugOverlay.ts`) by looking
the id up in the last report's `records` — `null` clears it, and a call
before any `fan`-mode report has run is a no-op, not a throw. Both hooks and
the overlay mesh are torn down in `dispose()`.

The stack cannot save geometry that fights *inside* one model: the Cairo kit's
millimetre-proud decal primitives are pulled forward by
`biasCairoDecalMaterials` (`CAIRO_DECAL_MATERIAL_NAMES`, per `cairo-*.glb`
container only). Prefer polygon offset over nudging vertices for
decal-on-wall fixes, and treat camera `minZ` as a depth-precision budget
(precision varies as `minZ/z²`; the chase camera's 0.5 keeps millimetre
offsets resolvable — don't lower it to "fix" near clipping).

## Cairo's night identity: no wall may be painted with light

**Nothing in Cairo gets a wall-wide warm treatment — no emissive, no tint, no
uplight gradient.** Four owner rejections bought this rule, each a different
mechanism producing one complaint ("flat orange", then "sandy shade… I
absolutely hate it"): the albedo-glow fallback, a flat constant emissive on
the whole kit, a height-pooled `MaterialPluginBase` floodlight with a
compensating albedo mute, and — the one that survived all three fixes because
it was not in the renderer at all — a **sand hue baked into the assets**, both
the eleven `cairo-*` `ProceduralFacades.BUILDING_PALETTE` entries and the
imported glbs themselves (`tools/style-cairo-residences.mjs` remapped the
KayKit colour atlas into a sand band and assigned the Quaternius blocks
literal sand walls).

The load-bearing lesson: **a warm wash is a HUE problem, not a brightness
problem.** Dimming every warm surface was tried and failed — London's palette
entries are just as bright and read fine at night. What fixes it is hue
spread: the Cairo families are now neutral limestones/concretes, dusty
off-whites, sage and red-leaning rose/terracotta. Nothing yellow-dominant
(R≈G≫B) may enter that palette; that ratio *is* the sandy signature.

So the kit is treated exactly like every other city's: real albedo under the
scene rig, lit panes from `applyNightGlow`, no Cairo branch. The baladi
districts' boxes still take `makeBaladiFacadeTextures` (brick or bare render
inside an exposed concrete skeleton, smaller shuttered windows, a sparse
warm/fluorescent night mix) — the one Cairo-specific facade family left, and
it survives because it paints *material*, not light. Cairo's night character
is carried by what is genuinely lit: the densest lamp set of the four, lit
windows, shopfronts, the mosque's floodlighting, and the Corniche towers'
Arabic neon rooftop signs (`addCornicheCrown`; the Arabic canvas font is
awaited before any Cairo session constructs, so the signs rasterise with the
real face). The rig (`nightHemiIntensity`/`nightSunIntensity`/`sunTint`/
`fogColor` in visuals.ts) was pulled down alongside the palette, fog included
— fog tints every wall past ~60 m, so an amber fog re-creates the wash in the
middle distance no matter what the near walls do. Retune palette, rig and fog
together against wall screenshots, never one alone.

### Cairo advertising is a campaign layer, not roadside scatter

For the reusable cross-map recipe—including content policy, atlas handling,
gap search, complete-installation collision checks and the porting test matrix—
read [city-advertising-playbook.md](city-advertising-playbook.md).

`cairoAdPlacements` covers 27 surface corridors—including both Nile bridges—
rather than a spawn-centred subset. Its 635 pole stations sit inside their source pavement
band, face approaching traffic, and reject the complete pavement envelope of
every crossing road plus the rail reservation; a valid kerb offset on one road
is not enough, because that same point can be the centre of another road at a
junction. Large roadside boards are resolved against the session's exact
`BuildingLayoutPlan`, not coarse authored block parcels: each nominal station
searches in deterministic five-metre steps for a genuine gap between rendered
buildings, tries the opposite side when useful, and keeps the original readable
55-degree approach cant. This fills all 69 nominal stations across 13 corridors
without deleting a board. Regression coverage checks the complete 1.08 m-deep
frame/lamp/pedestal envelope against every drivable road segment, measured asset
visual, procedural solid, rail/landmark/POI reservation and water edge, with a
half-metre building buffer. Checking only the pedestal—or rejecting a whole
block that contains a valid gap—is not sufficient.

The fixed road/building/ground reservations are indexed by their conservative
world AABBs in a 48 m grid. A query restores original authored order and still
runs the same exact oriented-footprint SAT on every broadphase result; the
cant/offset/side/setback first-valid search and sequential accepted-board checks
are untouched. Full-Cairo exhaustive equivalence pins all 748 placement objects
while reducing exact overlap tests from 9,346,613 to 27,419.

The three drivable bridge corridors are a separate third pass. The Sixth of
October main deck has eight approach-facing gantries over its full 1.2 km run;
Qasr El-Nil and Al-Galaa receive one each. Gantry faces span the carriageway
above vehicle clearance while their legs land beyond the asphalt/parapet. A
fourth pass mounts 34 portrait campaign signs along both outside parapets of
the Sixth of October deck. Their complete frames sit beyond the live lanes,
short brackets reach inward to parapet-edge posts, and stations leave at least
15 m of longitudinal breathing room around every gantry.
`buildCairoAdvertising` consumes all four kinds through the city registry's
`streetFurniture` slot. Geometry uses the exact former instance world matrices,
batched as thin instances by master/creative and 128 m culling cell. This keeps
the same 3,622 rendered parts and all shared materials while replacing 3,622
`InstancedMesh` nodes plus 748 placement roots with 914 frustum-cullable chunks.
Increasing density by creating one material or texture per placement defeats
that contract. Keep chunks spatial: one city-wide batch per creative would stay
active everywhere and submit remote signs on every frame. Babylon stores the
`world0`–`world3` thin-instance attributes on `Geometry`, so spatial chunks may
share materials but must make their cloned geometry unique before installing
their matrix buffer; otherwise the last chunk silently replaces every earlier
chunk's GPU transforms and separates faces from supports.

The two committed atlases are artwork only and contain no baked copy. The 16
campaigns are Arabic-majority, and their
fictional slogans are composed at runtime on `DynamicTexture` layers after the
same bundled Arabic font gate used by the Corniche crowns. Keep those text and
art planes separate: it is what makes the words auditable, correctly shaped,
and replaceable without regenerating imagery. Emission belongs only to the ad
face and its small lamps; the polished frame uses specular response, never a
wall-wide light treatment.

## Grass, parks and planting are their own page

Ground grass, park lawns, paths and planting live in [greenery.md](greenery.md); their y-layer rungs are in the stack above.

## The glTF loader bakes a 180° Y flip

Model fronts are *usually* on local −Z. This propagates into four separate offset
conventions: props `yawOffset = π/2`, characters `π`, buildings per-model
`frontOffset`, vehicles per-model (the van's `-π/2` is what plate placement
derives its axes from). A Babylon box's +Z face also renders textures
180°-rotated, so both plates present their −Z face.

**A model has no one facing — each placement path has its own frame, and you
must measure in the path's frame, not the loader's.** The loader's flip is a
180° Y-rotation *plus* scaling `(1,1,-1)` on the same `__root__`.
`getBuildingMaster` merges with that intact (then repairs winding), so in the
street wall a facade authored on +Z stays +Z — `frontOffset: Math.PI`. But
`instantiateProp` overwrites the root scaling with a uniform scale, so in the
venue/prop frame only the rotation survives and the same +Z facade lands on
−Z — `yawOffset: π/2`, same as every other prop. Deriving a venue offset from
an as-loaded NullEngine measurement is how all 24 of Cairo's modelled venues
shipped with their doors to the open land. The placed-frame measurement (door
and glazing submesh centroids on the holder's road-facing −x, per
`PROP_MODEL_FOOTPRINTS_M`'s header) is pinned in `tests/cairoVisuals.test.ts`
("Cairo venue buildings face their road").

## Rendered poses are interpolated

The player and NPCs draw at the prev/current sim-pose blend
(`renderInterpolation.ts`, alpha = the accumulator remainder). **Every pose
teleport — reset, cutscene repose, NPC slot reuse or a discontinuous level
reassignment — must pin prev = current** or the entity streaks through the map
or deck for a frame; `shouldSnapPose` catches >2.5 m three-dimensional jumps
automatically.

## Traffic slots and profiling

The renderer owns one fixed visual slot for every normalized simulation NPC
slot (32 desktop / 16 touch on shipped maps). `NpcVisualSlotAssignmentResolver`
reuses its lookup maps and typed generation marks, so normal snapshot assignment
is O(N) without per-tick collection rebuilding. `applySimulationNpcSnapshots`
only writes a root's enabled state when assignment, cutscene hiding, or active
state actually changes; recycling keeps an NPC id and appearance in its slot and
therefore does not imply a visual rebuild.

`window.__sideswapPerfDebug()` includes `traffic` from
`SimulationCore.getTrafficDiagnostics()` (pool/bands, portal/lifecycle work,
route and spatial counters) and `vehiclePresentation` (allocated/enabled vehicle
meshes, unique material/texture counts, active/enabled roots, actual current sun-
shadow submissions, mirror-frustum candidates, rebuild/reassignment and root-
transition counters). `renderTiers.enabled` is deliberately `false` in the first
32/16 locality candidate: Phase 4 distance LOD remains conditional on a measured
device failure, and there is no decorative second fleet. The current full/mid/
far/outside counts make that absence explicit instead of implying a hidden tier.

Stage measurements include bounded p50/p95/max samples as well as window
averages. `trafficSnapshotApplyMs` isolates fixed-tick NPC snapshot assignment/
root updates and `trafficVisualUpdateMs` isolates render-frame NPC interpolation;
`simStepMs` still includes all authoritative simulation work. The same drained
window reports catch-up frames, long frames, and maximum fixed steps in one
render frame, while the enclosing snapshot includes simulation tick/player pose
for correlation with activation and retirement counter deltas. Do not claim the
plan's traffic-only 25% frame-budget gate from either presentation timer alone.
These are diagnostic reads only; adaptive rendering and presentation never
choose simulation traffic behaviour.

Browser performance runs use `window.__sideswapInputReplay(command)`, not timed
calls to `__sideswapDriveControl`. Start a compact half-open fixed-tick trace
with `{action: "start", segments: [{fromTick: 0, toTick: 600, input:
{throttle: 1}}], sampleEveryTicks: 60}`; omitted controls and gaps are neutral.
Calling the hook with no argument (or `{action: "status"}`) returns the map,
scenario, seed, camera/input profile, absolute/relative tick progress, distance,
bounds, sampled poses, and an FNV trajectory hash over every fixed-tick pose.
Baseline and candidate hashes/coverage must match before comparing timing.
`{action: "stop"}` releases all controls; natural completion does the same.
Reset or debug teleport aborts the run rather than silently changing its route.

Every session records the exact QA-hook closures it installed. Disposal removes
a hook only if that same closure still owns the window property, so a retiring
React/HMR session cannot delete the replacement session's newer hooks.

## Models load in two phases

Everything starts as an empty placeholder; an async preload then upgrades
vehicles/characters/props, builds instanced buildings and the VAT crowd, and only
*then* calls `markReady()` — which is what lifts the React loading gate. There is
no procedural vehicle/character fallback any more, so **anything that lifts
`markReady` early ships invisible cars and people.**

Building glbs are **map-scoped** (`buildingSetUrls` over the sets the map's blocks
name), so Cairo never downloads NYC's towers. Venue/service props follow the
same rule: `propModelUrlsForMap` resolves each authored venue's `modelId ?? kind`
and each service kind, ignoring procedural-only registry misses. Do not replace
it with the all-registry `propModelUrls()` asset-audit list; that made Cairo
download and parse roughly 15 MiB of other cities' storefronts.

Asset provenance and licences live in [CREDITS.md](../CREDITS.md). An OBJ-only
source pack goes through `tools/obj-to-glb.mjs`; a separate glTF-with-external-
buffer/images export (Sketchfab's autoconverted download format, the Tokyo
kit's source) goes through `tools/pack-gltf.mjs` instead, which only embeds
external resources as bufferViews and never touches accessor data. Both are
hand-written rather than an npm converter because `tests/cairoAssets.test.ts`/
`tests/tokyoAssets.test.ts` pin committed SHA-256s and a dependency bump must
not change the bytes.

## The crowd is 3–5 meshes for a whole city

A hand-baked vertex animation texture (the stock Babylon baker doesn't work on
glTF animation groups) plus thin instances, with per-person colour as
thin-instance colour channels.

The thin matrix must be the conjugate `W0 · Pose · W0⁻¹` (`crowdRenderMath.ts`,
pure, pinned against Babylon's own `Matrix`) — that is what keeps walkers in world
space and winding correct despite the loader's handedness mirror. Get it wrong and
you get inside-out or moonwalking pedestrians, silently.

## Water is one flat sheet, so its normals and its material do all the work

`buildWaterPolygonGeometry` ear-clips a `WaterBody` into one horizontal sheet
with no relief, which makes two things load-bearing that are invisible
elsewhere. **Triangle winding is the lighting**: nothing culls the sheet, so a
reversed winding does not drop a face — it points every normal at the riverbed
and the Nile goes near-black. And a **frozen `StandardMaterial` stops updating
its texture matrix**, which lives in the uniform buffer it stopped uploading,
so anything that scrolls a texture must stay unfrozen.

Everything else keys off `WaterBody.flowHeadingDeg`: with a current the surface
gets crest streaks along it (`buildRiverWaveField`), normal-mapped chop and two
tiles drifting downstream at different speeds; without one it is a pond —
isotropic, no bump, frozen. The one authored `color` is only a base, painted at
`RIVER_TILE_GAIN_*` of face value because a lit plane collects ~1.5× (day)
before the grazing sheen is added. The bank darkening needs geometry of its
own, since every vertex of the bare outline *is* a bank vertex: the builder
mitres a ring inward for the tint to fade across, and refuses outlines too
tight to inset.

## The per-city registry is an explicit, exact-mapId record, and fails loudly on a miss

`MAP_VISUAL_PROFILES` (`visuals.ts`) is the one per-city identity table —
palette key, plate region, allowed building sets, nature sets, and crowd
complexion/hair weights, keyed by the map's exact authored id, no substring
matching, no default. `resolveMapVisualProfile`/`resolveMapVisualKey` throw
immediately on an unmapped id, naming it, rather than silently borrowing
NYC's look. It carries only *selectors*; the content each indexes into
stays in its own domain file, so adding a city is one new row here, never a
second mapId-keyed table. `cityRenderRegistry.ts`'s landmark dispatch stays
`undefined`-on-miss instead: a landmark with no dispatcher is a supported
no-op, where a map with no profile can't render at all.

## The first-person cabin

Splits like the road geometry does: `cockpitLayout.ts` holds every number (dash
section, vent slots, pillar/roof profiles, screen rake, gauge sweep, the mirror
rect) with no Babylon import, and `buildCockpit` only turns them into meshes.

Four traps:

1. **`makeMaterial` leaves `ambientColor` black**, so a cabin surface built with
   it discards `scene.ambientColor` and reads as a silhouette after dark. Use
   `makeInteriorMaterial`, whose three terms are day/night split because the sun
   runs 1.3 against 0.6 and one palette bleaches whichever end it is not tuned for.
2. **Nothing under `playerCockpit` can be `freezeWorldMatrix`'d** — it hangs off
   the player node, rewritten every frame. `mergeCockpitStatics` collapses the
   statics to one mesh per material at the end of the build, so a new part is a
   permanent draw call unless it lands in a merge group. It must carry UVs or
   Babylon refuses the merge, which is the only reason `createExtrudedPrism`
   emits them.
3. **The cowl can eat the road**, so `cockpitCowlScreenFraction` and
   `tests/cockpitLayout.test.ts` pin it across every FOV and aspect.
4. The mirrors — below.

### Both mirrors are RenderTargetTextures, and the render list is the entire job

The cabin carries `COCKPIT_LAYER_MASK` to stay out of them.

Babylon's `ObjectRenderer` **frustum-culls nothing** — there is not one
`isInFrustum` call in it — and an RTT with a null `renderList` silently falls back
to the meshes culled for the *main* camera, which for a rearward mirror is the
wrong half of the world and looks plausible until you watch it.

So the caller culls: `mirrorRenderList.ts` picks a ring out of the same spatial
hash the shadow casters use (amortised on movement, deliberately conservative —
a false positive costs one frustum test, a false negative is a hole in the
mirror), and `MirrorRig`'s `getRenderList` (`render/mirrorRig.ts`) frustum-tests
those few hundred candidates per render instead of the ~15,000 meshes in the
scene.

Supply it through **`getCustomRenderList`**:

- never `renderList` — its setter installs an array observer that fires
  `_markSubMeshesAsLightDirty` over every mesh in the scene when the list goes
  empty-then-non-empty;
- never `renderListPredicate` — it re-walks `scene.meshes` every render.

`forceLayerMaskCheck` must be on, or a supplied list skips the mask check and the
cabin appears in its own mirror.

A render target only renders if it is in `scene.customRenderTargets` — an RTT used
as an `emissiveTexture` is never discovered; only `reflectionTexture` /
`refractionTexture` are. And it needs **both** diffuse and emissive slots, since
StandardMaterial multiplies its lit result by the diffuse base and a black diffuse
renders flat emissive.

This is what makes mirrors cheap: `refreshRate` skips whole frames (the texture
keeps its contents), which a viewport camera cannot do. First-person draw calls
fell from 488 to 390 *while gaining* a wing mirror.

Kerbside parked cars use the vendor-cart recipe at street scale: one
`parkedCarsForMap` plan is read by the session's build (merged-master
`createInstance` per car off the traffic fleet's own four glbs) and by the
scatter keep-out. London preserves its 182 solver-authored
`LONDON_PARKED_CARS`; the other cities derive deterministic placements from
their real carriageways, adjacent legal-lane headings and geometry keep-outs.
They are **knockable via `DESTRUCTIBLE_PROP_CONFIGS`, never solid** — the
lane-corridor and walkable-band collider tests reserve the kerbside, and a
shunted car reads better than an invisible wall. Measured cost of London's
182: ~27 draw calls.

Tokyo's own parked bicycles (`TOKYO_PARKED_BICYCLES` in
`tokyoStreetFurniture.ts`, Tokyo expansion Phase 9) are the same idea but
**cannot** reuse `getBuildingMaster`: that path's `Mesh.MergeMeshes` requires
every submesh of a glb to share one vertex-attribute layout, and
`bicycle.glb`'s don't — `tools/split-bicycle-pedals.mjs` split the pedals
and tires into their own nodes for animation, which is exactly what leaves
them heterogeneous. **Any future glb whose submeshes were split or otherwise
authored unevenly will hit the same merge crash** the first time something
calls `getBuildingMaster` on it. The FIRST fix to try is
`tools/normalize-glb-attributes.mjs`: when the layout mismatch is only
unused secondary UV channels (the usual Sketchfab case), stripping them lets
the model merge and the whole question disappears. The escape hatch —
`instantiateModelInstanced` (`modelLibrary.ts`), which instances **per
submesh** with no layout requirement — is for genuine mixes only
(TANGENT-bearing vs not, where stripping would break normal mapping:
`tokyo-apato-b`, `tokyo-ramen`, the bicycles' animation-split pedals).

**The per-submesh path costs one SCENE MESH per submesh per placement, and
one draw call per distinct submesh — both matter, at different scales.**
`tokyo-apato-b` (99 BIM-style submeshes) added a ~99-draw fixed tax the
moment one instance was in view (live paired CDP measurement, P3b), which
is why it is in no building set. `tokyo-house-d` (290 submeshes, 417
street-wall placements) was catastrophically worse: ~119,700 scene meshes —
87% of Tokyo's whole scene and a 31→6 fps collapse from per-frame mesh
management alone — invisible to the forced-empty-preload characterization
suite AND to draw-call-only pose checks (its draw calls were fine; the
meshes were the cost). That is why it was normalized off
`MERGE_INCOMPATIBLE_MODEL_IDS` entirely; nothing on that list should ever
be in a repeatedly-placed set. The two paths also disagree about anchoring:
`getBuildingMaster` recentres the merged master's XZ, the per-submesh path
plants the model's NATIVE origin at the slot — a model whose origin is far
off-centre (house-d's was 5.6 m) silently places that far from where the
planner and its curated collider assume under the per-submesh path.

**A Sketchfab material whose baseColor PNG merely has an alpha channel gets
exported `alphaMode: "BLEND"`, and BLEND renders depth-write-off** — the
building draws its far walls over its near ones ("transparent walls",
"hollowed-out" towers; Sketchfab's own viewer hides this). Check every new
import with `tools/fix-glb-alpha-blend.mjs`: it measures the decoded alpha
and demotes to OPAQUE (channel carries nothing) or MASK (real cutouts,
depth-written). Real translucency — factor-alpha window glass — is the only
thing that should stay BLEND.

`registerStaticCell` takes an explicit `castsShadow` flag because the instanced
building street wall deliberately casts none — flipping one silently adds it to
the shadow map and changes every camera. The instanced glb wall casts no sun
shadow while the procedural facade fabric does — as merged chunks:
**`ProceduralFacades.finalize` world-bakes every box and dressing piece into
one mesh per (material, shadow flag, 96 m cell)** after the block loop, which
is what makes a box city the size of reimagined Cairo affordable (a live
paired measurement had the unmerged fabric halving the frame rate; merged, the
map draws at or below the pre-reimagining baseline with identical pixels). A
zero-vertex degenerate piece is dropped before merging — it used to render
nothing harmlessly and would otherwise poison its bucket. `BuildingLayer`'s
proxy boxes stay individual (they exist only for missing glbs); the
corniche parapet follows the instanced rule, rendering a map's own shoreline
collider OBBs verbatim (`shorelineParapetRuns`) — you see the wall you hit.
Gated on `PROMENADE_DRESSING_MAP_KEYS` (`visuals.ts`, currently Cairo and
Tokyo — Tokyo expansion Phase 3), not hardcoded to Cairo; the per-road
open-waterfront table each city passes into `generatePromenadeDecor`
(`render/roadsideProps.ts`) stays in that city's own content file
(`CAIRO_OPEN_WATERFRONT_SIDES`, `TOKYO_OPEN_WATERFRONT_SIDES`) rather than
`visuals.ts`, which would need to import back from `cities/*.ts` — every
city file already imports FROM `visuals.ts`, so that would be a real cycle.
The decor's own species (`treeKind`/`lampKind`, Tokyo expansion Phase 9) are
a second, separate per-map lookup in the same file
(`PROMENADE_DECOR_KINDS_BY_KEY`) for the same reason — Cairo keeps its
original "palm"/"streetlight" literals, Tokyo passes "sakura"/"chochin-post".
Each needs its own `DESTRUCTIBLE_PROP_CONFIGS` row, since the promenade places
them directly rather than through the generic roadside-scatter
`PropKindConfig` path — and then either a `partsFor` case (procedural) or a
route onto `pendingPlantedProps` (an imported glb). "palm" takes the second:
its `partsFor` case is gone, and `buildRoadsideProps` diverts every palm
placement, promenade and scatter alike, to the planting queue.

## Render scaling

**`hardwareScalingLevel` is CSS pixels per rendered pixel — higher is blurrier —
and `setHardwareScalingLevel` *overwrites* what `adaptToDeviceRatio: true`
computed rather than composing with it.** A level derived from
`devicePixelRatio` double-counts it (the old `min(1.65, dpr/1.2)` pinned every
phone to a 516×238 buffer). `resize()` does **not** reset the level in Babylon
9.16.1, so a level set once persists.

Touch also swaps 4× MSAA for FXAA, since the pipeline's offscreen target bypasses
engine MSAA anyway.

**Changing the scaling level mid-drive can flash the screen black, and only touch
is allowed to do it.** `engine.resize()` fires `onResizeObservable`, which
`DefaultRenderingPipeline` uses to re-assert `bloomKernel`; that reaches both blur
post-processes as `kernel`, whose setter calls `_updateParameters()` and
**recompiles their shaders** on any new kernel size. A recompiling effect draws
nothing, so the frame lands blank.

Babylon caches by define-set, so each *distinct* level costs one compile ever —
which is why `renderScaling.ts` governs over a **four-rung ladder**
(`TOUCH_SCALING_LADDER` = 0.65 / 0.8 / 1.0 / 1.25, opening one rung down from the
sharpest) rather than a continuous knob, after a warm-up, and why
`governRenderScaling` runs *before* `scene.render()`.

**Desktop is not governed at all**: it takes `desktopHardwareScalingLevel` once at
construction — a DPR curve plus a `DESKTOP_MAX_RENDER_WIDTH_PX` (2560) render cap
for DPR-1 4K/5K monitors, with MSAA dropping 4×→2× on those buffers. Governing
desktop once meant a retina Mac rendering ~4× the pixels, dropping under target,
and ratcheting to the blurriest rung — one-way, because that profile's improve
threshold (58+8 fps) is unreachable under 60 Hz vsync.

## Content-budget counters

`window.__sideswapPerfDebug()` reports fps/hardwareScalingLevel/mesh counts
alongside content-volume counters that answer "how much is actually planned
and standing," not "how sharp": `blockCount` (`mapPack.geometry.blocks.length`),
`plannedStructureCount` (buildingLayout's buildings grouped by
`source` — `assetSlot`/`proceduralCell`/`museumWing` — plus `total`, all four
keys always present even at zero), `structuralSolidCount` (every planned
building's `.solids.length`, summed — always `>= plannedStructureCount.total`
since every building has at least one solid), `staticObstacleCountByTag`
(the session's own static-obstacle list grouped by `tag`), and `sceneReadyMs`
(`performance.now()` at construction to `markReady()`, `null` until ready
fires). These are cheap running totals over data the session already built,
unlike the visual-gap hooks above.
