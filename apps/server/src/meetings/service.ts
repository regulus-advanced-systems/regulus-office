/**
 * Meeting room rules (#50; SPEC §8 rule 4, D12): who may start, watch and
 * control a meeting, and what a start must pass before anything is spawned.
 *
 * - start: operation `spawn` or `manage`, a cloned repo, every member
 *   spawnable for the starter (provider installed, a profile they may use:
 *   their own or an office key, never anyone else's), enough free desks, and
 *   no other meeting in session on the operation;
 * - watch (list, detail, transcript): anyone who can see the operation;
 * - pause / resume / stop: the starter, who owns every member henchman;
 * - stop: also an office owner/admin, as an audited emergency stop.
 */
import {
  type ActiveMeetingsResponse,
  isLiveMeeting,
  MEETING_ROLE_LABELS,
  type MeetingDetail,
  type MeetingListResponse,
  type MeetingSummary,
  mayControlHenchman,
  mayEmergencyStop,
  meetingRoles,
  type StartMeetingInput,
} from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { operationRepos, operations } from "../db/schema/index.ts";
import { type OperationActor, operationAccessFor } from "../operations/access.ts";
import type { MeetingEngine } from "./engine.ts";
import type { MeetingHenchmen, MeetingWorkspaces } from "./ports.ts";
import { memberNames } from "./prompt.ts";
import type { MeetingRow, MeetingStore } from "./store.ts";
import { detailOf, loadSummary } from "./views.ts";

export class MeetingError extends Error {
  override name = "MeetingError";
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface MeetingServiceDeps {
  db: Db;
  store: MeetingStore;
  engine: MeetingEngine;
  henchmen: MeetingHenchmen;
  workspaces: Pick<MeetingWorkspaces, "pullBase">;
}

export class MeetingService {
  constructor(private readonly deps: MeetingServiceDeps) {}

  summary(row: MeetingRow): MeetingSummary {
    const { store, henchmen } = this.deps;
    return loadSummary(
      store,
      row,
      (id) => henchmen.status(id),
      (id) => henchmen.seatOf(id) ?? "",
    );
  }

  #visible(actor: OperationActor, operationId: string): void {
    if (operationAccessFor(this.deps.db, actor, operationId) === null) {
      throw new MeetingError(404, "not_found", "no such operation");
    }
  }

  #row(actor: OperationActor, meetingId: string): MeetingRow {
    const row = this.deps.store.get(meetingId);
    if (!row) throw new MeetingError(404, "not_found", "no such meeting");
    this.#visible(actor, row.operationId);
    return row;
  }

  list(actor: OperationActor, operationId: string): MeetingListResponse {
    this.#visible(actor, operationId);
    const access = operationAccessFor(this.deps.db, actor, operationId);
    return {
      meetings: this.deps.store.listForOperation(operationId).map((r) => this.summary(r)),
      canStart: access === "spawn" || access === "manage",
    };
  }

  /** Live meetings on every operation the viewer can see (door signs). */
  active(actor: OperationActor): ActiveMeetingsResponse {
    const rows = this.deps.store.withStatus(["starting", "running", "paused"]);
    return {
      meetings: rows
        .filter((r) => operationAccessFor(this.deps.db, actor, r.operationId) !== null)
        .map((r) => this.summary(r)),
    };
  }

  detail(actor: OperationActor, meetingId: string): MeetingDetail {
    const row = this.#row(actor, meetingId);
    const control = mayControlHenchman(actor, row.startedBy);
    return detailOf(this.summary(row), row, this.deps.store.turns(row.id), {
      canControl: control,
      canEmergencyStop: !control && mayEmergencyStop(actor),
    });
  }

  start(actor: OperationActor, input: StartMeetingInput): MeetingSummary {
    const { db, store, henchmen, engine } = this.deps;
    const access = operationAccessFor(db, actor, input.operationId);
    if (access === null) throw new MeetingError(404, "not_found", "no such operation");
    if (access !== "spawn" && access !== "manage") {
      throw new MeetingError(403, "forbidden", "you may not spawn henchmen in this operation");
    }
    const repo = db
      .select()
      .from(operationRepos)
      .where(
        and(eq(operationRepos.id, input.repoId), eq(operationRepos.operationId, input.operationId)),
      )
      .get();
    const live = db
      .select({ id: operations.id })
      .from(operations)
      .where(and(eq(operations.id, input.operationId), isNull(operations.archivedAt)))
      .get();
    if (!repo || !live)
      throw new MeetingError(400, "bad_request", "no such repo in this operation");
    if (repo.cloneStatus !== "ready") {
      throw new MeetingError(409, "repo_not_ready", "the repo is not cloned yet");
    }
    if (store.listForOperation(input.operationId).some((m) => isLiveMeeting(m.status))) {
      throw new MeetingError(409, "in_session", "a meeting is already in session in this room");
    }
    for (const member of input.members) {
      try {
        henchmen.check(actor, {
          ...member,
          operationId: input.operationId,
          repoId: input.repoId,
          prompt: "",
          autoWorktree: true,
        });
      } catch (err) {
        if (err instanceof AgentManagerError) throw new MeetingError(400, err.code, err.message);
        throw err;
      }
    }
    const seats = henchmen.freeSeats(input.operationId, input.members.length);
    if (seats.length < input.members.length) {
      throw new MeetingError(
        409,
        "no_free_desks",
        `the meeting needs ${input.members.length} free desks; this room has ${seats.length}`,
      );
    }
    if (input.pattern === "review_panel" && input.prNumber) {
      if (this.deps.workspaces.pullBase(input.repoId, input.prNumber) === null) {
        throw new MeetingError(
          409,
          "no_pull_branch",
          `pull request #${input.prNumber} is not open on a branch of this repo`,
        );
      }
    }
    const roles = meetingRoles(input.pattern, input.members.length);
    const names = memberNames(roles, (r) => MEETING_ROLE_LABELS[r]);
    const id = crypto.randomUUID();
    store.create({
      id,
      input,
      startedBy: actor.id,
      members: roles.map((role, i) => ({ role, name: names[i] ?? role })),
    });
    writeAudit(db, {
      userId: actor.id,
      action: AUDIT_ACTIONS.meetingStart,
      targetKind: "meeting",
      targetId: id,
      meta: {
        operationId: input.operationId,
        repoId: input.repoId,
        pattern: input.pattern,
        members: input.members.map((m) => `${m.provider}/${m.model}`),
        rounds: input.rounds,
        tokenBudget: input.tokenBudget,
        output: input.output,
      },
    });
    engine.launch(id);
    const row = store.get(id);
    if (!row) throw new Error("meeting vanished");
    return this.summary(row);
  }

  #control(actor: OperationActor, meetingId: string): MeetingRow {
    const row = this.#row(actor, meetingId);
    if (!mayControlHenchman(actor, row.startedBy)) {
      throw new MeetingError(403, "forbidden", "only the meeting's starter may control it");
    }
    return row;
  }

  async pause(actor: OperationActor, meetingId: string): Promise<MeetingSummary> {
    const row = this.#control(actor, meetingId);
    if (row.status !== "running" && row.status !== "starting") {
      throw new MeetingError(409, "conflict", `the meeting is ${row.status}`);
    }
    await this.deps.engine.halt(row.id, "paused", "paused by its starter");
    this.#audit(actor, AUDIT_ACTIONS.meetingPause, row);
    return this.#fresh(row.id);
  }

  resume(actor: OperationActor, meetingId: string): MeetingSummary {
    const row = this.#control(actor, meetingId);
    if (row.status !== "paused")
      throw new MeetingError(409, "conflict", `the meeting is ${row.status}`);
    const { store, henchmen, engine } = this.deps;
    const members = store.members(row.id);
    const spawned = members.every((m) => m.agentId);
    if (spawned && members.some((m) => m.agentId && henchmen.seatOf(m.agentId) === null)) {
      throw new MeetingError(
        409,
        "member_left",
        "a member went back to barracks; stop this meeting instead",
      );
    }
    store.setStatus(row.id, row.workdir && spawned ? "running" : "starting");
    engine.launch(row.id);
    this.#audit(actor, AUDIT_ACTIONS.meetingResume, row);
    return this.#fresh(row.id);
  }

  async stop(actor: OperationActor, meetingId: string): Promise<MeetingSummary> {
    const row = this.#row(actor, meetingId);
    const control = mayControlHenchman(actor, row.startedBy);
    if (!control && !mayEmergencyStop(actor)) {
      throw new MeetingError(403, "forbidden", "only the meeting's starter may stop it");
    }
    if (!isLiveMeeting(row.status)) {
      throw new MeetingError(409, "conflict", `the meeting is ${row.status}`);
    }
    const reason = control
      ? "stopped by its starter; the henchmen stay at their desks until sent to barracks"
      : "emergency-stopped by an office admin; the henchmen stay at their desks";
    // The starter interrupts their own henchmen; an admin only has the emergency stop (D12).
    await this.deps.engine.halt(row.id, "stopped", reason, { interrupt: control });
    if (!control) {
      for (const m of this.deps.store.members(row.id)) {
        if (!m.agentId || this.deps.henchmen.seatOf(m.agentId) === null) continue;
        await this.deps.henchmen
          .emergencyStop(actor, m.agentId, `meeting ${row.id} emergency stop`)
          .catch(() => undefined);
      }
    }
    this.#audit(
      actor,
      control ? AUDIT_ACTIONS.meetingStop : AUDIT_ACTIONS.meetingEmergencyStop,
      row,
    );
    return this.#fresh(row.id);
  }

  #fresh(meetingId: string): MeetingSummary {
    const row = this.deps.store.get(meetingId);
    if (!row) throw new MeetingError(404, "not_found", "no such meeting");
    return this.summary(row);
  }

  #audit(
    actor: OperationActor,
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    row: MeetingRow,
  ) {
    writeAudit(this.deps.db, {
      userId: actor.id,
      action,
      targetKind: "meeting",
      targetId: row.id,
      meta: { operationId: row.operationId, startedBy: row.startedBy },
    });
  }
}
