/**
 * Per-robot permission mode (#166): how much a robot may do before it raises
 * its hand. The value is the provider CLI's own name for the mode, passed
 * through its own flag or setting; the allowed values are per provider.
 *
 * Claude Code, `claude --permission-mode <mode>`
 * (https://code.claude.com/docs/en/permission-modes):
 * - `auto`: the built-in starting mode since v2.1.283. A classifier approves
 *   low-risk actions itself (no PermissionRequest hook), riskier ones still ask.
 *   Where auto mode is unavailable (model, settings) Claude starts in Manual.
 * - `default` ("Manual"): asks before every edit, command and network call.
 * - `acceptEdits`: file edits and common filesystem commands run; the rest asks.
 * Left out: `plan` (edits wait for a plan approved in the terminal),
 * `dontAsk` (denies instead of asking, so a robot can never raise its hand) and
 * `bypassPermissions` (the docs require an isolated container or VM).
 *
 * Codex, the app-server `approvalPolicy` / `approval_policy`
 * (https://learn.chatgpt.com/docs/agent-approvals-security,
 * https://learn.chatgpt.com/docs/config-file/config-reference):
 * - `on-request`: the recommended "Auto" preset with the workspace-write
 *   sandbox; asks only to leave the sandbox (outside edits, network).
 * - `never`: never asks; commands stay inside the workspace-write sandbox.
 * Left out: `untrusted` (retired; the docs say it can stop Codex from
 * starting) and the granular object form.
 */
import { z } from "zod";
import type { ProviderId } from "./enums.ts";

export const CLAUDE_PERMISSION_MODES = ["auto", "default", "acceptEdits"] as const;
export const CODEX_APPROVAL_POLICIES = ["on-request", "never"] as const;

/** Every value any provider accepts; the per-provider check is `isPermissionModeFor`. */
export const PERMISSION_MODES = [...CLAUDE_PERMISSION_MODES, ...CODEX_APPROVAL_POLICIES] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PermissionModeSchema = z.enum(PERMISSION_MODES);

/** Allowed modes per provider, default first. Providers not listed have no choice. */
export const PROVIDER_PERMISSION_MODES: Readonly<
  Partial<Record<ProviderId, readonly PermissionMode[]>>
> = {
  "claude-code": CLAUDE_PERMISSION_MODES,
  codex: CODEX_APPROVAL_POLICIES,
};

export function permissionModesFor(provider: ProviderId): readonly PermissionMode[] {
  return PROVIDER_PERMISSION_MODES[provider] ?? [];
}

/** The provider's own default (Claude: auto mode; Codex: on-request), or undefined. */
export function defaultPermissionMode(provider: ProviderId): PermissionMode | undefined {
  return permissionModesFor(provider)[0];
}

export function isPermissionModeFor(provider: ProviderId, mode: string): mode is PermissionMode {
  return (permissionModesFor(provider) as readonly string[]).includes(mode);
}

/**
 * The mode a robot runs in: the stored one when it is valid for the provider,
 * else the provider default (rows from before #166 have none).
 */
export function effectivePermissionMode(
  provider: ProviderId,
  mode: string | null | undefined,
): PermissionMode | undefined {
  return mode && isPermissionModeFor(provider, mode) ? mode : defaultPermissionMode(provider);
}
