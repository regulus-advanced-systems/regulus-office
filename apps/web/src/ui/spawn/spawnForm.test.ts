import { describe, expect, test } from "bun:test";
import type { CredentialProfileSummary } from "@regulus/protocol";
import {
  type AccessByProvider,
  credentialOptions,
  defaultCredential,
  providerUsable,
} from "./credentials.ts";
import { defaultEffortFor, PROVIDER_PRESETS, SPAWNABLE_PROVIDERS } from "./models.ts";
import { permissionModeOptions } from "./permissionModes.ts";
import {
  effectiveCredential,
  effectivePermissionModeOf,
  initialSpawnValues,
  MORE_OPTION_FIELDS,
  type SpawnContext,
  type SpawnRepoOption,
  usableDefault,
  validateSpawnForm,
  withModel,
} from "./spawnForm.ts";

const repos: SpawnRepoOption[] = [
  { repoId: "r-docs", label: "acme/docs", ready: true, isPrimary: false },
  { repoId: "r-app", label: "acme/app", ready: true, isPrimary: true },
  { repoId: "r-new", label: "acme/new", ready: false, isPrimary: false },
];

const office = (provider: "claude-code" | "codex"): CredentialProfileSummary => ({
  id: `office:${provider}`,
  label: "Team key",
  provider,
  authKind: "api_key",
  owner: "office",
});
const ownKey: CredentialProfileSummary = {
  id: "p1",
  label: "My key",
  provider: "claude-code",
  authKind: "api_key",
  owner: "me",
};

const loggedIn: AccessByProvider = {
  "claude-code": { login: true, profiles: [] },
  codex: { login: true, profiles: [] },
};
const ctx = (access: AccessByProvider = loggedIn): SpawnContext => ({
  operationId: "f1",
  seatId: "desk-1-seat",
  repos,
  access,
});

describe("model presets", () => {
  test("Claude Code and Codex, each with a default model that it lists", () => {
    expect([...SPAWNABLE_PROVIDERS]).toEqual(["claude-code", "codex"]);
    for (const p of PROVIDER_PRESETS) {
      expect(p.models.map((m) => m.id)).toContain(p.defaultModel);
      for (const m of p.models) {
        if (m.defaultEffort) expect(m.efforts).toContain(m.defaultEffort);
        // Model names are passed to the CLI as-is.
        expect(m.id).toMatch(/^[a-z0-9.[\]-]+$/);
      }
    }
  });

  test("effort defaults per model; none for a model without effort", () => {
    expect(defaultEffortFor("claude-code", "opus")).toBe("medium");
    expect(defaultEffortFor("claude-code", "haiku")).toBe("");
    expect(defaultEffortFor("codex", "gpt-6-sol")).toBe("medium");
  });
});

describe("spawn form defaults", () => {
  test("primary ready repo, Opus at medium, default credential, worktree on, no prompt", () => {
    expect(initialSpawnValues(repos, undefined)).toEqual({
      repoId: "r-app",
      provider: "claude-code",
      model: "opus",
      effort: "medium",
      permissionMode: null,
      profileId: null,
      prompt: "",
      taskTitle: "",
      issueNumber: "",
      autoWorktree: true,
    });
  });

  test("prefill sets repo, issue, title and prompt", () => {
    const v = initialSpawnValues(repos, {
      repoId: "r-docs",
      issueNumber: 29,
      taskTitle: "Fix #29",
      prompt: "Do it",
    });
    expect(v).toMatchObject({ repoId: "r-docs", issueNumber: "29", taskTitle: "Fix #29" });
  });

  test("picking a model sets its provider and default effort, and resets the credential", () => {
    const v = { ...initialSpawnValues(repos, undefined), profileId: "p1", effort: "max" };
    const codex = withModel(v, "codex", "gpt-6-luna");
    expect(codex).toMatchObject({
      provider: "codex",
      model: "gpt-6-luna",
      effort: "high",
      profileId: null,
    });
    expect(withModel(codex, "codex", "gpt-6-luna")).toBe(codex);
    expect(withModel(v, "claude-code", "haiku")).toMatchObject({ effort: "", profileId: "p1" });
  });

  test("an unconnected default provider gives way to the first usable one", () => {
    const v = initialSpawnValues(repos, undefined);
    const noClaude: AccessByProvider = {
      "claude-code": { login: false, profiles: [] },
      codex: { login: true, profiles: [] },
    };
    expect(usableDefault(v, noClaude)).toMatchObject({ provider: "codex", model: "gpt-6-sol" });
    expect(usableDefault(v, loggedIn)).toBe(v);
    // Nothing connected: stay put (the form shows Connect links).
    const none: AccessByProvider = {
      "claude-code": { login: false, profiles: [] },
      codex: { login: false, profiles: [] },
    };
    expect(usableDefault(v, none)).toBe(v);
  });
});

describe("default credential", () => {
  test("own connected login, else own key, else the office key, else own login", () => {
    expect(defaultCredential({ login: true, profiles: [office("claude-code"), ownKey] })).toBe("");
    expect(defaultCredential({ login: false, profiles: [office("claude-code"), ownKey] })).toBe(
      "p1",
    );
    expect(defaultCredential({ login: false, profiles: [office("claude-code")] })).toBe(
      "office:claude-code",
    );
    expect(defaultCredential({ login: null, profiles: [office("claude-code")] })).toBe(
      "office:claude-code",
    );
    expect(defaultCredential({ login: null, profiles: [] })).toBe("");
    expect(defaultCredential(undefined)).toBe("");
  });

  test("a provider is usable unless its login is known missing and there is no key", () => {
    expect(providerUsable({ login: false, profiles: [] })).toBe(false);
    expect(providerUsable({ login: false, profiles: [office("codex")] })).toBe(true);
    expect(providerUsable({ login: null, profiles: [] })).toBe(true);
    expect(providerUsable({ login: undefined, profiles: [] })).toBe(true);
  });

  test("a hand-picked credential wins over the default", () => {
    const access: AccessByProvider = {
      "claude-code": { login: false, profiles: [office("claude-code")] },
    };
    const v = initialSpawnValues(repos, undefined);
    expect(effectiveCredential(v, access)).toBe("office:claude-code");
    expect(effectiveCredential({ ...v, profileId: "" }, access)).toBe("");
  });

  test("options: own login first, then own profiles, then office keys", () => {
    const plan: CredentialProfileSummary = {
      ...ownKey,
      id: "p2",
      label: "Z.AI",
      authKind: "base_url_key",
    };
    expect(
      credentialOptions("Claude Code", {
        login: false,
        profiles: [office("claude-code"), ownKey, plan],
      }),
    ).toEqual([
      { value: "", label: "Your Claude Code login (not connected)" },
      { value: "p1", label: "My key (API key)" },
      { value: "p2", label: "Z.AI (plan key)" },
      { value: "office:claude-code", label: "Office key: Team key" },
    ]);
  });
});

describe("spawn form validation and payload", () => {
  const base = () => initialSpawnValues(repos, undefined);

  test("permission mode: omitted by default, sent when picked, reset with the provider (#166)", () => {
    const v = base();
    expect(effectivePermissionModeOf(v)).toBe("auto");
    const auto = validateSpawnForm(v, ctx());
    expect(auto.ok && "permissionMode" in auto.payload).toBe(false);

    const manual = validateSpawnForm({ ...v, permissionMode: "default" }, ctx());
    expect(manual.ok && manual.payload.permissionMode).toBe("default");

    const codex = withModel({ ...v, permissionMode: "acceptEdits" }, "codex", "gpt-6-sol");
    expect(codex.permissionMode).toBeNull();
    expect(effectivePermissionModeOf(codex)).toBe("on-request");
    const never = validateSpawnForm({ ...codex, permissionMode: "never" }, ctx());
    expect(never.ok && never.payload.permissionMode).toBe("never");
    expect(
      withModel({ ...v, permissionMode: "default" }, "claude-code", "sonnet").permissionMode,
    ).toBe("default");
  });

  test("a permission mode of another provider is refused under More options (#166)", () => {
    const result = validateSpawnForm({ ...base(), permissionMode: "never" }, ctx());
    expect(result).toMatchObject({ ok: false, errors: { permissionMode: expect.any(String) } });
    expect(MORE_OPTION_FIELDS).toContain("permissionMode");
    expect(permissionModeOptions("claude-code").map((o) => [o.value, o.isDefault])).toEqual([
      ["auto", true],
      ["default", false],
      ["acceptEdits", false],
    ]);
    expect(permissionModeOptions("codex").map((o) => o.value)).toEqual(["on-request", "never"]);
    expect(permissionModeOptions("custom")).toEqual([]);
  });

  test("the defaults alone make a payload: empty prompt, worktree on, own login", () => {
    expect(validateSpawnForm(base(), ctx())).toEqual({
      ok: true,
      payload: {
        operationId: "f1",
        repoId: "r-app",
        seatId: "desk-1-seat",
        provider: "claude-code",
        model: "opus",
        effort: "medium",
        prompt: "",
        autoWorktree: true,
      },
    });
  });

  test("without a connected login the office key is sent", () => {
    const access: AccessByProvider = {
      "claude-code": { login: false, profiles: [office("claude-code")] },
    };
    const result = validateSpawnForm(base(), ctx(access));
    expect(result.ok && result.payload.profileId).toBe("office:claude-code");
  });

  test("More options fields are included when set", () => {
    const result = validateSpawnForm(
      {
        ...withModel(base(), "codex", "gpt-6-astra"),
        effort: "ultra",
        profileId: "office:codex",
        prompt: "  Fix the login bug \n",
        taskTitle: " Login bug ",
        issueNumber: "#42",
        autoWorktree: false,
      },
      ctx(),
    );
    expect(result.ok && result.payload).toMatchObject({
      provider: "codex",
      model: "gpt-6-astra",
      effort: "ultra",
      profileId: "office:codex",
      prompt: "Fix the login bug",
      taskTitle: "Login bug",
      issueNumber: 42,
      autoWorktree: false,
    });
  });

  test("a model without effort sends none", () => {
    const result = validateSpawnForm(withModel(base(), "claude-code", "haiku"), ctx());
    expect(result.ok && "effort" in result.payload).toBe(false);
  });

  test("the payload never carries anything secret-shaped", () => {
    const result = validateSpawnForm({ ...base(), profileId: "p-key" }, ctx());
    expect(result.ok && Object.keys(result.payload).sort()).toEqual(
      [
        "autoWorktree",
        "effort",
        "operationId",
        "model",
        "profileId",
        "prompt",
        "provider",
        "repoId",
        "seatId",
      ].sort(),
    );
  });

  test("errors per field", () => {
    const result = validateSpawnForm(
      {
        ...base(),
        repoId: "r-new",
        model: "gpt-6-sol",
        effort: "turbo",
        prompt: "x".repeat(20_001),
        issueNumber: "abc",
        taskTitle: "x".repeat(201),
      },
      ctx(),
    );
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
      ["issueNumber", "model", "prompt", "repoId", "taskTitle"].sort(),
    );
    const effort = validateSpawnForm({ ...base(), effort: "turbo" }, ctx());
    expect(!effort.ok && effort.errors.effort).toBe("Pick an effort.");
    expect(validateSpawnForm({ ...base(), issueNumber: "0" }, ctx()).ok).toBe(false);
  });

  test("an unconnected provider is refused with a hint to connect it", () => {
    const access: AccessByProvider = { "claude-code": { login: false, profiles: [] } };
    const result = validateSpawnForm(base(), ctx(access));
    expect(!result.ok && result.errors.model).toBe(
      "Connect Claude Code first, or pick another model.",
    );
  });
});
