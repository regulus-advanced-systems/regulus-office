/**
 * NotificationCenter (#42; SPEC §10 Ops, D15). Fed by the AgentManager
 * (status changes, PRs opened) and the GitHub event bus (PRs merged, #35), it:
 *
 * - keeps each human's tab badge current: `notify.attention` lists their own
 *   henchmen waiting for them, pushed to that human's clients only;
 * - lets status events settle (5 s by default) so a henchman that asks and
 *   carries on, or flaps between states, notifies nobody;
 * - dedupes (one event per henchman per cooldown) and caps team messages per
 *   henchman, on top of the per-channel rate limit in delivery.ts;
 * - sends `notify.event` to the henchman's owner when their preferences allow,
 *   and a henchman's errors to owners/admins who opted in;
 * - routes events to the enabled webhook channels that take that event on
 *   that operation.
 */
import {
  henchmanDisplayName,
  NOTIFY_ATTENTION_MESSAGE,
  NOTIFY_EVENT_MESSAGE,
  type NotificationEvent,
  type NotificationTestResult,
  type NotifyAttention,
  type NotifyEvent,
} from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import type { ChannelStore } from "./channels.ts";
import type { WebhookDispatcher } from "./delivery.ts";
import type { NotificationDirectory } from "./directory.ts";
import {
  ATTENTION_STATUSES,
  eventForStatus,
  eventStillHolds,
  type HenchmanNotice,
  type HenchmanSnapshot,
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
  /** One event of a kind per henchman per this long. */
  cooldownMs?: number;
  /** Team messages per henchman per `teamWindowMs`. */
  teamBurst?: number;
  teamWindowMs?: number;
}

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
};

function snapshotOf(view: HenchmanSnapshot): HenchmanSnapshot {
  const {
    agentId,
    operationId,
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
    operationId,
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
  readonly #status = new Map<string, HenchmanSnapshot["status"]>();
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

  /** AgentManager: a henchman's status changed. */
  statusChanged(view: HenchmanSnapshot, previous: HenchmanSnapshot["status"]): void {
    const henchman = snapshotOf(view);
    this.#status.set(henchman.agentId, henchman.status);
    if (ATTENTION_STATUSES.includes(henchman.status) || ATTENTION_STATUSES.includes(previous)) {
      this.pushAttention(henchman.ownerUserId);
    }
    this.#settling.get(henchman.agentId)?.();
    this.#settling.delete(henchman.agentId);
    const event = eventForStatus(henchman.status);
    if (!event) return;
    const cancel = this.#o.schedule(() => {
      this.#settling.delete(henchman.agentId);
      if (eventStillHolds(event, this.#status.get(henchman.agentId))) this.#emit(henchman, event);
    }, this.#o.settleMs);
    this.#settling.set(henchman.agentId, cancel);
  }

  /** AgentManager: the henchman's owner opened a PR through the office. */
  pullRequestOpened(view: HenchmanSnapshot, pr: { number: number; url: string; created: boolean }) {
    if (!pr.created) return;
    this.#emit({ ...snapshotOf(view), prNumber: pr.number }, "pr_opened", pr.url);
  }

  /** GitHub event bus (webhooks or polling, #35; pr-merged.ts): a henchman's PR was merged. */
  pullRequestMerged(henchman: HenchmanSnapshot, prUrl?: string): void {
    this.#emit(snapshotOf(henchman), "pr_merged", prUrl);
  }

  /** The henchman left (sent home): forget it. */
  henchmanRemoved(agentId: string): void {
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

  #emit(henchman: HenchmanSnapshot, event: NotificationEvent, prUrl?: string): void {
    const now = this.#o.now();
    const key = `${henchman.agentId}:${event}:${event.startsWith("pr_") ? henchman.prNumber : ""}`;
    const last = this.#lastSent.get(key);
    if (last !== undefined && now - last < this.#o.cooldownMs) return;
    this.#lastSent.set(key, now);
    const notice = this.#notice(henchman, event, prUrl);
    try {
      this.#personal(notice);
    } catch (err) {
      this.#o.logger.warn({ err: (err as Error).name, event }, "personal notification failed");
    }
    this.#teamDeliver(notice);
  }

  #notice(henchman: HenchmanSnapshot, event: NotificationEvent, prUrl?: string): HenchmanNotice {
    const { directory } = this.#o;
    this.#seq += 1;
    return {
      id: `${this.#o.now()}-${this.#seq}`,
      event,
      agentId: henchman.agentId,
      operationId: henchman.operationId,
      operationName: directory.operationName(henchman.operationId),
      ownerUserId: henchman.ownerUserId,
      ownerName: henchman.ownerName,
      henchmanName: henchmanDisplayName(henchman.ownerName, henchman.provider),
      provider: henchman.provider,
      taskTitle: henchman.taskTitle.slice(0, 200),
      prNumber: henchman.prNumber,
      prUrl: prUrl?.startsWith("https://")
        ? prUrl
        : directory.prUrl(henchman.repoId, henchman.prNumber),
      ts: this.#o.now(),
    };
  }

  #personal(n: HenchmanNotice): void {
    const sink = this.personal;
    if (!sink) return;
    const { directory } = this.#o;
    const payload = (own: boolean): NotifyEvent => ({
      id: n.id,
      event: n.event,
      agentId: n.agentId,
      operationId: n.operationId,
      operationName: n.operationName.slice(0, 100),
      henchmanName: n.henchmanName.slice(0, 120),
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

  #teamDeliver(n: HenchmanNotice): void {
    const channels = this.#o.channels
      .routable()
      .filter((c) => c.events.includes(n.event))
      .filter((c) => c.operationIds === null || c.operationIds.includes(n.operationId));
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
