/**
 * What the meeting orchestrator needs from the rest of the office (#50). The
 * real implementations (henchmen.ts, workspace.ts, output.ts) go through the
 * AgentManager, the per-human worktrees and the one-click PR path; tests pass
 * fakes. Every call that acts on a henchman acts as the meeting's starter, who
 * owns them all (SPEC §8 rule 4, D12): nothing here bypasses the manager's
 * own checks.
 */
import type { AgentStatus } from "@regulus/protocol";
import type { SpawnInput } from "../agents/manager/spawn.ts";
import type { OperationActor } from "../operations/access.ts";
import type { PreparedWorkspace } from "../worktrees/types.ts";

export interface MeetingHenchmen {
  /**
   * Spawn one member as the starter, idle, working in the shared worktree.
   * `onAdmitted` runs once its agent row exists (before it starts).
   */
  spawn(
    starter: OperationActor,
    input: SpawnInput,
    workspace: PreparedWorkspace,
    onAdmitted: (agentId: string) => void,
  ): Promise<{ agentId: string; seatId: string }>;
  prompt(starter: OperationActor, agentId: string, text: string): Promise<void>;
  interrupt(starter: OperationActor, agentId: string): Promise<void>;
  /** An office owner/admin's audited emergency stop (D12): kill the session, keep everything. */
  emergencyStop(admin: OperationActor, agentId: string, reason: string): Promise<void>;
  /** Send the henchman home, keeping its branch. */
  sendHome(starter: OperationActor, agentId: string): Promise<void>;
  /** The henchman's status while it is tracked; undefined once it went home. */
  status(agentId: string): AgentStatus | undefined;
  /** The henchman's seat while it is at a desk, else null. */
  seatOf(agentId: string): string | null;
  /** Would this member spawn for the starter (provider installed, a profile they may use)? Throws. */
  check(starter: OperationActor, input: SpawnInput): void;
  /** A UTF-8 file in the starter's area, read as the starter's runner identity (D17). */
  readFile(starterId: string, path: string): Promise<string | null>;
  /** The last complete assistant message since `since` (ms), when the provider sends them. */
  lastMessage(agentId: string, since: number): string | null;
  /** Free seats of the operation, best first for a meeting of `count` (one pod when it fits). */
  freeSeats(operationId: string, count: number): string[];
}

export interface MeetingWorkspaceInput {
  meetingId: string;
  operationId: string;
  repoId: string;
  ownerUserId: string;
  /** Branch slug, `office/<slug>` (made unique). */
  slug: string;
  /** Start point; `origin/<default>` when absent. */
  base?: string;
}

export interface MeetingWorkspaces {
  /** The shared worktree (idempotent), with `.meeting/` ignored by git. */
  prepare(input: MeetingWorkspaceInput): Promise<PreparedWorkspace>;
  /** Uncommitted paths outside `.meeting/`. */
  uncommitted(input: { ownerUserId: string; repoId: string; workdir: string }): Promise<string[]>;
  /** Remove the shared worktree; the branch stays. */
  release(input: { ownerUserId: string; repoId: string; workdir: string }): Promise<void>;
  /** The repo's default branch (what a pull request is compared against). */
  baseBranch(repoId: string): string;
  /** `origin/<head branch>` of a pull request, for a review panel's worktree. */
  pullBase(repoId: string, prNumber: number): string | null;
}

export interface MeetingOutputs {
  /** Push the meeting branch and open a draft PR through the one-click PR path. */
  openPullRequest(
    starter: OperationActor,
    agentId: string,
    options: { title: string; body: string },
  ): Promise<{ number: number; url: string }>;
  /** Post a comment review on the PR with the repo's project credential. */
  postReview(repoId: string, prNumber: number, body: string): Promise<{ url: string }>;
}
