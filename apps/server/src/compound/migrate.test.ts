/**
 * The compound migration on a real pre-compound database (#181): the schema
 * at 0012 with several operations (one archived), repos, members, desks and live
 * henchmen holding seats; then the 0013 SQL migration and the boot step.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCompoundLayout, layoutProblems, mainCorridor } from "@regulus/room-layout";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  type Db,
  MIGRATIONS_DIR,
  openDatabase,
  runMigrations,
} from "../db/index.ts";
import { auditLog, users } from "../db/schema/index.ts";
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

/** Elevator index → [seat ids, desk seats occupied by working henchmen]. */
const OPERATIONS = [
  { id: "f-alpha", name: "Alpha", index: 1, seats: 6, henchmen: 2 },
  { id: "f-beta", name: "Beta", index: 2, seats: 12, henchmen: 3 },
  { id: "f-gamma", name: "Gamma", index: 3, seats: 20, henchmen: 1 },
  { id: "f-delta", name: "Delta", index: 4, seats: 6, henchmen: 0 },
  { id: "f-old", name: "Old", index: 5, seats: 6, henchmen: 0, archived: true },
  { id: "f-eps", name: "Epsilon", index: 6, seats: 12, henchmen: 1 },
];

/** Insert one row with raw SQL: at 0012 the tables still have their pre-#226 names. */
function insertRow(db: Db, table: string, row: Record<string, string | number | null>): void {
  const cols = Object.keys(row);
  db.$client
    .prepare(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(row));
}

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
  const t = { created_at: created, updated_at: created };
  for (const f of OPERATIONS) {
    insertRow(db, "floors", {
      id: f.id,
      name: f.name,
      slug: f.id,
      index: f.index,
      palette_id: "oak-sky",
      layout_template_id: "office-l2",
      archived_at: f.archived ? created : null,
      created_at: created - f.index,
      updated_at: created,
    });
    insertRow(db, "floor_repos", {
      id: `${f.id}-repo`,
      floor_id: f.id,
      owner: "octo",
      name: f.id,
      url: `https://github.com/octo/${f.id}`,
      workdir: `/srv/office/projects/${f.id}/${f.id}`,
      is_primary: 1,
      clone_status: "ready",
      ...t,
    });
    insertRow(db, "floor_members", {
      id: `${f.id}-member`,
      floor_id: f.id,
      user_id: "u1",
      access: "manage",
      ...t,
    });
    for (let s = 1; s <= f.seats; s++) {
      insertRow(db, "desks", {
        id: `${f.id}-desk-${s}`,
        floor_id: f.id,
        seat_id: `desk-${s}`,
        ...t,
      });
    }
    for (let r = 1; r <= f.henchmen; r++) {
      const agentId = `${f.id}-henchman-${r}`;
      insertRow(db, "agents", {
        id: agentId,
        floor_id: f.id,
        repo_id: `${f.id}-repo`,
        desk_seat_id: `desk-${r}`,
        owner_user_id: "u1",
        provider: "claude-code",
        model: "m",
        profile_id: "login:claude-code",
        status: r === 1 ? "working" : "waiting_permission",
        tmux_session: `rg181-${agentId}`,
        workdir: `/w/${agentId}`,
        task_title: `task ${r}`,
        ...t,
      });
      db.$client
        .prepare("UPDATE desks SET agent_id = ? WHERE floor_id = ? AND seat_id = ?")
        .run(agentId, f.id, `desk-${r}`);
    }
  }
  return db;
}

/** Everything that must survive the migrations untouched, by its 0012 or current table names. */
function keptRows(db: Db, names: "0012" | "current" = "current") {
  const [repos, members] =
    names === "0012" ? ["floor_repos", "floor_members"] : ["operation_repos", "operation_members"];
  const rows = (table: string) =>
    (
      db.$client.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[]
    ).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k === "floor_id" ? "operation_id" : k, v]),
      ),
    );
  return {
    repos: rows(repos),
    members: rows(members),
    desks: rows("desks"),
    agents: rows("agents"),
  };
}

describe("compound migration", () => {
  test("pre-compound operations become ready rooms in a row off the main corridor", async () => {
    const db = await preCompoundOffice();
    const before = keptRows(db, "0012");
    runMigrations(db);
    const raw = db.$client
      .prepare("SELECT id, grid_x, build_state FROM operations")
      .all() as Array<{
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
      OPERATIONS.filter((f) => !f.archived)
        .map((f) => f.id)
        .sort(),
    );
    const corridor = mainCorridor(result.spec);
    for (const room of rooms) {
      expect(room.buildState).toBe("ready");
      expect(room.placement?.doorSide).toBe("south");
    }
    // The first row sits right on the main corridor; the first operations fill it.
    const alpha = rooms.find((r) => r.id === "f-alpha")?.placement;
    expect((alpha?.gridY ?? 0) + (alpha?.depth ?? 0)).toBe(corridor.y);
    // Sizes follow the old desk seats.
    expect(rooms.find((r) => r.id === "f-gamma")?.placement?.width).toBe(12);
    expect(rooms.find((r) => r.id === "f-alpha")?.placement?.width).toBe(8);
    expect(rooms.find((r) => r.id === "f-beta")?.placement?.width).toBe(10);

    const inputs = rooms.map((r) => ({ id: r.id, placement: r.placement ?? never() }));
    expect(layoutProblems(result.spec, inputs)).toEqual([]);
    expect(computeCompoundLayout(result.spec, inputs).unreachable).toEqual([]);

    // Archived operations stay off the map until restored.
    const old = db.$client.prepare("SELECT grid_x FROM operations WHERE id = 'f-old'").get() as {
      grid_x: number | null;
    };
    expect(old.grid_x).toBeNull();

    // Repos, members, desks with their henchmen, and the henchmen themselves are untouched.
    expect(keptRows(db)).toEqual(before);
    expect(before.agents.filter((a) => a.status === "working")).toHaveLength(4);

    const audit = db.select().from(auditLog).where(eq(auditLog.action, "compound.create")).all();
    expect(audit).toHaveLength(1);
  });

  test("is idempotent and places restored or unplaced operations later", async () => {
    const db = await preCompoundOffice();
    runMigrations(db);
    ensureCompound(db, { sizeTiles: 64 });
    const first = liveRooms(db);
    const again = ensureCompound(db, { sizeTiles: 64 });
    expect(again.created).toBe(false);
    expect(again.placed).toEqual([]);
    expect(liveRooms(db)).toEqual(first);

    db.$client.prepare("UPDATE operations SET archived_at = NULL WHERE id = 'f-old'").run();
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
