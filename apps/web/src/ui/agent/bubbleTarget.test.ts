import { beforeEach, describe, expect, test } from "bun:test";
import type { PendingPermission } from "@regulus/protocol";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { useAgentStore } from "./agentStore.ts";
import { openBubbleTarget, openHenchmanRequest, setConversationOpener } from "./bubbleTarget.ts";

const request = { requestId: "r1" } as PendingPermission;

beforeEach(() => {
  useAgentStore.getState().reset();
  useTerminalModal.getState().closeTerminal();
});

describe("a click on a bubble", () => {
  test("a permission target opens the request for its controller, the panel for anyone else", () => {
    useAgentStore.getState().setPermissions("a1", [request]);
    useAgentStore.getState().closePermissionPrompt();
    expect(openBubbleTarget({ targetKind: "permission", targetId: "a1" })).toBe(true);
    expect(useAgentStore.getState().permissionAgentId).toBe("a1");

    expect(openBubbleTarget({ targetKind: "permission", targetId: "a2" })).toBe(true);
    expect(useAgentStore.getState().panelAgentId).toBe("a2");
    expect(useAgentStore.getState().permissionAgentId).toBe("a1");
  });

  test("a terminal target opens the terminal; no target opens nothing", () => {
    expect(openBubbleTarget({ targetKind: "terminal", targetId: "a1" })).toBe(true);
    expect(useTerminalModal.getState().agentId).toBe("a1");
    expect(openBubbleTarget({ targetKind: "none", targetId: "" })).toBe(false);
    expect(openBubbleTarget({ targetKind: "terminal", targetId: "" })).toBe(false);
  });

  test("a conversation target waits for office agents to register how it opens", () => {
    expect(openBubbleTarget({ targetKind: "conversation", targetId: "pm" })).toBe(false);
    const opened: string[] = [];
    const off = setConversationOpener((id) => opened.push(id));
    expect(openBubbleTarget({ targetKind: "conversation", targetId: "pm" })).toBe(true);
    expect(opened).toEqual(["pm"]);
    off();
    expect(openBubbleTarget({ targetKind: "conversation", targetId: "pm" })).toBe(false);
  });
});

describe("a click on a notification", () => {
  test("needs permission opens the request", () => {
    useAgentStore.getState().setPermissions("a1", [request]);
    useAgentStore.getState().closePermissionPrompt();
    openHenchmanRequest("a1", "needs_permission");
    expect(useAgentStore.getState().permissionAgentId).toBe("a1");
  });

  test("needs input opens the terminal; the rest open the panel", () => {
    openHenchmanRequest("a1", "needs_input");
    expect(useTerminalModal.getState().agentId).toBe("a1");
    useTerminalModal.getState().closeTerminal();
    openHenchmanRequest("a2", "done");
    expect(useAgentStore.getState().panelAgentId).toBe("a2");
    expect(useTerminalModal.getState().agentId).toBeNull();
  });
});
