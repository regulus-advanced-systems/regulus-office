#!/usr/bin/env bun
/**
 * Stand-in for `pm2` on a watched host, for the watchdog's tests (#253). It is
 * NOT PM2 and starts nothing. It answers the two commands the office runs the
 * way PM2 6.0.14 was seen to answer them on 2026-10-09:
 *
 * - `pm2 jlist`: one JSON array on stdout, each process with its whole
 *   environment under `pm2_env.env` (here with a made-up secret in it, so a
 *   test can show it never leaves the probe);
 * - `pm2 logs <app> --err --nostream --raw --lines N`: two header lines on
 *   stdout, in colour, and the error log's lines on **stderr**.
 *
 * What it prints comes from `$FAKE_PM2_STATE`, or `$HOME/fake-pm2-state.json` (a JSON file a test rewrites
 * between rounds): `{ apps: [{ name, status, restarts, unstable, log: [] }] }`.
 * Any other command is refused with exit 3, like a forced-command wrapper for
 * a read-only user would, and every call is appended to `$FAKE_PM2_STATE.calls`.
 *
 * Called directly with the command as its arguments, or as an sshd forced
 * command, where the command is in `$SSH_ORIGINAL_COMMAND`.
 */
import { appendFileSync, readFileSync } from "node:fs";

interface FakeApp {
  name: string;
  status?: string;
  restarts?: number;
  unstable?: number;
  log?: string[];
}

const FAKE_PM2_ENV_SECRET = "sk-ant-api03-FAKE-env-of-a-production-app-0123456789";

const statePath =
  process.env.FAKE_PM2_STATE ?? (process.env.HOME ? `${process.env.HOME}/fake-pm2-state.json` : "");
const argv = process.env.SSH_ORIGINAL_COMMAND
  ? process.env.SSH_ORIGINAL_COMMAND.split(" ")
  : process.argv.slice(2);
if (statePath) appendFileSync(`${statePath}.calls`, `${argv.join(" ")}\n`);

const refuse = (): never => {
  process.stderr.write("this user may only read PM2 state and logs\n");
  process.exit(3);
};

if (argv[0] !== "pm2" || !statePath) refuse();
const state = JSON.parse(readFileSync(statePath, "utf8")) as { apps: FakeApp[] };

if (argv.length === 2 && argv[1] === "jlist") {
  process.stdout.write(
    `${JSON.stringify(
      state.apps.map((app, i) => ({
        pid: 4000 + i,
        name: app.name,
        pm2_env: {
          status: app.status ?? "online",
          restart_time: app.restarts ?? 0,
          unstable_restarts: app.unstable ?? 0,
          pm_uptime: 1_791_535_815_085,
          pm_err_log_path: `/home/deploy/.pm2/logs/${app.name}-error.log`,
          env: { NODE_ENV: "production", ANTHROPIC_API_KEY: FAKE_PM2_ENV_SECRET },
        },
        monit: { memory: 61_000_000, cpu: 0.2 },
      })),
    )}\n`,
  );
  process.exit(0);
}

const flags = ["--err", "--nostream", "--raw", "--lines"];
if (
  argv.length === 8 &&
  argv[1] === "logs" &&
  flags.every((flag, i) => argv[3 + i] === flag) &&
  /^\d+$/.test(argv[7] ?? "")
) {
  const name = argv[2] ?? "";
  const lines = Number(argv[7]);
  process.stdout.write(
    `\u001b[1m\u001b[90m[TAILING] Tailing last ${lines} lines for [${name}] process (change the value with --lines option)\u001b[39m\u001b[22m\n`,
  );
  const app = state.apps.find((a) => a.name === name);
  if (app) {
    process.stdout.write(
      `\u001b[90m/home/deploy/.pm2/logs/${name}-error.log last ${lines} lines:\u001b[39m\n`,
    );
    const log = (app.log ?? []).slice(-lines);
    if (log.length > 0) process.stderr.write(`${log.join("\n")}\n`);
    process.stdout.write("\n");
  }
  process.exit(0);
}

refuse();
