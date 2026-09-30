/**
 * Process and port discovery for the linux-user backend (research 01 §12):
 * every agent runs in its own systemd scope, so its processes are exactly the
 * PIDs in that scope's `cgroup.procs` (world-readable), and its listening
 * ports are the `/proc/<pid>/net/tcp{,6}` sockets (its network namespace) in
 * state LISTEN (0A) whose inode is held by one of those PIDs. Mapping inodes to PIDs needs `/proc/<pid>/fd`,
 * which only the owner can read, so the helper's `sockets` verb supplies it.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PortInfo, ProcessInfo } from "../types.ts";
import { isAgentScope } from "./ids.ts";

/** PIDs in the agent's scopes (tmux pane scope and piped scopes), nested cgroups included. */
export async function agentPids(cgroupDir: string, agentId: string): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(cgroupDir);
  } catch {
    return [];
  }
  const pids = new Set<number>();
  for (const name of entries.filter((e) => isAgentScope(e, agentId)).sort()) {
    for (const pid of await cgroupPids(join(cgroupDir, name))) pids.add(pid);
  }
  return [...pids];
}

async function cgroupPids(dir: string): Promise<number[]> {
  const out: number[] = [];
  try {
    const text = await readFile(join(dir, "cgroup.procs"), "utf8");
    for (const line of text.split("\n")) if (/^\d+$/.test(line)) out.push(Number(line));
  } catch {
    return out;
  }
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(...(await cgroupPids(join(dir, entry.name))));
    }
  } catch {
    // the scope went away while we were reading it
  }
  return out;
}

/** `pid (comm) state ppid ...`; comm may itself contain spaces and parentheses. */
export function parseProcStat(text: string): ProcessInfo | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const ppid = Number(
    text
      .slice(close + 1)
      .trim()
      .split(/\s+/)[1],
  );
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null;
  return { pid, ppid, command: text.slice(open + 1, close) };
}

export async function processInfo(procRoot: string, pid: number): Promise<ProcessInfo | null> {
  try {
    return parseProcStat(await readFile(join(procRoot, String(pid), "stat"), "utf8"));
  } catch {
    return null; // exited
  }
}

interface ListeningSocket {
  inode: number;
  address: string;
  port: number;
}

/** LISTEN sockets from a `/proc/net/tcp` or `/proc/net/tcp6` table. */
export function parseProcNetTcp(text: string): ListeningSocket[] {
  const out: ListeningSocket[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    const local = f[1];
    if (!local || f[3] !== "0A") continue;
    const [addrHex, portHex] = local.split(":");
    const inode = Number(f[9]);
    if (!addrHex || !portHex || !Number.isInteger(inode)) continue;
    const address = addrHex.length === 8 ? ipv4(addrHex) : ipv6(addrHex);
    if (address === null) continue;
    out.push({ inode, address, port: Number.parseInt(portHex, 16) });
  }
  return out;
}

/** The kernel prints each 32-bit word of the address in host (little-endian) order. */
function wordBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 6; i >= 0; i -= 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

function ipv4(hex: string): string {
  return wordBytes(hex).join(".");
}

function ipv6(hex: string): string | null {
  if (hex.length !== 32) return null;
  const bytes: number[] = [];
  for (let w = 0; w < 4; w++) bytes.push(...wordBytes(hex.slice(w * 8, w * 8 + 8)));
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  // Compress the longest run (>= 2) of zero groups, RFC 5952.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hexes = groups.map((g) => g.toString(16));
  if (best < 0) return hexes.join(":");
  return `${hexes.slice(0, best).join(":")}::${hexes.slice(best + bestLen).join(":")}`;
}

/** `<pid> <inode>` lines from the helper's `sockets` verb. */
export function parseSocketInodes(text: string): Map<number, number> {
  const byInode = new Map<number, number>();
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d+) (\d+)$/);
    if (m) byInode.set(Number(m[2]), Number(m[1]));
  }
  return byInode;
}

/** Listening ports whose socket inode belongs to one of the agent's processes. */
export async function listeningPorts(
  procRoot: string,
  pidByInode: Map<number, number>,
): Promise<PortInfo[]> {
  if (pidByInode.size === 0) return [];
  // The tables of the agent's own network namespace (a sandbox has one, #169): all
  // its processes share it, so the first one still alive tells. `/proc/net` is the
  // office's own namespace, which is the same when the agent has no sandbox.
  const bases = [...new Set(pidByInode.values())].map((pid) => join(procRoot, String(pid), "net"));
  const ports: PortInfo[] = [];
  for (const table of ["tcp", "tcp6"]) {
    let text: string | undefined;
    for (const base of [...bases, join(procRoot, "net")]) {
      try {
        text = await readFile(join(base, table), "utf8");
        break;
      } catch {
        // exited, or no such table here
      }
    }
    if (text === undefined) continue;
    for (const s of parseProcNetTcp(text)) {
      const pid = pidByInode.get(s.inode);
      if (pid !== undefined) ports.push({ port: s.port, address: s.address, pid });
    }
  }
  return ports.sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
}
