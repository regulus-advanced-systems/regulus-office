import { describe, expect, test } from "bun:test";
import {
  KIOSK_BOARD_POST,
  KIOSK_BOARDS,
  KIOSK_POSTS,
  KioskPlacement,
  kioskBoardOfPost,
} from "./office-agent-kiosk.ts";
import {
  agentMayUseTool,
  KIOSK_TOOLS,
  OFFICE_TOOLS,
  toolsForAgent,
  toolsForPreset,
} from "./office-agent-tools.ts";
import { OFFICE_AGENT_POSTS, OfficeAgentBody } from "./office-agent-world.ts";
import { CreateOfficeAgent, OFFICE_AGENT_PRESETS, OFFICE_AGENT_ROLES } from "./office-agents.ts";

describe("board helpers (#56)", () => {
  test("a helper has the short list and nothing else, at every preset", () => {
    for (const preset of OFFICE_AGENT_PRESETS) {
      const names = toolsForAgent({ role: "kiosk", preset }).map((t) => t.name);
      for (const name of names) expect(KIOSK_TOOLS).toContain(name);
      // A preset still narrows it: an observer helper briefs and cannot queue.
      expect(names.includes("enqueue_task")).toBe(preset !== "observer");
    }
    // Nothing that writes anywhere but the queue.
    const writes = OFFICE_TOOLS.filter((t) => !t.readOnly && KIOSK_TOOLS.includes(t.name));
    expect(writes.map((t) => t.name)).toEqual(["enqueue_task"]);
    for (const name of ["comment_on_card", "post_chat", "spawn_henchman", "stop_henchman"]) {
      expect(agentMayUseTool({ role: "kiosk", preset: "manager" }, name as never)).toBe(false);
    }
    expect(agentMayUseTool({ role: "kiosk", preset: "coordinator" }, "enqueue_task")).toBe(true);
    expect(agentMayUseTool({ role: "kiosk", preset: "observer" }, "enqueue_task")).toBe(false);
  });

  test("every other job keeps what its preset gives", () => {
    for (const role of OFFICE_AGENT_ROLES.filter((r) => r !== "kiosk")) {
      for (const preset of OFFICE_AGENT_PRESETS) {
        // The preset's tools, without the watchdog's own (those are the office watchdog's only).
        expect(toolsForAgent({ role, preset, ownerUserId: "u1" })).toEqual(
          toolsForPreset(preset).filter((t) => t.role === undefined),
        );
      }
      // (A personal one: the office's own watchdog is the other restricted job, #253.)
      const personal = { role, preset: "manager", ownerUserId: "u1" } as const;
      expect(agentMayUseTool(personal, "spawn_henchman")).toBe(true);
    }
  });

  test("each board has a post, and a body can stand at it", () => {
    expect(KIOSK_BOARDS.map((b) => KIOSK_BOARD_POST[b])).toEqual([...KIOSK_POSTS]);
    for (const board of KIOSK_BOARDS) {
      const post = KIOSK_BOARD_POST[board];
      expect(OFFICE_AGENT_POSTS).toContain(post);
      expect(kioskBoardOfPost(post)).toBe(board);
      expect(OfficeAgentBody.shape.post.safeParse(post).success).toBe(true);
    }
    for (const post of ["none", "reception", "", undefined]) {
      expect(kioskBoardOfPost(post)).toBeUndefined();
    }
  });

  test("a placement names a room and a board, and runs like the PM unless told otherwise", () => {
    expect(KioskPlacement.parse({ operationId: "op-1", board: "queue" })).toEqual({
      operationId: "op-1",
      board: "queue",
      viaPm: true,
    });
    expect(KioskPlacement.safeParse({ operationId: "op-1", board: "wiki" }).success).toBe(false);
    expect(KioskPlacement.safeParse({ board: "queue" }).success).toBe(false);
    const made = CreateOfficeAgent.parse({
      name: "Apollo issues",
      owner: "office",
      engine: "cli-session",
      role: "kiosk",
      provider: "claude-code",
      model: "haiku",
      kiosk: { operationId: "op-1", board: "issues", viaPm: false },
    });
    expect(made.kiosk).toEqual({ operationId: "op-1", board: "issues", viaPm: false });
  });
});
