#!/usr/bin/env bun
/**
 * Stand-in for `ssh-keyscan` in the watchdog's tests (#253): prints the key
 * the `ssh` stand-in's "host" shows (fake-ssh.ts), for the host named last.
 * It is NOT OpenSSH and opens no connection.
 */
import { join } from "node:path";

const proc = Bun.spawnSync(
  ["bun", join(import.meta.dir, "fake-ssh.ts"), "keyscan", ...process.argv.slice(2)],
  { env: process.env, stdout: "inherit", stderr: "inherit" },
);
process.exit(proc.exitCode ?? 1);
