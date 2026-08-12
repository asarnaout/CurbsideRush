import {
  Color3,
  DynamicTexture,
  Matrix,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBox } from "./meshPrimitives";
import {
  instantiateModel,
  isModelReady,
  PROP_MODEL_REGISTRY,
  type PropModelConfig,
} from "../modelLibrary";
import { REPAIR_SHOP_PARTS, type RepairShopSurface } from "../repairShopLayout";

/**
 * Venue/service props: the imported-model-or-procedural-fallback placement
 * pipeline, board/roof/fascia signage lettering, and the repair shop (the
 * one service building with no glb — assembled from `REPAIR_SHOP_PARTS`, the
 * same constants the collider builder reads). De-methodized out of
 * `BabylonGameSession` (Phase 3.4).
 *
 * Two ctx types, not one: `instantiateProp` (and the signage helpers it
 * calls) need only `scene`, and `instantiateProp` is also called by
 * `upgradePropsToModels` — which stays resident in `BabylonGameSession` this
 * commit — so it is exported taking the narrower `InstantiatePropCtx` rather
 * than the fuller `VenuePropsCtx` `placeProp` needs for its array
 * accumulator. `VenuePropsCtx extends InstantiatePropCtx`, so every function
 * here composes freely. `deferredProps` is passed as a live array reference,
 * matching how the class already treats it. `makeMaterial` is duplicated
 * locally per house convention.
 *
 * There used to be a second accumulator here, `buildingExclusions`,
 * collected by a `collectBuildingExclusions` call before every drive but
 * never actually read by anything downstream (every planned building
 * already excludes service/venue reservations at plan time —
 * `geometry/buildingLayout.ts` — so nothing in the render path has needed a
 * second, later keep-out check since that migration). Removed in the plan
 * `.claude/three-city-visual-gap-elimination-plan.md` Section 8.2 keep-out
 * migration; see `geometry/facadesAndKeepouts.ts`'s `BuildingReservation`
 * for the real, owner-identified replacement.
 */

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

export interface InstantiatePropCtx {
  readonly scene: Scene;
}

interface DeferredProp {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly fallback: TransformNode;
  readonly label?: string;
}

export interface VenuePropsCtx extends InstantiatePropCtx {
  readonly deferredProps: DeferredProp[];
}

/**
 * Places the low-poly building glb registered under `modelKey` at (x, z),
 * facing the road via the lane `heading` + the model's yaw offset. Returns
 * false when the key has no registered model or its glb has not preloaded,
 * signalling the caller to keep its procedural box.
 *
 * `modelKey` is usually the venue/service kind, but a venue may name a
 * variant instead so two restaurants on one map are different buildings. The
 * per-model quirks (a base slab to strip, where a name board sits) live on
 * the registry config rather than being switched on here — otherwise every
 * new variant silently inherits surgery meant for a different glb.
 */
export function instantiateProp(
  ctx: InstantiatePropCtx,
  modelKey: string,
  x: number,
  z: number,
  heading: number,
  label?: string,
): boolean {
  const config = PROP_MODEL_REGISTRY[modelKey];
  if (!config || !isModelReady(ctx.scene, config.url)) return false;
  const instance = instantiateModel(ctx.scene, config.url);
  const root = instance?.rootNodes[0] as TransformNode | undefined;
  if (!instance || !root) return false;
  const holder = new TransformNode(
    `prop-${modelKey}-${Math.round(x)}-${Math.round(z)}`,
    ctx.scene,
  );
  holder.position.set(x, config.groundY ?? 0, z);
  holder.rotation.y = heading + config.yawOffset;
  root.parent = holder;
  root.scaling.set(
    config.mirrorX ? -config.scale : config.scale,
    config.scale,
    config.scale,
  );
  if (config.stripMeshPattern) {
    // Drop a diorama base slab so the building sits on the ground like a
    // normal storefront rather than on a plinth.
    const pattern = new RegExp(config.stripMeshPattern);
    for (const mesh of root.getChildMeshes()) {
      if (pattern.test(mesh.name)) mesh.dispose();
    }
  }
  if (label && config.signBoard) {
    // The model's sign surface is known exactly (declared in native units),
    // so letter the venue name straight onto it.
    addBoardSign(ctx, holder, root, label, config.signBoard);
  } else if (label && config.roofSignMinY !== undefined) {
    // These models bake mirrored lettering; overlay a legible name on the
    // board so it reads as the venue rather than as gibberish.
    addRoofSign(ctx, holder, root, label, config.roofSignMinY);
  }
  return true;
}

/**
 * Letters the venue name onto a model's own sign surface, declared as a
 * native-units box in the registry (see PropModelConfig.signBoard). The box
 * corners are pushed through the imported root's transform into holder space
 * — which absorbs the loader's handedness flip and the registry scale — and
 * one text plane is laid a few cm proud of the face that corresponds to the
 * box's native +Z-max side (the face the model's own signage occupies; its
 * reverse is typically unpainted). The lettering is drawn on a transparent
 * texture, so what renders is red lettering sitting on the model's own board
 * rather than a pasted-on billboard.
 */
function addBoardSign(
  ctx: InstantiatePropCtx,
  holder: TransformNode,
  root: TransformNode,
  label: string,
  board: NonNullable<PropModelConfig["signBoard"]>,
): void {
  holder.computeWorldMatrix(true);
  root.computeWorldMatrix(true);
  const toHolder = Matrix.Invert(holder.getWorldMatrix());
  const toWorld = root.getWorldMatrix();
  const inHolder = (x: number, y: number, z: number) =>
    Vector3.TransformCoordinates(
      Vector3.TransformCoordinates(new Vector3(x, y, z), toWorld),
      toHolder,
    );
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const local = inHolder(
      corner & 1 ? board.max[0] : board.min[0],
      corner & 2 ? board.max[1] : board.min[1],
      corner & 4 ? board.max[2] : board.min[2],
    );
    min.minimizeInPlace(local);
    max.maximizeInPlace(local);
  }
  // Which holder-space side of the box the native front (+Z-max) face landed
  // on — the imports rotate by multiples of 90°, so it maps to a box face.
  const front = inHolder(
    (board.min[0] + board.max[0]) / 2,
    (board.min[1] + board.max[1]) / 2,
    board.max[2],
  );

  const spanX = max.x - min.x;
  const spanZ = max.z - min.z;
  const alongX = spanX >= spanZ;
  const width = alongX ? spanX : spanZ;
  const height = max.y - min.y;
  const centre = min.add(max).scale(0.5);
  const side = alongX
    ? Math.sign(front.z - centre.z)
    : Math.sign(front.x - centre.x);

  const textureHeight =
    Math.max(64, Math.round((1024 * height) / width / 2)) * 2;
  const texture = new DynamicTexture(
    `${holder.name}-board-texture`,
    { width: 1024, height: textureHeight },
    ctx.scene,
    true,
  );
  texture.hasAlpha = true;
  const context = texture.getContext();
  const text = label.toUpperCase();
  let fontSize = Math.round(textureHeight * 0.62);
  context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  while (fontSize > 40 && context.measureText(text).width > 1024 * 0.9) {
    fontSize -= 10;
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  }
  // null clear colour: the canvas stays transparent outside the glyphs.
  texture.drawText(
    text,
    null,
    null,
    `bold ${fontSize}px Figtree, Arial, sans-serif`,
    "#a63527",
    null,
    true,
  );
  texture.update();

  const material = new StandardMaterial(
    `${holder.name}-board-material`,
    ctx.scene,
  );
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  // Emissive from the same texture so the lettering reads on the night maps
  // (bloom picks it up like the rest of the signage).
  material.emissiveTexture = texture;
  material.specularColor = Color3.Black();

  const faceOffset = (alongX ? spanZ : spanX) / 2 + 0.05;
  const plane = MeshBuilder.CreatePlane(
    `${holder.name}-board-sign`,
    { width, height },
    ctx.scene,
  );
  plane.parent = holder;
  // Babylon planes face -z natively, so the +side face needs the π flip.
  if (alongX) {
    plane.position.set(centre.x, centre.y, centre.z + faceOffset * side);
    plane.rotation.y = side === 1 ? Math.PI : 0;
  } else {
    plane.position.set(centre.x + faceOffset * side, centre.y, centre.z);
    plane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
  }
  plane.material = material;
}

/**
 * Overlays a legible name on a model's roof board — used where the glb has a
 * free-standing board the venue name can cover whole (the gas station's
 * billboard). The board is found geometrically (the largest elevated thin
 * plate above `minCentreY`, in holder space so the search works at any yaw),
 * then a text plane is laid over each of its two big faces. Models whose sign
 * surface is merged into a larger primitive — invisible to this search —
 * declare it as `signBoard` instead (the diner, see addBoardSign).
 */
function addRoofSign(
  ctx: InstantiatePropCtx,
  holder: TransformNode,
  root: TransformNode,
  label: string,
  minCentreY: number,
): void {
  holder.computeWorldMatrix(true);
  const toHolder = Matrix.Invert(holder.getWorldMatrix());
  let board: { area: number; min: Vector3; max: Vector3 } | null = null;
  for (const mesh of root.getChildMeshes()) {
    mesh.computeWorldMatrix(true);
    const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const corner of corners) {
      const local = Vector3.TransformCoordinates(corner, toHolder);
      min.minimizeInPlace(local);
      max.maximizeInPlace(local);
    }
    const spanX = max.x - min.x;
    const spanY = max.y - min.y;
    const spanZ = max.z - min.z;
    const thin = Math.min(spanX, spanZ);
    const wide = Math.max(spanX, spanZ);
    const centreY = (min.y + max.y) / 2;
    if (centreY > minCentreY && spanY > 1.2 && thin < 2.2 && wide > 3) {
      const area = wide * spanY;
      if (!board || area > board.area) board = { area, min, max };
    }
  }
  if (!board) return;

  const texture = new DynamicTexture(
    `${holder.name}-sign-texture`,
    { width: 1024, height: 384 },
    ctx.scene,
    true,
  );
  const context = texture.getContext();
  const text = label.toUpperCase();
  let fontSize = 170;
  context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  while (fontSize > 40 && context.measureText(text).width > 1024 * 0.84) {
    fontSize -= 10;
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  }
  texture.drawText(
    text,
    null,
    null,
    `bold ${fontSize}px Figtree, Arial, sans-serif`,
    "#a63527",
    "#ece7da",
    true,
  );
  context.strokeStyle = "#a63527";
  context.lineWidth = 14;
  context.strokeRect(20, 20, 1024 - 40, 384 - 40);
  texture.update();

  const material = new StandardMaterial(
    `${holder.name}-sign-material`,
    ctx.scene,
  );
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.55, 0.55, 0.55);
  material.specularColor = Color3.Black();
  // Each face gets its own plane sitting proud of the opaque board, so
  // rendering both sides costs nothing and sidesteps winding-order surprises.
  material.backFaceCulling = false;

  const spanX = board.max.x - board.min.x;
  const spanZ = board.max.z - board.min.z;
  const alongX = spanX >= spanZ;
  const width = (alongX ? spanX : spanZ) * 0.94;
  const height = (board.max.y - board.min.y) * 0.86;
  const centre = board.min.add(board.max).scale(0.5);
  const faceOffset = (alongX ? spanZ : spanX) / 2 + 0.05;
  for (const side of [1, -1]) {
    const plane = MeshBuilder.CreatePlane(
      `${holder.name}-sign-${side}`,
      { width, height },
      ctx.scene,
    );
    plane.parent = holder;
    // Babylon planes face -z natively, so the +side face needs the π flip.
    if (alongX) {
      plane.position.set(centre.x, centre.y, centre.z + faceOffset * side);
      plane.rotation.y = side === 1 ? Math.PI : 0;
    } else {
      plane.position.set(centre.x + faceOffset * side, centre.y, centre.z);
      plane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    }
    plane.material = material;
  }
}

/**
 * Places a venue/station: the imported model when its glb has preloaded, else
 * the caller's procedural fallback (built under a holder node) recorded so
 * upgradePropsToModels can swap it for the model once preload finishes. The
 * environment is built during construction — before the async model preload —
 * so at first pass the model is never ready and every prop starts procedural.
 */
export function placeProp(
  ctx: VenuePropsCtx,
  kind: string,
  x: number,
  z: number,
  heading: number,
  id: string,
  buildFallback: (parent: TransformNode) => void,
  label?: string,
) {
  if (instantiateProp(ctx, kind, x, z, heading, label)) return;
  const fallback = new TransformNode(`prop-fallback-${id}`, ctx.scene);
  buildFallback(fallback);
  ctx.deferredProps.push({ kind, x, z, heading, fallback, label });
}

/**
 * Builds a repair shop out of `REPAIR_SHOP_PARTS`.
 *
 * The one service building with no glb behind it (see `repairShopLayout.ts`
 * for why), so it is assembled here from the same constants the collider
 * builder reads — which is what makes the wall you can see and the wall that
 * stops you the same wall.
 *
 * The holder is rotated by the lane **heading**, not by the lot's yaw: the
 * parts are authored in the frame `propFootprints.ts` documents, which already
 * has the service yaw offset baked in. Rotating by the full yaw would turn the
 * building a further quarter-turn out of its own colliders.
 */
export function buildRepairShop(
  ctx: InstantiatePropCtx,
  id: string,
  lot: { x: number; z: number },
  heading: number,
  label: string,
) {
  const scene = ctx.scene;
  const holder = new TransformNode(`repair-shop-${id}`, scene);
  holder.position.set(lot.x, 0, lot.z);
  holder.rotation.y = heading;

  // A workshop reads as a workshop mostly by being lit inside while the street
  // is not, so the bay surfaces carry their own emissive rather than relying on
  // a lamp that the night city's fog would swallow anyway.
  const materials: Record<RepairShopSurface, StandardMaterial> = {
    shell: makeMaterial(scene, `${id}-shell`, new Color3(0.34, 0.36, 0.4)),
    trim: makeMaterial(
      scene,
      `${id}-trim`,
      new Color3(0.82, 0.36, 0.16),
      new Color3(0.24, 0.1, 0.03),
    ),
    floor: makeMaterial(
      scene,
      `${id}-floor`,
      new Color3(0.27, 0.28, 0.3),
      new Color3(0.16, 0.14, 0.1),
    ),
    apron: makeMaterial(scene, `${id}-apron`, new Color3(0.3, 0.31, 0.33)),
    door: makeMaterial(scene, `${id}-door`, new Color3(0.24, 0.26, 0.29)),
    glass: makeMaterial(
      scene,
      `${id}-glass`,
      new Color3(0.5, 0.6, 0.66),
      new Color3(0.3, 0.34, 0.28),
    ),
    shutter: makeMaterial(scene, `${id}-shutter`, new Color3(0.55, 0.57, 0.6)),
  };

  for (const part of REPAIR_SHOP_PARTS) {
    createBox(
      scene,
      `${id}-${part.id}`,
      {
        width: part.maxX - part.minX,
        height: part.maxY - part.minY,
        depth: part.maxZ - part.minZ,
      },
      new Vector3(
        (part.minX + part.maxX) / 2,
        (part.minY + part.maxY) / 2,
        (part.minZ + part.maxZ) / 2,
      ),
      materials[part.surface],
      holder,
    );
  }

  addRepairShopSign(ctx, holder, id, label);
}

/**
 * Letters the shop's name across its fascia.
 *
 * Deliberately not `addRoofSign`'s geometric board search: that hunts for the
 * largest thin elevated plate, which on a bare shell can just as easily latch
 * onto the roof and render a name plane the size of a wall. Here the fascia is
 * a known part, so the sign is placed off the same box that draws it.
 */
function addRepairShopSign(
  ctx: InstantiatePropCtx,
  holder: TransformNode,
  id: string,
  label: string,
): void {
  const fascia = REPAIR_SHOP_PARTS.find((part) => part.id === "fascia");
  if (!fascia) return;
  // Inset so the lettering sits on the band rather than running into the
  // corners of the building.
  const width = (fascia.maxZ - fascia.minZ) * 0.86;
  const height = (fascia.maxY - fascia.minY) * 0.62;

  const textureHeight =
    Math.max(64, Math.round((1024 * height) / width / 2)) * 2;
  const texture = new DynamicTexture(
    `${id}-fascia-texture`,
    { width: 1024, height: textureHeight },
    ctx.scene,
    true,
  );
  texture.hasAlpha = true;
  const context = texture.getContext();
  const text = label.toUpperCase();
  let fontSize = Math.round(textureHeight * 0.72);
  context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  while (fontSize > 40 && context.measureText(text).width > 1024 * 0.92) {
    fontSize -= 10;
    context.font = `bold ${fontSize}px Figtree, Arial, sans-serif`;
  }
  // null clear colour: the canvas stays transparent outside the glyphs.
  texture.drawText(
    text,
    null,
    null,
    `bold ${fontSize}px Figtree, Arial, sans-serif`,
    "#f6f1e4",
    null,
    true,
  );
  texture.update();

  const material = new StandardMaterial(`${id}-fascia-material`, ctx.scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  // Emissive from the same texture so the name reads on the night maps, the
  // way every other bit of signage in the city does.
  material.emissiveTexture = texture;
  material.specularColor = Color3.Black();

  const plane = MeshBuilder.CreatePlane(
    `${id}-fascia-sign`,
    { width, height },
    ctx.scene,
  );
  plane.parent = holder;
  plane.position.set(
    fascia.minX - 0.03,
    (fascia.minY + fascia.maxY) / 2,
    (fascia.minZ + fascia.maxZ) / 2,
  );
  // A Babylon plane faces -z natively; a quarter turn about Y points it down
  // -x, which is the side the road is on in this frame.
  plane.rotation.y = Math.PI / 2;
  plane.material = material;
}
