/**
 * CLI logins over REST (SPEC §8 rule 1) against stand-ins only: the Codex
 * adapter's fake app-server replaying traces, and a fake `claude` script in
 * a private tmux server (LocalTmuxRunner). No real CLI, no real HOME.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LoginFlowInfo,
  PROVIDER_LOGINS_API_PATH,
  ProviderLoginStatusResponse,
} from "@regulus/protocol";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import {
  type CredentialOffice,
  FAKE_CLAUDE,
  fakeCodex,
  RECORDED_TRACES,
  SLOW_STATUS_CLAUDE,
  startCredentialOffice,
  trace,
} from "./testing/helpers.ts";

const BASE = PROVIDER_LOGINS_API_PATH;

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await Bun.sleep(50);
  }
}

describe.skipIf(!hasTmux())("provider logins", () => {
  let runner: LocalTmuxRunner;
  const offices: CredentialOffice[] = [];

  beforeAll(async () => {
    runner = await LocalTmuxRunner.create();
  });
  afterEach(async () => {
    for (const o of offices.splice(0)) await o.stop();
  });
  afterAll(async () => {
    await runner.dispose();
  });

  function officeWith(
    codexTrace: string,
    statusTrace = join(RECORDED_TRACES, "handshake-logged-out.jsonl"),
  ) {
    const office = startCredentialOffice({
      runner,
      codexCommand: fakeCodex(codexTrace),
      commands: { claude: FAKE_CLAUDE, codex: fakeCodex(statusTrace) },
    });
    offices.push(office);
    return office;
  }

  const flow = async (office: CredentialOffice, loginId: string, cookie: string) => {
    const res = await office.send("GET", `${BASE}/flows/${loginId}`, cookie);
    expect(res.status).toBe(200);
    return LoginFlowInfo.parse(await res.json());
  };

  test("status comes from each CLI's own answer", async () => {
    const out = officeWith("unused", join(RECORDED_TRACES, "handshake-logged-out.jsonl"));
    const u = await out.user("Olga");
    const res = await out.send("GET", BASE, u.cookie);
    const body = ProviderLoginStatusResponse.parse(await res.json());
    expect(body.providers.map((p) => [p.provider, p.connected])).toEqual([
      ["claude-code", false],
      ["codex", false],
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("fake-account-email");

    const signedIn = officeWith("unused", trace("codex-account-logged-in.jsonl"));
    const v = await signedIn.user("Vera");
    const status = ProviderLoginStatusResponse.parse(
      await (await signedIn.send("GET", BASE, v.cookie)).json(),
    );
    expect(status.providers.find((p) => p.provider === "codex")?.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain("fake-account-email");
    expect((await signedIn.send("GET", BASE, "")).status).toBe(401);
  });

  test("Codex device code: URL and code relayed, completion awaited, owner-only", async () => {
    const office = officeWith(trace("codex-device-login-ok.jsonl"));
    const olga = await office.user("Olga");
    const mia = await office.user("Mia");
    const res = await office.send("POST", `${BASE}/codex`, olga.cookie);
    expect(res.status).toBe(201);
    const started = LoginFlowInfo.parse(await res.json());
    expect(started).toMatchObject({
      provider: "codex",
      kind: "device_code",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    });
    const done = await until(
      () => flow(office, started.loginId, olga.cookie),
      (f) => f.state !== "pending",
    );
    expect(done.state).toBe("succeeded");
    expect((await office.send("GET", `${BASE}/flows/${started.loginId}`, mia.cookie)).status).toBe(
      404,
    );
    const actions = office.audit().map((a) => [a.action, JSON.parse(a.metaJson ?? "{}").outcome]);
    expect(actions).toContainEqual(["provider_login.start", undefined]);
    expect(actions).toContainEqual(["provider_login.finish", "succeeded"]);
  });

  test("Codex device code can be cancelled", async () => {
    const office = officeWith(join(RECORDED_TRACES, "device-login-cancel.jsonl"));
    const olga = await office.user("Olga");
    const started = LoginFlowInfo.parse(
      await (await office.send("POST", `${BASE}/codex`, olga.cookie)).json(),
    );
    expect(started.state).toBe("pending");
    const mia = await office.user("Mia");
    const foreign = await office.send(
      "POST",
      `${BASE}/flows/${started.loginId}/cancel`,
      mia.cookie,
    );
    expect(foreign.status).toBe(404);
    const res = await office.send("POST", `${BASE}/flows/${started.loginId}/cancel`, olga.cookie);
    expect(res.status).toBe(204);
    expect((await flow(office, started.loginId, olga.cookie)).state).toBe("cancelled");
  });

  test("Claude: claude auth login in a login session, success from claude auth status", async () => {
    const office = officeWith("unused");
    const olga = await office.user("Olga");
    const res = await office.send("POST", `${BASE}/claude-code`, olga.cookie);
    expect(res.status).toBe(201);
    const started = LoginFlowInfo.parse(await res.json());
    expect(started.kind).toBe("pty_paste_code");
    expect(started.terminalId).toStartWith("login-");
    expect(started.instructions).toContain("claude auth login");
    const terminalId = started.terminalId ?? "";
    expect(office.logins.has(terminalId)).toBe(true);
    const session = { userId: olga.id, name: `agent-${terminalId}` };
    // A credentials file the office must never read or change (#158: the post-login step).
    const home = (await runner.provision({ userId: olga.id })).home;
    await mkdir(join(home, ".claude"), { recursive: true, mode: 0o700 });
    const secret = join(home, ".claude", ".credentials.json");
    await writeFile(secret, '{"claudeAiOauth":"FAKE-NOT-A-TOKEN"}', { mode: 0o600 });
    const secretBefore = await stat(secret);
    await until(
      () => runner.capturePane(session, 50),
      (text) => text.includes("Paste code here"),
    );
    expect((await flow(office, started.loginId, olga.cookie)).state).toBe("pending");

    // What the human types into their own terminal; the office only sees the CLI's status.
    await runner.sendKeys(session, "CODE-OK", { enter: true });
    const done = await until(
      () => flow(office, started.loginId, olga.cookie),
      (f) => f.state !== "pending",
    );
    expect(done.state).toBe("succeeded");
    expect(office.logins.has(terminalId)).toBe(false);
    expect(await runner.sessionExists(session)).toBe(false);
    const status = ProviderLoginStatusResponse.parse(
      await (await office.send("GET", BASE, olga.cookie)).json(),
    );
    expect(status.providers.find((p) => p.provider === "claude-code")?.connected).toBe(true);
    // #158: `auth login` leaves onboarding open; the office marks it complete, nothing else.
    expect(JSON.parse(await readFile(join(home, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
    });
    expect((await stat(secret)).mtimeMs).toBe(secretBefore.mtimeMs);
    expect(await readFile(secret, "utf8")).toBe('{"claudeAiOauth":"FAKE-NOT-A-TOKEN"}');
  });

  test("Claude: cancel kills the login session; a closed session fails the flow", async () => {
    const office = officeWith("unused");
    const olga = await office.user("Olga");
    const a = LoginFlowInfo.parse(
      await (await office.send("POST", `${BASE}/claude-code`, olga.cookie)).json(),
    );
    const session = { userId: olga.id, name: `agent-${a.terminalId}` };
    expect(await runner.sessionExists(session)).toBe(true);
    await office.send("POST", `${BASE}/flows/${a.loginId}/cancel`, olga.cookie);
    expect(await runner.sessionExists(session)).toBe(false);
    expect(office.logins.has(a.terminalId ?? "")).toBe(false);

    const b = LoginFlowInfo.parse(
      await (await office.send("POST", `${BASE}/claude-code`, olga.cookie)).json(),
    );
    await until(
      () => runner.capturePane(session, 50),
      (text) => text.includes("Paste code here"),
    );
    await runner.sendKeys(session, "WRONG", { enter: true });
    const done = await until(
      () => flow(office, b.loginId, olga.cookie),
      (f) => f.state !== "pending",
    );
    expect(done.state).toBe("failed");
  });

  test("Claude: a login that ends while a status check runs succeeds (#199)", async () => {
    // `auth status` reads the login state, then waits for the test; `auth login` exits right
    // after the code, like the real CLI. The check that saw "not logged in" must not fail the
    // flow just because the login session closed while it was running.
    const office = startCredentialOffice({
      runner,
      commands: { claude: SLOW_STATUS_CLAUDE, codex: ["false"] },
    });
    offices.push(office);
    const olga = await office.user("Olga");
    const home = (await runner.provision({ userId: olga.id })).home;
    const started = LoginFlowInfo.parse(
      await (await office.send("POST", `${BASE}/claude-code`, olga.cookie)).json(),
    );
    const session = { userId: olga.id, name: `agent-${started.terminalId}` };
    await until(
      () => runner.capturePane(session, 50),
      (text) => text.includes("Paste code here"),
    );
    const exists = (name: string) =>
      access(join(home, name)).then(
        () => true,
        () => false,
      );

    // A poll starts a check; its `auth status` has read "not logged in" and is still running.
    const racing = flow(office, started.loginId, olga.cookie);
    await until(() => exists(".fake-claude-status-started"), Boolean);
    // Meanwhile the human pastes the code: the CLI stores the login and exits.
    await runner.sendKeys(session, "CODE-OK", { enter: true });
    await until(
      () => runner.sessionExists(session),
      (alive) => !alive,
    );
    await writeFile(join(home, ".fake-claude-status-release"), "");
    expect((await racing).state).toBe("pending");

    // The next check asks the CLI again and sees the login.
    const done = await until(
      () => flow(office, started.loginId, olga.cookie),
      (f) => f.state !== "pending",
    );
    expect(done.state).toBe("succeeded");
  });

  test("viewers cannot start logins; unknown providers are refused", async () => {
    const office = officeWith("unused");
    await office.user("Owner");
    const vic = await office.user("Vic", "viewer");
    expect((await office.send("POST", `${BASE}/codex`, vic.cookie)).status).toBe(403);
    const m = await office.user("Max");
    expect((await office.send("POST", `${BASE}/gemini-cli`, m.cookie)).status).toBe(400);
  });
});
