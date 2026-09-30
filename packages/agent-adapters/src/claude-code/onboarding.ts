/**
 * Claude Code's first-run state in the human's runner (#158, SPEC §8).
 *
 * `claude auth login` stores the login but does not mark the CLI's
 * onboarding complete, so the first interactive `claude` (a robot) showed
 * the theme picker and "Select login method" again. And the first run in a
 * new folder shows the workspace trust dialog; until it is accepted, the
 * `--settings` hooks do not run and the robot stays "starting".
 *
 * Both are flags in the CLI's own global config, `~/.claude.json`
 * (`$CLAUDE_CONFIG_DIR/.claude.json` when that is set), which holds "per-project
 * state such as trust decisions" and the global config keys
 * (https://code.claude.com/docs/en/settings):
 * - `hasCompletedOnboarding: true` skips the first-run screens. The CLI has
 *   no command for it (the CLI reference,
 *   https://code.claude.com/docs/en/cli-reference, has no `claude config`),
 *   so the file is edited.
 * - `projects["<dir>"].hasTrustDialogAccepted: true` is the documented way to
 *   trust a folder by hand
 *   (https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder).
 *   The office only ever writes it for the robot's own office-created
 *   worktree, and only when `OFFICE_CLAUDE_TRUST_WORKTREES` is on. (A trust
 *   accepted in the dialog is stored on the main checkout's root, i.e. the
 *   human's clone; the lookup also honours the worktree's own entry, checked
 *   with Claude Code v2.1.285 and an empty HOME, so the clone stays untrusted.)
 *
 * The edit is a small script run inside the human's runner, as the runner
 * user, by `node` (or `bun`). It reads `.claude.json`, sets only those flags,
 * keeps every other key as it was, and replaces the file atomically with the
 * same mode, and only when something changed. It prints one word (the
 * outcome) and never the file. It never opens `~/.claude/` at all, so
 * `.credentials.json` is never read, copied or changed; an unreadable or
 * unparsable config is left alone.
 */
import { SecretEnv } from "../secret.ts";
import { tmuxSessionName } from "../session.ts";
import type { PipedProcess, RunnerContext, SpawnPlan } from "../types.ts";
import { baseEnv } from "./spawn.ts";

/** Env var names the script reads; plain paths, nothing secret. */
export const ONBOARDING_TRUST_ENV = "REGULUS_CLAUDE_TRUST_DIRS";

/**
 * Exit codes: 0 done (stdout "changed" or "unchanged"), 3 the config is not a
 * JSON object (left alone), 4 it could not be read or written.
 */
export const ONBOARDING_SCRIPT = `"use strict";
const fs = require("fs"), path = require("path");
const dir = process.env.CLAUDE_CONFIG_DIR || process.env.HOME;
if (!dir) process.exit(4);
const file = path.join(dir, ".claude.json");
let trust = [];
try { trust = JSON.parse(process.env.${ONBOARDING_TRUST_ENV} || "[]"); } catch { process.exit(4); }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let raw = null, target = file, mode = 0o600;
try {
  target = fs.realpathSync(file);
  // A symlink may only lead to another .claude.json, never to any other file.
  if (path.basename(target) !== ".claude.json") process.exit(4);
  raw = fs.readFileSync(target, "utf8");
  mode = fs.statSync(target).mode & 0o777;
} catch (e) {
  if (!e || e.code !== "ENOENT") process.exit(4);
  target = file;
}
let cfg = {};
if (raw !== null && raw.trim() !== "") {
  try { cfg = JSON.parse(raw); } catch { process.exit(3); }
  if (!isObj(cfg)) process.exit(3);
}
let changed = false;
if (cfg.hasCompletedOnboarding !== true) { cfg.hasCompletedOnboarding = true; changed = true; }
if (trust.length > 0) {
  if (cfg.projects === undefined) cfg.projects = {};
  if (!isObj(cfg.projects)) process.exit(3);
  for (const p of trust) {
    if (typeof p !== "string" || !p.startsWith("/")) continue;
    const entry = cfg.projects[p];
    if (isObj(entry)) {
      if (entry.hasTrustDialogAccepted !== true) { entry.hasTrustDialogAccepted = true; changed = true; }
    } else {
      cfg.projects[p] = { hasTrustDialogAccepted: true };
      changed = true;
    }
  }
}
if (!changed) { process.stdout.write("unchanged\\n"); process.exit(0); }
const tmp = path.join(path.dirname(target), ".claude.json.regulus-" + process.pid + ".tmp");
try {
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\\n", { mode, flag: "wx" });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, target);
} catch {
  try { fs.unlinkSync(tmp); } catch {}
  process.exit(4);
}
process.stdout.write("changed\\n");
`;

/** Runs the script with the first of node / bun on the runner's PATH; 127 without either. */
const LAUNCHER =
  'for js in node bun; do if command -v "$js" >/dev/null 2>&1; then exec "$js" -e "$0"; fi; done; exit 127';

export type OnboardingOutcome = "changed" | "unchanged" | "no_runtime" | "bad_config" | "failed";

export interface OnboardingResult {
  outcome: OnboardingOutcome;
  /** How many folders were asked to be trusted. */
  trusted: number;
}

export const ONBOARDING_TIMEOUT_MS = 10_000;

/** Absolute, single-line runner paths only; anything else is dropped. */
export function trustDirs(dirs: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const dir of dirs) {
    if (!dir || !dir.startsWith("/") || /[\0\r\n]/.test(dir)) continue;
    const clean = dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
    if (clean === "/" || clean.split("/").includes("..")) continue;
    out.add(clean);
  }
  return [...out];
}

/** The side process that sets the flags: `sh -c <launcher> <script>` in the runner HOME. */
export function onboardingPlan(ctx: RunnerContext, trust: readonly string[] = []): SpawnPlan {
  const agentId = `claude-onboarding-${ctx.userId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  const env = baseEnv(ctx).merge(
    SecretEnv.of({ [ONBOARDING_TRUST_ENV]: JSON.stringify(trustDirs(trust)) }),
  );
  return {
    agentId,
    provider: "claude-code",
    argv: ["sh", "-c", LAUNCHER, ONBOARDING_SCRIPT],
    env,
    cwd: ctx.home,
    tmuxSession: tmuxSessionName(agentId),
    files: [],
  };
}

async function readAll(stream: ReadableStream<Uint8Array>, max = 64): Promise<string> {
  let out = "";
  try {
    for await (const chunk of stream) {
      if (out.length < max) out += new TextDecoder().decode(chunk);
    }
  } catch {
    // process gone
  }
  return out.slice(0, max);
}

function outcomeOf(code: number | null, stdout: string): OnboardingOutcome {
  if (code === 0) return stdout.trim() === "changed" ? "changed" : "unchanged";
  if (code === 127) return "no_runtime";
  if (code === 3) return "bad_config";
  return "failed";
}

/**
 * Mark Claude Code's onboarding complete in `ctx`'s runner, and trust
 * `trust` (the robot's own worktree) when given. Never throws: a runner
 * without node/bun, a broken config or a timeout only means Claude shows its
 * screens, which the robot then reports as waiting for its human.
 */
export async function ensureClaudeOnboarding(
  ctx: RunnerContext,
  opts: { trust?: readonly string[]; timeoutMs?: number } = {},
): Promise<OnboardingResult> {
  const plan = onboardingPlan(ctx, opts.trust);
  const trusted = trustDirs(opts.trust ?? []).length;
  let proc: PipedProcess;
  try {
    proc = await ctx.runner.spawnPiped(plan);
  } catch {
    return { outcome: "failed", trusted };
  }
  const stdout = readAll(proc.stdout);
  void readAll(proc.stderr, 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), opts.timeoutMs ?? ONBOARDING_TIMEOUT_MS);
  });
  const code = await Promise.race([proc.exited, timedOut]);
  clearTimeout(timer);
  if (code === "timeout") {
    proc.kill("SIGKILL");
    return { outcome: "failed", trusted };
  }
  return { outcome: outcomeOf(code, await stdout), trusted };
}
