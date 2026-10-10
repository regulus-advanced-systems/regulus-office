/**
 * Fixture for the tests of encryption at rest (#301; seal.test.ts,
 * seal-existing.test.ts): an office database in a temporary directory with
 * one agent whose document, memory and note each hold a canary, and what the
 * rows and the files on disk hold. Only imported by tests.
 */
import { afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabase,
  type Db,
  databasePathFor,
  openDatabase,
  runMigrations,
} from "../../db/index.ts";
import { OfficeAgentStore } from "../store.ts";
import { AgentMind } from "./mind.ts";
import type { MindCipher } from "./seal.ts";
import { MindStore } from "./store.ts";

export const SOUL = "You are Ledger. SOULCANARY: be blunt.";
export const MEMORY = "MEMORYCANARY the launch is on Friday";
export const SOURCE = "SOURCECANARY Mia, in chat";
export const TITLE = "TITLECANARY Launch plan";
export const NOTE = "NOTECANARY step one, step two";
export const CANARIES = ["SOULCANARY", "MEMORYCANARY", "SOURCECANARY", "TITLECANARY", "NOTECANARY"];

const dirs: string[] = [];
export const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function office(cipher: MindCipher, path?: string, busyTimeoutMs?: number) {
  let file = path;
  if (!file) {
    const dir = mkdtempSync(join(tmpdir(), "rgo-seal-"));
    dirs.push(dir);
    file = databasePathFor(dir);
  }
  const db = openDatabase({ path: file, busyTimeoutMs });
  open.push(db);
  runMigrations(db);
  const store = new OfficeAgentStore(db, Date.now, cipher);
  const mind = new AgentMind(new MindStore(db, Date.now, cipher));
  return { db, file, store, mind };
}

export function fill({ store, mind }: Pick<ReturnType<typeof office>, "store" | "mind">) {
  const agent = store.insert(store.db, {
    name: "Ledger",
    ownerUserId: null,
    engine: "cli-session",
    role: "pm",
    preset: "coordinator",
    provider: "claude-code",
    model: "sonnet",
    instructions: SOUL,
  });
  mind.saveSoul(agent.id, SOUL, { userId: null, kind: "created" });
  mind.saveSoul(agent.id, `${SOUL} v2`, { userId: null, kind: "edit" });
  const memory = mind.addMemory(agent.id, { text: MEMORY, source: SOURCE }, "agent", ["op-1"]);
  mind.writeNote(agent.id, { title: TITLE, text: NOTE }, "agent");
  return { agent, memory };
}

/** Every table that holds an agent's text, as the rows are. */
export const rows = (db: Db) =>
  JSON.stringify(
    ["office_agents", "office_agent_soul_versions", "office_agent_memories"].map((table) =>
      db.$client.query(`select * from ${table}`).all(),
    ),
  );

/** The database as a backup would copy it: the file and whatever sits beside it (the WAL). */
export function onDisk(db: Db, file: string): string {
  db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  const dir = join(file, "..");
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name)).toString("latin1"))
    .join("\n");
}
