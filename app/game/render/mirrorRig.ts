import {
  type AbstractMesh,
  Camera,
  Color3,
  Frustum,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  type Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import {
  createBox,
  createChamferedPanel,
  createExtrudedPrism,
  setMeshMaterial,
} from "./meshPrimitives";
import {
  MIRROR_RADIUS_M,
  mirrorCandidatesAreStale,
  mirrorCells,
} from "../mirrorRenderList";
import {
  cameraPanelPlacement,
  COCKPIT_WING_MIRROR,
  REAR_VIEW_VIEWPORT,
  WING_MIRROR_SAIL_PROFILE,
  wingMirrorHeadRotation,
  wingMirrorIsVisible,
  wingMirrorOutline,
  wingMirrorSide,
} from "../cockpitLayout";
import { COCKPIT_LAYER_MASK, WORLD_LAYER_MASK } from "./renderConstants";
import type { SteeringSide } from "../sessionContract";

function makeMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  material.emissiveColor = emissive ?? Color3.Black();
  return material;
}

/**
 * The rear-view and wing mirrors: two throttled render targets, the shared
 * candidate-gathering/frustum-culling that feeds both, and the render-target
 * activation that turns them on and off. De-methodized out of
 * `BabylonGameSession` (Phase 3.12, characterized ahead of time by
 * `tests/mirrorRigCharacterization.test.tsx` — coupling 30, the highest of
 * any Phase 3 cargo, over the plan's >= 9 threshold).
 *
 * `build`/`buildWingMirror` install `texture.getCustomRenderList` closures
 * that Babylon calls on its own schedule (`refreshRate`), indefinitely, long
 * after the one build call that creates them returns — unlike every other
 * per-frame Phase 3 cargo (perfGovernor), there is no session-resident call
 * site to construct a fresh ctx each time. So the closure captures
 * `ctx.gatherFrameState`, a callback the session hands in once at build time
 * that itself closes over live session state (`displayedX`/`playerVehicleVisual`/
 * `npcVehicles`/`shadowCasterCells`) — calling it, however many times, always
 * reads current values, the same shape `createFlatSegment` and every other
 * ctx callback in this program use. `getRenderList`/`refreshCandidates`
 * therefore take that gathered snapshot as a plain argument rather than
 * reading session fields, keeping the render-list frustum/asymmetry logic
 * (player casters unconditional, NPC casters frustum-tested — preserved
 * exactly) as the only thing this class still owns outright.
 *
 * `mirrorsAllowed` is a public field, not a private one behind a setter:
 * `perfGovernor.ts`'s `setMirrorsAllowed` ctx callback writes it directly,
 * immediately before calling `setActive` — same ordering hazard Phase 3.8
 * found and fixed for the session field this replaces (`setActive` reads
 * `mirrorsAllowed` internally, so the write must land before the read, not
 * after, which is why that ctx callback exists instead of folding the value
 * into a return record).
 *
 * `rearViewPanel`/`wingMirrorRig` are exposed as getters: `perfGovernor.ts`'s
 * ctx needs direct read access to the actual `Mesh`/`TransformNode`, not a
 * method. `renderCount`/`candidateCount`/`drawnCount` are getters for the
 * same reason — the `__sideswapPerfDebug` hook reads them as plain numbers.
 *
 * Three render lists, not one: `mirrorAlways` holds the map-spanning surfaces
 * no spatial cull can meaningfully reject (an avenue's road mesh is hundreds
 * of metres long, and the sky is everywhere); `mirrorCandidates` is the ring
 * gathered from the shadow-caster cell hash, re-gathered only on movement;
 * `mirrorRenderList` is that ring frustum-tested against the mirror camera,
 * rebuilt in place per render. Babylon's `ObjectRenderer` culls nothing, so
 * this pipeline is the whole cull.
 */

export interface MirrorFrameInputs {
  readonly displayedX: number;
  readonly displayedZ: number;
  readonly displayedHeading: number;
  /** Same grid the shadow ring buckets into — `registerStaticCell`'s
   * `BabylonGameSession.SHADOW_CELL_M` — passed in rather than duplicated,
   * so the two rings can never key the same map with different cell sizes. */
  readonly shadowCellM: number;
  readonly shadowCasterCells: ReadonlyMap<
    string,
    readonly { mesh: AbstractMesh; x: number; z: number; castsShadow: boolean }[]
  >;
  readonly playerShadowCasters: readonly AbstractMesh[];
  readonly activeNpcShadowCasters: readonly (readonly AbstractMesh[])[];
}

export interface MirrorRigCtx {
  readonly firstCamera: UniversalCamera;
  readonly rearCamera: UniversalCamera;
  readonly playerCockpit: TransformNode;
  readonly cameraFarPlaneM: number;
  readonly steeringSide: SteeringSide;
  readonly engineRenderWidth: number;
  readonly engineRenderHeight: number;
  readonly gatherFrameState: () => MirrorFrameInputs;
}

export class MirrorRig {
  private rearViewTexture: RenderTargetTexture | null = null;
  private rearViewPanelField: Mesh | null = null;
  private wingMirrorTexture: RenderTargetTexture | null = null;
  private wingMirrorRigField: TransformNode | null = null;
  private readonly mirrorAlways: AbstractMesh[] = [];
  private readonly mirrorCandidates: AbstractMesh[] = [];
  private readonly mirrorRenderList: AbstractMesh[] = [];
  private mirrorGatheredX = Number.POSITIVE_INFINITY;
  private mirrorGatheredZ = Number.POSITIVE_INFINITY;
  private mirrorGatheredHeading = Number.POSITIVE_INFINITY;
  private mirrorRenderCount = 0;
  mirrorsAllowed = true;

  constructor(private readonly scene: Scene) {}

  get rearViewPanel(): Mesh | null {
    return this.rearViewPanelField;
  }

  get wingMirrorRig(): TransformNode | null {
    return this.wingMirrorRigField;
  }

  get renderCount(): number {
    return this.mirrorRenderCount;
  }

  get candidateCount(): number {
    return this.mirrorCandidates.length;
  }

  get drawnCount(): number {
    return this.mirrorRenderList.length;
  }

  /**
   * The rear-view mirror, as a throttled render target on a camera-locked quad.
   *
   * It used to be a third camera rendered straight into a screen-space viewport
   * — a full extra scene pass, every frame, for a strip 23% of the screen wide.
   * A viewport camera cannot be throttled (skip a frame and the strip shows
   * whatever the main camera drew there), but a render target can: on a skipped
   * frame Babylon does nothing at all and the texture keeps its contents. That
   * is what makes a second mirror affordable.
   *
   * Deliberately no mipmaps — Babylon runs a full `gl.generateMipmap` on every
   * render otherwise, and this is sampled at roughly 1:1.
   */
  build(ctx: MirrorRigCtx): void {
    const scene = this.scene;
    const texture = new RenderTargetTexture(
      "rear-view-mirror",
      { width: 256, height: 160 },
      scene,
      false,
    );
    texture.activeCamera = ctx.rearCamera;
    texture.refreshRate = 2;
    // A supplied render list bypasses Babylon's layer-mask check unless this is
    // set, and without it the cabin would be drawn into its own mirror.
    texture.forceLayerMaskCheck = true;
    texture.clearColor = this.scene.clearColor.clone();
    texture.getCustomRenderList = () =>
      this.getRenderList(ctx.rearCamera, ctx.gatherFrameState());
    texture.onAfterRenderObservable.add(() => {
      this.mirrorRenderCount += 1;
    });
    this.rearViewTexture = texture;

    // Both slots, like the number plates and the instrument cluster. Emissive
    // alone is not enough: StandardMaterial multiplies its lit result by the
    // diffuse base, so a black diffuse leaves nothing for the reflection to
    // modulate and the panel renders as its flat emissive colour.
    const material = makeMaterial(
      scene,
      "rear-view-glass",
      Color3.White(),
      new Color3(0.72, 0.72, 0.72),
    );
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.disableLighting = true;

    const panel = MeshBuilder.CreatePlane(
      "rear-view-panel",
      { width: 1, height: 1 },
      scene,
    );
    panel.parent = ctx.firstCamera;
    setMeshMaterial(panel, material);
    panel.layerMask = COCKPIT_LAYER_MASK;
    panel.alwaysSelectAsActiveMesh = true;
    panel.doNotSyncBoundingInfo = true;
    this.rearViewPanelField = panel;
    this.layoutPanels(ctx);
  }

  /**
   * The driver's wing mirror: a stalk, a shell, and glass showing its own
   * render target.
   *
   * Unlike the rear view this is a real object out beside the door, so it moves
   * with the cabin and is framed by the field of view like anything else — and
   * at a narrow FOV it slides off the edge of the screen, at which point the
   * whole thing including its render target is switched off rather than drawn
   * as a sliver.
   *
   * Its camera looks back *and outboard*: the lane beside you is the one thing
   * the rear-view mirror cannot show, and the only reason to have this at all.
   *
   * Returns the camera: `updateCamera`'s per-frame pose update (session-
   * resident, not part of this cargo) positions it every frame via
   * `resolveWingMirrorPose`, so the session needs the reference back — the
   * same returned-record shape Phase 3.1 established for a build-time value
   * session-resident code reads afterward.
   */
  buildWingMirror(
    ctx: MirrorRigCtx,
    steeringRubber: StandardMaterial,
    shell: StandardMaterial,
  ): UniversalCamera {
    const scene = this.scene;
    const side = wingMirrorSide(ctx.steeringSide);
    // The rig sits at the cabin's own origin so the mount can be authored in
    // plain cockpit coordinates alongside the door and pillar it has to meet;
    // only the head is moved out to the mirror.
    const rig = new TransformNode("wing-mirror", scene);
    rig.parent = ctx.playerCockpit;
    this.wingMirrorRigField = rig;

    const sail = createExtrudedPrism(
      scene,
      "wing-mirror-sail",
      COCKPIT_WING_MIRROR.sailThickness,
      WING_MIRROR_SAIL_PROFILE,
      steeringRubber,
      rig,
    );
    sail.position.x = side * COCKPIT_WING_MIRROR.sailX;

    // The head carries the turn toward the seat, so the shell and the glass
    // cannot come apart: both hang off it at zero rotation.
    const head = new TransformNode("wing-mirror-head", scene);
    head.parent = rig;
    head.position.set(
      side * COCKPIT_WING_MIRROR.lateral,
      COCKPIT_WING_MIRROR.y,
      COCKPIT_WING_MIRROR.z,
    );
    const headRotation = wingMirrorHeadRotation(ctx.steeringSide);
    head.rotation.set(headRotation.x, headRotation.y, 0);

    // Inboard in the head's space is -side: the yaw mirrors between drive
    // sides, so local +x points inboard on the left of the car and outboard on
    // the right. It starts inside the housing, so there is no seam where the
    // two meet, and it clears the A-pillar, which has climbed well above this
    // height by the z the arm reaches.
    createBox(
      scene,
      "wing-mirror-arm",
      {
        width: COCKPIT_WING_MIRROR.armLength,
        height: COCKPIT_WING_MIRROR.armHeight,
        depth: COCKPIT_WING_MIRROR.armDepth,
      },
      new Vector3(
        (-side * COCKPIT_WING_MIRROR.armLength) / 2,
        COCKPIT_WING_MIRROR.armLocalY,
        COCKPIT_WING_MIRROR.armLocalZ,
      ),
      shell,
      head,
    );
    // Sized to hide behind the bezel from the front while still giving the
    // housing real depth from any other angle.
    createBox(
      scene,
      "wing-mirror-shell",
      {
        width: COCKPIT_WING_MIRROR.glassWidth * 0.88,
        height: COCKPIT_WING_MIRROR.glassHeight * 0.86,
        depth: 0.055,
      },
      Vector3.Zero(),
      shell,
      head,
    );
    const outline = wingMirrorOutline(ctx.steeringSide);
    const bezelMargin = 1 + COCKPIT_WING_MIRROR.bezelMargin;
    createChamferedPanel(
      scene,
      "wing-mirror-bezel",
      outline,
      COCKPIT_WING_MIRROR.glassWidth * bezelMargin,
      COCKPIT_WING_MIRROR.glassHeight * bezelMargin,
      shell,
      head,
    ).position.z = -0.026;

    const camera = new UniversalCamera(
      "wing-mirror-camera",
      Vector3.Zero(),
      scene,
    );
    camera.inputs.clear();
    camera.minZ = 0.08;
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    camera.fov = (58 * Math.PI) / 180;
    camera.layerMask = WORLD_LAYER_MASK;
    camera.maxZ = Math.min(ctx.cameraFarPlaneM, MIRROR_RADIUS_M);

    const texture = new RenderTargetTexture(
      "wing-mirror",
      { width: 192, height: 128 },
      scene,
      false,
    );
    texture.activeCamera = camera;
    // A third of the rear view's rate. It is a smaller image further into the
    // corner of the eye, and staggering the two means they never both render on
    // the same frame — otherwise frame times spike in lockstep instead of
    // staying flat, which is worse than either cost on its own.
    texture.refreshRate = 3;
    texture.forceLayerMaskCheck = true;
    texture.clearColor = this.scene.clearColor.clone();
    texture.getCustomRenderList = () =>
      this.getRenderList(camera, ctx.gatherFrameState());
    this.wingMirrorTexture = texture;

    const glassMaterial = makeMaterial(
      scene,
      "wing-mirror-glass",
      Color3.White(),
      new Color3(0.62, 0.62, 0.62),
    );
    glassMaterial.diffuseTexture = texture;
    glassMaterial.emissiveTexture = texture;
    glassMaterial.disableLighting = true;

    const glass = createChamferedPanel(
      scene,
      "wing-mirror-glass",
      outline,
      COCKPIT_WING_MIRROR.glassWidth,
      COCKPIT_WING_MIRROR.glassHeight,
      glassMaterial,
      head,
    );
    glass.position.z = -0.029;
    return camera;
  }

  /** Hides the wing mirror, and stops rendering it, when the field of view has
   * pushed it off the side of the screen. */
  syncVisibility(ctx: MirrorRigCtx): void {
    const rig = this.wingMirrorRigField;
    if (!rig) return;
    const visible = wingMirrorIsVisible(
      ctx.firstCamera.fov,
      ctx.steeringSide,
    );
    if (rig.isEnabled(false) !== visible) rig.setEnabled(visible);
  }

  /**
   * Sizes the mirror quad to the viewport rectangle it stands in for.
   *
   * Must run whenever the field of view or the canvas shape changes, or the
   * image slides out from under the HUD housing drawn around it.
   */
  layoutPanels(ctx: MirrorRigCtx): void {
    const panel = this.rearViewPanelField;
    if (!panel) return;
    const distance = ctx.firstCamera.minZ * 3;
    const placement = cameraPanelPlacement(
      REAR_VIEW_VIEWPORT,
      ctx.firstCamera.fov,
      this.viewportAspectRatio(ctx),
      distance,
    );
    panel.scaling.set(placement.width, placement.height, 1);
    panel.position.set(placement.x, placement.y, distance);
    this.syncVisibility(ctx);
  }

  private viewportAspectRatio(ctx: MirrorRigCtx): number {
    const width = ctx.engineRenderWidth;
    const height = ctx.engineRenderHeight;
    return height > 0 ? width / height : 2;
  }

  /**
   * Re-gathers the ring of static meshes a mirror could possibly see.
   *
   * Amortised: only when the player has covered ground or swung round a
   * junction. The result is a candidate set of a few hundred, which
   * `updateMirrorRenderList` then frustum-tests per render.
   */
  private refreshCandidates(frame: MirrorFrameInputs): void {
    const heading = frame.displayedHeading;
    if (
      !mirrorCandidatesAreStale(
        this.mirrorGatheredX,
        this.mirrorGatheredZ,
        frame.displayedX,
        frame.displayedZ,
        heading - this.mirrorGatheredHeading,
      )
    ) {
      return;
    }
    this.mirrorGatheredX = frame.displayedX;
    this.mirrorGatheredZ = frame.displayedZ;
    this.mirrorGatheredHeading = heading;
    this.mirrorCandidates.length = 0;
    // One cone wide enough to cover every mirror on the car, rather than a ring
    // per mirror: the gather is the expensive half and the frustum test below
    // is what actually decides. A car's mirrors all point broadly backwards.
    const cells = mirrorCells(frame.shadowCellM, {
      x: frame.displayedX,
      z: frame.displayedZ,
      dirX: -Math.sin(heading),
      dirZ: -Math.cos(heading),
      halfAngleRad: (105 * Math.PI) / 180,
      radiusM: MIRROR_RADIUS_M,
    });
    for (const cell of cells) {
      const bucket = frame.shadowCasterCells.get(`${cell.cellX}:${cell.cellZ}`);
      if (!bucket) continue;
      for (const entry of bucket) this.mirrorCandidates.push(entry.mesh);
    }
  }

  /**
   * Rebuilds what a mirror actually draws, in place.
   *
   * Babylon's ObjectRenderer frustum-culls nothing — it draws whatever list it
   * is handed — so this does the job `Scene._evaluateActiveMeshes` does for a
   * real camera, but over a few hundred pre-gathered candidates instead of the
   * fifteen thousand meshes in the city. That difference is the entire reason a
   * mirror can be a render target here rather than a second full scene pass.
   */
  private getRenderList(
    camera: UniversalCamera,
    frame: MirrorFrameInputs,
  ): AbstractMesh[] {
    this.refreshCandidates(frame);
    const list = this.mirrorRenderList;
    list.length = 0;
    for (const mesh of this.mirrorAlways) list.push(mesh);
    camera.computeWorldMatrix();
    const planes = Frustum.GetPlanes(
      camera.getViewMatrix().multiply(camera.getProjectionMatrix(true)),
    );
    for (const mesh of this.mirrorCandidates) {
      if (!mesh.isEnabled()) continue;
      if (mesh.isInFrustum(planes)) list.push(mesh);
    }
    for (const mesh of frame.playerShadowCasters) list.push(mesh);
    for (const casters of frame.activeNpcShadowCasters) {
      for (const mesh of casters) {
        if (mesh.isInFrustum(planes)) list.push(mesh);
      }
    }
    return list;
  }

  registerSurface(mesh: AbstractMesh | undefined | null): void {
    if (mesh) this.mirrorAlways.push(mesh);
  }

  /**
   * Registers or withdraws the mirror render targets.
   *
   * An RTT only renders if something asks for it, and a texture used as an
   * `emissiveTexture` is never discovered by the scene — only `reflectionTexture`
   * and `refractionTexture` are. So it lives or dies by this list, which is also
   * exactly what we want: in third person there is no mirror on screen and no
   * reason to pay for one.
   */
  setActive(active: boolean): void {
    const targets = this.scene.customRenderTargets;
    active = active && this.mirrorsAllowed;
    for (const texture of [this.rearViewTexture, this.wingMirrorTexture]) {
      if (!texture) continue;
      const index = targets.indexOf(texture);
      if (active && index === -1) targets.push(texture);
      else if (!active && index !== -1) targets.splice(index, 1);
    }
  }

  dispose(): void {
    this.setActive(false);
    this.rearViewTexture?.dispose();
    this.rearViewTexture = null;
    this.wingMirrorTexture?.dispose();
    this.wingMirrorTexture = null;
    this.rearViewPanelField = null;
    this.wingMirrorRigField = null;
    this.mirrorAlways.length = 0;
    this.mirrorCandidates.length = 0;
    this.mirrorRenderList.length = 0;
  }
}
