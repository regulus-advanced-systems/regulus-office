/** Event retention, hashed hook tokens and spawn-time credential resolution. */
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { agentEvents, agents, credentialProfiles, desks } from "../../db/schema/index.ts";
import { encryptSecret } from "../../secrets/index.ts";
import { freshKey } from "../../secrets/test-helpers.ts";
import { HENCHMAN_NAMES } from "../names/names.ts";
import { CredentialResolver, credentialProfileContext } from "./credentials.ts";
import { AgentManagerError } from "./errors.ts";
import { AgentStore } from "./store.ts";
import { officeFixture } from "./test-helpers.ts";
import { DbAgentTokens } from "./tokens.ts";

type Office = Awaited<ReturnType<typeof officeFixture>>;
let office: Office;

afterEach(async () => {
  await rm(office.workdir, { recursive: true, force: true });
});

function insertAgent(o: Office, id: string, userId = o.member.id) {
  o.db
    .insert(agents)
    .values({
      id,
      operationId: o.operationId,
      repoId: o.repoId,
      deskSeatId: "seat-1",
      ownerUserId: userId,
      provider: "custom",
      model: "m",
      profileId: "login:custom",
      workdir: o.workdir,
      taskTitle: "t",
    })
    .run();
}

describe("AgentStore retention", () => {
  test("keeps the newest N events per agent and drops old ones", async () => {
    office = await officeFixture();
    let now = 1_000_000;
    const store = new AgentStore(
      office.db,
      { maxEventsPerAgent: 5, maxAgeMs: 10_000, pruneEvery: 3 },
      () => now,
    );
    insertAgent(office, "a1");
    insertAgent(office, "a2");
    for (let i = 0; i < 12; i++) {
      store.appendEvent("a1", { kind: "status", ts: now - 100 + i, status: "working" });
    }
    store.appendEvent("a2", { kind: "status", ts: now - 50_000, status: "idle" });
    const count = (id: string) =>
      office.db.select().from(agentEvents).where(eq(agentEvents.agentId, id)).all().length;
    expect(count("a1")).toBeLessThanOrEqual(5 + 2);
    store.prune("a1");
    expect(count("a1")).toBe(5);
    expect(store.events("a1").map((e) => e.ts)).toEqual([
      now - 93,
      now - 92,
      now - 91,
      now - 90,
      now - 89,
    ]);
    expect(count("a2")).toBe(1);
    store.sweep();
    expect(count("a2")).toBe(0);
    now += 20_000;
    store.sweep();
    expect(count("a1")).toBe(0);
  });
});

describe("henchman names (#256)", () => {
  const row = (o: Office, id: string) => ({
    id,
    operationId: o.operationId,
    repoId: o.repoId,
    deskSeatId: "",
    ownerUserId: o.member.id,
    provider: "custom" as const,
    model: "m",
    profileId: "login:custom",
    workdir: o.workdir,
    taskTitle: "t",
  });
  const nameOf = (o: Office, id: string) =>
    o.db.select({ name: agents.name }).from(agents).where(eq(agents.id, id)).get()?.name;

  test("each henchman is named with its desk, uniquely among those at a desk, and keeps it", async () => {
    office = await officeFixture();
    // A random source that always points at the first free name.
    const store = new AgentStore(office.db, undefined, undefined, () => 0);
    const first = store.insertWithDesk(row(office, "a1"), undefined);
    const second = store.insertWithDesk(row(office, "a2"), undefined);
    const third = store.insertWithDesk(row(office, "a3"), undefined);
    expect(first.name).toBe(HENCHMAN_NAMES[0] as string);
    expect(new Set([first.name, second.name, third.name]).size).toBe(3);
    expect(nameOf(office, "a1")).toBe(first.name);

    // Status changes, a resume and a restart (a new store on the same database) keep the name.
    store.setStatus("a1", "exited", 10);
    store.setStatus("a1", "starting", 20);
    const restarted = new AgentStore(office.db, undefined, undefined, () => 0);
    expect(restarted.get("a1")?.name).toBe(first.name);
    expect(restarted.ensureName("a1")).toBe(first.name);

    // Sent home: the desk and the name are free again, the row keeps its name as history.
    restarted.freeDesk("a1");
    const next = restarted.insertWithDesk(row(office, "a4"), undefined);
    expect(next.name).toBe(first.name);
    expect(nameOf(office, "a1")).toBe(first.name);
  });

  test("a henchman from before names existed is named once, on first sight", async () => {
    office = await officeFixture();
    const store = new AgentStore(office.db, undefined, undefined, () => 0);
    const named = store.insertWithDesk(row(office, "a1"), undefined);
    insertAgent(office, "old");
    office.db.update(desks).set({ agentId: "old" }).where(eq(desks.seatId, "seat-2")).run();
    expect(nameOf(office, "old")).toBe("");
    const given = store.ensureName("old");
    expect(given).not.toBe("");
    expect(given).not.toBe(named.name);
    expect(store.ensureName("old")).toBe(given);
    expect(nameOf(office, "old")).toBe(given);
    expect(store.ensureName("nobody")).toBe("");
  });
});

describe("DbAgentTokens", () => {
  test("stores only a digest, verifies, rotates and revokes", async () => {
    office = await officeFixture();
    insertAgent(office, "a1");
    const tokens = new DbAgentTokens(office.db);
    const token = tokens.issue("a1");
    const row = office.db.select().from(agents).where(eq(agents.id, "a1")).get();
    expect(row?.hookTokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(tokens.verify("a1", token)).toBe(true);
    expect(tokens.verify("a1", `${token}x`)).toBe(false);
    expect(tokens.verify("nope", token)).toBe(false);
    const rotated = tokens.issue("a1");
    expect(tokens.verify("a1", token)).toBe(false);
    expect(tokens.verify("a1", rotated)).toBe(true);
    tokens.revoke("a1");
    expect(tokens.verify("a1", rotated)).toBe(false);
  });
});

describe("CredentialResolver", () => {
  test("own profiles and office keys decrypt at resolve time; others are refused", async () => {
    office = await officeFixture();
    const key = freshKey();
    const keyring = { keys: { 1: key }, current: 1 };
    const add = (id: string, userId: string | null, secret: string) => {
      const envelope = encryptSecret(
        secret,
        credentialProfileContext({ id, userId }),
        keyring.keys,
        1,
      );
      office.db
        .insert(credentialProfiles)
        .values({
          id,
          userId,
          provider: "custom",
          label: id,
          authKind: "api_key",
          encryptedSecret: envelope,
        })
        .run();
    };
    add("mine", office.member.id, "sk-mine-FAKE");
    add("theirs", office.owner.id, "sk-theirs-FAKE");
    add("office-key", null, "sk-office-FAKE");
    const resolver = new CredentialResolver(office.db, keyring as never);

    const mine = resolver.resolve(office.member.id, "custom", "mine");
    expect(mine.credential.kind === "api_key" && mine.credential.apiKey.reveal()).toBe(
      "sk-mine-FAKE",
    );
    expect(JSON.stringify(mine)).not.toContain("sk-mine-FAKE");
    const shared = resolver.resolve(office.member.id, "custom", "office:custom");
    expect(shared.credential).toMatchObject({ kind: "api_key", attributedTo: "office" });
    expect(resolver.resolve(office.member.id, "custom", undefined)).toEqual({
      profileId: "login:custom",
      credential: { kind: "cli_login" },
    });
    expect(() => resolver.check(office.member.id, "custom", "theirs")).toThrow(AgentManagerError);
    expect(() => resolver.check(office.member.id, "codex", "mine")).toThrow(/another provider/);
    expect(() =>
      new CredentialResolver(office.db, undefined).resolve(office.member.id, "custom", "mine"),
    ).toThrow(/OFFICE_MASTER_KEY/);
  });
});
