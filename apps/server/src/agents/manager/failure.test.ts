/**
 * Start failure reasons (#130): classification, redaction, and the manager
 * logging the cause and publishing a safe `statusReason` when a start fails.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import { HenchmanState } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { CliMissingError } from "../../credentials/cli-probe.ts";
import { agentEvents } from "../../db/schema/index.ts";
import { createLogger } from "../../logging.ts";
import { DockerApiError } from "../../runners/docker/engine.ts";
import { RunnerImageMissingError } from "../../runners/docker/image.ts";
import { MountRefusedError, RunnerBusyError } from "../../runners/docker/mounts.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { WorkspaceError } from "../../worktrees/types.ts";
import { AgentManagerError } from "./errors.ts";
import { MAX_STATUS_REASON, safeReason, startFailure, startFailureReason } from "./failure.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

const AREA = "/srv/office/worktrees/operation-1/u-other/agent-1";

describe("safeReason", () => {
  test("drops paths, env values, tokens, URL credentials and line breaks", () => {
    const text = [
      `mkdir ${AREA}: permission denied (cwd ~/work, ./x, "${AREA}/.git")`,
      "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop HOME=/home/runner",
      "Authorization: Bearer abc.def and https://user:ghp_abcdefghijklmnop1234@github.com/o/r",
      `container ${"a1".repeat(32)} gone`,
    ].join("\n");
    const out = safeReason(text, 1000);
    expect(out).not.toContain("\n");
    for (const leak of ["/srv", "u-other", "sk-ant", "ghp_", "abc.def", "user:", "a1a1a1"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain('mkdir <path>: permission denied (cwd <path>, <path>, "<path>")');
    expect(out).toContain("ANTHROPIC_API_KEY=[redacted] HOME=[redacted]");
    expect(out).toContain("container [redacted] gone");
  });

  test("is idempotent, cuts to the limit and drops control characters", () => {
    const once = safeReason("tmux new-session failed: \u001b[31mno server\u001b[0m at /run/x.sock");
    expect(once).toBe("tmux new-session failed: [31mno server [0m at <path>");
    expect(safeReason(once)).toBe(once);
    const long = safeReason("x ".repeat(300));
    expect(long.length).toBe(MAX_STATUS_REASON);
    expect(long.endsWith("…")).toBe(true);
    expect(safeReason(undefined)).toBe("");
  });
});

describe("startFailure", () => {
  test("runner busy names counts and piped labels, never the user or the mount", () => {
    const err = new RunnerBusyError("u-owner", ["agent-1"], [AREA], ["claude auth status"]);
    expect(startFailure(err)).toEqual({
      code: "runner_busy",
      message:
        "the runner needs a new mount but still runs 1 tmux session and 1 piped process (claude auth status)",
    });
    expect(startFailureReason(err)).not.toContain("u-owner");
  });

  test("known errors get a code; unknown ones are redacted", () => {
    const cases: [unknown, string][] = [
      [new MountRefusedError(`refusing to mount ${AREA}`), "mount_refused: the workdir is outside"],
      [
        new DockerApiError(500, `POST /containers/abc/start: 500 bind source path ${AREA}`),
        "runner_api: Docker Engine: POST <path>: 500 bind source path <path>",
      ],
      [
        new DockerApiError(
          500,
          `POST /containers/abc/start: 500 RWLayer of container ${"f0".repeat(32)} is unexpectedly nil`,
        ),
        "runner_api: Docker Engine: POST <path>: 500 RWLayer of container [redacted] is unexpectedly nil",
      ],
      [
        new RunnerImageMissingError("regulus-runner:latest", `pull failed: denied ${AREA}`),
        "runner_image_missing: the runner image regulus-runner:latest is not on the Docker host",
      ],
      [
        new CliMissingError("/usr/local/bin/codex"),
        "cli_missing: codex is not installed in the runner",
      ],
      [new WorkspaceError("worktree_failed", "no such branch"), "worktree_failed: no such branch"],
      [new AgentManagerError("unavailable", "keys unavailable"), "unavailable: keys unavailable"],
      [
        new Error(`tmux new-session failed: ${AREA}`),
        "start_failed: tmux new-session failed: <path>",
      ],
      ["what", "start_failed: unknown error"],
    ];
    for (const [err, prefix] of cases) expect(startFailureReason(err)).toStartWith(prefix);
  });
});

describe.skipIf(!hasTmux())("a failed start (manager)", () => {
  let runner: LocalTmuxRunner;
  let office: Awaited<ReturnType<typeof officeFixture>>;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    office = await officeFixture();
  });

  afterEach(async () => {
    await runner.dispose();
    await rm(office.workdir, { recursive: true, force: true });
  });

  test("logs the cause and publishes a short, safe reason on the henchman and its event", async () => {
    runner.mountProject = async (user) => {
      throw new RunnerBusyError(user.userId, [], [AREA], ["claude auth status"]);
    };
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      level: "info",
      destination: { write: (line: string) => lines.push(JSON.parse(line)) },
    });
    const adapter = new FakeAdapter({ command: ["sh", FAKE_AGENT] });
    const { manager, henchmen } = makeManager(office.db, runner, [adapter], { logger });

    const spawn = manager.spawn(office.member, spawnInput(office.operationId, office.repoId));
    await expect(spawn).rejects.toBeInstanceOf(AgentManagerError);
    const [henchman] = [...henchmen.henchmen.values()];
    const reason =
      "runner_busy: the runner needs a new mount but still runs 1 piped process (claude auth status)";
    expect(henchman).toMatchObject({ status: "error", action: "failing", statusReason: reason });
    expect(HenchmanState.safeParse(henchman).success).toBe(true);
    expect(henchmen.history.map((r) => r.status)).toEqual(["starting", "error"]);

    const logged = lines.find((l) => l.msg === "agent launch failed");
    expect(logged).toMatchObject({ agentId: henchman?.agentId, code: "runner_busy" });
    expect(String(logged?.err)).toContain("RunnerBusyError: runner for");

    const events = office.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.agentId, henchman?.agentId ?? ""))
      .all();
    expect(events.map((e) => JSON.stringify(e.payloadJson))).toContainEqual(
      expect.stringContaining(reason),
    );
  });
});
