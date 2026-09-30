import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  type Db,
  databasePathFor,
  MEMORY_DB_PATH,
  openDatabase,
  runMigrations,
  schema,
} from "./index.ts";

/** Every table named in docs/SPEC.md §5. */
const SPEC_TABLES = [
  "users",
  "user_profiles",
  "invites",
  "floors",
  "floor_repos",
  "floor_members",
  "desks",
  "agents",
  "agent_events",
  "credential_profiles",
  "usage_samples",
  "usage_limits",
  "tasks",
  "github_issues",
  "github_pulls",
  "decor",
  "whiteboards",
  "jukebox_tracks",
  "jukebox_state",
  "services",
  "pm_briefs",
  "audit_log",
] as const;

/** Tables outside SPEC §5 that the server adds for its own bookkeeping. */
const EXTRA_TABLES = [
  "chat_messages",
  "github_connection",
  "notification_channels",
  "notification_prefs",
  "notification_marks",
  "github_webhook_deliveries",
  "workflows",
  "workflow_runs",
  "workflow_events",
  "floor_queue_settings",
] as const;

/** Better Auth's remaining core tables (`users` is in SPEC_TABLES); see schema/auth.ts. */
const BETTER_AUTH_TABLES = ["sessions", "accounts", "verifications"] as const;

const opened: Db[] = [];
const tempDirs: string[] = [];

function openMigrated(path = MEMORY_DB_PATH): Db {
  const db = openDatabase({ path });
  runMigrations(db);
  opened.push(db);
  return db;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "office-db-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const db of opened.splice(0)) closeDatabase(db);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: Db): string[] {
  const rows = db.$client
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  return rows.map((r) => r.name);
}

async function seedFloorWithAgent(db: Db) {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Ante", email: "ante@example.com" })
    .returning();
  if (!user) throw new Error("insert users returned nothing");
  await db
    .insert(schema.userProfiles)
    .values({ userId: user.id, displayName: "Ante", role: "owner" });
  const [floor] = await db
    .insert(schema.floors)
    .values({
      name: "Regulus",
      slug: "regulus",
      index: 1,
      paletteId: "teal",
      layoutTemplateId: "l2",
    })
    .returning();
  if (!floor) throw new Error("insert floors returned nothing");
  const [repo] = await db
    .insert(schema.floorRepos)
    .values({
      floorId: floor.id,
      owner: "regulus-advanced-systems",
      name: "regulus-office",
      url: "https://github.com/regulus-advanced-systems/regulus-office",
      workdir: "/srv/office/projects/regulus/regulus-office",
      isPrimary: true,
    })
    .returning();
  if (!repo) throw new Error("insert floor_repos returned nothing");
  const [agent] = await db
    .insert(schema.agents)
    .values({
      floorId: floor.id,
      repoId: repo.id,
      deskSeatId: "seat-1",
      ownerUserId: user.id,
      provider: "claude-code",
      model: "claude-fable-5-1",
      profileId: "office:claude-code",
      workdir: repo.workdir,
      taskTitle: "Build the schema",
    })
    .returning();
  if (!agent) throw new Error("insert agents returned nothing");
  return { user, floor, repo, agent };
}

describe("openDatabase", () => {
  test("applies busy_timeout and foreign_keys pragmas", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH, busyTimeoutMs: 1234 });
    opened.push(db);
    expect(db.$client.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.$client.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 1234 });
  });

  test("uses WAL journal mode and creates the parent directory for file databases", () => {
    const path = databasePathFor(join(tempDir(), "nested", "data"));
    const db = openDatabase({ path });
    opened.push(db);
    expect(db.$client.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.$client.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });
});

describe("runMigrations", () => {
  test("creates every SPEC §5 table from an empty database", () => {
    const names = tableNames(openMigrated());
    for (const table of SPEC_TABLES) expect(names).toContain(table);
    for (const table of EXTRA_TABLES) expect(names).toContain(table);
    for (const table of BETTER_AUTH_TABLES) expect(names).toContain(table);
    expect(names).toContain("__drizzle_migrations");
  });

  test("is idempotent", () => {
    const db = openMigrated();
    runMigrations(db);
    expect(tableNames(db).length).toBe(
      SPEC_TABLES.length + EXTRA_TABLES.length + BETTER_AUTH_TABLES.length + 1,
    );
  });

  test("works on a file database and survives reopen", () => {
    const path = databasePathFor(tempDir());
    closeDatabase(openMigrated(path));
    opened.pop();
    const reopened = openMigrated(path);
    expect(tableNames(reopened)).toContain("agents");
  });
});

describe("schema smoke", () => {
  test("inserts and reads across users, floors, agents and events", async () => {
    const db = openMigrated();
    const { user, floor, agent } = await seedFloorWithAgent(db);

    await db.insert(schema.agentEvents).values({
      agentId: agent.id,
      ts: new Date(),
      kind: "status",
      payloadJson: JSON.stringify({ status: "working" }),
    });
    await db
      .insert(schema.desks)
      .values({ floorId: floor.id, seatId: "seat-1", agentId: agent.id });

    const found = await db.query.agents.findFirst({ where: eq(schema.agents.id, agent.id) });
    expect(found?.status).toBe("starting");
    expect(found?.ownerUserId).toBe(user.id);
    expect(found?.createdAt).toBeInstanceOf(Date);

    const events = await db.select().from(schema.agentEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("status");
  });

  test("bumps updatedAt on update", async () => {
    const db = openMigrated();
    const { floor } = await seedFloorWithAgent(db);
    const before = floor.updatedAt.getTime();
    await Bun.sleep(5);
    const [updated] = await db
      .update(schema.floors)
      .set({ name: "Renamed" })
      .where(eq(schema.floors.id, floor.id))
      .returning();
    expect(updated?.name).toBe("Renamed");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(before);
    expect(updated?.createdAt.getTime()).toBe(floor.createdAt.getTime());
  });

  test("enforces foreign keys and cascades agent deletion to events", async () => {
    const db = openMigrated();
    const { agent } = await seedFloorWithAgent(db);
    await db.insert(schema.agentEvents).values({
      agentId: agent.id,
      ts: new Date(),
      kind: "exit",
      payloadJson: "{}",
    });

    await expect(
      db
        .insert(schema.agentEvents)
        .values({ agentId: "nope", ts: new Date(), kind: "exit", payloadJson: "{}" })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/);

    await db.delete(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(await db.select().from(schema.agentEvents)).toHaveLength(0);
  });

  test("rejects enum values outside the protocol lists", async () => {
    const db = openMigrated();
    const { floor, repo, user } = await seedFloorWithAgent(db);
    const bad = db.insert(schema.agents).values({
      floorId: floor.id,
      repoId: repo.id,
      deskSeatId: "seat-2",
      ownerUserId: user.id,
      // Bypass the TS-level enum so the database CHECK is what rejects it.
      provider: "not-a-provider" as ProviderId,
      model: "m",
      profileId: "p",
      workdir: "/tmp",
      taskTitle: "t",
    });
    await expect(bad.execute()).rejects.toThrow(/CHECK/);
  });

  test("credential profiles: cli_login rows never carry a secret; office keys allowed", async () => {
    const db = openMigrated();
    const { user } = await seedFloorWithAgent(db);

    await db.insert(schema.credentialProfiles).values({
      userId: user.id,
      provider: "claude-code",
      label: "My Claude subscription",
      authKind: "cli_login",
    });
    await db.insert(schema.credentialProfiles).values({
      userId: null,
      provider: "custom",
      label: "Office DeepSeek key",
      authKind: "base_url_key",
      baseUrl: "https://api.deepseek.com",
      encryptedSecret: "envelope:opaque",
    });

    await expect(
      db
        .insert(schema.credentialProfiles)
        .values({
          userId: user.id,
          provider: "codex",
          label: "leaked token",
          authKind: "cli_login",
          encryptedSecret: "should-never-be-stored",
        })
        .execute(),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db
        .insert(schema.credentialProfiles)
        .values({
          userId: null,
          provider: "codex",
          label: "office subscription",
          authKind: "cli_login",
        })
        .execute(),
    ).rejects.toThrow(/CHECK/);
  });

  test("usage and limits upsert by (user, provider, window)", async () => {
    const db = openMigrated();
    const { user, agent } = await seedFloorWithAgent(db);
    await db.insert(schema.usageSamples).values({
      userId: user.id,
      agentId: agent.id,
      provider: "claude-code",
      ts: new Date(),
      inputTokens: 100,
      outputTokens: 20,
      costUsdEstimate: 0.01,
      source: "inband",
    });
    const limit = {
      userId: user.id,
      provider: "claude-code" as const,
      windowKind: "five_hour" as const,
      usedPct: 10,
      observedAt: new Date(),
      source: "statusline" as const,
    };
    await db.insert(schema.usageLimits).values(limit);
    await db
      .insert(schema.usageLimits)
      .values({ ...limit, usedPct: 42 })
      .onConflictDoUpdate({
        target: [
          schema.usageLimits.userId,
          schema.usageLimits.provider,
          schema.usageLimits.windowKind,
        ],
        set: { usedPct: 42 },
      });
    const limits = await db.select().from(schema.usageLimits);
    expect(limits).toHaveLength(1);
    expect(limits[0]?.usedPct).toBe(42);
  });
});
