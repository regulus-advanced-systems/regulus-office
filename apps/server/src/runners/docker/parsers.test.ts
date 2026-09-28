import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../config.ts";
import { HijackError, hijack, parseDockerHost } from "./hijack.ts";
import { floorMountTargets, isCovered, toMountSpec } from "./mounts.ts";
import { demuxAll, frame, STDERR, STDOUT } from "./mux.ts";
import { decodeAddress, parsePortOutput, parseProcessOutput, parseStat } from "./procfs.ts";
import { FakeEngine } from "./testing/fake-engine.ts";

describe("procfs", () => {
  test("parseStat handles spaces and parens in comm", () => {
    expect(parseStat("12 (my (odd) proc) S 3 12 12 0")).toEqual({
      pid: 12,
      ppid: 3,
      session: 12,
      command: "my (odd) proc",
    });
    expect(parseStat("garbage")).toBeNull();
  });

  test("process tree includes descendants and reparented session members", () => {
    const out = [
      "10",
      "1 (docker-init) S 0 1 1 0",
      "10 (sh) S 5 10 10 0",
      "11 (node) S 10 10 10 0",
      "12 (esbuild) S 11 10 10 0",
      "13 (daemon) S 1 10 10 0",
      "20 (other) S 1 20 20 0",
    ].join("\n");
    expect(parseProcessOutput(out).map((p) => p.pid)).toEqual([10, 11, 12, 13]);
    expect(parseProcessOutput("")).toEqual([]);
  });

  test("ports: listening sockets owned by the agent's pids", () => {
    const table = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 111 1",
      "   1: 0100007F:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 222 1",
      "   2: 0100007F:0CEB 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1001        0 333 1",
      "   3: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 444 1",
      "   0: 00000000000000000000000001000000:1389 00000000000000000000000000000000:0000 0A 0 0 0 1001 0 555 1",
    ].join("\n");
    const fds = [
      "11 socket:[111]",
      "11 socket:[222]",
      "11 socket:[333]",
      "12 socket:[555]",
      "11 pipe:[9]",
    ];
    expect(parsePortOutput(`${table}\n--fds--\n${fds.join("\n")}`)).toEqual([
      { port: 3306, address: "127.0.0.1", pid: 11 },
      { port: 5001, address: "::1", pid: 12 },
      { port: 8080, address: "0.0.0.0", pid: 11 },
    ]);
  });

  test("decodeAddress", () => {
    expect(decodeAddress("0100007F")).toBe("127.0.0.1");
    expect(decodeAddress("00000000000000000000000000000000")).toBe("::");
    expect(decodeAddress("0000000000000000FFFF00000100007F")).toBe("::ffff:127.0.0.1");
  });
});

describe("mounts", () => {
  const roots = ["/srv/office/projects", "/srv/office/worktrees"];

  test("a floor repo mounts the whole floor dir under every root", () => {
    expect(floorMountTargets("/srv/office/projects/f1/repo", roots)).toEqual([
      "/srv/office/projects/f1",
      "/srv/office/worktrees/f1",
    ]);
    expect(floorMountTargets("/srv/office/worktrees/f1/a1/", roots)).toEqual([
      "/srv/office/projects/f1",
      "/srv/office/worktrees/f1",
    ]);
    expect(floorMountTargets("/elsewhere/repo", roots)).toEqual(["/elsewhere/repo"]);
    expect(() => floorMountTargets("relative/repo", roots)).toThrow(/absolute/);
  });

  test("coverage by parent mounts, not by prefix", () => {
    const mounts = [{ Type: "bind" as const, Source: "/a/f1", Target: "/a/f1" }];
    expect(isCovered("/a/f1", mounts)).toBe(true);
    expect(isCovered("/a/f1/repo", mounts)).toBe(true);
    expect(isCovered("/a/f10", mounts)).toBe(false);
  });

  test("volume-mapped paths become subpath volume mounts", () => {
    const map = [{ path: "/srv/office/projects", volume: "regulus_projects" }];
    expect(toMountSpec("/srv/office/projects/f1", map)).toEqual({
      Type: "volume",
      Source: "regulus_projects",
      Target: "/srv/office/projects/f1",
      VolumeOptions: { Subpath: "f1" },
    });
    expect(toMountSpec("/srv/office/worktrees/f1", map).Type).toBe("bind");
  });
});

describe("engine plumbing", () => {
  test("parseDockerHost", () => {
    expect(parseDockerHost("unix:///var/run/docker.sock")).toEqual({
      kind: "unix",
      path: "/var/run/docker.sock",
    });
    expect(parseDockerHost("tcp://docker-proxy:2375")).toEqual({
      kind: "tcp",
      hostname: "docker-proxy",
      port: 2375,
    });
    expect(() => parseDockerHost("ssh://host")).toThrow(/unsupported/);
  });

  test("mux frames round-trip", () => {
    const body = new Uint8Array([
      ...frame(STDOUT, "out"),
      ...frame(STDERR, "err"),
      ...frame(STDOUT, "!"),
    ]);
    expect(demuxAll(body)).toEqual({ stdout: "out!", stderr: "err" });
  });

  test("hijack surfaces daemon errors", async () => {
    const fake = await FakeEngine.start();
    try {
      const err = await hijack({ kind: "unix", path: fake.socketPath }, "/v1.45/exec/nope/start", {
        Detach: false,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(HijackError);
      expect(err.status).toBe(404);
      expect(err.message).toContain("No such exec");
    } finally {
      await fake.stop();
    }
  });
});

describe("docker backend config", () => {
  test("defaults", () => {
    expect(loadConfig({}).docker).toEqual({
      dockerHost: "unix:///var/run/docker.sock",
      image: "ghcr.io/regulus-advanced-systems/regulus-office-runner:latest",
      prefix: "office",
      user: "1001:1001",
      home: "/home/runner",
      network: undefined,
      memoryBytes: undefined,
      cpus: undefined,
      pidsLimit: 4096,
      floorRoots: ["/srv/office/projects", "/srv/office/worktrees"],
      volumeMap: [],
    });
  });

  test("parses limits, proxy host and volume map", () => {
    const d = loadConfig({
      DOCKER_HOST: "tcp://docker-proxy:2375",
      OFFICE_DOCKER_RUNNER_MEMORY: "4g",
      OFFICE_DOCKER_RUNNER_CPUS: "1.5",
      OFFICE_DOCKER_VOLUME_MAP: "/srv/office/projects=regulus_projects",
    }).docker;
    expect(d.dockerHost).toBe("tcp://docker-proxy:2375");
    expect(d.memoryBytes).toBe(4 * 1024 ** 3);
    expect(d.cpus).toBe(1.5);
    expect(d.volumeMap).toEqual([{ path: "/srv/office/projects", volume: "regulus_projects" }]);
  });

  test("rejects a root runner user and bad maps", () => {
    expect(() => loadConfig({ OFFICE_DOCKER_RUNNER_USER: "0:0" })).toThrow(/not be root/);
    expect(() => loadConfig({ OFFICE_DOCKER_RUNNER_USER: "runner" })).toThrow(/uid:gid/);
    expect(() => loadConfig({ OFFICE_DOCKER_VOLUME_MAP: "projects" })).toThrow(/abs\/path/);
  });
});
