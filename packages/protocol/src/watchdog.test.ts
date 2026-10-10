/** The watchdog's shapes (#253): what a person may type, and which agent has its tools. */
import { describe, expect, test } from "bun:test";
import {
  agentMayUseTool,
  isOfficeWatchdog,
  OFFICE_TOOL_INPUTS,
  OFFICE_TOOLS,
  toolsForAgent,
  toolsForPreset,
} from "./office-agent-tools.ts";
import { defaultOfficeAgentAppearance } from "./office-agents.ts";
import {
  SaveWatchdogHost,
  sentrySourceKey,
  UpdateWatchdogSettings,
  WATCHDOG_LIMITS,
  WatchdogAppName,
  WatchdogHostKey,
  WatchdogHostName,
  WatchdogSshUser,
  watchdogIntervalLabel,
} from "./watchdog.ts";
import {
  isWatchdogRoundTool,
  WATCHDOG_ROUND_TOOLS,
  WATCHDOG_TOOL_SPECS,
} from "./watchdog-tools.ts";

const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE\n-----END OPENSSH PRIVATE KEY-----";

describe("what goes onto an ssh command line", () => {
  test("a host is a name or an address, never an option", () => {
    for (const ok of ["vps.example.com", "10.0.0.5", "prod-1", "2001:db8::1"]) {
      expect(WatchdogHostName.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      "-oProxyCommand=evil",
      "host name",
      "a;b",
      "$(id)",
      "",
      "host/path",
      "a@b",
    ]) {
      expect(WatchdogHostName.safeParse(bad).success).toBe(false);
    }
  });

  test("a user and a PM2 app name hold no shell", () => {
    expect(WatchdogSshUser.safeParse("watchdog").success).toBe(true);
    for (const bad of ["root;id", "-l", "Bob", "a b"]) {
      expect(WatchdogSshUser.safeParse(bad).success).toBe(false);
    }
    for (const ok of ["api", "web-2", "worker.cron", "app:blue"]) {
      expect(WatchdogAppName.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["api; rm -rf /", "--lines", "a b", "$(x)", "a|b", ""]) {
      expect(WatchdogAppName.safeParse(bad).success).toBe(false);
    }
  });

  test("a host key is known_hosts lines; a private key must look like one", () => {
    expect(WatchdogHostKey.safeParse("").success).toBe(true);
    expect(WatchdogHostKey.safeParse("vps.example.com ssh-ed25519 AAAAC3Nz").success).toBe(true);
    expect(WatchdogHostKey.safeParse("just some words").success).toBe(false);
    const host = { label: "p", host: "h.example", username: "watchdog", apps: [] };
    expect(SaveWatchdogHost.parse({ ...host, privateKey: KEY })).toMatchObject({
      port: 22,
      hostKey: "",
    });
    expect(SaveWatchdogHost.safeParse({ ...host, privateKey: "hunter2" }).success).toBe(false);
    expect(SaveWatchdogHost.safeParse({ ...host, port: 70_000 }).success).toBe(false);
  });
});

describe("settings", () => {
  test("the interval has a floor; the token can be set or removed, never empty", () => {
    expect(UpdateWatchdogSettings.safeParse({ intervalMinutes: 60 }).success).toBe(true);
    expect(UpdateWatchdogSettings.safeParse({ intervalMinutes: 1 }).success).toBe(false);
    expect(UpdateWatchdogSettings.safeParse({ sentryToken: null }).success).toBe(true);
    expect(UpdateWatchdogSettings.safeParse({ sentryToken: "" }).success).toBe(false);
    expect(UpdateWatchdogSettings.safeParse({}).success).toBe(false);
    expect(WATCHDOG_LIMITS.defaultIntervalMinutes).toBe(60);
    expect(watchdogIntervalLabel(60)).toBe("every hour");
    expect(watchdogIntervalLabel(240)).toBe("every 4 hours");
    expect(watchdogIntervalLabel(30)).toBe("every 30 minutes");
  });

  test("a Sentry issue is one key whatever its case; the caps for automatic fixes have a ceiling", () => {
    expect(sentrySourceKey("Acme", "web-1a")).toBe("sentry:acme/WEB-1A");
    expect(UpdateWatchdogSettings.safeParse({ autoFixPerRound: 0, autoFixPerDay: 3 }).success).toBe(
      true,
    );
    expect(UpdateWatchdogSettings.safeParse({ autoFixPerDay: 1000 }).success).toBe(false);
    expect(WATCHDOG_LIMITS.autoFixPerRoundDefault).toBe(1);
    expect(WATCHDOG_LIMITS.autoFixPerDayDefault).toBe(3);
  });
});

describe("the watchdog's tools", () => {
  const names = WATCHDOG_TOOL_SPECS.map((t) => t.name);
  const watchdog = { preset: "observer", role: "watchdog", ownerUserId: null } as const;
  const has = (agent: Parameters<typeof toolsForAgent>[0], turn?: "round" | "conversation") =>
    toolsForAgent(agent, turn).map((t) => t.name);

  test("the office's watchdog has its own tools and no others, whatever its preset", () => {
    expect(names.length).toBe(5);
    expect(has(watchdog)).toEqual(["watchdog_request_round", "watchdog_read_report"]);
    expect(has({ ...watchdog, preset: "manager" })).toEqual([
      "watchdog_request_round",
      "watchdog_read_report",
    ]);
    for (const tool of [
      "memory_save",
      "note_write",
      "ask_human",
      "post_chat",
      "list_operations",
    ] as const) {
      expect(agentMayUseTool({ ...watchdog, preset: "manager" }, tool)).toBe(false);
      expect(agentMayUseTool({ ...watchdog, preset: "manager" }, tool, "round")).toBe(false);
    }
  });

  test("a turn of a round has the three round tools only, and a conversation has none of them", () => {
    expect(has(watchdog, "round")).toEqual([
      "watchdog_check",
      "watchdog_record_finding",
      "watchdog_finish_round",
    ]);
    for (const tool of WATCHDOG_ROUND_TOOLS) {
      expect(agentMayUseTool(watchdog, tool)).toBe(false);
      expect(isWatchdogRoundTool(tool)).toBe(true);
    }
    expect(isWatchdogRoundTool("watchdog_read_report")).toBe(false);
  });

  test("no other agent has a watchdog tool, in any turn; a personal agent with that job is an ordinary one", () => {
    for (const role of ["pm", "assistant", "kiosk", "custom"] as const) {
      for (const turn of ["conversation", "round"] as const) {
        const tools = has({ preset: "manager", role, ownerUserId: null }, turn);
        for (const name of names) expect(tools).not.toContain(name);
      }
      // Nothing of anyone's works with a round turn's token but the round tools.
      expect(has({ preset: "manager", role, ownerUserId: null }, "round")).toEqual([]);
    }
    const personal = { preset: "coordinator", role: "watchdog", ownerUserId: "u1" } as const;
    expect(isOfficeWatchdog(personal)).toBe(false);
    expect(has(personal)).toEqual(toolsForPreset("coordinator").map((t) => t.name));
    // A preset alone never includes them.
    expect(toolsForPreset("manager").some((t) => t.role !== undefined)).toBe(false);
  });

  test('a finding names signals and line numbers; it has no field for evidence or for "it is back"', () => {
    for (const tool of OFFICE_TOOLS) expect(OFFICE_TOOL_INPUTS[tool.name]).toBeDefined();
    const parsed = OFFICE_TOOL_INPUTS.watchdog_record_finding.parse({
      title: "t",
      sources: [{ key: "pm2:a:err:b", lines: [1, 2], regressed: true }],
      disposition: "notify",
      reason: "r",
      evidence: "free text",
      regressed: true,
      operationId: "op-other",
    });
    expect(parsed).toEqual({
      title: "t",
      sources: [{ key: "pm2:a:err:b", lines: [1, 2] }],
      disposition: "notify",
      reason: "r",
    });
    expect(OFFICE_TOOL_INPUTS.watchdog_check.safeParse({}).success).toBe(true);
    // The conversation tools take no person: the office knows whose turn it is from its token.
    expect(OFFICE_TOOL_INPUTS.watchdog_request_round.parse({ onBehalfOf: "u9" })).toEqual({});
    expect(OFFICE_TOOL_INPUTS.watchdog_read_report.parse({ onBehalfOf: "u9" })).toEqual({});
  });

  test("the watchdog wears its own kit by default", () => {
    expect(defaultOfficeAgentAppearance("watchdog")).toBe("black_ops");
    expect(defaultOfficeAgentAppearance("pm")).toBe("number_two");
    expect(defaultOfficeAgentAppearance("assistant")).toBe("standard");
  });
});
