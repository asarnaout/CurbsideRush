import { describe, expect, it } from "vitest";
import {
  NYC_AVENUES,
  NYC_STREETS,
  buildNycGrid,
  type NycRoadSpec,
} from "../app/game/cities/nyc";
import type { LaneSegment, TrafficControl } from "../app/game/types";

// A synthetic 2x2 slice of the real grid — Amsterdam Ave (one-way north),
// Columbus Ave (one-way south, 2 lanes), W 72nd St and W 79th St (both
// two-way) — reused unmodified from NYC_AVENUES/NYC_STREETS so their roadIds
// stay posted in the real speed-limit table `buildNycGrid`'s closed-over
// `laneTrue` reads from. Only Amsterdam@79th and Columbus@72nd end up fed by
// two roads at this size (the other two corners have only one road arriving,
// same as the real map's edge cases), which is enough to cover every branch
// of the signal/stop dispatch without touching the shipped content.
const amst = NYC_AVENUES.find((road) => road.key === "amst")!;
const col = NYC_AVENUES.find((road) => road.key === "col")!;
const street72 = NYC_STREETS.find((road) => road.key === "72")!;
const street79 = NYC_STREETS.find((road) => road.key === "79")!;

const roadIdOf = (lanes: readonly LaneSegment[], laneId: string): string =>
  lanes.find((lane) => lane.id === laneId)!.roadId;

const controlAt = (
  controls: ReturnType<typeof buildNycGrid>["controls"],
  nodeKeyFragment: string,
): TrafficControl =>
  controls.find((entry) => entry.control.id.includes(nodeKeyFragment))!.control;

describe("NYC stop-junction derivation", () => {
  it("still signalises an ordinary crossing where both roads are signal-class", () => {
    const grid = buildNycGrid([amst, col], [street72, street79]);
    const signalControls = grid.controls.filter((entry) => entry.control.type === "signal");
    const stopControls = grid.controls.filter((entry) => entry.control.type === "stop");
    expect(signalControls).toHaveLength(2); // Amsterdam@79th, Columbus@72nd
    expect(stopControls).toHaveLength(0);
  });

  it("gives a two-way stop only the stop-class road's arms, leaving the signal-class road uncontrolled", () => {
    const stopStreet72: NycRoadSpec = { ...street72, junctionControl: "stop" };
    const grid = buildNycGrid([amst, col], [stopStreet72, street79]);

    // Amsterdam@79th is untouched — still a signal.
    expect(controlAt(grid.controls, "amst-79").type).toBe("signal");

    // Columbus@72nd: Columbus stays signal-class but is alone, so the
    // crossing gets a stop instead. Of W 72nd's two directions only the
    // eastbound one ends here (the westbound lane's block runs the other
    // way, ending at Amsterdam instead) — that's the one lane this node
    // controls; Columbus' arriving lanes get no approach at all.
    const stop = controlAt(grid.controls, "col-72");
    expect(stop.type).toBe("stop");
    expect(stop.approaches).toHaveLength(1);
    expect(stop.laneIds).toHaveLength(1);
    for (const laneId of stop.laneIds) {
      expect(roadIdOf(grid.lanes, laneId)).toBe("nyc-west-72");
    }
    // The one approach's stop line is 6 m short of a real lane, and gets its
    // own roadside sign.
    expect(stop.installations).toHaveLength(1);
    for (const installation of stop.installations) {
      expect(installation.mounting).toBe("roadside_pole");
      expect(installation.style).toBe("stop_sign");
    }
  });

  it("makes an all-way stop when every arriving road is stop-class", () => {
    const stopCol: NycRoadSpec = { ...col, junctionControl: "stop" };
    const stopStreet72: NycRoadSpec = { ...street72, junctionControl: "stop" };
    const grid = buildNycGrid([amst, stopCol], [stopStreet72, street79]);

    const stop = controlAt(grid.controls, "col-72");
    expect(stop.type).toBe("stop");
    // W 72nd's one arriving (eastbound) lane, plus Columbus' 2 lanes (both
    // southbound, 2 lanes/direction, and Columbus is a one-way avenue so
    // both necessarily arrive) — 3 lanes, all now stop-controlled.
    expect(stop.approaches).toHaveLength(3);
    expect(stop.laneIds).toHaveLength(3);
    const roadIds = new Set(stop.laneIds.map((laneId) => roadIdOf(grid.lanes, laneId)));
    expect(roadIds).toEqual(new Set(["nyc-west-72", "nyc-columbus"]));
  });

  it("leaves a node with only one arriving road uncontrolled either way", () => {
    // Within this 2-street slice, Amsterdam (northbound only) never arrives
    // at W 72nd — that corner is fed by W 72nd alone, same shape as the real
    // map's one-way-avenue tails, and must stay uncontrolled even once stop
    // classes exist.
    const stopStreet72: NycRoadSpec = { ...street72, junctionControl: "stop" };
    const stopCol: NycRoadSpec = { ...col, junctionControl: "stop" };
    const grid = buildNycGrid([amst, stopCol], [stopStreet72, street79]);
    expect(grid.controls.some((entry) => entry.control.id.includes("amst-72"))).toBe(false);
  });
});
