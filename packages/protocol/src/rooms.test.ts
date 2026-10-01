import { describe, expect, test } from "bun:test";
import {
  BuildingJoinOptions,
  COMMAND_REJECTED_MESSAGE,
  CommandRejected,
  LOBBY_OPERATION_ID,
  OperationJoinOptions,
  ROOM_NAMES,
} from "./rooms.ts";

describe("room names and join options", () => {
  test("room names match what the web client joins", () => {
    expect(ROOM_NAMES).toEqual({ building: "building", operation: "operation" });
    expect(LOBBY_OPERATION_ID).toBe("lobby");
  });

  test("operation join options require an operation id", () => {
    expect(OperationJoinOptions.safeParse({ operationId: "f1" }).success).toBe(true);
    expect(OperationJoinOptions.safeParse({ operationId: "" }).success).toBe(false);
    expect(OperationJoinOptions.safeParse({}).success).toBe(false);
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
