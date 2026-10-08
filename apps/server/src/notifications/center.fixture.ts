/**
 * The NotificationCenter over the seeded database (./testing.ts) with a
 * manual clock and settle timer, a recording personal sink and the fake
 * webhooks: Mia owns henchman a1 in operation-1 and a2 in operation-2.
 */
import { NOTIFY_EVENT_MESSAGE, type NotifyEvent } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema/index.ts";
import { NotificationCenter, type Schedule } from "./center.ts";
import { ChannelStore } from "./channels.ts";
import { WebhookDispatcher } from "./delivery.ts";
import { NotificationDirectory } from "./directory.ts";
import type { HenchmanSnapshot } from "./events.ts";
import { captureLogger, type FakeWebhooks, seededDb, testKeyring } from "./testing.ts";

export function centerSetup(fake: FakeWebhooks) {
  const seed = seededDb();
  const { db, owner, admin, member, addAgent } = seed;
  addAgent("a1", 1, member.id);
  addAgent("a2", 2, member.id);
  const log = captureLogger();
  const channels = new ChannelStore(db, testKeyring());
  const directory = new NotificationDirectory(db);
  const dispatcher = new WebhookDispatcher({
    policy: fake.policy(),
    logger: log.logger,
    sleep: async () => {},
    minSpacingMs: 0,
  });
  const clock = { t: 10_000_000 };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule: Schedule = (fn, ms) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const settle = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
  };
  const sent: { userId: string; type: string; payload: unknown }[] = [];
  const center = new NotificationCenter({
    directory,
    channels,
    dispatcher,
    logger: log.logger,
    personal: { sendToUser: (userId, type, payload) => sent.push({ userId, type, payload }) },
    now: () => clock.t,
    schedule,
  });
  const henchman = (
    agentId: string,
    status: HenchmanSnapshot["status"],
    operation = 1,
  ): HenchmanSnapshot => {
    db.update(agents).set({ status }).where(eq(agents.id, agentId)).run();
    return {
      agentId,
      name: agentId === "a1" ? "Gasket" : "",
      operationId: `operation-${operation}`,
      repoId: `repo-${operation}`,
      ownerUserId: member.id,
      ownerName: "Mia",
      provider: "codex",
      status,
      taskTitle: "Fix the login page",
      prNumber: 0,
    };
  };
  const events = () =>
    sent.filter((s) => s.type === NOTIFY_EVENT_MESSAGE) as {
      userId: string;
      payload: NotifyEvent;
    }[];
  return {
    ...seed,
    owner,
    admin,
    member,
    channels,
    directory,
    dispatcher,
    center,
    clock,
    settle,
    sent,
    events,
    henchman,
    log,
  };
}

export type CenterSetup = ReturnType<typeof centerSetup>;
