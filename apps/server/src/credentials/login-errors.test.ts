/**
 * #151: a sign-in that cannot start says why. Over REST, against a docker
 * runner on the fake Engine API: a broken runner container is replaced and
 * the sign-in starts; what cannot be healed comes back as the classified
 * cause (`runner_api` with Docker's redacted message, `runner_image_missing`,
 * `runner_busy`), and `cli_missing` only when `command -v` finds no CLI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PROVIDER_LOGINS_API_PATH } from "@regulus/protocol";
import { DockerRunner, RunnerBusyError } from "../runners/docker/docker-runner.ts";
import { EngineClient } from "../runners/docker/engine.ts";
import { type ExecHandler, FakeEngine } from "../runners/docker/testing/fake-engine.ts";
import type { Runner } from "../runners/types.ts";
import { type CredentialOffice, startCredentialOffice } from "./testing/helpers.ts";

const BASE = PROVIDER_LOGINS_API_PATH;
const IMAGE = "runner:test";
const LONG_ID = "9b7e".repeat(16);
const RWLAYER = `RWLayer of container ${LONG_ID} is unexpectedly nil`;
const PROBE = 'command -v "$1" >/dev/null 2>&1';

let fake: FakeEngine;
let office: CredentialOffice | null;
/** Exit code of `command -v <cli>` per CLI basename (default: found). */
let installed: Record<string, number>;

/** Piped execs report their pid first (interactive.ts); the probe answers from `installed`. */
const execs: ExecHandler = (exec, io) => {
  if (exec.cmd.includes(PROBE)) {
    io.stderr("office-pid:7\n");
    const bin = exec.cmd.at(-1) ?? "";
    return installed[bin] ?? 0;
  }
  if ((exec.cmd[2] ?? "").includes("office-pid:")) {
    // Any other piped process (codex app-server here) exits at once: the CLI does not answer.
    io.stderr("office-pid:8\n");
    return 1;
  }
  return 0;
};

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  fake.onExec = execs;
  installed = {};
  office = null;
});

afterEach(async () => {
  await office?.stop();
  await fake.stop();
});

function dockerRunner(opts: { pull?: boolean } = {}): DockerRunner {
  return new DockerRunner({
    engine: new EngineClient(fake.dockerHost),
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: "/home/runner",
    ...opts,
  });
}

function officeOn(runner: Runner) {
  office = startCredentialOffice({
    runner,
    commands: { claude: "claude", codex: ["codex"] },
    codexCommand: ["codex"],
  });
  return office;
}

async function start(o: CredentialOffice, provider: string) {
  const u = await o.user("Olga");
  const res = await o.send("POST", `${BASE}/${provider}`, u.cookie);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, user: u };
}

/** A stopped runner whose start answers the RWLayer 500 (host storage corruption). */
async function brokenRunner(runner: DockerRunner, userId: string, always = false) {
  const c = await runner.containers.ensure(userId);
  (fake.containers.get(c.id) as { running: boolean }).running = false;
  fake.onStart = (x) => (always || x.id === c.id ? { status: 500, message: RWLAYER } : undefined);
  return c.id;
}

describe("a sign-in that cannot start (#151)", () => {
  test("a broken runner container is replaced and the Claude sign-in starts", async () => {
    const runner = dockerRunner();
    const o = officeOn(runner);
    const u = await o.user("Olga");
    const broken = await brokenRunner(runner, u.id);
    const res = await o.send("POST", `${BASE}/claude-code`, u.cookie);
    expect(res.status).toBe(201);
    expect(fake.containers.has(broken)).toBe(false);
    expect(fake.volumes.has(`office-home-${u.id}`)).toBe(true);
  });

  test("runner_api: Docker's own message, redacted, when the runner cannot be healed", async () => {
    const runner = dockerRunner();
    const o = officeOn(runner);
    const u = await o.user("Olga");
    await brokenRunner(runner, u.id, true);
    const res = await o.send("POST", `${BASE}/claude-code`, u.cookie);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({
      error: "login_unavailable",
      cause: "runner_api",
      reason: "Docker Engine: POST <path>: 500 RWLayer of container [redacted] is unexpectedly nil",
    });
  });

  test("runner_image_missing when the image is gone and cannot be pulled", async () => {
    fake.images.clear();
    const o = officeOn(dockerRunner({ pull: false }));
    const { status, body } = await start(o, "codex");
    expect(status).toBe(502);
    expect(body).toMatchObject({ error: "login_unavailable", cause: "runner_image_missing" });
    expect(body.reason).toContain("runner image runner:test is not on the Docker host");
  });

  test("runner_busy names what is busy, without ids or paths", async () => {
    const runner = dockerRunner();
    const busy = Object.create(runner) as DockerRunner;
    busy.provision = async (user) => {
      throw new RunnerBusyError(user.userId, ["agent-a1"], ["/srv/x"], []);
    };
    const { status, body } = await start(officeOn(busy), "claude-code");
    expect(status).toBe(502);
    expect(body).toEqual({
      error: "login_unavailable",
      cause: "runner_busy",
      reason: "the runner needs a new mount but still runs 1 tmux session",
    });
  });

  test("cli_missing only when command -v cannot find the CLI", async () => {
    installed = { claude: 127, codex: 1 };
    const o = officeOn(dockerRunner());
    const claude = await start(o, "claude-code");
    expect(claude.status).toBe(502);
    expect(claude.body).toEqual({
      error: "login_unavailable",
      cause: "cli_missing",
      reason: "claude is not installed in the runner",
    });
    // No login session was started for a CLI that is not there.
    expect(fake.calls("POST", /\/exec$/).some((r) => r.body.includes("new-session"))).toBe(false);

    const u = await o.user("Mia");
    const codex = await o.send("POST", `${BASE}/codex`, u.cookie);
    expect(await codex.json()).toEqual({
      error: "login_unavailable",
      cause: "cli_missing",
      reason: "codex is not installed in the runner",
    });
  });

  test("an installed CLI that fails is not called missing, and its output is not forwarded", async () => {
    const o = officeOn(dockerRunner());
    const { status, body } = await start(o, "codex");
    expect(status).toBe(502);
    expect(body).toEqual({
      error: "login_unavailable",
      cause: "start_failed",
      reason: "the CLI stopped before the sign-in began",
    });
  });
});
