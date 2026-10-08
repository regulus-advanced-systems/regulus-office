import { describe, expect, test } from "bun:test";
import { PROVIDER_PRESETS } from "./model-presets.ts";
import {
  agentModelLabel,
  agentModelsFor,
  defaultAgentModel,
  RUNS_ON_KINDS,
  sessionEngineRuns,
} from "./office-agent-runs-on.ts";
import {
  CreateOfficeAgent,
  DEFAULT_OFFICE_AGENT_APPEARANCE,
  defaultOfficeAgentAppearance,
  isOfficeAgentAppearance,
  OFFICE_AGENT_APPEARANCES,
  officeAgentAppearanceLabel,
  UpdateOfficeAgent,
} from "./office-agents.ts";
import { KEY_PRESETS } from "./provider-connect.ts";
import { HENCHMAN_SKIN_IDS } from "./skins.ts";

describe("what an office agent runs on (#280)", () => {
  test("DeepSeek lists its own models from the key preset, strong and cheap marked", () => {
    expect(agentModelsFor("deepseek")).toEqual([
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        hint: "DeepSeek's most capable model",
        tier: "strong",
      },
      {
        id: "deepseek-flash",
        label: "DeepSeek Flash",
        hint: "Fast and inexpensive, for everyday work",
        tier: "cheap",
      },
    ]);
    // Not a second list: every id is one the preset itself maps a Claude Code name to.
    const preset = Object.values(KEY_PRESETS.deepseek.modelOverrides ?? {});
    for (const m of agentModelsFor("deepseek")) expect(preset).toContain(m.id);
    expect(defaultAgentModel("deepseek")).toBe("deepseek-flash");
    expect(agentModelLabel("deepseek", "deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
  });

  test("a Claude login or key lists the spawn dialog's Claude models; one cheap and one strong", () => {
    const claude = PROVIDER_PRESETS.find((p) => p.id === "claude-code")?.models ?? [];
    for (const kind of ["login", "anthropic", "zai", "custom-claude"] as const) {
      expect(agentModelsFor(kind).map((m) => m.id)).toEqual(claude.map((m) => m.id));
    }
    const tiers = agentModelsFor("login").flatMap((m) => (m.tier ? [`${m.id}:${m.tier}`] : []));
    expect(tiers.sort()).toEqual(["haiku:cheap", "opus:strong"]);
    expect(defaultAgentModel("login")).toBe("sonnet");
    // A model somebody typed is shown as typed.
    expect(agentModelLabel("login", "my-own-model")).toBe("my-own-model");
    expect(agentModelLabel(undefined, "sonnet")).toBe("Sonnet");
    // One model: nothing to compare, so no mark.
    expect(agentModelsFor("kimi")).toEqual([
      { id: "k3-256k", label: "Kimi K3", hint: "The Kimi Code plan's model" },
    ]);
  });

  test("the session engine runs what goes through Claude Code, DeepSeek included; not Codex or Gemini keys", () => {
    const runs = RUNS_ON_KINDS.filter((k) => k !== "login" && sessionEngineRuns(k));
    expect(runs).toEqual(["anthropic", "deepseek", "zai", "kimi", "custom-claude"]);
  });

  test("appearance: the henchman skins plus secretary; looks only, validated on create and change", () => {
    expect(OFFICE_AGENT_APPEARANCES).toEqual([...new Set([...HENCHMAN_SKIN_IDS, "secretary"])]);
    // Whatever the art adds to the skin list is offered with no change here.
    for (const id of HENCHMAN_SKIN_IDS) expect(isOfficeAgentAppearance(id)).toBe(true);
    expect(officeAgentAppearanceLabel("lab_coat")).toBe("Lab coat");
    expect(officeAgentAppearanceLabel("secretary")).toBe("Secretary");
    const base = {
      name: "Scout",
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      provider: "claude-code",
      model: "deepseek-flash",
    };
    // None chosen: the default for the job, which for a project manager is the PM suit (#60).
    expect(CreateOfficeAgent.parse(base).appearance).toBeUndefined();
    expect(defaultOfficeAgentAppearance("assistant")).toBe(DEFAULT_OFFICE_AGENT_APPEARANCE);
    expect(defaultOfficeAgentAppearance("pm")).toBe("number_two");
    expect(isOfficeAgentAppearance(defaultOfficeAgentAppearance("pm"))).toBe(true);
    expect(CreateOfficeAgent.parse({ ...base, appearance: "secretary" }).appearance).toBe(
      "secretary",
    );
    expect(CreateOfficeAgent.safeParse({ ...base, appearance: "dragon" }).success).toBe(false);
    expect(UpdateOfficeAgent.safeParse({ appearance: "chef" }).success).toBe(true);
    expect(UpdateOfficeAgent.safeParse({ appearance: "" }).success).toBe(false);
  });
});
