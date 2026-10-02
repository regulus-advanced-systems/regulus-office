/**
 * Meeting ACL (#50, SPEC §8 rule 4, D12): who starts, who watches, who
 * controls, the admin's emergency stop, and start admission.
 */
import { describe, expect, test } from "bun:test";
import { StartMeetingRequest } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { auditLog, operationRepos } from "../db/schema/index.ts";
import type { OperationActor } from "../operations/access.ts";
import { MeetingError } from "./service.ts";
import { meetingFixture, startInput, waitFor } from "./test-helpers.ts";

type Fixture = Awaited<ReturnType<typeof meetingFixture>>;

const input = (f: Fixture, extra: Record<string, unknown> = {}) =>
  StartMeetingRequest.parse(startInput(f.operationId, f.repoId, extra));

function refused(fn: () => unknown, status: number, code?: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MeetingError);
    expect((err as MeetingError).status as number).toBe(status);
    if (code) expect((err as MeetingError).code).toBe(code);
    return err as MeetingError;
  }
  throw new Error("expected a refusal");
}

async function refusedAsync(fn: () => Promise<unknown>, status: number) {
  const err = await fn().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MeetingError);
  expect((err as MeetingError).status as number).toBe(status);
}

/** A meeting whose henchmen hold their first turns (busy, no notes). */
async function heldMeeting(f: Fixture, starter: OperationActor) {
  f.fake.behave = (call, fake) => fake.setStatus(call.agentId, "working");
  const summary = f.meetings.service.start(starter, input(f));
  await waitFor(() => f.fake.prompts.length === 1, "the first turn");
  return summary;
}

describe("start", () => {
  test("needs spawn access: viewers are refused, strangers do not see the operation", async () => {
    const f = await meetingFixture();
    refused(() => f.meetings.service.start(f.viewer, input(f)), 403, "forbidden");
    refused(() => f.meetings.service.start(f.roleViewer, input(f)), 403, "forbidden");
    refused(() => f.meetings.service.start(f.stranger, input(f)), 404);
    const summary = f.meetings.service.start(f.member, input(f));
    expect(summary.startedBy).toBe(f.member.id);
    expect(summary.members.map((m) => m.name)).toEqual(["Proposer", "Challenger", "Judge"]);
    const audit = f.db.select().from(auditLog).where(eq(auditLog.action, "meeting.start")).all();
    expect(audit.map((a) => a.userId)).toEqual([f.member.id]);
  });

  test("every member must be spawnable for the starter", async () => {
    const f = await meetingFixture();
    const members = [
      { provider: "custom", model: "a" },
      { provider: "gemini-cli", model: "b" },
    ];
    const err = refused(() => f.meetings.service.start(f.owner, input(f, { members })), 400);
    expect(err.message).toContain("not installed");
    expect(f.meetings.store.listForOperation(f.operationId)).toEqual([]);
  });

  test("enough free desks, one meeting in session, a cloned repo, a reviewable PR", async () => {
    const f = await meetingFixture();
    const five = Array(5).fill({ provider: "custom", model: "m" });
    // Six desks: five free is fine, then the room is full for a second meeting anyway.
    f.fake.agents.set("busy-1", { owner: f.owner.id, status: "idle", seat: "seat-6" });
    f.fake.agents.set("busy-2", { owner: f.owner.id, status: "idle", seat: "seat-5" });
    refused(
      () => f.meetings.service.start(f.owner, input(f, { members: five })),
      409,
      "no_free_desks",
    );
    f.workspaces.pull = null;
    refused(
      () =>
        f.meetings.service.start(
          f.owner,
          input(f, { pattern: "review_panel", output: "pr_review", prNumber: 9 }),
        ),
      409,
      "no_pull_branch",
    );
    await heldMeeting(f, f.owner);
    refused(() => f.meetings.service.start(f.member, input(f)), 409, "in_session");
    f.db
      .update(operationRepos)
      .set({ cloneStatus: "cloning" })
      .where(eq(operationRepos.id, f.repoId))
      .run();
    refused(() => f.meetings.service.start(f.owner, input(f)), 409, "repo_not_ready");
  });
});

describe("watch and control (D12)", () => {
  test("everyone with operation access watches; only the starter controls", async () => {
    const f = await meetingFixture();
    const { id } = await heldMeeting(f, f.member);
    const service = f.meetings.service;

    for (const watcher of [f.viewer, f.roleViewer, f.owner, f.member]) {
      expect(service.list(watcher, f.operationId).meetings.map((m) => m.id)).toEqual([id]);
      expect(service.detail(watcher, id).topic).toContain("Pick a cache");
      expect(service.active(watcher).meetings.map((m) => m.id)).toEqual([id]);
    }
    expect(service.list(f.viewer, f.operationId).canStart).toBe(false);
    expect(service.list(f.member, f.operationId).canStart).toBe(true);
    expect(service.detail(f.member, id).canControl).toBe(true);
    expect(service.detail(f.viewer, id).canControl).toBe(false);
    expect(service.detail(f.viewer, id).canEmergencyStop).toBe(false);
    expect(service.detail(f.admin, id).canControl).toBe(false);
    expect(service.detail(f.admin, id).canEmergencyStop).toBe(true);

    refused(() => service.list(f.stranger, f.operationId), 404);
    refused(() => service.detail(f.stranger, id), 404);
    expect(service.active(f.stranger).meetings).toEqual([]);

    // Not the starter: no pause, no resume, no stop (the office owner is an admin: see below).
    await refusedAsync(() => service.pause(f.viewer, id), 403);
    await refusedAsync(() => service.pause(f.owner, id), 403);
    await refusedAsync(() => service.stop(f.viewer, id), 403);
    expect(f.fake.interrupts).toEqual([]);

    // The starter pauses (interrupting the speaker), resumes and stops.
    const paused = await service.pause(f.member, id);
    expect(paused.status).toBe("paused");
    expect(f.fake.interrupts).toHaveLength(1);
    refused(() => service.resume(f.owner, id), 403);
    expect(service.resume(f.member, id).status).toBe("running");
    await waitFor(() => f.fake.prompts.length === 2, "the turn asked again");
    const stopped = await service.stop(f.member, id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.reason).toContain("stopped by its starter");
    expect(f.fake.emergencyStops).toEqual([]);
    const actions = f.db
      .select({ action: auditLog.action, userId: auditLog.userId })
      .from(auditLog)
      .where(eq(auditLog.targetKind, "meeting"))
      .all();
    expect(actions.map((a) => a.action)).toEqual([
      "meeting.start",
      "meeting.pause",
      "meeting.resume",
      "meeting.stop",
    ]);
    expect(new Set(actions.map((a) => a.userId))).toEqual(new Set([f.member.id]));
  });

  test("an office admin only emergency-stops: henchmen killed, never interrupted or prompted", async () => {
    const f = await meetingFixture();
    const { id } = await heldMeeting(f, f.member);
    const prompts = f.fake.prompts.length;
    await refusedAsync(() => f.meetings.service.pause(f.admin, id), 403);
    const stopped = await f.meetings.service.stop(f.admin, id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.reason).toContain("emergency");
    expect(f.fake.interrupts).toEqual([]);
    expect(f.fake.emergencyStops.sort()).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(f.fake.prompts).toHaveLength(prompts);
    const audit = f.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "meeting.emergency_stop"))
      .all();
    expect(audit.map((a) => a.userId)).toEqual([f.admin.id]);
  });

  test("a member who went home blocks resuming", async () => {
    const f = await meetingFixture();
    const { id } = await heldMeeting(f, f.member);
    await f.meetings.service.pause(f.member, id);
    const agentId = f.meetings.store.members(id)[0]?.agentId ?? "";
    await f.fake.sendHome(f.member, agentId);
    refused(() => f.meetings.service.resume(f.member, id), 409, "member_left");
  });
});
