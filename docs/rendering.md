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

## `buildScenarioEnvironment` is a frozen-order hub

Wires together every render-side builder for a scenario in a **frozen
order**, because that order is also the seeded-random consumption sequence:
`const random = seededUnit(trafficSeed)` is built exactly once, right there
in the method, and reordering any two of its consumers silently gives the
same-named mesh a different width/height/depth. Extracting a piece of the
hub into its own collaborator must never change *when* in the sequence its
work happens, only *which file* it lives in.

Two seeding mechanisms coexist: `seededUnit` (`visuals.ts`) is a stateful
*stream* whose call order is part of its output; `hashStringToSeed` is a
*pure* per-string hash every other seeded choice in the method uses instead,
order-independent by construction. `ProceduralFacades`
(`render/proceduralFacades.ts`) is the **only** permitted consumer of
`random`, reached directly from the block loop or, later, from
`BuildingLayer`'s deferred glb-failure fallback —
`tests/facadeGridDrawOrderCharacterization.test.tsx` gates it by
fingerprinting per-mesh output rather than raw `seededUnit` values, since a
consumer permutation that preserves each one's draw count is invisible to a
raw-sequence recording (an LCG's output depends on the seed and the count of
draws so far, never on which call site asks).

## Fog is the draw-distance budget

A day map's fog range comes from its world size, and a palette that wants a
shorter atmosphere than its geography caps it with `fogEndCapM` — the camera's
far plane follows. It is the cheapest lever in the renderer and the two big
day maps both pull it: Cairo's dust haze at 650 m, London's at 800 m.

Measured on London, capping it took **412 draw calls to 171** and active
meshes from 984 to 569, with no change to what the map contains. Its tree and
thicket layer alone is 45% of its mesh count, and most of that is a kilometre
away behind haze.

## London's landmarks share one material trio

Every landmark in `render/londonLandmarks.ts` dresses itself with the same
pale trim, dark glazing and dark roof. They used to be minted per landmark
with the id baked into the name and identical colours every time — 78 of them
for the parks alone, and materials are GPU state changes. `landmarkPalette`
caches the trio per `Scene` (not a module-level `let`: a session rebuild gets
a fresh scene, and the second mount would otherwise get the first's disposed
materials).

## Three angle conventions coexist

| Thing | Convention |
|---|---|
| World | `x` east, `z` north, `y` up, metres, origin = map centre |
| Lane/pose heading | `atan2(dx, dz)` — **0 = +z (north)**, +π/2 = +x |
| Right-hand normal | `(cos h, -sin h)` — the **driver's right** |

## The y-layer stack is a hard global ordering

Every value is tuned to kill z-fighting, and they are spread across three modules
(`render/babylonGameSession.ts`, `crowdRenderer.ts`, `vehicleMeshes.ts`):

```
0.02 park lawn  <  0.0255 park beds  <  0.031 park paths/terraces  <  0.0435 shoulder junction fill
<  0.045 shoulder/sidewalk  <  0.07 road surface  <  0.0716 asphalt junction fill  <  0.08 walkers
<  0.1 crowd shadows  <  0.12 markings & vehicle nodes  <  0.144-0.147 chevrons/stop lines
```

Vehicle ground contact is a **two-value handshake**: nodes at `y = 0.12` and
`LOCAL_GROUND_Y = -0.05` put tyres at exactly `0.07`. Change either alone and the
whole fleet floats or sinks.

The stack cannot save geometry that fights *inside* one model. The Quaternius
Cairo kit authors its brick patches, base bands and glazing as primitives
0.6–3.5 mm proud of the wall primitives — below what a 24-bit depth buffer
resolves at street viewing distance — so `biasCairoDecalMaterials` pulls those
five named materials (`CAIRO_DECAL_MATERIAL_NAMES`) toward the camera with
`zOffsetUnits`, per `cairo-*.glb` container material only. Two rules fall out:
prefer polygon offset over nudging vertices for decal-on-wall fixes (it scales
with the local depth quantum), and treat camera `minZ` as a depth-precision
budget — precision varies as `minZ/z²`, the far plane is almost irrelevant, and
the chase camera's 0.5 exists to keep millimetre offsets resolvable. Don't
lower a `minZ` to "fix" near clipping without knowing you are spending 1/n of
everyone's depth separation.

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
teleport — reset, cutscene repose, NPC slot reuse — must pin prev = current** or
the entity streaks for a frame; `shouldSnapPose` catches >2.5 m jumps
automatically.

The far plane rides the fog band (`resolveCameraFarPlane`) — raise fog and you
raise draw distance with it. A day palette may cap its own fog end
(`fogEndCapM`): Cairo's 650 m dust haze is both the look and the perf budget
for its dense street wall (draw calls/frame −31% vs the uncapped 1100 m).

## Models load in two phases

Everything starts as an empty placeholder; an async preload then upgrades
vehicles/characters/props, builds instanced buildings and the VAT crowd, and only
*then* calls `markReady()` — which is what lifts the React loading gate. There is
no procedural vehicle/character fallback any more, so **anything that lifts
`markReady` early ships invisible cars and people.**

Building glbs are **map-scoped** (`buildingSetUrls` over the sets the map's blocks
name), so Cairo never downloads NYC's towers. Venue/service props are not — every
map pays for all of `propModelUrls()`.

Asset provenance and licences live in [CREDITS.md](../CREDITS.md). An OBJ-only
source pack goes through `tools/obj-to-glb.mjs`, which is hand-written rather
than an npm converter because `tests/cairoAssets.test.ts` pins committed
SHA-256s and a dependency bump must not change the bytes.

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

London's kerbside parked cars are the vendor-cart recipe at street scale:
one table (`LONDON_PARKED_CARS` in `londonStreetFurniture.ts`, solver-placed)
read by the session's build (merged-master `createInstance` per car off the
traffic fleet's own four glbs) and by the scatter keep-out, **knockable via
`DESTRUCTIBLE_PROP_CONFIGS`, never solid** — the lane-corridor and
walkable-band collider tests reserve the kerbside, and a shunted car reads
better than an invisible wall. Measured cost of all 182: ~27 draw calls.

`registerStaticCell` takes an explicit `castsShadow` flag because the instanced
building street wall deliberately casts none — flipping one silently adds it to
the shadow map and changes every camera. The instanced glb wall casts no sun
shadow while every procedural facade box does (`registerShadowCaster`); the
corniche parapet follows the instanced rule, rendering Cairo's shoreline
collider OBBs verbatim (`shorelineParapetRuns`) — you see the wall you hit.

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
