/**
 * Cairo has no pitched roofs.
 *
 * Its building stock is flat-roofed — a gable or a hip reads as European the
 * moment it lands on the street wall, which is exactly the complaint that
 * started this kit. Filename conventions are not enough of a guard: Quaternius
 * labels its `GableRoof` / `RoundRoof` variants, but the KayKit pack does not,
 * and two of its buildings that looked flat in the pack's contents sheet turned
 * out to be pitched when measured. So this measures the committed geometry.
 *
 * The model list is derived from the Cairo map pack rather than hardcoded, so a
 * new venue kind or building set is covered the day it is added.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
  VertexBuffer,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { CAIRO_MAP_PACK } from "../app/game/cairoContent";
import { PROP_MODEL_REGISTRY } from "../app/game/modelLibrary";
import { buildingSetUrls, isBuildingSetId } from "../app/game/buildingSets";

registerBuiltInLoaders();

/**
 * Two independent signals, because neither alone separates a pitched roof from
 * the things that legitimately sit on a flat one:
 *
 * - `taper` — the plan area of the top sliver over the mid-body's. A pitched
 *   roof narrows toward its ridge; a parapet does not. On its own it also flags
 *   a rooftop sign (the diner's board is a zero-depth quad, so its top slice has
 *   no plan area at all).
 * - `slope` — the share of upper-body triangle area at a roof pitch, i.e. facing
 *   neither straight up (deck, cornice) nor sideways (wall, sign, parapet).
 *
 * A hip roof can hide behind a deep cornice and score only ~10% slope, so a
 * narrow top counts as pitched only when some of that narrowing is actually
 * sloped. A rooftop sign or water tank narrows with no slope at all and passes.
 */
function roofShape(mesh: Mesh) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  if (!pos || !idx) return null;
  let maxY = -Infinity;
  let minY = Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] > maxY) maxY = pos[i];
    if (pos[i] < minY) minY = pos[i];
  }
  const height = maxY - minY;

  const planArea = (lo: number, hi: number) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let seen = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      if (y < lo || y > hi) continue;
      seen += 1;
      x0 = Math.min(x0, pos[i]);
      x1 = Math.max(x1, pos[i]);
      z0 = Math.min(z0, pos[i + 2]);
      z1 = Math.max(z1, pos[i + 2]);
    }
    return seen ? (x1 - x0) * (z1 - z0) : 0;
  };
  const body = planArea(minY + height * 0.4, minY + height * 0.6);
  const taper = body ? planArea(maxY - height * 0.06, maxY) / body : 1;

  const cut = maxY - height * 0.18;
  let sloped = 0;
  let total = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const p = [0, 1, 2].map((k) => idx[t + k] * 3);
    if (Math.max(pos[p[0] + 1], pos[p[1] + 1], pos[p[2] + 1]) < cut) continue;
    const e1 = [0, 1, 2].map((a) => pos[p[1] + a] - pos[p[0] + a]);
    const e2 = [0, 1, 2].map((a) => pos[p[2] + a] - pos[p[0] + a]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const doubleArea = Math.hypot(...n);
    if (doubleArea < 1e-9) continue;
    total += doubleArea;
    const ny = Math.abs(n[1] / doubleArea);
    if (ny > 0.17 && ny < 0.94) sloped += doubleArea;
  }
  const slope = total ? sloped / total : 0;
  return { taper, slope, pitched: slope > 0.25 || (taper < 0.75 && slope > 0.08) };
}

/** Every glb the Cairo map actually puts on the ground. */
function cairoModelUrls(): { label: string; url: string }[] {
  const pack = CAIRO_MAP_PACK;
  const urls = new Map<string, string>();
  const add = (label: string, url: string | undefined) => {
    if (url && !urls.has(url)) urls.set(url, label);
  };

  for (const venue of pack.geometry.gigVenues ?? []) {
    const key = venue.modelId ?? venue.kind;
    add(`venue:${key}`, PROP_MODEL_REGISTRY[key]?.url);
  }
  for (const service of pack.geometry.servicePoints ?? []) {
    add(`service:${service.kind}`, PROP_MODEL_REGISTRY[service.kind]?.url);
  }
  const setIds = [
    ...new Set(
      pack.geometry.blocks
        .map((block) => block.buildingSet)
        .filter((id): id is string => Boolean(id) && isBuildingSetId(id!)),
    ),
  ];
  for (const url of buildingSetUrls(setIds.filter(isBuildingSetId))) {
    add("street-wall", url);
  }
  return [...urls].map(([url, label]) => ({ url, label }));
}

const engine = new NullEngine();
const scene = new Scene(engine);

const mergedMaster = async (url: string) => {
  const buf = fs.readFileSync(path.join(process.cwd(), "public", url));
  const container = await LoadAssetContainerAsync(
    "data:model/gltf-binary;base64," + buf.toString("base64"),
    scene,
    { pluginExtension: ".glb" },
  );
  const entries = container.instantiateModelsToScene(undefined, false, {
    doNotInstantiate: true,
  });
  const root = entries.rootNodes[0];
  root.computeWorldMatrix(true);
  const meshes = root
    .getChildMeshes(false)
    .filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  for (const m of meshes) m.computeWorldMatrix(true);
  return Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
};

describe("Cairo roofs", () => {
  const models = cairoModelUrls();

  it("places at least the street wall and the venue props", () => {
    expect(models.length).toBeGreaterThan(5);
  });

  it.each(models.map((m) => [`${m.label} ${m.url}`, m.url] as const))(
    "%s has no pitched roof",
    async (_label, url) => {
      const master = await mergedMaster(url);
      expect(master, url).toBeTruthy();
      const shape = roofShape(master!)!;
      expect(
        shape.pitched,
        `${url}: taper=${shape.taper.toFixed(2)} slope=${(shape.slope * 100).toFixed(0)}%`,
      ).toBe(false);
      master!.dispose();
    },
  );

  // Guards the detector itself. office.glb is Quaternius's "Big Building" — the
  // hipped-roof block Cairo used to place 12 times, and the reason this file
  // exists. If the detector stops catching it, it is not measuring anything.
  it("still recognises the pitched roof it was written to catch", async () => {
    for (const url of ["/models/props/office.glb", "/models/props/residence.glb"]) {
      const master = await mergedMaster(url);
      expect(roofShape(master!)!.pitched, url).toBe(true);
      master!.dispose();
    }
  });
});
