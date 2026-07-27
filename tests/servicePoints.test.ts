import { describe, expect, it } from "vitest";
import { MAP_PACKS } from "../app/game/content";
import { resolveSimulationLaneAnchor } from "../app/game/simulationAdapter";
import {
  FUEL_PUMP_REACH_M,
  distanceToNearestPump,
  distanceToRepairBay,
  gasStationPumpPositions,
  repairShopBayPosition,
  repairShopsOf,
  resolveServicePointLot,
} from "../app/game/servicePoints";
import {
  REPAIR_BAY_REACH_M,
  REPAIR_SHOP_LOT_HALF_M,
} from "../app/game/repairShopLayout";
import type { ServicePoint } from "../app/game/types";

const stationFor = (packId: string): { pack: (typeof MAP_PACKS)[number]; station: ServicePoint } => {
  const pack = MAP_PACKS.find((candidate) => candidate.id === packId)!;
  expect(pack, packId).toBeDefined();
  const station = (pack.geometry.servicePoints ?? []).find(
    (service) => service.kind === "gas_station",
  )!;
  expect(station, `${packId} gas station`).toBeDefined();
  return { pack, station };
};

/**
 * Pump positions read out of the rendered scene via the __sideswapMeshes hook,
 * for three cities whose stations face three different ways. They are the
 * ground truth for the model→world transform: if the maths in servicePoints.ts
 * drifts, these stop matching what the player actually drives up to.
 */
const RENDERED_PUMPS: Record<string, readonly (readonly [number, number])[]> = {
  "london-south-kensington": [
    [-181.32, -39.84],
    [-184.79, -39.84],
    [-184.79, -47.25],
    [-181.32, -47.25],
  ],
  "nyc-upper-west-side": [
    [-300.22, -500.92],
    [-300.22, -504.39],
    [-292.81, -504.39],
    [-292.81, -500.92],
  ],
  "milton-keynes-oldbrook": [
    [17.82, -105.22],
    [21.29, -105.22],
    [21.29, -97.81],
    [17.82, -97.81],
  ],
};

describe("gas-station pumps", () => {
  it("puts the pumps where the renderer actually draws them", () => {
    for (const [packId, expected] of Object.entries(RENDERED_PUMPS)) {
      const { pack, station } = stationFor(packId);
      const pumps = gasStationPumpPositions(pack.laneGraph.lanes, station);
      expect(pumps, packId).toHaveLength(4);
      pumps.forEach((pump, index) => {
        expect(pump.x, `${packId} pump ${index} x`).toBeCloseTo(expected[index][0], 1);
        expect(pump.z, `${packId} pump ${index} z`).toBeCloseTo(expected[index][1], 1);
      });
    }
  });

  it("resolves four pumps on the lot for every city", () => {
    for (const pack of MAP_PACKS) {
      for (const station of (pack.geometry.servicePoints ?? []).filter(
        (service) => service.kind === "gas_station",
      )) {
        const lot = resolveServicePointLot(pack.laneGraph.lanes, station)!;
        expect(lot, station.id).not.toBeNull();
        const pumps = gasStationPumpPositions(pack.laneGraph.lanes, station);
        expect(pumps, station.id).toHaveLength(4);
        // The lot slab reaches 11.64m from its centre; pumps must sit on it.
        for (const pump of pumps) {
          expect(Math.hypot(pump.x - lot.x, pump.z - lot.z), station.id).toBeLessThan(11.64);
        }
      }
    }
  });

  it("does not put the car in reach of a pump from the carriageway", () => {
    for (const pack of MAP_PACKS) {
      for (const station of (pack.geometry.servicePoints ?? []).filter(
        (service) => service.kind === "gas_station",
      )) {
        // The lane anchor is the kerbside pose the car drives past. Standing
        // there used to raise the refuel prompt; it must not any more.
        const pose = resolveSimulationLaneAnchor(pack.laneGraph.lanes, station.anchor)!;
        const fromLane = distanceToNearestPump(
          pack.laneGraph.lanes,
          station,
          pose.x,
          pose.z,
        );
        expect(fromLane, `${station.id} from the lane`).toBeGreaterThan(FUEL_PUMP_REACH_M);
      }
    }
  });

  it("reaches a car drawn up at any one of the four pumps", () => {
    for (const pack of MAP_PACKS) {
      for (const station of (pack.geometry.servicePoints ?? []).filter(
        (service) => service.kind === "gas_station",
      )) {
        const lanes = pack.laneGraph.lanes;
        const pumps = gasStationPumpPositions(lanes, station);
        for (const pump of pumps) {
          expect(
            distanceToNearestPump(lanes, station, pump.x, pump.z),
            `${station.id} at the pump`,
          ).toBeLessThan(FUEL_PUMP_REACH_M);
        }
        // Midway between the two islands still counts as being at the pumps.
        const midway = {
          x: (pumps[0].x + pumps[3].x) / 2,
          z: (pumps[0].z + pumps[3].z) / 2,
        };
        expect(
          distanceToNearestPump(lanes, station, midway.x, midway.z),
          `${station.id} between islands`,
        ).toBeLessThan(FUEL_PUMP_REACH_M);
      }
    }
  });
});

describe("repair-shop bays", () => {
  it("resolves a bay inside the shop for every authored shop", () => {
    let reviewed = 0;
    for (const pack of MAP_PACKS) {
      for (const shop of repairShopsOf(pack.geometry.servicePoints)) {
        const lot = resolveServicePointLot(pack.laneGraph.lanes, shop);
        const bay = repairShopBayPosition(pack.laneGraph.lanes, shop);
        expect(lot, shop.id).not.toBeNull();
        expect(bay, shop.id).not.toBeNull();
        if (!lot || !bay) continue;
        // The bay is the origin of the shop's own frame, so it lands on the lot
        // centre. Asserting it rather than assuming it is what would catch the
        // offset being nudged without the reach being rechecked.
        expect(Math.hypot(bay.x - lot.x, bay.z - lot.z), shop.id).toBeLessThan(
          REPAIR_SHOP_LOT_HALF_M,
        );
        reviewed += 1;
      }
    }
    expect(reviewed).toBe(4);
  });

  it("does not put the car in reach of a bay from the carriageway", () => {
    // The same mistake the refuel prompt had to fix by measuring to the pumps
    // rather than to the lane anchor: standing on the road is not being in the
    // shop, and a reach that spilled that far would offer a repair to a driver
    // who never turned in.
    for (const pack of MAP_PACKS) {
      for (const shop of repairShopsOf(pack.geometry.servicePoints)) {
        const pose = resolveSimulationLaneAnchor(
          pack.laneGraph.lanes,
          shop.anchor,
        )!;
        expect(
          distanceToRepairBay(pack.laneGraph.lanes, shop, pose.x, pose.z),
          `${shop.id} from the lane`,
        ).toBeGreaterThan(REPAIR_BAY_REACH_M);
      }
    }
  });

  it("reaches a car parked anywhere in the bay", () => {
    for (const pack of MAP_PACKS) {
      for (const shop of repairShopsOf(pack.geometry.servicePoints)) {
        const lanes = pack.laneGraph.lanes;
        const bay = repairShopBayPosition(lanes, shop)!;
        expect(distanceToRepairBay(lanes, shop, bay.x, bay.z), shop.id).toBe(0);
        // A car does not stop dead centre. Anywhere within the bay's own
        // half-depth of the centre still counts as being in the shop.
        for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = bay.x + Math.cos(angle) * (REPAIR_BAY_REACH_M - 0.5);
          const z = bay.z + Math.sin(angle) * (REPAIR_BAY_REACH_M - 0.5);
          expect(
            distanceToRepairBay(lanes, shop, x, z),
            `${shop.id} off-centre`,
          ).toBeLessThan(REPAIR_BAY_REACH_M);
        }
      }
    }
  });
});
