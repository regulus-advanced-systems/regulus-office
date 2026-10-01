/**
 * The adapter contract (SPEC §7). One `AgentAdapter` per provider; the server
 * picks it from the registry by `ProviderId`, asks it for a `SpawnPlan`, hands
 * the plan to the human's runner (SPEC §8) and then drives the agent through
 * the returned `AgentControl`.
 *
 * Adapters are pure TS: everything they need from the runner comes through
 * `RunnerContext.runner` (`RunnerOps`), which the server implements on top of
 * its `Runner` backends (apps/server/src/runners/types.ts).
 *
 * Wire types (events, samples, enums) come from `@regulus/protocol`.
 */
import type {
  AgentEvent,
  AgentStatus,
  BackendId,
  LimitSample,
  LoginFlow,
  PermissionDecision,
  ProviderId,
  UsageSample,
} from "@regulus/protocol";
import type { Secret, SecretEnv } from "./secret.ts";

// ---- Capabilities -----------------------------------------------------------

export interface AdapterCapabilities {
  /** Has a structured control channel (JSON-RPC, stream-json, ACP, hooks). */
  structured: boolean;
  /** Can open the provider's interactive TUI on the same session. */
  attachTui: boolean;
  /** TUI and structured channel can drive the session at the same time. */
  coDrive: boolean;
  /** Can resume a previous provider session. */
  resume: boolean;
  /** Reports token usage in-band (not only via transcript scan). */
  usageInband: boolean;
  /** Reports plan limits (five-hour / weekly windows, credits). */
  limits: boolean;
  /** Login can be driven by a device code rendered in the office UI. */
  deviceLogin: boolean;
}

// ---- Spawn ------------------------------------------------------------------

/**
 * Credential chosen for a spawn. Subscription logins (`cli_login`) carry no
 * secret: the unmodified CLI reads its own credential from the runner's HOME
 * (SPEC §8 rule 1). Keys are decrypted by the server only at spawn time.
 */
export type SpawnCredential =
  | { kind: "cli_login" }
  | { kind: "api_key"; apiKey: Secret; attributedTo: "user" | "office" }
  | {
      kind: "base_url_key";
      baseUrl: string;
      apiKey: Secret;
      /** Provider-specific model aliases, e.g. `{ opus: "glm-5" }`. */
      modelOverrides?: Readonly<Record<string, string>>;
      attributedTo: "user" | "office";
    };

export interface SpawnRequest {
  agentId: string;
  provider: ProviderId;
  model?: string;
  effort?: string;
  /**
   * Permission mode in the provider's own terms (#166, protocol
   * `permission-modes.ts`); omitted = the provider default. Adapters refuse a
   * value their provider does not accept.
   */
  permissionMode?: string;
  /** Working directory inside the runner (repo checkout or agent worktree). */
  workdir: string;
  /** First prompt, if the task starts with one. */
  prompt?: string;
  /** Provider session to resume (`agents.providerSessionId`). */
  resumeSessionId?: string;
  credential: SpawnCredential;
}

/** A file the runner writes (as the human's runner identity) before exec. */
export interface PlannedFile {
  /** Absolute path inside the runner. */
  path: string;
  /** Use `Secret` for contents that embed a key or hook token. */
  contents: string | Secret;
  /** POSIX mode, default 0o600. */
  mode?: number;
}

export interface SpawnPlan {
  agentId: string;
  provider: ProviderId;
  /** Program and arguments. Never put secrets here: argv is visible in `ps`. */
  argv: readonly string[];
  /**
   * Environment for the agent process. Secret-bearing: decrypted keys go here
   * at spawn time (SPEC §8 rule 2), so it is a `SecretEnv` that redacts itself
   * when logged or serialised.
   */
  env: SecretEnv;
  /** Working directory inside the runner. */
  cwd: string;
  /** tmux session name, `agent-<agentId>` (SPEC §4.4). */
  tmuxSession: string;
  /** Hook settings, statusline scripts, etc. written before exec. */
  files: readonly PlannedFile[];
  /** Known up front when the adapter chooses it (e.g. `claude --session-id`). */
  providerSessionId?: string;
  /**
   * Validated permission mode for adapters that apply it after start rather
   * than on argv (Codex: `approvalPolicy` on `thread/start|resume`).
   */
  permissionMode?: string;
}

// ---- Runner context ---------------------------------------------------------

/** A process started with piped stdio (e.g. `codex app-server` over stdio). */
export interface PipedProcess {
  readonly pid: number;
  write(chunk: string | Uint8Array): Promise<void>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** Resolves with the exit code (or null when killed by a signal). */
  readonly exited: Promise<number | null>;
  kill(signal?: NodeJS.Signals): void;
}

/**
 * What an adapter may do inside one human's runner. Implemented by the server
 * over `Runner` (bound to that human); faked in adapter tests.
 */
export interface RunnerOps {
  /** Type into a tmux session; `enter` appends Enter. Used for TUI-primary agents. */
  sendKeys(session: string, keys: string, opts?: { enter?: boolean }): Promise<void>;
  /** Last `lines` lines of the pane, for the capture-pane rung of the status ladder. */
  capturePane(session: string, lines: number): Promise<string>;
  /** Current pane title (set by the agent via OSC 0/2), for the OSC-title rung. */
  paneTitle(session: string): Promise<string>;
  /** Start a side process with piped stdio in the runner, outside tmux. */
  spawnPiped(plan: SpawnPlan): Promise<PipedProcess>;
  /** Read a UTF-8 file in the runner (transcripts); null when absent. */
  readTextFile(path: string): Promise<string | null>;
  /** Entry names in a runner directory; empty when absent. */
  listDir(path: string): Promise<string[]>;
}

export interface RunnerContext {
  backend: BackendId;
  /** Office user id of the human who owns the runner. */
  userId: string;
  /** HOME of the runner identity, where provider CLIs keep their own credentials. */
  home: string;
  runner: RunnerOps;
  /**
   * Base URL of the office as reachable from inside the runner, for hook and
   * statusline forwarders (e.g. `http://office-server:3000`).
   */
  officeUrl: string;
  /** Per-agent token the hook forwarders authenticate with; set for spawns. */
  agentToken?: Secret;
  now(): number;
}

// ---- Records, control -------------------------------------------------------

/** Adapter view of a persisted `agents` row (SPEC §5). */
export interface AgentRecord {
  agentId: string;
  ownerUserId: string;
  provider: ProviderId;
  model?: string;
  effort?: string;
  /** Stored permission mode (#166); omitted for rows from before it. */
  permissionMode?: string;
  profileId: string;
  status: AgentStatus;
  providerSessionId?: string;
  tmuxSession: string;
  workdir: string;
  worktreeBranch?: string;
}

/** A file handed to the agent with a prompt; `path` is inside the runner. */
export interface PromptAttachment {
  name: string;
  mimeType: string;
  path: string;
}

export interface AgentControl {
  /** status, action, message chunk, tool_call, permission_request, usage, limit, exit. */
  readonly events: AsyncIterable<AgentEvent>;
  prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  respondPermission(id: string, decision: PermissionDecision): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  /** Provider session id once known (Codex thread id, Claude session id). */
  providerSessionId(): string | undefined;
  /**
   * Per-request resolution signal (optional): `listener` gets the id of each
   * permission request that stops being pending, whether it was answered,
   * cancelled by the provider (turn ended, interrupted) or expired. Adapters
   * that implement it let the office keep parallel requests apart; without
   * it the office drops every request once the agent stops waiting.
   * Returns an unsubscribe function.
   */
  onPermissionResolved?(listener: PermissionResolvedListener): () => void;
}

export type PermissionResolvedListener = (requestId: string) => void;

/**
 * Input that reaches the office outside the control channel: Claude Code
 * http hooks and statusline forwarder, Codex `notify`. The server route
 * authenticates it, finds the adapter and publishes the mapped events.
 */
export interface OutOfBandInput {
  channel: "hook" | "statusline" | "notify";
  agentId: string;
  /** Untrusted JSON body as received. */
  payload: unknown;
}

// ---- Login ------------------------------------------------------------------

export type LoginOutcome = { ok: true } | { ok: false; reason: string };

/** A running device-code login; the office shows `verificationUrl` + `userCode`. */
export interface DeviceCodeLogin {
  verificationUrl: string;
  userCode: string;
  expiresAt?: number;
  /** Settles when the CLI reports success or failure. The office never sees the token. */
  completion: Promise<LoginOutcome>;
  cancel(): Promise<void>;
}

/**
 * How the office UI helps a human log in (SPEC §7 `loginFlow`, §8 rule 1).
 * Discriminated on the protocol's `LoginFlow` kind.
 */
export type LoginFlowPlan =
  | {
      kind: "device_code";
      /** Starts the CLI's own device flow inside the runner. */
      begin(): Promise<DeviceCodeLogin>;
    }
  | {
      kind: "pty_paste_code";
      /** Terminal the human completes the login in, e.g. `claude` then `/login`. */
      plan: SpawnPlan;
      instructions: string;
    }
  | {
      kind: "api_key";
      /** Env var the key is injected as at spawn time. */
      envVar: string;
      label: string;
    }
  | {
      kind: "base_url_key";
      baseUrlEnvVar: string;
      keyEnvVar: string;
      label: string;
      presets?: readonly { label: string; baseUrl: string }[];
    };

// Compile-time check that the variants cover exactly the protocol's LOGIN_FLOWS.
type _LoginKindsMatch = [LoginFlowPlan["kind"]] extends [LoginFlow]
  ? [LoginFlow] extends [LoginFlowPlan["kind"]]
    ? true
    : never
  : never;
export const LOGIN_FLOW_PLAN_KINDS_MATCH: _LoginKindsMatch = true;

// ---- Adapter ----------------------------------------------------------------

export interface ReadUsageOptions {
  /** Only samples observed after this epoch-ms timestamp. */
  since?: number;
  signal?: AbortSignal;
}

export interface AgentAdapter {
  readonly id: ProviderId;
  readonly capabilities: Readonly<AdapterCapabilities>;
  buildSpawn(req: SpawnRequest, ctx: RunnerContext): SpawnPlan;
  /** Structured channel, or the PTY-heuristic fallback over `ctx.runner`. */
  connect(plan: SpawnPlan, ctx: RunnerContext): AgentControl;
  /** Command that opens the interactive TUI on the agent's session; null if unsupported. */
  buildAttachTui(agent: AgentRecord, ctx: RunnerContext): SpawnPlan | null;
  loginFlow(ctx: RunnerContext): LoginFlowPlan;
  /** In-band plus transcript-scan usage for this human's runner. */
  readUsage(ctx: RunnerContext, opts?: ReadUsageOptions): AsyncIterable<UsageSample | LimitSample>;
  /** Map hook / statusline / notify payloads to events; [] when irrelevant. */
  ingest?(input: OutOfBandInput, ctx: RunnerContext): AgentEvent[];
  /**
   * Put the CLI's own first-run state in the human's runner in order before
   * `plan` runs (Claude Code: onboarding complete, and trust for the henchman's
   * own office-created worktree when the office allows it). Must not throw
   * and must never touch credentials; a failure only means the CLI shows its
   * first-run screens.
   */
  prepareSpawn?(
    plan: SpawnPlan,
    ctx: RunnerContext,
    info: PrepareSpawnInfo,
  ): Promise<PreparedSpawn>;
}

export interface PrepareSpawnInfo {
  /** The henchman's own worktree in the runner; absent when it works in its owner's clone. */
  worktree?: string;
}

export interface PreparedSpawn {
  /** Short, fixed outcome word for logs (e.g. `changed`, `unchanged`, `no_runtime`). */
  outcome: string;
  /** How many folders were marked trusted. */
  trusted: number;
}
