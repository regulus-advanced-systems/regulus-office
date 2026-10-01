import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AGENT_ACTIONS,
  AGENT_ACTIVE_STATUSES,
  AGENT_STATUSES,
  AVATAR_ANIMATIONS,
  BACKEND_IDS,
  CREDENTIAL_AUTH_KINDS,
  EMOTES,
  isActiveAgentStatus,
  isAgentStatus,
  isOneOf,
  isProviderId,
  OPERATION_ACCESSES,
  PM_PRIVILEGES,
  PROVIDER_IDS,
  USER_ROLES,
} from "./enums.ts";

describe("enums", () => {
  test("active agent statuses (#237): mid-task only", () => {
    expect([...AGENT_ACTIVE_STATUSES]).toEqual([
      "starting",
      "working",
      "waiting_permission",
      "waiting_input",
    ]);
    expect(AGENT_STATUSES.filter(isActiveAgentStatus)).toEqual([...AGENT_ACTIVE_STATUSES]);
    for (const s of ["idle", "done", "error", "exited", "offline"] as const) {
      expect(isActiveAgentStatus(s)).toBe(false);
    }
  });

  test("match SPEC §6 agent status and action lists exactly", () => {
    expect(AGENT_STATUSES).toEqual([
      "starting",
      "idle",
      "working",
      "waiting_permission",
      "waiting_input",
      "done",
      "error",
      "exited",
      "offline",
    ]);
    expect(AGENT_ACTIONS).toEqual([
      "none",
      "typing",
      "reading",
      "editing",
      "running_tests",
      "browsing",
      "thinking",
      "failing",
      "celebrating",
    ]);
  });

  test("match SPEC §5, §7, §8 and M5 value lists", () => {
    expect(PROVIDER_IDS).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
      "kimi-code",
      "custom",
    ]);
    expect(BACKEND_IDS).toEqual(["linux-user", "docker"]);
    expect(USER_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
    expect(OPERATION_ACCESSES).toEqual(["manage", "spawn", "view"]);
    expect(CREDENTIAL_AUTH_KINDS).toEqual(["cli_login", "api_key", "base_url_key"]);
    expect(PM_PRIVILEGES).toEqual(["observer", "coordinator", "manager"]);
  });

  test("have no duplicate values", () => {
    for (const list of [AGENT_STATUSES, AGENT_ACTIONS, PROVIDER_IDS, AVATAR_ANIMATIONS, EMOTES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("every emote is an avatar animation", () => {
    for (const emote of EMOTES) expect(AVATAR_ANIMATIONS).toContain(emote);
  });

  test("type guards accept members and reject everything else", () => {
    expect(isAgentStatus("working")).toBe(true);
    expect(isAgentStatus("waiting_for_permission")).toBe(false);
    expect(isAgentStatus(42)).toBe(false);
    expect(isProviderId("codex")).toBe(true);
    expect(isProviderId("Codex")).toBe(false);
    const isAb = isOneOf(["a", "b"] as const);
    expect(isAb("a")).toBe(true);
    expect(isAb("c")).toBe(false);
  });

  test("arrays feed z.enum without loss", () => {
    const status = z.enum(AGENT_STATUSES);
    expect(status.options).toEqual([...AGENT_STATUSES]);
    expect(status.safeParse("idle").success).toBe(true);
    expect(status.safeParse("busy").success).toBe(false);
  });
});
