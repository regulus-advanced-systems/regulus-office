import { describe, expect, test } from "bun:test";
import { AdapterRegistry } from "./registry.ts";
import { agentIdFromSession, tmuxSessionName } from "./session.ts";
import { FakeAdapter } from "./testing/fake-adapter.ts";

describe("AdapterRegistry", () => {
  test("looks adapters up by provider id", () => {
    const claude = new FakeAdapter({ id: "claude-code" });
    const codex = new FakeAdapter({ id: "codex" });
    const registry = new AdapterRegistry([claude, codex]);
    expect(registry.get("claude-code")).toBe(claude);
    expect(registry.find("codex")).toBe(codex);
    expect(registry.has("gemini-cli")).toBe(false);
    expect(registry.find("gemini-cli")).toBeUndefined();
    expect(registry.providers().sort()).toEqual(["claude-code", "codex"]);
  });

  test("throws for missing and duplicate providers", () => {
    const registry = new AdapterRegistry().register(new FakeAdapter({ id: "codex" }));
    expect(() => registry.get("opencode")).toThrow(/No adapter/);
    expect(() => registry.register(new FakeAdapter({ id: "codex" }))).toThrow(/already/);
  });

  test("rejects ids outside PROVIDER_IDS", () => {
    const bogus = new FakeAdapter();
    Object.defineProperty(bogus, "id", { value: "not-a-provider" });
    expect(() => new AdapterRegistry([bogus])).toThrow(/Unknown provider/);
  });
});

describe("tmux session names", () => {
  test("round-trip agent ids", () => {
    expect(tmuxSessionName("a1_B-2")).toBe("agent-a1_B-2");
    expect(agentIdFromSession("agent-a1_B-2")).toBe("a1_B-2");
    expect(agentIdFromSession("main")).toBeNull();
  });

  test("reject ids tmux would treat as targets", () => {
    expect(() => tmuxSessionName("a.b")).toThrow();
    expect(() => tmuxSessionName("a:b")).toThrow();
    expect(() => tmuxSessionName("")).toThrow();
  });
});
