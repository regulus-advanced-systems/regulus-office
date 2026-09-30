/**
 * Usage tracker (#40): turns what adapters already emit into rows.
 *
 * - `agentEvent`: `usage` / `limit` events of a robot (Claude statusline via
 *   the hook routes, Codex `thread/tokenUsage/updated` and
 *   `account/rateLimits/*` via its control), published by the AgentManager.
 * - `transcriptSample`: the periodic scan in a human's runner (scanner.ts).
 * - `recordUsage`: for other office code (workflows, #155; office agents).
 *
 * Attribution (SPEC §8 rule 3, D2): usage of a robot spawned with an
 * office-wide key (`profileId` `office:<provider>`) belongs to `office`
 * (`userId` null), everything else to the robot's owner. Office keys have no
 * plan windows, so their limit readings are not stored. Nothing is enforced
 * (D13).
 */
import type { AgentEvent, LimitSample, ProviderId, UsageSample } from "@regulus/protocol";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import { estimateCostUsd, normalizeModel } from "./prices.ts";
import { UsageStore } from "./store.ts";

/** Who a usage record is charged to. */
export type UsageAttribution = "office" | { userId: string };

export interface RecordUsageInput {
  attributedTo: UsageAttribution;
  provider: ProviderId;
  sample: UsageSample;
  /** The robot or office agent row, when there is one. */
  agentId?: string;
  /** Model id for the price estimate when `sample.model` is absent. */
  model?: string;
}

/** The small API other modules use (#155 workflows attribute office usage through it). */
export interface UsageRecorder {
  /** True when stored; false when a sample with the same `dedupeKey` was already counted. */
  recordUsage(input: RecordUsageInput): boolean;
}

interface AgentInfo {
  ownerUserId: string;
  provider: ProviderId;
  model: string;
  office: boolean;
}

const OFFICE_PROFILE = /^office:/;

export class UsageTracker implements UsageRecorder {
  readonly store: UsageStore;
  readonly #agents = new Map<string, AgentInfo | null>();

  constructor(
    private readonly db: Db,
    /** Called after a sample was stored (the office summary may have changed). */
    private readonly onStored: () => void = () => {},
  ) {
    this.store = new UsageStore(db);
  }

  recordUsage(input: RecordUsageInput): boolean {
    const userId = input.attributedTo === "office" ? null : input.attributedTo.userId;
    const agentId = input.agentId ?? null;
    return this.#insert(
      userId,
      agentId,
      input.provider,
      input.model,
      input.sample,
      agentId ?? "api",
    );
  }

  /** A robot's `usage` or `limit` event (other kinds are ignored). */
  agentEvent(agentId: string, event: AgentEvent): void {
    if (event.kind !== "usage" && event.kind !== "limit") return;
    const agent = this.#agent(agentId);
    if (!agent) return;
    if (event.kind === "limit") {
      if (!agent.office) this.store.upsertLimit(agent.ownerUserId, agent.provider, event);
      return;
    }
    const { kind: _, ...sample } = event;
    const userId = agent.office ? null : agent.ownerUserId;
    this.#insert(userId, agentId, agent.provider, agent.model, sample, agentId);
  }

  /** A limit reading for a human, outside any robot (e.g. the scan's cached statusline limits). */
  limit(userId: string, provider: ProviderId, limit: LimitSample): void {
    this.store.upsertLimit(userId, provider, limit);
  }

  /**
   * Transcript usage found in `userId`'s runner. The session id finds the
   * robot (and an office-key robot's usage goes to `office`); usage of
   * sessions no robot owns (the human's own terminal) is the human's.
   */
  transcriptSamples(userId: string, provider: ProviderId, samples: readonly UsageSample[]): number {
    const sessions = [...new Set(samples.flatMap((s) => (s.sessionId ? [s.sessionId] : [])))];
    const bySession = this.#robotsBySession(userId, sessions);
    let stored = 0;
    for (const sample of samples) {
      const robot = sample.sessionId ? bySession.get(sample.sessionId) : undefined;
      const owner = robot ? this.#agent(robot) : null;
      const attributed = owner?.office ? null : userId;
      const model = sample.model ?? owner?.model;
      if (this.#insert(attributed, robot ?? null, provider, model, sample, userId)) stored++;
    }
    return stored;
  }

  /** The agent row changed hands or was removed; drop the cached attribution. */
  forgetAgent(agentId: string): void {
    this.#agents.delete(agentId);
  }

  #insert(
    userId: string | null,
    agentId: string | null,
    provider: ProviderId,
    fallbackModel: string | undefined,
    sample: UsageSample,
    scope: string,
  ): boolean {
    const model = normalizeModel(provider, sample.model ?? fallbackModel) || null;
    const costUsd = sample.costUsdEstimate ?? estimateCostUsd(provider, model, sample);
    const dedupeKey = sample.dedupeKey
      ? `${provider}:${sample.source}:${scope}:${sample.dedupeKey}`
      : null;
    const stored = this.store.insertSample({
      userId,
      agentId,
      provider,
      model,
      sample,
      costUsd,
      dedupeKey,
    });
    if (stored) this.onStored();
    return stored;
  }

  #agent(agentId: string): AgentInfo | null {
    if (this.#agents.has(agentId)) return this.#agents.get(agentId) ?? null;
    const row = this.db
      .select({
        ownerUserId: agents.ownerUserId,
        provider: agents.provider,
        model: agents.model,
        profileId: agents.profileId,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    const info = row
      ? {
          ownerUserId: row.ownerUserId,
          provider: row.provider,
          model: row.model,
          office: OFFICE_PROFILE.test(row.profileId),
        }
      : null;
    if (this.#agents.size > 2000) this.#agents.clear();
    if (info) this.#agents.set(agentId, info);
    return info;
  }

  #robotsBySession(userId: string, sessions: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (let i = 0; i < sessions.length; i += 200) {
      const rows = this.db
        .select({ id: agents.id, session: agents.providerSessionId })
        .from(agents)
        .where(
          and(
            eq(agents.ownerUserId, userId),
            inArray(agents.providerSessionId, sessions.slice(i, i + 200)),
          ),
        )
        .all();
      for (const r of rows) if (r.session) out.set(r.session, r.id);
    }
    return out;
  }
}
