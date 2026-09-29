/**
 * What tests/e2e/agents.e2e.ts keeps when something fails (#130), written into Playwright's
 * test-results/ so CI uploads it with the trace: the office-server log, and for each runner
 * container of this run its state, `docker logs`, the fake claude's stderr trace
 * (tests/e2e/runner/claude) and the last lines of each tmux pane. Everything here comes from the
 * run's throwaway office and the fake agent; the hook token only ever sits in files that are
 * not read here.
 *
 * Best effort: a runner that is gone or a command that fails is noted in the output, never
 * thrown, so collecting cannot hide the failure it is meant to explain.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "./agentOffice.ts";

const PREFIX_LABEL = "org.regulus.office.prefix";
const USER_LABEL = "org.regulus.office.user";
const FAKE_TRACE = "/home/runner/fake-claude.stderr";
const PANE_LINES = 200;

function attempt(run: () => string): string {
  try {
    return run();
  } catch (err) {
    const e = err as { message?: string; stderr?: unknown };
    return `(failed: ${String(e.stderr ?? e.message ?? err).trim()})`;
  }
}

/** `docker logs` (both streams, with timestamps) as one string. */
function dockerLogs(name: string): string {
  return attempt(() => sh("sh", ["-c", 'docker logs --timestamps "$1" 2>&1', "sh", name]));
}

/** Runner containers of this run: name and owning user id. */
function runners(prefix: string): { name: string; userId: string }[] {
  const out = attempt(() =>
    sh("docker", [
      ...["ps", "-a", "--filter", `label=${PREFIX_LABEL}=${prefix}`],
      ...["--format", `{{.Names}}\t{{.Label "${USER_LABEL}"}}`],
    ]),
  );
  if (out.startsWith("(failed")) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", userId = ""] = line.split("\t");
      return { name, userId };
    });
}

/** Each tmux session's last pane lines in the human's runner. */
function panes(name: string, userId: string): string {
  const script = [
    'for s in $(tmux -S "$1" list-sessions -F "#{session_name}" 2>&1); do',
    '  echo "=== tmux $s"; tmux -S "$1" capture-pane -p -J -t "=$s:" -S "-$2" 2>&1;',
    "done",
  ].join("\n");
  const socket = `/run/office/tmux/${userId}.sock`;
  return attempt(() =>
    sh("docker", ["exec", name, "sh", "-c", script, "sh", socket, String(PANE_LINES)]),
  );
}

/**
 * Writes `office-server.log` and one `runner-<name>.txt` per runner container into `dir`.
 * Returns the files written.
 */
export function collectAgentDiagnostics(
  dir: string,
  opts: { prefix: string; serverLog: string },
): string[] {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (file: string, text: string) => {
    const path = join(dir, file);
    writeFileSync(path, text);
    files.push(path);
  };
  write("office-server.log", opts.serverLog);
  const found = opts.prefix ? runners(opts.prefix) : [];
  const ps = attempt(() =>
    sh("docker", ["ps", "-a", "--filter", `label=${PREFIX_LABEL}=${opts.prefix}`]),
  );
  write("runners.txt", `${ps}\n`);
  for (const { name, userId } of found) {
    const state = attempt(() =>
      sh("docker", [
        ...["inspect", "--format"],
        "status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} " +
          "restarts={{.RestartCount}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}",
        name,
      ]),
    );
    const trace = attempt(() => sh("docker", ["exec", name, "cat", FAKE_TRACE]));
    write(
      `runner-${name}.txt`,
      [
        `=== state\n${state}`,
        `=== docker logs\n${dockerLogs(name)}`,
        `=== fake claude stderr (${FAKE_TRACE})\n${trace}`,
        `=== tmux panes (last ${PANE_LINES} lines)\n${panes(name, userId)}`,
        "",
      ].join("\n"),
    );
  }
  return files;
}
