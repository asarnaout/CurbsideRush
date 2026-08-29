// @vitest-environment jsdom

import {
  InstancedMesh,
  Mesh,
  NullEngine,
  Scene,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAIRO_FREE_DRIVE, CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { planMapBuildings } from "../app/game/geometry/buildingLayout";
import { relaxationPolicyForMap } from "../app/game/geometry/cityRelaxationPolicies";
import {
  buildCairoAdvertising,
  type CairoAdvertisingRenderOptions,
} from "../app/game/render/cairoAdvertising";

function createFake2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const sized = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4),
  });
  return {
    canvas,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width: number, height: number) => sized(width, height),
    getImageData: (_x: number, _y: number, width: number, height: number) =>
      sized(width, height),
    putImageData: noop,
  } as unknown as CanvasRenderingContext2D;
}

const buildingLayout = planMapBuildings(
  CAIRO_MAP_PACK,
  CAIRO_FREE_DRIVE.trafficSeed,
  relaxationPolicyForMap(CAIRO_MAP_PACK.id),
);
const engines: NullEngine[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...args: unknown[]
  ) {
    if (type === "2d") return createFake2dContext(this);
    return originalGetContext.apply(this, [type, ...args] as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  for (const engine of engines) engine.dispose();
});

interface RenderedAds {
  readonly engine: NullEngine;
  readonly scene: Scene;
  readonly frozen: readonly TransformNode[];
}

function renderAds(options: CairoAdvertisingRenderOptions): RenderedAds {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  const frozen: TransformNode[] = [];
  buildCairoAdvertising(
    { scene, staticSceneryFreeze: frozen, buildingLayout },
    CAIRO_MAP_PACK,
    options,
  );
  return { engine, scene, frozen };
}

function matrixFingerprint(role: string, matrix: readonly number[]): string {
  return `${role}|${matrix.map((value) => Math.fround(value)).join(",")}`;
}

function batchedRole(mesh: Mesh): string {
  const markerIndex = mesh.name.lastIndexOf("-batch-");
  if (markerIndex < 0) {
    throw new Error(`Missing Cairo advertising role on ${mesh.name}`);
  }
  return mesh.name.slice(0, markerIndex);
}

function legacyFingerprints(scene: Scene): readonly string[] {
  return scene.meshes
    .filter((mesh): mesh is InstancedMesh => mesh instanceof InstancedMesh)
    .map((instance) =>
      matrixFingerprint(
        instance.sourceMesh.name,
        Array.from(instance.computeWorldMatrix(true).asArray()),
      ),
    )
    .sort();
}

function batchedFingerprints(scene: Scene): readonly string[] {
  return scene.meshes
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.thinInstanceCount > 0,
    )
    .flatMap((mesh) => {
      const role = batchedRole(mesh);
      return mesh
        .thinInstanceGetWorldMatrices()
        .map((matrix) => matrixFingerprint(role, Array.from(matrix.asArray())));
    })
    .sort();
}

describe("Cairo advertising renderer", () => {
  it("spatially batches the exact legacy part transforms without changing roles or materials", () => {
    const legacy = renderAds({ batchStaticMeshes: false });
    const expectedFingerprints = legacyFingerprints(legacy.scene);
    expect(expectedFingerprints).toHaveLength(3_612);
    expect(legacy.scene.meshes).toHaveLength(3_664);
    expect(legacy.scene.transformNodes).toHaveLength(747);
    expect(legacy.frozen).toHaveLength(4_359);
    legacy.scene.dispose();

    const batched = renderAds({ batchStaticMeshes: true });
    const actualFingerprints = batchedFingerprints(batched.scene);
    expect(actualFingerprints).toEqual(expectedFingerprints);

    const batches = batched.scene.meshes.filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.thinInstanceCount > 0,
    );
    const masters = new Map(
      batched.scene.meshes
        .filter(
          (mesh) =>
            mesh.name.includes("-master") && !mesh.name.includes("-batch-"),
        )
        .map((mesh) => [mesh.name, mesh] as const),
    );
    for (const batch of batches) {
      const master = masters.get(batchedRole(batch));
      expect(master, batch.name).toBeDefined();
      // Babylon stores the thin-instance shader attributes on Geometry. Each
      // spatial chunk therefore needs an independent Geometry container even
      // though its immutable vertex/index payload remains identical to the
      // role master.
      expect(batch.geometry, batch.name).not.toBe(master?.geometry);
      expect(
        Array.from(batch.getVerticesData("position") ?? [], Math.fround),
        batch.name,
      ).toEqual(
        Array.from(master?.getVerticesData("position") ?? [], Math.fround),
      );
      expect(
        Array.from(batch.getVerticesData("normal") ?? [], Math.fround),
        batch.name,
      ).toEqual(
        Array.from(master?.getVerticesData("normal") ?? [], Math.fround),
      );
      expect(
        Array.from(batch.getVerticesData("uv") ?? [], Math.fround),
        batch.name,
      ).toEqual(
        Array.from(master?.getVerticesData("uv") ?? [], Math.fround),
      );
      expect(Array.from(batch.getIndices() ?? []), batch.name).toEqual(
        Array.from(master?.getIndices() ?? []),
      );
      expect(batch.material, batch.name).toBe(master?.material);
      expect(batch.renderingGroupId, batch.name).toBe(master?.renderingGroupId);
      expect(batch.receiveShadows, batch.name).toBe(master?.receiveShadows);
      expect(batch.isPickable, batch.name).toBe(false);
      expect(batch.thinInstanceEnablePicking, batch.name).toBe(false);
      expect(batch.alwaysSelectAsActiveMesh, batch.name).toBe(false);
      expect(batch.isVisible, batch.name).toBe(true);

      // Per-cell bounds retain ordinary scene frustum culling. The widest
      // installation is still far narrower than the 128 m cell allowance.
      const bounds = batch.getBoundingInfo().boundingBox;
      expect(
        bounds.maximumWorld.x - bounds.minimumWorld.x,
        batch.name,
      ).toBeLessThan(155);
      expect(
        bounds.maximumWorld.z - bounds.minimumWorld.z,
        batch.name,
      ).toBeLessThan(155);

      // `doNotSyncBoundingInfo` is deliberately enabled before installing the
      // static buffer. Prove the explicit refresh still captured the complete
      // transformed union, so a chunk cannot disappear at a frustum edge.
      const expectedMin = new Vector3(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      const expectedMax = new Vector3(
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      );
      const transformedCorner = Vector3.Zero();
      for (const matrix of batch.thinInstanceGetWorldMatrices()) {
        for (const corner of master!.getBoundingInfo().boundingBox.vectors) {
          Vector3.TransformCoordinatesToRef(corner, matrix, transformedCorner);
          expectedMin.minimizeInPlace(transformedCorner);
          expectedMax.maximizeInPlace(transformedCorner);
        }
      }
      expect(bounds.minimumWorld.x, batch.name).toBeCloseTo(expectedMin.x, 4);
      expect(bounds.minimumWorld.y, batch.name).toBeCloseTo(expectedMin.y, 4);
      expect(bounds.minimumWorld.z, batch.name).toBeCloseTo(expectedMin.z, 4);
      expect(bounds.maximumWorld.x, batch.name).toBeCloseTo(expectedMax.x, 4);
      expect(bounds.maximumWorld.y, batch.name).toBeCloseTo(expectedMax.y, 4);
      expect(bounds.maximumWorld.z, batch.name).toBeCloseTo(expectedMax.z, 4);

      // Read the actual per-instance vertex attributes consumed by the shader,
      // not only Babylon's mesh-local CPU matrix cache. Sharing these buffers
      // between chunks made most Cairo ads disappear while leaving unrelated
      // faces and supports behind.
      const cpuMatrices = batch.thinInstanceGetWorldMatrices();
      for (let column = 0; column < 4; column += 1) {
        const vertexBuffer = batch.getVertexBuffer(`world${column}`);
        expect(vertexBuffer, `${batch.name} world${column}`).not.toBeNull();
        const gpuColumn = Array.from(
          vertexBuffer?.getFloatData(batch.thinInstanceCount, true) ?? [],
        );
        const expectedColumn = cpuMatrices.flatMap((matrix) =>
          Array.from(matrix.asArray()).slice(column * 4, column * 4 + 4),
        );
        expect(gpuColumn, `${batch.name} world${column}`).toEqual(
          expectedColumn,
        );
      }
    }

    const batchesByRole = Map.groupBy(batches, batchedRole);
    for (const roleBatches of batchesByRole.values()) {
      if (roleBatches.length < 2) continue;
      expect(roleBatches[0].geometry).not.toBe(roleBatches[1].geometry);
      expect(roleBatches[0].getVertexBuffer("world0")).not.toBe(
        roleBatches[1].getVertexBuffer("world0"),
      );
    }

    expect(batched.scene.transformNodes).toHaveLength(0);
    expect(
      batched.scene.meshes.filter((mesh) => mesh instanceof InstancedMesh),
    ).toHaveLength(0);
    expect(
      batches.reduce((count, batch) => count + batch.thinInstanceCount, 0),
    ).toBe(3_612);
    expect(batches).toHaveLength(912);
    expect(batched.scene.meshes).toHaveLength(964);
    expect(batched.frozen).toHaveLength(912);
    batched.scene.dispose();
  }, 30_000);
});
