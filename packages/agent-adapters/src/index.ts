/**
 * @regulus/agent-adapters: one adapter per provider, pure TS (SPEC §7).
 *
 * - types.ts     AgentAdapter / AgentControl contract, SpawnPlan, RunnerContext, LoginFlowPlan
 * - secret.ts    Secret / SecretEnv: redacting wrappers for decrypted keys (SPEC §8)
 * - registry.ts  AdapterRegistry keyed by ProviderId
 * - session.ts   tmux session naming (`agent-<agentId>`)
 * - async-queue.ts  push queue backing `AgentControl.events`
 * - claude-code/ Claude Code adapter (tmux TUI + command-hook and statusline forwarders)
 * - codex/       Codex adapter (app-server JSON-RPC)
 * - testing/     FakeAdapter and an in-memory RunnerContext for tests
 */
export * from "./async-queue.ts";
export * from "./claude-code/index.ts";
export * from "./codex/index.ts";
export * from "./registry.ts";
export * from "./secret.ts";
export * from "./session.ts";
export * from "./testing/fake-adapter.ts";
export * from "./testing/fake-runner-context.ts";
export * from "./types.ts";
