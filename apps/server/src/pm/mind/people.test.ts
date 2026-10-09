/**
 * People and an agent's soul, memories and notes over a real server with
 * sessions (#136, D20): who may read and change them (the matrix), what an
 * admin can still do with a personal agent, the version history, and that
 * the private text is in no answer, audit entry or log line for anyone else.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type MindEntriesResponse,
  type MindEntry,
  OFFICE_AGENT_MIND_LIMITS,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentSoul,
  type OfficeAgentsResponse,
  type OfficeAgentView,
  officeAgentMindPaths,
  type SoulVersion,
  type SoulVersionsResponse,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import {
  auditLog,
  MIGRATIONS_DIR,
  officeAgentMemories,
  officeAgentSoulVersions,
  officeAgents,
} from "../../db/index.ts";
import { type AgentsOffice, agentsOffice } from "../test-helpers.ts";

let o: AgentsOffice;
let hermes: OfficeAgentView;
let pm: OfficeAgentView;
let hermesMemory: MindEntry;
let pmMemory: MindEntry;

// Canaries: text that must never reach anyone but Mia.
const SOUL = "You are Hermes. Mia's SOULCANARY: she wants blunt answers.";
const MEMORY = "MEMCANARY: Mia's sister visits on Friday";
const NOTE = "NOTECANARY journal: salary talk went well";
const A = OFFICE_AGENTS_API_PATH;
const base = { engine: "cli-session", provider: "claude-code", model: "sonnet" };

const json = async <T>(res: Response) => (await res.json()) as T;
const get = (path: string, cookie: string) => o.send(path, "GET", cookie);

beforeAll(async () => {
  o = await agentsOffice();
  const officeKey = o.addOfficeKey();
  const mia = o.people.mia.cookie;
  hermes = await json(
    await o.send(A, "POST", mia, {
      ...base,
      name: "Hermes",
      owner: "me",
      role: "assistant",
      instructions: SOUL,
    }),
  );
  pm = await json(
    await o.send(A, "POST", o.people.olga.cookie, {
      ...base,
      name: "Office PM",
      owner: "office",
      role: "pm",
      profileId: officeKey,
      instructions: "You are the office PM.",
    }),
  );
  const paths = officeAgentMindPaths(hermes.id);
  hermesMemory = await json(
    await o.send(paths.entries, "POST", mia, { kind: "memory", text: MEMORY }),
  );
  await o.send(paths.entries, "POST", mia, { kind: "note", title: "Journal", text: NOTE });
  pmMemory = await json(
    await o.send(officeAgentMindPaths(pm.id).entries, "POST", o.people.ada.cookie, {
      kind: "memory",
      text: "The office ships on Thursdays",
    }),
  );
});
afterAll(async () => {
  await o.stop();
});

/** Every mind route for one agent, as [what, send]. Writes that change nothing lasting. */
function calls(agentId: string, entryId: string) {
  const p = officeAgentMindPaths(agentId);
  return [
    ["read soul", (c: string) => get(p.soul, c)],
    ["soul history", (c: string) => get(p.soulVersions, c)],
    ["one version", (c: string) => get(p.soulVersion(1), c)],
    ["list memories", (c: string) => get(`${p.entries}?kind=memory`, c)],
    ["search memories", (c: string) => get(`${p.entries}?kind=memory&q=CANARY`, c)],
    ["list notes", (c: string) => get(`${p.entries}?kind=note`, c)],
    ["save soul", (c: string) => o.send(p.soul, "PUT", c, { content: "replaced by someone" })],
    ["revert soul", (c: string) => o.send(p.soulRevert, "POST", c, { version: 1 })],
    ["add memory", (c: string) => o.send(p.entries, "POST", c, { kind: "memory", text: "added" })],
    ["edit memory", (c: string) => o.send(p.entry(entryId), "PATCH", c, { text: "edited" })],
    ["delete memory", (c: string) => o.send(p.entry(entryId), "DELETE", c)],
  ] as const;
}

describe("who may read and change an agent's soul, memories and notes", () => {
  test("a personal agent's: not another member (404), not an admin, not the office owner (403)", async () => {
    for (const [who, status, error] of [
      [o.people.sam, 404, "not_found"],
      [o.people.ada, 403, "not_your_agent"],
      [o.people.olga, 403, "not_your_agent"],
    ] as const) {
      for (const [what, send] of calls(hermes.id, hermesMemory.id)) {
        const res = await send(who.cookie);
        const body = await res.text();
        expect([what, res.status]).toEqual([what, status]);
        expect(JSON.parse(body).error).toBe(error);
        expect(body).not.toContain("CANARY");
      }
    }
    // Nothing of it changed, and nothing was written for them.
    const soul = await json<OfficeAgentSoul>(
      await get(officeAgentMindPaths(hermes.id).soul, o.people.mia.cookie),
    );
    expect(soul).toMatchObject({ version: 1, content: SOUL });
    expect(o.db.select().from(officeAgentMemories).all()).toHaveLength(3);
  });

  test("a shared agent's: office owners and admins; members and above only talk to it", async () => {
    for (const who of [o.people.mia, o.people.sam]) {
      for (const [what, send] of calls(pm.id, pmMemory.id)) {
        const res = await send(who.cookie);
        expect([what, res.status]).toEqual([what, 403]);
        expect((await json<{ error: string }>(res)).error).toBe("owner_or_admin_required");
      }
    }
    for (const who of [o.people.ada, o.people.olga]) {
      const p = officeAgentMindPaths(pm.id);
      expect((await get(p.soul, who.cookie)).status).toBe(200);
      expect((await get(p.soulVersions, who.cookie)).status).toBe(200);
      const list = await json<MindEntriesResponse>(
        await get(`${p.entries}?kind=memory`, who.cookie),
      );
      expect(list.entries.map((e) => e.text)).toContain("The office ships on Thursdays");
      const added = await o.send(p.entries, "POST", who.cookie, {
        kind: "memory",
        text: "by admin",
      });
      expect(added.status).toBe(201);
      const entry = await json<MindEntry>(added);
      expect((await o.send(p.entry(entry.id), "PATCH", who.cookie, { text: "x" })).status).toBe(
        200,
      );
      expect((await o.send(p.entry(entry.id), "DELETE", who.cookie)).status).toBe(204);
    }
  });

  test("its owner reads and changes a personal agent's; signed out and cross-origin get nothing", async () => {
    const p = officeAgentMindPaths(hermes.id);
    const mia = o.people.mia.cookie;
    expect((await o.office.request(p.soul)).status).toBe(401);
    expect((await o.office.request(`${p.entries}?kind=memory`)).status).toBe(401);
    const evil = await o.send(p.soul, "PUT", mia, { content: "x" }, "https://evil.example");
    expect(evil.status).toBe(403);
    const res = await get(p.soul, mia);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await json<OfficeAgentSoul>(res)).content).toBe(SOUL);
    const found = await json<MindEntriesResponse>(
      await get(`${p.entries}?kind=memory&q=sister friday`, mia),
    );
    expect(found.entries.map((e) => e.id)).toEqual([hermesMemory.id]);
    expect(found).toMatchObject({ total: 1, max: OFFICE_AGENT_MIND_LIMITS.memoriesMax });
    const notes = await json<MindEntriesResponse>(await get(`${p.entries}?kind=note`, mia));
    expect(notes.entries[0]).toMatchObject({ title: "Journal", text: NOTE, by: "person" });
    // One entry of another agent is not reachable through one's own agent's path.
    expect((await o.send(p.entry(pmMemory.id), "DELETE", mia)).status).toBe(404);
    // A second note with the same title is said so, not overwritten.
    const dup = await o.send(p.entries, "POST", mia, { kind: "note", title: "journal", text: "x" });
    expect([dup.status, (await json<{ error: string }>(dup)).error]).toEqual([409, "title_taken"]);
  });

  test("what an admin still sees of a personal agent: its card, and none of its text anywhere", async () => {
    for (const who of [o.people.ada, o.people.olga]) {
      const res = await get(A, who.cookie);
      const text = await res.text();
      const card = (JSON.parse(text) as OfficeAgentsResponse).agents.find(
        (a) => a.id === hermes.id,
      );
      expect(card).toMatchObject({
        name: "Hermes",
        canTalk: false,
        canConfigure: false,
        canRemove: true,
      });
      expect(card?.config).toBeUndefined();
      expect(text).not.toContain("CANARY");
    }
    // The audit log and the server log say that things were written, never what.
    const audit = JSON.stringify(o.db.select().from(auditLog).all());
    expect(audit).not.toContain("CANARY");
    expect(audit).not.toContain("Journal");
    expect(o.log.text()).not.toContain("CANARY");
    const written = o.audits("office_agent.memory_write").filter((r) => r.targetId === hermes.id);
    expect(written[0]).toMatchObject({
      userId: o.people.mia.id,
      meta: { shared: false, entryId: hermesMemory.id, kind: "memory", chars: MEMORY.length },
    });
  });
});

describe("the soul's history", () => {
  const versions = async () =>
    (
      await json<SoulVersionsResponse>(
        await get(officeAgentMindPaths(hermes.id).soulVersions, o.people.mia.cookie),
      )
    ).versions;

  test("every save is a version with who, when and how much; an unchanged save is none", async () => {
    const p = officeAgentMindPaths(hermes.id);
    const mia = o.people.mia.cookie;
    const second = `${SOUL}\nAlways answer in two sentences.\nNever use emoji.`;
    const saved = await json<OfficeAgentSoul>(
      await o.send(p.soul, "PUT", mia, { content: second, baseVersion: 1 }),
    );
    expect(saved).toMatchObject({ version: 2, content: second });
    expect(
      (await json<OfficeAgentSoul>(await o.send(p.soul, "PUT", mia, { content: second }))).version,
    ).toBe(2);
    // The agent form's field writes the same document.
    const third = second.replace("Never use emoji.", "Use British spelling.");
    const patched = await json<OfficeAgentView>(
      await o.send(`${A}/${hermes.id}`, "PATCH", mia, { instructions: third }),
    );
    expect(patched.config?.instructions).toBe(third);
    expect(await versions()).toMatchObject([
      { version: 3, kind: "edit", by: "Mia", added: 1, removed: 1, chars: third.length },
      { version: 2, kind: "edit", by: "Mia", added: 2, removed: 0 },
      { version: 1, kind: "created", by: "Mia", added: 1, removed: 0, chars: SOUL.length },
    ]);
    const v2 = await json<SoulVersion>(await get(p.soulVersion(2), mia));
    expect(v2.content).toBe(second);
    expect((await get(p.soulVersion(99), mia)).status).toBe(404);
    const audits = o.audits("office_agent.soul_save").filter((r) => r.targetId === hermes.id);
    expect(audits.map((r) => r.meta)).toMatchObject([
      { version: 1, linesAdded: 1, linesRemoved: 0 },
      { version: 2, linesAdded: 2, linesRemoved: 0, chars: second.length },
      { version: 3, linesAdded: 1, linesRemoved: 1 },
    ]);
  });

  test("a save over a newer version is refused; a revert brings old text back as a new version", async () => {
    const p = officeAgentMindPaths(hermes.id);
    const mia = o.people.mia.cookie;
    const stale = await o.send(p.soul, "PUT", mia, {
      content: "from a stale editor",
      baseVersion: 1,
    });
    expect([stale.status, (await json<{ error: string }>(stale)).error]).toEqual([
      409,
      "soul_changed",
    ]);
    const back = await json<OfficeAgentSoul>(
      await o.send(p.soulRevert, "POST", mia, { version: 1 }),
    );
    expect(back).toMatchObject({ version: 4, content: SOUL });
    expect((await versions())[0]).toMatchObject({
      version: 4,
      kind: "revert",
      revertOf: 1,
      removed: 2,
    });
    expect((await o.send(p.soulRevert, "POST", mia, { version: 77 })).status).toBe(404);
    expect(o.audits("office_agent.soul_revert").at(-1)?.meta).toMatchObject({
      version: 4,
      revertOf: 1,
    });
    // The agent's row holds it too, encrypted (#301): the store opens it, the column does not show it.
    expect(o.officeAgents.store.get(hermes.id)?.instructions).toBe(SOUL);
    const stored = o.db.select().from(officeAgents).where(eq(officeAgents.id, hermes.id)).get();
    expect(stored?.instructionsSealed).toBe(true);
    expect(stored?.instructions).not.toContain("SOULCANARY");
  });

  test("a running agent is stopped by a new soul and starts with it at the next message", async () => {
    const mia = o.people.mia.cookie;
    await o.send(`${A}/${hermes.id}/messages`, "POST", mia, { text: "hello" });
    await o.fake.idle();
    expect(o.fake.started.get(hermes.id)?.agent.instructions).toBe(SOUL);
    const next = `${SOUL}\nSign off with "H.".`;
    await o.send(officeAgentMindPaths(hermes.id).soul, "PUT", mia, { content: next });
    expect(o.fake.started.has(hermes.id)).toBe(false);
    await o.send(`${A}/${hermes.id}/messages`, "POST", mia, { text: "hello again" });
    await o.fake.idle();
    const run = o.fake.started.get(hermes.id);
    expect(run?.agent.instructions).toBe(next);
    // The engine's own way to the same mind: this agent's and nobody else's.
    expect(run?.office.mind.soul()).toBe(next);
    expect(
      run?.office.mind
        .entries()
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["memory", "note"]);
    expect(run?.office.mind.digest()).toContain(MEMORY);
  });

  test("only the newest versions are kept", () => {
    const keep = OFFICE_AGENT_MIND_LIMITS.soulVersionsKept;
    for (let i = 0; i < keep + 5; i++) {
      o.officeAgents.mind.saveSoul(pm.id, `PM soul ${i}`, {
        userId: o.people.ada.id,
        kind: "edit",
      });
    }
    const rows = o.officeAgents.mind.versions(pm.id);
    expect(rows).toHaveLength(keep);
    expect(rows[0]?.version).toBe(keep + 6);
    expect(rows.at(-1)?.version).toBe(7);
  });

  test("the migration turns the instructions agents already had into version 1", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0025_office_agent_souls_memories.sql"), "utf8");
    const backfill = sql.split("--> statement-breakpoint").at(-1) ?? "";
    expect(backfill).toContain("INSERT INTO `office_agent_soul_versions`");
    o.db.delete(officeAgentSoulVersions).run();
    // As the row was when 0025 ran: plain text (0028 and its encryption came later).
    const before = o.officeAgents.store.get(hermes.id)?.instructions ?? "";
    o.db
      .update(officeAgents)
      .set({ instructions: before, instructionsSealed: false })
      .where(eq(officeAgents.id, hermes.id))
      .run();
    o.db.$client.run(backfill);
    const imported = o.officeAgents.mind.versions(hermes.id);
    expect(imported).toMatchObject([{ version: 1, kind: "imported", added: 2, removed: 0 }]);
    expect(o.officeAgents.mind.version(hermes.id, 1).content).toContain('Sign off with "H."');
  });
});

describe("what an admin can do with a personal agent without reading it", () => {
  test("stop it and remove it with everything it holds; both are audited", async () => {
    const ada = o.people.ada.cookie;
    expect((await o.send(`${A}/${hermes.id}/stop`, "POST", ada)).status).toBe(200);
    // Sam, another member, can do neither.
    expect((await o.send(`${A}/${hermes.id}`, "DELETE", o.people.sam.cookie)).status).toBe(404);
    const removed = await o.send(`${A}/${hermes.id}`, "DELETE", ada);
    expect(removed.status).toBe(204);
    expect(
      o.db
        .select()
        .from(officeAgentMemories)
        .where(eq(officeAgentMemories.agentId, hermes.id))
        .all(),
    ).toEqual([]);
    expect(
      o.db
        .select()
        .from(officeAgentSoulVersions)
        .where(eq(officeAgentSoulVersions.agentId, hermes.id))
        .all(),
    ).toEqual([]);
    expect(o.audits("office_agent.admin_remove")[0]).toMatchObject({
      userId: o.people.ada.id,
      targetId: hermes.id,
      meta: { name: "Hermes", shared: false, ownerUserId: o.people.mia.id },
    });
    expect(JSON.stringify(o.db.select().from(auditLog).all())).not.toContain("CANARY");
    // A shared agent is still removed by owners and admins only.
    expect((await o.send(`${A}/${pm.id}`, "DELETE", o.people.mia.cookie)).status).toBe(403);
  });
});
