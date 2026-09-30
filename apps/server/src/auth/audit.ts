/**
 * Audit log writes for the auth layer (SPEC §5 `audit_log`, §11). Entries
 * describe who changed what; they never contain tokens, passwords or hashes.
 */
import type { Db } from "../db/index.ts";
import { auditLog } from "../db/schema/index.ts";

/** A Drizzle handle or a transaction opened on one; both run synchronously on bun:sqlite. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const AUDIT_ACTIONS = {
  /** The first registered human was promoted to owner. */
  bootstrapOwner: "user.bootstrap_owner",
  roleChange: "user.role_change",
  inviteCreate: "invite.create",
  inviteConsume: "invite.consume",
  floorCreate: "floor.create",
  floorArchive: "floor.archive",
  floorRestore: "floor.restore",
  floorDelete: "floor.delete",
  floorMemberSet: "floor.member_set",
  floorMemberRemove: "floor.member_remove",
  floorRepoClone: "floor_repo.clone",
  agentPullRequest: "agent.pull_request",
  worktreesPrune: "worktrees.prune",
  agentSpawn: "agent.spawn",
  agentStop: "agent.stop",
  /** An office owner/admin stopped someone else's robot (D12, #138). */
  agentEmergencyStop: "agent.emergency_stop",
  agentApprove: "agent.approve",
  agentResume: "agent.resume",
  agentSendHome: "agent.send_home",
  credentialProfileCreate: "credential_profile.create",
  credentialProfileVerify: "credential_profile.verify",
  credentialProfileDelete: "credential_profile.delete",
  providerLoginStart: "provider_login.start",
  providerLoginFinish: "provider_login.finish",
  githubConnect: "github.connect",
  githubDisconnect: "github.disconnect",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  /** Acting user, or null for system-initiated actions. */
  userId: string | null;
  action: AuditAction;
  targetKind:
    | "user"
    | "invite"
    | "floor"
    | "floor_repo"
    | "agent"
    | "worktrees"
    | "credential_profile"
    | "provider_login"
    | "github_connection";
  targetId: string | null;
  meta?: Record<string, unknown>;
}

export function writeAudit(db: DbOrTx, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      userId: entry.userId,
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      metaJson: JSON.stringify(entry.meta ?? {}),
    })
    .run();
}
