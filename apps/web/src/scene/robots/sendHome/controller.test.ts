import { afterEach, describe, expect, test } from "bun:test";
import { deskSeats, smallTemplate } from "@regulus/room-layout";
import type { FloorState } from "@regulus/protocol";
import { robotFixture } from "@regulus/protocol/src/fixtures.ts";
import { useFloorStore } from "../../../state/floor.ts";
import { hasRobotOverride, useRobotOverrides } from "../../../state/robotOverrides.ts";
import {
  activeSendHomes,
  resetSendHome,
  robotSnapshot,
  startSendHome,
  tickSendHome,
  watchRemovedRobots,
} from "./controller.ts";

const seatId = deskSeats(smallTemplate)[0]?.id ?? "";
const robot = { ...robotFixture, agentId: "a1", seatId };
const floorWith = (robots: Record<string, typeof robot>) =>
  ({ floorId: "f1", robots }) as unknown as FloorState;

afterEach(() => {
  resetSendHome();
  useFloorStore.getState().clear();
});

describe("send-home controller", () => {
  test("a robot walks out through an override that clears when it is gone", () => {
    expect(startSendHome("a1", { reducedMotion: false, template: smallTemplate, robot })).toBe(
      true,
    );
    expect(hasRobotOverride("a1")).toBe(true);
    const override = useRobotOverrides.getState().overrides.a1;
    expect(override?.robot.agentId).toBe("a1");
    const start = { ...override?.pose };
    tickSendHome(2);
    expect(useRobotOverrides.getState().overrides.a1?.carrying).toBe(true);
    expect(override?.pose).not.toEqual(start);
    for (let i = 0; i < 400 && activeSendHomes().length > 0; i++) tickSendHome(0.1);
    expect(hasRobotOverride("a1")).toBe(false);
  });

  test("reduced motion, no scene or no robot: nothing to animate", () => {
    expect(startSendHome("a1", { reducedMotion: true, template: smallTemplate, robot })).toBe(
      false,
    );
    expect(startSendHome("a1", { reducedMotion: false, robot })).toBe(false);
    expect(startSendHome("zz", { reducedMotion: false, template: smallTemplate })).toBe(false);
    expect(hasRobotOverride("a1")).toBe(false);
  });

  test("robots removed from the floor state are remembered for a late leaving notice", () => {
    const off = watchRemovedRobots();
    useFloorStore.getState().apply(floorWith({ a1: robot }));
    expect(robotSnapshot("a1")?.seatId).toBe(seatId);
    useFloorStore.getState().apply(floorWith({}));
    expect(robotSnapshot("a1")?.agentId).toBe("a1");
    expect(startSendHome("a1", { reducedMotion: false, template: smallTemplate })).toBe(true);
    off();
  });
});
