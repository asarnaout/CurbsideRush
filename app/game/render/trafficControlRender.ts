import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { createBox, createCylinder, setMeshMaterial } from "./meshPrimitives";
import {
  RAIL_GATE_BARRIER_LENGTH_M,
  railGateArmDirection,
} from "../geometry/railGeometry";
import {
  crosswalkStripeLayout,
  EGYPT_SIGNAL_BORDER_BARS,
  roadSurfacePlacementForMarking,
  SIGNAL_HOUSING_BOX,
  SIGNAL_MAST,
  TRAFFIC_CAMERA_BODY,
  trafficCameraPlacement,
} from "../geometry/roadFurnitureLayout";
import type {
  AuthoredSignalHeadVisual,
  GameCanvasMapPack,
  GameCanvasPoint,
  RailwayCrossingVisual,
} from "../sessionContract";

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * The physical props for lane-graph "controls": signal heads (three regional
 * styles), enforcement cameras, railway crossings, road-surface junction
 * markings (crosswalk stripes and box-junction hatching).
 * De-methodized out of `BabylonGameSession` (Phase 3.9, characterized ahead
 * of time by `tests/trafficControlCharacterization.test.tsx` — coupling 14,
 * over the plan's >= 9 threshold).
 *
 * `TrafficControlMaterials` was `interface TrafficControlMaterials` in
 * GameCanvas.tsx (module-level there too, never a class member) and moves
 * here verbatim, since this cargo is its only remaining consumer.
 * `AuthoredSignalHeadVisual` and `RailwayCrossingVisual`, by contrast, move
 * to `sessionContract.ts` rather than either file: both are built here but
 * read and mutated every frame by session-resident code (the color-cycling
 * in `updateAuthoredSignalVisuals`) that isn't part of this cargo, and
 * render/ cannot import GameCanvas.tsx (ring rule — arrows point inward
 * only), so the shared type needs a home neither side owns.
 *
 * The three memoized master meshes (signal lens, enforcement camera,
 * crosswalk stripe) were `this.signalLensMaster` etc. — read and written
 * only inside this cargo, so they don't need to be session fields at all.
 * They become `ctx.masters`, one mutable record `buildScenarioEnvironment`
 * constructs fresh (via `createTrafficControlMasters`) at the top of each
 * pass and threads through every call for that pass, rather than a
 * module-level cache: a bare module-level cache doesn't reset between
 * session rebuilds (confirmed the hard way fixing `signPostMasterCache` in
 * londonLandmarks.ts — a second visit to a city silently returned the
 * previous, by-then-disposed scene's master mesh), and a `Scene`-keyed
 * `WeakMap` would work but a per-pass object is simpler and makes the
 * lifetime obvious at the call site. `createFlatSegment` is threaded as a
 * ctx callback — it's shared well beyond this cargo (traffic-control targets,
 * route chevrons, the inline stop-line loop that stays in
 * `buildScenarioEnvironment`), not owned by any one Phase 3 file.
 */

export interface TrafficControlMaterials {
  readonly dark: StandardMaterial;
  readonly pale: StandardMaterial;
  readonly redLamp: StandardMaterial;
  readonly amberLamp: StandardMaterial;
  readonly greenLamp: StandardMaterial;
  readonly stopRed: StandardMaterial;
  readonly yieldGold: StandardMaterial;
  readonly warningYellow: StandardMaterial;
  readonly restrictedBlue: StandardMaterial;
}

export interface TrafficControlMasters {
  signalLens: Mesh | null;
  trafficCamera: Mesh | null;
  crosswalkStripe: Mesh | null;
}

export function createTrafficControlMasters(): TrafficControlMasters {
  return { signalLens: null, trafficCamera: null, crosswalkStripe: null };
}

export interface TrafficControlRenderCtx {
  readonly scene: Scene;
  readonly masters: TrafficControlMasters;
  readonly staticSceneryFreeze: TransformNode[];
  readonly authoredSignalHeads: AuthoredSignalHeadVisual[];
  readonly railwayCrossingVisuals: RailwayCrossingVisual[];
  readonly optionsMapPack: GameCanvasMapPack | undefined;
  readonly createFlatSegment: (
    name: string,
    start: GameCanvasPoint,
    end: GameCanvasPoint,
    width: number,
    y: number,
    material: StandardMaterial,
  ) => Mesh | undefined;
}

/**
 * The one mesh + one material behind every signal and railway lens in the
 * city. Each lens is a plain instance whose registered color buffer IS its
 * lamp state — lighting disabled, white emissive, so the shader's
 * per-instance color multiply lands the exact color written. The per-head
 * StandardMaterial clones this replaces (three per head) were ~750 unique
 * materials on the NYC grid, one draw call each.
 */
function getSignalLensMaster(ctx: TrafficControlRenderCtx): Mesh {
  if (ctx.masters.signalLens) return ctx.masters.signalLens;
  const material = new StandardMaterial("signal-lens-material", ctx.scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  const master = MeshBuilder.CreateCylinder(
    "signal-lens-master",
    { height: 0.1, diameter: 0.25, tessellation: 18 },
    ctx.scene,
  );
  master.material = material;
  master.isVisible = false;
  master.isPickable = false;
  master.registerInstancedBuffer(VertexBuffer.ColorKind, 4);
  master.instancedBuffers.color = new Color4(0, 0, 0, 1);
  ctx.masters.signalLens = master;
  return master;
}

/**
 * The one hidden mesh behind every enforcement camera in the city.
 *
 * Merged down to a single mesh on a single material on purpose: Babylon
 * batches instances of one mesh into one draw call, and a MultiMaterial merge
 * would have cost one per submesh per camera instead. Sixteen cameras on the
 * New York grid are therefore one draw call, and the glass on the front is an
 * instance of the signal lens master, so it joins a batch that already exists
 * and costs nothing at all.
 *
 * Built from boxes rather than a downloaded glb: the CC0 sets have generic
 * security cameras and no enforcement camera, and an imported one would have
 * carried a licence entry, a registry entry, preload weight and an art style
 * at odds with the hand-built signal head it bolts to.
 */
function getTrafficCameraMaster(
  ctx: TrafficControlRenderCtx,
  material: StandardMaterial,
): Mesh | null {
  if (ctx.masters.trafficCamera) return ctx.masters.trafficCamera;
  const { housing, hood } = TRAFFIC_CAMERA_BODY;
  const parts = [
    createBox(ctx.scene, "traffic-camera-housing", housing, Vector3.Zero(), material),
    createBox(
      ctx.scene,
      "traffic-camera-hood",
      hood,
      new Vector3(0, housing.height / 2 + hood.height / 2, -0.07),
      material,
    ),
  ];
  const master = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!master) return null;
  master.name = "prop-master-traffic-camera";
  master.isVisible = false;
  master.isPickable = false;
  ctx.masters.trafficCamera = master;
  return master;
}

/** Stands a camera on `installation`, looking back down the approach it watches. */
function buildTrafficCamera(
  ctx: TrafficControlRenderCtx,
  controlId: string,
  installation: {
    readonly position: GameCanvasPoint;
    readonly headingDeg: number;
    readonly armHeadingDeg?: number;
    readonly mounting: string;
  },
  poleHeight: number,
  armSpanM: number,
  materials: TrafficControlMaterials,
) {
  const master = getTrafficCameraMaster(ctx, materials.dark);
  if (!master) return;
  const placement = trafficCameraPlacement(installation, poleHeight, armSpanM);
  const body = master.createInstance(`prop-traffic-camera-${controlId}`);
  body.position.set(placement.x, placement.y, placement.z);
  body.rotation.y = placement.yaw;
  body.isPickable = false;
  ctx.staticSceneryFreeze.push(body);
  const lens = getSignalLensMaster(ctx).createInstance(
    `prop-traffic-camera-${controlId}-lens`,
  );
  lens.position.set(placement.lens.x, placement.lens.y, placement.lens.z);
  lens.rotation.x = Math.PI / 2;
  lens.rotation.y = placement.yaw;
  // The master lens is 0.25 across; a camera's glass is a smaller, flatter
  // disc. Its colour is the standby glow, written once — there is no flash to
  // drive, because the citation is a toast on the HUD and a camera you have
  // already passed is behind you by the time it would fire.
  lens.scaling.set(0.62, 0.6, 0.62);
  lens.isPickable = false;
  lens.instancedBuffers.color = new Color4(0.16, 0.012, 0.01, 1);
  ctx.staticSceneryFreeze.push(lens);
}

/** A lens instance parented to `head`; returns its live color handle. */
function createSignalLens(
  ctx: TrafficControlRenderCtx,
  name: string,
  head: TransformNode,
  localPosition: Vector3,
  dimColor: Color4,
  scale?: Vector3,
): Color4 {
  const lens = getSignalLensMaster(ctx).createInstance(name);
  lens.parent = head;
  lens.position.copyFrom(localPosition);
  lens.rotation.x = Math.PI / 2;
  if (scale) lens.scaling.copyFrom(scale);
  lens.isPickable = false;
  lens.instancedBuffers.color = dimColor;
  return dimColor;
}

function createSignalHead(
  ctx: TrafficControlRenderCtx,
  name: string,
  position: GameCanvasPoint,
  heading: number,
  height: number,
  materials: TrafficControlMaterials,
  runtime: Pick<
    AuthoredSignalHeadVisual,
    "controlId" | "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
  >,
) {
  const head = new TransformNode(`${name}-head`, ctx.scene);
  head.position.set(position.x, height, position.z);
  head.rotation.y = heading;
  if (runtime.style === "egypt_signal") {
    // Cairo's roadside signals commonly frame the black head in the same
    // high-contrast yellow used on the striped support poles.
    for (const bar of EGYPT_SIGNAL_BORDER_BARS) {
      createBox(
        ctx.scene,
        `${name}-egypt-frame-${bar.id}`,
        { width: bar.width, height: bar.height, depth: bar.depth },
        new Vector3(bar.x, bar.y, bar.z),
        materials.warningYellow,
        head,
      );
    }
  }
  createBox(
    ctx.scene,
    `${name}-housing`,
    {
      width: SIGNAL_HOUSING_BOX.width,
      height: SIGNAL_HOUSING_BOX.height,
      depth: SIGNAL_HOUSING_BOX.depth,
    },
    Vector3.Zero(),
    materials.dark,
    head,
  );
  ctx.authoredSignalHeads.push({
    ...runtime,
    redColor: createSignalLens(
      ctx,
      `${name}-red`,
      head,
      new Vector3(0, 0.43, -0.25),
      new Color4(0.08, 0.005, 0.005, 1),
    ),
    amberColor: createSignalLens(
      ctx,
      `${name}-amber`,
      head,
      new Vector3(0, 0, -0.25),
      new Color4(0.08, 0.04, 0.005, 1),
    ),
    greenColor: createSignalLens(
      ctx,
      `${name}-green`,
      head,
      new Vector3(0, -0.43, -0.25),
      new Color4(0.005, 0.06, 0.012, 1),
    ),
  });
}

export function buildSignalInstallation(
  ctx: TrafficControlRenderCtx,
  controlId: string,
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
  roadWidth: number,
  materials: TrafficControlMaterials,
  runtime: Pick<
    AuthoredSignalHeadVisual,
    "trafficLightIds" | "phaseGroup" | "phaseGroups" | "style"
  >,
  hasCamera: boolean,
) {
  const headHeading = degreesToRadians(installation.headingDeg);
  const armHeading = degreesToRadians(
    installation.armHeadingDeg ?? installation.headingDeg,
  );
  const base = installation.position;
  const mastArm = installation.mounting === "mast_arm";
  const poleHeight = mastArm
    ? SIGNAL_MAST.poleHeightM
    : SIGNAL_MAST.kerbsidePoleHeightM;
  createCylinder(
    ctx.scene,
    `${controlId}-${installation.id}-pole`,
    {
      height: poleHeight,
      diameter: mastArm
        ? SIGNAL_MAST.poleDiameterM
        : SIGNAL_MAST.kerbsidePoleDiameterM,
      tessellation: 14,
    },
    new Vector3(base.x, poleHeight / 2, base.z),
    materials.dark,
  );
  if (runtime.style === "egypt_signal") {
    // Thin sleeves preserve the one continuous structural pole while giving
    // it Cairo's black/yellow municipal hazard striping.
    const bandHeight = 0.52;
    for (
      let band = 0;
      (band + 0.5) * bandHeight < poleHeight;
      band += 2
    ) {
      createCylinder(
        ctx.scene,
        `${controlId}-${installation.id}-egypt-band-${band}`,
        {
          height: bandHeight,
          diameter:
            (mastArm
              ? SIGNAL_MAST.poleDiameterM
              : SIGNAL_MAST.kerbsidePoleDiameterM) + 0.018,
          tessellation: 14,
        },
        new Vector3(
          base.x,
          (band + 0.5) * bandHeight,
          base.z,
        ),
        materials.warningYellow,
      );
    }
  }
  if (mastArm) {
    const span = Math.max(4.8, Math.min(8.5, roadWidth * 0.68));
    const sideX = Math.cos(armHeading);
    const sideZ = -Math.sin(armHeading);
    const arm = createBox(
      ctx.scene,
      `${controlId}-${installation.id}-mast-arm`,
      {
        width: span,
        height: SIGNAL_MAST.armThicknessM,
        depth: SIGNAL_MAST.armThicknessM,
      },
      // Hung a full thickness below the top, so its upper surface — what the
      // camera stands on — is at `mastArmTopY(poleHeight)`.
      new Vector3(
        base.x + sideX * span / 2,
        poleHeight - SIGNAL_MAST.armThicknessM,
        base.z + sideZ * span / 2,
      ),
      materials.dark,
    );
    arm.rotation.y = armHeading;
    createSignalHead(
      ctx,
      `${controlId}-${installation.id}`,
      { x: base.x + sideX * (span - 0.45), z: base.z + sideZ * (span - 0.45) },
      headHeading,
      poleHeight - 0.95,
      materials,
      { controlId, ...runtime },
    );
    if (hasCamera) {
      buildTrafficCamera(
        ctx,
        `${controlId}-${installation.id}`,
        installation,
        poleHeight,
        span,
        materials,
      );
    }
    return;
  }
  createSignalHead(
    ctx,
    `${controlId}-${installation.id}`,
    base,
    headHeading,
    poleHeight - 0.95,
    materials,
    { controlId, ...runtime },
  );
  if (hasCamera) {
    buildTrafficCamera(
      ctx,
      `${controlId}-${installation.id}`,
      installation,
      poleHeight,
      0,
      materials,
    );
  }
}

export function buildRailwayCrossingInstallation(
  ctx: TrafficControlRenderCtx,
  controlId: string,
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
  materials: TrafficControlMaterials,
  trafficLightIds: readonly string[],
) {
  const heading = degreesToRadians(installation.headingDeg);
  const base = installation.position;
  const poleHeight = 3.4;
  createCylinder(
    ctx.scene,
    `${controlId}-${installation.id}-rail-pole`,
    { height: poleHeight, diameter: 0.18, tessellation: 14 },
    new Vector3(base.x, poleHeight / 2, base.z),
    materials.dark,
  );
  const crossbuck = new TransformNode(`${controlId}-${installation.id}-crossbuck`, ctx.scene);
  crossbuck.position.set(base.x, 3.15, base.z);
  crossbuck.rotation.y = heading;
  for (const angle of [-0.63, 0.63]) {
    const bar = createBox(
      ctx.scene,
      `${controlId}-${installation.id}-crossbuck-${angle}`,
      { width: 1.6, height: 0.14, depth: 0.08 },
      Vector3.Zero(),
      materials.pale,
      crossbuck,
    );
    bar.rotation.z = angle;
  }
  const sideX = Math.cos(heading);
  const sideZ = -Math.sin(heading);
  const lampColors: Color4[] = [];
  for (const side of [-1, 1]) {
    const lamp = getSignalLensMaster(ctx).createInstance(
      `${controlId}-${installation.id}-warning-${side}`,
    );
    lamp.position.set(
      base.x + sideX * side * 0.34,
      2.38,
      base.z + sideZ * side * 0.34,
    );
    lamp.rotation.x = Math.PI / 2;
    lamp.rotation.y = heading;
    // The master lens is 0.25across x 0.1 tall; the crossing lamp is a
    // wider, slightly deeper disc.
    lamp.scaling.set(1.4, 1.1, 1.4);
    lamp.isPickable = false;
    const color = new Color4(0.08, 0.005, 0.005, 1);
    lamp.instancedBuffers.color = color;
    lampColors.push(color);
  }
  const barrierLength = RAIL_GATE_BARRIER_LENGTH_M;
  const barrierPivot = new TransformNode(
    `${controlId}-${installation.id}-barrier-pivot`,
    ctx.scene,
  );
  barrierPivot.position.set(base.x, 1.25, base.z);
  // Aim the +X arm along the shared arm-direction contract (see
  // `railGateArmDirection` — the audit asserts the tip sweeps the
  // carriageway using the same function).
  const armDirection = railGateArmDirection(
    installation.headingDeg,
    installation.armHeadingDeg,
  );
  barrierPivot.rotation.y = Math.atan2(-armDirection.z, armDirection.x);
  const barrier = createBox(
    ctx.scene,
    `${controlId}-${installation.id}-barrier`,
    { width: barrierLength, height: 0.14, depth: 0.14 },
    new Vector3(barrierLength / 2, 0, 0),
    materials.warningYellow,
    barrierPivot,
  );
  barrier.rotation.y = 0;
  barrierPivot.rotation.z = -1.22;
  ctx.railwayCrossingVisuals.push({
    trafficLightIds,
    lampColors,
    barrierPivot,
  });
}

export function buildRoadMarkingInstallation(
  ctx: TrafficControlRenderCtx,
  mapPack: GameCanvasMapPack,
  control: GameCanvasMapPack["laneGraph"]["controls"][number],
  installation: NonNullable<
    GameCanvasMapPack["laneGraph"]["controls"][number]["installations"]
  >[number],
  laneMaterial: StandardMaterial,
  warningMaterial: StandardMaterial,
) {
  if (installation.style === "crosswalk") {
    const surfacePlacement = roadSurfacePlacementForMarking(
      mapPack,
      control,
      installation,
    );
    for (const [stripe, layout] of crosswalkStripeLayout(
      surfacePlacement.position,
      installation.headingDeg,
      surfacePlacement.widthM,
    ).entries()) {
      if (!ctx.masters.crosswalkStripe) {
        ctx.masters.crosswalkStripe = MeshBuilder.CreateBox(
          "crosswalk-stripe-master",
          { width: 1, height: 0.035, depth: 1 },
          ctx.scene,
        );
        setMeshMaterial(ctx.masters.crosswalkStripe, laneMaterial);
        ctx.masters.crosswalkStripe.isVisible = false;
      }
      const marking = ctx.masters.crosswalkStripe.createInstance(
        `${control.id}-${installation.id}-stripe-${stripe}`,
      );
      marking.position.set(layout.center.x, 0.14, layout.center.z);
      marking.rotation.y = layout.rotationY;
      marking.scaling.set(layout.widthM, 1, layout.depthM);
      marking.isPickable = false;
      ctx.staticSceneryFreeze.push(marking);
    }
    return;
  }
  if (installation.style !== "box_junction") return;
  const zones = ctx.optionsMapPack?.laneGraph.conflictZones ?? [];
  for (const zoneId of control.conflictZoneIds ?? []) {
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || zone.polygon.length < 3) continue;
    for (let index = 0; index < zone.polygon.length; index += 1) {
      ctx.createFlatSegment(
        `${control.id}-${installation.id}-box-edge-${index}`,
        zone.polygon[index],
        zone.polygon[(index + 1) % zone.polygon.length],
        0.18,
        0.145,
        warningMaterial,
      );
    }
    const minX = Math.min(...zone.polygon.map((point) => point.x));
    const maxX = Math.max(...zone.polygon.map((point) => point.x));
    const minZ = Math.min(...zone.polygon.map((point) => point.z));
    const maxZ = Math.max(...zone.polygon.map((point) => point.z));
    const span = Math.max(maxX - minX, maxZ - minZ);
    for (let offset = -span; offset <= span; offset += 3) {
      const start = { x: Math.max(minX, minX + offset), z: Math.max(minZ, minZ - offset) };
      const end = { x: Math.min(maxX, maxX + offset), z: Math.min(maxZ, maxZ - offset) };
      if (Math.hypot(end.x - start.x, end.z - start.z) > 1) {
        ctx.createFlatSegment(
          `${control.id}-${installation.id}-box-hatch-${offset}`,
          start,
          end,
          0.12,
          0.144,
          warningMaterial,
        );
      }
    }
  }
}
