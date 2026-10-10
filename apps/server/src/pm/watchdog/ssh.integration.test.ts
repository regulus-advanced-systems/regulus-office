/**
 * The SSH probe against a real OpenSSH server (#253): `sshd` on a loopback
 * port of this machine, key authentication, the host key pinned, and the key's
 * `authorized_keys` entry restricted to a forced command, which is how a
 * read-only watchdog user is set up on a host. Behind the forced command is
 * the PM2 stand-in: OpenSSH is real on both ends, PM2 and the host are not.
 *
 * Skipped where there is no `sshd` or it cannot start as this user (CI
 * images without OpenSSH server); probe.ts is then covered by the `ssh`
 * stand-in in rounds.integration.test.ts only.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Secret } from "@regulus/agent-adapters";
import { captureLogger } from "../../notifications/testing.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { fingerprints, keyLines, pinOf } from "./hostkey.ts";
import { HostKeyChanged, ProbeError, SshProbe } from "./probe.ts";
import type { WatchdogAppRow, WatchdogHostRow } from "./store.ts";
import { PM2_ENV_SECRET, STACK } from "./testing/kit.ts";

setDefaultTimeout(60_000);

const SSHD = ["/usr/sbin/sshd", "/usr/bin/sshd"].find((path) => existsSync(path));
const FAKE_PM2 = join(import.meta.dir, "testing", "fake-pm2.ts");
const NONE = { restarts: null, status: null, logMark: null };

let dir = "";
let runner: LocalTmuxRunner | undefined;
let sshd: ReturnType<typeof Bun.spawn> | undefined;
let port = 0;
let hostPublicKey = "";
let clientKey = "";
let ready = false;
const log = captureLogger();

const run = async (argv: string[]) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`${argv[0]} failed`);
};
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
async function listening(p: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    try {
      const socket = await Bun.connect({ hostname: "127.0.0.1", port: p, socket: { data() {} } });
      socket.end();
      return true;
    } catch {
      await Bun.sleep(50);
    }
  }
  return false;
}

beforeAll(async () => {
  if (!SSHD) return;
  dir = await mkdtemp(join(tmpdir(), "rg-sshd-"));
  await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", join(dir, "host_key")]);
  await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", join(dir, "client_key")]);
  await run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", join(dir, "other_key")]);
  hostPublicKey = (await readFile(join(dir, "host_key.pub"), "utf8")).trim();
  clientKey = await readFile(join(dir, "client_key"), "utf8");
  const clientPublic = (await readFile(join(dir, "client_key.pub"), "utf8")).trim();
  await writeFile(
    join(dir, "state.json"),
    JSON.stringify({ apps: [{ name: "api", restarts: 3, log: STACK }] }),
  );
  // What a read-only user's key looks like on a host: one forced command, nothing else.
  await writeFile(
    join(dir, "authorized_keys"),
    `restrict,command="FAKE_PM2_STATE=${join(dir, "state.json")} ${process.execPath} ${FAKE_PM2}" ${clientPublic}\n`,
    { mode: 0o600 },
  );
  port = await freePort();
  await writeFile(
    join(dir, "sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${join(dir, "host_key")}`,
      `PidFile ${join(dir, "sshd.pid")}`,
      `AuthorizedKeysFile ${join(dir, "authorized_keys")}`,
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "UsePAM no",
      "StrictModes no",
      "LogLevel ERROR",
    ].join("\n"),
  );
  sshd = Bun.spawn([SSHD, "-D", "-e", "-f", join(dir, "sshd_config")], {
    stdout: "ignore",
    stderr: "ignore",
  });
  ready = await listening(port);
  if (ready) runner = await LocalTmuxRunner.create();
}, 30_000);

afterAll(async () => {
  sshd?.kill();
  await runner?.dispose();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const host = (over: Partial<WatchdogHostRow> = {}): WatchdogHostRow =>
  ({
    id: "host-1",
    label: "loopback",
    host: "127.0.0.1",
    port,
    username: userInfo().username,
    hostKey: pinOf(hostPublicKey),
    encryptedKey: "",
    ...over,
  }) as WatchdogHostRow;
const APPS = [
  { id: "app-1", hostId: "host-1", name: "api" },
  { id: "app-2", hostId: "host-1", name: "ghost" },
] as WatchdogAppRow[];
const probe = () => {
  if (!runner) throw new Error("no runner");
  return new SshProbe({ runner, logger: log.logger, timeoutMs: 20_000 });
};

describe("the SSH probe against a real sshd", () => {
  const gone = async (agentId: string) => {
    if (!runner) throw new Error("no runner");
    const home = (await runner.provision({ userId: "officeagents" })).home;
    return stat(`${home}/.regulus-office/office-agents/${agentId}/watchdog`).then(
      () => false,
      () => true,
    );
  };

  test("reads PM2 state and logs through a forced command, with the host key pinned", async () => {
    if (!ready) return console.warn("skipped: no sshd could be started on this machine");
    const reading = await probe().check("agent-1", host(), Secret.of(clientKey), APPS, () => NONE);
    const [api, ghost] = reading.apps;
    expect(api?.reading).toMatchObject({ status: "online", restarts: 3 });
    expect(api?.reading.signals.map((s) => s.kind)).toEqual(["error", "error"]);
    // The error log came back on the SSH session's stderr, as PM2 writes it.
    expect(api?.reading.signals[0]?.lines[0]).toContain("TypeError: Cannot read properties");
    expect(JSON.stringify(reading)).not.toContain("hunter2");
    expect(JSON.stringify(reading)).not.toContain(PM2_ENV_SECRET);
    expect(ghost?.reading.status).toBe("missing");
    // A pinned host teaches nothing new.
    expect(reading.learnedKey).toBeUndefined();
    // Only the two read-only commands reached the host.
    const calls = (await readFile(join(dir, "state.json.calls"), "utf8")).trim().split("\n");
    expect(calls).toEqual(["pm2 jlist", "pm2 logs api --err --nostream --raw --lines 300"]);
    // The private key is not on the volume after the check.
    expect(await gone("agent-1")).toBe(true);
  });

  test("another host key is refused and what the host shows is handed back; an unknown key is refused", async () => {
    if (!ready) return;
    const otherHost = (await readFile(join(dir, "other_key.pub"), "utf8")).trim();
    let changed: unknown;
    try {
      await probe().check(
        "agent-2",
        host({ id: "host-2", hostKey: pinOf(otherHost) }),
        Secret.of(clientKey),
        APPS,
        () => NONE,
      );
    } catch (err) {
      changed = err;
    }
    expect(changed).toBeInstanceOf(HostKeyChanged);
    // Read with the real ssh-keyscan: the key this sshd shows, for an admin to compare.
    expect(keyLines((changed as HostKeyChanged).offered)).toContain(pinOf(hostPublicKey));
    let refused: unknown;
    try {
      await probe().check(
        "agent-3",
        host({ id: "host-3" }),
        Secret.of(await readFile(join(dir, "other_key"), "utf8")),
        APPS,
        () => NONE,
      );
    } catch (err) {
      refused = err;
    }
    expect(refused).toEqual(new ProbeError("the host refused the key"));
    // What ssh printed is not passed on, the key is in no log, and it is gone after a failure too.
    expect(log.text()).not.toContain("PRIVATE KEY");
    expect(await gone("agent-2")).toBe(true);
    expect(await gone("agent-3")).toBe(true);
  });

  test("a host without a pin: the key it shows on first contact is handed back to be stored", async () => {
    if (!ready) return;
    const unpinned = host({ id: "host-4", hostKey: "" });
    const reading = await probe().check(
      "agent-4",
      unpinned,
      Secret.of(clientKey),
      APPS,
      () => NONE,
    );
    expect(reading.learnedKey).toBe(pinOf(hostPublicKey));
    expect(fingerprints(reading.learnedKey ?? "")[0]).toMatch(/^ssh-ed25519 SHA256:/);
    expect(await gone("agent-4")).toBe(true);
    // With that pin stored, the next check is strict and passes.
    const again = await probe().check(
      "agent-4",
      host({ id: "host-4", hostKey: reading.learnedKey ?? "" }),
      Secret.of(clientKey),
      APPS,
      () => NONE,
    );
    expect(again.learnedKey).toBeUndefined();
    expect(again.apps[0]?.reading.status).toBe("online");
  });
});
