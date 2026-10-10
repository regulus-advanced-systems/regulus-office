/**
 * Fixture for the tests of #301 (asker-limits.test.ts, memory-scope.test.ts):
 * the office of test-helpers.ts with one shared agent, "Ledger", that was
 * granted both rooms, on the fake engine. The engine answers nothing by
 * itself: a test opens a person's turn (their message, and the token the
 * office mints for that turn, as the CLI session engine asks for one), calls
 * tools with that token as the agent would, and closes the turn with the
 * agent's reply, which revokes the token.
 *
 * People: Olga owns the office and has linked no GitHub account (no room at
 * all); Ada, an admin, administers both repos; Mia may write to Apollo's; Sam
 * administers Borealis's. Only imported by tests.
 */
import { expect } from "bun:test";
import { OFFICE_AGENTS_API_PATH, type OfficeAgentView } from "@regulus/protocol";
import { type AgentsOffice, APOLLO, agentsOffice, BOREALIS } from "./test-helpers.ts";

export const A = OFFICE_AGENTS_API_PATH;
export const CANARY = "APOLLOCANARY launches on Friday";

type Tool = Awaited<ReturnType<AgentsOffice["tool"]>>;
/** A turn in flight: the token its calls are made with, and how it ends. */
export interface OpenTurn {
  token: string;
  call(name: string, input?: unknown): Promise<Tool>;
  /** The turn is over without a reply (it failed, or was stopped): its token is revoked. */
  end(): void;
}
type Person = { id: string; cookie: string };
export const resultOf = <T>(r: Tool) => (r.body as unknown as { result: T }).result;
export const errorOf = (r: Tool) => (r.body as { error?: string }).error;

export async function limitsOffice(agent: { preset?: string } = {}) {
  const o = await agentsOffice({ fake: { reply: () => null } });
  o.addOfficeKey();
  const made = await o.send(A, "POST", o.people.ada.cookie, {
    name: "Ledger",
    owner: "office",
    engine: "cli-session",
    role: "pm",
    provider: "claude-code",
    model: "sonnet",
    profileId: "office:claude-code",
    ...agent,
  });
  if (made.status !== 201) throw new Error(await made.text());
  const pm = (await made.json()) as OfficeAgentView;
  const granted = await o.send(`${A}/${pm.id}/grants`, "PUT", o.people.ada.cookie, {
    grants: [
      { operationId: APOLLO, access: "manage" },
      { operationId: BOREALIS, access: "manage" },
    ],
  });
  expect(granted.status).toBe(200);
  const row = (agentId: string, operationId: string, name: string, ownerName: string) => ({
    agentId,
    operationId,
    name,
    ownerName,
    provider: "claude-code" as const,
    tokens: 9,
  });
  o.leaderboard.push(
    row("h-apollo", APOLLO, "Gasket", "Mia"),
    row("h-borealis", BOREALIS, "Rivet", "Sam"),
  );

  let open: { userId: string; token: string; end(): void } | undefined;
  /** A tool call with the token of the turn that is open. */
  const call = (name: string, input: unknown = {}) => {
    if (!open) throw new Error("no turn is open");
    return o.tool(open.token, name, input);
  };
  /** The rooms `list_operations` hands the agent right now. */
  const rooms = async () =>
    resultOf<{ operations: Array<{ id: string }> }>(await call("list_operations")).operations.map(
      (x) => x.id,
    );
  /** The person's message opens their turn; the office mints the turn's token. */
  const turn = async (person: Person, text = "status?"): Promise<OpenTurn> => {
    const sent = await o.send(`${A}/${pm.id}/messages`, "POST", person.cookie, { text });
    expect(sent.status).toBe(202);
    const office = o.fake.started.get(pm.id)?.office;
    if (!office?.turn) throw new Error("the agent is not started");
    const minted = office.turn(person.id);
    const token = minted.token.reveal();
    open = { userId: person.id, token, end: minted.end };
    return { token, call: (name, input = {}) => o.tool(token, name, input), end: minted.end };
  };
  /** The agent answers: the turn is over and its token is gone. */
  const done = (person: { id: string }) => {
    o.fake.emit({ type: "message", agentId: pm.id, userId: person.id, text: "Done." });
    if (open?.userId === person.id) {
      open.end();
      open = undefined;
    }
  };
  async function during<T>(person: Person, fn: () => Promise<T>): Promise<T> {
    await turn(person);
    try {
      return await fn();
    } finally {
      done(person);
    }
  }
  return { o, pm, call, rooms, turn, done, during };
}

export type LimitsOffice = Awaited<ReturnType<typeof limitsOffice>>;
