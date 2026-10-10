/**
 * Fixture for the office agent tests (#271): a real office server with
 * sessions, four people, two operations, office agents on the fake engine,
 * and the tools bound to the real task queue and credential rules (a fake
 * spawner stands in for the AgentManager, enforcing its ownership rule).
 *
 * Rooms open with each person's own GitHub permission on the room's repo
 * (#270), written straight into the access snapshot: Ada (admin) administers
 * both repos, Mia may write to Apollo's, Sam administers Borealis's, and Olga
 * (the office owner) has linked no GitHub account, so she sees no room.
 */
import type {
  OfficeToolResult,
  OperationAccess,
  QueueSettings,
  QueueTask,
  TopHenchmanUsage,
  UsageSummary,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { CredentialResolver, credentialProfileContext } from "../agents/manager/credentials.ts";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { SpawnInput } from "../agents/manager/spawn.ts";
import { AgentStore } from "../agents/manager/store.ts";
import { startOffice } from "../auth/test-helpers.ts";
import {
  agents,
  auditLog,
  credentialProfiles,
  desks,
  operationRepos,
  operations,
} from "../db/schema/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { captureLogger, testKeyring } from "../notifications/testing.ts";
import type { OperationActor } from "../operations/access.ts";
import { TaskQueue } from "../queue/index.ts";
import type { Runner } from "../runners/types.ts";
import { encryptSecret } from "../secrets/index.ts";
import { UsageTracker } from "../usage/index.ts";
import { FakeEngine, type FakeEngineOptions } from "./engines/fake.ts";
import { createOfficeAgents, type OfficeAgentsOptions } from "./setup.ts";
import { statusOfToolResult } from "./tool-routes.ts";

export const OFFICE_KEY = "sk-ant-api03-FAKE-office-agent-key-0123456789";
export const APOLLO = "op-apollo";
export const BOREALIS = "op-borealis";
export const APOLLO_REPO = "repo-apollo";
export const BOREALIS_REPO = "repo-borealis";

export interface AgentsOfficeOptions {
  fake?: FakeEngineOptions;
  /** With a runner the real CLI session engine is registered instead of the fake one. */
  runner?: Pick<Runner, "provision" | "spawnPiped" | "backend">;
  cliCommand?: string;
  /** Timings of the Hermes engine (#58). */
  hermes?: OfficeAgentsOptions["hermes"];
  managedHermes?: OfficeAgentsOptions["managedHermes"];
}

export async function agentsOffice(options: AgentsOfficeOptions = {}) {
  const office = startOffice();
  const { db } = office;
  const log = captureLogger();
  const keyring = testKeyring();
  const fake = new FakeEngine(options.fake);

  // People: Olga owns the office, Ada is an admin, Mia and Sam are members.
  const olga = await office.signUp("Olga", "10.0.0.1");
  const ada = await office.signUp("Ada", "10.0.0.2");
  const mia = await office.signUp("Mia", "10.0.0.3");
  const sam = await office.signUp("Sam", "10.0.0.4");
  db.$client.run(`update user_profiles set role = 'admin' where user_id = '${ada.id}'`);

  // Apollo: Mia may spawn. Borealis: Sam manages; Mia has nothing there. Ada manages both.
  for (const [id, name] of [
    [APOLLO, "Apollo"],
    [BOREALIS, "Borealis"],
  ] as const) {
    db.insert(operations)
      .values({ id, name, slug: id, index: 1, paletteId: "oak-sky", layoutTemplateId: "t" })
      .run();
    for (let i = 1; i <= 4; i++)
      db.insert(desks)
        .values({ operationId: id, seatId: `s${i}` })
        .run();
  }
  for (const [id, operationId, name] of [
    [APOLLO_REPO, APOLLO, "hello"],
    [BOREALIS_REPO, BOREALIS, "other"],
  ] as const) {
    db.insert(operationRepos)
      .values({
        id,
        operationId,
        owner: "octo",
        name,
        url: "file:///dev/null",
        defaultBranch: "trunk",
        workdir: "/tmp/none",
        isPrimary: true,
        cloneStatus: "ready",
      })
      .run();
  }
  /** The person's GitHub permission on one room's repo changes; `null` takes the room away. */
  const setRoomAccess = (operationId: string, userId: string, access: OperationAccess | null) =>
    void seedRoomMember(db, userId, operationId, access);
  /** The person has `access` to this room and to no other. */
  const setAccess = (operationId: string, userId: string, access: OperationAccess) => {
    for (const id of [APOLLO, BOREALIS]) setRoomAccess(id, userId, null);
    setRoomAccess(operationId, userId, access);
  };
  setRoomAccess(APOLLO, mia.id, "spawn");
  setRoomAccess(BOREALIS, sam.id, "manage");
  setRoomAccess(APOLLO, ada.id, "manage");
  setRoomAccess(BOREALIS, ada.id, "manage");

  /** The office usage port's answer: totals, and a leaderboard tests fill in (room per henchman). */
  const leaderboard: Array<TopHenchmanUsage & { operationId: string }> = [];
  const officeUsage = (): UsageSummary & { henchmanRooms: Record<string, string> } => ({
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCacheTokens: 0,
    todayCostUsdEstimate: 0,
    officeKeysCostUsdEstimate: 0,
    activeHumans: 0,
    topHenchmen: leaderboard.map(({ operationId: _room, ...row }) => row),
    henchmanRooms: Object.fromEntries(leaderboard.map((row) => [row.agentId, row.operationId])),
    dayStart: 0,
    observedAt: 0,
  });

  /** An office-wide API key for the provider (SPEC §8 rule 3); returns the profile id. */
  const addOfficeKey = (
    provider: "claude-code" | "codex" = "claude-code",
    label = "Office key",
  ) => {
    const id = crypto.randomUUID();
    db.insert(credentialProfiles)
      .values({
        id,
        userId: null,
        provider,
        label,
        authKind: "api_key",
        encryptedSecret: encryptSecret(
          OFFICE_KEY,
          credentialProfileContext({ id, userId: null }),
          keyring.keys,
          keyring.current,
        ),
      })
      .run();
    return id;
  };

  // The AgentManager's stand-in: the real credential rule, a henchman row, owner-only stop.
  const resolver = new CredentialResolver(db, keyring);
  const spawned: Array<{ actor: OperationActor; input: SpawnInput; agentId: string }> = [];
  let n = 0;
  const spawn = async (actor: OperationActor, input: SpawnInput) => {
    resolver.check(actor.id, input.provider, input.profileId);
    n += 1;
    const agentId = `henchman-${n}`;
    new AgentStore(db).insertWithDesk(
      {
        id: agentId,
        operationId: input.operationId,
        repoId: input.repoId,
        deskSeatId: "",
        ownerUserId: actor.id,
        provider: input.provider,
        model: input.model,
        profileId: input.profileId ?? `login:${input.provider}`,
        status: "working",
        tmuxSession: `agent-${agentId}`,
        workdir: "/tmp/none",
        taskTitle: input.taskTitle ?? input.prompt.slice(0, 40),
      },
      undefined,
    );
    spawned.push({ actor, input, agentId });
    return { agentId };
  };
  const stopped: string[] = [];
  const stop = async (actor: OperationActor, henchmanId: string) => {
    const row = db.select().from(agents).where(eq(agents.id, henchmanId)).get();
    if (!row) throw new AgentManagerError("not_found", "no such agent");
    if (row.ownerUserId !== actor.id) {
      throw new AgentManagerError("forbidden", "only the henchman's owner may control it");
    }
    db.update(agents).set({ exitedAt: new Date() }).where(eq(agents.id, henchmanId)).run();
    stopped.push(henchmanId);
  };
  const published = new Map<string, { tasks: readonly QueueTask[]; settings: QueueSettings }>();
  const queue = new TaskQueue({
    db,
    logger: log.logger,
    publisher: {
      publishQueue: (id, tasks, settings) => void published.set(id, { tasks, settings }),
    },
    spawner: {
      check: (owner, input) => void resolver.check(owner.id, input.provider, input.profileId),
      spawn: (owner, input, hooks) =>
        spawn(owner, input).then((r) => {
          hooks.onAdmitted(r.agentId);
          return r;
        }),
    },
  });

  const chat: Array<{ userId: string; displayName: string; operationId: string; text: string }> =
    [];
  const comments: Array<{ repo: string; number: number; body: string; token: string }> = [];
  const officeAgents = createOfficeAgents({
    db,
    logger: log.logger,
    keyring,
    officeUrl: office.origin,
    version: "test",
    engines: options.runner ? [] : [fake],
    runner: options.runner,
    cliCommand: options.cliCommand,
    hermes: options.hermes,
    managedHermes: options.managedHermes,
    usage: new UsageTracker(db),
  });
  officeAgents.bind({
    queue: (operationId) => queue.snapshot(operationId),
    enqueue: (actor, input) => queue.enqueueTask(actor, input),
    myUsage: (userId) => ({ owner: userId }) as never,
    officeUsage,
    postChat: (line) => void chat.push(line),
    spawn,
    stop,
    officeToken: async () => "ghs_FAKE_office_installation_token",
    github: {
      comment: async (token, repo, number, body) => {
        comments.push({ repo: `${repo.owner}/${repo.name}`, number, body, token });
        return {
          id: comments.length,
          author: "office[bot]",
          bodyMd: body,
          createdAt: 1,
          url: `https://github.test/${repo.owner}/${repo.name}/issues/${number}#c${comments.length}`,
        };
      },
    },
  });
  officeAgents.mount(office.server.router, office.auth);
  officeAgents.boot();

  const send = (path: string, method: string, cookie: string, body?: unknown, origin?: string) =>
    office.request(path, {
      method,
      cookie,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: origin ? { origin } : undefined,
    });
  /** Call an office tool over REST with an agent token. */
  const tool = async (token: string, name: string, input: unknown = {}) => {
    const res = await fetch(new URL(`/api/agent-tools/${name}`, office.server.url), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return { status: res.status, body: (await res.json()) as OfficeToolResult };
  };
  /**
   * A turn of this person's conversation with the agent (#301): their message,
   * and the token the office mints for that turn, with which `fn` calls tools
   * as the agent would. The token is gone when `fn` returns.
   */
  const inTurn = async <T>(
    agentId: string,
    person: { id: string; cookie: string },
    fn: (call: (name: string, input?: unknown) => ReturnType<typeof tool>) => Promise<T>,
  ): Promise<T> => {
    const sent = await send(`/api/office-agents/${agentId}/messages`, "POST", person.cookie, {
      text: "status?",
    });
    if (sent.status !== 202) throw new Error(`message not taken: ${sent.status}`);
    const minted =
      officeAgents.runtime.engine("cli-session") === fake
        ? fake.started.get(agentId)?.office.turn?.(person.id)
        : undefined;
    if (!minted) throw new Error("the agent is not on the fake engine");
    try {
      return await fn((name, input = {}) => tool(minted.token.reveal(), name, input));
    } finally {
      minted.end();
    }
  };
  /**
   * Call an office tool with no credential of a turn or a person, as an engine
   * run would outside any turn. A shared agent is refused everything that way (#301).
   */
  const engineTool = async (agentId: string, name: string, input: unknown = {}) => {
    const agent = officeAgents.store.get(agentId);
    if (!agent) throw new Error("no such agent");
    const body = await officeAgents.tools.call(agent, name, input, "rest");
    return { status: statusOfToolResult(body), body };
  };
  const audits = (action?: string) =>
    db
      .select()
      .from(auditLog)
      .all()
      .filter((r) => r.targetKind === "office_agent" && (!action || r.action === action))
      .map((r) => ({ ...r, meta: JSON.parse(r.metaJson) as Record<string, unknown> }));

  return {
    office,
    db,
    log,
    fake,
    keyring,
    officeAgents,
    queue,
    people: { olga, ada, mia, sam },
    setAccess,
    setRoomAccess,
    leaderboard,
    addOfficeKey,
    spawned,
    stopped,
    chat,
    comments,
    send,
    tool,
    inTurn,
    engineTool,
    audits,
    async stop() {
      await queue.close();
      await officeAgents.close();
      await office.stop();
    },
  };
}

export type AgentsOffice = Awaited<ReturnType<typeof agentsOffice>>;
