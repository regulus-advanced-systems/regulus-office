import { describe, expect, test } from "bun:test";
import {
  BuildingJoinOptions,
  COMMAND_REJECTED_MESSAGE,
  CommandRejected,
  FloorJoinOptions,
  LOBBY_FLOOR_ID,
  ROOM_NAMES,
} from "./rooms.ts";

describe("room names and join options", () => {
  test("room names match what the web client joins", () => {
    expect(ROOM_NAMES).toEqual({ building: "building", floor: "floor" });
    expect(LOBBY_FLOOR_ID).toBe("lobby");
  });

  test("floor join options require a floor id", () => {
    expect(FloorJoinOptions.safeParse({ floorId: "f1" }).success).toBe(true);
    expect(FloorJoinOptions.safeParse({ floorId: "" }).success).toBe(false);
    expect(FloorJoinOptions.safeParse({}).success).toBe(false);
  });

  test("building join options accept an empty object", () => {
    expect(BuildingJoinOptions.safeParse({}).success).toBe(true);
    expect(BuildingJoinOptions.safeParse(undefined).success).toBe(false);
  });

  test("command.rejected carries the command type and a reason", () => {
    expect(COMMAND_REJECTED_MESSAGE).toBe("command.rejected");
    expect(CommandRejected.safeParse({ type: "move", reason: "out of bounds" }).success).toBe(true);
    expect(CommandRejected.safeParse({ type: "move" }).success).toBe(false);
  });
});
