import { describe, expect, test } from "bun:test";
import { deskSeats, smallTemplate } from "@regulus/room-layout";
import { navGridFor } from "../../movement/navigation.ts";
import {
  advance,
  frameFor,
  PHASE_SECONDS,
  planSendHome,
  routeToElevator,
  startPose,
} from "./plan.ts";

const firstSeat = deskSeats(smallTemplate)[0];
if (!firstSeat) throw new Error("template has no desks");
const seat = firstSeat;

function runToEnd(dt: number) {
  let state = planSendHome(smallTemplate, seat.id);
  const phases = [state.phase];
  for (let i = 0; i < 10_000 && state.phase !== "gone"; i++) {
    state = advance(state, dt);
    if (phases.at(-1) !== state.phase) phases.push(state.phase);
  }
  return { state, phases };
}

describe("send-home walk", () => {
  test("starts at the seat and routes over walkable cells to the elevator door", () => {
    const start = startPose(smallTemplate, seat.id);
    expect(start).toEqual({ x: seat.pose.x, z: seat.pose.z, heading: seat.pose.heading });
    const route = routeToElevator(smallTemplate, start);
    const door = smallTemplate.elevator.door;
    const last = route.at(-1);
    expect(Math.hypot((last?.x ?? 0) - door.x, (last?.z ?? 0) - door.z)).toBeLessThan(0.5);
    const grid = navGridFor(smallTemplate);
    for (const p of route) expect(grid.isWalkable(p.x, p.z)).toBe(true);
  });

  test("stand → pickup → walk → vanish → gone, ending at the elevator", () => {
    const { state, phases } = runToEnd(1 / 60);
    expect(phases).toEqual(["stand", "pickup", "walk", "vanish", "gone"]);
    const door = smallTemplate.elevator.door;
    expect(Math.hypot(state.pose.x - door.x, state.pose.z - door.z)).toBeLessThan(0.5);
    expect(state.scale).toBe(0);
  });

  test("a huge frame step still finishes (tab was hidden)", () => {
    const state = advance(planSendHome(smallTemplate, seat.id), 600);
    expect(state.phase).toBe("gone");
  });

  test("the box appears during the pick-up and stays while walking", () => {
    let state = planSendHome(smallTemplate, seat.id);
    expect(frameFor(state)).toEqual({ animation: "idle", carrying: false });
    state = advance(state, PHASE_SECONDS.stand + 0.01);
    expect(frameFor(state)).toEqual({ animation: "point", carrying: false });
    state = advance(state, PHASE_SECONDS.pickup / 2);
    expect(frameFor(state).carrying).toBe(true);
    state = advance(state, PHASE_SECONDS.pickup / 2);
    expect(frameFor(state)).toEqual({ animation: "walk", carrying: true });
  });

  test("reduced motion: the robot is gone at once", () => {
    expect(planSendHome(smallTemplate, seat.id, { reducedMotion: true }).phase).toBe("gone");
  });

  test("an unknown seat starts from the room centre", () => {
    expect(startPose(smallTemplate, "nope")).toEqual({
      x: smallTemplate.size.width / 2,
      z: smallTemplate.size.depth / 2,
      heading: 0,
    });
  });
});
