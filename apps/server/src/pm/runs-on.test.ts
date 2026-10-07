/**
 * "Runs on", end to end with the fake CLI (#280): what the form may offer,
 * and that an agent created on DeepSeek with a listed model and an appearance
 * really runs its turn with that model and that key. Nothing here reaches a
 * provider: the fake `claude` reports the model it was given, where the key
 * would be sent and a fingerprint of the key, never the key.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  agentModelsFor,
  KEY_PRESETS,
  OFFICE_AGENT_RUNS_ON_API_PATH,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentRunsOnResponse,
  type OfficeAgentsResponse,
  type OfficeAgentView,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { credentialProfileContext } from "../agents/manager/credentials.ts";
import { credentialProfiles, officeAgents, usageSamples } from "../db/schema/index.ts";
import { LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { encryptSecret } from "../secrets/index.ts";
import { type AgentsOffice, agentsOffice, OFFICE_KEY } from "./test-helpers.ts";

const FAKE_CLAUDE = join(import.meta.dir, "engines", "testing", "fake-claude.ts");
const A = OFFICE_AGENTS_API_PATH;
const MIA_DEEPSEEK = "sk-FAKE-mia-deepseek-key-0123456789abcdef";
const SAM_DEEPSEEK = "sk-FAKE-sam-deepseek-key-0123456789abcdef";
const OFFICE_DEEPSEEK = "sk-FAKE-office-deepseek-key-0123456789abcd";
const KEYS = [MIA_DEEPSEEK, SAM_DEEPSEEK, OFFICE_DEEPSEEK, OFFICE_KEY];
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);
const DEEPSEEK = KEY_PRESETS.deepseek;

let o: AgentsOffice;
let runner: LocalTmuxRunner;
let created = 0;
const ids = { mia: "", sam: "", officeAnthropic: "", officeDeepseek: "" };

/** A DeepSeek key profile as "Connect providers" stores one (without calling DeepSeek). */
function addDeepSeek(userId: string | null, label: string, key: string): string {
  const id = crypto.randomUUID();
  created += 1;
  o.db
    .insert(credentialProfiles)
    .values({
      id,
      userId,
      provider: DEEPSEEK.provider,
      label,
      authKind: "base_url_key",
      baseUrl: DEEPSEEK.baseUrl,
      modelOverridesJson: JSON.stringify(DEEPSEEK.modelOverrides),
      encryptedSecret: encryptSecret(
        key,
        credentialProfileContext({ id, userId }),
        o.keyring.keys,
        o.keyring.current,
      ),
      createdAt: new Date(Date.now() + created * 1000),
    })
    .run();
  return id;
}

beforeAll(async () => {
  runner = await LocalTmuxRunner.create();
  o = await agentsOffice({ runner, cliCommand: FAKE_CLAUDE });
  // The office's Anthropic key is the older one, so it is what `office:claude-code` means.
  ids.officeAnthropic = o.addOfficeKey("claude-code", "Office Anthropic");
  ids.mia = addDeepSeek(o.people.mia.id, "Mia DeepSeek", MIA_DEEPSEEK);
  ids.sam = addDeepSeek(o.people.sam.id, "Sam DeepSeek", SAM_DEEPSEEK);
  ids.officeDeepseek = addDeepSeek(null, "Watchdog DeepSeek", OFFICE_DEEPSEEK);
});
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

interface Report {
  model: string;
  baseUrl: string | null;
  keyVar: string | null;
  keyFingerprint: string | null;
  modelAliases: { opus: string | null; haiku: string | null };
  home: string;
}

async function create(cookie: string, body: Record<string, unknown>) {
  const res = await o.send(A, "POST", cookie, {
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
    ...body,
  });
  return { status: res.status, agent: (await res.json()) as OfficeAgentView & { error?: string } };
}

async function talk(cookie: string, agentId: string, text: string): Promise<Report> {
  const sent = await o.send(`${A}/${agentId}/messages`, "POST", cookie, { text });
  expect(sent.status).toBe(202);
  for (let i = 0; i < 400; i++) {
    const convo = (await (
      await o.send(`${A}/${agentId}/conversation`, "GET", cookie)
    ).json()) as OfficeAgentConversation;
    const last = convo.messages.at(-1);
    if (last && last.author !== "person") {
      expect(last.author).toBe("agent");
      return JSON.parse(last.text) as Report;
    }
    await Bun.sleep(25);
  }
  throw new Error("no answer");
}

const runsOn = async (cookie: string) => {
  const res = await o.send(OFFICE_AGENT_RUNS_ON_API_PATH, "GET", cookie);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as OfficeAgentRunsOnResponse };
};
const listed = async (cookie: string, id: string) =>
  ((await (await o.send(A, "GET", cookie)).json()) as OfficeAgentsResponse).agents.find(
    (a) => a.id === id,
  );

describe("what an office agent runs on (#280)", () => {
  test("the form is offered what is really connected: own login and keys, and the office's keys by name for admins", async () => {
    const mia = await runsOn(o.people.mia.cookie);
    expect(mia.status).toBe(200);
    expect(mia.body.personal).toEqual([
      { kind: "login", label: "", owner: "me", provider: "claude-code" },
      {
        profileId: ids.mia,
        kind: "deepseek",
        label: "Mia DeepSeek",
        owner: "me",
        provider: "claude-code",
      },
      // The office key a member may use for henchmen: the oldest one, under its fixed id.
      {
        profileId: "office:claude-code",
        kind: "anthropic",
        label: "Office Anthropic",
        owner: "office",
        provider: "claude-code",
      },
    ]);
    // A member is not told which keys the office has beyond that one, and never anyone else's.
    expect(mia.body.shared).toEqual([]);
    expect(mia.text).not.toContain("Sam DeepSeek");

    const ada = await runsOn(o.people.ada.cookie);
    expect(ada.body.shared).toEqual([
      {
        profileId: ids.officeAnthropic,
        kind: "anthropic",
        label: "Office Anthropic",
        owner: "office",
        provider: "claude-code",
      },
      {
        profileId: ids.officeDeepseek,
        kind: "deepseek",
        label: "Watchdog DeepSeek",
        owner: "office",
        provider: "claude-code",
      },
    ]);
    // Names and kinds only: no key, no envelope, no address.
    for (const answer of [mia.text, ada.text]) {
      for (const key of KEYS) expect(answer).not.toContain(key);
      expect(answer).not.toContain("api.deepseek.com");
      expect(answer).not.toContain("encrypted");
    }
    expect((await o.send(OFFICE_AGENT_RUNS_ON_API_PATH, "GET", "")).status).toBe(401);
  });

  test("a personal agent on DeepSeek with a listed model and an appearance: the turn uses that model and that key", async () => {
    const strong = agentModelsFor("deepseek").find((m) => m.tier === "strong");
    expect(strong?.id).toBe("deepseek-v4-pro");
    const { status, agent } = await create(o.people.mia.cookie, {
      name: "Scout",
      owner: "me",
      profileId: ids.mia,
      model: strong?.id,
      appearance: "lab_coat",
    });
    expect(status).toBe(201);
    expect(agent).toMatchObject({
      model: "deepseek-v4-pro",
      appearance: "lab_coat",
      runsOn: { kind: "deepseek", officeKey: false, label: "Mia DeepSeek" },
    });

    const report = await talk(o.people.mia.cookie, agent.id, "Which model are you?");
    expect(report.model).toBe("deepseek-v4-pro");
    expect(report.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(report.keyVar).toBe("ANTHROPIC_AUTH_TOKEN");
    // Her own DeepSeek key, not Sam's and not the office's.
    expect(report.keyFingerprint).toBe(fingerprint(MIA_DEEPSEEK));
    expect(report.modelAliases).toEqual({ opus: "deepseek-v4-pro", haiku: "deepseek-flash" });
    expect(report.home).toBe((await runner.provision({ userId: o.people.mia.id })).home);
    // Her key, her usage.
    const usage = o.db.select().from(usageSamples).all();
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.userId === o.people.mia.id)).toBe(true);

    // An admin sees what kind of thing it runs on, not the name of her key.
    const forAdmin = await listed(o.people.ada.cookie, agent.id);
    expect(forAdmin?.runsOn).toEqual({ kind: "deepseek", officeKey: false });
    expect(forAdmin?.appearance).toBe("lab_coat");
    expect(forAdmin?.config).toBeUndefined();

    // The appearance changes without touching what the agent is: same id and name, still running.
    const before = o.db.select().from(officeAgents).where(eq(officeAgents.id, agent.id)).get();
    const changed = await o.send(`${A}/${agent.id}`, "PATCH", o.people.mia.cookie, {
      appearance: "chef",
    });
    expect(changed.status).toBe(200);
    const after = o.db.select().from(officeAgents).where(eq(officeAgents.id, agent.id)).get();
    expect(after).toMatchObject({
      appearance: "chef",
      name: "Scout",
      status: before?.status ?? "",
      engineState: before?.engineState ?? "",
      profileId: ids.mia,
    });
    expect(after?.status).not.toBe("stopped");
    const bad = await o.send(`${A}/${agent.id}`, "PATCH", o.people.mia.cookie, {
      appearance: "dragon",
    });
    expect(bad.status).toBe(400);

    // Changing the model is a real change: the next turn runs with the cheap one.
    const patched = await o.send(`${A}/${agent.id}`, "PATCH", o.people.mia.cookie, {
      model: "deepseek-flash",
    });
    expect(patched.status).toBe(200);
    expect((await talk(o.people.mia.cookie, agent.id, "And now?")).model).toBe("deepseek-flash");
  });

  test("nobody runs an agent on someone else's key; a shared agent takes the office key picked by name", async () => {
    const stolen = await create(o.people.mia.cookie, {
      name: "Borrower",
      owner: "me",
      profileId: ids.sam,
    });
    expect(stolen.status).toBe(400);
    expect(stolen.agent.error).toBe("credential");
    // A shared agent never runs on a person's key or login (SPEC §8 rule 3).
    for (const profileId of [ids.mia, undefined]) {
      const refused = await create(o.people.ada.cookie, {
        name: "Leech",
        owner: "office",
        profileId,
      });
      expect(refused.status).toBe(400);
      expect(refused.agent.error).toBe("office_key_required");
    }

    const { status, agent } = await create(o.people.ada.cookie, {
      name: "Watchdog",
      owner: "office",
      role: "watchdog",
      profileId: ids.officeDeepseek,
      model: "deepseek-flash",
      appearance: "black_ops",
    });
    expect(status).toBe(201);
    expect(agent.runsOn).toEqual({ kind: "deepseek", officeKey: true, label: "Watchdog DeepSeek" });
    const report = await talk(o.people.mia.cookie, agent.id, "Anything wrong?");
    expect(report.model).toBe("deepseek-flash");
    expect(report.baseUrl).toBe("https://api.deepseek.com/anthropic");
    // The DeepSeek key that was picked, not the office's older Anthropic key.
    expect(report.keyFingerprint).toBe(fingerprint(OFFICE_DEEPSEEK));
    expect(report.keyFingerprint).not.toBe(fingerprint(OFFICE_KEY));
    // A member sees what it runs on in kind; the key's name is for those who configure it.
    expect((await listed(o.people.mia.cookie, agent.id))?.runsOn).toEqual({
      kind: "deepseek",
      officeKey: true,
    });

    // A key that was removed is said to be gone, not guessed at.
    o.db.delete(credentialProfiles).where(eq(credentialProfiles.id, ids.officeDeepseek)).run();
    expect((await listed(o.people.ada.cookie, agent.id))?.runsOn).toEqual({
      kind: "unknown",
      officeKey: false,
    });
  });

  test("no key reached a log or an audit entry", () => {
    const audit = JSON.stringify(o.audits());
    for (const key of KEYS) {
      expect(o.log.text()).not.toContain(key);
      expect(audit).not.toContain(key);
    }
  });
});
