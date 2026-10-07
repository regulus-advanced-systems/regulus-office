/**
 * The `hermes-external` engine against the fake Hermes gateway (#58):
 * connect, send, stream, sessions kept across restarts, reconnect, a wrong
 * token, a gateway that is down, and every way a turn can end badly being
 * told to the person.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Secret } from "@regulus/agent-adapters";
import { captureLogger } from "../../notifications/testing.ts";
import {
  type EngineAgent,
  type EngineEvent,
  type EngineOffice,
  EngineRefusal,
} from "../engines/types.ts";
import { type HermesEngineOptions, HermesExternalEngine } from "./engine.ts";
import { FakeHermesGateway } from "./testing/fake-gateway.ts";

const OFFICE: EngineOffice = {
  mcpUrl: "http://office.test/mcp",
  toolsUrl: "http://office.test/api/agent-tools",
  token: Secret.of("roa_session-token-the-engine-does-not-use"),
};

const agentOf = (state: Record<string, unknown> = {}): EngineAgent => ({
  id: "agent-1",
  name: "Number Two",
  role: "pm",
  preset: "coordinator",
  ownerUserId: "mia",
  ownerName: "Mia",
  provider: "custom",
  model: "hermes",
  effort: null,
  profileId: null,
  instructions: "Keep answers short.",
  state,
});

const message = (text: string, id = "m1") => ({ id, userId: "mia", fromName: "Mia", text });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function setup(
  options: {
    gateway?: FakeHermesGateway;
    token?: string;
    sessionId?: string;
    engine?: Partial<HermesEngineOptions>;
  } = {},
) {
  const gateway = (options.gateway ?? new FakeHermesGateway()).up();
  const log = captureLogger();
  const engine = new HermesExternalEngine({
    connections: {
      resolve: () => ({
        url: gateway.url,
        token: Secret.of(options.token ?? gateway.key),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      }),
    },
    logger: log.logger,
    healthIntervalMs: 20,
    backoffBaseMs: 5,
    backoffMaxMs: 20,
    sendAttempts: 3,
    client: { requestTimeoutMs: 500, streamIdleMs: 150 },
    ...options.engine,
  });
  const events: EngineEvent[] = [];
  engine.onEvent((event) => events.push(event));
  cleanups.push(async () => {
    await engine.stop("agent-1");
    await gateway.down();
  });
  const of = <T extends EngineEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
  return { gateway, engine, events, of, log };
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(5);
  }
}

describe("connecting", () => {
  test("start checks the gateway and reports ready and healthy", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    expect(of("status").at(-1)).toMatchObject({ status: "ready" });
    expect(await engine.health("agent-1")).toEqual({
      ok: true,
      detail: "connected to Hermes 0.21.5",
    });
    // The health check carries no token; everything after it does.
    expect(gateway.requests[0]).toMatchObject({ path: "/health", authorization: null });
    expect(gateway.requests[1]).toMatchObject({
      path: "/v1/capabilities",
      authorization: `Bearer ${gateway.key}`,
    });
  });

  test("a wrong token refuses to start, in plain words", async () => {
    const { engine } = setup({ token: "not-the-key-of-this-gateway" });
    const err = await engine.start(agentOf(), OFFICE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineRefusal);
    expect((err as EngineRefusal).code).toBe("hermes_bad_token");
    expect((err as EngineRefusal).message).toContain("refused the access token");
    expect(await engine.health("agent-1")).toEqual({ ok: false, detail: "not started" });
  });

  test("a gateway that is down refuses to start", async () => {
    const { engine, gateway } = setup();
    await gateway.down();
    const err = await engine.start(agentOf(), OFFICE).catch((e: unknown) => e);
    expect((err as EngineRefusal).code).toBe("hermes_unreachable");
    // The message never names the address.
    expect((err as EngineRefusal).message).not.toContain("127.0.0.1");
  });

  test("something that is not a Hermes, and a Hermes too old, are told apart", async () => {
    const impostor = setup({ gateway: new FakeHermesGateway({ impostor: true }) });
    const a = await impostor.engine.start(agentOf(), OFFICE).catch((e: unknown) => e);
    expect((a as EngineRefusal).code).toBe("hermes_not_hermes");
    const old = setup({ gateway: new FakeHermesGateway({ sessionChat: false }) });
    const b = await old.engine.start(agentOf(), OFFICE).catch((e: unknown) => e);
    expect((b as EngineRefusal).code).toBe("hermes_too_old");
  });

  test("a shared agent is refused: a connection belongs to one person", () => {
    const { engine } = setup();
    expect(() => engine.check({ ...agentOf(), ownerUserId: null })).toThrow(EngineRefusal);
  });
});

describe("a turn", () => {
  test("a message is one turn in the conversation's own session, and the reply comes back", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("What is on the board?"));
    await engine.idle();
    expect(of("message")).toEqual([
      {
        type: "message",
        agentId: "agent-1",
        userId: "mia",
        text: "Hermes heard: What is on the board?",
      },
    ]);
    expect(of("error")).toEqual([]);
    // One session was created for the conversation, titled so its owner finds it in Hermes.
    const [session] = [...gateway.sessions.values()];
    expect(session?.title).toBe("Regulus Office: Number Two");
    expect(session?.source).toBe("api_server");
    // It is kept in the engine state for the next start.
    expect(of("state").at(-1)?.state).toMatchObject({ sessions: { mia: session?.id } });
    // Hermes is told where the message comes from and the owner's instructions, for this turn.
    expect(session?.messages[0]?.system).toContain("Regulus Office");
    expect(session?.messages[0]?.system).toContain("Keep answers short.");
    expect(of("status").map((s) => s.status)).toEqual(["ready", "busy", "ready"]);
  });

  test("the next message continues the same session, also after a restart", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("one"));
    await engine.idle();
    await engine.send("agent-1", message("two", "m2"));
    await engine.idle();
    expect(gateway.sessions.size).toBe(1);
    const state = of("state").at(-1)?.state ?? {};
    await engine.stop("agent-1");
    await engine.start(agentOf(state), OFFICE);
    await engine.send("agent-1", message("three", "m3"));
    await engine.idle();
    expect(gateway.sessions.size).toBe(1);
    expect(gateway.received()).toEqual(["one", "two", "three"]);
  });

  test("turns run one after another, in order", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("first"));
    await engine.send("agent-1", message("second", "m2"));
    await engine.idle();
    expect(gateway.received()).toEqual(["first", "second"]);
    expect(of("message").map((m) => m.text)).toEqual([
      "Hermes heard: first",
      "Hermes heard: second",
    ]);
  });

  test("tool use shows as what the agent is doing", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "reply", text: "Done.", tools: ["mcp_office_read_board"] });
    await engine.send("agent-1", message("look"));
    await engine.idle();
    expect(of("status").some((s) => s.reason === "Using mcp_office_read_board")).toBe(true);
    expect(of("message").at(-1)?.text).toBe("Done.");
  });

  test("when Hermes moves the conversation to a new session, the office follows", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "reply", moveTo: "compressed-2" });
    await engine.send("agent-1", message("long talk"));
    await engine.idle();
    expect(of("state").at(-1)?.state).toMatchObject({ sessions: { mia: "compressed-2" } });
    await engine.send("agent-1", message("more", "m2"));
    await engine.idle();
    expect(gateway.sessions.get("compressed-2")?.messages[0]?.content).toBe("more");
  });

  test("a session the owner named is continued instead of a new one (e.g. the Telegram one)", async () => {
    const gateway = new FakeHermesGateway();
    gateway.seed("20261007_telegram_dm", "telegram");
    const { engine, of } = setup({ gateway, sessionId: "20261007_telegram_dm" });
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("hello from the office"));
    await engine.idle();
    expect(gateway.sessions.size).toBe(1);
    expect(gateway.sessions.get("20261007_telegram_dm")?.messages[0]?.content).toBe(
      "hello from the office",
    );
    expect(of("state").at(-1)?.state).toMatchObject({
      continues: "20261007_telegram_dm",
      sessions: { mia: "20261007_telegram_dm" },
    });
  });

  test("a named session that is gone is said so, and no other session is used", async () => {
    const { engine, gateway, of } = setup({ sessionId: "gone" });
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("hello"));
    await engine.idle();
    expect(of("message")).toEqual([]);
    expect(of("error").at(-1)?.message).toContain("told to continue is not there any more");
    expect(gateway.sessions.size).toBe(0);
  });

  test("a session Hermes lost is replaced, and the person is told", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf({ v: 1, sessions: { mia: "pruned-long-ago" } }), OFFICE);
    await engine.send("agent-1", message("still there?"));
    await engine.idle();
    expect(of("error").map((e) => e.message)).toEqual([
      expect.stringContaining("a new one was started"),
    ]);
    expect(of("message").at(-1)?.text).toBe("Hermes heard: still there?");
    expect(gateway.sessions.size).toBe(1);
  });
});

describe("failing visibly", () => {
  test("a failed turn, an error and an interrupted one each reach the person", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push(
      { kind: "failed", text: "I got as far as", reason: "max_iterations" },
      { kind: "error", message: "provider exploded" },
      { kind: "queued" },
      { kind: "reply", text: "" },
    );
    for (const id of ["a", "b", "c", "d"]) await engine.send("agent-1", message(id, id));
    await engine.idle();
    const errors = of("error").map((e) => e.message);
    expect(errors[0]).toContain("could not finish this turn (max_iterations)");
    expect(of("message").map((m) => m.text)).toEqual(["I got as far as"]);
    expect(errors[1]).toBe("Hermes reported an error: Provider exploded.");
    expect(errors[2]).toContain("open in another Hermes window");
    expect(errors[3]).toBe("Hermes finished the turn without saying anything.");
    expect(errors).toHaveLength(4);
  });

  test("a stream cut in the middle is not sent again; the answer is fetched if the run finished", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "drop", finishes: "The full answer." });
    await engine.send("agent-1", message("important"));
    await engine.idle();
    expect(of("message").map((m) => m.text)).toEqual(["The full answer."]);
    expect(of("error")).toEqual([]);
    // Hermes got the message exactly once.
    expect(gateway.received()).toEqual(["important"]);
  });

  test("a stream cut for good says the answer was lost, and still does not resend", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "drop" });
    await engine.send("agent-1", message("do the thing"));
    await engine.idle();
    expect(of("message")).toEqual([]);
    expect(of("error").at(-1)?.message).toContain("Its answer was lost");
    expect(of("error").at(-1)?.message).toContain("may have acted on it");
    expect(gateway.received()).toEqual(["do the thing"]);
  });

  test("a stream that goes silent is given up on, not waited for forever", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "stall" });
    await engine.send("agent-1", message("hello?"));
    await engine.idle();
    expect(of("error").at(-1)?.message).toContain("went silent");
  });

  test("too many turns on Hermes: the message waits and is offered again", async () => {
    const { engine, gateway, of } = setup({ engine: { backoffBaseMs: 1 } });
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "busy" });
    await engine.send("agent-1", message("when you can"));
    await engine.idle();
    expect(of("message").map((m) => m.text)).toEqual(["Hermes heard: when you can"]);
    expect(gateway.received()).toEqual(["when you can"]);
  }, 10_000);

  test("the gateway down when a message is sent: retried, then said plainly, never dropped", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    await gateway.down();
    await engine.send("agent-1", message("anyone?"));
    await engine.idle();
    expect(of("message")).toEqual([]);
    const error = of("error").at(-1)?.message ?? "";
    expect(error).toContain("cannot be reached (tried 3 times)");
    expect(error).toContain("Your message was not sent");
    expect(of("status").at(-1)).toMatchObject({ status: "error" });
    expect((await engine.health("agent-1")).ok).toBe(false);
  });

  test("the key changed on Hermes while running: said, and shown on the card", async () => {
    const { engine, gateway, of } = setup({ engine: { healthIntervalMs: 60_000 } });
    await engine.start(agentOf(), OFFICE);
    gateway.key = "a-new-key-0123456789abcdef";
    await engine.send("agent-1", message("hi"));
    await engine.idle();
    expect(of("error").at(-1)?.message).toContain("refused the access token");
    expect(of("status").at(-1)).toMatchObject({ status: "error" });
    expect(gateway.received()).toEqual([]);
  });

  test("stopping in the middle of an answer tells the person", async () => {
    const { engine, gateway, of } = setup({ engine: { client: { streamIdleMs: 5000 } } });
    await engine.start(agentOf(), OFFICE);
    gateway.next.push({ kind: "stall" });
    await engine.send("agent-1", message("long one"));
    await until(() => gateway.received().length === 1);
    await engine.stop("agent-1");
    expect(of("error").at(-1)?.message).toContain("was stopped while Hermes was answering");
    await expect(engine.send("agent-1", message("again"))).rejects.toBeInstanceOf(EngineRefusal);
  });
});

describe("reconnecting", () => {
  test("a gateway that goes away shows on the card and comes back by itself", async () => {
    const { engine, gateway, of } = setup();
    await engine.start(agentOf(), OFFICE);
    await gateway.down();
    await until(() => of("status").at(-1)?.status === "error");
    expect(of("status").at(-1)?.reason).toContain("cannot be reached");
    expect(of("status").at(-1)?.reason).toContain("Trying again");
    expect(await engine.health("agent-1")).toMatchObject({ ok: false });
    gateway.up();
    await until(() => of("status").at(-1)?.status === "ready");
    expect((await engine.health("agent-1")).ok).toBe(true);
    await engine.send("agent-1", message("back?"));
    await engine.idle();
    expect(of("message").at(-1)?.text).toBe("Hermes heard: back?");
  });

  test("a message sent while the gateway restarts gets through once it is back", async () => {
    const { engine, gateway, of } = setup({
      engine: { sendAttempts: 6, backoffBaseMs: 20, backoffMaxMs: 40, healthIntervalMs: 60_000 },
    });
    await engine.start(agentOf(), OFFICE);
    await gateway.down();
    await engine.send("agent-1", message("hold on"));
    await Bun.sleep(40);
    gateway.up();
    await engine.idle();
    expect(of("message").map((m) => m.text)).toEqual(["Hermes heard: hold on"]);
    expect(of("error")).toEqual([]);
    expect(gateway.received()).toEqual(["hold on"]);
    expect(of("status").at(-1)).toMatchObject({ status: "ready" });
  });

  test("the pauses between tries grow and stay under the cap", async () => {
    const { engine, gateway, of } = setup({ engine: { backoffBaseMs: 10, backoffMaxMs: 40 } });
    await engine.start(agentOf(), OFFICE);
    await gateway.down();
    const before = gateway.requests.length;
    await until(() => of("status").filter((s) => s.status === "error").length >= 4);
    // Down: nothing reached the gateway, and the engine kept trying on its own.
    expect(gateway.requests.length).toBe(before);
  });
});

test("nothing the engine logs or reports holds the token or the address", async () => {
  const { engine, gateway, events, log } = setup();
  await engine.start(agentOf(), OFFICE);
  gateway.next.push({ kind: "drop" });
  await engine.send("agent-1", message("one"));
  await engine.idle();
  await gateway.down();
  await engine.send("agent-1", message("two", "m2"));
  await engine.idle();
  const everything = `${log.text()}\n${JSON.stringify(events)}`;
  expect(everything).not.toContain(gateway.key);
  expect(everything).not.toContain(gateway.url);
  expect(everything).not.toContain(OFFICE.token.reveal());
});
