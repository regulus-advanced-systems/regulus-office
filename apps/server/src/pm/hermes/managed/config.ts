/**
 * What a managed Hermes is started with (#57): its `config.yaml` and the
 * environment of its gateway, made from the agent's key profile and its own
 * office token.
 *
 * Read from Hermes Agent's source and docs at release v2026.9.24 (0.21.5):
 * - `model.provider` / `model.default` in `config.yaml` pick the provider and
 *   the model; the key comes from the provider's own variable
 *   (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`).
 * - `mcp_servers.<name>.url` + `headers` add an MCP server over HTTP, and
 *   `${VAR}` in any string of `config.yaml` is replaced from the environment.
 *
 * So no secret is written to disk: `config.yaml` names the office MCP server
 * with `Bearer ${OFFICE_AGENT_TOKEN}`, and the token and the model key exist
 * only in the gateway's environment.
 *
 * How an office key profile maps onto a Hermes provider:
 * - **Anthropic API key**: provider `anthropic`. The office stores Claude
 *   Code's aliases (`opus`, `sonnet`, ...); Hermes takes the API's model ids.
 * - **DeepSeek**: the office's profile points Claude Code at DeepSeek's
 *   Anthropic-compatible address; Hermes has its own `deepseek` provider for
 *   DeepSeek's native API, which the same key opens, and takes the same
 *   model names (`deepseek-flash`, `deepseek-v4-pro`).
 * Everything else is refused in plain words rather than guessed at: a wrong
 * mapping could send a key to a provider it does not belong to.
 */
import type { SpawnCredential } from "@regulus/agent-adapters";
import { managedHermesRunsOn, type OfficeAgentRunsOn } from "@regulus/protocol";
import { type EngineAgent, type EngineOffice, EngineRefusal } from "../../engines/types.ts";

export type HermesKeyKind = OfficeAgentRunsOn["kind"];

/** The variable `config.yaml` reads the agent's office token from. */
export const OFFICE_TOKEN_ENV = "OFFICE_AGENT_TOKEN";

/** Claude Code's model aliases as Anthropic API model ids (checked 2026-10-08). */
const ANTHROPIC_MODELS: Readonly<Record<string, string>> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5-1",
};

const PROVIDERS = {
  anthropic: {
    provider: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    model: (model: string) => ANTHROPIC_MODELS[model] ?? model,
  },
  deepseek: { provider: "deepseek", keyEnv: "DEEPSEEK_API_KEY", model: (model: string) => model },
} as const;

/** Why a kind of key cannot run a Hermes, or null when it can. Safe to show. */
export function keyKindProblem(kind: HermesKeyKind): string | null {
  if (managedHermesRunsOn(kind)) return null;
  if (kind === "login") {
    return "a Hermes run by the office needs an API key to run on: a subscription login cannot be used for it";
  }
  if (kind === "unknown") return "the key this agent ran on is gone: pick another one";
  return "a Hermes run by the office runs on an Anthropic API key or a DeepSeek key; this kind of key is not supported for it yet";
}

export interface HermesSetup {
  env: Record<string, string>;
  files: Array<{ path: string; contents: string }>;
  /** Every secret in `env`, to be cut out of anything the gateway prints. */
  secrets: string[];
}

/** A YAML double-quoted scalar (JSON's string syntax is a subset of it). */
const q = (value: string) => JSON.stringify(value);

export function hermesSetup(input: {
  agent: Pick<EngineAgent, "model">;
  credential: SpawnCredential;
  keyKind: HermesKeyKind;
  office: Pick<EngineOffice, "mcpUrl" | "token">;
}): HermesSetup {
  const { credential, keyKind, office } = input;
  const problem = keyKindProblem(keyKind);
  if (problem || !managedHermesRunsOn(keyKind) || credential.kind === "cli_login") {
    throw new EngineRefusal(
      "hermes_key_unsupported",
      problem ?? (keyKindProblem("login") as string),
    );
  }
  const provider = PROVIDERS[keyKind];
  const model = provider.model(input.agent.model.trim());
  if (!model || /[\s"'${}]/.test(model)) {
    throw new EngineRefusal("hermes_model_invalid", "that model name cannot be used with Hermes");
  }
  const key = credential.apiKey.reveal();
  const token = office.token.reveal();
  const config = [
    "# Written by the Regulus Office at every start of this agent. Changes here are overwritten.",
    "model:",
    `  provider: ${q(provider.provider)}`,
    `  default: ${q(model)}`,
    "mcp_servers:",
    "  office:",
    `    url: ${q(office.mcpUrl)}`,
    "    headers:",
    // Hermes fills this in from its environment: the token itself is never on disk.
    `      Authorization: ${q(`Bearer \${${OFFICE_TOKEN_ENV}}`)}`,
    "",
  ].join("\n");
  return {
    env: { [provider.keyEnv]: key, [OFFICE_TOKEN_ENV]: token },
    files: [{ path: "config.yaml", contents: config }],
    secrets: [key, token],
  };
}
