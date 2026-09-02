import {
  Color3,
  Mesh,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBox, createCylinder } from "./meshPrimitives";
import {
  cairoBridgePortalVisualAxis,
  type CairoBridgeVisualAxis,
} from "../geometry/waterGeometry";
import { nearestPointOnPolyline } from "../geometry/roadStrips";
import type { GameCanvasMapPack } from "../sessionContract";
import { defaultSidewalkWidthM } from "../visuals";

/**
 * NYC's per-landmark dispatcher (cityRenderRegistry.ts), same `(ctx,
 * landmark, material, mapPack) => boolean` shape as `buildCairoLandmark`.
 * Bridges are the only bespoke case — parks, the gallery and the
 * subway/AMNH boxes all read fine through babylonGameSession.ts's generic
 * `landmark.kind` fallback, the same as every other city's non-bespoke
 * landmarks.
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

export interface NycLandmarkCtx {
  readonly scene: Scene;
  readonly staticSceneryFreeze: TransformNode[];
}

/** Roughly a quarter and three-quarters along the span — the classic
 * suspension-bridge tower placement. */
const PYLON_FRACTIONS = [0.28, 0.72] as const;
/** How far a cable's deck end sits from its own tower, as a share of the
 * bridge's total (over-water) length. */
const CABLE_DECK_REACH_FRACTION = 0.22;
const LAMP_SPACING_M = 26;
/** Deck-edge parapet, between the footway and the water. */
const PARAPET_HEIGHT_M = 1;
/** Kerbside guardrail, between the carriageway and the footway. */
const GUARDRAIL_HEIGHT_M = 0.5;
/** How far outboard of the deck edge a tower's centre stands. */
const PYLON_DECK_OVERHANG_M = 1;

const QUEENSVIEW_BRIDGE_ID = "nyc-queensview-bridge";
const QUEENSVIEW_TRUSS_OUTBOARD_GAP_M = 1.45;
const QUEENSVIEW_TRUSS_LOWER_DEPTH_M = 2.1;
const QUEENSVIEW_TRUSS_MID_RISE_M = 3.1;
const QUEENSVIEW_TRUSS_BASE_RISE_M = 7.4;
const QUEENSVIEW_TRUSS_TOWER_RISE_M = 14.4;
const QUEENSVIEW_TRUSS_BEAM_M = 0.24;
const QUEENSVIEW_PORTAL_CLEARANCE_M = 7.2;

type NycRoadSurface = NonNullable<
  GameCanvasMapPack["geometry"]["roadSurfaces"]
>[number];

interface QueensviewTrussStation {
  readonly alongM: number;
  readonly fraction: number;
  readonly deckElevationM: number;
  readonly lowerY: number;
  readonly midY: number;
  readonly topY: number;
}

/**
 * Samples the same authored centreline the road, collision and elevated-road
 * passes consume. Keeping the landmark root at world Y=0 means every truss
 * member can use the sampled value directly, including a sloping approach;
 * there is no independent decorative "bridge height" to drift out of sync.
 */
const queensviewDeckElevationAt = (
  surface: NycRoadSurface,
  axis: CairoBridgeVisualAxis,
  alongM: number,
): number => {
  const point = {
    x: axis.center.x + Math.sin(axis.headingRad) * alongM,
    z: axis.center.z + Math.cos(axis.headingRad) * alongM,
  };
  return nearestPointOnPolyline(point, surface.centerline).elevationM ?? 0;
};

const queensviewTowerInfluence = (fraction: number): number => {
  const nearestTower = Math.min(
    ...PYLON_FRACTIONS.map((tower) => Math.abs(fraction - tower)),
  );
  return Math.max(0, 1 - nearestTower / 0.2);
};

const queensviewTrussStations = (
  surface: NycRoadSurface,
  axis: CairoBridgeVisualAxis,
): readonly QueensviewTrussStation[] => {
  const uniformPanelCount = Math.max(10, Math.ceil(axis.lengthM / 18));
  const fractions = new Set<number>(PYLON_FRACTIONS);
  for (let index = 0; index <= uniformPanelCount; index += 1) {
    fractions.add(index / uniformPanelCount);
  }
  return [...fractions]
    .sort((first, second) => first - second)
    .map((fraction) => {
      const alongM = (fraction - 0.5) * axis.lengthM;
      const deckElevationM = queensviewDeckElevationAt(surface, axis, alongM);
      const topRiseM =
        QUEENSVIEW_TRUSS_BASE_RISE_M +
        (QUEENSVIEW_TRUSS_TOWER_RISE_M - QUEENSVIEW_TRUSS_BASE_RISE_M) *
          queensviewTowerInfluence(fraction);
      return {
        alongM,
        fraction,
        deckElevationM,
        lowerY: deckElevationM - QUEENSVIEW_TRUSS_LOWER_DEPTH_M,
        midY: deckElevationM + QUEENSVIEW_TRUSS_MID_RISE_M,
        topY: deckElevationM + topRiseM,
      };
    });
};

const createQueensviewSideBeam = (
  scene: Scene,
  name: string,
  start: readonly [number, number],
  end: readonly [number, number],
  lateralM: number,
  thicknessM: number,
  material: StandardMaterial,
  root: TransformNode,
): Mesh | null => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthM = Math.hypot(dx, dy);
  if (lengthM < 0.05) return null;
  const beam = createBox(
    scene,
    name,
    { width: lengthM, height: thicknessM, depth: thicknessM },
    new Vector3(
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      lateralM,
    ),
    material,
    root,
  );
  beam.rotation.z = Math.atan2(dy, dx);
  return beam;
};

const mergeQueensviewParts = (
  ctx: NycLandmarkCtx,
  name: string,
  parts: readonly Mesh[],
): Mesh | null => {
  if (!parts.length) return null;
  for (const part of parts) part.computeWorldMatrix(true);
  const merged = Mesh.MergeMeshes(
    [...parts],
    true,
    true,
    undefined,
    false,
    false,
  );
  if (!merged) return null;
  merged.name = name;
  merged.isPickable = false;
  // Landmark dressing is visual-only. The canonical road/barrier collision
  // remains wholly in simulationAdapter/elevatedRoadGeometry, so a lattice
  // silhouette can never grow a hidden blocker at a ramp or merge mouth.
  merged.checkCollisions = false;
  ctx.staticSceneryFreeze.push(merged);
  return merged;
};

/**
 * Queensboro-inspired double-cantilever silhouette for Queensview. It is a
 * deep, riveted-looking pair of outboard lattices rather than the suspension
 * pylons/cables used by Harborline. Roughly a hundred repeated members are
 * baked into three static meshes (steel, amber lamps, granite pier bases), so
 * the richer skyline does not become a per-panel draw-call tax.
 */
const buildQueensviewCantilever = (
  ctx: NycLandmarkCtx,
  landmarkId: string,
  axis: CairoBridgeVisualAxis,
  surface: NycRoadSurface,
): void => {
  const scene = ctx.scene;
  const root = new TransformNode(`${landmarkId}-cantilever-scratch`, scene);
  root.position.set(axis.center.x, 0, axis.center.z);
  root.rotation.y = axis.boxYawRad;
  root.computeWorldMatrix(true);

  const blackenedSteel = makeMaterial(
    scene,
    `${landmarkId}-cantilever-blackened-steel`,
    new Color3(0.035, 0.06, 0.085),
  );
  blackenedSteel.specularColor = new Color3(0.16, 0.19, 0.21);
  const granite = makeMaterial(
    scene,
    `${landmarkId}-cantilever-gray-granite`,
    new Color3(0.47, 0.48, 0.47),
  );
  const amber = makeMaterial(
    scene,
    `${landmarkId}-cantilever-amber-light`,
    new Color3(0.95, 0.61, 0.2),
    new Color3(1.45, 0.58, 0.12),
  );
  const stations = queensviewTrussStations(surface, axis);
  const trussLateralM =
    Math.max(axis.widthM, surface.widthM) / 2 +
    QUEENSVIEW_TRUSS_OUTBOARD_GAP_M;
  const steelParts: Mesh[] = [];
  const lampParts: Mesh[] = [];
  const graniteParts: Mesh[] = [];

  const addBeam = (
    name: string,
    start: readonly [number, number],
    end: readonly [number, number],
    lateralM: number,
    thicknessM = QUEENSVIEW_TRUSS_BEAM_M,
  ): void => {
    const beam = createQueensviewSideBeam(
      scene,
      `${landmarkId}-${name}`,
      start,
      end,
      lateralM,
      thicknessM,
      blackenedSteel,
      root,
    );
    if (beam) steelParts.push(beam);
  };

  for (const side of [-1, 1] as const) {
    const lateralM = side * trussLateralM;
    for (const [index, station] of stations.entries()) {
      // Vertical posts and broad joint plates make the merged silhouette read
      // as riveted heavy steel without modelling thousands of literal rivets.
      addBeam(
        `cantilever-vertical-${side}-${index}`,
        [station.alongM, station.lowerY],
        [station.alongM, station.topY],
        lateralM,
        0.34,
      );
      steelParts.push(
        createBox(
          scene,
          `${landmarkId}-cantilever-gusset-${side}-${index}`,
          { width: 0.84, height: 0.84, depth: 0.18 },
          new Vector3(station.alongM, station.midY, lateralM),
          blackenedSteel,
          root,
        ),
      );
      lampParts.push(
        createBox(
          scene,
          `${landmarkId}-cantilever-necklace-source-${side}-${index}`,
          { width: 0.24, height: 0.24, depth: 0.24 },
          new Vector3(
            station.alongM,
            station.midY + 0.38,
            lateralM - side * 0.17,
          ),
          amber,
          root,
        ),
      );

      const next = stations[index + 1];
      if (!next) continue;
      addBeam(
        `cantilever-lower-chord-${side}-${index}`,
        [station.alongM, station.lowerY],
        [next.alongM, next.lowerY],
        lateralM,
        0.38,
      );
      addBeam(
        `cantilever-mid-chord-${side}-${index}`,
        [station.alongM, station.midY],
        [next.alongM, next.midY],
        lateralM,
        0.3,
      );
      addBeam(
        `cantilever-upper-chord-${side}-${index}`,
        [station.alongM, station.topY],
        [next.alongM, next.topY],
        lateralM,
        0.42,
      );
      // X-bracing above and below the mid chord gives the bridge its dense
      // double-level cantilever read from both roadway and waterfront.
      addBeam(
        `cantilever-lower-diagonal-a-${side}-${index}`,
        [station.alongM, station.lowerY],
        [next.alongM, next.midY],
        lateralM,
      );
      addBeam(
        `cantilever-lower-diagonal-b-${side}-${index}`,
        [station.alongM, station.midY],
        [next.alongM, next.lowerY],
        lateralM,
      );
      addBeam(
        `cantilever-upper-diagonal-a-${side}-${index}`,
        [station.alongM, station.midY],
        [next.alongM, next.topY],
        lateralM,
      );
      addBeam(
        `cantilever-upper-diagonal-b-${side}-${index}`,
        [station.alongM, station.topY],
        [next.alongM, next.midY],
        lateralM,
      );
    }
  }

  for (const [towerIndex, towerFraction] of PYLON_FRACTIONS.entries()) {
    const towerStation = stations.reduce((nearest, candidate) =>
      Math.abs(candidate.fraction - towerFraction) <
      Math.abs(nearest.fraction - towerFraction)
        ? candidate
        : nearest,
    );
    // Cross-road portal beams exist only above a deliberately generous
    // clearance envelope; everything below them stays outside the full deck.
    const portalY = Math.max(
      towerStation.deckElevationM + QUEENSVIEW_PORTAL_CLEARANCE_M,
      towerStation.topY - 1.15,
    );
    steelParts.push(
      createBox(
        scene,
        `${landmarkId}-cantilever-high-portal-${towerIndex}`,
        {
          width: 0.52,
          height: 0.52,
          depth: trussLateralM * 2 + 0.35,
        },
        new Vector3(towerStation.alongM, portalY, 0),
        blackenedSteel,
        root,
      ),
    );

    const pierTopY = towerStation.lowerY - 0.25;
    if (pierTopY > 1.2) {
      for (const side of [-1, 1] as const) {
        graniteParts.push(
          createBox(
            scene,
            `${landmarkId}-cantilever-pier-source-${towerIndex}-${side}`,
            {
              width: 2.4,
              height: pierTopY,
              depth: 3.5,
            },
            new Vector3(
              towerStation.alongM,
              pierTopY / 2,
              side * trussLateralM,
            ),
            granite,
            root,
          ),
        );
      }
    }
  }

  mergeQueensviewParts(
    ctx,
    `${landmarkId}-cantilever-lattice`,
    steelParts,
  );
  mergeQueensviewParts(
    ctx,
    `${landmarkId}-cantilever-necklace-lights`,
    lampParts,
  );
  mergeQueensviewParts(
    ctx,
    `${landmarkId}-cantilever-granite-piers`,
    graniteParts,
  );
  // All source children were consumed by the merges, and no production scene
  // node should remain solely to remember the landmark's construction frame.
  root.dispose();
  blackenedSteel.freeze();
  granite.freeze();
  amber.freeze();
};

export function buildNycLandmark(
  ctx: NycLandmarkCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  _material: StandardMaterial,
  mapPack: GameCanvasMapPack,
): boolean {
  if (landmark.kind !== "bridge") return false;
  const scene = ctx.scene;
  const roadSurfaces = mapPack.geometry.roadSurfaces ?? [];
  const axis = cairoBridgePortalVisualAxis(
    landmark,
    roadSurfaces,
    mapPack.geometry.waterBodies ?? [],
    defaultSidewalkWidthM(mapPack),
  );
  const length = axis.lengthM;
  // The full deck: carriageway + both pavement bands + the parapet's own
  // clearance. `width / 2` is therefore the water's edge, and the collider
  // `simulationAdapter` emits for this portal stands on exactly that line.
  const width = axis.widthM;
  // The carriageway alone. Kept separate from `width` on purpose: the two were
  // interchangeable only while the axis ignored the pavement, and conflating
  // them is what would silently promote a 12 m bridge to 40 m towers the
  // moment the deck width started counting its footways.
  const carriagewayWidthM =
    roadSurfaces.find((surface) => surface.id === landmark.id)?.widthM ?? width;
  const bridgeSurface = roadSurfaces.find(
    (surface) => surface.id === landmark.id,
  );
  if (landmark.id === QUEENSVIEW_BRIDGE_ID && bridgeSurface) {
    // The shared elevated-road layer owns Queensview's deck, continuous
    // barriers, support clearances and road lamps. This landmark contributes
    // only the outboard cantilever identity, sampled from that same surface;
    // duplicating the old at-grade portal walls here would overlap the shared
    // barrier and put a second visual collision line at the water crossing.
    buildQueensviewCantilever(ctx, landmark.id, axis, bridgeSurface);
    return true;
  }
  const root = new TransformNode(`${landmark.id}-axis`, scene);
  root.position.set(axis.center.x, 0, axis.center.z);
  root.rotation.y = axis.boxYawRad;
  ctx.staticSceneryFreeze.push(root);

  const steel = makeMaterial(scene, `${landmark.id}-steel`, new Color3(0.3, 0.32, 0.35));
  const parapetStone = makeMaterial(scene, `${landmark.id}-parapet`, new Color3(0.4, 0.38, 0.35));
  const lampGlow = makeMaterial(
    scene,
    `${landmark.id}-lamp`,
    new Color3(0.08, 0.08, 0.07),
    new Color3(0.95, 0.82, 0.5),
  );

  // Deck-edge parapets over the over-water span only — the same clipped
  // axis the road portal itself uses, so the rails never cross the
  // shoreline carriageways.
  //
  // This is the barrier between the footway and the river, and it is drawn on
  // the same line as the `-portal-` obstacle in `simulationAdapter`: you see
  // the wall you hit. Solid and waist-high rather than a floating slab,
  // because a pedestrian deck over open water with nothing at its edge was the
  // thing that read as unfinished.
  for (const side of [-1, 1] as const) {
    const parapet = createBox(
      scene,
      `${landmark.id}-parapet-${side}`,
      { width: length, height: PARAPET_HEIGHT_M, depth: 0.22 },
      new Vector3(0, PARAPET_HEIGHT_M / 2, (side * width) / 2),
      parapetStone,
      root,
    );
    parapet.isPickable = false;
    ctx.staticSceneryFreeze.push(parapet);

    // Roadway-to-footway guardrail at the kerb. Deliberately **visual only**:
    // there is no collider here and never was, so the deck stays exactly as
    // drivable as it has always been. Adding one would wall a live
    // carriageway off from its own shoulder, which `staticColliders.test.ts`
    // is entitled to refuse — if it ever should stop a car, it has to be
    // authored as an obstacle in the adapter, not quietly grown here.
    const guardrail = createBox(
      scene,
      `${landmark.id}-guardrail-${side}`,
      { width: length, height: GUARDRAIL_HEIGHT_M, depth: 0.16 },
      new Vector3(
        0,
        GUARDRAIL_HEIGHT_M / 2,
        side * (carriagewayWidthM / 2 + 0.3),
      ),
      steel,
      root,
    );
    guardrail.isPickable = false;
    ctx.staticSceneryFreeze.push(guardrail);
  }

  // Two steel pylon towers with a low-poly cable suggestion, standing just
  // outboard of the deck edge so neither the tower nor the cables it carries
  // stands in the roadway or on the footway.
  //
  // `lateralM` must be `side * (…)` throughout: written as `(side * width)/2
  // + 1` the pair is displaced 1 m in the *same* world direction rather than
  // mirrored, which put one tower of every pair — and the low end of its
  // cables, at bumper height — 1.3 m inside the carriageway.
  const directionX = Math.sin(axis.headingRad);
  const directionZ = Math.cos(axis.headingRad);
  // Local +z of `root` in world terms, i.e. the deck's lateral axis.
  const lateralAxisX = -Math.cos(axis.headingRad);
  const lateralAxisZ = Math.sin(axis.headingRad);
  const pylonHeightM = carriagewayWidthM >= 13 ? 40 : 28;
  const deckLevelM = 0.65;
  for (const fraction of PYLON_FRACTIONS) {
    const alongM = (fraction - 0.5) * length;
    const worldX = axis.center.x + directionX * alongM;
    const worldZ = axis.center.z + directionZ * alongM;
    for (const side of [-1, 1] as const) {
      const lateralM = side * (width / 2 + PYLON_DECK_OVERHANG_M);
      // Sampled where the tower actually stands, not on the deck centreline:
      // a centreline sample is blind to lateral placement and so could never
      // have caught the mirroring bug above. A tower this deep into the
      // clipped over-water span is never really going to land on a
      // carriageway (nothing else crosses the river here), but the check
      // costs nothing and matches `cairoElevatedBridgePierPlacements`'s own
      // precedent of never trusting that assumption silently.
      const towerX = worldX + lateralAxisX * lateralM;
      const towerZ = worldZ + lateralAxisZ * lateralM;
      const blocksRoad = roadSurfaces.some((surface) => {
        if (surface.id === landmark.id) return false;
        const nearest = nearestPointOnPolyline(
          { x: towerX, z: towerZ },
          surface.centerline,
        );
        return (
          Math.hypot(towerX - nearest.x, towerZ - nearest.z) <
          surface.widthM / 2 + 1.5
        );
      });
      if (blocksRoad) continue;
      const tower = createBox(
        scene,
        `${landmark.id}-pylon-${fraction}-${side}`,
        { width: 1.4, height: pylonHeightM, depth: 1.4 },
        new Vector3(alongM, pylonHeightM / 2, lateralM),
        steel,
        root,
      );
      tower.isPickable = false;
      ctx.staticSceneryFreeze.push(tower);
      const head = createBox(
        scene,
        `${landmark.id}-pylon-head-${fraction}-${side}`,
        { width: 2, height: 1.2, depth: 1.8 },
        new Vector3(alongM, pylonHeightM - 0.6, lateralM),
        steel,
        root,
      );
      head.isPickable = false;
      ctx.staticSceneryFreeze.push(head);
      // A cable suggestion each way from the tower head down to deck
      // level — a silhouette, not a catenary sim. Held at the tower's own
      // lateral offset throughout, so the only tilt needed is in the
      // along/height plane (a single local-Z rotation).
      for (const cableSign of [-1, 1] as const) {
        const dx = cableSign * length * CABLE_DECK_REACH_FRACTION;
        const dy = deckLevelM - (pylonHeightM - 1.2);
        const cableLengthM = Math.hypot(dx, dy);
        const cable = createBox(
          scene,
          `${landmark.id}-cable-${fraction}-${side}-${cableSign}`,
          { width: cableLengthM, height: 0.12, depth: 0.12 },
          new Vector3(alongM + dx / 2, pylonHeightM - 1.2 + dy / 2, lateralM),
          steel,
          root,
        );
        cable.rotation.z = Math.atan2(dy, dx);
        cable.isPickable = false;
        ctx.staticSceneryFreeze.push(cable);
      }
    }
  }

  // Lamp posts every ~26 m along both footways, small emissive heads — a
  // night map, so the lit bridge over dark water is the point. Set inboard of
  // the parapet rather than on it: on the deck-edge line the post stands in
  // the parapet's own 0.22 m and its head hangs over the river.
  const lampCount = Math.max(2, Math.round(length / LAMP_SPACING_M));
  for (let index = 0; index <= lampCount; index += 1) {
    const alongM = -length / 2 + (index / lampCount) * length;
    for (const side of [-1, 1] as const) {
      const lateralM = side * (width / 2 - 1.2);
      const pole = createCylinder(
        scene,
        `${landmark.id}-lamp-pole-${index}-${side}`,
        { height: 3.2, diameter: 0.14, tessellation: 6 },
        new Vector3(alongM, deckLevelM + 1.6, lateralM),
        steel,
        root,
      );
      pole.isPickable = false;
      ctx.staticSceneryFreeze.push(pole);
      const head = createBox(
        scene,
        `${landmark.id}-lamp-head-${index}-${side}`,
        { width: 0.3, height: 0.3, depth: 0.3 },
        new Vector3(alongM, deckLevelM + 3.2, lateralM),
        lampGlow,
        root,
      );
      head.isPickable = false;
      ctx.staticSceneryFreeze.push(head);
    }
  }

  return true;
}
