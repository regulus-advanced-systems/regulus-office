import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentPids,
  listeningPorts,
  parseProcNetTcp,
  parseProcStat,
  parseSocketInodes,
  processInfo,
} from "./proc.ts";

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4242 1 0000000000000000 100 0 0 10 0
   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 17 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1F90 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1001        0 4343 1 0000000000000000 20 4 30 10 -1
`;
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 5151 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1388 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 5252 1 0000000000000000 100 0 0 10 0
`;

describe("parsers", () => {
  test("parseProcStat handles comm with spaces and parentheses", () => {
    expect(parseProcStat("123 (node) S 45 123 123 0 -1")).toEqual({
      pid: 123,
      ppid: 45,
      command: "node",
    });
    expect(parseProcStat("7 (a (b) c) R 1 7 7")).toEqual({ pid: 7, ppid: 1, command: "a (b) c" });
    expect(parseProcStat("garbage")).toBeNull();
  });

  test("parseProcNetTcp keeps LISTEN sockets and decodes addresses", () => {
    expect(parseProcNetTcp(TCP)).toEqual([
      { inode: 4242, address: "127.0.0.1", port: 8080 },
      { inode: 17, address: "0.0.0.0", port: 22 },
    ]);
    expect(parseProcNetTcp(TCP6)).toEqual([
      { inode: 5151, address: "::1", port: 3000 },
      { inode: 5252, address: "::", port: 5000 },
    ]);
  });

  test("parseSocketInodes maps inode to pid", () => {
    expect([...parseSocketInodes("10 4242\n11 5151\njunk\n")]).toEqual([
      [4242, 10],
      [5151, 11],
    ]);
  });
});

describe("with a fake /proc and cgroup tree", () => {
  let root: string;
  let cgroupDir: string;
  let procRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rgo-proc-"));
    cgroupDir = join(root, "cgroup");
    procRoot = join(root, "proc");
    const scope = async (name: string, pids: number[]) => {
      await mkdir(join(cgroupDir, name), { recursive: true });
      await writeFile(join(cgroupDir, name, "cgroup.procs"), pids.map((p) => `${p}\n`).join(""));
    };
    await scope("agent-a1.scope", [10, 12]);
    await scope("agent-a1.io-0badf00d.scope", [11]);
    await scope("agent-a10.scope", [99]);
    await scope("office-tmux-u1.scope", [5]);
    await mkdir(join(procRoot, "10"), { recursive: true });
    await writeFile(join(procRoot, "10", "stat"), "10 (sh) S 5 10 10 0");
    await mkdir(join(procRoot, "net"), { recursive: true });
    await writeFile(join(procRoot, "net", "tcp"), TCP);
    await writeFile(join(procRoot, "net", "tcp6"), TCP6);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("agentPids reads exactly the agent's scopes", async () => {
    expect((await agentPids(cgroupDir, "a1")).sort()).toEqual([10, 11, 12]);
    expect(await agentPids(join(root, "missing"), "a1")).toEqual([]);
  });

  test("processInfo returns null for exited pids", async () => {
    expect(await processInfo(procRoot, 10)).toEqual({ pid: 10, ppid: 5, command: "sh" });
    expect(await processInfo(procRoot, 12)).toBeNull();
  });

  test("listeningPorts keeps only sockets held by the agent", async () => {
    const ports = await listeningPorts(procRoot, parseSocketInodes("10 4242\n11 5151\n10 4343\n"));
    expect(ports).toEqual([
      { port: 3000, address: "::1", pid: 11 },
      { port: 8080, address: "127.0.0.1", pid: 10 },
    ]);
    expect(await listeningPorts(procRoot, new Map())).toEqual([]);
  });
});
