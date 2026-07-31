# The rendering layer

`GameCanvas.tsx` and the Babylon scene. Read this before touching the session,
the world geometry, the models/crowd, the cockpit, or anything performance-shaped.
The 2D drive HUD is a separate concern — see [drive-hud.md](drive-hud.md).

## Shape of the file

`GameCanvas.tsx` is ~16.7k lines but holds only three live objects: `class
BabylonGameSession`, `class AdaptiveInputRouter` (which owns input-prompt
presentation and never disables an input method), and the React component at the
bottom.

**React owns the canvas element, the props, and one 10 Hz HUD snapshot; the
session owns everything else.** No React state is driven at frame rate.

The session is rebuilt only on `[trafficSide, steeringSide, lesson?.id,
mapPack?.id]`; every other prop flows through `session.updateOptions(...)`.
Notably *not* orientation — rotating a phone pauses the drive, it does not rebuild
the city.

**Everything above `GameCanvasProps` is an exported pure geometry layer** (road
strips, junction fills, chevron placement) — exported specifically so tests can
import it without instantiating Babylon.

## Three angle conventions coexist

| Thing | Convention |
|---|---|
| World | `x` east, `z` north, `y` up, metres, origin = map centre |
| Lane/pose heading | `atan2(dx, dz)` — **0 = +z (north)**, +π/2 = +x |
| `arcPoints` angles | **0 = +x (east)**, 90 = +z — standard math, *not* the heading convention |
| Right-hand normal | `(cos h, -sin h)` — the **driver's right** |

## The y-layer stack is a hard global ordering

Every value is tuned to kill z-fighting, and they are spread across three modules
(`GameCanvas.tsx`, `crowdRenderer.ts`, `vehicleMeshes.ts`):

```
0.0435 shoulder junction fill  <  0.045 shoulder/sidewalk  <  0.07 road surface
<  0.0716 asphalt junction fill  <  0.08 walkers  <  0.1 crowd shadows
<  0.12 markings & vehicle nodes  <  0.144-0.147 chevrons/stop lines
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

## The glTF loader bakes a 180° Y flip

Model fronts are *usually* on local −Z. This propagates into four separate offset
conventions: props `yawOffset = π/2`, characters `π`, buildings per-model
`frontOffset`, vehicles per-model (the van's `-π/2` is what plate placement
derives its axes from). A Babylon box's +Z face also renders textures
180°-rotated, so both plates present their −Z face.

**−Z is a default, not a guarantee — measure it.** The KayKit and Quaternius
building packs author their facade on **+Z**, which is what every
`frontOffset: Math.PI` in `buildingSets.ts` and every `yawOffset: -π/2` in
`PROP_MODEL_REGISTRY` is paying for. Assuming −Z on one of those silently turns
the building's back to the street, which is exactly how Cairo's two residence
venues shipped facing the wrong way. For a pack with named materials the cheap
check is the centroid of the door/glazing submesh (`Wood`, `DarkWood`, `Glass`);
`PROP_MODEL_FOOTPRINTS_M`'s header states the invariant the offset must satisfy —
after `yawOffset`, +z runs along the facade and the road lies on −x.

## Rendered poses are interpolated

The player and NPCs draw at the prev/current sim-pose blend
(`renderInterpolation.ts`, alpha = the accumulator remainder). **Every pose
teleport — reset, cutscene repose, NPC slot reuse — must pin prev = current** or
the entity streaks for a frame; `shouldSnapPose` catches >2.5 m jumps
automatically.

The far plane rides the fog band (`resolveCameraFarPlane`) — raise fog and you
raise draw distance with it.

## Models load in two phases

Everything starts as an empty placeholder; an async preload then upgrades
vehicles/characters/props, builds instanced buildings and the VAT crowd, and only
*then* calls `markReady()` — which is what lifts the React loading gate.

There is no procedural vehicle/character fallback any more, so **anything that
lifts `markReady` early ships invisible cars and people.**

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

## City palettes are chosen by substring

`resolveMapVisualKey(mapId)` is **substring matching with an `nyc` default**, and
Cairo must match explicitly before that fallback. A typo'd or new map id silently
gets NYC's night+paved palette, changing lighting, fog, ground texture, sidewalk
width *and* the crowd's rail geometry.

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
mirror), and `updateMirrorRenderList` frustum-tests those few hundred candidates
per render instead of the ~15,000 meshes in the scene.

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

`registerStaticCell` takes an explicit `castsShadow` flag because the instanced
building street wall deliberately casts none — flipping one silently adds it to
the shadow map and changes every camera. Note the two street-wall paths differ
here: the instanced glb wall casts no sun shadow, while every procedural facade
box does (`registerShadowCaster`). A map that moves from one to the other changes
its shadow load as well as its draw calls.

## Render scaling

**`hardwareScalingLevel` is CSS pixels per rendered pixel — higher is blurrier —
and `setHardwareScalingLevel` *overwrites* what `adaptToDeviceRatio: true`
computed rather than composing with it.** A level derived from `devicePixelRatio`
therefore double-counts it; the old `min(1.65, dpr / 1.2)` pinned every phone to
1.65, a 516×238 buffer on a DPR-3 landscape iPhone. `resize()` does **not** reset
the level in Babylon 9.16.1 (it only rescales on a real DPR change), so a level set
once persists.

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
