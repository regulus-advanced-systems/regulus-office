/**
 * The compound migration on a real pre-compound database (#181): the schema
 * at 0012 with several floors (one archived), repos, members, desks and live
 * robots holding seats; then the 0013 SQL migration and the boot step.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCompoundLayout, layoutProblems, mainCorridor } from "@regulus/floor-layout";
import { and, asc, eq } from "drizzle-orm";
import {
  closeDatabase,
  type Db,
  MIGRATIONS_DIR,
  openDatabase,
  runMigrations,
} from "../db/index.ts";
import { agents, auditLog, desks, floorMembers, floorRepos, users } from "../db/schema/index.ts";
import { ensureCompound } from "./migrate.ts";
import { liveRooms, readSpec } from "./store.ts";

const dirs: string[] = [];
const dbs: Db[] = [];
afterAll(async () => {
  for (const db of dbs) closeDatabase(db);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** The shipped migrations up to and including `lastIdx`, in a temp folder. */
async function migrationsUpTo(lastIdx: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rg181-migrations-"));
  dirs.push(dir);
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const e of journal.entries.filter((e) => e.idx > lastIdx)) {
    await rm(join(dir, `${e.tag}.sql`));
  }
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  await writeFile(journalPath, JSON.stringify(journal));
  return dir;
}

/** Elevator index → [seat ids, desk seats occupied by working robots]. */
const FLOORS = [
  { id: "f-alpha", name: "Alpha", index: 1, seats: 6, robots: 2 },
  { id: "f-beta", name: "Beta", index: 2, seats: 12, robots: 3 },
  { id: "f-gamma", name: "Gamma", index: 3, seats: 20, robots: 1 },
  { id: "f-delta", name: "Delta", index: 4, seats: 6, robots: 0 },
  { id: "f-old", name: "Old", index: 5, seats: 6, robots: 0, archived: true },
  { id: "f-eps", name: "Epsilon", index: 6, seats: 12, robots: 1 },
];

async function preCompoundOffice(): Promise<Db> {
  const dir = await mkdtemp(join(tmpdir(), "rg181-db-"));
  dirs.push(dir);
  const db = openDatabase({ path: join(dir, "office.db") });
  dbs.push(db);
  runMigrations(db, await migrationsUpTo(12));
  db.insert(users)
    .values({ id: "u1", name: "Olga", email: "o@x.test", emailVerified: false })
    .run();
  // Raw SQL: the drizzle schema has user_profiles columns from later migrations (0016 avatar).
  db.$client
    .prepare(
      `INSERT INTO user_profiles (id, user_id, display_name, role, created_at, updated_at)
       VALUES ('p1', 'u1', 'Olga', 'owner', 0, 0)`,
    )
    .run();
  const created = 1_700_000_000_000;
  for (const f of FLOORS) {
    // Raw SQL: the drizzle schema already has the 0013 columns.
    db.$client
      .prepare(
        `INSERT INTO floors (id, name, slug, "index", palette_id, layout_template_id, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'oak-sky', 'office-l2', ?, ?, ?)`,
      )
      .run(f.id, f.name, f.id, f.index, f.archived ? created : null, created - f.index, created);
    db.insert(floorRepos)
      .values({
        id: `${f.id}-repo`,
        floorId: f.id,
        owner: "octo",
        name: f.id,
        url: `https://github.com/octo/${f.id}`,
        workdir: `/srv/office/projects/${f.id}/${f.id}`,
        isPrimary: true,
        cloneStatus: "ready",
      })
      .run();
    db.insert(floorMembers).values({ floorId: f.id, userId: "u1", access: "manage" }).run();
    for (let s = 1; s <= f.seats; s++) {
      db.insert(desks)
        .values({ floorId: f.id, seatId: `desk-${s}` })
        .run();
    }
    for (let r = 1; r <= f.robots; r++) {
      const agentId = `${f.id}-robot-${r}`;
      db.insert(agents)
        .values({
          id: agentId,
          floorId: f.id,
          repoId: `${f.id}-repo`,
          deskSeatId: `desk-${r}`,
          ownerUserId: "u1",
          provider: "claude-code",
          model: "m",
          profileId: "login:claude-code",
          status: r === 1 ? "working" : "waiting_permission",
          tmuxSession: `rg181-${agentId}`,
          workdir: `/w/${agentId}`,
          taskTitle: `task ${r}`,
        })
        .run();
      db.update(desks)
        .set({ agentId })
        .where(and(eq(desks.floorId, f.id), eq(desks.seatId, `desk-${r}`)))
        .run();
    }
  }
  return db;
}

/** Everything that must survive the migration untouched. */
function keptRows(db: Db) {
  return {
    repos: db.select().from(floorRepos).orderBy(asc(floorRepos.id)).all(),
    members: db.select().from(floorMembers).orderBy(asc(floorMembers.id)).all(),
    desks: db.select().from(desks).orderBy(asc(desks.id)).all(),
    agents: db.select().from(agents).orderBy(asc(agents.id)).all(),
  };
}

describe("compound migration", () => {
  test("pre-compound floors become ready rooms in a row off the main corridor", async () => {
    const db = await preCompoundOffice();
    const before = keptRows(db);
    runMigrations(db);
    const raw = db.$client.prepare("SELECT id, grid_x, build_state FROM floors").all() as Array<{
      grid_x: number | null;
      build_state: string;
    }>;
    expect(raw.every((r) => r.grid_x === null && r.build_state === "ready")).toBe(true);

    const result = ensureCompound(db, { sizeTiles: 64 });
    expect(result.created).toBe(true);
    expect(result.unplaced).toEqual([]);
    const spec = readSpec(db);
    expect(spec).toEqual(result.spec);
    expect(spec?.width).toBe(64);

    const rooms = liveRooms(db);
    expect(rooms.map((r) => r.id).sort()).toEqual(
      FLOORS.filter((f) => !f.archived)
        .map((f) => f.id)
        .sort(),
    );
    const corridor = mainCorridor(result.spec);
    for (const room of rooms) {
      expect(room.buildState).toBe("ready");
      expect(room.placement?.doorSide).toBe("south");
    }
    // The first row sits right on the main corridor; the first floors fill it.
    const alpha = rooms.find((r) => r.id === "f-alpha")?.placement;
    expect((alpha?.gridY ?? 0) + (alpha?.depth ?? 0)).toBe(corridor.y);
    // Sizes follow the old desk seats.
    expect(rooms.find((r) => r.id === "f-gamma")?.placement?.width).toBe(12);
    expect(rooms.find((r) => r.id === "f-alpha")?.placement?.width).toBe(8);
    expect(rooms.find((r) => r.id === "f-beta")?.placement?.width).toBe(10);

    const inputs = rooms.map((r) => ({ id: r.id, placement: r.placement ?? never() }));
    expect(layoutProblems(result.spec, inputs)).toEqual([]);
    expect(computeCompoundLayout(result.spec, inputs).unreachable).toEqual([]);

    // Archived floors stay off the map until restored.
    const old = db.$client.prepare("SELECT grid_x FROM floors WHERE id = 'f-old'").get() as {
      grid_x: number | null;
    };
    expect(old.grid_x).toBeNull();

    // Repos, members, desks with their robots, and the robots themselves are untouched.
    expect(keptRows(db)).toEqual(before);
    expect(before.agents.filter((a) => a.status === "working")).toHaveLength(4);

    const audit = db.select().from(auditLog).where(eq(auditLog.action, "compound.create")).all();
    expect(audit).toHaveLength(1);
  });

  test("is idempotent and places restored or unplaced floors later", async () => {
    const db = await preCompoundOffice();
    runMigrations(db);
    ensureCompound(db, { sizeTiles: 64 });
    const first = liveRooms(db);
    const again = ensureCompound(db, { sizeTiles: 64 });
    expect(again.created).toBe(false);
    expect(again.placed).toEqual([]);
    expect(liveRooms(db)).toEqual(first);

    db.$client.prepare("UPDATE floors SET archived_at = NULL WHERE id = 'f-old'").run();
    const restored = ensureCompound(db, { sizeTiles: 64 });
    expect(restored.placed).toEqual(["f-old"]);
    const rooms = liveRooms(db);
    for (const r of first) {
      expect(rooms.find((x) => x.id === r.id)?.placement).toEqual(r.placement);
    }
    const inputs = rooms.map((r) => ({ id: r.id, placement: r.placement ?? never() }));
    expect(layoutProblems(restored.spec, inputs)).toEqual([]);
  });

  test("an empty office gets the compound and nothing else", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rg181-db-"));
    dirs.push(dir);
    const db = openDatabase({ path: join(dir, "office.db") });
    dbs.push(db);
    runMigrations(db);
    const result = ensureCompound(db, { sizeTiles: 80 });
    expect(result.spec.width).toBe(80);
    expect(result.spec.lobby.y + result.spec.lobby.d).toBe(80);
    expect(result.placed).toEqual([]);
  });
});

function never(): never {
  throw new Error("room not placed");
}
