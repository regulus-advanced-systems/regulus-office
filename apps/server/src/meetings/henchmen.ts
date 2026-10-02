/**
 * Meeting members through the AgentManager (#50): every call is the ordinary
 * henchman path with the meeting's starter as the actor, so admission,
 * credentials (SPEC §8), the runner, sandboxes and the terminal ACL (D12)
 * apply exactly as for a henchman spawned from a desk. Files are read as the
 * starter's runner identity (D17), never by the office from another human's
 * area.
 */
import { AgentEvent, isPermissionModeFor } from "@regulus/protocol";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { AgentManager } from "../agents/manager/manager.ts";
import type { Db } from "../db/index.ts";
import { agentEvents, desks } from "../db/schema/index.ts";
import type { Runner } from "../runners/types.ts";
import type { MeetingHenchmen } from "./ports.ts";

/** Biggest notes file read back (the transcript keeps a capped copy). */
const READ_MAX_CHARS = 200_000;

/** `d3s2` → `d3`: seats of one desk pod sit around one table. */
const podOf = (seatId: string) => /^(d\d+)s\d+$/.exec(seatId)?.[1] ?? seatId;

/** Free seats, best first: one pod that fits everyone, else the emptiest pods first. */
export function pickSeats(free: readonly string[], count: number): string[] {
  const pods = new Map<string, string[]>();
  for (const seat of free) {
    const key = podOf(seat);
    pods.set(key, [...(pods.get(key) ?? []), seat]);
  }
  const groups = [...pods.values()];
  const fits = groups.filter((g) => g.length >= count).sort((a, b) => a.length - b.length)[0];
  if (fits) return fits.slice(0, count);
  return groups
    .sort((a, b) => b.length - a.length)
    .flat()
    .slice(0, count);
}

export function managerHenchmen(deps: {
  manager: AgentManager;
  runner: Pick<Runner, "readTextFile">;
  db: Db;
}): MeetingHenchmen {
  const { manager, runner, db } = deps;
  return {
    spawn: (starter, input, workspace, onAdmitted) =>
      manager.spawn(starter, input, { onAdmitted, workspace }),
    prompt: (starter, agentId, text) => manager.prompt(starter, agentId, text),
    interrupt: (starter, agentId) => manager.interrupt(starter, agentId),
    emergencyStop: (admin, agentId, reason) => manager.emergencyStop(admin, agentId, reason),
    sendHome: (starter, agentId) => manager.sendHome(starter, agentId, { keepBranch: true }),
    status: (agentId) => manager.view(agentId)?.status,
    seatOf(agentId) {
      const row = db
        .select({ seatId: desks.seatId })
        .from(desks)
        .where(eq(desks.agentId, agentId))
        .get();
      return row?.seatId ?? null;
    },
    check(starter, input) {
      if (!manager.adapters.has(input.provider)) {
        throw new AgentManagerError("bad_request", `${input.provider} is not installed`);
      }
      if (input.permissionMode && !isPermissionModeFor(input.provider, input.permissionMode)) {
        throw new AgentManagerError(
          "bad_request",
          `${input.provider} has no permission mode ${input.permissionMode}`,
        );
      }
      // Throws unless the profile is the starter's own or an office key (SPEC §8).
      manager.credentials.check(starter.id, input.provider, input.profileId);
    },
    async readFile(starterId, path) {
      const text = await runner.readTextFile({ userId: starterId }, path);
      return text === null ? null : text.slice(0, READ_MAX_CHARS);
    },
    lastMessage(agentId, since) {
      const rows = db
        .select({ payload: agentEvents.payloadJson })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.agentId, agentId),
            eq(agentEvents.kind, "message"),
            gte(agentEvents.ts, new Date(since)),
          ),
        )
        .orderBy(desc(agentEvents.ts), desc(agentEvents.createdAt))
        .limit(20)
        .all();
      for (const row of rows) {
        const parsed = AgentEvent.safeParse(JSON.parse(row.payload));
        const event = parsed.success ? parsed.data : undefined;
        if (event?.kind === "message" && event.role === "assistant" && event.text.trim()) {
          return event.text.slice(0, READ_MAX_CHARS);
        }
      }
      return null;
    },
    freeSeats(operationId, count) {
      const free = db
        .select({ seatId: desks.seatId })
        .from(desks)
        .where(and(eq(desks.operationId, operationId), isNull(desks.agentId)))
        .orderBy(asc(desks.seatId))
        .all()
        .map((r) => r.seatId);
      return pickSeats(free, count);
    },
  };
}
