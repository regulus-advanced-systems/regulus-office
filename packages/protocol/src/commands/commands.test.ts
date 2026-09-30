import { describe, expect, test } from "bun:test";
import {
  CLIENT_COMMAND_TYPES,
  ClientCommand,
  type ClientCommandType,
  isClientCommandType,
  parseClientCommand,
} from "./index.ts";

/** Command list exactly as written in SPEC §6. */
const SPEC_COMMANDS = [
  "move",
  "sit",
  "emote",
  "chat",
  "floor.go",
  "agent.spawn",
  "agent.prompt",
  "agent.approve",
  "agent.stop",
  "agent.resume",
  "agent.pr",
  "queue.add",
  "queue.reorder",
  "queue.cancel",
  "card.pick",
  "card.drop",
  "decor.place",
  "decor.move",
  "decor.remove",
  "jukebox.play",
  "jukebox.pause",
  "jukebox.seek",
  "jukebox.enqueue",
  "jukebox.skip",
  "screen.share.start",
  "screen.share.stop",
  "pm.ask",
] as const;

/**
 * Commands beyond the SPEC §6 list, each with its source: `agent.interrupt`
 * is SPEC §7 `AgentControl.interrupt`; `agent.sendHome` and `agent.worktree`
 * are the send-home and PR dialogs of issue #33; `agent.emergencyStop` is the
 * office owner/admin stop of D12 (#138).
 */
const EXTENSION_COMMANDS = [
  "agent.interrupt",
  "agent.sendHome",
  "agent.worktree",
  "agent.emergencyStop",
] as const;

const valid: Record<ClientCommandType, Record<string, unknown>> = {
  move: { x: 1, z: -2, heading: 0.5 },
  sit: { seatId: "couch-1" },
  emote: { emote: "wave" },
  chat: { text: "hi" },
  "floor.go": { floorId: "f1" },
  "agent.spawn": {
    floorId: "f1",
    repoId: "r1",
    provider: "claude-code",
    model: "claude-sonnet-4-5",
    prompt: "Fix issue #8",
    issueNumber: 8,
  },
  "agent.prompt": { agentId: "a1", text: "continue" },
  "agent.approve": { agentId: "a1", requestId: "p1", decision: "allow_once" },
  "agent.stop": { agentId: "a1" },
  "agent.resume": { agentId: "a1" },
  "agent.pr": { agentId: "a1", title: "Fix #8" },
  "agent.interrupt": { agentId: "a1" },
  "agent.sendHome": { agentId: "a1", keepBranch: true },
  "agent.worktree": { agentId: "a1" },
  "agent.emergencyStop": { agentId: "a1", reason: "runaway cost" },
  "queue.add": {
    floorId: "f1",
    repoId: "r1",
    kind: "issue",
    refNumber: 9,
    prompt: "do it",
    provider: "codex",
    model: "gpt-5-codex",
  },
  "queue.reorder": { taskId: "q1", position: 0 },
  "queue.cancel": { taskId: "q1" },
  "card.pick": { cardKind: "pr", repoId: "r1", number: 71 },
  "card.drop": { seatId: "seat-2" },
  "decor.place": { kind: "picture", wallId: "north", uploadId: "up1", x: 1, y: 1, w: 1, h: 0.5 },
  "decor.move": { decorId: "d1", x: 2, y: 1, w: 1, h: 0.5 },
  "decor.remove": { decorId: "d1" },
  "jukebox.play": { trackId: "t1" },
  "jukebox.pause": {},
  "jukebox.seek": { positionMs: 1000 },
  "jukebox.enqueue": { trackId: "t2" },
  "jukebox.skip": {},
  "screen.share.start": {},
  "screen.share.stop": {},
  "pm.ask": { text: "what is everyone doing?" },
};

describe("ClientCommand", () => {
  test("covers exactly the SPEC §6 command list plus the documented extensions", () => {
    expect([...CLIENT_COMMAND_TYPES].sort()).toEqual(
      [...SPEC_COMMANDS, ...EXTENSION_COMMANDS].sort(),
    );
  });

  test.each(CLIENT_COMMAND_TYPES)("accepts a valid %s payload", (type) => {
    const result = parseClientCommand(type, valid[type]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe(type);
  });

  test("applies defaults", () => {
    const go = parseClientCommand("floor.go", { floorId: "f1" });
    expect(go.success && go.data.type === "floor.go" && go.data.mode).toBe("ride");
    const spawn = parseClientCommand("agent.spawn", valid["agent.spawn"]);
    expect(spawn.success && spawn.data.type === "agent.spawn" && spawn.data.autoWorktree).toBe(
      true,
    );
    // No prompt: the robot starts idle (#142); a blank one is the same.
    for (const prompt of [undefined, "", "   "]) {
      const idle = parseClientCommand("agent.spawn", { ...valid["agent.spawn"], prompt });
      expect(idle.success && idle.data.type === "agent.spawn" && idle.data.prompt).toBe("");
    }
    expect(
      parseClientCommand("agent.spawn", { ...valid["agent.spawn"], prompt: "x".repeat(20_001) })
        .success,
    ).toBe(false);
    const share = parseClientCommand("screen.share.start", {});
    expect(share.success && share.data.type === "screen.share.start" && share.data.target).toBe(
      "lounge_tv",
    );
  });

  test("rejects unknown types, missing fields and bad enum values", () => {
    expect(parseClientCommand("dance", {}).success).toBe(false);
    expect(parseClientCommand("move", { x: 1 }).success).toBe(false);
    expect(parseClientCommand("move", { x: Number.NaN, z: 0, heading: 0 }).success).toBe(false);
    expect(parseClientCommand("emote", { emote: "moonwalk" }).success).toBe(false);
    expect(parseClientCommand("chat", { text: "   " }).success).toBe(false);
    expect(parseClientCommand("chat", { text: "x".repeat(2001) }).success).toBe(false);
    expect(
      parseClientCommand("agent.spawn", { ...valid["agent.spawn"], provider: "chatgpt" }).success,
    ).toBe(false);
    expect(
      parseClientCommand("agent.approve", { ...valid["agent.approve"], decision: "maybe" }).success,
    ).toBe(false);
    expect(parseClientCommand("jukebox.seek", { positionMs: -1 }).success).toBe(false);
    expect(parseClientCommand("agent.sendHome", { agentId: "a1" }).success).toBe(false);
    expect(parseClientCommand("card.pick", { ...valid["card.pick"], number: 0 }).success).toBe(
      false,
    );
  });

  test("queue.add requires refNumber for issue and pr tasks only", () => {
    const base = { ...valid["queue.add"], refNumber: undefined };
    expect(parseClientCommand("queue.add", { ...base, kind: "issue" }).success).toBe(false);
    expect(parseClientCommand("queue.add", { ...base, kind: "pr" }).success).toBe(false);
    expect(parseClientCommand("queue.add", { ...base, kind: "freeform" }).success).toBe(true);
  });

  test("payload type cannot override the message type", () => {
    const result = parseClientCommand("agent.stop", { type: "agent.spawn", agentId: "a1" });
    expect(result.success && result.data.type).toBe("agent.stop");
  });

  test("non-object payloads only parse for payload-less commands", () => {
    expect(parseClientCommand("jukebox.skip", undefined).success).toBe(true);
    expect(parseClientCommand("jukebox.skip", null).success).toBe(true);
    expect(parseClientCommand("move", "nope").success).toBe(false);
  });

  test("the full union also parses objects that already carry type", () => {
    expect(ClientCommand.safeParse({ type: "sit", seatId: null }).success).toBe(true);
    expect(isClientCommandType("pm.ask")).toBe(true);
    expect(isClientCommandType("pm.fire")).toBe(false);
  });
});
