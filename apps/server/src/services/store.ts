/**
 * The `services` table (SPEC §5, #39): the running apps of every robot, so the
 * first-seen time and ids survive an office restart. The scanner owns the rows;
 * rows of robots that are gone are removed with them (and by the FK cascade
 * when a robot row is deleted).
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { services } from "../db/schema/index.ts";

export interface StoredService {
  id: string;
  agentId: string;
  port: number;
  pid: number;
  url: string;
  title: string;
  address: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export class ServiceStore {
  constructor(private readonly db: Db) {}

  all(): StoredService[] {
    return this.db
      .select()
      .from(services)
      .all()
      .map((r) => ({
        id: r.id,
        agentId: r.agentId,
        port: r.port,
        pid: r.pid,
        url: r.url,
        title: r.title ?? "",
        address: r.address,
        firstSeenAt: r.firstSeenAt.getTime(),
        lastSeenAt: r.lastSeenAt.getTime(),
      }));
  }

  /** Insert or update one robot's service (unique on robot and port). */
  upsert(s: StoredService): void {
    const values = {
      pid: s.pid,
      url: s.url,
      title: s.title,
      address: s.address,
      lastSeenAt: new Date(s.lastSeenAt),
    };
    this.db
      .insert(services)
      .values({
        id: s.id,
        agentId: s.agentId,
        port: s.port,
        firstSeenAt: new Date(s.firstSeenAt),
        ...values,
      })
      .onConflictDoUpdate({ target: [services.agentId, services.port], set: values })
      .run();
  }

  /** Remove a robot's rows except `keepPorts`. */
  prune(agentId: string, keepPorts: readonly number[]): void {
    const where =
      keepPorts.length > 0
        ? and(eq(services.agentId, agentId), notInArray(services.port, [...keepPorts]))
        : eq(services.agentId, agentId);
    this.db.delete(services).where(where).run();
  }

  /** Remove every row of robots not in `agentIds`. */
  retainAgents(agentIds: readonly string[]): void {
    if (agentIds.length === 0) this.db.delete(services).run();
    else
      this.db
        .delete(services)
        .where(notInArray(services.agentId, [...agentIds]))
        .run();
  }

  removeAgents(agentIds: readonly string[]): void {
    if (agentIds.length > 0)
      this.db
        .delete(services)
        .where(inArray(services.agentId, [...agentIds]))
        .run();
  }
}
