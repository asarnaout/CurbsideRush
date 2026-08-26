import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { createBox, createCylinder, createIcoSphere, setMeshMaterial } from "./meshPrimitives";
import {
  cairoOperaTerracePolygon,
  cairoTahrirForecourtPolygon,
  cairoTahrirFurnitureLayout,
  cairoTahrirLawnPolygon,
} from "../geometry/cairoParkland";
import {
  CAIRO_ELEVATED_DECK_THICKNESS_M,
  CAIRO_ELEVATED_DECK_Y,
  CAIRO_ELEVATED_PIER_RADIUS_M,
  cairoBridgePortalVisualAxis,
  cairoBridgeVisualAxis,
  cairoElevatedBridgePierPlacements,
} from "../geometry/waterGeometry";
import { CAIRO_TAHRIR_PLAZA_RADIUS_M } from "../parkLayouts";
import { PARK_PATH_Y } from "./renderConstants";
import type { GameCanvasMapPack, GameCanvasPoint } from "../sessionContract";
import { defaultSidewalkWidthM, type MapVisualPalette } from "../visuals";
import {
  cairoDowntownWedgeBuilding,
  type CairoDowntownWedgeBuilding,
} from "../geometry/cairoWedgeBuildings";

/**
 * Original low-poly silhouettes for central Cairo's navigation anchors.
 * De-methodized out of `BabylonGameSession` (Phase 3.2) — same narrow-`ctx`
 * pattern as Phase 3.1. `buildFlatPolygonMesh`/`buildParkLawnPolygon` are
 * threaded as callbacks rather than imported directly: they are shared with
 * `buildScenarioEnvironment` itself and with roadside-prop building, and are
 * expected to move into a future parks collaborator (Phase 3.11) — every
 * caller staying agnostic to where they live now avoids a second rewrite
 * then. `staticSceneryFreeze` is passed as the live array reference (an
 * accumulator the session drains elsewhere), matching how the class itself
 * already treats it. `makeMaterial` is duplicated locally rather than
 * threaded through ctx — unlike the callbacks above it is already a plain
 * function (not a class method) with no future move planned, same house
 * convention Phase 2 used for `clamp`/`eventNow`/`setMeshMaterial`.
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

interface WedgeEdgeFrame {
  readonly a: GameCanvasPoint;
  readonly b: GameCanvasPoint;
  readonly length: number;
  readonly ux: number;
  readonly uz: number;
  /** Outward normal for a clockwise polygon. */
  readonly outX: number;
  readonly outZ: number;
}

function wedgeEdgeFrame(
  footprint: readonly GameCanvasPoint[],
  edgeIndex: number,
): WedgeEdgeFrame {
  const a = footprint[edgeIndex];
  const b = footprint[(edgeIndex + 1) % footprint.length];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) {
    throw new Error(`cairo wedge has a degenerate edge at ${edgeIndex}`);
  }
  const ux = dx / length;
  const uz = dz / length;
  return { a, b, length, ux, uz, outX: -uz, outZ: ux };
}

/** Crisp-sided convex prism in world XZ coordinates. */
function createWedgePrism(
  scene: Scene,
  name: string,
  footprint: readonly GameCanvasPoint[],
  baseY: number,
  height: number,
  material: StandardMaterial,
  parent: TransformNode,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];

  // Duplicate each facade's vertices so the corner normals stay hard rather
  // than smoothing an ornate stone building into a rounded low-poly crystal.
  for (let edge = 0; edge < footprint.length; edge += 1) {
    const a = footprint[edge];
    const b = footprint[(edge + 1) % footprint.length];
    const offset = positions.length / 3;
    positions.push(
      a.x,
      baseY,
      a.z,
      b.x,
      baseY,
      b.z,
      b.x,
      baseY + height,
      b.z,
      a.x,
      baseY + height,
      a.z,
    );
    // Babylon treats clockwise screen winding as the front of a mesh in its
    // left-handed scene. Reverse the mathematical outward winding here; the
    // computed normals still face the street. The old order culled the near
    // facade and exposed the far wall,
    // which made every shop opening look like a tunnel through the building.
    indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }

  // Footprints are clockwise; the same winding viewed in XZ points the roof
  // triangles upward in Babylon's left-handed XYZ space.
  const roofOffset = positions.length / 3;
  for (const point of footprint) positions.push(point.x, baseY + height, point.z);
  for (let index = 1; index < footprint.length - 1; index += 1) {
    indices.push(roofOffset, roofOffset + index + 1, roofOffset + index);
  }

  // Cap the underside as well. It is normally below the pavement, but a
  // complete watertight prism prevents any camera/collision edge case from
  // ever revealing an open shell.
  const floorOffset = positions.length / 3;
  for (const point of footprint) positions.push(point.x, baseY, point.z);
  for (let index = 1; index < footprint.length - 1; index += 1) {
    indices.push(floorOffset, floorOffset + index, floorOffset + index + 1);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.parent = parent;
  setMeshMaterial(mesh, material, true);
  return mesh;
}

function createWedgeEdgeBox(
  scene: Scene,
  name: string,
  frame: WedgeEdgeFrame,
  alongM: number,
  widthM: number,
  centerY: number,
  heightM: number,
  depthM: number,
  material: StandardMaterial,
  parent: TransformNode,
  extraOutsetM = 0.015,
): Mesh {
  const centerAlong = Math.max(
    widthM / 2,
    Math.min(frame.length - widthM / 2, alongM),
  );
  const outward = depthM / 2 + extraOutsetM;
  const mesh = createBox(
    scene,
    name,
    { width: widthM, height: heightM, depth: depthM },
    new Vector3(
      frame.a.x + frame.ux * centerAlong + frame.outX * outward,
      centerY,
      frame.a.z + frame.uz * centerAlong + frame.outZ * outward,
    ),
    material,
    parent,
  );
  // Local X follows the facade; local +Z points out from the clockwise shell.
  mesh.rotation.y = Math.atan2(-frame.uz, frame.ux);
  return mesh;
}

function buildDowntownWedgeBuilding(
  ctx: CairoLandmarkCtx,
  recipe: CairoDowntownWedgeBuilding,
): void {
  const scene = ctx.scene;
  const root = new TransformNode(recipe.id, scene);
  const body = makeMaterial(
    scene,
    `${recipe.id}-weathered-stone`,
    Color3.FromHexString(recipe.color),
  );
  body.specularColor = new Color3(0.025, 0.022, 0.018);
  const trim = makeMaterial(
    scene,
    `${recipe.id}-limestone-trim`,
    Color3.FromHexString(recipe.trimColor),
  );
  const roof = makeMaterial(
    scene,
    `${recipe.id}-roof`,
    Color3.FromHexString(recipe.roofColor),
  );
  const windowDark = makeMaterial(
    scene,
    `${recipe.id}-window-dark`,
    new Color3(0.045, 0.055, 0.06),
  );
  const windowWarm = makeMaterial(
    scene,
    `${recipe.id}-window-warm`,
    new Color3(0.72, 0.53, 0.24),
    new Color3(0.3, 0.2, 0.075),
  );
  const iron = makeMaterial(
    scene,
    `${recipe.id}-iron`,
    new Color3(0.075, 0.065, 0.055),
  );
  const acMaterial = makeMaterial(
    scene,
    `${recipe.id}-ac`,
    new Color3(0.62, 0.61, 0.55),
  );
  const shopGlass = makeMaterial(
    scene,
    `${recipe.id}-shop-glass`,
    new Color3(0.065, 0.09, 0.095),
    new Color3(0.025, 0.035, 0.03),
  );
  const signMaterials = [
    makeMaterial(scene, `${recipe.id}-sign-teal`, new Color3(0.07, 0.25, 0.24)),
    makeMaterial(scene, `${recipe.id}-sign-burgundy`, new Color3(0.34, 0.08, 0.075)),
    makeMaterial(scene, `${recipe.id}-sign-blue`, new Color3(0.08, 0.17, 0.34)),
    makeMaterial(scene, `${recipe.id}-sign-ochre`, new Color3(0.48, 0.29, 0.08)),
  ];

  createWedgePrism(
    scene,
    `${recipe.id}-shell`,
    recipe.footprint,
    0,
    recipe.heightM,
    body,
    root,
  );

  const streetEdgeIndices = new Set(recipe.streetEdges.map((edge) => edge.edgeIndex));
  const upperStories = recipe.stories - 1;
  const upperBandM = recipe.heightM - 5.2;
  for (let edgeIndex = 0; edgeIndex < recipe.footprint.length; edgeIndex += 1) {
    const frame = wedgeEdgeFrame(recipe.footprint, edgeIndex);
    // Ground-floor string course, top cornice and roof parapet wrap the full
    // footprint, including the narrow prow and plain rear party wall.
    for (const [suffix, y, height, depth] of [
      ["ground-band", 4.45, 0.48, 0.32],
      ["upper-cornice", recipe.heightM - 0.72, 0.72, 0.5],
      ["parapet", recipe.heightM + 0.42, 0.84, 0.38],
    ] as const) {
      createWedgeEdgeBox(
        scene,
        `${recipe.id}-${suffix}-${edgeIndex}`,
        frame,
        frame.length / 2,
        frame.length + 0.18,
        y,
        height,
        depth,
        trim,
        root,
      );
    }

    if (!streetEdgeIndices.has(edgeIndex)) continue;

    const shopCount = Math.max(1, Math.min(5, Math.floor((frame.length - 1.2) / 4.4)));
    const shopSpacing = frame.length / shopCount;
    for (let shop = 0; shop < shopCount; shop += 1) {
      const width = Math.min(3.45, shopSpacing - 0.45);
      const along = (shop + 0.5) * shopSpacing;
      createWedgeEdgeBox(
        scene,
        `${recipe.id}-shop-${edgeIndex}-${shop}`,
        frame,
        along,
        width,
        2.15,
        3.35,
        0.2,
        shopGlass,
        root,
      );
      createWedgeEdgeBox(
        scene,
        `${recipe.id}-shop-sign-${edgeIndex}-${shop}`,
        frame,
        along,
        width + 0.2,
        4.05,
        0.55,
        0.26,
        signMaterials[(shop + edgeIndex) % signMaterials.length],
        root,
      );
    }

    const bayCount = Math.max(1, Math.min(7, Math.floor((frame.length - 1.5) / 3.25)));
    const baySpacing = frame.length / bayCount;
    for (let story = 0; story < upperStories; story += 1) {
      const storyY = 5.2 + ((story + 0.52) * upperBandM) / upperStories;
      for (let bay = 0; bay < bayCount; bay += 1) {
        const along = (bay + 0.5) * baySpacing;
        const windowWidth = Math.min(1.55, baySpacing - 0.55);
        const lit = (story * 5 + bay * 3 + edgeIndex) % 9 === 2;
        createWedgeEdgeBox(
          scene,
          `${recipe.id}-window-${edgeIndex}-${story}-${bay}`,
          frame,
          along,
          windowWidth,
          storyY,
          2.35,
          0.16,
          lit ? windowWarm : windowDark,
          root,
        );

        // The reference skyline is defined as much by projecting balconies
        // and condenser boxes as by the stonework. Stagger them instead of
        // repeating one synthetic pattern across every facade.
        if (story >= 1 && story % 2 === 1 && (bay + edgeIndex) % 2 === 0) {
          const balconyWidth = Math.min(2.6, baySpacing - 0.25);
          createWedgeEdgeBox(
            scene,
            `${recipe.id}-balcony-slab-${edgeIndex}-${story}-${bay}`,
            frame,
            along,
            balconyWidth,
            storyY - 1.42,
            0.18,
            0.9,
            trim,
            root,
            0.03,
          );
          createWedgeEdgeBox(
            scene,
            `${recipe.id}-balcony-rail-${edgeIndex}-${story}-${bay}`,
            frame,
            along,
            balconyWidth,
            storyY - 1.03,
            0.62,
            0.1,
            iron,
            root,
            0.92,
          );
        } else if ((story * 7 + bay + edgeIndex) % 8 === 3) {
          createWedgeEdgeBox(
            scene,
            `${recipe.id}-ac-${edgeIndex}-${story}-${bay}`,
            frame,
            Math.min(frame.length - 0.55, along + windowWidth / 2 + 0.58),
            0.82,
            storyY - 0.42,
            0.62,
            0.42,
            acMaterial,
            root,
            0.05,
          );
        }
      }
    }

    // Pale stone pilasters hold the vertical Khedivial rhythm between the
    // crowded balconies, windows, signs and AC units.
    for (const along of [0.35, frame.length - 0.35]) {
      createWedgeEdgeBox(
        scene,
        `${recipe.id}-pilaster-${edgeIndex}-${along > 1 ? "end" : "start"}`,
        frame,
        along,
        0.38,
        (recipe.heightM + 4.6) / 2,
        recipe.heightM - 4.6,
        0.3,
        trim,
        root,
      );
    }
  }

  // One stacked bay on the chamfered prow makes the acute corner a facade,
  // not an undecorated seam between the two street walls.
  const prow = wedgeEdgeFrame(recipe.footprint, 3);
  if (prow.length > 1.25) {
    for (let story = 0; story < upperStories; story += 1) {
      const storyY = 5.2 + ((story + 0.52) * upperBandM) / upperStories;
      createWedgeEdgeBox(
        scene,
        `${recipe.id}-prow-window-${story}`,
        prow,
        prow.length / 2,
        Math.min(1.35, prow.length - 0.35),
        storyY,
        2.25,
        0.16,
        story === 2 ? windowWarm : windowDark,
        root,
      );
    }
  }

  // A compact corner pavilion and shallow terracotta cap recreate the varied
  // roofline in the reference without pushing ground collision toward a road.
  const prowX = (recipe.footprint[0].x + recipe.footprint[3].x) / 2;
  const prowZ = (recipe.footprint[0].z + recipe.footprint[3].z) / 2;
  createCylinder(
    scene,
    `${recipe.id}-corner-pavilion`,
    { height: 2.8, diameterBottom: 3.8, diameterTop: 3.2, tessellation: 8 },
    new Vector3(prowX, recipe.heightM + 1.8, prowZ),
    trim,
    root,
  );
  createCylinder(
    scene,
    `${recipe.id}-corner-cap`,
    { height: 2.3, diameterBottom: 3.65, diameterTop: 0.35, tessellation: 8 },
    new Vector3(prowX, recipe.heightM + 4.35, prowZ),
    roof,
    root,
  );

  ctx.staticSceneryFreeze.push(root);
}

export interface CairoLandmarkCtx {
  readonly scene: Scene;
  readonly visualPalette: MapVisualPalette;
  readonly staticSceneryFreeze: TransformNode[];
  readonly buildFlatPolygonMesh: (
    id: string,
    polygon: readonly GameCanvasPoint[],
    y: number,
    material: StandardMaterial,
  ) => Mesh | undefined;
  readonly buildParkLawnPolygon: (
    id: string,
    polygon: readonly GameCanvasPoint[],
    palette: MapVisualPalette,
    mapId: string,
  ) => Mesh | undefined;
}

/**
 * Original low-poly silhouettes for central Cairo's navigation anchors.
 * These are impressionistic procedural forms, not imported replicas.
 */
export function buildCairoLandmark(
  ctx: CairoLandmarkCtx,
  landmark: GameCanvasMapPack["geometry"]["landmarks"][number],
  material: StandardMaterial,
  mapPack: GameCanvasMapPack,
): boolean {
  const scene = ctx.scene;
  const downtownWedge = cairoDowntownWedgeBuilding(landmark.id);
  if (downtownWedge) {
    buildDowntownWedgeBuilding(ctx, downtownWedge);
    return true;
  }
  const paleStone = makeMaterial(
    scene,
    `${landmark.id}-pale-stone`,
    new Color3(0.78, 0.7, 0.56),
  );
  const darkWindow = makeMaterial(
    scene,
    `${landmark.id}-window`,
    new Color3(0.1, 0.19, 0.21),
  );
  const bronze = makeMaterial(
    scene,
    `${landmark.id}-bronze`,
    new Color3(0.36, 0.25, 0.14),
  );

  if (landmark.id === "cairo-tahrir-square") {
    const paving = makeMaterial(
      scene,
      `${landmark.id}-paving`,
      new Color3(0.63, 0.57, 0.47),
    );
    const oliveLeaf = makeMaterial(
      scene,
      `${landmark.id}-olive-leaf`,
      new Color3(0.3, 0.4, 0.24),
    );
    // Tahrir's garden is the same grass as every other park's — it just has a
    // paved plaza laid over its middle. It intercepts the generic park branch
    // for its furniture, so without this it would keep the flat untextured
    // slab the rest of the map's greenery has now left behind. The lawn is
    // the clipped polygon, not the authored rectangle: Ramses runs through
    // the rectangle, and the raw rect surfaced as grass past the far kerb.
    ctx.buildParkLawnPolygon(
      landmark.id,
      cairoTahrirLawnPolygon(landmark, mapPack.geometry.roadSurfaces ?? []),
      ctx.visualPalette,
      mapPack.id.toLowerCase(),
    );
    // The obelisk landmark's centre IS the plaza centre — disc, benches
    // and olives all ring it, so re-authoring the landmark moves the whole
    // ensemble together.
    const plazaCenter =
      mapPack.geometry.landmarks.find(
        (candidate) => candidate.id === "cairo-tahrir-obelisk",
      )?.center ?? landmark.center;
    // Top face lands exactly on PARK_PATH_Y, inside the park's 0.02–0.0435
    // band like every other in-park paving. The previous disc topped out at
    // 0.0725 — above the road surface itself — so wherever it overhung a
    // road it drew ON TOP of the asphalt.
    createCylinder(
      scene,
      `${landmark.id}-central-plaza`,
      {
        height: 0.022,
        diameter: CAIRO_TAHRIR_PLAZA_RADIUS_M * 2,
        tessellation: 32,
      },
      new Vector3(plazaCenter.x, PARK_PATH_Y - 0.011, plazaCenter.z),
      paving,
    ).isPickable = false;
    const furniture = cairoTahrirFurnitureLayout(
      plazaCenter,
      mapPack.geometry.roadSurfaces ?? [],
    );
    for (const [index, position] of furniture.olives.entries()) {
      const trunk = createCylinder(
        scene,
        `${landmark.id}-olive-${index}-trunk`,
        {
          height: 2.2,
          diameterTop: 0.24,
          diameterBottom: 0.36,
          tessellation: 7,
        },
        new Vector3(position.x, 1.1, position.z),
        bronze,
      );
      trunk.isPickable = false;
      const crown = createIcoSphere(
        scene,
        `${landmark.id}-olive-${index}-crown`,
        1.45,
        new Vector3(position.x, 2.75, position.z),
        oliveLeaf,
      );
      crown.scaling.set(1.25, 0.72, 1);
      crown.isPickable = false;
    }
    for (const [index, position] of furniture.benches.entries()) {
      const bench = new TransformNode(`${landmark.id}-bench-${index}`, scene);
      bench.position.set(position.x, 0, position.z);
      bench.rotation.y = position.rotationY;
      createBox(
        scene,
        `${landmark.id}-bench-${index}-seat`,
        { width: 2.5, height: 0.18, depth: 0.52 },
        new Vector3(0, 0.58, 0),
        bronze,
        bench,
      ).isPickable = false;
      createBox(
        scene,
        `${landmark.id}-bench-${index}-back`,
        { width: 2.5, height: 0.62, depth: 0.14 },
        new Vector3(0, 0.9, 0.24),
        bronze,
        bench,
      ).isPickable = false;
    }
    return true;
  }

  if (landmark.id === "cairo-tower") {
    const height = 44;
    createCylinder(
      scene,
      `${landmark.id}-core`,
      {
        height: height - 8,
        diameterTop: 3.2,
        diameterBottom: 5.2,
        tessellation: 12,
      },
      new Vector3(landmark.center.x, (height - 8) / 2, landmark.center.z),
      paleStone,
    );
    // Slender ribs and horizontal collars suggest the tower's open lotus
    // lattice while staying within the game's bold low-poly language.
    for (let rib = 0; rib < 8; rib += 1) {
      const angle = (rib / 8) * Math.PI * 2;
      createCylinder(
        scene,
        `${landmark.id}-rib-${rib}`,
        {
          height: height - 9,
          diameterTop: 0.28,
          diameterBottom: 0.42,
          tessellation: 6,
        },
        new Vector3(
          landmark.center.x + Math.sin(angle) * 2.15,
          (height - 9) / 2,
          landmark.center.z + Math.cos(angle) * 2.15,
        ),
        material,
      );
    }
    for (const y of [8, 15, 22, 29]) {
      createCylinder(
        scene,
        `${landmark.id}-collar-${y}`,
        { height: 0.34, diameter: 5.1, tessellation: 12 },
        new Vector3(landmark.center.x, y, landmark.center.z),
        material,
      );
    }
    createCylinder(
      scene,
      `${landmark.id}-pod`,
      {
        height: 4.2,
        diameterTop: 8.1,
        diameterBottom: 6.1,
        tessellation: 16,
      },
      new Vector3(landmark.center.x, height - 6.2, landmark.center.z),
      darkWindow,
    );
    createCylinder(
      scene,
      `${landmark.id}-crown`,
      {
        height: 2.4,
        diameterTop: 5.2,
        diameterBottom: 8.2,
        tessellation: 16,
      },
      new Vector3(landmark.center.x, height - 2.9, landmark.center.z),
      paleStone,
    );
    createCylinder(
      scene,
      `${landmark.id}-antenna`,
      { height: 8, diameterTop: 0.1, diameterBottom: 0.38, tessellation: 8 },
      new Vector3(landmark.center.x, height + 2.2, landmark.center.z),
      bronze,
    );
    return true;
  }

  if (landmark.id === "cairo-egyptian-museum") {
    const height = 10;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height, depth: landmark.size.z },
      new Vector3(landmark.center.x, height / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-central-pavilion`,
      {
        width: Math.max(10, landmark.size.x * 0.27),
        height: height + 3,
        depth: landmark.size.z + 1.1,
      },
      new Vector3(landmark.center.x, (height + 3) / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-cornice`,
      {
        width: landmark.size.x + 1.2,
        height: 0.75,
        depth: landmark.size.z + 1.2,
      },
      new Vector3(landmark.center.x, height + 0.15, landmark.center.z),
      paleStone,
    );
    const facadeZ = landmark.center.z - landmark.size.z / 2 - 0.11;
    for (let bay = -4; bay <= 4; bay += 1) {
      if (bay === 0) continue;
      createBox(
        scene,
        `${landmark.id}-window-${bay}`,
        { width: 2.1, height: 3, depth: 0.18 },
        new Vector3(
          landmark.center.x + bay * (landmark.size.x / 10),
          5.8,
          facadeZ,
        ),
        darkWindow,
      );
    }
    createBox(
      scene,
      `${landmark.id}-entrance`,
      { width: 4.5, height: 5.5, depth: 0.28 },
      new Vector3(landmark.center.x, 3.2, facadeZ - 0.1),
      darkWindow,
    );
    return true;
  }

  // The Mogamma-inspired government slab that closes Tahrir's northern
  // horizon (the landmark comment in cairoContent.ts has the urban story).
  // Same cost class and idiom as the Egyptian Museum branch: boxes, one
  // cylinder run for the colonnade, no shadow casters. Every dimension
  // derives from the landmark so re-authoring its rect reshapes the
  // building instead of stranding it.
  if (landmark.id === "cairo-abou-ela-mosque") {
    // Impressionistic Bulaq mosque: plinth, arcaded hall, pointed Mamluk
    // dome on an octagonal drum, and the minaret with its green night ring —
    // the one light every Egyptian mosque shows after dark. The front faces
    // -x, toward Haret Abou Al Ela.
    const cx = landmark.center.x;
    const cz = landmark.center.z;
    // Egyptian mosques are the most floodlit buildings in the country, and
    // a plain diffuse wall reads as a silhouette under the night rig (the
    // cockpit's own black-ambient lesson) — so every stone surface carries
    // a small warm emissive of its own.
    const stone = makeMaterial(
      scene,
      `${landmark.id}-stone`,
      new Color3(0.72, 0.64, 0.5),
      new Color3(0.155, 0.115, 0.06),
    );
    const domeStone = makeMaterial(
      scene,
      `${landmark.id}-dome`,
      new Color3(0.62, 0.56, 0.46),
      new Color3(0.1, 0.08, 0.05),
    );
    const neonGreen = makeMaterial(
      scene,
      `${landmark.id}-neon`,
      new Color3(0.05, 0.14, 0.08),
      new Color3(0.24, 0.98, 0.45),
    );
    const lampWarm = makeMaterial(
      scene,
      `${landmark.id}-portal-glow`,
      new Color3(0.16, 0.1, 0.05),
      new Color3(0.88, 0.6, 0.28),
    );
    // Plinth and hall.
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height: 0.7, depth: landmark.size.z },
      new Vector3(cx, 0.35, cz),
      paleStone,
    );
    createBox(
      scene,
      `${landmark.id}-hall`,
      { width: 17, height: 7.6, depth: 14 },
      new Vector3(cx + 2.5, 0.7 + 3.8, cz),
      stone,
    );
    // Arcaded front (-x): three dark arches with a warm glow in the centre one.
    for (const bay of [-1, 0, 1] as const) {
      createBox(
        scene,
        `${landmark.id}-arch-${bay}`,
        { width: 0.2, height: 4.4, depth: 2.6 },
        new Vector3(cx + 2.5 - 8.6, 0.7 + 2.2, cz + bay * 4),
        bay === 0 ? lampWarm : darkWindow,
      );
    }
    // Drum and pointed dome, set toward the hall's east half.
    createCylinder(
      scene,
      `${landmark.id}-drum`,
      { height: 2.2, diameter: 8.6, tessellation: 8 },
      new Vector3(cx + 4.5, 0.7 + 7.6 + 1.1, cz),
      stone,
    );
    createCylinder(
      scene,
      `${landmark.id}-dome-lower`,
      { height: 3.4, diameterBottom: 8.2, diameterTop: 4.6, tessellation: 8 },
      new Vector3(cx + 4.5, 0.7 + 9.8 + 1.7, cz),
      domeStone,
    );
    createCylinder(
      scene,
      `${landmark.id}-dome-tip`,
      { height: 2.6, diameterBottom: 4.6, diameterTop: 0.5, tessellation: 8 },
      new Vector3(cx + 4.5, 0.7 + 13.2 + 1.3, cz),
      domeStone,
    );
    // Minaret at the south-west corner, where the alley sees it end-on.
    const mx = cx - 8.5;
    const mz = cz - 6.5;
    createBox(
      scene,
      `${landmark.id}-minaret-base`,
      { width: 2.8, height: 4.2, depth: 2.8 },
      new Vector3(mx, 0.7 + 2.1, mz),
      stone,
    );
    createCylinder(
      scene,
      `${landmark.id}-minaret-shaft`,
      { height: 13.5, diameter: 2.05, tessellation: 8 },
      new Vector3(mx, 0.7 + 4.2 + 6.75, mz),
      stone,
    );
    createCylinder(
      scene,
      `${landmark.id}-minaret-balcony`,
      { height: 0.55, diameter: 3.1, tessellation: 8 },
      new Vector3(mx, 0.7 + 17.9, mz),
      paleStone,
    );
    // The green neon ring under the balcony — the night signature.
    createCylinder(
      scene,
      `${landmark.id}-minaret-neon`,
      { height: 0.42, diameter: 2.35, tessellation: 8 },
      new Vector3(mx, 0.7 + 17.35, mz),
      neonGreen,
    );
    createCylinder(
      scene,
      `${landmark.id}-minaret-upper`,
      { height: 4.4, diameter: 1.5, tessellation: 8 },
      new Vector3(mx, 0.7 + 18.2 + 2.2, mz),
      stone,
    );
    createCylinder(
      scene,
      `${landmark.id}-minaret-cap`,
      { height: 2.7, diameterBottom: 1.9, diameterTop: 0.1, tessellation: 8 },
      new Vector3(mx, 0.7 + 22.6 + 1.35, mz),
      domeStone,
    );
    createCylinder(
      scene,
      `${landmark.id}-minaret-tip-neon`,
      { height: 0.3, diameter: 0.9, tessellation: 8 },
      new Vector3(mx, 0.7 + 22.45, mz),
      neonGreen,
    );
    return true;
  }

  if (landmark.id === "cairo-tahrir-ministries") {
    const centralWidth = landmark.size.x * 0.5;
    const wingWidth = landmark.size.x * 0.25;
    const centralHeight = 30;
    const wingHeight = 22;
    const southFaceZ = landmark.center.z - landmark.size.z / 2;
    const forecourtPaving = makeMaterial(
      scene,
      `${landmark.id}-forecourt-paving`,
      new Color3(0.63, 0.57, 0.47),
    );
    createBox(
      scene,
      landmark.id,
      {
        width: centralWidth,
        height: centralHeight,
        depth: landmark.size.z,
      },
      new Vector3(landmark.center.x, centralHeight / 2, landmark.center.z),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-cornice`,
      { width: centralWidth + 1.2, height: 0.75, depth: landmark.size.z + 1.2 },
      new Vector3(landmark.center.x, centralHeight + 0.15, landmark.center.z),
      paleStone,
    );
    for (const side of [-1, 1] as const) {
      const wingX =
        landmark.center.x + side * (landmark.size.x / 2 - wingWidth / 2);
      // Wing faces sit 3 m behind the central face and 8 m lower — the
      // staggered silhouette keeps a 44 m slab from reading as one box.
      createBox(
        scene,
        `${landmark.id}-wing-${side}`,
        {
          width: wingWidth,
          height: wingHeight,
          depth: landmark.size.z - 4,
        },
        new Vector3(wingX, wingHeight / 2, landmark.center.z + 1),
        material,
      );
      createBox(
        scene,
        `${landmark.id}-wing-cornice-${side}`,
        {
          width: wingWidth + 1.2,
          height: 0.75,
          depth: landmark.size.z - 4 + 1.2,
        },
        new Vector3(wingX, wingHeight + 0.15, landmark.center.z + 1),
        paleStone,
      );
      // Two tiers of two bays per wing.
      for (const tier of [10, 16]) {
        for (const bay of [-1, 1] as const) {
          createBox(
            scene,
            `${landmark.id}-wing-window-${side}-${tier}-${bay}`,
            { width: 2.1, height: 3, depth: 0.18 },
            new Vector3(
              wingX + bay * 2.75,
              tier,
              landmark.center.z + 1 - (landmark.size.z - 4) / 2 - 0.11,
            ),
            darkWindow,
          );
        }
      }
    }
    // Four tiers of five bays on the central mass's park-facing face.
    for (const [tierIndex, tier] of [12, 16.5, 21, 25.5].entries()) {
      for (let bay = -2; bay <= 2; bay += 1) {
        if (bay === 0 && tierIndex === 0) continue; // the entrance's bay
        createBox(
          scene,
          `${landmark.id}-window-${tierIndex}-${bay}`,
          { width: 2.1, height: 3, depth: 0.18 },
          new Vector3(
            landmark.center.x + bay * (centralWidth / 5.5),
            tier,
            southFaceZ - 0.11,
          ),
          darkWindow,
        );
      }
    }
    // Portico: nine columns, an entablature, the recessed entrance.
    const porticoZ = southFaceZ - 1.1;
    for (let column = -4; column <= 4; column += 1) {
      createCylinder(
        scene,
        `${landmark.id}-column-${column}`,
        { height: 8, diameter: 0.9, tessellation: 8 },
        new Vector3(
          landmark.center.x + column * (centralWidth / 8.8),
          4,
          porticoZ,
        ),
        paleStone,
      );
    }
    createBox(
      scene,
      `${landmark.id}-entablature`,
      { width: centralWidth - 0.5, height: 1.1, depth: 1.6 },
      new Vector3(landmark.center.x, 8.55, porticoZ),
      paleStone,
    );
    createBox(
      scene,
      `${landmark.id}-entrance`,
      { width: 6, height: 7, depth: 0.28 },
      new Vector3(landmark.center.x, 3.5, southFaceZ - 0.11),
      darkWindow,
    );
    for (const side of [-1, 1] as const) {
      createBox(
        scene,
        `${landmark.id}-door-${side}`,
        { width: 1.4, height: 3.6, depth: 0.32 },
        new Vector3(landmark.center.x + side * 1.4, 1.8, southFaceZ - 0.15),
        bronze,
      );
    }
    // The esplanade between the lawn and the frontage — the whole pocket,
    // not a slab-front apron; `cairoTahrirForecourtPolygon` explains where
    // each edge lands. Drive-over like the plaza disc: its top sits at
    // PARK_PATH_Y, below the tyre plane.
    const park = mapPack.geometry.landmarks.find(
      (candidate) => candidate.id === "cairo-tahrir-square",
    );
    ctx.buildFlatPolygonMesh(
      `${landmark.id}-forecourt`,
      cairoTahrirForecourtPolygon(
        landmark,
        park ? park.center.z + park.size.z / 2 : southFaceZ - 13.5,
        mapPack.geometry.roadSurfaces ?? [],
      ),
      PARK_PATH_Y,
      forecourtPaving,
    );
    return true;
  }

  if (landmark.id === "cairo-tahrir-obelisk") {
    createBox(
      scene,
      `${landmark.id}-plinth`,
      { width: 7, height: 1.1, depth: 7 },
      new Vector3(landmark.center.x, 0.55, landmark.center.z),
      paleStone,
    );
    createBox(
      scene,
      `${landmark.id}-base`,
      { width: 3, height: 2.2, depth: 3 },
      new Vector3(landmark.center.x, 2.15, landmark.center.z),
      material,
    );
    createCylinder(
      scene,
      `${landmark.id}-shaft`,
      {
        height: 13,
        diameterTop: 0.65,
        diameterBottom: 1.8,
        tessellation: 4,
      },
      new Vector3(landmark.center.x, 9.7, landmark.center.z),
      material,
    );
    for (const [index, offset] of [
      [-2.3, -2.3],
      [2.3, -2.3],
      [-2.3, 2.3],
      [2.3, 2.3],
    ].entries()) {
      createBox(
        scene,
        `${landmark.id}-ram-${index}`,
        { width: 1.05, height: 0.75, depth: 1.7 },
        new Vector3(
          landmark.center.x + offset[0],
          1.35,
          landmark.center.z + offset[1],
        ),
        bronze,
      );
      createCylinder(
        scene,
        `${landmark.id}-ram-head-${index}`,
        { height: 0.8, diameter: 0.72, tessellation: 8 },
        new Vector3(
          landmark.center.x + offset[0],
          1.85,
          landmark.center.z + offset[1] - 0.65,
        ),
        bronze,
      );
    }
    return true;
  }

  if (landmark.id === "cairo-opera-house") {
    // The public face is the NORTH one, onto the Opera Grounds' formal
    // garden — the walk axis arrives centred on it. It is also the face
    // the sun never reaches (+z normals are unlit under this map's sun),
    // which is why the old plain box read as a black monolith looming
    // over the park: articulation alone cannot rescue an unlit face, so
    // the stone gets a small emissive lift too. Both materials here are
    // per-landmark (`${landmark.id}-…`), so the lift cannot leak to
    // another building.
    paleStone.emissiveColor = new Color3(0.055, 0.05, 0.04);
    material.emissiveColor = new Color3(0.05, 0.047, 0.04);
    const centerX = landmark.center.x;
    const northFaceZ = landmark.center.z + landmark.size.z / 2;
    // Main hall in front, taller stage house behind — the fly-tower step
    // every opera house silhouette carries.
    const hallDepth = landmark.size.z - 14;
    const hallCenterZ = northFaceZ - hallDepth / 2;
    createBox(
      scene,
      landmark.id,
      { width: landmark.size.x, height: 9, depth: hallDepth },
      new Vector3(centerX, 4.5, hallCenterZ),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-cornice`,
      { width: landmark.size.x + 1.2, height: 0.75, depth: hallDepth + 1.2 },
      new Vector3(centerX, 9.15, hallCenterZ),
      paleStone,
    );
    const stageCenterZ = northFaceZ - hallDepth - 7;
    createBox(
      scene,
      `${landmark.id}-stage-house`,
      { width: landmark.size.x - 6, height: 13, depth: 14 },
      new Vector3(centerX, 6.5, stageCenterZ),
      material,
    );
    createBox(
      scene,
      `${landmark.id}-stage-cornice`,
      { width: landmark.size.x - 6 + 1.2, height: 0.75, depth: 15.2 },
      new Vector3(centerX, 13.15, stageCenterZ),
      paleStone,
    );
    // A set-back attic carrying the low faceted dome the real Cairo Opera
    // House wears; the icosphere's lower half is buried in the attic.
    createBox(
      scene,
      `${landmark.id}-attic`,
      { width: 22.4, height: 4, depth: 30 },
      new Vector3(centerX, 11, northFaceZ - 20),
      material,
    );
    const dome = createIcoSphere(
      scene,
      `${landmark.id}-dome`,
      8,
      new Vector3(centerX, 13, northFaceZ - 20),
      paleStone,
    );
    dome.scaling.set(1, 0.45, 1);
    // Garden colonnade: nine columns an arm's reach proud of the face,
    // side-lit even when the wall behind them is not.
    const colonnadeZ = northFaceZ + 1.1;
    for (let column = -4; column <= 4; column += 1) {
      createCylinder(
        scene,
        `${landmark.id}-column-${column}`,
        { height: 7, diameter: 0.85, tessellation: 8 },
        new Vector3(
          centerX + column * (landmark.size.x / 8.8),
          3.5,
          colonnadeZ,
        ),
        paleStone,
      );
    }
    createBox(
      scene,
      `${landmark.id}-entablature`,
      { width: landmark.size.x - 1.5, height: 1.2, depth: 1.6 },
      new Vector3(centerX, 7.6, colonnadeZ),
      paleStone,
    );
    // Ground-tier bays between the columns, the attic's window row above,
    // and the recessed entrance with its bronze doors on the axis.
    for (let bay = -4; bay <= 3; bay += 1) {
      if (bay === -1 || bay === 0) continue; // the entrance's span
      createBox(
        scene,
        `${landmark.id}-bay-${bay}`,
        { width: 2.2, height: 3.4, depth: 0.18 },
        new Vector3(
          centerX + (bay + 0.5) * (landmark.size.x / 8.8),
          4.2,
          northFaceZ + 0.11,
        ),
        darkWindow,
      );
    }
    for (let window = -2; window <= 2; window += 1) {
      createBox(
        scene,
        `${landmark.id}-attic-window-${window}`,
        { width: 2.1, height: 2.6, depth: 0.18 },
        new Vector3(centerX + window * 4, 10.8, northFaceZ - 5 + 0.11),
        darkWindow,
      );
    }
    createBox(
      scene,
      `${landmark.id}-entrance`,
      { width: 6, height: 6.4, depth: 0.28 },
      new Vector3(centerX, 3.2, northFaceZ + 0.11),
      darkWindow,
    );
    for (const side of [-1, 1] as const) {
      createBox(
        scene,
        `${landmark.id}-door-${side}`,
        { width: 1.4, height: 3.6, depth: 0.32 },
        new Vector3(centerX + side * 1.4, 1.8, northFaceZ + 0.15),
        bronze,
      );
    }
    // The terrace between the facade and the garden. The building's north
    // 12 m stand INSIDE the park rect, so without this the colonnade met
    // raw lawn; the paving runs from under the building face out past the
    // rect line to meet the axis walk, whose half-metre lap draws over it.
    const terracePaving = makeMaterial(
      scene,
      `${landmark.id}-terrace-paving`,
      new Color3(0.63, 0.57, 0.47),
    );
    ctx.buildFlatPolygonMesh(
      `${landmark.id}-terrace`,
      cairoOperaTerracePolygon(landmark, mapPack.geometry.roadSurfaces ?? []),
      PARK_PATH_Y,
      terracePaving,
    );
    return true;
  }

  // The Sixth October entry remains a semantic landmark (boat clearance,
  // authored-corridor reservations and map provenance), but its visible deck
  // is now built from the drivable RoadSurface by elevatedRoadLayer. Returning
  // here prevents the retired flat scenic slab from z-fighting the real ramped
  // carriageway.
  if (
    landmark.id === "cairo-sixth-october-bridge" ||
    landmark.id === "cairo-sixth-october-west-ramp-stub" ||
    landmark.id === "cairo-sixth-october-east-ramp-stub"
  ) {
    return true;
  }

  if (
    landmark.id === "cairo-sixth-october-west-ramp-stub" ||
    landmark.id === "cairo-sixth-october-east-ramp-stub"
  ) {
    const axis = cairoBridgeVisualAxis(
      landmark,
      mapPack.geometry.roadSurfaces ?? [],
    );
    const length = axis.lengthM;
    const width = axis.widthM;
    const deckY = CAIRO_ELEVATED_DECK_Y;
    const root = new TransformNode(`${landmark.id}-axis`, scene);
    root.position.set(axis.center.x, 0, axis.center.z);
    root.rotation.y = axis.boxYawRad;
    ctx.staticSceneryFreeze.push(root);
    const concrete = makeMaterial(
      scene,
      `${landmark.id}-concrete`,
      new Color3(0.52, 0.5, 0.44),
    );
    const expressway = makeMaterial(
      scene,
      `${landmark.id}-asphalt`,
      new Color3(0.19, 0.2, 0.2),
    );
    const lanePaint = makeMaterial(
      scene,
      `${landmark.id}-lane-paint`,
      new Color3(0.82, 0.76, 0.58),
    );
    const rampStub = landmark.id.endsWith("-ramp-stub");
    if (rampStub) {
      const highEnd = landmark.id.includes("-west-") ? 1 : -1;
      const rise = deckY - 0.42;
      const slopeLength = Math.hypot(length, rise);
      const ramp = createBox(
        scene,
        `${landmark.id}-boundary-ramp`,
        { width: slopeLength, height: 0.72, depth: width },
        new Vector3(0, (deckY + 0.42) / 2, 0),
        expressway,
        root,
      );
      ramp.rotation.z = highEnd * Math.atan2(rise, length);
      ramp.isPickable = false;
      ctx.staticSceneryFreeze.push(ramp);
      for (const side of [-1, 1]) {
        const barrier = createBox(
          scene,
          `${landmark.id}-barrier-${side}`,
          { width: slopeLength, height: 0.54, depth: 0.2 },
          new Vector3(0, 0.56, side * (width / 2 - 0.18)),
          concrete,
          ramp,
        );
        barrier.isPickable = false;
        ctx.staticSceneryFreeze.push(barrier);
      }
      concrete.freeze();
      expressway.freeze();
      lanePaint.freeze();
      return true;
    }

    const deck = createBox(
      scene,
      `${landmark.id}-raised-deck`,
      { width: length, height: CAIRO_ELEVATED_DECK_THICKNESS_M, depth: width },
      new Vector3(0, deckY, 0),
      expressway,
      root,
    );
    deck.isPickable = false;
    ctx.staticSceneryFreeze.push(deck);

    // Paired hammerhead piers make the expressway read as a continuous
    // elevated structure over both Nile channels and the urban fabric.
    const pierMaster = MeshBuilder.CreateCylinder(
      `${landmark.id}-pier-master`,
      {
        height: deckY - 0.45,
        diameterTop: 1.25,
        diameterBottom: CAIRO_ELEVATED_PIER_RADIUS_M * 2,
        tessellation: 8,
      },
      scene,
    );
    setMeshMaterial(pierMaster, concrete);
    pierMaster.isVisible = false;
    const capMaster = MeshBuilder.CreateBox(
      `${landmark.id}-pier-cap-master`,
      { width: 1.25, height: 0.55, depth: width * 0.82 },
      scene,
    );
    setMeshMaterial(capMaster, concrete);
    capMaster.isVisible = false;
    for (const pier of cairoElevatedBridgePierPlacements(
      axis,
      mapPack.geometry.roadSurfaces ?? [],
    )) {
      const column = pierMaster.createInstance(
        `${landmark.id}-pier-${pier.index}`,
      );
      column.parent = root;
      column.position.set(pier.alongM, (deckY - 0.45) / 2, 0);
      column.isPickable = false;
      ctx.staticSceneryFreeze.push(column);
      const cap = capMaster.createInstance(
        `${landmark.id}-pier-cap-${pier.index}`,
      );
      cap.parent = root;
      cap.position.set(pier.alongM, deckY - 0.55, 0);
      cap.isPickable = false;
      ctx.staticSceneryFreeze.push(cap);
    }

    for (const side of [-1, 1]) {
      const barrier = createBox(
        scene,
        `${landmark.id}-barrier-${side}`,
        { width: length, height: 0.72, depth: 0.22 },
        new Vector3(0, deckY + 0.62, side * (width / 2 - 0.2)),
        concrete,
        root,
      );
      barrier.isPickable = false;
      ctx.staticSceneryFreeze.push(barrier);
    }
    const dashCount = Math.max(4, Math.floor(length / 13));
    const dashMaster = MeshBuilder.CreateBox(
      `${landmark.id}-dash-master`,
      { width: 5.2, height: 0.035, depth: 0.14 },
      scene,
    );
    setMeshMaterial(dashMaster, lanePaint);
    dashMaster.isVisible = false;
    for (let index = 0; index < dashCount; index += 1) {
      const along =
        -length / 2 + ((index + 0.5) / dashCount) * length;
      const dash = dashMaster.createInstance(
        `${landmark.id}-dash-${index}`,
      );
      dash.parent = root;
      dash.position.set(along, deckY + 0.38, 0);
      dash.isPickable = false;
      ctx.staticSceneryFreeze.push(dash);
    }
    concrete.freeze();
    expressway.freeze();
    lanePaint.freeze();
    return true;
  }

  if (
    landmark.id === "cairo-qasr-el-nil-bridge" ||
    landmark.id === "cairo-al-galaa-bridge"
  ) {
    const axis = cairoBridgePortalVisualAxis(
      landmark,
      mapPack.geometry.roadSurfaces ?? [],
      mapPack.geometry.waterBodies ?? [],
      defaultSidewalkWidthM(mapPack),
    );
    const length = axis.lengthM;
    const width = axis.widthM;
    const root = new TransformNode(`${landmark.id}-axis`, scene);
    root.position.set(axis.center.x, 0, axis.center.z);
    root.rotation.y = axis.boxYawRad;
    for (const side of [-1, 1]) {
      const railing = createBox(
        scene,
        `${landmark.id}-railing-${side}`,
        { width: length, height: 0.42, depth: 0.16 },
        new Vector3(0, 0.63, side * width / 2),
        paleStone,
        root,
      );
      railing.isPickable = false;
    }
    const posts = Math.max(3, Math.floor(length / 12));
    for (let post = 0; post <= posts; post += 1) {
      const along = -length / 2 + (post / posts) * length;
      for (const side of [-1, 1]) {
        createCylinder(
          scene,
          `${landmark.id}-post-${post}-${side}`,
          { height: 1.05, diameter: 0.18, tessellation: 8 },
          new Vector3(along, 0.6, side * width / 2),
          bronze,
          root,
        );
      }
    }
    if (landmark.id === "cairo-qasr-el-nil-bridge") {
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) {
          createBox(
            scene,
            `${landmark.id}-lion-plinth-${end}-${side}`,
            { width: 1.5, height: 1.1, depth: 1.5 },
            new Vector3(
              end * (length / 2 - 2.2),
              0.55,
              side * (width / 2 + 0.8),
            ),
            paleStone,
            root,
          );
          createBox(
            scene,
            `${landmark.id}-lion-${end}-${side}`,
            { width: 1.05, height: 0.72, depth: 1.65 },
            new Vector3(
              end * (length / 2 - 2.2),
              1.45,
              side * (width / 2 + 0.8),
            ),
            bronze,
            root,
          );
        }
      }
    }
    return true;
  }

  return false;
}
