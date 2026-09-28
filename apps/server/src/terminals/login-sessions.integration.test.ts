/**
 * Login sessions on the terminal bridge (`/ws/term/login-<id>`, #32): only
 * the human logging in may open theirs (watch or control); office owners,
 * admins and other members get 404 as if it did not exist; nothing is
 * snapshotted to disk. Real auth cookies, a fake `claude` in a private tmux
 * server (LocalTmuxRunner) and one Bun PTY attach per viewer.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AdapterRegistry, ClaudeCodeAdapter, CodexAdapter } from "@regulus/agent-adapters";
import { TERMINAL_CLOSE_CODES } from "@regulus/protocol";
import { LoginFlows } from "../credentials/login-flows.ts";
import { FAKE_CLAUDE } from "../credentials/testing/helpers.ts";
import { createLogger } from "../logging.ts";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { LoginSessionTargets } from "./login-sessions.ts";
import { hasBunPty } from "./pipe.ts";
import type { ScrollbackRecorder } from "./scrollback.ts";
import { startTerminalOffice, type TerminalOffice } from "./test-helpers.ts";

type User = { id: string; cookie: string };

describe.skipIf(!hasTmux() || !hasBunPty())("login terminals", () => {
  let runner: LocalTmuxRunner;
  let office: TerminalOffice;
  let flows: LoginFlows;
  const logins = new LoginSessionTargets();
  let tracked = 0;
  let owner: User;
  let admin: User;
  let olga: User;
  let mia: User;

  beforeAll(async () => {
    runner = await LocalTmuxRunner.create();
    const scrollback = {
      track: () => {
        tracked += 1;
        return () => {};
      },
    } as unknown as ScrollbackRecorder;
    office = await startTerminalOffice({ runner, bridge: { logins, scrollback } });
    flows = new LoginFlows({
      db: office.db,
      runner,
      adapters: new AdapterRegistry([
        new ClaudeCodeAdapter({ command: FAKE_CLAUDE }),
        new CodexAdapter({ command: ["false"] }),
      ]),
      logins,
      officeUrl: "http://127.0.0.1",
      logger: createLogger({ level: "silent" }),
      commands: { claude: FAKE_CLAUDE, codex: ["false"] },
      checkIntervalMs: 0,
    });
    owner = await office.signUp("Owner", "owner");
    admin = await office.signUp("Ada", "admin");
    olga = await office.signUp("Olga", "member");
    mia = await office.signUp("Mia", "member");
  });

  afterAll(async () => {
    await flows.shutdown();
    await office.stop();
    await runner.dispose();
  });

  test("only the human logging in can open the login terminal", async () => {
    const started = await flows.start({ id: olga.id, role: "member" }, "claude-code");
    const terminalId = started.terminalId ?? "";
    expect(terminalId).toStartWith("login-");

    for (const other of [owner, admin, mia]) {
      for (const mode of ["watch", "control"]) {
        const res = await office.probe(terminalId, mode, { cookie: other.cookie });
        expect(res.status).toBe(404);
      }
    }
    expect((await office.probe(terminalId, "control")).status).toBe(401);
    expect((await office.probe("login-nobody", "control", { cookie: olga.cookie })).status).toBe(
      404,
    );

    const watcher = await office.connect(terminalId, "watch", olga.cookie);
    const driver = await office.connect(terminalId, "control", olga.cookie);
    await driver.waitFor((c) => c.output.includes("Paste code here"), "login prompt");
    expect(driver.hello?.mode).toBe("control");
    expect(tracked).toBe(0);

    driver.type("CODE-OK\r");
    await driver.waitFor((c) => c.output.includes("Login successful"), "login success");
    let state = started.state;
    const deadline = Date.now() + 8000;
    while (state === "pending" && Date.now() < deadline) {
      state = (await flows.get({ id: olga.id, role: "member" }, started.loginId)).state;
      await Bun.sleep(50);
    }
    expect(state).toBe("succeeded");
    // Success ends the login session: both sockets see "session ended".
    expect(await driver.closed).toBe(TERMINAL_CLOSE_CODES.sessionEnded);
    expect(await watcher.closed).toBe(TERMINAL_CLOSE_CODES.sessionEnded);
    expect(logins.has(terminalId)).toBe(false);
    expect((await office.probe(terminalId, "control", { cookie: olga.cookie })).status).toBe(404);
  });

  test("another human's login flow is invisible", async () => {
    const started = await flows.start({ id: mia.id, role: "member" }, "claude-code");
    await expect(flows.get({ id: admin.id, role: "admin" }, started.loginId)).rejects.toThrow();
    await expect(flows.cancel({ id: owner.id, role: "owner" }, started.loginId)).rejects.toThrow();
    await flows.cancel({ id: mia.id, role: "member" }, started.loginId);
    expect(logins.has(started.terminalId ?? "")).toBe(false);
  });
});
