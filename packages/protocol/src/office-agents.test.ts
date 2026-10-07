import { describe, expect, test } from "bun:test";
import {
  OFFICE_TOOL_INPUTS,
  OFFICE_TOOLS,
  officeToolSpec,
  presetAllows,
  toolsForPreset,
} from "./office-agent-tools.ts";
import {
  CreateOfficeAgent,
  DEFAULT_OFFICE_AGENT_PRESET,
  DEFAULT_OFFICE_AGENT_SETTINGS,
  mayConfigureOfficeAgent,
  mayCreateOfficeAgent,
  mayEmergencyStopOfficeAgent,
  maySeeOfficeAgent,
  mayTalkToOfficeAgent,
  OFFICE_AGENT_ROLES,
  OfficeAgentSettings,
  UpdateOfficeAgent,
} from "./office-agents.ts";

const owner = { id: "olga", role: "owner" } as const;
const admin = { id: "ada", role: "admin" } as const;
const mia = { id: "mia", role: "member" } as const;
const sam = { id: "sam", role: "member" } as const;
const viewer = { id: "vic", role: "viewer" } as const;
const mias = { ownerUserId: "mia" };
const shared = { ownerUserId: null };

describe("office agents (#271)", () => {
  test("a personal agent is its owner's alone (D20, D32): admins see its card and may stop it, nothing more", () => {
    expect(mayTalkToOfficeAgent(mia, mias)).toBe(true);
    expect(mayConfigureOfficeAgent(mia, mias)).toBe(true);
    for (const other of [sam, admin, owner, viewer]) {
      expect(mayTalkToOfficeAgent(other, mias)).toBe(false);
      expect(mayConfigureOfficeAgent(other, mias)).toBe(false);
    }
    expect(maySeeOfficeAgent(sam, mias)).toBe(false);
    expect(maySeeOfficeAgent(admin, mias)).toBe(true);
    expect(mayEmergencyStopOfficeAgent(admin, mias)).toBe(true);
    expect(mayEmergencyStopOfficeAgent(owner, mias)).toBe(true);
    expect(mayEmergencyStopOfficeAgent(sam, mias)).toBe(false);
    // Stopping one's own is an ordinary stop.
    expect(mayEmergencyStopOfficeAgent(mia, mias)).toBe(false);
  });

  test("a shared agent serves members and above; viewers see its card only; owners and admins configure it", () => {
    for (const anyone of [owner, admin, mia]) {
      expect(maySeeOfficeAgent(anyone, shared)).toBe(true);
      expect(mayTalkToOfficeAgent(anyone, shared)).toBe(true);
    }
    // Talking to it spends the office key.
    expect(maySeeOfficeAgent(viewer, shared)).toBe(true);
    expect(mayTalkToOfficeAgent(viewer, shared)).toBe(false);
    expect(OfficeAgentSettings.safeParse({ ...DEFAULT_OFFICE_AGENT_SETTINGS }).success).toBe(true);
    expect(DEFAULT_OFFICE_AGENT_SETTINGS.sharedMessagesPerHour).toBe(20);
    expect(
      OfficeAgentSettings.safeParse({ ...DEFAULT_OFFICE_AGENT_SETTINGS, sharedMessagesPerHour: 0 })
        .success,
    ).toBe(false);
    expect(mayConfigureOfficeAgent(admin, shared)).toBe(true);
    expect(mayConfigureOfficeAgent(owner, shared)).toBe(true);
    expect(mayConfigureOfficeAgent(mia, shared)).toBe(false);
    expect(mayEmergencyStopOfficeAgent(admin, shared)).toBe(false);
    expect(mayCreateOfficeAgent(admin, "office")).toBe(true);
    expect(mayCreateOfficeAgent(mia, "office")).toBe(false);
    expect(mayCreateOfficeAgent(mia, "me")).toBe(true);
    expect(mayCreateOfficeAgent(viewer, "me")).toBe(false);
  });

  test("presets nest: observer reads and asks, coordinator queues and comments, manager spawns (D4)", () => {
    expect(DEFAULT_OFFICE_AGENT_PRESET).toBe("coordinator");
    const names = (p: Parameters<typeof toolsForPreset>[0]) => toolsForPreset(p).map((t) => t.name);
    expect(names("observer")).toEqual([
      "list_operations",
      "list_henchmen",
      "read_board",
      "read_queue",
      "read_usage",
      "ask_human",
      "read_human_request",
    ]);
    expect(names("coordinator")).toEqual([
      ...names("observer"),
      "enqueue_task",
      "comment_on_card",
      "post_chat",
    ]);
    expect(names("manager")).toEqual([...names("coordinator"), "spawn_henchman", "stop_henchman"]);
    expect(presetAllows("coordinator", "spawn_henchman")).toBe(false);
    expect(presetAllows("observer", "enqueue_task")).toBe(false);
    expect(presetAllows("manager", "stop_henchman")).toBe(true);
    expect(officeToolSpec("rm_rf")).toBeUndefined();
  });

  test("every tool has an input schema, and every write tool that spends a person's rights takes onBehalfOf", () => {
    expect(Object.keys(OFFICE_TOOL_INPUTS).sort()).toEqual(OFFICE_TOOLS.map((t) => t.name).sort());
    for (const name of ["enqueue_task", "spawn_henchman", "stop_henchman"] as const) {
      expect(Object.keys(OFFICE_TOOL_INPUTS[name].shape)).toContain("onBehalfOf");
    }
    expect(OFFICE_TOOLS.filter((t) => t.readOnly).every((t) => t.preset === "observer")).toBe(true);
  });

  test("create and update shapes: permanent names, roles, nothing to rename", () => {
    const base = {
      name: "Number Two",
      owner: "office",
      engine: "cli-session",
      role: "pm",
      provider: "claude-code",
      model: "sonnet",
    };
    expect(CreateOfficeAgent.parse(base)).toMatchObject({
      preset: "coordinator",
      instructions: "",
    });
    for (const role of OFFICE_AGENT_ROLES) {
      expect(CreateOfficeAgent.safeParse({ ...base, role }).success).toBe(true);
    }
    for (const name of ["", " ", "-dash", "semi;colon", "x".repeat(41), "new\nline"]) {
      expect(CreateOfficeAgent.safeParse({ ...base, name }).success).toBe(false);
    }
    expect(CreateOfficeAgent.safeParse({ ...base, owner: "user-7" }).success).toBe(false);
    expect(CreateOfficeAgent.safeParse({ ...base, preset: "root" }).success).toBe(false);
    expect(UpdateOfficeAgent.safeParse({}).success).toBe(false);
    expect(UpdateOfficeAgent.safeParse({ profileId: null }).success).toBe(true);
    // Unknown keys are dropped, so a rename is "nothing to change".
    expect(UpdateOfficeAgent.safeParse({ name: "Other" }).success).toBe(false);
  });
});
