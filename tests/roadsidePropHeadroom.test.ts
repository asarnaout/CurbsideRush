import { NullEngine, Scene, type TransformNode } from "@babylonjs/core";
import { describe, expect, it } from "vitest";

import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { createElevatedRoadDeckHeadroomQuery } from "../app/game/geometry/elevatedRoadGeometry";
import { isElevatedRoadSurface } from "../app/game/roadElevation";
import {
  buildRoadsideProps,
  groundPropClearanceEnvelope,
} from "../app/game/render/roadsideProps";
import { resolveMapVisualPalette } from "../app/game/visuals";

describe("roadside prop deck headroom", () => {
  it("uses the visible prop envelope instead of one blanket tall-prop rule", () => {
    const bollard = groundPropClearanceEnvelope(
      { kind: "bollard", variant: 0, scale: 1 },
      "cairo",
    );
    const sign = groundPropClearanceEnvelope(
      { kind: "sign", variant: 0, scale: 1 },
      "cairo",
    );
    const streetlight = groundPropClearanceEnvelope(
      { kind: "streetlight", variant: 0, scale: 1 },
      "cairo",
    );

    expect(bollard.requiredHeadroomM).toBeCloseTo(1.155, 6);
    expect(sign.requiredHeadroomM).toBeCloseTo(2.74, 6);
    expect(streetlight.requiredHeadroomM).toBeCloseTo(5.5, 6);
    expect(bollard.footprintRadiusM).toBeLessThan(sign.footprintRadiusM);
    expect(sign.footprintRadiusM).toBeLessThan(streetlight.footprintRadiusM);

    const fitsUnderThreeMetres = (requiredHeadroomM: number) =>
      requiredHeadroomM <= 3;
    expect(fitsUnderThreeMetres(bollard.requiredHeadroomM)).toBe(true);
    expect(fitsUnderThreeMetres(sign.requiredHeadroomM)).toBe(true);
    expect(fitsUnderThreeMetres(streetlight.requiredHeadroomM)).toBe(false);
  });

  it("uses the exact imported palm selected by the Cairo planting variant", () => {
    const tallPalm = groundPropClearanceEnvelope(
      { kind: "palm", variant: 0, scale: 1 },
      "cairo",
    );
    const shortPalm = groundPropClearanceEnvelope(
      { kind: "palm", variant: 1, scale: 1 },
      "cairo",
    );

    expect(tallPalm.requiredHeadroomM).toBeCloseTo(8.434, 6);
    expect(shortPalm.requiredHeadroomM).toBeCloseTo(5.581, 6);
    expect(tallPalm.footprintRadiusM).toBeGreaterThan(
      shortPalm.footprintRadiusM,
    );
  });

  it("rejects the formerly retained Qasr El Ainy palm that overlaps a mainline pier", () => {
    const palm = {
      x: 330.283,
      z: 215.5543,
      kind: "palm",
      variant: 1,
      scale: 0.8693,
    } as const;
    const envelope = groundPropClearanceEnvelope(palm, "cairo");
    const obstruction = createElevatedRoadDeckHeadroomQuery(
      CAIRO_MAP_PACK.geometry.roadSurfaces ?? [],
    )(
      palm,
      0,
      envelope.footprintRadiusM,
    );

    expect(obstruction).toMatchObject({
      structureKind: "pier",
      headroomM: 0,
    });
    expect(obstruction!.headroomM).toBeLessThan(
      envelope.requiredHeadroomM,
    );
  });

  it("applies the clearance gate before reachable plants or interior thickets enter GLB queues", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pendingPlantedProps: Parameters<typeof buildRoadsideProps>[0]["pendingPlantedProps"] = [];
    const pendingParkThickets: Parameters<typeof buildRoadsideProps>[0]["pendingParkThickets"] = [];
    const requestedEnvelopes: { heightM: number; radiusM: number }[] = [];

    buildRoadsideProps(
      {
        scene,
        staticSceneryFreeze: [] as TransformNode[],
        pendingVendors: [],
        pendingPlantedProps,
        pendingParkThickets,
        sceneryKeepFraction: 1,
        registerShadowCaster: () => undefined,
        registerDestructibleProp: () => undefined,
        canPlaceGroundProp: (_x, _z, requiredHeadroomM, footprintRadiusM) => {
          requestedEnvelopes.push({
            heightM: requiredHeadroomM,
            radiusM: footprintRadiusM,
          });
          return false;
        },
      },
      CAIRO_MAP_PACK,
      resolveMapVisualPalette(CAIRO_MAP_PACK.id),
      CAIRO_MAP_PACK.id,
      (CAIRO_MAP_PACK.geometry.roadSurfaces ?? []).filter(
        (surface) => !isElevatedRoadSurface(surface),
      ),
    );

    expect(requestedEnvelopes.length).toBeGreaterThan(0);
    expect(requestedEnvelopes.some((envelope) => envelope.heightM < 2)).toBe(
      true,
    );
    expect(requestedEnvelopes.some((envelope) => envelope.heightM > 5)).toBe(
      true,
    );
    expect(pendingPlantedProps).toHaveLength(0);
    expect(pendingParkThickets).toHaveLength(0);

    scene.dispose();
    engine.dispose();
  });
});
