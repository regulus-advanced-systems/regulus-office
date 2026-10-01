import { describe, expect, test } from "bun:test";
import {
  LOBBY_WHITEBOARD_ID,
  whiteboardAccessFor,
  whiteboardSnapshotPath,
  whiteboardWsBase,
  whiteboardWsPath,
} from "./whiteboard.ts";

describe("whiteboardAccessFor", () => {
  test("the lobby board is open to everyone, read-only for viewers", () => {
    expect(whiteboardAccessFor(LOBBY_WHITEBOARD_ID, "member", null)).toBe("edit");
    expect(whiteboardAccessFor(LOBBY_WHITEBOARD_ID, "owner", null)).toBe("edit");
    expect(whiteboardAccessFor(LOBBY_WHITEBOARD_ID, "viewer", null)).toBe("view");
  });

  test("an operation's board follows the operation access", () => {
    expect(whiteboardAccessFor("op1", "member", null)).toBeNull();
    expect(whiteboardAccessFor("op1", "member", "view")).toBe("view");
    expect(whiteboardAccessFor("op1", "member", "spawn")).toBe("edit");
    expect(whiteboardAccessFor("op1", "admin", "manage")).toBe("edit");
    expect(whiteboardAccessFor("op1", "viewer", "manage")).toBe("view");
  });
});

test("paths", () => {
  expect(whiteboardWsPath("a b")).toBe("/ws/wb/a%20b");
  expect(whiteboardWsBase("wss://office.example/")).toBe("wss://office.example/ws/wb");
  expect(whiteboardSnapshotPath("lobby")).toBe("/api/whiteboards/lobby/snapshot");
  expect(whiteboardSnapshotPath("op1", 3)).toBe("/api/whiteboards/op1/snapshot?v=3");
});
