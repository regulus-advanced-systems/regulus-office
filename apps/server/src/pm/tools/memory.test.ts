/**
 * An agent and its own memories and notes through the office tools (#136):
 * the round trip over MCP with the official client, the same over REST,
 * that text which looks like a secret is never stored, the caps, and that a
 * token reaches only its own agent's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type MindEntriesResponse,
  OFFICE_AGENT_MIND_LIMITS,
  OFFICE_AGENTS_API_PATH,
  OFFICE_MCP_PATH,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  officeAgentMindPaths,
} from "@regulus/protocol";
import { auditLog, officeAgentMemories, officeAgents } from "../../db/index.ts";
import { type AgentsOffice, agentsOffice } from "../test-helpers.ts";

let o: AgentsOffice;
let hermes: OfficeAgentView;
let other: OfficeAgentView;
let token: string;
let otherToken: string;
let client: Client;
const A = OFFICE_AGENTS_API_PATH;

async function agentWithToken(cookie: string, name: string, preset = "observer") {
  const agent = (await (
    await o.send(A, "POST", cookie, {
      name,
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      provider: "claude-code",
      model: "sonnet",
      preset,
      instructions: `You are ${name}.`,
    })
  ).json()) as OfficeAgentView;
  const minted = (await (
    await o.send(`${A}/${agent.id}/tokens`, "POST", cookie, { label: "t" })
  ).json()) as OfficeAgentTokenCreated;
  return { agent, token: minted.token };
}

beforeAll(async () => {
  o = await agentsOffice();
  ({ agent: hermes, token } = await agentWithToken(o.people.mia.cookie, "Hermes"));
  ({ agent: other, token: otherToken } = await agentWithToken(o.people.sam.cookie, "Iris"));
  client = new Client({ name: "mind-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(OFFICE_MCP_PATH, o.office.server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
});
afterAll(async () => {
  await client.close().catch(() => {});
  await o.stop();
});

type Structured = Record<string, unknown> & { error?: string; message?: string };
async function mcp(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: res.isError === true, out: res.structuredContent as Structured };
}

describe("memories and notes through MCP", () => {
  test("even an observer has the tools; they take no agent id", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      "soul_read",
      "memory_save",
      "memory_search",
      "memory_list",
      "memory_forget",
      "note_write",
      "note_read",
      "note_list",
      "note_delete",
    ]) {
      expect(names).toContain(name);
    }
    expect((await mcp("soul_read")).out).toEqual({ version: 1, content: "You are Hermes." });
  });

  test("a memory is saved, listed, found, seen by its person in Settings, and forgotten", async () => {
    const saved = await mcp("memory_save", {
      text: "Mia prefers the MCPCANARY standup at 9:30",
      source: "Mia, in chat",
    });
    expect(saved).toMatchObject({ isError: false, out: { saved: true } });
    const id = String(saved.out.id);
    await mcp("memory_save", { text: "The Apollo repo uses trunk as its main branch" });

    const listed = await mcp("memory_list", { limit: 10 });
    expect(listed.out).toMatchObject({ total: 2, max: OFFICE_AGENT_MIND_LIMITS.memoriesMax });
    expect((listed.out.memories as Array<{ text: string }>).map((m) => m.text)).toEqual([
      "The Apollo repo uses trunk as its main branch",
      "Mia prefers the MCPCANARY standup at 9:30",
    ]);
    const found = await mcp("memory_search", { query: "standup MIA" });
    expect(found.out.memories).toMatchObject([{ id, source: "Mia, in chat" }]);
    expect((await mcp("memory_search", { query: "nothing like this" })).out).toEqual({
      memories: [],
      notes: [],
    });

    // The office's copy is what her Settings page shows; another person's agent sees none of it.
    const hers = (await (
      await o.send(
        `${officeAgentMindPaths(hermes.id).entries}?kind=memory`,
        "GET",
        o.people.mia.cookie,
      )
    ).json()) as MindEntriesResponse;
    expect(hers.entries.find((e) => e.id === id)).toMatchObject({
      by: "agent",
      source: "Mia, in chat",
    });
    expect((await o.tool(otherToken, "memory_list")).body).toMatchObject({
      ok: true,
      result: { memories: [], total: 0 },
    });
    expect((await o.tool(otherToken, "memory_search", { query: "standup" })).body).toMatchObject({
      ok: true,
      result: { memories: [] },
    });
    expect((await o.tool(otherToken, "memory_forget", { id })).body).toMatchObject({
      ok: false,
      error: "not_found",
    });

    expect((await mcp("memory_forget", { id })).out).toEqual({ forgotten: true });
    expect((await mcp("memory_forget", { id })).out.error).toBe("not_found");
    expect((await mcp("memory_list")).out.total).toBe(1);
  });

  test("notes are written, added to, read, listed and deleted by title", async () => {
    expect(
      (await mcp("note_write", { title: "Day log seven", text: "Morning: planned the week." })).out,
    ).toMatchObject({
      title: "Day log seven",
      created: true,
    });
    const more = await mcp("note_write", {
      title: "Day log seven",
      text: "Evening: PR 12 merged.",
      append: true,
    });
    expect(more.out).toMatchObject({ created: false });
    expect((await mcp("note_read", { title: " Day log seven " })).out.text).toBe(
      "Morning: planned the week.\nEvening: PR 12 merged.",
    );
    await mcp("note_write", { title: "Brief draft", text: "MCPCANARY draft" });
    expect(
      ((await mcp("note_list")).out.notes as Array<{ title: string }>).map((n) => n.title),
    ).toEqual(["Brief draft", "Day log seven"]);
    expect((await mcp("memory_search", { query: "merged" })).out.notes).toMatchObject([
      { title: "Day log seven", excerpt: "Morning: planned the week.\nEvening: PR 12 merged." },
    ]);
    expect((await o.tool(otherToken, "note_read", { title: "Brief draft" })).status).toBe(404);
    expect((await mcp("note_delete", { title: "brief DRAFT" })).out).toEqual({ deleted: true });
    expect((await mcp("note_read", { title: "Brief draft" })).out.error).toBe("not_found");
  });

  test("every call is audited with the entry and its size, never its text, title or query", () => {
    const rows = o.audits("office_agent.tool_call").filter((r) => r.targetId === hermes.id);
    expect(rows.find((r) => r.meta.tool === "memory_save")?.meta).toMatchObject({
      via: "mcp",
      ok: true,
      shared: false,
      kind: "memory",
      chars: "Mia prefers the MCPCANARY standup at 9:30".length,
    });
    expect(rows.find((r) => r.meta.tool === "note_write")?.meta).toMatchObject({
      kind: "note",
      created: true,
    });
    expect(rows.some((r) => r.meta.tool === "memory_search")).toBe(true);
    const all = JSON.stringify(o.db.select().from(auditLog).all());
    for (const text of ["CANARY", "standup", "Brief draft", "Day log seven", "planned the week"]) {
      expect(all).not.toContain(text);
    }
    expect(o.log.text()).not.toContain("CANARY");
  });
});

describe("secrets are never stored", () => {
  const SECRETS = [
    "the key is sk-ant-api03-FAKEFAKEFAKEFAKE",
    "push with ghp_FAKE1234567890abcd",
    "OPENAI_API_KEY=abc123",
    "export DB_PASSWORD='hunter2'",
    "token roa_FAKEFAKEFAKEFAKE",
    "blob dGhpcyBpcyBub3QgYSByZWFsIGtleSBidXQgbG9va3MgbGlrZSBvbmU9",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
  ];

  test("a memory, a note or a soul that looks like it holds a key is refused on every path", async () => {
    const p = officeAgentMindPaths(hermes.id);
    const mia = o.people.mia.cookie;
    const before = o.db.select().from(officeAgentMemories).all().length;
    for (const secret of SECRETS) {
      const needle = secret.split(" ").at(-1) ?? secret;
      const viaMcp = await mcp("memory_save", { text: `fine line\n${secret}` });
      expect(viaMcp).toMatchObject({ isError: true, out: { error: "secret_rejected" } });
      expect(viaMcp.out.message).toContain("line 2");
      expect(viaMcp.out.message).not.toContain(needle);
      const viaRest = await o.tool(token, "note_write", { title: "Keys", text: secret });
      expect([viaRest.status, viaRest.body]).toMatchObject([
        422,
        { ok: false, error: "secret_rejected" },
      ]);
      for (const res of [
        await o.send(p.entries, "POST", mia, { kind: "memory", text: secret }),
        await o.send(p.entries, "POST", mia, { kind: "note", title: "Keys", text: secret }),
        await o.send(p.soul, "PUT", mia, { content: `You are Hermes.\n${secret}` }),
        await o.send(`${A}/${hermes.id}`, "PATCH", mia, { instructions: secret }),
      ]) {
        const body = await res.text();
        expect([res.status, JSON.parse(body).error]).toEqual([422, "secret_rejected"]);
        expect(body).not.toContain(needle);
      }
    }
    // Also in a title or a source, and when an agent is created.
    expect(
      (await mcp("note_write", { title: "sk-ant-api03-FAKEFAKEFAKE", text: "x" })).out.error,
    ).toBe("secret_rejected");
    expect((await mcp("memory_save", { text: "x", source: "API_TOKEN=abc" })).out.error).toBe(
      "secret_rejected",
    );
    const made = await o.send(A, "POST", mia, {
      name: "Leaky",
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      provider: "claude-code",
      model: "sonnet",
      instructions: SECRETS[0],
    });
    expect(made.status).toBe(422);
    expect(
      o.db
        .select()
        .from(officeAgents)
        .all()
        .map((a) => a.name),
    ).not.toContain("Leaky");
    // Nothing was stored, the soul is as it was, and the refusals are in the audit log without the text.
    expect(o.db.select().from(officeAgentMemories).all()).toHaveLength(before);
    expect((await mcp("soul_read")).out).toEqual({ version: 1, content: "You are Hermes." });
    const denied = o
      .audits("office_agent.tool_denied")
      .filter((r) => r.meta.error === "secret_rejected");
    expect(denied.length).toBe(SECRETS.length * 2 + 2);
    const everything = JSON.stringify(o.db.select().from(auditLog).all()) + o.log.text();
    for (const secret of SECRETS)
      expect(everything).not.toContain(secret.split(" ").at(-1) ?? secret);
  });

  test("ordinary text passes: ids, links, paths, settings that are not secrets, markdown rules", async () => {
    for (const text of [
      "Apollo's operation id is 3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b",
      "See https://github.com/regulus-advanced-systems/regulus-office/pull/284 for the form",
      "The screenshots are in docs/screenshots/136/agent-card-with-memories.png",
      "Run it with PORT=3000 and NODE_ENV=production",
      "Title\n================================================\nBody\n------------------------------------------------",
    ]) {
      expect([text, (await mcp("memory_save", { text })).isError]).toEqual([text, false]);
    }
  });
});

describe("caps", () => {
  test("a full store refuses new entries until some are removed; sizes are capped", async () => {
    const { memoriesMax, memoryTextMax, noteTextMax } = OFFICE_AGENT_MIND_LIMITS;
    const have = o.officeAgents.mind.list(other.id, "memory").total;
    for (let i = have; i < memoriesMax; i++) {
      o.officeAgents.mind.addMemory(other.id, { text: `fact ${i}` }, "agent");
    }
    const full = await o.tool(otherToken, "memory_save", { text: "one too many" });
    expect([full.status, full.body]).toMatchObject([429, { ok: false, error: "cap_reached" }]);
    const first = o.officeAgents.mind.list(other.id, "memory").entries[0];
    await o.tool(otherToken, "memory_forget", { id: first?.id });
    expect((await o.tool(otherToken, "memory_save", { text: "fits again" })).status).toBe(200);
    // Size: the schema refuses an over-long memory; a note cannot grow past its cap by appending.
    const long = await o.tool(otherToken, "memory_save", { text: "x".repeat(memoryTextMax + 1) });
    expect(long.body).toMatchObject({
      ok: false,
      error: "invalid_input",
      message: "invalid input: text",
    });
    await o.tool(otherToken, "note_write", {
      title: "Log",
      text: "a ".repeat(noteTextMax / 2 - 10),
    });
    const grown = await o.tool(otherToken, "note_write", {
      title: "Log",
      text: "b ".repeat(100),
      append: true,
    });
    expect(grown.body).toMatchObject({ ok: false, error: "invalid_input" });
  });
});
