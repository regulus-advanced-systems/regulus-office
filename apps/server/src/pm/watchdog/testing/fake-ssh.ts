#!/usr/bin/env bun
/**
 * Stand-in for the `ssh` client (and, called as `fake-ssh.ts keyscan ...`, for
 * `ssh-keyscan`) in the watchdog's tests (#253). It is NOT OpenSSH and opens
 * no connection: it takes the arguments the office passes (pm2.ts `sshArgv`),
 * writes down what it was given (its argv, and the mode and a hash of the key
 * file named by `-i`, never the key) into `$HOME/fake-ssh.log`, and runs the
 * remote command through the PM2 stand-in beside it, as the host would.
 *
 * Host keys, like OpenSSH: the "host" shows the key in the state file
 * (`hostKey`, default below). With `StrictHostKeyChecking=yes` the
 * `UserKnownHostsFile` must hold that key or the call fails with "Host key
 * verification failed."; with `accept-new` an empty file gets the key
 * appended, and a file with another key fails the same way.
 *
 * A host named `unreachable.test` fails like a refused connection.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIRSTFIRSTFIRSTFIRSTFIRSTFIRSTFIRST";

const home = process.env.HOME ?? "";
let shown = DEFAULT_HOST_KEY;
try {
  const state = JSON.parse(readFileSync(`${home}/fake-pm2-state.json`, "utf8")) as {
    hostKey?: string;
  };
  if (state.hostKey) shown = state.hostKey;
} catch {
  // no state yet: the default key
}

const argv = process.argv.slice(2);
if (argv[0] === "keyscan") {
  // `ssh-keyscan -T 10 -p <port> -- <host>`
  process.stdout.write(`${argv.at(-1)} ${shown}\n`);
  process.exit(0);
}

const end = argv.indexOf("--");
const host = argv[end + 1] ?? "";
const remote = argv.slice(end + 2);
const keyPath = argv[argv.indexOf("-i") + 1] ?? "";
const option = (name: string) =>
  argv.find((a, i) => argv[i - 1] === "-o" && a.startsWith(`${name}=`))?.slice(name.length + 1);

let key: { mode: string; sha256: string } | null = null;
try {
  key = {
    mode: (statSync(keyPath).mode & 0o777).toString(8),
    sha256: createHash("sha256").update(readFileSync(keyPath)).digest("hex"),
  };
} catch {
  key = null;
}
const knownHostsPath = option("UserKnownHostsFile") ?? "";
let knownHosts = "";
try {
  knownHosts = readFileSync(knownHostsPath, "utf8");
} catch {
  knownHosts = "";
}
if (home) {
  appendFileSync(
    `${home}/fake-ssh.log`,
    `${JSON.stringify({ argv, host, remote, key, knownHosts, env: Object.keys(process.env).sort() })}\n`,
  );
}
if (host === "unreachable.test") {
  process.stderr.write(`ssh: connect to host ${host} port 22: Connection refused\n`);
  process.exit(255);
}
const strict = option("StrictHostKeyChecking");
const pinned = knownHosts.trim().length > 0;
if (pinned ? !knownHosts.includes(shown) : strict === "yes") {
  process.stderr.write("Host key verification failed.\n");
  process.exit(255);
}
if (!pinned && knownHostsPath) appendFileSync(knownHostsPath, `${host} ${shown}\n`);

const proc = Bun.spawnSync(["bun", join(import.meta.dir, "fake-pm2.ts"), ...remote], {
  env: { ...process.env, SSH_ORIGINAL_COMMAND: "" },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(proc.exitCode ?? 1);
