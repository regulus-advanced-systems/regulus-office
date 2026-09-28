import { describe, expect, test } from "bun:test";
import type { CredentialProfileSummary } from "@regulus/protocol";
import { profileOptions } from "./api.ts";
import { CLAUDE_EFFORTS, PROVIDER_CHOICES, SPAWNABLE_PROVIDERS } from "./presets.ts";
import {
  initialSpawnValues,
  type SpawnContext,
  type SpawnRepoOption,
  validateSpawnForm,
  withProvider,
} from "./spawnForm.ts";

const repos: SpawnRepoOption[] = [
  { repoId: "r-docs", label: "acme/docs", ready: true, isPrimary: false },
  { repoId: "r-app", label: "acme/app", ready: true, isPrimary: true },
  { repoId: "r-new", label: "acme/new", ready: false, isPrimary: false },
];
const ctx: SpawnContext = { floorId: "f1", seatId: "desk-1-seat", repos };

describe("spawn form defaults", () => {
  test("primary ready repo, Claude Code, own login, worktree on", () => {
    const v = initialSpawnValues(repos, undefined);
    expect(v).toMatchObject({
      repoId: "r-app",
      provider: "claude-code",
      profileId: "",
      model: "opus",
      autoWorktree: true,
      issueNumber: "",
    });
  });

  test("prefill sets repo, issue, title and prompt", () => {
    const v = initialSpawnValues(repos, {
      repoId: "r-docs",
      issueNumber: 29,
      taskTitle: "Fix #29",
      prompt: "Do it",
    });
    expect(v).toMatchObject({
      repoId: "r-docs",
      issueNumber: "29",
      taskTitle: "Fix #29",
      prompt: "Do it",
    });
  });

  test("switching provider resets profile, model and effort", () => {
    const v = { ...initialSpawnValues(repos, undefined), profileId: "p1", effort: "max" };
    const codex = withProvider(v, "codex");
    expect(codex).toMatchObject({
      provider: "codex",
      profileId: "",
      model: "gpt-5-codex",
      effort: "",
    });
    expect(withProvider(codex, "codex")).toBe(codex);
  });

  test("only Claude Code and Codex are spawnable in M1; the rest say M4", () => {
    expect([...SPAWNABLE_PROVIDERS].sort()).toEqual(["claude-code", "codex"]);
    for (const p of PROVIDER_CHOICES.filter((c) => !SPAWNABLE_PROVIDERS.has(c.id)))
      expect(p.comingIn).toBe("M4");
  });
});

describe("spawn form validation and payload", () => {
  const base = () => ({
    ...initialSpawnValues(repos, undefined),
    prompt: "  Fix the login bug \n",
  });

  test("a minimal form becomes an agent.spawn payload for this desk", () => {
    const result = validateSpawnForm(base(), ctx);
    expect(result).toEqual({
      ok: true,
      payload: {
        floorId: "f1",
        repoId: "r-app",
        seatId: "desk-1-seat",
        provider: "claude-code",
        model: "opus",
        prompt: "Fix the login bug",
        autoWorktree: true,
      },
    });
  });

  test("optional fields are included only when set", () => {
    const result = validateSpawnForm(
      {
        ...base(),
        provider: "codex",
        model: " gpt-5-codex ",
        effort: "high",
        profileId: "office:codex",
        taskTitle: " Login bug ",
        issueNumber: "#42",
        autoWorktree: false,
      },
      ctx,
    );
    expect(result.ok && result.payload).toMatchObject({
      provider: "codex",
      model: "gpt-5-codex",
      effort: "high",
      profileId: "office:codex",
      taskTitle: "Login bug",
      issueNumber: 42,
      autoWorktree: false,
    });
  });

  test("the payload never carries anything secret-shaped", () => {
    const result = validateSpawnForm({ ...base(), profileId: "p-key" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.payload).sort()).toEqual(
        [
          "autoWorktree",
          "floorId",
          "model",
          "profileId",
          "prompt",
          "provider",
          "repoId",
          "seatId",
        ].sort(),
      );
    }
  });

  test("errors per field", () => {
    const result = validateSpawnForm(
      {
        ...base(),
        repoId: "r-new",
        model: "has space",
        prompt: "   ",
        issueNumber: "abc",
        taskTitle: "x".repeat(201),
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ["issueNumber", "model", "prompt", "repoId", "taskTitle"].sort(),
      );
    }
  });

  test("Claude effort must be one the CLI accepts; Codex effort is free text", () => {
    const bad = validateSpawnForm({ ...base(), effort: "turbo" }, ctx);
    expect(!bad.ok && bad.errors.effort).toContain(CLAUDE_EFFORTS.join(", "));
    const ok = validateSpawnForm({ ...base(), effort: "xhigh" }, ctx);
    expect(ok.ok).toBe(true);
    const codex = validateSpawnForm({ ...withProvider(base(), "codex"), effort: "turbo" }, ctx);
    expect(codex.ok).toBe(true);
  });

  test("disabled providers and missing models are refused", () => {
    const r = validateSpawnForm({ ...base(), provider: "gemini-cli", model: "" }, ctx);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["model", "provider"]);
    expect(validateSpawnForm({ ...base(), issueNumber: "0" }, ctx).ok).toBe(false);
  });
});

describe("credential options", () => {
  const profiles: CredentialProfileSummary[] = [
    {
      id: "office:claude-code",
      label: "Office Anthropic",
      provider: "claude-code",
      authKind: "api_key",
      owner: "office",
    },
    { id: "p1", label: "My key", provider: "claude-code", authKind: "api_key", owner: "me" },
    { id: "p2", label: "Z.AI", provider: "claude-code", authKind: "base_url_key", owner: "me" },
    { id: "p3", label: "Codex key", provider: "codex", authKind: "api_key", owner: "me" },
  ];

  test("own login first, then own profiles, then office keys, for the provider only", () => {
    expect(profileOptions("claude-code", "Claude Code", profiles)).toEqual([
      { value: "", label: "Your Claude Code login" },
      { value: "p1", label: "My key (API key)" },
      { value: "p2", label: "Z.AI (plan key)" },
      { value: "office:claude-code", label: "Office key: Office Anthropic" },
    ]);
  });
});
