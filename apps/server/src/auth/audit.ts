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
  operationCreate: "operation.create",
  operationArchive: "operation.archive",
  operationRestore: "operation.restore",
  operationDelete: "operation.delete",
  operationMemberSet: "operation.member_set",
  operationMemberRemove: "operation.member_remove",
  /** A room manager changed the room's desk count or decor style (#182). */
  operationRoomSettings: "operation.room_settings",
  operationRepoClone: "operation_repo.clone",
  /** The compound row was created and pre-compound operations laid out as rooms (#181). */
  compoundCreate: "compound.create",
  /** Rooms without a valid spot (restored, or never placed) were placed automatically. */
  compoundRoomsPlaced: "compound.rooms_placed",
  /** An owner/admin placed a new room, or moved/resized one (#181). */
  compoundRoomPlace: "compound.room_place",
  compoundRoomMove: "compound.room_move",
  /** Someone pressed the lobby's blast door button: opened it, or held it open (#188). */
  compoundBlastDoorOpen: "compound.blast_door_open",
  agentPullRequest: "agent.pull_request",
  worktreesPrune: "worktrees.prune",
  agentSpawn: "agent.spawn",
  agentStop: "agent.stop",
  /** An office owner/admin stopped someone else's henchman (D12, #138). */
  agentEmergencyStop: "agent.emergency_stop",
  agentApprove: "agent.approve",
  agentResume: "agent.resume",
  agentSendHome: "agent.send_home",
  /** The henchman's owner committed or discarded in its changes window (#38). */
  agentChangesCommit: "agent.changes_commit",
  agentChangesDiscard: "agent.changes_discard",
  credentialProfileCreate: "credential_profile.create",
  credentialProfileVerify: "credential_profile.verify",
  credentialProfileDelete: "credential_profile.delete",
  providerLoginStart: "provider_login.start",
  providerLoginFinish: "provider_login.finish",
  githubConnect: "github.connect",
  githubDisconnect: "github.disconnect",
  /** Board write actions (#36): an operation manager acted on GitHub through the office credential. */
  githubBoardComment: "github.board_comment",
  githubBoardAssign: "github.board_assign",
  githubBoardMerge: "github.board_merge",
  githubBoardClose: "github.board_close",
  notificationChannelCreate: "notification_channel.create",
  notificationChannelUpdate: "notification_channel.update",
  notificationChannelDelete: "notification_channel.delete",
  workflowCreate: "workflow.create",
  workflowUpdate: "workflow.update",
  workflowDelete: "workflow.delete",
  /** A workflow run wrote to GitHub as the office's App (review, comment, labels, check run). */
  workflowRunGitHubWrite: "workflow_run.github_write",
  workflowRunCancel: "workflow_run.cancel",
  /** A henchman's answer held a secret and was not posted (#155). */
  workflowRunSecretBlocked: "workflow_run.secret_blocked",
  /** Meeting room (#50): started, paused, resumed, stopped by its starter, emergency-stopped by an admin. */
  meetingStart: "meeting.start",
  meetingPause: "meeting.pause",
  meetingResume: "meeting.resume",
  meetingStop: "meeting.stop",
  meetingEmergencyStop: "meeting.emergency_stop",
  /** Henchman skin rules (#184). */
  skinRuleCreate: "skin_rule.create",
  skinRuleUpdate: "skin_rule.update",
  skinRuleDelete: "skin_rule.delete",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  /** Acting user, or null for system-initiated actions. */
  userId: string | null;
  action: AuditAction;
  targetKind:
    | "user"
    | "invite"
    | "operation"
    | "operation_repo"
    | "compound"
    | "agent"
    | "worktrees"
    | "credential_profile"
    | "provider_login"
    | "github_connection"
    | "github_card"
    | "notification_channel"
    | "meeting"
    | "workflow"
    | "workflow_run"
    | "skin_rule";
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
