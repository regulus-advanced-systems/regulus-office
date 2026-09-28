/**
 * Terminal bridge load test (issue #24): one agent printing a timestamped
 * line every few ms, N watchers attached through the real bridge (auth,
 * Origin, one Bun PTY `tmux attach -r` per viewer). Reports line latency
 * (agent print → viewer receive) and CPU of the office process, the tmux
 * clients it spawned and the tmux server.
 *
 *   bun run --filter @regulus/server loadtest:terminal -- [--viewers 5] [--seconds 10] [--interval 5]
 *
 * The viewers run in the same process as the server, so the office CPU figure
 * includes their WebSocket decoding; treat it as an upper bound.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretEnv } from "@regulus/agent-adapters";
import { hasTmux, LocalTmuxRunner } from "../src/runners/testing/local-tmux-runner.ts";
import { hasBunPty } from "../src/terminals/pipe.ts";
import { startTerminalOffice, type TermClient } from "../src/terminals/test-helpers.ts";

const arg = (name: string, fallback: string): number => {
  const i = process.argv.indexOf(`--${name}`);
  return Number(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback);
};
const VIEWERS = arg("viewers", "5");
const SECONDS = arg("seconds", "10");
const INTERVAL_MS = arg("interval", "5");

const TICKS = 100; // USER_HZ on Linux
/** utime + stime of a pid in seconds, 0 when unreadable. */
function cpuSeconds(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / TICKS;
  } catch {
    return 0;
  }
}

async function childPids(): Promise<number[]> {
  const out = await Bun.$`ps -o pid= --ppid ${process.pid}`.quiet().nothrow().text();
  return out
    .split("\n")
    .map(Number)
    .filter((n) => n > 0);
}

if (!hasTmux() || !hasBunPty()) {
  console.error("tmux and Bun PTY support are required");
  process.exit(2);
}

const runner = await LocalTmuxRunner.create();
const workdir = await mkdtemp(join(tmpdir(), "rgo-term-load-"));
const office = await startTerminalOffice({ runner });
try {
  const owner = await office.signUp("Owner");
  office.addFloor("f1");
  office.addAgent("load", "f1", owner.id);
  const generator = `setInterval(() => console.log("T " + Date.now() + " " + "x".repeat(80)), ${INTERVAL_MS})`;
  await runner.exec(
    { userId: owner.id },
    {
      agentId: "load",
      provider: "custom",
      argv: [process.execPath, "-e", generator],
      env: SecretEnv.empty(),
      files: [],
      cwd: workdir,
      tmuxSession: "agent-load",
    },
  );

  const latencies: number[] = [];
  let lines = 0;
  const viewers: TermClient[] = [];
  for (let i = 0; i < VIEWERS; i += 1) {
    const client = await office.connect("load", "watch", owner.cookie);
    let carry = "";
    client.ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return;
      const now = Date.now();
      carry += new TextDecoder().decode(event.data as ArrayBuffer);
      for (const m of carry.matchAll(/T (\d{13}) /g)) {
        latencies.push(now - Number(m[1]));
        lines += 1;
      }
      carry = carry.slice(Math.max(0, carry.lastIndexOf("T ")));
      if (/T \d{13} /.test(carry)) carry = "";
    });
    viewers.push(client);
  }
  await Bun.sleep(500);
  latencies.length = 0;
  lines = 0;

  const tmuxServer = Number(
    await Bun.$`tmux -S ${runner.socket} display -p '#{pid}'`.quiet().text(),
  );
  const clients = await childPids();
  console.error("tmux attach clients:", clients.length);
  const cpu0 = {
    office: cpuSeconds(process.pid),
    clients: clients.map(cpuSeconds),
    tmux: cpuSeconds(tmuxServer),
  };
  const t0 = performance.now();
  await Bun.sleep(SECONDS * 1000);
  const wall = (performance.now() - t0) / 1000;
  const pct = (s: number) => `${((s / wall) * 100).toFixed(1)}%`;
  const officeCpu = cpuSeconds(process.pid) - cpu0.office;
  const clientCpu = clients.reduce(
    (sum, pid, i) => sum + cpuSeconds(pid) - (cpu0.clients[i] ?? 0),
    0,
  );
  const tmuxCpu = cpuSeconds(tmuxServer) - cpu0.tmux;

  latencies.sort((a, b) => a - b);
  const q = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];
  console.log(
    JSON.stringify(
      {
        viewers: VIEWERS,
        seconds: SECONDS,
        agentLinesPerSecond: Math.round(1000 / INTERVAL_MS),
        linesReceived: lines,
        latencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) },
        cpu: {
          officeProcess: pct(officeCpu),
          tmuxAttachClients: pct(clientCpu),
          tmuxServer: pct(tmuxCpu),
        },
      },
      null,
      2,
    ),
  );
  for (const v of viewers) v.ws.close();
} finally {
  await office.stop();
  await runner.dispose();
  await rm(workdir, { recursive: true, force: true });
}
