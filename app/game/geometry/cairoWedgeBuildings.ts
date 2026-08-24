import type { GameCanvasPoint } from "../sessionContract";
import type { ProceduralLandmark } from "../types";

/**
 * Khedivial corner buildings around the six-arm Tahrir hub.
 *
 * The generated roadside rectangles deliberately stop before the hub because
 * no rectangle can follow both kerbs of an acute street sector. That left five
 * conspicuous paved wedges around the junction. These footprints occupy
 * those exact remainders: their two long walls sit 0.55 m behind the adjoining
 * sidewalk edges, their short rear wall stops before the existing street wall,
 * and the 2.2 m prow chamfer keeps the point architectural rather than
 * needle-thin. Points are clockwise, matching convex landmark collision.
 */
export interface CairoDowntownWedgeBuilding {
  readonly id: string;
  readonly footprint: readonly GameCanvasPoint[];
  readonly heightM: number;
  readonly stories: number;
  readonly color: string;
  readonly trimColor: string;
  readonly roofColor: string;
  /** The two long curb-facing polygon edges and their authored roads. */
  readonly streetEdges: readonly [
    { readonly edgeIndex: number; readonly roadId: string },
    { readonly edgeIndex: number; readonly roadId: string },
  ];
}

export const CAIRO_DOWNTOWN_WEDGE_BUILDINGS: readonly CairoDowntownWedgeBuilding[] = [
  {
    id: "cairo-downtown-wedge-northeast",
    footprint: [
      { x: 344.805, z: -89.777 },
      { x: 404.37, z: -18.616 },
      { x: 405.256, z: -87.34 },
      { x: 345.588, z: -91.318 },
    ],
    heightM: 34,
    stories: 8,
    color: "#bfa77e",
    trimColor: "#ddccaa",
    roofColor: "#68483e",
    streetEdges: [
      { edgeIndex: 0, roadId: "cairo-ramses" },
      { edgeIndex: 2, roadId: "cairo-qasr-el-nil-street" },
    ],
  },
  {
    id: "cairo-downtown-wedge-northwest",
    footprint: [
      { x: 308.3, z: -93.55 },
      { x: 284.51, z: -94.6 },
      { x: 310.16, z: -77.2 },
      { x: 310.46, z: -91.26 },
    ],
    heightM: 29,
    stories: 7,
    color: "#bda77e",
    trimColor: "#d7c8aa",
    roofColor: "#765347",
    streetEdges: [
      { edgeIndex: 0, roadId: "cairo-qasr-el-nil-street" },
      { edgeIndex: 2, roadId: "cairo-qasr-el-ainy" },
    ],
  },
  {
    id: "cairo-downtown-wedge-southwest",
    footprint: [
      { x: 307.87, z: -119.64 },
      { x: 304.5, z: -137.72 },
      { x: 285.56, z: -118.47 },
      { x: 306.07, z: -117.57 },
    ],
    heightM: 31,
    stories: 7,
    color: "#c2aa7d",
    trimColor: "#e0d0ae",
    roofColor: "#6f4b41",
    streetEdges: [
      { edgeIndex: 0, roadId: "cairo-qasr-el-ainy" },
      { edgeIndex: 2, roadId: "cairo-qasr-el-nil-street" },
    ],
  },
  {
    id: "cairo-downtown-wedge-southeast",
    footprint: [
      { x: 326.7, z: -128.6 },
      { x: 346.57, z: -154.04 },
      { x: 319.03, z: -160.76 },
      { x: 324.94, z: -129.02 },
    ],
    heightM: 33,
    stories: 8,
    color: "#b79e75",
    trimColor: "#d6c3a0",
    roofColor: "#70493e",
    streetEdges: [
      { edgeIndex: 0, roadId: "cairo-ramses" },
      { edgeIndex: 2, roadId: "cairo-qasr-el-ainy" },
    ],
  },
  {
    id: "cairo-downtown-wedge-east",
    footprint: [
      { x: 342.25, z: -115.49 },
      { x: 358.71, z: -114.4 },
      { x: 359.3, z: -140.28 },
      { x: 341.4, z: -117.37 },
    ],
    heightM: 30,
    stories: 7,
    color: "#c5af85",
    trimColor: "#dfcfaf",
    roofColor: "#765044",
    streetEdges: [
      { edgeIndex: 0, roadId: "cairo-qasr-el-nil-street" },
      { edgeIndex: 2, roadId: "cairo-ramses" },
    ],
  },
];

export function cairoDowntownWedgeBuilding(
  id: string,
): CairoDowntownWedgeBuilding | undefined {
  return CAIRO_DOWNTOWN_WEDGE_BUILDINGS.find((building) => building.id === id);
}

const landmarkBounds = (
  building: CairoDowntownWedgeBuilding,
): Pick<ProceduralLandmark, "center" | "size"> => {
  const xs = building.footprint.map((point) => point.x);
  const zs = building.footprint.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, z: maxZ - minZ },
  };
};

/** Landmark envelopes drive prop/pedestrian keep-outs; collision stays exact. */
export const CAIRO_DOWNTOWN_WEDGE_LANDMARKS: readonly ProceduralLandmark[] =
  CAIRO_DOWNTOWN_WEDGE_BUILDINGS.map((building) => ({
    id: building.id,
    kind: "shops" as const,
    ...landmarkBounds(building),
    color: building.color,
  }));
