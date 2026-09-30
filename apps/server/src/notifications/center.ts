/**
 * NotificationCenter (#42; SPEC §10 Ops, D15). Fed by the AgentManager
 * (status changes, PRs opened) and the PR watcher (PRs merged), it:
 *
 * - keeps each human's tab badge current: `notify.attention` lists their own
 *   robots waiting for them, pushed to that human's clients only;
 * - lets status events settle (5 s by default) so a robot that asks and
 *   carries on, or flaps between states, notifies nobody;
 * - dedupes (one event per robot per cooldown) and caps team messages per
 *   robot, on top of the per-channel rate limit in delivery.ts;
 * - sends `notify.event` to the robot's owner when their preferences allow,
 *   and a robot's errors to owners/admins who opted in;
 * - routes events to the enabled webhook channels that take that event on
 *   that floor.
 */
import {
  NOTIFY_ATTENTION_MESSAGE,
  NOTIFY_EVENT_MESSAGE,
  type NotificationEvent,
  type NotificationTestResult,
  type NotifyAttention,
  type NotifyEvent,
  robotDisplayName,
} from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import type { ChannelStore } from "./channels.ts";
import type { WebhookDispatcher } from "./delivery.ts";
import type { NotificationDirectory } from "./directory.ts";
import {
  ATTENTION_STATUSES,
  eventForStatus,
  eventStillHolds,
  type RobotNotice,
  type RobotSnapshot,
} from "./events.ts";
import { testNotice, webhookBody } from "./format.ts";

/** Delivers a BuildingRoom message to every client of one human. */
export interface PersonalSink {
  sendToUser(userId: string, type: string, payload: unknown): void;
}

export type Schedule = (fn: () => void, ms: number) => () => void;

export interface NotificationCenterOptions {
  directory: NotificationDirectory;
  channels: ChannelStore;
  dispatcher: WebhookDispatcher;
  logger: Logger;
  personal?: PersonalSink;
  now?: () => number;
  schedule?: Schedule;
  settleMs?: number;
  /** One event of a kind per robot per this long. */
  cooldownMs?: number;
  /** Team messages per robot per `teamWindowMs`. */
  teamBurst?: number;
  teamWindowMs?: number;
}

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
};

function snapshotOf(view: RobotSnapshot): RobotSnapshot {
  const {
    agentId,
    floorId,
    repoId,
    ownerUserId,
    ownerName,
    provider,
    status,
    taskTitle,
    prNumber,
  } = view;
  return {
    agentId,
    floorId,
    repoId,
    ownerUserId,
    ownerName,
    provider,
    status,
    taskTitle,
    prNumber,
  };
}

export class NotificationCenter {
  personal: PersonalSink | undefined;
  readonly #o: Required<Omit<NotificationCenterOptions, "personal">>;
  readonly #status = new Map<string, RobotSnapshot["status"]>();
  readonly #settling = new Map<string, () => void>();
  readonly #lastSent = new Map<string, number>();
  readonly #team = new Map<string, number[]>();
  #seq = 0;

  constructor(opts: NotificationCenterOptions) {
    this.personal = opts.personal;
    this.#o = {
      now: Date.now,
      schedule: defaultSchedule,
      settleMs: 5_000,
      cooldownMs: 60_000,
      teamBurst: 8,
      teamWindowMs: 10 * 60_000,
      ...opts,
    };
  }

  // ---- Sources ---------------------------------------------------------------

  /** AgentManager: a robot's status changed. */
  statusChanged(view: RobotSnapshot, previous: RobotSnapshot["status"]): void {
    const robot = snapshotOf(view);
    this.#status.set(robot.agentId, robot.status);
    if (ATTENTION_STATUSES.includes(robot.status) || ATTENTION_STATUSES.includes(previous)) {
      this.pushAttention(robot.ownerUserId);
    }
    this.#settling.get(robot.agentId)?.();
    this.#settling.delete(robot.agentId);
    const event = eventForStatus(robot.status);
    if (!event) return;
    const cancel = this.#o.schedule(() => {
      this.#settling.delete(robot.agentId);
      if (eventStillHolds(event, this.#status.get(robot.agentId))) this.#emit(robot, event);
    }, this.#o.settleMs);
    this.#settling.set(robot.agentId, cancel);
  }

  /** AgentManager: the robot's owner opened a PR through the office. */
  pullRequestOpened(view: RobotSnapshot, pr: { number: number; url: string; created: boolean }) {
    if (!pr.created) return;
    this.#emit({ ...snapshotOf(view), prNumber: pr.number }, "pr_opened", pr.url);
  }

  /** PR watcher (or GitHub webhooks, #35): a robot's PR was merged. */
  pullRequestMerged(robot: RobotSnapshot, prUrl?: string): void {
    this.#emit(snapshotOf(robot), "pr_merged", prUrl);
  }

  /** The robot left (sent home): forget it. */
  robotRemoved(agentId: string): void {
    this.#settling.get(agentId)?.();
    this.#settling.delete(agentId);
    this.#status.delete(agentId);
  }

  // ---- Tab badge -----------------------------------------------------------

  attentionFor(userId: string): NotifyAttention {
    return { agentIds: this.#o.directory.attention(userId).slice(0, 500) };
  }

  pushAttention(userId: string): void {
    this.personal?.sendToUser(userId, NOTIFY_ATTENTION_MESSAGE, this.attentionFor(userId));
  }

  // ---- Delivery ------------------------------------------------------------

  #emit(robot: RobotSnapshot, event: NotificationEvent, prUrl?: string): void {
    const now = this.#o.now();
    const key = `${robot.agentId}:${event}:${event.startsWith("pr_") ? robot.prNumber : ""}`;
    const last = this.#lastSent.get(key);
    if (last !== undefined && now - last < this.#o.cooldownMs) return;
    this.#lastSent.set(key, now);
    const notice = this.#notice(robot, event, prUrl);
    try {
      this.#personal(notice);
    } catch (err) {
      this.#o.logger.warn({ err: (err as Error).name, event }, "personal notification failed");
    }
    this.#teamDeliver(notice);
  }

  #notice(robot: RobotSnapshot, event: NotificationEvent, prUrl?: string): RobotNotice {
    const { directory } = this.#o;
    this.#seq += 1;
    return {
      id: `${this.#o.now()}-${this.#seq}`,
      event,
      agentId: robot.agentId,
      floorId: robot.floorId,
      floorName: directory.floorName(robot.floorId),
      ownerUserId: robot.ownerUserId,
      ownerName: robot.ownerName,
      robotName: robotDisplayName(robot.ownerName, robot.provider),
      provider: robot.provider,
      taskTitle: robot.taskTitle.slice(0, 200),
      prNumber: robot.prNumber,
      prUrl: prUrl?.startsWith("https://") ? prUrl : directory.prUrl(robot.repoId, robot.prNumber),
      ts: this.#o.now(),
    };
  }

  #personal(n: RobotNotice): void {
    const sink = this.personal;
    if (!sink) return;
    const { directory } = this.#o;
    const payload = (own: boolean): NotifyEvent => ({
      id: n.id,
      event: n.event,
      agentId: n.agentId,
      floorId: n.floorId,
      floorName: n.floorName.slice(0, 100),
      robotName: n.robotName.slice(0, 120),
      ownerName: n.ownerName.slice(0, 64),
      provider: n.provider,
      taskTitle: n.taskTitle,
      prNumber: n.prNumber,
      prUrl: n.prUrl,
      own,
      ts: n.ts,
    });
    if (directory.prefs(n.ownerUserId).desktop[n.event]) {
      sink.sendToUser(n.ownerUserId, NOTIFY_EVENT_MESSAGE, payload(true));
    }
    if (n.event !== "error") return;
    for (const managerId of directory.managers()) {
      if (managerId === n.ownerUserId || !directory.prefs(managerId).adminErrors) continue;
      sink.sendToUser(managerId, NOTIFY_EVENT_MESSAGE, payload(false));
    }
  }

  #teamDeliver(n: RobotNotice): void {
    const channels = this.#o.channels
      .routable()
      .filter((c) => c.events.includes(n.event))
      .filter((c) => c.floorIds === null || c.floorIds.includes(n.floorId));
    if (channels.length === 0) return;
    const now = this.#o.now();
    const recent = (this.#team.get(n.agentId) ?? []).filter((t) => now - t < this.#o.teamWindowMs);
    if (recent.length >= this.#o.teamBurst) {
      this.#o.logger.info({ agentId: n.agentId, event: n.event }, "team notification capped");
      return;
    }
    recent.push(now);
    this.#team.set(n.agentId, recent);
    for (const channel of channels) {
      void this.#o.dispatcher.enqueue(
        channel.id,
        () => this.#o.channels.target(channel.id),
        webhookBody(channel.kind, n, channel.chatId),
      );
    }
  }

  /** "Send test": one attempt, fixed text, also for a disabled channel. */
  async sendTest(channelId: string): Promise<NotificationTestResult> {
    const channel = this.#o.channels.get(channelId);
    if (!channel) return { ok: false, code: "not_found" };
    const result = await this.#o.dispatcher.enqueue(
      channelId,
      () => this.#o.channels.target(channelId, { includeDisabled: true }),
      webhookBody(channel.kind, testNotice(this.#o.now()), channel.chatId),
      { retry: false },
    );
    return { ok: result.ok, code: result.code };
  }

  close(): void {
    for (const cancel of this.#settling.values()) cancel();
    this.#settling.clear();
    this.#o.dispatcher.close();
  }
}
