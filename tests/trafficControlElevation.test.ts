import { NullEngine, Scene, StandardMaterial } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRailwayCrossingInstallation,
  buildSignalInstallation,
  createTrafficControlMasters,
  type TrafficControlMaterials,
  type TrafficControlRenderCtx,
} from "../app/game/render/trafficControlRender";

const engines: NullEngine[] = [];

afterEach(() => {
  while (engines.length > 0) engines.pop()?.dispose();
});

const harness = () => {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  const material = new StandardMaterial("control-material", scene);
  const materials: TrafficControlMaterials = {
    dark: material,
    pale: material,
    redLamp: material,
    amberLamp: material,
    greenLamp: material,
    stopRed: material,
    yieldGold: material,
    warningYellow: material,
    restrictedBlue: material,
  };
  const ctx: TrafficControlRenderCtx = {
    scene,
    masters: createTrafficControlMasters(),
    staticSceneryFreeze: [],
    authoredSignalHeads: [],
    railwayCrossingVisuals: [],
    optionsMapPack: undefined,
    createFlatSegment: vi.fn(() => undefined),
  };
  return { scene, materials, ctx };
};

describe("elevated traffic-control rendering", () => {
  it("offsets a signal pole, head and enforcement camera by road elevation", () => {
    const { scene, materials, ctx } = harness();
    const elevationM = 10.5;
    buildSignalInstallation(
      ctx,
      "elevated-control",
      {
        id: "north-head",
        position: { x: 4, z: 8, elevationM },
        headingDeg: 0,
        armHeadingDeg: 0,
        mounting: "mast_arm",
        style: "nyc_signal",
        role: "primary",
      },
      10,
      materials,
      {
        trafficLightIds: ["north"],
        phaseGroup: "north",
        phaseGroups: ["north"],
        style: "nyc_signal",
      },
      true,
    );

    const pole = scene.getMeshByName("elevated-control-north-head-pole");
    const head = scene.getTransformNodeByName(
      "elevated-control-north-head-head",
    );
    const camera = scene.getMeshByName(
      "prop-traffic-camera-elevated-control-north-head",
    );
    expect(pole).not.toBeNull();
    expect(head).not.toBeNull();
    expect(camera).not.toBeNull();
    expect(pole!.position.y).toBeCloseTo(elevationM + 5.4 / 2, 9);
    expect(head!.position.y).toBeGreaterThan(elevationM + 4);
    expect(camera!.position.y).toBeGreaterThan(elevationM + 4);
  });

  it("offsets the complete railway signal rig by road elevation", () => {
    const { scene, materials, ctx } = harness();
    const elevationM = 6.2;
    buildRailwayCrossingInstallation(
      ctx,
      "elevated-rail",
      {
        id: "gate",
        position: { x: 0, z: 0, elevationM },
        headingDeg: 0,
        mounting: "railway_crossing",
        style: "japan_railway",
        role: "primary",
      },
      materials,
      ["rail-light"],
    );
    const pole = scene.getMeshByName("elevated-rail-gate-rail-pole");
    const crossbuck = scene.getTransformNodeByName(
      "elevated-rail-gate-crossbuck",
    );
    const barrierPivot = ctx.railwayCrossingVisuals[0]?.barrierPivot;
    expect(pole!.position.y).toBeCloseTo(elevationM + 3.4 / 2, 9);
    expect(crossbuck?.position.y).toBeCloseTo(elevationM + 3.15, 9);
    expect(barrierPivot?.position.y).toBeCloseTo(elevationM + 1.25, 9);
  });
});
