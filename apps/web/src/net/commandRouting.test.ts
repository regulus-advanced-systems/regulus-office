import { describe, expect, test } from "bun:test";
import { CLIENT_COMMAND_TYPES } from "@regulus/protocol";
import { roomForCommand } from "./commandRouting.ts";

describe("command routing", () => {
  test("every protocol command has a room", () => {
    for (const type of CLIENT_COMMAND_TYPES) {
      expect(["building", "floor"]).toContain(roomForCommand(type));
    }
  });

  test("presence and lobby go to the building, agents and floor objects to the floor", () => {
    expect(roomForCommand("move")).toBe("building");
    expect(roomForCommand("chat")).toBe("building");
    expect(roomForCommand("floor.go")).toBe("building");
    expect(roomForCommand("jukebox.play")).toBe("building");
    expect(roomForCommand("pm.ask")).toBe("building");
    expect(roomForCommand("agent.spawn")).toBe("floor");
    expect(roomForCommand("queue.add")).toBe("floor");
    expect(roomForCommand("card.pick")).toBe("floor");
    expect(roomForCommand("decor.place")).toBe("floor");
  });
});
