import { describe, expect, test } from "bun:test";
import { CLIENT_COMMAND_TYPES } from "@regulus/protocol";
import { roomForCommand } from "./commandRouting.ts";

describe("command routing", () => {
  test("every protocol command has a room", () => {
    for (const type of CLIENT_COMMAND_TYPES) {
      expect(["building", "operation"]).toContain(roomForCommand(type));
    }
  });

  test("presence and lobby go to the building, agents and operation objects to the operation", () => {
    expect(roomForCommand("move")).toBe("building");
    expect(roomForCommand("chat")).toBe("building");
    expect(roomForCommand("operation.go")).toBe("building");
    expect(roomForCommand("jukebox.play")).toBe("building");
    expect(roomForCommand("pm.ask")).toBe("building");
    expect(roomForCommand("agent.spawn")).toBe("operation");
    expect(roomForCommand("queue.add")).toBe("operation");
    expect(roomForCommand("card.pick")).toBe("operation");
    expect(roomForCommand("decor.place")).toBe("operation");
  });
});
