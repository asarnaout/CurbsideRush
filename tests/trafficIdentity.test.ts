import { describe, expect, it } from "vitest";
import { isTrafficNpcPatrol } from "../app/game/simulation/trafficIdentity";

describe("traffic identity roles", () => {
  it("preserves the ambient patrol identity roll", () => {
    const patrolIds = Array.from({ length: 20 }, (_, index) => `npc-${index}`).filter(
      (vehicleId) => isTrafficNpcPatrol({ vehicleId, trafficSeed: 512, variant: "car" }),
    );

    expect(patrolIds).toEqual([
      "npc-1",
      "npc-9",
      "npc-10",
      "npc-12",
      "npc-14",
      "npc-17",
      "npc-18",
    ]);
  });

  it("makes authored police unconditional and excludes non-car civilians", () => {
    for (const vehicleId of ["npc-0", "npc-1", "named-patrol"]) {
      expect(isTrafficNpcPatrol({ vehicleId, trafficSeed: 512, variant: "police" })).toBe(true);
    }

    for (const variant of ["taxi", "bus", "van"] as const) {
      expect(isTrafficNpcPatrol({ vehicleId: "npc-1", trafficSeed: 512, variant })).toBe(false);
    }
  });

  it("normalizes fractional and non-finite seeds exactly as presentation did", () => {
    const role = (trafficSeed: number, vehicleId: string) =>
      isTrafficNpcPatrol({ vehicleId, trafficSeed, variant: "car" });

    expect(role(3.9, "npc-5")).toBe(role(3, "npc-5"));
    expect(role(Number.POSITIVE_INFINITY, "npc-19")).toBe(role(0, "npc-19"));
    expect(role(Number.NaN, "npc-0")).toBe(role(0, "npc-0"));
  });
});
