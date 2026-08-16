import { describe, expect, it } from "vitest";
import { FREE_DRIVES, getCountryProfile, getMapPack } from "../app/game/content";
import {
  SimulationCore,
  type SimulationCoreConfig,
  type SimulationRuleEvent,
} from "../app/game/simulation";
import {
  buildSimulationCoreConfig,
  resolveSimulationLaneAnchor,
} from "../app/game/simulationAdapter";
import { buildFreeDriveScenario } from "../app/game/driveScenario";
import {
  DEFAULT_SERVICE_SETBACK_M,
  gasStationPumpPositions,
  repairShopBayPosition,
  resolveServiceLotArea,
  SERVICE_LOT_HALF_M,
} from "../app/game/servicePoints";
import type { MapPack, RuleCode, ServiceArea } from "../app/game/types";

/**
 * Issue #86: the game fined you for pulling into a gas station.
 *
 * A forecourt sits 16-23 m off its lane, and every rule `roadRuleMonitor`
 * enforces is measured against the *nearest lane* — so standing at a pump read
 * as `out_of_bounds` ("leaving the road") after 0.8 s, re-armed every 2 s, and
 * became a real fine whenever a patrol was within 35 m. Manoeuvring on the
 * forecourt could trip `wrong_way` as well, and driving across one past a
 * junction's stop-line distance could trip `red_light`, from ground the car had
 * never left.
 *
 * The fix is a `ServiceArea` per service point — the lot, flared for the
 * turn-in, and reaching back to the lane centreline so the pavement crossing is
 * covered. A car both off the carriageway and inside one is judged as being on
 * no lane at all.
 *
 * The two halves of that are equally load-bearing, so both are pinned here: the
 * amnesty holds everywhere a driver legitimately is (approaching, standing,
 * leaving), and it stops dead at the lot's own edges — off-road elsewhere, a
 * wrong-way run on the carriageway outside the station, and anyone struck on
 * the forecourt are all cited exactly as before.
 */

/** What `BabylonGameSession.processSimulationEvents` will turn into money. */
const FINEABLE: readonly RuleCode[] = [
  "wrong_way",
  "out_of_bounds",
  "red_light",
  "speeding",
  "railway_crossing",
  "collision",
];

/** The lane-relative subset — what a service area is allowed to suspend. */
const LANE_RULES: readonly RuleCode[] = FINEABLE.filter(
  (code) => code !== "collision",
);

const codesOf = (events: readonly SimulationRuleEvent[]): string[] => [
  ...new Set(events.map((event) => event.code)),
];

interface Site {
  readonly label: string;
  readonly mapPack: MapPack;
  readonly config: SimulationCoreConfig;
  readonly service: NonNullable<MapPack["geometry"]["servicePoints"]>[number];
  readonly area: ServiceArea;
  /** Pose of the lane anchor the lot is set back from. */
  readonly anchor: { readonly x: number; readonly z: number; readonly heading: number };
  readonly setbackM: number;
  readonly lotHalfM: number;
  /** Where a driver actually stops here: each pump, or the bay floor. */
  readonly stops: readonly { readonly x: number; readonly z: number }[];
}

/** Unit vectors of the anchor lane: `forward` along it, `out` towards the lot. */
const laneAxes = (heading: number) => ({
  forward: { x: Math.sin(heading), z: Math.cos(heading) },
  out: { x: Math.cos(heading), z: -Math.sin(heading) },
});

/**
 * Every service point on every playable map, with the one simulation config per
 * map shared between them — `buildSimulationCoreConfig` plans the whole
 * building layout, which is far too expensive to repeat per station.
 */
const SITES: Site[] = (() => {
  const sites: Site[] = [];
  for (const drive of FREE_DRIVES) {
    const mapPack = getMapPack(drive.mapId);
    const services = mapPack.geometry.servicePoints ?? [];
    if (services.length === 0) continue;
    const country = getCountryProfile(drive.countryId);
    const config = buildSimulationCoreConfig({
      scenario: buildFreeDriveScenario(drive),
      mapPack,
      trafficSide: country.trafficSide,
      speedUnit: country.speedUnit,
    });
    for (const [index, service] of services.entries()) {
      const area = resolveServiceLotArea(
        mapPack.laneGraph.lanes,
        service,
        `service-${index}`,
      );
      const anchor = resolveSimulationLaneAnchor(
        mapPack.laneGraph.lanes,
        service.anchor,
      );
      if (!area || !anchor) continue;
      const stops =
        service.kind === "gas_station"
          ? gasStationPumpPositions(mapPack.laneGraph.lanes, service)
          : [repairShopBayPosition(mapPack.laneGraph.lanes, service)].filter(
              (point): point is { x: number; z: number } => point !== null,
            );
      sites.push({
        label: `${mapPack.id} ${service.kind}#${index}`,
        mapPack,
        config,
        service,
        area,
        anchor,
        setbackM: service.setbackM ?? DEFAULT_SERVICE_SETBACK_M,
        lotHalfM: SERVICE_LOT_HALF_M[service.kind],
        stops,
      });
    }
  }
  return sites;
})();

/** A core with traffic switched off — every event here is the player's own. */
const coreFor = (site: Site): SimulationCore =>
  new SimulationCore({ ...site.config, npcCount: 0 });

/** Holds a pose for `seconds` and returns whatever rules fired. */
const dwell = (
  core: SimulationCore,
  pose: { x: number; z: number; heading: number },
  seconds: number,
): SimulationRuleEvent[] => {
  core.setPlayerPose(pose);
  core.drainEvents();
  for (let step = 0; step < Math.round(seconds * 60); step += 1) core.step(1 / 60);
  return core.drainEvents();
};

it("found every city's service points", () => {
  // Guards the whole file: a resolution bug that emptied SITES would otherwise
  // make every assertion below pass vacuously.
  expect(SITES.length).toBeGreaterThanOrEqual(20);
  expect(new Set(SITES.map((site) => site.mapPack.id)).size).toBe(4);
  for (const kind of ["gas_station", "repair_shop"] as const) {
    expect(SITES.filter((site) => site.service.kind === kind).length, kind)
      .toBeGreaterThan(0);
  }
  for (const site of SITES) {
    expect(site.stops.length, `${site.label} has somewhere to stop`).toBeGreaterThan(0);
  }
});

describe("a car on a forecourt or in a repair bay is not judged by the lane", () => {
  it("stands at every pump and every bay for four seconds without a single rule firing", () => {
    for (const site of SITES) {
      for (const [index, stop] of site.stops.entries()) {
        const core = coreFor(site);
        // Facing the road, as a car drawn up to a pump or nosed into a bay is.
        const events = dwell(
          core,
          { ...stop, heading: site.anchor.heading + Math.PI / 2 },
          4,
        );
        expect(codesOf(events), `${site.label} stop ${index}`).toEqual([]);
      }
    }
  });

  it("manoeuvres against the street's direction on the forecourt without a wrong-way ticket", () => {
    // A lot's nearest lane is not always the lane it is anchored to — a couple
    // sit closer to a side street or the opposing carriageway, which points a
    // different way. So "this pose used to be a ticket" is counted across the
    // corpus rather than demanded of every site; the no-ticket assertion is
    // still made at every one of them.
    let provablyPreFixTickets = 0;
    for (const site of SITES) {
      const { forward, out } = laneAxes(site.anchor.heading);
      // Reversing back off the pumps, or swinging round to leave: pointed the
      // way the street does not go, on open forecourt just inside the lot.
      const depth = site.setbackM - site.lotHalfM * 0.7;
      const core = coreFor(site);
      core.setPlayerPose(
        {
          x: site.anchor.x + out.x * depth + forward.x * 3,
          z: site.anchor.z + out.z * depth + forward.z * 3,
          heading: site.anchor.heading + Math.PI,
        },
        4,
      );
      const start = core.getSnapshot().road;
      expect(start.offRoad, `${site.label} is off the carriageway`).toBe(true);
      if (start.wrongWay) provablyPreFixTickets += 1;
      core.drainEvents();
      for (let step = 0; step < 180; step += 1) core.step(1 / 60, { throttle: 0.3 });
      const codes = codesOf(core.drainEvents());
      for (const rule of LANE_RULES) {
        expect(codes, `${site.label} ${rule}`).not.toContain(rule);
      }
    }
    // `offRoad` above already holds at every site, so every site here would
    // have drawn the pre-fix `out_of_bounds` ticket; this second count is only
    // pinning that a decent share of them reproduce the wrong-way half too.
    expect(provablyPreFixTickets).toBeGreaterThan(SITES.length / 4);
  });
});

describe("the amnesty is contiguous with the road it is entered from", () => {
  it("leaves no band between the carriageway and the lot where a driver is still judged", () => {
    // The one invariant that makes entering and leaving safe at any speed and
    // any angle: sampling straight out from the lane anchor to the far edge of
    // the lot, there is no point that counts as off-road but sits outside the
    // amnesty. A gap here would be a ticket collected mid-driveway.
    let offRoadSamples = 0;
    for (const site of SITES) {
      const { out } = laneAxes(site.anchor.heading);
      const core = coreFor(site);
      const depth = site.setbackM + site.lotHalfM;
      for (let metres = 0; metres <= depth; metres += 0.25) {
        const point = {
          x: site.anchor.x + out.x * metres,
          z: site.anchor.z + out.z * metres,
          heading: site.anchor.heading,
        };
        core.setPlayerPose(point);
        if (!core.getSnapshot().road.offRoad) continue;
        offRoadSamples += 1;
        const dx = point.x - site.area.x;
        const dz = point.z - site.area.z;
        const along = Math.abs(dx * site.area.ux + dz * site.area.uz);
        const across = Math.abs(dx * site.area.uz - dz * site.area.ux);
        expect(
          along <= site.area.halfU && across <= site.area.halfV,
          `${site.label}: off-road at ${metres.toFixed(2)} m out, outside its own service area`,
        ).toBe(true);
      }
    }
    expect(offRoadSamples).toBeGreaterThan(SITES.length * 10);
  });

  it("drives in off the street and back out again without a rule firing", () => {
    let legsOffRoadLongEnoughToTicket = 0;
    let legs = 0;
    for (const site of SITES) {
      const { forward, out } = laneAxes(site.anchor.heading);
      const depth = site.setbackM - site.lotHalfM * 0.7;
      const target = {
        x: site.anchor.x + out.x * depth,
        z: site.anchor.z + out.z * depth,
      };
      // In: from 12 m up-street on the lane, aimed at the open forecourt, so
      // the car crosses the kerb and the pavement at a real turn-in angle.
      const entry = {
        x: site.anchor.x - forward.x * 12,
        z: site.anchor.z - forward.z * 12,
      };
      const runs: readonly { readonly leg: string; readonly from: { x: number; z: number }; readonly to: { x: number; z: number } }[] = [
        { leg: "in", from: entry, to: target },
        // Out: the same path driven the other way, back onto the carriageway.
        { leg: "out", from: target, to: { x: site.anchor.x + forward.x * 12, z: site.anchor.z + forward.z * 12 } },
      ];
      for (const run of runs) {
        const core = coreFor(site);
        core.setPlayerPose(
          {
            ...run.from,
            heading: Math.atan2(run.to.x - run.from.x, run.to.z - run.from.z),
          },
          7,
        );
        core.drainEvents();
        let offRoadTicks = 0;
        for (let step = 0; step < 150; step += 1) {
          core.step(1 / 60, { throttle: 0.35 });
          if (core.getSnapshot().road.offRoad) offRoadTicks += 1;
        }
        legs += 1;
        // A leg only proves something if it stayed off the carriageway for
        // longer than the 0.8 s the off-road accumulator needs to fire. Counted
        // over the corpus for the same reason as the wrong-way case above.
        if (offRoadTicks > 48) legsOffRoadLongEnoughToTicket += 1;
        const codes = codesOf(core.drainEvents());
        for (const rule of LANE_RULES) {
          expect(codes, `${site.label} driving ${run.leg}: ${rule}`).not.toContain(rule);
        }
      }
    }
    expect(legs).toBe(SITES.length * 2);
    expect(legsOffRoadLongEnoughToTicket).toBeGreaterThan(legs * 0.75);
  });
});

describe("the amnesty stops at the lot, and never covers a person", () => {
  it("still fines a driver who leaves the road further along the same street", () => {
    // "Close-ish to a gas station" must not be a defence. Same lateral offset
    // as the forecourt's own kerb, 45 m up-street of it.
    let exercised = 0;
    for (const site of SITES) {
      const { forward, out } = laneAxes(site.anchor.heading);
      const distance = site.setbackM - site.lotHalfM + 1;
      const pose = {
        x: site.anchor.x + forward.x * 45 + out.x * distance,
        z: site.anchor.z + forward.z * 45 + out.z * distance,
        heading: site.anchor.heading,
      };
      const core = coreFor(site);
      core.setPlayerPose(pose);
      // Another lane (a side street, the opposing carriageway) may legitimately
      // run through that spot; only the genuinely off-road ones are the test.
      if (!core.getSnapshot().road.offRoad) continue;
      exercised += 1;
      const events = dwell(core, pose, 2);
      expect(codesOf(events), `${site.label} 45 m up-street`).toContain("out_of_bounds");
    }
    expect(exercised).toBeGreaterThan(SITES.length / 2);
  });

  it("still fines a wrong-way run on the carriageway directly outside a station", () => {
    // The service area reaches the lane centreline, so this is the case that
    // proves the road-side half of it grants nothing: same street, same metre,
    // but on the road rather than on the forecourt.
    for (const site of SITES) {
      const core = coreFor(site);
      core.setPlayerPose(
        { x: site.anchor.x, z: site.anchor.z, heading: site.anchor.heading + Math.PI },
        6,
      );
      if (core.getSnapshot().road.offRoad) continue;
      core.drainEvents();
      for (let step = 0; step < 180; step += 1) core.step(1 / 60, { throttle: 0.5 });
      expect(codesOf(core.drainEvents()), site.label).toContain("wrong_way");
    }
  });

  it("still reports a pedestrian or cyclist struck on the forecourt itself", () => {
    // The rule the owner set: standing at a pump excuses your position, never
    // what you hit. External contacts are staged outside `roadRuleMonitor`
    // entirely, and `handleGameEvent` cites them with no patrol required.
    for (const site of SITES) {
      const core = coreFor(site);
      core.setPlayerPose({ ...site.stops[0], heading: site.anchor.heading });
      core.step(1 / 60);
      core.drainEvents();
      const reported = core.reportExternalContact("Brake early.", 0.75, {
        roadUserType: "pedestrian",
      });
      expect(reported, site.label).toBe(true);
      const events = core.drainEvents();
      expect(codesOf(events), site.label).toContain("collision");
      expect(events[0]?.evidence.roadUserType, site.label).toBe("pedestrian");
    }
  });

});
